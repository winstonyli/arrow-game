import { KIND } from '../core/world.ts';
import type { World } from '../core/world.ts';
import type { Vec, Size } from '../core/math.ts';

export const ENEMY = { CHASER: 0, SHOOTER: 1, BOSS: 2, DUMMY: 3, SWARMER: 4, BRUISER: 5, SPLITTER: 6 };

export interface EnemyType {
  name: string;
  xp: number;
  radius: number;
  hp: number;
  speed: number;
  contact: number;
  keepDist: number;
  fireInterval: number;
  fireRange: number;
  projSpeed: number;
  projDamage: number;
  projCount: number;
  ring: boolean;
  color: string;
}

export const ENEMY_TYPES: EnemyType[] = [
  { name: 'chaser', xp: 1, radius: 10, hp: 20, speed: 90, contact: 10, keepDist: 0, fireInterval: 0, fireRange: 0, projSpeed: 0, projDamage: 0, projCount: 0, ring: false, color: '#e5534b' },
  { name: 'shooter', xp: 2, radius: 11, hp: 30, speed: 70, contact: 5, keepDist: 240, fireInterval: 2, fireRange: 420, projSpeed: 220, projDamage: 8, projCount: 1, ring: false, color: '#d29922' },
  { name: 'boss', xp: 20, radius: 36, hp: 600, speed: 45, contact: 20, keepDist: 160, fireInterval: 1.6, fireRange: 600, projSpeed: 200, projDamage: 10, projCount: 12, ring: true, color: '#a371f7' },
  // Static, unkillable target used only by the stress mode: keepDist is huge, so the AI never moves it.
  { name: 'dummy', xp: 0, radius: 10, hp: 1e9, speed: 0, contact: 0, keepDist: 1e9, fireInterval: 0, fireRange: 0, projSpeed: 0, projDamage: 0, projCount: 0, ring: false, color: '#8b949e' },
  { name: 'swarmer', xp: 1, radius: 7, hp: 8, speed: 160, contact: 5, keepDist: 0, fireInterval: 0, fireRange: 0, projSpeed: 0, projDamage: 0, projCount: 0, ring: false, color: '#f0883e' },
  { name: 'bruiser', xp: 5, radius: 18, hp: 120, speed: 50, contact: 18, keepDist: 0, fireInterval: 0, fireRange: 0, projSpeed: 0, projDamage: 0, projCount: 0, ring: false, color: '#79c0ff' },
  { name: 'splitter', xp: 3, radius: 13, hp: 40, speed: 75, contact: 8, keepDist: 0, fireInterval: 0, fireRange: 0, projSpeed: 0, projDamage: 0, projCount: 0, ring: false, color: '#db61a2' },
];

export function spawnEnemy(world: World, type: number, x: number, y: number): number {
  const t = ENEMY_TYPES[type];
  const i = world.spawn(KIND.ENEMY, x, y, 0, 0, t.radius, t.hp);
  if (i < 0) return -1;
  world.type[i] = type;
  world.damage[i] = t.contact;
  world.cd[i] = t.fireInterval;
  return i;
}

function enemyFire(world: World, i: number, t: EnemyType, aim: number): void {
  for (let k = 0; k < t.projCount; k++) {
    const a = t.ring ? aim + (k / t.projCount) * Math.PI * 2 : aim;
    const p = world.spawn(
      KIND.ENEMY_PROJECTILE,
      world.x[i],
      world.y[i],
      Math.cos(a) * t.projSpeed,
      Math.sin(a) * t.projSpeed,
      5,
      0,
    );
    if (p < 0) continue;
    world.damage[p] = t.projDamage;
    world.life[p] = 4;
  }
}

// `camera` (optional, with `view`): when given, enemies only fire while inside the view.
export function enemyAISystem(world: World, player: Vec, dt: number): void;
export function enemyAISystem(world: World, player: Vec, dt: number, camera: Vec | null, view: Size): void;
export function enemyAISystem(world: World, player: Vec, dt: number, camera: Vec | null = null, view: Size | null = null): void {
  for (let i = 0; i < world.high; i++) {
    if (world.kind[i] !== KIND.ENEMY) continue;
    const t = ENEMY_TYPES[world.type[i]];
    const dx = player.x - world.x[i];
    const dy = player.y - world.y[i];
    const d = Math.hypot(dx, dy) || 1;
    if (d > t.keepDist) {
      world.vx[i] = (dx / d) * t.speed;
      world.vy[i] = (dy / d) * t.speed;
    } else {
      world.vx[i] = 0;
      world.vy[i] = 0;
    }
    if (t.fireInterval > 0) {
      world.cd[i] -= dt;
      const seen = !camera || (world.x[i] >= camera.x && world.x[i] <= camera.x + view!.w && world.y[i] >= camera.y && world.y[i] <= camera.y + view!.h); // the overloads pair a camera with a view
      if (world.cd[i] <= 0 && d <= t.fireRange && seen) {
        world.cd[i] = t.fireInterval;
        enemyFire(world, i, t, Math.atan2(dy, dx));
      }
    }
  }
}
