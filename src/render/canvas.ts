import { KIND } from '../core/world.ts';
import { ENEMY_TYPES } from '../game/enemies.ts';
import { drawWorldGrid } from './grid-lines.ts';
import { POOL, RING, PAL_WHITE, PAL_DUST } from './fx.ts';
import { bladePos, BLADE_RADIUS } from '../game/orbit.ts';
import { CHAIN_LIFE } from '../game/weapons/chain.ts';
import { BOOM_RADIUS } from '../game/weapons/boomerang.ts';
import { FLAME_LEVELS, FIRE_CAP, FIRE_ALPHA } from '../game/weapons/flame.ts';
import { MINE_CAP, MINE_RADIUS, mineAlpha } from '../game/weapons/mines.ts';
import { METEOR_CAP, meteorRadius, meteorAlpha } from '../game/weapons/meteor.ts';
import { FROST_TINT, IGNITE_TINT } from '../game/modifiers.ts';
import { drawGhost } from './ghost-marker.ts';
import type { World, Kind } from '../core/world.ts';
import type { Size } from '../core/math.ts';
import type { Game, Mode } from '../game/game.ts';
import type { Fx } from './fx.ts';

const TAU = Math.PI * 2;
const GEM_COLOR = '#f2cc60';

// The game as the renderers see it: fx (when present) is the render fx from createFx.
export type RenderGame = Game<Mode, Fx>;
// The render(game, hud) contract both renderers return: draws one frame, `hud` lines at the bottom.
export type Renderer = (game: RenderGame, hud: string[]) => void;

export function createCanvasRenderer(canvas: HTMLCanvasElement, view: Size): Renderer {
  canvas.width = view.w;
  canvas.height = view.h;
  // DOM boundary: a fresh canvas always yields a 2D context; a null (canvas already holding another context type)
  // still throws on the next line, as before.
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const vignette = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.35, view.w / 2, view.h / 2, Math.hypot(view.w, view.h) / 2);
  vignette.addColorStop(0, 'rgba(248,81,73,0)');
  vignette.addColorStop(1, 'rgba(248,81,73,0.85)');
  const cam = { x: 0, y: 0 }; // the camera plus the current shake offset

  const tv = { mx: 0, my: 0, ex: 0, ey: 0 };

  // Tapered tails (see trail.ts): a smooth quadratic curve from the mover's centre through the tail's bend to its
  // tip, widest at the mover and tapering to a point, appended to the current path from the tail in `tv`.
  function tailPath(x: number, y: number, radius: number): void {
    const le = Math.hypot(tv.ex, tv.ey);
    if (le < 0.5) return;
    const cx = 2 * tv.mx - tv.ex / 2; // control point of the curve through the bend
    const cy = 2 * tv.my - tv.ey / 2;
    const lc = Math.hypot(cx, cy);
    const sx = lc > 0.5 ? cx : tv.ex; // start tangent
    const sy = lc > 0.5 ? cy : tv.ey;
    const sl = lc > 0.5 ? lc : le;
    const r = radius * 0.85;
    const nx = (-sy / sl) * r;
    const ny = (sx / sl) * r;
    ctx.moveTo(x + nx, y + ny);
    ctx.quadraticCurveTo(x + cx + nx * 0.5, y + cy + ny * 0.5, x + tv.ex, y + tv.ey); // the edge offset is r at the start, 0 at the tip
    ctx.quadraticCurveTo(x + cx - nx * 0.5, y + cy - ny * 0.5, x - nx, y - ny);
    ctx.closePath();
  }

  // One fill per group.
  function tails(world: World, kind: Kind, type: number, color: string, fx: Fx): void {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    for (let i = 0; i < world.high; i++) {
      if (world.kind[i] !== kind || (type >= 0 && world.type[i] !== type)) continue;
      fx.tail(world, i, tv);
      tailPath(world.x[i], world.y[i], world.radius[i]);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // The tail of the player (track 0) or blade k (track 1 + k) at x, y.
  function trackTail(fx: Fx, t: number, x: number, y: number, r: number, color: string): void {
    fx.trackTail(t, x, y, r, tv);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    tailPath(x, y, r);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // type < 0 matches any type. One path and one fill per colour group.
  function circles(world: World, kind: Kind, type: number, color: string): void {
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

  // Enemies under a status, drawn over their type colour: cyan when slowed, then red-orange when burning (burning wins).
  function tinted(world: World): void {
    for (let s = 0; s < 2; s++) {
      const timer = s ? world.burnT : world.slowT;
      ctx.fillStyle = s ? IGNITE_TINT : FROST_TINT;
      ctx.beginPath();
      for (let i = 0; i < world.high; i++) {
        if (world.kind[i] !== KIND.ENEMY || timer[i] <= 0) continue;
        const r = world.radius[i];
        ctx.moveTo(world.x[i] + r, world.y[i]);
        ctx.arc(world.x[i], world.y[i], r, 0, TAU);
      }
      ctx.fill();
    }
  }

  // Enemies in their hit-flash window, drawn white over their type colour.
  function flashed(world: World, fx: Fx): void {
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

  function particles(fx: Fx): void {
    const p = fx.p;
    for (let k = 0; k < POOL; k++) {
      if (p.life[k] <= 0) continue;
      const color = p.pal[k] >= 0 ? ENEMY_TYPES[p.pal[k]].color : p.pal[k] === PAL_WHITE ? '#ffffff' : p.pal[k] === PAL_DUST ? '#c9d1d9' : GEM_COLOR;
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
  return function render(game: RenderGame, hud: string[]): void {
    const { world, player, camera, bounds, fx } = game;
    cam.x = camera.x + (fx ? fx.sx : 0);
    cam.y = camera.y + (fx ? fx.sy : 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#161b22';
    ctx.fillRect(0, 0, view.w, view.h);
    drawWorldGrid(ctx, cam, view, bounds);

    ctx.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
    // Same layer order as webgl.ts: gems, fire patches, mines, enemies (then their status tint, then their flash), enemy projectiles, arrows, particles, orbit blades, weapon effects (shockwave ring, lightning, boomerangs, meteor strike rings), player.
    if (fx) tails(world, KIND.GEM, -1, GEM_COLOR, fx);
    circles(world, KIND.GEM, -1, GEM_COLOR);
    // Fire patches sit above the gems but below enemies and shots (opaque ones hid them), at a capped alpha.
    const fr = game.wstate.fire;
    const fl = FLAME_LEVELS[(player.stats.weapons.flame || 1) - 1];
    ctx.fillStyle = IGNITE_TINT;
    for (let k = 0; k < FIRE_CAP; k++) {
      if (fr.life[k] <= 0) continue;
      ctx.globalAlpha = FIRE_ALPHA * Math.min(1, fr.life[k] / fl.life);
      ctx.beginPath();
      ctx.arc(fr.x[k], fr.y[k], fl.radius, 0, TAU);
      ctx.fill();
    }
    // Mines share the fire patches' layer; their alpha shows armed state and fade.
    const mn = game.wstate.mines;
    ctx.fillStyle = '#ffa657'; // the colour the boomerangs use
    for (let k = 0; k < MINE_CAP; k++) {
      if (!mn.on[k]) continue;
      ctx.globalAlpha = mineAlpha(mn.age[k]);
      ctx.beginPath();
      ctx.arc(mn.x[k], mn.y[k], MINE_RADIUS, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let t = 0; t < ENEMY_TYPES.length; t++) {
      if (fx) tails(world, KIND.ENEMY, t, ENEMY_TYPES[t].color, fx);
      circles(world, KIND.ENEMY, t, ENEMY_TYPES[t].color);
    }
    if (game.player.stats.frost > 0 || game.player.stats.ignite > 0) tinted(world);
    if (fx) flashed(world, fx);
    if (fx) tails(world, KIND.ENEMY_PROJECTILE, -1, '#ff7b72', fx);
    circles(world, KIND.ENEMY_PROJECTILE, -1, '#ff7b72');
    if (fx) tails(world, KIND.PROJECTILE, -1, '#58a6ff', fx);
    circles(world, KIND.PROJECTILE, -1, '#58a6ff');
    if (fx) particles(fx);

    for (let k = 0; k < player.stats.orbit; k++) {
      bladePos(player, game.time, k, bp);
      if (fx) trackTail(fx, 1 + k, bp.x, bp.y, BLADE_RADIUS, '#c9d1d9');
      ctx.fillStyle = '#c9d1d9';
      ctx.beginPath();
      ctx.arc(bp.x, bp.y, BLADE_RADIUS, 0, TAU);
      ctx.fill();
    }
    const ws = game.wstate;
    if (ws.shock.on) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.2 + 0.8 * (1 - ws.shock.r / ws.shock.max);
      ctx.beginPath();
      ctx.arc(ws.shock.x, ws.shock.y, ws.shock.r, 0, TAU);
      ctx.stroke();
    }
    if (ws.chain.life > 0) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.globalAlpha = Math.min(1, ws.chain.life / CHAIN_LIFE);
      ctx.beginPath();
      ctx.moveTo(ws.chain.px[0], ws.chain.py[0]);
      for (let p = 1; p < ws.chain.n; p++) ctx.lineTo(ws.chain.px[p], ws.chain.py[p]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffa657';
    for (const b of ws.boom.b) {
      if (b.phase === 0) continue;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BOOM_RADIUS, 0, TAU);
      ctx.fill();
    }
    // Pending meteor strikes: a ring at the blast radius, brighter as impact nears.
    const mt = ws.meteors;
    const mr = meteorRadius(player.stats.weapons.meteor ?? 1);
    ctx.strokeStyle = '#ffa657'; // the colour the boomerangs use
    ctx.lineWidth = 3;
    for (let k = 0; k < METEOR_CAP; k++) {
      if (!mt.on[k]) continue;
      ctx.globalAlpha = meteorAlpha(mt.age[k]);
      ctx.beginPath();
      ctx.arc(mt.x[k], mt.y[k], mr, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (fx) trackTail(fx, 0, player.x, player.y, player.radius, '#3fb950');
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
