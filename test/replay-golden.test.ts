import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runReplay } from '../src/replay/playback.ts';
import { validate, ReplayError } from '../src/replay/codec.ts';
import { SIM_VERSION } from '../src/replay/version.ts';
import type { Replay } from '../src/replay/codec.ts';

// test/fixtures/golden-<mode>.json, as scripts/make-golden.ts writes it.
interface GoldenFixture {
  replay: Replay;
  hash: number;
}

for (const mode of ['arena', 'rooms']) {
  test(`golden ${mode} replay still reproduces`, () => {
    const fx = JSON.parse(readFileSync(new URL(`./fixtures/golden-${mode}.json`, import.meta.url), 'utf8')) as GoldenFixture;
    validate(fx.replay);
    assert.equal(fx.replay.sim, SIM_VERSION, 'SIM_VERSION changed: regenerate with node scripts/make-golden.ts');
    const advice = 'sim behaviour changed: bump SIM_VERSION in src/replay/version.ts, then run node scripts/make-golden.ts';
    let out: ReturnType<typeof runReplay>;
    try {
      out = runReplay(fx.replay);
    } catch (e) {
      if (e instanceof ReplayError && e.code === 'desync') assert.fail(`${advice} (${e.code})`); // a desync is the usual symptom
      throw e;
    }
    const { hash, result } = out;
    assert.equal(hash, fx.hash, advice);
    assert.deepEqual(result, fx.replay.result);
    assert.ok(fx.replay.picks.length > 0, 'the golden run should exercise skill picks');
  });
}
