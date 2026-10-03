import { KIND } from '../core/world.js';
import { ENEMY_TYPES } from '../game/enemies.js';

const TAU = Math.PI * 2;

export function createCanvasRenderer(canvas, bounds) {
  canvas.width = bounds.w;
  canvas.height = bounds.h;
  const ctx = canvas.getContext('2d');

  // type < 0 matches any type. One path and one fill per colour group.
  function circles(world, kind, type, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] !== kind || (type >= 0 && world.type[i] !== type)) continue;
      const r = world.radius[i];
      ctx.moveTo(world.x[i] + r, world.y[i]);
      ctx.arc(world.x[i], world.y[i], r, 0, TAU);
    }
    ctx.fill();
  }

  return function render(game, hud) {
    const { world, player } = game;
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, bounds.w, bounds.h);
    for (let t = 0; t < ENEMY_TYPES.length; t++) circles(world, KIND.ENEMY, t, ENEMY_TYPES[t].color);
    circles(world, KIND.ENEMY_PROJECTILE, -1, '#ff7b72');
    circles(world, KIND.PROJECTILE, -1, '#58a6ff');

    ctx.globalAlpha = player.invuln > 0 && Math.floor(game.time * 20) % 2 ? 0.4 : 1;
    ctx.fillStyle = '#3fb950';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.radius, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;

    const bw = 40;
    const bx = player.x - bw / 2;
    const by = player.y - player.radius - 10;
    ctx.fillStyle = '#30363d';
    ctx.fillRect(bx, by, bw, 4);
    ctx.fillStyle = '#3fb950';
    ctx.fillRect(bx, by, (bw * Math.max(0, player.hp)) / player.maxHp, 4);

    ctx.fillStyle = '#c9d1d9';
    ctx.font = '14px monospace';
    hud.forEach((line, k) => ctx.fillText(line, 10, 20 + k * 18));
  };
}
