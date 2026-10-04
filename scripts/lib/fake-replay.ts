import { SIM_VERSION } from '../../src/replay/version.ts';
import type { Replay, ReplayResult } from '../../src/replay/codec.ts';

// A small valid replay for tests. `over` overrides top-level fields; `over.result` merges into the result.
// `over` is loose on purpose: tests build invalid replays to exercise validate().
export function fakeReplay(over: { [field: string]: unknown; result?: Partial<ReplayResult> } = {}): Replay {
  const { result, ...rest } = over;
  return {
    v: 1,
    sim: SIM_VERSION,
    engine: 'v8',
    mode: 'arena',
    seed: 123,
    ticks: 5,
    inputs: [[3, 0, 0], [2, 127, -127]],
    picks: [],
    result: { time: 5 / 60, kills: 0, level: 1, room: 0, ...result },
    savedAt: 1,
    ...rest,
  };
}
