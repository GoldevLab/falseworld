use crate::biome::{biome_amp_blend, island_edge, snow_weight, ISLAND_HALF};
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
            // Mild — hills, not alpine spikes
            amplitude: 0.7,
            frequency: 0.018,
            seed: 42,
        }
    }
}

/// Domain warp — breaks axis-aligned / grid-looking slopes.
fn warp2(x: f32, z: f32, seed: u32, scale: f32, strength: f32) -> (f32, f32) {
    let wx = fbm(x * scale, z * scale, seed, 3) * strength;
    let wz = fbm(x * scale + 19.0, z * scale - 11.0, seed.wrapping_add(13), 3) * strength;
    (x + wx, z + wz)
}

/// Soft 0..1 → billowy height (compresses peaks, keeps gentle skirts).
fn soft_lobe(t: f32) -> f32 {
    let u = t.clamp(0.0, 1.0);
    // Smoothstep then ease-out so crests stay rounded
    let s = u * u * (3.0 - 2.0 * u);
    s * s.sqrt() // ≈ s^1.25 — flattens sharp tips
}

fn inland_mask(x: f32, z: f32, seed: u32) -> f32 {
    // Noisy radius so the hill apron isn't a perfect circle
    let (wx, wz) = warp2(x, z, seed.wrapping_add(71), 0.012, 18.0);
    let r = (wx * wx + wz * wz).sqrt();
    let fade = ISLAND_HALF * 0.78;
    (1.0 - ((r - fade * 0.5) / (fade * 0.5)).clamp(0.0, 1.0)).clamp(0.0, 1.0)
}

/// Broad organic rolling hills — long wavelengths, soft crests (no cones).
pub fn rolling_hills(x: f32, z: f32, seed: u32) -> f32 {
    let mask = inland_mask(x, z, seed);
    if mask < 1e-3 {
        return 0.0;
    }
    // Strong low-freq warp, weak high-freq (avoids jagged ridges)
    let (x1, z1) = warp2(x, z, seed.wrapping_add(301), 0.006, 28.0);
    let (x2, z2) = warp2(x1, z1, seed.wrapping_add(307), 0.012, 12.0);
    let broad = fbm(x2 * 0.0045, z2 * 0.0045, seed.wrapping_add(311), 5);
    let mid = fbm(x2 * 0.009 + 3.0, z2 * 0.009 - 2.0, seed.wrapping_add(313), 3);
    let detail = fbm(x2 * 0.016, z2 * 0.016, seed.wrapping_add(317), 2);
    let b = soft_lobe(broad * 0.5 + 0.5);
    let m = soft_lobe(mid * 0.5 + 0.5);
    // Long, low rolls — visible colinas on the small island
    let h = b * 2.35 + m * 0.85 + detail * 0.12;
    h * mask
}

/// Soft central knoll — wide, low, round (not a pyramid).
pub fn center_mountain(x: f32, z: f32, seed: u32) -> f32 {
    let (wx, wz) = warp2(x, z, seed.wrapping_add(601), 0.014, 18.0);
    let r = (wx * wx + wz * wz).sqrt();
    let r_max = 72.0 + fbm(x * 0.02, z * 0.02, seed.wrapping_add(609), 2) * 16.0;
    if r >= r_max {
        return 0.0;
    }
    let u = (r / r_max).clamp(0.0, 1.0);
    // Cosine-like mound: flat-ish top, soft skirts
    let fall = ((1.0 - u * u).max(0.0)).powf(2.4);
    let n = fbm(wx * 0.012, wz * 0.012, seed.wrapping_add(611), 3) * 0.5 + 0.5;
    (0.95 + n * 0.65) * fall
}

pub fn cordillera(x: f32, z: f32, seed: u32) -> f32 {
    rolling_hills(x, z, seed)
}

fn snow_hills(x: f32, z: f32, seed: u32) -> f32 {
    let w = snow_weight(x, z, seed);
    if w < 1e-4 {
        return 0.0;
    }
    let (wx, wz) = warp2(x, z, seed.wrapping_add(201), 0.012, 14.0);
    let mass = soft_lobe(fbm(wx * 0.008, wz * 0.008, seed.wrapping_add(211), 4) * 0.5 + 0.5);
    // Gentle snow rises — never alpine cones
    (0.25 + mass * 0.55) * w
}

pub fn terrain_height(x: f32, z: f32, p: &TerrainParams) -> f32 {
    let (wx, wz) = warp2(x, z, p.seed.wrapping_add(1), 0.005, 20.0);
    let n = fbm(
        wx * p.frequency + 0.001,
        wz * p.frequency,
        p.seed,
        4,
    );
    let (amp_mul, base) = biome_amp_blend(x, z, p.seed);
    let macro_n = fbm(wx * 0.0032, wz * 0.0032, p.seed.wrapping_add(77), 5);
    let amp = p.amplitude * (0.7 + 0.3 * amp_mul);
    // Soft macro undulation (long hills across the island)
    let macro_h = soft_lobe(macro_n * 0.5 + 0.5) * 1.05;
    let mut h = n * amp * 0.85 + base * 0.25 + macro_h;
    h += rolling_hills(x, z, p.seed);
    h += center_mountain(x, z, p.seed);
    h += snow_hills(x, z, p.seed);

    // Soft ceiling — allow taller rounded hills (~8–10 m)
    if h > 3.5 {
        h = 3.5 + (h - 3.5) * 0.55;
    }
    if h > 6.5 {
        h = 6.5 + (h - 6.5) * 0.40;
    }

    let edge = island_edge(x, z);
    // Inland floor — no sinkholes; beach shelf below may still dive into the sea.
    if edge < 0.4 {
        let protect = (1.0 - edge / 0.4).clamp(0.0, 1.0);
        let floor = 0.16;
        if h < floor {
            h += (floor - h) * protect;
        }
    }
    if edge > 0.0 {
        // Organic beach: long flat sand berm, then soft shelf into the sea
        // (no cliff wall). Must stay in sync with WGSL/JS island_edge.
        let wobble = fbm(x * 0.018, z * 0.018, p.seed.wrapping_add(901), 3) * 0.1;
        let e = (edge + wobble).clamp(0.0, 1.0);
        let dune = fbm(x * 0.04, z * 0.04, p.seed.wrapping_add(911), 2);
        // Berm sits just above SEA_Y (-0.55) so the sand strip is readable
        let berm = 0.18 + dune.abs() * 0.28; // dry sand ~0.18–0.46 m
        let to_sand = (e / 0.50).clamp(0.0, 1.0);
        let ts = to_sand * to_sand * (3.0 - 2.0 * to_sand);
        h = h * (1.0 - ts * 0.94) + berm * ts;
        // Dive after the wet sand / waterline (~0.45), not mid-berm
        let into = ((e - 0.48) / 0.52).clamp(0.0, 1.0);
        let tw = into * into * (3.0 - 2.0 * into);
        h = h * (1.0 - tw * 0.82) - tw * 3.4;
    }
    h
}

pub fn terrain_normal(x: f32, z: f32, p: &TerrainParams) -> [f32; 3] {
    let eps = (0.22f32).max((x.abs().max(z.abs())) * 0.008);
    let h = terrain_height(x, z, p);
    let hx = terrain_height(x + eps, z, p);
    let hz = terrain_height(x, z + eps, p);
    let dx = [eps, hx - h, 0.0];
    let dz = [0.0, hz - h, eps];
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


#[cfg(test)]
mod soft_hills_tests {
    use super::*;
    use crate::biome::island_edge;
    #[test]
    fn hills_are_soft() {
        let p = TerrainParams::default();
        let mut max_h = f32::NEG_INFINITY;
        let mut max_slope = 0.0f32;
        let mut worst = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
        let mut x = -240.0;
        while x <= 240.0 {
            let mut z = -240.0;
            while z <= 240.0 {
                let e = island_edge(x, z);
                let e2 = island_edge(x + 1.0, z)
                    .max(island_edge(x, z + 1.0))
                    .max(island_edge(x - 1.0, z))
                    .max(island_edge(x, z - 1.0));
                if e > 0.02 || e2 > 0.08 {
                    z += 4.0;
                    continue;
                }
                let h = terrain_height(x, z, &p);
                let hx = terrain_height(x + 1.0, z, &p);
                let hz = terrain_height(x, z + 1.0, &p);
                let sx = (hx - h).abs();
                let sz = (hz - h).abs();
                let slope = sx.max(sz);
                max_h = max_h.max(h);
                if slope > max_slope {
                    max_slope = slope;
                    worst = (x, z, h, e);
                }
                z += 4.0;
            }
            x += 4.0;
        }
        eprintln!("inland max_h={max_h:.2} max_slope/m={max_slope:.3} at {:?}", worst);
        assert!(max_h < 5.5, "too tall: {max_h}");
        // Neighbour may still brush the beach shelf; keep this loose
        assert!(max_slope < 2.5, "too steep inland: {max_slope} at {worst:?}");
    }
}

#[cfg(test)]
mod hole_scan {
    use super::*;
    use crate::biome::island_edge;
    #[test]
    fn find_deep_inland_holes() {
        let p = TerrainParams::default();
        let mut deep = Vec::new();
        let mut x = -240.0;
        while x <= 240.0 {
            let mut z = -240.0;
            while z <= 240.0 {
                let e = island_edge(x, z);
                if e < 0.05 {
                    let h = terrain_height(x, z, &p);
                    if h < 0.0 {
                        deep.push((h, x, z, e));
                    }
                }
                z += 2.0;
            }
            x += 2.0;
        }
        deep.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        eprintln!("inland below 0: {} samples", deep.len());
        for row in deep.iter().take(15) {
            eprintln!("  h={:.3} at ({:.0},{:.0}) e={:.3}", row.0, row.1, row.2, row.3);
        }
        let min_h = deep.first().map(|r| r.0).unwrap_or(0.0);
        assert!(
            deep.is_empty(),
            "deep inland hole: {min_h} ({} samples)",
            deep.len()
        );
    }
}

