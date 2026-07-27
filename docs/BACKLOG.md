<!-- created by AI -->
# Wanderoad — backlog

The source of truth for what to do next. The improvement cron reads this at the top of every
pass and updates it at the bottom. Ordered by value, not by ease.

**The filter for every item: this is a COZY driving game.** Calm, unhurried, pretty. If a
change makes it faster, louder or more stressful, it is the wrong change even if it is
technically better.

---

## Now — the failing requirements, worst first

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
- [ ] **O1 — off-road is judged at the car's centre.** "If either wheel leaves the road, it
      should tell you that you're off-road." Not yet measured; needs a per-wheel road query.
- [x] **W1 — trees do not stop you.** Now a dead stop: 126.7 / 157.1 / 181.4 km/h all become
      **0.00 km/h** on a square hit, at rest 1.58 m out from a trunk whose contact distance is
      1.55 m. The narrow phase is SWEPT, so nothing tunnels — caught at every frame time up to
      dt 0.1 and every step length up to 40 m. Colliders are now measured against the DRAWN
      trunk (`TRUNK_R` in `game/collide.js`, checked by `node tools/diag-collide.mjs`) and
      centred on the renderer's own instance root, error 0.00e+0 m in x, y and z. The rock and
      fence-post colliders are gone: **nothing draws `scatter.rocks`, `.posts` or `.reeds`**, so
      those were invisible walls — 26 per hectare of highland, up to 2.4 m across. A graze still
      slides (keeps 94% of its speed). `node tools/bench-impact.mjs`.
- [x] **W7 — water is a trap.** `game/rescue.js`. In deep water you are put back on the road
      **1.98 s** after going under (1 s to arm, 1 s of the car settling) and driving again at
      **2.52 s**, via main.js's own `backToRoad()`. Gated on DEPTH (0.6 m) and being off the
      carriageway, so it cannot fight you: 60 s pottering in 0.14 m of shallows, 60 s of
      lakeside road with deep water 9 m off, and twelve 0.9 s dips all give **0 rescues**.
      `node tools/bench-rescue.mjs`. A better-looking water treatment is still open.
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
- [ ] **G1 — the streak is not clear enough.** The operator wants how far he has gone without
      leaving the road to be obvious, not a small number in a corner.
- [ ] **G6 — multiplayer has never been played.** "How do I test the multiplayer aspect?" Two
      headless clients, each must appear in the other's peer list, and there should be a plain
      way for a human to join a second window.
- [ ] **C6 — the car points into the hill when climbing.**
- [ ] **O4 — no rollover off-road.** "There should be the potential to flip over like a real car."

## Next

Newly asked for, not yet started:

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
- [ ] **Positional ambient audio.** The sea gets louder as you approach it; birds around trees.
- [ ] **Forests, not scatter.** Dense woods in some places, sparse in others, and plains with no
      trees at all. Today the density is uniform per biome.
- [ ] **Flower beds** and other soft ground cover.
- [ ] Left by W4/W5, both small and both in someone else's file. `BIOME_TERRAIN.rough` is dead
      — documented as the ridged-vs-fbm mix, read by nothing, each biome hard-codes its own.
      And the alpine preset now has arterials at a 6.6% median / 51% worst gradient, which is a
      mountain pass; the lever is the road profile's smoothing length in `src/world/roads.js`
      (`grade`), not the terrain.
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
- [ ] Weather and horizon effects, inspired by Slow Roads. Explicitly LOW priority: the
      operator's note was "the goal is to wrap up this project soon so we shouldn't get totally
      caught away".

- [ ] Water still looks poor at distance — moire on large sheets, and the shoreline is hard.
- [ ] Grass aliases at 100–300 m even with the angular width floor.
- [ ] The autopilot in tools/shoot.mjs follows roads only loosely. It is a smoke test, not a
      driver, and it should be good enough to be a benchmark.
- [ ] Base44 backend is defined in `base44/` but undeployed — the CLI login is a device-code
      flow that needs one human click.
- [ ] Remote cars are ghosts with no interpolation testing under real latency.
- [ ] Engine audio is still synthesised. RPM-indexed CC0 sample crossfading is the researched
      answer; sources are listed in docs/CREDITS.md.

## Done

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

## Rules the cron must not break

- **`npm run test:browser` must report 27/27 and print "THE GAME WORKS" before anything
  ships, and `npm run test:live` must do the same after.** It drives a real headless Chrome
  with real key events and measures real visibility. It exists because the game once shipped
  completely unplayable behind a suite that passed.

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
