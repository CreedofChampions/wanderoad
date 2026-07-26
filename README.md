# Wanderoad

An endless Ghibli-painted road trip. Infinite procedurally generated world, Test Drive
Unlimited-style handling, online multiplayer, in a browser, with no download.

**Play: https://crumbtown.org/wanderoad/**
**Previews (6 driving feels x 6 terrains): https://crumbtown.org/wanderoad/previews/**

## Controls

| | |
|---|---|
| `W` / `↑` | throttle |
| `S` / `↓` | brake |
| `A` `D` / `←` `→` | steer |
| `Space` | handbrake |
| `Shift` | fine control (hold a cruising speed on a keyboard) |
| `Ctrl` | attack (raises the cornering limit for a deliberate throw) |
| `C` | camera — cruise / sport / hood |
| `R` | reverse · `T` back to the road · `H` horn |
| `1` `2` `3` `4` | assists — cruise / sport / off / hardcore |

A gamepad works at the same time as the keyboard, and the game never switches between them
on its own.

`?debug` shows the telemetry overlay. `?seed=N` cuts a private world.
`?feel=` and `?terrain=` select a preview preset (see `src/game/presets.js`).

## What it is

- **Infinite world.** Nothing is stored. The land, the road network, the trees and the
  weather are all pure functions of `(x, z, seed)`, so two players 40 km apart are driving
  the same world and neither of them downloaded it.
- **Five biomes** — meadow, steppe, highlands, dunes, wetland — blended by three slow
  climate fields rather than tiled, so there is no border to cross.
- **A road network with no map.** A hash decides which lattice cells connect; the curves are
  C1-continuous Hermite splines; the land bends to meet them. Roads are real geometry with
  edge lines, a dashed centre line, marker posts and warning chevrons on the bends.
- **A car that behaves.** A 120 Hz arcade-sim solver tuned from what Test Drive Unlimited
  players actually say about the series. Thirteen acceptance tests in `tools/bench-car.mjs`.
- **Streaks.** Stay on the road; the longer you stay and the faster you go, the more it is
  worth. Two wheels in the grass for more than half a second and it resets. That is the
  whole scoring system.
- **Multiplayer.** Other people's cars drive past as ghosts. One endpoint, write and read
  fused, adaptive tick rate, interest-managed by 2 km cells.

## Running it

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # -> dist/
node tools/bench-car.mjs      # vehicle acceptance tests
node tools/bench-slope.mjs    # hill climbing, coasting, rollback
node tools/bench-world.mjs    # determinism, biome balance, generator cost
node tools/shoot.mjs http://localhost:5173/?debug shots/a.png --play 90   # drive it headlessly
python deploy/deploy.py       # build + ship to crumbtown.org
```

`tools/shoot.mjs` drives a real headless Chrome, presses real keys through an autopilot, and
writes a PNG plus telemetry. A backgrounded tab throttles rAF and suspends workers, so it is
the only honest way to measure this.

## Layout

```
src/core/     math, deterministic noise, the palette, the shared GLSL library
src/world/    biomes, roads, terrain, chunk meshing, the worker, the streamer
src/render/   sky, terrain, road, water, clouds, grass, trees, painted solids, post FX
src/car/      tuning, the solver, input, the chase camera, the car model
src/game/     streaks, collisions, preview presets
src/net/      identity, transport, remote cars, world save
src/ui/       HUD and styles
server/       the PHP backend (SQLite) that runs on crumbtown.org
base44/       the same backend defined for Base44
```

## Credits

The visual language, palette, lighting model and much of the GLSL come from the
"Hoshi-no-Tani — The Valley of Stars" Three.js pen. Built with [three.js](https://threejs.org).
