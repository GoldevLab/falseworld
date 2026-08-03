
struct Frame {
  view_proj : mat4x4f,
  sun_dir : vec3f,
  time : f32,
  eye : vec3f,
  push_r : f32,
  player : vec4f,
  trail0 : vec4f,
  trail1 : vec4f,
  trail2 : vec4f,
  trail3 : vec4f,
  light_col : vec3f,
  tod : f32,
  moon_dir : vec3f,
  amb : f32,
};
struct ShadowParams {
  cascade0 : mat4x4f,
  cascade1 : mat4x4f,
  cascade2 : mat4x4f,
  splits : vec4f,
  bias_str : vec4f,
};
struct OceanParams {
  patch0 : f32,
  patch1 : f32,
  sea_y : f32,
  wind : f32,
};
@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(3) var shadow_samp : sampler_comparison;
@group(0) @binding(4) var shadow_map : texture_depth_2d_array;
@group(0) @binding(5) var<uniform> csm : ShadowParams;
@group(1) @binding(0) var ocean_samp : sampler;
@group(1) @binding(1) var cascade0 : texture_2d<f32>;
@group(1) @binding(2) var cascade1 : texture_2d<f32>;
@group(1) @binding(3) var foam_map : texture_2d<f32>;
@group(1) @binding(4) var<uniform> op : OceanParams;

fn sky_fog_col() -> vec3f {
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  let dusk = max(
    smoothstep(0.12, 0.28, frame.tod) * (1.0 - smoothstep(0.28, 0.42, frame.tod)),
    smoothstep(0.58, 0.72, frame.tod) * (1.0 - smoothstep(0.72, 0.88, frame.tod))
  );
  let night = 1.0 - clamp(day + dusk, 0.0, 1.0);
  return vec3f(0.55, 0.68, 0.82) * day + vec3f(0.55, 0.32, 0.22) * dusk + vec3f(0.04, 0.05, 0.10) * night;
}
fn apply_fog(rgb : vec3f, world : vec3f) -> vec3f {
  let dist = length(world.xz - frame.eye.xz);
  let dist_fog = smoothstep(420.0, 1100.0, dist);
  let h_fog = 1.0 - exp(-max(0.0, (frame.eye.y + 10.0) - world.y) * 0.032);
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  var dens = clamp(dist_fog * 0.70 + h_fog * dist_fog * 0.32, 0.0, 0.90);
  dens *= mix(1.18, 0.94, day);
  var out_c = mix(rgb, sky_fog_col(), dens);
  let luma = dot(out_c, vec3f(0.299, 0.587, 0.114));
  out_c = mix(out_c, vec3f(luma), dist_fog * 0.22);
  return out_c;
}

struct OceanIn {
  @location(0) pos : vec3f,
};
struct OceanOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) sea_y : f32,
  @location(2) nrm : vec3f,
  @location(3) foam_v : f32,
  @location(4) shore_e : f32,
};

// Must match Rust/JS/SCENE coast_radius — irregular island rim
fn oc_hash21(i : vec2i) -> f32 {
  var n = u32(i.x) * 1597334677u + u32(i.y) * 3812015801u;
  n = (n << 13u) ^ n;
  n = n * 1274126177u;
  return f32(n) * (1.0 / 4294967295.0);
}
fn oc_value(p : vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = oc_hash21(i);
  let b = oc_hash21(i + vec2i(1, 0));
  let c = oc_hash21(i + vec2i(0, 1));
  let d = oc_hash21(i + vec2i(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
fn oc_fbm(p : vec2f) -> f32 {
  var s = 0.0;
  var a = 1.0;
  var f = 1.0;
  var n = 0.0;
  for (var k = 0; k < 4; k++) {
    s += oc_value(p * f) * a;
    n += a;
    a *= 0.5;
    f *= 2.02;
  }
  return s / max(n, 1e-5);
}
fn oc_coast_radius(xz : vec2f) -> f32 {
  let ang = atan2(xz.y, xz.x);
  let lobes = sin(ang * 2.0) * 0.085
    + sin(ang * 3.0 + 1.3) * 0.06
    + cos(ang * 5.0 + 0.7) * 0.045
    + sin(ang * 9.0 + 2.4) * 0.028
    + cos(ang * 14.0 - 0.9) * 0.018;
  let n = oc_fbm(xz * (1.0 / 480.0));
  let n2 = oc_fbm(xz * (1.0 / 220.0) + vec2f(19.0, -11.0));
  let warp = clamp(0.90 + lobes + n * 0.12 + n2 * 0.07, 0.68, 1.22);
  return 256.0 * warp;
}
fn oc_island_edge(xz : vec2f) -> f32 {
  let dist = length(xz);
  let rim = oc_coast_radius(xz);
  return clamp((dist - rim * 0.72) / max(rim * 0.34, 1.0), 0.0, 1.0);
}
// Waterline ≈ wet sand → sea (edge ~0.45). Keep ocean off dry beach / inland.
fn oc_waterline_r(xz : vec2f) -> f32 {
  return oc_coast_radius(xz) * 0.873;
}
fn oc_clamp_shore(xz : vec2f) -> vec2f {
  let d = length(xz);
  let wr = oc_waterline_r(xz);
  if (d < wr && d > 1e-3) {
    return xz * (wr / d);
  }
  return xz;
}

fn sample_disp(tex : texture_2d<f32>, xz : vec2f, psize : f32) -> vec4f {
  let uv = fract(xz / psize);
  return textureSampleLevel(tex, ocean_samp, uv, 0.0);
}

fn gerstner_swell(xz : vec2f, t : f32) -> vec3f {
  var d = vec3f(0.0);
  let d0 = normalize(vec2f(0.9, 0.3));
  let k0 = 6.2831853 / 90.0;
  let f0 = k0 * (dot(d0, xz) - 4.2 * t);
  d += vec3f(0.35 * d0.x * cos(f0), 0.55 * sin(f0), 0.35 * d0.y * cos(f0));
  let d1 = normalize(vec2f(-0.4, 0.9));
  let k1 = 6.2831853 / 140.0;
  let f1 = k1 * (dot(d1, xz) - 5.1 * t);
  d += vec3f(0.28 * d1.x * cos(f1), 0.42 * sin(f1), 0.28 * d1.y * cos(f1));
  return d;
}

@vertex fn vs_ocean(input : OceanIn) -> OceanOut {
  var o : OceanOut;
  let t = frame.time;
  // Snap mesh verts that sit inland up to the beach waterline
  var xz0 = oc_clamp_shore(input.pos.xz);
  let edge0 = oc_island_edge(xz0);
  // Kill horizontal wave push near the beach so tide doesn't crawl inland
  let shore_damp = smoothstep(0.34, 0.68, edge0);
  let s0 = sample_disp(cascade0, xz0, op.patch0);
  let s1 = sample_disp(cascade1, xz0, op.patch1);
  let swell = gerstner_swell(xz0, t);
  var disp = vec3f(s0.x, s0.y, s0.z) + vec3f(s1.x, s1.y, s1.z) * 0.55 + swell;
  disp.x *= shore_damp;
  disp.z *= shore_damp;
  disp.y *= mix(0.35, 1.0, shore_damp);
  var world_xz = oc_clamp_shore(vec2f(xz0.x + disp.x, xz0.y + disp.z));
  let world = vec3f(world_xz.x, op.sea_y + disp.y, world_xz.y);
  let e = 0.6;
  let hx = sample_disp(cascade0, xz0 + vec2f(e, 0.0), op.patch0).y
         + sample_disp(cascade1, xz0 + vec2f(e, 0.0), op.patch1).y * 0.55
         + gerstner_swell(xz0 + vec2f(e, 0.0), t).y;
  let hz = sample_disp(cascade0, xz0 + vec2f(0.0, e), op.patch0).y
         + sample_disp(cascade1, xz0 + vec2f(0.0, e), op.patch1).y * 0.55
         + gerstner_swell(xz0 + vec2f(0.0, e), t).y;
  let nrm = normalize(vec3f(-(hx - disp.y) / e, 1.0, -(hz - disp.y) / e));
  let fuv = fract(xz0 / op.patch0);
  let foam_tex = textureSampleLevel(foam_map, ocean_samp, fuv, 0.0).r;
  o.world = world;
  o.sea_y = op.sea_y;
  o.nrm = nrm;
  o.foam_v = max(foam_tex, max(s0.w, s1.w) * 0.5);
  o.shore_e = oc_island_edge(world_xz);
  o.clip = frame.view_proj * vec4f(world, 1.0);
  return o;
}

@fragment fn fs_ocean(input : OceanOut) -> @location(0) vec4f {
  let t = frame.time;
  let edge = input.shore_e;
  // Soft start over wet sand — no knife-edge discard at the berm
  if (edge < 0.30) { discard; }
  let shore_fade = smoothstep(0.30, 0.56, edge);
  let V = normalize(frame.eye - input.world);
  let L = normalize(-frame.sun_dir);
  var n = normalize(input.nrm);
  let micro = sin(input.world.x * 1.35 + t * 4.2) * cos(input.world.z * 1.15 - t * 3.6);
  n = normalize(n + vec3f(micro * 0.06, 0.0, micro * 0.05));
  let ndl = max(dot(n, L), 0.0);
  let ndv = max(dot(n, V), 0.0);
  let R = reflect(-V, n);
  let fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  let radial = length(input.world.xz);
  let rim = oc_coast_radius(input.world.xz);
  let shallow = smoothstep(0.34, 0.78, edge);
  let deep = smoothstep(0.65, 1.0, edge) * smoothstep(rim * 1.05, rim * 2.5, radial);
  // Clear sandy shallows → deep blue (mute neon teal that read as lime land)
  var col = mix(vec3f(0.20, 0.38, 0.36), vec3f(0.035, 0.18, 0.34), shallow);
  col = mix(col, vec3f(0.008, 0.04, 0.12), deep);
  let crest = smoothstep(0.4, 1.1, input.foam_v);
  let steep = 1.0 - clamp(n.y, 0.0, 1.0);
  let foam_wave = crest * (0.5 + 0.5 * steep);
  let shore = smoothstep(0.64, 0.34, edge) * smoothstep(0.30, 0.48, edge);
  let shore_pulse = 0.55 + 0.45 * sin(edge * 12.0 - t * 1.9 + radial * 0.05);
  let foam = clamp(foam_wave * 0.85 + shore * shore_pulse * 1.05, 0.0, 1.0);
  col = mix(col, vec3f(0.92, 0.96, 0.99), foam * 0.88);
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  let dusk = max(
    smoothstep(0.12, 0.28, frame.tod) * (1.0 - smoothstep(0.28, 0.42, frame.tod)),
    smoothstep(0.58, 0.72, frame.tod) * (1.0 - smoothstep(0.72, 0.88, frame.tod))
  );
  let night = 1.0 - clamp(day + dusk, 0.0, 1.0);
  var sky_refl = mix(vec3f(0.55, 0.68, 0.85), vec3f(0.25, 0.45, 0.85), clamp(R.y * 0.7 + 0.3, 0.0, 1.0)) * day;
  sky_refl += mix(vec3f(0.7, 0.35, 0.18), vec3f(0.3, 0.25, 0.45), clamp(R.y, 0.0, 1.0)) * dusk;
  sky_refl += mix(vec3f(0.03, 0.04, 0.08), vec3f(0.05, 0.07, 0.14), clamp(R.y, 0.0, 1.0)) * night;
  let h = normalize(L + V);
  let ndh = max(dot(n, h), 0.0);
  let sun_spec = pow(ndh, 240.0) * 2.0 + pow(ndh, 70.0) * 0.5;
  let sss = vec3f(0.05, 0.26, 0.28) * pow(1.0 - ndv, 2.4) * pow(max(1.0 - n.y, 0.0), 1.4)
    * (0.5 + shallow * 0.7) * (0.35 + crest * 0.9);
  let sh = 0.65 + 0.35 * max(ndl, 0.0);
  var rgb = col * (frame.amb * 0.7 + ndl * 0.5 * sh) * frame.light_col + sky_refl * fres + frame.light_col * sun_spec * fres * sh + sss;
  let under = smoothstep(0.12, -0.45, frame.eye.y - input.sea_y);
  if (under > 0.01) {
    rgb = mix(rgb, vec3f(0.012, 0.07, 0.11), under * 0.8);
    rgb += vec3f(0.05, 0.18, 0.24) * fres * under * 0.6;
  }
  rgb = apply_fog(rgb, input.world);
  // More transparent at the wet sand so berm reads through
  let alpha = mix(0.22, 0.96, clamp(shallow * 0.5 + deep * 0.4 + foam * 0.28 + fres * 0.18, 0.0, 1.0))
    * shore_fade;
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(6.0)), alpha);
}
