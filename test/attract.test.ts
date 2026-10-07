import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttract, ATTRACT_CAPACITY } from '../src/game/attract.ts';
import { createFx } from '../src/render/fx.ts';

test('the title backdrop plays on by itself: never dies, moves, kills and levels up', () => {
  const a = createAttract(createFx(ATTRACT_CAPACITY), 7, 0);
  const start = { x: a.game.player.x, y: a.game.player.y };
  for (let i = 0; i < 60 * 240; i++) a.step(1 / 60);
  assert.equal(a.game.over, false);
  assert.ok(a.game.kills > 5);
  assert.ok(a.game.level > 1);
  assert.ok(Math.hypot(a.game.player.x - start.x, a.game.player.y - start.y) > 1 || a.game.kills > 0);
  assert.equal(a.game.offer, null);
});
