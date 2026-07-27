/** False World — Three.js baked inventory icons (realistic mini renders). */
import * as THREE from "three";

const SIZE = 160;
const IDS = [
  "wood", "stone", "rock_tool", "build_plan", "metal", "sulfur", "hq",
  "hammer_tool", "key_lock", "tool_cupboard_item",
  "scrap", "metal_door", "satchel", "rocket", "c4", "workbench_1", "workbench_2", "workbench_3", "research_table",
  "cloth", "food", "sleeping_bag", "campfire", "box_small", "box_large",
];

const cache = Object.create(null);
let bakePromise = null;

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
  const wood = mat(0x8b5a2b, { roughness: 0.85 });
  const steel = mat(0xb8c0c8, { roughness: 0.35, metalness: 0.85 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.55, 10), wood);
  handle.rotation.z = 0.45;
  handle.position.set(-0.15, -0.1, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.18, 0.22), steel);
  head.position.set(0.42, 0.48, 0);
  head.rotation.z = 0.45;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 8), steel);
  tip.position.set(0.78, 0.72, 0);
  tip.rotation.z = -1.1;
  const butt = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), steel);
  butt.position.set(0.08, 0.28, 0);
  butt.rotation.z = 0.45;
  g.add(handle, head, tip, butt);
  g.scale.setScalar(0.95);
  return g;
}

function meshPlan() {
  const g = new THREE.Group();
  const plate = new THREE.Group();
  plate.rotation.x = -0.55;
  plate.rotation.y = 0.35;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.06, 1.35),
    mat(0x2a6fb3, { roughness: 0.45, metalness: 0.15, emissive: 0x0a2040, emissiveIntensity: 0.25 })
  );
  plate.add(board);
  const lineMat = mat(0xd7e9ff, { roughness: 0.4, metalness: 0.2, emissive: 0x88b8ff, emissiveIntensity: 0.35 });
  for (let i = -2; i <= 2; i++) {
    const hx = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.02, 0.025), lineMat);
    hx.position.set(0, 0.045, i * 0.24);
    const hz = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 1.25), lineMat);
    hz.position.set(i * 0.2, 0.045, 0);
    plate.add(hx, hz);
  }
  g.add(plate);
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.12, 0.45),
    mat(0x9ad0ff, { roughness: 0.3, metalness: 0.1, emissive: 0x3a80c0, emissiveIntensity: 0.4 })
  );
  ghost.position.set(0.15, 0.35, -0.1);
  ghost.rotation.y = 0.35;
  g.add(ghost);
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

function meshHammer() {
  const g = new THREE.Group();
  const wood = mat(0x8b5a2b, { roughness: 0.85 });
  const steel = mat(0xb8c0c8, { roughness: 0.3, metalness: 0.9 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.2, 10), wood);
  handle.rotation.z = 0.35;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.28, 0.28), steel);
  head.position.set(0.35, 0.45, 0);
  head.rotation.z = 0.35;
  const claw = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.1), steel);
  claw.position.set(0.55, 0.55, 0);
  claw.rotation.z = 0.9;
  g.add(handle, head, claw);
  return g;
}

function meshLock() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.55, 0.28),
    mat(0xc9a227, { roughness: 0.35, metalness: 0.85 })
  );
  const shackle = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.07, 8, 16, Math.PI),
    mat(0xd4d8de, { roughness: 0.25, metalness: 0.95 })
  );
  shackle.rotation.x = Math.PI * 0.5;
  shackle.position.y = 0.35;
  g.add(body, shackle);
  return g;
}

function meshTcItem() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 1.15, 0.7),
    mat(0x5a4030, { roughness: 0.75 })
  );
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.7, 0.06),
    mat(0x3a2a1e, { roughness: 0.7 })
  );
  door.position.set(0, 0.05, 0.38);
  g.add(box, door);
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
  const t = tier | 1;
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
  const wood = mat(large ? 0x6a4a2a : 0x7a5a35, { roughness: 0.8 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(large ? 1.1 : 0.85, large ? 0.7 : 0.5, large ? 0.75 : 0.55), wood);
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(large ? 1.12 : 0.87, 0.06, large ? 0.77 : 0.57),
    mat(0x5a3a1e, { roughness: 0.75 })
  );
  lid.position.y = large ? 0.38 : 0.28;
  g.add(box, lid);
  return g;
}

function buildMesh(id) {
  switch (id) {
    case "wood": return meshWood();
    case "stone": return meshStone();
    case "rock_tool": return meshPickaxe();
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
    default: return meshStone();
  }
}

function bakeAll() {
  if (typeof document === "undefined") return Promise.resolve(cache);

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
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
  camera.position.set(1.75, 1.4, 2.25);
  camera.lookAt(0, 0.1, 0);

  scene.add(new THREE.HemisphereLight(0xf5f7ff, 0x3a2818, 1.15));
  const key = new THREE.DirectionalLight(0xfff1dc, 2.1);
  key.position.set(2.5, 5, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xa8c8ff, 0.55);
  fill.position.set(-3, 1.5, -2);
  scene.add(fill);

  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i];
    const mesh = buildMesh(id);
    scene.add(mesh);
    renderer.render(scene, camera);
    cache[id] = canvas.toDataURL("image/png");
    scene.remove(mesh);
    disposeObject(mesh);
  }

  renderer.dispose();
  return Promise.resolve(cache);
}

const api = {
  ids: IDS.slice(),
  ready() {
    if (!bakePromise) bakePromise = bakeAll().catch((err) => {
      console.warn("[FW icons]", err);
      return cache;
    });
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
export default api;
