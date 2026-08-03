// One-shot migration script: pulls the embedded WGSL template-literal blocks
// out of the legacy monolithic `static/client/fw-meadow-gpu.js` into standalone
// `.wgsl` files under `static/client/src/fw-meadow-gpu/shaders/`, and writes
// the remaining JS as an ES module entry point that imports them (bundled
// back into the original file path by `npm run build:client`, see
// `scripts/build-client.mjs`). Kept around for reference / re-running if the
// legacy file is ever regenerated from a different source; not part of the
// normal build.
import fs from "node:fs";

const SRC = "static/client/fw-meadow-gpu.js";
const OUT_DIR = "static/client/src/fw-meadow-gpu";
const ENTRY_OUT = `${OUT_DIR}/entry.js`;

const shaders = [
  ["SCENE_WGSL", "scene.wgsl"],
  ["COMPUTE_WGSL", "compute.wgsl"],
  ["CULL_WGSL", "cull.wgsl"],
  ["OCEAN_SIM_WGSL", "ocean-sim.wgsl"],
  ["OCEAN_WGSL", "ocean.wgsl"],
  ["OCEAN_FLOOR_WGSL", "ocean-floor.wgsl"],
  ["SKY_WGSL", "sky.wgsl"],
  ["POST_WGSL", "post.wgsl"],
];

let src = fs.readFileSync(SRC, "utf8");

// Original file is a single top-level IIFE: `(function () { ... })();`.
// Bundling with esbuild's `format: "iife"` re-adds an equivalent wrapper, so
// module scope replaces it 1:1 — see build-client.mjs.
const iifeOpen = "(function () {\n";
const iifeClose = "\n})();\n";
if (!src.startsWith(src.slice(0, 0))) throw new Error("unreachable");
const openIdx = src.indexOf(iifeOpen);
const closeIdx = src.lastIndexOf(iifeClose);
if (openIdx < 0 || closeIdx < 0) {
  throw new Error("Could not find expected top-level IIFE wrapper");
}
const header = src.slice(0, openIdx);
const body = src.slice(openIdx + iifeOpen.length, closeIdx);

let rest = body;
const imports = [];
for (const [name, file] of shaders) {
  const marker = `  const ${name} = /* wgsl */ \``;
  const start = rest.indexOf(marker);
  if (start < 0) throw new Error(`marker not found for ${name}`);
  const bodyStart = start + marker.length;
  const end = rest.indexOf("`", bodyStart);
  if (end < 0) throw new Error(`closing backtick not found for ${name}`);
  // Every block ends with `` `;\n `` right after the closing backtick.
  const afterBacktick = rest.slice(end + 1, end + 3);
  if (afterBacktick !== ";\n") {
    throw new Error(`unexpected terminator after ${name}: ${JSON.stringify(afterBacktick)}`);
  }
  const shaderText = rest.slice(bodyStart, end);
  if (shaderText.includes("${")) {
    throw new Error(`${name} contains template interpolation, cannot extract as static text`);
  }
  fs.mkdirSync(OUT_DIR + "/shaders", { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/shaders/${file}`, shaderText, "utf8");
  imports.push(`import ${name} from "./shaders/${file}";`);
  rest = rest.slice(0, start) + rest.slice(end + 3);
}

const entry = `${header}${imports.join("\n")}\n${rest}`;
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(ENTRY_OUT, entry, "utf8");

console.log(`Extracted ${shaders.length} shaders to ${OUT_DIR}/shaders/`);
console.log(`Wrote entry module to ${ENTRY_OUT}`);
