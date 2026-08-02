//! Persist held-tool F7 transforms to disk so they survive server restarts.

use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, MethodRouter};
use axum::Json;
use once_cell::sync::OnceCell;
use serde_json::Value;
use std::path::PathBuf;

static TOOL_PATH: OnceCell<PathBuf> = OnceCell::new();

pub fn init(public_dir: &std::path::Path) {
    let path = public_dir.join("config").join("held_tool_transforms.json");
    let _ = TOOL_PATH.set(path);
}

fn transforms_path() -> PathBuf {
    TOOL_PATH
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("public/config/held_tool_transforms.json"))
}

fn empty_transforms() -> Value {
    serde_json::json!({
        "axe": null,
        "pickaxe": null,
        "hammer": null,
    })
}

async fn get_transforms() -> impl IntoResponse {
    let path = transforms_path();
    match tokio::fs::read_to_string(&path).await {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err(_) => (StatusCode::OK, Json(empty_transforms())).into_response(),
        },
        Err(_) => (StatusCode::OK, Json(empty_transforms())).into_response(),
    }
}

async fn post_transforms(Json(body): Json<Value>) -> impl IntoResponse {
    if !body.is_object() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": "object required" })),
        )
            .into_response();
    }
    let pretty = match serde_json::to_string_pretty(&body) {
        Ok(s) => s,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
            )
                .into_response();
        }
    };
    let path = transforms_path();
    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
            )
                .into_response();
        }
    }
    match tokio::fs::write(&path, pretty).await {
        Ok(()) => (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": true, "path": path.display().to_string() })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "ok": false, "error": e.to_string() })),
        )
            .into_response(),
    }
}

/// Axum method router for `GET|POST /_fw/tool-transforms`
pub fn route() -> MethodRouter {
    get(get_transforms).post(post_transforms)
}
