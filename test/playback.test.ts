import test from 'node:test';
import assert from 'node:assert/strict';
import { driveLive } from '../scripts/lib/drive.ts';
import { runReplay, createPlayback, verify } from '../src/replay/playback.ts';
import { validate, ReplayError } from '../src/replay/codec.ts';
import { stateHash } from '../src/replay/hash.ts';
import { createRecorder } from '../src/replay/recorder.ts';
import { createSession } from '../src/replay/session.ts';
import { SIM_VERSION } from '../src/replay/version.ts';
import type { Game } from '../src/game/game.ts';

for (const mode of ['arena', 'rooms'] as const) {
  test(`a recorded ${mode} run replays to the identical state`, () => {
    const { game, replay } = driveLive({ mode, seed: 42, maxTicks: 3000 });
    validate(replay);
    assert.equal(replay.sim, SIM_VERSION);
    assert.equal(replay.ticks, game.ticks);
    const out = runReplay(replay);
    assert.equal(out.hash, stateHash(game));
    assert.deepEqual(out.result, replay.result);
    assert.ok(verify(replay));
  });
}

test('the rooms run includes skill picks (so picks are exercised)', () => {
  const { replay } = driveLive({ mode: 'rooms', seed: 42, maxTicks: 3000 });
  assert.ok(replay.picks.length > 0, 'raise maxTicks until a room is cleared');
});

test('a run that ends in death is recorded through the death tick', () => {
  const { game, replay } = driveLive({ mode: 'rooms', seed: 7, maxTicks: 60000, dirAt: () => ({ x: 0, y: 0 }) });
  assert.ok(game.over, 'a motionless player should die within 60000 ticks');
  assert.equal(replay.ticks, game.ticks);
  assert.equal(runReplay(replay).hash, stateHash(game));
});

test('input is run-length encoded', () => {
  const rec = createRecorder({ mode: 'arena', seed: 1 });
  for (let i = 0; i < 3; i++) rec.input(0, 0);
  rec.input(127, -127);
  rec.input(127, -127);
  rec.input(0, 0);
  const r = rec.finish({ time: 1, kills: 0, level: 1, mode: { } } as Game); // cast: finish reads only the result fields
  assert.deepEqual(r.inputs, [[3, 0, 0], [2, 127, -127], [1, 0, 0]]);
  assert.equal(r.ticks, 6);
});

test('session records only advancing ticks and only valid picks', () => {
  const s = createSession({ mode: 'rooms', seed: 3 });
  s.step(1, 0);
  s.step(1, 0);
  assert.equal(s.pick('not-offered'), false);
  s.game.offer = ['x'];
  s.step(1, 0); // no tick while an offer is pending: nothing recorded
  assert.equal(s.finish().ticks, 2);
});

test('tampering with a pick tick is a desync, not a hang', () => {
  const { replay } = driveLive({ mode: 'rooms', seed: 42, maxTicks: 3000 });
  const bad = structuredClone(replay);
  bad.picks[0][0] += 1;
  assert.throws(() => runReplay(bad), (e) => e instanceof ReplayError && e.code === 'desync');
  assert.equal(verify(bad), false);
});

test('verify rejects a claimed result the replay does not produce', () => {
  const { replay } = driveLive({ mode: 'arena', seed: 5, maxTicks: 600 });
  const lie = structuredClone(replay);
  lie.result.kills += 1;
  assert.equal(verify(lie), false);
});

test('playback steps one tick at a time and reports done', () => {
  const { replay } = driveLive({ mode: 'arena', seed: 5, maxTicks: 300 });
  const pb = createPlayback(replay);
  let n = 0;
  while (pb.step()) n++;
  assert.equal(n, replay.ticks);
  assert.ok(pb.done);
  assert.equal(pb.step(), false);
});
