import type { WeaponDef } from '../weapons.ts';

// Per level: how many blades circle the player and each blade's damage rate. The last count is MAX_BLADES
// (orbit.ts), the size the renderers' buffers assume.
export const BLADE_LEVELS = [
  { count: 1, dps: 30 },
  { count: 2, dps: 30 },
  { count: 3, dps: 35 },
  { count: 5, dps: 40 },
  { count: 8, dps: 45 },
];

export const BLADE: WeaponDef = {
  id: 'blade',
  name: 'Orbit Blade',
  desc: 'Blades circle you and cut what they touch',
  maxLevel: BLADE_LEVELS.length,
  onLevel(s, level) {
    s.orbit = BLADE_LEVELS[level - 1].count;
    s.bladeDps = BLADE_LEVELS[level - 1].dps;
  },
};
