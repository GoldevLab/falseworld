/**
 * Bake tool GLBs → readable inventory PNGs (unlit albedo + tight crop).
 * Usage: node tmp/bake-tool-icons.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const ICONS = path.join(PUBLIC, "icons");

const TOOLS = [
  // Diagonal ↗ with blade face toward camera
  { id: "hatchet_tool", glb: "/tools/axe.glb", prepare: "axe", euler: [0.25, 0.9, -1.05] },
  { id: "rock_tool", glb: "/tools/pickaxe.glb", prepare: "long", euler: [0.2, 1.2, 0.4] },
  { id: "hammer_tool", glb: "/tools/hammer.glb", prepare: "long", euler: [0.3, 0.7, 0.45] },
];

const RENDER = 768;
const OUT = 256;
const TARGET = 0.9;

function contentType(filePath) {
  if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".glb")) return "model/gltf-binary";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const filePath = path.join(PUBLIC, urlPath.replace(/^\//, "") || "index.html");
      if (!filePath.startsWith(PUBLIC)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        res.writeHead(200, { "Content-Type": contentType(filePath) });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const bakePageHtml = `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;background:transparent">
<canvas id="c" width="${RENDER}" height="${RENDER}"></canvas>
<script type="importmap">
{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Unlit albedo — inventory icons must stay readable at ~48px. */
function fixMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const srcList = Array.isArray(obj.material) ? obj.material : [obj.material];
    const next = srcList.map((src) => {
      const map = src.map || null;
      if (map) {
        if (map.colorSpace !== undefined) map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        map.needsUpdate = true;
      }
      // Prefer texture; slight warm tint if no map
      const mat = new THREE.MeshBasicMaterial({
        map,
        color: map ? 0xffffff : 0xc8b090,
        side: THREE.DoubleSide,
        transparent: !!src.transparent,
        opacity: src.opacity != null ? src.opacity : 1,
      });
      return mat;
    });
    obj.material = next.length === 1 ? next[0] : next;
    obj.frustumCulled = false;
  });
}

function prepareModel(model, mode) {
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.set(1, 1, 1);
  model.updateMatrixWorld(true);
  if (mode === "axe") {
    model.rotation.set(-Math.PI * 0.5, 0, 0);
  } else {
    const sizeA = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    if (sizeA.z >= sizeA.x && sizeA.z >= sizeA.y) model.rotation.x = -Math.PI * 0.5;
    else if (sizeA.x >= sizeA.y && sizeA.x >= sizeA.z) model.rotation.z = Math.PI * 0.5;
  }
  model.updateMatrixWorld(true);
  // Normalize to unit height so every tool frames the same
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z, 1e-6);
  model.scale.setScalar(1 / longest);
  model.updateMatrixWorld(true);
}

window.__bakeTool = async function (spec) {
  const canvas = document.getElementById("c");
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: true,
    premultipliedAlpha: false, preserveDrawingBuffer: true,
  });
  renderer.setSize(${RENDER}, ${RENDER}, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // Soft fill so unlit isn't flat black holes — a dim key still helps depth via... wait, Basic ignores lights.
  // Fake depth: duplicate with dark offset silhouette? Skip — crop+unsharp is enough.
  const camera = new THREE.OrthographicCamera(-0.55, 0.55, 0.55, -0.55, 0.01, 20);
  camera.position.set(0.35, 0.25, 2);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const gltf = await new GLTFLoader().loadAsync(spec.glb);
  const root = new THREE.Group();
  const model = gltf.scene;
  fixMaterials(model);
  prepareModel(model, spec.prepare || "long");
  root.add(model);
  const e = spec.euler || [0, 0, 0];
  root.rotation.set(e[0], e[1], e[2]);
  root.updateMatrixWorld(true);

  // Center in view
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const size2 = box2.getSize(new THREE.Vector3());
  const half = Math.max(size2.x, size2.y) * 0.52;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();

  scene.add(root);
  renderer.render(scene, camera);
  const dataUrl = canvas.toDataURL("image/png");
  renderer.dispose();
  return dataUrl;
};
</script>
</body></html>`;

function postProcess(pngBuf, outPath) {
  const tmpIn = path.join(ICONS, "_tmp_raw.png");
  fs.writeFileSync(tmpIn, pngBuf);
  const scriptPath = path.join(ICONS, "_tighten.py");
  fs.writeFileSync(
    scriptPath,
    `
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
import sys
src, dst, out_size, target = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
im = Image.open(src).convert("RGBA")
# Trim transparent
bbox = im.getbbox()
if not bbox:
    raise SystemExit("empty render")
# Grow bbox slightly
x0,y0,x1,y1 = bbox
pad = max(8, int(max(x1-x0, y1-y0) * 0.05))
x0,y0 = max(0,x0-pad), max(0,y0-pad)
x1,y1 = min(im.width, x1+pad), min(im.height, y1+pad)
crop = im.crop((x0,y0,x1,y1))
cw, ch = crop.size
box = int(out_size * target)
scale = min(box / cw, box / ch)
nw, nh = max(1, int(round(cw * scale))), max(1, int(round(ch * scale)))
crop = crop.resize((nw, nh), Image.Resampling.LANCZOS)
# Mild polish — do NOT blow out
crop = ImageEnhance.Contrast(crop).enhance(1.12)
crop = ImageEnhance.Color(crop).enhance(1.08)
crop = crop.filter(ImageFilter.UnsharpMask(radius=1.1, percent=120, threshold=3))
canvas = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
canvas.paste(crop, ((out_size - nw) // 2, (out_size - nh) // 2), crop)
canvas.save(dst, "PNG", optimize=True)
opaque = sum(1 for p in canvas.getdata() if p[3] > 20)
print(f"{cw}x{ch}->{nw}x{nh} fill={opaque/(out_size*out_size):.1%}")
`,
  );
  const r = spawnSync("python3", [scriptPath, tmpIn, outPath, String(OUT), String(TARGET)], {
    encoding: "utf8",
  });
  try { fs.unlinkSync(tmpIn); } catch (_) {}
  try { fs.unlinkSync(scriptPath); } catch (_) {}
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || "postprocess failed").trim());
  return (r.stdout || "").trim();
}

async function main() {
  fs.mkdirSync(ICONS, { recursive: true });
  const bakeHtmlPath = path.join(PUBLIC, "_bake_tool_icons.html");
  fs.writeFileSync(bakeHtmlPath, bakePageHtml);
  const { server, base } = await startServer();
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--enable-webgl",
      "--disable-gpu-sandbox",
    ],
  });
  try {
    const page = await browser.newPage({ viewport: { width: RENDER, height: RENDER } });
    await page.goto(base + "/_bake_tool_icons.html", { waitUntil: "networkidle" });
    await page.waitForFunction(() => typeof window.__bakeTool === "function", { timeout: 15000 });

    for (const tool of TOOLS) {
      const dataUrl = await page.evaluate(async (spec) => window.__bakeTool(spec), tool);
      const raw = Buffer.from(dataUrl.split(",")[1], "base64");
      fs.writeFileSync(path.join(ICONS, "_" + tool.id + "_raw.png"), raw);
      const out = path.join(ICONS, tool.id + ".png");
      const info = postProcess(raw, out);
      console.log("wrote", path.relative(ROOT, out), fs.statSync(out).size, "B", info);
    }
  } finally {
    await browser.close();
    server.close();
    try { fs.unlinkSync(bakeHtmlPath); } catch (_) {}
    for (const tool of TOOLS) {
      try { fs.unlinkSync(path.join(ICONS, "_" + tool.id + "_raw.png")); } catch (_) {}
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
