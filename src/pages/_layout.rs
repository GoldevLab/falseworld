//! Discovery-only sentinel: `resuma routes --generate` scans `src/pages/`
//! for `_layout.rs`/`layout.rs` files to know a layout applies at this
//! prefix and fill in `PagesRegistry::layout_for()` accordingly (see
//! `resuma::router::discover`). This file is intentionally excluded from
//! the generated `mod.rs` (layout files never get a `pub mod` there), so its
//! Rust content is never compiled — the actual layout implementation
//! (`RootLayout`, registered globally via `#[layout("/")]`) lives in
//! `main.rs`, same as before this file existed. Without this sentinel, every
//! page rendered through `PagesRegistry` got an empty layout chain and the
//! shell (`<header class="top">` nav, login/logout UI) never appeared,
//! despite `RootLayout` being registered and reachable — `layout_for()` just
//! never told `apply_layouts` to look it up.
