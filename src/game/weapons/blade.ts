import type { WeaponDef } from '../weapons.ts';
import { BLADE_BRANCH } from '../orbit.ts';

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
  name: 'Whirligig',
  desc: 'Spinning blades whirl around you and slice what they touch',
  maxLevel: BLADE_LEVELS.length,
  onLevel(s, level) {
    s.orbit = BLADE_LEVELS[level - 1].count;
    s.bladeDps = BLADE_LEVELS[level - 1].dps * BLADE_BRANCH[s.branches.blade ?? 0].dps;
  },
  branches: [
    { name: 'Carousel', desc: 'The blades orbit much wider and sweep a bigger area, at a bit less damage' },
    { name: 'Blender', desc: 'The blades spin tight and twice as fast, for more damage' },
  ],
};
