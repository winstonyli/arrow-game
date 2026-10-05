import { BLADE } from './weapons/blade.ts';
import { SHOCKWAVE, createShockState } from './weapons/shockwave.ts';
import type { ShockState } from './weapons/shockwave.ts';
import { CHAIN, createChainState } from './weapons/chain.ts';
import type { ChainState } from './weapons/chain.ts';
import { BOOMERANG, createBoomState } from './weapons/boomerang.ts';
import type { BoomState } from './weapons/boomerang.ts';
import { FLAME, createFireState } from './weapons/flame.ts';
import type { FireState } from './weapons/flame.ts';
import { MINES, createMineState } from './weapons/mines.ts';
import type { MineState } from './weapons/mines.ts';
import { METEOR, createMeteorState } from './weapons/meteor.ts';
import type { MeteorState } from './weapons/meteor.ts';
import { BEAM, createBeamState } from './weapons/beam.ts';
import type { BeamState } from './weapons/beam.ts';
import { DRONE, createDroneState } from './weapons/drone.ts';
import type { DroneState } from './weapons/drone.ts';
import { DAGGERS, createDaggerState } from './weapons/daggers.ts';
import type { DaggerState } from './weapons/daggers.ts';
import type { Game } from './game.ts';
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
  update?: (game: Game, level: number, dt: number) => number; // runs each tick while owned; returns kills
}

export const WEAPONS: WeaponDef[] = [BLADE, SHOCKWAVE, CHAIN, BOOMERANG, FLAME, MINES, METEOR, BEAM, DRONE, DAGGERS];

// Per-run weapon state, on game.wstate: advanced by weaponSystem, hashed by stateHash, read by the renderers.
export interface WeaponState { shock: ShockState; chain: ChainState; boom: BoomState; fire: FireState; mines: MineState; meteors: MeteorState; beam: BeamState; drones: DroneState; daggers: DaggerState }
export const createWeaponState = (): WeaponState => ({ shock: createShockState(), chain: createChainState(), boom: createBoomState(), fire: createFireState(), mines: createMineState(), meteors: createMeteorState(), beam: createBeamState(), drones: createDroneState(), daggers: createDaggerState() });

// Runs every owned weapon that has an update. Orbit blades have none (orbitSystem runs them). Returns kills.
export function weaponSystem(game: Game, dt: number): number {
  let kills = 0;
  for (const w of WEAPONS) {
    const level = game.player.stats.weapons[w.id];
    if (level && w.update) kills += w.update(game, level, dt);
  }
  return kills;
}
