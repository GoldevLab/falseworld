/**
 * False World — VRM overlay v42 (remote peers use VRM clones, not capsules).
 * Crouch/walk/run/jump/swim; FPV body+hands visible; gather LoopRepeat.
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
  const ambient = new THREE.AmbientLight(0xb8c4a8, 1.6);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff2d6, 2.2);
  key.position.set(3, 8, 2);
  const rim = new THREE.DirectionalLight(0xa8c8e8, 0.55);
  rim.position.set(-2, 3, -3);
  const fill = new THREE.DirectionalLight(0xd8e8c8, 0.7);
  fill.position.set(0, 3, -2);
  scene.add(key, rim, fill);

  function syncMeadowLights(pose) {
    if (!pose) return;
    const dayW = pose.dayW != null ? pose.dayW : 1;
    const nightW = pose.nightW != null ? pose.nightW : 0;
    const duskW = pose.duskW != null ? pose.duskW : 0;
    const amb = pose.amb != null ? pose.amb : 0.2;
    const lc = pose.lightCol;
    if (lc && lc.length >= 3) {
      key.color.setRGB(
        Math.min(1, lc[0] / Math.max(0.35, Math.max(lc[0], lc[1], lc[2]))),
        Math.min(1, lc[1] / Math.max(0.35, Math.max(lc[0], lc[1], lc[2]))),
        Math.min(1, lc[2] / Math.max(0.35, Math.max(lc[0], lc[1], lc[2])))
      );
      const inten = Math.min(2.8, 0.55 + Math.hypot(lc[0], lc[1], lc[2]) * 1.15);
      key.intensity = inten;
    } else {
      key.color.setHex(0xfff2d6);
      key.intensity = 1.4 + dayW * 0.9;
    }
    const sun = pose.sunTo;
    if (sun && sun.length >= 3) {
      const len = Math.hypot(sun[0], sun[1], sun[2]) || 1;
      key.position.set((sun[0] / len) * 18, (sun[1] / len) * 18, (sun[2] / len) * 18);
    }
    ambient.intensity = 0.55 + amb * 3.2 + nightW * 0.35;
    ambient.color.setRGB(
      0.55 + nightW * 0.15,
      0.62 + duskW * 0.05,
      0.58 + nightW * 0.25
    );
    rim.intensity = 0.25 + nightW * 0.45 + duskW * 0.2;
    fill.intensity = 0.35 + dayW * 0.4;
    renderer.toneMappingExposure = 0.85 + dayW * 0.4 + duskW * 0.15;
  }

  // --- Remote players (VRM clones; filled after local model loads) ---
  const remotesRoot = new THREE.Group();
  remotesRoot.name = "fw-remotes";
  scene.add(remotesRoot);
  const remoteById = new Map();
  let setRemotePlayers = function () {};
  let updateRemotes = function () {};
  let disposeAllRemotes = function () {};

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
        // Minimal nearer bias for sole vs terrain — too much (e.g. 3cm+) lets
        // feet win over grass blades that should occlude them in the merge.
        lin = max(cameraNear, lin - 0.008);
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
  // Keep an independent copy — GLTF parse can detach/transfer the original buffer,
  // which would make remote peer clones fail on one tab only.
  const vrmBytes = arrayBuffer.slice(0);

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
  const mixamoAssets = Object.create(null);

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

  function setFpvHeadCollapsed(collapsed) {
    if (!vrm?.humanoid) return;
    // Rust-style FPV: collapse head + neck fully. Camera sits at neck pivot
    // (meadow pushes eye forward) so look-down sees chest exterior, not mesh guts.
    const s = collapsed ? 0.001 : 1;
    const names = ["head", "leftEye", "rightEye", "jaw", "neck"];
    for (let i = 0; i < names.length; i++) {
      const bone = vrm.humanoid.getNormalizedBoneNode(names[i]);
      if (bone) bone.scale.setScalar(s);
      try {
        const raw = vrm.humanoid.getRawBoneNode && vrm.humanoid.getRawBoneNode(names[i]);
        if (raw) raw.scale.setScalar(s);
      } catch (_) {}
    }
    fpvHeadHidden = !!collapsed;
  }

  function applyVisibility() {
    if (!vrm) return;
    const pose = getPose && getPose();
    // FPV + 3rd: body visible. FPV collapses head bones so you see arms/torso, not skull interior.
    const hide = !playable || !modelReady;
    vrm.scene.visible = !hide;
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
      try { syncMeadowLights(pose); } catch (_) {}
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
    updateRemotes(dt, camera);
    // Head/eyes track aim point (mira) in 3ª persona; FPV collapses head bones
    const isFpv = !!(pose && pose.camMode === "fpv");
    if (!isFpv && pose && vrm && modelReady && vrm.lookAt && pose.lookAt) {
      vrm.lookAt.autoUpdate = false;
      _lookAtWorld.set(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
      vrm.lookAt.lookAt(_lookAtWorld);
    }
    if (vrm) vrm.update(dt);
    if (pose && vrm && modelReady && vrm.scene.visible) {
      plantFeetOnGround(groundY);
    }
    // After VRM update — collapse head every frame in FPV so body/arms stay visible
    if (vrm && modelReady) {
      setFpvHeadCollapsed(isFpv);
      if (isFpv && vrm.scene.visible) vrm.scene.updateMatrixWorld(true);
    }

    const w = rtW;
    const h = rtH;

    // 1) Scene → RT — local with depth, then remotes without depth test so they
    // always leave color in the atlas (merge accepts av_dn≈1 for those pixels).
    renderer.setRenderTarget(sceneRT);
    renderer.setViewport(0, 0, w, h);
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    const showLocal = !!(vrm && vrm.scene.visible);
    const showRemotes = remoteById.size > 0;
    if (showLocal || showRemotes) {
      if (vrm && vrm.scene) vrm.scene.visible = showLocal;
      remotesRoot.visible = false;
      if (showLocal) renderer.render(scene, camera);
      if (showRemotes) {
        if (vrm && vrm.scene) vrm.scene.visible = false;
        remotesRoot.visible = true;
        renderer.render(scene, camera);
      }
      if (vrm && vrm.scene) vrm.scene.visible = showLocal;
      remotesRoot.visible = showRemotes;
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
    // Keep Mixamo FBX so remotes can retarget to their own humanoid
    if (label && !mixamoAssets[label]) mixamoAssets[label] = asset;
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

  // --- Remote VRM clones (retarget Mixamo per instance + vrm.update) ---
  function makeNameTexture(label) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(8, 12, 240, 40);
    ctx.font = "bold 28px IBM Plex Sans, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f2f4f0";
    ctx.fillText(String(label || "Guest").slice(0, 18), 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  function disposeRemoteEntry(r) {
    if (!r) return;
    try {
      if (r.mixer) r.mixer.stopAllAction();
      if (r.vrm && r.vrm.scene) {
        if (r.group) r.group.remove(r.vrm.scene);
        VRMUtils.deepDispose?.(r.vrm.scene);
      } else if (r.vrmScene) {
        if (r.group) r.group.remove(r.vrmScene);
        r.vrmScene.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (let i = 0; i < mats.length; i++) {
              try { mats[i] && mats[i].dispose && mats[i].dispose(); } catch (_) {}
            }
          }
        });
      }
      if (r.placeholder) {
        if (r.group) r.group.remove(r.placeholder);
        r.placeholder.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      }
      if (r.label) {
        if (r.group) r.group.remove(r.label);
        if (r.labelTex) r.labelTex.dispose();
        if (r.label.material) r.label.material.dispose();
        if (r.label.geometry) r.label.geometry.dispose();
      }
      remotesRoot.remove(r.group);
    } catch (_) {}
  }

  function clipForRemote(label, remoteVrm) {
    const asset = mixamoAssets[label];
    if (!asset || !remoteVrm) return null;
    try {
      return processMixamoClip(asset, remoteVrm);
    } catch (e) {
      console.warn("[VRM] remote retarget", label, e);
      return null;
    }
  }

  let remoteSpawnChain = Promise.resolve();

  function hideBeacon(entry) {
    if (entry && entry.placeholder) entry.placeholder.visible = false;
    if (entry && entry.body) entry.body.visible = false;
  }

  function lowestFootYFor(remoteVrm) {
    let minY = Infinity;
    if (!remoteVrm?.humanoid) return minY;
    for (const name of FOOT_BONES) {
      const bone = remoteVrm.humanoid.getNormalizedBoneNode(name);
      if (!bone) continue;
      bone.getWorldPosition(_footWorld);
      if (_footWorld.y < minY) minY = _footWorld.y;
    }
    return minY;
  }

  /** Same as local plantFeetOnGround: group.y is peer feetY; soles sit on that. */
  function plantRemoteFeet(entry) {
    const scene = entry && entry.vrmScene;
    const rv = entry && entry.vrm;
    if (!scene) return;
    const groundY = entry.group.position.y;
    scene.position.x = 0;
    scene.position.z = 0;
    scene.position.y = 0;
    scene.updateMatrixWorld(true);
    let minY = lowestFootYFor(rv);
    if (!Number.isFinite(minY) || minY === Infinity) {
      const box = new THREE.Box3().setFromObject(scene);
      if (!Number.isFinite(box.min.y)) return;
      minY = box.min.y;
    }
    scene.position.y += groundY - minY + 0.06;
    scene.updateMatrixWorld(true);
  }

  /** Force atlas-visible materials: no depth write → merge accepts via av_dn≈1. */
  function toVisibleBasicMaterials(root) {
    root.traverse((obj) => {
      obj.frustumCulled = false;
      obj.visible = true;
      if (!obj.isMesh || !obj.material) return;
      obj.renderOrder = 10;
      const srcList = Array.isArray(obj.material) ? obj.material : [obj.material];
      const next = srcList.map((mat) => {
        const map = mat && (mat.map || mat.baseColorMap || mat.shadeMultiplyTexture);
        const color = mat && mat.color && mat.color.isColor ? mat.color.clone() : new THREE.Color(0xe8c4a0);
        return new THREE.MeshBasicMaterial({
          map: map || null,
          color: map ? 0xffffff : color,
          transparent: false,
          opacity: 1,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        });
      });
      obj.material = next.length === 1 ? next[0] : next;
    });
  }

  function hardenRemoteMeshes(root) {
    toVisibleBasicMaterials(root);
  }

  function makeRemoteBodyMat(color) {
    return new THREE.MeshBasicMaterial({
      color: color,
      depthTest: false,
      depthWrite: false,
      transparent: false,
      opacity: 1,
    });
  }

  function buildPermanentBody(name) {
    const root = new THREE.Group();
    root.name = "fw-remote-body";
    const skin = makeRemoteBodyMat(0xe0b089);
    const cloth = makeRemoteBodyMat(0x2a2a32);
    const accent = makeRemoteBodyMat(0xc4452d);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.85, 8), cloth);
    legs.position.y = 0.45;
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.55, 8), cloth);
    torso.position.y = 1.05;
    const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.12, 8), accent);
    sash.position.y = 0.88;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skin);
    head.position.y = 1.5;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), makeRemoteBodyMat(0x1a1210));
    hair.position.y = 1.58;
    hair.scale.set(1, 0.85, 1);
    for (const m of [legs, torso, sash, head, hair]) {
      m.frustumCulled = false;
      m.renderOrder = 10;
      root.add(m);
    }
    root.frustumCulled = false;
    return root;
  }

  function attachRemoteActions(entry, rv) {
    entry.mixer = new THREE.AnimationMixer(rv.scene);
    const mk = (clip) => {
      if (!clip || !entry.mixer) return null;
      const a = entry.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.clampWhenFinished = false;
      a.zeroSlopeAtStart = true;
      a.zeroSlopeAtEnd = true;
      a.enabled = true;
      a.setEffectiveWeight(0.0001);
      a.setEffectiveTimeScale(1);
      a.play();
      return a;
    };
    entry.actions = {
      idle: mk(clipForRemote("idle", rv)),
      walk: mk(clipForRemote("walk", rv)),
      run: mk(clipForRemote("run", rv)),
      crouchIdle: mk(clipForRemote("crouchIdle", rv)),
      crouchWalk: mk(clipForRemote("crouchWalk", rv)),
    };
    syncRemoteAnim(entry);
    warmPose(entry.mixer, rv);
  }

  async function spawnRemoteVrmParsed(entry) {
    const remoteLoader = new GLTFLoader();
    remoteLoader.register((parser) => new VRMLoaderPlugin(parser));
    const buf = vrmBytes.slice(0);
    const gltfRemote =
      typeof remoteLoader.parseAsync === "function"
        ? await remoteLoader.parseAsync(buf, "")
        : await new Promise((resolve, reject) =>
            remoteLoader.parse(buf, "", resolve, reject)
          );
    if (!alive || entry.aborted) return;
    const rv = gltfRemote.userData.vrm;
    if (!rv) throw new Error("no vrm in parse");
    try {
      if (rv.meta?.metaVersion === "0") VRMUtils.rotateVRM0(rv);
    } catch (_) {}
    rv.scene.name = "fw-remote-vrm";
    rv.scene.rotation.set(0, 0, 0);
    rv.scene.position.set(0, 0, 0);
    rv.scene.scale.set(1, 1, 1);
    rv.scene.visible = true;
    rv.scene.traverse((o) => {
      o.frustumCulled = false;
      if (o.scale && o.scale.x < 0.01) o.scale.set(1, 1, 1);
    });
    entry.group.add(rv.scene);
    entry.vrm = rv;
    entry.vrmScene = rv.scene;
    attachRemoteActions(entry, rv);
    try {
      for (let i = 0; i < 3; i++) {
        rv.update(1 / 60);
        if (entry.mixer) entry.mixer.update(1 / 60);
      }
    } catch (_) {}
    toVisibleBasicMaterials(rv.scene);
    plantRemoteFeet(entry);
    hideBeacon(entry);
  }

  function spawnRemoteVrm(entry, attempt) {
    if (!alive || entry.aborted) return;
    const tryN = attempt || 0;
    remoteSpawnChain = remoteSpawnChain
      .then(async () => {
        if (!alive || entry.aborted) return;
        try {
          await spawnRemoteVrmParsed(entry);
        } catch (e) {
          console.warn("[VRM] remote parse failed", tryN, e);
          if (!entry.aborted && tryN < 2) {
            setTimeout(() => spawnRemoteVrm(entry, tryN + 1), 600 * (tryN + 1));
          }
        }
      })
      .catch((e) => console.warn("[VRM] remote spawn queue", e));
  }

  function createRemoteAvatar(peer) {
    const g = new THREE.Group();
    let y = +peer.y || 0;
    if (!Number.isFinite(y) || Math.abs(y) < 0.05) {
      try {
        const lp = getPose && getPose();
        if (lp && Number.isFinite(lp.y)) y = lp.y;
      } catch (_) {}
    }
    const x = +peer.x || 0;
    const z = +peer.z || 0;
    g.position.set(x, y, z);
    g.rotation.y = (peer.yaw || 0) + Math.PI;
    g.frustumCulled = false;

    // Capsule until VRM loads (visible via depthWrite:false merge)
    const body = buildPermanentBody(peer.name);
    g.add(body);
    const placeholder = new THREE.Group();
    placeholder.visible = false;
    g.add(placeholder);
    remotesRoot.add(g);
    const entry = {
      group: g,
      body,
      placeholder,
      label: null,
      labelTex: null,
      vrm: null,
      vrmScene: null,
      mixer: null,
      actions: null,
      aborted: false,
      name: peer.name || "Guest",
      from: { x, y, z, yaw: peer.yaw || 0 },
      to: { x, y, z, yaw: peer.yaw || 0 },
      buf: [{ t: performance.now(), x, y, z, yaw: peer.yaw || 0 }],
      _lastPeerT: peer._t || 0,
      crouching: !!peer.crouching,
      moving: !!peer.moving,
      sprinting: !!peer.sprinting,
      t0: performance.now(),
      t1: performance.now(),
    };
    spawnRemoteVrm(entry, 0);
    return entry;
  }

  function syncRemoteAnim(r) {
    if (!r.actions) return;
    const crouch = r.crouching;
    const moving = r.moving;
    const sprint = r.sprinting;
    let idleW = 1, walkW = 0, runW = 0, cIdleW = 0, cWalkW = 0;
    if (crouch) {
      idleW = 0;
      cIdleW = moving ? 0.15 : 1;
      cWalkW = moving ? 0.85 : 0;
    } else if (moving && sprint) {
      idleW = 0.05;
      walkW = 0.15;
      runW = 0.85;
    } else if (moving) {
      idleW = 0.1;
      walkW = 0.9;
    }
    const setW = (a, w) => {
      if (!a) return;
      a.enabled = true;
      a.paused = false;
      a.setEffectiveWeight(Math.max(0.0001, w));
      a.setEffectiveTimeScale(1);
      if (!a.isRunning()) a.play();
    };
    setW(r.actions.idle, idleW);
    setW(r.actions.walk, walkW);
    setW(r.actions.run, runW);
    setW(r.actions.crouchIdle, cIdleW);
    setW(r.actions.crouchWalk, cWalkW);
  }

  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // Render remotes slightly in the past so we always lerp between two real samples
  // instead of racing to the latest pose and freezing until the next packet.
  const REMOTE_INTERP_MS = 100;

  function pushRemoteTarget(r, p, now) {
    const px = +p.x || 0;
    const py = Number.isFinite(+p.y) ? +p.y : r.to.y;
    const pz = +p.z || 0;
    const pyaw = +p.yaw || 0;
    const peerT = p._t || 0;
    if (peerT && r._lastPeerT && peerT < r._lastPeerT) {
      // Stale roster echo — keep flags only
      r.crouching = !!p.crouching;
      r.moving = !!p.moving;
      r.sprinting = !!p.sprinting;
      return;
    }
    const dx = px - r.to.x;
    const dy = py - r.to.y;
    const dz = pz - r.to.z;
    const moved =
      dx * dx + dy * dy + dz * dz > 1e-6 || Math.abs(pyaw - r.to.yaw) > 1e-4;
    r.crouching = !!p.crouching;
    r.moving = !!p.moving;
    r.sprinting = !!p.sprinting;
    if (p.name && p.name !== r.name) {
      r.name = p.name;
      try {
        if (r.labelTex) r.labelTex.dispose();
      } catch (_) {}
      try {
        r.labelTex = makeNameTexture(p.name);
        if (r.label && r.label.material) {
          r.label.material.map = r.labelTex;
          r.label.material.needsUpdate = true;
        }
      } catch (_) {}
    }
    if (!moved) {
      if (peerT) r._lastPeerT = peerT;
      return;
    }
    r._lastPeerT = peerT || now;
    r.to.x = px;
    r.to.y = py;
    r.to.z = pz;
    r.to.yaw = pyaw;
    if (!r.buf) r.buf = [];
    const last = r.buf[r.buf.length - 1];
    // Avoid duplicate stamps at the same receive instant
    if (last && now - last.t < 8) {
      last.x = px;
      last.y = py;
      last.z = pz;
      last.yaw = pyaw;
    } else {
      r.buf.push({ t: now, x: px, y: py, z: pz, yaw: pyaw });
    }
    while (r.buf.length > 48) r.buf.shift();
    const oldest = now - 1500;
    while (r.buf.length > 2 && r.buf[0].t < oldest) r.buf.shift();
  }

  function sampleRemotePose(r, now) {
    const buf = r.buf;
    if (!buf || !buf.length) {
      return { x: r.to.x, y: r.to.y, z: r.to.z, yaw: r.to.yaw };
    }
    const renderT = now - REMOTE_INTERP_MS;
    if (buf.length === 1 || renderT <= buf[0].t) {
      return buf[0];
    }
    let i = 0;
    while (i < buf.length - 1 && buf[i + 1].t <= renderT) i++;
    const a = buf[i];
    const b = buf[i + 1];
    if (!b) {
      // Waiting on next packet: nudge forward briefly so walk doesn't hard-stop
      if (r.moving && i >= 1) {
        const p = buf[i - 1];
        const dt = (a.t - p.t) / 1000;
        if (dt > 0.015) {
          const age = Math.min(0.08, Math.max(0, (renderT - a.t) / 1000));
          if (age > 0) {
            return {
              x: a.x + ((a.x - p.x) / dt) * age,
              y: a.y + ((a.y - p.y) / dt) * age,
              z: a.z + ((a.z - p.z) / dt) * age,
              yaw: a.yaw,
            };
          }
        }
      }
      return a;
    }
    const span = Math.max(1, b.t - a.t);
    const u = Math.max(0, Math.min(1, (renderT - a.t) / span));
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
      yaw: lerpAngle(a.yaw, b.yaw, u),
    };
  }

  setRemotePlayers = function (list) {
    const ids = new Set();
    const arr = Array.isArray(list) ? list : [];
    const now = performance.now();
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      if (!p || !p.id) continue;
      ids.add(p.id);
      let r = remoteById.get(p.id);
      if (!r) {
        r = createRemoteAvatar(p);
        remoteById.set(p.id, r);
      } else {
        pushRemoteTarget(r, p, now);
        syncRemoteAnim(r);
      }
    }
    for (const [id, r] of remoteById) {
      if (ids.has(id)) continue;
      r.aborted = true;
      disposeRemoteEntry(r);
      remoteById.delete(id);
    }
  };

  updateRemotes = function (dt, cam) {
    const now = performance.now();
    try {
      const mp = typeof window !== "undefined" && window.__fw && window.__fw.mp;
      const peers = mp && typeof mp.getPeers === "function" ? mp.getPeers() : null;
      if (peers && peers.length) {
        for (let i = 0; i < peers.length; i++) {
          const p = peers[i];
          if (!p || !p.id) continue;
          let r = remoteById.get(p.id);
          if (!r) {
            r = createRemoteAvatar(p);
            remoteById.set(p.id, r);
          }
          pushRemoteTarget(r, p, now);
          syncRemoteAnim(r);
        }
      }
    } catch (_) {}

    const step = Math.min(0.05, Math.max(0, dt));
    for (const r of remoteById.values()) {
      const s = sampleRemotePose(r, now);
      r.group.position.set(s.x, s.y, s.z);
      r.group.rotation.y = s.yaw + Math.PI;

      if (r.mixer) r.mixer.update(step);
      if (r.vrm) {
        try {
          r.vrm.update(step);
        } catch (_) {}
      }
      if (r.vrmScene) plantRemoteFeet(r);
      if (r.body) r.body.visible = !r.vrmScene;
    }
  };

  function getRemotePoses() {
    const out = [];
    for (const [id, r] of remoteById) {
      out.push({
        id,
        name: r.name,
        x: r.group.position.x,
        y: r.group.position.y,
        z: r.group.position.z,
        yaw: r.group.rotation.y - Math.PI,
        moving: !!r.moving,
        sprinting: !!r.sprinting,
        crouching: !!r.crouching,
      });
    }
    return out;
  }

  disposeAllRemotes = function () {
    for (const r of remoteById.values()) {
      r.aborted = true;
      disposeRemoteEntry(r);
    }
    remoteById.clear();
  };

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
    setRemotePlayers,
    getRemotePoses,
    getRemoteCount() {
      return remoteById.size;
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
        disposeAllRemotes();
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
