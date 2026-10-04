import { newRun } from '../game/run.ts';
import { tick, choose } from '../game/game.ts';
import { createRecorder } from './recorder.js';
import { quantize, dequantize } from './quantize.js';
import { TICK_DT } from './version.js';

/** The one live path: quantize input, tick, record. main.js and the test driver both go through it. */
export function createSession({ mode, seed, fx, sfx }) {
  const input = { x: 0, y: 0 }; // what the sim sees: the dequantized bytes
  const game = newRun({ mode, seed, input, fx, sfx });
  const rec = createRecorder({ mode, seed });
  return {
    game,
    seed,
    step(/** @type {number} */ rawX, /** @type {number} */ rawY) {
      if (game.over || game.offer) return; // tick() would return early: no tick, nothing to record
      const qx = quantize(rawX);
      const qy = quantize(rawY);
      input.x = dequantize(qx);
      input.y = dequantize(qy);
      tick(game, TICK_DT);
      rec.input(qx, qy);
    },
    pick(/** @type {string} */ id) {
      if (!game.offer?.includes(id)) return false;
      choose(game, id);
      rec.pick(id);
      return true;
    },
    finish: () => rec.finish(game),
  };
}
