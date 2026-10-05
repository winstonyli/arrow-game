import { MAX_WEAPONS, WEAPONS } from './weapons.ts';
import type { WeaponDef } from './weapons.ts';
import type { PlayerStats } from './player.ts';
import { MOD_MAX, MODS } from './modifiers.ts';
import type { ModDef } from './modifiers.ts';

export interface Skill {
  id: string;
  name: string;
  desc: string;
  arena?: boolean; // offered only in the arena
  available?: (s: PlayerStats) => boolean; // false when already owned or maxed
  tag?: (s: PlayerStats) => string; // short label for the offer card: NEW or the level step (weapons and modifiers)
  apply: (s: PlayerStats) => void;
}

const PASSIVES: Skill[] = [
  { id: 'multishot', name: 'Multishot', desc: '+1 arrow per volley (bow)', apply: (s) => { s.projectileCount += 1; } },
  { id: 'rapid', name: 'Quick Draw', desc: 'The bow and your timed weapons attack 30% faster (not Lighthouse, Hot Heels, Whirligig)', apply: (s) => { s.cooldownMult /= 1.3; } },
  { id: 'power', name: 'Big Numbers', desc: 'Every hit does 40% more damage', apply: (s) => { s.damageMult *= 1.4; } },
  { id: 'pierce', name: 'Skewer', desc: 'Arrows go through 1 more enemy before they stop', apply: (s) => { s.pierce += 1; } },
  { id: 'ricochet', name: 'Pinball', desc: 'Arrows bounce off walls 2 more times', apply: (s) => { s.bounce += 2; } },
  { id: 'swift', name: 'Zoomies', desc: 'You run 15% faster', apply: (s) => { s.moveSpeed *= 1.15; } },
  { arena: true, id: 'regen', name: 'Chicken Soup', desc: '+1 HP per second, steady as you go', apply: (s) => { s.regen += 1; } },
  { arena: true, id: 'magnet', name: 'Magnet', desc: '+50% gem pickup range', apply: (s) => { s.pickupRadius *= 1.5; } },
  { arena: true, available: (s) => !s.homing, id: 'homing', name: 'Heat Seeker', desc: 'Arrows steer themselves toward nearby enemies', apply: (s) => { s.homing = 1; } },
];

const slotsUsed = (s: PlayerStats): number => Object.keys(s.weapons).length + 1; // the bow always holds one

function weaponSkill(w: WeaponDef): Skill {
  const level = (s: PlayerStats): number => s.weapons[w.id] ?? 0;
  return {
    arena: true,
    id: w.id,
    name: w.name,
    desc: w.desc,
    available: (s) => level(s) < w.maxLevel && (level(s) > 0 || slotsUsed(s) < MAX_WEAPONS),
    tag: (s) => (level(s) === 0 ? 'NEW' : `Lv ${level(s)} → ${level(s) + 1}`),
    apply: (s) => {
      const next = Math.min(w.maxLevel, level(s) + 1);
      s.weapons[w.id] = next;
      w.onLevel?.(s, next);
    },
  };
}

function modifierSkill(m: ModDef): Skill {
  return {
    arena: true,
    id: m.id,
    name: m.name,
    desc: m.desc,
    available: (s) => s[m.key] < MOD_MAX,
    tag: (s) => (s[m.key] === 0 ? 'NEW' : `Lv ${s[m.key]} → ${s[m.key] + 1}`),
    apply: (s) => { s[m.key] = Math.min(MOD_MAX, s[m.key] + 1); },
  };
}

export const SKILLS: Skill[] = [...PASSIVES, ...WEAPONS.map(weaponSkill), ...MODS.map(modifierSkill)];

export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function applySkill(stats: PlayerStats, id: string): void {
  const skill = SKILLS_BY_ID[id];
  if (!skill) throw new Error(`unknown skill: ${id}`);
  skill.apply(stats);
}

// The card label for an offered id: 'NEW' or 'Lv 2 → 3' for a weapon or modifier, '' for a passive.
export function offerTag(stats: PlayerStats, id: string): string {
  return SKILLS_BY_ID[id]?.tag?.(stats) ?? '';
}

// rng: () => number in [0, 1). Partial Fisher-Yates over the skills that can be offered: `arena` skills only when
// `arena` is true (rooms keeps the original pool), and none that `available(stats)` rules out (already owned or maxed).
export function pickChoices(rng: () => number, n = 3, stats: PlayerStats | null = null, arena = false): string[] {
  const ids = SKILLS.filter((k) => (arena || !k.arena) && (!stats || !k.available || k.available(stats))).map((k) => k.id);
  const m = Math.min(n, ids.length);
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rng() * (ids.length - i));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, m);
}
