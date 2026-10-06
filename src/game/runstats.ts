import { CRIT_MULT } from './modifiers.ts';
import type { Game } from './game.ts';

// Per-run damage, healing and activity tallies, for balance work and the results screen. Presentation only: nothing in
// the sim reads them and stateHash ignores them, so they never change a replay. They live on game.stats and start at
// zero with each game.

// Who dealt a hit. game.hitSrc names it: weaponSystem sets it per weapon, the bow, blade, burn and blast paths set
// their own, and OTHER catches a hit nothing claimed (a test asserts it stays empty).
export const SOURCE_IDS = ['bow', 'blade', 'shockwave', 'chain', 'boomerang', 'flame', 'mines', 'meteor', 'beam', 'drone', 'daggers', 'burn', 'blast', 'other'] as const;
export const SRC_OF: Record<string, number> = Object.fromEntries(SOURCE_IDS.map((id, i) => [id, i]));
export const SRC = { BOW: SRC_OF.bow, BURN: SRC_OF.burn, BLAST: SRC_OF.blast, OTHER: SRC_OF.other, BLADE: SRC_OF.blade };

// Sources whose rate Rapid Fire (cooldownMult) scales: everything with an interval (Beam, Flame trail and Orbit
// Blade have none; a burn and a blast are not attacks).
const TIMED = new Uint8Array(SOURCE_IDS.length);
for (const id of ['bow', 'shockwave', 'chain', 'boomerang', 'mines', 'meteor', 'drone', 'daggers']) TIMED[SRC_OF[id]] = 1;

// Damage the upgrades are credited with, carved out of the sources' damage (see creditDamage).
export const UP = { POWER: 0, CRIT: 1, RAPID: 2, MULTI: 3 } as const;
export const HEAL = { VAMP: 0, REGEN: 1 } as const;
export const ACT = { SLOWED: 0, PUSHED: 1, MAGNET: 2, ARROWS: 3 } as const;

export interface RunStats {
  dmg: Float64Array; // effective damage per source (SOURCE_IDS order), net of the upgrade shares below
  up: Float64Array; // damage credited to Big Numbers, Lucky Strike, Quick Draw and Multishot (UP order): APPROXIMATE shares
  heal: Float64Array; // hp actually gained from Vampiric and Chicken Soup (HEAL order)
  act: Float64Array; // enemy-seconds slowed, px pushed, gems captured beyond the base pickup radius, arrows fired (ACT order)
}

export const createRunStats = (): RunStats => ({
  dmg: new Float64Array(SOURCE_IDS.length),
  up: new Float64Array(4),
  heal: new Float64Array(2),
  act: new Float64Array(4),
});

// Credits one hit's effective damage (capped at the target's remaining hp, so overkill is not counted). The upgrade
// shares are first-order estimates, carved out in a fixed order: Big Numbers takes (1 - 1/damageMult) of the hit, a crit
// gives Lucky Strike the bonus part (1 - 1/CRIT_MULT) of the rest, then for a timed source Multishot takes (n - 1)/n of
// a bow hit and Quick Draw takes (1 - cooldownMult) of what is left. They assume each extra arrow or attack would hit
// like the first (misses and overlap are ignored), so they are approximate, and they sum with the sources to the total.
export function creditDamage(game: Game, eff: number, crit: boolean): void {
  const st = game.stats;
  const s = game.player.stats;
  const src = game.hitSrc;
  let rest = eff;
  if (s.damageMult > 1) {
    const p = rest * (1 - 1 / s.damageMult);
    st.up[UP.POWER] += p;
    rest -= p;
  }
  if (crit) {
    const c = rest * (1 - 1 / CRIT_MULT);
    st.up[UP.CRIT] += c;
    rest -= c;
  }
  if (TIMED[src]) {
    if (src === SRC.BOW && s.projectileCount > 1) {
      const m = rest * (1 - 1 / s.projectileCount);
      st.up[UP.MULTI] += m;
      rest -= m;
    }
    if (s.cooldownMult < 1) {
      const r = rest * (1 - s.cooldownMult);
      st.up[UP.RAPID] += r;
      rest -= r;
    }
  }
  st.dmg[src] += rest;
}
