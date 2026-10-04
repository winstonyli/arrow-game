import test from 'node:test';
import assert from 'node:assert/strict';
import { driveLive } from '../scripts/lib/drive.js';
import { runReplay, createPlayback } from '../src/replay/playback.ts';
import { createGhostBuilder, ghostAt } from '../src/replay/ghost.ts';

const { replay, game: live } = driveLive({ mode: 'arena', seed: 9, maxTicks: 900 });
const built = () => {
  const b = createGhostBuilder(replay);
  assert.equal(b.work(1e9), true);
  return b.track;
};

// Reference: the replay's own player positions and stats, per tick.
const pos = [];
const stats = [];
{
  const p0 = createPlayback(replay).game.player;
  pos[0] = [p0.x, p0.y];
  stats[0] = [1, 0, 0];
  runReplay(replay, { onTick: (g) => { pos[g.ticks] = [g.player.x, g.player.y]; stats[g.ticks] = [g.level, g.kills, g.mode.room ?? 0]; } });
}

test('ghost positions at sample ticks equal the replay positions (all ticks, including tick 0)', () => {
  const t = built();
  for (let k = 0; k <= replay.ticks; k += 6) {
    const g = ghostAt(t, k);
    assert.deepEqual([g.x, g.y].map(Math.fround), pos[k].map(Math.fround), `tick ${k}`);
  }
});

test('between samples the ghost interpolates linearly', () => {
  const t = built();
  const a = ghostAt(t, 12);
  const b = ghostAt(t, 18);
  const m = ghostAt(t, 15);
  assert.ok(Math.abs(m.x - (a.x + b.x) / 2) < 1e-3);
  assert.ok(Math.abs(m.y - (a.y + b.y) / 2) < 1e-3);
});

test('level and kills are the replay stats at the last whole second', () => {
  const t = built();
  for (const k of [0, 60, 120, 600]) {
    const g = ghostAt(t, k + 30);
    assert.deepEqual([g.level, g.kills], [stats[k][0], stats[k][1]]);
  }
});

test('the ghost is not available until the track has been computed that far', () => {
  const b = createGhostBuilder(replay);
  b.work(0); // at least one tick, then stop
  assert.ok(ghostAt(b.track, 0));
  assert.equal(ghostAt(b.track, 500), null);
  assert.equal(b.work(1e9), true);
  assert.ok(ghostAt(b.track, 500));
});

test('after the run ends the ghost is out: parked at its end point and fading', () => {
  const t = built();
  const end = ghostAt(t, replay.ticks);
  assert.equal(end.alive, false); // at the replay's last tick the ghost is out
  const out = ghostAt(t, replay.ticks + 30);
  assert.equal(out.alive, false);
  assert.ok(out.fade > 0.4 && out.fade < 0.6);
  assert.deepEqual([out.x, out.y].map(Math.fround), [live.player.x, live.player.y].map(Math.fround));
  assert.equal(out.kills, live.kills);
});
