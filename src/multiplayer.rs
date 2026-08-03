//! Realtime presence + shared build world over WebSocket (`GET /_fw/mp/ws`).
//!
//! One room per world `seed`. Guests join with a name; poses broadcast ~30 Hz
//! and player-placed build pieces are relayed (+ snapshot for late join).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::Query;
use axum::response::IntoResponse;
use axum::routing::{get, MethodRouter};
use futures_util::{SinkExt, StreamExt};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::mpsc;
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

const MAX_PEERS: usize = 32;
const MAX_WORLD_PIECES: usize = 2500;
const MAX_MESSAGE_BYTES: usize = 64 * 1024;
const POSE_MIN_INTERVAL_MS: u128 = 30;
const PLACE_MIN_INTERVAL_MS: u128 = 50;
const REMOVE_MIN_INTERVAL_MS: u128 = 100;
const EXPLODE_MIN_INTERVAL_MS: u128 = 150;
const MAX_EXPLODE_HITS: usize = 48;
const SYNC_MIN_INTERVAL_MS: u128 = 1_000;
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
    last_place: Instant,
    last_remove: Instant,
    last_explode: Instant,
    last_sync: Instant,
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
    revision: u64,
}

type Rooms = Arc<Mutex<HashMap<u32, Room>>>;

static ROOMS: once_cell::sync::Lazy<Rooms> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));
static WORLD_SAVE_LOCK: once_cell::sync::Lazy<AsyncMutex<()>> =
    once_cell::sync::Lazy::new(|| AsyncMutex::new(()));

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

fn is_allowed_piece_type(ty: &str) -> bool {
    matches!(
        ty,
        "foundation"
            | "foundation_tri"
            | "stairs"
            | "stairs_l"
            | "stairs_u"
            | "floor_steps"
            | "floor"
            | "floor_tri"
            | "floor_frame"
            | "roof"
            | "roof_tri"
            | "roof_ridge"
            | "wall"
            | "doorway"
            | "window"
            | "wall_frame"
            | "pillar"
            | "doorway_d"
            | "wall_half"
            | "wall_low"
            | "roof_corner"
            | "roof_valley"
            | "ramp"
            | "roof_wall"
            | "door"
            | "toolcupboard"
            | "workbench"
            | "research_table"
            | "campfire"
            | "sleeping_bag"
            | "box_small"
            | "box_large"
    )
}

fn is_syncable_piece(piece: &Value) -> bool {
    let ty = piece.get("type").and_then(|v| v.as_str()).unwrap_or("");
    is_allowed_piece_type(ty) && piece_id_of(piece).is_some()
}

fn finite_number(value: Option<&Value>, fallback: f64, min: f64, max: f64) -> f64 {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .unwrap_or(fallback)
        .clamp(min, max)
}

fn integer(value: Option<&Value>, fallback: i64, min: i64, max: i64) -> i64 {
    value
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|n| n.round() as i64)))
        .unwrap_or(fallback)
        .clamp(min, max)
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn sanitized_auth(value: Option<&Value>, owner_id: &str) -> Value {
    let mut ids = Vec::new();
    if let Some(values) = value.and_then(Value::as_array) {
        for raw in values.iter().take(32) {
            let Some(id) = raw.as_str().and_then(sanitize_id) else {
                continue;
            };
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    if !ids.iter().any(|id| id == owner_id) {
        ids.insert(0, owner_id.to_string());
    }
    Value::Array(ids.into_iter().map(Value::String).collect())
}

/// Authoritative per-hit damage for an `explode` message. Mirrors the client
/// prediction in `fw-meadow-gpu.js::applyExplosion` minus the blast-radius
/// falloff multiplier (the client already filtered `hits` to pieces inside
/// the blast/splash radius; the server only needs to settle the *amount*).
fn explosive_hard_damage(kind: &str, tier: usize) -> f32 {
    match kind {
        "rocket" => crate::explosives::rocket_damage_hard(tier),
        "c4" => crate::explosives::c4_damage_hard(tier),
        _ => crate::explosives::satchel_damage_hard(tier),
    }
}

/// Whether `peer_id` may remove/damage-authorize actions on `piece`: the
/// owner, or (for `toolcupboard`/`door`) anyone listed in its `auth` list —
/// e.g. a teammate added to the same TC. Prevents the old "anyone within 10m"
/// rule from letting strangers grief pieces they don't own or share.
fn is_authorized_on_piece(piece: &Value, peer_id: &str) -> bool {
    let owner = piece.get("ownerId").and_then(Value::as_str).unwrap_or("");
    if owner == peer_id {
        return true;
    }
    piece
        .get("auth")
        .and_then(Value::as_array)
        .map(|ids| ids.iter().any(|v| v.as_str() == Some(peer_id)))
        .unwrap_or(false)
}

/// Validates box/campfire/workbench `slots` (`[{id,qty}|null, ...]`) against
/// the item catalog: unknown ids are dropped, quantities clamped to
/// `stack_size`. Same threat model as `player_inventory::sanitize_slots` —
/// a tampered client must not be able to smuggle invalid/infinite items into
/// a piece that other players can see or loot.
fn sanitize_item_slots(raw: &Value, max_len: usize) -> Value {
    let Some(arr) = raw.as_array() else {
        return Value::Array(Vec::new());
    };
    let out: Vec<Value> = arr
        .iter()
        .take(max_len)
        .map(|entry| {
            let id = entry.get("id").and_then(Value::as_str);
            let qty = entry.get("qty").and_then(Value::as_i64);
            match (id.and_then(crate::inventory::item_def), qty) {
                (Some(def), Some(qty)) if qty > 0 => {
                    json!({ "id": id.unwrap(), "qty": qty.clamp(1, def.stack_size as i64) })
                }
                _ => Value::Null,
            }
        })
        .collect();
    Value::Array(out)
}

/// Validates a toolcupboard `inv` upkeep counter (`{wood,stone,metal,hq}`),
/// clamping each known resource and dropping anything else.
fn sanitize_resource_map(raw: &Value) -> Value {
    const KEYS: [&str; 4] = ["wood", "stone", "metal", "hq"];
    const MAX_PER_RESOURCE: i64 = 100_000;
    let mut out = Map::new();
    for key in KEYS {
        let qty = raw
            .get(key)
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .clamp(0, MAX_PER_RESOURCE);
        out.insert(key.to_string(), json!(qty));
    }
    Value::Object(out)
}

fn normalize_piece(
    piece: &Value,
    self_id: &str,
    existing: Option<&Value>,
) -> Option<(String, Value)> {
    if !is_syncable_piece(piece) {
        return None;
    }
    let source = piece.as_object()?;
    let pid = piece_id_of(piece)?;
    if let Some(current) = existing {
        let owner = current.get("ownerId").and_then(Value::as_str).unwrap_or("");
        if owner != self_id {
            return None;
        }
    }

    let ty = source.get("type")?.as_str()?;
    let tier = integer(source.get("tier"), 0, 0, 4) as usize;
    let max_hp = crate::explosives::WALL_HP[tier] as f64;
    let owner_id = existing
        .and_then(|v| v.get("ownerId"))
        .and_then(Value::as_str)
        .unwrap_or(self_id);
    // Client timestamps use performance.now(), so they are not portable across
    // tabs or server restarts. Persisted/network pieces are intentionally locked.
    let placed_at = 0u64;

    let mut out = Map::new();
    out.insert("id".into(), Value::String(pid.clone()));
    out.insert("type".into(), Value::String(ty.to_string()));
    out.insert("ix".into(), json!(integer(source.get("ix"), 0, -256, 256)));
    out.insert("iy".into(), json!(integer(source.get("iy"), 0, -16, 64)));
    out.insert("iz".into(), json!(integer(source.get("iz"), 0, -256, 256)));
    out.insert("yaw".into(), json!(integer(source.get("yaw"), 0, 0, 3)));
    out.insert(
        "baseY".into(),
        json!(finite_number(source.get("baseY"), 0.0, -200.0, 500.0)),
    );
    out.insert(
        "_ox".into(),
        json!(finite_number(source.get("_ox"), 0.0, -3.0, 3.0)),
    );
    out.insert(
        "_oz".into(),
        json!(finite_number(source.get("_oz"), 0.0, -3.0, 3.0)),
    );
    out.insert("tier".into(), json!(tier));
    out.insert(
        "hp".into(),
        json!(if existing.is_some() {
            finite_number(source.get("hp"), max_hp, 0.0, max_hp)
        } else {
            max_hp
        }),
    );
    out.insert("maxHp".into(), json!(max_hp));
    out.insert(
        "stability".into(),
        json!(finite_number(source.get("stability"), 100.0, 0.0, 100.0)),
    );
    out.insert("ownerId".into(), Value::String(owner_id.to_string()));
    out.insert("placedAt".into(), json!(placed_at));
    out.insert(
        "softInward".into(),
        json!(source
            .get("softInward")
            .and_then(Value::as_bool)
            .unwrap_or(true)),
    );

    for field in ["lit", "isOpen", "locked"] {
        if let Some(value) = source.get(field).and_then(Value::as_bool) {
            out.insert(field.into(), Value::Bool(value));
        }
    }
    if let Some(value) = source.get("doorYaw") {
        out.insert(
            "doorYaw".into(),
            json!(finite_number(Some(value), 0.0, -6.4, 6.4)),
        );
    }
    if let Some(value) = source.get("wbTier") {
        out.insert("wbTier".into(), json!(integer(Some(value), 1, 1, 3)));
    }
    if let Some(label) = source.get("bagLabel").and_then(Value::as_str) {
        out.insert(
            "bagLabel".into(),
            Value::String(label.chars().take(32).collect()),
        );
    }
    if let Some(value) = source.get("slots").filter(|v| v.is_array()) {
        out.insert("slots".into(), sanitize_item_slots(value, 12));
    }
    if let Some(value) = source.get("inv").filter(|v| v.is_object()) {
        out.insert("inv".into(), sanitize_resource_map(value));
    }
    if matches!(ty, "toolcupboard" | "door") {
        out.insert("auth".into(), sanitized_auth(source.get("auth"), owner_id));
    }

    Some((pid, Value::Object(out)))
}

fn point_near_piece(px: f32, pz: f32, piece: &Value, max_distance: f32) -> bool {
    let ix = piece.get("ix").and_then(Value::as_f64).unwrap_or(0.0);
    let iz = piece.get("iz").and_then(Value::as_f64).unwrap_or(0.0);
    let ox = piece.get("_ox").and_then(Value::as_f64).unwrap_or(0.0);
    let oz = piece.get("_oz").and_then(Value::as_f64).unwrap_or(0.0);
    let x = ix * 3.0 + ox;
    let z = iz * 3.0 + oz;
    let dx = px as f64 - x;
    let dz = pz as f64 - z;
    dx * dx + dz * dz <= (max_distance as f64).powi(2)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWorld {
    version: u32,
    seed: u32,
    updated_at: u64,
    pieces: Vec<Value>,
}

fn world_data_dir() -> PathBuf {
    std::env::var_os("FW_WORLD_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./data/worlds"))
}

fn world_file(seed: u32) -> PathBuf {
    world_data_dir().join(format!("world-{seed}.json"))
}

async fn load_world(seed: u32) -> HashMap<String, Value> {
    let Ok(bytes) = tokio::fs::read(world_file(seed)).await else {
        return HashMap::new();
    };
    let Ok(stored) = serde_json::from_slice::<StoredWorld>(&bytes) else {
        return HashMap::new();
    };
    if stored.version != 1 || stored.seed != seed {
        return HashMap::new();
    }
    stored
        .pieces
        .into_iter()
        .filter(|piece| is_syncable_piece(piece))
        .filter_map(|piece| piece_id_of(&piece).map(|id| (id, piece)))
        .take(MAX_WORLD_PIECES)
        .collect()
}

async fn persist_world(seed: u32, revision: u64, world: HashMap<String, Value>) {
    let _save_guard = WORLD_SAVE_LOCK.lock().await;
    let current_revision = ROOMS.lock().get(&seed).map(|room| room.revision);
    if current_revision != Some(revision) {
        return;
    }
    let dir = world_data_dir();
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return;
    }
    let payload = StoredWorld {
        version: 1,
        seed,
        updated_at: now_epoch_ms(),
        pieces: world.into_values().collect(),
    };
    let Ok(bytes) = serde_json::to_vec(&payload) else {
        return;
    };
    let path = world_file(seed);
    let tmp = dir.join(format!("world-{seed}.tmp"));
    if tokio::fs::write(&tmp, bytes).await.is_ok() {
        let _ = tokio::fs::rename(tmp, path).await;
    }
}

async fn persist_latest_world(seed: u32, revision: u64) {
    tokio::time::sleep(Duration::from_millis(250)).await;
    let world = {
        let rooms = ROOMS.lock();
        let Some(room) = rooms.get(&seed) else {
            return;
        };
        if room.revision != revision {
            return;
        }
        room.world.clone()
    };
    persist_world(seed, revision, world).await;
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
    kind: Option<String>,
    hits: Option<Vec<Value>>,
}

#[derive(Serialize)]
struct HpMsg<'a> {
    t: &'static str,
    id: &'a str,
    hp: f64,
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
    let self_id =
        q.id.as_deref()
            .and_then(sanitize_id)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let persisted_world = load_world(seed).await;

    let join_result = {
        let mut rooms = ROOMS.lock();
        let room = rooms.entry(seed).or_insert_with(|| Room {
            peers: HashMap::new(),
            world: persisted_world,
            revision: 0,
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
                    last_pose: Instant::now() - Duration::from_millis(POSE_MIN_INTERVAL_MS as u64),
                    last_place: Instant::now()
                        - Duration::from_millis(PLACE_MIN_INTERVAL_MS as u64),
                    last_remove: Instant::now()
                        - Duration::from_millis(REMOVE_MIN_INTERVAL_MS as u64),
                    last_explode: Instant::now()
                        - Duration::from_millis(EXPLODE_MIN_INTERVAL_MS as u64),
                    last_sync: Instant::now() - Duration::from_millis(SYNC_MIN_INTERVAL_MS as u64),
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
        if text.len() > MAX_MESSAGE_BYTES {
            continue;
        }
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
                            if peer.last_sync.elapsed().as_millis() < SYNC_MIN_INTERVAL_MS {
                                continue;
                            }
                            peer.last_sync = Instant::now();
                        }
                        (posed_peers(room, &self_id), world_snapshot_msg(room))
                    } else {
                        (
                            Vec::new(),
                            json!({ "t": "world", "pieces": [] }).to_string(),
                        )
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
                let save = {
                    let mut rooms = ROOMS.lock();
                    let Some(room) = rooms.get_mut(&seed) else {
                        continue;
                    };
                    let Some(peer) = room.peers.get_mut(&self_id) else {
                        continue;
                    };
                    peer.last_seen = Instant::now();
                    if peer.last_place.elapsed().as_millis() < PLACE_MIN_INTERVAL_MS {
                        continue;
                    }
                    peer.last_place = Instant::now();

                    let Some(raw_pid) = piece_id_of(&piece) else {
                        continue;
                    };
                    let existing = room.world.get(&raw_pid);
                    let Some((pid, normalized)) = normalize_piece(&piece, &self_id, existing)
                    else {
                        continue;
                    };
                    if room.world.len() >= MAX_WORLD_PIECES && !room.world.contains_key(&pid) {
                        continue;
                    }
                    room.world.insert(pid, normalized.clone());
                    room.revision = room.revision.wrapping_add(1);
                    let out = json!({ "t": "place", "piece": normalized }).to_string();
                    broadcast(room, &self_id, &out);
                    room.revision
                };
                tokio::spawn(persist_latest_world(seed, save));
            }
            "remove" => {
                let Some(raw_id) = parsed.id.as_deref() else {
                    continue;
                };
                let Some(pid) = sanitize_piece_id(raw_id) else {
                    continue;
                };
                let save = {
                    let mut rooms = ROOMS.lock();
                    let Some(room) = rooms.get_mut(&seed) else {
                        continue;
                    };
                    let Some(peer) = room.peers.get_mut(&self_id) else {
                        continue;
                    };
                    peer.last_seen = Instant::now();
                    if peer.last_remove.elapsed().as_millis() < REMOVE_MIN_INTERVAL_MS {
                        continue;
                    }
                    peer.last_remove = Instant::now();
                    let Some(existing) = room.world.get(&pid) else {
                        continue;
                    };
                    // Owner or TC/door `auth` member only — a bare proximity
                    // check let any stranger within 10m grief pieces they
                    // didn't build (see roadmap "vectores de trampa").
                    if !is_authorized_on_piece(existing, &self_id) {
                        continue;
                    }
                    room.world.remove(&pid);
                    room.revision = room.revision.wrapping_add(1);
                    let out = json!({ "t": "remove", "id": pid }).to_string();
                    broadcast(room, &self_id, &out);
                    room.revision
                };
                tokio::spawn(persist_latest_world(seed, save));
            }
            "explode" => {
                // Client-predicted damage from satchel/rocket/C4 (see
                // `applyExplosion` in `fw-meadow-gpu.js`) is only local
                // prediction; this is where it becomes authoritative. The
                // server recomputes HP from `explosives.rs` tables and
                // broadcasts `hp`/`remove` to every peer (including the
                // sender) so nobody can see a different wall HP than anyone
                // else after a raid.
                let kind = match parsed.kind.as_deref() {
                    Some("rocket") => "rocket",
                    Some("c4") => "c4",
                    _ => "satchel",
                };
                let Some(hits) = parsed.hits.as_ref() else {
                    continue;
                };
                let save = {
                    let mut rooms = ROOMS.lock();
                    let Some(room) = rooms.get_mut(&seed) else {
                        continue;
                    };
                    let Some(peer) = room.peers.get_mut(&self_id) else {
                        continue;
                    };
                    peer.last_seen = Instant::now();
                    if peer.last_explode.elapsed().as_millis() < EXPLODE_MIN_INTERVAL_MS {
                        continue;
                    }
                    peer.last_explode = Instant::now();
                    let (px, pz) = (peer.snap.x, peer.snap.z);

                    let mut outs: Vec<String> = Vec::new();
                    let mut changed = false;
                    for hit in hits.iter().take(MAX_EXPLODE_HITS) {
                        let Some(raw_id) = hit.get("id").and_then(Value::as_str) else {
                            continue;
                        };
                        let Some(pid) = sanitize_piece_id(raw_id) else {
                            continue;
                        };
                        let soft = hit.get("soft").and_then(Value::as_bool).unwrap_or(false);
                        let Some(existing) = room.world.get(&pid) else {
                            continue;
                        };
                        // Bounds the blast to plausible range instead of trusting
                        // the client's word that a distant piece was hit.
                        if !point_near_piece(px, pz, existing, 14.0) {
                            continue;
                        }
                        let tier = existing.get("tier").and_then(Value::as_u64).unwrap_or(0) as usize;
                        let max_hp = existing.get("maxHp").and_then(Value::as_f64).unwrap_or(50.0);
                        let cur_hp = existing.get("hp").and_then(Value::as_f64).unwrap_or(max_hp);
                        let mut dmg = explosive_hard_damage(kind, tier) as f64;
                        if soft {
                            dmg *= crate::explosives::SATCHEL_SOFT_MULT as f64;
                        }
                        let new_hp = (cur_hp - dmg).max(0.0);
                        if new_hp <= 0.0 {
                            room.world.remove(&pid);
                            outs.push(json!({ "t": "remove", "id": pid }).to_string());
                        } else if let Some(piece) = room.world.get_mut(&pid) {
                            if let Some(obj) = piece.as_object_mut() {
                                obj.insert("hp".into(), json!(new_hp));
                            }
                            outs.push(
                                serde_json::to_string(&HpMsg {
                                    t: "hp",
                                    id: &pid,
                                    hp: new_hp,
                                })
                                .unwrap_or_default(),
                            );
                        }
                        changed = true;
                    }
                    // Reconciliation goes to everyone, including the sender:
                    // the server may disagree with local prediction (e.g. a
                    // second attacker's hit landed first), so the attacker's
                    // own client must also converge on the authoritative HP.
                    for out in &outs {
                        broadcast(room, "", out);
                    }
                    if changed {
                        room.revision = room.revision.wrapping_add(1);
                        Some(room.revision)
                    } else {
                        None
                    }
                };
                if let Some(revision) = save {
                    tokio::spawn(persist_latest_world(seed, revision));
                }
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
                if let Some(x) = parsed.x.filter(|v| v.is_finite()) {
                    peer.snap.x = x.clamp(-400.0, 400.0);
                }
                if let Some(y) = parsed.y.filter(|v| v.is_finite()) {
                    peer.snap.y = y.clamp(-200.0, 500.0);
                }
                if let Some(z) = parsed.z.filter(|v| v.is_finite()) {
                    peer.snap.z = z.clamp(-400.0, 400.0);
                }
                if let Some(yaw) = parsed.yaw.filter(|v| v.is_finite()) {
                    peer.snap.yaw = yaw.rem_euclid(std::f32::consts::TAU);
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
    let empty_room = {
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
                Some((room.revision, room.world.clone()))
            } else {
                None
            }
        } else {
            None
        }
    };
    if let Some((revision, world)) = empty_room {
        persist_world(seed, revision, world).await;
        let mut rooms = ROOMS.lock();
        let can_remove = rooms
            .get(&seed)
            .map(|room| room.peers.is_empty() && room.revision == revision)
            .unwrap_or(false);
        if can_remove {
            rooms.remove(&seed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_new_piece_and_forces_owner_hp() {
        let raw = json!({
            "id": "player-123-piece-1",
            "type": "wall",
            "ix": 2,
            "iy": 0,
            "iz": -3,
            "yaw": 8,
            "tier": 0,
            "hp": 999999,
            "maxHp": 999999,
            "ownerId": "attacker",
            "auth": ["attacker"]
        });
        let (_, piece) = normalize_piece(&raw, "player-123", None).expect("valid piece");
        assert_eq!(piece["ownerId"], "player-123");
        assert_eq!(piece["hp"], 50.0);
        assert_eq!(piece["maxHp"], 50.0);
        assert_eq!(piece["yaw"], 3);
        assert_eq!(piece["placedAt"], 0);
    }

    #[test]
    fn rejects_unknown_types_and_foreign_updates() {
        let unknown = json!({
            "id": "player-123-piece-1",
            "type": "world_tree"
        });
        assert!(normalize_piece(&unknown, "player-123", None).is_none());

        let existing = json!({
            "id": "owner-123-piece-1",
            "type": "wall",
            "ownerId": "owner-123"
        });
        let update = json!({
            "id": "owner-123-piece-1",
            "type": "wall",
            "tier": 4
        });
        assert!(normalize_piece(&update, "attacker-456", Some(&existing)).is_none());
    }

    #[test]
    fn accepts_exact_twenty_piece_build_catalog() {
        let types = [
            "foundation",
            "roof",
            "ramp",
            "stairs",
            "floor",
            "floor_tri",
            "foundation_tri",
            "roof_tri",
            "roof_ridge",
            "wall",
            "doorway",
            "window",
            "wall_frame",
            "floor_frame",
            "wall_low",
            "wall_half",
            "pillar",
            "floor_steps",
            "stairs_l",
            "stairs_u",
        ];
        assert_eq!(types.len(), 20);
        for ty in types {
            assert!(is_allowed_piece_type(ty), "{ty} must be multiplayer-safe");
        }
    }

    #[test]
    fn explosive_hard_damage_matches_tables_per_kind() {
        assert_eq!(
            explosive_hard_damage("satchel", 0),
            crate::explosives::satchel_damage_hard(0)
        );
        assert_eq!(
            explosive_hard_damage("rocket", 2),
            crate::explosives::rocket_damage_hard(2)
        );
        assert_eq!(
            explosive_hard_damage("c4", 4),
            crate::explosives::c4_damage_hard(4)
        );
        // Unknown kinds fall back to satchel rather than panicking.
        assert_eq!(
            explosive_hard_damage("bogus", 1),
            crate::explosives::satchel_damage_hard(1)
        );
    }

    #[test]
    fn authorization_allows_owner_and_auth_members_only() {
        let piece = json!({
            "ownerId": "owner-1",
            "auth": ["owner-1", "friend-2"],
        });
        assert!(is_authorized_on_piece(&piece, "owner-1"));
        assert!(is_authorized_on_piece(&piece, "friend-2"));
        assert!(!is_authorized_on_piece(&piece, "stranger-3"));

        let no_auth_field = json!({ "ownerId": "owner-1" });
        assert!(is_authorized_on_piece(&no_auth_field, "owner-1"));
        assert!(!is_authorized_on_piece(&no_auth_field, "stranger-3"));
    }

    #[test]
    fn sanitize_item_slots_drops_unknown_ids_and_clamps_qty() {
        let raw = json!([
            { "id": "wood", "qty": 999999999 },
            { "id": "totally_fake_item", "qty": 5 },
            null,
        ]);
        let out = sanitize_item_slots(&raw, 12);
        let arr = out.as_array().unwrap();
        assert_eq!(arr[0]["id"], "wood");
        assert!(arr[0]["qty"].as_i64().unwrap() <= crate::inventory::STACK_SIZE as i64);
        assert!(arr[1].is_null());
        assert!(arr[2].is_null());
    }

    #[test]
    fn sanitize_resource_map_clamps_and_restricts_keys() {
        let raw = json!({ "wood": 999999999, "stone": -5, "evil": 123 });
        let out = sanitize_resource_map(&raw);
        assert_eq!(out["wood"], 100_000);
        assert_eq!(out["stone"], 0);
        assert_eq!(out["metal"], 0);
        assert!(out.get("evil").is_none());
    }

    #[tokio::test]
    async fn persists_and_loads_world_by_seed() {
        let seed = 4_000_000_000u32.saturating_sub(std::process::id());
        let dir = std::env::temp_dir().join(format!("falseworld-mp-test-{seed}"));
        std::env::set_var("FW_WORLD_DATA_DIR", &dir);
        let raw = json!({
            "id": "player-123-piece-2",
            "type": "foundation",
            "tier": 1,
            "ix": 1,
            "iy": 0,
            "iz": 1
        });
        let (id, piece) = normalize_piece(&raw, "player-123", None).expect("valid piece");
        let mut world = HashMap::new();
        world.insert(id.clone(), piece);
        ROOMS.lock().insert(
            seed,
            Room {
                peers: HashMap::new(),
                world: world.clone(),
                revision: 1,
            },
        );

        persist_world(seed, 1, world).await;
        let loaded = load_world(seed).await;
        assert!(loaded.contains_key(&id));

        ROOMS.lock().remove(&seed);
        let _ = tokio::fs::remove_dir_all(&dir).await;
        std::env::remove_var("FW_WORLD_DATA_DIR");
    }
}
