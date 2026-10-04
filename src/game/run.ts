import { createGame } from './game.ts';
import { createArena, ARENA_BOUNDS } from '../modes/arena.ts';
import { createRooms } from '../modes/rooms.ts';
import { seeded } from '../core/math.ts';
import type { Vec } from '../core/math.ts';
import type { Game, Mode, ModeName, GameFx, GameSfx } from './game.ts';

// One place that turns (mode, seed) into a game, shared by live play and replay playback.
export function newRun<F extends GameFx = GameFx>({
  mode,
  seed,
  input,
  fx,
  sfx,
}: {
  mode: ModeName;
  seed: number;
  input: Vec;
  fx?: F;
  sfx?: GameSfx;
}): Game<Mode, F> {
  const arena = mode === 'arena';
  return createGame({ mode: arena ? createArena() : createRooms(), bounds: arena ? ARENA_BOUNDS : undefined, rng: seeded(seed), input, fx, sfx });
}
