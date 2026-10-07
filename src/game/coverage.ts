import { HIT_CRIT, HIT_KNOCK, HIT_STATUS, HIT_TICK } from './hitflags.ts';
import type { ModKey } from './modifiers.ts';

// What each damage source's hits may do. The one table the sim (via HIT_FLAGS) and the UI (via covers) both read, so
// they cannot disagree. `note` is why a flag is off where that is not obvious.
export type CoverageId = 'bow' | 'blade' | 'shockwave' | 'chain' | 'boomerang' | 'flame' | 'mines' | 'meteor' | 'beam' | 'drone' | 'daggers';
export interface Coverage { crit: boolean; knock: boolean; status: boolean; tick: boolean; note: string }
const c = (crit: boolean, knock: boolean, status: boolean, tick: boolean, note: string): Coverage => ({ crit, knock, status, tick, note });

export const COVERAGE: Record<CoverageId, Coverage> = {
  bow: c(true, true, true, false, 'Arrows hit once, in a direction.'),
  blade: c(false, false, true, false, 'Per-tick damage: crits and pushes would be noise; contact still applies Molasses and Cooked.'),
  shockwave: c(true, true, true, false, 'The ring pushes along the line from its origin.'),
  chain: c(true, true, true, false, 'Each jump is a hit with a direction.'),
  boomerang: c(true, false, true, false, 'Out and back along one line, so a push direction is ambiguous.'),
  flame: c(false, false, true, true, 'Tick damage: no crits or pushes.'),
  mines: c(true, true, true, false, 'A blast pushes away from its centre.'),
  meteor: c(true, true, true, false, 'A blast pushes away from its centre.'),
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

const NO_TIMER = new Set(['blade', 'flame', 'beam']); // Quick Draw does not speed these
const baseOf = (id: string): string => id.split('.')[0];

// Does upgrade or modifier `up` change weapon `w`'s hits? Symmetric; ids may carry a branch suffix. The bow has no chip, so bow-only
// upgrades (Multishot, Skewer, Pinball, Heat Seeker) and the run upgrades (Zoomies, Chicken Soup, Magnet) affect no weapon.
export function affects(a: string, b: string): boolean {
  const x = baseOf(a);
  const y = baseOf(b);
  const xw = x in COVERAGE && x !== 'bow';
  const yw = y in COVERAGE && y !== 'bow';
  if (xw === yw) return false;
  const w = (xw ? x : y) as CoverageId;
  const up = xw ? y : x;
  switch (up) {
    case 'crit': case 'knockback': case 'frost': case 'ignite': case 'vamp': case 'explode': return covers(w, up);
    case 'power': return true;
    case 'rapid': return !NO_TIMER.has(w);
    default: return false;
  }
}
