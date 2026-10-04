// Inline SVG glyphs (24x24, stroked in currentColor). Plain geometry; swap for a real icon set later.
// Keyed by plain string: skill ids are `string` in src/game (there is no SkillId union), plus the HUD glyphs
// heart/skull/pause. `icon` checks the id at run time and throws on an unknown one.
const PATHS: Record<string, string> = {
  multishot: '<path d="M12 20V6M12 20L5 8M12 20L19 8"/>',
  rapid: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  power: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  pierce: '<path d="M3 12h18M15 6l6 6-6 6"/>',
  ricochet: '<path d="M4 6l8 12 8-12"/>',
  swift: '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>',
  regen: '<path d="M12 5v14M5 12h14"/>',
  magnet: '<path d="M6 4v8a6 6 0 0012 0V4M6 8h3M15 8h3"/>',
  homing: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  blade: '<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 019 9"/>',
  shockwave: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/>',
  chain: '<path d="M13 2L5 13h6l-2 9 10-13h-6z"/>',
  boomerang: '<path d="M5 5c9 0 14 5 14 14C10 19 5 14 5 5z"/>',
  crit: '<path d="M12 3l2.6 6.4L21 10l-5 4.2L17.5 21 12 17.5 6.5 21 8 14.2 3 10l6.4-.6z"/>',
  knockback: '<path d="M4 12h12M11 7l5 5-5 5M19 6v12"/>',
  vamp: '<path d="M12 4s-6 7-6 11a6 6 0 0012 0c0-4-6-11-6-11z"/>',
  explode: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  ignite: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  frost: '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9 4.5l3 2.5 3-2.5M9 19.5l3-2.5 3 2.5"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 017-2.5A4 4 0 0119 10c0 5.5-7 10-7 10z"/>',
  skull: '<path d="M5 12a7 7 0 1114 0v4H5z"/><path d="M9 20v-4M15 20v-4"/><circle cx="9.5" cy="12" r="1"/><circle cx="14.5" cy="12" r="1"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};

export function icon(id: string): string {
  const p = PATHS[id];
  if (!p) throw new Error(`unknown icon: ${id}`);
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}
