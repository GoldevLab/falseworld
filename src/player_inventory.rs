//! Per-player inventory persistence (`GET`/`POST` via `#[server]` actions).
//!
//! Stored in Turso/libSQL (`db.rs`'s `player_inventory` table) keyed by the
//! **authenticated** user id (`req.user_id()`, set by `auth::attach_session`
//! from a verified session cookie) — never a client-supplied id. Before
//! `auth.rs` existed, this was keyed by a `player_id` string the client
//! picked itself (`sessionStorage`, new per tab) and passed as a plain
//! argument: anyone could call `save_player_inventory`/`load_player_inventory`
//! with any id and read or overwrite a stranger's stash. Logging in is now
//! required to persist anything (`index.rs`'s page route redirects
//! unauthenticated visitors to `/login`); first-time visitors still get
//! `inventory::starter_backpack_json()` / `starter_hotbar_json()` as a
//! welcome gift client-side before their first save.
//!
//! Every incoming slot is validated against `inventory::ITEMS` (unknown item
//! ids are dropped, quantities are clamped to the item's `stack_size`) so a
//! tampered client can't smuggle invalid or infinite items into saved state.

use resuma::prelude::*;
use serde_json::{json, Value};

use crate::inventory::{item_def, InvStack, BACKPACK_SLOTS, HOTBAR_SLOTS};

const STORE_VERSION: i64 = 1;

struct StoredInventory {
    updated_at: i64,
    backpack: Vec<Option<InvStack>>,
    hotbar: Vec<Option<InvStack>>,
    hotbar_active: i32,
    held_id: String,
}

/// Parses a client-submitted slot array against the item catalog. Unknown ids
/// are dropped; quantities are clamped to `0..=stack_size` (0 becomes empty).
fn sanitize_slots(raw_json: &str, n: usize) -> Vec<Option<InvStack>> {
    let raw: Vec<Option<InvStack>> = serde_json::from_str(raw_json).unwrap_or_default();
    let mut out = vec![None; n];
    for (slot, stack) in out.iter_mut().zip(raw) {
        let Some(stack) = stack else { continue };
        let Some(def) = item_def(&stack.id) else {
            continue;
        };
        let qty = stack.qty.clamp(0, def.stack_size);
        if qty > 0 {
            *slot = Some(InvStack { id: stack.id, qty });
        }
    }
    out
}

fn slots_json(slots: &[Option<InvStack>]) -> String {
    serde_json::to_string(slots).unwrap_or_else(|_| "[]".to_string())
}

async fn read_inventory(user_id: &str) -> Option<StoredInventory> {
    let conn = crate::db::connect().await.ok()?;
    let mut rows = conn
        .query(
            "SELECT version, updated_at, backpack_json, hotbar_json, hotbar_active, held_id \
             FROM player_inventory WHERE user_id = ?1",
            [user_id],
        )
        .await
        .ok()?;
    let row = rows.next().await.ok()??;
    let version: i64 = row.get(0).ok()?;
    if version != STORE_VERSION {
        return None;
    }
    let updated_at: i64 = row.get(1).ok()?;
    let backpack_json: String = row.get(2).ok()?;
    let hotbar_json: String = row.get(3).ok()?;
    let hotbar_active: i64 = row.get(4).ok()?;
    let held_id: String = row.get(5).ok()?;
    Some(StoredInventory {
        updated_at,
        backpack: sanitize_slots(&backpack_json, BACKPACK_SLOTS),
        hotbar: sanitize_slots(&hotbar_json, HOTBAR_SLOTS),
        hotbar_active: hotbar_active as i32,
        held_id,
    })
}

async fn write_inventory(
    user_id: &str,
    stored: &StoredInventory,
) -> std::result::Result<(), String> {
    let conn = crate::db::connect().await?;
    conn.execute(
        "INSERT INTO player_inventory \
           (user_id, version, updated_at, backpack_json, hotbar_json, hotbar_active, held_id) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(user_id) DO UPDATE SET \
           version = excluded.version, \
           updated_at = excluded.updated_at, \
           backpack_json = excluded.backpack_json, \
           hotbar_json = excluded.hotbar_json, \
           hotbar_active = excluded.hotbar_active, \
           held_id = excluded.held_id",
        libsql::params![
            user_id.to_string(),
            STORE_VERSION,
            stored.updated_at,
            slots_json(&stored.backpack),
            slots_json(&stored.hotbar),
            stored.hotbar_active as i64,
            stored.held_id.clone(),
        ],
    )
    .await
    .map_err(|e| format!("save failed: {e}"))?;
    Ok(())
}

/// Returns `{ "found": false }` for logged-out visitors or first-time players
/// (client keeps its SSR-rendered starter stash), or the saved
/// backpack/hotbar otherwise.
#[server]
pub async fn load_player_inventory(req: &FlowRequest) -> Result<Value> {
    let Some(user_id) = req.user_id() else {
        return Ok(json!({ "found": false }));
    };
    match read_inventory(user_id).await {
        Some(stored) => Ok(json!({
            "found": true,
            "backpackJson": slots_json(&stored.backpack),
            "hotbarJson": slots_json(&stored.hotbar),
            "activeSlot": stored.hotbar_active,
            "heldId": stored.held_id,
        })),
        None => Ok(json!({ "found": false })),
    }
}

#[server]
pub async fn save_player_inventory(
    backpack_json: String,
    hotbar_json: String,
    hotbar_active: i32,
    held_id: String,
    req: &FlowRequest,
) -> Result<Value> {
    let Some(user_id) = req.user_id() else {
        return Err(ResumaError::Unauthorized);
    };
    let backpack = sanitize_slots(&backpack_json, BACKPACK_SLOTS);
    let hotbar = sanitize_slots(&hotbar_json, HOTBAR_SLOTS);
    let held_id = if item_def(&held_id).is_some() {
        held_id
    } else {
        String::new()
    };
    let stored = StoredInventory {
        updated_at: crate::db::now_epoch_ms(),
        backpack,
        hotbar,
        hotbar_active: hotbar_active.clamp(0, HOTBAR_SLOTS as i32 - 1),
        held_id,
    };
    write_inventory(user_id, &stored)
        .await
        .map_err(ResumaError::Validation)?;
    Ok(json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::with_temp_db;

    #[test]
    fn sanitize_slots_drops_unknown_ids_and_clamps_qty() {
        let raw = r#"[{"id":"wood","qty":999999999},{"id":"totally_fake_item","qty":5},null]"#;
        let slots = sanitize_slots(raw, 3);
        assert_eq!(slots[0].as_ref().unwrap().id, "wood");
        assert_eq!(slots[0].as_ref().unwrap().qty, crate::inventory::STACK_SIZE);
        assert!(slots[1].is_none());
        assert!(slots[2].is_none());
    }

    #[test]
    fn sanitize_slots_drops_zero_or_negative_qty() {
        let raw = r#"[{"id":"wood","qty":0},{"id":"stone","qty":-5}]"#;
        let slots = sanitize_slots(raw, 2);
        assert!(slots.iter().all(Option::is_none));
    }

    /// `player_inventory.user_id` has a `REFERENCES users(id)` foreign key
    /// (real save/load calls only ever see ids from a verified session), so
    /// tests need a real registered account rather than a made-up id.
    async fn register_test_user(tag: &str) -> String {
        let raw = format!("pi{tag}{}", uuid::Uuid::new_v4().simple());
        let username = &raw[..20];
        crate::auth::register(username, "correcthorsebattery")
            .await
            .unwrap()
            .id
    }

    #[tokio::test]
    async fn round_trips_saved_inventory_through_db() {
        with_temp_db(|| async {
            let user_id = register_test_user("a").await;

            assert!(read_inventory(&user_id).await.is_none());

            let stored = StoredInventory {
                updated_at: crate::db::now_epoch_ms(),
                backpack: sanitize_slots(r#"[{"id":"wood","qty":50}]"#, BACKPACK_SLOTS),
                hotbar: sanitize_slots(r#"[{"id":"hatchet_tool","qty":1}]"#, HOTBAR_SLOTS),
                hotbar_active: 2,
                held_id: "hatchet_tool".to_string(),
            };
            write_inventory(&user_id, &stored).await.unwrap();

            let loaded = read_inventory(&user_id)
                .await
                .expect("saved inventory present");
            assert_eq!(loaded.hotbar_active, 2);
            assert_eq!(loaded.backpack[0].as_ref().unwrap().id, "wood");
            assert_eq!(loaded.backpack[0].as_ref().unwrap().qty, 50);

            // A second save for the same user overwrites in place (ON CONFLICT),
            // it doesn't accumulate rows.
            let stored2 = StoredInventory {
                updated_at: crate::db::now_epoch_ms(),
                backpack: sanitize_slots(r#"[{"id":"stone","qty":10}]"#, BACKPACK_SLOTS),
                hotbar: sanitize_slots("[]", HOTBAR_SLOTS),
                hotbar_active: 0,
                held_id: String::new(),
            };
            write_inventory(&user_id, &stored2).await.unwrap();
            let reloaded = read_inventory(&user_id).await.unwrap();
            assert_eq!(reloaded.backpack[0].as_ref().unwrap().id, "stone");
        })
        .await;
    }

    #[tokio::test]
    async fn different_users_have_independent_inventories() {
        with_temp_db(|| async {
            let a = register_test_user("b").await;
            let b = register_test_user("c").await;
            write_inventory(
                &a,
                &StoredInventory {
                    updated_at: crate::db::now_epoch_ms(),
                    backpack: sanitize_slots(r#"[{"id":"wood","qty":5}]"#, BACKPACK_SLOTS),
                    hotbar: sanitize_slots("[]", HOTBAR_SLOTS),
                    hotbar_active: 0,
                    held_id: String::new(),
                },
            )
            .await
            .unwrap();

            assert!(read_inventory(&b).await.is_none());
            let loaded_a = read_inventory(&a).await.unwrap();
            assert_eq!(loaded_a.backpack[0].as_ref().unwrap().id, "wood");
        })
        .await;
    }
}
