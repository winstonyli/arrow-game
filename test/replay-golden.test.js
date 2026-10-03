import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runReplay } from '../src/replay/playback.js';
import { validate } from '../src/replay/codec.js';
import { SIM_VERSION } from '../src/replay/version.js';

for (const mode of ['arena', 'rooms']) {
  test(`golden ${mode} replay still reproduces`, () => {
    const fx = JSON.parse(readFileSync(new URL(`./fixtures/golden-${mode}.json`, import.meta.url), 'utf8'));
    validate(fx.replay);
    assert.equal(fx.replay.sim, SIM_VERSION, 'SIM_VERSION changed: regenerate with node scripts/make-golden.mjs');
    const { hash, result } = runReplay(fx.replay);
    assert.equal(hash, fx.hash, 'sim behaviour changed: bump SIM_VERSION in src/replay/version.js, then run node scripts/make-golden.mjs');
    assert.deepEqual(result, fx.replay.result);
    assert.ok(fx.replay.picks.length > 0, 'the golden run should exercise skill picks');
  });
}
