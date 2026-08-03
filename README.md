# False World

Inicio de un juego de superficie (pradera procedural): **workers Resuma** cuecen terreno FBM + hierba empaquetada; el **browser WebGPU** (o el binario nativo **wgpu 30**) lo pinta. Inspirado en [False Earth](https://github.com/momentchan/false-earth) de Ming-Jyun Hung — grid snap, blades 64 B, cámaras Follow/FPV/Orbit. Código propio; no es un port de Three/TSL.
## Stack

| Crate | Rol |
|--------|-----|
| `falseworld-core` | PCG, FBM, heightmap, packing de blades, codec **FWCH** |
| `falseworld` | App Resuma Flow — `start_meadow_chunk` / `claim_meadow_chunk` |
| `falseworld-wgpu` | Preview nativo ([docs.rs/wgpu](https://docs.rs/wgpu/latest/wgpu/)) — ver [ENGINE.md](./ENGINE.md) (pista AAA) |

## Avatar VRM (estilo VRMedia)

El meadow es **WebGPU**; el personaje es una **capa WebGL** con el mismo stack que [VRMedia](../vrmedia): Three.js + `@pixiv/three-vrm` + retarget Mixamo.

Assets (tracked essentials for production; see `.gitignore` allowlist):

- `/avatars/sophia.vrm`
- `/animaciones/StandingIdle.fbx`, `/animaciones/Walking.fbx`, `/animaciones/FastRun.fbx`

Cambia el VRM dejando otro `.vrm` en `public/avatars/` (y añádelo al allowlist) y ajustando la URL en el client VRM.

## Run (web)

```bash
cd apps/falseworld
npm install          # una vez — instala esbuild para el build de cliente
npm run build:client # bundlea static/client/src/*/entry.js -> static/client/*.js
# PATH necesita ~/.cargo/bin
resuma dev
# o: cargo run -p falseworld
```

Abre la URL (CSP WebGPU + `esm.sh` para three-vrm). WASD caminar, **C** cicla cámara.

### Cliente WebGPU: fuente modular + bundle

`static/client/*.js` son **artefactos generados** (no los edites a mano). La fuente vive en
`static/client/src/<bundle>/entry.js` + módulos ES junto a sus WGSL (`shaders/*.wgsl`, cargados
como texto). `npm run build:client` bundlea cada `entry.js` con esbuild (`format: iife`, sin
minify) de vuelta al archivo plano que `src/main.rs` sirve vía `client_asset!(include_bytes!(...))`
— Resuma calcula el `?v=<hash>` de contenido automáticamente, así que solo hace falta reiniciar
el server dev tras rebuildear para que el navegador vea el nuevo hash. `npm run watch:client`
rebuildea en cada guardado durante desarrollo activo del renderer.

## Cuentas y persistencia

Login/registro (`src/auth.rs`) + inventario por jugador (`src/player_inventory.rs`) se
guardan en **Turso/libSQL** (`src/db.rs`), la DB que recomienda Resuma para SQLite-compatible
edge storage ([resuma-docs.fly.dev](https://resuma-docs.fly.dev/) → integraciones). Sin
configurar nada usa un archivo local (`file:data/falseworld.db`, creado en el primer boot,
ya en `.gitignore`). Para apuntar a una DB remota de Turso en producción:

```bash
export TURSO_DATABASE_URL="libsql://<db>.turso.io"
export TURSO_AUTH_TOKEN="<token>"
```

Contraseñas con Argon2id, sesiones firmadas en cookie `HttpOnly` (`fw_session`, 30 días).
`/` requiere sesión — un `#[middleware]` (`auth::attach_session`) redirige a `/login` con
`ResumaError::Redirect`, una capacidad de Resuma añadida al dogfoodear esta feature.

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
