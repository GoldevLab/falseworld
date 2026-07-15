//! False World — Resuma + WebGPU meadow (False Earth–inspired).

mod pages;
mod workers;

use pages::PagesRegistry;
use resuma::prelude::*;
use serde_json::Value;

const CSS: &str = concat!(
    r#"<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>"#,
    include_str!("../static/styles.css"),
    "</style>"
);

#[server]
async fn start_meadow_chunk(
    seed: u32,
    origin_x: f32,
    origin_z: f32,
    area: f32,
    blades: u32,
    height_res: u32,
) -> Result<Value> {
    workers::start_chunk(falseworld_core::ChunkRequest {
        seed,
        origin_x,
        origin_z,
        area,
        height_res,
        blades_per_axis: blades,
        terrain_amp: 2.4,
        terrain_freq: 0.045,
    })
    .await
}

#[server]
async fn claim_meadow_chunk(graph_id: String) -> Result<Value> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let chunk = workers::claim_chunk(&graph_id)?;
    let bytes = falseworld_core::encode_chunk(&chunk)
        .map_err(|e| ResumaError::Validation(e))?;
    Ok(serde_json::json!({
        "fwch_b64": STANDARD.encode(&bytes),
        "blades": chunk.blades.len(),
        "height_res": chunk.height_res,
        "origin_x": chunk.origin_x,
        "origin_z": chunk.origin_z,
        "area": chunk.area,
        "seed": chunk.seed,
    }))
}

#[server]
async fn cancel_meadow_chunk(graph_id: String) -> Result<Value> {
    workers::cancel_chunk(&graph_id)
}

#[layout("/")]
fn RootLayout() -> View {
    view! {
        <div class="shell">
            <header class="top">
                <a class="brand" href="/">"FALSE"<span>"WORLD"</span></a>
                <nav>
                    <NavLink href="/" activeClass="active">"Meadow"</NavLink>
                    <NavLink href="/about" activeClass="active">"About"</NavLink>
                </nav>
            </header>
            <Slot />
        </div>
    }
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    FlowApp::new()
        .with_title("False World — Resuma meadow")
        .with_description(
            "Procedural meadow on Resuma workers + WebGPU. Inspired by False Earth (Ming-Jyun Hung); original Rust/WGSL stack.",
        )
        .with_head(CSS)
        .client_asset(
            "falseworld-gpu",
            include_bytes!("../static/client/falseworld-gpu.js"),
        )
        .without_pwa()
        .not_found(|| not_found_page())
        .auto_pages(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/pages"),
            PagesRegistry,
        )
        .serve(FlowServeOptions::from_env().with_webgpu_csp())
        .await
}
