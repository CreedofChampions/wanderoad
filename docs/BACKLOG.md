<!-- created by AI -->
# Wanderoad — backlog

The source of truth for what to do next. The improvement cron reads this at the top of every
pass and updates it at the bottom. Ordered by value, not by ease.

**The filter for every item: this is a COZY driving game.** Calm, unhurried, pretty. If a
change makes it faster, louder or more stressful, it is the wrong change even if it is
technically better.

---

## Now

- [ ] **Roads that follow the land.** The operator's brief: "winding *round turns* roads which
      follow the curves of hills", modelled on real Swiss alpine drives (Furka, Grimsel, Susten,
      Klausen, San Bernardino). Today the network is a hash lattice with Hermite splines — the
      curves are smooth but they ignore the terrain entirely. What is wanted is a road that
      contours: it should follow a hillside at a constant gradient, turn back on itself where
      the slope is too steep to climb directly, and open out on the flat. That is a routing
      problem, not a spline problem — cost-based search over the heightfield where gradient is
      expensive and staying near a contour is cheap.
- [ ] **Road junctions must meet at one level.** "There are cliffs directly coming through the
      roads as one road intersects to another. Roads should intersect on the same level with
      each other at all times." The accumulated carve fixed the terrain step, but the two
      RIBBONS still cross at whatever heights their own smoothing gave them. Junctions need a
      shared node height that every edge meeting there is pinned to.
- [ ] **Biomes must differ by more than height.** "The biomes are not substantially different
      from one another, other than just in terrain height. I was hoping for actual desert
      dunes, not just flat ground." Dunes need real transverse dune forms and no grass;
      wetland needs standing water and reeds; highlands need rock and snow that read at
      distance. The palette shifts exist; the FORMS do not.
- [ ] **Petrol stations and fuel.** "We should be able to stop at petrol stations that fill up
      after a long time — maybe 6 min of driving you run out." A reason to stop, and the most
      cozy possible failure state. Stations belong at road junctions; the gauge should be
      quiet until it matters.
- [ ] **Chrome extension: drive beside YouTube.** Game docked left or right of the video,
      resizable, car button next to Subscribe. LEGAL POSITION FIRST — see docs/EXTENSION.md
      before writing any of it.

## Next

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

- No GPL or AGPL. MIT, Apache-2.0, BSD, CC0, public domain only. Record every licence in
  docs/CREDITS.md.
- `node tools/bench-car.mjs` must pass in full before anything ships.
- `node tools/diag-water.mjs` must stay at 0 underwater road samples.
- `node tools/diag-cliffs.mjs` must not get worse than the last recorded figure (0.024%).
- Never regress a passing test to make a new feature work.
