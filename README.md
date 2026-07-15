# False World

Inicio de un juego de superficie (pradera procedural): **workers Resuma** cuecen terreno FBM + hierba empaquetada; el **browser WebGPU** (o el binario nativo **wgpu 30**) lo pinta. Inspirado en [False Earth](https://github.com/momentchan/false-earth) de Ming-Jyun Hung — grid snap, blades 64 B, cámaras Follow/FPV/Orbit. Código propio; no es un port de Three/TSL.

## Stack

| Crate | Rol |
|--------|-----|
| `falseworld-core` | PCG, FBM, heightmap, packing de blades, codec **FWCH** |
| `falseworld` | App Resuma Flow — `start_meadow_chunk` / `claim_meadow_chunk` |
| `falseworld-wgpu` | Preview nativo ([docs.rs/wgpu](https://docs.rs/wgpu/latest/wgpu/)) |

## Run (web)

```bash
cd apps/falseworld
cargo run -p falseworld
```

Abre la URL que imprime Flow (CSP WebGPU activada). WASD caminar, **C** cicla cámara, botones Follow/FPV/Orbit.

## Run (nativo wgpu)

```bash
cargo run -p falseworld-wgpu
# solo bake / codec:
cargo run -p falseworld-wgpu -- --bake-only
```

## Créditos

- Conceptos de paisaje/UI: False Earth — Ming-Jyun Hung  
- Asset grass/astronaut del demo original: licencias propias del autor; aquí no se reutilizan  
- Motor web: [Resuma](https://github.com/GoldevLab/resuma) · render: WebGPU / wgpu  

## Licencia

MIT OR Apache-2.0
