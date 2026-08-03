//! Prints a CSV grid of `coast_radius`/`island_edge` reference values.
//!
//! This is the Rust side of the Rust↔JS noise-parity cross-check
//! (`falseworld/scripts/check-noise-parity.mjs`, see `ROADMAP.md` →
//! "Evitar divergencia Rust ↔ WGSL/JS"). `coast_radius`/`island_edge` are
//! deliberately seed-independent (same island silhouette for every world) and
//! are re-implemented by hand in three other places — WGSL (`scene.wgsl`,
//! `ocean.wgsl`, `ocean-floor.wgsl`) and JS (`entry.js::coastRadius`) — because
//! shaders can't call into this crate. If any of those copies drift from this
//! one, players could see a beach where the server thinks there's ocean (or
//! vice versa: `island_edge` gates both terrain carving in `terrain.rs` *and*
//! client-side build placement in `entry.js`).
//!
//! Run manually with `cargo run -p falseworld-core --example dump_coast_grid`.
use falseworld_core::{coast_radius, island_edge};

fn main() {
    println!("x,z,coast_radius,island_edge");
    // Step chosen to cover the full island (half-extent 256, warp up to
    // 1.22x) plus a margin into open ocean, at a resolution fine enough to
    // catch a wrong constant/typo without producing a huge fixture.
    let step = 24.0f32;
    let half = 340.0f32;
    let mut z = -half;
    while z <= half {
        let mut x = -half;
        while x <= half {
            let r = coast_radius(x, z);
            let e = island_edge(x, z);
            println!("{x},{z},{r},{e}");
            x += step;
        }
        z += step;
    }
}
