use resuma::prelude::*;

/// See `login.rs` — identical boot-hero + glass-card treatment.
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
                <p class="load-tagline">"Tras la deriva, una isla sin borde. Crea tu cuenta para empezar."</p>
                <div class="fw-auth-card">
                    <h2>"Crear cuenta"</h2>
                    <Form submit={crate::auth::register_submit}>
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
                                autocomplete="new-password"
                                placeholder="mínimo 8 caracteres"
                            />
                        </label>
                        <button type="submit" class="load-start is-ready">"Crear cuenta"</button>
                    </Form>
                    <p class="fw-auth-alt">"¿Ya tienes cuenta? " <NavLink href="/login">"Inicia sesión"</NavLink></p>
                </div>
            </div>
        </div>
    }
}
