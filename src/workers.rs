//! Meadow chunk workers — Resuma OS artifacts.

use falseworld_core::{decode_chunk, encode_chunk, generate_chunk, ChunkRequest, SurfaceChunk, CONTENT_TYPE};
use resuma::prelude::*;
use resuma::{worker, FlowEngine, GraphId, WorkerContext};
use resuma::exec::GraphStatus;
use serde_json::{json, Value};

#[worker(intent = "bake falseworld meadow chunk (FBM + grass)", resources = "none")]
pub async fn generate_falseworld_chunk(
    input: ChunkRequest,
    ctx: WorkerContext,
) -> Result<Value> {
    ctx.check_cancelled()?;
    ctx.log("chunk bake started");
    let chunk = ctx
        .run_blocking_with_progress(move |p| generate_chunk(&input, &|pct| p(pct)))
        .await?;
    ctx.check_cancelled()?;
    let bytes = encode_chunk(&chunk).map_err(|e| ResumaError::Validation(e))?;
    ctx.progress(99);
    let art = ctx.artifact_put(bytes, CONTENT_TYPE)?;
    Ok(json!({
        "artifact_id": art.id,
        "bytes": art.bytes,
        "blades": chunk.blades.len(),
        "height_res": chunk.height_res,
        "content_type": CONTENT_TYPE,
    }))
}

pub async fn start_chunk(input: ChunkRequest) -> Result<Value> {
    let value = serde_json::to_value(&input)
        .map_err(|e| ResumaError::Validation(format!("chunk input: {e}")))?;
    let started = FlowEngine::start("generate_falseworld_chunk", value).await?;
    Ok(json!({
        "graph_id": started.graph_id.0,
        "access_token": started.access_token.unwrap_or_default(),
    }))
}

pub fn cancel_chunk(graph_id: &str) -> Result<Value> {
    let gid = GraphId(graph_id.to_string());
    match FlowEngine::cancel(&gid) {
        Ok(()) => Ok(json!({ "ok": true })),
        Err(ResumaError::UnknownGraph(_)) => Ok(json!({ "ok": true, "found": false })),
        Err(e) => Err(e),
    }
}

pub fn claim_chunk(graph_id: &str) -> Result<SurfaceChunk> {
    let gid = GraphId(graph_id.to_string());
    let snap = FlowEngine::snapshot(&gid)
        .ok_or_else(|| ResumaError::UnknownGraph(gid.0.clone()))?;
    match snap.status {
        GraphStatus::Done => {}
        GraphStatus::Failed => {
            return Err(ResumaError::Validation("chunk failed".into()));
        }
        other => {
            return Err(ResumaError::Validation(format!("not done ({other:?})")));
        }
    }
    let artifact_id = FlowEngine::last_artifact(&gid)
        .ok_or_else(|| ResumaError::Validation("no artifact".into()))?;
    let (bytes, ctype, _) = resuma::artifact_get(&artifact_id)
        .ok_or_else(|| ResumaError::Validation("artifact missing".into()))?;
    if ctype.contains("falseworld") || bytes.starts_with(b"FWCH") {
        decode_chunk(bytes.as_ref()).map_err(ResumaError::Validation)
    } else {
        serde_json::from_slice(bytes.as_ref())
            .map_err(|e| ResumaError::Validation(format!("json: {e}")))
    }
}
