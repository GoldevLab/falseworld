//! Turso (libSQL) connection + schema — the database Resuma's own docs
//! recommend for new apps (`file:` locally, a real Turso replica in prod,
//! same SQL both ways): <https://resuma-docs.fly.dev/docs/integrations/turso>.
//!
//! Backs `auth.rs` (`users`/`sessions`) and, now that accounts exist,
//! `player_inventory.rs` (moved off one-JSON-file-per-player — see that
//! module's doc comment for why).
//!
//! One [`Database`] handle per *URL* for the process's lifetime (cheap to
//! hand out [`Connection`]s from — libSQL is designed for many short-lived
//! `Connection`s off one shared `Database`, not for pooling yourself),
//! re-resolving `TURSO_DATABASE_URL` on every [`connect`] call so tests can
//! each point at their own temp file without fighting a single
//! initialize-once global (the common single-URL production case still only
//! builds the `Database` once).

use libsql::{Builder, Connection, Database};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

static DB_CACHE: Lazy<RwLock<HashMap<String, Arc<Database>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

fn database_url() -> String {
    std::env::var("TURSO_DATABASE_URL").unwrap_or_else(|_| "file:data/falseworld.db".into())
}

async fn build_database(url: &str) -> Result<Database, String> {
    if let Some(path) = url.strip_prefix("file:") {
        if let Some(parent) = std::path::Path::new(path).parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        Builder::new_local(path)
            .build()
            .await
            .map_err(|e| format!("failed to open local db {path:?}: {e}"))
    } else {
        let token = std::env::var("TURSO_AUTH_TOKEN").map_err(|_| {
            format!("TURSO_AUTH_TOKEN must be set for remote TURSO_DATABASE_URL={url}")
        })?;
        Builder::new_remote(url.to_string(), token)
            .build()
            .await
            .map_err(|e| format!("failed to open remote db {url}: {e}"))
    }
}

async fn database_for(url: &str) -> Result<Arc<Database>, String> {
    if let Some(db) = DB_CACHE.read().await.get(url) {
        return Ok(db.clone());
    }
    let mut cache = DB_CACHE.write().await;
    if let Some(db) = cache.get(url) {
        return Ok(db.clone());
    }
    let db = Arc::new(build_database(url).await?);
    cache.insert(url.to_string(), db.clone());
    Ok(db)
}

/// A connection handle — cheap; see module docs for the caching strategy.
pub async fn connect() -> Result<Connection, String> {
    let url = database_url();
    database_for(&url)
        .await?
        .connect()
        .map_err(|e| format!("failed to open connection: {e}"))
}

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
CREATE TABLE IF NOT EXISTS player_inventory (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  backpack_json TEXT NOT NULL,
  hotbar_json TEXT NOT NULL,
  hotbar_active INTEGER NOT NULL,
  held_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS player_position (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  yaw REAL NOT NULL
);
"#;

/// Creates tables if missing — safe to call on every boot (`main.rs`).
pub async fn init_schema() -> Result<(), String> {
    let conn = connect().await?;
    conn.execute_batch(SCHEMA_SQL)
        .await
        .map_err(|e| format!("schema init failed: {e}"))?;
    Ok(())
}

/// Epoch milliseconds — shared by `auth.rs` and `player_inventory.rs` so
/// `sessions.expires_at`/`*.updated_at` use one clock convention.
pub fn now_epoch_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

/// Test-only helper shared by `auth.rs` and `player_inventory.rs`: points
/// `TURSO_DATABASE_URL` at a fresh temp file, initializes the schema, runs
/// `f`, then cleans up.
///
/// `TURSO_DATABASE_URL` is process-wide and `cargo test` runs `#[tokio::test]`
/// functions concurrently by default (each on its own current-thread
/// runtime) — the shared lock here (not one per test module) is what keeps
/// every test across both files from racing on that one env var. Held across
/// `.await` on purpose: safe because each test owns its runtime/thread
/// outright, so there's nothing else on it to starve.
#[cfg(test)]
pub mod test_support {
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    pub async fn with_temp_db<F, Fut>(f: F)
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let dir = std::env::temp_dir().join(format!(
            "falseworld-db-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var(
            "TURSO_DATABASE_URL",
            format!("file:{}", dir.join("test.db").display()),
        );
        super::init_schema().await.expect("schema init");
        f().await;
        std::env::remove_var("TURSO_DATABASE_URL");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
