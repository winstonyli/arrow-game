// Faint 100 px grid and a red world border so camera motion is visible. Screen space: call with an
// identity transform. Does nothing when the whole world fits in the view (rooms mode).
export function drawWorldGrid(ctx, camera, view, bounds, step = 100) {
  if (bounds.w <= view.w && bounds.h <= view.h) return;
  ctx.save();
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
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(248, 81, 73, 0.6)';
  ctx.strokeRect(-camera.x, -camera.y, bounds.w, bounds.h);
  ctx.restore();
}
