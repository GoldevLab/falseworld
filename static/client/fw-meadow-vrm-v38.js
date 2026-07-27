/**
 * False World — VRM overlay v38 (Rust/Fortnite loco + Mixamo for FPV & 3rd person).
 * Crouch/walk/run/jump/swim; FPV hides head to avoid camera clip; gather LoopRepeat.
 * Renders color + linearized depth into a double-height canvas atlas
 * so WebGPU can depth-composite the avatar behind/in front of grass.
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
  runUrl: "/animaciones/FastRun.fbx",
  jumpUrl: "/animaciones/Jump.fbx",
  standingJumpUrl: "/animaciones/StandingJump.fbx",
  crouchIdleUrl: "/animaciones/CrouchIdle.fbx",
  crouchWalkUrl: "/animaciones/CrouchWalk.fbx",
  swimUrl: "/animaciones/Swim.fbx",
  swimIdleUrl: "/animaciones/SwimIdle.fbx",
  attackUrl: "/animaciones/Attack.fbx",
  gatherUrl: "/animaciones/Gather.fbx",
  chopUrl: "/animaciones/Chop.fbx",
  mineUrl: "/animaciones/Mine.fbx",
};

/** Match meadow WebGPU clip (fw-meadow-gpu NEAR/FAR). */
const CAM_NEAR = 0.1;
const CAM_FAR = 800;

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
      // Only retarget position (skip scale tracks)
      if (propertyName !== "position") continue;
      const value = new Float32Array(track.values.length);
      for (let i = 0; i < track.values.length; i += 3) {
        if (vrmBoneName === "hips") {
          // In-place: kill Mixamo root-motion XZ; keep scaled Y bob so feet plant.
          value[i] = 0;
          value[i + 1] = track.values[i + 1] * hipsPositionScale;
          value[i + 2] = 0;
        } else {
          let x = track.values[i];
          let y = track.values[i + 1];
          let z = track.values[i + 2];
          if (vrm.meta?.metaVersion === "0") {
            x = -x;
            z = -z;
          }
          value[i] = x * hipsPositionScale;
          value[i + 1] = y * hipsPositionScale;
          value[i + 2] = z * hipsPositionScale;
        }
      }
      tracks.push(
        new THREE.VectorKeyframeTrack(`${vrmNodeName}.position`, track.times, value)
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

function makeFsCam() {
  return new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

function makeFsScene(mat) {
  const s = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  s.add(mesh);
  return s;
}

async function create(canvas, opts) {
  opts = Object.assign({}, DEFAULTS, opts || {});
  const getPose = opts.getPose;
  const onProgress = opts.onProgress || (() => {});
  if (!getPose) throw new Error("getPose requerido");

  onProgress("VRM · init WebGL…");
  await yieldFrame();

  // Atlas canvas: top = color RGBA, bottom = linearized depth (R)
  const atlas = document.createElement("canvas");
  atlas.width = 2;
  atlas.height = 4;
  atlas.style.cssText = "display:none;position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
  (canvas.parentElement || document.body).appendChild(atlas);

  const renderer = new THREE.WebGLRenderer({
    canvas: atlas,
    alpha: true,
    antialias: false,
    powerPreference: "default",
    failIfMajorPerformanceCaveat: false,
    preserveDrawingBuffer: true,
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.autoClear = false;

  // Hide legacy overlay canvas — compositing happens in WebGPU
  canvas.style.cssText =
    "opacity:0!important;pointer-events:none!important;visibility:hidden;";

  atlas.addEventListener(
    "webglcontextlost",
    (e) => {
      e.preventDefault();
      console.warn("[VRM] webgl context lost");
    },
    false
  );

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, CAM_NEAR, CAM_FAR);
  scene.add(new THREE.AmbientLight(0xb8c4a8, 1.6));
  const key = new THREE.DirectionalLight(0xfff2d6, 2.2);
  key.position.set(3, 8, 2);
  const rim = new THREE.DirectionalLight(0xa8c8e8, 0.55);
  rim.position.set(-2, 3, -3);
  const fill = new THREE.DirectionalLight(0xd8e8c8, 0.7);
  fill.position.set(0, 3, -2);
  scene.add(key, rim, fill);

  let rtW = 2;
  let rtH = 1;
  let sceneRT = null;
  const depthTexture = new THREE.DepthTexture(rtW, rtH);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;

  function rebuildRT(w, h) {
    rtW = w;
    rtH = h;
    if (sceneRT) sceneRT.dispose();
    depthTexture.image = { width: w, height: h };
    depthTexture.needsUpdate = true;
    sceneRT = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
      samples: 0,
    });
    sceneRT.texture.colorSpace = THREE.SRGBColorSpace;
  }
  rebuildRT(2, 1);

  const blitMat = new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(tMap, vUv);
      }
    `,
  });
  const depthMat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      cameraNear: { value: CAM_NEAR },
      cameraFar: { value: CAM_FAR },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDepth;
      uniform float cameraNear;
      uniform float cameraFar;
      varying vec2 vUv;
      float linearize(float d) {
        float z = d * 2.0 - 1.0;
        return (2.0 * cameraNear * cameraFar) /
          (cameraFar + cameraNear - z * (cameraFar - cameraNear));
      }
      void main() {
        float d = texture2D(tDepth, vUv).x;
        float lin = linearize(d);
        // Tiny nearer bias only for sole vs terrain z-fight — keep small so grass
        // in front of the feet can still occlude in the WebGPU merge.
        lin = max(cameraNear, lin - 0.035);
        float n = clamp(lin / cameraFar, 0.0, 1.0);
        gl_FragColor = vec4(n, n, n, 1.0);
      }
    `,
  });
  const fsCam = makeFsCam();
  const blitScene = makeFsScene(blitMat);
  const depthScene = makeFsScene(depthMat);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  onProgress("VRM · descargando…");
  const arrayBuffer = await fetchWithCache(opts.vrmUrl, (pct) =>
    onProgress("VRM · " + pct + "%")
  );

  let alive = true;
  let raf = 0;
  let last = performance.now();
  let playable = false;
  let vrm = null;
  let mixer = null;
  let idle = null;
  let walk = null;
  let run = null;
  let jump = null;
  let standingJump = null;
  let crouchIdle = null;
  let crouchWalk = null;
  let swim = null;
  let swimIdle = null;
  let attack = null;
  let gather = null;
  let chop = null;
  let mine = null;
  let walkBlend = 0;
  let runBlend = 0;
  let crouchBlend = 0;
  let swimBlend = 0;
  let jumpBlend = 0;
  let oneshotUntil = 0;
  let oneshotAction = null;
  let gatherLoopAction = null;
  let gatherLoopMode = null;
  let jumpLatch = false;
  let modelReady = false;
  let atlasReady = false;
  let cssW = 2;
  let cssH = 1;
  let resizeTick = 0;
  let fpvHeadHidden = false;

  function setLoopAction(action, weight, timeScale) {
    if (!action) return;
    action.enabled = true;
    action.paused = false;
    action.setEffectiveWeight(Math.max(0.0001, weight));
    action.setEffectiveTimeScale(timeScale != null ? timeScale : 1);
  }

  function triggerOneShot(action, minHoldMs) {
    if (!action || !mixer) return;
    // Hold-gather owns the body via LoopRepeat — don't interrupt with oneshots
    if (gatherLoopAction) return;
    const clip = action.getClip && action.getClip();
    const clipMs = clip && clip.duration > 0.05 ? clip.duration * 1000 : 0;
    const holdMs = Math.max(minHoldMs || 0, clipMs || 900);
    if (oneshotAction && oneshotAction !== action) {
      try { oneshotAction.fadeOut(0.08); } catch (_) {}
    }
    action.enabled = true;
    action.paused = false;
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset();
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.fadeIn(0.05);
    action.play();
    oneshotAction = action;
    oneshotUntil = performance.now() + holdMs + 40;
  }

  function actionForGatherMode(mode) {
    if (mode === "chop") return chop || attack || gather;
    if (mode === "mine") return mine || attack || gather;
    if (mode === "gather") return gather || chop || attack;
    return null;
  }

  function setGatherLoop(mode) {
    const action = actionForGatherMode(mode);
    if (!mode || !action) {
      if (gatherLoopAction) {
        try { gatherLoopAction.fadeOut(0.12); } catch (_) {}
        try {
          gatherLoopAction.setLoop(THREE.LoopOnce, 1);
          gatherLoopAction.clampWhenFinished = true;
        } catch (_) {}
        gatherLoopAction = null;
        gatherLoopMode = null;
      }
      return;
    }
    if (gatherLoopMode === mode && gatherLoopAction === action) {
      action.enabled = true;
      action.paused = false;
      action.setEffectiveWeight(1);
      action.setEffectiveTimeScale(1);
      if (!action.isRunning()) action.play();
      return;
    }
    if (oneshotAction) {
      try { oneshotAction.fadeOut(0.06); } catch (_) {}
      oneshotAction = null;
      oneshotUntil = 0;
    }
    if (gatherLoopAction && gatherLoopAction !== action) {
      try { gatherLoopAction.fadeOut(0.08); } catch (_) {}
    }
    action.enabled = true;
    action.paused = false;
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.reset();
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.fadeIn(0.06);
    action.play();
    gatherLoopAction = action;
    gatherLoopMode = mode;
  }

  function syncAnimWeights(pose, dt) {
    if (!idle) return;
    const moving = !!pose.moving;
    const sprinting = !!pose.sprinting;
    const crouching = !!pose.crouching;
    const swimming = !!pose.swimming;
    const jumping = !!pose.jumping;
    const now = performance.now();

    const gMode = pose.gatherMode || null;
    setGatherLoop(gMode);

    // One-shot only when NOT in continuous gather loop (tap attacks / single swing)
    if (!gatherLoopAction) {
      if (pose.attackPulse) {
        triggerOneShot(attack || chop || gather, 900);
        pose.attackPulse = false;
      }
      if (pose.chopPulse) {
        triggerOneShot(chop || attack || gather, 1550);
        pose.chopPulse = false;
      }
      if (pose.minePulse) {
        triggerOneShot(mine || attack || gather, 1700);
        pose.minePulse = false;
      }
      if (pose.gatherPulse) {
        triggerOneShot(gather || chop || attack, 1150);
        pose.gatherPulse = false;
      }
    } else {
      pose.attackPulse = false;
      pose.chopPulse = false;
      pose.minePulse = false;
      pose.gatherPulse = false;
    }

    if (!gatherLoopAction && oneshotAction && now >= oneshotUntil) {
      try { oneshotAction.fadeOut(0.18); } catch (_) {}
      oneshotAction = null;
    }

    const locoTarget = moving && !swimming && !jumping ? 1 : 0;
    const runTarget = moving && sprinting && !crouching && run ? 1 : 0;
    const crouchTarget = crouching && !swimming ? 1 : 0;
    const swimTarget = swimming ? 1 : 0;
    const jumpTarget = jumping && !swimming ? 1 : 0;

    // Fire jump clip once on leave-ground (Mixamo Jump / StandingJump)
    const jumpClip = (moving ? jump : standingJump) || jump || standingJump;
    if (jumpTarget > 0.5 && !jumpLatch && jumpClip) {
      jumpLatch = true;
      try {
        if (jump && jump !== jumpClip) jump.setEffectiveWeight(0.0001);
        if (standingJump && standingJump !== jumpClip) standingJump.setEffectiveWeight(0.0001);
        jumpClip.enabled = true;
        jumpClip.paused = false;
        jumpClip.setLoop(THREE.LoopOnce, 1);
        jumpClip.clampWhenFinished = true;
        jumpClip.reset();
        jumpClip.setEffectiveWeight(1);
        jumpClip.setEffectiveTimeScale(1);
        jumpClip.fadeIn(0.04);
        jumpClip.play();
      } catch (_) {}
    }
    if (jumpTarget < 0.2) jumpLatch = false;

    walkBlend += (locoTarget - walkBlend) * Math.min(1, dt * 10);
    runBlend += (runTarget - runBlend) * Math.min(1, dt * 12);
    crouchBlend += (crouchTarget - crouchBlend) * Math.min(1, dt * 14);
    swimBlend += (swimTarget - swimBlend) * Math.min(1, dt * 8);
    jumpBlend += (jumpTarget - jumpBlend) * Math.min(1, dt * 16);

    const oneshot = !gatherLoopAction && now < oneshotUntil;
    const gathering = !!gatherLoopAction;
    let wJump = jumpBlend * (jumpClip ? 1 : 0);
    let wSwim = swimBlend * ((swim || swimIdle) ? 1 : 0);
    let wCrouch = crouchBlend * ((crouchIdle || crouchWalk) ? 1 : 0);
    // Crouch fully replaces stand loco (Rust / Fortnite)
    let wLoco = walkBlend * (1 - wJump) * (1 - wSwim) * (1 - wCrouch);
    let wRun = wLoco * runBlend;
    let wWalk = wLoco * (1 - runBlend);
    let wCrouchWalk = wCrouch * (moving ? 1 : 0) * (1 - wJump);
    let wCrouchIdle = wCrouch * (moving ? 0 : 1) * (1 - wJump);
    let wSwimMove = wSwim * (moving ? 1 : 0);
    let wSwimIdle = wSwim * (moving ? 0 : 1);
    let wIdle = Math.max(0.0001, 1 - wLoco - wCrouch - wSwim - wJump);

    if (oneshot || gathering) {
      wIdle = 0.01;
      wWalk = 0;
      wRun = 0;
      wCrouchIdle = 0;
      wCrouchWalk = 0;
      wJump *= 0.1;
      wSwimMove = 0;
      wSwimIdle = 0;
    }

    const mx = pose.moveMx || 0;
    const mz = pose.moveMz || 0;
    const backpedal = moving && mz < -0.2 && Math.abs(mx) < 0.85;
    const strafing = moving && Math.abs(mx) > 0.55 && Math.abs(mz) < 0.55;
    // Strafe: slightly faster cycle (no dedicated Mixamo strafe clip)
    const strafeBoost = strafing ? 1.15 : 1;
    const locoScale = (backpedal ? -1 : (!run && sprinting && moving ? 1.85 : 1)) * strafeBoost;
    const runScale = (backpedal ? -1 : 1) * strafeBoost;
    const crouchWalkScale = (backpedal ? -1 : 1) * (strafing ? 1.1 : 1);

    setLoopAction(idle, wIdle, 1);
    setLoopAction(walk, wWalk, locoScale);
    setLoopAction(run, wRun, runScale);
    if (jump) setLoopAction(jump, jumpClip === jump ? wJump : 0.0001, 1);
    if (standingJump) setLoopAction(standingJump, jumpClip === standingJump ? wJump : 0.0001, 1);
    setLoopAction(crouchIdle, wCrouchIdle, 1);
    setLoopAction(crouchWalk, wCrouchWalk || (wCrouch && !crouchIdle ? wCrouch : 0), crouchWalkScale);
    setLoopAction(swim, wSwimMove || (wSwim && !swimIdle ? wSwim : 0), 1);
    setLoopAction(swimIdle, wSwimIdle, 1);
  }

  function setFpvHeadVisible(show) {
    if (!vrm) return;
    // VRM is usually one SkinnedMesh — bone.visible does nothing useful.
    // Hide head-named meshes + any mesh weighted mostly to head when possible.
    const headBone = vrm.humanoid && vrm.humanoid.getNormalizedBoneNode("head");
    vrm.scene.traverse((obj) => {
      if (!obj.isMesh && !obj.isSkinnedMesh) return;
      const n = String(obj.name || "").toLowerCase();
      if (/head|face|hair|eye|brow|lash|tooth|teeth|tongue|scalp|cap|hat|visor/.test(n)) {
        obj.visible = show;
        return;
      }
      // Tag whole-body mesh: hide in FPV via layer flag we set on the root
    });
    if (headBone) {
      headBone.traverse((obj) => {
        if (obj.isMesh || obj.isSkinnedMesh) obj.visible = show;
      });
      headBone.visible = show;
    }
    fpvHeadHidden = !show;
  }

  function applyVisibility() {
    if (!vrm) return;
    const pose = getPose && getPose();
    // FPV: hide full avatar (single skinned mesh = can't hide only head reliably).
    // Follow/orbit: show body with Mixamo loco.
    const fpv = pose?.camMode === "fpv";
    const hide = !playable || !modelReady || fpv;
    vrm.scene.visible = !hide;
    if (!fpv && fpvHeadHidden) setFpvHeadVisible(true);
  }

  async function tryLoadAction(url, label, loop) {
    if (!url || !mixer) return null;
    try {
      const clip = await loadFbxClip(url, label);
      const action = mixer.clipAction(clip);
      if (loop) {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.zeroSlopeAtStart = true;
      action.zeroSlopeAtEnd = true;
      action.setEffectiveWeight(0.0001);
      action.play();
      return action;
    } catch (e) {
      console.warn("[VRM]", label, "skip", e.message || e);
      return null;
    }
  }

  function resize() {
    const meadow = document.getElementById("fw-canvas");
    let w;
    let h;
    if (meadow && meadow.width > 1 && meadow.height > 1) {
      w = meadow.width;
      h = meadow.height;
      cssW = Math.max(1, Math.floor(meadow.clientWidth || w));
      cssH = Math.max(1, Math.floor(meadow.clientHeight || h));
    } else {
      const parent = canvas.parentElement;
      const rect = parent
        ? parent.getBoundingClientRect()
        : canvas.getBoundingClientRect();
      cssW = Math.max(1, Math.floor(rect.width || canvas.clientWidth || 640));
      cssH = Math.max(1, Math.floor(rect.height || canvas.clientHeight || 480));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = Math.max(1, Math.floor(cssW * dpr));
      h = Math.max(1, Math.floor(cssH * dpr));
    }
    // Double-height atlas: color on top half, depth on bottom half
    if (atlas.width !== w || atlas.height !== h * 2) {
      atlas.width = w;
      atlas.height = h * 2;
      renderer.setPixelRatio(1);
      renderer.setSize(w, h * 2, false);
      if (w !== rtW || h !== rtH) rebuildRT(w, h);
    }
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(resize);
    const meadow = document.getElementById("fw-canvas");
    ro.observe(meadow || canvas.parentElement || canvas);
  }

  const _footWorld = new THREE.Vector3();
  const _lookAtWorld = new THREE.Vector3();
  const FOOT_BONES = ["leftFoot", "rightFoot", "leftToes", "rightToes"];

  function lowestFootY() {
    let minY = Infinity;
    if (!vrm?.humanoid) return minY;
    for (const name of FOOT_BONES) {
      const bone = vrm.humanoid.getNormalizedBoneNode(name);
      if (!bone) continue;
      bone.getWorldPosition(_footWorld);
      if (_footWorld.y < minY) minY = _footWorld.y;
    }
    return minY;
  }

  function plantFeetOnGround(groundY) {
    vrm.scene.updateMatrixWorld(true);
    let minY = lowestFootY();
    // Skinned bind-pose AABB is wrong after Mixamo — only use as last resort
    if (!Number.isFinite(minY) || minY === Infinity) {
      const box = new THREE.Box3().setFromObject(vrm.scene);
      if (!Number.isFinite(box.min.y)) return;
      minY = box.min.y;
    }
    // Keep soles just above the meadow heightmap
    const lift = 0.06;
    vrm.scene.position.y += groundY - minY + lift;
    vrm.scene.updateMatrixWorld(true);
  }

  function tick() {
    if (!alive) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    const pose = getPose();
    let groundY = 0;
    if (pose && vrm && modelReady) {
      camera.near = pose.near != null ? pose.near : CAM_NEAR;
      camera.far = pose.far != null ? pose.far : CAM_FAR;
      camera.fov = pose.fovDeg || 55;
      camera.aspect = pose.aspect || camera.aspect;
      camera.updateProjectionMatrix();
      depthMat.uniforms.cameraNear.value = camera.near;
      depthMat.uniforms.cameraFar.value = camera.far;
      camera.position.set(pose.eye[0], pose.eye[1], pose.eye[2]);
      camera.lookAt(pose.target[0], pose.target[1], pose.target[2]);

      applyVisibility();
      if (vrm.scene.visible) {
        // meadow getPose().y is feetY (ground plant), not eye height
        groundY = pose.y;
        vrm.scene.position.set(pose.x, groundY, pose.z);
        vrm.scene.rotation.y = pose.yaw + Math.PI;
        // Always sync Mixamo loco (crouch/jump/run) for FPV + 3rd person
        syncAnimWeights(pose, dt);
      }
    }

    if (mixer) mixer.update(dt);
    // Head/eyes track mouse / build ghost so placement aim is readable
    if (pose && vrm && modelReady && vrm.lookAt && pose.lookAt) {
      vrm.lookAt.autoUpdate = false;
      _lookAtWorld.set(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
      vrm.lookAt.lookAt(_lookAtWorld);
    }
    if (vrm) vrm.update(dt);
    if (pose && vrm && modelReady && vrm.scene.visible) {
      plantFeetOnGround(groundY);
    }

    const w = rtW;
    const h = rtH;

    // 1) Scene → RT (color + depth)
    renderer.setRenderTarget(sceneRT);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    if (vrm && vrm.scene.visible) {
      renderer.render(scene, camera);
    }

    // 2) Atlas top: color
    renderer.setRenderTarget(null);
    renderer.setViewport(0, h, w, h);
    renderer.setScissor(0, h, w, h);
    renderer.setScissorTest(true);
    renderer.clear(true, true, true);
    blitMat.uniforms.tMap.value = sceneRT.texture;
    renderer.render(blitScene, fsCam);

    // 3) Atlas bottom: linearized depth / far
    renderer.setViewport(0, 0, w, h);
    renderer.setScissor(0, 0, w, h);
    renderer.clear(true, true, true);
    depthMat.uniforms.tDepth.value = sceneRT.depthTexture;
    renderer.render(depthScene, fsCam);
    renderer.setScissorTest(false);

    // Keep in sync with meadow canvas bitmap size (RO won't see width/height attrs)
    if (rtW !== (document.getElementById("fw-canvas")?.width || rtW) || (resizeTick++ % 15) === 0) {
      resize();
    }

    atlasReady = true;
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

  onProgress("VRM · parseando…");
  await yieldFrame();
  await new Promise((r) => requestAnimationFrame(r));

  const PARSE_MS = 12000;
  const parsePromise =
    typeof loader.parseAsync === "function"
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
    idle.clampWhenFinished = false;
    idle.zeroSlopeAtStart = true;
    idle.zeroSlopeAtEnd = true;
    idle.setEffectiveWeight(1);
    idle.play();
    warmPose(mixer, vrm);
    vrm.scene.visible = false;
    onProgress("VRM · idle listo");
  } catch (ae) {
    console.warn("[VRM] idle failed", ae);
    onProgress("VRM sin idle");
  }

  walk = await tryLoadAction(opts.walkUrl, "walk", true);
  run = await tryLoadAction(opts.runUrl || DEFAULTS.runUrl, "run", true);
  jump = await tryLoadAction(opts.jumpUrl || DEFAULTS.jumpUrl, "jump", false);
  standingJump = await tryLoadAction(opts.standingJumpUrl || DEFAULTS.standingJumpUrl, "standingJump", false);
  crouchIdle = await tryLoadAction(opts.crouchIdleUrl || DEFAULTS.crouchIdleUrl, "crouchIdle", true);
  crouchWalk = await tryLoadAction(opts.crouchWalkUrl || DEFAULTS.crouchWalkUrl, "crouchWalk", true);
  swim = await tryLoadAction(opts.swimUrl || DEFAULTS.swimUrl, "swim", true);
  swimIdle = await tryLoadAction(opts.swimIdleUrl || DEFAULTS.swimIdleUrl, "swimIdle", true);
  attack = await tryLoadAction(opts.attackUrl || DEFAULTS.attackUrl, "attack", false);
  gather = await tryLoadAction(opts.gatherUrl || DEFAULTS.gatherUrl, "gather", false);
  chop = await tryLoadAction(opts.chopUrl || DEFAULTS.chopUrl, "chop", false);
  mine = await tryLoadAction(opts.mineUrl || DEFAULTS.mineUrl, "mine", false);

  // Meadow hold-loop syncs swing cadence to real clip lengths
  try {
    const chopDur = chop && chop.getClip() ? chop.getClip().duration : 0;
    const mineDur = mine && mine.getClip() ? mine.getClip().duration : 0;
    const gatherDur = gather && gather.getClip() ? gather.getClip().duration : 0;
    window.__fwGatherSwing = {
      chop: Math.max(1.1, chopDur || 1.55),
      mine: Math.max(1.2, mineDur || 1.7),
      gather: Math.max(0.9, gatherDur || 1.15),
    };
  } catch (_) {}

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
    /** Double-height atlas for WebGPU depth composite. */
    getAtlas() {
      if (!atlasReady) return null;
      return {
        canvas: atlas,
        width: rtW,
        height: rtH,
        near: CAM_NEAR,
        far: CAM_FAR,
      };
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
        if (sceneRT) sceneRT.dispose();
        depthTexture.dispose();
        blitMat.dispose();
        depthMat.dispose();
        renderer.dispose();
        atlas.remove();
      } catch (_) {}
    },
  };
}

window.FalseWorldVrm = { create };
