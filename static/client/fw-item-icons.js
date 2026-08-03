/** False World — Three.js baked inventory + exact 20 Rust twig icons. v8 */
import * as THREE from "three";

const SIZE = 160;
const ITEM_IDS = [
  "wood", "stone", "rock_tool", "hatchet_tool", "build_plan", "metal", "sulfur", "hq",
  "hammer_tool", "key_lock", "tool_cupboard_item",
  "scrap", "metal_door", "satchel", "rocket", "c4", "workbench_1", "workbench_2", "workbench_3", "research_table",
  "cloth", "food", "sleeping_bag", "campfire", "box_small", "box_large",
];
/** Build radial piece ids — order independent; baked into same cache. */
const BUILD_IDS = [
  "foundation", "roof", "ramp", "stairs",
  "floor", "floor_tri", "foundation_tri", "roof_tri", "roof_ridge",
  "wall", "doorway", "window", "wall_frame", "floor_frame",
  "wall_low", "wall_half", "pillar", "floor_steps", "stairs_l", "stairs_u",
];
const IDS = ITEM_IDS.concat(BUILD_IDS);

/** Fixed GLB/mesh-rendered PNGs — skip procedural mesh bake for these. */
const STATIC_ICONS = {
  hatchet_tool: "/icons/hatchet_tool.png?v=3",
  rock_tool: "/icons/rock_tool.png?v=7",
  hammer_tool: "/icons/hammer_tool.png?v=3",
  tool_cupboard_item: "/icons/tool_cupboard_item.png?v=6",
  workbench_1: "/icons/workbench_1.png?v=4",
  workbench_2: "/icons/workbench_2.png?v=5",
  workbench_3: "/icons/workbench_3.png?v=4",
  box_large: "/icons/box_large.png?v=6",
  box_small: "/icons/box_small.png?v=6",
  research_table: "/icons/research_table.png?v=2",
};

const cache = Object.create(null);
for (const id of Object.keys(STATIC_ICONS)) {
  cache[id] = STATIC_ICONS[id];
}
let bakePromise = null;
/** @type {THREE.Texture|null} */
let blueprintMap = null;

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.05,
    flatShading: !!opts.flat,
    emissive: opts.emissive || 0x000000,
    emissiveIntensity: opts.emissiveIntensity || 0,
  });
}

function disposeObject(obj) {
  obj.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) {
      if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
      else n.material.dispose();
    }
  });
}

function meshWood() {
  const g = new THREE.Group();
  const bark = mat(0x6b4423, { roughness: 0.92, flat: true });
  const heart = mat(0xc4a574, { roughness: 0.7 });
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 1.35, 14), bark);
  log.rotation.z = Math.PI * 0.5;
  log.rotation.y = 0.35;
  const endA = new THREE.Mesh(new THREE.CircleGeometry(0.38, 18), heart);
  endA.position.set(-0.675, 0, 0);
  endA.rotation.y = Math.PI * 0.5;
  const endB = endA.clone();
  endB.position.x = 0.675;
  endB.rotation.y = -Math.PI * 0.5;
  // branch stub
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.45, 8), bark);
  stub.position.set(0.15, 0.35, 0.1);
  stub.rotation.z = -0.7;
  g.add(log, endA, endB, stub);
  g.position.y = -0.05;
  return g;
}

function meshStone() {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.62, 0),
    mat(0x7a7e86, { roughness: 0.88, flat: true })
  );
  rock.scale.set(1.15, 0.85, 1.0);
  rock.rotation.set(0.4, 0.6, 0.15);
  const pebble = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22, 0),
    mat(0x5c616a, { roughness: 0.9, flat: true })
  );
  pebble.position.set(0.45, -0.28, 0.2);
  g.add(rock, pebble);
  return g;
}

function meshPickaxe() {
  const g = new THREE.Group();
  const wood = mat(0x7a4a22, { roughness: 0.9, flat: true });
  const steel = mat(0xe8eef4, { roughness: 0.22, metalness: 0.95, flat: true });
  const steelDark = mat(0x4a5560, { roughness: 0.35, metalness: 0.9, flat: true });
  // Canonical: handle +Y, head on top (then group rotation for bake)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.095, 1.7, 8), wood);
  shaft.position.y = -0.05;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.22, 8), steelDark);
  wrap.position.y = 0.72;
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.24), steel);
  head.position.y = 0.78;
  const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.75, 7), steel);
  spike.rotation.z = -Math.PI * 0.5;
  spike.position.set(0.85, 0.78, 0);
  const adze = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.16, 0.3), steelDark);
  adze.position.set(-0.55, 0.78, 0);
  const adzeTip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 6), steel);
  adzeTip.rotation.z = Math.PI * 0.5;
  adzeTip.position.set(-0.85, 0.78, 0);
  g.add(shaft, wrap, head, spike, adze, adzeTip);
  g.rotation.set(0.35, 0.85, 0.25);
  g.scale.setScalar(0.85);
  return g;
}

function meshHatchet() {
  const g = new THREE.Group();
  const wood = mat(0x6a3e18, { roughness: 0.9, flat: true });
  const steel = mat(0xf0f4f8, { roughness: 0.18, metalness: 0.96, flat: true });
  const steelDark = mat(0x3e4852, { roughness: 0.32, metalness: 0.9, flat: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.09, 1.65, 8), wood);
  shaft.position.y = -0.05;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), wood);
  knob.position.y = -0.9;
  const poll = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), steelDark);
  poll.position.set(-0.12, 0.78, 0);
  const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.5, 0.2), steelDark);
  cheek.position.set(0.18, 0.78, 0);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.92, 0.07), steel);
  blade.position.set(0.62, 0.8, 0);
  const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.08, 0.035), steel);
  bevel.position.set(1.0, 0.82, 0);
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.05), steel);
  toe.position.set(0.85, 1.28, 0);
  toe.rotation.z = -0.4;
  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.05), steel);
  heel.position.set(0.8, 0.32, 0);
  heel.rotation.z = 0.45;
  g.add(shaft, knob, poll, cheek, blade, bevel, toe, heel);
  g.rotation.set(0.25, 0.55, -0.05);
  g.scale.setScalar(0.8);
  return g;
}

function meshHammer() {
  const g = new THREE.Group();
  const wood = mat(0x734820, { roughness: 0.88, flat: true });
  const gripMat = mat(0x9a6838, { roughness: 0.8, flat: true });
  const steel = mat(0xd4dae0, { roughness: 0.25, metalness: 0.92, flat: true });
  const steelDark = mat(0x3a424c, { roughness: 0.35, metalness: 0.9, flat: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 1.5, 8), wood);
  shaft.position.y = -0.1;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.1, 0.42, 8), gripMat);
  grip.position.y = -0.55;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.36, 0.34), steel);
  head.position.y = 0.72;
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.12, 12), steelDark);
  face.rotation.z = Math.PI * 0.5;
  face.position.set(0.48, 0.72, 0);
  const clawBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.34), steelDark);
  clawBase.position.set(-0.35, 0.78, 0);
  const clawL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.09), steel);
  clawL.position.set(-0.62, 0.92, 0.1);
  clawL.rotation.z = 0.55;
  const clawR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.11, 0.09), steel);
  clawR.position.set(-0.62, 0.92, -0.1);
  clawR.rotation.z = 0.55;
  g.add(shaft, grip, head, face, clawBase, clawL, clawR);
  g.rotation.set(0.3, 0.7, 0.15);
  g.scale.setScalar(0.9);
  return g;
}

function makeBlueprintTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 384;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);

  // Soft drop shadow
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(256, 330, 190, 28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Scroll outline (unrolled blueprint with side curls + torn top)
  const pathScroll = () => {
    ctx.beginPath();
    // bottom edge (wider, slight curve)
    ctx.moveTo(78, 300);
    ctx.quadraticCurveTo(256, 318, 434, 300);
    // right curl up
    ctx.bezierCurveTo(468, 270, 470, 200, 448, 150);
    ctx.bezierCurveTo(458, 120, 448, 88, 420, 78);
    // top edge with V-tear + jagged nicks
    ctx.lineTo(390, 72);
    ctx.lineTo(372, 86);
    ctx.lineTo(350, 70);
    ctx.lineTo(320, 78);
    ctx.lineTo(300, 68);
    // V notch
    ctx.lineTo(268, 74);
    ctx.lineTo(256, 108);
    ctx.lineTo(244, 74);
    ctx.lineTo(210, 68);
    ctx.lineTo(188, 80);
    ctx.lineTo(160, 70);
    ctx.lineTo(140, 84);
    ctx.lineTo(118, 72);
    ctx.lineTo(92, 80);
    // left curl down
    ctx.bezierCurveTo(64, 92, 54, 130, 64, 160);
    ctx.bezierCurveTo(42, 210, 44, 270, 78, 300);
    ctx.closePath();
  };

  // Fill body
  const grad = ctx.createLinearGradient(80, 60, 430, 310);
  grad.addColorStop(0, "#2458a8");
  grad.addColorStop(0.35, "#1a4a96");
  grad.addColorStop(0.55, "#163d82");
  grad.addColorStop(0.75, "#1e56a4");
  grad.addColorStop(1, "#1a458c");
  pathScroll();
  ctx.fillStyle = grad;
  ctx.fill();

  // Inner trough shadow (center darker)
  ctx.save();
  pathScroll();
  ctx.clip();
  const trough = ctx.createLinearGradient(80, 0, 430, 0);
  trough.addColorStop(0, "rgba(255,255,255,0.14)");
  trough.addColorStop(0.18, "rgba(0,0,0,0)");
  trough.addColorStop(0.5, "rgba(0,0,0,0.28)");
  trough.addColorStop(0.82, "rgba(0,0,0,0)");
  trough.addColorStop(1, "rgba(255,255,255,0.16)");
  ctx.fillStyle = trough;
  ctx.fillRect(0, 0, 512, 384);

  // Blueprint grid
  ctx.strokeStyle = "rgba(170, 210, 255, 0.55)";
  ctx.lineWidth = 1.6;
  for (let x = 100; x <= 410; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, 90);
    ctx.lineTo(x + (x - 256) * 0.04, 300);
    ctx.stroke();
  }
  for (let y = 100; y <= 290; y += 22) {
    ctx.beginPath();
    ctx.moveTo(90, y);
    ctx.lineTo(420, y + Math.sin((y - 100) * 0.04) * 4);
    ctx.stroke();
  }
  // Bold center lines
  ctx.strokeStyle = "rgba(210, 235, 255, 0.85)";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(256, 95);
  ctx.lineTo(256, 300);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(105, 195);
  ctx.lineTo(405, 195);
  ctx.stroke();

  // Curl ridge highlights
  ctx.strokeStyle = "rgba(160, 205, 255, 0.7)";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(88, 140);
  ctx.bezierCurveTo(70, 180, 72, 240, 95, 285);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(424, 140);
  ctx.bezierCurveTo(448, 180, 446, 240, 418, 285);
  ctx.stroke();

  // Tiny structure sketch (reads as "build plan")
  ctx.strokeStyle = "rgba(120, 220, 255, 0.9)";
  ctx.lineWidth = 2.2;
  ctx.strokeRect(210, 150, 90, 70);
  ctx.beginPath();
  ctx.moveTo(210, 150);
  ctx.lineTo(255, 118);
  ctx.lineTo(300, 150);
  ctx.stroke();
  ctx.strokeRect(236, 185, 22, 35);
  ctx.restore();

  // Dark outline for silhouette in slot
  pathScroll();
  ctx.strokeStyle = "rgba(8, 28, 70, 0.95)";
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  ctx.stroke();
  pathScroll();
  ctx.strokeStyle = "rgba(60, 120, 200, 0.55)";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function meshPlan() {
  // Face-on blueprint card — uses /icons/build_plan.png when loaded, else canvas art
  const g = new THREE.Group();
  const map = blueprintMap || makeBlueprintTexture();
  const paper = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const aspect = map.image && map.image.width && map.image.height
    ? map.image.width / map.image.height
    : 1.35;
  const h = 1.15;
  const w = h * aspect;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), paper);
  card.rotation.set(-0.12, 0.16, -0.06);
  g.add(card);
  g.scale.setScalar(1.08);
  return g;
}

function meshMetal() {
  const g = new THREE.Group();
  const steel = mat(0x9aa3ad, { roughness: 0.28, metalness: 0.92 });
  const ingot = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.55), steel);
  ingot.rotation.y = 0.5;
  ingot.rotation.x = 0.15;
  const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.42), mat(0xc5ced8, { roughness: 0.22, metalness: 0.95 }));
  bevel.position.copy(ingot.position);
  bevel.position.y += 0.18;
  bevel.rotation.copy(ingot.rotation);
  g.add(ingot, bevel);
  return g;
}

function meshSulfur() {
  const g = new THREE.Group();
  const yellow = mat(0xd4c84a, { roughness: 0.82, flat: true });
  const pale = mat(0xe8e070, { roughness: 0.75, flat: true });
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.55, 0), yellow);
  rock.scale.set(1.1, 0.9, 1.0);
  rock.rotation.set(0.3, 0.5, 0.1);
  const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), pale);
  chunk.position.set(0.4, -0.15, 0.15);
  g.add(rock, chunk);
  return g;
}

function meshHq() {
  const g = new THREE.Group();
  const hq = mat(0xd8e6f5, { roughness: 0.18, metalness: 0.98, emissive: 0x224466, emissiveIntensity: 0.15 });
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.28, 0.38), hq);
  bar.rotation.y = 0.55;
  bar.rotation.x = 0.12;
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(1.06, 0.06, 0.39),
    mat(0x6ec8ff, { roughness: 0.25, metalness: 0.9, emissive: 0x2288cc, emissiveIntensity: 0.45 })
  );
  stripe.position.y = 0.02;
  stripe.rotation.copy(bar.rotation);
  g.add(bar, stripe);
  return g;
}

function meshLock() {
  // Chunky padlock facing camera — gold body + silver shackle + big keyhole
  const g = new THREE.Group();
  const gold = mat(0xf0c040, { roughness: 0.28, metalness: 0.9, flat: true });
  const goldDark = mat(0xb88820, { roughness: 0.35, metalness: 0.85, flat: true });
  const silver = mat(0xe8eef4, { roughness: 0.18, metalness: 0.98, flat: true });
  const hole = mat(0x181a1e, { roughness: 0.95, flat: true });

  const bodyW = 0.88;
  const bodyH = 0.72;
  const bodyD = 0.38;
  const body = new THREE.Mesh(new THREE.BoxGeometry(bodyW, bodyH, bodyD), gold);
  body.position.y = -0.12;
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(bodyW + 0.06, bodyH + 0.06, 0.08), goldDark);
  bezel.position.set(0, -0.12, bodyD * 0.5 + 0.02);

  // Thick U-shackle (opens upward, high contrast vs body)
  const shackleR = 0.34;
  const tube = 0.13;
  const arc = new THREE.Mesh(new THREE.TorusGeometry(shackleR, tube, 10, 22, Math.PI), silver);
  arc.rotation.z = Math.PI;
  arc.position.y = 0.42;
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(tube, tube, 0.42, 10), silver);
  legL.position.set(-shackleR, 0.2, 0);
  const legR = legL.clone();
  legR.position.x = shackleR;

  // Keyhole — large, on front face
  const keyTop = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14), hole);
  keyTop.rotation.x = Math.PI * 0.5;
  keyTop.position.set(0, -0.02, bodyD * 0.5 + 0.05);
  const keyBot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.06), hole);
  keyBot.position.set(0, -0.18, bodyD * 0.5 + 0.05);

  // Side chamfer hints
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.06, bodyH * 0.9, bodyD), goldDark);
  sideL.position.set(-bodyW * 0.5 - 0.01, -0.12, 0);
  const sideR = sideL.clone();
  sideR.position.x = bodyW * 0.5 + 0.01;

  g.add(body, bezel, arc, legL, legR, keyTop, keyBot, sideL, sideR);
  g.rotation.set(0.05, 0.12, 0);
  g.scale.setScalar(1.12);
  return g;
}

function meshTcItem() {
  // Tool cupboard: wood cabinet + door frame + lock plate + tools peeking
  const g = new THREE.Group();
  const wood = mat(0x6b4a2e, { roughness: 0.78, flat: true });
  const woodDark = mat(0x3e2a1a, { roughness: 0.82, flat: true });
  const woodLite = mat(0x8a6240, { roughness: 0.72, flat: true });
  const metal = mat(0x8a929a, { roughness: 0.3, metalness: 0.9 });
  const metalDark = mat(0x4a5058, { roughness: 0.35, metalness: 0.88 });
  const steel = mat(0xc8d0d8, { roughness: 0.25, metalness: 0.95 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.2, 0.72), wood);
  // Top lid overhang
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.82), woodLite);
  lid.position.y = 0.62;
  // Base plinth
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, 0.78), woodDark);
  base.position.y = -0.6;

  // Door recess + panel
  const recess = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.85, 0.05), woodDark);
  recess.position.set(0, 0.02, 0.36);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.76, 0.06), wood);
  door.position.set(0, 0.02, 0.4);
  // Door frame rails
  const frameT = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.08), woodLite);
  frameT.position.set(0, 0.42, 0.4);
  const frameB = frameT.clone();
  frameB.position.y = -0.38;
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.86, 0.08), woodLite);
  frameL.position.set(-0.33, 0.02, 0.4);
  const frameR = frameL.clone();
  frameR.position.x = 0.33;

  // Lock plate + handle
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.28, 0.04), metal);
  plate.position.set(0.18, 0.02, 0.45);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), steel);
  knob.position.set(0.18, 0.02, 0.5);

  // Privilege / auth lamp (green)
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 10),
    mat(0x4ecf6a, { roughness: 0.35, metalness: 0.2, emissive: 0x1a8838, emissiveIntensity: 0.7 })
  );
  lamp.position.set(-0.28, 0.48, 0.42);

  // Tools peeking out the top (axe head + hammer)
  const axeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.55, 6), woodDark);
  axeHandle.position.set(-0.18, 0.85, 0.05);
  axeHandle.rotation.z = 0.25;
  const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.12), metalDark);
  axeHead.position.set(-0.08, 1.08, 0.05);
  axeHead.rotation.z = 0.25;
  const hamHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.45, 6), woodDark);
  hamHandle.position.set(0.22, 0.82, -0.08);
  hamHandle.rotation.z = -0.35;
  const hamHead = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.12), metal);
  hamHead.position.set(0.32, 1.0, -0.08);
  hamHead.rotation.z = -0.35;

  g.add(
    body, lid, base, recess, door,
    frameT, frameB, frameL, frameR,
    plate, knob, lamp,
    axeHandle, axeHead, hamHandle, hamHead
  );
  g.rotation.set(0.2, 0.55, 0.05);
  g.scale.setScalar(0.88);
  return g;
}

function meshScrap() {
  const g = new THREE.Group();
  const rust = mat(0x8a5a3a, { roughness: 0.78, metalness: 0.55 });
  const dull = mat(0x6a7058, { roughness: 0.85, metalness: 0.4 });
  for (let i = 0; i < 5; i++) {
    const flake = new THREE.Mesh(
      new THREE.BoxGeometry(0.35 + (i % 3) * 0.08, 0.05, 0.22 + (i % 2) * 0.1),
      i % 2 ? rust : dull
    );
    flake.position.set((i - 2) * 0.18, (i % 3) * 0.06 - 0.1, (i % 2) * 0.12);
    flake.rotation.set(0.2 * i, 0.5 * i, 0.3 * i);
    g.add(flake);
  }
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8), mat(0xa8b0b8, { metalness: 0.9, roughness: 0.35 }));
  bolt.rotation.z = 1.1;
  bolt.position.set(0.25, 0.15, -0.1);
  g.add(bolt);
  return g;
}

function meshMetalDoor() {
  const g = new THREE.Group();
  const steel = mat(0x5a626c, { roughness: 0.4, metalness: 0.88 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.35, 0.1), steel);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.5, 0.08), mat(0x3a4048, { roughness: 0.45, metalness: 0.8 }));
  frame.position.z = -0.06;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.16), mat(0xc9a227, { metalness: 0.9, roughness: 0.3 }));
  handle.position.set(0.28, 0, 0.1);
  const rivet = mat(0x8a929a, { metalness: 0.95, roughness: 0.25 });
  for (let y = -0.5; y <= 0.5; y += 0.5) {
    const r = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), rivet);
    r.position.set(-0.3, y, 0.06);
    g.add(r);
  }
  g.add(frame, door, handle);
  g.scale.setScalar(0.85);
  return g;
}

function meshSatchel() {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.55, 0.65),
    mat(0x6b4a2a, { roughness: 0.88 })
  );
  bag.position.y = -0.05;
  const flap = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.12, 0.7),
    mat(0x4a3218, { roughness: 0.9 })
  );
  flap.position.set(0, 0.28, 0.05);
  flap.rotation.x = -0.25;
  const strap = new THREE.Mesh(
    new THREE.TorusGeometry(0.35, 0.04, 6, 16, Math.PI),
    mat(0x3a2810, { roughness: 0.85 })
  );
  strap.rotation.x = Math.PI * 0.5;
  strap.position.y = 0.35;
  const charge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.35, 10),
    mat(0xc45a2a, { roughness: 0.55, metalness: 0.2, emissive: 0x401000, emissiveIntensity: 0.25 })
  );
  charge.rotation.z = 0.9;
  charge.position.set(0.35, 0.05, 0.35);
  g.add(bag, flap, strap, charge);
  return g;
}

function meshRocket() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 1.35, 12),
    mat(0x6a7078, { metalness: 0.75, roughness: 0.4 })
  );
  body.rotation.z = Math.PI * 0.5;
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.35, 10),
    mat(0xc45a2a, { metalness: 0.5, roughness: 0.45 })
  );
  nose.rotation.z = -Math.PI * 0.5;
  nose.position.x = 0.75;
  const fin = mat(0x3a4048, { metalness: 0.6, roughness: 0.5 });
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.02), fin);
    const a = (i / 4) * Math.PI * 2;
    f.position.set(-0.55, Math.cos(a) * 0.2, Math.sin(a) * 0.2);
    f.rotation.x = a;
    g.add(f);
  }
  g.add(body, nose);
  return g;
}

function meshC4() {
  const g = new THREE.Group();
  const brick = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.35, 0.55),
    mat(0xc9b24a, { roughness: 0.75 })
  );
  const tape = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.08, 0.58),
    mat(0x2a2a2a, { roughness: 0.9 })
  );
  tape.position.y = 0.05;
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8),
    mat(0xd8d0c0, { roughness: 0.5 })
  );
  stick.position.set(0.35, 0.28, 0);
  stick.rotation.z = 0.4;
  g.add(brick, tape, stick);
  return g;
}

function meshWorkbench(tier) {
  const t = (tier | 0) >= 1 ? (tier | 0) : 1;
  const g = new THREE.Group();
  const wood = mat(0x6b4e2e, { roughness: 0.82 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.75), wood);
  top.position.y = 0.35;
  const legMat = mat(0x4a3420, { roughness: 0.85 });
  const legs = [
    [-0.5, -0.55], [0.5, -0.55], [-0.5, 0.55], [0.5, 0.55],
  ];
  for (let i = 0; i < legs.length; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.7, 0.1), legMat);
    leg.position.set(legs[i][0] * 0.55, -0.05, legs[i][1] * 0.28);
    g.add(leg);
  }
  const vise = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.18, 0.28),
    mat(t >= 3 ? 0xb070d0 : (t >= 2 ? 0xd4883a : 0x7a828c), { metalness: 0.85, roughness: 0.35 })
  );
  vise.position.set(0.35, 0.48, 0.1);
  const anvil = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.14, 0.22),
    mat(0x4a5058, { metalness: 0.9, roughness: 0.4 })
  );
  anvil.position.set(-0.3, 0.48, -0.05);
  const badge = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.1, 0.2),
    mat(t >= 3 ? 0xa050c8 : (t >= 2 ? 0xe07020 : 0xc9a227), { metalness: 0.55, roughness: 0.4 })
  );
  badge.position.set(-0.45, 0.48, 0.22);
  g.add(top, vise, anvil, badge);
  return g;
}

function meshResearchTable() {
  const g = new THREE.Group();
  const wood = mat(0x5c4030, { roughness: 0.8 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.85), wood);
  top.position.y = 0.32;
  const leg = mat(0x3a2818, { roughness: 0.85 });
  for (const [x, z] of [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.65, 0.1), leg);
    l.position.set(x, -0.05, z);
    g.add(l);
  }
  const sheet = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.02, 0.5),
    mat(0xe8e0c8, { roughness: 0.7, emissive: 0x224466, emissiveIntensity: 0.12 })
  );
  sheet.position.set(0, 0.4, 0);
  sheet.rotation.y = 0.2;
  const scrap = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, 0.18),
    mat(0x8a5a3a, { metalness: 0.6, roughness: 0.55 })
  );
  scrap.position.set(0.35, 0.4, 0.2);
  g.add(top, sheet, scrap);
  return g;
}

function meshCloth() {
  const g = new THREE.Group();
  const cloth = mat(0xc8b898, { roughness: 0.9 });
  const fold = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.7), cloth);
  fold.rotation.y = 0.3;
  const fold2 = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.55), mat(0xa89070, { roughness: 0.88 }));
  fold2.position.set(0.05, 0.1, 0.05);
  fold2.rotation.y = -0.2;
  g.add(fold, fold2);
  return g;
}

function meshFood() {
  const g = new THREE.Group();
  const meat = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 10),
    mat(0x8a4028, { roughness: 0.7 })
  );
  meat.scale.set(1.2, 0.7, 0.9);
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), mat(0xe8e0d0, { roughness: 0.55 }));
  bone.rotation.z = 0.9;
  g.add(meat, bone);
  return g;
}

function meshSleepingBag() {
  const g = new THREE.Group();
  const bag = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.22, 0.55),
    mat(0x3a6a4a, { roughness: 0.85 })
  );
  const roll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.55, 12),
    mat(0x2a4a38, { roughness: 0.8 })
  );
  roll.rotation.z = Math.PI * 0.5;
  roll.position.set(-0.45, 0.05, 0);
  g.add(bag, roll);
  return g;
}

function meshCampfireIcon() {
  const g = new THREE.Group();
  const log = mat(0x5a3a20, { roughness: 0.9 });
  const a = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6), log);
  a.rotation.z = 0.7;
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.9, 6), log);
  b.rotation.z = -0.7;
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.55, 8),
    mat(0xff6a20, { roughness: 0.5, emissive: 0xff4400, emissiveIntensity: 0.8 })
  );
  flame.position.y = 0.35;
  g.add(a, b, flame);
  return g;
}

function meshBox(large) {
  const g = new THREE.Group();
  const s = large ? 1.15 : 0.9;
  const oak = mat(0x8a5a30, { roughness: 0.82, flat: true });
  const oakLite = mat(0xa8723c, { roughness: 0.78, flat: true });
  const oakDark = mat(0x4a2e14, { roughness: 0.88, flat: true });
  const iron = mat(0x4a4e54, { roughness: 0.4, metalness: 0.85, flat: true });
  const brass = mat(0xc9a227, { roughness: 0.35, metalness: 0.9, flat: true });
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0 * s, 0.55 * s, 0.7 * s), oak);
  body.position.y = 0.05;
  // Plank stripes (front)
  for (let i = 0; i < 3; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(0.98 * s, 0.12 * s, 0.04),
      i % 2 ? oakLite : oakDark
    );
    plank.position.set(0, -0.12 * s + i * 0.16 * s, 0.36 * s);
    g.add(plank);
  }
  // Iron bands
  const band1 = new THREE.Mesh(new THREE.BoxGeometry(1.06 * s, 0.07 * s, 0.74 * s), iron);
  band1.position.y = -0.08 * s;
  const band2 = new THREE.Mesh(new THREE.BoxGeometry(1.06 * s, 0.07 * s, 0.74 * s), iron);
  band2.position.y = 0.18 * s;
  // Lid dome (stepped)
  const lid0 = new THREE.Mesh(new THREE.BoxGeometry(1.04 * s, 0.08 * s, 0.74 * s), oakDark);
  lid0.position.y = 0.36 * s;
  const lid1 = new THREE.Mesh(new THREE.BoxGeometry(0.88 * s, 0.08 * s, 0.58 * s), oak);
  lid1.position.y = 0.44 * s;
  const lid2 = new THREE.Mesh(new THREE.BoxGeometry(0.55 * s, 0.06 * s, 0.35 * s), oakLite);
  lid2.position.y = 0.51 * s;
  // Lock
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16 * s, 0.14 * s, 0.08 * s), brass);
  lock.position.set(0, 0.22 * s, 0.4 * s);
  // Feet
  for (const [x, z] of [[-0.4, -0.28], [0.4, -0.28], [-0.4, 0.28], [0.4, 0.28]]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.1 * s, 0.1 * s), iron);
    foot.position.set(x * s, -0.28 * s, z * s);
    g.add(foot);
  }
  g.add(body, band1, band2, lid0, lid1, lid2, lock);
  g.rotation.y = 0.45;
  return g;
}

function woodMats(group) {
  // Warm timber palette; tint by build group for quick recognition
  if (group === "deck") return { plank: mat(0xb08958, { roughness: 0.78 }), dark: mat(0x6e4a28, { roughness: 0.88 }) };
  if (group === "floor") return { plank: mat(0xc4a574, { roughness: 0.72 }), dark: mat(0x7a5530, { roughness: 0.85 }) };
  if (group === "wall") return { plank: mat(0xd4b896, { roughness: 0.7 }), dark: mat(0x8a5e38, { roughness: 0.82 }) };
  if (group === "roof") return { plank: mat(0x8f6a48, { roughness: 0.75 }), dark: mat(0x5a3c28, { roughness: 0.88 }) };
  if (group === "ramp") return { plank: mat(0xc48a48, { roughness: 0.74 }), dark: mat(0x7a4a22, { roughness: 0.86 }) };
  return { plank: mat(0xb08958, { roughness: 0.78 }), dark: mat(0x6e4a28, { roughness: 0.88 }) };
}

function addBox(g, w, h, d, material, x, y, z, rx, ry, rz) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x || 0, y || 0, z || 0);
  if (rx) m.rotation.x = rx;
  if (ry) m.rotation.y = ry;
  if (rz) m.rotation.z = rz;
  g.add(m);
  return m;
}

function meshFoundation() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("deck");
  addBox(g, 1.35, 0.22, 1.35, plank, 0, 0, 0);
  addBox(g, 1.38, 0.06, 1.38, dark, 0, -0.12, 0);
  // footing posts
  for (const [x, z] of [[-0.52, -0.52], [0.52, -0.52], [-0.52, 0.52], [0.52, 0.52]]) {
    addBox(g, 0.14, 0.28, 0.14, dark, x, -0.28, z);
  }
  return g;
}

function meshFoundationTri() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("deck");
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.72);
  shape.lineTo(0.72, -0.52);
  shape.lineTo(-0.72, -0.52);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.22, bevelEnabled: false });
  const slab = new THREE.Mesh(geo, plank);
  slab.rotation.x = -Math.PI * 0.5;
  slab.position.y = 0.11;
  g.add(slab);
  const rim = new THREE.Mesh(geo, dark);
  rim.rotation.x = -Math.PI * 0.5;
  rim.position.y = -0.02;
  rim.scale.set(1.04, 1.04, 0.35);
  g.add(rim);
  return g;
}

function meshStairs() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("ramp");
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    addBox(g, 1.05, 0.14, 0.28, i % 2 ? dark : plank, 0, -0.45 + i * 0.22, 0.45 - i * 0.28);
  }
  addBox(g, 0.1, 1.15, 0.1, dark, -0.52, 0.05, 0);
  addBox(g, 0.1, 1.15, 0.1, dark, 0.52, 0.05, 0);
  return g;
}

function meshStairsL() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("ramp");
  for (let i = 0; i < 3; i++) {
    addBox(g, 0.55, 0.12, 0.28, plank, -0.25, -0.35 + i * 0.2, 0.35 - i * 0.26);
  }
  for (let i = 0; i < 3; i++) {
    addBox(g, 0.28, 0.12, 0.55, dark, 0.35 - i * 0.05, 0.2 + i * 0.2, -0.15 - i * 0.08);
  }
  return g;
}

function meshStairsU() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("ramp");
  for (let i = 0; i < 4; i++) {
    addBox(g, 0.48, 0.11, 0.25, plank, -0.3, -0.42 + i * 0.17, 0.42 - i * 0.25);
    addBox(g, 0.48, 0.11, 0.25, dark, 0.3, 0.1 + i * 0.17, -0.34 + i * 0.25);
  }
  addBox(g, 1.1, 0.1, 0.32, dark, 0, 0.04, -0.42);
  return g;
}

function meshFloorSteps() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("ramp");
  for (let i = 0; i < 3; i++) {
    addBox(g, 1.2, 0.12 + i * 0.12, 0.38, i === 1 ? dark : plank, 0, -0.28 + i * 0.06, 0.38 - i * 0.38);
  }
  return g;
}

function meshFloor() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("floor");
  addBox(g, 1.35, 0.1, 1.35, plank, 0, 0, 0);
  addBox(g, 1.35, 0.04, 0.08, dark, 0, 0.06, -0.42);
  addBox(g, 1.35, 0.04, 0.08, dark, 0, 0.06, 0);
  addBox(g, 1.35, 0.04, 0.08, dark, 0, 0.06, 0.42);
  return g;
}

function meshFloorFrame() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("floor");
  addBox(g, 1.4, 0.12, 0.24, plank, 0, 0, -0.58);
  addBox(g, 1.4, 0.12, 0.24, plank, 0, 0, 0.58);
  addBox(g, 0.24, 0.12, 0.92, dark, -0.58, 0, 0);
  addBox(g, 0.24, 0.12, 0.92, dark, 0.58, 0, 0);
  return g;
}

function meshFloorTri() {
  const g = new THREE.Group();
  const { plank } = woodMats("floor");
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.7);
  shape.lineTo(0.7, -0.5);
  shape.lineTo(-0.7, -0.5);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  const slab = new THREE.Mesh(geo, plank);
  slab.rotation.x = -Math.PI * 0.5;
  g.add(slab);
  return g;
}

function meshRoof() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("roof");
  const slab = addBox(g, 1.4, 0.1, 1.15, plank, 0, 0.15, 0, -0.42, 0, 0);
  addBox(g, 1.42, 0.05, 0.08, dark, 0, 0.42, -0.48, -0.42, 0, 0);
  addBox(g, 1.42, 0.05, 0.08, dark, 0, -0.12, 0.48, -0.42, 0, 0);
  return g;
}

function meshRoofTri() {
  const g = new THREE.Group();
  const { plank } = woodMats("roof");
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.65);
  shape.lineTo(0.68, -0.48);
  shape.lineTo(-0.68, -0.48);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false });
  const slab = new THREE.Mesh(geo, plank);
  slab.rotation.x = -Math.PI * 0.5 - 0.35;
  slab.position.y = 0.15;
  g.add(slab);
  return g;
}

function meshRoofRidge() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("roof");
  addBox(g, 1.4, 0.1, 0.82, plank, 0, 0.12, -0.3, -0.48, 0, 0);
  addBox(g, 1.4, 0.1, 0.82, plank, 0, 0.12, 0.3, 0.48, 0, 0);
  addBox(g, 1.42, 0.1, 0.12, dark, 0, 0.42, 0);
  return g;
}

function meshWall(h) {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("wall");
  const height = h ?? 1.25;
  addBox(g, 1.25, height, 0.12, plank, 0, 0, 0);
  addBox(g, 0.08, height, 0.14, dark, -0.58, 0, 0);
  addBox(g, 0.08, height, 0.14, dark, 0.58, 0, 0);
  addBox(g, 1.25, 0.07, 0.14, dark, 0, height * 0.5 - 0.04, 0);
  addBox(g, 1.25, 0.07, 0.14, dark, 0, -height * 0.5 + 0.04, 0);
  return g;
}

function meshDoorway(wide) {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("wall");
  const W = wide ? 1.4 : 1.2;
  const gap = wide ? 0.72 : 0.48;
  const side = (W - gap) * 0.5;
  addBox(g, side, 1.25, 0.12, plank, -(gap * 0.5 + side * 0.5), 0, 0);
  addBox(g, side, 1.25, 0.12, plank, gap * 0.5 + side * 0.5, 0, 0);
  addBox(g, W, 0.28, 0.12, plank, 0, 0.48, 0);
  addBox(g, 0.07, 1.25, 0.14, dark, -W * 0.5 + 0.03, 0, 0);
  addBox(g, 0.07, 1.25, 0.14, dark, W * 0.5 - 0.03, 0, 0);
  // sill
  addBox(g, gap + 0.08, 0.08, 0.16, dark, 0, -0.58, 0.02);
  if (wide) addBox(g, 0.06, 0.95, 0.1, dark, 0, -0.1, 0.02);
  return g;
}

function meshWallFrame() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("wall");
  addBox(g, 0.16, 1.3, 0.14, plank, -0.62, 0, 0);
  addBox(g, 0.16, 1.3, 0.14, plank, 0.62, 0, 0);
  addBox(g, 1.4, 0.16, 0.14, dark, 0, 0.57, 0);
  addBox(g, 1.4, 0.12, 0.14, dark, 0, -0.59, 0);
  return g;
}

function meshPillar() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("wall");
  addBox(g, 0.22, 1.45, 0.22, plank, 0, 0, 0);
  addBox(g, 0.36, 0.14, 0.36, dark, 0, 0.66, 0);
  addBox(g, 0.34, 0.14, 0.34, dark, 0, -0.66, 0);
  return g;
}

function meshWindow() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("wall");
  addBox(g, 1.2, 1.25, 0.12, plank, 0, 0, 0);
  // cut look via darker inset frame + glass
  addBox(g, 0.55, 0.48, 0.04, mat(0x7ec8e8, { roughness: 0.15, metalness: 0.2, emissive: 0x226688, emissiveIntensity: 0.25 }), 0, 0.08, 0.08);
  addBox(g, 0.62, 0.06, 0.14, dark, 0, 0.34, 0.02);
  addBox(g, 0.62, 0.06, 0.14, dark, 0, -0.18, 0.02);
  addBox(g, 0.06, 0.52, 0.14, dark, -0.28, 0.08, 0.02);
  addBox(g, 0.06, 0.52, 0.14, dark, 0.28, 0.08, 0.02);
  addBox(g, 0.06, 0.52, 0.1, dark, 0, 0.08, 0.05);
  addBox(g, 0.62, 0.06, 0.1, dark, 0, 0.08, 0.05);
  return g;
}

function meshRoofCorner() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("roof");
  const a = addBox(g, 1.0, 0.1, 0.85, plank, -0.15, 0.2, 0.1, -0.4, 0.55, 0);
  const b = addBox(g, 1.0, 0.1, 0.85, dark, 0.15, 0.2, -0.1, -0.4, -0.55, 0);
  return g;
}

function meshRoofValley() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("roof");
  addBox(g, 1.05, 0.1, 0.8, plank, -0.22, 0.25, 0, 0.38, 0.2, 0);
  addBox(g, 1.05, 0.1, 0.8, dark, 0.22, 0.25, 0, 0.38, -0.2, 0);
  return g;
}

function meshRamp() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("ramp");
  addBox(g, 1.15, 0.12, 1.45, plank, 0, 0, 0, -0.55, 0, 0);
  addBox(g, 0.1, 0.12, 1.45, dark, -0.55, 0.02, 0, -0.55, 0, 0);
  addBox(g, 0.1, 0.12, 1.45, dark, 0.55, 0.02, 0, -0.55, 0, 0);
  return g;
}

function meshRoofWall() {
  const g = new THREE.Group();
  const { plank, dark } = woodMats("wall");
  const shape = new THREE.Shape();
  shape.moveTo(-0.7, -0.55);
  shape.lineTo(0.7, -0.55);
  shape.lineTo(0, 0.65);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
  const wall = new THREE.Mesh(geo, plank);
  wall.position.z = -0.06;
  g.add(wall);
  addBox(g, 0.08, 1.15, 0.14, dark, -0.55, -0.05, 0.02, 0, 0, 0.35);
  addBox(g, 0.08, 1.15, 0.14, dark, 0.55, -0.05, 0.02, 0, 0, -0.35);
  return g;
}

function meshDoorPiece() {
  const g = new THREE.Group();
  const wood = mat(0x8a5a32, { roughness: 0.72 });
  const dark = mat(0x5a3a1e, { roughness: 0.85 });
  const metal = mat(0xc9a227, { roughness: 0.35, metalness: 0.85 });
  addBox(g, 0.72, 1.35, 0.1, wood, 0, 0, 0);
  addBox(g, 0.08, 1.35, 0.12, dark, -0.32, 0, 0.02);
  addBox(g, 0.08, 1.35, 0.12, dark, 0.32, 0, 0.02);
  addBox(g, 0.72, 0.08, 0.12, dark, 0, 0.58, 0.02);
  addBox(g, 0.72, 0.08, 0.12, dark, 0, -0.58, 0.02);
  addBox(g, 0.72, 0.05, 0.12, dark, 0, 0, 0.02);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), metal);
  knob.position.set(0.22, 0, 0.1);
  g.add(knob);
  return g;
}

function buildMesh(id) {
  switch (id) {
    case "wood": return meshWood();
    case "stone": return meshStone();
    case "rock_tool": return meshPickaxe();
    case "hatchet_tool": return meshHatchet();
    case "build_plan": return meshPlan();
    case "metal": return meshMetal();
    case "sulfur": return meshSulfur();
    case "hq": return meshHq();
    case "hammer_tool": return meshHammer();
    case "key_lock": return meshLock();
    case "tool_cupboard_item": return meshTcItem();
    case "scrap": return meshScrap();
    case "metal_door": return meshMetalDoor();
    case "satchel": return meshSatchel();
    case "rocket": return meshRocket();
    case "c4": return meshC4();
    case "workbench_1": return meshWorkbench(1);
    case "workbench_2": return meshWorkbench(2);
    case "workbench_3": return meshWorkbench(3);
    case "research_table": return meshResearchTable();
    case "cloth": return meshCloth();
    case "food": return meshFood();
    case "sleeping_bag": return meshSleepingBag();
    case "campfire": return meshCampfireIcon();
    case "box_small": return meshBox(false);
    case "box_large": return meshBox(true);
    case "foundation": return meshFoundation();
    case "foundation_tri": return meshFoundationTri();
    case "stairs": return meshStairs();
    case "stairs_l": return meshStairsL();
    case "stairs_u": return meshStairsU();
    case "floor_steps": return meshFloorSteps();
    case "floor": return meshFloor();
    case "floor_tri": return meshFloorTri();
    case "floor_frame": return meshFloorFrame();
    case "roof": return meshRoof();
    case "roof_tri": return meshRoofTri();
    case "roof_ridge": return meshRoofRidge();
    case "wall": return meshWall(1.25);
    case "wall_half": return meshWall(0.72);
    case "wall_low": return meshWall(0.42);
    case "pillar": return meshPillar();
    case "doorway": return meshDoorway(false);
    case "wall_frame": return meshWallFrame();
    case "doorway_d": return meshDoorway(true);
    case "window": return meshWindow();
    case "roof_corner": return meshRoofCorner();
    case "roof_valley": return meshRoofValley();
    case "ramp": return meshRamp();
    case "roof_wall": return meshRoofWall();
    case "door": return meshDoorPiece();
    default: return meshStone();
  }
}

function fitCameraToObject(camera, object, offset = 1.55) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.position.sub(center);
  const maxDim = Math.max(size.x, size.y, size.z, 0.2);
  const dist = maxDim * offset;
  camera.position.set(dist * 0.85, dist * 0.72, dist * 1.05);
  camera.near = Math.max(0.02, dist / 40);
  camera.far = dist * 20;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
}

/** Tighter framing for small-slot readability */
const ICON_ZOOM = {
  build_plan: 1.45,
  key_lock: 1.32,
};

async function bakeAll() {
  if (typeof document === "undefined") return cache;

  if (!blueprintMap) {
    try {
      const tex = await new THREE.TextureLoader().loadAsync("/icons/build_plan.png");
      if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      blueprintMap = tex;
    } catch (err) {
      console.warn("[FW icons] build_plan.png", err);
      blueprintMap = null;
    }
  }


  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);

  scene.add(new THREE.HemisphereLight(0xf5f7ff, 0x3a2818, 1.15));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.1);
  key.position.set(2.5, 5, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.55);
  fill.position.set(-3, 1.5, -2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 0.35);
  rim.position.set(-1, 3, -4);
  scene.add(rim);

  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    if (STATIC_ICONS[id]) continue;
    try {
      const mesh = buildMesh(id);
      scene.add(mesh);
      fitCameraToObject(camera, mesh, ICON_ZOOM[id] || (BUILD_IDS.includes(id) ? 1.7 : 1.55));
      renderer.render(scene, camera);
      cache[id] = canvas.toDataURL("image/png");
      scene.remove(mesh);
      disposeObject(mesh);
    } catch (err) {
      console.warn("[FW icons] bake", id, err);
    }
  }

  renderer.dispose();
  return cache;
}

const api = {
  ids: IDS.slice(),
  buildIds: BUILD_IDS.slice(),
  ready() {
    if (!bakePromise) {
      // Wrap so sync WebGL/mesh throws become rejections (not uncaught assigns).
      bakePromise = Promise.resolve()
        .then(() => bakeAll())
        .catch((err) => {
          console.warn("[FW icons]", err);
          return cache;
        });
    }
    return bakePromise;
  },
  url(id) {
    return cache[id] || null;
  },
  has(id) {
    return !!cache[id];
  },
};

window.FalseWorldItemIcons = api;
// Kick off bake ASAP so inventory mount always finds urls.
api.ready();
export default api;
