/** Bake skinned animated_old_chest.glb (closed pose) → old_chest_mesh.json */
import fs from "node:fs";
import path from "node:path";

const SRC = "/home/golfredo/Descargas/animated_old_chest.glb";
const OUT = path.resolve("public/props/old_chest_mesh.json");
const TARGET_H = 0.68;
// Face +Z in-game (door/front). Model front after bake.
const FACE_Z = true;

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
      else throw new Error("ctype " + acc.componentType);
      out[i * nComp + c] = v;
    }
  }
  return { data: out, count: acc.count, nComp };
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

function matFromTRS(t, r, s) {
  t = t || [0, 0, 0];
  r = r || [0, 0, 0, 1];
  s = s || [1, 1, 1];
  const x = r[0], y = r[1], z = r[2], w = r[3];
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * s[0];
  m[1] = (xy + wz) * s[0];
  m[2] = (xz - wy) * s[0];
  m[3] = 0;
  m[4] = (xy - wz) * s[1];
  m[5] = (1 - (xx + zz)) * s[1];
  m[6] = (yz + wx) * s[1];
  m[7] = 0;
  m[8] = (xz + wy) * s[2];
  m[9] = (yz - wx) * s[2];
  m[10] = (1 - (xx + yy)) * s[2];
  m[11] = 0;
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}

function matFromNode(node) {
  if (node.matrix && node.matrix.length === 16) return Float64Array.from(node.matrix);
  return matFromTRS(node.translation, node.rotation, node.scale);
}

function transformPoint(m, x, y, z, w = 1) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  ];
}

function transformDir(m, x, y, z) {
  const dx = m[0] * x + m[4] * y + m[8] * z;
  const dy = m[1] * x + m[5] * y + m[9] * z;
  const dz = m[2] * x + m[6] * y + m[10] * z;
  const len = Math.hypot(dx, dy, dz) || 1;
  return [dx / len, dy / len, dz / len];
}

// Sample animation channels at time t (linear)
function sampleAnimAt(t) {
  const anim = (json.animations || [])[0];
  if (!anim) return;
  for (const ch of anim.channels || []) {
    const samp = anim.samplers[ch.sampler];
    const node = json.nodes[ch.target.node];
    if (!node || !samp) continue;
    const times = accessorData(samp.input);
    const outs = accessorData(samp.output);
    const nComp = outs.nComp;
    let i1 = 0;
    while (i1 + 1 < times.count && times.data[i1 + 1] < t) i1++;
    let i0 = i1;
    if (i1 + 1 < times.count && times.data[i1] <= t) {
      // interpolate if mid
      const t0 = times.data[i1];
      const t1 = times.data[i1 + 1];
      const alpha = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
      i0 = i1;
      i1 = i1 + 1;
      const v = new Array(nComp);
      if (ch.target.path === "rotation") {
        // nlerp
        let dot = 0;
        for (let c = 0; c < 4; c++) {
          dot += outs.data[i0 * 4 + c] * outs.data[i1 * 4 + c];
        }
        const s = dot < 0 ? -1 : 1;
        for (let c = 0; c < 4; c++) {
          v[c] = outs.data[i0 * 4 + c] * (1 - alpha) + s * outs.data[i1 * 4 + c] * alpha;
        }
        const len = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
        for (let c = 0; c < 4; c++) v[c] /= len;
      } else {
        for (let c = 0; c < nComp; c++) {
          v[c] = outs.data[i0 * nComp + c] * (1 - alpha) + outs.data[i1 * nComp + c] * alpha;
        }
      }
      if (ch.target.path === "translation") node.translation = v;
      else if (ch.target.path === "rotation") node.rotation = v;
      else if (ch.target.path === "scale") node.scale = v;
    } else {
      const v = [];
      for (let c = 0; c < nComp; c++) v[c] = outs.data[i0 * nComp + c];
      if (ch.target.path === "translation") node.translation = v;
      else if (ch.target.path === "rotation") node.rotation = v;
      else if (ch.target.path === "scale") node.scale = v;
    }
  }
}

// Deep-clone node TRS so we can re-sample
const nodeBackup = json.nodes.map((n) => ({
  translation: n.translation && n.translation.slice(),
  rotation: n.rotation && n.rotation.slice(),
  scale: n.scale && n.scale.slice(),
  matrix: n.matrix && n.matrix.slice(),
}));
function restoreNodes() {
  for (let i = 0; i < json.nodes.length; i++) {
    const b = nodeBackup[i];
    const n = json.nodes[i];
    if (b.translation) n.translation = b.translation.slice();
    else delete n.translation;
    if (b.rotation) n.rotation = b.rotation.slice();
    else delete n.rotation;
    if (b.scale) n.scale = b.scale.slice();
    else delete n.scale;
    if (b.matrix) n.matrix = b.matrix.slice();
  }
}

function computeWorld() {
  const world = new Array(json.nodes.length);
  const parentOf = new Array(json.nodes.length).fill(-1);
  for (let pi = 0; pi < json.nodes.length; pi++) {
    for (const c of json.nodes[pi].children || []) parentOf[c] = pi;
  }
  function worldOf(i) {
    if (world[i]) return world[i];
    let m = matFromNode(json.nodes[i]);
    if (parentOf[i] >= 0) m = mulMat4(worldOf(parentOf[i]), m);
    world[i] = m;
    return m;
  }
  for (let i = 0; i < json.nodes.length; i++) worldOf(i);
  return world;
}

function skinMesh(t) {
  restoreNodes();
  sampleAnimAt(t);
  const world = computeWorld();
  const skin = json.skins[0];
  const ibmAcc = accessorData(skin.inverseBindMatrices);
  const jointMats = [];
  for (let j = 0; j < skin.joints.length; j++) {
    const jointNode = skin.joints[j];
    const ibm = ibmAcc.data.subarray(j * 16, j * 16 + 16);
    jointMats.push(mulMat4(world[jointNode], Float64Array.from(ibm)));
  }

  const meshNode = json.nodes.findIndex((n) => n.mesh === 0);
  const meshWorld = world[meshNode] || matFromTRS();
  const prim = json.meshes[0].primitives[0];
  const pos = accessorData(prim.attributes.POSITION);
  const nrm = accessorData(prim.attributes.NORMAL);
  const uv = accessorData(prim.attributes.TEXCOORD_0);
  const joints = accessorData(prim.attributes.JOINTS_0);
  const weights = accessorData(prim.attributes.WEIGHTS_0);
  const indices = accessorData(prim.indices);

  const verts = [];
  for (let ii = 0; ii < indices.count; ii++) {
    const vi = indices.data[ii] | 0;
    const px = pos.data[vi * 3], py = pos.data[vi * 3 + 1], pz = pos.data[vi * 3 + 2];
    const nx0 = nrm.data[vi * 3], ny0 = nrm.data[vi * 3 + 1], nz0 = nrm.data[vi * 3 + 2];
    let sx = 0, sy = 0, sz = 0;
    let snx = 0, sny = 0, snz = 0;
    for (let k = 0; k < 4; k++) {
      const j = joints.data[vi * 4 + k] | 0;
      const w = weights.data[vi * 4 + k];
      if (w <= 0) continue;
      const jm = jointMats[j];
      const [tx, ty, tz] = transformPoint(jm, px, py, pz);
      sx += tx * w; sy += ty * w; sz += tz * w;
      const [dx, dy, dz] = transformDir(jm, nx0, ny0, nz0);
      snx += dx * w; sny += dy * w; snz += dz * w;
    }
    const nlen = Math.hypot(snx, sny, snz) || 1;
    verts.push({
      x: sx, y: sy, z: sz,
      nx: snx / nlen, ny: sny / nlen, nz: snz / nlen,
      u: uv.data[vi * 2], v: uv.data[vi * 2 + 1],
    });
  }
  // also apply mesh node? Skinning usually already in skeleton space.
  // Sketchfab often has mesh under a node with identity — check AABB
  void meshWorld;
  return verts;
}

function aabb(verts) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ, sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
}

const closed = skinMesh(0);
const open = skinMesh(3.13);
const a0 = aabb(closed);
const a1 = aabb(open);
console.log("closed AABB", a0);
console.log("open AABB", a1);

// Prefer closed; if depth still huge, rotate so longest horizontal is width (X)
const verts = closed;
const box = a0;
const scale = TARGET_H / Math.max(box.sy, 1e-6);

// Long axis → width (X); short horizontal → depth (Z)
let swapXZ = false;
const w = box.sx * scale;
const d = box.sz * scale;
if (d > w * 1.15) {
  swapXZ = true;
  console.log("swap XZ → width", d.toFixed(3), "depth", w.toFixed(3));
}

const cx = (box.minX + box.maxX) * 0.5;
const cz = (box.minZ + box.maxZ) * 0.5;
const oak = [0.46, 0.30, 0.15];
const oakDark = [0.28, 0.17, 0.08];
const iron = [0.34, 0.34, 0.36];
const brass = [0.78, 0.60, 0.22];

const sizeX0 = (swapXZ ? box.sz : box.sx) * scale;
const sizeZ0 = (swapXZ ? box.sx : box.sz) * scale;
const fit = Math.min(1, 1.2 / Math.max(sizeX0, 1e-6));
const sizeX = sizeX0 * fit;
const sizeY = TARGET_H * fit;
const sizeZ = sizeZ0 * fit;

const floats = [];
for (const v of verts) {
  let x = (v.x - cx) * scale * fit;
  let y = (v.y - box.minY) * scale * fit;
  let z = (v.z - cz) * scale * fit;
  let nx = v.nx, ny = v.ny, nz = v.nz;
  if (swapXZ) {
    const tx = z, tnx = nz;
    z = -x; nz = -nx;
    x = tx; nx = tnx;
  }
  const grain = 0.035 * Math.sin(v.u * 36) * Math.sin(v.v * 24);
  let col = [
    Math.min(1, oak[0] + grain),
    Math.min(1, oak[1] + grain * 0.7),
    Math.min(1, oak[2] + grain * 0.45),
  ];
  if (y < 0.04) col = [oakDark[0], oakDark[1], oakDark[2]];
  const stripe = Math.abs(Math.sin(v.v * Math.PI * 8));
  if (stripe > 0.92 && Math.abs(ny) < 0.75) col = iron.slice();
  if (z > sizeZ * 0.22 && y > sizeY * 0.3 && y < sizeY * 0.58 && Math.abs(x) < 0.08) {
    col = brass.slice();
  }
  floats.push(x, y, z, nx, ny, nz, col[0], col[1], col[2], v.u, v.v);
}

const out = {
  vertCount: floats.length / 11,
  size: { x: sizeX, y: sizeY, z: sizeZ },
  floats,
  source: "animated_old_chest.glb",
  pose: "Chest_open t=0 (closed)",
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log("wrote", OUT, "verts", out.vertCount, "size", out.size, "KB", (fs.statSync(OUT).size / 1024).toFixed(1));
