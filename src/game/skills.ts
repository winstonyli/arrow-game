import { MAX_BLADES } from './orbit.ts';
import type { PlayerStats } from './player.ts';

export interface Skill {
  id: string;
  name: string;
  desc: string;
  arena?: boolean; // offered only in the arena
  available?: (s: PlayerStats) => boolean; // false when already owned or maxed
  apply: (s: PlayerStats) => void;
}

export const SKILLS: Skill[] = [
  { id: 'multishot', name: 'Multishot', desc: '+1 arrow per volley', apply: (s) => { s.projectileCount += 1; } },
  { id: 'rapid', name: 'Rapid Fire', desc: '+30% attack speed', apply: (s) => { s.attackInterval /= 1.3; } },
  { id: 'power', name: 'Power Shot', desc: '+40% damage', apply: (s) => { s.damage *= 1.4; } },
  { id: 'pierce', name: 'Piercing', desc: 'Arrows pierce 1 more enemy', apply: (s) => { s.pierce += 1; } },
  { id: 'ricochet', name: 'Ricochet', desc: 'Arrows bounce off walls 2 times', apply: (s) => { s.bounce += 2; } },
  { id: 'swift', name: 'Swift Feet', desc: '+15% move speed', apply: (s) => { s.moveSpeed *= 1.15; } },
  { arena: true, id: 'regen', name: 'Regeneration', desc: '+1 HP per second', apply: (s) => { s.regen += 1; } },
  { arena: true, id: 'magnet', name: 'Magnet', desc: '+50% gem pickup range', apply: (s) => { s.pickupRadius *= 1.5; } },
  { arena: true, available: (s) => !s.homing, id: 'homing', name: 'Homing', desc: 'Arrows curve toward enemies', apply: (s) => { s.homing = 1; } },
  { arena: true, available: (s) => s.orbit < MAX_BLADES, id: 'blade', name: 'Orbit Blade', desc: '+1 blade circling you', apply: (s) => { s.orbit = Math.min(MAX_BLADES, s.orbit + 1); } },
];

export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function applySkill(stats: PlayerStats, id: string): void {
  const skill = SKILLS_BY_ID[id];
  if (!skill) throw new Error(`unknown skill: ${id}`);
  skill.apply(stats);
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
