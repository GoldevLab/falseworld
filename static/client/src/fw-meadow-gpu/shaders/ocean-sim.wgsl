
struct OceanSimParams {
  time : f32,
  patch0 : f32,
  patch1 : f32,
  wind : f32,
  origin_x : f32,
  origin_z : f32,
  foam_decay : f32,
  sea_y : f32,
};
@group(0) @binding(0) var<uniform> sp : OceanSimParams;
@group(0) @binding(1) var out0 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var out1 : texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var foam_in : texture_2d<f32>;
@group(0) @binding(4) var foam_out : texture_storage_2d<rgba16float, write>;

fn gwave(
  uv : vec2f, t : f32, psize : f32,
  dir : vec2f, cycles : f32, steep : f32, amp : f32, speed : f32,
  disp : ptr<function, vec3f>,
  ddx : ptr<function, vec3f>,
  ddz : ptr<function, vec3f>,
) {
  let d = normalize(dir);
  let L = psize / max(cycles, 1.0);
  let k = 6.2831853 / L;
  let xz = uv * psize;
  let f = k * (dot(d, xz) - speed * t);
  let s = sin(f);
  let c = cos(f);
  let q = steep;
  (*disp) += vec3f(q * amp * d.x * c, amp * s, q * amp * d.y * c);
  let wa = k * amp;
  (*ddx) += vec3f(-q * d.x * d.x * wa * s, d.x * wa * c, -q * d.x * d.y * wa * s);
  (*ddz) += vec3f(-q * d.x * d.y * wa * s, d.y * wa * c, -q * d.y * d.y * wa * s);
}

fn bake_cascade(uv : vec2f, t : f32, psize : f32, wind : f32, detail : f32) -> vec4f {
  var disp = vec3f(0.0);
  var ddx = vec3f(1.0, 0.0, 0.0);
  var ddz = vec3f(0.0, 0.0, 1.0);
  let w = wind;
  gwave(uv, t, psize, vec2f(0.92, 0.28), 2.0, 0.52, 0.55 * w * detail, 3.4, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(-0.35, 0.92), 3.0, 0.48, 0.38 * w * detail, 2.9, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(0.55, -0.78), 5.0, 0.58, 0.22 * w * detail, 2.4, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(-0.88, -0.25), 7.0, 0.55, 0.16 * w * detail, 2.6, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(0.22, 0.96), 11.0, 0.50, 0.10 * w * detail, 2.1, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(-0.7, 0.55), 17.0, 0.46, 0.07 * w * detail, 1.9, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(0.95, -0.12), 23.0, 0.42, 0.045 * w * detail, 2.3, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(-0.15, -0.98), 31.0, 0.40, 0.032 * w * detail, 2.0, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(0.65, 0.72), 43.0, 0.38, 0.022 * w * detail, 1.7, &disp, &ddx, &ddz);
  gwave(uv, t, psize, vec2f(-0.98, 0.4), 59.0, 0.35, 0.015 * w * detail, 1.85, &disp, &ddx, &ddz);
  let j = ddx.x * ddz.z - ddx.z * ddz.x;
  let foam = clamp(1.15 - j, 0.0, 2.0);
  return vec4f(disp.x, disp.y, disp.z, foam);
}

@compute @workgroup_size(8, 8)
fn cs_ocean_sim(@builtin(global_invocation_id) gid : vec3u) {
  let dims = textureDimensions(out0);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(dims);
  let t = sp.time;
  let c0 = bake_cascade(uv, t, sp.patch0, sp.wind, 1.0);
  let c1 = bake_cascade(uv, t * 1.15 + 3.1, sp.patch1, sp.wind, 0.55);
  textureStore(out0, vec2i(gid.xy), c0);
  textureStore(out1, vec2i(gid.xy), c1);
  let prev = textureLoad(foam_in, vec2i(gid.xy), 0).r;
  let inject = max(c0.w, c1.w * 0.85);
  let foam = max(prev * sp.foam_decay, inject * 0.65);
  textureStore(foam_out, vec2i(gid.xy), vec4f(foam, 0.0, 0.0, 0.0));
}
