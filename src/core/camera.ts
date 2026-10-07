import { clamp } from './math.ts';
import type { Vec, Size } from './math.ts';

// Centres the camera (view's top-left, in world coordinates) on `target`, clamped to the world.
export function followCamera(camera: Vec, target: Vec, bounds: Size, view: Size): void {
  camera.x = clamp(target.x - view.w / 2, 0, Math.max(0, bounds.w - view.w));
  camera.y = clamp(target.y - view.h / 2, 0, Math.max(0, bounds.h - view.h));
}

const SNAP = 200; // px: a jump this far (new run, room change) is not eased

// Eases `draw` toward `target` for rendering only (exponential, `rate` per second); the sim camera stays exact. Frame-rate independent.
export function easeCamera(draw: Vec, target: Vec, dt: number, rate = 12): void {
  const dx = target.x - draw.x;
  const dy = target.y - draw.y;
  if (Math.hypot(dx, dy) > SNAP) {
    draw.x = target.x;
    draw.y = target.y;
    return;
  }
  const k = 1 - Math.exp(-rate * dt);
  draw.x += dx * k;
  draw.y += dy * k;
}
