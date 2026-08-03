#!/usr/bin/env python3
from pathlib import Path

p = Path("/home/golfredo/Documentos/apps/falseworld/static/client/fw-meadow-gpu-v217.js")
t = p.read_text()
n = 0


def must_replace(old, new, label):
    global t, n
    if old not in t:
        raise SystemExit(f"MISSING: {label}\n---\n{old[:240]}")
    t = t.replace(old, new, 1)
    n += 1
    print("ok", label)


must_replace(
    """          if (deployMode) {
            const tag = ghostOk
              ? (" · " + (ghostReason || "OK"))
              : (" · " + (ghostReason || "bloqueado"));
            onHud({
              status: "Colocar Armario" + tag + " · LMB confirma",
            });
          } else if (buildMode) {""",
    """          if (deployMode) {
            const tag = ghostOk
              ? (" · " + (ghostReason || "OK"))
              : (" · " + (ghostReason || "bloqueado"));
            const deployLabels = {
              toolcupboard: "Colocar Armario",
              workbench: "Colocar Mesa",
              research_table: "Colocar Investigación",
              campfire: "Colocar Fogata",
              sleeping_bag: "Colocar Saco",
              box_small: "Colocar Caja",
              box_large: "Colocar Cofre",
              metal_door: "Colocar Puerta",
            };
            const dLab = deployLabels[deployMode] || ("Colocar " + String(deployMode));
            onHud({
              status: dLab + tag + " · LMB confirma",
            });
          } else if (buildMode) {""",
    "deploy HUD",
)

must_replace(
    """      door.locked = true;
      door.auth = [owner];
      door.ownerId = owner;
      if (door.isOpen) door.isOpen = false;
      invalidatePieceMesh(door);
      rebuildBuildMesh();
      onHud({ status: "Cerradura puesta · solo tú abres/cierras" });
      return true;
    }""",
    """      door.locked = true;
      door.auth = [owner];
      door.ownerId = owner;
      if (door.isOpen) {
        door.isOpen = false;
        door._doorOpenAmt = 0;
      }
      invalidatePieceMesh(door);
      rebuildBuildMesh();
      try { notifyWorldPlace(door); } catch (_) {}
      onHud({ status: "Cerradura puesta · solo tú abres/cierras" });
      return true;
    }""",
    "lock sync",
)

must_replace(
    """      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      notifyWorldPlace(piece);
      onHud({ status: "Upgrade · " + BUILD_TIERS[next].label + " · " + piece.maxHp + " HP" });
      return true;
    }

    function repairPiece(piece) {""",
    """      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      notifyWorldPlace(piece);
      try { playBuildPlace("upgrade"); } catch (_) {}
      onHud({ status: "Upgrade · " + BUILD_TIERS[next].label + " · " + piece.maxHp + " HP" });
      return true;
    }

    function repairPiece(piece) {""",
    "upgrade sfx",
)

must_replace(
    """      piece.hp = piece.maxHp;
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      notifyWorldPlace(piece);
      onHud({ status: "Reparada · " + piece.maxHp + " HP" });
      return true;
    }

    // --- Decay / upkeep ---------------------------------------------------------""",
    """      piece.hp = piece.maxHp;
      invalidatePieceMesh(piece);
      rebuildBuildMesh();
      notifyWorldPlace(piece);
      try { playBuildPlace("repair"); } catch (_) {}
      onHud({ status: "Reparada · " + piece.maxHp + " HP" });
      return true;
    }

    // --- Decay / upkeep ---------------------------------------------------------""",
    "repair sfx",
)

must_replace(
    """      if (kind === "remove") {
        hammerHit(0, 0.92, 1);
        return;
      }
      // Place: Rust-like double nail tap (no avatar swing)
      hammerHit(0, 1.0, 1);
      hammerHit(0.065, 1.08, 0.82);
    }""",
    """      if (kind === "remove") {
        hammerHit(0, 0.92, 1);
        return;
      }
      if (kind === "upgrade") {
        hammerHit(0, 1.15, 1.05);
        hammerHit(0.09, 0.88, 0.7);
        try {
          const t0 = audio.ctx.currentTime;
          const bus = audio.sfxBus || audio.master;
          const osc = audio.ctx.createOscillator();
          const g = audio.ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(520, t0);
          osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.12);
          g.gain.setValueAtTime(0.06, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
          osc.connect(g); g.connect(bus);
          osc.start(t0); osc.stop(t0 + 0.16);
        } catch (_) {}
        return;
      }
      if (kind === "repair") {
        hammerHit(0, 1.05, 0.85);
        hammerHit(0.05, 1.12, 0.55);
        return;
      }
      // Place: Rust-like double nail tap (no avatar swing)
      hammerHit(0, 1.0, 1);
      hammerHit(0.065, 1.08, 0.82);
    }""",
    "buildplace kinds",
)

must_replace(
    """        } else if (kind === "door_open") {
          noiseBurst(0.09, 0.07, 420);
          beep("triangle", 180, 95, 0.14, 0.05);
        } else if (kind === "door_close") {
          noiseBurst(0.06, 0.09, 280);
          beep("sine", 140, 70, 0.1, 0.06);
        } else if (kind === "eat") {""",
    """        } else if (kind === "door_open") {
          // Metal door: hinge scrape + panel whoosh
          noiseBurst(0.16, 0.11, 520);
          noiseBurst(0.22, 0.05, 180, t0 + 0.04);
          beep("triangle", 140, 70, 0.22, 0.045);
          beep("sine", 260, 110, 0.18, 0.03, t0 + 0.05);
        } else if (kind === "door_close") {
          // Slam: air rush then solid metal thunk
          noiseBurst(0.08, 0.07, 380);
          beep("triangle", 160, 55, 0.12, 0.05);
          setTimeout(() => {
            try {
              noiseBurst(0.07, 0.14, 160, audio.ctx.currentTime);
              beep("sine", 90, 45, 0.1, 0.08, audio.ctx.currentTime);
              beep("square", 220, 80, 0.04, 0.035, audio.ctx.currentTime);
            } catch (_) {}
          }, 160);
        } else if (kind === "eat") {""",
    "door sfx",
)

must_replace(
    """        // Workbench / research: Rust-like — only on foundation or floor (not bare terrain)
        const needsStructure = type === "workbench" || type === "research_table";
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
          cell.iy = deck.iy;
        } else if (needsStructure) {
          return { ok: false, reason: "necesita cimiento o piso" };
        } else if (iy === 0 && chunk) {""",
    """        // Workbench / research / TC / large box: Rust-like — only on foundation or floor
        const needsStructure = type === "workbench" || type === "research_table"
          || type === "toolcupboard" || type === "box_large";
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
          cell.iy = deck.iy;
        } else if (needsStructure) {
          return { ok: false, reason: "necesita cimiento o piso" };
        } else if (iy === 0 && chunk) {""",
    "tc/box deck",
)

must_replace(
    """      } else if (isWallType(type) && type !== "roof_wall") {
        // Walls: prefer deck socket; otherwise allow direct terrain placement (iy 0)
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
        } else if (iy > 0) {
          return { ok: false, reason: "necesita piso/cimiento" };
        } else {
          const blocked = groundBlockedReason(ix, iz);
          if (blocked) return { ok: false, reason: blocked };
          if (!chunk) return { ok: false, reason: "sin terreno" };
          cell.baseY = sampleHeight(chunk, cx, cz);
        }
      }""",
    """      } else if (isWallType(type) && type !== "roof_wall") {
        // Walls: require foundation/floor (stilts come with the deck)
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (!deck) return { ok: false, reason: "necesita cimiento o piso" };
        cell.baseY = deck.baseY;
      }""",
    "walls need deck enhanced",
)

must_replace(
    """      if ((isWallType(type) || isRampType(type)) && !findDeck(ix, iz, iy) && type !== "roof_wall") {
        const blocked = groundBlockedReason(ix, iz);
        if (blocked && !findDeck(ix, iz, iy)) {
          // walls need deck — fall through
        }
      }

      if (isFoundationType(type)) {
        if (iy <= 0) return { ok: true, reason: "" };
        if (!findDeck(ix, iz, iy - 1)) return { ok: false, reason: "sin soporte abajo" };
        return { ok: true, reason: "" };
      }

      if (type === "door") {
        if (occupancyBlocked(cell)) return { ok: false, reason: "ocupado" };
        return validateDoorIntoFrame(cell);
      }

      if (isWallType(type) && type !== "roof_wall") {
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (deck) {
          cell.baseY = deck.baseY;
          return { ok: true, reason: "" };
        }
        // Ground walls: allowed without foundation at terrain level
        if (iy > 0) return { ok: false, reason: "necesita piso/cimiento" };
        const blocked = groundBlockedReason(ix, iz);
        if (blocked) return { ok: false, reason: blocked };
        if (chunk) {
          cell.baseY = sampleHeight(
            chunk,
            (ix + 0.5) * BUILD_CELL,
            (iz + 0.5) * BUILD_CELL
          );
        }
        return { ok: true, reason: "sobre terreno" };
      }""",
    """      if (isFoundationType(type)) {
        if (iy <= 0) return { ok: true, reason: "" };
        if (!findDeck(ix, iz, iy - 1)) return { ok: false, reason: "sin soporte abajo" };
        return { ok: true, reason: "" };
      }

      if (type === "door") {
        if (occupancyBlocked(cell)) return { ok: false, reason: "ocupado" };
        return validateDoorIntoFrame(cell);
      }

      if (isWallType(type) && type !== "roof_wall") {
        if (wallAlreadyOnEdge(ix, iz, iy, cell.yaw)) return { ok: false, reason: "pared ya existe" };
        const deck = findDeck(ix, iz, iy);
        if (!deck) return { ok: false, reason: "necesita cimiento o piso" };
        cell.baseY = deck.baseY;
        return { ok: true, reason: "" };
      }""",
    "walls need deck base",
)

print("batch1", n)
p.write_text(t)
print("wrote", p)
