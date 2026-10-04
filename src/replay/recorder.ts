import { SIM_VERSION } from './version.ts';
import { REPLAY_VERSION } from './codec.ts';
import type { Replay, ReplayResult, ReplayInputs, ReplayPick } from './codec.ts';
import type { Game, ModeName } from '../game/game.ts';

/** The JS engine family (trig results may differ across engines). */
export function engineTag(): 'v8' | 'gecko' | 'jsc' | 'unknown' {
  const ua = globalThis.navigator?.userAgent ?? '';
  if (/Firefox\//.test(ua)) return 'gecko';
  if (/Chrome\/|Chromium\/|Edg\/|Node\.js/.test(ua)) return 'v8';
  if (/Safari\//.test(ua)) return 'jsc';
  return 'unknown';
}

/** The outcome of a run, in a form that replays and the store can compare exactly. */
export const resultFor = (mode: string, game: Game): ReplayResult => ({
  time: game.time,
  kills: game.kills,
  level: game.level,
  room: game.mode?.room ?? 0,
});

/** Records one run. Call `input` once per tick that advanced and `pick` when a skill is chosen. */
export function createRecorder({ mode, seed }: { mode: ModeName; seed: number }) {
  const inputs: ReplayInputs = [];
  const picks: ReplayPick[] = [];
  let ticks = 0;
  return {
    input(qx: number, qy: number) {
      const last = inputs[inputs.length - 1];
      if (last && last[1] === qx && last[2] === qy) last[0]++;
      else inputs.push([1, qx, qy]);
      ticks++;
    },
    pick(id: string) {
      picks.push([ticks, id]); // applied before the tick that would be number `ticks`
    },
    finish(game: Game): Replay {
      return { v: REPLAY_VERSION, sim: SIM_VERSION, engine: engineTag(), mode, seed, ticks, inputs, picks, result: resultFor(mode, game), savedAt: Date.now() };
    },
  };
}
