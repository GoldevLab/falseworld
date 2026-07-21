use resuma::prelude::*;

pub fn page(_req: FlowRequest) -> View {
    view! {
        <article class="about">
            <h1>"About False World"</h1>
            <p>
                "Arquitectura dual: "
                <b>"workers Resuma"</b>
                " (Rust CPU, FBM + PCG + blades 64 B) y "
                <b>"WebGPU browser"</b>
                " / binario nativo "
                <code>"falseworld-wgpu"</code>
                " con "
                <a href="https://docs.rs/wgpu/latest/wgpu/" target="_blank" rel="noreferrer">"wgpu"</a>
                "."
            </p>
            <p>
                "Inspiración: "
                <a href="https://github.com/momentchan/false-earth" target="_blank" rel="noreferrer">"False Earth"</a>
                " de Ming-Jyun Hung — grid snap, compute grass, FBM, cámaras Follow/FPV. Código propio; no es un port de TSL."
            </p>
            <h2>"Stack"</h2>
            <ul>
                <li>"falseworld-core — noise, terrain, grass, FWCH codec"</li>
                <li>"falseworld (Resuma Flow) — start/claim chunk workers"</li>
                <li>"Cliente WebGPU — meadow; capa VRM — Three.js + @pixiv/three-vrm (como VRMedia)"</li>
                <li>"falseworld-wgpu — preview nativo wgpu 30"</li>
            </ul>
            <p>
                "Avatar local: symlink a "
                <code>"vrmedia/public/avatars/female/avatar1.vrm"</code>
                " (Sophia) + animaciones Mixamo Idle/Walk."
            </p>
        </article>
    }
}
