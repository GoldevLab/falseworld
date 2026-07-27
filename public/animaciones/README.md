# Animaciones False World (Mixamo FBX)

## Incluidas
- Locomoción: `StandingIdle`, `Walking`, `FastRun`, `Jump`, `StandingJump`, `CrouchIdle`, `CrouchWalk`
- Natación: `Swim`, `SwimIdle` (provisionales)
- Combate / gather:
  - `Attack.fbx` — melee genérico
  - `Chop.fbx` — cortar árboles (hacha) · placeholder = Attack hasta descargar Mixamo
  - `Mine.fbx` — picar rocas/mineral · **Overhead Bashing Swing** (Mixamo)
  - `Gather.fbx` — recoger del suelo

## Mixamo recomendados (hacha / pico)

Busca en [mixamo.com](https://www.mixamo.com) (sin props de arma; el juego aún no adjunta mesh de herramienta):

| Archivo | Nombre exacto en Mixamo | Uso |
|---------|-------------------------|-----|
| `Chop.fbx` | **Standing Melee Attack Horizontal** | Hachazo lateral a árboles |
| `Chop.fbx` (alt) | Standing Melee Attack Horizontal Combo | Variante combo |
| `Mine.fbx` | **Overhead Bashing Swing** | Pico / golpe vertical (ya instalado) |
| `Mine.fbx` (alt) | **Standing Melee Attack Downward** | Pico clásico hacia abajo |
| `Gather.fbx` | Gathering Objects / Planting a Plant | Recoger loot |

## Descargar con el script
1. Entra a mixamo.com (Adobe) y elige un personaje base
2. Descarga una animación → Network → copia `character_id` del POST export
3. Edita `downloadGameAnims.js` → pega el id en `character`
4. Consola del navegador → pega el script → Enter
5. Mueve los `.fbx` descargados a esta carpeta (sobrescribe `Chop.fbx` / `Mine.fbx`)

Export Mixamo: **Without Skin**, FPS 30, In Place.
