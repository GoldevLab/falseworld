/**
 * False World — VRM overlay v8 (parse after loading gate).
 * Download during LOADING; startParse() only after START is shown.
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
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  // Same lighting idea as VRMedia /view studio
  scene.add(new THREE.AmbientLight(0x404040, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(2, 4, 3);
  const rim = new THREE.DirectionalLight(0x88c8ff, 0.7);
  rim.position.set(-2, 2, -2);
  const fill = new THREE.DirectionalLight(0x6080a0, 0.4);
  fill.position.set(0, 2, -3);
  scene.add(key, rim, fill);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  onProgress("VRM · descargando…");
  const arrayBuffer = await fetchWithCache(opts.vrmUrl, (pct) =>
    onProgress("VRM · " + pct + "%")
  );

  // ---- Return ASAP after download. Parse is sync-heavy (~24MB) and froze the gate at 100%. ----
  let alive = true;
  let raf = 0;
  let last = performance.now();
  let playable = false;
  let vrm = null;
  let mixer = null;
  let idle = null;
  let walk = null;
  let gait = "idle";
  let modelReady = false;

  function setGait(next) {
    if (!idle || !walk || next === gait) return;
    if (next === "walk") {
      walk.reset().fadeIn(0.18).play();
      idle.fadeOut(0.18);
    } else {
      idle.reset().fadeIn(0.22).play();
      walk.fadeOut(0.18);
    }
    gait = next;
  }

  function applyVisibility() {
    if (!vrm) return;
    const pose = getPose && getPose();
    const hide = !playable || !modelReady || pose?.camMode === "fpv";
    vrm.scene.visible = !hide;
    if (vrm.scene.visible && mixer) warmPose(mixer, vrm);
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

  function tick() {
    if (!alive) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const pose = getPose();
    if (pose && vrm && modelReady) {
      camera.fov = pose.fovDeg || 55;
      camera.aspect = pose.aspect || camera.aspect;
      camera.updateProjectionMatrix();
      camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);

      applyVisibility();
      if (vrm.scene.visible) {
        vrm.scene.position.set(pose.x, pose.y + 0.02, pose.z);
        vrm.scene.rotation.y = pose.yaw + Math.PI;
        setGait(pose.moving ? "walk" : "idle");
      }
    }

    if (mixer) mixer.update(dt);
    if (vrm) vrm.update(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

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

  async function finishHeavyWork() {
    // Let the loading gate paint & advance to CALIBRATING / START
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    onProgress("VRM · parseando…");
    await yieldFrame();

    const gltf = await new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          loader.parse(arrayBuffer, "", resolve, reject);
        } catch (e) {
          reject(e);
        }
      }, 0);
    });

    const parsed = gltf.userData.vrm;
    if (!parsed) throw new Error("VRM data not found");
    vrm = parsed;
    vrm.scene.visible = false;
    // skip removeUnnecessaryVertices — slow on big VRM; VRMedia often defers it
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
    } catch (we) {
      console.warn("[VRM] walk skip", we);
    }

    modelReady = true;
    applyVisibility();
    onProgress("VRM · listo");
  }

  // Parse ONLY when index calls startParse() after [ START ] is shown.
  // Auto-parse during CALIBRATING blocked the main thread → gate frozen at ~85%.
  let heavy = null;
  function startParse() {
    if (heavy) return heavy;
    heavy = finishHeavyWork().catch((e) => {
      console.error("[VRM] parse/anim", e);
      onProgress("VRM error · " + (e && e.message ? e.message : e));
    });
    return heavy;
  }

  onProgress("VRM · descargado");
  return {
    whenReady: () => (heavy ? heavy : Promise.resolve()),
    startParse,
    setPlayable(on) {
      playable = !!on;
      if (!heavy) startParse();
      if (modelReady) applyVisibility();
      else (heavy || startParse()).then(() => applyVisibility());
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
