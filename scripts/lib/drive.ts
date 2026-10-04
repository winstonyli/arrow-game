import { createSession } from '../../src/replay/session.ts';
import type { ModeName } from '../../src/game/game.ts';
import type { Vec } from '../../src/core/math.ts';

// A scripted player: eight compass directions, 45 ticks each. Reads no sim state, so runs are reproducible.
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
export const scriptedDir = (tick: number): Vec => {
  // Rooms mode only fires while the player is still, so a constant mover never clears a room.
  if (tick % 45 >= 30) return { x: 0, y: 0 };
  const d = DIRS[Math.floor(tick / 45) % 8];
  const m = Math.hypot(d[0], d[1]);
  return { x: d[0] / m, y: d[1] / m };
};

// Plays like main.ts does (through a session): picks the first offered skill, stops at maxTicks or death.
export function driveLive({ mode, seed, maxTicks, dirAt = scriptedDir }: { mode: ModeName; seed: number; maxTicks: number; dirAt?: (tick: number) => Vec }) {
  const s = createSession({ mode, seed });
  while (s.game.ticks < maxTicks && !s.game.over) {
    if (s.game.offer) {
      s.pick(s.game.offer[0]);
      continue;
    }
    const d = dirAt(s.game.ticks);
    s.step(d.x, d.y);
  }
  return { game: s.game, replay: s.finish() };
}
