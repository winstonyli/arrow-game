# arrow-game

Browser archer roguelite (Archero / arrow.io style). Plain JS, typed-array simulation.

- Run: `npm start` then open http://localhost:8000
- Test: `npm test`
- Design: `docs/superpowers/specs/2026-10-02-arrow-game-design.md`
- Plan: `docs/superpowers/plans/2026-10-02-arrow-game-core-and-rooms.md`

## Status
Plan 1 (core + rooms mode) implemented; playable at `npm start`. Gameplay feel not yet tuned.
Plan 2 benchmarks done (see below); WebGL decision pending. Next: plan 3 (arena mode + camera).

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
