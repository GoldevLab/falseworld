//! False World — Resuma + WebGPU meadow (False Earth–inspired).

use pages::PagesRegistry;
use resuma::prelude::*;
use serde_json::Value;

mod auth;
mod db;
mod explosives;
mod inventory;
mod multiplayer;
mod pages;
mod player_inventory;
mod player_position;
mod tool_transforms;
mod workers;

const CSS: &str = concat!(
    r#"<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="/boot-meadow.png" as="image" fetchpriority="high">
<link href="https://fonts.googleapis.com/css2?family=Oxanium:wght@500;600;700;800&family=Syne:wght@600;700;800&family=Space+Grotesk:wght@500;700&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;700&display=swap" rel="stylesheet">
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
    let req = current_request();
    let authed = req.as_ref().is_some_and(|r| r.is_authenticated());
    let username = req
        .as_ref()
        .and_then(|r| r.extension("username"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_default();

    // Plain `if`/`else` rather than `<Show when={..}>` — auth state is fixed
    // for the whole SSR render of this layout (no client-side reactivity
    // needed here), and `Show`'s `when` wants a `Signal<bool>`/`Computed<bool>`
    // (`ReactiveBool`), not a plain `bool`.
    let nav_auth = if authed {
        view! {
            <>
                <span class="fw-user">{username.clone()}</span>
                <Form submit={crate::auth::logout_submit}>
                    <button type="submit" class="fw-logout">"Salir"</button>
                </Form>
            </>
        }
    } else {
        view! { <NavLink href="/login" activeClass="active">"Entrar"</NavLink> }
    };

    view! {
        <div class="shell">
            <header class="top">
                <a class="brand" href="/">"FALSE"<span>"WORLD"</span></a>
                <nav>
                    <NavLink href="/" activeClass="active">"Meadow"</NavLink>
                    <NavLink href="/about" activeClass="active">"About"</NavLink>
                    {nav_auth}
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

    tool_transforms::init(&public_dir);

    // Turso/libSQL (`db.rs`) backs accounts, sessions, inventory, and pose —
    // create tables on boot so a fresh `file:data/falseworld.db` (or a brand
    // new Turso database in prod) is ready before the first request.
    if let Err(e) = db::init_schema().await {
        panic!("failed to initialize database schema: {e}");
    }

    FlowApp::new()
        .with_title("False World — Resuma meadow + VRM")
        .with_description(
            "Procedural meadow on Resuma workers + WebGPU, VRM avatar overlay (VRMedia stack). Inspired by False Earth; original meadow code.",
        )
        .with_head(CSS)
        .route("/_fw/mp/ws", multiplayer::ws_route())
        .route("/_fw/tool-transforms", tool_transforms::route())
        // Stable ids: `client_asset` records a SHA-256 content digest and
        // `client_script_url`/`ClientComponent` emit `?v=<hash>`, so browsers
        // keep `Cache-Control: immutable` correct without manual vN renames
        // (see resuma CHANGELOG `[Unreleased]` — Client asset cache busting).
        .client_asset(
            "fw-item-icons",
            include_bytes!("../static/client/fw-item-icons.js"),
        )
        .client_asset(
            "fw-inventory",
            include_bytes!("../static/client/fw-inventory.js"),
        )
        .client_asset(
            "fw-explosives",
            include_bytes!("../static/client/fw-explosives.js"),
        )
        .client_asset(
            "fw-progression",
            include_bytes!("../static/client/fw-progression.js"),
        )
        .client_asset(
            "fw-multiplayer",
            include_bytes!("../static/client/fw-multiplayer.js"),
        )
        .client_asset(
            "fw-meadow-gpu",
            include_bytes!("../static/client/fw-meadow-gpu.js"),
        )
        .client_asset(
            "fw-meadow-vrm",
            include_bytes!("../static/client/fw-meadow-vrm.js"),
        )
        .with_public_dir(public_dir)
        .without_pwa()
        .not_found(|| not_found_page())
        .auto_pages(pages_dir, PagesRegistry)
        .serve(opts)
        .await
}
