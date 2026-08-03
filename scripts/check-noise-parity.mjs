// Cross-language parity check for the island coastline noise.
//
// `coast_radius`/`island_edge` are meant to be *exactly* the same function in
// four places: `crates/falseworld-core/src/biome.rs` (server/worker terrain +
// gameplay authority), `static/client/src/fw-meadow-gpu/entry.js` (client
// build-placement gating), and two WGSL copies (`scene.wgsl` + `ocean.wgsl` /
// `ocean-floor.wgsl`, visuals only). They're seed-independent — every world
// has the same island silhouette — so unlike biome noise (which *does* still
// diverge between Rust's PCG-based `biome_at` and WGSL/JS's simpler
// `biome_hash21`, a known, documented gap — see ROADMAP.md) there's no excuse
// for these to disagree: a mismatch here means the client lets you build
// where the server thinks is open water, or the beach visually clips through
// a "solid" collision edge.
//
// This script asks Rust for ground-truth values over a grid (via the
// `dump_coast_grid` example) and re-derives the same grid using a hand-ported
// JS copy of the formula (kept in this file, not imported from `entry.js`,
// so this test still catches a divergence even if someone edits `entry.js`'s
// copy without noticing this one — the two are independent transcriptions of
// the same spec, which is the point of a cross-reference test).
//
// Run: `node scripts/check-noise-parity.mjs` (also wired into CI).
import { execFileSync } from "node:child_process";

const ISLAND_HALF = 256;

// Transcribed from `static/client/src/fw-meadow-gpu/entry.js` (`coastRadius`/
// `islandEdge`), which itself must match `biome.rs::coast_radius`/`island_edge`.
function hash21(ix, iz) {
  let n = (Math.imul(ix | 0, 1597334677) + Math.imul(iz | 0, 3812015801)) >>> 0;
  n = ((n << 13) ^ n) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return n / 4294967295;
}
function valueNoise(px, py) {
  const ix = Math.floor(px);
  const iz = Math.floor(py);
  const fx = px - ix;
  const fz = py - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash21(ix, iz);
  const b = hash21(ix + 1, iz);
  const c = hash21(ix, iz + 1);
  const d = hash21(ix + 1, iz + 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return (ab + (cd - ab) * uz) * 2 - 1;
}
function fbm(px, py) {
  let s = 0;
  let a = 1;
  let f = 1;
  let n = 0;
  for (let i = 0; i < 4; i++) {
    s += valueNoise(px * f, py * f) * a;
    n += a;
    a *= 0.5;
    f *= 2.02;
  }
  return s / Math.max(n, 1e-5);
}
function coastRadius(x, z) {
  const ang = Math.atan2(z, x);
  const lobes =
    Math.sin(ang * 2) * 0.085 +
    Math.sin(ang * 3 + 1.3) * 0.06 +
    Math.cos(ang * 5 + 0.7) * 0.045 +
    Math.sin(ang * 9 + 2.4) * 0.028 +
    Math.cos(ang * 14 - 0.9) * 0.018;
  const n = fbm(x / 480, z / 480);
  const n2 = fbm(x / 220 + 19, z / 220 - 11);
  const warp = Math.min(1.22, Math.max(0.68, 0.9 + lobes + n * 0.12 + n2 * 0.07));
  return ISLAND_HALF * warp;
}
function islandEdge(x, z) {
  const dist = Math.hypot(x, z);
  const rim = coastRadius(x, z);
  return Math.min(1, Math.max(0, (dist - rim * 0.72) / Math.max(rim * 0.34, 1)));
}

function dumpRustGrid() {
  const out = execFileSync(
    "cargo",
    ["run", "--quiet", "-p", "falseworld-core", "--example", "dump_coast_grid"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8" },
  );
  const lines = out.trim().split("\n");
  const header = lines.shift();
  if (header !== "x,z,coast_radius,island_edge") {
    throw new Error(`unexpected dump_coast_grid header: ${header}`);
  }
  return lines.map((line) => {
    const [x, z, r, e] = line.split(",").map(Number);
    return { x, z, r, e };
  });
}

const EPS_RADIUS = 1e-2; // world units, over a ~256-512 unit island
const EPS_EDGE = 1e-4; // island_edge is a clamped 0..1 ratio

function main() {
  const rows = dumpRustGrid();
  if (rows.length < 100) {
    throw new Error(`suspiciously few grid points from dump_coast_grid: ${rows.length}`);
  }
  let worstRadius = 0;
  let worstEdge = 0;
  let failures = 0;
  for (const { x, z, r, e } of rows) {
    const jsR = coastRadius(x, z);
    const jsE = islandEdge(x, z);
    const dR = Math.abs(jsR - r);
    const dE = Math.abs(jsE - e);
    worstRadius = Math.max(worstRadius, dR);
    worstEdge = Math.max(worstEdge, dE);
    if (dR > EPS_RADIUS || dE > EPS_EDGE) {
      failures++;
      if (failures <= 10) {
        console.error(
          `MISMATCH at (${x}, ${z}): rust coast_radius=${r} js=${jsR} (Δ${dR.toFixed(4)}); ` +
            `rust island_edge=${e} js=${jsE} (Δ${dE.toFixed(6)})`,
        );
      }
    }
  }
  console.log(
    `checked ${rows.length} points — worst |Δcoast_radius|=${worstRadius.toFixed(6)}, ` +
      `worst |Δisland_edge|=${worstEdge.toFixed(6)}`,
  );
  if (failures > 0) {
    console.error(
      `\n${failures}/${rows.length} points diverged beyond tolerance (±${EPS_RADIUS} world units / ±${EPS_EDGE} ratio).\n` +
        "Rust `biome.rs::coast_radius`/`island_edge` and this script's JS port have drifted — " +
        "check them against `entry.js::coastRadius`/`islandEdge` and the WGSL copies in " +
        "`scene.wgsl`/`ocean.wgsl`/`ocean-floor.wgsl` too.",
    );
    process.exit(1);
  }
  console.log("OK — Rust and JS coastline noise agree.");
}

main();
