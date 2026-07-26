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

- [ ] **O2 — off-road is not slow enough.** 61.6 km/h off-road against 91 on, i.e. 68% when the
      requirement is under 55%. "Off-road still feels pretty much like on road right now."
- [ ] **W4 — land presets are nearly flat.** 9 m of relief in a 720 m square.

      **ATTEMPTED AND REVERTED, 26 July.** Raising every amplitude ~1.7x with the wavelength
      taken up in step — which should hold the slope constant, since amplitude over wavelength
      IS the slope — took ground steeper than 45 degrees from 0.027% to **2.77%**, a hundred
      times worse. The reasoning was wrong because relief is a sum of octaves: scaling the
      base amplitude scales every octave's contribution, and the finer octaves have far more
      slope per metre of relief than the base does. Relief has to come from the LOW octaves
      only, which means reshaping `biomeRelief` per biome rather than scaling its amplitude.
      That is a real piece of work, not a tuning pass. 8.5 m of relief in a 720 m square. "I'll push
      escape and click on alpine and I'm on like a flatline." The preset reaches the workers
      now, so the fault is in the amplitudes themselves, not the plumbing.
- [ ] **W5 — nothing to head towards.** Best rise within 4 km is 33 m. The operator wants a
      landmark visible from spawn: "there's somewhere to go, you know."
- [ ] **R5 — roads still do not curve.** 105 degrees of turn per km; a road with real bends is
      well over 200. "They're still straight lines attached to each other." NOTE the reverted
      attempt recorded below — do not retry it as a tweak to nodePos.
- [ ] **T2 — the car looks washed out.** Peak saturation 0.299 on the body. "It looks almost
      transparent, as if the colour is not added properly."
- [ ] **O1 — off-road is judged at the car's centre.** "If either wheel leaves the road, it
      should tell you that you're off-road." Not yet measured; needs a per-wheel road query.
- [ ] **W1 — trees do not stop you.** "The trees should have hitboxes and when you hit them you
      should come to a dead stop." Currently a glancing impulse.
- [ ] **W7 — water is a trap.** Auto-recover to the road after a second in water, and find a
      better-looking water treatment.
- [ ] **G1 — the streak is not clear enough.** The operator wants how far he has gone without
      leaving the road to be obvious, not a small number in a corner.
- [ ] **G6 — multiplayer has never been played.** "How do I test the multiplayer aspect?" Two
      headless clients, each must appear in the other's peer list, and there should be a plain
      way for a human to join a second window.
- [ ] **C6 — the car points into the hill when climbing.**
- [ ] **O4 — no rollover off-road.** "There should be the potential to flip over like a real car."

## Next

Newly asked for, not yet started:

- [ ] **Intro cinematic.** A video-style playthrough on first load, in the spirit of Ocarina of
      Time's opening — the world shown to you before you drive it. No reference to the original
      pen's UI, just that kind of unhurried camera.
- [ ] **Cinematic camera during auto-drive.** When the car is driving itself the camera should
      pan around and show the world, not sit behind the boot.
- [ ] **Positional ambient audio.** The sea gets louder as you approach it; birds around trees.
- [ ] **Forests, not scatter.** Dense woods in some places, sparse in others, and plains with no
      trees at all. Today the density is uniform per biome.
- [ ] **Flower beds** and other soft ground cover.
- [ ] **100 Ghibli-flavoured props** as rare points of interest, including the petrol station.
      CC0 only — check every licence and log it in docs/CREDITS.md.
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
- [x] Two windows on one machine were one player; `?seat=2` forks the identity.
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
- `node tools/diag-cliffs.mjs` must not get worse than the last recorded figure (0.024%).
- Never regress a passing test to make a new feature work.
