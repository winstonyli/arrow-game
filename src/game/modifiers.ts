// The hit modifiers (spec 2026-10-04-modifiers-design.md): levelled 1..MOD_MAX passives that change what every
// qualifying hit does. All numbers are first guesses; hitEnemy and explosionSystem read them from here.
export const MOD_MAX = 5;
export const CRIT_CHANCE = 0.1; // per level
export const CRIT_MULT = 2;
export const KNOCK_PX = 10; // per level
export const VAMP_HP = 1; // per level, per kill

export type ModKey = 'crit' | 'knockback' | 'explode' | 'vamp';
export interface ModDef { id: string; name: string; desc: string; key: ModKey }

export const MODS: ModDef[] = [
  { id: 'crit', name: 'Critical Hits', desc: '+10% chance to deal double damage (arrows, shockwave, lightning)', key: 'crit' },
  { id: 'knockback', name: 'Knockback', desc: 'Arrows and lightning push enemies back (+10 px per level)', key: 'knockback' },
  { id: 'vamp', name: 'Vampiric', desc: 'Kills heal you (+1 HP per level)', key: 'vamp' },
];
