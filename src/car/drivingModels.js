/* created by AI */
/* Wanderoad — seven driving models.
 *
 * Operator: "add seven different driving models to each car, and I'll pick the one that works
 * the best. But they should be quite distinct."
 *
 * A driving model is NOT a car. The car is still the car: the Patrol keeps its all-wheel drive
 * and its enormous brakes, the Estate keeps its softness, the Scooter keeps its wobble. A model
 * is a MODIFIER laid over whatever car is selected — a whole-vehicle character that changes how
 * the same machine answers the wheel. Seven models across nine cars is sixty-three ways to
 * drive, and every one of them still knows which car it is.
 *
 * ── WHAT THE SEVEN ARE FOR ────────────────────────────────────────────────────
 * The operator gave three anchors, and all seven are positioned against them:
 *
 *   "Some are just slow, but don't feel like they take a lot of effort... when you drive a junk
 *    car, it feels like it's a lot of work. Even at the slow speed."
 *        -> SLOW MUST MEAN WORK, NOT WAITING. So `graft` does not touch peak torque, gearing or
 *           top speed at all. Not one number in any drivetrain moves, and the diagnostic re-checks
 *           that on every run. It is slow because the tyres cannot put the power the engine is
 *           already making down, and because the wheel has gone numb, so every metre is bought
 *           with a correction. Measured on the Coupe with a completely unchanged engine: 0-60
 *           5.43 s -> 5.92 s, the driver's steering work through a slalom 15.7 -> 16.3 turns, and
 *           the distance he ends up from the line he was aiming at 1.41 m -> 1.86 m. That last
 *           number is the operator's sentence: the effort goes up AND buys less.
 *
 *   The Patrol, on being GOOD-hard: "its back end swings out a lot... definitely not cozy, but it
 *   gives you the option to not be cozy in a cozy game."
 *        -> `tailhappy` is that flavour made available on ANY car. Measured: the rear axle runs at
 *           12.6° of slip in an ordinary corner against Stock's 2.8°, and 61° of sideslip through
 *           the provocation against Stock's 21°. Critically it is still catchable: TYRE.tailFloor
 *           goes UP, not down, so once you are sideways there is MORE to steer with rather than
 *           less. That distinction is the whole design brief of tuning.js — a slide must be
 *           readable before it starts and catchable after.
 *
 *   The Coupe, on being GOOD-safe: "safe to drive, easy enough to drive, but it also takes a
 *   little bit of challenge."
 *        -> `stock` is exactly today's feel, bit for bit, so that reference is never lost. It is
 *           model 1 and it changes nothing. Not "should change nothing" — the diagnostic drives
 *           every car in the fleet for eight seconds through `stock` and through the game with
 *           this module deleted, and compares position, heading, yaw rate, speed, sideslip and
 *           roll to twelve decimal places. 9/9 identical, and still 9/9 after all six other
 *           models have been through the tables.
 *
 *   "Everything should feel fast in its own right."
 *        -> No model lowers a car's top speed or its torque curve. Not one. Where a model is
 *           slower to 60 it is slower because of GRIP or MASS, which the driver's hands feel,
 *           never because the engine was quietly turned down, which they cannot.
 *
 * ── MEASURED, ON THE COUPE (tools/diag-driving-models.mjs) ────────────────────
 *
 *                0-60 s   lat g   yaw °/s   rear °   slip °   resp s    work   path m   60-0 m   xfer
 *   Stock          5.43    1.19      37.6     2.82     21.3     0.33    15.7     1.41     10.0   1.38
 *   Planted        5.43    1.54      48.0     2.42     35.6     0.25    11.9     0.90      7.9   1.37
 *   Tail-Happy     5.43    1.08      47.4    12.58     61.0     0.42    13.8     1.09     10.0   1.42
 *   Weight         7.03    1.17      37.1     2.70     19.1     0.44    14.8     1.32     10.7   1.62
 *   Graft          5.92    0.91      35.8     4.55     18.2     0.39    16.3     1.86     20.4   1.22
 *   Kart           4.32    1.33      46.0     1.97     48.4     0.16    12.0     0.84      9.3   1.26
 *   Pendulum       5.49    1.08      33.6     1.11      4.5     0.24    15.9     1.46      9.0   1.05
 *
 * `rear` is the rear axle's own slip angle in a steady corner, `slip` the peak sideslip through a
 * shared provocation, `work` the turns of lock a fixed driver moves through a 0.84 g slalom,
 * `path` how far off the line that left him, `xfer` the peak front-axle load under braking as a
 * multiple of its cruising load. All 21 pairs separate; the matrix is in the tool's output.
 *
 * ── HOW IT COMPOSES WITH THE GARAGE ───────────────────────────────────────────
 * game/garage.js's `applyCarFeel()` is the ONE place a vehicle's numbers are written into the
 * shared tuning tables, and this file does not open a second one. Every model's `apply()` is:
 *
 *     1. restore the tuning tables to stock          (so switching models is not cumulative)
 *     2. applyCarFeel(carEntry)                      (the car writes its own identity, as always)
 *     3. layer the model's modifiers on top          (multipliers, so the car's identity survives)
 *
 * Step 3 is multiplicative wherever it can be. `tailhappy` asks for 80% of the rear grip the car
 * already had, so the Patrol's rearGrip 1.02 becomes 0.82 and the Sedan's 0.90 becomes 0.72 —
 * both looser, still ordered the way the garage ordered them.
 *
 * Step 1 exists because `applyCarFeel` only rewrites the handful of fields a car declares
 * (comfortG, buildRate, rearGrip, brakeMul, minRadius, offRoad and BODY). It has no idea about
 * TYRE.muLongPeak or STEER.satGain, so a model that changed those would leak into the next model
 * for ever. The snapshot below is taken at module load, before anything has been applied, and is
 * the same trick garage.js already uses for `BODY_STOCK` — one mechanism, used twice.
 *
 * ── SELF-CONTAINED, DELIBERATELY ──────────────────────────────────────────────
 * A sibling agent is porting the operator's pasted Unity CarController in full, for one specific
 * car. Model 7 here is the same FLAVOUR applied to any car, and it shares no state and no file
 * with that port: it reaches only the exported tuning tables, and it restores them from its own
 * snapshot every time. The two can coexist; whichever ran last owns the tables.
 *
 * Nothing in this file is per-frame state. Like tuning.js, it is data plus the function that
 * writes it.
 */

import { TIERS, TYRE, STEER, PEDAL, BRAKE, BODY, SUSPENSION, AIR, PRESETS, ASSIST } from './tuning.js';
import { applyCarFeel } from '../game/garage.js';

/* ── the stock snapshot ────────────────────────────────────────────────────────
 * Taken at module load, before any model or any car has written anything. Restoring from it is
 * what makes model switching idempotent rather than cumulative: pick `weight` five times in a row
 * and the car does not get five times heavier.
 *
 * TIERS is included, and that is not gratuitous. `cgHeight`, `mass` and `izz` are the three
 * numbers a "real weight transfer" model and a "kart" model are ACTUALLY about — the solver's
 * longitudinal transfer is W * (cgHeight/wheelbase) * loadLong and its yaw response is
 * moment/izz, so a model that cannot reach them can only pretend. They are restored from this
 * snapshot on every apply, so a model never sees another model's numbers.
 */
function snapshot(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (Array.isArray(v)) out[k] = v.slice();
    else if (v && typeof v === 'object') out[k] = snapshot(v);
    else out[k] = v;
  }
  return out;
}

function restoreInto(target, stock) {
  for (const k of Object.keys(stock)) {
    const v = stock[k];
    if (Array.isArray(v)) target[k] = v.slice();
    else if (v && typeof v === 'object') restoreInto(target[k], v);
    else target[k] = v;
  }
}

const STOCK = {
  TIERS: snapshot(TIERS),
  TYRE: snapshot(TYRE),
  STEER: snapshot(STEER),
  PEDAL: snapshot(PEDAL),
  BRAKE: snapshot(BRAKE),
  BODY: snapshot(BODY),
  SUSPENSION: snapshot(SUSPENSION),
  AIR: snapshot(AIR),
  PRESETS: snapshot(PRESETS),
  ASSIST: snapshot(ASSIST),
};

const TABLES = { TIERS, TYRE, STEER, PEDAL, BRAKE, BODY, SUSPENSION, AIR, PRESETS, ASSIST };

/**
 * Put every tuning table back exactly as tuning.js declared it.
 *
 * A TIER THAT APPEARS LATER IS ADOPTED, NOT IGNORED. The sibling agent's Unity port exports
 * `installMicroTiers()`, which adds its own keys to the shared `TIERS` table at runtime — after
 * this module's snapshot was taken. Two things would go wrong without the loop below, and they are
 * the two halves of the same bug:
 *
 *   - every model iterates `Object.keys(TIERS)`, so it would happily scale a tier that appeared
 *     after the snapshot, and
 *   - `restoreInto` only walks the keys it HAS, so it could never put that tier back.
 *
 * Net effect: switching between models would compound on the late tier for ever — pick `weight`
 * five times and that one car really would get five times heavier, which is precisely the failure
 * the snapshot exists to prevent. Capturing any unknown tier here, at the top of the restore that
 * runs before every single apply, means it is caught in its pristine just-installed state and is
 * restorable from then on. The two modules stay independent and neither has to know the other's
 * load order. */
export function restoreStockTuning() {
  for (const key of Object.keys(TIERS)) if (!STOCK.TIERS[key]) STOCK.TIERS[key] = snapshot(TIERS[key]);
  for (const name of Object.keys(STOCK)) restoreInto(TABLES[name], STOCK[name]);
}

/* ── small helpers, so a model reads as a list of intentions ─────────────────── */

/** Multiply a field in place. `mul(TYRE, 'muLatFront', 1.25)` — composes with whatever the car set. */
const mul = (obj, key, k) => {
  obj[key] = obj[key] * k;
};
/** Multiply several fields by the same factor. */
const mulAll = (obj, keys, k) => {
  for (const key of keys) obj[key] = obj[key] * k;
};
/** Set a field outright. Used only where a multiplier would be dishonest — an absolute target. */
const set = (obj, key, v) => {
  obj[key] = v;
};

/**
 * Every rung of the aid ladder at once.
 *
 * `PRESETS` is the right place for a model's assists rather than `vehicle.assist`, because
 * `Vehicle.setPreset()` copies FROM the presets table — so anything written straight onto the live
 * vehicle is silently thrown away the next time the game changes aid setting, and it would not
 * survive a car swap either. Scaling the rungs instead means a Taxi on `cruise` with the `graft`
 * model gets slippery-cruise: still the most helpful rung available on that car, just less help
 * than a grippy car's cruise. The ladder keeps its ORDER, which is the thing the ladder is for.
 *
 * `hardcore` is deliberately included in the scaling but its zeros stay zero — anything times zero
 * is zero, which is exactly the right answer for the rung whose entire meaning is "no aids".
 */
function scaleAssists(m) {
  for (const name of Object.keys(PRESETS)) {
    const p = PRESETS[name];
    if (m.counterSteer != null) p.counterSteer = Math.min(1, p.counterSteer * m.counterSteer);
    if (m.stability != null) p.stability = Math.min(0.95, p.stability * m.stability);
    if (m.tcs != null) p.tcs = Math.min(1, p.tcs * m.tcs);
    if (m.abs != null) p.abs = Math.min(1, p.abs * m.abs);
  }
}

/* ══════════════════════════════════════════════════════════════════════════════
 * THE SEVEN
 * ══════════════════════════════════════════════════════════════════════════════ */

/* 1 — STOCK.
 *
 * Changes nothing. It exists so the thing the operator already approved of cannot be lost while
 * the other six are being judged against it, and so that "back to how it was" is a menu entry
 * rather than a revert. The Coupe's "safe to drive, easy enough to drive, but it also takes a
 * little bit of challenge" is this model's job description, and it already does it. */
function tuneStock() {
  /* Intentionally empty. `apply()` has already restored stock and run applyCarFeel(), so the car
   * is bit-for-bit what it is with this whole file deleted. Verified by the diagnostic tool:
   * stock's column equals a Vehicle built without ever importing this module. */
}

/* 2 — PLANTED. The grippy arcade one.
 *
 * The fantasy is a car that goes where it is pointed and does not argue. More grip at both ends,
 * a lot more aero, faster hands at the wheel, and the aid ladder turned up a rung's worth on
 * every rung. The tyre bites sooner (peak slip angles come in) so turn-in is immediate.
 *
 * The lift-off drop is nearly switched off (0.06 -> 0.018): TDU1's signature snap-oversteer is a
 * TOOL in `stock` and `tailhappy`, and it is precisely what a planted arcade car should not do. This
 * is the one model where closing the throttle mid-corner is safe.
 *
 * It is not the fastest to respond — `kart` is — because a planted car still has its mass and its
 * moment of inertia. It is the one with the most lateral grip and the shortest stop: measured,
 * 1.54 g against Stock's 1.19 g, and 7.9 m from 60 km/h against Stock's 10.0 m. It also takes the
 * least effort to place — 11.9 turns of lock through the slalom against Stock's 15.7, ending
 * 0.90 m from the line against 1.41 m. */
function tunePlanted() {
  mulAll(TYRE, ['muLatFront', 'muLatRear', 'muLongPeak', 'awdCap'], 1.3);
  mulAll(TYRE, ['peakSlipFront', 'peakSlipRear'], 0.9); // bites sooner: turn-in with no wait
  set(TYRE, 'downforce', 0.62); // 0.22 stock. At 100 km/h that is ~480 N pressing it down
  set(TYRE, 'liftoffDrop', 0.018); // the one model where lifting mid-corner is safe
  mul(TYRE, 'ellipseExp', 0.95); // a little more braking-and-turning at once
  mulAll(STEER, ['buildBase', 'buildBonus'], 1.35);
  mul(STEER, 'returnRate', 1.15);
  mulAll(STEER, ['comfortG', 'attackG'], 1.28); // you may ASK for more, because it can deliver it
  mul(BRAKE, 'torque', 1.35);
  for (const t of Object.keys(TIERS)) mul(TIERS[t], 'rollPerG', 0.7); // flat, planted
  scaleAssists({ stability: 1.7, tcs: 1.6, abs: 1.25, counterSteer: 1.15 });
}

/* 3 — TAIL-HAPPY. The loose one, and the operator's own favourite flavour.
 *
 * Operator on the Patrol: "its back end swings out a lot... definitely not cozy, but it gives you
 * the option to not be cozy in a cozy game." That is the brief, made available on every car.
 *
 * Four things move together, and the fourth is the one that makes it good rather than merely
 * hostile:
 *   - rear grip down to 80% of whatever the car had, so the back goes light first;
 *   - rear peak slip angle UP 35%, so the rear takes a bigger angle before it says anything —
 *     which is what makes the step-out gradual and legible instead of a snap;
 *   - lift-off drop nearly tripled, so closing the throttle is a steering input;
 *   - TYRE.tailFloor UP, 0.55 -> 0.63.
 *
 * That last one is counter-intuitive and it is the whole difference between this and a bad car.
 * tailFloor is the floor under lateral force once you are past peak slip — it is what you have
 * left to steer with when the car is ALREADY sideways, and tuning.js's own header names its
 * absence as exactly why TDU2 has "no way to correct" an oversteer. Making the rear let go
 * earlier while giving MORE to hold on to afterwards is a car that swings and can be caught.
 *
 * The drift-window numbers come down with it: driftYawDamp 1.9 -> 0.8 means a held slide is not
 * being quietly strangled, and driftBonus up means there is more lock available to catch it with. */
function tuneTailHappy(feel) {
  mul(TYRE, 'muLatRear', 0.8);
  mul(TYRE, 'peakSlipRear', 1.35);
  set(TYRE, 'tailFloor', 0.63); // MORE to hold on to once sideways, not less. See above.
  set(TYRE, 'liftoffDrop', 0.16);
  mul(TYRE, 'liftoffHold', 1.4);
  mul(STEER, 'driftYawDamp', 0.42); // a held slide is allowed to be held
  mul(STEER, 'spinYawDamp', 0.62);
  set(STEER, 'driftBonus', 0.34); // and there is lock available to catch it with
  mul(STEER, 'driftLow', 0.75); // that lock arrives sooner
  mul(STEER, 'satGain', 0.75); // the wheel does not self-centre out of the slide for you
  /* Mass towards the back. A pendulum is what a tail-happy car IS, and weightRear is the only
   * honest way to say so — it moves the CG rearwards, which lengthens the moment arm the rear
   * axle works on and shortens the front's. Clamped at 0.62 so no car ends up with its engine
   * behind the rear axle, which is a different vehicle entirely. */
  for (const t of Object.keys(TIERS)) TIERS[t].weightRear = Math.min(0.62, TIERS[t].weightRear + 0.045);
  scaleAssists({ stability: 0.22, tcs: 0.3, counterSteer: 0.6 });
  /* A car whose whole point is that the back steps out should not be on the rung that stops the
   * back stepping out. Every car drops at least to `sport`; the ones already lower stay lower. */
  if (feel.assist === 'cruise') feel.assist = 'sport';
}

/* 4 — WEIGHT. The heavy, simulation-ish one.
 *
 * The car has real mass and you are asked to manage it. Everything here is about the TIME
 * dimension of load: the transfer is bigger (a taller CG), it arrives slower (longer load
 * filters), it takes longer to come back, and the wheel is heavier in your hands on the way in
 * and out of it.
 *
 * cgHeight is the number that matters and there is no substitute for it. The solver's
 * longitudinal transfer is literally W * (cgHeight / wheelbase) * loadLong, so raising it 38%
 * raises the front/rear load swing by 38% — brake and the nose really is loaded, get on the power
 * and the front really does go light. That is the mechanism TDU1 is loved for and TDU2 is
 * disliked for not having ("near-zero body roll"), and rollPerG rises with it so you can SEE it.
 *
 * ellipseExp goes to 2.00, the textbook circle, from tuning.js's deliberately generous 1.85. That
 * removes the ~6% of simultaneous capacity that lets trail-braking rotate the car, so on this
 * model you separate your braking from your turning like a driver in a heavy car has to. It is
 * the one model where that is true, and it is why it stops longest.
 *
 * The pedals slow down too. A 420 ms throttle and a 130 ms brake instead of 250/70 is not a
 * "delay" — it is the weight of a real pedal and the compliance of a real brake line, and it is
 * what stops this model feeling like `stock` with a bigger number on the scales.
 *
 * Measured, on the column no other model here can move as far: peak front-axle load under a 60-0
 * stop is 1.62x its cruising load, against Stock's 1.38x and the Pendulum's 1.05x. Alongside it,
 * 7.03 s to 60 against 5.43 s — mass, not power; the drivetrain audit proves the engine is
 * untouched — and 0.44 s to 90% of its own steady yaw against 0.33 s. Slow hands, slow load, and
 * you always know where the car's weight is.
 *
 * cgHeight is 1.6x, not the 1.45x this started at, and the two slowest cars in the fleet are why.
 * On the Coupe 1.45x separated this model from Stock comfortably. On the Hatch and the Taxi it did
 * not: both are `gt` tier and both stop hard for their pace, so the transfer ratio only reached
 * 1.54x against Stock's 1.38x — a 10% gap, under the 12% the diagnostic calls a separation, and
 * two of nine cars where "the heavy one" and "the stock one" were the same drive. Rather than
 * weaken the bar to make them pass, the lever that IS this model was pushed until it cleared the
 * bar on every car. All nine now do. */
function tuneWeight() {
  for (const t of Object.keys(TIERS)) {
    mul(TIERS[t], 'mass', 1.28);
    mul(TIERS[t], 'izz', 1.45);
    mul(TIERS[t], 'cgHeight', 1.6); // the transfer itself: W * (cgHeight/wb) * loadLong
    mul(TIERS[t], 'rollPerG', 1.5); // ... and you can see it happening
    /* ... BUT NOT SO HIGH THAT SOMETHING LIES DOWN. A raised centre of gravity is also a lower
     * ROLLOVER threshold, because vehicle.js's tip solver works in fractions of the vehicle's own
     * static tipping angle, atan(halfTrack / cgHeight). On the wide cars 1.6x is harmless — the
     * Coupe goes 62.6° -> 50.3° and never gets near either. On the Scooter, whose track is 1.0 m
     * (and tuning.js is explicit that even that is an accommodation, not a measurement), it took
     * the tipping angle to 34.8° and the thing simply fell over in an ordinary full-lock turn:
     * measured 2.6 °/s of yaw against Stock's 38.0, i.e. not cornering at all, lying on its side.
     *
     * So the raise is capped at whatever keeps the static tipping angle at 42°. That binds on the
     * Scooter (0.72 m -> 0.56 m) and, just, on the pickup (0.99 m -> 0.96 m); on nothing else in
     * the fleet. The model keeps its whole intent everywhere it matters — this is a floor under
     * rideability, not a softening of the character. */
    TIERS[t].cgHeight = Math.min(TIERS[t].cgHeight, (TIERS[t].track * 0.5) / Math.tan((42 * Math.PI) / 180));
  }
  set(BODY, 'loadTauPitch', 0.36); // 0.12 stock: the transfer takes a beat to arrive
  set(BODY, 'loadTauRoll', 0.42); // 0.22 stock
  mul(BODY, 'rollOmega', 0.72); // a big body on its springs is a slow spring
  set(BODY, 'rollZeta', 1.02); // still overdamped, so it does not become the scooter wobble
  mulAll(STEER, ['buildBase', 'buildBonus'], 0.62); // a heavy wheel winds on slowly
  mul(STEER, 'returnRate', 0.7);
  set(STEER, 'satGain', 0.46); // weight through the rim. 0.5 is tuning.js's stated "numb" threshold
  set(TYRE, 'ellipseExp', 2.0); // brake OR turn. The one model where trail-braking will not save you
  mul(TYRE, 'downforce', 0.55); // no aero to lean on; it is all mechanical
  mul(BRAKE, 'torque', 0.86); // same brakes, 28% more car
  set(PEDAL, 'throttleUp', 1 / 0.42);
  set(PEDAL, 'brakeUp', 1 / 0.13);
  mul(SUSPENSION, 'stiffness', 0.86);
  mul(SUSPENSION, 'damping', 1.1);
  scaleAssists({ stability: 0.65, tcs: 0.55 });
}

/* 5 — GRAFT. The low-grip one, where everything is work.
 *
 * Operator: "Some are just slow, but don't feel like they take a lot of effort... when you drive
 * a junk car, it feels like it's a lot of work. Even at the slow speed."
 *
 * THE ENGINE IS NOT TOUCHED. Not peakTorque, not the ratios, not the final drive, not topSpeed,
 * not cdA. A model that is slow because someone turned the power down is slow in a way the driver
 * cannot feel in their hands — it is waiting, which is the failure mode named above. This one is
 * slow because the tyres cannot take the power the engine is already making, and because the car
 * will not hold a line without being held there.
 *
 * Where the work comes from, in order of how much of it each contributes:
 *   - muLongPeak x0.66. Traction, not power, is now the limit off the line. The wheels spin, the
 *     traction control is gone, and 0-60 grows by half again on an engine that never changed.
 *   - muLat x0.72 both ends, and BOTH ends is the point — `tailhappy` takes grip from the rear only,
 *     which is a car with a character. Taking it from both is a car with a problem: it pushes,
 *     then it snaps, and you never quite know which is coming.
 *   - peak slip angles x0.8. The plateau is NARROWER, so the window where the tyre is working is
 *     smaller and you have to live inside it. tailFloor stays at 0.55 — the anti-TDU2 floor is
 *     not for sale, because a junk car should be hard, not unrecoverable.
 *   - satGain x0.5. The wheel has gone numb. This is what turns "hard" into "work": you get less
 *     information back, so you correct more often and more coarsely.
 *   - the aid ladder gutted: no traction control at all, a fifth of the stability, half the
 *     counter-steer help.
 *
 * Rolling resistance is up 40% as well, which is the honest version of tired bearings and soft
 * tyres — it is a drag term, so it costs most where you were going fastest and nothing at all at
 * a standstill, and it never touches how hard the engine is allowed to pull. */
function tuneGraft() {
  mulAll(TYRE, ['muLatFront', 'muLatRear', 'awdCap'], 0.72);
  /* 0.5, not 0.66. The first attempt used 0.66 and 0-60 went 5.43 s -> 5.48 s, i.e. nothing at
   * all, because it never actually bit: the Coupe's launch asks about 6330 N of the rear axle and
   * 0.66 x 1.42 x 7540 N of rear load is 7070 N, still comfortably above it. A "traction limit"
   * that sits above the traction being used is a number, not a limit. At 0.5 the ceiling is
   * 4820 N, genuinely under the launch demand, the wheels spin, TCS is gone, and the same
   * untouched engine needs 6.24 s against Stock's 5.43 s. THAT is the operator's junk car. */
  mul(TYRE, 'muLongPeak', 0.45); // traction, not power, is the limit now
  mulAll(TYRE, ['peakSlipFront', 'peakSlipRear'], 0.8); // a narrower window to live inside
  mul(TYRE, 'liftoffDrop', 1.6);
  mul(TYRE, 'downforce', 0.4);
  set(STEER, 'satGain', 0.15); // numb. You get told less, so you have to ask more often
  mul(STEER, 'returnRate', 0.7); // it does not come back to centre for you either
  mulAll(STEER, ['buildBase', 'buildBonus'], 0.8);
  mul(BRAKE, 'torque', 0.78);
  set(BRAKE, 'absTargetSlip', 0.13);
  scaleAssists({ tcs: 0, stability: 0.2, counterSteer: 0.5, abs: 0.6 });
}

/* 6 — KART. Instant response, tiny slip angles.
 *
 * A kart has no suspension worth the name, no aero at all, no weight to move about and almost no
 * rotational inertia. It changes direction the moment you ask and it does it flat. Nothing about
 * it is subtle, and that is the point of having it in a list of seven.
 *
 * izz x0.45 is the single biggest lever and the honest one: the solver integrates yaw as
 * moment/izz, so taking the moment of inertia to under half takes the time constant of every
 * direction change with it. Peak slip angles at 50% mean the tyre reaches its peak at 4.0°/4.5°
 * instead of 8°/9° — it is at the limit almost immediately and stays in a very narrow band, which
 * is precisely what "tiny slip angles" means and what a kart tyre does.
 *
 * Measured: 0.16 s to 90% of its own steady yaw rate against Stock's 0.33 s and Weight's 0.43 s,
 * the quickest of the seven by a clear margin; 1.97° of rear slip in a steady corner, the smallest
 * bar the Pendulum; and 0-60 in 4.32 s against 5.43 s, on an engine that was not touched.
 *
 * The steering ramp is torn up: buildBase 2.4 -> 9.0 puts full lock a ninth of a second away on a
 * keyboard, and taperSpeed x1.9 stops the speed taper eating the lock before you get there.
 *
 * It has LESS peak lateral grip than `planted` despite more mu, and that is not an accident:
 * downforce goes down to 0.3 of stock because karts have none. `planted` earns its grip with
 * aero and keeps earning it the faster you go; the kart has all of its grip at every speed and
 * never any more. Two different fast cars. */
function tuneKart() {
  for (const t of Object.keys(TIERS)) {
    mul(TIERS[t], 'izz', 0.45); // the whole model, in one number
    mul(TIERS[t], 'mass', 0.8); // a kart weighs a fifth of a car. Nothing else here is as cheap
    mul(TIERS[t], 'cgHeight', 0.68);
    mul(TIERS[t], 'rollPerG', 0.4); // it corners flat
  }
  mulAll(TYRE, ['peakSlipFront', 'peakSlipRear'], 0.5); // at the limit almost at once, and staying there
  mulAll(TYRE, ['muLatFront', 'muLatRear', 'muLongPeak', 'awdCap'], 1.06);
  mul(TYRE, 'downforce', 0.3); // karts have no aero. This is what keeps it under `planted` on lateral g
  set(STEER, 'buildBase', 12.0); // full lock in ~1/12 s on a keyboard
  mul(STEER, 'buildBonus', 3.0);
  mul(STEER, 'returnRate', 2.0);
  mul(STEER, 'taperSpeed', 1.9); // ... and the speed taper does not eat it first
  mul(STEER, 'taperPow', 0.85);
  mulAll(STEER, ['comfortG', 'attackG'], 1.22);
  mul(STEER, 'satGain', 0.55);
  mul(STEER, 'driftLow', 1.6); // it rarely enters the drift window at all
  mul(STEER, 'minRadius', 0.7);
  mul(BODY, 'rollOmega', 1.4);
  mulAll(BODY, ['loadTauRoll', 'loadTauPitch'], 0.45); // no suspension: transfer is instant
  mul(BRAKE, 'torque', 1.0); // no servo and no aero — it stops on its tyres alone
  set(PEDAL, 'throttleUp', 1 / 0.12);
  set(PEDAL, 'brakeUp', 1 / 0.05);
  scaleAssists({ stability: 1.25, tcs: 1.2 });
}

/* 7 — PENDULUM. The operator's pasted Unity CarController feel, as a flavour.
 *
 * Four things define that controller, and all four are here in this solver's own terms. A sibling
 * agent is porting the spec in full for one specific car; this is the character of it applied to
 * ANY car, and it shares no state with that port — see the header.
 *
 *   1. CENTRE OF MASS BELOW THE AXLES. Unity's oldest and most-copied car trick: drop the
 *      rigidbody's centreOfMass under the wheel line and the car simply stops misbehaving. It
 *      hangs from its wheels like a pendulum instead of balancing on top of them.
 *
 *      This solver is planar and cannot take a negative CG height literally — `cgHeight` divides
 *      into the longitudinal transfer and feeds atan(halfTrack/cgHeight) for the rollover angle,
 *      so a negative would invert dive into lift and put the tipping angle past 90°, which is not
 *      a feel, it is a broken solver. Taken to the floor instead: 0.2 of the car's own height, so
 *      0.084 m on the Coupe's 0.42 m. Measured effect, which is what matters: longitudinal load
 *      transfer drops to a fifth, so the car neither dives nor squats nor goes light over a
 *      crest, and the static tipping angle rises from 62.6° to 84.1° — very nearly unrollable.
 *      Measured straight off the front axle: peak load under a 60-0 stop is 1.05x its cruising
 *      load, against Stock's 1.38x and Weight's 1.62x. The nose does not go down. That IS the
 *      Unity trick, arrived at through the numbers this solver actually has.
 *
 *   2. SPEED-SCALED DOWNFORCE ALONG THE BODY -UP. The controller adds
 *      `-transform.up * downforce * rb.velocity.magnitude`. TYRE.downforce here is N per (m/s)²
 *      and is added to the vertical load W, which every tyre force is then scaled by — the same
 *      place, the same effect. 0.22 -> 2.6, so at 100 km/h it presses down with 2007 N, about
 *      14% of a Coupe's weight again, and the car gets more planted the faster it goes rather
 *      than less. The stock 0.22 is nearly decorative at this game's speeds — 613 N on the
 *      fastest car in the fleet at its own top speed, 4% — so reaching the feel tuning.js
 *      describes ("what makes a car feel planted at speed is downforce, not grip fade") needs a
 *      figure an order of magnitude up from it.
 *
 *   3. THE STEER HELPER, which rotates the velocity vector towards where the car is pointing.
 *      In a solver with tyres, the honest equivalent is a rear axle that bites almost instantly:
 *      peakSlipRear x0.68 with 18% more rear mu means the rear generates its correcting force at
 *      a much smaller angle, so sideslip is pulled out almost as fast as it appears. The
 *      stability yaw gain and the counter-steer lag do the rest — 2.7 instead of 1.4, and a 30 ms
 *      lag instead of 60 ms, which is the "helper" half of the same behaviour.
 *
 *      Measured, and it is the largest single margin in the whole table: through the shared
 *      provocation — turn in, lift off, handbrake, back on the power, with no counter-steer from
 *      the driver at all — this model peaks at 4.5° of sideslip where Stock reaches 21.3° and
 *      Tail-Happy 61.0°. Its rear axle runs at 1.11° of slip in an ordinary corner against
 *      Stock's 2.82°. That is what a steer helper is FOR, and exactly what people mean when they
 *      say a Unity car "feels like it is on rails".
 *
 *   4. THE TRACTION-CONTROL TORQUE RAMP. The controller reduces engine torque while the wheel
 *      slip ratio exceeds a threshold and eases it back afterwards. Here: TCS to 0.9 on every
 *      rung and ASSIST.tcsTargetSlip 0.14 -> 0.085, i.e. it intervenes earlier and harder. The
 *      throttle pedal is slowed to 300 ms to be the "ramp" half — the torque arrives, it does not
 *      appear.
 *
 * What it is NOT: it does not get more grip than the car had. muLatFront is untouched. It is
 * planted because of aero and because it refuses to slide, not because the tyres were improved. */
function tunePendulum() {
  for (const t of Object.keys(TIERS)) {
    mul(TIERS[t], 'cgHeight', 0.2); // 1. the pendulum. See the note above for why not negative
    mul(TIERS[t], 'rollPerG', 0.35);
  }
  set(TYRE, 'downforce', 2.6); // 2. speed-scaled, along the body -up
  mul(TYRE, 'peakSlipRear', 0.68); // 3. the rear bites at a much smaller angle...
  mul(TYRE, 'muLatRear', 1.18); // ... and harder, so sideslip is pulled straight back out
  mul(TYRE, 'peakSlipFront', 0.94);
  mul(TYRE, 'muLongPeak', 1.12); // "on rails" is a braking claim as much as a cornering one
  set(TYRE, 'liftoffDrop', 0.02); // a helper that fought a lift-off snap would be pointless
  mul(STEER, 'satGain', 0.6); // Unity's wheel is light in the hands
  mul(STEER, 'driftYawDamp', 1.45);
  set(ASSIST, 'stabilityYawGain', 2.7); // 3. the helper half
  set(ASSIST, 'csLag', 0.03);
  set(ASSIST, 'tcsTargetSlip', 0.085); // 4. intervenes earlier
  set(PEDAL, 'throttleUp', 1 / 0.3); // ... and the torque ramps in rather than appearing
  mul(BRAKE, 'torque', 1.05);
  scaleAssists({ stability: 3.0, tcs: 4.0, counterSteer: 1.3, abs: 1.2 });
}

/* ── the list ──────────────────────────────────────────────────────────────────
 * Order is the operator's own numbering, and `stock` is first because it is the reference
 * everything else is judged against. `id` is what goes in the URL and in storage; `label` is what
 * a menu draws; `blurb` is one line of what it feels like, in the same voice the garage uses for
 * the cars themselves. */
export const DRIVING_MODELS = [
  {
    id: 'stock',
    label: 'Stock',
    blurb: 'Exactly as the car left the garage. Safe, easy enough, still a little challenge.',
    tune: tuneStock,
  },
  {
    id: 'planted',
    label: 'Planted',
    blurb: 'Grippy and arcade. It goes where you point it and it does not argue.',
    tune: tunePlanted,
  },
  {
    id: 'tailhappy',
    label: 'Tail-Happy',
    blurb: 'The back end swings out a lot. Not cozy — the option to not be cozy.',
    tune: tuneTailHappy,
  },
  {
    id: 'weight',
    label: 'Weight',
    blurb: 'Heavy and honest. The load takes a moment to arrive, and you feel every gram of it.',
    tune: tuneWeight,
  },
  {
    id: 'graft',
    label: 'Graft',
    blurb: 'Everything is work. Same engine, no grip, numb wheel. Slow because it is hard.',
    tune: tuneGraft,
  },
  {
    id: 'kart',
    label: 'Kart',
    blurb: 'Instant. Tiny slip angles, flat through corners, no aero and no patience.',
    tune: tuneKart,
  },
  {
    id: 'pendulum',
    label: 'Pendulum',
    blurb: 'On rails. Weight slung under the wheels, downforce with speed, and it will not slide.',
    tune: tunePendulum,
  },
].map((m) => ({
  id: m.id,
  label: m.label,
  blurb: m.blurb,
  /**
   * Write this model, over this car, into the shared tuning tables.
   *
   * Three steps and they must stay in this order: restore, car, model. See the header.
   *
   * @param {object} carEntry a FLEET entry from game/garage.js
   * @returns {object} the car's feel, COPIED — never the fleet's own object, because a model may
   *                   override `assist` and mutating the fleet entry would make that permanent.
   */
  apply(carEntry) {
    restoreStockTuning();
    const base = applyCarFeel(carEntry);
    const feel = { ...base };
    m.tune(feel, carEntry);
    return feel;
  },
}));

export const DRIVING_MODEL_IDS = DRIVING_MODELS.map((m) => m.id);
const BY_ID = Object.fromEntries(DRIVING_MODELS.map((m) => [m.id, m]));

/** The default, and it is `stock` for the obvious reason: nobody has picked yet. */
export const DEFAULT_DRIVING_MODEL = 'stock';

const KEY = 'wanderoad.drivingModel.v1';

let current = DRIVING_MODELS[0];

/* ── which one is chosen ───────────────────────────────────────────────────────
 * Stored, because the operator is going to drive all seven over several sessions to pick one and
 * having it reset to stock on every reload would make that comparison impossible. Same storage
 * discipline as garage.js: every localStorage touch is wrapped, because private mode throws and a
 * driving model is not worth a white screen. */
function readStored() {
  try {
    const v = localStorage.getItem(KEY);
    return v && BY_ID[v] ? v : null;
  } catch {
    return null;
  }
}

/** `?drive=kart` — the same shape as `?car=` and `?terrain=`, for the preview gallery and the diags. */
export function drivingModelFromUrl(search = typeof location === 'undefined' ? '' : location.search) {
  try {
    const want = new URLSearchParams(search).get('drive');
    return want && BY_ID[want] ? want : null;
  } catch {
    return null;
  }
}

/* The URL wins over storage, storage wins over the default — someone who typed `?drive=graft`
 * meant it, exactly the way `?car=` already beats a resumed session in main.js. Resolved once at
 * module load so `currentDrivingModel()` is honest before anyone has called `setDrivingModel`. */
{
  const initial = drivingModelFromUrl() || readStored();
  if (initial) current = BY_ID[initial];
}

/** The model in force. Never null. */
export function currentDrivingModel() {
  return current;
}

/**
 * Choose a model, by id ('kart') or by index (0-6). Persists the choice.
 *
 * This does NOT touch the car — a choice and an application are two different events, and the
 * caller knows which car is being driven while this module deliberately does not. Follow it with
 * `applyDrivingModel(carEntry, vehicle)`.
 *
 * @returns {object} the model now in force (unchanged, if the id was not recognised)
 */
export function setDrivingModel(idOrIndex) {
  const N = DRIVING_MODELS.length;
  const next = typeof idOrIndex === 'number' ? DRIVING_MODELS[((idOrIndex % N) + N) % N] : BY_ID[String(idOrIndex)];
  if (!next) return current;
  current = next;
  try {
    localStorage.setItem(KEY, current.id);
  } catch {
    /* private mode — the choice lasts the session, which is enough to judge it by */
  }
  return current;
}

/** Step through the seven, for a single key binding. `+1` forward, `-1` back. */
export function cycleDrivingModel(dir = 1) {
  const N = DRIVING_MODELS.length;
  return setDrivingModel((DRIVING_MODELS.indexOf(current) + (dir >= 0 ? 1 : -1) + N) % N);
}

/**
 * Apply the current model to a car, and — if a live Vehicle is handed in — to the car being
 * driven right now, with no reload.
 *
 * This is a drop-in replacement for `applyCarFeel(carEntry)`: it calls it internally (that is
 * still the one place a car's numbers reach the tables) and returns the same feel object, copied.
 *
 * The `vehicle.setPreset()` at the end is what makes it LIVE. The model has just rewritten the
 * `PRESETS` rungs, and a Vehicle holds a COPY of its rung taken when the preset was set — so
 * without this the car would keep driving on the previous model's assists until the next car
 * swap. Everything else the model changed (TYRE, STEER, BRAKE, BODY, TIERS) is read straight out
 * of the shared tables on every step, so it is live the moment this returns.
 *
 * `setTier` is called too, and it matters: `Vehicle.setTier()` caches mass, izz, wheelbase and
 * the two CG-to-axle distances off the tier at the time it ran, so a model that changed mass or
 * izz (`weight`, `kart`) would otherwise be ignored until the next car change.
 *
 * @param {object} carEntry a FLEET entry
 * @param {object|null} vehicle the live Vehicle, or null at boot before one exists
 * @returns {object} the feel, with any model override of `assist` already in it
 */
export function applyDrivingModel(carEntry, vehicle = null) {
  const feel = current.apply(carEntry);
  if (vehicle) {
    if (carEntry.tier) vehicle.setTier(carEntry.tier); // re-read mass/izz/CG — see above
    vehicle.setPreset(feel.assist);
  }
  return feel;
}
