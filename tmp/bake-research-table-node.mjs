/**
 * High-quality bake for research_table_rust.glb → vertex colors.
 * Dark metal albedo + multi-UV Sketchfab export needs bilinear + exposure + form lighting.
 */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const OUT_DIR = path.resolve("public/props");
const TARGET_H = 1.18;
const MAX_FOOT = 1.9;
const SRC = "/home/golfredo/Descargas/research_table_rust.glb";
const OUT = "research_table_mesh.json";

const buf = fs.readFileSync(SRC);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
let binOffset = (20 + jsonLen + 3) & ~3;
const binLen = buf.readUInt32LE(binOffset);
const bin = buf.slice(binOffset + 8, binOffset + 8 + binLen);

function accessorData(accIndex) {
  const acc = json.accessors[accIndex];
  const view = json.bufferViews[acc.bufferView];
  const nComp = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const byteOffset = (view.byteOffset || 0) + (acc.byteOffset || 0);
  const el =
    acc.componentType === 5126 ? 4 :
    acc.componentType === 5123 ? 2 :
    acc.componentType === 5121 ? 1 : 4;
  const stride = view.byteStride || nComp * el;
  const out = new Float32Array(acc.count * nComp);
  for (let i = 0; i < acc.count; i++) {
    const o = byteOffset + i * stride;
    for (let c = 0; c < nComp; c++) {
      let v;
      if (acc.componentType === 5126) v = bin.readFloatLE(o + c * 4);
      else if (acc.componentType === 5123) v = bin.readUInt16LE(o + c * 2);
      else if (acc.componentType === 5125) v = bin.readUInt32LE(o + c * 4);
      else if (acc.componentType === 5121) v = bin[o + c];
      else throw new Error("ctype");
      out[i * nComp + c] = v;
    }
  }
  return { data: out, count: acc.count, nComp };
}

const images = [];
for (let i = 0; i < (json.images || []).length; i++) {
  const im = json.images[i];
  const view = json.bufferViews[im.bufferView];
  const slice = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  if ((im.mimeType || "").includes("jpeg") || (im.mimeType || "").includes("jpg")) {
    throw new Error("JPEG not supported");
  }
  const png = PNG.sync.read(Buffer.from(slice));
  images.push({ w: png.width, h: png.height, data: png.data });
  console.log("  tex", i, png.width + "x" + png.height);
}

function sampleBilinear(img, u, v, flipV) {
  let uu = u - Math.floor(u);
  let vv = v - Math.floor(v);
  if (uu < 0) uu += 1;
  if (vv < 0) vv += 1;
  if (flipV) vv = 1 - vv;
  const fx = uu * (img.w - 1);
  const fy = vv * (img.h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(img.w - 1, x0 + 1);
  const y1 = Math.min(img.h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x, y) => {
    const o = (y * img.w + x) * 4;
    return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
  };
  const c00 = at(x0, y0), c10 = at(x1, y0), c01 = at(x0, y1), c11 = at(x1, y1);
  const lerp = (a, b, t) => a + (b - a) * t;
  return [
    lerp(lerp(c00[0], c10[0], tx), lerp(c01[0], c11[0], tx), ty),
    lerp(lerp(c00[1], c10[1], tx), lerp(c01[1], c11[1], tx), ty),
    lerp(lerp(c00[2], c10[2], tx), lerp(c01[2], c11[2], tx), ty),
  ];
}

function sampleTex(imgIndex, u, v, flipV) {
  const img = images[imgIndex];
  if (!img) return [1, 1, 1];
  return sampleBilinear(img, u, v, flipV);
}

function matAlbedo(matIndex, u, v, flipV) {
  const mat = matIndex != null ? json.materials[matIndex] : null;
  const pbr = (mat && mat.pbrMetallicRoughness) || {};
  const factor = pbr.baseColorFactor || [1, 1, 1, 1];
  let rgb = [factor[0], factor[1], factor[2]];
  if (pbr.baseColorTexture && pbr.baseColorTexture.index != null) {
    const tex = json.textures[pbr.baseColorTexture.index];
    const src = tex && tex.source;
    if (src != null) {
      const s = sampleTex(src, u, v, flipV);
      rgb = [s[0] * factor[0], s[1] * factor[1], s[2] * factor[2]];
    }
  }
  // Dark metal atlas: lift midtones hard so meadow lit shader still reads detail
  const EXPOSURE = 2.15;
  const GAMMA = 0.72;
  return [
    Math.min(1, Math.pow(Math.max(0, rgb[0]), GAMMA) * EXPOSURE),
    Math.min(1, Math.pow(Math.max(0, rgb[1]), GAMMA) * EXPOSURE),
    Math.min(1, Math.pow(Math.max(0, rgb[2]), GAMMA) * EXPOSURE),
  ];
}

/** Soft studio form lighting baked into albedo (engine already lights again → keep mild). */
function formShade(nx, ny, nz, rgb) {
  const key = Math.max(0, nx * -0.35 + ny * 0.82 + nz * 0.42);
  const fill = Math.max(0, ny * 0.55 + 0.35);
  const rim = Math.max(0, -ny * 0.15 + 0.08);
  const lit = 0.62 + key * 0.38 + fill * 0.18 + rim;
  return [
    Math.min(1, rgb[0] * lit),
    Math.min(1, rgb[1] * lit),
    Math.min(1, rgb[2] * lit),
  ];
}

function mulMat4(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

function matFromNode(node) {
  if (node.matrix && node.matrix.length === 16) return Float64Array.from(node.matrix);
  const t = node.translation || [0, 0, 0];
  const r = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const x = r[0], y = r[1], z = r[2], w = r[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * s[0];
  m[1] = (xy + wz) * s[0];
  m[2] = (xz - wy) * s[0];
  m[4] = (xy - wz) * s[1];
  m[5] = (1 - (xx + zz)) * s[1];
  m[6] = (yz + wx) * s[1];
  m[8] = (xz + wy) * s[2];
  m[9] = (yz - wx) * s[2];
  m[10] = (1 - (xx + yy)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function transformDir(m, x, y, z) {
  const dx = m[0] * x + m[4] * y + m[8] * z;
  const dy = m[1] * x + m[5] * y + m[9] * z;
  const dz = m[2] * x + m[6] * y + m[10] * z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [dx / len, dy / len, dz / len];
}

const parentOf = new Array(json.nodes.length).fill(-1);
for (let pi = 0; pi < json.nodes.length; pi++) {
  for (const c of json.nodes[pi].children || []) parentOf[c] = pi;
}
const world = new Array(json.nodes.length);
function worldOf(i) {
  if (world[i]) return world[i];
  let m = matFromNode(json.nodes[i]);
  if (parentOf[i] >= 0) m = mulMat4(worldOf(parentOf[i]), m);
  world[i] = m;
  return m;
}
for (let i = 0; i < json.nodes.length; i++) worldOf(i);

function gatherVerts(flipV) {
  const verts = [];
  for (let ni = 0; ni < json.nodes.length; ni++) {
    const node = json.nodes[ni];
    if (node.mesh == null) continue;
    const mesh = json.meshes[node.mesh];
    const M = world[ni];
    for (const prim of mesh.primitives || []) {
      const pos = accessorData(prim.attributes.POSITION);
      const nrm = prim.attributes.NORMAL != null ? accessorData(prim.attributes.NORMAL) : null;
      const uv = prim.attributes.TEXCOORD_0 != null ? accessorData(prim.attributes.TEXCOORD_0) : null;
      let indices;
      if (prim.indices != null) indices = accessorData(prim.indices).data;
      else {
        indices = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) indices[i] = i;
      }
      for (let ii = 0; ii < indices.length; ii++) {
        const vi = indices[ii] | 0;
        const [wx, wy, wz] = transformPoint(M, pos.data[vi * 3], pos.data[vi * 3 + 1], pos.data[vi * 3 + 2]);
        let nx = 0, ny = 1, nz = 0;
        if (nrm) [nx, ny, nz] = transformDir(M, nrm.data[vi * 3], nrm.data[vi * 3 + 1], nrm.data[vi * 3 + 2]);
        const u = uv ? uv.data[vi * 2] : 0.5;
        const v = uv ? uv.data[vi * 2 + 1] : 0.5;
        let col = matAlbedo(prim.material, u, v, flipV);
        col = formShade(nx, ny, nz, col);
        verts.push({ x: wx, y: wy, z: wz, nx, ny, nz, u, v, col });
      }
    }
  }
  return verts;
}

function scoreVerts(verts) {
  let sum = 0, dark = 0, varAcc = 0;
  for (const v of verts) {
    const L = (v.col[0] + v.col[1] + v.col[2]) / 3;
    sum += L;
    if (L < 0.08) dark++;
    varAcc += L * L;
  }
  const n = verts.length;
  const avg = sum / n;
  const variance = varAcc / n - avg * avg;
  // Prefer higher avg, lower crushed-black %, some variance (detail)
  return avg * 2.2 + variance * 8 - (dark / n) * 3;
}

console.log("picking UV V orientation…");
const candA = gatherVerts(true);
const candB = gatherVerts(false);
const scoreA = scoreVerts(candA);
const scoreB = scoreVerts(candB);
const flipV = scoreA >= scoreB;
const verts = flipV ? candA : candB;
console.log("  flipV", flipV, "score", (flipV ? scoreA : scoreB).toFixed(3),
  "(alt", (!flipV ? scoreA : scoreB).toFixed(3) + ")");

let minX = Infinity, minY = Infinity, minZ = Infinity;
let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
for (const v of verts) {
  if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
  if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
}
const h = Math.max(1e-6, maxY - minY);
let scale = TARGET_H / h;
let sizeX = (maxX - minX) * scale;
let sizeZ = (maxZ - minZ) * scale;
let swapXZ = sizeZ > sizeX * 1.2;
if (swapXZ) { const t = sizeX; sizeX = sizeZ; sizeZ = t; }
const fit = Math.min(1, MAX_FOOT / Math.max(sizeX, sizeZ, 1e-6));
scale *= fit;
sizeX *= fit;
sizeZ *= fit;
const sizeY = TARGET_H * fit;
const cx = (minX + maxX) * 0.5;
const cz = (minZ + maxZ) * 0.5;

const floats = [];
let dark = 0;
for (const v of verts) {
  let x = (v.x - cx) * scale;
  let y = (v.y - minY) * scale;
  let z = (v.z - cz) * scale;
  let nx = v.nx, ny = v.ny, nz = v.nz;
  if (swapXZ) {
    const tx = z, tnx = nz;
    z = -x; nz = -nx;
    x = tx; nx = tnx;
  }
  const L = (v.col[0] + v.col[1] + v.col[2]) / 3;
  if (L < 0.08) dark++;
  floats.push(x, y, z, nx, ny, nz, v.col[0], v.col[1], v.col[2], v.u, v.v);
}

const out = {
  vertCount: floats.length / 11,
  size: { x: sizeX, y: sizeY, z: sizeZ },
  floats,
  source: path.basename(SRC),
  textured: true,
  bake: { flipV, exposure: 2.15, gamma: 0.72, bilinear: true, formShade: true },
};
fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, OUT);
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(
  "research verts", out.vertCount,
  "size", { x: +sizeX.toFixed(3), y: +sizeY.toFixed(3), z: +sizeZ.toFixed(3) },
  "dark%", ((dark / out.vertCount) * 100).toFixed(1),
  "MB", (fs.statSync(outPath).size / 1e6).toFixed(2),
);
console.log("done");
