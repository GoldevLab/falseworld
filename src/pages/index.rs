use crate::inventory::{
    starter_backpack_json, starter_hotbar_json, BACKPACK_SLOTS, HOTBAR_SLOTS, STACK_SIZE,
};
use resuma::prelude::*;

pub fn page(_req: FlowRequest) -> View {
    let status = use_signal("Preparando…".to_string());
    let cam_mode = use_signal("follow".to_string());
    let gate_error = use_signal(String::new());
    let unlocked = use_signal("0".to_string());

    // Inventario Resuma (JSON signals → mochila 24 + hotbar 6)
    let backpack_json = use_signal(starter_backpack_json());
    let hotbar_json = use_signal(starter_hotbar_json());
    let hotbar_active = use_signal(0i32);
    let held_label = use_signal("Pico".to_string());
    let held_id = use_signal("hatchet_tool".to_string());
    let inv_meta = format!(
        "Inventario · {}+{} · stack {}",
        BACKPACK_SLOTS, HOTBAR_SLOTS, STACK_SIZE
    );

    visible_task!(
        r#"
        async (state, __resuma) => {
            const canvas = document.getElementById("fw-canvas");
            const gate = document.getElementById("fw-load-gate");
            const fill = document.getElementById("fw-load-fill");
            const statusEl = document.getElementById("fw-load-status");
            const startBtn = document.getElementById("fw-start-hit");
            if (!canvas) { state.status.set("Canvas ausente"); return; }

            let api = null;
            let vrmApi = null;
            let invApi = null;
            let mpApi = null;
            let alive = true;
            let readyToStart = false;
            let started = false;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const WORLD_SEED = 42;

            let gateHasError = false;

            // Guest identity before GPU boots (ownership / presence id)
            window.__fw = window.__fw || {};
            try {
                const g = window.FalseWorldMp && window.FalseWorldMp.loadGuest
                    ? window.FalseWorldMp.loadGuest()
                    : null;
                if (g) {
                    window.__fw.playerId = g.id;
                    window.__fw.playerName = g.name;
                } else if (!window.__fw.playerId) {
                    window.__fw.playerId = "local-" + Math.random().toString(36).slice(2, 10);
                    window.__fw.playerName = "Guest";
                }
            } catch (_) {
                window.__fw.playerId = window.__fw.playerId || "local";
            }

            let persistInvTimer = 0;
            function schedulePersistInventory(payload) {
                // Debounced: drag/craft/quick-move can fire onSync several times
                // per second, and every save is a full-file rewrite server-side.
                if (persistInvTimer) clearTimeout(persistInvTimer);
                persistInvTimer = setTimeout(() => {
                    persistInvTimer = 0;
                    if (!payload) return;
                    // Server resolves the account from the session cookie.
                    __resuma.action("save_player_inventory", [
                        String(payload.backpackJson || "[]"),
                        String(payload.hotbarJson || "[]"),
                        Number(payload.activeSlot) || 0,
                        String(payload.heldId || ""),
                    ]).catch(() => {});
                }, 800);
            }

            // Last world pose → Turso so reconnect spawns where you left.
            let persistPoseTimer = 0;
            let posePersistArmed = false;
            function flushPlayerPosition() {
                if (!api) return;
                let pose = null;
                try {
                    pose = typeof api.getFeetPose === "function"
                        ? api.getFeetPose()
                        : (typeof api.getPose === "function" ? api.getPose() : null);
                } catch (_) { return; }
                if (!pose || !Number.isFinite(+pose.x) || !Number.isFinite(+pose.z)) return;
                __resuma.action("save_player_position", [
                    Number(pose.x) || 0,
                    Number(pose.y) || 0,
                    Number(pose.z) || 0,
                    Number(pose.yaw) || 0,
                ]).catch(() => {});
            }
            function schedulePersistPosition() {
                if (!posePersistArmed) return;
                if (persistPoseTimer) clearTimeout(persistPoseTimer);
                persistPoseTimer = setTimeout(() => {
                    persistPoseTimer = 0;
                    flushPlayerPosition();
                }, 1200);
            }
            function onPoseLifecycle() {
                if (document.visibilityState === "hidden") flushPlayerPosition();
                else schedulePersistPosition();
            }
            document.addEventListener("visibilitychange", onPoseLifecycle);
            window.addEventListener("pagehide", flushPlayerPosition);

            function syncInvToResuma(payload) {
                if (!alive || !payload) return;
                state.backpack_json.set(String(payload.backpackJson || "[]"));
                state.hotbar_json.set(String(payload.hotbarJson || "[]"));
                state.hotbar_active.set(Number(payload.activeSlot) || 0);
                state.held_label.set(String(payload.heldLabel || "vacío"));
                state.held_id.set(String(payload.heldId || ""));
                schedulePersistInventory(payload);
            }

            function notifyHeld(held) {
                if (!api || typeof api.setHeldItem !== "function") return;
                api.setHeldItem(held);
            }

            function unlockNow() {
                if (started || gateHasError) return;
                started = true;
                readyToStart = true;

                try {
                    if (api && typeof api.setPaused === "function") api.setPaused(false);
                    if (api && typeof api.setControlsEnabled === "function") api.setControlsEnabled(true);
                } catch (e) { console.warn("[FW] unpause", e); }

                const g = document.getElementById("fw-load-gate") || gate;
                if (g) {
                    // Blur focused START before hiding — avoids aria-hidden + focus warning
                    try {
                        if (startBtn && document.activeElement === startBtn) startBtn.blur();
                        if (g.contains(document.activeElement)) {
                            document.activeElement.blur();
                        }
                    } catch (_) {}
                    try { canvas.focus({ preventScroll: true }); } catch (_) { try { canvas.focus(); } catch (_) {} }
                    g.classList.add("is-fading");
                    g.style.pointerEvents = "none";
                    g.setAttribute("inert", "");
                    g.setAttribute("aria-hidden", "true");
                    setTimeout(() => {
                        try {
                            g.classList.add("is-gone");
                            g.style.cssText = "display:none!important;opacity:0;pointer-events:none;";
                            g.remove();
                        } catch (_) {}
                    }, 1000);
                }

                state.unlocked.set("1");
                try { flushPlayerPosition(); } catch (_) {}
                try {
                    if (vrmApi && typeof vrmApi.setPlayable === "function") vrmApi.setPlayable(true);
                } catch (_) {}
                state.status.set("Click captura mira · WASD · Space salto · C cámara · X agachar · Ctrl agachar · Shift correr · V cámara · G mapa");
                try { canvas.focus(); } catch (_) {}
                try {
                  if (canvas.requestPointerLock) canvas.requestPointerLock();
                } catch (_) {}
                // Push current held tool into engine
                if (invApi) notifyHeld(invApi.getActive());
                // Join presence room once playable
                try {
                    if (window.FalseWorldMp && !mpApi) {
                        mpApi = window.FalseWorldMp.create();
                        const pushRemotes = (list) => {
                            try {
                                if (vrmApi && typeof vrmApi.setRemotePlayers === "function") {
                                    vrmApi.setRemotePlayers(list || []);
                                }
                                if (api && typeof api.setPeerOverlays === "function") {
                                    api.setPeerOverlays(list || []);
                                }
                                const n = (list && list.length) || 0;
                                window.__fw = window.__fw || {};
                                window.__fw.peerCount = n;
                                if (started) {
                                    if (n > 0) {
                                        const p0 = list[0];
                                        let hint = "";
                                        try {
                                            const me = api && api.getPose ? api.getPose() : null;
                                            if (me && p0) {
                                                const d = Math.hypot((+p0.x||0)-me.x, (+p0.z||0)-me.z);
                                                hint = " · peer a " + Math.round(d) + "m";
                                            }
                                        } catch (_) {}
                                        state.status.set("Online · " + (n + 1) + " jugadores" + hint + " · mira alrededor");
                                    } else if (mpApi && mpApi.isConnected && mpApi.isConnected()) {
                                        state.status.set("Online · solo tú · espera otro jugador");
                                    }
                                }
                            } catch (_) {}
                        };
                        mpApi.connect({
                            seed: WORLD_SEED,
                            name: (window.__fw && window.__fw.playerName) || undefined,
                            getPose: () => (api && api.getPose ? api.getPose() : null),
                            onPeers: pushRemotes,
                            onWorld: (msg) => {
                                try {
                                    if (!api || !msg) return;
                                    if (msg.t === "world" && typeof api.applyWorldSnapshot === "function") {
                                        api.applyWorldSnapshot(msg.pieces || []);
                                    } else if (msg.t === "place" && typeof api.applyRemotePlace === "function") {
                                        api.applyRemotePlace(msg.piece);
                                    } else if (msg.t === "remove" && typeof api.applyRemoteRemove === "function") {
                                        api.applyRemoteRemove(msg.id);
                                    } else if (msg.t === "hp" && typeof api.applyRemoteHp === "function") {
                                        api.applyRemoteHp(msg.id, msg.hp);
                                    }
                                } catch (e) { console.warn("[FW world]", e); }
                            },
                        });
                        // Heal asymmetric views (missed join / duplicate-tab races)
                        setInterval(() => {
                            if (!mpApi || !started) return;
                            try {
                                if (typeof mpApi.requestSync === "function") mpApi.requestSync();
                                pushRemotes(mpApi.getPeers());
                            } catch (_) {}
                        }, 1500);
                        window.__fw.mp = mpApi;
                    }
                } catch (e) { console.warn("[FW mp]", e); }
            }

            window.__fw = Object.assign(window.__fw || {}, {
                setCam: (m) => {
                    if (!started) return;
                    state.cam_mode.set(String(m));
                    api && api.setCameraMode(m);
                },
                rebake: () => {
                    if (!started) return;
                    api && api.rebake();
                },
                inv: null,
                mp: null,
            });

            function setPct(pct, label, phase) {
                const p = Math.max(0, Math.min(99, Math.round(pct)));
                if (fill) fill.style.width = p + "%";
                if (fill && fill.parentElement) fill.parentElement.style.opacity = readyToStart ? "0" : "1";
                const text = label || ((phase === "cal" ? "Calibrando" : "Cargando") + "… " + p + "%");
                if (statusEl && !readyToStart && !gateHasError) statusEl.textContent = text;
            }

            function armStart() {
                readyToStart = true;
                if (fill && fill.parentElement) fill.parentElement.style.opacity = "0";
                if (statusEl) statusEl.style.opacity = "0";
                if (startBtn) {
                    startBtn.classList.add("is-ready");
                    startBtn.removeAttribute("aria-disabled");
                    startBtn.textContent = "Entrar";
                }
                const actions = document.querySelector(".load-actions");
                if (actions) actions.classList.add("is-ready");
            }

            function onStartClick(ev) {
                if (ev) { ev.preventDefault(); ev.stopPropagation(); }
                if (!readyToStart || started || gateHasError) return;
                unlockNow();
            }

            if (startBtn) {
                startBtn.addEventListener("click", onStartClick);
                startBtn.addEventListener("keydown", (e) => {
                    if (e.key === "Enter" || e.key === " ") onStartClick(e);
                });
            }

            function markError(code) {
                gateHasError = true;
                const msg = String(code || "ERROR");
                state.gate_error.set(msg);
                state.status.set(msg);
                if (statusEl) {
                    statusEl.textContent = "Sistema incompatible";
                    statusEl.classList.add("is-error");
                    statusEl.style.opacity = "1";
                }
                if (fill && fill.parentElement) fill.parentElement.style.opacity = "0";
                if (startBtn) {
                    startBtn.classList.add("is-error");
                    startBtn.setAttribute("aria-disabled", "true");
                    startBtn.textContent = "Error";
                }
                const errEl = document.querySelector(".load-err");
                if (errEl) errEl.textContent = msg;
            }

            async function bakeChunk(ox, oz) {
                const startedBake = await __resuma.action("start_meadow_chunk", [
                    WORLD_SEED, 0, 0, 650, 0, 512,
                ]);
                const gid = startedBake.graph_id;
                const token = startedBake.access_token || "";
                let delay = 200;
                for (let i = 0; i < 400; i++) {
                    if (!alive) return null;
                    const url = "/_resuma/graph/" + encodeURIComponent(gid)
                        + "/status?token=" + encodeURIComponent(token);
                    const res = await fetch(url, { credentials: "same-origin" });
                    if (res.status === 429) { await sleep(delay = Math.min(delay * 2, 3000)); continue; }
                    const st = await res.json();
                    const pct = st.progress ?? st.pct ?? 0;
                    if (pct) setPct(5 + pct * 0.4, null, "load");
                    if (st.status === "done" || st.status === "Done") break;
                    if (st.status === "failed" || st.status === "Failed") {
                        throw new Error(st.error || "chunk falló");
                    }
                    await sleep(delay);
                }
                const chunk = await __resuma.action("claim_meadow_chunk", [gid]);
                return chunk;
            }

            try {
                // Wait for multiplayer helper (guest id) then icons / inventory
                for (let i = 0; i < 40 && !window.FalseWorldMp; i++) await sleep(40);
                try {
                    if (window.FalseWorldMp && window.FalseWorldMp.loadGuest) {
                        const g = window.FalseWorldMp.loadGuest();
                        window.__fw.playerId = g.id;
                        window.__fw.playerName = g.name;
                    }
                } catch (_) {}
                // 3D item icons (Three.js) then inventory UI
                for (let i = 0; i < 80 && !window.FalseWorldItemIcons; i++) await sleep(40);
                try {
                    if (window.FalseWorldItemIcons && window.FalseWorldItemIcons.ready) {
                        await window.FalseWorldItemIcons.ready();
                    }
                } catch (_) {}
                // Returning players resume their saved backpack/hotbar instead of
                // the debug starter stash baked into the SSR mirror attributes.
                let savedInv = null;
                let savedPose = null;
                try {
                    // No arg: the server reads the logged-in user from the
                    // session cookie (`auth.rs`), not a client-supplied id —
                    // logged-out visitors never reach this page (redirected
                    // to /login), so this always resolves a real account.
                    const loaded = await __resuma.action("load_player_inventory", []);
                    if (loaded && loaded.found) savedInv = loaded;
                } catch (_) {}
                try {
                    const loadedPose = await __resuma.action("load_player_position", []);
                    if (
                        loadedPose && loadedPose.found &&
                        Number.isFinite(+loadedPose.x) &&
                        Number.isFinite(+loadedPose.z)
                    ) {
                        savedPose = {
                            x: +loadedPose.x,
                            y: Number.isFinite(+loadedPose.y) ? +loadedPose.y : 0,
                            z: +loadedPose.z,
                            yaw: Number.isFinite(+loadedPose.yaw) ? +loadedPose.yaw : 0,
                        };
                    }
                } catch (_) {}
                for (let i = 0; i < 80 && !window.FalseWorldInv; i++) await sleep(40);
                if (window.FalseWorldInv) {
                    const stage = document.querySelector(".stage") || document.body;
                    const mirror = document.querySelector(".fw-inv-mirror");
                    invApi = window.FalseWorldInv.create(stage, {
                        backpackJson: savedInv
                            ? savedInv.backpackJson
                            : (mirror && mirror.getAttribute("data-backpack")) || "[]",
                        hotbarJson: savedInv
                            ? savedInv.hotbarJson
                            : (mirror && mirror.getAttribute("data-hotbar")) || "[]",
                        activeSlot: savedInv
                            ? Number(savedInv.activeSlot) || 0
                            : Number((mirror && mirror.getAttribute("data-active")) || 0),
                        onSync: syncInvToResuma,
                        onActiveChange: (held) => {
                            // setHeldItem owns build/deploy ghost state. Do NOT call
                            // setBuildMode(false) here — consuming a deployable mid-place
                            // would null ghostCell before tryPlaceGhost finishes.
                            notifyHeld(held);
                        },
                    });
                    window.__fw.inv = invApi;
                    // Starter wood/stone already in backpack JSON; keep hotbar for tools only
                }

                setPct(5, "Cargando… avatar", "load");
                for (let i = 0; i < 100 && !window.FalseWorldVrm; i++) {
                    await sleep(40);
                }
                const vrmCanvas = document.getElementById("fw-vrm");
                if (alive && vrmCanvas && window.FalseWorldVrm) {
                    try {
                        vrmApi = await window.FalseWorldVrm.create(vrmCanvas, {
                            getPose: () => (api ? api.getPose() : {
                                x: 0, y: 0, z: 0, yaw: 0, moving: false, sprinting: false,
                                camMode: "fpv",
                                eye: [0, 1.6, 4], target: [0, 1.2, 0],
                                aspect: 1.5, fovDeg: 55, near: 0.1, far: 800,
                            }),
                            onProgress: (m) => {
                                if (!alive || readyToStart) return;
                                const s = String(m || "");
                                const mPct = s.match(/(\d+)%/);
                                if (mPct) {
                                    setPct(5 + Number(mPct[1]) * 0.35, "Cargando… " + s, "load");
                                } else {
                                    setPct(40, "Cargando… " + s, "load");
                                }
                            },
                        });
                        window.__fw = window.__fw || {};
                        window.__fw.vrm = vrmApi;
                        setPct(42, "Cargando… avatar ok", "load");
                    } catch (ve) {
                        console.warn("[VRM]", ve);
                        vrmApi = null;
                        setPct(42, "Cargando… sin avatar", "load");
                    }
                } else {
                    setPct(42, "Cargando… sin avatar", "load");
                }

                setPct(45, "Cargando… WebGPU", "load");
                if (!navigator.gpu) {
                    markError("WebGPU no soportado");
                    return () => { alive = false; };
                }
                const adapter = await navigator.gpu.requestAdapter();
                if (!adapter) {
                    markError("Sin adaptador GPU");
                    return () => { alive = false; };
                }

                for (let i = 0; i < 120 && !window.FalseWorldGpu; i++) {
                    await sleep(40);
                }
                if (!window.FalseWorldGpu) {
                    markError("Script cliente ausente");
                    state.status.set("Hard-refresh Ctrl+Shift+R");
                    return () => { alive = false; };
                }

                api = await window.FalseWorldGpu.create(canvas, {
                    onHud: (h) => {
                        if (!alive) return;
                        if (h.status && started) state.status.set(String(h.status));
                    },
                    loadChunk: bakeChunk,
                    inventory: invApi ? {
                        addItem: (id, qty) => invApi.addItem(id, qty),
                        tryConsume: (id, qty) => invApi.tryConsume(id, qty),
                        countOf: (id) => invApi.countOf(id),
                        getActive: () => invApi.getActive(),
                    } : null,
                    // Feet pose from last disconnect; terrain snap in boot() still applies.
                    initialPose: savedPose || null,
                });
                api.setControlsEnabled(false);
                if (typeof api.setPaused === "function") api.setPaused(true);
                if (typeof api.setAvatarAtlasSource === "function") {
                    api.setAvatarAtlasSource(() =>
                        (vrmApi && typeof vrmApi.getAtlas === "function") ? vrmApi.getAtlas() : null
                    );
                }
                try {
                    window.__fw = window.__fw || {};
                    window.__fw.api = api;
                    if (typeof api.getVitals === "function") {
                        window.__fw.getVitals = () => api.getVitals();
                    }
                    if (typeof api.playUiSfx === "function") {
                        window.__fw.playUi = (k) => api.playUiSfx(k);
                    }
                } catch (_) {}
                if (invApi) notifyHeld(invApi.getActive());

                setPct(55, "Cargando… prado", "load");
                await api.boot();
                if (typeof api.calibrate === "function") await api.calibrate(3);
                setPct(99, "Calibrando…", "cal");
                armStart();
                // Persist pose once playable; interval covers idle AFK tabs too.
                posePersistArmed = true;
                setInterval(() => {
                    if (!alive || !started || !posePersistArmed) return;
                    flushPlayerPosition();
                }, 15000);

            } catch (e) {
                console.error("[FW init]", e);
                const detail = (e && e.message) ? e.message : String(e);
                markError(detail || "Fallo al iniciar");
            }

            window.__fw.setCam = (m) => {
                if (!started) return;
                state.cam_mode.set(String(m));
                api && api.setCameraMode(m);
            };
            window.__fw.rebake = () => {
                if (!started) return;
                api && api.rebake();
            };

            return () => {
                alive = false;
                posePersistArmed = false;
                if (persistPoseTimer) clearTimeout(persistPoseTimer);
                try { flushPlayerPosition(); } catch (_) {}
                try {
                    document.removeEventListener("visibilitychange", onPoseLifecycle);
                    window.removeEventListener("pagehide", flushPlayerPosition);
                } catch (_) {}
                try { mpApi && mpApi.destroy(); } catch (_) {}
                try { invApi && invApi.destroy(); } catch (_) {}
                try { vrmApi && vrmApi.destroy(); } catch (_) {}
                try { api && api.destroy(); } catch (_) {}
                delete window.__fw;
            };
        }
        "#,
        status,
        cam_mode,
        gate_error,
        unlocked,
        backpack_json,
        hotbar_json,
        hotbar_active,
        held_label,
        held_id
    );

    view! {
        <div class="stage" data-unlocked={unlocked}>
            <div class="viewport">
                {client_component(
                    ClientComponent::new("fw-item-icons")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                {client_component(
                    ClientComponent::new("fw-inventory")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                {client_component(
                    ClientComponent::new("fw-explosives")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                {client_component(
                    ClientComponent::new("fw-progression")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                {client_component(
                    ClientComponent::new("fw-multiplayer")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                {client_component(
                    ClientComponent::new("fw-meadow-gpu")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                {client_component(
                    ClientComponent::new("fw-meadow-vrm")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                <canvas id="fw-canvas" tabindex="0" aria-label="False World meadow"></canvas>
                <canvas id="fw-vrm" aria-hidden="true"></canvas>
                <div class="fw-crosshair" aria-hidden="true"><span class="fw-crosshair-dot"></span></div>
                <div class="hud" aria-hidden="true">
                    <div class="hud-line">{status}</div>
                    <div class="hud-held">
                        "Mano: "{held_label}
                        " · slot "{hotbar_active}
                    </div>
                </div>
                // Espejo Resuma de inventario (SSR snapshot + señales; UI viva en fw-inventory-v1)
                <div class="fw-inv-mirror" aria-hidden="true" data-backpack={backpack_json} data-hotbar={hotbar_json} data-active={hotbar_active} data-held={held_id}></div>
                <div class="vitals" aria-hidden="true">
                    <div class="vital-bar vital-hp">
                        <div class="vital-label">
                            <span>"VIDA"</span>
                            <span id="fw-hp-text">"100 / 100"</span>
                        </div>
                        <div class="vital-track">
                            <div id="fw-hp-fill" class="vital-fill" style="width:100%"></div>
                        </div>
                    </div>
                    <div class="vital-bar vital-hunger">
                        <div class="vital-label">
                            <span>"HAMBRE"</span>
                            <span id="fw-hunger-text">"500 / 500"</span>
                        </div>
                        <div class="vital-track">
                            <div id="fw-hunger-fill" class="vital-fill" style="width:100%"></div>
                        </div>
                    </div>
                    <div class="vital-meta">
                        <span id="fw-temp" class="vital-chip">"TEMP · OK"</span>
                        <span id="fw-comfort" class="vital-chip">"CONFORT · 0%"</span>
                    </div>
                    <div id="fw-fps" class="fps-meter" aria-live="off">"—"</div>
                </div>
            </div>

            <div id="fw-load-gate" class="load-gate" role="dialog" aria-label="False World">
                <div class="load-visual" aria-hidden="true">
                    <img
                        class="load-visual-img"
                        src="/boot-meadow.png"
                        width="1440"
                        height="900"
                        alt=""
                        fetchpriority="high"
                        decoding="async"
                    />
                    <div class="load-visual-mist"></div>
                    <div class="load-visual-vignette"></div>
                </div>
                <div class="load-inner">
                    <h1 class="load-brand">
                        <span class="load-brand-false">"FALSE"</span>
                        <span class="load-brand-world">"WORLD"</span>
                    </h1>
                    <p class="load-tagline">
                        "Tras la deriva, una isla sin borde. Cada paso deja rastro."
                    </p>
                    <div class="load-actions">
                        <div id="fw-load-status" class="load-status" aria-live="polite">"Preparando mundo…"</div>
                        <div class="load-bar" aria-hidden="true">
                            <div id="fw-load-fill" class="load-bar-fill"></div>
                        </div>
                        <button
                            type="button"
                            id="fw-start-hit"
                            class="load-start"
                            aria-disabled="true"
                        >"Cargando"</button>
                        <p class="load-err">{gate_error}</p>
                    </div>
                </div>
                <footer class="load-foot">
                    <details class="load-controls">
                        <summary>"Controles"</summary>
                        <div class="load-hints">
                            <span><kbd>"W"</kbd><kbd>"A"</kbd><kbd>"S"</kbd><kbd>"D"</kbd>" mover"</span>
                            <span><kbd>"Space"</kbd>" salto"</span>
                            <span><kbd>"Shift"</kbd>" correr"</span>
                            <span><kbd>"C"</kbd>" / "<kbd>"V"</kbd>" cámara"</span>
                            <span><kbd>"X"</kbd>" / "<kbd>"Ctrl"</kbd>" agachar"</span>
                            <span><kbd>"Tab"</kbd>" mochila"</span>
                            <span><kbd>"Q"</kbd>" craft"</span>
                            <span><kbd>"E"</kbd>" usar"</span>
                            <span><kbd>"G"</kbd>" mapa"</span>
                            <span><kbd>"1"</kbd>"–"<kbd>"6"</kbd>" hotbar"</span>
                        </div>
                        <p class="load-tip">"Tip: airlock = 2 puertas · soft side hacia dentro"</p>
                    </details>
                    <p class="load-meta">{inv_meta}</p>
                </footer>
            </div>
        </div>
    }
}
