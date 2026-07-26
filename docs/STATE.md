<!-- created by AI -->
# Wanderoad — where the project stands

Written 26 July 2026, as the project moves into wrap-up. This is the honest state: what
works, what does not, what was tried and abandoned, and what it would take to finish.

**Play:** https://crumbtown.org/wanderoad/ · **Previews:** /previews/ · **Repo:**
CreedofChampions/wanderoad · **Extension:** `extension/`, load unpacked

---

## The one number

`npm run test:browser` — **36 of 40 requirements pass.** It drives a real headless Chrome
with real key events and measures real pixels. Requirements and their tests are in
docs/REQUIREMENTS.md; the four outstanding are listed below with their measurements.

Supporting gates, all green:

| Check | Result |
|---|---|
| `node tools/bench-car.mjs` | 13/13 — tyre curve, performance, braking, grip, slide recovery, steering lock |
| `node tools/diag-cliffs.mjs` | 0.027% of ground steeper than 45° |
| `node tools/diag-water.mjs` | 0 of 1425 road samples underwater |
| `node tools/streak-runs.mjs` | auto-drive reaches a kilometre in 3 of 4 |
| Licence audit | 51 packages, MIT/ISC/BSD only, no GPL or AGPL |

## What the game is

An infinite procedurally generated world — nothing stored, everything a pure function of
(x, z, seed), so two players are in the same world without either downloading it. Five biomes
blended by climate fields. A road network from a hashed lattice, drawn as real geometry with
markings, marker posts and warning chevrons, with the land carved to meet it. A 120 Hz
arcade-sim car tuned from what Test Drive Unlimited players say about the series. Streaks that
unlock a fleet of seven CC0 cars. Auto-drive. A generative radio. Multiplayer over one fused
read/write endpoint. All of it in a browser, and in a Chrome side panel.

## What is not finished

Four failing requirements, each with its number and what it would honestly take:

- **R5 — roads do not curve.** 105° of turn per km; a real road is over 200. Needs the route
  and the terrain carve solved together in one cost search. Attempted 26 July as a routing
  change alone: made cliffs worse and the build slower, reverted, numbers in the backlog.
- **W4 — land presets are too flat.** 9 m of relief in a 720 m square. Attempted by scaling
  amplitude and wavelength together; took cliffs from 0.027% to 2.77%, reverted. Relief has
  to come from the low octaves alone, which means reshaping `biomeRelief` per biome.
- **W5 — no landmark to head towards.** Blocked behind W4 for the same reason.
- **O2 — off-road is only ~35% slower than tarmac,** and the requirement asks for 45%.

Not implemented, in the backlog, in rough value order: per-wheel off-road detection, trees
that stop you dead, rollover, water auto-recover, a clearer streak read-out, the intro
cinematic, a cinematic camera during auto-drive, positional ocean and bird audio, real forests
and empty plains, flower beds, 100 CC0 props and the petrol station.

## Things worth knowing before touching it

- **Handedness has bitten this project three times.** three.js puts +X on your LEFT when you
  look down +Z. The solver works in that frame; the flip to the player's left and right
  happens once, in `src/car/input.js`. Anything producing a steer value has to respect it —
  auto-drive's cross-track term was added instead of subtracted and drove the car off the road.
- **A `hidden` attribute proves nothing.** An author `display` rule beats it, and that shipped
  the game unplayable behind a passing suite. Every visibility check now reads
  `getComputedStyle` and a bounding box.
- **A worker has its own module graph.** A preset mutated on the main thread never reaches it,
  which meshed one world while the physics used another.
- **The car records its own forces** (`car.forces`). "Full throttle and it will not move" is
  undiagnosable from outside, and it happened twice.
- **Two tabs share localStorage,** so two windows were one player. `?seat=2` forks identity.

## Running it

```bash
npm install && npm run dev     # http://localhost:5173
npm test                       # physics, slopes, water, cliffs
npm run test:browser           # the 40 requirements, against localhost
npm run test:live              # the same, against production
npm run ship                   # build, pack the extension, deploy
```

Useful URL parameters: `?debug` telemetry, `?cheat` all cars, `?seat=2` second player,
`?car=rally`, `?terrain=alpine`, `?offline`, `?probe` readable framebuffer for tests.
