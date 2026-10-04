import type { Game } from '../game/game.ts';

const TAU = Math.PI * 2;
const COLOR = '#37f0c8';

// The ghost of your best run: a translucent ring where that run's player was. `(ox, oy)` is the camera offset
// to subtract (0, 0 when the context is already translated). Called by both renderers; reads game.ghost only.
export function drawGhost(ctx: CanvasRenderingContext2D, game: Pick<Game, 'ghost' | 'player'>, ox: number, oy: number): void {
  const g = game.ghost;
  if (!g) return;
  const a = g.alive ? 0.75 : 0.75 * Math.max(0, 1 - g.fade);
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  ctx.strokeStyle = COLOR;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(g.x - ox, g.y - oy, game.player.radius, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = a * 0.2;
  ctx.fillStyle = COLOR;
  ctx.fill();
  ctx.globalAlpha = 1;
}
