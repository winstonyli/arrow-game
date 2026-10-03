# arrow-game

Browser archer roguelite (Archero / arrow.io style). Plain JS, typed-array simulation.

- Run: `npm start` then open http://localhost:8000
- Test: `npm test`
- Design: `docs/superpowers/specs/2026-10-02-arrow-game-design.md`
- Plan: `docs/superpowers/plans/2026-10-02-arrow-game-core-and-rooms.md`

## Status
Plan 1 (core + rooms mode) implemented; playable at `npm start`. Gameplay feel not yet tuned.
Plan 2 benchmarks done (see below); WebGL renderer implemented (default; `?renderer=canvas2d` for the fallback). Plan 3 (arena mode + camera) implemented; play it at `/?mode=arena` (rooms stays the default at `/`).

## UI
`/` opens a title screen (Arena or Rooms); `/?mode=arena` and `/?mode=rooms` skip it, as does `?stress=N` (those never auto-pause, so benchmarks run unfocused). Esc or P pauses (also on tab blur when started from the title); M mutes; 1-3 or a click picks a skill. Personal bests are kept in `localStorage` (`arrow-best-arena`, `arrow-best-rooms`). `?debug` shows the entity and frame-time line at the bottom.

The screens and HUD are DOM overlays (`src/ui/`): `model.js` holds the pure view-models, `ui.js` the DOM controller, `ui.css` the Synthwave theme (tokens as custom properties). Fonts are self-hosted in `assets/fonts/` (Orbitron, Share Tech Mono; SIL OFL). The sim only exposes `game.skills` (owned-skill counts) and `game.bossAt` (last boss spawn time) for the UI. Spec: `docs/superpowers/specs/2026-10-03-ui-design.md`.

Parked: a volume slider and settings screen, a real icon set (the glyphs are simple inline SVG), key rebinding, gamepad, a tutorial, an attract-mode title background, Rooms difficulty select. Touch: a tap on the HUD pause button also starts the move stick (harmless, not fixed).

## Arena balance (kiting)
In arena the player auto-fires while moving at half rate (`stats.moveFireRate = 0.5`; rooms keeps stand-still-to-fire, `moveFireRate = 0`), shooters and bosses only fire while on screen (`game.enemyFireOnScreen`), the early spawn ramp is gentler (`BASE_RATE 0.6`, `RATE_PER_SEC 0.015`), and the gem magnet is at least 1.5x the player's speed. A stationary player used to die at about 0:30.

`node scripts/soak-arena.js --bot=kite --seed=N` runs a crude mortal kiting bot (flees nearby enemies, avoids walls, chases gems, always takes the first offered skill) and reports when it dies. Seeds 1-5 died at 69, 99, 131, 157 and 171 s, all at level 1-2. `--bot=smart` adds a skill priority (multishot, rapid, power before speed), keeps collecting gems while fleeing and sidesteps so it circles instead of pinning itself on a wall: seeds 1-5 died at 131, 252, 199, 220 and 217 s, level 2-4. Both are yardsticks for later tuning, not targets; a human should do better.

## Effects
Hit flash, kill pop, gem burst, screen shake and a damage vignette come from `src/render/fx.js` (presentation-only, `game.fx` optional, absent in stress mode, which still draws the WebGL outline and shadow). The WebGL renderer adds an outline and soft shadow in the circle shader. The Canvas2D fallback draws flash, pop, shake and vignette but no outline or shadow.

Layer order, bottom to top, is the same in both renderers: background and grid, gems, enemies, enemy projectiles, arrows, fx particles, orbit blades, player, then HP bar, damage vignette and HUD text. The WebGL renderer puts the background and grid on a `#bg` canvas below a transparent `#game` canvas, and the HP bar, vignette and HUD on `#hud` above it. Within a layer, WebGL draws in slot order and Canvas2D by enemy type.

## Content
Arena enemy mix (`MIX` in `src/modes/arena.js`, first match wins, the rest are chasers): shooters from 60 s (30%), swarmers from 30 s (15%, spawn as a pack of 4), bruisers from 90 s (8%), splitters from 150 s (8%, leave 2 swarmers). Skills (10 total, `src/game/skills.js`): Regeneration (+1 HP/s), Magnet (+50% pickup range), Homing (arrows steer toward the nearest enemy within 300 px at up to 4 rad/s; `world.type` = 1 flags the arrow) and Orbit Blade (up to 8 blades at 60 px, 30 damage/s each to every enemy they overlap; blades are not entities, `src/game/orbit.js` computes positions for both the sim and the renderers). All numbers are first guesses. Smart-bot soak (seeds 1-3) died at 211, 132 and 184 s, so difficulty is in the same range as before; the bot picks skills by priority, not cleverly.

Trails (`src/render/trail.js`, tunables there): enemies, arrows, enemy shots and gems get a tapered tail along their velocity (`TRAIL_TIME` 0.15 s of motion, capped at `TRAIL_MAX` 80 px); WebGL draws it in the circle shader from a per-instance tail vector (`STRIDE` 7), Canvas2D as a triangle. Gems have no sim velocity, so `fx.observe` derives it per sim tick. The player and orbit blades follow curves, so `fx` keeps a 10-sample position history for them (at least `TRAIL_DT` = 1/60 s apart, so the trail is a little shorter in time on a 60 Hz display than on a faster one) drawn as fading dots. Presentation-only like the rest of fx; stress mode passes no fx, so it packs zero tails. The tail starts at the body's rim (the radius is added to its length), so slow enemies still show a short one; it fades from 0.4 alpha (WebGL; Canvas2D is a flat 0.3), so it stays subtle.

## Sound
`src/audio/sfx.js` synthesizes every effect with WebAudio (no asset files): shot, hit, kill (heavier for bruisers and bosses), gem pickup (pitch climbs a pentatonic scale while pickups keep coming, restarts after 0.5 s), level-up arpeggio, damage, boss spawn, game over. Presentation-only like fx: `game.sfx` is optional, the sim only calls `sfx.kill` (via `onKill`) and `sfx.boss`; `sfx.observe(game)` derives the rest from state changes once per frame. Per-sound throttles (`MIN_GAP`), a 24-voice cap and a compressor keep a crowd from turning to noise. Audio starts on the first key press or touch (browser autoplay rules); **M** mutes (remembered in localStorage, shown in the HUD). There is no sound in stress mode. Levels were checked offline (every sound peaks between 0.06 and 0.45, no NaN), but nobody has judged how it sounds yet; all gains and pitches are first guesses in that file.

## Arena soak
`npm run soak` (`node scripts/soak-arena.js --minutes=10`) runs the arena headless with a stationary invulnerable player, taking the first offered skill at each level-up, and prints one line per game minute (node v26.10.0, seed 1, Defender real-time protection off, machine CPU ~30% busy at the time):

| min | enemies | gems | high | dropped | level | kills | tick ms (median / p95) |
|---|---|---|---|---|---|---|---|
| 1 | 43 | 14 | 60 | 0 | 3 | 52 | 0.01 / 0.03 |
| 2 | 141 | 0 | 168 | 0 | 6 | 122 | 0.02 / 0.05 |
| 3 | 307 | 0 | 407 | 0 | 8 | 197 | 0.05 / 0.09 |
| 4 | 421 | 0 | 575 | 0 | 11 | 395 | 0.04 / 0.07 |
| 5 | 61 | 478 | 583 | 0 | 15 | 1140 | 0.03 / 0.07 |
| 6 | 63 | 423 | 680 | 0 | 16 | 1594 | 0.04 / 0.06 |
| 7 | 77 | 483 | 680 | 0 | 16 | 2109 | 0.05 / 0.09 |
| 8 | 91 | 553 | 682 | 0 | 16 | 2695 | 0.05 / 0.09 |
| 9 | 90 | 622 | 762 | 0 | 17 | 3369 | 0.05 / 0.10 |
| 10 | 112 | 673 | 838 | 0 | 17 | 4091 | 0.04 / 0.08 |

Caveat (table above, taken before the kiting change): the player is stationary, so this is a load proxy, not a difficulty measure. The table predates the balance pass below; spawn rates and kiting have changed since. Entity counts stay far below the 50k capacity and nothing is dropped.

## Stress benchmarks (plan 2)
- Sim: `npm run bench` (headless, per-system ms/tick; `--n=`, `--scenario=`, `--ticks=`). N is total entities, half enemies and half player projectiles.
- Browser: open `/?stress=N` (add `&scenario=converge` for chasers). The HUD shows sim, draw and frame ms; `arrowGame.frameStats()` returns median and p95 frame interval.

Sim results, node v26.10.0, median ms per tick (budget 16.7), Defender real-time protection off, machine CPU ~46% busy from stray python processes, so treat as upper bounds:

| scenario | 1k | 5k | 10k | 20k | notes |
|---|---|---|---|---|---|
| sparse (1 entity / 2500 px², arena scaled) | 0.24 | 1.44 | 2.36 | 4.94 | collision is 60% of the tick |
| dense (900x600 arena) | 0.22 | 2.70 | 10.25 | 45.78 | collision is 97% of the tick |
| converge (chasers pile on the player) | 0.41 | 6.45 | 25.32 | 94.55 | worst case for the grid |

At constant density the sim fits 20k entities in 5 ms. Cost explodes with crowding (collision candidates per projectile), not with entity count alone.

Grid cell size (`createGame({ cellSize })`, bench `--cell=`) was swept at 16/32/64/128 on the same machine under load. 32 is the default: converge at 20k went from 75-117 ms to 42-48 ms, sparse was equal or better, dense was unchanged (~50 ms) because its cost is the overlap count itself. 16 and 128 were worse. Repeat runs varied by ±40% under load, so only the converge gain is a clear signal.

Browser results (Chrome, real window, GPU = AMD Radeon 780M iGPU via ANGLE/D3D11, ~46% CPU load from stray processes). Median rAF interval over ~10 s; sim and draw are the HUD's CPU-side EMAs per step / per frame:

| scenario | N | frame ms (p95) | sim ms/step | draw ms (CPU) |
|---|---|---|---|---|
| dense | 1k | 16.7 (17.9) | 0.7 | 1.1 |
| dense | 5k | 39.2 (66.5) | 5.9 | 3.6 |
| dense | 10k | 91.4 (118.9) | 12.9 | 4.8 |
| dense | 20k | 273 (411) | 49.6 | 10.0 |
| converge | 5k | 32.7 (49.1) | 2.6 | 2.1 |
| converge | 10k | 68.2 (93.5) | 8.1 | 4.5 |
| converge | 20k | 185 (290) | 61.6 | 11.4 |

Frame time is far above sim + draw CPU time (e.g. dense 5k: ~10 ms CPU, 39 ms frame), so the gap is Canvas2D rasterization on the GPU, which `draw ms` cannot see. Canvas2D does not hold 60 fps past ~1-2k entities on this iGPU; the 20k target needs WebGL instanced drawing (or a cheaper draw path) regardless of sim cost. Caveat: Chrome picked the iGPU, not the eGPU, and the sim also ran 1-3 catch-up steps per frame at the slow end, which inflates frame time.

## WebGL renderer (plan 2b)
`src/render/webgl.js`: WebGL2 instanced circles (one draw call, one pass over the world), HUD on a separate 2D canvas. Default when WebGL2 is available; falls back to Canvas2D. Reproduce with `node scripts/render-bench.mjs` (starts its own server and a throwaway Chrome; `--shot=dir` saves screenshots).

Median frame ms (p95), same machine and load as above (iGPU 780M, ~46% CPU busy):

| scenario | N | Canvas2D | WebGL |
|---|---|---|---|
| dense | 5k | 34.7 (51.5) | 16.7 (17.8) |
| dense | 10k | 69.2 (104) | 16.8 (43.6) |
| dense | 20k | 250 (406) | 241 (449) |
| converge | 5k | 39.8 (52.8) | 16.7 (17.6) |
| converge | 10k | 73.1 (105) | 16.9 (84.5) |
| converge | 20k | 393 (466) | 169 (239) |

WebGL draw CPU time is ~0.5 ms at every N, so rendering no longer limits frame time. At 20k the frame time is about 4-5 sim steps (the stepper's catch-up cap) at 37-46 ms each: the sim's collision cost under 900x600 crowding is the remaining limit. Spikes at 10k converge (p95 84 ms) come from the same sim cost as chasers pile up.

## Collision search radius (plan 2c)
The candidate search used a fixed boss-sized radius (36) for every projectile; it now uses `grid.maxRadius`, the largest radius among the enemies of the current tick (boss rooms still pay for the boss). Sim median ms per tick at 20k, two alternating before/after runs on the same loaded machine (`npm run bench`):

| scenario | before | after |
|---|---|---|
| dense | 46 / 41 | 15 / 23 |
| converge | 88 / 52 | 21 / 33 |
| sparse | 6.2 / 4.7 | 2.7 / 4.6 |

Cell size re-swept at the new radius (16/32/64): 32 stays the default (64 is ~2x worse in dense and converge; 16 is similar in the crowded cases and worse when sparse). Run-to-run noise is about ±40% under the current machine load.
