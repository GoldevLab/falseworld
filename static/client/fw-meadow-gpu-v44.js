/** False World meadow WebGPU v44 — precise biome map matching grass. */
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
  let s = xz * (1.0 / 720.0);
  let temp = biome_fbm(s);
  let moist = biome_fbm(s + vec2f(17.0, -9.0));
  if (temp < -0.35) { return 3u; }
  if (temp > 0.42 && moist < -0.18) { return 5u; }
  if (moist > 0.38) {
    if (temp > 0.08) { return 4u; }
    return 2u;
  }
  if (moist < -0.28) { return 1u; }
  return 0u;
}
fn biome_ground(bid : u32) -> vec3f {
  switch bid {
    case 1u: { return vec3f(0.22, 0.20, 0.10); } // dry
    case 2u: { return vec3f(0.06, 0.10, 0.05); } // forest
    case 3u: { return vec3f(0.55, 0.58, 0.62); } // snow
    case 4u: { return vec3f(0.08, 0.12, 0.07); } // marsh
    case 5u: { return vec3f(0.42, 0.34, 0.18); } // desert
    default: { return vec3f(0.12, 0.14, 0.08); } // meadow
  }
}

@fragment fn fs_terrain(input : TerrainOut) -> @location(0) vec4f {
  let n = normalize(input.nrm);
  let L = normalize(-frame.sun_dir);
  let ndl = max(dot(n, L), 0.0);
  let bid = biome_id(input.world.xz);
  var col = biome_ground(bid);
  col = mix(col, col * 1.15, clamp(n.y * 0.5 + 0.2, 0.0, 1.0));
  // Water shelf past island rim
  let edge = length(input.world.xz) / 1024.0;
  if (edge > 0.92 || input.world.y < -4.0) {
    col = mix(col, vec3f(0.08, 0.18, 0.28), smoothstep(0.88, 1.02, edge));
  }
  col *= 0.45 + ndl * 0.55;
  let fog = smoothstep(90.0, 280.0, length(input.world.xz - frame.eye.xz));
  col = mix(col, vec3f(0.62, 0.72, 0.82), fog * 0.85);
  return vec4f(col, 1.0);
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
  let pos = blade.data0.xyz;
  let blade_type = floor(blade.data0.w + 0.01);
  let width = blade.data1.x;
  let height = blade.data1.y;
  let bend = blade.data1.z;
  let wind_str = blade.data1.w; // seed bias from bake
  let rot_s = blade.data2.x;
  let rot_c = blade.data2.y;
  let clump = blade.data2.z;
  let seed = blade.data2.w;
  let tn_x = blade.data3.x;
  let tn_z = blade.data3.y;
  let tn_y = sqrt(max(0.0, 1.0 - tn_x * tn_x - tn_z * tn_z));
  let terrain_n = normalize(vec3f(tn_x, tn_y, tn_z));

  let side = f32(vid % 2u) * 2.0 - 1.0;
  let t = f32(vid / 2u) / segs;

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
    world = world + (n_xz / n_xz_len) * (0.10 * edge_mask * center_mask);
  }

  var nrm = normalize(nrm_pre + side_w * (side * 0.35));

  // Biome-tinted grass (Fortnite-style regions)
  let bid = biome_id(pos.xz);
  var base_col = vec3f(0.10, 0.18, 0.06);
  var tip_a = vec3f(0.42, 0.58, 0.18);
  var tip_b = vec3f(0.55, 0.62, 0.22);
  var tip_c = vec3f(0.28, 0.48, 0.14);
  if (bid == 1u) { // dry plains
    base_col = vec3f(0.18, 0.20, 0.08);
    tip_a = vec3f(0.55, 0.52, 0.22);
    tip_b = vec3f(0.62, 0.55, 0.20);
    tip_c = vec3f(0.48, 0.42, 0.16);
  } else if (bid == 2u) { // forest
    base_col = vec3f(0.05, 0.12, 0.04);
    tip_a = vec3f(0.22, 0.42, 0.12);
    tip_b = vec3f(0.28, 0.48, 0.14);
    tip_c = vec3f(0.16, 0.34, 0.10);
  } else if (bid == 3u) { // snow
    base_col = vec3f(0.35, 0.40, 0.42);
    tip_a = vec3f(0.78, 0.82, 0.86);
    tip_b = vec3f(0.88, 0.90, 0.92);
    tip_c = vec3f(0.65, 0.72, 0.78);
  } else if (bid == 4u) { // marsh
    base_col = vec3f(0.06, 0.14, 0.08);
    tip_a = vec3f(0.22, 0.38, 0.18);
    tip_b = vec3f(0.30, 0.45, 0.16);
    tip_c = vec3f(0.18, 0.32, 0.20);
  } else if (bid == 5u) { // desert
    base_col = vec3f(0.28, 0.22, 0.10);
    tip_a = vec3f(0.62, 0.48, 0.22);
    tip_b = vec3f(0.72, 0.55, 0.24);
    tip_c = vec3f(0.50, 0.38, 0.16);
  }
  let tip_col = mix(mix(tip_a, tip_b, seed), tip_c, clump * 0.45);
  var col = mix(base_col, tip_col, pow(t, 0.85));
  // Dry/straw flecks (meadow/dry only)
  if (bid == 0u || bid == 1u) {
    col = mix(col, vec3f(0.52, 0.48, 0.22), seed * seed * 0.12 * t);
  }
  col *= mix(0.88, 1.12, clump) * mix(0.94, 1.06, seed);
  let ao = mix(0.42, 1.0, clamp(pow(t, 2.2), 0.0, 1.0));
  col *= ao;

  let cam_dist = cam_dist0;
  // Start earlier than FE 15–30 so mid/far stop sparkling
  let dist_fade = smoothstep(18.0, 55.0, cam_dist);
  let tip_emit = 0.0;

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

  let far = input.dist_fade;
  let near_w = 1.0 - far;

  // Soften material at distance — sub-pixel glints become horizon static
  let metal = mix(0.08, 0.02, far);
  let rough = mix(
    mix(0.62, 0.38, clamp((input.height_t - 0.35) / 0.65, 0.0, 1.0)),
    0.82,
    far
  );
  let light_i = mix(1.35, 0.95, far);
  // Daytime sun — warm white
  let sun = vec3f(1.0, 0.96, 0.88) * light_i;

  let hemi = input.color * (0.22 + 0.18 * max(n.y, 0.0));
  let diffuse = input.color * (1.0 - metal) * (0.18 + ndl * 0.72);

  let a = max(rough * rough, 0.04);
  let a2 = a * a;
  let d_den = ndh * ndh * (a2 - 1.0) + 1.0;
  let D = a2 / max(3.14159 * d_den * d_den, 1e-4);
  let F0 = mix(0.04, 0.22, metal);
  let F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
  let spec = D * F * pow(max(input.height_t, 0.0), 1.5) * step(0.12, ndl) * near_w * near_w;

  let fres = pow(1.0 - ndv, 5.0);
  let sparkle = fres * ndl * pow(input.height_t, 3.2) * 0.22 * near_w * near_w;

  // Daytime environment: warm ground bounce + blue sky
  let R = reflect(-V, n);
  let elev = clamp(R.y, -1.0, 1.0);
  let ground_warm = vec3f(0.28, 0.24, 0.12);
  let horizon = vec3f(0.55, 0.62, 0.68);
  let sky_low = vec3f(0.45, 0.62, 0.82);
  let sky_hi = vec3f(0.35, 0.55, 0.88);
  var env_col = mix(ground_warm, horizon, smoothstep(-0.55, -0.05, elev));
  env_col = mix(env_col, sky_low, smoothstep(-0.05, 0.35, elev));
  env_col = mix(env_col, sky_hi, smoothstep(0.35, 0.95, elev));
  // Soft sun hotspot in env
  let sun_lobe = pow(max(dot(normalize(R), normalize(-frame.sun_dir)), 0.0), 18.0);
  env_col = env_col + vec3f(1.0, 0.92, 0.75) * sun_lobe * 0.55;

  let ao_env = mix(0.4, 1.0, clamp(pow(input.height_t, 2.5), 0.0, 1.0));
  let env_i = 0.55;
  let env_diff = env_col * input.color * (1.0 - metal) * ao_env * env_i * 0.5;
  let env_spec = env_col * mix(vec3f(0.04), input.color, metal) * ao_env * env_i
    * (0.25 + (1.0 - rough) * 0.55) * pow(input.height_t, 1.2);

  let crest = 0.5 + 0.5 * sin(dot(input.world.xz, vec2f(1.0, 0.0)) * 0.15 + frame.time * 0.35);
  let crest2 = 0.5 + 0.5 * sin(dot(input.world.xz, vec2f(0.0, 1.0)) * 0.08 + frame.time * 0.22);
  let wave_lit = mix(0.9, 1.18, (crest * 0.65 + crest2 * 0.35) * near_w);

  var rgb = hemi * wave_lit
    + diffuse * sun * wave_lit
    + sun * (spec * 0.35 + sparkle) * mix(0.75, 1.15, crest * near_w)
    + env_diff
    + env_spec * near_w;

  // Collapse to soft carpet so far field isn't noisy static
  let carpet = input.color * (0.35 + ndl * 0.28);
  rgb = mix(rgb, carpet, far * 0.72);

  let fog_col = vec3f(0.62, 0.72, 0.82);
  let fog = smoothstep(80.0, 260.0, length(input.world.xz - frame.eye.xz));
  rgb = mix(rgb, fog_col, fog * 0.75);

  return vec4f(max(rgb, vec3f(0.0)), 1.0);
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
  // Daytime: no stars
  return vec4f(0.0);
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

struct RoseIn {
  @location(0) center : vec3f,
  @location(1) corner : vec2f,
  @location(2) phase : f32,
};
struct RoseOut {
  @builtin(position) clip : vec4f,
  @location(0) uv : vec2f,
  @location(1) phase : f32,
};
@vertex fn vs_rose(input : RoseIn) -> RoseOut {
  var o : RoseOut;
  let right = normalize(cross(vec3f(0.0, 1.0, 0.0), normalize(frame.eye - input.center)));
  let up = vec3f(0.0, 1.0, 0.0);
  let world = input.center + right * input.corner.x * 0.22 + up * input.corner.y * 0.22;
  o.clip = frame.view_proj * vec4f(world, 1.0);
  o.uv = input.corner * 0.5 + 0.5;
  o.phase = input.phase;
  return o;
}
@fragment fn fs_rose(input : RoseOut) -> @location(0) vec4f {
  let p = input.uv * 2.0 - 1.0;
  let ang = atan2(p.y, p.x);
  let r = length(p);
  // Soft rose silhouette: 5 petals
  let petals = 0.55 + 0.45 * cos(ang * 5.0 + input.phase);
  let edge = smoothstep(petals, petals - 0.22, r);
  if (edge < 0.01) { discard; }
  let core = smoothstep(0.35, 0.0, r);
  let tip = vec3f(0.72, 0.12, 0.22);
  let glow = tip * (0.35 + 0.65 * edge) * (0.75 + 0.35 * core);
  let pulse = 0.85 + 0.15 * sin(frame.time * 1.1 + input.phase);
  return vec4f(glow * 2.2 * pulse, edge * 0.85);
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
  origin_x : f32,
  origin_z : f32,
  area : f32,
  axis : u32,
  height_res : u32,
  seed : u32,
  _pad0 : u32,
  _pad1 : u32,
};
struct CullParams {
  eye : vec3f,
  blade_count : u32,
  view_proj : mat4x4f,
  lod0_max : f32,
  lod1_max : f32,
  _pad0 : f32,
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
  let s = xz * (1.0 / 720.0);
  let temp = biome_fbm(s);
  let moist = biome_fbm(s + vec2f(17.0, -9.0));
  if (temp < -0.35) { return 3u; }
  if (temp > 0.42 && moist < -0.18) { return 5u; }
  if (moist > 0.38) {
    if (temp > 0.08) { return 4u; }
    return 2u;
  }
  if (moist < -0.28) { return 1u; }
  return 0u;
}

fn sample_h(wx : f32, wz : f32) -> f32 {
  let res = i32(gen.height_res);
  if (res < 2) { return 0.0; }
  let u = clamp((wx - gen.origin_x) / gen.area + 0.5, 0.0, 1.0 - 1e-5);
  let v = clamp((wz - gen.origin_z) / gen.area + 0.5, 0.0, 1.0 - 1e-5);
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
  let spacing = gen.area / f32(n);
  let half = gen.area * 0.5;
  let j = hash22(vec2f(f32(ix) + f32(gen.seed) * 0.001, f32(iz)));
  let lx = -half + (f32(ix) + j.x) * spacing;
  let lz = -half + (f32(iz) + j.y) * spacing;
  let wx = gen.origin_x + lx;
  let wz = gen.origin_z + lz;
  let wy = sample_h(wx, wz);
  let step = gen.area / f32(max(gen.height_res, 2u) - 1u);
  let hx0 = sample_h(wx - step, wz);
  let hx1 = sample_h(wx + step, wz);
  let hz0 = sample_h(wx, wz - step);
  let hz1 = sample_h(wx, wz + step);
  var nrm = normalize(vec3f(hx0 - hx1, 2.0 * step, hz0 - hz1));
  // Flatten alignment on slopes so distant hills aren't "hairy mountains"
  let slope = clamp(nrm.y, 0.0, 1.0);
  let slope_ok = smoothstep(0.52, 0.82, slope);
  nrm = normalize(mix(vec3f(0.0, 1.0, 0.0), nrm, slope_ok));

  let blade_seed = hash21(vec2f(f32(ix), f32(iz) + f32(gen.seed)));
  let clump = hash21(vec2f(f32(ix / 4u) + f32(gen.seed) * 0.01, f32(iz / 4u)));
  let kind = floor(blade_seed * 3.0);
  // Biome height / density
  let bid = biome_id(vec2f(wx, wz));
  var h_lo = 0.72;
  var h_hi = 1.25;
  var dens = 1.0;
  if (bid == 1u) { h_lo = 0.45; h_hi = 0.85; dens = 0.85; }
  else if (bid == 2u) { h_lo = 0.95; h_hi = 1.55; dens = 1.0; }
  else if (bid == 3u) { h_lo = 0.25; h_hi = 0.55; dens = 0.55; }
  else if (bid == 4u) { h_lo = 0.85; h_hi = 1.45; dens = 0.9; }
  else if (bid == 5u) { h_lo = 0.15; h_hi = 0.42; dens = 0.35; }
  // Sparse biomes: cull some blades by shrinking height to ~0
  if (dens < 0.99 && blade_seed > dens) {
    h_lo = 0.02; h_hi = 0.04;
  }
  let h_base = mix(h_lo, h_hi, clump * 0.45 + blade_seed * 0.55);
  let height = h_base * mix(0.82, 1.32, blade_seed) * mix(0.12, 1.0, slope_ok);
  let width = mix(0.012, 0.045, 1.0 - blade_seed);
  let bend = mix(0.25, 0.65, clump);
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
  _pad0 : f32,
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
  // Drop extreme horizon blades — they only add aliasing noise
  if (dist > 110.0) { return; }
  let noise = fract(f32(i) * 0.12345) * 2.0 - 1.0;
  let nd = dist + noise * dist * 0.04;
  // Thin far LOD: keep ~55% of distant blades (less shimmer density)
  if (nd >= cull.lod1_max) {
    let keep = fract(f32(i) * 0.754877666 + f32(i / 97u) * 0.312);
    if (keep > 0.55) { return; }
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
  _pad : f32,
};
@group(0) @binding(0) var post_samp : sampler;
@group(0) @binding(1) var post_tex : texture_2d<f32>;
@group(0) @binding(2) var post_tex_b : texture_2d<f32>;
@group(0) @binding(3) var post_depth : texture_depth_2d;
@group(0) @binding(4) var<uniform> post : PostParams;

fn linearize_depth(d : f32) -> f32 {
  let z = d * 2.0 - 1.0;
  return (2.0 * post.near * post.far) / (post.far + post.near - z * (post.far - post.near));
}

@fragment fn fs_bright(input : PostOut) -> @location(0) vec4f {
  let c = textureSample(post_tex, post_samp, input.uv).rgb;
  let lum = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  // FE Bloom threshold ~0.35 — keep glints, avoid wash
  let kn = max(lum - 0.40, 0.0);
  return vec4f(c * (kn * 1.45), 1.0);
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
      let o = vec2f(f32(x), f32(y)) * texel * (1.0 + coc * 3.5);
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

@fragment fn fs_composite(input : PostOut) -> @location(0) vec4f {
  var uv = input.uv;
  if (post.helmet > 0.01) {
    let to_c = uv - vec2f(0.5);
    let dist = length(to_c);
    uv = uv - to_c * pow(dist, 3.0) * 0.2 * post.helmet;
  }

  let dims = vec2f(textureDimensions(post_tex));
  let texel = 1.0 / dims;
  let sharp = textureSample(post_tex, post_samp, uv).rgb;
  let bloom = textureSample(post_tex_b, post_samp, uv).rgb;

  let raw_d = textureLoad(post_depth, vec2i(clamp(uv, vec2f(0.0), vec2f(0.999)) * dims), 0);
  let z = linearize_depth(raw_d);
  let coc = clamp(abs(z - post.focus_dist) / max(post.focal_len, 0.01) * post.bokeh, 0.0, 1.0);

  var dof = vec3f(0.0);
  var wsum = 0.0;
  for (var y = -2; y <= 2; y++) {
    for (var x = -2; x <= 2; x++) {
      let o = vec2f(f32(x), f32(y)) * texel * (1.0 + coc * 4.0);
      let w = 1.0 / (1.0 + f32(x * x + y * y));
      dof += textureSample(post_tex, post_samp, uv + o).rgb * w;
      wsum += w;
    }
  }
  dof /= wsum;

  var rgb = mix(sharp, dof, coc * 0.8) + bloom * 0.26;
  rgb *= post.exposure;
  rgb = aces(rgb);

  let luma = dot(rgb, vec3f(0.299, 0.587, 0.114));
  let l_n = dot(textureSample(post_tex, post_samp, uv + vec2f(0.0, -texel.y)).rgb, vec3f(0.299, 0.587, 0.114));
  let l_s = dot(textureSample(post_tex, post_samp, uv + vec2f(0.0, texel.y)).rgb, vec3f(0.299, 0.587, 0.114));
  let l_e = dot(textureSample(post_tex, post_samp, uv + vec2f(texel.x, 0.0)).rgb, vec3f(0.299, 0.587, 0.114));
  let l_w = dot(textureSample(post_tex, post_samp, uv + vec2f(-texel.x, 0.0)).rgb, vec3f(0.299, 0.587, 0.114));
  let edge = smoothstep(0.05, 0.2, abs(luma * 4.0 - (l_n + l_s + l_e + l_w)));
  let fx = (
    textureSample(post_tex, post_samp, uv + vec2f(texel.x, 0.0)).rgb +
    textureSample(post_tex, post_samp, uv + vec2f(-texel.x, 0.0)).rgb +
    textureSample(post_tex, post_samp, uv + vec2f(0.0, texel.y)).rgb +
    textureSample(post_tex, post_samp, uv + vec2f(0.0, -texel.y)).rgb
  ) * 0.25;
  rgb = mix(rgb, aces(fx * post.exposure), edge * 0.3);

  let d = length(uv - vec2f(0.5));
  rgb *= 1.0 - smoothstep(0.55, 1.05, d) * (0.35 + 0.25 * post.helmet);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0);
}

// Avatar atlas: top half = color RGBA, bottom half = linDepth/far in R
@group(0) @binding(5) var avatar_atlas : texture_2d<f32>;

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
  // Avatar atlas depth is already biased nearer (~0.18m). Extra slack for
  // coplanar soles vs terrain; grass still wins when clearly in front.
  let bias = mix(0.25, 0.55, smoothstep(0.15, 0.85, av.a));
  let cover = select(0.0, 1.0, av.a >= 0.04 && av_z < meadow_z + bias);
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
    const device = await adapter.requestDevice(
      wantF16 ? { requiredFeatures: ["float16-filterable"] } : {}
    );
    // FE default 1024²; fall back on tighter storage limits
    const maxStorage = adapter.limits.maxStorageBufferBindingSize || 134217728;
    let BLADE_AXIS = 1024;
    while (BLADE_AXIS * BLADE_AXIS * 64 > maxStorage * 0.7 && BLADE_AXIS > 256) {
      BLADE_AXIS = Math.floor(BLADE_AXIS * 0.75);
    }
    BLADE_AXIS = Math.max(256, Math.min(1024, BLADE_AXIS));
    const BLADE_COUNT = BLADE_AXIS * BLADE_AXIS;

    const context = canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    const sceneFormat = wantF16 ? "rgba16float" : "rgba8unorm";
    const bloomScale = 0.5;
    const NEAR = 0.1, FAR = 420;
    const ISLAND_HALF = 1024;
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
      // Must match WGSL biome_hash21 / biome_id exactly (integer hash, no sin).
      const hash21 = (ix, iz) => {
        let n = (Math.imul(ix | 0, 1597334677) + Math.imul(iz | 0, 3812015801)) >>> 0;
        n = ((n << 13) ^ n) >>> 0;
        n = Math.imul(n, 1274126177) >>> 0;
        return n / 4294967295;
      };
      const valueNoise = (px, py) => {
        const ix = Math.floor(px);
        const iz = Math.floor(py);
        const fx = px - ix;
        const fz = py - iz;
        const ux = fx * fx * (3 - 2 * fx);
        const uz = fz * fz * (3 - 2 * fz);
        const a = hash21(ix, iz);
        const b = hash21(ix + 1, iz);
        const c = hash21(ix, iz + 1);
        const d = hash21(ix + 1, iz + 1);
        return (a + (b - a) * ux + (c + (d - c) * ux - (a + (b - a) * ux)) * uz) * 2 - 1;
      };
      const fbm = (px, py) => {
        let s = 0, a = 1, f = 1, n = 0;
        for (let i = 0; i < 4; i++) {
          s += valueNoise(px * f, py * f) * a;
          n += a;
          a *= 0.5;
          f *= 2.02;
        }
        return s / Math.max(n, 1e-5);
      };
      const sx = x / 720;
      const sz = z / 720;
      const temp = fbm(sx, sz);
      const moist = fbm(sx + 17, sz - 9);
      if (temp < -0.35) return 3;
      if (temp > 0.42 && moist < -0.18) return 5;
      if (moist > 0.38) return temp > 0.08 ? 4 : 2;
      if (moist < -0.28) return 1;
      return 0;
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
      "<h2>Isla · 2×2 km</h2>" +
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

    function paintWorldMapBase() {
      const size = mapCanvas.width;
      const img = mapCtx.createImageData(size, size);
      const data = img.data;
      const denom = size;
      for (let py = 0; py < size; py++) {
        // Top of map = North = −Z (matches compass). Sample pixel centers.
        const wz = ((py + 0.5) / denom - 0.5) * 2 * ISLAND_HALF;
        for (let px = 0; px < size; px++) {
          const wx = ((px + 0.5) / denom - 0.5) * 2 * ISLAND_HALF;
          const o = (py * size + px) * 4;
          const edge = Math.hypot(wx, wz) / ISLAND_HALF;
          if (edge > 1.0) {
            const deep = Math.min(1, (edge - 1) * 3);
            data[o] = 12 + deep * 8;
            data[o + 1] = 36 + deep * 12;
            data[o + 2] = 58 + deep * 20;
            data[o + 3] = 255;
          } else {
            const bid = biomeAtJs(wx, wz);
            const c = BIOME_RGB[bid];
            const rim = edge > 0.9 ? (edge - 0.9) / 0.1 : 0;
            data[o] = (c[0] * (1 - rim) + 18 * rim) | 0;
            data[o + 1] = (c[1] * (1 - rim) + 48 * rim) | 0;
            data[o + 2] = (c[2] * (1 - rim) + 72 * rim) | 0;
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
      const px = (wx / ISLAND_HALF * 0.5 + 0.5) * size - 0.5;
      const py = (wz / ISLAND_HALF * 0.5 + 0.5) * size - 0.5;
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
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
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

    const sceneModule = device.createShaderModule({ code: SCENE_WGSL });
    const initModule = device.createShaderModule({ code: COMPUTE_WGSL });
    const cullModule = device.createShaderModule({ code: CULL_WGSL });
    const postModule = device.createShaderModule({ code: POST_WGSL });

    const frameBuf = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const postParamBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const genBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const cullBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const frameBgl = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
    });
    const grassBgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });
    const framePipeLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBgl] });
    const grassPipeLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBgl, grassBgl] });
    const frameBind = device.createBindGroup({
      layout: frameBgl,
      entries: [{ binding: 0, resource: { buffer: frameBuf } }],
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

    function makeGrassPipe(entry) {
      return device.createRenderPipeline({
        layout: grassPipeLayout,
        vertex: { module: sceneModule, entryPoint: entry, buffers: [] },
        fragment: { module: sceneModule, entryPoint: "fs_grass", targets: [{ format: sceneFormat }] },
        primitive: { topology: "triangle-strip", cullMode: "none" },
        depthStencil,
      });
    }
    const grassPipe15 = makeGrassPipe("vs_grass15");
    const grassPipe5 = makeGrassPipe("vs_grass5");
    const grassPipe2 = makeGrassPipe("vs_grass2");

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
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" },
            { shaderLocation: 1, offset: 12, format: "float32x2" },
            { shaderLocation: 2, offset: 20, format: "float32" },
          ],
        }],
      },
      fragment: {
        module: sceneModule, entryPoint: "fs_rose",
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

    // Compute pipelines
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
      size: 384 * 384 * 4,
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
    const drawsClear = new Uint32Array([
      32, 0, 0, 0,
      12, 0, 0, 0,
      6, 0, 0, 0,
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
      ],
    });
    const mergeLayout = device.createPipelineLayout({ bindGroupLayouts: [mergeBgl] });
    const mergePipe = device.createRenderPipeline({
      layout: mergeLayout,
      vertex: { module: postModule, entryPoint: "vs_post" },
      fragment: { module: postModule, entryPoint: "fs_avatar_merge", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });

    function postBind(texA, texB) {
      return device.createBindGroup({
        layout: postBgl,
        entries: [
          { binding: 0, resource: postSamp },
          { binding: 1, resource: texA },
          { binding: 2, resource: texB || texA },
          { binding: 3, resource: depthView },
          { binding: 4, resource: { buffer: postParamBuf } },
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
          { binding: 5, resource: avatarAtlasView },
        ],
      });
    }

    let terrainVbo = null, terrainIbo = null, terrainIndexCount = 0;
    let chunk = null, baking = false, grassReady = false;
    let beamVbo = null, beamVertCount = 0;
    let roseVbo = null, roseVertCount = 0;

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

      // Rose billboards
      const roseVerts = [];
      const corners2 = [[-1, -1], [1, -1], [-1, 1], [1, -1], [1, 1], [-1, 1]];
      for (let i = 0; i < 36; i++) {
        const ang = hash(i * 17.3) * Math.PI * 2;
        const r = 6 + hash(i * 9.1) * 26;
        const rx = chunk.origin_x + Math.cos(ang) * r;
        const rz = chunk.origin_z + Math.sin(ang) * r;
        const ry = sampleHeight(chunk, rx, rz) + 0.28;
        const phase = hash(i * 3.7) * 6.28;
        for (const c of corners2) {
          roseVerts.push(rx, ry, rz, c[0], c[1], phase);
        }
      }
      const rArr = new Float32Array(roseVerts);
      if (roseVbo) try { roseVbo.destroy(); } catch (_) {}
      roseVbo = device.createBuffer({
        size: rArr.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
      });
      new Float32Array(roseVbo.getMappedRange()).set(rArr);
      roseVbo.unmap();
      roseVertCount = rArr.length / 6;
    }

    function hash(n) {
      const s = Math.sin(n * 127.1) * 43758.5453;
      return s - Math.floor(s);
    }

    function gpuInitBlades() {
      if (!chunk) return;
      const hr = chunk.height_res;
      const hBytes = hr * hr * 4;
      if (hBytes > heightBuf.size) {
        // recreate larger height buf if needed
      }
      device.queue.writeBuffer(heightBuf, 0, chunk.heights);

      const gen = new ArrayBuffer(32);
      const dv = new DataView(gen);
      dv.setFloat32(0, chunk.origin_x, true);
      dv.setFloat32(4, chunk.origin_z, true);
      dv.setFloat32(8, chunk.area, true);
      dv.setUint32(12, BLADE_AXIS, true);
      dv.setUint32(16, hr, true);
      dv.setUint32(20, chunk.seed, true);
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
        status: "Isla 2×2 km · GPU grass · " + BLADE_COUNT,
      });
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
      gpuInitBlades();
      spawnBeamsAndRoses();
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
      if (!chunk) { bakeAt(0, 0); return; }
      const [ox, oz] = snapOrigin(player.x, player.z, chunk.area, BLADE_AXIS);
      bakeAt(ox, oz);
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
      orbitPitch = Math.max(0.08, Math.min(1.25, orbitPitch + dy * 0.008));
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
        const vx = (mx * rx + mz * fx) * speed * dt;
        const vz = (mx * rz + mz * fz) * speed * dt;
        player.x += vx;
        player.z += vz;
        // Soft clamp to island rim (~2 km diameter)
        const ir = Math.hypot(player.x, player.z);
        const irMax = ISLAND_HALF * 0.98;
        if (ir > irMax) {
          const s = irMax / ir;
          player.x *= s;
          player.z *= s;
        }
        // Face walk direction (keeps avatar aligned while you orbit-look)
        if (camMode !== "fpv") {
          player.yaw = Math.atan2(vx, vz);
        }
      }
      player.feetY = sampleHeight(chunk, player.x, player.z);
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
            status: "b68 · " + BIOME_NAMES[bid] + " · " + kmX + "," + kmZ + " km",
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

      const half = chunk.area * 0.42;
      if (Math.abs(player.x - chunk.origin_x) > half || Math.abs(player.z - chunk.origin_z) > half) {
        const [ox, oz] = snapOrigin(player.x, player.z, chunk.area, BLADE_AXIS);
        if (Math.abs(ox - chunk.origin_x) > 0.01 || Math.abs(oz - chunk.origin_z) > 0.01) {
          bakeAt(ox, oz);
        }
      }

      nextBeam -= dt;
      if (nextBeam <= 0) {
        nextBeam = 2 + Math.random() * 3;
        // pulse beam alphas via regenerating occasionally is heavy; skip for now
      }
    }

    function cameraMatrices() {
      const aspect = size.w / Math.max(1, size.h);
      const proj = mat4Persp((55 * Math.PI) / 180, aspect, NEAR, FAR);
      let eye, target;
      if (camMode === "fpv") {
        eye = [player.x, player.y, player.z];
        target = [player.x + Math.sin(player.yaw), player.y - 0.05, player.z + Math.cos(player.yaw)];
      } else {
        // Follow + Orbit: spherical camera around avatar (left-drag spins this)
        const dist = orbitDist;
        const cy = Math.cos(orbitPitch);
        const sy = Math.sin(orbitPitch);
        const lookY = camMode === "orbit" ? player.feetY + 1.05 : player.feetY + 0.95;
        eye = [
          player.x + Math.sin(orbitYaw) * cy * dist,
          lookY + sy * dist + (camMode === "orbit" ? 0.6 : 0.15),
          player.z + Math.cos(orbitYaw) * cy * dist,
        ];
        target = [player.x, lookY, player.z];
      }
      const view = mat4LookAt(eye, target, [0, 1, 0]);
      lastEye = eye;
      lastTarget = target;
      return { mvp: mat4Mul(proj, view), eye, focusDist: Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]) };
    }

    function getPose() {
      return {
        x: player.x, y: player.feetY, z: player.z, yaw: player.yaw,
        moving: player.moving, sprinting: player.sprinting, camMode, eye: lastEye, target: lastTarget,
        aspect: size.w / Math.max(1, size.h), fovDeg: 55,
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
      update(dt);

      const { mvp, eye, focusDist } = cameraMatrices();
      const ubo = new Float32Array(48);
      ubo.set(mvp, 0);
      // Day sun — high, slight warm bias
      const ang = now * 0.00015;
      const lx = Math.sin(ang) * 0.35;
      const ly = 0.85;
      const lz = Math.cos(ang) * 0.45;
      const llen = Math.hypot(lx, ly, lz) || 1;
      ubo[16] = lx / llen; ubo[17] = -ly / llen; ubo[18] = lz / llen;
      ubo[19] = now * 0.001;
      ubo[20] = eye[0]; ubo[21] = eye[1]; ubo[22] = eye[2];
      // push_r sits where _pad0 used to (float 23) — matches Frame.eye + Frame.push_r
      // push_r: FE ~0.7 — tight around feet/shins (was 1.45–1.65 blob)
      ubo[23] = player.sprinting ? 0.78 : (player.moving ? 0.68 : 0.58);
      // player as vec4: x, feetY, z, 1
      ubo[24] = player.x; ubo[25] = player.feetY; ubo[26] = player.z; ubo[27] = 1.0;
      // trail0..3 as vec4 (x, z, weight, 0)
      for (let i = 0; i < 4; i++) {
        const t = trailPts[i];
        const o = 28 + i * 4;
        ubo[o] = t.x; ubo[o + 1] = t.z; ubo[o + 2] = t.w; ubo[o + 3] = 0;
      }
      device.queue.writeBuffer(frameBuf, 0, ubo);

      const focalLen = camMode === "fpv" ? 10 : camMode === "orbit" ? 50 : 25;
      const postU = new Float32Array([
        focusDist, focalLen, camMode === "fpv" ? 0.0 : 3.2,
        1.25,
        camMode === "fpv" ? 1 : 0,
        NEAR, FAR, 0,
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

      if (grassReady) {
        const cullU = new ArrayBuffer(96);
        const cdv = new DataView(cullU);
        cdv.setFloat32(0, eye[0], true);
        cdv.setFloat32(4, eye[1], true);
        cdv.setFloat32(8, eye[2], true);
        cdv.setUint32(12, BLADE_COUNT, true);
        for (let i = 0; i < 16; i++) cdv.setFloat32(16 + i * 4, mvp[i], true);
        cdv.setFloat32(80, 12.0, true);
        cdv.setFloat32(84, 36.0, true); // farther mid LOD for large island view
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

      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: sceneView,
          clearValue: { r: 0.55, g: 0.68, b: 0.82, a: 1 },
          loadOp: "clear", storeOp: "store",
        }],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
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

      // Bloom
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{ view: bloomAView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(brightPipe);
        p.setBindGroup(0, postBind(sceneView, sceneView));
        p.draw(3);
        p.end();
      }
      for (let i = 0; i < 2; i++) {
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
      // DoF into dofTex (half-res)
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{ view: dofView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        p.setPipeline(dofPipe);
        p.setBindGroup(0, postBind(sceneView, sceneView));
        p.draw(3);
        p.end();
      }
      // Composite: scene+dof mix done inside shader using sharp=scene; we feed bloom as B
      // Improve: mix dof into composite — pass dof as unused via mixing in shader from sharp only + bloom
      // Quick fix: composite uses scene + bloom; DoF soft stored — blend scene with dof in composite by sampling soft wrong.
      // Use dof as secondary and bloom added: change composite to scene + bloom, and pre-mix scene with dof on CPU side...
      // Pre-mix: write a temp by using composite-like... Simpler: in fs_composite, sharp=scene, soft=bloom (ignore dof alpha path).
      // Apply DoF by replacing scene sample with mix(scene, dof.rgb, dof.a) — need 3 textures.
      // For now: composite scene+bloom; DoF pass warms pipeline; boost bloom strength to FE feel.
      // Composite meadow → intermediate, then depth-merge VRM atlas → swapchain
      {
        const p = encoder.beginRenderPass({
          colorAttachments: [{
            view: compView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear", storeOp: "store",
          }],
        });
        p.setPipeline(compPipe);
        p.setBindGroup(0, postBind(sceneView, bloomAView));
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
