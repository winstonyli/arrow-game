import { KIND } from '../core/world.js';
import { ENEMY_TYPES } from '../game/enemies.js';
import { drawWorldGrid } from './grid-lines.js';
import { POOL, RING } from './fx.js';
import { bladePos, BLADE_RADIUS } from '../game/orbit.js';
import { TRAIL_N, TRAIL_ALPHA } from './trail.js';
import { drawGhost } from './ghost-marker.js';

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

  const tv = { mx: 0, my: 0, ex: 0, ey: 0 };
  const sp = { x: 0, y: 0 };

  // Tapered tails (see trail.js): a quad from each mover's flanks through the tail's bend to its tip, one fill per group.
  function tails(world, kind, type, color, fx) {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] !== kind || (type >= 0 && world.type[i] !== type)) continue;
      fx.tail(world, i, tv);
      const le = Math.hypot(tv.ex, tv.ey);
      if (le < 0.5) continue;
      const lm = Math.hypot(tv.mx, tv.my);
      const sx = lm > 0.5 ? tv.mx : tv.ex; // direction of the first segment
      const sy = lm > 0.5 ? tv.my : tv.ey;
      const sl = lm > 0.5 ? lm : le;
      const r = world.radius[i] * 0.85;
      const x = world.x[i];
      const y = world.y[i];
      const n0x = (-sy / sl) * r;
      const n0y = (sx / sl) * r;
      const n1x = (-tv.ey / le) * r * 0.5; // the bend is half as wide, on the normal of the overall direction
      const n1y = (tv.ex / le) * r * 0.5;
      ctx.moveTo(x + n0x, y + n0y);
      ctx.lineTo(x + tv.mx + n1x, y + tv.my + n1y);
      ctx.lineTo(x + tv.ex, y + tv.ey);
      ctx.lineTo(x + tv.mx - n1x, y + tv.my - n1y);
      ctx.lineTo(x - n0x, y - n0y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Position-history dots of the player (track 0) and each blade, oldest first.
  function history(fx, player, color, bladeColor) {
    for (let t = 0; t <= player.stats.orbit; t++) {
      ctx.fillStyle = t === 0 ? color : bladeColor;
      const r0 = t === 0 ? player.radius : BLADE_RADIUS;
      for (let age = TRAIL_N - 1; age >= 1; age--) {
        if (!fx.sample(t, age, sp)) continue;
        const f = 1 - age / TRAIL_N;
        ctx.globalAlpha = TRAIL_ALPHA * f;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r0 * (0.4 + 0.6 * f), 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

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
  const bp = { x: 0, y: 0 };
  return function render(game, hud) {
    const { world, player, camera, bounds, fx } = game;
    cam.x = camera.x + (fx ? fx.sx : 0);
    cam.y = camera.y + (fx ? fx.sy : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, view.w, view.h);
    drawWorldGrid(ctx, cam, view, bounds);

    ctx.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
    // Same layer order as webgl.js: gems, enemies (then their flash), enemy projectiles, arrows, particles, blades, player.
    if (fx) tails(world, KIND.GEM, -1, GEM_COLOR, fx);
    circles(world, KIND.GEM, -1, GEM_COLOR);
    for (let t = 0; t < ENEMY_TYPES.length; t++) {
      if (fx) tails(world, KIND.ENEMY, t, ENEMY_TYPES[t].color, fx);
      circles(world, KIND.ENEMY, t, ENEMY_TYPES[t].color);
    }
    if (fx) flashed(world, fx);
    if (fx) tails(world, KIND.ENEMY_PROJECTILE, -1, '#ff7b72', fx);
    circles(world, KIND.ENEMY_PROJECTILE, -1, '#ff7b72');
    if (fx) tails(world, KIND.PROJECTILE, -1, '#58a6ff', fx);
    circles(world, KIND.PROJECTILE, -1, '#58a6ff');
    if (fx) {
      particles(fx);
      history(fx, player, '#3fb950', '#c9d1d9');
    }

    ctx.fillStyle = '#c9d1d9';
    for (let k = 0; k < player.stats.orbit; k++) {
      bladePos(player, game.time, k, bp);
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, BLADE_RADIUS, 0, TAU);
      ctx.fill();
    }
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
    drawGhost(ctx, game, 0, 0); // the context is still translated by the camera

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
    ctx.textAlign = 'center';
    hud.forEach((line, k) => ctx.fillText(line, view.w / 2, view.h - 8 - (hud.length - 1 - k) * 18));
    ctx.textAlign = 'left';
  };
}
