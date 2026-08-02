/** False World progression — scrap · research · Rust tech tree (T1–T3). v3 */
(function () {
  const STORAGE_KEY = "fw_unlocked_blueprints_v1";

  /**
   * Tech trees by workbench tier (independent — like Rust).
   * dependency = prior node id in same tier (must unlock first; no skipping).
   * col/row = canvas grid (top → bottom progression).
   * wb = workbench tier that owns this tree.
   */
  const TECH_TREE = {
    tier1: [
      { id: "t1_lock", label: "Cerradura", cost: 20, rarity: "common", unlocks: "key_lock", dependency: null, icon: "key_lock", wb: 1, col: 0, row: 0 },
      { id: "t1_door", label: "Puerta metal", cost: 75, rarity: "uncommon", unlocks: "metal_door", dependency: "t1_lock", icon: "metal_door", wb: 1, col: 0, row: 1 },
      { id: "t1_satchel", label: "Satchel", cost: 75, rarity: "rare", unlocks: "satchel", dependency: null, icon: "satchel", wb: 1, col: 2, row: 0 },
      { id: "t1_rocket", label: "Cohete", cost: 125, rarity: "very_rare", unlocks: "rocket", dependency: "t1_satchel", icon: "rocket", wb: 1, col: 2, row: 1 },
    ],
    tier2: [
      { id: "t2_c4", label: "C4", cost: 250, rarity: "very_rare", unlocks: "c4", dependency: null, icon: "c4", wb: 2, col: 1, row: 0 },
    ],
    tier3: [],
  };

  const TIER_META = {
    tier1: { n: 1, label: "Tier 1", blurb: "Workbench T1 · herramientas / armas básicas" },
    tier2: { n: 2, label: "Tier 2", blurb: "Workbench T2 · equipo medio" },
    tier3: { n: 3, label: "Tier 3", blurb: "Workbench T3 · élite / explosivos" },
  };

  /** Always known (no scrap / no research). */
  const DEFAULT_UNLOCKED = [
    "workbench_1", "research_table", "tool_cupboard_item",
    "hammer_tool", "rock_tool", "build_plan",
    "campfire", "sleeping_bag", "box_small", "box_large",
  ];

  /**
   * Recipes.
   * kind: "quick" = inventario / sin WB · "advanced" = necesita plano + WB tier
   */
  const RECIPES = [
    {
      id: "workbench_1",
      label: "Mesa T1",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: false,
      costs: [
        { id: "wood", qty: 500 },
        { id: "metal", qty: 100 },
      ],
    },
    {
      id: "workbench_2",
      label: "Mesa T2",
      kind: "advanced",
      qty: 1,
      wb: 1,
      needsBp: false,
      costs: [
        { id: "wood", qty: 500 },
        { id: "metal", qty: 500 },
      ],
    },
    {
      id: "workbench_3",
      label: "Mesa T3",
      kind: "advanced",
      qty: 1,
      wb: 2,
      needsBp: false,
      costs: [
        { id: "metal", qty: 1000 },
        { id: "hq", qty: 100 },
      ],
    },
    {
      id: "research_table",
      label: "Mesa investigación",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: false,
      costs: [
        { id: "metal", qty: 200 },
      ],
    },
    {
      id: "key_lock",
      label: "Cerradura",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: true,
      costs: [{ id: "metal", qty: 25 }],
    },
    {
      id: "tool_cupboard_item",
      label: "Armario",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: false,
      costs: [{ id: "wood", qty: 100 }, { id: "stone", qty: 50 }],
    },
    {
      id: "campfire",
      label: "Fogata",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: false,
      costs: [{ id: "wood", qty: 50 }, { id: "stone", qty: 20 }],
    },
    {
      id: "sleeping_bag",
      label: "Saco dormir",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: false,
      costs: [{ id: "cloth", qty: 30 }],
    },
    {
      id: "box_small",
      label: "Caja pequeña",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: false,
      costs: [{ id: "wood", qty: 50 }],
    },
    {
      id: "box_large",
      label: "Caja grande",
      kind: "quick",
      qty: 1,
      wb: 0,
      needsBp: false,
      costs: [{ id: "wood", qty: 100 }],
    },
    {
      id: "metal_door",
      label: "Puerta metal",
      kind: "advanced",
      qty: 1,
      wb: 1,
      needsBp: true,
      costs: [{ id: "metal", qty: 200 }],
    },
    {
      id: "satchel",
      label: "Satchel",
      kind: "advanced",
      qty: 1,
      wb: 1,
      needsBp: true,
      costs: [{ id: "metal", qty: 40 }, { id: "sulfur", qty: 20 }],
    },
    {
      id: "rocket",
      label: "Cohete",
      kind: "advanced",
      qty: 1,
      wb: 1,
      needsBp: true,
      costs: [{ id: "metal", qty: 100 }, { id: "sulfur", qty: 150 }],
    },
    {
      id: "c4",
      label: "C4",
      kind: "advanced",
      qty: 1,
      wb: 2,
      needsBp: true,
      costs: [{ id: "metal", qty: 20 }, { id: "sulfur", qty: 220 }, { id: "hq", qty: 10 }],
    },
  ];

  /** Research table: sacrifice 1 item + scrap (max 120) → permanent blueprint. */
  const RESEARCH = {
    key_lock: 20,
    metal_door: 75,
    satchel: 75,
    rocket: 125,
    c4: 250,
  };


  const RECIPE_CAT = {
    workbench_1: "items", workbench_2: "items", workbench_3: "items",
    research_table: "items",
    key_lock: "construction", tool_cupboard_item: "construction",
    campfire: "items", sleeping_bag: "items",
    box_small: "items", box_large: "items",
    metal_door: "construction",
    satchel: "weapons", rocket: "weapons", c4: "weapons",
  };
  const CAT_ORDER = [
    { id: "favourite", label: "FAVOURITE" },
    { id: "common", label: "COMMON" },
    { id: "construction", label: "CONSTRUCTION" },
    { id: "items", label: "ITEMS" },
    { id: "tools", label: "TOOLS" },
    { id: "weapons", label: "WEAPONS" },
    { id: "other", label: "OTHER" },
  ];

  const DESCRIPTIONS = {
    workbench_1: "Mesa T1 (500 madera · 100 metal · sin scrap). E cerca: Tech Tree + craft avanzado.",
    workbench_2: "Mesa T2 (500 madera · 500 metal · sin scrap). Requiere WB T1 cerca.",
    workbench_3: "Mesa T3 (1000 metal · 100 HQM · sin scrap). Requiere WB T2 cerca.",
    research_table: "Mesa de investigación (200 metal). Sacrifica 1 objeto + scrap (máx 120) → plano permanente.",
    key_lock: "Cierra puertas. Common · 20 scrap en research/tech.",
    metal_door: "Puerta de metal. Uncommon · 75 scrap.",
    satchel: "Explosivo · radio 4 m · soft ×1.1. Rare · 75 scrap. LMB coloca con mecha.",
    rocket: "Cohete · splash ~4 paredes. Very rare · 125 scrap. LMB dispara.",
    c4: "C4 · alto daño estructural. Very rare · 250 scrap (T2). LMB coloca.",
    tool_cupboard_item: "Armario de herramientas. Privilege 25 m y upkeep de la base.",
    scrap: "Chatarra. Solo para Tech Tree e investigación (máx 120/ítem). Barriles → scrap.",
    cloth: "Tela. Cosecha de árboles · fabrica sacos de dormir (×30).",
    food: "Comida. LMB para comer · restaura hambre.",
    sleeping_bag: "Punto de respawn. Colócalo fuera pero cerca de la base (airlock tip).",
    campfire: "Calor + confort. Bloquea frío nocturno · regenera vida con hambre >100.",
    box_small: "6 slots. Dispersa botín por la base.",
    box_large: "12 slots. No guardes todo en una sola habitación.",
    hammer_tool: "Mejora y repara. RMB/R · Y voltea soft/hard side. Soft melee ×10.",
    build_plan: "Plano de construcción. RMB mantiene la rueda de piezas.",
  };

  function iconUrl(id) {
    try {
      return (window.FalseWorldItemIcons && window.FalseWorldItemIcons.url(id)) || null;
    } catch (_) {
      return null;
    }
  }

  function loadUnlocked() {
    const set = new Set(DEFAULT_UNLOCKED);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) arr.forEach((id) => set.add(String(id)));
      }
    } catch (_) {}
    return set;
  }

  function saveUnlocked(set) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch (_) {}
  }

  function nodeUnlocked(node, unlockedNodes) {
    if (!node.dependency) return true;
    return unlockedNodes.has(node.dependency);
  }

  function findTechNode(techId) {
    for (const tier of Object.keys(TECH_TREE)) {
      const n = TECH_TREE[tier].find((x) => x.id === techId);
      if (n) return n;
    }
    return null;
  }

  function allTechNodes() {
    const out = [];
    for (const tier of Object.keys(TECH_TREE)) {
      for (const n of TECH_TREE[tier]) out.push(n);
    }
    return out;
  }

  window.FalseWorldProgression = {
    TECH_TREE,
    RECIPES,
    RESEARCH,
    DEFAULT_UNLOCKED,

    create(host, opts) {
      opts = opts || {};
      const inv = opts.inv || null;
      const onHud = opts.onHud || (() => {});
      const onChange = opts.onBlueprintsChange || (() => {});
      const getWb = opts.getWorkbench || (() => ({ inRange: false, tier: 0 }));

      let unlocked = loadUnlocked();
      let unlockedNodes = new Set();
      for (const n of allTechNodes()) {
        if (unlocked.has(n.unlocks)) unlockedNodes.add(n.id);
      }

      let open = false;
      let tab = "quick"; // quick | tech | research
      let fullMenu = false;
      let craftSel = null;
      let craftQty = 1;
      /** @type {"craft"|"workbench"|"research"} */
      let uiMode = "craft";
      let tableForced = false; // opened via E on entity
      /** Tier of the workbench that forced-open the UI (E). Badge used ||1 while buy used 0. */
      let forcedWbTier = 1;
      let researchPick = null;
      let tipEl = null;
      let rmbHoldTimer = null;
      let rmbTarget = null;
      /** Selected tech-tree node id (detail strip). */
      let techSel = null;
      /** Which tier canvas is showing (1–3). */
      let techViewTier = 1;
      const techCam = { x: 0, y: 0, z: 1, dragging: false, lx: 0, ly: 0, seeded: false };

      const root = document.createElement("div");
      root.id = "fw-prog";
      root.className = "fw-prog";
      root.setAttribute("aria-hidden", "true");
      root.innerHTML =
        '<div class="fw-prog-panel">' +
        '  <div class="fw-prog-head">' +
        '    <span class="fw-prog-title" id="fw-prog-title">CRAFTING</span>' +
        '    <span class="fw-prog-wb" id="fw-prog-wb">WB · fuera de rango</span>' +
        '    <button type="button" class="fw-prog-close" id="fw-prog-close" aria-label="Cerrar">×</button>' +
        '    <kbd id="fw-prog-kbd">Tab</kbd>' +
        "  </div>" +
        '  <div class="fw-prog-tabs" id="fw-prog-tabs">' +
        '    <button type="button" data-tab="quick" class="is-on">Rápida</button>' +
        '    <button type="button" data-tab="tech">Tech Tree</button>' +
        '    <button type="button" data-tab="research">Investigar</button>' +
        "  </div>" +
        '  <div class="fw-prog-body" id="fw-prog-body"></div>' +
        '  <p class="fw-prog-foot" id="fw-prog-foot"></p>' +
        '  <div class="fw-prog-tip" id="fw-prog-tip" hidden></div>' +
        "</div>";
      (host || document.querySelector(".stage") || document.body).appendChild(root);

      const body = root.querySelector("#fw-prog-body");
      const wbEl = root.querySelector("#fw-prog-wb");
      const foot = root.querySelector("#fw-prog-foot");
      const titleEl = root.querySelector("#fw-prog-title");
      const kbdEl = root.querySelector("#fw-prog-kbd");
      const tabsEl = root.querySelector("#fw-prog-tabs");
      tipEl = root.querySelector("#fw-prog-tip");

      const closeBtn = root.querySelector("#fw-prog-close");
      if (closeBtn) closeBtn.addEventListener("click", () => closeUi());

      root.querySelector(".fw-prog-tabs").addEventListener("click", (ev) => {
        const btn = ev.target.closest("[data-tab]");
        if (!btn) return;
        tab = btn.getAttribute("data-tab");
        root.querySelectorAll(".fw-prog-tabs button").forEach((b) => {
          b.classList.toggle("is-on", b.getAttribute("data-tab") === tab);
        });
        paint();
      });

      function hideTip() {
        if (tipEl) {
          tipEl.hidden = true;
          tipEl.textContent = "";
        }
        rmbTarget = null;
        if (rmbHoldTimer) {
          clearTimeout(rmbHoldTimer);
          rmbHoldTimer = null;
        }
      }

      function showTip(text, x, y) {
        if (!tipEl || !text) return;
        tipEl.hidden = false;
        tipEl.textContent = text;
        const panel = root.querySelector(".fw-prog-panel");
        const pr = panel.getBoundingClientRect();
        tipEl.style.left = Math.max(8, Math.min(pr.width - 180, x - pr.left)) + "px";
        tipEl.style.top = Math.max(8, y - pr.top + 12) + "px";
      }

      function tipForEl(el) {
        if (!el) return "";
        const craft = el.getAttribute("data-craft");
        const tech = el.getAttribute("data-tech");
        const res = el.getAttribute("data-res");
        if (craft) return DESCRIPTIONS[craft] || ("Fabricar " + craft);
        if (tech) {
          const n = findTechNode(tech);
          return n
            ? ((DESCRIPTIONS[n.unlocks] || n.label) + " · " + n.cost + " scrap → plano permanente · WB T" + Math.max(1, needWbTier(n.wb)))
            : "";
        }
        if (res) {
          return (DESCRIPTIONS[res] || res) + " · sacrifica 1× + " + RESEARCH[res] + " scrap → plano permanente";
        }
        return "";
      }

      function bindRmbTips(scope) {
        scope.querySelectorAll("[data-craft],[data-tech],[data-res]").forEach((el) => {
          el.addEventListener("contextmenu", (ev) => ev.preventDefault());
          el.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 2) return;
            ev.preventDefault();
            rmbTarget = el;
            hideTip();
            rmbHoldTimer = setTimeout(() => {
              if (rmbTarget === el) showTip(tipForEl(el), ev.clientX, ev.clientY);
            }, 220);
          });
          el.addEventListener("pointerup", (ev) => {
            if (ev.button === 2) hideTip();
          });
          el.addEventListener("pointerleave", () => {
            if (rmbTarget === el) hideTip();
          });
        });
      }

      function syncChrome() {
        const titles = {
          craft: "FABRICACIÓN",
          workbench: "MESA DE TRABAJO",
          research: "MESA DE INVESTIGACIÓN",
        };
        if (titleEl) titleEl.textContent = titles[uiMode] || titles.craft;
        if (kbdEl) kbdEl.textContent = uiMode === "craft" ? "Q" : "E / Tab";
        if (tabsEl) {
          const showQuick = uiMode === "craft" || uiMode === "workbench";
          const showTech = uiMode === "craft" || uiMode === "workbench";
          const showRes = uiMode === "craft" || uiMode === "research";
          tabsEl.querySelector('[data-tab="quick"]').style.display = showQuick ? "" : "none";
          tabsEl.querySelector('[data-tab="tech"]').style.display = showTech ? "" : "none";
          tabsEl.querySelector('[data-tab="research"]').style.display = showRes ? "" : "none";
          tabsEl.querySelectorAll("button").forEach((b) => {
            b.classList.toggle("is-on", b.getAttribute("data-tab") === tab);
          });
        }
      }

      function scrapCount() {
        return inv && typeof inv.countOf === "function" ? inv.countOf("scrap") | 0 : 0;
      }

      function hasBp(id) {
        return unlocked.has(id);
      }

      /** Normalize WB tier: NEVER use `x | 1` (turns T2 into T3). */
      function asWbTier(v) {
        const n = v | 0;
        return n >= 1 ? n : 1;
      }
      /** Tech/recipe requirement (0 means none). */
      function needWbTier(v) {
        return Math.max(0, v | 0);
      }

      /** Effective WB tier: proximity OR the table you opened with E. */
      function effectiveWbTier() {
        const wb = getWb();
        let t = wb.tier | 0;
        if (uiMode === "workbench" && tableForced) {
          t = Math.max(t, asWbTier(forcedWbTier));
        }
        return t;
      }

      /** Tech Tree requires standing at a workbench (or E-open on one). */
      function techTreeReady() {
        if (uiMode === "workbench" && tableForced) return true;
        const wb = getWb();
        return !!(wb.inRange && (wb.tier | 0) >= 1);
      }

      /** Research only at a research table (E-open). */
      function researchTableReady() {
        return uiMode === "research" && tableForced;
      }

      function recipeState(r) {
        const wb = getWb();
        const bpOk = !r.needsBp || hasBp(r.id);
        const effTier = effectiveWbTier();
        const nearOk = (uiMode === "workbench" && tableForced && effTier >= (r.wb | 0))
          || (wb.inRange && (wb.tier | 0) >= (r.wb | 0));
        const wbOk = (r.wb | 0) <= 0 || nearOk;
        let matsOk = true;
        const missing = [];
        for (let i = 0; i < r.costs.length; i++) {
          const c = r.costs[i];
          const have = inv ? inv.countOf(c.id) : 0;
          if (have < c.qty) {
            matsOk = false;
            missing.push(c.id + " ×" + c.qty);
          }
        }
        return { bpOk, wbOk, matsOk, can: bpOk && wbOk && matsOk, missing, wb };
      }

      function craftRecipe(r) {
        const st = recipeState(r);
        if (!st.bpOk) {
          onHud({ status: "Sin plano · investiga o compra en Tech Tree" });
          return false;
        }
        if (!st.wbOk) {
          onHud({ status: "Necesitas Mesa T" + r.wb + " · acércate (<2 m) o pulsa E" });
          return false;
        }
        if (!st.matsOk) {
          onHud({ status: "Faltan: " + st.missing.join(", ") });
          return false;
        }
        for (let i = 0; i < r.costs.length; i++) {
          if (!inv.tryConsume(r.costs[i].id, r.costs[i].qty)) {
            onHud({ status: "Error al consumir materiales" });
            return false;
          }
        }
        const got = inv.addItem(r.id, r.qty);
        onHud({ status: "Fabricado · " + r.label + (got ? " ×" + got : "") });
        paint();
        return true;
      }

      function buyTech(node) {
        if (!techTreeReady()) {
          onHud({ status: "Tech Tree · acércate a una Mesa de trabajo (<2 m) o pulsa E" });
          return false;
        }
        const needTier = Math.max(1, needWbTier(node.wb));
        const haveTier = effectiveWbTier();
        if (haveTier < needTier) {
          onHud({ status: "Necesitas Workbench T" + needTier + " (tienes T" + haveTier + ")" });
          return false;
        }
        if (unlockedNodes.has(node.id)) {
          onHud({ status: "Ya desbloqueado" });
          return false;
        }
        if (!nodeUnlocked(node, unlockedNodes)) {
          onHud({ status: "Bloqueado · desbloquea el anterior en la rama" });
          return false;
        }
        if (scrapCount() < node.cost) {
          onHud({ status: "Sin scrap · ×" + node.cost });
          return false;
        }
        if (!inv.tryConsume("scrap", node.cost)) return false;
        unlockedNodes.add(node.id);
        unlocked.add(node.unlocks);
        saveUnlocked(unlocked);
        onChange(Array.from(unlocked));
        onHud({ status: "Plano permanente · " + node.label + " (−" + node.cost + " scrap)" });
        paint();
        return true;
      }

      function researchItem(itemId) {
        if (!researchTableReady()) {
          onHud({ status: "Usa E en una Mesa de investigación" });
          return false;
        }
        const cost = RESEARCH[itemId];
        if (cost == null) {
          onHud({ status: "No se puede investigar" });
          return false;
        }
        if (hasBp(itemId)) {
          onHud({ status: "Ya conoces este plano" });
          return false;
        }
        if ((inv.countOf(itemId) | 0) < 1) {
          onHud({ status: "Necesitas 1× del objeto en inventario (se destruye)" });
          return false;
        }
        if (scrapCount() < cost) {
          onHud({ status: "Sin scrap · ×" + cost });
          return false;
        }
        if (!inv.tryConsume(itemId, 1)) return false;
        if (!inv.tryConsume("scrap", cost)) {
          inv.addItem(itemId, 1);
          return false;
        }
        unlocked.add(itemId);
        for (const n of allTechNodes()) {
          if (n.unlocks === itemId) unlockedNodes.add(n.id);
        }
        saveUnlocked(unlocked);
        onChange(Array.from(unlocked));
        onHud({ status: "Investigado · plano permanente · " + itemId + " (−1 objeto · −" + cost + " scrap)" });
        researchPick = null;
        paint();
        return true;
      }

      function paintQuick() {
        const list = RECIPES.filter((r) => {
          if (uiMode === "workbench") return r.kind === "advanced" || r.id === "key_lock";
          return r.kind === "quick" || r.kind === "advanced";
        });
        let html = '<div class="fw-prog-scrap">Scrap · <strong>' + scrapCount() + "</strong></div>";
        html += '<div class="fw-prog-grid">';
        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          const st = recipeState(r);
          let cls = "is-craft";
          if (!st.bpOk) cls += " is-locked";
          else if (!st.wbOk) cls += " is-nowb";
          else if (!st.matsOk) cls += " is-short";
          else cls += " is-ready";
          const costTxt = r.costs.map((c) => c.qty + " " + c.id).join(" · ");
          const gate = !st.bpOk
            ? "Sin plano"
            : (!st.wbOk ? "Mesa T" + r.wb + " requerida" : costTxt);
          html +=
            '<button type="button" class="fw-prog-card ' + cls + '" data-craft="' + r.id + '">' +
            (iconUrl(r.id)
              ? '<img class="fw-prog-icon" alt="" src="' + iconUrl(r.id) + '" draggable="false">'
              : '<span class="fw-prog-blob" data-id="' + r.id + '"></span>') +
            '<div class="fw-prog-card-meta">' +
            '  <div class="fw-prog-card-name">' + r.label + (r.kind === "advanced" ? " · ADV" : "") + "</div>" +
            '  <div class="fw-prog-card-sub">' + gate + "</div>" +
            "</div></button>";
        }
        html += "</div>";
        body.innerHTML = html;
        body.querySelectorAll("[data-craft]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const r = RECIPES.find((x) => x.id === btn.getAttribute("data-craft"));
            if (r) craftRecipe(r);
          });
        });
        bindRmbTips(body);
        foot.textContent = "Rápida = fabricar · Tech Tree = desbloquear (LMB también fabrica si ya aprendiste).";
      }

      function tierKeyFor(n) {
        return n === 3 ? "tier3" : (n === 2 ? "tier2" : "tier1");
      }

      function nodeCenter(n) {
        const CELL = 72;
        const COL_GAP = 56;
        const ROW_GAP = 64;
        const ox = 80;
        const oy = 56;
        const x = ox + (n.col | 0) * (CELL + COL_GAP) + CELL * 0.5;
        const y = oy + (n.row | 0) * (CELL + ROW_GAP) + CELL * 0.5;
        return { x, y, cell: CELL };
      }

      function paintTech() {
        const haveTier = effectiveWbTier();
        // At a workbench: show that bench's tree. From craft menu: clamp to max WB you can use.
        if (uiMode === "workbench" && tableForced) {
          techViewTier = Math.max(1, Math.min(3, haveTier));
        } else if (techViewTier > Math.max(1, haveTier) && haveTier >= 1) {
          techViewTier = Math.max(1, haveTier);
        }
        techViewTier = Math.max(1, Math.min(3, techViewTier | 0));

        const tKey = tierKeyFor(techViewTier);
        const meta = TIER_META[tKey];
        const nodes = TECH_TREE[tKey] || [];
        const byId = Object.create(null);
        for (let i = 0; i < nodes.length; i++) byId[nodes[i].id] = nodes[i];

        let maxCol = 0, maxRow = 0;
        for (let i = 0; i < nodes.length; i++) {
          maxCol = Math.max(maxCol, nodes[i].col | 0);
          maxRow = Math.max(maxRow, nodes[i].row | 0);
        }
        const CELL = 72;
        const COL_GAP = 56;
        const ROW_GAP = 64;
        const worldW = 80 + (maxCol + 1) * (CELL + COL_GAP) + 120;
        const worldH = 56 + (maxRow + 1) * (CELL + ROW_GAP) + 140;

        if (!techCam.seeded) {
          techCam.x = 40;
          techCam.y = 28;
          techCam.z = 1;
          techCam.seeded = true;
        }

        const ready = techTreeReady();
        const canBuyOnThisTier = ready && haveTier >= techViewTier;

        let html = '<div class="fw-tt">';
        html += '<div class="fw-tt-top">';
        html += '<div class="fw-tt-scrap">Scrap · <strong>' + scrapCount() + "</strong>";
        if (!ready) html += ' <span class="fw-prog-warn">· sin mesa</span>';
        else if (!canBuyOnThisTier) html += ' <span class="fw-prog-warn">· requiere WB T' + techViewTier + "</span>";
        html += "</div>";
        html += '<div class="fw-tt-tiers">';
        for (let ti = 1; ti <= 3; ti++) {
          html +=
            '<button type="button" class="fw-tt-tier-btn' +
            (techViewTier === ti ? " is-on" : "") +
            (haveTier < ti ? " is-gated" : "") +
            '" data-tt-tier="' + ti + '">' +
            "T" + ti +
            "</button>";
        }
        html += "</div>";
        html += '<div class="fw-tt-hint">Arrastra · rueda zoom · LMB selecciona</div>';
        html += "</div>";

        html += '<div class="fw-tt-viewport" id="fw-tt-viewport">';
        html +=
          '<div class="fw-tt-world" id="fw-tt-world" style="width:' + worldW +
          "px;height:" + worldH + "px;transform:translate(" + techCam.x + "px," + techCam.y +
          "px) scale(" + techCam.z + ')">';

        // Connector lines
        html += '<svg class="fw-tt-lines" width="' + worldW + '" height="' + worldH + '" aria-hidden="true">';
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (!n.dependency || !byId[n.dependency]) continue;
          const a = nodeCenter(byId[n.dependency]);
          const b = nodeCenter(n);
          const ownedParent = unlockedNodes.has(n.dependency) || hasBp(byId[n.dependency].unlocks);
          html +=
            '<path d="M' + a.x + " " + (a.y + a.cell * 0.5) +
            " L" + a.x + " " + ((a.y + b.y) * 0.5) +
            " L" + b.x + " " + ((a.y + b.y) * 0.5) +
            " L" + b.x + " " + (b.y - b.cell * 0.5) +
            '" class="fw-tt-edge' + (ownedParent ? " is-lit" : "") + '"/>';
        }
        html += "</svg>";

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const c = nodeCenter(n);
          const owned = unlockedNodes.has(n.id) || hasBp(n.unlocks);
          const depOk = nodeUnlocked(n, unlockedNodes);
          const canBuy = !owned && depOk && canBuyOnThisTier && scrapCount() >= n.cost;
          const recipe = RECIPES.find((r) => r.id === n.unlocks);
          const st = recipe ? recipeState(recipe) : null;
          const canCraft = !!(owned && recipe && st && st.can);
          let cls = "fw-tt-node";
          if (techSel === n.id) cls += " is-sel";
          if (owned) cls += " is-owned";
          else if (canBuy) cls += " is-buyable";
          else if (!depOk || !canBuyOnThisTier) cls += " is-locked";
          else cls += " is-short";
          if (canCraft) cls += " is-craftable";

          html +=
            '<button type="button" class="' + cls + '" data-tech="' + n.id + '"' +
            ' style="left:' + (c.x - c.cell * 0.5) + "px;top:" + (c.y - c.cell * 0.5) +
            "px;width:" + c.cell + "px;height:" + c.cell + 'px" title="' + n.label + '">' +
            (iconUrl(n.icon)
              ? '<img class="fw-tt-icon" alt="" src="' + iconUrl(n.icon) + '" draggable="false">'
              : '<span class="fw-tt-blob" data-id="' + n.icon + '"></span>') +
            (!owned ? '<span class="fw-tt-lock" aria-hidden="true"></span>' : "") +
            "</button>";
        }

        if (!nodes.length) {
          html += '<div class="fw-tt-empty">Tier ' + techViewTier + " · sin nodos todavía</div>";
        }

        html += "</div></div>"; // world + viewport

        // Detail strip
        const sel = techSel ? findTechNode(techSel) : null;
        html += '<div class="fw-tt-dock">';
        html += '<div class="fw-tt-dock-tier">' + (meta ? meta.label : ("Tier " + techViewTier)) + "</div>";
        if (sel && (sel.wb | 0) === techViewTier) {
          const owned = unlockedNodes.has(sel.id) || hasBp(sel.unlocks);
          const depOk = nodeUnlocked(sel, unlockedNodes);
          const canBuy = !owned && depOk && canBuyOnThisTier && scrapCount() >= sel.cost;
          const recipe = RECIPES.find((r) => r.id === sel.unlocks);
          const st = recipe ? recipeState(recipe) : null;
          html += '<div class="fw-tt-dock-main">';
          html += '<div class="fw-tt-dock-name">' + sel.label + "</div>";
          html += '<div class="fw-tt-dock-sub">';
          if (owned) {
            html += "Plano aprendido";
            if (recipe && st && !st.matsOk) html += " · faltan " + st.missing.join(", ");
            else if (recipe && st && !st.wbOk) html += " · Mesa T" + recipe.wb + " para fabricar";
          } else if (!depOk) html += "Bloqueado · desbloquea el anterior en la rama";
          else if (!canBuyOnThisTier) html += "Requiere Workbench T" + techViewTier;
          else html += sel.cost + " scrap para desbloquear";
          html += "</div></div>";
          if (!owned) {
            html +=
              '<button type="button" class="fw-tt-unlock" data-tt-buy="' + sel.id + '"' +
              (!canBuy ? " disabled" : "") + ">Desbloquear · " + sel.cost + " scrap</button>";
          } else if (recipe) {
            html +=
              '<button type="button" class="fw-tt-unlock is-craft" data-tt-craft="' + recipe.id + '"' +
              (!(st && st.can) ? " disabled" : "") + ">Fabricar</button>";
          }
        } else {
          html += '<div class="fw-tt-dock-main"><div class="fw-tt-dock-name">' +
            (meta ? meta.blurb : "") +
            '</div><div class="fw-tt-dock-sub">Selecciona un ítem · progresión lineal por rama · sin saltos</div></div>';
        }
        html += "</div></div>"; // dock + fw-tt

        body.innerHTML = html;
        root.classList.add("is-tech-view");

        const viewport = body.querySelector("#fw-tt-viewport");
        const world = body.querySelector("#fw-tt-world");

        function applyCam() {
          if (!world) return;
          world.style.transform =
            "translate(" + techCam.x + "px," + techCam.y + "px) scale(" + techCam.z + ")";
        }

        if (viewport) {
          viewport.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0) return;
            if (ev.target.closest && ev.target.closest(".fw-tt-node")) return;
            techCam.dragging = true;
            techCam.lx = ev.clientX;
            techCam.ly = ev.clientY;
            try { viewport.setPointerCapture(ev.pointerId); } catch (_) {}
          });
          viewport.addEventListener("pointermove", (ev) => {
            if (!techCam.dragging) return;
            const dx = ev.clientX - techCam.lx;
            const dy = ev.clientY - techCam.ly;
            techCam.lx = ev.clientX;
            techCam.ly = ev.clientY;
            techCam.x += dx;
            techCam.y += dy;
            applyCam();
          });
          const endDrag = (ev) => {
            techCam.dragging = false;
            try { viewport.releasePointerCapture(ev.pointerId); } catch (_) {}
          };
          viewport.addEventListener("pointerup", endDrag);
          viewport.addEventListener("pointercancel", endDrag);
          viewport.addEventListener("wheel", (ev) => {
            ev.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const mx = ev.clientX - rect.left;
            const my = ev.clientY - rect.top;
            const prev = techCam.z;
            const next = Math.max(0.45, Math.min(1.85, prev * (ev.deltaY < 0 ? 1.1 : 0.9)));
            // Zoom toward cursor
            techCam.x = mx - (mx - techCam.x) * (next / prev);
            techCam.y = my - (my - techCam.y) * (next / prev);
            techCam.z = next;
            applyCam();
          }, { passive: false });
        }

        body.querySelectorAll("[data-tt-tier]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const t = Number(btn.getAttribute("data-tt-tier")) | 0;
            if (t >= 1 && t <= 3) {
              techViewTier = t;
              techSel = null;
              techCam.seeded = false;
              paint();
            }
          });
        });

        body.querySelectorAll("[data-tech]").forEach((btn) => {
          btn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const id = btn.getAttribute("data-tech");
            techSel = id;
            paint();
          });
        });

        const buyBtn = body.querySelector("[data-tt-buy]");
        if (buyBtn) {
          buyBtn.addEventListener("click", () => {
            const n = findTechNode(buyBtn.getAttribute("data-tt-buy"));
            if (n) buyTech(n);
          });
        }
        const craftBtn = body.querySelector("[data-tt-craft]");
        if (craftBtn) {
          craftBtn.addEventListener("click", () => {
            const r = RECIPES.find((x) => x.id === craftBtn.getAttribute("data-tt-craft"));
            if (r) craftRecipe(r);
          });
        }

        bindRmbTips(body);
        foot.textContent = "Tech Tree T" + techViewTier +
          " · paga scrap en orden · investigación en mesa aparte sigue disponible";
      }

      function paintResearch() {
        if (!researchTableReady()) {
          body.innerHTML =
            '<div class="fw-prog-scrap">Scrap · <strong>' + scrapCount() + "</strong></div>" +
            '<p class="fw-prog-note">La investigación solo funciona en una <strong>Mesa de investigación</strong>. Fabrícala (200 metal), colócala y pulsa <strong>E</strong>.</p>' +
            '<p class="fw-prog-note">Sacrificas 1× del objeto + scrap (máx <strong>120</strong>) → plano permanente.</p>';
          foot.textContent = "Alternativa: Tech Tree en la Workbench (sin necesitar el objeto).";
          return;
        }
        const ids = Object.keys(RESEARCH);
        const labels = {
          key_lock: "Cerradura",
          metal_door: "Puerta metal",
          satchel: "Satchel",
          rocket: "Cohete",
          c4: "C4",
        };
        let html = '<div class="fw-prog-scrap">Scrap · <strong>' + scrapCount() + "</strong></div>";
        html += '<p class="fw-prog-note">Selecciona un objeto (LMB) y pulsa <strong>Comenzar Investigación</strong>. Se consume <em>1× del objeto</em> + scrap → plano permanente.</p>';
        html += '<div class="fw-prog-grid">';
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i];
          const cost = RESEARCH[id];
          const have = inv ? inv.countOf(id) : 0;
          const owned = hasBp(id);
          let cls = "is-craft";
          if (owned) cls += " is-owned";
          else if (have < 1) cls += " is-locked";
          else if (scrapCount() < cost) cls += " is-short";
          else cls += " is-ready";
          if (researchPick === id) cls += " is-picked";
          html +=
            '<button type="button" class="fw-prog-card ' + cls + '" data-res="' + id + '"' +
            (owned ? " disabled" : "") + ">" +
            (iconUrl(id)
              ? '<img class="fw-prog-icon" alt="" src="' + iconUrl(id) + '" draggable="false">'
              : '<span class="fw-prog-blob" data-id="' + id + '"></span>') +
            '<div class="fw-prog-card-meta">' +
            '  <div class="fw-prog-card-name">' + (labels[id] || id) + "</div>" +
            '  <div class="fw-prog-card-sub">' +
            (owned ? "Ya aprendido" : (have + " en inv · " + cost + " scrap")) +
            "</div></div></button>";
        }
        html += "</div>";
        html += '<div class="fw-prog-research-act">';
        html += '<button type="button" class="fw-prog-start" data-act="start"' +
          (!researchPick ? " disabled" : "") + ">Comenzar Investigación</button>";
        html += "</div>";
        body.innerHTML = html;
        body.querySelectorAll("[data-res]").forEach((btn) => {
          btn.addEventListener("click", () => {
            researchPick = btn.getAttribute("data-res");
            paint();
          });
        });
        const start = body.querySelector('[data-act="start"]');
        if (start) {
          start.addEventListener("click", () => {
            if (researchPick) researchItem(researchPick);
          });
        }
        bindRmbTips(body);
        foot.textContent = "E abre esta mesa · Tab cierra · el objeto se sacrifica al aprender";
      }

      function paint() {
        syncChrome();
        if (tab !== "tech") root.classList.remove("is-tech-view");
        const wb = getWb();
        if (wbEl) {
          const on = (uiMode === "research" && tableForced) || techTreeReady() || wb.inRange;
          if (uiMode === "research" && tableForced) {
            wbEl.textContent = "Investigación · mesa abierta";
          } else {
            wbEl.textContent = on
              ? ("WB T" + effectiveWbTier() + (tableForced ? " · mesa abierta" : " · en rango"))
              : "WB · fuera de rango";
          }
          wbEl.classList.toggle("is-on", !!on);
        }
        if (tab === "tech") paintTech();
        else if (tab === "research") paintResearch();
        else paintQuick();
      }

      function openUi(opts) {
        opts = opts || {};
        uiMode = opts.mode || "craft";
        fullMenu = !!opts.full || uiMode === "craft" || uiMode === "workbench";
        tableForced = !!opts.forced;
        if (opts.wbTier != null) forcedWbTier = Math.max(1, opts.wbTier | 0);
        else if (tableForced && uiMode === "workbench") {
          const wb = getWb();
          forcedWbTier = Math.max(1, wb.tier | 0, 1);
        }
        if (opts.tab) tab = opts.tab;
        else if (uiMode === "workbench") tab = "tech";
        else if (uiMode === "research") tab = "research";
        else tab = "quick";
        if (uiMode === "workbench") {
          techViewTier = Math.max(1, Math.min(3, forcedWbTier | 0));
          techCam.seeded = false;
          techSel = null;
        }
        researchPick = null;
        hideTip();
        open = true;
        root.classList.add("is-open");
        root.classList.toggle("is-full", !!fullMenu);
        root.setAttribute("aria-hidden", "false");
        paint();
        const msg = uiMode === "workbench"
          ? "Mesa T" + effectiveWbTier() + " · Tech Tree · Tab cierra"
          : (uiMode === "research"
            ? "Investigación · sacrifica objeto + scrap · Tab cierra"
            : "Fabricación · Q / Tab cierra");
        onHud({ status: msg });
      }

      function closeUi() {
        open = false;
        tableForced = false;
        fullMenu = false;
        craftSel = null;
        techSel = null;
        hideTip();
        root.classList.remove("is-open");
        root.classList.remove("is-full");
        root.classList.remove("is-tech-view");
        root.setAttribute("aria-hidden", "true");
        onHud({ status: "UI cerrada" });
      }

      try {
        if (window.FalseWorldItemIcons && window.FalseWorldItemIcons.ready) {
          window.FalseWorldItemIcons.ready().then(() => { if (open) paint(); });
        }
      } catch (_) {}

      onChange(Array.from(unlocked));

      return {
        open: () => openUi({ mode: "craft", tab: "quick", full: true }),
        openCraft: () => openUi({ mode: "craft", tab: "quick", full: true }),
        openWorkbench: (tier) => openUi({
          mode: "workbench", tab: "tech", forced: true, full: true,
          wbTier: tier != null ? tier : undefined,
        }),
        openResearch: () => openUi({ mode: "research", tab: "research", forced: true }),
        close: closeUi,
        toggleCraft: () => {
          if (open && uiMode === "craft") closeUi();
          else openUi({ mode: "craft", tab: "quick" });
        },
        isOpen: () => open,
        isTableUi: () => open && (uiMode === "workbench" || uiMode === "research"),
        getMode: () => uiMode,
        paint,
        craftById: (id) => {
          const recipe = RECIPES.find((r) => r.id === id);
          return recipe ? craftRecipe(recipe) : false;
        },
        getQuickRecipes: () => RECIPES
          .filter((r) => r.kind === "quick")
          .map((r) => {
            const st = recipeState(r);
            return {
              id: r.id,
              label: r.label,
              qty: r.qty,
              costs: r.costs.map((c) => ({ id: c.id, qty: c.qty })),
              can: st.can,
              bpOk: st.bpOk,
              wbOk: st.wbOk,
              matsOk: st.matsOk,
            };
          }),
        hasBlueprint: hasBp,
        getUnlocked: () => Array.from(unlocked),
        destroy() {
          hideTip();
          try { root.remove(); } catch (_) {}
        },
      };
    },
  };
})();
