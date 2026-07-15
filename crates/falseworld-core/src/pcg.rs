//! PCG hash — stable, no sin/mod (matches False Earth philosophy).

#[inline]
pub fn pcg_hash(u: u32) -> f32 {
    let state = u.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    let mut word = ((state >> ((state >> 28) + 4)) ^ state).wrapping_mul(277_803_737);
    word = (word >> 22) ^ word;
    (word as f32) / 4_294_967_295.0
}

#[inline]
pub fn hash2to1(x: i32, y: i32) -> f32 {
    let seed = (x as u32)
        .wrapping_mul(1_597_334_677)
        .wrapping_add((y as u32).wrapping_mul(3_812_015_801));
    pcg_hash(seed)
}

#[inline]
pub fn hash2to2(x: i32, y: i32) -> (f32, f32) {
    let seed1 = (x as u32)
        .wrapping_mul(1_597_334_677)
        .wrapping_add((y as u32).wrapping_mul(3_812_015_801));
    let seed2 = (x as u32)
        .wrapping_mul(3_812_015_801)
        .wrapping_add((y as u32).wrapping_mul(1_597_334_677));
    (pcg_hash(seed1), pcg_hash(seed2))
}
