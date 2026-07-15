//! Packed grass blades — 64 bytes / blade (4× vec4), False Earth layout.

use crate::pcg::{hash2to1, hash2to2};
use crate::terrain::{terrain_height, terrain_normal, TerrainParams};
use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable, Serialize, Deserialize)]
pub struct BladePacked {
    /// xyz position, w type
    pub data0: [f32; 4],
    /// width, height, bend, wind
    pub data1: [f32; 4],
    /// rot_sin, rot_cos, clump_seed, blade_seed
    pub data2: [f32; 4],
    /// normal.xz compressed, push.xy
    pub data3: [f32; 4],
}

#[derive(Clone, Copy, Debug)]
pub struct GrassParams {
    pub area: f32,
    pub blades_per_axis: u32,
    pub seed: u32,
}

pub fn pack_blade_field(
    origin_x: f32,
    origin_z: f32,
    grass: &GrassParams,
    terrain: &TerrainParams,
    progress: &dyn Fn(u8),
) -> Vec<BladePacked> {
    let n = grass.blades_per_axis as usize;
    let spacing = grass.area / n.max(1) as f32;
    let mut out = Vec::with_capacity(n * n);
    let half = grass.area * 0.5;

    for iz in 0..n {
        for ix in 0..n {
            let (jx, jz) = hash2to2(ix as i32 ^ grass.seed as i32, iz as i32);
            let lx = -half + (ix as f32 + jx) * spacing;
            let lz = -half + (iz as f32 + jz) * spacing;
            let wx = origin_x + lx;
            let wz = origin_z + lz;
            let wy = terrain_height(wx, wz, terrain);
            let nrm = terrain_normal(wx, wz, terrain);

            let blade_seed = hash2to1(ix as i32, (iz as i32).wrapping_add(grass.seed as i32));
            let clump = hash2to1(
                (ix / 4) as i32 ^ grass.seed as i32,
                (iz / 4) as i32,
            );
            let kind = (blade_seed * 3.0).floor().clamp(0.0, 2.0);
            let height = 0.45 + blade_seed * 0.85 + clump * 0.25;
            let width = 0.04 + (1.0 - blade_seed) * 0.05;
            let bend = 0.15 + clump * 0.35;
            let wind = 0.4 + blade_seed * 0.6;
            let ang = blade_seed * std::f32::consts::TAU;

            out.push(BladePacked {
                data0: [wx, wy, wz, kind],
                data1: [width, height, bend, wind],
                data2: [ang.sin(), ang.cos(), clump, blade_seed],
                data3: [nrm[0], nrm[2], 0.0, 0.0],
            });
        }
        if iz % 16 == 0 {
            progress(50 + ((iz as u32 * 45) / n as u32) as u8);
        }
    }
    out
}
