/**
 * Inventory icons from baked prop meshes — elevated iso, bright, 2×AA.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const ROOT = path.resolve("public");
const ICONS = path.join(ROOT, "icons");
const OUT = 256;
const HI = 512; // render 2× then box-downsample
const PAD = 0.16;

const JOBS = [
  // Elevated 3/4 (pitch > 0 tips model so we look down onto the top)
  { id: "workbench_1", mesh: "props/workbench_t1_mesh.json", yaw: 0.85, pitch: 0.48, exposure: 1.6 },
  { id: "workbench_2", mesh: "props/workbench_t2_mesh.json", yaw: 0.85 + Math.PI, pitch: 0.48, exposure: 1.85 },
  { id: "workbench_3", mesh: "props/workbench_t3_mesh.json", yaw: 0.85, pitch: 0.48, exposure: 2.15 },
  // Same fixed world frame so small reads smaller than large (auto-fit was identical).
  { id: "box_large", mesh: "props/old_chest_mesh.json", yaw: 0.55, pitch: 0.38, scale: 1, exposure: 1.75, fixedSpan: 1.55 },
  { id: "box_small", mesh: "props/old_chest_mesh.json", yaw: 1.35, pitch: 0.52, scale: 0.62, exposure: 1.85, fixedSpan: 1.55 },
  { id: "tool_cupboard_item", mesh: "props/wardrobe_tc_mesh.json", yaw: 0.7, pitch: 0.22, exposure: 1.5 },
  { id: "research_table", mesh: "props/research_table_mesh.json", yaw: 0.9, pitch: 0.42, exposure: 1.7 },
];

function loadMesh(rel) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  if (!j.floats || !j.vertCount) throw new Error("bad mesh " + rel);
  return j;
}

function rotateY(x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}
function rotateX(x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}

function rasterizeHi(mesh, opts) {
  const F = mesh.floats;
  const n = mesh.vertCount | 0;
  const s0 = opts.scale != null ? opts.scale : 1;
  const exposure = opts.exposure != null ? opts.exposure : 1.5;
  const pts = new Float32Array(n * 3);
  const nrms = new Float32Array(n * 3);
  const cols = new Float32Array(n * 3);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    const o = i * 11;
    let x = F[o] * s0, y = F[o + 1] * s0, z = F[o + 2] * s0;
    let nx = F[o + 3], ny = F[o + 4], nz = F[o + 5];
    [x, y, z] = rotateY(x, y, z, opts.yaw || 0);
    [nx, ny, nz] = rotateY(nx, ny, nz, opts.yaw || 0);
    [x, y, z] = rotateX(x, y, z, opts.pitch || 0);
    [nx, ny, nz] = rotateX(nx, ny, nz, opts.pitch || 0);
    const nl = Math.hypot(nx, ny, nz) || 1;
    pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
    nrms[i * 3] = nx / nl; nrms[i * 3 + 1] = ny / nl; nrms[i * 3 + 2] = nz / nl;
    cols[i * 3] = Math.min(1, Math.pow(Math.max(0, F[o + 6]), 0.85) * exposure + 0.08);
    cols[i * 3 + 1] = Math.min(1, Math.pow(Math.max(0, F[o + 7]), 0.85) * exposure + 0.07);
    cols[i * 3 + 2] = Math.min(1, Math.pow(Math.max(0, F[o + 8]), 0.85) * exposure + 0.06);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  const autoSpan = Math.max(1e-6, Math.max(maxX - minX, maxY - minY));
  const span = opts.fixedSpan != null ? Math.max(autoSpan, opts.fixedSpan) : autoSpan;
  const fit = (HI * (1 - 2 * PAD)) / span;
  const midX = (minX + maxX) * 0.5;
  const midY = (minY + maxY) * 0.5;

  const zbuf = new Float32Array(HI * HI);
  zbuf.fill(-Infinity);
  const rgba = Buffer.alloc(HI * HI * 4);

  const Lx = -0.35, Ly = 0.82, Lz = 0.45;
  const Ll = Math.hypot(Lx, Ly, Lz);
  const lx = Lx / Ll, ly = Ly / Ll, lz = Lz / Ll;
  const AMB = 0.72, DIF = 0.48;

  const edge = (ax, ay, bx, by, cx, cy) =>
    (cx - ax) * (by - ay) - (cy - ay) * (bx - ax);

  for (let t = 0; t + 2 < n; t += 3) {
    const i0 = t, i1 = t + 1, i2 = t + 2;
    const x0 = pts[i0 * 3], y0 = pts[i0 * 3 + 1], z0 = pts[i0 * 3 + 2];
    const x1 = pts[i1 * 3], y1 = pts[i1 * 3 + 1], z1 = pts[i1 * 3 + 2];
    const x2 = pts[i2 * 3], y2 = pts[i2 * 3 + 1], z2 = pts[i2 * 3 + 2];

    const sx0 = (x0 - midX) * fit + HI * 0.5;
    const sy0 = HI * 0.5 - (y0 - midY) * fit;
    const sx1 = (x1 - midX) * fit + HI * 0.5;
    const sy1 = HI * 0.5 - (y1 - midY) * fit;
    const sx2 = (x2 - midX) * fit + HI * 0.5;
    const sy2 = HI * 0.5 - (y2 - midY) * fit;

    const area = edge(sx0, sy0, sx1, sy1, sx2, sy2);
    if (area <= 1e-4) continue; // front faces only (elevated view)
    const invA = 1 / area;

    const minPX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)));
    const maxPX = Math.min(HI - 1, Math.ceil(Math.max(sx0, sx1, sx2)));
    const minPY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)));
    const maxPY = Math.min(HI - 1, Math.ceil(Math.max(sy0, sy1, sy2)));

    for (let py = minPY; py <= maxPY; py++) {
      for (let px = minPX; px <= maxPX; px++) {
        const w0 = edge(sx1, sy1, sx2, sy2, px + 0.5, py + 0.5) * invA;
        const w1 = edge(sx2, sy2, sx0, sy0, px + 0.5, py + 0.5) * invA;
        const w2 = edge(sx0, sy0, sx1, sy1, px + 0.5, py + 0.5) * invA;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * z0 + w1 * z1 + w2 * z2;
        const idx = py * HI + px;
        if (z < zbuf[idx]) continue;
        zbuf[idx] = z;

        let nx = w0 * nrms[i0 * 3] + w1 * nrms[i1 * 3] + w2 * nrms[i2 * 3];
        let ny = w0 * nrms[i0 * 3 + 1] + w1 * nrms[i1 * 3 + 1] + w2 * nrms[i2 * 3 + 1];
        let nz = w0 * nrms[i0 * 3 + 2] + w1 * nrms[i1 * 3 + 2] + w2 * nrms[i2 * 3 + 2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const ndl = Math.max(0, nx * lx + ny * ly + nz * lz);
        const lit = AMB + DIF * ndl;
        const r = Math.min(1, (w0 * cols[i0 * 3] + w1 * cols[i1 * 3] + w2 * cols[i2 * 3]) * lit);
        const g = Math.min(1, (w0 * cols[i0 * 3 + 1] + w1 * cols[i1 * 3 + 1] + w2 * cols[i2 * 3 + 1]) * lit);
        const b = Math.min(1, (w0 * cols[i0 * 3 + 2] + w1 * cols[i1 * 3 + 2] + w2 * cols[i2 * 3 + 2]) * lit);
        const o = idx * 4;
        rgba[o] = (r * 255) | 0;
        rgba[o + 1] = (g * 255) | 0;
        rgba[o + 2] = (b * 255) | 0;
        rgba[o + 3] = 255;
      }
    }
  }
  return rgba;
}

function downsample(hiRgba) {
  const out = Buffer.alloc(OUT * OUT * 4);
  const s = HI / OUT; // 2
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = 0; dy < s; dy++) {
        for (let dx = 0; dx < s; dx++) {
          const sx = x * s + dx, sy = y * s + dy;
          const o = (sy * HI + sx) * 4;
          if (hiRgba[o + 3] < 8) continue;
          r += hiRgba[o]; g += hiRgba[o + 1]; b += hiRgba[o + 2]; a += 255; n++;
        }
      }
      const o = (y * OUT + x) * 4;
      if (n === 0) continue;
      out[o] = (r / n) | 0;
      out[o + 1] = (g / n) | 0;
      out[o + 2] = (b / n) | 0;
      out[o + 3] = 255;
    }
  }
  return out;
}

fs.mkdirSync(ICONS, { recursive: true });
for (const job of JOBS) {
  const mesh = loadMesh(job.mesh);
  const hi = rasterizeHi(mesh, job);
  const rgba = downsample(hi);
  const png = new PNG({ width: OUT, height: OUT });
  rgba.copy(png.data);
  const buf = PNG.sync.write(png);
  fs.writeFileSync(path.join(ICONS, job.id + ".png"), buf);
  console.log("wrote", job.id, (buf.length / 1024).toFixed(1) + "KB");
}
console.log("done");
