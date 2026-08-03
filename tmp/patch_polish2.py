#!/usr/bin/env python3
from pathlib import Path

p = Path("/home/golfredo/Documentos/apps/falseworld/static/client/fw-meadow-gpu-v217.js")
t = p.read_text()
n = 0


def must_replace(old, new, label):
    global t, n
    if old not in t:
        raise SystemExit(f"MISSING: {label}\n---\n{old[:280]}")
    t = t.replace(old, new, 1)
    n += 1
    print("ok", label)


# Twig wall: add softOnMax param + soft back slab
must_replace(
    """    function buildTwigWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, seed) {
      const alongX = axis === "x";
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const len = Math.max(0.2, a1 - a0);
      const thick = Math.max(0.08, t1 - t0);
      const midT = (t0 + t1) * 0.5;
      const skipStart = !!(endMask & 1);
      const skipEnd = !!(endMask & 2);
      const postR = 0.075;
      const stickSeed = seed != null ? seed : (a0 * 13.1 + a1 * 7.3 + y0 * 3.9);

      function stickBox(along, halfW, yBot, yTop, depthOff, halfD, col) {""",
    """    function buildTwigWall(arr, x0, y0, z0, x1, y1, z1, rgb, axis, endMask, softOnMax, seed) {
      const alongX = axis === "x";
      const a0 = alongX ? x0 : z0;
      const a1 = alongX ? x1 : z1;
      const t0 = alongX ? z0 : x0;
      const t1 = alongX ? z1 : x1;
      const len = Math.max(0.2, a1 - a0);
      const thick = Math.max(0.08, t1 - t0);
      const midT = (t0 + t1) * 0.5;
      const skipStart = !!(endMask & 1);
      const skipEnd = !!(endMask & 2);
      const postR = 0.075;
      const stickSeed = seed != null ? seed : (a0 * 13.1 + a1 * 7.3 + y0 * 3.9);
      const soft = softHardRgbs(rgb).soft;
      const softOn = softOnMax !== false; // default soft on max face

      function stickBox(along, halfW, yBot, yTop, depthOff, halfD, col) {""",
    "twig soft param",
)

# After stickBox function closes and before corner posts, add soft slab.
# Find the corner posts section:
must_replace(
    """      // Corner posts (skipped when joined to a neighbor wall)
      if (!skipStart) {
        stickBox(a0 + postR, postR, y0 - 0.02, y1 + 0.04, 0, thick * 0.42, twigShade(rgb, 0.72));
      }
      if (!skipEnd) {
        stickBox(a1 - postR, postR, y0 - 0.02, y1 + 0.04, 0, thick * 0.42, twigShade(rgb, 0.7));
      }

      // Vertical poles — leave visible gaps between them
      const spacing = 0.19;""",
    """      // Soft back slab (darker / studded look — vulnerable face)
      {
        const softOff = softOn ? thick * 0.28 : -thick * 0.28;
        if (alongX) {
          buildPushBox(arr, a0, y0, midT + softOff - thick * 0.2, a1, y1, midT + softOff + thick * 0.2, soft);
        } else {
          buildPushBox(arr, midT + softOff - thick * 0.2, y0, a0, midT + softOff + thick * 0.2, y1, a1, soft);
        }
        // Soft studs
        for (let si = 0; si < 3; si++) {
          const u = (si + 0.5) / 3;
          const along = a0 + u * len;
          stickBox(along, 0.035, y0 + 0.08, y1 - 0.08, softOff, thick * 0.22, twigShade(soft, 0.85));
        }
      }

      // Hard-side poles offset slightly opposite soft
      const hardBias = softOn ? -thick * 0.06 : thick * 0.06;

      // Corner posts (skipped when joined to a neighbor wall)
      if (!skipStart) {
        stickBox(a0 + postR, postR, y0 - 0.02, y1 + 0.04, hardBias, thick * 0.42, twigShade(rgb, 0.72));
      }
      if (!skipEnd) {
        stickBox(a1 - postR, postR, y0 - 0.02, y1 + 0.04, hardBias, thick * 0.42, twigShade(rgb, 0.7));
      }

      // Vertical poles — leave visible gaps between them
      const spacing = 0.19;""",
    "twig soft slab",
)

# Offset vertical poles with hardBias - replace depthOff line in the loop
must_replace(
    """        const halfW = 0.028 + r0 * 0.028;
        const halfD = 0.035 + r1 * 0.04;
        const depthOff = (r2 - 0.5) * thick * 0.28;
        const lean = (twigHash(stickSeed + i * 5.7) - 0.5) * 0.05;
        const yTop = y1 - r0 * 0.14;
        const yBot = y0 - 0.01 + r1 * 0.03;
        const col = twigShade(rgb, 0.78 + r0 * 0.38);
        stickBox(along + lean, halfW, yBot, yTop, depthOff, halfD, col);""",
    """        const halfW = 0.028 + r0 * 0.028;
        const halfD = 0.035 + r1 * 0.04;
        const depthOff = hardBias + (r2 - 0.5) * thick * 0.22;
        const lean = (twigHash(stickSeed + i * 5.7) - 0.5) * 0.05;
        const yTop = y1 - r0 * 0.14;
        const yBot = y0 - 0.01 + r1 * 0.03;
        const col = twigShade(rgb, 0.78 + r0 * 0.38);
        stickBox(along + lean, halfW, yBot, yTop, depthOff, halfD, col);""",
    "twig hard bias poles",
)

# Call site for buildTwigWall
must_replace(
    """        } else if (twig) {
          buildTwigWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends, seed);
        } else {
          const softOnMax = wallSoftOnMaxFace(yaw, piece.softInward !== false);""",
    """        } else if (twig) {
          const softOnMax = wallSoftOnMaxFace(yaw, piece.softInward !== false);
          buildTwigWall(arr, slab.x0, slab.y0, slab.z0, slab.x1, slab.y1, slab.z1, rgb, slab.axis, ends, softOnMax, seed);
        } else {
          const softOnMax = wallSoftOnMaxFace(yaw, piece.softInward !== false);""",
    "twig call soft",
)

# Mesh signature bust + door anim amt
must_replace(
    """        + (p.type === "door" ? ("|op" + (p.isOpen ? 1 : 0) + "|lk" + (p.locked ? 1 : 0) + "|swing2") : "")
        + (p.type === "campfire" ? ("|lit" + (p.lit ? 1 : 0)) : "")
        + (p.type === "workbench" ? ("|wbt" + (p.wbTier | 0) + "|s13") : "")
        + "|ceil1|tc4|door4|chest3|bag3|wb5|twig2|fire2|softface1|wardrobe2|found4|tiers5|foundTier5|furnCol1"; // bust — door swing""",
    """        + (p.type === "door" ? ("|op" + (p.isOpen ? 1 : 0) + "|lk" + (p.locked ? 1 : 0)
          + "|da" + Math.round((p._doorOpenAmt != null ? p._doorOpenAmt : (p.isOpen ? 1 : 0)) * 20)
          + "|swing3") : "")
        + (p.type === "campfire" ? ("|lit" + (p.lit ? 1 : 0)) : "")
        + (p.type === "workbench" ? ("|wbt" + (p.wbTier | 0) + "|s13") : "")
        + "|ceil1|tc4|door5|chest3|bag3|wb5|twig3|fire2|softface2|wardrobe2|found4|tiers5|foundTier5|furnCol1|polish1";""",
    "mesh sig",
)

# ensurePieceInternals door open amt
must_replace(
    """      if (p.type === "door") {
        if (p.locked == null) p.locked = false;
        if (p.isOpen == null) p.isOpen = false;
        // Locked doors authorize the builder only
        if (!p.auth) p.auth = [p.ownerId || LOCAL_PLAYER_ID];
      }""",
    """      if (p.type === "door") {
        if (p.locked == null) p.locked = false;
        if (p.isOpen == null) p.isOpen = false;
        if (p._doorOpenAmt == null) p._doorOpenAmt = p.isOpen ? 1 : 0;
        // Locked doors authorize the builder only
        if (!p.auth) p.auth = [p.ownerId || LOCAL_PLAYER_ID];
      }""",
    "door open amt init",
)

print("batch2a", n)
p.write_text(t)
print("wrote")
