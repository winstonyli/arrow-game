import { newRun } from '../game/run.ts';
import { tick, choose } from '../game/game.ts';
import { createRecorder } from './recorder.ts';
import { quantize, dequantize } from './quantize.ts';
import { TICK_DT } from './version.ts';
import type { GameFx, GameSfx, ModeName } from '../game/game.ts';

/** The one live path: quantize input, tick, record. main.js and the test driver both go through it. */
export function createSession<F extends GameFx = GameFx>({ mode, seed, fx, sfx }: { mode: ModeName; seed: number; fx?: F; sfx?: GameSfx }) {
  const input = { x: 0, y: 0 }; // what the sim sees: the dequantized bytes
  const game = newRun({ mode, seed, input, fx, sfx });
  const rec = createRecorder({ mode, seed });
  return {
    game,
    seed,
    step(rawX: number, rawY: number) {
      if (game.over || game.offer) return; // tick() would return early: no tick, nothing to record
      const qx = quantize(rawX);
      const qy = quantize(rawY);
      input.x = dequantize(qx);
      input.y = dequantize(qy);
      tick(game, TICK_DT);
      rec.input(qx, qy);
    },
    pick(id: string) {
      if (!game.offer?.includes(id)) return false;
      choose(game, id);
      rec.pick(id);
      return true;
    },
    finish: () => rec.finish(game),
  };
}
