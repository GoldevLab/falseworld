//! Low-poly mesh trees for the native AAA path (`ENGINE.md` step 2: "Mesh
//! trees — replace billboards with low-poly trunk/branch/leaf meshes").
//!
//! The web client still uses procedural billboard crosses (browser WebGPU
//! has no `EXPERIMENTAL_MESH_SHADER`/`EXPERIMENTAL_RAY_QUERY`); native is
//! where real triangle geometry can exist, which is the whole point of this
//! module — it's the prerequisite for eventually flipping
//! `EngineFeatures::mesh_shaders` / `ray_query` on for real (meshlet LOD /
//! contact AO need actual BLAS-able geometry, not billboards).
//!
//! Pure data generation (mesh + placement), independent of wgpu resources,
//! so it's covered by ordinary `cargo test` without a GPU/display.

use bytemuck::{Pod, Zeroable};
use falseworld_core::{sample_height_bilinear, terrain_normal, Biome, SurfaceChunk};

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct TreeVertex {
    pub pos: [f32; 3],
    pub nrm: [f32; 3],
    pub color: [f32; 3],
}

/// Per-instance transform, uploaded once per chunk (mirrors the `Blade`
/// instancing pattern already used for grass in `main.rs`).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct TreeInstance {
    /// xyz = world position, w = uniform scale.
    pub pos_scale: [f32; 4],
    /// xy = yaw (sin, cos), z = foliage tint variation (0..1), w = pad.
    pub rot_tint: [f32; 4],
}

const TRUNK_HEIGHT: f32 = 1.7;
const TRUNK_RADIUS: f32 = 0.11;
const CANOPY_BASE_Y: f32 = 1.25;
const CANOPY_TIERS: [(f32, f32, f32); 2] = [
    // (base radius, top y, top radius) — stacked cone frustums.
    (1.05, 2.9, 0.55),
    (0.72, 4.1, 0.02),
];
const TRUNK_COLOR: [f32; 3] = [0.30, 0.20, 0.12];
const CANOPY_COLOR: [f32; 3] = [0.16, 0.36, 0.14];

fn push_frustum(
    verts: &mut Vec<TreeVertex>,
    indices: &mut Vec<u32>,
    sides: u32,
    y0: f32,
    r0: f32,
    y1: f32,
    r1: f32,
    color: [f32; 3],
) {
    let base = verts.len() as u32;
    // Slightly outward-tilted normal (average of side slope), faceted per
    // wedge — intentional low-poly look, not smooth-shaded.
    let slope = (r0 - r1).atan2(y1 - y0);
    for i in 0..sides {
        let a = (i as f32 / sides as f32) * std::f32::consts::TAU;
        let (s, c) = a.sin_cos();
        let nrm = [c * slope.cos(), slope.sin(), s * slope.cos()];
        verts.push(TreeVertex {
            pos: [c * r0, y0, s * r0],
            nrm,
            color,
        });
        verts.push(TreeVertex {
            pos: [c * r1, y1, s * r1],
            nrm,
            color,
        });
    }
    for i in 0..sides {
        let i0 = base + i * 2;
        let i1 = base + i * 2 + 1;
        let j0 = base + ((i + 1) % sides) * 2;
        let j1 = base + ((i + 1) % sides) * 2 + 1;
        indices.extend_from_slice(&[i0, j0, i1, i1, j0, j1]);
    }
}

/// Builds one low-poly tree mesh (trunk + stacked canopy cones), origin at
/// the trunk base (`y = 0`) so instances can translate directly to terrain
/// height. Same mesh is instanced for every tree in a chunk — variation
/// comes from `TreeInstance::pos_scale`/`rot_tint`, not per-tree geometry.
pub fn build_tree_mesh(sides: u32) -> (Vec<TreeVertex>, Vec<u32>) {
    let sides = sides.max(5);
    let mut verts = Vec::new();
    let mut indices = Vec::new();
    push_frustum(
        &mut verts,
        &mut indices,
        sides,
        0.0,
        TRUNK_RADIUS,
        TRUNK_HEIGHT,
        TRUNK_RADIUS * 0.7,
        TRUNK_COLOR,
    );
    let mut y_prev = CANOPY_BASE_Y;
    let mut r_prev = CANOPY_TIERS[0].0;
    for &(r0, y1, r1) in &CANOPY_TIERS {
        // First tier's base radius comes from the const table; later tiers
        // continue from the previous tier's top so the canopy doesn't gap.
        let base_r = if y_prev == CANOPY_BASE_Y { r0 } else { r_prev };
        push_frustum(
            &mut verts,
            &mut indices,
            sides,
            y_prev,
            base_r,
            y1,
            r1,
            CANOPY_COLOR,
        );
        y_prev = y1;
        r_prev = r1;
    }
    (verts, indices)
}

fn hash21(ix: i32, iz: i32, seed: u32) -> u32 {
    let mut n = (ix as u32)
        .wrapping_mul(1597334677)
        .wrapping_add((iz as u32).wrapping_mul(3812015801))
        .wrapping_add(seed.wrapping_mul(2654435761));
    n = (n << 13) ^ n;
    n.wrapping_mul(1274126177)
}

fn hash01(ix: i32, iz: i32, seed: u32, salt: u32) -> f32 {
    (hash21(ix, iz, seed.wrapping_add(salt)) as f32) * (1.0 / 4294967295.0)
}

/// Minimum terrain height to plant a tree — keeps them off beach/underwater
/// shelf (`terrain.rs` dives height toward `SEA_Y` past the shoreline).
const MIN_TREE_HEIGHT: f32 = 0.32;
/// Trees lean toward `Forest`/`Meadow`; other biomes get a much lower chance
/// (never zero, so a stray tree at a biome edge doesn't look like a bug).
fn biome_density(biome: Biome) -> f32 {
    match biome {
        Biome::Forest => 1.0,
        Biome::Meadow => 0.35,
        Biome::Dry => 0.12,
        Biome::Snow => 0.10,
        Biome::Marsh => 0.20,
        Biome::Desert => 0.02,
    }
}

/// Deterministic jittered-grid tree placement over one `SurfaceChunk`.
/// Pure function of chunk data + seed — same inputs always give the same
/// forest, no per-frame/per-run randomness (`rand` crate intentionally not
/// a dependency here).
pub fn scatter_trees(chunk: &SurfaceChunk, seed: u32, target_count: u32) -> Vec<TreeInstance> {
    if target_count == 0 || chunk.area <= 0.0 {
        return Vec::new();
    }
    let cells_per_axis = (target_count as f32).sqrt().ceil().max(1.0) as i32;
    let cell = chunk.area / cells_per_axis as f32;
    let half = chunk.area * 0.5;
    let mut out = Vec::new();
    for cz in 0..cells_per_axis {
        for cx in 0..cells_per_axis {
            let jx = hash01(cx, cz, seed, 11) - 0.5;
            let jz = hash01(cx, cz, seed, 17) - 0.5;
            let local_x = (cx as f32 + 0.5 + jx * 0.8) * cell - half;
            let local_z = (cz as f32 + 0.5 + jz * 0.8) * cell - half;
            let wx = chunk.origin_x + local_x;
            let wz = chunk.origin_z + local_z;

            let h = sample_height_bilinear(chunk, wx, wz);
            if h < MIN_TREE_HEIGHT {
                continue;
            }
            let n = terrain_normal(wx, wz, &chunk.terrain);
            // Skip steep slopes (n.y close to 0 means near-vertical).
            if n[1] < 0.72 {
                continue;
            }
            let biome = falseworld_core::biome_at(wx, wz, chunk.seed);
            let roll = hash01(cx, cz, seed, 29);
            if roll > biome_density(biome) {
                continue;
            }
            let yaw = hash01(cx, cz, seed, 37) * std::f32::consts::TAU;
            let scale = 0.75 + hash01(cx, cz, seed, 41) * 0.7;
            let tint = hash01(cx, cz, seed, 43);
            out.push(TreeInstance {
                pos_scale: [wx, h, wz, scale],
                rot_tint: [yaw.sin(), yaw.cos(), tint, 0.0],
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use falseworld_core::{generate_chunk, ChunkRequest};

    fn test_chunk() -> SurfaceChunk {
        generate_chunk(
            &ChunkRequest {
                seed: 42,
                area: 96.0,
                height_res: 48,
                blades_per_axis: 0,
                ..Default::default()
            },
            &|_| {},
        )
    }

    #[test]
    fn tree_mesh_is_well_formed() {
        let (verts, indices) = build_tree_mesh(7);
        assert!(!verts.is_empty());
        assert!(!indices.is_empty());
        assert_eq!(indices.len() % 3, 0, "must be triangles");
        for &i in &indices {
            assert!((i as usize) < verts.len(), "index out of bounds");
        }
        for v in &verts {
            assert!(v.pos.iter().all(|c| c.is_finite()));
            assert!(v.nrm.iter().all(|c| c.is_finite()));
        }
    }

    #[test]
    fn low_poly_mesh_stays_small() {
        // "Low-poly" is a design goal, not just a name — keep it cheap to
        // instance thousands of times.
        let (verts, indices) = build_tree_mesh(7);
        assert!(verts.len() < 200, "got {} verts", verts.len());
        assert!(indices.len() < 600, "got {} indices", indices.len());
    }

    #[test]
    fn scatter_is_deterministic() {
        let chunk = test_chunk();
        let a = scatter_trees(&chunk, 7, 64);
        let b = scatter_trees(&chunk, 7, 64);
        assert_eq!(a.len(), b.len());
        for (x, y) in a.iter().zip(b.iter()) {
            assert_eq!(x.pos_scale, y.pos_scale);
            assert_eq!(x.rot_tint, y.rot_tint);
        }
    }

    #[test]
    fn scatter_avoids_underwater_and_stays_in_bounds() {
        let chunk = test_chunk();
        let trees = scatter_trees(&chunk, 7, 256);
        assert!(!trees.is_empty(), "expected at least some trees to spawn");
        let half = chunk.area * 0.5 + 1.0; // small slack for jitter
        for t in &trees {
            let [x, y, z, scale] = t.pos_scale;
            assert!(y >= MIN_TREE_HEIGHT, "tree planted underwater: y={y}");
            assert!((x - chunk.origin_x).abs() <= half);
            assert!((z - chunk.origin_z).abs() <= half);
            assert!(scale > 0.0 && scale.is_finite());
        }
    }

    #[test]
    fn different_seeds_move_trees() {
        let chunk = test_chunk();
        let a = scatter_trees(&chunk, 1, 64);
        let b = scatter_trees(&chunk, 2, 64);
        // Not a strict guarantee for every position, but the overall set
        // should differ for two different seeds.
        assert_ne!(
            a.iter().map(|t| t.pos_scale).collect::<Vec<_>>(),
            b.iter().map(|t| t.pos_scale).collect::<Vec<_>>()
        );
    }
}
