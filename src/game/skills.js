import { MAX_BLADES } from './orbit.js';

export const SKILLS = [
  { id: 'multishot', name: 'Multishot', desc: '+1 arrow per volley', apply: (s) => { s.projectileCount += 1; } },
  { id: 'rapid', name: 'Rapid Fire', desc: '+30% attack speed', apply: (s) => { s.attackInterval /= 1.3; } },
  { id: 'power', name: 'Power Shot', desc: '+40% damage', apply: (s) => { s.damage *= 1.4; } },
  { id: 'pierce', name: 'Piercing', desc: 'Arrows pierce 1 more enemy', apply: (s) => { s.pierce += 1; } },
  { id: 'ricochet', name: 'Ricochet', desc: 'Arrows bounce off walls 2 times', apply: (s) => { s.bounce += 2; } },
  { id: 'swift', name: 'Swift Feet', desc: '+15% move speed', apply: (s) => { s.moveSpeed *= 1.15; } },
  { id: 'regen', name: 'Regeneration', desc: '+1 HP per second', apply: (s) => { s.regen += 1; } },
  { id: 'magnet', name: 'Magnet', desc: '+50% gem pickup range', apply: (s) => { s.pickupRadius *= 1.5; } },
  { id: 'homing', name: 'Homing', desc: 'Arrows curve toward enemies', apply: (s) => { s.homing = 1; } },
  { id: 'blade', name: 'Orbit Blade', desc: '+1 blade circling you', apply: (s) => { s.orbit = Math.min(MAX_BLADES, s.orbit + 1); } },
];

export const SKILLS_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function applySkill(stats, id) {
  const skill = SKILLS_BY_ID[id];
  if (!skill) throw new Error(`unknown skill: ${id}`);
  skill.apply(stats);
}

// rng: () => number in [0, 1). Partial Fisher-Yates over the skill ids.
export function pickChoices(rng, n = 3) {
  const ids = SKILLS.map((s) => s.id);
  for (let i = 0; i < Math.min(n, ids.length); i++) {
    const j = i + Math.floor(rng() * (ids.length - i));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, n);
}
