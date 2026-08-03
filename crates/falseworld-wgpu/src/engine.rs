//! AAA native engine scaffolding — feature gates and render pass plan.
//!
//! Experimental wgpu extensions (mesh / ray query) stay behind flags until
//! we have real triangle meshes. Web client remains the playable path.

/// Optional native capabilities (request at device creation when ready).
#[derive(Clone, Debug, Default)]
pub struct EngineFeatures {
    /// Cascaded shadow maps (parity with web v85+).
    pub shadows: bool,
    /// Day/night celestial lighting (parity with web v84+).
    pub celestial: bool,
    /// wgpu `EXPERIMENTAL_MESH_SHADER` — meshlet trees (native only).
    pub mesh_shaders: bool,
    /// wgpu `EXPERIMENTAL_RAY_QUERY` — AO / soft contact (needs mesh BLAS).
    pub ray_query: bool,
    /// HDR surface + custom tonemap.
    pub hdr_surface: bool,
}

impl EngineFeatures {
    /// Safe defaults for the current stress-test binary. `shadows` is on by
    /// default now that `main.rs` renders a real (single-cascade) shadow
    /// map — see `ENGINE.md` progress table.
    pub fn preview() -> Self {
        Self {
            shadows: true,
            celestial: true,
            mesh_shaders: false,
            ray_query: false,
            hdr_surface: false,
        }
    }

    /// Target fidelity for the AAA native path (enable as modules land).
    pub fn aaa_target() -> Self {
        Self {
            shadows: true,
            celestial: true,
            mesh_shaders: false, // on after tree meshes get BLAS-friendly LOD
            ray_query: false,    // on after BLAS trees
            hdr_surface: true,
        }
    }
}

/// Ordered GPU work for a frame (native renderer grows into this).
#[derive(Clone, Copy, Debug)]
pub enum RenderPassKind {
    ShadowCascades,
    SkyAtmosphere,
    Terrain,
    Ocean,
    Grass,
    Trees,
    PostTonemap,
}

/// Planned pass list for AAA native (documentation + future scheduler).
pub fn aaa_pass_order(features: &EngineFeatures) -> Vec<RenderPassKind> {
    let mut passes = Vec::new();
    if features.shadows {
        passes.push(RenderPassKind::ShadowCascades);
    }
    passes.push(RenderPassKind::SkyAtmosphere);
    passes.push(RenderPassKind::Terrain);
    passes.push(RenderPassKind::Ocean);
    passes.push(RenderPassKind::Grass);
    passes.push(RenderPassKind::Trees);
    passes.push(RenderPassKind::PostTonemap);
    passes
}
