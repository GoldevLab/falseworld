//! False World — Resuma + WebGPU meadow (False Earth–inspired).

use pages::PagesRegistry;
use resuma::prelude::*;
use serde_json::Value;

mod explosives;
mod inventory;
mod multiplayer;
mod pages;
mod workers;

const CSS: &str = concat!(
    r#"<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;700&display=swap" rel="stylesheet">
<script type="importmap">
{
  "imports": {
    "three": "/vendor/three/build/three.module.js",
    "three/addons/": "/vendor/three/examples/jsm/",
    "@pixiv/three-vrm": "/vendor/three-vrm.module.js"
  }
}
</script>
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
        terrain_amp: 1.15,
        terrain_freq: 0.026,
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
    let mut opts = FlowServeOptions::from_env().with_webgpu_csp();
    // GLTFLoader fetches VRM textures as blob: URLs — requires connect-src blob:
    if !opts
        .security
        .csp
        .connect_src
        .iter()
        .any(|s| s == "blob:")
    {
        opts.security.csp.connect_src.push("blob:".into());
    }

    // Local: CARGO_MANIFEST_DIR. Fly/Docker: RESUMA_PUBLIC_DIR / RESUMA_PAGES_ROOT.
    let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let public_dir = std::env::var_os("RESUMA_PUBLIC_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| manifest.join("public"));
    let pages_dir = std::env::var_os("RESUMA_PAGES_ROOT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| manifest.join("src/pages"));

    FlowApp::new()
        .with_title("False World — Resuma meadow + VRM")
        .with_description(
            "Procedural meadow on Resuma workers + WebGPU, VRM avatar overlay (VRMedia stack). Inspired by False Earth; original meadow code.",
        )
        .with_head(CSS)
        .route("/_fw/mp/ws", multiplayer::ws_route())
        // New ids bust Resuma's year-long immutable client cache
        .client_asset(
            "fw-item-icons-v5",
            include_bytes!("../static/client/fw-item-icons-v5.js"),
        )
        .client_asset(
            "fw-inventory-v3",
            include_bytes!("../static/client/fw-inventory-v3.js"),
        )
        .client_asset(
            "fw-explosives-v1",
            include_bytes!("../static/client/fw-explosives-v1.js"),
        )
        .client_asset(
            "fw-progression-v1",
            include_bytes!("../static/client/fw-progression-v1.js"),
        )
        .client_asset(
            "fw-multiplayer-v1",
            include_bytes!("../static/client/fw-multiplayer-v1.js"),
        )
        .client_asset(
            "fw-meadow-gpu-v217",
            include_bytes!("../static/client/fw-meadow-gpu-v217.js"),
        )
        .client_asset(
            "fw-meadow-vrm-v42",
            include_bytes!("../static/client/fw-meadow-vrm-v42.js"),
        )
        .with_public_dir(public_dir)
        .without_pwa()
        .not_found(|| not_found_page())
        .auto_pages(pages_dir, PagesRegistry)
        .serve(opts)
        .await
}
