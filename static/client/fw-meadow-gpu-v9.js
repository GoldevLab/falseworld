/**
 * False World — browser WebGPU meadow (v6: FE loading gate + controls lock).
 * Inspiration: False Earth (Ming-Jyun Hung). Original WGSL + JS; no Three/R3F.
 */
(function () {
  const WGSL = /* wgsl */ `
struct Frame {
  view_proj : mat4x4f,
  sun_dir : vec3f,
  time : f32,
  eye : vec3f,
  _pad0 : f32,
  player : vec3f,
  push_r : f32,
};
@group(0) @binding(0) var<uniform> frame : Frame;

struct TerrainIn {
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
};
struct TerrainOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
};

@vertex fn vs_terrain(input : TerrainIn) -> TerrainOut {
  var o : TerrainOut;
  o.clip = frame.view_proj * vec4f(input.pos, 1.0);
  o.world = input.pos;
  o.nrm = input.nrm;
  return o;
}

@fragment fn fs_terrain(input : TerrainOut) -> @location(0) vec4f {
  // False Earth terrain is flat black under dense grass
  let n = normalize(input.nrm);
  let L = normalize(-frame.sun_dir);
  let ndl = max(dot(n, L), 0.0);
  var col = vec3f(0.08, 0.12, 0.07);
  col *= 0.7 + ndl * 0.55;
  return vec4f(col, 1.0);
}

struct Blade {
  @location(0) data0 : vec4f,
  @location(1) data1 : vec4f,
  @location(2) data2 : vec4f,
  @location(3) data3 : vec4f,
};
struct GrassOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) color : vec3f,
  @location(2) nrm : vec3f,
  @location(3) height_t : f32,
  @location(4) side_uv : f32,
  @location(5) side_dir : vec3f,
};

fn bezier3(a : vec3f, b : vec3f, c : vec3f, d : vec3f, t : f32) -> vec3f {
  let u = 1.0 - t;
  return a*u*u*u + b*3.0*u*u*t + c*3.0*u*t*t + d*t*t*t;
}

fn bezier3_tangent(a : vec3f, b : vec3f, c : vec3f, d : vec3f, t : f32) -> vec3f {
  let u = 1.0 - t;
  let tang = (b - a) * (3.0 * u * u) + (c - b) * (6.0 * u * t) + (d - c) * (3.0 * t * t);
  let len = length(tang);
  if (len < 1e-5) {
    return vec3f(0.0, 1.0, 0.0);
  }
  return tang / len;
}

fn rotate_y(v : vec3f, rot_s : f32, rot_c : f32) -> vec3f {
  return vec3f(v.x * rot_c - v.z * rot_s, v.y, v.x * rot_s + v.z * rot_c);
}

fn align_to_terrain(v : vec3f, terrain_n : vec3f) -> vec3f {
  let up = vec3f(0.0, 1.0, 0.0);
  let align = normalize(mix(up, terrain_n, 0.65));
  let axis = cross(up, align);
  let axis_len = length(axis);
  if (axis_len < 1e-4) {
    return v;
  }
  let a = axis / axis_len;
  let ang = acos(clamp(dot(up, align), -1.0, 1.0));
  let ca = cos(ang);
  let sa = sin(ang);
  return v * ca + cross(a, v) * sa + a * dot(a, v) * (1.0 - ca);
}

@vertex fn vs_grass(
  @builtin(vertex_index) vid : u32,
  blade : Blade,
) -> GrassOut {
  let pos = blade.data0.xyz;
  let blade_type = floor(blade.data0.w + 0.01);
  let width = blade.data1.x;
  let height = blade.data1.y;
  let bend = blade.data1.z;
  let wind_str = blade.data1.w;
  let rot_s = blade.data2.x;
  let rot_c = blade.data2.y;
  let clump = blade.data2.z;
  let seed = blade.data2.w;
  let tn_x = blade.data3.x;
  let tn_z = blade.data3.y;
  let tn_y = sqrt(max(0.0, 1.0 - tn_x * tn_x - tn_z * tn_z));
  let terrain_n = normalize(vec3f(tn_x, tn_y, tn_z));

  // 15 segments (False Earth near LOD)
  let side = f32(vid % 2u) * 2.0 - 1.0;
  let t = f32(vid / 2u) / 15.0;

  // Cubic Bezier control points by blade type
  var p1 = vec3f(0.0, height * 0.4, bend * 0.5);
  var p2 = vec3f(0.0, height * 0.75, bend * 0.7);
  if (blade_type > 0.5 && blade_type < 1.5) {
    p1 = vec3f(0.0, height * 0.35, bend * 0.6);
    p2 = vec3f(0.0, height * 0.7, bend * 0.8);
  } else if (blade_type > 1.5) {
    p1 = vec3f(0.0, height * 0.3, bend * 0.7);
    p2 = vec3f(0.0, height * 0.65, bend * 1.0);
  }
  let p0 = vec3f(0.0, 0.0, 0.0);
  var p3 = vec3f(0.0, height, 0.0);

  // Wind push along field direction
  let wind_dir = normalize(vec3f(0.85, 0.0, 0.25));
  let ws = wind_str * 0.55;
  p1 = p1 + wind_dir * (ws * height * 0.08);
  p2 = p2 + wind_dir * (ws * height * 0.15);
  p3 = p3 + wind_dir * (ws * height * 0.25);

  // Dual-frequency sway
  let gust = 0.65 + 0.35 * sin(frame.time * 0.35 + seed * 6.28318);
  let phase = seed * 6.28318 + dot(pos.xz, wind_dir.xz) * 0.15;
  let freq = mix(0.4, 1.5, seed);
  let low = sin(frame.time * freq + phase + t * 2.2);
  let high = sin(frame.time * freq * 5.0 + phase * 1.7 + t * 5.0);
  let amp = height * wind_str * 0.35;
  let cw = normalize(vec3f(-wind_dir.z, 0.0, wind_dir.x));
  let sway_dir = normalize(wind_dir + cw * (high * 0.35));
  let sway = sway_dir * (low * amp * gust * mix(0.25, 1.0, t * t) + high * amp * 0.25 * t);

  let spine = bezier3(p0, p1, p2, p3, t) + sway;
  let tangent = bezier3_tangent(p0, p1, p2, p3, t);

  // Width: (t + baseWidth) * pow(1-t, tipThin)
  let width_factor = (t + 0.35) * pow(max(1.0 - t, 0.0), 0.9);
  let half_w = width * 0.5 * width_factor;

  var side_local = normalize(cross(vec3f(0.0, 0.0, 1.0), tangent));
  if (length(side_local) < 1e-4) {
    side_local = vec3f(1.0, 0.0, 0.0);
  }
  var lpos = spine + side_local * (half_w * side);

  // Character push + flatten
  let to_blade = pos.xz - frame.player.xz;
  let pdist = length(to_blade);
  if (pdist < frame.push_r && pdist > 1e-4) {
    let fall = 1.0 - pdist / frame.push_r;
    let pdir = normalize(to_blade);
    let push_len = fall * fall * 0.55;
    lpos = vec3f(
      lpos.x + pdir.x * push_len * (t * t),
      lpos.y * (1.0 - push_len * 0.35 * t),
      lpos.z + pdir.y * push_len * (t * t)
    );
  }

  var lpos_r = rotate_y(lpos, rot_s, rot_c);
  lpos_r = align_to_terrain(lpos_r, terrain_n);

  var side_w = rotate_y(side_local, rot_s, rot_c);
  side_w = align_to_terrain(side_w, terrain_n);
  side_w = normalize(side_w);

  var world = pos + lpos_r;

  // View-dependent thickness (fake tube)
  let to_eye = normalize(frame.eye - world);
  let edge = max(1.0 - abs(dot(to_eye, side_w)), 0.0);
  let thick = cross(to_eye, side_w);
  let thick_len = length(thick);
  if (thick_len > 1e-5) {
    world = world + (thick / thick_len) * (0.012 * edge);
  }

  var nrm = normalize(cross(side_w, rotate_y(tangent, rot_s, rot_c)));
  nrm = normalize(nrm + side_w * (side * 0.35));

  // Readable night grass (FE was pure-black base — looked "broken")
  let base_col = vec3f(0.05, 0.12, 0.06);
  let tip_col = vec3f(0.35, 0.55, 0.42);
  var col = mix(base_col, tip_col, pow(t, 1.4));
  col *= mix(0.9, 1.15, clump) * mix(0.95, 1.08, seed);
  col *= mix(0.55, 1.0, pow(t, 2.2));

  var o : GrassOut;
  o.world = world;
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.color = col;
  o.nrm = nrm;
  o.height_t = t;
  o.side_uv = side * 0.5 + 0.5;
  o.side_dir = side_w;
  return o;
}

@fragment fn fs_grass(input : GrassOut) -> @location(0) vec4f {
  var n = normalize(input.nrm);
  // Midrib + rim normal shaping
  let u = input.side_uv - 0.5;
  let au = abs(u);
  let mid01 = smoothstep(-0.25, 0.25, u);
  let rim_mask = smoothstep(0.42, 0.45, au);
  let v01 = mix(mid01, 1.0 - mid01, rim_mask);
  let ny = v01 * 2.0 - 1.0;
  n = normalize(n + normalize(input.side_dir) * ny * 0.35);

  let L = normalize(-frame.sun_dir);
  let V = normalize(frame.eye - input.world);
  let ndl = max(dot(n, L), 0.15);
  let h = normalize(L + V);
  // metalness ~0.5, roughness ~0.35 (shinier tips)
  let rough = mix(0.55, 0.25, input.height_t);
  let spec_pow = mix(24.0, 96.0, 1.0 - rough);
  let spec = pow(max(dot(n, h), 0.0), spec_pow) * (0.35 + 0.55 * input.height_t);

  let R = reflect(-V, n);
  let sky = mix(vec3f(0.10, 0.14, 0.18), vec3f(0.45, 0.55, 0.75), max(R.y, 0.0));
  let env = sky * (0.45 + 0.55 * input.height_t);

  let shade = 0.55 + ndl * 1.05;
  var rgb = input.color * shade
    + vec3f(spec) * vec3f(0.7, 0.85, 1.0)
    + env * input.color
    + input.color * pow(input.height_t, 3.0) * 0.22;
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(2.2)), 1.0);
}

struct StarIn {
  @location(0) dir : vec3f,
  @location(1) bright : f32,
};
struct StarOut {
  @builtin(position) clip : vec4f,
  @location(0) bright : f32,
};
@vertex fn vs_star(input : StarIn) -> StarOut {
  var o : StarOut;
  let far = frame.eye + normalize(input.dir) * 80.0;
  o.clip = frame.view_proj * vec4f(far, 1.0);
  o.clip.z = o.clip.w * 0.999;
  o.bright = input.bright;
  return o;
}
@fragment fn fs_star(input : StarOut) -> @location(0) vec4f {
  return vec4f(vec3f(0.9, 0.95, 1.0) * input.bright, 1.0);
}
`;

  function mat4Id() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function mat4Mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      const ai0 = a[i],
        ai1 = a[i + 4],
        ai2 = a[i + 8],
        ai3 = a[i + 12];
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
  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0],
      zy = eye[1] - center[1],
      zz = eye[2] - center[2];
    let zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl;
    zy /= zl;
    zz /= zl;
    let xx = up[1] * zz - up[2] * zy,
      xy = up[2] * zx - up[0] * zz,
      xz = up[0] * zy - up[1] * zx;
    let xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl;
    xy /= xl;
    xz /= xl;
    const yx = zy * xz - zz * xy,
      yy = zz * xx - zx * xz,
      yz = zx * xy - zy * xx;
    const o = mat4Id();
    o[0] = xx;
    o[1] = yx;
    o[2] = zx;
    o[4] = xy;
    o[5] = yy;
    o[6] = zy;
    o[8] = xz;
    o[9] = yz;
    o[10] = zz;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    return o;
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
    const u32 = () => {
      const v = dv.getUint32(i, true);
      i += 4;
      return v;
    };
    const f32 = () => {
      const v = dv.getFloat32(i, true);
      i += 4;
      return v;
    };
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
    blades.set(new Float32Array(bytes.buffer, bytes.byteOffset + i, n_b * 16));
    return {
      seed,
      origin_x,
      origin_z,
      area,
      terrain: { amplitude: amp, frequency: freq, seed: tseed },
      height_res,
      heights,
      blades,
      bladeCount: n_b,
    };
  }

  function sampleHeight(chunk, wx, wz) {
    const res = chunk.height_res;
    if (res < 2) return 0;
    const u = Math.min(1 - 1e-5, Math.max(0, (wx - chunk.origin_x) / chunk.area + 0.5));
    const v = Math.min(1 - 1e-5, Math.max(0, (wz - chunk.origin_z) / chunk.area + 0.5));
    const fx = u * (res - 1);
    const fz = v * (res - 1);
    const x0 = fx | 0;
    const z0 = fz | 0;
    const x1 = Math.min(res - 1, x0 + 1);
    const z1 = Math.min(res - 1, z0 + 1);
    const tx = fx - x0;
    const tz = fz - z0;
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
        const u = x / (res - 1);
        const v = z / (res - 1);
        const wx = chunk.origin_x + (u - 0.5) * chunk.area;
        const wz = chunk.origin_z + (v - 0.5) * chunk.area;
        const wy = chunk.heights[z * res + x];
        const step = chunk.area / (res - 1);
        const hx0 = sampleHeight(chunk, wx - step, wz);
        const hx1 = sampleHeight(chunk, wx + step, wz);
        const hz0 = sampleHeight(chunk, wx, wz - step);
        const hz1 = sampleHeight(chunk, wx, wz + step);
        let nx = hx0 - hx1;
        let ny = 2 * step;
        let nz = hz0 - hz1;
        const nl = Math.hypot(nx, ny, nz) || 1;
        verts[vi++] = wx;
        verts[vi++] = wy;
        verts[vi++] = wz;
        verts[vi++] = nx / nl;
        verts[vi++] = ny / nl;
        verts[vi++] = nz / nl;
      }
    }
    let ii = 0;
    for (let z = 0; z < res - 1; z++) {
      for (let x = 0; x < res - 1; x++) {
        const a = z * res + x;
        const b = a + 1;
        const c = a + res;
        const d = c + 1;
        indices[ii++] = a;
        indices[ii++] = c;
        indices[ii++] = b;
        indices[ii++] = b;
        indices[ii++] = c;
        indices[ii++] = d;
      }
    }
    return { verts, indices };
  }

  function snapOrigin(x, z, area, bladesAxis) {
    const cell = area / Math.max(1, bladesAxis);
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    return [cx * cell, cz * cell];
  }

  async function create(canvas, opts) {
    opts = opts || {};
    const onHud = opts.onHud || (() => {});
    const loadChunk = opts.loadChunk;
    if (!navigator.gpu) throw new Error("WebGPU no disponible");

    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("Sin adapter WebGPU");
    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();

    function configure() {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(rect.width || canvas.clientWidth || 1, 640);
      const cssH = Math.max(rect.height || canvas.clientHeight || 1, 480);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      context.configure({
        device,
        format,
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      return { w, h };
    }
    let size = configure();

    const depthTex = () => {
      const tex = device.createTexture({
        size: [size.w, size.h],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
      return tex;
    };
    let depth = depthTex();

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        const next = configure();
        if (next.w !== size.w || next.h !== size.h) {
          size = next;
          try {
            depth.destroy();
          } catch (_) {}
          depth = depthTex();
        }
      });
      ro.observe(canvas.parentElement || canvas);
    }

    const module = device.createShaderModule({ code: WGSL });
    const frameBuf = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: frameBuf } }],
    });

    const terrainPipe = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_terrain",
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32x3" },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fs_terrain",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    const grassPipe = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_grass",
        buffers: [
          {
            arrayStride: 64,
            stepMode: "instance",
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x4" },
              { shaderLocation: 1, offset: 16, format: "float32x4" },
              { shaderLocation: 2, offset: 32, format: "float32x4" },
              { shaderLocation: 3, offset: 48, format: "float32x4" },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fs_grass",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-strip", cullMode: "none" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    // Procedural starfield (False Earth night sky feel)
    const STAR_N = 2500;
    const starData = new Float32Array(STAR_N * 4);
    for (let i = 0; i < STAR_N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      starData[i * 4] = Math.sin(v) * Math.cos(u);
      starData[i * 4 + 1] = Math.cos(v);
      starData[i * 4 + 2] = Math.sin(v) * Math.sin(u);
      starData[i * 4 + 3] = 0.25 + Math.random() * 0.75;
    }
    const starVbo = device.createBuffer({
      size: starData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(starVbo.getMappedRange()).set(starData);
    starVbo.unmap();
    const starPipe = device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module,
        entryPoint: "vs_star",
        buffers: [
          {
            arrayStride: 16,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32" },
            ],
          },
        ],
      },
      fragment: {
        module,
        entryPoint: "fs_star",
        targets: [{ format }],
      },
      primitive: { topology: "point-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less",
      },
    });

    let terrainVbo = null;
    let terrainIbo = null;
    let terrainIndexCount = 0;
    let grassVbo = null;
    let grassCount = 0;
    let chunk = null;
    let baking = false;

    const player = { x: 0, y: 1.55, feetY: 0, z: 0, yaw: 0, moving: false };
    let camMode = "follow";
    const keys = Object.create(null);
    let orbitYaw = 0.4;
    let orbitPitch = 0.35;
    let orbitDist = 18;
    let dragging = false;
    let lastMx = 0,
      lastMy = 0;
    let alive = true;
    let raf = 0;
    let t0 = performance.now();
    let lastEye = [0, 2, 8];
    let lastTarget = [0, 1, 0];
    let controlsEnabled = false;
    let paused = false;

    function uploadChunk(meta) {
      const bytes = b64ToBytes(meta.fwch_b64);
      chunk = decodeFwch(bytes);
      const mesh = buildTerrainMesh(chunk);
      if (terrainVbo) terrainVbo.destroy();
      if (terrainIbo) terrainIbo.destroy();
      if (grassVbo) grassVbo.destroy();
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

      grassVbo = device.createBuffer({
        size: chunk.blades.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(grassVbo.getMappedRange()).set(chunk.blades);
      grassVbo.unmap();
      grassCount = chunk.bladeCount;
      player.feetY = sampleHeight(chunk, player.x, player.z);
      player.y = player.feetY + 1.55;
      onHud({ blades: grassCount, status: "Listo · " + grassCount + " blades" });
    }

    async function bakeAt(ox, oz) {
      if (!loadChunk || baking) return;
      baking = true;
      try {
        onHud({ status: "Worker · pradera…" });
        const meta = await loadChunk(ox, oz);
        if (meta && meta.fwch_b64) uploadChunk(meta);
      } catch (e) {
        onHud({ status: "Error bake: " + (e && e.message ? e.message : e) });
      } finally {
        baking = false;
      }
    }

    async function boot() {
      await bakeAt(0, 0);
      loop();
    }

    /** Warm GPU pipelines behind the loading overlay (False Earth “CALIBRATING”). */
    async function calibrate(frames) {
      const n = Math.max(1, frames | 0);
      for (let i = 0; i < n; i++) {
        await new Promise((r) => requestAnimationFrame(r));
      }
    }

    function setControlsEnabled(on) {
      controlsEnabled = !!on;
      if (!controlsEnabled) {
        for (const k of Object.keys(keys)) keys[k] = false;
        player.moving = false;
        dragging = false;
      } else {
        try {
          canvas.focus();
        } catch (_) {}
      }
    }

    function setCameraMode(m) {
      camMode = m === "fpv" || m === "orbit" ? m : "follow";
    }

    function rebake() {
      if (!chunk) {
        bakeAt(0, 0);
        return;
      }
      const [ox, oz] = snapOrigin(player.x, player.z, chunk.area, 192);
      bakeAt(ox, oz);
    }

    function onKey(e, down) {
      if (!controlsEnabled) {
        if (!down) keys[e.code] = false;
        return;
      }
      keys[e.code] = down;
      if (down && (e.code === "KeyC" || e.key === "c")) {
        const order = ["follow", "fpv", "orbit"];
        setCameraMode(order[(order.indexOf(camMode) + 1) % 3]);
      }
    }
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    canvas.addEventListener("mousedown", (e) => {
      if (!controlsEnabled) return;
      dragging = true;
      lastMx = e.clientX;
      lastMy = e.clientY;
    });
    window.addEventListener("mouseup", () => {
      dragging = false;
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastMx;
      const dy = e.clientY - lastMy;
      lastMx = e.clientX;
      lastMy = e.clientY;
      if (camMode === "orbit") {
        orbitYaw += dx * 0.01;
        orbitPitch = Math.max(0.05, Math.min(1.2, orbitPitch + dy * 0.01));
      } else {
        player.yaw += dx * 0.005;
      }
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!controlsEnabled) return;
        if (camMode === "orbit") {
          orbitDist = Math.max(6, Math.min(40, orbitDist + e.deltaY * 0.02));
          e.preventDefault();
        }
      },
      { passive: false }
    );

    const onResize = () => {
      size = configure();
      depth.destroy();
      depth = depthTex();
    };
    window.addEventListener("resize", onResize);

    function update(dt) {
      if (!chunk || !controlsEnabled) {
        player.moving = false;
        return;
      }
      let mx = 0,
        mz = 0;
      if (keys.KeyW || keys.ArrowUp) mz -= 1;
      if (keys.KeyS || keys.ArrowDown) mz += 1;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
      player.moving = !!(mx || mz);
      if (player.moving) {
        const len = Math.hypot(mx, mz) || 1;
        mx /= len;
        mz /= len;
        const s = Math.sin(player.yaw),
          c = Math.cos(player.yaw);
        const speed = camMode === "fpv" ? 8 : 6;
        player.x += (mx * c + mz * s) * speed * dt;
        player.z += (-mx * s + mz * c) * speed * dt;
      }
      player.feetY = sampleHeight(chunk, player.x, player.z);
      player.y = player.feetY + 1.55;

      const half = chunk.area * 0.42;
      if (
        Math.abs(player.x - chunk.origin_x) > half ||
        Math.abs(player.z - chunk.origin_z) > half
      ) {
        const [ox, oz] = snapOrigin(player.x, player.z, chunk.area, 192);
        if (
          Math.abs(ox - chunk.origin_x) > 0.01 ||
          Math.abs(oz - chunk.origin_z) > 0.01
        ) {
          bakeAt(ox, oz);
        }
      }
    }

    function cameraMatrices() {
      const aspect = size.w / Math.max(1, size.h);
      const proj = mat4Persp((55 * Math.PI) / 180, aspect, 0.1, 200);
      let eye, target;
      if (camMode === "fpv") {
        eye = [player.x, player.y, player.z];
        target = [
          player.x + Math.sin(player.yaw),
          player.y - 0.05,
          player.z + Math.cos(player.yaw),
        ];
      } else if (camMode === "orbit") {
        const cy = Math.cos(orbitPitch);
        eye = [
          player.x + Math.sin(orbitYaw) * cy * orbitDist,
          player.y + Math.sin(orbitPitch) * orbitDist + 2,
          player.z + Math.cos(orbitYaw) * cy * orbitDist,
        ];
        target = [player.x, player.y - 0.5, player.z];
      } else {
        eye = [
          player.x - Math.sin(player.yaw) * 7,
          player.y + 3.2,
          player.z - Math.cos(player.yaw) * 7,
        ];
        target = [player.x, player.y - 0.2, player.z];
      }
      const view = mat4LookAt(eye, target, [0, 1, 0]);
      lastEye = eye;
      lastTarget = target;
      return { mvp: mat4Mul(proj, view), eye };
    }

    function getPose() {
      return {
        x: player.x,
        y: player.feetY,
        z: player.z,
        yaw: player.yaw,
        moving: player.moving,
        camMode,
        eye: lastEye,
        target: lastTarget,
        aspect: size.w / Math.max(1, size.h),
        fovDeg: 55,
      };
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
      if (paused) {
        raf = 0;
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.05, (now - t0) / 1000);
      t0 = now;
      update(dt);

      const { mvp, eye } = cameraMatrices();
      const ubo = new Float32Array(32);
      ubo.set(mvp, 0);
      // cool moonlight (False Earth night)
      ubo[16] = -0.25;
      ubo[17] = -0.9;
      ubo[18] = -0.15;
      ubo[19] = now * 0.001;
      ubo[20] = eye[0];
      ubo[21] = eye[1];
      ubo[22] = eye[2];
      ubo[23] = 0;
      ubo[24] = player.x;
      ubo[25] = player.feetY;
      ubo[26] = player.z;
      ubo[27] = 1.1;
      device.queue.writeBuffer(frameBuf, 0, ubo);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.08, g: 0.12, b: 0.18, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setBindGroup(0, bindGroup);
      pass.setPipeline(starPipe);
      pass.setVertexBuffer(0, starVbo);
      pass.draw(STAR_N);
      if (terrainVbo && terrainIbo) {
        pass.setPipeline(terrainPipe);
        pass.setVertexBuffer(0, terrainVbo);
        pass.setIndexBuffer(terrainIbo, "uint32");
        pass.drawIndexed(terrainIndexCount);
      }
      if (grassVbo && grassCount > 0) {
        pass.setPipeline(grassPipe);
        pass.setVertexBuffer(0, grassVbo);
        pass.draw(32, grassCount); // 15 segments × 2 verts
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
      raf = requestAnimationFrame(frame);
    }

    function loop() {
      raf = requestAnimationFrame(frame);
    }

    function destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("resize", onResize);
      try {
        depth.destroy();
      } catch (_) {}
    }

    return {
      boot,
      destroy,
      setCameraMode,
      rebake,
      getPose,
      setControlsEnabled,
      setPaused,
      calibrate,
    };
  }

  window.FalseWorldGpu = { create };
})();
