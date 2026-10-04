// Seconds for a gem from 85% of the pickup radius (a moving player leaves the very edge before capture) to be collected, for a still and a moving player.
import { World } from '../src/core/world.ts';
import { moveSystem } from '../src/core/systems.ts';
import { createPlayer } from '../src/game/player.js';
import { spawnGem, gemSystem } from '../src/game/gems.js';

const dt = 1 / 60;
function collect(speed, angle = 0) {
  const world = new World(8);
  const player = createPlayer(450, 500);
  player.vx = speed;
  const reach = player.stats.pickupRadius;
  spawnGem(world, 450 + Math.cos(angle) * (reach * 0.85), 500 + Math.sin(angle) * (reach * 0.85), 1);
  for (let t = 1; t < 600; t++) {
    player.x += speed * dt;
    moveSystem(world, dt);
    if (gemSystem(world, player, dt) > 0) return t * dt;
  }
  return NaN;
}
const around = (speed) => {
  const ts = Array.from({ length: 24 }, (_, k) => collect(speed, (k / 24) * Math.PI * 2));
  return `mean ${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(3)} s, worst ${Math.max(...ts).toFixed(3)} s`;
};
for (const sp of [0, 150, 220, 500]) console.log(`player ${sp} px/s, gems all around: ${around(sp)}`);
