//! Per-player world pose persistence (`load`/`save` via `#[server]`).
//!
//! Keyed by the authenticated user id (`req.user_id()`), same trust model as
//! `player_inventory.rs`. Multiplayer WS poses stay ephemeral; this table is
//! what restores spawn after disconnect / browser close.

use resuma::prelude::*;
use serde_json::{json, Value};
use std::f32::consts::TAU;

/// Same clamps as `multiplayer.rs` pose handler — reject teleports from a
/// tampered client without silently accepting huge coordinates.
const XZ_MIN: f32 = -400.0;
const XZ_MAX: f32 = 400.0;
const Y_MIN: f32 = -200.0;
const Y_MAX: f32 = 500.0;

#[derive(Clone, Copy)]
struct StoredPose {
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
}

fn sanitize_pose(x: f32, y: f32, z: f32, yaw: f32) -> Option<StoredPose> {
    if ![x, y, z, yaw].into_iter().all(|v| v.is_finite()) {
        return None;
    }
    Some(StoredPose {
        x: x.clamp(XZ_MIN, XZ_MAX),
        y: y.clamp(Y_MIN, Y_MAX),
        z: z.clamp(XZ_MIN, XZ_MAX),
        yaw: yaw.rem_euclid(TAU),
    })
}

async fn read_pose(user_id: &str) -> Option<StoredPose> {
    let conn = crate::db::connect().await.ok()?;
    let mut rows = conn
        .query(
            "SELECT x, y, z, yaw FROM player_position WHERE user_id = ?1",
            [user_id],
        )
        .await
        .ok()?;
    let row = rows.next().await.ok()??;
    let x: f64 = row.get(0).ok()?;
    let y: f64 = row.get(1).ok()?;
    let z: f64 = row.get(2).ok()?;
    let yaw: f64 = row.get(3).ok()?;
    sanitize_pose(x as f32, y as f32, z as f32, yaw as f32)
}

async fn write_pose(user_id: &str, pose: StoredPose) -> std::result::Result<(), String> {
    let conn = crate::db::connect().await?;
    conn.execute(
        "INSERT INTO player_position (user_id, updated_at, x, y, z, yaw) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT(user_id) DO UPDATE SET \
           updated_at = excluded.updated_at, \
           x = excluded.x, \
           y = excluded.y, \
           z = excluded.z, \
           yaw = excluded.yaw",
        libsql::params![
            user_id.to_string(),
            crate::db::now_epoch_ms(),
            pose.x as f64,
            pose.y as f64,
            pose.z as f64,
            pose.yaw as f64,
        ],
    )
    .await
    .map_err(|e| format!("save pose failed: {e}"))?;
    Ok(())
}

/// `{ "found": false }` for logged-out / first-time players; otherwise the
/// last saved feet pose so the client can spawn there on reconnect.
#[server]
pub async fn load_player_position(req: &FlowRequest) -> Result<Value> {
    let Some(user_id) = req.user_id() else {
        return Ok(json!({ "found": false }));
    };
    match read_pose(user_id).await {
        Some(p) => Ok(json!({
            "found": true,
            "x": p.x,
            "y": p.y,
            "z": p.z,
            "yaw": p.yaw,
        })),
        None => Ok(json!({ "found": false })),
    }
}

#[server]
pub async fn save_player_position(
    x: f32,
    y: f32,
    z: f32,
    yaw: f32,
    req: &FlowRequest,
) -> Result<Value> {
    let Some(user_id) = req.user_id() else {
        return Err(ResumaError::Unauthorized);
    };
    let Some(pose) = sanitize_pose(x, y, z, yaw) else {
        return Err(ResumaError::Validation("invalid pose".into()));
    };
    write_pose(user_id, pose)
        .await
        .map_err(ResumaError::Validation)?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::with_temp_db;

    async fn register_test_user(tag: &str) -> String {
        let raw = format!("pp{tag}{}", uuid::Uuid::new_v4().simple());
        let username = &raw[..20];
        crate::auth::register(username, "correcthorsebattery")
            .await
            .unwrap()
            .id
    }

    #[test]
    fn sanitize_rejects_non_finite_and_clamps() {
        assert!(sanitize_pose(f32::NAN, 0.0, 0.0, 0.0).is_none());
        let p = sanitize_pose(9999.0, -999.0, -9999.0, -1.0).unwrap();
        assert_eq!(p.x, XZ_MAX);
        assert_eq!(p.y, Y_MIN);
        assert_eq!(p.z, XZ_MIN);
        assert!(p.yaw >= 0.0 && p.yaw < TAU);
    }

    #[tokio::test]
    async fn round_trips_saved_pose() {
        with_temp_db(|| async {
            let user_id = register_test_user("a").await;
            assert!(read_pose(&user_id).await.is_none());

            let pose = StoredPose {
                x: 12.5,
                y: 1.2,
                z: -8.25,
                yaw: 1.57,
            };
            write_pose(&user_id, pose).await.unwrap();
            let loaded = read_pose(&user_id).await.expect("pose present");
            assert!((loaded.x - 12.5).abs() < 1e-4);
            assert!((loaded.z - (-8.25)).abs() < 1e-4);
            assert!((loaded.yaw - 1.57).abs() < 1e-4);

            write_pose(
                &user_id,
                StoredPose {
                    x: 0.0,
                    y: 2.0,
                    z: 3.0,
                    yaw: 0.0,
                },
            )
            .await
            .unwrap();
            let again = read_pose(&user_id).await.unwrap();
            assert!((again.x - 0.0).abs() < 1e-4);
            assert!((again.z - 3.0).abs() < 1e-4);
        })
        .await;
    }

    #[tokio::test]
    async fn different_users_have_independent_poses() {
        with_temp_db(|| async {
            let a = register_test_user("b").await;
            let b = register_test_user("c").await;
            write_pose(
                &a,
                StoredPose {
                    x: 10.0,
                    y: 1.0,
                    z: 20.0,
                    yaw: 0.5,
                },
            )
            .await
            .unwrap();
            assert!(read_pose(&b).await.is_none());
            assert!((read_pose(&a).await.unwrap().x - 10.0).abs() < 1e-4);
        })
        .await;
    }
}
