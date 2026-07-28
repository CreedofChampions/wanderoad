<!-- created by AI -->
# Boat + Loot — implementation spec

One feature, three workstreams. This file is the single source of truth for the build;
implementers follow it exactly and note deviations at the bottom. Written 2026-07-28.

## What ships (player-facing)

1. **Wind Waker foam drawings** on open water — white hand-drawn scribble lines slowly
   drifting on big lakes/seas, ON TOP of the existing water colours. Rivers/ponds unchanged.
2. **Gold coins on roads** — clusters along the carriageway, drive through to collect.
3. **The boat — the last unlock.** Collect `BOAT_UNLOCK_COINS = 500` coins and the car
   gains boat mode. Until then, driving into deep water off-road soft-stops the car with
   "you need a boat to enter the water" (no more instant rescue-teleport at the shoreline).
4. **Boat mode** — once unlocked, drive straight into the water: the car becomes a small
   painted boat (same visual family as the anchored ships), cozy arcade handling, gentle
   bob. Drive back onto a beach to become a car again.
5. **Diamonds at sea** — rarer gems on open water, collectable only by boat.
6. **HUD** — coin + gem counter widget with "boat at 500" progress; toasts + distinct
   pickup sounds for coin / gem / unlock.

## Hard rules

- Determinism: all placement is a pure function of `(x, z, SEED)`. No `Math.random`.
- Style: painted-solid pipeline (`src/render/painted.js`), palette keys only, no new hex.
- Zero external assets. No textures. No new dependencies. No Nintendo-derived content.
- Persistence: ONE new localStorage key `wanderoad.loot.v1` = `{coins, gems, boat}`.
  Collected-this-session Set in memory only (fuel-can pattern); collectibles respawn
  next session by design.
- Multiplayer untouched: no wire-format change; collectibles/boat are client-local.
  Remote ghosts keep rendering as cars even on water (documented limitation).
- `?cheat` (garage.js `cheatOn()`) also unlocks the boat.
- Every new file starts with the house-style header comment explaining what it is and why.
- Match the codebase's comment/naming idiom exactly. No `<!-- -->` tags in JS.

## Workstream A — foam drawings (touches ONLY `src/render/water.js`)

In `WATER_FS`, after the flow-ribbons block and before the sun-glitter block, add a
"foam drawings" term:

- Domain: the existing ripple frame `q`, scaled to ~18 m features (`fq = q * 0.055`).
- Warp: `vec2 warp = vec2(pn2(fq*0.35 + 3.7), pn2(fq*0.35 + 9.2)) * 1.8;` then
  `vec2 fp = fq + warp - adv*(uTime*0.010) - vec2(uTime*0.008, uTime*0.003);`
  (slow drift — the lines visibly crawl, Wind Waker style).
- Two ridge-line bands at zero-crossings of `pn2`:
  `float l1 = pn2(fp); float l2 = pn2(fp*1.9 + 17.0);`
  `float line1 = 1.0 - smoothstep(0.045, 0.13, abs(l1));`
  `float line2 = 1.0 - smoothstep(0.040, 0.11, abs(l2));`
- Dark under-copy offset (the WW double line): sample `l1` again at `fp + vec2(0.06)`,
  make a darker line from it with `K_SHADOW`-tinted `${C.wDeepShade}`, drawn UNDER the
  white, weight ~0.35 of the white's.
- White = `${C.wFoam}`, applied `col = mix(col, ..., scrib * gate)`.
- Gate: `calm` (the existing openness smoothstep) times `bandLimit(fw, vec2(0.055*2.0))`
  times `smoothstep(0.9, 2.2, depth)` — open sea only, deep water only, AA'd out at
  distance. Overall max opacity ~0.42 so the existing body plates stay legible.
- Do NOT touch the body colours, reflection, glitter, foam-shore or rim blocks. The
  current look survives underneath — the drawings are an overlay.
- `node tools/diag-watershader.mjs` must still pass (it static-gates the GLSL); update
  its expectations only if it asserts exact line counts.

## Workstream B — loot (coins, gems, wallet, HUD, audio) 

New files + minimal wiring. Copy the fuel-can idiom throughout.

### `src/world/loot.js` (pure placement, no three.js)
- `coinsInBox(x0, z0, x1, z1, seed)` → array of `{x, z, y, id}`.
  Walk `edgesInBox()` (roads.js:1392) with the arc-table pattern of `fuelCansInBox`
  (world/props.js:1026): slot every `COIN_SLOT = 64` m of arc, hash-gated accept
  `COIN_SLOT_P = 0.42`, each accepted slot emits a CLUSTER of 3–5 coins spaced 7 m
  along the tangent, ON the carriageway centreline ± small lateral jitter (±width*0.2).
  Coin y = road surface + `COIN_HOVER = 0.6`. id = quantised world pos string.
- `gemsForTile(gi, gj, seed)` → `{x, z, y, id} | null` for a `GEM_TILE = 260` m lattice
  (ships.js lattice idiom): jittered candidate, gates in cheap→costly order:
  water depth ≥ 1.2 m (`freeboardAt`-style), `waterOpenness ≥ 0.55`, `roadDistance ≥ 50`,
  accept draw `GEM_ACCEPT_P = 0.5`. Gem y = water level + `GEM_HOVER = 0.9`.
- Export all tunables.

### `src/render/loot.js` (renderer + pickup)
- `class Loot { constructor({seed, scene}) ; update(dt, car, boatActive) ; drainCoins() ;
  drainGems() ; dispose() ; stats }`.
- Rolling window: coins piggyback the props tile walk shape (own `TILE = 384`,
  `RANGE = 900`); gems the ships lattice (`RANGE = 1200`). Individually-tracked small
  meshes (ships pattern, render/props.js `_updateCans` pattern for collect).
- Coin mesh: painted gold disc — `pcyl` radius 0.55, thickness 0.12, colour
  `P.paintB`/`lineYellow` mix, standing on edge; spin `rotation.y += 2.2*dt`, bob ±0.12.
- Gem mesh: octahedron (two `ptri`-based pyramids or THREE OctahedronGeometry with the
  painted material path — whichever `painted.js` supports cleanly), colour `P.glass`
  brightened toward `P.wSpark`, scale ~0.8, slow spin 1.1 rad/s, bob ±0.2.
- Pickup: coins radius `COIN_RADIUS = 7` m from car; gems `GEM_RADIUS = 10` m and only
  when `boatActive`. Collected → remove mesh, add id to session Set, bump pending
  counter; `drainCoins()`/`drainGems()` return-and-zero (fuel-can drain pattern).

### `src/game/wallet.js`
- `class Wallet { coins, gems, boat, addCoins(n), addGems(n), get boatUnlocked, save() }`.
- `boatUnlocked = boat || coins >= BOAT_UNLOCK_COINS || cheatOn()`; when the coin add
  crosses the threshold set `boat = true`, persist, and queue a one-shot event
  `{kind:'boat-unlock'}` drained by main (streak `drain()` pattern).
- localStorage `wanderoad.loot.v1`, debounced writes (≤1 per 2 s), flush on
  `visibilitychange` (streak.js flush pattern). `BOAT_UNLOCK_COINS = 500` lives here.

### `src/ui/lootCounter.js`
- fuelGauge.js pattern exactly: own `<style id="lootCounterCss">`, root div appended to
  `hud.root`, `update(dt, wallet)`. Shows `🪙 n` `💎 n` (text glyphs are fine, match HUD
  font) + a thin progress bar "boat at 500" that becomes "⛵ boat unlocked" after. Top
  placement clear of the existing fuel gauge and streak figure (check hud layout, pick a
  corner that is empty at 1280×800).

### `src/audio/engine.js`
- Add `coin()` (short bright two-note blip, distinct from `pickup()`) and `gem()`
  (three-note shimmer) cloning the `pickup()` oscillator-triple shape. Unlock reuses
  existing `chime()`.

### `src/main.js` wiring (keep the diff tight)
- Construct `wallet`, `loot`, `lootCounter` beside the existing systems.
- In `frame()` after `ships.update(...)`: `loot.update(dt, car, boatActive)` then
  `const c = loot.drainCoins(); if (c) { wallet.addCoins(c); audio.coin(); }` same for
  gems (`audio.gem()`; `hud.say('a diamond! ' + wallet.gems, 1.6)`).
- Drain wallet events: boat-unlock → `audio.chime(); hud.say('the boat is yours — drive into the water', 4)`.
- `lootCounter.update(dt, wallet)` beside `fuelGauge.update(...)`.

### `tools/diag-loot.mjs`
- No renderer. Prints coins/km along a real driven route (reuse diag-stations walk
  pattern) and gems/km² over a 6 km square; asserts coins/km in [15, 45] and
  ≥ 3 gems within 1.5 km of some open-water point on the shipped seed. Wire into
  `npm test` chain in package.json.

## Workstream C — boat mode + water barrier

### `src/render/ships.js`
- Export `buildPlayerBoat()`: refactor the internals of `buildBoat()` so the player
  variant can pin `L = 5.2` (car-scale), always-cabin, always mast+pennant, hull colour
  `paintC`, and return the finished `Mesh` (shared painted material). Anchored-ships
  behaviour unchanged.

### `src/game/boat.js` (new)
- `class BoatMode { constructor({wallet, say, terrain(){}, seed}) ; update(dt, car, surf, input) ;
  get active ; get blockedToastPending }` — a small state machine, NOT a second physics
  engine file:
  - **Detection**: reuse rescue.js's exact gates — `waterDepth(surf)` (copy the helper or
    import-share it from rescue.js) and `surf.onRoad < 0.45`.
  - **Locked barrier**: probe the surface ~2.5 m ahead of the car along its velocity; if
    `depth > 0.45` and off-road and `!wallet.boatUnlocked`: damp `car.vx/vz` hard
    (exponential toward 0, ~6/s — a soft cushion, not a wall-slam) and request the toast
    `'you need a boat to enter the water'` (throttle: ≥ 4 s between says).
  - **Enter**: unlocked and `depth at car > 0.6` → `active = true`. Splash: `audio.thump(0.4)`
    is fine. Store entry speed.
  - **Boat dynamics while active** (runs INSTEAD of `car.update()`; car solver untouched):
    scalar arcade model in the tslda spirit — `speed += (throttle*ACCEL - speed*DRAG)*dt`,
    `yaw += steer * TURN * min(speed/8, 1) * dt`, `car.x/z += heading*speed*dt`,
    `car.y = waterLevel + bob(sin)`, write `car.vx/vz/speed/yaw` back so camera, net
    packets, HUD speed and trail all keep working. Tune: max ~34 kph, accel to max in
    ~4 s, turn radius ~14 m at speed, roll into turns ±0.06 rad, bob amp 0.14/0.11 Hz
    (the anchored-ship numbers). Reverse at S, slow.
  - **Exit**: `depth < 0.2` at the boat's position → `active = false`, `car.placeAt`-style
    reseat on the ground (keep heading + a chunk of speed), car solver resumes.
- **Rescue integration**: `rescue.update` in main.js gets skipped when
  `boatMode.active || (wallet.boatUnlocked && inDeepWater)`. Simplest: pass a predicate
  into Rescue's constructor options (`skip: () => ...`) and early-return in its update.
- **Fuel**: `fuel.update` burn set to false while `boatMode.active` (cozy sailing is free).
- **Streak**: no change (off-road grace already ends streaks in water).
- **Visual swap** in main.js's model-placement block: when active, hide `model.group`,
  show the player boat mesh at `car.x, car.y, car.z` with `rotation.y = car.yaw` + the
  roll/pitch bob; when inactive, the reverse. Boat mesh created once, lazily.
- **`T` (back to road)** while boating: works as-is (backToRoad reseats on land →
  exit condition fires next frame; verify).
- **`R`/menu reset**: same.

### `tools/bench-boat.mjs`
- Headless: construct a Vehicle on the shipped seed at a known lakeshore (find one by
  scanning waterFn), simulate locked approach → assert speed damped below 2 kph within
  3 s and position never deeper than 1 m; then unlock (wallet stub) → assert mode enters,
  20 s of throttle moves it > 60 m across water, exit on the far shore returns car mode.
  Wire into `npm test`.

## Order & ownership

- A touches only `water.js`. B owns `main.js` first; C rebases on B's main.js after.
  (B and C MUST NOT run concurrently — both edit main.js.)
- After all three: `npm test` green (including the two new tools) + `npm run build` clean.

## Acceptance (playtest script)

1. Fresh profile (`localStorage.clear()`): coins visible on the road within 60 s of
   driving; counter increments; coin sfx plays.
2. Drive at a lake off-road: car cushions to a stop at the waterline, toast shows;
   NO teleport-rescue fires at the shoreline approach.
3. `?cheat`: drive into the lake → boat mode; drive around; wake of the existing
   anchored ships style bob; return to shore → car mode.
4. Collect a diamond by boat; counter + sfx.
5. Foam drawings visible on the open lake, current colours intact underneath; rivers
   look unchanged.
6. 60 fps hold on the same hardware profile as before (no new per-frame allocation in
   the steady state).

## Deviations log

(implementers append here)

### Workstream B (loot)

- **`boatActive` placeholder in main.js.** Workstream C (`src/game/boat.js`) had not landed yet
  when B ran, so `frame()` wires `loot.update(dt, car, boatActive)` off a local
  `const boatActive = false;` with a comment pointing at this entry. Gems are placed and
  visible but never collectible until C replaces that constant with `boatMode.active` — the
  honest behaviour per the spec ("gems... collectable only by boat") rather than faking an
  unlock. C's rebase should search main.js for `boatActive` and replace the one line.
- **`world/loot.js` imports `render/water.js`'s `waterOpenness()`.** Every other `world/*.js`
  file only imports from other `world/` modules or `core/`; this is the first `world/` file to
  reach into `render/`. Done because `gemsForTile`'s large-open-water gate is spec'd to be
  identical to `render/ships.js`'s own (same threshold, same reasoning), and `waterOpenness()`
  is owned by `render/water.js` (it also drives that shader's calm/foam terms) — duplicating
  the flood-proxy math a second time would be a second source of truth for "is this a big
  lake". `world/loot.js` itself still builds and animates nothing (no three.js/DOM), so the
  "pure placement" property holds; only its import graph now crosses the world/render line.
  Flagging this because every existing `world/` file's own header states "no three.js and no
  DOM" as an architectural boundary, and this is the first exception to the *import direction*
  that boundary has always implied.
- **`world/loot.js`/`world/props.js` arc-walk duplication.** `coinsInBox` needed its own copy
  of `edgeIds`/`arcTable`/`atArc` (world/props.js keeps these private, unexported, and no
  shared module exists for them). This is the second copy of a ten-line pattern in the
  codebase now (props.js had the only one before); if a third placement domain ever needs the
  same walk, it is probably worth factoring into `world/roads.js` itself.
- **`ui/lootCounter.js` corner placement.** The spec asks for "a corner that is empty at
  1280x800" but every corner already has something (musicPanel top-left, players top-right,
  toast/openMenu top-centre, speedo+fuelGauge bottom-right, place+gameTitle bottom-left, streak
  bottom-centre, unlock bar the full bottom edge). Docked top-right, stacked below `#players`
  with a generous `clamp(5.6rem, 13vw, 7.2rem)` top offset — the same "stack within a corner"
  idiom fuelGauge already uses above the speedo — rather than reserve a genuinely new corner
  that doesn't exist on this layout.
- **Coin/gem bob frequencies (`COIN_BOB_HZ` 0.6, `GEM_BOB_HZ` 0.38) and the coin cluster's
  in-slot start jitter are this file's own numeric choices**, not named in the spec (which
  fixed the bob *amplitudes* and the coin *spin rate* but not the bob rates). Picked between
  the floating fuel can's 0.52 Hz and the anchored ship's 0.11 Hz, per render/loot.js's own
  comment.
- **`tools/diag-loot.mjs` duplicates `tools/diag-stations.mjs`'s route-walk helpers**
  (`walkOptions`/`driveRoute`/`edgeAt`/`edgeLength`) rather than importing them, because that
  file is a script with no exports (same reasoning as the arc-walk duplication above).
- Both `npm test` assertions pass on the shipped seed (20260726) without any tuning beyond the
  spec's own numbers: 26.4 coins/km (want 15–45) along a real 381.8 km connected drive, and a
  densest 1.5 km gem neighbourhood of 36 (want ≥ 3) over a real 6 km square.

- Workstream A (foam drawings, `src/render/water.js`): none. Block inserted exactly as
  specified between the flow-ribbons and sun-glitter blocks; `node tools/diag-watershader.mjs`
  passes with all existing blocks byte-identical (36 pure insertions, 0 deletions per `git diff`).

### Workstream C (boat mode + water barrier)

- **Rebased onto B's `boatActive` placeholder as instructed.** `src/main.js`'s `loot.update(dt,
  car, boatActive)` line now reads `loot.update(dt, car, boatMode.active)`; the local
  `const boatActive = false;` and its pointer comment are gone. Gems are collectible by boat now,
  as B's own deviation note said they would become once this landed.
- **Dropped `seed` from `BoatMode`'s constructor.** The spec's own sketch listed
  `constructor({wallet, say, terrain(){}, seed})`, but this class places nothing (no lattice, no
  candidate site, nothing gated by a rarity draw) and rolls no RNG — it is a live state machine
  over the car's OWN already-deterministic position, not a generator. Accepting an unread `seed`
  would be exactly the "numbers declared and never applied" failure `car/vehicle.js`'s own SAND
  block comment says this project has already been bitten by twice; left out rather than repeated
  a third time. `wallet`/`say`/`terrain` are all read.
- **`terrain(){}` implemented as a zero-arg callback returning the CURRENT sampler**
  (`terrain: () => car.terrain`), not a `(x, z) => surf` probe function. Matches the forward-
  reference idiom `main.js` already uses for `recover`/`say`/`ping` (all bound before the values
  they close over exist) and, more importantly, the SAME reason those need it: `main.js`
  reassigns `car.terrain` every frame (`car.terrain = localFor(car.x, car.z)`, a local sampler
  that follows the player), so a value captured once at construction goes stale the first time
  the player crosses that sampler's own ~420 m box. `BoatMode._stepBarrier()` calls
  `this.terrain().surface(x, z)` itself to probe the point ahead.
- **`BARRIER_DAMP_RATE` tuned to 14/s, not the spec's own suggested "~6/s".** Measured, not
  guessed: the barrier damps `car.vx/vz` AFTER `car/vehicle.js`'s own solver has already applied
  a full-throttle frame's worth of engine force (main.js calls `car.update()` first, exactly as
  the spec's own wiring note asks), so it is a genuine, ongoing tug-of-war against a real engine,
  not a one-shot correction. At 6/s a floored throttle and the exponential decay converge to a
  nonzero equilibrium speed above the bench's own 2 km/h bar; raised until `tools/bench-boat.mjs`
  held true against the REAL solver with real margin (measured: barrier engages at 33.9 km/h,
  under 2 km/h 0.32 s later, never deeper than 0.97 m — all printed by the bench's own table).
  Still explicitly a "soft cushion, not a wall-slam": the car is bled down over several frames,
  never zeroed outright the way `Rescue._place()`'s teleport does.
- **`Rescue`'s `skip` option takes `(inWater, depth)`, not the spec sketch's zero-arg
  `skip: () => ...`.** `rescue.js`'s own `update()` already computes `inWater` off the exact
  gates the spec's "Rescue integration" bullet asks for ("`boatMode.active || (wallet.boatUnlocked
  && inDeepWater)`" — `inDeepWater` IS that `inWater`), so passing it through lets `main.js` wire
  `skip: (inWater) => boatMode.active || (wallet.boatUnlocked && inWater)` verbatim against the
  spec's own formula instead of re-deriving "is this deep off-road water" a second time against a
  second, possibly-drifting threshold — one source of truth for the gate, the same "no duplicate
  logic" call `world/loot.js`'s B-workstream deviation above makes the other way (reaching into
  `render/water.js` rather than re-deriving `waterOpenness()`), for the same reason.
- **`buildPlayerBoat()`'s mesh is built once at `boot()`, not deferred to the actual unlock.**
  The spec says "Boat mesh created once, lazily"; "created once" (never rebuilt, exactly the
  `buildCar()` idiom) is honoured, but the "lazily" half — deferring construction to the first
  frame `wallet.boatUnlocked` goes true — was judged not worth a null-check branch in the
  per-frame model-placement block for a mesh that is a handful of painted-solid triangles sharing
  the anchored fleet's own already-compiled material (`ships.material`). Built and hidden
  (`.visible = false`) at boot instead, alongside `wallet`/`loot`/`lootCounter`.
- **`R`/`T` (`backToRoad()`) while boating: verified, not special-cased.** `input.tapped('reset')`
  already fires `backToRoad()` unconditionally (both `KeyR` and `KeyT` map to the same `reset`
  action — see `car/input.js`'s own comment, "it was on T"), which reseats the car on dry land
  earlier in the SAME tick. `BoatMode.update()` samples a fresh `surf` at the car's (now dry)
  position every frame and checks the EXIT condition first, before applying any of that frame's
  arcade dynamics — so the very next `boatMode.update()` call reads shallow water and exits
  cleanly, with no boat-specific code in `backToRoad()` or the reset key handler at all.
- **`tools/bench-boat.mjs` duplicates `tools/bench-rescue.mjs`'s lakeside-road finder**
  (`findLakesideRoad()`) rather than importing it — same reasoning as workstream B's own
  arc-walk/route-walk duplications above: these are scripts with no exports.
- **Pre-existing, unrelated `tools/bench-rescue.mjs` failure noted, not fixed.** Running that
  bench (not part of `npm test`) during verification turned up one failing check — "60 s in the
  shallows... want 0 (deepest it got: 0.26 m)" — confirmed via `git stash` to fail IDENTICALLY
  with `src/game/rescue.js` reverted to its pre-workstream-C state, so it predates this work
  (most likely a side effect of the already-merged, uncommitted changes elsewhere in
  `src/world/roads.js`/`src/car/vehicle.js`/`src/render/road.js` shifting where that bench's own
  shelf-point search lands). Out of scope for workstream C (touches neither `rescue.js`'s
  behaviour for a non-boat caller nor anything the shallows scenario exercises — that rig
  constructs `Rescue` with no `skip` option, so `this.skip` is `null` and the new early-return
  never runs) and not in `npm test`'s chain, so left for whichever workstream owns those files.
- `node tools/bench-boat.mjs` passes on the shipped seed (20260726) with real margins throughout:
  locked approach reaches 33.9 km/h before the barrier engages (1.98 s in) and is under 2 km/h
  0.32 s later, never deeper than 0.97 m; unlocked, the boat engages at 2.30 s, covers 188.2 m in
  20 s of throttle (cap 34.0 km/h, exactly `BOAT_MAX_KPH`), and a turn back to the departure shore
  exits cleanly at 24.85 s with a finite, drivable car left behind. Wired into `npm test`. Full
  suite (`npm test`) and `npm run build` both green.
