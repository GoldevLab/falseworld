//! Native False World — bake chunk in Rust, render heightmap + grass with wgpu 30.
//! API aligned with https://docs.rs/wgpu/latest/wgpu/ (False Earth–inspired, original).
//! AAA scaffolding: see `engine` + repo `ENGINE.md` (web playable / native fidelity).

mod engine;
mod trees;

use std::sync::Arc;

use engine::{aaa_pass_order, EngineFeatures, RenderPassKind};
use trees::{build_tree_mesh, scatter_trees, TreeInstance, TreeVertex};

use bytemuck::{Pod, Zeroable};
use falseworld_core::{generate_chunk, ChunkRequest};
use wgpu::util::DeviceExt;
use winit::{
    application::ApplicationHandler,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, OwnedDisplayHandle},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

const WGSL: &str = r#"
struct Frame {
    view_proj: mat4x4f,
    light_view_proj: mat4x4f,
    sun_dir: vec3f,
    time: f32,
    light_col: vec3f,
    amb: f32,
    eye: vec3f,
    tod: f32,
    // xy = NDC position of the sun disc (for the sky pass), z = 1.0 when the
    // sun is in front of the camera (hide the glow when it isn't), w = pad.
    sun_screen: vec3f,
    day: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;
// Single-cascade directional shadow map (see `EngineFeatures::shadows`).
// One cascade today, not full CSM yet — see ENGINE.md progress table.
@group(1) @binding(0) var shadow_tex: texture_depth_2d;
@group(1) @binding(1) var shadow_samp: sampler_comparison;

fn aces(x: vec3f) -> vec3f {
    return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn apply_fog(rgb: vec3f, world: vec3f) -> vec3f {
    let dist = length(world.xz - frame.eye.xz);
    let fog = smoothstep(35.0, 95.0, dist);
    let night = smoothstep(0.35, 0.75, abs(frame.tod - 0.5) * 2.0);
    let fog_c = mix(vec3f(0.55, 0.68, 0.82), vec3f(0.08, 0.10, 0.18), night);
    return mix(rgb, fog_c, fog * 0.55);
}
/// 1.0 = fully lit, 0.0 = fully shadowed. Points outside the shadow map's
/// coverage (past the cascade's ortho box) fall back to lit (no far shadow
/// popping at the frustum edge — acceptable for a single-cascade MVP).
fn shadow_factor(world: vec3f) -> f32 {
    let clip = frame.light_view_proj * vec4f(world, 1.0);
    if (clip.w <= 0.0) {
        return 1.0;
    }
    let ndc = clip.xyz / clip.w;
    if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
        return 1.0;
    }
    let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
    // Small bias avoids self-shadow acne on the receiving surface.
    let bias = 0.0015;
    var lit = 0.0;
    // 2x2 PCF — soft enough to hide the single cascade's texel size at MVP resolution.
    for (var oy = -1; oy <= 1; oy += 2) {
        for (var ox = -1; ox <= 1; ox += 2) {
            let o = vec2f(f32(ox), f32(oy)) * (1.0 / 2048.0);
            lit += textureSampleCompareLevel(shadow_tex, shadow_samp, uv + o, ndc.z - bias);
        }
    }
    return lit * 0.25;
}

struct Vin {
    @location(0) pos: vec3f,
    @location(1) nrm: vec3f,
};
struct Vout {
    @builtin(position) clip: vec4f,
    @location(0) world: vec3f,
    @location(1) nrm: vec3f,
};
@vertex fn vs_terrain(v: Vin) -> Vout {
    var o: Vout;
    o.clip = frame.view_proj * vec4f(v.pos, 1.0);
    o.world = v.pos;
    o.nrm = v.nrm;
    return o;
}
@fragment fn fs_terrain(i: Vout) -> @location(0) vec4f {
    let n = normalize(i.nrm);
    let L = normalize(-frame.sun_dir);
    let ndl = max(dot(n, L), 0.0) * shadow_factor(i.world);
    let hemi = 0.22 + 0.35 * max(n.y, 0.0);
    let tint = smoothstep(-0.2, 2.0, i.world.y);
    var col = mix(vec3f(0.16, 0.26, 0.12), vec3f(0.4, 0.6, 0.28), tint);
    var rgb = col * (frame.amb + hemi * 0.45 + ndl * 0.7) * frame.light_col;
    rgb = apply_fog(rgb, i.world);
    return vec4f(aces(rgb), 1.0);
}

struct Blade {
    @location(0) data0: vec4f,
    @location(1) data1: vec4f,
    @location(2) data2: vec4f,
    @location(3) data3: vec4f,
};
struct Gout {
    @builtin(position) clip: vec4f,
    @location(0) color: vec3f,
    @location(1) nrm: vec3f,
    @location(2) world: vec3f,
};
@vertex fn vs_grass(@builtin(vertex_index) vid: u32, b: Blade) -> Gout {
    let pos = b.data0.xyz;
    let width = b.data1.x;
    let height = b.data1.y;
    let bend = b.data1.z;
    let wind = b.data1.w;
    let s = b.data2.x;
    let c = b.data2.y;
    let seed = b.data2.w;
    let side = f32(vid % 2u) * 2.0 - 1.0;
    let up = f32(vid / 2u) / 3.0;
    let taper = 1.0 - up * 0.85;
    let local_x = side * width * 0.5 * taper;
    let sway = sin(frame.time * (1.4 + wind) + seed * 6.28318) * bend * up * up;
    let lx = local_x * c - sway * s;
    let lz = local_x * s + sway * c;
    let world = pos + vec3f(lx, up * height, lz);
    var o: Gout;
    o.clip = frame.view_proj * vec4f(world, 1.0);
    o.color = mix(vec3f(0.2, 0.45, 0.15), vec3f(0.6, 0.8, 0.3), up);
    o.nrm = normalize(vec3f(b.data3.x, 0.75, b.data3.y));
    o.world = world;
    return o;
}
@fragment fn fs_grass(i: Gout) -> @location(0) vec4f {
    let n = normalize(i.nrm);
    let L = normalize(-frame.sun_dir);
    // Blades skip the shadow-map lookup (thin geometry, huge instance count —
    // sampling per-blade wasn't worth the bandwidth); they still darken at
    // night via `frame.light_col`/`amb`, just not from the terrain's cast shadow.
    let ndl = max(dot(n, L), 0.12);
    let hemi = 0.2 + 0.3 * max(n.y, 0.0);
    var rgb = i.color * (frame.amb + hemi * 0.4 + ndl * 0.65) * frame.light_col;
    rgb = apply_fog(rgb, i.world);
    return vec4f(aces(rgb), 1.0);
}

// ---- Shadow depth-only prepass (RenderPassKind::ShadowCascades) ----
@vertex fn vs_shadow(v: Vin) -> @builtin(position) vec4f {
    return frame.light_view_proj * vec4f(v.pos, 1.0);
}

// ---- Sky (RenderPassKind::SkyAtmosphere) — fullscreen triangle, drawn first ----
struct SkyOut {
    @builtin(position) clip: vec4f,
    @location(0) ndc: vec2f,
};
@vertex fn vs_sky(@builtin(vertex_index) vid: u32) -> SkyOut {
    // Standard "no vertex buffer" fullscreen-triangle trick: 3 verts covering
    // the whole clip-space square, drawn at the far plane so everything else
    // (terrain/ocean/grass/trees) draws in front of it.
    var o: SkyOut;
    let x = f32((vid << 1u) & 2u) - 1.0;
    let y = f32(vid & 2u) - 1.0;
    o.clip = vec4f(x, y, 0.99999, 1.0);
    o.ndc = vec2f(x, y);
    return o;
}
@fragment fn fs_sky(i: SkyOut) -> @location(0) vec4f {
    let horizon = mix(vec3f(0.06, 0.07, 0.12), vec3f(0.62, 0.72, 0.82), frame.day);
    let zenith = mix(vec3f(0.02, 0.02, 0.06), vec3f(0.20, 0.42, 0.78), frame.day);
    var col = mix(horizon, zenith, smoothstep(-0.15, 0.75, i.ndc.y));
    let d = length(i.ndc - frame.sun_screen.xy);
    let glow = smoothstep(0.30, 0.0, d) * step(0.5, frame.sun_screen.z);
    let disc = smoothstep(0.045, 0.03, d) * step(0.5, frame.sun_screen.z);
    col += mix(vec3f(1.0, 0.55, 0.22), vec3f(1.0, 0.96, 0.85), frame.day) * glow * 0.8;
    col += vec3f(1.0, 0.97, 0.9) * disc;
    return vec4f(aces(col), 1.0);
}

// ---- Ocean (RenderPassKind::Ocean) — animated flat shelf, reuses the Vin/Vout terrain layout ----
@vertex fn vs_ocean(v: Vin) -> Vout {
    var o: Vout;
    var p = v.pos;
    let w1 = sin((p.x * 0.35 + p.z * 0.22) + frame.time * 0.9) * 0.06;
    let w2 = sin((p.x * 0.9 - p.z * 0.6) + frame.time * 1.7) * 0.025;
    p.y += w1 + w2;
    // Analytic slope of the two sine waves gives a cheap, wave-synced normal.
    let dx = cos((p.x * 0.35 + p.z * 0.22) + frame.time * 0.9) * 0.35 * 0.06
        + cos((p.x * 0.9 - p.z * 0.6) + frame.time * 1.7) * 0.9 * 0.025;
    let dz = cos((p.x * 0.35 + p.z * 0.22) + frame.time * 0.9) * 0.22 * 0.06
        - cos((p.x * 0.9 - p.z * 0.6) + frame.time * 1.7) * 0.6 * 0.025;
    o.clip = frame.view_proj * vec4f(p, 1.0);
    o.world = p;
    o.nrm = normalize(vec3f(-dx, 1.0, -dz));
    return o;
}
@fragment fn fs_ocean(i: Vout) -> @location(0) vec4f {
    let n = normalize(i.nrm);
    let V = normalize(frame.eye - i.world);
    let L = normalize(-frame.sun_dir);
    let ndl = max(dot(n, L), 0.0);
    let h = normalize(L + V);
    let spec = pow(max(dot(n, h), 0.0), 60.0) * (0.5 + 0.5 * frame.day);
    let fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);
    let deep = vec3f(0.02, 0.09, 0.14);
    let shallow = vec3f(0.05, 0.28, 0.32);
    var rgb = mix(deep, shallow, fres * 0.6) * (frame.amb + ndl * 0.6) * frame.light_col;
    rgb += vec3f(1.0) * spec;
    rgb = apply_fog(rgb, i.world);
    return vec4f(aces(rgb), 0.88);
}

// ---- Trees (RenderPassKind::Trees) — instanced low-poly meshes, see `trees.rs` ----
struct TVin {
    @location(0) pos: vec3f,
    @location(1) nrm: vec3f,
    @location(2) color: vec3f,
    @location(3) i_pos_scale: vec4f,
    @location(4) i_rot_tint: vec4f,
};
struct TVout {
    @builtin(position) clip: vec4f,
    @location(0) world: vec3f,
    @location(1) nrm: vec3f,
    @location(2) color: vec3f,
};
@vertex fn vs_trees(v: TVin) -> TVout {
    let s = v.i_rot_tint.x;
    let c = v.i_rot_tint.y;
    let scale = v.i_pos_scale.w;
    let local = vec3f(
        (v.pos.x * c - v.pos.z * s) * scale,
        v.pos.y * scale,
        (v.pos.x * s + v.pos.z * c) * scale,
    );
    let world = v.i_pos_scale.xyz + local;
    var o: TVout;
    o.clip = frame.view_proj * vec4f(world, 1.0);
    o.world = world;
    o.nrm = normalize(vec3f(v.nrm.x * c - v.nrm.z * s, v.nrm.y, v.nrm.x * s + v.nrm.z * c));
    // Subtle per-tree canopy tint variation so instanced clones don't look identical.
    let tint = v.i_rot_tint.z;
    o.color = mix(v.color, v.color * vec3f(0.85, 1.08, 0.9), tint);
    return o;
}
@fragment fn fs_trees(i: TVout) -> @location(0) vec4f {
    let n = normalize(i.nrm);
    let L = normalize(-frame.sun_dir);
    let ndl = max(dot(n, L), 0.0) * shadow_factor(i.world);
    let hemi = 0.2 + 0.3 * max(n.y, 0.0);
    var rgb = i.color * (frame.amb + hemi * 0.4 + ndl * 0.7) * frame.light_col;
    rgb = apply_fog(rgb, i.world);
    return vec4f(aces(rgb), 1.0);
}
"#;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Vertex {
    pos: [f32; 3],
    nrm: [f32; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct FrameUniform {
    view_proj: [[f32; 4]; 4],
    light_view_proj: [[f32; 4]; 4],
    sun_dir: [f32; 3],
    time: f32,
    light_col: [f32; 3],
    amb: f32,
    eye: [f32; 3],
    tod: f32,
    sun_screen: [f32; 3],
    day: f32,
}

fn look_at(eye: [f32; 3], target: [f32; 3], up: [f32; 3]) -> [[f32; 4]; 4] {
    let mut z = [
        eye[0] - target[0],
        eye[1] - target[1],
        eye[2] - target[2],
    ];
    let zl = (z[0] * z[0] + z[1] * z[1] + z[2] * z[2]).sqrt().max(1e-6);
    z = [z[0] / zl, z[1] / zl, z[2] / zl];
    let mut x = [
        up[1] * z[2] - up[2] * z[1],
        up[2] * z[0] - up[0] * z[2],
        up[0] * z[1] - up[1] * z[0],
    ];
    let xl = (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]).sqrt().max(1e-6);
    x = [x[0] / xl, x[1] / xl, x[2] / xl];
    let y = [
        z[1] * x[2] - z[2] * x[1],
        z[2] * x[0] - z[0] * x[2],
        z[0] * x[1] - z[1] * x[0],
    ];
    [
        [x[0], y[0], z[0], 0.0],
        [x[1], y[1], z[1], 0.0],
        [x[2], y[2], z[2], 0.0],
        [
            -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
            -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
            -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
            1.0,
        ],
    ]
}

fn perspective(fovy: f32, aspect: f32, near: f32, far: f32) -> [[f32; 4]; 4] {
    let f = 1.0 / (fovy * 0.5).tan();
    [
        [f / aspect, 0.0, 0.0, 0.0],
        [0.0, f, 0.0, 0.0],
        [0.0, 0.0, far / (near - far), -1.0],
        [0.0, 0.0, (far * near) / (near - far), 0.0],
    ]
}

fn mul4(a: [[f32; 4]; 4], b: [[f32; 4]; 4]) -> [[f32; 4]; 4] {
    let mut o = [[0.0f32; 4]; 4];
    for i in 0..4 {
        for j in 0..4 {
            o[i][j] = a[0][j] * b[i][0] + a[1][j] * b[i][1] + a[2][j] * b[i][2] + a[3][j] * b[i][3];
        }
    }
    o
}

fn build_mesh(chunk: &falseworld_core::SurfaceChunk) -> (Vec<Vertex>, Vec<u32>) {
    let res = chunk.height_res as usize;
    let mut verts = Vec::with_capacity(res * res);
    for z in 0..res {
        for x in 0..res {
            let u = x as f32 / (res - 1) as f32;
            let v = z as f32 / (res - 1) as f32;
            let wx = chunk.origin_x + (u - 0.5) * chunk.area;
            let wz = chunk.origin_z + (v - 0.5) * chunk.area;
            let wy = chunk.heights[z * res + x];
            let step = chunk.area / (res - 1) as f32;
            let hx0 = falseworld_core::sample_height_bilinear(chunk, wx - step, wz);
            let hx1 = falseworld_core::sample_height_bilinear(chunk, wx + step, wz);
            let hz0 = falseworld_core::sample_height_bilinear(chunk, wx, wz - step);
            let hz1 = falseworld_core::sample_height_bilinear(chunk, wx, wz + step);
            let mut nx = hx0 - hx1;
            let mut ny = 2.0 * step;
            let mut nz = hz0 - hz1;
            let nl = (nx * nx + ny * ny + nz * nz).sqrt().max(1e-6);
            nx /= nl;
            ny /= nl;
            nz /= nl;
            verts.push(Vertex {
                pos: [wx, wy, wz],
                nrm: [nx, ny, nz],
            });
        }
    }
    let mut idx = Vec::with_capacity((res - 1) * (res - 1) * 6);
    for z in 0..res - 1 {
        for x in 0..res - 1 {
            let a = (z * res + x) as u32;
            let b = a + 1;
            let c = a + res as u32;
            let d = c + 1;
            idx.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    (verts, idx)
}

/// Sea level in world Y — mirrors the web/`terrain.rs` convention (`SEA_Y`
/// comment in `crates/falseworld-core/src/terrain.rs`); not re-exported from
/// `falseworld-core` today, so the constant is duplicated here on purpose
/// rather than reaching into a private module (see `fase3-shared-noise`
/// follow-up in `ROADMAP.md` about avoiding this kind of Rust/WGSL drift).
const SEA_LEVEL_Y: f32 = -0.55;

/// Flat grid plane centered at the origin, displaced by simple sine waves in
/// `vs_ocean` (see `WGSL`). Reuses the terrain `Vertex` layout (pos + nrm)
/// so both pipelines share one vertex buffer format.
fn build_ocean_mesh(size: f32, segs: u32) -> (Vec<Vertex>, Vec<u32>) {
    let segs = segs.max(1);
    let res = segs + 1;
    let mut verts = Vec::with_capacity((res * res) as usize);
    for z in 0..res {
        for x in 0..res {
            let u = x as f32 / segs as f32 - 0.5;
            let v = z as f32 / segs as f32 - 0.5;
            verts.push(Vertex {
                pos: [u * size, SEA_LEVEL_Y, v * size],
                nrm: [0.0, 1.0, 0.0],
            });
        }
    }
    let mut idx = Vec::with_capacity((segs * segs * 6) as usize);
    for z in 0..segs {
        for x in 0..segs {
            let a = z * res + x;
            let b = a + 1;
            let c = a + res;
            let d = c + 1;
            idx.extend_from_slice(&[a, c, b, b, c, d]);
        }
    }
    (verts, idx)
}

/// Light-space orthographic view-projection for the single shadow cascade,
/// framed around `focus` (the camera's look-at point) with a box wide/deep
/// enough to cover the visible terrain chunk.
fn light_view_proj(sun_dir: [f32; 3], focus: [f32; 3], half_extent: f32) -> [[f32; 4]; 4] {
    let len = (sun_dir[0] * sun_dir[0] + sun_dir[1] * sun_dir[1] + sun_dir[2] * sun_dir[2])
        .sqrt()
        .max(1e-6);
    let dir = [sun_dir[0] / len, sun_dir[1] / len, sun_dir[2] / len];
    let eye = [
        focus[0] - dir[0] * half_extent * 2.0,
        focus[1] - dir[1] * half_extent * 2.0,
        focus[2] - dir[2] * half_extent * 2.0,
    ];
    // Sun direction is nearly vertical near noon — fall back to a
    // non-parallel up vector so `look_at`'s cross product doesn't degenerate.
    let up = if dir[1].abs() > 0.98 {
        [0.0, 0.0, 1.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let view = look_at(eye, focus, up);
    let proj = ortho(-half_extent, half_extent, -half_extent, half_extent, 0.1, half_extent * 4.0);
    mul4(proj, view)
}

fn ortho(l: f32, r: f32, b: f32, t: f32, near: f32, far: f32) -> [[f32; 4]; 4] {
    [
        [2.0 / (r - l), 0.0, 0.0, 0.0],
        [0.0, 2.0 / (t - b), 0.0, 0.0],
        [0.0, 0.0, 1.0 / (near - far), 0.0],
        [
            -(r + l) / (r - l),
            -(t + b) / (t - b),
            near / (near - far),
            1.0,
        ],
    ]
}

fn create_depth(device: &wgpu::Device, w: u32, h: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("depth"),
        size: wgpu::Extent3d {
            width: w.max(1),
            height: h.max(1),
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Depth24Plus,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    })
}

struct GpuState {
    instance: wgpu::Instance,
    window: Arc<Window>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    depth: wgpu::Texture,
    features: EngineFeatures,

    bind_group: wgpu::BindGroup,
    shadow_bind_group: wgpu::BindGroup,
    frame_buf: wgpu::Buffer,

    terrain_pipe: wgpu::RenderPipeline,
    terrain_vb: wgpu::Buffer,
    terrain_ib: wgpu::Buffer,
    terrain_count: u32,

    grass_pipe: wgpu::RenderPipeline,
    grass_vb: wgpu::Buffer,
    grass_count: u32,

    sky_pipe: wgpu::RenderPipeline,

    ocean_pipe: wgpu::RenderPipeline,
    ocean_vb: wgpu::Buffer,
    ocean_ib: wgpu::Buffer,
    ocean_count: u32,

    tree_pipe: wgpu::RenderPipeline,
    tree_vb: wgpu::Buffer,
    tree_ib: wgpu::Buffer,
    tree_index_count: u32,
    tree_instances: wgpu::Buffer,
    tree_instance_count: u32,

    shadow_pipe: wgpu::RenderPipeline,
    shadow_view: wgpu::TextureView,

    t0: std::time::Instant,
}

impl GpuState {
    async fn new(display: OwnedDisplayHandle, window: Arc<Window>, features: EngineFeatures) -> Self {
        let size = window.inner_size();
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_with_display_handle(
            Box::new(display),
        ));
        let surface = instance.create_surface(window.clone()).expect("surface");
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
                apply_limit_buckets: false,
            })
            .await
            .expect("adapter");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .expect("device");

        let caps = surface.get_capabilities(&adapter);
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| f.is_srgb())
            .unwrap_or(caps.formats[0]);
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            color_space: wgpu::SurfaceColorSpace::Auto,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::AutoVsync,
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let chunk = generate_chunk(
            &ChunkRequest {
                blades_per_axis: 96,
                height_res: 96,
                area: 48.0,
                ..Default::default()
            },
            &|_| {},
        );
        log::info!(
            "chunk ready: {} blades, height_res={}",
            chunk.blades.len(),
            chunk.height_res
        );
        let (verts, indices) = build_mesh(&chunk);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("falseworld"),
            source: wgpu::ShaderSource::Wgsl(WGSL.into()),
        });
        let frame_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("frame"),
            size: std::mem::size_of::<FrameUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        // group(1): shadow map texture + comparison sampler — only pipelines
        // that call `shadow_factor()` (terrain, trees) use `pl_lit`.
        let shadow_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("shadow bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                    count: None,
                },
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&bgl)],
            immediate_size: 0,
        });
        let pl_lit = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("lit (frame + shadow)"),
            bind_group_layouts: &[Some(&bgl), Some(&shadow_bgl)],
            immediate_size: 0,
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: frame_buf.as_entire_binding(),
            }],
        });

        const SHADOW_SIZE: u32 = 2048;
        let shadow_tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("shadow map"),
            size: wgpu::Extent3d {
                width: SHADOW_SIZE,
                height: SHADOW_SIZE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Depth32Float,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let shadow_view = shadow_tex.create_view(&wgpu::TextureViewDescriptor::default());
        let shadow_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("shadow sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            compare: Some(wgpu::CompareFunction::LessEqual),
            ..Default::default()
        });
        let shadow_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("shadow bind group"),
            layout: &shadow_bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&shadow_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&shadow_sampler),
                },
            ],
        });
        let shadow_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("shadow"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_shadow"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                })],
            },
            fragment: None,
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Less),
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState {
                    // A little slope-scaled bias here (on top of the shader's
                    // fixed bias) helps hide acne on steep terrain faces.
                    constant: 2,
                    slope_scale: 2.0,
                    clamp: 0.0,
                },
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let depth_state = wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth24Plus,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        };

        let terrain_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("terrain"),
            layout: Some(&pl_lit),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_terrain"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_terrain"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(depth_state.clone()),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let grass_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("grass"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_grass"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: 64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &wgpu::vertex_attr_array![
                        0 => Float32x4,
                        1 => Float32x4,
                        2 => Float32x4,
                        3 => Float32x4
                    ],
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_grass"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleStrip,
                ..Default::default()
            },
            depth_stencil: Some(depth_state.clone()),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        // Fullscreen triangle, no vertex buffer, no depth test — always draws
        // behind everything else (see `vs_sky`'s far-plane clip.z).
        let sky_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("sky"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_sky"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_sky"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(),
            // The sky pass shares a render pass with the main depth
            // attachment (so the following Terrain/Ocean/... passes can
            // `Load` it), so the pipeline needs a *compatible* depth-stencil
            // format even though sky never tests or writes depth.
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth24Plus,
                depth_write_enabled: Some(false),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: wgpu::StencilState::default(),
                bias: wgpu::DepthBiasState::default(),
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let ocean_blend = wgpu::ColorTargetState {
            format,
            blend: Some(wgpu::BlendState::ALPHA_BLENDING),
            write_mask: wgpu::ColorWrites::ALL,
        };
        let ocean_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("ocean"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_ocean"),
                compilation_options: Default::default(),
                buffers: &[Some(wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x3],
                })],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_ocean"),
                compilation_options: Default::default(),
                targets: &[Some(ocean_blend)],
            }),
            primitive: wgpu::PrimitiveState::default(),
            // Depth-tested but not written: lets multiple overlapping ocean
            // fragments (there aren't any here, one flat sheet) blend, and —
            // more importantly — keeps the water from occluding itself when
            // the far side of the sheet is behind the near side from camera.
            depth_stencil: Some(wgpu::DepthStencilState {
                depth_write_enabled: Some(false),
                ..depth_state.clone()
            }),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let tree_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("trees"),
            layout: Some(&pl_lit),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_trees"),
                compilation_options: Default::default(),
                buffers: &[
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<TreeVertex>() as u64,
                        step_mode: wgpu::VertexStepMode::Vertex,
                        attributes: &wgpu::vertex_attr_array![
                            0 => Float32x3, 1 => Float32x3, 2 => Float32x3
                        ],
                    }),
                    Some(wgpu::VertexBufferLayout {
                        array_stride: std::mem::size_of::<TreeInstance>() as u64,
                        step_mode: wgpu::VertexStepMode::Instance,
                        attributes: &wgpu::vertex_attr_array![3 => Float32x4, 4 => Float32x4],
                    }),
                ],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_trees"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: Some(depth_state),
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let terrain_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("terrain vb"),
            contents: bytemuck::cast_slice(&verts),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let terrain_ib = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("terrain ib"),
            contents: bytemuck::cast_slice(&indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let grass_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("grass"),
            contents: bytemuck::cast_slice(&chunk.blades),
            usage: wgpu::BufferUsages::VERTEX,
        });

        // Ocean sheet — a few chunk-widths across so it reaches the horizon
        // at the preview camera's distance without needing to follow the
        // player (there's no player yet in this native stress-test binary).
        let (ocean_verts, ocean_indices) = build_ocean_mesh(chunk.area * 3.0, 32);
        let ocean_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("ocean vb"),
            contents: bytemuck::cast_slice(&ocean_verts),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let ocean_ib = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("ocean ib"),
            contents: bytemuck::cast_slice(&ocean_indices),
            usage: wgpu::BufferUsages::INDEX,
        });

        let (tree_verts, tree_indices) = build_tree_mesh(7);
        let tree_vb = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("tree vb"),
            contents: bytemuck::cast_slice(&tree_verts),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let tree_ib = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("tree ib"),
            contents: bytemuck::cast_slice(&tree_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        let tree_placements = scatter_trees(&chunk, chunk.seed ^ 0x7EE5, 220);
        log::info!("trees placed: {}", tree_placements.len());
        // wgpu forbids zero-size buffers — fall back to a single dummy
        // instance (scale 0 via pos_scale.w) so a treeless chunk (e.g. all
        // desert) doesn't panic at buffer creation; `tree_instance_count`
        // still reflects the real (zero) count for the draw call.
        let tree_instance_bytes: Vec<TreeInstance> = if tree_placements.is_empty() {
            vec![TreeInstance {
                pos_scale: [0.0, 0.0, 0.0, 0.0],
                rot_tint: [0.0, 1.0, 0.0, 0.0],
            }]
        } else {
            tree_placements.clone()
        };
        let tree_instances = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("tree instances"),
            contents: bytemuck::cast_slice(&tree_instance_bytes),
            usage: wgpu::BufferUsages::VERTEX,
        });

        let depth = create_depth(&device, config.width, config.height);

        // Prime the shadow map to "no occluder" (max depth) once, so that if
        // `EngineFeatures::shadows` is ever off, `shadow_factor()` in the
        // shared WGSL (which samples it unconditionally) falls back to fully
        // lit instead of comparing against undefined texture contents.
        {
            let mut clear_encoder =
                device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
            clear_encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("shadow map prime"),
                color_attachments: &[],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &shadow_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(1.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            queue.submit(std::iter::once(clear_encoder.finish()));
        }

        Self {
            instance,
            window,
            device,
            queue,
            surface,
            config,
            depth,
            features,
            bind_group,
            shadow_bind_group,
            frame_buf,
            terrain_pipe,
            terrain_vb,
            terrain_ib,
            terrain_count: indices.len() as u32,
            grass_pipe,
            grass_vb,
            grass_count: chunk.blades.len() as u32,
            sky_pipe,
            ocean_pipe,
            ocean_vb,
            ocean_ib,
            ocean_count: ocean_indices.len() as u32,
            tree_pipe,
            tree_vb,
            tree_ib,
            tree_index_count: tree_indices.len() as u32,
            tree_instances,
            tree_instance_count: tree_placements.len() as u32,
            shadow_pipe,
            shadow_view,
            t0: std::time::Instant::now(),
        }
    }

    fn resize(&mut self, size: winit::dpi::PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        self.depth = create_depth(&self.device, size.width, size.height);
    }

    fn render(&mut self) {
        let surface_texture = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) => t,
            wgpu::CurrentSurfaceTexture::Suboptimal(t) => {
                drop(t);
                self.surface.configure(&self.device, &self.config);
                return;
            }
            wgpu::CurrentSurfaceTexture::Occluded | wgpu::CurrentSurfaceTexture::Timeout => {
                return;
            }
            wgpu::CurrentSurfaceTexture::Outdated => {
                self.surface.configure(&self.device, &self.config);
                return;
            }
            wgpu::CurrentSurfaceTexture::Lost => {
                self.surface = self
                    .instance
                    .create_surface(self.window.clone())
                    .expect("recreate surface");
                self.surface.configure(&self.device, &self.config);
                return;
            }
            wgpu::CurrentSurfaceTexture::Validation => {
                log::error!("surface validation error");
                return;
            }
        };

        let view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let depth_view = self.depth.create_view(&wgpu::TextureViewDescriptor::default());

        let aspect = self.config.width as f32 / self.config.height.max(1) as f32;
        let proj = perspective(55f32.to_radians(), aspect, 0.1, 200.0);
        let eye = [18.0, 14.0, 22.0];
        let view_m = look_at(eye, [0.0, 0.5, 0.0], [0.0, 1.0, 0.0]);
        let vp = mul4(proj, view_m);
        let t = self.t0.elapsed().as_secs_f32();
        // ~30 min day cycle (parity with web celestial)
        let tod = (t / 1800.0).fract();
        let elev = (tod * std::f32::consts::TAU - std::f32::consts::FRAC_PI_2).sin();
        let az = tod * std::f32::consts::TAU;
        let sun_dir = [
            az.cos() * elev.abs().max(0.05),
            -elev.max(0.05),
            az.sin() * elev.abs().max(0.05),
        ];
        let day = ((elev + 0.15) / 1.15).clamp(0.0, 1.0);
        let light_col = [
            0.55 + 0.45 * day,
            0.48 + 0.42 * day,
            0.42 + 0.48 * day,
        ];
        let focus = [0.0, 0.5, 0.0];
        let lvp = light_view_proj(sun_dir, focus, 55.0);
        // Project the sun (opposite `sun_dir` from the camera) through the
        // *camera's* view_proj to get where its disc/glow should sit on
        // screen for `fs_sky` — a cheap stand-in for a full inverse-VP ray.
        let sun_world = [
            eye[0] - sun_dir[0] * 500.0,
            eye[1] - sun_dir[1] * 500.0,
            eye[2] - sun_dir[2] * 500.0,
        ];
        let sun_clip = [
            vp[0][0] * sun_world[0] + vp[1][0] * sun_world[1] + vp[2][0] * sun_world[2] + vp[3][0],
            vp[0][1] * sun_world[0] + vp[1][1] * sun_world[1] + vp[2][1] * sun_world[2] + vp[3][1],
            vp[0][3] * sun_world[0] + vp[1][3] * sun_world[1] + vp[2][3] * sun_world[2] + vp[3][3],
        ];
        let sun_screen = if sun_clip[2] > 0.0 {
            [sun_clip[0] / sun_clip[2], sun_clip[1] / sun_clip[2], 1.0]
        } else {
            [0.0, 0.0, 0.0]
        };
        let ubo = FrameUniform {
            view_proj: vp,
            light_view_proj: lvp,
            sun_dir,
            time: t,
            light_col,
            amb: 0.18 + 0.22 * day,
            eye,
            tod,
            sun_screen,
            day,
        };
        self.queue
            .write_buffer(&self.frame_buf, 0, bytemuck::bytes_of(&ubo));

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

        // Real pass scheduler: `engine::aaa_pass_order` decides *which*
        // passes run (e.g. shadows only when `EngineFeatures::shadows` is
        // on); this match decides *how* — the piece `main.rs` used to
        // compute the order and then never use it.
        for kind in aaa_pass_order(&self.features) {
            match kind {
                RenderPassKind::ShadowCascades => {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("shadow cascade"),
                        color_attachments: &[],
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &self.shadow_view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Clear(1.0),
                                store: wgpu::StoreOp::Store,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    });
                    pass.set_bind_group(0, &self.bind_group, &[]);
                    pass.set_pipeline(&self.shadow_pipe);
                    pass.set_vertex_buffer(0, self.terrain_vb.slice(..));
                    pass.set_index_buffer(self.terrain_ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..self.terrain_count, 0, 0..1);
                }
                RenderPassKind::SkyAtmosphere => {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("sky"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            resolve_target: None,
                            ops: wgpu::Operations {
                                // Cleared once here; every pixel gets
                                // overdrawn by the sky triangle right after,
                                // so the clear color itself is irrelevant.
                                load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                                store: wgpu::StoreOp::Store,
                            },
                            depth_slice: None,
                        })],
                        depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                            view: &depth_view,
                            depth_ops: Some(wgpu::Operations {
                                load: wgpu::LoadOp::Clear(1.0),
                                store: wgpu::StoreOp::Store,
                            }),
                            stencil_ops: None,
                        }),
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    });
                    pass.set_bind_group(0, &self.bind_group, &[]);
                    pass.set_pipeline(&self.sky_pipe);
                    pass.draw(0..3, 0..1);
                }
                RenderPassKind::Terrain => {
                    let mut pass = self.main_pass(&mut encoder, &view, &depth_view);
                    pass.set_bind_group(0, &self.bind_group, &[]);
                    pass.set_bind_group(1, &self.shadow_bind_group, &[]);
                    pass.set_pipeline(&self.terrain_pipe);
                    pass.set_vertex_buffer(0, self.terrain_vb.slice(..));
                    pass.set_index_buffer(self.terrain_ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..self.terrain_count, 0, 0..1);
                }
                RenderPassKind::Ocean => {
                    let mut pass = self.main_pass(&mut encoder, &view, &depth_view);
                    pass.set_bind_group(0, &self.bind_group, &[]);
                    pass.set_pipeline(&self.ocean_pipe);
                    pass.set_vertex_buffer(0, self.ocean_vb.slice(..));
                    pass.set_index_buffer(self.ocean_ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..self.ocean_count, 0, 0..1);
                }
                RenderPassKind::Grass => {
                    let mut pass = self.main_pass(&mut encoder, &view, &depth_view);
                    pass.set_bind_group(0, &self.bind_group, &[]);
                    pass.set_pipeline(&self.grass_pipe);
                    pass.set_vertex_buffer(0, self.grass_vb.slice(..));
                    pass.draw(0..8, 0..self.grass_count);
                }
                RenderPassKind::Trees => {
                    if self.tree_instance_count == 0 {
                        continue;
                    }
                    let mut pass = self.main_pass(&mut encoder, &view, &depth_view);
                    pass.set_bind_group(0, &self.bind_group, &[]);
                    pass.set_bind_group(1, &self.shadow_bind_group, &[]);
                    pass.set_pipeline(&self.tree_pipe);
                    pass.set_vertex_buffer(0, self.tree_vb.slice(..));
                    pass.set_vertex_buffer(1, self.tree_instances.slice(..));
                    pass.set_index_buffer(self.tree_ib.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..self.tree_index_count, 0, 0..self.tree_instance_count);
                }
                RenderPassKind::PostTonemap => {
                    // Each fragment shader already applies `aces()` inline
                    // (see `WGSL`) — there's no separate offscreen HDR target
                    // to resolve yet (`EngineFeatures::hdr_surface` is still
                    // off), so this step is a no-op placeholder in the real
                    // scheduler until that lands.
                }
            }
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        self.window.pre_present_notify();
        self.queue.present(surface_texture);
    }

    /// Opens (or continues) the main color+depth pass, loading rather than
    /// clearing both attachments so `Terrain`/`Ocean`/`Grass`/`Trees` layer
    /// on top of whatever `SkyAtmosphere` already drew this frame.
    fn main_pass<'e>(
        &self,
        encoder: &'e mut wgpu::CommandEncoder,
        view: &'e wgpu::TextureView,
        depth_view: &'e wgpu::TextureView,
    ) -> wgpu::RenderPass<'e> {
        encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("main"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
                depth_slice: None,
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        })
    }
}

struct App {
    state: Option<GpuState>,
    features: EngineFeatures,
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        let window = Arc::new(
            event_loop
                .create_window(
                    Window::default_attributes().with_title("False World · wgpu"),
                )
                .expect("window"),
        );
        let state = pollster::block_on(GpuState::new(
            event_loop.owned_display_handle(),
            window.clone(),
            self.features.clone(),
        ));
        self.state = Some(state);
        window.request_redraw();
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(state) = self.state.as_mut() else {
            return;
        };
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::KeyboardInput { event, .. }
                if event.state.is_pressed()
                    && matches!(
                        event.physical_key,
                        PhysicalKey::Code(KeyCode::Escape)
                    ) =>
            {
                event_loop.exit();
            }
            WindowEvent::Resized(size) => state.resize(size),
            WindowEvent::RedrawRequested => {
                state.render();
                state.window.request_redraw();
            }
            _ => {}
        }
    }
}

fn main() {
    env_logger::init();
    // `--aaa` opts into `EngineFeatures::aaa_target()` (HDR surface, same
    // shadow/celestial set as the default preview today — mesh_shaders/
    // ray_query still wait on BLAS-ready tree geometry). Plain run keeps the
    // safe `preview()` defaults.
    let features = if std::env::args().any(|a| a == "--aaa") {
        EngineFeatures::aaa_target()
    } else {
        EngineFeatures::preview()
    };
    log::info!(
        "falseworld-wgpu track: shadows={} celestial={} mesh={} ray={} hdr={} passes={:?}",
        features.shadows,
        features.celestial,
        features.mesh_shaders,
        features.ray_query,
        features.hdr_surface,
        aaa_pass_order(&features)
    );
    if std::env::args().any(|a| a == "--bake-only") {
        let chunk = generate_chunk(
            &ChunkRequest {
                blades_per_axis: 128,
                height_res: 128,
                ..Default::default()
            },
            &|p| {
                if p % 20 == 0 {
                    eprintln!("bake {p}%");
                }
            },
        );
        let bytes = falseworld_core::encode_chunk(&chunk).unwrap();
        println!(
            "ok blades={} heights={} fwch_bytes={}",
            chunk.blades.len(),
            chunk.heights.len(),
            bytes.len()
        );
        return;
    }

    let event_loop = EventLoop::new().unwrap();
    event_loop.set_control_flow(ControlFlow::Poll);
    let mut app = App {
        state: None,
        features,
    };
    event_loop.run_app(&mut app).unwrap();
}
