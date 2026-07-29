# Requests — done, not done, and the proof

Operator instruction, 29 July 2026: *"present all requests and CHECKmark for DONE and X for
not done + proof its done (screenshot of final state or reasonable proof) as a MD doc."*

Every ✅ below names the command that proves it and the number that command printed. Nothing is
ticked on the strength of a code change alone.

---

## The six ordered items (message of 29 July)

### ✅ 1 — "the acceleration should have been slowed down with top speed"

Torque cut with the speed, not just the ceiling: GT 235 → 108 N·m, sports 370 → 172, hyper
untouched at 405 ("keep high-tier cars fast"). The final drives were shortened with the speed
too (4.1 → 7.9, 3.95 → 7.25) because halving the top speed without touching the gearing had put
the whole usable range inside first gear — the browser suite caught it as *"the gearbox shifts
up: gear 1"*. Engine braking is now a fraction of each car's own peak torque rather than a flat
95 N·m, or the shorter gearing would have doubled the drag of a halved engine.

    node tools/bench-car.mjs
     PASS  gt 0-60 km/h        6.17s     PASS  gt top speed        67 km/h
     PASS  sports 0-60 km/h    3.59s     PASS  sports top speed    87 km/h
     PASS  hyper 0-60 km/h     2.29s     PASS  hyper top speed    182 km/h
    ALL CHECKS PASSED

0–60 was 3.78 / 2.45 / 2.29 s before this pass. The gear readout in the screenshot below shows
gear 3 at 40 km/h, so the gearbox is shifting again.

### ✅ 2 — Minecraft-beacon light over petrol stations

A 60 m tapering `MAT.EMIT` column added to `buildStation` in `src/render/props.js`. EMIT is
unlit by the sun, so it reads at distance and at night.

    node tools/bench-props.mjs   — station geometry checks pass
    (frame-time check on this machine fails at HEAD too — 16.75 ms — so it is load, not the beacon)

### ✅ 3 — Explain the three gas cans; respawn with a FULL tank; three lives again after respawn

Every rescue now names the rule instead of just setting the mood. Captured verbatim from
`node tools/bench-fuel.mjs`:

    lines shown: "out of fuel — coasting",
      "a passing driver shares a can — 1 of 3 used. 2 cans left, then you're towed home — pumps 900 m away"

    PASS  the 3 gas cans are restored on respawn, not left spent      0    want 0
    PASS  and you wake up with a FULL tank, not half            13.2 min   want 13.2 min
    PASS  counted as one tow                                          1    want 1

### ✅ 4 — 200% more starting fuel, and the streak→capacity rule made visually clear

The tank is 2.2× and you now start full: 360 × 0.72 = 259 s before, 360 × 2.2 = 792 s now,
which is exactly three times the fuel you actually set off with.

    node tools/bench-fuel.mjs
    PASS  MINUTES OF CRUISING PER TANK                13.21   want 13.2 ±10%
    PASS  stations reachable on one tank at cruise      4.2    want 3 .. 8

A capacity meter under the dial shows the rule without a menu — one pip per upgrade the tank
can take, the earned ones lit, the one in progress filling, and the tank's size in minutes:

    node tools/diag-fuelhud.mjs
       0 cans:  0 pips lit, "TANK 13m +10% in 5"
       3 cans:  first pip 60% full, "TANK 13m +10% in 2"
       10 cans: 2 pips lit, "TANK 16m +10% in 5"
    PASS  progress towards the NEXT upgrade is visible before it lands   60%
    PASS  the tank size on screen actually grew with the cans

### ✅ 5 — Massive streak forgiveness around petrol stations

140 m radius (the forecourt itself is 26 m). The failure it fixes is the *approach* — braking
hard off the carriageway from 40 m out is what was killing streaks, not the pump.

    node tools/bench-fuel.mjs
    three seconds off the tarmac: away from a pump 300 m -> 0 m; on a forecourt 300 m -> 300 m
    PASS  off-road away from a station still breaks the streak (the rule is intact)   0 m
    PASS  off-road INSIDE the forgiveness radius keeps every metre                 300 m
    PASS  forgiveness never accrues score off-road (not an exploit)                300.00

### 🟡 6 — Junctions: "no 2 roads can ever overlap or cross"

**The crossing half is done.** A lane whose base geometry crosses an arterial more than 32° from
square is not built at all. Arterials never yield; the test is on base geometry so it stays a
pure function of `(i, j, dir, tier, seed)` and two chunks cannot disagree. It never strands a
node — if the cull would take the last live link at either end, the lane stays.

    node tools/diag-crossing-angle.mjs      (12 km box, seed 20260726)
                     before      after
      crossings        175         86
      mean off 90°   16.48°      6.57°
      worst          82.55°     24.13°
      4 km box       16 / 14.68° / 45.2°  ->  9 / 7.56° / 16.1°
      cost           373 -> 307 lanes, 428 -> 375 km; arterials untouched

    node tools/diag-junction-cover.mjs   PASS — 0.00% uncovered overlap, 0.00% stray markings
    node tools/diag-deadends.mjs         PASS — 4.4 dead ends per 16 km² (unchanged)

**The overlap half is not.** ❌ Measured and recorded rather than guessed: a third of all node
departures in a 12 km box leave within 26° of each other, worst 180.0° — two carriageways side
by side, which is the braided look in the operator's screenshot (`i.imgur.com/oU5myVN.png`).
Deleting them is **not** the answer: measured, culling costs 45% of the network's length. They
need their departure tangents spread apart at the node — a junction template, exactly as asked.
That is the next pass.

---

## Mid-turn requests (same day)

### ✅ The fuel arrow was "a perfect triangle … impossible to read"

Correct, and the reason is geometric: an equilateral triangle is unchanged by a 120° rotation,
so it cannot express a heading at all. Redrawn as a shaft-and-head arrow, 18 px (was 10),
asymmetric — and the diagnostic now asserts that asymmetry from the geometry in the DOM rather
than trusting a comment:

    node tools/diag-fuelhud.mjs
    PASS  the direction arrow has a real size                     18px x 18px
    PASS  the arrow is drawn from real geometry, not a border trick   5 points
    PASS  and it is ASYMMETRIC — a long axis and a short one, so it can point
          12.8 wide x 16.4 tall (want tall > 1.25 x wide)

### ✅ "gas station distance should flash yellow … below each meter point"

The dial now carries five meter points (0, ¼, ½, ¾, 1) and the distance-to-pumps flashes amber
at each one on the way down, then goes quiet again. Refuelling re-arms them.

    node tools/diag-fuelhud.mjs
    amber fired at tank fractions: 75%, 50%, 25%
    PASS  the distance readout flashes at every meter point on the way down   3 flashes
    PASS  and at the RIGHT points — three-quarters, half, a quarter    [0.75,0.5,0.25]
    PASS  filling up re-arms them — the next tank warns the same way   3 flashes

### ✅ Capacity must not transfer from car to car

    node tools/bench-fuel.mjs
    car A after 10 cans: 13.2 min -> 15.8 min (level 2)
    PASS  a different car starts its capacity again — nothing transfers   13.2 min
    PASS  swapping BACK finds car A's upgrades where it left them         15.8 min

### ✅ "stopped when hitting water and switched to boat — right now i can cover half my car"

Both halves were real. The switch fired at 0.6 m of water measured at the car, and a wheel is
0.34 m with the sills near 0.5 m — 0.6 m *is* half the car. It is now 0.34 m, a wheel exactly.
And the water stops you: the look-ahead the locked barrier already uses now runs while the boat
is unlocked too, as a speed **cap** rather than a damp (damping was tried and never reached the
waterline at all — the boat became unenterable).

    node tools/bench-boat.mjs
    handover at 0.34 m of water, arriving at 10.9 km/h
    PASS  the switch happens at the WATERLINE, not half way up the car    0.34 m
    PASS  and the water has already stopped the car by then            10.9 km/h
    PASS  the boat sets off under its own power, not the car's momentum  0.55 m/s
    all boat checks passed

---

## Whole-suite proof for everything above

    npm test                 0 failures
    npm run test:browser     40/40 checks passed — "THE GAME WORKS."

The browser suite's O2 check ("off-road is meaningfully slower than tarmac") was repaired as
part of this: it had been picking an "off-road" spot along the car's own heading and sampling
once at the end, which routinely measured an **on-road** run and called it off-road. It now
picks the heading that maximises distance from any road and takes the fastest moment at which
the car was genuinely off the carriageway. With an honest measurement the rule was being missed,
so off-road resistance was swept over `diag-o2`'s eight real sites — 0.190/14.0 → 36.4 km/h
(2/8 sites pass), 0.220/17.5 → 21.2 (8/8 but a crawl), 0.248/19.6 → 12.0 (a cliff, undrivable) —
and settled at 0.236/18.7: 19.4 km/h off-road against 63 on tarmac, 8/8, with a verge you can
still choose to drive onto.

---

## ❌ Not started — the newest requests

| Request | Status | Note |
|---|---|---|
| Better car models from the uploaded assets | ❌ | See the licence note below |
| Towns can be upgraded | ❌ | Not yet scoped |
| Airports 500 m off-road + "I wonder how you unlock planes" + planes unlocked by sea diamonds + an air-control library + pass 123 + spawn in air | ❌ | Its own pass |
| Seal the repo; new PRIVATE repo; continue at cozydriver.com/beta | ❌ | Outstanding from an earlier message |
| Ship with Zelda controls and waves when deeper | ❌ | Outstanding |

### Licence note on the uploaded assets — read before using them

`\\DESKTOP-154T5RR\GraphicComponents` is reachable and was searched. What is there:

* **Kenney** (`GameAssets/Art/KennyPD`) — **CC0**, confirmed from the pack's own `License.txt`
  ("License: Creative Commons Zero, CC0"). Usable under this project's hard rule. But the packs
  present are Platformer Kit, Animals, Space Shooter and hexagon tiles — **no cars, no planes**.
* **Synty POLYGON** (`3D/SyntyStudios`, `GameAssets/POLYGON`) — proprietary EULA, not
  MIT/Apache/BSD/CC0. Also **no vehicle packs** in the folders present (Town, Farm, Pirate,
  SciFi, Office, Characters, Icons).
* **cgtrader "General License"** (`3D/cgtraderGeneralLicense`) — proprietary, city scenery only.

So the uploaded library does not contain cars or planes, and the two large libraries that *are*
there are proprietary. The `wanderoad` repo is **public**, so committing Synty or cgtrader source
files would breach both their licences and this project's own rule. The clean route for both the
better cars and the planes is Kenney's free **CC0** vehicle packs (Car Kit / Racing Kit / Toy
Car Kit), downloaded fresh and recorded in `docs/CREDITS.md` — same licence class as the Kenney
packs already on the share.
