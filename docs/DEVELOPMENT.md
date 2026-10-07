# Development notes

Engineering notes for arrow-game: commands, build sizes, benchmarks, soak results, design notes and known gaps. Moved here unchanged from the original README when it was rewritten for the public release; figures are dated and were measured on one machine. Design specs and plans are kept out of the published tree. See the [README](../README.md) for an overview and how to play.

## Commands
Browser archer roguelite (Archero / arrow.io style). Strict TypeScript bundled by Vite, with Bun as the tool (install, scripts, tests); typed-array simulation, no runtime dependencies.

- Install: `bun install` (dev dependencies only: `typescript`, `vite`, `@types/bun`)
- Run: `bun run dev` then open http://localhost:8000 (Vite dev server, port 8000, fails rather than drifting if the port is taken)
- Build: `bun run build` writes the bundle to `dist/`; `bun run preview` serves it on http://localhost:8000
- Test: `bun test`; `node --test test/*.test.ts` runs the same 401 tests on Node/V8 (type stripping) as a cross-engine check of the golden hashes
- Typecheck: `bun run typecheck` (`tsc --noEmit`; `strict`, explicit `.ts` import specifiers, erasable syntax only)
- Benchmarks: `bun run bench` (sim), `bun run soak` (arena soak), `bun run bench:render` (Chrome); `node scripts/<name>.ts` runs the same scripts on V8 (checked for `bench-sim`, `soak-arena`, `gem-timing`)
- Design specs and plans are kept out of the published tree.

## Build
`bun run build` (Vite 8.3.2) bundles 57 modules into `dist/` in ~0.4 s. Sizes on 2026-10-04, after Daggers (`du -sh dist`: 133K on disk, 117,871 bytes of files; gzip is Node `zlib.gzipSync` at the default level):

| file | bytes | gzip |
|---|---|---|
| `index.html` | 539 | 319 |
| `assets/index-*.js` (the whole game, minified) | 82,028 | 31,441 |
| `assets/index-*.css` | 8,680 | 2,209 |
| `assets/share-tech-mono-latin-400-normal-*.woff2` | 13,500 | - |
| `assets/orbitron-latin-500-normal-*.woff2` | 6,596 | - |
| `assets/orbitron-latin-700-normal-*.woff2` | 6,528 | - |

Dev-server start (`bun run dev`, measured from launching the command to the first response, machine CPU ~93% busy from other sessions, BelowNormal, Vite's dependency cache already present): first 200 on `/` after 2.1 s, `/src/main.ts` served at 2.3 s. `bun run preview` answers `/` after 1.2 s. `bun run` starts Vite through its `node` shebang, so the Vite server itself runs on Node; Bun runs the tests and the scripts.

Out-of-repo CDP harnesses that imported `/src/...js` paths need the `.ts` names now (the dev server serves `/src/main.ts`; the build has a single hashed bundle).

## Status
Plan 1 (core + rooms mode) implemented; playable at `bun run dev`. Gameplay feel not yet tuned.
Plan 2 benchmarks done (see below); WebGL renderer implemented (default; `?renderer=canvas2d` for the fallback). Plan 3 (arena mode + camera) implemented; play it at `/?mode=arena` (rooms stays the default at `/`).

## Branches
`main` is the trunk: work lands there through feature branches (`feat/*`, `fix/*`, `docs/*`), and releases are marked by `vX.Y.Z` tags, not by a separate branch (the old `dev` branch was folded into `main` after v0.3.0). Between tags, `package.json` carries the next `-dev` version. Merging is the owner's decision; run `bun test` and `node --test test/*.test.ts` on the merged result first. Tagging and pushing branches and tags to the public remote are also the owner's call. A future live demo should deploy from `v*` tags, not from every push to `main`, so unreleased work never ships by accident.

## Versioning and commits
Three separate versions, each with one job:
- **Release version** (`version` in `package.json`, git tags `vX.Y.Z`): `0.MINOR.PATCH` while unstable, `1.0.0` at the first public release. Minor = new content or features (a mode, an enemy, a skill), patch = fixes and tuning. Named prereleases use SemVer tags, `v0.1.0-alpha.1`, `-beta.1`, `-rc.1`; the `package.json` version reads the next version with `-dev` between tags (now `0.4.0-dev`).
- **`SIM_VERSION`** (`src/replay/version.ts`, integer): bump on the FIRST change to sim behaviour after a release (balance tuning included), because old replays and share codes stop verifying. Further sim changes before the next release share that bump: nobody holds replays from an unreleased build, so only your own dev replays break, and they fail verification instead of showing as stale. Whenever the sim changes, still regenerate the goldens with `bun scripts/make-golden.ts --force`, repin the determinism hashes and say so in the commit body. It is independent of the release version: a patch release that tunes gem speed still bumps it. After a release, even a number change needs the bump; batch such changes into the next release.
- **`REPLAY_VERSION`** (`src/replay/codec.ts`): bump only when the replay file format changes.

Commits are Conventional Commits, `type: summary`, scope optional. Types in use: `feat`, `fix`, `docs`, `test`, `perf`, `chore`, plus `tune` for balance and feel changes. Mark a breaking change with `!` (`feat!:`) or a `BREAKING CHANGE:` footer. Commit bodies explain why, and name any `SIM_VERSION` bump.

Prereleases are tagged on `main` at points the owner picks. `v0.1.0` is the first tag (made after the checklist below passed); the next release number is chosen per release. Release checklist:
1. `bun test` and `node --test test/*.test.ts` pass on the tagged commit, and `bun run typecheck` is clean.
2. If `SIM_VERSION` changed, the goldens are regenerated and committed.
3. `bun run bench:render` and `bun run soak` have run, with CPU load and Defender state recorded next to the numbers.
4. `package.json` version and the tag match; a `CHANGELOG.md` entry lists the changes and any `SIM_VERSION` bump (the file is created with the first tag).
5. Tag the release commit on `main`, then bump `package.json` to the next `-dev` version in a follow-up commit.

## UI
`/` opens a title screen (Pit or Keep); `/?mode=arena` and `/?mode=rooms` skip it, as does `?stress=N` (those never auto-pause, so benchmarks run unfocused). Esc or P pauses (also on tab blur when started from the title); M mutes; 1-3 or a click picks a skill. Personal bests are kept in `localStorage` (`arrow-best-arena`, `arrow-best-rooms`). `?debug` shows the entity and frame-time line at the bottom.

The screens and HUD are DOM overlays (`src/ui/`): `model.ts` holds the pure view-models, `ui.ts` the DOM controller, `ui.css` the Synthwave theme (tokens as custom properties). Fonts are self-hosted in `assets/fonts/` (Orbitron, Share Tech Mono; SIL OFL). The sim only exposes `game.skills` (owned-skill counts) and `game.bossAt` (last boss spawn time) for the UI.

Parked: a volume slider and settings screen, a real icon set (the glyphs are simple inline SVG), key rebinding, gamepad, a tutorial, an attract-mode title background, Rooms difficulty select. Touch: a tap on the HUD pause button also starts the move stick (harmless, not fixed).

## Replays and challenges

Every run is recorded as its seed plus quantized per-tick inputs and skill picks (`src/replay/`), so it can be re-simulated exactly. The best run per mode and seed is kept in `localStorage` (cap 40; random-seed runs are dropped first, then the oldest).

- **Echoes** (title screen): Daily Pit / Daily Keep (seed derived from the local date), or any text or number as a seed. A run on a seed you have a best for races it as a translucent ghost with a live comparison line.
- **Watch replay**: from the game over screen or the Challenges list; 1x or 4x, Esc to exit.
- **Share codes**: Copy code on the game over screen or in the list; paste into Import. Codes are `AG1.` plus base64url of deflated JSON; imports are re-simulated and rejected if they do not reproduce.
- **Versioning**: `SIM_VERSION` in `src/replay/version.ts`. Changing sim behaviour makes `test/replay-golden.test.ts` fail: bump the version once per release cycle (see the `SIM_VERSION` entry above), then `bun scripts/make-golden.ts --force`. Old-version replays stay listed as stale and cannot be watched or raced.
- **Caveat**: determinism is proven within one JS engine only. A replay recorded in another browser engine may drift (trig functions); the viewer warns.
- `?mode=arena&seed=123` starts a direct run on a fixed seed (direct runs keep the finished run in memory for Watch replay / Copy code but never write it to the store).

## Arena balance (kiting)
In arena the player auto-fires while moving at half rate (`stats.moveFireRate = 0.5`; rooms keeps stand-still-to-fire, `moveFireRate = 0`), shooters and bosses only fire while on screen (`game.enemyFireOnScreen`), the early spawn ramp is gentler (`BASE_RATE 0.6`, `RATE_PER_SEC 0.015`), and the gem magnet is at least 1.5x the player's speed. A stationary player used to die at about 0:30.

`bun scripts/soak-arena.ts --bot=kite --seed=N` runs a crude mortal kiting bot (flees nearby enemies, avoids walls, chases gems, always takes the first offered skill) and reports when it dies. Before weapons (`SIM_VERSION` 2) seeds 1-5 died at 69, 99, 131, 157 and 171 s, all at level 1-2; on `SIM_VERSION` 3 (weapons in the offer pool, the bot still takes the first offer) they died at 118, 245, 86, 205 and 163 s, level 2-5. `--bot=smart` adds a skill priority (multishot, rapid, power before speed), keeps collecting gems while fleeing and sidesteps so it circles instead of pinning itself on a wall: seeds 1-5 died at 131, 252, 199, 220 and 217 s, level 2-4, before weapons; on `SIM_VERSION` 3 (its priority lists the four older weapons after Multishot, Rapid Fire and Power Shot; Flame trail, Mines, Meteor, Beam, Drone and the six modifiers were added to it later, after the weapons) at 150, 132, 145, 86 and 149 s, level 2-5. The smart bot now dies sooner on most seeds, probably because it takes weapons it can't aim or use well; treat that as a bot artefact until a human plays it. Both are yardsticks for later tuning, not targets; a human should do better.

## Effects
Hit flash, kill pop, gem burst, screen shake and a damage vignette come from `src/render/fx.ts` (presentation-only, `game.fx` optional, absent in stress mode, which still draws the WebGL outline and shadow). The WebGL renderer adds an outline and soft shadow in the circle shader. The Canvas2D fallback draws flash, pop, shake and vignette but no outline or shadow.

Layer order, bottom to top, is the same in both renderers: background and grid, gems, Flame trail fire patches (alpha capped at 0.35, below enemies and shots because opaque discs hid them), Mines (dim until armed, solid, fading over the last 1.5 s; same layer), enemies, enemy projectiles, arrows, fx particles, orbit blades, weapon effects (shockwave ring, chain-lightning zap, boomerangs, meteor strike rings, beam, drones, daggers), player, then HP bar, damage vignette and HUD text. The WebGL renderer puts the background and grid on a `#bg` canvas below a transparent `#game` canvas, and the HP bar, vignette and HUD on `#hud` above it. Within a layer, WebGL draws in slot order and Canvas2D by enemy type.

## Content
Arena enemy mix (`MIX` in `src/modes/arena.ts`, first match wins, the rest are chasers): shooters from 60 s (30%), swarmers from 30 s (15%, spawn as a pack of 4), bruisers from 90 s (8%), splitters from 150 s (8%, leave 2 swarmers). Skills (`src/game/skills.ts`; weapons are listed under Weapons below): Regeneration (+1 HP/s), Magnet (+50% pickup range), Homing (arrows steer toward the nearest enemy within 300 px at up to 4 rad/s; `world.type` = 1 flags the arrow) and Orbit Blade (a levelled weapon, see Weapons; blades are not entities, `src/game/orbit.ts` computes positions for both the sim and the renderers). All numbers are first guesses. Smart-bot soak (seeds 1-3) died at 211, 132 and 184 s before weapons and at 150, 132 and 145 s with them; the bot picks skills by priority, not cleverly.

Trails (`src/render/trail.ts`, tunables there): enemies, arrows, enemy shots and gems get a tapered tail bent through where they actually were. `fx` keeps a 10-sample position history per slot (one per sim tick, taken at the end of `tick` by `fx.sample`, so tail length is the same at any frame rate and does not grow while paused) and `bentTail` turns the samples at ages `TRAIL_MID` and `TRAIL_END` into a bend and a tip, capped at `TRAIL_MAX` 80 px and at `TRAIL_PER_R` (8) radii, so small movers get short tails. The tail is a quadratic curve from the centre through the bend to the tip: WebGL walks it in `TAIL_STEPS` (6) capsules in the circle shader from a per-instance tail (`STRIDE` 9), Canvas2D draws it with `quadraticCurveTo`. A slot's history is tied to its generation, so a recycled slot never shows a ghost, and a mover under 5 samples old gets a straight tail. The player and orbit blades are not slots, so `fx` keeps the same 10-sample history for them (`trackTail`) and they get the same bent tail. Presentation-only like the rest of fx; stress mode passes no fx, so it packs zero tails. The tail starts at the body's rim (the radius is added to its length), so slow enemies still show a short one; it fades from 0.4 alpha (WebGL; Canvas2D is a flat 0.3), so it stays subtle.

Gems are captured when they enter the pickup radius and stay captured. A captured gem is a damped orbit around the player, simulated in the player's frame of reference (`src/game/gems.ts`; the player's travelled velocity is `player.vx/vy`): a spring-like pull, drag on the velocity relative to the player, and a sideways push that fades out over the first 0.5 s so it swings around and spirals in (about 0.8 s). Because it works in the player's frame, a moving player drags its gems along and cannot outrun them. The gem's real velocity feeds its trail. It is sim-side, part of `SIM_VERSION` 2, and uses no RNG or trig. `bun scripts/gem-timing.ts` prints the time to collect a gem from the edge of the pickup radius, for balance checks.

## Weapons
Arena only (`SIM_VERSION` 12). Weapons are levelled (5 levels) and held in up to `MAX_WEAPONS` (5) slots, the bow included; Rooms keeps its original offer pool. The framework is `src/game/weapons.ts` (`WeaponDef`, the `WEAPONS` list, `weaponSystem`, per-run state on `game.wstate`); each weapon's level table lives in `src/game/weapons/<id>.ts`. `skills.ts` turns each def into an arena-only skill: the first pick takes it (level 1), later picks level it, and it leaves the offer at max level or when every slot is taken. Offer cards show `NEW` or the level step (`Lv n -> n+1`). Power Shot (`damageMult`) applies to every weapon; Rapid Fire (`cooldownMult`) divides the bow, Shockwave, Chain, Boomerang, Mines, Meteor, Drone and Daggers intervals but not Beam, Flame trail or Orbit Blade, which have no interval (they tick continuously); Multishot, Piercing, Ricochet and Homing are bow-only. Numbers per level 1 to 5, as in the code:

| Weapon | Behaviour | Level table |
|---|---|---|
| Orbit Blade (`blade.ts`) | blades orbit the player, damage to every enemy they overlap | count 1, 2, 3, 5, 8; dps 30, 30, 35, 40, 45 each |
| Shockwave (`shockwave.ts`) | ring expands at 400 px/s from where it started, each enemy hit once; waits for an enemy within radius; no knockback | damage 20, 30, 40, 55, 75; radius 150, 190, 230, 270, 320; interval 5, 4.5, 4, 3.5, 3 s |
| Chain Lightning (`chain.ts`) | zaps the nearest enemy within 300 px, jumps up to `jumps` times to the nearest unhit enemy within 150 px, x0.8 damage per jump | jumps 2, 3, 4, 5, 6; damage 15, 20, 26, 33, 42; interval 1.6, 1.4, 1.25, 1.1, 1.0 s |
| Boomerang (`boomerang.ts`) | launches at the nearest enemy in range, flies out and back at 450 px/s (radius 10), damages everything it overlaps; relaunch 1 s after a catch, first launches staggered 0.35 s | count 1, 1, 2, 2, 3; range 300, 330, 360, 390, 420; dps 40, 50, 60, 75, 90 |
| Flame trail (`flame.ts`) | drops a fire patch every 20 px the player moves; patches live in a fixed 64-patch ring (the oldest is overwritten) and tick every 0.25 s, hitting every enemy they overlap through `HIT_STATUS \| HIT_TICK`: Frost and Ignite apply, never crits or knocks back | dps 8, 12, 16, 22, 30; patch life 2, 2.5, 3, 3.5, 4 s; radius 14, 16, 18, 20, 24 px |
| Mines (`mines.ts`) | drops a mine at the player's feet when the timer is up and the player is 20 px from the last drop; 48-slot pool, 12 s life with no detonation on expiry (so the live count settles near 4 to 7); 0.5 s arming; an enemy within 30 px plus its radius triggers it; one blast hits every enemy within the blast radius through `hitEnemy` with `HIT_STATUS \| HIT_KNOCK`: Frost and Ignite apply, never a crit, and it pushes only with the Knockback modifier; the blast ring reuses the Explosive ring (`fx.kill`) | damage 40, 55, 75, 100, 135; blast radius 60, 66, 72, 80, 90 px; drop interval 3.0, 2.7, 2.4, 2.1, 1.8 s |
| Meteor (`meteor.ts`) | marks distinct random live enemies within 320 px of the player (picked on `game.rng`, stored at their position at pick time, so a moving enemy can leave its mark), then after a 0.6 s telegraph one blast at the marked spot through `hitEnemy` with `HIT_STATUS \| HIT_KNOCK`: Frost and Ignite apply, never a crit, and it pushes only with the Knockback modifier; 12-slot pool; no rng is drawn when nothing is in range; the impact ring reuses the Explosive ring (`fx.kill`), and the telegraph ring brightens from 0.25 to 0.9 opacity | meteors 1, 1, 2, 2, 3; damage 50, 70, 95, 125, 160; blast radius 40, 44, 48, 52, 56 px; interval 4.0, 3.6, 3.2, 2.8, 2.4 s |
| Beam (`beam.ts`) | one beam from the player; targets the nearest enemy within its length (`grid.nearest`); the first target snaps the heading, after that it turns toward the target at the level's capped rate along the shorter arc, so a fast or switching target can slip past it; with no target in range `live` is 0 and the heading and tick timer hold; every 0.25 s each enemy within half-width plus its radius of the segment (squared point-to-segment test) takes one tick through `hitEnemy` with `HIT_STATUS \| HIT_TICK`: quiet damage (`fx.soft`), never a crit or a push, Frost and Ignite apply; no rng; drawn as up to 40 dots (about 8 px apart) in the weapon colour at 0.7 alpha above enemies (WebGL), a line on Canvas2D | dps 20, 30, 42, 58, 80; length 160, 190, 230, 270, 320 px; turn 1.2, 1.6, 2.0, 2.5, 3.0 rad/s; half-width 6, 7, 8, 9, 10 px |
| Drone (`drone.ts`) | up to three drones at fixed screen-space offsets from the player (-32,-32), (32,-32) and (0,36); each eases toward its offset at 6 per second, so it lags a moving player, and a newly active drone snaps to its offset; each drone shoots the nearest enemy within range of the DRONE (not the player) once per interval, with its timer held at 0 while there is no target; first shots are staggered 0.15 s per slot; a shot is one `hitEnemy` of damage x `damageMult` through `HIT_CRIT \| HIT_STATUS`: it can crit (rolled inside `hitEnemy`, so the weapon itself draws no rng), applies Frost and Ignite, never pushes, and flashes the enemy like a bow hit (no `HIT_TICK`); drawn as a dot per drone and a 0.08 s tracer (a float32-exact constant via `Math.fround`) of six dots to the last target, a line on Canvas2D | drones 1, 1, 2, 2, 3; damage 10, 14, 16, 22, 26; interval 0.60, 0.55, 0.50, 0.45, 0.45 s; range 220, 240, 260, 280, 300 px; total dps with every drone firing 17, 25, 64, 98, 173 |
| Daggers (`daggers.ts`) | every interval throws a fan of `count` daggers 0.18 rad apart (centred on the aim), aimed along the player's movement when the player is faster than 20 px/s, else at the nearest enemy within range, else no volley (the timer holds at 0); a dagger starts at the player, first moves on the next tick at 700 px/s and is freed once it has flown its range (a volley lives 0.46 to 0.57 s); a hit is one `hitEnemy` of damage x `damageMult` through `HIT_CRIT \| HIT_STATUS`: it can crit (rolled inside `hitEnemy`, so the weapon itself draws no rng), applies Frost and Ignite, never pushes, and flashes the enemy like a bow hit (no `HIT_TICK`); each hit spends one pierce and the dagger is freed on the hit after its last, so it hits `pierce` + 1 enemies; it skips the enemy it hit last while still overlapping it (the bow's last-hit rule, so two overlapping enemies can rarely be hit twice by one dagger); a 28-slot pool (four level-5 volleys), and a full pool skips the rest of a volley (possible only with 7 or more stacked Rapid Fire picks at level 5; see the Rapid Fire overflow note below the Known gaps paragraph); drawn as a head dot and two fading trailing dots, a two-segment streak on Canvas2D | daggers 3, 3, 5, 5, 7; damage 18, 24, 26, 34, 38; pierce 1, 1, 2, 2, 3 (hits per dagger 2, 2, 3, 3, 4); interval 1.0, 0.9, 0.9, 0.8, 0.8 s; range 320, 340, 360, 380, 400 px; volley damage per second if every dagger hits once 54, 80, 144, 213, 333 |

### Modifiers
Arena only, levelled 1 to 5 (`MOD_MAX`), offered and taken like weapons but they use no weapon slot. Every enemy hit goes through `hitEnemy` in `src/game/hit.ts`, which applies them; the numbers live in `src/game/modifiers.ts`. Hit flags: `HIT_STATUS` applies Frost and Ignite to a survivor; `HIT_TICK` marks a slice of continuous damage (burn, Flame trail, Beam). A `HIT_TICK` hit still damages, kills, heals and explodes, but calls `fx.soft` instead of the hit flash and does not count as a hit for the hit audio, so a burning or fire-standing enemy no longer flashes white every tick. The burn fix (it flashed before) rides on the same flag.

| Modifier | Effect per level | Applies to |
|---|---|---|
| Critical Hits (`crit`) | +10% chance to deal double damage (x2) | arrows, Shockwave, Chain Lightning, Drone, Daggers |
| Knockback (`knockback`) | pushes a surviving enemy back 10 px, along the hit direction | arrows, Chain Lightning, Mines, Meteor |
| Vampiric (`vamp`) | each kill heals 1 HP (capped at max HP) | every kill |
| Frost (`frost`) | a surviving hit slows the enemy: -12% speed per level (floor 40% at level 5) for 2 s; a new hit refreshes the timer, it does not stack; icy cyan tint (`FROST_TINT`) | arrows, Shockwave, Chain Lightning, Flame trail, Mines, Meteor, Beam, Drone, Daggers |
| Ignite (`ignite`) | a surviving hit sets the enemy burning: 6 damage per second per level x `damageMult` for 3 s; refreshes, does not stack; burn damage never crits, pushes or re-applies a status, and a burn kill still heals (Vampiric) and explodes; red-orange tint (`IGNITE_TINT`, wins over cyan); the burn lasts exactly 180 ticks and a burn kill's blast drains the same tick (`statusSystem` runs before `explosionSystem`) | arrows, Shockwave, Chain Lightning, Flame trail, Mines, Meteor, Beam, Drone, Daggers |
| Explosive Kills (`explode`) | a kill explodes: radius 40 + 10 px x level, damage 10 x level x `damageMult` to every enemy that overlaps it (centre within radius + its own radius); a gold ring marks the radius | every kill except one caused by an explosion |

At very high Swift Feet the 64-patch Flame trail ring overwrites the oldest live patches, so the trail shortens. Orbit Blade, Boomerang, Drone and Daggers deliberately deal damage without `HIT_TICK`, so they still flash the enemy and count as hits (a Drone shot or a dagger hit flashes like a bow hit). Boomerang and Orbit Blade hits get neither Crit nor Knockback (they still trigger Vampiric and Explosive). Explosions do not chain, never crit and never knock back. Knockback is along the hit direction, not away from the player, so a ricocheting arrow can push an enemy toward the player (up to 10 px x level); contact damage is still limited only by invulnerability frames, and clamping to the arena is the one guard. A kill only queues its blast; `explosionSystem` drains the queue once per tick, after the weapons, from a fixed 64-slot buffer (`BLAST_CAP`, the overflow is dropped). `test/modifiers-determinism.test.ts` runs a maxed build (all ten weapons and all six modifiers at level 5, except the Drone at level 4; `applySkill` does not check slots) for 60 s and pins three state hashes, so Bun and Node must agree; it also asserts that slowing, burning, fire patches and mines all occur, that a mine detonates (a slot cleared well before `MINE_LIFE`; expiry does not blast), that meteors are marked and land, and that the beam takes enemy hp or kills, that the drones kill or hurt an enemy, and that the daggers hit an enemy. The Drone is applied at level 4 (two drones, range 280) separately from the loop that maxes the rest: at level 5 the drones kill the sparse arena enemies before the beam or a meteor reaches one, and three coverage flags (`meteors`, `struck`, `beamed`) go false (no meteor is even marked). Daggers stay at level 5 (`DAGGER_LEVEL` in the test): every coverage flag, the dagger one included, held there, so no lower level was needed. The 5-slot cap leaves four non-bow slots, so a real run holds at most four of the ten weapons. Meteor is the first weapon to consume `game.rng` (the target picks), so owning it shifts every later crit roll; that is deterministic and covered by the `SIM_VERSION` 8 bump. Beam draws nothing from the rng, so it does not shift the rng sequence itself; `SIM_VERSION` 9 is for its hash fields and the grown offer pool. The Drone draws nothing from the rng itself, but a drone shot is a `hitEnemy` call with `HIT_CRIT`, so with Crit owned its shots consume `game.rng` for the crit roll; `SIM_VERSION` 10 is for the drone hash fields and the grown offer pool. Daggers likewise draws nothing from the rng itself, but a dagger hit is a `hitEnemy` call with `HIT_CRIT`, so with Crit owned its hits consume `game.rng` for the crit roll; `SIM_VERSION` 11 is for the dagger hash fields and the grown offer pool.

Adding a weapon: write a def with a level table and an `update` (or `onLevel` if it caches a stat), register it in `WEAPONS`, add an icon, a state field in `WeaponState` and a `stateHash` line for that state (Mines hashes `on` for every slot, but `x`, `y` and `age` only for live slots, plus `started`, `lx`, `ly` and `cd`; Meteor hashes `cd` and `on` for every slot, and `x`, `y` and `age` for live slots; Beam hashes `started`, `live`, `angle` and `cd`; Drone hashes `on`, `x`, `y`, `cd`, `tx`, `ty` and `age` for every slot; Daggers hashes `on`, `x`, `y`, `dx`, `dy`, `left`, `pierce`, `lastHit` and `lastGen` for every slot, and `cd`) (levels are hashed from `WEAPONS` automatically), then regenerate the goldens (`SIM_VERSION` bump).

Known gaps (found in review, none blocking): the goldens exercise little of the new content (since `SIM_VERSION` 10 the arena golden picks Regeneration, Flame trail and Rapid Fire, and its picks did not change at `SIM_VERSION` 11 when Daggers joined the pool (only the sim number and the hash did); at `SIM_VERSION` 9 it picked Regeneration and Boomerang, so its picks changed when the Drone joined the pool, while the rooms golden's picks did not; the arena golden exercises one weapon (Flame trail) at level 1 and no modifier, neither Frost nor Ignite, and the rooms golden exercises only bow skills), so Orbit Blade, Shockwave, Chain Lightning, Mines, Meteor, Beam, Boomerang, Drone, Daggers, Flame trail beyond level 1 and the six modifiers are covered by the maxed-build determinism test (all ten weapons, the Drone at level 4, and all six modifiers, three hashes checked on both Bun and Node) rather than by a golden; `damageMult`, `cooldownMult` and `bladeDps` are not hashed (like the other stats); `Grid.nearest` assumes an enemy grid; with 6 or more Swift Feet the player outruns a returning boomerang (450 px/s) and it relaunches late; Chain lightning's WebGL dots skip each segment's endpoint (Canvas2D draws the full line); per-level range/dps and return-pass damage for Boomerang, and a stale-target test for Shockwave, are untested; the soak numbers above predate Flame trail, Mines, Meteor, Beam, Drone, Daggers and the modifiers (the smart bot's `PRIORITY` now lists them, Daggers after Drone, the bow upgrades Multishot, Rapid Fire and Power Shot first, then weapons, then modifiers, so re-measure before comparing).

Deferred: an upgrade-variety round (per-weapon branches); Shockwave has no knockback. Checked in a visible browser pane on 2026-10-04 (WebGL and `?renderer=canvas2d`, weapons forced through the console): effects, NEW / level-step cards and the HUD level strip draw and the console stays clean. Not done: render-bench with weapons idle, held-key play, a natural long run. On 2026-10-05, paused-frame checks (the sim was frozen right after a full dagger volley, weapons forced to level 5) showed the Beam, Meteor, drones and dagger streaks drawing in WebGL and the drones and a full dagger volley drawing in Canvas2D, with a clean console. Not seen: the Canvas2D Beam and Meteor, the Rapid Fire card width, and the partial-fan lean under Rapid Fire. Beam, Drone and Daggers have not been benched yet. Known gap: Rapid Fire overflow: a volley outlives the interval from 2 Rapid Fire picks; the 28-slot pool (14 until `SIM_VERSION` 12) holds the overlap until 7 picks at level 5 (8 at level 4, 9 at level 3, 12 at levels 1 and 2; measured with the real weapon, no enemies, a moving player). At level 5 without hits whole volleys are skipped; with hits freeing single slots a volley can be a partial fan that leans toward the fan's lowest-index side. It is deterministic and costs only balance (Rapid Fire past about 7 picks adds little to Daggers); filling a partial volley centre-out would be a sim change, deferred.

## Sound
`src/audio/sfx.ts` synthesizes every effect with WebAudio (no asset files): shot, hit, kill (heavier for bruisers and bosses), gem pickup (pitch climbs a pentatonic scale while pickups keep coming, restarts after 0.5 s), level-up arpeggio, damage, boss spawn, game over. Presentation-only like fx: `game.sfx` is optional, the sim only calls `sfx.kill` (via `onKill`) and `sfx.boss`; `sfx.observe(game)` derives the rest from state changes once per frame. Per-sound throttles (`MIN_GAP`), a 24-voice cap and a compressor keep a crowd from turning to noise. Audio starts on the first key press or touch (browser autoplay rules); **M** mutes (remembered in localStorage, shown in the HUD). There is no sound in stress mode. Levels were checked offline (every sound peaks between 0.06 and 0.45, no NaN), but nobody has judged how it sounds yet; all gains and pitches are first guesses in that file.

## Display names
Only `name` and `desc` (and the UI strings) are display text; ids, files and constants keep the old names, and replays store skill ids, so a rename never touches the sim. v0.3.1 names (id: display):
- Modes: arena: Pit; rooms: Keep. Title-screen Challenges: Echoes (the replay bar says Echo; Daily labels and error messages are unchanged).
- Weapons: blade: Whirligig; shockwave: Quake; chain: Live Wire; boomerang: Yo-Yo; flame: Hot Heels; mines: Breadcrumbs; meteor: Incoming!; beam: Lighthouse; drone: Hornets; daggers: Pincushion.
- Skills: rapid: Quick Draw; power: Big Numbers; pierce: Skewer; ricochet: Pinball; swift: Zoomies; regen: Chicken Soup; homing: Heat Seeker (multishot and magnet are unchanged).
- Modifiers: crit: Lucky Strike; knockback: Personal Space; explode: Popcorn; frost: Molasses; ignite: Cooked (vamp stays Vampiric).
- Boss: the Keep-mode pill reads Showdown; the spawn banner reads Knock Knock / Guess who's here.
Known gap: the Quick Draw, Lucky Strike, Personal Space, Molasses and Cooked descriptions list weapons or exclusions by display name, so they go stale when a weapon gains or loses a modifier; v0.4.0 revisits weapon upgrade parity and should re-sync them (or generalise the text). The enemy type names (chaser, shooter and so on) are internal and never shown.

## Run stats
`game.stats` (src/game/runstats.ts) tallies damage, healing and activity per run for balance work; `formatRunStats` (runstats-report.ts) renders it and the soak prints it at the end (run several `--seed` values to compare). `--picks=random` takes a random offered card (own seeded RNG, sim untouched), so many seeds cover every upgrade; `--picks=id,id` ranks the listed ids first. Without it the smart bot follows its fixed `PRIORITY` list, which rarely reaches Magnet, Molasses or Personal Space. It is presentation-only: the sim never reads it and `stateHash` ignores it, so changing it needs no `SIM_VERSION` bump and the goldens stay put.

- **Exact:** effective damage per source (bow, ten weapons, Cooked burn, Popcorn blasts; overkill is not counted, a hit is capped at the target's hp), healing actually gained (Vampiric, Chicken Soup), enemy-seconds slowed, px pushed, gems captured beyond the base 80 px radius (Magnet), arrows fired. `game.hitSrc` names who dealt a hit (set by weaponSystem, the bow and blade callbacks, statusSystem and explosionSystem); the `other` row must stay 0 (a test checks it).
- **Approximate:** the Big Numbers, Lucky Strike, Quick Draw and Multishot rows. Each is a first-order share carved out of the source rows (so everything sums to the total): Big Numbers takes 1 - 1/damageMult of a hit, an actual crit gives Lucky Strike half of the rest, then for timed sources Multishot takes (n-1)/n of bow damage and Quick Draw takes 1 - cooldownMult of what remains. They assume the extra arrows and attacks would have hit like the first, so treat them as a guide. The report labels them "~ approximate".
- **Paired sweep:** `bun scripts/balance-sweep.ts [--seeds=40] [--minutes=6] [--jobs=4] [--builds=id,..]` runs the smart bot with each skill forced to the front of its pick order and compares it with the baseline build on the same seeds: mean paired change in survival and damage per second with a 95% bootstrap interval, over all runs (not only those that got the skill), plus how many runs picked it. An interval spanning 0 means no measurable effect. A short `--minutes` caps survival, so use 6 or more for the survival column. It reads the soak's `--json` line and runs children at BelowNormal.
- **Not tracked:** Skewer and Pinball (they need per-arrow state or changes in core/systems.ts), Heat Seeker and Zoomies.

## Balance sweep results (2026-10-05, SIM_VERSION 12, Popcorn at 8)
`bun scripts/balance-sweep.ts --seeds=40 --minutes=6 --jobs=4` (25 skills, seeds 1 to 40, machine about 97% busy, Defender real-time protection off; results are deterministic, load only slowed it). Baseline: the smart bot's own priority, survival mean 193 s, 22.2 damage/s. Only rows whose 95% interval excludes 0:

| Skill | picked | change in survival | change in damage/s |
|---|---|---|---|
| Chicken Soup | 19/40 | +29 s | +3.9 |
| Vampiric | 17/40 | +26 s | +3.5 |
| Popcorn | 20/40 | +13 s | +4.2 |
| Breadcrumbs | 19/40 | +7 s | +0.7 |
| Live Wire | 18/40 | not significant | +2.4 |
| Incoming! | 18/40 | not significant | +1.1 |
| Skewer | 18/40 | -12 s | -1.8 |
| Pinball | 21/40 | not significant | -2.6 |
| Lucky Strike | 20/40 | not significant | -2.7 |
| Personal Space | 16/40 | not significant | -2.6 |
| Molasses | 23/40 | not significant | -2.2 |
| Magnet | 19/40 | not significant | -2.1 |

Everything else (including Whirligig) is indistinguishable from the baseline at this size. Read it with care: the baseline already starts with Multishot, Rapid Fire and Power Shot, so a loser is worse than those picks, not necessarily weak; only about 45% of runs actually took each forced skill, which dilutes every effect; and the bot cannot use utility cards (Magnet, Molasses, Personal Space, Lucky Strike) well. Healing is the only family with a large survival gain. Whirligig alone, with a stationary bot, did about 0.3 to 2.4 damage/s against the bow's 10 to 16, so it looks weak, but the sweep cannot confirm it. Decision for v0.3.1: only the Popcorn trim (10 to 8); revisit the rest with a weaker baseline and more seeds in v0.4.0.

## Quiet-machine benches (2026-10-06, SIM_VERSION 12)
Machine CPU 10 to 12% busy before launch, Defender real-time protection off, no GPU leases, runs at BelowNormal. `bun run bench` (Bun 1.4.2), median ms per tick: sparse 0.04 / 0.20 / 0.41 / 0.84 at 1k / 5k / 10k / 20k, dense 0.07 / 0.77 / 2.71 / 9.49, converge 0.07 / 0.85 / 2.82 / 10.10 (budget 16.7; the 2026-10-03 table below was taken at about 100% load, so it reads about 2x higher). Soak, still bot, seed 1, 10 minutes, none dropped a spawn: the base run, and Beam, Drone and Daggers each forced first with `--picks=`, ended at 530, 540, 1047 and 557 slots in use (high-water mark), with median tick 0.03 / 0.03 / 0.05 / 0.03 ms and p95 at most 0.08 ms in minute 10 (Drone peaks at p95 0.15 ms in minute 8). `bun run bench:render` (2026-10-07, background mode, Chrome on the Radeon 780M iGPU via ANGLE D3D11, not the eGPU; exclusive lease held, no other GPU users, machine CPU about 30% busy, Defender off), median frame ms: WebGL dense 16.7 / 16.7 / 16.6 / 154.5 and converge 16.7 / 16.7 / 16.6 / 185.0 at 1k / 5k / 10k / 20k; Canvas2D dense 16.7 / 49.4 / 81.1 / 154.6 and converge 16.7 / 58.4 / 116.7 / 273.0 (WebGL holds 60 fps to 10k; the sim, 8.7 to 12.5 ms at 10k, is the limit at 20k). In line with the earlier tables below.

## Arena soak
The soak bots were re-run on `SIM_VERSION` 3 (2026-10-04, Bun, machine about 49% busy, Defender real-time protection off, BelowNormal priority), so those numbers are contended; the pre-weapons numbers stay beside them for reference and are not directly comparable.

`bun run soak` (`bun scripts/soak-arena.ts --minutes=10`) runs the arena headless with a stationary invulnerable player, taking the first offered skill at each level-up, and prints one line per game minute. Pass criteria: 0 dropped spawns, tick median well under the 16.7 ms budget.

**Node/V8** (node v26.10.0, run as plain JS before the TypeScript migration; seed 1, Defender real-time protection off, machine CPU ~30% busy at the time):

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

**Bun/JavaScriptCore** (Bun 1.4.2, `bun run soak`, seed 1, 2026-10-03, after the TypeScript migration and the balance pass; Defender real-time protection off, machine CPU ~90-100% busy from other sessions, process BelowNormal, so tick times are contended upper bounds):

| min | enemies | gems | high | dropped | level | kills | tick ms (median / p95) |
|---|---|---|---|---|---|---|---|
| 1 | 8 | 43 | 54 | 0 | 2 | 54 | 0.03 / 0.07 |
| 2 | 53 | 10 | 77 | 0 | 5 | 129 | 0.03 / 0.05 |
| 3 | 166 | 0 | 237 | 0 | 7 | 187 | 0.04 / 0.06 |
| 4 | 130 | 0 | 305 | 0 | 14 | 479 | 0.05 / 0.10 |
| 5 | 24 | 284 | 324 | 0 | 16 | 892 | 0.09 / 0.20 |
| 6 | 28 | 347 | 404 | 0 | 16 | 1251 | 0.10 / 0.19 |
| 7 | 28 | 374 | 435 | 0 | 17 | 1683 | 0.10 / 0.22 |
| 8 | 45 | 413 | 495 | 0 | 18 | 2155 | 0.11 / 0.24 |
| 9 | 47 | 491 | 568 | 0 | 19 | 2695 | 0.13 / 0.31 |
| 10 | 47 | 602 | 677 | 0 | 19 | 3316 | 0.15 / 0.24 |

The two tables are not a Node-vs-Bun comparison: the entity counts differ because the sim changed in between (balance pass, gem orbit; `SIM_VERSION` 2), and the machine load differs. Both pass (0 dropped).

Caveat (Node table above, taken before the kiting change): the player is stationary, so this is a load proxy, not a difficulty measure. The table predates the balance pass below; spawn rates and kiting have changed since. Entity counts stay far below the 50k capacity and nothing is dropped.

## Stress benchmarks (plan 2)
- Sim: `bun run bench` (headless, per-system ms/tick; `--n=`, `--scenario=`, `--ticks=`). N is total entities, half enemies and half player projectiles.
- Browser: open `/?stress=N` (add `&scenario=converge` for chasers). Add `&debug` to show sim, draw and frame ms at the bottom; `arrowGame.frameStats()` returns median and p95 frame interval.

Sim results, **Node/V8** (node v26.10.0, plain JS before the TypeScript migration, and before the collision search radius change below), median ms per tick (budget 16.7), Defender real-time protection off, machine CPU ~46% busy from stray python processes, so treat as upper bounds:

| scenario | 1k | 5k | 10k | 20k | notes |
|---|---|---|---|---|---|
| sparse (1 entity / 2500 px², arena scaled) | 0.24 | 1.44 | 2.36 | 4.94 | collision is 60% of the tick |
| dense (900x600 arena) | 0.22 | 2.70 | 10.25 | 45.78 | collision is 97% of the tick |
| converge (chasers pile on the player) | 0.41 | 6.45 | 25.32 | 94.55 | worst case for the grid |

Sim results, **Bun/JavaScriptCore** (Bun 1.4.2, `bun run bench`, 2026-10-03, after the TypeScript migration and the collision search radius change), median ms per tick, Defender real-time protection off, machine CPU ~100% busy from other sessions (process BelowNormal), so contended upper bounds; the bench flagged converge 5k (real `tick()` median 4.58 ms, 62% off the per-stage sum):

| scenario | 1k | 5k | 10k | 20k |
|---|---|---|---|---|
| sparse | 0.17 | 0.86 | 2.02 | 4.12 |
| dense | 0.23 | 2.20 | 6.68 | 21.11 |
| converge | 0.27 | 2.82 | 10.64 | 40.09 |

Not a Node-vs-Bun comparison: the code (collision radius) and the load differ between the two tables. For V8 numbers on today's code, run `node scripts/bench-sim.ts` (the header names the runtime).

At constant density the sim fits 20k entities in 5 ms. Cost explodes with crowding (collision candidates per projectile), not with entity count alone.

Grid cell size (`createGame({ cellSize })`, bench `--cell=`) was swept at 16/32/64/128 on the same machine under load. 32 is the default: converge at 20k went from 75-117 ms to 42-48 ms, sparse was equal or better, dense was unchanged (~50 ms) because its cost is the overlap count itself. 16 and 128 were worse. Repeat runs varied by ±40% under load, so only the converge gain is a clear signal.

Browser results (Chrome, real window, plain JS modules served unbundled before the migration, GPU = AMD Radeon 780M iGPU via ANGLE/D3D11, ~46% CPU load from stray processes). Median rAF interval over ~10 s; sim and draw are the HUD's CPU-side EMAs per step / per frame:

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
`src/render/webgl.ts`: WebGL2 instanced circles (one draw call, one pass over the world), HUD on a separate 2D canvas. Default when WebGL2 is available; falls back to Canvas2D. Reproduce with `bun run bench:render` (`scripts/render-bench.ts`: runs `vite build` if `dist/` is missing or older than its inputs (`src/`, `assets/`, `index.html`, `vite.config.ts`, `package.json`, `bun.lock`), serves it with `vite preview` on a free port, and starts a throwaway Chrome, stopping both and deleting the Chrome profile when done; `--shot=dir` saves screenshots). `--mode=background` (default) opens the window off-screen with Chrome's occlusion and backgrounding throttling disabled, so the run neither takes window focus nor slows when other windows cover it; `--mode=headed` is the old visible window, `--mode=headless` has no window. On the same loaded machine the three agree at 5k; at 20k the run-to-run spread from other processes' load (CPU 60-100%) was larger than any difference between modes. Chrome picks the iGPU (780M) by default here, as in the tables below; the discrete card is not selected, on purpose: the game targets low-end machines, so Chrome's default GPU is the baseline. `--force_high_performance_gpu` makes Chrome use the discrete card (`powerPreference` in `getContext` does not on Windows).

Median frame ms (p95), plain JS modules served unbundled (before the migration), same machine and load as above (iGPU 780M, ~46% CPU busy):

| scenario | N | Canvas2D | WebGL |
|---|---|---|---|
| dense | 5k | 34.7 (51.5) | 16.7 (17.8) |
| dense | 10k | 69.2 (104) | 16.8 (43.6) |
| dense | 20k | 250 (406) | 241 (449) |
| converge | 5k | 39.8 (52.8) | 16.7 (17.6) |
| converge | 10k | 73.1 (105) | 16.9 (84.5) |
| converge | 20k | 393 (466) | 169 (239) |

New baseline: **Vite build, minified, Chrome 154, AMD Radeon 780M iGPU (ANGLE D3D11), 2026-10-03, CPU load ~93-98% from other sessions, Defender off** (`bun run bench:render`, default matrix, `--mode=background`, one run, BelowNormal; another session's render loop shared both GPUs, so contended). Median frame ms (p95):

| scenario | N | Canvas2D | WebGL |
|---|---|---|---|
| dense | 1k | 17.6 (20.4) | 16.7 (17.7) |
| dense | 5k | 59.2 (68.0) | 16.7 (19.3) |
| dense | 10k | 107.5 (121.1) | 16.6 (21.2) |
| dense | 20k | 196.3 (227.0) | 186.0 (202.7) |
| converge | 1k | 16.7 (18.3) | 16.7 (17.4) |
| converge | 5k | 57.8 (66.7) | 16.7 (18.6) |
| converge | 10k | 108.8 (126.2) | 16.6 (19.1) |
| converge | 20k | 234.1 (267.1) | 209.2 (226.4) |

This measures the minified bundle under much heavier load, so it is not comparable with the unbundled table above; it is the reference for later runs of the bundle.

WebGL draw CPU time is ~0.5 ms at every N, so rendering no longer limits frame time. At 20k the frame time is about 4-5 sim steps (the stepper's catch-up cap) at 37-46 ms each: the sim's collision cost under 900x600 crowding is the remaining limit. Spikes at 10k converge (p95 84 ms) come from the same sim cost as chasers pile up.

## Collision search radius (plan 2c)
The candidate search used a fixed boss-sized radius (36) for every projectile; it now uses `grid.maxRadius`, the largest radius among the enemies of the current tick (boss rooms still pay for the boss). Sim median ms per tick at 20k, two alternating before/after runs on the same loaded machine (Node/V8, `node scripts/bench-sim.ts`, before the migration):

| scenario | before | after |
|---|---|---|
| dense | 46 / 41 | 15 / 23 |
| converge | 88 / 52 | 21 / 33 |
| sparse | 6.2 / 4.7 | 2.7 / 4.6 |

Cell size re-swept at the new radius (16/32/64): 32 stays the default (64 is ~2x worse in dense and converge; 16 is similar in the crowded cases and worse when sparse). Run-to-run noise is about ±40% under the current machine load.
