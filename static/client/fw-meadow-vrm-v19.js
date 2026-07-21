/**
 * False World — VRM overlay v19 (ground snap: plant feet on terrain).
 * fetchWithCache → GLTFLoader.parse → idle reveal, then create() resolves.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

THREE.Cache.enabled = true;

const MIXAMO_VRM_RIG = {
  mixamorigHips: "hips",
  mixamorigSpine: "spine",
  mixamorigSpine1: "chest",
  mixamorigSpine2: "upperChest",
  mixamorigNeck: "neck",
  mixamorigHead: "head",
  mixamorigLeftShoulder: "leftShoulder",
  mixamorigLeftArm: "leftUpperArm",
  mixamorigLeftForeArm: "leftLowerArm",
  mixamorigLeftHand: "leftHand",
  mixamorigRightShoulder: "rightShoulder",
  mixamorigRightArm: "rightUpperArm",
  mixamorigRightForeArm: "rightLowerArm",
  mixamorigRightHand: "rightHand",
  mixamorigLeftUpLeg: "leftUpperLeg",
  mixamorigLeftLeg: "leftLowerLeg",
  mixamorigLeftFoot: "leftFoot",
  mixamorigLeftToeBase: "leftToes",
  mixamorigRightUpLeg: "rightUpperLeg",
  mixamorigRightLeg: "rightLowerLeg",
  mixamorigRightFoot: "rightFoot",
  mixamorigRightToeBase: "rightToes",
};

const DEFAULTS = {
  vrmUrl: "/avatars/sophia.vrm",
  idleUrl: "/animaciones/StandingIdle.fbx",
  walkUrl: "/animaciones/Walking.fbx",
};

/** VRMedia avatarCache raw store — evita re-descargas del VRM (~24MB). */
const rawCache = new Map();

function normalizeUrl(url) {
  try {
    return new URL(url, location.origin).pathname;
  } catch (_) {
    return url;
  }
}

function yieldFrame() {
  return new Promise((r) => setTimeout(r, 0));
}

function parseWithTimeout(fn) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(fn());
      } catch (e) {
        reject(e);
      }
    }, 0);
  });
}

/**
 * VRMedia `fetchWithCache`: stream ArrayBuffer, cache hit → 100%.
 * No yield durante download (eso + WebGPU colgaba el progreso en ~2%).
 * Progress throttled (~cada 4% o 120ms) para no saturar el gate UI.
 */
async function fetchWithCache(url, onPct) {
  const key = normalizeUrl(url);
  const hit = rawCache.get(key);
  if (hit) {
    onPct && onPct(100);
    return hit;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " → " + res.status);

  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body) {
    const buf = await res.arrayBuffer();
    rawCache.set(key, buf);
    onPct && onPct(100);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  let lastPct = -1;
  let lastUi = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    if (onPct && total > 0) {
      const pct = Math.min(99, Math.round((100 * loaded) / total));
      const now = performance.now();
      if (pct >= lastPct + 4 || now - lastUi > 120) {
        lastPct = pct;
        lastUi = now;
        onPct(pct);
      }
    }
  }

  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  const buffer = out.buffer;
  rawCache.set(key, buffer);
  onPct && onPct(100);
  return buffer;
}

/** FBX: VRMedia `fetchArrayBuffer` — sin raw cache pesado, sin progress spam. */
async function fetchArrayBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " → " + res.status);
  return res.arrayBuffer();
}

function processMixamoClip(asset, vrm) {
  let clip = THREE.AnimationClip.findByName(asset.animations, "mixamo.com");
  if (!clip && asset.animations.length) clip = asset.animations[0];
  if (!clip) throw new Error("FBX sin clips");

  const tracks = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const quatA = new THREE.Quaternion();
  const vec3 = new THREE.Vector3();

  const motionHipsHeight = asset.getObjectByName("mixamorigHips")?.position.y ?? 0;
  const hipsBone = vrm.humanoid?.getNormalizedBoneNode("hips");
  const vrmHipsY = hipsBone ? hipsBone.getWorldPosition(vec3).y : 0;
  const vrmRootY = vrm.scene.getWorldPosition(vec3).y;
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY) || 1;
  const hipsPositionScale = motionHipsHeight > 0 ? vrmHipsHeight / motionHipsHeight : 1;

  for (const track of clip.tracks) {
    const parts = track.name.split(".");
    const mixamoRigName = parts[0];
    const vrmBoneName = MIXAMO_VRM_RIG[mixamoRigName];
    const vrmNodeName = vrm.humanoid?.getNormalizedBoneNode(vrmBoneName)?.name;
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);
    if (!vrmNodeName || !mixamoRigNode?.parent) continue;

    const propertyName = parts[1];
    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = track.values.slice();
      for (let i = 0; i < values.length; i += 4) {
        quatA.fromArray(values, i);
        quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        quatA.toArray(values, i);
      }
      const flipped = values.map((v, i) =>
        vrm.meta?.metaVersion === "0" && i % 2 === 0 ? -v : v
      );
      tracks.push(
        new THREE.QuaternionKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, flipped)
      );
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      const value = track.values.map((v, i) => {
        if (vrmBoneName === "hips" && i % 3 === 1) return vrmHipsHeight;
        return (vrm.meta?.metaVersion === "0" && i % 3 !== 1 ? -v : v) * hipsPositionScale;
      });
      tracks.push(
        new THREE.VectorKeyframeTrack(`${vrmNodeName}.${propertyName}`, track.times, value)
      );
    }
  }
  return new THREE.AnimationClip("vrmAnimation", clip.duration, tracks);
}

function warmPose(mixer, vrm) {
  try {
    mixer.update(1 / 60);
    vrm.update(1 / 60);
    mixer.update(0);
    vrm.update(0);
  } catch (_) {}
}

async function create(canvas, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const getPose = opts.getPose;
  const onProgress = opts.onProgress || (() => {});
  if (!getPose) throw new Error("getPose requerido");

  onProgress("VRM · init WebGL…");
  await yieldFrame();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "default",
    failIfMajorPerformanceCaveat: false,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  // WebGPU + WebGL share the GPU — recover when context is lost.
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    console.warn("[VRM] webgl context lost");
  }, false);
  canvas.addEventListener("webglcontextrestored", () => {
    console.warn("[VRM] webgl context restored — resize");
    try { resize(); } catch (_) {}
  }, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  // Same lighting idea as VRMedia /view studio
  scene.add(new THREE.AmbientLight(0x606880, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight(0xa0d8ff, 1.0);
  rim.position.set(-2, 2, -2);
  const fill = new THREE.DirectionalLight(0x80a0c0, 0.7);
  fill.position.set(0, 2, -3);
  scene.add(key, rim, fill);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  onProgress("VRM · descargando…");
  const arrayBuffer = await fetchWithCache(opts.vrmUrl, (pct) =>
    onProgress("VRM · " + pct + "%")
  );

  // ---- Scene + rAF tick while we parse (VRMedia: fetch then parse in same loadVRM). ----
  let alive = true;
  let raf = 0;
  let last = performance.now();
  let playable = false;
  let vrm = null;
  let mixer = null;
  let idle = null;
  let walk = null;
  let walkBlend = 0; // 0 = idle, 1 = walk — never reset clip time
  let modelReady = false;

  function syncAnimWeights(moving, dt) {
    if (!idle || !walk) return;
    const target = moving ? 1 : 0;
    // smooth blend; both clips keep playing so walk resumes mid-stride
    walkBlend += (target - walkBlend) * Math.min(1, dt * 10);
    if (walkBlend < 0.001) walkBlend = 0;
    if (walkBlend > 0.999) walkBlend = 1;
    idle.enabled = true;
    walk.enabled = true;
    idle.paused = false;
    walk.paused = false;
    if (!idle.isRunning()) idle.play();
    if (!walk.isRunning()) walk.play();
    idle.setEffectiveWeight(1 - walkBlend);
    walk.setEffectiveWeight(walkBlend);
  }

  function applyVisibility() {
    if (!vrm) return;
    const pose = getPose && getPose();
    const hide = !playable || !modelReady || pose?.camMode === "fpv";
    vrm.scene.visible = !hide;
  }

  function resize() {
    const parent = canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 640));
    const h = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 480));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement || canvas);
  }

  // Do NOT start rAF until parse finishes — competing with GLTF texture
  // upload on the same GPU was hanging loader.parse forever.

  function plantFeetOnGround(groundY) {
    // After anim update: snap lowest mesh point to terrain (fixes Mixamo/VRM float)
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    if (!Number.isFinite(box.min.y)) return;
    // Sink a hair into the ground so shoes read as planted in grass
    const sink = 0.02;
    vrm.scene.position.y += groundY - box.min.y - sink;
  }

  function tick() {
    if (!alive) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const pose = getPose();
    let groundY = 0;
    if (pose && vrm && modelReady) {
      camera.fov = pose.fovDeg || 55;
      camera.aspect = pose.aspect || camera.aspect;
      camera.updateProjectionMatrix();
      camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);

      applyVisibility();
      if (vrm.scene.visible) {
        groundY = pose.y;
        // Provisional plant; corrected after mixer/vrm update via bbox
        vrm.scene.position.set(pose.x, groundY, pose.z);
        vrm.scene.rotation.y = pose.yaw + Math.PI;
        syncAnimWeights(!!pose.moving, dt);
      }
    }

    if (mixer) mixer.update(dt);
    if (vrm) vrm.update(dt);
    if (pose && vrm && modelReady && vrm.scene.visible) {
      plantFeetOnGround(groundY);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }

  async function loadFbxClip(url, label) {
    onProgress("Anim · " + label + "…");
    await yieldFrame();
    const buf = await fetchArrayBuffer(url);
    await yieldFrame();
    const fbxLoader = new FBXLoader();
    const asset = await parseWithTimeout(() => fbxLoader.parse(buf, ""));
    await yieldFrame();
    return processMixamoClip(asset, vrm);
  }

  // VRMedia: parse after fetch. Hard cap — never block the app forever.
  onProgress("VRM · parseando…");
  await yieldFrame();
  await new Promise((r) => requestAnimationFrame(r));

  const PARSE_MS = 12000;
  const parsePromise = (typeof loader.parseAsync === "function")
    ? loader.parseAsync(arrayBuffer, "")
    : new Promise((resolve, reject) => {
        loader.parse(arrayBuffer, "", resolve, reject);
      });

  const gltf = await Promise.race([
    parsePromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("VRM parse timeout")), PARSE_MS)
    ),
  ]);

  const parsed = gltf.userData.vrm;
  if (!parsed) throw new Error("VRM data not found");
  vrm = parsed;
  vrm.scene.visible = false;
  try {
    if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
  } catch (_) {}
  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });
  vrm.scene.rotation.y = Math.PI;
  scene.add(vrm.scene);
  mixer = new THREE.AnimationMixer(vrm.scene);

  try {
    const idleClip = await loadFbxClip(opts.idleUrl, "idle");
    idle = mixer.clipAction(idleClip);
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.setEffectiveWeight(1);
    idle.play();
    warmPose(mixer, vrm);
    vrm.scene.visible = false;
    onProgress("VRM · idle listo");
  } catch (ae) {
    console.warn("[VRM] idle failed", ae);
    onProgress("VRM sin idle");
  }

  try {
    const walkClip = await loadFbxClip(opts.walkUrl, "walk");
    walk = mixer.clipAction(walkClip);
    walk.setLoop(THREE.LoopRepeat, Infinity);
    walk.setEffectiveWeight(0);
    walk.play(); // keep time running under weight 0 for seamless resume
  } catch (we) {
    console.warn("[VRM] walk skip", we);
  }

  modelReady = true;
  applyVisibility();
  onProgress("VRM · listo");
  last = performance.now();
  raf = requestAnimationFrame(tick);

  return {
    whenReady: () => Promise.resolve(),
    startParse() {
      return Promise.resolve();
    },
    setPlayable(on) {
      playable = !!on;
      applyVisibility();
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      try {
        ro && ro.disconnect();
      } catch (_) {}
      try {
        if (mixer) mixer.stopAllAction();
        if (vrm) {
          scene.remove(vrm.scene);
          VRMUtils.deepDispose?.(vrm.scene);
        }
        renderer.dispose();
      } catch (_) {}
    },
  };
}

window.FalseWorldVrm = { create };
