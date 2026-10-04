export interface Vec2 {
  x: number;
  y: number;
}

export function keysToVector(keys: ReadonlySet<string>): Vec2 {
  let x = 0;
  let y = 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  const m = Math.hypot(x, y);
  return m > 1 ? { x: x / m, y: y / m } : { x, y };
}

const STICK_RADIUS = 60;

interface Stick {
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export function createInput(target: Window = window): Vec2 {
  const input = { x: 0, y: 0 };
  const keys = new Set<string>();
  let stick: Stick | null = null;

  const sync = () => {
    if (stick) {
      const dx = stick.x - stick.ox;
      const dy = stick.y - stick.oy;
      const m = Math.hypot(dx, dy);
      const k = Math.min(m / STICK_RADIUS, 1);
      input.x = m ? (dx / m) * k : 0;
      input.y = m ? (dy / m) * k : 0;
    } else {
      const v = keysToVector(keys);
      input.x = v.x;
      input.y = v.y;
    }
  };

  target.addEventListener('keydown', (e) => { keys.add(e.code); sync(); });
  target.addEventListener('keyup', (e) => { keys.delete(e.code); sync(); });
  target.addEventListener('blur', () => { keys.clear(); sync(); });

  target.addEventListener('touchstart', (e) => {
    if (stick) return;
    const t = e.changedTouches[0];
    stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
    sync();
  }, { passive: true });
  target.addEventListener('touchmove', (e) => {
    if (!stick) return;
    for (const t of e.changedTouches) {
      if (t.identifier === stick.id) { stick.x = t.clientX; stick.y = t.clientY; }
    }
    sync();
  }, { passive: true });
  const end = (e: TouchEvent) => {
    const active = stick; // const alias: narrowing of the `let` is lost inside the callback
    if (active && Array.from(e.changedTouches).some((t) => t.identifier === active.id)) {
      stick = null;
      sync();
    }
  };
  target.addEventListener('touchend', end, { passive: true });
  target.addEventListener('touchcancel', end, { passive: true });

  return input;
}
