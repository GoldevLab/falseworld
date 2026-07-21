/**
 * False World — VRM overlay (VRMedia /view pattern).
 * Fetch with progress → yield → parse → hide until idle → reveal.
 * Mixamo idle/walk retarget. Local /vendor Three + three-vrm.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

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

async function fetchWithProgress(url, onPct) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + " → " + res.status);
  const total = Number(res.headers.get("content-length") || 0);
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onPct && onPct(100);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onPct && onPct(Math.min(99, Math.round((100 * loaded) / total)));
    // Let meadow rAF breathe during big downloads
    if (loaded % (512 * 1024) < value.byteLength) await yieldFrame();
  }
  onPct && onPct(100);
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
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
  const arrayBuffer = await fetchWithProgress(opts.vrmUrl, (pct) =>
    onProgress("VRM · " + pct + "%")
  );
  await yieldFrame();
  onProgress("VRM · parseando (no cuelga UI)…");
  await yieldFrame();

  const gltf = await new Promise((resolve, reject) => {
    // Defer parse so meadow rAF can paint; VRMedia uses loader.parse(arrayBuffer)
    setTimeout(() => {
      try {
        loader.parse(arrayBuffer, "", resolve, reject);
      } catch (e) {
        reject(e);
      }
    }, 16);
  });

  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("VRM data not found");

  // Like VRMedia: hide until idle ready (avoid T-pose flash)
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
    const buf = await fetchWithProgress(url, null);
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

      const hide = pose.camMode === "fpv";
      if (vrm.scene.visible) vrm.scene.visible = !hide;
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
    vrm.scene.visible = getPose()?.camMode !== "fpv";
    onProgress("WASD · VRM visible");
    await yieldFrame();

    try {
      const walkClip = await loadFbxClip(opts.walkUrl, "walk");
      walk = mixer.clipAction(walkClip);
      walk.setLoop(THREE.LoopRepeat, Infinity);
      onProgress("WASD · VRM OK");
    } catch (we) {
      console.warn("[VRM] walk skip", we);
      onProgress("WASD · VRM (sin walk)");
    }
  } catch (ae) {
    console.warn("[VRM] idle failed — show anyway", ae);
    // Fallback: visible without anim (better than frozen forever)
    vrm.scene.visible = true;
    onProgress("VRM sin idle · " + (ae.message || ae));
  }

  return {
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
