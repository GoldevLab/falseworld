//! Real accounts + persistent sessions (Turso/libSQL — `db.rs`) so player
//! data survives more than a browser tab.
//!
//! Before this module, "who is this player" was a `crypto.randomUUID()`
//! stamped into `sessionStorage` client-side (`fw-multiplayer.js::loadGuest`,
//! new per tab) with a display name in `localStorage` — anyone could pass any
//! string as `player_id` to `load_player_inventory`/`save_player_inventory`
//! and read or overwrite someone else's stash. Login now gives every player
//! a stable, server-verified identity: `player_inventory.rs` keys saves off
//! `req.user_id()` (set by [`attach_session`] below from a signed session
//! cookie), never a client-supplied id.
//!
//! Passwords are hashed with Argon2id (OWASP's current recommendation, and
//! what `password-hash`/`argon2` — already a transitive dep via `resuma`'s
//! `hmac`/`sha2` stack — implement natively in Rust, no external `libpq`-style
//! C auth library to babysit).

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use resuma::prelude::*;
use serde::{Deserialize, Serialize};

/// `Set-Cookie` name for the session token. HttpOnly + `SameSite=Lax` via
/// `Redirect::with_session_cookie` — never touched from JS.
pub const SESSION_COOKIE: &str = "fw_session";
const SESSION_TTL_SECS: i64 = 60 * 60 * 24 * 30; // 30 days

const USERNAME_MIN: usize = 3;
const USERNAME_MAX: usize = 24;
const PASSWORD_MIN: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthUser {
    pub id: String,
    pub username: String,
}

fn sanitize_username(raw: &str) -> Option<String> {
    let t: String = raw
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(USERNAME_MAX)
        .collect();
    if t.len() >= USERNAME_MIN {
        Some(t)
    } else {
        None
    }
}

fn hash_password(password: &str) -> std::result::Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("password hashing failed: {e}"))
}

fn verify_password(hash: &str, password: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

async fn find_user_by_username(
    username: &str,
) -> std::result::Result<Option<(String, String, String)>, String> {
    let conn = crate::db::connect().await?;
    let mut rows = conn
        .query(
            "SELECT id, username, password_hash FROM users WHERE username = ?1",
            [username],
        )
        .await
        .map_err(|e| e.to_string())?;
    let Some(row) = rows.next().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let id: String = row.get(0).map_err(|e| e.to_string())?;
    let uname: String = row.get(1).map_err(|e| e.to_string())?;
    let hash: String = row.get(2).map_err(|e| e.to_string())?;
    Ok(Some((id, uname, hash)))
}

/// Creates a new account. Fails on a taken username (case-sensitive; the
/// column is `UNIQUE` so a race loses to the DB constraint, not a TOCTOU bug).
pub async fn register(username: &str, password: &str) -> std::result::Result<AuthUser, String> {
    let username = sanitize_username(username).ok_or_else(|| {
        format!("el usuario debe tener entre {USERNAME_MIN} y {USERNAME_MAX} caracteres alfanuméricos")
    })?;
    if password.chars().count() < PASSWORD_MIN {
        return Err(format!(
            "la contraseña debe tener al menos {PASSWORD_MIN} caracteres"
        ));
    }
    if find_user_by_username(&username).await?.is_some() {
        return Err("ese usuario ya existe".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let hash = hash_password(password)?;
    let conn = crate::db::connect().await?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
        libsql::params![id.clone(), username.clone(), hash, crate::db::now_epoch_ms()],
    )
    .await
    .map_err(|e| {
        if e.to_string().to_ascii_lowercase().contains("unique") {
            "ese usuario ya existe".to_string()
        } else {
            format!("no se pudo crear la cuenta: {e}")
        }
    })?;
    Ok(AuthUser { id, username })
}

/// Verifies credentials. Deliberately returns the same generic error for
/// "no such user" and "wrong password" — don't leak which one it was.
pub async fn login(username: &str, password: &str) -> std::result::Result<AuthUser, String> {
    const BAD_CREDENTIALS: &str = "usuario o contraseña incorrectos";
    let username = sanitize_username(username).ok_or(BAD_CREDENTIALS)?;
    let Some((id, uname, hash)) = find_user_by_username(&username).await? else {
        return Err(BAD_CREDENTIALS.into());
    };
    if !verify_password(&hash, password) {
        return Err(BAD_CREDENTIALS.into());
    }
    Ok(AuthUser { id, username: uname })
}

/// Issues a new session token, persisted in `sessions` (survives a server
/// restart/redeploy — unlike an in-memory session map).
pub async fn create_session(user_id: &str) -> std::result::Result<String, String> {
    // Two concatenated v4 UUIDs = 256 bits from the OS CSRNG; plenty for a
    // bearer token, no extra crate needed for "N random bytes, hex encoded".
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let now = crate::db::now_epoch_ms();
    let expires = now + SESSION_TTL_SECS * 1000;
    let conn = crate::db::connect().await?;
    conn.execute(
        "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
        libsql::params![token.clone(), user_id.to_string(), now, expires],
    )
    .await
    .map_err(|e| format!("no se pudo crear la sesión: {e}"))?;
    Ok(token)
}

/// Looks up a session token, `None` if missing/expired. Doesn't prune expired
/// rows itself — cheap enough to leave for a future `resuma::worker` cron
/// (`DELETE FROM sessions WHERE expires_at < ?`) rather than doing it inline
/// on every request.
pub async fn verify_session(token: &str) -> Option<AuthUser> {
    let conn = crate::db::connect().await.ok()?;
    let mut rows = conn
        .query(
            "SELECT users.id, users.username, sessions.expires_at \
             FROM sessions JOIN users ON users.id = sessions.user_id \
             WHERE sessions.token = ?1",
            [token],
        )
        .await
        .ok()?;
    let row = rows.next().await.ok()??;
    let id: String = row.get(0).ok()?;
    let username: String = row.get(1).ok()?;
    let expires_at: i64 = row.get(2).ok()?;
    if expires_at < crate::db::now_epoch_ms() {
        return None;
    }
    Some(AuthUser { id, username })
}

pub async fn delete_session(token: &str) -> std::result::Result<(), String> {
    let conn = crate::db::connect().await?;
    conn.execute("DELETE FROM sessions WHERE token = ?1", [token])
        .await
        .map_err(|e| format!("no se pudo cerrar la sesión: {e}"))?;
    Ok(())
}

/// Attaches `authenticated`/`user_id`/`username` extensions from the session
/// cookie (same pattern as the Resuma docs' auth guide), then gates the main
/// game page: `/` requires a session, everything else (login/register pages,
/// `/about`, `/_resuma/action/*`, the multiplayer websocket, static assets —
/// none of which carry `req.path == "/"`) is untouched. `ResumaError::Redirect`
/// is what turns that into a real `302 /login`, not a 401 error page — see
/// `resuma::core::ResumaError::Redirect` (added alongside this module; Resuma
/// had no supported way to bounce an unauthenticated page GET to a login
/// route before).
#[middleware]
async fn attach_session(mut req: FlowRequest) -> resuma::Result<FlowRequest> {
    if let Some(token) = req
        .header("cookie")
        .and_then(|c| cookie_value(c, SESSION_COOKIE))
    {
        if let Some(user) = verify_session(&token).await {
            req.set_extension("authenticated", serde_json::json!(true));
            req.set_extension("user_id", serde_json::json!(user.id));
            req.set_extension("username", serde_json::json!(user.username));
        }
    }
    if req.path == "/" && !req.is_authenticated() {
        return Err(ResumaError::Redirect("/login".into()));
    }
    Ok(req)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginForm {
    pub username: String,
    pub password: String,
}

#[submit]
pub async fn login_submit(form: LoginForm) -> std::result::Result<Redirect, SubmitError> {
    // `.field("password", ..)` — not `SubmitError::new(msg)` alone — because the
    // client runtime (`runtime/src/core.ts::showFieldErrors`) only inserts a
    // visible `.resuma-field-error` next to a named input; a message with an
    // empty `field_errors` map is silently dropped to `console.error` and the
    // login card just looks unresponsive. `login()` already returns one
    // generic "usuario o contraseña incorrectos" for both bad cases (don't
    // leak which), so it's pinned under the password field either way.
    let user = login(&form.username, &form.password)
        .await
        .map_err(|msg| SubmitError::new(msg.clone()).field("password", msg))?;
    let token = create_session(&user.id)
        .await
        .map_err(|msg| SubmitError::new(msg.clone()).field("password", msg))?;
    Ok(Redirect::to("/").with_session_cookie(SESSION_COOKIE, &token, SESSION_TTL_SECS))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterForm {
    pub username: String,
    pub password: String,
}

#[submit]
pub async fn register_submit(form: RegisterForm) -> std::result::Result<Redirect, SubmitError> {
    let user = register(&form.username, &form.password)
        .await
        .map_err(|msg| {
            // `register()`'s errors are all username-shaped ("ya existe", the
            // length rule, …) except the password-length one — route by
            // content so the `.resuma-field-error` lands under the right
            // input instead of always the username field.
            if msg.contains("contraseña") {
                SubmitError::new(msg.clone()).field("password", msg)
            } else {
                SubmitError::new(msg.clone()).field("username", msg)
            }
        })?;
    let token = create_session(&user.id)
        .await
        .map_err(|msg| SubmitError::new(msg.clone()).field("username", msg))?;
    Ok(Redirect::to("/").with_session_cookie(SESSION_COOKIE, &token, SESSION_TTL_SECS))
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LogoutForm {}

#[submit]
pub async fn logout_submit(
    _form: LogoutForm,
    req: &FlowRequest,
) -> std::result::Result<Redirect, SubmitError> {
    if let Some(token) = req
        .header("cookie")
        .and_then(|c| cookie_value(c, SESSION_COOKIE))
    {
        let _ = delete_session(&token).await;
    }
    Ok(Redirect::to("/login").clear_cookie(SESSION_COOKIE))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_username(tag: &str) -> String {
        format!(
            "t{tag}{}{}",
            std::process::id(),
            uuid::Uuid::new_v4().simple()
        )[..USERNAME_MAX.min(20)]
            .to_string()
    }

    use crate::db::test_support::with_temp_db;

    #[tokio::test]
    async fn register_then_login_round_trips() {
        with_temp_db(|| async {
            let username = unique_username("a");
            let user = register(&username, "correcthorsebattery").await.unwrap();
            assert_eq!(user.username, username);

            let logged_in = login(&username, "correcthorsebattery").await.unwrap();
            assert_eq!(logged_in.id, user.id);

            assert!(login(&username, "wrongpassword").await.is_err());
            assert!(login("nobody-such-user", "whatever1").await.is_err());
        })
        .await;
    }

    #[tokio::test]
    async fn register_rejects_duplicate_username() {
        with_temp_db(|| async {
            let username = unique_username("b");
            register(&username, "correcthorsebattery").await.unwrap();
            let err = register(&username, "anotherpassword").await.unwrap_err();
            assert!(err.contains("ya existe"), "unexpected error: {err}");
        })
        .await;
    }

    #[tokio::test]
    async fn register_rejects_short_password_and_username() {
        with_temp_db(|| async {
            assert!(register("ab", "correcthorsebattery").await.is_err());
            let username = unique_username("c");
            assert!(register(&username, "short").await.is_err());
        })
        .await;
    }

    #[tokio::test]
    async fn session_round_trips_and_logout_invalidates_it() {
        with_temp_db(|| async {
            let username = unique_username("d");
            let user = register(&username, "correcthorsebattery").await.unwrap();
            let token = create_session(&user.id).await.unwrap();

            let verified = verify_session(&token).await.expect("session should verify");
            assert_eq!(verified.id, user.id);

            delete_session(&token).await.unwrap();
            assert!(verify_session(&token).await.is_none());
        })
        .await;
    }

    #[test]
    fn password_hash_round_trips_and_rejects_wrong_password() {
        let hash = hash_password("correcthorsebattery").unwrap();
        assert!(verify_password(&hash, "correcthorsebattery"));
        assert!(!verify_password(&hash, "wrong"));
    }
}
