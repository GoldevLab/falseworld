/**
 * False World — VRM overlay (local Three.js + @pixiv/three-vrm).
 * Same-origin vendor under /vendor; Mixamo retarget like VRMedia.
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
  const vrmHipsHeight = Math.abs(vrmHipsY - vrmRootY);
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

async function create(canvas, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const getPose = opts.getPose;
  const onProgress = opts.onProgress || (() => {});
  if (!getPose) throw new Error("getPose requerido");

  onProgress("VRM · Three local…");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  const hemi = new THREE.HemisphereLight(0x6a88c8, 0x0a1018, 0.55);
  const sun = new THREE.DirectionalLight(0xc8d8ff, 0.95);
  sun.position.set(-3, 12, -4);
  const fill = new THREE.DirectionalLight(0x406080, 0.35);
  fill.position.set(4, 3, 2);
  scene.add(hemi, sun, fill);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  onProgress("VRM · descargando Sophia…");
  const gltf = await new Promise((resolve, reject) => {
    loader.load(
      opts.vrmUrl,
      resolve,
      (e) => {
        if (e.total)
          onProgress(
            "VRM · " + Math.round((100 * e.loaded) / e.total) + "%"
          );
      },
      reject
    );
  });
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("VRM parse falló");
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  try {
    VRMUtils.combineSkeletons(gltf.scene);
  } catch (_) {}
  if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  scene.add(vrm.scene);

  const fbxLoader = new FBXLoader();
  async function loadFbxClip(url, label) {
    onProgress("Anim · " + label);
    const buf = await fetch(url).then((r) => {
      if (!r.ok) throw new Error("FBX " + r.status + " " + url);
      return r.arrayBuffer();
    });
    const asset = fbxLoader.parse(buf, "");
    return processMixamoClip(asset, vrm);
  }

  const mixer = new THREE.AnimationMixer(vrm.scene);
  const [idleClip, walkClip] = await Promise.all([
    loadFbxClip(opts.idleUrl, "idle"),
    loadFbxClip(opts.walkUrl, "walk"),
  ]);
  const idle = mixer.clipAction(idleClip);
  const walk = mixer.clipAction(walkClip);
  idle.setLoop(THREE.LoopRepeat, Infinity);
  walk.setLoop(THREE.LoopRepeat, Infinity);
  idle.play();
  let gait = "idle";

  function setGait(next) {
    if (next === gait) return;
    if (next === "walk") {
      walk.reset().fadeIn(0.2).play();
      idle.fadeOut(0.2);
    } else {
      idle.reset().fadeIn(0.25).play();
      walk.fadeOut(0.2);
    }
    gait = next;
  }

  let alive = true;
  let raf = 0;
  let last = performance.now();

  function resize() {
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);
  onProgress("VRM · listo");

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
      vrm.scene.visible = !hide;
      if (!hide) {
        vrm.scene.position.set(pose.x, pose.y, pose.z);
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

  return {
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      try {
        mixer.stopAllAction();
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
        renderer.dispose();
      } catch (_) {}
    },
  };
}

window.FalseWorldVrm = { create };
