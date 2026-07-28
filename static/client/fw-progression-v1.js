/** False World progression — scrap currency · research table · tech tree · workbenches. */
(function () {
  const STORAGE_KEY = "fw_unlocked_blueprints_v1";

  /**
   * Tech tree by workbench tier.
   * dependency = prior node id in the same branch (must unlock first).
   * wb = minimum workbench tier required to purchase.
   */
  const TECH_TREE = {
    tier1: [
      { id: "lock", label: "Cerradura", cost: 15, rarity: "common", unlocks: "key_lock", dependency: null, icon: "key_lock", wb: 1 },
      { id: "metal_door", label: "Puerta metal", cost: 30, rarity: "uncommon", unlocks: "metal_door", dependency: "lock", icon: "metal_door", wb: 1 },
      { id: "satchel", label: "Satchel", cost: 60, rarity: "rare", unlocks: "satchel", dependency: "metal_door", icon: "satchel", wb: 1 },
      { id: "rocket", label: "Cohete", cost: 120, rarity: "very_rare", unlocks: "rocket", dependency: "satchel", icon: "rocket", wb: 1 },
    ],
    tier2: [
      { id: "c4", label: "C4", cost: 120, rarity: "very_rare", unlocks: "c4", dependency: "rocket", icon: "c4", wb: 2 },
    ],
    tier3: [],
  };

  const TIER_LABELS = {
    tier1: "Workbench T1 · herramientas / armas básicas",
    tier2: "Workbench T2 · equipo medio",
    tier3: "Workbench T3 · élite / explosivos",
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
    key_lock: 15,
    metal_door: 30,
    satchel: 60,
    rocket: 120,
    c4: 120,
  };

  const DESCRIPTIONS = {
    workbench_1: "Mesa T1 (500 madera · 100 metal · sin scrap). E cerca: Tech Tree + craft avanzado.",
    workbench_2: "Mesa T2 (500 madera · 500 metal · sin scrap). Requiere WB T1 cerca.",
    workbench_3: "Mesa T3 (1000 metal · 100 HQM · sin scrap). Requiere WB T2 cerca.",
    research_table: "Mesa de investigación (200 metal). Sacrifica 1 objeto + scrap (máx 120) → plano permanente.",
    key_lock: "Cierra puertas. Common · 15 scrap en research/tech.",
    metal_door: "Puerta de metal. Uncommon · 30 scrap.",
    satchel: "Explosivo · radio 4 m · soft ×1.1. Rare · 60 scrap. LMB coloca con mecha.",
    rocket: "Cohete · splash ~4 paredes. Very rare · 120 scrap. LMB dispara.",
    c4: "C4 · alto daño estructural. Very rare · 120 scrap. LMB coloca.",
    tool_cupboard_item: "Armario de herramientas. Privilege 16 m y upkeep de la base.",
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
      /** @type {"craft"|"workbench"|"research"} */
      let uiMode = "craft";
      let tableForced = false; // opened via E on entity
      /** Tier of the workbench that forced-open the UI (E). Badge used ||1 while buy used 0. */
      let forcedWbTier = 1;
      let researchPick = null;
      let tipEl = null;
      let rmbHoldTimer = null;
      let rmbTarget = null;

      const root = document.createElement("div");
      root.id = "fw-prog";
      root.className = "fw-prog";
      root.setAttribute("aria-hidden", "true");
      root.innerHTML =
        '<div class="fw-prog-panel">' +
        '  <div class="fw-prog-head">' +
        '    <span class="fw-prog-title" id="fw-prog-title">FABRICACIÓN</span>' +
        '    <span class="fw-prog-wb" id="fw-prog-wb">WB · fuera de rango</span>' +
        '    <kbd id="fw-prog-kbd">Q</kbd>' +
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

      function paintTechTier(tierKey, nodes, wb) {
        let html = '<div class="fw-prog-tier">';
        html += '<div class="fw-prog-tier-head">' + (TIER_LABELS[tierKey] || tierKey) + "</div>";
        html += '<div class="fw-prog-tree">';
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const owned = unlockedNodes.has(n.id) || hasBp(n.unlocks);
          const depOk = nodeUnlocked(n, unlockedNodes);
          const haveTier = effectiveWbTier();
          const nodeNeed = Math.max(1, needWbTier(n.wb));
          const atOk = techTreeReady() && (haveTier >= nodeNeed);
          const recipe = RECIPES.find((r) => r.id === n.unlocks);
          const st = recipe ? recipeState(recipe) : null;
          const canBuy = !owned && depOk && atOk && scrapCount() >= n.cost;
          const canCraft = !!(owned && recipe && st && st.can);
          let cls = "fw-prog-node";
          if (owned && canCraft) cls += " is-owned is-craftable";
          else if (owned) cls += " is-owned";
          else if (canBuy) cls += " is-buyable";
          else if (!depOk || !atOk) cls += " is-locked";
          else cls += " is-short";
          let sub;
          if (owned) {
            if (!recipe) sub = "Aprendido";
            else if (!st.wbOk) sub = "Aprendido · Mesa T" + recipe.wb + " para fabricar";
            else if (!st.matsOk) sub = "Aprendido · faltan " + st.missing.join(", ");
            else sub = "LMB fabricar · " + recipe.costs.map((c) => c.qty + " " + c.id).join(" · ");
          } else if (!techTreeReady()) {
            sub = "Acércate a una Mesa";
          } else if (!depOk) {
            sub = "Requiere anterior";
          } else if (!atOk) {
            sub = "Requiere WB T" + nodeNeed;
          } else {
            sub = n.cost + " scrap";
          }
          const disabled = owned ? !canCraft : (!depOk || !atOk);
          html +=
            '<button type="button" class="' + cls + '" data-tech="' + n.id + '"' +
            (disabled ? " disabled" : "") + ">" +
            (iconUrl(n.icon)
              ? '<img class="fw-prog-icon" alt="" src="' + iconUrl(n.icon) + '" draggable="false">'
              : '<span class="fw-prog-blob" data-id="' + n.icon + '"></span>') +
            '<div class="fw-prog-card-meta">' +
            '  <div class="fw-prog-card-name">' + n.label + (owned ? " · FABRICAR" : "") + "</div>" +
            '  <div class="fw-prog-card-sub">' + sub + "</div>" +
            "</div></button>";
          if (i < nodes.length - 1) html += '<div class="fw-prog-edge" aria-hidden="true"></div>';
        }
        html += "</div></div>";
        return html;
      }

      function paintTech() {
        const wb = getWb();
        let html = '<div class="fw-prog-scrap">Scrap · <strong>' + scrapCount() + "</strong>";
        if (!techTreeReady()) {
          html += ' <span class="fw-prog-warn">· sin mesa</span>';
        }
        html += "</div>";
        html += '<p class="fw-prog-note">Scrap desbloquea planos. Con plano aprendido, <strong>LMB fabrica</strong> aquí (o en la pestaña Rápida).</p>';
        if (TECH_TREE.tier1.length) html += paintTechTier("tier1", TECH_TREE.tier1, wb);
        if (TECH_TREE.tier2.length) html += paintTechTier("tier2", TECH_TREE.tier2, wb);
        if (TECH_TREE.tier3.length) html += paintTechTier("tier3", TECH_TREE.tier3, wb);
        body.innerHTML = html;
        body.querySelectorAll("[data-tech]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const n = findTechNode(btn.getAttribute("data-tech"));
            if (!n) return;
            const owned = unlockedNodes.has(n.id) || hasBp(n.unlocks);
            if (owned) {
              const r = RECIPES.find((x) => x.id === n.unlocks);
              if (r) craftRecipe(r);
              return;
            }
            buyTech(n);
          });
        });
        bindRmbTips(body);
        foot.textContent = "LMB: comprar plano / fabricar si ya aprendido · RMB detalle";
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
        researchPick = null;
        hideTip();
        open = true;
        root.classList.add("is-open");
        root.setAttribute("aria-hidden", "false");
        paint();
        const msg = uiMode === "workbench"
          ? "Mesa de trabajo · Tech Tree + craft · Tab cierra"
          : (uiMode === "research"
            ? "Investigación · sacrifica objeto + scrap · Tab cierra"
            : "Fabricación · Q / Tab cierra");
        onHud({ status: msg });
      }

      function closeUi() {
        open = false;
        tableForced = false;
        hideTip();
        root.classList.remove("is-open");
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
        open: () => openUi({ mode: "craft", tab: "quick" }),
        openCraft: () => openUi({ mode: "craft", tab: "quick" }),
        openWorkbench: (tier) => openUi({
          mode: "workbench", tab: "quick", forced: true,
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
