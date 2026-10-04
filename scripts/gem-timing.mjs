// Seconds for a gem at the edge of the pickup radius to be collected, for a still and a moving player.
import { World } from '../src/core/world.js';
import { createPlayer } from '../src/game/player.js';
import { spawnGem, gemSystem } from '../src/game/gems.js';

const dt = 1 / 60;
function collect(speed) {
  const world = new World(8);
  const player = createPlayer(450, 500);
  const reach = player.stats.pickupRadius;
  const g = spawnGem(world, 450 + reach - 1, 500, 1);
  for (let t = 1; t < 600; t++) {
    player.x += speed * dt;
    if (gemSystem(world, player, dt) > 0) return t * dt;
  }
  return NaN;
}
for (const sp of [0, 150, player_speed()]) console.log(`player ${sp} px/s: collected in ${collect(sp).toFixed(3)} s`);
function player_speed() { return createPlayer(0, 0).stats.moveSpeed; }
