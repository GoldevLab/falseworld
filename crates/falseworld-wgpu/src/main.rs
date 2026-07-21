//! Native False World — bake chunk in Rust, render heightmap + grass with wgpu 30.
//! API aligned with https://docs.rs/wgpu/latest/wgpu/ (False Earth–inspired, original).
//! AAA scaffolding: see `engine` + repo `ENGINE.md` (web playable / native fidelity).

mod engine;

use std::sync::Arc;

use engine::{aaa_pass_order, EngineFeatures};

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
    sun_dir: vec3f,
    time: f32,
    light_col: vec3f,
    amb: f32,
    eye: vec3f,
    tod: f32,
};
@group(0) @binding(0) var<uniform> frame: Frame;

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
    let ndl = max(dot(n, L), 0.0);
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
    let ndl = max(dot(n, L), 0.12);
    let hemi = 0.2 + 0.3 * max(n.y, 0.0);
    var rgb = i.color * (frame.amb + hemi * 0.4 + ndl * 0.65) * frame.light_col;
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
    sun_dir: [f32; 3],
    time: f32,
    light_col: [f32; 3],
    amb: f32,
    eye: [f32; 3],
    tod: f32,
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
    terrain_pipe: wgpu::RenderPipeline,
    grass_pipe: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    frame_buf: wgpu::Buffer,
    terrain_vb: wgpu::Buffer,
    terrain_ib: wgpu::Buffer,
    terrain_count: u32,
    grass_vb: wgpu::Buffer,
    grass_count: u32,
    t0: std::time::Instant,
}

impl GpuState {
    async fn new(display: OwnedDisplayHandle, window: Arc<Window>) -> Self {
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
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[Some(&bgl)],
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

        let depth_state = wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth24Plus,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Less),
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        };

        let terrain_pipe = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("terrain"),
            layout: Some(&pl),
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

        let depth = create_depth(&device, config.width, config.height);

        Self {
            instance,
            window,
            device,
            queue,
            surface,
            config,
            depth,
            terrain_pipe,
            grass_pipe,
            bind_group,
            frame_buf,
            terrain_vb,
            terrain_ib,
            terrain_count: indices.len() as u32,
            grass_vb,
            grass_count: chunk.blades.len() as u32,
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
        let ubo = FrameUniform {
            view_proj: vp,
            sun_dir,
            time: t,
            light_col,
            amb: 0.18 + 0.22 * day,
            eye,
            tod,
        };
        self.queue
            .write_buffer(&self.frame_buf, 0, bytemuck::bytes_of(&ubo));

        // Clear color tracks TOD sky
        let clear = wgpu::Color {
            r: (0.08 + 0.34 * day as f64),
            g: (0.10 + 0.52 * day as f64),
            b: (0.18 + 0.60 * day as f64),
            a: 1.0,
        };

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: None,
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(clear),
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
            pass.set_pipeline(&self.terrain_pipe);
            pass.set_vertex_buffer(0, self.terrain_vb.slice(..));
            pass.set_index_buffer(self.terrain_ib.slice(..), wgpu::IndexFormat::Uint32);
            pass.draw_indexed(0..self.terrain_count, 0, 0..1);
            pass.set_pipeline(&self.grass_pipe);
            pass.set_vertex_buffer(0, self.grass_vb.slice(..));
            pass.draw(0..8, 0..self.grass_count);
        }
        self.queue.submit(std::iter::once(encoder.finish()));
        self.window.pre_present_notify();
        self.queue.present(surface_texture);
    }
}

#[derive(Default)]
struct App {
    state: Option<GpuState>,
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
    let features = EngineFeatures::preview();
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
    let mut app = App::default();
    event_loop.run_app(&mut app).unwrap();
}
