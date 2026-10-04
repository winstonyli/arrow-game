import { createGame } from './game.js';
import { createArena, ARENA_BOUNDS } from '../modes/arena.js';
import { createRooms } from '../modes/rooms.js';
import { seeded } from '../core/math.ts';

// One place that turns (mode, seed) into a game, shared by live play and replay playback.
export function newRun({ mode, seed, input, fx, sfx }) {
  const arena = mode === 'arena';
  return createGame({ mode: arena ? createArena() : createRooms(), bounds: arena ? ARENA_BOUNDS : undefined, rng: seeded(seed), input, fx, sfx });
}
