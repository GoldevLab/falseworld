/** False World meadow WebGPU v121 — solid boulder meshes (no crossed-card stars). */
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


// Rocks — solid low-poly boulders (unit mesh in corner.xy + plane=lz).
// rdata: kind, scale, yaw, phase
// kind: 0 granite 1 sandstone 2 basalt 3 mossy 4 limestone 5 desert-red
struct RockIn {
  @location(0) base : vec3f,
  @location(1) corner : vec2f,   // local x, y on unit boulder
  @location(2) rdata : vec4f,
  @location(3) lz : f32,         // local z on unit boulder
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
  let kind = input.rdata.x;
  let scale = input.rdata.y;
  let yaw = input.rdata.z;
  let phase = input.rdata.w;
  var p = vec3f(input.corner.x, input.corner.y, input.lz);
  // Kind-based ellipsoid proportions (squat mounds, not spikes)
  var rx = 0.78;
  var ry = 0.52;
  var rz = 0.70;
  if (kind > 0.5 && kind < 1.5) { rx = 1.05; ry = 0.36; rz = 0.82; } // sandstone slab
  else if (kind > 1.5 && kind < 2.5) { rx = 0.62; ry = 0.58; rz = 0.58; } // basalt block
  else if (kind > 2.5 && kind < 3.5) { rx = 0.84; ry = 0.48; rz = 0.76; } // mossy
  else if (kind > 3.5 && kind < 4.5) { rx = 0.74; ry = 0.44; rz = 0.68; } // limestone
  else if (kind > 4.5) { rx = 0.88; ry = 0.40; rz = 0.72; } // desert
  rx *= scale * (0.88 + 0.24 * fract(phase * 3.7));
  ry *= scale * (0.90 + 0.18 * fract(phase * 5.1));
  rz *= scale * (0.86 + 0.26 * fract(phase * 2.3));
  // Irregular boulder: mild radial lobes (keeps silhouette round, not starred)
  let pn = length(p);
  var dir = select(vec3f(0.0, 1.0, 0.0), p / pn, pn > 1e-4);
  let lobe = 0.10 * sin(dir.x * 5.0 + phase * 6.0)
           + 0.07 * sin(dir.z * 4.0 - phase * 4.0)
           + 0.05 * sin(dir.y * 6.0 + phase);
  let bump = clamp(0.88 + lobe + 0.06 * biome_value_noise(vec2f(dir.x + phase, dir.z - phase)), 0.72, 1.12);
  p *= bump;
  // Flatten underside so it sits on ground
  p.y = p.y * 0.55 + 0.45;
  let local = vec3f(p.x * rx, p.y * ry, p.z * rz);
  let ca = cos(yaw);
  let sa = sin(yaw);
  let lean = (phase - 0.5) * 0.12;
  let world = vec3f(
    input.base.x + ca * local.x + sa * local.z + lean * local.y * ca,
    input.base.y + local.y,
    input.base.z - sa * local.x + ca * local.z + lean * local.y * sa,
  );
  // Approximate smooth normal from deformed direction, yaw-rotated
  var nloc = normalize(vec3f(dir.x / max(rx, 0.01), dir.y / max(ry, 0.01), dir.z / max(rz, 0.01)));
  let nrm = normalize(vec3f(ca * nloc.x + sa * nloc.z, nloc.y, -sa * nloc.x + ca * nloc.z));
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.uv = vec2f(atan2(local.z, local.x), local.y / max(ry, 0.01));
  o.rdata = input.rdata;
  o.world = world;
  o.nrm = nrm;
  return o;
}
@fragment fn fs_rock(input : RockOut) -> @location(0) vec4f {
  let kind = input.rdata.x;
  let phase = input.rdata.w;
  let u = input.uv.x;
  let v = input.uv.y;
  let n1 = biome_value_noise(vec2f(u * 1.4 + phase * 2.0, v * 2.1));
  let n2 = biome_value_noise(vec2f(u * 3.2 - phase, v * 4.0 + 1.7));
  let n3 = biome_fbm(vec2f(u * 0.9 + phase, v * 1.3));

  var col = vec3f(0.48, 0.47, 0.45);
  if (kind < 0.5) {
    col = mix(vec3f(0.52, 0.52, 0.54), vec3f(0.34, 0.34, 0.36), n1 * 0.55);
    let speck = smoothstep(0.55, 0.85, biome_value_noise(vec2f(u * 9.0, v * 11.0 + phase)));
    col = mix(col, vec3f(0.62, 0.61, 0.58), speck * 0.4);
  } else if (kind < 1.5) {
    col = mix(vec3f(0.72, 0.56, 0.38), vec3f(0.48, 0.34, 0.2), n1 * 0.5);
    let band = 0.5 + 0.5 * sin(v * 14.0 + n1 * 1.5);
    col *= 0.9 + 0.12 * band;
  } else if (kind < 2.5) {
    col = mix(vec3f(0.32, 0.33, 0.36), vec3f(0.18, 0.19, 0.22), n1 * 0.55 + n3 * 0.2);
  } else if (kind < 3.5) {
    col = mix(vec3f(0.46, 0.45, 0.42), vec3f(0.3, 0.29, 0.27), n1);
    let moss = smoothstep(0.5, 0.85, n3) * (1.0 - v * 0.45);
    col = mix(col, vec3f(0.22, 0.38, 0.16), moss * 0.55);
  } else if (kind < 4.5) {
    col = mix(vec3f(0.78, 0.76, 0.7), vec3f(0.58, 0.56, 0.5), n1 * 0.45);
  } else {
    col = mix(vec3f(0.68, 0.42, 0.28), vec3f(0.42, 0.24, 0.14), n1 * 0.5 + n2 * 0.2);
  }
  let facet = biome_value_noise(vec2f(u * 2.2 + phase, v * 4.5));
  let crack = smoothstep(0.72, 0.95, biome_value_noise(vec2f(u * 1.6 + phase, v * 7.0)));
  col *= 0.82 + 0.22 * facet;
  col *= 1.0 - crack * 0.18;
  col *= 0.72 + 0.28 * smoothstep(0.05, 0.55, v);

  let nrm = normalize(input.nrm);
  let L = normalize(-frame.sun_dir);
  let wrap = max(dot(nrm, L) * 0.55 + 0.45, 0.0);
  let sh = mix(1.0, shadow_factor(input.world, nrm, L), 0.4);
  let hemi = 0.28 + 0.35 * max(nrm.y, 0.0);
  var lit = col * (frame.amb * 0.9 + wrap * 0.7 * sh) * frame.light_col;
  lit += col * hemi * 0.35;
  let env_c = env_irradiance(nrm);
  let env_l = dot(env_c, vec3f(0.299, 0.587, 0.114));
  lit += mix(vec3f(env_l), env_c, 0.25) * col * 0.2;
  let to_eye = normalize(frame.eye - input.world);
  let rim = pow(1.0 - max(dot(nrm, to_eye), 0.0), 2.0);
  lit += col * rim * 0.12;
  lit = apply_fog(lit, input.world);
  return vec4f(clamp(lit, vec3f(0.0), vec3f(2.8)), 1.0);
}


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

    const initBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
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
    /** Solid trunk colliders: {x,z,r} world units */
    let treeColliders = [];
    let treeDrawRanges = [];
    let rockDrawRanges = [];
    const PLAYER_RADIUS = 0.45;

    const player = { x: 0, y: 1.55, feetY: 0, z: 0, yaw: 0, moving: false, sprinting: false };
    // Soft trail footprints (approx FE character trail texture)
    const trailPts = [
      { x: 0, z: 0, w: 0 },
      { x: 0, z: 0, w: 0 },
      { x: 0, z: 0, w: 0 },
      { x: 0, z: 0, w: 0 },
    ];
    let trailLastX = 0;
    let trailLastZ = 0;
    let camMode = "follow";
    let lastHudBiome = 0;
    let fpsFrames = 0;
    let fpsWindowStart = 0;
    let fpsShown = 0;
    const fpsEl = typeof document !== "undefined" ? document.getElementById("fw-fps") : null;
    const keys = Object.create(null);
    // Orbit angles used by follow + orbit (left-drag looks around the avatar)
    let orbitYaw = Math.PI; // start behind character (yaw 0 faces +Z)
    let orbitPitch = 0.32;
    let orbitDist = 4.2; // follow distance; orbit mode widens this
    let followDist = 4.2;
    let freeOrbitDist = 14;
    let dragging = false, lastMx = 0, lastMy = 0;
    let alive = true, raf = 0, t0 = performance.now();
    let lastEye = [0, 2, 8], lastTarget = [0, 1, 0];
    let controlsEnabled = false, paused = false;
    const beams = [];
    let nextBeam = 2;

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

      // Rocks — solid low-poly boulder meshes (no crossed cards / stars)
      // kind: 0 granite 1 sandstone 2 basalt 3 mossy 4 limestone 5 desert-red
      const rockVerts = [];
      const rockRanges = [];
      // Unit sphere tris (segs×rings) — deformed into boulders in vs_rock
      const rockUnitTris = (() => {
        const segs = 8;
        const rings = 5;
        const pts = [];
        for (let iy = 0; iy <= rings; iy++) {
          const v = iy / rings;
          const phi = v * Math.PI;
          const sy = Math.sin(phi);
          const cy = Math.cos(phi);
          for (let ix = 0; ix <= segs; ix++) {
            const u = ix / segs;
            const th = u * Math.PI * 2;
            pts.push([Math.cos(th) * sy, cy, Math.sin(th) * sy]);
          }
        }
        const tris = [];
        const stride = segs + 1;
        for (let iy = 0; iy < rings; iy++) {
          for (let ix = 0; ix < segs; ix++) {
            const a = iy * stride + ix;
            const b = a + stride;
            const i0 = pts[a], i1 = pts[a + 1], i2 = pts[b], i3 = pts[b + 1];
            tris.push(i0, i2, i1, i1, i2, i3);
          }
        }
        return tris;
      })();
      const rockDens = [0.32, 0.36, 0.22, 0.28, 0.26, 0.34]; // meadow dry forest snow marsh desert
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
      const pushRock = (ox, oy, oz, kind, scale, yaw, phase) => {
        const start = rockVerts.length / 10;
        for (const p of rockUnitTris) {
          rockVerts.push(ox, oy, oz, p[0], p[1], kind, scale, yaw, phase, p[2]);
        }
        rockRanges.push({
          x: ox, z: oz,
          start: start | 0,
          count: (rockVerts.length / 10 - start) | 0,
        });
        nRocks++;
      };
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
          const pocket = hash(Math.floor(rx / 36) * 11.3 + Math.floor(rz / 36) * 29.1);
          if (pocket > 0.75) dens *= 1.65;
          else if (pocket < 0.18) dens *= 0.4;
          if (h2 > dens) continue;
          const kind = pickRock(bid, hash(rx * 2.7 + rz * 1.9 + 7));
          const scale = 0.7 + hash(rx * 1.1 + rz * 3.3) * 1.35;
          const yaw = hash(rz * 6.2 - rx) * Math.PI * 2;
          const phase = hash(rx * 0.8 + rz * 1.4);
          pushRock(rx, ry0 + 0.015, rz, kind, scale, yaw, phase);
          // Common small satellites (pebble / twin)
          const nExtra = hash(rx * 4.1 + 9) > 0.55 ? (hash(rz + 3) > 0.65 ? 2 : 1) : 0;
          for (let ei = 0; ei < nExtra; ei++) {
            const ox = rx + (hash(rz + ei * 7.1 + 1) - 0.5) * (1.6 + ei) * scale;
            const oz = rz + (hash(rx + ei * 5.3 + 2) - 0.5) * (1.6 + ei) * scale;
            if (islandEdge(ox, oz) > 0.08) continue;
            const oy2 = sampleHeight(chunk, ox, oz) + 0.015;
            if (oy2 < 0.02) continue;
            const sc2 = scale * (0.35 + hash(ox + ei) * 0.4);
            const k2 = pickRock(bid, hash(ox * 1.7 + ei));
            pushRock(ox, oy2, oz, k2, sc2, yaw + 0.9 + ei, phase + 0.15 * (ei + 1));
          }
        }
      }
      const rockArr = new Float32Array(rockVerts);
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
      }

      // Biome trees — multi-part: flared trunk + twigs + lobed canopy / conical pine
      const treeVerts = [];
      treeColliders = [];
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
            if (islandEdge(wx, wz) > 0.12) continue;
            const wy = sampleHeight(chunk, wx, wz);
            if (wy < -0.05 || wy > 18) continue;
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
            treeRanges.push({
              x: wx, z: wz,
              start: treeVertStart | 0,
              count: (treeVerts.length / 10 - treeVertStart) | 0,
            });
          }
        }
      }
      const tArr = new Float32Array(treeVerts);
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
      }
      onHud({ status: "árboles " + nTrees + " · rocas " + nRocks + " · flores " + nFlowers });
      treeDrawRanges = treeRanges;
      rockDrawRanges = rockRanges;
    }

    function hash(n) {
      const s = Math.sin(n * 127.1) * 43758.5453;
      return s - Math.floor(s);
    }

    function treeHit(px, pz) {
      const pr = PLAYER_RADIUS;
      for (let i = 0; i < treeColliders.length; i++) {
        const t = treeColliders[i];
        const dx = px - t.x;
        const dz = pz - t.z;
        const minD = pr + t.r;
        if (dx * dx + dz * dz < minD * minD) return true;
      }
      return false;
    }

    /** Push player out of overlapping trunks (solid trees). */
    function resolveTrees() {
      const pr = PLAYER_RADIUS;
      // A few passes so clustered trunks don't leave you inside
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (let i = 0; i < treeColliders.length; i++) {
          const t = treeColliders[i];
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
      gpuInitBlades(true);
      spawnBeamsAndRoses();
      resolveTrees();
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
      await bakeAt(0, 0);
      loop();
    }

    async function calibrate(frames) {
      const n = Math.max(1, frames | 0);
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    }

    function setControlsEnabled(on) {
      controlsEnabled = !!on;
      if (!controlsEnabled) {
        for (const k of Object.keys(keys)) keys[k] = false;
        player.moving = false;
        player.sprinting = false;
        dragging = false;
      } else {
        try { canvas.focus(); } catch (_) {}
      }
    }

    function setCameraMode(m) {
      const next = m === "fpv" || m === "orbit" ? m : "follow";
      if (next === "orbit" && camMode !== "orbit") {
        orbitDist = freeOrbitDist;
      } else if (next === "follow" && camMode !== "follow") {
        orbitDist = followDist;
        orbitPitch = Math.min(orbitPitch, 0.55);
      }
      camMode = next;
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
          ]).then(([field, noise, ...steps]) => {
            audio.bgm = startLoop(field, 1.5, true); // FE volume 1.5
            audio.noise = startLoop(noise, 0.1, true);
            audio.steps = steps;
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

    function onKey(e, down) {
      if (down && (e.code === "KeyM" || e.key === "m" || e.key === "M")) {
        if (!controlsEnabled && !mapOpen) return;
        e.preventDefault();
        toggleMap();
        return;
      }
      if (down && e.code === "Escape" && mapOpen) {
        e.preventDefault();
        setMapOpen(false);
        return;
      }
      if (mapOpen) {
        // Block movement while map is open; still track keyup clears
        if (!down) keys[e.code] = false;
        return;
      }
      if (!controlsEnabled) {
        if (!down) keys[e.code] = false;
        return;
      }
      keys[e.code] = down;
      if (down && (e.code === "KeyC" || e.key === "c")) {
        const order = ["follow", "fpv", "orbit"];
        setCameraMode(order[(order.indexOf(camMode) + 1) % 3]);
      }
      if (down && (e.code === "KeyN" || e.key === "n")) {
        toggleSound();
        unlockAudio();
      }
      if (down) unlockAudio();
    }
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    canvas.addEventListener("pointerdown", (e) => {
      unlockAudio();
      if (!controlsEnabled) return;
      if (e.button !== 0) return; // left click only
      dragging = true;
      lastMx = e.clientX;
      lastMy = e.clientY;
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    const endDrag = () => { dragging = false; };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    window.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging || !controlsEnabled) return;
      const dx = e.clientX - lastMx, dy = e.clientY - lastMy;
      lastMx = e.clientX; lastMy = e.clientY;
      if (camMode === "fpv") {
        player.yaw += dx * 0.005;
        return;
      }
      // Follow / Orbit: orbit camera around avatar to inspect surroundings
      orbitYaw += dx * 0.008;
      orbitPitch = Math.max(0.14, Math.min(1.2, orbitPitch + dy * 0.008));
    });
    canvas.addEventListener("wheel", (e) => {
      if (!controlsEnabled) return;
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
      if (!chunk || !controlsEnabled || mapOpen) {
        player.moving = false;
        player.sprinting = false;
        if (chunk) updateCompass();
        return;
      }
      let mx = 0, mz = 0;
      // WASD: camera-relative in follow/orbit; body-relative in FPV
      if (keys.KeyW || keys.ArrowUp) mz += 1;
      if (keys.KeyS || keys.ArrowDown) mz -= 1;
      if (keys.KeyA || keys.ArrowLeft) mx -= 1;
      if (keys.KeyD || keys.ArrowRight) mx += 1;
      player.moving = !!(mx || mz);
      player.sprinting = player.moving && !!(keys.ShiftLeft || keys.ShiftRight);
      if (player.moving) {
        const len = Math.hypot(mx, mz) || 1;
        mx /= len; mz /= len;
        // Fortnite-style: walk vs Shift sprint
        const walkSpd = camMode === "fpv" ? 3.2 : 2.6;
        const runSpd = camMode === "fpv" ? 8.5 : 7.4;
        const speed = player.sprinting ? runSpd : walkSpd;
        let fx, fz, rx, rz;
        if (camMode === "fpv") {
          fx = Math.sin(player.yaw);
          fz = Math.cos(player.yaw);
          rx = Math.cos(player.yaw);
          rz = -Math.sin(player.yaw);
        } else {
          // Into the scene (away from camera) and screen-right
          fx = -Math.sin(orbitYaw);
          fz = -Math.cos(orbitYaw);
          rx = Math.cos(orbitYaw);
          rz = -Math.sin(orbitYaw);
        }
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
        if (treeHit(nx, nz)) {
          const freeX = !treeHit(ox + vx, oz);
          const freeZ = !treeHit(ox, oz + vz);
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
        resolveTrees();
        // Face walk direction (keeps avatar aligned while you orbit-look)
        if (camMode !== "fpv" && (nx !== ox || nz !== oz)) {
          player.yaw = Math.atan2(player.x - ox, player.z - oz);
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
      resolveTrees();
      // Feet: always on terrain. Sink relative to sea ONLY when seabed is underwater.
      // Beach sand (groundY >= SEA_Y) stays solid — never punch through to sea level.
      {
        const groundY = sampleHeight(chunk, player.x, player.z);
        const edge = islandEdge(player.x, player.z);
        const inWater = groundY < SEA_Y;
        if (inWater) {
          // Stand on the submerged shelf (body is under the water plane)
          const sinkTarget = groundY;
          if (player._sinkY == null || !Number.isFinite(player._sinkY)) {
            player._sinkY = player.feetY;
          }
          const k = Math.min(1, 3.2 * dt);
          player._sinkY += (sinkTarget - player._sinkY) * k;
          player.feetY = player._sinkY;
          // Soft shore pull if too deep so you don't vanish under the shelf
          if (edge > 0.62) {
            const ir = Math.hypot(player.x, player.z) || 1;
            const pull = coastRadius(player.x, player.z) * 0.86;
            const s = pull / ir;
            const a = Math.min(1, 1.6 * dt);
            player.x = player.x * (1 - a) + player.x * s * a;
            player.z = player.z * (1 - a) + player.z * s * a;
          }
        } else {
          player._sinkY = groundY;
          player.feetY = groundY;
        }
      }
      player.y = player.feetY + 1.55;

      // HUD biome stamp (~4 Hz)
      {
        const t = performance.now();
        if (((t / 250) | 0) !== ((lastHudBiome / 250) | 0)) {
          lastHudBiome = t;
          const bid = biomeAtJs(player.x, player.z);
          const kmX = (player.x / 1000).toFixed(2);
          const kmZ = (player.z / 1000).toFixed(2);
          onHud({
            status: BIOME_NAMES[bid] + " · " + (_celestial.dayW > 0.5 ? "día" : (_celestial.nightW > 0.5 ? "noche" : "crepúsculo")),
          });
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

      // Grass is full-island (baked once); streaming disabled
      refreshGrassPatch(false);

      nextBeam -= dt;
      if (nextBeam <= 0) {
        nextBeam = 2 + Math.random() * 3;
        // pulse beam alphas via regenerating occasionally is heavy; skip for now
      }
    }

    /** Keep follow/orbit eye above terrain; water surface is traversable. */
    function resolveCameraEye(eye, target) {
      if (!chunk) return eye;
      const CLEAR = 0.55;
      const groundAt = (x, z) => sampleHeight(chunk, x, z);
      let minY = groundAt(eye[0], eye[2]) + CLEAR;
      for (let t = 0.2; t <= 0.85; t += 0.2) {
        const x = eye[0] + (target[0] - eye[0]) * t;
        const z = eye[2] + (target[2] - eye[2]) * t;
        const g = groundAt(x, z) + CLEAR;
        const yRay = eye[1] + (target[1] - eye[1]) * t;
        if (yRay < g) {
          const need = (g - target[1] * t) / Math.max(1e-3, 1 - t);
          if (need > minY) minY = need;
        }
      }
      // Over open water / beach shelf: allow diving through the sea plane
      // Only "in water" when terrain under the eye is submerged — beach sand is dry
      const overWater = groundAt(eye[0], eye[2]) < SEA_Y;
      if (!overWater) {
        minY = Math.max(minY, SEA_Y + 0.35);
      }
      if (eye[1] < minY) eye[1] = minY;
      return eye;
    }

    function cameraMatrices() {
      const aspect = size.w / Math.max(1, size.h);
      const proj = mat4Persp((48 * Math.PI) / 180, aspect, NEAR, FAR);
      let eye, target;
      if (camMode === "fpv") {
        eye = [player.x, player.y, player.z];
        // Keep FPV head above local ground when sinking / on slopes
        if (chunk) {
          const minHead = sampleHeight(chunk, player.x, player.z) + 1.35;
          if (eye[1] < minHead) eye[1] = minHead;
        }
        target = [player.x + Math.sin(player.yaw), eye[1] - 0.05, player.z + Math.cos(player.yaw)];
      } else {
        // Follow + Orbit: spherical camera around avatar (left-drag spins this)
        let dist = orbitDist;
        const cy = Math.cos(orbitPitch);
        const sy = Math.sin(orbitPitch);
        const lookY = camMode === "orbit" ? player.feetY + 1.05 : player.feetY + 0.95;
        eye = [
          player.x + Math.sin(orbitYaw) * cy * dist,
          lookY + sy * dist + (camMode === "orbit" ? 0.6 : 0.15),
          player.z + Math.cos(orbitYaw) * cy * dist,
        ];
        target = [player.x, lookY, player.z];
        eye = resolveCameraEye(eye, target);
        // If ground push was huge, pull camera closer so it doesn't float oddly far up
        const lifted = eye[1] - (lookY + sy * dist + (camMode === "orbit" ? 0.6 : 0.15));
        if (lifted > 1.2 && dist > 2.6) {
          const shrink = Math.min(0.45, (lifted - 1.0) * 0.12);
          dist = Math.max(2.4, dist * (1 - shrink));
          eye = [
            player.x + Math.sin(orbitYaw) * cy * dist,
            lookY + sy * dist + (camMode === "orbit" ? 0.6 : 0.15),
            player.z + Math.cos(orbitYaw) * cy * dist,
          ];
          eye = resolveCameraEye(eye, target);
        }
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

    function getPose() {
      return {
        x: player.x, y: player.feetY, z: player.z, yaw: player.yaw,
        moving: player.moving, sprinting: player.sprinting, camMode, eye: lastEye, target: lastTarget,
        aspect: size.w / Math.max(1, size.h), fovDeg: 48,
        near: NEAR, far: FAR,
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
    }

    return {
      boot, destroy, setCameraMode, rebake, getPose,
      setControlsEnabled, setPaused, calibrate,
      unlockAudio, setSoundOn, toggleSound,
      setAvatarAtlasSource, toggleMap, setMapOpen,
    };
  }

  window.FalseWorldGpu = { create };
})();
