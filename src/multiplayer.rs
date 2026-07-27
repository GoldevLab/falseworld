//! Realtime presence + shared build world over WebSocket (`GET /_fw/mp/ws`).
//!
//! One room per world `seed`. Guests join with a name; poses broadcast ~30 Hz
//! and player-placed build pieces are relayed (+ snapshot for late join).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Query;
use axum::response::IntoResponse;
use axum::routing::{get, MethodRouter};
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;
use uuid::Uuid;

const MAX_PEERS: usize = 32;
const MAX_WORLD_PIECES: usize = 2500;
const POSE_MIN_INTERVAL_MS: u128 = 30;
/// Must tolerate a background browser tab: Chrome throttles timers heavily, so
/// pose heartbeats can pause for tens of seconds while the WebSocket stays open.
const PEER_TIMEOUT: Duration = Duration::from_secs(120);
const NAME_MAX: usize = 24;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerSnapshot {
    pub id: String,
    pub name: String,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,
    pub moving: bool,
    pub sprinting: bool,
    pub crouching: bool,
}

struct PeerLive {
    snap: PeerSnapshot,
    last_pose: Instant,
    last_seen: Instant,
    /// False until the client sends its first pose — keeps loading/zombie
    /// sockets out of welcome/roster (they would otherwise sit at 0,0,0).
    has_posed: bool,
    tx: mpsc::UnboundedSender<String>,
}

struct Room {
    peers: HashMap<String, PeerLive>,
    /// Player-built pieces keyed by stable string id (shared across peers).
    world: HashMap<String, Value>,
}

type Rooms = Arc<Mutex<HashMap<u32, Room>>>;

static ROOMS: once_cell::sync::Lazy<Rooms> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

fn sanitize_id(raw: &str) -> Option<String> {
    let t: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    if t.len() >= 8 {
        Some(t)
    } else {
        None
    }
}

fn sanitize_name(raw: &str) -> String {
    let trimmed: String = raw
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.'))
        .take(NAME_MAX)
        .collect::<String>()
        .trim()
        .to_string();
    if trimmed.is_empty() {
        format!("Guest-{}", &Uuid::new_v4().to_string()[..4])
    } else {
        trimmed
    }
}

fn sanitize_piece_id(raw: &str) -> Option<String> {
    let t: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(96)
        .collect();
    if t.len() >= 3 {
        Some(t)
    } else {
        None
    }
}

fn piece_id_of(piece: &Value) -> Option<String> {
    piece
        .get("id")
        .and_then(|v| v.as_str())
        .and_then(sanitize_piece_id)
}

fn is_syncable_piece(piece: &Value) -> bool {
    let ty = piece.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if ty.is_empty() || ty.len() > 40 {
        return false;
    }
    if matches!(
        ty,
        "world_ore" | "world_tree" | "scrap_barrel" | "fx_blast" | "satchel_charge" | "c4_charge"
    ) {
        return false;
    }
    if piece.get("ownerId").and_then(|v| v.as_str()) == Some("world") {
        return false;
    }
    piece_id_of(piece).is_some()
}

fn world_snapshot_msg(room: &Room) -> String {
    let pieces: Vec<&Value> = room.world.values().collect();
    json!({ "t": "world", "pieces": pieces }).to_string()
}

#[derive(Debug, Deserialize)]
struct JoinQuery {
    seed: Option<u32>,
    name: Option<String>,
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClientMsg {
    t: String,
    name: Option<String>,
    x: Option<f32>,
    y: Option<f32>,
    z: Option<f32>,
    yaw: Option<f32>,
    moving: Option<bool>,
    sprinting: Option<bool>,
    crouching: Option<bool>,
    piece: Option<Value>,
    id: Option<String>,
}

#[derive(Serialize)]
struct WelcomeMsg<'a> {
    t: &'static str,
    #[serde(rename = "selfId")]
    self_id: &'a str,
    peers: Vec<PeerSnapshot>,
}

#[derive(Serialize)]
struct PeerMsg<'a> {
    t: &'static str,
    #[serde(flatten)]
    peer: &'a PeerSnapshot,
}

#[derive(Serialize)]
struct LeftMsg<'a> {
    t: &'static str,
    id: &'a str,
}

#[derive(Serialize)]
struct RosterMsg {
    t: &'static str,
    peers: Vec<PeerSnapshot>,
}

fn posed_peers(room: &Room, except: &str) -> Vec<PeerSnapshot> {
    room.peers
        .values()
        .filter(|p| p.has_posed && p.snap.id != except)
        .map(|p| p.snap.clone())
        .collect()
}

fn broadcast(room: &Room, except: &str, json: &str) {
    for (id, peer) in &room.peers {
        if id == except {
            continue;
        }
        let _ = peer.tx.send(json.to_string());
    }
}

fn sweep_stale(room: &mut Room) {
    let cutoff = Instant::now() - PEER_TIMEOUT;
    let stale: Vec<String> = room
        .peers
        .iter()
        .filter(|(_, p)| p.last_seen < cutoff)
        .map(|(id, _)| id.clone())
        .collect();
    for id in stale {
        room.peers.remove(&id);
        let msg = serde_json::to_string(&LeftMsg { t: "left", id: &id }).unwrap_or_default();
        broadcast(room, "", &msg);
    }
}

/// Axum method router for presence WebSocket (`GET /_fw/mp/ws`).
pub fn ws_route() -> MethodRouter {
    get(ws_upgrade)
}

async fn ws_upgrade(ws: WebSocketUpgrade, Query(q): Query<JoinQuery>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, q))
}

async fn handle_socket(socket: WebSocket, q: JoinQuery) {
    let seed = q.seed.unwrap_or(42);
    let mut name = sanitize_name(q.name.as_deref().unwrap_or(""));
    let self_id = q
        .id
        .as_deref()
        .and_then(sanitize_id)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let join_result = {
        let mut rooms = ROOMS.lock();
        let room = rooms.entry(seed).or_insert_with(|| Room {
            peers: HashMap::new(),
            world: HashMap::new(),
        });
        sweep_stale(room);
        if room.peers.contains_key(&self_id) {
            // Replace stale same-id socket (refresh). Notify others so remotes clear.
            room.peers.remove(&self_id);
            let left = serde_json::to_string(&LeftMsg {
                t: "left",
                id: &self_id,
            })
            .unwrap_or_default();
            broadcast(room, "", &left);
        }
        if room.peers.len() >= MAX_PEERS {
            Err("room full")
        } else {
            let snap = PeerSnapshot {
                id: self_id.clone(),
                name: name.clone(),
                x: 0.0,
                y: 0.0,
                z: 0.0,
                yaw: 0.0,
                moving: false,
                sprinting: false,
                crouching: false,
            };
            // Only peers that already sent a pose — avoids a pile of 0,0,0 ghosts.
            let others = posed_peers(room, "");
            let world_msg = world_snapshot_msg(room);
            room.peers.insert(
                self_id.clone(),
                PeerLive {
                    snap,
                    last_pose: Instant::now()
                        - Duration::from_millis(POSE_MIN_INTERVAL_MS as u64),
                    last_seen: Instant::now(),
                    has_posed: false,
                    tx: tx.clone(),
                },
            );
            // Announce only after first pose (see "pose" handler).
            let welcome = serde_json::to_string(&WelcomeMsg {
                t: "welcome",
                self_id: &self_id,
                peers: others,
            })
            .unwrap_or_default();
            let _ = tx.send(welcome);
            let _ = tx.send(world_msg);
            Ok(())
        }
    };

    if join_result.is_err() {
        let (mut sink, _) = socket.split();
        let _ = sink
            .send(Message::Text(r#"{"t":"error","msg":"room full"}"#.into()))
            .await;
        return;
    }

    let (mut sink, mut stream) = socket.split();
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sink.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = stream.next().await {
        let text = match msg {
            Message::Text(t) => t.to_string(),
            Message::Ping(_) | Message::Pong(_) => continue,
            Message::Close(_) => break,
            Message::Binary(_) => continue,
        };
        let Ok(parsed) = serde_json::from_str::<ClientMsg>(&text) else {
            continue;
        };
        match parsed.t.as_str() {
            "hello" => {
                if let Some(n) = parsed.name.as_deref() {
                    name = sanitize_name(n);
                    let mut rooms = ROOMS.lock();
                    if let Some(room) = rooms.get_mut(&seed) {
                        if let Some(peer) = room.peers.get_mut(&self_id) {
                            peer.snap.name = name.clone();
                            peer.last_seen = Instant::now();
                            // Don't advertise unposed peers at 0,0,0.
                            if peer.has_posed {
                                let out = serde_json::to_string(&PeerMsg {
                                    t: "peer",
                                    peer: &peer.snap,
                                })
                                .unwrap_or_default();
                                broadcast(room, &self_id, &out);
                            }
                        }
                    }
                }
            }
            "ping" => {
                let mut rooms = ROOMS.lock();
                if let Some(room) = rooms.get_mut(&seed) {
                    if let Some(peer) = room.peers.get_mut(&self_id) {
                        peer.last_seen = Instant::now();
                    }
                }
            }
            "sync" => {
                let (roster, world_msg) = {
                    let mut rooms = ROOMS.lock();
                    if let Some(room) = rooms.get_mut(&seed) {
                        if let Some(peer) = room.peers.get_mut(&self_id) {
                            peer.last_seen = Instant::now();
                        }
                        (
                            posed_peers(room, &self_id),
                            world_snapshot_msg(room),
                        )
                    } else {
                        (Vec::new(), json!({ "t": "world", "pieces": [] }).to_string())
                    }
                };
                let msg = serde_json::to_string(&RosterMsg {
                    t: "roster",
                    peers: roster,
                })
                .unwrap_or_default();
                let _ = tx.send(msg);
                let _ = tx.send(world_msg);
            }
            "place" => {
                let Some(piece) = parsed.piece else {
                    continue;
                };
                if !is_syncable_piece(&piece) {
                    continue;
                }
                let Some(pid) = piece_id_of(&piece) else {
                    continue;
                };
                let mut rooms = ROOMS.lock();
                let Some(room) = rooms.get_mut(&seed) else {
                    continue;
                };
                if let Some(peer) = room.peers.get_mut(&self_id) {
                    peer.last_seen = Instant::now();
                }
                if room.world.len() >= MAX_WORLD_PIECES && !room.world.contains_key(&pid) {
                    continue;
                }
                room.world.insert(pid, piece.clone());
                let out = json!({ "t": "place", "piece": piece }).to_string();
                broadcast(room, &self_id, &out);
            }
            "remove" => {
                let Some(raw_id) = parsed.id.as_deref() else {
                    continue;
                };
                let Some(pid) = sanitize_piece_id(raw_id) else {
                    continue;
                };
                let mut rooms = ROOMS.lock();
                let Some(room) = rooms.get_mut(&seed) else {
                    continue;
                };
                if let Some(peer) = room.peers.get_mut(&self_id) {
                    peer.last_seen = Instant::now();
                }
                if room.world.remove(&pid).is_none() {
                    // Still broadcast so peers that have a local copy can drop it.
                }
                let out = json!({ "t": "remove", "id": pid }).to_string();
                broadcast(room, &self_id, &out);
            }
            "pose" => {
                let mut rooms = ROOMS.lock();
                let Some(room) = rooms.get_mut(&seed) else {
                    continue;
                };
                sweep_stale(room);
                let Some(peer) = room.peers.get_mut(&self_id) else {
                    break;
                };
                peer.last_seen = Instant::now();
                if peer.last_pose.elapsed().as_millis() < POSE_MIN_INTERVAL_MS {
                    continue;
                }
                peer.last_pose = Instant::now();
                peer.has_posed = true;
                if let Some(x) = parsed.x {
                    peer.snap.x = x;
                }
                if let Some(y) = parsed.y {
                    peer.snap.y = y;
                }
                if let Some(z) = parsed.z {
                    peer.snap.z = z;
                }
                if let Some(yaw) = parsed.yaw {
                    peer.snap.yaw = yaw;
                }
                if let Some(m) = parsed.moving {
                    peer.snap.moving = m;
                }
                if let Some(s) = parsed.sprinting {
                    peer.snap.sprinting = s;
                }
                if let Some(c) = parsed.crouching {
                    peer.snap.crouching = c;
                }
                let out = serde_json::to_string(&PeerMsg {
                    t: "peer",
                    peer: &peer.snap,
                })
                .unwrap_or_default();
                broadcast(room, &self_id, &out);
            }
            _ => {}
        }
    }

    writer.abort();
    {
        let mut rooms = ROOMS.lock();
        if let Some(room) = rooms.get_mut(&seed) {
            room.peers.remove(&self_id);
            let msg = serde_json::to_string(&LeftMsg {
                t: "left",
                id: &self_id,
            })
            .unwrap_or_default();
            broadcast(room, "", &msg);
            if room.peers.is_empty() {
                rooms.remove(&seed);
            }
        }
    }
}
