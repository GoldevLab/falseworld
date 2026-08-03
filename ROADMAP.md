# False World roadmap — Resuma + False World dogfooding

Both `falseworld` (this repo) and [`resuma`](https://github.com/GoldevLab/resuma) (the framework
it's built on) are our own — `falseworld` depends on it by **path**
(`resuma = { path = "../resuma/crates/resuma" }`), so any Resuma improvement is available here
immediately, no version bump needed. This roadmap tracks phases executed against that assumption:
things False World needs get built into Resuma itself instead of worked around locally. See
`resuma/ROADMAP.md` → "Derived from False World dogfooding" for the framework side of the ledger.

## Fase 0 — Higiene y dogfooding inmediato ✅

- [x] Cache-busting por hash de contenido (`client_asset`/`ClientComponent` con id estable +
      `?v=<hash>` automático) en vez del patrón manual `-vN` en nombre de archivo.
- [x] Borrados los ~250 archivos JS muertos versionados en `static/client/` (59 MB).
- [x] Limpieza de texto basura en `README.md` / `package.json`.
- [x] CI real (`cargo check/test/build --workspace`) en `.github/workflows/ci.yml`.

## Fase 1 — Resuma: features que False World necesita ✅

- [x] `resuma::realtime` (`Room`, `RoomRegistry`, `Peer`, `WsWriter`, `classify_frame`) — primitivas
      de sala/presencia/rate-limit reutilizables, extraídas de `src/multiplayer.rs`.
- [x] `resuma doctor` — detección de assets `static/client/*.js` huérfanos (sin `client_asset`
      referenciándolos).
- [x] `FlowEngine::last_artifact` / `last_result_field` — usado en `src/workers.rs`, ya no hay que
      recorrer `FlowEngine::replay` a mano por app.

## Fase 2 — Gameplay estilo Rust (supervivencia) ✅

- [x] **Persistencia de inventario por jugador** (`src/player_inventory.rs`, `data/players/*.json`)
      — reemplaza el stash de depuración de 10k por recurso en cada carga de página.
- [x] **Autoridad de servidor sobre daño de explosivos** — mensaje WS `explode` (`kind` + `hits`),
      resuelto en `src/multiplayer.rs::explosive_hard_damage` contra las tablas de
      `src/explosives.rs`; el servidor emite `hp`/`remove` autoritativos a todos los peers
      (incluyendo al atacante, que solo predijo localmente).
- [x] **Vectores de trampa cerrados**: `slots`/`inv` de piezas tipo caja/TC validados contra el
      catálogo `ITEMS` (`sanitize_item_slots` / `sanitize_resource_map`); `remove` restringido al
      dueño o miembro `auth` del TC/puerta (antes: cualquiera a 10 m).
- [ ] Hambre/sed/vida con decaimiento server-authoritative (hoy solo cliente, `vitals`) — queda
      para una iteración futura; el HP de piezas de construcción ya es autoritativo, el HP/vitals
      *del jugador* todavía no se sincroniza server-side.
- [ ] Crafting con tabla de recetas (solo catálogo de items hoy).

## Fase 3 — WebGPU (web + nativo) — en progreso

- [x] **Modularizar el cliente WebGPU**: los 8 bloques WGSL embebidos como template strings de JS
      (~4 600 líneas, casi el 25% del archivo) se movieron a `static/client/src/fw-meadow-gpu/shaders/*.wgsl`,
      con un entry point ES (`static/client/src/fw-meadow-gpu/entry.js`) bundleado de vuelta al
      archivo servido vía esbuild (`npm run build:client`, ver README). El resto de la lógica del
      renderer (~15 200 líneas) sigue siendo un único módulo por ahora — dividirlo en sky/terrain/
      grass/ocean/post-fx reales requiere primero extraer el estado compartido (closures mutables
      sobre `buildPieces`/`player`/`vitals`) a un objeto de contexto explícito; siguiente paso
      natural una vez este primer bundle esté en producción sin regresiones.
- [x] **Cerrar la brecha nativa (`falseworld-wgpu`)**: `render()` ahora itera `aaa_pass_order(&features)`
      real (antes calculado y descartado) y despacha `ShadowCascades → SkyAtmosphere → Terrain →
      Ocean → Grass → Trees → PostTonemap`. Nuevo: shadow map de una cascada (ortho desde el sol,
      `shadow_factor` con PCF 3×3 en `fs_terrain`), cielo procedural con gradiente día/noche +
      disco solar, plano de océano animado con Gerstner-lite, y árboles con malla de verdad
      (`src/trees.rs`: tronco+copa low-poly, colocación determinista por hash y densidad de bioma,
      con tests unitarios). Flag `--aaa` en `main.rs` alterna `EngineFeatures::preview()` /
      `aaa_target()` para que ambos paths se ejerciten. Verificado con `cargo run -p falseworld-wgpu`
      corriendo 25 s sin warnings/errores de validación de wgpu, y con `--aaa`. `PostTonemap`
      sigue siendo un placeholder (ver `ENGINE.md` → "Next"); CSM real (multi-cascada) queda pendiente.
- [x] **Evitar divergencia Rust ↔ WGSL/JS** en ruido/biomas/costas — investigado a fondo primero
      (ver detalle abajo) porque "ruido" cubre dos cosas con riesgo muy distinto:
  - **Altura de terreno**: sin riesgo — se bakea 100% en Rust (`generate_chunk` → FWCH) y tanto
    el navegador como `falseworld-wgpu` solo *muestrean* ese heightmap; el WGSL no tiene FBM de
    terreno, nada que sincronizar.
  - **Costa/`island_edge`** (`biome.rs::coast_radius`/`island_edge`): gameplay-crítico y
    *ya estaba alineado* en las 4 copias (Rust, `entry.js`, `scene.wgsl`+`compute.wgsl`,
    `ocean.wgsl`+`ocean-floor.wgsl`) — pero sin nada que lo garantizara aparte de comentarios
    "must match". `island_edge` decide tanto el tallado de playa en `terrain.rs` como el
    bloqueo de construcción en `entry.js` (`"cerca del mar"`), así que un desajuste aquí es un
    bug real (el cliente dejaría construir donde el servidor considera océano, o viceversa).
    Añadido `crates/falseworld-core/examples/dump_coast_grid.rs` (nuevo export
    `falseworld_core::island_edge`) + `scripts/check-noise-parity.mjs` — corre la fórmula Rust
    contra una transcripción independiente en JS sobre una rejilla de 841 puntos y falla si
    divergen más de `1e-2` unidades / `1e-4` de ratio. Verificado que **sí detecta** una
    divergencia real (probado inyectando un typo de una constante, restaurado después). Corre en
    `npm run check:noise-parity`, ahora en CI (`.github/workflows/ci.yml`) después de
    `cargo test --workspace`.
  - **Bioma (`biome_at` vs `biome_id`/`biomeAtJs`)**: divergencia real y **no corregida** —
    documentada aquí en vez de parcheada a ciegas porque arreglarla bien implica retuning visual
    que no puedo validar sin ver el juego correr. `biome_at` (Rust, `biome.rs:102`) usa el hash
    PCG (`pcg.rs::hash2to1`) con offsets de `seed` distintos por canal (`+3/+5/+11/+29/+77`);
    `biome_id`/`biome_weights` (`scene.wgsl:283`/`312`) y `biomeAtJs` (`entry.js:331`) usan un
    hash xor-mul completamente distinto (`biome_hash21`, el mismo de costa) y **no reciben seed
    en absoluto**. Mismos umbrales de temperatura/humedad, pero el campo de ruido de fondo es
    otro — el mapa de bioma "de verdad" (el que decide `terrain_height`'s amp/base_y en el
    servidor y `biome_density` para árboles nativos) y el mapa de bioma "visual" (color de
    terreno + densidad de hierba/props en el navegador, usado en ~12 sitios de `entry.js`) **no
    son el mismo mapa** para ningún seed ≠ el que sea que coincida por casualidad. Impacto
    práctico hoy: bajo, porque el seed por defecto (42) es casi siempre el único usado y ambos
    mapas fueron tuneados visualmente por separado contra ese seed; el riesgo aparece si algún
    día se generan mundos con seed distinto (`multiplayer.rs::seed`) — el bioma que ve el
    jugador dejaría de corresponder con el que usa el servidor. Recomendación para cuando haya
    forma de verificar visualmente: portar `pcg_hash`/`hash2to1`/`fbm` (Rust) a WGSL/JS y pasar
    el `seed` real a `biome_id`/`biomeAtJs` en vez de re-tunear umbrales sobre el hash actual.

---

*Última actualización: 2026-08-03.*
