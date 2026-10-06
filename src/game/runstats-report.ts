import { SKILLS_BY_ID } from './skills.ts';
import { SOURCE_IDS, UP, HEAL, ACT } from './runstats.ts';
import type { RunStats } from './runstats.ts';

// Display names: a source is a weapon, the bow, or the modifier a burn or blast belongs to.
const SOURCE_SKILL: Record<string, string> = { burn: 'ignite', blast: 'explode' };
const sourceName = (id: string): string => (id === 'bow' ? 'Bow' : id === 'other' ? 'Other' : SKILLS_BY_ID[SOURCE_SKILL[id] ?? id].name);
const UP_IDS = ['power', 'crit', 'rapid', 'multishot'];

const pct = (v: number, total: number): string => `${total > 0 ? ((100 * v) / total).toFixed(1) : '0.0'}%`;
const rows = (entries: [string, number][], total: number): string[] =>
  entries
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => `  ${name.padEnd(16)}${Math.round(v).toString().padStart(9)}  ${pct(v, total).padStart(6)}`);

// Plain-text breakdown of a run's stats (soak output; the results screen can reuse it). The upgrade rows are
// approximate first-order shares carved out of the source rows, so every row sums to the total damage.
export function formatRunStats(st: RunStats): string[] {
  const sources = SOURCE_IDS.map((id, i): [string, number] => [sourceName(id), st.dmg[i]]);
  const upgrades = UP_IDS.map((id, i): [string, number] => [`~ ${SKILLS_BY_ID[id].name}`, st.up[i]]);
  let total = 0;
  for (const v of st.dmg) total += v;
  for (const v of st.up) total += v;
  const out = [`Damage dealt (effective, overkill excluded): ${Math.round(total)}`, ...rows(sources, total)];
  out.push('Upgrade shares (~ approximate: first-order estimates carved out of the rows above)', ...rows(upgrades, total));
  out.push(`Healing: ${SKILLS_BY_ID.vamp.name} ${st.heal[HEAL.VAMP].toFixed(0)}, ${SKILLS_BY_ID.regen.name} ${st.heal[HEAL.REGEN].toFixed(0)}`);
  out.push(
    `Activity: ${SKILLS_BY_ID.frost.name} ${st.act[ACT.SLOWED].toFixed(0)} enemy-seconds slowed, ${SKILLS_BY_ID.knockback.name} ${st.act[ACT.PUSHED].toFixed(0)} px pushed, ` +
      `${SKILLS_BY_ID.magnet.name} ${st.act[ACT.MAGNET].toFixed(0)} gems from the extended ring, ${st.act[ACT.ARROWS].toFixed(0)} arrows fired`,
  );
  return out;
}
