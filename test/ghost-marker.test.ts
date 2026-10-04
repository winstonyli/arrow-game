import test from 'node:test';
import assert from 'node:assert/strict';
import { drawGhost } from '../src/render/ghost-marker.ts';
import type { Game } from '../src/game/game.ts';
import type { GhostState } from '../src/replay/ghost.ts';

type Call = unknown[];

const fakeCtx = () => {
  const calls: Call[] = [];
  // Cast: a recording Proxy stands in for the 2D context; drawGhost only calls methods and sets fields on it.
  return new Proxy({ calls }, {
    get: (t, k) => (k === 'calls' ? calls : (...a: unknown[]) => calls.push([k, ...a])),
    set: (t, k, v) => { calls.push(['set', k, v]); return true; },
  }) as CanvasRenderingContext2D & { calls: Call[] };
};
// Cast: drawGhost reads only ghost x/y/alive/fade and player.radius.
const game = (ghost: Pick<GhostState, 'x' | 'y' | 'alive' | 'fade'> | null | undefined) =>
  ({ ghost, player: { radius: 12 } }) as Pick<Game, 'ghost' | 'player'>;

test('drawGhost is a no-op without a ghost', () => {
  const c = fakeCtx();
  drawGhost(c, game(undefined), 0, 0);
  drawGhost(c, game(null), 0, 0);
  assert.equal(c.calls.length, 0);
});

test('drawGhost draws a ring at the camera-relative position', () => {
  const c = fakeCtx();
  drawGhost(c, game({ x: 150, y: 90, alive: true, fade: 0 }), 100, 40);
  const arc = c.calls.find((x) => x[0] === 'arc');
  assert.deepEqual(arc!.slice(1, 4), [50, 50, 12]);
  assert.ok(c.calls.some((x) => x[0] === 'stroke'));
  const last = c.calls.filter((x) => x[0] === 'set' && x[1] === 'globalAlpha').pop();
  assert.equal(last![2], 1); // alpha restored
});

test('a fully faded ghost draws nothing', () => {
  const c = fakeCtx();
  drawGhost(c, game({ x: 0, y: 0, alive: false, fade: 1 }), 0, 0);
  assert.equal(c.calls.length, 0);
});
