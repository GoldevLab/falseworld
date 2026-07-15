//! Value / FBM noise for terrain.

use crate::pcg::hash2to1;

fn fade(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

fn value_noise(x: f32, z: f32, seed: u32) -> f32 {
    let x0 = x.floor() as i32;
    let z0 = z.floor() as i32;
    let tx = fade(x.fract());
    let tz = fade(z.fract());
    let s = seed as i32;
    let a = hash2to1(x0.wrapping_add(s), z0);
    let b = hash2to1(x0.wrapping_add(1).wrapping_add(s), z0);
    let c = hash2to1(x0.wrapping_add(s), z0.wrapping_add(1));
    let d = hash2to1(x0.wrapping_add(1).wrapping_add(s), z0.wrapping_add(1));
    let ab = a + (b - a) * tx;
    let cd = c + (d - c) * tx;
    ab + (cd - ab) * tz
}

/// Fractal Brownian motion — returns ~[-1, 1].
pub fn fbm(x: f32, z: f32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 1.0f32;
    let mut freq = 1.0f32;
    let mut sum = 0.0f32;
    let mut norm = 0.0f32;
    for i in 0..octaves {
        sum += value_noise(x * freq, z * freq, seed.wrapping_add(i * 17)) * amp;
        norm += amp;
        amp *= 0.5;
        freq *= 2.02;
    }
    if norm > 1e-6 {
        sum / norm
    } else {
        0.0
    }
}
