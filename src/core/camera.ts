import { clamp } from './math.ts';

// Centres the camera (view's top-left, in world coordinates) on `target`, clamped to the world.
export function followCamera(
  camera: { x: number; y: number },
  target: { x: number; y: number },
  bounds: { w: number; h: number },
  view: { w: number; h: number },
): void {
  camera.x = clamp(target.x - view.w / 2, 0, Math.max(0, bounds.w - view.w));
  camera.y = clamp(target.y - view.h / 2, 0, Math.max(0, bounds.h - view.h));
}
