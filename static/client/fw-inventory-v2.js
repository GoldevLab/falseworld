/** False World inventory — backpack 24 + hotbar 6, stack 10000. Syncs to Resuma signals. */
(function () {
  const BACKPACK_N = 24;
  const HOTBAR_N = 6;
  const STACK = 10000;
  const DRAG_THRESH = 6;

  const DEFS = {
    wood: { id: "wood", label: "Madera", stack: STACK, kind: "resource" },
    stone: { id: "stone", label: "Piedra", stack: STACK, kind: "resource" },
    metal: { id: "metal", label: "Metal", stack: STACK, kind: "resource" },
    sulfur: { id: "sulfur", label: "Azufre", stack: STACK, kind: "resource" },
    hq: { id: "hq", label: "HQM", stack: STACK, kind: "resource" },
    scrap: { id: "scrap", label: "Chatarra", stack: STACK, kind: "resource" },
    rock_tool: { id: "rock_tool", label: "Pico", stack: 1, kind: "gather" },
    hatchet_tool: { id: "hatchet_tool", label: "Hacha", stack: 1, kind: "gather" },
    build_plan: { id: "build_plan", label: "Plano", stack: 1, kind: "build" },
    hammer_tool: { id: "hammer_tool", label: "Martillo", stack: 1, kind: "tool" },
    key_lock: { id: "key_lock", label: "Cerradura", stack: 10, kind: "placeable" },
    tool_cupboard_item: { id: "tool_cupboard_item", label: "Armario", stack: 5, kind: "placeable" },
    workbench_1: { id: "workbench_1", label: "Mesa T1", stack: 5, kind: "placeable" },
    workbench_2: { id: "workbench_2", label: "Mesa T2", stack: 5, kind: "placeable" },
    workbench_3: { id: "workbench_3", label: "Mesa T3", stack: 5, kind: "placeable" },
    metal_door: { id: "metal_door", label: "Puerta metal", stack: 5, kind: "placeable" },
    satchel: { id: "satchel", label: "Satchel", stack: 10, kind: "consumable" },
    rocket: { id: "rocket", label: "Cohete", stack: 5, kind: "consumable" },
    c4: { id: "c4", label: "C4", stack: 5, kind: "consumable" },
    research_table: { id: "research_table", label: "Mesa investigación", stack: 5, kind: "placeable" },
    cloth: { id: "cloth", label: "Tela", stack: STACK, kind: "resource" },
    food: { id: "food", label: "Comida", stack: STACK, kind: "consumable" },
    sleeping_bag: { id: "sleeping_bag", label: "Saco dormir", stack: 5, kind: "placeable" },
    campfire: { id: "campfire", label: "Fogata", stack: 5, kind: "placeable" },
    box_small: { id: "box_small", label: "Caja pequeña", stack: 5, kind: "placeable" },
    box_large: { id: "box_large", label: "Caja grande", stack: 5, kind: "placeable" },
  };

  function iconUrl(id) {
    try {
      return (window.FalseWorldItemIcons && window.FalseWorldItemIcons.url(id)) || null;
    } catch (_) {
      return null;
    }
  }

  function parseSlots(json, n) {
    try {
      const arr = JSON.parse(json || "[]");
      const out = new Array(n).fill(null);
      for (let i = 0; i < n; i++) {
        const s = arr[i];
        if (s && s.id && s.qty > 0) out[i] = { id: String(s.id), qty: s.qty | 0 };
      }
      return out;
    } catch (_) {
      return new Array(n).fill(null);
    }
  }

  function slotsJson(slots) {
    return JSON.stringify(slots.map((s) => (s ? { id: s.id, qty: s.qty } : null)));
  }

  function stackLimit(id) {
    return (DEFS[id] && DEFS[id].stack) || STACK;
  }

  /** Tools / usable gear prefer hotbar 1–6; resources go to backpack. */
  function prefersHotbar(id) {
    const k = (DEFS[id] && DEFS[id].kind) || "none";
    return k === "gather" || k === "build" || k === "placeable" || k === "tool" || k === "consumable";
  }

  function cloneStack(s) {
    return s ? { id: s.id, qty: s.qty | 0 } : null;
  }

  window.FalseWorldInv = {
    create(host, opts) {
      opts = opts || {};
      const onSync = opts.onSync || (() => {});
      const onActive = opts.onActiveChange || (() => {});

      let backpack = parseSlots(opts.backpackJson, BACKPACK_N);
      let hotbar = parseSlots(opts.hotbarJson, HOTBAR_N);
      let active = Math.max(0, Math.min(HOTBAR_N - 1, opts.activeSlot | 0));
      let bagOpen = false;
      /** Selected backpack slot for name inspect (−1 = none). */
      let bagFocus = -1;

      /** @type {null|{kind:"hot"|"bag", idx:number, pointerId:number, x:number, y:number, moved:boolean, stack:{id:string,qty:number}}} */
      let drag = null;
      let ghostEl = null;
      let dropHoverEl = null;

      const root = document.createElement("div");
      root.id = "fw-inv-root";
      root.className = "fw-inv-root";
      root.innerHTML =
        '<div class="fw-hotbar" id="fw-hotbar"></div>' +
        '<div class="fw-bag" id="fw-bag" aria-hidden="true">' +
        '  <div class="fw-bag-head"><span>MOCHILA</span><span class="fw-bag-hint">arrastra · Shift clic = mover</span><kbd>Tab</kbd></div>' +
        '  <div class="fw-bag-inspect" id="fw-bag-inspect" hidden></div>' +
        '  <div class="fw-bag-grid" id="fw-bag-grid"></div>' +
        "</div>" +
        '<div class="fw-held" id="fw-held"></div>' +
        '<div class="fw-drag-ghost" id="fw-drag-ghost" hidden></div>';
      (host || document.querySelector(".stage") || document.body).appendChild(root);

      const hotbarEl = root.querySelector("#fw-hotbar");
      const bagEl = root.querySelector("#fw-bag");
      const bagGrid = root.querySelector("#fw-bag-grid");
      const bagInspectEl = root.querySelector("#fw-bag-inspect");
      const heldEl = root.querySelector("#fw-held");
      ghostEl = root.querySelector("#fw-drag-ghost");

      function emit() {
        const held = hotbar[active];
        onSync({
          backpackJson: slotsJson(backpack),
          hotbarJson: slotsJson(hotbar),
          activeSlot: active,
          heldId: held ? held.id : "",
          heldLabel: held && DEFS[held.id] ? DEFS[held.id].label : "vacío",
        });
        onActive(held ? { id: held.id, qty: held.qty, kind: (DEFS[held.id] || {}).kind || "none" } : null);
      }

      function clearDropHover() {
        if (dropHoverEl) {
          dropHoverEl.classList.remove("is-drop");
          dropHoverEl = null;
        }
      }

      function setDropHover(el) {
        if (dropHoverEl === el) return;
        clearDropHover();
        if (el) {
          dropHoverEl = el;
          el.classList.add("is-drop");
        }
      }

      function renderSlot(el, stack, idx, isHot, selected) {
        el.className = "fw-slot"
          + (isHot ? " is-hot" : "")
          + (selected ? " is-active" : "")
          + (stack ? " has-item" : "");
        el.dataset.idx = String(idx);
        el.dataset.kind = isHot ? "hot" : "bag";
        if (!stack) {
          el.removeAttribute("title");
          el.innerHTML = isHot ? '<span class="fw-slot-num">' + (idx + 1) + "</span>" : "";
          return;
        }
        const def = DEFS[stack.id] || { label: stack.id };
        el.title = def.label + (stack.qty > 1 ? " × " + stack.qty : "");
        const url = iconUrl(stack.id);
        const art = url
          ? '<img class="fw-slot-icon" alt="' + def.label + '" src="' + url + '" draggable="false">'
          : '<span class="fw-slot-blob" data-id="' + stack.id + '"></span>';
        el.innerHTML =
          '<span class="fw-slot-num">' + (isHot ? idx + 1 : "") + "</span>" +
          art +
          '<span class="fw-slot-qty">' + (stack.qty > 1 ? stack.qty : "") + "</span>" +
          '<span class="fw-slot-name">' + def.label + "</span>";
      }

      function paintGhost(stack) {
        if (!ghostEl) return;
        if (!stack) {
          ghostEl.hidden = true;
          ghostEl.innerHTML = "";
          return;
        }
        const def = DEFS[stack.id] || { label: stack.id };
        const url = iconUrl(stack.id);
        ghostEl.hidden = false;
        ghostEl.innerHTML = url
          ? '<img alt="" src="' + url + '" draggable="false"><span class="fw-drag-qty">' + (stack.qty > 1 ? stack.qty : "") + "</span>"
          : '<span class="fw-drag-label">' + def.label + "</span>";
      }

      function moveGhost(clientX, clientY) {
        if (!ghostEl || ghostEl.hidden) return;
        ghostEl.style.transform = "translate(" + (clientX + 12) + "px, " + (clientY + 12) + "px)";
      }

      function slotFromPoint(clientX, clientY) {
        const el = document.elementFromPoint(clientX, clientY);
        if (!el) return null;
        const slot = el.closest && el.closest(".fw-slot");
        if (!slot || !root.contains(slot)) return null;
        return slot;
      }

      function getStack(kind, idx) {
        return kind === "hot" ? hotbar[idx] : backpack[idx];
      }

      function setStack(kind, idx, stack) {
        if (kind === "hot") hotbar[idx] = stack;
        else backpack[idx] = stack;
      }

      /** Merge same-id stacks or swap. Returns true if changed. */
      function transfer(fromKind, fromIdx, toKind, toIdx) {
        if (fromKind === toKind && fromIdx === toIdx) return false;
        const src = cloneStack(getStack(fromKind, fromIdx));
        if (!src) return false;
        const dst = cloneStack(getStack(toKind, toIdx));
        if (!dst) {
          setStack(toKind, toIdx, src);
          setStack(fromKind, fromIdx, null);
          return true;
        }
        if (dst.id === src.id) {
          const limit = stackLimit(src.id);
          const room = limit - dst.qty;
          if (room <= 0) {
            setStack(toKind, toIdx, src);
            setStack(fromKind, fromIdx, dst);
            return true;
          }
          const move = Math.min(room, src.qty);
          dst.qty += move;
          src.qty -= move;
          setStack(toKind, toIdx, dst);
          setStack(fromKind, fromIdx, src.qty > 0 ? src : null);
          return true;
        }
        setStack(toKind, toIdx, src);
        setStack(fromKind, fromIdx, dst);
        return true;
      }

      /** Shift-click: send to other container (first free / stack). */
      function quickMove(kind, idx) {
        const src = cloneStack(getStack(kind, idx));
        if (!src) return false;
        const toBag = kind === "hot";
        if (toBag && !bagOpen) bagOpen = true;
        const limit = stackLimit(src.id);
        let left = src.qty;
        setStack(kind, idx, null);
        const n = toBag ? BACKPACK_N : HOTBAR_N;
        const read = (i) => (toBag ? backpack[i] : hotbar[i]);
        const write = (i, s) => {
          if (toBag) backpack[i] = s;
          else hotbar[i] = s;
        };
        for (let i = 0; i < n && left > 0; i++) {
          const cur = read(i);
          if (!cur || cur.id !== src.id) continue;
          const room = limit - cur.qty;
          if (room <= 0) continue;
          const add = Math.min(room, left);
          cur.qty += add;
          left -= add;
          write(i, cur);
        }
        for (let i = 0; i < n && left > 0; i++) {
          if (read(i)) continue;
          const add = Math.min(limit, left);
          write(i, { id: src.id, qty: add });
          left -= add;
        }
        if (left > 0) setStack(kind, idx, { id: src.id, qty: left });
        return true;
      }

      function endDrag(clientX, clientY, asClick) {
        clearDropHover();
        root.classList.remove("is-dragging");
        paintGhost(null);
        const d = drag;
        drag = null;
        if (!d) return;
        if (!d.moved && asClick) {
          if (d.kind === "hot") {
            active = d.idx;
            bagFocus = -1;
            paint();
            emit();
          } else if (d.kind === "bag") {
            bagFocus = backpack[d.idx] ? d.idx : -1;
            paint();
          }
          return;
        }
        if (!d.moved) return;
        const target = slotFromPoint(clientX, clientY);
        if (target) {
          const toKind = target.dataset.kind === "hot" ? "hot" : "bag";
          const toIdx = Number(target.dataset.idx);
          if (toKind === "bag" && !bagOpen) {
            paint();
            return;
          }
          if (Number.isFinite(toIdx)) {
            transfer(d.kind, d.idx, toKind, toIdx);
          }
        }
        paint();
        emit();
      }

      function onPointerMove(ev) {
        if (!drag || ev.pointerId !== drag.pointerId) return;
        const dx = ev.clientX - drag.x;
        const dy = ev.clientY - drag.y;
        if (!drag.moved && (dx * dx + dy * dy) >= DRAG_THRESH * DRAG_THRESH) {
          drag.moved = true;
          root.classList.add("is-dragging");
          paintGhost(drag.stack);
          // Open bag without re-paint (keeps pointer capture on source button)
          if (!bagOpen) {
            bagOpen = true;
            bagEl.classList.add("is-open");
            bagEl.setAttribute("aria-hidden", "false");
          }
          const srcBtn = root.querySelector(
            '.fw-slot[data-kind="' + drag.kind + '"][data-idx="' + drag.idx + '"]'
          );
          if (srcBtn) srcBtn.classList.add("is-dragging-src");
        }
        if (drag.moved) {
          moveGhost(ev.clientX, ev.clientY);
          const over = slotFromPoint(ev.clientX, ev.clientY);
          if (over && !(over.dataset.kind === drag.kind && Number(over.dataset.idx) === drag.idx)) {
            setDropHover(over);
          } else {
            clearDropHover();
          }
        }
      }

      function onPointerUp(ev) {
        if (!drag || ev.pointerId !== drag.pointerId) return;
        try {
          if (ev.target && ev.target.releasePointerCapture) {
            ev.target.releasePointerCapture(ev.pointerId);
          }
        } catch (_) {}
        window.removeEventListener("pointermove", onPointerMove, true);
        window.removeEventListener("pointerup", onPointerUp, true);
        window.removeEventListener("pointercancel", onPointerUp, true);
        endDrag(ev.clientX, ev.clientY, true);
      }

      function bindSlotPointer(btn, kind, idx) {
        btn.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          const stack = getStack(kind, idx);
          if (!stack) {
            if (kind === "hot") {
              active = idx;
              paint();
              emit();
            }
            return;
          }
          if (ev.shiftKey) {
            ev.preventDefault();
            quickMove(kind, idx);
            paint();
            emit();
            return;
          }
          ev.preventDefault();
          drag = {
            kind,
            idx,
            pointerId: ev.pointerId,
            x: ev.clientX,
            y: ev.clientY,
            moved: false,
            stack: cloneStack(stack),
          };
          try { btn.setPointerCapture(ev.pointerId); } catch (_) {}
          btn.classList.add("is-dragging-src");
          window.addEventListener("pointermove", onPointerMove, true);
          window.addEventListener("pointerup", onPointerUp, true);
          window.addEventListener("pointercancel", onPointerUp, true);
        });
      }

      function paint() {
        clearDropHover();
        hotbarEl.innerHTML = "";
        for (let i = 0; i < HOTBAR_N; i++) {
          const b = document.createElement("button");
          b.type = "button";
          renderSlot(b, hotbar[i], i, true, i === active);
          if (drag && drag.kind === "hot" && drag.idx === i && drag.moved) {
            b.classList.add("is-dragging-src");
          }
          bindSlotPointer(b, "hot", i);
          hotbarEl.appendChild(b);
        }
        bagGrid.innerHTML = "";
        for (let i = 0; i < BACKPACK_N; i++) {
          const b = document.createElement("button");
          b.type = "button";
          renderSlot(b, backpack[i], i, false, bagOpen && i === bagFocus);
          if (drag && drag.kind === "bag" && drag.idx === i && drag.moved) {
            b.classList.add("is-dragging-src");
          }
          bindSlotPointer(b, "bag", i);
          bagGrid.appendChild(b);
        }
        bagEl.classList.toggle("is-open", bagOpen);
        bagEl.setAttribute("aria-hidden", bagOpen ? "false" : "true");

        // Inspect label for selected backpack item
        if (bagInspectEl) {
          const focusStack = bagFocus >= 0 ? backpack[bagFocus] : null;
          if (bagOpen && focusStack) {
            const def = DEFS[focusStack.id] || { label: focusStack.id };
            bagInspectEl.hidden = false;
            bagInspectEl.textContent = def.label + (focusStack.qty > 1 ? "  ·  ×" + focusStack.qty : "");
          } else {
            bagInspectEl.hidden = true;
            bagInspectEl.textContent = "";
          }
        }

        const held = hotbar[active];
        const def = held && DEFS[held.id];
        const focusStack = bagOpen && bagFocus >= 0 ? backpack[bagFocus] : null;
        const focusDef = focusStack && DEFS[focusStack.id];
        if (focusDef) {
          heldEl.textContent = focusDef.label
            + (focusStack.qty > 1 ? " × " + focusStack.qty : "");
        } else {
          heldEl.textContent = def ? ("En mano · " + def.label) : "En mano · —";
        }
      }

      function writeSlot(i, stack) {
        if (i < HOTBAR_N) hotbar[i] = stack;
        else backpack[i - HOTBAR_N] = stack;
      }

      function readSlot(i) {
        return i < HOTBAR_N ? hotbar[i] : backpack[i - HOTBAR_N];
      }

      /** Move resource stacks off the hotbar into the backpack (keeps 1–6 for tools). */
      function compactResourcesToBag() {
        for (let i = 0; i < HOTBAR_N; i++) {
          const s = hotbar[i];
          if (!s || prefersHotbar(s.id)) continue;
          let left = s.qty;
          hotbar[i] = null;
          const limit = stackLimit(s.id);
          for (let b = 0; b < BACKPACK_N && left > 0; b++) {
            const cur = backpack[b];
            if (cur && cur.id === s.id) {
              const room = limit - cur.qty;
              if (room <= 0) continue;
              const add = Math.min(room, left);
              cur.qty += add;
              left -= add;
              backpack[b] = cur;
            }
          }
          for (let b = 0; b < BACKPACK_N && left > 0; b++) {
            if (backpack[b]) continue;
            const add = Math.min(limit, left);
            backpack[b] = { id: s.id, qty: add };
            left -= add;
          }
          if (left > 0) hotbar[i] = { id: s.id, qty: left };
        }
      }

      function addItem(id, qty) {
        qty = qty | 0;
        if (!id || qty <= 0) return 0;
        const limit = stackLimit(id);
        let left = qty;
        const total = HOTBAR_N + BACKPACK_N;
        for (let i = 0; i < total && left > 0; i++) {
          const s = readSlot(i);
          if (!s || s.id !== id) continue;
          const room = limit - s.qty;
          if (room <= 0) continue;
          const add = Math.min(room, left);
          s.qty += add;
          left -= add;
          writeSlot(i, s);
        }
        const order = [];
        if (prefersHotbar(id)) {
          for (let i = 0; i < total; i++) order.push(i);
        } else {
          for (let i = HOTBAR_N; i < total; i++) order.push(i);
          for (let i = 0; i < HOTBAR_N; i++) order.push(i);
        }
        for (let oi = 0; oi < order.length && left > 0; oi++) {
          const i = order[oi];
          if (readSlot(i)) continue;
          const add = Math.min(limit, left);
          writeSlot(i, { id, qty: add });
          left -= add;
        }
        paint();
        emit();
        return qty - left;
      }

      function tryConsume(id, qty) {
        qty = qty | 0;
        if (!id || qty <= 0) return false;
        let have = 0;
        const total = HOTBAR_N + BACKPACK_N;
        for (let i = 0; i < total; i++) {
          const s = readSlot(i);
          if (s && s.id === id) have += s.qty;
        }
        if (have < qty) return false;
        let need = qty;
        for (let i = 0; i < total && need > 0; i++) {
          const s = readSlot(i);
          if (!s || s.id !== id) continue;
          const take = Math.min(s.qty, need);
          s.qty -= take;
          need -= take;
          writeSlot(i, s.qty > 0 ? s : null);
        }
        paint();
        emit();
        return true;
      }

      function countOf(id) {
        let n = 0;
        const total = HOTBAR_N + BACKPACK_N;
        for (let i = 0; i < total; i++) {
          const s = readSlot(i);
          if (s && s.id === id) n += s.qty;
        }
        return n;
      }

      function getActive() {
        const s = hotbar[active];
        if (!s) return null;
        const def = DEFS[s.id] || {};
        return { id: s.id, qty: s.qty, kind: def.kind || "none", label: def.label || s.id };
      }

      function toggleBag() {
        bagOpen = !bagOpen;
        if (!bagOpen) bagFocus = -1;
        paint();
      }

      function setActive(i) {
        active = Math.max(0, Math.min(HOTBAR_N - 1, i | 0));
        bagFocus = -1;
        paint();
        emit();
      }

      function hotbarIndexFromEvent(e) {
        const digit = e.code && e.code.match(/^Digit([1-6])$/);
        if (digit) return Number(digit[1]) - 1;
        const numpad = e.code && e.code.match(/^Numpad([1-6])$/);
        if (numpad) return Number(numpad[1]) - 1;
        if (e.key >= "1" && e.key <= "6") return Number(e.key) - 1;
        return -1;
      }

      const onKey = (e) => {
        if (e.repeat) return;
        if (e.code === "Tab") {
          e.preventDefault();
          try {
            if (window.__fw && typeof window.__fw.onTab === "function" && window.__fw.onTab()) {
              return;
            }
          } catch (_) {}
          toggleBag();
          return;
        }
        if (e.code === "KeyI") {
          e.preventDefault();
          toggleBag();
          return;
        }
        const n = hotbarIndexFromEvent(e);
        if (n >= 0) {
          e.preventDefault();
          setActive(n);
        }
      };
      window.addEventListener("keydown", onKey, true);

      compactResourcesToBag();
      paint();
      emit();

      try {
        if (window.FalseWorldItemIcons && typeof window.FalseWorldItemIcons.ready === "function") {
          window.FalseWorldItemIcons.ready().then(() => paint());
        }
      } catch (_) {}

      return {
        addItem,
        tryConsume,
        countOf,
        getActive,
        setActive,
        toggleBag,
        destroy() {
          window.removeEventListener("keydown", onKey, true);
          window.removeEventListener("pointermove", onPointerMove, true);
          window.removeEventListener("pointerup", onPointerUp, true);
          window.removeEventListener("pointercancel", onPointerUp, true);
          try { root.remove(); } catch (_) {}
        },
      };
    },
  };
})();
