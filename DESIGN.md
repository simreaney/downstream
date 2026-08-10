# Design notes and decision record

Everything in this file came out of building the game rather than planning it.
It records the decisions that were made, the reasoning behind them, and — more
usefully — the things that turned out to be wrong. Several of the bugs below
produced perfectly plausible output while being completely wrong, which is the
failure mode this project is most exposed to, so they are written up in full.

`README.md` covers how to run it. This is the why.

---

## 1. Decisions taken at the outset

| Question | Decision | Reasoning |
|---|---|---|
| Intervention mechanism | Trees rewrite the land-cover weight; ponds and dams clamp TWI down | The Network Index is a *minimum* along the flow path, so lowering one cell's wetness caps the index for everything upslope of it — exactly, for one array write |
| Risk map visibility | Toggleable overlay, always available on `M` | The teaching value is the point; the player sees the map change the instant they plant |
| Scoring | Three sub-scores plus a village and fishery that visibly react | The three tools act on different processes; one number would hide that |
| Code reuse | Reimplemented game-tuned, using `scimap-app` as reference | Optimised for a small grid and incremental updates; formulas lifted verbatim |
| Terrain | Ridged fBm → droplet erosion → talus → smoothing | Plain fBm has no organised drainage, so SCIMAP on it is diffuse mush |
| Scale | 256 × 256 at 4 m = 1 km² | Full recompute inside a frame budget, so the overlay updates live |
| Art | Fully procedural, every prop behind a factory | No binary assets; GLTF can replace any single factory later |
| Land-cover weights | `config.yaml` defaults throughout | Two separately named tables: erodibility and runoff generation |
| Normalisation | 5/95 stretch bounds frozen at t = 0 | See §3.3 — the game does not work otherwise |
| Ponds | Offline; never enter the routing DEM | Sidesteps the fill-exemption problem; the honest model of an offline feature |

Later, in response to play:

- **Storms arrive on a schedule *and* on demand.** They answer different
  questions. `R` runs a *named design event* — "show me the 1-in-30" — which is a
  test against a stated standard and must be deterministic, or half the time the
  button delivers drizzle and teaches only that it is unreliable. Scheduled
  weather samples the same Gumbel instead, so most events are modest and the
  occasional large one arrives unasked. Both end up as a depth, which is what
  crosses the worker boundary.
- **Land use may be changed in any direction.** Including directions the model
  scores *worse*. The ghost turns amber and the readout says which way the source
  term will move, and then the player decides. Blocking it would substitute the
  game's judgement for the player's, which is precisely what the risk map exists
  to avoid.

---

## 2. Architecture

```
core/     seeded rng, typed-array grids, radix sort, percentile stretching
terrain/  seed -> ridged fBm -> droplet erosion -> talus -> smoothing
scimap/   fill, slope, FD8, D8, TWI, Network Index, erosion, source risk
sim/      Gumbel storm depths, lag-and-route flood model
worker/   owns the canonical arrays; the main thread never sees them
render/   one terrain mesh, instanced props, toon + curved-world shaders
game/     interventions, validity, scoring, receptors, save
```

**One worker.** Terrain generation, SCIMAP and storm routing never run
concurrently — the player is either generating, placing, or watching a storm — so
a second worker would buy no parallelism while doubling the question of who owns
the canonical arrays.

**No SharedArrayBuffer.** GitHub Pages cannot send COOP/COEP headers. The
payloads are small enough not to need it; every `ArrayBuffer` crosses in a
transfer list, so a message is a move rather than a copy.

**The main thread keeps six layers** — elevation, slope, curvature, contributing
area, channel mask, land cover — because `validity.ts` has to answer "can I build
here?" every frame while the ghost follows the player, and a worker round trip
per frame would make the ghost lag the character.

---

## 3. Deliberate divergences from the reference SCIMAP

Each of these is argued at its call site in the code. They are listed here so
they are visible in one place rather than only discoverable by reading.

### 3.1 The Network Index is solved by a single sweep

The reference solves the min-along-flow-path recurrence by **pointer doubling**,
which converges in `log(path length)` rounds of full-grid work — the right shape
for a vectorised NumPy kernel.

Here it is unnecessary. `connectivity.ts:105` computes steepest descent with
`bestGrad = 0` and a **strict** `>`, so every successor is strictly lower than
its predecessor. The successor graph is therefore an acyclic forest, and
elevation order *is* a topological order of it. Walking cells from lowest to
highest makes `f(d(x))` final before `f(x)` is computed, so the whole recurrence
resolves in one linear pass — no iteration, no convergence check, no cycle
handling.

**Measured: ~0.5 ms against ~40 ms** for seventeen rounds of pointer doubling
with its three array copies apiece. That is the difference between the overlay
updating as the player places a feature and updating a noticeable beat later.

Verified three ways: against a brute-force walk of the recurrence on 1000 random
flow graphs, against a direct port of the reference solver on real terrain, and
for the structural property that a break caps everything upslope of it.

### 3.2 In-channel risk is flow-accumulated

The reference (`combine.ts:80-87`) computes

```
riskConcentration[i] = (sourceRisk[i] * catchmentArea[i])
                     / (catchmentArea[i] * rainfallScaled[i] + tiny)
```

in which `catchmentArea` cancels algebraically and `sourceRisk[i]` is the cell's
own **local** value, never integrated upslope. What comes out is
`sourceRisk[i] / rainfallScaled[i]` — a local quantity wearing the name of a
routed one. The author labels these outputs "proxies", so it is a known
simplification, and for a relative risk map it is defensible.

It cannot work here. The game's whole proposition is that action taken upstream
changes the water downstream. Under the local form, planting a field changes that
field's colour and nothing else, and the fishery never responds. So:

```
inChannel(x) = Σ_upslope(sourceRisk · cellArea) / Σ_upslope(cellArea · rainScaled)
```

Both sums are flow-accumulated through the *same* FD8 fractions, so the ratio is
a genuine flow-weighted mean bounded by that quantity's extremes over the
contributing area.

### 3.3 Stretch bounds are frozen at t = 0

SCIMAP is explicitly a **relative** risk product: it ranks locations against each
other within one catchment and claims nothing absolute. Re-deriving the 5/95
percentile stretch after every placement is therefore correct behaviour — and it
destroys the game.

Plant the worst arable field: its raw erosion collapses, but so does the grid's
95th percentile, so the span narrows and every *untouched* cell is rescaled
upward. The map barely changes, the score barely moves, and places the player has
never visited appear to have got worse. Everything behaves exactly as specified
and the game is unplayable.

So the endpoints are derived once from the pristine catchment and held fixed.
Improvement becomes absolute, a fully remediated catchment reads near zero
everywhere, and the legend means the same thing in every frame. `StretchBounds`
**must** be persisted with the save; re-deriving it on load from an already
improved catchment silently zeroes every score.

### 3.4 Channels come from D8 accumulation, not FD8

Thresholding **FD8** accumulation gave 8–10% of the catchment as "channel" —
wide, marshy blotches across the epsilon-filled valley floors, because FD8 fans
flow eight ways on near-flat ground. It also produced a *fragmented* network,
since FD8 area is not monotonic along a D8 path.

**D8** accumulation is monotonically non-decreasing along a D8 flow path by
construction, so thresholding it yields a connected tree running to the outlet
with no gaps to repair. Result: 2.4% channel cells and a crisp single-thread
river. FD8 still feeds TWI and erosion risk, exactly as SCIMAP specifies.

### 3.5 Priority-flood with epsilon, seeded from the outlet alone

The reference uses least-cost breaching (WhiteboxTools), which is not practical
to reproduce in pure TypeScript. Priority-flood is the accepted substitute — but
**only in its epsilon variant**, and this is the most dangerous failure mode in
the whole pipeline.

Plain priority-flood raises a depression to its spill elevation, producing a
genuinely flat plateau. Steepest descent then finds no strictly lower neighbour
anywhere on it, so every cell there gets successor `-1` and its flow path
terminates on the spot. The Network Index reports the minimum of a path of length
zero — its own TWI. The result is a connectivity map that is wrong across whole
valley floors *while looking entirely plausible*, because valley floors are
exactly where depressions occur.

`FILL_EPSILON = 1e-6 m` gives every cell a strictly lower predecessor by
construction. The assertion that zero interior cells have successor `-1` is in
the test suite permanently.

Seeding from the **outlet alone** (not the whole border) is what turns "the
conditioned surface ought to drain to the outlet" into "every cell provably has a
downhill path to it", which the score, the hydrograph and the fishery all assume.

### 3.6 Storm anchors are self-consistent

The first anchor set (18 / 32 / 55 mm at 10 / 30 / 100 days) was chosen for feel,
and the least-squares fit missed the middle one by 8%. That is not a bug in the
fit — it is the anchors not lying on a Gumbel at all. Replaced with 24 / 32 / 40
mm (μ = 8, β = 7), which reproduce to under 0.5 mm.

Separately, the reference `fitGumbel` in the earlier flood game fits through
anchors `[0]` and `[1]` and **ignores the third entirely**, so a carefully chosen
1-in-100 figure has no effect. This fits all anchors by least squares.

---

## 4. Bugs that produced plausible output

These are the ones worth remembering. Every one of them typechecked, ran, and
looked right.

### 4.1 Leaky dams changed the hydrograph by exactly nothing

`peakQ` identical to 17 significant digits between the run with dams and its
counterfactual, while producing a perfectly reasonable flood.

The router moves water one cell per step, so celerity is capped at
`cellSize / dt` — 0.067 m/s on a 4 m cell at a 60 s step. Fed real channel
velocities of 1–3 m/s, **every cell saturated at the maximum release fraction**,
and roughness had no way to express itself.

Velocities are now scaled to sit inside the scheme's own Courant limit, channels
near the top and hillslopes an order of magnitude below. What the model
represents faithfully is the *relative* effect of roughness, storage and land
cover — which is what the player manipulates — rather than absolute travel times.

### 4.2 The river rendered in murky grey

Chased as a colour bug for three iterations. Forcing the fragment output to pure
red revealed it came out *dark* red — so the shader was fine and the lighting was
not.

Triangle winding was inverted. Because the water material is double-sided, this
did **not** produce an invisible mesh (which would have been obvious); three
flips the normal per fragment, so the water was shaded by the hemisphere light's
*ground* colour. A correct river, rendered in mud.

Both the winding and the risk-to-vertex index mapping are now pinned by test.

### 4.3 ACES tone mapping was wrong for this art style

It is a filmic curve built to roll photographic highlights off gracefully, and it
does that by **desaturating as values rise** — the opposite of what flat toon
colour needs. It washed the fields pale and greyed the water. Removed, with the
lights rebalanced so lit surfaces land just under 1.0 rather than clipping.

### 4.4 Land cover was static, not fields — twice

Comparing per-cell noise against per-cell suitability speckles wherever the two
are close. Fixing the random draw per parcel but leaving suitability per-cell was
no better: the boundary became a contour of a *noisy slope field*, so fields grew
fractal fingers and **31.9% of cells differed from their neighbour**.

Deciding whole parcels from their mean slope and elevation — which is what a
farmer actually does — brought it to **7.7%**, with boundaries falling on hedge
lines rather than slope contours.

### 4.5 Relief was absolute, so tests exercised terrain the game never generates

Fixed at 180 m regardless of catchment width, a 1 km grid was an 18% pastoral
catchment and a 384 m test grid was 47% alpine. The test suite was reporting 65%
relict woodland on slopes too steep to farm. Relief is now a **ratio of catchment
width** (0.175).

### 4.6 Zero wood nodes, everything else working

Resource siting used a 25° slope filter; relict woodland only exists above 26°.
Two independent numbers that happened to exclude each other, producing a
catchment with stone and a spade and no wood at all. Now tied to the player
controller's own `MAX_WALK_SLOPE_DEG`, since "can I reach it" has exactly one
correct answer.

### 4.7 Hoisting made the function available but not its bindings

A `function` declaration was used to avoid reordering declarations. It compiled,
built, and hung the game on the loading screen with `Cannot access 'w' before
initialization`: hoisting makes the *function* available early and leaves its
captured `const`s in the temporal dead zone. Declaration order was the fix.

Found only because the screenshot harness prints page errors as they arrive — a
page that never boots never reaches an end-of-run summary.

---

## 5. Things that behaved correctly and looked like bugs

- **A riparian band one row short of the channel scores zero.** The model is
  right; the test fixture was wrong. This is exactly the mistake a player will
  make, and the reason continuity is scored the way it is.
- **A pond on the wettest cell does almost nothing.** The Network Index is a
  minimum, so lowering a value that was never the minimum changes nothing, and
  the cell is clipped to the top of the ramp both before and after. Ponds bite
  where their capacity is a large fraction of the area routing through them.
  Measured across all legal sites: the best cuts mean source risk by 5.9%, and
  about 15% of sites do nothing at all. That spread *is* the gameplay.
- **The Gumbel fit does not pass exactly through its anchors.** A least-squares
  line through three non-collinear points balances residuals; it should not
  interpolate. See §3.6.

---

## 6. Measured performance

At 256 × 256 (65,536 cells), on the development machine:

```
cold generation (seed to layers)     933 ms
tier A recompute (plant a tree)      9.3 ms
tier B recompute (pond, 1 feature)  10.3 ms
tier B recompute (60 features)      10.3 ms   ← flat
```

Flat from 1 to 60 features confirms the TWI-clamp mechanism really is O(1) per
intervention: the connectivity break is an array write ahead of a linear sweep,
so the cost is the grid, not the feature count. Three times under the 30 ms
budget, which is why the overlay updates live.

Guarded by `npm run lint:hotpath`, which fails the build on comparator sorts
under `scimap/` and `terrain/` — a `.sort()` of 65k floats costs ~15 ms on its
own, the entire budget.

---

## 7. Determinism

A save is a **seed plus an ordered list of interventions** and nothing else — a
few hundred bytes, small enough to be a URL. Terrain, land cover, resource nodes,
settlements and every risk layer are re-derived; state is re-derived by replaying
the list. There is no way for the save and the world to disagree.

That only works because generation is exactly reproducible, so every random draw
goes through `splitSeed(seed, tag)`. The same lint rule fails the build on
`Math.random()` anywhere outside `core/rng.ts` and `audio/` — the rule protects
the save file, and sound is not in it.

Scheduled weather is seeded the same way, so a reloaded save gets the same
storms and the score continues to compare like with like.

---

## 8. Open questions

- **Woodland (0.2) is more erodible than extensive grassland (0.15)** in the
  chosen weight table, so planting rough grazing makes the modelled source term
  slightly worse. This is now reported rather than judged, and permitted in
  either direction. Whether the table itself should be revisited is a science
  question, not a game one.
- **Storm playback is precomputed**, not streamed. Streaming would hold the
  worker for the whole event and block the recompute the player triggers the
  moment they see where the water went. If storms ever need to be interactive
  mid-event, that trade reverses.
- **`cfg.pondsAlterDem` exists but is unused.** `fill.ts` already takes a `sinks`
  mask, so the alternative model — ponds burned into the routing DEM, with
  re-routing and spill — can be switched on without restructuring.
