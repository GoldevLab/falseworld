
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
  fall_hinge : vec4f, // xyz + stump height
  fall_tip : vec4f,   // direction xz + angle + active radius²
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
// Sanitize: a stale rgba16float upload used to reinterpret f32 bits as halfs
// → neon magenta on metals; also guards NaN/Inf from bad HDR texels.
fn env_sample_safe(c : vec3f) -> vec3f {
  let ok = c == c; // false for NaN
  let finite = select(vec3f(0.35, 0.42, 0.55), c, ok.x && ok.y && ok.z);
  return clamp(finite, vec3f(0.0), vec3f(16.0));
}
fn env_sample(dir : vec3f) -> vec3f {
  let dims = vec2f(textureDimensions(env_map));
  let uv = env_uv(dir);
  let p = uv * dims - vec2f(0.5);
  let i0 = vec2i(floor(p));
  let f = fract(p);
  let maxi = vec2i(dims) - vec2i(1);
  let c00 = env_sample_safe(textureLoad(env_map, clamp(i0, vec2i(0), maxi), 0).rgb);
  let c10 = env_sample_safe(textureLoad(env_map, clamp(i0 + vec2i(1, 0), vec2i(0), maxi), 0).rgb);
  let c01 = env_sample_safe(textureLoad(env_map, clamp(i0 + vec2i(0, 1), vec2i(0), maxi), 0).rgb);
  let c11 = env_sample_safe(textureLoad(env_map, clamp(i0 + vec2i(1, 1), vec2i(0), maxi), 0).rgb);
  let c0 = mix(c00, c10, f.x);
  let c1 = mix(c01, c11, f.x);
  return mix(c0, c1, f.y);
}
// Stable cone blur (no mips — mip chain was blowing foliage to blue/red)
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
  let dist_fog = smoothstep(280.0, 980.0, dist);
  let h_fog = 1.0 - exp(-max(0.0, (frame.eye.y + 10.0) - world.y) * 0.036);
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  var dens = clamp(dist_fog * 0.78 + h_fog * dist_fog * 0.42, 0.0, 0.92);
  dens *= mix(1.15, 0.9, day);
  var out_c = mix(rgb, sky_fog_col(), dens);
  let luma = dot(out_c, vec3f(0.299, 0.587, 0.114));
  out_c = mix(out_c, vec3f(luma), dist_fog * 0.18);
  return out_c;
}
fn env_refl(dir : vec3f) -> vec3f {
  // Prefer HDR potsdamer — keep energy but avoid blue blowout
  let hdr = env_sample(dir) * 2.1;
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  return mix(env_proc(dir) * 0.85, hdr, mix(0.35, 0.88, day));
}
fn env_refl_rough(dir : vec3f, rough : f32) -> vec3f {
  let hdr = env_sample_rough(dir, rough) * 2.1;
  let day = smoothstep(0.18, 0.42, frame.tod) * (1.0 - smoothstep(0.58, 0.82, frame.tod));
  return mix(env_proc(dir) * 0.85, hdr, mix(0.35, 0.88, day));
}
fn env_irradiance(n : vec3f) -> vec3f {
  // Diffuse IBL — stable 3-lobe (6-lobe + high mips blew out blue sky fill)
  let up = env_refl_rough(vec3f(0.0, 1.0, 0.0), 1.0);
  let nrm = env_refl_rough(n, 0.85);
  let hz = env_refl_rough(normalize(vec3f(n.x, 0.15, n.z)), 0.9);
  return (nrm * 0.45 + up * 0.35 + hz * 0.2) * 0.48;
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
  let sh_lift = mix(0.36, 1.0, sh);
  return mix(1.0, sh_lift, strength * 0.9);
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
  // Wide noisy ecotones — climate + domain warp, never binary knife-edges
  let s = xz * (1.0 / 90.0);
  let warp = biome_fbm(s * 0.7) * 0.48;
  let warp2 = biome_fbm(s * 0.7 + vec2f(4.0, -2.0)) * 0.48;
  let warp3 = biome_fbm(xz * (1.0 / 52.0) + vec2f(2.3, -7.1)) * 0.14;
  let sw = s + vec2f(warp, warp2) + vec2f(warp3, -warp3 * 0.7);
  let temp = biome_fbm(sw) * 0.88 + 0.08;
  let moist = biome_fbm(sw + vec2f(17.0, -9.0));
  // Jitter in climate units (~10–40 m feathered borders)
  let jag = biome_fbm(xz * (1.0 / 36.0)) * 0.20
    + biome_fbm(xz * (1.0 / 15.0) + vec2f(5.1, -3.7)) * 0.11
    + biome_fbm(xz * (1.0 / 7.0) + vec2f(-2.4, 8.2)) * 0.055;
  let snow_blob = biome_fbm(xz * (1.0 / 110.0) + vec2f(jag * 0.5, -jag * 0.35));
  let t2 = temp + jag * 0.6;
  let m2 = moist + jag * 0.7;
  // Continuous snow (no select hard cuts)
  var snow = smoothstep(0.06, 0.44, snow_blob) * smoothstep(0.34, 0.0, t2);
  snow = max(snow, smoothstep(-0.02, -0.40, t2));
  snow = smoothstep(0.04, 0.82, clamp(snow, 0.0, 1.0));
  let rest = 1.0 - snow;
  var desert = smoothstep(0.18, 0.64, t2) * (1.0 - smoothstep(-0.42, 0.14, m2)) * rest;
  let wet = smoothstep(-0.05, 0.58, m2) * rest;
  var marsh = wet * smoothstep(-0.22, 0.40, t2);
  var forest = wet * (1.0 - smoothstep(-0.22, 0.40, t2));
  var dry = (1.0 - smoothstep(-0.58, 0.10, m2)) * rest;
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
    case 1u: { return vec3f(0.22, 0.17, 0.08); } // dry — warm loam
    case 2u: { return vec3f(0.06, 0.09, 0.04); } // forest — dark humus
    case 3u: { return vec3f(0.48, 0.52, 0.56); } // snow underpack (not chalk white)
    case 4u: { return vec3f(0.05, 0.09, 0.055); } // marsh — dark wet peat
    case 5u: { return vec3f(0.42, 0.32, 0.17); } // desert — warm sand
    default: { return vec3f(0.11, 0.13, 0.06); } // meadow — earthy loam (not flat green)
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
  var n = normalize(input.nrm);
  let xz = input.world.xz;
  // Multi-octave micro-normals — dirt clumps, grit, subtle furrows
  let d0 = biome_fbm(xz * 1.6) * 2.0 - 1.0;
  let d1 = biome_fbm(xz * 4.8 + vec2f(3.7, -2.1)) * 2.0 - 1.0;
  let d2 = biome_fbm(xz * 12.0 + vec2f(-1.3, 4.2)) * 2.0 - 1.0;
  let d3 = biome_fbm(xz * 28.0 + vec2f(8.1, -5.4)) * 2.0 - 1.0;
  n = normalize(n
    + vec3f(d0, 0.0, d1) * 0.32
    + vec3f(d2 * 0.5, abs(d0) * 0.08, d1 * 0.4) * 0.18
    + vec3f(d3 * 0.35, 0.0, -d3 * 0.28) * 0.10);
  let L = normalize(-frame.sun_dir);
  let V = normalize(frame.eye - input.world);
  let ndl = max(dot(n, L), 0.0);
  let ndv = max(dot(n, V), 0.0);
  let bw = biome_weights(xz);
  let bid = biome_id(xz);
  // Macro / meso / micro albedo noise
  let n_macro = biome_fbm(xz * 0.07) * 0.5 + 0.5;
  let n_meso = biome_fbm(xz * 0.38 + vec2f(2.1, -4.3)) * 0.5 + 0.5;
  let n_micro = biome_fbm(xz * 2.4 + vec2f(-1.7, 3.9)) * 0.5 + 0.5;
  let n_fine = biome_fbm(xz * 9.0 + vec2f(5.2, 1.1)) * 0.5 + 0.5;
  let n_warp = biome_fbm(xz * 0.55 + vec2f(n_macro * 2.0, n_meso));
  var col = biome_ground_soft(xz);
  // Meadow / forest / marsh: layered loam, moss, leaf litter (not flat paint)
  let grassy = clamp(bw.meadow + bw.forest * 0.95 + bw.marsh * 0.75 + bw.dry * 0.45, 0.0, 1.0);
  var loam = mix(vec3f(0.09, 0.07, 0.04), vec3f(0.15, 0.13, 0.07), n_macro);
  loam = mix(loam, vec3f(0.05, 0.09, 0.035), smoothstep(0.35, 0.85, n_meso) * 0.7); // moss
  loam = mix(loam, vec3f(0.07, 0.06, 0.03), smoothstep(0.55, 0.95, n_warp) * 0.55); // damp hollows
  loam = mix(loam, vec3f(0.18, 0.14, 0.07), smoothstep(0.70, 0.93, n_micro) * 0.45); // dry litter
  loam = mix(loam, vec3f(0.22, 0.17, 0.09), smoothstep(0.82, 0.97, n_fine) * 0.35); // twig flecks
  loam = mix(loam, vec3f(0.04, 0.07, 0.03), bw.forest * (0.35 + n_meso * 0.25)); // humus
  loam = mix(loam, vec3f(0.04, 0.07, 0.045), bw.marsh * (0.55 + (1.0 - n_macro) * 0.35));
  loam = mix(loam, vec3f(0.20, 0.16, 0.08), bw.dry * (0.45 + n_macro * 0.2));
  col = mix(col, loam, grassy * 0.88);
  // Dry cracks / baked earth
  let crack = smoothstep(0.62, 0.88, abs(n_warp)) * smoothstep(0.4, 0.9, n_fine);
  col = mix(col, col * vec3f(0.72, 0.68, 0.55), crack * (bw.dry * 0.7 + bw.desert * 0.55 + bw.meadow * 0.12));
  // Desert sand ripples
  if (bw.desert > 0.05) {
    let ripple = sin(xz.x * 2.8 + xz.y * 0.35 + n_meso * 4.0) * 0.5 + 0.5;
    let sand = mix(vec3f(0.36, 0.28, 0.14), vec3f(0.52, 0.40, 0.22), ripple * 0.55 + n_micro * 0.25);
    col = mix(col, sand, smoothstep(0.08, 0.72, bw.desert));
  }
  // Snow pack / rock — wide soft blend
  if (bw.snow > 0.02) {
    let slope = 1.0 - clamp(n.y, 0.0, 1.0);
    let rock = vec3f(0.26, 0.28, 0.32);
    let pack = mix(vec3f(0.58, 0.62, 0.68), vec3f(0.78, 0.82, 0.88), n_meso * 0.4);
    var snow_col = mix(pack, rock, smoothstep(0.14, 0.52, slope));
    snow_col = mix(snow_col, vec3f(0.82, 0.86, 0.90), pow(clamp(n.y, 0.0, 1.0), 2.4) * 0.28);
    // Dirty snow near ecotone
    snow_col = mix(snow_col, loam * 1.15, (1.0 - smoothstep(0.25, 0.85, bw.snow)) * 0.35);
    col = mix(col, snow_col, smoothstep(0.02, 0.88, bw.snow));
  }
  col = mix(col, col * 1.08, clamp(n.y * 0.45 + 0.15, 0.0, 1.0));
  let contact_ao = mix(0.54, 1.0, clamp(n.y * 0.65 + 0.18, 0.0, 1.0));
  col *= contact_ao * mix(0.92, 1.05, n_fine);
  let edge = island_edge_w(xz);
  // --- Beach sand: multi-scale grain + ripples (not flat yellow paint) ---
  let beach_amt = smoothstep(0.0, 0.08, edge);
  let sg0 = biome_fbm(xz * 0.18) * 0.5 + 0.5;
  let sg1 = biome_fbm(xz * 0.85 + vec2f(2.4, -1.6)) * 0.5 + 0.5;
  let sg2 = biome_fbm(xz * 3.2 + vec2f(-2.8, 4.1)) * 0.5 + 0.5;
  let sg3 = biome_fbm(xz * 11.0 + vec2f(6.2, -3.5)) * 0.5 + 0.5;
  let sg4 = biome_fbm(xz * 36.0 + vec2f(-4.7, 8.3)) * 0.5 + 0.5;
  let cang = atan2(xz.y, xz.x);
  let across = xz.x * cos(cang) + xz.y * sin(cang);
  let along = -xz.x * sin(cang) + xz.y * cos(cang);
  let ripple = sin(across * 2.8 + sg1 * 2.2) * 0.5 + 0.5;
  let ripple2 = sin(across * 7.5 - along * 0.35 + sg2 * 2.8) * 0.5 + 0.5;
  // Beach micro-normals: grain + ripple crests
  if (beach_amt > 0.02) {
    let bn0 = biome_fbm(xz * 9.0 + vec2f(1.1, -2.4)) * 2.0 - 1.0;
    let bn1 = biome_fbm(xz * 24.0 + vec2f(-3.3, 5.1)) * 2.0 - 1.0;
    let br = cos(across * 2.8 + sg1 * 2.2);
    n = normalize(n
      + vec3f(bn0, 0.0, bn1) * (0.55 * beach_amt)
      + vec3f(br * cos(cang), 0.0, br * sin(cang)) * (0.22 * beach_amt)
      + vec3f(bn1 * 0.4, abs(bn0) * 0.06, -bn0 * 0.35) * (0.18 * beach_amt));
  }
  // Warm quartz sand — beige / ochre / pale (no green channel bias)
  var dry_sand = mix(vec3f(0.76, 0.68, 0.48), vec3f(0.88, 0.80, 0.58), sg0);
  dry_sand = mix(dry_sand, vec3f(0.70, 0.60, 0.42), sg1 * 0.42);
  dry_sand = mix(dry_sand, vec3f(0.84, 0.78, 0.62), sg2 * 0.38);
  dry_sand = mix(dry_sand, vec3f(0.58, 0.52, 0.40), smoothstep(0.72, 0.94, sg3) * 0.45);
  dry_sand = mix(dry_sand, vec3f(0.92, 0.88, 0.74), smoothstep(0.86, 0.98, sg4) * 0.4);
  dry_sand = mix(dry_sand, dry_sand * vec3f(1.06, 1.01, 0.92), ripple * 0.22);
  dry_sand = mix(dry_sand, dry_sand * vec3f(0.93, 0.91, 0.86), ripple2 * 0.14);
  let shell = smoothstep(0.90, 0.97, biome_fbm(xz * 5.8 + vec2f(sg2, -sg0)));
  dry_sand = mix(dry_sand, vec3f(0.90, 0.86, 0.78), shell * 0.6);
  let dark_peb = smoothstep(0.925, 0.985, biome_fbm(xz * 7.6 + vec2f(-5.2, 3.1)));
  dry_sand = mix(dry_sand, vec3f(0.32, 0.30, 0.26), dark_peb * 0.7);
  var wet_sand = mix(vec3f(0.36, 0.30, 0.22), vec3f(0.26, 0.22, 0.18), sg1);
  wet_sand = mix(wet_sand, vec3f(0.42, 0.36, 0.28), sg3 * 0.35);
  wet_sand = mix(wet_sand, wet_sand * 0.88, ripple * 0.2);
  let foam_sand = mix(vec3f(0.86, 0.88, 0.90), vec3f(0.94, 0.95, 0.96), sg4);
  // Wider dry berm so meadow green can't bleed onto the beach
  let dry_w = smoothstep(0.0, 0.08, edge) * (1.0 - smoothstep(0.36, 0.52, edge));
  let wet_w = smoothstep(0.12, 0.34, edge) * (1.0 - smoothstep(0.48, 0.70, edge));
  let foam_w = smoothstep(0.34, 0.44, edge) * (1.0 - smoothstep(0.52, 0.70, edge));
  col = mix(col, dry_sand, dry_w);
  col = mix(col, wet_sand, wet_w * 0.98);
  col = mix(col, foam_sand, foam_w * 0.72);
  // Marsh inland puddles / wet mud (after edge is known)
  if (bw.marsh > 0.2 && edge < 0.1) {
    let puddle = smoothstep(0.55, 0.92, biome_fbm(xz * 0.55 + vec2f(n_macro, -n_meso)));
    col = mix(col, vec3f(0.045, 0.065, 0.04), bw.marsh * puddle * 0.85);
  }
  // Inland pebbles / grit only — never on the sandy berm
  let beach_mask = 1.0 - smoothstep(0.0, 0.14, edge);
  let pebble = smoothstep(0.80, 0.96, biome_fbm(xz * 3.5 + vec2f(n_meso, -n_macro)));
  let grit = smoothstep(0.68, 0.9, biome_fbm(xz * 10.5 + vec2f(1.4, -2.6)));
  col = mix(col, vec3f(0.26, 0.24, 0.18), pebble * grassy * 0.48 * beach_mask);
  col = mix(col, col * vec3f(0.88, 0.93, 0.82), grit * grassy * 0.28 * beach_mask);
  // Underwater shelf: sandy shallows first, then deep silt (not instant teal sludge)
  if (input.world.y < -0.15) {
    let uw = smoothstep(-0.15, -2.4, input.world.y);
    let sand_uw = vec3f(0.28, 0.26, 0.20);
    let deep_uw = vec3f(0.07, 0.14, 0.18);
    col = mix(col, mix(sand_uw, deep_uw, uw), uw * 0.92);
  }
  // Re-light after beach normal bumps
  let ndl_b = max(dot(n, L), 0.0);
  let ndv_b = max(dot(n, V), 0.0);
  let sun = frame.light_col;
  let hemi = env_irradiance(n);
  let sh = shadow_factor(input.world, n, L);
  let sh_g = mix(1.0, sh, 0.52);
  var rgb = col * (frame.amb * 1.02 + ndl_b * 0.72 * sh_g) * sun + col * hemi * (0.34 + frame.amb * 0.28);
  // Soft contact darkening under canopy density (inland only)
  rgb *= mix(0.9, 1.0, 1.0 - grassy * 0.12 * (1.0 - n.y) * beach_mask);
  if (wet_w > 0.15) {
    let h = normalize(L + V);
    let ndh = max(dot(n, h), 0.0);
    rgb += sun * pow(ndh, 64.0) * wet_w * 0.42 * sh;
  }
  // Dry sand: soft quartz sparkle
  if (dry_w > 0.2) {
    let h = normalize(L + V);
    let ndh = max(dot(n, h), 0.0);
    rgb += sun * pow(ndh, 120.0) * dry_w * (0.08 + sg4 * 0.12) * sh;
  }
  if (bw.snow > 0.15 || bw.marsh > 0.3 || bid == 3u || bid == 4u) {
    let h = normalize(L + V);
    let ndh = max(dot(n, h), 0.0);
    let rough = select(0.55, 0.35, bw.snow > 0.35);
    let a = max(rough * rough, 0.04);
    let a2 = a * a;
    let d_den = ndh * ndh * (a2 - 1.0) + 1.0;
    let D = a2 / max(3.14159 * d_den * d_den, 1e-4);
    let F = 0.05 + 0.95 * pow(1.0 - ndv_b, 5.0);
    let G = G_smith(max(ndl_b, 0.02), max(ndv_b, 0.02), rough);
    let spec = D * F * G / max(4.0 * max(ndl_b, 0.02) * max(ndv_b, 0.02), 1e-4);
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
      let fall = pow(smoothstep(pr, 0.0, dist), 1.65);
      // Stronger core under the body (~shin / thigh width) — clears waist-high reeds
      let core = pow(smoothstep(pr * 0.72, 0.0, dist), 1.25);
      let str = fall * 0.72 + core * 0.42;
      push_x += dir.x * str;
      push_z += dir.y * str;
      // Stronger flatten so pantano grass doesn't swallow the avatar
      flatten_w = max(flatten_w, fall * 0.22 + core * 0.28);
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
  tip_col = mix(tip_col, vec3f(0.72, 0.76, 0.82), smoothstep(0.08, 0.85, bw.snow));
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
// Near-field grass depth into CSM (LOD0 verts = 15-seg)
@vertex fn vs_grass_shadow(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> GrassOut {
  return grass_vs(vid, iid, 15.0);
}
@fragment fn fs_shadow_grass(input : GrassOut) {
  // Drop wispy tips so shadow maps stay solid underfoot
  if (input.height_t > 0.88 && abs(input.side_uv - 0.5) > 0.32) { discard; }
  if (input.dist_fade > 0.92) { discard; }
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

  var rgb = hemi + diffuse * sun * mix(0.55, 1.0, sh) + sky_fill
    + sun * velvet * mix(0.5, 1.0, sh)
    + sss * mix(0.65, 1.0, sh);
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
  else if (kind > 8.5 && kind < 9.5) { sx = 0.22 * scale; sy = 0.38 * scale; } // fern
  else if (kind > 9.5 && kind < 10.5) { sx = 0.18 * scale; sy = 0.08 * scale; } // litter
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
  } else if (kind < 8.5) {
    // Marsh lily — pale pink / cream
    petals = 5.0; petal_amp = 0.4; petal_base = 0.58;
    petal_col = mix(vec3f(0.95, 0.72, 0.82), vec3f(0.95, 0.9, 0.7), fract(phase * 1.3));
    center_col = vec3f(0.9, 0.7, 0.2);
    center_r = 0.2;
  } else if (kind < 9.5) {
    // Fern frond under trees
    let lobe = abs(sin(u * 9.0 + v * 2.0 + phase));
    let stem = 1.0 - smoothstep(0.04, 0.14, abs(u));
    let blade = smoothstep(-1.0, -0.15, v) * smoothstep(1.05, 0.1, v)
      * (1.0 - smoothstep(0.35 + (1.0 - abs(v)) * 0.45, 0.72, abs(u)));
    mask = max(stem * 0.7, blade * (0.55 + 0.45 * lobe));
    col = mix(vec3f(0.12, 0.28, 0.10), vec3f(0.22, 0.42, 0.16), lobe * 0.5 + (v * 0.5 + 0.5) * 0.3);
    if (mask < 0.12) { discard; }
    let Lf = normalize(-frame.sun_dir);
    let ndlf = 0.5 + 0.5 * max(dot(normalize(vec3f(u, 0.5, 0.6)), Lf), 0.0);
    var rgbf = col * frame.light_col * (frame.amb + ndlf * 0.55);
    rgbf = apply_fog(rgbf, input.world);
    return vec4f(clamp(rgbf, vec3f(0.0), vec3f(2.5)), clamp(mask, 0.0, 1.0));
  } else {
    // Leaf litter on forest floor (kind ~10)
    let leaf = 1.0 - smoothstep(0.45, 0.78, length(vec2f(u * 1.1, v * 0.75)));
    let vein = 1.0 - smoothstep(0.02, 0.1, abs(u + v * 0.15));
    mask = leaf * (0.75 + 0.25 * vein);
    col = mix(vec3f(0.28, 0.18, 0.08), vec3f(0.42, 0.28, 0.12), fract(phase * 2.3));
    col = mix(col, vec3f(0.35, 0.22, 0.1), vein * 0.35);
    if (mask < 0.14) { discard; }
    let Ll = normalize(-frame.sun_dir);
    let ndll = 0.45 + 0.55 * max(dot(normalize(vec3f(0.1, 1.0, 0.2)), Ll), 0.0);
    var rgbl = col * frame.light_col * (frame.amb * 1.1 + ndll * 0.4);
    rgbl = apply_fog(rgbl, input.world);
    return vec4f(clamp(rgbl, vec3f(0.0), vec3f(2.5)), clamp(mask * 0.85, 0.0, 1.0));
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




// Bird / butterfly — tree-to-tree routes
// fdata: species, scale, phase, tripHz (A↔B cycles per second)
// species: 0 sparrow 1 bluebird 2 crow 3 butterfly
struct BirdIn {
  @location(0) from_p : vec3f,
  @location(1) corner : vec2f,
  @location(2) fdata : vec4f,
  @location(3) to_p : vec3f,
};
struct BirdOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
  @location(1) fdata : vec4f,
  @location(2) world : vec3f,
  @location(3) anim : vec3f, // flap, bank, view_side
};
@vertex fn vs_bird(input : BirdIn) -> BirdOut {
  var o : BirdOut;
  let species = input.fdata.x;
  let scale = input.fdata.y;
  let phase = input.fdata.z;
  let trip_hz = max(input.fdata.w, 0.04);
  let mid = (input.from_p + input.to_p) * 0.5;
  let dist_xz = length(mid.xz - frame.eye.xz);
  if (dist_xz > 165.0) {
    o.clip = vec4f(0.0, 0.0, 2.0, 1.0);
    o.uv = input.corner;
    o.fdata = input.fdata;
    o.world = mid;
    o.anim = vec3f(0.0);
    return o;
  }
  let is_bfly = species > 2.5;
  let span = length(input.to_p - input.from_p);
  // Timeline: perch → cruise → perch → return
  let cycle = fract(frame.time * trip_hz + phase);
  var a = input.from_p;
  var b = input.to_p;
  var u_lin = 0.0;
  var flying = 0.0;
  // 0.00–0.08 perch A · 0.08–0.48 fly A→B · 0.48–0.56 perch B · 0.56–1.00 fly B→A
  if (cycle < 0.08) {
    u_lin = 0.0; flying = 0.0;
  } else if (cycle < 0.48) {
    u_lin = (cycle - 0.08) / 0.40;
    flying = 1.0;
  } else if (cycle < 0.56) {
    a = input.to_p; b = input.from_p;
    u_lin = 0.0; flying = 0.0;
  } else {
    a = input.to_p; b = input.from_p;
    u_lin = (cycle - 0.56) / 0.44;
    flying = 1.0;
  }
  // Ease in/out so they don't pop off the branch
  let u = u_lin * u_lin * (3.0 - 2.0 * u_lin);
  let u2 = clamp(u_lin * 2.0, 0.0, 1.0); // for arc peak mid-flight
  let chord = b - a;
  // Flight arc — higher on longer hops
  let arc_h = select(1.1 + span * 0.06, 0.35 + span * 0.04, is_bfly) * flying;
  let arc = sin(u * 3.14159265) * arc_h;
  // Slight lateral weave mid-route (not a circle)
  let side_dir = normalize(cross(vec3f(0.0, 1.0, 0.0), chord + vec3f(0.001, 0.0, 0.0)));
  let weave = sin(u * 3.14159265) * sin(frame.time * select(1.6, 3.2, is_bfly) + phase) * select(0.35, 0.55, is_bfly) * flying;
  var world_c = mix(a, b, u) + vec3f(0.0, arc, 0.0) + side_dir * weave;
  // Tiny hop bob while perched
  if (flying < 0.5) {
    world_c.y += sin(frame.time * 2.2 + phase * 5.0) * 0.03;
  }

  // Heading along path
  let du = max(u_lin, 0.02);
  let u_next = min(u_lin + 0.04, 1.0);
  let un = u_next * u_next * (3.0 - 2.0 * u_next);
  let p1 = mix(a, b, u) + vec3f(0.0, sin(u * 3.14159265) * arc_h, 0.0);
  let p2 = mix(a, b, un) + vec3f(0.0, sin(un * 3.14159265) * arc_h, 0.0);
  var fwd = p2 - p1;
  if (flying < 0.5) {
    fwd = chord;
  }
  let fl = length(fwd);
  if (fl < 1e-4) { fwd = vec3f(1.0, 0.0, 0.0); } else { fwd = fwd / fl; }

  let to_eye = normalize(frame.eye - world_c);
  var cam_r = cross(vec3f(0.0, 1.0, 0.0), to_eye);
  if (length(cam_r) < 1e-4) { cam_r = vec3f(1.0, 0.0, 0.0); }
  cam_r = normalize(cam_r);
  let cam_u = normalize(cross(to_eye, cam_r));
  let view_side = clamp(dot(fwd, cam_r), -1.0, 1.0);

  // Flap hard in cruise, soft on perch
  let flap_rate = select(14.0 + fract(phase * 2.7) * 5.0, 20.0 + fract(phase) * 8.0, is_bfly);
  var flap = sin(frame.time * flap_rate + phase * 12.0);
  flap = mix(flap * 0.15, flap, flying * 0.85 + 0.15);
  let bank = clamp(dot(side_dir, fwd) * 0.0 + weave * 0.15, -0.3, 0.3) * flying;

  let wing_span = select(0.55 + 0.55 * abs(flap), 0.4 + 0.7 * abs(flap), is_bfly);
  var sx = select(0.34, 0.20, is_bfly) * scale * wing_span;
  var sy = select(0.22, 0.16, is_bfly) * scale;
  let tip_lift = flap * select(2.0, 1.5, is_bfly) * sy;
  let cu = input.corner.x;
  let cv = input.corner.y;
  let fly_r = normalize(mix(cam_r, normalize(cross(vec3f(0.0, 1.0, 0.0), fwd)), 0.5 * flying));
  let fly_u = normalize(mix(cam_u, vec3f(0.0, 1.0, 0.0), 0.2));
  let world = world_c
    + fly_r * (cu * sx)
    + fly_u * (cv * sy + abs(cu) * tip_lift + cu * bank * sy);

  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.uv = input.corner;
  o.fdata = input.fdata;
  o.world = world;
  o.anim = vec3f(flap, bank, view_side);
  return o;
}

@fragment fn fs_bird(input : BirdOut) -> @location(0) vec4f {
  let species = input.fdata.x;
  let phase = input.fdata.z;
  let flap = input.anim.x;
  let view_side = input.anim.z;
  let is_bfly = species > 2.5;
  // Local UV with wing fold / profile squash
  var u = input.uv.x;
  var v = input.uv.y;
  let profile = abs(view_side); // 0 = nose-on, 1 = full side
  if (!is_bfly) {
    // Compress width when head-on; stretch when side-on
    u *= mix(1.35, 0.78, profile);
    v *= mix(0.9, 1.08, profile);
  } else {
    // Wings clap open/closed each beat
    let fold = 1.0 - abs(flap);
    u *= mix(0.85, 1.85, fold);
    v += flap * 0.08;
  }

  var mask = 0.0;
  var col = vec3f(0.4, 0.32, 0.24);
  var soft = 0.0;

  if (is_bfly) {
    // Four-wing butterfly: fore + hind lobes, body, eyespots, veins
    let fold = 1.0 - abs(flap);
    let wu = u;
    let wv = v + 0.05;
    let foreL = length(vec2f((wu + 0.32) * 1.05, (wv - 0.12) * 1.15));
    let foreR = length(vec2f((wu - 0.32) * 1.05, (wv - 0.12) * 1.15));
    let hindL = length(vec2f((wu + 0.26) * 1.2, (wv + 0.28) * 1.35));
    let hindR = length(vec2f((wu - 0.26) * 1.2, (wv + 0.28) * 1.35));
    let wingL = max(
      1.0 - smoothstep(0.42, 0.72, foreL),
      1.0 - smoothstep(0.32, 0.58, hindL)
    );
    let wingR = max(
      1.0 - smoothstep(0.42, 0.72, foreR),
      1.0 - smoothstep(0.32, 0.58, hindR)
    );
    var wings = max(wingL, wingR);
    // Notch between fore/hind
    wings *= 1.0 - 0.18 * smoothstep(0.08, 0.0, abs(wv - 0.05)) * smoothstep(0.15, 0.45, abs(wu));
    let body = (1.0 - smoothstep(0.045, 0.11, abs(wu)))
      * (1.0 - smoothstep(0.72, 0.95, abs(wv)));
    // Antennae
    let antL = 1.0 - smoothstep(0.03, 0.08, length(vec2f(wu + 0.06 - wv * 0.12, wv + 0.78)));
    let antR = 1.0 - smoothstep(0.03, 0.08, length(vec2f(wu - 0.06 + wv * 0.12, wv + 0.78)));
    mask = max(max(wings, body * 0.95), max(antL, antR) * 0.65);
    soft = wings;

    let hue = fract(phase * 3.71);
    var base = mix(vec3f(0.92, 0.48, 0.12), vec3f(0.35, 0.22, 0.72), smoothstep(0.25, 0.75, hue));
    base = mix(base, vec3f(0.95, 0.88, 0.28), smoothstep(0.55, 0.9, hue) * 0.65);
    // Wing veins
    let vein = abs(sin(wu * 14.0 + wv * 3.0)) * abs(sin(wv * 11.0 - wu * 2.0));
    base = mix(base * 0.72, base, smoothstep(0.15, 0.55, vein));
    // Eyespots
    let spotL = 1.0 - smoothstep(0.06, 0.14, length(vec2f(wu + 0.38, wv - 0.08)));
    let spotR = 1.0 - smoothstep(0.06, 0.14, length(vec2f(wu - 0.38, wv - 0.08)));
    let spots = max(spotL, spotR);
    base = mix(base, vec3f(0.08, 0.06, 0.1), spots * 0.85);
    base = mix(base, vec3f(0.95, 0.92, 0.75), spots * spots * 0.55);
    // Body darker
    col = mix(base, vec3f(0.12, 0.1, 0.08), body * 0.75);
    // Translucent wing rim toward sun
    col *= 0.78 + 0.22 * (1.0 - fold);
    col = mix(col, col * vec3f(1.15, 1.08, 0.95), abs(flap) * 0.2);
  } else {
    // Side-profile songbird: head, body, swept wing, tail, beak, eye
    let side = sign(view_side + 1e-4);
    // Flip so beak tends toward flight direction on screen
    let uu = u * side;
    let vv = v;

    // Torso (teardrop, thicker aft)
    let body_p = vec2f((uu + 0.05) * 1.35, vv * 1.7 + 0.05);
    let body = 1.0 - smoothstep(0.32, 0.58, length(body_p) * (1.0 + max(uu, 0.0) * 0.25));

    // Head
    let head = 1.0 - smoothstep(0.16, 0.32, length(vec2f((uu - 0.38) * 1.4, (vv - 0.08) * 1.5)));

    // Beak
    var beak = 1.0 - smoothstep(0.0, 0.22, length(vec2f((uu - 0.62) * 2.6, (vv + 0.02) * 4.2)));
    beak *= smoothstep(-0.15, 0.05, uu);

    // Tail fan behind
    var tail = 1.0 - smoothstep(0.15, 0.55, length(vec2f((uu + 0.55) * 1.1, vv * 2.4)));
    tail *= (1.0 - smoothstep(-0.05, 0.15, uu)) * (0.7 + 0.3 * (1.0 - abs(vv) * 1.2));

    // Wing — swept ellipse; signed flap lifts / drops the wing
    let wing_v = vv - flap * 0.42 - 0.02;
    var wing = 1.0 - smoothstep(0.18, 0.50, length(vec2f(uu * 0.5 + 0.05, wing_v * 1.85 + 0.12)));
    wing *= smoothstep(-0.55, 0.15, uu) * smoothstep(0.7, 0.15, uu);

    // Belly / back separation for shading later
    let belly = smoothstep(0.05, -0.25, vv);

    mask = max(max(max(body, head), max(wing * 0.95, tail * 0.85)), beak * 0.75);
    soft = max(wing, tail);

    // Feather edge noise
    let edge_n = biome_value_noise(vec2f(uu * 6.0 + phase, vv * 5.0 + flap));
    mask *= 0.9 + 0.1 * edge_n;

    // Species palettes
    var back = vec3f(0.38, 0.28, 0.18);
    var breast = vec3f(0.72, 0.62, 0.48);
    var wing_c = vec3f(0.32, 0.24, 0.16);
    var beak_c = vec3f(0.55, 0.35, 0.12);
    if (species < 0.5) {
      // Sparrow
      back = vec3f(0.42, 0.30, 0.18);
      breast = vec3f(0.78, 0.68, 0.52);
      wing_c = vec3f(0.28, 0.20, 0.12);
      beak_c = vec3f(0.35, 0.25, 0.12);
    } else if (species < 1.5) {
      // Bluebird
      back = vec3f(0.22, 0.42, 0.72);
      breast = vec3f(0.85, 0.55, 0.28);
      wing_c = vec3f(0.15, 0.30, 0.58);
      beak_c = vec3f(0.55, 0.35, 0.15);
    } else {
      // Crow
      back = vec3f(0.10, 0.10, 0.12);
      breast = vec3f(0.16, 0.16, 0.18);
      wing_c = vec3f(0.06, 0.06, 0.08);
      beak_c = vec3f(0.12, 0.12, 0.12);
    }

    col = mix(back, breast, belly * 0.85);
    col = mix(col, wing_c, wing * 0.65);
    col = mix(col, beak_c, beak * 0.9);
    // Tail slightly darker
    col = mix(col, col * 0.75, tail * 0.4);
    // Eye
    let eye = 1.0 - smoothstep(0.035, 0.08, length(vec2f(uu - 0.42, vv - 0.12)));
    col = mix(col, vec3f(0.05, 0.05, 0.06), eye * 0.95);
    let glint = 1.0 - smoothstep(0.012, 0.03, length(vec2f(uu - 0.405, vv - 0.135)));
    col = mix(col, vec3f(0.95, 0.95, 0.9), glint * eye);
    // Soft feather highlight on back
    col *= 0.82 + 0.18 * (1.0 - belly) * (0.5 + 0.5 * edge_n);
  }

  // Soft AA edge
  let edge = smoothstep(0.08, 0.28, mask);
  if (edge < 0.02) { discard; }

  let L = normalize(-frame.sun_dir);
  let nrm = normalize(vec3f(u * 0.9, 0.55 + flap * 0.15, 0.65));
  let ndl = 0.48 + 0.52 * max(dot(nrm, L), 0.0);
  // Rim light — reads against sky
  let ndv = max(dot(nrm, normalize(frame.eye - input.world)), 0.0);
  let rim = pow(1.0 - ndv, 2.4) * 0.5;
  var rgb = col * frame.light_col * (frame.amb * 0.85 + ndl * 0.75);
  rgb += frame.light_col * rim * select(0.35, 0.55, is_bfly);
  rgb += env_irradiance(nrm) * col * 0.18;
  // Subtle translucency on wing membranes / feathers
  rgb += frame.light_col * soft * abs(flap) * select(0.04, 0.08, is_bfly) * col;
  rgb = apply_fog(rgb, input.world);
  let dist = length(input.world.xz - frame.eye.xz);
  let fade = 1.0 - smoothstep(110.0, 155.0, dist);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(3.0)), clamp(edge * fade, 0.0, 1.0));
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
  // End-grain when looking into a log (mostly axial normal on XZ)
  let end_cap = !top && max(an.x, an.z) > 0.72 && an.y < 0.35;
  // Top: plank / thatch. Sides: bark along the log axis
  var along = select(world.y, world.x, top);
  var across = select(world.x * tw.z + world.z * tw.x + world.y * (1.0 - tw.y), world.z, top);
  if (end_cap) {
    along = length(world.xz);
    across = atan2(world.z, world.x);
  }

  // Tighter planks on floors so grain reads in FPV
  let plank_scale = select(3.4, 2.35, top);
  let plank_n = floor(across * plank_scale + along * 0.01);
  let plank_v = fract(across * plank_scale);
  let seam = smoothstep(0.0, 0.05, plank_v) * smoothstep(1.0, 0.95, plank_v);
  let seam_dark = mix(select(0.52, 0.42, top), 1.0, seam);

  let g0 = biome_value_noise(vec2f(along * 0.85, across * 2.8 + plank_n * 1.9));
  let g1 = biome_value_noise(vec2f(along * 3.6 + 2.1, across * 10.5));
  let g2 = biome_value_noise(vec2f(along * 12.0, across * 1.2 + plank_n));
  let fiber = 0.5 + 0.5 * sin(along * select(14.0, 11.0, top) + g0 * 6.0);
  var grain = 0.42 + 0.34 * g0 + 0.18 * g1 + 0.14 * fiber + 0.1 * g2;

  // Rough bark ridges on vertical faces (Rust twig logs)
  if (!top && !end_cap) {
    let ridge = 0.5 + 0.5 * sin(across * 28.0 + g0 * 4.0);
    let flake = biome_value_noise(vec2f(along * 2.2, across * 7.5));
    grain = grain * 0.55 + ridge * 0.28 + flake * 0.22;
  }

  let kcell = floor(vec2f(along, across) * select(0.45, 0.28, top));
  let kn = biome_value_noise(kcell * 2.4 + vec2f(3.1, 8.7));
  var knot = 0.0;
  if (kn > 0.76) {
    let kp = fract(vec2f(along, across) * select(0.45, 0.28, top)) - 0.5;
    let kd = length(kp * vec2f(1.1, 1.3));
    knot = smoothstep(0.22, 0.04, kd) * (kn - 0.76) * 3.2;
  }

  // Richer pine / bark palette — enough contrast for FPV + night
  var light = vec3f(0.74, 0.54, 0.30);
  var mid = vec3f(0.48, 0.30, 0.14);
  var dark = vec3f(0.22, 0.12, 0.055);
  if (!top) {
    light = vec3f(0.42, 0.30, 0.18);
    mid = vec3f(0.28, 0.18, 0.09);
    dark = vec3f(0.12, 0.07, 0.035);
  }
  var wood = mix(dark, mid, clamp(grain, 0.0, 1.0));
  wood = mix(wood, light, clamp((grain - 0.45) * 1.8, 0.0, 1.0));
  wood *= seam_dark;
  wood = mix(wood, vec3f(0.10, 0.055, 0.025), clamp(knot, 0.0, 0.92));
  wood *= 0.84 + 0.22 * biome_value_noise(vec2f(along, across) * 6.5);
  if (top) {
    // Plank deck (oak). Twig thatch wash is applied in fs_build when vertex is straw-colored.
    wood = mix(wood, wood * vec3f(1.02, 0.96, 0.88), 0.12);
  } else if (end_cap) {
    // Concentric end-grain rings
    let ring = fract(along * 9.5 + g1);
    let ring_d = smoothstep(0.0, 0.12, ring) * smoothstep(1.0, 0.88, ring);
    wood = mix(wood * 0.55, vec3f(0.55, 0.40, 0.22), ring_d);
  } else {
    wood *= vec3f(0.88, 0.84, 0.78);
  }
  return wood;
}

fn stone_grain(world : vec3f, nrm : vec3f, tint : vec3f) -> vec3f {
  let p = world * 1.8;
  let n0 = biome_value_noise(p.xz * 2.4 + p.y * 0.7);
  let n1 = biome_value_noise(p.xy * 3.1 + p.z * 1.2);
  let n2 = biome_value_noise(p.yz * 5.5);
  // Irregular ashlar blocks + mortar seams (Rust stone wall)
  let block_u = select(world.x, world.z, abs(nrm.z) > abs(nrm.x));
  let bu = floor(block_u * 1.35 + world.y * 0.08);
  let bv = floor(world.y * 1.55);
  let cell = biome_value_noise(vec2f(bu, bv) * 2.7 + vec2f(1.3, 4.8));
  let fu = fract(block_u * 1.35 + cell * 0.15);
  let fv = fract(world.y * 1.55 + cell * 0.1);
  let mortar = 1.0 - smoothstep(0.0, 0.07, min(min(fu, 1.0 - fu), min(fv, 1.0 - fv)));
  let crack = smoothstep(0.62, 0.78, n1) * 0.28;
  var col = tint * (0.78 + 0.32 * n0 + 0.16 * n2 + 0.12 * cell);
  col = mix(col, tint * 0.42, mortar * 0.85);
  col *= 1.0 - crack;
  col = mix(col, tint * 0.55, pow(1.0 - abs(nrm.y), 2.0) * 0.18);
  col = mix(col, col * vec3f(1.05, 1.02, 0.95), cell * 0.25);
  // Top decks: 2D flagstone grid (avoids wall-ashlar reading as wood planks)
  if (abs(nrm.y) > 0.55) {
    let fu2 = fract(world.x * 1.15);
    let fv2 = fract(world.z * 1.15);
    let seam2 = 1.0 - smoothstep(0.0, 0.06, min(min(fu2, 1.0 - fu2), min(fv2, 1.0 - fv2)));
    let cell2 = biome_value_noise(floor(world.xz * 1.15) * 2.1);
    col = tint * (0.82 + 0.22 * n0 + 0.1 * cell2);
    col = mix(col, tint * 0.38, seam2 * 0.9);
  }
  return col;
}

fn cloth_grain(world : vec3f, nrm : vec3f, tint : vec3f) -> vec3f {
  // Nylon weave + soft creases for sleeping bags / fabric props
  let u = world.x * nrm.y + world.z * (1.0 - abs(nrm.y));
  let v = world.y * 2.2 + world.z * abs(nrm.x);
  let weave = abs(sin(u * 38.0)) * abs(sin(v * 38.0));
  let warp = biome_value_noise(vec2f(u, v) * 3.4);
  let weft = biome_value_noise(vec2f(u, v) * 7.1 + vec2f(2.1, -1.3));
  let crease = smoothstep(0.35, 0.85, abs(biome_value_noise(world.xz * 1.8 + world.y)));
  var col = tint * (0.78 + 0.22 * weave + 0.12 * warp - 0.08 * weft);
  col = mix(col, tint * 0.62, crease * 0.35);
  // Soft velvet rim — darker in creases, lighter on high normals
  col *= 0.88 + 0.18 * max(nrm.y, 0.0);
  return col;
}
fn metal_grain(world : vec3f, nrm : vec3f, tint : vec3f) -> vec3f {
  let n0 = biome_value_noise(world.xz * 6.0 + world.y * 4.0);
  let n1 = biome_value_noise(world.xy * 11.0);
  let top = abs(nrm.y) > 0.55;
  // Deck: corrugate along Z; sides: along height / length
  let along = select(select(world.x, world.z, abs(nrm.z) > abs(nrm.x)), world.x, top);
  let across = select(world.y, world.z, top);
  let ridge_freq = select(4.2, 7.5, top);
  let ridge = abs(fract(across * ridge_freq) - 0.5) * 2.0;
  let trough = smoothstep(0.15, 0.55, ridge);
  let seam_u = fract(along * select(0.9, 1.35, top));
  let panel_seam = 1.0 - smoothstep(0.0, 0.04, min(seam_u, 1.0 - seam_u));
  // Cool galvanized steel keeps a bright metallic base; warm rust tints stay oxidized.
  let tint_warm = tint.r - tint.b;
  let is_cool = tint_warm < 0.08;
  let steel_lift = select(vec3f(1.0), vec3f(1.06, 1.07, 1.10), is_cool);
  var col = tint * steel_lift * (0.78 + 0.14 * n0 + 0.32 * trough);
  col = mix(col, tint * 0.38, panel_seam * 0.88);
  // Anisotropic brush / mill scratches along the panel
  let brush = 0.5 + 0.5 * sin(along * 42.0 + n0 * 3.0);
  col = mix(col, col * vec3f(1.08, 1.09, 1.12), brush * select(0.18, 0.08, !is_cool));
  let scratch = smoothstep(0.82, 0.95, biome_value_noise(vec2f(along * 2.2, across * 14.0)));
  col = mix(col, tint * 1.28, scratch * 0.28);
  let rust_n = biome_value_noise(world.xz * 2.8 + world.y * 1.6);
  let rust_amt = select(0.72, 0.18, top) * select(1.0, 0.22, is_cool);
  let rust = smoothstep(0.58, 0.9, rust_n) * (0.3 + 0.35 * n1) * rust_amt;
  col = mix(col, vec3f(0.55, 0.26, 0.10), rust);
  // Rivet dots
  let riv = smoothstep(0.1, 0.035, length(vec2f(fract(along * 2.6) - 0.5, fract(across * 2.2) - 0.5)));
  col = mix(col, tint * 1.45, riv * 0.6 * (1.0 - panel_seam));
  col = mix(col, col * 0.35, riv * 0.35 * step(0.7, n1));
  col *= 0.92 + 0.14 * abs(nrm.y);
  return col;
}

fn armor_grain(world : vec3f, nrm : vec3f, tint : vec3f) -> vec3f {
  let along = select(world.x, world.z, abs(nrm.z) > abs(nrm.x));
  let n0 = biome_value_noise(world.xz * 4.0 + world.y * 2.5);
  let pu = floor(along * 0.85);
  let pv = floor(world.y * 0.95);
  let plate = biome_value_noise(vec2f(pu, pv) * 1.9 + vec2f(2.2, 7.1));
  let fu = fract(along * 0.85);
  let fv = fract(world.y * 0.95);
  let seam = 1.0 - smoothstep(0.0, 0.045, min(min(fu, 1.0 - fu), min(fv, 1.0 - fv)));
  // Dark HQ plate — cool graphite (avoid green-leaning polish multipliers)
  var col = tint * vec3f(0.98, 0.99, 1.02) * (0.92 + 0.16 * n0 + 0.1 * plate);
  col = mix(col, tint * 0.28, seam * 0.92);
  let polish = biome_value_noise(vec2f(along * 1.4, world.y * 1.1) * 3.0);
  col = mix(col, col * vec3f(1.08, 1.09, 1.12), polish * 0.14);
  let riv = smoothstep(0.09, 0.03, length(vec2f(fract(along * 3.2) - 0.5, fract(world.y * 3.0) - 0.5)));
  col = mix(col, tint * 1.4, riv * 0.6 * (1.0 - seam));
  let rust = smoothstep(0.82, 0.97, biome_value_noise(world.xz * 1.5 + world.y)) * 0.1;
  col = mix(col, vec3f(0.35, 0.18, 0.08), rust);
  col *= 0.94 + 0.1 * abs(nrm.y);
  return col;
}

/// Fake corrugation / plate micro-normals for reflection only (cheap, no mesh change).
fn build_detail_normal(world : vec3f, nrm : vec3f, strength : f32) -> vec3f {
  let top = abs(nrm.y) > 0.55;
  let along = select(select(world.x, world.z, abs(nrm.z) > abs(nrm.x)), world.x, top);
  let across = select(world.y, world.z, top);
  let ridge = sin(across * select(26.0, 38.0, top) * 6.28318);
  let brush = sin(along * 55.0) * 0.35;
  // Build a tangent-ish bump in world space, then re-orthonormalize.
  var bump = nrm;
  if (abs(nrm.y) < 0.9) {
    bump += vec3f(0.0, 1.0, 0.0) * ridge * strength;
  } else {
    bump += vec3f(1.0, 0.0, 0.0) * ridge * strength;
  }
  bump += cross(nrm, vec3f(0.0, 1.0, 0.0)) * brush * strength * 0.45;
  return normalize(mix(nrm, normalize(bump), clamp(strength * 4.0, 0.0, 1.0)));
}

@fragment fn fs_build(input : BuildOut) -> @location(0) vec4f {
  var nrm = normalize(input.nrm);
  let L = normalize(-frame.sun_dir);
  let sh = mix(1.0, shadow_factor(input.world, nrm, L), 0.55);
  let hemi = 0.2 + 0.55 * max(nrm.y, 0.0);
  let wood = wood_grain(input.world, nrm);
  // Wardrobe / textured props encode flag as uv.x += 10
  let is_textured_prop = input.uv.x > 8.0;
  let face_uv = select(input.uv, vec2f(input.uv.x - 10.0, input.uv.y), is_textured_prop);
  let chroma = max(input.col.r, max(input.col.g, input.col.b))
    - min(input.col.r, min(input.col.g, input.col.b));
  let luma = dot(input.col, vec3f(0.333));
  // Brass fittings only — twig straw [0.66,0.54,0.34] must NOT match (was flat beige wash)
  let is_brass = !is_textured_prop && input.col.r > 0.70 && input.col.g > 0.48
    && input.col.g < input.col.r * 0.88
    && input.col.b < input.col.r * 0.42 && chroma > 0.28;
  // Rope / twine wraps on twig foundations
  let is_rope = !is_textured_prop && !is_brass && luma > 0.62
    && input.col.r > 0.72 && input.col.g > 0.62
    && chroma > 0.08 && chroma < 0.35
    && input.col.b > input.col.r * 0.55;
  let is_iron_prop = !is_textured_prop && chroma < 0.09 && luma > 0.28 && luma < 0.55
    && abs(input.col.r - input.col.b) < 0.06;
  // Structural tiers from pieceRgb
  // Cool galvanized steel / sheet metal (equal RGB) — must beat stone detection
  let is_metal_tier = !is_textured_prop && !is_brass && !is_rope
    && chroma < 0.10 && luma > 0.32 && luma < 0.78
    && abs(input.col.r - input.col.g) < 0.05
    && abs(input.col.g - input.col.b) < 0.05
    && !is_iron_prop;
  // Stone masonry — warm gray (r+g slightly above b), not cool steel
  let is_stone_tier = !is_textured_prop && !is_metal_tier && chroma < 0.20 && luma > 0.38 && luma < 0.78
    && (input.col.r + input.col.g) > input.col.b * 2.02
    && abs(input.col.r - input.col.g) < 0.14
    && !is_iron_prop && !is_brass && !is_rope;
  // Rusty sheet metal — orange-brown patchwork
  let is_rust_sheet = !is_textured_prop && !is_brass && !is_rope && !is_metal_tier
    && input.col.r > 0.40 && input.col.r > input.col.g + 0.06
    && input.col.g > input.col.b * 0.9
    && chroma > 0.16 && luma > 0.22 && luma < 0.50;
  // HQ armored plates — very dark cool gray
  let is_armor_tier = !is_textured_prop && !is_metal_tier && !is_rust_sheet
    && chroma < 0.16 && luma <= 0.32 && !is_brass;
  // Sleeping-bag / cloth props — green-teal fabric, not wood grain
  let is_fabric = !is_textured_prop && input.col.g > input.col.r + 0.04
    && input.col.g > input.col.b * 0.85
    && chroma > 0.06 && luma > 0.12 && luma < 0.55
    && !is_brass && !is_iron_prop;
  // Campfire flame / ember — hot orange-yellow, self-lit
  let is_flame = !is_textured_prop && input.col.r > 0.88
    && input.col.b < 0.42
    && input.col.g > 0.08
    && chroma > 0.32
    && !is_brass && !is_fabric;

  var col : vec3f;
  // Per-tier PBR-ish params — metals get real env reflections; wood/stone stay mostly diffuse.
  var metalness = 0.0;
  var roughness = 0.88;
  var env_str = 0.04;
  var bump_str = 0.0;
  if (is_textured_prop) {
    // Authored GLB albedo in vertex colors (wardrobe / WB / chest) — keep map detail
    let micro = biome_value_noise(input.world.xz * 5.5 + input.world.y * 3.2);
    col = input.col * (0.96 + 0.06 * micro);
    col *= 0.90 + 0.10 * max(nrm.y, 0.0);
    roughness = 0.65;
    env_str = 0.06;
  } else if (is_flame) {
    // Flicker + emissive glow (no wood grain wash)
    let flick = 0.72 + 0.28 * sin(frame.time * 12.5 + input.world.x * 9.0 + input.world.z * 7.0);
    let flick2 = 0.85 + 0.15 * sin(frame.time * 19.0 + input.world.y * 14.0);
    col = input.col * flick * flick2;
    roughness = 1.0;
    env_str = 0.0;
  } else if (is_fabric) {
    col = cloth_grain(input.world, nrm, input.col);
    roughness = 0.92;
    env_str = 0.03;
  } else if (is_rope) {
    // Twine wrap — soft fiber bands, keep cream albedo
    let weave = biome_value_noise(input.world.xz * 14.0 + input.world.y * 18.0);
    let strand = 0.5 + 0.5 * sin(input.world.y * 55.0 + weave * 4.0);
    col = input.col * (0.78 + 0.22 * strand) * (0.9 + 0.12 * weave);
    roughness = 0.95;
    env_str = 0.02;
  } else if (is_brass || is_iron_prop) {
    col = mix(wood * 0.15, input.col, 0.92);
    if (is_iron_prop) {
      let m = biome_value_noise(input.world.xz * 7.0 + input.world.y * 3.0);
      col *= 0.88 + 0.2 * m;
      metalness = 0.82;
      roughness = 0.38;
      env_str = 0.42;
    } else {
      metalness = 0.88;
      roughness = 0.32;
      env_str = 0.5;
    }
  } else if (is_metal_tier || is_rust_sheet) {
    col = metal_grain(input.world, nrm, input.col);
    if (is_rust_sheet) {
      metalness = 0.38;
      roughness = 0.62;
      env_str = 0.12;
      bump_str = 0.04;
    } else {
      // Galvanized steel — metallic, but not a meadow mirror
      metalness = 0.62;
      roughness = 0.38;
      env_str = 0.22;
      bump_str = 0.055;
    }
  } else if (is_stone_tier) {
    col = stone_grain(input.world, nrm, input.col);
    metalness = 0.0;
    roughness = 0.78;
    env_str = 0.06;
    bump_str = 0.02;
  } else if (is_armor_tier) {
    col = armor_grain(input.world, nrm, input.col);
    // HQ plates: dark graphite with controlled gloss (high env_str washed meadow green)
    metalness = 0.58;
    roughness = 0.42;
    env_str = 0.16;
    bump_str = 0.03;
  } else {
    // Twig + wood: keep rich procedural planks, soft tier wash only
    col = mix(wood, input.col, 0.18);
    // Pale straw decks (tier 0) get thatch wash; darker oak decks stay timber
    let is_thatch_deck = luma > 0.50 && input.col.r > 0.55 && input.col.g > 0.40
      && chroma > 0.14 && input.col.b < input.col.g * 0.85;
    if (is_thatch_deck && abs(nrm.y) > 0.55) {
      col = mix(col, vec3f(0.72, 0.58, 0.34), 0.32);
      col = mix(col, col * vec3f(1.06, 0.98, 0.88), 0.15);
      roughness = 0.92;
      env_str = 0.02;
    } else {
      roughness = 0.86;
      env_str = 0.05;
    }
  }

  let e = min(min(face_uv.x, 1.0 - face_uv.x), min(face_uv.y, 1.0 - face_uv.y));
  // Face-edge bevel only for procedural boxes; textured props keep full albedo
  if (!is_textured_prop) {
    col *= 0.78 + 0.22 * smoothstep(0.0, 0.07, e);
  }

  var lit : vec3f;
  if (is_flame) {
    // Self-illuminated — punches through night / shadow
    let glow = 1.55 + 0.85 * sin(frame.time * 8.0 + input.world.x * 5.0);
    lit = col * glow;
    lit += vec3f(1.0, 0.45, 0.08) * 0.35 * glow;
    lit += env_irradiance(nrm) * col * 0.08;
  } else {
    let V = normalize(frame.eye - input.world);
    let N = select(nrm, build_detail_normal(input.world, nrm, bump_str), bump_str > 0.001);
    let ndl_m = max(dot(N, L), 0.0);
    let ndv = max(dot(N, V), 0.0);
    let H = normalize(L + V);
    let ndh = max(dot(N, H), 0.0);
    let wrap_m = ndl_m * 0.55 + 0.45;

    // Conductors use albedo as F0; dielectrics stay ~4% Fresnel.
    let F0 = mix(vec3f(0.04), col, metalness);
    let F = F0 + (max(vec3f(1.0 - roughness), F0) - F0) * pow(1.0 - ndv, 5.0);

    // Keep enough diffuse so dark HQ/steel albedo still reads (was chrome-washed by env).
    let diff_k = mix(1.0, 0.28, metalness) * (1.0 - dot(F, vec3f(0.333)) * 0.35);
    lit = col * diff_k * (frame.amb * 1.05 + wrap_m * 0.95 * sh) * max(frame.light_col, vec3f(0.3));
    lit += col * diff_k * hemi * 0.34;
    lit += env_irradiance(N) * col * diff_k * 0.12;

    // Sun specular — GGX-ish (same helpers as terrain snow/marsh)
    let a = max(roughness * roughness, 0.04);
    let a2 = a * a;
    let d_den = ndh * ndh * (a2 - 1.0) + 1.0;
    let D = a2 / max(3.14159 * d_den * d_den, 1e-4);
    let G = G_smith(max(ndl_m, 0.02), max(ndv, 0.02), roughness);
    let spec = D * F * G / max(4.0 * max(ndl_m, 0.02) * max(ndv, 0.02), 1e-4);
    lit += max(frame.light_col, vec3f(0.25)) * spec * mix(0.35, 0.95, metalness) * sh;

    // Environment reflections — desaturate so IBL can't paint metal neon (green foliage / dusk purple)
    let R = reflect(-V, N);
    var env = env_refl_rough(R, roughness);
    let env_luma = dot(env, vec3f(0.299, 0.587, 0.114));
    let green_bias = max(0.0, env.g - max(env.r, env.b));
    let purple_bias = max(0.0, min(env.r, env.b) - env.g);
    env = mix(env, vec3f(env_luma), 0.55 + green_bias * 1.8 + purple_bias * 2.2);
    // Metals tint reflections with albedo (steel stays steel); dielectrics keep more sky.
    env = mix(env, col * (0.85 + env_luma * 0.35), mix(0.2, 0.55, metalness));
    lit += env * F * env_str * mix(0.7, 1.0, metalness);
  }
  lit = apply_fog(lit, input.world);
  return vec4f(clamp(lit, vec3f(0.0), vec3f(select(2.6, 4.5, is_flame))), 1.0);
}

@fragment fn fs_build_fx(input : BuildOut) -> @location(0) vec4f {
  let nrm = normalize(input.nrm);
  let L = normalize(-frame.sun_dir);
  let ndl = max(dot(nrm, L), 0.0);
  let is_dust = input.uv.x < -0.5;
  // Neutral lighting preserves authored particle colors (wood/dirt/fire)
  // instead of the blue/red placement-ghost palette.
  let light_luma = dot(frame.light_col, vec3f(0.299, 0.587, 0.114));
  let shade = 0.52 + ndl * 0.42 + max(nrm.y, 0.0) * 0.16;
  var lit = input.col * shade * clamp(light_luma + frame.amb * 1.4, 0.72, 1.35);
  lit = apply_fog(lit, input.world);
  var alpha = clamp(length(input.col) * 1.35, 0.28, 0.9);
  if (is_dust) {
    let dust_uv = vec2f((input.uv.x + 2.0) * 2.0 - 1.0, input.uv.y * 2.0 - 1.0);
    let radius = length(dust_uv);
    let soft = 1.0 - smoothstep(0.18, 1.0, radius);
    let breakup = 0.72 + biome_value_noise(input.world.xz * 7.0 + frame.time * 0.04) * 0.28;
    alpha = soft * breakup * clamp(length(input.col) * 1.15, 0.18, 0.62);
    if (alpha < 0.012) { discard; }
  }
  return vec4f(clamp(lit, vec3f(0.0), vec3f(2.4)), alpha);
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
  @location(4) solid_w : f32,    // 0 cards, 1 cylinder wall, 2 stump cap
};

@vertex fn vs_tree(input : TreeIn) -> TreeOut {
  var o : TreeOut;
  let species = input.tdata.x;
  let scale = input.tdata.y;
  let yaw = input.tdata.z;
  let phase = input.tdata.w;
  let is_cyl = input.part_x >= 99.5;
  let part = select(floor(input.part_x * 0.1), input.part_x - 100.0, is_cyl);
  let cross_i = select(input.part_x - part * 10.0, 0.0, is_cyl);
  let ang = yaw + cross_i * 1.04719755; // 60° crosses — enough volume, less clutter
  let ca = cos(ang);
  let sa = sin(ang);
  let sway = sin(frame.time * (0.45 + phase * 0.4) + phase * 6.28) * 0.14 * scale;

  var world = input.base;
  var uv = input.corner;

  if (is_cyl) {
    // Solid tapered bole (part 0), stump wall (part 4), or sealed cap (part 5).
    let t = input.corner.y;
    var trunk_h = 3.0 * scale;
    var half0 = 0.28;
    var half1 = 0.12;
    if (species > 0.5 && species < 1.5) { trunk_h = 4.6 * scale; half0 = 0.22; half1 = 0.09; }
    else if (species > 5.5 && species < 6.5) { trunk_h = 4.9 * scale; half0 = 0.24; half1 = 0.10; }
    else if (species > 1.5 && species < 2.5) { trunk_h = 5.1 * scale; half0 = 0.26; half1 = 0.11; }
    else if (species > 2.5 && species < 3.5) { trunk_h = 4.8 * scale; half0 = 0.36; half1 = 0.13; }
    else if (species > 3.5 && species < 4.5) { trunk_h = 2.35 * scale; half0 = 0.16; half1 = 0.07; }
    else if (species > 4.5 && species < 5.5) { trunk_h = 2.7 * scale; half0 = 0.28; half1 = 0.20; }
    else if (species > 6.5 && species < 7.5) { trunk_h = 5.2 * scale; half0 = 0.16; half1 = 0.06; }
    else if (species > 7.5 && species < 8.5) { trunk_h = 6.0 * scale; half0 = 0.18; half1 = 0.065; }
    else if (species > 8.5 && species < 9.5) { trunk_h = 5.0 * scale; half0 = 0.28; half1 = 0.12; }
    else if (species > 9.5 && species < 10.5) { trunk_h = 5.4 * scale; half0 = 0.24; half1 = 0.16; }
    else { trunk_h = 4.85 * scale; half0 = 0.38; half1 = 0.15; }
    let stump_h = trunk_h * 0.15;
    let theta = input.corner.x * 6.28318530718 + yaw;
    let radial = vec2f(cos(theta), sin(theta));
    // Slight radial irregularity removes the lathed/plastic silhouette while
    // staying identical across stump, caps and bole at the cut.
    let organic = 1.0
      + sin(theta * 3.0 + phase * 6.283) * 0.038
      + sin(theta * 7.0 - phase * 4.1) * 0.018;
    if (part > 4.5) {
      let cap_delta = input.base.xz - frame.fall_hinge.xz;
      let is_active_bole_cap = part < 5.5 || (
        frame.fall_tip.w > 0.0 && dot(cap_delta, cap_delta) <= frame.fall_tip.w
      );
      let cap_r = half0 * scale * 1.16 * organic * t * select(0.0, 1.0, is_active_bole_cap);
      world = vec3f(
        input.base.x + radial.x * cap_r,
        input.base.y + stump_h + 0.002,
        input.base.z + radial.y * cap_r,
      );
      uv = vec2f(input.corner.x, t);
    } else if (part > 3.5) {
      let flare = mix(1.45, 1.18, smoothstep(0.0, 1.0, t));
      let radius = half0 * scale * flare * organic;
      world = vec3f(
        input.base.x + radial.x * radius,
        input.base.y + t * stump_h,
        input.base.z + radial.y * radius,
      );
      uv = vec2f(input.corner.x, t * 0.15);
    } else {
      let local_t = mix(0.15, 1.0, t);
      let radius = mix(half0 * 1.18, half1, pow(t, 0.9)) * scale * organic;
      let lean = (phase - 0.5) * 0.08 * t * (trunk_h - stump_h);
      world = vec3f(
        input.base.x + radial.x * radius + lean * cos(yaw),
        input.base.y + stump_h + t * (trunk_h - stump_h),
        input.base.z + radial.y * radius + lean * sin(yaw),
      );
      uv = vec2f(input.corner.x, local_t);
    }
  } else if (part < 0.5) {
    // TRUNK
    let t = input.corner.y;
    var trunk_h = 3.0 * scale;
    var half0 = 0.28;
    var half1 = 0.12;
    if (species > 0.5 && species < 1.5) { trunk_h = 4.6 * scale; half0 = 0.22; half1 = 0.09; } // pine — long bole
    else if (species > 5.5 && species < 6.5) { trunk_h = 4.9 * scale; half0 = 0.24; half1 = 0.10; } // snow fir
    else if (species > 1.5 && species < 2.5) { trunk_h = 5.1 * scale; half0 = 0.26; half1 = 0.11; } // maple
    else if (species > 2.5 && species < 3.5) { trunk_h = 4.8 * scale; half0 = 0.36; half1 = 0.13; } // willow
    else if (species > 3.5 && species < 4.5) { trunk_h = 2.35 * scale; half0 = 0.16; half1 = 0.07; } // scrub — short stem
    else if (species > 4.5 && species < 5.5) { trunk_h = 2.7 * scale; half0 = 0.28; half1 = 0.20; } // cactus
    else if (species > 6.5 && species < 7.5) { trunk_h = 5.2 * scale; half0 = 0.16; half1 = 0.06; } // birch slender
    else if (species > 7.5 && species < 8.5) { trunk_h = 6.0 * scale; half0 = 0.18; half1 = 0.065; } // poplar tall
    else if (species > 8.5 && species < 9.5) { trunk_h = 5.0 * scale; half0 = 0.28; half1 = 0.12; } // cedar
    else if (species > 9.5 && species < 10.5) { trunk_h = 5.4 * scale; half0 = 0.24; half1 = 0.16; } // palm
    else { trunk_h = 4.85 * scale; half0 = 0.38; half1 = 0.15; } // oak — clear timber bole
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
      // Pine / fir / cedar — thicker discs so stacked layers overlap (no floating pancakes)
      rad_x *= 1.12;
      rad_y *= 0.95;
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

  // Rotate the complete bole + branches + existing canopy around the cut.
  // Stump wall/cap are explicitly excluded, so foliage geometry is untouched.
  let keep_stump = is_cyl && part > 3.5 && part < 5.5;
  let fall_delta = input.base.xz - frame.fall_hinge.xz;
  if (!keep_stump && frame.fall_tip.w > 0.0
      && dot(fall_delta, fall_delta) <= frame.fall_tip.w) {
    let pivot = vec3f(
      frame.fall_hinge.x,
      frame.fall_hinge.y + frame.fall_hinge.w,
      frame.fall_hinge.z,
    );
    let axis = normalize(vec3f(frame.fall_tip.y, 0.0, -frame.fall_tip.x));
    let rel = world - pivot;
    let c = cos(frame.fall_tip.z);
    let s = sin(frame.fall_tip.z);
    world = pivot + rel * c + cross(axis, rel) * s + axis * dot(axis, rel) * (1.0 - c);
  }

  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.uv = uv;
  o.tdata = input.tdata;
  o.world = world;
  o.part_w = select(part, 0.0, is_cyl && part > 3.5 && part < 4.5);
  o.solid_w = select(0.0, select(1.0, 2.0, part > 4.5), is_cyl);
  return o;
}

@fragment fn fs_tree(input : TreeOut) -> @location(0) vec4f {
  let species = input.tdata.x;
  let phase = input.tdata.w;
  let part = input.part_w;
  let u = input.uv.x;
  let v = input.uv.y;
  let is_solid = input.solid_w > 0.5;
  let is_cap = input.solid_w > 1.5;
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

  if (is_cap) {
    mask = 1.0;
    let rr = clamp(v, 0.0, 1.0);
    let ring_warp = biome_value_noise(vec2f(u * 13.0 + phase, rr * 7.0));
    let rings = 0.5 + 0.5 * sin(rr * 58.0 + ring_warp * 7.0);
    let cut = biome_value_noise(vec2f(u * 18.0, rr * 12.0 + phase));
    let radial_crack = smoothstep(0.93, 0.995, abs(sin(u * 31.4159 + ring_warp * 2.4))) * smoothstep(0.35, 0.95, rr);
    col = mix(vec3f(0.42, 0.24, 0.1), vec3f(0.74, 0.51, 0.25), rings * 0.58 + cut * 0.18);
    col = mix(col, col * 0.36, radial_crack * 0.62);
  } else if (part < 0.5) {
    let flare = mix(1.18, 0.94, smoothstep(0.0, 0.25, v));
    let taper = mix(0.98, 0.62, pow(v, 0.82)) * flare;
    // Soft bark edge (less cardboard cutout)
    mask = select(
      1.0 - smoothstep(taper - 0.02, taper + 0.09, abs(u)),
      1.0,
      is_solid,
    );
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
    if (is_solid && !(species > 4.5 && species < 5.5)) {
      // Fine longitudinal fissures and bark plates only on solid geometry.
      let groove = 0.5 + 0.5 * sin(u * 113.097 + phase * 5.0 + bark * 4.0);
      let micro = biome_value_noise(vec2f(u * 42.0 + phase, v * 155.0));
      let fissure = smoothstep(0.78, 0.98, groove * 0.72 + micro * 0.42);
      col *= 0.84 + groove * 0.18 + micro * 0.06;
      col = mix(col, col * 0.42, fissure * 0.52);
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
      let r = length(vec2f(u * 1.02, v * 1.12));
      let scallop = 0.06 * sin(ang * 5.0 + phase * 3.0) + 0.03 * sin(ang * 9.0 - leafFine * 2.0);
      let edge_r = 0.82 + scallop + leafClump * 0.05;
      mask = 1.0 - smoothstep(edge_r - 0.18, edge_r + 0.18, r);
      let dens = leafClump * 0.35 + leafMicro * 0.4 + leafFine * 0.25;
      let rim = smoothstep(edge_r - 0.35, edge_r + 0.05, r);
      mask *= mix(1.0, smoothstep(0.18, 0.62, dens), rim * 0.55);
      // Soft needle flecks near rim only
      mask *= 1.0 - smoothstep(0.85, 0.99, leafFine) * rim * 0.22;
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
  if (is_cap) {
    nrm = vec3f(0.0, 1.0, 0.0);
  } else if (is_solid) {
    let theta = u * 6.28318530718 + input.tdata.z;
    let radial = vec3f(cos(theta), 0.0, sin(theta));
    let tangent = vec3f(-sin(theta), 0.0, cos(theta));
    let ridge = sin(u * 113.097 + v * 31.0 + phase * 4.0);
    let coarse = biome_value_noise(vec2f(u * 34.0 + phase, v * 82.0)) - 0.5;
    nrm = normalize(radial + tangent * (ridge * 0.075 + coarse * 0.14) + vec3f(0.0, 0.055 + coarse * 0.05, 0.0));
  } else if (part < 0.5) {
    // Cylindrical trunk normal in card space
    let ang = u * 1.35;
    nrm = normalize(vec3f(sin(ang) * 1.15, 0.08 + v * 0.18, cos(ang) * 0.95 + (1.0 - abs(u)) * 0.25));
  } else if (part < 1.5) {
    nrm = normalize(vec3f(u * 2.4, 0.3 - v * 0.15, 0.78 + (1.0 - abs(u)) * 0.2));
  } else if (part < 2.5) {
    let rr = length(vec2f(u, v));
    let nz = sqrt(max(0.04, 1.0 - rr * rr * 0.88));
    // Dome + micro leaf bump from UV noise
    let bump = fract(sin(dot(vec2f(u, v), vec2f(19.1, 47.3)) + phase * 5.0) * 43758.55);
    nrm = normalize(vec3f(u * 2.35, 0.62 - v * 0.95, nz * 1.25)
      + vec3f(bump - 0.5, (fract(bump * 3.7) - 0.5) * 0.6, fract(bump * 7.1) - 0.5) * 0.28);
  } else {
    nrm = normalize(vec3f(u * 1.85, 0.7 - v * 0.5, 0.85));
  }
  let to_eye = normalize(frame.eye - input.world);
  // Two-sided cards: flip when viewing the back
  if (dot(nrm, to_eye) < 0.0) { nrm = -nrm; }
  nrm = normalize(mix(nrm, to_eye, 0.06));
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
  let sun = mix(frame.light_col, vec3f(0.9, 0.95, 1.0) * length(frame.light_col), 0.25) * 0.82;
  var lit = col * (frame.amb * 0.55 + wrap * 0.62 * sh) * sun * self_ao;
  lit += col * hemi * 0.24 * self_ao;
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
    // Richer leaf SSS — thickness from rim + wrap lighting
    let nde = max(dot(nrm, to_eye), 0.0);
    let thick = pow(1.0 - nde, 1.35);
    let wrap_l = max(dot(nrm, L) * 0.55 + 0.45, 0.0);
    lit += col * vec3f(0.32, 0.58, 0.16) * thick * wrap_l * 0.55 * sh;
    let back = pow(max(dot(-nrm, L), 0.0), 1.15);
    lit += col * sun * vec3f(0.42, 0.72, 0.2) * back * 0.38;
    lit += col * vec3f(0.28, 0.4, 0.52) * max(nrm.y, 0.0) * 0.14;
    // Specular sheen on leaf faces
    let h = normalize(L + to_eye);
    lit += sun * pow(max(dot(nrm, h), 0.0), 48.0) * 0.08 * sh * (1.0 - thick * 0.5);
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
  let is_solid = input.solid_w > 0.5;
  var mask = 1.0;
  if (is_solid) {
    mask = 1.0;
  } else if (part < 0.5) {
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

