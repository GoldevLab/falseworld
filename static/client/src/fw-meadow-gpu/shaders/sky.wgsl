
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
  // Quintic — softer than smoothstep, less grid / square lobes
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
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
    // Rotate octaves — kills axis-aligned square tiles
    let xr = x.x * 0.8 - x.y * 0.6;
    let yr = x.x * 0.6 + x.y * 0.8;
    x = vec2f(xr, yr) * 2.07 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
fn fbm2_warp(p : vec2f) -> f32 {
  // Domain warp → billowy organic blobs instead of square cells
  let q = vec2f(fbm2(p), fbm2(p + vec2f(5.2, 1.3)));
  let r = vec2f(
    fbm2(p + 4.0 * q + vec2f(1.7, 9.2)),
    fbm2(p + 4.0 * q + vec2f(8.3, 2.8))
  );
  return fbm2(p + 4.0 * r);
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

  // Rayleigh-ish height falloff + warm horizon haze
  let elev_cl = clamp(elev, -0.15, 1.0);
  let hz = exp(-max(elev_cl, 0.0) * 3.2);
  let haze = exp(-max(elev_cl, 0.0) * 1.15) * (1.0 - exp(-max(elev_cl + 0.05, 0.0) * 8.0));
  var zenith = vec3f(0.16, 0.38, 0.82) * day
    + vec3f(0.14, 0.12, 0.32) * dusk
    + vec3f(0.012, 0.018, 0.05) * night;
  // Slight ozone / cool tint near top
  zenith = mix(zenith, vec3f(0.12, 0.28, 0.78), day * 0.22);
  var horizon = vec3f(0.72, 0.82, 0.94) * day
    + vec3f(0.98, 0.52, 0.28) * dusk
    + vec3f(0.06, 0.08, 0.16) * night;
  let sun_az = max(dot(normalize(vec3f(dir.x, 0.0, dir.z) + vec3f(1e-4)), normalize(vec3f(sun.x, 0.0, sun.z) + vec3f(1e-4))), 0.0);
  horizon = mix(horizon, vec3f(1.0, 0.62, 0.32), dusk * pow(sun_az, 2.4) * 0.78);
  horizon = mix(horizon, vec3f(0.95, 0.88, 0.72), day * pow(sun_az, 4.0) * 0.22);
  var col = mix(zenith, horizon, hz);
  // Ground bounce / aerial haze band
  col = mix(col, mix(horizon, vec3f(0.78, 0.86, 0.95), 0.35), haze * 0.35 * day);
  col = mix(col * 0.28, col, smoothstep(-0.10, 0.04, elev));

  // Soft billowy clouds
  let elev_safe = max(elev, 0.02);
  let cloud_uv = dir.xz / elev_safe * 0.38
    + vec2f(sky.time * 0.0055, sky.time * 0.0022);
  let cu = cloud_uv.x * 0.96 - cloud_uv.y * 0.28;
  let cv = cloud_uv.x * 0.28 + cloud_uv.y * 0.96;
  let cl = fbm2_warp(vec2f(cu, cv) * 1.25);
  let cl_detail = fbm2(vec2f(cu, cv) * 4.6 + vec2f(3.1, -2.4));
  let density = cl * 0.74 + cl_detail * 0.26;
  let cover = mix(0.60, 0.36, clamp(sky.cloud, 0.0, 1.0));
  let cloud_mask = smoothstep(cover - 0.26, cover + 0.32, density)
    * smoothstep(0.02, 0.28, elev)
    * (1.0 - smoothstep(0.52, 0.92, elev) * 0.4)
    * clamp(sky.cloud, 0.0, 1.0);
  var cloud_col = mix(vec3f(0.94, 0.96, 1.0), vec3f(1.0, 0.80, 0.58), dusk * 0.9);
  cloud_col = mix(cloud_col, vec3f(0.12, 0.14, 0.22), night);
  // Lit tops / cooler shadowed undersides
  let cl_lit = pow(max(dot(dir, sun), 0.0), 2.8);
  cloud_col *= mix(0.72, 1.08, smoothstep(cover - 0.1, cover + 0.4, density));
  cloud_col += sun_tint(sun_h) * cl_lit * 0.42 * (0.4 + 0.6 * density);
  cloud_col = mix(cloud_col, cloud_col * vec3f(0.78, 0.82, 0.9), (1.0 - cl_lit) * 0.28);
  col = mix(col, cloud_col, clamp(cloud_mask * (0.42 + 0.42 * day + 0.28 * dusk), 0.0, 0.9));

  let sun_ang = acos(clamp(dot(dir, sun), -1.0, 1.0));
  let sun_vis = smoothstep(-0.12, 0.02, sun_h);
  let sun_core = smoothstep(0.022, 0.006, sun_ang) * sun_vis;
  let sun_glow = exp(-sun_ang * 24.0) * sun_vis;
  let sun_halo = exp(-sun_ang * 6.5) * sun_vis;
  let mie = exp(-sun_ang * 3.2) * sun_vis; // wide Mie bloom
  let scol = sun_tint(sun_h);
  col += scol * (sun_core * 9.5 + sun_glow * 2.1 + sun_halo * 0.55 + mie * 0.28);
  // Warm god-ray-ish wash toward sun on horizon
  col += scol * vec3f(1.0, 0.85, 0.65) * pow(sun_az, 5.0) * hz * sun_vis * 0.18 * (day + dusk);

  let moon_ang = acos(clamp(dot(dir, moon), -1.0, 1.0));
  let moon_vis = smoothstep(-0.05, 0.08, moon.y) * (0.25 + night * 1.0);
  let moon_core = smoothstep(0.028, 0.012, moon_ang) * moon_vis;
  let moon_glow = exp(-moon_ang * 20.0) * moon_vis * 0.6;
  col += vec3f(0.82, 0.88, 1.0) * (moon_core * 2.0 + moon_glow);

  if (night > 0.2 && elev > 0.04) {
    let sp = dir * 175.0;
    let cell = floor(sp);
    let h = hash21(cell.xy + vec2f(cell.z * 13.0, cell.z * 7.0));
    if (h > 0.991) {
      let f = fract(sp);
      let d2 = length(f.xy - vec2f(0.5));
      let tw = 0.55 + 0.45 * sin(sky.time * (2.0 + h * 5.0) + h * 20.0);
      let bright = smoothstep(0.994, 1.0, h);
      col += vec3f(0.85, 0.9, 1.0) * smoothstep(0.08, 0.0, d2) * night * tw * (0.7 + bright * 1.4);
    }
  }

  return vec4f(clamp(col, vec3f(0.0), vec3f(16.0)), 1.0);
}
