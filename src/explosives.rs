//! Explosive raid tables (Rust-aligned MVP) — single source of truth for
//! both raid math paths: `fw-explosives.js` mirrors these constants for
//! instant client-side prediction, and `multiplayer.rs::explosive_hard_damage`
//! calls the same `*_damage_hard` functions server-side to settle the
//! authoritative HP once an `explode` message arrives (see `ws` handler).

#![allow(dead_code)]

/// Wall max HP by build tier (twig → armored).
pub const WALL_HP: [i32; 5] = [50, 250, 500, 1000, 2000];

/// Units needed to destroy a wall on the **hard** side.
pub const SATCHEL_TO_DESTROY: [i32; 5] = [1, 3, 10, 23, 46];
pub const ROCKET_TO_DESTROY: [i32; 5] = [1, 2, 4, 8, 15];
pub const C4_TO_DESTROY: [i32; 5] = [1, 1, 2, 4, 8];
pub const EXP_AMMO_TO_DESTROY: [i32; 5] = [3, 47, 185, 400, 799];

/// Soft-side multipliers.
pub const MELEE_SOFT_MULT: f32 = 10.0;
pub const SATCHEL_SOFT_MULT: f32 = 1.1;

pub const SATCHEL_RADIUS_M: f32 = 4.0;
pub const SATCHEL_PLAYER_DAMAGE: f32 = 475.0;
pub const ROCKET_SPLASH_RADIUS_M: f32 = 3.5;
pub const ROCKET_SPLASH_FRACTION: f32 = 0.45;

/// Research scrap costs by rarity (2025/2026).
pub const RESEARCH_COMMON: i32 = 15;
pub const RESEARCH_UNCOMMON: i32 = 30;
pub const RESEARCH_RARE: i32 = 60;
pub const RESEARCH_VERY_RARE: i32 = 120;
pub const RESEARCH_MAX: i32 = 120;

pub fn satchel_damage_hard(tier: usize) -> f32 {
    let t = tier.min(4);
    WALL_HP[t] as f32 / SATCHEL_TO_DESTROY[t] as f32
}

pub fn rocket_damage_hard(tier: usize) -> f32 {
    let t = tier.min(4);
    WALL_HP[t] as f32 / ROCKET_TO_DESTROY[t] as f32
}

pub fn c4_damage_hard(tier: usize) -> f32 {
    let t = tier.min(4);
    WALL_HP[t] as f32 / C4_TO_DESTROY[t] as f32
}

/// Fire damages twig/wood only (tier ≤ 1).
pub fn fire_hurts_tier(tier: usize) -> bool {
    tier <= 1
}
