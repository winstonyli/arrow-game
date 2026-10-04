import { BLADE } from './weapons/blade.ts';
import type { PlayerStats } from './player.ts';

// Weapon slots a run can hold, the bow (always held, never leveled: the stat passives level it) included.
export const MAX_WEAPONS = 5;

// A levelled weapon. skills.ts turns each into an arena-only skill: the first pick takes it (level 1), later picks
// level it, and it drops out of the offer at maxLevel or when every slot is taken. `onLevel` runs after the level
// rises, for weapons that cache a stat (blades write stats.orbit); weapons with an update read their level each tick.
export interface WeaponDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  onLevel?: (s: PlayerStats, level: number) => void;
}

export const WEAPONS: WeaponDef[] = [BLADE];
