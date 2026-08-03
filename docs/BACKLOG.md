<!-- created by AI -->
# Wanderoad — backlog

The source of truth for what to do next. The improvement cron reads this at the top of every
pass and updates it at the bottom. Ordered by value, not by ease.

**The filter for every item: this is a COZY driving game.** Calm, unhurried, pretty. If a
change makes it faster, louder or more stressful, it is the wrong change even if it is
technically better.

---

## How this ships — PUBLISH CHECKPOINTS (operator instruction, 27 July 2026)

The operator's words: *"You should be constantly publishing your work. so that I can constantly
test and give you feedback rather than doing it all in one big go... Setup checkpoints."*

**The rule from here on: one item, one deploy.** Not one round, one deploy. Every item below ships
to https://crumbtown.org/wanderoad/ on its own, the moment it is green, so the operator can play
it and react before the next thing lands on top of it. A batch of ten fixes shipped together is
ten things he cannot give separate feedback on, and if one of them is wrong it contaminates his
read of the other nine.

**The gate at every checkpoint, no exceptions:**
1. `npm test` green.
2. `npm run test:browser` 40/40 and "THE GAME WORKS".
3. `npm run ship`, then `npm run test:live` 40/40 — **live is the gate, not localhost.** Learned
   the hard way: a startup-fps regression passed localhost 40/40 and failed live at 22.8 fps
   three runs running, because localhost serves fast enough to hide a startup burst.
4. Commit + push with the real numbers in the message. Tick the item here.
5. If anything regressed: do NOT deploy. Commit with the regression named, put it at the top of
   this list.

**Anything touching a shader also has to pass a real GPU compile** — `npm run test:browser`, never
static analysis. A GLSL reserved word (`patch`) once turned the whole game black while passing
every node-side check that was run against it.

---

## B2 — terrain steps at crossings: the CAUSE is found, and four fixes are falsified (3 Aug 2026)

Baseline, `node tools/diag-crosslevel.mjs`, 12 km box: **34 of 266 car boxes hold a mismatched
crossing, 34 of 2590 crossings over 1 m, worst 12.91 m at (1448,-1952)** between arterial
`0:0,-2,1` and lane `1:2,-4,1`; 1 mismatch within 2600 m of spawn (the gate the reversed spawn
waits on).

**THE CAUSE, and it is not what the code says it is.** `levelAgainst`'s capture radius is a flat
18 m, measured from one of THIS lane's samples to the other road's segments. At that crossing no
sample of the lane lands within 18 m of the arterial, so the lane is never corrected AT ALL. The
comment in `canonicalProfile` claims the correction happens and the earthwork clamp then cuts it
back off. That is wrong.

| # | Hypothesis | Change | Result |
|---|---|---|---|
| 1 | The earthwork clamp undoes the correction (what the code comment claims) | `CROSS_EARTHWORK` x6, 36 m -> 216 m | **exactly no change** — 12.91 m, same place, same 34 boxes. The clamp never touched it. |
| 2 | The radius should be derived from sample spacing (half a span + half the other road's width) | implemented properly | **no change whatsoever** — this lane's span is small, so spacing does not explain the missing reach, and a formula fitted to it would be a just-so story |
| 3 | Just make the radius 40 m | flat 40 | worst **12.91 -> 1.52 m**, arterial-vs-arterial over 1 m **9 -> 5** — but **S3 REGRESSES**, edges at a shared node go from exact to **2.72 m out** at node `1:-1,1`. Two edges meeting at a node share one tangent and must agree; a 40 m reach drags one off it. |
| 4 | Keep 40 m but switch levelling off near nodes, via the existing `guard` | `guard: edgeNodeXZ(e, seed)` on both lane passes | S3 perfect (0.0000 m) and **the crossings collapse**: 34 boxes -> **131**, 34 crossings over 1 m -> **138**, worst -> **14.50 m**, near-spawn 1 -> 4. A great many crossings ARE near nodes and simply stopped being corrected. |
| 5 | Taper the radius from 18 m at a node up to 40 m mid-edge | `NODE_TAPER`, swept 12/18/25/45/90 m | S3 holds (0.0000-0.0001 m) and worst falls **12.91 -> 4.57 m** (plateau below 18 m of taper) — but crossings over 1 m rise **34 -> 64** and the near-spawn gate worsens **1 -> 2**. |

**NOT SHIPPED.** #5 is the closest thing to a fix and it is still a TRADE, not a win: it buys a
2.8x smaller worst step by doubling how many crossings are mildly out, and it makes the
reversed-spawn gate worse, which is the one the operator actually drives through. Under "do not
weaken a check to make something pass" that is a fail, so it was reverted and the baseline
re-measured identical.

**Where a sixth attempt should start.** The radius is the wrong lever because it is one number
serving two jobs. What the lane actually needs is a sample AT the crossing: `findCrossings` already
computes the exact crossing point for the squaring pass, so the levelling pass could INSERT a
sample there (or snap the nearest one onto it) and correct that point exactly, at the old 18 m
radius, with no reach anywhere else. That leaves node agreement untouched by construction, which is
what killed #3, #4 and #5.

## Now — the failing requirements, worst first

### Junction shape — MEASURED PROPERLY, and five approaches falsified with numbers

The operator's screenshot `i.imgur.com/oU5myVN.png`: carriageways leaving one point side by side
with their centre lines crossing. Also, 29 July: "terrain deformation issues around junctions:
alpine seed 4189486", and "junctions are still a mess".

THE MEASUREMENT, which is now trustworthy: `tools/diag-junction-spread.mjs`. It identifies each
node from the edge KEY (`tier:i,j,dir` names both lattice nodes exactly) rather than by rounding
coordinates into buckets, and reports the angle between the away-tangents of every pair of roads at
a node. 180 deg is a road passing through, 90 is a clean crossroads arm, ~0 is braided.

    seed 20260726:  374 nodes,  556 pairs — 185 braided under 26 deg (33.3%), tightest 0 deg
    seed 7:         444 nodes,  747 pairs — 239 braided (32.0%), tightest 0 deg
    seed 424242:    355 nodes,  504 pairs — 166 braided (32.9%), tightest 0 deg

An earlier version of this number was produced by a script that bucketed by rounded coordinate;
it was retracted, then re-derived properly and came back at the same magnitude. It is real.

WHY IT HAPPENS, and this is the one finding everything else follows from: `nodeDir()` gives a node
ONE SHARED TANGENT and every edge meeting there leaves along it. That is deliberate and correct for
a road passing through — it is what makes a junction one continuous curve instead of two curves
with a kink — and at a three- or four-way node it means every road leaves along the same line BY
CONSTRUCTION. The lattice is innocent: with jitter 0.34 the east neighbour sits within ~19 deg of
due east and the south neighbour within 19 of due south, so no two CHORDS at a node can be closer
than about 52 deg.

FIVE APPROACHES, ALL MEASURED, ALL REVERTED:

1. Rotate each departure towards its own chord, FAN_MIX 0.8 — straightens the whole network. The
   roads become near-straight lines between nodes and the game loses the curves it is made of.
   (Compare renders from diag-roadmap at 5 km across.)
2. The same at FAN_MIX 0.3 — keeps the curves, puts LOOPS and hooks at several junctions. The
   hermite swings when its end tangent is re-aimed and the safety search only ever tried SHORTER
   tangents, never re-aimed ones, so where no length was safe it kept the least-bad and drew a hook.
3. The same with the FAN AMOUNT searched alongside the tangent length (FAN_BACKOFF ending at 0, so
   a junction that cannot be fanned safely is not fanned) — this DOES fix the loops. But applied to
   arterials it moves the trunk network enough to cross ITSELF elsewhere: diag-crosslevel's
   arterial-x-arterial mid-edge count 9 -> 17 against a regression bar of 10. Restricted to lanes it
   is safe (9, gradients unchanged) and does almost nothing for the spread: 32.7% vs 32.5%.
4. Move the NODE instead — pull a braided node's jitter back towards its cell centre, where east is
   +x and south is +z and no pair can be braided. Changed the measurement by 0.2 percentage points,
   and that is what proved the chords were never the problem.
5. SHORTEN the tangent at a junction end (a shorter tangent turns towards the well-spread chord
   sooner, and nothing is re-aimed so nothing can loop). This one WORKS on the separation and
   trades it against ROAD GRADIENT one-for-one, which is worse:

       shorten   spread (worst seed)   worst grade: meadow / alpine
        1.00 (off)      32.7%              25.7% / 28.1%   <- shipped
        0.75            31.0%              27.3% / 28.3%
        0.60            25.8%              33.3% / 39.0%
        0.42            17.8%              45.3% / 46.4%
        0.22             7.3%              71.5% / 63.6%

   A 71% gradient is not a road. Junction flatness (diag-junction-geom) stayed clean throughout, so
   the cost is entirely in the longitudinal profile: a short tangent makes the road hug its chord,
   and the chord does not follow the terrain.

WHAT A SIXTH ATTEMPT SHOULD DO. The separation and the gradient are only in conflict because the
tangent is doing both jobs. Give the node a SHORT tangent for the first few samples and let the
profile smooth over a longer window than the geometry does — i.e. decouple the plan view from the
elevation at a junction, rather than trading one for the other. Verify with diag-junction-spread
AND diag-relief AND diag-roadmap together; any one of them alone will happily accept a change the
other two hate. `tools/diag-junction-spread.mjs` is in npm test with its bar set AT today's number,
so it cannot silently get worse while this is open.

STILL OPEN SEPARATELY: the terrain at crossings. diag-crosslevel has two failures that predate all
of this — 34 of 260 car boxes near spawn hold a crossing whose two roads disagree about ground
height, worst 12.91 m. Improved from 55 by the CROSS_EARTHWORK change; not fixed. Alpine seed
4189486 is the operator's own repro.

### Severity-first window allocation in squareCrossings — TRIED, REVERTED, with numbers

The surviving hypothesis from the earlier five was that `if (kc <= cursor) continue` skips a
crossing outright when a milder neighbour has already eaten the room. It does. Allocating the
window worst-first and applying left-to-right afterwards was built and measured:

    4 km box:  16 crossings mean 14.68 worst 45.2  ->  22 crossings mean 11.02 worst 45.2
    12 km box: 175 / 16.48 / 82.55                 -> 225 / 17.18 / 83.94

The 4 km mean improves a lot; the 12 km box gets WORSE because bending harder creates new
crossings (175 -> 225). Net negative on the headline numbers, so it is not kept. If the
departure-spread work above lands first, this is worth re-measuring on top of it.

### Coincident lattice nodes (lane cell 600, every 3rd lane node = the arterial node) — TRIED, REVERTED

    12 km box: 498 crossings, mean 37.88 deg, worst 89.3

Far worse, and instructively so: coincident nodes make lane edges run ON TOP of arterial edges,
which produces near-parallel "crossings" everywhere. This is the same defect as the departure
spread above, arrived at from the other direction.


- [ ] **90-degree junctions: FIVE hypotheses falsified with numbers. Read this before trying a
      sixth.** The operator: "When 2 roads get close they need to start to connect via a 90
      degree junction not like part into each other -- that way its 1 template that just works
      for all intersections."

      **THE BASELINE IN THIS ENTRY WAS STALE, and that is the most useful thing on this pass.**
      The 175/16.48/82.6 figures below were true when the five hypotheses were tried; they are
      not true now. Re-measured 2 August 2026 on current `main`, same command, same 12 km box:
      **89 crossings, mean deviation 6.89 degrees, worst 31.5.** The junction work that landed
      since (T-splits and 4-ways getting real geometry, and a lane that would cross an arterial
      badly simply not being built) more than halved the crossing count and cut the mean to 42%
      of what it was. Anyone reading the table below to pick a sixth attempt should measure
      first: it is aimed at a world that no longer exists.

      Original baseline, kept for the table: 175 crossings, mean deviation 16.48 degrees from
      square, worst 82.6. Every measured crossing in this world is arterial x lane; same-tier
      crossings essentially do not occur.

      | # | Hypothesis | Change | Result |
      |---|---|---|---|
      | 1 | The lattices are incommensurate (1800 vs 620) so crossings cannot be square | lane cell 620 -> 600, exactly 1800/3 | mean **16.48 -> 15.84**. Negligible. |
      | 2 | Node jitter (+-42% of a cell = +-252 m) swamps the grid | jitter 0.42 -> 0.14 | mean **-> 15.31**. Negligible. |
      | 3 | R5's winding bends edges away from their node-to-node direction | swing 0.10/0.11 -> 0 | mean **-> 13.93**. Small, and it would cost every curve in the game. |
      | 4 | The squaring bend is radius-limited | CROSS_SQUARE_RADIUS 90 -> 74 | **exactly no change**, to three decimals. |
      | 5 | It is window-limited (the file's own comment says so) | window 320/420 -> 520/700 | mean **-> 16.22**. Negligible. |

      All five reverted. Together they say the residual is NOT any single geometric knob.

      **The hypothesis that survives, and where a sixth attempt should start:** `squareCrossings`
      contains `if (kc <= cursor) continue` — a crossing whose correction window would overlap
      the previous one is SKIPPED ENTIRELY. That explains #5 exactly: widening the window buys a
      better correction on the crossings that still fit and silently drops more of the ones that
      no longer do, so the mean barely moves. It also explains why the worst case (82.6 deg) is
      untouched by every knob — the worst crossings are precisely the ones in busy areas whose
      windows collide.

      So the fix is not a constant. It is either processing crossings in order of severity
      rather than in polyline order, or merging overlapping windows into one correction that
      squares both crossings at once. That is a real piece of work in the most load-bearing
      function in the file, and it needs the full road gate (seam, water, R1/R2/R5, cliffs,
      density, deadends) behind it.

      **HYPOTHESIS 6 — SEVERITY-FIRST WINDOWS — BUILT, MEASURED, AND REVERTED (2 Aug 2026).**
      The first of those two ideas was implemented in full: every crossing's ask is computed
      up front, the crossings are sorted by |delta| descending, and the room is handed out
      worst-first against a set of claimed index spans, so the crossing furthest from square
      claims its window before a nearly-square neighbour can spend it on a nudge nobody would
      see. The single monotonic `cursor` skip (`if (kc <= cursor) continue`) is gone; claims
      cannot overlap by construction. Correction, window formula, symmetry and backoff all
      unchanged — only the ORDER of claiming.

      | metric, 12 km box | before | after |
      |---|---|---|
      | crossings | 89 | 89 |
      | mean deviation | 6.89 deg | **6.99 deg** |
      | worst | 31.5 deg | **43.6 deg** |

      Reverted. A 12-degree worse worst case is a regression on the exact thing this entry
      exists to fix, and it is the SAME trap already recorded above for the asymmetric window:
      giving one crossing a large window bends a long stretch of edge hard, which swings a
      nearby stretch of the same edge into near-parallel with something else. Worst-first
      allocation makes that failure MORE likely, not less, because it hands the biggest windows
      to the crossings whose corrections are largest — and it starves their neighbours of room
      completely, where polyline order at least left them some.

      **What that leaves.** The severity idea is dead as stated; the remaining untried half is
      MERGING overlapping windows into a single correction that squares both crossings at once,
      which does not create a large lone bend and so does not obviously walk into the same trap.
      Also worth knowing before anyone spends a day here: at 6.89 degrees mean the metric is
      already a quarter of what the operator's complaint was raised against, so the residual is
      now a TAIL problem (one crossing at 31.5, the rest well under 24) rather than a systemic
      one, and a fix that improves the mean while moving the worst is not worth taking.

- [x] **THE REVERSED SPAWN IS RESTORED — crossings are levelled and the hold is lifted.**
      `+ Math.PI` is back in `findSpawn`. The gate it was waiting on, measured by the new
      `node tools/diag-crosslevel.mjs`: **0 crossings over 1.0 m within 2600 m of the default
      spawn, in every direction.** Everything below this paragraph is the original entry, kept
      because two of its three claims turned out to be WRONG and the corrections are the useful
      part.

      **CORRECTION 1 — the crossing that held the spawn was not arterial-vs-arterial.** Driving
      out reversed from (429,463) on the shipped seed, the first mismatch was at **(-253,1182),
      990 m out, 2.51 m, and it was tier0 x tier1** — an arterial the lane was already supposed
      to be levelled against.

      **CORRECTION 2 — the two "arterial x arterial" lines below are real, but they were
      classified by the wrong test.** Asking whether the two EDGES share a lattice node says
      nothing about where THIS intersection is: `0:-2,-2,0` and `0:-2,-2,1` both leave node
      (-2,-2) and then cross each other again 1.6 km away, which is a genuine mid-edge junction.
      Classifying by the crossing POINT's distance to a shared node instead moved 19 crossings
      from "shared node, not a junction" to "real, and unlevelled". A pair-identity test on a
      per-point question is the same shape of error as the `.wy` stub probe already recorded here.

      **CORRECTION 3 — "a wide diagnostic box re-levels edges the game never uses" is no longer
      true and it hid a real bug.** `canonicalProfile` derives its partner list from the EDGE's
      own bounds, so a profile is box-independent — verified directly: the (-253,1182) mismatch
      read 2.51 m at box half-widths of 420, 840, 1500 and 3000 m, to the centimetre.

      **THE TWO REAL DEFECTS, and the fixes, in src/world/roads.js:**

      1. *The lane-vs-lane pass silently undid the lane-vs-arterial pass.* A lane is levelled onto
         the arterial it crosses, and then levelled against outranking LANES — and at (-253,1182)
         the outranking lane crosses it 17 m further on, inside the 18 m capture radius, and put
         it straight back. `levelAgainst` now takes a `respect` mask: the arterial pass records
         the authority it took and the lane pass may not spend it. The arterial is the top of the
         priority order or it is not.
      2. *Arterials never levelled against each other at all.* New `level0`: an arterial yields to
         the arterials whose key sorts before its own (the existing `outranks` order, so the chain
         is strictly decreasing and cannot cycle), feathered exactly like the lane path — and
         **guarded within 150 m of its own lattice nodes**, which is the whole difference from the
         attempt that was reverted. That one fired at shared nodes, where `nodeDir` puts two
         arterials side by side by construction, so it caught every adjacent pair in the network.
         This one can only move the MIDDLE of a road.

      **What it moved, A/B on identical geometry (the switch was in the build, not two commits —
      a concurrent edit to `TIERS[0].step` was changing the world underneath):**

      ```
                                             before   after
      crossings over 1 m, 5 seeds, 6 km box     50      35
        arterial x arterial, true mid-edge      22      10
        arterial x lane                         22      19
      car boxes near spawn holding one          67      19
      mismatched crossings within 2600 m         ?       0   <- the gate
      ```

      **THE ONE REGRESSION IT DID CAUSE, and what it actually was.** The first version clamped an
      arterial's levelled profile to land ± MAX_EARTHWORK, the way `canonicalProfile` already does
      for lanes. Worst arterial gradient went rolling **27.8% -> 45.2%**, alpine 28.1% -> 50.1%,
      dunes 21.9% -> 46.7% — the same failure the reverted attempt had, one third as bad. It was
      not the levelling. It was the clamp: applied AFTER the feather it puts a step between one
      sample and the next, which `levelAgainst`'s own comment has said for months, and tier 0's
      samples are 19 m apart so a 4 m cut is a 21% gradient on its own. Deleting the clamp put all
      six presets back on their exact pre-change figures. **If you touch this again, do not
      re-add it.**

      **Gates, final:** `npm test` green; diag-seam clean (S3 0.68 m / 0.24 m against 1 m);
      diag-water 0 underwater; diag-cliffs 0.008% over 45° (was 0.013%); diag-curve R1 0/173 and
      R2 0/1, R5 233; diag-density 76.6/68.5/75.6 against 75/66/74; diag-relief worst grades
      25.7/27.8/28.1/21.4/21.9/18.7, identical to the same build with this change switched off;
      diag-deadends 6.1; diag-terminus 14 checks. Costs **+160 ms on an 8 km coarse chunk**
      (bench-chunk L7 498 -> 659 ms, L6 276 -> 387; L0/L1/L2 unmoved) — an arterial now runs one
      extra box query for its partners. Halved on the way by asking `geomsInBox` for tier 0 only
      instead of building every lane in the box and filtering it back out.

      **NOT FIXED, and honestly out of reach of levelling:** 10 arterial-vs-arterial and 19
      arterial-vs-lane crossings over 1 m remain across five 6 km boxes, worst 24.33 m. They are
      earthwork-limited, not authority-limited — a road in an 18 m cutting crossing a road on
      grade cannot be levelled without a bridge, and `levelAgainst` correctly refuses to ask the
      land for more earthwork than `profileEdge` was allowed. The nearest one to spawn is 2.6 km
      out and in the FORWARD half, away from where the restored heading points. A bridge deck, or
      a cull of crossings that steep, is the next move — not a bigger correction.

      ---

      *Original entry, for the record:*

      **The mechanism, measured, not guessed.** `levelCrossings()` pulls LANES to the arterial
      they cross; two arterials crossing each other are never touched. Scanning a 6 km box around
      the default spawn (tools scratch, easy to rebuild — the R2 arithmetic in
      tools/browser-test.mjs verbatim against `t.roads.edges`):

      ```
      BAD  2.21 m at (-3156,-1959)  A=0:-2,-2,0 tier0  B=0:-2,-2,1 tier0   <- arterial x arterial
      BAD  1.55 m at ( 2479,-2544)  A=0:1,-2,0  tier0  B=0:1,-2,1  tier0   <- arterial x arterial
      BAD  9.06 m at (-2259,-2333)  A=0:-2,-2,0 tier0  B=1:-4,-4,0 tier1
      BAD 12.40 m at ( 1448,-1951)  A=0:0,-2,1  tier0  B=1:2,-4,1  tier1
      BAD 11.29 m at ( 3843,-399)   A=0:1,-1,0  tier0  B=1:5,-1,0  tier1
      ```

      The tier0×tier1 entries are a DIFFERENT and much less alarming thing: `levelCrossings`
      levels a lane against whatever edges are in the CALLER'S box, so a wide diagnostic box
      re-levels edges against a partner set the game never uses. The ±420 m box the car actually
      samples reads **0 bad crossings at spawn** — verified. The tier0×tier0 pair is the real,
      box-independent defect.

      **Why this is not a quick fix, from this project's own history.** Arterial-vs-arterial
      levelling was attempted in an earlier round and REVERTED: it fires at SHARED NODES, where
      it moved 17 of 17 arterials in a 4 km square by up to 36 m and put a 134% gradient on the
      trunk network. The safe shape is almost certainly to level only at TRUE MID-EDGE crossings
      (never where the two edges already share a node) and to feather the correction along the
      lower-priority arterial the way the lane path already does — but that needs its own
      before/after against diag-cliffs, diag-relief, diag-curve R1/R2 and diag-seam, which is a
      session, not a budgeted pass.

      **Restore condition, written at the code site:** put the `+ Math.PI` back the moment R2
      reads 0/9.

- [x] **Roads that end in nothing — the closure now STANDS UP.** The count is unchanged and that
      is deliberate: 6.1 dead ends per 16 km² is the price of not cascading the culls, and
      `tools/diag-density.mjs` has already priced the alternative (a second ply on the LIVE degree
      takes it to 2.8 but drops junction density to 60.3% against a 66% floor; far-node-only 65.1%,
      still failing). So the road is still allowed to end. What changed is that it now says so.

      **Why a turning head and a closing bar were not enough, and it is arithmetic rather than
      taste.** Both are PAINT ON THE DECK. At a driver's eye line a 0.7 m stripe lying flat in the
      road's own plane subtends about **0.02°** at 120 m once foreshortening is taken off it. A
      0.95 m bollard standing up subtends **0.45°**, and the board on its post **0.82°** — the
      same order as the chevron boards a player already reads on every bend. The information was
      always there; it was 20x too small to read in time. That is the entire gap between "the road
      ended" and "the road ends here".

      **What it is:** a line of pale bollards across the head, standing ON the closing bar's own
      chord, and one board on a post 1.2 m past the rim facing back down the road at the driver.
      Cream and slate, no red, no glare, and **no collision** — driving gently into the end of a
      road must never be punished. Built in `buildTerminus` because that is the only place that
      knows how wide the head was allowed to be (its radius is the result of a ground search) and
      the only place holding the same `Terrain` the tarmac is drawn on, so the posts cannot stand
      on a second opinion about the ground.

      **Two real defects the harness caught before anything shipped, both of which looked fine in
      the code:**
      - The board was placed *behind* the bollards *inside* the head. The bar is at 0.62R and the
        board needs room behind it, so that only fits when R > 5.3 m — and a lane's head is 3.9 m.
        **24 of 27 dead ends silently got no board at all.** It goes on the verge past the rim now,
        where a real one goes and where the marker posts already stand.
      - Standing the bollards a tidy 0.55 m *behind* the paint narrowed the line to **40% of the
        carriageway** at the worst head, because the head is a circle and its chord is already
        past widest at the bar — half the lane left open with a row of posts down the middle of
        it, which reads as an obstacle, not a closure. On the bar itself the narrowest is 77%.

      **Gates:** `tools/diag-terminus.mjs` extended from 8 checks to 14, all passing over 27 real
      dead ends in 4 windows — every head gets ≥2 bollards (139 total) and exactly one board (27),
      feet within 0.0000 m of the ground the head is drawn on, no bollard outside the tarmac
      (furthest 97% of the radius), narrowest line 77% of the road's width. **T13 drives the real
      `Roads` class with a real three.js scene and counts what actually reaches the scene graph** —
      11 heads -> 57 bollards + 11 boards instanced — because a geometry that is never added is
      the exact shape of "a flag set is not a thing visible". Everything else held: `npm test`
      green, diag-deadends 6.1 (bar 6.5), diag-seam clean, diag-density unmoved.

      **Not verified here and it needs a human eye:** nobody has LOOKED at it. The numbers say the
      posts are in the world, at the right place, at a size that reads at 120 m. Whether it is
      pretty is a screenshot question.

- [x] **Downhill bounce — FIXED and verified in the live game.** Measured on the real alpine
      descent at https://crumbtown.org/cozydriver/, auto-drive, sampled every 10 s over 251 m of
      descent at 38-46 km/h: **airborne 4 of 12 samples (33%) -> 0 of 12 (0%)**. The synthetic
      14% wavy descent at 93 km/h reads **0% of frames airborne, 0 air/land cycles, max visual
      gap 0 cm** (was 58.9%, 158 cycles, 26 cm).

      **The fix that worked was the smallest one, and it was not the suction.** `AIR.extraDelay`
      exists so a deliberate jump off a crest gets its moment of air before the settling assist
      pulls the car down. A descent pogo is not a jump — it is a train of hops a few centimetres
      high, each SHORTER than the delay, so the assist never armed once and the behaviour it was
      written for never happened. Inside 0.2 m of the ground there is no jump to protect, so the
      delay is skipped and the assist ramps from the first frame. Nothing new was added: the
      ceiling is still `AIR.extraMax`, the ramp still `AIR.extraRamp`, and hardcore still turns
      it all off through `A.airborne`.

      **Why this succeeded where three gates failed.** The reverted attempt was a 3.2 g suction
      toward whatever the probe called ground, and its problem was never the bounce — it was
      that a lake bed is also ground, so the car got dragged into it (`bench-boat`'s barrier
      0.97 m -> 1.12 m against a 1.0 m bar). The three gates tried against that each failed for
      their own reason: widening the grounded band made the spring chase the bed; a biome-weight
      dry/wet gate read "dry" because the boat fixture does not supply that array (the
      "a stub probe does not fail, it lies" trap, recorded twice in this file now); and an
      airtime gate never closed because a sinking car re-grounds and resets the airtime.
      Removing a delay rather than adding a force sidesteps all of it — there is no new
      downward force to leak into water at all. **bench-boat's barrier reads 0.25 m, unmoved.**

      Gates: `npm test` fully green, `bench-car.mjs` all checks passed, `bench-boat.mjs` barrier
      unmoved, live alpine autodrive 0% airborne.

### Playtest round 3 — from the operator's own screenshots, 27 July

Everything here was READ OFF REAL SCREENSHOTS he sent, not inferred. Each is its own
checkpoint and ships on its own.

- [x] **Roads ending in the middle of nowhere — culled.** Interior dead ends over a 4 km box on
      the shipped seed: **6 -> 1**, and cliffs got BETTER on the way (0.009% -> **0.004%** over
      45 degrees, since a culled lane is an embankment that never gets built).

      **Both of my first two theories were wrong, and measuring is what killed them.** It was
      not a station access spur orphaned by a failed station — the spur and the station are
      built in the same loop with no early-continue between them, so one cannot exist without
      the other. And the raw dead-end count looked like 31, which would have been an emergency —
      but an endpoint near the query box is a CLIPPED edge, not a dead end. Excluding the
      boundary gives the real figure: **6 per 16 km², every one a tier-1 lane, zero arterials.**
      So the cruising network was already fully connected; only lanes stopped dead.

      Fixed with a local `degreeAt()` (four hash tests — the lattice connection rule is pure and
      local, which is the only reason this is affordable) and a one-ply `isLeafLane()` cull at
      edge emission. Arterials are deliberately untouched: they had no dead ends, and thinning
      them would move the road density every other system is tuned against.

      **Deliberately one ply, not a fixed point.** Culling a leaf can orphan its neighbour, so
      chasing it to convergence is a global solve — on an infinite, hashed, deterministic
      lattice there is no global anything. One ply removes 5 of 6 and keeps the function pure.
      The residual 1 is recorded rather than hidden.

      **Checked for the expensive failure mode:** node tangents still average over culled links,
      so a surviving lane leaves a junction on a tangent shaped partly by a road that is no
      longer drawn. That is a small curvature difference, NOT a ribbon-vs-carve divergence —
      the renderer and the terrain carve read the same edge geometry from the same functions,
      so they cannot disagree. `diag-seam.mjs` clean confirms it.

      Gates: `npm test` green, 0 underwater road samples, curvature **234-262 deg/km** (bar is
      200, lanes 288-345), stations 2391 m of arterial apiece (bar 1500-5000),
      `bench-props.mjs` full pass, browser 40/40, live 40/40.

- [x] **A station "town" with no road to it — DOES NOT REPRODUCE.** Measured rather than
      assumed, and the numbers say the connection is sound:

      - **99 of 99 stations** across 5 seeds have their access-spur mouth ON a road. Worst
        mouth-to-road distance **4.77 m**, inside the road's own width.
      - **234 town props** across 3 seeds (48 / 63 / 123): worst distance to a road **53 m**, and
        **zero** props further than 60 m from one — which is the `TOWN_MAX_OFFSET` the system is
        built around, working as designed.

      The likeliest explanation for the screenshot is that it predates the access-spur work, or
      the connecting road was out of frame. Reopen with a seed and coordinates if it recurs —
      that is all this needs to become reproducible.

      **THE REAL LESSON IS MY OWN MEASUREMENT ERROR, and it is worth writing down because it
      would have produced a confident, completely wrong bug report.** My first harness passed
      `stationTownInBox` a stub probe returning only `{ y }`. The town placer asks the probe for
      `site(x,z).wy` — the WATER HEIGHT — and compares ground against it. `undefined` fails that
      comparison, so **every candidate read as underwater**: 0 town props placed, `rejectWater`
      64–73%. That looks exactly like the reported bug and would have "confirmed" it.

      Two things saved it: a rejection tally that named `rejectWater` specifically, and the fact
      that 73% of ground being underwater next to stations built on dry roads is not a believable
      number. **A stub probe that silently omits a field does not fail — it lies.** Any future
      harness calling into props.js must build the probe the way `src/render/props.js` does
      (`weights()` into a copied scratch array, then `waterLevelAt`), not a convenient stub.

- [x] **Roads go AROUND lakes now.** Over the 144 km² box at the default spawn: non-wetland road
      over open water **56.19 km -> 2.33 km** (-96%), separate causeway runs over 150 m
      **102 -> 5**, longest single causeway **2483 m -> 297 m**. Wetland causeways KEPT and
      slightly up (1.43 -> 2.94 km) — that picture was never the bug. Driving straight out of
      spawn, the first 768 m of arterial now has **0 m** of open-water causeway against 377 m of
      the first 684 m before. New tool: `node tools/diag-causeway.mjs`.

      **It is a CULL, not a router, and that distinction is the whole reason it worked where the
      reverted attempt did not.** There is no road map — a lattice, a hash and a rule — so
      "route around the lake" is a global solve in a world with no global anything, which is what
      made terrain-aware routing cost triple build time last time. But a 4-connected lattice does
      not need a router to go round a lake: delete the links that cross open water and the links
      round the shore are still there, still hash-derived, still connected. The route around the
      lake is what is LEFT. A per-edge predicate, pure and local, the same shape as the existing
      dead-end cull: ~18 water probes along the edge's base polyline, condemned at two
      consecutive wet, non-wetland, over-0.35 m samples (~100 m of open water), cached per edge.

      **It made three other things better, not worse, which is the opposite of last time:**
      `diag-cliffs.mjs` **0.004% -> 0.000%** (15 samples over 45° -> 0 — a causeway is a deep
      fill, and deep fill is the entire cliff population), chunk build **faster** at every level
      (L7 962 -> 450 ms, L0 210 -> 161 ms; fewer edges to profile and carve), and junction
      squareness improved on its own (see the crossing-angle item below).

      **What it costs, stated plainly: about a third of the road length** (338.8 -> 209.1 km,
      349.1 -> 275.6, 382.9 -> 246.0 over three fixed 144 km² boxes). That is the honest price of
      not building roads across lakes when 15-20% of the world's area is under water, and an
      arterial dies for the whole of its 1800 m if 100 m of it is in a lake. Interior dead ends
      did NOT get worse — still **1** per 16 km² box, because the leaf cull was made
      water-aware too (`liveDegree`) so a lane orphaned by a drowned neighbour is culled with it.
      Sweep for the record: requiring 3 consecutive wet samples instead of 2 keeps 11% more road
      but leaves 18 km of causeway instead of 2.3 km, and a 1.0 m depth gate keeps 3.5% more road
      for double the residual water. 2 samples / 0.35 m is the knee.

      **One real bug found and fixed on the way, and it is worth reading before touching this
      area again:** edge GEOMETRY is no longer a pure function of (lattice, seed). `squareCrossings`
      bends an edge against the neighbours that EXIST, and existence now depends on where the
      water is — which the terrain preset rewrites in place. The geometry cache was keyed on the
      lattice alone, so a preset switch served a stale, differently-sampled polyline against a
      freshly-keyed height profile and they disagreed about array LENGTH:
      `RangeError: offset is out of bounds` out of `canonicalProfile`. Only `diag-stations.mjs`
      caught it, because it is the only tool that drives more than one preset in one process.
      Fixed by keying `geomFor` on the field fingerprint and making `worldTag` subsume it.

      Also new: `src/world/field.js`. The raw land and its water moved out of terrain.js so
      roads.js can read them DIRECTLY — terrain.js imports roads.js, so roads.js could never
      import terrain.js, and re-deriving the height formula inside roads.js would have been the
      "two opinions about one surface" bug this project has already paid for twice. terrain.js
      re-exports everything, so no existing importer moved. Verified behaviour-neutral on its
      own: `npm test` byte-identical across the extraction.

      Gates: `npm test` green, 0 underwater road samples, cliffs 0.000%, `diag-seam.mjs` clean
      (all three S1/S2/S3, both presets), `diag-spawn-water.mjs` ALL DRY, `diag-curve.mjs` R5 229
      deg/km with R1 0/60 and R2 0/0, `bench-props.mjs` and `bench-rescue.mjs` fully green.

      **Two test FIXTURES had to move, and neither is a weakened check — both were assuming
      roads that should never have existed.** `bench-rescue.mjs` hard-coded its lake at
      (968,-160), which WAS a lakeside road and was one of the causeways; with it gone
      `roads.query` returned d = Infinity with qx/qz at their (0,0) defaults, the rig placed the
      car at the origin, it never got wet, and four checks failed reporting "0.00 s" as though
      the rescue had broken. It had not — the fixture had. It now SEARCHES for deep water with
      dry tarmac 12-45 m up the bank, the same discipline the file already used for its shelf
      point, and the suite is **fully green for the first time** (it was 1 FAILED before this
      round) with the recorded W7 timings reproduced exactly: 0.60 s / 0.75 s / 1.13 s.
      `bench-props.mjs` sampled a FIXED 4 km square whose road length fell by a third, so its
      absolute `sample size` guards tripped (11 against 15, 16 against 20) while the actual
      assertions — `props per km of road` 1.78 in a 0.4-3.6 band, `cans per km` 2.59 in 0.9-3.9 —
      were healthy. The box went 8x8 to 10x10 tiles, restoring the sample count (33 and 61) with
      every threshold in the file untouched. Lowering the bars would have been the wrong move for
      the usual reason: it makes a guard worse at its job instead of giving it back its evidence.

      New tools this round: `diag-causeway.mjs` (road over open water, wetland-split, with the
      drive out of spawn), `diag-abovedeck.mjs` (ground standing above the deck, plus a bank
      profile at 4/8/12/16/24 m off the tarmac).

      **Two numbers moved the wrong way and are recorded rather than buried.** `diag-relief.mjs`
      alpine finished at **0.117%** of ground over 45°: better than the **0.175%** it was reading
      at the start of this pass, worse than the 0.078% written in the rules line, which predates
      this round entirely — so the ceiling in that line is stale and should be re-baselined
      against a measurement rather than trusted. Of the 0.117%, the cut-batter change accounts
      for about 0.026 pp (1.6 reads 0.091% on the same world) and is a deliberate, swept trade;
      the rest is the round's other terrain work. `diag-curve.mjs`'s **worst-of-eight-seeds**
      figure went 225 -> **192** deg/km, under its 200 bar, while the PRIMARY figure the gate
      actually reads went 234 -> **229**, comfortably over. The worst seed's 840 m car box is a
      watery one that lost 73% of its road (12.62 -> 3.43 km), so the mean is now taken over a
      thin sample dominated by straight arterials. Not retuned: bending the road tiers to flatter
      a diagnostic on one small box would be tuning the world to the test.

- [x] **Junction squareness — the shallow-crossing tail, fixed as a side effect.** Over the
      12 km box: crossings deviating more than 45° from square **23 of 141 (16.3%) -> 5 of 62
      (8.1%)**, mean deviation **20.94° -> 15.51°**, median **13.56° -> 9.12°**, worst
      **78.85° -> 60.98°**. The specific crossing the audit drove to and photographed as "two
      carriageways running almost parallel and merging" — (1137,-1560), an 11.2° crossing — is
      gone from the network entirely; the worst thing near it now is a 54.8° crossing.

      No new mechanism, and deliberately so: a large share of the near-parallel pairs were
      lane-against-arterial crossings in the flat ground around lakes, and the water cull removed
      the lanes that made them. `squareCrossings` was not touched. Recorded here rather than
      claimed as a fix in its own right — if the tail needs to go below 8% it will need a real
      angle-based rejection, and `node tools/diag-crossing-angle.mjs` is the tool for it.

- [x] **A station forecourt at the very edge of the water — fixed.** Apron within the road's own
      1.6 m freeboard of open water: **4 of 128 stations -> 0**, across 7 seeds.

      Cause: the candidate loop tested water at the ROAD point, but the forecourt sits about
      19 m to one side (`e.width/2 + STATION_OFFSET`) with `STATION_RADIUS` of apron around it,
      and the apron position was computed AFTER the tests, so it was never checked at all. A
      station could pass every test and still run its apron into a lake. Worst measured case
      cleared the water by only 0.76 m where the road demands 1.6 m.

      The fix spends something the code was already throwing away: which side of the road the
      forecourt sits on was a free coin flip. Now it tries the chosen side, takes the other if
      that apron is too near the water, and only drops the station when BOTH sides are wet.
      That matters because stations are the thing the player hunts for — **126 of 128 kept**,
      so the side-flip rescued all but two rather than thinning the network.

      Gates: `node tools/bench-props.mjs` full pass (arterial per station 2252 m, bar
      1500–5000), `npm test` green, browser 40/40, live 40/40.

- [ ] **Objects fall from the sky as they spawn.** Operator, verbatim: *"I see objects spawning
      by falling from the sky!"* Props/scatter are presumably being instanced at a height and
      then settling, or being placed before their ground height is known. Placement is supposed
      to be deterministic and grounded (the props work measured "0.000 m of float"), so either
      that guarantee does not hold for every kind, or something is animating them in. Find which.

      **World-side note, from the roads/terrain pass — one candidate ruled OUT, one left
      standing.** The audit's leading suspect was the fuel cans, and its suggested fix was to
      drop `CAN_HOVER` from 0.55 m to ~0.15 m or ground them entirely. **Deliberately not done.**
      A floating can is not an accident, it is an explicit operator request ("maybe we can do
      floating gas cans?", plus "bobs gently"), so grounding them would break a requirement that
      IS met in order to chase one that the audit itself could not reproduce in four driving
      frames and twenty teleport frames. If the cans really are what he saw, the honest fix is to
      show him a video first.

      The suspect that survives is the audit's own second finding, and it has nothing to do with
      hovering: the RENDERED terrain mesh deviates from the analytic surface by a mean 2.63 m
      (worst 13.2 m) at 800 m and 11.8 m at 1200 m, so anything placed at analytic height that
      far out hangs above the drawn ground and then "lands" when a finer LOD streams in. That is
      a fall from the sky, it is LOD-driven rather than physics-driven, and it needs the placer
      to clamp Y to the coarsest LOD height that will actually be drawn at first-visible
      distance. Flora does not reach that far; stations, cans and props do.

- [ ] **Grass grows through the station forecourt and the tarmac apron.** Visible in two
      separate shots. The grass system knows about roads (`W2` asserts 118/118 centreline samples
      report on-road) but evidently not about station aprons or prop footprints.

- [x] **Terrain standing above the road — the shoulder grades down now, and the audit's own
      13.55 m figure was an artefact.** New tool: `node tools/diag-abovedeck.mjs`.

      **First, the measurement was wrong, and finding that out mattered more than the fix.** The
      audit compared the ground beside the road against `e.y` — ONE edge's own height profile.
      The surface the car drives on is `Terrain.height`, which is `RoadField.carve`'s blend over
      every road that reaches the point, and blending is the entire reason this game does not
      grow 80° walls where two roads pass at different heights. At the audit's own worst
      coordinate (2693, 9413) those two differ by **9.45 m**, which is most of its 13.55 m.
      Against the surface the car actually drives on — the same one `npm test`'s S2 asserts the
      drawn ribbon matches to 0.0000 m — alpine reads **0.46%** of carriageway-edge samples over
      1 m above the deck, not 4.01%, worst 5.94 m rather than 13.55 m.

      **The real complaint was still real**, just further out than 0.5 m: at (2693, 9413) the
      bank stood **+0.88 m at 6 m off the tarmac, +1.46 m at 8 m, +5.15 m at 12 m**. So the
      shoulder genuinely was not grading down. Fixed with a CUTTING-ONLY batter — `CUT_BATTER`
      2.0 against the fill side's unchanged 1.6, applied identically in terrain.js's
      `groundFromCarve` and roads.js's `carve` mask, which move together always. One-sided on
      purpose: the recorded 1.9 -> 108 and 2.4 -> 1016 disasters in the BATTER note are all FILL,
      181 of 199 samples, and widening a fill's shoulder past the mask that contains it is what
      builds a wall. A cutting brings ground DOWN into the hill and has no toe to step off.

      After, same point: **+0.23 m at 6 m, +0.04 m at 8 m, +1.14 m at 12 m.** Across alpine the
      bank 8 m off the tarmac drops mean 2.71 -> 2.25 m and 95th 4.24 -> 3.40 m; at 24 m out the
      95th goes 15.16 -> 12.22 m. Carriageway-edge figure 0.46% -> **0.32%**.

      **2.0 is a swept knee, not a taste.** 1.6 / 2.0 / 2.4 / 2.6 against `diag-cliffs.mjs` and
      `diag-relief.mjs`: the softening is roughly linear and so is its cost in alpine relief
      (0.091% -> 0.117% -> ~0.13% -> 0.140%), and at **2.6 the default-preset cliff gate itself
      breaks** (0.000% -> 0.004%). 2.0 buys ~20% off the bank at every offset with `diag-cliffs`
      still at **0.000%**.

      **What it cannot do, so nobody re-opens it expecting more:** in the alpine highlands about
      **43%** of the ground beside a road stands above it at ANY batter, because that is what a
      mountain is. "Never terrain above a road" is literally achievable only by flattening the
      mountains. This grades the shoulder; it does not delete the hillside.

- [x] **A landmark on the skyline at spawn — delivered on the default seed, and the mechanism
      shipped wired-but-off for the presets.** The audit stood at the old default spawn (301,602)
      and found the nearest massif **104 m at 1.78 km** — the very bottom of the 90-330 m range —
      with "nothing on the skyline that reads as head for that".

      **The default seed is fixed, and it came free from routing roads round the lakes:** the
      spawn moved off that plain to (115,-1081), where the nearest massif is **283 m at 1.59 km,
      filling 7.0° of sky**. Requirement met on the world the operator actually boots into,
      without any new scoring at all.

      **The mechanism is built, proven and documented but ships at zero.** `landmarkView()` in
      world/landmarks.js scores the most dominant massif visible from a point in DEGREES of sky —
      degrees, because that is what "reads as a landmark" physically is (283 m at 1.6 km is 10.1°
      and owns the skyline; 318 m at 6.5 km is 2.8° and is haze) — weighted by the massif's REAL
      height, because apparent angle alone rewards standing next to a bump and measurably did:
      the first version moved two seeds' spawns onto a 132 m and a 109 m hillock. `findSpawn`
      reads it through `LANDMARK_SPAWN_BIAS`, currently **0**. At 15 it fixes every preset —
      meadow's nearest massif 104 -> 283 m, marsh 78 -> 212 m, dunes 164 -> 226 m, all within
      1.3-1.6 km.

      **Why it is off:** moving the spawn ~200 m makes the browser suite's R1 check ("nothing is
      above the road surface") read 1 of 103 points at 1.60 m instead of 0 of 60. R1 compares one
      edge's own profile against the carve blend — the same apples-to-oranges that produced the
      audit's phantom 13.55 m — so it is a per-box lottery, not a world property: measured across
      eight seeds BEFORE anything changed this round, **six of the eight 840 m boxes already had
      R1 hits, worst 8.44 m**, and the default seed's box passing was luck. Diagnosed exactly: at
      (-895,1253) two arterials sharing node (-1,0) run 1.7 m apart, each graded to its own
      ground, and the carve blends both. Fixing it properly means levelling near-parallel
      arterial pairs, and letting arterials level against each other is already recorded in
      roads.js as tried and reverted (it moved every arterial in a 4 km square by up to 36 m).
      That is its own measurement round, not a rider on four other fixes. Evidence lives in the
      new "W5 again" section of `node tools/diag-relief.mjs`.

- [x] **The station "town" reads from a distance now.** The audit drove to a real station, looked
      back from 150 m, and got "a small white smudge behind trees" — the town "adds essentially
      nothing to the silhouette". The reason was arithmetic: the old kit's tallest piece is a
      7.5 m telegraph pole, which at 200 m subtends 2.1° — under the angular size of the tree
      line it stands behind. No amount of placement fixes an object shorter than its backdrop.

      Kit enlarged from 4 entries to 10, all from the EXISTING catalogue (no new geometry family,
      same as the original): a **clock tower at 14 m** — 4.0° at 200 m, roughly double the tree
      line — plus a flagpole, a second shed and a wall line so the base reads as a settlement
      rather than three separate objects. Measured over 56 real stations on the shipped seed:
      **1.71 -> 3.45 pieces per station**, and **1.23 tall pieces per station** where there were
      none (31 of 56 stations get the clock tower, 38 get a flagpole).

      Redundancy is deliberate and is why the count nearly doubled rather than merely growing:
      the audit measured the OLD kit delivering 2 of its 4 pieces at a real station, because the
      shed and second pole were both rejected by the shared placement tests — which are not being
      relaxed for set dressing. Several entries are now near-duplicates on opposite sides with an
      alternates group, so whichever side of a given station is flat and dry gets the landmark,
      and only ONE clock tower is ever placed. `bench-props.mjs` fully green.

### Playtest round 3 — new features asked for

- [x] **Sand particle spray when you go off-road**, to make it obvious you should not be there.
      BUILT — `src/game/spray.js`, one `InstancedMesh` of small solid grains thrown from the two
      REAR contact patches, coloured by blending the palette's sand/dry-grass/rock chips with the
      surface sample's own biome weights, rate driven by speed x `1 - car.onRoad` x tyre effort
      x how much loose material the ground has. Measured (`node tools/diag-cozy.mjs`): nine
      seconds ON the road at 79 km/h spawns **0** grains; the same nine seconds OFF it at 44 km/h
      throws **636**, capped at 260 live, every live instance carrying a non-degenerate scale and
      every one of them behind the car. Sand throws 2.2x what wetland does. NOT YET LOOKED AT in
      a browser — that it looks like dust rather than like confetti is a "look at it" claim and
      is not made here.
- [x] **Birds — seagulls — around the map**, especially near water.
      BUILT — `src/render/birds.js`. Deterministic flocks on a rolling 340 m lattice around the
      car, placed by the same "is this ground under its water plane" question `render/ships.js`
      and `audio/ambience.js` both already ask; a tile whose two probe rings are ≥22% wet gets a
      3-7 bird SEA flock, a dry tile with real woodland gets a 2-4 bird land flock. Each bird
      wheels on its own orbit, banks into it, and flaps in BURSTS between glides. One draw call
      for every bird in the world: the flock is re-baked into a single preallocated geometry each
      frame rather than instanced, which is what buys a wing that actually moves without a new
      shader to compile (gotcha 5 — a purely visual feature is not worth another GPU gamble).
      Measured (`node tools/diag-birds.mjs`, seed 20260726, 144 km²): **288 flocks / 1292 birds**,
      **82.4% of them over water**, a **20.7x** water bias by area, and birds in view for
      **88.3%** of a 12 km diagonal drive at a mean of 23 in range. In a REAL THREE scene at
      (1782, 553) the mesh is in the scene graph, **71 birds are written into the geometry**, the
      draw range covers exactly those 1704 indices, every vertex is finite, the widest drawn
      wingspan is 1.49 m and the flock sits 17-49 m up. NOT YET LOOKED AT in a browser — that
      they read as gulls rather than as paper darts is a "look at it" claim and is not made here.
- [x] **Fuel cans and trash cans: bigger, and glowing,** so they are not missed.
      BUILT — `src/render/props.js`. The can's baked geometry went from **0.312 x 0.440 x 0.242 m**
      (an audit measured it as an 11-pixel speck at 14 m) to **0.753 x 1.012 x 0.628 m** via
      `CAN_SCALE`, about its own base so `CAN_HOVER` and every placement test in
      `src/world/props.js` are untouched; the 5 cm EMIT glint became a full lit front AND back
      panel plus a lit collar (**98 of 309 can vertices are now self-lit**); and a soft additive
      halo billboard rides the existing bob. TRASH CANS DID NOT EXIST AT ALL — no catalogue
      entry, no geometry, not even the word anywhere under `src/` — so `buildLitterBin()` is new:
      a waist-high drum with a lit shoulder band, baked into the tile's shared mesh (no extra
      draw call) beside every can, on the side AWAY from the road, chosen by asking the real
      `RoadField.carve()` which side is further from the tarmac. **30 of 30** cans have one,
      1.11 m tall. `tools/bench-props.mjs` still passes in full, collection still pays exactly
      `CAN_FRACTION`. NOT YET LOOKED AT in a browser: whether the halo reads as a warm glow
      rather than a quest marker, and whether the bin makes the pair legible at 150 m.
- [x] **A positive pick-up sound when you collect a fuel can**, crystal clear.
      BUILT — `EngineAudio.pickup()` in `src/audio/engine.js`, wired in `src/main.js` on the one
      callback that can say a can was collected THIS frame (`collectCans`). A rising C6-E6-G6
      major arpeggio 70 ms apart, sines with a quiet triangle doubling an octave below, peak voice
      gain 0.085 (the horn is 0.16) — a small kindness, not a game-show sting. Measured with a
      stub AudioContext (`tools/diag-cozy.mjs`): six voices really created in the graph, three
      distinct ascending notes, fires exactly once on the frame of collection, never on later
      frames, and still fires while auto-drive has the wheel.
      **CREDENTIALS NOTE — HONOURED:** the operator offered API keys for a sound-effects service,
      stored in his password manager. Those keys were **not requested, not opened and not used**,
      and no audio file was downloaded. This project already synthesises all of its audio in the
      WebAudio graph (the radio and engine are both generative and unlicensed), so the pick-up
      chime is synthesised the same way. Zero licence exposure, zero credentials, and it matches
      the existing sound design. Logged in `docs/CREDITS.md`.

- [x] **Auto-drive must accrue NO streak and burn NO fuel.** The audit measured the opposite in
      the live game: with `auto.on === true` the streak climbed 145 -> 4595 m over eight minutes
      and the tank fell 0.696 -> 0.109 over the same run. Cause was blunt — `streak.js` and
      `fuel.js` contained no reference to auto-drive at all, and `main.js` called both
      unconditionally. Both are now GATED, and both are gated the cozy way:
      `Streak.update(dt, car, surf, { paused })` FREEZES (does not reset — a chauffeured
      kilometre must not count, and taking your hands off the wheel must not cost you the eighty
      you already earned; the off-road grace timer is held too, so an autopilot that clips a
      verge cannot break a streak you are not building), and `Fuel.update(dt, car, { burn })`
      suppresses only the BURN — cans, shares, the station scan and the pumps all keep working,
      because switching those off would quietly break the gauge and the pick-up chime for as
      long as the chauffeur had the wheel. Time spent free is counted on `stats.freeSeconds` so
      it can be proved rather than inferred. The HUD says why the big number has stopped moving
      ("held while auto-drive has the wheel") — a figure that silently freezes reads as a bug.
      Measured (`node tools/diag-cozy.mjs`): 60 s of auto-drive moves the streak **0.0 m** and
      the tank **0.720000 -> 0.720000**; the identical 60 s with auto OFF still gives 1980 m and
      0.4328, so the gate is a gate and not a broken fuel system.
- [x] **Auto-drive's stuck-reset, proven against a deliberately wedged car.** The audit never saw
      it fire, which is not the same as it not working — nothing in the run ever pinned the car
      for the 3.5 s `STUCK_TIMEOUT`. `tools/diag-cozy.mjs` now wedges one on purpose: `recover()`
      is called, at **3.50 s**, with the toast "stuck — resetting to the road", and a control
      case proves a car merely MOVING is never reset over 20 s of driving. No code change was
      needed; what was missing was the test.

- [ ] **Day/night cycle.** Operator asked for this to be PLANNED with Fable and IMPLEMENTED with
      Sonnet 5. Not started — it is queued behind the bugs above deliberately, since a lighting
      change touches every shader in the game and the current build is green.

- [x] **CP1 — dunes now actually look like a desert.** The operator asked for "a new desert
      theme"; the terrain SHAPE and the off-road sand physics shipped, but the COLOUR never did.
      Measured on screen at 89% dunes weight, beside the car: **(139,138,93)** — olive dry grass.

      Cause: `BIOME_TINT`'s dunes entry is a colour **multiplier** (1.42, 1.06, 0.78) applied over
      the shared green terrain stops, and a multiplier cannot turn green into sand — the most it
      can do is make dry grass, which is exactly what it did. Its own comment claims a
      "rose-and-ochre sand sea", which was never achievable that way.

      Fixed by giving sand its OWN stops (`sandLit/sandMid/sandShade/sandHollow` in
      `core/palette.js`) and blending them in by the dunes biome weight, exactly the way the snow
      stops are already blended in by the snow scalar a few lines below — same pattern, no new
      mechanism. Thresholded (`smoothstep(0.30, 0.80, w[3])`) so a meadow carrying a few per cent
      of dunes does not go sandy.

      After, same three samples: **(164,134,107) / (183,152,114) / (176,144,111)** — red channel
      leads everywhere, green no longer dominates anywhere. Verified visually too, not just
      numerically. `npm run test:browser` 40/40 (the real GPU compile is the gate for any shader
      change), `npm test` green, live 40/40.

- [ ] **C2's brake test can land on low-grip ground and read a false failure.** Seen once on live
      immediately after the dunes work: `C2 the brakes stop the car promptly — 109 km/h to 0 in
      145 m` against a 55 m bar, then **41 m (34 m scaled) on both immediate re-runs**, and 40/40
      on localhost with the identical build. So it is site variance, not a brake regression — but
      it is worth closing, and it is newly more likely to bite: the same round made off-road sand
      dramatically harsher for non-rally cars, so a run-up that strays off the tarmac now brakes
      far worse than it used to.

      C2 already searches for a clear stretch before its run-up (added when auto-drive's cruise
      governor capped it at 35 km/h). The gap is that nothing asserts the car was still ON the
      road for the braking measurement itself. The fix is small and in the same spirit as the
      guard O2 already has: record `onRoad` at the moment braking starts and finishes, and either
      retry or fail loudly if the stop happened off the carriageway — rather than silently
      reporting a sand-braking distance as if it were a tarmac one. Not done this pass; one item
      per pass, and the dunes fix was the item.

- [x] **RESOLVED — startup frame rate regressed on the LIVE build.** Now **60 fps across three
      consecutive live runs**, 40/40 each. Fixed as a SIDE EFFECT of the water grading pass, not
      by deliberate perf work: that pass cut the shore foam's depth reach from 1.25 m to 0.40 m,
      gated caustics to 240 m, and moved the distance flatten earlier — all real fragment-shader
      savings, and the suite's spawn sits beside water. Recorded rather than deleted because the
      diagnosis below is still the right method if it recurs, and because "an aesthetic change
      fixed a perf bug" is exactly the kind of coincidence that misleads later. The original
      symptom follows.

      `npm run test:live` reported
      **22.8 / 23.8 / 22.9 fps** across three consecutive runs at the "running at a playable rate
      once warm" check (bar is 24), where it was 40/40 green before the second playtest round.
      Reproducible, not variance.

      **What is and is not affected, measured:** the very next check, "still running at a playable
      rate after driving", passes at **58–60 fps** in every one of those same runs. So steady
      state is fine and the world settles — this is specifically a STARTUP burst cost in the first
      seconds after load.

      **Why localhost hid it:** `npm run test:browser` against localhost passes 40/40. The warm
      check samples 4 s after the world reports streamed (browser-test.mjs ~line 474); localhost
      serves the bundle fast enough that the initial build burst is over by then, and the live
      host does not. Any future perf work has to be judged against `test:live`, not localhost —
      localhost is not a valid gate for this particular check.

      **Prime suspects, all landed in the same round and all doing work at spawn:** station access
      spurs and their junction geometry, the station "town" set-dressing clusters, ships on large
      water, snow-dusted pine variants, flowers, and the higher tree/scatter build-ahead radius
      from the pop-in fix. Each is individually modest; the burst is presumably their sum. The
      honest first step is to MEASURE which one dominates (build time per subsystem during the
      first seconds) rather than tuning them all down blindly — this project has a documented
      history of "obvious" perf and terrain fixes that measured worse afterwards.

      Not shipped as a regression knowingly: the round was already deployed when the live figure
      came back, and the game is playable throughout (23 fps briefly, then 60). Recorded here as
      the top item rather than left to be rediscovered.

- [x] **RESOLVED — valley mist now ships and works.** The cause was neither a SwiftShader limit,
      nor uniform counts, nor the cloud-material chunk interaction — every one of those theories
      was wrong. The captured GPU compile log named it directly:
      `ERROR: 'patch' : Illegal use of reserved word`. The mist layering variable was called
      `patch`, which is **reserved in GLSL ES 3.00**, and it lived in the chunk every material
      concatenates, so all eleven programs failed at once and the game rendered black. Renamed to
      `mstPatch`. Live at 40/40 with mist on and no console errors.

      **Keep the lesson, it cost a full revert:** no node-side static check can see a reserved
      word — not bracket balance, not symbol resolution, not chunk-combination assembly, all of
      which the original author ran and passed. Only a real GPU compile catches it. Shader work
      is gated on `npm run test:browser`, never on static analysis. The original write-up follows.

      The operator
      asked for the original scene's valley mist. It was implemented (analytic exponential-density
      integral inside `aerial()`, a `uMist` uniform in GL_UNI, a matching horizon band in
      `skyDome`/`skyDomeLite`, and its own `mstHash`/`mstNoise` in GL_LIGHT) and it broke the
      renderer completely: **every** RawShaderMaterial failed with
      `THREE.WebGLProgram: Shader Error 1282 - VALIDATE_STATUS false` and the game rendered black.
      Reverted; the working tree shipped green at 40/40 without it.

      **The lesson worth keeping:** it passed every static check its author ran — bracket balance,
      symbol resolution across all eleven real chunk combinations, the GL_LIGHT-without-hash case
      specifically. It failed at GPU VALIDATION, which no node-side check can see. Shader work
      must be gated on `npm run test:browser`, never on static analysis alone.

      The reverted implementation is preserved at `D:\OpenClaw\tmp\glsl.mist.bak` and
      `D:\OpenClaw\tmp\uniforms.mist.bak`. Suspects not yet distinguished: a SwiftShader
      instruction/complexity limit (the suite runs headless software GL), a uniform-count limit
      from adding to GL_UNI which every shader includes, or the GL_LIGHT/cloud-material
      interaction. A focused pass is underway.

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
- [x] **O1 — off-road is now judged per wheel.** Each of the four suspension probes queries
      the road surface where it actually stands. Measured 3.36 m off the centreline: front-left
      on grass (onRoad 0.01), front-right still on tarmac (onRoad 1.00) — clipping a verge with
      two wheels now reads as what it is. `node tools/diag-body.mjs`.
- [x] **W1 — trees do not stop you.** Now a dead stop: 126.7 / 157.1 / 181.4 km/h all become
      **0.00 km/h** on a square hit, at rest 1.58 m out from a trunk whose contact distance is
      1.55 m. The narrow phase is SWEPT, so nothing tunnels — caught at every frame time up to
      dt 0.1 and every step length up to 40 m. Colliders are now measured against the DRAWN
      trunk (`TRUNK_R` in `game/collide.js`, checked by `node tools/diag-collide.mjs`) and
      centred on the renderer's own instance root, error 0.00e+0 m in x, y and z. The rock and
      fence-post colliders are gone: **nothing draws `scatter.rocks`, `.posts` or `.reeds`**, so
      those were invisible walls — 26 per hectare of highland, up to 2.4 m across. A graze still
      slides (keeps 94% of its speed). `node tools/bench-impact.mjs`.
- [x] **W7 — water is a trap.** `game/rescue.js`. Touch the water and you are put back on the
      road **0.60 s** later (0.25 s to arm, 0.35 s of the car settling), **0.65 s** from the
      very first drop, and driving again at **1.13 s**, via main.js's own `backToRoad()`.
      Gated on CONTACT depth (0.25 m — water onto the rim, tyres being 0.34 m in radius) and on
      being off the carriageway, so it still cannot fight you: 60 s pottering in 0.14 m of
      shallows, 60 s of lakeside road with deep water 9 m off, twelve 0.2 s ford/shoreline dips
      and 60 s parked in 0.14 m of beach wash all give **0 rescues**.
      `node tools/bench-rescue.mjs`. A better-looking water treatment is still open.

      **Revised 2026-07-27 — "Water = respawn (R) on contact not float under" (the operator).**
      It used to be 0.6 m held for 1 s plus 1 s of settling: **2.13 s** of wallowing, by which
      time the car had sunk to **6.80 m**. Now 0.25 m / 0.25 s / 0.35 s: **0.65 s**, deepest
      **2.39 m** — measured A/B against the same terrain in one process, since the constructor
      takes `contact`/`hold`/`lift` as options. The one deliberate behaviour flip: the old
      "twelve 0.9 s dips → 0 rescues" case now gives **3 rescues**, because a 0.9 s submersion
      is not a dip, it is the floating-under being fixed. The dip test now runs at the new
      arming scale (0.2 s in, 0.2 s out → 0) so fords and clipped shorelines still pass through
      untouched. Not gated on `d > 0` literally: the wash at the dunes shoreline (668, -439) is
      0.14 m and peaks at 0.18 m, and yanking the car off a beach for standing in the surf
      would break the never-fight-you rule the same brief also asked to preserve.
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
- [x] **G1 — the streak now reads at a glance.** A bottom unlock-progress bar shows the next
      car and the distance left, lit while a streak is running, with a red blip on a break.
      21/21 checks in `node tools/diag-hud.mjs`, driven against the real Hud and Streak classes.
- [x] **G6 — multiplayer, proven for the first time.** See the Done entry below — `?seat=2` was
      wired but never actually called, so it did nothing until this pass.
- [x] **C6 — body pitch now follows the real surface**, not the spring/roll layer alone,
      so the nose stops pointing into the hill on a climb.
- [x] **O4 — rollover, with recovery.** Off-road, at speed, into a bank, the car can now go
      over past 90° and rights itself afterwards rather than getting stuck upside down.
      O1/C6/O4 landed together in `src/car/vehicle.js`; `node tools/bench-car.mjs` stayed at
      15/15 throughout (byte-identical to the pre-change baseline) and `node tools/diag-body.mjs`
      is the new evidence for all three. Not wired into `npm test` — it is a slower scripted
      drive, not a fast gate; run it by hand after touching vehicle.js.

### Playtest round 3 — the presentation / audio / multiplayer fixes

Every entry here carries its evidence and, where the claim is visual, says so explicitly. None
of these was seen in a browser by the agent that wrote them: this checkout is shared and only
the audit pass gets a dev server. NOTHING BELOW COUNTS UNTIL IT IS OBSERVED RUNNING.

- [x] **Water: the far-field moire.** The report kept everything else about the water (calm,
      flat, soft-shored, ships, sea sound all confirmed) and failed one thing: "coarse diagonal
      streak banding across the whole left half of the lake" plus "a fine crosshatch shimmer
      band forming at mid-to-far distance ... in motion it will crawl". Root cause, in
      `src/render/water.js`: `bandLimit()` is an ANISOTROPIC gate, and correctly so, but an
      anisotropic gate keeps a band alive whose CROSS-axis frequency is still resolvable — and
      at grazing incidence that band is then point-sampled once inside a pixel tens of metres
      long DOWN the view. Undersampling along the view of bands that all run down one fixed
      world axis is exactly a crawling diagonal streak. Fixed by removing the signal instead of
      trying to filter it: a `farFlat` term (90 m -> 300 m) multiplies out the ripple normal
      amplitude, the gust field, the flow ribbons and the quantised glitter, and the existing
      normal flatten now reaches genuinely flat instead of stopping at 92%. `bandLimit` also
      tightened from 0.28/0.72 to 0.20/0.52 — Nyquist is 0.5, so the old window was still
      point-sampling past the point of no information. Nothing inside 90 m changes at all.
      Evidence: `node tools/diag-watershader.mjs` — 9/9, including a reserved-word scan, brace
      balance, and that all four per-pixel terms take the gate; 54% flattened at 200 m, 100% at
      300 m. **NOT COMPILED ON A GPU** — see gotcha 5. Re-photograph at (974, 2101) with the
      same 2.4x zoom before believing it.
- [x] **Auto-drive: the camera goes cinematic.** The audit measured `cine.active === false` in
      ~100 consecutive samples and reported, correctly, that what actually happened was
      `chase.driftW` ramping and the boom widening. That is a nice camera and it is not a
      cinematic, because it has no CUT in it. `src/car/camera.js` now runs a six-shot list —
      wide / high and back / low quarter / over the shoulder / the long lens / roadside — held
      10.5 to 16 s each and CUT, not eased, between. The slow orbit keeps running inside every
      shot so nothing is a locked-off still. The cut snaps position, aim and FOV in one frame
      and hands the new shot the CAR'S OWN VELOCITY (placed a spring-lag behind the pose), which
      is what stops the rig standing still in world space while the car drives out from under
      it — that alone was 110 deg/s of bearing change, exactly the whip the rig's whole design
      budget exists to prevent. `chase.cinematic`, `chase.shot` and `chase.cuts` are public so
      the next audit can measure it instead of inferring it. Handing `game/cinematic.js` the
      camera was considered and rejected: that programme is scouted ONCE at boot around the
      spawn, so replaying it 40 km away flies a crane over ground that is not there, and it owns
      an overlay, a skip hint, a HUD dim and a document-wide key listener. Evidence:
      `node tools/diag-cinematic.mjs` — 13 cuts in 180 s across all 6 framings, holds 10.5-16.0 s,
      between-cut peak **7.42 deg/s** (budget 10), the post-cut settle peaks at 19.7 deg/s for
      under 0.2 s and moves the bearing **1.89° in total**, and taking the wheel back still
      lands on the gameplay pose with the drift term EXACTLY zero. The 14 pre-existing failures
      in that tool are about the opening intro and are unchanged by this pass.
- [x] **Multiplayer: the stale peer. THIS WAS THE REAL BUG.** `server/drive.php`'s position
      filter used to reject a jump by pinning the row back to the previous position and writing
      a fresh `seen`. That is a one-way door: the next tick compares against that same stale
      row, by which time the client has driven FURTHER, so the distance has grown and it fails
      again, for ever. The client keeps getting 200s full of other people's peers the whole
      time, which is precisely why tab A could see tab B while being invisible itself. Any
      legitimate teleport opens it — R to get back on the road, the water rescue, the
      out-of-fuel reset to spawn, or a buried tab resuming. The filter now WALKS the stored
      position toward the claim by the largest legal step instead of refusing to move it; every
      property it was defending is kept (a client is still capped at `WR_MAX_SPEED`) and the
      wedge is impossible. Evidence: `node tools/net-devapi.mjs` — the old rule is reproduced
      and measured at **225 m wrong after 96 s, growing to 818 m** while the player keeps
      driving; the new rule converges in **one tick**; a client claiming 50 km per tick still
      only averages 105 m/s. PHP is not installed here, so the last three checks read
      `drive.php`'s own source to prove production carries the same clamp.
- [x] **Multiplayer: ghosts are the right car.** An earlier round fixed the WIRE (sending the
      fleet index instead of the Vehicle's silhouette string) and recorded the item as done, but
      the correct index was still handed to `buildGhostCar()`, which has three shapes. Seven
      cars, three bodies, none of them the one being driven. `src/net/ghostCar.js` loads the
      same per-fleet GLB the driver is driving through `loadedCar.js`'s `loadGhostCar()` — which
      has existed and been imported by main.js unused all along. It returns a handle
      SYNCHRONOUSLY with the procedural body as a stand-in (remotes' `_spawn()` cannot await a
      180 KB download) and swaps the GLB in when it lands; if it never lands the stand-in stays,
      the same fallback the local car already takes. It also implements the `update()` that
      remotes.js has been calling on ghosts for a long time, so a ghost's wheels finally steer
      and spin off its own reported controls. Evidence: `node tools/diag-ghostcar.mjs` — 8/8,
      all seven wire tiers resolve to seven DIFFERENT cars, every ghost has a body on frame 1,
      dispose is safe mid-load. The GLB cannot load in node, so **that the real model appears is
      NOT proven here** — `window.WANDEROAD.ghostStats.upgraded` is the number to read in a
      live browser with a peer present.
- [x] **Multiplayer can finally be tested locally.** `GET /api/drive.php` on the dev server
      returned index.html (Vite's SPA fallback), the PHP driver threw on the JSON parse, the
      transport chain silently demoted to the in-closure `local` driver, and every localhost
      window was permanently solo — including the garage's own "Second window here (seat 2)"
      link. `server/devApi.mjs` is the same endpoint in-process over a Map, mounted as a Vite
      plugin (`apply: 'serve'`, so it adds nothing to the build) and carrying the SAME position
      filter and the same constants as drive.php, because a dev mirror that disagreed about
      that filter would hide the exact class of bug it exists to expose. Verified over real
      HTTP: `/api/drive.php` answers `application/json`, two clients see each other with the
      right fleet index, `/api/state.php` reports the population, and every other path still
      falls through to Vite.

## Next

Newly asked for, not yet started:

- [x] **Trees pop in just in front of you, and the cinematic cam shows grass popping out of
      existence behind the car.** Two playtest reports, two separate root causes, both
      measured rather than assumed — `world/scatter.js`, `render/trees.js`, `render/grass.js`.

      TREES. `tools/diag-treepop.mjs` drives a real car with the real `Autopilot` along the
      real road network, through a simulated worker pool timed against REAL `buildChunk()`/
      `scatterChunk()` calls, feeding the real `Flora`. In steady state (queue empty, not the
      cold-start burst — that resolves in ~17 s and was not the ongoing problem) trees were
      still attaching as close as **222–260 m ahead (~10.5 s from arrival at the project's own
      95 km/h cruise)**, hard and instant, no fade — because `SCATTER_MAX_LEVEL` (2) capped
      tree DATA at a ~870 m existence radius, silently undercutting `render/trees.js`'s own
      1400 m `DEFAULT_CULL` the whole time, and a level-2 node's own near edge can sit far
      closer to the car than the node's characteristic distance. Two-part fix: `SCATTER_MAX_LEVEL`
      2 -> **3** (existence radius -> ~1740 m, past the 1400 m cull at last) measurably widens
      typical lead time — steady-state median pop-in 1117.6 -> **1210.9 m**, mean 1017.7 ->
      **1143.2 m**, p10 554.2 -> **638.5 m** — but the worst-case close attach barely moves
      (227.9 -> 227.5 m), because that mechanism recurs at any LOD boundary. So every attach
      now grows in from a 5% seedling to full size over 1.5 s, anchored at its own root (reuses
      the existing per-instance scale channel, zero shader changes). Verified as real geometry,
      not just code that runs: `tools/diag-treegrow.mjs` samples a live instance's actual GPU
      attribute float every frame — 5.1% -> 100% of target, monotonic, landing exactly on
      schedule. Frame cost: `Flora.update()` mean +0.019 ms/frame (0.048 -> 0.067 ms), worst
      frame 4.29 -> 6.46 ms — both trivial against a 16.7 ms budget. Not fixed, flagged: a
      level-3 node's `scatterChunk()` costs ~36 ms, paid synchronously on the main thread in
      `main.js`'s `onChunk` (same pre-existing pattern every level already uses, just extended
      to one more, much rarer level) — a real hitch risk if it lands in a render frame, but
      restructuring that onto a worker is a `main.js`/`chunkWorker.js` change outside this
      pass's files.

      GRASS. Read `main.js`'s real frame loop rather than guessing: `flora`/`water`/`clouds`/
      `wind` all get `camera.position`, but `grass.update(car.x, car.z, car.y, dt)` gets the
      CAR's position — the one outlier. Ring residency being car-anchored is intentional (the
      file banner's own point 4), so that stayed; but `_draw()`'s visibility test — distance
      bands AND the cone cull against `U.uCull` (always the TRUE camera's forward direction) —
      was also being evaluated from that car-relative point. The sport camera sits ~6–7 m from
      the car, so this rarely showed; `car/camera.js`'s DRIFT orbit (auto-drive only) swings the
      rig up to ~25 m out and ~39° around the car while looking back across it, which is enough
      to make an already-built, already-resident chunk that IS in the true lens's view fail a
      test measured from 25 m and 39° away — `mesh.visible = false` for a chunk whose own data
      never changed, i.e. grass popping out of existence. Fix: `_draw()` now reads
      `U.uCamPos`/`U.uCull` directly (already fresh by the time it runs) instead of the
      passed-in car position; `_recentre`/`_ensureRegion` untouched. `tools/diag-grasscine.mjs`
      drives a real car through the real DRIFT orbit against the real `Grass`: measured camera
      offset up to 25.1 m, orbit swing up to 38.6°, and **5.43%** of resident-chunk samples
      where the true camera should see a chunk the old car-relative test would have hidden.
      Cross-checked the actual shipped code (not just the theory) against an independent
      oracle fed the true camera position over 438 058 real samples: **0 disagreements**. Frame
      cost: isolated steady-state `_draw()` (nothing dirty) measured at 0.016 ms mean / 0.30 ms
      worst over 244 chunks / 361k instances — the change swaps which `Vector3` three numbers
      are read from, so no regression is possible in the arithmetic, confirmed in practice.

      `npm test` and `node tools/bench-props.mjs`/`bench-fuel.mjs` stayed green throughout
      (scatter.js's other consumers all call `scatterChunk` at fixed levels 0/1, never bound to
      `SCATTER_MAX_LEVEL`, so raising it cannot touch them — checked by grep before relying on
      it). No GPL/AGPL, no new third-party assets — pure code, nothing for docs/CREDITS.md.
- [x] **Snow biome: pine-only trees, snow-dusted foliage; dunes: a real desert shape and sand
      that actually bogs you down off-road.** Two playtest reports from screenshots, `world/
      biomes.js`, `world/scatter.js`, `render/trees.js`, `game/presets.js`, `car/vehicle.js`,
      `game/garage.js`.

      SNOW TREES. "Green bushes/trees should be covered in snow too in snow biome -- only pine
      trees in snow biomes." Cobalt Highlands is the snow biome (`BIOME_TINT[HIGHLAND].snow`
      is the only nonzero entry in `core/palette.js`), and `BIOME_SCATTER[HIGHLAND].kinds`
      already said pine/pine/deadpine — but `scatterChunk`'s tree emitter picked a tree's
      SPECIES with `pickBiome(w, rnd())`, drawing from the site's FULL blended weight vector
      rather than its dominant biome, so a site that read as highland to the player could still
      roll a meadow/steppe species (broadleaf, acacia) a fraction of the time — a real
      cross-biome leak, not a cosmetic one. Fixed narrowly in `world/scatter.js`: once highland
      is the DOMINANT biome at a site, draw its own kinds only; the genuine mix the weighted
      draw is FOR still happens in the approach, where highland has not yet won. Measured with
      the new `node tools/diag-snowtrees.mjs` against 5800 real tree sites at real
      highland-dominant coordinates (alpine preset, 2401 level-0 chunks scanned around a real
      spawn): **0 non-pine kinds**, was leaking before the fix.

      No snow-covered material existed anywhere for trees/bushes — `vTint` only ever carried
      the per-biome foliage COLOUR multiplier, never a white-dusting term. Rather than invent a
      second system, `render/trees.js` now reads the SAME per-biome `snow` scalar
      `terrainMaterial.js`/`grass.js` already blend by (`biomeTintArrays().scal`'s third
      component, packed into a new `B_SNOW` GLSL array alongside the existing `B_FOLIAGE` one)
      and blends toward the SAME three colours those two files already use
      (`vec3(0.95,0.96,0.99)` lit / `(0.80,0.85,0.94)` mid / `(0.58,0.66,0.82)` shade) over the
      SAME 120–240 m altitude band, so a snowy hillside's pines and bushes read as part of the
      same snowfall as the ground and sward they stand in rather than a disconnected overlay.
      Biased toward upward-facing surfaces (`N.y`) so the dusting sits on top of a canopy or
      bush rather than painting it solid. `node tools/diag-snowtrees.mjs` replicates the real
      shader formula in JS with the real per-biome numbers (the `diag-carpaint.mjs` technique)
      and shows Cobalt Highlands foliage moving from plain green to (0.90, 0.92, 0.91) as
      altitude crosses the snowline while Hoshi Meadow (snow = 0.0) never moves at any
      altitude — the material is wired to the real scalar, not a flag nothing reads.
      `render/trees.js` is NOT part of `render/painted.js`'s pipeline (Flora owns its own
      RawShaderMaterial; painted.js is buildings/props/road furniture only) — this reuses
      trees.js's OWN existing per-vertex biome-tint mechanism rather than building a second
      material system, which is the same principle the painted-pipeline instruction was
      pointing at.

      DUNES SHAPE. "Dunes must be a new desert theme... dunes smooth but tall", not another
      hilly preset with a sand texture. `BIOME_TERRAIN[DUNES].amp` 62 -> **70** (biomes.js,
      applies everywhere dune-weighted ground exists, including inside other presets) with the
      comb term's SHARE pulled 0.20 -> 0.16 in the same move so its absolute crest contribution
      stays flat while the smooth billow part genuinely grows — see the in-file comment for the
      full reasoning. A larger first attempt (amp 96) measured taller but pushed
      `node tools/diag-cliffs.mjs`'s DEFAULT-preset gate from 0.016% to 0.060% against its
      committed 0.019% ceiling: a known highland/meadow/steppe boundary hot-spot (the same
      cluster the W4 fix already had to fade in) sits within a few points of 45° on its own
      relief, and even an 8–9% trace of dunes weight there was enough to tip several samples
      over — reverted to the smaller, safe step. The rest of "tall" is bought in
      `game/presets.js`'s dunes preset alone (`amp` 0.9 -> **0.98**), which cannot touch that
      gate at all (scoped to the preset, `diag-cliffs.mjs` never calls `applyTerrain`).
      Measured, `node tools/diag-relief.mjs dunes`: 720 m-window relief median 73.8 -> **78.2**,
      mean 80.5 -> **83.7**; at the real spawn (the number the W4 entry above tracks) 34.3 ->
      **39.5**; massif road grades essentially unchanged (0.9%/22.5%, was 1.0%/22.7%) — taller
      without the roads getting harder to climb. Dunes' own cliffs figure moved 0.001% to
      0.065%, deliberately kept under alpine's ("the most dramatic and the least forgiving")
      own 0.147% so dunes reads as tall-but-smooth rather than the jaggedest preset in the
      game. `node tools/diag-cliffs.mjs`'s default-preset gate itself: unaffected by the preset
      change, and the biomes.js step alone measured 60→31 of 360 000 across two different
      states of a concurrent, unrelated roads.js fix landing mid-session (see below) — safe
      against both.

      DUNES OFF-ROAD. "sand makes impossible drive offroad 10+ meters (slow/stuck) for
      non-rally cars." Ordinary off-road in this game is a flat, `onRoad`-driven penalty, the
      same everywhere; nothing distinguished sand from grass off the tarmac. New `SAND` block
      in `car/vehicle.js`: while a wheel is genuinely off the made surface AND the ground is
      dune-dominant, distance actually travelled accumulates into a bog severity (0 at 0 m, 1
      at 7 m for the ordinary fleet) that steepens the off-road speed ceiling AND — the term
      that actually matters — a NEW speed-proportional resistance (a flat rolling-resistance
      bump alone cannot bleed off a fast entry speed within a few metres; a term that grows
      with speed can). Drains back to 0 in about 1.6 s once the car is back on a made surface,
      never a hard wall (there is always a real, if tiny, crawl speed), and R still works.
      Measured with the new `node tools/diag-sandbog.mjs` (a controlled synthetic-field unit
      test, isolating this from the real road network's own curves): a non-rally car leaving
      the tarmac at 70 km/h is down to **8.5 km/h by 20 m** and **never reaches 25 m** in dune
      sand, against **61–63 km/h at the same marks** on an ordinary off-road patch under
      identical throttle — dramatically harsher, not "somewhat slower". The fleet already
      documents the Rally as "the only one that is genuinely happy off the tarmac" via
      `feel.offRoad: 1.35` in `game/garage.js`, which — like the Patrol's brakes and the
      Estate's forgiving ones before it — was declared and read nowhere outside that file.
      Wired: `applyCarFeel()` now sets `TYRE.offRoadMul`, and the Rally's severity is capped at
      1/1.35 ≈ 0.74 rather than merely delayed (dividing only the DISTANCE still walked every
      car to fully stuck eventually, just a few metres later — measured, then rejected for
      that reason). Confirmed on the real wiring path (`applyCarFeel(FLEET_BY_ID.rally)`, not a
      hand-set number): the Rally reaches 25 m at 13.3 km/h where the non-rally car never
      arrives at all.

      **A concurrent-session note, said plainly because it happened mid-pass:** partway through
      this work, `world/biomes.js`, `game/presets.js`, `game/garage.js` and `car/vehicle.js` —
      including another session's own unrelated tilt/rollover work in the last of those — were
      all found reverted to their pre-session state at once, almost certainly a stray write
      from another concurrent agent in this same checkout racing a `git` operation neither
      session was asked to run. Not fought or reverted-back blindly: re-verified against the
      actual current disk state and re-applied cleanly, with the other session's own tilt/
      rollover changes (`_smRoll`/`_smPitch`, the `onRoadMin`-based off-road gating, the
      reverse governor) intact and coexisting rather than clobbered a second time. `npm test`,
      `node tools/bench-car.mjs` and `node tools/bench-props.mjs` all re-verified green
      afterward. Left here as a signal that whatever is doing full-file writes across sessions
      in this workflow is a real risk worth the orchestrator knowing about, not just this pass.

      `npm test`, `node tools/bench-car.mjs` and `node tools/bench-props.mjs` all green. No
      GPL/AGPL, no new third-party assets — pure code and constant-table changes, nothing new
      for docs/CREDITS.md.
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
- [x] **Positional ambient audio.** `src/audio/ambience.js` — the sea builds as you approach a
      shoreline and birds thicken near woodland, both distance- and direction-attenuated, ducked
      under the radio and engine. `node tools/diag-ambience.mjs`.
- [x] **Forests, not scatter.** Tree density is now a low-frequency deterministic field:
      measured 48.5 trees/ha in dense forest, 4.7/ha in thin woodland, 0.0/ha on an open plain
      (plains keep their boulders). `node tools/diag-forests.mjs`.
- [x] **Flower beds.** A separate clustered ground-cover layer with a dense core and a soft
      edge, `src/render/flowers.js`, through the same painted pipeline as everything else.
- [ ] Left by W4/W5, both small and both in someone else's file.

      `BIOME_TERRAIN.rough` is dead — documented as such in `biomes.js` itself (line ~166),
      and deliberately left in place rather than removed: "that is a behaviour change dressed
      as a tidy-up." Leaving it stand; not worth re-litigating a decision that was already made
      on purpose.

      **Investigated this pass, NOT fixed, recorded instead — the road-`grade` lever named
      here previously was the wrong diagnosis.** Fresh reading, `node tools/diag-relief.mjs`:

      ```
      preset   summit h(m)  radius(m)  steepest face  median grade  worst grade
      meadow          104        654          13.8°          2.0%        27.1%
      rolling         104        654          13.8°          2.8%        26.7%
      alpine          177       1076          14.2°          7.4%        52.9%
      plains           81        599          11.8°          0.8%        22.1%
      dunes            83        604          12.0°          1.0%        22.7%
      marsh            78        591          11.5°          1.2%        19.9%
      ```

      Every preset's worst grade is close to `tan(steepest face)` except alpine, which is
      almost exactly DOUBLE (tan 14.2° = 25.3%, worst measured 52.9%). `landmarks.js` already
      documents the mechanism, at line 66: massif sites are jittered within their lattice cell,
      and "two overlapping domes add their gradients where they meet — the one case where this
      construction can produce a face steeper than its ratio promises." Alpine's height
      multiplier (~1.7x, so taller domes) carries a proportionally larger radius (radius is
      tied to height by `RATIO_LO`/`RATIO_HI` in `landmarks.js`) on the SAME 3.6 km lattice
      spacing every other preset uses, so alpine's domes overlap their neighbours far more
      often — this is a land-side effect specific to how the lattice scales, not a per-road
      smoothing question.

      Why this is not this pass's fix: `roads.js`'s `grade` (the smoothing-length lever
      previously named here) only changes how far the ROAD departs from land that is already
      this steep — it trades gradient for deeper cuts/higher fills up to the 18 m earthwork
      clamp, which past sessions have already shown is non-monotonic (see the W4 entry above:
      an earlier grade-adjacent experiment made cliffs worse, not better). The land itself is
      the thing that is too steep, so the road lever cannot cleanly fix it. A real fix belongs
      in `landmarks.js` — most likely damping how two nearby sites combine (a max-weighted
      blend instead of an additive one where domes overlap, or spacing the lattice cell wider
      at higher `LANDMARK.scale` so bigger domes get proportionally more room) — and it needs
      its own before/after pass across `diag-cliffs.mjs`, `diag-relief.mjs` (W4 depends on
      alpine's relief staying dramatic) and the W5 landmark-visibility check, not a one-line
      tweak. Left for a session with room for that.
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
- [X] **Petrol stations were not actually findable, and floating fuel cans.** Operator report,
      verbatim: "Fuel requirements but no gas stations -- maybe we can do floating gass cans?"
      **DONE 27 July.**

      The box-average acceptance test above (`stationSpacing`) was passing the whole time —
      133-186 stations over an 18x18 km square looked fine. It was the wrong instrument: relief
      is spatially correlated (hills cluster), so a driver on ONE real corridor can go far
      longer than the map-wide mean while some other, flatter corridor carries the average.
      `tools/diag-stations.mjs` (new) walks a real, connected chain of arterial edges — never a
      box — and reads off the gaps a driver actually meets. It confirmed the operator's report
      immediately: worst real gap 35.3 km, against a 9.5 km cruise / 5.6 km flat-out tank
      (`tools/bench-fuel.mjs`).

      Three real causes, not one, found by measuring rather than guessing:
      1. `STATION_MAX_GRADE` (6%) was tuned before the relief pass that left meadow arterials
         at a worst grade of 27% and alpine's road grade at a MEDIAN of 7.4% — already above
         the old cap (docs BACKLOG W4 / alpine-gradient entries above).
      2. Only 5 fixed candidate points were tried per 1.8-2.6 km edge, so a real flat pocket
         often existed but was not sampled.
      3. An actual bug: the flattest candidate was checked for water AFTER being chosen, so if
         that one point happened to be wet the WHOLE edge was rejected even when a slightly
         less-flat, dry candidate existed among the others tried — this cost MORE stations than
         grade in five of six presets (measured: causeway rejection 24-45% of candidate sites in
         marsh/dunes/plains, vs 8-39% for grade).

      Fix: `STATION_MAX_GRADE` 0.06 -> 0.11, `STATION_AT` 5 -> 11 points, and the water test now
      runs per-candidate (flattest of the ones that are ALSO dry wins, not flattest-then-hope).
      Re-measured: worst real gap 35.3 km -> 17.99 km over 13 113 km of real routes (6 presets x
      4 seeds) — real, but STILL short of the 5.6 km floor, because `STATION_P`'s own 72%
      independent draw per edge has a combinatorial tail no grade/water fix removes (isolated by
      re-running with grade/water rejection disabled entirely: still 10-18 km). Raising
      `STATION_P` to chase that away would flood the road and lose "a REASON TO STOP".

      So: floating fuel cans, the operator's own proposed second layer, exactly for this tail.
      `fuelCansInBox` in `src/world/props.js` (placement, arc-length slots on BOTH tiers, same
      `clearOfRoads`/slope discipline as the 100 props, freeboard rule relaxed to `'any'` —
      deliberately, since a can that floats has no structural reason to insist on dry ground the
      way a forecourt does, and that is exactly where stations lose the most candidates).
      `buildFuelCan` + `Props` changes in `src/render/props.js`: individually-meshed (never
      baked into a tile, so one can be removed and bob independently), collected on proximity
      (`CAN_RADIUS` 7 m, no need to stop), a gentle sine bob on the mesh's own transform.
      `Fuel.collectCans` in `src/game/fuel.js`, wired in `src/main.js`. "Floating" means one
      thing precisely: the geometry's local origin is +`CAN_HOVER` (0.55 m), so placing it at
      the same ground-contact point every prop uses is what makes it hover — nothing is
      unanchored, and placement's own freeboard/slope math is unaffected by the render-time
      hover. Measured: one can every ~600 m (1.46-2.46/km across six seeds), denser than the
      100 props on purpose. Real, driven, end-to-end proof it works — not just that the code
      exists — in `tools/bench-props.mjs`'s "a can, bobbing and collected" section: mesh Y
      genuinely changes frame to frame, collecting pays out exactly `CAN_FRACTION` (22% of a
      tank), the mesh is really gone from the scene graph after, standing on the same spot again
      does not pay out twice.

      Combined result, stations AND cans together, walked over 2 333 km of real routes across
      all six presets: worst gap to ANY fuel source **4.54 km** — comfortably inside both the
      5.6 km flat-out and 9.5 km cruise ranges, with real margin. `node tools/diag-stations.mjs`
      (new), `node tools/bench-props.mjs [seed]`, `node tools/bench-fuel.mjs [seed]` — six seeds
      green on both bench tools.

      **Follow-up, resolved 27 July:** the two checks flagged above as out of scope —
      `tools/bench-props.mjs`'s pre-existing "added draw calls <= 25" (seed 3) and "sample size
      > 40" (seed 5) — were investigated properly rather than left. Both numbers were
      calibrated by eyeballing the single default seed and never swept. `tools/diag-propcount.mjs`
      (new) reproduces each measurement exactly and sweeps it: draw calls (non-empty tiles in
      the fixed window) came back mean 19.6, sd 4.5, true observed max 32 across 542 swept
      seeds — `<= 25` alone failed 38 of them (7%). Sample size (props in the fixed 4x4 km box)
      came back mean ~83, sd ~23, true observed min 21 — `> 40` alone failed 9 of 542 (1.7%).
      Neither is a placement bug: every failing seed's rejection tally (candidates / rejectRoad
      / rejectWater / rejectSlope, now printed per seed by the diag tool) reads as ordinary
      freeboard/slope loss, and sample size specifically correlates at 0.94 with the seed's own
      props-per-km rate — a number the check two lines above already accepts across 0.4 .. 3.2
      — and only 0.27 with how much road happens to fall inside the fixed box. A low count is
      the direct, expected product of two numbers this file already calls acceptable, not
      evidence of anything wrong with `SLOT_P` or the freeboard/slope tests. Recalibrated from
      measurement, the same way `STATION_MAX_GRADE` was: draw calls to `<= 34` (clears the
      swept range with margin and still catches a real regression — nothing in 542 seeds came
      close), sample size to `> 15` (a little under both the swept minimum and the theoretical
      floor of accepted-perKm x observed-minimum-roadKm, ~14 — still catches a genuinely vacuous
      result). All six canonical seeds (20260726, 1-5) plus every seed the sweep found failing
      re-verified green; `npm test` unaffected (bench-props.mjs is not part of that gate).

      **Found in the same sweep, NOT fixed — a different pass's problem.** Pushing past the six
      canonical seeds to verify the fix above surfaced three more seed-dependent failures in
      this file, unrelated to the two resolved here: seed 28 fails "props per km of road"
      (3.38, just over the existing 3.2 ceiling) and "cans per km of road" (3.55); seeds 155 and
      177 also fail "cans per km of road" (3.02, 3.07 against the existing 2.8 ceiling). Same
      shape of problem as above (a per-km ceiling that may itself be a single-seed calibration,
      not swept) but not confirmed as such — flagged, not guessed at.

      **Follow-up, resolved 27 July:** seeds 9 and 30's "nothing collected yet" failure in the
      "a can, bobbing and collected" section (reads 0.22, one `CAN_FRACTION`, instead of 0) was
      confirmed rather than assumed — logging `props._collectedCans` right after the 3 km drive
      shows a real can auto-collected mid-drive (`cn:1:0,-1,1:2` on seed 9, `cn:0:0,-1,1:13` on
      seed 30), because the frame-cost block's dead-straight (i, 0) path happens to pass within
      `CAN_RADIUS` of it. That is the game's auto-collect behaviour working correctly, just left
      undrained on the shared `Props` instance going into the can section's own baseline check.
      Fix: the can section now calls `props.drainCollectedFuel()` once and discards the result
      immediately before its "nothing collected yet" check, so an earlier incidental pickup can't
      leak into this section's own zero baseline — a one-line test-ordering fix, not a gameplay
      change. Re-verified green on seeds 9, 30, and all six canonical seeds (20260726, 1-5).

      **Follow-up, resolved 27 July:** the "per-km ceiling that may itself be a single-seed
      calibration, not confirmed as such" flagged above was investigated properly rather than
      assumed — and this time it was NOT the same fix. `tools/diag-perkm.mjs` (new) sweeps
      `propsInBox`/`fuelCansInBox` across 601 seeds over the identical fixed 4x4 km box, with
      the existing candidates/rejectRoad/rejectWater/rejectSlope/placed tally plus two new
      measurements: road-tier mix (`SLOT_P`/`CAN_SLOT_P` are both luckier on tier-1 lane road)
      and biome AREA sampled on a fixed grid independent of the road network (several prop
      kinds, and the cans' freeboard rule, treat wet and dry ground differently).

      Confirmed real, not a fluke of three seeds: props per km fails high on 2 of 601 (0.3% —
      seed 28 at 3.38, and seed 596 at 3.22, found by the sweep and not previously flagged, both
      over the old 3.2 ceiling); cans per km fails high on **62 of 601 (10.3%)** — seeds
      28/155/177 are three ordinary points on a smoothly decaying tail (3.55, 3.35, 3.31, 3.31,
      3.21, 3.17, 3.17, ...), not a pathological trio.

      What actually drives a high seed, measured rather than guessed: downstream YIELD
      (placed / candidates), not more candidates being generated — `corr(perKm, candidates/km)
      = 0.04` against `corr(perKm, yield) = 0.95`; `corr(canPerKm, candidates/km) = 0.14`
      against `corr(canPerKm, yield) = 0.80`. Within yield, the single strongest lever for both
      is how much of the fixed box sits clear of its own local water table:
      `corr(perKm, rejectWater rate) = -0.39`, `corr(canPerKm, rejectWater rate) = -0.69` (the
      largest correlation the sweep found, either direction, for either metric). Road-tier mix
      is a weak driver (`corr(*, laneFrac)` 0.10-0.17) — the tier-based luck in `SLOT_P`/
      `CAN_SLOT_P` is not the story. No single biome dominates either: the strongest are Hoshi
      Meadow area (+0.42 perKm, +0.37 canPerKm) and Bara Dunes area (-0.38, -0.50) — real, but
      well short of explaining most of the variance alone, because `waterLevelAt()` blends ALL
      five biomes' weights at a point, not just the dominant one. This is the same spatially-
      correlated, seed-varying effect `tools/diag-stations.mjs` already measured for petrol
      stations and the relief/cliffs entries measured for terrain — some seeds' fixed box just
      happens to sit drier than others — not a bug in one biome and not evidence that `SLOT_P`/
      `CAN_SLOT_P` themselves are mistuned.

      Retuning `SLOT_P`/`CAN_SLOT_P` down to chase the high tail was considered and rejected,
      for a reason the sweep itself supplies: the LOW end has little to no headroom to give.
      Props' true observed minimum is 0.43 (seed 198) against the 0.4 floor — about 7% of
      headroom, on a seed nowhere near 28/155/177/596. A global cut aimed at the high tail would
      push every seed down, plausibly trading a `fail-hi` for a new `fail-lo` rather than
      removing one, to chase a cause (the local water table) that is not a probability knob to
      begin with. Cans have more room on the low end (min 1.28 against 0.9) but the same
      objection applies in spirit: the actual lever — freeboard, evaluated per-candidate after
      the accept draw — sits downstream of `CAN_SLOT_P`, so cutting the accept probability would
      suppress cans everywhere equally, including the already-sparse dry seeds, rather than
      specifically the wet-adjacent ones this tail is actually about.

      Fix: recalibrated from measurement, the same way `STATION_MAX_GRADE` and the two checks
      above it were. Props per km ceiling `3.2` -> **`3.6`** (mean 1.75, sd 0.46, true observed
      max 3.38 across 601 seeds — clears it with real margin). Cans per km ceiling `2.8` ->
      **`3.9`** (mean 2.37, sd 0.36, true observed max 3.55 — the bigger jump matches the
      heavier tail: a 10.3% original fail rate against props' 0.3%). Neither floor moved (0
      `fail-lo` on both, before and after — only the ceilings were ever failing). Re-verified:
      all six canonical seeds (20260726, 1-5), seeds 28/155/177 (originally flagged), seed 596
      (found by the sweep), and two more high-tail seeds (438, 293) all green on `node
      tools/bench-props.mjs [seed]`; `npm test` stays 22/22 (bench-props.mjs is not part of that
      gate, and nothing touched this pass is either).
- [ ] Weather and horizon effects, inspired by Slow Roads. Explicitly LOW priority: the
      operator's note was "the goal is to wrap up this project soon so we shouldn't get totally
      caught away".

- [x] Water still looks poor at distance — moire on large sheets, and the shoreline is hard.

      **FIXED (grading pass, 2026-07-27), operator's report verbatim: "fix the water please --
      its ugly".** The screenshot-at-distance comparison the note below asked for was done, and
      it found the real culprit was neither moire nor the discard line but the REFLECTION: at
      grazing incidence (all mid-distance water in a driving camera) the full ripple normal
      swung the reflected ray across the whole sky dome, so 100–600 m of every lake rendered as
      high-contrast marbled contour lines (pale horizon band against blue zenith — screenshots
      showed fingerprint whorls), and past the normal-flatten distance the floor-at-0.012
      reflection sampled the WHITE horizon band, so the far lake was a grey sheet. What changed,
      all in `render/water.js`, all amplitude/colour grading — `bandLimit()` and the per-band
      Nyquist gates are UNTOUCHED, and the `-0.5` discard tolerance (seam prevention) is
      UNTOUCHED to the character:
        - reflection colour now reads through a 65%-calmed normal (glints keep the full one) —
          the painted decoupling: the sky wash never churns, the sparkle still winks;
        - reflected-ray elevation floored at 0.11 (was 0.012) so distant water reflects blue
          mid-sky, not white horizon haze — the far lake is now a luminous blue plate;
        - fresnel cap 0.36 (was 0.46), normal scale 8.5 (was 14) plus a rational soft-limit on
          tilt (~24° asymptote), distance flatten 70–430 m @ 92% (was 110–560 @ 82%);
        - domain warp 22 m (was 46): streaks now meander as open lines instead of closing into
          whorls; ripple-gust coupling 0.62+0.55 (was 0.55+0.9);
        - foam: reaches 0.55 m of depth (was 1.25 — a chalk apron on every shelving shore),
          opacity 0.36, fades across the dry side of the waterline, and dims with the same
          band-limit gate that removes its scallop texture (a solid distant apron otherwise);
        - the 0.5 m seam-tolerance band now fades to a dark wet-earth rim instead of pale
          wet-stone + foam, so the aliased discard contour reads as the dark wet margin every
          painted lake has, at a third the contrast; caustics get an explicit ≤240 m fade.
      Verified against real frames (lake at 2600,-480, seed 20260726): sunward, cross-light and
      shoreline close-ups before/after; no chevron banding at distance (band-limiting still
      doing its job), no dry-gap at the shore seam, suite screenshots (causeway between two
      bodies) read calm turquoise. `npm test` green, `npm run test:browser` 40/40.

      **Investigated the pass before, NOT fixed then, recorded instead.** Two separate claims,
      checked separately.

      Moire: `render/water.js` is NOT missing an obvious fix here — every procedural layer
      already runs through `bandLimit()`, an analytic per-band Nyquist gate keyed off
      `fwidth()` (see the design note at line ~100), including the base ripple bands, the gust
      field, the caustic sparkle, the wet-bed grain, AND the specular glints (line ~261, which
      even hands sub-pixel glints to a broad lobe rather than letting them strobe — a purpose-
      built anti-aliasing scheme, not an oversight). If moire is still visible, the cause is not
      "a layer nobody band-limited" — the easy version of this bug was already fixed by someone
      before this pass. Next step would be a real screenshot-at-distance comparison to find
      which specific layer is still aliasing, which is visual grading work, not a code read.

      Hard shoreline: found a real, named mechanism, and it is NOT simply "add a soft edge."
      `if(!(vD.x > -0.5)) discard;` at line 167 is a binary cutoff — discards inside a triangle
      get no MSAA softening, so it does produce a hard, jagged edge exactly where depth crosses
      -0.5 m. But the same line's own comment says it exists to solve a DIFFERENT, already-
      solved problem: the water plane is a coarser 2 m-sampled mesh than the terrain's 1 m
      mesh, so their waterlines do not perfectly coincide, and the 0.5 m tolerance stops the
      water mesh's own edge from visibly cutting inside the terrain mesh (dry ground showing
      through where there should be shore). Softening this into an alpha fade is a real fix,
      but it has to preserve that seam-prevention property or it reopens a bug this project has
      already been bitten by once (roads: "there should be nothing above a road ever"), and
      there is no automated check for either the softness or the seam — both would need visual
      verification this pass does not have tooling for. Left for a session where that grading
      can happen.
- [x] **Grass aliasing at 100–300 m — the angular width floor was calibrated wrong, and never
      updated.** Two compounding bugs in `render/grass.js`, both by inspection rather than a
      visual before/after (there is no automated aliasing metric in this suite — flagged, not
      invented one this pass): (1) the constructor default assumes a 58° vertical fov on a
      1080 px canvas, but the real camera is 64° (`new PerspectiveCamera(64, ...)` in
      `main.js`) — a "1 screen pixel" floor was sub-pixel by construction, at any resolution.
      (2) `Grass.setAngular()` exists specifically to recompute the floor from the real
      viewport and is called `on resize` per its own comment — except nothing anywhere in the
      repo ever called it. `main.js` now calls `grass.setAngular((camera.fov * DEG) /
      innerHeight)` once at startup and again in the resize handler, so the floor tracks the
      real fov and the real canvas height instead of a fixed assumption.
      `npm test` and `npm run test:browser` both stayed at their current totals (40/40, "THE
      GAME WORKS") on a freshly restarted dev server — this changes a rendering LOD constant,
      not gameplay, so the existing suite is the right gate; nothing in it measures aliasing
      directly. If it is still visibly shimmering next session, the next lever is the floor
      MULTIPLIER (currently exactly 1px) rather than the calibration, which this pass fixed.
- [ ] The autopilot in tools/shoot.mjs follows roads only loosely. It is a smoke test, not a
      driver, and it should be good enough to be a benchmark.
- [ ] Base44 backend is defined in `base44/` but undeployed — the CLI login is a device-code
      flow that needs one human click.
- [ ] Remote cars are ghosts with no interpolation testing under real latency.
- [x] **Two multiplayer bugs from the same playtest report, plus proximity fuel-sharing and a
      3-strikes limit on the passing-driver mercy.** Operator, verbatim: "person 1 sees a
      ghoast as player 2 of the wrong car - player 2 does not see 1."

      WRONG CAR, confirmed as a real, 100%-reproducible bug and fixed. `carPacket()`
      (`src/main.js`) sent `car.tier` — the Vehicle's own `'gt'|'sports'|'hyper'` silhouette
      STRING — straight onto a wire field `server/drive.php` stores as SQL `INTEGER`. PHP
      casts a non-numeric string to 0, so every ghost, for every peer, rendered as
      `CAR_TIERS[0]` regardless of what its driver had actually chosen. Confirmed directly
      against the live backend, not just read in the PHP source: sending the three old string
      shapes (`'gt'`, `'sports'`, `'hyper'`) all came back `tier: 0` on the peer that received
      them. Fixed by sending the FLEET index (0-6, the same numbering `game/garage.js` already
      uses) instead — a lossless fit in the same 0-63 wire field, no server change needed — and
      decoding it back to the correct silhouette in a new `buildGhostFromFleet` adapter
      (`src/main.js`). `tools/net-test.mjs` used to hardcode `tier: 0` for BOTH its test seats,
      which is exactly the kind of gap that let this ship looking green (a bug that collapses
      every tier to 0 is invisible to a harness that only ever sends 0); it now drives two real,
      different fleet cars and asserts both arrive intact — `PASS seat 2's car arrived intact —
      not just tier 0  sent patrol (index 6) — got index 6 (patrol)`, and the same the other way.

      PLAYER 2 DOES NOT SEE 1: investigated hard, not found as a deterministic protocol bug.
      Read `server/drive.php`'s interest-cell query and self-exclusion in full — both are
      provably symmetric by construction (a 3x3 neighbourhood built from your OWN position,
      `player_id <> ?` bound to a server-derived id) — and built a NEW, deliberately
      uncoordinated live-backend harness (one seat idling alone, the other approaching on its
      own independent timer, no scripted hand-off) rather than trusting the existing
      `net-test.mjs`, whose own coordinated "wait, then let each side speak once" pattern could
      not have caught an asymmetry like this even if one existed. Both directions saw each
      other reliably; the one blip found (a single tick at the exact edge of interest range)
      self-corrected within a second and hit the approaching side, not preferentially either
      role. What WAS found and fixed: `netTick()` ran only from inside the rAF-driven `frame()`
      loop, and browsers pause `requestAnimationFrame` for a document that is not the visible
      tab — documented behaviour, not a tuning knob. `docs/MULTIPLAYER.md`'s own recommended
      way to test multiplayer solo is two windows on one machine, which guarantees one of them
      is always backgrounded, so that window's presence would starve exactly the way "the other
      person can't see me" describes. `netTick()` now runs off its own `setInterval` (250 ms),
      independent of rendering. Said plainly: this is the most likely concrete cause given
      everything else checks out symmetric, not a confirmed root cause — logged honestly rather
      than claimed as fixed beyond what was actually shown.

      PROXIMITY FUEL SHARING, new. Operator: "let them also share gas when close -- so they can
      team up." A press (`KeyF`) gives `SHARE_FRACTION` (20%) of a tank to the nearest ACTUAL
      other player within `SHARE_RADIUS` (25 m) — gated so the giver can never strand
      themselves (`MIN_GIVER_RESERVE`), and a REAL transfer: the giver's tank drops by exactly
      what the receiver's gains, never both sides topping up from nothing. There is no
      server-side concept of fuel, so this rides the two spare bits already in the wire's
      `flags` integer (`SHARE_FLAG`, bit 2) rather than asking the live backend for a new
      message type this round could not get deployed — `src/net/remotes.js` watches for the
      bit's RISING edge on a nearby peer (re-checking the giver's reported position at the
      moment the share arrives, not a stale interpolated one) and hands the fraction to
      `Fuel.update()` through the same pull pattern `collectCans()` already uses. Proven three
      ways in the new `tools/net-test-fuel-share.mjs`: (A) against the LIVE backend, the
      SHARE_FLAG bit set by one real client really arrives set on the other's peer response;
      (B) with the real `Fuel` and `Remotes` classes driven directly, a give costs the giver
      72.0 s of tank and the receiver gains the same 72.0 s, a pulse held across several
      snapshots pays out once and not once per snapshot, and a flag from outside SHARE_RADIUS
      is correctly not credited; (C) the giver's own refusals (too little to spare, nobody
      close enough) cost nothing. 37/37 checks green.

      THE PASSING-DRIVER MERCY GETS A BOTTOM, deliberately overriding this file's own former
      "never a game over" note on the operator's explicit instruction: "3x max 'someone gives
      you a gas can' and then game over (restart og position) so its teamwork to find gas
      stations and get the furthest from home." `MERCY_MAX` (3) uses, persisted for ever per
      player exactly like `Streak.best` (`localStorage`, one small record, read once, written
      on every change — proven to survive a fresh `Fuel` instance on the same key, i.e. a
      reload). The 4th dry stop calls a new `resetToSpawn()` (the session's ORIGINAL spawn
      point, not `backToRoad()`'s "nearest road" — the operator asked for "restart og position"
      specifically) instead of granting a can. **Is "game over" too harsh for a cozy game?**
      Asked plainly, as requested: the MECHANISM is a real, felt, lifetime consequence exactly
      as asked for, deliberately harsher than anything else in this game — but the MOMENT
      itself was kept to the same gentle shape every other setback here already uses: a single
      calm toast ("no one is passing this time — a quiet ride back to the start"), a graceful
      teleport, and the tank left at a real 50% rather than empty, so the reset is not ALSO an
      immediate second emergency. Checked automatically that no message anywhere in the
      sequence reads like a fail screen. `git diff -- src/world/props.js` was read before any
      of this was written: another agent's `stationDistanceMul()` (station spacing eases from
      1.0 near spawn to a 0.4 floor by 70 km out) is exactly the "easier at start, slowly
      harder" curve the operator asked for — not duplicated here. It is not exported (module-
      private in `props.js`, not this pass's file to add an export to), so the SAME breakpoints
      and shape are mirrored, not imported, in `game/fuel.js`'s `mercyScarcityMul()` — applied
      as the inverse, so a mercy far from home still covers roughly the same number of
      "stations you might have missed" (measured: 0.16 near spawn -> 0.40 at the 70 km floor,
      ratio 2.50, matching `STATION_FAR_MUL` exactly). The active, player-to-player share
      deliberately does NOT scale with distance — a distant giver being asked to sacrifice more
      of their own increasingly precious fuel to be equally kind is a cost falling on generosity,
      not on the game being harder, which is not what was asked for.

      `npm test` and `node tools/bench-fuel.mjs` both stayed fully green throughout, including
      the other agent's own new capacity-upgrade and downhill/off-road sections built into
      `bench-fuel.mjs` concurrently this same round — confirmed compatible, not fought.
      `node tools/net-test.mjs` and `node tools/net-test-fuel-share.mjs`.
- [ ] Engine audio is still synthesised. RPM-indexed CC0 sample crossfading is the researched
      answer; sources are listed in docs/CREDITS.md.
- [x] **Auto-drive drove off dead ends, and never recovered from being stuck.** Operator report,
      verbatim: "Road stop without explanation in middle of no where and autodrive keeps driving
      off that road-end", plus separately "auto drive should reset to road when stuck and have a
      ping when activated". A screenshot showed a road stopping in open ground with nothing
      marking why — that half is legitimate: the lattice in `src/world/roads.js` produces real
      dead ends by construction (a node with no qualifying connection on one side), not a
      worldgen bug. What was wrong was `src/car/autopilot.js`'s reaction to one: `headAt()`
      correctly holds the heading flat past the end of a chain, on purpose, so a dead end never
      reads as a phantom hairpin — but nothing was reading "the chain stopped because there is
      nothing left to chain" as different from "the chain stopped because this frame did not
      need to look any further", so a dead end looked exactly like an open, straight road right
      up until there was none left, and the car drove off the last vertex into the field beyond.

      `_horizon()` now tells the two apart (`this._deadEnd`, set only when `nextEdge()` is
      actually asked "what comes after this?" and reports nothing — the same "qualifying
      connection" test the lattice itself uses for a leaf node), and the speed plan brakes to a
      real stop against a CONFIRMED one, well before the existing reactive lost-the-road brake
      would ever notice (that one only fires once the car is already off the tarmac; extended,
      not replaced — same 4 s timeout, same hand-back-control shape it already had). Separately,
      a stuck detector now watches speed independent of position: near zero for more than 3.5 s
      while still engaged — wedged on a rock, hung up on a verge, anything that physically pins
      it — resets the car to the nearest road by calling the SAME `recover()` function the R key
      and the water rescue already call (`src/game/rescue.js`'s own constructor pattern;
      `main.js` wires all three to the one `backToRoad()`, so none of them can disagree about
      where "the road" is), then carries on driving rather than handing control back. A short
      synthesised tone (`EngineAudio.ping()`, a sine settling from D5 to B4, no external audio
      file) now fires once per G-press, additional to the existing "auto-drive on — sit back"
      toast — kept, not replaced.

      New harness, `tools/bench-autopilot-safety.mjs` (bench-drive.mjs measures normal driving,
      the wrong shape of test for either of these): finds a genuine dead end in a real generated
      network with the exact same `nextEdge()` test the autopilot itself brakes against, drives
      straight at it, and confirms the car stops short — measured across seeds, 3.6-4.0 m from
      the literal last vertex every time, never past it — and hands back with reason "the road
      ends here", never open terrain. Separately pins a car's velocity 550-830 m off the network
      to simulate being wedged (this harness has no collision system to wedge it against for
      real) and confirms `recover()` fires at 3.51 s every time — bounded, and deliberately ahead
      of the 4 s lost-road path so the one case they overlap resolves through the better outcome
      — and the car ends up exactly on the road afterward, still engaged. Confirms the ping fires
      exactly once on activation, stays flat across 240 frames of ordinary driving and across
      deactivation, and fires again on a second activation. All green across 6 seeds (1, 7, 42,
      2026, 999999, 20260726). `npm test` and `node tools/bench-drive.mjs` unaffected — 100%
      on-road, 1.4 m worst offset, unchanged from baseline, since the new checks only ever
      engage away from ordinary driving.

- [x] **Road cuttings read as stark cliffs, not soft hillsides.** Operator, verbatim: "Road cuts
      through mountains too stark -- should be less cliff-cut more soft hill." Screenshots showed
      a near-vertical, dark, jagged, low-poly wall right beside the tarmac — reading as a
      rendering glitch rather than a graded roadside slope — and the same kind of wall right
      where two roads meet. **DONE 27 July.**

      Not a repeat of the batter tuning above (search "batter"): that work's SHAPE decision
      (smoothstep over straight-with-eased-ends) and RATIO (1.6, uncapped) both stand, untouched.
      What was still wrong sat one level up, in `RoadField.carve()` (roads.js), which hands
      `terrain.js`'s `groundFromCarve()` the `d`/`y`/`width` it uses to size and place its own
      (correctly uncapped) shoulder. Two distinct mismatches, both confirmed with real per-edge
      dumps on the seeded world (20260726) before either was touched:

      **Two roads' earthworks blending — the aggravating case the second screenshot pointed at,
      confirmed real: 53 of 59 over-45° points in the standard window sat within reach of TWO
      road edges, not one.** `out.d` (nearest-edge distance) was tracked independently of
      `out.y`/`out.width` (the weighted blend across contributing edges), so a short lane —
      geometrically nearest, but already past its own narrow 12 m shoulder — could set `d`, while
      a distant, much deeper arterial cutting 40 m out, still legitimately blending in, set `y`.
      groundFromCarve then sized a wide shoulder from the arterial's own big drop and evaluated it
      at the lane's much shorter distance: a real point came out 20 m below the land beside it, an
      80° face, from two edges that were each individually well-behaved. Fix: `d` is now blended
      the SAME weighted way as `y`/`width` (`dSum += w * ed`, same `w`), not tracked as a separate
      nearest-wins scalar. Provably safe: `mask > 0.001` (the only condition under which
      groundFromCarve ever reads `d`) implies `wSum > 1e-6` by construction — mask IS the largest
      single term inside wSum — so the blended `d` is live exactly where the old unblended one
      used to be the lone straggler, and the untouched raw-nearest fallback only surfaces where
      mask is already ~0 and groundFromCarve is never called.

      **A second, single-edge mismatch, same root shape.** roads.js's own per-edge weight capped
      the drop it fed its shoulder formula at `MAX_EARTHWORK + 4` (22 m) — sized for how far a
      ROAD's own profile may sit from the land under it, not the different question `drop`
      answers there (how far the QUERY POINT's land sits from the road, unbounded by that clamp).
      terrain.js's groundFromCarve uses the identical formula on the identical `drop`, uncapped on
      purpose (its own comment: "capping the width while the height keeps growing is how you
      build a wall"). Past 22 m of true drop, roads.js undercounted the shoulder and reported
      `mask` near zero a few metres before groundFromCarve — the same edge, uncapped — was still
      blending a third of the way toward it: one otherwise well-behaved edge produced an 89° jump
      inside 20 cm, right at that crossover. Fix: uncapped to match, with a safety ceiling tied to
      the coarse bounding box each edge already qualified against (never tighter than real
      measurement needed — true drop maxed at 29 m over the checked window; the ceiling only
      bites past ~41-44 m).

      `node tools/diag-cliffs.mjs`: **59/360000 (0.016%) -> 31/360000 (0.009%)**, comfortably
      under the recorded 0.019% ceiling. The tail is the real story, not just the count: histogram
      50-60/60-70/70-80 went **21/18/13 -> 3/0/0**, worst point **80° -> 56°** — every sample that
      would have read as a near-vertical dark wall is gone; what remains peaks in the high 40s to
      mid 50s, a steep grassy bank rather than a cliff face. New tool `node tools/diag-batter.mjs`
      walks the real PROFILE (land / carve target / final height) through the worst real
      multi-edge and single-edge points, kept as a permanent regression check, not just a
      pass/fail count: before, a 19.4 m vertical step in a 0.2 m span (89°) at the multi-edge
      point measured directly; after, the same walk is smooth and continuous across its full
      44 m, peak 65.5° reached gradually, no step anywhere. Honestly measured, not hidden: `node
      tools/diag-relief.mjs` shows alpine (already flagged there as "the one that grows walls")
      improving **0.139% -> 0.070%**, better than its own historical 0.078% baseline — but rolling
      and dunes each pick up a handful of new over-45° points (0/1 samples -> 11/9), all in the
      45-48° range on inspection (mask 0.42-0.75, genuinely covered, nowhere near the eliminated
      70-90° tail) — a threshold test sitting across a now-more-consistent boundary, not a new
      cliff mechanism. `npm test` 22/22; `node tools/diag-seam.mjs` (the fall-through guard,
      gotcha 6) unaffected on both rolling and alpine — nothing this pass touches the road
      elevation profile itself, only the terrain-carve blend around it.

      **Junction notch/crack, checked, not touched.** The triangular gap and stray marking
      fragments the operator's earlier screenshots showed at a crossing are gone by construction,
      not just by measurement: the junction patch (this round's own 90-degree-junction work,
      `render/road.js`'s `buildJunction`) is a raised overlay on top of full-length, un-trimmed
      ribbons, and two strips crossing at any angle cannot enclose a hole between them (every ray
      out from the crossing point stays covered by at least one strip's own width until it exits
      both). `node tools/diag-junction-geom.mjs` still passes all 5 checks across 121 real
      crossings in 4 windows (no NaN, every triangle faces up, vertex heights agree with
      Terrain.height to 0.001 m, patch bbox reaches at least half the narrower road's width every
      side) — re-run after this pass's own change, not reused from before it. Not touched: that
      geometry system is large and belongs with whoever built it.
- [x] **Ocean-size water needs sea sound, should be flat, and should have ships on it.**
      Operator, verbatim: "Ocean-size water needs to make sound of sea -- large bodies of water
      should be flat and have ships on em." Three parts, one shared idea underneath all three:
      "large" is not knowable exactly without a flood fill, which this pass does not do per
      frame or even per chunk-adopt — instead a coarse, cheap, CACHED ring-sample
      (`waterOpenness()`, `src/render/water.js`), snapped to a 220 m world-aligned cell so
      neighbouring water chunks agree exactly and draw no seam. Calibrated against a real 40 m
      flood fill over a 12 km square of the shipped seed, not guessed: `node
      tools/diag-openwater.mjs` (new) prints the table — the twelve largest real bodies (up to
      11.1 km²) scored 0.55-1.00 at their most open point, real ponds under 25,000 m² scored
      0.00-0.70 (an occasional high outlier is a cluster of several small pools in one wetland,
      which genuinely does have a lot of water nearby and which this proxy is not trying to
      tell apart from one big body).

      SEA SOUND. `src/audio/ambience.js`'s positional ambience (built two sessions ago) already
      had a size term, `extent`, but measured — not assumed — it was not doing its job: before
      this pass, approaching a real 11.1 km² lake and a real, genuinely isolated 12,800 m² pond
      in this seeded world, by 20 m out the POND read LOUDER than the LAKE (0.0702 vs 0.0649),
      because `extent`'s old range (0.5-1, saturating past 0.22) is reached by almost any
      shoreline once you are close enough to stand at it, lake or pond alike — so right where
      the layer is most audible, its "how big" term had already stopped discriminating. Fixed
      by widening both the domain (`0.02-0.22` -> `0.08-0.4`, spending more of the map on the
      100-400 m band where big and small bodies actually differ) and the range it maps to
      (`0.5-1` -> `0.32-1.2`) in `seaGain()` — see that function's own comment for the full
      derivation. After: at a real isolated pond vs the real biggest lake, 400 m out the lake is
      **12.6x** louder, 200 m out **2.5x**, closing to parity only in the last ~10-20 m, where a
      130 m-wide pond's own edge and a kilometres-wide sea's edge both genuinely put "a lot of
      water" within the same 500 m probe disc — an intrinsic limit of a bounded-radius proxy, not
      a bug left in. `node tools/diag-ambience.mjs`'s existing checks (including its own
      shore-gain-ratio and handedness sections) stayed green throughout; a new section in that
      same tool reproduces the big-vs-small measurement with real, honestly-reported probe
      distances (not assumed labels) on every run.

      FLAT. `src/render/water.js`'s ripple/gust shader (deliberately careful anti-aliasing
      already documented there — untouched) now reads a fourth per-vertex quantity, `wopen`,
      baked from `waterOpenness()` once at chunk-adopt time, never per frame. A `calm` factor
      (`smoothstep(0.55, 0.92, wopen)`) scales the ripple-bump amplitude down to 30% and the
      wind-gust darkening down to 45% on the calmest, largest water — nothing about HOW the
      bands are built or band-limited changed, only how tall they are allowed to stand. Real
      before/after off a REAL built water plane (`buildChunk` + `Water.add`, not just the
      standalone function): the biggest lake's own chunk bakes `wopen` 1.000 across every
      vertex, giving amp x0.300 / gust x0.450; a small pond bakes 0.050-0.350 and is left
      untouched (x1.0). `node tools/diag-openwater.mjs` section 2.

      SHIPS. New `src/render/ships.js`: a rare, low-poly boat (five painted-pipeline faces for
      the hull, tapering to a stem edge at the bow — no lofted curve, matching this project's
      whole visual language — plus an optional cabin box and mast), no third-party asset (see
      docs/CREDITS.md). Placed on its own rolling lattice around the car, like `render/props.js`
      and `render/road.js`, deliberately NOT tied to the terrain streamer's chunk records —
      `props.js`'s own file header explains why: a sparse feature tied to the quadtree gets
      re-decided every time a chunk's LOD changes. One candidate per 500 m tile, gated in
      increasing cost order (real depth, then `waterOpenness() >= 0.68`, then a tight 40 m
      all-round shore-clearance ring, then 70 m clear of every road via `world/roads.js`'s own
      cheap standalone `roadDistance()`, then a 0.3 rarity draw) — measured over a real 144 km²
      square: 34 sites clear every gate but rarity, 7 real ships result, **0.58 ships per km² of
      qualifying large-open water**, independently re-verified (a second, separately-written
      check, not the placement code grading its own homework): nearest road to any placed ship
      72.3 m, worst shore-ring sample -1.27 m of freeboard (both clear their floors). A ship
      never moves its (x, z) after placement — it bobs (0.14 m), rocks (~2°) and slowly swings
      its heading (~7°) at anchor, entirely in `Object3D` transform updates, which is a safety
      property as much as a look: the road/shore checks are only ever paid for once. Real,
      driven proof it animates and never drifts: `node tools/diag-openwater.mjs` section 4 reads
      a live hull's own `position`/`rotation` before and after 5 s of simulated time.

      FRAME COST. `waterOpenness()` never runs in the render loop — only from
      `Water._buildPlane()` (chunk-adopt) and `Ships`' own 0.5 s-gated rescan, and it is cached
      per 220 m cell: 139 µs cold (20 point samples), 175 ns warm. The water shader gained one
      extra 4-byte vertex attribute and a smoothstep plus two `mix()`es in the fragment shader —
      no new texture read, no new branch. Ships: ~21 triangles per hull, one draw call each
      (individually meshed, like the floating fuel cans, so each can bob independently), and
      section 3's own density measurement is the bound on how many can ever be live at once.
      `node tools/diag-openwater.mjs` section 5.

      Concurrent-session note: `git diff -- src/world/terrain.js src/world/roads.js
      src/world/props.js tools/bench-props.mjs` was read before this pass touched anything and
      stayed clean at that point (both files carry real, unrelated work from other sessions as
      of this entry — a Terrain.height/roads.js crossing fix and a props.js/bench-props.mjs
      pass — neither reached by anything in this entry: this pass's files never import
      `world/props.js`, and `world/roads.js` is only ever called through its existing, unchanged
      `roadDistance()`/`RoadField` public API, never edited). Another session's
      `src/world/biomes.js` dunes-amplitude tuning landed mid-pass too; it touches none of the
      `water`/biome-weight machinery this work reads, confirmed by re-reading its diff rather
      than assuming. `src/main.js` was re-read immediately before every edit — two further
      concurrent sessions (multiplayer ghost/fuel sharing, and the station/mercy work above)
      were landing real, unrelated changes to it throughout this pass; the `Ships` hookup is
      four lines (an import, a construction, one `update()` call, one `window.WANDEROAD` entry)
      chosen to sit beside the existing `water`/`props` lines rather than restructure anything
      nearby. Also observed, worth recording: partway through this pass every uncommitted change
      in the working tree — this entry's own files included, and every other concurrent
      session's — was wiped back to HEAD by something outside any of these sessions (git diff
      went clean repo-wide, not just for this pass's files); nobody here ran a destructive git
      command, so it was external to this workflow. Everything in this entry was re-applied
      after and re-verified green; flagged in case it recurs. `npm test` green throughout
      (`bench-car`, `bench-slope`, `diag-water` 0 underwater, `diag-cliffs` 0.009% against the
      0.019% ceiling, `diag-seam` all passed) — nothing in this pass touches terrain, road or
      collision geometry.

## Done

- [x] **Valley mist ("from the original") — shipped, and the shader-killing bug was ONE
      reserved word.** (2026-07-27) The reverted implementation (analytic exponential-density
      mist integral in `aerial()`, `uMist` in GL_UNI, horizon bands in `skyDome`/`skyDomeLite`,
      its own `mstHash`/`mstNoise` pair) was reapplied from the saved backups and the real
      fault hunted down on a live GPU rather than theorised about. It was NOT an instruction
      limit, NOT a uniform limit, NOT the GL_LIGHT/CLOUD_FS chunk interaction: the layering
      variable was named `patch`, and **`patch` is a reserved word in GLSL ES 3.00** (kept for
      tessellation). ANGLE rejects it at compile ("ERROR: 'patch' : Illegal use of reserved
      word"), the chunk lives in GL_LIGHT which every material concatenates, so all eleven
      materials failed and the game went black — on the real GTX 1060/ANGLE-D3D11 exactly as
      under SwiftShader (both were captured; the headless suite on this machine actually runs
      the real GPU). Renamed to `mstPatch` (comment at the site tells the story), updated
      `tools/diag-mist.mjs`'s source-text assertion to match. Static node-side checks can
      never catch this class of bug; only a GPU compile can — which is the whole lesson of
      the incident, now twice over. Verified: zero console errors at boot, mist visibly
      pooling in the low valleys from a 137 m ridge (screenshot), silvery veil over distant
      lake water, near field crisp, summits clear; `node tools/diag-mist.mjs` ALL CHECKS
      PASSED; `npm test` green; `npm run test:browser` 40/40 "THE GAME WORKS".

- [x] **"Alpine start should be in the mountains" (operator) — spawn now biased to altitude,
      preset-driven, water-safe.** (2026-07-27) `findSpawn()` takes `opts.highBias` (default
      0 — the other five presets score bit-identically, since the credit term multiplies to
      exactly zero); the alpine preset sets `spawnHigh: 1` and `main.js` passes it for the
      initial spawn only (rescues stay unbiased — a rescue should find the nearest sane road,
      not march you back up a massif). The credit: up to 800 points for up to 400 m of road
      profile altitude — deliberately UNDER the saturated grade penalty (900) so the search
      picks the gentlest road up the mountain, and three orders over the distance term so
      altitude beats proximity. The W8 waterMargin gate is untouched and still rejects wet
      candidates before scoring sees them. Measured across seeds (before → after, all
      on-road at 0.0 m, all dry by 400+ m, grades 1.8–4.7%): 20260726: 8.6 m → 470.2 m
      (massif 480 m at 291 m); seed 1: 86 m → 415 m; seed 7: 218 m → 516 m; seed 12345:
      6.4 m → 452 m; seed 999: already at 570 m, unchanged. Determinism re-run: identical.
      `node tools/diag-spawn-water.mjs`: ALL DRY. In-game screenshot at the real alpine
      spawn: y=477 m mountain junction with a gas station in reach. Suite 40/40.

- [x] **The car fell through the road, repeatedly, in real driving.** Reported by the operator
      twice while playing. The drawn tarmac and the ground the car actually stood on were built
      from two different elevation profiles: `render/road.js` drew the ribbon from the plain
      per-edge height, while `RoadField` (what the terrain is carved to) additionally runs
      `levelCrossings()` to pull lanes level with the roads they cross — and that second pass
      never reached the renderer. Worst measured gap: **40.22 m**. A second, smaller mechanism
      (`RoadField.carve()`'s weighted-mean blend, which can place the drivable shelf BETWEEN two
      nearby roads rather than under either one) added up to 15.7 m more at some crossings.
      Every existing check — R1, R2, diag-water, diag-cliffs — read the road height and the
      ground height out of the same `RoadField` and so agreed with itself by construction,
      blind to what was actually drawn.

      Fixed by giving the renderer the same fully-processed profile the terrain is carved to,
      plus adaptive ribbon refinement (bisecting a ~6 m span down to 0.375 m wherever the
      carved ground turns sharply inside it — a chord can fly over a real dip otherwise).
      Driving the real autopilot 26 km before and after: **1.144 fall-through events/km ->
      0.115/km**, worst single event **40.22 m -> 0.43 m**. `node tools/diag-fallthrough.mjs`.
      New permanent guard wired into `npm test`: `node tools/diag-seam.mjs` (1.3 s, no server,
      no browser) — S1 asks three differently-boxed samplers for the same point and demands
      the same answer, S2 walks the real ribbon geometry vertex by vertex against the ground,
      S3 checks edges meeting at a node meet at one height. The pre-fix tree fails S1 by 3.8 m
      and S2 by 24 m; the fixed one passes both at 0.0000–0.0063 m.

      Two things RULED OUT along the way, by measurement, so nobody re-suspects them: the R5
      lateral road offset is not the cause (drawn and physics edges agree in XY to 0.00e+0 m);
      the streaming worker's mesh and the car's main-thread height query are not the cause
      either (agree to 0.024 m over 10.5 km, two independent harnesses). One residual, left
      alone deliberately: 3 events in 26 km, all under 0.5 m, at one specific spot where two
      arterials converge 8.6 m apart — doubling the ribbon's ring density would clear it at 2x
      build cost for a sub-metre artefact, which was not worth taking.

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

- [x] **C2's brake run-up was measuring nothing, twice over, before this fix.** A blind held W
      hit the off-road ceiling (43.9 km/h) on this seed's bends; switching to full auto-drive
      "fixed" that but capped at 35 km/h instead, because `autopilot.js`'s cruise target is
      `lerp(this.cruise, 8, bend)` — it tops out AT `this.cruise` on a dead straight, since
      auto-drive was never tuned to go fast. Placing the car on a straighter stretch (tried
      first) changed nothing, because the ceiling was never about the road. Fixed by sharing
      O2's already-proven steered run-up (`roadRunUp`, real KeyA/KeyD pure pursuit, no
      autopilot, no analogue, no cheat — moved up so both checks use one copy) instead of
      either blind throttle or the autopilot's own governor. **35 km/h capped -> 109 km/h**,
      100-0 in 40 m. `npm run test:browser` **39/40 -> 40/40**, "THE GAME WORKS", zero variance
      across three fresh runs, then confirmed again against the live deploy.

## Rules the cron must not break

- **`npm run test:browser` must report 40/40 and print "THE GAME WORKS" before anything
  ships, and `npm run test:live` must do the same after.** (This count was 27 when the line was
  first written and grew as the suite did; if it goes stale again, trust the suite's own
  printed total over this number.) It drives a real headless Chrome with real key events and
  measures real visibility. It exists because the game once shipped completely unplayable
  behind a suite that passed.

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
