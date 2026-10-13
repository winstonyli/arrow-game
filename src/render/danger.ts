import { CONTACT_CAP } from '../modes/arena.ts';

// How an enemy's touch is drawn: 0 = harmless, else 1..3 concentric rings around it, brighter and thicker with its current
// contact damage against the cap (a third of the cap per step: 20 or less is 1, up to 40 is 2, above that 3). Shared by both renderers.
export const DANGER_LEVELS = 3;
export const DANGER_ALPHA = [0, 0.35, 0.6, 0.9]; // indexed by level
export const DANGER_COLOR = '#ffb38a'; // warm, since the chasers are already red
export const DANGER_GAP = 1.6; // px between the rings
// A touch that would kill (damage at least the player's current hp, ignoring the post-hit invulnerability) swaps its rings for
// white ones that pulse with the game clock. Enemy shots are not marked.
export const FATAL_COLOR = '#ffffff'; // red vanished against the red chasers
export const FATAL_HZ = 4;
export const isFatal = (damage: number, hp: number): boolean => damage > 0 && damage >= hp;
export const fatalAlpha = (time: number): number => 0.7 + 0.3 * Math.sin(2 * Math.PI * FATAL_HZ * time); // 0.4 to 1
export const dangerLevel = (damage: number): number => (damage <= 0 ? 0 : Math.min(DANGER_LEVELS, Math.max(1, Math.ceil((DANGER_LEVELS * damage) / CONTACT_CAP))));
