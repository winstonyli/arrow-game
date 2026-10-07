import type { Vec, Size } from '../core/math.ts';

const GLOW = 70; // px: depth of the glow inside each edge
const NEAR = 260; // px: the player this close to an edge brightens it

// The arena floor: a faint 100 px grid inside the world, the void beyond the edge darkened, and a neon edge with an
// inner glow that brightens as the player approaches it. Screen space: call with an identity transform. Does
// nothing when the whole world fits in the view (rooms mode). `player` (world coordinates) drives the proximity glow.
export function drawWorldGrid(ctx: CanvasRenderingContext2D, camera: Vec, view: Size, bounds: Size, player?: Vec, step = 100): void {
  if (bounds.w <= view.w && bounds.h <= view.h) return;
  const x0 = -camera.x;
  const y0 = -camera.y;
  const x1 = bounds.w - camera.x;
  const y1 = bounds.h - camera.y;
  ctx.save();

  // The void: everything in the view outside the world rectangle.
  ctx.fillStyle = 'rgba(4, 6, 10, 0.6)';
  ctx.beginPath();
  ctx.rect(0, 0, view.w, view.h);
  ctx.rect(x0, y0, bounds.w, bounds.h);
  ctx.fill('evenodd');

  // Everything else is inside the world: clip to it.
  ctx.beginPath();
  ctx.rect(x0, y0, bounds.w, bounds.h);
  ctx.clip();

  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(201, 209, 217, 0.07)';
  ctx.beginPath();
  for (let x = Math.ceil(camera.x / step) * step; x <= camera.x + view.w; x += step) {
    ctx.moveTo(x - camera.x + 0.5, 0);
    ctx.lineTo(x - camera.x + 0.5, view.h);
  }
  for (let y = Math.ceil(camera.y / step) * step; y <= camera.y + view.h; y += step) {
    ctx.moveTo(0, y - camera.y + 0.5);
    ctx.lineTo(view.w, y - camera.y + 0.5);
  }
  ctx.stroke();

  // Per-edge glow: how close the player is (0 far, 1 touching) sets the strength.
  const near = (d: number) => Math.max(0, Math.min(1, 1 - d / NEAR));
  const px = player ? player.x : Infinity;
  const py = player ? player.y : Infinity;
  // Each edge: gradient start and end (from the edge inward), then the player's distance to it.
  const edges: [number, number, number, number, number][] = [
    [x0, 0, x0 + GLOW, 0, px],
    [x1, 0, x1 - GLOW, 0, bounds.w - px],
    [0, y0, 0, y0 + GLOW, py],
    [0, y1, 0, y1 - GLOW, bounds.h - py],
  ];
  let hot = 0;
  for (const [ax, ay, bx, by, d] of edges) {
    const n = near(d);
    if ((ax < -GLOW && bx < -GLOW) || (ax > view.w + GLOW && bx > view.w + GLOW)) continue;
    if ((ay < -GLOW && by < -GLOW) || (ay > view.h + GLOW && by > view.h + GLOW)) continue;
    hot = Math.max(hot, n);
    const g = ctx.createLinearGradient(ax, ay, bx, by);
    g.addColorStop(0, `rgba(248, 81, 73, ${(0.16 + 0.4 * n).toFixed(3)})`);
    g.addColorStop(1, 'rgba(248, 81, 73, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h); // the clip keeps it inside the world; the gradient is transparent past GLOW
  }
  ctx.restore();

  // The edge line itself, on top (not clipped, so its outer half shows over the void).
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(255, 110, 100, ${(0.55 + 0.4 * hot).toFixed(3)})`;
  ctx.strokeRect(x0, y0, bounds.w, bounds.h);
  ctx.restore();
}
