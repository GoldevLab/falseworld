
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
  taa_blend : f32,
  _pad0 : f32,
  _pad1 : f32,
  _pad2 : f32,
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
  // HQ edge AA — all samples in uniform control flow (WebGPU requirement)
  let dims = vec2f(textureDimensions(post_tex));
  let texel = 1.0 / dims;
  let rgbM = textureSample(post_tex, post_samp, uv).rgb;
  let luma = vec3f(0.299, 0.587, 0.114);
  let lM = dot(rgbM, luma);
  let lN = dot(textureSample(post_tex, post_samp, uv + vec2f(0.0, -texel.y)).rgb, luma);
  let lS = dot(textureSample(post_tex, post_samp, uv + vec2f(0.0, texel.y)).rgb, luma);
  let lE = dot(textureSample(post_tex, post_samp, uv + vec2f(texel.x, 0.0)).rgb, luma);
  let lW = dot(textureSample(post_tex, post_samp, uv + vec2f(-texel.x, 0.0)).rgb, luma);
  let lNE = dot(textureSample(post_tex, post_samp, uv + vec2f(texel.x, -texel.y)).rgb, luma);
  let lNW = dot(textureSample(post_tex, post_samp, uv + vec2f(-texel.x, -texel.y)).rgb, luma);
  let lSE = dot(textureSample(post_tex, post_samp, uv + vec2f(texel.x, texel.y)).rgb, luma);
  let lSW = dot(textureSample(post_tex, post_samp, uv + vec2f(-texel.x, texel.y)).rgb, luma);
  let lMin = min(lM, min(min(lN, lS), min(lE, lW)));
  let lMax = max(lM, max(max(lN, lS), max(lE, lW)));
  let range = lMax - lMin;
  let dir = vec2f(
    -((lN + lS) - (lE + lW) + ((lNE + lNW) - (lSE + lSW)) * 0.25),
    ((lE + lW) - (lN + lS) + ((lNE + lSE) - (lNW + lSW)) * 0.25)
  );
  let dir_reduce = max((lN + lS + lE + lW) * 0.03125, 1.0 / 128.0);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dir_reduce);
  let d = clamp(dir * rcp, vec2f(-12.0), vec2f(12.0)) * texel;
  let rgbA = 0.5 * (
    textureSample(post_tex, post_samp, uv + d * (1.0 / 3.0 - 0.5)).rgb +
    textureSample(post_tex, post_samp, uv + d * (2.0 / 3.0 - 0.5)).rgb
  );
  let rgbB = rgbA * 0.5 + 0.25 * (
    textureSample(post_tex, post_samp, uv + d * -0.5).rgb +
    textureSample(post_tex, post_samp, uv + d * 0.5).rgb
  );
  let rgbC = rgbB * 0.5 + 0.25 * (
    textureSample(post_tex, post_samp, uv + d * -1.0).rgb +
    textureSample(post_tex, post_samp, uv + d * 1.0).rgb
  );
  let lB = dot(rgbB, luma);
  let lC = dot(rgbC, luma);
  let use_c = (lC >= lMin) && (lC <= lMax);
  let use_b = (lB >= lMin) && (lB <= lMax);
  let filtered = select(select(rgbA, rgbB, use_b), rgbC, use_c);
  let flat = range < max(0.0312, lMax * 0.125);
  return select(filtered, rgbM, flat);
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
  // FE-style subtle autofocus — CoC lives in soft alpha from fs_dof_blur
  let coc = clamp(soft_s.a, 0.0, 0.48);

  var sharp = textureSample(post_tex, post_samp, uv).rgb;
  // Light FXAA only on edges (avoid grain wash on meadow)
  let aa = fxaa(uv);
  let luma = vec3f(0.299, 0.587, 0.114);
  let edge = smoothstep(0.04, 0.14, abs(dot(sharp, luma) - dot(aa, luma)));
  sharp = mix(sharp, aa, edge * 0.92);

  if (post.helmet > 0.01) {
    let ca = to_c0 * 0.008 * post.helmet;
    let r = textureSample(post_tex, post_samp, uv + ca).r;
    let g = sharp.g;
    let b = textureSample(post_tex, post_samp, uv - ca).b;
    sharp = vec3f(r, g, b);
  }

  var rgb = mix(sharp, soft_s.rgb, coc) + bloom * 0.12;
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

@fragment fn fs_taa(input : PostOut) -> @location(0) vec4f {
  let uv = input.uv;
  // All textureSample calls in uniform control flow (no early-return).
  let cur = textureSample(post_tex, post_samp, uv).rgb;
  let hist = textureSample(post_tex_b, post_samp, uv).rgb;
  let dims = vec2f(textureDimensions(post_tex));
  let texel = 1.0 / dims;
  let s0 = textureSample(post_tex, post_samp, uv + vec2f(texel.x, 0.0)).rgb;
  let s1 = textureSample(post_tex, post_samp, uv + vec2f(-texel.x, 0.0)).rgb;
  let s2 = textureSample(post_tex, post_samp, uv + vec2f(0.0, texel.y)).rgb;
  let s3 = textureSample(post_tex, post_samp, uv + vec2f(0.0, -texel.y)).rgb;
  let s4 = textureSample(post_tex, post_samp, uv + vec2f(texel.x, texel.y)).rgb;
  let s5 = textureSample(post_tex, post_samp, uv + vec2f(-texel.x, texel.y)).rgb;
  let s6 = textureSample(post_tex, post_samp, uv + vec2f(texel.x, -texel.y)).rgb;
  let s7 = textureSample(post_tex, post_samp, uv + vec2f(-texel.x, -texel.y)).rgb;
  var nmin = min(cur, min(min(s0, s1), min(s2, s3)));
  nmin = min(nmin, min(min(s4, s5), min(s6, s7)));
  var nmax = max(cur, max(max(s0, s1), max(s2, s3)));
  nmax = max(nmax, max(max(s4, s5), max(s6, s7)));
  let h = clamp(hist, nmin, nmax);
  let luma = vec3f(0.299, 0.587, 0.114);
  let dl = abs(dot(cur, luma) - dot(h, luma));
  let w = select(
    0.0,
    clamp(post.taa_blend * (1.0 - smoothstep(0.02, 0.18, dl)), 0.0, 0.92),
    post.taa_blend >= 0.01
  );
  return vec4f(mix(cur, h, w), 1.0);
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
  // Strict depth: grass/props in front of the avatar must win (was eps=1.35m —
  // that painted feet over blades). Tiny bias only for z-fight vs terrain.
  let eps = max(0.025, av_z * 0.0015);
  let depth_ok = av_z < meadow_z + eps;
  // Soft edge when depths are nearly equal — still prefers closer meadow
  let soft = smoothstep(meadow_z + eps * 2.5, meadow_z - eps, av_z);
  // Remotes may paint with depthWrite=false (clear depth ~1.0)
  let remote_paint = av_dn > 0.995;
  let cover = select(
    clamp(av.a, 0.0, 1.0) * soft,
    clamp(av.a, 0.0, 1.0),
    remote_paint
  );
  let show = select(0.0, cover, av.a >= 0.02 && (depth_ok || remote_paint));
  let rgb = mix(meadow.rgb, av.rgb, show);
  return vec4f(rgb, 1.0);
}
