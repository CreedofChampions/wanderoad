<!-- created by AI -->
# Alpine autodrive playtest — live site, 28 July

Two minutes of auto-drive on `https://crumbtown.org/cozydriver/?terrain=alpine`, sampled every
10 seconds with a screenshot and a live scene read. Harness: `D:\OpenClaw\tmp\alpdrive\drive.mjs`.

## What works, observed

- **Spawns in the snow.** Highlands, snow-covered ground and pines, at 430 m altitude.
- **Never left the road.** `onRoad` read 1.00 at all twelve samples across 2.4 km of driving.
- **Auto-drive held a steady 38-44 km/h** down a 256 m descent (430 m to 174 m).
- **HUD is right**: title, biome, nearest-station counter (1.0 km), fuel gauge, player list.
- **Junctions** in shot 04 read as clean crossings, not a mess of stripes.

## The real defect: still airborne on the descent

`air` was true at **4 of 12 samples — 33%** while descending at 40-44 km/h.

| t (s) | kph | y | ground | airborne | pitch |
|---|---|---|---|---|---|
| 10 | 40 | 413.1 | 412.7 | **yes** | 13.0 |
| 40 | 42 | 343.1 | 342.7 | **yes** | 13.5 |
| 50 | 42 | 321.7 | 321.3 | **yes** | 12.2 |
| 90 | 44 | 220.0 | 219.6 | **yes** | 10.1 |
| 100 | 43 | 195.9 | 195.5 | **yes** | 10.6 |

This is the operator's "bumpy slide down cliff" and "downhill bouncing", still present on real
alpine terrain at ordinary speed. The earlier fix (droop-band grounding, hill suction, rebound
clamp) took a synthetic 14% descent from 58.9% of frames airborne to 18.9%, but real alpine road
is steeper and this reads 33% at instantaneous samples.

**Left for the agent that owns `src/car/vehicle.js`** rather than fixed here, because that agent
is working on this exact item right now and two edits to the same solver would collide.

## A measurement error worth keeping

The first run of this harness reported the car never moved and auto-drive never engaged, and
that was **the harness, not the game**. It dispatched `keydown` with no `keyup`. `input.tapped()`
is edge-triggered, so the tap was never consumed and the key stayed stuck. A proper tap
(keydown, 120 ms, keyup) engages auto-drive immediately.

Any future browser harness driving this game must send real key PAIRS. A keydown alone looks
exactly like a broken feature.

## Still to explain

While parked for two minutes, body roll crept monotonically from 0.8 to 4.2 degrees without the
car moving. Small, but it should be zero on flat ground at a standstill, and it may be the same
mechanism behind the "still like a motorbike" complaint.
