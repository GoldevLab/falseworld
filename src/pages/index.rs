use resuma::prelude::*;

pub fn page(_req: FlowRequest) -> View {
    let status = use_signal("Generando pradera…".to_string());
    let blades = use_signal("0".to_string());
    let cam_mode = use_signal("follow".to_string());

    visible_task!(
        r#"
        async (state, __resuma) => {
            const canvas = document.getElementById("fw-canvas");
            if (!canvas) { state.status.set("Canvas ausente"); return; }

            for (let i = 0; i < 80 && !window.FalseWorldGpu; i++) {
                await new Promise((r) => setTimeout(r, 40));
            }
            if (!window.FalseWorldGpu) {
                state.status.set("Client WebGPU no cargó");
                return;
            }

            let api = null;
            let alive = true;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            async function bakeChunk(ox, oz) {
                state.status.set("Worker · pradera…");
                const started = await __resuma.action("start_meadow_chunk", [
                    42, ox, oz, 48, 80, 80,
                ]);
                const gid = started.graph_id;
                const token = started.access_token || "";
                let delay = 200;
                for (let i = 0; i < 400; i++) {
                    if (!alive) return null;
                    const url = "/_resuma/graph/" + encodeURIComponent(gid)
                        + "/status?token=" + encodeURIComponent(token);
                    const res = await fetch(url, { credentials: "same-origin" });
                    if (res.status === 429) { await sleep(delay = Math.min(delay * 2, 3000)); continue; }
                    const st = await res.json();
                    const pct = st.progress ?? st.pct ?? 0;
                    if (pct) state.status.set("Worker · " + pct + "%");
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
                api = await window.FalseWorldGpu.create(canvas, {
                    onHud: (h) => {
                        if (!alive) return;
                        if (h.status) state.status.set(String(h.status));
                        if (h.blades != null) state.blades.set(String(h.blades));
                    },
                    loadChunk: bakeChunk,
                });
                await api.boot();
                state.status.set("WASD caminar · C cambia cámara");
            } catch (e) {
                state.status.set("Error: " + (e && e.message ? e.message : e));
            }

            window.__fw = {
                setCam: (m) => {
                    state.cam_mode.set(String(m));
                    api && api.setCameraMode(m);
                },
                rebake: () => api && api.rebake(),
            };

            return () => {
                alive = false;
                try { api && api.destroy(); } catch (_) {}
                delete window.__fw;
            };
        }
        "#,
        status,
        blades,
        cam_mode
    );

    view! {
        <div class="stage">
            <div class="viewport">
                {client_component(
                    ClientComponent::new("falseworld-gpu")
                        .class("fw-boot")
                        .aria_hidden(true)
                )}
                <canvas id="fw-canvas" tabindex="0" aria-label="False World meadow"></canvas>
                <div class="hud">
                    <div class="hud-line">{status}</div>
                    <div class="hud-line muted">"Blades · "{blades}</div>
                </div>
            </div>
            <aside class="panel">
                <h1>"False World"</h1>
                <p class="lede">
                    "Inicio de un juego de superficie: FBM + hierba empaquetada en workers Resuma, render WebGPU en el cliente. Inspirado en False Earth."
                </p>
                <div class="modes">
                    <button type="button" onClick={js! { window.__fw?.setCam("follow"); }}>"Follow"</button>
                    <button type="button" onClick={js! { window.__fw?.setCam("fpv"); }}>"FPV"</button>
                    <button type="button" onClick={js! { window.__fw?.setCam("orbit"); }}>"Orbit"</button>
                </div>
                <button type="button" class="primary" onClick={js! { window.__fw?.rebake(); }}>"Regenerar chunk"</button>
                <ul class="tips">
                    <li>"WASD / flechas — caminar"</li>
                    <li>"C — ciclar cámara"</li>
                    <li>"Worker Rust cuece heightmap + blades → artifact FWCH"</li>
                </ul>
            </aside>
        </div>
    }
}
