/** Bake workbench GLBs with full albedo texture sampling → vertex colors. */
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const OUT_DIR = path.resolve("public/props");
const TARGET_H = 1.05;
const MAX_FOOT = 1.55;

const JOBS = [
  { tier: 1, src: "/home/golfredo/Descargas/workbench_level_1.glb", out: "workbench_t1_mesh.json" },
  { tier: 2, src: "/home/golfredo/Descargas/workbench_level_2_lod1.glb", out: "workbench_t2_mesh.json" },
  { tier: 3, src: "/home/golfredo/Descargas/rust_workbench_lvl_3.glb", out: "workbench_t3_mesh.json" },
];

function bakeOne(job) {
  const buf = fs.readFileSync(job.src);
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

  // Decode all embedded PNGs
  const images = [];
  for (let i = 0; i < (json.images || []).length; i++) {
    const im = json.images[i];
    const view = json.bufferViews[im.bufferView];
    const slice = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    if ((im.mimeType || "").includes("jpeg") || (im.mimeType || "").includes("jpg")) {
      throw new Error("JPEG not supported in baker — convert to PNG");
    }
    const png = PNG.sync.read(Buffer.from(slice));
    images.push({ w: png.width, h: png.height, data: png.data }); // RGBA
    console.log("  tex", i, png.width + "x" + png.height);
  }

  function sampleTex(imgIndex, u, v) {
    const img = images[imgIndex];
    if (!img) return [1, 1, 1];
    // Repeat wrap
    let uu = u - Math.floor(u);
    let vv = v - Math.floor(v);
    if (uu < 0) uu += 1;
    if (vv < 0) vv += 1;
    // glTF UV origin bottom-left in some exports — Sketchfab/FBX often top-left in PNG.
    // Try v flip (OpenGL style): most glTF PNG are top-left stored, UV 0 at bottom → flip V
    vv = 1 - vv;
    const x = Math.min(img.w - 1, Math.max(0, (uu * img.w) | 0));
    const y = Math.min(img.h - 1, Math.max(0, (vv * img.h) | 0));
    const o = (y * img.w + x) * 4;
    return [img.data[o] / 255, img.data[o + 1] / 255, img.data[o + 2] / 255];
  }

  function matAlbedo(matIndex, u, v) {
    const mat = matIndex != null ? json.materials[matIndex] : null;
    const pbr = (mat && mat.pbrMetallicRoughness) || {};
    const factor = pbr.baseColorFactor || [1, 1, 1, 1];
    let rgb = [factor[0], factor[1], factor[2]];
    if (pbr.baseColorTexture && pbr.baseColorTexture.index != null) {
      const tex = json.textures[pbr.baseColorTexture.index];
      const src = tex && tex.source;
      if (src != null) {
        const s = sampleTex(src, u, v);
        rgb = [s[0] * factor[0], s[1] * factor[1], s[2] * factor[2]];
      }
    }
    // sRGB → linear-ish boost midtones for WebGPU build shader
    return [
      Math.min(1, Math.pow(Math.max(0, rgb[0]), 0.9) * 1.05),
      Math.min(1, Math.pow(Math.max(0, rgb[1]), 0.9) * 1.05),
      Math.min(1, Math.pow(Math.max(0, rgb[2]), 0.9) * 1.05),
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
        const col = matAlbedo(prim.material, u, v);
        verts.push({ x: wx, y: wy, z: wz, nx, ny, nz, u, v, col });
      }
    }
  }

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
    floats.push(x, y, z, nx, ny, nz, v.col[0], v.col[1], v.col[2], v.u, v.v);
  }

  const out = {
    vertCount: floats.length / 11,
    size: { x: sizeX, y: sizeY, z: sizeZ },
    floats,
    source: path.basename(job.src),
    tier: job.tier,
    textured: true,
  };
  const outPath = path.join(OUT_DIR, job.out);
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(
    "T" + job.tier,
    "verts", out.vertCount,
    "size", {
      x: +sizeX.toFixed(3),
      y: +sizeY.toFixed(3),
      z: +sizeZ.toFixed(3),
    },
    "MB", (fs.statSync(outPath).size / 1e6).toFixed(2),
  );
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const job of JOBS) {
  console.log("baking", path.basename(job.src));
  bakeOne(job);
}
console.log("done");
