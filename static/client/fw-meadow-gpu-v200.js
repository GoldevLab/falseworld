/** False World meadow WebGPU v200 — block Ctrl+W tab-close while crouch+WASD. */
/**
 * Inspiration: False Earth (Ming-Jyun Hung). Original WGSL + JS; no Three/R3F/React.
 */
(function () {
  const SCENE_WGSL = /* wgsl */ `
struct Frame {
  view_proj : mat4x4f,
  sun_dir : vec3f,
  time : f32,
  eye : vec3f,
  // push radius packed next to eye (replaces pad) — avoids vec3/f32 packing ambiguity
  push_r : f32,
  // player.xz in .xz, feet Y in .y, .w unused
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
@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(1) var env_samp : sampler;
@group(0) @binding(2) var env_map : texture_2d<f32>;

fn env_uv(dir : vec3f) -> vec2f {
  let d = normalize(dir);
  let u = atan2(d.z, d.x) * 0.15915494309 + 0.5;
  let v = 0.5 - asin(clamp(d.y, -1.0, 1.0)) * 0.31830988618;
  return vec2f(fract(u), clamp(v, 0.0, 1.0));
}
// Manual bilinear — works with unfilterable-float HDR (rgba32float).
fn env_sample(dir : vec3f) -> vec3f {
  let dims = vec2f(textureDimensions(env_map));
  let uv = env_uv(dir);
  let p = uv * dims - vec2f(0.5);
  let i0 = vec2i(floor(p));
  let f = fract(p);
  let maxi = vec2i(dims) - vec2i(1);
  let c00 = textureLoad(env_map, clamp(i0, vec2i(0), maxi), 0).rgb;
  let c10 = textureLoad(env_map, clamp(i0 + vec2i(1, 0), vec2i(0), maxi), 0).rgb;
  let c01 = textureLoad(env_map, clamp(i0 + vec2i(0, 1), vec2i(0), maxi), 0).rgb;
  let c11 = textureLoad(env_map, clamp(i0 + vec2i(1, 1), vec2i(0), maxi), 0).rgb;
  let c0 = mix(c00, c10, f.x);
  let c1 = mix(c01, c11, f.x);
  return mix(c0, c1, f.y);
}
// Fake PMREM: blur env by roughness (FE uses real pmremTexture)
fn env_sample_rough(dir : vec3f, rough : f32) -> vec3f {
  let d = normalize(dir);
  let blur = clamp(rough, 0.05, 1.0);
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(d.y) < 0.99);
  let tng = normalize(cross(up, d));
  let btg = cross(d, tng);
  let s = blur * 0.22;
  var acc = env_sample(d) * 0.28;
  acc += env_sample(normalize(d + tng * s)) * 0.14;
  acc += env_sample(normalize(d - tng * s)) * 0.14;
  acc += env_sample(normalize(d + btg * s)) * 0.14;
  acc += env_sample(normalize(d - btg * s)) * 0.14;
  acc += env_sample(normalize(d + (tng + btg) * s * 0.7)) * 0.08;
  acc += env_sample(normalize(d + (tng - btg) * s * 0.7)) * 0.08;
  return acc;
}
fn env_proc(dir : vec3f) -> vec3f {
  let d = normalize(dir);
  let elev = clamp(d.y, -1.0, 1.0);
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  let dusk = max(
    smoothstep(0.12, 0.28, frame.tod) * (1.0 - smoothstep(0.28, 0.42, frame.tod)),
    smoothstep(0.58, 0.72, frame.tod) * (1.0 - smoothstep(0.72, 0.88, frame.tod))
  );
  let night = 1.0 - clamp(day + dusk, 0.0, 1.0);
  var day_c = mix(vec3f(0.55, 0.48, 0.32), vec3f(0.52, 0.68, 0.88), smoothstep(-0.2, 0.25, elev));
  day_c = mix(day_c, vec3f(0.35, 0.55, 0.92), smoothstep(0.25, 0.95, elev));
  var dusk_c = mix(vec3f(0.55, 0.22, 0.12), vec3f(0.85, 0.45, 0.22), smoothstep(-0.15, 0.2, elev));
  dusk_c = mix(dusk_c, vec3f(0.25, 0.28, 0.55), smoothstep(0.2, 0.9, elev));
  var night_c = mix(vec3f(0.04, 0.05, 0.10), vec3f(0.06, 0.08, 0.16), smoothstep(-0.2, 0.4, elev));
  night_c = mix(night_c, vec3f(0.02, 0.03, 0.08), smoothstep(0.4, 1.0, elev));
  return day_c * day + dusk_c * dusk + night_c * night;
}
fn sky_fog_col() -> vec3f {
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  let dusk = max(
    smoothstep(0.12, 0.28, frame.tod) * (1.0 - smoothstep(0.28, 0.42, frame.tod)),
    smoothstep(0.58, 0.72, frame.tod) * (1.0 - smoothstep(0.72, 0.88, frame.tod))
  );
  let night = 1.0 - clamp(day + dusk, 0.0, 1.0);
  return vec3f(0.55, 0.68, 0.82) * day + vec3f(0.55, 0.32, 0.22) * dusk + vec3f(0.04, 0.05, 0.10) * night;
}
// Unified distance + height fog (trees/terrain/grass/ocean share this)
fn apply_fog(rgb : vec3f, world : vec3f) -> vec3f {
  let dist = length(world.xz - frame.eye.xz);
  let dist_fog = smoothstep(150.0, 600.0, dist);
  let h_fog = 1.0 - exp(-max(0.0, (frame.eye.y + 10.0) - world.y) * 0.032);
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  var dens = clamp(dist_fog * 0.82 + h_fog * dist_fog * 0.35, 0.0, 0.94);
  dens *= mix(1.18, 0.94, day);
  var out_c = mix(rgb, sky_fog_col(), dens);
  let luma = dot(out_c, vec3f(0.299, 0.587, 0.114));
  out_c = mix(out_c, vec3f(luma), dist_fog * 0.22);
  return out_c;
}
fn env_refl(dir : vec3f) -> vec3f {
  // Prefer HDR potsdamer (FE scene.environment) — keep more energy for metal grass
  let hdr = env_sample(dir) * 2.6;
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  return mix(env_proc(dir) * 0.85, hdr, mix(0.35, 0.92, day));
}
fn env_refl_rough(dir : vec3f, rough : f32) -> vec3f {
  let hdr = env_sample_rough(dir, rough) * 2.6;
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  return mix(env_proc(dir) * 0.85, hdr, mix(0.35, 0.92, day));
}
fn env_irradiance(n : vec3f) -> vec3f {
  // Diffuse IBL — wider blur
  let up = env_refl_rough(vec3f(0.0, 1.0, 0.0), 1.0);
  let nrm = env_refl_rough(n, 0.85);
  let hz = env_refl_rough(normalize(vec3f(n.x, 0.15, n.z)), 0.9);
  return (nrm * 0.45 + up * 0.35 + hz * 0.2) * 0.55;
}

struct ShadowParams {
  cascade0 : mat4x4f,
  cascade1 : mat4x4f,
  cascade2 : mat4x4f,
  splits : vec4f,
  bias_str : vec4f,
};
@group(0) @binding(3) var shadow_samp : sampler_comparison;
@group(0) @binding(4) var shadow_map : texture_depth_2d_array;
@group(0) @binding(5) var<uniform> csm : ShadowParams;

fn shadow_pcf0(uv : vec2f, ref_z : f32, texel : f32) -> f32 {
  var s = 0.0;
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, -texel), 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(0.0, -texel), 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, -texel), 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, 0.0), 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv, 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, 0.0), 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, texel), 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(0.0, texel), 0, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, texel), 0, ref_z);
  return s / 9.0;
}
fn shadow_pcf1(uv : vec2f, ref_z : f32, texel : f32) -> f32 {
  var s = 0.0;
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, -texel), 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(0.0, -texel), 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, -texel), 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, 0.0), 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv, 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, 0.0), 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, texel), 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(0.0, texel), 1, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, texel), 1, ref_z);
  return s / 9.0;
}
fn shadow_pcf2(uv : vec2f, ref_z : f32, texel : f32) -> f32 {
  var s = 0.0;
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, -texel), 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(0.0, -texel), 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, -texel), 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, 0.0), 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv, 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, 0.0), 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(-texel, texel), 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(0.0, texel), 2, ref_z);
  s += textureSampleCompare(shadow_map, shadow_samp, uv + vec2f(texel, texel), 2, ref_z);
  return s / 9.0;
}

fn cascade_shadow0(world : vec3f, bias : f32, texel : f32) -> f32 {
  let lp = csm.cascade0 * vec4f(world, 1.0);
  let ndc = lp.xyz / max(lp.w, 0.00001);
  let uv = vec2f(ndc.x * 0.5 + 0.5, -ndc.y * 0.5 + 0.5);
  let ref_z = clamp(ndc.z - bias, 0.0, 1.0);
  let sh = shadow_pcf0(uv, ref_z, texel);
  let inside = select(0.0, 1.0,
    uv.x > 0.001 && uv.x < 0.999 && uv.y > 0.001 && uv.y < 0.999 && ndc.z > 0.0 && ndc.z < 1.0);
  return mix(1.0, sh, inside);
}
fn cascade_shadow1(world : vec3f, bias : f32, texel : f32) -> f32 {
  let lp = csm.cascade1 * vec4f(world, 1.0);
  let ndc = lp.xyz / max(lp.w, 0.00001);
  let uv = vec2f(ndc.x * 0.5 + 0.5, -ndc.y * 0.5 + 0.5);
  let ref_z = clamp(ndc.z - bias, 0.0, 1.0);
  let sh = shadow_pcf1(uv, ref_z, texel);
  let inside = select(0.0, 1.0,
    uv.x > 0.001 && uv.x < 0.999 && uv.y > 0.001 && uv.y < 0.999 && ndc.z > 0.0 && ndc.z < 1.0);
  return mix(1.0, sh, inside);
}
fn cascade_shadow2(world : vec3f, bias : f32, texel : f32) -> f32 {
  let lp = csm.cascade2 * vec4f(world, 1.0);
  let ndc = lp.xyz / max(lp.w, 0.00001);
  let uv = vec2f(ndc.x * 0.5 + 0.5, -ndc.y * 0.5 + 0.5);
  let ref_z = clamp(ndc.z - bias, 0.0, 1.0);
  let sh = shadow_pcf2(uv, ref_z, texel);
  let inside = select(0.0, 1.0,
    uv.x > 0.001 && uv.x < 0.999 && uv.y > 0.001 && uv.y < 0.999 && ndc.z > 0.0 && ndc.z < 1.0);
  return mix(1.0, sh, inside);
}

fn shadow_factor(world : vec3f, N : vec3f, L : vec3f) -> f32 {
  let strength = csm.bias_str.y;
  let d = length(world - frame.eye);
  let ndl = max(dot(N, L), 0.0);
  let bias = csm.bias_str.x + (1.0 - ndl) * 0.004;
  let texel = 1.0 / f32(textureDimensions(shadow_map).x);
  // Wider near PCF + broader cascade crossfade (softer AAA contact)
  let s0 = cascade_shadow0(world, bias, texel * 2.25);
  let s1 = cascade_shadow1(world, bias, texel * 1.5);
  let s2 = cascade_shadow2(world, bias, texel);
  // Very wide cascade blend — hard frustum edges become soft gradients
  let w0 = 1.0 - smoothstep(csm.splits.x * 0.35, csm.splits.x * 1.35, d);
  let w1 = (1.0 - smoothstep(csm.splits.y * 0.40, csm.splits.y * 1.30, d)) * (1.0 - w0);
  let w2 = (1.0 - smoothstep(csm.splits.z * 0.45, csm.splits.z * 1.25, d)) * max(0.0, 1.0 - w0 - w1);
  let w_out = max(0.0, 1.0 - w0 - w1 - w2);
  let sh = s0 * w0 + s1 * w1 + s2 * w2 + w_out;
  // Lift floor so fully-shadowed regions never crush to ink
  let sh_lift = mix(0.42, 1.0, sh);
  return mix(1.0, sh_lift, strength * 0.85);
}

fn G_smith(ndl : f32, ndv : f32, rough : f32) -> f32 {
  let r = rough + 1.0;
  let k = (r * r) / 8.0;
  let gL = ndl / max(ndl * (1.0 - k) + k, 1e-4);
  let gV = ndv / max(ndv * (1.0 - k) + k, 1e-4);
  return gL * gV;
}

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

// Climate noise — integer hash (same in JS map + both WGSL modules). No sin().
fn biome_hash21(p : vec2i) -> f32 {
  var n = bitcast<u32>(p.x) * 1597334677u + bitcast<u32>(p.y) * 3812015801u;
  n = (n << 13u) ^ n;
  n = n * 1274126177u;
  return f32(n) * (1.0 / 4294967295.0);
}
fn biome_value_noise(p : vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = biome_hash21(i);
  let b = biome_hash21(i + vec2i(1, 0));
  let c = biome_hash21(i + vec2i(0, 1));
  let d = biome_hash21(i + vec2i(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
fn biome_fbm(p : vec2f) -> f32 {
  var s = 0.0;
  var a = 1.0;
  var f = 1.0;
  var n = 0.0;
  for (var i = 0; i < 4; i++) {
    s += biome_value_noise(p * f) * a;
    n += a;
    a *= 0.5;
    f *= 2.02;
  }
  return s / max(n, 1e-5);
}
// 0 meadow 1 dry 2 forest 3 snow 4 marsh 5 desert
fn biome_id(xz : vec2f) -> u32 {
  // Matches Rust biome_at — mixed biomes + balanced snow patches
  let s = xz * (1.0 / 90.0);
  let warp = biome_fbm(s * 0.7) * 0.35;
  let warp2 = biome_fbm(s * 0.7 + vec2f(4.0, -2.0)) * 0.35;
  let sw = s + vec2f(warp, warp2);
  let temp = biome_fbm(sw) * 0.88 + 0.08;
  let moist = biome_fbm(sw + vec2f(17.0, -9.0));
  let snow_blob = biome_fbm(xz * (1.0 / 110.0));
  let snow_here = (snow_blob > 0.28 && temp < 0.18) || (temp < -0.28);
  if (snow_here) { return 3u; }
  if (temp > 0.48 && moist < -0.12) { return 5u; }
  if (moist > 0.32) {
    if (temp > 0.05) { return 4u; }
    return 2u;
  }
  if (moist < -0.22) { return 1u; }
  return 0u;
}

// Soft biome memberships — noise-ragged ecotones (no laser borders)
struct BiomeW {
  meadow : f32,
  dry : f32,
  forest : f32,
  snow : f32,
  marsh : f32,
  desert : f32,
};
fn biome_weights(xz : vec2f) -> BiomeW {
  let s = xz * (1.0 / 90.0);
  let warp = biome_fbm(s * 0.7) * 0.35;
  let warp2 = biome_fbm(s * 0.7 + vec2f(4.0, -2.0)) * 0.35;
  let sw = s + vec2f(warp, warp2);
  let temp = biome_fbm(sw) * 0.88 + 0.08;
  let moist = biome_fbm(sw + vec2f(17.0, -9.0));
  let jag = biome_fbm(xz * (1.0 / 42.0)) * 22.0
    + biome_fbm(xz * (1.0 / 18.0) + vec2f(5.1, -3.7)) * 9.0;
  let snow_blob = biome_fbm(xz * (1.0 / 110.0));
  let snow_k = select(0.0, 1.0, (snow_blob > 0.28 && temp < 0.18) || temp < -0.28);
  // Soft edge on snow patches
  var snow = snow_k * smoothstep(0.18, 0.38, snow_blob + (0.28 - temp) * 0.35);
  snow = clamp(snow + select(0.0, 0.85, temp < -0.28), 0.0, 1.0);
  snow = smoothstep(0.12, 0.88, snow);
  let rest = 1.0 - snow;
  var desert = smoothstep(0.32, 0.58, temp) * (1.0 - smoothstep(-0.28, 0.02, moist)) * rest;
  let wet = smoothstep(0.12, 0.48, moist + jag * 0.0022) * rest;
  var marsh = wet * smoothstep(-0.08, 0.30, temp);
  var forest = wet * (1.0 - smoothstep(-0.08, 0.30, temp));
  var dry = (1.0 - smoothstep(-0.40, -0.05, moist)) * rest;
  dry = dry * (1.0 - clamp(desert + wet, 0.0, 1.0));
  var meadow = max(rest - desert - marsh - forest - dry, 0.0);
  var sum = meadow + dry + forest + snow + marsh + desert;
  sum = max(sum, 1e-4);
  return BiomeW(meadow / sum, dry / sum, forest / sum, snow / sum, marsh / sum, desert / sum);
}

// Irregular island silhouette — must match Rust coast_radius / JS coastRadius
fn coast_warp(xz : vec2f) -> f32 {
  let ang = atan2(xz.y, xz.x);
  let lobes = sin(ang * 2.0) * 0.085
    + sin(ang * 3.0 + 1.3) * 0.06
    + cos(ang * 5.0 + 0.7) * 0.045
    + sin(ang * 9.0 + 2.4) * 0.028
    + cos(ang * 14.0 - 0.9) * 0.018;
  let n = biome_fbm(xz * (1.0 / 480.0));
  let n2 = biome_fbm(xz * (1.0 / 220.0) + vec2f(19.0, -11.0));
  return clamp(0.90 + lobes + n * 0.12 + n2 * 0.07, 0.68, 1.22);
}
fn coast_radius(xz : vec2f) -> f32 {
  return 256.0 * coast_warp(xz);
}
fn island_edge_w(xz : vec2f) -> f32 {
  let dist = length(xz);
  let rim = coast_radius(xz);
  return clamp((dist - rim * 0.72) / max(rim * 0.34, 1.0), 0.0, 1.0);
}

fn biome_ground(bid : u32) -> vec3f {
  switch bid {
    case 1u: { return vec3f(0.20, 0.18, 0.09); } // dry
    case 2u: { return vec3f(0.07, 0.11, 0.05); } // forest
    case 3u: { return vec3f(0.42, 0.46, 0.50); } // snow (less chalk)
    case 4u: { return vec3f(0.09, 0.13, 0.07); } // marsh
    case 5u: { return vec3f(0.38, 0.30, 0.16); } // desert
    default: { return vec3f(0.09, 0.13, 0.06); } // meadow soil
  }
}

fn biome_ground_soft(xz : vec2f) -> vec3f {
  let w = biome_weights(xz);
  return biome_ground(0u) * w.meadow
    + biome_ground(1u) * w.dry
    + biome_ground(2u) * w.forest
    + biome_ground(3u) * w.snow
    + biome_ground(4u) * w.marsh
    + biome_ground(5u) * w.desert;
}

@fragment fn fs_terrain(input : TerrainOut) -> @location(0) vec4f {
  let n = normalize(input.nrm);
  let L = normalize(-frame.sun_dir);
  let V = normalize(frame.eye - input.world);
  let ndl = max(dot(n, L), 0.0);
  let ndv = max(dot(n, V), 0.0);
  let bw = biome_weights(input.world.xz);
  let bid = biome_id(input.world.xz);
  var col = biome_ground_soft(input.world.xz);
  col = mix(col, col * 1.12, clamp(n.y * 0.5 + 0.2, 0.0, 1.0));
  // Snow pack / rock by soft snow weight (no hard biome cut)
  if (bw.snow > 0.04) {
    let slope = 1.0 - clamp(n.y, 0.0, 1.0);
    let rock = vec3f(0.28, 0.30, 0.34);
    let pack = vec3f(0.72, 0.76, 0.82);
    var snow_col = mix(pack, rock, smoothstep(0.18, 0.55, slope));
    snow_col = mix(snow_col, vec3f(0.88, 0.91, 0.95), pow(clamp(n.y, 0.0, 1.0), 3.0) * 0.35);
    col = mix(col, snow_col, smoothstep(0.08, 0.75, bw.snow));
  }
  // Contact AO under grass — keep soil darker than blades, never chalk
  let contact_ao = mix(0.70, 1.0, clamp(n.y * 0.7 + 0.2, 0.0, 1.0));
  col *= contact_ao;
  let edge = island_edge_w(input.world.xz);
  // Wide beach: dry sand → wet sand → foam line → shelf
  let sand_n = biome_fbm(input.world.xz * 0.08) * 0.5 + 0.5;
  let dry_sand = vec3f(0.78, 0.70, 0.48) * (0.92 + sand_n * 0.12);
  let wet_sand = vec3f(0.48, 0.42, 0.34);
  let foam_sand = vec3f(0.90, 0.92, 0.94);
  let dry_w = smoothstep(0.02, 0.32, edge) * (1.0 - smoothstep(0.38, 0.62, edge));
  let wet_w = smoothstep(0.28, 0.55, edge) * (1.0 - smoothstep(0.62, 0.88, edge));
  let foam_w = smoothstep(0.48, 0.62, edge) * (1.0 - smoothstep(0.68, 0.86, edge));
  col = mix(col, dry_sand, dry_w * 0.97);
  col = mix(col, wet_sand, wet_w * 0.92);
  col = mix(col, foam_sand, foam_w * 0.55);
  // Mottled dark soil under grassy biomes — hides flat green between blades
  let canopy = clamp(bw.meadow * 0.95 + bw.forest * 0.95 + bw.marsh * 0.7 + bw.dry * 0.55, 0.0, 1.0);
  let soil_n = biome_fbm(input.world.xz * 0.35) * 0.5 + 0.5;
  let soil_n2 = biome_fbm(input.world.xz * 1.1 + vec2f(3.1, -1.7)) * 0.5 + 0.5;
  var soil = mix(vec3f(0.05, 0.08, 0.03), vec3f(0.09, 0.14, 0.05), soil_n);
  soil = mix(soil, vec3f(0.07, 0.11, 0.04), soil_n2 * 0.5);
  // Tiny litter flecks
  soil = mix(soil, vec3f(0.12, 0.1, 0.05), smoothstep(0.78, 0.95, soil_n2) * 0.35);
  col = mix(col, soil, canopy * 0.82 * (1.0 - smoothstep(0.05, 0.42, edge)));
  if (input.world.y < -0.25) {
    col = mix(col, vec3f(0.08, 0.18, 0.24), smoothstep(-0.25, -2.2, input.world.y));
  }
  let sun = frame.light_col;
  let hemi = env_irradiance(n);
  let sh = shadow_factor(input.world, n, L);
  // Soft ground: ambient fill kills hard lit/unlit CSM patches under grass
  let sh_g = mix(1.0, sh, 0.45);
  var rgb = col * (frame.amb * 1.15 + ndl * 0.55 * sh_g) * sun + col * hemi * (0.5 + frame.amb * 0.35);
  // Wet sand sheen on the beach
  if (wet_w > 0.15) {
    let h = normalize(L + V);
    let ndh = max(dot(n, h), 0.0);
    rgb += sun * pow(ndh, 72.0) * wet_w * 0.35 * sh;
  }
  if (bw.snow > 0.2 || bw.marsh > 0.35 || bid == 3u || bid == 4u) {
    let h = normalize(L + V);
    let ndh = max(dot(n, h), 0.0);
    let rough = select(0.55, 0.35, bw.snow > 0.35);
    let a = max(rough * rough, 0.04);
    let a2 = a * a;
    let d_den = ndh * ndh * (a2 - 1.0) + 1.0;
    let D = a2 / max(3.14159 * d_den * d_den, 1e-4);
    let F = 0.05 + 0.95 * pow(1.0 - ndv, 5.0);
    let G = G_smith(max(ndl, 0.02), max(ndv, 0.02), rough);
    let spec = D * F * G / max(4.0 * max(ndl, 0.02) * max(ndv, 0.02), 1e-4);
    rgb += sun * spec * 0.22 * sh;
    rgb += env_refl(reflect(-V, n)) * F * 0.12;
  }
  rgb = apply_fog(rgb, input.world);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(4.0)), 1.0);
}

struct Blade {
  data0 : vec4f,
  data1 : vec4f,
  data2 : vec4f,
  data3 : vec4f,
};
@group(1) @binding(0) var<storage, read> blades : array<Blade>;
@group(1) @binding(1) var<storage, read> lod_idx : array<u32>;
@group(1) @binding(2) var<storage, read> rock_occ_g : array<f32>;

fn grass_blocked_xz(wx : f32, wz : f32) -> bool {
  let half = 256.0;
  let cell = 2.0;
  let n = 256;
  let ix = i32(floor((wx + half) / cell));
  let iz = i32(floor((wz + half) / cell));
  if (ix < 0 || iz < 0 || ix >= n || iz >= n) { return false; }
  return rock_occ_g[u32(iz * n + ix)] > 0.28;
}

struct GrassOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) color : vec3f,
  @location(2) nrm : vec3f,
  @location(3) height_t : f32,
  @location(4) side_uv : f32,
  @location(5) side_dir : vec3f,
  @location(6) dist_fade : f32,
  @location(7) emissive : f32,
};

fn bezier3(a : vec3f, b : vec3f, c : vec3f, d : vec3f, t : f32) -> vec3f {
  let u = 1.0 - t;
  return a*u*u*u + b*3.0*u*u*t + c*3.0*u*t*t + d*t*t*t;
}
fn bezier3_tangent(a : vec3f, b : vec3f, c : vec3f, d : vec3f, t : f32) -> vec3f {
  let u = 1.0 - t;
  let tang = (b - a) * (3.0 * u * u) + (c - b) * (6.0 * u * t) + (d - c) * (3.0 * t * t);
  let len = length(tang);
  if (len < 1e-5) { return vec3f(0.0, 1.0, 0.0); }
  return tang / len;
}
// FE calculateWindStrength — layered noise remapped to [0, windStrength≈4.5]
fn fe_wind_strength(xz : vec2f, time : f32) -> f32 {
  let wind_dir2 = vec2f(1.0, 0.0);
  let uv = xz * 0.1 + wind_dir2 * (time * 0.35);
  let n = sin(uv.x * 1.73 + uv.y * 2.41) * 0.45
    + sin(uv.x * 3.19 - uv.y * 1.87 + 1.7) * 0.28
    + sin(uv.x * 6.13 + uv.y * 4.27 + time * 0.55) * 0.18
    + sin(dot(uv, vec2f(0.7, 1.3)) * 9.0 + time * 1.1) * 0.09;
  return clamp((n + 1.0) * 0.5 * 4.5, 0.0, 4.5);
}
fn rotate_y(v : vec3f, rot_s : f32, rot_c : f32) -> vec3f {
  return vec3f(v.x * rot_c - v.z * rot_s, v.y, v.x * rot_s + v.z * rot_c);
}
fn align_to_terrain(v : vec3f, terrain_n : vec3f) -> vec3f {
  let up = vec3f(0.0, 1.0, 0.0);
  // Light follow only — strong align made steep hills look like furry mountains
  let align = normalize(mix(up, terrain_n, 0.14));
  let axis = cross(up, align);
  let axis_len = length(axis);
  if (axis_len < 1e-4) { return v; }
  let a = axis / axis_len;
  let ang = acos(clamp(dot(up, align), -1.0, 1.0));
  let ca = cos(ang);
  let sa = sin(ang);
  return v * ca + cross(a, v) * sa + a * dot(a, v) * (1.0 - ca);
}

fn grass_vs(vid : u32, iid : u32, segs : f32) -> GrassOut {
  let bi = lod_idx[iid];
  let blade = blades[bi];
  // 3 blades per instance (clump) — denser carpet without more storage
  let verts_per = (u32(segs) + 1u) * 2u;
  let clump_i = vid / verts_per;
  let local = vid % verts_per;
  var pos = blade.data0.xyz;
  let blade_type = floor(blade.data0.w + 0.01);
  var width = blade.data1.x;
  var height = blade.data1.y;
  let bend = blade.data1.z;
  let wind_str = blade.data1.w; // seed bias from bake
  var rot_s = blade.data2.x;
  var rot_c = blade.data2.y;
  let clump = blade.data2.z;
  let seed = blade.data2.w;
  let tn_x = blade.data3.x;
  let tn_z = blade.data3.y;
  let tn_y = sqrt(max(0.0, 1.0 - tn_x * tn_x - tn_z * tn_z));
  let terrain_n = normalize(vec3f(tn_x, tn_y, tn_z));

  // Live occupancy (rocks + build decks) — hide blades under solid floors
  if (grass_blocked_xz(pos.x, pos.z) || height < 0.04) {
    var dead : GrassOut;
    dead.clip = vec4f(0.0, 0.0, 2.0, 1.0);
    dead.world = pos;
    dead.color = vec3f(0.0);
    dead.nrm = vec3f(0.0, 1.0, 0.0);
    dead.height_t = 0.0;
    dead.side_uv = 0.0;
    dead.side_dir = vec3f(1.0, 0.0, 0.0);
    dead.dist_fade = 1.0;
    dead.emissive = 0.0;
    return dead;
  }

  // Offset + spin each clump member
  let cseed = fract(seed * 17.13 + f32(clump_i) * 0.37);
  let off_a = seed * 6.28318 + f32(clump_i) * 2.094395;
  let off_r = mix(0.035, 0.12, seed) * (0.7 + f32(clump_i) * 0.35);
  pos = pos + vec3f(cos(off_a) * off_r, 0.0, sin(off_a) * off_r);
  height = height * mix(0.82, 1.12, cseed);
  width = width * mix(1.05, 1.45, cseed); // wider to hide soil gaps
  let yaw_add = (cseed - 0.5) * 1.1;
  let rs2 = sin(yaw_add); let rc2 = cos(yaw_add);
  let rs = rot_s * rc2 + rot_c * rs2;
  let rc = rot_c * rc2 - rot_s * rs2;
  rot_s = rs; rot_c = rc;

  let side = f32(local % 2u) * 2.0 - 1.0;
  let t = f32(local / 2u) / segs;

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

  // FE wind: live noise strength (compute-updated in FE) + push + tip sway
  let wind_dir = normalize(vec3f(1.0, 0.0, 0.0));
  let cam_dist_w = length(pos - frame.eye);
  // FE windDistanceStart/End 50–100
  let wind_fall = 1.0 - smoothstep(50.0, 100.0, cam_dist_w);
  let ws = fe_wind_strength(pos.xz, frame.time) * wind_fall * (0.75 + 0.25 * clamp(wind_str * 0.35, 0.0, 1.5));

  // applyWindPush
  p1 = p1 + wind_dir * (ws * height * 0.08);
  p2 = p2 + wind_dir * (ws * height * 0.15);
  p3 = p3 + wind_dir * (ws * height * 0.25);

  let phase = seed * 6.28318 + dot(pos.xz, wind_dir.xz) * 0.15;
  let freq = mix(0.4, 1.5, seed);
  let low = sin(frame.time * freq + phase + t * 2.2);
  let high = sin(frame.time * freq * 5.0 + phase * 1.7 + t * 5.0);
  let gust = 0.65 + 0.35 * sin(frame.time * 0.35 + seed * 6.28318);
  // FE vertexSway: sway along blade side, tip only, swayStrength 0.01
  let sway_amp = height * ws * 0.01 * gust;
  let tip_mask = smoothstep(0.5, 1.0, t);
  let spine_base = bezier3(p0, p1, p2, p3, t);
  let tangent = bezier3_tangent(p0, p1, p2, p3, t);
  var side_local = normalize(cross(vec3f(0.0, 0.0, 1.0), tangent));
  if (length(side_local) < 1e-4) { side_local = vec3f(1.0, 0.0, 0.0); }
  let sway = side_local * ((low * sway_amp + high * sway_amp * 0.8) * tip_mask);
  let spine = spine_base + sway;

  // FE exact: widthFactor = (t + 0.35) * (1-t)^0.9 — thin hair blades
  let width_factor = (t + 0.35) * pow(max(1.0 - t, 0.0), 0.9);
  let cam_dist0 = cam_dist_w;
  // Distance widen: far blades must cover >1px or specular becomes shimmer noise
  let dist_widen = mix(1.0, 3.2, smoothstep(10.0, 28.0, cam_dist0));
  let half_w = width * width_factor * dist_widen;

  var lpos = spine + side_local * (half_w * side);

  // World-space parting (after rotate/align). UBO: player.xz + push_r beside eye.
  var lpos_r = rotate_y(lpos, rot_s, rot_c);
  lpos_r = align_to_terrain(lpos_r, terrain_n);
  var side_w = rotate_y(side_local, rot_s, rot_c);
  side_w = align_to_terrain(side_w, terrain_n);
  side_w = normalize(side_w);

  // Character parting — FE-like: tight radius, tip-weighted push, light flatten
  let char_xz = frame.player.xz;
  let pr = clamp(frame.push_r, 0.35, 1.0);
  var push_x = 0.0;
  var push_z = 0.0;
  var flatten_w = 0.0;

  // Live feet / calves
  {
    var d = pos.xz - char_xz;
    var dist = length(d);
    var dir = vec2f(0.0, 1.0);
    if (dist < 0.04) {
      let ang = seed * 6.2831853;
      dir = vec2f(cos(ang), sin(ang));
      dist = 0.04;
    } else {
      dir = d / max(dist, 1e-4);
    }
    if (dist < pr) {
      // Sharp edge so the ring around feet stays small
      let fall = pow(smoothstep(pr, 0.0, dist), 1.75);
      // Stronger core under the body (~shin width)
      let core = pow(smoothstep(pr * 0.55, 0.0, dist), 1.35);
      // pushAmount ~0.55 (taller grass than FE 0.4)
      let str = fall * 0.55 + core * 0.25;
      push_x += dir.x * str;
      push_z += dir.y * str;
      // FE flattenAmount ~0.05 — keep light so blades still read as grass
      flatten_w = max(flatten_w, fall * 0.10 + core * 0.08);
    }
  }
  // Trail footprints — narrower than live radius, softer
  {
    let tr = pr * 0.55;
    let trails = array<vec4f, 4>(frame.trail0, frame.trail1, frame.trail2, frame.trail3);
    for (var si = 0; si < 4; si++) {
      let s = trails[si];
      if (s.z < 0.04) { continue; }
      var d = pos.xz - s.xy;
      var dist = length(d);
      if (dist >= tr || dist < 1e-4) { continue; }
      let dir = d / dist;
      let fall = pow(smoothstep(tr, 0.0, dist), 1.8) * s.z;
      push_x += dir.x * fall * 0.35;
      push_z += dir.y * fall * 0.35;
      flatten_w = max(flatten_w, fall * 0.12);
    }
  }

  // Tip-weighted like FE pow(t, 2)
  let h_w = pow(t, 2.0);
  var px = push_x * h_w;
  var pz = push_z * h_w;
  let plen = length(vec2f(px, pz));
  if (plen > 0.72) {
    let s = 0.72 / plen;
    px *= s; pz *= s;
  }
  let flat = clamp(flatten_w, 0.0, 0.35);
  lpos_r = vec3f(lpos_r.x + px, lpos_r.y * (1.0 - flat), lpos_r.z + pz);

  var world = pos + lpos_r;

  // FE applyViewDependentTilt — thicken when viewed from the side (fills carpet)
  let to_eye = normalize(frame.eye - world);
  let cam_side = dot(to_eye, side_w);
  let edge_mask = clamp((side * 0.5) * cam_side * pow(abs(cam_side), 1.2), 0.0, 1.0);
  let center_mask = clamp(pow(max(1.0 - t, 0.0), 0.5) * pow(t + 0.05, 0.33), 0.0, 1.0);
  let nrm_pre = normalize(cross(side_w, rotate_y(tangent, rot_s, rot_c)));
  var n_xz = vec3f(nrm_pre.x, 0.0, nrm_pre.z);
  let n_xz_len = length(n_xz);
  if (n_xz_len > 1e-5) {
    world = world + (n_xz / n_xz_len) * (0.13 * edge_mask * center_mask);
  }

  var nrm = normalize(nrm_pre + side_w * (side * 0.35));

  // FE exact: #000 → #2e698c (only snow overrides). No neon green path.
  let bw = biome_weights(pos.xz);
  let bid = biome_id(pos.xz);
  // Natural meadow midtones (readable green, not ink / not neon)
  var tip_col = vec3f(0.14, 0.28, 0.14);
  tip_col = mix(tip_col, vec3f(0.22, 0.28, 0.12), bw.dry * 0.25);
  tip_col = mix(tip_col, vec3f(0.11, 0.24, 0.16), bw.marsh * 0.22);
  tip_col = mix(tip_col, vec3f(0.11, 0.24, 0.12), bw.forest * 0.18);
  tip_col = mix(tip_col, vec3f(0.78, 0.82, 0.86), bw.snow);
  var col = mix(vec3f(0.04, 0.07, 0.03), tip_col, pow(t, 0.95));
  col *= mix(0.88, 1.12, clump) * mix(0.85, 1.15, seed);

  let cam_dist = cam_dist0;
  // FE carpet fade ~15–30m
  let dist_fade = smoothstep(60.0, 220.0, cam_dist);
  // Pack blade seed for FS variation (was unused tip emit)
  let tip_emit = seed;

  var o : GrassOut;
  o.world = world;
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.color = col;
  o.nrm = nrm;
  o.height_t = t;
  o.side_uv = side * 0.5 + 0.5;
  o.side_dir = side_w;
  o.dist_fade = dist_fade;
  o.emissive = tip_emit;
  return o;
}

@vertex fn vs_grass15(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> GrassOut {
  return grass_vs(vid, iid, 15.0);
}
@vertex fn vs_grass5(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> GrassOut {
  return grass_vs(vid, iid, 5.0);
}
@vertex fn vs_grass2(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> GrassOut {
  return grass_vs(vid, iid, 2.0);
}

@fragment fn fs_grass(input : GrassOut) -> @location(0) vec4f {
  var n = normalize(input.nrm);
  let u = input.side_uv - 0.5;
  let au = abs(u);
  let mid01 = smoothstep(-0.25, 0.25, u);
  let rim_mask = smoothstep(0.42, 0.45, au);
  let v01 = mix(mid01, 1.0 - mid01, rim_mask);
  let ny = v01 * 2.0 - 1.0;
  n = normalize(n + normalize(input.side_dir) * ny * 0.35);

  let L = normalize(-frame.sun_dir);
  let V = normalize(frame.eye - input.world);
  let ndl = max(dot(n, L), 0.0);
  let h = normalize(L + V);
  let ndh = max(dot(n, h), 0.0);
  let ndv = max(dot(n, V), 0.0);
  let sh = shadow_factor(input.world, n, L);

  let far = input.dist_fade;
  let near_w = 1.0 - far;
  let t = clamp(input.height_t, 0.0, 1.0);

  // Natural meadow: readable green body, soft light response, NO glitter GGX
  let seed = fract(input.emissive);
  let clump_n = fract(sin(dot(floor(input.world.xz * 0.28), vec2f(127.1, 311.7))) * 43758.55);
  let patch_n = fract(sin(dot(input.world.xz * 0.09, vec2f(12.9898, 78.233))) * 43758.55);
  let micro = fract(sin(dot(input.world.xz * 4.3 + seed * 11.0, vec2f(91.7, 47.3))) * 24634.63);

  let ao = mix(0.48, 1.0, clamp(pow(t, 2.0), 0.0, 1.0));
  var albedo = input.color * ao;
  albedo = albedo * mix(0.78, 1.18, seed) * mix(0.9, 1.1, clump_n);
  albedo = mix(albedo, albedo * vec3f(1.02, 0.95, 0.85), patch_n * 0.3);

  n = normalize(n + vec3f(micro - 0.5, 0.0, fract(micro * 7.1) - 0.5) * 0.2
    + normalize(input.side_dir) * (seed - 0.5) * 0.18);
  let ndl2 = max(dot(n, L), 0.0);
  let h2 = normalize(L + V);
  let ndh2 = max(dot(n, h2), 0.0);

  let sun = mix(frame.light_col, vec3f(0.9, 0.95, 1.0) * length(frame.light_col), 0.25)
    * mix(0.68, 0.55, far);

  // Soft directional + gentle fill (mid between wrap-wash and ink)
  let soft = max(ndl2 * 0.7 + 0.3, 0.0);
  let diffuse = albedo * (0.14 + soft * 0.58);
  let hemi = albedo * (0.14 + 0.16 * max(n.y, 0.0));
  let sky_fill = env_irradiance(n) * albedo * 0.2;

  // Soft velvet tip response — NOT GGX metal glitter
  let tip = pow(t, 1.5);
  let velvet = pow(ndh2, 12.0) * tip * mix(0.04, 0.11, seed) * near_w;
  let back = max(dot(-n, L), 0.0);
  let sss = albedo * vec3f(0.45, 0.7, 0.28) * pow(back, 1.4) * (1.0 - t * 0.35)
    * mix(0.1, 0.2, seed) * sun;

  var rgb = hemi + diffuse * sun + sky_fill + sun * velvet + sss;
  rgb = rgb * mix(0.75, 1.02, smoothstep(0.05, 0.92, t));
  rgb = rgb * mix(1.0, 0.82, far);

  let luma = dot(rgb, vec3f(0.299, 0.587, 0.114));
  rgb = mix(vec3f(luma), rgb, 0.88);

  let peak = max(rgb.x, max(rgb.y, rgb.z));
  let peak_scale = min(1.0, 0.95 / max(peak, 0.95));
  rgb = rgb * peak_scale;

  let gray = vec3f(dot(rgb, vec3f(0.333)));
  rgb = mix(rgb, gray, far * 0.25);
  rgb = apply_fog(rgb, input.world);

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(4.0)), 1.0);
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
  let night = 1.0 - smoothstep(0.18, 0.38, frame.tod) * (1.0 - smoothstep(0.62, 0.82, frame.tod));
  if (night < 0.08) { discard; }
  let c = vec3f(0.85, 0.90, 1.0) * input.bright * 0.75 * night;
  return vec4f(c, night);
}

struct BeamIn {
  @location(0) pos : vec3f,
  @location(1) col_a : vec4f,
};
struct BeamOut {
  @builtin(position) clip : vec4f,
  @location(0) col : vec4f,
};
@vertex fn vs_beam(input : BeamIn) -> BeamOut {
  var o : BeamOut;
  o.clip = frame.view_proj * vec4f(input.pos, 1.0);
  o.col = input.col_a;
  return o;
}
@fragment fn fs_beam(input : BeamOut) -> @location(0) vec4f {
  // Soft vertical shaft — alpha already in col
  let a = input.col.a * 0.65;
  return vec4f(input.col.rgb * a, a);
}

// Flower billboards — fdata: kind, scale, phase, sway
// kind: 0 daisy 1 buttercup 2 poppy 3 bluebell 4 lavender 5 clover 6 desert 7 snowdrop 8 marsh
struct RoseIn {
  @location(0) center : vec3f,
  @location(1) corner : vec2f,
  @location(2) fdata : vec4f,
};
struct RoseOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
  @location(1) fdata : vec4f,
  @location(2) world : vec3f,
};
@vertex fn vs_rose(input : RoseIn) -> RoseOut {
  var o : RoseOut;
  let kind = input.fdata.x;
  let scale = input.fdata.y;
  let phase = input.fdata.z;
  // Far props — skip (HQ bubble ~80–100m)
  let dist_xz = length(input.center.xz - frame.eye.xz);
  if (dist_xz > 100.0) {
    o.clip = vec4f(0.0, 0.0, 2.0, 1.0);
    o.uv = input.corner;
    o.fdata = input.fdata;
    o.world = input.center;
    return o;
  }
  let to_eye = normalize(frame.eye - input.center);
  var right = cross(vec3f(0.0, 1.0, 0.0), to_eye);
  if (length(right) < 1e-4) { right = vec3f(1.0, 0.0, 0.0); }
  right = normalize(right);
  let up = vec3f(0.0, 1.0, 0.0);
  // Tall lavender / bluebell stretch more vertically
  var sx = 0.16 * scale;
  var sy = 0.16 * scale;
  if (kind > 3.5 && kind < 4.5) { sx = 0.11 * scale; sy = 0.28 * scale; }
  else if (kind > 2.5 && kind < 3.5) { sx = 0.12 * scale; sy = 0.22 * scale; }
  else if (kind > 4.5 && kind < 5.5) { sx = 0.12 * scale; sy = 0.12 * scale; }
  let sway = sin(frame.time * (1.4 + phase * 0.5) + phase * 6.28) * 0.04 * scale;
  let world = input.center
    + right * (input.corner.x * sx + sway * input.corner.y)
    + up * (input.corner.y * sy + 0.02);
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.uv = input.corner;
  o.fdata = input.fdata;
  o.world = world;
  return o;
}
@fragment fn fs_rose(input : RoseOut) -> @location(0) vec4f {
  let kind = input.fdata.x;
  let phase = input.fdata.z;
  let u = input.uv.x;
  let v = input.uv.y;
  let ang = atan2(v, u);
  let r = length(vec2f(u, v));
  var mask = 0.0;
  var col = vec3f(0.8, 0.2, 0.3);
  var petals = 5.0;
  var petal_amp = 0.42;
  var petal_base = 0.52;
  var center_r = 0.22;
  var center_col = vec3f(0.92, 0.78, 0.15);
  var petal_col = vec3f(0.92, 0.18, 0.28);

  if (kind < 0.5) {
    // Daisy — white + yellow center
    petals = 10.0; petal_amp = 0.28; petal_base = 0.62;
    petal_col = vec3f(0.96, 0.96, 0.94);
    center_col = vec3f(0.95, 0.78, 0.12);
    center_r = 0.28;
  } else if (kind < 1.5) {
    // Buttercup — yellow cup
    petals = 5.0; petal_amp = 0.35; petal_base = 0.58;
    petal_col = vec3f(0.95, 0.82, 0.12);
    center_col = vec3f(0.85, 0.55, 0.08);
    center_r = 0.18;
  } else if (kind < 2.5) {
    // Poppy — bold red/orange
    petals = 4.0; petal_amp = 0.48; petal_base = 0.55;
    petal_col = mix(vec3f(0.85, 0.12, 0.10), vec3f(0.92, 0.35, 0.08), fract(phase * 1.7));
    center_col = vec3f(0.12, 0.08, 0.06);
    center_r = 0.16;
  } else if (kind < 3.5) {
    // Bluebell — hanging blue clusters (oval + lobes)
    petals = 6.0; petal_amp = 0.22; petal_base = 0.48;
    petal_col = mix(vec3f(0.35, 0.42, 0.85), vec3f(0.55, 0.35, 0.78), fract(phase));
    center_col = vec3f(0.55, 0.45, 0.75);
    center_r = 0.12;
  } else if (kind < 4.5) {
    // Lavender — tall purple spike (vertical ovals)
    let spike = 1.0 - smoothstep(0.35, 0.85, abs(u) / max(0.15 + (1.0 - abs(v)) * 0.35, 0.05));
    let buds = smoothstep(0.15, 0.0, abs(fract((v + 1.0) * 4.5 + phase) - 0.5) - 0.12);
    mask = spike * (0.55 + 0.45 * buds) * smoothstep(-1.05, -0.2, v) * smoothstep(1.05, 0.15, v);
    col = mix(vec3f(0.42, 0.22, 0.62), vec3f(0.62, 0.38, 0.78), buds);
    if (mask < 0.12) { discard; }
    let L = normalize(-frame.sun_dir);
    let ndl = 0.55 + 0.45 * max(dot(normalize(vec3f(u, 0.4, 0.8)), L), 0.0);
    return vec4f(col * ndl, clamp(mask, 0.0, 1.0));
  } else if (kind < 5.5) {
    // Clover / tiny meadow bloom
    petals = 3.0; petal_amp = 0.4; petal_base = 0.5;
    petal_col = mix(vec3f(0.92, 0.55, 0.72), vec3f(0.95, 0.95, 0.92), step(0.5, fract(phase * 3.1)));
    center_col = vec3f(0.85, 0.75, 0.2);
    center_r = 0.2;
  } else if (kind < 6.5) {
    // Desert bloom — warm orange
    petals = 6.0; petal_amp = 0.38; petal_base = 0.55;
    petal_col = mix(vec3f(0.92, 0.55, 0.12), vec3f(0.95, 0.78, 0.2), fract(phase * 2.2));
    center_col = vec3f(0.75, 0.35, 0.1);
    center_r = 0.2;
  } else if (kind < 7.5) {
    // Snowdrop — white nodding
    petals = 3.0; petal_amp = 0.3; petal_base = 0.5;
    petal_col = vec3f(0.94, 0.95, 0.97);
    center_col = vec3f(0.75, 0.82, 0.55);
    center_r = 0.14;
  } else {
    // Marsh lily — pale pink / cream
    petals = 5.0; petal_amp = 0.4; petal_base = 0.58;
    petal_col = mix(vec3f(0.95, 0.72, 0.82), vec3f(0.95, 0.9, 0.7), fract(phase * 1.3));
    center_col = vec3f(0.9, 0.7, 0.2);
    center_r = 0.2;
  }

  let petal_r = petal_base + petal_amp * cos(ang * petals + phase * 2.0);
  mask = 1.0 - smoothstep(petal_r, petal_r + 0.12, r);
  // Soft gaps between petals
  let gap = abs(sin(ang * petals * 0.5 + phase));
  mask *= 0.75 + 0.25 * smoothstep(0.15, 0.55, gap);
  let core = 1.0 - smoothstep(center_r * 0.6, center_r + 0.05, r);
  col = mix(petal_col, center_col, core);
  // Subtle shading
  col *= 0.75 + 0.25 * (1.0 - r * 0.5);
  col *= 0.9 + 0.1 * sin(frame.time * 1.2 + phase);
  if (mask < 0.08) { discard; }
  let L = normalize(-frame.sun_dir);
  let nrm = normalize(vec3f(u * 0.8, 0.6, 0.7));
  let ndl = 0.5 + 0.5 * max(dot(nrm, L), 0.0);
  var rgb = col * frame.light_col * (frame.amb + ndl * 0.65);
  rgb += env_irradiance(nrm) * col * 0.2;
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(2.5)), clamp(mask, 0.0, 1.0));
}



// Build pieces — wood volumes + Rust-like blue ghost
struct BuildIn {
  @location(0) pos : vec3f,
  @location(1) nrm : vec3f,
  @location(2) col : vec3f, // tint; ghost uses .x as ok flag (1/0)
  @location(3) uv : vec2f,  // face UV 0..1
};
struct BuildOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
  @location(1) nrm : vec3f,
  @location(2) col : vec3f,
  @location(3) uv : vec2f,
};
@vertex fn vs_build(input : BuildIn) -> BuildOut {
  var o : BuildOut;
  o.clip = frame.view_proj * vec4f(input.pos, 1.0);
  o.world = input.pos;
  o.nrm = normalize(input.nrm);
  o.col = input.col;
  o.uv = input.uv;
  return o;
}

fn wood_grain(world : vec3f, nrm : vec3f) -> vec3f {
  let an = abs(nrm);
  let tw = an / max(an.x + an.y + an.z, 1e-4);
  let top = tw.y > 0.55;
  // Top: plank floor. Sides/posts: vertical log bark grain
  var along = select(world.y, world.x, top);
  var across = select(world.x * tw.z + world.z * tw.x + world.y * (1.0 - tw.y), world.z, top);

  let plank_scale = select(3.4, 1.55, top);
  let plank_n = floor(across * plank_scale + along * 0.01);
  let plank_v = fract(across * plank_scale);
  let seam = smoothstep(0.0, 0.06, plank_v) * smoothstep(1.0, 0.94, plank_v);
  let seam_dark = mix(select(0.55, 0.38, top), 1.0, seam);

  let g0 = biome_value_noise(vec2f(along * 0.85, across * 2.8 + plank_n * 1.9));
  let g1 = biome_value_noise(vec2f(along * 3.6 + 2.1, across * 10.5));
  let g2 = biome_value_noise(vec2f(along * 12.0, across * 1.2 + plank_n));
  let fiber = 0.5 + 0.5 * sin(along * select(14.0, 9.0, top) + g0 * 6.0);
  let grain = 0.48 + 0.32 * g0 + 0.16 * g1 + 0.12 * fiber + 0.08 * g2;

  let kcell = floor(vec2f(along, across) * select(0.45, 0.22, top));
  let kn = biome_value_noise(kcell * 2.4 + vec2f(3.1, 8.7));
  var knot = 0.0;
  if (kn > 0.76) {
    let kp = fract(vec2f(along, across) * select(0.45, 0.22, top)) - 0.5;
    let kd = length(kp * vec2f(1.1, 1.3));
    knot = smoothstep(0.22, 0.04, kd) * (kn - 0.76) * 3.2;
  }

  // Richer pine palette
  let light = vec3f(0.78, 0.58, 0.34);
  let mid = vec3f(0.52, 0.34, 0.17);
  let dark = vec3f(0.26, 0.15, 0.07);
  var wood = mix(dark, mid, clamp(grain, 0.0, 1.0));
  wood = mix(wood, light, clamp((grain - 0.48) * 1.7, 0.0, 1.0));
  wood *= seam_dark;
  wood = mix(wood, vec3f(0.12, 0.07, 0.03), clamp(knot, 0.0, 0.92));
  // Pore / micro-variation
  wood *= 0.86 + 0.18 * biome_value_noise(vec2f(along, across) * 6.5);
  if (top) {
    wood = mix(wood, wood * vec3f(1.12, 1.02, 0.9), 0.4);
  } else {
    // Posts slightly darker / greener-brown
    wood *= vec3f(0.92, 0.88, 0.82);
  }
  return wood;
}

@fragment fn fs_build(input : BuildOut) -> @location(0) vec4f {
  var nrm = normalize(input.nrm);
  let L = normalize(-frame.sun_dir);
  let ndl = max(dot(nrm, L), 0.0);
  let wrap = ndl * 0.55 + 0.45;
  let sh = mix(1.0, shadow_factor(input.world, nrm, L), 0.55);
  let hemi = 0.2 + 0.55 * max(nrm.y, 0.0);
  var col = wood_grain(input.world, nrm);
  col = mix(col, input.col, 0.08);
  let e = min(min(input.uv.x, 1.0 - input.uv.x), min(input.uv.y, 1.0 - input.uv.y));
  col *= 0.72 + 0.28 * smoothstep(0.0, 0.08, e);
  // Soft specular highlight along grain
  let H = normalize(L + normalize(frame.eye - input.world));
  let spec = pow(max(dot(nrm, H), 0.0), 48.0) * 0.12;
  var lit = col * (frame.amb * 1.1 + wrap * 0.95 * sh) * max(frame.light_col, vec3f(0.3));
  lit += col * hemi * 0.38;
  lit += env_irradiance(nrm) * col * 0.16;
  lit += vec3f(spec) * vec3f(1.0, 0.92, 0.8);
  lit = apply_fog(lit, input.world);
  return vec4f(clamp(lit, vec3f(0.0), vec3f(2.4)), 1.0);
}

@fragment fn fs_build_ghost(input : BuildOut) -> @location(0) vec4f {
  // Hologram: X-brace + Fresnel rim + time pulse (AAA placement feedback)
  let uv = input.uv;
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let border = 1.0 - smoothstep(0.04, 0.09, edge);
  let d1 = abs(uv.x - uv.y);
  let d2 = abs(uv.x + uv.y - 1.0);
  let cross = 1.0 - smoothstep(0.035, 0.075, min(d1, d2));
  let brace = max(border, cross);
  let ok = input.col.x > 0.5;
  let base_ok = vec3f(0.08, 0.55, 1.0);
  let base_bad = vec3f(1.0, 0.22, 0.12);
  let hi_ok = vec3f(0.35, 0.78, 1.0);
  let hi_bad = vec3f(1.0, 0.45, 0.28);
  var rgb = select(base_bad, base_ok, ok);
  let hi = select(hi_bad, hi_ok, ok);
  let nrm = normalize(input.nrm);
  let V = normalize(frame.eye - input.world);
  let fres = pow(1.0 - clamp(dot(nrm, V), 0.0, 1.0), 2.4);
  let pulse = 0.5 + 0.5 * sin(frame.time * 3.8);
  rgb = mix(rgb, hi, max(brace * 0.65, fres * 0.55));
  var a = mix(0.38, 0.88, max(brace, fres * 0.72));
  a *= 0.82 + 0.18 * pulse;
  let L = normalize(-frame.sun_dir);
  let shade = 0.75 + 0.25 * max(dot(nrm, L), 0.0);
  rgb *= shade;
  rgb = rgb * 1.12 + hi * (0.06 + fres * 0.1);
  return vec4f(rgb, a);
}
@fragment fn fs_shadow_build(input : BuildOut) {}

// Rocks — solid volumetric stones. corner.xy+lz = local mesh position (already shaped).
// rdata: kind, scale, yaw, phase
struct RockIn {
  @location(0) base : vec3f,
  @location(1) corner : vec2f,
  @location(2) rdata : vec4f,
  @location(3) lz : f32,
};
struct RockOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
  @location(1) rdata : vec4f,
  @location(2) world : vec3f,
  @location(3) nrm : vec3f,
};
@vertex fn vs_rock(input : RockIn) -> RockOut {
  var o : RockOut;
  let yaw = input.rdata.z;
  let local = vec3f(input.corner.x, input.corner.y, input.lz);
  let ca = cos(yaw);
  let sa = sin(yaw);
  let world = vec3f(
    input.base.x + ca * local.x + sa * local.z,
    input.base.y + local.y,
    input.base.z - sa * local.x + ca * local.z,
  );
  // Smooth volume normal from local offset (mesh is a filled boulder)
  let nlen = length(local);
  var nloc = select(vec3f(0.0, 1.0, 0.0), local / nlen, nlen > 1e-4);
  // Bias upward so tops catch light; keep sides readable
  nloc = normalize(nloc + vec3f(0.0, 0.15, 0.0));
  let nrm = normalize(vec3f(ca * nloc.x + sa * nloc.z, nloc.y, -sa * nloc.x + ca * nloc.z));
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.uv = vec2f(atan2(local.z, local.x) * 0.3183 + 0.5, clamp(local.y / max(nlen, 0.01), 0.0, 1.2));
  o.rdata = input.rdata;
  o.world = world;
  o.nrm = nrm;
  return o;
}
@fragment fn fs_rock(input : RockOut) -> @location(0) vec4f {
  // kind: 0 = piedra (matte grey), 1 = metal (rusty + blue crystal veins), 2 = azufre (pale + yellow)
  let kind = input.rdata.x;
  let phase = input.rdata.w;
  let v = clamp(input.uv.y, 0.0, 1.2);

  var n_smooth = normalize(input.nrm);
  var n_geo = normalize(cross(dpdx(input.world), dpdy(input.world)));
  if (dot(n_geo, n_smooth) < 0.0) { n_geo = -n_geo; }
  var nrm = normalize(mix(n_smooth, n_geo, select(0.42, 0.22, kind > 1.5)));

  let nw = abs(n_smooth);
  let tw = nw * nw;
  let tws = max(tw.x + tw.y + tw.z, 1e-4);
  let twN = tw / tws;

  let p = input.world * 1.8 + vec3f(phase * 5.0, phase * 2.0, -phase * 3.0);
  let xz = p.xz;
  let xy = p.xy + vec2f(11.0, -5.0);
  let zy = p.zy + vec2f(-7.0, 4.0);

  let a0 = biome_fbm(xz * 0.55) * twN.y + biome_fbm(xy * 0.55) * twN.z + biome_fbm(zy * 0.55) * twN.x;
  let a1 = biome_fbm(xz * 1.9) * twN.y + biome_fbm(xy * 1.9) * twN.z + biome_fbm(zy * 1.9) * twN.x;
  let g0 = biome_value_noise(xz * 7.5) * twN.y + biome_value_noise(xy * 7.5) * twN.z + biome_value_noise(zy * 7.5) * twN.x;
  let g1 = biome_value_noise(xz * 19.0) * twN.y + biome_value_noise(xy * 19.0) * twN.z + biome_value_noise(zy * 19.0) * twN.x;

  // Crack / fissure mask (diagonal gashes like Rust ore)
  let crack_n = biome_fbm(xz * 3.4 + vec2f(a0, a1) * 0.8);
  let crack_n2 = biome_fbm(xy * 4.1 - vec2f(a1, g0) * 0.6);
  let ridge = abs(crack_n * 2.0 - 1.0);
  let ridge2 = abs(crack_n2 * 2.0 - 1.0);
  let vein = smoothstep(0.18, 0.02, min(ridge, ridge2 * 0.95 + 0.05));
  let vein_core = smoothstep(0.08, 0.0, min(ridge, ridge2));
  let cavity = smoothstep(0.35, 0.85, 1.0 - (a1 * 0.55 + g0 * 0.45));

  let cell_u = fract(xz * 2.6 + vec2f(a0, a1) * 0.4);
  let cell = smoothstep(0.4, 0.1, length(cell_u - 0.5));

  let h_bump = a0 * 0.35 + a1 * 0.4 + g0 * 0.3 + vein * 0.55 + cavity * 0.2;
  let dPdx = dpdx(input.world);
  let dPdy = dpdy(input.world);
  nrm = normalize(nrm - (dpdx(h_bump) * dPdx + dpdy(h_bump) * dPdy) * select(2.4, 1.6, kind < 0.5));

  let tone = clamp(0.4 + a0 * 0.4 + a1 * 0.3 + g0 * 0.2, 0.0, 1.0);
  let tone_s = smoothstep(0.15, 0.9, tone);

  var col = vec3f(0.42, 0.43, 0.45);
  var gloss = 0.05;
  var metal_amt = 0.0;
  var sparkle = 0.0;

  if (kind < 0.5) {
    // PIEDRA — dark matte grey, sharp facets, no veins
    let hi = vec3f(0.52, 0.54, 0.57);
    let lo = vec3f(0.18, 0.19, 0.21);
    col = mix(hi, lo, tone_s);
    col = mix(col, lo * 0.7, cavity * 0.35);
    col *= 0.85 + 0.15 * g0;
    gloss = 0.04 + smoothstep(0.92, 0.99, g1) * 0.06;
  } else if (kind < 1.5) {
    // METAL — rusty brown clay + blue-silver crystal veins (shiny)
    let hi = vec3f(0.62, 0.42, 0.26);
    let lo = vec3f(0.28, 0.16, 0.10);
    col = mix(hi, lo, tone_s);
    col = mix(col, lo * 0.65, cavity * 0.4);
    let crystal = vec3f(0.55, 0.72, 0.92);
    let crystal_hi = vec3f(0.78, 0.88, 1.0);
    let ore = mix(crystal, crystal_hi, vein_core);
    col = mix(col, ore, vein * 0.92);
    metal_amt = vein * 0.95;
    gloss = 0.08 + vein * 0.72;
    // Crystal sparkle — angle + time twinkle
    let twinkle = 0.55 + 0.45 * sin(frame.time * 4.2 + phase * 12.0 + a0 * 20.0);
    sparkle = vein_core * twinkle * (0.55 + 0.45 * cell);
  } else {
    // AZUFRE — pale rock + yellow in crevices (Rust). Day: keep rock readable, not neon slab.
    let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
    let night = 1.0 - day;
    let hi = vec3f(0.70, 0.64, 0.50);
    let lo = vec3f(0.36, 0.32, 0.24);
    col = mix(hi, lo, tone_s);
    col = mix(col, lo * 0.72, cavity * 0.35);
    // Yellow mostly in pits/veins — rock body stays visible by day
    let sulfur = mix(vec3f(0.98, 0.88, 0.14), vec3f(0.86, 0.70, 0.08), day * 0.45);
    let sulfur_hot = mix(vec3f(1.0, 0.95, 0.32), vec3f(0.95, 0.82, 0.18), day * 0.4);
    let yel = mix(sulfur, sulfur_hot, vein_core * 0.55 + cell * 0.35);
    let yel_m = max(cavity * 0.72, vein * 0.88) * (0.55 + night * 0.35 + day * 0.2);
    col = mix(col, yel, yel_m);
    let blotch = smoothstep(0.62, 0.92, a1) * smoothstep(0.45, 0.85, g0);
    col = mix(col, sulfur_hot, blotch * (0.28 + night * 0.25));
    // Day: grit + AO so it doesn't look like a flat yellow pancake
    col *= 0.82 + 0.18 * g0;
    col *= mix(1.0, 0.88 + 0.12 * max(n_smooth.y, 0.0), day);
    gloss = 0.05 + yel_m * (0.22 + night * 0.2);
    let twinkle = 0.5 + 0.5 * sin(frame.time * 3.1 + phase * 9.0 + g1 * 30.0);
    sparkle = yel_m * vein_core * twinkle * (0.45 + night * 0.5);
  }

  col *= 0.74 + 0.26 * max(dot(nrm, n_smooth), 0.0);
  col *= 0.8 + 0.2 * max(n_smooth.y * 0.55 + 0.45, 0.25);

  let L = normalize(-frame.sun_dir);
  let ndl = max(dot(nrm, L), 0.0);
  let wrap = ndl * 0.72 + 0.28;
  let sh = mix(1.0, shadow_factor(input.world, nrm, L), 0.7);
  let hemi = 0.22 + 0.55 * max(nrm.y, 0.0);
  let V = normalize(frame.eye - input.world);
  let H = normalize(L + V);
  let spec_pow = mix(14.0, 64.0, gloss);
  var spec = pow(max(dot(nrm, H), 0.0), spec_pow) * gloss * sh * max(ndl, 0.15);

  // Metal / crystal: fresnel edge + blue highlight
  if (metal_amt > 0.01) {
    let fres = pow(1.0 - max(dot(nrm, V), 0.0), 3.0);
    spec += fres * metal_amt * 0.55 * sh;
    col = mix(col, vec3f(0.65, 0.78, 0.95), metal_amt * fres * 0.35);
  }
  spec += sparkle * (0.9 + 0.6 * pow(max(dot(nrm, H), 0.0), 80.0));

  var lit = col * (frame.amb * 0.85 + wrap * 0.95 * sh) * max(frame.light_col, vec3f(0.36));
  lit += col * hemi * 0.28;
  let env_c = env_irradiance(nrm);
  let env_l = dot(env_c, vec3f(0.299, 0.587, 0.114));
  lit += mix(vec3f(env_l), env_c, 0.2 + metal_amt * 0.5) * col * (0.12 + metal_amt * 0.25);
  lit += vec3f(spec) * max(frame.light_col, vec3f(0.5)) * (0.55 + metal_amt * 0.9 + sparkle * 1.2);
  // Sulfur emissive hint — stronger at night, subtle by day
  if (kind > 1.5) {
    let dayS = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
    lit += vec3f(0.32, 0.26, 0.02) * sparkle * mix(0.55, 0.18, dayS);
  }
  lit = apply_fog(lit, input.world);
  return vec4f(clamp(lit, vec3f(0.0), vec3f(3.2)), 1.0);
}

@fragment fn fs_shadow_rock(input : RockOut) {}


struct TreeIn {
  @location(0) base : vec3f,     // part origin (root / branch start / puff center)
  @location(1) corner : vec2f,   // trunk/branch: x=-1..1 y=0..1; canopy: x,y=-1..1
  @location(2) tdata : vec4f,    // species, scale, yaw, phase
  @location(3) part_x : f32,     // part*10 + cross (0 trunk, 1 branch, 2 canopy, 3 pine tier)
};
struct TreeOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
  @location(1) tdata : vec4f,
  @location(2) world : vec3f,
  @location(3) part_w : f32,     // part id 0..3
};

@vertex fn vs_tree(input : TreeIn) -> TreeOut {
  var o : TreeOut;
  let species = input.tdata.x;
  let scale = input.tdata.y;
  let yaw = input.tdata.z;
  let phase = input.tdata.w;
  let part = floor(input.part_x * 0.1);
  let cross_i = input.part_x - part * 10.0;
  let ang = yaw + cross_i * 1.04719755; // 60° crosses — enough volume, less clutter
  let ca = cos(ang);
  let sa = sin(ang);
  let sway = sin(frame.time * (0.45 + phase * 0.4) + phase * 6.28) * 0.14 * scale;

  var world = input.base;
  var uv = input.corner;

  if (part < 0.5) {
    // TRUNK
    let t = input.corner.y;
    var trunk_h = 3.0 * scale;
    var half0 = 0.28;
    var half1 = 0.12;
    if (species > 0.5 && species < 1.5) { trunk_h = 2.4 * scale; half0 = 0.20; half1 = 0.08; } // pine
    else if (species > 5.5 && species < 6.5) { trunk_h = 2.6 * scale; half0 = 0.22; half1 = 0.09; } // snow fir
    else if (species > 1.5 && species < 2.5) { trunk_h = 3.1 * scale; half0 = 0.24; half1 = 0.10; } // maple
    else if (species > 2.5 && species < 3.5) { trunk_h = 3.15 * scale; half0 = 0.34; half1 = 0.12; } // willow
    else if (species > 3.5 && species < 4.5) { trunk_h = 1.5 * scale; half0 = 0.14; half1 = 0.06; } // scrub
    else if (species > 4.5 && species < 5.5) { trunk_h = 2.5 * scale; half0 = 0.26; half1 = 0.20; } // cactus
    else if (species > 6.5 && species < 7.5) { trunk_h = 3.45 * scale; half0 = 0.15; half1 = 0.055; } // birch slender
    else if (species > 7.5 && species < 8.5) { trunk_h = 4.35 * scale; half0 = 0.17; half1 = 0.06; } // poplar tall
    else if (species > 8.5 && species < 9.5) { trunk_h = 2.85 * scale; half0 = 0.26; half1 = 0.11; } // cedar
    else if (species > 9.5 && species < 10.5) { trunk_h = 3.8 * scale; half0 = 0.22; half1 = 0.16; } // palm
    else { trunk_h = 3.05 * scale; half0 = 0.36; half1 = 0.14; } // oak
    let flare = mix(1.45, 1.0, smoothstep(0.0, 0.2, t));
    let half_w = mix(half0, half1, pow(t, 0.9)) * scale * flare;
    let lean = (phase - 0.5) * 0.08 * t * trunk_h;
    let lx = input.corner.x * half_w;
    world = vec3f(
      input.base.x + ca * lx + lean * ca,
      input.base.y + t * trunk_h,
      input.base.z + sa * lx + lean * sa,
    );
    uv = vec2f(input.corner.x, t);
  } else if (part < 1.5) {
    // BRANCH — thick short wood (not needle sticks)
    let t = input.corner.y;
    var len = mix(0.9, 1.45, fract(phase + cross_i * 0.2)) * scale;
    var lift = 0.48 + 0.2 * fract(phase * 2.7 + cross_i);
    var half_w = mix(0.11, 0.035, pow(t, 0.65)) * scale;
    if (species > 1.5 && species < 2.5) { // maple
      len *= 0.9; half_w *= 0.95;
    } else if (species > 2.5 && species < 3.5) { // willow: long droop
      len *= 1.25; lift = 0.25 - t * 0.55;
    } else if (species > 3.5 && species < 4.5) {
      len *= 0.65; half_w *= 0.8;
    } else if (species > 6.5 && species < 7.5) { // birch
      len *= 0.85; half_w *= 0.75;
    } else if (species > 7.5 && species < 8.5) { // poplar upright
      len *= 0.7; lift = 0.72 + 0.1 * fract(phase * 2.7); half_w *= 0.7;
    } else if (species > 9.5 && species < 10.5) { // palm frond arms
      len *= 1.35; lift = 0.15 - t * 0.35; half_w *= 0.55;
    }
    let along = t * len;
    let lx = input.corner.x * half_w;
    world = vec3f(
      input.base.x + ca * 0.9 * along + (-sa) * lx,
      input.base.y + lift * along + sway * t * 0.25,
      input.base.z + sa * 0.9 * along + ca * lx,
    );
    uv = vec2f(input.corner.x, t);
  } else if (part < 2.5) {
    // CANOPY puff — irregular ellipsoid (less cookie / more leaf cloud)
    var rad_x = mix(0.9, 1.35, fract(phase * 2.1 + cross_i * 0.11)) * scale;
    var rad_y = rad_x * mix(0.72, 1.05, fract(phase * 3.7 + cross_i * 0.19));
    if (species < 0.5) { rad_x *= 1.38; rad_y *= 1.18; } // oak fuller crown
    else if (species > 1.5 && species < 2.5) { rad_x *= 1.08; rad_y *= 1.02; } // maple
    else if (species > 2.5 && species < 3.5) {
      rad_x *= 0.88;
      rad_y *= 1.2;
    }
    else if (species > 3.5 && species < 4.5) { rad_x *= 0.75; rad_y *= 0.58; } // scrub low
    else if (species > 6.5 && species < 7.5) { rad_x *= 0.95; rad_y *= 1.12; } // birch oval
    else if (species > 7.5 && species < 8.5) { rad_x *= 0.55; rad_y *= 1.55; } // poplar column
    else if (species > 9.5 && species < 10.5) { rad_x *= 1.45; rad_y *= 0.42; } // palm frond disc
    else if ((species > 0.5 && species < 1.5) || (species > 5.5 && species < 6.5) || (species > 8.5 && species < 9.5)) {
      // Pine / fir / cedar canopy discs — flatter layers for conical stack
      rad_x *= 1.15;
      rad_y *= 0.55;
    }
    let depth = (cross_i - 1.5) * 0.14 * scale;
    var lx = input.corner.x * rad_x + sway * 0.3;
    var ly = input.corner.y * rad_y;
    // Hang strips (phase > 0.7): stretch down without swallowing the trunk
    if (species > 2.5 && species < 3.5 && phase > 0.7) {
      let hx = rad_x * 0.55;
      let hy = rad_y * 1.45;
      lx = input.corner.x * hx + sway * 0.35;
      ly = input.corner.y * hy * 0.9 - hy * 0.45;
    }
    world = vec3f(
      input.base.x + ca * lx - sa * depth,
      input.base.y + ly,
      input.base.z + sa * lx + ca * depth,
    );
    uv = input.corner;
  } else {
    // FIR / PINE tip accent — compact soft diamond (not tall shard skirts)
    let tier = fract(phase * 7.0);
    let is_tip = step(0.82, tier);
    var crown_h = mix(0.55, 0.85, is_tip) * scale;
    var crown_w = mix(1.15, 0.4, pow(tier, 0.85)) * scale;
    if (species > 5.5 && species < 6.5) { crown_w *= 0.9; crown_h *= 1.05; }
    else if (species > 8.5 && species < 9.5) { crown_w *= 1.1; crown_h *= 0.95; }
    let vt = (input.corner.y + 1.0) * 0.5;
    let taper = mix(1.0, mix(0.45, 0.28, is_tip), pow(vt, 0.75));
    let droop = -pow(vt, 1.2) * mix(0.18, 0.1, is_tip) * crown_w;
    let lx = input.corner.x * crown_w * 0.5 * taper;
    let ly = vt * crown_h + droop;
    world = vec3f(
      input.base.x + ca * lx + sway * vt * 0.25,
      input.base.y + ly,
      input.base.z + sa * lx,
    );
    uv = input.corner;
  }

  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.uv = uv;
  o.tdata = input.tdata;
  o.world = world;
  o.part_w = part;
  return o;
}

@fragment fn fs_tree(input : TreeOut) -> @location(0) vec4f {
  let species = input.tdata.x;
  let phase = input.tdata.w;
  let part = input.part_w;
  let u = input.uv.x;
  let v = input.uv.y;
  let nUV = vec2f(u * 3.5 + phase * 5.0, v * 4.5 + phase * 2.5);
  let n1 = biome_value_noise(nUV);
  let n2 = biome_value_noise(nUV * 2.2 + vec2f(1.1, phase));
  let n3 = biome_fbm(nUV * 1.1);
  let leafN = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  let ang = atan2(v, u);

  var mask = 0.0;
  var col = vec3f(0.22, 0.14, 0.07); // brown default (never leaf-green)
  var is_leaf = 0.0;

  // Interior flutter only — never shift the silhouette mask (that sparkles vs sky).
  let flutter = sin(frame.time * (1.1 + phase * 0.7) + phase * 6.28 + u * 4.0) * 0.04;

  if (part < 0.5) {
    let flare = mix(1.18, 0.94, smoothstep(0.0, 0.25, v));
    let taper = mix(0.98, 0.62, pow(v, 0.82)) * flare;
    // Soft bark edge (less cardboard cutout)
    mask = 1.0 - smoothstep(taper - 0.02, taper + 0.09, abs(u));
    let bark = biome_value_noise(vec2f(u * 14.0, v * 38.0 + phase * 7.0));
    let grain = biome_value_noise(vec2f(u * 4.2, v * 96.0));
    let plate = biome_value_noise(vec2f(u * 2.4 + phase, v * 9.0));
    let crack = smoothstep(0.55, 0.88, biome_value_noise(vec2f(u * 2.2 + phase, v * 18.0)));
    let moss = smoothstep(0.55, 0.92, n3) * (1.0 - v) * (1.0 - abs(u) * 0.5);
    if (species > 1.5 && species < 2.5) {
      col = mix(vec3f(0.32, 0.18, 0.09), vec3f(0.12, 0.07, 0.035), bark * 0.65 + grain * 0.35);
      col = mix(col, col * 0.5, crack * 0.6);
    } else if (species > 4.5 && species < 5.5) {
      col = mix(vec3f(0.28, 0.52, 0.24), vec3f(0.16, 0.36, 0.14), bark);
      let rib = pow(abs(sin(u * 14.0 + phase)), 0.4);
      col = mix(col * 0.75, col * 1.12, rib);
    } else if ((species > 0.5 && species < 1.5) || (species > 5.5 && species < 6.5) || (species > 8.5 && species < 9.5)) {
      col = mix(vec3f(0.3, 0.17, 0.09), vec3f(0.1, 0.055, 0.03), bark * 0.7 + grain * 0.3);
      col = mix(col, col * 0.52, crack * 0.55);
      // Plate scales on pine/cedar bark
      col *= 0.88 + 0.14 * smoothstep(0.35, 0.75, plate);
      if (species > 8.5 && species < 9.5) {
        col = mix(col, vec3f(0.22, 0.14, 0.08), 0.35);
      }
    } else if (species > 3.5 && species < 4.5) {
      col = mix(vec3f(0.42, 0.30, 0.14), vec3f(0.22, 0.14, 0.07), bark);
    } else if (species > 6.5 && species < 7.5) {
      // Birch — cool grey-white bark (not cream that picks up grass bounce)
      col = mix(vec3f(0.62, 0.60, 0.56), vec3f(0.38, 0.36, 0.34), bark * 0.5 + grain * 0.2);
      let bands = smoothstep(0.55, 0.9, biome_value_noise(vec2f(u * 1.2, v * 42.0 + phase)));
      col = mix(col, vec3f(0.14, 0.12, 0.10), bands * 0.82);
      col *= 0.92 + 0.08 * (1.0 - abs(u));
    } else if (species > 7.5 && species < 8.5) {
      // Poplar — grey-brown bark (was grey-green → read as neon trunks)
      col = mix(vec3f(0.40, 0.34, 0.26), vec3f(0.18, 0.14, 0.10), bark * 0.55 + grain * 0.3);
    } else if (species > 9.5 && species < 10.5) {
      // Palm — fibrous tan trunk
      col = mix(vec3f(0.55, 0.40, 0.18), vec3f(0.28, 0.18, 0.08), bark * 0.5 + grain * 0.5);
      let ring = pow(abs(sin(v * 48.0 + bark * 2.0)), 0.55);
      col *= 0.82 + 0.2 * ring;
    } else {
      // Oak / willow — deep brown bark (no yellow wash)
      col = mix(vec3f(0.28, 0.16, 0.08), vec3f(0.08, 0.045, 0.025), bark * 0.5 + grain * 0.5);
      col = mix(col, col * 0.42, crack * 0.75);
      let furrow = pow(abs(sin(u * 26.0 + bark * 4.0 + plate * 2.0)), 0.5);
      col *= 0.78 + 0.22 * furrow;
      // Horizontal check cracks (oak)
      let hcrack = smoothstep(0.72, 0.95, biome_value_noise(vec2f(u * 1.5, v * 55.0 + phase)));
      col *= 1.0 - hcrack * 0.28;
      // Subtle moss only — strong green was reading as neon bark
      col = mix(col, vec3f(0.14, 0.18, 0.09), moss * 0.22);
    }
    // Root flare darker + wet base
    col *= 0.52 + 0.48 * smoothstep(0.0, 0.18, v);
    col *= 0.92 + 0.08 * (1.0 - abs(u));
  } else if (part < 1.5) {
    let tw = mix(0.92, 0.38, pow(v, 0.7));
    mask = 1.0 - smoothstep(tw - 0.02, tw + 0.11, abs(u));
    let bark = biome_value_noise(vec2f(u * 10.0, v * 22.0 + phase));
    if (species > 6.5 && species < 7.5) {
      col = mix(vec3f(0.58, 0.56, 0.52), vec3f(0.28, 0.26, 0.24), bark);
    } else if (species > 7.5 && species < 8.5) {
      col = mix(vec3f(0.38, 0.32, 0.24), vec3f(0.16, 0.12, 0.09), bark);
    } else {
      col = mix(vec3f(0.34, 0.20, 0.09), vec3f(0.14, 0.08, 0.035), bark);
    }
    col *= 0.85 + 0.15 * (1.0 - v);
  } else if (part < 2.5) {
    // Leaf-cluster canopy — soft lobed mass with rim cutouts (not a green cookie)
    is_leaf = 1.0;
    let under = smoothstep(-0.2, 0.75, -v);
    // Stable UV for mask/gaps; flutter only on micro color so edges stay clean
    let leafClump = biome_value_noise(nUV * 2.4 + vec2f(1.7, phase));
    let leafFine = biome_value_noise(nUV * 11.0);
    let leafMicro = biome_value_noise(nUV * 6.2 + vec2f(phase * 3.0 + flutter * 6.0, 0.7 + flutter * 2.0));
    if (species > 2.5 && species < 3.5) {
      let hang = step(0.7, phase);
      let rx = mix(1.05, 1.55, hang);
      let ry = mix(1.12, 0.7, hang);
      let r = length(vec2f(u * rx, (v + hang * 0.25) * ry));
      let lobes = 0.1 * sin(ang * 3.0 + phase * 4.0) + 0.05 * sin(ang * 5.5 - phase);
      let edge_r = mix(0.82, 0.76, hang) + lobes * 0.6;
      mask = 1.0 - smoothstep(edge_r - 0.06, edge_r + 0.16, r);
      let rim = smoothstep(edge_r - 0.28, edge_r + 0.02, r);
      mask *= 1.0 - rim * (1.0 - smoothstep(0.2, 0.65, leafClump)) * 0.55;
      if (hang > 0.5) {
        mask *= smoothstep(1.05, 0.12, -v) * (1.0 - smoothstep(0.5, 0.95, abs(u)));
        // Strand gaps
        mask *= smoothstep(0.15, 0.55, leafFine + abs(u) * 0.3);
      }
      col = mix(vec3f(0.06, 0.16, 0.05), vec3f(0.14, 0.28, 0.09), leafN);
      col = mix(col, vec3f(0.18, 0.32, 0.1), leafMicro * 0.25);
      col *= 0.7 + 0.22 * leafN;
      col *= 0.72 + 0.28 * (1.0 - under * 0.55);
    } else if ((species > 0.5 && species < 1.5) || (species > 5.5 && species < 6.5) || (species > 8.5 && species < 9.5)) {
      // Pine / fir / cedar — soft conical disc layers (not finger shards)
      let r = length(vec2f(u * 1.05, v * 1.55));
      let scallop = 0.06 * sin(ang * 5.0 + phase * 3.0) + 0.03 * sin(ang * 9.0 - leafFine * 2.0);
      let edge_r = 0.78 + scallop + leafClump * 0.05;
      mask = 1.0 - smoothstep(edge_r - 0.16, edge_r + 0.2, r);
      let dens = leafClump * 0.35 + leafMicro * 0.4 + leafFine * 0.25;
      let rim = smoothstep(edge_r - 0.35, edge_r + 0.05, r);
      mask *= mix(1.0, smoothstep(0.18, 0.62, dens), rim * 0.7);
      // Soft needle flecks near rim only
      mask *= 1.0 - smoothstep(0.82, 0.98, leafFine) * rim * 0.35;
      if (species > 5.5 && species < 6.5) {
        col = mix(vec3f(0.08, 0.2, 0.12), vec3f(0.16, 0.34, 0.2), leafN);
        let snow = smoothstep(0.15, 0.85, -v) * (0.35 + 0.45 * n1) * rim;
        col = mix(col, vec3f(0.9, 0.92, 0.95), snow * 0.55);
      } else if (species > 8.5 && species < 9.5) {
        col = mix(vec3f(0.05, 0.14, 0.06), vec3f(0.14, 0.28, 0.1), leafN);
        col = mix(col, vec3f(0.18, 0.3, 0.1), leafMicro * 0.25);
        col *= vec3f(1.04, 0.98, 0.88);
      } else {
        col = mix(vec3f(0.04, 0.12, 0.05), vec3f(0.1, 0.24, 0.08), leafN);
        col = mix(col, vec3f(0.14, 0.3, 0.09), leafMicro * 0.22);
      }
      col *= 0.62 + 0.28 * dens + 0.18 * (1.0 - r);
      col *= 0.75 + 0.25 * (1.0 - under * 0.55);
    } else {
      // Irregular multi-lobe crown — frayed leaf cloud, not green disc
      let squash = mix(0.95, 1.18, fract(phase * 1.9));
      let r = length(vec2f(u, v * squash));
      var lobes = 0.18 * sin(ang * 2.2 + phase * 3.5)
        + 0.11 * sin(ang * 4.7 - phase * 2.0 + n1 * 2.0)
        + 0.07 * sin(ang * 7.5 + n2 * 3.0)
        + 0.04 * sin(ang * 11.0 - leafFine * 4.0);
      if (species < 0.5) { lobes += 0.12 * sin(ang * 1.8 + n1 * 2.5); }
      else if (species > 1.5 && species < 2.5) { lobes += 0.08 * sin(ang * 3.6 + n1); }
      else if (species > 6.5 && species < 7.5) { lobes += 0.1 * sin(ang * 5.0 + n1); }
      else if (species > 7.5 && species < 8.5) { lobes *= 0.45; }
      else if (species > 9.5 && species < 10.5) {
        // Palm fronds — long fingered disc
        lobes = 0.22 * sin(ang * 7.0 + phase) + 0.12 * sin(ang * 13.0);
      }
      let edge_r = select(0.72 + lobes * 0.95 + leafClump * 0.08, 0.78 + lobes * 0.55, species > 9.5 && species < 10.5);
      mask = 1.0 - smoothstep(edge_r - 0.18, edge_r + 0.28, r);
      let dens = leafClump * 0.4 + leafMicro * 0.35 + leafFine * 0.25;
      let rim = smoothstep(edge_r - 0.4, edge_r + 0.06, r);
      mask *= mix(1.0, smoothstep(0.12, 0.58, dens), rim * 0.92);
      let gap = smoothstep(0.72, 0.94, leafFine) * (0.15 + rim * 0.35);
      mask *= 1.0 - gap;
      // Extra bite-outs so silhouette is leafy
      mask *= 1.0 - smoothstep(0.86, 0.99, leafClump) * rim * 0.55;
      if (species > 3.5 && species < 4.5) {
        mask *= smoothstep(0.1, 0.38, dens);
      }
      if (species > 9.5 && species < 10.5) {
        // Radial frond gaps
        mask *= 0.55 + 0.45 * smoothstep(0.2, 0.7, abs(sin(ang * 5.0 + phase * 3.0)));
        mask *= smoothstep(0.05, 0.35, dens + (1.0 - abs(v)) * 0.4);
      }
      if (species < 0.5) {
        // Oak — dark meadow green (match grass carpet)
        col = mix(vec3f(0.03, 0.09, 0.04), vec3f(0.09, 0.22, 0.09), leafN);
        col = mix(col, vec3f(0.12, 0.28, 0.12), leafMicro * 0.3 * (1.0 - under));
        col = mix(col, vec3f(0.05, 0.14, 0.05), leafClump * 0.35);
      } else if (species > 1.5 && species < 2.5) {
        col = mix(vec3f(0.04, 0.12, 0.04), vec3f(0.14, 0.28, 0.08), leafN);
        col = mix(col, vec3f(0.18, 0.34, 0.1), leafMicro * 0.28 * (1.0 - under));
      } else if (species > 3.5 && species < 4.5) {
        is_leaf = 0.55;
        col = mix(vec3f(0.16, 0.15, 0.07), vec3f(0.12, 0.22, 0.08), n2);
      } else if (species > 6.5 && species < 7.5) {
        // Birch — brighter lime canopy
        col = mix(vec3f(0.12, 0.28, 0.08), vec3f(0.28, 0.48, 0.14), leafN);
        col = mix(col, vec3f(0.35, 0.55, 0.18), leafMicro * 0.32 * (1.0 - under));
      } else if (species > 7.5 && species < 8.5) {
        // Poplar — silver-green column
        col = mix(vec3f(0.1, 0.22, 0.1), vec3f(0.22, 0.38, 0.16), leafN);
        col = mix(col, vec3f(0.4, 0.48, 0.32), leafMicro * 0.22);
      } else if (species > 9.5 && species < 10.5) {
        // Palm fronds — warm tropical green
        col = mix(vec3f(0.08, 0.28, 0.06), vec3f(0.22, 0.48, 0.1), leafN);
        col = mix(col, vec3f(0.35, 0.55, 0.12), leafMicro * 0.3);
      } else {
        col = mix(vec3f(0.04, 0.12, 0.04), vec3f(0.12, 0.26, 0.07), leafN);
        col = mix(col, vec3f(0.16, 0.3, 0.08), leafMicro * 0.28);
      }
      let depth = 1.0 - r * 0.55;
      col *= 0.55 + 0.28 * dens + 0.22 * depth;
      col *= 0.65 + 0.35 * (1.0 - under * 0.7);
      col = mix(col, col * vec3f(1.05, 1.08, 0.95), (1.0 - under) * leafMicro * 0.15);
    }
  } else {
    // Fir / pine tip accent — soft filled wedge (legacy part-3 cards)
    is_leaf = 1.0;
    let au = abs(u);
    let vt = clamp((v + 1.0) * 0.5, 0.0, 1.0);
    let tier = fract(phase * 7.0);
    let w = mix(0.95, 0.28, pow(vt, 0.85));
    mask = 1.0 - smoothstep(w - 0.08, w + 0.18, au);
    mask *= smoothstep(-1.05, -0.7, v) * smoothstep(1.08, 0.85, v);
    let needle = biome_value_noise(vec2f(u * 18.0 + v * 8.0, v * 22.0 + phase * 3.0));
    let needleLive = biome_value_noise(vec2f(u * 18.0 + v * 8.0 + flutter * 2.0, v * 22.0 + phase * 3.0));
    mask *= 0.75 + 0.25 * smoothstep(0.2, 0.7, needle);
    if (species > 5.5 && species < 6.5) {
      col = mix(vec3f(0.1, 0.24, 0.15), vec3f(0.2, 0.38, 0.24), leafN);
      let snow = smoothstep(0.28, 0.9, vt) * smoothstep(0.55, 0.1, au) * (0.45 + 0.55 * n1);
      col = mix(col, vec3f(0.93, 0.95, 0.97), snow * 0.55);
    } else if (species > 8.5 && species < 9.5) {
      col = mix(vec3f(0.05, 0.14, 0.06), vec3f(0.14, 0.28, 0.1), leafN);
      col = mix(col, vec3f(0.2, 0.32, 0.1), needleLive * 0.28);
      col *= vec3f(1.05, 0.98, 0.85);
    } else {
      col = mix(vec3f(0.04, 0.12, 0.05), vec3f(0.1, 0.24, 0.08), leafN);
      col = mix(col, vec3f(0.14, 0.3, 0.09), needleLive * 0.22);
    }
    col *= 0.65 + 0.25 * (1.0 - au * 0.35) + 0.14 * vt;
    col *= 0.88 + 0.1 * tier;
  }

  // UV-stable narrow dither — world-space dither crawls when wind sways the tree,
  // and a wide band (mask < 0.62) reads as pixel sparkle against the sky.
  let dither = fract(sin(dot(vec2f(u, v), vec2f(12.9898, 78.233)) + phase * 19.19) * 43758.5453);
  if (mask < 0.14) { discard; }
  if (is_leaf > 0.4) {
    if (mask < 0.34 && dither > smoothstep(0.14, 0.34, mask)) { discard; }
  } else if (mask < 0.28 && dither > smoothstep(0.14, 0.28, mask)) {
    discard;
  }

  var nrm : vec3f;
  if (part < 0.5) {
    nrm = normalize(vec3f(u * 2.8, 0.1 + v * 0.2, 0.9 + (1.0 - abs(u)) * 0.3));
  } else if (part < 1.5) {
    nrm = normalize(vec3f(u * 2.2, 0.25 - v * 0.12, 0.82));
  } else if (part < 2.5) {
    let rr = length(vec2f(u, v));
    let nz = sqrt(max(0.04, 1.0 - rr * rr * 0.88));
    // Stronger dome normal for volume (less flat card)
    nrm = normalize(vec3f(u * 2.1, 0.55 - v * 0.85, nz * 1.15));
  } else {
    nrm = normalize(vec3f(u * 1.6, 0.6 - v * 0.4, 0.8));
  }
  let to_eye = normalize(frame.eye - input.world);
  nrm = normalize(mix(nrm, to_eye, 0.08));
  let L = normalize(-frame.sun_dir);
  let wrap = max(dot(nrm, L) * 0.5 + 0.5, 0.0);
  let hemi = 0.16 + 0.36 * max(nrm.y, 0.0);
  let sh_raw = shadow_factor(input.world, nrm, L);
  let sh = mix(1.0, sh_raw, 0.55);
  // Deep underside AO so crowns read as volumes, not flat sprites
  let self_ao = select(
    mix(0.7, 1.0, abs(u) * 0.3 + v * 0.4),
    mix(0.42, 1.0, clamp(nrm.y * 0.65 + 0.35, 0.0, 1.0)),
    is_leaf > 0.4
  );
  let sun = mix(frame.light_col, vec3f(0.9, 0.95, 1.0) * length(frame.light_col), 0.25) * 0.78;
  var lit = col * (frame.amb * 0.7 + wrap * 0.5 * sh) * sun * self_ao;
  lit += col * hemi * 0.28 * self_ao;
  // Bark: desaturate IBL so green grass bounce doesn't turn trunks neon
  let env_c = env_irradiance(nrm);
  if (is_leaf < 0.5) {
    let env_l = dot(env_c, vec3f(0.299, 0.587, 0.114));
    lit += mix(vec3f(env_l), env_c, 0.28) * col * 0.18 * self_ao;
  } else {
    lit += env_c * col * 0.28 * self_ao;
  }
  if (part < 0.5) {
    let h = normalize(L + to_eye);
    let ndh = max(dot(nrm, h), 0.0);
    lit += sun * pow(ndh, 36.0) * 0.06 * sh * (1.0 - abs(u));
  }
  if (is_leaf > 0.5) {
    // Subtle SSS — match dark grass mood, no neon glow
    let sss = pow(1.0 - max(dot(nrm, to_eye), 0.0), 1.5) * wrap;
    lit += col * vec3f(0.35, 0.55, 0.18) * sss * 0.35 * sh;
    let back = pow(max(dot(-nrm, L), 0.0), 1.3);
    lit += col * sun * vec3f(0.4, 0.65, 0.22) * back * 0.22;
    lit += col * vec3f(0.3, 0.4, 0.5) * max(nrm.y, 0.0) * 0.1;
  }
  // Soft peak clamp — stop bright blob crowns
  let peak = max(lit.x, max(lit.y, lit.z));
  lit = lit * min(1.0, 0.85 / max(peak, 0.85));
  lit = apply_fog(lit, input.world);
  return vec4f(clamp(lit, vec3f(0.0), vec3f(3.0)), 1.0);
}

@fragment fn fs_shadow_tree(input : TreeOut) {
  let part = input.part_w;
  let u = input.uv.x;
  let v = input.uv.y;
  var mask = 1.0;
  if (part < 0.5) {
    let flare = mix(1.15, 0.95, smoothstep(0.0, 0.22, v));
    let taper = mix(0.97, 0.65, pow(v, 0.85)) * flare;
    mask = 1.0 - smoothstep(taper, taper + 0.06, abs(u));
  } else if (part < 1.5) {
    let tw = mix(0.9, 0.4, pow(v, 0.7));
    mask = 1.0 - smoothstep(tw, tw + 0.1, abs(u));
  } else if (part < 2.5) {
    let r = length(vec2f(u, v * 1.08));
    let lobes = 0.1 * sin(atan2(v, u) * 3.0);
    mask = 1.0 - smoothstep(0.78 + lobes, 0.94 + lobes, r);
  } else {
    let au = abs(u);
    let vt = clamp((v + 1.0) * 0.5, 0.0, 1.0);
    let w = mix(1.0, 0.24, pow(vt, 0.85));
    mask = 1.0 - smoothstep(w, w + 0.08, au);
    mask *= smoothstep(-1.05, -0.82, v) * smoothstep(1.08, 0.94, v);
  }
  if (mask < 0.28) { discard; }
}

`;

  const COMPUTE_WGSL = /* wgsl */ `
struct Blade {
  data0 : vec4f,
  data1 : vec4f,
  data2 : vec4f,
  data3 : vec4f,
};
struct GenParams {
  // Sliding grass patch (FE ~80 m)
  grass_ox : f32,
  grass_oz : f32,
  grass_area : f32,
  axis : u32,
  // Full-island heightmap sampling
  terrain_ox : f32,
  terrain_oz : f32,
  terrain_area : f32,
  height_res : u32,
  seed : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};
struct CullParams {
  eye : vec3f,
  blade_count : u32,
  view_proj : mat4x4f,
  lod0_max : f32,
  lod1_max : f32,
  far_max : f32,
  _pad1 : f32,
};
struct DrawIndirect {
  vertexCount : u32,
  instanceCount : atomic<u32>,
  firstVertex : u32,
  firstInstance : u32,
};

@group(0) @binding(0) var<storage, read_write> blades_rw : array<Blade>;
@group(0) @binding(1) var<storage, read> heights : array<f32>;
@group(0) @binding(2) var<uniform> gen : GenParams;

fn hash21(p : vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p : vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn biome_hash21(p : vec2i) -> f32 {
  var n = bitcast<u32>(p.x) * 1597334677u + bitcast<u32>(p.y) * 3812015801u;
  n = (n << 13u) ^ n;
  n = n * 1274126177u;
  return f32(n) * (1.0 / 4294967295.0);
}
fn biome_value_noise(p : vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = biome_hash21(i);
  let b = biome_hash21(i + vec2i(1, 0));
  let c = biome_hash21(i + vec2i(0, 1));
  let d = biome_hash21(i + vec2i(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}
fn biome_fbm(p : vec2f) -> f32 {
  var s = 0.0;
  var a = 1.0;
  var f = 1.0;
  var n = 0.0;
  for (var i = 0; i < 4; i++) {
    s += biome_value_noise(p * f) * a;
    n += a;
    a *= 0.5;
    f *= 2.02;
  }
  return s / max(n, 1e-5);
}
fn biome_id(xz : vec2f) -> u32 {
  // Matches Rust biome_at — mixed biomes + balanced snow patches
  let s = xz * (1.0 / 90.0);
  let warp = biome_fbm(s * 0.7) * 0.35;
  let warp2 = biome_fbm(s * 0.7 + vec2f(4.0, -2.0)) * 0.35;
  let sw = s + vec2f(warp, warp2);
  let temp = biome_fbm(sw) * 0.88 + 0.08;
  let moist = biome_fbm(sw + vec2f(17.0, -9.0));
  let snow_blob = biome_fbm(xz * (1.0 / 110.0));
  let snow_here = (snow_blob > 0.28 && temp < 0.18) || (temp < -0.28);
  if (snow_here) { return 3u; }
  if (temp > 0.48 && moist < -0.12) { return 5u; }
  if (moist > 0.32) {
    if (temp > 0.05) { return 4u; }
    return 2u;
  }
  if (moist < -0.22) { return 1u; }
  return 0u;
}

// Soft biome memberships — noise-ragged ecotones (no laser borders)
struct BiomeW {
  meadow : f32,
  dry : f32,
  forest : f32,
  snow : f32,
  marsh : f32,
  desert : f32,
};
fn biome_weights(xz : vec2f) -> BiomeW {
  let s = xz * (1.0 / 90.0);
  let warp = biome_fbm(s * 0.7) * 0.35;
  let warp2 = biome_fbm(s * 0.7 + vec2f(4.0, -2.0)) * 0.35;
  let sw = s + vec2f(warp, warp2);
  let temp = biome_fbm(sw) * 0.88 + 0.08;
  let moist = biome_fbm(sw + vec2f(17.0, -9.0));
  let jag = biome_fbm(xz * (1.0 / 42.0)) * 22.0
    + biome_fbm(xz * (1.0 / 18.0) + vec2f(5.1, -3.7)) * 9.0;
  let snow_blob = biome_fbm(xz * (1.0 / 110.0));
  let snow_k = select(0.0, 1.0, (snow_blob > 0.28 && temp < 0.18) || temp < -0.28);
  // Soft edge on snow patches
  var snow = snow_k * smoothstep(0.18, 0.38, snow_blob + (0.28 - temp) * 0.35);
  snow = clamp(snow + select(0.0, 0.85, temp < -0.28), 0.0, 1.0);
  snow = smoothstep(0.12, 0.88, snow);
  let rest = 1.0 - snow;
  var desert = smoothstep(0.32, 0.58, temp) * (1.0 - smoothstep(-0.28, 0.02, moist)) * rest;
  let wet = smoothstep(0.12, 0.48, moist + jag * 0.0022) * rest;
  var marsh = wet * smoothstep(-0.08, 0.30, temp);
  var forest = wet * (1.0 - smoothstep(-0.08, 0.30, temp));
  var dry = (1.0 - smoothstep(-0.40, -0.05, moist)) * rest;
  dry = dry * (1.0 - clamp(desert + wet, 0.0, 1.0));
  var meadow = max(rest - desert - marsh - forest - dry, 0.0);
  var sum = meadow + dry + forest + snow + marsh + desert;
  sum = max(sum, 1e-4);
  return BiomeW(meadow / sum, dry / sum, forest / sum, snow / sum, marsh / sum, desert / sum);
}

fn coast_warp(xz : vec2f) -> f32 {
  let ang = atan2(xz.y, xz.x);
  let lobes = sin(ang * 2.0) * 0.085
    + sin(ang * 3.0 + 1.3) * 0.06
    + cos(ang * 5.0 + 0.7) * 0.045
    + sin(ang * 9.0 + 2.4) * 0.028
    + cos(ang * 14.0 - 0.9) * 0.018;
  let n = biome_fbm(xz * (1.0 / 480.0));
  let n2 = biome_fbm(xz * (1.0 / 220.0) + vec2f(19.0, -11.0));
  return clamp(0.90 + lobes + n * 0.12 + n2 * 0.07, 0.68, 1.22);
}
fn coast_radius(xz : vec2f) -> f32 { return 256.0 * coast_warp(xz); }
fn island_edge_w(xz : vec2f) -> f32 {
  let dist = length(xz);
  let rim = coast_radius(xz);
  return clamp((dist - rim * 0.72) / max(rim * 0.34, 1.0), 0.0, 1.0);
}

fn sample_h(wx : f32, wz : f32) -> f32 {
  let res = i32(gen.height_res);
  if (res < 2) { return 0.0; }
  let u = clamp((wx - gen.terrain_ox) / gen.terrain_area + 0.5, 0.0, 1.0 - 1e-5);
  let v = clamp((wz - gen.terrain_oz) / gen.terrain_area + 0.5, 0.0, 1.0 - 1e-5);
  let fx = u * f32(res - 1);
  let fz = v * f32(res - 1);
  let x0 = i32(floor(fx));
  let z0 = i32(floor(fz));
  let x1 = min(res - 1, x0 + 1);
  let z1 = min(res - 1, z0 + 1);
  let tx = fx - f32(x0);
  let tz = fz - f32(z0);
  let h00 = heights[z0 * res + x0];
  let h10 = heights[z0 * res + x1];
  let h01 = heights[z1 * res + x0];
  let h11 = heights[z1 * res + x1];
  let a = h00 + (h10 - h00) * tx;
  let b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

// CPU-stamped rock occupancy grid (256² · 2 m cells over ±256 m)
@group(0) @binding(3) var<storage, read> rock_occ : array<f32>;
fn grass_on_rock(wx : f32, wz : f32) -> bool {
  let half = 256.0;
  let cell = 2.0;
  let n = 256;
  let ix = i32(floor((wx + half) / cell));
  let iz = i32(floor((wz + half) / cell));
  if (ix < 0 || iz < 0 || ix >= n || iz >= n) { return false; }
  return rock_occ[u32(iz * n + ix)] > 0.35;
}

@compute @workgroup_size(256)
fn init_blades(@builtin(global_invocation_id) id : vec3u) {
  let i = id.x;
  let n = gen.axis;
  let total = n * n;
  if (i >= total) { return; }
  let ix = i % n;
  let iz = i / n;
  // FE density: ~1024² blades in ~80 m → ~8 cm spacing
  let spacing = gen.grass_area / f32(n);
  let half = gen.grass_area * 0.5;
  // World-stable seeds (survive patch snap like FE uGridIndex)
  let gix = i32(floor(gen.grass_ox / spacing)) + i32(ix);
  let giz = i32(floor(gen.grass_oz / spacing)) + i32(iz);
  let j = hash22(vec2f(f32(gix) + f32(gen.seed) * 0.001, f32(giz)));
  let lx = -half + (f32(ix) + j.x) * spacing;
  let lz = -half + (f32(iz) + j.y) * spacing;
  let wx = gen.grass_ox + lx;
  let wz = gen.grass_oz + lz;
  let wy = sample_h(wx, wz);
  let step = gen.terrain_area / f32(max(gen.height_res, 2u) - 1u);
  let hx0 = sample_h(wx - step, wz);
  let hx1 = sample_h(wx + step, wz);
  let hz0 = sample_h(wx, wz - step);
  let hz1 = sample_h(wx, wz + step);
  var nrm = normalize(vec3f(hx0 - hx1, 2.0 * step, hz0 - hz1));
  let slope = clamp(nrm.y, 0.0, 1.0);
  let slope_ok = smoothstep(0.52, 0.82, slope);
  nrm = normalize(mix(vec3f(0.0, 1.0, 0.0), nrm, slope_ok));

  let blade_seed = hash21(vec2f(f32(gix), f32(giz) + f32(gen.seed)));
  let clump = hash21(vec2f(f32(gix / 4) + f32(gen.seed) * 0.01, f32(giz / 4)));
  let kind = floor(blade_seed * 3.0);
  let bw = biome_weights(vec2f(wx, wz));
  // FE-ish heights (0.4–0.8) with a touch more volume for avatar scale
  var h_lo = 0.48 * bw.meadow + 0.32 * bw.dry + 0.70 * bw.forest
    + 0.18 * bw.snow + 0.60 * bw.marsh + 0.12 * bw.desert;
  var h_hi = 0.92 * bw.meadow + 0.62 * bw.dry + 1.15 * bw.forest
    + 0.40 * bw.snow + 1.05 * bw.marsh + 0.32 * bw.desert;
  var dens = 1.0 * bw.meadow + 0.9 * bw.dry + 1.0 * bw.forest
    + 0.65 * bw.snow + 0.95 * bw.marsh + 0.4 * bw.desert;
  if (dens < 0.99 && blade_seed > dens) {
    h_lo = 0.02; h_hi = 0.04;
  }
  let h_base = mix(h_lo, h_hi, clump * 0.45 + blade_seed * 0.55);
  var height = h_base * mix(0.88, 1.22, blade_seed) * mix(0.15, 1.0, slope_ok);
  // Full-island carpet — only beach/coast fades (no moving circular patch)
  let iedge = island_edge_w(vec2f(wx, wz));
  // Keep beach clear of grass — wide sandy strip
  if (iedge > 0.22 || wy < -0.2) {
    height = 0.01;
  } else if (iedge > 0.04) {
    height *= smoothstep(0.22, 0.04, iedge);
  }
  // No grass through boulders
  if (grass_on_rock(wx, wz)) {
    height = 0.01;
  }
  // Wider blades — hide soil when island spacing is larger than FE
  let width = mix(0.028, 0.078, 1.0 - blade_seed);
  let bend = mix(0.22, 0.58, clump);
  let wind = 0.65 + blade_seed * 1.1 + clump * 0.35;
  let ang = blade_seed * 6.2831853;

  blades_rw[i] = Blade(
    vec4f(wx, wy, wz, kind),
    vec4f(width, height, bend, wind),
    vec4f(sin(ang), cos(ang), clump, blade_seed),
    vec4f(nrm.x, nrm.z, 0.0, 0.0),
  );
}
`;

  const CULL_WGSL = /* wgsl */ `
struct Blade {
  data0 : vec4f,
  data1 : vec4f,
  data2 : vec4f,
  data3 : vec4f,
};
struct CullParams {
  eye : vec3f,
  blade_count : u32,
  view_proj : mat4x4f,
  lod0_max : f32,
  lod1_max : f32,
  far_max : f32,
  _pad1 : f32,
};
struct DrawIndirect {
  vertexCount : u32,
  instanceCount : atomic<u32>,
  firstVertex : u32,
  firstInstance : u32,
};

// Group 0: blades READ-ONLY only. Group 1: writable LOD + draws (never alias blades).
@group(0) @binding(0) var<storage, read> blades_ro : array<Blade>;
@group(0) @binding(1) var<uniform> cull : CullParams;

@group(1) @binding(0) var<storage, read_write> lod0 : array<u32>;
@group(1) @binding(1) var<storage, read_write> lod1 : array<u32>;
@group(1) @binding(2) var<storage, read_write> lod2 : array<u32>;
@group(1) @binding(3) var<storage, read_write> draws : array<DrawIndirect, 3>;

@compute @workgroup_size(256)
fn cull_lod(@builtin(global_invocation_id) id : vec3u) {
  let i = id.x;
  if (i >= cull.blade_count) { return; }
  let pos = blades_ro[i].data0.xyz;
  if (blades_ro[i].data1.y < 0.04) { return; }
  let clip = cull.view_proj * vec4f(pos + vec3f(0.0, 1.55, 0.0), 1.0);
  let w = clip.w;
  if (w <= 0.05) { return; }
  let ndc = clip.xyz / w;
  if (abs(ndc.x) > 1.35 || abs(ndc.y) > 1.35 || ndc.z < 0.0 || ndc.z > 1.0) { return; }

  let dist = length(pos - cull.eye);
  // Beyond far ring — drop (HQ bubble ~80m, soft tail after)
  if (dist > cull.far_max) { return; }
  let noise = fract(f32(i) * 0.12345) * 2.0 - 1.0;
  let nd = dist + noise * dist * 0.04;
  // Aggressive thin outside the HQ bubble
  if (nd >= cull.lod1_max) {
    let keep = fract(f32(i) * 0.754877666 + f32(i / 97u) * 0.312);
    let dens = select(0.28, 0.12, nd > cull.lod1_max * 1.35);
    if (keep > dens) { return; }
  }

  if (nd < cull.lod0_max) {
    let slot = atomicAdd(&draws[0].instanceCount, 1u);
    lod0[slot] = i;
  } else if (nd < cull.lod1_max) {
    let slot = atomicAdd(&draws[1].instanceCount, 1u);
    lod1[slot] = i;
  } else {
    let slot = atomicAdd(&draws[2].instanceCount, 1u);
    lod2[slot] = i;
  }
}
`;


  const OCEAN_SIM_WGSL = /* wgsl */ `
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
`;

  const OCEAN_WGSL = /* wgsl */ `
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
  let dist_fog = smoothstep(150.0, 600.0, dist);
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
  let shore_damp = smoothstep(0.42, 0.72, edge0);
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
  // Dry beach / inland — no ocean surface
  if (edge < 0.40) { discard; }
  let shore_fade = smoothstep(0.40, 0.52, edge);
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
  let shallow = smoothstep(0.42, 0.75, edge);
  let deep = smoothstep(0.65, 1.0, edge) * smoothstep(rim * 1.05, rim * 2.5, radial);
  var col = mix(vec3f(0.14, 0.58, 0.55), vec3f(0.035, 0.20, 0.36), shallow);
  col = mix(col, vec3f(0.008, 0.04, 0.12), deep);
  let crest = smoothstep(0.4, 1.1, input.foam_v);
  let steep = 1.0 - clamp(n.y, 0.0, 1.0);
  let foam_wave = crest * (0.5 + 0.5 * steep);
  let shore = smoothstep(0.58, 0.42, edge) * smoothstep(0.40, 0.50, edge);
  let shore_pulse = 0.55 + 0.45 * sin(edge * 30.0 - t * 2.4 + radial * 0.07);
  let foam = clamp(foam_wave * 0.9 + shore * shore_pulse * 0.95, 0.0, 1.0);
  col = mix(col, vec3f(0.9, 0.95, 0.99), foam * 0.82);
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
  let sss = vec3f(0.04, 0.48, 0.44) * pow(1.0 - ndv, 2.4) * pow(max(1.0 - n.y, 0.0), 1.4)
    * (0.5 + shallow * 0.7) * (0.35 + crest * 0.9);
  let sh = 0.65 + 0.35 * max(ndl, 0.0);
  var rgb = col * (frame.amb * 0.7 + ndl * 0.5 * sh) * frame.light_col + sky_refl * fres + frame.light_col * sun_spec * fres * sh + sss;
  let under = smoothstep(0.12, -0.45, frame.eye.y - input.sea_y);
  if (under > 0.01) {
    rgb = mix(rgb, vec3f(0.012, 0.07, 0.11), under * 0.8);
    rgb += vec3f(0.05, 0.18, 0.24) * fres * under * 0.6;
  }
  rgb = apply_fog(rgb, input.world);
  let alpha = mix(0.55, 0.98, clamp(shallow * 0.45 + deep * 0.4 + foam * 0.25 + fres * 0.2, 0.0, 1.0))
    * shore_fade;
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(6.0)), alpha);
}
`;

  const OCEAN_FLOOR_WGSL = /* wgsl */ `
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
@group(0) @binding(0) var<uniform> frame : Frame;
@group(0) @binding(3) var shadow_samp : sampler_comparison;
@group(0) @binding(4) var shadow_map : texture_depth_2d_array;
@group(0) @binding(5) var<uniform> csm : ShadowParams;
struct FloorIn {
  @location(0) pos : vec3f,
};
struct FloorOut {
  @builtin(position) clip : vec4f,
  @location(0) world : vec3f,
};
fn fl_hash21(i : vec2i) -> f32 {
  var n = u32(i.x) * 1597334677u + u32(i.y) * 3812015801u;
  n = (n << 13u) ^ n;
  n = n * 1274126177u;
  return f32(n) * (1.0 / 4294967295.0);
}
fn fl_value(p : vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(fl_hash21(i), fl_hash21(i + vec2i(1, 0)), u.x),
    mix(fl_hash21(i + vec2i(0, 1)), fl_hash21(i + vec2i(1, 1)), u.x),
    u.y,
  ) * 2.0 - 1.0;
}
fn fl_fbm(p : vec2f) -> f32 {
  var s = 0.0; var a = 1.0; var f = 1.0; var n = 0.0;
  for (var k = 0; k < 4; k++) { s += fl_value(p * f) * a; n += a; a *= 0.5; f *= 2.02; }
  return s / max(n, 1e-5);
}
fn fl_island_edge(xz : vec2f) -> f32 {
  let ang = atan2(xz.y, xz.x);
  let lobes = sin(ang * 2.0) * 0.085 + sin(ang * 3.0 + 1.3) * 0.06
    + cos(ang * 5.0 + 0.7) * 0.045 + sin(ang * 9.0 + 2.4) * 0.028
    + cos(ang * 14.0 - 0.9) * 0.018;
  let n = fl_fbm(xz * (1.0 / 480.0));
  let n2 = fl_fbm(xz * (1.0 / 220.0) + vec2f(19.0, -11.0));
  let rim = 256.0 * clamp(0.90 + lobes + n * 0.12 + n2 * 0.07, 0.68, 1.22);
  return clamp((length(xz) - rim * 0.72) / max(rim * 0.34, 1.0), 0.0, 1.0);
}
@vertex fn vs_floor(input : FloorIn) -> FloorOut {
  var o : FloorOut;
  o.world = input.pos;
  o.clip = frame.view_proj * vec4f(input.pos, 1.0);
  return o;
}
@fragment fn fs_floor(input : FloorOut) -> @location(0) vec4f {
  let t = frame.time;
  let xz = input.world.xz;
  // Hide seafloor under the island / dry beach
  if (fl_island_edge(xz) < 0.42) { discard; }
  let n1 = fract(sin(dot(floor(xz * 0.15), vec2f(12.9, 78.2))) * 43758.5);
  let n2 = fract(sin(dot(xz * 0.4, vec2f(41.2, 19.7))) * 24634.1);
  var col = mix(vec3f(0.22, 0.18, 0.12), vec3f(0.12, 0.16, 0.14), n1);
  col = mix(col, vec3f(0.18, 0.14, 0.10), n2 * 0.35);
  let c1 = sin(xz.x * 0.55 + t * 1.6) * cos(xz.y * 0.48 - t * 1.3);
  let c2 = sin(xz.x * 1.1 - xz.y * 0.9 + t * 2.2) * cos(xz.y * 1.05 + t * 1.8);
  let cau = pow(max(c1 * 0.55 + c2 * 0.45, 0.0), 2.2);
  col += vec3f(0.15, 0.35, 0.32) * cau * 0.85;
  let L = normalize(-frame.sun_dir);
  let ndl = max(dot(vec3f(0.0, 1.0, 0.0), L), 0.15);
  col *= frame.light_col * (frame.amb + ndl * 0.6);
  let deep = smoothstep(200.0, 900.0, length(xz));
  col = mix(col, vec3f(0.02, 0.05, 0.08), deep * 0.7);
  return vec4f(col, 1.0);
}
`;

  const SKY_WGSL = /* wgsl */ `
struct SkyOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
};
@vertex fn vs_sky(@builtin(vertex_index) vid : u32) -> SkyOut {
  var o : SkyOut;
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  o.uv = vec2f(x, y);
  o.clip = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 1.0, 1.0);
  return o;
}
struct SkyParams {
  inv_view_proj : mat4x4f,
  eye : vec3f,
  tod : f32,
  sun_to : vec3f,
  time : f32,
  moon_to : vec3f,
  cloud : f32,
};
@group(0) @binding(0) var<uniform> sky : SkyParams;

fn hash21(p : vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn noise2(p : vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x),
    mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x),
    u.y
  );
}
fn fbm2(p : vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0; i < 5; i++) {
    v += a * noise2(x);
    x = x * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
fn sun_tint(sun_h : f32) -> vec3f {
  return mix(vec3f(1.0, 0.55, 0.25), vec3f(1.0, 0.96, 0.85), smoothstep(0.0, 0.35, sun_h));
}

@fragment fn fs_sky(input : SkyOut) -> @location(0) vec4f {
  let ndc = vec4f(input.uv.x * 2.0 - 1.0, 1.0 - input.uv.y * 2.0, 1.0, 1.0);
  let world = sky.inv_view_proj * ndc;
  let dir = normalize(world.xyz / max(world.w, 1e-5) - sky.eye);
  let elev = dir.y;
  let sun = normalize(sky.sun_to);
  let moon = normalize(sky.moon_to);
  let sun_h = sun.y;
  let day = smoothstep(-0.05, 0.18, sun_h);
  let dusk = exp(-pow(sun_h / 0.22, 2.0)) * smoothstep(-0.35, 0.05, sun_h);
  let night = 1.0 - clamp(day + dusk * 0.85, 0.0, 1.0);

  let hz = exp(-max(elev, 0.0) * 4.5);
  var zenith = vec3f(0.22, 0.45, 0.85) * day
    + vec3f(0.18, 0.16, 0.35) * dusk
    + vec3f(0.015, 0.025, 0.06) * night;
  var horizon = vec3f(0.62, 0.75, 0.92) * day
    + vec3f(0.95, 0.48, 0.22) * dusk
    + vec3f(0.05, 0.07, 0.14) * night;
  let sun_az = max(dot(normalize(vec3f(dir.x, 0.0, dir.z) + vec3f(1e-4)), normalize(vec3f(sun.x, 0.0, sun.z) + vec3f(1e-4))), 0.0);
  horizon = mix(horizon, vec3f(1.0, 0.55, 0.25), dusk * pow(sun_az, 3.0) * 0.65);
  var col = mix(zenith, horizon, hz);
  col = mix(col * 0.35, col, smoothstep(-0.08, 0.02, elev));

  let cloud_uv = dir.xz / max(elev + 0.15, 0.08) * 0.55 + vec2f(sky.time * 0.008, sky.time * 0.003);
  let cl = fbm2(cloud_uv * 2.2);
  let cloud_mask = smoothstep(0.48, 0.72, cl) * smoothstep(0.02, 0.35, elev) * sky.cloud;
  var cloud_col = mix(vec3f(0.88, 0.90, 0.96), vec3f(1.0, 0.72, 0.5), dusk * 0.85);
  cloud_col = mix(cloud_col, vec3f(0.12, 0.14, 0.22), night);
  let cl_lit = pow(max(dot(dir, sun), 0.0), 4.0);
  cloud_col += sun_tint(sun_h) * cl_lit * 0.4;
  col = mix(col, cloud_col, cloud_mask * (0.5 + 0.4 * day + 0.2 * dusk));

  let sun_ang = acos(clamp(dot(dir, sun), -1.0, 1.0));
  let sun_vis = smoothstep(-0.12, 0.02, sun_h);
  let sun_core = smoothstep(0.025, 0.008, sun_ang) * sun_vis;
  let sun_glow = exp(-sun_ang * 28.0) * sun_vis;
  let sun_halo = exp(-sun_ang * 8.0) * sun_vis;
  let scol = sun_tint(sun_h);
  col += scol * (sun_core * 8.0 + sun_glow * 1.8 + sun_halo * 0.45);

  let moon_ang = acos(clamp(dot(dir, moon), -1.0, 1.0));
  let moon_vis = smoothstep(-0.05, 0.08, moon.y) * (0.25 + night * 1.0);
  let moon_core = smoothstep(0.028, 0.012, moon_ang) * moon_vis;
  let moon_glow = exp(-moon_ang * 22.0) * moon_vis * 0.55;
  col += vec3f(0.82, 0.88, 1.0) * (moon_core * 1.8 + moon_glow);

  if (night > 0.25 && elev > 0.05) {
    let sp = dir * 160.0;
    let cell = floor(sp);
    let h = hash21(cell.xy + vec2f(cell.z * 13.0, cell.z * 7.0));
    if (h > 0.993) {
      let f = fract(sp);
      let d2 = length(f.xy - vec2f(0.5));
      let tw = 0.6 + 0.4 * sin(sky.time * (2.0 + h * 5.0) + h * 20.0);
      col += vec3f(0.85, 0.9, 1.0) * smoothstep(0.07, 0.0, d2) * night * tw;
    }
  }

  return vec4f(clamp(col, vec3f(0.0), vec3f(14.0)), 1.0);
}
`;

  const POST_WGSL = /* wgsl */ `
struct PostOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
};
@vertex fn vs_post(@builtin(vertex_index) vid : u32) -> PostOut {
  var o : PostOut;
  let x = f32((vid << 1u) & 2u);
  let y = f32(vid & 2u);
  o.uv = vec2f(x, 1.0 - y);
  o.clip = vec4f(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
  return o;
}

struct PostParams {
  focus_dist : f32,
  focal_len : f32,
  bokeh : f32,
  exposure : f32,
  helmet : f32,
  near : f32,
  far : f32,
  underwater : f32,
};
@group(0) @binding(0) var post_samp : sampler;
@group(0) @binding(1) var post_tex : texture_2d<f32>;
@group(0) @binding(2) var post_tex_b : texture_2d<f32>;
@group(0) @binding(3) var post_depth : texture_depth_2d;
@group(0) @binding(4) var<uniform> post : PostParams;
@group(0) @binding(5) var post_soft : texture_2d<f32>;

fn linearize_depth(d : f32) -> f32 {
  let z = d * 2.0 - 1.0;
  return (2.0 * post.near * post.far) / (post.far + post.near - z * (post.far - post.near));
}

@fragment fn fs_bright(input : PostOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(post_tex));
  let o = texel * 0.5;
  let c0 = textureSample(post_tex, post_samp, input.uv + vec2f(-o.x, -o.y)).rgb;
  let c1 = textureSample(post_tex, post_samp, input.uv + vec2f( o.x, -o.y)).rgb;
  let c2 = textureSample(post_tex, post_samp, input.uv + vec2f(-o.x,  o.y)).rgb;
  let c3 = textureSample(post_tex, post_samp, input.uv + vec2f( o.x,  o.y)).rgb;
  let luma_w = vec3f(0.2126, 0.7152, 0.0722);
  let w0 = 1.0 / (1.0 + dot(c0, luma_w));
  let w1 = 1.0 / (1.0 + dot(c1, luma_w));
  let w2 = 1.0 / (1.0 + dot(c2, luma_w));
  let w3 = 1.0 / (1.0 + dot(c3, luma_w));
  let c = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / max(w0 + w1 + w2 + w3, 1e-4);
  let lum = dot(c, luma_w);
  let kn = max(lum - 0.55, 0.0);
  let soft = kn * kn / (kn + 0.18);
  return vec4f(c * soft * 1.45, 1.0);
}
@fragment fn fs_blur_h(input : PostOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(post_tex));
  var acc = vec3f(0.0);
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(-3.0, 0.0) * texel).rgb * 0.05;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(-2.0, 0.0) * texel).rgb * 0.09;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(-1.0, 0.0) * texel).rgb * 0.15;
  acc += textureSample(post_tex, post_samp, input.uv).rgb * 0.22;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(1.0, 0.0) * texel).rgb * 0.15;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(2.0, 0.0) * texel).rgb * 0.09;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(3.0, 0.0) * texel).rgb * 0.05;
  return vec4f(acc * 1.25, 1.0);
}
@fragment fn fs_blur_v(input : PostOut) -> @location(0) vec4f {
  let texel = 1.0 / vec2f(textureDimensions(post_tex));
  var acc = vec3f(0.0);
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(0.0, -3.0) * texel).rgb * 0.05;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(0.0, -2.0) * texel).rgb * 0.09;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(0.0, -1.0) * texel).rgb * 0.15;
  acc += textureSample(post_tex, post_samp, input.uv).rgb * 0.22;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(0.0, 1.0) * texel).rgb * 0.15;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(0.0, 2.0) * texel).rgb * 0.09;
  acc += textureSample(post_tex, post_samp, input.uv + vec2f(0.0, 3.0) * texel).rgb * 0.05;
  return vec4f(acc * 1.25, 1.0);
}

@fragment fn fs_dof_blur(input : PostOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(post_tex));
  let texel = 1.0 / dims;
  let raw_d = textureLoad(post_depth, vec2i(input.uv * dims), 0);
  let z = linearize_depth(raw_d);
  let coc = clamp(abs(z - post.focus_dist) / max(post.focal_len, 0.01) * post.bokeh, 0.0, 1.0);
  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let o = vec2f(f32(x), f32(y)) * texel * (1.0 + coc * 1.8);
      let w = 1.0 / (1.0 + f32(x * x + y * y));
      acc += textureSample(post_tex, post_samp, input.uv + o).rgb * w;
      wsum += w;
    }
  }
  return vec4f(acc / wsum, coc);
}

fn aces(x : vec3f) -> vec3f {
  return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}

fn fxaa(uv : vec2f) -> vec3f {
  let dims = vec2f(textureDimensions(post_tex));
  let texel = 1.0 / dims;
  let rgbM = textureSample(post_tex, post_samp, uv).rgb;
  let luma = vec3f(0.299, 0.587, 0.114);
  let lM = dot(rgbM, luma);
  let lN = dot(textureSample(post_tex, post_samp, uv + vec2f(0.0, -texel.y)).rgb, luma);
  let lS = dot(textureSample(post_tex, post_samp, uv + vec2f(0.0, texel.y)).rgb, luma);
  let lE = dot(textureSample(post_tex, post_samp, uv + vec2f(texel.x, 0.0)).rgb, luma);
  let lW = dot(textureSample(post_tex, post_samp, uv + vec2f(-texel.x, 0.0)).rgb, luma);
  let lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  let lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  let dir = vec2f(-((lN + lS) - (lE + lW)), ((lE + lW) - (lN + lS)));
  let dir_reduce = max((lN + lS + lE + lW) * 0.03125, 1.0 / 128.0);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dir_reduce);
  var d = clamp(dir * rcp, vec2f(-8.0), vec2f(8.0)) * texel;
  let rgbA = 0.5 * (
    textureSample(post_tex, post_samp, uv + d * (1.0 / 3.0 - 0.5)).rgb +
    textureSample(post_tex, post_samp, uv + d * (2.0 / 3.0 - 0.5)).rgb
  );
  let rgbB = rgbA * 0.5 + 0.25 * (
    textureSample(post_tex, post_samp, uv + d * -0.5).rgb +
    textureSample(post_tex, post_samp, uv + d * 0.5).rgb
  );
  let lB = dot(rgbB, luma);
  if (lB < lMin || lB > lMax) { return rgbA; }
  return rgbB;
}

@fragment fn fs_composite(input : PostOut) -> @location(0) vec4f {
  var uv = input.uv;
  let to_c0 = uv - vec2f(0.5);
  if (post.helmet > 0.01) {
    let dist = length(to_c0);
    uv = uv - to_c0 * pow(dist, 3.0) * 0.18 * post.helmet;
  }

  let soft_s = textureSample(post_soft, post_samp, uv);
  let bloom = textureSample(post_tex_b, post_samp, uv).rgb;
  // Cap CoC — FE DoF is subtle autofocus, not a milk haze
  let coc = 0.0; // no blur

  var sharp = textureSample(post_tex, post_samp, uv).rgb;
  // Light FXAA only on edges (avoid grain wash on meadow)
  let aa = fxaa(uv);
  let luma = vec3f(0.299, 0.587, 0.114);
  let edge = smoothstep(0.04, 0.14, abs(dot(sharp, luma) - dot(aa, luma)));
  sharp = mix(sharp, aa, edge * 0.65);

  if (post.helmet > 0.01) {
    let ca = to_c0 * 0.008 * post.helmet;
    let r = textureSample(post_tex, post_samp, uv + ca).r;
    let g = sharp.g;
    let b = textureSample(post_tex, post_samp, uv - ca).b;
    sharp = vec3f(r, g, b);
  }

  var rgb = mix(sharp, soft_s.rgb, coc) + bloom * 0.08;
  // Cheap depth-contact darkening (fake AO under canopies / near edges)
  {
    let dims = vec2f(textureDimensions(post_depth));
    let max_px = vec2i(dims) - 1;
    let px = clamp(vec2i(clamp(uv, vec2f(0.0), vec2f(0.999)) * dims), vec2i(0), max_px);
    let z0 = linearize_depth(textureLoad(post_depth, px, 0));
    var ao = 0.0;
    ao += smoothstep(0.12, 1.6, z0 - linearize_depth(textureLoad(post_depth, clamp(px + vec2i(3, 0), vec2i(0), max_px), 0)));
    ao += smoothstep(0.12, 1.6, z0 - linearize_depth(textureLoad(post_depth, clamp(px + vec2i(-3, 0), vec2i(0), max_px), 0)));
    ao += smoothstep(0.12, 1.6, z0 - linearize_depth(textureLoad(post_depth, clamp(px + vec2i(0, 3), vec2i(0), max_px), 0)));
    ao += smoothstep(0.12, 1.6, z0 - linearize_depth(textureLoad(post_depth, clamp(px + vec2i(0, -3), vec2i(0), max_px), 0)));
    let near_w = 1.0 - smoothstep(30.0, 110.0, z0);
    rgb *= 1.0 - clamp(ao * 0.055 * near_w, 0.0, 0.26);
  }
  rgb *= post.exposure;
  rgb = aces(rgb);
  // Blue-noise-ish dither kills banding after tonemap
  let dims_d = vec2f(textureDimensions(post_tex));
  let dither = fract(sin(dot(uv * dims_d, vec2f(12.9898, 78.233))) * 43758.5453);
  rgb += (dither - 0.5) / 255.0;

  let d = length(uv - vec2f(0.5));
  let vig = smoothstep(0.58, 1.08, d);
  if (post.helmet > 0.01) {
    let cool = vec3f(0.62, 0.68, 0.74);
    rgb = mix(rgb, rgb * cool, post.helmet * (0.28 + vig * 0.4));
  }
  rgb *= 1.0 - vig * (0.28 + 0.22 * post.helmet);

  // Underwater grade: absorption fog + animated caustics + soft distortion tint
  if (post.underwater > 0.01) {
    let u = clamp(post.underwater, 0.0, 1.0);
    let murk = vec3f(0.03, 0.14, 0.20);
    rgb = mix(rgb, rgb * vec3f(0.35, 0.72, 0.82), u * 0.7);
    rgb = mix(rgb, murk, u * (0.28 + vig * 0.4));
    // Multi-scale caustics
    let cau1 = sin(uv.x * 55.0 + uv.y * 40.0) * cos(uv.y * 48.0 - uv.x * 28.0);
    let cau2 = sin(uv.x * 90.0 - uv.y * 70.0) * cos(uv.y * 85.0 + uv.x * 60.0);
    let cau = max(cau1, 0.0) * 0.65 + max(cau2, 0.0) * 0.35;
    rgb += vec3f(0.03, 0.10, 0.11) * cau * u * 0.55;
    // God-ray hint toward top of screen
    let rays = pow(max(1.0 - uv.y, 0.0), 3.0) * (0.5 + 0.5 * sin(uv.x * 20.0));
    rgb += vec3f(0.04, 0.12, 0.14) * rays * u * 0.35;
  }
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}

// Avatar atlas: top half = color RGBA, bottom half = linDepth/far in R
@group(0) @binding(6) var avatar_atlas : texture_2d<f32>;

@fragment fn fs_avatar_merge(input : PostOut) -> @location(0) vec4f {
  let uv = input.uv;
  // All textureSample calls must be in uniform control flow (no early-return).
  let meadow = textureSample(post_tex, post_samp, uv);
  let av = textureSample(avatar_atlas, post_samp, vec2f(uv.x, uv.y * 0.5));
  let av_dn = textureSample(avatar_atlas, post_samp, vec2f(uv.x, 0.5 + uv.y * 0.5)).r;
  let av_z = av_dn * post.far;
  let dims = vec2f(textureDimensions(post_depth));
  let raw_d = textureLoad(post_depth, vec2i(clamp(uv, vec2f(0.0), vec2f(0.999)) * dims), 0);
  let meadow_z = linearize_depth(raw_d);
  // Tiny sole/terrain epsilon only — grass in front of feet must win.
  // (Old bias 0.25–0.55m let the whole shin draw over the meadow.)
  let eps = 0.06;
  let cover = select(0.0, 1.0, av.a >= 0.04 && av_z + eps < meadow_z);
  let rgb = mix(meadow.rgb, av.rgb, clamp(av.a, 0.0, 1.0) * cover);
  return vec4f(rgb, 1.0);
}
`;

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
  const OCEAN_R_OUT = 1600;
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
    // Pack as many blades as storage allows (full island, one bake)
    let BLADE_AXIS = 2048;
    while (BLADE_AXIS * BLADE_AXIS * 64 > maxStorage * 0.65 && BLADE_AXIS > 512) {
      BLADE_AXIS = Math.floor(BLADE_AXIS * 0.85);
    }
    BLADE_AXIS = Math.max(512, Math.min(2048, BLADE_AXIS));
    const BLADE_COUNT = BLADE_AXIS * BLADE_AXIS;
    // Full island diameter (~512) + rim margin — fixed at origin, never streamed
    const GRASS_AREA = 540;
    let grassOx = 0, grassOz = 0;
    const GRASS_STREAM = false; // load once with chunk

    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    const sceneFormat = wantF16 ? "rgba16float" : "rgba8unorm";
    const bloomScale = 0.35;
    const NEAR = 0.1, FAR = 800;
    // Quality bubble around avatar — full detail inside, cheap outside
    const HQ_RADIUS = 80;
    const GRASS_LOD0 = 36;       // 15-seg blades
    const GRASS_LOD1 = HQ_RADIUS; // 5-seg within bubble
    const GRASS_FAR = 150;       // hard cull grass beyond
    const TREE_DRAW = 110;       // draw trees within
    const TREE_SHADOW = 85;      // cast tree shadows within
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
            // Wide sandy shoreline on the map
            const beach = edge > 0.02 ? Math.min(1, (edge - 0.02) / 0.40) : 0;
            const sand0 = 210, sand1 = 186, sand2 = 128;
            c0 = c0 * (1 - beach) + sand0 * beach;
            c1 = c1 * (1 - beach) + sand1 * beach;
            c2 = c2 * (1 - beach) + sand2 * beach;
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
    }

    function setMapOpen(on) {
      mapOpen = !!on;
      if (mapOpen) {
        try { exitAimLock(); } catch (_) {}
        if (!worldMapReady) paintWorldMapBase();
        redrawMapOverlay();
        if (typeof mapDlg.showModal === "function") mapDlg.showModal();
        else mapDlg.setAttribute("open", "");
      } else {
        if (typeof mapDlg.close === "function") mapDlg.close();
        else mapDlg.removeAttribute("open");
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
    mapDlg.addEventListener("close", () => { mapOpen = false; });
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

    let depth, sceneColor, bloomA, bloomB, dofTex, compTex, avatarAtlas;
    let sceneView, bloomAView, bloomBView, dofView, depthView, compView, avatarAtlasView;
    let getAvatarAtlas = null;
    function rebuildTargets() {
      destroyTex(depth); destroyTex(sceneColor); destroyTex(bloomA); destroyTex(bloomB);
      destroyTex(dofTex); destroyTex(compTex); destroyTex(avatarAtlas);
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
      avatarAtlasView = avatarAtlas.createView();
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
    const postParamBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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

    // HDR IBL (False Earth potsdamer_platz_1k) — rgba32float + textureLoad bilinear
    const envSamp = device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
    let envTex = null;
    let envView = null;
    function uploadEnvF32(w, h, f32) {
      envTex = device.createTexture({
        size: [w, h],
        format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
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

    function oceanSimBind() {
      const foamRead = foamFlip ? foamTexB : foamTexA;
      const foamWrite = foamFlip ? foamTexA : foamTexB;
      return device.createBindGroup({
        layout: oceanSimBgl,
        entries: [
          { binding: 0, resource: { buffer: oceanSimParamsBuf } },
          { binding: 1, resource: cascade0Tex.createView() },
          { binding: 2, resource: cascade1Tex.createView() },
          { binding: 3, resource: foamRead.createView() },
          { binding: 4, resource: foamWrite.createView() },
        ],
      });
    }
    function oceanDrawBind() {
      const foamRead = foamFlip ? foamTexB : foamTexA;
      return device.createBindGroup({
        layout: oceanDrawBgl,
        entries: [
          { binding: 0, resource: oceanSamp },
          { binding: 1, resource: cascade0Tex.createView() },
          { binding: 2, resource: cascade1Tex.createView() },
          { binding: 3, resource: foamRead.createView() },
          { binding: 4, resource: { buffer: oceanDrawParamsBuf } },
        ],
      });
    }

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

    function postBind(texA, texB, softView) {
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

    function mergeBind(meadowView) {
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

    let terrainVbo = null, terrainIbo = null, terrainIndexCount = 0;
    let chunk = null, baking = false, grassReady = false;
    let beamVbo = null, beamVertCount = 0;
    let roseVbo = null, roseVertCount = 0;
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
    /** Bigger rocks = more HP (longer mine) + more stone per hit. size≈mesh scale (0.4–2.1). */
    function oreStatsForSize(kind, scale) {
      const base = oreNodeStats(kind);
      const s = Math.max(0.35, Math.min(2.4, scale != null ? scale : 1));
      // ~0.55× for pebbles, ~1× medium, ~2.1× boulders
      const mul = 0.45 + s * 0.75;
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
      ensureLootUi();
      if (!lootToastHost) return;
      const name = LOOT_LABELS[dropId] || dropId;
      const el = document.createElement("div");
      el.className = "fw-loot-toast";
      el.textContent = "+" + qty + " " + name;
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
      buildBlockers.push({ x: pos.x, z: pos.z, r: 2.2, kind: "tree" });
      rebuildBuildMesh();
      return true;
    }
    function spawnRespawnOre(pos, kindHint) {
      if (countLiveOres() >= RESOURCE_SPAWN.oreCap) return false;
      const kind = kindHint || pickOreKindForPos(pos.x, pos.z, pos.y);
      // Sulfur nodes stay compact
      let scale = 0.55 + Math.random() * 1.45;
      if (kind === "sulfur") scale = 0.42 + Math.random() * 0.38;
      else if (kind === "metal") scale = 0.55 + Math.random() * 1.05;
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
      if (countLiveBarrels() >= RESOURCE_SPAWN.barrelCap) return false;
      if (player && Math.hypot(pos.x - player.x, pos.z - player.z) < RESOURCE_SPAWN.barrelClearR) {
        return false; // area occupied — retry later
      }
      const ix = Math.floor(pos.x / BUILD_CELL);
      const iz = Math.floor(pos.z / BUILD_CELL);
      const piece = ensurePieceInternals({
        type: "scrap_barrel",
        ix, iy: 0, iz, yaw: 0,
        baseY: pos.y,
        tier: 0,
        ownerId: "world",
        _ox: pos.x - (ix + 0.5) * BUILD_CELL,
        _oz: pos.z - (iz + 0.5) * BUILD_CELL,
      });
      buildPieces.push(piece);
      harvestNodes.push({
        kind: "barrel", x: pos.x, y: pos.y, z: pos.z, r: 0.5,
        hp: 55, maxHp: 55, dropId: "scrap", dropPerHit: 3,
        pieceId: piece.id, dead: false, respawned: true,
      });
      buildBlockers.push({ x: pos.x, z: pos.z, r: 0.7, kind: "rock" });
      rebuildBuildMesh();
      return true;
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
        else if (job.kind === "barrel") ok = spawnRespawnBarrel(pos);
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

    /** Full piece catalog — order matches Rust radial wheel (clockwise from top). */
    const BUILD_CATALOG = [
      { id: "foundation", label: "Cimiento", desc: "Base cuadrada 3×3 m", group: "deck", cost: 50 },
      { id: "foundation_tri", label: "Cimiento Δ", desc: "Triángulo equilátero 3 m", group: "deck", cost: 25 },
      { id: "stairs", label: "Escalera", desc: "Sube un nivel completo (3 m)", group: "ramp", cost: 50 },
      { id: "stairs_l", label: "Escalera L", desc: "Escalera en ángulo", group: "ramp", cost: 50 },
      { id: "floor", label: "Piso", desc: "Piso / techo plano 3×3 m", group: "floor", cost: 25 },
      { id: "floor_tri", label: "Piso Δ", desc: "Piso triangular 3 m", group: "floor", cost: 13 },
      { id: "roof", label: "Techo", desc: "Inclínado · sube 1,5 m", group: "roof", cost: 25 },
      { id: "roof_tri", label: "Techo Δ", desc: "Techo triangular", group: "roof", cost: 13 },
      { id: "wall", label: "Pared", desc: "Asegura tu base · 3×3 m", group: "wall", cost: 50, wallH: BUILD_LEVEL_H },
      { id: "doorway", label: "Marco puerta", desc: "Hueco 1,2×2,2 m", group: "wall", cost: 35, wallH: BUILD_LEVEL_H },
      { id: "window", label: "Marco ventana", desc: "Pared con ventana", group: "wall", cost: 35, wallH: BUILD_LEVEL_H },
      { id: "doorway_d", label: "Doble puerta", desc: "Marco ancho 2,0×2,2 m", group: "wall", cost: 40, wallH: BUILD_LEVEL_H },
      { id: "wall_half", label: "Media pared", desc: "3×1,5 m", group: "wall", cost: 25, wallH: BUILD_HALF_H },
      { id: "wall_low", label: "Pared baja", desc: "3×0,75 m", group: "wall", cost: 15, wallH: BUILD_LOW_H },
      { id: "roof_corner", label: "Techo esquina", desc: "Transición de techos", group: "roof", cost: 25 },
      { id: "roof_valley", label: "Techo valle", desc: "Unión interior", group: "roof", cost: 25 },
      { id: "ramp", label: "Rampa", desc: "Rampa · 3 m de alto", group: "ramp", cost: 50 },
      { id: "roof_wall", label: "Hastial", desc: "Cierre lateral de techo", group: "wall", cost: 25, wallH: BUILD_ROOF_RISE },
      { id: "door", label: "Puerta", desc: "E abre/cierra · cerradura", group: "wall", cost: 40, wallH: BUILD_LEVEL_H },
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
    BUILD_BY_ID.toolcupboard = {
      id: "toolcupboard", label: "Armario", desc: "Privilege 16 m · upkeep", group: "deploy", cost: 0,
    };
    BUILD_LABELS.toolcupboard = "Armario";
    BUILD_BY_ID.workbench = {
      id: "workbench", label: "Mesa T1", desc: "Crafteo avanzado · 2 m", group: "deploy", cost: 0,
    };
    BUILD_LABELS.workbench = "Mesa T1";
    BUILD_BY_ID.research_table = {
      id: "research_table", label: "Mesa investigación", desc: "Aprende planos con scrap", group: "deploy", cost: 0,
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
    let buildTypeIdx = 8; // default Wall (Rust focus)
    let buildYaw = 0; // 0..3 * 90°
    let radialOpen = false;
    let radialHoverIdx = -1;
    /** @type {{type:string,ix:number,iy:number,iz:number,yaw:number,y:number,baseY:number}[]} */
    let buildPieces = [];
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
    let camMode = "fpv";
    // FPV look pitch (0 = horizontal, + = look up, − = look down)
    let fpvPitch = -0.06;
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
      doorway_d: [0.50, 0.35, 0.19],
      wall_half: [0.51, 0.36, 0.20],
      wall_low: [0.49, 0.34, 0.19],
      roof_wall: [0.50, 0.35, 0.18],
      floor: [0.50, 0.35, 0.19],
      floor_tri: [0.49, 0.34, 0.18],
      stairs: [0.50, 0.36, 0.20],
      stairs_l: [0.50, 0.36, 0.20],
      ramp: [0.48, 0.34, 0.19],
      roof: [0.46, 0.32, 0.17],
      roof_tri: [0.46, 0.32, 0.17],
      roof_corner: [0.45, 0.31, 0.16],
      roof_valley: [0.45, 0.31, 0.16],
    };

    function isWallType(t) {
      return t === "wall" || t === "doorway" || t === "window" || t === "doorway_d"
        || t === "wall_half" || t === "wall_low" || t === "roof_wall" || t === "door";
    }
    function isDeckType(t) {
      return t === "foundation" || t === "foundation_tri" || t === "floor" || t === "floor_tri"
        || t === "stairs" || t === "stairs_l" || t === "ramp";
    }
    function isFloorType(t) {
      return t === "floor" || t === "floor_tri";
    }
    function isFoundationType(t) {
      return t === "foundation" || t === "foundation_tri";
    }
    function isRoofType(t) {
      return t === "roof" || t === "roof_tri" || t === "roof_corner" || t === "roof_valley";
    }
    function isRampType(t) {
      return t === "stairs" || t === "stairs_l" || t === "ramp";
    }
    function isFurnitureDeploy(t) {
      return t === "toolcupboard" || t === "workbench" || t === "research_table"
        || t === "campfire" || t === "sleeping_bag"
        || t === "box_small" || t === "box_large";
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
      if (type === "workbench" || type === "research_table") { hw = 0.7; hd = 0.42; }
      else if (type === "box_large") { hw = 0.55; hd = 0.45; }
      else if (type === "box_small") { hw = 0.38; hd = 0.32; }
      else if (type === "campfire") { hw = 0.4; hd = 0.4; }
      else if (type === "sleeping_bag") { hw = 0.45; hd = 0.9; }
      else if (type === "toolcupboard") { hw = 0.46; hd = 0.30; } // matches crown / doors
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

    function buildPushVert(arr, x, y, z, nx, ny, nz, rgb, u, v) {
      arr.push(x, y, z, nx, ny, nz, rgb[0], rgb[1], rgb[2], u, v);
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

    function buildPost(arr, cx, cz, y0, y1, half, rgb) {
      buildPushBox(arr, cx - half, y0, cz - half, cx + half, y1, cz + half, rgb);
      const h2 = half * 0.78;
      buildPushBox(arr, cx - h2, y0, cz - h2 * 1.12, cx + h2, y1, cz + h2 * 1.12, rgb);
      buildPushBox(arr, cx - h2 * 1.12, y0, cz - h2, cx + h2 * 1.12, y1, cz + h2, rgb);
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

    function buildRustPlatform(arr, x0, z0, x1, z1, base, rgb, neighMask) {
      const n = neighMask | 0;
      const hasN = !!(n & 1), hasE = !!(n & 2), hasS = !!(n & 4), hasW = !!(n & 8);
      const beam = BUILD_BEAM * 0.92;
      const post = BUILD_BEAM * 0.7;
      const deckT = BUILD_FLOOR_T * 0.65;
      const yFoot = base - 0.1;
      const yDeck = base + BUILD_FOUND_H;
      const yBeam0 = yDeck - deckT - 0.12;
      const yBeam1 = yDeck - deckT + 0.03;
      const inset = post * 0.55 + 0.06;
      // Flush deck into shared edges so platforms read as one surface
      const dx0 = hasW ? x0 - 0.01 : x0 + beam * 0.35;
      const dx1 = hasE ? x1 + 0.01 : x1 - beam * 0.35;
      const dz0 = hasS ? z0 - 0.01 : z0 + beam * 0.35;
      const dz1 = hasN ? z1 + 0.01 : z1 - beam * 0.35;
      const corners = [
        { x: x0 + inset, z: z0 + inset, skip: hasW || hasS }, // SW
        { x: x1 - inset, z: z0 + inset, skip: hasE || hasS }, // SE
        { x: x0 + inset, z: z1 - inset, skip: hasW || hasN }, // NW
        { x: x1 - inset, z: z1 - inset, skip: hasE || hasN }, // NE
      ];
      for (let i = 0; i < 4; i++) {
        if (corners[i].skip) continue;
        buildPost(arr, corners[i].x, corners[i].z, yFoot, yBeam1 + 0.02, post * 0.5, rgb);
        const f = post * 0.7;
        buildPushBox(
          arr,
          corners[i].x - f, yFoot - 0.02, corners[i].z - f,
          corners[i].x + f, yFoot + 0.04, corners[i].z + f,
          rgb
        );
      }
      const hw = beam * 0.45;
      // Edge beams only on open sides (shared edge uses neighbor's beam)
      if (!hasS) buildLogBeamX(arr, x0 + inset, x1 - inset, yBeam0, yBeam1 + 0.03, z0 + inset, hw, rgb);
      if (!hasN) buildLogBeamX(arr, x0 + inset, x1 - inset, yBeam0, yBeam1 + 0.03, z1 - inset, hw, rgb);
      if (!hasW) buildLogBeamZ(arr, z0 + inset, z1 - inset, yBeam0, yBeam1 + 0.03, x0 + inset, hw, rgb);
      if (!hasE) buildLogBeamZ(arr, z0 + inset, z1 - inset, yBeam0, yBeam1 + 0.03, x1 - inset, hw, rgb);
      // Cross beams always (structure under floor)
      buildLogBeamX(arr, x0 + inset, x1 - inset, yBeam0, yBeam1, (z0 + z1) * 0.5, hw * 0.85, rgb);
      buildLogBeamZ(arr, z0 + inset, z1 - inset, yBeam0, yBeam1, (x0 + x1) * 0.5, hw * 0.85, rgb);
      buildPushBox(arr, dx0, yDeck - deckT, dz0, dx1, yDeck, dz1, rgb);
      const lip = 0.1;
      const lipW = beam * 0.55;
      if (!hasS) buildPushBox(arr, dx0, yDeck - 0.01, z0 + 0.01, dx1, yDeck + lip, z0 + lipW, rgb);
      if (!hasN) buildPushBox(arr, dx0, yDeck - 0.01, z1 - lipW, dx1, yDeck + lip, z1 - 0.01, rgb);
      if (!hasW) buildPushBox(arr, x0 + 0.01, yDeck - 0.01, dz0, x0 + lipW, yDeck + lip, dz1, rgb);
      if (!hasE) buildPushBox(arr, x1 - lipW, yDeck - 0.01, dz0, x1 - 0.01, yDeck + lip, dz1, rgb);
      // Corner caps only on free corners
      const c = 0.28, ch = 0.14;
      if (!hasW && !hasS) buildPushBox(arr, x0, yDeck, z0, x0 + c, yDeck + ch, z0 + c, rgb);
      if (!hasE && !hasS) buildPushBox(arr, x1 - c, yDeck, z0, x1, yDeck + ch, z0 + c, rgb);
      if (!hasW && !hasN) buildPushBox(arr, x0, yDeck, z1 - c, x0 + c, yDeck + ch, z1, rgb);
      if (!hasE && !hasN) buildPushBox(arr, x1 - c, yDeck, z1 - c, x1, yDeck + ch, z1, rgb);
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
      // legs at three corners
      const post = BUILD_BEAM * 0.55;
      const yFoot = base - 0.08;
      const pts = [a, b, c];
      for (let i = 0; i < 3; i++) {
        buildPost(arr, pts[i][0], pts[i][1], yFoot, yDeck - 0.05, post * 0.5, rgb);
      }
      // thick triangle slab (top + underside via two offset tris + edge walls)
      const y0 = yDeck - deckT;
      const y1 = yDeck;
      buildPushTri(arr, a[0], y1, a[1], b[0], y1, b[1], c[0], y1, c[1], rgb);
      buildPushTri(arr, a[0], y0, a[1], c[0], y0, c[1], b[0], y0, b[1], rgb);
      // edge skirts
      const edges = [[a, b], [b, c], [c, a]];
      for (let e = 0; e < 3; e++) {
        const p0 = edges[e][0], p1 = edges[e][1];
        buildPushTri(arr, p0[0], y0, p0[1], p1[0], y0, p1[1], p1[0], y1, p1[1], rgb);
        buildPushTri(arr, p0[0], y0, p0[1], p1[0], y1, p1[1], p0[0], y1, p0[1], rgb);
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

    function buildStairsRun(arr, x0, z0, x1, z1, base, yaw, rgb, steps, riseTotal, inset) {
      const cell = BUILD_CELL;
      const n = steps || 6;
      const rise = (riseTotal != null ? riseTotal : BUILD_LEVEL_H) / n;
      const run = cell / n;
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
        buildRustPlatform(arr, x0, z0, x1, z1, base, rgb, nMask);
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
        if (type === "doorway") {
          buildFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, BUILD_DOOR_W, BUILD_DOOR_H, 0);
        } else if (type === "doorway_d") {
          buildFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 2.0, BUILD_DOOR_H, 0);
        } else if (type === "window") {
          buildFrameWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, 1.1, 1.1, 0.9);
        } else if (type === "roof_wall") {
          buildGableWall(arr, x0, z0, x1, z1, levelWallTopY(base), yaw, rgb);
        } else if (type === "door") {
          // Door leaf is drawn in the AAA mesh override (correct open/closed pose)
          return;
        } else {
          buildSolidWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends);
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
      // Door leaf — thin panel in the opening (NOT a full wall slab)
      if (p.type === "door") {
        const y0 = wallSeatY(p);
        const y1 = y0 + BUILD_DOOR_H;
        const w = BUILD_DOOR_W;
        const dt = 0.1;
        const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
        const h0 = mid - w * 0.5;
        const h1 = mid + w * 0.5;
        if (yaw === 0) return { minX: h0, maxX: h1, minY: y0, maxY: y1, minZ: z1 - t - dt, maxZ: z1 - 0.01 };
        if (yaw === 2) return { minX: h0, maxX: h1, minY: y0, maxY: y1, minZ: z0 + 0.01, maxZ: z0 + t + dt };
        if (yaw === 1) return { minX: x1 - t - dt, maxX: x1 - 0.01, minY: y0, maxY: y1, minZ: h0, maxZ: h1 };
        return { minX: x0 + 0.01, maxX: x0 + t + dt, minY: y0, maxY: y1, minZ: h0, maxZ: h1 };
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

    /** Extra AABBs for doorway frames (solid jambs only — opening is walkable). */
    function pieceColliders(p) {
      if (p.type === "door") {
        if (p.isOpen) return [];
        return [pieceAabb(p)];
      }
      if (p.type !== "doorway" && p.type !== "doorway_d" && p.type !== "window") {
        if (isWallType(p.type)) return [pieceAabb(p)];
        return [];
      }
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const yaw = ((p.yaw % 4) + 4) % 4;
      const t = BUILD_WALL_T;
      const yWall0 = wallSeatY(p);
      const y1 = yWall0 + BUILD_LEVEL_H;
      const openW = p.type === "doorway_d" ? 2.0 : (p.type === "window" ? 1.1 : BUILD_DOOR_W);
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
          out.push({ minX: o0, maxX: o1, minY: yWall0 + BUILD_DOOR_H, maxY: y1, minZ: z1 - t, maxZ: z1 });
        }
      } else if (yaw === 2) {
        out.push({ minX: x0, maxX: o0, minY: yWall0, maxY: y1, minZ: z0, maxZ: z0 + t });
        out.push({ minX: o1, maxX: x1, minY: yWall0, maxY: y1, minZ: z0, maxZ: z0 + t });
        if (p.type === "window") {
          out.push({ minX: o0, maxX: o1, minY: yWall0, maxY: yWall0 + 0.9, minZ: z0, maxZ: z0 + t });
          out.push({ minX: o0, maxX: o1, minY: yWall0 + 2.0, maxY: y1, minZ: z0, maxZ: z0 + t });
        } else {
          out.push({ minX: o0, maxX: o1, minY: yWall0 + BUILD_DOOR_H, maxY: y1, minZ: z0, maxZ: z0 + t });
        }
      } else if (yaw === 1) {
        out.push({ minX: x1 - t, maxX: x1, minY: yWall0, maxY: y1, minZ: z0, maxZ: o0 });
        out.push({ minX: x1 - t, maxX: x1, minY: yWall0, maxY: y1, minZ: o1, maxZ: z1 });
        if (p.type === "window") {
          out.push({ minX: x1 - t, maxX: x1, minY: yWall0, maxY: yWall0 + 0.9, minZ: o0, maxZ: o1 });
          out.push({ minX: x1 - t, maxX: x1, minY: yWall0 + 2.0, maxY: y1, minZ: o0, maxZ: o1 });
        } else {
          out.push({ minX: x1 - t, maxX: x1, minY: yWall0 + BUILD_DOOR_H, maxY: y1, minZ: o0, maxZ: o1 });
        }
      } else {
        out.push({ minX: x0, maxX: x0 + t, minY: yWall0, maxY: y1, minZ: z0, maxZ: o0 });
        out.push({ minX: x0, maxX: x0 + t, minY: yWall0, maxY: y1, minZ: o1, maxZ: z1 });
        if (p.type === "window") {
          out.push({ minX: x0, maxX: x0 + t, minY: yWall0, maxY: yWall0 + 0.9, minZ: o0, maxZ: o1 });
          out.push({ minX: x0, maxX: x0 + t, minY: yWall0 + 2.0, maxY: y1, minZ: o0, maxZ: o1 });
        } else {
          out.push({ minX: x0, maxX: x0 + t, minY: yWall0 + BUILD_DOOR_H, maxY: y1, minZ: o0, maxZ: o1 });
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
        + (p.type === "door" ? ("|op" + (p.isOpen ? 1 : 0)) : "")
        + "|ceil1|tc3|door2|chest2"; // bust cache — detailed loot chest
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
        if (!isWallType(p.type)) continue;
        const cols = pieceColliders(p);
        for (let c = 0; c < cols.length; c++) buildColliders.push(cols[c]);
      }
      restampBuildGrassClear();
    }

    function uploadGhostMesh(piece, ok) {
      const arr = [];
      if (piece) {
        buildPieceMesh(piece, arr, ok ? [1, 1, 1] : [0, 0, 0]);
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
      const list = piecesInCell(ix, iy, iz);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (isWallType(p.type) && p.yaw === yaw) return true;
      }
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (isWallType(p.type) && p.ix === ix && p.iz === iz && p.iy === iy && p.yaw === yaw) return true;
      }
      return false;
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
        if (circleHitsCell(b.x, b.z, b.r, ix, iz, 0.08)) {
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
      if ((isWallType(type) || isRampType(type)) && !findDeck(ix, iz, iy) && type !== "roof_wall") {
        const blocked = groundBlockedReason(ix, iz);
        if (blocked && !findDeck(ix, iz, iy)) {
          // walls need deck — fall through
        }
      }

      if (isFoundationType(type)) {
        if (iy <= 0) return { ok: true, reason: "" };
        if (!findDeck(ix, iz, iy - 1)) return { ok: false, reason: "sin soporte abajo" };
        return { ok: true, reason: "" };
      }

      if (isWallType(type) && type !== "roof_wall") {
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
          return { ok: true, reason: "" };
        }
        // Ground walls: allowed without foundation at terrain level
        if (iy > 0) return { ok: false, reason: "necesita piso/cimiento" };
        const blocked = groundBlockedReason(ix, iz);
        if (blocked) return { ok: false, reason: blocked };
        if (chunk) {
          cell.baseY = sampleHeight(
            chunk,
            (ix + 0.5) * BUILD_CELL,
            (iz + 0.5) * BUILD_CELL
          );
        }
        return { ok: true, reason: "sobre terreno" };
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
      if (isFloorType(p.type)) return levelWallTopY(base);
      if (p.type === "stairs" || p.type === "stairs_l" || p.type === "ramp") {
        const y0 = base + BUILD_FOUND_H * 0.15;
        let t = 0;
        if (yaw === 0) t = (pz - z0) / cell;
        else if (yaw === 1) t = (px - x0) / cell;
        else if (yaw === 2) t = (z1 - pz) / cell;
        else t = (x1 - px) / cell;
        t = Math.max(0, Math.min(1, t));
        return y0 + BUILD_LEVEL_H * t;
      }
      return pieceAabb(p).maxY;
    }

    function buildSupportY(px, pz, fallbackY) {
      let best = fallbackY;
      const pr = PLAYER_RADIUS * 0.85;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (isWallType(p.type) || isRoofType(p.type)) continue;
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
            ix = p.ix; iz = p.iz; iy = p.iy;
            aimX = (p.ix + 0.5) * BUILD_CELL + (p._ox || 0);
            aimZ = (p.iz + 0.5) * BUILD_CELL + (p._oz || 0);
            const deck = findDeck(ix, iz, iy);
            if (deck) { supportY = deck.baseY; placed = true; }
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
            supportY = sampleHeight(chunk, (ix + 0.5) * BUILD_CELL, (iz + 0.5) * BUILD_CELL);
          }
        }
        {
          const cx0 = (ix + 0.5) * BUILD_CELL;
          const cz0 = (iz + 0.5) * BUILD_CELL;
          const he = furnitureHalfExtents(type, buildYaw);
          const rawOx = aimX != null ? aimX - cx0 : 0;
          const rawOz = aimZ != null ? aimZ - cz0 : 0;
          const clamped = clampFurnitureOffset(ix, iz, iy, rawOx, rawOz, he.hx, he.hz);
          furnOx = clamped.ox;
          furnOz = clamped.oz;
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
      if (!buildMode || !ghostCell || !ghostOk) return false;
      const placed = {
        type: ghostCell.type,
        ix: ghostCell.ix,
        iy: ghostCell.iy,
        iz: ghostCell.iz,
        yaw: ghostCell.yaw,
        baseY: ghostCell.baseY,
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
        enterDeploy("toolcupboard", "Armario · LMB coloca · E abre panel del TC");
      } else if (heldIsWorkbench()) {
        const wt = heldItem.id === "workbench_3" ? 3 : (heldItem.id === "workbench_2" ? 2 : 1);
        deployWbTier = wt;
        enterDeploy("workbench", "Mesa T" + wt + " · LMB coloca · E abre (Tech + ADV)");
      } else if (heldIsResearchTable()) {
        enterDeploy("research_table", "Mesa investigación · LMB coloca · E abre");
      } else if (heldIsCampfire()) {
        enterDeploy("campfire", "Fogata · LMB coloca · calor 4 m");
      } else if (heldIsSleepingBag()) {
        enterDeploy("sleeping_bag", "Saco · LMB coloca · respawn al morir");
      } else if (heldIsBox()) {
        enterDeploy(heldItem.id, (heldItem.id === "box_large" ? "Caja grande" : "Caja pequeña") + " · LMB coloca · E abre");
      } else if (heldIsMetalDoor()) {
        enterDeploy("metal_door", "Puerta metal · LMB coloca (tier Metal)");
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

    const LOCAL_PLAYER_ID = "local";
    const TC_RADIUS = 16.0; // meters — ~5.3 foundations
    const FOUND_MAX_ABOVE_TERRAIN = 3.2; // stilts height limit vs ground
    const STAB_VERT_LOSS = 0.12; // ~12% per level up
    const STAB_FLOOR_STEP = 0.22; // horizontal loss per cell from nearest vertical support
    const STAB_WALL_TAX = 0.02;
    const STAB_ROOF_TAX = 0.08;
    const STAB_MIN = 1.0; // below this → collapse
    const DECAY_TICK_SEC = 30; // upkeep / wilderness check interval
    /** Skip wilderness decay for newly placed pieces (build session). */
    const DECAY_PLACE_GRACE_MS = 15 * 60 * 1000;
    /** Unprotected twig → full decay in ~60 min (was ~100 s). */
    const WILD_DECAY_FULL_SEC = 60 * 60;
    /** Failed TC upkeep: full wall HP loss in ~40 min (was ~200 s for twigs). */
    const UPKEEP_FAIL_FULL_SEC = 40 * 60;
    const SOFT_SIDE_MULT = 10;

    const BUILD_TIERS = [
      { id: "twig", label: "Paja", hp: 50, color: [0.72, 0.62, 0.42], upkeep: 1 },
      { id: "wood", label: "Madera", hp: 250, color: [0.52, 0.36, 0.20], upkeep: 2 },
      { id: "stone", label: "Piedra", hp: 500, color: [0.52, 0.50, 0.46], upkeep: 4 },
      { id: "metal", label: "Metal", hp: 1000, color: [0.42, 0.44, 0.48], upkeep: 8 },
      { id: "armored", label: "Blindado", hp: 2000, color: [0.28, 0.34, 0.42], upkeep: 16 },
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
      const t = BUILD_TIERS[Math.max(0, Math.min(BUILD_TIERS.length - 1, tier | 0))];
      return t.hp;
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
    const DEMOLISH_GRACE_MS = 120000; // 2 min — then the piece is permanent

    function ensurePieceInternals(p) {
      if (!p.id) p.id = nextPieceId++;
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
        if (!p.auth) p.auth = [LOCAL_PLAYER_ID];
      }
      return p;
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

    function tcConsumeUpkeep(tc, amount) {
      syncTcInvFromSlots(tc);
      // Accrue fractional wood so small bases don't burn 1 wood every tick
      if (tc._upkeepDebt == null) tc._upkeepDebt = 0;
      tc._upkeepDebt += Math.max(0, amount);
      if (tc._upkeepDebt < 1) {
        return tcSlotsHaveUpkeep(tc);
      }
      let need = Math.floor(tc._upkeepDebt);
      tc._upkeepDebt -= need;
      const order = ["wood", "stone", "metal", "hq"];
      for (let o = 0; o < order.length && need > 0; o++) {
        const key = order[o];
        for (let i = 0; i < (tc.slots || []).length && need > 0; i++) {
          const s = tc.slots[i];
          if (!s || s.id !== key || s.qty <= 0) continue;
          const use = Math.min(s.qty, need);
          s.qty -= use;
          need -= use;
          if (s.qty <= 0) tc.slots[i] = null;
        }
      }
      syncTcInvFromSlots(tc);
      if (need > 0) {
        // Could not pay full debt — put remainder back so next ticks keep failing
        tc._upkeepDebt += need;
        return false;
      }
      return true;
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
      onHud({ status: "Soft side · " + (p.softInward ? "interior" : "exterior") });
      rebuildBuildMesh();
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

    function tcCovers(tc, x, z) {
      const c = pieceWorldCenter(tc);
      const dx = x - c.x, dz = z - c.z;
      return dx * dx + dz * dz <= TC_RADIUS * TC_RADIUS;
    }

    function privilegeZonesAt(x, z) {
      const zones = [];
      const tcs = listToolCupboards();
      for (let i = 0; i < tcs.length; i++) {
        if (tcCovers(tcs[i], x, z)) zones.push(tcs[i]);
      }
      return zones;
    }

    function isAuthorizedOnTc(tc, playerId) {
      if (!tc || !tc.auth) return false;
      return tc.auth.indexOf(playerId || LOCAL_PLAYER_ID) >= 0;
    }

    /** Rust privilege: blocked in enemy TC; free in wilderness; ok in own TC. */
    function privilegeCheck(x, z) {
      const zones = privilegeZonesAt(x, z);
      if (zones.length === 0) {
        return { ok: true, reason: "", wilderness: true, tc: null };
      }
      let friendly = null;
      for (let i = 0; i < zones.length; i++) {
        if (isAuthorizedOnTc(zones[i], LOCAL_PLAYER_ID)) friendly = zones[i];
        else {
          return { ok: false, reason: "Territorio Bloqueado", wilderness: false, tc: zones[i] };
        }
      }
      return { ok: true, reason: "", wilderness: false, tc: friendly };
    }

    function tcOverlapBlocked(ix, iz, ignoreId) {
      const x = (ix + 0.5) * BUILD_CELL;
      const z = (iz + 0.5) * BUILD_CELL;
      const tcs = listToolCupboards();
      for (let i = 0; i < tcs.length; i++) {
        const tc = tcs[i];
        if (ignoreId && tc.id === ignoreId) continue;
        const c = pieceWorldCenter(tc);
        const dx = x - c.x, dz = z - c.z;
        // Spheres must not overlap → centers farther than 2*R
        if (Math.hypot(dx, dz) < TC_RADIUS * 2 - 0.05) return true;
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
      if (isFoundationType(p.type) || p.type === "floor") {
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

      if (p.type === "toolcupboard") {
        const deck = findDeck(ix, iz, iy);
        if (deck) feeds.push({ piece: deck, weight: 1 });
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
      buildPieces.splice(index, 1);
      recalculateStability();
      rebuildBuildMesh();
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
      spawnBlastFx(x, y, z, radius);
      let hit = 0;
      const doomed = [];
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
      onHud({ status: "Cohete · splash a uniones de pared" });
      return true;
    }
    function tickExplosives(dt) {
      const now = performance.now();
      // Sticky fuses
      for (let i = stickyCharges.length - 1; i >= 0; i--) {
        const c = stickyCharges[i];
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
        buildPushBox(arr, r.x - 0.12, r.y - 0.12, r.z - 0.12, r.x + 0.12, r.y + 0.12, r.z + 0.12, [0.95, 0.75, 0.2]);
        buildPushBox(arr, r.x - 0.08, r.y - 0.35, r.z - 0.08, r.x + 0.08, r.y - 0.12, r.z + 0.08, [1, 0.4, 0.1]);
      }
    }
    function uploadFxMesh() {
      const arr = [];
      if (blastFx.length || rocketProjectiles.length) drawBlastFxOverlay(arr);
      // Sticky charge blink
      const now = performance.now();
      for (let i = 0; i < stickyCharges.length; i++) {
        const c = stickyCharges[i];
        const blink = ((now * 0.008) | 0) % 2 === 0;
        const rgb = c.kind === "c4"
          ? (blink ? [0.95, 0.85, 0.2] : [0.55, 0.45, 0.1])
          : (blink ? [1.0, 0.45, 0.1] : [0.6, 0.25, 0.05]);
        buildPushBox(arr, c.x - 0.18, c.y - 0.1, c.z - 0.14, c.x + 0.18, c.y + 0.22, c.z + 0.14, rgb);
      }
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

    function upgradeCostFor(nextTier) {
      // next: 1 wood, 2 stone, 3 metal, 4 armored/hq
      const costs = [
        null,
        { id: "wood", qty: 50 },
        { id: "stone", qty: 100 },
        { id: "metal", qty: 150 },
        { id: "hq", qty: 200 },
      ];
      return costs[nextTier] || { id: "hq", qty: 200 };
    }

    function upgradePiece(piece) {
      ensurePieceInternals(piece);
      if ((piece.tier | 0) >= BUILD_TIERS.length - 1) {
        onHud({ status: "Ya blindado" });
        return false;
      }
      const next = (piece.tier | 0) + 1;
      const cost = upgradeCostFor(next);
      if (!invConsume(cost.id, cost.qty)) {
        onHud({ status: "Sin " + cost.id + " · ×" + cost.qty + " para " + BUILD_TIERS[next].label });
        return false;
      }
      const ratio = piece.hp / piece.maxHp;
      piece.tier = next;
      piece.maxHp = tierMaxHp(next);
      piece.hp = Math.max(1, Math.ceil(piece.maxHp * Math.max(0.15, ratio)));
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      onHud({ status: "Upgrade · " + BUILD_TIERS[next].label + " · " + piece.maxHp + " HP" });
      return true;
    }

    function repairPiece(piece) {
      ensurePieceInternals(piece);
      if (piece.hp >= piece.maxHp) {
        onHud({ status: "Intacta" });
        return false;
      }
      const miss = piece.maxHp - piece.hp;
      const cost = Math.ceil(miss * 0.05 * (piece.tier + 1));
      const resId = (piece.tier | 0) <= 1 ? "wood" : ((piece.tier | 0) === 2 ? "stone" : ((piece.tier | 0) === 3 ? "metal" : "hq"));
      if (!invConsume(resId, cost)) {
        onHud({ status: "Sin " + resId + " · repair ×" + cost });
        return false;
      }
      piece.hp = piece.maxHp;
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
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
      let total = 0;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        const meta = BUILD_BY_ID[p.type];
        const base = meta && meta.cost != null ? meta.cost : 25;
        const tierMul = BUILD_TIERS[p.tier | 0] ? BUILD_TIERS[p.tier | 0].upkeep : 1;
        total += base * tierMul;
      }
      // 10% small bases → 33% mega bases
      const scale = 0.10 + 0.23 * Math.min(1, pieces.length / 80);
      return total * scale;
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
        // Real daily rate: consume (daily / 86400) * tickSec resources per tick
        const tickNeed = daily * DECAY_TICK_SEC / 86400;
        const hasStock = tcSlotsHaveUpkeep(tc);
        const paid = hasStock && tcConsumeUpkeep(tc, tickNeed);
        if (!paid) {
          // Failed upkeep: slow HP bleed on walls / doors / roofs (not foundations)
          let hit = 0;
          for (let i = 0; i < pcs.length; i++) {
            const p = pcs[i];
            if (!isWallType(p.type) && p.type !== "door" && !isRoofType(p.type)) continue;
            if (pieceInDecayGrace(p)) continue;
            ensurePieceInternals(p);
            const dmg = Math.max(0.05, (p.maxHp || 50) * DECAY_TICK_SEC / UPKEEP_FAIL_FULL_SEC);
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
            onHud({ status: "Decay · TC sin upkeep · paredes debilitadas" });
          }
        }
        if (activeTcId === tc.id) refreshTcPanel();
      }
      // Wilderness soft-decay (no TC cover) — ~1 h for full twig loss; grace while building
      let wildRemoved = false;
      let wildDamaged = false;
      for (let i = buildPieces.length - 1; i >= 0; i--) {
        const p = buildPieces[i];
        if (covered.has(p.id)) continue;
        if (p.type === "toolcupboard" || p.type === "workbench" || p.type === "research_table"
          || p.type === "scrap_barrel" || p.type === "world_ore" || p.type === "world_tree"
          || p.type === "campfire" || p.type === "sleeping_bag"
          || p.type === "box_small" || p.type === "box_large") continue;
        if (pieceInDecayGrace(p)) continue;
        ensurePieceInternals(p);
        const dmg = Math.max(0.05, (p.maxHp || 50) * DECAY_TICK_SEC / WILD_DECAY_FULL_SEC);
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
        const wt = piece.wbTier | 1;
        return invAdd(wt >= 3 ? "workbench_3" : (wt >= 2 ? "workbench_2" : "workbench_1"), 1);
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
      refundDemolishedPiece(piece);
      buildPieces.splice(idx, 1);
      recalculateStability();
      rebuildBuildMesh();
      closeUpgradeMenu();
      playBuildPlace("remove");
      player.attackPulse = true;
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
        '  <button type="button" data-act="demolish">Demoler</button>' +
        '  <button type="button" data-act="upgrade">Mejorar</button>' +
        '  <button type="button" data-act="repair">Reparar</button>' +
        '  <button type="button" data-act="close">Cerrar</button>' +
        "</div>";
      upgradeMenuEl.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        if (act === "close") { closeUpgradeMenu(); return; }
        const piece = buildPieces.find((p) => p.id === upgradeTargetId);
        if (!piece) { closeUpgradeMenu(); return; }
        if (act === "demolish") { demolishPiece(piece); return; }
        if (act === "upgrade") upgradePiece(piece);
        if (act === "repair") repairPiece(piece);
        refreshUpgradeMenu();
      });
      (document.querySelector(".stage") || document.body).appendChild(upgradeMenuEl);
    }

    function refreshUpgradeMenu() {
      if (!upgradeMenuEl) return;
      const piece = buildPieces.find((p) => p.id === upgradeTargetId);
      if (!piece) { closeUpgradeMenu(); return; }
      ensurePieceInternals(piece);
      const tier = piece.tier | 0;
      const next = tier + 1;
      const curLabel = BUILD_TIERS[tier] ? BUILD_TIERS[tier].label : "?";
      const graceEl = upgradeMenuEl.querySelector(".fw-up-grace");
      const demoBtn = upgradeMenuEl.querySelector('[data-act="demolish"]');
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
        pieceEl.textContent = (BUILD_LABELS[piece.type] || piece.type)
          + " · " + Math.ceil(piece.hp) + "/" + piece.maxHp + " HP";
      }
      if (tierEl) {
        if (next >= BUILD_TIERS.length) {
          tierEl.textContent = "Tier · " + curLabel + " (máximo)";
        } else {
          tierEl.textContent = "Tier · " + curLabel + " → " + BUILD_TIERS[next].label
            + " (" + BUILD_TIERS[next].hp + " HP)";
        }
      }
      if (costEl) {
        if (next >= BUILD_TIERS.length) {
          costEl.textContent = "Sin más mejoras";
        } else {
          const cost = upgradeCostFor(next);
          const have = invCount(cost.id);
          costEl.textContent = "Coste · " + cost.qty + " " + cost.id + " (tienes " + have + ")";
          costEl.classList.toggle("is-short", have < cost.qty);
        }
      }
    }

    function openUpgradeMenu(piece) {
      if (!heldIsHammer()) {
        onHud({ status: "Equipa el Martillo" });
        return false;
      }
      ensurePieceInternals(piece);
      ensureUpgradeMenu();
      upgradeTargetId = piece.id;
      upgradeMenuOpen = true;
      upgradeMenuEl.classList.add("is-open");
      refreshUpgradeMenu();
      onHud({ status: "Mejora · " + (BUILD_LABELS[piece.type] || piece.type) });
      // clearLocoKeys is hoisted in this scope — RMB often swallows keyup
      try { clearLocoKeys(); } catch (_) {}
      return true;
    }

    function closeUpgradeMenu() {
      const wasOpen = upgradeMenuOpen;
      upgradeTargetId = null;
      upgradeMenuOpen = false;
      if (upgradeMenuEl) upgradeMenuEl.classList.remove("is-open");
      if (wasOpen) {
        try { clearLocoKeys(); } catch (_) {}
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
      if (!hit) {
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
      tcPanelEl.className = "fw-tc-panel";
      tcPanelEl.innerHTML =
        '<div class="fw-tc-head">ARMARIO DE HERRAMIENTAS</div>' +
        '<div class="fw-tc-sub">Privilege 16 m · 4 slots de upkeep</div>' +
        '<div class="fw-tc-slots" id="fw-tc-slots"></div>' +
        '<div class="fw-tc-upkeep"></div>' +
        '<div class="fw-tc-actions">' +
        '  <button type="button" data-act="dep-wood">+50 Madera</button>' +
        '  <button type="button" data-act="dep-stone">+50 Piedra</button>' +
        '  <button type="button" data-act="dep-metal">+20 Metal</button>' +
        '  <button type="button" data-act="dep-hq">+10 HQM</button>' +
        '  <button type="button" data-act="close">Cerrar</button>' +
        "</div>";
      tcPanelEl.addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-act]");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        if (act === "close") { closeTcPanel(); return; }
        const tc = buildPieces.find((p) => p.id === activeTcId);
        if (!tc) return;
        ensurePieceInternals(tc);
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
        // Stack into existing slot or first empty
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
        for (let i = 0; i < 4; i++) {
          const s = tc.slots[i];
          const el = document.createElement("div");
          el.className = "fw-tc-slot";
          el.textContent = s ? (s.id + " ×" + s.qty) : "vacío";
          grid.appendChild(el);
        }
      }
      const pcs = piecesInTc(tc);
      const daily = dailyUpkeepFor(pcs);
      const up = tcPanelEl.querySelector(".fw-tc-upkeep");
      if (up) {
        syncTcInvFromSlots(tc);
        up.textContent = "Upkeep · " + Math.ceil(daily) + "/día · " + pcs.length
          + " pcs · stock W" + (tc.inv.wood | 0)
          + " S" + (tc.inv.stone | 0)
          + " M" + (tc.inv.metal | 0)
          + " H" + (tc.inv.hq | 0);
      }
    }

    function openTcPanel(tc) {
      ensureTcPanel();
      activeTcId = tc.id;
      tcPanelEl.classList.add("is-open");
      refreshTcPanel();
    }
    function closeTcPanel() {
      activeTcId = null;
      if (tcPanelEl) tcPanelEl.classList.remove("is-open");
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
          return { ok: false, reason: "TC solapado (16 m)" };
        }
        if (furnitureOccupied(ix, iy, iz, null)) {
          return { ok: false, reason: "ya hay un mueble aquí" };
        }
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
          cell.iy = deck.iy;
        } else if (iy === 0 && chunk) {
          const blocked = groundBlockedReason(ix, iz);
          if (blocked) return { ok: false, reason: blocked };
          cell.baseY = sampleHeight(chunk, cx, cz);
        } else {
          return { ok: false, reason: "necesita piso o suelo" };
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

      // Walls: prefer deck socket; otherwise allow direct terrain placement (iy 0)
      if (isWallType(type) && type !== "roof_wall") {
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
        } else if (iy > 0) {
          return { ok: false, reason: "necesita piso/cimiento" };
        } else {
          const blocked = groundBlockedReason(ix, iz);
          if (blocked) return { ok: false, reason: blocked };
          if (!chunk) return { ok: false, reason: "sin terreno" };
          cell.baseY = sampleHeight(chunk, cx, cz);
        }
      }

      const base = __validateBuild(cell);
      if (!base.ok) return base;

      // Stability preview — reject if would be ~0
      if (type === "toolcupboard") return { ok: true, reason: "TC · radio 16 m" };
      if (type === "workbench") return { ok: true, reason: "Mesa · craft <2 m" };
      if (type === "research_table") return { ok: true, reason: "Investigación · E" };
      if (type === "campfire") return { ok: true, reason: "Calor 4 m" };
      if (type === "sleeping_bag") return { ok: true, reason: "Respawn" };
      if (type === "box_small" || type === "box_large") return { ok: true, reason: "Almacén" };
      if (type === "scrap_barrel") return { ok: true, reason: "" };
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
      if ((!buildMode && !deployMode) || !ghostCell || !ghostOk) return false;
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
        const wt = deployWbTier | 1;
        consumeId = wt >= 3 ? "workbench_3" : (wt >= 2 ? "workbench_2" : "workbench_1");
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
        placed.wbTier = snap._placeWbTier | deployWbTier | 1;
      }
      if (placingCamp) {
        placed.slots = [{ id: "wood", qty: 40 }, null];
        placed.lit = true;
      }
      if (placingBag) {
        placed.bagLabel = "Saco #" + placed.id;
        placed.ownerId = LOCAL_PLAYER_ID;
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
      playBuildPlace("place");
      player.attackPulse = true;
      if (placingTc) {
        onHud({ status: "Armario colocado · E para upkeep · radio 16 m" });
        clearDeployIfEmpty("tool_cupboard_item");
        return true;
      }
      if (placingWb) {
        onHud({ status: "Mesa T1 · E abre Tech + ADV" });
        clearDeployIfEmpty("workbench_1");
        clearDeployIfEmpty("workbench_2");
        clearDeployIfEmpty("workbench_3");
        refreshWorkbenchProximity();
        return true;
      }
      if (placingResearch) {
        onHud({ status: "Mesa investigación · E para investigar" });
        clearDeployIfEmpty("research_table");
        return true;
      }
      if (placingCamp) {
        onHud({ status: "Fogata · calor 4 m · mete madera con E" });
        clearDeployIfEmpty("campfire");
        return true;
      }
      if (placingBag) {
        onHud({ status: "Saco listo · respawn aquí al morir" });
        clearDeployIfEmpty("sleeping_bag");
        return true;
      }
      if (placingBox) {
        onHud({ status: "Caja · E abre · dispersa el botín" });
        clearDeployIfEmpty(snap.type);
        return true;
      }
      if (placingMetalDoor) {
        onHud({ status: "Puerta metal colocada · 1000 HP" });
        clearDeployIfEmpty("metal_door");
        return true;
      }
      makeGhostFromRay();
      const st = Math.round(placed.stability || 0);
      onHud({
        status: "Build · " + BUILD_LABELS[placed.type]
          + " · " + st + "% · " + BUILD_TIERS[0].label
          + " · ×" + buildPieces.length,
      });
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
      buildPieces.splice(hitB.index, 1);
      recalculateStability();
      rebuildBuildMesh();
      makeGhostFromRay();
      playBuildPlace("remove");
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
        // Painted metal door leaf — sits on the same deck as the doorway frame
        const rgb = [0.38, 0.42, 0.46];
        const cell = BUILD_CELL;
        const x0 = piece.ix * cell, z0 = piece.iz * cell;
        const x1 = x0 + cell, z1 = z0 + cell;
        const y0 = wallSeatY(piece);
        const y1 = y0 + BUILD_DOOR_H;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const open = !!piece.isOpen;
        const t = 0.08;
        const w = BUILD_DOOR_W;
        const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
        const hinge = mid - w * 0.5;
        if (yaw === 0) {
          if (!open) buildPushBox(arr, hinge, y0, z1 - t - 0.02, hinge + w, y1, z1 - 0.02, rgb);
          else buildPushBox(arr, hinge - 0.02, y0, z1 - w, hinge + t, y1, z1, rgb);
        } else if (yaw === 2) {
          if (!open) buildPushBox(arr, hinge, y0, z0 + 0.02, hinge + w, y1, z0 + t + 0.02, rgb);
          else buildPushBox(arr, hinge - 0.02, y0, z0, hinge + t, y1, z0 + w, rgb);
        } else if (yaw === 1) {
          if (!open) buildPushBox(arr, x1 - t - 0.02, y0, hinge, x1 - 0.02, y1, hinge + w, rgb);
          else buildPushBox(arr, x1 - w, y0, hinge - 0.02, x1, y1, hinge + t, rgb);
        } else {
          if (!open) buildPushBox(arr, x0 + 0.02, y0, hinge, x0 + t + 0.02, y1, hinge + w, rgb);
          else buildPushBox(arr, x0, y0, hinge - 0.02, x0 + w, y1, hinge + t, rgb);
        }
        // Handle
        const hy0 = y0 + BUILD_DOOR_H * 0.48;
        const hy1 = hy0 + 0.18;
        if (!open) {
          if (yaw === 0) buildPushBox(arr, hinge + w - 0.18, hy0, z1 - 0.01, hinge + w - 0.06, hy1, z1 + 0.03, [0.7, 0.55, 0.2]);
          else if (yaw === 2) buildPushBox(arr, hinge + w - 0.18, hy0, z0 - 0.03, hinge + w - 0.06, hy1, z0 + 0.01, [0.7, 0.55, 0.2]);
          else if (yaw === 1) buildPushBox(arr, x1 - 0.01, hy0, hinge + w - 0.18, x1 + 0.03, hy1, hinge + w - 0.06, [0.7, 0.55, 0.2]);
          else buildPushBox(arr, x0 - 0.03, hy0, hinge + w - 0.18, x0 + 0.01, hy1, hinge + w - 0.06, [0.7, 0.55, 0.2]);
        }
        return;
      }
      if (piece.type === "toolcupboard") {
        // Distinct locker look — painted steel, not wall wood grain
        const cell = BUILD_CELL;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.06;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const body = [0.22, 0.38, 0.34];      // green-teal metal
        const doorCol = [0.18, 0.32, 0.28];
        const trim = [0.55, 0.48, 0.28];      // brass
        const metal = [0.62, 0.64, 0.68];
        const dark = [0.12, 0.18, 0.16];
        function tcBox(lx0, ly0, lz0, lx1, ly1, lz1, col) {
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
          buildPushBox(arr, minX, base + ly0, minZ, maxX, base + ly1, maxZ, col);
        }
        tcBox(-0.44, 0.00, -0.27, 0.44, 0.08, 0.27, dark);
        tcBox(-0.40, 0.08, -0.24, 0.40, 1.42, 0.22, body);
        tcBox(-0.38, 0.12, -0.24, 0.38, 1.38, -0.18, dark);
        tcBox(-0.39, 0.45, -0.16, -0.34, 0.50, 0.18, trim);
        tcBox(0.34, 0.45, -0.16, 0.39, 0.50, 0.18, trim);
        tcBox(-0.39, 0.95, -0.16, -0.34, 1.00, 0.18, trim);
        tcBox(0.34, 0.95, -0.16, 0.39, 1.00, 0.18, trim);
        tcBox(-0.38, 0.14, 0.22, -0.015, 1.36, 0.275, doorCol);
        tcBox(0.015, 0.14, 0.22, 0.38, 1.36, 0.275, doorCol);
        tcBox(-0.02, 0.12, 0.21, 0.02, 1.38, 0.28, trim);
        tcBox(-0.38, 0.14, 0.27, -0.015, 0.18, 0.29, metal);
        tcBox(0.015, 0.14, 0.27, 0.38, 0.18, 0.29, metal);
        tcBox(-0.38, 1.32, 0.27, -0.015, 1.36, 0.29, metal);
        tcBox(0.015, 1.32, 0.27, 0.38, 1.36, 0.29, metal);
        tcBox(-0.10, 0.72, 0.275, -0.04, 0.90, 0.305, metal);
        tcBox(0.04, 0.72, 0.275, 0.10, 0.90, 0.305, metal);
        tcBox(-0.45, 1.42, -0.28, 0.45, 1.52, 0.30, body);
        tcBox(-0.42, 1.52, -0.25, 0.42, 1.58, 0.26, trim);
        tcBox(-0.05, 0.78, 0.28, 0.05, 0.88, 0.31, metal);
        return;
      }
      if (piece.type === "workbench") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.04;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const wood = [0.42, 0.28, 0.14];
        const steel = [0.45, 0.48, 0.52];
        // table top
        buildPushBox(arr, cx - 0.7, base + 0.72, cz - 0.4, cx + 0.7, base + 0.86, cz + 0.4, wood);
        // legs
        buildPushBox(arr, cx - 0.62, base, cz - 0.32, cx - 0.5, base + 0.72, cz - 0.2, wood);
        buildPushBox(arr, cx + 0.5, base, cz - 0.32, cx + 0.62, base + 0.72, cz - 0.2, wood);
        buildPushBox(arr, cx - 0.62, base, cz + 0.2, cx - 0.5, base + 0.72, cz + 0.32, wood);
        buildPushBox(arr, cx + 0.5, base, cz + 0.2, cx + 0.62, base + 0.72, cz + 0.32, wood);
        // vise / anvil bits
        buildPushBox(arr, cx + 0.25, base + 0.86, cz - 0.1, cx + 0.55, base + 1.05, cz + 0.15, steel);
        buildPushBox(arr, cx - 0.5, base + 0.86, cz - 0.15, cx - 0.15, base + 0.98, cz + 0.1, [0.3, 0.32, 0.36]);
        // tier badge color
        const tier = piece.wbTier | 1;
        const badge = tier >= 3 ? [0.75, 0.35, 0.85] : (tier >= 2 ? [0.85, 0.55, 0.2] : [0.85, 0.65, 0.2]);
        buildPushBox(arr, cx - 0.12, base + 0.88, cz + 0.22, cx + 0.12, base + 1.02, cz + 0.38, badge);
        // range ticks (2 m)
        for (let s = 0; s < 12; s++) {
          const a = (s / 12) * Math.PI * 2;
          const px = cx + Math.cos(a) * WORKBENCH_RANGE;
          const pz = cz + Math.sin(a) * WORKBENCH_RANGE;
          buildPushBox(arr, px - 0.05, base + 0.02, pz - 0.05, px + 0.05, base + 0.12, pz + 0.05, badge);
        }
        return;
      }
      if (piece.type === "research_table") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.04;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const wood = [0.38, 0.26, 0.16];
        const paper = [0.85, 0.82, 0.72];
        const ink = [0.2, 0.35, 0.55];
        buildPushBox(arr, cx - 0.65, base + 0.7, cz - 0.45, cx + 0.65, base + 0.82, cz + 0.45, wood);
        buildPushBox(arr, cx - 0.55, base, cz - 0.35, cx - 0.45, base + 0.7, cz - 0.25, wood);
        buildPushBox(arr, cx + 0.45, base, cz - 0.35, cx + 0.55, base + 0.7, cz - 0.25, wood);
        buildPushBox(arr, cx - 0.55, base, cz + 0.25, cx - 0.45, base + 0.7, cz + 0.35, wood);
        buildPushBox(arr, cx + 0.45, base, cz + 0.25, cx + 0.55, base + 0.7, cz + 0.35, wood);
        // blueprint sheet
        buildPushBox(arr, cx - 0.35, base + 0.82, cz - 0.25, cx + 0.35, base + 0.86, cz + 0.25, paper);
        buildPushBox(arr, cx - 0.25, base + 0.86, cz - 0.02, cx + 0.25, base + 0.88, cz + 0.02, ink);
        buildPushBox(arr, cx - 0.02, base + 0.86, cz - 0.2, cx + 0.02, base + 0.88, cz + 0.2, ink);
        return;
      }
      if (piece.type === "campfire") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.02;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const log = [0.35, 0.22, 0.1];
        const flame = piece.lit ? [1.0, 0.45, 0.12] : [0.25, 0.2, 0.15];
        buildPushBox(arr, cx - 0.35, base, cz - 0.08, cx + 0.35, base + 0.16, cz + 0.08, log);
        buildPushBox(arr, cx - 0.08, base, cz - 0.35, cx + 0.08, base + 0.16, cz + 0.35, log);
        buildPushBox(arr, cx - 0.12, base + 0.16, cz - 0.12, cx + 0.12, base + 0.55, cz + 0.12, flame);
        if (piece.lit) {
          buildPushBox(arr, cx - 0.06, base + 0.55, cz - 0.06, cx + 0.06, base + 0.75, cz + 0.06, [1.0, 0.75, 0.25]);
        }
        return;
      }
      if (piece.type === "sleeping_bag") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const onDeck = !!findDeck(piece.ix, piece.iz, piece.iy);
        const lift = onDeck ? BUILD_FOUND_H : 0.03;
        const base = piece.baseY + piece.iy * BUILD_LEVEL_H + lift;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const col = [0.2, 0.45, 0.3];
        if (yaw === 0 || yaw === 2) {
          buildPushBox(arr, cx - 0.55, base, cz - 0.28, cx + 0.55, base + 0.18, cz + 0.28, col);
        } else {
          buildPushBox(arr, cx - 0.28, base, cz - 0.55, cx + 0.28, base + 0.18, cz + 0.55, col);
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
        const big = piece.type === "box_large";
        const w = big ? 0.55 : 0.38;
        const h = big ? 0.55 : 0.38;
        const wood = [0.42, 0.28, 0.14];
        buildPushBox(arr, cx - w, base, cz - w * 0.8, cx + w, base + h, cz + w * 0.8, wood);
        buildPushBox(arr, cx - w, base + h, cz - w * 0.8, cx + w, base + h + 0.06, cz + w * 0.8, [0.32, 0.2, 0.1]);
        return;
      }
      if (piece.type === "scrap_barrel") {
        const cell = BUILD_CELL;
        const cx = (piece.ix + 0.5) * cell + (piece._ox || 0);
        const cz = (piece.iz + 0.5) * cell + (piece._oz || 0);
        const base = (piece.baseY || 0) + 0.02;
        // Rust-like wooden loot chest — planks, iron bands, brass lock, arched lid
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
          minY: base, maxY: base + 1.58,
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
        return {
          minX: cx - he.hx, maxX: cx + he.hx,
          minY: base, maxY: base + 1.05,
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
        const h = p.type === "campfire" ? 0.8 : (p.type === "sleeping_bag" ? 0.25 : 0.65);
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
        return {
          minX: cx - 0.68, maxX: cx + 0.68,
          minY: base, maxY: base + 0.78,
          minZ: cz - 0.48, maxZ: cz + 0.48,
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
          workbenchTierNear = Math.max(workbenchTierNear, p.wbTier | 1);
          comfort = Math.max(comfort, 0.35);
          vitals.nearHeat = true;
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

    function syncVitalsDom() {
      const hpEl = document.getElementById("fw-hp-text");
      const hpFill = document.getElementById("fw-hp-fill");
      const huEl = document.getElementById("fw-hunger-text");
      const huFill = document.getElementById("fw-hunger-fill");
      const temp = document.getElementById("fw-temp");
      const conf = document.getElementById("fw-comfort");
      if (hpEl) hpEl.textContent = Math.ceil(vitals.hp) + " / " + MAX_HP;
      if (hpFill) hpFill.style.width = Math.max(0, Math.min(100, (vitals.hp / MAX_HP) * 100)) + "%";
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
          if (p.lit) { p.lit = false; invalidatePieceMesh(p); rebuildBuildMesh(); }
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
        ? "SOFT SIDE · vulnerable (Y voltea)"
        : "HARD SIDE · exterior OK";
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
      for (let i = 0; i < bags.length; i++) {
        const bag = bags[i];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = (bag.bagLabel || ("Saco #" + bag.id)) + " · celda " + bag.ix + "," + bag.iz;
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
      syncVitalsDom();
      onHud({ status: bag ? "Respawn en saco" : "Respawn en costa" });
    }

    function tryEatFood() {
      if (!heldIsFood()) return false;
      if (!invConsume("food", 1)) return false;
      vitals.hunger = Math.min(MAX_HUNGER, vitals.hunger + 75);
      syncVitalsDom();
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
              refreshBoxPanel();
              return;
            }
          }
          onHud({ status: "Nada que depositar" });
        });
        (document.querySelector(".stage") || document.body).appendChild(boxPanelEl);
      }
      activeBoxId = box.id;
      boxPanelEl.classList.add("is-open");
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
        el.className = "fw-box-slot";
        el.setAttribute("data-slot", String(i));
        el.textContent = s ? (s.id + " ×" + s.qty) : "vacío";
        grid.appendChild(el);
      }
    }
    function closeBoxPanel() {
      activeBoxId = null;
      if (boxPanelEl) boxPanelEl.classList.remove("is-open");
    }

    function openCampfirePanel(cf) {
      // Quick: deposit 20 wood into campfire
      ensurePieceInternals(cf);
      if (!Array.isArray(cf.slots)) cf.slots = [null, null];
      if (!invConsume("wood", 20)) {
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
      if (!put) { invAdd("wood", 20); onHud({ status: "Fogata llena" }); return; }
      cf.lit = true;
      invalidatePieceMesh(cf);
      rebuildBuildMesh();
      onHud({ status: "Fogata · +20 madera · calor ON" });
    }

    // Decay + vitals in update loop
    let __aaaUpdateHook = function (dt) {
      tickDecay(dt);
      tickVitals(dt);
      tickResourceRespawn(dt);
      tickExplosives(dt);
      if (blastFx.length || rocketProjectiles.length || stickyCharges.length) uploadFxMesh();
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
        cpu[o + 1] = -999; // bury below world
      }
      try {
        const byteOff = start * stride * 4;
        const byteLen = count * stride * 4;
        device.queue.writeBuffer(vbo, byteOff, cpu.buffer, cpu.byteOffset + byteOff, byteLen);
      } catch (_) {}
    }

    function harvestNodeAabb(n) {
      const h = n.kind === "tree" ? 4.5 : (n.kind === "barrel" ? 0.7 : Math.max(1.8, (n.r || 0.7) * 2.4));
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
        sinkHarvestMesh(n);
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
          scheduleResourceRespawn("barrel");
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
        '<div class="fw-chat-log" id="fw-chat-log"><div class="fw-chat-line muted">Chat local (stub) · Enter envía</div></div>' +
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
      chatOpen = !!on;
      if (!chatEl) return;
      chatEl.classList.toggle("is-open", chatOpen);
      if (chatOpen) {
        try { exitAimLock(); } catch (_) {}
        const input = chatEl.querySelector("#fw-chat-input");
        try { input.focus(); } catch (_) {}
      } else {
        try { canvas.focus(); } catch (_) {}
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
    }
    function setCraftOpen(on) {
      ensureCraftUi();
      if (!progApi) {
        craftOpen = !!on;
        onHud({ status: "Cargando fabricación…" });
        return;
      }
      if (on) {
        progApi.openCraft();
        craftOpen = true;
      } else {
        progApi.close();
        craftOpen = false;
      }
    }
    function openWorkbenchUI() {
      ensureCraftUi();
      if (!progApi) return false;
      progApi.openWorkbench();
      craftOpen = true;
      return true;
    }
    function openResearchUI() {
      ensureCraftUi();
      if (!progApi) return false;
      progApi.openResearch();
      craftOpen = true;
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

    function runUseAction(act, piece) {
      if (!piece) return;
      if (act === "door_toggle") {
        ensurePieceInternals(piece);
        if (piece.locked && !isAuthorizedOnDoor(piece, LOCAL_PLAYER_ID)) {
          onHud({ status: "Puerta bloqueada" });
          return;
        }
        piece.isOpen = !piece.isOpen;
        invalidatePieceMesh(piece);
        rebuildBuildMesh();
        onHud({ status: piece.isOpen ? "Puerta abierta" : "Puerta cerrada" });
      } else if (act === "door_lock") {
        tryInstallLockOnDoor(piece);
      } else if (act === "tc_open") {
        openTcPanel(piece);
      } else if (act === "wb_open") {
        openWorkbenchUI();
      } else if (act === "res_open") {
        openResearchUI();
      } else if (act === "fire_fuel") {
        openCampfirePanel(piece);
      } else if (act === "box_open") {
        openBoxPanel(piece);
      } else if (act === "bag_info") {
        onHud({ status: "Saco activo · respawn aquí al morir" });
      }
    }

    /** E tap: open WB / Research / TC / boxes / fire / door */
    function tryUseAimed() {
      const piece = rayHitUseTarget(3.2);
      if (!piece) {
        if (tryToggleNearbyDoor()) return true;
        onHud({ status: "Nada que usar · mira mesa / caja / fogata / puerta" });
        return false;
      }
      if (piece.type === "workbench") return openWorkbenchUI();
      if (piece.type === "research_table") return openResearchUI();
      if (piece.type === "toolcupboard") { openTcPanel(piece); return true; }
      if (piece.type === "campfire") { openCampfirePanel(piece); return true; }
      if (piece.type === "box_small" || piece.type === "box_large") { openBoxPanel(piece); return true; }
      if (piece.type === "sleeping_bag") {
        onHud({ status: "Saco de dormir · punto de respawn" });
        return true;
      }
      if (piece.type === "door") {
        ensurePieceInternals(piece);
        if (heldIsLock() && !piece.locked) return tryInstallLockOnDoor(piece);
        if (piece.locked && !isAuthorizedOnDoor(piece, LOCAL_PLAYER_ID)) {
          onHud({ status: "Puerta bloqueada · sin acceso" });
          return true;
        }
        piece.isOpen = !piece.isOpen;
        invalidatePieceMesh(piece);
        rebuildBuildMesh();
        onHud({ status: piece.isOpen ? "Puerta abierta" : "Puerta cerrada" });
        return true;
      }
      return false;
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
          if (progApi && progApi.isOpen()) {
            setCraftOpen(false);
            return true;
          }
          return false;
        };
        window.__fw.openWorkbenchUI = openWorkbenchUI;
        window.__fw.openResearchUI = openResearchUI;
      }
    } catch (_) {}

    function isAuthorizedOnDoor(door, playerId) {
      if (!door || !door.auth) return false;
      return door.auth.indexOf(playerId || LOCAL_PLAYER_ID) >= 0;
    }

    function tryInstallLockOnDoor(door) {
      ensurePieceInternals(door);
      if (door.locked) {
        onHud({ status: "Ya tiene cerradura" });
        return false;
      }
      if (!invConsume("key_lock", 1)) {
        onHud({ status: "Sin Cerradura" });
        return false;
      }
      door.locked = true;
      door.auth = [LOCAL_PLAYER_ID];
      if (door.isOpen) door.isOpen = false;
      invalidatePieceMesh(door);
      rebuildBuildMesh();
      onHud({ status: "Cerradura instalada · solo tú abres" });
      return true;
    }

    function tryLockAimed() {
      if (!heldIsLock()) return false;
      const ray = camBuildRay();
      if (!ray) return false;
      const hit = rayHitBuilds(ray.o, ray.d);
      if (!hit || hit.t > 3.2 || hit.piece.type !== "door") {
        return tryToggleNearbyDoor();
      }
      return tryInstallLockOnDoor(hit.piece);
    }

    function tryToggleNearbyDoor() {
      let best = null;
      let bestD = 2.4;
      for (let i = 0; i < buildPieces.length; i++) {
        const p = buildPieces[i];
        if (p.type !== "door") continue;
        const c = pieceWorldCenter(p);
        const d = Math.hypot(c.x - player.x, c.z - player.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (!best) return false;
      ensurePieceInternals(best);
      if (heldIsLock() && !best.locked) {
        return tryInstallLockOnDoor(best);
      }
      if (best.locked && !isAuthorizedOnDoor(best, LOCAL_PLAYER_ID)) {
        onHud({ status: "Puerta bloqueada · sin acceso" });
        return true;
      }
      best.isOpen = !best.isOpen;
      invalidatePieceMesh(best);
      rebuildBuildMesh();
      onHud({
        status: (best.isOpen ? "Puerta abierta" : "Puerta cerrada")
          + (best.locked ? " · 🔒" : ""),
      });
      return true;
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
      const flowerDens = [0.38, 0.22, 0.20, 0.16, 0.28, 0.14]; // meadow dry forest snow marsh desert
      const flowerSpacing = 9.5;
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
      const estRockR = (scale) => Math.max(0.5, scale * 0.95);
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
          // Wide size mix: pebbles → big boulders
          const scale = 0.4 + hash(rx * 1.1 + rz * 3.3) * 1.7;
          const yaw = hash(rz * 6.2 - rx) * Math.PI * 2;
          const phase = hash(rx * 0.8 + rz * 1.4);
          rockCandidates.push({ x: rx, y: ry0 + 0.015, z: rz, kind, scale, yaw, phase });
          // Occasional pebble nearby — keep clear of the main stone
          if (hash(rx * 4.1 + 9) > 0.72) {
            const ox = rx + (hash(rz + 1) > 0.5 ? 1 : -1) * (1.8 + hash(rx) * 1.4) * scale;
            const oz = rz + (hash(rx + 2) > 0.5 ? 1 : -1) * (1.8 + hash(rz) * 1.4) * scale;
            if (islandEdge(ox, oz) <= 0.08) {
              const oy2 = sampleHeight(chunk, ox, oz) + 0.015;
              if (oy2 >= 0.02) {
                const sc2 = scale * (0.28 + hash(ox) * 0.28);
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
            pushCross(wx, wy, wz, corners01, species, scale, yaw, phase, 0, 4);
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
            buildBlockers.push({ x: wx, z: wz, r: clear, kind: "tree" });
            harvestNodes.push({
              kind: "tree", x: wx, y: wy, z: wz, r: Math.max(0.55, clear * 0.5),
              hp: 250, maxHp: 250, dropId: "wood", dropPerHit: 40, dead: false,
              meshStart: treeVertStart | 0, meshCount: 0,
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
              // Soft conical pine — stacked canopy discs (no shard skirts)
              const trunkH = (species === 6 ? 3.1 : species === 9 ? 3.2 : 2.9) * scale;
              const nLayers = species === 6 ? 7 : species === 9 ? 8 : 7;
              for (let li = 0; li < nLayers; li++) {
                const t = li / (nLayers - 1);
                const ty = wy + trunkH * (0.22 + t * 0.78);
                // Cone: wide base → narrow tip
                const layerR = scale * (1.55 - t * 1.15) * (species === 9 ? 1.12 : 1.0);
                const layerPh = phase + t * 0.85;
                const yawL = yaw + li * 0.37;
                // Center plate
                pushCross(wx, ty, wz, corners11, species, layerR, yawL, layerPh, 2, 4);
                // Ring of overlapping puffs for volume
                const nRing = t > 0.85 ? 3 : 5;
                for (let ri = 0; ri < nRing; ri++) {
                  const a = yawL + (ri / nRing) * Math.PI * 2 + hash(li * 9 + ri) * 0.4;
                  const out = layerR * (0.28 + hash(li + ri * 3.1) * 0.18);
                  pushCross(
                    wx + Math.cos(a) * out,
                    ty - (0.02 + (1.0 - t) * 0.06) * scale,
                    wz + Math.sin(a) * out,
                    corners11,
                    species,
                    layerR * (0.55 + hash(ri * 2.2 + li) * 0.25),
                    a,
                    layerPh + ri * 0.04,
                    2,
                    3
                  );
                }
              }
              // Soft tip
              pushCross(wx, wy + trunkH * 1.02, wz, corners11, species, scale * 0.42, yaw, phase + 0.9, 2, 3);
              pushCross(wx, wy + trunkH * 1.12, wz, corners11, species, scale * 0.22, yaw + 0.5, phase + 0.95, 3, 2);
            } else if (isPalm) {
              // Palm — tall trunk already drawn; radiating frond discs + a few droops
              const trunkH = 3.9 * scale;
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
                  crownY - (0.2 + hash(di) * 0.35) * scale,
                  wz + Math.sin(a) * rr,
                  corners11, species, scale * 0.55, a, phase + 0.1, 2, 2
                );
              }
            } else if (species === 3) {
              // Willow + tropism: umbrella + long hanging curtains
              const trunkH = 3.35 * scale;
              for (let bi = 0; bi < 5; bi++) {
                const by = wy + trunkH * (0.5 + bi * 0.08 + hash(wx + bi * 9) * 0.03);
                const bYaw = yaw + bi * PHYLLO + phase;
                pushCross(wx, by, wz, corners01, species, scale * 0.92, bYaw, phase + bi * 0.06, 1, 2);
              }
              const crownY = wy + trunkH * 0.92;
              for (let pi = 0; pi < 8; pi++) {
                const a = yaw + pi * PHYLLO + phase;
                const rr = (0.15 + hash(wz + pi * 3.1) * 0.4) * scale;
                const px = wx + Math.cos(a) * rr;
                const pz = wz + Math.sin(a) * rr;
                const py = crownY + (0.02 + hash(px + pi) * 0.3) * scale;
                pushCross(px, py, pz, corners11, species, scale * (0.5 + hash(pi) * 0.22), a, (phase * 0.3 + pi * 0.04) % 0.65, 2, 3);
              }
              pushCross(wx, crownY + 0.18 * scale, wz, corners11, species, scale * 0.75, yaw, phase * 0.35 % 0.65, 2, 3);
              // Long hanging curtains (tropism down)
              for (let hi = 0; hi < 12; hi++) {
                const a = yaw + hi * PHYLLO * 0.85 + phase * 1.3;
                const rr = (0.35 + hash(wx + hi * 4.1) * 0.4) * scale;
                const px = wx + Math.cos(a) * rr;
                const pz = wz + Math.sin(a) * rr;
                const py = crownY - (0.25 + hash(hi + phase) * 0.55) * scale;
                const hPhase = 0.72 + hash(hi * 1.7) * 0.26;
                pushCross(px, py, pz, corners11, species, scale * (0.48 + hash(hi) * 0.18), a, hPhase, 2, 3);
              }
            } else {
              // Deciduous: phyllotaxis crown + tip leaf cards (sedon recursive feel)
              const trunkH = (
                species === 4 ? 1.5 :
                species === 2 ? 3.55 :
                species === 7 ? 3.6 :
                species === 8 ? 4.5 :
                3.2
              ) * scale;
              const nBr = species === 4 ? 4 : (species === 8 ? 5 : species === 2 || species === 7 ? 6 : 7);
              const branchTips = [];
              for (let bi = 0; bi < nBr; bi++) {
                const tAlong = 0.35 + bi * 0.08;
                const by = wy + trunkH * (tAlong + hash(wx + bi * 9) * 0.04);
                const bYaw = yaw + bi * PHYLLO + phase;
                const bLen = scale * (0.9 + bi * 0.05);
                pushCross(wx, by, wz, corners01, species, bLen, bYaw, phase + bi * 0.05, 1, 3);
                // Tip position for leaf cards
                const tipR = (0.35 + bi * 0.08) * scale;
                branchTips.push({
                  x: wx + Math.cos(bYaw) * tipR,
                  y: by + 0.25 * scale,
                  z: wz + Math.sin(bYaw) * tipR,
                  a: bYaw,
                });
              }
              const crownY = wy + trunkH * (species === 4 ? 0.84 : 0.9);
              const nPlanes = species === 4 ? 4 : 5;

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
                // Height: lower near rim, taller near core (dome)
                const hDome = Math.max(0, 1.0 - (rr / (1.35 * scale)) * (rr / (1.35 * scale)));
                const py = crownY + (hDome * 0.95 + hash(px + pi) * 0.35 - 0.12) * scale
                  * (species === 4 ? 0.55 : species === 8 ? 1.35 : 1.05);
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

      // Scrap chests — break for 2–10 scrap
      let nBarrels = 0;
      for (let bi = 0; bi < 16; bi++) {
        const ang = (bi / 16) * Math.PI * 2 + chunk.seed * 0.07;
        const rad = 18 + (bi % 5) * 3.5 + hash(bi * 17.3 + chunk.seed) * 4;
        const bx = chunk.origin_x + Math.cos(ang) * rad;
        const bz = chunk.origin_z + Math.sin(ang) * rad;
        if (islandEdge(bx, bz) > 0.08) continue;
        const by = sampleHeight(chunk, bx, bz);
        if (by < SEA_Y + 0.12) continue;
        const ix = Math.floor(bx / BUILD_CELL);
        const iz = Math.floor(bz / BUILD_CELL);
        const ox = bx - (ix + 0.5) * BUILD_CELL;
        const oz = bz - (iz + 0.5) * BUILD_CELL;
        const barrel = ensurePieceInternals({
          type: "scrap_barrel",
          ix, iy: 0, iz, yaw: 0,
          baseY: by,
          tier: 0,
          ownerId: "world",
          _ox: ox,
          _oz: oz,
        });
        buildPieces.push(barrel);
        harvestNodes.push({
          kind: "barrel",
          x: bx, y: by, z: bz, r: 0.5,
          hp: 55, maxHp: 55,
          dropId: "scrap",
          dropPerHit: 3,
          pieceId: barrel.id,
          dead: false,
        });
        buildBlockers.push({ x: bx, z: bz, r: 0.7, kind: "rock" });
        nBarrels++;
      }
      if (nBarrels) rebuildBuildMesh();

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
    function requestAimLock() {
      if (!controlsEnabled || mapOpen || chatOpen || craftOpen || vitals.dead) return;
      if (isAimLocked()) return;
      try {
        const p = canvas.requestPointerLock && canvas.requestPointerLock();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (_) {}
    }
    function exitAimLock() {
      try {
        if (isAimLocked()) document.exitPointerLock();
      } catch (_) {}
    }
    function applyLookDelta(dx, dy) {
      if (!controlsEnabled || mapOpen || chatOpen || craftOpen || vitals.dead) return;
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
        fpvPitch = -0.06;
        orbitYaw = player.yaw;
      }
      camMode = next;
      syncStageCamFlags();
      const label = next === "fpv" ? "1ª persona" : (next === "orbit" ? "Órbita libre" : "3ª persona");
      onHud({ status: "Cámara · " + label + " (C) · RMB mira" });
    }

    // --- FE audio: grass_field BGM + noise bed + footstep oneshots ---
    const audio = {
      ctx: null,
      master: null,
      soundOn: true,
      unlocked: false,
      bgm: null,
      noise: null,
      steps: [],
      stepIdx: 0,
      stepCd: 0,
      hammers: [],
      hammerIdx: 0,
      loading: null,
    };

    async function ensureAudio() {
      if (audio.ctx) return audio.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = audio.soundOn ? 1 : 0;
      audio.master.connect(audio.ctx.destination);
      return audio.ctx;
    }

    async function loadAudioBuffer(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(url + " " + res.status);
      const buf = await res.arrayBuffer();
      return audio.ctx.decodeAudioData(buf.slice(0));
    }

    function startLoop(buffer, volume, loop) {
      if (!audio.ctx || !buffer) return null;
      const src = audio.ctx.createBufferSource();
      const gain = audio.ctx.createGain();
      gain.gain.value = volume;
      src.buffer = buffer;
      src.loop = !!loop;
      src.connect(gain);
      gain.connect(audio.master);
      try { src.start(0); } catch (_) {}
      return { src, gain };
    }

    async function unlockAudio() {
      if (audio.unlocked) return;
      audio.unlocked = true;
      try {
        await ensureAudio();
        if (!audio.ctx) return;
        if (audio.ctx.state === "suspended") await audio.ctx.resume();
        if (!audio.loading) {
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
          ]).then(([field, noise, s1, s2, s3, s4, s5, h1, h2]) => {
            audio.bgm = startLoop(field, 1.5, true); // FE volume 1.5
            audio.noise = startLoop(noise, 0.1, true);
            audio.steps = [s1, s2, s3, s4, s5];
            audio.hammers = [h1, h2].filter(Boolean);
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

    function playStep(volume) {
      if (!audio.soundOn || !audio.ctx || !audio.steps.length) return;
      const buf = audio.steps[audio.stepIdx % audio.steps.length];
      audio.stepIdx++;
      const src = audio.ctx.createBufferSource();
      const gain = audio.ctx.createGain();
      const detune = (Math.random() * 2 - 1) * 200; // FE detuneRange 200
      src.buffer = buf;
      try { src.detune.value = detune; } catch (_) {}
      gain.gain.value = Math.max(0.05, Math.min(1, volume == null ? 0.55 : volume));
      src.connect(gain);
      gain.connect(audio.master);
      try { src.start(0); } catch (_) {}
    }

    /** Rust-like wood nail hammer (CC0 BigSoundBank) — short hit slice + procedural fallback. */
    function playBuildPlace(kind) {
      unlockAudio();
      if (!audio.soundOn || !audio.ctx) return;
      const vol = kind === "remove" ? 0.42 : 0.72;
      if (audio.hammers && audio.hammers.length) {
        const buf = audio.hammers[audio.hammerIdx % audio.hammers.length];
        audio.hammerIdx++;
        const src = audio.ctx.createBufferSource();
        const gain = audio.ctx.createGain();
        src.buffer = buf;
        try { src.playbackRate.value = 0.92 + Math.random() * 0.18; } catch (_) {}
        try { src.detune.value = (Math.random() * 2 - 1) * 120; } catch (_) {}
        const t0 = audio.ctx.currentTime;
        gain.gain.setValueAtTime(vol, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.45);
        src.connect(gain);
        gain.connect(audio.master);
        // Pick a random nail hit inside the longer recording
        const maxOff = Math.max(0, buf.duration - 0.5);
        const offset = Math.random() * maxOff;
        try { src.start(0, offset, 0.38 + Math.random() * 0.12); } catch (_) {}
        return;
      }
      // Procedural fallback: wood thud + metallic nail click
      try {
        const t0 = audio.ctx.currentTime;
        const thump = audio.ctx.createOscillator();
        const thumpG = audio.ctx.createGain();
        thump.type = "triangle";
        thump.frequency.setValueAtTime(140 + Math.random() * 40, t0);
        thump.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
        thumpG.gain.setValueAtTime(vol * 0.55, t0);
        thumpG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
        thump.connect(thumpG);
        thumpG.connect(audio.master);
        thump.start(t0);
        thump.stop(t0 + 0.18);
        const click = audio.ctx.createOscillator();
        const clickG = audio.ctx.createGain();
        click.type = "square";
        click.frequency.setValueAtTime(1800 + Math.random() * 600, t0);
        clickG.gain.setValueAtTime(vol * 0.12, t0);
        clickG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
        click.connect(clickG);
        clickG.connect(audio.master);
        click.start(t0);
        click.stop(t0 + 0.05);
      } catch (_) {}
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
          bodyG.connect(audio.master);
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
          crackG.connect(audio.master);
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
          nG.connect(audio.master);
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
          pingG.connect(audio.master);
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
          thudG.connect(audio.master);
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
          nG.connect(audio.master);
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
        thudG.connect(audio.master);
        thud.start(t0);
        thud.stop(t0 + 0.16);
      } catch (_) {}
    }

    let gatherHitKick = 0;

    /** Brief crosshair flash + camera punch when tool connects mid-anim. */
    function pulseGatherHit(mode) {
      gatherHitKick = 0.055;
      try {
        const ch = document.querySelector(".fw-crosshair");
        if (!ch) return;
        ch.classList.remove("is-hit-chop", "is-hit-mine", "is-hit-gather");
        void ch.offsetWidth;
        const cls = mode === "chop" ? "is-hit-chop"
          : (mode === "mine" ? "is-hit-mine" : "is-hit-gather");
        ch.classList.add(cls);
        clearTimeout(pulseGatherHit._t);
        pulseGatherHit._t = setTimeout(() => {
          try { ch.classList.remove("is-hit-chop", "is-hit-mine", "is-hit-gather"); } catch (_) {}
        }, 160);
      } catch (_) {}
    }

    function updateFootsteps(dt) {
      if (!player.moving || !audio.soundOn) {
        audio.stepCd = Math.min(audio.stepCd, 0.08);
        return;
      }
      audio.stepCd -= dt;
      if (audio.stepCd <= 0) {
        playStep(0.45 + Math.random() * 0.25);
        // Fortnite-ish cadence: walk ~3 Hz, sprint ~5 Hz
        audio.stepCd = player.sprinting
          ? (camMode === "fpv" ? 0.18 : 0.2)
          : (camMode === "fpv" ? 0.28 : 0.34);
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
        if (down) {
          player.crouchToggle = false;
          if (!e.repeat && controlsEnabled && !mapOpen && !chatOpen && !craftOpen) {
            onHud({ status: "Agachado (Ctrl)" });
          }
        } else if (!keys.ControlLeft && !keys.ControlRight && !player.crouchToggle) {
          if (controlsEnabled && !mapOpen) onHud({ status: "De pie" });
        }
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
      if (mod) applyModifierKeys(e, down);

      // Chat captures typing
      if (chatOpen && e.target && e.target.id === "fw-chat-input") {
        if (!down && (e.code === "Escape")) setChatOpen(false);
        return;
      }
      // Rust: G = map (also M alias)
      if (down && !e.repeat && (e.code === "KeyG" || e.code === "KeyM")) {
        if (!controlsEnabled && !mapOpen) return;
        e.preventDefault();
        toggleMap();
        return;
      }
      if (down && e.code === "Escape") {
        e.preventDefault();
        if (useRadialOpen) { closeUseRadial(); return; }
        if (activeBoxId) { closeBoxPanel(); return; }
        if (upgradeMenuOpen) { closeUpgradeMenu(); return; }
        if (radialOpen) { setRadialOpen(false); return; }
        if (chatOpen) { setChatOpen(false); return; }
        if (craftOpen) { setCraftOpen(false); return; }
        if (activeBoxId) { closeBoxPanel(); return; }
        if (mapOpen) { setMapOpen(false); return; }
        if (window.__fwBuildAAA) window.__fwBuildAAA.closeTcPanel();
        onHud({ status: "Pausa · Esc otra vez / sigue jugando" });
        return;
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
      // V = push-to-talk stub (hold)
      if (e.code === "KeyV") {
        if (down && !e.repeat) onHud({ status: "Voz · PTT (stub)" });
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

      if (down && e.code === "KeyC") {
        // Rust-like: FPV default; C cycles views
        const order = ["fpv", "follow", "orbit"];
        const idx = Math.max(0, order.indexOf(camMode));
        setCameraMode(order[(idx + 1) % 3]);
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
      // R: hammer = upgrade menu · build plan = rotate ghost
      if (down && !e.repeat && e.code === "KeyR") {
        if (heldIsHammer()) {
          e.preventDefault();
          if (window.__fwBuildAAA && typeof window.__fwBuildAAA.openUpgradeMenuAimed === "function") {
            window.__fwBuildAAA.openUpgradeMenuAimed();
          }
          return;
        }
        if (buildMode && !radialOpen) {
          e.preventDefault();
          buildYaw = (buildYaw + 1) & 3;
          makeGhostFromRay();
          onHud({ status: "Build · rot " + (buildYaw * 90) + "° · " + BUILD_LABELS[BUILD_TYPES[buildTypeIdx]] });
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
        if (e.code === "KeyY") {
          const ray = camBuildRay();
          const hit = ray && rayHitBuilds(ray.o, ray.d);
          if (hit && typeof flipWallSoftSide === "function") flipWallSoftSide(hit.piece);
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
        if (
          c === "KeyW" || c === "KeyA" || c === "KeyS" || c === "KeyD"
          || c === "KeyT" || c === "KeyN" || c === "KeyR" || c === "KeyQ"
          || c === "KeyF" || c === "KeyG" || c === "KeyH" || c === "KeyL"
          || c === "KeyP" || c === "KeyO" || c === "KeyU" || c === "KeyB"
          || c === "KeyE" || c === "KeyK" || c === "KeyJ" || c === "KeyX"
          || c === "KeyC" || c === "KeyV" || c === "KeyZ" || c === "KeyY"
          || c.indexOf("Digit") === 0 || c.indexOf("Numpad") === 0
          || c === "Tab" || c === "Enter" || c === "Backspace"
        ) {
          e.preventDefault();
          e.stopPropagation();
        }
        // Ctrl alone is fine; also stop keydown when browser synthesizes combo
        if (c === "ControlLeft" || c === "ControlRight" || e.key === "Control") {
          // no-op — crouch needs Ctrl; closing needs Ctrl+W
        }
      }
      if (e.altKey && (e.code === "F4" || e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    // Capture phase so Ctrl+W never reaches the browser chrome first
    window.addEventListener("keydown", blockBrowserChrome, true);
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
      // RMB: hammer upgrade · otherwise orbit camera + turn avatar to face cam
      // Right-click often swallows keyup in browsers → clear loco so WASD can't stick
      if (e.button === 2) {
        e.preventDefault();
        clearLocoKeys();
        if (heldIsHammer()) {
          if (window.__fwBuildAAA && typeof window.__fwBuildAAA.openUpgradeMenuAimed === "function") {
            window.__fwBuildAAA.openUpgradeMenuAimed();
          }
          return;
        }
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
            if (window.__fwBuildAAA && typeof window.__fwBuildAAA.tryHammerDemolishAimed === "function") {
              window.__fwBuildAAA.tryHammerDemolishAimed();
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
        onHud({ status: "Mira activa · Esc suelta el mouse" });
      }
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
      player.freeLook = !!(keys.AltLeft || keys.AltRight);
      player.crouching = !!(keys.ControlLeft || keys.ControlRight) || !!player.crouchToggle;
      let mx = 0, mz = 0;
      // Rust WASD — same in FPV / follow / orbit (C only changes camera)
      // W forward · S back · A left · D right · diagonals OK · crouch walks too
      if (!radialOpen && !upgradeMenuOpen) {
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
        // Screen-right (A = −, D = +) — same formula FPV + 3rd
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);
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
          if (keys.ControlLeft || keys.ControlRight) player.vy = Math.max(-3.2, player.vy - 14 * dt);
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
      // Re-resolve crouch after jump may have cleared Ctrl
      player.crouching = !!(keys.ControlLeft || keys.ControlRight) || !!player.crouchToggle;
      // Eye height: FPV + 3rd person (C cycles cams) — lower when crouched
      const eyeH = player.crouching ? 1.05 : 1.55;
      player.y = player.feetY + eyeH;
      if (player.crouching && camMode !== "fpv") {
        orbitPitch = Math.min(ORBIT_PITCH_MAX, Math.max(orbitPitch, 0.18));
      }

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
            onHud({
              status: "Colocar Armario" + tag + " · LMB confirma",
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

    function cameraMatrices() {
      const aspect = size.w / Math.max(1, size.h);
      // FPV look-down: large near clips grass/ground into a hard band — keep tiny
      // (body interior is handled by neck pivot + head/neck collapse, not near)
      const near = camMode === "fpv" ? 0.045 : NEAR;
      const proj = mat4Persp((48 * Math.PI) / 180, aspect, near, FAR);
      let eye, target;
      if (camMode === "fpv") {
        // Rust-style: pivot at neck, push forward (never into torso).
        // Looking down must see chest/legs from outside — not shirt interior.
        const yaw = player.freeLook ? orbitYaw : player.yaw;
        const hx = Math.sin(yaw);
        const hz = Math.cos(yaw);
        const neckH = player.crouching ? 0.98 : 1.40;
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
        // Slightly lower aim when worm's-eye so look-up frames the full avatar
        const lookY = (camMode === "orbit" ? player.feetY + 1.05 : player.feetY + 0.95)
          + (orbitPitch < 0 ? orbitPitch * 0.35 : 0);
        const yBias = camMode === "orbit" ? 0.6 : 0.15;
        eye = [
          player.x + Math.sin(orbitYaw) * cy * dist,
          lookY + sy * dist + yBias,
          player.z + Math.cos(orbitYaw) * cy * dist,
        ];
        target = [player.x, Math.max(player.feetY + 0.55, lookY), player.z];
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
      const view = mat4LookAt(eye, target, [0, 1, 0]);
      lastEye = eye;
      lastTarget = target;
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
        gatherHold: !!(!player.moving && (gatherHold || gatherSwing)),
        camMode, eye: lastEye, target: lastTarget,
        aspect: size.w / Math.max(1, size.h), fovDeg: 48,
        // Match meadow near so avatar depth-comp doesn't fight grass
        near: camMode === "fpv" ? 0.045 : NEAR,
        far: FAR,
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
      const sunI = 1.55 * dayW + 0.85 * duskW * (1 - dayW * 0.5);
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
      const amb = 0.22 * dayW + 0.16 * duskW + 0.10 * nightW + 0.08;

      const ubo = new Float32Array(56);
      ubo.set(mvp, 0);
      // sun_dir stored so L = normalize(-sun_dir) points toward the light
      ubo[16] = -lightTo[0]; ubo[17] = -lightTo[1]; ubo[18] = -lightTo[2];
      ubo[19] = now * 0.001;
      ubo[20] = eye[0]; ubo[21] = eye[1]; ubo[22] = eye[2];
      ubo[23] = player.sprinting ? 0.78 : (player.moving ? 0.68 : 0.58);
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
      device.queue.writeBuffer(frameBuf, 0, ubo);
      // stash for sky pass

      _celestial = { tod, sunTo, moonTo, dayW, nightW, duskW };

      // Cascaded shadow maps — 3 ortho frusta along view
      const aspect = size.w / Math.max(1, size.h);
      const fov = (48 * Math.PI) / 180;
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
      const shStr = Math.min(1, sunH * 2.0) * (0.28 + 0.5 * dayW + 0.38 * nightW);
      shadowU[52] = 0.0018; // bias
      shadowU[53] = shStr;  // strength
      shadowU[54] = 0; shadowU[55] = 0;
      device.queue.writeBuffer(shadowBuf, 0, shadowU);
      _shadowCascades = [c0, c1, c2];


      // Cinematic DoF (FE-style autofocus on character)
      const focalLen = camMode === "fpv" ? 14 : camMode === "orbit" ? 40 : 22;
      const underAmt = Math.max(0, Math.min(1, (SEA_Y + 0.12 - eye[1]) / 2.2));
      const exposure = 0.58 * (0.5 + 0.3 * _celestial.dayW + 0.22 * _celestial.duskW + 0.2 * _celestial.nightW);
      const bokeh = 0.0; // DoF off — sharp everywhere
      const postU = new Float32Array([
        focusDist, focalLen, bokeh,
        exposure,
        camMode === "fpv" ? 1 : 0,
        NEAR, FAR, underAmt,
      ]);
      device.queue.writeBuffer(postParamBuf, 0, postU);

      // Upload VRM atlas before encoding passes that sample it
      try {
        const src = getAvatarAtlas && getAvatarAtlas();
        if (src && src.canvas && src.width === size.w && src.height === size.h) {
          device.queue.copyExternalImageToTexture(
            { source: src.canvas, flipY: false },
            { texture: avatarAtlas },
            [size.w, size.h * 2]
          );
        }
      } catch (_) {}

      const encoder = device.createCommandEncoder();
      {
        const sp = new Float32Array([
          now * 0.001, OCEAN_PATCH0, OCEAN_PATCH1, 1.15,
          player.x, player.z, 0.92, SEA_Y,
        ]);
        device.queue.writeBuffer(oceanSimParamsBuf, 0, sp);
        device.queue.writeBuffer(oceanDrawParamsBuf, 0, new Float32Array([OCEAN_PATCH0, OCEAN_PATCH1, SEA_Y, 1.15]));
        const cpass = encoder.beginComputePass();
        cpass.setPipeline(oceanSimPipe);
        cpass.setBindGroup(0, oceanSimBind());
        cpass.dispatchWorkgroups(OCEAN_SIM_RES / 8, OCEAN_SIM_RES / 8);
        cpass.end();
        foamFlip = 1 - foamFlip;
      }

      if (grassReady) {
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
      pass.setBindGroup(1, oceanDrawBind());
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
        pass.setPipeline(ghostPipe);
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
      pass.end();

      // Bloom — 1 blur pair (was 3) for far-field perf
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{ view: bloomAView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(brightPipe);
        p.setBindGroup(0, postBind(sceneView, sceneView));
        p.draw(3);
        p.end();
      }
      {
        let p = encoder.beginRenderPass({
          colorAttachments: [{ view: bloomBView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(blurHPipe);
        p.setBindGroup(0, postBind(bloomAView, bloomAView));
        p.draw(3);
        p.end();
        p = encoder.beginRenderPass({
          colorAttachments: [{ view: bloomAView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(blurVPipe);
        p.setBindGroup(0, postBind(bloomBView, bloomBView));
        p.draw(3);
        p.end();
      }
      // Skip heavy DoF soft pass — composite uses scene as soft fallback via bloomA bind slot C
      // Composite: sharp + light bloom + FXAA
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{
            view: compView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear", storeOp: "store",
          }],
        });
        p.setPipeline(compPipe);
        // Soft slot = sharp scene (coc~0 effectively when soft≈sharp)
        p.setBindGroup(0, postBind(sceneView, bloomAView, sceneView));
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
        p.setBindGroup(0, mergeBind(compView));
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
      window.removeEventListener("keydown", blockBrowserChrome, true);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("resize", onResize);
      try { setMapOpen(false); } catch (_) {}
      try { compassEl.remove(); } catch (_) {}
      try { mapDlg.remove(); } catch (_) {}
      try { audio.bgm && audio.bgm.src.stop(); } catch (_) {}
      try { audio.noise && audio.noise.src.stop(); } catch (_) {}
      try { audio.ctx && audio.ctx.close(); } catch (_) {}
      try { depth && depth.destroy(); } catch (_) {}
      try { sceneColor && sceneColor.destroy(); } catch (_) {}
      try { bloomA && bloomA.destroy(); } catch (_) {}
      try { bloomB && bloomB.destroy(); } catch (_) {}
      try { dofTex && dofTex.destroy(); } catch (_) {}
      try { compTex && compTex.destroy(); } catch (_) {}
      try { avatarAtlas && avatarAtlas.destroy(); } catch (_) {}
      try { envTex && envTex.destroy(); } catch (_) {}
      try { shadowMap && shadowMap.destroy(); } catch (_) {}
      try { shadowDummy && shadowDummy.destroy(); } catch (_) {}
      try { buildVbo && buildVbo.destroy(); } catch (_) {}
      try { ghostVbo && ghostVbo.destroy(); } catch (_) {}
      try {
        const a = document.getElementById("fw-build-radial");
        if (a) a.remove();
        const b = document.getElementById("fw-build-stab");
        if (b) b.remove();
        const c = document.getElementById("fw-tc-panel");
        if (c) c.remove();
      } catch (_) {}
      try { delete window.__fwBuildAAA; } catch (_) {}
    }

    return {
      boot, destroy, setCameraMode, rebake, getPose,
      setControlsEnabled, setPaused, calibrate,
      unlockAudio, setSoundOn, toggleSound,
      setAvatarAtlasSource, toggleMap, setMapOpen,
      setBuildMode, setHeldItem, tryHarvestAimed, tryToggleNearbyDoor,
      openWorkbenchUI, openResearchUI, tryUseAimed,
      getVitals: () => vitals,
      killPlayer,
    };
  }

  window.FalseWorldGpu = { create };
})();
