//! Value / FBM noise for terrain.

use crate::pcg::hash2to1;

fn fade(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

fn value_noise(x: f32, z: f32, seed: u32) -> f32 {
    // Use floor + positive fractional part. Rust's `f32::fract` keeps the sign
    // for negatives (e.g. (-1.3).fract() == -0.3), which breaks fade/lerp and
    // used to carve sinkholes in the SW/NW island quadrants.
    let x0 = x.floor();
    let z0 = z.floor();
    let tx = fade(x - x0);
    let tz = fade(z - z0);
    let ix = x0 as i32;
    let iz = z0 as i32;
    let s = seed as i32;
    let a = hash2to1(ix.wrapping_add(s), iz);
    let b = hash2to1(ix.wrapping_add(1).wrapping_add(s), iz);
    let c = hash2to1(ix.wrapping_add(s), iz.wrapping_add(1));
    let d = hash2to1(ix.wrapping_add(1).wrapping_add(s), iz.wrapping_add(1));
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
        // value_noise is [0,1] → center to [-1,1] per octave so climate
        // thresholds (temp/moist < 0) work in every quadrant.
        let v = value_noise(x * freq, z * freq, seed.wrapping_add(i * 17)) * 2.0 - 1.0;
        sum += v * amp;
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

#[cfg(test)]
mod noise_tests {
    use super::*;

    #[test]
    fn fbm_stable_in_all_quadrants() {
        let mut min_v = f32::INFINITY;
        let mut max_v = f32::NEG_INFINITY;
        for &x in &[-80.0f32, -20.0, 20.0, 80.0] {
            for &z in &[-80.0f32, -20.0, 20.0, 80.0] {
                let v = fbm(x * 0.018, z * 0.018, 42, 4);
                min_v = min_v.min(v);
                max_v = max_v.max(v);
                assert!(v.is_finite(), "non-finite at {x},{z}");
                assert!(v > -1.35 && v < 1.35, "out of range {v} at {x},{z}");
            }
        }
        eprintln!("fbm range sample [{min_v:.3}, {max_v:.3}]");
        assert!(min_v < -0.05, "expected negative lobes, min={min_v}");
        assert!(max_v > 0.05, "expected positive lobes, max={max_v}");
    }
}
