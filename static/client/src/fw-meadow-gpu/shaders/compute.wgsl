
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
  // FE-ish heights — marsh reeds slightly shorter so trunks/feet stay readable
  var h_lo = 0.48 * bw.meadow + 0.32 * bw.dry + 0.70 * bw.forest
    + 0.18 * bw.snow + 0.48 * bw.marsh + 0.12 * bw.desert;
  var h_hi = 0.92 * bw.meadow + 0.62 * bw.dry + 1.15 * bw.forest
    + 0.40 * bw.snow + 0.82 * bw.marsh + 0.32 * bw.desert;
  var dens = 1.0 * bw.meadow + 0.9 * bw.dry + 1.0 * bw.forest
    + 0.65 * bw.snow + 0.95 * bw.marsh + 0.4 * bw.desert;
  if (dens < 0.99 && blade_seed > dens) {
    h_lo = 0.02; h_hi = 0.04;
  }
  let h_base = mix(h_lo, h_hi, clump * 0.45 + blade_seed * 0.55);
  var height = h_base * mix(0.88, 1.22, blade_seed) * mix(0.15, 1.0, slope_ok);
  // Full-island carpet — only beach/coast fades (no moving circular patch)
  let iedge = island_edge_w(vec2f(wx, wz));
  // Keep beach clear of grass — wide sandy berm before waterline
  if (iedge > 0.05 || wy < -0.12) {
    height = 0.01;
  } else if (iedge > 0.008) {
    height *= smoothstep(0.05, 0.008, iedge);
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
