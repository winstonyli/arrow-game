// The hit modifiers (spec 2026-10-04-modifiers-design.md): levelled 1..MOD_MAX passives that change what every
// qualifying hit does. All numbers are first guesses; hitEnemy and explosionSystem read them from here.
export const MOD_MAX = 5;
export const CRIT_CHANCE = 0.1; // per level
export const CRIT_MULT = 2;

export type ModKey = 'crit' | 'knockback' | 'explode' | 'vamp';
export interface ModDef { id: string; name: string; desc: string; key: ModKey }

export const MODS: ModDef[] = [
  { id: 'crit', name: 'Critical Hits', desc: '+10% chance to deal double damage (arrows, shockwave, lightning)', key: 'crit' },
];
