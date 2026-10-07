import { HIT_CRIT, HIT_KNOCK, HIT_STATUS, HIT_TICK } from './hitflags.ts';
import type { ModKey } from './modifiers.ts';

// What each damage source's hits may do. The one table the sim (via HIT_FLAGS) and the UI (via covers) both read, so
// they cannot disagree. `note` is why a flag is off where that is not obvious.
export type CoverageId = 'bow' | 'blade' | 'shockwave' | 'chain' | 'boomerang' | 'flame' | 'mines' | 'meteor' | 'beam' | 'drone' | 'daggers';
export interface Coverage { crit: boolean; knock: boolean; status: boolean; tick: boolean; note: string }
const c = (crit: boolean, knock: boolean, status: boolean, tick: boolean, note: string): Coverage => ({ crit, knock, status, tick, note });

export const COVERAGE: Record<CoverageId, Coverage> = {
  bow: c(true, true, true, false, 'Arrows hit once, in a direction.'),
  blade: c(false, false, false, false, 'Per-tick damage: crits and pushes would be noise.'),
  shockwave: c(true, false, true, false, 'No push yet (Task 2 adds it).'),
  chain: c(true, true, true, false, 'Each jump is a hit with a direction.'),
  boomerang: c(false, false, false, false, 'No status yet (Task 2 adds it).'),
  flame: c(false, false, true, true, 'Tick damage: no crits or pushes.'),
  mines: c(false, true, true, false, 'No crit yet (Task 2 adds it).'),
  meteor: c(false, true, true, false, 'No crit yet (Task 2 adds it).'),
  beam: c(false, false, true, true, 'Tick damage: no crits or pushes.'),
  drone: c(true, false, true, false, 'Stings have no direction worth pushing along.'),
  daggers: c(true, false, true, false, 'Pierce through; a push would fight the flight path.'),
};

const flagsOf = (x: Coverage): number => (x.crit ? HIT_CRIT : 0) | (x.knock ? HIT_KNOCK : 0) | (x.status ? HIT_STATUS : 0) | (x.tick ? HIT_TICK : 0);
export const HIT_FLAGS = Object.fromEntries(Object.entries(COVERAGE).map(([id, x]) => [id, flagsOf(x)])) as Record<CoverageId, number>;

// Does modifier `key` do anything to this source's hits? Vampiric and Popcorn act on kills, which every source can make.
export function covers(id: CoverageId, key: ModKey): boolean {
  const x = COVERAGE[id];
  switch (key) {
    case 'crit': return x.crit;
    case 'knockback': return x.knock;
    case 'frost':
    case 'ignite': return x.status;
    default: return true;
  }
}
