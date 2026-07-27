/**
 * Mixamo — descarga animaciones de juego False World (locomoción / combate / gather)
 *
 * Uso (consola de https://www.mixamo.com, sesión Adobe):
 * 1. Elige UN personaje base
 * 2. Descarga una animación → Network → copia character_id del POST export
 * 3. Pega character_id en `character` abajo
 * 4. F12 → Consola → pega TODO este script → Enter
 * 5. Permite descargas múltiples en Chrome
 * 6. Mueve/renombra los .fbx a falseworld/public/animaciones/ (ver renameAfterDownload)
 *
 * Basado en el flujo vrmedia (gnuton/mixamo_download_script).
 */

const character = "PEGA_AQUI_TU_CHARACTER_ID";
const DELAY_MS = 1400;

/** exact Mixamo names → filename en falseworld/public/animaciones/ */
const GAME_ANIMS = [
  { name: "Jumping", file: "Jump.fbx" },
  { name: "Standing Jumping", file: "StandingJump.fbx" },
  { name: "Crouching Idle", file: "CrouchIdle.fbx" },
  { name: "Crouch Idle", file: "CrouchIdle.fbx" },
  { name: "Crouched Walking", file: "CrouchWalk.fbx" },
  { name: "Crouching", file: "CrouchIdle.fbx" },
  { name: "Swimming", file: "Swim.fbx" },
  { name: "Treading Water", file: "SwimIdle.fbx" },
  { name: "Gathering Objects", file: "Gather.fbx" },
  { name: "Planting a Plant", file: "Gather.fbx" },
  // Hacha (árboles) — swing lateral
  { name: "Standing Melee Attack Horizontal", file: "Chop.fbx" },
  { name: "Standing Melee Attack Horizontal Combo", file: "Chop.fbx" },
  // Pico (rocas / metal / azufre) — golpe vertical
  { name: "Overhead Bashing Swing", file: "Mine.fbx" },
  { name: "Standing Melee Attack Downward", file: "Mine.fbx" },
  { name: "Punching", file: "Attack.fbx" },
  { name: "Right Hook", file: "Attack.fbx" },
];

const bearer = localStorage.access_token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getProduct(animName) {
  const q = encodeURIComponent(animName);
  const res = await fetch(
    `https://www.mixamo.com/api/v1/products?page=1&limit=10&order=&type=Motion%2CMotionPack&query=${q}`,
    { headers: { Authorization: `Bearer ${bearer}` } }
  );
  const data = await res.json();
  const results = data?.results || [];
  const exact = results.find(
    (r) => (r.description || r.name || "").toLowerCase() === animName.toLowerCase()
  );
  return exact || results[0] || null;
}

async function exportAnim(product, preferredName) {
  const id = product.id;
  const gmType = product.type || "Motion";
  const body = {
    character_id: character,
    product_name: preferredName || product.description || product.name,
    type: gmType,
    gms_hash: product.details?.gms_hash || product.gms_hash,
  };
  const res = await fetch("https://www.mixamo.com/api/v1/animations/export", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("export " + res.status);
  return res.json();
}

async function pollDownload(job) {
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const res = await fetch(
      `https://www.mixamo.com/api/v1/characters/${character}/monitor`,
      { headers: { Authorization: `Bearer ${bearer}` } }
    );
    const data = await res.json();
    const status = data?.status || data?.job_result?.status;
    if (status === "completed" || data?.job_status === "completed") {
      const url =
        data?.download_url ||
        data?.job_result?.download_url ||
        data?.uuid &&
          `https://www.mixamo.com/api/v1/characters/${character}/download/${data.uuid}`;
      if (url) return url;
    }
    if (status === "failed") throw new Error("job failed");
  }
  throw new Error("timeout");
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

(async () => {
  if (!bearer) {
    console.error("[FW Mixamo] No access_token — inicia sesión en mixamo.com");
    return;
  }
  if (!character || character.includes("PEGA_AQUI")) {
    console.error("[FW Mixamo] Pega tu character_id en `character`");
    return;
  }
  console.log("[FW Mixamo] Descargando", GAME_ANIMS.length, "animaciones…");
  const got = new Set();
  for (const entry of GAME_ANIMS) {
    if (got.has(entry.file)) continue;
    try {
      console.log("→", entry.name, "→", entry.file);
      const product = await getProduct(entry.name);
      if (!product) {
        console.warn("  no encontrado:", entry.name);
        continue;
      }
      const job = await exportAnim(product, entry.name);
      const url = await pollDownload(job);
      triggerDownload(url, entry.file);
      got.add(entry.file);
      console.log("  OK", entry.file);
    } catch (e) {
      console.warn("  fail", entry.name, e);
    }
    await sleep(DELAY_MS);
  }
  console.log("[FW Mixamo] Listo. Mueve los .fbx a falseworld/public/animaciones/");
  console.log("Archivos:", [...got].join(", "));
})();
