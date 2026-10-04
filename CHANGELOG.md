# Changelog

Versioning and what counts as a release: see "Versioning and commits" in the README. Each entry names the
`SIM_VERSION` and `REPLAY_VERSION` it ships with.

## v0.1.0
`SIM_VERSION` 2, `REPLAY_VERSION` 1. First tagged release; unstable (0.x), nothing is promised to stay compatible.

- Core sim: typed-array world, fixed 60 Hz tick, spatial-grid collisions, Rooms and Arena modes, skills and level-ups.
- Renderers: WebGL2 instanced circles (default) with a Canvas2D fallback; DOM UI (title, HUD, pause, skill picker, game over) and personal bests.
- Replays and challenges: seeded runs, replay recording, ghost race, watch viewer, Challenges screen with daily and custom seeds, share codes, import, replay store.
- Gems are captured into a damped orbit around the player (`SIM_VERSION` 2).
- Movement trails: tails bend through each mover's real path (per-tick position history, drawn as a smooth curve); player and blades use the same tail.
- `scripts/render-bench.mjs --mode=background|headed|headless`: the benchmark no longer needs a focused window.
