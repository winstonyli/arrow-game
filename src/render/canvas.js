import { KIND } from '../core/world.js';
import { ENEMY_TYPES } from '../game/enemies.js';
import { drawWorldGrid } from './grid-lines.js';
import { POOL, RING } from './fx.js';

const TAU = Math.PI * 2;
const GEM_COLOR = '#f2cc60';

export function createCanvasRenderer(canvas, view) {
  canvas.width = view.w;
  canvas.height = view.h;
  const ctx = canvas.getContext('2d');
  const vignette = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.35, view.w / 2, view.h / 2, Math.hypot(view.w, view.h) / 2);
  vignette.addColorStop(0, 'rgba(248,81,73,0)');
  vignette.addColorStop(1, 'rgba(248,81,73,0.85)');
  const cam = { x: 0, y: 0 }; // the camera plus the current shake offset

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

  // Enemies in their hit-flash window, drawn white over their type colour.
  function flashed(world, fx) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] !== KIND.ENEMY || !fx.flashing(i)) continue;
      const r = world.radius[i];
      ctx.moveTo(world.x[i] + r, world.y[i]);
      ctx.arc(world.x[i], world.y[i], r, 0, TAU);
    }
    ctx.fill();
  }

  function particles(fx) {
    const p = fx.p;
    for (let k = 0; k < POOL; k++) {
      if (p.life[k] <= 0) continue;
      const color = p.pal[k] < 0 ? GEM_COLOR : ENEMY_TYPES[p.pal[k]].color;
      ctx.globalAlpha = Math.min(1, p.life[k] / p.max[k]);
      ctx.beginPath();
      ctx.arc(p.x[k], p.y[k], Math.max(0.5, p.r[k]), 0, TAU);
      if (p.shape[k] === RING) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // The fallback renderer does not cull and draws no outline or shadow; the WebGL renderer is the one
  // built for large counts and depth.
  return function render(game, hud) {
    const { world, player, camera, bounds, fx } = game;
    cam.x = camera.x + (fx ? fx.sx : 0);
    cam.y = camera.y + (fx ? fx.sy : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, view.w, view.h);
    drawWorldGrid(ctx, cam, view, bounds);

    ctx.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
    for (let t = 0; t < ENEMY_TYPES.length; t++) circles(world, KIND.ENEMY, t, ENEMY_TYPES[t].color);
    if (fx) flashed(world, fx);
    circles(world, KIND.GEM, -1, GEM_COLOR);
    circles(world, KIND.ENEMY_PROJECTILE, -1, '#ff7b72');
    circles(world, KIND.PROJECTILE, -1, '#58a6ff');
    if (fx) particles(fx);

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

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const v = fx ? fx.vignette(player) : 0;
    if (v > 0.01) {
      ctx.globalAlpha = Math.min(1, v);
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, view.w, view.h);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#c9d1d9';
    ctx.font = '14px monospace';
    hud.forEach((line, k) => ctx.fillText(line, 10, 20 + k * 18));
  };
}
