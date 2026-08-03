# False World — AAA engine track

Two tracks share `falseworld-core` (PCG, terrain, biomes):

| Track | Target | Stack | Status |
|-------|--------|-------|--------|
| **Web** | Playable meadow in browser | Resuma + WebGPU JS (`fw-meadow-gpu`, hash-cache-busted) | Active (trees, CSM, day/night, ocean) |
| **Native AAA** | Desktop fidelity + experimental GPU features | `falseworld-wgpu` (wgpu 30 + winit) | Foundation |

## Why not RT / mesh shaders on web trees

Browser WebGPU does not expose wgpu’s `EXPERIMENTAL_RAY_QUERY` / `EXPERIMENTAL_MESH_SHADER`. Current trees are **procedural billboard crosses**, not triangle meshes — RT/mesh need real geometry.

## Native AAA roadmap

1. **Parity** — port sky TOD, CSM, ocean, trees from the web client into `falseworld-wgpu` (same WGSL where possible). ✅ single-cascade shadow map, procedural sky, animated ocean plane, and instanced low-poly mesh trees now run through `aaa_pass_order` (`ShadowCascades → SkyAtmosphere → Terrain → Ocean → Grass → Trees → PostTonemap`).
2. **Mesh trees** — replace billboards with low-poly trunk/branch/leaf meshes (or meshlets). ✅ done natively via `trees.rs` (`build_tree_mesh` + `scatter_trees`, deterministic hash-based placement per biome density); web billboards remain unchanged (see "Why not RT / mesh shaders on web trees").
3. **Features (optional)** — enable `Features::EXPERIMENTAL_MESH_SHADER` for meshlet LOD; `EXPERIMENTAL_RAY_QUERY` for contact AO / soft shadows once meshes exist. Not started — current trees are plain triangle meshes, no meshlets yet.
4. **HDR** — `SurfaceConfiguration::color_space` + tonemap (see [wgpu HDR docs](https://docs.rs/wgpu/latest/wgpu/)). Partial: `EngineFeatures::aaa_target()` flips `hdr: true` and the pass list already reserves `PostTonemap`, but the pass itself is still a no-op placeholder.
5. **Keep web** — web stays the shipping playable build; native is the fidelity / R&D path.

### Progress

| Step | Status |
|------|--------|
| Web atmosphere (height fog, tree fog, Karis bloom, soft CSM, contact AO) | **v88** |
| Native celestial Frame (TOD sun, light_col, amb, fog, ACES) | **done** |
| Native CSM / sky mesh / trees | **done** (single-cascade shadow, not multi-cascade — see "Next" below) |

### Next

- **True CSM**: current native shadow map is a single orthographic cascade sized for the whole visible chunk; splitting into 2-3 cascades (near/mid/far) would sharpen close shadows without a bigger texture.
- **PostTonemap pass**: `aaa_pass_order` already lists it and `--aaa` sets `hdr: true`, but no HDR render target / tonemap shader exists yet — colors are written directly to the swapchain format.
- **Mesh shaders / ray query**: gated on Vulkan-only `wgpu::Features`; only worth adding once tree meshes have enough triangle density to benefit from meshlet culling.

## Run

```bash
# Web (playable)
RESUMA_ADDR=127.0.0.1:3010 RESUMA_DEV=1 cargo run -p falseworld

# Native preview
cargo run -p falseworld-wgpu
```

## Design rule

Improve **look** on the web path first (billboard quality, lighting, shadows). Graduate techniques that need hardware RT/mesh into `falseworld-wgpu` only after meshes exist.
