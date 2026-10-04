import type { World } from '../../core/world.ts';

export type OnKill = ((enemyIndex: number) => void) | null | undefined;

// Damages enemy `j`. A lethal hit calls onKill(j) (before the despawn, as the other systems do) and removes the
// enemy. Returns 1 for a kill, else 0.
export function damageEnemy(world: World, j: number, dmg: number, onKill: OnKill): number {
  world.hp[j] -= dmg;
  if (world.hp[j] > 0) return 0;
  if (onKill) onKill(j);
  world.despawn(j);
  return 1;
}
