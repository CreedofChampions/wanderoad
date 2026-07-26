<!-- created by AI -->
# Wanderoad — backlog

The source of truth for what to do next. The improvement cron reads this at the top of every
pass and updates it at the bottom. Ordered by value, not by ease.

**The filter for every item: this is a COZY driving game.** Calm, unhurried, pretty. If a
change makes it faster, louder or more stressful, it is the wrong change even if it is
technically better.

---

## Now — the failing requirements, worst first

**BLOCKING, from the last batch — fix before anything else ships:**

- [ ] **G1 regression — the streak banks 0 m.** `npm run test:browser` was banking 185 m and
      now reports 0. Introduced somewhere in the fleet / trail / engine-braking batch. The
      streak is the entire game mechanic, so nothing deploys until this is green. The live
      site was deliberately left on the previous build.
- [ ] **Auto-drive cannot hold a kilometre.** `node tools/streak-runs.mjs` reports 0/10 with a
      median peak of ~40 m, ending "stopped moving". Three causes have already been found and
      fixed by measurement (a reverse deadlock, a look-ahead that read the wrong road, and an
      engine-braking curve that fought the throttle at cruise) and it is still 0/10, so there
      is at least one more. Instrument `car.forces` during an auto-drive run — it is on
      permanently now — rather than guessing again.

**Then, from the measured requirements suite:**

- [ ] **R2 — roads cross each other at different heights.** 3 of 10 crossings mismatched, worst
      1.52 m. This is the operator's "some go under the others, some go above the others… they
      just run over each other" and it is also why he falls through onto a lower plane. Every
      edge that crosses another must share a height there. Junctions need a pinned node height
      that all edges meeting at them adopt.
- [ ] **R1 — terrain stands proud of the road.** 2 of 100 centreline points buried, worst
      0.75 m: "there seem to be these dirt hills that come up from the ground in the middle of
      the road. There should be nothing above a road ever." The carve blends by distance, so
      where two roads' shoulders overlap the blend can leave the ground above the ribbon.
- [ ] **C2 — the brakes are molasses.** 47 m to stop from 100 km/h, want under 40. Brake torque
      was already doubled once; the limit now is the tyre, so this needs a shorter stop through
      weight transfer and a stronger front bias, and it should differ per car by design.
- [ ] **O2 — off-road is not slow enough.** 61.6 km/h off-road against 91 on, i.e. 68% when the
      requirement is under 55%. "Off-road still feels pretty much like on road right now."
- [ ] **W4 — land presets are nearly flat.** 8.5 m of relief in a 720 m square. "I'll push
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
