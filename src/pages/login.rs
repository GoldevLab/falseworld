use resuma::prelude::*;

/// Same hero as the game's boot screen (`#fw-load-gate` in `index.rs`) —
/// `.load-visual*` / `.load-brand*` / `.load-tagline` / `.load-start` are
/// shared, unscoped CSS classes, so logging in reads as the first act of one
/// continuous boot sequence rather than a bare settings form. `.fw-auth-card`
/// is the only new piece: a frosted glass panel over that same background.
pub fn page(_req: FlowRequest) -> View {
    view! {
        <div class="fw-authscreen">
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
            <div class="fw-authscreen-inner">
                <h1 class="load-brand">
                    <span class="load-brand-false">"FALSE"</span>
                    <span class="load-brand-world">"WORLD"</span>
                </h1>
                <p class="load-tagline">"Tras la deriva, una isla sin borde. Inicia sesión para volver."</p>
                <div class="fw-auth-card">
                    <h2>"Iniciar sesión"</h2>
                    <Form submit={crate::auth::login_submit}>
                        <label class="fw-auth-field">
                            <span class="fw-auth-label">"Usuario"</span>
                            <input
                                class="fw-auth-input"
                                name="username"
                                type="text"
                                required=true
                                minlength="3"
                                maxlength="24"
                                autocomplete="username"
                                placeholder="tu_usuario"
                            />
                        </label>
                        <label class="fw-auth-field">
                            <span class="fw-auth-label">"Contraseña"</span>
                            <input
                                class="fw-auth-input"
                                name="password"
                                type="password"
                                required=true
                                minlength="8"
                                autocomplete="current-password"
                                placeholder="••••••••"
                            />
                        </label>
                        <button type="submit" class="load-start is-ready">"Entrar"</button>
                    </Form>
                    <p class="fw-auth-alt">"¿No tienes cuenta? " <NavLink href="/register">"Crear una"</NavLink></p>
                </div>
            </div>
        </div>
    }
}
