# False World — AAA engine track

Two tracks share `falseworld-core` (PCG, terrain, biomes):

| Track | Target | Stack | Status |
|-------|--------|-------|--------|
| **Web** | Playable meadow in browser | Resuma + WebGPU JS (`fw-meadow-gpu-v*`) | Active (trees, CSM, day/night, ocean) |
| **Native AAA** | Desktop fidelity + experimental GPU features | `falseworld-wgpu` (wgpu 30 + winit) | Foundation |

## Why not RT / mesh shaders on web trees

Browser WebGPU does not expose wgpu’s `EXPERIMENTAL_RAY_QUERY` / `EXPERIMENTAL_MESH_SHADER`. Current trees are **procedural billboard crosses**, not triangle meshes — RT/mesh need real geometry.

## Native AAA roadmap

1. **Parity** — port sky TOD, CSM, ocean, trees from the web client into `falseworld-wgpu` (same WGSL where possible).
2. **Mesh trees** — replace billboards with low-poly trunk/branch/leaf meshes (or meshlets).
3. **Features (optional)** — enable `Features::EXPERIMENTAL_MESH_SHADER` for meshlet LOD; `EXPERIMENTAL_RAY_QUERY` for contact AO / soft shadows once meshes exist.
4. **HDR** — `SurfaceConfiguration::color_space` + tonemap (see [wgpu HDR docs](https://docs.rs/wgpu/latest/wgpu/)).
5. **Keep web** — web stays the shipping playable build; native is the fidelity / R&D path.

### Progress

| Step | Status |
|------|--------|
| Web atmosphere (height fog, tree fog, Karis bloom, soft CSM, contact AO) | **v88** |
| Native celestial Frame (TOD sun, light_col, amb, fog, ACES) | **done** |
| Native CSM / sky mesh / trees | pending |

## Run

```bash
# Web (playable)
RESUMA_ADDR=127.0.0.1:3010 RESUMA_DEV=1 cargo run -p falseworld

# Native preview
cargo run -p falseworld-wgpu
```

## Design rule

Improve **look** on the web path first (billboard quality, lighting, shadows). Graduate techniques that need hardware RT/mesh into `falseworld-wgpu` only after meshes exist.
