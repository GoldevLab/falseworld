import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { spawnSync } from "node:child_process";

const PUBLIC = path.resolve("public");
const PROPS = path.join(PUBLIC, "props");
const ICONS = path.join(PUBLIC, "icons");
const RENDER = 512;
fs.mkdirSync(PROPS, { recursive: true });
fs.mkdirSync(ICONS, { recursive: true });
fs.copyFileSync(
  "/home/golfredo/Descargas/animated_old_chest.glb",
  path.join(PROPS, "animated_old_chest.glb"),
);

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const filePath = path.join(PUBLIC, urlPath.replace(/^\//, "") || "index.html");
      if (!filePath.startsWith(PUBLIC) || !fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const types = {
        ".glb": "model/gltf-binary",
        ".js": "text/javascript",
        ".json": "application/json",
        ".html": "text/html",
      };
      res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function findChrome() {
  for (const name of ["google-chrome-stable", "chromium", "chromium-browser"]) {
    const r = spawnSync("which", [name]);
    if (r.status === 0) return r.stdout.toString().trim();
  }
  return null;
}

const chrome = findChrome();
if (!chrome) throw new Error("no chrome");

const server = await startServer();
const port = server.address().port;
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: RENDER, height: RENDER } });
page.on("console", (m) => console.log("[page]", m.type(), m.text()));
page.on("pageerror", (e) => console.error("[pageerror]", e));

await page.setContent(
  `<!doctype html><html><body style="margin:0;background:#1a1814">
<canvas id="c" width="${RENDER}" height="${RENDER}"></canvas>
<script type="importmap">{"imports":{
  "three":"https://unpkg.com/three@0.160.0/build/three.module.js",
  "three/addons/":"https://unpkg.com/three@0.160.0/examples/jsm/"
}}</script>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const TARGET_H = 0.72;
const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setSize(${RENDER}, ${RENDER}, false);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1814);
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = false;

scene.add(new THREE.AmbientLight(0xfff2e0, 0.55));
const key = new THREE.DirectionalLight(0xffe6c8, 1.35);
key.position.set(2.2, 3.4, 2.8);
scene.add(key);
const fill = new THREE.DirectionalLight(0xb8c8e8, 0.45);
fill.position.set(-2.5, 1.2, -1.5);
scene.add(fill);

const loader = new GLTFLoader();
const gltf = await loader.loadAsync("http://127.0.0.1:${port}/props/animated_old_chest.glb");
const root = gltf.scene;

if (gltf.animations && gltf.animations.length) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(gltf.animations[0]);
  action.play();
  mixer.setTime(0);
  mixer.update(0);
}

root.updateMatrixWorld(true);
const box0 = new THREE.Box3().setFromObject(root);
const size0 = box0.getSize(new THREE.Vector3());
const scale = TARGET_H / Math.max(size0.y, 1e-6);
root.scale.setScalar(scale);
root.updateMatrixWorld(true);
const box1 = new THREE.Box3().setFromObject(root);
root.position.x -= (box1.min.x + box1.max.x) * 0.5;
root.position.y -= box1.min.y;
root.position.z -= (box1.min.z + box1.max.z) * 0.5;
root.updateMatrixWorld(true);

const finalBox = new THREE.Box3().setFromObject(root);
const finalSize = finalBox.getSize(new THREE.Vector3());
const finalCenter = finalBox.getCenter(new THREE.Vector3());

function sampleCol(uv, base) {
  const u = uv ? uv.x : 0.5, v = uv ? uv.y : 0.5;
  const grain = 0.04 * Math.sin(u * 40.0) * Math.sin(v * 28.0);
  return [
    Math.min(1, Math.max(0.05, base[0] + grain)),
    Math.min(1, Math.max(0.04, base[1] + grain * 0.7)),
    Math.min(1, Math.max(0.03, base[2] + grain * 0.4)),
  ];
}

const oak = [0.46, 0.30, 0.15];
const oakDark = [0.28, 0.17, 0.08];
const iron = [0.32, 0.32, 0.34];
const brass = [0.78, 0.60, 0.22];

const floats = [];
const tmpP = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpUV = new THREE.Vector2();

root.traverse((obj) => {
  if (!obj.isMesh || !obj.geometry) return;
  const geo = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = geo.attributes.uv;
  obj.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);
  for (let i = 0; i < pos.count; i++) {
    tmpP.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
    if (nrm) tmpN.fromBufferAttribute(nrm, i).applyMatrix3(inv).normalize();
    else tmpN.set(0, 1, 0);
    if (uv) tmpUV.fromBufferAttribute(uv, i);
    else tmpUV.set(0.5, 0.5);
    let col = sampleCol(tmpUV, oak);
    const ny = Math.abs(tmpN.y);
    if (tmpP.y < 0.04) col = sampleCol(tmpUV, oakDark);
    const bandish = (Math.abs((tmpUV.y % 0.2) - 0.1) < 0.015)
      || (Math.abs(tmpUV.x - 0.5) < 0.02 && tmpP.y > 0.15 && tmpP.y < 0.55);
    if (bandish && ny < 0.85) col = iron;
    if (tmpP.z > finalSize.z * 0.28 && tmpP.y > 0.22 && tmpP.y < 0.42 && Math.abs(tmpP.x) < 0.08) {
      col = brass;
    }
    floats.push(
      tmpP.x, tmpP.y, tmpP.z,
      tmpN.x, tmpN.y, tmpN.z,
      col[0], col[1], col[2],
      tmpUV.x, tmpUV.y,
    );
  }
});

const vertCount = floats.length / 11;
const meshOut = {
  vertCount,
  size: { x: finalSize.x, y: finalSize.y, z: finalSize.z },
  floats,
};

const fit = Math.max(finalSize.x, finalSize.y, finalSize.z);
camera.position.set(fit * 1.55, fit * 1.15, fit * 1.85);
controls.target.copy(finalCenter);
controls.update();
scene.add(root);
renderer.render(scene, camera);
const png = canvas.toDataURL("image/png");

window.__BAKE__ = {
  meshOut,
  png,
  vertCount,
  size: meshOut.size,
  anims: (gltf.animations || []).map((a) => a.name),
};
</script></body></html>`,
  { waitUntil: "networkidle" },
);

await page.waitForFunction(() => window.__BAKE__ && window.__BAKE__.vertCount > 0, {
  timeout: 120000,
});
const result = await page.evaluate(() => window.__BAKE__);
console.log("verts", result.vertCount, "size", result.size, "anims", result.anims);

fs.writeFileSync(path.join(PROPS, "old_chest_mesh.json"), JSON.stringify(result.meshOut));
const b64 = result.png.replace(/^data:image\/png;base64,/, "");
const pngBuf = Buffer.from(b64, "base64");
fs.writeFileSync(path.join(ICONS, "box_large.png"), pngBuf);
fs.writeFileSync(path.join(ICONS, "scrap_barrel.png"), pngBuf);
console.log(
  "wrote old_chest_mesh.json",
  (fs.statSync(path.join(PROPS, "old_chest_mesh.json")).size / 1024).toFixed(1),
  "KB",
);

await browser.close();
server.close();
fs.unlinkSync(path.join(PROPS, "animated_old_chest.glb"));
console.log("done");
