/** False World meadow WebGPU v220 — lobed canopy + solid falling trunks/stumps. */
/**
 * Inspiration: False Earth (Ming-Jyun Hung). Original WGSL + JS; no Three/R3F/React.
 */
import SCENE_WGSL from "./shaders/scene.wgsl";
import COMPUTE_WGSL from "./shaders/compute.wgsl";
import CULL_WGSL from "./shaders/cull.wgsl";
import OCEAN_SIM_WGSL from "./shaders/ocean-sim.wgsl";
import OCEAN_WGSL from "./shaders/ocean.wgsl";
import OCEAN_FLOOR_WGSL from "./shaders/ocean-floor.wgsl";
import SKY_WGSL from "./shaders/sky.wgsl";
import POST_WGSL from "./shaders/post.wgsl";

  function mat4Id() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function mat4Mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
      o[i] = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
      o[i + 4] = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
      o[i + 8] = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
      o[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
    }
    return o;
  }
  function mat4Persp(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const o = new Float32Array(16);
    o[0] = f / aspect;
    o[5] = f;
    o[10] = far / (near - far);
    o[11] = -1;
    o[14] = (far * near) / (near - far);
    return o;
  }

  function mat4Ortho(l, r, b, top, near, far) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l);
    o[5] = 2 / (top - b);
    o[10] = 1 / (near - far);
    o[12] = -(r + l) / (r - l);
    o[13] = -(top + b) / (top - b);
    o[14] = near / (near - far);
    o[15] = 1;
    return o;
  }
  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    let xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const o = mat4Id();
    o[0] = xx; o[1] = yx; o[2] = zx;
    o[4] = xy; o[5] = yy; o[6] = zy;
    o[8] = xz; o[9] = yz; o[10] = zz;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    return o;
  }

  function mat4Invert(m) {
    const out = new Float32Array(16);
    const a00=m[0],a01=m[1],a02=m[2],a03=m[3],a10=m[4],a11=m[5],a12=m[6],a13=m[7];
    const a20=m[8],a21=m[9],a22=m[10],a23=m[11],a30=m[12],a31=m[13],a32=m[14],a33=m[15];
    const b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10;
    const b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12;
    const b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30;
    const b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
    let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if (!det) return mat4Id();
    det = 1 / det;
    out[0]=(a11*b11-a12*b10+a13*b09)*det; out[1]=(a02*b10-a01*b11-a03*b09)*det;
    out[2]=(a31*b05-a32*b04+a33*b03)*det; out[3]=(a22*b04-a21*b05-a23*b03)*det;
    out[4]=(a12*b08-a10*b11-a13*b07)*det; out[5]=(a00*b11-a02*b08+a03*b07)*det;
    out[6]=(a32*b02-a30*b05-a33*b01)*det; out[7]=(a20*b05-a22*b02+a23*b01)*det;
    out[8]=(a10*b10-a11*b08+a13*b06)*det; out[9]=(a01*b08-a00*b10-a03*b06)*det;
    out[10]=(a30*b04-a31*b02+a33*b00)*det; out[11]=(a21*b02-a20*b04-a23*b00)*det;
    out[12]=(a11*b07-a10*b09-a12*b06)*det; out[13]=(a00*b09-a01*b07+a02*b06)*det;
    out[14]=(a31*b01-a30*b03-a32*b00)*det; out[15]=(a20*b03-a21*b01+a22*b00)*det;
    return out;
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function decodeFwch(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "FWCH") {
      throw new Error("not FWCH");
    }
    let i = 4;
    const u32 = () => { const v = dv.getUint32(i, true); i += 4; return v; };
    const f32 = () => { const v = dv.getFloat32(i, true); i += 4; return v; };
    const ver = u32();
    if (ver !== 1) throw new Error("bad FWCH version " + ver);
    const seed = u32();
    const origin_x = f32();
    const origin_z = f32();
    const area = f32();
    const amp = f32();
    const freq = f32();
    const tseed = u32();
    const height_res = u32();
    const n_h = u32();
    const n_b = u32();
    const heights = new Float32Array(n_h);
    for (let k = 0; k < n_h; k++) heights[k] = f32();
    const blades = new Float32Array(n_b * 16);
    if (n_b > 0) {
      blades.set(new Float32Array(bytes.buffer, bytes.byteOffset + i, n_b * 16));
    }
    return {
      seed, origin_x, origin_z, area,
      terrain: { amplitude: amp, frequency: freq, seed: tseed },
      height_res, heights, blades, bladeCount: n_b,
    };
  }

  function sampleHeight(chunk, wx, wz) {
    const res = chunk.height_res;
    if (res < 2) return 0;
    const u = Math.min(1 - 1e-5, Math.max(0, (wx - chunk.origin_x) / chunk.area + 0.5));
    const v = Math.min(1 - 1e-5, Math.max(0, (wz - chunk.origin_z) / chunk.area + 0.5));
    const fx = u * (res - 1);
    const fz = v * (res - 1);
    const x0 = fx | 0, z0 = fz | 0;
    const x1 = Math.min(res - 1, x0 + 1), z1 = Math.min(res - 1, z0 + 1);
    const tx = fx - x0, tz = fz - z0;
    const h = chunk.heights;
    const a = h[z0 * res + x0] + (h[z0 * res + x1] - h[z0 * res + x0]) * tx;
    const b = h[z1 * res + x0] + (h[z1 * res + x1] - h[z1 * res + x0]) * tx;
    return a + (b - a) * tz;
  }

  function buildTerrainMesh(chunk) {
    const res = chunk.height_res;
    const verts = new Float32Array(res * res * 6);
    const indices = new Uint32Array((res - 1) * (res - 1) * 6);
    let vi = 0;
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const u = x / (res - 1), v = z / (res - 1);
        const wx = chunk.origin_x + (u - 0.5) * chunk.area;
        const wz = chunk.origin_z + (v - 0.5) * chunk.area;
        const wy = chunk.heights[z * res + x];
        const step = chunk.area / (res - 1);
        const hx0 = sampleHeight(chunk, wx - step, wz);
        const hx1 = sampleHeight(chunk, wx + step, wz);
        const hz0 = sampleHeight(chunk, wx, wz - step);
        const hz1 = sampleHeight(chunk, wx, wz + step);
        let nx = hx0 - hx1, ny = 2 * step, nz = hz0 - hz1;
        const nl = Math.hypot(nx, ny, nz) || 1;
        verts[vi++] = wx; verts[vi++] = wy; verts[vi++] = wz;
        verts[vi++] = nx / nl; verts[vi++] = ny / nl; verts[vi++] = nz / nl;
      }
    }
    let ii = 0;
    for (let z = 0; z < res - 1; z++) {
      for (let x = 0; x < res - 1; x++) {
        const a = z * res + x, b = a + 1, c = a + res, d = c + 1;
        indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
        indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
      }
    }
    return { verts, indices };
  }

  const SEA_Y = -0.55;
  // Inner rim near min waterline (~rim*0.87). Shader clamps/discards inland of beach.
  const OCEAN_R_IN = 155;
  const OCEAN_R_OUT = 880;
  const OCEAN_PATCH0 = 180;
  const OCEAN_PATCH1 = 48;
  const OCEAN_SIM_RES = 256;
  function buildOceanMesh() {
    const rings = 48;
    const segs = 256;
    const verts = [];
    const indices = [];
    for (let ri = 0; ri <= rings; ri++) {
      const tt = ri / rings;
      const u = tt * tt * tt;
      const rad = OCEAN_R_IN + (OCEAN_R_OUT - OCEAN_R_IN) * u;
      for (let si = 0; si <= segs; si++) {
        const a = (si / segs) * Math.PI * 2;
        verts.push(Math.cos(a) * rad, SEA_Y, Math.sin(a) * rad);
      }
    }
    const stride = segs + 1;
    for (let ri = 0; ri < rings; ri++) {
      for (let si = 0; si < segs; si++) {
        const i0 = ri * stride + si;
        const i1 = i0 + 1;
        const i2 = i0 + stride;
        const i3 = i2 + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }
    return {
      verts: new Float32Array(verts),
      indices: new Uint32Array(indices),
    };
  }
  function buildSeafloorMesh() {
    const rings = 24;
    const segs = 128;
    const verts = [];
    const indices = [];
    const y = SEA_Y - 12;
    for (let ri = 0; ri <= rings; ri++) {
      const u = ri / rings;
      const rad = 155 + 1500 * (u * u);
      for (let si = 0; si <= segs; si++) {
        const a = (si / segs) * Math.PI * 2;
        verts.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
      }
    }
    const stride = segs + 1;
    for (let ri = 0; ri < rings; ri++) {
      for (let si = 0; si < segs; si++) {
        const i0 = ri * stride + si;
        indices.push(i0, i0 + stride, i0 + 1, i0 + 1, i0 + stride, i0 + stride + 1);
      }
    }
    return {
      verts: new Float32Array(verts),
      indices: new Uint32Array(indices),
    };
  }

  function snapOrigin(x, z, area, bladesAxis) {
    const cell = area / Math.max(1, bladesAxis);
    return [Math.floor(x / cell) * cell, Math.floor(z / cell) * cell];
  }

  async function create(canvas, opts) {
    opts = opts || {};
    const onHud = opts.onHud || (() => {});
    const loadChunk = opts.loadChunk;
    if (!navigator.gpu) throw new Error("WebGPU no disponible");

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("Sin adapter WebGPU");
    const wantF16 = adapter.features.has("float16-filterable");
    // Ask for large storage so one full-island grass buffer fits
    const wantStore = Math.min(
      adapter.limits.maxStorageBufferBindingSize || 134217728,
      512 * 1024 * 1024
    );
    const wantBuf = Math.min(adapter.limits.maxBufferSize || wantStore, wantStore);
    const device = await adapter.requestDevice({
      requiredFeatures: wantF16 ? ["float16-filterable"] : [],
      requiredLimits: {
        maxStorageBufferBindingSize: wantStore,
        maxBufferSize: wantBuf,
      },
    });
    const maxStorage = device.limits.maxStorageBufferBindingSize || wantStore;
    const memoryGb = Number(navigator.deviceMemory || 0);
    const coarsePointer =
      typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    let graphicsTier = "high";
    if (
      coarsePointer ||
      (memoryGb > 0 && memoryGb <= 4) ||
      maxStorage < 160 * 1024 * 1024
    ) {
      graphicsTier = "low";
    } else if (
      !wantF16 ||
      (memoryGb > 0 && memoryGb <= 8) ||
      maxStorage < 320 * 1024 * 1024
    ) {
      graphicsTier = "medium";
    }
    const bladeAxisCap =
      graphicsTier === "high" ? 2048 : (graphicsTier === "medium" ? 1536 : 1024);
    // Pack as many blades as storage allows (full island, one bake)
    let BLADE_AXIS = bladeAxisCap;
    while (BLADE_AXIS * BLADE_AXIS * 64 > maxStorage * 0.65 && BLADE_AXIS > 512) {
      BLADE_AXIS = Math.floor(BLADE_AXIS * 0.85);
    }
    BLADE_AXIS = Math.max(512, Math.min(bladeAxisCap, BLADE_AXIS));
    const BLADE_COUNT = BLADE_AXIS * BLADE_AXIS;
    // Full island diameter (~512) + rim margin — fixed at origin, never streamed
    const GRASS_AREA = 540;
    let grassOx = 0, grassOz = 0;
    const GRASS_STREAM = false; // load once with chunk

    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    const sceneFormat = wantF16 ? "rgba16float" : "rgba8unorm";
    const bloomScale =
      graphicsTier === "high" ? 0.35 : (graphicsTier === "medium" ? 0.28 : 0.22);
    const BLOOM_BLUR_PASSES =
      graphicsTier === "high" ? 2 : (graphicsTier === "medium" ? 1 : 0);
    const GRASS_CULL_INTERVAL =
      graphicsTier === "high" ? 1 : (graphicsTier === "medium" ? 2 : 3);
    const NEAR = 0.1, FAR = 800;
    // Quality bubble — full blade tessellation near player; cheaper geometry far away
    // (texture/sample quality unchanged — only segment count & draw density)
    const HQ_RADIUS = 62;
    const GRASS_LOD0 = 28;       // 15-seg blades (tight near field)
    const GRASS_LOD1 = HQ_RADIUS; // 5-seg within bubble
    const GRASS_FAR =
      graphicsTier === "high" ? 175 : (graphicsTier === "medium" ? 140 : 110);
    const TREE_DRAW = 180;       // draw trees within
    const TREE_SHADOW = 65;      // cast tree shadows within
    const PROP_FAR = 100;        // rocks / flowers fade
    const ISLAND_HALF = 256;
    const BIOME_NAMES = ["Pradera", "Llanura", "Bosque", "Nieve", "Pantano", "Desierto"];
    const BIOME_RGB = [
      [72, 130, 48],   // pradera
      [168, 148, 58],  // llanura
      [28, 78, 36],    // bosque
      [232, 240, 248], // nieve (claro, distinto del verde)
      [42, 96, 72],    // pantano
      [186, 142, 72],  // desierto
    ];
    function biomeAtJs(x, z) {
      // Must match WGSL biome_id / Rust biome_at
      const hash21 = (ix, iz) => {
        let n = (Math.imul(ix | 0, 1597334677) + Math.imul(iz | 0, 3812015801)) >>> 0;
        n = ((n << 13) ^ n) >>> 0;
        n = Math.imul(n, 1274126177) >>> 0;
        return n / 4294967295;
      };
      const valueNoise = (px, py) => {
        const ix = Math.floor(px), iz = Math.floor(py);
        const fx = px - ix, fz = py - iz;
        const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
        const a = hash21(ix, iz), b = hash21(ix + 1, iz);
        const c = hash21(ix, iz + 1), d = hash21(ix + 1, iz + 1);
        return (a + (b - a) * ux + (c + (d - c) * ux - (a + (b - a) * ux)) * uz) * 2 - 1;
      };
      const fbm = (px, py) => {
        let s = 0, a = 1, f = 1, n = 0;
        for (let i = 0; i < 4; i++) {
          s += valueNoise(px * f, py * f) * a;
          n += a; a *= 0.5; f *= 2.02;
        }
        return s / Math.max(n, 1e-5);
      };
      const sx = x / 90, sz = z / 90;
      const warp = fbm(sx * 0.7, sz * 0.7) * 0.35;
      const warp2 = fbm(sx * 0.7 + 4, sz * 0.7 - 2) * 0.35;
      const wx = sx + warp, wz = sz + warp2;
      const temp = fbm(wx, wz) * 0.88 + 0.08;
      const moist = fbm(wx + 17, wz - 9);
      const snow_blob = fbm(x / 110, z / 110);
      if ((snow_blob > 0.28 && temp < 0.18) || temp < -0.28) return 3;
      if (temp > 0.48 && moist < -0.12) return 5;
      if (moist > 0.32) return temp > 0.05 ? 4 : 2;
      if (moist < -0.22) return 1;
      return 0;
    }

    /** Organic hill approx for map relief (warped — no circular rings). */
    function centerMtnHeight(x, z) {
      const warp = (px, pz, s, str) => {
        const wx = Math.sin(px * s + 1.7) * Math.cos(pz * s * 0.9 - 0.4) * str
          + Math.sin(px * s * 1.7 - pz * s * 0.6) * str * 0.45;
        const wz = Math.cos(px * s * 0.85 - 0.9) * Math.sin(pz * s + 0.3) * str
          + Math.cos(px * s * 0.5 + pz * s * 1.3) * str * 0.45;
        return [px + wx, pz + wz];
      };
      let [x1, z1] = warp(x, z, 0.009, 18);
      [x1, z1] = warp(x1, z1, 0.017, 9);
      const r0 = Math.hypot(x, z);
      const inland = Math.max(0, 1 - Math.max(0, (r0 - 256 * 0.4) / (256 * 0.38)));
      const broad = Math.sin(x1 * 0.007) * Math.cos(z1 * 0.0065 + 0.5);
      const mid = Math.sin(x1 * 0.013 - 0.8) * Math.cos(z1 * 0.012 + 1.1);
      const detail = Math.sin(x1 * 0.027 + z1 * 0.019) * 0.35;
      let h = ((broad * 0.5 + 0.5) * 4.8 + (mid * 0.5 + 0.5) * 2.4 + detail) * inland;
      const rw = Math.hypot(x1, z1);
      const rmax = 58 + Math.sin(x * 0.03) * Math.cos(z * 0.028) * 10;
      if (rw < rmax) {
        const u = rw / rmax;
        h += (1.8 + (broad * 0.5 + 0.5) * 1.4) * Math.pow(1 - u * u, 1.15);
      }
      return h;
    }

    // --- Compass (top-right) + full island map (M) ---
    let mapOpen = false;
    let worldMapReady = false;
    const host = canvas.parentElement || document.body;
    const compassEl = document.createElement("div");
    compassEl.className = "fw-compass";
    compassEl.setAttribute("aria-hidden", "true");
    compassEl.innerHTML =
      '<div class="fw-compass-needle" aria-hidden="true"></div>' +
      '<div class="fw-compass-rose">' +
      '<span class="fw-c-n">N</span><span class="fw-c-e">E</span>' +
      '<span class="fw-c-s">S</span><span class="fw-c-w">O</span>' +
      "</div>" +
      '<div class="fw-compass-heading">0°</div>';
    host.appendChild(compassEl);
    const compassRose = compassEl.querySelector(".fw-compass-rose");
    const compassHeadingEl = compassEl.querySelector(".fw-compass-heading");

    const mapDlg = document.createElement("dialog");
    mapDlg.id = "fw-world-map";
    mapDlg.className = "fw-map-dlg";
    mapDlg.setAttribute("aria-label", "Mapa de la isla");
    if ("closedBy" in mapDlg || "closedby" in mapDlg) {
      try { mapDlg.setAttribute("closedby", "any"); } catch (_) {}
    }
    mapDlg.innerHTML =
      '<div class="fw-map-shell">' +
      '<header class="fw-map-head">' +
      "<h2>Isla · ~0.5 km</h2>" +
      '<p class="fw-map-hint"><kbd>M</kbd> / <kbd>Esc</kbd> cerrar</p>' +
      '<button type="button" class="fw-map-close" aria-label="Cerrar">×</button>' +
      "</header>" +
      '<div class="fw-map-body">' +
      '<canvas class="fw-map-canvas" width="1024" height="1024"></canvas>' +
      '<div class="fw-map-legend"></div>' +
      '<p class="fw-map-here" aria-live="polite"></p>' +
      "</div></div>";
    document.body.appendChild(mapDlg);
    const mapCanvas = mapDlg.querySelector(".fw-map-canvas");
    const mapCtx = mapCanvas.getContext("2d", { alpha: false });
    const mapHere = mapDlg.querySelector(".fw-map-here");
    const mapLegend = mapDlg.querySelector(".fw-map-legend");
    mapLegend.innerHTML = BIOME_NAMES.map((n, i) => {
      const c = BIOME_RGB[i];
      return (
        '<span class="fw-map-swatch"><i style="background:rgb(' +
        c[0] + "," + c[1] + "," + c[2] +
        ')"></i>' + n + "</span>"
      );
    }).join("") +
      '<span class="fw-map-swatch"><i style="background:rgb(18,48,72)"></i>Océano</span>';

    /** Same silhouette as Rust/WGSL coast_radius — irregular island rim. */
    function coastRadius(x, z) {
      const hash21 = (ix, iz) => {
        let n = (Math.imul(ix | 0, 1597334677) + Math.imul(iz | 0, 3812015801)) >>> 0;
        n = ((n << 13) ^ n) >>> 0;
        n = Math.imul(n, 1274126177) >>> 0;
        return n / 4294967295;
      };
      const valueNoise = (px, py) => {
        const ix = Math.floor(px), iz = Math.floor(py);
        const fx = px - ix, fz = py - iz;
        const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
        const a = hash21(ix, iz), b = hash21(ix + 1, iz);
        const c = hash21(ix, iz + 1), d = hash21(ix + 1, iz + 1);
        return (a + (b - a) * ux + (c + (d - c) * ux - (a + (b - a) * ux)) * uz) * 2 - 1;
      };
      const fbm = (px, py) => {
        let s = 0, a = 1, f = 1, n = 0;
        for (let i = 0; i < 4; i++) { s += valueNoise(px * f, py * f) * a; n += a; a *= 0.5; f *= 2.02; }
        return s / Math.max(n, 1e-5);
      };
      const ang = Math.atan2(z, x);
      const lobes = Math.sin(ang * 2) * 0.085
        + Math.sin(ang * 3 + 1.3) * 0.06
        + Math.cos(ang * 5 + 0.7) * 0.045
        + Math.sin(ang * 9 + 2.4) * 0.028
        + Math.cos(ang * 14 - 0.9) * 0.018;
      const n = fbm(x / 480, z / 480);
      const n2 = fbm(x / 220 + 19, z / 220 - 11);
      const warp = Math.min(1.22, Math.max(0.68, 0.90 + lobes + n * 0.12 + n2 * 0.07));
      return ISLAND_HALF * warp;
    }
    function islandEdge(x, z) {
      const dist = Math.hypot(x, z);
      const rim = coastRadius(x, z);
      return Math.min(1, Math.max(0, (dist - rim * 0.72) / Math.max(rim * 0.34, 1)));
    }

    function paintWorldMapBase() {
      const size = mapCanvas.width;
      const img = mapCtx.createImageData(size, size);
      const data = img.data;
      const denom = size;
      const MAP_HALF = ISLAND_HALF * 1.35; // island + sea ring
      for (let py = 0; py < size; py++) {
        // Top of map = North = −Z (matches compass). Sample pixel centers.
        const wz = ((py + 0.5) / denom - 0.5) * 2 * MAP_HALF;
        for (let px = 0; px < size; px++) {
          const wx = ((px + 0.5) / denom - 0.5) * 2 * MAP_HALF;
          const o = (py * size + px) * 4;
          const edge = islandEdge(wx, wz);
          if (edge > 0.55) {
            const deep = Math.min(1, (edge - 0.55) / 0.45);
            data[o] = (10 + deep * 14) | 0;
            data[o + 1] = (40 + deep * 18) | 0;
            data[o + 2] = (62 + deep * 28) | 0;
            data[o + 3] = 255;
          } else {
            const bid = biomeAtJs(wx, wz);
            let c0 = BIOME_RGB[bid][0], c1 = BIOME_RGB[bid][1], c2 = BIOME_RGB[bid][2];
            // Wide sandy shoreline on the map (matches fs_terrain beach bands)
            const beach = edge > 0.0 ? Math.min(1, edge / 0.38) : 0;
            const wet = edge > 0.28 ? Math.min(1, (edge - 0.28) / 0.22) : 0;
            const sand0 = 220, sand1 = 198, sand2 = 148;
            const wet0 = 110, wet1 = 96, wet2 = 72;
            c0 = c0 * (1 - beach) + sand0 * beach;
            c1 = c1 * (1 - beach) + sand1 * beach;
            c2 = c2 * (1 - beach) + sand2 * beach;
            c0 = c0 * (1 - wet) + wet0 * wet;
            c1 = c1 * (1 - wet) + wet1 * wet;
            c2 = c2 * (1 - wet) + wet2 * wet;
            // Centre mountain relief: hillshade + elevation tint + contour rings
            const h = centerMtnHeight(wx, wz);
            if (h > 0.4) {
              const hx = centerMtnHeight(wx + 10, wz) - centerMtnHeight(wx - 10, wz);
              const hz = centerMtnHeight(wx, wz + 10) - centerMtnHeight(wx, wz - 10);
              const inv = 1 / Math.hypot(hx, 20, hz);
              const ndl = Math.max(0, (-hx * 0.45 + 20 * 0.75 - hz * 0.35) * inv);
              const elev = Math.min(1, h / 10);
              // Peak brighter white; slopes shaded
              const peak = [245, 248, 252];
              const shade = 0.55 + ndl * 0.55;
              c0 = (c0 * (1 - elev * 0.85) + peak[0] * elev * 0.85) * shade;
              c1 = (c1 * (1 - elev * 0.85) + peak[1] * elev * 0.85) * shade;
              c2 = (c2 * (1 - elev * 0.85) + peak[2] * elev * 0.85) * shade;
              // Soft organic contour hint (warped spacing — not ruler rings)
              const cnoise = Math.sin(wx * 0.045 + wz * 0.038) * 0.7
                + Math.cos(wx * 0.02 - wz * 0.031) * 0.5;
              const band = Math.abs((((h + cnoise) / 5.5) % 1) - 0.5);
              if (band > 0.44 && h > 3.5) {
                const soft = (band - 0.44) / 0.06;
                const k = 1 - soft * 0.12;
                c0 *= k; c1 *= k; c2 *= k * 0.98;
              }
            }
            data[o] = Math.min(255, c0) | 0;
            data[o + 1] = Math.min(255, c1) | 0;
            data[o + 2] = Math.min(255, c2) | 0;
            data[o + 3] = 255;
          }
        }
      }
      mapCtx.putImageData(img, 0, 0);
      mapCtx.strokeStyle = "rgba(255,255,255,0.18)";
      mapCtx.lineWidth = 1;
      mapCtx.beginPath();
      mapCtx.moveTo(size / 2, 8);
      mapCtx.lineTo(size / 2, size - 8);
      mapCtx.moveTo(8, size / 2);
      mapCtx.lineTo(size - 8, size / 2);
      mapCtx.stroke();
      // Centre mountain glyph on map
      mapCtx.save();
      mapCtx.strokeStyle = "rgba(255,255,255,0.55)";
      mapCtx.fillStyle = "rgba(220,230,240,0.35)";
      mapCtx.lineWidth = 1.5;
      const cx = size / 2, cy = size / 2;
      const pr = size * 0.028;
      mapCtx.beginPath();
      mapCtx.moveTo(cx, cy - pr * 1.6);
      mapCtx.lineTo(cx + pr * 1.4, cy + pr * 0.9);
      mapCtx.lineTo(cx - pr * 1.4, cy + pr * 0.9);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.stroke();
      mapCtx.restore();
      // N label
      mapCtx.fillStyle = "#e85d4c";
      mapCtx.font = "bold 18px IBM Plex Mono, monospace";
      mapCtx.textAlign = "center";
      mapCtx.fillText("N", size / 2, 22);
      worldMapReady = true;
      mapCanvas._base = document.createElement("canvas");
      mapCanvas._base.width = size;
      mapCanvas._base.height = size;
      mapCanvas._base.getContext("2d").drawImage(mapCanvas, 0, 0);
    }

    function worldToMap(wx, wz) {
      const size = mapCanvas.width;
      // Inverse of paint: pixel center mapping → continuous marker pos
      const MAP_HALF = ISLAND_HALF * 1.35;
      const px = (wx / MAP_HALF * 0.5 + 0.5) * size - 0.5;
      const py = (wz / MAP_HALF * 0.5 + 0.5) * size - 0.5;
      return [px, py];
    }

    function facingYaw() {
      if (camMode === "fpv") return player.yaw;
      // Camera look into the scene
      return Math.atan2(-Math.sin(orbitYaw), -Math.cos(orbitYaw));
    }

    /** Degrees from North (-Z), clockwise-friendly for UI. */
    function headingDeg() {
      const yaw = facingYaw();
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      let deg = (Math.atan2(fx, -fz) * 180) / Math.PI;
      if (deg < 0) deg += 360;
      return deg;
    }

    function redrawMapOverlay() {
      if (!worldMapReady || !mapCanvas._base) return;
      mapCtx.drawImage(mapCanvas._base, 0, 0);
      const [px, py] = worldToMap(player.x, player.z);
      const yaw = facingYaw();
      const bid = biomeAtJs(player.x, player.z);
      if (mapHere) {
        const kmX = (player.x / 1000).toFixed(2);
        const kmZ = (player.z / 1000).toFixed(2);
        mapHere.textContent =
          "Aquí · " + BIOME_NAMES[bid] + " · " + kmX + ", " + kmZ + " km  (N ↑ −Z)";
      }
      // Crosshair ring at exact player cell
      mapCtx.beginPath();
      mapCtx.arc(px, py, 10, 0, Math.PI * 2);
      mapCtx.strokeStyle = "rgba(232, 93, 76, 0.85)";
      mapCtx.lineWidth = 2;
      mapCtx.stroke();
      // Map: +X right, +Z down. yaw 0 faces +Z → tip toward bottom.
      mapCtx.save();
      mapCtx.translate(px, py);
      mapCtx.rotate(yaw);
      mapCtx.beginPath();
      mapCtx.moveTo(0, 14);
      mapCtx.lineTo(-7, -8);
      mapCtx.lineTo(7, -8);
      mapCtx.closePath();
      mapCtx.fillStyle = "#f2f0e6";
      mapCtx.strokeStyle = "#1a1a12";
      mapCtx.lineWidth = 1.5;
      mapCtx.fill();
      mapCtx.stroke();
      mapCtx.beginPath();
      mapCtx.arc(0, 0, 3.5, 0, Math.PI * 2);
      mapCtx.fillStyle = "#e85d4c";
      mapCtx.fill();
      mapCtx.restore();
      // Sleeping bags + TC markers
      try {
        for (let i = 0; i < buildPieces.length; i++) {
          const bp = buildPieces[i];
          if (bp.type !== "sleeping_bag" && bp.type !== "toolcupboard") continue;
          if (bp.type === "sleeping_bag" && bp.ownerId && bp.ownerId !== LOCAL_PLAYER_ID) continue;
          const w = furnitureWorldPos(bp);
          const [mx, my] = worldToMap(w.x, w.z);
          mapCtx.beginPath();
          if (bp.type === "sleeping_bag") {
            mapCtx.fillStyle = "rgba(120, 190, 255, 0.95)";
            mapCtx.strokeStyle = "rgba(20, 40, 70, 0.9)";
            mapCtx.arc(mx, my, 4.5, 0, Math.PI * 2);
            mapCtx.fill();
            mapCtx.lineWidth = 1;
            mapCtx.stroke();
          } else {
            mapCtx.fillStyle = "rgba(220, 180, 70, 0.95)";
            mapCtx.fillRect(mx - 3.5, my - 3.5, 7, 7);
            mapCtx.strokeStyle = "rgba(40, 30, 10, 0.85)";
            mapCtx.lineWidth = 1;
            mapCtx.strokeRect(mx - 3.5, my - 3.5, 7, 7);
          }
        }
      } catch (_) {}
    }

    function setMapOpen(on) {
      const next = !!on;
      if (next === mapOpen) return;
      mapOpen = next;
      try { playUiSfx(mapOpen ? "panel_open" : "panel_close"); } catch (_) {}
      if (mapOpen) {
        try { syncCursorForUi(); } catch (_) {}
        if (!worldMapReady) paintWorldMapBase();
        redrawMapOverlay();
        if (typeof mapDlg.showModal === "function") mapDlg.showModal();
        else mapDlg.setAttribute("open", "");
      } else {
        if (typeof mapDlg.close === "function") mapDlg.close();
        else mapDlg.removeAttribute("open");
        try { syncCursorForUi(); } catch (_) {}
      }
    }
    function toggleMap() {
      setMapOpen(!mapOpen);
    }
    mapDlg.querySelector(".fw-map-close").addEventListener("click", () => setMapOpen(false));
    mapDlg.addEventListener("click", (e) => {
      // light-dismiss fallback
      if (e.target === mapDlg) setMapOpen(false);
    });
    mapDlg.addEventListener("close", () => {
      mapOpen = false;
      try { syncCursorForUi(); } catch (_) {}
    });
    // Lazy-build map after first frame so boot stays snappy
    requestAnimationFrame(() => {
      try { paintWorldMapBase(); } catch (e) { console.warn("[map]", e); }
    });

    function updateCompass() {
      const deg = headingDeg();
      if (compassRose) compassRose.style.transform = "rotate(" + (-deg) + "deg)";
      if (compassHeadingEl) compassHeadingEl.textContent = Math.round(deg) + "°";
      compassEl.dataset.visible = controlsEnabled ? "1" : "0";
      if (mapOpen) redrawMapOverlay();
    }

    function configure() {
      const rect = canvas.getBoundingClientRect();
      // Prefer client box; fall back to window so we never letterbox a tiny default
      let cssW = rect.width || canvas.clientWidth || 0;
      let cssH = rect.height || canvas.clientHeight || 0;
      if (cssW < 2 || cssH < 2) {
        cssW = window.innerWidth || 1280;
        cssH = window.innerHeight || 720;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 1.35);
      let w = Math.max(1, Math.floor(cssW * dpr));
      let h = Math.max(1, Math.floor(cssH * dpr));
      // Cap at ~1080p-class so "full HD" stays sharp without 4K fillrate cost
      const maxLong = 1920;
      const long = Math.max(w, h);
      if (long > maxLong) {
        const s = maxLong / long;
        w = Math.max(1, Math.floor(w * s));
        h = Math.max(1, Math.floor(h * s));
      }
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      context.configure({
        device, format, alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      return { w, h };
    }
    let size = configure();
    function destroyTex(tex) { try { tex && tex.destroy(); } catch (_) {} }

    let depth, sceneColor, bloomA, bloomB, dofTex, compTex, taaTex, historyTex, avatarAtlas;
    let sceneView, bloomAView, bloomBView, dofView, depthView, compView, taaView, historyView, avatarAtlasView;
    let getAvatarAtlas = null;
    let taaReady = false;
    let renderTargetEpoch = 0;
    function rebuildTargets() {
      destroyTex(depth); destroyTex(sceneColor); destroyTex(bloomA); destroyTex(bloomB);
      destroyTex(dofTex); destroyTex(compTex); destroyTex(taaTex); destroyTex(historyTex); destroyTex(avatarAtlas);
      taaReady = false;
      depth = device.createTexture({
        size: [size.w, size.h],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      sceneColor = device.createTexture({
        size: [size.w, size.h], format: sceneFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      const bw = Math.max(1, Math.floor(size.w * bloomScale));
      const bh = Math.max(1, Math.floor(size.h * bloomScale));
      bloomA = device.createTexture({
        size: [bw, bh], format: sceneFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      bloomB = device.createTexture({
        size: [bw, bh], format: sceneFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      dofTex = device.createTexture({
        size: [Math.max(1, size.w >> 1), Math.max(1, size.h >> 1)],
        format: sceneFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      compTex = device.createTexture({
        size: [size.w, size.h], format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      taaTex = device.createTexture({
        size: [size.w, size.h], format: "rgba8unorm",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
      });
      historyTex = device.createTexture({
        size: [size.w, size.h], format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      // Double-height atlas from VRM (color | depth)
      avatarAtlas = device.createTexture({
        size: [size.w, size.h * 2], format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      sceneView = sceneColor.createView();
      bloomAView = bloomA.createView();
      bloomBView = bloomB.createView();
      dofView = dofTex.createView();
      depthView = depth.createView();
      compView = compTex.createView();
      taaView = taaTex.createView();
      historyView = historyTex.createView();
      avatarAtlasView = avatarAtlas.createView();
      renderTargetEpoch++;
    }
    rebuildTargets();

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        const next = configure();
        if (next.w !== size.w || next.h !== size.h) {
          size = next;
          rebuildTargets();
        }
      }).observe(canvas.parentElement || canvas);
    }

    async function assertShader(mod, label) {
      const info = await mod.getCompilationInfo();
      const errs = info.messages.filter((m) => m.type === "error");
      if (errs.length) {
        const msg = errs.map((e) => (label + ": " + e.message + (e.lineNum ? " @" + e.lineNum + ":" + e.linePos : ""))).join(" | ");
        console.error("[WGSL]", msg);
        onHud({ status: "WGSL error — " + msg.slice(0, 160) });
        throw new Error(msg);
      }
    }
    const sceneModule = device.createShaderModule({ label: "fw-scene", code: SCENE_WGSL });
    const initModule = device.createShaderModule({ label: "fw-init", code: COMPUTE_WGSL });
    const cullModule = device.createShaderModule({ label: "fw-cull", code: CULL_WGSL });
    const postModule = device.createShaderModule({ label: "fw-post", code: POST_WGSL });
    const skyModule = device.createShaderModule({ label: "fw-sky", code: SKY_WGSL });
    await assertShader(sceneModule, "scene");
    await assertShader(skyModule, "sky");

    // Procedural day/night sky (horizon + clouds + sun/moon discs)
    const skyParamBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const skyBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: {} },
      ],
    });
    const skyPipe = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [skyBgl] }),
      vertex: { module: skyModule, entryPoint: "vs_sky" },
      fragment: { module: skyModule, entryPoint: "fs_sky", targets: [{ format: sceneFormat }] },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: false,
        depthCompare: "less-equal",
      },
    });
    const skyBindGroup = device.createBindGroup({
      layout: skyBgl,
      entries: [{ binding: 0, resource: { buffer: skyParamBuf } }],
    });

    const frameBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const postParamBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const genBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cullBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const SHADOW_RES = 1024;
    const SHADOW_CASCADES = 3;
    const shadowBuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const shadowMap = device.createTexture({
      size: [SHADOW_RES, SHADOW_RES, SHADOW_CASCADES],
      format: "depth32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const shadowMapView = shadowMap.createView({ dimension: "2d-array" });
    const shadowCascadeViews = [0, 1, 2].map((i) => shadowMap.createView({
      dimension: "2d", baseArrayLayer: i, arrayLayerCount: 1,
    }));
    const shadowSamp = device.createSampler({
      compare: "less",
      magFilter: "linear",
      minFilter: "linear",
    });

    const frameBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "non-filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "comparison" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth", viewDimension: "2d-array" } },
        { binding: 5, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
      ],
    });
    const grassBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    const framePipeLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBgl] });
    const grassPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBgl, grassBgl] });

    // HDR IBL (False Earth potsdamer_platz_1k) — must match the Float32 source
    // bytes. Using rgba16float here used to reinterpret f32 bit patterns as
    // half-floats → neon magenta/purple on high-metalness build materials.
    const envSamp = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    let envTex = null;
    let envView = null;
    function uploadEnvF32(w, h, f32) {
      envTex = device.createTexture({
        size: [w, h],
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      // rgba32float = 16 bytes/texel; bytesPerRow must be 256-byte aligned.
      const bpr = Math.max(256, ((w * 16 + 255) >> 8) << 8);
      let data = f32;
      if (bpr !== w * 16) {
        const padded = new Float32Array((bpr / 4) * h);
        for (let y = 0; y < h; y++) {
          padded.set(f32.subarray(y * w * 4, (y + 1) * w * 4), y * (bpr / 4));
        }
        data = padded;
      }
      device.queue.writeTexture(
        { texture: envTex },
        data,
        { bytesPerRow: bpr, rowsPerImage: h },
        [w, h]
      );
      envView = envTex.createView();
    }
    async function loadEnvMap() {
      try {
        const meta = await fetch("/textures/potsdamer_platz_1k.json").then((r) => {
          if (!r.ok) throw new Error("no meta");
          return r.json();
        });
        const ab = await fetch("/textures/potsdamer_platz_1k.rgba32f").then((r) => {
          if (!r.ok) throw new Error("no hdr bin");
          return r.arrayBuffer();
        });
        const w = meta.width | 0, h = meta.height | 0;
        const expected = w * h * 16;
        if (ab.byteLength < expected) throw new Error("hdr size");
        uploadEnvF32(w, h, new Float32Array(ab.slice(0, expected)));
        return;
      } catch (_) {}
      try {
        const img = await createImageBitmap(await fetch("/textures/potsdamer_platz_1k.png").then((r) => {
          if (!r.ok) throw new Error("no png");
          return r.blob();
        }));
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const rgba = ctx.getImageData(0, 0, c.width, c.height).data;
        const f32 = new Float32Array(c.width * c.height * 4);
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 4) {
          f32[j] = Math.pow(rgba[i] / 255, 2.2) * 3.5;
          f32[j + 1] = Math.pow(rgba[i + 1] / 255, 2.2) * 3.5;
          f32[j + 2] = Math.pow(rgba[i + 2] / 255, 2.2) * 3.5;
          f32[j + 3] = 1;
        }
        uploadEnvF32(c.width, c.height, f32);
        return;
      } catch (_) {}
      // Procedural 2×2 sky/ground fallback
      const f32 = new Float32Array([
        0.35, 0.45, 0.7, 1,  0.55, 0.65, 0.85, 1,
        0.25, 0.2, 0.12, 1,  0.4, 0.35, 0.2, 1,
      ]);
      uploadEnvF32(2, 2, f32);
    }
    await loadEnvMap();

    const frameBind = device.createBindGroup({
      layout: frameBgl,
      entries: [
        { binding: 0, resource: { buffer: frameBuf } },
        { binding: 1, resource: envSamp },
        { binding: 2, resource: envView },
        { binding: 3, resource: shadowSamp },
        { binding: 4, resource: shadowMapView },
        { binding: 5, resource: { buffer: shadowBuf } },
      ],
    });
    // Dummy depth so shadow-cast pass does not bind the target as a sampled texture
    const shadowDummy = device.createTexture({
      size: [4, 4, 1],
      format: "depth32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const shadowCastBind = device.createBindGroup({
      layout: frameBgl,
      entries: [
        { binding: 0, resource: { buffer: frameBuf } },
        { binding: 1, resource: envSamp },
        { binding: 2, resource: envView },
        { binding: 3, resource: shadowSamp },
        { binding: 4, resource: shadowDummy.createView({ dimension: "2d-array" }) },
        { binding: 5, resource: { buffer: shadowBuf } },
      ],
    });

    const depthStencil = { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" };

    const terrainPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_terrain",
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
          ],
        }],
      },
      fragment: { module: sceneModule, entryPoint: "fs_terrain", targets: [{ format: sceneFormat }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
    });

    const shadowTerrainPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_terrain",
        buffers: [{
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x3" },
          ],
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });
    function makeGrassPipe(entry) {
      return device.createRenderPipeline({
        layout: grassPipeLayout,
        vertex: { module: sceneModule, entryPoint: entry, buffers: [] },
        fragment: { module: sceneModule, entryPoint: "fs_grass", targets: [{ format: sceneFormat }] },
        primitive: { topology: "triangle-strip", cullMode: "none" },
        depthStencil,
      });
    }

    const oceanSimModule = device.createShaderModule({ label: "fw-ocean-sim", code: OCEAN_SIM_WGSL });
    const oceanModule = device.createShaderModule({ label: "fw-ocean", code: OCEAN_WGSL });
    const oceanFloorModule = device.createShaderModule({ label: "fw-ocean-floor", code: OCEAN_FLOOR_WGSL });
    await assertShader(oceanModule, "ocean");
    await assertShader(oceanFloorModule, "ocean-floor");

    const oceanSimBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: "unfilterable-float" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: "write-only", format: "rgba16float" } },
      ],
    });
    const oceanDrawBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 4, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const oceanPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBgl, oceanDrawBgl] });
    const oceanSimPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [oceanSimBgl] });

    const makeOceanTex = (fmt, usage) => device.createTexture({
      size: [OCEAN_SIM_RES, OCEAN_SIM_RES],
      format: fmt,
      usage,
    });
    const cascadeUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const foamUsage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST;
    const cascade0Tex = makeOceanTex("rgba16float", cascadeUsage);
    const cascade1Tex = makeOceanTex("rgba16float", cascadeUsage);
    const foamTexA = makeOceanTex("rgba16float", foamUsage);
    const foamTexB = makeOceanTex("rgba16float", foamUsage);
    let foamFlip = 0;
    {
      const z = new Uint16Array(OCEAN_SIM_RES * OCEAN_SIM_RES * 4);
      device.queue.writeTexture({ texture: foamTexA }, z, { bytesPerRow: OCEAN_SIM_RES * 8 }, [OCEAN_SIM_RES, OCEAN_SIM_RES]);
      device.queue.writeTexture({ texture: foamTexB }, z, { bytesPerRow: OCEAN_SIM_RES * 8 }, [OCEAN_SIM_RES, OCEAN_SIM_RES]);
    }

    const oceanSimParamsBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const oceanDrawParamsBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const oceanSamp = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "repeat", addressModeV: "repeat" });

    const oceanSimPipe = device.createComputePipeline({
      layout: oceanSimPipeLayout,
      compute: { module: oceanSimModule, entryPoint: "cs_ocean_sim" },
    });

    const oceanMesh = buildOceanMesh();
    const oceanVbo = device.createBuffer({
      size: oceanMesh.verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(oceanVbo.getMappedRange()).set(oceanMesh.verts);
    oceanVbo.unmap();
    const oceanIbo = device.createBuffer({
      size: oceanMesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(oceanIbo.getMappedRange()).set(oceanMesh.indices);
    oceanIbo.unmap();
    const oceanIndexCount = oceanMesh.indices.length;

    const floorMesh = buildSeafloorMesh();
    const floorVbo = device.createBuffer({
      size: floorMesh.verts.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(floorVbo.getMappedRange()).set(floorMesh.verts);
    floorVbo.unmap();
    const floorIbo = device.createBuffer({
      size: floorMesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(floorIbo.getMappedRange()).set(floorMesh.indices);
    floorIbo.unmap();
    const floorIndexCount = floorMesh.indices.length;

    const oceanPipe = device.createRenderPipeline({
      layout: oceanPipeLayout,
      vertex: {
        module: oceanModule, entryPoint: "vs_ocean",
        buffers: [{
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        }],
      },
      fragment: {
        module: oceanModule, entryPoint: "fs_ocean",
        targets: [{
          format: sceneFormat,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });
    const floorPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: oceanFloorModule, entryPoint: "vs_floor",
        buffers: [{
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
        }],
      },
      fragment: {
        module: oceanFloorModule, entryPoint: "fs_floor",
        targets: [{ format: sceneFormat }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    const oceanCascade0View = cascade0Tex.createView();
    const oceanCascade1View = cascade1Tex.createView();
    const oceanFoamViews = [foamTexA.createView(), foamTexB.createView()];
    const oceanSimBinds = [0, 1].map((flip) =>
      device.createBindGroup({
        layout: oceanSimBgl,
        entries: [
          { binding: 0, resource: { buffer: oceanSimParamsBuf } },
          { binding: 1, resource: oceanCascade0View },
          { binding: 2, resource: oceanCascade1View },
          { binding: 3, resource: oceanFoamViews[flip] },
          { binding: 4, resource: oceanFoamViews[1 - flip] },
        ],
      })
    );
    const oceanDrawBinds = [0, 1].map((flip) =>
      device.createBindGroup({
        layout: oceanDrawBgl,
        entries: [
          { binding: 0, resource: oceanSamp },
          { binding: 1, resource: oceanCascade0View },
          { binding: 2, resource: oceanCascade1View },
          { binding: 3, resource: oceanFoamViews[flip] },
          { binding: 4, resource: { buffer: oceanDrawParamsBuf } },
        ],
      })
    );

    const grassPipe15 = makeGrassPipe("vs_grass15");
    const grassPipe5 = makeGrassPipe("vs_grass5");
    const grassPipe2 = makeGrassPipe("vs_grass2");

    let _shadowCascades = null;
    let _celestial = { tod: 0.35, sunTo: [0,1,0], moonTo: [0,-1,0], dayW: 1, nightW: 0, duskW: 0 };
    const STAR_N = 9000;
    const starData = new Float32Array(STAR_N * 4);
    for (let i = 0; i < STAR_N; i++) {
      const u = Math.random() * Math.PI * 2;
      // Bias toward upper hemisphere for denser FE-like sky
      const v = Math.acos(Math.pow(Math.random(), 0.55));
      starData[i * 4] = Math.sin(v) * Math.cos(u);
      starData[i * 4 + 1] = Math.abs(Math.cos(v));
      starData[i * 4 + 2] = Math.sin(v) * Math.sin(u);
      starData[i * 4 + 3] = 0.35 + Math.random() * 1.1;
    }
    const starVbo = device.createBuffer({
      size: starData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(starVbo.getMappedRange()).set(starData);
    starVbo.unmap();
    const starPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_star",
        buffers: [{
          arrayStride: 16,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32" },
          ],
        }],
      },
      fragment: { module: sceneModule, entryPoint: "fs_star", targets: [{ format: sceneFormat }] },
      primitive: { topology: "point-list" },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "less" },
    });

    const beamPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_beam",
        buffers: [{
          arrayStride: 28,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_beam",
        targets: [{
          format: sceneFormat,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "less" },
    });

    const rosePipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_rose",
        buffers: [{
          arrayStride: 36,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32x4" },
          ],
        }],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_rose",
        targets: [{
          format: sceneFormat,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "less" },
    });

    const birdPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_bird",
        buffers: [{
          arrayStride: 48,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32x4" },
            { shaderLocation: 3, offset: 36, format: "float32x3" },
          ],
        }],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_bird",
        targets: [{
          format: sceneFormat,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "less" },
    });

    const rockPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_rock",
        buffers: [{
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32x4" },
            { shaderLocation: 3, offset: 36, format: "float32" },
          ],
        }],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_rock",
        targets: [{ format: sceneFormat }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    const buildVertBuf = {
      arrayStride: 44,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x3" },
        { shaderLocation: 3, offset: 36, format: "float32x2" },
      ],
    };
    const buildPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_build",
        buffers: [buildVertBuf],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_build",
        targets: [{ format: sceneFormat }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil,
    });
    const ghostPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_build",
        buffers: [buildVertBuf],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_build_ghost",
        targets: [{
          format: sceneFormat,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "less" },
    });
    const fxPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_build",
        buffers: [buildVertBuf],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_build_fx",
        targets: [{
          format: sceneFormat,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "less" },
    });
    const shadowBuildPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_build",
        buffers: [buildVertBuf],
      },
      fragment: { module: sceneModule, entryPoint: "fs_shadow_build", targets: [] },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    const treePipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_tree",
        buffers: [{
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32x4" },
            { shaderLocation: 3, offset: 36, format: "float32" },
          ],
        }],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_tree",
        targets: [{ format: sceneFormat }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    // Compute pipelines

    const shadowTreePipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_tree",
        buffers: [{
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32x4" },
            { shaderLocation: 3, offset: 36, format: "float32" },
          ],
        }],
      },
      fragment: { module: sceneModule, entryPoint: "fs_shadow_tree", targets: [] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    const shadowGrassPipe = device.createRenderPipeline({
      layout: grassPipeLayout,
      vertex: { module: sceneModule, entryPoint: "vs_grass_shadow", buffers: [] },
      fragment: { module: sceneModule, entryPoint: "fs_shadow_grass", targets: [] },
      primitive: { topology: "triangle-strip", cullMode: "none" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    const shadowRockPipe = device.createRenderPipeline({
      layout: framePipeLayout,
      vertex: {
        module: sceneModule, entryPoint: "vs_rock",
        buffers: [{
          arrayStride: 40,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32x4" },
            { shaderLocation: 3, offset: 36, format: "float32" },
          ],
        }],
      },
      fragment: { module: sceneModule, entryPoint: "fs_shadow_rock", targets: [] },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: "depth32float", depthWriteEnabled: true, depthCompare: "less" },
    });

    const initBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      ],
    });
    const cullReadBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });
    const cullWriteBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const initPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [initBgl] }),
      compute: { module: initModule, entryPoint: "init_blades" },
    });
    const cullPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [cullReadBgl, cullWriteBgl] }),
      compute: { module: cullModule, entryPoint: "cull_lod" },
    });

    // Allocate grass GPU buffers (STORAGE only — grass pulls via storage, not vertex attrs)
    const bladesBuf = device.createBuffer({
      size: BLADE_COUNT * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "blades",
    });
    const heightBuf = device.createBuffer({
      size: 512 * 512 * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "heights",
    });
    const ROCK_OCC_N = 256;
    const ROCK_OCC_CELL = (ISLAND_HALF * 2) / ROCK_OCC_N; // 2 m
    const rockOccCpu = new Float32Array(ROCK_OCC_N * ROCK_OCC_N);
    /** Snapshot of rock-only occupancy; builds restamp on top when pieces change */
    let rockOccBase = new Float32Array(ROCK_OCC_N * ROCK_OCC_N);
    const rockOccBuf = device.createBuffer({
      size: rockOccCpu.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "rock-occ",
    });
    const stampRockOcc = (x, z, r) => {
      const clearR = Math.max(0.75, r * 1.85);
      const half = ISLAND_HALF;
      const i0 = Math.max(0, Math.floor((x - clearR + half) / ROCK_OCC_CELL));
      const i1 = Math.min(ROCK_OCC_N - 1, Math.floor((x + clearR + half) / ROCK_OCC_CELL));
      const j0 = Math.max(0, Math.floor((z - clearR + half) / ROCK_OCC_CELL));
      const j1 = Math.min(ROCK_OCC_N - 1, Math.floor((z + clearR + half) / ROCK_OCC_CELL));
      const clearR2 = clearR * clearR;
      for (let jz = j0; jz <= j1; jz++) {
        for (let ix = i0; ix <= i1; ix++) {
          const cx = -half + (ix + 0.5) * ROCK_OCC_CELL;
          const cz = -half + (jz + 0.5) * ROCK_OCC_CELL;
          const d2 = (cx - x) * (cx - x) + (cz - z) * (cz - z);
          if (d2 > clearR2) continue;
          const fall = 1 - Math.sqrt(d2) / clearR;
          const idx = jz * ROCK_OCC_N + ix;
          if (fall > rockOccCpu[idx]) rockOccCpu[idx] = fall;
        }
      }
    };
    const lod0Buf = device.createBuffer({
      size: BLADE_COUNT * 4,
      usage: GPUBufferUsage.STORAGE,
      label: "lod0",
    });
    const lod1Buf = device.createBuffer({
      size: BLADE_COUNT * 4,
      usage: GPUBufferUsage.STORAGE,
      label: "lod1",
    });
    const lod2Buf = device.createBuffer({
      size: BLADE_COUNT * 4,
      usage: GPUBufferUsage.STORAGE,
      label: "lod2",
    });
    // Separate STORAGE (atomics) from INDIRECT to avoid usage hazards on some backends
    const drawsStorageBuf = device.createBuffer({
      size: 3 * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
      label: "draws-storage",
    });
    const drawsIndirectBuf = device.createBuffer({
      size: 3 * 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
      label: "draws-indirect",
    });
    // (segs+1)*2 verts * 3 clump blades
    const drawsClear = new Uint32Array([
      96, 0, 0, 0,  // 15-seg * 3
      36, 0, 0, 0,  // 5-seg * 3
      18, 0, 0, 0,  // 2-seg * 3
    ]);

    const initBind = device.createBindGroup({
      layout: initBgl,
      entries: [
        { binding: 0, resource: { buffer: bladesBuf } },
        { binding: 1, resource: { buffer: heightBuf } },
        { binding: 2, resource: { buffer: genBuf } },
        { binding: 3, resource: { buffer: rockOccBuf } },
      ],
    });
    const cullReadBind = device.createBindGroup({
      layout: cullReadBgl,
      entries: [
        { binding: 0, resource: { buffer: bladesBuf } },
        { binding: 1, resource: { buffer: cullBuf } },
      ],
    });
    const cullWriteBind = device.createBindGroup({
      layout: cullWriteBgl,
      entries: [
        { binding: 0, resource: { buffer: lod0Buf } },
        { binding: 1, resource: { buffer: lod1Buf } },
        { binding: 2, resource: { buffer: lod2Buf } },
        { binding: 3, resource: { buffer: drawsStorageBuf } },
      ],
    });

    function grassBind(idxBuf) {
      return device.createBindGroup({
        layout: grassBgl,
        entries: [
          { binding: 0, resource: { buffer: bladesBuf } },
          { binding: 1, resource: { buffer: idxBuf } },
          { binding: 2, resource: { buffer: rockOccBuf } },
        ],
      });
    }
    const grassBind0 = grassBind(lod0Buf);
    const grassBind1 = grassBind(lod1Buf);
    const grassBind2 = grassBind(lod2Buf);

    // Post
    const postSamp = device.createSampler({
      magFilter: "linear", minFilter: "linear",
      addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge",
    });
    const postBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    const postLayout = device.createPipelineLayout({ bindGroupLayouts: [postBgl] });
    function makePostPipe(entry, outFormat) {
      return device.createRenderPipeline({
        layout: postLayout,
        vertex: { module: postModule, entryPoint: "vs_post" },
        fragment: { module: postModule, entryPoint: entry, targets: [{ format: outFormat }] },
        primitive: { topology: "triangle-list" },
      });
    }
    const brightPipe = makePostPipe("fs_bright", sceneFormat);
    const blurHPipe = makePostPipe("fs_blur_h", sceneFormat);
    const blurVPipe = makePostPipe("fs_blur_v", sceneFormat);
    const dofPipe = makePostPipe("fs_dof_blur", sceneFormat);
    // Meadow tonemap → intermediate (then depth-merge avatar)
    const compPipe = makePostPipe("fs_composite", "rgba8unorm");
    const taaPipe = makePostPipe("fs_taa", "rgba8unorm");

    const mergeBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "depth" } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: {} },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      ],
    });
    const mergeLayout = device.createPipelineLayout({ bindGroupLayouts: [mergeBgl] });
    const mergePipe = device.createRenderPipeline({
      layout: mergeLayout,
      vertex: { module: postModule, entryPoint: "vs_post" },
      fragment: { module: postModule, entryPoint: "fs_avatar_merge", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    function makePostBind(texA, texB, softView) {
      const soft = softView || texA;
      return device.createBindGroup({
        layout: postBgl,
        entries: [
          { binding: 0, resource: postSamp },
          { binding: 1, resource: texA },
          { binding: 2, resource: texB || texA },
          { binding: 3, resource: depthView },
          { binding: 4, resource: { buffer: postParamBuf } },
          { binding: 5, resource: soft },
        ],
      });
    }

    function makeMergeBind(meadowView) {
      return device.createBindGroup({
        layout: mergeBgl,
        entries: [
          { binding: 0, resource: postSamp },
          { binding: 1, resource: meadowView },
          { binding: 2, resource: meadowView },
          { binding: 3, resource: depthView },
          { binding: 4, resource: { buffer: postParamBuf } },
          { binding: 5, resource: meadowView },
          { binding: 6, resource: avatarAtlasView },
        ],
      });
    }
    let cachedTargetEpoch = -1;
    let cachedFrameBinds = null;
    function frameBinds() {
      if (cachedFrameBinds && cachedTargetEpoch === renderTargetEpoch) {
        return cachedFrameBinds;
      }
      cachedTargetEpoch = renderTargetEpoch;
      cachedFrameBinds = {
        scene: makePostBind(sceneView, sceneView),
        bloomA: makePostBind(bloomAView, bloomAView),
        bloomB: makePostBind(bloomBView, bloomBView),
        composite: makePostBind(sceneView, bloomAView, dofView),
        merge: makeMergeBind(compView),
      };
      return cachedFrameBinds;
    }

    let terrainVbo = null, terrainIbo = null, terrainIndexCount = 0;
    let chunk = null, baking = false, grassReady = false;
    let grassCullFrame = 0;
    let beamVbo = null, beamVertCount = 0;
    let roseVbo = null, roseVertCount = 0;
    let birdVbo = null, birdVertCount = 0;
    let rockVbo = null, rockVertCount = 0;
    let treeVbo = null, treeVertCount = 0;
    /** CPU copies for sinking harvested tree/rock verts without full rebake */
    let treeMeshCpu = null;
    let rockMeshCpu = null;
    /** Solid trunk colliders: {x,z,r} world units */
    let treeColliders = [];
    /** Solid boulder colliders: {x,z,r} world units */

    let rockColliders = [];
    /** World props that block building: {x,z,r,kind:'tree'|'rock'} */
    let buildBlockers = [];
    /** Harvest nodes (trees/rocks) with HP — raycast gather targets */
    let harvestNodes = [];
    let gatherHold = false;
    /** Active gather swing — anim plays full length; loot applies at impact. */
    let gatherSwing = null; // { mode, elapsed, impactDone, node }
    /** Sticky target while LMB held — keeps looping the same rock/tree. */
    let gatherLockNode = null;
    const GATHER_SWING = {
      // impactAt = fraction of clip where Mixamo swing connects (mid hit)
      chop: { dur: 1.55, impactAt: 0.48 },
      mine: { dur: 1.70, impactAt: 0.50 },
      gather: { dur: 1.15, impactAt: 0.48 },
    };
    /**
     * Dynamic resource respawn (Rust-like defaults).
     * Pop scale: delay = baseSec / (1 + (clamp(pop,1,popCap)-1) / popScaleFactor)
     * → ~1 player: full base (~15 min trees); ~150: ~half; hard stop at 300.
     */
    const RESOURCE_SPAWN = {
      defaultPop: (opts.serverPopulation | 0) || 1,
      popCap: 300,
      popScaleFactor: 150,
      buildBlockR: 8,
      playerBlockR: 3.5,
      treeBaseSec: 900,
      oreBaseSec: 600,
      barrelBaseMinSec: 120,
      barrelBaseMaxSec: 480,
      treeCap: 120,
      oreCap: 80,
      barrelCap: 16,
      barrelClearR: 14,
      nodeClearR: 4.5,
    };
    try { window.FalseWorldResourceSpawn = RESOURCE_SPAWN; } catch (_) {}
    /** Pending respawns: { kind:'tree'|'ore'|'barrel', due:performance.now(), oreHint? } */
    let resourceRespawnQueue = [];

    function getServerPopulation() {
      let p = RESOURCE_SPAWN.defaultPop;
      try {
        if (typeof window.FalseWorldServerPop === "number") p = window.FalseWorldServerPop;
        else if (opts.serverPopulation != null) p = opts.serverPopulation | 0;
      } catch (_) {}
      return Math.max(1, Math.min(RESOURCE_SPAWN.popCap, p | 0 || 1));
    }
    function populationRespawnScale() {
      const pop = getServerPopulation();
      return 1 / (1 + (pop - 1) / RESOURCE_SPAWN.popScaleFactor);
    }
    function respawnDelayMs(kind) {
      const scale = populationRespawnScale();
      if (kind === "tree") return RESOURCE_SPAWN.treeBaseSec * 1000 * scale;
      if (kind === "barrel") {
        const lo = RESOURCE_SPAWN.barrelBaseMinSec;
        const hi = RESOURCE_SPAWN.barrelBaseMaxSec;
        return (lo + Math.random() * (hi - lo)) * 1000 * scale;
      }
      // rock / metal / sulfur → ore pool
      return RESOURCE_SPAWN.oreBaseSec * 1000 * scale;
    }
    function countLiveHarvest(pred) {
      let n = 0;
      for (let i = 0; i < harvestNodes.length; i++) {
        const h = harvestNodes[i];
        if (!h.dead && pred(h)) n++;
      }
      return n;
    }
    function countLiveTrees() { return countLiveHarvest((h) => h.kind === "tree"); }
    function countLiveOres() {
      return countLiveHarvest((h) => h.kind === "rock" || h.kind === "metal" || h.kind === "sulfur");
    }
    function countLiveBarrels() { return countLiveHarvest((h) => h.kind === "barrel"); }
    function isWorldPropPiece(p) {
      return !p || p.ownerId === "world"
        || p.type === "scrap_barrel" || p.type === "world_ore" || p.type === "world_tree";
    }
    function isResourceSpawnBlocked(x, z, clearR) {
      const cr = clearR != null ? clearR : RESOURCE_SPAWN.nodeClearR;
      if (player && Math.hypot(x - player.x, z - player.z) < RESOURCE_SPAWN.playerBlockR) return true;
      const br = RESOURCE_SPAWN.buildBlockR;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (isWorldPropPiece(p)) continue;
        const c = pieceWorldCenter(p);
        if (Math.hypot(x - c.x, z - c.z) < br) return true;
      }
      for (let i = 0; i < harvestNodes.length; i++) {
        const h = harvestNodes[i];
        if (h.dead) continue;
        const need = cr + (h.r || 0.5) * 0.6;
        if (Math.hypot(x - h.x, z - h.z) < need) return true;
      }
      for (let i = 0; i < buildBlockers.length; i++) {
        const b = buildBlockers[i];
        if (Math.hypot(x - b.x, z - b.z) < (b.r || 1) + 0.8) return true;
      }
      return false;
    }
    /** Ore rarity: stone common · metal mostly mountains · sulfur uncommon. */
    function pickOreKindForPos(x, z, yOpt) {
      const bid = biomeAtJs(x, z);
      const y = yOpt != null ? yOpt : (chunk ? sampleHeight(chunk, x, z) : 0);
      const mtn = y > 3.6 || bid === 3 || centerMtnHeight(x, z) > 1.4;
      const u = Math.random();
      // ~6% sulfur island-wide (rarest)
      if (u < 0.06) return "sulfur";
      if (mtn) {
        // Mountains: more metal, still mostly stone
        if (u < 0.42) return "metal";
        return "rock";
      }
      // Lowlands: stone dominates, little metal, almost no sulfur (already rolled)
      if (u < 0.16) return "metal";
      return "rock";
    }
    function pickOreKindForBiome(bid) {
      // Compat — prefer pickOreKindForPos when xz known
      const u = Math.random();
      if (bid === 3) {
        if (u < 0.06) return "sulfur";
        if (u < 0.45) return "metal";
        return "rock";
      }
      if (u < 0.05) return "sulfur";
      if (u < 0.18) return "metal";
      return "rock";
    }
    function oreNodeStats(kind) {
      if (kind === "metal") {
        return { kind: "metal", hp: 250, dropId: "metal", dropPerHit: 18, hqChance: 0.14 };
      }
      if (kind === "sulfur") {
        return { kind: "sulfur", hp: 220, dropId: "sulfur", dropPerHit: 22, hqChance: 0 };
      }
      return { kind: "rock", hp: 200, dropId: "stone", dropPerHit: 42, hqChance: 0 };
    }
    /** Bigger rocks = more HP (longer mine) + more stone per hit. size≈mesh scale (~0.38–1.1). */
    function oreStatsForSize(kind, scale) {
      const base = oreNodeStats(kind);
      const s = Math.max(0.32, Math.min(1.25, scale != null ? scale : 0.7));
      // ~0.55× pebbles → ~1.3× larger boulders (half prior mega-rocks)
      const mul = 0.5 + s * 0.85;
      const hp = Math.max(60, Math.round(base.hp * mul));
      const dropPerHit = Math.max(8, Math.round(base.dropPerHit * (0.55 + mul * 0.55)));
      return {
        kind: base.kind,
        hp,
        dropId: base.dropId,
        dropPerHit,
        hqChance: base.hqChance,
        sizeMul: mul,
      };
    }
    const LOOT_LABELS = {
      stone: "Piedra", wood: "Madera", metal: "Metal", sulfur: "Azufre",
      scrap: "Scrap", hq: "HQM", cloth: "Tela", food: "Comida",
    };
    let lootToastHost = null;
    let gatherHudEl = null;
    let gatherHudBar = null;
    let gatherHudLabel = null;
    let gatherHudGot = null;
    let gatherSessionGot = 0;
    let gatherSessionNode = null;

    function ensureLootUi() {
      if (lootToastHost || typeof document === "undefined") return;
      const stage = document.querySelector(".stage") || document.body;
      lootToastHost = document.createElement("div");
      lootToastHost.className = "fw-loot-toasts";
      lootToastHost.setAttribute("aria-hidden", "true");
      stage.appendChild(lootToastHost);
      gatherHudEl = document.createElement("div");
      gatherHudEl.className = "fw-gather-hud";
      gatherHudEl.hidden = true;
      gatherHudEl.innerHTML =
        '<div class="fw-gather-label"></div>' +
        '<div class="fw-gather-bar"><i></i></div>' +
        '<div class="fw-gather-got"></div>';
      stage.appendChild(gatherHudEl);
      gatherHudLabel = gatherHudEl.querySelector(".fw-gather-label");
      gatherHudBar = gatherHudEl.querySelector(".fw-gather-bar > i");
      gatherHudGot = gatherHudEl.querySelector(".fw-gather-got");
    }

    function pushLootToast(dropId, qty) {
      if (!qty) return;
      if (typeof playLootBlip === "function") playLootBlip();
      ensureLootUi();
      if (!lootToastHost) return;
      const name = LOOT_LABELS[dropId] || dropId;
      const el = document.createElement("div");
      el.className = "fw-loot-toast";
      let icon = null;
      try {
        icon = window.FalseWorldItemIcons && window.FalseWorldItemIcons.url(dropId);
      } catch (_) {}
      if (icon) {
        el.innerHTML =
          '<img class="fw-loot-toast-icon" alt="" src="' + icon + '" draggable="false">' +
          '<span>+' + qty + " " + name + "</span>";
      } else {
        el.textContent = "+" + qty + " " + name;
      }
      lootToastHost.appendChild(el);
      requestAnimationFrame(() => el.classList.add("is-on"));
      setTimeout(() => {
        el.classList.add("is-out");
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 380);
      }, 1100);
    }

    function updateGatherHud(n, gotThisHit) {
      ensureLootUi();
      if (!gatherHudEl || !n) return;
      if (gatherSessionNode !== n) {
        gatherSessionNode = n;
        gatherSessionGot = 0;
      }
      if (gotThisHit) gatherSessionGot += gotThisHit;
      const name = LOOT_LABELS[n.dropId] || n.dropId;
      const hp = Math.max(0, Math.ceil(n.hp));
      const maxHp = Math.max(1, n.maxHp | 0);
      const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      gatherHudEl.hidden = false;
      if (gatherHudLabel) {
        gatherHudLabel.textContent = name + "  ·  " + hp + "/" + maxHp;
      }
      if (gatherHudBar) gatherHudBar.style.width = pct + "%";
      if (gatherHudGot) {
        gatherHudGot.textContent = gatherSessionGot > 0
          ? ("+" + gatherSessionGot + " " + name)
          : "";
      }
    }

    function hideGatherHud() {
      if (gatherHudEl) gatherHudEl.hidden = true;
      gatherSessionNode = null;
      gatherSessionGot = 0;
    }
    /** Reject cliff/beach floaters: bilinear height over sea cliffs leaves trees in mid-air. */
    function treeGroundOk(wx, wz, wyOpt) {
      if (!chunk) return false;
      if (islandEdge(wx, wz) > 0.055) return false;
      const wy = wyOpt != null ? wyOpt : sampleHeight(chunk, wx, wz);
      // Stay on dry land — not wet sand / surf (SEA_Y ≈ -0.55)
      if (wy < SEA_Y + 0.55 || wy > 16) return false;
      const step = 1.8;
      const hN = sampleHeight(chunk, wx, wz - step);
      const hS = sampleHeight(chunk, wx, wz + step);
      const hE = sampleHeight(chunk, wx + step, wz);
      const hW = sampleHeight(chunk, wx - step, wz);
      const hMin = Math.min(wy, hN, hS, hE, hW);
      const hMax = Math.max(wy, hN, hS, hE, hW);
      // Any neighbor dipping toward water ⇒ coastal cliff / beach ledge
      if (hMin < SEA_Y + 0.35) return false;
      // Steep face (classic mid-air lerp across cliff)
      if (hMax - hMin > 2.2) return false;
      // Foot must sit close to local neighborhood floor
      if (wy - hMin > 1.15) return false;
      return true;
    }

    function pickResourceCoord(preferDense) {
      if (!chunk) return null;
      const half = (typeof ISLAND_HALF === "number" ? ISLAND_HALF : 72) * 0.92;
      for (let attempt = 0; attempt < 56; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 22 + Math.random() * Math.max(8, half - 22);
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad;
        if (islandEdge(x, z) > 0.08) continue;
        const y = sampleHeight(chunk, x, z);
        if (y < SEA_Y + 0.12 || y > 14) continue;
        const bid = biomeAtJs(x, z);
        if (preferDense) {
          const denseOk = bid === 3 || y > 3.8 || (bid === 5 && Math.random() < 0.55);
          if (attempt < 28 && !denseOk) continue;
        }
        if (isResourceSpawnBlocked(x, z)) continue;
        return { x, y, z, bid };
      }
      return null;
    }
    function scheduleResourceRespawn(kind, oreHint) {
      const pool = (kind === "rock" || kind === "metal" || kind === "sulfur") ? "ore" : kind;
      resourceRespawnQueue.push({
        kind: pool,
        oreHint: oreHint || null,
        due: (typeof performance !== "undefined" ? performance.now() : Date.now()) + respawnDelayMs(pool === "ore" ? "ore" : kind),
      });
    }
    function spawnRespawnTree(pos) {
      if (countLiveTrees() >= RESOURCE_SPAWN.treeCap) return false;
      if (!treeGroundOk(pos.x, pos.z, pos.y)) return false;
      const ix = Math.floor(pos.x / BUILD_CELL);
      const iz = Math.floor(pos.z / BUILD_CELL);
      const piece = ensurePieceInternals({
        type: "world_tree",
        ix, iy: 0, iz, yaw: 0,
        baseY: pos.y,
        tier: 0,
        ownerId: "world",
        _ox: pos.x - (ix + 0.5) * BUILD_CELL,
        _oz: pos.z - (iz + 0.5) * BUILD_CELL,
      });
      buildPieces.push(piece);
      const r = 1.1;
      harvestNodes.push({
        kind: "tree", x: pos.x, y: pos.y, z: pos.z, r: Math.max(0.55, r),
        hp: 250, maxHp: 250, dropId: "wood", dropPerHit: 40,
        pieceId: piece.id, dead: false, respawned: true,
      });
      treeColliders.push({ x: pos.x, z: pos.z, r: 0.35 });
      // Placement uses trunk, not canopy — snug foundations next to trees
      buildBlockers.push({ x: pos.x, z: pos.z, r: 0.55, kind: "tree" });
      rebuildBuildMesh();
      return true;
    }
    function spawnRespawnOre(pos, kindHint) {
      if (countLiveOres() >= RESOURCE_SPAWN.oreCap) return false;
      const kind = kindHint || pickOreKindForPos(pos.x, pos.z, pos.y);
      // Sulfur nodes stay compact
      let scale = 0.38 + Math.random() * 0.72;
      if (kind === "sulfur") scale = 0.34 + Math.random() * 0.32;
      else if (kind === "metal") scale = 0.38 + Math.random() * 0.55;
      const st = oreStatsForSize(kind, scale);
      const ix = Math.floor(pos.x / BUILD_CELL);
      const iz = Math.floor(pos.z / BUILD_CELL);
      const piece = ensurePieceInternals({
        type: "world_ore",
        oreKind: st.kind,
        ix, iy: 0, iz, yaw: Math.random() * Math.PI * 2,
        baseY: pos.y,
        tier: 0,
        ownerId: "world",
        _ox: pos.x - (ix + 0.5) * BUILD_CELL,
        _oz: pos.z - (iz + 0.5) * BUILD_CELL,
      });
      buildPieces.push(piece);
      const rr = Math.max(0.55, 0.55 + scale * 0.35);
      harvestNodes.push({
        kind: st.kind, x: pos.x, y: pos.y, z: pos.z, r: Math.max(0.55, rr),
        hp: st.hp, maxHp: st.hp, dropId: st.dropId, dropPerHit: st.dropPerHit,
        hqChance: st.hqChance, sizeMul: st.sizeMul,
        pieceId: piece.id, dead: false, respawned: true,
      });
      rockColliders.push({ x: pos.x, z: pos.z, r: rr });
      buildBlockers.push({ x: pos.x, z: pos.z, r: Math.max(0.95, rr * 1.25), kind: "rock" });
      rebuildBuildMesh();
      return true;
    }
    function spawnRespawnBarrel(pos) {
      // World scrap chests removed — no map respawn
      return false;
    }
    function tickResourceRespawn(_dt) {
      if (!resourceRespawnQueue.length || !chunk) return;
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      let changed = false;
      for (let i = resourceRespawnQueue.length - 1; i >= 0; i--) {
        const job = resourceRespawnQueue[i];
        if (now < job.due) continue;
        const preferDense = job.kind === "ore";
        const pos = pickResourceCoord(preferDense);
        if (!pos) {
          job.due = now + 8000 + Math.random() * 7000; // retry
          continue;
        }
        let ok = false;
        if (job.kind === "tree") ok = spawnRespawnTree(pos);
        else if (job.kind === "barrel") {
          resourceRespawnQueue.splice(i, 1); // scrap chests disabled
          continue;
        }
        else ok = spawnRespawnOre(pos, job.oreHint);
        if (ok) {
          resourceRespawnQueue.splice(i, 1);
          changed = true;
        } else {
          job.due = now + respawnDelayMs(job.kind === "ore" ? "ore" : job.kind) * 0.35;
        }
      }
      if (changed) {
        /* mesh already rebuilt in spawn* */
      }
    }
    /** Inventory bridge from Resuma / fw-inventory-v1 */
    const invBridge = opts.inventory || null;
    let heldItem = null; // { id, kind, label }
    let doorAnim = []; // { pieceId, open, yaw0, t }

    function invAdd(id, qty) {
      if (invBridge && typeof invBridge.addItem === "function") return invBridge.addItem(id, qty);
      return 0;
    }
    function invConsume(id, qty) {
      if (invBridge && typeof invBridge.tryConsume === "function") return invBridge.tryConsume(id, qty);
      return false;
    }
    function invCount(id) {
      if (invBridge && typeof invBridge.countOf === "function") return invBridge.countOf(id);
      return 9999;
    }
    function heldIsBuildPlan() {
      return heldItem && (heldItem.id === "build_plan" || heldItem.kind === "build");
    }
    function heldIsGather() {
      return heldItem && (
        heldItem.id === "rock_tool"
        || heldItem.id === "hatchet_tool"
        || heldItem.kind === "gather"
      );
    }
    function heldIsPick() {
      return heldItem && heldItem.id === "rock_tool";
    }
    function heldIsAxe() {
      return heldItem && heldItem.id === "hatchet_tool";
    }
    /** Tool vs node: axe→trees, pick→rock/metal/sulfur; barrels accept either. */
    function gatherToolMatches(node) {
      if (!node || !heldIsGather()) return false;
      if (node.kind === "barrel") return true;
      if (node.kind === "tree") return heldIsAxe() || (!heldIsPick() && heldIsGather());
      if (node.kind === "rock" || node.kind === "metal" || node.kind === "sulfur") {
        return heldIsPick() || (!heldIsAxe() && heldIsGather());
      }
      return heldIsGather();
    }
    function heldIsHammer() {
      return heldItem && heldItem.id === "hammer_tool";
    }
    function heldIsTcItem() {
      return heldItem && heldItem.id === "tool_cupboard_item";
    }
    function heldIsLock() {
      return heldItem && heldItem.id === "key_lock";
    }
    function heldIsWorkbench() {
      return heldItem && (
        heldItem.id === "workbench_1"
        || heldItem.id === "workbench_2"
        || heldItem.id === "workbench_3"
      );
    }
    function heldIsMetalDoor() {
      return heldItem && heldItem.id === "metal_door";
    }
    function heldIsResearchTable() {
      return heldItem && heldItem.id === "research_table";
    }
    function heldIsCampfire() { return heldItem && heldItem.id === "campfire"; }
    function heldIsSleepingBag() { return heldItem && heldItem.id === "sleeping_bag"; }
    function heldIsBox() {
      return heldItem && (heldItem.id === "box_small" || heldItem.id === "box_large");
    }
    function heldIsFood() { return heldItem && heldItem.id === "food"; }
    function heldIsSatchel() { return heldItem && heldItem.id === "satchel"; }
    function heldIsRocket() { return heldItem && heldItem.id === "rocket"; }
    function heldIsC4() { return heldItem && heldItem.id === "c4"; }

    // --- Building system (Rust-scale modular pieces, 3 m cell) ---
    // Dimensions match Rust construction: square foundation 3×3 m, wall 3×3 m, etc.
    const BUILD_CELL = 3.0;
    const BUILD_LEVEL_H = 3.0;
    const BUILD_FOUND_H = 0.78; // stilts / deck height above terrain
    const BUILD_WALL_T = 0.32;
    const BUILD_FLOOR_T = 0.22;
    const BUILD_FOUND_SINK = 0.08;
    const BUILD_BEAM = 0.24;
    const BUILD_HALF_H = 1.5;
    const BUILD_LOW_H = 0.75;
    const BUILD_ROOF_RISE = 1.5; // pitched roof vertical cover
    const BUILD_DOOR_W = 1.2;
    const BUILD_DOOR_H = 2.2;
    const BUILD_TRI_H = BUILD_CELL * Math.sqrt(3) * 0.5; // equilateral height ≈ 2.598 m

    /** Exact 20-piece Rust twig catalog — clockwise from top. */
    const BUILD_CATALOG = [
      { id: "foundation", label: "Cimiento", desc: "Base cuadrada 3×3 m", group: "deck", cost: 50 },
      { id: "roof", label: "Techo", desc: "Techo inclinado cuadrado", group: "roof", cost: 50 },
      { id: "ramp", label: "Rampa", desc: "Conecta desniveles exteriores", group: "ramp", cost: 50 },
      { id: "stairs", label: "Escalera", desc: "Sube un nivel completo (3 m)", group: "ramp", cost: 50 },
      { id: "floor", label: "Suelo", desc: "Piso / techo plano 3×3 m", group: "floor", cost: 20 },
      { id: "floor_tri", label: "Suelo triangular", desc: "Plataforma triangular", group: "floor", cost: 10 },
      { id: "foundation_tri", label: "Cimiento triangular", desc: "Base triangular de tres lados", group: "deck", cost: 25 },
      { id: "roof_tri", label: "Techo triangular", desc: "Techo para geometría triangular", group: "roof", cost: 25 },
      { id: "roof_ridge", label: "Cumbrera", desc: "Doble inclinación para unir techos", group: "roof", cost: 25 },
      { id: "wall", label: "Pared", desc: "Panel vertical completo 3×3 m", group: "wall", cost: 20, wallH: BUILD_LEVEL_H },
      { id: "doorway", label: "Marco de puerta", desc: "Apertura para una puerta", group: "wall", cost: 20, wallH: BUILD_LEVEL_H },
      { id: "window", label: "Marco de ventana", desc: "Pared con hueco de ventana", group: "wall", cost: 20, wallH: BUILD_LEVEL_H },
      { id: "wall_frame", label: "Marco de pared", desc: "Marco completo para portones", group: "wall", cost: 20, wallH: BUILD_LEVEL_H },
      { id: "floor_frame", label: "Marco de suelo", desc: "Suelo hueco para trampillas", group: "floor", cost: 20 },
      { id: "wall_low", label: "Pared baja", desc: "Parapeto de ¼ de altura", group: "wall", cost: 10, wallH: BUILD_LOW_H },
      { id: "wall_half", label: "Media pared", desc: "Pared de ½ altura", group: "wall", cost: 20, wallH: BUILD_HALF_H },
      { id: "pillar", label: "Pilar", desc: "Columna vertical de soporte", group: "wall", cost: 10, wallH: BUILD_LEVEL_H },
      { id: "floor_steps", label: "Escalones de suelo", desc: "Escalones para desniveles bajos", group: "ramp", cost: 10 },
      { id: "stairs_l", label: "Escalera L", desc: "Sube girando 90 grados", group: "ramp", cost: 50 },
      { id: "stairs_u", label: "Escalera U", desc: "Sube girando 180 grados", group: "ramp", cost: 50 },
      // TC se fabrica/coloca como ítem tool_cupboard_item (no va en la rueda del Plano)
    ];
    const BUILD_TYPES = BUILD_CATALOG.map((p) => p.id);
    const BUILD_BY_ID = Object.create(null);
    const BUILD_LABELS = Object.create(null);
    for (let i = 0; i < BUILD_CATALOG.length; i++) {
      BUILD_BY_ID[BUILD_CATALOG[i].id] = BUILD_CATALOG[i];
      BUILD_LABELS[BUILD_CATALOG[i].id] = BUILD_CATALOG[i].label;
    }
    // Deployables — not in radial wheel
    BUILD_BY_ID.door = {
      id: "door", label: "Puerta", desc: "Se coloca dentro de un marco", group: "deploy", cost: 0,
      wallH: BUILD_LEVEL_H,
    };
    BUILD_LABELS.door = "Puerta";
    BUILD_BY_ID.toolcupboard = {
      id: "toolcupboard", label: "Armario", desc: "Privilege 25 m · upkeep", group: "deploy", cost: 0,
    };
    BUILD_LABELS.toolcupboard = "Armario";
    BUILD_BY_ID.workbench = {
      id: "workbench", label: "Mesa de trabajo", desc: "Crafteo avanzado · sobre cimiento/piso · T1–T3", group: "deploy", cost: 0,
    };
    BUILD_LABELS.workbench = "Mesa de trabajo";
    BUILD_BY_ID.research_table = {
      id: "research_table", label: "Mesa investigación", desc: "Investiga planos · sobre cimiento/piso", group: "deploy", cost: 0,
    };
    BUILD_LABELS.research_table = "Mesa investigación";
    BUILD_BY_ID.campfire = { id: "campfire", label: "Fogata", desc: "Calor · confort", group: "deploy", cost: 0 };
    BUILD_LABELS.campfire = "Fogata";
    BUILD_BY_ID.sleeping_bag = { id: "sleeping_bag", label: "Saco dormir", desc: "Respawn", group: "deploy", cost: 0 };
    BUILD_LABELS.sleeping_bag = "Saco dormir";
    BUILD_BY_ID.box_small = { id: "box_small", label: "Caja pequeña", desc: "6 slots", group: "deploy", cost: 0 };
    BUILD_LABELS.box_small = "Caja pequeña";
    BUILD_BY_ID.box_large = { id: "box_large", label: "Caja grande", desc: "12 slots", group: "deploy", cost: 0 };
    BUILD_LABELS.box_large = "Caja grande";
    BUILD_BY_ID.scrap_barrel = {
      id: "scrap_barrel", label: "Cofre scrap", desc: "Rómpelo con hacha/pico · scrap", group: "world", cost: 0,
    };
    BUILD_LABELS.scrap_barrel = "Cofre scrap";
    BUILD_BY_ID.world_ore = {
      id: "world_ore", label: "Nodo", desc: "Mineral", group: "world", cost: 0,
    };
    BUILD_LABELS.world_ore = "Nodo";
    BUILD_BY_ID.world_tree = {
      id: "world_tree", label: "Árbol", desc: "Madera", group: "world", cost: 0,
    };
    BUILD_LABELS.world_tree = "Árbol";

    let buildMode = false;
    /** @type {null|string} deployable ghost type without Plano */
    let deployMode = null;
    /** When deployMode === "workbench", which tier item is being placed */
    let deployWbTier = 1;
    /** Workbench proximity signal (craft gate) */
    let isInWorkbenchRange = false;
    let workbenchTierNear = 0;
    const WORKBENCH_RANGE = 2.0;
    /** Normalize WB tier: NEVER use `x | 1` (turns T2 into T3). */
    function asWbTier(v) {
      const n = v | 0;
      return n >= 1 ? n : 1;
    }
    function workbenchItemId(tier) {
      const t = asWbTier(tier);
      return t >= 3 ? "workbench_3" : (t >= 2 ? "workbench_2" : "workbench_1");
    }
    const HEAT_RANGE = 4.0;
    const MAX_HP = 100;
    const MAX_HUNGER = 500;
    const vitals = {
      hp: MAX_HP,
      hunger: MAX_HUNGER,
      cold: false,
      comfort: 0,
      nearHeat: false,
      dead: false,
    };
    let respawnEl = null;
    let boxPanelEl = null;
    let activeBoxId = null;
    let softHintEl = null;
    let vitalsAcc = 0;
    let buildTypeIdx = 9; // default Wall (Rust focus)
    let buildYaw = 0; // 0..3 * 90°
    let radialOpen = false;
    let radialHoverIdx = -1;
    /** @type {{type:string,ix:number,iy:number,iz:number,yaw:number,y:number,baseY:number}[]} */
    let buildPieces = [];
    /** Baked wardrobe.glb verts for toolcupboard (pos/nrm/col/uv × 11 floats). */
    let wardrobeTcMesh = null; // { floats: Float32Array|number[], vertCount, size }
    /** Baked animated_old_chest.glb (closed pose) for boxes / legacy scrap chests. */
    let oldChestMesh = null; // { floats, vertCount, size }
    /** Baked workbench GLBs per tier (1–3). */
    const workbenchMeshes = { 1: null, 2: null, 3: null };
    let researchTableMesh = null; // baked research_table_rust.glb
    /** Spatial hash: "ix,iy,iz" → pieces[] — O(1) cell queries (no full-base scans). */
    const buildCellIndex = new Map();
    /** Per-piece GPU mesh cache: id → { sig, data: Float32Array } */
    const pieceMeshCache = new Map();
    let buildVbo = null;
    let buildVertCount = 0;
    let ghostVbo = null;
    let ghostVertCount = 0;
    let fxVbo = null;
    let fxVertCount = 0;
    let ghostOk = false;
    let ghostReason = "";
    let ghostCell = null;
    let buildColliders = []; // AABB solids that block the player

    let treeDrawRanges = [];
    let rockDrawRanges = [];
    const PLAYER_RADIUS = 0.45;

    const player = {
      x: 0, y: 1.55, feetY: 0, z: 0, yaw: 0,
      vy: 0, moving: false, sprinting: false,
      jumping: false, crouching: false, crouchToggle: false,
      swimming: false, freeLook: false,
      attackPulse: false, gatherPulse: false, chopPulse: false, minePulse: false,
    };
    let flashlightOn = false;
    let chatOpen = false;
    let craftOpen = false;
    let chatEl = null;
    let craftEl = null;
    let progApi = null;
    let radialHeld = false;
    const trailPts = [
      { x: 0, z: 0, w: 0 },
      { x: 0, z: 0, w: 0 },
      { x: 0, z: 0, w: 0 },
      { x: 0, z: 0, w: 0 },
    ];
    let trailLastX = 0;
    let trailLastZ = 0;
    let camMode = "follow";
    // FPV look pitch (0 = horizontal, + = look up, − = look down)
    let fpvPitch = -0.22;
    let lastHudBiome = 0;
    let fpsFrames = 0;
    let fpsWindowStart = 0;
    let fpsShown = 0;
    const fpsEl = typeof document !== "undefined" ? document.getElementById("fw-fps") : null;
    const keys = Object.create(null);
    let orbitYaw = Math.PI;
    let orbitPitch = 0.32;
    // Pitch: + = high cam looking down; − = worm's-eye looking up at avatar
    const ORBIT_PITCH_MIN = -0.78; // ~-45° below look height (floor clamp still applies)
    const ORBIT_PITCH_MAX = 1.28;
    let orbitDist = 4.2;
    let followDist = 4.2;
    let freeOrbitDist = 14;
    let dragging = false, lastMx = 0, lastMy = 0;
    let orbitRmb = false;
    /** LMB already placed a build piece this press (avoid double-place on up). */
    let buildPlacedOnDown = false;
    let alive = true, raf = 0, t0 = performance.now();
    let lastEye = [0, 2, 8], lastTarget = [0, 1, 0];
    let lastLookAt = [0, 1.5, 4];
    let controlsEnabled = false, paused = false;
    const beams = [];
    let nextBeam = 2;

    function cellIndexKey(ix, iy, iz) {
      return ix + "," + iy + "," + iz;
    }
    function rebuildCellIndex() {
      buildCellIndex.clear();
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        const k = cellIndexKey(p.ix, p.iy, p.iz);
        let list = buildCellIndex.get(k);
        if (!list) {
          list = [];
          buildCellIndex.set(k, list);
        }
        list.push(p);
      }
    }
    function piecesInCell(ix, iy, iz) {
      return buildCellIndex.get(cellIndexKey(ix, iy, iz)) || [];
    }
    /** Snap world XZ to Rust 3 m grid cell indices. */
    function worldToBuildCell(x, z) {
      return {
        ix: Math.floor(x / BUILD_CELL),
        iz: Math.floor(z / BUILD_CELL),
      };
    }
    function invalidatePieceMesh(p) {
      if (p && p.id != null) pieceMeshCache.delete(p.id);
    }
    function clearPieceMeshCache() {
      pieceMeshCache.clear();
    }

    // Radial menu DOM (Rust-like wheel)
    let radialEl = null;
    let radialCenterEl = null;
    let radialRingEl = null;
    let radialAimEl = null;
    let radialSegEls = [];
    // Virtual cursor on the wheel (pointer-lock freezes clientX/Y)
    let radialAimX = 0;
    let radialAimY = 0;
    const RADIAL_GROUP_CLASS = {
      deck: "is-deck", floor: "is-floor", wall: "is-wall", roof: "is-roof", ramp: "is-ramp",
    };
    function applyPieceIcon(el, pieceId) {
      if (!el || !pieceId) return;
      let url = null;
      try {
        url = window.FalseWorldItemIcons && window.FalseWorldItemIcons.url(pieceId);
      } catch (_) {}
      if (url) {
        el.classList.add("is-3d");
        el.style.backgroundImage = "url(\"" + url + "\")";
      } else {
        el.classList.remove("is-3d");
        el.style.backgroundImage = "";
      }
    }

    function paintRadialPieceIcons() {
      if (!radialEl) return;
      const wires = radialEl.querySelectorAll(".fw-br-wire[data-piece]");
      for (let i = 0; i < wires.length; i++) {
        applyPieceIcon(wires[i], wires[i].getAttribute("data-piece"));
      }
      const centerIcon = radialCenterEl && radialCenterEl.querySelector(".fw-br-icon");
      if (centerIcon) applyPieceIcon(centerIcon, centerIcon.getAttribute("data-piece"));
    }

    function ensureBuildRadial() {
      if (radialEl || typeof document === "undefined") return;
      radialEl = document.createElement("div");
      radialEl.id = "fw-build-radial";
      radialEl.className = "fw-build-radial";
      radialEl.setAttribute("aria-hidden", "true");
      radialEl.innerHTML =
        '<div class="fw-build-radial-ring">' +
        '  <div class="fw-br-active-wedge" aria-hidden="true"></div>' +
        '  <svg class="fw-br-dividers" viewBox="0 0 100 100" aria-hidden="true"></svg>' +
        '  <div class="fw-build-radial-center">' +
        '    <div class="fw-br-icon" aria-hidden="true"></div>' +
        '    <div class="fw-br-name"></div>' +
        '    <div class="fw-br-desc"></div>' +
        '    <div class="fw-br-cost"></div>' +
        '    <div class="fw-br-hint">suelta para elegir</div>' +
        "  </div>" +
        '  <div class="fw-br-aim" aria-hidden="true"></div>' +
        "</div>";
      const ring = radialEl.querySelector(".fw-build-radial-ring");
      radialRingEl = ring;
      radialCenterEl = radialEl.querySelector(".fw-build-radial-center");
      radialAimEl = radialEl.querySelector(".fw-br-aim");
      const n = BUILD_CATALOG.length;
      ring.style.setProperty("--n", String(n));
      const svg = radialEl.querySelector(".fw-br-dividers");
      const rIn = 31;
      const rOut = 49.2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI * 0.5 - Math.PI / n;
        const x1 = 50 + Math.cos(a) * rIn;
        const y1 = 50 + Math.sin(a) * rIn;
        const x2 = 50 + Math.cos(a) * rOut;
        const y2 = 50 + Math.sin(a) * rOut;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", x1.toFixed(2));
        line.setAttribute("y1", y1.toFixed(2));
        line.setAttribute("x2", x2.toFixed(2));
        line.setAttribute("y2", y2.toFixed(2));
        svg.appendChild(line);
      }
      for (let i = 0; i < n; i++) {
        const item = BUILD_CATALOG[i];
        const seg = document.createElement("button");
        seg.type = "button";
        seg.className = "fw-br-seg " + (RADIAL_GROUP_CLASS[item.group] || "");
        seg.dataset.idx = String(i);
        seg.dataset.group = item.group || "";
        seg.title = item.label;
        const ang = (i / n) * Math.PI * 2 - Math.PI * 0.5;
        const r = 40; // % — mid of glass band
        seg.style.setProperty("--ang", String(ang));
        seg.style.setProperty("--i", String(i));
        seg.style.left = 50 + Math.cos(ang) * r + "%";
        seg.style.top = 50 + Math.sin(ang) * r + "%";
        seg.innerHTML = '<span class="fw-br-wire" data-piece="' + item.id + '"></span>';
        seg.addEventListener("pointerenter", () => selectRadialIdx(i, false));
        seg.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          selectRadialIdx(i, true);
          setRadialOpen(false);
        });
        ring.appendChild(seg);
        radialSegEls.push(seg);
      }
      paintRadialPieceIcons();
      try {
        if (window.FalseWorldItemIcons && typeof window.FalseWorldItemIcons.ready === "function") {
          window.FalseWorldItemIcons.ready().then(() => paintRadialPieceIcons());
        }
      } catch (_) {}
      // Click outside segments but on overlay: confirm hover and close
      radialEl.addEventListener("click", (ev) => {
        if (!radialOpen) return;
        if (ev.target.closest(".fw-br-seg")) return;
        if (radialHoverIdx >= 0) selectRadialIdx(radialHoverIdx, true);
        setRadialOpen(false);
      });
      const stage = document.querySelector(".stage") || document.body;
      stage.appendChild(radialEl);
      updateRadialCenter();
    }

    function selectRadialIdx(idx, apply) {
      if (idx < 0 || idx >= BUILD_CATALOG.length) return;
      radialHoverIdx = idx;
      if (apply) {
        buildTypeIdx = idx;
        makeGhostFromRay();
        onHud({ status: "Build · " + BUILD_CATALOG[idx].label });
      }
      updateRadialCenter();
      for (let i = 0; i < radialSegEls.length; i++) {
        radialSegEls[i].classList.toggle("is-active", i === (apply ? buildTypeIdx : idx));
        radialSegEls[i].classList.toggle("is-selected", i === buildTypeIdx);
      }
    }

    function updateRadialCenter() {
      if (!radialCenterEl) return;
      const idx = radialHoverIdx >= 0 ? radialHoverIdx : buildTypeIdx;
      const p = BUILD_CATALOG[idx];
      if (!p) return;
      const name = radialCenterEl.querySelector(".fw-br-name");
      const desc = radialCenterEl.querySelector(".fw-br-desc");
      const cost = radialCenterEl.querySelector(".fw-br-cost");
      const icon = radialCenterEl.querySelector(".fw-br-icon");
      if (name) name.textContent = p.label;
      if (desc) desc.textContent = p.desc;
      if (cost) {
        const have = invCount("wood");
        const ok = have >= (p.cost | 0);
        cost.textContent = p.cost + " × madera · " + have.toLocaleString("es");
        cost.classList.toggle("is-short", !ok);
      }
      if (icon) {
        icon.setAttribute("data-piece", p.id);
        icon.className = "fw-br-icon " + (RADIAL_GROUP_CLASS[p.group] || "");
        applyPieceIcon(icon, p.id);
      }
      if (radialRingEl) {
        radialRingEl.style.setProperty("--active", String(idx));
        radialRingEl.dataset.group = p.group || "";
      }
      for (let i = 0; i < radialSegEls.length; i++) {
        radialSegEls[i].classList.toggle("is-active", i === idx);
        radialSegEls[i].classList.toggle("is-selected", i === buildTypeIdx);
      }
    }

    function setRadialOpen(on) {
      ensureBuildRadial();
      if (on && !buildMode) {
        // Allow open attempt only when build mode can run
        if (!heldIsBuildPlan()) {
          radialOpen = false;
        } else {
          buildMode = true;
          try { if (window.__fw) window.__fw.buildMode = true; } catch (_) {}
        }
      }
      const wasOpen = radialOpen;
      radialOpen = !!on && buildMode;
      if (!radialEl) return;
      radialEl.classList.toggle("is-open", radialOpen);
      radialEl.setAttribute("aria-hidden", radialOpen ? "false" : "true");
      if (radialOpen) {
        clearLocoKeys();
        radialHoverIdx = buildTypeIdx;
        resetRadialAimToIdx(buildTypeIdx);
        radialPickFromAim();
        updateRadialCenter();
        onHud({ status: "Rueda · mueve hacia la pieza · suelta MMB" });
      } else if (wasOpen) {
        // Closing wheel: drop sticky WASD only (keep Ctrl crouch / Shift sprint)
        clearLocoKeys();
      }
    }

    function resetRadialAimToIdx(idx) {
      const n = BUILD_CATALOG.length || 1;
      const i = ((idx % n) + n) % n;
      const ang = (i / n) * Math.PI * 2 - Math.PI * 0.5;
      // Start on the icon ring so first frame isn't deadzone-center
      const r = 130;
      radialAimX = Math.cos(ang) * r;
      radialAimY = Math.sin(ang) * r;
      syncRadialAimDot();
    }

    function syncRadialAimDot() {
      if (!radialAimEl || !radialRingEl) return;
      const rect = radialRingEl.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      radialAimEl.style.left = (50 + (radialAimX / w) * 100) + "%";
      radialAimEl.style.top = (50 + (radialAimY / h) * 100) + "%";
    }

    /** Equip Plano from hotbar if present; sync heldItem into engine. */
    function ensureBuildPlanEquipped() {
      if (heldIsBuildPlan()) return true;
      const inv = (typeof window !== "undefined" && window.__fw && window.__fw.inv) || null;
      if (!inv || typeof inv.setActive !== "function" || typeof inv.getActive !== "function") {
        return false;
      }
      for (let i = 0; i < 6; i++) {
        inv.setActive(i);
        const h = inv.getActive();
        if (h && (h.id === "build_plan" || h.kind === "build")) {
          heldItem = h;
          return true;
        }
      }
      return false;
    }

    function radialPickFromPointer(clientX, clientY) {
      if (!radialEl || !radialOpen) return;
      const ring = radialRingEl || radialEl.querySelector(".fw-build-radial-ring") || radialEl;
      const rect = ring.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5;
      const cy = rect.top + rect.height * 0.5;
      radialAimX = clientX - cx;
      radialAimY = clientY - cy;
      radialPickFromAim();
    }

    /** Rust-like: aim with mouse deltas while MMB held / pointer-locked. */
    function radialAimFromDelta(dx, dy) {
      if (!radialOpen) return;
      radialAimX += dx || 0;
      radialAimY += dy || 0;
      radialPickFromAim();
    }

    function radialPickFromAim() {
      if (!radialEl || !radialOpen) return;
      const ring = radialRingEl || radialEl.querySelector(".fw-build-radial-ring") || radialEl;
      const rect = ring.getBoundingClientRect();
      const maxR = rect.width * 0.48;
      const minR = rect.width * 0.12;
      let dx = radialAimX;
      let dy = radialAimY;
      let dist = Math.hypot(dx, dy);
      if (dist > maxR && dist > 1e-4) {
        const s = maxR / dist;
        dx *= s;
        dy *= s;
        radialAimX = dx;
        radialAimY = dy;
        dist = maxR;
      }
      syncRadialAimDot();
      // Deadzone = hub — keep last hover
      if (dist < minR) return;
      let ang = Math.atan2(dy, dx); // -PI..PI, 0 = +X
      ang = ang + Math.PI * 0.5; // 0 = top
      if (ang < 0) ang += Math.PI * 2;
      const n = BUILD_CATALOG.length;
      const idx = Math.floor((ang / (Math.PI * 2)) * n + 0.5) % n;
      selectRadialIdx(idx, false);
    }

    const BUILD_COLORS = {
      foundation: [0.48, 0.34, 0.20],
      foundation_tri: [0.46, 0.33, 0.19],
      wall: [0.52, 0.36, 0.20],
      doorway: [0.50, 0.35, 0.19],
      window: [0.50, 0.35, 0.19],
      wall_frame: [0.50, 0.35, 0.19],
      pillar: [0.48, 0.34, 0.18],
      doorway_d: [0.50, 0.35, 0.19],
      wall_half: [0.51, 0.36, 0.20],
      wall_low: [0.49, 0.34, 0.19],
      roof_wall: [0.50, 0.35, 0.18],
      floor: [0.50, 0.35, 0.19],
      floor_tri: [0.49, 0.34, 0.18],
      floor_frame: [0.49, 0.34, 0.18],
      floor_steps: [0.50, 0.36, 0.20],
      stairs: [0.50, 0.36, 0.20],
      stairs_l: [0.50, 0.36, 0.20],
      stairs_u: [0.50, 0.36, 0.20],
      ramp: [0.48, 0.34, 0.19],
      roof: [0.46, 0.32, 0.17],
      roof_tri: [0.46, 0.32, 0.17],
      roof_ridge: [0.45, 0.31, 0.16],
      roof_corner: [0.45, 0.31, 0.16],
      roof_valley: [0.45, 0.31, 0.16],
    };

    function isWallType(t) {
      return t === "wall" || t === "doorway" || t === "window" || t === "doorway_d"
        || t === "wall_frame" || t === "pillar"
        || t === "wall_half" || t === "wall_low" || t === "roof_wall" || t === "door";
    }
    function isDeckType(t) {
      return t === "foundation" || t === "foundation_tri" || t === "floor" || t === "floor_tri"
        || t === "floor_frame" || t === "stairs" || t === "stairs_l" || t === "stairs_u"
        || t === "floor_steps" || t === "ramp";
    }
    function isFloorType(t) {
      return t === "floor" || t === "floor_tri" || t === "floor_frame";
    }
    function isFoundationType(t) {
      return t === "foundation" || t === "foundation_tri";
    }
    function isRoofType(t) {
      return t === "roof" || t === "roof_tri" || t === "roof_ridge"
        || t === "roof_corner" || t === "roof_valley";
    }
    function isRampType(t) {
      return t === "stairs" || t === "stairs_l" || t === "stairs_u"
        || t === "floor_steps" || t === "ramp";
    }
    function isFurnitureDeploy(t) {
      return t === "toolcupboard" || t === "workbench" || t === "research_table"
        || t === "campfire" || t === "sleeping_bag"
        || t === "box_small" || t === "box_large";
    }
    /** Blocks player movement (not walk-on surfaces). Sleeping bags stay soft. */
    function isSolidFurniture(t) {
      return t === "toolcupboard" || t === "workbench" || t === "research_table"
        || t === "campfire" || t === "box_small" || t === "box_large";
    }
    function wallHeight(type) {
      const meta = BUILD_BY_ID[type];
      return meta && meta.wallH != null ? meta.wallH : BUILD_LEVEL_H;
    }
    /**
     * Top of a full wall sitting on a foundation deck.
     * Floor/ceiling slabs and roofs must use this — not base+LEVEL_H alone
     * (that sat ~FOUND_H too low and cut through mid-wall).
     */
    function levelWallTopY(levelBase) {
      return levelBase + BUILD_FOUND_H + BUILD_LEVEL_H - 0.03;
    }
    function levelFloorSlabY(levelBase) {
      const y1 = levelWallTopY(levelBase);
      return { y0: y1 - BUILD_FLOOR_T, y1: y1 };
    }
    /** Deck-top Y where walls / doorways / doors sit (must match mesh + colliders). */
    function wallSeatY(piece) {
      const base = piece.baseY + piece.iy * BUILD_LEVEL_H;
      if (piece.type === "roof_wall") return levelWallTopY(base);
      const deck = findDeck(piece.ix, piece.iz, piece.iy);
      if (deck && isFloorType(deck.type)) {
        return levelWallTopY(deck.baseY + deck.iy * BUILD_LEVEL_H) - 0.02;
      }
      if (deck) return base + BUILD_FOUND_H - 0.03;
      return base + 0.02;
    }
    function aabbOverlap3(a, b) {
      return a.minX < b.maxX && a.maxX > b.minX
        && a.minY < b.maxY && a.maxY > b.minY
        && a.minZ < b.maxZ && a.maxZ > b.minZ;
    }
    /** Half-extents of furniture footprint (door faces +local Z, rotated by yaw). */
    function furnitureHalfExtents(type, yaw) {
      const y = ((yaw % 4) + 4) % 4;
      let hw = 0.42, hd = 0.26; // wardrobe: wide × shallow
      // Collision / footprint — keep tight to mesh so players can slip between tables
      if (type === "workbench") { hw = 0.58; hd = 0.30; } // GLB ×1.3 (was oversized)
      else if (type === "research_table") { hw = 0.55; hd = 0.38; }
      else if (type === "box_large") { hw = 0.60; hd = 0.34; } // old chest GLB
      else if (type === "box_small") { hw = 0.43; hd = 0.24; }
      else if (type === "campfire") { hw = 0.52; hd = 0.52; }
      else if (type === "sleeping_bag") { hw = 0.38; hd = 0.95; }
      else if (type === "toolcupboard") { hw = 0.42; hd = 0.24; } // wardrobe.glb footprint
      if (y === 1 || y === 3) { const t = hw; hw = hd; hd = t; }
      return { hx: hw, hz: hd };
    }

    /**
     * Clamp furniture offset inside the cell, tight against wall inner faces
     * so a TC can sit in a corner (~4 cm gap) instead of cell-center only.
     */
    function clampFurnitureOffset(ix, iz, iy, ox, oz, hx, hz) {
      const half = BUILD_CELL * 0.5;
      const t = BUILD_WALL_T;
      const clear = 0.04; // visual gap from wall face
      let minOx = -half + hx + 0.02;
      let maxOx = half - hx - 0.02;
      let minOz = -half + hz + 0.02;
      let maxOz = half - hz - 0.02;
      const list = piecesInCell(ix, iy, iz);
      const pool = list.length ? list : buildPieces;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (list.length && (p.ix !== ix || p.iy !== iy || p.iz !== iz)) continue;
        if ((!isWallType(p.type) && p.type !== "door") || p.type === "roof_wall") continue;
        const wy = ((p.yaw % 4) + 4) % 4;
        // Inner face of wall slab (walls sit on cell edges)
        if (wy === 0) maxOz = Math.min(maxOz, half - t - clear - hz);
        else if (wy === 2) minOz = Math.max(minOz, -half + t + clear + hz);
        else if (wy === 1) maxOx = Math.min(maxOx, half - t - clear - hx);
        else minOx = Math.max(minOx, -half + t + clear + hx);
      }
      if (minOx > maxOx) { const m = (minOx + maxOx) * 0.5; minOx = maxOx = m; }
      if (minOz > maxOz) { const m = (minOz + maxOz) * 0.5; minOz = maxOz = m; }
      let cox = Math.max(minOx, Math.min(maxOx, ox));
      let coz = Math.max(minOz, Math.min(maxOz, oz));
      // Magnetic snap toward walls / corners when close
      const snap = 0.22;
      if (cox - minOx < snap) cox = minOx;
      if (maxOx - cox < snap) cox = maxOx;
      if (coz - minOz < snap) coz = minOz;
      if (maxOz - coz < snap) coz = maxOz;
      return { ox: cox, oz: coz };
    }

    /** True if deploy footprint sits inside a wall / door volume. */
    function deployClipsWalls(cell) {
      if (!cell || !isFurnitureDeploy(cell.type)) return false;
      const box = pieceAabb(cell);
      // Tiny pad — furniture is already clamped clear of walls; allow corner seating
      const pad = 0.02;
      const inner = {
        minX: box.minX + pad, maxX: box.maxX - pad,
        minY: box.minY + 0.08, maxY: Math.min(box.maxY, box.minY + 1.2),
        minZ: box.minZ + pad, maxZ: box.maxZ - pad,
      };
      if (inner.minX >= inner.maxX || inner.minZ >= inner.maxZ) return false;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (!isWallType(p.type) && p.type !== "door") continue;
        if (p.iy !== cell.iy) continue;
        if (Math.abs(p.ix - cell.ix) > 1 || Math.abs(p.iz - cell.iz) > 1) continue;
        if (aabbOverlap3(inner, pieceAabb(p))) return true;
      }
      return false;
    }
    function furnitureOccupied(ix, iy, iz, exceptType) {
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.ix !== ix || p.iy !== iy || p.iz !== iz) continue;
        if (!isFurnitureDeploy(p.type)) continue;
        if (exceptType && p.type === exceptType) continue;
        return true;
      }
      return false;
    }

    /** True if candidate furniture AABB overlaps another deployable (not cell-lock). */
    function furnitureFootprintBlocked(cell) {
      if (!cell || !isFurnitureDeploy(cell.type)) return false;
      const a = pieceAabb(cell);
      // Small pad — allow tight side-by-side (TC + mesa) if volumes don't intersect
      const pad = 0.04;
      const inner = {
        minX: a.minX + pad, maxX: a.maxX - pad,
        minY: a.minY + 0.02, maxY: a.maxY,
        minZ: a.minZ + pad, maxZ: a.maxZ - pad,
      };
      if (inner.minX >= inner.maxX || inner.minZ >= inner.maxZ) return false;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (!isFurnitureDeploy(p.type)) continue;
        if (Math.abs(p.ix - cell.ix) > 1 || Math.abs(p.iz - cell.iz) > 1) continue;
        if (p.iy !== cell.iy) continue;
        if (aabbOverlap3(inner, pieceAabb(p))) return true;
      }
      return false;
    }

    /**
     * Sleeping bag: place on any dry ground. Only hard-block water / ocean edge
     * and trunks/rocks that actually sit under the bag footprint (not tree clear radii).
     */
    function sleepingBagGroundReason(cx, cz) {
      if (!chunk) return "sin terreno";
      if (islandEdge(cx, cz) > 0.12) return "cerca del mar";
      const h = sampleHeight(chunk, cx, cz);
      if (h < SEA_Y + 0.06) return "en el agua";
      const step = 0.55;
      const hx0 = sampleHeight(chunk, cx - step, cz);
      const hx1 = sampleHeight(chunk, cx + step, cz);
      const hz0 = sampleHeight(chunk, cx, cz - step);
      const hz1 = sampleHeight(chunk, cx, cz + step);
      const slope = Math.hypot(hx1 - hx0, hz1 - hz0) / (step * 2);
      if (slope > 1.35) return "demasiado inclinado";
      for (let i = 0; i < buildBlockers.length; i++) {
        const b = buildBlockers[i];
        // Tight radius — bag can sit under canopy / near rocks
        const need = b.kind === "tree" ? 0.55 : 0.7;
        if (Math.hypot(b.x - cx, b.z - cz) < need) {
          return b.kind === "tree" ? "tronco encima" : "roca encima";
        }
      }
      return null;
    }

    function buildPushVert(arr, x, y, z, nx, ny, nz, rgb, u, v) {
      arr.push(x, y, z, nx, ny, nz, rgb[0], rgb[1], rgb[2], u, v);
    }

    /** Emit baked old-chest GLB verts (local → world yaw). Returns true if mesh used. */
    function emitOldChestMesh(arr, cx, cz, base, yaw, scale, rgbOverride) {
      const mesh = oldChestMesh;
      if (!mesh || !mesh.floats || !(mesh.vertCount > 0)) return false;
      const s = scale != null ? scale : 1;
      const F = mesh.floats;
      const y4 = ((yaw % 4) + 4) % 4;
      for (let vi = 0; vi < mesh.vertCount; vi++) {
        const o = vi * 11;
        const lx = F[o] * s, ly = F[o + 1] * s, lz = F[o + 2] * s;
        const lnx = F[o + 3], lny = F[o + 4], lnz = F[o + 5];
        let wx, wz, wnx, wnz;
        if (y4 === 0) { wx = cx + lx; wz = cz + lz; wnx = lnx; wnz = lnz; }
        else if (y4 === 1) { wx = cx + lz; wz = cz - lx; wnx = lnz; wnz = -lnx; }
        else if (y4 === 2) { wx = cx - lx; wz = cz - lz; wnx = -lnx; wnz = -lnz; }
        else { wx = cx - lz; wz = cz + lx; wnx = -lnz; wnz = lnx; }
        const col = rgbOverride != null ? rgbOverride : [F[o + 6], F[o + 7], F[o + 8]];
        buildPushVert(arr, wx, base + ly, wz, wnx, lny, wnz, col, F[o + 9] + 10.0, F[o + 10]);
      }
      return true;
    }

    /** Emit baked workbench mesh for tier (fallback false → procedural). */
    function emitWorkbenchMesh(arr, cx, cz, base, yaw, tier, rgbOverride) {
      const t = tier >= 3 ? 3 : (tier >= 2 ? 2 : 1);
      const mesh = workbenchMeshes[t];
      if (!mesh || !mesh.floats || !(mesh.vertCount > 0)) return false;
      const s = 1.3; // +30% over baked size
      const F = mesh.floats;
      const y4 = ((yaw % 4) + 4) % 4;
      for (let vi = 0; vi < mesh.vertCount; vi++) {
        const o = vi * 11;
        const lx = F[o] * s, ly = F[o + 1] * s, lz = F[o + 2] * s;
        const lnx = F[o + 3], lny = F[o + 4], lnz = F[o + 5];
        let wx, wz, wnx, wnz;
        if (y4 === 0) { wx = cx + lx; wz = cz + lz; wnx = lnx; wnz = lnz; }
        else if (y4 === 1) { wx = cx + lz; wz = cz - lx; wnx = lnz; wnz = -lnx; }
        else if (y4 === 2) { wx = cx - lx; wz = cz - lz; wnx = -lnx; wnz = -lnz; }
        else { wx = cx - lz; wz = cz + lx; wnx = -lnz; wnz = lnx; }
        const col = rgbOverride != null ? rgbOverride : [F[o + 6], F[o + 7], F[o + 8]];
        buildPushVert(arr, wx, base + ly, wz, wnx, lny, wnz, col, F[o + 9] + 10.0, F[o + 10]);
      }
      return true;
    }

    /** Emit baked research table mesh (fallback false → procedural). */
    function emitResearchTableMesh(arr, cx, cz, base, yaw, rgbOverride) {
      const mesh = researchTableMesh;
      if (!mesh || !mesh.floats || !(mesh.vertCount > 0)) return false;
      const s = 1.35;
      const F = mesh.floats;
      const y4 = ((yaw % 4) + 4) % 4;
      const busy = (typeof window !== "undefined" && window.__fw
        && window.__fw.researchBusyUntil
        && performance.now() < window.__fw.researchBusyUntil);
      for (let vi = 0; vi < mesh.vertCount; vi++) {
        const o = vi * 11;
        const lx = F[o] * s, ly = F[o + 1] * s, lz = F[o + 2] * s;
        const lnx = F[o + 3], lny = F[o + 4], lnz = F[o + 5];
        let wx, wz, wnx, wnz;
        if (y4 === 0) { wx = cx + lx; wz = cz + lz; wnx = lnx; wnz = lnz; }
        else if (y4 === 1) { wx = cx + lz; wz = cz - lx; wnx = lnz; wnz = -lnx; }
        else if (y4 === 2) { wx = cx - lx; wz = cz - lz; wnx = -lnx; wnz = -lnz; }
        else { wx = cx - lz; wz = cz + lx; wnx = -lnz; wnz = lnx; }
        let col = rgbOverride != null ? rgbOverride : [
          Math.min(1, F[o + 6] * 1.08 + 0.04),
          Math.min(1, F[o + 7] * 1.08 + 0.04),
          Math.min(1, F[o + 8] * 1.06 + 0.035),
        ];
        if (busy && rgbOverride == null) {
          const pulse = 0.12 + 0.1 * Math.sin(performance.now() * 0.008);
          col = [
            Math.min(1, col[0] + 0.18 + pulse),
            Math.min(1, col[1] + 0.22 + pulse),
            Math.min(1, col[2] + 0.35 + pulse),
          ];
        }
        buildPushVert(arr, wx, base + ly, wz, wnx, lny, wnz, col, F[o + 9] + 10.0, F[o + 10]);
      }
      return true;
    }

    function buildPushBox(arr, x0, y0, z0, x1, y1, z1, rgb) {
      const faces = [
        { n: [0, 1, 0], v: [[x0,y1,z0,0,0],[x1,y1,z0,1,0],[x1,y1,z1,1,1],[x0,y1,z1,0,1]] },
        { n: [0,-1, 0], v: [[x0,y0,z1,0,0],[x1,y0,z1,1,0],[x1,y0,z0,1,1],[x0,y0,z0,0,1]] },
        { n: [0, 0, 1], v: [[x0,y0,z1,0,0],[x0,y1,z1,0,1],[x1,y1,z1,1,1],[x1,y0,z1,1,0]] },
        { n: [0, 0,-1], v: [[x1,y0,z0,0,0],[x1,y1,z0,0,1],[x0,y1,z0,1,1],[x0,y0,z0,1,0]] },
        { n: [1, 0, 0], v: [[x1,y0,z1,0,0],[x1,y1,z1,0,1],[x1,y1,z0,1,1],[x1,y0,z0,1,0]] },
        { n: [-1,0, 0], v: [[x0,y0,z0,0,0],[x0,y1,z0,0,1],[x0,y1,z1,1,1],[x0,y0,z1,1,0]] },
      ];
      for (let fi = 0; fi < faces.length; fi++) {
        const F = faces[fi];
        const n = F.n;
        const q = F.v;
        const tris = [[0, 1, 2], [0, 2, 3]];
        for (let t = 0; t < 2; t++) {
          for (let k = 0; k < 3; k++) {
            const p = q[tris[t][k]];
            buildPushVert(arr, p[0], p[1], p[2], n[0], n[1], n[2], rgb, p[3], p[4]);
          }
        }
      }
    }

    /** Local furniture box (lx/lz around piece center) rotated by yaw 0..3 ×90°. */
    function buildPushBoxLocal(arr, cx, cz, yaw, lx0, y0, lz0, lx1, y1, lz1, rgb) {
      const y = ((yaw % 4) + 4) % 4;
      function rot(lx, lz) {
        if (y === 0) return [cx + lx, cz + lz];
        if (y === 1) return [cx + lz, cz - lx];
        if (y === 2) return [cx - lx, cz - lz];
        return [cx - lz, cz + lx];
      }
      const corners = [
        rot(lx0, lz0), rot(lx1, lz0), rot(lx1, lz1), rot(lx0, lz1),
      ];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < corners.length; i++) {
        minX = Math.min(minX, corners[i][0]);
        maxX = Math.max(maxX, corners[i][0]);
        minZ = Math.min(minZ, corners[i][1]);
        maxZ = Math.max(maxZ, corners[i][1]);
      }
      buildPushBox(arr, minX, y0, minZ, maxX, y1, maxZ, rgb);
    }

    function buildPushTri(arr, ax, ay, az, bx, by, bz, cx, cy, cz, rgb) {
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      buildPushVert(arr, ax, ay, az, nx, ny, nz, rgb, 0, 0);
      buildPushVert(arr, bx, by, bz, nx, ny, nz, rgb, 1, 0);
      buildPushVert(arr, cx, cy, cz, nx, ny, nz, rgb, 0.5, 1);
      // backface
      buildPushVert(arr, ax, ay, az, -nx, -ny, -nz, rgb, 0, 0);
      buildPushVert(arr, cx, cy, cz, -nx, -ny, -nz, rgb, 0.5, 1);
      buildPushVert(arr, bx, by, bz, -nx, -ny, -nz, rgb, 1, 0);
    }

    /** Soft FX card. Negative U marks it as radial dust in fs_build_fx. */
    function buildPushDustQuad(arr, cx, cy, cz, size, angle, rgb) {
      const sx = Math.cos(angle) * size;
      const sz = Math.sin(angle) * size;
      const nx = -Math.sin(angle);
      const nz = Math.cos(angle);
      const y0 = cy - size * 0.55;
      const y1 = cy + size * 0.7;
      const q = [
        [cx - sx, y0, cz - sz, -2, 0],
        [cx + sx, y0, cz + sz, -1, 0],
        [cx + sx, y1, cz + sz, -1, 1],
        [cx - sx, y1, cz - sz, -2, 1],
      ];
      const tris = [[0, 1, 2], [0, 2, 3]];
      for (let t = 0; t < 2; t++) {
        for (let k = 0; k < 3; k++) {
          const p = q[tris[t][k]];
          buildPushVert(arr, p[0], p[1], p[2], nx, 0.15, nz, rgb, p[3], p[4]);
        }
      }
    }

    function buildLogBeamX(arr, x0, x1, y0, y1, zc, halfW, rgb) {
      const h = y1 - y0;
      const mid = y0 + h * 0.5;
      buildPushBox(arr, x0, y0, zc - halfW, x1, y1, zc + halfW, rgb);
      const s = halfW * 0.72;
      buildPushBox(arr, x0, mid - h * 0.28, zc - halfW * 1.15, x1, mid + h * 0.28, zc + halfW * 1.15, rgb);
      buildPushBox(arr, x0, y0 - h * 0.08, zc - s, x1, y1 + h * 0.08, zc + s, rgb);
    }
    function buildLogBeamZ(arr, z0, z1, y0, y1, xc, halfW, rgb) {
      const h = y1 - y0;
      const mid = y0 + h * 0.5;
      buildPushBox(arr, xc - halfW, y0, z0, xc + halfW, y1, z1, rgb);
      const s = halfW * 0.72;
      buildPushBox(arr, xc - halfW * 1.15, mid - h * 0.28, z0, xc + halfW * 1.15, mid + h * 0.28, z1, rgb);
      buildPushBox(arr, xc - s, y0 - h * 0.08, z0, xc + s, y1 + h * 0.08, z1, rgb);
    }

    /** Faceted vertical post (reads rounder than a single box). */
    function buildBarkPost(arr, cx, cz, y0, y1, r, bark, barkDark) {
      buildPushBox(arr, cx - r, y0, cz - r * 0.72, cx + r, y1, cz + r * 0.72, bark);
      buildPushBox(arr, cx - r * 0.72, y0, cz - r, cx + r * 0.72, y1, cz + r, bark);
      buildPushBox(arr, cx - r * 0.88, y0, cz - r * 0.88, cx + r * 0.88, y1, cz + r * 0.88, barkDark);
      const f = r * 1.35;
      buildPushBox(arr, cx - f, y0 - 0.02, cz - f, cx + f, y0 + 0.05, cz + f, barkDark);
    }
    /** Horizontal roundish log along X. */
    function buildRoundLogX(arr, x0, x1, yc, zc, r, bark, barkDark) {
      buildPushBox(arr, x0, yc - r, zc - r * 0.7, x1, yc + r, zc + r * 0.7, bark);
      buildPushBox(arr, x0, yc - r * 0.7, zc - r, x1, yc + r * 0.7, zc + r, bark);
      buildPushBox(arr, x0, yc - r * 0.85, zc - r * 0.85, x1, yc + r * 0.85, zc + r * 0.85, barkDark);
      const ring = [bark[0] * 0.55, bark[1] * 0.55, bark[2] * 0.55];
      buildPushBox(arr, x0 - 0.02, yc - r * 0.9, zc - r * 0.9, x0 + 0.03, yc + r * 0.9, zc + r * 0.9, ring);
      buildPushBox(arr, x1 - 0.03, yc - r * 0.9, zc - r * 0.9, x1 + 0.02, yc + r * 0.9, zc + r * 0.9, ring);
      buildPushBox(arr, x0 - 0.01, yc - r * 0.45, zc - r * 0.45, x0 + 0.04, yc + r * 0.45, zc + r * 0.45, barkDark);
      buildPushBox(arr, x1 - 0.04, yc - r * 0.45, zc - r * 0.45, x1 + 0.01, yc + r * 0.45, zc + r * 0.45, barkDark);
    }
    /** Horizontal roundish log along Z. */
    function buildRoundLogZ(arr, z0, z1, yc, xc, r, bark, barkDark) {
      buildPushBox(arr, xc - r * 0.7, yc - r, z0, xc + r * 0.7, yc + r, z1, bark);
      buildPushBox(arr, xc - r, yc - r * 0.7, z0, xc + r, yc + r * 0.7, z1, bark);
      buildPushBox(arr, xc - r * 0.85, yc - r * 0.85, z0, xc + r * 0.85, yc + r * 0.85, z1, barkDark);
      const ring = [bark[0] * 0.55, bark[1] * 0.55, bark[2] * 0.55];
      buildPushBox(arr, xc - r * 0.9, yc - r * 0.9, z0 - 0.02, xc + r * 0.9, yc + r * 0.9, z0 + 0.03, ring);
      buildPushBox(arr, xc - r * 0.9, yc - r * 0.9, z1 - 0.03, xc + r * 0.9, yc + r * 0.9, z1 + 0.02, ring);
      buildPushBox(arr, xc - r * 0.45, yc - r * 0.45, z0 - 0.01, xc + r * 0.45, yc + r * 0.45, z0 + 0.04, barkDark);
      buildPushBox(arr, xc - r * 0.45, yc - r * 0.45, z1 - 0.04, xc + r * 0.45, yc + r * 0.45, z1 + 0.01, barkDark);
    }
    /** Cream twine wrap around a post at height y. */
    function buildRopeWrap(arr, cx, cz, y, r, rope) {
      const t = 0.055;
      const out = r + 0.03;
      buildPushBox(arr, cx - out, y, cz - out, cx + out, y + t, cz + out, rope);
      buildPushBox(arr, cx - out * 1.05, y + t * 0.15, cz - out * 0.7, cx + out * 1.05, y + t * 0.85, cz + out * 0.7, rope);
      buildPushBox(arr, cx - out * 0.7, y + t * 0.15, cz - out * 1.05, cx + out * 0.7, y + t * 0.85, cz + out * 1.05, rope);
    }
    /** Diagonal brace under the deck (post → inward). */
    function buildDiagBrace(arr, x0, y0, z0, x1, y1, z1, half, rgb) {
      const steps = 5;
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const ax = x0 + (x1 - x0) * t0, ay = y0 + (y1 - y0) * t0, az = z0 + (z1 - z0) * t0;
        const bx = x0 + (x1 - x0) * t1, by = y0 + (y1 - y0) * t1, bz = z0 + (z1 - z0) * t1;
        buildPushBox(
          arr,
          Math.min(ax, bx) - half, Math.min(ay, by) - half * 0.7, Math.min(az, bz) - half,
          Math.max(ax, bx) + half, Math.max(ay, by) + half * 0.7, Math.max(az, bz) + half,
          rgb
        );
      }
    }

    function buildPost(arr, cx, cz, y0, y1, half, rgb) {
      buildBarkPost(arr, cx, cz, y0, y1, half, rgb, [
        Math.max(0.05, rgb[0] * 0.72),
        Math.max(0.03, rgb[1] * 0.72),
        Math.max(0.02, rgb[2] * 0.72),
      ]);
    }

    /** Neighbor bits: 1=+Z(N), 2=+X(E), 4=-Z(S), 8=-X(W) — shared decks hide double posts/lips. */
    function deckNeighborMask(ix, iz, iy) {
      let m = 0;
      if (findDeck(ix, iz + 1, iy)) m |= 1;
      if (findDeck(ix + 1, iz, iy)) m |= 2;
      if (findDeck(ix, iz - 1, iy)) m |= 4;
      if (findDeck(ix - 1, iz, iy)) m |= 8;
      return m;
    }

    function wallYawPresent(ix, iz, iy, yaw) {
      const y = ((yaw % 4) + 4) % 4;
      const list = piecesInCell(ix, iy, iz);
      const pool = list.length ? list : buildPieces;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (list.length && (p.ix !== ix || p.iz !== iz || p.iy !== iy)) continue;
        if (!list.length && (p.ix !== ix || p.iz !== iz || p.iy !== iy)) continue;
        if (isWallType(p.type) && p.type !== "roof_wall" && ((p.yaw % 4) + 4) % 4 === y) return true;
      }
      return false;
    }

    /** Which wall ends meet another wall (corner join) — bits: 1=start, 2=end along slab. */
    function wallEndJoinMask(ix, iz, iy, yaw) {
      const y = ((yaw % 4) + 4) % 4;
      let m = 0;
      // Same-cell perpendicular walls form corners
      if (y === 0 || y === 2) {
        if (wallYawPresent(ix, iz, iy, 3)) m |= 1; // -X end
        if (wallYawPresent(ix, iz, iy, 1)) m |= 2; // +X end
      } else {
        if (wallYawPresent(ix, iz, iy, 2)) m |= 1; // -Z end
        if (wallYawPresent(ix, iz, iy, 0)) m |= 2; // +Z end
      }
      // Continuous run into neighboring cell same yaw
      if (y === 0 || y === 2) {
        if (wallYawPresent(ix - 1, iz, iy, y)) m |= 1;
        if (wallYawPresent(ix + 1, iz, iy, y)) m |= 2;
      } else {
        if (wallYawPresent(ix, iz - 1, iy, y)) m |= 1;
        if (wallYawPresent(ix, iz + 1, iy, y)) m |= 2;
      }
      return m;
    }

    function buildRustPlatform(arr, x0, z0, x1, z1, base, rgb, neighMask, tier) {
      const n = neighMask | 0;
      const hasN = !!(n & 1), hasE = !!(n & 2), hasS = !!(n & 4), hasW = !!(n & 8);
      const t = tier | 0;
      const ghost = rgb && rgb[0] === rgb[1] && rgb[1] === rgb[2]
        && (rgb[0] <= 0.02 || rgb[0] >= 0.98);
      const yFoot = base - 0.08;
      const yDeck = base + BUILD_FOUND_H;
      const deckT = BUILD_FLOOR_T * 0.72;

      // --- Armored (tier 4): concrete foot + HQ steel posts/plates (Rust HQ foundation) ---
      if (!ghost && t >= 4) {
        const plate = [0.22, 0.24, 0.28];
        const plateLite = [0.34, 0.36, 0.40];
        const plateDark = [0.12, 0.13, 0.15];
        const concrete = [0.55, 0.52, 0.48];
        const concDark = [0.40, 0.38, 0.35];
        const post = 0.14;
        const inset = post + 0.06;
        const dx0 = hasW ? x0 - 0.01 : x0 + 0.12;
        const dx1 = hasE ? x1 + 0.01 : x1 - 0.12;
        const dz0 = hasS ? z0 - 0.01 : z0 + 0.12;
        const dz1 = hasN ? z1 + 0.01 : z1 - 0.12;
        // Solid skirt / concrete plinth (no stilts gap — can't walk through)
        buildPushBox(arr, x0 + 0.02, yFoot, z0 + 0.02, x1 - 0.02, yDeck - deckT - 0.02, z1 - 0.02, concDark);
        buildPushBox(arr, x0 - 0.02, yFoot - 0.02, z0 - 0.02, x1 + 0.02, yFoot + 0.18, z1 + 0.02, concrete);
        const corners = [
          { x: x0 + inset, z: z0 + inset, skip: hasW || hasS },
          { x: x1 - inset, z: z0 + inset, skip: hasE || hasS },
          { x: x0 + inset, z: z1 - inset, skip: hasW || hasN },
          { x: x1 - inset, z: z1 - inset, skip: hasE || hasN },
        ];
        for (let i = 0; i < 4; i++) {
          if (corners[i].skip) continue;
          const px = corners[i].x, pz = corners[i].z;
          buildPushBox(arr, px - post, yFoot + 0.15, pz - post, px + post, yDeck + 0.1, pz + post, plate);
          buildPushBox(arr, px - post * 1.15, yDeck - 0.02, pz - post * 1.15, px + post * 1.15, yDeck + 0.14, pz + post * 1.15, plateLite);
          // Rivet nubs
          buildPushBox(arr, px - 0.04, yDeck + 0.08, pz - post - 0.02, px + 0.04, yDeck + 0.14, pz - post + 0.02, plateLite);
        }
        // Steel rim beams — span into neighbor cells so seams don't notch
        const rimY0 = yDeck - deckT - 0.1, rimY1 = yDeck - deckT + 0.02;
        const hw = 0.1;
        const rx0 = hasW ? x0 - 0.02 : x0 + inset;
        const rx1 = hasE ? x1 + 0.02 : x1 - inset;
        const rz0 = hasS ? z0 - 0.02 : z0 + inset;
        const rz1 = hasN ? z1 + 0.02 : z1 - inset;
        if (!hasS) buildPushBox(arr, rx0, rimY0, z0 + inset - hw, rx1, rimY1, z0 + inset + hw, plateDark);
        if (!hasN) buildPushBox(arr, rx0, rimY0, z1 - inset - hw, rx1, rimY1, z1 - inset + hw, plateDark);
        if (!hasW) buildPushBox(arr, x0 + inset - hw, rimY0, rz0, x0 + inset + hw, rimY1, rz1, plateDark);
        if (!hasE) buildPushBox(arr, x1 - inset - hw, rimY0, rz0, x1 - inset + hw, rimY1, rz1, plateDark);
        // Dark metal deck
        buildPushBox(arr, dx0, yDeck - deckT, dz0, dx1, yDeck, dz1, plate);
        buildPushBox(arr, dx0 + 0.05, yDeck - 0.02, dz0 + 0.05, dx1 - 0.05, yDeck + 0.04, dz1 - 0.05, plateLite);
        // Edge lips
        if (!hasS) buildPushBox(arr, dx0, yDeck - 0.01, z0 + 0.08, dx1, yDeck + 0.08, z0 + 0.2, plateDark);
        if (!hasN) buildPushBox(arr, dx0, yDeck - 0.01, z1 - 0.2, dx1, yDeck + 0.08, z1 - 0.08, plateDark);
        if (!hasW) buildPushBox(arr, x0 + 0.08, yDeck - 0.01, dz0, x0 + 0.2, yDeck + 0.08, dz1, plateDark);
        if (!hasE) buildPushBox(arr, x1 - 0.2, yDeck - 0.01, dz0, x1 - 0.08, yDeck + 0.08, dz1, plateDark);
        return;
      }

      // --- Metal (tier 3): corrugated sheet + angle iron + rivets (Rust metal) ---
      if (!ghost && t >= 3) {
        const rust = [0.50, 0.28, 0.12];
        const rustDark = [0.30, 0.14, 0.06];
        const steel = [0.42, 0.43, 0.45];
        const steelLite = [0.55, 0.56, 0.58];
        const steelDark = [0.26, 0.27, 0.29];
        const post = 0.11;
        const inset = post + 0.1;
        const dx0 = hasW ? x0 - 0.01 : x0 + 0.12;
        const dx1 = hasE ? x1 + 0.01 : x1 - 0.12;
        const dz0 = hasS ? z0 - 0.01 : z0 + 0.12;
        const dz1 = hasN ? z1 + 0.01 : z1 - 0.12;
        buildPushBox(arr, x0 + 0.04, yFoot, z0 + 0.04, x1 - 0.04, yDeck - deckT - 0.02, z1 - 0.04, steelDark);
        const panelH = yDeck - deckT - yFoot;

        function pushRivet(px, py, pz) {
          const r = 0.028;
          buildPushBox(arr, px - r, py - r * 0.4, pz - r, px + r, py + r * 0.7, pz + r, steelLite);
        }

        // Corrugated skirt: thin ridges (geometry), steel with sparse rust patches
        function skirtX(zFace, outward) {
          const nRidge = 14;
          const depth = 0.045;
          for (let i = 0; i < nRidge; i++) {
            const u0 = i / nRidge, u1 = (i + 1) / nRidge;
            const xa = x0 + 0.1 + u0 * (x1 - x0 - 0.2);
            const xb = x0 + 0.1 + u1 * (x1 - x0 - 0.2);
            const raised = (i % 2) === 0;
            const d = raised ? depth : depth * 0.35;
            const z0p = outward < 0 ? zFace - d : zFace;
            const z1p = outward < 0 ? zFace : zFace + d;
            const rusty = (i === 3 || i === 9);
            const col = rusty ? rust : (raised ? steelLite : steel);
            buildPushBox(arr, xa + 0.004, yFoot + 0.03, z0p, xb - 0.004, yFoot + panelH - 0.02, z1p, col);
          }
          // Horizontal strap + rivets
          const sy = yFoot + panelH * 0.55;
          const z0s = outward < 0 ? zFace - depth - 0.02 : zFace;
          const z1s = outward < 0 ? zFace : zFace + depth + 0.02;
          buildPushBox(arr, x0 + 0.12, sy, z0s, x1 - 0.12, sy + 0.05, z1s, steelDark);
          for (let k = 0; k < 5; k++) {
            const px = x0 + 0.25 + k * ((x1 - x0 - 0.5) / 4);
            pushRivet(px, sy + 0.03, outward < 0 ? zFace - depth - 0.01 : zFace + depth + 0.01);
          }
        }
        function skirtZ(xFace, outward) {
          const nRidge = 14;
          const depth = 0.045;
          for (let i = 0; i < nRidge; i++) {
            const u0 = i / nRidge, u1 = (i + 1) / nRidge;
            const za = z0 + 0.1 + u0 * (z1 - z0 - 0.2);
            const zb = z0 + 0.1 + u1 * (z1 - z0 - 0.2);
            const raised = (i % 2) === 0;
            const d = raised ? depth : depth * 0.35;
            const x0p = outward < 0 ? xFace - d : xFace;
            const x1p = outward < 0 ? xFace : xFace + d;
            const rusty = (i === 4 || i === 11);
            const col = rusty ? rust : (raised ? steelLite : steel);
            buildPushBox(arr, x0p, yFoot + 0.03, za + 0.004, x1p, yFoot + panelH - 0.02, zb - 0.004, col);
          }
          const sy = yFoot + panelH * 0.55;
          const x0s = outward < 0 ? xFace - depth - 0.02 : xFace;
          const x1s = outward < 0 ? xFace : xFace + depth + 0.02;
          buildPushBox(arr, x0s, sy, z0 + 0.12, x1s, sy + 0.05, z1 - 0.12, steelDark);
          for (let k = 0; k < 5; k++) {
            const pz = z0 + 0.25 + k * ((z1 - z0 - 0.5) / 4);
            pushRivet(outward < 0 ? xFace - depth - 0.01 : xFace + depth + 0.01, sy + 0.03, pz);
          }
        }
        if (!hasS) skirtX(z0 + 0.08, -1);
        if (!hasN) skirtX(z1 - 0.08, 1);
        if (!hasW) skirtZ(x0 + 0.08, -1);
        if (!hasE) skirtZ(x1 - 0.08, 1);

        // Angle-iron corner posts + rivet caps
        const corners = [
          { x: x0 + inset, z: z0 + inset, skip: hasW || hasS },
          { x: x1 - inset, z: z0 + inset, skip: hasE || hasS },
          { x: x0 + inset, z: z1 - inset, skip: hasW || hasN },
          { x: x1 - inset, z: z1 - inset, skip: hasE || hasN },
        ];
        for (let i = 0; i < 4; i++) {
          if (corners[i].skip) continue;
          const px = corners[i].x, pz = corners[i].z;
          buildPushBox(arr, px - post, yFoot, pz - post * 0.35, px + post, yDeck + 0.1, pz + post * 0.35, steel);
          buildPushBox(arr, px - post * 0.35, yFoot, pz - post, px + post * 0.35, yDeck + 0.1, pz + post, steel);
          buildPushBox(arr, px - post * 1.05, yDeck - 0.02, pz - post * 1.05, px + post * 1.05, yDeck + 0.12, pz + post * 1.05, steelLite);
          pushRivet(px, yDeck + 0.1, pz);
          pushRivet(px - post * 0.55, yFoot + panelH * 0.35, pz - post * 0.55);
          pushRivet(px + post * 0.55, yFoot + panelH * 0.7, pz + post * 0.55);
        }

        // Deck: raised corrugation ridges (physical), steel colors for metal_grain
        const nRidge = 16;
        const span = Math.max(0.25, dz1 - dz0);
        const pitch = span / nRidge;
        buildPushBox(arr, dx0, yDeck - deckT, dz0, dx1, yDeck - 0.02, dz1, steelDark);
        for (let i = 0; i < nRidge; i++) {
          const za = dz0 + i * pitch + pitch * 0.08;
          const zb = za + pitch * 0.55;
          const h = (i % 2) ? 0.035 : 0.055;
          const col = (i % 4 === 0) ? rustDark : ((i % 2) ? steel : steelLite);
          buildPushBox(arr, dx0 + 0.02, yDeck - 0.03, za, dx1 - 0.02, yDeck - 0.03 + h, zb, col);
        }
        // Angle-iron rim (steel, not solid rust bar)
        const lip = 0.07;
        const lipW = 0.09;
        if (!hasS) {
          buildPushBox(arr, dx0, yDeck - 0.01, z0 + 0.09, dx1, yDeck + lip, z0 + 0.09 + lipW, steelDark);
          buildPushBox(arr, dx0, yDeck + lip - 0.02, z0 + 0.09, dx1, yDeck + lip + 0.02, z0 + 0.09 + lipW * 0.45, rust);
        }
        if (!hasN) {
          buildPushBox(arr, dx0, yDeck - 0.01, z1 - 0.09 - lipW, dx1, yDeck + lip, z1 - 0.09, steelDark);
          buildPushBox(arr, dx0, yDeck + lip - 0.02, z1 - 0.09 - lipW * 0.45, dx1, yDeck + lip + 0.02, z1 - 0.09, rust);
        }
        if (!hasW) {
          buildPushBox(arr, x0 + 0.09, yDeck - 0.01, dz0, x0 + 0.09 + lipW, yDeck + lip, dz1, steelDark);
          buildPushBox(arr, x0 + 0.09, yDeck + lip - 0.02, dz0, x0 + 0.09 + lipW * 0.45, yDeck + lip + 0.02, dz1, rust);
        }
        if (!hasE) {
          buildPushBox(arr, x1 - 0.09 - lipW, yDeck - 0.01, dz0, x1 - 0.09, yDeck + lip, dz1, steelDark);
          buildPushBox(arr, x1 - 0.09 - lipW * 0.45, yDeck + lip - 0.02, dz0, x1 - 0.09, yDeck + lip + 0.02, dz1, rust);
        }
        return;
      }

      // --- Stone (tier 2): full masonry — sides AND deck are stone blocks ---
      if (!ghost && t >= 2) {
        const stone = [0.58, 0.55, 0.50];
        const stoneLite = [0.66, 0.63, 0.58];
        const stoneDark = [0.42, 0.40, 0.37];
        const mortar = [0.38, 0.36, 0.33];
        const dx0 = hasW ? x0 - 0.01 : x0 + 0.08;
        const dx1 = hasE ? x1 + 0.01 : x1 - 0.08;
        const dz0 = hasS ? z0 - 0.01 : z0 + 0.08;
        const dz1 = hasN ? z1 + 0.01 : z1 - 0.08;
        // Solid stone core (no wood under anything)
        buildPushBox(arr, x0 + 0.02, yFoot, z0 + 0.02, x1 - 0.02, yDeck - deckT, z1 - 0.02, stoneDark);
        const rows = 3;
        for (let row = 0; row < rows; row++) {
          const yb = yFoot + (row / rows) * (yDeck - deckT - yFoot);
          const yt = yFoot + ((row + 1) / rows) * (yDeck - deckT - yFoot) - 0.02;
          const stagger = (row % 2) * 0.2;
          if (!hasS) {
            for (let i = 0; i < 4; i++) {
              const xa = x0 + 0.08 + stagger + i * 0.7;
              const xb = Math.min(x1 - 0.08, xa + 0.62);
              if (xa >= x1 - 0.1) break;
              buildPushBox(arr, xa, yb, z0 + 0.02, xb, yt, z0 + 0.14, i % 2 ? stone : stoneLite);
            }
          }
          if (!hasN) {
            for (let i = 0; i < 4; i++) {
              const xa = x0 + 0.08 + stagger + i * 0.7;
              const xb = Math.min(x1 - 0.08, xa + 0.62);
              if (xa >= x1 - 0.1) break;
              buildPushBox(arr, xa, yb, z1 - 0.14, xb, yt, z1 - 0.02, i % 2 ? stone : stoneLite);
            }
          }
          if (!hasW) {
            for (let i = 0; i < 4; i++) {
              const za = z0 + 0.08 + stagger + i * 0.7;
              const zb = Math.min(z1 - 0.08, za + 0.62);
              if (za >= z1 - 0.1) break;
              buildPushBox(arr, x0 + 0.02, yb, za, x0 + 0.14, yt, zb, i % 2 ? stone : stoneLite);
            }
          }
          if (!hasE) {
            for (let i = 0; i < 4; i++) {
              const za = z0 + 0.08 + stagger + i * 0.7;
              const zb = Math.min(z1 - 0.08, za + 0.62);
              if (za >= z1 - 0.1) break;
              buildPushBox(arr, x1 - 0.14, yb, za, x1 - 0.02, yt, zb, i % 2 ? stone : stoneLite);
            }
          }
        }
        // Flagstone deck tiles (not a flat slab that could look like planks)
        const mortarG = 0.03;
        const nX = 4, nZ = 4;
        const cellW = (dx1 - dx0 - mortarG * (nX - 1)) / nX;
        const cellD = (dz1 - dz0 - mortarG * (nZ - 1)) / nZ;
        buildPushBox(arr, dx0 - 0.01, yDeck - deckT, dz0 - 0.01, dx1 + 0.01, yDeck - 0.02, dz1 + 0.01, mortar);
        for (let ix = 0; ix < nX; ix++) {
          for (let iz = 0; iz < nZ; iz++) {
            const xa = dx0 + ix * (cellW + mortarG);
            const xb = xa + cellW;
            const za = dz0 + iz * (cellD + mortarG);
            const zb = za + cellD;
            const col = ((ix + iz) % 2) ? stone : stoneLite;
            buildPushBox(arr, xa, yDeck - 0.04, za, xb, yDeck + 0.02, zb, col);
          }
        }
        // Stone coping rim
        const lip = 0.08;
        const lipW = 0.12;
        if (!hasS) buildPushBox(arr, dx0, yDeck - 0.01, z0 + 0.06, dx1, yDeck + lip, z0 + 0.06 + lipW, stoneDark);
        if (!hasN) buildPushBox(arr, dx0, yDeck - 0.01, z1 - 0.06 - lipW, dx1, yDeck + lip, z1 - 0.06, stoneDark);
        if (!hasW) buildPushBox(arr, x0 + 0.06, yDeck - 0.01, dz0, x0 + 0.06 + lipW, yDeck + lip, dz1, stoneDark);
        if (!hasE) buildPushBox(arr, x1 - 0.06 - lipW, yDeck - 0.01, dz0, x1 - 0.06, yDeck + lip, dz1, stoneDark);
        return;
      }

      // --- Wood (tier 1): milled oak posts + plank deck (not straw stilts) ---
      if (!ghost && t >= 1) {
        const oak = [0.36, 0.22, 0.10];
        const oakDark = [0.20, 0.12, 0.05];
        const oakLite = [0.48, 0.32, 0.16];
        const oakMid = [0.40, 0.26, 0.12];
        const post = 0.13;
        const inset = post + 0.1;
        const beamH = 0.16;
        const beamW = 0.14;
        const dx0 = hasW ? x0 - 0.01 : x0 + post * 1.35;
        const dx1 = hasE ? x1 + 0.01 : x1 - post * 1.35;
        const dz0 = hasS ? z0 - 0.01 : z0 + post * 1.35;
        const dz1 = hasN ? z1 + 0.01 : z1 - post * 1.35;
        const corners = [
          { x: x0 + inset, z: z0 + inset, skip: hasW || hasS },
          { x: x1 - inset, z: z0 + inset, skip: hasE || hasS },
          { x: x0 + inset, z: z1 - inset, skip: hasW || hasN },
          { x: x1 - inset, z: z1 - inset, skip: hasE || hasN },
        ];
        // Square timber stilts
        for (let i = 0; i < 4; i++) {
          if (corners[i].skip) continue;
          const px = corners[i].x, pz = corners[i].z;
          buildPushBox(arr, px - post, yFoot, pz - post, px + post, yDeck + 0.1, pz + post, oak);
          buildPushBox(arr, px - post * 0.72, yFoot, pz - post * 0.72, px + post * 0.72, yDeck + 0.1, pz + post * 0.72, oakDark);
          buildPushBox(arr, px - post * 1.2, yFoot - 0.02, pz - post * 1.2, px + post * 1.2, yFoot + 0.06, pz + post * 1.2, oakDark);
        }
        const rimX0 = hasW ? x0 - 0.03 : x0 + inset;
        const rimX1 = hasE ? x1 + 0.03 : x1 - inset;
        const rimZ0 = hasS ? z0 - 0.03 : z0 + inset;
        const rimZ1 = hasN ? z1 + 0.03 : z1 - inset;
        const yBeam0 = yDeck - deckT - beamH;
        const yBeam1 = yDeck - deckT + 0.02;
        // Square rim beams (not round twig logs)
        if (!hasS) buildPushBox(arr, rimX0, yBeam0, z0 + inset - beamW * 0.5, rimX1, yBeam1, z0 + inset + beamW * 0.5, oakDark);
        if (!hasN) buildPushBox(arr, rimX0, yBeam0, z1 - inset - beamW * 0.5, rimX1, yBeam1, z1 - inset + beamW * 0.5, oakDark);
        if (!hasW) buildPushBox(arr, x0 + inset - beamW * 0.5, yBeam0, rimZ0, x0 + inset + beamW * 0.5, yBeam1, rimZ1, oakDark);
        if (!hasE) buildPushBox(arr, x1 - inset - beamW * 0.5, yBeam0, rimZ0, x1 - inset + beamW * 0.5, yBeam1, rimZ1, oakDark);
        // Under-deck joists
        const nJoist = 4;
        for (let j = 1; j < nJoist; j++) {
          const u = j / nJoist;
          const zx = dz0 + u * (dz1 - dz0);
          buildPushBox(arr, dx0 + 0.06, yBeam0 + 0.02, zx - 0.04, dx1 - 0.06, yDeck - deckT, zx + 0.04, oakDark);
        }
        // Visible plank strips on deck top
        const nPlank = 7;
        const gap = 0.018;
        const span = Math.max(0.2, dz1 - dz0);
        const plankW = (span - gap * (nPlank - 1)) / nPlank;
        for (let i = 0; i < nPlank; i++) {
          const za = dz0 + i * (plankW + gap);
          const zb = za + plankW;
          const col = (i % 2) ? oakMid : oakLite;
          buildPushBox(arr, dx0, yDeck - deckT, za, dx1, yDeck, zb, col);
        }
        const lip = 0.07;
        const lipW = 0.11;
        if (!hasS) buildPushBox(arr, rimX0, yDeck - 0.01, z0 + inset - 0.02, rimX1, yDeck + lip, z0 + inset + lipW, oak);
        if (!hasN) buildPushBox(arr, rimX0, yDeck - 0.01, z1 - inset - lipW, rimX1, yDeck + lip, z1 - inset + 0.02, oak);
        if (!hasW) buildPushBox(arr, x0 + inset - 0.02, yDeck - 0.01, rimZ0, x0 + inset + lipW, yDeck + lip, rimZ1, oak);
        if (!hasE) buildPushBox(arr, x1 - inset - lipW, yDeck - 0.01, rimZ0, x1 - inset + 0.02, yDeck + lip, rimZ1, oak);
        return;
      }

      // --- Twig (tier 0): bark stilts, round logs, straw deck, rope wraps ---
      const bark = ghost ? rgb : [0.32, 0.20, 0.10];
      const barkDark = ghost ? rgb : [0.18, 0.11, 0.055];
      const barkLite = ghost ? rgb : [0.40, 0.27, 0.14];
      const thatch = ghost ? rgb : [0.68, 0.54, 0.32];
      const thatchDark = ghost ? rgb : [0.48, 0.36, 0.20];
      const rope = ghost ? rgb : [0.86, 0.78, 0.62];

      const postR = 0.13;
      const logR = 0.11;
      const yLog = yDeck - deckT - logR * 0.2;
      const inset = postR + 0.08;
      const dx0 = hasW ? x0 - 0.01 : x0 + postR * 1.6;
      const dx1 = hasE ? x1 + 0.01 : x1 - postR * 1.6;
      const dz0 = hasS ? z0 - 0.01 : z0 + postR * 1.6;
      const dz1 = hasN ? z1 + 0.01 : z1 - postR * 1.6;
      const corners = [
        { x: x0 + inset, z: z0 + inset, skip: hasW || hasS },
        { x: x1 - inset, z: z0 + inset, skip: hasE || hasS },
        { x: x0 + inset, z: z1 - inset, skip: hasW || hasN },
        { x: x1 - inset, z: z1 - inset, skip: hasE || hasN },
      ];
      for (let i = 0; i < 4; i++) {
        const c = corners[i];
        if (c.skip) continue;
        buildBarkPost(arr, c.x, c.z, yFoot, yDeck + 0.12, postR, bark, barkDark);
        buildRopeWrap(arr, c.x, c.z, yLog - logR * 0.2, postR, rope);
        buildRopeWrap(arr, c.x, c.z, yDeck + 0.02, postR * 0.95, rope);
      }
      const logInset = inset + 0.02;
      const rimX0 = hasW ? x0 - 0.03 : x0 + logInset;
      const rimX1 = hasE ? x1 + 0.03 : x1 - logInset;
      const rimZ0 = hasS ? z0 - 0.03 : z0 + logInset;
      const rimZ1 = hasN ? z1 + 0.03 : z1 - logInset;
      if (!hasS) {
        buildRoundLogX(arr, rimX0, rimX1, yLog, z0 + inset, logR, barkLite, barkDark);
      }
      if (!hasN) {
        buildRoundLogX(arr, rimX0, rimX1, yLog, z1 - inset, logR, barkLite, barkDark);
      }
      if (!hasW) {
        buildRoundLogZ(arr, rimZ0, rimZ1, yLog, x0 + inset, logR, barkLite, barkDark);
      }
      if (!hasE) {
        buildRoundLogZ(arr, rimZ0, rimZ1, yLog, x1 - inset, logR, barkLite, barkDark);
      }
      buildPushBox(arr, dx0, yDeck - deckT, dz0, dx1, yDeck, dz1, thatch);
      buildPushBox(arr, dx0 + 0.04, yDeck - deckT - 0.03, dz0 + 0.04, dx1 - 0.04, yDeck - deckT + 0.01, dz1 - 0.04, thatchDark);
      const lip = 0.06;
      const lipW = postR * 1.1;
      if (!hasS) buildPushBox(arr, rimX0, yDeck - 0.01, z0 + inset - 0.02, rimX1, yDeck + lip, z0 + inset + lipW, thatchDark);
      if (!hasN) buildPushBox(arr, rimX0, yDeck - 0.01, z1 - inset - lipW, rimX1, yDeck + lip, z1 - inset + 0.02, thatchDark);
      if (!hasW) buildPushBox(arr, x0 + inset - 0.02, yDeck - 0.01, rimZ0, x0 + inset + lipW, yDeck + lip, rimZ1, thatchDark);
      if (!hasE) buildPushBox(arr, x1 - inset - lipW, yDeck - 0.01, rimZ0, x1 - inset + 0.02, yDeck + lip, rimZ1, thatchDark);
    }

    /** Equilateral triangle deck attached to a square-cell edge (yaw = edge). */
    function buildTriPlatform(arr, x0, z0, x1, z1, base, yaw, rgb) {
      const yDeck = base + BUILD_FOUND_H;
      const deckT = BUILD_FLOOR_T * 0.7;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      const h = BUILD_TRI_H;
      let a, b, c;
      if (yaw === 0) { // +Z edge of cell → apex further +Z
        a = [x0, z1]; b = [x1, z1]; c = [cx, z1 + h];
      } else if (yaw === 1) {
        a = [x1, z0]; b = [x1, z1]; c = [x1 + h, cz];
      } else if (yaw === 2) {
        a = [x1, z0]; b = [x0, z0]; c = [cx, z0 - h];
      } else {
        a = [x0, z1]; b = [x0, z0]; c = [x0 - h, cz];
      }
      const ghost = rgb && rgb[0] === rgb[1] && rgb[1] === rgb[2]
        && (rgb[0] <= 0.02 || rgb[0] >= 0.98);
      const bark = ghost ? rgb : [0.32, 0.20, 0.10];
      const barkDark = ghost ? rgb : [0.18, 0.11, 0.055];
      const thatch = ghost ? rgb : [0.68, 0.54, 0.32];
      const rope = ghost ? rgb : [0.86, 0.78, 0.62];
      const postR = 0.12;
      const yFoot = base - 0.08;
      const pts = [a, b, c];
      for (let i = 0; i < 3; i++) {
        buildBarkPost(arr, pts[i][0], pts[i][1], yFoot, yDeck + 0.08, postR, bark, barkDark);
        buildRopeWrap(arr, pts[i][0], pts[i][1], yDeck - deckT - 0.02, postR, rope);
      }
      const y0 = yDeck - deckT;
      const y1 = yDeck;
      buildPushTri(arr, a[0], y1, a[1], b[0], y1, b[1], c[0], y1, c[1], thatch);
      buildPushTri(arr, a[0], y0, a[1], c[0], y0, c[1], b[0], y0, b[1], thatch);
      const edges = [[a, b], [b, c], [c, a]];
      for (let e = 0; e < 3; e++) {
        const p0 = edges[e][0], p1 = edges[e][1];
        buildPushTri(arr, p0[0], y0, p0[1], p1[0], y0, p1[1], p1[0], y1, p1[1], bark);
        buildPushTri(arr, p0[0], y0, p0[1], p1[0], y1, p1[1], p0[0], y1, p0[1], bark);
      }
    }

    function buildSolidWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask) {
      buildPushBox(arr, x0, y0, z0, x1, y1, z1, rgb);
      const post = 0.14;
      const rail = 0.12;
      const skipStart = !!(endMask & 1);
      const skipEnd = !!(endMask & 2);
      if (axis === "x") {
        if (!skipStart) buildPushBox(arr, x0 - 0.01, y0, z0 - 0.01, x0 + post, y1, z1 + 0.01, rgb);
        if (!skipEnd) buildPushBox(arr, x1 - post, y0, z0 - 0.01, x1 + 0.01, y1, z1 + 0.01, rgb);
        buildPushBox(arr, x0, y1 - rail, z0 - 0.015, x1, y1 + 0.01, z1 + 0.015, rgb);
        buildPushBox(arr, x0, y0 - 0.01, z0 - 0.015, x1, y0 + rail, z1 + 0.015, rgb);
      } else {
        if (!skipStart) buildPushBox(arr, x0 - 0.01, y0, z0 - 0.01, x1 + 0.01, y1, z0 + post, rgb);
        if (!skipEnd) buildPushBox(arr, x0 - 0.01, y0, z1 - post, x1 + 0.01, y1, z1 + 0.01, rgb);
        buildPushBox(arr, x0 - 0.015, y1 - rail, z0, x1 + 0.015, y1 + 0.01, z1, rgb);
        buildPushBox(arr, x0 - 0.015, y0 - 0.01, z0, x1 + 0.015, y0 + rail, z1, rgb);
      }
    }

    /** Soft face = unfinished studs (vulnerable). Hard face = finished exterior. */
    function softHardRgbs(baseRgb) {
      const soft = [
        Math.max(0.08, baseRgb[0] * 0.62 + 0.08),
        Math.max(0.05, baseRgb[1] * 0.48),
        Math.max(0.04, baseRgb[2] * 0.38),
      ];
      const hard = [
        Math.min(1, baseRgb[0] * 1.08 + 0.04),
        Math.min(1, baseRgb[1] * 1.05 + 0.03),
        Math.min(1, baseRgb[2] * 1.02 + 0.02),
      ];
      return { soft, hard };
    }

    /**
     * Two-sided solid wall: hard face smooth, soft face darker with exposed studs.
     * softOnMax: soft sits on the max-thickness edge of the slab (max Z if axis=x, max X if axis=z).
     */
    function buildTwoSidedWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, softOnMax) {
      const { soft, hard } = softHardRgbs(rgb);
      const alongX = axis === "x";
      const mid = alongX ? (z0 + z1) * 0.5 : (x0 + x1) * 0.5;
      const gap = 0.004;
      // Max-face half vs min-face half
      let maxBox, minBox;
      if (alongX) {
        maxBox = [x0, y0, mid + gap, x1, y1, z1];
        minBox = [x0, y0, z0, x1, y1, mid - gap];
      } else {
        maxBox = [mid + gap, y0, z0, x1, y1, z1];
        minBox = [x0, y0, z0, mid - gap, y1, z1];
      }
      const softBox = softOnMax ? maxBox : minBox;
      const hardBox = softOnMax ? minBox : maxBox;

      buildPushBox(arr, softBox[0], softBox[1], softBox[2], softBox[3], softBox[4], softBox[5], soft);
      // Soft studs + plates
      const stud = 0.07;
      const studDepth = 0.038;
      const len0 = alongX ? x0 + 0.18 : z0 + 0.18;
      const len1 = alongX ? x1 - 0.18 : z1 - 0.18;
      for (let i = 0; i < 4; i++) {
        const a = len0 + ((i + 0.5) / 4) * (len1 - len0);
        if (alongX) {
          const faceZ = softOnMax ? z1 : z0;
          const zA = softOnMax ? faceZ : faceZ - studDepth;
          const zB = softOnMax ? faceZ + studDepth : faceZ;
          buildPushBox(arr, a - stud * 0.5, y0 + 0.08, zA, a + stud * 0.5, y1 - 0.08, zB, soft);
        } else {
          const faceX = softOnMax ? x1 : x0;
          const xA = softOnMax ? faceX : faceX - studDepth;
          const xB = softOnMax ? faceX + studDepth : faceX;
          buildPushBox(arr, xA, y0 + 0.08, a - stud * 0.5, xB, y1 - 0.08, a + stud * 0.5, soft);
        }
      }
      if (alongX) {
        const faceZ = softOnMax ? z1 : z0;
        const zA = softOnMax ? faceZ : faceZ - 0.03;
        const zB = softOnMax ? faceZ + 0.03 : faceZ;
        buildPushBox(arr, x0 + 0.05, y1 - 0.16, zA, x1 - 0.05, y1 - 0.06, zB, soft);
        buildPushBox(arr, x0 + 0.05, y0 + 0.06, zA, x1 - 0.05, y0 + 0.16, zB, soft);
      } else {
        const faceX = softOnMax ? x1 : x0;
        const xA = softOnMax ? faceX : faceX - 0.03;
        const xB = softOnMax ? faceX + 0.03 : faceX;
        buildPushBox(arr, xA, y1 - 0.16, z0 + 0.05, xB, y1 - 0.06, z1 - 0.05, soft);
        buildPushBox(arr, xA, y0 + 0.06, z0 + 0.05, xB, y0 + 0.16, z1 - 0.05, soft);
      }

      buildPushBox(arr, hardBox[0], hardBox[1], hardBox[2], hardBox[3], hardBox[4], hardBox[5], hard);
      // Hard bevel rails
      if (alongX) {
        const faceZ = softOnMax ? z0 : z1;
        const zA = softOnMax ? faceZ - 0.012 : faceZ;
        const zB = softOnMax ? faceZ : faceZ + 0.012;
        buildPushBox(arr, x0 + 0.04, y1 - 0.08, zA, x1 - 0.04, y1 + 0.01, zB, hard);
        buildPushBox(arr, x0 + 0.04, y0 - 0.01, zA, x1 - 0.04, y0 + 0.08, zB, hard);
      } else {
        const faceX = softOnMax ? x0 : x1;
        const xA = softOnMax ? faceX - 0.012 : faceX;
        const xB = softOnMax ? faceX : faceX + 0.012;
        buildPushBox(arr, xA, y1 - 0.08, z0 + 0.04, xB, y1 + 0.01, z1 - 0.04, hard);
        buildPushBox(arr, xA, y0 - 0.01, z0 + 0.04, xB, y0 + 0.08, z1 - 0.04, hard);
      }

      const post = 0.14;
      const rail = 0.12;
      const skipStart = !!(endMask & 1);
      const skipEnd = !!(endMask & 2);
      if (axis === "x") {
        if (!skipStart) buildPushBox(arr, x0 - 0.01, y0, z0 - 0.01, x0 + post, y1, z1 + 0.01, rgb);
        if (!skipEnd) buildPushBox(arr, x1 - post, y0, z0 - 0.01, x1 + 0.01, y1, z1 + 0.01, rgb);
        buildPushBox(arr, x0, y1 - rail, z0 - 0.015, x1, y1 + 0.01, z1 + 0.015, rgb);
        buildPushBox(arr, x0, y0 - 0.01, z0 - 0.015, x1, y0 + rail, z1 + 0.015, rgb);
      } else {
        if (!skipStart) buildPushBox(arr, x0 - 0.01, y0, z0 - 0.01, x1 + 0.01, y1, z0 + post, rgb);
        if (!skipEnd) buildPushBox(arr, x0 - 0.01, y0, z1 - post, x1 + 0.01, y1, z1 + 0.01, rgb);
        buildPushBox(arr, x0 - 0.015, y1 - rail, z0, x1 + 0.015, y1 + 0.01, z1, rgb);
        buildPushBox(arr, x0 - 0.015, y0 - 0.01, z0, x1 + 0.015, y0 + rail, z1, rgb);
      }
    }

    /** Hard-normal sits on max slab edge for yaw 0/1; on min edge for yaw 2/3. */
    function wallSoftOnMaxFace(yaw, softInward) {
      const y = ((yaw % 4) + 4) % 4;
      const hardOnMax = (y === 0 || y === 1);
      // softInward → soft opposite hard. soft on max = soft faces hard-normal side when !softInward
      return softInward ? !hardOnMax : hardOnMax;
    }

    /** Deterministic 0..1 for twig stick jitter (stable mesh cache). */
    function twigHash(seed) {
      const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    }
    function twigShade(rgb, k) {
      return [
        Math.max(0.05, Math.min(1, rgb[0] * k)),
        Math.max(0.04, Math.min(1, rgb[1] * k)),
        Math.max(0.03, Math.min(1, rgb[2] * k)),
      ];
    }

    /**
     * Tier-0 "paja" wall: vertical sticks with gaps + horizontal lashings.
     * Looks like a crude pole fence instead of a solid slab.
     */
    function buildTwigWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, softOnMax, seed) {
      const alongX = axis === "x";
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const len = Math.max(0.2, a1 - a0);
      const thick = Math.max(0.08, t1 - t0);
      const midT = (t0 + t1) * 0.5;
      const skipStart = !!(endMask & 1);
      const skipEnd = !!(endMask & 2);
      const postR = 0.075;
      const stickSeed = seed != null ? seed : (a0 * 13.1 + a1 * 7.3 + y0 * 3.9);
      const soft = softHardRgbs(rgb).soft;
      const softOn = softOnMax !== false; // default soft on max face

      function stickBox(along, halfW, yBot, yTop, depthOff, halfD, col) {
        const cA = along;
        if (alongX) {
          buildPushBox(
            arr,
            cA - halfW, yBot, midT + depthOff - halfD,
            cA + halfW, yTop, midT + depthOff + halfD,
            col
          );
        } else {
          buildPushBox(
            arr,
            midT + depthOff - halfD, yBot, cA - halfW,
            midT + depthOff + halfD, yTop, cA + halfW,
            col
          );
        }
      }

      // Soft back slab (darker / studded look — vulnerable face)
      {
        const softOff = softOn ? thick * 0.28 : -thick * 0.28;
        if (alongX) {
          buildPushBox(arr, a0, y0, midT + softOff - thick * 0.2, a1, y1, midT + softOff + thick * 0.2, soft);
        } else {
          buildPushBox(arr, midT + softOff - thick * 0.2, y0, a0, midT + softOff + thick * 0.2, y1, a1, soft);
        }
        // Soft studs
        for (let si = 0; si < 3; si++) {
          const u = (si + 0.5) / 3;
          const along = a0 + u * len;
          stickBox(along, 0.035, y0 + 0.08, y1 - 0.08, softOff, thick * 0.22, twigShade(soft, 0.85));
        }
      }

      // Hard-side poles offset slightly opposite soft
      const hardBias = softOn ? -thick * 0.06 : thick * 0.06;

      // Corner posts (skipped when joined to a neighbor wall)
      if (!skipStart) {
        stickBox(a0 + postR, postR, y0 - 0.02, y1 + 0.04, hardBias, thick * 0.42, twigShade(rgb, 0.72));
      }
      if (!skipEnd) {
        stickBox(a1 - postR, postR, y0 - 0.02, y1 + 0.04, hardBias, thick * 0.42, twigShade(rgb, 0.7));
      }

      // Vertical poles — leave visible gaps between them
      const spacing = 0.19;
      const n = Math.max(5, Math.round(len / spacing));
      const margin = postR * 1.6;
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5) / n;
        const along = a0 + margin + u * (len - margin * 2);
        const r0 = twigHash(stickSeed + i * 17.13);
        const r1 = twigHash(stickSeed + i * 31.77 + 2.4);
        const r2 = twigHash(stickSeed + i * 9.41 + 5.1);
        const halfW = 0.028 + r0 * 0.028;
        const halfD = 0.035 + r1 * 0.04;
        const depthOff = hardBias + (r2 - 0.5) * thick * 0.22;
        const lean = (twigHash(stickSeed + i * 5.7) - 0.5) * 0.05;
        const yTop = y1 - r0 * 0.14;
        const yBot = y0 - 0.01 + r1 * 0.03;
        const col = twigShade(rgb, 0.78 + r0 * 0.38);
        stickBox(along + lean, halfW, yBot, yTop, depthOff, halfD, col);
        // Occasional short diagonal brace for organic feel
        if (r1 > 0.78 && i < n - 1) {
          const along2 = along + spacing * 0.55;
          const midY = (yBot + yTop) * 0.55;
          stickBox(along2, halfW * 0.7, midY - 0.08, midY + 0.55, depthOff * 0.5, halfD * 0.75, twigShade(rgb, 0.65));
        }
      }

      // Horizontal lashings (3 rails binding the poles) + cream rope wraps
      const rope = [0.86, 0.78, 0.62];
      const binders = [0.16, 0.48, 0.82];
      for (let b = 0; b < binders.length; b++) {
        const by = y0 + (y1 - y0) * binders[b];
        const h = 0.04 + twigHash(stickSeed + b * 4.2) * 0.025;
        const railCol = twigShade(rgb, 0.62 + b * 0.06);
        if (alongX) {
          buildPushBox(arr, a0 + 0.02, by, midT - thick * 0.38, a1 - 0.02, by + h, midT + thick * 0.38, railCol);
        } else {
          buildPushBox(arr, midT - thick * 0.38, by, a0 + 0.02, midT + thick * 0.38, by + h, a1 - 0.02, railCol);
        }
        // Rope knots near corner posts
        if (!skipStart) stickBox(a0 + postR, postR * 1.35, by - 0.01, by + h + 0.03, 0, thick * 0.48, rope);
        if (!skipEnd) stickBox(a1 - postR, postR * 1.35, by - 0.01, by + h + 0.03, 0, thick * 0.48, rope);
      }
    }

    /**
     * Tier-1 wood: horizontal stacked bark logs in a post frame (Rust wood wall).
     */
    function buildWoodLogWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, softOnMax, seed) {
      const alongX = axis === "x";
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const midT = (t0 + t1) * 0.5;
      const thick = Math.max(0.1, t1 - t0);
      const skipStart = !!(endMask & 1);
      const skipEnd = !!(endMask & 2);
      const bark = [0.34, 0.22, 0.11];
      const barkDark = [0.18, 0.11, 0.055];
      const barkLite = [0.42, 0.28, 0.14];
      const soft = softHardRgbs(rgb).soft;
      const postR = 0.11;
      const logR = 0.13;
      const s = seed != null ? seed : a0 * 9.1;

      function facePush(along0, along1, yBot, yTop, depthOff, halfD, col) {
        if (alongX) {
          buildPushBox(arr, along0, yBot, midT + depthOff - halfD, along1, yTop, midT + depthOff + halfD, col);
        } else {
          buildPushBox(arr, midT + depthOff - halfD, yBot, along0, midT + depthOff + halfD, yTop, along1, col);
        }
      }

      // Soft back slab (vulnerable face)
      const softOff = softOnMax ? thick * 0.22 : -thick * 0.22;
      facePush(a0, a1, y0, y1, softOff, thick * 0.28, soft);

      // Corner posts
      if (!skipStart) {
        if (alongX) buildBarkPost(arr, a0 + postR, midT, y0 - 0.02, y1 + 0.04, postR, bark, barkDark);
        else buildBarkPost(arr, midT, a0 + postR, y0 - 0.02, y1 + 0.04, postR, bark, barkDark);
      }
      if (!skipEnd) {
        if (alongX) buildBarkPost(arr, a1 - postR, midT, y0 - 0.02, y1 + 0.04, postR, bark, barkDark);
        else buildBarkPost(arr, midT, a1 - postR, y0 - 0.02, y1 + 0.04, postR, bark, barkDark);
      }

      // Stacked horizontal logs (hard face)
      const hardOff = softOnMax ? -thick * 0.08 : thick * 0.08;
      const nLogs = Math.max(6, Math.round((y1 - y0) / (logR * 1.85)));
      const margin = postR * 1.5;
      for (let i = 0; i < nLogs; i++) {
        const u = (i + 0.5) / nLogs;
        const yc = y0 + u * (y1 - y0);
        const r = logR * (0.88 + twigHash(s + i * 13.7) * 0.22);
        const col = twigHash(s + i) > 0.55 ? bark : barkLite;
        if (alongX) {
          buildRoundLogX(arr, a0 + margin, a1 - margin, yc, midT + hardOff, r, col, barkDark);
        } else {
          buildRoundLogZ(arr, a0 + margin, a1 - margin, yc, midT + hardOff, r, col, barkDark);
        }
      }
      // Top / bottom rails
      facePush(a0 + 0.02, a1 - 0.02, y1 - 0.1, y1 + 0.02, hardOff, thick * 0.4, barkDark);
      facePush(a0 + 0.02, a1 - 0.02, y0 - 0.02, y0 + 0.1, hardOff, thick * 0.4, barkDark);
    }

    /**
     * Tier-2 stone: irregular masonry blocks with mortar gaps.
     */
    function buildStoneWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, softOnMax, seed) {
      const alongX = axis === "x";
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const midT = (t0 + t1) * 0.5;
      const thick = Math.max(0.12, t1 - t0);
      const stone = rgb;
      const stoneLite = [
        Math.min(1, rgb[0] * 1.12 + 0.04),
        Math.min(1, rgb[1] * 1.1 + 0.03),
        Math.min(1, rgb[2] * 1.05 + 0.02),
      ];
      const mortar = [rgb[0] * 0.55, rgb[1] * 0.55, rgb[2] * 0.52];
      const soft = softHardRgbs(rgb).soft;
      const s = seed != null ? seed : a0 * 5.5;
      const softOff = softOnMax ? thick * 0.2 : -thick * 0.2;
      const hardOff = softOnMax ? -thick * 0.05 : thick * 0.05;

      function faceBox(along0, along1, yBot, yTop, depthOff, halfD, col) {
        if (alongX) buildPushBox(arr, along0, yBot, midT + depthOff - halfD, along1, yTop, midT + depthOff + halfD, col);
        else buildPushBox(arr, midT + depthOff - halfD, yBot, along0, midT + depthOff + halfD, yTop, along1, col);
      }

      // Soft back + mortar fill core
      faceBox(a0, a1, y0, y1, softOff, thick * 0.3, soft);
      faceBox(a0, a1, y0, y1, 0, thick * 0.22, mortar);

      const rows = Math.max(5, Math.round((y1 - y0) / 0.38));
      for (let row = 0; row < rows; row++) {
        const yb = y0 + (row / rows) * (y1 - y0);
        const yt = y0 + ((row + 1) / rows) * (y1 - y0) - 0.02;
        const stagger = (row % 2) * 0.22;
        let along = a0 + 0.04 + stagger;
        let bi = 0;
        while (along < a1 - 0.08) {
          const r = twigHash(s + row * 40 + bi * 7);
          const w = 0.28 + r * 0.42;
          const aEnd = Math.min(a1 - 0.04, along + w);
          const jut = (twigHash(s + row * 11 + bi) - 0.4) * 0.04;
          const col = r > 0.55 ? stoneLite : stone;
          faceBox(along + 0.01, aEnd - 0.01, yb + 0.01, yt - 0.01, hardOff + jut, thick * 0.36, col);
          along = aEnd;
          bi++;
        }
      }
      // Corner quoins
      const skipStart = !!(endMask & 1);
      const skipEnd = !!(endMask & 2);
      if (!skipStart) faceBox(a0 - 0.01, a0 + 0.14, y0 - 0.01, y1 + 0.01, hardOff, thick * 0.42, stoneLite);
      if (!skipEnd) faceBox(a1 - 0.14, a1 + 0.01, y0 - 0.01, y1 + 0.01, hardOff, thick * 0.42, stoneLite);
    }

    /**
     * Tier-3 sheet metal: patchwork corrugated panels + rust bolts.
     */
    function buildSheetMetalWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, softOnMax, seed) {
      const alongX = axis === "x";
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const midT = (t0 + t1) * 0.5;
      const thick = Math.max(0.1, t1 - t0);
      const rust = rgb;
      const rustDark = [rgb[0] * 0.65, rgb[1] * 0.55, rgb[2] * 0.5];
      // Cool galvanized steel (equal RGB → fs_build metalness path + env reflections).
      // Soft-side luma must stay > 0.32 so it classifies as metal, not armored.
      const steel = [0.58, 0.60, 0.63];
      const steelDark = [0.36, 0.38, 0.41];
      const soft = [0.34, 0.36, 0.39];
      const s = seed != null ? seed : a0 * 3.3;
      const softOff = softOnMax ? thick * 0.22 : -thick * 0.22;
      const hardOff = softOnMax ? -thick * 0.06 : thick * 0.06;

      function faceBox(along0, along1, yBot, yTop, depthOff, halfD, col) {
        if (alongX) buildPushBox(arr, along0, yBot, midT + depthOff - halfD, along1, yTop, midT + depthOff + halfD, col);
        else buildPushBox(arr, midT + depthOff - halfD, yBot, along0, midT + depthOff + halfD, yTop, along1, col);
      }

      faceBox(a0, a1, y0, y1, softOff, thick * 0.28, soft);
      faceBox(a0, a1, y0, y1, 0, thick * 0.18, steelDark);

      // Patchwork panels — mostly steel so the upgrade reads as metal, with rust accents
      const cols = Math.max(3, Math.round((a1 - a0) / 0.85));
      const rows = Math.max(3, Math.round((y1 - y0) / 0.95));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const r = twigHash(s + row * 17 + col * 9);
          const aa = a0 + (col / cols) * (a1 - a0) + 0.02;
          const ab = a0 + ((col + 1) / cols) * (a1 - a0) - 0.02;
          const yb = y0 + (row / rows) * (y1 - y0) + 0.02;
          const yt = y0 + ((row + 1) / rows) * (y1 - y0) - 0.02;
          const jut = (r - 0.5) * 0.03;
          const panelCol = r > 0.28 ? (r > 0.72 ? steel : steelDark) : (r > 0.14 ? rust : rustDark);
          faceBox(aa, ab, yb, yt, hardOff + jut, thick * 0.32, panelCol);
          // Corrugation ribs (vertical or horizontal by panel)
          if (r > 0.45) {
            const nRib = Math.max(3, Math.round((ab - aa) / 0.14));
            for (let i = 0; i < nRib; i++) {
              const u = (i + 0.5) / nRib;
              const c = aa + u * (ab - aa);
              faceBox(c - 0.02, c + 0.02, yb + 0.02, yt - 0.02, hardOff + jut + 0.012, thick * 0.34, panelCol);
            }
          } else {
            const nRib = Math.max(3, Math.round((yt - yb) / 0.14));
            for (let i = 0; i < nRib; i++) {
              const u = (i + 0.5) / nRib;
              const yc = yb + u * (yt - yb);
              faceBox(aa + 0.02, ab - 0.02, yc - 0.02, yc + 0.02, hardOff + jut + 0.012, thick * 0.34, panelCol);
            }
          }
        }
      }
      // Edge frame rails
      faceBox(a0 - 0.01, a0 + 0.08, y0, y1, hardOff, thick * 0.38, rustDark);
      faceBox(a1 - 0.08, a1 + 0.01, y0, y1, hardOff, thick * 0.38, rustDark);
      faceBox(a0, a1, y1 - 0.08, y1 + 0.01, hardOff, thick * 0.38, rustDark);
      faceBox(a0, a1, y0 - 0.01, y0 + 0.08, hardOff, thick * 0.38, rustDark);
    }

    /**
     * Tier-4 armored: heavy HQ plates, rivets, top brackets, concrete foot.
     */
    function buildArmoredWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, softOnMax, seed) {
      const alongX = axis === "x";
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const midT = (t0 + t1) * 0.5;
      const thick = Math.max(0.12, t1 - t0);
      const plate = rgb;
      const plateLite = [
        Math.min(1, rgb[0] * 1.25 + 0.04),
        Math.min(1, rgb[1] * 1.22 + 0.04),
        Math.min(1, rgb[2] * 1.18 + 0.03),
      ];
      const plateDark = [rgb[0] * 0.55, rgb[1] * 0.55, rgb[2] * 0.58];
      const concrete = [0.55, 0.52, 0.48];
      const soft = softHardRgbs(rgb).soft;
      const softOff = softOnMax ? thick * 0.2 : -thick * 0.2;
      const hardOff = softOnMax ? -thick * 0.04 : thick * 0.04;
      const s = seed != null ? seed : a0 * 2.1;

      function faceBox(along0, along1, yBot, yTop, depthOff, halfD, col) {
        if (alongX) buildPushBox(arr, along0, yBot, midT + depthOff - halfD, along1, yTop, midT + depthOff + halfD, col);
        else buildPushBox(arr, midT + depthOff - halfD, yBot, along0, midT + depthOff + halfD, yTop, along1, col);
      }

      faceBox(a0, a1, y0, y1, softOff, thick * 0.3, soft);
      faceBox(a0, a1, y0, y1, 0, thick * 0.22, plateDark);

      // Concrete footing
      faceBox(a0 - 0.02, a1 + 0.02, y0 - 0.04, y0 + 0.22, hardOff, thick * 0.45, concrete);

      // Large plates 2×3
      const cols = 2;
      const rows = 3;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const aa = a0 + 0.06 + (col / cols) * (a1 - a0 - 0.12);
          const ab = a0 + 0.06 + ((col + 1) / cols) * (a1 - a0 - 0.12) - 0.04;
          const yb = y0 + 0.24 + (row / rows) * (y1 - y0 - 0.4);
          const yt = y0 + 0.24 + ((row + 1) / rows) * (y1 - y0 - 0.4) - 0.04;
          faceBox(aa, ab, yb, yt, hardOff, thick * 0.36, plate);
          // Rivet dots around plate edge
          for (let i = 0; i < 5; i++) {
            const u = (i + 0.5) / 5;
            const c = aa + u * (ab - aa);
            const r = 0.035;
            faceBox(c - r, c + r, yb + 0.04, yb + 0.04 + r * 2, hardOff + 0.02, thick * 0.38, plateLite);
            faceBox(c - r, c + r, yt - 0.04 - r * 2, yt - 0.04, hardOff + 0.02, thick * 0.38, plateLite);
          }
        }
      }
      // Central hatch plate
      const midA = (a0 + a1) * 0.5;
      const midY = (y0 + y1) * 0.52;
      faceBox(midA - 0.35, midA + 0.35, midY - 0.4, midY + 0.4, hardOff + 0.025, thick * 0.4, plateDark);
      faceBox(midA - 0.28, midA + 0.28, midY - 0.32, midY + 0.32, hardOff + 0.04, thick * 0.42, plateLite);

      // Top reinforcement strip + angled brackets
      faceBox(a0, a1, y1 - 0.18, y1 + 0.02, hardOff, thick * 0.42, plateLite);
      for (let i = 0; i < 4; i++) {
        const u = (i + 0.5) / 4;
        const c = a0 + u * (a1 - a0);
        faceBox(c - 0.06, c + 0.06, y1 - 0.42, y1 - 0.12, hardOff + 0.03, thick * 0.4, plateDark);
      }
      // Side seams
      faceBox(a0 - 0.01, a0 + 0.1, y0 + 0.2, y1, hardOff, thick * 0.4, plateDark);
      faceBox(a1 - 0.1, a1 + 0.01, y0 + 0.2, y1, hardOff, thick * 0.4, plateDark);
      void s;
      void endMask;
    }

    /** Tier-0 doorway / window: stick jambs + lintel, open hole in the middle. */
    function buildTwigFrameWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, openW, openH, openY0, seed) {
      const alongX = axis === "x";
      const mid = alongX ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
      const hw = openW * 0.5;
      const o0 = mid - hw;
      const o1 = mid + hw;
      const oy0 = y0 + openY0;
      const oy1 = Math.min(y1 - 0.1, oy0 + openH);
      const jamW = 0.14;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const thick = Math.max(0.08, t1 - t0);
      const midT = (t0 + t1) * 0.5;
      const s = seed != null ? seed : mid * 11.3;

      function post(along0, along1, yBot, yTop, col) {
        if (alongX) {
          buildPushBox(arr, along0, yBot, midT - thick * 0.4, along1, yTop, midT + thick * 0.4, col);
        } else {
          buildPushBox(arr, midT - thick * 0.4, yBot, along0, midT + thick * 0.4, yTop, along1, col);
        }
      }

      // Left / right jamb packs (2–3 sticks each)
      for (let side = 0; side < 2; side++) {
        const baseA = side === 0 ? (alongX ? x0 : z0) : o1;
        const endA = side === 0 ? o0 : (alongX ? x1 : z1);
        const span = endA - baseA;
        const n = Math.max(2, Math.round(span / 0.16));
        for (let i = 0; i < n; i++) {
          const u = (i + 0.5) / n;
          const c = baseA + u * span;
          const r = twigHash(s + side * 40 + i * 7);
          const half = 0.03 + r * 0.025;
          post(c - half, c + half, y0 - 0.01, y1 + 0.02, twigShade(rgb, 0.75 + r * 0.3));
        }
      }
      // Lintel sticks above opening
      const lintN = Math.max(3, Math.round(openW / 0.18));
      for (let i = 0; i < lintN; i++) {
        const u = (i + 0.5) / lintN;
        const c = o0 + u * (o1 - o0);
        const r = twigHash(s + 90 + i);
        const half = 0.028 + r * 0.022;
        post(c - half, c + half, oy1, y1 + 0.02, twigShade(rgb, 0.7 + r * 0.25));
      }
      // Sill under window (if any)
      if (oy0 > y0 + 0.05) {
        for (let i = 0; i < lintN; i++) {
          const u = (i + 0.5) / lintN;
          const c = o0 + u * (o1 - o0);
          const half = 0.03;
          post(c - half, c + half, y0, oy0, twigShade(rgb, 0.68));
        }
      }
      // Horizontal binders on jambs + over lintel
      const binders = [0.2, 0.55, 0.88];
      for (let b = 0; b < binders.length; b++) {
        const by = y0 + (y1 - y0) * binders[b];
        const h = 0.045;
        const col = twigShade(rgb, 0.6);
        if (alongX) {
          buildPushBox(arr, x0 + 0.02, by, midT - thick * 0.36, o0 - 0.01, by + h, midT + thick * 0.36, col);
          buildPushBox(arr, o1 + 0.01, by, midT - thick * 0.36, x1 - 0.02, by + h, midT + thick * 0.36, col);
          if (by >= oy1 - 0.05) {
            buildPushBox(arr, o0, by, midT - thick * 0.36, o1, by + h, midT + thick * 0.36, col);
          }
        } else {
          buildPushBox(arr, midT - thick * 0.36, by, z0 + 0.02, midT + thick * 0.36, by + h, o0 - 0.01, col);
          buildPushBox(arr, midT - thick * 0.36, by, o1 + 0.01, midT + thick * 0.36, by + h, z1 - 0.02, col);
          if (by >= oy1 - 0.05) {
            buildPushBox(arr, midT - thick * 0.36, by, o0, midT + thick * 0.36, by + h, o1, col);
          }
        }
      }
      // Keep jamW referenced for lintel thickness feel (corner thicken)
      post(o0 - jamW * 0.35, o0 + jamW * 0.15, y0, oy1 + 0.08, twigShade(rgb, 0.58));
      post(o1 - jamW * 0.15, o1 + jamW * 0.35, y0, oy1 + 0.08, twigShade(rgb, 0.58));
    }

    /** Wall with a rectangular opening (door / window). */
    function buildFrameWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, openW, openH, openY0) {
      const mid = axis === "x" ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
      const hw = openW * 0.5;
      const o0 = mid - hw;
      const o1 = mid + hw;
      const oy0 = y0 + openY0;
      const oy1 = Math.min(y1 - 0.12, oy0 + openH);
      if (axis === "x") {
        // left / right / lintel / sill
        buildPushBox(arr, x0, y0, z0, o0, y1, z1, rgb);
        buildPushBox(arr, o1, y0, z0, x1, y1, z1, rgb);
        buildPushBox(arr, o0, oy1, z0, o1, y1, z1, rgb);
        if (oy0 > y0 + 0.02) buildPushBox(arr, o0, y0, z0, o1, oy0, z1, rgb);
      } else {
        buildPushBox(arr, x0, y0, z0, x1, y1, o0, rgb);
        buildPushBox(arr, x0, y0, o1, x1, y1, z1, rgb);
        buildPushBox(arr, x0, oy1, o0, x1, y1, o1, rgb);
        if (oy0 > y0 + 0.02) buildPushBox(arr, x0, y0, o0, x1, oy0, o1, rgb);
      }
      // frame lip
      const lip = 0.04;
      if (axis === "x") {
        buildPushBox(arr, o0 - lip, oy0, z0 - lip, o0 + lip, oy1, z1 + lip, rgb);
        buildPushBox(arr, o1 - lip, oy0, z0 - lip, o1 + lip, oy1, z1 + lip, rgb);
        buildPushBox(arr, o0, oy1 - lip, z0 - lip, o1, oy1 + lip, z1 + lip, rgb);
      } else {
        buildPushBox(arr, x0 - lip, oy0, o0 - lip, x1 + lip, oy1, o0 + lip, rgb);
        buildPushBox(arr, x0 - lip, oy0, o1 - lip, x1 + lip, oy1, o1 + lip, rgb);
        buildPushBox(arr, x0 - lip, oy1 - lip, o0, x1 + lip, oy1 + lip, o1, rgb);
      }
    }

    function wallSlabForYaw(x0, z0, x1, z1, y0, y1, yaw, t) {
      if (yaw === 0) return { x0, y0, z0: z1 - t, x1, y1, z1, axis: "x" };
      if (yaw === 1) return { x0: x1 - t, y0, z0, x1, y1, z1, axis: "z" };
      if (yaw === 2) return { x0, y0, z0, x1, y1, z1: z0 + t, axis: "x" };
      return { x0, y0, z0, x1: x0 + t, y1, z1, axis: "z" };
    }

    function buildPitchedRoof(arr, x0, z0, x1, z1, yBase, yaw, rgb, rise) {
      const R = rise != null ? rise : BUILD_ROOF_RISE;
      const thick = BUILD_FLOOR_T * 0.9;
      // Roof spans cell: low edge at yBase, high edge at yBase+R
      let lo = [], hi = [];
      if (yaw === 0) {
        lo = [[x0, z0], [x1, z0]];
        hi = [[x0, z1], [x1, z1]];
      } else if (yaw === 1) {
        lo = [[x0, z0], [x0, z1]];
        hi = [[x1, z0], [x1, z1]];
      } else if (yaw === 2) {
        lo = [[x0, z1], [x1, z1]];
        hi = [[x0, z0], [x1, z0]];
      } else {
        lo = [[x1, z0], [x1, z1]];
        hi = [[x0, z0], [x0, z1]];
      }
      const yLo = yBase;
      const yHi = yBase + R;
      // top surface (two tris)
      buildPushTri(arr, lo[0][0], yLo, lo[0][1], lo[1][0], yLo, lo[1][1], hi[1][0], yHi, hi[1][1], rgb);
      buildPushTri(arr, lo[0][0], yLo, lo[0][1], hi[1][0], yHi, hi[1][1], hi[0][0], yHi, hi[0][1], rgb);
      // underside
      buildPushTri(arr, lo[0][0], yLo - thick, lo[0][1], hi[1][0], yHi - thick, hi[1][1], lo[1][0], yLo - thick, lo[1][1], rgb);
      buildPushTri(arr, lo[0][0], yLo - thick, lo[0][1], hi[0][0], yHi - thick, hi[0][1], hi[1][0], yHi - thick, hi[1][1], rgb);
      // edge beams
      buildPushBox(
        arr,
        Math.min(lo[0][0], lo[1][0]) - 0.02, yLo - thick, Math.min(lo[0][1], lo[1][1]) - 0.02,
        Math.max(lo[0][0], lo[1][0]) + 0.02, yLo + 0.04, Math.max(lo[0][1], lo[1][1]) + 0.02,
        rgb
      );
    }

    function buildTriRoof(arr, x0, z0, x1, z1, yBase, yaw, rgb) {
      const h = BUILD_TRI_H;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      const R = BUILD_ROOF_RISE;
      let a, b, c;
      if (yaw === 0) { a = [x0, z1]; b = [x1, z1]; c = [cx, z1 + h]; }
      else if (yaw === 1) { a = [x1, z0]; b = [x1, z1]; c = [x1 + h, cz]; }
      else if (yaw === 2) { a = [x1, z0]; b = [x0, z0]; c = [cx, z0 - h]; }
      else { a = [x0, z1]; b = [x0, z0]; c = [x0 - h, cz]; }
      // Rise toward apex
      buildPushTri(arr, a[0], yBase, a[1], b[0], yBase, b[1], c[0], yBase + R, c[1], rgb);
      buildPushTri(arr, a[0], yBase - 0.16, a[1], c[0], yBase + R - 0.16, c[1], b[0], yBase - 0.16, b[1], rgb);
    }

    function buildCornerRoof(arr, x0, z0, x1, z1, yBase, yaw, rgb, valley) {
      // Hip / valley: two pitched halves meeting at diagonal
      const R = BUILD_ROOF_RISE;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      const yPeak = yBase + (valley ? 0 : R);
      const yEdge = yBase + (valley ? R : 0);
      // rotate corners by yaw
      const corners = [
        [x0, z0], [x1, z0], [x1, z1], [x0, z1],
      ];
      const rot = ((yaw % 4) + 4) % 4;
      const c0 = corners[rot];
      const c1 = corners[(rot + 1) % 4];
      const c2 = corners[(rot + 2) % 4];
      const c3 = corners[(rot + 3) % 4];
      // Peak at outer corner c2 (hip) or center (valley-ish)
      if (valley) {
        buildPushTri(arr, c0[0], yEdge, c0[1], c1[0], yEdge, c1[1], cx, yPeak, cz, rgb);
        buildPushTri(arr, c1[0], yEdge, c1[1], c2[0], yEdge, c2[1], cx, yPeak, cz, rgb);
        buildPushTri(arr, c2[0], yEdge, c2[1], c3[0], yEdge, c3[1], cx, yPeak, cz, rgb);
        buildPushTri(arr, c3[0], yEdge, c3[1], c0[0], yEdge, c0[1], cx, yPeak, cz, rgb);
      } else {
        buildPushTri(arr, c0[0], yEdge, c0[1], c1[0], yEdge, c1[1], c2[0], yPeak, c2[1], rgb);
        buildPushTri(arr, c0[0], yEdge, c0[1], c2[0], yPeak, c2[1], c3[0], yEdge, c3[1], rgb);
      }
    }

    function buildGableWall(arr, x0, z0, x1, z1, y0, yaw, rgb) {
      // Triangular wall closing a pitched roof end — height BUILD_ROOF_RISE
      const t = BUILD_WALL_T;
      const y1 = y0 + BUILD_ROOF_RISE;
      const slab = wallSlabForYaw(x0, z0, x1, z1, y0, y1, yaw, t);
      // Approximate gable as full slab + peaked top trim
      buildSolidWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis);
      const midX = (x0 + x1) * 0.5;
      const midZ = (z0 + z1) * 0.5;
      if (yaw === 0 || yaw === 2) {
        const zc = yaw === 0 ? z1 - t * 0.5 : z0 + t * 0.5;
        buildPushTri(arr, x0, y1, zc, x1, y1, zc, midX, y1 + 0.02, zc, rgb);
      } else {
        const xc = yaw === 1 ? x1 - t * 0.5 : x0 + t * 0.5;
        buildPushTri(arr, xc, y1, z0, xc, y1, z1, xc, y1 + 0.02, midZ, rgb);
      }
    }

    /** Symmetric /\ roof cap: two slopes meet on the center ridge. */
    function buildRoofRidge(arr, x0, z0, x1, z1, yBase, yaw, rgb) {
      const rise = BUILD_ROOF_RISE;
      const thick = BUILD_FLOOR_T * 0.9;
      const cx = (x0 + x1) * 0.5;
      const cz = (z0 + z1) * 0.5;
      if (yaw === 0 || yaw === 2) {
        // Ridge runs east/west.
        buildPushTri(arr, x0, yBase, z0, x1, yBase, z0, x1, yBase + rise, cz, rgb);
        buildPushTri(arr, x0, yBase, z0, x1, yBase + rise, cz, x0, yBase + rise, cz, rgb);
        buildPushTri(arr, x0, yBase + rise, cz, x1, yBase + rise, cz, x1, yBase, z1, rgb);
        buildPushTri(arr, x0, yBase + rise, cz, x1, yBase, z1, x0, yBase, z1, rgb);
        buildPushTri(arr, x0, yBase - thick, z0, x1, yBase + rise - thick, cz, x1, yBase - thick, z0, rgb);
        buildPushTri(arr, x0, yBase - thick, z0, x0, yBase + rise - thick, cz, x1, yBase + rise - thick, cz, rgb);
        buildPushTri(arr, x0, yBase + rise - thick, cz, x1, yBase - thick, z1, x1, yBase + rise - thick, cz, rgb);
        buildPushTri(arr, x0, yBase + rise - thick, cz, x0, yBase - thick, z1, x1, yBase - thick, z1, rgb);
        buildPushBox(arr, x0, yBase + rise - 0.07, cz - 0.07, x1, yBase + rise + 0.07, cz + 0.07, rgb);
      } else {
        // Ridge runs north/south.
        buildPushTri(arr, x0, yBase, z0, cx, yBase + rise, z0, cx, yBase + rise, z1, rgb);
        buildPushTri(arr, x0, yBase, z0, cx, yBase + rise, z1, x0, yBase, z1, rgb);
        buildPushTri(arr, cx, yBase + rise, z0, x1, yBase, z0, x1, yBase, z1, rgb);
        buildPushTri(arr, cx, yBase + rise, z0, x1, yBase, z1, cx, yBase + rise, z1, rgb);
        buildPushTri(arr, x0, yBase - thick, z0, cx, yBase + rise - thick, z1, cx, yBase + rise - thick, z0, rgb);
        buildPushTri(arr, x0, yBase - thick, z0, x0, yBase - thick, z1, cx, yBase + rise - thick, z1, rgb);
        buildPushTri(arr, cx, yBase + rise - thick, z0, x1, yBase - thick, z1, x1, yBase - thick, z0, rgb);
        buildPushTri(arr, cx, yBase + rise - thick, z0, cx, yBase + rise - thick, z1, x1, yBase - thick, z1, rgb);
        buildPushBox(arr, cx - 0.07, yBase + rise - 0.07, z0, cx + 0.07, yBase + rise + 0.07, z1, rgb);
      }
    }

    function buildStairsRun(arr, x0, z0, x1, z1, base, yaw, rgb, steps, riseTotal, inset) {
      const n = steps || 6;
      const rise = (riseTotal != null ? riseTotal : BUILD_LEVEL_H) / n;
      const run = (yaw === 0 || yaw === 2 ? z1 - z0 : x1 - x0) / n;
      const pad = inset != null ? inset : 0.12;
      for (let s = 0; s < n; s++) {
        let ax0, az0, ax1, az1;
        const yb = base + s * rise;
        const yt = yb + rise;
        if (yaw === 0) {
          ax0 = x0 + pad; ax1 = x1 - pad;
          az0 = z0 + s * run; az1 = az0 + run * 0.92;
        } else if (yaw === 1) {
          az0 = z0 + pad; az1 = z1 - pad;
          ax0 = x0 + s * run; ax1 = ax0 + run * 0.92;
        } else if (yaw === 2) {
          ax0 = x0 + pad; ax1 = x1 - pad;
          az1 = z1 - s * run; az0 = az1 - run * 0.92;
        } else {
          az0 = z0 + pad; az1 = z1 - pad;
          ax1 = x1 - s * run; ax0 = ax1 - run * 0.92;
        }
        buildPushBox(arr, ax0, yb, az0, ax1, yt, az1, rgb);
      }
    }

    function buildLStairs(arr, x0, z0, x1, z1, base, yaw, rgb) {
      const mid = base + BUILD_LEVEL_H * 0.5;
      const hx = (x0 + x1) * 0.5;
      const hz = (z0 + z1) * 0.5;
      // first half-flight
      if (yaw === 0 || yaw === 2) {
        buildStairsRun(arr, x0, z0, hx, z1, base, yaw, rgb, 4, BUILD_LEVEL_H * 0.5, 0.08);
        buildStairsRun(arr, hx, z0, x1, z1, mid, (yaw + 1) & 3, rgb, 4, BUILD_LEVEL_H * 0.5, 0.08);
      } else {
        buildStairsRun(arr, x0, z0, x1, hz, base, yaw, rgb, 4, BUILD_LEVEL_H * 0.5, 0.08);
        buildStairsRun(arr, x0, hz, x1, z1, mid, (yaw + 1) & 3, rgb, 4, BUILD_LEVEL_H * 0.5, 0.08);
      }
      // landing
      buildPushBox(arr, hx - 0.35, mid - 0.08, hz - 0.35, hx + 0.35, mid + 0.04, hz + 0.35, rgb);
    }

    function buildUStairs(arr, x0, z0, x1, z1, base, yaw, rgb) {
      const mid = base + BUILD_LEVEL_H * 0.5;
      const hx = (x0 + x1) * 0.5;
      const hz = (z0 + z1) * 0.5;
      if (yaw === 0 || yaw === 2) {
        buildStairsRun(arr, x0, z0, hx - 0.05, z1, base, yaw, rgb, 5, BUILD_LEVEL_H * 0.5, 0.06);
        buildStairsRun(arr, hx + 0.05, z0, x1, z1, mid, (yaw + 2) & 3, rgb, 5, BUILD_LEVEL_H * 0.5, 0.06);
        buildPushBox(arr, x0 + 0.05, mid - 0.08, hz - 0.38, x1 - 0.05, mid + 0.04, hz + 0.38, rgb);
      } else {
        buildStairsRun(arr, x0, z0, x1, hz - 0.05, base, yaw, rgb, 5, BUILD_LEVEL_H * 0.5, 0.06);
        buildStairsRun(arr, x0, hz + 0.05, x1, z1, mid, (yaw + 2) & 3, rgb, 5, BUILD_LEVEL_H * 0.5, 0.06);
        buildPushBox(arr, hx - 0.38, mid - 0.08, z0 + 0.05, hx + 0.38, mid + 0.04, z1 - 0.05, rgb);
      }
    }

    function buildRamp(arr, x0, z0, x1, z1, base, yaw, rgb) {
      // Continuous ramp: 3 m rise over 3 m run (slope length ≈ 4.24 m)
      const y0 = base;
      const y1 = base + BUILD_LEVEL_H;
      const thick = 0.18;
      let a, b, c, d;
      if (yaw === 0) {
        a = [x0 + 0.1, y0, z0]; b = [x1 - 0.1, y0, z0];
        c = [x1 - 0.1, y1, z1]; d = [x0 + 0.1, y1, z1];
      } else if (yaw === 1) {
        a = [x0, y0, z0 + 0.1]; b = [x0, y0, z1 - 0.1];
        c = [x1, y1, z1 - 0.1]; d = [x1, y1, z0 + 0.1];
      } else if (yaw === 2) {
        a = [x0 + 0.1, y0, z1]; b = [x1 - 0.1, y0, z1];
        c = [x1 - 0.1, y1, z0]; d = [x0 + 0.1, y1, z0];
      } else {
        a = [x1, y0, z0 + 0.1]; b = [x1, y0, z1 - 0.1];
        c = [x0, y1, z1 - 0.1]; d = [x0, y1, z0 + 0.1];
      }
      buildPushTri(arr, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], rgb);
      buildPushTri(arr, a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], rgb);
      buildPushTri(arr, a[0], a[1] - thick, a[2], c[0], c[1] - thick, c[2], b[0], b[1] - thick, b[2], rgb);
      buildPushTri(arr, a[0], a[1] - thick, a[2], d[0], d[1] - thick, d[2], c[0], c[1] - thick, c[2], rgb);
      // side rails
      const steps = 8;
      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const yb = y0 + (y1 - y0) * t0;
        const yt = y0 + (y1 - y0) * t1 + 0.02;
        if (yaw === 0 || yaw === 2) {
          const zA = z0 + (z1 - z0) * t0;
          const zB = z0 + (z1 - z0) * t1;
          const za = Math.min(zA, zB), zb = Math.max(zA, zB);
          buildPushBox(arr, x0, yb, za, x0 + 0.08, yt + 0.35, zb, rgb);
          buildPushBox(arr, x1 - 0.08, yb, za, x1, yt + 0.35, zb, rgb);
        } else {
          const xA = x0 + (x1 - x0) * t0;
          const xB = x0 + (x1 - x0) * t1;
          const xa = Math.min(xA, xB), xb = Math.max(xA, xB);
          buildPushBox(arr, xa, yb, z0, xb, yt + 0.35, z0 + 0.08, rgb);
          buildPushBox(arr, xa, yb, z1 - 0.08, xb, yt + 0.35, z1, rgb);
        }
      }
    }

    function buildPieceMesh(piece, arr, rgbOverride) {
      const type = piece.type;
      const cell = BUILD_CELL;
      const x0 = piece.ix * cell;
      const z0 = piece.iz * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      const base = piece.baseY + piece.iy * BUILD_LEVEL_H;
      const yaw = ((piece.yaw % 4) + 4) % 4;
      const col = BUILD_COLORS[type] || BUILD_COLORS.wall;
      const rgb = rgbOverride != null ? rgbOverride : [col[0], col[1], col[2]];

      if (type === "foundation") {
        const nMask = deckNeighborMask(piece.ix, piece.iz, piece.iy);
        buildRustPlatform(arr, x0, z0, x1, z1, base, rgb, nMask, piece.tier | 0);
        return;
      }
      if (type === "foundation_tri") {
        buildTriPlatform(arr, x0, z0, x1, z1, base, yaw, rgb);
        return;
      }
      if (type === "floor") {
        const slabY = levelFloorSlabY(base);
        const y0 = slabY.y0, y1 = slabY.y1;
        const beam = Math.max(0.18, BUILD_BEAM * 0.75);
        const n = deckNeighborMask(piece.ix, piece.iz, piece.iy);
        const hasN = !!(n & 1), hasE = !!(n & 2), hasS = !!(n & 4), hasW = !!(n & 8);
        const fx0 = hasW ? x0 - 0.01 : x0 + 0.02;
        const fx1 = hasE ? x1 + 0.01 : x1 - 0.02;
        const fz0 = hasS ? z0 - 0.01 : z0 + 0.02;
        const fz1 = hasN ? z1 + 0.01 : z1 - 0.02;
        buildPushBox(arr, fx0, y0, fz0, fx1, y1, fz1, rgb);
        if (!hasS) buildPushBox(arr, fx0, y0, z0, fx1, y1, z0 + beam, rgb);
        if (!hasN) buildPushBox(arr, fx0, y0, z1 - beam, fx1, y1, z1, rgb);
        if (!hasW) buildPushBox(arr, x0, y0, fz0, x0 + beam, y1, fz1, rgb);
        if (!hasE) buildPushBox(arr, x1 - beam, y0, fz0, x1, y1, fz1, rgb);
        return;
      }
      if (type === "floor_frame") {
        const slabY = levelFloorSlabY(base);
        const y0 = slabY.y0, y1 = slabY.y1;
        const frame = 0.34;
        buildPushBox(arr, x0, y0, z0, x1, y1, z0 + frame, rgb);
        buildPushBox(arr, x0, y0, z1 - frame, x1, y1, z1, rgb);
        buildPushBox(arr, x0, y0, z0 + frame, x0 + frame, y1, z1 - frame, rgb);
        buildPushBox(arr, x1 - frame, y0, z0 + frame, x1, y1, z1 - frame, rgb);
        return;
      }
      if (type === "floor_tri") {
        const slabY = levelFloorSlabY(base);
        const y0 = slabY.y0, y1 = slabY.y1;
        const cx = (x0 + x1) * 0.5;
        const cz = (z0 + z1) * 0.5;
        const h = BUILD_TRI_H;
        let a, b, c;
        if (yaw === 0) { a = [x0, z1]; b = [x1, z1]; c = [cx, z1 + h]; }
        else if (yaw === 1) { a = [x1, z0]; b = [x1, z1]; c = [x1 + h, cz]; }
        else if (yaw === 2) { a = [x1, z0]; b = [x0, z0]; c = [cx, z0 - h]; }
        else { a = [x0, z1]; b = [x0, z0]; c = [x0 - h, cz]; }
        buildPushTri(arr, a[0], y1, a[1], b[0], y1, b[1], c[0], y1, c[1], rgb);
        buildPushTri(arr, a[0], y0, a[1], c[0], y0, c[1], b[0], y0, b[1], rgb);
        return;
      }
      if (isWallType(type)) {
        const t = BUILD_WALL_T;
        const wh = wallHeight(type);
        const yWall0 = wallSeatY(piece);
        const y1 = yWall0 + wh;
        const slab = wallSlabForYaw(x0, z0, x1, z1, yWall0, y1, yaw, t);
        const ends = wallEndJoinMask(piece.ix, piece.iz, piece.iy, yaw);
        const twig = (piece.tier | 0) === 0;
        const seed = piece.ix * 19.1 + piece.iz * 47.3 + piece.iy * 7.7 + yaw * 3.1;
        if (type === "doorway") {
          if (twig) {
            buildTwigFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, BUILD_DOOR_W, BUILD_DOOR_H, 0, seed);
          } else {
            buildFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, BUILD_DOOR_W, BUILD_DOOR_H, 0);
          }
        } else if (type === "doorway_d") {
          if (twig) {
            buildTwigFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 2.0, BUILD_DOOR_H, 0, seed);
          } else {
            buildFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 2.0, BUILD_DOOR_H, 0);
          }
        } else if (type === "window") {
          if (twig) {
            buildTwigFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 1.1, 1.1, 0.9, seed);
          } else {
            buildFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 1.1, 1.1, 0.9);
          }
        } else if (type === "wall_frame") {
          if (twig) {
            buildTwigFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 2.55, 2.62, 0.12, seed);
          } else {
            buildFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 2.55, 2.62, 0.12);
          }
        } else if (type === "pillar") {
          const cx = (x0 + x1) * 0.5;
          const cz = (z0 + z1) * 0.5;
          const half = 0.14;
          if (yaw === 0) buildPushBox(arr, cx - half, yWall0, z1 - half * 2, cx + half, y1, z1, rgb);
          else if (yaw === 1) buildPushBox(arr, x1 - half * 2, yWall0, cz - half, x1, y1, cz + half, rgb);
          else if (yaw === 2) buildPushBox(arr, cx - half, yWall0, z0, cx + half, y1, z0 + half * 2, rgb);
          else buildPushBox(arr, x0, yWall0, cz - half, x0 + half * 2, y1, cz + half, rgb);
        } else if (type === "roof_wall") {
          buildGableWall(arr, x0, z0, x1, z1, levelWallTopY(base), yaw, rgb);
        } else if (type === "door") {
          // Door leaf is drawn in the AAA mesh override (correct open/closed pose)
          return;
        } else if (wallOverlapsDoorwayOpening(piece)) {
          // Solid wall sharing a doorway edge — hide so the frame hole stays clear
          return;
        } else if (twig) {
          const softOnMax = wallSoftOnMaxFace(yaw, piece.softInward !== false);
          buildTwigWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends, softOnMax, seed);
        } else {
          const softOnMax = wallSoftOnMaxFace(yaw, piece.softInward !== false);
          const tier = piece.tier | 0;
          if (tier === 1) {
            buildWoodLogWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends, softOnMax, seed);
          } else if (tier === 2) {
            buildStoneWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends, softOnMax, seed);
          } else if (tier === 3) {
            buildSheetMetalWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends, softOnMax, seed);
          } else {
            buildArmoredWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends, softOnMax, seed);
          }
        }
        return;
      }
      if (type === "stairs") {
        buildStairsRun(arr, x0, z0, x1, z1, base + BUILD_FOUND_H * 0.15, yaw, rgb, 8, BUILD_LEVEL_H, 0.1);
        return;
      }
      if (type === "stairs_l") {
        buildLStairs(arr, x0, z0, x1, z1, base + BUILD_FOUND_H * 0.15, yaw, rgb);
        return;
      }
      if (type === "stairs_u") {
        buildUStairs(arr, x0, z0, x1, z1, base + BUILD_FOUND_H * 0.15, yaw, rgb);
        return;
      }
      if (type === "floor_steps") {
        buildStairsRun(arr, x0, z0, x1, z1, base + BUILD_FOUND_H * 0.15, yaw, rgb, 3, BUILD_FOUND_H * 0.8, 0.18);
        return;
      }
      if (type === "ramp") {
        buildRamp(arr, x0, z0, x1, z1, base + BUILD_FOUND_H * 0.15, yaw, rgb);
        return;
      }
      if (type === "roof") {
        buildPitchedRoof(arr, x0, z0, x1, z1, levelWallTopY(base), yaw, rgb, BUILD_ROOF_RISE);
        return;
      }
      if (type === "roof_tri") {
        buildTriRoof(arr, x0, z0, x1, z1, levelWallTopY(base), yaw, rgb);
        return;
      }
      if (type === "roof_ridge") {
        buildRoofRidge(arr, x0, z0, x1, z1, levelWallTopY(base), yaw, rgb);
        return;
      }
      if (type === "roof_corner") {
        buildCornerRoof(arr, x0, z0, x1, z1, levelWallTopY(base), yaw, rgb, false);
        return;
      }
      if (type === "roof_valley") {
        buildCornerRoof(arr, x0, z0, x1, z1, levelWallTopY(base), yaw, rgb, true);
        return;
      }
    }

    function pieceKey(p) {
      return p.type + ":" + p.ix + "," + p.iy + "," + p.iz + "," + (((p.yaw % 4) + 4) % 4);
    }

    /** 0 = closed, 1 = fully open (lerp during swing). */
    function doorOpenAmt(p) {
      if (!p) return 0;
      if (p._doorOpenAmt != null) return Math.max(0, Math.min(1, p._doorOpenAmt));
      return p.isOpen ? 1 : 0;
    }

    /**
     * Swinging metal door leaf around hinge.
     * Returns { minX,maxX,minY,maxY,minZ,maxZ, hx,hy,hz } (handle at free edge).
     */
    function doorLeafGeom(p) {
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const y0 = wallSeatY(p);
      const y1 = y0 + BUILD_DOOR_H;
      const yaw = ((p.yaw % 4) + 4) % 4;
      const w = BUILD_DOOR_W;
      const thick = 0.09;
      const amt = doorOpenAmt(p);
      const ang = amt * Math.PI * 0.5;
      const c = Math.cos(ang), s = Math.sin(ang);
      const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
      const hinge = mid - w * 0.5;
      let hx0, hz0, dx, dz, px, pz;
      if (yaw === 0) {
        hx0 = hinge; hz0 = z1 - 0.02;
        dx = c * w; dz = -s * w;
        px = s * thick; pz = c * thick;
      } else if (yaw === 2) {
        hx0 = hinge; hz0 = z0 + 0.02;
        dx = c * w; dz = s * w;
        px = -s * thick; pz = -c * thick;
      } else if (yaw === 1) {
        hx0 = x1 - 0.02; hz0 = hinge;
        dx = -s * w; dz = c * w;
        px = -c * thick; pz = s * thick;
      } else {
        hx0 = x0 + 0.02; hz0 = hinge;
        dx = s * w; dz = c * w;
        px = c * thick; pz = -s * thick;
      }
      const corners = [
        [hx0, hz0],
        [hx0 + dx, hz0 + dz],
        [hx0 + px, hz0 + pz],
        [hx0 + dx + px, hz0 + dz + pz],
      ];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < 4; i++) {
        const x = corners[i][0], z = corners[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      // Handle near free (latch) edge, mid-height
      const latchX = hx0 + dx * 0.88 + px * 0.5;
      const latchZ = hz0 + dz * 0.88 + pz * 0.5;
      return {
        minX, maxX, minY: y0, maxY: y1, minZ, maxZ,
        hx: latchX, hy: y0 + BUILD_DOOR_H * 0.52, hz: latchZ,
        hx0, hz0, dx, dz, px, pz, y0, y1,
      };
    }

    function startDoorSwing(piece, opening) {
      ensurePieceInternals(piece);
      const from = doorOpenAmt(piece);
      const to = opening ? 1 : 0;
      piece.isOpen = !!opening;
      doorAnim = doorAnim.filter((a) => a.piece !== piece && a.id !== piece.id);
      if (Math.abs(from - to) < 0.02) {
        piece._doorOpenAmt = to;
        invalidatePieceMesh(piece);
        rebuildBuildMesh();
        return;
      }
      doorAnim.push({ id: piece.id, piece, from, to, t: 0, dur: 0.28 });
      piece._doorOpenAmt = from;
    }

    function tickDoorAnims(dt) {
      if (!doorAnim.length) return;
      const touched = new Set();
      for (let i = doorAnim.length - 1; i >= 0; i--) {
        const a = doorAnim[i];
        if (!a.piece || a.piece.type !== "door") {
          doorAnim.splice(i, 1);
          continue;
        }
        a.t += dt;
        const u = Math.min(1, a.t / a.dur);
        const e = 1 - Math.pow(1 - u, 3);
        a.piece._doorOpenAmt = a.from + (a.to - a.from) * e;
        touched.add(a.piece);
        if (u >= 1) {
          a.piece._doorOpenAmt = a.to;
          doorAnim.splice(i, 1);
        }
      }
      if (!touched.size) return;
      touched.forEach((piece) => invalidatePieceMesh(piece));
      rebuildBuildMesh();
    }

    function pieceAabb(p) {
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const base = p.baseY + p.iy * BUILD_LEVEL_H;
      const yaw = ((p.yaw % 4) + 4) % 4;
      const t = BUILD_WALL_T;
      if (p.type === "foundation") {
        return { minX: x0, maxX: x1, minY: base - 0.1, maxY: base + BUILD_FOUND_H + 0.2, minZ: z0, maxZ: z1 };
      }
      if (p.type === "foundation_tri") {
        const h = BUILD_TRI_H;
        const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
        if (yaw === 0) return { minX: x0, maxX: x1, minY: base - 0.1, maxY: base + BUILD_FOUND_H + 0.2, minZ: z1, maxZ: z1 + h };
        if (yaw === 1) return { minX: x1, maxX: x1 + h, minY: base - 0.1, maxY: base + BUILD_FOUND_H + 0.2, minZ: z0, maxZ: z1 };
        if (yaw === 2) return { minX: x0, maxX: x1, minY: base - 0.1, maxY: base + BUILD_FOUND_H + 0.2, minZ: z0 - h, maxZ: z0 };
        return { minX: x0 - h, maxX: x0, minY: base - 0.1, maxY: base + BUILD_FOUND_H + 0.2, minZ: z0, maxZ: z1 };
      }
      if (isFloorType(p.type)) {
        const slabY = levelFloorSlabY(base);
        const y0 = slabY.y0, y1 = slabY.y1;
        if (p.type === "floor_tri") {
          const h = BUILD_TRI_H;
          if (yaw === 0) return { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z1, maxZ: z1 + h };
          if (yaw === 1) return { minX: x1, maxX: x1 + h, minY: y0, maxY: y1, minZ: z0, maxZ: z1 };
          if (yaw === 2) return { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0 - h, maxZ: z0 };
          return { minX: x0 - h, maxX: x0, minY: y0, maxY: y1, minZ: z0, maxZ: z1 };
        }
        return { minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1 };
      }
      // Door leaf — thin panel; openAmt lerps 0→1 around hinge
      if (p.type === "door") {
        const g = doorLeafGeom(p);
        return { minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY, minZ: g.minZ, maxZ: g.maxZ };
      }
      if (p.type === "pillar") {
        const y0 = wallSeatY(p);
        const y1 = y0 + BUILD_LEVEL_H;
        const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
        const half = 0.16;
        if (yaw === 0) return { minX: cx - half, maxX: cx + half, minY: y0, maxY: y1, minZ: z1 - half * 2, maxZ: z1 };
        if (yaw === 1) return { minX: x1 - half * 2, maxX: x1, minY: y0, maxY: y1, minZ: cz - half, maxZ: cz + half };
        if (yaw === 2) return { minX: cx - half, maxX: cx + half, minY: y0, maxY: y1, minZ: z0, maxZ: z0 + half * 2 };
        return { minX: x0, maxX: x0 + half * 2, minY: y0, maxY: y1, minZ: cz - half, maxZ: cz + half };
      }
      // Doorway / window: ray AABB = lintel only so aim passes through the hole
      if (p.type === "doorway" || p.type === "doorway_d" || p.type === "window" || p.type === "wall_frame") {
        const yWall0 = wallSeatY(p);
        const yTop = yWall0 + BUILD_LEVEL_H;
        const openW = p.type === "wall_frame" ? 2.55 : (p.type === "doorway_d" ? 2.0 : (p.type === "window" ? 1.1 : BUILD_DOOR_W));
        const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
        const o0 = mid - openW * 0.5;
        const o1 = mid + openW * 0.5;
        const lintY0 = p.type === "wall_frame" ? yWall0 + 2.74 : (p.type === "window" ? yWall0 + 2.0 : yWall0 + BUILD_DOOR_H);
        if (yaw === 0) return { minX: o0, maxX: o1, minY: lintY0, maxY: yTop, minZ: z1 - t, maxZ: z1 };
        if (yaw === 2) return { minX: o0, maxX: o1, minY: lintY0, maxY: yTop, minZ: z0, maxZ: z0 + t };
        if (yaw === 1) return { minX: x1 - t, maxX: x1, minY: lintY0, maxY: yTop, minZ: o0, maxZ: o1 };
        return { minX: x0, maxX: x0 + t, minY: lintY0, maxY: yTop, minZ: o0, maxZ: o1 };
      }
      if (isWallType(p.type)) {
        const wh = wallHeight(p.type);
        const yWall0 = wallSeatY(p);
        const y1 = yWall0 + wh;
        const slab = wallSlabForYaw(x0, z0, x1, z1, yWall0, y1, yaw, t);
        return { minX: slab.x0, maxX: slab.x1, minY: slab.y0, maxY: slab.y1, minZ: slab.z0, maxZ: slab.z1 };
      }
      if (isRoofType(p.type)) {
        const roofBase = levelWallTopY(base);
        return {
          minX: x0 - (p.type.indexOf("tri") >= 0 ? BUILD_TRI_H : 0),
          maxX: x1 + (p.type.indexOf("tri") >= 0 ? BUILD_TRI_H : 0),
          minY: roofBase - 0.2,
          maxY: roofBase + BUILD_ROOF_RISE + 0.1,
          minZ: z0 - (p.type.indexOf("tri") >= 0 ? BUILD_TRI_H : 0),
          maxZ: z1 + (p.type.indexOf("tri") >= 0 ? BUILD_TRI_H : 0),
        };
      }
      // stairs / ramp
      return { minX: x0, maxX: x1, minY: base, maxY: base + BUILD_LEVEL_H + BUILD_FOUND_H, minZ: z0, maxZ: z1 };
    }

    /** True if this solid wall sits on the same world edge as a doorway (blocks the hole). */
    function wallOverlapsDoorwayOpening(p) {
      if (!p || p.type !== "wall" && p.type !== "wall_half" && p.type !== "wall_low") return false;
      const y = ((p.yaw % 4) + 4) % 4;
      if (findDoorwayOnEdge(p.ix, p.iz, p.iy, y)) return true;
      let nix = p.ix, niz = p.iz, ny = y;
      if (y === 0) { niz = p.iz + 1; ny = 2; }
      else if (y === 2) { niz = p.iz - 1; ny = 0; }
      else if (y === 1) { nix = p.ix + 1; ny = 3; }
      else { nix = p.ix - 1; ny = 1; }
      return !!findDoorwayOnEdge(nix, niz, p.iy, ny);
    }

    /** Extra AABBs for doorway frames (solid jambs only — opening is walkable). */
    function pieceColliders(p) {
      if (p.type === "door") {
        // Always keep leaf AABB (open leaf parks beside the opening — walkable + E-ray hittable)
        return [pieceAabb(p)];
      }
      if (isSolidFurniture(p.type)) {
        const b = pieceAabb(p);
        // Shrink horizontal solid so a player can pass between nearby tables
        // (visual mesh is smaller than the old padded AABB).
        const tight = (p.type === "workbench" || p.type === "research_table") ? 0.78 : 0.88;
        const cx = (b.minX + b.maxX) * 0.5;
        const cz = (b.minZ + b.maxZ) * 0.5;
        const hx = (b.maxX - b.minX) * 0.5 * tight;
        const hz = (b.maxZ - b.minZ) * 0.5 * tight;
        return [{
          minX: cx - hx, maxX: cx + hx,
          minY: b.minY, maxY: b.maxY,
          minZ: cz - hz, maxZ: cz + hz,
        }];
      }
      if (p.type !== "doorway" && p.type !== "doorway_d" && p.type !== "window" && p.type !== "wall_frame") {
        if (isWallType(p.type)) {
          // Neighbor solid wall on a doorway edge would seal the hole — skip collider
          if (wallOverlapsDoorwayOpening(p)) return [];
          return [pieceAabb(p)];
        }
        return [];
      }
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const yaw = ((p.yaw % 4) + 4) % 4;
      const t = BUILD_WALL_T;
      const yWall0 = wallSeatY(p);
      const y1 = yWall0 + BUILD_LEVEL_H;
      // Wider than mesh hole so PLAYER_RADIUS (0.45) fits through 1.2 m doors
      const openW = p.type === "wall_frame" ? 2.58 : (p.type === "doorway_d" ? 2.15 : (p.type === "window" ? 1.1 : Math.max(BUILD_DOOR_W, 1.55)));
      const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
      const o0 = mid - openW * 0.5;
      const o1 = mid + openW * 0.5;
      const out = [];
      if (yaw === 0) {
        out.push({ minX: x0, maxX: o0, minY: yWall0, maxY: y1, minZ: z1 - t, maxZ: z1 });
        out.push({ minX: o1, maxX: x1, minY: yWall0, maxY: y1, minZ: z1 - t, maxZ: z1 });
        if (p.type === "window") {
          out.push({ minX: o0, maxX: o1, minY: yWall0, maxY: yWall0 + 0.9, minZ: z1 - t, maxZ: z1 });
          out.push({ minX: o0, maxX: o1, minY: yWall0 + 2.0, maxY: y1, minZ: z1 - t, maxZ: z1 });
        } else {
          out.push({ minX: o0, maxX: o1, minY: yWall0 + (p.type === "wall_frame" ? 2.74 : BUILD_DOOR_H), maxY: y1, minZ: z1 - t, maxZ: z1 });
        }
      } else if (yaw === 2) {
        out.push({ minX: x0, maxX: o0, minY: yWall0, maxY: y1, minZ: z0, maxZ: z0 + t });
        out.push({ minX: o1, maxX: x1, minY: yWall0, maxY: y1, minZ: z0, maxZ: z0 + t });
        if (p.type === "window") {
          out.push({ minX: o0, maxX: o1, minY: yWall0, maxY: yWall0 + 0.9, minZ: z0, maxZ: z0 + t });
          out.push({ minX: o0, maxX: o1, minY: yWall0 + 2.0, maxY: y1, minZ: z0, maxZ: z0 + t });
        } else {
          out.push({ minX: o0, maxX: o1, minY: yWall0 + (p.type === "wall_frame" ? 2.74 : BUILD_DOOR_H), maxY: y1, minZ: z0, maxZ: z0 + t });
        }
      } else if (yaw === 1) {
        out.push({ minX: x1 - t, maxX: x1, minY: yWall0, maxY: y1, minZ: z0, maxZ: o0 });
        out.push({ minX: x1 - t, maxX: x1, minY: yWall0, maxY: y1, minZ: o1, maxZ: z1 });
        if (p.type === "window") {
          out.push({ minX: x1 - t, maxX: x1, minY: yWall0, maxY: yWall0 + 0.9, minZ: o0, maxZ: o1 });
          out.push({ minX: x1 - t, maxX: x1, minY: yWall0 + 2.0, maxY: y1, minZ: o0, maxZ: o1 });
        } else {
          out.push({ minX: x1 - t, maxX: x1, minY: yWall0 + (p.type === "wall_frame" ? 2.74 : BUILD_DOOR_H), maxY: y1, minZ: o0, maxZ: o1 });
        }
      } else {
        out.push({ minX: x0, maxX: x0 + t, minY: yWall0, maxY: y1, minZ: z0, maxZ: o0 });
        out.push({ minX: x0, maxX: x0 + t, minY: yWall0, maxY: y1, minZ: o1, maxZ: z1 });
        if (p.type === "window") {
          out.push({ minX: x0, maxX: x0 + t, minY: yWall0, maxY: yWall0 + 0.9, minZ: o0, maxZ: o1 });
          out.push({ minX: x0, maxX: x0 + t, minY: yWall0 + 2.0, maxY: y1, minZ: o0, maxZ: o1 });
        } else {
          out.push({ minX: x0, maxX: x0 + t, minY: yWall0 + (p.type === "wall_frame" ? 2.74 : BUILD_DOOR_H), maxY: y1, minZ: o0, maxZ: o1 });
        }
      }
      return out;
    }

    function stampBuildCellRect(ix, iz, pad) {
      const half = ISLAND_HALF;
      const padV = pad != null ? pad : 0.15;
      const x0 = ix * BUILD_CELL - padV;
      const x1 = (ix + 1) * BUILD_CELL + padV;
      const z0 = iz * BUILD_CELL - padV;
      const z1 = (iz + 1) * BUILD_CELL + padV;
      const i0 = Math.max(0, Math.floor((x0 + half) / ROCK_OCC_CELL));
      const i1 = Math.min(ROCK_OCC_N - 1, Math.floor((x1 + half) / ROCK_OCC_CELL));
      const j0 = Math.max(0, Math.floor((z0 + half) / ROCK_OCC_CELL));
      const j1 = Math.min(ROCK_OCC_N - 1, Math.floor((z1 + half) / ROCK_OCC_CELL));
      for (let jz = j0; jz <= j1; jz++) {
        for (let ix2 = i0; ix2 <= i1; ix2++) {
          rockOccCpu[jz * ROCK_OCC_N + ix2] = 1.0;
        }
      }
    }

    /** Clear grass under an oriented furniture footprint (sleeping bag shape). */
    function stampOrientedFootprint(cx, cz, hx, hz, pad) {
      const half = ISLAND_HALF;
      const p = pad != null ? pad : 0.08;
      const x0 = cx - hx - p;
      const x1 = cx + hx + p;
      const z0 = cz - hz - p;
      const z1 = cz + hz + p;
      const i0 = Math.max(0, Math.floor((x0 + half) / ROCK_OCC_CELL));
      const i1 = Math.min(ROCK_OCC_N - 1, Math.floor((x1 + half) / ROCK_OCC_CELL));
      const j0 = Math.max(0, Math.floor((z0 + half) / ROCK_OCC_CELL));
      const j1 = Math.min(ROCK_OCC_N - 1, Math.floor((z1 + half) / ROCK_OCC_CELL));
      const invHx = 1 / Math.max(hx + p, 0.05);
      const invHz = 1 / Math.max(hz + p, 0.05);
      for (let jz = j0; jz <= j1; jz++) {
        for (let ix2 = i0; ix2 <= i1; ix2++) {
          const wx = -half + (ix2 + 0.5) * ROCK_OCC_CELL;
          const wz = -half + (jz + 0.5) * ROCK_OCC_CELL;
          const dx = (wx - cx) * invHx;
          const dz = (wz - cz) * invHz;
          // Soft capsule: ellipse footprint matches bag silhouette
          if (dx * dx + dz * dz <= 1.05) {
            rockOccCpu[jz * ROCK_OCC_N + ix2] = 1.0;
          }
        }
      }
    }

    function restampBuildGrassClear() {
      rockOccCpu.set(rockOccBase);
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        const terrainY = chunk
          ? sampleHeight(chunk, (p.ix + 0.5) * BUILD_CELL, (p.iz + 0.5) * BUILD_CELL)
          : 0;
        if (isFoundationType(p.type) || isRampType(p.type)) {
          stampBuildCellRect(p.ix, p.iz, 0.4);
          const cx = (p.ix + 0.5) * BUILD_CELL;
          const cz = (p.iz + 0.5) * BUILD_CELL;
          stampRockOcc(cx, cz, BUILD_CELL * 0.85);
          continue;
        }
        if (isFloorType(p.type)) {
          const top = pieceAabb(p).maxY;
          if (top <= terrainY + 1.2) stampBuildCellRect(p.ix, p.iz, 0.3);
          continue;
        }
        if (isWallType(p.type) && p.iy === 0) stampBuildCellRect(p.ix, p.iz, 0.15);
        if (p.type === "sleeping_bag") {
          const cx = (p.ix + 0.5) * BUILD_CELL + (p._ox || 0);
          const cz = (p.iz + 0.5) * BUILD_CELL + (p._oz || 0);
          const he = furnitureHalfExtents("sleeping_bag", p.yaw);
          stampOrientedFootprint(cx, cz, he.hx, he.hz, 0.12);
        }
        if (p.type === "campfire") {
          const cx = (p.ix + 0.5) * BUILD_CELL + (p._ox || 0);
          const cz = (p.iz + 0.5) * BUILD_CELL + (p._oz || 0);
          stampOrientedFootprint(cx, cz, 0.45, 0.45, 0.1);
        }
      }
      device.queue.writeBuffer(rockOccBuf, 0, rockOccCpu);
      if (grassReady) gpuInitBlades(false);
    }

    function pieceMeshSignature(p) {
      let join = 0;
      if (isFoundationType(p.type) || isFloorType(p.type)) join = deckNeighborMask(p.ix, p.iz, p.iy);
      else if (isWallType(p.type)) {
        join = wallEndJoinMask(p.ix, p.iz, p.iy, p.yaw)
          | (findDeck(p.ix, p.iz, p.iy) ? 16 : 0);
      }
      return (p.type || "") + "|" + (p.tier | 0) + "|" + Math.round(p.hp || 0) + "|"
        + Math.round(p.stability || 0) + "|" + (((p.yaw % 4) + 4) % 4)
        + "|" + (p.softInward ? 1 : 0) + "|j" + join
        + "|o" + Math.round((p._ox || 0) * 50) + "," + Math.round((p._oz || 0) * 50)
        + (p.type === "door" ? ("|op" + (p.isOpen ? 1 : 0) + "|lk" + (p.locked ? 1 : 0)
          + "|da" + Math.round((p._doorOpenAmt != null ? p._doorOpenAmt : (p.isOpen ? 1 : 0)) * 20)
          + "|swing3") : "")
        + (p.type === "campfire" ? ("|lit" + (p.lit ? 1 : 0)) : "")
        + (p.type === "workbench" ? ("|wbt" + (p.wbTier | 0) + "|s13") : "")
        + "|ceil1|tc4|door5|chest3|bag3|wb5|twig3|fire2|softface2|wardrobe2|found4|tiers5|foundTier8|furnCol1|polish1|woodFound1|stoneMetal2|metalFound3";
    }

    function getCachedPieceMesh(p) {
      if (typeof ensurePieceInternals === "function") ensurePieceInternals(p);
      else if (p.id == null) p.id = (p.ix + 1) * 100000 + (p.iy + 1) * 1000 + (p.iz + 1);
      const sig = pieceMeshSignature(p);
      let entry = pieceMeshCache.get(p.id);
      if (entry && entry.sig === sig) return entry.data;
      const tmp = [];
      buildPieceMesh(p, tmp, null);
      const data = new Float32Array(tmp);
      pieceMeshCache.set(p.id, { sig, data });
      return data;
    }

    function rebuildBuildMesh() {
      rebuildCellIndex();
      // Drop caches for removed pieces
      if (pieceMeshCache.size > buildPieces.length + 8) {
        const live = new Set();
        for (let i = 0; i < buildPieces.length; i++) live.add(buildPieces[i].id);
        for (const id of pieceMeshCache.keys()) {
          if (!live.has(id)) pieceMeshCache.delete(id);
        }
      }
      let totalFloats = 0;
      const parts = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const data = getCachedPieceMesh(buildPieces[i]);
        parts.push(data);
        totalFloats += data.length;
      }
      buildVertCount = (totalFloats / 11) | 0;
      if (buildVbo) try { buildVbo.destroy(); } catch (_) {}
      if (buildVertCount > 0) {
        const merged = new Float32Array(totalFloats);
        let off = 0;
        for (let i = 0; i < parts.length; i++) {
          merged.set(parts[i], off);
          off += parts[i].length;
        }
        buildVbo = device.createBuffer({
          size: merged.byteLength,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true,
        });
        new Float32Array(buildVbo.getMappedRange()).set(merged);
        buildVbo.unmap();
      } else {
        buildVbo = null;
      }
      buildColliders = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (isFoundationType(p.type)) {
          // Solid body under the walkable deck — blocks walking through stilts/skirt
          const b = pieceAabb(p);
          const deckTop = (p.baseY + p.iy * BUILD_LEVEL_H) + BUILD_FOUND_H;
          buildColliders.push({
            minX: b.minX, maxX: b.maxX,
            minY: b.minY, maxY: deckTop - 0.06,
            minZ: b.minZ, maxZ: b.maxZ,
          });
          continue;
        }
        if (!isWallType(p.type) && !isSolidFurniture(p.type) && p.type !== "door") continue;
        const cols = pieceColliders(p);
        for (let c = 0; c < cols.length; c++) buildColliders.push(cols[c]);
      }
      restampBuildGrassClear();
    }

    function uploadGhostMesh(piece, ok) {
      const arr = [];
      if (piece) {
        buildPieceMesh(piece, arr, ok ? [1, 1, 1] : [0, 0, 0]);
        // Ghost shader uses col.x as ok flag. Furniture meshes author real
        // material RGB (oak/iron) which falsely read as "invalid" → red hologram.
        const flag = ok ? 1 : 0;
        for (let i = 6; i < arr.length; i += 11) {
          arr[i] = flag;
          arr[i + 1] = flag;
          arr[i + 2] = flag;
        }
      }
      ghostVertCount = (arr.length / 11) | 0;
      if (ghostVbo) try { ghostVbo.destroy(); } catch (_) {}
      if (ghostVertCount > 0) {
        ghostVbo = device.createBuffer({
          size: arr.length * 4,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true,
        });
        new Float32Array(ghostVbo.getMappedRange()).set(arr);
        ghostVbo.unmap();
      } else {
        ghostVbo = null;
      }
    }

    function aabbCircleHit(px, pz, pr, b) {
      const cx = Math.max(b.minX, Math.min(px, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pz, b.maxZ));
      const dx = px - cx, dz = pz - cz;
      return dx * dx + dz * dz < pr * pr;
    }

    function playerOverlapsY(b) {
      const y0 = player.feetY + 0.12;
      const y1 = player.feetY + 1.65;
      return y1 > b.minY && y0 < b.maxY;
    }

    function rayAabb(o, d, b) {
      let tmin = 0, tmax = 48;
      for (let axis = 0; axis < 3; axis++) {
        const minV = axis === 0 ? b.minX : (axis === 1 ? b.minY : b.minZ);
        const maxV = axis === 0 ? b.maxX : (axis === 1 ? b.maxY : b.maxZ);
        const orig = o[axis];
        const dir = d[axis];
        if (Math.abs(dir) < 1e-8) {
          if (orig < minV || orig > maxV) return null;
          continue;
        }
        let t0 = (minV - orig) / dir;
        let t1 = (maxV - orig) / dir;
        if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
        tmin = Math.max(tmin, t0);
        tmax = Math.min(tmax, t1);
        if (tmin > tmax) return null;
      }
      return tmin;
    }

    function camBuildRay() {
      if (!lastEye || !lastTarget) return null;
      const o = lastEye;
      let dx = lastTarget[0] - o[0];
      let dy = lastTarget[1] - o[1];
      let dz = lastTarget[2] - o[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      return { o, d: [dx / len, dy / len, dz / len] };
    }

    function rayHitTerrain(o, d) {
      if (!chunk) return null;
      let bestT = null;
      let prevY = null;
      let prevAbove = null;
      for (let step = 0; step <= 80; step++) {
        const t = step * 0.55;
        const x = o[0] + d[0] * t;
        const y = o[1] + d[1] * t;
        const z = o[2] + d[2] * t;
        const gy = sampleHeight(chunk, x, z);
        const above = y >= gy;
        if (prevAbove === true && above === false && prevY != null) {
          let lo = t - 0.55, hi = t;
          for (let k = 0; k < 8; k++) {
            const mid = (lo + hi) * 0.5;
            const my = o[1] + d[1] * mid;
            const mgy = sampleHeight(chunk, o[0] + d[0] * mid, o[2] + d[2] * mid);
            if (my >= mgy) lo = mid; else hi = mid;
          }
          bestT = hi;
          break;
        }
        prevAbove = above;
        prevY = y;
        if (t > 42) break;
      }
      if (bestT == null) return null;
      return {
        t: bestT,
        x: o[0] + d[0] * bestT,
        y: o[1] + d[1] * bestT,
        z: o[2] + d[2] * bestT,
        kind: "terrain",
      };
    }

    function rayHitBuilds(o, d) {
      let best = null;
      for (let i = 0; i < buildPieces.length; i++) {
        const b = pieceAabb(buildPieces[i]);
        const t = rayAabb(o, d, b);
        if (t == null) continue;
        if (!best || t < best.t) best = { t, index: i, piece: buildPieces[i] };
      }
      return best;
    }

    function occupancyBlocked(cell) {
      const key = pieceKey(cell);
      const list = piecesInCell(cell.ix, cell.iy, cell.iz);
      // Index may be stale mid-edit — fall back to scan
      const pool = list.length ? list : buildPieces;
      for (let i = 0; i < pool.length; i++) {
        if (pieceKey(pool[i]) === key) return true;
      }
      return false;
    }

    function findDeck(ix, iz, iy) {
      const list = piecesInCell(ix, iy, iz);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.type === "toolcupboard" || p.type === "workbench" || p.type === "research_table"
          || p.type === "scrap_barrel" || p.type === "world_ore" || p.type === "world_tree"
          || p.type === "campfire" || p.type === "sleeping_bag"
          || p.type === "box_small" || p.type === "box_large") continue;
        if (isDeckType(p.type) || isFloorType(p.type)) return p;
      }
      // Fallback if index empty (first place / before rebuild)
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.ix !== ix || p.iz !== iz || p.iy !== iy) continue;
        if (p.type === "toolcupboard" || p.type === "workbench" || p.type === "research_table"
          || p.type === "scrap_barrel" || p.type === "world_ore" || p.type === "world_tree"
          || p.type === "campfire" || p.type === "sleeping_bag"
          || p.type === "box_small" || p.type === "box_large") continue;
        if (isDeckType(p.type) || isFloorType(p.type)) return p;
      }
      return null;
    }

    function wallsInCell(ix, iz, iy) {
      let n = 0;
      const list = piecesInCell(ix, iy, iz);
      const pool = list.length ? list : buildPieces;
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i];
        if (list.length && (p.ix !== ix || p.iy !== iy || p.iz !== iz)) continue;
        if (isWallType(p.type) && p.type !== "roof_wall" && p.ix === ix && p.iz === iz && p.iy === iy) n++;
      }
      return n;
    }

    function adjacentEdgeWalls(ix, iz, iy) {
      let n = 0;
      const neigh = [
        [ix, iz - 1, 0],
        [ix, iz + 1, 2],
        [ix - 1, iz, 1],
        [ix + 1, iz, 3],
      ];
      for (let nIdx = 0; nIdx < 4; nIdx++) {
        const nx = neigh[nIdx][0], nz = neigh[nIdx][1], needYaw = neigh[nIdx][2];
        const list = piecesInCell(nx, iy, nz);
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (isWallType(p.type) && p.type !== "roof_wall" && p.yaw === needYaw) n++;
        }
      }
      return n;
    }

    function wallAlreadyOnEdge(ix, iz, iy, yaw) {
      const y = ((yaw % 4) + 4) % 4;
      const list = piecesInCell(ix, iy, iz);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        // Door leaf shares the doorway edge — does not block walls/frames
        if (p.type === "door") continue;
        if (isWallType(p.type) && ((p.yaw % 4) + 4) % 4 === y) return true;
      }
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type === "door") continue;
        if (isWallType(p.type) && p.ix === ix && p.iz === iz && p.iy === iy
          && ((p.yaw % 4) + 4) % 4 === y) return true;
      }
      // Shared world-edge with neighbor cell (opposite yaw) — same physical wall plane
      let nix = ix, niz = iz, ny = y;
      if (y === 0) { niz = iz + 1; ny = 2; }
      else if (y === 2) { niz = iz - 1; ny = 0; }
      else if (y === 1) { nix = ix + 1; ny = 3; }
      else { nix = ix - 1; ny = 1; }
      const nlist = piecesInCell(nix, iy, niz);
      for (let i = 0; i < nlist.length; i++) {
        const p = nlist[i];
        if (p.type === "door") continue;
        if (isWallType(p.type) && ((p.yaw % 4) + 4) % 4 === ny) return true;
      }
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type === "door") continue;
        if (isWallType(p.type) && p.ix === nix && p.iz === niz && p.iy === iy
          && ((p.yaw % 4) + 4) % 4 === ny) return true;
      }
      return false;
    }

    /** Frame (marco) on this cell edge — doors sit inside these. */
    function findDoorwayOnEdge(ix, iz, iy, yaw) {
      const y = ((yaw % 4) + 4) % 4;
      const list = piecesInCell(ix, iy, iz);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if ((p.type === "doorway" || p.type === "doorway_d")
          && ((p.yaw % 4) + 4) % 4 === y) return p;
      }
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.ix !== ix || p.iz !== iz || p.iy !== iy) continue;
        if ((p.type === "doorway" || p.type === "doorway_d")
          && ((p.yaw % 4) + 4) % 4 === y) return p;
      }
      return null;
    }

    function findAnyDoorwayInCell(ix, iz, iy) {
      const list = piecesInCell(ix, iy, iz);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.type === "doorway" || p.type === "doorway_d") return p;
      }
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.ix === ix && p.iz === iz && p.iy === iy
          && (p.type === "doorway" || p.type === "doorway_d")) return p;
      }
      return null;
    }

    function doorAlreadyOnEdge(ix, iz, iy, yaw) {
      const y = ((yaw % 4) + 4) % 4;
      const list = piecesInCell(ix, iy, iz);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.type === "door" && ((p.yaw % 4) + 4) % 4 === y) return true;
      }
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type === "door" && p.ix === ix && p.iz === iz && p.iy === iy
          && ((p.yaw % 4) + 4) % 4 === y) return true;
      }
      return false;
    }

    /** Validate door leaf: must fit an empty doorway frame on the same edge. */
    function validateDoorIntoFrame(cell) {
      const ix = cell.ix, iz = cell.iz, iy = cell.iy;
      let yaw = ((cell.yaw % 4) + 4) % 4;
      let frame = findDoorwayOnEdge(ix, iz, iy, yaw);
      if (!frame) {
        frame = findAnyDoorwayInCell(ix, iz, iy);
        if (frame) yaw = ((frame.yaw % 4) + 4) % 4;
      }
      if (!frame) return { ok: false, reason: "necesita marco" };
      if (doorAlreadyOnEdge(frame.ix, frame.iz, frame.iy, yaw)) {
        return { ok: false, reason: "puerta ya existe" };
      }
      cell.ix = frame.ix;
      cell.iz = frame.iz;
      cell.iy = frame.iy;
      cell.yaw = yaw;
      cell.baseY = frame.baseY;
      return { ok: true, reason: "" };
    }

    function circleHitsCell(bx, bz, br, ix, iz, pad) {
      const x0 = ix * BUILD_CELL - pad;
      const x1 = (ix + 1) * BUILD_CELL + pad;
      const z0 = iz * BUILD_CELL - pad;
      const z1 = (iz + 1) * BUILD_CELL + pad;
      const cx = Math.max(x0, Math.min(bx, x1));
      const cz = Math.max(z0, Math.min(bz, z1));
      const dx = bx - cx, dz = bz - cz;
      return dx * dx + dz * dz < br * br;
    }

    function groundBlockedReason(ix, iz) {
      const cx = (ix + 0.5) * BUILD_CELL;
      const cz = (iz + 0.5) * BUILD_CELL;
      if (!chunk) return "sin terreno";
      if (islandEdge(cx, cz) > 0.1) return "cerca del mar";
      const h = sampleHeight(chunk, cx, cz);
      if (h < SEA_Y + 0.08) return "en el agua";
      const step = 0.45;
      const hx0 = sampleHeight(chunk, cx - step, cz);
      const hx1 = sampleHeight(chunk, cx + step, cz);
      const hz0 = sampleHeight(chunk, cx, cz - step);
      const hz1 = sampleHeight(chunk, cx, cz + step);
      const slope = Math.hypot(hx1 - hx0, hz1 - hz0) / (step * 2);
      if (slope > 0.58) return "terreno inclinado";
      for (let i = 0; i < buildBlockers.length; i++) {
        const b = buildBlockers[i];
        // Trees/rocks: only the solid volume (trunk / boulder), not canopy clear radius
        const pad = b.kind === "tree" ? 0 : 0.04;
        if (circleHitsCell(b.x, b.z, b.r, ix, iz, pad)) {
          return b.kind === "tree" ? "hay un árbol" : "hay una roca";
        }
      }
      return null;
    }

    function validateBuild(cell) {
      const type = cell.type;
      const ix = cell.ix, iz = cell.iz, iy = cell.iy;
      if (occupancyBlocked(cell)) return { ok: false, reason: "ocupado" };

      if (isFoundationType(type) && iy <= 0) {
        const blocked = groundBlockedReason(ix, iz);
        if (blocked) return { ok: false, reason: blocked };
      }
      if (isFoundationType(type)) {
        if (iy <= 0) return { ok: true, reason: "" };
        if (!findDeck(ix, iz, iy - 1)) return { ok: false, reason: "sin soporte abajo" };
        return { ok: true, reason: "" };
      }

      if (type === "door") {
        if (occupancyBlocked(cell)) return { ok: false, reason: "ocupado" };
        return validateDoorIntoFrame(cell);
      }

      if (isWallType(type) && type !== "roof_wall") {
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (!deck) return { ok: false, reason: "necesita cimiento o piso" };
        cell.baseY = deck.baseY;
        return { ok: true, reason: "" };
      }

      if (type === "roof_wall") {
        // Needs walls or floor at this level
        const deck = findDeck(ix, iz, iy) || findDeck(ix, iz, iy);
        const hasWall = wallsInCell(ix, iz, iy) > 0;
        if (!deck && !hasWall) return { ok: false, reason: "necesita estructura" };
        if (deck) cell.baseY = deck.baseY;
        return { ok: true, reason: "" };
      }

      if (isFloorType(type)) {
        const localW = wallsInCell(ix, iz, iy);
        const edgeW = adjacentEdgeWalls(ix, iz, iy);
        const support = localW + edgeW;
        if (support < 1) return { ok: false, reason: "necesita pared" };
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
        } else {
          let got = false;
          for (let i = 0; i < buildPieces.length; i++) {
            const p = buildPieces[i];
            if (isWallType(p.type) && p.iy === iy && p.ix === ix && p.iz === iz) {
              cell.baseY = p.baseY;
              got = true;
              break;
            }
          }
          if (!got) return { ok: false, reason: "sin soporte" };
        }
        if (support < 2) return { ok: true, reason: "poco soporte" };
        return { ok: true, reason: "" };
      }

      if (isRampType(type)) {
        const deck = findDeck(ix, iz, iy);
        if (!deck) return { ok: false, reason: "necesita cimiento" };
        cell.baseY = deck.baseY;
        return { ok: true, reason: "" };
      }

      if (isRoofType(type)) {
        const localW = wallsInCell(ix, iz, iy);
        const edgeW = adjacentEdgeWalls(ix, iz, iy);
        const floor = findDeck(ix, iz, iy);
        if (localW + edgeW < 1 && !floor) return { ok: false, reason: "necesita pared" };
        if (floor) cell.baseY = floor.baseY;
        else {
          for (let i = 0; i < buildPieces.length; i++) {
            const p = buildPieces[i];
            if (isWallType(p.type) && p.iy === iy && p.ix === ix && p.iz === iz) {
              cell.baseY = p.baseY;
              break;
            }
          }
        }
        return { ok: true, reason: "" };
      }

      return { ok: true, reason: "" };
    }

    function pieceHasDependents(piece) {
      const ix = piece.ix, iz = piece.iz, iy = piece.iy;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p === piece) continue;
        if (isFoundationType(piece.type) || isFloorType(piece.type) || isRampType(piece.type)) {
          if (p.ix === ix && p.iz === iz && p.iy === iy && isWallType(p.type)) return true;
          if (p.ix === ix && p.iz === iz && p.iy === iy && isRampType(p.type) && isFoundationType(piece.type)) return true;
          if (p.ix === ix && p.iz === iz && p.iy === iy && isFloorType(p.type)) return true;
          if (p.ix === ix && p.iz === iz && p.iy === iy && isRoofType(p.type)) return true;
          if (p.ix === ix && p.iz === iz && p.iy === iy + 1 && isFoundationType(p.type)) return true;
        }
        if (isWallType(piece.type)) {
          if (isFloorType(p.type) && p.ix === ix && p.iz === iz && p.iy === iy) {
            const others = wallsInCell(ix, iz, iy) - 1 + adjacentEdgeWalls(ix, iz, iy);
            if (others < 1) return true;
          }
          if (isRoofType(p.type) && p.ix === ix && p.iz === iz && p.iy === iy) {
            const others = wallsInCell(ix, iz, iy) - 1 + adjacentEdgeWalls(ix, iz, iy);
            if (others < 1) return true;
          }
        }
      }
      return false;
    }

    function pieceSurfaceY(p, px, pz) {
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const base = p.baseY + p.iy * BUILD_LEVEL_H;
      const yaw = ((p.yaw % 4) + 4) % 4;
      if (isFoundationType(p.type)) return base + BUILD_FOUND_H;
      if (p.type === "floor_frame") {
        const frame = 0.34;
        const insideHole = px > x0 + frame && px < x1 - frame
          && pz > z0 + frame && pz < z1 - frame;
        return insideHole ? -Infinity : levelWallTopY(base);
      }
      if (isFloorType(p.type)) return levelWallTopY(base);
      if (p.type === "stairs_u") {
        const y0 = base + BUILD_FOUND_H * 0.15;
        const hx = (x0 + x1) * 0.5;
        const hz = (z0 + z1) * 0.5;
        let t;
        if (yaw === 0) t = px < hx ? (pz - z0) / cell * 0.5 : 0.5 + (z1 - pz) / cell * 0.5;
        else if (yaw === 2) t = px < hx ? (z1 - pz) / cell * 0.5 : 0.5 + (pz - z0) / cell * 0.5;
        else if (yaw === 1) t = pz < hz ? (px - x0) / cell * 0.5 : 0.5 + (x1 - px) / cell * 0.5;
        else t = pz < hz ? (x1 - px) / cell * 0.5 : 0.5 + (px - x0) / cell * 0.5;
        return y0 + Math.max(0, Math.min(1, t)) * BUILD_LEVEL_H;
      }
      if (p.type === "stairs" || p.type === "stairs_l" || p.type === "stairs_u"
        || p.type === "floor_steps" || p.type === "ramp") {
        const y0 = base + BUILD_FOUND_H * 0.15;
        let t = 0;
        if (yaw === 0) t = (pz - z0) / cell;
        else if (yaw === 1) t = (px - x0) / cell;
        else if (yaw === 2) t = (z1 - pz) / cell;
        else t = (x1 - px) / cell;
        t = Math.max(0, Math.min(1, t));
        const rise = p.type === "floor_steps" ? BUILD_FOUND_H * 0.8 : BUILD_LEVEL_H;
        return y0 + rise * t;
      }
      return pieceAabb(p).maxY;
    }

    function buildSupportY(px, pz, fallbackY) {
      let best = fallbackY;
      const pr = PLAYER_RADIUS * 0.85;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (isWallType(p.type) || isRoofType(p.type)) continue;
        // Tables / TC / boxes / fire are solids — do not stand on their AABB tops
        if (isSolidFurniture(p.type)) continue;
        const b = pieceAabb(p);
        if (px + pr < b.minX || px - pr > b.maxX || pz + pr < b.minZ || pz - pr > b.maxZ) continue;
        const top = pieceSurfaceY(p, px, pz);
        if (top >= best - 0.05 && top <= (player.feetY != null ? player.feetY : best) + 1.6) {
          if (top > best) best = top;
        }
      }
      return best;
    }

    function makeGhostFromRay() {
      const ray = camBuildRay();
      if (!ray || !chunk) {
        ghostCell = null;
        ghostOk = false;
        ghostReason = "";
        uploadGhostMesh(null, false);
        return;
      }
      const hitT = rayHitTerrain(ray.o, ray.d);
      const hitB = rayHitBuilds(ray.o, ray.d);
      let hx, hy, hz, supportY;
      let ix, iz, iy;
      const type = deployMode === "metal_door"
        ? "door"
        : (deployMode === "workbench"
          ? "workbench"
          : (deployMode === "research_table"
            ? "research_table"
            : (deployMode === "box_small" || deployMode === "box_large"
              || deployMode === "campfire" || deployMode === "sleeping_bag"
              || deployMode === "toolcupboard"
              ? deployMode
              : (deployMode || BUILD_TYPES[buildTypeIdx]))));
      // Furniture (TC, WB, …): place on floor/ground under aim — never snap into a wall cell
      let furnOx = 0, furnOz = 0;
      if (isFurnitureDeploy(type)) {
        let placed = false;
        let aimX = null, aimZ = null;
        if (hitB && (!hitT || hitB.t <= hitT.t + 0.02)) {
          const p = hitB.piece;
          const tHit = hitB.t;
          aimX = ray.o[0] + ray.d[0] * tHit;
          aimZ = ray.o[2] + ray.d[2] * tHit;
          if (isFoundationType(p.type) || isFloorType(p.type) || isRampType(p.type)) {
            ix = p.ix; iz = p.iz; iy = p.iy;
            supportY = p.baseY;
            placed = true;
          } else if (isWallType(p.type) || p.type === "door" || isRoofType(p.type)) {
            // Step back along the ray so the cell is the floor in front of the wall
            const back = 0.25;
            const tBack = Math.max(0.08, tHit - back);
            hx = ray.o[0] + ray.d[0] * tBack;
            hz = ray.o[2] + ray.d[2] * tBack;
            aimX = hx; aimZ = hz;
            ix = Math.floor(hx / BUILD_CELL);
            iz = Math.floor(hz / BUILD_CELL);
            iy = p.iy;
            const deck = findDeck(ix, iz, iy) || findDeck(p.ix, p.iz, p.iy);
            if (deck) {
              ix = deck.ix; iz = deck.iz; iy = deck.iy;
              supportY = deck.baseY;
              placed = true;
            }
          } else if (isFurnitureDeploy(p.type)) {
            // Same floor/cell as aimed furniture, but aim at hit point (not stacked on it)
            ix = p.ix; iz = p.iz; iy = p.iy;
            aimX = ray.o[0] + ray.d[0] * tHit;
            aimZ = ray.o[2] + ray.d[2] * tHit;
            const deck = findDeck(ix, iz, iy);
            if (deck) {
              supportY = deck.baseY;
              placed = true;
            } else if (iy === 0 && chunk) {
              supportY = sampleHeight(chunk, aimX, aimZ);
              placed = true;
            }
          }
        }
        if (!placed && hitT) {
          hx = hitT.x; hy = hitT.y; hz = hitT.z;
          aimX = hx; aimZ = hz;
          ix = Math.floor(hx / BUILD_CELL);
          iz = Math.floor(hz / BUILD_CELL);
          iy = 0;
          const deck = findDeck(ix, iz, 0);
          supportY = deck
            ? deck.baseY
            : sampleHeight(chunk, (ix + 0.5) * BUILD_CELL, (iz + 0.5) * BUILD_CELL);
          placed = true;
        }
        if (!placed) {
          ghostCell = null;
          ghostOk = false;
          ghostReason = "apunta a piso/suelo";
          uploadGhostMesh(null, false);
          return;
        }
        {
          const deck0 = findDeck(ix, iz, iy);
          if (deck0) supportY = deck0.baseY;
          else if (iy === 0) {
            const sx = aimX != null ? aimX : (ix + 0.5) * BUILD_CELL;
            const sz = aimZ != null ? aimZ : (iz + 0.5) * BUILD_CELL;
            // Sleeping bag follows terrain under aim (not cell center)
            supportY = sampleHeight(chunk, sx, sz);
          }
        }
        {
          const cx0 = (ix + 0.5) * BUILD_CELL;
          const cz0 = (iz + 0.5) * BUILD_CELL;
          const he = furnitureHalfExtents(type, buildYaw);
          const rawOx = aimX != null ? aimX - cx0 : 0;
          const rawOz = aimZ != null ? aimZ - cz0 : 0;
          // Bags: freer clamp outdoors (no wall magnet when no deck walls)
          if (type === "sleeping_bag" && !findDeck(ix, iz, iy)) {
            const half = BUILD_CELL * 0.5;
            furnOx = Math.max(-half + he.hx + 0.02, Math.min(half - he.hx - 0.02, rawOx));
            furnOz = Math.max(-half + he.hz + 0.02, Math.min(half - he.hz - 0.02, rawOz));
          } else {
            const clamped = clampFurnitureOffset(ix, iz, iy, rawOx, rawOz, he.hx, he.hz);
            furnOx = clamped.ox;
            furnOz = clamped.oz;
          }
        }
      } else if (hitB && (!hitT || hitB.t < hitT.t)) {
        const p = hitB.piece;
        const hitX = ray.o[0] + ray.d[0] * hitB.t;
        const hitY = ray.o[1] + ray.d[1] * hitB.t;
        const hitZ = ray.o[2] + ray.d[2] * hitB.t;
        hx = (p.ix + 0.5) * BUILD_CELL;
        hz = (p.iz + 0.5) * BUILD_CELL;
        hy = p.baseY + p.iy * BUILD_LEVEL_H + BUILD_LEVEL_H * 0.5;
        supportY = p.baseY;
        ix = p.ix; iz = p.iz; iy = p.iy;
        if (isFoundationType(type) && isFoundationType(p.type)) {
          // Side attach from hit point (not stack on same cell — that felt like "ocupado")
          const pcx = (p.ix + 0.5) * BUILD_CELL;
          const pcz = (p.iz + 0.5) * BUILD_CELL;
          const dx = hitX - pcx;
          const dz = hitZ - pcz;
          if (Math.abs(dx) >= Math.abs(dz)) {
            ix = p.ix + (dx >= 0 ? 1 : -1);
            iz = p.iz;
          } else {
            ix = p.ix;
            iz = p.iz + (dz >= 0 ? 1 : -1);
          }
          iy = p.iy;
          hx = hitX; hy = hitY; hz = hitZ;
        } else if (isFoundationType(type)) {
          iy = p.iy + 1;
        } else if (isWallType(type) || isRampType(type)) iy = p.iy;
        else if (isFloorType(type) || isRoofType(type)) iy = p.iy;
        {
          const deck0 = findDeck(ix, iz, iy > 0 ? iy : 0);
          if (deck0) supportY = deck0.baseY;
          else if (iy === 0) supportY = sampleHeight(chunk, (ix + 0.5) * BUILD_CELL, (iz + 0.5) * BUILD_CELL);
          else {
            const below = findDeck(ix, iz, iy - 1);
            supportY = below ? below.baseY : sampleHeight(chunk, (ix + 0.5) * BUILD_CELL, (iz + 0.5) * BUILD_CELL);
          }
        }
        if ((isFloorType(type) || isRoofType(type)) && hitB && isWallType(hitB.piece.type)) {
          iy = hitB.piece.iy;
          supportY = hitB.piece.baseY;
        }
        if ((isFloorType(type) || isRoofType(type)) && hitB && (isFoundationType(hitB.piece.type) || isFloorType(hitB.piece.type))) {
          // Ceiling above an existing floor → next level; ceiling on foundation → same iy
          if (isFloorType(hitB.piece.type) && isFloorType(type)) {
            iy = hitB.piece.iy + 1;
            supportY = hitB.piece.baseY;
          } else {
            iy = hitB.piece.iy;
            supportY = hitB.piece.baseY;
          }
        }
        if (isWallType(type) && hitB && isFoundationType(hitB.piece.type)) {
          iy = hitB.piece.iy;
          supportY = hitB.piece.baseY;
        }
      } else if (hitT) {
        hx = hitT.x; hy = hitT.y; hz = hitT.z;
        ix = Math.floor(hx / BUILD_CELL);
        iz = Math.floor(hz / BUILD_CELL);
        iy = 0;
        supportY = sampleHeight(chunk, (ix + 0.5) * BUILD_CELL, (iz + 0.5) * BUILD_CELL);
        {
          const deck0 = findDeck(ix, iz, 0);
          if (deck0) supportY = deck0.baseY;
        }
      } else {
        ghostCell = null;
        ghostOk = false;
        uploadGhostMesh(null, false);
        return;
      }

      const cell = {
        type,
        ix, iy, iz,
        yaw: buildYaw,
        baseY: supportY,
      };
      if (isFurnitureDeploy(type)) {
        cell._ox = furnOx;
        cell._oz = furnOz;
      }
      const cx = (ix + 0.5) * BUILD_CELL + (cell._ox || 0);
      const cz = (iz + 0.5) * BUILD_CELL + (cell._oz || 0);
      const dist = Math.hypot(cx - player.x, cz - player.z);
      const minDist = isFurnitureDeploy(type) ? 0.7 : 1.2;
      let ok = dist <= 24 && dist >= minDist;
      let reason = ok ? "" : (dist < minDist ? "muy cerca" : "muy lejos");
      if (ok) {
        const v = validateBuild(cell);
        ok = v.ok;
        reason = v.reason || "";
        if (v.ok && v.reason === "poco soporte") reason = "poco soporte";
      }
      ghostCell = cell;
      ghostOk = ok;
      ghostReason = reason;
      uploadGhostMesh(cell, ok);
    }

    function tryPlaceGhost() {
      // Deployables (saco, fogata, …) use buildMode=false + deployMode — must not early-out.
      if ((!buildMode && !deployMode) || !ghostCell || !ghostOk) return false;
      const placed = {
        type: ghostCell.type,
        ix: ghostCell.ix,
        iy: ghostCell.iy,
        iz: ghostCell.iz,
        yaw: ghostCell.yaw,
        baseY: ghostCell.baseY,
        _ox: ghostCell._ox || 0,
        _oz: ghostCell._oz || 0,
        placedAt: performance.now(),
        ownerId: LOCAL_PLAYER_ID,
      };
      buildPieces.push(placed);
      rebuildBuildMesh();
      makeGhostFromRay();
      if (typeof playBuildPlace === "function") playBuildPlace("place");
      onHud({
        status: "Build · " + BUILD_LABELS[placed.type] + " ×" + buildPieces.length,
      });
      return true;
    }

    function tryRemoveAimed() {
      if (!buildMode) return false;
      const ray = camBuildRay();
      if (!ray) return false;
      const hitB = rayHitBuilds(ray.o, ray.d);
      if (!hitB) return false;
      if (pieceHasDependents(hitB.piece)) {
        onHud({ status: "Build · no quitar · sostiene otras piezas" });
        ghostReason = "sostiene piezas";
        return false;
      }
      buildPieces.splice(hitB.index, 1);
      rebuildBuildMesh();
      makeGhostFromRay();
      if (typeof playBuildPlace === "function") playBuildPlace("remove");
      onHud({ status: "Build · removido · " + buildPieces.length + " piezas" });
      return true;
    }

    function syncStageCamFlags() {
      try {
        const stage = document.querySelector(".stage");
        if (!stage) return;
        stage.dataset.cam = camMode;
        stage.dataset.build = buildMode ? "1" : "0";
        stage.dataset.deploy = deployMode ? "1" : "0";
        stage.dataset.aimlock = (typeof document !== "undefined" && document.pointerLockElement === canvas) ? "1" : "0";
      } catch (_) {}
    }

    function setBuildMode(on) {
      if (on && !heldIsBuildPlan()) {
        buildMode = false;
        onHud({ status: "Build · equipa Plano (hotbar)" });
        if (!deployMode) uploadGhostMesh(null, false);
        return;
      }
      buildMode = !!on;
      try { if (window.__fw) window.__fw.buildMode = buildMode; } catch (_) {}
      ensureBuildRadial();
      if (!buildMode) {
        setRadialOpen(false);
        if (!deployMode) {
          ghostCell = null;
          ghostOk = false;
          uploadGhostMesh(null, false);
          updateStabHud("", false);
        }
        if (!deployMode) onHud({ status: "Build off" });
      } else {
        deployMode = null;
        makeGhostFromRay();
        onHud({
          status: "Build · " + BUILD_LABELS[BUILD_TYPES[buildTypeIdx]] + " · MMB rueda · RMB órbita · R gira · LMB pone",
        });
      }
      syncStageCamFlags();
    }

    function setHeldItem(held) {
      heldItem = held || null;
      try {
        if (window.__fwBuildAAA && typeof window.__fwBuildAAA.closeUpgradeMenu === "function") {
          window.__fwBuildAAA.closeUpgradeMenu();
        }
      } catch (_) {}
      function enterDeploy(mode, status) {
        if (buildMode) {
          buildMode = false;
          try { if (window.__fw) window.__fw.buildMode = false; } catch (_) {}
          setRadialOpen(false);
        }
        deployMode = mode;
        buildTool = "place";
        makeGhostFromRay();
        onHud({ status: status });
        syncStageCamFlags();
      }
      if (heldIsTcItem()) {
        enterDeploy("toolcupboard", "Armario · LMB coloca · R gira · E abre");
      } else if (heldIsWorkbench()) {
        const wt = heldItem.id === "workbench_3" ? 3 : (heldItem.id === "workbench_2" ? 2 : 1);
        deployWbTier = wt;
        enterDeploy("workbench", "Mesa T" + wt + " · LMB coloca · R gira · E abre");
      } else if (heldIsResearchTable()) {
        enterDeploy("research_table", "Investigación · LMB coloca · R gira · E abre");
      } else if (heldIsCampfire()) {
        enterDeploy("campfire", "Fogata · LMB coloca · R gira · calor 4 m");
      } else if (heldIsSleepingBag()) {
        enterDeploy("sleeping_bag", "Saco · LMB coloca · R gira · respawn");
      } else if (heldIsBox()) {
        enterDeploy(heldItem.id, (heldItem.id === "box_large" ? "Caja grande" : "Caja pequeña") + " · LMB coloca · R gira · E abre");
      } else if (heldIsMetalDoor()) {
        enterDeploy("metal_door", "Puerta metal · LMB coloca · R gira");
      } else if (heldIsSatchel()) {
        deployMode = null;
        if (buildMode) setBuildMode(false);
        uploadGhostMesh(null, false);
        const EX = window.FalseWorldExplosives;
        onHud({
          status: "Satchel · LMB planta (mecha) · radio 4 m"
            + (EX ? " · " + EX.raidHint(1) : ""),
        });
      } else if (heldIsC4()) {
        deployMode = null;
        if (buildMode) setBuildMode(false);
        uploadGhostMesh(null, false);
        onHud({ status: "C4 · LMB planta · alto daño estructural" });
      } else if (heldIsRocket()) {
        deployMode = null;
        if (buildMode) setBuildMode(false);
        uploadGhostMesh(null, false);
        onHud({ status: "Cohete · LMB dispara · splash en uniones" });
      } else if (heldIsBuildPlan()) {
        deployMode = null;
        if (!buildMode) setBuildMode(true);
      } else if (heldIsHammer()) {
        deployMode = null;
        if (buildMode) setBuildMode(false);
        uploadGhostMesh(null, false);
        onHud({ status: "Martillo · LMB demuele (2 min) · RMB mejora/reparar" });
      } else if (heldIsLock()) {
        deployMode = null;
        if (buildMode) setBuildMode(false);
        uploadGhostMesh(null, false);
        onHud({ status: "Cerradura · E / LMB en puerta para bloquear" });
      } else {
        deployMode = null;
        if (buildMode) setBuildMode(false);
        else uploadGhostMesh(null, false);
      }
      syncStageCamFlags();
    }

    // =============================================================================
    // AAA BUILD SYSTEMS — Rust-like: stability, sockets, TC privilege, tiers,
    // decay, soft/hard side. Complements the modular piece mesh layer above.
    // =============================================================================

    const LOCAL_PLAYER_ID =
      (typeof window !== "undefined" && window.__fw && window.__fw.playerId)
        ? String(window.__fw.playerId)
        : "local";
    // Returning players: restore last saved feet pose (auth → Turso). Otherwise
    // spread guests so two tabs don't stack at the origin (remote disappears in FPV).
    const initialPose = opts.initialPose;
    if (
      initialPose &&
      Number.isFinite(+initialPose.x) &&
      Number.isFinite(+initialPose.z)
    ) {
      player.x = +initialPose.x;
      player.z = +initialPose.z;
      if (Number.isFinite(+initialPose.y)) {
        player.feetY = +initialPose.y;
        player.y = player.feetY + 1.55;
      }
      if (Number.isFinite(+initialPose.yaw)) {
        player.yaw = +initialPose.yaw;
      }
    } else if (LOCAL_PLAYER_ID && LOCAL_PLAYER_ID !== "local") {
      let h = 2166136261;
      for (let i = 0; i < LOCAL_PLAYER_ID.length; i++) {
        h ^= LOCAL_PLAYER_ID.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const ang = ((h >>> 0) % 628) / 100;
      const rad = 3 + ((h >>> 8) % 40) * 0.12;
      player.x = Math.cos(ang) * rad;
      player.z = Math.sin(ang) * rad;
    }
    const TC_RADIUS = 25.0; // Rust building privilege radius (~8 foundations)
    const TC_VERTICAL_LIMIT = BUILD_LEVEL_H * 5; // cylindrical protection, about five floors
    const FOUND_MAX_ABOVE_TERRAIN = 3.2; // stilts height limit vs ground
    const STAB_VERT_LOSS = 0.12; // ~12% per level up
    const STAB_FLOOR_STEP = 0.22; // horizontal loss per cell from nearest vertical support
    const STAB_WALL_TAX = 0.02;
    const STAB_ROOF_TAX = 0.08;
    const STAB_MIN = 1.0; // below this → collapse
    const DECAY_TICK_SEC = 30; // upkeep / wilderness check interval
    /** Skip wilderness decay for newly placed pieces (build session). */
    const DECAY_PLACE_GRACE_MS = 15 * 60 * 1000;
    /** Full decay time by material tier: twig, wood, stone, metal, armored. */
    const DECAY_FULL_SEC = [15 * 60, 3 * 60 * 60, 4 * 60 * 60, 8 * 60 * 60, 12 * 60 * 60];
    const SOFT_SIDE_MULT = 10;

    const BUILD_TIERS = [
      { id: "twig", label: "Paja", hp: 50, color: [0.55, 0.40, 0.22], upkeep: 1 },
      { id: "wood", label: "Madera", hp: 250, color: [0.38, 0.26, 0.14], upkeep: 2 },
      { id: "stone", label: "Piedra", hp: 500, color: [0.60, 0.56, 0.50], upkeep: 4 },
      // Metal base tint leans cool steel so soft/hard sides + leftovers hit the
      // shader metalness path; per-panel colors in buildSheetMetalWall still mix rust.
      { id: "metal", label: "Metal", hp: 1000, color: [0.48, 0.50, 0.54], upkeep: 8 },
      { id: "armored", label: "Blindado", hp: 2000, color: [0.18, 0.20, 0.24], upkeep: 16 },
    ];

    let nextPieceId = 1;
    let buildTool = "place"; // place | upgrade | repair | attack | cupboard
    let decayAcc = 0;
    let playerBuildRes = { wood: 5000, stone: 2000, metal: 800, hq: 200 };
    let tcPanelEl = null;
    let stabHudEl = null;
    let upgradeMenuEl = null;
    let upgradeMenuOpen = false;
    let upgradeTargetId = null;
    let activeTcId = null; // TC panel focus

    function tierMaxHp(tier) {
      const t = Math.max(0, Math.min(BUILD_TIERS.length - 1, tier | 0));
      const ex = window.FalseWorldExplosives;
      if (ex && ex.WALL_HP && Number.isFinite(ex.WALL_HP[t])) {
        return ex.WALL_HP[t];
      }
      return BUILD_TIERS[t].hp;
    }
    function tierColor(tier) {
      return BUILD_TIERS[Math.max(0, Math.min(BUILD_TIERS.length - 1, tier | 0))].color;
    }
    function pieceRgb(piece, rgbOverride) {
      if (rgbOverride != null) return rgbOverride;
      const base = tierColor(piece.tier != null ? piece.tier : 1);
      const stab = piece.stability != null ? piece.stability : 100;
      // Low stability → red warning tint
      if (stab < 35) {
        const k = 1 - stab / 35;
        return [
          base[0] * (1 - k) + 0.85 * k,
          base[1] * (1 - k) * 0.55,
          base[2] * (1 - k) * 0.45,
        ];
      }
      // Damaged → darken
      const maxHp = piece.maxHp || tierMaxHp(piece.tier || 0);
      const ratio = maxHp > 0 ? (piece.hp != null ? piece.hp : maxHp) / maxHp : 1;
      if (ratio < 0.55) {
        const d = 0.55 + ratio * 0.45;
        return [base[0] * d, base[1] * d, base[2] * d];
      }
      return [base[0], base[1], base[2]];
    }

    /** Hammer can pick up / demolish own pieces only during this grace window. */
    const DEMOLISH_GRACE_MS = 10 * 60 * 1000; // Rust: 10 minutes

    function ensurePieceInternals(p) {
      if (p.id == null || p.id === "") {
        p.id = String(LOCAL_PLAYER_ID || "local") + "-" + (nextPieceId++);
      } else {
        p.id = String(p.id);
        // Keep local counter ahead of numeric suffixes when possible
        const m = /^.*-(\d+)$/.exec(p.id);
        if (m) {
          const n = parseInt(m[1], 10);
          if (Number.isFinite(n) && n >= nextPieceId) nextPieceId = n + 1;
        }
      }
      if (p.tier == null) p.tier = 0; // twigs on place (Rust)
      if (p.maxHp == null) p.maxHp = tierMaxHp(p.tier);
      if (p.hp == null) p.hp = p.maxHp;
      if (p.stability == null) p.stability = 0;
      if (p.ownerId == null) p.ownerId = LOCAL_PLAYER_ID;
      // placedAt: 0 / missing = already locked (legacy or expired)
      if (p.placedAt == null) p.placedAt = 0;
      // Soft side faces inward (toward cell center); hard side faces outward
      if (p.softInward == null) p.softInward = true;
      if (p.type === "toolcupboard") {
        // 4 storage slots (stacks) — upkeep draws from these
        if (!Array.isArray(p.slots)) {
          p.slots = [
            { id: "wood", qty: 200 },
            { id: "stone", qty: 100 },
            null,
            null,
          ];
        }
        while (p.slots.length < 4) p.slots.push(null);
        // Legacy map for upkeep math
        if (!p.inv) p.inv = { wood: 0, stone: 0, metal: 0, hq: 0 };
        syncTcInvFromSlots(p);
        if (!p.auth) p.auth = [LOCAL_PLAYER_ID];
      }
      if (p.type === "door") {
        if (p.locked == null) p.locked = false;
        if (p.isOpen == null) p.isOpen = false;
        if (p._doorOpenAmt == null) p._doorOpenAmt = p.isOpen ? 1 : 0;
        // Locked doors authorize the builder only
        if (!p.auth) p.auth = [p.ownerId || LOCAL_PLAYER_ID];
      }
      return p;
    }

    function isNetworkWorldProp(p) {
      if (!p) return true;
      if (p.ownerId === "world") return true;
      const t = p.type;
      return t === "world_ore" || t === "world_tree" || t === "scrap_barrel"
        || t === "fx_blast" || t === "satchel_charge" || t === "c4_charge";
    }

    function serializeBuildPiece(p) {
      if (isNetworkWorldProp(p) || p.id == null) return null;
      const out = {
        id: String(p.id),
        type: p.type,
        ix: p.ix | 0,
        iy: p.iy | 0,
        iz: p.iz | 0,
        yaw: p.yaw || 0,
        baseY: +p.baseY || 0,
        _ox: p._ox || 0,
        _oz: p._oz || 0,
        tier: p.tier | 0,
        hp: p.hp,
        maxHp: p.maxHp,
        stability: p.stability,
        ownerId: p.ownerId,
        placedAt: p.placedAt || 0,
        softInward: p.softInward !== false,
      };
      if (p.wbTier != null) out.wbTier = p.wbTier | 0;
      if (p.lit != null) out.lit = !!p.lit;
      if (p.bagLabel) out.bagLabel = String(p.bagLabel).slice(0, 40);
      if (p.isOpen != null) out.isOpen = !!p.isOpen;
      if (p.locked != null) out.locked = !!p.locked;
      if (p.doorYaw != null) out.doorYaw = p.doorYaw;
      if (Array.isArray(p.slots)) out.slots = p.slots;
      if (p.inv) out.inv = p.inv;
      if (Array.isArray(p.auth)) out.auth = p.auth;
      return out;
    }

    function notifyWorldPlace(p) {
      const piece = serializeBuildPiece(p);
      if (!piece) return;
      try {
        const mp = window.__fw && window.__fw.mp;
        if (mp && typeof mp.sendPlace === "function") mp.sendPlace(piece);
      } catch (_) {}
    }

    function notifyWorldRemove(id) {
      if (id == null) return;
      try {
        const mp = window.__fw && window.__fw.mp;
        if (mp && typeof mp.sendRemove === "function") mp.sendRemove(String(id));
      } catch (_) {}
    }

    /**
     * Reports explosive hits so the server can resolve authoritative damage
     * and broadcast the corrected HP/removal to every peer (see
     * `applyRemoteHp` / `applyRemoteRemove`). Local prediction above still
     * applies immediately for responsiveness — this is reconciliation, not a
     * replacement for it, and is a no-op offline (no `mp` / not connected).
     */
    function notifyWorldExplode(kind, hits) {
      if (!Array.isArray(hits) || !hits.length) return;
      try {
        const mp = window.__fw && window.__fw.mp;
        if (mp && typeof mp.sendExplode === "function") mp.sendExplode(kind, hits);
      } catch (_) {}
    }

    function applyRemotePlace(raw, opts) {
      opts = opts || {};
      const silent = !!opts.silent;
      if (!raw || raw.id == null || !raw.type) return false;
      if (isNetworkWorldProp(raw)) return false;
      const id = String(raw.id);
      let existing = null;
      for (let i = 0; i < buildPieces.length; i++) {
        if (String(buildPieces[i].id) === id) {
          existing = buildPieces[i];
          break;
        }
      }
      if (existing) {
        existing.type = raw.type;
        existing.ix = raw.ix | 0;
        existing.iy = raw.iy | 0;
        existing.iz = raw.iz | 0;
        existing.yaw = raw.yaw || 0;
        existing.baseY = +raw.baseY || existing.baseY;
        existing._ox = raw._ox || 0;
        existing._oz = raw._oz || 0;
        if (raw.tier != null) existing.tier = raw.tier | 0;
        if (raw.hp != null) existing.hp = raw.hp;
        if (raw.maxHp != null) existing.maxHp = raw.maxHp;
        if (raw.stability != null) existing.stability = raw.stability;
        if (raw.softInward != null) existing.softInward = !!raw.softInward;
        if (raw.wbTier != null) existing.wbTier = raw.wbTier | 0;
        if (raw.lit != null) existing.lit = !!raw.lit;
        if (raw.isOpen != null) {
          const nextOpen = !!raw.isOpen;
          if (existing.isOpen !== nextOpen) {
            existing.isOpen = nextOpen;
            // Remote: snap (or brief lerp if helpers exist)
            if (typeof startDoorSwing === "function") startDoorSwing(existing, nextOpen);
            else existing._doorOpenAmt = nextOpen ? 1 : 0;
          } else {
            existing.isOpen = nextOpen;
          }
        }
        if (raw.locked != null) existing.locked = !!raw.locked;
        if (Array.isArray(raw.slots)) existing.slots = raw.slots;
        if (raw.inv) existing.inv = raw.inv;
        if (Array.isArray(raw.auth)) existing.auth = raw.auth;
        invalidatePieceMesh(existing);
        if (!silent) {
          rebuildCellIndex();
          recalculateStability();
          rebuildBuildMesh();
        }
        return true;
      }
      const placed = ensurePieceInternals({
        id,
        type: raw.type,
        ix: raw.ix | 0,
        iy: raw.iy | 0,
        iz: raw.iz | 0,
        yaw: raw.yaw || 0,
        baseY: +raw.baseY || 0,
        _ox: raw._ox || 0,
        _oz: raw._oz || 0,
        tier: raw.tier != null ? raw.tier | 0 : 0,
        hp: raw.hp,
        maxHp: raw.maxHp,
        stability: raw.stability != null ? raw.stability : 100,
        ownerId: raw.ownerId || "remote",
        placedAt: raw.placedAt || 0,
        softInward: raw.softInward !== false,
        wbTier: raw.wbTier,
        lit: raw.lit,
        bagLabel: raw.bagLabel,
        isOpen: raw.isOpen,
        locked: raw.locked,
        doorYaw: raw.doorYaw,
        slots: raw.slots,
        inv: raw.inv,
        auth: raw.auth,
      });
      buildPieces.push(placed);
      if (!silent) {
        rebuildCellIndex();
        recalculateStability();
        rebuildBuildMesh();
      }
      return true;
    }

    function applyRemoteRemove(id) {
      if (id == null) return false;
      const sid = String(id);
      const idx = buildPieces.findIndex((p) => String(p.id) === sid);
      if (idx < 0) return false;
      const p = buildPieces[idx];
      if (isNetworkWorldProp(p)) return false;
      try { pieceMeshCache.delete(p.id); } catch (_) {}
      buildPieces.splice(idx, 1);
      recalculateStability();
      rebuildBuildMesh();
      return true;
    }

    /**
     * Reconciles our locally-predicted HP with the server's authoritative
     * value after an "explode" round trip. The server resolves damage against
     * its own stored tier/hp (not whatever we sent it), so this corrects
     * prediction drift — and is how every peer converges on the same wall HP
     * during a raid instead of each client computing its own answer.
     */
    function applyRemoteHp(id, hp) {
      if (id == null || typeof hp !== "number" || !Number.isFinite(hp)) return false;
      const sid = String(id);
      const p = buildPieces.find((piece) => String(piece.id) === sid);
      if (!p || isNetworkWorldProp(p)) return false;
      p.hp = Math.max(0, hp);
      invalidatePieceMesh(p);
      rebuildBuildMesh();
      return true;
    }

    function applyWorldSnapshot(pieces) {
      const incoming = Array.isArray(pieces) ? pieces : [];
      const want = new Set();
      for (let i = 0; i < incoming.length; i++) {
        if (incoming[i] && incoming[i].id != null) want.add(String(incoming[i].id));
      }
      const now = performance.now();
      const keep = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (isNetworkWorldProp(p)) {
          keep.push(p);
          continue;
        }
        if (want.has(String(p.id))) {
          keep.push(p);
          continue;
        }
        // Keep very recent local placements until the server snapshot catches up
        if (p.ownerId === LOCAL_PLAYER_ID && (now - (p.placedAt || 0)) < 8000) {
          keep.push(p);
          continue;
        }
        try { pieceMeshCache.delete(p.id); } catch (_) {}
      }
      buildPieces = keep;
      for (let i = 0; i < incoming.length; i++) {
        applyRemotePlace(incoming[i], { silent: true });
      }
      rebuildCellIndex();
      recalculateStability();
      rebuildBuildMesh();
    }

    function syncTcInvFromSlots(tc) {
      const inv = { wood: 0, stone: 0, metal: 0, hq: 0 };
      const slots = tc.slots || [];
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s && inv[s.id] != null) inv[s.id] += s.qty | 0;
      }
      tc.inv = inv;
    }

    function tcSlotsHaveUpkeep(tc) {
      syncTcInvFromSlots(tc);
      const inv = tc.inv || {};
      return (inv.wood | 0) + (inv.stone | 0) + (inv.metal | 0) + (inv.hq | 0) > 0;
    }

    const TC_UPKEEP_MAX_DAYS = 7;
    const TC_UPKEEP_RES = ["wood", "stone", "metal", "hq"];

    /** Rust size tax: 10% (1–15) · 15% (16–40) · 20% (41–80) · 25% (81+). */
    function upkeepTaxRate(pieceCount) {
      const n = pieceCount | 0;
      if (n <= 15) return 0.10;
      if (n <= 40) return 0.15;
      if (n <= 80) return 0.20;
      return 0.25;
    }

    function isUpkeepPiece(p) {
      if (!p || !p.type) return false;
      if (p.type === "toolcupboard" || p.type === "workbench" || p.type === "research_table"
        || p.type === "scrap_barrel" || p.type === "world_ore" || p.type === "world_tree"
        || p.type === "campfire" || p.type === "sleeping_bag"
        || p.type === "box_small" || p.type === "box_large") return false;
      return true;
    }

    /** Resource value of a piece for daily tax (placement wood for twig, else upgrade cost). */
    function pieceUpkeepCost(p) {
      const t = p.tier | 0;
      if (t <= 0) {
        const meta = BUILD_BY_ID[p.type];
        return { id: "wood", qty: meta && meta.cost != null ? meta.cost : 25 };
      }
      return upgradeCostFor(p.type, t) || { id: "wood", qty: 25 };
    }

    /**
     * Consume per-resource daily upkeep for one decay tick.
     * Returns a map of resource ids that could not be paid (those tiers start decaying).
     */
    function tcConsumeUpkeep(tc, daily) {
      syncTcInvFromSlots(tc);
      if (!tc._upkeepDebtMap) tc._upkeepDebtMap = { wood: 0, stone: 0, metal: 0, hq: 0 };
      const unpaid = {};
      for (let o = 0; o < TC_UPKEEP_RES.length; o++) {
        const key = TC_UPKEEP_RES[o];
        const dayNeed = daily[key] || 0;
        if (dayNeed <= 0) continue;
        const have = (tc.inv && tc.inv[key]) | 0;
        if (have <= 0) {
          unpaid[key] = true;
          continue;
        }
        tc._upkeepDebtMap[key] = (tc._upkeepDebtMap[key] || 0) + dayNeed * DECAY_TICK_SEC / 86400;
        let need = Math.floor(tc._upkeepDebtMap[key]);
        if (need < 1) continue;
        tc._upkeepDebtMap[key] -= need;
        for (let i = 0; i < (tc.slots || []).length && need > 0; i++) {
          const s = tc.slots[i];
          if (!s || s.id !== key || s.qty <= 0) continue;
          const use = Math.min(s.qty, need);
          s.qty -= use;
          need -= use;
          if (s.qty <= 0) tc.slots[i] = null;
        }
        syncTcInvFromSlots(tc);
        if (need > 0) {
          tc._upkeepDebtMap[key] += need;
          unpaid[key] = true;
        }
      }
      return unpaid;
    }

    function tcProtectedDays(tc, daily) {
      syncTcInvFromSlots(tc);
      let minDays = Infinity;
      let any = false;
      for (let i = 0; i < TC_UPKEEP_RES.length; i++) {
        const id = TC_UPKEEP_RES[i];
        const need = daily[id] || 0;
        if (need <= 0.0001) continue;
        any = true;
        const have = (tc.inv && tc.inv[id]) | 0;
        minDays = Math.min(minDays, have / need);
      }
      if (!any) return TC_UPKEEP_MAX_DAYS;
      if (!Number.isFinite(minDays)) return 0;
      return Math.max(0, Math.min(TC_UPKEEP_MAX_DAYS, minDays));
    }

    function formatUpkeepReserve(days) {
      if (days >= TC_UPKEEP_MAX_DAYS - 0.01) return "7d (máx)";
      if (days >= 1) return (Math.floor(days * 10) / 10) + "d";
      const hrs = Math.max(0, days * 24);
      if (hrs >= 1) return (Math.floor(hrs * 10) / 10) + "h";
      return Math.max(0, Math.ceil(hrs * 60)) + "m";
    }

    function pieceInDecayGrace(p) {
      const at = p.placedAt | 0;
      if (!at) return false;
      return (performance.now() - at) < DECAY_PLACE_GRACE_MS;
    }

    function pieceWorldCenter(p) {
      const cell = BUILD_CELL;
      return {
        x: (p.ix + 0.5) * cell + (p._ox || 0),
        y: (p.baseY || 0) + p.iy * BUILD_LEVEL_H + BUILD_LEVEL_H * 0.5,
        z: (p.iz + 0.5) * cell + (p._oz || 0),
      };
    }

    // --- Soft / Hard side -------------------------------------------------------
    /** Outward (hard) normal in XZ for a wall yaw. */
    function wallHardNormal(p) {
      const yaw = ((p.yaw % 4) + 4) % 4;
      // yaw 0 = wall on +Z edge → hard faces +Z (outside)
      if (yaw === 0) return { x: 0, z: 1 };
      if (yaw === 1) return { x: 1, z: 0 };
      if (yaw === 2) return { x: 0, z: -1 };
      return { x: -1, z: 0 };
    }

    function isSoftSideAttack(p, fromX, fromZ) {
      if (!isWallType(p.type)) return false;
      const c = pieceWorldCenter(p);
      const n = wallHardNormal(p);
      // Vector from wall center to attacker
      let dx = fromX - c.x, dz = fromZ - c.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const hardDot = dx * n.x + dz * n.z;
      // Soft side = opposite of hard. If softInward flipped, invert.
      const onHard = hardDot > 0.05;
      return p.softInward ? !onHard : onHard;
    }

    function flipWallSoftSide(p) {
      if (!isWallType(p.type)) return false;
      p.softInward = !p.softInward;
      invalidatePieceMesh(p);
      onHud({
        status: "Soft side · "
          + (p.softInward ? "interior (hacia la celda)" : "exterior")
          + " · hard al otro lado",
      });
      rebuildBuildMesh();
      notifyWorldPlace(p);
      return true;
    }

    // --- Tool Cupboard / Building Privilege ------------------------------------
    function listToolCupboards() {
      const out = [];
      for (let i = 0; i < buildPieces.length; i++) {
        if (buildPieces[i].type === "toolcupboard") out.push(buildPieces[i]);
      }
      return out;
    }

    /** Connected foundations extend privilege outward from the base footprint. */
    function tcFoundationAnchors(tc) {
      const foundations = buildPieces.filter((p) => isFoundationType(p.type));
      const byCell = new Map();
      for (let i = 0; i < foundations.length; i++) {
        const p = foundations[i];
        byCell.set(p.ix + "," + p.iy + "," + p.iz, p);
      }
      let seed = byCell.get(tc.ix + "," + tc.iy + "," + tc.iz);
      if (!seed) {
        for (let i = 0; i < foundations.length; i++) {
          if (foundations[i].ix === tc.ix && foundations[i].iz === tc.iz) {
            seed = foundations[i];
            break;
          }
        }
      }
      if (!seed) return [];
      const out = [];
      const seen = new Set();
      const queue = [seed];
      while (queue.length) {
        const p = queue.shift();
        const key = p.ix + "," + p.iy + "," + p.iz;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(pieceWorldCenter(p));
        const neighbors = [
          [p.ix + 1, p.iy, p.iz], [p.ix - 1, p.iy, p.iz],
          [p.ix, p.iy, p.iz + 1], [p.ix, p.iy, p.iz - 1],
        ];
        for (let i = 0; i < neighbors.length; i++) {
          const n = neighbors[i];
          const next = byCell.get(n[0] + "," + n[1] + "," + n[2]);
          if (next) queue.push(next);
        }
      }
      return out;
    }

    function tcCovers(tc, x, z, y) {
      const tcCenter = pieceWorldCenter(tc);
      if (Number.isFinite(y) && Math.abs(y - tcCenter.y) > TC_VERTICAL_LIMIT) return false;
      const anchors = [tcCenter].concat(tcFoundationAnchors(tc));
      for (let i = 0; i < anchors.length; i++) {
        const dx = x - anchors[i].x, dz = z - anchors[i].z;
        if (dx * dx + dz * dz <= TC_RADIUS * TC_RADIUS) return true;
      }
      return false;
    }

    function privilegeZonesAt(x, z, y) {
      const zones = [];
      const tcs = listToolCupboards();
      for (let i = 0; i < tcs.length; i++) {
        if (tcCovers(tcs[i], x, z, y)) zones.push(tcs[i]);
      }
      return zones;
    }

    function isAuthorizedOnTc(tc, playerId) {
      if (!tc) return false;
      const pid = playerId || LOCAL_PLAYER_ID;
      // Owner always builds in their own privilege (auth list can desync after reload / id change)
      if (tc.ownerId && String(tc.ownerId) === String(pid)) return true;
      if (!tc.auth || !tc.auth.length) {
        // Legacy TC with no auth → treat owner-or-local as authorized
        return !tc.ownerId || String(tc.ownerId) === String(pid);
      }
      for (let i = 0; i < tc.auth.length; i++) {
        if (String(tc.auth[i]) === String(pid)) return true;
      }
      return false;
    }

    /** Rust privilege: blocked in enemy TC; free in wilderness; ok in own TC. */
    function privilegeCheck(x, z, y) {
      const zones = privilegeZonesAt(x, z, y);
      if (zones.length === 0) {
        return { ok: true, reason: "", wilderness: true, tc: null };
      }
      let friendly = null;
      for (let i = 0; i < zones.length; i++) {
        if (isAuthorizedOnTc(zones[i], LOCAL_PLAYER_ID)) friendly = zones[i];
        else {
          const enemy = zones[i];
          const c = pieceWorldCenter(enemy);
          const dist = Math.hypot(x - c.x, z - c.z);
          const distTxt = Number.isFinite(dist) ? (" · a " + Math.max(1, Math.round(dist)) + " m") : "";
          return {
            ok: false,
            reason: "Armario de otro jugador cerca" + distTxt + " · no puedes construir aquí",
            wilderness: false,
            tc: enemy,
          };
        }
      }
      return { ok: true, reason: "", wilderness: false, tc: friendly };
    }

    function tcOverlapBlocked(ix, iz, iy, baseY, ignoreId) {
      const x = (ix + 0.5) * BUILD_CELL;
      const z = (iz + 0.5) * BUILD_CELL;
      const y = (baseY || 0) + (iy || 0) * BUILD_LEVEL_H + BUILD_LEVEL_H * 0.5;
      const tcs = listToolCupboards();
      for (let i = 0; i < tcs.length; i++) {
        const tc = tcs[i];
        if (ignoreId && tc.id === ignoreId) continue;
        // A second TC is forbidden inside an existing privilege zone. Separate
        // external TCs are valid and their radii may later overlap via foundations.
        if (tcCovers(tc, x, z, y)) return true;
      }
      return false;
    }

    // --- Sockets / snapping -----------------------------------------------------
    /**
     * Socket kinds:
     *  - foundation_side: attach another foundation edge-to-edge
     *  - deck_top_edge: wall bottom sits here
     *  - wall_top: floor / roof support
     */
    function socketsForPiece(p, socks) {
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
      const deckY = p.baseY + p.iy * BUILD_LEVEL_H + BUILD_FOUND_H;
      // Wall tops / ceiling attach — must match wall mesh (includes FOUND_H)
      const topY = levelWallTopY(p.baseY + p.iy * BUILD_LEVEL_H);
      if (isFoundationType(p.type) || isFloorType(p.type)) {
        const sides = [
          { yaw: 0, x: cx, z: z1, nix: p.ix, niz: p.iz + 1 },
          { yaw: 1, x: x1, z: cz, nix: p.ix + 1, niz: p.iz },
          { yaw: 2, x: cx, z: z0, nix: p.ix, niz: p.iz - 1 },
          { yaw: 3, x: x0, z: cz, nix: p.ix - 1, niz: p.iz },
        ];
        const nSide = p.type === "foundation_tri" || p.type === "floor_tri" ? 3 : 4;
        for (let s = 0; s < nSide; s++) {
          const sd = sides[s];
          socks.push({
            kind: "foundation_side",
            x: sd.x, y: deckY, z: sd.z,
            yaw: sd.yaw,
            ix: sd.nix, iz: sd.niz, iy: p.iy,
            parent: p,
          });
        }
        for (let s = 0; s < 4; s++) {
          const sd = sides[s];
          socks.push({
            kind: "deck_top_edge",
            x: sd.x, y: deckY, z: sd.z,
            yaw: sd.yaw,
            ix: p.ix, iz: p.iz, iy: p.iy,
            parent: p,
          });
        }
      }
      if (isWallType(p.type) && p.type !== "roof_wall") {
        socks.push({
          kind: "wall_top",
          x: cx, y: topY, z: cz,
          yaw: p.yaw,
          ix: p.ix, iz: p.iz, iy: p.iy,
          parent: p,
        });
      }
    }

    /** Only evaluate sockets near the cursor cell (spatial locality). */
    function collectSocketsNear(wx, wz, radiusCells) {
      const socks = [];
      const c = worldToBuildCell(wx, wz);
      const R = radiusCells != null ? radiusCells : 2;
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          // Check a few vertical levels around player
          for (let dy = 0; dy <= 3; dy++) {
            const list = piecesInCell(c.ix + dx, dy, c.iz + dz);
            for (let i = 0; i < list.length; i++) socketsForPiece(list[i], socks);
          }
        }
      }
      if (socks.length === 0) {
        for (let i = 0; i < buildPieces.length; i++) socketsForPiece(buildPieces[i], socks);
      }
      return socks;
    }

    function nearestSocket(kind, x, y, z, maxDist) {
      const socks = collectSocketsNear(x, z, 2);
      let best = null;
      let bestD = maxDist != null ? maxDist : 1.6;
      for (let i = 0; i < socks.length; i++) {
        const s = socks[i];
        if (s.kind !== kind) continue;
        const d = Math.hypot(s.x - x, (s.y - y) * 0.35, s.z - z);
        if (d < bestD) { bestD = d; best = s; }
      }
      return best;
    }

    /** Foundation side socket into a free cell (skips neighbors that already have a foundation). */
    function nearestFreeFoundationSocket(x, y, z, maxDist, preferType) {
      const socks = collectSocketsNear(x, z, 3);
      let best = null;
      let bestD = maxDist != null ? maxDist : 2.8;
      const want = preferType || "foundation";
      for (let i = 0; i < socks.length; i++) {
        const s = socks[i];
        if (s.kind !== "foundation_side") continue;
        const probe = {
          type: want,
          ix: s.ix, iy: s.iy, iz: s.iz,
          yaw: 0,
          baseY: s.parent ? s.parent.baseY : 0,
        };
        if (occupancyBlocked(probe)) continue;
        if (findDeck(s.ix, s.iz, s.iy)) continue;
        const d = Math.hypot(s.x - x, (s.y - y) * 0.25, s.z - z);
        if (d < bestD) { bestD = d; best = s; }
      }
      return best;
    }

    // --- Structural stability ---------------------------------------------------
    function pieceSupports(p) {
      // Returns list of {piece, weight} that can feed stability into p
      const feeds = [];
      const ix = p.ix, iz = p.iz, iy = p.iy;

      if (isFoundationType(p.type)) {
        if (iy <= 0) return [{ ground: true, weight: 1 }];
        const below = findDeck(ix, iz, iy - 1);
        if (below) feeds.push({ piece: below, weight: 1 - STAB_VERT_LOSS });
        // side-linked foundations at same level
        const neigh = [
          [ix + 1, iz], [ix - 1, iz], [ix, iz + 1], [ix, iz - 1],
        ];
        for (let n = 0; n < neigh.length; n++) {
          for (let i = 0; i < buildPieces.length; i++) {
            const q = buildPieces[i];
            if (isFoundationType(q.type) && q.ix === neigh[n][0] && q.iz === neigh[n][1] && q.iy === iy) {
              feeds.push({ piece: q, weight: 0.92 });
            }
          }
        }
        return feeds;
      }

      if (isWallType(p.type) && p.type !== "roof_wall") {
        const deck = findDeck(ix, iz, iy);
        if (deck) feeds.push({ piece: deck, weight: 1 - STAB_WALL_TAX });
        else if (iy <= 0) feeds.push({ ground: true, weight: 1 - STAB_WALL_TAX });
        return feeds;
      }

      if (isFloorType(p.type) || isRoofType(p.type)) {
        // From walls in cell / adjacent edges — horizontal falloff by "support distance"
        for (let i = 0; i < buildPieces.length; i++) {
          const w = buildPieces[i];
          if (!isWallType(w.type) || w.type === "roof_wall" || w.iy !== iy) continue;
          let dist = 99;
          if (w.ix === ix && w.iz === iz) dist = 0;
          else if (w.ix === ix && Math.abs(w.iz - iz) === 1) dist = 1;
          else if (w.iz === iz && Math.abs(w.ix - ix) === 1) dist = 1;
          else continue;
          const wgt = Math.max(0.05, 1 - STAB_FLOOR_STEP * dist - (isRoofType(p.type) ? STAB_ROOF_TAX : 0));
          feeds.push({ piece: w, weight: wgt });
        }
        const deck = findDeck(ix, iz, iy);
        if (deck && isFoundationType(deck.type)) feeds.push({ piece: deck, weight: 0.85 });
        return feeds;
      }

      if (isRampType(p.type)) {
        const deck = findDeck(ix, iz, iy);
        if (deck) feeds.push({ piece: deck, weight: 0.95 });
        return feeds;
      }

      // Deployables / world props sit on deck or bare ground — never collapse on meadow
      if (isFurnitureDeploy(p.type) || p.type === "scrap_barrel"
        || p.type === "world_ore" || p.type === "world_tree") {
        const deck = findDeck(ix, iz, iy);
        if (deck) feeds.push({ piece: deck, weight: 0.95 });
        else feeds.push({ ground: true, weight: 1 });
        return feeds;
      }

      if (p.type === "roof_wall") {
        const deck = findDeck(ix, iz, iy);
        if (deck) feeds.push({ piece: deck, weight: 0.9 });
        for (let i = 0; i < buildPieces.length; i++) {
          const w = buildPieces[i];
          if (isWallType(w.type) && w.ix === ix && w.iz === iz && w.iy === iy) {
            feeds.push({ piece: w, weight: 0.88 });
          }
        }
      }
      return feeds;
    }

    /**
     * Multi-source BFS / queue relaxation from ground foundations (graph adjacency).
     * Roots = 100%. Each edge applies material/distance loss. Re-queues on improvement
     * so adjacent foundation cycles still converge (Rust-like support graph).
     */
    function computeStabilityValues() {
      rebuildCellIndex();
      for (let i = 0; i < buildPieces.length; i++) {
        ensurePieceInternals(buildPieces[i]);
        buildPieces[i].stability = 0;
      }
      // dependents: supportId → [{ piece, weight }]
      const dependents = new Map();
      const byId = new Map();
      for (let i = 0; i < buildPieces.length; i++) {
        byId.set(buildPieces[i].id, buildPieces[i]);
      }
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        const feeds = pieceSupports(p);
        for (let f = 0; f < feeds.length; f++) {
          const src = feeds[f];
          if (src.ground || !src.piece) continue;
          const sid = src.piece.id;
          let list = dependents.get(sid);
          if (!list) {
            list = [];
            dependents.set(sid, list);
          }
          let w = src.weight;
          if (p.iy > src.piece.iy) {
            w *= Math.pow(1 - STAB_VERT_LOSS, p.iy - src.piece.iy);
          } else if (p.iy > 0 && src.piece.iy === p.iy) {
            // same level — no extra vertical tax
          } else if (p.iy > 0) {
            w *= Math.pow(1 - STAB_VERT_LOSS, p.iy);
          }
          list.push({ piece: p, weight: w });
        }
      }

      const queue = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        const cx = (p.ix + 0.5) * BUILD_CELL;
        const cz = (p.iz + 0.5) * BUILD_CELL;
        const gy = chunk ? sampleHeight(chunk, cx, cz) : p.baseY;
        // Ground foundations
        if (isFoundationType(p.type) && p.iy <= 0) {
          const above = (p.baseY + BUILD_FOUND_H) - gy;
          if (above <= FOUND_MAX_ABOVE_TERRAIN) p.stability = 100;
          else p.stability = Math.max(0, 100 - (above - FOUND_MAX_ABOVE_TERRAIN) * 40);
          if (p.stability >= STAB_MIN) queue.push(p);
          continue;
        }
        // Ground walls (no foundation) — rooted in terrain
        if (isWallType(p.type) && p.type !== "roof_wall" && p.iy <= 0 && !findDeck(p.ix, p.iz, p.iy)) {
          p.stability = 100 * (1 - STAB_WALL_TAX);
          if (p.stability >= STAB_MIN) queue.push(p);
          continue;
        }
        // Sleeping bag / campfire / TC / world nodes on bare ground
        if (isFurnitureDeploy(p.type) || isWorldPropPiece(p)) {
          if (!findDeck(p.ix, p.iz, p.iy)) {
            p.stability = 100;
            queue.push(p);
          }
          // On a deck: BFS from foundation/floor feeds them via pieceSupports
        }
      }

      let head = 0;
      let guard = 0;
      const maxSteps = Math.max(64, buildPieces.length * 8);
      while (head < queue.length && guard < maxSteps) {
        guard++;
        const cur = queue[head++];
        const outs = dependents.get(cur.id);
        if (!outs) continue;
        for (let e = 0; e < outs.length; e++) {
          const edge = outs[e];
          const next = Math.max(0, Math.min(100, (cur.stability || 0) * edge.weight));
          if (next > (edge.piece.stability || 0) + 0.05) {
            edge.piece.stability = next;
            queue.push(edge.piece);
          }
        }
      }
    }

    function collapseUnstable() {
      let removed = false;
      const keep = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        // Never collapse deployables / world harvest props (ground-rooted)
        if (isFurnitureDeploy(p.type) || isWorldPropPiece(p)) {
          if ((p.stability | 0) < STAB_MIN) p.stability = 100;
          keep.push(p);
          continue;
        }
        if (p.stability < STAB_MIN) {
          removed = true;
          continue;
        }
        keep.push(p);
      }
      if (!removed) return false;
      buildPieces = keep;
      computeStabilityValues();
      collapseUnstable();
      return true;
    }

    function recalculateStability() {
      computeStabilityValues();
      if (collapseUnstable()) {
        rebuildBuildMesh();
        onHud({ status: "Estabilidad · colapso estructural" });
      }
    }

    /** Fast ghost estimate (no graph insert) — full solve runs on place/remove. */
    function previewStability(cell) {
      const type = cell.type;
      const ix = cell.ix, iz = cell.iz, iy = cell.iy;
      if (isFoundationType(type)) {
        if (iy <= 0) return 100;
        const below = findDeck(ix, iz, iy - 1);
        return below ? Math.max(0, (below.stability || 0) * (1 - STAB_VERT_LOSS)) : 0;
      }
      if (isWallType(type) && type !== "roof_wall") {
        const deck = findDeck(ix, iz, iy);
        if (!deck) {
          if (iy > 0) return 0;
          return 100 * (1 - STAB_WALL_TAX);
        }
        let s = (deck.stability || 0) * (1 - STAB_WALL_TAX);
        if (iy > 0) s *= Math.pow(1 - STAB_VERT_LOSS, iy);
        return Math.min(100, s);
      }
      if (isFloorType(type) || isRoofType(type)) {
        let best = 0;
        for (let i = 0; i < buildPieces.length; i++) {
          const w = buildPieces[i];
          if (!isWallType(w.type) || w.type === "roof_wall" || w.iy !== iy) continue;
          let dist = 99;
          if (w.ix === ix && w.iz === iz) dist = 0;
          else if (w.ix === ix && Math.abs(w.iz - iz) === 1) dist = 1;
          else if (w.iz === iz && Math.abs(w.ix - ix) === 1) dist = 1;
          else continue;
          const wgt = Math.max(0.05, 1 - STAB_FLOOR_STEP * dist - (isRoofType(type) ? STAB_ROOF_TAX : 0));
          best = Math.max(best, (w.stability || 0) * wgt);
        }
        if (iy > 0) best *= Math.pow(1 - STAB_VERT_LOSS, iy);
        return Math.min(100, best);
      }
      if (isRampType(type) || type === "toolcupboard" || type === "workbench"
        || type === "research_table" || type === "scrap_barrel"
        || type === "world_ore" || type === "world_tree"
        || type === "campfire" || type === "sleeping_bag"
        || type === "box_small" || type === "box_large") {
        const deck = findDeck(ix, iz, iy);
        return deck ? (deck.stability || 0) * 0.95 : 100;
      }
      return 50;
    }

    // --- Damage / upgrade / repair ---------------------------------------------
    function destroyPieceAt(index, reason) {
      if (index < 0 || index >= buildPieces.length) return;
      const removedId = buildPieces[index] && buildPieces[index].id;
      buildPieces.splice(index, 1);
      recalculateStability();
      rebuildBuildMesh();
      notifyWorldRemove(removedId);
      onHud({ status: "Destruido · " + (reason || "hp") + " · " + buildPieces.length + " pcs" });
    }

    function damagePiece(piece, baseDamage, fromX, fromZ, tool) {
      ensurePieceInternals(piece);
      let dmg = baseDamage;
      // Stone+ immune to basic tools
      if ((piece.tier | 0) >= 2 && tool === "basic") {
        onHud({ status: "Inmune · necesita explosivos" });
        return false;
      }
      // Fire only hurts twig/wood
      if (tool === "fire") {
        const EX = window.FalseWorldExplosives;
        if (EX && !EX.fireHurts(piece.tier | 0)) {
          return false;
        }
        if ((piece.tier | 0) >= 2) return false;
      }
      const soft = isWallType(piece.type) && isSoftSideAttack(piece, fromX, fromZ);
      if (soft) {
        if (tool === "satchel" || tool === "c4" || tool === "rocket" || tool === "explosive") {
          const EX = window.FalseWorldExplosives;
          dmg *= (EX && EX.SATCHEL_SOFT) || 1.1;
        } else {
          dmg *= SOFT_SIDE_MULT;
        }
      }
      piece.hp -= dmg;
      if (piece.hp <= 0) {
        const idx = buildPieces.indexOf(piece);
        destroyPieceAt(idx, "roto");
        return true;
      }
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      onHud({
        status: "Hit · " + Math.ceil(piece.hp) + "/" + piece.maxHp
          + " HP · " + BUILD_TIERS[piece.tier].label
          + (soft
            ? ((tool === "satchel" || tool === "c4" || tool === "rocket") ? " · SOFT×1.1" : " · SOFT×10")
            : " · hard"),
      });
      return true;
    }

    // --- Explosives (satchel / rocket / C4) — tables from fw-explosives-v1 ---
    let blastFx = []; // {x,y,z,born,life,r0,r1}
    let rocketProjectiles = []; // {x,y,z,vx,vy,vz,born}
    let stickyCharges = []; // {id, kind, x,y,z, fuseAt, pieceId?}
    let treeParticles = []; // ballistic wood splinters + ground dust

    function exApi() {
      return window.FalseWorldExplosives || null;
    }
    function explosiveHardDamage(kind, tier) {
      const EX = exApi();
      if (!EX) return 50;
      if (kind === "satchel") return EX.satchelHard(tier);
      if (kind === "c4") return EX.c4Hard(tier);
      if (kind === "rocket") return EX.rocketHard(tier);
      return EX.satchelHard(tier);
    }
    function spawnBlastFx(x, y, z, radius) {
      blastFx.push({
        x, y, z,
        born: performance.now(),
        life: 520,
        r0: 0.2,
        r1: radius || 4,
      });
    }
    function applyExplosion(x, y, z, kind, opts) {
      opts = opts || {};
      const EX = exApi();
      const radius = opts.radius != null ? opts.radius : (EX ? EX.SATCHEL_R : 4);
      const splashR = opts.splashR != null ? opts.splashR : (EX ? EX.ROCKET_SPLASH_R : 3.5);
      const splashF = opts.splashF != null ? opts.splashF : (EX ? EX.ROCKET_SPLASH_F : 0.45);
      const playerDmg = opts.playerDmg != null ? opts.playerDmg : (EX ? EX.SATCHEL_PLAYER_DMG : 475);
      try {
        playUiSfx(kind === "c4" ? "blast_big" : (kind === "rocket" ? "blast_rocket" : "blast"));
        const dist = Math.hypot(player.x - x, player.z - z);
        const shake = Math.max(0.08, 1 - dist / Math.max(8, radius * 2.2));
        camShake = Math.max(camShake, shake * (kind === "c4" ? 0.55 : (kind === "rocket" ? 0.42 : 0.32)));
      } catch (_) {}
      spawnBlastFx(x, y, z, radius);
      let hit = 0;
      const doomed = [];
      const serverHits = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type === "fx_blast" || p.type === "satchel_charge" || p.type === "c4_charge") continue;
        if (p.ownerId === "world" && (p.type === "scrap_barrel" || p.type === "world_ore" || p.type === "world_tree")) continue;
        const c = pieceWorldCenter(p);
        const d = Math.hypot(c.x - x, c.z - z);
        if (d > Math.max(radius, splashR) + 1.5) continue;
        let mult = 1;
        if (d > radius) {
          if (kind !== "rocket" || d > splashR) continue;
          mult = splashF * (1 - (d - radius) / Math.max(0.01, splashR - radius));
        } else {
          mult = 1 - (d / radius) * 0.15;
        }
        let dmg = explosiveHardDamage(kind, p.tier | 0) * mult;
        // Primary wall facing explosion gets soft check from blast center
        ensurePieceInternals(p);
        const soft = isWallType(p.type) && isSoftSideAttack(p, x, z);
        if (soft) dmg *= (EX && EX.SATCHEL_SOFT) || 1.1;
        p.hp -= dmg;
        hit++;
        if (!isNetworkWorldProp(p) && p.id != null) serverHits.push({ id: p.id, soft: !!soft });
        if (kind === "satchel" && EX && EX.fireHurts(p.tier | 0)) {
          p.onFireUntil = performance.now() + 5500;
        }
        if (p.hp <= 0) doomed.push(p);
        else invalidatePieceMesh(p);
      }
      for (let i = 0; i < doomed.length; i++) {
        const idx = buildPieces.indexOf(doomed[i]);
        if (idx >= 0) buildPieces.splice(idx, 1);
      }
      if (hit || doomed.length) {
        recalculateStability();
        rebuildBuildMesh();
      }
      // Server recomputes authoritative dmg from `kind`+`soft` and replies
      // with `hp`/`remove` messages (see `applyRemoteHp`) — local mutations
      // above are just prediction so the attacker sees instant feedback.
      notifyWorldExplode(kind, serverHits);
      // Player splash (scaled to MVP 100 HP pool → lethal in radius)
      if (player && !vitals.dead) {
        const pd = Math.hypot(player.x - x, player.z - z);
        if (pd <= radius) {
          const falloff = 1 - (pd / radius) * 0.35;
          const dmg = Math.min(MAX_HP + 5, playerDmg * (MAX_HP / 100) * falloff);
          vitals.hp -= dmg;
          if (vitals.hp <= 0) {
            vitals.hp = 0;
            vitals.dead = true;
            onHud({ status: "Muerto · explosión" });
          } else {
            syncVitalsDom();
            onHud({ status: "¡Boom! −" + Math.round(dmg) + " HP" });
          }
        }
      }
      onHud({
        status: (kind === "rocket" ? "Cohete" : (kind === "c4" ? "C4" : "Satchel"))
          + " · " + hit + " piezas · " + doomed.length + " destruidas",
      });
    }
    function placeStickyCharge(kind) {
      if (vitals.dead) return false;
      const itemId = kind === "c4" ? "c4" : "satchel";
      if (invCount(itemId) < 1) {
        onHud({ status: "Sin " + itemId });
        return false;
      }
      const ray = camBuildRay();
      if (!ray) return false;
      let x = player.x + Math.sin(player.yaw) * 1.4;
      let z = player.z + Math.cos(player.yaw) * 1.4;
      let y = (player.feetY != null ? player.feetY : 0) + 0.35;
      const hitB = rayHitBuilds(ray.o, ray.d);
      const hitT = rayHitTerrain(ray.o, ray.d);
      if (hitB && (!hitT || hitB.t < hitT.t) && hitB.t < 4.5) {
        const p = hitB.piece;
        const c = pieceWorldCenter(p);
        x = c.x; z = c.z;
        y = (p.baseY || 0) + (p.iy | 0) * BUILD_LEVEL_H + 1.2;
      } else if (hitT && hitT.t < 5) {
        x = ray.o[0] + ray.d[0] * hitT.t;
        y = ray.o[1] + ray.d[1] * hitT.t + 0.15;
        z = ray.o[2] + ray.d[2] * hitT.t;
      }
      if (!invConsume(itemId, 1)) return false;
      const fuseMs = kind === "c4"
        ? 9000 + Math.random() * 2000
        : 7500 + Math.random() * 3500;
      stickyCharges.push({
        id: nextPieceId++,
        kind,
        x, y, z,
        fuseAt: performance.now() + fuseMs,
      });
      uploadFxMesh();
      try { playUiSfx("fuse_plant"); } catch (_) {}
      const EX = exApi();
      onHud({
        status: (kind === "c4" ? "C4" : "Satchel")
          + " plantada · mecha ~" + Math.round(fuseMs / 1000) + "s"
          + (EX ? " · " + EX.raidHint(1) : ""),
      });
      return true;
    }
    function fireRocket() {
      if (vitals.dead) return false;
      if (invCount("rocket") < 1) {
        onHud({ status: "Sin cohete" });
        return false;
      }
      if (!invConsume("rocket", 1)) return false;
      const yaw = player.yaw;
      const pitch = (camMode === "fpv" ? fpvPitch : -0.12);
      const speed = 28;
      const ox = player.x;
      const oy = (player.y != null ? player.y : 1.5);
      const oz = player.z;
      const vx = Math.sin(yaw) * Math.cos(pitch) * speed;
      const vy = Math.sin(pitch) * speed;
      const vz = Math.cos(yaw) * Math.cos(pitch) * speed;
      rocketProjectiles.push({
        x: ox + Math.sin(yaw) * 0.6,
        y: oy,
        z: oz + Math.cos(yaw) * 0.6,
        vx, vy, vz,
        born: performance.now(),
      });
      player.attackPulse = true;
      try { playUiSfx("rocket_fire"); camShake = Math.max(camShake, 0.12); } catch (_) {}
      onHud({ status: "Cohete · splash a uniones de pared" });
      return true;
    }
    function tickExplosives(dt) {
      const now = performance.now();
      // Sticky fuses
      for (let i = stickyCharges.length - 1; i >= 0; i--) {
        const c = stickyCharges[i];
        const left = c.fuseAt - now;
        if (left > 0 && left < 2200 && !c._tickSfx) {
          c._tickSfx = true;
          try { playUiSfx("fuse_tick"); } catch (_) {}
        }
        if (now < c.fuseAt) continue;
        stickyCharges.splice(i, 1);
        applyExplosion(c.x, c.y, c.z, c.kind, {});
      }
      // Rockets
      for (let i = rocketProjectiles.length - 1; i >= 0; i--) {
        const r = rocketProjectiles[i];
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        r.z += r.vz * dt;
        r.vy -= 4.5 * dt;
        let boom = false;
        if (now - r.born > 3500) boom = true;
        if (chunk && r.y < sampleHeight(chunk, r.x, r.z) + 0.1) boom = true;
        for (let j = 0; j < buildPieces.length && !boom; j++) {
          const p = buildPieces[j];
          if (p.type === "fx_blast" || p.type === "satchel_charge" || p.type === "c4_charge") continue;
          const b = pieceAabb(p);
          if (r.x >= b.minX - 0.15 && r.x <= b.maxX + 0.15
            && r.y >= b.minY - 0.15 && r.y <= b.maxY + 0.15
            && r.z >= b.minZ - 0.15 && r.z <= b.maxZ + 0.15) {
            boom = true;
          }
        }
        if (boom) {
          rocketProjectiles.splice(i, 1);
          applyExplosion(r.x, r.y, r.z, "rocket", {});
        }
      }
      // Fire DoT on wood
      let fireDirty = false;
      for (let i = buildPieces.length - 1; i >= 0; i--) {
        const p = buildPieces[i];
        if (!p.onFireUntil || now > p.onFireUntil) {
          if (p.onFireUntil && now > p.onFireUntil) {
            p.onFireUntil = 0;
            fireDirty = true;
          }
          continue;
        }
        const EX = exApi();
        if (EX && !EX.fireHurts(p.tier | 0)) {
          p.onFireUntil = 0;
          continue;
        }
        p.hp -= 8 * dt;
        fireDirty = true;
        if (p.hp <= 0) {
          buildPieces.splice(i, 1);
        } else invalidatePieceMesh(p);
      }
      if (fireDirty) {
        recalculateStability();
        rebuildBuildMesh();
      }
      // Prune FX
      for (let i = blastFx.length - 1; i >= 0; i--) {
        if (now - blastFx[i].born > blastFx[i].life) blastFx.splice(i, 1);
      }
    }
    function drawBlastFxOverlay(arr) {
      const now = performance.now();
      for (let i = 0; i < blastFx.length; i++) {
        const f = blastFx[i];
        const u = Math.min(1, (now - f.born) / f.life);
        const r = f.r0 + (f.r1 - f.r0) * u;
        const a = 1 - u;
        const steps = 6;
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const yy = f.y + (t - 0.5) * r * 1.2;
          const rr = Math.sin(Math.PI * t) * r * 0.85;
          const rgb = [1.0 * a, (0.45 + 0.3 * (1 - u)) * a, 0.12 * a];
          buildPushBox(arr, f.x - rr, yy - 0.08, f.z - rr, f.x + rr, yy + 0.08, f.z + rr, rgb);
        }
      }
      for (let i = 0; i < rocketProjectiles.length; i++) {
        const r = rocketProjectiles[i];
        const spd = Math.hypot(r.vx, r.vy, r.vz) || 1;
        const bx = r.vx / spd, by = r.vy / spd, bz = r.vz / spd;
        buildPushBox(arr, r.x - 0.1, r.y - 0.1, r.z - 0.1, r.x + 0.1, r.y + 0.1, r.z + 0.1, [0.98, 0.82, 0.25]);
        for (let k = 1; k <= 4; k++) {
          const t = k * 0.22;
          const a = 1 - k * 0.18;
          const sx = r.x - bx * t, sy = r.y - by * t, sz = r.z - bz * t;
          const w = 0.06 + k * 0.04;
          buildPushBox(arr, sx - w, sy - w, sz - w, sx + w, sy + w, sz + w, [1 * a, (0.45 - k * 0.05) * a, 0.08 * a]);
        }
      }
      // Sticky charge blink + spark
      for (let i = 0; i < stickyCharges.length; i++) {
        const c = stickyCharges[i];
        const blink = ((performance.now() * 0.012) | 0) % 2 === 0;
        const rgb = c.kind === "c4"
          ? (blink ? [0.95, 0.2, 0.15] : [0.35, 0.12, 0.1])
          : (blink ? [0.9, 0.55, 0.15] : [0.4, 0.25, 0.1]);
        const s = c.kind === "c4" ? 0.16 : 0.12;
        buildPushBox(arr, c.x - s, c.y - s * 0.6, c.z - s, c.x + s, c.y + s * 0.6, c.z + s, rgb);
      }
    }
    function tickTreeParticles(dt) {
      const step = Math.max(0, Math.min(0.05, dt || 0));
      for (let i = treeParticles.length - 1; i >= 0; i--) {
        const p = treeParticles[i];
        p.age += step;
        if (p.age >= p.life) {
          treeParticles.splice(i, 1);
          continue;
        }
        const drag = Math.exp(-(p.kind === "dust" ? 2.4 : 0.7) * step);
        p.vx *= drag;
        p.vz *= drag;
        p.vy -= (p.kind === "dust" ? 0.8 : 8.5) * step;
        p.x += p.vx * step;
        p.y += p.vy * step;
        p.z += p.vz * step;
        const ground = chunk ? sampleHeight(chunk, p.x, p.z) + p.size * 0.45 : -999;
        if (p.y < ground) {
          p.y = ground;
          if (p.kind === "chip" && !p.bounced && Math.abs(p.vy) > 0.7) {
            p.bounced = true;
            p.vy = Math.abs(p.vy) * 0.28;
            p.vx *= 0.58;
            p.vz *= 0.58;
          } else {
            p.vy = Math.max(0, p.vy);
            p.vx *= 0.75;
            p.vz *= 0.75;
          }
        }
      }
    }
    function drawTreeParticles(arr) {
      for (let i = 0; i < treeParticles.length; i++) {
        const p = treeParticles[i];
        const u = Math.min(1, p.age / p.life);
        const fade = p.kind === "dust"
          ? Math.max(0.42, 1 - u * 0.62)
          : Math.max(0.16, 1 - u * 0.82);
        const rgb = [p.r * fade, p.g * fade, p.b * fade];
        if (p.kind === "dust") {
          // Two soft radial cards form a translucent expanding dust puff.
          const s = p.size * (0.58 + u * 1.95);
          const spin = p.rot + p.spin * p.age;
          buildPushDustQuad(arr, p.x, p.y, p.z, s, spin, rgb);
          buildPushDustQuad(arr, p.x, p.y, p.z, s * 0.88, spin + Math.PI * 0.5, rgb);
        } else {
          // Two crossed tapered triangles read as thin, pointed wood splinters.
          const dl = Math.hypot(p.ox, p.oy, p.oz) || 1;
          const dx = p.ox / dl;
          const dy = p.oy / dl;
          const dz = p.oz / dl;
          let sx = -dz, sy = 0, sz = dx;
          let sl = Math.hypot(sx, sy, sz);
          if (sl < 0.01) { sx = 1; sy = 0; sz = 0; sl = 1; }
          sx /= sl; sy /= sl; sz /= sl;
          const tx = dy * sz - dz * sy;
          const ty = dz * sx - dx * sz;
          const tz = dx * sy - dy * sx;
          const spin = p.rot + p.spin * p.age;
          const cs = Math.cos(spin);
          const sn = Math.sin(spin);
          const rx = sx * cs + tx * sn;
          const ry = sy * cs + ty * sn;
          const rz = sz * cs + tz * sn;
          const qx = tx * cs - sx * sn;
          const qy = ty * cs - sy * sn;
          const qz = tz * cs - sz * sn;
          const length = p.size * p.long;
          const width = p.size * (0.38 + u * 0.08);
          const tipX = p.x + dx * length;
          const tipY = p.y + dy * length;
          const tipZ = p.z + dz * length;
          const baseX = p.x - dx * length * 0.38;
          const baseY = p.y - dy * length * 0.38;
          const baseZ = p.z - dz * length * 0.38;
          buildPushTri(
            arr,
            tipX, tipY, tipZ,
            baseX + rx * width, baseY + ry * width, baseZ + rz * width,
            baseX - rx * width, baseY - ry * width, baseZ - rz * width,
            rgb
          );
          buildPushTri(
            arr,
            tipX, tipY, tipZ,
            baseX + qx * width * 0.7, baseY + qy * width * 0.7, baseZ + qz * width * 0.7,
            baseX - qx * width * 0.7, baseY - qy * width * 0.7, baseZ - qz * width * 0.7,
            rgb
          );
        }
      }
    }
    function spawnTreeFallDust(fall) {
      if (!fall) return;
      const count = Math.min(72, 42 + Math.round((fall.scale || 1) * 12));
      for (let i = 0; i < count; i++) {
        const along = 0.28 + Math.random() * 0.72;
        const cx = fall.x + fall.dirX * fall.fullH * along;
        const cz = fall.z + fall.dirZ * fall.fullH * along;
        const a = Math.random() * Math.PI * 2;
        const spread = 0.12 + Math.random() * (0.62 + (fall.scale || 1) * 0.24);
        const speed = 0.3 + Math.random() * 1.4;
        const warm = Math.random();
        treeParticles.push({
          kind: "dust",
          x: cx + Math.cos(a) * spread,
          y: (chunk ? sampleHeight(chunk, cx, cz) : fall.y) + 0.22 + Math.random() * 0.38,
          z: cz + Math.sin(a) * spread,
          vx: Math.cos(a) * speed + fall.dirX * 0.25,
          vy: 0.55 + Math.random() * 1.35,
          vz: Math.sin(a) * speed + fall.dirZ * 0.25,
          age: 0,
          life: 1.05 + Math.random() * 0.9,
          size: 0.12 + Math.random() * 0.18,
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() * 2 - 1) * 3.5,
          r: 0.36 + warm * 0.13,
          g: 0.27 + warm * 0.09,
          b: 0.15 + warm * 0.05,
        });
      }
    }
    function uploadFxMesh() {
      const arr = [];
      if (blastFx.length || rocketProjectiles.length || stickyCharges.length) drawBlastFxOverlay(arr);
      if (treeParticles.length) drawTreeParticles(arr);
      fxVertCount = (arr.length / 11) | 0;
      if (fxVbo) try { fxVbo.destroy(); } catch (_) {}
      if (fxVertCount > 0) {
        fxVbo = device.createBuffer({
          size: arr.length * 4,
          usage: GPUBufferUsage.VERTEX,
          mappedAtCreation: true,
        });
        new Float32Array(fxVbo.getMappedRange()).set(arr);
        fxVbo.unmap();
      } else {
        fxVbo = null;
      }
    }

    const UPGRADE_SIZE_GROUP = {
      foundation: "large", roof: "large", ramp: "large", stairs: "large",
      floor: "large", wall: "large", doorway: "large", window: "large",
      wall_frame: "large", floor_frame: "large", stairs_l: "large", stairs_u: "large",
      foundation_tri: "medium", roof_tri: "medium", roof_ridge: "medium", wall_half: "medium",
      floor_tri: "small", wall_low: "small", pillar: "small", floor_steps: "small",
    };
    const UPGRADE_COSTS = {
      large: [
        null,
        { id: "wood", qty: 200 },
        { id: "stone", qty: 300 },
        { id: "metal", qty: 200 },
        { id: "hq", qty: 25 },
      ],
      medium: [
        null,
        { id: "wood", qty: 100 },
        { id: "stone", qty: 150 },
        { id: "metal", qty: 100 },
        { id: "hq", qty: 13 },
      ],
      small: [
        null,
        { id: "wood", qty: 50 },
        { id: "stone", qty: 75 },
        { id: "metal", qty: 50 },
        { id: "hq", qty: 7 },
      ],
    };

    function upgradeCostFor(pieceType, nextTier) {
      const group = UPGRADE_SIZE_GROUP[pieceType] || "large";
      const cost = UPGRADE_COSTS[group] && UPGRADE_COSTS[group][nextTier];
      return cost ? { id: cost.id, qty: cost.qty } : null;
    }

    function repairResForTier(tier) {
      const t = tier | 0;
      if (t <= 1) return "wood";
      if (t === 2) return "stone";
      if (t === 3) return "metal";
      return "hq";
    }

    /** World nodes / barrels — never hammer-upgrade. */
    function isWorldLootProp(type) {
      return type === "world_ore" || type === "world_tree" || type === "scrap_barrel";
    }

    /** Furniture / deployables: demolish+repair ok, no material tier ladder. */
    function isFurnitureDeployable(type) {
      return type === "toolcupboard" || type === "workbench" || type === "research_table"
        || type === "campfire" || type === "sleeping_bag"
        || type === "box_small" || type === "box_large";
    }

    /** Walls/floors/foundations/doors/ramps/roofs — Rust-style upgrade path. */
    function isStructureUpgradeable(type) {
      if (!type || isWorldLootProp(type) || isFurnitureDeployable(type)) return false;
      return true;
    }

    function hammerPrivilegeOnPiece(piece) {
      ensurePieceInternals(piece);
      const c = pieceWorldCenter(piece);
      return privilegeCheck(c.x, c.z);
    }

    function upgradePiece(piece) {
      ensurePieceInternals(piece);
      if (!isStructureUpgradeable(piece.type)) {
        onHud({ status: "No se mejora · solo estructura / puerta" });
        return false;
      }
      const priv = hammerPrivilegeOnPiece(piece);
      if (!priv.ok) {
        onHud({ status: priv.reason || "Armario de otro jugador cerca" });
        return false;
      }
      if ((piece.tier | 0) >= BUILD_TIERS.length - 1) {
        onHud({ status: "Ya blindado" });
        return false;
      }
      const next = (piece.tier | 0) + 1;
      const cost = upgradeCostFor(piece.type, next);
      if (!cost) {
        onHud({ status: "Ya blindado" });
        return false;
      }
      if (!invConsume(cost.id, cost.qty)) {
        onHud({ status: "Sin " + cost.id + " · ×" + cost.qty + " para " + BUILD_TIERS[next].label });
        return false;
      }
      const ratio = piece.maxHp > 0 ? piece.hp / piece.maxHp : 1;
      piece.tier = next;
      piece.maxHp = tierMaxHp(next);
      piece.hp = Math.max(1, Math.ceil(piece.maxHp * Math.max(0.15, ratio)));
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      notifyWorldPlace(piece);
      try { playBuildPlace("upgrade"); } catch (_) {}
      onHud({ status: "Upgrade · " + BUILD_TIERS[next].label + " · " + piece.maxHp + " HP" });
      return true;
    }

    function repairPiece(piece) {
      ensurePieceInternals(piece);
      if (isWorldLootProp(piece.type)) {
        onHud({ status: "No se repara" });
        return false;
      }
      const priv = hammerPrivilegeOnPiece(piece);
      if (!priv.ok) {
        onHud({ status: priv.reason || "Armario de otro jugador cerca" });
        return false;
      }
      if (piece.hp >= piece.maxHp) {
        onHud({ status: "Intacta" });
        return false;
      }
      const miss = piece.maxHp - piece.hp;
      const cost = Math.max(1, Math.ceil(miss * 0.05 * ((piece.tier | 0) + 1)));
      const resId = repairResForTier(piece.tier);
      if (!invConsume(resId, cost)) {
        onHud({ status: "Sin " + resId + " · repair ×" + cost });
        return false;
      }
      piece.hp = piece.maxHp;
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      notifyWorldPlace(piece);
      try { playBuildPlace("repair"); } catch (_) {}
      onHud({ status: "Reparada · " + piece.maxHp + " HP" });
      return true;
    }

    // --- Decay / upkeep ---------------------------------------------------------
    function piecesInTc(tc) {
      const out = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        const c = pieceWorldCenter(p);
        if (tcCovers(tc, c.x, c.z)) out.push(p);
      }
      return out;
    }

    function dailyUpkeepFor(pieces) {
      const struct = [];
      for (let i = 0; i < pieces.length; i++) {
        if (isUpkeepPiece(pieces[i])) struct.push(pieces[i]);
      }
      const rate = upkeepTaxRate(struct.length);
      const daily = { wood: 0, stone: 0, metal: 0, hq: 0, pieces: struct.length, rate: rate };
      for (let i = 0; i < struct.length; i++) {
        const cost = pieceUpkeepCost(struct[i]);
        if (cost && daily[cost.id] != null) daily[cost.id] += cost.qty * rate;
      }
      return daily;
    }

    function isExposedWall(p) {
      if (!isWallType(p.type) || p.type === "roof_wall") return false;
      // Exposed if no floor/roof on the hard-side neighbor cell
      const n = wallHardNormal(p);
      const nix = p.ix + Math.round(n.x);
      const niz = p.iz + Math.round(n.z);
      for (let i = 0; i < buildPieces.length; i++) {
        const q = buildPieces[i];
        if (q.ix === nix && q.iz === niz && q.iy === p.iy && (isFloorType(q.type) || isFoundationType(q.type))) {
          return false;
        }
      }
      return true;
    }

    function tickDecay(dt) {
      decayAcc += dt;
      if (decayAcc < DECAY_TICK_SEC) return;
      decayAcc = 0;
      const tcs = listToolCupboards();
      const covered = new Set();
      for (let t = 0; t < tcs.length; t++) {
        const tc = ensurePieceInternals(tcs[t]);
        const pcs = piecesInTc(tc);
        for (let i = 0; i < pcs.length; i++) covered.add(pcs[i].id);
        const daily = dailyUpkeepFor(pcs);
        const unpaid = tcConsumeUpkeep(tc, daily);
        const unpaidKeys = Object.keys(unpaid);
        if (unpaidKeys.length) {
          let hit = 0;
          for (let i = 0; i < pcs.length; i++) {
            const p = pcs[i];
            if (!isUpkeepPiece(p)) continue;
            if (pieceInDecayGrace(p)) continue;
            const cost = pieceUpkeepCost(p);
            if (!cost || !unpaid[cost.id]) continue;
            ensurePieceInternals(p);
            const tier = Math.max(0, Math.min(DECAY_FULL_SEC.length - 1, p.tier | 0));
            const fullSec = DECAY_FULL_SEC[tier] || DECAY_FULL_SEC[0];
            const dmg = Math.max(0.05, (p.maxHp || 50) * DECAY_TICK_SEC / fullSec);
            p.hp -= dmg;
            hit++;
            if (p.hp <= 0) {
              const idx = buildPieces.indexOf(p);
              if (idx >= 0) buildPieces.splice(idx, 1);
            } else invalidatePieceMesh(p);
          }
          if (hit) {
            recalculateStability();
            rebuildBuildMesh();
            onHud({ status: "Decay · TC sin upkeep · " + unpaidKeys.join("/") });
          }
        }
        if (activeTcId === tc.id) refreshTcPanel();
      }
      // Wilderness decay (no TC cover) — full time by material tier
      let wildRemoved = false;
      let wildDamaged = false;
      for (let i = buildPieces.length - 1; i >= 0; i--) {
        const p = buildPieces[i];
        if (covered.has(p.id)) continue;
        if (!isUpkeepPiece(p)) continue;
        if (pieceInDecayGrace(p)) continue;
        ensurePieceInternals(p);
        const tier = Math.max(0, Math.min(DECAY_FULL_SEC.length - 1, p.tier | 0));
        const fullSec = DECAY_FULL_SEC[tier] || DECAY_FULL_SEC[0];
        const dmg = Math.max(0.05, (p.maxHp || 50) * DECAY_TICK_SEC / fullSec);
        p.hp -= dmg;
        if (p.hp <= 0) {
          buildPieces.splice(i, 1);
          wildRemoved = true;
        } else {
          wildDamaged = true;
          invalidatePieceMesh(p);
        }
      }
      if (wildRemoved || wildDamaged) {
        recalculateStability();
        rebuildBuildMesh();
        if (wildRemoved) onHud({ status: "Decay · sin TC · piezas sin protección" });
      }
    }

    // --- UI: stability HUD + TC panel ------------------------------------------
    function ensureStabHud() {
      if (stabHudEl || typeof document === "undefined") return;
      stabHudEl = document.createElement("div");
      stabHudEl.id = "fw-build-stab";
      stabHudEl.className = "fw-build-stab";
      const stage = document.querySelector(".stage") || document.body;
      stage.appendChild(stabHudEl);
    }

    function updateStabHud(text, ok) {
      ensureStabHud();
      if (!stabHudEl) return;
      if ((!buildMode && !deployMode) || !text) {
        stabHudEl.classList.remove("is-on");
        return;
      }
      stabHudEl.classList.add("is-on");
      stabHudEl.classList.toggle("is-bad", !ok);
      stabHudEl.textContent = text;
    }

    function demolishSecsLeft(piece) {
      if (!piece || !piece.placedAt) return 0;
      const left = DEMOLISH_GRACE_MS - (performance.now() - piece.placedAt);
      return left > 0 ? left / 1000 : 0;
    }

    function canHammerDemolish(piece) {
      if (!piece || !heldIsHammer()) return { ok: false, reason: "Equipa el Martillo" };
      ensurePieceInternals(piece);
      if (piece.ownerId && piece.ownerId !== LOCAL_PLAYER_ID) {
        return { ok: false, reason: "No es tuya" };
      }
      const priv = privilegeCheck(pieceWorldCenter(piece).x, pieceWorldCenter(piece).z);
      if (!priv.ok) return { ok: false, reason: priv.reason || "sin privilege" };
      const secs = demolishSecsLeft(piece);
      if (secs <= 0) {
        return { ok: false, reason: "ya fija · solo mejora/reparar", locked: true };
      }
      if (pieceHasDependents(piece)) {
        return { ok: false, reason: "sostiene otras piezas" };
      }
      return { ok: true, secs: secs };
    }

    function refundDemolishedPiece(piece) {
      const t = piece.type;
      if (t === "toolcupboard") return invAdd("tool_cupboard_item", 1);
      if (t === "workbench") {
        return invAdd(workbenchItemId(piece.wbTier), 1);
      }
      if (t === "research_table") return invAdd("research_table", 1);
      if (t === "campfire") return invAdd("campfire", 1);
      if (t === "sleeping_bag") return invAdd("sleeping_bag", 1);
      if (t === "box_small" || t === "box_large") return invAdd(t, 1);
      if (t === "door" && (piece.tier | 0) >= 3) return invAdd("metal_door", 1);
      const meta = BUILD_BY_ID[t];
      const cost = meta && meta.cost != null ? meta.cost : 25;
      if (cost > 0) invAdd("wood", cost);
      return cost;
    }

    function demolishPiece(piece) {
      const check = canHammerDemolish(piece);
      if (!check.ok) {
        onHud({ status: "Martillo · " + check.reason });
        return false;
      }
      const idx = buildPieces.indexOf(piece);
      if (idx < 0) return false;
      const label = BUILD_LABELS[piece.type] || piece.type;
      const removedId = piece.id;
      refundDemolishedPiece(piece);
      buildPieces.splice(idx, 1);
      recalculateStability();
      rebuildBuildMesh();
      closeUpgradeMenu();
      playBuildPlace("remove");
      player.attackPulse = true;
      notifyWorldRemove(removedId);
      onHud({ status: "Demolido · " + label + " · recursos devueltos" });
      return true;
    }

    function tryHammerDemolishAimed() {
      if (!heldIsHammer()) return false;
      const ray = camBuildRay();
      if (!ray) {
        onHud({ status: "Martillo · mira una pieza" });
        return false;
      }
      const hit = rayHitBuilds(ray.o, ray.d);
      if (!hit) {
        onHud({ status: "Martillo · sin pieza a la vista" });
        return false;
      }
      // Skip world props
      const t = hit.piece.type;
      if (t === "world_ore" || t === "world_tree" || t === "scrap_barrel") return false;
      return demolishPiece(hit.piece);
    }

    function ensureUpgradeMenu() {
      if (upgradeMenuEl || typeof document === "undefined") return;
      upgradeMenuEl = document.createElement("div");
      upgradeMenuEl.id = "fw-upgrade-menu";
      upgradeMenuEl.className = "fw-upgrade-menu";
      upgradeMenuEl.innerHTML =
        '<div class="fw-up-head">MARTILLO</div>' +
        '<div class="fw-up-piece"></div>' +
        '<div class="fw-up-tier"></div>' +
        '<div class="fw-up-cost"></div>' +
        '<div class="fw-up-grace"></div>' +
        '<div class="fw-up-actions">' +
        '  <button type="button" data-act="demolish"><kbd>X</kbd> Demoler</button>' +
        '  <button type="button" data-act="upgrade"><kbd>M</kbd> Mejorar</button>' +
        '  <button type="button" data-act="repair"><kbd>R</kbd> Reparar</button>' +
        '  <button type="button" data-act="flip"><kbd>Y</kbd> Soft/Hard</button>' +
        '  <button type="button" data-act="close"><kbd>Esc</kbd> Cerrar</button>' +
        "</div>";
      upgradeMenuEl.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-act]");
        if (!btn) return;
        runUpgradeMenuAct(btn.getAttribute("data-act"));
      });
      (document.querySelector(".stage") || document.body).appendChild(upgradeMenuEl);
    }

    function runUpgradeMenuAct(act) {
      if (!act) return false;
      if (act === "close") { closeUpgradeMenu(); return true; }
      const piece = buildPieces.find((p) => p.id === upgradeTargetId);
      if (!piece) { closeUpgradeMenu(); return true; }
      if (act === "demolish") { demolishPiece(piece); return true; }
      if (act === "upgrade") { upgradePiece(piece); refreshUpgradeMenu(); return true; }
      if (act === "repair") { repairPiece(piece); refreshUpgradeMenu(); return true; }
      if (act === "flip") {
        if (!isWallType(piece.type)) {
          onHud({ status: "Solo paredes tienen soft/hard" });
          return true;
        }
        flipWallSoftSide(piece);
        refreshUpgradeMenu();
        return true;
      }
      return false;
    }

    function refreshUpgradeMenu() {
      if (!upgradeMenuEl) return;
      const piece = buildPieces.find((p) => p.id === upgradeTargetId);
      if (!piece) { closeUpgradeMenu(); return; }
      ensurePieceInternals(piece);
      const tier = piece.tier | 0;
      const next = tier + 1;
      const curLabel = BUILD_TIERS[tier] ? BUILD_TIERS[tier].label : "?";
      const upgradable = isStructureUpgradeable(piece.type);
      const graceEl = upgradeMenuEl.querySelector(".fw-up-grace");
      const demoBtn = upgradeMenuEl.querySelector('[data-act="demolish"]');
      const upBtn = upgradeMenuEl.querySelector('[data-act="upgrade"]');
      const repBtn = upgradeMenuEl.querySelector('[data-act="repair"]');
      const flipBtn = upgradeMenuEl.querySelector('[data-act="flip"]');
      const secs = demolishSecsLeft(piece);
      const canDemo = canHammerDemolish(piece);
      if (graceEl) {
        if (secs > 0) {
          graceEl.textContent = "Demoler libre · " + Math.ceil(secs) + "s";
          graceEl.classList.remove("is-locked");
        } else {
          graceEl.textContent = "Pieza fija · ya no se demuele";
          graceEl.classList.add("is-locked");
        }
      }
      if (demoBtn) {
        demoBtn.disabled = !canDemo.ok;
        demoBtn.title = canDemo.ok ? ("Quedan " + Math.ceil(secs) + "s") : (canDemo.reason || "");
      }
      const pieceEl = upgradeMenuEl.querySelector(".fw-up-piece");
      const tierEl = upgradeMenuEl.querySelector(".fw-up-tier");
      const costEl = upgradeMenuEl.querySelector(".fw-up-cost");
      if (pieceEl) {
        let softTxt = "";
        if (isWallType(piece.type)) {
          softTxt = piece.softInward !== false
            ? " · soft interior"
            : " · soft exterior";
        }
        pieceEl.textContent = (BUILD_LABELS[piece.type] || piece.type)
          + " · " + Math.ceil(piece.hp) + "/" + piece.maxHp + " HP" + softTxt;
      }
      if (tierEl) {
        if (!upgradable) {
          tierEl.textContent = "Sin tier de material · solo demoler / reparar";
        } else if (next >= BUILD_TIERS.length) {
          tierEl.textContent = "Tier · " + curLabel + " (máximo)";
        } else {
          tierEl.textContent = "Tier · " + curLabel + " → " + BUILD_TIERS[next].label
            + " (" + tierMaxHp(next) + " HP)";
        }
      }
      if (costEl) {
        if (!upgradable) {
          costEl.textContent = "No mejora";
          costEl.classList.remove("is-short");
        } else if (next >= BUILD_TIERS.length) {
          costEl.textContent = "Sin más mejoras";
          costEl.classList.remove("is-short");
        } else {
          const cost = upgradeCostFor(piece.type, next);
          if (!cost) {
            costEl.textContent = "Sin más mejoras";
            costEl.classList.remove("is-short");
          } else {
            const have = invCount(cost.id);
            costEl.textContent = "Coste · " + cost.qty + " " + cost.id + " (tienes " + have + ")";
            costEl.classList.toggle("is-short", have < cost.qty);
          }
        }
      }
      if (upBtn) {
        const maxed = next >= BUILD_TIERS.length;
        upBtn.disabled = !upgradable || maxed;
        upBtn.title = !upgradable ? "Solo estructura / puerta" : (maxed ? "Máximo" : "Mejorar (M)");
      }
      if (repBtn) {
        const full = piece.hp >= piece.maxHp;
        repBtn.disabled = full;
        repBtn.title = full ? "Intacta" : "Reparar (R)";
      }
      if (flipBtn) {
        const isWall = isWallType(piece.type);
        flipBtn.disabled = !isWall;
        flipBtn.style.display = isWall ? "" : "none";
        flipBtn.title = isWall
          ? ("Soft · " + (piece.softInward !== false ? "interior" : "exterior") + " · Y voltea")
          : "Solo paredes";
      }
    }

    function openUpgradeMenu(piece) {
      if (!heldIsHammer()) {
        onHud({ status: "Equipa el Martillo" });
        return false;
      }
      if (!piece || isWorldLootProp(piece.type)) {
        onHud({ status: "Martillo · sin pieza a la vista" });
        return false;
      }
      ensurePieceInternals(piece);
      ensureUpgradeMenu();
      upgradeTargetId = piece.id;
      upgradeMenuOpen = true;
      upgradeMenuEl.classList.add("is-open");
      refreshUpgradeMenu();
      onHud({ status: "Martillo · X demoler · M mejorar · R reparar · Y soft/hard · Esc cierra" });
      // clearLocoKeys is hoisted in this scope — RMB often swallows keyup
      try { clearLocoKeys(); } catch (_) {}
      try { syncCursorForUi(); } catch (_) {}
      return true;
    }

    function closeUpgradeMenu() {
      const wasOpen = upgradeMenuOpen;
      upgradeTargetId = null;
      upgradeMenuOpen = false;
      if (upgradeMenuEl) upgradeMenuEl.classList.remove("is-open");
      if (wasOpen) {
        try { clearLocoKeys(); } catch (_) {}
        try { syncCursorForUi(); } catch (_) {}
      }
    }

    function isUpgradeMenuOpen() {
      return !!upgradeMenuOpen;
    }

    function openUpgradeMenuAimed() {
      const ray = camBuildRay();
      if (!ray) {
        onHud({ status: "Martillo · mira una pieza" });
        return false;
      }
      const hit = rayHitBuilds(ray.o, ray.d);
      if (!hit || isWorldLootProp(hit.piece.type)) {
        onHud({ status: "Martillo · sin pieza a la vista" });
        return false;
      }
      return openUpgradeMenu(hit.piece);
    }

    function tryHammerRepairAimed() {
      if (!heldIsHammer()) return false;
      const ray = camBuildRay();
      if (!ray) return false;
      const hit = rayHitBuilds(ray.o, ray.d);
      if (!hit) return false;
      return repairPiece(hit.piece);
    }

    function ensureTcPanel() {
      if (tcPanelEl || typeof document === "undefined") return;
      tcPanelEl = document.createElement("div");
      tcPanelEl.id = "fw-tc-panel";
      tcPanelEl.className = "fw-tc-panel fw-tc-inv";
      tcPanelEl.innerHTML =
        '<div class="fw-tc-head">ARMARIO DE HERRAMIENTAS</div>' +
        '<div class="fw-tc-sub">Privilegio 25 m · cilindro ~5 pisos · upkeep diario</div>' +
        '<div class="fw-tc-inv-label">Inventario del TC</div>' +
        '<div class="fw-tc-slots" id="fw-tc-slots"></div>' +
        '<div class="fw-tc-upkeep"></div>' +
        '<div class="fw-tc-inv-label">Autorización</div>' +
        '<div class="fw-tc-actions fw-tc-auth">' +
        '  <button type="button" data-act="auth">Autorizarse</button>' +
        '  <button type="button" data-act="clear">Limpiar lista</button>' +
        "</div>" +
        '<div class="fw-tc-inv-label">Depositar</div>' +
        '<div class="fw-tc-actions">' +
        '  <button type="button" data-act="dep-wood">+50 Madera</button>' +
        '  <button type="button" data-act="dep-stone">+50 Piedra</button>' +
        '  <button type="button" data-act="dep-metal">+20 Metal</button>' +
        '  <button type="button" data-act="dep-hq">+10 HQM</button>' +
        '  <button type="button" data-act="close">Cerrar · Esc</button>' +
        "</div>";
      tcPanelEl.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-act]");
        if (btn) {
          const act = btn.getAttribute("data-act");
          if (act === "close") { closeTcPanel(); return; }
          const tc = buildPieces.find((p) => p.id === activeTcId);
          if (!tc) return;
          ensurePieceInternals(tc);
          if (act === "auth") {
            if (!tc.auth) tc.auth = [];
            if (tc.auth.indexOf(LOCAL_PLAYER_ID) < 0) {
              tc.auth.push(LOCAL_PLAYER_ID);
              onHud({ status: "Autorizado · Building Privilege activo" });
            } else {
              onHud({ status: "Ya autorizado en este TC" });
            }
            notifyWorldPlace(tc);
            refreshTcPanel();
            return;
          }
          if (act === "clear") {
            if (!isAuthorizedOnTc(tc, LOCAL_PLAYER_ID)) {
              onHud({ status: "Sin privilegio · autoriza primero" });
              return;
            }
            tc.auth = [];
            onHud({ status: "Lista limpiada · vuelve a autorizarte" });
            notifyWorldPlace(tc);
            refreshTcPanel();
            return;
          }
          if (!isAuthorizedOnTc(tc, LOCAL_PLAYER_ID)) {
            onHud({ status: "Sin privilegio · pulsa Autorizarse" });
            return;
          }
          const map = {
            "dep-wood": ["wood", 50],
            "dep-stone": ["stone", 50],
            "dep-metal": ["metal", 20],
            "dep-hq": ["hq", 10],
          };
          const spec = map[act];
          if (!spec) return;
          if (!invConsume(spec[0], spec[1])) {
            onHud({ status: "Sin " + spec[0] + " en inventario" });
            return;
          }
          let put = false;
          for (let i = 0; i < 4; i++) {
            const s = tc.slots[i];
            if (s && s.id === spec[0]) {
              s.qty += spec[1];
              put = true;
              break;
            }
          }
          if (!put) {
            for (let i = 0; i < 4; i++) {
              if (!tc.slots[i]) {
                tc.slots[i] = { id: spec[0], qty: spec[1] };
                put = true;
                break;
              }
            }
          }
          if (!put) {
            invAdd(spec[0], spec[1]);
            onHud({ status: "TC lleno (4 slots)" });
          }
          syncTcInvFromSlots(tc);
          refreshTcPanel();
          return;
        }
        // Click slot → withdraw to player inv
        const slot = ev.target.closest("[data-slot]");
        if (!slot) return;
        const tc = buildPieces.find((p) => p.id === activeTcId);
        if (!tc) return;
        ensurePieceInternals(tc);
        if (!isAuthorizedOnTc(tc, LOCAL_PLAYER_ID)) {
          onHud({ status: "Sin privilegio · pulsa Autorizarse" });
          return;
        }
        const idx = Number(slot.getAttribute("data-slot"));
        const s = tc.slots[idx];
        if (!s) return;
        invAdd(s.id, s.qty);
        tc.slots[idx] = null;
        syncTcInvFromSlots(tc);
        refreshTcPanel();
      });
      const stage = document.querySelector(".stage") || document.body;
      stage.appendChild(tcPanelEl);
    }

    function refreshTcPanel() {
      if (!tcPanelEl) return;
      const tc = buildPieces.find((p) => p.id === activeTcId);
      if (!tc) { closeTcPanel(); return; }
      ensurePieceInternals(tc);
      const grid = tcPanelEl.querySelector("#fw-tc-slots");
      if (grid) {
        grid.innerHTML = "";
        const labels = { wood: "Madera", stone: "Piedra", metal: "Metal", hq: "HQM" };
        for (let i = 0; i < 4; i++) {
          const s = tc.slots[i];
          const el = document.createElement("button");
          el.type = "button";
          el.className = "fw-tc-slot" + (s ? " has-item" : "");
          el.setAttribute("data-slot", String(i));
          if (s) {
            el.innerHTML =
              '<span class="fw-tc-slot-id">' + (labels[s.id] || s.id) + "</span>" +
              '<span class="fw-tc-slot-qty">×' + s.qty + "</span>";
          } else {
            el.innerHTML = '<span class="fw-tc-slot-empty">vacío</span>';
          }
          grid.appendChild(el);
        }
      }
      const pcs = piecesInTc(tc);
      const daily = dailyUpkeepFor(pcs);
      const up = tcPanelEl.querySelector(".fw-tc-upkeep");
      if (up) {
        syncTcInvFromSlots(tc);
        const days = tcProtectedDays(tc, daily);
        const pct = Math.round((daily.rate || 0.1) * 100);
        const authN = (tc.auth && tc.auth.length) || 0;
        const authed = isAuthorizedOnTc(tc, LOCAL_PLAYER_ID);
        up.textContent = "Impuesto " + pct + "% · " + daily.pieces + " bloques · "
          + "W" + Math.ceil(daily.wood) + " S" + Math.ceil(daily.stone)
          + " M" + Math.ceil(daily.metal) + " H" + Math.ceil(daily.hq) + "/día · "
          + "reserva " + formatUpkeepReserve(days)
          + " · auth " + authN + (authed ? " · tú OK" : " · sin privilegio");
      }
    }

    function openTcPanel(tc) {
      ensureTcPanel();
      ensurePieceInternals(tc);
      activeTcId = tc.id;
      tcPanelEl.classList.add("is-open");
      playUiSfx("panel_open");
      try { syncCursorForUi(); } catch (_) {}
      refreshTcPanel();
      const authed = isAuthorizedOnTc(tc, LOCAL_PLAYER_ID);
      onHud({
        status: authed
          ? "TC abierto · deposita upkeep · Esc cierra"
          : "TC · pulsa Autorizarse para Building Privilege",
      });
    }
    function closeTcPanel() {
      if (activeTcId) playUiSfx("panel_close");
      activeTcId = null;
      if (tcPanelEl) tcPanelEl.classList.remove("is-open");
      try { syncCursorForUi(); } catch (_) {}
    }

    // --- Enhanced validate / place / remove -------------------------------------
    const __validateBuild = validateBuild;
    validateBuild = function (cell) {
      const type = cell.type;
      const ix = cell.ix, iz = cell.iz, iy = cell.iy;
      const cx = (ix + 0.5) * BUILD_CELL;
      const cz = (iz + 0.5) * BUILD_CELL;

      // Privilege (TC / workbench / world props ignore enemy TC for placement)
      const DEPLOY_FREE = {
        toolcupboard: 1, workbench: 1, research_table: 1, scrap_barrel: 1,
        world_ore: 1, world_tree: 1,
        campfire: 1, sleeping_bag: 1, box_small: 1, box_large: 1,
      };
      if (!DEPLOY_FREE[type]) {
        const priv = privilegeCheck(cx, cz);
        if (!priv.ok) return { ok: false, reason: priv.reason };
      }
      if (isFurnitureDeploy(type)) {
        if (type === "toolcupboard" && tcOverlapBlocked(ix, iz, null)) {
          return { ok: false, reason: "TC solapado (25 m)" };
        }
        // Sleeping bag: free ground placement (any dry soil), footprint-only blockers
        if (type === "sleeping_bag") {
          const bagCx = cx + (cell._ox || 0);
          const bagCz = cz + (cell._oz || 0);
          const deck = findDeck(ix, iz, iy);
          if (deck) {
            cell.baseY = deck.baseY;
            cell.iy = deck.iy;
          } else if (iy === 0 && chunk) {
            const blocked = sleepingBagGroundReason(bagCx, bagCz);
            if (blocked) return { ok: false, reason: blocked };
            cell.baseY = sampleHeight(chunk, bagCx, bagCz);
          } else {
            return { ok: false, reason: "necesita piso o suelo" };
          }
          if (furnitureFootprintBlocked(cell)) {
            return { ok: false, reason: "espacio ocupado" };
          }
          if (deployClipsWalls(cell)) {
            return { ok: false, reason: "atraviesa una pared" };
          }
          return { ok: true, reason: "Respawn" };
        }
        // Workbench / research / TC / large box: Rust-like — only on foundation or floor
        const needsStructure = type === "workbench" || type === "research_table"
          || type === "toolcupboard" || type === "box_large";
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
          cell.iy = deck.iy;
        } else if (needsStructure) {
          return { ok: false, reason: "necesita cimiento o piso" };
        } else if (iy === 0 && chunk) {
          const blocked = groundBlockedReason(ix, iz);
          if (blocked) return { ok: false, reason: blocked };
          cell.baseY = sampleHeight(chunk, cx + (cell._ox || 0), cz + (cell._oz || 0));
        } else {
          return { ok: false, reason: "necesita piso o suelo" };
        }
        if (furnitureFootprintBlocked(cell)) {
          return { ok: false, reason: "choca con otro objeto" };
        }
        if (deployClipsWalls(cell)) {
          return { ok: false, reason: "atraviesa una pared" };
        }
      }

      // Foundations: terrain contact + height cap + optional side socket
      if (isFoundationType(type) && iy <= 0) {
        const blocked = groundBlockedReason(ix, iz);
        if (blocked) return { ok: false, reason: blocked };
        if (!chunk) return { ok: false, reason: "sin terreno" };
        const gy = sampleHeight(chunk, cx, cz);
        const base = cell.baseY != null ? cell.baseY : gy;
        if ((base + BUILD_FOUND_H) - gy > FOUND_MAX_ABOVE_TERRAIN) {
          return { ok: false, reason: "muy alto del suelo" };
        }
      }

      // Door leaf: sits inside an existing doorway — not a competing wall slab
      if (type === "door") {
        const doorV = validateDoorIntoFrame(cell);
        if (!doorV.ok) return doorV;
      } else if (isWallType(type) && type !== "roof_wall") {
        // Walls: require foundation/floor (stilts come with the deck)
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (!deck) return { ok: false, reason: "necesita cimiento o piso" };
        cell.baseY = deck.baseY;
      }

      const base = __validateBuild(cell);
      if (!base.ok) return base;

      // Stability preview — reject if would be ~0
      if (type === "toolcupboard") return { ok: true, reason: "TC · radio 25 m" };
      if (type === "workbench") return { ok: true, reason: "Mesa · craft <2 m" };
      if (type === "research_table") return { ok: true, reason: "Investigación · E" };
      if (type === "campfire") return { ok: true, reason: "Calor 4 m" };
      if (type === "sleeping_bag") return { ok: true, reason: "Respawn" };
      if (type === "box_small" || type === "box_large") return { ok: true, reason: "Almacén" };
      if (type === "scrap_barrel") return { ok: true, reason: "" };
      if (type === "door") return { ok: true, reason: "E abre/cierra" };
      {
        const stab = previewStability(cell);
        cell._stabPreview = stab;
        if (stab < STAB_MIN) return { ok: false, reason: "estabilidad 0%" };
        if (stab < 25) return { ok: true, reason: "estab. " + Math.round(stab) + "% débil" };
        return { ok: true, reason: "estab. " + Math.round(stab) + "%" };
      }
    };

    function clearDeployIfEmpty(itemId) {
      if (invCount(itemId) >= 1) {
        makeGhostFromRay();
        return;
      }
      deployMode = null;
      ghostCell = null;
      ghostOk = false;
      uploadGhostMesh(null, false);
      updateStabHud("", false);
      try {
        const inv = window.__fw && window.__fw.inv;
        if (inv && typeof inv.getActive === "function") setHeldItem(inv.getActive());
      } catch (_) {}
    }

    const __tryPlaceGhost = tryPlaceGhost;
    tryPlaceGhost = function () {
      if ((!buildMode && !deployMode) || !ghostCell) return false;
      if (!ghostOk) {
        try { playUiSfx("deny"); } catch (_) {}
        onHud({ status: "No coloca · " + (ghostReason || "espacio inválido") });
        return false;
      }
      if (buildTool !== "place" && buildTool !== "cupboard") return false;
      // Snapshot before invConsume — emptying the hotbar can clear ghostCell via setHeldItem
      const snap = {
        type: ghostCell.type,
        ix: ghostCell.ix,
        iy: ghostCell.iy,
        iz: ghostCell.iz,
        yaw: ghostCell.yaw,
        baseY: ghostCell.baseY,
        _ox: ghostCell._ox || 0,
        _oz: ghostCell._oz || 0,
        _placeWbTier: ghostCell._placeWbTier,
      };
      const placingTc = snap.type === "toolcupboard";
      const placingWb = snap.type === "workbench";
      const placingResearch = snap.type === "research_table";
      const placingMetalDoor = deployMode === "metal_door" && snap.type === "door";
      const placingCamp = snap.type === "campfire";
      const placingBag = snap.type === "sleeping_bag";
      const placingBox = snap.type === "box_small" || snap.type === "box_large";
      let consumeId = null;
      if (placingTc) consumeId = "tool_cupboard_item";
      else if (placingWb) {
        const wt = asWbTier(deployWbTier);
        consumeId = workbenchItemId(wt);
        snap._placeWbTier = wt;
      }
      else if (placingResearch) consumeId = "research_table";
      else if (placingMetalDoor) consumeId = "metal_door";
      else if (placingCamp) consumeId = "campfire";
      else if (placingBag) consumeId = "sleeping_bag";
      else if (placingBox) consumeId = snap.type;

      if (consumeId) {
        if (invCount(consumeId) < 1) {
          onHud({ status: "Sin " + consumeId });
          return false;
        }
        if (!invConsume(consumeId, 1)) {
          onHud({ status: "Sin " + consumeId });
          return false;
        }
      } else {
        if (!heldIsBuildPlan()) {
          onHud({ status: "Equipa el Plano en la hotbar" });
          return false;
        }
        const meta = BUILD_BY_ID[snap.type];
        const cost = meta && meta.cost != null ? meta.cost : 25;
        if (!invConsume("wood", cost)) {
          onHud({ status: "Sin madera · ×" + cost + " (mochila)" });
          return false;
        }
      }
      const placed = ensurePieceInternals({
        type: snap.type,
        ix: snap.ix,
        iy: snap.iy,
        iz: snap.iz,
        yaw: snap.yaw,
        baseY: snap.baseY,
        _ox: snap._ox || 0,
        _oz: snap._oz || 0,
        tier: placingMetalDoor ? 3 : (placingTc || placingWb ? 1 : 0),
        ownerId: LOCAL_PLAYER_ID,
        placedAt: performance.now(),
      });
      if (placingTc) {
        placed.slots = [null, null, null, null];
        placed.inv = { wood: 0, stone: 0, metal: 0, hq: 0 };
        placed.auth = [LOCAL_PLAYER_ID];
      }
      if (placingWb) {
        placed.wbTier = asWbTier(snap._placeWbTier || deployWbTier);
      }
      if (placingCamp) {
        placed.slots = [{ id: "wood", qty: 40 }, null];
        placed.lit = true;
      }
      if (placingBag) {
        const n = listSleepingBags().length + 1;
        placed.bagLabel = "Saco " + n;
        placed.ownerId = LOCAL_PLAYER_ID;
        try { playUiSfx("bag_claim"); } catch (_) {}
      }
      if (placingBox) {
        const n = snap.type === "box_large" ? 12 : 6;
        placed.slots = [];
        for (let i = 0; i < n; i++) placed.slots.push(null);
      }
      buildPieces.push(placed);
      rebuildCellIndex();
      recalculateStability();
      if (buildPieces.indexOf(placed) < 0) {
        if (consumeId) invAdd(consumeId, 1);
        else {
          const meta = BUILD_BY_ID[placed.type];
          invAdd("wood", meta && meta.cost != null ? meta.cost : 25);
        }
        onHud({ status: "Colapsó al colocar" });
        makeGhostFromRay();
        return false;
      }
      if (placed.type === "door") {
        placed.isOpen = false;
        placed.locked = false;
        placed.doorYaw = ((placed.yaw % 4) + 4) % 4;
      }
      rebuildBuildMesh();
      // Furniture / deployables get a distinctive drop SFX; twig builds keep hammer
      if (
        placingTc || placingWb || placingResearch || placingMetalDoor
        || placingCamp || placingBag || placingBox
      ) {
        playDeployPlace(placingMetalDoor ? "metal_door" : snap.type);
      } else {
        playBuildPlace("place");
      }
      // Sound only — no avatar swing / attack anim on build place
      if (placingTc) {
        onHud({ status: "Armario colocado · E para upkeep · radio 25 m" });
        clearDeployIfEmpty("tool_cupboard_item");
        notifyWorldPlace(placed);
        return true;
      }
      if (placingWb) {
        onHud({ status: "Mesa T" + asWbTier(placed.wbTier) + " · E abre Tech + ADV" });
        clearDeployIfEmpty("workbench_1");
        clearDeployIfEmpty("workbench_2");
        clearDeployIfEmpty("workbench_3");
        refreshWorkbenchProximity();
        notifyWorldPlace(placed);
        return true;
      }
      if (placingResearch) {
        onHud({ status: "Mesa investigación · E para investigar" });
        clearDeployIfEmpty("research_table");
        notifyWorldPlace(placed);
        return true;
      }
      if (placingCamp) {
        onHud({ status: "Fogata · calor 4 m · mete madera con E" });
        clearDeployIfEmpty("campfire");
        notifyWorldPlace(placed);
        return true;
      }
      if (placingBag) {
        onHud({ status: "Saco listo · respawn aquí al morir" });
        clearDeployIfEmpty("sleeping_bag");
        notifyWorldPlace(placed);
        return true;
      }
      if (placingBox) {
        onHud({ status: "Caja · E abre · dispersa el botín" });
        clearDeployIfEmpty(snap.type);
        notifyWorldPlace(placed);
        return true;
      }
      if (placingMetalDoor) {
        onHud({ status: "Puerta metal colocada · " + tierMaxHp(3) + " HP" });
        clearDeployIfEmpty("metal_door");
        notifyWorldPlace(placed);
        return true;
      }
      makeGhostFromRay();
      const st = Math.round(placed.stability || 0);
      onHud({
        status: "Build · " + BUILD_LABELS[placed.type]
          + " · " + st + "% · " + BUILD_TIERS[0].label
          + " · ×" + buildPieces.length,
      });
      notifyWorldPlace(placed);
      return true;
    };

    const __tryRemoveAimed = tryRemoveAimed;
    tryRemoveAimed = function () {
      if (!buildMode) return false;
      const ray = camBuildRay();
      if (!ray) return false;
      const hitB = rayHitBuilds(ray.o, ray.d);
      if (!hitB) return false;
      const priv = privilegeCheck(pieceWorldCenter(hitB.piece).x, pieceWorldCenter(hitB.piece).z);
      if (!priv.ok) {
        onHud({ status: "Privilege · no puedes demoler aquí" });
        return false;
      }
      if (pieceHasDependents(hitB.piece)) {
        onHud({ status: "Build · no quitar · sostiene otras piezas" });
        return false;
      }
      const removedId = hitB.piece.id;
      buildPieces.splice(hitB.index, 1);
      recalculateStability();
      rebuildBuildMesh();
      makeGhostFromRay();
      playBuildPlace("remove");
      notifyWorldRemove(removedId);
      onHud({ status: "Build · removido · " + buildPieces.length + " piezas" });
      return true;
    };

    /** Best wall/deck support for a ceiling (piso) or techo in a cell. */
    function ceilingSupportInCell(ix, iz) {
      let best = null;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.ix !== ix || p.iz !== iz) continue;
        if (isWallType(p.type) && p.type !== "roof_wall") {
          if (!best || p.iy >= best.iy) best = { iy: p.iy, baseY: p.baseY };
        } else if (isFoundationType(p.type) || isFloorType(p.type) || isRampType(p.type)) {
          if (!best || p.iy > best.iy) best = { iy: p.iy, baseY: p.baseY };
        }
      }
      return best;
    }

    /**
     * Snap piso/techo to the room ceiling: player's cell when looking up,
     * or wall_top socket — avoids the mid-torso aim ghost floating through walls.
     */
    function snapFloorRoofGhost(type, hx, hy, hz, hitB) {
      if (!isFloorType(type) && !isRoofType(type)) return false;
      const pix = Math.floor(player.x / BUILD_CELL);
      const piz = Math.floor(player.z / BUILD_CELL);
      const lookingUp = orbitPitch < 0.5;

      // 1) Wall-top socket near aim (true ceiling attachment)
      const sock = nearestSocket("wall_top", hx, hy, hz, 3.4);
      if (sock) {
        const w = wallsInCell(sock.ix, sock.iz, sock.iy) + adjacentEdgeWalls(sock.ix, sock.iz, sock.iy);
        if (w >= 1 || findDeck(sock.ix, sock.iz, sock.iy)) {
          ghostCell.ix = sock.ix;
          ghostCell.iz = sock.iz;
          ghostCell.iy = sock.iy;
          ghostCell.baseY = sock.parent.baseY;
          const deck = findDeck(sock.ix, sock.iz, sock.iy);
          if (deck) ghostCell.baseY = deck.baseY;
          return true;
        }
      }

      // 2) Inside a room looking up → ceiling of the cell you're standing in
      if (lookingUp) {
        const sup = ceilingSupportInCell(pix, piz);
        if (sup) {
          const w = wallsInCell(pix, piz, sup.iy) + adjacentEdgeWalls(pix, piz, sup.iy);
          if (w >= 1 || findDeck(pix, piz, sup.iy)) {
            ghostCell.ix = pix;
            ghostCell.iz = piz;
            ghostCell.iy = sup.iy;
            const deck = findDeck(pix, piz, sup.iy);
            ghostCell.baseY = deck ? deck.baseY : sup.baseY;
            return true;
          }
        }
      }

      // 3) Ray hit a wall → that wall's room cell at wall top
      if (hitB && isWallType(hitB.piece.type) && hitB.piece.type !== "roof_wall") {
        const p = hitB.piece;
        ghostCell.ix = p.ix;
        ghostCell.iz = p.iz;
        ghostCell.iy = p.iy;
        const deck = findDeck(p.ix, p.iz, p.iy);
        ghostCell.baseY = deck ? deck.baseY : p.baseY;
        return true;
      }

      // 4) Hit foundation/floor while aiming ceiling — same cell, wall height
      if (hitB && (isFoundationType(hitB.piece.type) || isFloorType(hitB.piece.type))) {
        const p = hitB.piece;
        const iy = isFloorType(type) && isFloorType(p.type) ? p.iy + 1 : p.iy;
        ghostCell.ix = p.ix;
        ghostCell.iz = p.iz;
        ghostCell.iy = iy;
        ghostCell.baseY = p.baseY;
        return true;
      }
      return false;
    }

    // Snap foundations / walls to sockets in ghost placement
    const __makeGhostFromRay = makeGhostFromRay;
    makeGhostFromRay = function () {
      __makeGhostFromRay();
      if (!ghostCell || !chunk) {
        updateStabHud("", false);
        return;
      }
      const type = ghostCell.type;
      const ray = camBuildRay();
      if (ray) {
        const hitT = rayHitTerrain(ray.o, ray.d);
        const hitB = rayHitBuilds(ray.o, ray.d);
        // Use real ray hit (not piece center) so side sockets resolve to the empty corner
        let hx, hy, hz;
        if (hitB && (!hitT || hitB.t < hitT.t)) {
          hx = ray.o[0] + ray.d[0] * hitB.t;
          hy = ray.o[1] + ray.d[1] * hitB.t;
          hz = ray.o[2] + ray.d[2] * hitB.t;
        } else if (hitT) {
          hx = hitT.x; hy = hitT.y; hz = hitT.z;
        } else {
          hx = (ghostCell.ix + 0.5) * BUILD_CELL;
          hy = ghostCell.baseY || 0;
          hz = (ghostCell.iz + 0.5) * BUILD_CELL;
        }

        // Ceiling / roof first — don't let terrain/foundation snap steal the room cell
        if (isFloorType(type) || isRoofType(type)) {
          snapFloorRoofGhost(type, hx, hy, hz, hitB);
        } else if (!hitB || (hitT && hitT.t <= hitB.t)) {
          // Terrain / empty ground: snap to that grid cell first
          const gc = worldToBuildCell(hx, hz);
          ghostCell.ix = gc.ix;
          ghostCell.iz = gc.iz;
          ghostCell.iy = 0;
        }
        if (isFoundationType(type)) {
          // Prefer free neighbor sockets (fixes L→2×2 "ocupado" when aim hits an existing pad)
          let sock = nearestFreeFoundationSocket(hx, hy, hz, 3.2, type);
          if (!sock && hitT) {
            sock = nearestFreeFoundationSocket(hitT.x, hitT.y, hitT.z, 3.2, type);
          }
          if (sock) {
            ghostCell.ix = sock.ix;
            ghostCell.iz = sock.iz;
            ghostCell.iy = sock.iy;
            ghostCell.baseY = sock.parent.baseY;
          } else if (hitB && isFoundationType(hitB.piece.type)) {
            // Fallback: neighbor from hit side of the pad
            const p = hitB.piece;
            const pcx = (p.ix + 0.5) * BUILD_CELL;
            const pcz = (p.iz + 0.5) * BUILD_CELL;
            const dx = hx - pcx;
            const dz = hz - pcz;
            let nix = p.ix;
            let niz = p.iz;
            if (Math.abs(dx) >= Math.abs(dz)) nix = p.ix + (dx >= 0 ? 1 : -1);
            else niz = p.iz + (dz >= 0 ? 1 : -1);
            const probe = { type, ix: nix, iy: p.iy, iz: niz, yaw: 0, baseY: p.baseY };
            if (!occupancyBlocked(probe) && !findDeck(nix, niz, p.iy)) {
              ghostCell.ix = nix;
              ghostCell.iz = niz;
              ghostCell.iy = p.iy;
              ghostCell.baseY = p.baseY;
            }
          }
        }
        if (isWallType(type) && type !== "roof_wall") {
          const sock = nearestSocket("deck_top_edge", hx, hy, hz, 2.0);
          if (sock) {
            ghostCell.ix = sock.ix;
            ghostCell.iz = sock.iz;
            ghostCell.iy = sock.iy;
            ghostCell.yaw = sock.yaw;
            buildYaw = sock.yaw;
            ghostCell.baseY = sock.parent.baseY;
          }
        }
        // Metal door / door leaf: snap into an existing doorway frame
        if (type === "door") {
          let frame = null;
          if (hitB && (hitB.piece.type === "doorway" || hitB.piece.type === "doorway_d")) {
            frame = hitB.piece;
          }
          if (!frame) {
            frame = findDoorwayOnEdge(ghostCell.ix, ghostCell.iz, ghostCell.iy, ghostCell.yaw)
              || findAnyDoorwayInCell(ghostCell.ix, ghostCell.iz, ghostCell.iy);
          }
          // Aiming through the open hole often hits terrain beyond — scan nearby cells
          if (!frame) {
            const pix = Math.floor(hx / BUILD_CELL);
            const piz = Math.floor(hz / BUILD_CELL);
            for (let dz = -1; dz <= 1 && !frame; dz++) {
              for (let dx = -1; dx <= 1 && !frame; dx++) {
                frame = findAnyDoorwayInCell(pix + dx, piz + dz, ghostCell.iy);
              }
            }
          }
          if (frame) {
            ghostCell.ix = frame.ix;
            ghostCell.iz = frame.iz;
            ghostCell.iy = frame.iy;
            ghostCell.yaw = ((frame.yaw % 4) + 4) % 4;
            buildYaw = ghostCell.yaw;
            ghostCell.baseY = frame.baseY;
          }
        }
      }
      // Re-validate after snap
      const v = validateBuild(ghostCell);
      ghostOk = v.ok && Math.hypot(
        (ghostCell.ix + 0.5) * BUILD_CELL - player.x,
        (ghostCell.iz + 0.5) * BUILD_CELL - player.z
      ) <= 24;
      ghostReason = v.reason || "";
      if (!ghostOk && !v.ok) ghostReason = v.reason;
      uploadGhostMesh(ghostCell, ghostOk);
      const stabTxt = ghostCell._stabPreview != null
        ? (" · " + Math.round(ghostCell._stabPreview) + "% estab.")
        : "";
      updateStabHud(
        (BUILD_LABELS[type] || type) + stabTxt + (ghostReason ? " · " + ghostReason : ""),
        ghostOk
      );
    };

    // Tool actions on click
    function tryBuildToolAction() {
      if (deployMode === "toolcupboard" || deployMode === "workbench"
        || deployMode === "research_table" || deployMode === "metal_door"
        || deployMode === "campfire" || deployMode === "sleeping_bag"
        || deployMode === "box_small" || deployMode === "box_large") {
        return tryPlaceGhost();
      }
      if (!buildMode) return false;
      const ray = camBuildRay();
      if (!ray) return false;
      const hitB = rayHitBuilds(ray.o, ray.d);
      if (buildTool === "place") return tryPlaceGhost();
      if (!hitB) return false;
      const p = hitB.piece;
      if (buildTool === "upgrade") return upgradePiece(p);
      if (buildTool === "repair") return repairPiece(p);
      if (buildTool === "attack") {
        return damagePiece(p, 8, player.x, player.z, (p.tier | 0) >= 2 ? "basic" : "melee");
      }
      if (buildTool === "cupboard" || p.type === "toolcupboard") {
        if (p.type === "toolcupboard") { openTcPanel(p); return true; }
      }
      return false;
    }

    function setBuildTool(tool) {
      buildTool = tool;
      const labels = {
        place: "Colocar",
        upgrade: "Mejorar (U)",
        repair: "Reparar",
        attack: "Atacar soft/hard",
        cupboard: "Armario",
      };
      onHud({ status: "Herramienta · " + (labels[tool] || tool) });
    }

    // Mesh for tool cupboard + tier/stability coloring
    const __buildPieceMeshOuter = buildPieceMesh;
    buildPieceMesh = function (piece, arr, rgbOverride) {
      ensurePieceInternals(piece);

      if (piece.type === "door") {
        // Metal door leaf — hinge swing lerped by _doorOpenAmt
        const rgb = [0.38, 0.42, 0.46];
        const brass = [0.78, 0.58, 0.22];
        const iron = [0.18, 0.19, 0.22];
        const ironLite = [0.42, 0.44, 0.48];
        const g = doorLeafGeom(piece);
        buildPushBox(arr, g.minX, g.minY, g.minZ, g.maxX, g.maxY, g.maxZ, rgb);
        // Handle on latch edge
        const hs = 0.07;
        const hy0 = g.hy - 0.08, hy1 = g.hy + 0.08;
        buildPushBox(arr, g.hx - hs, hy0, g.hz - hs, g.hx + hs, hy1, g.hz + hs, brass);
        if (piece.locked) {
          const cx = g.hx, cz = g.hz;
          const ly0 = hy0 - 0.02;
          const ly1 = hy0 + 0.14;
          const body = 0.07;
          buildPushBox(arr, cx - body, ly0, cz - body, cx + body, ly1, cz + body, iron);
          buildPushBox(arr, cx - 0.015, ly0 + 0.04, cz - body - 0.01, cx + 0.015, ly0 + 0.09, cz + body + 0.01, ironLite);
          const sh = 0.045;
          buildPushBox(arr, cx - sh, ly1, cz - sh * 0.55, cx - sh + 0.025, ly1 + 0.09, cz + sh * 0.55, brass);
          buildPushBox(arr, cx + sh - 0.025, ly1, cz - sh * 0.55, cx + sh, ly1 + 0.09, cz + sh * 0.55, brass);
          buildPushBox(arr, cx - sh, ly1 + 0.07, cz - sh * 0.55, cx + sh, ly1 + 0.1, cz + sh * 0.55, brass);
        }
        return;
      }
      if (piece.type === "toolcupboard") {
        // Wardrobe GLB (baked verts) — same privilege/UI TC, new visual
        const ghostFlag = rgbOverride;
        const cell = BUILD_CELL;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.06;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const mesh = wardrobeTcMesh;
        if (mesh && mesh.floats && mesh.vertCount > 0) {
          const F = mesh.floats;
          for (let vi = 0; vi < mesh.vertCount; vi++) {
            const o = vi * 11;
            const lx = F[o], ly = F[o + 1], lz = F[o + 2];
            const lnx = F[o + 3], lny = F[o + 4], lnz = F[o + 5];
            let wx, wz, wnx, wnz;
            if (yaw === 0) { wx = cx + lx; wz = cz + lz; wnx = lnx; wnz = lnz; }
            else if (yaw === 1) { wx = cx + lz; wz = cz - lx; wnx = lnz; wnz = -lnx; }
            else if (yaw === 2) { wx = cx - lx; wz = cz - lz; wnx = -lnx; wnz = -lnz; }
            else { wx = cx - lz; wz = cz + lx; wnx = -lnz; wnz = lnx; }
            const col = ghostFlag != null
              ? ghostFlag
              : [F[o + 6], F[o + 7], F[o + 8]];
            // uv.x + 10 → fs_build textured-prop path (skip procedural plank wash)
            buildPushVert(arr, wx, base + ly, wz, wnx, lny, wnz, col, F[o + 9] + 10.0, F[o + 10]);
          }
          return;
        }
        // Fallback procedural cabinet if mesh not loaded yet
        const oak = [0.42, 0.28, 0.14];
        const oakDark = [0.28, 0.17, 0.08];
        const oakLite = [0.52, 0.36, 0.18];
        const iron = [0.38, 0.40, 0.44];
        const ironDark = [0.18, 0.19, 0.22];
        const brass = [0.72, 0.58, 0.28];
        function tcBox(lx0, ly0, lz0, lx1, ly1, lz1, col) {
          const use = ghostFlag != null ? ghostFlag : col;
          const corners = [[lx0, lz0], [lx1, lz0], [lx0, lz1], [lx1, lz1]];
          let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
          for (let ci = 0; ci < 4; ci++) {
            const lx = corners[ci][0], lz = corners[ci][1];
            let wx, wz;
            if (yaw === 0) { wx = cx + lx; wz = cz + lz; }
            else if (yaw === 1) { wx = cx + lz; wz = cz - lx; }
            else if (yaw === 2) { wx = cx - lx; wz = cz - lz; }
            else { wx = cx - lz; wz = cz + lx; }
            if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
            if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
          }
          buildPushBox(arr, minX, base + ly0, minZ, maxX, base + ly1, maxZ, use);
        }
        tcBox(-0.40, 0.00, -0.22, 0.40, 1.55, 0.22, oak);
        tcBox(-0.42, 1.50, -0.24, 0.42, 1.58, 0.24, oakDark);
        tcBox(-0.36, 0.2, 0.18, 0.36, 1.4, 0.24, oakLite);
        tcBox(-0.06, 0.7, 0.24, 0.06, 0.95, 0.30, brass);
        tcBox(-0.38, 0.0, -0.20, -0.28, 0.1, -0.10, ironDark);
        tcBox(0.28, 0.0, -0.20, 0.38, 0.1, -0.10, ironDark);
        tcBox(-0.38, 0.0, 0.10, -0.28, 0.1, 0.20, iron);
        tcBox(0.28, 0.0, 0.10, 0.38, 0.1, 0.20, iron);
        return;
      }
      if (piece.type === "workbench") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.04;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const tier = asWbTier(piece.wbTier);
        if (emitWorkbenchMesh(arr, cx, cz, base, yaw, tier, rgbOverride)) return;
        const wood = [0.42, 0.28, 0.14];
        const steel = [0.45, 0.48, 0.52];
        const box = (lx0, y0, lz0, lx1, y1, lz1, col) =>
          buildPushBoxLocal(arr, cx, cz, yaw, lx0, y0, lz0, lx1, y1, lz1, col);
        // Fallback procedural table
        box(-0.7, base + 0.72, -0.4, 0.7, base + 0.86, 0.4, wood);
        box(-0.62, base, -0.32, -0.5, base + 0.72, -0.2, wood);
        box(0.5, base, -0.32, 0.62, base + 0.72, -0.2, wood);
        box(-0.62, base, 0.2, -0.5, base + 0.72, 0.32, wood);
        box(0.5, base, 0.2, 0.62, base + 0.72, 0.32, wood);
        box(0.25, base + 0.86, -0.1, 0.55, base + 1.05, 0.15, steel);
        box(-0.5, base + 0.86, -0.15, -0.15, base + 0.98, 0.1, [0.3, 0.32, 0.36]);
        const badge = tier >= 3 ? [0.75, 0.35, 0.85] : (tier >= 2 ? [0.85, 0.55, 0.2] : [0.85, 0.65, 0.2]);
        box(-0.12, base + 0.88, 0.22, 0.12, base + 1.02, 0.38, badge);
        return;
      }
      if (piece.type === "research_table") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.04;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        if (emitResearchTableMesh(arr, cx, cz, base, yaw, rgbOverride)) return;
        const wood = [0.38, 0.26, 0.16];
        const paper = [0.85, 0.82, 0.72];
        const ink = [0.2, 0.35, 0.55];
        const box = (lx0, y0, lz0, lx1, y1, lz1, col) =>
          buildPushBoxLocal(arr, cx, cz, yaw, lx0, y0, lz0, lx1, y1, lz1, col);
        box(-0.65, base + 0.7, -0.45, 0.65, base + 0.82, 0.45, wood);
        box(-0.55, base, -0.35, -0.45, base + 0.7, -0.25, wood);
        box(0.45, base, -0.35, 0.55, base + 0.7, -0.25, wood);
        box(-0.55, base, 0.25, -0.45, base + 0.7, 0.35, wood);
        box(0.45, base, 0.25, 0.55, base + 0.7, 0.35, wood);
        box(-0.35, base + 0.82, -0.25, 0.35, base + 0.86, 0.25, paper);
        box(-0.25, base + 0.86, -0.02, 0.25, base + 0.88, 0.02, ink);
        box(-0.02, base + 0.86, -0.2, 0.02, base + 0.88, 0.2, ink);
        return;
      }
      if (piece.type === "campfire") {
        // Stone ring + crossed logs + ash + layered flame (emissive via fs_build)
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.02;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const ghost = rgbOverride != null;
        const lit = !ghost && !!piece.lit;
        const stone = ghost ? rgbOverride : [0.48, 0.46, 0.42];
        const stoneDark = ghost ? rgbOverride : [0.36, 0.34, 0.30];
        const stoneLite = ghost ? rgbOverride : [0.54, 0.52, 0.48];
        const log = ghost ? rgbOverride : [0.38, 0.24, 0.12];
        const logDark = ghost ? rgbOverride : [0.22, 0.14, 0.07];
        const bark = ghost ? rgbOverride : [0.30, 0.20, 0.11];
        const ash = ghost ? rgbOverride : [0.22, 0.20, 0.18];
        const charcoal = ghost ? rgbOverride : [0.12, 0.11, 0.10];
        const ember = lit ? [0.95, 0.28, 0.06] : charcoal;
        const flameDeep = lit ? [0.98, 0.22, 0.04] : charcoal;
        const flameMid = lit ? [1.0, 0.48, 0.08] : ash;
        const flameTip = lit ? [1.0, 0.88, 0.32] : ash;
        const box = (lx0, y0, lz0, lx1, y1, lz1, col) =>
          buildPushBoxLocal(arr, cx, cz, yaw, lx0, y0, lz0, lx1, y1, lz1, col);

        // Dirt / ash pad
        box(-0.42, base, -0.42, 0.42, base + 0.04, 0.42, ash);
        box(-0.22, base + 0.03, -0.22, 0.22, base + 0.08, 0.22, charcoal);

        // Irregular stone ring (8 chunks)
        const ring = [
          [-0.48, -0.18, -0.22, 0.18],
          [0.22, -0.18, 0.48, 0.18],
          [-0.18, -0.48, 0.18, -0.22],
          [-0.18, 0.22, 0.18, 0.48],
          [-0.46, -0.46, -0.22, -0.22],
          [0.22, -0.46, 0.46, -0.22],
          [-0.46, 0.22, -0.22, 0.46],
          [0.22, 0.22, 0.46, 0.46],
        ];
        for (let i = 0; i < ring.length; i++) {
          const r = ring[i];
          const h = 0.12 + (i % 3) * 0.04;
          const col = (i & 1) ? stone : ((i & 2) ? stoneDark : stoneLite);
          box(r[0], base, r[1], r[2], base + h, r[3], col);
        }

        // Crossed logs (teepee-ish + ground stack)
        box(-0.38, base + 0.06, -0.07, 0.38, base + 0.18, 0.07, log);
        box(-0.07, base + 0.08, -0.36, 0.07, base + 0.20, 0.36, bark);
        // Diagonal propped sticks
        box(-0.32, base + 0.10, -0.28, -0.18, base + 0.52, -0.14, logDark);
        box(0.18, base + 0.10, -0.28, 0.32, base + 0.52, -0.14, log);
        box(-0.30, base + 0.10, 0.14, -0.16, base + 0.50, 0.28, bark);
        box(0.16, base + 0.10, 0.14, 0.30, base + 0.50, 0.28, logDark);
        // Center kindling
        box(-0.14, base + 0.08, -0.14, 0.14, base + 0.22, 0.14, logDark);

        // Ember bed
        box(-0.16, base + 0.18, -0.16, 0.16, base + 0.28, 0.16, ember);
        if (lit) {
          box(-0.10, base + 0.26, -0.10, 0.10, base + 0.34, 0.10, flameMid);
          // Layered flame tongues
          box(-0.11, base + 0.28, -0.08, 0.11, base + 0.62, 0.08, flameDeep);
          box(-0.07, base + 0.30, -0.12, 0.07, base + 0.72, 0.10, flameMid);
          box(-0.05, base + 0.55, -0.05, 0.05, base + 0.92, 0.05, flameTip);
          // Side lick
          box(-0.16, base + 0.32, -0.04, -0.08, base + 0.58, 0.04, flameMid);
          box(0.08, base + 0.34, -0.03, 0.15, base + 0.55, 0.05, flameDeep);
          // Hot tip spark
          box(-0.025, base + 0.88, -0.025, 0.025, base + 1.05, 0.025, flameTip);
        } else {
          // Cold ashes / leftover charcoal
          box(-0.12, base + 0.20, -0.12, 0.12, base + 0.32, 0.12, charcoal);
          box(-0.06, base + 0.30, -0.06, 0.06, base + 0.38, 0.06, ash);
        }
        return;
      }
      if (piece.type === "sleeping_bag") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.02;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        // Ghost ok flag uses rgbOverride; live bag uses fabric greens (is_fabric in fs_build)
        const ghost = rgbOverride != null;
        const nylon = ghost ? rgbOverride : [0.18, 0.42, 0.28];
        const nylonDark = ghost ? rgbOverride : [0.10, 0.28, 0.18];
        const nylonLite = ghost ? rgbOverride : [0.26, 0.52, 0.34];
        const lining = ghost ? rgbOverride : [0.55, 0.48, 0.32];
        const zipper = ghost ? rgbOverride : [0.55, 0.52, 0.48];
        const cord = ghost ? rgbOverride : [0.72, 0.62, 0.28];

        // Local axes: length along +Z for yaw 0/2, along +X for 1/3
        const alongZ = yaw === 0 || yaw === 2;
        const sign = (yaw === 2 || yaw === 3) ? -1 : 1;
        function lx(x, z) { return alongZ ? x : z * sign; }
        function lz(x, z) { return alongZ ? z * sign : x; }
        function wpt(x, y, z) {
          return [cx + lx(x, z), y, cz + lz(x, z)];
        }
        function pushBagBox(x0, y0, z0, x1, y1, z1, col) {
          // Transform AABB corners in local bag space → world AABB (axis-aligned after yaw 90°)
          const pts = [
            wpt(x0, y0, z0), wpt(x1, y0, z0), wpt(x1, y0, z1), wpt(x0, y0, z1),
            wpt(x0, y1, z0), wpt(x1, y1, z0), wpt(x1, y1, z1), wpt(x0, y1, z1),
          ];
          let minX = Infinity, minY = Infinity, minZ = Infinity;
          let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
          for (let i = 0; i < pts.length; i++) {
            minX = Math.min(minX, pts[i][0]); maxX = Math.max(maxX, pts[i][0]);
            minY = Math.min(minY, pts[i][1]); maxY = Math.max(maxY, pts[i][1]);
            minZ = Math.min(minZ, pts[i][2]); maxZ = Math.max(maxZ, pts[i][2]);
          }
          buildPushBox(arr, minX, minY, minZ, maxX, maxY, maxZ, col);
        }
        function pushBagTri(ax, ay, az, bx, by, bz, cx0, cy0, cz0, col) {
          const A = wpt(ax, ay, az), B = wpt(bx, by, bz), C = wpt(cx0, cy0, cz0);
          buildPushTri(arr, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], col);
        }

        // Soft tapered body (foot → head), quilted lobes
        const halfL = 0.92;
        const segs = 8;
        for (let s = 0; s < segs; s++) {
          const t0 = s / segs;
          const t1 = (s + 1) / segs;
          const z0 = -halfL + t0 * halfL * 2;
          const z1 = -halfL + t1 * halfL * 2;
          // Wider at shoulders, taper at feet; slight loft bulge
          const w0 = 0.22 + 0.16 * Math.sin(t0 * Math.PI) + (t0 > 0.72 ? 0.06 : 0);
          const w1 = 0.22 + 0.16 * Math.sin(t1 * Math.PI) + (t1 > 0.72 ? 0.06 : 0);
          const h0 = 0.10 + 0.12 * Math.sin(t0 * Math.PI) * (0.85 + 0.15 * Math.sin(t0 * 9));
          const h1 = 0.10 + 0.12 * Math.sin(t1 * Math.PI) * (0.85 + 0.15 * Math.sin(t1 * 9));
          const col = (s % 2 === 0) ? nylon : nylonLite;
          // Lower mattress pad
          pushBagBox(-w0 * 0.95, base, z0, w0 * 0.95, base + 0.045, z1, nylonDark);
          // Main loft shell (side panels + top)
          pushBagBox(-w0, base + 0.03, z0, w0, base + h0, z1, col);
          // Quilt seam ridges
          pushBagBox(-w0 * 1.02, base + h0 * 0.55, z0 + 0.01, -w0 * 0.88, base + h0 * 0.72, z1 - 0.01, nylonDark);
          pushBagBox(w0 * 0.88, base + h0 * 0.55, z0 + 0.01, w0 * 1.02, base + h0 * 0.72, z1 - 0.01, nylonDark);
          // Soft top crease
          pushBagBox(-w0 * 0.35, base + h0 * 0.82, z0, w0 * 0.35, base + Math.max(h0, h1) + 0.02, z1, nylonLite);
        }

        // Foot box (rounded end)
        pushBagBox(-0.20, base + 0.02, -halfL - 0.06, 0.20, base + 0.16, -halfL + 0.08, nylonDark);
        // Hood / head opening (rolled collar)
        const headZ = halfL - 0.02;
        pushBagBox(-0.34, base + 0.04, headZ - 0.18, 0.34, base + 0.30, headZ + 0.08, nylon);
        pushBagBox(-0.30, base + 0.22, headZ - 0.05, 0.30, base + 0.34, headZ + 0.12, nylonLite);
        // Inner lining visible in mouth
        pushBagBox(-0.22, base + 0.08, headZ - 0.02, 0.22, base + 0.26, headZ + 0.10, lining);
        // Hood peak
        pushBagTri(-0.28, base + 0.30, headZ + 0.04, 0.28, base + 0.30, headZ + 0.04, 0, base + 0.42, headZ + 0.02, nylon);

        // Center zipper
        pushBagBox(-0.025, base + 0.14, -halfL + 0.12, 0.025, base + 0.20, headZ - 0.2, zipper);
        // Zipper pull
        pushBagBox(-0.04, base + 0.18, headZ - 0.35, 0.04, base + 0.23, headZ - 0.28, zipper);
        // Drawcord toggles
        pushBagBox(-0.32, base + 0.28, headZ + 0.02, -0.26, base + 0.33, headZ + 0.08, cord);
        pushBagBox(0.26, base + 0.28, headZ + 0.02, 0.32, base + 0.33, headZ + 0.08, cord);
        // Side compression straps
        for (let si = 0; si < 3; si++) {
          const sz = -0.55 + si * 0.45;
          pushBagBox(-0.40, base + 0.08, sz - 0.03, -0.34, base + 0.14, sz + 0.03, cord);
          pushBagBox(0.34, base + 0.08, sz - 0.03, 0.40, base + 0.14, sz + 0.03, cord);
        }
        return;
      }
      if (piece.type === "box_small" || piece.type === "box_large") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.03;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const big = piece.type === "box_large";
        const s = big ? 1.0 : 0.72;
        if (emitOldChestMesh(arr, cx, cz, base, yaw, s, rgbOverride)) return;
        const w = 0.52 * s;
        const d = 0.38 * s;
        const bodyH = 0.44 * s;
        const oak = [0.52, 0.34, 0.16];
        const oakLite = [0.62, 0.42, 0.20];
        const oakDark = [0.32, 0.18, 0.08];
        const iron = [0.30, 0.30, 0.32];
        const ironLite = [0.52, 0.50, 0.48];
        const brass = [0.78, 0.58, 0.18];
        const y0 = base;
        const yBody = y0 + 0.05 * s;
        const yLid = yBody + bodyH;
        const L = (lx0, y0b, lz0, lx1, y1b, lz1, rgb) =>
          buildPushBoxLocal(arr, cx, cz, yaw, lx0, y0b, lz0, lx1, y1b, lz1, rgb);

        // Feet
        const ft = 0.07 * s;
        L(-w, y0, -d, -w + ft, yBody, -d + ft, iron);
        L(w - ft, y0, -d, w, yBody, -d + ft, iron);
        L(-w, y0, d - ft, -w + ft, yBody, d, iron);
        L(w - ft, y0, d - ft, w, yBody, d, iron);
        L(-w * 1.02, y0 + 0.015 * s, -d * 1.02, w * 1.02, yBody, d * 1.02, oakDark);

        // Plank courses
        const plankN = big ? 5 : 4;
        const ph = bodyH / plankN;
        for (let pi = 0; pi < plankN; pi++) {
          const col = (pi % 2 === 0) ? oak : oakLite;
          const yy0 = yBody + pi * ph;
          const yy1 = yy0 + ph * 0.9;
          L(-w, yy0, -d, w, yy1, d, col);
          if (pi < plankN - 1) {
            L(-w * 0.98, yy1, -d * 1.01, w * 0.98, yy0 + ph, d * 1.01, oakDark);
          }
        }
        // End boards
        L(-w - 0.02 * s, yBody, -d * 0.9, -w + 0.035 * s, yLid, d * 0.9, oakDark);
        L(w - 0.035 * s, yBody, -d * 0.9, w + 0.02 * s, yLid, d * 0.9, oakDark);

        // Iron bands + rivets on front
        const bandYs = [yBody + bodyH * 0.2, yBody + bodyH * 0.7];
        for (let bi = 0; bi < bandYs.length; bi++) {
          const by = bandYs[bi];
          const bh = 0.04 * s;
          L(-w - 0.02 * s, by, -d - 0.015 * s, w + 0.02 * s, by + bh, d + 0.015 * s, iron);
          for (let ri = -2; ri <= 2; ri++) {
            const rx = ri * 0.14 * s;
            L(rx - 0.02 * s, by + 0.006 * s, d + 0.01 * s, rx + 0.02 * s, by + bh - 0.006 * s, d + 0.035 * s, ironLite);
          }
        }
        // Vertical front strap + lock plate
        L(-0.045 * s, yBody + 0.02 * s, d - 0.01 * s, 0.045 * s, yLid + 0.02 * s, d + 0.03 * s, iron);
        L(-0.08 * s, yLid - 0.12 * s, d + 0.02 * s, 0.08 * s, yLid - 0.02 * s, d + 0.05 * s, brass);
        L(-0.03 * s, yLid - 0.09 * s, d + 0.045 * s, 0.03 * s, yLid - 0.05 * s, d + 0.07 * s, ironLite);

        // Stepped / slightly arched lid
        const lidSteps = [
          { y: 0.00, h: 0.05, ws: 1.03, ds: 1.05 },
          { y: 0.04, h: 0.055, ws: 0.96, ds: 0.92 },
          { y: 0.09, h: 0.045, ws: 0.82, ds: 0.72 },
          { y: 0.13, h: 0.035, ws: 0.58, ds: 0.42 },
        ];
        for (let li = 0; li < lidSteps.length; li++) {
          const S = lidSteps[li];
          const col = (li % 2 === 0) ? oakDark : oak;
          L(-w * S.ws, yLid + S.y * s, -d * S.ds, w * S.ws, yLid + (S.y + S.h) * s, d * S.ds, col);
        }
        // Lid iron rim
        L(-w * 1.01, yLid - 0.01 * s, -d * 1.01, w * 1.01, yLid + 0.025 * s, d * 1.01, iron);
        return;
      }
      if (piece.type === "scrap_barrel") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const base = (piece.baseY || 0) + 0.02;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        if (emitOldChestMesh(arr, cx, cz, base, yaw, 1.0, rgbOverride)) return;
        // Fallback procedural wooden loot chest
        const oak = [0.48, 0.30, 0.14];
        const oakLite = [0.58, 0.38, 0.18];
        const oakDark = [0.30, 0.17, 0.08];
        const stain = [0.40, 0.24, 0.11];
        const iron = [0.28, 0.28, 0.30];
        const ironLite = [0.48, 0.46, 0.44];
        const rust = [0.42, 0.26, 0.16];
        const brass = [0.82, 0.64, 0.22];
        const brassDark = [0.55, 0.40, 0.12];
        const w = 0.62, d = 0.42, bodyH = 0.42;
        const y0 = base;
        const yBody = y0 + 0.07;
        const yLid = yBody + bodyH;

        // Feet (short iron stilts)
        const ft = 0.09;
        buildPushBox(arr, cx - w, y0, cz - d, cx - w + ft, yBody, cz - d + ft, iron);
        buildPushBox(arr, cx + w - ft, y0, cz - d, cx + w, yBody, cz - d + ft, iron);
        buildPushBox(arr, cx - w, y0, cz + d - ft, cx - w + ft, yBody, cz + d, iron);
        buildPushBox(arr, cx + w - ft, y0, cz + d - ft, cx + w, yBody, cz + d, iron);
        // Underskirt / bottom board
        buildPushBox(arr, cx - w * 1.02, y0 + 0.02, cz - d * 1.02, cx + w * 1.02, yBody, cz + d * 1.02, oakDark);

        // Horizontal plank courses (body)
        const plankN = 5;
        const ph = bodyH / plankN;
        for (let pi = 0; pi < plankN; pi++) {
          const col = (pi % 2 === 0) ? oak : oakLite;
          const yy0 = yBody + pi * ph;
          const yy1 = yy0 + ph * 0.92;
          buildPushBox(arr, cx - w, yy0, cz - d, cx + w, yy1, cz + d, col);
          // thin groove between planks
          if (pi < plankN - 1) {
            buildPushBox(arr, cx - w * 0.98, yy1, cz - d * 1.01, cx + w * 0.98, yy0 + ph, cz + d * 1.01, oakDark);
          }
        }
        // End grain / side boards (slightly proud)
        buildPushBox(arr, cx - w - 0.02, yBody, cz - d * 0.92, cx - w + 0.04, yLid, cz + d * 0.92, stain);
        buildPushBox(arr, cx + w - 0.04, yBody, cz - d * 0.92, cx + w + 0.02, yLid, cz + d * 0.92, stain);

        // Corner iron brackets
        const br = 0.11;
        const bt = 0.035;
        function cornerBracket(sx, sz) {
          const x0 = sx < 0 ? cx - w - 0.01 : cx + w - br;
          const x1 = sx < 0 ? cx - w + br : cx + w + 0.01;
          const z0 = sz < 0 ? cz - d - 0.01 : cz + d - br;
          const z1 = sz < 0 ? cz - d + br : cz + d + 0.01;
          buildPushBox(arr, x0, yBody, z0, x1, yBody + bt, z1, ironLite);
          buildPushBox(arr, x0, yLid - bt, z0, x1, yLid + 0.01, z1, ironLite);
          buildPushBox(arr, x0, yBody, sz < 0 ? z0 : z1 - bt, x1, yLid, sz < 0 ? z0 + bt : z1, iron);
          buildPushBox(arr, sx < 0 ? x0 : x1 - bt, yBody, z0, sx < 0 ? x0 + bt : x1, yLid, z1, iron);
        }
        cornerBracket(-1, -1); cornerBracket(1, -1);
        cornerBracket(-1, 1); cornerBracket(1, 1);

        // Iron bands (2 horizontal around body)
        const bandYs = [yBody + bodyH * 0.22, yBody + bodyH * 0.72];
        for (let bi = 0; bi < bandYs.length; bi++) {
          const by = bandYs[bi];
          const bh = 0.045;
          buildPushBox(arr, cx - w - 0.025, by, cz - d - 0.02, cx + w + 0.025, by + bh, cz + d + 0.02, iron);
          // rivets along front band
          for (let ri = -3; ri <= 3; ri++) {
            const rx = cx + ri * 0.14;
            buildPushBox(arr, rx - 0.025, by + 0.008, cz + d + 0.015, rx + 0.025, by + bh - 0.008, cz + d + 0.04, ironLite);
          }
        }
        // Center vertical strap (front + back)
        buildPushBox(arr, cx - 0.05, yBody + 0.02, cz + d - 0.01, cx + 0.05, yLid + 0.02, cz + d + 0.035, iron);
        buildPushBox(arr, cx - 0.05, yBody + 0.02, cz - d - 0.035, cx + 0.05, yLid + 0.02, cz - d + 0.01, iron);

        // Arched lid (stepped barrel vault)
        const lidCols = [oakDark, stain, oak, oakLite];
        const lidSteps = [
          { y: 0.00, h: 0.06, ws: 1.04, ds: 1.06 },
          { y: 0.05, h: 0.07, ws: 0.98, ds: 0.96 },
          { y: 0.11, h: 0.06, ws: 0.88, ds: 0.78 },
          { y: 0.16, h: 0.05, ws: 0.72, ds: 0.55 },
          { y: 0.20, h: 0.035, ws: 0.48, ds: 0.32 },
        ];
        for (let li = 0; li < lidSteps.length; li++) {
          const S = lidSteps[li];
          const col = lidCols[li % lidCols.length];
          buildPushBox(
            arr,
            cx - w * S.ws, yLid + S.y, cz - d * S.ds,
            cx + w * S.ws, yLid + S.y + S.h, cz + d * S.ds,
            col
          );
        }
        // Lid ridge plank
        buildPushBox(arr, cx - w * 0.35, yLid + 0.22, cz - 0.06, cx + w * 0.35, yLid + 0.255, cz + 0.06, oakDark);
        // Iron lid straps
        buildPushBox(arr, cx - w * 0.95, yLid + 0.02, cz - 0.04, cx + w * 0.95, yLid + 0.21, cz + 0.04, iron);
        buildPushBox(arr, cx - 0.04, yLid + 0.02, cz - d * 0.95, cx + 0.04, yLid + 0.21, cz + d * 0.95, iron);

        // Rear hinges
        for (const hx of [-0.28, 0.28]) {
          buildPushBox(arr, cx + hx - 0.06, yLid - 0.04, cz - d - 0.05, cx + hx + 0.06, yLid + 0.1, cz - d + 0.04, ironLite);
          buildPushBox(arr, cx + hx - 0.04, yLid + 0.02, cz - d - 0.07, cx + hx + 0.04, yLid + 0.08, cz - d - 0.02, rust);
        }

        // Front brass lock plate + hasp
        buildPushBox(arr, cx - 0.12, yLid - 0.14, cz + d + 0.02, cx + 0.12, yLid + 0.04, cz + d + 0.055, brassDark);
        buildPushBox(arr, cx - 0.09, yLid - 0.11, cz + d + 0.05, cx + 0.09, yLid + 0.01, cz + d + 0.07, brass);
        // Hasp tongue over lid
        buildPushBox(arr, cx - 0.05, yLid + 0.02, cz + d * 0.55, cx + 0.05, yLid + 0.08, cz + d + 0.08, brass);
        buildPushBox(arr, cx - 0.07, yLid - 0.02, cz + d + 0.06, cx + 0.07, yLid + 0.06, cz + d + 0.1, brass);
        // Keyhole / padlock nub
        buildPushBox(arr, cx - 0.035, yLid - 0.08, cz + d + 0.065, cx + 0.035, yLid - 0.02, cz + d + 0.095, ironLite);
        buildPushBox(arr, cx - 0.02, yLid - 0.06, cz + d + 0.09, cx + 0.02, yLid - 0.035, cz + d + 0.11, [0.1, 0.1, 0.1]);
        return;
      }
      if (piece.type === "world_ore") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const base = (piece.baseY || 0) + 0.02;
        const ok = piece.oreKind || "rock";
        if (ok === "metal") {
          // Rusty body + blue crystal gashes
          const body = [0.52, 0.32, 0.18];
          const dark = [0.28, 0.14, 0.08];
          const crystal = [0.55, 0.75, 0.95];
          const crystalHi = [0.75, 0.88, 1.0];
          buildPushBox(arr, cx - 0.55, base, cz - 0.48, cx + 0.55, base + 0.72, cz + 0.48, body);
          buildPushBox(arr, cx - 0.48, base + 0.72, cz - 0.35, cx + 0.4, base + 0.95, cz + 0.38, dark);
          buildPushBox(arr, cx - 0.35, base + 0.25, cz + 0.2, cx + 0.45, base + 0.85, cz + 0.42, crystal);
          buildPushBox(arr, cx - 0.15, base + 0.4, cz + 0.35, cx + 0.25, base + 0.78, cz + 0.52, crystalHi);
          buildPushBox(arr, cx - 0.5, base + 0.15, cz - 0.5, cx - 0.15, base + 0.7, cz - 0.15, crystal);
          return;
        }
        if (ok === "sulfur") {
          // Compact pale mound + yellow deposits (not a giant hill)
          const pale = [0.68, 0.62, 0.48];
          const paleDark = [0.42, 0.38, 0.28];
          const yel = [0.92, 0.78, 0.1];
          const yelHot = [0.98, 0.88, 0.22];
          buildPushBox(arr, cx - 0.38, base, cz - 0.32, cx + 0.38, base + 0.22, cz + 0.32, pale);
          buildPushBox(arr, cx - 0.3, base + 0.18, cz - 0.24, cx + 0.3, base + 0.36, cz + 0.24, paleDark);
          buildPushBox(arr, cx - 0.2, base + 0.32, cz - 0.16, cx + 0.2, base + 0.46, cz + 0.16, pale);
          buildPushBox(arr, cx - 0.18, base + 0.06, cz + 0.08, cx + 0.28, base + 0.28, cz + 0.34, yel);
          buildPushBox(arr, cx - 0.28, base + 0.2, cz - 0.12, cx - 0.05, base + 0.38, cz + 0.14, yelHot);
          return;
        }
        // Piedra — simple dark angular grey
        const body = [0.42, 0.44, 0.47];
        const dark = [0.22, 0.23, 0.25];
        buildPushBox(arr, cx - 0.5, base, cz - 0.42, cx + 0.5, base + 0.78, cz + 0.42, body);
        buildPushBox(arr, cx - 0.22, base + 0.55, cz - 0.18, cx + 0.32, base + 1.05, cz + 0.28, dark);
        buildPushBox(arr, cx - 0.65, base, cz - 0.12, cx - 0.28, base + 0.42, cz + 0.32, body);
        return;
      }
      if (piece.type === "world_tree") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const base = (piece.baseY || 0);
        const bark = [0.38, 0.24, 0.12];
        const leaf = [0.22, 0.48, 0.2];
        buildPushBox(arr, cx - 0.14, base, cz - 0.14, cx + 0.14, base + 2.2, cz + 0.14, bark);
        buildPushBox(arr, cx - 0.85, base + 1.7, cz - 0.85, cx + 0.85, base + 3.1, cz + 0.85, leaf);
        buildPushBox(arr, cx - 0.55, base + 2.9, cz - 0.55, cx + 0.55, base + 3.55, cz + 0.55, [0.28, 0.55, 0.24]);
        return;
      }
      const rgb = rgbOverride != null ? rgbOverride : pieceRgb(piece, null);
      return __buildPieceMeshOuter(piece, arr, rgb);
    };

    // AABB for TC / workbench / barrels
    const __pieceAabb = pieceAabb;
    pieceAabb = function (p) {
      if (p.type === "toolcupboard") {
        const cell = BUILD_CELL;
        const cx = (p.ix + 0.5) * cell + (p._ox || 0);
        const cz = (p.iz + 0.5) * cell + (p._oz || 0);
        const he = furnitureHalfExtents("toolcupboard", p.yaw);
        const onDeck = !!findDeck(p.ix, p.iz, p.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.06;
        const base = p.baseY + p.iy * BUILD_LEVEL_H + lift;
        return {
          minX: cx - he.hx, maxX: cx + he.hx,
          minY: base, maxY: base + 1.58, // wardrobe scaled to ~1.55 m
          minZ: cz - he.hz, maxZ: cz + he.hz,
        };
      }
      if (p.type === "workbench" || p.type === "research_table") {
        const cell = BUILD_CELL;
        const cx = (p.ix + 0.5) * cell + (p._ox || 0);
        const cz = (p.iz + 0.5) * cell + (p._oz || 0);
        const he = furnitureHalfExtents(p.type, p.yaw);
        const onDeck = !!findDeck(p.ix, p.iz, p.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.04;
        const base = p.baseY + p.iy * BUILD_LEVEL_H + lift;
        const h = p.type === "workbench" ? 1.365 : 1.6; // research GLB ×1.35
        return {
          minX: cx - he.hx, maxX: cx + he.hx,
          minY: base, maxY: base + h,
          minZ: cz - he.hz, maxZ: cz + he.hz,
        };
      }
      if (p.type === "campfire" || p.type === "sleeping_bag" || p.type === "box_small" || p.type === "box_large") {
        const cell = BUILD_CELL;
        const cx = (p.ix + 0.5) * cell + (p._ox || 0);
        const cz = (p.iz + 0.5) * cell + (p._oz || 0);
        const he = furnitureHalfExtents(p.type, p.yaw);
        const onDeck = !!findDeck(p.ix, p.iz, p.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.03;
        const base = p.baseY + p.iy * BUILD_LEVEL_H + lift;
        const h = p.type === "campfire" ? 1.15 : (p.type === "sleeping_bag" ? 0.45 : 0.55);
        return {
          minX: cx - he.hx, maxX: cx + he.hx,
          minY: base, maxY: base + h,
          minZ: cz - he.hz, maxZ: cz + he.hz,
        };
      }
      if (p.type === "scrap_barrel") {
        const cell = BUILD_CELL;
        const cx = (p.ix + 0.5) * cell + (p._ox || 0);
        const cz = (p.iz + 0.5) * cell + (p._oz || 0);
        const base = (p.baseY || 0) + 0.02;
        const he = furnitureHalfExtents("box_large", p.yaw);
        return {
          minX: cx - he.hx, maxX: cx + he.hx,
          minY: base, maxY: base + 0.55,
          minZ: cz - he.hz, maxZ: cz + he.hz,
        };
      }
      if (p.type === "world_ore") {
        const cell = BUILD_CELL;
        const cx = (p.ix + 0.5) * cell + (p._ox || 0);
        const cz = (p.iz + 0.5) * cell + (p._oz || 0);
        const base = (p.baseY || 0) + 0.02;
        return {
          minX: cx - 0.75, maxX: cx + 0.75,
          minY: base, maxY: base + 1.1,
          minZ: cz - 0.55, maxZ: cz + 0.55,
        };
      }
      if (p.type === "world_tree") {
        const cell = BUILD_CELL;
        const cx = (p.ix + 0.5) * cell + (p._ox || 0);
        const cz = (p.iz + 0.5) * cell + (p._oz || 0);
        const base = (p.baseY || 0);
        return {
          minX: cx - 0.9, maxX: cx + 0.9,
          minY: base, maxY: base + 3.6,
          minZ: cz - 0.9, maxZ: cz + 0.9,
        };
      }
      return __pieceAabb(p);
    };

    function refreshWorkbenchProximity() {
      isInWorkbenchRange = false;
      workbenchTierNear = 0;
      vitals.nearHeat = false;
      let comfort = 0;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        const c = pieceWorldCenter(p);
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (p.type === "workbench" && d <= WORKBENCH_RANGE) {
          isInWorkbenchRange = true;
          workbenchTierNear = Math.max(workbenchTierNear, asWbTier(p.wbTier));
          comfort = Math.max(comfort, 0.2);
          // WB is not a heat source — only campfires warm you
        }
        if (p.type === "campfire" && p.lit && d <= HEAT_RANGE) {
          vitals.nearHeat = true;
          comfort = Math.max(comfort, 0.5);
        }
      }
      vitals.comfort = comfort;
      try {
        if (window.__fw) {
          window.__fw.isInWorkbenchRange = isInWorkbenchRange;
          window.__fw.workbenchTier = workbenchTierNear;
        }
      } catch (_) {}
      if (progApi && progApi.isOpen && progApi.isOpen()) progApi.paint();
    }

    let lastVitalsHp = null;
    let hurtFlashUntil = 0;
    let hurtOverlayEl = null;
    let coldOverlayEl = null;
    function ensureHurtOverlay() {
      if (hurtOverlayEl || typeof document === "undefined") return;
      hurtOverlayEl = document.createElement("div");
      hurtOverlayEl.className = "fw-hurt-flash";
      hurtOverlayEl.setAttribute("aria-hidden", "true");
      const stage = document.querySelector(".stage") || document.body;
      stage.appendChild(hurtOverlayEl);
    }
    function ensureColdOverlay() {
      if (coldOverlayEl || typeof document === "undefined") return;
      coldOverlayEl = document.createElement("div");
      coldOverlayEl.className = "fw-cold-vignette";
      coldOverlayEl.setAttribute("aria-hidden", "true");
      const stage = document.querySelector(".stage") || document.body;
      stage.appendChild(coldOverlayEl);
    }

    function syncVitalsDom() {
      const hpEl = document.getElementById("fw-hp-text");
      const hpFill = document.getElementById("fw-hp-fill");
      const huEl = document.getElementById("fw-hunger-text");
      const huFill = document.getElementById("fw-hunger-fill");
      const temp = document.getElementById("fw-temp");
      const conf = document.getElementById("fw-comfort");
      const hpPct = Math.max(0, Math.min(100, (vitals.hp / MAX_HP) * 100));
      if (hpEl) hpEl.textContent = Math.ceil(vitals.hp) + " / " + MAX_HP;
      if (hpFill) {
        hpFill.style.width = hpPct + "%";
        hpFill.classList.toggle("is-low", vitals.hp < MAX_HP * 0.35);
        hpFill.classList.toggle("is-crit", vitals.hp < MAX_HP * 0.18);
      }
      const hpRow = hpFill && hpFill.closest(".vital-hp");
      if (hpRow) {
        hpRow.classList.toggle("is-low", vitals.hp < MAX_HP * 0.35);
        hpRow.classList.toggle("is-crit", vitals.hp < MAX_HP * 0.18);
      }
      if (huEl) huEl.textContent = Math.ceil(vitals.hunger) + " / " + MAX_HUNGER;
      if (huFill) huFill.style.width = Math.max(0, Math.min(100, (vitals.hunger / MAX_HUNGER) * 100)) + "%";
      if (temp) {
        temp.textContent = vitals.cold ? "TEMP · FRÍO" : (vitals.nearHeat ? "TEMP · CALOR" : "TEMP · OK");
        temp.classList.toggle("is-cold", !!vitals.cold);
        temp.classList.toggle("is-warm", !!vitals.nearHeat && !vitals.cold);
      }
      if (conf) {
        conf.textContent = "CONFORT · " + Math.round(vitals.comfort * 100) + "%";
        conf.classList.toggle("is-comfort", vitals.comfort > 0.05);
      }
      ensureColdOverlay();
      if (coldOverlayEl) {
        const coldAmt = vitals.cold ? 0.75 : (vitals.nearHeat ? 0 : 0.15);
        coldOverlayEl.style.opacity = String(coldAmt);
        coldOverlayEl.classList.toggle("is-warm", !!vitals.nearHeat && !vitals.cold);
        coldOverlayEl.classList.toggle("is-cold", !!vitals.cold);
      }
      // Damage flash when HP drops
      if (lastVitalsHp != null && vitals.hp < lastVitalsHp - 0.4) {
        ensureHurtOverlay();
        hurtFlashUntil = performance.now() + 280;
        if (hurtOverlayEl) {
          hurtOverlayEl.classList.add("is-on");
          const stage = document.querySelector(".stage");
          if (stage) stage.classList.add("is-hurt");
        }
      }
      lastVitalsHp = vitals.hp;
      if (hurtOverlayEl && performance.now() > hurtFlashUntil) {
        hurtOverlayEl.classList.remove("is-on");
        const stage = document.querySelector(".stage");
        if (stage) stage.classList.remove("is-hurt");
      }
    }

    function tickCampfires(dt) {
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type !== "campfire") continue;
        if (!Array.isArray(p.slots)) p.slots = [null, null];
        let wood = 0;
        for (let s = 0; s < p.slots.length; s++) {
          if (p.slots[s] && p.slots[s].id === "wood") wood += p.slots[s].qty | 0;
        }
        if (wood <= 0) {
          if (p.lit) {
            p.lit = false;
            invalidatePieceMesh(p);
            rebuildBuildMesh();
            playUiSfx("fire_out");
          }
          continue;
        }
        if (!p.lit) { p.lit = true; invalidatePieceMesh(p); rebuildBuildMesh(); }
        p._burnAcc = (p._burnAcc || 0) + dt;
        if (p._burnAcc >= 12) {
          p._burnAcc = 0;
          for (let s = 0; s < p.slots.length; s++) {
            if (p.slots[s] && p.slots[s].id === "wood" && p.slots[s].qty > 0) {
              p.slots[s].qty -= 1;
              if (p.slots[s].qty <= 0) p.slots[s] = null;
              break;
            }
          }
        }
      }
    }

    function tickVitals(dt) {
      if (vitals.dead || !controlsEnabled) return;
      refreshWorkbenchProximity();
      tickCampfires(dt);
      const night = (_celestial && _celestial.nightW > 0.45);
      vitals.cold = !!(night && !vitals.nearHeat);
      const hungerRate = vitals.cold ? 2.0 : (2.0 / 3); // /sec — ~3× slower than MVP
      vitals.hunger = Math.max(0, vitals.hunger - hungerRate * dt);
      if (vitals.hunger <= 0) {
        vitals.hp -= 2.5 * dt;
      }
      // Comfort regen: hunger > 100 near heat → heal up to comfort cap
      // comfort 0.5 → max 80 HP (60 + comfort*40)
      if (vitals.hunger > 100 && vitals.nearHeat && vitals.comfort > 0) {
        const maxHeal = 60 + vitals.comfort * 40;
        if (vitals.hp < maxHeal) {
          vitals.hp = Math.min(maxHeal, vitals.hp + 4 * vitals.comfort * dt);
        }
      }
      if (vitals.hp <= 0) {
        vitals.hp = 0;
        killPlayer("hambre / daño");
      }
      vitalsAcc += dt;
      if (vitalsAcc > 0.2) {
        vitalsAcc = 0;
        syncVitalsDom();
        updateSoftSideHint();
      }
    }

    function updateSoftSideHint() {
      if (!softHintEl && typeof document !== "undefined") {
        softHintEl = document.createElement("div");
        softHintEl.className = "fw-soft-hint";
        (document.querySelector(".stage") || document.body).appendChild(softHintEl);
      }
      if (!softHintEl) return;
      if (!heldIsHammer() && !buildMode) {
        softHintEl.classList.remove("is-on", "is-soft", "is-hard");
        return;
      }
      const ray = camBuildRay();
      const hit = ray && rayHitBuilds(ray.o, ray.d);
      if (!hit || !isWallType(hit.piece.type)) {
        softHintEl.classList.remove("is-on", "is-soft", "is-hard");
        return;
      }
      const soft = isSoftSideAttack(hit.piece, player.x, player.z);
      softHintEl.classList.add("is-on");
      softHintEl.classList.toggle("is-soft", soft);
      softHintEl.classList.toggle("is-hard", !soft);
      softHintEl.textContent = soft
        ? "SOFT · ×2 daño (Y voltea cara)"
        : "HARD · daño reducido";
    }

    function killPlayer(reason) {
      if (vitals.dead) return;
      vitals.dead = true;
      player.moving = false;
      try { setControlsEnabled(false); } catch (_) {}
      onHud({ status: "Muerto · " + (reason || "fatal") });
      openRespawnUi();
    }

    function listSleepingBags() {
      return buildPieces.filter((p) => p.type === "sleeping_bag" && p.ownerId === LOCAL_PLAYER_ID);
    }

    function openRespawnUi() {
      if (!respawnEl && typeof document !== "undefined") {
        respawnEl = document.createElement("div");
        respawnEl.className = "fw-respawn";
        respawnEl.innerHTML =
          '<div class="fw-respawn-panel">' +
          "<h2>HAS MUERTO</h2>" +
          '<p>Elige punto de reaparición. Tip: coloca sacos fuera de la base (airlock).</p>' +
          '<div class="fw-respawn-list" id="fw-respawn-list"></div>' +
          "</div>";
        (document.querySelector(".stage") || document.body).appendChild(respawnEl);
      }
      if (!respawnEl) return;
      const list = respawnEl.querySelector("#fw-respawn-list");
      list.innerHTML = "";
      const beach = document.createElement("button");
      beach.type = "button";
      beach.textContent = "Costa · spawn inicial";
      beach.addEventListener("click", () => respawnAt(null));
      list.appendChild(beach);
      const bags = listSleepingBags();
      if (!bags.length) {
        const tip = document.createElement("p");
        tip.className = "fw-respawn-empty";
        tip.textContent = "Sin sacos propios · coloca un sleeping bag para respawnear cerca.";
        list.appendChild(tip);
      }
      for (let i = 0; i < bags.length; i++) {
        const bag = bags[i];
        const c = pieceWorldCenter(bag);
        const dist = Math.hypot(c.x - player.x, c.z - player.z);
        const ang = Math.atan2(c.x - player.x, c.z - player.z);
        const compass = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
        const dir = compass[Math.round((((ang * 180 / Math.PI) + 360) % 360) / 45) % 8];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = (bag.bagLabel || ("Saco #" + bag.id))
          + " · " + Math.round(dist) + " m " + dir;
        btn.addEventListener("click", () => respawnAt(bag));
        list.appendChild(btn);
      }
      respawnEl.classList.add("is-open");
    }

    function respawnAt(bag) {
      vitals.dead = false;
      vitals.hp = MAX_HP * 0.6;
      vitals.hunger = Math.max(120, vitals.hunger * 0.5);
      if (bag) {
        const c = pieceWorldCenter(bag);
        player.x = c.x;
        player.z = c.z + 1.2;
        player.feetY = (bag.baseY || 0) + 0.2;
      } else if (chunk) {
        player.x = chunk.origin_x + 8;
        player.z = chunk.origin_z + 8;
        player.feetY = sampleHeight(chunk, player.x, player.z);
      }
      player.y = player.feetY + 1.55;
      if (respawnEl) respawnEl.classList.remove("is-open");
      try { setControlsEnabled(true); } catch (_) {}
      try { playUiSfx("respawn"); } catch (_) {}
      syncVitalsDom();
      onHud({ status: bag ? ("Respawn · " + (bag.bagLabel || "saco")) : "Respawn en costa" });
    }

    function tryEatFood() {
      if (!heldIsFood()) return false;
      if (!invConsume("food", 1)) return false;
      vitals.hunger = Math.min(MAX_HUNGER, vitals.hunger + 75);
      syncVitalsDom();
      playUiSfx("eat");
      onHud({ status: "Comiste · hambre " + Math.ceil(vitals.hunger) });
      try {
        const inv = window.__fw && window.__fw.inv;
        if (inv && typeof inv.getActive === "function") setHeldItem(inv.getActive());
      } catch (_) {}
      return true;
    }

    function openBoxPanel(box) {
      ensurePieceInternals(box);
      if (!Array.isArray(box.slots)) box.slots = [null, null, null, null, null, null];
      if (!boxPanelEl && typeof document !== "undefined") {
        boxPanelEl = document.createElement("div");
        boxPanelEl.className = "fw-box-panel";
        boxPanelEl.innerHTML =
          '<div class="fw-tc-head" id="fw-box-title">CAJA</div>' +
          '<div class="fw-tc-sub">LMB slot · deposita madera/piedra/metal/scrap/cloth/food</div>' +
          '<div class="fw-box-slots" id="fw-box-slots"></div>' +
          '<div class="fw-tc-actions"><button type="button" data-act="close">Cerrar</button></div>';
        boxPanelEl.addEventListener("click", (ev) => {
          const btn = ev.target.closest("[data-act]");
          if (btn && btn.getAttribute("data-act") === "close") {
            closeBoxPanel();
            return;
          }
          const slot = ev.target.closest("[data-slot]");
          if (!slot) return;
          const boxP = buildPieces.find((p) => p.id === activeBoxId);
          if (!boxP) return;
          const idx = Number(slot.getAttribute("data-slot"));
          const s = boxP.slots[idx];
          if (s) {
            invAdd(s.id, s.qty);
            boxP.slots[idx] = null;
            playUiSfx("deposit");
            refreshBoxPanel();
            return;
          }
          // deposit from common resources
          const order = ["wood", "stone", "metal", "scrap", "cloth", "food", "hq"];
          for (let o = 0; o < order.length; o++) {
            const id = order[o];
            if (invCount(id) < 1) continue;
            const take = Math.min(50, invCount(id));
            if (invConsume(id, take)) {
              boxP.slots[idx] = { id, qty: take };
              playUiSfx("deposit");
              refreshBoxPanel();
              return;
            }
          }
          playUiSfx("deny");
          onHud({ status: "Nada que depositar" });
        });
        (document.querySelector(".stage") || document.body).appendChild(boxPanelEl);
      }
      activeBoxId = box.id;
      boxPanelEl.classList.add("is-open");
      playUiSfx("panel_open");
      try { syncCursorForUi(); } catch (_) {}
      refreshBoxPanel();
    }
    function refreshBoxPanel() {
      if (!boxPanelEl) return;
      const box = buildPieces.find((p) => p.id === activeBoxId);
      if (!box) { closeBoxPanel(); return; }
      const title = boxPanelEl.querySelector("#fw-box-title");
      if (title) title.textContent = box.type === "box_large" ? "CAJA GRANDE" : "CAJA PEQUEÑA";
      const grid = boxPanelEl.querySelector("#fw-box-slots");
      grid.innerHTML = "";
      for (let i = 0; i < box.slots.length; i++) {
        const s = box.slots[i];
        const el = document.createElement("button");
        el.type = "button";
        el.className = "fw-box-slot" + (s ? "" : " is-empty");
        el.setAttribute("data-slot", String(i));
        if (s) {
          let icon = null;
          try {
            icon = window.FalseWorldItemIcons && window.FalseWorldItemIcons.url(s.id);
          } catch (_) {}
          if (icon) {
            el.innerHTML =
              '<img class="fw-box-slot-icon" alt="" src="' + icon + '" draggable="false">' +
              '<span class="fw-box-slot-qty">×' + s.qty + "</span>";
            el.title = (LOOT_LABELS[s.id] || s.id) + " ×" + s.qty;
          } else {
            el.textContent = s.id + " ×" + s.qty;
          }
        } else {
          el.textContent = "";
          el.setAttribute("aria-label", "vacío");
        }
        grid.appendChild(el);
      }
    }
    function closeBoxPanel() {
      if (activeBoxId) playUiSfx("panel_close");
      activeBoxId = null;
      if (boxPanelEl) boxPanelEl.classList.remove("is-open");
      try { syncCursorForUi(); } catch (_) {}
    }

    let campfireFuelCd = 0;
    function openCampfirePanel(cf) {
      // Quick: deposit 20 wood into campfire (debounced)
      ensurePieceInternals(cf);
      if (!Array.isArray(cf.slots)) cf.slots = [null, null];
      const now = performance.now();
      if (now < campfireFuelCd) {
        onHud({ status: "Fogata · espera un momento" });
        return;
      }
      if (!invConsume("wood", 20)) {
        playUiSfx("deny");
        onHud({ status: "Sin madera · fogata necesita leña" });
        return;
      }
      let put = false;
      for (let i = 0; i < cf.slots.length; i++) {
        if (cf.slots[i] && cf.slots[i].id === "wood") {
          cf.slots[i].qty += 20;
          put = true;
          break;
        }
      }
      if (!put) {
        for (let i = 0; i < cf.slots.length; i++) {
          if (!cf.slots[i]) { cf.slots[i] = { id: "wood", qty: 20 }; put = true; break; }
        }
      }
      if (!put) {
        invAdd("wood", 20);
        playUiSfx("deny");
        onHud({ status: "Fogata llena" });
        return;
      }
      campfireFuelCd = now + 450;
      const wasLit = !!cf.lit;
      cf.lit = true;
      invalidatePieceMesh(cf);
      rebuildBuildMesh();
      playUiSfx("fire_on");
      let wood = 0;
      for (let i = 0; i < cf.slots.length; i++) {
        if (cf.slots[i] && cf.slots[i].id === "wood") wood += cf.slots[i].qty | 0;
      }
      onHud({
        status: (wasLit ? "Fogata · +20 leña" : "Fogata encendida · +20 leña")
          + " · combustible " + wood,
      });
    }

    /** At most one real tree mesh falls at once; later chops still leave a stump. */
    let treeFalls = [];

    // Decay + vitals in update loop
    let __researchPulseAcc = 0;
    let __aaaUpdateHook = function (dt) {
      tickDoorAnims(dt);
      tickDecay(dt);
      tickVitals(dt);
      tickResourceRespawn(dt);
      tickExplosives(dt);
      tickTreeFalls(dt);
      tickTreeParticles(dt);
      try {
        const until = window.__fw && window.__fw.researchBusyUntil;
        if (until && performance.now() < until) {
          __researchPulseAcc += dt;
          if (__researchPulseAcc > 0.12) {
            __researchPulseAcc = 0;
            for (let i = 0; i < buildPieces.length; i++) {
              if (buildPieces[i].type === "research_table") invalidatePieceMesh(buildPieces[i]);
            }
            rebuildBuildMesh();
          }
        }
      } catch (_) {}
      if (blastFx.length || rocketProjectiles.length || stickyCharges.length || treeParticles.length) uploadFxMesh();
      else if (fxVbo) {
        try { fxVbo.destroy(); } catch (_) {}
        fxVbo = null;
        fxVertCount = 0;
      }
    };

    // Expose for key/click wiring (assigned into outer scope names used below)

    function sinkHarvestMesh(n) {
      if (!n || n.meshStart == null || n.meshCount == null || n.meshCount <= 0) return;
      const stride = 10;
      const isTree = n.kind === "tree";
      const cpu = isTree ? treeMeshCpu : rockMeshCpu;
      const vbo = isTree ? treeVbo : rockVbo;
      if (!cpu || !vbo) return;
      const start = n.meshStart | 0;
      const count = n.meshCount | 0;
      for (let i = 0; i < count; i++) {
        const o = (start + i) * stride;
        if (o + 2 >= cpu.length) break;
        if (isTree) {
          const px = cpu[o + 9] || 0;
          if (px >= 103.5 && px < 106.0) continue; // keep stump wall + sealed cap
        }
        cpu[o + 1] = -999; // bury below world
      }
      try {
        const byteOff = start * stride * 4;
        const byteLen = count * stride * 4;
        device.queue.writeBuffer(vbo, byteOff, cpu.buffer, cpu.byteOffset + byteOff, byteLen);
      } catch (_) {}
    }

    function treeFullTrunkH(species, scale) {
      const heights = [4.85, 4.6, 5.1, 4.8, 2.35, 2.7, 4.9, 5.2, 6.0, 5.0, 5.4];
      return (heights[species | 0] || 4.85) * (scale || 1);
    }

    function startTreeFall(n) {
      if (!n || n.kind !== "tree") return;
      if (treeFalls.some((fall) => !fall.sunk)) {
        sinkHarvestMesh(n);
        return;
      }
      let dirX = n.x - player.x;
      let dirZ = n.z - player.z;
      let len = Math.hypot(dirX, dirZ);
      if (len < 0.05) {
        dirX = Math.sin(player.yaw || 0);
        dirZ = Math.cos(player.yaw || 0);
        len = 1;
      }
      const scale = n.treeScale || 1;
      const fullH = treeFullTrunkH(n.species, scale);
      const activeR = Math.max(1.7, scale * 1.72);
      treeFalls.push({
        node: n,
        x: n.x,
        y: n.y,
        z: n.z,
        scale,
        fullH,
        dirX: dirX / len,
        dirZ: dirZ / len,
        stumpH: fullH * 0.15,
        radiusSq: activeR * activeR,
        elapsed: 0,
        duration: 2.35,
        creakPlayed: false,
        impactPlayed: false,
        sunk: false,
      });
    }

    function treeFallAngle(fall) {
      const u = Math.min(1, fall.elapsed / fall.duration);
      const smooth = u * u * (3 - 2 * u);
      return smooth * smooth * (Math.PI * 0.52);
    }

    function writeTreeFallUbo(ubo) {
      const fall = treeFalls.find((item) => !item.sunk);
      for (let i = 52; i < 60; i++) ubo[i] = 0;
      if (!fall) return;
      ubo[52] = fall.x;
      ubo[53] = fall.y;
      ubo[54] = fall.z;
      ubo[55] = fall.stumpH;
      ubo[56] = fall.dirX;
      ubo[57] = fall.dirZ;
      ubo[58] = treeFallAngle(fall);
      ubo[59] = fall.radiusSq;
    }

    function tickTreeFalls(dt) {
      for (let i = treeFalls.length - 1; i >= 0; i--) {
        const fall = treeFalls[i];
        fall.elapsed += Math.max(0, dt || 0);
        const u = Math.min(1, fall.elapsed / fall.duration);
        if (!fall.creakPlayed && u >= 0.12) {
          fall.creakPlayed = true;
          playTreeFallCreak(fall);
        }
        if (!fall.impactPlayed && u >= 0.92) {
          fall.impactPlayed = true;
          spawnTreeFallDust(fall);
          playTreeFallImpact(fall);
        }
        if (!fall.sunk && fall.elapsed >= fall.duration + 0.25) {
          fall.sunk = true;
          sinkHarvestMesh(fall.node);
        }
        if (fall.elapsed >= fall.duration + 0.8) treeFalls.splice(i, 1);
      }
    }

    function harvestNodeAabb(n) {
      const h = n.kind === "tree" ? 6.8 : (n.kind === "barrel" ? 0.7 : Math.max(1.8, (n.r || 0.7) * 2.4));
      return {
        minX: n.x - n.r, maxX: n.x + n.r,
        minY: n.y - 0.35, maxY: n.y + h,
        minZ: n.z - n.r, maxZ: n.z + n.r,
      };
    }

    /** Camera→player ray is short in 3rd person; reach must clear orbitDist. */
    function gatherRayMaxDist() {
      if (camMode === "fpv") return 3.6;
      return Math.max(6.5, (orbitDist || 4.2) + 4.0);
    }

    function playerMeleeReach() {
      return 2.85;
    }

    function rayHitHarvest(o, d, maxT) {
      let best = null;
      const maxDist = maxT != null ? maxT : gatherRayMaxDist();
      for (let i = 0; i < harvestNodes.length; i++) {
        const n = harvestNodes[i];
        if (n.dead) continue;
        if (!gatherToolMatches(n)) continue;
        const t = rayAabb(o, d, harvestNodeAabb(n));
        if (t == null || t < 0 || t > maxDist) continue;
        if (!best || t < best.t) best = { t, node: n, index: i };
      }
      return best;
    }

    /** Nearest in-range node the player is roughly facing (melee fallback). */
    function nearestHarvestMelee() {
      const reach = playerMeleeReach();
      const fy = Math.sin(player.yaw);
      const fz = Math.cos(player.yaw);
      let best = null;
      for (let i = 0; i < harvestNodes.length; i++) {
        const n = harvestNodes[i];
        if (n.dead) continue;
        if (!gatherToolMatches(n)) continue;
        const dx = n.x - player.x;
        const dz = n.z - player.z;
        const dist = Math.hypot(dx, dz);
        const lim = reach + (n.r || 0.5);
        if (dist > lim) continue;
        const face = dist > 0.05 ? (dx * fy + dz * fz) / dist : 1;
        // Allow slightly behind if almost touching (standing inside footprint)
        if (face < -0.25 && dist > 1.15) continue;
        const score = dist - face * 0.9;
        if (!best || score < best.score) best = { node: n, index: i, score, dist };
      }
      return best;
    }

    function findHarvestTarget(opts) {
      opts = opts || {};
      const wantMatch = opts.requireMatch !== false;
      const hintWrong = !!opts.hintWrong;
      if (!heldIsGather() || buildMode || deployMode) return null;
      const ray = camBuildRay();
      const rayMax = gatherRayMaxDist();
      const melee = playerMeleeReach();
      let hit = ray ? rayHitHarvest(ray.o, ray.d, rayMax) : null;
      if (hit) {
        const pd = Math.hypot(hit.node.x - player.x, hit.node.z - player.z);
        if (pd > melee + (hit.node.r || 0.5) + 0.35) hit = null;
      }
      if (!hit) {
        const near = nearestHarvestMelee();
        if (near) hit = { t: near.dist, node: near.node, index: near.index };
      }
      if (hit) return hit;
      if (!hintWrong) return null;
      let any = null;
      if (ray) {
        for (let i = 0; i < harvestNodes.length; i++) {
          const n = harvestNodes[i];
          if (n.dead) continue;
          const t = rayAabb(ray.o, ray.d, harvestNodeAabb(n));
          if (t == null || t < 0 || t > rayMax) continue;
          const pd = Math.hypot(n.x - player.x, n.z - player.z);
          if (pd > melee + (n.r || 0.5) + 0.6) continue;
          if (!any || t < any.t) any = { t, node: n };
        }
      }
      if (!any) {
        const fy = Math.sin(player.yaw);
        const fz = Math.cos(player.yaw);
        for (let i = 0; i < harvestNodes.length; i++) {
          const n = harvestNodes[i];
          if (n.dead) continue;
          const dx = n.x - player.x;
          const dz = n.z - player.z;
          const dist = Math.hypot(dx, dz);
          if (dist > melee + (n.r || 0.5)) continue;
          const face = dist > 0.05 ? (dx * fy + dz * fz) / dist : 1;
          if (face < 0.1) continue;
          if (!any || dist < any.t) any = { t: dist, node: n };
        }
      }
      if (any && !gatherToolMatches(any.node)) {
        if (any.node.kind === "tree") onHud({ status: "Necesitas el Hacha (hotbar) para talar" });
        else onHud({ status: "Necesitas el Pico (hotbar) para minar" });
      }
      return wantMatch ? null : any;
    }

    function gatherModeForNode(n) {
      if (!n) return "gather";
      if (n.kind === "tree") return "chop";
      if (n.kind === "rock" || n.kind === "metal" || n.kind === "sulfur") return "mine";
      return "gather";
    }

    function applyHarvestHit(n) {
      if (!n || n.dead) return false;
      if (!gatherToolMatches(n)) return false;
      const melee = playerMeleeReach();
      const pd = Math.hypot(n.x - player.x, n.z - player.z);
      if (pd > melee + (n.r || 0.5) + 0.55) return false;

      const dx = n.x - player.x;
      const dz = n.z - player.z;
      if (dx * dx + dz * dz > 0.04) player.yaw = Math.atan2(dx, dz);

      // Rust-like: few dozen HP per swing, many swings per node
      let dmg = 16;
      if (n.kind === "tree" && heldIsAxe()) dmg = 25;
      else if ((n.kind === "rock" || n.kind === "metal" || n.kind === "sulfur") && heldIsPick()) dmg = 22;
      else if (n.kind === "barrel") dmg = 20;
      n.hp -= dmg;
      let dropQty = n.dropPerHit | 0;
      if (n.kind === "barrel") {
        dropQty = 2 + ((Math.random() * 3) | 0);
      }
      const got = invAdd(n.dropId, dropQty);
      pushLootToast(n.dropId, got);
      let hqGot = 0;
      if (n.hqChance && Math.random() < n.hqChance) {
        hqGot = invAdd("hq", 1);
        if (hqGot) pushLootToast("hq", hqGot);
      }
      let clothGot = 0;
      let foodGot = 0;
      if (n.kind === "tree" && Math.random() < 0.28) {
        clothGot = invAdd("cloth", 1 + ((Math.random() * 3) | 0));
        if (clothGot) pushLootToast("cloth", clothGot);
      }
      if (n.kind === "tree" && Math.random() < 0.16) {
        foodGot = invAdd("food", 1);
        if (foodGot) pushLootToast("food", foodGot);
      }

      const dropName = LOOT_LABELS[n.dropId] || n.dropId;
      const label = n.kind === "tree" ? "Árbol"
        : (n.kind === "metal" ? "Nodo metal"
          : (n.kind === "sulfur" ? "Nodo azufre"
            : (n.kind === "barrel" ? "Cofre scrap" : "Roca")));
      const toolName = heldIsAxe() ? "Hacha" : (heldIsPick() ? "Pico" : "Herramienta");
      updateGatherHud(n, got);
      onHud({
        status: toolName + " · " + label
          + " · " + Math.max(0, Math.ceil(n.hp)) + "/" + n.maxHp
          + " · +" + got + " " + dropName
          + (hqGot ? " · +1 HQM" : "")
          + (clothGot ? " · +" + clothGot + " tela" : "")
          + (foodGot ? " · +comida" : ""),
      });
      if (n.hp <= 0) {
        n.dead = true;
        if (n.kind === "tree") startTreeFall(n);
        else sinkHarvestMesh(n);
        if (n.kind === "barrel") {
          const bust = 2 + ((Math.random() * 9) | 0);
          const bonus = invAdd("scrap", bust);
          pushLootToast("scrap", bonus);
          onHud({ status: "Cofre scrap roto · +" + bonus + " scrap" });
          hideGatherHud();
          if (n.pieceId != null) {
            const idx = buildPieces.findIndex((p) => p.id === n.pieceId);
            if (idx >= 0) {
              buildPieces.splice(idx, 1);
              rebuildBuildMesh();
            }
          }
          // no world scrap-chest respawn
        } else {
          if (n.pieceId != null) {
            const idx = buildPieces.findIndex((p) => p.id === n.pieceId);
            if (idx >= 0) {
              buildPieces.splice(idx, 1);
              rebuildBuildMesh();
            }
          }
          for (let i = treeColliders.length - 1; i >= 0; i--) {
            const t = treeColliders[i];
            if (Math.hypot(t.x - n.x, t.z - n.z) < n.r + 0.4) treeColliders.splice(i, 1);
          }
          for (let i = rockColliders.length - 1; i >= 0; i--) {
            const t = rockColliders[i];
            if (Math.hypot(t.x - n.x, t.z - n.z) < n.r + 0.4) rockColliders.splice(i, 1);
          }
          for (let i = buildBlockers.length - 1; i >= 0; i--) {
            const b = buildBlockers[i];
            if (Math.hypot(b.x - n.x, b.z - n.z) < n.r + 0.6) buildBlockers.splice(i, 1);
          }
          scheduleResourceRespawn(n.kind === "tree" ? "tree" : "ore", n.kind === "tree" ? null : n.kind);
          const sec = Math.round(respawnDelayMs(n.kind === "tree" ? "tree" : "ore") / 1000);
          onHud({
            status: label + " destruido · +" + gatherSessionGot + " " + dropName
              + " · respawn ~" + sec + "s",
          });
          hideGatherHud();
        }
      }
      return true;
    }

    /** Start a full swing; damage lands later at impact (Rust cadence). */
    function beginGatherSwing() {
      if (gatherSwing) return false;
      if (player.moving) return false;
      if (!heldIsGather() || buildMode || deployMode || radialOpen) return false;

      let n = gatherLockNode;
      if (n && (n.dead || !gatherToolMatches(n))) {
        gatherLockNode = null;
        n = null;
      }
      if (n) {
        const pd = Math.hypot(n.x - player.x, n.z - player.z);
        if (pd > playerMeleeReach() + (n.r || 0.5) + 0.65) {
          gatherLockNode = null;
          n = null;
        }
      }
      if (!n) {
        const hit = findHarvestTarget({ requireMatch: true, hintWrong: !gatherLockNode });
        if (!hit || !hit.node || hit.node.dead) return false;
        n = hit.node;
        gatherLockNode = n;
      }

      const mode = gatherModeForNode(n);
      const cfg = GATHER_SWING[mode] || GATHER_SWING.gather;
      // Prefer real Mixamo clip duration so next swing starts when anim ends
      let dur = cfg.dur;
      try {
        const live = typeof window !== "undefined" && window.__fwGatherSwing;
        if (live && typeof live[mode] === "number" && live[mode] > 0.5) {
          dur = Math.max(cfg.dur * 0.85, live[mode]);
        }
      } catch (_) {}
      const impact = Math.max(0.28, dur * (cfg.impactAt != null ? cfg.impactAt : 0.5));
      const dx = n.x - player.x;
      const dz = n.z - player.z;
      if (dx * dx + dz * dz > 0.04) player.yaw = Math.atan2(dx, dz);
      gatherSwing = {
        mode,
        elapsed: 0,
        impactDone: false,
        sfxDone: false,
        node: n,
        dur,
        impact,
      };
      if (mode === "chop") player.chopPulse = true;
      else if (mode === "mine") player.minePulse = true;
      else player.gatherPulse = true;
      return true;
    }

    function tickGatherSwing(dt) {
      if (!gatherSwing) return;
      gatherSwing.elapsed += dt;
      // Mid-animation: SFX + visual hit signal + loot (tool connects)
      if (!gatherSwing.impactDone && gatherSwing.elapsed >= gatherSwing.impact) {
        gatherSwing.impactDone = true;
        gatherSwing.sfxDone = true;
        playGatherHit(gatherSwing.mode);
        pulseGatherHit(gatherSwing.mode);
        if (gatherSwing.mode === "chop" || gatherSwing.mode === "mine") {
          spawnChopChips(gatherSwing.node, gatherSwing.mode);
        }
        applyHarvestHit(gatherSwing.node);
        if (gatherSwing.node && gatherSwing.node.dead) {
          gatherLockNode = null;
        }
      }
      if (gatherSwing.elapsed >= gatherSwing.dur) {
        gatherSwing = null;
        if (gatherHold && !player.moving && heldIsGather() && !buildMode && !deployMode && !radialOpen) {
          beginGatherSwing();
        }
      }
    }

    function tryHarvestAimed() {
      // Compat: one full swing (used by API / single click)
      if (gatherSwing) return false;
      return beginGatherSwing();
    }

    function clearGatherHold() {
      gatherHold = false;
      gatherLockNode = null;
      // Interrupted before impact → no loot / no toast
      if (gatherSwing && !gatherSwing.impactDone) gatherSwing = null;
      // If impact already landed, keep gatherSwing so the clip can finish
      hideGatherHud();
    }

    function cancelGatherForMove() {
      if (!gatherHold && !gatherSwing) return;
      gatherHold = false;
      gatherLockNode = null;
      // Walk away: never grant remaining impact; drop mid-swing without credit
      gatherSwing = null;
      hideGatherHud();
    }

    function ensureChatUi() {
      if (chatEl || typeof document === "undefined") return;
      chatEl = document.createElement("div");
      chatEl.id = "fw-chat";
      chatEl.className = "fw-chat";
      chatEl.innerHTML =
        '<div class="fw-chat-head">CHAT <kbd>T</kbd>/<kbd>Enter</kbd></div>' +
        '<div class="fw-chat-log" id="fw-chat-log"><div class="fw-chat-line muted">Chat local · Enter envía · visible solo para ti (MP chat próximamente)</div></div>' +
        '<input class="fw-chat-input" id="fw-chat-input" maxlength="160" placeholder="Escribe…" autocomplete="off">';
      (document.querySelector(".stage") || document.body).appendChild(chatEl);
      const input = chatEl.querySelector("#fw-chat-input");
      input.addEventListener("keydown", (ev) => {
        if (ev.code === "Escape") { setChatOpen(false); ev.preventDefault(); return; }
        if (ev.code === "Enter") {
          const text = String(input.value || "").trim();
          if (text) {
            const log = chatEl.querySelector("#fw-chat-log");
            const line = document.createElement("div");
            line.className = "fw-chat-line";
            line.textContent = "Tú: " + text;
            log.appendChild(line);
            log.scrollTop = log.scrollHeight;
            input.value = "";
          }
          ev.preventDefault();
        }
        ev.stopPropagation();
      });
    }
    function setChatOpen(on) {
      ensureChatUi();
      const next = !!on;
      if (next !== chatOpen) {
        try { playUiSfx(next ? "panel_open" : "panel_close"); } catch (_) {}
      }
      chatOpen = next;
      if (!chatEl) return;
      chatEl.classList.toggle("is-open", chatOpen);
      if (chatOpen) {
        try { syncCursorForUi(); } catch (_) {}
        const input = chatEl.querySelector("#fw-chat-input");
        try { input.focus(); } catch (_) {}
      } else {
        try { canvas.focus(); } catch (_) {}
        try { syncCursorForUi(); } catch (_) {}
      }
    }
    function ensureCraftUi() {
      if (progApi || typeof document === "undefined") return;
      if (!window.FalseWorldProgression) return;
      const stage = document.querySelector(".stage") || document.body;
      progApi = window.FalseWorldProgression.create(stage, {
        inv: {
          addItem: (id, qty) => invAdd(id, qty),
          tryConsume: (id, qty) => invConsume(id, qty),
          countOf: (id) => invCount(id),
        },
        onHud,
        getWorkbench: () => ({
          inRange: !!isInWorkbenchRange,
          tier: workbenchTierNear | 0,
        }),
        onBlueprintsChange: (list) => {
          try {
            if (window.__fw) window.__fw.unlockedBlueprints = list;
          } catch (_) {}
        },
      });
      try {
        if (window.__fw) window.__fw.progression = progApi;
      } catch (_) {}
      try {
        if (window.__fw) window.__fw.progression = progApi;
      } catch (_) {}
    }
    function setCraftOpen(on) {
      ensureCraftUi();
      if (!progApi) {
        craftOpen = !!on;
        onHud({ status: "Cargando fabricación…" });
        try { syncCursorForUi(); } catch (_) {}
        return;
      }
      if (on) {
        progApi.openCraft();
        craftOpen = true;
      } else {
        progApi.close();
        craftOpen = false;
      }
      try { syncCursorForUi(); } catch (_) {}
    }
    function openWorkbenchUI(piece) {
      ensureCraftUi();
      if (!progApi) return false;
      const tier = piece && piece.type === "workbench"
        ? asWbTier(piece.wbTier)
        : asWbTier(workbenchTierNear);
      if (typeof progApi.openWorkbench === "function") {
        progApi.openWorkbench(tier);
      } else {
        progApi.openWorkbench();
      }
      craftOpen = true;
      try { syncCursorForUi(); } catch (_) {}
      return true;
    }
    function openResearchUI() {
      ensureCraftUi();
      if (!progApi) return false;
      progApi.openResearch();
      craftOpen = true;
      try { syncCursorForUi(); } catch (_) {}
      return true;
    }

    // --- E use: tap = use · hold = deploy radial --------------------------------
    let eKeyDownAt = 0;
    let eHoldArmed = false;
    let useRadialEl = null;
    let useRadialOpen = false;
    let useRadialTarget = null;
    const E_HOLD_MS = 280;

    function rayHitUseTarget(maxT) {
      const ray = camBuildRay();
      if (!ray) return null;
      const hit = rayHitBuilds(ray.o, ray.d);
      if (!hit || hit.t > (maxT != null ? maxT : 3.2)) return null;
      const t = hit.piece.type;
      if (t === "workbench" || t === "research_table" || t === "toolcupboard" || t === "door"
        || t === "campfire" || t === "box_small" || t === "box_large" || t === "sleeping_bag") {
        return hit.piece;
      }
      return null;
    }

    function closeUseRadial() {
      useRadialOpen = false;
      useRadialTarget = null;
      if (useRadialEl) {
        useRadialEl.classList.remove("is-open");
        useRadialEl.setAttribute("aria-hidden", "true");
      }
    }

    function ensureUseRadial() {
      if (useRadialEl || typeof document === "undefined") return;
      useRadialEl = document.createElement("div");
      useRadialEl.id = "fw-use-radial";
      useRadialEl.className = "fw-use-radial";
      useRadialEl.setAttribute("aria-hidden", "true");
      useRadialEl.innerHTML = '<div class="fw-use-radial-inner" id="fw-use-radial-inner"></div>';
      (document.querySelector(".stage") || document.body).appendChild(useRadialEl);
      useRadialEl.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-use]");
        if (!btn || !useRadialTarget) return;
        runUseAction(btn.getAttribute("data-use"), useRadialTarget);
        closeUseRadial();
      });
    }

    function openUseRadial(piece) {
      ensureUseRadial();
      useRadialTarget = piece;
      useRadialOpen = true;
      const inner = useRadialEl.querySelector("#fw-use-radial-inner");
      let acts = [];
      if (piece.type === "door") {
        acts = [
          { id: "door_toggle", label: piece.isOpen ? "Cerrar" : "Abrir" },
          { id: "door_lock", label: "Cerradura" },
        ];
      } else if (piece.type === "toolcupboard") {
        acts = [{ id: "tc_open", label: "Abrir TC" }];
      } else if (piece.type === "workbench") {
        acts = [{ id: "wb_open", label: "Abrir mesa" }];
      } else if (piece.type === "research_table") {
        acts = [{ id: "res_open", label: "Investigar" }];
      } else if (piece.type === "campfire") {
        acts = [{ id: "fire_fuel", label: "+20 Madera" }];
      } else if (piece.type === "box_small" || piece.type === "box_large") {
        acts = [{ id: "box_open", label: "Abrir caja" }];
      } else if (piece.type === "sleeping_bag") {
        acts = [{ id: "bag_info", label: "Punto respawn" }];
      }
      inner.innerHTML = acts.map((a) =>
        '<button type="button" class="fw-use-opt" data-use="' + a.id + '">' + a.label + "</button>"
      ).join("");
      useRadialEl.classList.add("is-open");
      useRadialEl.setAttribute("aria-hidden", "false");
      onHud({ status: "Menú E · elige opción" });
    }

    function toggleDoorPiece(piece) {
      if (!piece || piece.type !== "door") return false;
      ensurePieceInternals(piece);
      if (heldIsLock() && !piece.locked) return tryInstallLockOnDoor(piece);
      if (!isAuthorizedOnDoor(piece, LOCAL_PLAYER_ID)) {
        onHud({ status: "Puerta bloqueada · solo el dueño" });
        return true;
      }
      const opening = !piece.isOpen;
      startDoorSwing(piece, opening);
      playDoorToggle(opening);
      try { notifyWorldPlace(piece); } catch (_) {}
      onHud({
        status: (opening ? "Puerta abierta · E para cerrar" : "Puerta cerrada · E para abrir")
          + (piece.locked ? " · con cerradura" : ""),
      });
      return true;
    }

    function runUseAction(act, piece) {
      if (!piece) return;
      if (act === "door_toggle") {
        toggleDoorPiece(piece);
      } else if (act === "door_lock") {
        tryInstallLockOnDoor(piece);
      } else if (act === "tc_open") {
        openTcPanel(piece);
      } else if (act === "wb_open") {
        openWorkbenchUI(piece);
      } else if (act === "res_open") {
        openResearchUI();
      } else if (act === "fire_fuel") {
        openCampfirePanel(piece);
      } else if (act === "box_open") {
        openBoxPanel(piece);
      } else if (act === "bag_info") {
        onHud({ status: (piece.bagLabel || "Saco") + " · respawn aquí · M lo marca en mapa" });
      }
    }

    /** E tap: open WB / Research / TC / boxes / fire / door */
    function tryUseAimed() {
      const aimed = rayHitUseTarget(3.2);
      // If aiming at non-door furniture, prefer that over a nearby door
      if (aimed && aimed.type !== "door") {
        if (aimed.type === "workbench") return openWorkbenchUI(aimed);
        if (aimed.type === "research_table") return openResearchUI();
        if (aimed.type === "toolcupboard") { openTcPanel(aimed); return true; }
        if (aimed.type === "campfire") { openCampfirePanel(aimed); return true; }
        if (aimed.type === "box_small" || aimed.type === "box_large") { openBoxPanel(aimed); return true; }
        if (aimed.type === "sleeping_bag") {
          onHud({ status: (aimed.bagLabel || "Saco") + " · respawn aquí al morir · M lo marca en mapa" });
          return true;
        }
      }
      if (aimed && aimed.type === "door") return toggleDoorPiece(aimed);

      // Nearby door (open leaf may not sit under crosshair)
      let nearDoor = null;
      let nearDoorD = 2.75;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type !== "door") continue;
        const c = doorWorldPos(p);
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d < nearDoorD) { nearDoorD = d; nearDoor = p; }
      }
      if (nearDoor && nearDoorD <= 2.6) return toggleDoorPiece(nearDoor);

      const near = findNearestUseFurniture(2.85);
      if (near) {
        if (near.type === "toolcupboard") { openTcPanel(near); return true; }
        if (near.type === "workbench") return openWorkbenchUI(near);
        if (near.type === "research_table") return openResearchUI();
        if (near.type === "box_small" || near.type === "box_large") {
          openBoxPanel(near); return true;
        }
        if (near.type === "campfire") { openCampfirePanel(near); return true; }
        if (near.type === "sleeping_bag") {
          onHud({ status: (near.bagLabel || "Saco") + " · respawn aquí al morir · M lo marca en mapa" });
          return true;
        }
        if (near.type === "door") return toggleDoorPiece(near);
      }
      onHud({ status: "Nada que usar · acércate a mesa / caja / puerta" });
      return false;
    }

    function furnitureWorldPos(p) {
      const cell = BUILD_CELL;
      const cx = (p.ix + 0.5) * cell + (p._ox || 0);
      const cz = (p.iz + 0.5) * cell + (p._oz || 0);
      const onDeck = !!findDeck(p.ix, p.iz, p.iy);
      const lift = onDeck ? BUILD_FOUND_H : 0.06;
      const base = p.baseY + p.iy * BUILD_LEVEL_H + lift;
      let h = 1.05;
      if (p.type === "research_table") h = 1.0;
      else if (p.type === "workbench") h = 1.4;
      return { x: cx, y: base + h, z: cz };
    }

    function toolCupboardWorldPos(p) {
      return furnitureWorldPos(p);
    }

    function findNearestToolCupboard(maxDist) {
      const maxD = maxDist != null ? maxDist : 2.85;
      const maxD2 = maxD * maxD;
      let best = null;
      let bestD = maxD2;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type !== "toolcupboard") continue;
        const w = toolCupboardWorldPos(p);
        const dx = w.x - player.x;
        const dz = w.z - player.z;
        const dy = w.y - (player.feetY + 1.0);
        const d2 = dx * dx + dz * dz + dy * dy * 0.35;
        if (d2 < bestD) {
          bestD = d2;
          best = p;
        }
      }
      return best;
    }

    /** Nearest interactable furniture for E prompt + proximity use. */
    function findNearestUseFurniture(maxDist) {
      const maxD = maxDist != null ? maxDist : 2.85;
      const maxD2 = maxD * maxD;
      let best = null;
      let bestD = maxD2;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        const t = p.type;
        if (t !== "toolcupboard" && t !== "workbench" && t !== "research_table"
          && t !== "door" && t !== "box_small" && t !== "box_large"
          && t !== "campfire" && t !== "sleeping_bag") continue;
        const w = t === "door" ? doorWorldPos(p) : furnitureWorldPos(p);
        const dx = w.x - player.x;
        const dz = w.z - player.z;
        const dy = w.y - (player.feetY + 1.0);
        const d2 = dx * dx + dz * dz + dy * dy * 0.35;
        if (d2 < bestD) {
          bestD = d2;
          best = p;
        }
      }
      return best;
    }

    let interactPromptEl = null;
    let lastMvp = null;
    let nearbyInteractTc = null;
    let nearbyInteractUse = null;

    function ensureInteractPrompt() {
      if (interactPromptEl || typeof document === "undefined") return;
      interactPromptEl = document.createElement("div");
      interactPromptEl.className = "fw-interact-prompt";
      interactPromptEl.setAttribute("aria-hidden", "true");
      interactPromptEl.innerHTML =
        '<span class="fw-interact-key">E</span>' +
        '<span class="fw-interact-label">Abrir</span>';
      const stage = document.querySelector(".stage") || document.body;
      stage.appendChild(interactPromptEl);
    }

    function projectWorldToStage(wx, wy, wz) {
      if (!lastMvp) return null;
      const m = lastMvp;
      const clipX = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
      const clipY = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
      const clipW = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
      if (clipW <= 0.08) return null;
      const ndcX = clipX / clipW;
      const ndcY = clipY / clipW;
      if (ndcX < -1.2 || ndcX > 1.2 || ndcY < -1.25 || ndcY > 1.25) return null;
      const stage = document.querySelector(".stage");
      const rect = (stage || canvas).getBoundingClientRect();
      return {
        x: (ndcX * 0.5 + 0.5) * rect.width,
        y: (-ndcY * 0.5 + 0.5) * rect.height,
      };
    }

    // Screen-space nameplates for remote players (survive avatar depth-merge misses)
    let peerOverlayRoot = null;
    const peerOverlayById = new Map();
    let peerOverlayList = [];

    function ensurePeerOverlayRoot() {
      if (peerOverlayRoot || typeof document === "undefined") return;
      peerOverlayRoot = document.createElement("div");
      peerOverlayRoot.id = "fw-peer-overlays";
      peerOverlayRoot.setAttribute("aria-hidden", "true");
      peerOverlayRoot.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden;";
      const stage = document.querySelector(".stage") || canvas.parentElement || document.body;
      if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
      stage.appendChild(peerOverlayRoot);
    }

    function setPeerOverlays(list) {
      peerOverlayList = Array.isArray(list) ? list : [];
    }

    function tickPeerOverlays() {
      let list = peerOverlayList;
      try {
        const vrm = typeof window !== "undefined" && window.__fw && window.__fw.vrm;
        if (vrm && typeof vrm.getRemotePoses === "function") {
          const poses = vrm.getRemotePoses();
          if (poses && poses.length) {
            const byId = Object.create(null);
            for (let i = 0; i < peerOverlayList.length; i++) {
              const p = peerOverlayList[i];
              if (p && p.id) byId[p.id] = p;
            }
            list = poses.map((p) => {
              const base = byId[p.id] || {};
              return {
                id: p.id,
                name: p.name || base.name || "Guest",
                x: p.x,
                y: p.y,
                z: p.z,
              };
            });
          }
        }
      } catch (_) {}
      if (!list.length) {
        if (peerOverlayById.size) {
          for (const [, el] of peerOverlayById) el.remove();
          peerOverlayById.clear();
        }
        return;
      }
      ensurePeerOverlayRoot();
      if (!peerOverlayRoot) return;
      const seen = new Set();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p || !p.id) continue;
        seen.add(p.id);
        let el = peerOverlayById.get(p.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "fw-peer-tag";
          el.style.cssText =
            "position:absolute;transform:translate(-50%,-100%);" +
            "padding:4px 10px;border-radius:4px;background:rgba(8,12,10,.78);" +
            "color:#e8f0e4;font:600 13px/1.2 \"IBM Plex Sans\",sans-serif;" +
            "white-space:nowrap;letter-spacing:.02em;border:1px solid rgba(140,200,120,.45);" +
            "text-shadow:0 1px 2px rgba(0,0,0,.5);pointer-events:none;";
          peerOverlayRoot.appendChild(el);
          peerOverlayById.set(p.id, el);
        }
        const feetY = Number.isFinite(+p.y) ? +p.y : player.feetY;
        const headY = feetY + 2.05;
        const scr = projectWorldToStage(+p.x || 0, headY, +p.z || 0);
        const dist = Math.hypot((+p.x || 0) - player.x, (+p.z || 0) - player.z);
        el.textContent = (p.name || "Guest") + " · " + Math.round(dist) + "m";
        if (!scr) {
          el.style.opacity = "0";
          continue;
        }
        const fade = dist < 18 ? 1 : Math.max(0.2, 1 - (dist - 18) / 42);
        el.style.opacity = String(fade);
        el.style.left = scr.x + "px";
        el.style.top = scr.y + "px";
        el.style.transform = "translate(-50%,-100%)";
      }
      for (const [id, el] of peerOverlayById) {
        if (seen.has(id)) continue;
        el.remove();
        peerOverlayById.delete(id);
      }
    }

    function updateInteractPrompt() {
      ensureInteractPrompt();
      if (!interactPromptEl) return;
      const busy = !!(activeTcId || activeBoxId || craftOpen || chatOpen || mapOpen
        || radialOpen || useRadialOpen || deployMode || bagUiOpen || !controlsEnabled);
      const target = busy ? null : findNearestUseFurniture(2.85);
      nearbyInteractUse = target;
      nearbyInteractTc = target && target.type === "toolcupboard" ? target : null;
      if (!target) {
        interactPromptEl.classList.remove("is-visible");
        interactPromptEl.setAttribute("aria-hidden", "true");
        return;
      }
      const labels = {
        toolcupboard: "Abrir armario",
        workbench: "Abrir mesa T" + asWbTier(target.wbTier),
        research_table: "Investigar",
        box_small: "Abrir caja",
        box_large: "Abrir cofre",
        campfire: target.lit ? "Fogata · combustible" : "Fogata · encender",
        sleeping_bag: "Saco de dormir",
        door: target.isOpen
          ? (target.locked ? "Cerrar puerta (candado)" : "Cerrar puerta")
          : (target.locked ? "Abrir puerta (candado)" : "Abrir puerta"),
      };
      const labelEl = interactPromptEl.querySelector(".fw-interact-label");
      if (labelEl) labelEl.textContent = labels[target.type] || "Usar";
      const w = target.type === "door" ? doorWorldPos(target) : furnitureWorldPos(target);
      const scr = projectWorldToStage(w.x, w.y + 0.35, w.z);
      if (!scr) {
        interactPromptEl.style.left = "50%";
        interactPromptEl.style.top = "auto";
        interactPromptEl.style.bottom = "8.5rem";
        interactPromptEl.style.transform = "translateX(-50%)";
      } else {
        interactPromptEl.style.left = scr.x + "px";
        interactPromptEl.style.top = scr.y + "px";
        interactPromptEl.style.bottom = "auto";
        interactPromptEl.style.transform = "translate(-50%, -120%)";
      }
      interactPromptEl.classList.add("is-visible");
      interactPromptEl.setAttribute("aria-hidden", "false");
    }

    function onEKey(down) {
      if (down) {
        if (eKeyDownAt) return;
        eKeyDownAt = performance.now();
        eHoldArmed = false;
        // Arm hold timer
        setTimeout(() => {
          if (!eKeyDownAt || eHoldArmed) return;
          if (performance.now() - eKeyDownAt < E_HOLD_MS - 20) return;
          eHoldArmed = true;
          const piece = rayHitUseTarget(3.4);
          if (piece) openUseRadial(piece);
          else onHud({ status: "Mantén E · mira un objeto desplegado" });
        }, E_HOLD_MS);
        return;
      }
      // keyup
      const heldFor = eKeyDownAt ? (performance.now() - eKeyDownAt) : 0;
      eKeyDownAt = 0;
      if (eHoldArmed || useRadialOpen) {
        // Hold already opened radial — leave it until click/Esc/Tab
        eHoldArmed = false;
        return;
      }
      if (heldFor > 0 && heldFor < E_HOLD_MS + 80) {
        tryUseAimed();
      }
    }

    try {
      if (window.__fw) {
        window.__fw.onTab = function () {
          if (useRadialOpen) { closeUseRadial(); return true; }
          if (activeBoxId) { closeBoxPanel(); return true; }
          if (activeTcId) { closeTcPanel(); return true; }
          if (progApi && progApi.isOpen()) {
            setCraftOpen(false);
            return true;
          }
          return false;
        };
        window.__fw.onBagUiOpen = function (open) {
          bagUiOpen = !!open;
          try { syncCursorForUi(); } catch (_) {}
        };
        /** F7 held-tool editor: free cursor + LMB orbit around avatar. */
        window.__fw.onToolEditorOpen = function (open) {
          const next = !!open;
          if (next === toolEditorUiOpen) {
            try { syncCursorForUi(); } catch (_) {}
            return;
          }
          toolEditorUiOpen = next;
          if (toolEditorUiOpen) {
            if (toolEditorSavedCam == null) toolEditorSavedCam = camMode;
            if (camMode === "fpv") setCameraMode("follow");
            player.freeLook = true;
            try { clearLocoKeys(); } catch (_) {}
            player.moving = false;
            player.sprinting = false;
            player.moveMx = 0;
            player.moveMz = 0;
            onHud({ status: "F7 · avatar quieto · gizmo / órbita · Guardar persiste" });
          } else {
            player.freeLook = false;
            if (toolEditorSavedCam != null && toolEditorSavedCam !== camMode) {
              setCameraMode(toolEditorSavedCam);
            }
            toolEditorSavedCam = null;
          }
          try { syncCursorForUi(); } catch (_) {}
        };
        window.__fw.openWorkbenchUI = openWorkbenchUI;
        window.__fw.openResearchUI = openResearchUI;
        window.__fw.openCraftUI = function () {
          setCraftOpen(true);
          return true;
        };
        window.__fw.ensureCraftUI = function () {
          ensureCraftUi();
          return progApi || null;
        };
        window.__fw.playUi = playUiSfx;
        window.__fw.getVitals = () => vitals;
      }
    } catch (_) {}

    function isAuthorizedOnDoor(door, playerId) {
      if (!door) return false;
      const pid = playerId || LOCAL_PLAYER_ID;
      // Unlocked: anyone can open/close
      if (!door.locked) return true;
      // Locked: only the player who built the door
      const owner = door.ownerId || LOCAL_PLAYER_ID;
      return owner === pid;
    }

    function tryInstallLockOnDoor(door) {
      ensurePieceInternals(door);
      if (door.type !== "door") return false;
      if (door.locked) {
        onHud({ status: "Ya tiene cerradura" });
        return false;
      }
      const owner = door.ownerId || LOCAL_PLAYER_ID;
      if (owner !== LOCAL_PLAYER_ID) {
        onHud({ status: "Solo el dueño puede poner cerradura" });
        return false;
      }
      if (!invConsume("key_lock", 1)) {
        onHud({ status: "Sin Cerradura" });
        return false;
      }
      door.locked = true;
      door.auth = [owner];
      door.ownerId = owner;
      if (door.isOpen) {
        door.isOpen = false;
        door._doorOpenAmt = 0;
      }
      invalidatePieceMesh(door);
      rebuildBuildMesh();
      try { notifyWorldPlace(door); } catch (_) {}
      onHud({ status: "Cerradura puesta · solo tú abres/cierras" });
      return true;
    }

    function doorWorldPos(p) {
      // Follow the swinging leaf (open prompt sits on the open door, not the frame)
      const g = doorLeafGeom(p);
      return {
        x: (g.minX + g.maxX) * 0.5,
        y: (g.minY + g.maxY) * 0.5,
        z: (g.minZ + g.maxZ) * 0.5,
      };
    }

    function tryLockAimed() {
      if (!heldIsLock()) return false;
      const ray = camBuildRay();
      if (!ray) return false;
      const hit = rayHitBuilds(ray.o, ray.d);
      if (!hit || hit.t > 3.2 || hit.piece.type !== "door") {
        // Fall back to nearest door if aiming through the frame hole
        let best = null;
        let bestD = 2.8;
        for (let i = 0; i < buildPieces.length; i++) {
          const p = buildPieces[i];
          if (p.type !== "door") continue;
          const c = doorWorldPos(p);
          const d = Math.hypot(c.x - player.x, c.z - player.z);
          if (d < bestD) { bestD = d; best = p; }
        }
        if (!best) {
          onHud({ status: "Apunta a una puerta" });
          return false;
        }
        return tryInstallLockOnDoor(best);
      }
      return tryInstallLockOnDoor(hit.piece);
    }

    function tryToggleNearbyDoor() {
      let best = null;
      let bestD = 3.0;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type !== "door") continue;
        const c = doorWorldPos(p);
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return false;
      return toggleDoorPiece(best);
    }

    window.__fwBuildAAA = {
      setBuildTool,
      tryBuildToolAction,
      flipWallSoftSide,
      tryHarvestAimed,
      tryToggleNearbyDoor,
      tryLockAimed,
      tryHammerRepairAimed,
      tryHammerDemolishAimed,
      openUpgradeMenuAimed,
      closeUpgradeMenu,
      isUpgradeMenuOpen,
      openTcAimed: function () {
        const ray = camBuildRay();
        if (!ray) return;
        const hit = rayHitBuilds(ray.o, ray.d);
        if (hit && hit.piece.type === "toolcupboard") openTcPanel(hit.piece);
      },
      closeTcPanel,
      recalculateStability,
      tickDecay,
      updateHook: function (dt) { __aaaUpdateHook(dt); },
      getTool: function () { return buildTool; },
      getRes: function () { return playerBuildRes; },
      getDeployMode: function () { return deployMode; },
    };

    function spawnBeamsAndRoses() {
      if (!chunk) return;
      // Cosmic beams — vertical light shafts
      const beamVerts = [];
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + chunk.seed * 0.01;
        const r = 14 + (i % 4) * 5.5;
        const bx = chunk.origin_x + Math.cos(ang) * r;
        const bz = chunk.origin_z + Math.sin(ang) * r;
        const by = sampleHeight(chunk, bx, bz);
        const w = 0.22 + (i % 3) * 0.08;
        const top = 22;
        // Soft warm god-rays (day)
        const colBot = [0.95, 0.88, 0.65, 0.06];
        const colTop = [0.98, 0.95, 0.85, 0.01];
        const pushBeam = (x, y, z, col) => {
          beamVerts.push(x, y, z, col[0], col[1], col[2], col[3]);
        };
        // X-facing quad with top/bottom alpha
        pushBeam(bx - w, by, bz, colBot); pushBeam(bx + w, by, bz, colBot); pushBeam(bx - w, by + top, bz, colTop);
        pushBeam(bx + w, by, bz, colBot); pushBeam(bx + w, by + top, bz, colTop); pushBeam(bx - w, by + top, bz, colTop);
        pushBeam(bx, by, bz - w, colBot); pushBeam(bx, by, bz + w, colBot); pushBeam(bx, by + top, bz - w, colTop);
        pushBeam(bx, by, bz + w, colBot); pushBeam(bx, by + top, bz + w, colTop); pushBeam(bx, by + top, bz - w, colTop);
      }
      const bArr = new Float32Array(beamVerts);
      if (beamVbo) try { beamVbo.destroy(); } catch (_) {}
      beamVbo = device.createBuffer({
        size: bArr.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(beamVbo.getMappedRange()).set(bArr);
      beamVbo.unmap();
      beamVertCount = bArr.length / 7;

      // Biome flowers — fewer, evenly sprinkled across the whole island
      // kind: 0 daisy 1 buttercup 2 poppy 3 bluebell 4 lavender 5 clover 6 desert 7 snowdrop 8 marsh
      const roseVerts = [];
      const corners2 = [[-1, -1], [1, -1], [-1, 1], [1, -1], [1, 1], [-1, 1]];
      // Lower dens + wider spacing = sparse but island-wide coverage
      const flowerDens = [0.48, 0.26, 0.24, 0.18, 0.34, 0.16]; // meadow dry forest snow marsh desert
      const flowerSpacing = 8.2;
      const fHalf = ISLAND_HALF * 0.96;
      let nFlowers = 0;
      const pickKind = (bid, h) => {
        if (bid === 0) { // meadow — colorful mix
          if (h < 0.28) return 0;
          if (h < 0.50) return 1;
          if (h < 0.68) return 5;
          if (h < 0.85) return 2;
          return 4;
        }
        if (bid === 1) return h < 0.55 ? 1 : 6;           // dry — buttercup / desert
        if (bid === 2) return h < 0.55 ? 3 : 0;           // forest — bluebell / daisy
        if (bid === 3) return 7;                            // snow — snowdrop
        if (bid === 4) return h < 0.5 ? 8 : 3;            // marsh — lily / bluebell
        return 6;                                          // desert bloom
      };
      for (let gz = -fHalf; gz <= fHalf; gz += flowerSpacing) {
        for (let gx = -fHalf; gx <= fHalf; gx += flowerSpacing) {
          const h0 = hash(gx * 19.1 + gz * 47.3 + chunk.seed * 0.02);
          const h1 = hash(gx * 7.7 - gz * 13.2 + 3.1);
          const h2 = hash(gx * 3.3 + gz * 5.9 + 88.0);
          // Mild jitter so the grid doesn't read as a lattice, but stays even
          const fx = gx + (h0 - 0.5) * flowerSpacing * 0.55;
          const fz = gz + (h1 - 0.5) * flowerSpacing * 0.55;
          if (fx * fx + fz * fz > fHalf * fHalf) continue;
          if (islandEdge(fx, fz) > 0.08) continue; // keep beach clear
          const fy0 = sampleHeight(chunk, fx, fz);
          if (fy0 < -0.02 || fy0 > 16) continue;
          const bid = biomeAtJs(fx, fz);
          // Nearly flat density — light noise only (no big empty pockets)
          const dens = flowerDens[bid] * (0.88 + hash(fx * 0.4 + fz * 0.7) * 0.24);
          if (h2 > dens) continue;
          const kind = pickKind(bid, hash(fx * 2.1 + fz * 4.4 + 19));
          const scale = 0.75 + hash(fx + fz * 3.2) * 0.7;
          const phase = hash(fx * 0.9 + fz * 1.7) * 6.28318;
          // Mostly single blooms; rare twin nearby
          const nCluster = hash(fx * 8.1) > 0.82 ? 2 : 1;
          for (let ci = 0; ci < nCluster; ci++) {
            const ox = fx + (ci === 0 ? 0 : (hash(ci * 3.1 + fx) - 0.5) * 0.7);
            const oz = fz + (ci === 0 ? 0 : (hash(ci * 5.7 + fz) - 0.5) * 0.7);
            if (islandEdge(ox, oz) > 0.1) continue;
            const oy = sampleHeight(chunk, ox, oz) + 0.12 + hash(ci + phase) * 0.08;
            const k2 = (ci === 0) ? kind : pickKind(bid, hash(ox * 1.3 + oz));
            const sc = scale * (0.85 + hash(ci * 2.2 + oz) * 0.3);
            for (const c of corners2) {
              roseVerts.push(ox, oy, oz, c[0], c[1], k2, sc, phase + ci * 0.4, 0);
            }
            nFlowers++;
          }
        }
      }
      // rose VBO deferred until trees add ferns / leaf litter
      const birdVerts = [];
      const treeCanopies = [];

      // Rocks — solid volumetric stone meshes (baked local positions)
      // kind: 0 granite 1 sandstone 2 basalt 3 mossy 4 limestone 5 desert-red
      const rockVerts = [];
      const rockRanges = [];
      rockColliders = [];
      buildBlockers = [];
      harvestNodes = [];
      resourceRespawnQueue = [];
      // Drop previous world harvest visuals (respawned props) before rebake
      for (let i = buildPieces.length - 1; i >= 0; i--) {
        const p = buildPieces[i];
        if (p.ownerId === "world" && (p.type === "scrap_barrel" || p.type === "world_ore" || p.type === "world_tree")) {
          buildPieces.splice(i, 1);
        }
      }
      rockOccCpu.fill(0);
      // Deterministic 0..1 hash for mesh shaping
      const rh = (a, b) => {
        const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
        return s - Math.floor(s);
      };
      /** Ore mesh: kind 0=piedra, 1=metal, 2=azufre — distinct silhouettes like Rust nodes. */
      const buildStoneTris = (kind, scale, phase) => {
        // Shape family — sulfur gets flaky layered slabs; stone angular; metal lumpy
        let family = Math.floor(rh(phase, 0.37) * 5); // 0..4
        if (kind === 2) family = 5; // force sulfur sedimentary stack
        else if (kind === 1) family = family === 2 ? 0 : family; // metal: avoid flat pancake
        else if (kind === 0) family = family === 0 ? 3 : family; // stone: prefer chunks

        let rx = 1.00, ry = 0.70, rz = 0.92;
        if (family === 0) { rx = 1.00; ry = 0.78; rz = 0.96; }
        else if (family === 1) { rx = 1.35; ry = 0.58; rz = 0.78; }
        else if (family === 2) { rx = 1.25; ry = 0.45; rz = 1.15; }
        else if (family === 3) { rx = 0.85; ry = 0.95; rz = 0.80; }
        else if (family === 4) { rx = 1.15; ry = 0.68; rz = 0.70; }
        else {
          // Sulfur: compact flaky mound (not a giant hill)
          rx = 0.78; ry = 0.44; rz = 0.72;
        }
        if (kind === 1) { rx *= 1.05; ry *= 1.02; rz *= 0.95; } // metal
        if (kind === 0) { rx *= 0.95; ry *= 1.12; rz *= 0.92; } // stone
        if (kind === 2) {
          // Keep sulfur small even when candidate scale is large
          const sSul = Math.min(scale, 0.9) * 0.62;
          rx *= sSul * (0.9 + 0.2 * rh(phase, 1.1));
          ry *= sSul * (0.9 + 0.2 * rh(phase, 2.3));
          rz *= sSul * (0.9 + 0.2 * rh(phase, 3.7));
        } else {
          rx *= scale * (0.85 + 0.35 * rh(phase, 1.1));
          ry *= scale * (0.85 + 0.35 * rh(phase, 2.3));
          rz *= scale * (0.85 + 0.35 * rh(phase, 3.7));
        }
        const foot = 0.5 * (rx + rz);
        if (kind === 2) ry = Math.min(Math.max(ry, foot * 0.32), foot * 0.58);
        else ry = Math.min(Math.max(ry, foot * 0.35), foot * 0.95);

        const phi = (1 + Math.sqrt(5)) * 0.5;
        let verts = [
          [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
          [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
          [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
        ].map((p) => {
          const L = Math.hypot(p[0], p[1], p[2]) || 1;
          return [p[0] / L, p[1] / L, p[2] / L];
        });
        let faces = [
          [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
          [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
          [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
          [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
        ];
        const midCache = new Map();
        const mid = (a, b) => {
          const key = a < b ? a + "_" + b : b + "_" + a;
          if (midCache.has(key)) return midCache.get(key);
          const va = verts[a], vb = verts[b];
          const m = [va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]];
          const L = Math.hypot(m[0], m[1], m[2]) || 1;
          const idx = verts.length;
          verts.push([m[0] / L, m[1] / L, m[2] / L]);
          midCache.set(key, idx);
          return idx;
        };
        for (let sub = 0; sub < 2; sub++) {
          const faces2 = [];
          midCache.clear();
          for (const f of faces) {
            const a = f[0], b = f[1], c = f[2];
            const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
            faces2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
          }
          faces = faces2;
        }

        const leanX = (rh(phase, 4.1) - 0.5) * (kind === 2 ? 0.08 : 0.22);
        const leanZ = (rh(phase, 5.2) - 0.5) * (kind === 2 ? 0.08 : 0.22);
        const peakX = (rh(phase, 7.1) - 0.5) * (kind === 2 ? 0.2 : 0.45);
        const peakZ = (rh(phase, 8.2) - 0.5) * (kind === 2 ? 0.2 : 0.45);
        const lobeAmp = kind === 2
          ? (0.12 + rh(phase, 9.0) * 0.1)
          : (0.06 + rh(phase, 9.0) * 0.12);
        for (let i = 0; i < verts.length; i++) {
          let x = verts[i][0], y = verts[i][1], z = verts[i][2];
          const n1 = rh(x * 2.8 + phase * 3.0, z * 2.8 - phase);
          const n2 = rh(y * 3.2 + phase, x * 1.7 + z);
          const n3 = rh(x + z + phase, y * 2.0);
          let rad = 0.84 + 0.18 * n1 + 0.12 * n2 + 0.08 * n3;
          const ang = Math.atan2(z, x);
          if (kind === 2) {
            // Flaky sedimentary: horizontal plate layers + irregular edge
            rad += lobeAmp * Math.sin(ang * 4.0 + phase * 5.0);
            rad += 0.08 * Math.sin(y * 14.0 + phase * 8.0);
            y *= 0.55 + 0.45 * Math.abs(Math.sin((y + 1.0) * 3.2 + phase * 4.0));
          } else if (kind === 0) {
            // Angular stone: sharper lobes
            rad += lobeAmp * Math.sin(ang * (3 + family) + phase * 5.0);
            rad += lobeAmp * 0.7 * Math.sin(ang * 7.0 - phase * 3.0);
          } else {
            rad += lobeAmp * Math.sin(ang * (2 + family) + phase * 5.0);
            rad += lobeAmp * 0.6 * Math.sin(ang * 5.0 - phase * 3.0);
          }
          rad = Math.min(1.25, Math.max(0.68, rad));
          x *= rad * rx;
          y *= rad * ry;
          z *= rad * rz;
          x += y * leanX;
          z += y * leanZ;
          verts[i] = [x, y, z];
        }
        // Crown shaping
        {
          let ymin = Infinity, ymax = -Infinity;
          for (const p of verts) {
            if (p[1] < ymin) ymin = p[1];
            if (p[1] > ymax) ymax = p[1];
          }
          const h0 = Math.max(ymax - ymin, 0.01);
          for (const p of verts) {
            const t = (p[1] - ymin) / h0;
            if (t > 0.45) {
              const u = (t - 0.45) / 0.55;
              if (kind === 2) {
                // Stepped / flaky top plates
                const step = Math.floor(u * 4.0) / 4.0;
                const chip = 0.88 + 0.22 * rh(p[0] * 2.0 + phase, p[2] * 2.0);
                p[1] = ymin + h0 * (0.45 + 0.55 * step * chip);
              } else if (kind === 0) {
                // Faceted peak
                const dome = Math.sin(u * Math.PI * 0.5);
                const facet = 0.75 + 0.4 * rh(Math.floor(p[0] * 3) + phase, Math.floor(p[2] * 3));
                p[1] = ymin + h0 * (0.45 + 0.55 * dome * facet);
              } else {
                const dome = Math.sin(u * Math.PI * 0.5);
                const chip = 0.82 + 0.35 * rh(p[0] * 1.4 + phase * 2.0, p[2] * 1.4);
                const ridge = 1.0 + 0.12 * Math.sin(Math.atan2(p[2], p[0]) * 3.0 + phase * 6.0);
                p[1] = ymin + h0 * (0.45 + 0.55 * dome * chip * ridge);
                p[0] += peakX * rx * u * u * 0.4;
                p[2] += peakZ * rz * u * u * 0.4;
              }
            }
          }
        }

        let ymin = Infinity, ymax = -Infinity;
        let cx = 0, cz = 0;
        for (const p of verts) {
          if (p[1] < ymin) ymin = p[1];
          if (p[1] > ymax) ymax = p[1];
          cx += p[0]; cz += p[2];
        }
        cx /= verts.length; cz /= verts.length;
        const h = Math.max(ymax - ymin, 0.01);
        const baseCut = ymin + h * (0.14 + rh(phase, 11) * 0.1);
        for (const p of verts) {
          p[1] -= ymin;
          const y0 = p[1];
          const cut = baseCut - ymin;
          if (y0 < cut) {
            const k = y0 / Math.max(cut, 1e-4);
            p[1] = cut * (0.2 + 0.8 * k * k);
            const ox = p[0] - cx, oz = p[2] - cz;
            const s = 1.0 + (1 - k) * 0.18;
            p[0] = cx + ox * s;
            p[2] = cz + oz * s;
          }
        }
        ymin = Infinity;
        for (const p of verts) if (p[1] < ymin) ymin = p[1];
        for (const p of verts) p[1] -= ymin;

        // Metal: carve diagonal gash cavities (deeper recesses for crystal veins to show)
        if (kind === 1) {
          let ymax2 = 0;
          for (const p of verts) if (p[1] > ymax2) ymax2 = p[1];
          for (const p of verts) {
            const slash = Math.abs(p[0] * 0.7 + p[2] * 0.7 + phase);
            const gash = 1.0 - Math.exp(-Math.pow(slash * 2.2, 2.0));
            if (p[1] > ymax2 * 0.25) {
              p[0] *= 0.92 + 0.08 * gash;
              p[2] *= 0.92 + 0.08 * gash;
              p[1] *= 0.88 + 0.12 * gash;
            }
          }
        }

        const tris = [];
        for (const f of faces) {
          tris.push(verts[f[0]], verts[f[1]], verts[f[2]]);
        }
        return { tris, rx, rz };
      };
      const rockDens = [0.32, 0.36, 0.22, 0.42, 0.26, 0.34]; // snow denser (mountains)
      const rockSpacing = 14.0;
      const rHalf = ISLAND_HALF * 0.95;
      let nRocks = 0;
      const pickRock = (bid, h) => {
        if (bid === 0) return h < 0.4 ? 0 : (h < 0.7 ? 3 : 4);
        if (bid === 1) return h < 0.35 ? 1 : (h < 0.7 ? 5 : 0);
        if (bid === 2) return h < 0.55 ? 3 : 0;
        if (bid === 3) return h < 0.45 ? 4 : (h < 0.8 ? 0 : 2);
        if (bid === 4) return h < 0.5 ? 3 : 4;
        return h < 0.5 ? 5 : 1;
      };
      const rockRadius = (rx, rz) => Math.max(0.45, (rx + rz) * 0.48);
      // Estimate footprint before meshing (matches ~rockRadius after build)
      const estRockR = (scale) => Math.max(0.35, scale * 0.95);
      const rockCandidates = [];
      for (let gz = -rHalf; gz <= rHalf; gz += rockSpacing) {
        for (let gx = -rHalf; gx <= rHalf; gx += rockSpacing) {
          const h0 = hash(gx * 31.7 + gz * 17.3 + chunk.seed * 0.03 + 4.4);
          const h1 = hash(gx * 9.1 - gz * 22.6 + 55.0);
          const h2 = hash(gx * 5.5 + gz * 8.2 + 101.0);
          const rx = gx + (h0 - 0.5) * rockSpacing * 0.75;
          const rz = gz + (h1 - 0.5) * rockSpacing * 0.75;
          if (rx * rx + rz * rz > rHalf * rHalf) continue;
          if (rx * rx + rz * rz < 18 * 18) continue;
          if (islandEdge(rx, rz) > 0.07) continue;
          const ry0 = sampleHeight(chunk, rx, rz);
          if (ry0 < 0.02 || ry0 > 14) continue;
          const bid = biomeAtJs(rx, rz);
          let dens = rockDens[bid] * (0.85 + hash(rx * 0.3 + rz * 0.5) * 0.35);
          if (ry0 > 4.2) dens *= 1.35; // mountainous
          if (bid === 3) dens *= 1.2;
          const pocket = hash(Math.floor(rx / 36) * 11.3 + Math.floor(rz / 36) * 29.1);
          if (pocket > 0.75) dens *= 1.65;
          else if (pocket < 0.18) dens *= 0.4;
          if (h2 > dens) continue;
          const kind = pickRock(bid, hash(rx * 2.7 + rz * 1.9 + 7));
          // ~½ prior size: readable pebbles → mid boulders (no house-sized rocks)
          const scale = 0.38 + hash(rx * 1.1 + rz * 3.3) * 0.72;
          const yaw = hash(rz * 6.2 - rx) * Math.PI * 2;
          const phase = hash(rx * 0.8 + rz * 1.4);
          rockCandidates.push({ x: rx, y: ry0 + 0.015, z: rz, kind, scale, yaw, phase });
          // Occasional pebble nearby — keep clear of the main stone
          if (hash(rx * 4.1 + 9) > 0.72) {
            const ox = rx + (hash(rz + 1) > 0.5 ? 1 : -1) * (1.5 + hash(rx) * 1.1) * scale;
            const oz = rz + (hash(rx + 2) > 0.5 ? 1 : -1) * (1.5 + hash(rz) * 1.1) * scale;
            if (islandEdge(ox, oz) <= 0.08) {
              const oy2 = sampleHeight(chunk, ox, oz) + 0.015;
              if (oy2 >= 0.02) {
                const sc2 = Math.max(0.28, scale * (0.38 + hash(ox) * 0.28));
                const k2 = pickRock(bid, hash(ox * 1.7));
                rockCandidates.push({ x: ox, y: oy2, z: oz, kind: k2, scale: sc2, yaw: yaw + 1.1, phase: phase + 0.2 });
              }
            }
          }
        }
      }

      // Biome trees — multi-part: flared trunk + twigs + lobed canopy / conical pine
      const treeVerts = [];
      treeColliders = [];
      /** Canopy footprints — keep rocks outside foliage, not just trunks */
      const treeClearances = [];
      const treeRanges = []; // {x,z,start,count} for distance draw
      const corners01 = [
        [-1, 0], [1, 0], [-1, 1],
        [1, 0], [1, 1], [-1, 1],
      ];
      const corners11 = [
        [-1, -1], [1, -1], [-1, 1],
        [1, -1], [1, 1], [-1, 1],
      ];
      const pushCross = (ox, oy, oz, corners, species, scale, yaw, phase, part, nPlanes) => {
        for (let p = 0; p < nPlanes; p++) {
          const px = part * 10 + p;
          for (const c of corners) {
            treeVerts.push(ox, oy, oz, c[0], c[1], species, scale, yaw, phase, px);
          }
        }
      };
      /** Solid tapered trunk/stump. part_x=100+part keeps it separate from canopy cards. */
      const pushTrunkCyl = (ox, oy, oz, species, scale, yaw, phase, part, segs) => {
        const px = 100 + part;
        const n = Math.max(8, segs | 0);
        for (let i = 0; i < n; i++) {
          const u0 = i / n;
          const u1 = (i + 1) / n;
          const quad = [[u0, 0], [u1, 0], [u0, 1], [u1, 0], [u1, 1], [u0, 1]];
          for (const c of quad) {
            treeVerts.push(ox, oy, oz, c[0], c[1], species, scale, yaw, phase, px);
          }
        }
      };
      /** Sealed cut face: fixed stump (part 5) or falling bole base (part 6). */
      const pushStumpCap = (ox, oy, oz, species, scale, yaw, phase, segs, part = 5) => {
        const px = 100 + part;
        const n = Math.max(8, segs | 0);
        for (let i = 0; i < n; i++) {
          const u0 = i / n;
          const u1 = (i + 1) / n;
          const tri = [[u0, 0], [u0, 1], [u1, 1]];
          for (const c of tri) {
            treeVerts.push(ox, oy, oz, c[0], c[1], species, scale, yaw, phase, px);
          }
        }
      };
      const trunkRadius = (species, scale) => {
        // Matches visual base half-width + flare; solid for gameplay
        // 0 oak 1 pine 2 maple 3 willow 4 scrub 5 cactus 6 snow-fir 7 birch 8 poplar 9 cedar 10 palm
        const base = [0.46, 0.30, 0.36, 0.42, 0.22, 0.38, 0.32, 0.20, 0.22, 0.34, 0.28][species] || 0.34;
        return Math.max(0.28, base * scale);
      };
      // dens + spacing by biome — denser island-wide coverage + richer mix
      // biomes: 0 meadow 1 dry 2 forest 3 snow 4 marsh 5 desert
      const dens = [0.28, 0.16, 0.82, 0.42, 0.38, 0.09];
      const spacingBiome = [9.5, 10.0, 6.2, 8.5, 7.5, 11.5];
      const PHYLLO = 2.399963; // golden angle rad (137.5°) — sedon phyllotaxis
      const half = ISLAND_HALF * 0.98;
      let nTrees = 0;
      // Triple-pass grid: base cover + forest/marsh/snow fill + meadow/dry/desert fillers
      for (let pass = 0; pass < 3; pass++) {
        const spacing = pass === 0 ? 7.5 : pass === 1 ? 5.8 : 9.0;
        for (let gz = -half; gz <= half; gz += spacing) {
          for (let gx = -half; gx <= half; gx += spacing) {
            const h0 = hash(gx * 12.9898 + gz * 78.233 + chunk.seed * 0.01 + pass * 17.3);
            const h1 = hash(gx * 4.1 + gz * 9.7 + 19.2 + pass);
            const h2 = hash(gx * 2.3 - gz * 5.5 + 7.7 + pass * 3.1);
            const wx = gx + (h0 - 0.5) * spacing * 0.82;
            const wz = gz + (h1 - 0.5) * spacing * 0.82;
            if (wx * wx + wz * wz > half * half) continue;
            if (wx * wx + wz * wz < 16 * 16) continue;
            const wy = sampleHeight(chunk, wx, wz);
            // No beach/cliff floaters (height lerp over sea cliffs)
            if (!treeGroundOk(wx, wz, wy)) continue;
            const bid = biomeAtJs(wx, wz);
            // Pass roles: 0 all biomes, 1 forest/marsh/snow densify, 2 meadow/dry/desert fillers
            if (pass === 1 && bid !== 2 && bid !== 3 && bid !== 4) continue;
            if (pass === 2 && bid !== 0 && bid !== 1 && bid !== 5) continue;
            let dChance = dens[bid];
            if (pass === 1) dChance *= 0.7;
            if (pass === 2) dChance *= 0.45;
            // Local grove clusters (sedon distribute feel)
            const grove = hash(Math.floor(wx / 32) * 19.1 + Math.floor(wz / 32) * 47.3);
            if (grove > 0.68) dChance *= 1.7;
            else if (grove < 0.18) dChance *= 0.5;
            if (h2 > dChance) continue;
            // Skip if too close to existing collider (keep silhouettes clean)
            let crowded = false;
            const minSp = (spacingBiome[bid] || 10) * 0.42;
            for (let ci = 0; ci < treeColliders.length; ci++) {
              const dx = wx - treeColliders[ci].x;
              const dz = wz - treeColliders[ci].z;
              if (dx * dx + dz * dz < minSp * minSp) { crowded = true; break; }
            }
            if (crowded) continue;

            const hs = hash(wx * 3.1 + wz * 1.7 + 33);
            let species = 0;
            // Richer per-biome species mixes (11 species)
            if (bid === 0) {
              // meadow: oak, birch, maple, poplar, rare pine
              if (hs < 0.34) species = 0;
              else if (hs < 0.58) species = 7;
              else if (hs < 0.76) species = 2;
              else if (hs < 0.92) species = 8;
              else species = 1;
            } else if (bid === 1) {
              // dry: scrub, oak, palm, cedar, rare birch
              if (hs < 0.42) species = 4;
              else if (hs < 0.62) species = 0;
              else if (hs < 0.78) species = 10;
              else if (hs < 0.92) species = 9;
              else species = 7;
            } else if (bid === 2) {
              // forest: pine, oak, maple, cedar, birch, poplar
              if (hs < 0.22) species = 1;
              else if (hs < 0.40) species = 0;
              else if (hs < 0.55) species = 2;
              else if (hs < 0.70) species = 9;
              else if (hs < 0.85) species = 7;
              else species = 8;
            } else if (bid === 3) {
              // snow: fir + cedar + rare pine
              if (hs < 0.72) species = 6;
              else if (hs < 0.90) species = 9;
              else species = 1;
            } else if (bid === 4) {
              // marsh: willow, birch, oak, palm, maple
              if (hs < 0.40) species = 3;
              else if (hs < 0.62) species = 7;
              else if (hs < 0.78) species = 0;
              else if (hs < 0.90) species = 10;
              else species = 2;
            } else if (bid === 5) {
              // desert: cactus + palm + scrub
              if (hs < 0.55) species = 5;
              else if (hs < 0.82) species = 10;
              else species = 4;
            }

            const uSize = hash(wx * 1.37 + wz * 4.19 + 11.3);
            const uSize2 = hash(wz * 2.71 - wx * 0.91 + 5.5);
            const sizeCurve = Math.pow(uSize, 0.82) * (0.72 + 0.28 * uSize2);
            let baseS = 0.62, spanS = 1.55;
            if (species === 4) { baseS = 0.5; spanS = 1.0; }
            else if (species === 5) { baseS = 0.68; spanS = 1.15; }
            else if (species === 3) { baseS = 0.78; spanS = 1.4; }
            else if (species === 1 || species === 6 || species === 9) { baseS = 0.7; spanS = 1.7; }
            else if (species === 7) { baseS = 0.7; spanS = 1.35; }
            else if (species === 8) { baseS = 0.85; spanS = 1.55; }
            else if (species === 10) { baseS = 0.75; spanS = 1.35; }
            const scale = baseS + sizeCurve * spanS;
            const yaw = hash(wz * 8.1 - wx) * Math.PI * 2;
            const phase = hash(wx * 0.7 + wz * 1.3);
            const isPine = species === 1 || species === 6 || species === 9;
            const isCactus = species === 5;
            const isPalm = species === 10;

            const treeVertStart = treeVerts.length / 10;
            pushTrunkCyl(wx, wy, wz, species, scale, yaw, phase, 4, 16);
            pushStumpCap(wx, wy, wz, species, scale, yaw, phase, 16);
            pushStumpCap(wx, wy, wz, species, scale, yaw, phase, 16, 6);
            pushTrunkCyl(wx, wy, wz, species, scale, yaw, phase, 0, 20);
            treeColliders.push({ x: wx, z: wz, r: trunkRadius(species, scale) });
            // Foliage / crown radius (visual) + margin so boulders don't sit in needles
            let clearR = scale * 2.35;
            if (isPine) clearR = scale * 2.15;
            else if (isCactus) clearR = scale * 1.35;
            else if (isPalm) clearR = scale * 2.0;
            else if (species === 4) clearR = scale * 1.55; // scrub
            else if (species === 7 || species === 8) clearR = scale * 2.05; // birch / poplar
            else clearR = scale * 2.55; // oak / maple / willow
            const clear = clearR + 1.1;
            treeClearances.push({ x: wx, z: wz, r: clear });
            // Building blockers = trunk only (+ small pad). Canopy must NOT block snug foundations.
            const trunkR = trunkRadius(species, scale);
            buildBlockers.push({
              x: wx, z: wz,
              r: Math.max(0.42, trunkR + 0.22),
              kind: "tree",
            });
            harvestNodes.push({
              kind: "tree", x: wx, y: wy, z: wz, r: Math.max(0.55, clear * 0.5),
              hp: 250, maxHp: 250, dropId: "wood", dropPerHit: 40, dead: false,
              meshStart: treeVertStart | 0, meshCount: 0,
              species: species | 0, treeScale: scale, treeYaw: yaw,
            });

            if (isCactus) {
              const armY1 = wy + 1.35 * scale;
              const armY2 = wy + 1.7 * scale;
              pushCross(wx + 0.55 * scale, armY1, wz, corners01, species, scale * 0.52, yaw, phase, 0, 2);
              pushCross(wx - 0.5 * scale, armY2, wz, corners01, species, scale * 0.48, yaw + 1.2, phase, 0, 2);
              if (hash(wx + 9) > 0.55) {
                pushCross(wx + 0.15 * scale, wy + 2.05 * scale, wz + 0.4 * scale, corners01, species, scale * 0.38, yaw + 2.0, phase, 0, 2);
              }
              treeColliders.push({ x: wx + 0.55 * scale, z: wz, r: trunkRadius(5, scale * 0.5) });
              treeColliders.push({ x: wx - 0.5 * scale, z: wz, r: trunkRadius(5, scale * 0.48) });
            } else if (isPine) {
              // Conical pine — long visible bole + canopy that meets the trunk (no floating crown)
              const trunkH = (species === 6 ? 4.9 : species === 9 ? 5.0 : 4.6) * scale;
              const nLayers = species === 6 ? 11 : species === 9 ? 12 : 11;
              // Collar disc bridges bark → needles
              pushCross(wx, wy + trunkH * 0.40, wz, corners11, species, scale * 1.15, yaw, phase + 0.2, 2, 4);
              for (let li = 0; li < nLayers; li++) {
                const t = li / (nLayers - 1);
                // Foliage from ~38% up — clears wood while closing the gap
                const ty = wy + trunkH * (0.38 + t * 0.60);
                const layerR = scale * (1.58 - t * 1.12) * (species === 9 ? 1.12 : 1.0);
                const layerPh = phase + t * 0.85;
                const yawL = yaw + li * 0.31;
                pushCross(wx, ty, wz, corners11, species, layerR, yawL, layerPh, 2, 4);
                const nRing = t > 0.88 ? 4 : 6;
                for (let ri = 0; ri < nRing; ri++) {
                  const a = yawL + (ri / nRing) * Math.PI * 2 + hash(li * 9 + ri) * 0.4;
                  const out = layerR * (0.22 + hash(li + ri * 3.1) * 0.16);
                  pushCross(
                    wx + Math.cos(a) * out,
                    ty - (0.10 + (1.0 - t) * 0.16) * scale,
                    wz + Math.sin(a) * out,
                    corners11,
                    species,
                    layerR * (0.62 + hash(ri * 2.2 + li) * 0.22),
                    a,
                    layerPh + ri * 0.04,
                    2,
                    3
                  );
                }
              }
              pushCross(wx, wy + trunkH * 0.97, wz, corners11, species, scale * 0.55, yaw, phase + 0.9, 2, 4);
              pushCross(wx, wy + trunkH * 1.02, wz, corners11, species, scale * 0.32, yaw + 0.4, phase + 0.95, 2, 3);
            } else if (isPalm) {
              // Palm — tall bare trunk; fronds only at the crown
              const trunkH = 5.4 * scale;
              const crownY = wy + trunkH * 0.98;
              const nFronds = 10;
              for (let fi = 0; fi < nFronds; fi++) {
                const a = yaw + fi * (Math.PI * 2 / nFronds) + phase * 0.4;
                const out = (0.2 + hash(fi * 3.1 + wx) * 0.25) * scale;
                const px = wx + Math.cos(a) * out;
                const pz = wz + Math.sin(a) * out;
                const py = crownY + (hash(fi + phase) - 0.35) * 0.2 * scale;
                pushCross(px, py, pz, corners11, species, scale * (0.85 + hash(fi) * 0.25), a, phase + fi * 0.03, 2, 3);
              }
              // Center tuft
              pushCross(wx, crownY + 0.1 * scale, wz, corners11, species, scale * 0.7, yaw, phase, 2, 3);
              // Drooping tips
              for (let di = 0; di < 6; di++) {
                const a = yaw + di * PHYLLO + phase;
                const rr = (0.55 + hash(di * 2.2) * 0.35) * scale;
                pushCross(
                  wx + Math.cos(a) * rr,
                  crownY - (0.15 + hash(di) * 0.28) * scale,
                  wz + Math.sin(a) * rr,
                  corners11, species, scale * 0.55, a, phase + 0.1, 2, 2
                );
              }
            } else if (species === 3) {
              // Willow — tall bole, umbrella meets trunk
              const trunkH = 4.8 * scale;
              for (let bi = 0; bi < 5; bi++) {
                const by = wy + trunkH * (0.52 + bi * 0.08 + hash(wx + bi * 9) * 0.03);
                const bYaw = yaw + bi * PHYLLO + phase;
                pushCross(wx, by, wz, corners01, species, scale * 0.92, bYaw, phase + bi * 0.06, 1, 3);
              }
              const crownY = wy + trunkH * 0.86;
              for (let pi = 0; pi < 8; pi++) {
                const a = yaw + pi * PHYLLO + phase;
                const rr = (0.15 + hash(wz + pi * 3.1) * 0.4) * scale;
                const px = wx + Math.cos(a) * rr;
                const pz = wz + Math.sin(a) * rr;
                const py = crownY + (0.02 + hash(px + pi) * 0.3) * scale;
                pushCross(px, py, pz, corners11, species, scale * (0.5 + hash(pi) * 0.22), a, (phase * 0.3 + pi * 0.04) % 0.65, 2, 3);
              }
              pushCross(wx, crownY + 0.18 * scale, wz, corners11, species, scale * 0.75, yaw, phase * 0.35 % 0.65, 2, 3);
              // Long hanging curtains (tropism down) — keep above mid-bole
              for (let hi = 0; hi < 12; hi++) {
                const a = yaw + hi * PHYLLO * 0.85 + phase * 1.3;
                const rr = (0.35 + hash(wx + hi * 4.1) * 0.4) * scale;
                const px = wx + Math.cos(a) * rr;
                const pz = wz + Math.sin(a) * rr;
                const py = crownY - (0.18 + hash(hi + phase) * 0.4) * scale;
                const hPhase = 0.72 + hash(hi * 1.7) * 0.26;
                pushCross(px, py, pz, corners11, species, scale * (0.48 + hash(hi) * 0.18), a, hPhase, 2, 3);
              }
            } else {
              // Deciduous — long timber bole; crown starts high so wood is harvest-readable
              const trunkH = (
                species === 4 ? 2.35 :
                species === 2 ? 5.1 :
                species === 7 ? 5.2 :
                species === 8 ? 6.0 :
                4.85
              ) * scale;
              const nBr = species === 4 ? 4 : (species === 8 ? 5 : species === 2 || species === 7 ? 6 : 7);
              const branchTips = [];
              for (let bi = 0; bi < nBr; bi++) {
                const tAlong = (species === 4 ? 0.40 : 0.50) + bi * 0.065;
                const by = wy + trunkH * (tAlong + hash(wx + bi * 9) * 0.03);
                const bYaw = yaw + bi * PHYLLO + phase;
                const bLen = scale * (0.9 + bi * 0.05);
                pushCross(wx, by, wz, corners01, species, bLen, bYaw, phase + bi * 0.05, 1, 4);
                // Tip position for leaf cards
                const tipR = (0.35 + bi * 0.08) * scale;
                branchTips.push({
                  x: wx + Math.cos(bYaw) * tipR,
                  y: by + 0.25 * scale,
                  z: wz + Math.sin(bYaw) * tipR,
                  a: bYaw,
                });
              }
              const crownY = wy + trunkH * (species === 4 ? 0.82 : 0.84);
              const nPlanes = species === 4 ? 5 : 6;

              // Phyllotaxis cloud — spiral leaf clusters (not perfect rings)
              const nPuff = species === 4 ? 14 : species === 8 ? 22 : species === 7 ? 28 : 34;
              for (let pi = 0; pi < nPuff; pi++) {
                const a = yaw + pi * PHYLLO + phase * 1.3;
                // Radius grows then softens (dome envelope)
                const u = pi / Math.max(1, nPuff - 1);
                const rr = (0.08 + Math.sqrt(u) * 0.95 * (0.55 + hash(pi * 2.1) * 0.45)) * scale
                  * (species === 4 ? 0.8 : species === 8 ? 0.62 : species === 7 ? 0.95 : 1.18);
                const px = wx + Math.cos(a) * rr;
                const pz = wz + Math.sin(a) * rr;
                // Height: lower near rim, taller near core (dome) — stay above bole
                const hDome = Math.max(0, 1.0 - (rr / (1.35 * scale)) * (rr / (1.35 * scale)));
                const py = crownY + (hDome * 0.85 + hash(px + pi) * 0.28 - 0.04) * scale
                  * (species === 4 ? 0.55 : species === 8 ? 1.2 : 0.95);
                const pScale = scale * (0.55 + hash(pi + phase) * 0.5) * (0.75 + hDome * 0.35);
                pushCross(px, py, pz, corners11, species, pScale, a + hash(pi) * 0.8, phase + pi * 0.03, 2, nPlanes);
              }
              // Core stack for solid silhouette
              if (species !== 4) {
                pushCross(wx, crownY + 0.12 * scale, wz, corners11, species, scale * 1.12, yaw, phase, 2, 4);
                pushCross(wx + 0.1 * scale, crownY + 0.42 * scale, wz - 0.08 * scale, corners11, species, scale * 1.18, yaw + 0.5, phase + 0.06, 2, 4);
                pushCross(wx - 0.1 * scale, crownY + 0.72 * scale, wz + 0.1 * scale, corners11, species, scale * 1.05, yaw + 1.0, phase + 0.12, 2, 3);
                pushCross(wx, crownY + 1.0 * scale, wz, corners11, species, scale * 0.85, yaw + 1.4, phase + 0.2, 2, 3);
                pushCross(wx, crownY + 1.22 * scale, wz, corners11, species, scale * 0.58, yaw + 1.8, phase + 0.28, 2, 3);
              } else {
                pushCross(wx, crownY + 0.08 * scale, wz, corners11, species, scale * 0.95, yaw, phase, 2, 3);
                pushCross(wx, crownY + 0.32 * scale, wz, corners11, species, scale * 0.72, yaw + 0.6, phase + 0.1, 2, 3);
              }
              // Leaf cards at branch tips (sedon sample-points idea)
              for (let ti = 0; ti < branchTips.length; ti++) {
                const tip = branchTips[ti];
                const nCards = species === 4 ? 2 : 3;
                for (let c = 0; c < nCards; c++) {
                  const ca = tip.a + c * PHYLLO * 0.5 + hash(ti * 7 + c);
                  const cr = (0.08 + c * 0.06) * scale;
                  pushCross(
                    tip.x + Math.cos(ca) * cr,
                    tip.y + (0.05 + hash(c + ti) * 0.18) * scale,
                    tip.z + Math.sin(ca) * cr,
                    corners11, species, scale * (0.28 + hash(c) * 0.18), ca, phase + 0.15, 2, 2
                  );
                }
              }
            }
            // Undergrowth + canopy flock around this tree
            if (!isCactus) {
              const nFern = 1 + ((hash(wx * 3.1 + 2.2) > 0.45) ? 1 : 0) + ((hash(wz * 2.7) > 0.7) ? 1 : 0);
              for (let fi = 0; fi < nFern; fi++) {
                const ang = hash(wx + fi * 7.1 + phase) * Math.PI * 2;
                const rad = (0.55 + hash(fi + wz) * 1.1) * scale;
                const fx = wx + Math.cos(ang) * rad;
                const fz = wz + Math.sin(ang) * rad;
                if (islandEdge(fx, fz) > 0.1) continue;
                const fy = sampleHeight(chunk, fx, fz) + 0.04;
                const fsc = 0.7 + hash(fi * 1.9 + fx) * 0.7;
                const fph = phase + fi * 0.37;
                for (const c of corners2) {
                  roseVerts.push(fx, fy, fz, c[0], c[1], 9, fsc, fph, 0);
                }
              }
              const nLitter = 2 + ((hash(phase + 4.4) * 3) | 0);
              for (let li = 0; li < nLitter; li++) {
                const ang = hash(wz * 1.3 + li * 5.5) * Math.PI * 2;
                const rad = (0.4 + hash(li + wx) * 1.6) * scale;
                const lx = wx + Math.cos(ang) * rad;
                const lz = wz + Math.sin(ang) * rad;
                if (islandEdge(lx, lz) > 0.1) continue;
                const ly = sampleHeight(chunk, lx, lz) + 0.02;
                const lsc = 0.55 + hash(li * 2.2) * 0.55;
                for (const c of corners2) {
                  roseVerts.push(lx, ly, lz, c[0], c[1], 10, lsc, phase + li * 0.2, 0);
                }
              }
              // Record canopy for tree-to-tree bird routes
              const canopyY = wy + scale * (isPine ? 3.8 : isPalm ? 5.0 : 4.4);
              treeCanopies.push({ x: wx, y: canopyY, z: wz, bid });
            }
            nTrees++;
            const treeCount = (treeVerts.length / 10 - treeVertStart) | 0;
            treeRanges.push({
              x: wx, z: wz,
              start: treeVertStart | 0,
              count: treeCount,
            });
            {
              const hn = harvestNodes[harvestNodes.length - 1];
              if (hn && hn.kind === "tree" && hn.meshStart === (treeVertStart | 0)) {
                hn.meshCount = treeCount;
              }
            }
          }
        }
      }
      const tArr = new Float32Array(treeVerts);
      treeMeshCpu = tArr;
      if (treeVbo) try { treeVbo.destroy(); } catch (_) {}
      if (tArr.byteLength > 0) {
        treeVbo = device.createBuffer({
          size: tArr.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          mappedAtCreation: true,
        });
        new Float32Array(treeVbo.getMappedRange()).set(tArr);
        treeVbo.unmap();
        treeVertCount = tArr.length / 10;
      } else {
        treeVbo = null;
        treeVertCount = 0;
        treeMeshCpu = null;
      }
      // Flowers + forest undergrowth (ferns / litter)
      {
        const rArr = new Float32Array(roseVerts);
        if (roseVbo) try { roseVbo.destroy(); } catch (_) {}
        if (rArr.byteLength > 0) {
          roseVbo = device.createBuffer({
            size: rArr.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
          });
          new Float32Array(roseVbo.getMappedRange()).set(rArr);
          roseVbo.unmap();
          roseVertCount = rArr.length / 9;
        } else {
          roseVbo = null;
          roseVertCount = 0;
        }
      }
      // Tree-to-tree bird / butterfly routes — bias toward near-player bubble
      {
        const caps = treeCanopies;
        const nCap = caps.length;
        if (nCap >= 2) {
          const px0 = (typeof player !== "undefined" && player) ? player.x : 0;
          const pz0 = (typeof player !== "undefined" && player) ? player.z : 0;
          const nearIdx = [];
          for (let ci = 0; ci < nCap; ci++) {
            const c = caps[ci];
            if (Math.hypot(c.x - px0, c.z - pz0) < 95) nearIdx.push(ci);
          }
          const nFly = Math.min(120, Math.max(24, Math.floor(nCap / 3.5)));
          for (let fi = 0; fi < nFly; fi++) {
            let i0;
            if (nearIdx.length >= 2 && (fi % 3 !== 2)) {
              i0 = nearIdx[(hash(fi * 17.3 + chunk.seed * 0.1) * nearIdx.length) | 0];
            } else {
              i0 = (hash(fi * 17.3 + chunk.seed * 0.1) * nCap) | 0;
            }
            const a = caps[i0];
            let best = -1;
            let bestD = 1e9;
            for (let k = 0; k < 16; k++) {
              const j = (hash(fi * 9.1 + k * 3.7 + 2.2) * nCap) | 0;
              if (j === i0) continue;
              const b = caps[j];
              const d = Math.hypot(b.x - a.x, b.z - a.z);
              if (d < 5 || d > 40) continue;
              if (d < bestD) { bestD = d; best = j; }
            }
            if (best < 0) {
              best = (i0 + 1 + ((hash(fi + 4) * (nCap - 1)) | 0)) % nCap;
              if (best === i0) best = (i0 + 1) % nCap;
            }
            const b = caps[best];
            const d = Math.hypot(b.x - a.x, b.z - a.z) || 12;
            const spRoll = hash(fi * 5.5 + a.x);
            let sp = 0;
            if (spRoll > 0.68) sp = 3;
            else if (spRoll > 0.44) sp = 1;
            else if (spRoll > 0.24) sp = 2;
            if (sp === 3 && d > 18) {
              let cj = best; let cd = d;
              for (let k = 0; k < 16; k++) {
                const j = (hash(fi * 2.1 + k * 8.8) * nCap) | 0;
                if (j === i0) continue;
                const bb = caps[j];
                const dd = Math.hypot(bb.x - a.x, bb.z - a.z);
                if (dd >= 4 && dd < cd && dd < 14) { cd = dd; cj = j; }
              }
              best = cj;
            }
            const b2 = caps[best];
            const dist = Math.hypot(b2.x - a.x, b2.z - a.z) || 10;
            const bsc = sp === 3 ? (0.68 + hash(fi) * 0.32) : (1.05 + hash(fi + 2) * 0.45);
            const bph = hash(fi * 1.7 + a.z) * 0.97;
            const tripHz = sp === 3
              ? (0.15 + hash(fi * 3.3) * 0.12)
              : (0.08 + (18 / Math.max(dist, 10)) * 0.05 + hash(fi) * 0.04);
            for (const c of corners2) {
              birdVerts.push(
                a.x, a.y, a.z,
                c[0], c[1],
                sp, bsc, bph, tripHz,
                b2.x, b2.y, b2.z
              );
            }
          }
        }
      }
      // Flying birds / butterflies among canopies
      {
        const bArr = new Float32Array(birdVerts);
        if (birdVbo) try { birdVbo.destroy(); } catch (_) {}
        if (bArr.byteLength > 0) {
          birdVbo = device.createBuffer({
            size: bArr.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
          });
          new Float32Array(birdVbo.getMappedRange()).set(bArr);
          birdVbo.unmap();
          birdVertCount = bArr.length / 12;
        } else {
          birdVbo = null;
          birdVertCount = 0;
        }
      }
      // Rocks after trees — reject candidates that clip into canopy
      const rockNearTree = (x, z, rr) => {
        for (let i = 0; i < treeClearances.length; i++) {
          const t = treeClearances[i];
          const minD = t.r + rr;
          const dx = x - t.x, dz = z - t.z;
          if (dx * dx + dz * dz < minD * minD) return true;
        }
        return false;
      };
      const pushRock = (ox, oy, oz, _legacyKind, scale, yaw, phase) => {
        const start = rockVerts.length / 10;
        const bid = biomeAtJs(ox, oz);
        const oreRoll = (Math.abs(Math.sin(ox * 12.9898 + oz * 78.233)) * 43758.5453) % 1;
        const mtn = oy > 3.6 || bid === 3 || centerMtnHeight(ox, oz) > 1.4;
        let oreKind = "rock";
        // ~6% sulfur · metal favors mountains · stone common
        if (oreRoll < 0.06) oreKind = "sulfur";
        else if (mtn) oreKind = oreRoll < 0.48 ? "metal" : "rock";
        else oreKind = oreRoll < 0.16 ? "metal" : "rock";
        const kind = oreKind === "metal" ? 1 : (oreKind === "sulfur" ? 2 : 0);
        let meshScale = scale;
        if (oreKind === "sulfur") meshScale = Math.min(scale, 0.95) * 0.52;
        else if (oreKind === "metal") meshScale = scale * (0.85 + (mtn ? 0.15 : 0.0));
        const built = buildStoneTris(kind, meshScale, phase);
        for (const p of built.tris) {
          rockVerts.push(ox, oy, oz, p[0], p[1], kind, meshScale, yaw, phase, p[2]);
        }
        rockRanges.push({
          x: ox, z: oz,
          start: start | 0,
          count: (rockVerts.length / 10 - start) | 0,
        });
        const rr = rockRadius(built.rx, built.rz);
        rockColliders.push({ x: ox, z: oz, r: rr });
        buildBlockers.push({ x: ox, z: oz, r: Math.max(0.7, rr * 1.25), kind: "rock" });
        const st = oreStatsForSize(oreKind, meshScale);
        harvestNodes.push({
          kind: st.kind,
          x: ox, y: oy, z: oz, r: Math.max(0.45, rr * 0.85),
          hp: st.hp,
          maxHp: st.hp,
          dropId: st.dropId,
          dropPerHit: st.dropPerHit,
          hqChance: st.hqChance,
          sizeMul: st.sizeMul,
          dead: false,
          meshStart: start | 0,
          meshCount: (rockVerts.length / 10 - start) | 0,
        });
        stampRockOcc(ox, oz, rr);
        nRocks++;
      };
      for (let i = 0; i < rockCandidates.length; i++) {
        const c = rockCandidates[i];
        const er = estRockR(c.scale);
        if (rockNearTree(c.x, c.z, er)) continue;
        // Also keep pebbles from overlapping an already-accepted boulder
        let nearRock = false;
        for (let j = 0; j < rockColliders.length; j++) {
          const r = rockColliders[j];
          const minD = r.r + er * 0.85;
          const dx = c.x - r.x, dz = c.z - r.z;
          if (dx * dx + dz * dz < minD * minD) { nearRock = true; break; }
        }
        if (nearRock) continue;
        pushRock(c.x, c.y, c.z, c.kind, c.scale, c.yaw, c.phase);
      }

      // World scrap chests removed (old procedural loot chests).
      // Placeable box_large / box_small use Animated Old Chest mesh instead.

      rockOccBase = new Float32Array(rockOccCpu);
      device.queue.writeBuffer(rockOccBuf, 0, rockOccCpu);
      const rockArr = new Float32Array(rockVerts);
      rockMeshCpu = rockArr;
      if (rockVbo) try { rockVbo.destroy(); } catch (_) {}
      if (rockArr.byteLength > 0) {
        rockVbo = device.createBuffer({
          size: rockArr.byteLength,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          mappedAtCreation: true,
        });
        new Float32Array(rockVbo.getMappedRange()).set(rockArr);
        rockVbo.unmap();
        rockVertCount = rockArr.length / 10;
      } else {
        rockVbo = null;
        rockVertCount = 0;
        rockMeshCpu = null;
      }

      onHud({ status: "árboles " + nTrees + " · rocas " + nRocks + " · flores " + nFlowers });
      treeDrawRanges = treeRanges;
      rockDrawRanges = rockRanges;
    }

    function hash(n) {
      const s = Math.sin(n * 127.1) * 43758.5453;
      return s - Math.floor(s);
    }

    function solidHit(px, pz) {
      const pr = PLAYER_RADIUS;
      for (let i = 0; i < treeColliders.length; i++) {
        const t = treeColliders[i];
        const dx = px - t.x;
        const dz = pz - t.z;
        const minD = pr + t.r;
        if (dx * dx + dz * dz < minD * minD) return true;
      }
      for (let i = 0; i < rockColliders.length; i++) {
        const t = rockColliders[i];
        const dx = px - t.x;
        const dz = pz - t.z;
        const minD = pr + t.r;
        if (dx * dx + dz * dz < minD * minD) return true;
      }
      for (let i = 0; i < buildColliders.length; i++) {
        const b = buildColliders[i];
        if (!playerOverlapsY(b)) continue;
        if (aabbCircleHit(px, pz, pr, b)) return true;
      }
      return false;
    }

    /** Push player out of overlapping trunks and boulders. */
    function resolveSolids() {
      const pr = PLAYER_RADIUS;
      const lists = [treeColliders, rockColliders];
      // build AABBs handled below
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let li = 0; li < lists.length; li++) {
          const list = lists[li];
          for (let i = 0; i < list.length; i++) {
            const t = list[i];
            const dx = player.x - t.x;
            const dz = player.z - t.z;
            const d2 = dx * dx + dz * dz;
            const minD = pr + t.r;
            if (d2 < minD * minD) {
              if (d2 < 1e-8) {
                player.x = t.x + minD;
                player.z = t.z;
              } else {
                const d = Math.sqrt(d2);
                const s = minD / d;
                player.x = t.x + dx * s;
                player.z = t.z + dz * s;
              }
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      // Push out of build AABBs (xz)
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        const pr = PLAYER_RADIUS;
        for (let i = 0; i < buildColliders.length; i++) {
          const b = buildColliders[i];
          if (!playerOverlapsY(b)) continue;
          if (!aabbCircleHit(player.x, player.z, pr, b)) continue;
          const cx = Math.max(b.minX, Math.min(player.x, b.maxX));
          const cz = Math.max(b.minZ, Math.min(player.z, b.maxZ));
          let dx = player.x - cx;
          let dz = player.z - cz;
          if (dx * dx + dz * dz < 1e-8) {
            // Inside box — push toward nearest face
            const left = player.x - b.minX;
            const right = b.maxX - player.x;
            const near = player.z - b.minZ;
            const far = b.maxZ - player.z;
            const m = Math.min(left, right, near, far);
            if (m === left) player.x = b.minX - pr;
            else if (m === right) player.x = b.maxX + pr;
            else if (m === near) player.z = b.minZ - pr;
            else player.z = b.maxZ + pr;
          } else {
            const d = Math.sqrt(dx * dx + dz * dz) || 1e-6;
            const s = pr / d;
            player.x = cx + dx * s;
            player.z = cz + dz * s;
          }
          moved = true;
        }
        if (!moved) break;
      }
    }

    function gpuInitBlades(uploadHeights) {
      if (!chunk) return;
      const hr = chunk.height_res;
      if (uploadHeights !== false) {
        device.queue.writeBuffer(heightBuf, 0, chunk.heights);
      }

      const gen = new ArrayBuffer(48);
      const dv = new DataView(gen);
      dv.setFloat32(0, grassOx, true);
      dv.setFloat32(4, grassOz, true);
      dv.setFloat32(8, GRASS_AREA, true);
      dv.setUint32(12, BLADE_AXIS, true);
      dv.setFloat32(16, chunk.origin_x, true);
      dv.setFloat32(20, chunk.origin_z, true);
      dv.setFloat32(24, chunk.area, true);
      dv.setUint32(28, hr, true);
      dv.setUint32(32, chunk.seed, true);
      device.queue.writeBuffer(genBuf, 0, gen);

      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(initPipe);
      pass.setBindGroup(0, initBind);
      pass.dispatchWorkgroups(Math.ceil(BLADE_COUNT / 256));
      pass.end();
      device.queue.submit([enc.finish()]);
      grassReady = true;
      onHud({
        blades: BLADE_COUNT,
        status: "hierba isla " + GRASS_AREA + "m · " + BLADE_AXIS + "²",
      });
    }

    function refreshGrassPatch(force) {
      if (!GRASS_STREAM) return; // whole island already baked once
      if (!chunk) return;
      const [ox, oz] = snapOrigin(player.x, player.z, GRASS_AREA, BLADE_AXIS);
      if (!force && Math.abs(ox - grassOx) < 1e-3 && Math.abs(oz - grassOz) < 1e-3) return;
      grassOx = ox;
      grassOz = oz;
      gpuInitBlades(false);
    }

    function uploadChunk(meta) {
      const bytes = b64ToBytes(meta.fwch_b64);
      chunk = decodeFwch(bytes);
      const mesh = buildTerrainMesh(chunk);
      if (terrainVbo) terrainVbo.destroy();
      if (terrainIbo) terrainIbo.destroy();
      terrainVbo = device.createBuffer({
        size: mesh.verts.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(terrainVbo.getMappedRange()).set(mesh.verts);
      terrainVbo.unmap();
      terrainIbo = device.createBuffer({
        size: mesh.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Uint32Array(terrainIbo.getMappedRange()).set(mesh.indices);
      terrainIbo.unmap();
      terrainIndexCount = mesh.indices.length;

      player.feetY = sampleHeight(chunk, player.x, player.z);
      player.y = player.feetY + 1.55;
      // Bake grass for entire island once (centered)
      grassOx = 0;
      grassOz = 0;
      // Props first so rock occupancy is stamped before grass bake
      spawnBeamsAndRoses();
      gpuInitBlades(true);
      resolveSolids();
      player.feetY = sampleHeight(chunk, player.x, player.z);
      player.y = player.feetY + 1.55;
    }

    async function bakeAt(ox, oz) {
      if (!loadChunk || baking) return;
      baking = true;
      try {
        onHud({ status: "Worker · terreno…" });
        const meta = await loadChunk(ox, oz);
        if (meta && meta.fwch_b64) uploadChunk(meta);
      } catch (e) {
        onHud({ status: "Error bake: " + (e && e.message ? e.message : e) });
      } finally {
        baking = false;
      }
    }

    async function boot() {
      syncVitalsDom();
      syncStageCamFlags();
      // Prefetch wardrobe TC mesh (visual only — privilege/upkeep unchanged)
      try {
        const res = await fetch("/props/wardrobe_tc_mesh.json", { cache: "force-cache" });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.floats) && data.vertCount > 0) {
            wardrobeTcMesh = {
              floats: data.floats,
              vertCount: data.vertCount | 0,
              size: data.size || null,
            };
            try {
              if (typeof pieceMeshCache !== "undefined" && pieceMeshCache.clear) pieceMeshCache.clear();
              rebuildBuildMesh();
            } catch (_) {}
          }
        }
      } catch (err) {
        console.warn("[FW] wardrobe TC mesh", err);
      }
      // Prefetch Animated Old Chest (boxes + legacy scrap_barrel visual)
      try {
        const res = await fetch("/props/old_chest_mesh.json", { cache: "force-cache" });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.floats) && data.vertCount > 0) {
            oldChestMesh = {
              floats: data.floats,
              vertCount: data.vertCount | 0,
              size: data.size || null,
            };
            try {
              if (typeof pieceMeshCache !== "undefined" && pieceMeshCache.clear) pieceMeshCache.clear();
              rebuildBuildMesh();
            } catch (_) {}
          }
        }
      } catch (err) {
        console.warn("[FW] old chest mesh", err);
      }
      // Prefetch workbench T1–T3 meshes
      const wbUrls = [
        [1, "/props/workbench_t1_mesh.json?v=2"],
        [2, "/props/workbench_t2_mesh.json?v=2"],
        [3, "/props/workbench_t3_mesh.json?v=2"],
      ];
      for (let wi = 0; wi < wbUrls.length; wi++) {
        const tier = wbUrls[wi][0];
        const url = wbUrls[wi][1];
        try {
          const res = await fetch(url, { cache: "no-cache" });
          if (!res.ok) continue;
          const data = await res.json();
          if (data && Array.isArray(data.floats) && data.vertCount > 0) {
            workbenchMeshes[tier] = {
              floats: data.floats,
              vertCount: data.vertCount | 0,
              size: data.size || null,
            };
          }
        } catch (err) {
          console.warn("[FW] workbench T" + tier + " mesh", err);
        }
      }
      // Prefetch research table mesh
      try {
        const res = await fetch("/props/research_table_mesh.json?v=2", { cache: "no-cache" });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.floats) && data.vertCount > 0) {
            researchTableMesh = {
              floats: data.floats,
              vertCount: data.vertCount | 0,
              size: data.size || null,
            };
          }
        }
      } catch (err) {
        console.warn("[FW] research table mesh", err);
      }
      try {
        if (typeof pieceMeshCache !== "undefined" && pieceMeshCache.clear) pieceMeshCache.clear();
        rebuildBuildMesh();
      } catch (_) {}
      await bakeAt(0, 0);
      loop();
    }

    async function calibrate(frames) {
      const n = Math.max(1, frames | 0);
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    }

    // Only locomotion axes — never clear Ctrl/Shift/Alt/Space (crouch, sprint, jump, free-look)
    const LOCO_KEY_CODES = [
      "KeyW", "KeyA", "KeyS", "KeyD",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ];
    const MOD_KEY_CODES = [
      "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight",
      "AltLeft", "AltRight", "Space",
    ];
    function clearLocoKeys() {
      for (let i = 0; i < LOCO_KEY_CODES.length; i++) keys[LOCO_KEY_CODES[i]] = false;
      player.moving = false;
      player.sprinting = false;
      player.moveMx = 0;
      player.moveMz = 0;
    }
    /** @deprecated alias — radial / blur use loco-only clear */
    function clearMoveKeys() { clearLocoKeys(); }
    function clearModKeys() {
      for (let i = 0; i < MOD_KEY_CODES.length; i++) keys[MOD_KEY_CODES[i]] = false;
      player.freeLook = false;
      // keep crouchToggle (X sticky crouch)
    }
    function clearAllKeys() {
      for (const k of Object.keys(keys)) keys[k] = false;
      player.moving = false;
      player.sprinting = false;
      player.moveMx = 0;
      player.moveMz = 0;
      player.crouching = false;
      player.freeLook = false;
      // keep crouchToggle — sticky crouch via X
    }

    function setControlsEnabled(on) {
      controlsEnabled = !!on;
      if (!controlsEnabled) {
        clearAllKeys();
        dragging = false;
        orbitRmb = false;
        radialHeld = false;
        unlockGameKeys();
        try {
          if (typeof document !== "undefined" && document.pointerLockElement === canvas) {
            document.exitPointerLock();
          }
        } catch (_) {}
      } else {
        try { canvas.focus(); } catch (_) {}
      }
      syncStageCamFlags();
    }

    function isAimLocked() {
      return typeof document !== "undefined" && document.pointerLockElement === canvas;
    }
    /** Mochila / caja / TC / craft / chat / mapa / upgrade — need OS cursor */
    let bagUiOpen = false;
    let toolEditorUiOpen = false;
    let toolEditorSavedCam = null;
    function isCursorUiOpen() {
      return !!(
        mapOpen
        || chatOpen
        || craftOpen
        || upgradeMenuOpen
        || activeTcId
        || activeBoxId
        || bagUiOpen
        || toolEditorUiOpen
      );
    }
    function syncCursorForUi() {
      try { syncStageCamFlags(); } catch (_) {}
      if (isCursorUiOpen()) {
        try { exitAimLock(); } catch (_) {}
        try { clearLocoKeys(); } catch (_) {}
        try {
          const stage = document.querySelector(".stage");
          if (stage) stage.dataset.aimlock = "0";
        } catch (_) {}
      } else if (controlsEnabled && !(vitals && vitals.dead)) {
        try { requestAimLock(); } catch (_) {}
      }
    }
    let gameKeysLocked = false;
    const GAME_LOCK_CODES = [
      "KeyW", "KeyA", "KeyS", "KeyD",
      "KeyQ", "KeyE", "KeyR", "KeyF", "KeyG", "KeyC", "KeyX", "KeyV", "KeyB",
      "KeyT", "KeyN", "KeyM", "KeyH", "KeyL", "KeyP", "KeyO", "KeyU", "KeyK", "KeyJ", "KeyY", "KeyZ",
      "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight",
      "Space", "Tab", "Escape", "Enter", "Backspace",
      "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ];
    async function lockGameKeys() {
      if (gameKeysLocked) return;
      try {
        if (navigator.keyboard && typeof navigator.keyboard.lock === "function") {
          await navigator.keyboard.lock(GAME_LOCK_CODES);
          gameKeysLocked = true;
        }
      } catch (_) {}
    }
    function unlockGameKeys() {
      if (!gameKeysLocked) return;
      try {
        if (navigator.keyboard && typeof navigator.keyboard.unlock === "function") {
          navigator.keyboard.unlock();
        }
      } catch (_) {}
      gameKeysLocked = false;
    }
    function requestAimLock() {
      if (!controlsEnabled || isCursorUiOpen() || vitals.dead) return;
      if (isAimLocked()) return;
      try {
        const p = canvas.requestPointerLock && canvas.requestPointerLock();
        if (p && typeof p.then === "function") {
          p.then(() => { lockGameKeys(); }).catch(() => {});
        } else {
          lockGameKeys();
        }
      } catch (_) {}
    }
    function exitAimLock() {
      try {
        unlockGameKeys();
        if (isAimLocked()) document.exitPointerLock();
      } catch (_) {}
    }
    function applyLookDelta(dx, dy) {
      if (!controlsEnabled || vitals.dead) return;
      // F7 tool editor: allow orbit with free cursor; other UIs block look
      if (isCursorUiOpen() && !toolEditorUiOpen) return;
      if (toolEditorUiOpen) {
        const sens = 0.0038;
        orbitYaw -= dx * sens;
        orbitPitch = Math.max(ORBIT_PITCH_MIN, Math.min(ORBIT_PITCH_MAX, orbitPitch + dy * sens));
        return;
      }
      if (camMode === "fpv") {
        const sens = 0.0024;
        if (player.freeLook) {
          fpvPitch = Math.max(-1.2, Math.min(1.25, fpvPitch - dy * sens));
          orbitYaw -= dx * sens;
        } else {
          player.yaw -= dx * sens;
          fpvPitch = Math.max(-1.2, Math.min(1.25, fpvPitch - dy * sens));
          orbitYaw = player.yaw;
        }
      } else {
        const sens = 0.0032;
        orbitYaw -= dx * sens;
        orbitPitch = Math.max(ORBIT_PITCH_MIN, Math.min(ORBIT_PITCH_MAX, orbitPitch + dy * sens));
        if (!player.freeLook) {
          player.yaw = Math.atan2(-Math.sin(orbitYaw), -Math.cos(orbitYaw));
        }
      }
    }

    // Stuck WASD / modifiers when tab/window loses focus
    window.addEventListener("blur", () => {
      clearLocoKeys();
      clearModKeys();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearLocoKeys();
        clearModKeys();
      }
    });

    function setCameraMode(m) {
      const next = m === "fpv" || m === "orbit" ? m : "follow";
      if (next === "orbit" && camMode !== "orbit") {
        orbitDist = freeOrbitDist;
      } else if (next === "follow" && camMode !== "follow") {
        orbitDist = followDist;
        orbitPitch = Math.min(orbitPitch, 0.55);
      } else if (next === "fpv") {
        fpvPitch = -0.22;
        orbitYaw = player.yaw;
      }
      camMode = next;
      syncStageCamFlags();
      const label = next === "fpv" ? "1ª persona" : (next === "orbit" ? "Órbita libre" : "3ª persona");
      onHud({ status: "Cámara · " + label + " (C) · RMB mira" });
    }

    // --- Audio: BGM + wind + ocean proximity + birds + surface footsteps ---
    const audio = {
      ctx: null,
      master: null,
      musicBus: null,
      ambBus: null,
      sfxBus: null,
      soundOn: true,
      unlocked: false,
      bgm: null,
      noise: null,
      ocean: null,
      steps: [],
      stepIdx: 0,
      stepCd: 0,
      hammers: [],
      hammerIdx: 0,
      birds: [],
      birdIdx: 0,
      birdCd: 1.5,
      splashes: [],
      splashIdx: 0,
      oceanTarget: 0,
      birdTarget: 0,
      loading: null,
      lastSwim: false,
    };

    function smooth01(a, b, x) {
      const t = Math.max(0, Math.min(1, (x - a) / Math.max(1e-5, b - a)));
      return t * t * (3 - 2 * t);
    }

    async function ensureAudio() {
      if (audio.ctx) return audio.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = audio.soundOn ? 1 : 0;
      audio.musicBus = audio.ctx.createGain();
      audio.ambBus = audio.ctx.createGain();
      audio.sfxBus = audio.ctx.createGain();
      audio.musicBus.gain.value = 1;
      audio.ambBus.gain.value = 1;
      audio.sfxBus.gain.value = 1;
      audio.musicBus.connect(audio.master);
      audio.ambBus.connect(audio.master);
      audio.sfxBus.connect(audio.master);
      audio.master.connect(audio.ctx.destination);
      return audio.ctx;
    }

    async function loadAudioBuffer(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + " " + res.status);
      const buf = await res.arrayBuffer();
      return audio.ctx.decodeAudioData(buf.slice(0));
    }

    function startLoop(buffer, volume, loop, bus) {
      if (!audio.ctx || !buffer) return null;
      const src = audio.ctx.createBufferSource();
      const gain = audio.ctx.createGain();
      gain.gain.value = volume;
      src.buffer = buffer;
      src.loop = !!loop;
      src.connect(gain);
      gain.connect(bus || audio.master);
      try { src.start(0); } catch (_) {}
      return { src, gain };
    }

    function playBufOneShot(buf, opts) {
      if (!audio.soundOn || !audio.ctx || !buf) return;
      const o = opts || {};
      const src = audio.ctx.createBufferSource();
      const gain = audio.ctx.createGain();
      src.buffer = buf;
      try { src.playbackRate.value = o.rate == null ? 1 : o.rate; } catch (_) {}
      try { if (o.detune != null) src.detune.value = o.detune; } catch (_) {}
      const t0 = audio.ctx.currentTime;
      const vol = Math.max(0.001, o.vol == null ? 0.5 : o.vol);
      gain.gain.setValueAtTime(vol, t0);
      if (o.fade > 0) gain.gain.exponentialRampToValueAtTime(0.001, t0 + o.fade);
      src.connect(gain);
      gain.connect(o.bus || audio.sfxBus || audio.master);
      const offset = o.offset || 0;
      const dur = o.dur;
      try {
        if (dur != null) src.start(0, offset, dur);
        else if (offset) src.start(0, offset);
        else src.start(0);
      } catch (_) {}
    }

    /** Tiny procedural songbird chirp when sample pack fails. */
    function playProcChirp(vol) {
      if (!audio.soundOn || !audio.ctx) return;
      try {
        const t0 = audio.ctx.currentTime;
        const base = 1800 + Math.random() * 1400;
        for (let i = 0; i < 2 + (Math.random() * 2) | 0; i++) {
          const osc = audio.ctx.createOscillator();
          const g = audio.ctx.createGain();
          const f = audio.ctx.createBiquadFilter();
          osc.type = "sine";
          const st = t0 + i * (0.07 + Math.random() * 0.05);
          osc.frequency.setValueAtTime(base * (0.92 + Math.random() * 0.2), st);
          osc.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.35), st + 0.05);
          osc.frequency.exponentialRampToValueAtTime(base * 0.75, st + 0.12);
          f.type = "bandpass";
          f.frequency.value = base;
          f.Q.value = 4;
          g.gain.setValueAtTime(0.0001, st);
          g.gain.exponentialRampToValueAtTime((vol || 0.12) * (0.7 + Math.random() * 0.5), st + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, st + 0.13);
          osc.connect(f);
          f.connect(g);
          g.connect(audio.ambBus || audio.master);
          osc.start(st);
          osc.stop(st + 0.16);
        }
      } catch (_) {}
    }

    async function unlockAudio() {
      if (audio.unlocked) return;
      audio.unlocked = true;
      try {
        await ensureAudio();
        if (!audio.ctx) return;
        if (audio.ctx.state === "suspended") await audio.ctx.resume();
        if (!audio.loading) {
          const opt = (url) => loadAudioBuffer(url).catch(() => null);
          audio.loading = Promise.all([
            loadAudioBuffer("/audio/grass_field.mp3"),
            loadAudioBuffer("/audio/noise.m4a"),
            loadAudioBuffer("/audio/fs_grass1.mp3"),
            loadAudioBuffer("/audio/fs_grass2.mp3"),
            loadAudioBuffer("/audio/fs_grass3.mp3"),
            loadAudioBuffer("/audio/fs_grass4.mp3"),
            loadAudioBuffer("/audio/fs_grass5.mp3"),
            loadAudioBuffer("/audio/build_hammer_1.ogg").catch(() => loadAudioBuffer("/audio/build_hammer_1.mp3")),
            loadAudioBuffer("/audio/build_hammer_2.ogg").catch(() => loadAudioBuffer("/audio/build_hammer_2.mp3")),
            opt("/audio/wave01.mp3"),
            opt("/audio/bird_chirp1.mp3"),
            opt("/audio/bird_chirp2.mp3"),
            opt("/audio/bird_chirp3.mp3"),
            opt("/audio/bird_chirp4.mp3"),
            opt("/audio/bird_chirp5.mp3"),
            opt("/audio/splash_small1.mp3"),
            opt("/audio/splash_small2.mp3"),
          ]).then((bufs) => {
            const [field, noise, s1, s2, s3, s4, s5, h1, h2, wave, b1, b2, b3, b4, b5, sp1, sp2] = bufs;
            audio.bgm = startLoop(field, 1.15, true, audio.musicBus);
            audio.noise = startLoop(noise, 0.08, true, audio.ambBus);
            if (wave) {
              audio.ocean = startLoop(wave, 0.0001, true, audio.ambBus);
            }
            audio.steps = [s1, s2, s3, s4, s5];
            audio.hammers = [h1, h2].filter(Boolean);
            audio.birds = [b1, b2, b3, b4, b5].filter(Boolean);
            audio.splashes = [sp1, sp2].filter(Boolean);
            audio.birdCd = 2 + Math.random() * 3;
          }).catch((e) => console.warn("[FW audio]", e));
        }
        await audio.loading;
      } catch (e) {
        console.warn("[FW audio unlock]", e);
      }
    }

    function setSoundOn(on) {
      audio.soundOn = !!on;
      if (audio.master) audio.master.gain.value = audio.soundOn ? 1 : 0;
    }

    function toggleSound() {
      setSoundOn(!audio.soundOn);
      return audio.soundOn;
    }

    function playStep(volume, surface) {
      if (!audio.soundOn || !audio.ctx) return;
      const surf = surface || "grass";
      if (surf === "water") {
        if (audio.splashes.length) {
          const buf = audio.splashes[audio.splashIdx % audio.splashes.length];
          audio.splashIdx++;
          playBufOneShot(buf, {
            vol: Math.max(0.08, Math.min(0.55, volume == null ? 0.28 : volume * 0.55)),
            rate: 0.92 + Math.random() * 0.22,
            detune: (Math.random() * 2 - 1) * 180,
            offset: Math.random() * Math.max(0, buf.duration - 0.35),
            dur: 0.28 + Math.random() * 0.12,
            fade: 0.35,
          });
        } else {
          // Procedural soft splash
          try {
            const t0 = audio.ctx.currentTime;
            const nLen = Math.floor(audio.ctx.sampleRate * 0.12);
            const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
            const nd = nBuf.getChannelData(0);
            for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
            const src = audio.ctx.createBufferSource();
            const g = audio.ctx.createGain();
            const f = audio.ctx.createBiquadFilter();
            src.buffer = nBuf;
            f.type = "lowpass";
            f.frequency.value = 900;
            g.gain.setValueAtTime(0.22, t0);
            g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
            src.connect(f); f.connect(g); g.connect(audio.sfxBus);
            src.start(t0);
          } catch (_) {}
        }
        return;
      }
      if (!audio.steps.length) return;
      const buf = audio.steps[audio.stepIdx % audio.steps.length];
      audio.stepIdx++;
      const src = audio.ctx.createBufferSource();
      const gain = audio.ctx.createGain();
      const filt = audio.ctx.createBiquadFilter();
      let rate = 1;
      let detune = (Math.random() * 2 - 1) * 200;
      let vol = Math.max(0.05, Math.min(1, volume == null ? 0.5 : volume));
      filt.type = "lowshelf";
      filt.frequency.value = 400;
      filt.gain.value = 0;
      if (surf === "sand") {
        rate = 1.08 + Math.random() * 0.08;
        vol *= 0.72;
        filt.type = "highpass";
        filt.frequency.value = 380;
        filt.Q.value = 0.7;
      } else if (surf === "snow") {
        rate = 0.88 + Math.random() * 0.08;
        vol *= 0.62;
        detune = (Math.random() * 2 - 1) * 280;
        filt.type = "lowpass";
        filt.frequency.value = 1400;
      } else if (surf === "rock") {
        rate = 0.95;
        vol *= 0.85;
        filt.type = "highshelf";
        filt.frequency.value = 1800;
        filt.gain.value = 3;
      } else if (surf === "wood") {
        rate = 1.12 + Math.random() * 0.1;
        vol *= 0.78;
        detune = (Math.random() * 2 - 1) * 140;
        filt.type = "bandpass";
        filt.frequency.value = 1100;
        filt.Q.value = 0.85;
      }
      src.buffer = buf;
      try { src.playbackRate.value = rate; } catch (_) {}
      try { src.detune.value = detune; } catch (_) {}
      gain.gain.value = vol;
      src.connect(filt);
      filt.connect(gain);
      gain.connect(audio.sfxBus || audio.master);
      try { src.start(0); } catch (_) {}
    }

    function playBirdChirp() {
      if (!audio.soundOn || !audio.ctx) return;
      const vol = 0.14 + Math.random() * 0.16;
      if (audio.birds.length) {
        const buf = audio.birds[audio.birdIdx % audio.birds.length];
        audio.birdIdx++;
        // Prefer short slices from longer clips
        const maxOff = Math.max(0, buf.duration - 1.2);
        const offset = maxOff > 0.2 ? Math.random() * maxOff : 0;
        const dur = Math.min(buf.duration - offset, 0.7 + Math.random() * 1.4);
        playBufOneShot(buf, {
          vol: vol * (0.7 + audio.birdTarget * 0.6),
          rate: 0.94 + Math.random() * 0.14,
          detune: (Math.random() * 2 - 1) * 160,
          offset,
          dur,
          fade: Math.min(1.2, dur * 0.85),
          bus: audio.ambBus,
        });
      } else {
        playProcChirp(vol * 0.9);
      }
    }

    function playLootBlip() {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      try {
        const t0 = audio.ctx.currentTime;
        const osc = audio.ctx.createOscillator();
        const g = audio.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880 + Math.random() * 120, t0);
        osc.frequency.exponentialRampToValueAtTime(1320, t0 + 0.06);
        g.gain.setValueAtTime(0.07, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
        osc.connect(g);
        g.connect(audio.sfxBus || audio.master);
        osc.start(t0);
        osc.stop(t0 + 0.12);
      } catch (_) {}
    }

    /** UI feedback: craft / unlock / research / panels / doors / eat. */
    function playUiSfx(kind) {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      try {
        const t0 = audio.ctx.currentTime;
        const bus = audio.sfxBus || audio.master;
        const beep = (type, f0, f1, dur, vol, when) => {
          const t = when != null ? when : t0;
          const osc = audio.ctx.createOscillator();
          const g = audio.ctx.createGain();
          osc.type = type;
          osc.frequency.setValueAtTime(f0, t);
          if (f1 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur * 0.85);
          g.gain.setValueAtTime(vol, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + dur);
          osc.connect(g);
          g.connect(bus);
          osc.start(t);
          osc.stop(t + dur + 0.02);
        };
        const noiseBurst = (dur, vol, hpFreq, when) => {
          const t = when != null ? when : t0;
          const nLen = Math.floor(audio.ctx.sampleRate * dur);
          const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
          const nd = nBuf.getChannelData(0);
          for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
          const src = audio.ctx.createBufferSource();
          const g = audio.ctx.createGain();
          const f = audio.ctx.createBiquadFilter();
          src.buffer = nBuf;
          f.type = "bandpass";
          f.frequency.value = hpFreq;
          f.Q.value = 0.7;
          g.gain.setValueAtTime(vol, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + dur);
          src.connect(f); f.connect(g); g.connect(bus);
          src.start(t);
        };
        if (kind === "craft") {
          beep("triangle", 420, 720, 0.09, 0.055);
          setTimeout(() => { try { beep("sine", 880, null, 0.08, 0.04, audio.ctx.currentTime); } catch (_) {} }, 55);
        } else if (kind === "unlock") {
          beep("sine", 520, 980, 0.16, 0.06);
          setTimeout(() => { try { beep("triangle", 780, 1240, 0.18, 0.05, audio.ctx.currentTime); } catch (_) {} }, 70);
        } else if (kind === "research") {
          beep("sawtooth", 180, 420, 0.22, 0.035);
          setTimeout(() => { try { beep("sine", 660, 990, 0.12, 0.05, audio.ctx.currentTime); } catch (_) {} }, 200);
        } else if (kind === "deny") {
          beep("square", 220, 120, 0.12, 0.04);
        } else if (kind === "door_open") {
          // Metal door: hinge scrape + panel whoosh
          noiseBurst(0.16, 0.11, 520);
          noiseBurst(0.22, 0.05, 180, t0 + 0.04);
          beep("triangle", 140, 70, 0.22, 0.045);
          beep("sine", 260, 110, 0.18, 0.03, t0 + 0.05);
        } else if (kind === "door_close") {
          // Solid metal slam (scrape plays earlier from playDoorToggle)
          noiseBurst(0.07, 0.14, 160);
          beep("sine", 90, 45, 0.1, 0.08);
          beep("square", 220, 80, 0.04, 0.035);
        } else if (kind === "eat") {
          noiseBurst(0.08, 0.05, 900);
          beep("sine", 320, 180, 0.1, 0.035);
        } else if (kind === "bag_open") {
          beep("triangle", 380, 620, 0.08, 0.045);
        } else if (kind === "bag_close") {
          beep("triangle", 520, 280, 0.07, 0.04);
        } else if (kind === "panel_open") {
          beep("sine", 260, 480, 0.1, 0.04);
          noiseBurst(0.05, 0.035, 600);
        } else if (kind === "panel_close") {
          beep("sine", 420, 220, 0.08, 0.035);
        } else if (kind === "fire_on") {
          noiseBurst(0.18, 0.08, 520);
          beep("sawtooth", 90, 160, 0.2, 0.03);
        } else if (kind === "fire_out") {
          noiseBurst(0.12, 0.05, 200);
          beep("sine", 200, 80, 0.14, 0.03);
        } else if (kind === "deposit") {
          beep("triangle", 500, 340, 0.06, 0.04);
        } else if (kind === "blast" || kind === "blast_big" || kind === "blast_rocket") {
          const big = kind !== "blast";
          noiseBurst(big ? 0.35 : 0.22, big ? 0.22 : 0.14, big ? 180 : 260);
          beep("sawtooth", big ? 70 : 90, 40, big ? 0.28 : 0.18, big ? 0.08 : 0.05);
          if (kind === "blast_rocket") beep("sine", 220, 80, 0.2, 0.04, t0 + 0.05);
        } else if (kind === "fuse_plant") {
          beep("triangle", 200, 140, 0.08, 0.045);
          noiseBurst(0.06, 0.04, 500);
        } else if (kind === "fuse_tick") {
          beep("square", 880, 660, 0.05, 0.035);
        } else if (kind === "rocket_fire") {
          noiseBurst(0.2, 0.12, 320);
          beep("sawtooth", 140, 60, 0.18, 0.05);
        } else if (kind === "respawn") {
          beep("sine", 360, 720, 0.16, 0.05);
        } else if (kind === "bag_claim") {
          beep("triangle", 300, 520, 0.1, 0.045);
        } else {
          beep("sine", 640, 820, 0.07, 0.045);
        }
      } catch (_) {}
    }

    function playDoorToggle(isOpen) {
      if (isOpen) {
        playUiSfx("door_open");
        return;
      }
      // Hinge scrape now; metal slam when leaf finishes (~280 ms)
      try {
        unlockAudio();
        if (audio.soundOn && audio.ctx) {
          const t0 = audio.ctx.currentTime;
          const bus = audio.sfxBus || audio.master;
          const nLen = Math.floor(audio.ctx.sampleRate * 0.1);
          const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
          const nd = nBuf.getChannelData(0);
          for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
          const src = audio.ctx.createBufferSource();
          const g = audio.ctx.createGain();
          const f = audio.ctx.createBiquadFilter();
          src.buffer = nBuf;
          f.type = "bandpass";
          f.frequency.value = 380;
          f.Q.value = 0.7;
          g.gain.setValueAtTime(0.07, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
          src.connect(f); f.connect(g); g.connect(bus);
          src.start(t0);
        }
      } catch (_) {}
      setTimeout(() => { try { playUiSfx("door_close"); } catch (_) {} }, 260);
    }

    /** Distance-based ocean + daytime birds + BGM ducking. */
    function updateAmbience(dt) {
      if (!audio.soundOn || !audio.ctx || !audio.unlocked) return;
      const edge = typeof islandEdge === "function" ? islandEdge(player.x, player.z) : 0;
      const bid = typeof biomeAtJs === "function" ? biomeAtJs(player.x, player.z) : 0;
      const tod = (_celestial && _celestial.tod != null) ? _celestial.tod : 0.4;
      const day = smooth01(0.18, 0.4, tod) * (1 - smooth01(0.58, 0.82, tod));
      const dusk = Math.max(
        smooth01(0.12, 0.28, tod) * (1 - smooth01(0.28, 0.42, tod)),
        smooth01(0.58, 0.72, tod) * (1 - smooth01(0.72, 0.88, tod))
      );
      // Hear surf from inland fringe; full at shoreline / in water
      let oceanAmt = smooth01(0.08, 0.48, edge);
      if (player.swimming) oceanAmt = Math.max(oceanAmt, 0.72);
      if (edge > 0.55) oceanAmt = Math.max(oceanAmt, 0.9);
      audio.oceanTarget += (oceanAmt - audio.oceanTarget) * Math.min(1, dt * 1.8);

      // Birds: meadow/forest/marsh daytime; quiet at sea & night
      const birdBiome = (bid === 0 || bid === 2 || bid === 4) ? 1 : (bid === 1 ? 0.45 : 0.15);
      let birdAmt = day * 0.85 + dusk * 0.35;
      birdAmt *= birdBiome;
      birdAmt *= (1 - audio.oceanTarget * 0.85);
      if (bid === 3) birdAmt *= 0.15; // snow almost silent
      audio.birdTarget += (birdAmt - audio.birdTarget) * Math.min(1, dt * 1.2);

      const t0 = audio.ctx.currentTime;
      if (audio.ocean && audio.ocean.gain) {
        const ov = 0.0001 + audio.oceanTarget * 0.78;
        audio.ocean.gain.gain.setTargetAtTime(ov, t0, 0.35);
      }
      if (audio.bgm && audio.bgm.gain) {
        // Duck meadow BGM near the shore so waves read clearly
        const bv = 1.15 * (1 - audio.oceanTarget * 0.62) * (0.75 + day * 0.35);
        audio.bgm.gain.gain.setTargetAtTime(Math.max(0.12, bv), t0, 0.45);
      }
      if (audio.noise && audio.noise.gain) {
        const nv = 0.05 + audio.oceanTarget * 0.04 + (1 - day) * 0.03;
        audio.noise.gain.gain.setTargetAtTime(nv, t0, 0.5);
      }

      // Enter/exit water splash
      if (player.swimming && !audio.lastSwim) {
        playStep(0.55, "water");
      }
      audio.lastSwim = !!player.swimming;

      audio.birdCd -= dt;
      if (audio.birdCd <= 0 && audio.birdTarget > 0.12) {
        if (Math.random() < audio.birdTarget) playBirdChirp();
        // Sparse inland chorus; denser in forest
        const gap = bid === 2
          ? (1.2 + Math.random() * 2.8)
          : (2.2 + Math.random() * 5.5);
        audio.birdCd = gap / Math.max(0.35, audio.birdTarget + 0.2);
      }
    }

    /** Rust-like wood nail hammer (CC0 BigSoundBank) — short hit slice + procedural fallback. */
    function playBuildPlace(kind) {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      try {
        if (audio.ctx.state === "suspended") audio.ctx.resume();
      } catch (_) {}
      const vol = kind === "remove" ? 0.5 : 0.88;
      const bus = audio.sfxBus || audio.master;

      function hammerHit(delay, rate, gainMul) {
        const t0 = audio.ctx.currentTime + (delay || 0);
        const gMul = gainMul != null ? gainMul : 1;
        if (audio.hammers && audio.hammers.length) {
          const buf = audio.hammers[audio.hammerIdx % audio.hammers.length];
          audio.hammerIdx++;
          const src = audio.ctx.createBufferSource();
          const gain = audio.ctx.createGain();
          src.buffer = buf;
          try { src.playbackRate.value = (rate != null ? rate : 1) * (0.96 + Math.random() * 0.1); } catch (_) {}
          try { src.detune.value = (Math.random() * 2 - 1) * 80; } catch (_) {}
          gain.gain.setValueAtTime(vol * gMul, t0);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
          src.connect(gain);
          gain.connect(bus);
          // Hits sit near the start of these recordings — avoid silent mid-file offsets
          const offset = Math.min(0.02 + Math.random() * 0.08, Math.max(0, buf.duration - 0.3));
          try { src.start(t0, offset, 0.26 + Math.random() * 0.08); } catch (_) {}
          return;
        }
        // Procedural fallback: wood thud + metallic nail click
        try {
          const thump = audio.ctx.createOscillator();
          const thumpG = audio.ctx.createGain();
          thump.type = "triangle";
          thump.frequency.setValueAtTime(150 + Math.random() * 35, t0);
          thump.frequency.exponentialRampToValueAtTime(58, t0 + 0.11);
          thumpG.gain.setValueAtTime(vol * 0.6 * gMul, t0);
          thumpG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
          thump.connect(thumpG);
          thumpG.connect(bus);
          thump.start(t0);
          thump.stop(t0 + 0.17);
          const click = audio.ctx.createOscillator();
          const clickG = audio.ctx.createGain();
          click.type = "square";
          click.frequency.setValueAtTime(1700 + Math.random() * 500, t0);
          clickG.gain.setValueAtTime(vol * 0.14 * gMul, t0);
          clickG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.035);
          click.connect(clickG);
          clickG.connect(bus);
          click.start(t0);
          click.stop(t0 + 0.045);
        } catch (_) {}
      }

      if (kind === "remove") {
        hammerHit(0, 0.92, 1);
        return;
      }
      if (kind === "upgrade") {
        hammerHit(0, 1.15, 1.05);
        hammerHit(0.09, 0.88, 0.7);
        try {
          const t0 = audio.ctx.currentTime;
          const bus = audio.sfxBus || audio.master;
          const osc = audio.ctx.createOscillator();
          const g = audio.ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(520, t0);
          osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.12);
          g.gain.setValueAtTime(0.06, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
          osc.connect(g); g.connect(bus);
          osc.start(t0); osc.stop(t0 + 0.16);
        } catch (_) {}
        return;
      }
      if (kind === "repair") {
        hammerHit(0, 1.05, 0.85);
        hammerHit(0.05, 1.12, 0.55);
        return;
      }
      // Place: Rust-like double nail tap (no avatar swing)
      hammerHit(0, 1.0, 1);
      hammerHit(0.065, 1.08, 0.82);
    }

    /** Noise burst helper for deploy SFX. */
    function playNoiseBurst(opts) {
      if (!audio.ctx) return;
      const o = opts || {};
      const dur = o.dur != null ? o.dur : 0.12;
      const t0 = audio.ctx.currentTime + (o.delay || 0);
      const nLen = Math.max(1, Math.floor(audio.ctx.sampleRate * dur));
      const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
      const data = nBuf.getChannelData(0);
      for (let i = 0; i < nLen; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nLen, o.fall != null ? o.fall : 1.4);
      const src = audio.ctx.createBufferSource();
      const g = audio.ctx.createGain();
      const f = audio.ctx.createBiquadFilter();
      src.buffer = nBuf;
      f.type = o.filter || "lowpass";
      f.frequency.value = o.freq != null ? o.freq : 900;
      f.Q.value = o.q != null ? o.q : 0.7;
      g.gain.setValueAtTime(Math.max(0.001, o.vol != null ? o.vol : 0.3), t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      src.connect(f);
      f.connect(g);
      g.connect(audio.sfxBus || audio.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    /**
     * Distinct SFX when placing furniture / deployables on structures or ground.
     * type: toolcupboard | workbench | research_table | box_* | campfire | sleeping_bag | door | …
     */
    function playDeployPlace(type) {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      const t = String(type || "");
      try {
        const t0 = audio.ctx.currentTime;
        const bus = audio.sfxBus || audio.master;

        if (t === "toolcupboard") {
          // Heavy wardrobe set-down: low wood body + hollow cabinet knock
          const body = audio.ctx.createOscillator();
          const bodyG = audio.ctx.createGain();
          body.type = "triangle";
          body.frequency.setValueAtTime(90 + Math.random() * 18, t0);
          body.frequency.exponentialRampToValueAtTime(38, t0 + 0.22);
          bodyG.gain.setValueAtTime(0.62, t0);
          bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28);
          body.connect(bodyG); bodyG.connect(bus);
          body.start(t0); body.stop(t0 + 0.3);
          playNoiseBurst({ delay: 0.02, dur: 0.16, freq: 520, vol: 0.38, filter: "bandpass", q: 0.9 });
          // Soft door panel knock
          const knock = audio.ctx.createOscillator();
          const knockG = audio.ctx.createGain();
          knock.type = "sine";
          knock.frequency.setValueAtTime(220 + Math.random() * 40, t0 + 0.08);
          knock.frequency.exponentialRampToValueAtTime(110, t0 + 0.18);
          knockG.gain.setValueAtTime(0.22, t0 + 0.08);
          knockG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
          knock.connect(knockG); knockG.connect(bus);
          knock.start(t0 + 0.08); knock.stop(t0 + 0.24);
          return;
        }

        if (t === "workbench" || t === "research_table") {
          // Heavy table drop + metal tool clink
          const body = audio.ctx.createOscillator();
          const bodyG = audio.ctx.createGain();
          body.type = "triangle";
          body.frequency.setValueAtTime(70 + Math.random() * 16, t0);
          body.frequency.exponentialRampToValueAtTime(32, t0 + 0.2);
          bodyG.gain.setValueAtTime(0.7, t0);
          bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.26);
          body.connect(bodyG); bodyG.connect(bus);
          body.start(t0); body.stop(t0 + 0.28);
          playNoiseBurst({ delay: 0.01, dur: 0.14, freq: 380, vol: 0.42, filter: "lowpass" });
          const clang = audio.ctx.createOscillator();
          const clangG = audio.ctx.createGain();
          clang.type = "square";
          clang.frequency.setValueAtTime(1400 + Math.random() * 400, t0 + 0.06);
          clang.frequency.exponentialRampToValueAtTime(420, t0 + 0.16);
          clangG.gain.setValueAtTime(0.14, t0 + 0.06);
          clangG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
          clang.connect(clangG); clangG.connect(bus);
          clang.start(t0 + 0.06); clang.stop(t0 + 0.2);
          return;
        }

        if (t === "box_small" || t === "box_large") {
          // Hollow crate set-down
          const body = audio.ctx.createOscillator();
          const bodyG = audio.ctx.createGain();
          body.type = "triangle";
          const low = t === "box_large" ? 78 : 110;
          body.frequency.setValueAtTime(low + Math.random() * 20, t0);
          body.frequency.exponentialRampToValueAtTime(low * 0.45, t0 + 0.14);
          bodyG.gain.setValueAtTime(t === "box_large" ? 0.58 : 0.45, t0);
          bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
          body.connect(bodyG); bodyG.connect(bus);
          body.start(t0); body.stop(t0 + 0.22);
          playNoiseBurst({
            delay: 0.015, dur: 0.11,
            freq: t === "box_large" ? 480 : 720,
            vol: 0.32, filter: "bandpass", q: 1.1,
          });
          return;
        }

        if (t === "campfire") {
          // Stones + dry wood settle
          playNoiseBurst({ dur: 0.1, freq: 900, vol: 0.36, filter: "bandpass", q: 1.2 });
          const stone = audio.ctx.createOscillator();
          const stoneG = audio.ctx.createGain();
          stone.type = "sine";
          stone.frequency.setValueAtTime(180 + Math.random() * 50, t0);
          stone.frequency.exponentialRampToValueAtTime(70, t0 + 0.1);
          stoneG.gain.setValueAtTime(0.35, t0);
          stoneG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
          stone.connect(stoneG); stoneG.connect(bus);
          stone.start(t0); stone.stop(t0 + 0.16);
          playNoiseBurst({ delay: 0.05, dur: 0.08, freq: 1400, vol: 0.18, filter: "highpass" });
          return;
        }

        if (t === "sleeping_bag") {
          // Soft fabric flop
          playNoiseBurst({ dur: 0.18, freq: 340, vol: 0.4, filter: "lowpass", fall: 0.9 });
          const soft = audio.ctx.createOscillator();
          const softG = audio.ctx.createGain();
          soft.type = "sine";
          soft.frequency.setValueAtTime(120 + Math.random() * 30, t0);
          soft.frequency.exponentialRampToValueAtTime(55, t0 + 0.16);
          softG.gain.setValueAtTime(0.28, t0);
          softG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
          soft.connect(softG); softG.connect(bus);
          soft.start(t0); soft.stop(t0 + 0.22);
          return;
        }

        if (t === "door" || t === "metal_door") {
          // Metal door set into frame
          const clang = audio.ctx.createOscillator();
          const clangG = audio.ctx.createGain();
          clang.type = "square";
          clang.frequency.setValueAtTime(900 + Math.random() * 280, t0);
          clang.frequency.exponentialRampToValueAtTime(220, t0 + 0.18);
          clangG.gain.setValueAtTime(0.22, t0);
          clangG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.22);
          clang.connect(clangG); clangG.connect(bus);
          clang.start(t0); clang.stop(t0 + 0.24);
          playNoiseBurst({ delay: 0.02, dur: 0.1, freq: 1600, vol: 0.2, filter: "highpass" });
          const thud = audio.ctx.createOscillator();
          const thudG = audio.ctx.createGain();
          thud.type = "triangle";
          thud.frequency.setValueAtTime(110, t0);
          thud.frequency.exponentialRampToValueAtTime(50, t0 + 0.12);
          thudG.gain.setValueAtTime(0.4, t0);
          thudG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
          thud.connect(thudG); thudG.connect(bus);
          thud.start(t0); thud.stop(t0 + 0.18);
          return;
        }

        // Default deployable: solid wood furniture drop
        const body = audio.ctx.createOscillator();
        const bodyG = audio.ctx.createGain();
        body.type = "triangle";
        body.frequency.setValueAtTime(100 + Math.random() * 30, t0);
        body.frequency.exponentialRampToValueAtTime(45, t0 + 0.16);
        bodyG.gain.setValueAtTime(0.5, t0);
        bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
        body.connect(bodyG); bodyG.connect(bus);
        body.start(t0); body.stop(t0 + 0.22);
        playNoiseBurst({ delay: 0.01, dur: 0.1, freq: 600, vol: 0.28, filter: "lowpass" });
      } catch (_) {
        playBuildPlace("place");
      }
    }

    /** Mid-swing gather SFX — axe wood / pick stone / barrel thud. */
    function playGatherHit(mode) {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      try {
        const t0 = audio.ctx.currentTime;
        const m = mode || "gather";
        if (m === "chop") {
          // Hachazo: wood body + sharp crack
          const body = audio.ctx.createOscillator();
          const bodyG = audio.ctx.createGain();
          body.type = "triangle";
          body.frequency.setValueAtTime(95 + Math.random() * 25, t0);
          body.frequency.exponentialRampToValueAtTime(42, t0 + 0.14);
          bodyG.gain.setValueAtTime(0.55, t0);
          bodyG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);
          body.connect(bodyG);
          bodyG.connect(audio.sfxBus || audio.master);
          body.start(t0);
          body.stop(t0 + 0.2);
          const crack = audio.ctx.createOscillator();
          const crackG = audio.ctx.createGain();
          crack.type = "sawtooth";
          crack.frequency.setValueAtTime(520 + Math.random() * 180, t0);
          crack.frequency.exponentialRampToValueAtTime(120, t0 + 0.07);
          crackG.gain.setValueAtTime(0.22, t0);
          crackG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
          crack.connect(crackG);
          crackG.connect(audio.sfxBus || audio.master);
          crack.start(t0);
          crack.stop(t0 + 0.09);
          // Noise burst (bark splinter)
          const nLen = Math.floor(audio.ctx.sampleRate * 0.06);
          const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
          const nd = nBuf.getChannelData(0);
          for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
          const nSrc = audio.ctx.createBufferSource();
          const nG = audio.ctx.createGain();
          const nF = audio.ctx.createBiquadFilter();
          nSrc.buffer = nBuf;
          nF.type = "bandpass";
          nF.frequency.value = 900;
          nG.gain.setValueAtTime(0.28, t0);
          nG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
          nSrc.connect(nF);
          nF.connect(nG);
          nG.connect(audio.sfxBus || audio.master);
          nSrc.start(t0);
          return;
        }
        if (m === "mine") {
          // Pico: metallic ping + stone grit
          const ping = audio.ctx.createOscillator();
          const pingG = audio.ctx.createGain();
          ping.type = "square";
          ping.frequency.setValueAtTime(1400 + Math.random() * 500, t0);
          ping.frequency.exponentialRampToValueAtTime(380, t0 + 0.09);
          pingG.gain.setValueAtTime(0.16, t0);
          pingG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
          ping.connect(pingG);
          pingG.connect(audio.sfxBus || audio.master);
          ping.start(t0);
          ping.stop(t0 + 0.11);
          const thud = audio.ctx.createOscillator();
          const thudG = audio.ctx.createGain();
          thud.type = "sine";
          thud.frequency.setValueAtTime(160 + Math.random() * 40, t0);
          thud.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
          thudG.gain.setValueAtTime(0.48, t0);
          thudG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
          thud.connect(thudG);
          thudG.connect(audio.sfxBus || audio.master);
          thud.start(t0);
          thud.stop(t0 + 0.15);
          const nLen = Math.floor(audio.ctx.sampleRate * 0.05);
          const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
          const nd = nBuf.getChannelData(0);
          for (let i = 0; i < nLen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nLen);
          const nSrc = audio.ctx.createBufferSource();
          const nG = audio.ctx.createGain();
          const nF = audio.ctx.createBiquadFilter();
          nSrc.buffer = nBuf;
          nF.type = "highpass";
          nF.frequency.value = 1200;
          nG.gain.setValueAtTime(0.32, t0);
          nG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
          nSrc.connect(nF);
          nF.connect(nG);
          nG.connect(audio.sfxBus || audio.master);
          nSrc.start(t0);
          return;
        }
        // Barril / genérico: soft thud
        const thud = audio.ctx.createOscillator();
        const thudG = audio.ctx.createGain();
        thud.type = "triangle";
        thud.frequency.setValueAtTime(110 + Math.random() * 30, t0);
        thud.frequency.exponentialRampToValueAtTime(48, t0 + 0.11);
        thudG.gain.setValueAtTime(0.4, t0);
        thudG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
        thud.connect(thudG);
        thudG.connect(audio.sfxBus || audio.master);
        thud.start(t0);
        thud.stop(t0 + 0.16);
      } catch (_) {}
    }

    function treeSoundVolume(fall, base) {
      const x = fall && fall.x != null ? fall.x : player.x;
      const z = fall && fall.z != null ? fall.z : player.z;
      const dist = Math.hypot(player.x - x, player.z - z);
      return base / (1 + dist * 0.09);
    }

    function playTreeFallCreak(fall) {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      try {
        const t0 = audio.ctx.currentTime;
        const vol = treeSoundVolume(fall, 0.34);
        const nLen = Math.floor(audio.ctx.sampleRate * 0.62);
        const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
        const nd = nBuf.getChannelData(0);
        let smoothNoise = 0;
        for (let i = 0; i < nLen; i++) {
          const t = i / nLen;
          smoothNoise = smoothNoise * 0.965 + (Math.random() * 2 - 1) * 0.035;
          const crack1 = Math.exp(-Math.pow((t - 0.18) / 0.055, 2));
          const crack2 = Math.exp(-Math.pow((t - 0.58) / 0.09, 2)) * 0.72;
          nd[i] = smoothNoise * (crack1 + crack2) * (1 - t * 0.45);
        }
        const creak = audio.ctx.createBufferSource();
        const gain = audio.ctx.createGain();
        const filter = audio.ctx.createBiquadFilter();
        creak.buffer = nBuf;
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(520, t0);
        filter.frequency.exponentialRampToValueAtTime(190, t0 + 0.6);
        filter.Q.value = 0.75;
        gain.gain.setValueAtTime(Math.max(0.01, vol), t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.64);
        creak.connect(filter);
        filter.connect(gain);
        gain.connect(audio.sfxBus || audio.master);
        creak.start(t0);
      } catch (_) {}
    }

    function playTreeFallImpact(fall) {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      try {
        const t0 = audio.ctx.currentTime;
        const vol = treeSoundVolume(fall, 0.62);
        const nLen = Math.floor(audio.ctx.sampleRate * 0.42);
        const nBuf = audio.ctx.createBuffer(1, nLen, audio.ctx.sampleRate);
        const nd = nBuf.getChannelData(0);
        let body = 0;
        for (let i = 0; i < nLen; i++) {
          body = body * 0.91 + (Math.random() * 2 - 1) * 0.09;
          const env = Math.pow(1 - i / nLen, 2.2);
          const twig = i < nLen * 0.12 ? (Math.random() * 2 - 1) * 0.28 : 0;
          nd[i] = (body + twig) * env;
        }
        const noise = audio.ctx.createBufferSource();
        const noiseGain = audio.ctx.createGain();
        const low = audio.ctx.createBiquadFilter();
        noise.buffer = nBuf;
        low.type = "lowpass";
        low.frequency.setValueAtTime(620, t0);
        low.frequency.exponentialRampToValueAtTime(120, t0 + 0.38);
        low.Q.value = 0.55;
        noiseGain.gain.setValueAtTime(Math.max(0.01, vol), t0);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.44);
        noise.connect(low);
        low.connect(noiseGain);
        noiseGain.connect(audio.sfxBus || audio.master);
        noise.start(t0);
      } catch (_) {}
    }

    let gatherHitKick = 0;

    /** Brief crosshair flash + camera punch + chop chip burst when tool connects. */
    function pulseGatherHit(mode) {
      gatherHitKick = mode === "chop" ? 0.085 : 0.055;
      try {
        const ch = document.querySelector(".fw-crosshair");
        if (ch) {
          ch.classList.remove("is-hit-chop", "is-hit-mine", "is-hit-gather");
          void ch.offsetWidth;
          const cls = mode === "chop" ? "is-hit-chop"
            : (mode === "mine" ? "is-hit-mine" : "is-hit-gather");
          ch.classList.add(cls);
          clearTimeout(pulseGatherHit._t);
          pulseGatherHit._t = setTimeout(() => {
            try { ch.classList.remove("is-hit-chop", "is-hit-mine", "is-hit-gather"); } catch (_) {}
          }, 180);
        }
      } catch (_) {}
    }

    function spawnChopChips(n, mode) {
      if (!n) return;
      const towardX = player.x - n.x;
      const towardZ = player.z - n.z;
      const len = Math.hypot(towardX, towardZ) || 1;
      const nx = towardX / len;
      const nz = towardZ / len;
      const hitR = 0.24 * (n.treeScale || 1);
      const hitX = n.x + nx * hitR;
      const hitY = (n.y || 0) + 0.9 + Math.random() * 0.35;
      const hitZ = n.z + nz * hitR;
      const mine = mode === "mine" || (n.kind && n.kind !== "tree");
      const count = 11 + ((Math.random() * 7) | 0);
      for (let i = 0; i < count; i++) {
        const spread = (Math.random() - 0.5) * 1.7;
        const ca = Math.cos(spread);
        const sa = Math.sin(spread);
        const dx = nx * ca - nz * sa;
        const dz = nz * ca + nx * sa;
        const speed = 1.15 + Math.random() * 2.8;
        const pale = Math.random();
        let chipR, chipG, chipB;
        if (mine) {
          if (n.kind === "metal") { chipR = 0.55 + pale * 0.35; chipG = 0.58 + pale * 0.3; chipB = 0.62 + pale * 0.28; }
          else if (n.kind === "sulfur") { chipR = 0.75 + pale * 0.2; chipG = 0.7 + pale * 0.2; chipB = 0.25 + pale * 0.15; }
          else { chipR = 0.55 + pale * 0.25; chipG = 0.52 + pale * 0.22; chipB = 0.48 + pale * 0.2; }
        } else {
          chipR = 0.48 + pale * 0.28; chipG = 0.27 + pale * 0.2; chipB = 0.1 + pale * 0.09;
        }
        treeParticles.push({
          kind: "chip",
          x: hitX + (Math.random() - 0.5) * 0.12,
          y: hitY + (Math.random() - 0.5) * 0.16,
          z: hitZ + (Math.random() - 0.5) * 0.12,
          vx: dx * speed + (Math.random() - 0.5) * 0.45,
          vy: 1.0 + Math.random() * 2.9,
          vz: dz * speed + (Math.random() - 0.5) * 0.45,
          age: 0,
          life: 0.75 + Math.random() * 0.75,
          size: 0.009 + Math.random() * 0.016,
          long: 2.4 + Math.random() * 3.2,
          ox: dx * 0.7 + (Math.random() - 0.5) * 0.9,
          oy: 0.25 + Math.random() * 0.9,
          oz: dz * 0.7 + (Math.random() - 0.5) * 0.9,
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() * 2 - 1) * 12,
          bounced: false,
          r: chipR, g: chipG, b: chipB,
        });
      }
    }

    function footSurface() {
      const edge = typeof islandEdge === "function" ? islandEdge(player.x, player.z) : 0;
      if (player.swimming || edge > 0.52) return "water";
      // Wood decks / floors under feet
      try {
        const cell = BUILD_CELL;
        const ix = Math.floor(player.x / cell);
        const iz = Math.floor(player.z / cell);
        const fy = player.feetY;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            for (let i = 0; i < buildPieces.length; i++) {
              const p = buildPieces[i];
              if (p.ix !== ix + dx || p.iz !== iz + dz) continue;
              if (!isDeckType(p.type) && !isFloorType(p.type) && !isFoundationType(p.type)) continue;
              const sy = pieceSurfaceY(p, player.x, player.z);
              if (!Number.isFinite(sy)) continue;
              if (Math.abs(fy - sy) < 0.28) return "wood";
            }
          }
        }
      } catch (_) {}
      if (edge > 0.18) return "sand";
      const bid = typeof biomeAtJs === "function" ? biomeAtJs(player.x, player.z) : 0;
      if (bid === 3) return "snow";
      if (bid === 5) return "sand";
      return "grass";
    }

    function updateFootsteps(dt) {
      if ((!player.moving && !player.swimming) || !audio.soundOn) {
        audio.stepCd = Math.min(audio.stepCd, 0.08);
        return;
      }
      // Soft paddle cadence while swimming even if keys idle briefly
      if (!player.moving && player.swimming) return;
      audio.stepCd -= dt;
      if (audio.stepCd <= 0) {
        const surf = footSurface();
        const base = surf === "water" ? 0.32 : 0.42;
        playStep(base + Math.random() * 0.22, surf);
        if (surf === "water") {
          audio.stepCd = player.sprinting ? 0.34 : 0.48;
        } else if (player.crouching) {
          audio.stepCd = camMode === "fpv" ? 0.42 : 0.48;
        } else {
          audio.stepCd = player.sprinting
            ? (camMode === "fpv" ? 0.18 : 0.2)
            : (camMode === "fpv" ? 0.28 : 0.34);
        }
      }
    }

    function rebake() {
      // Always whole island centred at 0 — ignore player snap
      bakeAt(0, 0);
    }

    function isModifierCode(code, key) {
      return (
        code === "ControlLeft" || code === "ControlRight"
        || code === "ShiftLeft" || code === "ShiftRight"
        || code === "AltLeft" || code === "AltRight"
        || code === "Space"
        || key === "Control" || key === "Shift" || key === "Alt"
      );
    }
    function applyModifierKeys(e, down) {
      // Always track mods — UI open / map must not sticky Ctrl crouch
      if (e.code) keys[e.code] = down;
      if (e.key === "Control") {
        keys.ControlLeft = down;
        keys.ControlRight = down;
      }
      if (e.key === "Shift") {
        keys.ShiftLeft = down;
        keys.ShiftRight = down;
      }
      if (e.key === "Alt") {
        keys.AltLeft = down;
        keys.AltRight = down;
      }
      if (
        down
        && (
          e.code === "Space"
          || e.code === "AltLeft" || e.code === "AltRight"
          || e.code === "ControlLeft" || e.code === "ControlRight"
          || e.key === "Control" || e.key === "Alt"
        )
      ) {
        e.preventDefault();
      }
      if (e.code === "ControlLeft" || e.code === "ControlRight" || e.key === "Control") {
        if (down) e.preventDefault();
      }
    }

    function onKey(e, down) {
      // Extra belt: Ctrl+WASD while crouching must never hit browser (tab close)
      if (
        down
        && (e.ctrlKey || e.metaKey)
        && !chatOpen && !craftOpen
        && !isTypingTarget(e.target)
        && (controlsEnabled || (typeof isAimLocked === "function" && isAimLocked()))
      ) {
        const c = e.code || "";
        if (
          c === "KeyW" || c === "KeyA" || c === "KeyS" || c === "KeyD"
          || c === "KeyT" || c === "KeyN" || c === "KeyR"
        ) {
          e.preventDefault();
        }
      }

      const mod = isModifierCode(e.code, e.key);
      if (mod && !capturedCtrlEvents.has(e)) applyModifierKeys(e, down);

      // Chat captures typing
      if (chatOpen && e.target && e.target.id === "fw-chat-input") {
        if (!down && (e.code === "Escape")) setChatOpen(false);
        return;
      }
      // Rust: G = map · M = map only if hammer upgrade menu is closed
      if (down && !e.repeat && (e.code === "KeyG" || e.code === "KeyM")) {
        if (e.code === "KeyM" && upgradeMenuOpen) {
          // fall through to hammer menu hotkeys below
        } else {
          if (!controlsEnabled && !mapOpen) return;
          e.preventDefault();
          toggleMap();
          return;
        }
      }
      if (down && e.code === "Escape") {
        e.preventDefault();
        if (useRadialOpen) { closeUseRadial(); return; }
        if (activeTcId) { closeTcPanel(); return; }
        if (activeBoxId) { closeBoxPanel(); return; }
        if (upgradeMenuOpen) { closeUpgradeMenu(); return; }
        if (radialOpen) { setRadialOpen(false); return; }
        if (chatOpen) { setChatOpen(false); return; }
        if (craftOpen) { setCraftOpen(false); return; }
        if (mapOpen) { setMapOpen(false); return; }
        onHud({ status: "Pausa · Esc otra vez / sigue jugando" });
        return;
      }
      // Hammer menu hotkeys (open with LMB)
      if (upgradeMenuOpen && down && !e.repeat) {
        if (e.code === "KeyX") {
          e.preventDefault();
          runUpgradeMenuAct("demolish");
          return;
        }
        if (e.code === "KeyM") {
          e.preventDefault();
          runUpgradeMenuAct("upgrade");
          return;
        }
        if (e.code === "KeyR") {
          e.preventDefault();
          runUpgradeMenuAct("repair");
          return;
        }
        if (e.code === "KeyY") {
          e.preventDefault();
          runUpgradeMenuAct("flip");
          return;
        }
        if (e.code === "KeyC") {
          e.preventDefault();
          runUpgradeMenuAct("close");
          return;
        }
      }
      if (mapOpen) {
        if (!down && !mod) keys[e.code] = false;
        return;
      }
      if (!controlsEnabled) {
        if (!down && !mod) keys[e.code] = false;
        return;
      }
      if (!mod) keys[e.code] = down;

      // Hotbar 1–6
      if (down && !e.repeat) {
        let slot = -1;
        const dm = e.code && e.code.match(/^Digit([1-6])$/);
        const nm = e.code && e.code.match(/^Numpad([1-6])$/);
        if (dm) slot = Number(dm[1]) - 1;
        else if (nm) slot = Number(nm[1]) - 1;
        else if (e.key >= "1" && e.key <= "6") slot = Number(e.key) - 1;
        if (slot >= 0) {
          e.preventDefault();
          if (radialOpen) setRadialOpen(false);
          const inv = (typeof window !== "undefined" && window.__fw && window.__fw.inv) || null;
          if (inv && typeof inv.setActive === "function") {
            inv.setActive(slot);
            const held = typeof inv.getActive === "function" ? inv.getActive() : null;
            setHeldItem(held);
          }
          return;
        }
      }

      // Q = crafting screen (fabricación / planos desbloqueados)
      if (down && !e.repeat && e.code === "KeyQ") {
        e.preventDefault();
        ensureCraftUi();
        if (progApi && typeof progApi.toggleCraft === "function") {
          progApi.toggleCraft();
          craftOpen = !!progApi.isOpen();
        } else {
          setCraftOpen(!craftOpen);
        }
        return;
      }
      // T / Enter = chat
      if (down && !e.repeat && (e.code === "KeyT" || e.code === "Enter" || e.code === "NumpadEnter")) {
        e.preventDefault();
        setChatOpen(!chatOpen);
        return;
      }
      // F = flashlight
      if (down && !e.repeat && e.code === "KeyF") {
        e.preventDefault();
        flashlightOn = !flashlightOn;
        onHud({ status: flashlightOn ? "Linterna ON" : "Linterna OFF" });
        return;
      }
      // C = cámara 1ª / 3ª / órbita (binding clásico)
      if (down && !e.repeat && e.code === "KeyC") {
        e.preventDefault();
        // Upgrade menu already handled KeyC as close above
        const order = ["fpv", "follow", "orbit"];
        const idx = Math.max(0, order.indexOf(camMode));
        setCameraMode(order[(idx + 1) % 3]);
        return;
      }
      // V = mismo ciclo de cámara (alias)
      if (down && !e.repeat && e.code === "KeyV") {
        e.preventDefault();
        const order = ["fpv", "follow", "orbit"];
        const idx = Math.max(0, order.indexOf(camMode));
        setCameraMode(order[(idx + 1) % 3]);
        return;
      }
      // X = crouch toggle · in build mode = demolish
      if (down && !e.repeat && e.code === "KeyX") {
        e.preventDefault();
        if (buildMode && !radialOpen) tryRemoveAimed();
        else {
          player.crouchToggle = !player.crouchToggle;
          onHud({ status: player.crouchToggle ? "Agachado (toggle)" : "De pie" });
        }
        return;
      }
      // Alt = free look flag (held)
      if (e.code === "AltLeft" || e.code === "AltRight") {
        if (down && !player.freeLook && camMode === "fpv") {
          orbitYaw = player.yaw;
        }
        player.freeLook = !!down;
        if (down) e.preventDefault();
      }

      if (down && e.code === "KeyN") {
        toggleSound();
        unlockAudio();
      }
      if (down && e.code === "KeyB") {
        e.preventDefault();
        if (!heldIsBuildPlan()) onHud({ status: "Equipa el Plano (hotbar) para construir" });
        else setBuildMode(!buildMode);
      }
      if (down && e.code === "Escape") {
        if (radialOpen) { setRadialOpen(false); return; }
        let closedUi = false;
        if (window.__fwBuildAAA && typeof window.__fwBuildAAA.closeUpgradeMenu === "function") {
          window.__fwBuildAAA.closeUpgradeMenu();
          closedUi = true;
        }
        if (window.__fwBuildAAA && typeof window.__fwBuildAAA.closeTcPanel === "function") {
          window.__fwBuildAAA.closeTcPanel();
          closedUi = true;
        }
        if (closedUi) return;
      }
      if (down && !e.repeat && e.code === "KeyU" && heldIsHammer()) {
        if (window.__fwBuildAAA && typeof window.__fwBuildAAA.openUpgradeMenuAimed === "function") {
          window.__fwBuildAAA.openUpgradeMenuAimed();
        }
        return;
      }
      // R: hammer = upgrade menu · build/deploy ghost = rotate 90°
      if (down && !e.repeat && e.code === "KeyR") {
        if (heldIsHammer()) {
          e.preventDefault();
          if (window.__fwBuildAAA && typeof window.__fwBuildAAA.openUpgradeMenuAimed === "function") {
            window.__fwBuildAAA.openUpgradeMenuAimed();
          }
          return;
        }
        if ((buildMode || deployMode) && !radialOpen && !craftOpen) {
          e.preventDefault();
          buildYaw = (buildYaw + 1) & 3;
          makeGhostFromRay();
          const label = deployMode
            ? (BUILD_LABELS[deployMode] || deployMode)
            : (BUILD_LABELS[BUILD_TYPES[buildTypeIdx]] || "pieza");
          onHud({ status: "Rotar · " + (buildYaw * 90) + "° · " + label + " · R gira" });
          return;
        }
      }
      // E press / hold
      if (e.code === "KeyE") {
        e.preventDefault();
        onEKey(!!down);
        return;
      }
      if (down && buildMode && !radialOpen) {
        if (e.code === "KeyU") {
          if (window.__fwBuildAAA) window.__fwBuildAAA.setBuildTool("upgrade");
        }
        if (e.code === "KeyH") {
          if (window.__fwBuildAAA) window.__fwBuildAAA.setBuildTool("repair");
        }
        if (e.code === "KeyK") {
          if (window.__fwBuildAAA) window.__fwBuildAAA.setBuildTool("attack");
        }
        if (e.code === "KeyO") {
          onHud({ status: "Armario · fabrica/equipa tool_cupboard_item (no va en la rueda)" });
        }
        if (e.code === "KeyP") {
          if (window.__fwBuildAAA) window.__fwBuildAAA.setBuildTool("place");
        }
        if (e.code === "BracketLeft") {
          buildTypeIdx = (buildTypeIdx + BUILD_CATALOG.length - 1) % BUILD_CATALOG.length;
          selectRadialIdx(buildTypeIdx, true);
        }
        if (e.code === "BracketRight") {
          buildTypeIdx = (buildTypeIdx + 1) % BUILD_CATALOG.length;
          selectRadialIdx(buildTypeIdx, true);
        }
      }
      // Y: flip soft/hard with hammer or build mode (hint says Y)
      if (down && !e.repeat && e.code === "KeyY" && !upgradeMenuOpen) {
        if (heldIsHammer() || buildMode) {
          e.preventDefault();
          const ray = camBuildRay();
          const hit = ray && rayHitBuilds(ray.o, ray.d);
          if (hit && isWallType(hit.piece.type) && typeof flipWallSoftSide === "function") {
            flipWallSoftSide(hit.piece);
          } else {
            onHud({ status: "Y · mira una pared para voltear soft/hard" });
          }
          return;
        }
      }
      if (down) unlockAudio();
    }

    /**
     * Browser: Ctrl+W closes the tab. Holding W then Ctrl (crouch) re-fires W
     * with ctrlKey and kills the session — block chrome shortcuts while playing.
     */
    function isTypingTarget(t) {
      if (!t || t === document.body || t === document.documentElement) return false;
      const tag = (t.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return !!(t.closest && t.closest("input, textarea, select, [contenteditable='true']"));
    }
    const capturedCtrlEvents = new WeakSet();
    function captureControlCrouch(e) {
      const isCtrl =
        e.code === "ControlLeft" ||
        e.code === "ControlRight" ||
        e.key === "Control";
      if (!isCtrl) return;
      const down = e.type === "keydown";
      capturedCtrlEvents.add(e);
      if (e.code) keys[e.code] = down;
      if (e.key === "Control") {
        keys.ControlLeft = down;
        keys.ControlRight = down;
      }
      // Hold-to-crouch: Ctrl alone (or with WASD) crouches while held.
      // Sticky toggle remains on X (crouchToggle).
      if (down) e.preventDefault();
    }
    function blockBrowserChrome(e) {
      if (chatOpen || craftOpen || mapOpen) return;
      if (isTypingTarget(e.target)) return;
      // Only while the meadow has control / aim lock
      let locked = false;
      try { locked = isAimLocked(); } catch (_) {}
      if (!controlsEnabled && !locked) return;
      const ctrl = !!(e.ctrlKey || e.metaKey);
      if (!ctrl && !e.altKey) return;
      // Keep DevTools available
      if (e.code === "F12") return;
      if (ctrl && e.shiftKey && (e.code === "KeyI" || e.code === "KeyJ" || e.code === "KeyC")) return;
      // Lethal / disruptive browser chords (Ctrl+W close tab is the main one)
      if (ctrl) {
        const c = e.code || "";
        const k = (e.key || "").toLowerCase();
        const lethal =
          c === "KeyW" || c === "KeyA" || c === "KeyS" || c === "KeyD"
          || c === "KeyT" || c === "KeyN" || c === "KeyR" || c === "KeyQ"
          || c === "KeyF" || c === "KeyG" || c === "KeyH" || c === "KeyL"
          || c === "KeyP" || c === "KeyO" || c === "KeyU" || c === "KeyB"
          || c === "KeyE" || c === "KeyK" || c === "KeyJ" || c === "KeyX"
          || c === "KeyC" || c === "KeyV" || c === "KeyZ" || c === "KeyY"
          || c.indexOf("Digit") === 0 || c.indexOf("Numpad") === 0
          || c === "Tab" || c === "Enter" || c === "Backspace"
          || k === "w" || k === "a" || k === "s" || k === "d";
        if (lethal) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
          // Ensure loco still registers when browser re-fires W under Ctrl
          if (c === "KeyW" || k === "w") keys.KeyW = true;
          if (c === "KeyA" || k === "a") keys.KeyA = true;
          if (c === "KeyS" || k === "s") keys.KeyS = true;
          if (c === "KeyD" || k === "d") keys.KeyD = true;
        }
      }
      if (e.altKey && (e.code === "F4" || e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
      }
    }

    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    // Capture on window + document — Ctrl+W must not reach chrome first
    window.addEventListener("keydown", captureControlCrouch, true);
    window.addEventListener("keyup", captureControlCrouch, true);
    window.addEventListener("keydown", blockBrowserChrome, true);
    document.addEventListener("keydown", blockBrowserChrome, true);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    let ptrDownX = 0, ptrDownY = 0, ptrDragDist = 0;
    canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); });
    // Middle-click often fires auxclick / default navigations — keep it for the build wheel.
    canvas.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener("pointerdown", (e) => {
      unlockAudio();
      if (!controlsEnabled) return;
      // Absorb OS cursor into center reticle (pointer lock)
      if (!isAimLocked() && e.button === 0) requestAimLock();
      // MMB: Plano build radial (hold + aim, release to pick)
      if (e.button === 1) {
        e.preventDefault();
        if (ensureBuildPlanEquipped()) {
          if (!buildMode) setBuildMode(true);
          setRadialOpen(true);
          radialHeld = true;
          try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        } else {
          onHud({ status: "MMB rueda · equipa Plano · RMB órbita" });
        }
        return;
      }
      // RMB: orbit camera (hammer menu is LMB now)
      // Right-click often swallows keyup in browsers → clear loco so WASD can't stick
      if (e.button === 2) {
        e.preventDefault();
        clearLocoKeys();
        dragging = true;
        orbitRmb = true;
        ptrDragDist = 0;
        ptrDownX = e.clientX;
        ptrDownY = e.clientY;
        lastMx = e.clientX;
        lastMy = e.clientY;
        if (camMode !== "fpv") {
          player.yaw = Math.atan2(-Math.sin(orbitYaw), -Math.cos(orbitYaw));
        }
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }
      if (e.button !== 0) return;
      buildPlacedOnDown = false;
      ptrDragDist = 0;
      ptrDownX = e.clientX;
      ptrDownY = e.clientY;
      lastMx = e.clientX;
      lastMy = e.clientY;
      // F7 tool editor: LMB drag orbits the avatar (no place / swing)
      // Skip if the VRM gizmo is handling this pointer
      if (toolEditorUiOpen) {
        if (window.__fw && window.__fw.toolGizmoDragging) return;
        dragging = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
        return;
      }
      // Build/deploy: place on press so RMB orbit can stay held
      if ((buildMode || deployMode) && !radialOpen && !vitals.dead) {
        e.preventDefault();
        if (window.__fwBuildAAA && typeof window.__fwBuildAAA.tryBuildToolAction === "function") {
          window.__fwBuildAAA.tryBuildToolAction();
        } else {
          tryPlaceGhost();
        }
        buildPlacedOnDown = true;
        // Keep orbit alive if RMB is still down
        if (!orbitRmb) dragging = true;
        return;
      }
      dragging = true;
      if (heldIsGather() && !buildMode && !deployMode) {
        gatherHold = true;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    const endDrag = (e) => {
      if (e && e.button === 0) clearGatherHold();
      if (e && e.button === 1 && radialHeld) {
        radialHeld = false;
        if (radialOpen) {
          if (radialHoverIdx >= 0) selectRadialIdx(radialHoverIdx, true);
          setRadialOpen(false);
        }
        return;
      }
      if (e && e.button === 2) {
        // Only end orbit — don't touch LMB drag state
        orbitRmb = false;
        if (!(e.buttons & 1)) dragging = false;
        clearLocoKeys();
        return;
      }
      if (e && e.button === 0) {
        // Already placed on pointerdown while building
        if (buildPlacedOnDown) {
          buildPlacedOnDown = false;
          if (!orbitRmb) dragging = false;
          return;
        }
        // F7: LMB only orbits — never swing / place / hammer menu
        if (toolEditorUiOpen) {
          if (!orbitRmb) dragging = false;
          return;
        }
        if ((dragging || orbitRmb) && !radialOpen && ptrDragDist < 8) {
          if (vitals.dead) {
            if (!orbitRmb) dragging = false;
            return;
          }
          if (deployMode || buildMode) {
            if (window.__fwBuildAAA && typeof window.__fwBuildAAA.tryBuildToolAction === "function") {
              window.__fwBuildAAA.tryBuildToolAction();
            } else {
              tryPlaceGhost();
            }
          } else if (heldIsFood()) {
            tryEatFood();
          } else if (heldIsSatchel()) {
            placeStickyCharge("satchel");
          } else if (heldIsC4()) {
            placeStickyCharge("c4");
          } else if (heldIsRocket()) {
            fireRocket();
          } else if (heldIsHammer()) {
            // LMB: open hammer options (demolish / upgrade / repair)
            if (window.__fwBuildAAA && typeof window.__fwBuildAAA.openUpgradeMenuAimed === "function") {
              window.__fwBuildAAA.openUpgradeMenuAimed();
            }
          } else if (heldIsLock()) {
            if (window.__fwBuildAAA && typeof window.__fwBuildAAA.tryLockAimed === "function") {
              window.__fwBuildAAA.tryLockAimed();
            }
          } else if (heldIsGather()) {
            if (!gatherSwing) beginGatherSwing();
          } else {
            player.attackPulse = true;
          }
        }
        // Keep camera orbit if RMB still held
        if (!orbitRmb) dragging = false;
        return;
      }
      if (!orbitRmb) dragging = false;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", () => {
      dragging = false; orbitRmb = false; radialHeld = false;
      buildPlacedOnDown = false;
      clearGatherHold();
      // Let an in-progress swing finish (anim + impact) even if pointer cancels
    });
    window.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointermove", (e) => {
      if (radialOpen) {
        // Pointer-lock freezes clientX/Y — drive the wheel with deltas (Rust)
        if (isAimLocked() || radialHeld) {
          radialAimFromDelta(e.movementX || 0, e.movementY || 0);
        } else {
          radialPickFromPointer(e.clientX, e.clientY);
        }
        return;
      }
      // Pointer-lock: mouse = mira (siempre mira, sin arrastrar)
      if (isAimLocked() && controlsEnabled) {
        applyLookDelta(e.movementX || 0, e.movementY || 0);
        return;
      }
      // Orbit works with RMB even if LMB just placed a piece
      if (window.__fw && window.__fw.toolGizmoDragging) return;
      if ((!dragging && !orbitRmb) || !controlsEnabled) return;
      const dx = e.clientX - lastMx, dy = e.clientY - lastMy;
      if (!buildPlacedOnDown) ptrDragDist += Math.abs(dx) + Math.abs(dy);
      lastMx = e.clientX; lastMy = e.clientY;
      applyLookDelta(dx, dy);
      if (orbitRmb && camMode !== "fpv") {
        player.yaw = Math.atan2(-Math.sin(orbitYaw), -Math.cos(orbitYaw));
      }
    });
    document.addEventListener("pointerlockchange", () => {
      syncStageCamFlags();
      if (isAimLocked()) {
        lockGameKeys();
        onHud({ status: "Mira activa · Esc suelta el mouse" });
      } else {
        unlockGameKeys();
      }
    });
    // Last resort — confirm before leaving while playing
    window.addEventListener("beforeunload", (e) => {
      if (!controlsEnabled) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    });
    window.addEventListener("pointermove", (e) => {
      if (!radialOpen) return;
      // Avoid double-apply when canvas already handled (capture / target)
      if (e.target === canvas || (canvas.contains && canvas.contains(e.target))) return;
      if (isAimLocked() || radialHeld) {
        radialAimFromDelta(e.movementX || 0, e.movementY || 0);
      } else {
        radialPickFromPointer(e.clientX, e.clientY);
      }
    });
    canvas.addEventListener("wheel", (e) => {
      if (!controlsEnabled) return;
      // F7: always zoom around the avatar (ignore build-piece wheel)
      if (toolEditorUiOpen) {
        const minD = 1.8;
        const maxD = 12;
        orbitDist = Math.max(minD, Math.min(maxD, orbitDist + e.deltaY * 0.015));
        if (camMode === "follow") followDist = orbitDist;
        else freeOrbitDist = orbitDist;
        e.preventDefault();
        return;
      }
      if (buildMode && !e.shiftKey) {
        e.preventDefault();
        const dir = e.deltaY > 0 ? 1 : -1;
        buildTypeIdx = (buildTypeIdx + dir + BUILD_CATALOG.length) % BUILD_CATALOG.length;
        selectRadialIdx(buildTypeIdx, true);
        return;
      }
      if (camMode === "fpv") return;
      const minD = camMode === "orbit" ? 5 : 2.4;
      const maxD = camMode === "orbit" ? 42 : 9;
      orbitDist = Math.max(minD, Math.min(maxD, orbitDist + e.deltaY * 0.015));
      if (camMode === "follow") followDist = orbitDist;
      else freeOrbitDist = orbitDist;
      e.preventDefault();
    }, { passive: false });

    const onResize = () => {
      size = configure();
      rebuildTargets();
    };
    window.addEventListener("resize", onResize);

    function update(dt) {
      if (!chunk || !controlsEnabled || mapOpen || chatOpen || craftOpen || vitals.dead) {
        player.moving = false;
        player.sprinting = false;
        player.moveMx = 0;
        player.moveMz = 0;
        if (chunk) updateCompass();
        return;
      }
      // F7 tool editor: freeze locomotion; keep orbit / free-look
      if (toolEditorUiOpen) {
        player.freeLook = true;
        player.crouching = false;
        player.moving = false;
        player.sprinting = false;
        player.moveMx = 0;
        player.moveMz = 0;
        try { clearLocoKeys(); } catch (_) {}
      } else {
        player.freeLook = !!(keys.AltLeft || keys.AltRight);
        // Hold Ctrl = crouch · X = sticky toggle · works standing still (no WASD)
        player.crouching = !player.swimming && !!(
          player.crouchToggle
          || keys.ControlLeft
          || keys.ControlRight
        );
      }
      let mx = 0, mz = 0;
      // Rust WASD — same in FPV / follow / orbit (V cycles camera)
      // W forward · S back · A left · D right · diagonals OK · crouch walks too
      if (!toolEditorUiOpen && !radialOpen && !upgradeMenuOpen) {
        if (keys.KeyW || keys.ArrowUp) mz += 1;
        if (keys.KeyS || keys.ArrowDown) mz -= 1;
        if (keys.KeyA || keys.ArrowLeft) mx -= 1;
        if (keys.KeyD || keys.ArrowRight) mx += 1;
      }
      player.moving = !!(mx || mz);
      player.sprinting = player.moving && !player.crouching && !!(keys.ShiftLeft || keys.ShiftRight);
      // Keep raw diagonals (±1,±1) for anim; normalize only for velocity
      player.moveMx = mx;
      player.moveMz = mz;
      // Moving cancels gather (anim + swing stop immediately)
      if (player.moving) cancelGatherForMove();
      // Hold LMB while standing → continuous gather swings
      if (gatherSwing) {
        tickGatherSwing(dt);
      } else if (gatherHold && !player.moving && heldIsGather() && !buildMode && !deployMode && !radialOpen) {
        beginGatherSwing();
      }
      if (player.moving) {
        const len = Math.hypot(mx, mz) || 1;
        mx /= len;
        mz /= len;
        // Same speeds every cam mode (Rust)
        const walkSpd = 3.2;
        const runSpd = 8.5;
        let speed = player.sprinting ? runSpd : walkSpd;
        if (player.crouching) speed *= 0.55;
        // Loco yaw: look-relative unless Alt free-look (then body yaw)
        let yaw;
        if (player.freeLook) {
          yaw = player.yaw;
        } else if (camMode === "fpv") {
          yaw = player.yaw;
        } else {
          // Into the scene (same as body face when not free-looking)
          yaw = Math.atan2(-Math.sin(orbitYaw), -Math.cos(orbitYaw));
        }
        const fx = Math.sin(yaw);
        const fz = Math.cos(yaw);
        // Camera/look right in XZ (cross forward × up) — A left, D right
        const rx = -Math.cos(yaw);
        const rz = Math.sin(yaw);
        // Slower only when feet are actually in water (not on dry/wet sand)
        const gPre = sampleHeight(chunk, player.x, player.z);
        const wetMul = gPre < SEA_Y
          ? Math.max(0.28, 1 - (SEA_Y - gPre) * 0.4)
          : 1;
        const vx = (mx * rx + mz * fx) * speed * wetMul * dt;
        const vz = (mx * rz + mz * fz) * speed * wetMul * dt;
        // Slide against solid trunks (try full move, then axis slides)
        const ox = player.x, oz = player.z;
        let nx = ox + vx, nz = oz + vz;
        if (solidHit(nx, nz)) {
          const freeX = !solidHit(ox + vx, oz);
          const freeZ = !solidHit(ox, oz + vz);
          if (freeX && freeZ) {
            // corner case — prefer the larger component
            if (Math.abs(vx) >= Math.abs(vz)) nx = ox + vx, nz = oz;
            else nx = ox, nz = oz + vz;
          } else if (freeX) {
            nx = ox + vx; nz = oz;
          } else if (freeZ) {
            nx = ox; nz = oz + vz;
          } else {
            nx = ox; nz = oz;
          }
        }
        player.x = nx;
        player.z = nz;
        resolveSolids();
      }
      // Body faces look direction in all cams (strafe without spinning). Alt keeps body yaw.
      if (!player.freeLook) {
        if (camMode === "fpv") {
          // already mouse-driven
        } else {
          player.yaw = Math.atan2(-Math.sin(orbitYaw), -Math.cos(orbitYaw));
        }
      }
      // Stay near island — allow brief wade, not open-ocean walking
      {
        const ir = Math.hypot(player.x, player.z);
        const rim = coastRadius(player.x, player.z);
        const irMax = rim * 0.98;
        if (ir > irMax && ir > 1e-4) {
          const s = irMax / ir;
          player.x *= s;
          player.z *= s;
        }
      }
      resolveSolids();
      // Feet + jump / swim (Rust: Space jump/swim-up, Ctrl crouch/swim-down)
      {
        const terrainY = sampleHeight(chunk, player.x, player.z);
        const groundY = buildSupportY(player.x, player.z, terrainY);
        const edge = islandEdge(player.x, player.z);
        const inWater = terrainY < SEA_Y && groundY <= terrainY + 0.05;
        player.swimming = inWater;
        const onGround = !inWater && player.feetY <= groundY + 0.12 && player.vy <= 0.08;

        if (inWater) {
          if (keys.Space) player.vy = Math.min(3.2, player.vy + 14 * dt);
          if (keys.ControlLeft || keys.ControlRight || player.crouchToggle) player.vy = Math.max(-3.2, player.vy - 14 * dt);
          player.vy *= Math.pow(0.25, dt);
          player.feetY += player.vy * dt;
          const minY = groundY;
          const maxY = SEA_Y - 0.15;
          if (player.feetY < minY) { player.feetY = minY; player.vy = 0; }
          if (player.feetY > maxY) { player.feetY = maxY; player.vy = Math.min(0, player.vy); }
          player._sinkY = player.feetY;
          player.jumping = false;
          if (edge > 0.62) {
            const ir = Math.hypot(player.x, player.z) || 1;
            const pull = coastRadius(player.x, player.z) * 0.86;
            const s = pull / ir;
            const a = Math.min(1, 1.6 * dt);
            player.x = player.x * (1 - a) + player.x * s * a;
            player.z = player.z * (1 - a) + player.z * s * a;
          }
        } else {
          // Space = jump (Fortnite/Rust: crouch+jump stands up then jumps)
          if (keys.Space && onGround) {
            if (player.crouching) {
              player.crouchToggle = false;
              keys.ControlLeft = false;
              keys.ControlRight = false;
              player.crouching = false;
            }
            player.vy = 6.4;
            player.jumping = true;
          }
          player.vy -= 18 * dt;
          player.feetY += player.vy * dt;
          if (player.feetY <= groundY) {
            player.feetY = groundY;
            player.vy = 0;
            player.jumping = false;
          } else {
            player.jumping = true;
          }
          player._sinkY = player.feetY;
        }
      }
      // Re-resolve crouch after jump may have cleared the toggle / Ctrl.
      player.crouching = !player.swimming && !!(
        player.crouchToggle
        || keys.ControlLeft
        || keys.ControlRight
      );
      // Eye height: FPV + 3rd person (C cycles cams) — lower when crouched
      const eyeH = player.crouching ? 1.05 : 1.55;
      player.y = player.feetY + eyeH;

      if (buildMode || deployMode) makeGhostFromRay();
      // Aim point for head/eyes (mouse ray / ghost placement)
      {
        const ray = camBuildRay();
        if ((buildMode || deployMode) && ghostCell) {
          const cx = (ghostCell.ix + 0.5) * BUILD_CELL;
          const cz = (ghostCell.iz + 0.5) * BUILD_CELL;
          const cy = (ghostCell.baseY || 0)
            + ((ghostCell.iy || 0) * BUILD_LEVEL_H)
            + BUILD_LEVEL_H * 0.55;
          lastLookAt = [cx, cy, cz];
        } else if (ray) {
          const hitB = rayHitBuilds(ray.o, ray.d);
          const hitT = rayHitTerrain(ray.o, ray.d);
          let t = 14;
          if (hitB && hitB.t > 0.15) t = hitB.t;
          if (hitT && hitT.t > 0.15 && (!hitB || hitT.t < hitB.t)) t = hitT.t;
          t = Math.min(Math.max(t, 1.5), 28);
          lastLookAt = [
            ray.o[0] + ray.d[0] * t,
            ray.o[1] + ray.d[1] * t,
            ray.o[2] + ray.d[2] * t,
          ];
        } else {
          const fy = Math.sin(player.yaw);
          const fz = Math.cos(player.yaw);
          lastLookAt = [
            player.x + fy * 6,
            player.feetY + 1.45,
            player.z + fz * 6,
          ];
        }
      }
      if (window.__fwBuildAAA && typeof window.__fwBuildAAA.updateHook === "function") {
        window.__fwBuildAAA.updateHook(dt);
      }

      // HUD biome stamp (~4 Hz)
      {
        const t = performance.now();
        if (((t / 250) | 0) !== ((lastHudBiome / 250) | 0)) {
          lastHudBiome = t;
          if (deployMode) {
            const tag = ghostOk
              ? (" · " + (ghostReason || "OK"))
              : (" · " + (ghostReason || "bloqueado"));
            const deployLabels = {
              toolcupboard: "Colocar Armario",
              workbench: "Colocar Mesa",
              research_table: "Colocar Investigación",
              campfire: "Colocar Fogata",
              sleeping_bag: "Colocar Saco",
              box_small: "Colocar Caja",
              box_large: "Colocar Cofre",
              metal_door: "Colocar Puerta",
            };
            const dLab = deployLabels[deployMode] || ("Colocar " + String(deployMode));
            onHud({
              status: dLab + tag + " · LMB confirma",
            });
          } else if (buildMode) {
            const label = BUILD_LABELS[BUILD_TYPES[buildTypeIdx]] || "Build";
            const tool = (window.__fwBuildAAA && window.__fwBuildAAA.getTool) ? window.__fwBuildAAA.getTool() : "place";
            const tag = ghostOk
              ? (" · " + (ghostReason || "OK"))
              : (" · " + (ghostReason || "bloqueado"));
            onHud({
              status: "Build · " + label + " · [" + tool + "]" + tag + " · " + buildPieces.length + " pcs",
            });
          } else {
            const bid = biomeAtJs(player.x, player.z);
            onHud({
              status: BIOME_NAMES[bid] + " · " + (_celestial.dayW > 0.5 ? "día" : (_celestial.nightW > 0.5 ? "noche" : "crepúsculo")),
            });
          }
        }
      }

      updateCompass();

      // Drop denser trail while walking — narrow footprints, fade fast
      for (let i = 0; i < trailPts.length; i++) {
        trailPts[i].w *= Math.pow(0.78, dt * 60);
      }
      // Always refresh live footprint
      if (!player.moving) {
        trailPts[0] = { x: player.x, z: player.z, w: Math.max(trailPts[0].w, 0.28) };
      }
      if (player.moving) {
        const dx = player.x - trailLastX;
        const dz = player.z - trailLastZ;
        if (dx * dx + dz * dz > 0.028) {
          trailPts.pop();
          trailPts.unshift({ x: player.x, z: player.z, w: 0.7 });
          trailLastX = player.x;
          trailLastZ = player.z;
        }
      }
      updateFootsteps(dt);
      updateAmbience(dt);
      if (gatherHitKick > 0) {
        gatherHitKick = Math.max(0, gatherHitKick - dt * 0.42);
      }

      // Grass is full-island (baked once); streaming disabled
      refreshGrassPatch(false);

      nextBeam -= dt;
      if (nextBeam <= 0) {
        nextBeam = 2 + Math.random() * 3;
        // pulse beam alphas via regenerating occasionally is heavy; skip for now
      }
    }

    /** AABBs the camera must not clip through (walls w/ door openings, decks, roofs, furniture). */
    function collectCameraObstacleAabbs() {
      const out = [];
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type === "world_ore" || p.type === "world_tree" || p.type === "scrap_barrel") continue;
        if (isWallType(p.type) || p.type === "door") {
          const cols = pieceColliders(p);
          for (let c = 0; c < cols.length; c++) out.push(cols[c]);
          continue;
        }
        if (isFoundationType(p.type) || isFloorType(p.type) || isRoofType(p.type)
          || isRampType(p.type) || isFurnitureDeploy(p.type)) {
          out.push(pieceAabb(p));
        }
      }
      return out;
    }

    function expandAabbPad(b, pad) {
      return {
        minX: b.minX - pad, maxX: b.maxX + pad,
        minY: b.minY - pad, maxY: b.maxY + pad,
        minZ: b.minZ - pad, maxZ: b.maxZ + pad,
      };
    }

    /**
     * Pull camera along target→eye so it never punches through terrain or builds.
     * Inside a closed base the eye stays in the room instead of clipping walls/roof/floor.
     */
    function resolveCameraEye(eye, target) {
      const CAM_PAD = 0.32;
      const MIN_DIST = 0.65;
      const GROUND_CLEAR = 0.4;
      let dx = eye[0] - target[0];
      let dy = eye[1] - target[1];
      let dz = eye[2] - target[2];
      const fullDist = Math.hypot(dx, dy, dz) || 1;
      const d = [dx / fullDist, dy / fullDist, dz / fullDist];
      let maxT = fullDist;

      // Terrain: walk the ray and cut before burying into the ground
      if (chunk) {
        const step = Math.max(0.18, fullDist / 28);
        for (let t = step; t < fullDist; t += step) {
          const x = target[0] + d[0] * t;
          const y = target[1] + d[1] * t;
          const z = target[2] + d[2] * t;
          let g = sampleHeight(chunk, x, z) + GROUND_CLEAR;
          // Beach / dry land: also respect sea plane so cam doesn't dive under sand shelf
          if (sampleHeight(chunk, x, z) >= SEA_Y) g = Math.max(g, SEA_Y + 0.18);
          if (y < g) {
            maxT = Math.min(maxT, Math.max(MIN_DIST, t - CAM_PAD));
            break;
          }
        }
      }

      // Construction: first hit wins (doorway openings use frame colliders only)
      const boxes = collectCameraObstacleAabbs();
      for (let i = 0; i < boxes.length; i++) {
        const b = expandAabbPad(boxes[i], 0.06);
        const tHit = rayAabb(target, d, b);
        if (tHit == null) continue;
        if (tHit > 0.08 && tHit < maxT) {
          maxT = Math.max(MIN_DIST, tHit - CAM_PAD);
        }
      }

      maxT = Math.max(MIN_DIST, Math.min(fullDist, maxT));
      const out = [
        target[0] + d[0] * maxT,
        target[1] + d[1] * maxT,
        target[2] + d[2] * maxT,
      ];
      // Final ground clamp (safety)
      if (chunk) {
        const minY = sampleHeight(chunk, out[0], out[2]) + GROUND_CLEAR;
        if (out[1] < minY) out[1] = minY;
      }
      return out;
    }

    let sprintFovBlend = 0;
    let camShake = 0;
    function cameraMatrices() {
      const aspect = size.w / Math.max(1, size.h);
      // FPV look-down: keep near tiny so grass/ground don't clip into a band
      const near = camMode === "fpv" ? 0.02 : NEAR;
      const targetFov = player.sprinting && !player.crouching ? 1 : 0;
      sprintFovBlend += (targetFov - sprintFovBlend) * 0.12;
      const fovDeg = 48 + sprintFovBlend * 5.5;
      const proj = mat4Persp((fovDeg * Math.PI) / 180, aspect, near, FAR);
      let eye, target;
      if (camMode === "fpv") {
        // Rust-style: pivot at neck, push forward (never into torso).
        // Looking down must see chest/legs from outside — not shirt interior.
        const yaw = player.freeLook ? orbitYaw : player.yaw;
        const hx = Math.sin(yaw);
        const hz = Math.cos(yaw);
        const neckH = player.crouching ? 1.05 : 1.22;
        const pitchDown = Math.max(0, -fpvPitch); // 0..~1.2 when aiming at feet
        const fwd = 0.16 + pitchDown * 0.28; // more forward as you look down
        eye = [
          player.x + hx * fwd,
          player.feetY + neckH + pitchDown * 0.03,
          player.z + hz * fwd,
        ];
        if (chunk) {
          const minNeck = sampleHeight(chunk, player.x, player.z) + (player.crouching ? 0.88 : 1.28);
          if (eye[1] < minNeck) eye[1] = minNeck;
        }
        const cp = Math.cos(fpvPitch);
        const sp = Math.sin(fpvPitch);
        const fx = hx * cp;
        const fy = sp;
        const fz = hz * cp;
        target = [
          eye[0] + fx,
          eye[1] + fy,
          eye[2] + fz,
        ];
      } else {
        // Follow + Orbit: spherical camera around avatar (left-drag spins this)
        const dist = orbitDist;
        const cy = Math.cos(orbitPitch);
        const sy = Math.sin(orbitPitch);
        // Drop aim / cam with crouch so 3rd-person C-crouch is obvious
        const crouchDrop = player.crouching ? 0.55 : 0;
        const standLook = camMode === "orbit" ? 1.05 : 0.95;
        const lookY = player.feetY + standLook - crouchDrop
          + (orbitPitch < 0 ? orbitPitch * 0.35 : 0);
        const yBias = (camMode === "orbit" ? 0.6 : 0.15) - crouchDrop * 0.35;
        eye = [
          player.x + Math.sin(orbitYaw) * cy * dist,
          lookY + sy * dist + yBias,
          player.z + Math.cos(orbitYaw) * cy * dist,
        ];
        target = [player.x, Math.max(player.feetY + 0.35, lookY), player.z];
        eye = resolveCameraEye(eye, target);
      }
      // Mid-swing hit feedback: brief camera punch along look axis
      if (gatherHitKick > 0.0005) {
        const dx = target[0] - eye[0];
        const dy = target[1] - eye[1];
        const dz = target[2] - eye[2];
        const len = Math.hypot(dx, dy, dz) || 1;
        const k = gatherHitKick;
        eye = [eye[0] + (dx / len) * k, eye[1] + (dy / len) * k * 0.55, eye[2] + (dz / len) * k];
      }
      if (camShake > 0.001) {
        const s = camShake;
        eye[0] += (Math.random() * 2 - 1) * s * 0.08;
        eye[1] += (Math.random() * 2 - 1) * s * 0.05;
        eye[2] += (Math.random() * 2 - 1) * s * 0.08;
        target[0] += (Math.random() * 2 - 1) * s * 0.04;
        target[1] += (Math.random() * 2 - 1) * s * 0.03;
        target[2] += (Math.random() * 2 - 1) * s * 0.04;
        camShake *= 0.86;
      } else {
        camShake = 0;
      }
      const view = mat4LookAt(eye, target, [0, 1, 0]);
      lastEye = eye;
      lastTarget = target;
      // Halton jitter off — without motion vectors it ghosts and edges flash blue/white
      return {
        mvp: mat4Mul(proj, view),
        view, proj, target,
        eye,
        focusDist: Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]),
      };
    }

    function fitLightCascade(corners, lightTo) {
      let cx = 0, cy = 0, cz = 0;
      for (const p of corners) { cx += p[0]; cy += p[1]; cz += p[2]; }
      const n = corners.length;
      cx /= n; cy /= n; cz /= n;
      let radius = 1;
      for (const p of corners) {
        radius = Math.max(radius, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz));
      }
      radius *= 1.08;
      // Stabilize shimmer: quantize radius
      const quant = 2.0;
      radius = Math.ceil(radius / quant) * quant;
      const dist = radius * 2.8 + 30;
      const lx = cx + lightTo[0] * dist;
      const ly = cy + lightTo[1] * dist;
      const lz = cz + lightTo[2] * dist;
      const up = Math.abs(lightTo[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
      const lightView = mat4LookAt([lx, ly, lz], [cx, cy, cz], up);
      // Snap center in light space to texel size
      const centerLS = [
        lightView[0] * cx + lightView[4] * cy + lightView[8] * cz + lightView[12],
        lightView[1] * cx + lightView[5] * cy + lightView[9] * cz + lightView[13],
        lightView[2] * cx + lightView[6] * cy + lightView[10] * cz + lightView[14],
      ];
      const texel = (radius * 2) / SHADOW_RES;
      centerLS[0] = Math.floor(centerLS[0] / texel) * texel;
      centerLS[1] = Math.floor(centerLS[1] / texel) * texel;
      const ortho = mat4Ortho(
        centerLS[0] - radius, centerLS[0] + radius,
        centerLS[1] - radius, centerLS[1] + radius,
        1.0, dist + radius * 2.2
      );
      return mat4Mul(ortho, lightView);
    }

    function cascadeCorners(eye, target, nearD, farD, fov, aspect) {
      const fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2];
      let fl = Math.hypot(fx, fy, fz) || 1;
      const f = [fx / fl, fy / fl, fz / fl];
      let rx = 0 * f[2] - 1 * f[1], ry = 1 * f[2] - 0 * f[0], rz = 0 * f[1] - 0 * f[0];
      // right = cross(f, up) with up=(0,1,0) → (f.z, 0, -f.x) wait: cross(f, up) = (f.y*0-f.z*1, f.z*0-f.x*0, f.x*1-f.y*0) = (-f.z, 0, f.x)
      rx = -f[2]; ry = 0; rz = f[0];
      let rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      // up = cross(right, f)
      const ux = ry * f[2] - rz * f[1];
      const uy = rz * f[0] - rx * f[2];
      const uz = rx * f[1] - ry * f[0];
      const tanH = Math.tan(fov * 0.5);
      const out = [];
      for (const d of [nearD, farD]) {
        const hh = tanH * d;
        const ww = hh * aspect;
        const cx = eye[0] + f[0] * d;
        const cy = eye[1] + f[1] * d;
        const cz = eye[2] + f[2] * d;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            out.push([
              cx + rx * ww * sx + ux * hh * sy,
              cy + ry * ww * sx + uy * hh * sy,
              cz + rz * ww * sx + uz * hh * sy,
            ]);
          }
        }
      }
      return out;
    }

    function currentGatherMode() {
      // Only while holding LMB and not walking — VRM mine/chop loop
      if (player.moving) return null;
      if (!gatherHold && !gatherSwing) return null;
      if (gatherSwing && gatherSwing.mode) return gatherSwing.mode;
      if (gatherHold && gatherLockNode && !gatherLockNode.dead && gatherToolMatches(gatherLockNode)) {
        return gatherModeForNode(gatherLockNode);
      }
      if (gatherHold && heldIsPick()) return "mine";
      if (gatherHold && heldIsAxe()) return "chop";
      if (gatherHold && heldIsGather()) return "gather";
      return null;
    }

    /** Feet pose only — no pulse side-effects (safe for Turso persist). */
    function getFeetPose() {
      return {
        x: player.x, y: player.feetY, z: player.z, yaw: player.yaw,
      };
    }

    function getPose() {
      const attackPulse = !!player.attackPulse;
      const gatherPulse = !!player.gatherPulse;
      const chopPulse = !!player.chopPulse;
      const minePulse = !!player.minePulse;
      player.attackPulse = false;
      player.gatherPulse = false;
      player.chopPulse = false;
      player.minePulse = false;
      const gatherMode = currentGatherMode();
      return {
        x: player.x, y: player.feetY, z: player.z, yaw: player.yaw,
        moving: player.moving, sprinting: player.sprinting,
        jumping: !!player.jumping, crouching: !!player.crouching, swimming: !!player.swimming,
        freeLook: !!player.freeLook, flashlight: !!flashlightOn,
        moveMx: player.moveMx || 0, moveMz: player.moveMz || 0,
        lookAt: lastLookAt,
        attackPulse, gatherPulse, chopPulse, minePulse,
        gatherMode,
        heldId: heldItem && heldItem.id ? String(heldItem.id) : "",
        gatherHold: !!(!player.moving && (gatherHold || gatherSwing)),
        camMode, eye: lastEye, target: lastTarget,
        aspect: size.w / Math.max(1, size.h), fovDeg: 48 + (sprintFovBlend || 0) * 5.5,
        // Match meadow near so avatar depth-comp doesn't fight grass
        near: camMode === "fpv" ? 0.02 : NEAR,
        far: FAR,
        // Drive VRM lights from meadow TOD / sun
        tod: _celestial.tod,
        sunTo: _celestial.sunTo,
        lightCol: _celestial.lightCol || null,
        amb: _celestial.amb != null ? _celestial.amb : 0.2,
        dayW: _celestial.dayW,
        nightW: _celestial.nightW,
        duskW: _celestial.duskW,
      };
    }

    function setAvatarAtlasSource(fn) {
      getAvatarAtlas = typeof fn === "function" ? fn : null;
    }

    function setPaused(on) {
      paused = !!on;
      if (!paused && alive) {
        t0 = performance.now();
        if (!raf) raf = requestAnimationFrame(frame);
      }
    }

    function frame() {
      if (!alive) return;
      if (paused) { raf = 0; return; }
      const now = performance.now();
      const dt = Math.min(0.05, (now - t0) / 1000);
      t0 = now;

      // Real delivered FPS (animation-frame count over a short window)
      if (!fpsWindowStart) fpsWindowStart = now;
      fpsFrames++;
      if (now - fpsWindowStart >= 500) {
        fpsShown = (fpsFrames * 1000) / (now - fpsWindowStart);
        fpsFrames = 0;
        fpsWindowStart = now;
        if (fpsEl) fpsEl.textContent = Math.round(fpsShown) + " FPS";
        onHud({ fps: fpsShown });
      }

      update(dt);

      const { mvp, view, proj, target, eye, focusDist } = cameraMatrices();
      lastMvp = mvp;
      try { updateInteractPrompt(); } catch (_) {}
      try { tickPeerOverlays(); } catch (_) {}

      // Full day/night cycle (~2.5 min). Offset so load starts mid-morning.
      const DAY_LEN = 1800; // 30 min full day/night (was 150s — too fast)
      const tod = ((now * 0.001) / DAY_LEN + 0.35) % 1;
      const az = tod * Math.PI * 2;
      const sunElev = Math.sin(az - Math.PI * 0.5);
      const cosE = Math.sqrt(Math.max(1e-5, 1 - sunElev * sunElev));
      let sunTo = [Math.sin(az) * cosE, sunElev, Math.cos(az) * cosE];
      // Moon roughly opposite, nudged so it climbs at night
      let moonTo = [-sunTo[0], -sunElev * 0.92 + 0.08, -sunTo[2]];
      {
        const ml = Math.hypot(moonTo[0], moonTo[1], moonTo[2]) || 1;
        moonTo = [moonTo[0] / ml, moonTo[1] / ml, moonTo[2] / ml];
      }
      const dayW = Math.min(1, Math.max(0, (sunElev + 0.05) / 0.22));
      const nightW = Math.min(1, Math.max(0, (-sunElev + 0.02) / 0.2));
      const duskW = Math.exp(-Math.pow(sunElev / 0.18, 2)) * (sunElev > -0.3 ? 1 : 0.4);
      // Active light direction: sun by day, moon by night, blend at twilight
      let lightTo = [
        sunTo[0] * dayW + moonTo[0] * nightW,
        sunTo[1] * dayW + Math.max(moonTo[1], 0.15) * nightW,
        sunTo[2] * dayW + moonTo[2] * nightW,
      ];
      if (dayW + nightW < 0.15) {
        // Deep twilight — keep a dim horizon key
        lightTo = [sunTo[0], Math.max(sunElev, 0.08), sunTo[2]];
      }
      {
        const ll = Math.hypot(lightTo[0], lightTo[1], lightTo[2]) || 1;
        lightTo = [lightTo[0] / ll, lightTo[1] / ll, lightTo[2] / ll];
      }
      const sunCol = [1.0, 0.96, 0.88];
      const duskCol = [1.0, 0.52, 0.22];
      const moonCol = [0.45, 0.55, 0.85];
      const sunI = 1.78 * dayW + 0.92 * duskW * (1 - dayW * 0.5);
      const moonI = 0.42 * nightW;
      let lightCol = [
        sunCol[0] * sunI * dayW + duskCol[0] * sunI * duskW * (1 - dayW) + moonCol[0] * moonI,
        sunCol[1] * sunI * dayW + duskCol[1] * sunI * duskW * (1 - dayW) + moonCol[1] * moonI,
        sunCol[2] * sunI * dayW + duskCol[2] * sunI * duskW * (1 - dayW) + moonCol[2] * moonI,
      ];
      // Ensure minimum fill so night isn't pitch-black mesh
      lightCol = [
        Math.max(lightCol[0], 0.08 + nightW * 0.12),
        Math.max(lightCol[1], 0.09 + nightW * 0.14),
        Math.max(lightCol[2], 0.14 + nightW * 0.2),
      ];
      const amb = 0.16 * dayW + 0.14 * duskW + 0.10 * nightW + 0.07;

      const ubo = new Float32Array(60);
      ubo.set(mvp, 0);
      // sun_dir stored so L = normalize(-sun_dir) points toward the light
      ubo[16] = -lightTo[0]; ubo[17] = -lightTo[1]; ubo[18] = -lightTo[2];
      ubo[19] = now * 0.001;
      ubo[20] = eye[0]; ubo[21] = eye[1]; ubo[22] = eye[2];
      ubo[23] = player.sprinting ? 0.92 : (player.moving ? 0.82 : 0.72);
      ubo[24] = player.x; ubo[25] = player.feetY; ubo[26] = player.z; ubo[27] = 1.0;
      for (let i = 0; i < 4; i++) {
        const tr = trailPts[i];
        const o = 28 + i * 4;
        ubo[o] = tr.x; ubo[o + 1] = tr.z; ubo[o + 2] = tr.w; ubo[o + 3] = 0;
      }
      ubo[44] = lightCol[0]; ubo[45] = lightCol[1]; ubo[46] = lightCol[2];
      ubo[47] = tod;
      ubo[48] = -moonTo[0]; ubo[49] = -moonTo[1]; ubo[50] = -moonTo[2];
      ubo[51] = amb;
      writeTreeFallUbo(ubo);
      device.queue.writeBuffer(frameBuf, 0, ubo);
      // stash for sky pass + VRM light sync
      _celestial = { tod, sunTo, moonTo, dayW, nightW, duskW, lightCol, amb };

      // Cascaded shadow maps — 3 ortho frusta along view
      const aspect = size.w / Math.max(1, size.h);
      const fov = ((48 + (sprintFovBlend || 0) * 5.5) * Math.PI) / 180;
      const split0 = 16, split1 = 48, split2 = 140;
      const c0 = fitLightCascade(cascadeCorners(eye, target, NEAR, split0, fov, aspect), lightTo);
      const c1 = fitLightCascade(cascadeCorners(eye, target, split0 * 0.9, split1, fov, aspect), lightTo);
      const c2 = fitLightCascade(cascadeCorners(eye, target, split1 * 0.9, split2, fov, aspect), lightTo);
      const shadowU = new Float32Array(64);
      shadowU.set(c0, 0);
      shadowU.set(c1, 16);
      shadowU.set(c2, 32);
      shadowU[48] = split0; shadowU[49] = split1; shadowU[50] = split2; shadowU[51] = 0;
      const sunH = Math.max(0, lightTo[1]);
      const shStr = Math.min(1, sunH * 2.0) * (0.36 + 0.58 * dayW + 0.4 * nightW);
      shadowU[52] = 0.0018; // bias
      shadowU[53] = shStr;  // strength
      shadowU[54] = 0; shadowU[55] = 0;
      device.queue.writeBuffer(shadowBuf, 0, shadowU);
      _shadowCascades = [c0, c1, c2];

      // Cinematic DoF (FE-style autofocus on character)
      const focalLen = camMode === "fpv" ? 14 : camMode === "orbit" ? 40 : 22;
      const underAmt = Math.max(0, Math.min(1, (SEA_Y + 0.12 - eye[1]) / 2.2));
      const exposure = 0.58 * (0.5 + 0.3 * _celestial.dayW + 0.22 * _celestial.duskW + 0.2 * _celestial.nightW);
      const bokeh = camMode === "fpv" ? 0.08 : 0.22; // subtle DoF
      const postU = new Float32Array([
        focusDist, focalLen, bokeh,
        exposure,
        camMode === "fpv" ? 1 : 0,
        NEAR, FAR, underAmt,
        taaReady ? 0.55 : 0.0, 0, 0, 0,
      ]);
      device.queue.writeBuffer(postParamBuf, 0, postU);

      // Upload VRM atlas before encoding passes that sample it
      // Skip while gate/paused — avoids avatar silhouette bleeding under boot UI
      try {
        if (controlsEnabled && !paused) {
          const src = getAvatarAtlas && getAvatarAtlas();
          if (src && src.canvas && src.width === size.w && src.height === size.h) {
            device.queue.copyExternalImageToTexture(
              { source: src.canvas, flipY: false },
              { texture: avatarAtlas },
              [size.w, size.h * 2]
            );
          }
        }
      } catch (_) {}

      const encoder = device.createCommandEncoder();
      const binds = frameBinds();
      {
        const sp = new Float32Array([
          now * 0.001, OCEAN_PATCH0, OCEAN_PATCH1, 1.15,
          player.x, player.z, 0.92, SEA_Y,
        ]);
        device.queue.writeBuffer(oceanSimParamsBuf, 0, sp);
        device.queue.writeBuffer(oceanDrawParamsBuf, 0, new Float32Array([OCEAN_PATCH0, OCEAN_PATCH1, SEA_Y, 1.15]));
        const cpass = encoder.beginComputePass();
        cpass.setPipeline(oceanSimPipe);
        cpass.setBindGroup(0, oceanSimBinds[foamFlip]);
        cpass.dispatchWorkgroups(OCEAN_SIM_RES / 8, OCEAN_SIM_RES / 8);
        cpass.end();
        foamFlip = 1 - foamFlip;
      }

      if (grassReady && (grassCullFrame++ % GRASS_CULL_INTERVAL) === 0) {
        const cullU = new ArrayBuffer(96);
        const cdv = new DataView(cullU);
        cdv.setFloat32(0, eye[0], true);
        cdv.setFloat32(4, eye[1], true);
        cdv.setFloat32(8, eye[2], true);
        cdv.setUint32(12, BLADE_COUNT, true);
        for (let i = 0; i < 16; i++) cdv.setFloat32(16 + i * 4, mvp[i], true);
        cdv.setFloat32(80, GRASS_LOD0, true);
        cdv.setFloat32(84, GRASS_LOD1, true); // 15seg <36m, 5seg <80m, 2seg thinned to GRASS_FAR
        cdv.setFloat32(88, GRASS_FAR, true);
        device.queue.writeBuffer(cullBuf, 0, cullU);
        // Reset indirect counts on CPU — avoids clear compute sharing writable binds with blades
        device.queue.writeBuffer(drawsStorageBuf, 0, drawsClear);

        const cp = encoder.beginComputePass();
        cp.setPipeline(cullPipe);
        cp.setBindGroup(0, cullReadBind);
        cp.setBindGroup(1, cullWriteBind);
        cp.dispatchWorkgroups(Math.ceil(BLADE_COUNT / 256));
        cp.end();
        // STORAGE → INDIRECT copy (separate usages, no dual-bind hazard)
        encoder.copyBufferToBuffer(drawsStorageBuf, 0, drawsIndirectBuf, 0, 48);
      }

      // Cascaded shadow depth passes (terrain + trees)
      if (_shadowCascades && terrainVbo && shStr > 0.02) {
        for (let ci = 0; ci < 3; ci++) {
          const lightVP = _shadowCascades[ci];
          // Temporarily bind light VP as frame.view_proj for casters
          device.queue.writeBuffer(frameBuf, 0, lightVP);
          const sp = encoder.beginRenderPass({
            colorAttachments: [],
            depthStencilAttachment: {
              view: shadowCascadeViews[ci],
              depthClearValue: 1,
              depthLoadOp: "clear",
              depthStoreOp: "store",
            },
          });
          sp.setBindGroup(0, shadowCastBind);
          if (terrainVbo && terrainIbo) {
            sp.setPipeline(shadowTerrainPipe);
            sp.setVertexBuffer(0, terrainVbo);
            sp.setIndexBuffer(terrainIbo, "uint32");
            sp.drawIndexed(terrainIndexCount);
          }
          // Grass CSM casting disabled — flooded near cascades (black+blue look, ~16 FPS)
          if (treeVbo && treeDrawRanges.length > 0) {
            sp.setPipeline(shadowTreePipe);
            sp.setVertexBuffer(0, treeVbo);
            const maxD2 = TREE_SHADOW * TREE_SHADOW;
            for (let ti = 0; ti < treeDrawRanges.length; ti++) {
              const tr = treeDrawRanges[ti];
              const dx = tr.x - player.x;
              const dz = tr.z - player.z;
              if (dx * dx + dz * dz > maxD2) continue;
              if (tr.count > 0) sp.draw(tr.count, 1, tr.start);
            }
          }
          if (rockVbo && rockDrawRanges.length > 0) {
            sp.setPipeline(shadowRockPipe);
            sp.setVertexBuffer(0, rockVbo);
            const maxD2 = PROP_FAR * PROP_FAR;
            for (let ri = 0; ri < rockDrawRanges.length; ri++) {
              const rr = rockDrawRanges[ri];
              const dx = rr.x - player.x;
              const dz = rr.z - player.z;
              if (dx * dx + dz * dz > maxD2) continue;
              if (rr.count > 0) sp.draw(rr.count, 1, rr.start);
            }
          }
          if (buildVbo && buildVertCount) {
            sp.setPipeline(shadowBuildPipe);
            sp.setVertexBuffer(0, buildVbo);
            sp.draw(buildVertCount);
          }
          sp.end();
        }
        // Restore camera view_proj (full frame UBO)
        device.queue.writeBuffer(frameBuf, 0, ubo);
      }

      // Procedural sky + horizon clear
      {
        const skyU = new Float32Array(28);
        const inv = mat4Invert(mvp);
        skyU.set(inv, 0);
        skyU[16] = eye[0]; skyU[17] = eye[1]; skyU[18] = eye[2];
        skyU[19] = _celestial.tod;
        skyU[20] = _celestial.sunTo[0]; skyU[21] = _celestial.sunTo[1]; skyU[22] = _celestial.sunTo[2];
        skyU[23] = now * 0.001;
        skyU[24] = _celestial.moonTo[0]; skyU[25] = _celestial.moonTo[1]; skyU[26] = _celestial.moonTo[2];
        skyU[27] = 0.85; // cloud coverage
        device.queue.writeBuffer(skyParamBuf, 0, skyU);
      }
      const clearSky = _celestial.nightW > 0.6
        ? { r: 0.02, g: 0.03, b: 0.06, a: 1 }
        : (_celestial.duskW > 0.45
          ? { r: 0.55, g: 0.32, b: 0.22, a: 1 }
          : { r: 0.45, g: 0.62, b: 0.88, a: 1 });
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: sceneView,
          clearValue: clearSky,
          loadOp: "clear", storeOp: "store",
        }],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setPipeline(skyPipe);
      pass.setBindGroup(0, skyBindGroup);
      pass.draw(3);
      pass.setBindGroup(0, frameBind);
      pass.setPipeline(starPipe);
      pass.setVertexBuffer(0, starVbo);
      pass.draw(STAR_N);
      if (terrainVbo && terrainIbo) {
        pass.setPipeline(terrainPipe);
        pass.setVertexBuffer(0, terrainVbo);
        pass.setIndexBuffer(terrainIbo, "uint32");
        pass.drawIndexed(terrainIndexCount);
      }
      // Seafloor caustics + Water Pro–style cascaded ocean
      pass.setPipeline(floorPipe);
      pass.setBindGroup(0, frameBind);
      pass.setVertexBuffer(0, floorVbo);
      pass.setIndexBuffer(floorIbo, "uint32");
      pass.drawIndexed(floorIndexCount);
      pass.setPipeline(oceanPipe);
      pass.setBindGroup(0, frameBind);
      pass.setBindGroup(1, oceanDrawBinds[foamFlip]);
      pass.setVertexBuffer(0, oceanVbo);
      pass.setIndexBuffer(oceanIbo, "uint32");
      pass.drawIndexed(oceanIndexCount);
      if (grassReady) {
        pass.setPipeline(grassPipe15);
        pass.setBindGroup(1, grassBind0);
        pass.drawIndirect(drawsIndirectBuf, 0);
        pass.setPipeline(grassPipe5);
        pass.setBindGroup(1, grassBind1);
        pass.drawIndirect(drawsIndirectBuf, 16);
        pass.setPipeline(grassPipe2);
        pass.setBindGroup(1, grassBind2);
        pass.drawIndirect(drawsIndirectBuf, 32);
      }
      if (treeVbo && treeDrawRanges.length) {
        pass.setPipeline(treePipe);
        pass.setBindGroup(0, frameBind);
        pass.setVertexBuffer(0, treeVbo);
        const maxD2 = TREE_DRAW * TREE_DRAW;
        for (let ti = 0; ti < treeDrawRanges.length; ti++) {
          const tr = treeDrawRanges[ti];
          const dx = tr.x - player.x;
          const dz = tr.z - player.z;
          if (dx * dx + dz * dz > maxD2) continue;
          if (tr.count > 0) pass.draw(tr.count, 1, tr.start);
        }
      }
      if (rockVbo && rockDrawRanges.length) {
        pass.setPipeline(rockPipe);
        pass.setBindGroup(0, frameBind);
        pass.setVertexBuffer(0, rockVbo);
        const maxD2 = PROP_FAR * PROP_FAR;
        for (let ri = 0; ri < rockDrawRanges.length; ri++) {
          const rr = rockDrawRanges[ri];
          const dx = rr.x - player.x;
          const dz = rr.z - player.z;
          if (dx * dx + dz * dz > maxD2) continue;
          if (rr.count > 0) pass.draw(rr.count, 1, rr.start);
        }
      }
      if (buildVbo && buildVertCount) {
        pass.setPipeline(buildPipe);
        pass.setBindGroup(0, frameBind);
        pass.setVertexBuffer(0, buildVbo);
        pass.draw(buildVertCount);
      }
      if (ghostVbo && ghostVertCount && (buildMode || deployMode)) {
        pass.setPipeline(ghostPipe);
        pass.setBindGroup(0, frameBind);
        pass.setVertexBuffer(0, ghostVbo);
        pass.draw(ghostVertCount);
      }
      if (fxVbo && fxVertCount) {
        pass.setPipeline(fxPipe);
        pass.setBindGroup(0, frameBind);
        pass.setVertexBuffer(0, fxVbo);
        pass.draw(fxVertCount);
      }
      if (beamVbo && beamVertCount) {
        pass.setPipeline(beamPipe);
        pass.setVertexBuffer(0, beamVbo);
        pass.draw(beamVertCount);
      }
      if (roseVbo && roseVertCount) {
        pass.setPipeline(rosePipe);
        pass.setVertexBuffer(0, roseVbo);
        pass.draw(roseVertCount);
      }
      if (birdVbo && birdVertCount) {
        pass.setPipeline(birdPipe);
        pass.setBindGroup(0, frameBind);
        pass.setVertexBuffer(0, birdVbo);
        pass.draw(birdVertCount);
      }
      pass.end();

      // Bloom — 2 blur pairs for richer glow without FE milk haze
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{ view: bloomAView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(brightPipe);
        p.setBindGroup(0, binds.scene);
        p.draw(3);
        p.end();
      }
      for (let blurPass = 0; blurPass < BLOOM_BLUR_PASSES; blurPass++) {
        let p = encoder.beginRenderPass({
          colorAttachments: [{ view: bloomBView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(blurHPipe);
        p.setBindGroup(0, binds.bloomA);
        p.draw(3);
        p.end();
        p = encoder.beginRenderPass({
          colorAttachments: [{ view: bloomAView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(blurVPipe);
        p.setBindGroup(0, binds.bloomB);
        p.draw(3);
        p.end();
      }
      // Subtle DoF soft buffer (CoC in alpha)
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{ view: dofView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(dofPipe);
        p.setBindGroup(0, binds.scene);
        p.draw(3);
        p.end();
      }
      // Composite: sharp + soft DoF + bloom + FXAA (TAA disabled — caused red/black ghosts)
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{
            view: compView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear", storeOp: "store",
          }],
        });
        p.setPipeline(compPipe);
        p.setBindGroup(0, binds.composite);
        p.draw(3);
        p.end();
      }

      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear", storeOp: "store",
          }],
        });
        p.setPipeline(mergePipe);
        p.setBindGroup(0, binds.merge);
        p.draw(3);
        p.end();
      }

      device.queue.submit([encoder.finish()]);
      raf = requestAnimationFrame(frame);
    }

    function loop() {
      raf = requestAnimationFrame(frame);
    }

    function destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", captureControlCrouch, true);
      window.removeEventListener("keyup", captureControlCrouch, true);
      window.removeEventListener("keydown", blockBrowserChrome, true);
      document.removeEventListener("keydown", blockBrowserChrome, true);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("resize", onResize);
      try { setMapOpen(false); } catch (_) {}
      try { compassEl.remove(); } catch (_) {}
      try { mapDlg.remove(); } catch (_) {}
      try { audio.bgm && audio.bgm.src.stop(); } catch (_) {}
      try { audio.noise && audio.noise.src.stop(); } catch (_) {}
      try { audio.ocean && audio.ocean.src.stop(); } catch (_) {}
      try { audio.ctx && audio.ctx.close(); } catch (_) {}
      try { depth && depth.destroy(); } catch (_) {}
      try { sceneColor && sceneColor.destroy(); } catch (_) {}
      try { bloomA && bloomA.destroy(); } catch (_) {}
      try { bloomB && bloomB.destroy(); } catch (_) {}
      try { dofTex && dofTex.destroy(); } catch (_) {}
      try { compTex && compTex.destroy(); } catch (_) {}
      try { taaTex && taaTex.destroy(); } catch (_) {}
      try { historyTex && historyTex.destroy(); } catch (_) {}
      try { avatarAtlas && avatarAtlas.destroy(); } catch (_) {}
      try { envTex && envTex.destroy(); } catch (_) {}
      try { shadowMap && shadowMap.destroy(); } catch (_) {}
      try { shadowDummy && shadowDummy.destroy(); } catch (_) {}
      try { buildVbo && buildVbo.destroy(); } catch (_) {}
      try { ghostVbo && ghostVbo.destroy(); } catch (_) {}
      try { birdVbo && birdVbo.destroy(); } catch (_) {}
      try { roseVbo && roseVbo.destroy(); } catch (_) {}
      try {
        const a = document.getElementById("fw-build-radial");
        if (a) a.remove();
        const b = document.getElementById("fw-build-stab");
        if (b) b.remove();
        const c = document.getElementById("fw-tc-panel");
        if (c) c.remove();
        if (peerOverlayRoot) peerOverlayRoot.remove();
        peerOverlayRoot = null;
        peerOverlayById.clear();
      } catch (_) {}
      try { delete window.__fwBuildAAA; } catch (_) {}
    }

    try {
      if (window.__fw) {
        window.__fw.playUi = playUiSfx;
        window.__fw.getVitals = () => vitals;
      }
    } catch (_) {}

    return {
      boot, destroy, setCameraMode, rebake, getPose, getFeetPose,
      setControlsEnabled, setPaused, calibrate,
      unlockAudio, setSoundOn, toggleSound,
      setAvatarAtlasSource, toggleMap, setMapOpen,
      setBuildMode, setHeldItem, tryHarvestAimed, tryToggleNearbyDoor,
      openWorkbenchUI, openResearchUI, tryUseAimed,
      getVitals: () => vitals,
      playUiSfx,
      killPlayer,
      /** Project world meters → stage CSS px (null if behind camera). */
      projectWorld: projectWorldToStage,
      setPeerOverlays,
      applyRemotePlace,
      applyRemoteRemove,
      applyRemoteHp,
      applyWorldSnapshot,
    };
  }

  window.FalseWorldGpu = { create };