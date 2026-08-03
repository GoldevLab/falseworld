#!/usr/bin/env python3
from pathlib import Path

p = Path("/home/golfredo/Documentos/apps/falseworld/static/client/fw-meadow-gpu-v217.js")
t = p.read_text()
n = 0


def must_replace(old, new, label):
    global t, n
    if old not in t:
        raise SystemExit(f"MISSING: {label}\n---\n{old[:320]}")
    t = t.replace(old, new, 1)
    n += 1
    print("ok", label)


# Replace doorAnim stub comment with helpers nearby — insert after BUILD_DOOR_H constants area is hard.
# Instead insert helpers just before pieceAabb door branch by replacing the door AABB block,
# and add helpers before pieceAabb function.

# Find "function pieceAabb" and insert door helpers before it.
marker = "    function pieceAabb(p) {"
if marker not in t:
    raise SystemExit("no pieceAabb")

helpers = r'''    /** 0 = closed, 1 = fully open (lerp during swing). */
    function doorOpenAmt(p) {
      if (!p) return 0;
      if (p._doorOpenAmt != null) return Math.max(0, Math.min(1, p._doorOpenAmt));
      return p.isOpen ? 1 : 0;
    }

    /**
     * Swinging metal door leaf around hinge.
     * Returns { minX,maxX,minY,maxY,minZ,maxZ, hx,hy,hz } (handle at free edge).
     */
    function doorLeafGeom(p) {
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const y0 = wallSeatY(p);
      const y1 = y0 + BUILD_DOOR_H;
      const yaw = ((p.yaw % 4) + 4) % 4;
      const w = BUILD_DOOR_W;
      const thick = 0.09;
      const amt = doorOpenAmt(p);
      const ang = amt * Math.PI * 0.5;
      const c = Math.cos(ang), s = Math.sin(ang);
      const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
      const hinge = mid - w * 0.5;
      let hx0, hz0, dx, dz, px, pz;
      if (yaw === 0) {
        hx0 = hinge; hz0 = z1 - 0.02;
        dx = c * w; dz = -s * w;
        px = s * thick; pz = c * thick;
      } else if (yaw === 2) {
        hx0 = hinge; hz0 = z0 + 0.02;
        dx = c * w; dz = s * w;
        px = -s * thick; pz = -c * thick;
      } else if (yaw === 1) {
        hx0 = x1 - 0.02; hz0 = hinge;
        dx = -s * w; dz = c * w;
        px = -c * thick; pz = s * thick;
      } else {
        hx0 = x0 + 0.02; hz0 = hinge;
        dx = s * w; dz = c * w;
        px = c * thick; pz = -s * thick;
      }
      const corners = [
        [hx0, hz0],
        [hx0 + dx, hz0 + dz],
        [hx0 + px, hz0 + pz],
        [hx0 + dx + px, hz0 + dz + pz],
      ];
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < 4; i++) {
        const x = corners[i][0], z = corners[i][1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      // Handle near free (latch) edge, mid-height
      const latchX = hx0 + dx * 0.88 + px * 0.5;
      const latchZ = hz0 + dz * 0.88 + pz * 0.5;
      return {
        minX, maxX, minY: y0, maxY: y1, minZ, maxZ,
        hx: latchX, hy: y0 + BUILD_DOOR_H * 0.52, hz: latchZ,
        hx0, hz0, dx, dz, px, pz, y0, y1,
      };
    }

    function startDoorSwing(piece, opening) {
      ensurePieceInternals(piece);
      const from = doorOpenAmt(piece);
      const to = opening ? 1 : 0;
      piece.isOpen = !!opening;
      doorAnim = doorAnim.filter((a) => a.piece !== piece && a.id !== piece.id);
      if (Math.abs(from - to) < 0.02) {
        piece._doorOpenAmt = to;
        invalidatePieceMesh(piece);
        rebuildBuildMesh();
        return;
      }
      doorAnim.push({ id: piece.id, piece, from, to, t: 0, dur: 0.28 });
      piece._doorOpenAmt = from;
    }

    function tickDoorAnims(dt) {
      if (!doorAnim.length) return;
      const touched = new Set();
      for (let i = doorAnim.length - 1; i >= 0; i--) {
        const a = doorAnim[i];
        if (!a.piece || a.piece.type !== "door") {
          doorAnim.splice(i, 1);
          continue;
        }
        a.t += dt;
        const u = Math.min(1, a.t / a.dur);
        const e = 1 - Math.pow(1 - u, 3);
        a.piece._doorOpenAmt = a.from + (a.to - a.from) * e;
        touched.add(a.piece);
        if (u >= 1) {
          a.piece._doorOpenAmt = a.to;
          doorAnim.splice(i, 1);
        }
      }
      if (!touched.size) return;
      touched.forEach((piece) => invalidatePieceMesh(piece));
      rebuildBuildMesh();
    }

'''

t = t.replace(marker, helpers + marker, 1)
n += 1
print("ok door helpers insert")

# Replace door AABB in pieceAabb
must_replace(
    """      // Door leaf — thin panel; open = swung 90° into the cell (stays until E toggles)
      if (p.type === "door") {
        const y0 = wallSeatY(p);
        const y1 = y0 + BUILD_DOOR_H;
        const w = BUILD_DOOR_W;
        const dt = 0.1;
        const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
        const hinge = mid - w * 0.5;
        const open = !!p.isOpen;
        if (yaw === 0) {
          if (!open) return { minX: hinge, maxX: hinge + w, minY: y0, maxY: y1, minZ: z1 - t - dt, maxZ: z1 - 0.01 };
          // Swung inward (−Z): leaf along X≈hinge, clears the opening
          return { minX: hinge - dt, maxX: hinge + 0.04, minY: y0, maxY: y1, minZ: z1 - w - 0.02, maxZ: z1 + 0.02 };
        }
        if (yaw === 2) {
          if (!open) return { minX: hinge, maxX: hinge + w, minY: y0, maxY: y1, minZ: z0 + 0.01, maxZ: z0 + t + dt };
          return { minX: hinge - dt, maxX: hinge + 0.04, minY: y0, maxY: y1, minZ: z0 - 0.02, maxZ: z0 + w + 0.02 };
        }
        if (yaw === 1) {
          if (!open) return { minX: x1 - t - dt, maxX: x1 - 0.01, minY: y0, maxY: y1, minZ: hinge, maxZ: hinge + w };
          return { minX: x1 - w - 0.02, maxX: x1 + 0.02, minY: y0, maxY: y1, minZ: hinge - dt, maxZ: hinge + 0.04 };
        }
        if (!open) return { minX: x0 + 0.01, maxX: x0 + t + dt, minY: y0, maxY: y1, minZ: hinge, maxZ: hinge + w };
        return { minX: x0 - 0.02, maxX: x0 + w + 0.02, minY: y0, maxY: y1, minZ: hinge - dt, maxZ: hinge + 0.04 };
      }""",
    """      // Door leaf — thin panel; openAmt lerps 0→1 around hinge
      if (p.type === "door") {
        const g = doorLeafGeom(p);
        return { minX: g.minX, maxX: g.maxX, minY: g.minY, maxY: g.maxY, minZ: g.minZ, maxZ: g.maxZ };
      }""",
    "door aabb",
)

# Replace door mesh in buildPieceMesh override
must_replace(
    """      if (piece.type === "door") {
        // Metal door leaf — closed across opening, open = swung 90° into the cell
        const rgb = [0.38, 0.42, 0.46];
        const brass = [0.78, 0.58, 0.22];
        const iron = [0.18, 0.19, 0.22];
        const ironLite = [0.42, 0.44, 0.48];
        const cell = BUILD_CELL;
        const x0 = piece.ix * cell, z0 = piece.iz * cell;
        const x1 = x0 + cell, z1 = z0 + cell;
        const y0 = wallSeatY(piece);
        const y1 = y0 + BUILD_DOOR_H;
        const yaw = ((piece.yaw % 4) + 4) % 4;
        const open = !!piece.isOpen;
        const t = 0.08;
        const w = BUILD_DOOR_W;
        const mid = yaw === 0 || yaw === 2 ? (x0 + x1) * 0.5 : (z0 + z1) * 0.5;
        const hinge = mid - w * 0.5;
        if (yaw === 0) {
          if (!open) buildPushBox(arr, hinge, y0, z1 - t - 0.02, hinge + w, y1, z1 - 0.02, rgb);
          else buildPushBox(arr, hinge - t, y0, z1 - w, hinge + 0.02, y1, z1, rgb);
        } else if (yaw === 2) {
          if (!open) buildPushBox(arr, hinge, y0, z0 + 0.02, hinge + w, y1, z0 + t + 0.02, rgb);
          else buildPushBox(arr, hinge - t, y0, z0, hinge + 0.02, y1, z0 + w, rgb);
        } else if (yaw === 1) {
          if (!open) buildPushBox(arr, x1 - t - 0.02, y0, hinge, x1 - 0.02, y1, hinge + w, rgb);
          else buildPushBox(arr, x1 - w, y0, hinge - t, x1, y1, hinge + 0.02, rgb);
        } else {
          if (!open) buildPushBox(arr, x0 + 0.02, y0, hinge, x0 + t + 0.02, y1, hinge + w, rgb);
          else buildPushBox(arr, x0, y0, hinge - t, x0 + w, y1, hinge + 0.02, rgb);
        }
        // Handle on latch edge (moves with open pose)
        const hy0 = y0 + BUILD_DOOR_H * 0.48;
        const hy1 = hy0 + 0.16;
        let hx0, hx1, hz0, hz1;
        if (yaw === 0) {
          if (!open) { hx0 = hinge + w - 0.18; hx1 = hinge + w - 0.05; hz0 = z1 - 0.01; hz1 = z1 + 0.04; }
          else { hx0 = hinge - 0.04; hx1 = hinge + 0.04; hz0 = z1 - w + 0.05; hz1 = z1 - w + 0.18; }
        } else if (yaw === 2) {
          if (!open) { hx0 = hinge + w - 0.18; hx1 = hinge + w - 0.05; hz0 = z0 - 0.04; hz1 = z0 + 0.01; }
          else { hx0 = hinge - 0.04; hx1 = hinge + 0.04; hz0 = z0 + w - 0.18; hz1 = z0 + w - 0.05; }
        } else if (yaw === 1) {
          if (!open) { hx0 = x1 - 0.01; hx1 = x1 + 0.04; hz0 = hinge + w - 0.18; hz1 = hinge + w - 0.05; }
          else { hx0 = x1 - w + 0.05; hx1 = x1 - w + 0.18; hz0 = hinge - 0.04; hz1 = hinge + 0.04; }
        } else {
          if (!open) { hx0 = x0 - 0.04; hx1 = x0 + 0.01; hz0 = hinge + w - 0.18; hz1 = hinge + w - 0.05; }
          else { hx0 = x0 + w - 0.18; hx1 = x0 + w - 0.05; hz0 = hinge - 0.04; hz1 = hinge + 0.04; }
        }
        buildPushBox(arr, hx0, hy0, hz0, hx1, hy1, hz1, brass);
        // Visible padlock where the grip is — clear signal the door is locked
        if (piece.locked) {
          const cx = (hx0 + hx1) * 0.5;
          const cz = (hz0 + hz1) * 0.5;
          const ly0 = hy0 - 0.02;
          const ly1 = hy0 + 0.14;
          const body = 0.07;
          buildPushBox(arr, cx - body, ly0, cz - body, cx + body, ly1, cz + body, iron);
          buildPushBox(arr, cx - 0.015, ly0 + 0.04, cz - body - 0.01, cx + 0.015, ly0 + 0.09, cz + body + 0.01, ironLite);
          const sh = 0.045;
          buildPushBox(arr, cx - sh, ly1, cz - sh * 0.55, cx - sh + 0.025, ly1 + 0.09, cz + sh * 0.55, brass);
          buildPushBox(arr, cx + sh - 0.025, ly1, cz - sh * 0.55, cx + sh, ly1 + 0.09, cz + sh * 0.55, brass);
          buildPushBox(arr, cx - sh, ly1 + 0.07, cz - sh * 0.55, cx + sh, ly1 + 0.1, cz + sh * 0.55, brass);
        }
        return;
      }""",
    """      if (piece.type === "door") {
        // Metal door leaf — hinge swing lerped by _doorOpenAmt
        const rgb = [0.38, 0.42, 0.46];
        const brass = [0.78, 0.58, 0.22];
        const iron = [0.18, 0.19, 0.22];
        const ironLite = [0.42, 0.44, 0.48];
        const g = doorLeafGeom(piece);
        buildPushBox(arr, g.minX, g.minY, g.minZ, g.maxX, g.maxY, g.maxZ, rgb);
        // Handle on latch edge
        const hs = 0.07;
        const hy0 = g.hy - 0.08, hy1 = g.hy + 0.08;
        buildPushBox(arr, g.hx - hs, hy0, g.hz - hs, g.hx + hs, hy1, g.hz + hs, brass);
        if (piece.locked) {
          const cx = g.hx, cz = g.hz;
          const ly0 = hy0 - 0.02;
          const ly1 = hy0 + 0.14;
          const body = 0.07;
          buildPushBox(arr, cx - body, ly0, cz - body, cx + body, ly1, cz + body, iron);
          buildPushBox(arr, cx - 0.015, ly0 + 0.04, cz - body - 0.01, cx + 0.015, ly0 + 0.09, cz + body + 0.01, ironLite);
          const sh = 0.045;
          buildPushBox(arr, cx - sh, ly1, cz - sh * 0.55, cx - sh + 0.025, ly1 + 0.09, cz + sh * 0.55, brass);
          buildPushBox(arr, cx + sh - 0.025, ly1, cz - sh * 0.55, cx + sh, ly1 + 0.09, cz + sh * 0.55, brass);
          buildPushBox(arr, cx - sh, ly1 + 0.07, cz - sh * 0.55, cx + sh, ly1 + 0.1, cz + sh * 0.55, brass);
        }
        return;
      }""",
    "door mesh",
)

# toggleDoorPiece — use startDoorSwing
must_replace(
    """      piece.isOpen = !piece.isOpen;
      // Persist open state — stays until E toggles again (no auto-close)
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      playDoorToggle(!!piece.isOpen);
      try { notifyWorldPlace(piece); } catch (_) {}
      onHud({
        status: (piece.isOpen ? "Puerta abierta · E para cerrar" : "Puerta cerrada · E para abrir")
          + (piece.locked ? " · con cerradura" : ""),
      });
      return true;
    }""",
    """      const opening = !piece.isOpen;
      startDoorSwing(piece, opening);
      playDoorToggle(opening);
      try { notifyWorldPlace(piece); } catch (_) {}
      onHud({
        status: (opening ? "Puerta abierta · E para cerrar" : "Puerta cerrada · E para abrir")
          + (piece.locked ? " · con cerradura" : ""),
      });
      return true;
    }""",
    "toggle swing",
)

# doorWorldPos → leaf center
must_replace(
    """    function doorWorldPos(p) {
      const cell = BUILD_CELL;
      const x0 = p.ix * cell, z0 = p.iz * cell;
      const x1 = x0 + cell, z1 = z0 + cell;
      const yaw = ((p.yaw % 4) + 4) % 4;
      const y = wallSeatY(p) + BUILD_DOOR_H * 0.5;
      if (yaw === 0) return { x: (x0 + x1) * 0.5, y, z: z1 };
      if (yaw === 1) return { x: x1, y, z: (z0 + z1) * 0.5 };
      if (yaw === 2) return { x: (x0 + x1) * 0.5, y, z: z0 };
      return { x: x0, y, z: (z0 + z1) * 0.5 };
    }""",
    """    function doorWorldPos(p) {
      // Follow the swinging leaf (open prompt sits on the open door, not the frame)
      const g = doorLeafGeom(p);
      return {
        x: (g.minX + g.maxX) * 0.5,
        y: (g.minY + g.maxY) * 0.5,
        z: (g.minZ + g.maxZ) * 0.5,
      };
    }""",
    "door world pos",
)

# tick door anims in update hook
must_replace(
    """    let __aaaUpdateHook = function (dt) {
      tickDecay(dt);
      tickVitals(dt);
      tickResourceRespawn(dt);
      tickExplosives(dt);
      tickTreeFalls(dt);
      tickTreeParticles(dt);""",
    """    let __aaaUpdateHook = function (dt) {
      tickDoorAnims(dt);
      tickDecay(dt);
      tickVitals(dt);
      tickResourceRespawn(dt);
      tickExplosives(dt);
      tickTreeFalls(dt);
      tickTreeParticles(dt);""",
    "tick door anims",
)

# Soft side aim cue — more frequent when hammering + stronger copy
must_replace(
    """      softHintEl.textContent = soft
        ? "SOFT SIDE · vulnerable (Y voltea)"
        : "HARD SIDE · exterior OK";
    }""",
    """      softHintEl.textContent = soft
        ? "SOFT · ×2 daño (Y voltea cara)"
        : "HARD · daño reducido";
    }""",
    "soft hint text",
)

# Network sync: when isOpen changes remotely, snap open amt
# Find apply/merge of isOpen
must_replace(
    """        if (raw.isOpen != null) existing.isOpen = !!raw.isOpen;""",
    """        if (raw.isOpen != null) {
          const nextOpen = !!raw.isOpen;
          if (existing.isOpen !== nextOpen) {
            existing.isOpen = nextOpen;
            // Remote: snap (or brief lerp if helpers exist)
            if (typeof startDoorSwing === "function") startDoorSwing(existing, nextOpen);
            else existing._doorOpenAmt = nextOpen ? 1 : 0;
          } else {
            existing.isOpen = nextOpen;
          }
        }""",
    "remote door open",
)

print("batch3", n)
p.write_text(t)
print("wrote", len(t))
