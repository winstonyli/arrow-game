import { newRun } from '../game/run.ts';
import { tick, choose } from '../game/game.ts';
import { dequantize } from './quantize.ts';
import { stateHash } from './hash.ts';
import { ReplayError } from './codec.ts';
import { resultFor } from './recorder.ts';
import { TICK_DT } from './version.ts';

/** Steps a replay one tick at a time. `fx`/`sfx` are presentation and never change the sim. */
export function createPlayback(/** @type {import('./codec.ts').Replay} */ replay, { fx, sfx } = /** @type {any} */ ({})) {
  const input = { x: 0, y: 0 };
  const game = newRun({ mode: replay.mode, seed: replay.seed, input, fx, sfx });
  let run = 0;
  let used = 0;
  let pi = 0;
  const applyPicks = () => {
    while (pi < replay.picks.length && replay.picks[pi][0] === game.ticks) {
      const id = replay.picks[pi++][1];
      if (!game.offer?.includes(id)) throw new ReplayError('desync');
      choose(game, id);
    }
  };
  return {
    game,
    input,
    get done() {
      return game.ticks >= replay.ticks;
    },
    /** One tick. Returns false once the replay is finished. Throws ReplayError('desync') if it does not match the sim. */
    step() {
      applyPicks();
      if (game.ticks >= replay.ticks) return false;
      if (game.over || game.offer) throw new ReplayError('desync');
      const [n, qx, qy] = replay.inputs[run];
      input.x = dequantize(qx);
      input.y = dequantize(qy);
      tick(game, TICK_DT);
      if (++used === n) {
        run++;
        used = 0;
      }
      applyPicks(); // a pick never waits a frame: the viewer never shows the picker
      return true;
    },
  };
}

/** Runs a replay to the end. `onTick(game)` fires after every tick. */
export function runReplay(/** @type {import('./codec.ts').Replay} */ replay, { onTick } = /** @type {any} */ ({})) {
  const pb = createPlayback(replay);
  while (pb.step()) onTick?.(pb.game);
  return { game: pb.game, hash: stateHash(pb.game), result: resultFor(replay.mode, pb.game) };
}

/** True when the replay re-simulates without desync to exactly its claimed result. */
export function verify(/** @type {import('./codec.ts').Replay} */ replay) {
  try {
    const { result } = runReplay(replay);
    const c = replay.result;
    return result.time === c.time && result.kills === c.kills && result.level === c.level && result.room === c.room;
  } catch (e) {
    if (e instanceof ReplayError) return false;
    throw e;
  }
}
