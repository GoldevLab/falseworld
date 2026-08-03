
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
  let fe = fl_island_edge(xz);
  if (fe < 0.36) { discard; }
  let n1 = fract(sin(dot(floor(xz * 0.15), vec2f(12.9, 78.2))) * 43758.5);
  let n2 = fract(sin(dot(xz * 0.4, vec2f(41.2, 19.7))) * 24634.1);
  var col = mix(vec3f(0.30, 0.26, 0.18), vec3f(0.14, 0.16, 0.14), n1);
  col = mix(col, vec3f(0.20, 0.16, 0.12), n2 * 0.35);
  // Near-shore sand bed under clear water
  col = mix(vec3f(0.42, 0.36, 0.26), col, smoothstep(0.42, 0.72, fe));
  let c1 = sin(xz.x * 0.55 + t * 1.6) * cos(xz.y * 0.48 - t * 1.3);
  let c2 = sin(xz.x * 1.1 - xz.y * 0.9 + t * 2.2) * cos(xz.y * 1.05 + t * 1.8);
  let cau = pow(max(c1 * 0.55 + c2 * 0.45, 0.0), 2.2);
  col += vec3f(0.10, 0.22, 0.24) * cau * 0.55 * smoothstep(0.45, 0.8, fe);
  let L = normalize(-frame.sun_dir);
  let ndl = max(dot(vec3f(0.0, 1.0, 0.0), L), 0.15);
  col *= frame.light_col * (frame.amb + ndl * 0.6);
  let deep = smoothstep(200.0, 900.0, length(xz));
  col = mix(col, vec3f(0.02, 0.05, 0.08), deep * 0.7);
  return vec4f(col, 1.0);
}
