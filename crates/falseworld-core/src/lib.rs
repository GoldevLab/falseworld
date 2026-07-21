//! False World core — deterministic meadow generation for Resuma workers + wgpu.
//! Patterns inspired by https://github.com/momentchan/false-earth (credit Ming-Jyun Hung);
//! all code original.

mod biome;
mod codec;
mod grass;
mod noise;
mod pcg;
mod terrain;

pub use biome::{biome_at, coast_radius, snow_weight, Biome, CENTER_MTN_R, ISLAND_HALF};
pub use codec::{decode_chunk, encode_chunk, CONTENT_TYPE};
pub use grass::{BladePacked, GrassParams};
pub use terrain::{
    center_mountain, cordillera, rolling_hills, terrain_height, terrain_normal, TerrainParams,
};

use grass::pack_blade_field;
use serde::{Deserialize, Serialize};
use terrain::{terrain_height as th, terrain_normal as tn};

/// One surface patch around a snap origin (grid-snapping friendly).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfaceChunk {
    pub seed: u32,
    pub origin_x: f32,
    pub origin_z: f32,
    pub area: f32,
    pub terrain: TerrainParams,
    pub height_res: u32,
    pub heights: Vec<f32>,
    pub blades: Vec<BladePacked>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChunkRequest {
    pub seed: u32,
    pub origin_x: f32,
    pub origin_z: f32,
    pub area: f32,
    pub height_res: u32,
    pub blades_per_axis: u32,
    pub terrain_amp: f32,
    pub terrain_freq: f32,
}

impl Default for ChunkRequest {
    fn default() -> Self {
        Self {
            seed: 42,
            origin_x: 0.0,
            origin_z: 0.0,
            area: 64.0,
            height_res: 96,
            blades_per_axis: 128,
            terrain_amp: 1.8,
            terrain_freq: 0.04,
        }
    }
}

pub fn generate_chunk(req: &ChunkRequest, progress: &dyn Fn(u8)) -> SurfaceChunk {
    let terrain = TerrainParams {
        amplitude: req.terrain_amp,
        frequency: req.terrain_freq,
        seed: req.seed,
    };
    // Full island ≈ 2×ISLAND_HALF (~0.6 km with coastline warp); allow one-shot bake.
    let res = req.height_res.clamp(16, 512) as usize;
    let area = req.area.clamp(8.0, 2600.0);
    progress(5);

    let mut heights = vec![0.0f32; res * res];
    for z in 0..res {
        for x in 0..res {
            let u = x as f32 / (res - 1) as f32;
            let v = z as f32 / (res - 1) as f32;
            let wx = req.origin_x + (u - 0.5) * area;
            let wz = req.origin_z + (v - 0.5) * area;
            heights[z * res + x] = th(wx, wz, &terrain);
        }
        if z % 8 == 0 {
            progress(5 + ((z as u32 * 40) / res as u32) as u8);
        }
    }
    progress(50);

    // blades_per_axis == 0 → heightmap only; browser WebGPU fills ~1M blades (FE density).
    let blades = if req.blades_per_axis == 0 {
        progress(95);
        Vec::new()
    } else {
        let grass = GrassParams {
            area,
            blades_per_axis: req.blades_per_axis.clamp(8, 1024),
            seed: req.seed ^ 0xA55_A55,
        };
        pack_blade_field(req.origin_x, req.origin_z, &grass, &terrain, progress)
    };

    progress(100);
    SurfaceChunk {
        seed: req.seed,
        origin_x: req.origin_x,
        origin_z: req.origin_z,
        area,
        terrain,
        height_res: res as u32,
        heights,
        blades,
    }
}

/// Snap world position to grass grid cell (False Earth–style infinite field).
pub fn snap_origin(x: f32, z: f32, area: f32, blades_per_axis: u32) -> (f32, f32, i32, i32) {
    let spacing = area / blades_per_axis.max(1) as f32;
    let cell = spacing;
    let cx = (x / cell).floor() as i32;
    let cz = (z / cell).floor() as i32;
    (cx as f32 * cell, cz as f32 * cell, cx, cz)
}

pub fn sample_height_bilinear(chunk: &SurfaceChunk, wx: f32, wz: f32) -> f32 {
    let res = chunk.height_res as usize;
    if res < 2 || chunk.heights.len() < res * res {
        return th(wx, wz, &chunk.terrain);
    }
    let u = ((wx - chunk.origin_x) / chunk.area + 0.5).clamp(0.0, 1.0 - 1e-5);
    let v = ((wz - chunk.origin_z) / chunk.area + 0.5).clamp(0.0, 1.0 - 1e-5);
    let fx = u * (res - 1) as f32;
    let fz = v * (res - 1) as f32;
    let x0 = fx.floor() as usize;
    let z0 = fz.floor() as usize;
    let x1 = (x0 + 1).min(res - 1);
    let z1 = (z0 + 1).min(res - 1);
    let tx = fx - x0 as f32;
    let tz = fz - z0 as f32;
    let h00 = chunk.heights[z0 * res + x0];
    let h10 = chunk.heights[z0 * res + x1];
    let h01 = chunk.heights[z1 * res + x0];
    let h11 = chunk.heights[z1 * res + x1];
    let a = h00 + (h10 - h00) * tx;
    let b = h01 + (h11 - h01) * tx;
    a + (b - a) * tz
}

pub fn character_on_terrain(chunk: &SurfaceChunk, x: f32, z: f32) -> (f32, [f32; 3]) {
    let y = sample_height_bilinear(chunk, x, z);
    let n = tn(x, z, &chunk.terrain);
    (y, n)
}
