/** False World explosives — raid damage tables (mirrors src/explosives.rs). */
(function () {
  const WALL_HP = [50, 250, 500, 1000, 2000];
  const SATCHEL_N = [1, 3, 10, 23, 46];
  const ROCKET_N = [1, 2, 4, 8, 15];
  const C4_N = [1, 1, 2, 4, 8];
  const EXP_AMMO_N = [3, 47, 185, 400, 799];

  const MELEE_SOFT = 10;
  const SATCHEL_SOFT = 1.1;
  const SATCHEL_R = 4;
  const SATCHEL_PLAYER_DMG = 475;
  const ROCKET_SPLASH_R = 3.5;
  const ROCKET_SPLASH_F = 0.45;

  const RESEARCH = {
    common: 15,
    uncommon: 30,
    rare: 60,
    very_rare: 120,
    max: 120,
  };

  function clampTier(t) {
    return Math.max(0, Math.min(4, t | 0));
  }

  function damageHard(table, tier) {
    const t = clampTier(tier);
    return WALL_HP[t] / table[t];
  }

  window.FalseWorldExplosives = {
    WALL_HP,
    SATCHEL_N,
    ROCKET_N,
    C4_N,
    EXP_AMMO_N,
    MELEE_SOFT,
    SATCHEL_SOFT,
    SATCHEL_R,
    SATCHEL_PLAYER_DMG,
    ROCKET_SPLASH_R,
    ROCKET_SPLASH_F,
    RESEARCH,
    satchelHard: (tier) => damageHard(SATCHEL_N, tier),
    rocketHard: (tier) => damageHard(ROCKET_N, tier),
    c4Hard: (tier) => damageHard(C4_N, tier),
    expAmmoHard: (tier) => damageHard(EXP_AMMO_N, tier),
    fireHurts: (tier) => clampTier(tier) <= 1,
    raidHint(tier) {
      const t = clampTier(tier);
      return (
        "Raid T" + t +
        " · Satchel×" + SATCHEL_N[t] +
        " · Rocket×" + ROCKET_N[t] +
        " · C4×" + C4_N[t]
      );
    },
  };
})();
