use resuma::prelude::*;

pub fn page(_req: FlowRequest) -> View {
    let status = use_signal("Preparando…".to_string());
    let cam_mode = use_signal("follow".to_string());
    let gate_error = use_signal(String::new());
    let unlocked = use_signal("0".to_string());

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
            let alive = true;
            let readyToStart = false;
            let started = false;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            let gateHasError = false;

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
                    g.classList.add("is-fading");
                    g.style.pointerEvents = "none";
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
                try {
                    if (vrmApi && typeof vrmApi.setPlayable === "function") vrmApi.setPlayable(true);
                } catch (_) {}
                state.status.set("WASD · Shift · C cámara");
                try { canvas.focus(); } catch (_) {}
            }

            window.__fw = {
                setCam: (m) => {
                    if (!started) return;
                    state.cam_mode.set(String(m));
                    api && api.setCameraMode(m);
                },
                rebake: () => {
                    if (!started) return;
                    api && api.rebake();
                },
            };

            function setPct(pct, label, phase) {
                const p = Math.max(0, Math.min(99, Math.round(pct)));
                if (fill) fill.style.width = p + "%";
                if (fill && fill.parentElement) fill.parentElement.style.opacity = readyToStart ? "0" : "1";
                const text = label || ((phase === "cal" ? "CALIBRATING" : "LOADING") + "… " + p + "%");
                if (statusEl && !readyToStart && !gateHasError) statusEl.textContent = text;
            }

            function armStart() {
                readyToStart = true;
                if (fill && fill.parentElement) fill.parentElement.style.opacity = "0";
                if (statusEl) statusEl.style.opacity = "0";
                if (startBtn) {
                    startBtn.classList.add("is-ready");
                    startBtn.removeAttribute("aria-disabled");
                    startBtn.textContent = "[ START ]";
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
                    statusEl.textContent = "SYSTEM INCOMPATIBLE";
                    statusEl.classList.add("is-error");
                    statusEl.style.opacity = "1";
                }
                if (fill && fill.parentElement) fill.parentElement.style.opacity = "0";
                if (startBtn) {
                    startBtn.classList.add("is-error");
                    startBtn.setAttribute("aria-disabled", "true");
                    startBtn.textContent = "[ ERROR ]";
                }
                const errEl = document.querySelector(".load-err");
                if (errEl) errEl.textContent = msg;
            }

            async function bakeChunk(ox, oz) {
                const startedBake = await __resuma.action("start_meadow_chunk", [
                    42, 0, 0, 650, 0, 512,
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
                setPct(5, "LOADING… avatar", "load");
                for (let i = 0; i < 100 && !window.FalseWorldVrm; i++) {
                    await sleep(40);
                }
                const vrmCanvas = document.getElementById("fw-vrm");
                if (alive && vrmCanvas && window.FalseWorldVrm) {
                    try {
                        vrmApi = await window.FalseWorldVrm.create(vrmCanvas, {
                            getPose: () => (api ? api.getPose() : {
                                x: 0, y: 0, z: 0, yaw: 0, moving: false, sprinting: false,
                                camMode: "follow",
                                eye: [0, 1.6, 4], target: [0, 1.2, 0],
                                aspect: 1.5, fovDeg: 55, near: 0.1, far: 800,
                            }),
                            onProgress: (m) => {
                                if (!alive || readyToStart) return;
                                const s = String(m || "");
                                const mPct = s.match(/(\d+)%/);
                                if (mPct) {
                                    setPct(5 + Number(mPct[1]) * 0.35, "LOADING… " + s, "load");
                                } else {
                                    setPct(40, "LOADING… " + s, "load");
                                }
                            },
                        });
                        setPct(42, "LOADING… avatar ok", "load");
                    } catch (ve) {
                        console.warn("[VRM]", ve);
                        vrmApi = null;
                        setPct(42, "LOADING… sin avatar", "load");
                    }
                } else {
                    setPct(42, "LOADING… sin avatar", "load");
                }

                setPct(45, "LOADING… WebGPU", "load");
                if (!navigator.gpu) {
                    markError("WEBGPU NOT SUPPORTED");
                    return () => { alive = false; };
                }
                const adapter = await navigator.gpu.requestAdapter();
                if (!adapter) {
                    markError("NO GPU ADAPTER FOUND");
                    return () => { alive = false; };
                }

                for (let i = 0; i < 120 && !window.FalseWorldGpu; i++) {
                    await sleep(40);
                }
                if (!window.FalseWorldGpu) {
                    markError("CLIENT SCRIPT MISSING");
                    state.status.set("Hard-refresh Ctrl+Shift+R");
                    return () => { alive = false; };
                }

                api = await window.FalseWorldGpu.create(canvas, {
                    onHud: (h) => {
                        if (!alive) return;
                        if (h.status && started) state.status.set(String(h.status));
                    },
                    loadChunk: bakeChunk,
                });
                api.setControlsEnabled(false);
                if (typeof api.setPaused === "function") api.setPaused(true);
                if (typeof api.setAvatarAtlasSource === "function") {
                    api.setAvatarAtlasSource(() =>
                        (vrmApi && typeof vrmApi.getAtlas === "function") ? vrmApi.getAtlas() : null
                    );
                }

                setPct(55, "LOADING… meadow", "load");
                await api.boot();
                if (typeof api.calibrate === "function") await api.calibrate(3);
                setPct(99, "CALIBRATING…", "cal");
                armStart();

            } catch (e) {
                console.error("[FW init]", e);
                const detail = (e && e.message) ? e.message : String(e);
                markError(detail || "INIT FAILED");
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
                try { vrmApi && vrmApi.destroy(); } catch (_) {}
                try { api && api.destroy(); } catch (_) {}
                delete window.__fw;
            };
        }
        "#,
        status,
        cam_mode,
        gate_error,
        unlocked
    );

    view! {
        <div class="stage" data-unlocked={unlocked}>
            <div class="viewport">
                {client_component(
                    ClientComponent::new("fw-meadow-gpu-v129")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                {client_component(
                    ClientComponent::new("fw-meadow-vrm-v31")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                <canvas id="fw-canvas" tabindex="0" aria-label="False World meadow"></canvas>
                <canvas id="fw-vrm" aria-hidden="true"></canvas>
                <div class="hud" aria-hidden="true">
                    <div class="hud-line">{status}</div>
                </div>
                <div class="vitals" aria-hidden="true">
                    <div class="vital-bar vital-hp">
                        <div class="vital-label">
                            <span>"VIDA"</span>
                            <span id="fw-hp-text">"1000 / 1000"</span>
                        </div>
                        <div class="vital-track">
                            <div id="fw-hp-fill" class="vital-fill" style="width:100%"></div>
                        </div>
                    </div>
                    <div class="vital-bar vital-mp">
                        <div class="vital-label">
                            <span>"MANA"</span>
                            <span id="fw-mp-text">"100 / 100"</span>
                        </div>
                        <div class="vital-track">
                            <div id="fw-mp-fill" class="vital-fill" style="width:100%"></div>
                        </div>
                    </div>
                    <div id="fw-fps" class="fps-meter" aria-live="off">"—"</div>
                </div>
            </div>

            <div id="fw-load-gate" class="load-gate" role="dialog" aria-label="False World loading">
                <div class="load-inner">
                    <div class="load-copy">
                        <div class="load-brand">"FALSE WORLD"</div>
                        <div class="load-intro">
                            <p>
                                "Tras derivar más allá del borde del espacio, el viaje vuelve a tocar suelo. "
                                "Una superficie se extiende en todas direcciones, sin límite visible."
                            </p>
                            <p>
                                "Con cada paso, algo desciende y altera la superficie, dejando rastros. "
                                "La deriva no termina aquí; continúa de otra forma."
                            </p>
                        </div>
                    </div>
                    <div class="load-actions">
                        <div id="fw-load-status" class="load-status" aria-live="polite">"LOADING… 0%"</div>
                        <div class="load-bar" aria-hidden="true">
                            <div id="fw-load-fill" class="load-bar-fill"></div>
                        </div>
                        <button
                            type="button"
                            id="fw-start-hit"
                            class="load-start"
                            aria-disabled="true"
                        >"[ ··· ]"</button>
                        <div class="load-hints">
                            <span><kbd>"W"</kbd><kbd>"A"</kbd><kbd>"S"</kbd><kbd>"D"</kbd>" MOVE"</span>
                            <span><kbd>"SHIFT"</kbd>" RUN"</span>
                            <span><kbd>"M"</kbd>" MAP"</span>
                            <span><kbd>"C"</kbd>" CAM"</span>
                            <span><kbd>"MOUSE"</kbd>" LOOK"</span>
                        </div>
                        <p class="load-err">{gate_error}</p>
                    </div>
                </div>
            </div>
        </div>
    }
}
