//! Large-scale biomes for a ~0.5 km island.

use crate::noise::fbm;

/// Half-extent of the playable island (world units ≈ metres). Full map ≈ 512².
pub const ISLAND_HALF: f32 = 256.0;

/// Feature scale — several biome patches across the ~0.5 km island.
const BIOME_SCALE: f32 = 1.0 / 90.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Biome {
    Meadow = 0,
    Dry = 1,
    Forest = 2,
    Snow = 3,
    Marsh = 4,
    Desert = 5,
}

impl Biome {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Dry,
            2 => Self::Forest,
            3 => Self::Snow,
            4 => Self::Marsh,
            5 => Self::Desert,
            _ => Self::Meadow,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Meadow => "Pradera",
            Self::Dry => "Llanura",
            Self::Forest => "Bosque",
            Self::Snow => "Nieve",
            Self::Marsh => "Pantano",
            Self::Desert => "Desierto",
        }
    }

    /// Multiplier on base terrain amplitude.
    pub fn amp_mul(self) -> f32 {
        match self {
            Self::Meadow => 1.0,
            Self::Dry => 0.55,
            Self::Forest => 1.05,
            // Snow: keep amp mild so patches don't become cones
            Self::Snow => 0.95,
            Self::Marsh => 0.38,
            Self::Desert => 0.32,
        }
    }

    /// Extra base height (snow rises / marsh dips) — keep mild for soft hills.
    pub fn base_y(self) -> f32 {
        match self {
            Self::Snow => 0.2,
            Self::Marsh => -0.12,
            Self::Desert => 0.1,
            Self::Forest => 0.18,
            _ => 0.0,
        }
    }
}

/// Soft 0..1 mountain weight from climate coldness.
/// Very wide skirts so the snow zone rises as a real hill, not a mesa/wall.
pub fn snow_weight(x: f32, z: f32, seed: u32) -> f32 {
    let (temp, _) = climate(x, z, seed);
    let blob = fbm(
        x * (1.0 / 110.0),
        z * (1.0 / 110.0),
        seed.wrapping_add(77),
        3,
    );
    // Extra height in snow patches (~balanced coverage)
    let cold = ((0.05 - temp) / 0.55).clamp(0.0, 1.0);
    let patch = ((blob - 0.15) / 0.55).clamp(0.0, 1.0);
    let t = (cold * 0.55 + patch * 0.75).clamp(0.0, 1.0);
    let s = t * t * (3.0 - 2.0 * t);
    s * s
}

fn climate(x: f32, z: f32, seed: u32) -> (f32, f32) {
    let sx = x * BIOME_SCALE;
    let sz = z * BIOME_SCALE;
    let wx = sx + fbm(sx * 0.7, sz * 0.7, seed.wrapping_add(3), 2) * 0.35;
    let wz = sz + fbm(sx * 0.7 + 4.0, sz * 0.7 - 2.0, seed.wrapping_add(5), 2) * 0.35;
    // Mild warm bias — room for snow patches without icing the whole island
    let temp = fbm(wx, wz, seed.wrapping_add(11), 4) * 0.88 + 0.08;
    let moist = fbm(wx + 17.0, wz - 9.0, seed.wrapping_add(29), 4);
    (temp, moist)
}

/// Legacy constant (gentle knoll).
pub const CENTER_MTN_R: f32 = 55.0;

pub fn biome_at(x: f32, z: f32, seed: u32) -> Biome {
    let (temp, moist) = climate(x, z, seed);
    // Localized snow lobes (~10–15% of island) + very cold climate
    let snow_blob = fbm(
        x * (1.0 / 110.0),
        z * (1.0 / 110.0),
        seed.wrapping_add(77),
        3,
    );
    let snow_here = (snow_blob > 0.28 && temp < 0.18) || temp < -0.28;

    if snow_here {
        Biome::Snow
    } else if temp > 0.48 && moist < -0.12 {
        Biome::Desert
    } else if moist > 0.32 {
        if temp > 0.05 {
            Biome::Marsh
        } else {
            Biome::Forest
        }
    } else if moist < -0.22 {
        Biome::Dry
    } else {
        Biome::Meadow
    }
}

/// Soft blend of neighbouring biome amps — ring samples (not axis-aligned cross).
pub fn biome_amp_blend(x: f32, z: f32, seed: u32) -> (f32, f32) {
    // Irregular radii/angles so height steps don't read as squares
    let samples = [
        (0.0, 0.0),
        (26.0, 8.0),
        (-22.0, 16.0),
        (-18.0, -24.0),
        (14.0, -28.0),
        (30.0, -6.0),
        (-8.0, 30.0),
        (10.0, 22.0),
    ];
    let mut amp = 0.0f32;
    let mut base = 0.0f32;
    let n = samples.len() as f32;
    for (dx, dz) in samples {
        // Small noise jitter breaks remaining grid feel
        let jx = fbm(x * 0.04 + dx, z * 0.04 + dz, seed.wrapping_add(41), 1) * 6.0;
        let jz = fbm(x * 0.04 - dz, z * 0.04 + dx, seed.wrapping_add(43), 1) * 6.0;
        let b = biome_at(x + dx + jx, z + dz + jz, seed);
        amp += b.amp_mul();
        base += b.base_y();
    }
    (amp / n, base / n)
}

/// Integer hash — must match WGSL `biome_hash21` / JS map (coastline sync).
fn coast_hash21(ix: i32, iz: i32) -> f32 {
    let mut n = (ix as u32)
        .wrapping_mul(1597334677)
        .wrapping_add((iz as u32).wrapping_mul(3812015801));
    n = (n << 13) ^ n;
    n = n.wrapping_mul(1274126177);
    n as f32 * (1.0 / 4294967295.0)
}

fn coast_value_noise(x: f32, z: f32) -> f32 {
    let x0 = x.floor() as i32;
    let z0 = z.floor() as i32;
    let fx = x - x0 as f32;
    let fz = z - z0 as f32;
    let ux = fx * fx * (3.0 - 2.0 * fx);
    let uz = fz * fz * (3.0 - 2.0 * fz);
    let a = coast_hash21(x0, z0);
    let b = coast_hash21(x0 + 1, z0);
    let c = coast_hash21(x0, z0 + 1);
    let d = coast_hash21(x0 + 1, z0 + 1);
    let ab = a + (b - a) * ux;
    let cd = c + (d - c) * ux;
    (ab + (cd - ab) * uz) * 2.0 - 1.0
}

fn coast_fbm(x: f32, z: f32) -> f32 {
    let mut s = 0.0f32;
    let mut a = 1.0f32;
    let mut f = 1.0f32;
    let mut n = 0.0f32;
    for _ in 0..4 {
        s += coast_value_noise(x * f, z * f) * a;
        n += a;
        a *= 0.5;
        f *= 2.02;
    }
    s / n.max(1e-5)
}

/// Local shoreline radius in world units (irregular island, not a disc).
/// Must match WGSL `coast_radius` / JS `coastRadius`.
pub fn coast_radius(x: f32, z: f32) -> f32 {
    let ang = z.atan2(x);
    // Multi-lobe silhouette: bays + headlands
    let lobes = (ang * 2.0).sin() * 0.085
        + (ang * 3.0 + 1.3).sin() * 0.06
        + (ang * 5.0 + 0.7).cos() * 0.045
        + (ang * 9.0 + 2.4).sin() * 0.028
        + (ang * 14.0 - 0.9).cos() * 0.018;
    let n = coast_fbm(x * (1.0 / 480.0), z * (1.0 / 480.0));
    let n2 = coast_fbm(x * (1.0 / 220.0) + 19.0, z * (1.0 / 220.0) - 11.0);
    let warp = (0.90 + lobes + n * 0.12 + n2 * 0.07).clamp(0.68, 1.22);
    ISLAND_HALF * warp
}

/// 0 inland → 1 past the (irregular) shoreline into the ocean shelf.
/// Wider band than before so a real beach (dry sand → wet → shelf) can form.
pub fn island_edge(x: f32, z: f32) -> f32 {
    let dist = (x * x + z * z).sqrt();
    let rim = coast_radius(x, z);
    // Beach starts ~28% of rim inland; full ocean past the rim
    ((dist - rim * 0.72) / (rim * 0.34).max(1.0)).clamp(0.0, 1.0)
}
