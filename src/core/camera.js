import { clamp } from './math.js';

// Centres the camera (view's top-left, in world coordinates) on `target`, clamped to the world.
export function followCamera(camera, target, bounds, view) {
  camera.x = clamp(target.x - view.w / 2, 0, Math.max(0, bounds.w - view.w));
  camera.y = clamp(target.y - view.h / 2, 0, Math.max(0, bounds.h - view.h));
}
