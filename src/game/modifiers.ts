// The hit modifiers (spec 2026-10-04-modifiers-design.md): levelled 1..MOD_MAX passives that change what every
// qualifying hit does. All numbers are first guesses; hitEnemy and explosionSystem read them from here.
export const MOD_MAX = 5;
export const CRIT_CHANCE = 0.1; // per level
export const CRIT_MULT = 2;
export const KNOCK_PX = 10; // per level
export const VAMP_HP = 1; // per level, per kill
export const BLAST_BASE = 40; // px radius at level 0
export const BLAST_PER = 10; // px radius per level
export const BLAST_DMG = 8; // damage per level (x damageMult)
export const BLAST_CAP = 64; // queued blasts per tick; the overflow is dropped
export const FROST_SLOW = 0.12; // speed lost per level while slowed
export const FROST_SECS = 2;
export const IGNITE_DPS = 6; // per level, x damageMult
export const IGNITE_SECS = 3;
export const FROST_TINT = '#00e5ff'; // enemy tints, shared by both renderers; no other palette colour may sit near them (tested)
export const IGNITE_TINT = '#ff2d00';

export type ModKey = 'crit' | 'knockback' | 'explode' | 'vamp' | 'frost' | 'ignite';
export interface ModDef { id: string; name: string; desc: string; key: ModKey }

export const MODS: ModDef[] = [
  { id: 'crit', name: 'Lucky Strike', desc: '+10% chance for a hit to do double damage', key: 'crit' },
  { id: 'knockback', name: 'Personal Space', desc: 'Hits push enemies away from you (+10 px per level)', key: 'knockback' },
  { id: 'vamp', name: 'Vampiric', desc: 'Kills heal you (+1 HP per level)', key: 'vamp' },
  { id: 'explode', name: 'Popcorn', desc: 'Dead enemies pop and hurt the ones around them', key: 'explode' },
  { id: 'frost', name: 'Molasses', desc: 'Hits make enemies drag their feet (-12% speed per level, 2 s)', key: 'frost' },
  { id: 'ignite', name: 'Cooked', desc: 'Hits set enemies on fire (6 damage per second per level, 3 s)', key: 'ignite' },
];
