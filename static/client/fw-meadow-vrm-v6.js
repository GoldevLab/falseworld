/**
 * False World — VRM overlay v6 (VRMedia fetchWithCache pattern).
 * Raw ArrayBuffer cache · stream sin yield · progress throttled · hide until setPlayable.
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
  await yieldFrame();
  onProgress("VRM · parseando…");
  await yieldFrame();

  // VRMedia: loader.parse(arrayBuffer) — deferred un tick para no freeze el gate
  const gltf = await new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        loader.parse(arrayBuffer, "", resolve, reject);
      } catch (e) {
        reject(e);
      }
    }, 0);
  });

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("VRM data not found");

  // Like VRMedia: hide until idle ready; FE-style: stay hidden until START (setPlayable)
  let playable = false;
  vrm.scene.visible = false;
  try {
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
  } catch (_) {}
  // combineSkeletons can stall big VRM — skip (VRMedia studio doesn't require it for reveal)
  try {
    if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
  } catch (_) {}

  vrm.scene.traverse((obj) => {
    obj.frustumCulled = false;
  });
  // Face +Z meadow forward (VRM usually faces −Z)
  vrm.scene.rotation.y = Math.PI;
  scene.add(vrm.scene);

  const mixer = new THREE.AnimationMixer(vrm.scene);
  let idle = null;
  let walk = null;
  let gait = "idle";

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

  // Start render loop early (hidden VRM) so meadow isn't blocked
  let alive = true;
  let raf = 0;
  let last = performance.now();

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
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resize).observe(canvas.parentElement || canvas);
  }

  function tick() {
    if (!alive) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const pose = getPose();
    if (pose) {
      camera.fov = pose.fovDeg || 55;
      camera.aspect = pose.aspect || camera.aspect;
      camera.updateProjectionMatrix();
      camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);

      const hide = pose.camMode === "fpv" || !playable;
      vrm.scene.visible = !hide;
      if (!hide) {
        // feet on heightmap; slight lift so boots clear terrain
        vrm.scene.position.set(pose.x, pose.y + 0.02, pose.z);
        vrm.scene.rotation.y = pose.yaw + Math.PI;
        setGait(pose.moving ? "walk" : "idle");
      }
    }

    mixer.update(dt);
    vrm.update(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  }
  raf = requestAnimationFrame(tick);

  // Animations (sequential, yielding) — then reveal
  try {
    const idleClip = await loadFbxClip(opts.idleUrl, "idle");
    idle = mixer.clipAction(idleClip);
    idle.setLoop(THREE.LoopRepeat, Infinity);
    idle.play();
    warmPose(mixer, vrm);
    // Keep hidden until outer gate calls setPlayable(true)
    vrm.scene.visible = false;
    onProgress("VRM · idle listo");
    await yieldFrame();

    try {
      const walkClip = await loadFbxClip(opts.walkUrl, "walk");
      walk = mixer.clipAction(walkClip);
      walk.setLoop(THREE.LoopRepeat, Infinity);
      onProgress("VRM · listo");
    } catch (we) {
      console.warn("[VRM] walk skip", we);
      onProgress("VRM · listo (sin walk)");
    }
  } catch (ae) {
    console.warn("[VRM] idle failed — ready anyway", ae);
    vrm.scene.visible = false;
    onProgress("VRM sin idle · " + (ae.message || ae));
  }

  return {
    setPlayable(on) {
      playable = !!on;
      if (!vrm) return;
      const pose = getPose && getPose();
      vrm.scene.visible = playable && pose?.camMode !== "fpv";
      if (vrm.scene.visible) warmPose(mixer, vrm);
    },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      try {
        mixer.stopAllAction();
        scene.remove(vrm.scene);
        VRMUtils.deepDispose?.(vrm.scene);
        renderer.dispose();
      } catch (_) {}
    },
  };
}

window.FalseWorldVrm = { create };
