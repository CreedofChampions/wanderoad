<!-- created by AI -->
# Wanderoad — requirements, and how each one is tested

Everything the operator has asked for across the whole project, consolidated into statements
that can be **checked by playing the game**, not by reading the code. Each has an ID, a plain
statement of what "working" means, and the test that proves it.

`A` = automated in `tools/browser-test.mjs` (real Chrome, real key events, real measurements).
`M` = still manual; the note says why, and getting it automated is itself a backlog item.

Status is set by the last run, never by intent.

---

## 1. It is playable at all

| ID | Requirement | Test |
|---|---|---|
| P1 | The game boots and you can see it within 40 s | `A` boots, veil lifts, HUD visible |
| P2 | No menu, panel or overlay ever covers the game unasked | `A` garage measured invisible on load |
| P3 | The frame is a real scene, not a flat colour or a black screen | `A` ≥24 distinct colours, mean luma 22–250 |
| P4 | 60 fps once the world has streamed in | `A` fps > 24 warm, and again after driving |
| P5 | Zero console errors | `A` |
| P6 | The car never becomes NaN and never falls through the world | `A` finite, and above ground − 3 m |

## 2. The car does what you tell it

| ID | Requirement | Test |
|---|---|---|
| C1 | W accelerates, S brakes, A steers LEFT, D steers RIGHT | `A` asserted by direction, not by change |
| C2 | **Brakes stop the car in a reasonable distance.** "The brakes feel like they're made of molasses" | `A` 100→0 km/h under 40 m; per-tier figures recorded |
| C3 | **You can stop, turn around and go back.** "It just keeps kind of going in a particular direction" | `A` from 60 km/h: stop, reverse, and reach the opposite heading within 12 s |
| C4 | **Momentum does not persist unreasonably.** Lifting off must slow you visibly | `A` coast from 100 km/h loses half its speed within 6 s |
| C5 | The car does not wobble side to side on a straight road | `A` heading variance over 10 s of straight driving under 1.5° |
| C6 | Going uphill, the car points UP the hill, not into it | `A` pitch sign matches the ground gradient |
| C7 | Different cars feel meaningfully different, and the choice sticks | `A` V and the garage both change the model and it stays changed |

## 3. The road

| ID | Requirement | Test |
|---|---|---|
| R1 | **Nothing is ever above the road surface.** No terrain, no dirt hill, no second road | `A` sample along road centrelines: terrain height must not exceed the ribbon |
| R2 | **Roads never pass over or under one another.** They meet at junctions, at one level | `A` for every pair of crossing edges, height difference at the crossing < 1 m |
| R3 | You never fall through the road onto a lower plane | `A` covered by R1/R2 plus P6 |
| R4 | Roads are never underwater | `A` `diag-water.mjs` = 0 samples |
| R5 | **Roads curve, and follow the land.** "They're still straight lines attached to each other" | `A` measure mean curvature per km and the correlation between road heading and contour direction |
| R6 | No cliffs beside the road | `A` `diag-cliffs.mjs` ≤ 0.029% of ground over 45° |
| R7 | Road signage makes the next corner readable | `M` visual; chevrons and marker posts exist |

## 4. On-road versus off-road

| ID | Requirement | Test |
|---|---|---|
| O1 | **If either front wheel leaves the carriageway you are off-road** — not measured at the car's centre | `A` off-road state flips when a wheel crosses the line |
| O2 | **Off-road feels clearly different**: slower, bumpier, harder to turn | `A` same throttle for 8 s on tarmac vs grass: off-road top speed < 55% of on-road |
| O3 | Off-road speed is capped — you can never build speed in a field | `A` ≤ 100 km/h off-road |
| O4 | You can flip the car off-road, as a real car would | `M` not implemented |
| O5 | **"Ouch" fires only for a real collision**, never for terrain under the wheels | `A` drive 30 s off-road with no props in range: zero impact events |

## 5. Things in the world

| ID | Requirement | Test |
|---|---|---|
| W1 | **Trees stop you dead.** A tree at speed is a full stop, not a nudge | `A` drive into a known tree: speed under 5 km/h within 0.5 s |
| W2 | **No grass on the carriageway**, and none right beside it | `A` sample grass instances against the road mask: zero within the ribbon |
| W3 | Plenty of trees, and they differ by biome | `A` scatter counts per biome |
| W4 | **Every biome looks like itself.** Alpine must be mountains, not a flat plain | `A` per preset: measured relief, dominant biome share and snow cover |
| W5 | **A landmark is visible from spawn** — somewhere to go | `A` something over 60 m tall within 4 km of spawn, in view |
| W6 | Water looks good and is not a trap | `M` visual; `A` for the auto-recover below |
| W7 | In water for more than a second, you are put back on the road | `A` |
| W8 | No z-fighting or flashing overlap | `M` visual |

## 6. The game

| ID | Requirement | Test |
|---|---|---|
| G1 | **The streak is clear**: how far you have gone without leaving the road, plainly on screen | `A` HUD shows distance and it grows while on road |
| G2 | Leaving the road resets it, with half a second of grace | `A` |
| G3 | Faster is worth more | `A` `bench-streak.mjs` |
| G4 | The biome name is shown | `A` present and changes with biome |
| G5 | Auto-drive works and hands back the moment you touch anything | `A` |
| G6 | **Multiplayer is testable**: two clients see each other | `A` two headless browsers, each appears in the other's peer list |

## 7. Tone

| ID | Requirement | Test |
|---|---|---|
| T1 | Cozy: calm, unhurried, nothing loud or stressful | `M` |
| T2 | **The car looks painted, not washed out.** "Too bright-coloured… almost transparent, as if the colour is not added properly" | `A` sample the car's pixels: saturation above a floor, and distinct from the road behind it |
| T3 | Radio is calm and original | `M` |
| T4 | No GPL or AGPL anywhere | `A` licence audit |

---

## How the numbers are kept honest

- A requirement is **not met** until its test passes. Intent does not count.
- A test that cannot fail is not a test: every check here has a threshold that the current
  build could actually breach.
- `M` items are a debt, not a category. Moving one to `A` is always a valid pass.
