# Downstream — a diffuse pollution game

A third-person browser game in which you walk a procedurally generated catchment
and repair it: plant riparian trees, dig attenuation ponds, and build leaky
wooden dams. The risk map you work from is not decorative — it is **SCIMAP**,
running live on the generated topography, re-solving every time you place
something.

Play: `?seed=20260809` loads a specific catchment; the same seed always rebuilds
the same world. `?size=small|medium|large` picks how big a catchment to
generate (defaults to medium, the shipped 1024 m grid).

## Controls

| | |
|---|---|
| `WASD` | walk (`Shift` to run), drag to orbit the camera |
| `1` `2` `3` | plant / leaky dam / pond |
| `F` | build at the cell you are facing |
| `E` | gather wood, stone or the spade |
| `M` / `N` | cycle the risk overlay / turn it off |
| `Tab` | open the catchment overview map |
| `R` | run a 1-in-30 design storm |
| `Z` | undo the last feature |
| `K` | save, and copy a share link |

## Running it

```
npm install
npm run dev        # local dev server
npm test           # unit and parity tests
npm run typecheck
npm run lint:hotpath
npm run build
```

Two extra harnesses, run explicitly rather than in CI:

```
npx vitest run tools/preview.test.ts   # renders terrain and risk layers to PNG
npx vitest run tools/bench.test.ts     # times the recompute tiers
node tools/shot.mjs --keys "ffm"       # screenshots the running game
```

`tools/shot.mjs` drives the locally installed Chrome through `playwright-core`.
It exists because the render layer cannot be checked against arrays: an inverted
curvature shader or an overlay that replaces the terrain instead of tinting it
both typecheck perfectly and are obvious in a picture.

## How it fits together

```
core/     seeded rng, typed-array grids, radix sort, percentile stretching
terrain/  seed -> ridged fBm -> droplet erosion -> talus -> smoothing
scimap/   fill, slope, FD8, D8, TWI, Network Index, erosion, source risk
sim/      Gumbel storm depths, lag-and-route flood model
worker/   owns the canonical arrays; the main thread never sees them
render/   one terrain mesh, instanced props, toon + curved-world shaders
game/     interventions, validity, scoring, receptors, save
```

The simulation runs in one Web Worker. The main thread keeps copies of only the
layers placement validation needs every frame (elevation, slope, curvature,
contributing area, channel mask, land cover); everything else stays in the
worker and crosses as transferred buffers.

## The model

Transcribed from the reference SCIMAP implementation, with the formulas kept
verbatim where they are specified — the TWI expression and its two epsilon
guards, the Network Index recurrence, FD8 with exponent 2.0, the 5th/95th
percentile stretch.

Three departures are deliberate, and each is argued at its call site:

1. **The Network Index is solved by a single elevation-ordered sweep** rather
   than pointer doubling. Steepest descent uses a strict `>` from `bestGrad = 0`,
   so the successor graph is an acyclic forest and elevation order *is* a
   topological order. Checked against a brute-force walk on 1000 random graphs
   and against a port of the reference solver on real terrain.
2. **In-channel risk is flow-accumulated.** In the reference, `catchmentArea`
   cancels and source risk is never integrated upslope, leaving a local quantity.
   A game where upstream action changes downstream water needs the intended form:
   routed source risk over routed rainfall-weighted area.
3. **Stretch bounds are frozen at t = 0.** SCIMAP is a relative product, so
   re-deriving the percentile stretch after every placement makes improving the
   worst field stretch everything else upward — the map barely moves and
   untouched cells appear to worsen. The endpoints are derived once from the
   pristine catchment and persisted with the save.

`src/scimap/constants.ts` records which land-cover weight table is in use and
why, including the one counter-intuitive consequence: woodland (0.2) is more
erodible than extensive grassland (0.15), so planting rough grazing makes
modelled erosion slightly worse. The game allows it and says so rather than
blocking it.

## Determinism

A save is a seed, a landscape size and an ordered list of interventions — a few
hundred bytes, small enough to be a URL. That only works because generation is exactly
reproducible, so every random draw goes through `splitSeed(seed, tag)` in
`core/rng.ts`. `npm run lint:hotpath` fails the build on `Math.random()` anywhere
else, and on comparator sorts in the compute path.

## Deploying

`npm run build` emits to `dist/`, and `.github/workflows/deploy.yml` publishes it
to GitHub Pages on a push to `main`. `base` in `vite.config.ts` must match the
repository subpath — a missing `base` breaks every asset, most visibly the module
worker, which 404s and leaves the game on the loading screen with nothing useful
in the console.
