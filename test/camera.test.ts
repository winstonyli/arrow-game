import test from 'node:test';
import assert from 'node:assert/strict';
import { followCamera, easeCamera } from '../src/core/camera.ts';

const view = { w: 900, h: 600 };
const world = { w: 3000, h: 2000 };

test('the camera centres on the target', () => {
  const c = { x: 0, y: 0 };
  followCamera(c, { x: 1500, y: 1000 }, world, view);
  assert.deepEqual(c, { x: 1050, y: 700 });
});

test('the camera clamps at every world edge', () => {
  const c = { x: 0, y: 0 };
  followCamera(c, { x: 10, y: 10 }, world, view);
  assert.deepEqual(c, { x: 0, y: 0 });
  followCamera(c, { x: 2990, y: 1990 }, world, view);
  assert.deepEqual(c, { x: 2100, y: 1400 });
});

test('the camera is pinned at the origin when the world equals the view', () => {
  const c = { x: 5, y: 5 };
  followCamera(c, { x: 450, y: 520 }, view, view);
  assert.deepEqual(c, { x: 0, y: 0 });
});

test('easeCamera closes the gap smoothly, the same at 30 and 120 fps, and snaps on a long jump', () => {
  const at = (hz: number) => {
    const d = { x: 0, y: 0 };
    for (let i = 0; i < hz / 10; i++) easeCamera(d, { x: 100, y: 0 }, 1 / hz); // 0.1 s
    return d.x;
  };
  assert.ok(at(60) > 50 && at(60) < 100);
  assert.ok(Math.abs(at(30) - at(120)) < 0.01);
  const d = { x: 0, y: 0 };
  easeCamera(d, { x: 1000, y: 0 }, 1 / 60);
  assert.equal(d.x, 1000);
});
