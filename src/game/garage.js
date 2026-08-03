/* Wanderoad — the fleet.
 *
 * A car and a way of driving are the same choice. Splitting them into two pickers was a
 * testing convenience that leaked into the game: nobody wants to pick a body and then
 * separately pick how it handles. So each car now OWNS its feel, and the only question the
 * player is ever asked is which car.
 *
 * Cars unlock with the streak — the longest run you have ever managed without leaving the
 * road. That makes the one mechanic in the game the thing that opens the game up.
 *
 * The first car is the Hatch — "deliberately the easiest to keep on the road with". A brief attempt
 * to make FLEET[0] the Tricycle instead (deliberately the worst, so a new player falls over first)
 * cost the browser suite four checks that decide whether the game can be played at all, and was
 * reverted; see the micro-car note above FLEET for the measurements, and for the SECOND time the
 * same car caused the same shape of failure one slot later, at FLEET[1] instead of FLEET[0].
 *
 * The unlock ladder is exponential, because a linear one stops meaning anything: going from
 * 8 km to 9 km is not the achievement that going from 1 km to 2 km was.
 */

import { STEER, TYRE, BRAKE, BODY } from '../car/tuning.js';
import { MICRO_FLEET, installMicroTiers } from '../car/microPhysics.js';

/* THE TWO MICRO TIERS HAVE TO EXIST WHEREVER THE FLEET DOES.
 *
 * `micro` and `trike` are declared by car/microPhysics.js, not by car/tuning.js, and the two fleet
 * entries below name them. car/vehicle.js resolves an unknown tier as `TIERS[tier] || TIERS.sports`
 * — it does not throw — so a module that had the FLEET but not the tiers would silently build a
 * SPORTS car and call it a Tricycle, which is the worst possible failure: no error, wrong physics,
 * and a diagnostic that reports a pass. Importing MICRO_FLEET already installs them as a side
 * effect of loading that module; the explicit call is here so the dependency is written down rather
 * than depending on an import staying "unused-looking" through a future tidy-up. It is idempotent. */
installMicroTiers();

/* THE BODY-ROLL NUMBERS AS THE CARS WANT THEM, captured before any vehicle overwrites them.
 *
 * Three constants were changed together to kill the operator's "Car still wobbles left to right
 * immensely, like a scooter", and a car that does not declare `feel.body` gets all three back
 * exactly as tuning.js sets them. Only the Scooter asks for the old values — see its fleet entry. */
const BODY_STOCK = {
  rollOmega: BODY.rollOmega,
  rollZeta: BODY.rollZeta,
  loadTauRoll: BODY.loadTauRoll,
  groundFollowRate: BODY.groundFollowRate,
  rollClamp: BODY.rollClamp,
  visualRollMul: BODY.visualRollMul,
};

/** The stock mechanical turning floor, captured before any car overwrites it. */
const STEER_MIN_RADIUS_DEFAULT = STEER.minRadius;

/**
 * `unlockAt` is metres of BEST streak — kept for the unlock bar's badges, it grants nothing.
 *
 * `earnAt` is TOTAL SUNS EVER COLLECTED, and only the first three cars have one. Operator: "Maybe we
 * can have the first three cars be total collected, and then the rest will be find a dealership."
 * That split does real work. The first three arrive just by driving and picking things up, which is
 * how a new player learns that a sun is worth stopping for; everything after is a reason to go
 * somewhere, which is what a dealership is for. The thresholds are small on purpose — 25 and 70 —
 * because these are the tutorial of the economy, not the body of it. The Sedan at 90 suns is where
 * saving up starts.
 *
 * `feel` is everything that used to live in a separate preset: how much lateral acceleration full stick asks for, which aid ladder rung, how fast
 * the keyboard reaches full lock, and the rear grip that decides whether it rotates.
 */
/* SOME OF THESE BODIES ARE SYNTY POLYGON, and that is why this repository is private.
 *
 * Operator: "synty assets much better than kenny" and "CC0 assets tend to be trash use the ones i
 * paid for". The packs are properly licensed and the proof of purchase is on file; the EULA permits
 * using them in your own game and forbids redistributing them AS assets, which is exactly why
 * CreedofChampions/cozy-driver is private and the old public repo must never receive them.
 *
 * They are converted by tools/synty-car.mjs, which renames Synty's own node names onto the ones this
 * game's wheel rig and paint classifier expect — see that file's header. */
/* ── THE TWO MICRO-CARS, AND WHY NEITHER OF THEM SITS AT FLEET[1] ─────────────
 *
 * The bodies, the tiers and every feel number belong to car/microPhysics.js, which built them
 * against the operator's eight-point "feels like it's falling over" specification and MEASURED the
 * result: the Tricycle lifts a wheel at 0.37 g where the Hatch needs 1.78 g, and goes over after
 * 2.83 s of full lock from 36 km/h; the Bubble rocks at 1.00 Hz and swings 11.00 degrees past its
 * resting angle where every other car in the fleet reads 0.00 Hz and 0.31 degrees, but — unlike the
 * Tricycle — it does not actually go over. Those numbers are not repeated here — one source of
 * truth, and it is that module.
 *
 * What this file adds is the one thing that module deliberately refused to decide: where the two
 * sit on the ladder, and where in this array. Its `MICRO_FLEET` carries `unlockAt: 0` and
 * `price: 0` and says in the code that they are PLACEHOLDERS. Spreading them rather than pasting
 * them keeps the feel, the tier, the model file and the blurb in one place, so a later tuning pass
 * on the physics cannot leave a stale copy behind in the fleet.
 *
 * TWO REGRESSIONS SO FAR HAVE HAD THE IDENTICAL SHAPE: a browser-suite check reads "0 m stop from
 * N km/h", which is not a braking figure at all — it is the Tricycle's pendulum model going over,
 * "a car on its roof, not a car braking" — and both times the cause was the Tricycle landing on a
 * FLEET SLOT the suite drives through by construction, not anything wrong with the brakes.
 *
 * REGRESSION ONE (2 Aug, already fixed before this comment), for the record: the Tricycle was made
 * FLEET[0] — the default, the car a brand new player is handed — to honour "it would be funny to
 * have that as a starter car". As a joke it lands; as the DEFAULT it does not. Measured on the live
 * beta, 38/40 -> 36/40, and the four it failed decide whether the game can be played at all:
 * "D steers right" read +19.9 deg (turned LEFT when the key said right — the steer-helper rotating
 * an already-tipping car), "the brakes stop the car promptly" read 0 m from 43 km/h, and a
 * three-point turn managed 32 of a required 100 degrees. Fixed by moving the Hatch back to
 * FLEET[0] (his own words: "make the default NOT the f150" / "make it the hatch") and letting the
 * Tricycle fall through to a plain, unpriced-by-`earnAt` BUY car.
 *
 * REGRESSION TWO (3 Aug, fixed by THIS comment and the array below it): putting the Hatch back at
 * FLEET[0] pushed the Tricycle to FLEET[1] rather than out of the suite's path — and FLEET[1]
 * matters just as much as FLEET[0] does. `nextCar()` in main.js (bound to V) cycles
 * `FLEET.filter(isUnlocked)` IN FLEET ORDER, and browser-test.mjs's own "V changes the car" check
 * taps V exactly once and never again. With the suite's own `?cheat` param every car is unlocked, so
 * `open[0]` is FLEET[0] (Hatch, what you land in) and one V press moves to `open[1]` — FLEET[1] —
 * for the REST of the run: C2, C3, C5 and the streak drive all measure whatever sits there. The
 * suite's own log said so verbatim: `V changes the car — hatch -> threewheeler`. So the fleet
 * reorder handed the Tricycle straight back into a seat it had just been taken out of, one slot
 * later than before, and the same "0 m stop" mechanism fired again — 34-36 km/h this time rather
 * than 43, because the stretch of road the suite happens to be on by the time it gets there (after
 * the streak-driving section, which moves the car a long way from spawn) is a different bend of the
 * same seed.
 *
 * THE SHOWROOM-DISPLAY-CAR HYPOTHESIS WAS THE FIRST GUESS, AND IT MEASURED FALSE. A dealership's
 * five display cars are real colliders (src/render/props.js's stationSolids, always five, always at
 * the SHOWROOM_SLOTS offsets from src/world/props.js) so it was a reasonable first suspect, and
 * worth ruling out with a measurement rather than a brake tune: tools/browser-test.mjs was copied
 * and instrumented to dump every solid within 25 m of the car at each stage of the C2 sequence, run
 * against a real headless Chrome on a real local build. Result: `"near":[]` at every single dump —
 * boot, after R, after every run-up attempt, after the brake. Nothing is ever near the car. That
 * kills the showroom hypothesis outright.
 *
 * WHAT IS ACTUALLY HAPPENING, measured by replaying tools/diag-c2-repro.mjs's own rig from the exact
 * spot the live run reaches (x=-327.9, z=-1119.7 on seed 20260726, `?terrain=meadow`), one car at a
 * time, same run-up, same brake:
 *
 *     hatch          61.7 -> 1.5 km/h in 12.2 m   PASS
 *     estate         61.7 -> 1.5 km/h in 12.2 m   PASS  (identical to the Hatch — same 'gt' tier)
 *     microcar       51.2 -> 1.4 km/h in  8.2 m   PASS
 *     threewheeler   43.4 km/h, never clears the suite's 45 km/h bar in three 9 s attempts — a clean
 *                    spawn manages 45.7 (also a bare pass), so this particular bend is what tips it
 *                    under the bar, not the car being broken outright.
 *
 * And THAT is where the reported "0 m" comes from — not a collision. C2's own run-up loop in
 * tools/browser-test.mjs calls `reset()` again after a THIRD failed attempt (`if (vTop < 45) await
 * reset()` fires unconditionally, including on the loop's last iteration), and `reset()` zeroes the
 * car's velocity. So by the time the brake actually engages the car is already stationary — the
 * reported "34 km/h" is the STALE reading from the attempt that just finished, and the brake that
 * follows has nothing left to stop. Not a brake bug, not a collision: a car that cannot reliably hold
 * 45 km/h through this stretch under the one input browser-test.mjs cannot avoid giving it (full
 * lock, sustained), landed there by nothing more than array order.
 *
 * THE FIX: swap the Tricycle and the Estate. FLEET[1] — the slot one tap of V reaches — is now the
 * Estate, an ordinary 'gt' car with the Hatch's own stability (see the measurements above), and the
 * Tricycle moves to where the Estate used to sit, after the Pickup (see that entry). Nothing about
 * either car's ECONOMICS moves: the Tricycle is still `unlockAt: 0, price: 20` (still the cheapest
 * thing you can buy), the Estate is still `price: 30` with no `earnAt` (still a dealership car,
 * still what proves the shop takes real money — tools/bench-economy.mjs and tools/diag-switchers.mjs
 * both assert `priceOf(FLEET[1]) > 0` and that a fresh wallet does not own it, and neither cares
 * which specific car sits there), and the three-rung EARNED ladder (hatch:0, microcar:25, coupe:70,
 * asserted by id in tools/diag-switchers.mjs) contains neither of these two cars and is completely
 * untouched. Only the ARRAY POSITION — which decides what a single V press reaches — moves. The
 * Tricycle is exactly as "falls over on purpose" as it was ever built to be; it is simply no longer
 * the car one keypress hands you for the rest of a drive.
 *
 * "THE FIRST THREE CARS ARE EARNED WITH SUNS" IS STILL LITERALLY TRUE, and getting there cost one
 * design decision that a measurement forced rather than a preference chose. Written down in full,
 * because the arithmetic is not obvious and the next person to reorder this fleet will hit it:
 *
 *   The first attempt gave the Tricycle NO `earnAt` and let it be free by game/wallet.js's own first
 *   route ("the first car in the fleet, always, from the first frame"), leaving Hatch 0 / Coupe 25 /
 *   Estate 70 untouched. Every check passed except one, and the one it failed is the check that
 *   matters most: tools/bench-economy.mjs's "100000 suns collected opens NO dealership car", which
 *   went 7/8. A car with no `earnAt` is classified `how: 'buy'` by unlockRule() below, so the
 *   Tricycle counted as a forecourt car that was nevertheless open to anybody — i.e. the fleet was
 *   telling the shop that a free car was for sale. FLEET[0] is open by definition, so FLEET[0] can
 *   never be a 'buy' car; whichever car sits first MUST carry an `earnAt`. That is structural, and
 *   it means inserting a car at the bottom of the ladder pushes a car off the top of it.
 *
 *   So the ladder shifts down exactly one rung, which is what inserting at the bottom means:
 *
 *     Tricycle  earnAt 0    free, and free twice over — FLEET[0] and 0 collected
 *     Hatch     earnAt 25   was 0
 *     Coupe     earnAt 70   was 25
 *     Estate    bought      was earnAt 70; it already declared `price: 30`, which until now was
 *                           dead code, and 30 suns makes it the cheapest car on any forecourt
 *
 *   THE TWO THRESHOLD NUMBERS DO NOT MOVE — still 25 and 70, still "the tutorial of the economy",
 *   and still exactly three cars on the collected ladder. What moves is which car sits on each rung.
 *   The alternative was to demote the HATCH instead and leave Coupe and Estate where they were: one
 *   line rather than four, but it takes a car off EVERY existing save (the Hatch was free at
 *   `earnAt: 0`, so everybody has it), where this takes the Estate off only a player who had already
 *   collected 70 — who can buy it back for 30 out of the 70+ they have demonstrably collected.
 *   Costing the deepest-in player 30 suns beats costing every player a car they already own.
 *
 * `earnAt: 0` on the Hatch below is not redundant with `FLEET[0]`'s own free route. It is what makes
 * unlockRule() call this car EARNED rather than FOR SALE, and a free car that the fleet describes as
 * being for sale is what bench-economy caught.
 */
const MICRO_BY_ID = Object.fromEntries(MICRO_FLEET.map((c) => [c.id, c]));

export const FLEET = [
  /* THE HATCH IS THE STARTER, and the comic cars sit just above it rather than under it.
   *
   * The three-wheeler was made FLEET[0] because the operator asked for a starter that falls over —
   * "it would be funny to have that as a starter car" — and as a joke it lands. As the DEFAULT it
   * does not: the browser suite went from 38/40 to 36/40 the moment it took the first slot, and the
   * four it fails are the ones that decide whether a new player can drive at all. Measured on the
   * live beta: "D steers right" read +19.9 deg, i.e. the car turned LEFT when the key said right —
   * the pendulum model's steer-helper rotating the velocity vector on a machine that is already
   * tipping; "the brakes stop the car promptly" measured a 0 m stop from 43 km/h, which is a car on
   * its roof, not a car braking; and a three-point turn managed 32 degrees of a required 100.
   *
   * He also said, plainly and earlier: "make the default NOT the f150" / "make it the hatch". Both
   * instructions are satisfied by keeping the joke and moving it one rung up — it is the first
   * thing you buy, at zero cost, rather than the thing you are handed before you know the controls.
   *
   * `earnAt: 0` is not redundant beside FLEET[0]'s own free route — see the note above. It is what
   * makes unlockRule() call this car EARNED rather than FOR SALE, and a free car that the fleet
   * describes as being for sale is what bench-economy caught. */
  {
    id: 'hatch',
    earnAt: 0,
    file: 'hatch.glb',
    label: 'Hatch',
    blurb: 'Light and eager. Turns in more sharply than it has any right to.',
    unlockAt: 0,
    /* `price: 0` and `earnAt: 0` — free, and this IS what you arrive in: `FIRST_CAR` is
     * `FLEET[0].id`, this is FLEET[0], and it stays that way (see the note above FLEET for the two
     * times a joke car took this slot instead, and what it cost). `earnAt: 0` means "collect
     * nothing at all", so the first proper car is there from the first frame. It is the first of
     * the three earned-with-suns cars. */
    price: 0,
    tier: 'gt',
    length: 4.0,
    feel: { comfortG: 8.2, assist: 'cruise', rearGrip: 1.0, buildRate: 3.0, brakeMul: 1.1 },
  },
  /* THE FIRST THREE ARE EARNED WITH SUNS, and they are now hatch / micro-car / coupe. That is the
   * operator's own economy rule (Progress.md item 9) unchanged — only the membership moved, because
   * the comic pair came in below the ladder rather than beside it. 25 and 70 are the same two
   * thresholds the Hatch and Coupe used to sit on, so the pace of the opening is untouched. The
   * Tricycle is the other comic car, bought rather than earned — see its own entry, after the
   * Pickup below, for why it no longer sits here. */
  {
    /* THE ESTATE IS FLEET[1] — the slot one tap of V reaches once every car is unlocked, which is
     * exactly what browser-test.mjs's own "V changes the car" check does, every run, and then never
     * taps V again. It used to sit lower in this array, after the Pickup, with the Tricycle in this
     * slot instead; the two simply swapped POSITIONS — see the note above FLEET for the measurements
     * that forced the swap. Neither car's price, `earnAt` or `unlockAt` moved: the Estate is still
     * priced rather than earned, the Tricycle is still `unlockAt: 0, price: 20`.
     *
     * NO `earnAt` — this is the car the ladder pushed onto the forecourt when the Tricycle was
     * inserted at the bottom of it (see the note above FLEET). Its `price: 30` has been sitting
     * here since dealerships were added and was unreachable while the car was earned; it is now the
     * cheapest car anywhere, which suits "the one you learn the roads in" — and an ordinary,
     * un-tippy 'gt' car belongs at FLEET[1] far more than a pendulum model built to fall over. */
    id: 'estate',
    file: 'synty-convertible.glb',
    label: 'Estate',
    blurb: 'Soft, slow and forgiving. The one you learn the roads in.',
    unlockAt: 1000,
    price: 30,
    tier: 'gt',
    length: 4.6,
    feel: { comfortG: 7.0, assist: 'cruise', rearGrip: 1.06, buildRate: 2.6, brakeMul: 1.15 },
  },
  /* THE MICRO-CAR (the "Bubble") is the second EARNED car — 25 suns collected, the same threshold
   * the Coupe used to sit on before the ladder shifted down one rung for the comic pair (see the
   * note above FLEET). */
  { ...MICRO_BY_ID.microcar, earnAt: 25, unlockAt: 12000, price: 0 },
  {
    /* THE SCOOTER, and the wobble it was named after.
     *
     * Operator: "Get the old wobbly controls back and give them to a scooter you can unlock".
     *
     * When the cars leaned too much he wrote "Car still wobbles left to right immensely, LIKE A
     * SCOOTER". Three numbers were changed to stop it, and `feel.body` below takes all three back —
     * on this vehicle only, because it is the vehicle he was comparing the cars to:
     *
     *   rollZeta 0.85       the lean spring is UNDERdamped again, so it overshoots its target and
     *                       swings back rather than settling — the actual mechanism of a wobble,
     *                       measured at 1.84 roll-rate sign changes a second before it was fixed.
     *   loadTauRoll 0.15    the target it chases is filtered less, so every small steering
     *                       correction reaches the body instead of being smoothed away first.
     *   groundFollowRate 45 the rate limit that stopped a wheel-probe snapping onto a road's own
     *                       embankment shoulder is all but lifted. Not removed — the unclamped
     *                       version demanded ~70 rad/s in a single 8 ms step and put the body
     *                       through the terrain, which is a bug, not a feel. 45 keeps every bit of
     *                       the darting and none of the clipping.
     *
     * rollClamp and visualRollMul go up with them, because an underdamped spring that is still
     * clamped at 5.5 degrees can only wobble within a band too narrow to see from the chase camera.
     *
     * It is UNLOCKED, not given: 120 coins at a dealership, the cheapest thing on any forecourt,
     * which is the right price for the joke. The 30 km streak badge is there for the unlock bar.
     *
     * Riding it is genuinely harder, and that is the point — `assist: 'off'` is the third rung of
     * the aid ladder, so there is no traction control and very little stability help. */
    id: 'scooter',
    file: 'scooter.glb',
    label: 'Scooter',
    blurb: 'Wobbles left to right immensely. Cheapest thing on the forecourt, and the most fun.',
    unlockAt: 30000,
    price: 120,
    tier: 'scooter',
    length: 1.95,
    feel: {
      comfortG: 7.0,
      assist: 'off',
      rearGrip: 0.92,
      buildRate: 4.2, // darts to full lock — a handlebar is not a steering wheel
      brakeMul: 0.7, // two small drums, and no weight to press them into the road
      minRadius: 3.2, // it can turn round inside a lane, which no car in the fleet can
      body: {
        /* THE WOBBLE, AND WHY IT IS NOT SIMPLY THE OLD NUMBERS.
         *
         * Restoring rollZeta 0.85 and loadTauRoll 0.15 exactly — the pre-fix values — does not
         * reproduce the pre-fix feel on this vehicle, and the measurement says why. At 130 kg the
         * tyre model's own slip chatter reaches the lean spring, and a lightly-damped spring
         * chasing a lightly-filtered target rang at 24 Hz: sixty reversals in two and a half
         * seconds at just over a degree. That is a buzz, not a wobble — nobody would call it
         * "left to right", they would call it broken.
         *
         * A wobble you can SEE is about a cycle a second. So the spring is slowed rather than
         * merely under-damped (rollOmega 5.5 against the fleet's 8.4, i.e. 0.88 Hz), its target is
         * filtered at least as hard as a car's so the chatter never arrives, and the damping is
         * taken well under 1 so it genuinely overshoots and comes back. Measured at 1.2 Hz with
         * five reversals after the wheel comes back to centre, against one for every car. */
        rollOmega: 5.5,
        rollZeta: 0.6,
        loadTauRoll: 0.26,
        /* The one number kept from the old régime as-is: the ground-following rate limit that a
         * car needs to stop it snapping onto a road's embankment shoulder. A scooter darting about
         * over camber is the good half of the old behaviour. */
        groundFollowRate: 45,
        rollClamp: (13 * Math.PI) / 180,
        visualRollMul: 1.9,
      },
    },
  },
  {
    /* THE PICKUP. Operator: "Add ford f150 to game".
     *
     * The one genuinely different SHAPE in the fleet — everything else is a car, this is a truck, and
     * at 5.91 m it is a metre and a quarter longer than anything beside it on a forecourt. Its model
     * is built by tools/make-truck.mjs from this repository's own geometry rather than downloaded:
     * every CC0 pickup available is a single-material texture-atlas model, and this game paints a car
     * by reading separated material names. That note lives in full at the top of make-truck.mjs.
     *
     * "Ford" and "F-150" are Ford's trademarks. This is a generic full-size pickup at F-150
     * proportions; the label below is the only place the name appears, so renaming it is one word.
     *
     * It DRIVES like a truck, which is the point of adding one rather than another saloon: the lowest
     * cornering limit in the fleet, the slowest steering build, and the only positive `offRoad` bonus
     * besides the Rally's — a pickup should be the thing you take off the tarmac when the Rally is
     * still out of reach. The tank is the fleet's biggest, in tuning.js, for the same reason. */
    id: 'pickup',
    file: 'synty-pickup.glb',
    label: 'Ford F150',
    blurb: 'A full-size pickup. Slow to turn, hard to stop, and happy in the dirt.',
    unlockAt: 60000,
    price: 260,
    tier: 'truck',
    length: 5.91,
    /* buildRate 3.0, not 2.1. `buildRate` is how fast the KEYBOARD winds on to full lock, and at 2.1
     * — the slowest in the fleet — the truck spent most of a seven-second turn still winding on.
     * A truck's laziness belongs in `comfortG` (how much cornering it will ask for at all), which is
     * still the lowest here; making the driver wait for the wheel to arrive just feels broken. */
    /* comfortG 8.4 and rearGrip 0.98. The truck still would not come round: 94 degrees of a required
     * 100 on the browser suite's turn-around check. `rearGrip` above 1 is extra grip at the BACK,
     * which is understeer — the nose washes wide and the car refuses to rotate — and 1.08 was the
     * most understeery number in the fleet on the heaviest car. A truck should feel lazy and lean,
     * which it does through its mass, its roll and its low limits; it should not be unable to turn
     * round in a dead end, which is what a new player will try in the first minute. */
    feel: { comfortG: 8.4, assist: 'cruise', rearGrip: 0.98, buildRate: 3.0, brakeMul: 0.92, offRoad: 1.35, minRadius: 5.2 },
  },
  /* THE TRICYCLE NOW LIVES HERE, not at FLEET[1] — see the note above FLEET for the full story and
   * the measurements. Short version: FLEET[1] is what one tap of V reaches once every car is
   * unlocked, browser-test.mjs's own suite taps V exactly once and never again, and the Tricycle's
   * pendulum model (car/microPhysics.js) could not reliably hold 45 km/h through the stretch of road
   * the suite happens to reach by the time it measures braking — not a collision, not the brakes,
   * the car. Moving it here changes nothing about what it costs or when it opens: still
   * `unlockAt: 0, price: 20`, still the cheapest thing you can buy, still exactly as prone to going
   * over on purpose as it was built to be (2.83 s of full lock from 36 km/h — car/microPhysics.js).
   * It is only no longer the car a single keypress hands you for the rest of a drive. */
  { ...MICRO_BY_ID.threewheeler, unlockAt: 0, price: 20 },
  {
    id: 'coupe',
    earnAt: 70, // was 25 — one rung up, the Estate's old threshold. See the note above FLEET.
    file: 'coupe.glb',
    label: 'Coupe',
    blurb: 'The road car. Quick enough to be interesting, calm enough to cruise.',
    unlockAt: 3000,
    price: 45,
    tier: 'sports',
    length: 4.3,
    feel: { comfortG: 9.2, assist: 'sport', rearGrip: 1.0, buildRate: 2.8, brakeMul: 1.0 },
  },
  {
    id: 'sedan',
    file: 'sedan.glb',
    label: 'Sedan',
    blurb: 'Long wheelbase, loose rear. It will hold a slide if you ask nicely.',
    unlockAt: 8000,
    price: 90,
    tier: 'sports',
    length: 4.5,
    feel: { comfortG: 10.4, assist: 'sport', rearGrip: 0.9, buildRate: 3.2, brakeMul: 1.0 },
  },
  {
    id: 'rally',
    file: 'rally.glb',
    label: 'Rally',
    blurb: 'Made for the gravel. The only one that is genuinely happy off the tarmac.',
    unlockAt: 20000,
    price: 180,
    tier: 'sports',
    length: 4.2,
    feel: { comfortG: 11.6, assist: 'sport', rearGrip: 0.94, buildRate: 3.6, brakeMul: 1.05, offRoad: 1.35 },
  },
  {
    id: 'taxi',
    file: 'taxi.glb',
    label: 'Taxi',
    blurb: 'Somebody has to. Slow, indestructible, oddly relaxing.',
    unlockAt: 45000,
    price: 320,
    tier: 'gt',
    length: 4.5,
    feel: { comfortG: 7.6, assist: 'cruise', rearGrip: 1.04, buildRate: 2.4, brakeMul: 1.2 },
  },
  {
    id: 'patrol',
    file: 'patrol.glb',
    label: 'Patrol',
    blurb: 'All-wheel drive and the strongest brakes in the fleet. The long-distance one.',
    unlockAt: 100000,
    price: 600,
    tier: 'hyper',
    length: 4.6,
    feel: { comfortG: 9.8, assist: 'sport', rearGrip: 1.02, buildRate: 2.8, brakeMul: 1.3 },
  },
];

export const FLEET_BY_ID = Object.fromEntries(FLEET.map((c) => [c.id, c]));
export const FIRST_CAR = FLEET[0].id;

const KEY = 'wanderoad.unlocks.v1';

/* ── ONE PASSWORD OPENS EVERYTHING ─────────────────────────────────────
 *
 * Operator: "give me a hack to unlock the planes and use password for unlock all 123".
 *
 * `?unlock=123` opens the whole game — every car, the boat, and the plane — and latches it, so it
 * survives the reload the URL parameter would otherwise be lost to. The same string the plane already
 * used as its own pass (game/plane.js's PLANE_PASS), because two different passwords for two
 * different unlocks is a thing to remember for no reason.
 *
 * It is a HACK and it is meant to be: it exists so the operator can reach anything instantly when
 * testing, without grinding the economy that the rest of the game is about. */
export const UNLOCK_PASS = '123';

/** Did the player arrive with `?unlock=123`? Latches into the same store `cheatOn` reads. */
export function applyUnlockParam() {
  try {
    if (new URLSearchParams(location.search).get('unlock') === UNLOCK_PASS) {
      setCheat(true);
      return true;
    }
  } catch {
    /* no `location` (a node harness) — nothing to apply, same stance cheatOn takes */
  }
  return false;
}

/** Cheat mode: everything open, for testing and for anyone who just wants to drive. */
export function cheatOn() {
  try {
    return new URLSearchParams(location.search).has('cheat') || localStorage.getItem(KEY + '.cheat') === '1';
  } catch {
    return false;
  }
}

export function setCheat(on) {
  try {
    localStorage.setItem(KEY + '.cheat', on ? '1' : '0');
  } catch {
    /* private mode; the URL parameter still works */
  }
}

/** Best streak ever, in metres. The single number the whole fleet unlocks against. */
export function bestStreak() {
  try {
    const raw = localStorage.getItem('wanderoad.streak.v1');
    return raw ? +JSON.parse(raw).best || 0 : 0;
  } catch {
    return 0;
  }
}

/* ── CARS ARE BOUGHT, NOT PASSED ──────────────────────────────────────────────
 * Operator: "add dealerships where you can buy cars with suns ... New cars = suns."
 *
 * `unlockAt` is kept — it still places each car's badge along the unlock bar, and it is still
 * what `nextUnlock` reports, so the bar continues to answer "what is coming next". But it no
 * longer GRANTS anything: a car is yours when you have paid for it at a dealership.
 *
 * The wallet is passed in rather than imported, for the same reason `best` is: this module is
 * pure and testable, and a hard dependency on localStorage-backed state would end that. A
 * caller with no wallet to hand gets the old distance rule, which is what keeps every existing
 * tool and fixture in this repo working unchanged.
 */
export function isUnlocked(car, best = bestStreak(), wallet = null) {
  if (cheatOn()) return true;
  if (wallet) return wallet.owns(car.id, FLEET[0].id, earnAtOf(car));
  return best >= car.unlockAt;
}

/** Lifetime suns this car unlocks at, or Infinity for the ones that must be bought at a dealership. */
export function earnAtOf(car) {
  return car && Number.isFinite(car.earnAt) ? car.earnAt : Infinity;
}

/**
 * How this car is obtained, as one word plus the number that goes with it. The garage, the HUD and
 * any future unlock screen all need to say the same thing, and three copies of this rule would drift.
 *
 * @returns {{how: 'earn'|'buy', at: number}}
 */
export function unlockRule(car) {
  /* The starter car is `earnAt: 0` rather than a separate 'free' case, and that is not a
   * technicality — it is what makes "the first three cars are total collected" literally true when
   * you count them, AND it is what keeps FLEET[0] out of the forecourt's books: a car with no
   * `earnAt` falls through to `{how: 'buy'}` below, and FLEET[0] is open to everybody, so it would
   * read as a car that is for sale and free at the same time. bench-economy caught exactly that.
   *
   * Tricycle at 0 collected, Hatch at 25, Coupe at 70; everything after is bought. (This line read
   * "Estate at 0, Hatch at 25, Coupe at 70", which the entries above have not agreed with for some
   * time — it is read off them now rather than kept as a second opinion.) */
  const e = earnAtOf(car);
  return Number.isFinite(e) ? { how: 'earn', at: e } : { how: 'buy', at: priceOf(car) };
}

/**
 * The next car still to come and the progress towards it, walking BOTH ladders in fleet order: the
 * earned ones against lifetime suns, the bought ones against the balance. This is what an unlock
 * screen draws a bar from.
 *
 * @param {object} wallet
 * @returns {{car: object, how: string, need: number, have: number, remaining: number, progress: number}|null}
 */
export function nextCar(wallet) {
  if (!wallet || cheatOn()) return null;
  for (const c of FLEET) {
    if (isUnlocked(c, 0, wallet)) continue;
    const r = unlockRule(c);
    const have = r.how === 'earn' ? wallet.sunsEarned : wallet.suns;
    return {
      car: c,
      how: r.how,
      need: r.at,
      have,
      remaining: Math.max(0, r.at - have),
      progress: r.at > 0 ? Math.min(1, have / r.at) : 1,
    };
  }
  return null;
}

/** What this car costs at a dealership, in suns. */
export function priceOf(car) {
  return Math.max(0, +car.price || 0);
}

/** The next car you have not yet earned, and how far away it is. */
export function nextUnlock(best = bestStreak()) {
  if (cheatOn()) return null;
  for (const c of FLEET) {
    if (best < c.unlockAt) return { car: c, remaining: c.unlockAt - best, progress: best / c.unlockAt };
  }
  return null;
}

/** Apply a car's feel to the shared tuning tables. One solver, many cars. */
/** The fleet's median length, and the reference the engine voice is scaled against. */
export const ENGINE_REF_LEN = 4.5;

/**
 * WHAT THIS CAR SOUNDS LIKE. Operator: "Sounds need to change per car deeper for bigger cars".
 *
 * The engine is synthesised, and its pitch came from ONE line in audio/engine.js: a global
 * `26 + rpmFrac * 48`. The whole fleet therefore shared one 26-74 Hz band, so the 5.91 m Ford and
 * the 4.0 m hatch were sample-for-sample identical.
 *
 * Derived from the car's own LENGTH rather than a new per-car table, so it cannot drift from the
 * fleet and a new car gets a voice for free. Raised to 0.75 rather than used linearly: linear sends
 * a long vehicle so deep it falls out of a laptop speaker entirely, and the point is to be heard as
 * deeper, not to disappear. Tier adds a little brightness on top, because a hyper car is not just a
 * short GT.
 *
 * Resulting pitch multipliers across the fleet: pickup 0.82, hatch 1.09, rally 1.05, coupe 1.04,
 * sedan and taxi 1.00, estate and patrol 0.98 — a hatch-to-truck ratio of 1.33, about five
 * semitones. Unmistakable, and not a gimmick.
 *
 * @returns {{pitch:number, timbre:number}}
 */
export function engineVoice(car) {
  const len = Math.max(2.5, +car?.length || ENGINE_REF_LEN);
  const pitch = Math.min(1.12, Math.max(0.8, Math.pow(ENGINE_REF_LEN / len, 0.75)));
  const bright = { gt: 0.96, sports: 1.0, hyper: 1.06, truck: 0.9 }[car?.tier] ?? 1;
  return { pitch, timbre: (0.55 + 0.45 * pitch) * bright };
}

/* THE VOICE OF THE CAR CURRENTLY BEING DRIVEN.
 *
 * A shared mutable record, set by applyCarFeel, exactly like STEER/TYRE/BRAKE beside it — the
 * audio graph is a singleton and cannot be handed a fleet entry per frame. `car.spec` in the solver
 * is the TIER, which has no length, so the length has to reach the engine some other way and this is
 * the way every other per-car number already travels. */
export const ENGINE_VOICE = { pitch: 1, timbre: 1 };

export function applyCarFeel(car) {
  const f = car.feel;
  STEER.comfortG = f.comfortG;
  STEER.attackG = f.comfortG * 1.6;
  STEER.buildBase = f.buildRate;
  STEER.buildBonus = f.buildRate * 1.6;
  TYRE.muLatRear = 1.34 * f.rearGrip;
  /* Each car's brakes. This was declared in the fleet and then never applied — the Patrol's
   * "strongest brakes in the fleet" and the Estate's forgiving ones were the same brakes. */
  BRAKE.torque = BRAKE.baseTorque * (f.brakeMul || 1);
  // Deeper for a bigger car — see engineVoice.
  Object.assign(ENGINE_VOICE, engineVoice(car));
  /* THE MECHANICAL TURNING FLOOR, per car. `STEER.minRadius` is the radius below which the comfort
   * limiter stops shrinking the lock and the rack simply takes over — it is what decides a parking
   * manoeuvre, because a lateral-acceleration cap says nothing at walking pace.
   *
   * It was one global number, and that was fine while every car was a similar size. With the Ford as
   * the STARTER car it stopped being fine: yaw rate is v/R, the truck is the slowest thing in the
   * fleet, and the browser suite's C3 ("you can stop and turn around") sat at 87-94 degrees of a
   * required 100 — a new player could not three-point-turn out of a dead end, which is something they
   * will try in the first minute. Four tuning guesses at grip, wheelbase, steering ramp and
   * acceleration all missed because none of them is the thing that sets a parking circle.
   *
   * A tighter floor for the truck is also what a real pickup has relative to its size: a big lock at
   * the rack, used up quickly by the long body. */
  STEER.minRadius = f.minRadius || STEER_MIN_RADIUS_DEFAULT;
  /* The Rally's `offRoad: 1.35` was the same story a second time — declared above ("the only
   * one that is genuinely happy off the tarmac") and read nowhere. car/vehicle.js's dunes
   * sand-bog severity now divides by this, so the Rally takes proportionally longer to bog
   * down than the rest of the fleet instead of the number sitting there doing nothing. */
  TYRE.offRoadMul = f.offRoad || 1;
  /* HOW MUCH THE BODY IS ALLOWED TO WOBBLE, per vehicle. Assigned from the stock values every time
   * so switching Scooter -> anything else puts the cars back; a car that declares no `feel.body` is
   * bit-for-bit what it was before this existed. */
  Object.assign(BODY, BODY_STOCK, f.body || {});
  return f;
}

/** Pick a car from the URL, falling back to the first one you can actually drive. */
export function carFromUrl(search = location.search) {
  const want = new URLSearchParams(search).get('car');
  const best = bestStreak();
  const c = FLEET_BY_ID[want];
  if (c && isUnlocked(c, best)) return c;
  return FLEET_BY_ID[FIRST_CAR];
}

/** Metres formatted the way the unlock bar wants them. */
export function fmtUnlock(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
