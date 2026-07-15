use crate::noise::fbm;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct TerrainParams {
    pub amplitude: f32,
    pub frequency: f32,
    pub seed: u32,
}

impl Default for TerrainParams {
    fn default() -> Self {
        Self {
            amplitude: 2.4,
            frequency: 0.045,
            seed: 42,
        }
    }
}

pub fn terrain_height(x: f32, z: f32, p: &TerrainParams) -> f32 {
    let n = fbm(
        x * p.frequency + 0.001,
        z * p.frequency,
        p.seed,
        5,
    );
    n * p.amplitude
}

pub fn terrain_normal(x: f32, z: f32, p: &TerrainParams) -> [f32; 3] {
    let eps = (0.1f32).max((x.abs().max(z.abs())) * 0.01);
    let h = terrain_height(x, z, p);
    let hx = terrain_height(x + eps, z, p);
    let hz = terrain_height(x, z + eps, p);
    let dx = [eps, hx - h, 0.0];
    let dz = [0.0, hz - h, eps];
    // cross(dz, dx) for Y-up
    let mut n = [
        dz[1] * dx[2] - dz[2] * dx[1],
        dz[2] * dx[0] - dz[0] * dx[2],
        dz[0] * dx[1] - dz[1] * dx[0],
    ];
    let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    if len < 1e-5 {
        [0.0, 1.0, 0.0]
    } else {
        n[0] /= len;
        n[1] /= len;
        n[2] /= len;
        n
    }
}
