<!-- created by AI -->
# Wanderoad — backlog

The source of truth for what to do next. The improvement cron reads this at the top of every
pass and updates it at the bottom. Ordered by value, not by ease.

**The filter for every item: this is a COZY driving game.** Calm, unhurried, pretty. If a
change makes it faster, louder or more stressful, it is the wrong change even if it is
technically better.

---

## Now — the failing requirements, worst first

- [ ] **BLOCKING — startup frame rate regressed on the LIVE build.** `npm run test:live` reports
      **22.8 / 23.8 / 22.9 fps** across three consecutive runs at the "running at a playable rate
      once warm" check (bar is 24), where it was 40/40 green before the second playtest round.
      Reproducible, not variance.

      **What is and is not affected, measured:** the very next check, "still running at a playable
      rate after driving", passes at **58–60 fps** in every one of those same runs. So steady
      state is fine and the world settles — this is specifically a STARTUP burst cost in the first
      seconds after load.

      **Why localhost hid it:** `npm run test:browser` against localhost passes 40/40. The warm
      check samples 4 s after the world reports streamed (browser-test.mjs ~line 474); localhost
      serves the bundle fast enough that the initial build burst is over by then, and the live
      host does not. Any future perf work has to be judged against `test:live`, not localhost —
      localhost is not a valid gate for this particular check.

      **Prime suspects, all landed in the same round and all doing work at spawn:** station access
      spurs and their junction geometry, the station "town" set-dressing clusters, ships on large
      water, snow-dusted pine variants, flowers, and the higher tree/scatter build-ahead radius
      from the pop-in fix. Each is individually modest; the burst is presumably their sum. The
      honest first step is to MEASURE which one dominates (build time per subsystem during the
      first seconds) rather than tuning them all down blindly — this project has a documented
      history of "obvious" perf and terrain fixes that measured worse afterwards.

      Not shipped as a regression knowingly: the round was already deployed when the live figure
      came back, and the game is playable throughout (23 fps briefly, then 60). Recorded here as
      the top item rather than left to be rediscovered.

- [ ] **Valley mist is written and reverted — it fails GPU program validation.** The operator
      asked for the original scene's valley mist. It was implemented (analytic exponential-density
      integral inside `aerial()`, a `uMist` uniform in GL_UNI, a matching horizon band in
      `skyDome`/`skyDomeLite`, and its own `mstHash`/`mstNoise` in GL_LIGHT) and it broke the
      renderer completely: **every** RawShaderMaterial failed with
      `THREE.WebGLProgram: Shader Error 1282 - VALIDATE_STATUS false` and the game rendered black.
      Reverted; the working tree shipped green at 40/40 without it.

      **The lesson worth keeping:** it passed every static check its author ran — bracket balance,
      symbol resolution across all eleven real chunk combinations, the GL_LIGHT-without-hash case
      specifically. It failed at GPU VALIDATION, which no node-side check can see. Shader work
      must be gated on `npm run test:browser`, never on static analysis alone.

      The reverted implementation is preserved at `D:\OpenClaw\tmp\glsl.mist.bak` and
      `D:\OpenClaw\tmp\uniforms.mist.bak`. Suspects not yet distinguished: a SwiftShader
      instruction/complexity limit (the suite runs headless software GL), a uniform-count limit
      from adding to GL_UNI which every shader includes, or the GL_LIGHT/cloud-material
      interaction. A focused pass is underway.

**Budget note (26 July 2026):** the project wraps on the 28th and at least half the week's
usage stays unspent. One small item per pass, no research, no subagents, no refactors. A
recorded finding is a complete pass.

**Then, from the measured requirements suite:**

- [x] **W4 — the land has shape now, and W5 — there is somewhere to go.** Relief in a 720 m
      square at the real spawn: meadow 15.6 -> **27.5**, rolling 36.6 -> **77.0**, alpine
      47.4 -> **95.2**, plains 7.2 -> **13.8**, dunes 27.9 -> **34.3**, marsh 33.3 -> **33.7**.
      Best rise within 4 km that is genuinely VISIBLE from the driver's seat (line of sight
      checked against the ground between): 30 m -> **410 m** on the default preset, 660 m on
      alpine, and over 200 m on every preset. `node tools/diag-relief.mjs`.

      The reverted attempt's diagnosis was right and its prescription was not. Relief inside a
      window is set by the BASE octave (`0.72·L·amp/wave`); slope is set by the SUM over every
      octave (`K·amp/wave·Σ(gain·lac)ⁱ`). At gain 0.5 against lacunarity 2.0 that sum is 1.0
      per octave, so six octaves cost six times the base slope for about 15% more height, and
      scaling the stack scales the useless part hardest. So the stack was RESHAPED, not scaled:
      gain 0.26–0.30 against lacunarity 2.2–2.3 drops the octave sum from ~5.2 to ~2.4 and
      leaves the base octave carrying the height alone. That buys a 3–4x amplitude at the same
      total gradient. Everything above 2 km is a new layer, `src/world/landmarks.js`: a lattice
      of smooth domes whose radius is TIED to their height, so the steepest face is a closed
      form (1.54·h/r ≈ 12–14°) rather than something you hope about. Presets get a `peak` knob
      for it separately from `amp`.

      Two things found on the way that were nothing to do with amplitude:

      **The `W_CULL` biome cull was a hard threshold**, so crossing the 2% weight contour of any
      biome dropped `0.02 × that biome's relief` from the sum between one sample and the next.
      Harmless at 178 m of highland, a multi-metre vertical wall at 205 m drawn along the 2%
      contour of every biome in the world — it was 0.89% of ground over 45°, and all twelve of
      the steepest points in the world. Now fades in over a band and the sum is renormalised by
      the weight actually used.

      **The embankment batter was clamping the wrong number.** Every sample over 45° anywhere,
      at any preset, is a road embankment — the raw land has ZERO, measured. 181 of 199 were
      fill standing 20–33 m above the ground beside it. Capping the drop the shoulder width is
      derived from is exactly backwards: deep fills need the WIDEST shoulder. Uncapped at 1.6
      (the ratio RoadField.carve already uses for its own mask) gives 69 samples over 45°;
      capped at 22 m gives 130; the 1.5 that was there gives 80. Also tried a straight batter
      with eased ends — peak gradient 1.25x instead of smoothstep's 1.5x — and it is worse
      (158), because concentrating the steepness into a thin stripe is what minimises the AREA
      of unclimbable ground.

      Also: **findSpawn was scoring gradient linearly**, so the spawn was always the single
      flattest arterial sample within 3 km — the one billiard table in a world of hills, which
      is the pocket every relief measurement and every player was reading. Now saturating:
      below 4.5% nothing to choose between candidates, above 13% rejected, distance decides.

      Cliffs **0.027% -> 0.019%** (`node tools/diag-cliffs.mjs`, 69 of 360,000; the tail is
      better too — 70–80° went 25 samples to 1). 0 underwater road samples. `npm test` 15/15.
      Reachability from the worker asserted in the tool (per-preset chunk heights differ and
      repeat byte-identical). Not measured: the browser suite, which the orchestrator runs.
- [x] **R5 — the roads curve now.** 100 deg of turn per km measured the way browser-test.mjs
      measures it, and **230** after; 103 to **252** over a 12 km square, and the worst of eight
      different seeds is 207. The nodes were left exactly where they were — the earlier reverted
      attempt moved them and made the cliffs worse — and the bends are a lateral offset laid over
      each hermite, built from a CURVATURE profile rather than an amplitude. Turn per km is the
      mean curvature while the thing you have to clamp is the peak, so a sum of sinusoids
      saturates: tripling its amplitude bought 187 -> 212 deg/km and no more. A soft square wave
      integrated twice holds a radius through a bend instead, and every edge is normalised to the
      tier's tightest radius. Same terrain code both sides: cliffs 0.115% -> **0.036%** over 45
      degrees (finer road sampling means less earthwork, so this got BETTER), 0 underwater road
      samples, chunk build 1.30x total and 1.41x worst level, and the autopilot still holds the
      carriageway 100% of the time and stays above the streak's 8 m/s for 99% of it. The tightest
      turn anywhere in 460 km of road went from a 6 m radius to 42 m. `node tools/diag-curve.mjs`.
- [x] **T2 — the car looks washed out.** Was peak saturation 0.11–0.30; now **0.50–0.67** on
      every paint chip, every heading, and 0.51+ under full cloud shadow. `node
      tools/diag-carpaint.mjs` (walks a body fragment through the painted shader, the tonemap
      and the grade and prints the number the browser suite reads; it reproduces the old
      0.21–0.31 on the old code, which is what says the model is honest).
      The colour really was not being added: `car/loadedCar.js` fed the shader
      `parseInt(hex,16)/255` — a raw sRGB byte handed to a linear pipeline — so persimmon
      arrived as (0.784, 0.314, 0.247) where the palette says (0.293, 0.007, 0.004), its two
      dark channels 44x and 63x too strong. Now it takes the same `core/palette.js` values as
      every other painted object, plus a new `MAT.BODY` slot for coach paint (MATTE mixed flat
      sky into its mid band and flat shadow tint into its shade band until every dark car came
      out the same blue). Nothing outside the car changed: slots 0–6 dispatch identically and
      `render/post.js` was not touched.
      **Finding, not fixed, not mine:** `core/palette.js` converts every colour TWICE —
      three r152+ has `ColorManagement` on by default, so `new Color(hex)` is already linear
      and the `.convertSRGBToLinear()` on top of it darkens the whole palette (`#C8503F` ships
      as 0.293 where the hex means 0.578). The game is internally consistent about it and the
      tonemap's big shadow lift hides it, so it must NOT be "fixed" casually — it would
      re-grade every surface in the game at once.
- [x] **O1 — off-road is now judged per wheel.** Each of the four suspension probes queries
      the road surface where it actually stands. Measured 3.36 m off the centreline: front-left
      on grass (onRoad 0.01), front-right still on tarmac (onRoad 1.00) — clipping a verge with
      two wheels now reads as what it is. `node tools/diag-body.mjs`.
- [x] **W1 — trees do not stop you.** Now a dead stop: 126.7 / 157.1 / 181.4 km/h all become
      **0.00 km/h** on a square hit, at rest 1.58 m out from a trunk whose contact distance is
      1.55 m. The narrow phase is SWEPT, so nothing tunnels — caught at every frame time up to
      dt 0.1 and every step length up to 40 m. Colliders are now measured against the DRAWN
      trunk (`TRUNK_R` in `game/collide.js`, checked by `node tools/diag-collide.mjs`) and
      centred on the renderer's own instance root, error 0.00e+0 m in x, y and z. The rock and
      fence-post colliders are gone: **nothing draws `scatter.rocks`, `.posts` or `.reeds`**, so
      those were invisible walls — 26 per hectare of highland, up to 2.4 m across. A graze still
      slides (keeps 94% of its speed). `node tools/bench-impact.mjs`.
- [x] **W7 — water is a trap.** `game/rescue.js`. Touch the water and you are put back on the
      road **0.60 s** later (0.25 s to arm, 0.35 s of the car settling), **0.65 s** from the
      very first drop, and driving again at **1.13 s**, via main.js's own `backToRoad()`.
      Gated on CONTACT depth (0.25 m — water onto the rim, tyres being 0.34 m in radius) and on
      being off the carriageway, so it still cannot fight you: 60 s pottering in 0.14 m of
      shallows, 60 s of lakeside road with deep water 9 m off, twelve 0.2 s ford/shoreline dips
      and 60 s parked in 0.14 m of beach wash all give **0 rescues**.
      `node tools/bench-rescue.mjs`. A better-looking water treatment is still open.

      **Revised 2026-07-27 — "Water = respawn (R) on contact not float under" (the operator).**
      It used to be 0.6 m held for 1 s plus 1 s of settling: **2.13 s** of wallowing, by which
      time the car had sunk to **6.80 m**. Now 0.25 m / 0.25 s / 0.35 s: **0.65 s**, deepest
      **2.39 m** — measured A/B against the same terrain in one process, since the constructor
      takes `contact`/`hold`/`lift` as options. The one deliberate behaviour flip: the old
      "twelve 0.9 s dips → 0 rescues" case now gives **3 rescues**, because a 0.9 s submersion
      is not a dip, it is the floating-under being fixed. The dip test now runs at the new
      arming scale (0.2 s in, 0.2 s out → 0) so fords and clipped shorelines still pass through
      untouched. Not gated on `d > 0` literally: the wash at the dunes shoreline (668, -439) is
      0.14 m and peaks at 0.18 m, and yanking the car off a beach for standing in the surf
      would break the never-fight-you rule the same brief also asked to preserve.
- [x] **W8 — findSpawn (and R / the rescue) could hand back a point in water.** The operator,
      verbatim: "its a buggy mess still starting on water". `findSpawn()` scored candidates on
      grade and distance only — no water check anywhere, including its own last-resort
      fallback, which returned the hint point completely unvalidated whenever no tier-0
      arterial was found nearby.

      Root cause, confirmed by direct measurement rather than assumed: a road CUTTING can duck
      below the local water table while the raw land at that exact point stays dry. A road's
      height is smoothed over a ~200 m window and clamped to at most 18 m of cut (see
      MAX_EARTHWORK), so a stretch heading down into a valley can sit well below the ground
      immediately beside it — but `profileEdge()`'s own water floor (and diag-water.mjs's
      check, which uses the identical function) both gate on RAW LAND, never on the road's own
      smoothed-and-clamped height. Measured on the seeded world: a real tier-0 sample sat
      **2.25 m under** its local water table while the raw land right there was 8.1 m clear —
      dry by every check that existed, 2.25 m underwater by the one that matters.

      `findSpawn()` now checks `Terrain.height()` (the ACTUAL drivable ground) against the
      water table directly — `waterMargin()`/`isDrySpot()` in `world/terrain.js`, built on
      `waterLevelAt()` rather than a second formula — in both the per-candidate loop and a new
      ring-search fallback (`findDrySpot`, widens outward rather than ever returning an
      unchecked point, out to ~10 km before giving up and returning the driest point it
      actually measured). `backToRoad()` — R and the water rescue both go through it, see
      `rescue.js`'s own comments on `recover` — now checks its road-query result the same way
      before trusting it (`isDryAt`), falling back to the same `findSpawn()` rather than a
      second, independently-written search. `rescue.js` itself needed no change: `_place()`
      delegates 100% of positioning to `recover()` and only ever re-touches the heading at the
      (x, z) `recover()` already chose.

      Measured, not assumed: 30 real seeds, car placed at the worst real point the road
      network itself produces (the exact shape of "drive near a cutting, press R" — 23/30
      seeds have one within 0.5 m of water) — before, landed in or within 0.5 m of water
      **19 times (63%)**, 8 of those genuinely underwater up to 2.20 m; the plain boot spawn
      (hint 0,0) was cleaner but not immune, 1/200 seeds. After: **0/30 on every path** —
      findSpawn's main loop, the forced fallback, and the backToRoad replica alike.
      `node tools/diag-spawn-water.mjs`. R2 stayed 0/7, diag-water.mjs stayed 0 underwater,
      diag-cliffs.mjs stayed at 0.002% (better than the 0.019% baseline — untouched by this
      fix), `npm test` and `bench-rescue.mjs` (its `recover()` stub now kept in sync with the
      real `backToRoad()`) stayed green. None of those exercise this path, which is exactly
      why it went unnoticed until measured directly.
- [x] **G1 — the streak now reads at a glance.** A bottom unlock-progress bar shows the next
      car and the distance left, lit while a streak is running, with a red blip on a break.
      21/21 checks in `node tools/diag-hud.mjs`, driven against the real Hud and Streak classes.
- [x] **G6 — multiplayer, proven for the first time.** See the Done entry below — `?seat=2` was
      wired but never actually called, so it did nothing until this pass.
- [x] **C6 — body pitch now follows the real surface**, not the spring/roll layer alone,
      so the nose stops pointing into the hill on a climb.
- [x] **O4 — rollover, with recovery.** Off-road, at speed, into a bank, the car can now go
      over past 90° and rights itself afterwards rather than getting stuck upside down.
      O1/C6/O4 landed together in `src/car/vehicle.js`; `node tools/bench-car.mjs` stayed at
      15/15 throughout (byte-identical to the pre-change baseline) and `node tools/diag-body.mjs`
      is the new evidence for all three. Not wired into `npm test` — it is a slower scripted
      drive, not a fast gate; run it by hand after touching vehicle.js.

## Next

Newly asked for, not yet started:

- [x] **Trees pop in just in front of you, and the cinematic cam shows grass popping out of
      existence behind the car.** Two playtest reports, two separate root causes, both
      measured rather than assumed — `world/scatter.js`, `render/trees.js`, `render/grass.js`.

      TREES. `tools/diag-treepop.mjs` drives a real car with the real `Autopilot` along the
      real road network, through a simulated worker pool timed against REAL `buildChunk()`/
      `scatterChunk()` calls, feeding the real `Flora`. In steady state (queue empty, not the
      cold-start burst — that resolves in ~17 s and was not the ongoing problem) trees were
      still attaching as close as **222–260 m ahead (~10.5 s from arrival at the project's own
      95 km/h cruise)**, hard and instant, no fade — because `SCATTER_MAX_LEVEL` (2) capped
      tree DATA at a ~870 m existence radius, silently undercutting `render/trees.js`'s own
      1400 m `DEFAULT_CULL` the whole time, and a level-2 node's own near edge can sit far
      closer to the car than the node's characteristic distance. Two-part fix: `SCATTER_MAX_LEVEL`
      2 -> **3** (existence radius -> ~1740 m, past the 1400 m cull at last) measurably widens
      typical lead time — steady-state median pop-in 1117.6 -> **1210.9 m**, mean 1017.7 ->
      **1143.2 m**, p10 554.2 -> **638.5 m** — but the worst-case close attach barely moves
      (227.9 -> 227.5 m), because that mechanism recurs at any LOD boundary. So every attach
      now grows in from a 5% seedling to full size over 1.5 s, anchored at its own root (reuses
      the existing per-instance scale channel, zero shader changes). Verified as real geometry,
      not just code that runs: `tools/diag-treegrow.mjs` samples a live instance's actual GPU
      attribute float every frame — 5.1% -> 100% of target, monotonic, landing exactly on
      schedule. Frame cost: `Flora.update()` mean +0.019 ms/frame (0.048 -> 0.067 ms), worst
      frame 4.29 -> 6.46 ms — both trivial against a 16.7 ms budget. Not fixed, flagged: a
      level-3 node's `scatterChunk()` costs ~36 ms, paid synchronously on the main thread in
      `main.js`'s `onChunk` (same pre-existing pattern every level already uses, just extended
      to one more, much rarer level) — a real hitch risk if it lands in a render frame, but
      restructuring that onto a worker is a `main.js`/`chunkWorker.js` change outside this
      pass's files.

      GRASS. Read `main.js`'s real frame loop rather than guessing: `flora`/`water`/`clouds`/
      `wind` all get `camera.position`, but `grass.update(car.x, car.z, car.y, dt)` gets the
      CAR's position — the one outlier. Ring residency being car-anchored is intentional (the
      file banner's own point 4), so that stayed; but `_draw()`'s visibility test — distance
      bands AND the cone cull against `U.uCull` (always the TRUE camera's forward direction) —
      was also being evaluated from that car-relative point. The sport camera sits ~6–7 m from
      the car, so this rarely showed; `car/camera.js`'s DRIFT orbit (auto-drive only) swings the
      rig up to ~25 m out and ~39° around the car while looking back across it, which is enough
      to make an already-built, already-resident chunk that IS in the true lens's view fail a
      test measured from 25 m and 39° away — `mesh.visible = false` for a chunk whose own data
      never changed, i.e. grass popping out of existence. Fix: `_draw()` now reads
      `U.uCamPos`/`U.uCull` directly (already fresh by the time it runs) instead of the
      passed-in car position; `_recentre`/`_ensureRegion` untouched. `tools/diag-grasscine.mjs`
      drives a real car through the real DRIFT orbit against the real `Grass`: measured camera
      offset up to 25.1 m, orbit swing up to 38.6°, and **5.43%** of resident-chunk samples
      where the true camera should see a chunk the old car-relative test would have hidden.
      Cross-checked the actual shipped code (not just the theory) against an independent
      oracle fed the true camera position over 438 058 real samples: **0 disagreements**. Frame
      cost: isolated steady-state `_draw()` (nothing dirty) measured at 0.016 ms mean / 0.30 ms
      worst over 244 chunks / 361k instances — the change swaps which `Vector3` three numbers
      are read from, so no regression is possible in the arithmetic, confirmed in practice.

      `npm test` and `node tools/bench-props.mjs`/`bench-fuel.mjs` stayed green throughout
      (scatter.js's other consumers all call `scatterChunk` at fixed levels 0/1, never bound to
      `SCATTER_MAX_LEVEL`, so raising it cannot touch them — checked by grep before relying on
      it). No GPL/AGPL, no new third-party assets — pure code, nothing for docs/CREDITS.md.
- [x] **Snow biome: pine-only trees, snow-dusted foliage; dunes: a real desert shape and sand
      that actually bogs you down off-road.** Two playtest reports from screenshots, `world/
      biomes.js`, `world/scatter.js`, `render/trees.js`, `game/presets.js`, `car/vehicle.js`,
      `game/garage.js`.

      SNOW TREES. "Green bushes/trees should be covered in snow too in snow biome -- only pine
      trees in snow biomes." Cobalt Highlands is the snow biome (`BIOME_TINT[HIGHLAND].snow`
      is the only nonzero entry in `core/palette.js`), and `BIOME_SCATTER[HIGHLAND].kinds`
      already said pine/pine/deadpine — but `scatterChunk`'s tree emitter picked a tree's
      SPECIES with `pickBiome(w, rnd())`, drawing from the site's FULL blended weight vector
      rather than its dominant biome, so a site that read as highland to the player could still
      roll a meadow/steppe species (broadleaf, acacia) a fraction of the time — a real
      cross-biome leak, not a cosmetic one. Fixed narrowly in `world/scatter.js`: once highland
      is the DOMINANT biome at a site, draw its own kinds only; the genuine mix the weighted
      draw is FOR still happens in the approach, where highland has not yet won. Measured with
      the new `node tools/diag-snowtrees.mjs` against 5800 real tree sites at real
      highland-dominant coordinates (alpine preset, 2401 level-0 chunks scanned around a real
      spawn): **0 non-pine kinds**, was leaking before the fix.

      No snow-covered material existed anywhere for trees/bushes — `vTint` only ever carried
      the per-biome foliage COLOUR multiplier, never a white-dusting term. Rather than invent a
      second system, `render/trees.js` now reads the SAME per-biome `snow` scalar
      `terrainMaterial.js`/`grass.js` already blend by (`biomeTintArrays().scal`'s third
      component, packed into a new `B_SNOW` GLSL array alongside the existing `B_FOLIAGE` one)
      and blends toward the SAME three colours those two files already use
      (`vec3(0.95,0.96,0.99)` lit / `(0.80,0.85,0.94)` mid / `(0.58,0.66,0.82)` shade) over the
      SAME 120–240 m altitude band, so a snowy hillside's pines and bushes read as part of the
      same snowfall as the ground and sward they stand in rather than a disconnected overlay.
      Biased toward upward-facing surfaces (`N.y`) so the dusting sits on top of a canopy or
      bush rather than painting it solid. `node tools/diag-snowtrees.mjs` replicates the real
      shader formula in JS with the real per-biome numbers (the `diag-carpaint.mjs` technique)
      and shows Cobalt Highlands foliage moving from plain green to (0.90, 0.92, 0.91) as
      altitude crosses the snowline while Hoshi Meadow (snow = 0.0) never moves at any
      altitude — the material is wired to the real scalar, not a flag nothing reads.
      `render/trees.js` is NOT part of `render/painted.js`'s pipeline (Flora owns its own
      RawShaderMaterial; painted.js is buildings/props/road furniture only) — this reuses
      trees.js's OWN existing per-vertex biome-tint mechanism rather than building a second
      material system, which is the same principle the painted-pipeline instruction was
      pointing at.

      DUNES SHAPE. "Dunes must be a new desert theme... dunes smooth but tall", not another
      hilly preset with a sand texture. `BIOME_TERRAIN[DUNES].amp` 62 -> **70** (biomes.js,
      applies everywhere dune-weighted ground exists, including inside other presets) with the
      comb term's SHARE pulled 0.20 -> 0.16 in the same move so its absolute crest contribution
      stays flat while the smooth billow part genuinely grows — see the in-file comment for the
      full reasoning. A larger first attempt (amp 96) measured taller but pushed
      `node tools/diag-cliffs.mjs`'s DEFAULT-preset gate from 0.016% to 0.060% against its
      committed 0.019% ceiling: a known highland/meadow/steppe boundary hot-spot (the same
      cluster the W4 fix already had to fade in) sits within a few points of 45° on its own
      relief, and even an 8–9% trace of dunes weight there was enough to tip several samples
      over — reverted to the smaller, safe step. The rest of "tall" is bought in
      `game/presets.js`'s dunes preset alone (`amp` 0.9 -> **0.98**), which cannot touch that
      gate at all (scoped to the preset, `diag-cliffs.mjs` never calls `applyTerrain`).
      Measured, `node tools/diag-relief.mjs dunes`: 720 m-window relief median 73.8 -> **78.2**,
      mean 80.5 -> **83.7**; at the real spawn (the number the W4 entry above tracks) 34.3 ->
      **39.5**; massif road grades essentially unchanged (0.9%/22.5%, was 1.0%/22.7%) — taller
      without the roads getting harder to climb. Dunes' own cliffs figure moved 0.001% to
      0.065%, deliberately kept under alpine's ("the most dramatic and the least forgiving")
      own 0.147% so dunes reads as tall-but-smooth rather than the jaggedest preset in the
      game. `node tools/diag-cliffs.mjs`'s default-preset gate itself: unaffected by the preset
      change, and the biomes.js step alone measured 60→31 of 360 000 across two different
      states of a concurrent, unrelated roads.js fix landing mid-session (see below) — safe
      against both.

      DUNES OFF-ROAD. "sand makes impossible drive offroad 10+ meters (slow/stuck) for
      non-rally cars." Ordinary off-road in this game is a flat, `onRoad`-driven penalty, the
      same everywhere; nothing distinguished sand from grass off the tarmac. New `SAND` block
      in `car/vehicle.js`: while a wheel is genuinely off the made surface AND the ground is
      dune-dominant, distance actually travelled accumulates into a bog severity (0 at 0 m, 1
      at 7 m for the ordinary fleet) that steepens the off-road speed ceiling AND — the term
      that actually matters — a NEW speed-proportional resistance (a flat rolling-resistance
      bump alone cannot bleed off a fast entry speed within a few metres; a term that grows
      with speed can). Drains back to 0 in about 1.6 s once the car is back on a made surface,
      never a hard wall (there is always a real, if tiny, crawl speed), and R still works.
      Measured with the new `node tools/diag-sandbog.mjs` (a controlled synthetic-field unit
      test, isolating this from the real road network's own curves): a non-rally car leaving
      the tarmac at 70 km/h is down to **8.5 km/h by 20 m** and **never reaches 25 m** in dune
      sand, against **61–63 km/h at the same marks** on an ordinary off-road patch under
      identical throttle — dramatically harsher, not "somewhat slower". The fleet already
      documents the Rally as "the only one that is genuinely happy off the tarmac" via
      `feel.offRoad: 1.35` in `game/garage.js`, which — like the Patrol's brakes and the
      Estate's forgiving ones before it — was declared and read nowhere outside that file.
      Wired: `applyCarFeel()` now sets `TYRE.offRoadMul`, and the Rally's severity is capped at
      1/1.35 ≈ 0.74 rather than merely delayed (dividing only the DISTANCE still walked every
      car to fully stuck eventually, just a few metres later — measured, then rejected for
      that reason). Confirmed on the real wiring path (`applyCarFeel(FLEET_BY_ID.rally)`, not a
      hand-set number): the Rally reaches 25 m at 13.3 km/h where the non-rally car never
      arrives at all.

      **A concurrent-session note, said plainly because it happened mid-pass:** partway through
      this work, `world/biomes.js`, `game/presets.js`, `game/garage.js` and `car/vehicle.js` —
      including another session's own unrelated tilt/rollover work in the last of those — were
      all found reverted to their pre-session state at once, almost certainly a stray write
      from another concurrent agent in this same checkout racing a `git` operation neither
      session was asked to run. Not fought or reverted-back blindly: re-verified against the
      actual current disk state and re-applied cleanly, with the other session's own tilt/
      rollover changes (`_smRoll`/`_smPitch`, the `onRoadMin`-based off-road gating, the
      reverse governor) intact and coexisting rather than clobbered a second time. `npm test`,
      `node tools/bench-car.mjs` and `node tools/bench-props.mjs` all re-verified green
      afterward. Left here as a signal that whatever is doing full-file writes across sessions
      in this workflow is a real risk worth the orchestrator knowing about, not just this pass.

      `npm test`, `node tools/bench-car.mjs` and `node tools/bench-props.mjs` all green. No
      GPL/AGPL, no new third-party assets — pure code and constant-table changes, nothing new
      for docs/CREDITS.md.
- [x] **Intro cinematic.** `src/game/cinematic.js`. Four shots, 38 s, on first visit only (the
      closing shot alone on later visits; `?intro=full|short|off`): a crane over the land toward
      the seed's tallest massif, a low glide in off the water, a tracking shot down a road, then
      a descending orbit that lands on the chase camera's own rest pose so the hand-off has no
      cut in it. Any key, click, tap or stick ends it. Nothing is blocked while it runs — the
      loop and the player's input are live throughout, the cinematic only borrows the camera.
      Evidence: `node tools/diag-cinematic.mjs [seed]`.
- [x] **Cinematic camera during auto-drive.** The chase rig gains an orbit / boom / lift drift
      (`DRIFT` in `src/car/camera.js`) weighted 0..1 by whether the car is driving itself, so at
      weight 0 it IS the sport camera. ±36°, 9–22 m of boom, under 10 °/s; back to sport in
      exactly 1.2 s when the player takes the wheel. No camera picker.
- [x] **Positional ambient audio.** `src/audio/ambience.js` — the sea builds as you approach a
      shoreline and birds thicken near woodland, both distance- and direction-attenuated, ducked
      under the radio and engine. `node tools/diag-ambience.mjs`.
- [x] **Forests, not scatter.** Tree density is now a low-frequency deterministic field:
      measured 48.5 trees/ha in dense forest, 4.7/ha in thin woodland, 0.0/ha on an open plain
      (plains keep their boulders). `node tools/diag-forests.mjs`.
- [x] **Flower beds.** A separate clustered ground-cover layer with a dense core and a soft
      edge, `src/render/flowers.js`, through the same painted pipeline as everything else.
- [ ] Left by W4/W5, both small and both in someone else's file.

      `BIOME_TERRAIN.rough` is dead — documented as such in `biomes.js` itself (line ~166),
      and deliberately left in place rather than removed: "that is a behaviour change dressed
      as a tidy-up." Leaving it stand; not worth re-litigating a decision that was already made
      on purpose.

      **Investigated this pass, NOT fixed, recorded instead — the road-`grade` lever named
      here previously was the wrong diagnosis.** Fresh reading, `node tools/diag-relief.mjs`:

      ```
      preset   summit h(m)  radius(m)  steepest face  median grade  worst grade
      meadow          104        654          13.8°          2.0%        27.1%
      rolling         104        654          13.8°          2.8%        26.7%
      alpine          177       1076          14.2°          7.4%        52.9%
      plains           81        599          11.8°          0.8%        22.1%
      dunes            83        604          12.0°          1.0%        22.7%
      marsh            78        591          11.5°          1.2%        19.9%
      ```

      Every preset's worst grade is close to `tan(steepest face)` except alpine, which is
      almost exactly DOUBLE (tan 14.2° = 25.3%, worst measured 52.9%). `landmarks.js` already
      documents the mechanism, at line 66: massif sites are jittered within their lattice cell,
      and "two overlapping domes add their gradients where they meet — the one case where this
      construction can produce a face steeper than its ratio promises." Alpine's height
      multiplier (~1.7x, so taller domes) carries a proportionally larger radius (radius is
      tied to height by `RATIO_LO`/`RATIO_HI` in `landmarks.js`) on the SAME 3.6 km lattice
      spacing every other preset uses, so alpine's domes overlap their neighbours far more
      often — this is a land-side effect specific to how the lattice scales, not a per-road
      smoothing question.

      Why this is not this pass's fix: `roads.js`'s `grade` (the smoothing-length lever
      previously named here) only changes how far the ROAD departs from land that is already
      this steep — it trades gradient for deeper cuts/higher fills up to the 18 m earthwork
      clamp, which past sessions have already shown is non-monotonic (see the W4 entry above:
      an earlier grade-adjacent experiment made cliffs worse, not better). The land itself is
      the thing that is too steep, so the road lever cannot cleanly fix it. A real fix belongs
      in `landmarks.js` — most likely damping how two nearby sites combine (a max-weighted
      blend instead of an additive one where domes overlap, or spacing the lattice cell wider
      at higher `LANDMARK.scale` so bigger domes get proportionally more room) — and it needs
      its own before/after pass across `diag-cliffs.mjs`, `diag-relief.mjs` (W4 depends on
      alpine's relief staying dramatic) and the W5 landmark-visibility check, not a one-line
      tweak. Left for a session with room for that.
- [X] **100 Ghibli-flavoured props** as rare points of interest, including the petrol station.
      **DONE 26 July.** 100 kinds, all modelled in code in the painted pipeline — no
      third-party asset was downloaded, so there is no licence to audit (reasoning in
      docs/CREDITS.md). Placement `src/world/props.js`, geometry `src/render/props.js`, fuel
      `src/game/fuel.js`, gauge `src/ui/fuelGauge.js`. Measured: one find every 822 m of road
      (31 s apart at cruise), 0 props on a carriageway, 0.000 m of float, 21 draw calls and
      11 100 triangles for the whole 1.2 km window, worst frame 7.5 ms against render/road.js's
      existing 15.8, **6.00 minutes of cruising per tank**, stations every 2 916 m of arterial,
      refuelling proven by reading the tank out of the model. Running dry fades over 6 s,
      coasts 20 s at 1.3 m/s² to a stop, and a passing driver shares a can — never a game
      over. `node tools/bench-props.mjs [seed]` and `node tools/bench-fuel.mjs`; six seeds
      green.

      NEXT if anyone extends this: the 100 kinds are 18 parameterised shape families in
      `BUILDERS`, so a 101st is a table row plus a few numbers. The rarity dial is `SLOT` and
      `SLOT_P` in `src/world/props.js` — tune them by reading the bench's "one find every N m",
      never by reasoning about the probability, because only about one candidate in six
      survives the freeboard and slope tests.
- [X] **Petrol stations were not actually findable, and floating fuel cans.** Operator report,
      verbatim: "Fuel requirements but no gas stations -- maybe we can do floating gass cans?"
      **DONE 27 July.**

      The box-average acceptance test above (`stationSpacing`) was passing the whole time —
      133-186 stations over an 18x18 km square looked fine. It was the wrong instrument: relief
      is spatially correlated (hills cluster), so a driver on ONE real corridor can go far
      longer than the map-wide mean while some other, flatter corridor carries the average.
      `tools/diag-stations.mjs` (new) walks a real, connected chain of arterial edges — never a
      box — and reads off the gaps a driver actually meets. It confirmed the operator's report
      immediately: worst real gap 35.3 km, against a 9.5 km cruise / 5.6 km flat-out tank
      (`tools/bench-fuel.mjs`).

      Three real causes, not one, found by measuring rather than guessing:
      1. `STATION_MAX_GRADE` (6%) was tuned before the relief pass that left meadow arterials
         at a worst grade of 27% and alpine's road grade at a MEDIAN of 7.4% — already above
         the old cap (docs BACKLOG W4 / alpine-gradient entries above).
      2. Only 5 fixed candidate points were tried per 1.8-2.6 km edge, so a real flat pocket
         often existed but was not sampled.
      3. An actual bug: the flattest candidate was checked for water AFTER being chosen, so if
         that one point happened to be wet the WHOLE edge was rejected even when a slightly
         less-flat, dry candidate existed among the others tried — this cost MORE stations than
         grade in five of six presets (measured: causeway rejection 24-45% of candidate sites in
         marsh/dunes/plains, vs 8-39% for grade).

      Fix: `STATION_MAX_GRADE` 0.06 -> 0.11, `STATION_AT` 5 -> 11 points, and the water test now
      runs per-candidate (flattest of the ones that are ALSO dry wins, not flattest-then-hope).
      Re-measured: worst real gap 35.3 km -> 17.99 km over 13 113 km of real routes (6 presets x
      4 seeds) — real, but STILL short of the 5.6 km floor, because `STATION_P`'s own 72%
      independent draw per edge has a combinatorial tail no grade/water fix removes (isolated by
      re-running with grade/water rejection disabled entirely: still 10-18 km). Raising
      `STATION_P` to chase that away would flood the road and lose "a REASON TO STOP".

      So: floating fuel cans, the operator's own proposed second layer, exactly for this tail.
      `fuelCansInBox` in `src/world/props.js` (placement, arc-length slots on BOTH tiers, same
      `clearOfRoads`/slope discipline as the 100 props, freeboard rule relaxed to `'any'` —
      deliberately, since a can that floats has no structural reason to insist on dry ground the
      way a forecourt does, and that is exactly where stations lose the most candidates).
      `buildFuelCan` + `Props` changes in `src/render/props.js`: individually-meshed (never
      baked into a tile, so one can be removed and bob independently), collected on proximity
      (`CAN_RADIUS` 7 m, no need to stop), a gentle sine bob on the mesh's own transform.
      `Fuel.collectCans` in `src/game/fuel.js`, wired in `src/main.js`. "Floating" means one
      thing precisely: the geometry's local origin is +`CAN_HOVER` (0.55 m), so placing it at
      the same ground-contact point every prop uses is what makes it hover — nothing is
      unanchored, and placement's own freeboard/slope math is unaffected by the render-time
      hover. Measured: one can every ~600 m (1.46-2.46/km across six seeds), denser than the
      100 props on purpose. Real, driven, end-to-end proof it works — not just that the code
      exists — in `tools/bench-props.mjs`'s "a can, bobbing and collected" section: mesh Y
      genuinely changes frame to frame, collecting pays out exactly `CAN_FRACTION` (22% of a
      tank), the mesh is really gone from the scene graph after, standing on the same spot again
      does not pay out twice.

      Combined result, stations AND cans together, walked over 2 333 km of real routes across
      all six presets: worst gap to ANY fuel source **4.54 km** — comfortably inside both the
      5.6 km flat-out and 9.5 km cruise ranges, with real margin. `node tools/diag-stations.mjs`
      (new), `node tools/bench-props.mjs [seed]`, `node tools/bench-fuel.mjs [seed]` — six seeds
      green on both bench tools.

      **Follow-up, resolved 27 July:** the two checks flagged above as out of scope —
      `tools/bench-props.mjs`'s pre-existing "added draw calls <= 25" (seed 3) and "sample size
      > 40" (seed 5) — were investigated properly rather than left. Both numbers were
      calibrated by eyeballing the single default seed and never swept. `tools/diag-propcount.mjs`
      (new) reproduces each measurement exactly and sweeps it: draw calls (non-empty tiles in
      the fixed window) came back mean 19.6, sd 4.5, true observed max 32 across 542 swept
      seeds — `<= 25` alone failed 38 of them (7%). Sample size (props in the fixed 4x4 km box)
      came back mean ~83, sd ~23, true observed min 21 — `> 40` alone failed 9 of 542 (1.7%).
      Neither is a placement bug: every failing seed's rejection tally (candidates / rejectRoad
      / rejectWater / rejectSlope, now printed per seed by the diag tool) reads as ordinary
      freeboard/slope loss, and sample size specifically correlates at 0.94 with the seed's own
      props-per-km rate — a number the check two lines above already accepts across 0.4 .. 3.2
      — and only 0.27 with how much road happens to fall inside the fixed box. A low count is
      the direct, expected product of two numbers this file already calls acceptable, not
      evidence of anything wrong with `SLOT_P` or the freeboard/slope tests. Recalibrated from
      measurement, the same way `STATION_MAX_GRADE` was: draw calls to `<= 34` (clears the
      swept range with margin and still catches a real regression — nothing in 542 seeds came
      close), sample size to `> 15` (a little under both the swept minimum and the theoretical
      floor of accepted-perKm x observed-minimum-roadKm, ~14 — still catches a genuinely vacuous
      result). All six canonical seeds (20260726, 1-5) plus every seed the sweep found failing
      re-verified green; `npm test` unaffected (bench-props.mjs is not part of that gate).

      **Found in the same sweep, NOT fixed — a different pass's problem.** Pushing past the six
      canonical seeds to verify the fix above surfaced three more seed-dependent failures in
      this file, unrelated to the two resolved here: seed 28 fails "props per km of road"
      (3.38, just over the existing 3.2 ceiling) and "cans per km of road" (3.55); seeds 155 and
      177 also fail "cans per km of road" (3.02, 3.07 against the existing 2.8 ceiling). Same
      shape of problem as above (a per-km ceiling that may itself be a single-seed calibration,
      not swept) but not confirmed as such — flagged, not guessed at.

      **Follow-up, resolved 27 July:** seeds 9 and 30's "nothing collected yet" failure in the
      "a can, bobbing and collected" section (reads 0.22, one `CAN_FRACTION`, instead of 0) was
      confirmed rather than assumed — logging `props._collectedCans` right after the 3 km drive
      shows a real can auto-collected mid-drive (`cn:1:0,-1,1:2` on seed 9, `cn:0:0,-1,1:13` on
      seed 30), because the frame-cost block's dead-straight (i, 0) path happens to pass within
      `CAN_RADIUS` of it. That is the game's auto-collect behaviour working correctly, just left
      undrained on the shared `Props` instance going into the can section's own baseline check.
      Fix: the can section now calls `props.drainCollectedFuel()` once and discards the result
      immediately before its "nothing collected yet" check, so an earlier incidental pickup can't
      leak into this section's own zero baseline — a one-line test-ordering fix, not a gameplay
      change. Re-verified green on seeds 9, 30, and all six canonical seeds (20260726, 1-5).

      **Follow-up, resolved 27 July:** the "per-km ceiling that may itself be a single-seed
      calibration, not confirmed as such" flagged above was investigated properly rather than
      assumed — and this time it was NOT the same fix. `tools/diag-perkm.mjs` (new) sweeps
      `propsInBox`/`fuelCansInBox` across 601 seeds over the identical fixed 4x4 km box, with
      the existing candidates/rejectRoad/rejectWater/rejectSlope/placed tally plus two new
      measurements: road-tier mix (`SLOT_P`/`CAN_SLOT_P` are both luckier on tier-1 lane road)
      and biome AREA sampled on a fixed grid independent of the road network (several prop
      kinds, and the cans' freeboard rule, treat wet and dry ground differently).

      Confirmed real, not a fluke of three seeds: props per km fails high on 2 of 601 (0.3% —
      seed 28 at 3.38, and seed 596 at 3.22, found by the sweep and not previously flagged, both
      over the old 3.2 ceiling); cans per km fails high on **62 of 601 (10.3%)** — seeds
      28/155/177 are three ordinary points on a smoothly decaying tail (3.55, 3.35, 3.31, 3.31,
      3.21, 3.17, 3.17, ...), not a pathological trio.

      What actually drives a high seed, measured rather than guessed: downstream YIELD
      (placed / candidates), not more candidates being generated — `corr(perKm, candidates/km)
      = 0.04` against `corr(perKm, yield) = 0.95`; `corr(canPerKm, candidates/km) = 0.14`
      against `corr(canPerKm, yield) = 0.80`. Within yield, the single strongest lever for both
      is how much of the fixed box sits clear of its own local water table:
      `corr(perKm, rejectWater rate) = -0.39`, `corr(canPerKm, rejectWater rate) = -0.69` (the
      largest correlation the sweep found, either direction, for either metric). Road-tier mix
      is a weak driver (`corr(*, laneFrac)` 0.10-0.17) — the tier-based luck in `SLOT_P`/
      `CAN_SLOT_P` is not the story. No single biome dominates either: the strongest are Hoshi
      Meadow area (+0.42 perKm, +0.37 canPerKm) and Bara Dunes area (-0.38, -0.50) — real, but
      well short of explaining most of the variance alone, because `waterLevelAt()` blends ALL
      five biomes' weights at a point, not just the dominant one. This is the same spatially-
      correlated, seed-varying effect `tools/diag-stations.mjs` already measured for petrol
      stations and the relief/cliffs entries measured for terrain — some seeds' fixed box just
      happens to sit drier than others — not a bug in one biome and not evidence that `SLOT_P`/
      `CAN_SLOT_P` themselves are mistuned.

      Retuning `SLOT_P`/`CAN_SLOT_P` down to chase the high tail was considered and rejected,
      for a reason the sweep itself supplies: the LOW end has little to no headroom to give.
      Props' true observed minimum is 0.43 (seed 198) against the 0.4 floor — about 7% of
      headroom, on a seed nowhere near 28/155/177/596. A global cut aimed at the high tail would
      push every seed down, plausibly trading a `fail-hi` for a new `fail-lo` rather than
      removing one, to chase a cause (the local water table) that is not a probability knob to
      begin with. Cans have more room on the low end (min 1.28 against 0.9) but the same
      objection applies in spirit: the actual lever — freeboard, evaluated per-candidate after
      the accept draw — sits downstream of `CAN_SLOT_P`, so cutting the accept probability would
      suppress cans everywhere equally, including the already-sparse dry seeds, rather than
      specifically the wet-adjacent ones this tail is actually about.

      Fix: recalibrated from measurement, the same way `STATION_MAX_GRADE` and the two checks
      above it were. Props per km ceiling `3.2` -> **`3.6`** (mean 1.75, sd 0.46, true observed
      max 3.38 across 601 seeds — clears it with real margin). Cans per km ceiling `2.8` ->
      **`3.9`** (mean 2.37, sd 0.36, true observed max 3.55 — the bigger jump matches the
      heavier tail: a 10.3% original fail rate against props' 0.3%). Neither floor moved (0
      `fail-lo` on both, before and after — only the ceilings were ever failing). Re-verified:
      all six canonical seeds (20260726, 1-5), seeds 28/155/177 (originally flagged), seed 596
      (found by the sweep), and two more high-tail seeds (438, 293) all green on `node
      tools/bench-props.mjs [seed]`; `npm test` stays 22/22 (bench-props.mjs is not part of that
      gate, and nothing touched this pass is either).
- [ ] Weather and horizon effects, inspired by Slow Roads. Explicitly LOW priority: the
      operator's note was "the goal is to wrap up this project soon so we shouldn't get totally
      caught away".

- [x] Water still looks poor at distance — moire on large sheets, and the shoreline is hard.

      **FIXED (grading pass, 2026-07-27), operator's report verbatim: "fix the water please --
      its ugly".** The screenshot-at-distance comparison the note below asked for was done, and
      it found the real culprit was neither moire nor the discard line but the REFLECTION: at
      grazing incidence (all mid-distance water in a driving camera) the full ripple normal
      swung the reflected ray across the whole sky dome, so 100–600 m of every lake rendered as
      high-contrast marbled contour lines (pale horizon band against blue zenith — screenshots
      showed fingerprint whorls), and past the normal-flatten distance the floor-at-0.012
      reflection sampled the WHITE horizon band, so the far lake was a grey sheet. What changed,
      all in `render/water.js`, all amplitude/colour grading — `bandLimit()` and the per-band
      Nyquist gates are UNTOUCHED, and the `-0.5` discard tolerance (seam prevention) is
      UNTOUCHED to the character:
        - reflection colour now reads through a 65%-calmed normal (glints keep the full one) —
          the painted decoupling: the sky wash never churns, the sparkle still winks;
        - reflected-ray elevation floored at 0.11 (was 0.012) so distant water reflects blue
          mid-sky, not white horizon haze — the far lake is now a luminous blue plate;
        - fresnel cap 0.36 (was 0.46), normal scale 8.5 (was 14) plus a rational soft-limit on
          tilt (~24° asymptote), distance flatten 70–430 m @ 92% (was 110–560 @ 82%);
        - domain warp 22 m (was 46): streaks now meander as open lines instead of closing into
          whorls; ripple-gust coupling 0.62+0.55 (was 0.55+0.9);
        - foam: reaches 0.55 m of depth (was 1.25 — a chalk apron on every shelving shore),
          opacity 0.36, fades across the dry side of the waterline, and dims with the same
          band-limit gate that removes its scallop texture (a solid distant apron otherwise);
        - the 0.5 m seam-tolerance band now fades to a dark wet-earth rim instead of pale
          wet-stone + foam, so the aliased discard contour reads as the dark wet margin every
          painted lake has, at a third the contrast; caustics get an explicit ≤240 m fade.
      Verified against real frames (lake at 2600,-480, seed 20260726): sunward, cross-light and
      shoreline close-ups before/after; no chevron banding at distance (band-limiting still
      doing its job), no dry-gap at the shore seam, suite screenshots (causeway between two
      bodies) read calm turquoise. `npm test` green, `npm run test:browser` 40/40.

      **Investigated the pass before, NOT fixed then, recorded instead.** Two separate claims,
      checked separately.

      Moire: `render/water.js` is NOT missing an obvious fix here — every procedural layer
      already runs through `bandLimit()`, an analytic per-band Nyquist gate keyed off
      `fwidth()` (see the design note at line ~100), including the base ripple bands, the gust
      field, the caustic sparkle, the wet-bed grain, AND the specular glints (line ~261, which
      even hands sub-pixel glints to a broad lobe rather than letting them strobe — a purpose-
      built anti-aliasing scheme, not an oversight). If moire is still visible, the cause is not
      "a layer nobody band-limited" — the easy version of this bug was already fixed by someone
      before this pass. Next step would be a real screenshot-at-distance comparison to find
      which specific layer is still aliasing, which is visual grading work, not a code read.

      Hard shoreline: found a real, named mechanism, and it is NOT simply "add a soft edge."
      `if(!(vD.x > -0.5)) discard;` at line 167 is a binary cutoff — discards inside a triangle
      get no MSAA softening, so it does produce a hard, jagged edge exactly where depth crosses
      -0.5 m. But the same line's own comment says it exists to solve a DIFFERENT, already-
      solved problem: the water plane is a coarser 2 m-sampled mesh than the terrain's 1 m
      mesh, so their waterlines do not perfectly coincide, and the 0.5 m tolerance stops the
      water mesh's own edge from visibly cutting inside the terrain mesh (dry ground showing
      through where there should be shore). Softening this into an alpha fade is a real fix,
      but it has to preserve that seam-prevention property or it reopens a bug this project has
      already been bitten by once (roads: "there should be nothing above a road ever"), and
      there is no automated check for either the softness or the seam — both would need visual
      verification this pass does not have tooling for. Left for a session where that grading
      can happen.
- [x] **Grass aliasing at 100–300 m — the angular width floor was calibrated wrong, and never
      updated.** Two compounding bugs in `render/grass.js`, both by inspection rather than a
      visual before/after (there is no automated aliasing metric in this suite — flagged, not
      invented one this pass): (1) the constructor default assumes a 58° vertical fov on a
      1080 px canvas, but the real camera is 64° (`new PerspectiveCamera(64, ...)` in
      `main.js`) — a "1 screen pixel" floor was sub-pixel by construction, at any resolution.
      (2) `Grass.setAngular()` exists specifically to recompute the floor from the real
      viewport and is called `on resize` per its own comment — except nothing anywhere in the
      repo ever called it. `main.js` now calls `grass.setAngular((camera.fov * DEG) /
      innerHeight)` once at startup and again in the resize handler, so the floor tracks the
      real fov and the real canvas height instead of a fixed assumption.
      `npm test` and `npm run test:browser` both stayed at their current totals (40/40, "THE
      GAME WORKS") on a freshly restarted dev server — this changes a rendering LOD constant,
      not gameplay, so the existing suite is the right gate; nothing in it measures aliasing
      directly. If it is still visibly shimmering next session, the next lever is the floor
      MULTIPLIER (currently exactly 1px) rather than the calibration, which this pass fixed.
- [ ] The autopilot in tools/shoot.mjs follows roads only loosely. It is a smoke test, not a
      driver, and it should be good enough to be a benchmark.
- [ ] Base44 backend is defined in `base44/` but undeployed — the CLI login is a device-code
      flow that needs one human click.
- [ ] Remote cars are ghosts with no interpolation testing under real latency.
- [x] **Two multiplayer bugs from the same playtest report, plus proximity fuel-sharing and a
      3-strikes limit on the passing-driver mercy.** Operator, verbatim: "person 1 sees a
      ghoast as player 2 of the wrong car - player 2 does not see 1."

      WRONG CAR, confirmed as a real, 100%-reproducible bug and fixed. `carPacket()`
      (`src/main.js`) sent `car.tier` — the Vehicle's own `'gt'|'sports'|'hyper'` silhouette
      STRING — straight onto a wire field `server/drive.php` stores as SQL `INTEGER`. PHP
      casts a non-numeric string to 0, so every ghost, for every peer, rendered as
      `CAR_TIERS[0]` regardless of what its driver had actually chosen. Confirmed directly
      against the live backend, not just read in the PHP source: sending the three old string
      shapes (`'gt'`, `'sports'`, `'hyper'`) all came back `tier: 0` on the peer that received
      them. Fixed by sending the FLEET index (0-6, the same numbering `game/garage.js` already
      uses) instead — a lossless fit in the same 0-63 wire field, no server change needed — and
      decoding it back to the correct silhouette in a new `buildGhostFromFleet` adapter
      (`src/main.js`). `tools/net-test.mjs` used to hardcode `tier: 0` for BOTH its test seats,
      which is exactly the kind of gap that let this ship looking green (a bug that collapses
      every tier to 0 is invisible to a harness that only ever sends 0); it now drives two real,
      different fleet cars and asserts both arrive intact — `PASS seat 2's car arrived intact —
      not just tier 0  sent patrol (index 6) — got index 6 (patrol)`, and the same the other way.

      PLAYER 2 DOES NOT SEE 1: investigated hard, not found as a deterministic protocol bug.
      Read `server/drive.php`'s interest-cell query and self-exclusion in full — both are
      provably symmetric by construction (a 3x3 neighbourhood built from your OWN position,
      `player_id <> ?` bound to a server-derived id) — and built a NEW, deliberately
      uncoordinated live-backend harness (one seat idling alone, the other approaching on its
      own independent timer, no scripted hand-off) rather than trusting the existing
      `net-test.mjs`, whose own coordinated "wait, then let each side speak once" pattern could
      not have caught an asymmetry like this even if one existed. Both directions saw each
      other reliably; the one blip found (a single tick at the exact edge of interest range)
      self-corrected within a second and hit the approaching side, not preferentially either
      role. What WAS found and fixed: `netTick()` ran only from inside the rAF-driven `frame()`
      loop, and browsers pause `requestAnimationFrame` for a document that is not the visible
      tab — documented behaviour, not a tuning knob. `docs/MULTIPLAYER.md`'s own recommended
      way to test multiplayer solo is two windows on one machine, which guarantees one of them
      is always backgrounded, so that window's presence would starve exactly the way "the other
      person can't see me" describes. `netTick()` now runs off its own `setInterval` (250 ms),
      independent of rendering. Said plainly: this is the most likely concrete cause given
      everything else checks out symmetric, not a confirmed root cause — logged honestly rather
      than claimed as fixed beyond what was actually shown.

      PROXIMITY FUEL SHARING, new. Operator: "let them also share gas when close -- so they can
      team up." A press (`KeyF`) gives `SHARE_FRACTION` (20%) of a tank to the nearest ACTUAL
      other player within `SHARE_RADIUS` (25 m) — gated so the giver can never strand
      themselves (`MIN_GIVER_RESERVE`), and a REAL transfer: the giver's tank drops by exactly
      what the receiver's gains, never both sides topping up from nothing. There is no
      server-side concept of fuel, so this rides the two spare bits already in the wire's
      `flags` integer (`SHARE_FLAG`, bit 2) rather than asking the live backend for a new
      message type this round could not get deployed — `src/net/remotes.js` watches for the
      bit's RISING edge on a nearby peer (re-checking the giver's reported position at the
      moment the share arrives, not a stale interpolated one) and hands the fraction to
      `Fuel.update()` through the same pull pattern `collectCans()` already uses. Proven three
      ways in the new `tools/net-test-fuel-share.mjs`: (A) against the LIVE backend, the
      SHARE_FLAG bit set by one real client really arrives set on the other's peer response;
      (B) with the real `Fuel` and `Remotes` classes driven directly, a give costs the giver
      72.0 s of tank and the receiver gains the same 72.0 s, a pulse held across several
      snapshots pays out once and not once per snapshot, and a flag from outside SHARE_RADIUS
      is correctly not credited; (C) the giver's own refusals (too little to spare, nobody
      close enough) cost nothing. 37/37 checks green.

      THE PASSING-DRIVER MERCY GETS A BOTTOM, deliberately overriding this file's own former
      "never a game over" note on the operator's explicit instruction: "3x max 'someone gives
      you a gas can' and then game over (restart og position) so its teamwork to find gas
      stations and get the furthest from home." `MERCY_MAX` (3) uses, persisted for ever per
      player exactly like `Streak.best` (`localStorage`, one small record, read once, written
      on every change — proven to survive a fresh `Fuel` instance on the same key, i.e. a
      reload). The 4th dry stop calls a new `resetToSpawn()` (the session's ORIGINAL spawn
      point, not `backToRoad()`'s "nearest road" — the operator asked for "restart og position"
      specifically) instead of granting a can. **Is "game over" too harsh for a cozy game?**
      Asked plainly, as requested: the MECHANISM is a real, felt, lifetime consequence exactly
      as asked for, deliberately harsher than anything else in this game — but the MOMENT
      itself was kept to the same gentle shape every other setback here already uses: a single
      calm toast ("no one is passing this time — a quiet ride back to the start"), a graceful
      teleport, and the tank left at a real 50% rather than empty, so the reset is not ALSO an
      immediate second emergency. Checked automatically that no message anywhere in the
      sequence reads like a fail screen. `git diff -- src/world/props.js` was read before any
      of this was written: another agent's `stationDistanceMul()` (station spacing eases from
      1.0 near spawn to a 0.4 floor by 70 km out) is exactly the "easier at start, slowly
      harder" curve the operator asked for — not duplicated here. It is not exported (module-
      private in `props.js`, not this pass's file to add an export to), so the SAME breakpoints
      and shape are mirrored, not imported, in `game/fuel.js`'s `mercyScarcityMul()` — applied
      as the inverse, so a mercy far from home still covers roughly the same number of
      "stations you might have missed" (measured: 0.16 near spawn -> 0.40 at the 70 km floor,
      ratio 2.50, matching `STATION_FAR_MUL` exactly). The active, player-to-player share
      deliberately does NOT scale with distance — a distant giver being asked to sacrifice more
      of their own increasingly precious fuel to be equally kind is a cost falling on generosity,
      not on the game being harder, which is not what was asked for.

      `npm test` and `node tools/bench-fuel.mjs` both stayed fully green throughout, including
      the other agent's own new capacity-upgrade and downhill/off-road sections built into
      `bench-fuel.mjs` concurrently this same round — confirmed compatible, not fought.
      `node tools/net-test.mjs` and `node tools/net-test-fuel-share.mjs`.
- [ ] Engine audio is still synthesised. RPM-indexed CC0 sample crossfading is the researched
      answer; sources are listed in docs/CREDITS.md.
- [x] **Auto-drive drove off dead ends, and never recovered from being stuck.** Operator report,
      verbatim: "Road stop without explanation in middle of no where and autodrive keeps driving
      off that road-end", plus separately "auto drive should reset to road when stuck and have a
      ping when activated". A screenshot showed a road stopping in open ground with nothing
      marking why — that half is legitimate: the lattice in `src/world/roads.js` produces real
      dead ends by construction (a node with no qualifying connection on one side), not a
      worldgen bug. What was wrong was `src/car/autopilot.js`'s reaction to one: `headAt()`
      correctly holds the heading flat past the end of a chain, on purpose, so a dead end never
      reads as a phantom hairpin — but nothing was reading "the chain stopped because there is
      nothing left to chain" as different from "the chain stopped because this frame did not
      need to look any further", so a dead end looked exactly like an open, straight road right
      up until there was none left, and the car drove off the last vertex into the field beyond.

      `_horizon()` now tells the two apart (`this._deadEnd`, set only when `nextEdge()` is
      actually asked "what comes after this?" and reports nothing — the same "qualifying
      connection" test the lattice itself uses for a leaf node), and the speed plan brakes to a
      real stop against a CONFIRMED one, well before the existing reactive lost-the-road brake
      would ever notice (that one only fires once the car is already off the tarmac; extended,
      not replaced — same 4 s timeout, same hand-back-control shape it already had). Separately,
      a stuck detector now watches speed independent of position: near zero for more than 3.5 s
      while still engaged — wedged on a rock, hung up on a verge, anything that physically pins
      it — resets the car to the nearest road by calling the SAME `recover()` function the R key
      and the water rescue already call (`src/game/rescue.js`'s own constructor pattern;
      `main.js` wires all three to the one `backToRoad()`, so none of them can disagree about
      where "the road" is), then carries on driving rather than handing control back. A short
      synthesised tone (`EngineAudio.ping()`, a sine settling from D5 to B4, no external audio
      file) now fires once per G-press, additional to the existing "auto-drive on — sit back"
      toast — kept, not replaced.

      New harness, `tools/bench-autopilot-safety.mjs` (bench-drive.mjs measures normal driving,
      the wrong shape of test for either of these): finds a genuine dead end in a real generated
      network with the exact same `nextEdge()` test the autopilot itself brakes against, drives
      straight at it, and confirms the car stops short — measured across seeds, 3.6-4.0 m from
      the literal last vertex every time, never past it — and hands back with reason "the road
      ends here", never open terrain. Separately pins a car's velocity 550-830 m off the network
      to simulate being wedged (this harness has no collision system to wedge it against for
      real) and confirms `recover()` fires at 3.51 s every time — bounded, and deliberately ahead
      of the 4 s lost-road path so the one case they overlap resolves through the better outcome
      — and the car ends up exactly on the road afterward, still engaged. Confirms the ping fires
      exactly once on activation, stays flat across 240 frames of ordinary driving and across
      deactivation, and fires again on a second activation. All green across 6 seeds (1, 7, 42,
      2026, 999999, 20260726). `npm test` and `node tools/bench-drive.mjs` unaffected — 100%
      on-road, 1.4 m worst offset, unchanged from baseline, since the new checks only ever
      engage away from ordinary driving.

- [x] **Road cuttings read as stark cliffs, not soft hillsides.** Operator, verbatim: "Road cuts
      through mountains too stark -- should be less cliff-cut more soft hill." Screenshots showed
      a near-vertical, dark, jagged, low-poly wall right beside the tarmac — reading as a
      rendering glitch rather than a graded roadside slope — and the same kind of wall right
      where two roads meet. **DONE 27 July.**

      Not a repeat of the batter tuning above (search "batter"): that work's SHAPE decision
      (smoothstep over straight-with-eased-ends) and RATIO (1.6, uncapped) both stand, untouched.
      What was still wrong sat one level up, in `RoadField.carve()` (roads.js), which hands
      `terrain.js`'s `groundFromCarve()` the `d`/`y`/`width` it uses to size and place its own
      (correctly uncapped) shoulder. Two distinct mismatches, both confirmed with real per-edge
      dumps on the seeded world (20260726) before either was touched:

      **Two roads' earthworks blending — the aggravating case the second screenshot pointed at,
      confirmed real: 53 of 59 over-45° points in the standard window sat within reach of TWO
      road edges, not one.** `out.d` (nearest-edge distance) was tracked independently of
      `out.y`/`out.width` (the weighted blend across contributing edges), so a short lane —
      geometrically nearest, but already past its own narrow 12 m shoulder — could set `d`, while
      a distant, much deeper arterial cutting 40 m out, still legitimately blending in, set `y`.
      groundFromCarve then sized a wide shoulder from the arterial's own big drop and evaluated it
      at the lane's much shorter distance: a real point came out 20 m below the land beside it, an
      80° face, from two edges that were each individually well-behaved. Fix: `d` is now blended
      the SAME weighted way as `y`/`width` (`dSum += w * ed`, same `w`), not tracked as a separate
      nearest-wins scalar. Provably safe: `mask > 0.001` (the only condition under which
      groundFromCarve ever reads `d`) implies `wSum > 1e-6` by construction — mask IS the largest
      single term inside wSum — so the blended `d` is live exactly where the old unblended one
      used to be the lone straggler, and the untouched raw-nearest fallback only surfaces where
      mask is already ~0 and groundFromCarve is never called.

      **A second, single-edge mismatch, same root shape.** roads.js's own per-edge weight capped
      the drop it fed its shoulder formula at `MAX_EARTHWORK + 4` (22 m) — sized for how far a
      ROAD's own profile may sit from the land under it, not the different question `drop`
      answers there (how far the QUERY POINT's land sits from the road, unbounded by that clamp).
      terrain.js's groundFromCarve uses the identical formula on the identical `drop`, uncapped on
      purpose (its own comment: "capping the width while the height keeps growing is how you
      build a wall"). Past 22 m of true drop, roads.js undercounted the shoulder and reported
      `mask` near zero a few metres before groundFromCarve — the same edge, uncapped — was still
      blending a third of the way toward it: one otherwise well-behaved edge produced an 89° jump
      inside 20 cm, right at that crossover. Fix: uncapped to match, with a safety ceiling tied to
      the coarse bounding box each edge already qualified against (never tighter than real
      measurement needed — true drop maxed at 29 m over the checked window; the ceiling only
      bites past ~41-44 m).

      `node tools/diag-cliffs.mjs`: **59/360000 (0.016%) -> 31/360000 (0.009%)**, comfortably
      under the recorded 0.019% ceiling. The tail is the real story, not just the count: histogram
      50-60/60-70/70-80 went **21/18/13 -> 3/0/0**, worst point **80° -> 56°** — every sample that
      would have read as a near-vertical dark wall is gone; what remains peaks in the high 40s to
      mid 50s, a steep grassy bank rather than a cliff face. New tool `node tools/diag-batter.mjs`
      walks the real PROFILE (land / carve target / final height) through the worst real
      multi-edge and single-edge points, kept as a permanent regression check, not just a
      pass/fail count: before, a 19.4 m vertical step in a 0.2 m span (89°) at the multi-edge
      point measured directly; after, the same walk is smooth and continuous across its full
      44 m, peak 65.5° reached gradually, no step anywhere. Honestly measured, not hidden: `node
      tools/diag-relief.mjs` shows alpine (already flagged there as "the one that grows walls")
      improving **0.139% -> 0.070%**, better than its own historical 0.078% baseline — but rolling
      and dunes each pick up a handful of new over-45° points (0/1 samples -> 11/9), all in the
      45-48° range on inspection (mask 0.42-0.75, genuinely covered, nowhere near the eliminated
      70-90° tail) — a threshold test sitting across a now-more-consistent boundary, not a new
      cliff mechanism. `npm test` 22/22; `node tools/diag-seam.mjs` (the fall-through guard,
      gotcha 6) unaffected on both rolling and alpine — nothing this pass touches the road
      elevation profile itself, only the terrain-carve blend around it.

      **Junction notch/crack, checked, not touched.** The triangular gap and stray marking
      fragments the operator's earlier screenshots showed at a crossing are gone by construction,
      not just by measurement: the junction patch (this round's own 90-degree-junction work,
      `render/road.js`'s `buildJunction`) is a raised overlay on top of full-length, un-trimmed
      ribbons, and two strips crossing at any angle cannot enclose a hole between them (every ray
      out from the crossing point stays covered by at least one strip's own width until it exits
      both). `node tools/diag-junction-geom.mjs` still passes all 5 checks across 121 real
      crossings in 4 windows (no NaN, every triangle faces up, vertex heights agree with
      Terrain.height to 0.001 m, patch bbox reaches at least half the narrower road's width every
      side) — re-run after this pass's own change, not reused from before it. Not touched: that
      geometry system is large and belongs with whoever built it.
- [x] **Ocean-size water needs sea sound, should be flat, and should have ships on it.**
      Operator, verbatim: "Ocean-size water needs to make sound of sea -- large bodies of water
      should be flat and have ships on em." Three parts, one shared idea underneath all three:
      "large" is not knowable exactly without a flood fill, which this pass does not do per
      frame or even per chunk-adopt — instead a coarse, cheap, CACHED ring-sample
      (`waterOpenness()`, `src/render/water.js`), snapped to a 220 m world-aligned cell so
      neighbouring water chunks agree exactly and draw no seam. Calibrated against a real 40 m
      flood fill over a 12 km square of the shipped seed, not guessed: `node
      tools/diag-openwater.mjs` (new) prints the table — the twelve largest real bodies (up to
      11.1 km²) scored 0.55-1.00 at their most open point, real ponds under 25,000 m² scored
      0.00-0.70 (an occasional high outlier is a cluster of several small pools in one wetland,
      which genuinely does have a lot of water nearby and which this proxy is not trying to
      tell apart from one big body).

      SEA SOUND. `src/audio/ambience.js`'s positional ambience (built two sessions ago) already
      had a size term, `extent`, but measured — not assumed — it was not doing its job: before
      this pass, approaching a real 11.1 km² lake and a real, genuinely isolated 12,800 m² pond
      in this seeded world, by 20 m out the POND read LOUDER than the LAKE (0.0702 vs 0.0649),
      because `extent`'s old range (0.5-1, saturating past 0.22) is reached by almost any
      shoreline once you are close enough to stand at it, lake or pond alike — so right where
      the layer is most audible, its "how big" term had already stopped discriminating. Fixed
      by widening both the domain (`0.02-0.22` -> `0.08-0.4`, spending more of the map on the
      100-400 m band where big and small bodies actually differ) and the range it maps to
      (`0.5-1` -> `0.32-1.2`) in `seaGain()` — see that function's own comment for the full
      derivation. After: at a real isolated pond vs the real biggest lake, 400 m out the lake is
      **12.6x** louder, 200 m out **2.5x**, closing to parity only in the last ~10-20 m, where a
      130 m-wide pond's own edge and a kilometres-wide sea's edge both genuinely put "a lot of
      water" within the same 500 m probe disc — an intrinsic limit of a bounded-radius proxy, not
      a bug left in. `node tools/diag-ambience.mjs`'s existing checks (including its own
      shore-gain-ratio and handedness sections) stayed green throughout; a new section in that
      same tool reproduces the big-vs-small measurement with real, honestly-reported probe
      distances (not assumed labels) on every run.

      FLAT. `src/render/water.js`'s ripple/gust shader (deliberately careful anti-aliasing
      already documented there — untouched) now reads a fourth per-vertex quantity, `wopen`,
      baked from `waterOpenness()` once at chunk-adopt time, never per frame. A `calm` factor
      (`smoothstep(0.55, 0.92, wopen)`) scales the ripple-bump amplitude down to 30% and the
      wind-gust darkening down to 45% on the calmest, largest water — nothing about HOW the
      bands are built or band-limited changed, only how tall they are allowed to stand. Real
      before/after off a REAL built water plane (`buildChunk` + `Water.add`, not just the
      standalone function): the biggest lake's own chunk bakes `wopen` 1.000 across every
      vertex, giving amp x0.300 / gust x0.450; a small pond bakes 0.050-0.350 and is left
      untouched (x1.0). `node tools/diag-openwater.mjs` section 2.

      SHIPS. New `src/render/ships.js`: a rare, low-poly boat (five painted-pipeline faces for
      the hull, tapering to a stem edge at the bow — no lofted curve, matching this project's
      whole visual language — plus an optional cabin box and mast), no third-party asset (see
      docs/CREDITS.md). Placed on its own rolling lattice around the car, like `render/props.js`
      and `render/road.js`, deliberately NOT tied to the terrain streamer's chunk records —
      `props.js`'s own file header explains why: a sparse feature tied to the quadtree gets
      re-decided every time a chunk's LOD changes. One candidate per 500 m tile, gated in
      increasing cost order (real depth, then `waterOpenness() >= 0.68`, then a tight 40 m
      all-round shore-clearance ring, then 70 m clear of every road via `world/roads.js`'s own
      cheap standalone `roadDistance()`, then a 0.3 rarity draw) — measured over a real 144 km²
      square: 34 sites clear every gate but rarity, 7 real ships result, **0.58 ships per km² of
      qualifying large-open water**, independently re-verified (a second, separately-written
      check, not the placement code grading its own homework): nearest road to any placed ship
      72.3 m, worst shore-ring sample -1.27 m of freeboard (both clear their floors). A ship
      never moves its (x, z) after placement — it bobs (0.14 m), rocks (~2°) and slowly swings
      its heading (~7°) at anchor, entirely in `Object3D` transform updates, which is a safety
      property as much as a look: the road/shore checks are only ever paid for once. Real,
      driven proof it animates and never drifts: `node tools/diag-openwater.mjs` section 4 reads
      a live hull's own `position`/`rotation` before and after 5 s of simulated time.

      FRAME COST. `waterOpenness()` never runs in the render loop — only from
      `Water._buildPlane()` (chunk-adopt) and `Ships`' own 0.5 s-gated rescan, and it is cached
      per 220 m cell: 139 µs cold (20 point samples), 175 ns warm. The water shader gained one
      extra 4-byte vertex attribute and a smoothstep plus two `mix()`es in the fragment shader —
      no new texture read, no new branch. Ships: ~21 triangles per hull, one draw call each
      (individually meshed, like the floating fuel cans, so each can bob independently), and
      section 3's own density measurement is the bound on how many can ever be live at once.
      `node tools/diag-openwater.mjs` section 5.

      Concurrent-session note: `git diff -- src/world/terrain.js src/world/roads.js
      src/world/props.js tools/bench-props.mjs` was read before this pass touched anything and
      stayed clean at that point (both files carry real, unrelated work from other sessions as
      of this entry — a Terrain.height/roads.js crossing fix and a props.js/bench-props.mjs
      pass — neither reached by anything in this entry: this pass's files never import
      `world/props.js`, and `world/roads.js` is only ever called through its existing, unchanged
      `roadDistance()`/`RoadField` public API, never edited). Another session's
      `src/world/biomes.js` dunes-amplitude tuning landed mid-pass too; it touches none of the
      `water`/biome-weight machinery this work reads, confirmed by re-reading its diff rather
      than assuming. `src/main.js` was re-read immediately before every edit — two further
      concurrent sessions (multiplayer ghost/fuel sharing, and the station/mercy work above)
      were landing real, unrelated changes to it throughout this pass; the `Ships` hookup is
      four lines (an import, a construction, one `update()` call, one `window.WANDEROAD` entry)
      chosen to sit beside the existing `water`/`props` lines rather than restructure anything
      nearby. Also observed, worth recording: partway through this pass every uncommitted change
      in the working tree — this entry's own files included, and every other concurrent
      session's — was wiped back to HEAD by something outside any of these sessions (git diff
      went clean repo-wide, not just for this pass's files); nobody here ran a destructive git
      command, so it was external to this workflow. Everything in this entry was re-applied
      after and re-verified green; flagged in case it recurs. `npm test` green throughout
      (`bench-car`, `bench-slope`, `diag-water` 0 underwater, `diag-cliffs` 0.009% against the
      0.019% ceiling, `diag-seam` all passed) — nothing in this pass touches terrain, road or
      collision geometry.

## Done

- [x] **Valley mist ("from the original") — shipped, and the shader-killing bug was ONE
      reserved word.** (2026-07-27) The reverted implementation (analytic exponential-density
      mist integral in `aerial()`, `uMist` in GL_UNI, horizon bands in `skyDome`/`skyDomeLite`,
      its own `mstHash`/`mstNoise` pair) was reapplied from the saved backups and the real
      fault hunted down on a live GPU rather than theorised about. It was NOT an instruction
      limit, NOT a uniform limit, NOT the GL_LIGHT/CLOUD_FS chunk interaction: the layering
      variable was named `patch`, and **`patch` is a reserved word in GLSL ES 3.00** (kept for
      tessellation). ANGLE rejects it at compile ("ERROR: 'patch' : Illegal use of reserved
      word"), the chunk lives in GL_LIGHT which every material concatenates, so all eleven
      materials failed and the game went black — on the real GTX 1060/ANGLE-D3D11 exactly as
      under SwiftShader (both were captured; the headless suite on this machine actually runs
      the real GPU). Renamed to `mstPatch` (comment at the site tells the story), updated
      `tools/diag-mist.mjs`'s source-text assertion to match. Static node-side checks can
      never catch this class of bug; only a GPU compile can — which is the whole lesson of
      the incident, now twice over. Verified: zero console errors at boot, mist visibly
      pooling in the low valleys from a 137 m ridge (screenshot), silvery veil over distant
      lake water, near field crisp, summits clear; `node tools/diag-mist.mjs` ALL CHECKS
      PASSED; `npm test` green; `npm run test:browser` 40/40 "THE GAME WORKS".

- [x] **"Alpine start should be in the mountains" (operator) — spawn now biased to altitude,
      preset-driven, water-safe.** (2026-07-27) `findSpawn()` takes `opts.highBias` (default
      0 — the other five presets score bit-identically, since the credit term multiplies to
      exactly zero); the alpine preset sets `spawnHigh: 1` and `main.js` passes it for the
      initial spawn only (rescues stay unbiased — a rescue should find the nearest sane road,
      not march you back up a massif). The credit: up to 800 points for up to 400 m of road
      profile altitude — deliberately UNDER the saturated grade penalty (900) so the search
      picks the gentlest road up the mountain, and three orders over the distance term so
      altitude beats proximity. The W8 waterMargin gate is untouched and still rejects wet
      candidates before scoring sees them. Measured across seeds (before → after, all
      on-road at 0.0 m, all dry by 400+ m, grades 1.8–4.7%): 20260726: 8.6 m → 470.2 m
      (massif 480 m at 291 m); seed 1: 86 m → 415 m; seed 7: 218 m → 516 m; seed 12345:
      6.4 m → 452 m; seed 999: already at 570 m, unchanged. Determinism re-run: identical.
      `node tools/diag-spawn-water.mjs`: ALL DRY. In-game screenshot at the real alpine
      spawn: y=477 m mountain junction with a gas station in reach. Suite 40/40.

- [x] **The car fell through the road, repeatedly, in real driving.** Reported by the operator
      twice while playing. The drawn tarmac and the ground the car actually stood on were built
      from two different elevation profiles: `render/road.js` drew the ribbon from the plain
      per-edge height, while `RoadField` (what the terrain is carved to) additionally runs
      `levelCrossings()` to pull lanes level with the roads they cross — and that second pass
      never reached the renderer. Worst measured gap: **40.22 m**. A second, smaller mechanism
      (`RoadField.carve()`'s weighted-mean blend, which can place the drivable shelf BETWEEN two
      nearby roads rather than under either one) added up to 15.7 m more at some crossings.
      Every existing check — R1, R2, diag-water, diag-cliffs — read the road height and the
      ground height out of the same `RoadField` and so agreed with itself by construction,
      blind to what was actually drawn.

      Fixed by giving the renderer the same fully-processed profile the terrain is carved to,
      plus adaptive ribbon refinement (bisecting a ~6 m span down to 0.375 m wherever the
      carved ground turns sharply inside it — a chord can fly over a real dip otherwise).
      Driving the real autopilot 26 km before and after: **1.144 fall-through events/km ->
      0.115/km**, worst single event **40.22 m -> 0.43 m**. `node tools/diag-fallthrough.mjs`.
      New permanent guard wired into `npm test`: `node tools/diag-seam.mjs` (1.3 s, no server,
      no browser) — S1 asks three differently-boxed samplers for the same point and demands
      the same answer, S2 walks the real ribbon geometry vertex by vertex against the ground,
      S3 checks edges meeting at a node meet at one height. The pre-fix tree fails S1 by 3.8 m
      and S2 by 24 m; the fixed one passes both at 0.0000–0.0063 m.

      Two things RULED OUT along the way, by measurement, so nobody re-suspects them: the R5
      lateral road offset is not the cause (drawn and physics edges agree in XY to 0.00e+0 m);
      the streaming worker's mesh and the car's main-thread height query are not the cause
      either (agree to 0.024 m over 10.5 km, two independent harnesses). One residual, left
      alone deliberately: 3 events in 26 km, all under 0.5 m, at one specific spot where two
      arterials converge 8.6 m apart — doubling the ribbon's ring density would clear it at 2x
      build cost for a sub-metre artefact, which was not worth taking.

- [x] **Off-road was not slow enough, and the ceiling meant to stop it was dead code.** The
      hard off-road speed cap clamped `driveForce` sixty lines AFTER `fxTotal` had already been
      summed from it, so it had never once limited anything — off-road top speed was set purely
      by rolling resistance, and the "100 km/h off-road" ceiling was decoration. Moved above the
      force sum and set to 44 km/h. Off-road went from 61-65 km/h to 44, and the check passes at
      the worst on-road figure the suite produces, not just the average. 36/40 to **37/40**.
      Same failure class as the brakes: a number declared in one place and never reaching the
      solver. Worth grepping for others — the Rally's `offRoad: 1.35` in the fleet is the next
      suspect, it appears nowhere outside garage.js.

- [x] **Brakes.** Three things were wrong at once: each car's `brakeMul` was declared in the
      fleet and never applied, so the Patrol's "strongest brakes in the fleet" were the
      Estate's; ABS gave back 12% of every stop where real ABS loses a few per cent; and the
      pedal took 120 ms to reach full, a tenth of the stop. 100-0 km/h on tarmac went from
      ~34 m to **27.6 m**.

- [x] **Roads crossed each other at different heights** — 3 of 10 crossings out by up to
      1.52 m, which is a lane visibly passing over or under a road and the gap the player fell
      through. Crossings are now levelled: the arterial keeps its height and the lane is
      pulled to match, feathered along the lane so it arrives level rather than stepping, and
      lanes yield to each other in a stable key order so no pair can oscillate. R1 and R2 both
      went to 0. Cliffs improved to 0.027% as a side effect.

- [x] **Auto-drive drove itself off the road** — the cross-track term was ADDED when it had to
      be subtracted. `lateral` is positive when the car is screen-left and the solver's
      positive steer also turns left, so the correction pushed the car further out; raising
      its gain from 0.55 to 3.2 turned a slow drift into a confident exit. Third time this
      project has been bitten by three.js putting +X on your left down +Z. Ten runs at a
      kilometre went 0/10 to 3/4 on the first check after the fix.
- [x] Engine braking scaled as (1 - throttle), so quarter throttle applied three quarters of
      the retarding torque and a steady cruise was impossible. Now vanishes by quarter
      throttle.
- [x] A reverse deadlock: the auto-pilot's lost-road brake engaged reverse, which then only
      cleared while moving forwards — but the car was creeping backwards.
- [x] Two windows on one machine were one player; `?seat=2` forks the identity. **Half of that
      was not true:** `seatSuffix()` was defined and never called, so the storage keys were
      read unsuffixed and `?seat=2` did nothing at all. Now wired, findable from the Garage
      ("Drive together"), written up in `docs/MULTIPLAYER.md`, and proved by
      `node tools/net-test.mjs` — two Node clients against the live backend, each asserting
      the other is in its peer list.
- [x] The streak check was measuring the DRIVER, not the streak: it held W in a straight line
      and passed only when the road happened to be straight. It now drives on the road.

- [x] **The garage covered the game.** `#menu { display: grid }` overrode the `hidden`
      attribute, so the garage was permanently on screen and Drive appeared to do nothing.
      The game shipped unplayable. Fixed, and tools/shoot.mjs now asserts the garage is
      genuinely INVISIBLE on load and after Drive — a flag being set is not a thing being
      hidden.
- [x] Auto-drive (G, or the garage). Stanley controller, brakes for the corner ahead, hands
      back the moment you touch anything.

- [x] Handedness — steering was inverted (three's +X is screen-LEFT looking down +Z)
- [x] Gravity resolved on slopes — cliffs unclimbable, hills pull you back, no more hovercraft
- [x] Engine braking through the gearbox — coasting ends in 29 s instead of never
- [x] Full stick is a lateral acceleration, not an angle — the go-kart feel is gone
- [x] Roads are real geometry: tarmac, edge lines, dashed centre, marker posts, chevrons
- [x] Road carve accumulates over every nearby road — cliffs beside roads down 11x, Z-kink gone
- [x] Roads lifted clear of water — 0 of 1425 samples underwater, was 28%
- [x] Earthworks clamped to 18 m so an embankment can never become a wall
- [x] Terrain softened — amplitudes cut, per-octave slope gain lowered
- [x] Seven CC0 Quaternius cars, re-materialled into the painted shader
- [x] Wheel rig rebuilt — corners grouped, steering and rolling on separate nodes
- [x] Garage menu (Esc/M): change car and feel live, change land with a reload
- [x] R puts you back on the road; V cycles cars; N cycles the radio
- [x] Whole game slowed ~45%, brakes roughly doubled — cozy, and it stops
- [x] Off-road is loose gravel: slow, bumpy, hard to turn, hard-capped at 100 km/h
- [x] Automatic reverse — hold the brake at a standstill
- [x] Engine audio dropped two octaves and roughly halved; the shriek is gone
- [x] Generative radio, two stations, original and unlicensed

- [x] **C2's brake run-up was measuring nothing, twice over, before this fix.** A blind held W
      hit the off-road ceiling (43.9 km/h) on this seed's bends; switching to full auto-drive
      "fixed" that but capped at 35 km/h instead, because `autopilot.js`'s cruise target is
      `lerp(this.cruise, 8, bend)` — it tops out AT `this.cruise` on a dead straight, since
      auto-drive was never tuned to go fast. Placing the car on a straighter stretch (tried
      first) changed nothing, because the ceiling was never about the road. Fixed by sharing
      O2's already-proven steered run-up (`roadRunUp`, real KeyA/KeyD pure pursuit, no
      autopilot, no analogue, no cheat — moved up so both checks use one copy) instead of
      either blind throttle or the autopilot's own governor. **35 km/h capped -> 109 km/h**,
      100-0 in 40 m. `npm run test:browser` **39/40 -> 40/40**, "THE GAME WORKS", zero variance
      across three fresh runs, then confirmed again against the live deploy.

## Rules the cron must not break

- **`npm run test:browser` must report 40/40 and print "THE GAME WORKS" before anything
  ships, and `npm run test:live` must do the same after.** (This count was 27 when the line was
  first written and grew as the suite did; if it goes stale again, trust the suite's own
  printed total over this number.) It drives a real headless Chrome with real key events and
  measures real visibility. It exists because the game once shipped completely unplayable
  behind a suite that passed.

- No GPL or AGPL. MIT, Apache-2.0, BSD, CC0, public domain only. Record every licence in
  docs/CREDITS.md.
- `node tools/bench-car.mjs` must pass in full before anything ships.
- `node tools/diag-water.mjs` must stay at 0 underwater road samples.
- `node tools/diag-collide.mjs` must stay at 0 mismatches — it is the only thing that notices
  when a tree is redrawn and its hitbox is not. `node tools/bench-impact.mjs` and
  `node tools/bench-rescue.mjs` must pass in full.
- `node tools/diag-cliffs.mjs` must not get worse than the last recorded figure (**0.019%**).
  It only ever measures the DEFAULT preset — it never calls applyTerrain — so check
  `node tools/diag-relief.mjs` too, which runs the same test on all six (alpine is the one
  that grows walls: 0.078%, everything else under 0.005%).
- `node tools/diag-spawn-water.mjs` must stay at 0 wet results on every section (see W8).
  diag-water.mjs and diag-cliffs.mjs do not catch a road CUTTING sitting below its local
  water table — they gate on raw land — so this is the only check that actually exercises
  findSpawn/backToRoad's water safety; do not let it quietly go back to reporting 0 because
  nobody is calling it any more.
- Never regress a passing test to make a new feature work.
