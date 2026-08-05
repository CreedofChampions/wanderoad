/* created by AI */
/* Wanderoad — do the seven driving models actually drive differently?
 *
 *   node tools/diag-driving-models.mjs            the Coupe, all seven, plus the distinctness matrix
 *   node tools/diag-driving-models.mjs patrol     any FLEET id
 *   node tools/diag-driving-models.mjs --all      the fleet-composition table as well
 *
 * Operator: "add seven different driving models to each car ... But they should be quite
 * distinct." "Quite distinct" is not a thing you can eyeball from a diff of tuning constants —
 * four of the seven change TYRE.muLatRear and it is entirely possible for two of them to cancel
 * out into the same car. So every model here is DRIVEN, by the real `Vehicle` class at the real
 * fixed 120 Hz, through six manoeuvres yielding TEN measurements, and the numbers are printed
 * side by side. Each column is documented at its own function below, along with what it got wrong
 * the first time — three of the ten were measuring something other than what they were named
 * after, and two of those reported the exact OPPOSITE of the truth.
 *
 * What the run prints, in order:
 *
 *   1. the ten-column table for one car (the Coupe by default — the operator's own GOOD-safe
 *      reference: "safe to drive, easy enough to drive, but it also takes a little bit of
 *      challenge").
 *   2. the drivetrain audit. The operator's rule is that slow must mean WORK, not waiting, so a
 *      model is allowed to make a car slower through grip or mass — both of which the hands feel —
 *      and is NOT allowed to do it by quietly turning the engine down. Every tier's peakTorque,
 *      ratios, finalDrive, topSpeed, cdA and wheelRadius is compared before and after each model.
 *   3. `stock` against the game with this module deleted, to twelve decimal places, on every car —
 *      and again after all six other models have dirtied the tables, which is what proves the
 *      restore.
 *   4. live switching: ONE Vehicle, never re-created, switched between models mid-corner through
 *      `setDrivingModel()` + `applyDrivingModel()` — the same two calls a menu makes. The car has
 *      to keep its position, heading and speed across every switch and still change character.
 *   5. the distinctness matrix over all 21 pairs.
 *   6. with `--all`, four cars under every model, to show a model shifts a row without reshuffling
 *      it — the garage still decides which car is which.
 *
 * Keyboard input, not analogue, for everything except the lateral-grip sweep. The operator plays
 * on a keyboard and half of what separates these models — STEER.buildBase, STEER.returnRate — only
 * exists on the digital path. The grip sweep uses analogue because it is asking about the tyre,
 * not about the hands.
 *
 * Exit code 0 only if all 21 pairs are distinct, no model touched a drivetrain, and stock is
 * still stock, and live switching carries the car's state — so this is usable as a gate, not just a
 * report.
 */

import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT, TIERS } from '../src/car/tuning.js';
import { FLEET, FLEET_BY_ID, applyCarFeel } from '../src/game/garage.js';
import { DRIVING_MODELS, restoreStockTuning, setDrivingModel, applyDrivingModel, currentDrivingModel } from '../src/car/drivingModels.js';

const G = 9.81;

/** A dead-flat, dead-grippy world, so the test measures the model and not the terrain. */
const FLAT = {
  // The normal matters: the solver resolves gravity onto it, so a stub without one makes every
  // number NaN. Real Terrain.surface() always returns one.
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};

const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: false };

/** A fresh car with `model` applied over `carEntry`. The order is the whole point — see drivingModels.js. */
function build(model, carEntry) {
  const feel = model.apply(carEntry);
  const car = new Vehicle({ tier: carEntry.tier, terrain: FLAT, preset: feel.assist });
  car.placeAt(0, 0, 0);
  return car;
}

/* THE TEST SPEEDS FOLLOW THE CAR, and they have to. The Scooter's top speed is 58 km/h, so the
 * first version of this tool asked it to spin up to 60 for the step-out and the braking runs, it
 * never got there, and five of its ten columns came back "—" for all seven models — a whole
 * vehicle that could not be judged. Every manoeuvre now runs at a fraction of the car's OWN top
 * speed, capped at the fixed figure so nothing changes for a car quick enough to reach it (the
 * Coupe tops out at 90 km/h, so 0.72 x 90 = 65 -> the fixed 50, exactly as before).
 *
 * This is safe to compare models against each other because NO model touches topSpeed — the
 * drivetrain audit further down proves that on every run — so all seven models of a given car are
 * measured at exactly the same speed. Across cars the speeds differ, which is why the headline
 * table is one car at a time. */
const refSpeed = (carEntry, want, frac) => Math.min(want, frac * (TIERS[carEntry.tier]?.topSpeed || want));

/** Hold a target speed with a crude cruise control — a fixed throttle decays through a corner. */
const holdSpeed = (car, kph) => (Math.abs(car.speed) * 3.6 < kph ? 0.85 : 0.06);

/** Spin up to a speed on the straight, then hand the car back. Bounded, so a tuning change cannot hang this. */
function spinTo(car, kph, cap = 60) {
  const IN = { ...NEUTRAL, throttle: 1 };
  let t = 0;
  while (car.kph < kph && t < cap) {
    car._step(PHYSICS_DT, IN);
    t += PHYSICS_DT;
  }
  return car.kph >= kph;
}

/* ── 1. 0-60 km/h ───────────────────────────────────────────────────────────── */
function zeroTo60(model, carEntry) {
  const car = build(model, carEntry);
  const IN = { ...NEUTRAL, throttle: 1 };
  let t = 0;
  while (t < 60) {
    car._step(PHYSICS_DT, IN);
    t += PHYSICS_DT;
    if (car.kph >= 60) return t;
  }
  return null; // some car/model pairs genuinely cannot reach 60 — the Scooter on Graft, say
}

/* ── 2. peak sustained lateral g ─────────────────────────────────────────────
 * Lifted deliberately from bench-car.mjs's own peak-lateral-grip test rather than reinvented, so
 * that a model's number here is directly comparable with the 0.95-1.55 g band that file already
 * enforces on the stock car. Sweep the steering, hold the speed, average a full second of the
 * rate at which the VELOCITY vector turns.
 *
 * `attack: true` — and this correction is the difference between measuring the TYRE and measuring
 * the STEERING LIMITER. STEER.comfortG caps full stick at whatever lock produces a comfortable
 * cornering force (tuning.js: "Full stick is a LATERAL ACCELERATION, not an angle"), so on the
 * first version of this test five of the seven models returned 0.87-0.89 g — not because their
 * tyres were the same but because the Coupe's comfortG of 9.2 m/s2 is 0.94 g and none of them was
 * allowed to ask for more. `attack` raises the ceiling to attackG (comfortG x 1.6), which is above
 * every model's grip, so the tyre becomes the constraint again and the column means what it says.
 * The steering limiter has its own column: `yaw`, below, is measured WITHOUT attack. */
function peakLatG(model, carEntry, kph = refSpeed(carEntry, 50, 0.72)) {
  const car = build(model, carEntry);
  let best = 0;
  for (let steer = 0.08; steer <= 1.0; steer += 0.04) {
    car.placeAt(0, 0, 0);
    car.vz = kph / 3.6;
    car.vx = 0;
    const IN = { ...NEUTRAL, steer, throttle: 0.3, analogue: true, attack: true };
    const tick = () => {
      IN.throttle = holdSpeed(car, kph);
      car._step(PHYSICS_DT, IN);
    };
    for (let i = 0; i < Math.round(2.5 / PHYSICS_DT); i++) tick();
    let sum = 0;
    const N = Math.round(1 / PHYSICS_DT);
    let prev = Math.atan2(car.vx, car.vz);
    for (let i = 0; i < N; i++) {
      tick();
      const h = Math.atan2(car.vx, car.vz);
      let d = h - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      prev = h;
      sum += (Math.abs(car.speed) * Math.abs(d / PHYSICS_DT)) / G;
    }
    best = Math.max(best, sum / N);
  }
  return best;
}

/* ── 3/4/5. steady yaw rate, steady sideslip, and the time to get there ──────
 * One run answers three questions: the steady yaw is the mean of the last 1.5 s, the steady
 * SIDESLIP is the mean of the same window, and the response time is the first moment the yaw
 * trace crosses 90% of its own steady value.
 *
 * Keyboard input and NO attack, because this is the column that is supposed to include the
 * steering limiter — `yaw` is what the car actually gives you for full stick at 50 km/h, which is
 * the thing a driver experiences, and STEER.comfortG is a legitimate part of a model's character.
 *
 * THE REAR AXLE'S OWN SLIP ANGLE, not the sideslip at the centre of gravity, and the difference
 * matters enough that the first version of this column reported the opposite of the truth.
 * beta_cg = b*r/v − alpha_rear, so a car with MORE rear grip — which needs LESS rear slip angle to
 * make the same force — ends up with a BIGGER positive sideslip at the CG. Measured on the
 * Pendulum model, whose whole claim is that the rear does not let go: alpha_rear 1.2° against
 * Stock's 3.0°, which is the claim being true, yet beta_cg 1.90° against Stock's 0.54°, which
 * reads as the claim being false. The rear slip angle is what "the back is sliding" actually means
 * and it is what `vehicle.js` itself feeds the tyre curve, so it is what is reported.
 *
 * It is not the same question as the step-out provocation below: this is how much the back is
 * moving while merely CORNERING, unprovoked. */
function turnTrace(model, carEntry, kph = refSpeed(carEntry, 50, 0.72)) {
  const car = build(model, carEntry);
  if (!spinTo(car, kph)) return { yaw: 0, resp: null, beta: null };
  const IN = { ...NEUTRAL, steer: 1, throttle: 0.3 };
  const trace = [];
  const slips = [];
  const N = Math.round(6 / PHYSICS_DT);
  for (let i = 0; i < N; i++) {
    IN.throttle = holdSpeed(car, kph);
    car._step(PHYSICS_DT, IN);
    trace.push(Math.abs(car.yawRate));
    slips.push(Math.abs(car.wheels[2].slipAngle));
  }
  const win = Math.round(1.5 / PHYSICS_DT);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const steady = mean(trace.slice(-win));
  const beta = mean(slips.slice(-win));
  let resp = null;
  for (let i = 0; i < trace.length; i++) {
    if (trace[i] >= steady * 0.9) {
      resp = i * PHYSICS_DT;
      break;
    }
  }
  return { yaw: (steady * 180) / Math.PI, resp, beta: (beta * 180) / Math.PI };
}

/* ── 6. how far the rear steps out ───────────────────────────────────────────
 * The same provocation for every model, and it is a driving manoeuvre rather than a teleport:
 * turn in hard at 60 km/h, LIFT OFF (which on the models that keep TDU1's lift-off drop is itself
 * a steering input), pull the handbrake for half a second, then pick the throttle back up on an
 * unloaded rear axle. Peak |sideslip| over the whole four seconds, in degrees.
 *
 * The handbrake pulse was added after the first version of this test read 1.1° for Stock and 0.9°
 * for Weight — a lift-off alone is simply not enough provocation to tell a planted car from a
 * very planted one, and a column where five of seven models sit within a degree of each other is
 * a column that is measuring nothing. It is the same pulse for every model, so it flatters none
 * of them: what differs afterwards is entirely how much rear the model has and how hard the yaw
 * damping and the aids fight to get it back.
 *
 * No counter-steer from the driver at all. This measures what the CAR does when provoked, not
 * whether a scripted driver can save it; bench-car.mjs's slide-catch test already measures the
 * saving, and mixing the two would let a good assist hide a loose rear. */
function stepOut(model, carEntry, kph = refSpeed(carEntry, 60, 0.8)) {
  const car = build(model, carEntry);
  if (!spinTo(car, kph)) return 0;
  const IN = { ...NEUTRAL, steer: 1, throttle: 0.9 };
  let worst = 0;
  const N = Math.round(4 / PHYSICS_DT);
  for (let i = 0; i < N; i++) {
    const t = i * PHYSICS_DT;
    IN.throttle = t > 1.0 && t < 1.9 ? 0 : 0.9; // turn in, lift, then back on the power
    IN.handbrake = t > 1.15 && t < 1.65 ? 1 : 0; // ... and one honest yank, the same for everyone
    car._step(PHYSICS_DT, IN);
    worst = Math.max(worst, Math.abs(car.slip));
  }
  return (worst * 180) / Math.PI;
}

/* ── 7/8. the work, and whether the work bought anything ─────────────────────
 * Operator: "Some are just slow, but don't feel like they take a lot of effort... when you drive
 * a junk car, it feels like it's a lot of work. Even at the slow speed."
 *
 * Work is not lap time and it is not grip. It is how much the driver's HANDS have to move, and
 * whether moving them achieves anything. So: one fixed task — follow a 3.2 m / 60 m slalom at
 * 55 km/h for sixteen seconds — driven by ONE driver used for all seven models, and two numbers
 * come out:
 *
 *   work   total travel of the virtual wheel, in whole turns of lock. A car that tracks moves the
 *          wheel once per curve; a car that pushes then snaps has the driver sawing throughout.
 *   path   RMS distance from the line the driver was aiming at, in metres. Work with a big path
 *          error is a car fighting you; work with a small one is a car that simply asks to be
 *          driven. That is exactly the distinction between "junk" and "challenging", and the two
 *          columns together are what say which of the two a model is.
 *
 * THE DRIVER IS RATE-LIMITED, at 5 units of stick a second — full lock in a fifth of a second,
 * about as fast as a human moves. The first version of this test had no limit and the Kart model
 * scored 215 turns against everyone else's 0.4: with STEER.buildBase at 9 the wheel could follow a
 * bang-bang controller exactly, so the number was measuring the CONTROLLER oscillating, not the
 * car. A driver who cannot move faster than a person can move is the honest rig, and it is the
 * same rig for all seven.
 *
 * Pure pursuit rather than a yaw-rate controller, for the same reason: yaw rate is an output the
 * fast-responding models can chase into a limit cycle, whereas a look-ahead point on a path is
 * what a driver actually aims at.
 *
 * THE SLALOM HAS TO ACTUALLY DEMAND SOMETHING, and the first version did not. A 3 m amplitude over
 * a 70 m wavelength at 45 km/h asks for A x (2*pi*v/L)^2 = 3.8 m/s2 of lateral acceleration, which
 * is 0.39 g — a third of what the worst model here can produce. So it measured only steering
 * SPEED, and it produced the exactly backwards result that Graft (slower hands, by design) did
 * LESS work than Stock while tracking BETTER. 3.2 m over 60 m at 55 km/h asks 8.2 m/s2, 0.84 g,
 * which is inside a good model's envelope and right on the edge of a bad one's. Now the column
 * measures what it is named after. */
function slalom(model, carEntry, kph = refSpeed(carEntry, 55, 0.75), amp = 3.2, wave = 60, look = 9) {
  const car = build(model, carEntry);
  if (!spinTo(car, kph)) return { turns: null, path: null };
  const pathAt = (z) => amp * Math.sin((2 * Math.PI * z) / wave);
  const IN = { ...NEUTRAL, throttle: 0.3 };
  const RATE = 5 * PHYSICS_DT; // the driver's own hands, not the car's steering rack
  let cmd = 0;
  let moved = 0;
  let sq = 0;
  const N = Math.round(16 / PHYSICS_DT);
  for (let i = 0; i < N; i++) {
    // aim at a point `look` metres up the road, in the solver's own body frame (+Z forward, +X right)
    const zl = car.z + look;
    const dx = pathAt(zl) - car.x;
    const dz = zl - car.z;
    const cy = Math.cos(car.yaw);
    const sy = Math.sin(car.yaw);
    const bz = dz * cy + dx * sy;
    const bx = dx * cy - dz * sy;
    const want = Math.max(-1, Math.min(1, Math.atan2(bx, Math.max(bz, 1)) * 2.6));
    const step = Math.max(-RATE, Math.min(RATE, want - cmd));
    cmd += step;
    moved += Math.abs(step);
    IN.steer = cmd;
    IN.throttle = holdSpeed(car, kph);
    car._step(PHYSICS_DT, IN);
    const e = car.x - pathAt(car.z);
    sq += e * e;
  }
  return { turns: moved, path: Math.sqrt(sq / N) };
}

/* ── 9/10. 60-0 km/h, and the weight that moves onto the nose doing it ───────
 * One stop, two numbers, because the second one is the whole subject of two of the seven models
 * and no other column in this table can see it.
 *
 * `xfer` is the peak FRONT-AXLE load during the stop as a multiple of the same axle's load while
 * cruising — read straight off `car.wheels[0..1].load`, which vehicle.js publishes, rather than
 * inferred. The solver's longitudinal transfer is W * (cgHeight / wheelbase) * loadLong, so this
 * is a direct read of the one number `weight` raises (cgHeight x1.38) and `pendulum` all but
 * deletes (x0.2, the Unity centre-of-mass trick). Without this column those two models are
 * separated only by side effects; with it, the thing they are actually FOR is on the table.
 *
 * The baseline is taken while cruising rather than at rest so that any downforce a model carries
 * is already in both halves of the ratio and therefore cancels — this measures transfer, not aero. */
function brake60(model, carEntry, kph = refSpeed(carEntry, 60, 0.8)) {
  const car = build(model, carEntry);
  if (!spinTo(car, kph)) return { stop: null, xfer: null };
  const front = () => car.wheels[0].load + car.wheels[1].load;
  // a beat of steady cruise first, so the baseline is a settled number and not a launch squat
  const CRUISE = { ...NEUTRAL, throttle: 0.06 };
  for (let i = 0; i < Math.round(0.6 / PHYSICS_DT); i++) car._step(PHYSICS_DT, CRUISE);
  const base = front();
  const x0 = car.z;
  const z0 = car.x;
  const IN = { ...NEUTRAL, brake: 1 };
  let t = 0;
  let peak = base;
  while (car.kph > 1 && t < 20) {
    car._step(PHYSICS_DT, IN);
    t += PHYSICS_DT;
    if (car.kph > 5) peak = Math.max(peak, front()); // the last 5 km/h is the car settling, not braking
  }
  /* Scaled to a 60 km/h basis by v^2, the same trick bench-car.mjs uses to compare an 80 km/h stop
   * with its own 100 km/h target, so the column still means "60-0" on a car that had to be tested
   * from 46 km/h because that is all it has. */
  const dist = Math.hypot(car.z - x0, car.x - z0) * (60 / kph) ** 2;
  return { stop: dist, xfer: base > 1 ? peak / base : null };
}

/* ── "slow must mean WORK, not waiting" ──────────────────────────────────────
 * A machine check on the operator's own rule, not a comment claiming it. Snapshot every number in
 * the drivetrain before a model is applied and after, and report whether any of them moved. A
 * model that made the car slower while these are byte-identical is slower because of GRIP, which
 * the driver feels through the wheel; one that trimmed peakTorque is slower because it was turned
 * down, which they cannot feel and which the operator has already rejected once by name. */
const ENGINE_KEYS = ['peakTorque', 'redline', 'finalDrive', 'topSpeed', 'cdA', 'wheelRadius'];
function engineTouched(model, carEntry) {
  restoreStockTuning();
  const before = {};
  for (const t of Object.keys(TIERS)) {
    before[t] = ENGINE_KEYS.map((k) => TIERS[t][k]).concat(TIERS[t].ratios);
  }
  model.apply(carEntry);
  const changed = [];
  for (const t of Object.keys(TIERS)) {
    const after = ENGINE_KEYS.map((k) => TIERS[t][k]).concat(TIERS[t].ratios);
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== before[t][i]) changed.push(`${t}.${ENGINE_KEYS[i] ?? 'ratios'}`);
    }
  }
  return changed;
}

/* ── the run ────────────────────────────────────────────────────────────────── */

function measure(model, carEntry) {
  const t60 = zeroTo60(model, carEntry);
  const lat = peakLatG(model, carEntry);
  const turn = turnTrace(model, carEntry);
  const slip = stepOut(model, carEntry);
  const sl = slalom(model, carEntry);
  const br = brake60(model, carEntry);
  return { t60, lat, yaw: turn.yaw, beta: turn.beta, resp: turn.resp, slip, work: sl.turns, path: sl.path, stop: br.stop, xfer: br.xfer };
}

const n = (v, d = 2, dash = '—') => (v == null || !Number.isFinite(v) ? dash : v.toFixed(d));

const argv = process.argv.slice(2);
const carId = argv.find((a) => !a.startsWith('--')) || 'coupe';
const CAR = FLEET_BY_ID[carId];
if (!CAR) {
  console.error(`no such car: ${carId}. Try one of: ${FLEET.map((c) => c.id).join(', ')}`);
  process.exit(2);
}

console.log(`\n══ SEVEN DRIVING MODELS ═══════════════════════════════════════════════════════════════`);
console.log(`   reference car: ${CAR.label} (${CAR.id}, tier ${CAR.tier})   —   flat tarmac, keyboard input\n`);

let stockBroken = false;
const rows = [];
for (const m of DRIVING_MODELS) rows.push({ m, r: measure(m, CAR) });

const HEAD = ['model', '0-60 s', 'lat g', 'yaw °/s', 'rear °', 'slip °', 'resp s', 'work', 'path m', '60-0 m', 'xfer x'];
const W = [12, 8, 7, 9, 8, 8, 8, 7, 8, 8, 8];
const line = (cells) => cells.map((c, i) => String(c).padStart(W[i] ?? 8)).join(' ');
console.log(line(HEAD));
console.log(W.map((w) => '─'.repeat(w)).join(' '));
for (const { m, r } of rows) {
  console.log(
    line([m.label, n(r.t60), n(r.lat), n(r.yaw, 1), n(r.beta, 2), n(r.slip, 1), n(r.resp), n(r.work, 1), n(r.path), n(r.stop, 1), n(r.xfer)])
  );
}

console.log('\n   0-60  full throttle from rest, seconds');
console.log('   lat g peak SUSTAINED lateral g, steering sweep at 50 km/h with the limiter raised');
console.log('   yaw   deg/s held at 50 km/h on full keyboard lock — the limiter IS included here');
console.log('   rear  steady REAR-AXLE slip angle in that same turn: how much the back moves, unprovoked');
console.log('   slip  peak sideslip through the shared provocation (turn in, lift, handbrake, power)');
console.log('   resp  seconds to 90% of that model\'s own steady yaw after a step input');
console.log('   work  turns of lock the driver moves through a 16 s 0.84 g slalom — the "effort" number');
console.log('   path  RMS metres off the line he was aiming at during it — what the effort bought');
console.log('   60-0  metres, with the model\'s own brakes and its own ABS setting');
console.log('   xfer  peak front-axle load under that stop, as a multiple of its cruising load\n');

/* ── the engine-untouched audit ─────────────────────────────────────────────── */
console.log('── "slow must mean WORK, not waiting" ─────────────────────────────────────────────────');
let cheated = 0;
for (const m of DRIVING_MODELS) {
  const touched = engineTouched(m, CAR);
  if (touched.length) cheated++;
  console.log(`   ${m.label.padEnd(12)} drivetrain ${touched.length ? `CHANGED: ${[...new Set(touched)].join(', ')}` : 'untouched  (torque, gearing, top speed, drag all stock)'}`);
}

/* ── nothing is lost: `stock` must be the unmodified game ────────────────────
 * Model 1 exists so the feel the operator already approved of survives the other six being judged
 * against it, and "it changes nothing" is a claim, not a fact, until it is checked. So: drive the
 * SAME eight-second input trace on every car in the fleet twice — once through plain
 * `applyCarFeel()`, the path the game takes today, and once through `DRIVING_MODELS[0].apply()` —
 * and compare position, heading, yaw rate, speed, sideslip and roll to twelve decimal places.
 *
 * The second half of the check is the one that actually earns its keep: it re-runs the comparison
 * AFTER all six other models have been through the tuning tables. That is what proves the stock
 * snapshot and `restoreStockTuning()` really do put everything back, rather than leaving, say,
 * TYRE.muLongPeak on Graft's 0.64 for the rest of the session. */
console.log('\n── nothing is lost: `stock` against the game without this module ──────────────────────');
{
  const IN = { steer: 0.6, throttle: 0.85, brake: 0, handbrake: 0, analogue: false };
  const trace = (apply, id) => {
    const entry = FLEET_BY_ID[id];
    const feel = apply(entry);
    const car = new Vehicle({ tier: entry.tier, terrain: FLAT, preset: feel.assist });
    car.placeAt(0, 0, 0);
    const out = [];
    for (let i = 0; i < 120 * 8; i++) {
      car._step(PHYSICS_DT, IN);
      if (i % 60 === 0) out.push([car.x, car.z, car.yaw, car.yawRate, car.speed, car.slip, car.roll].map((v) => v.toFixed(12)).join(','));
    }
    return out.join('|');
  };
  /* THE BASELINE HAS TO START FROM A CLEAN TABLE, and getting that wrong is how this check first
   * reported a failure that was not there. By the time this block runs, `measure()` and the
   * drivetrain audit above have already applied all seven models, so the tables are carrying
   * whichever one went last — and `applyCarFeel()` alone does NOT put them back, because it only
   * rewrites the six fields a car declares. Comparing against that is comparing against some other
   * model's car. The symptom was diagnostic in itself: exactly ONE car failed, the first in the
   * fleet, because from the second iteration onwards the previous `stock.apply()` had already
   * cleaned up. `restoreStockTuning()` first is what a freshly loaded game actually looks like. */
  const plain = (id) => {
    restoreStockTuning();
    return trace(applyCarFeel, id);
  };
  let same = 0;
  for (const c of FLEET) {
    if (trace((e) => DRIVING_MODELS[0].apply(e), c.id) === plain(c.id)) same++;
    else console.log(`   ${c.label.padEnd(10)} DIFFERS — stock is not stock`);
  }
  const wantCoupe = plain('coupe');
  for (const m of DRIVING_MODELS) m.apply(FLEET_BY_ID.patrol); // dirty every table, then check again
  const restored = trace((e) => DRIVING_MODELS[0].apply(e), 'coupe') === wantCoupe;
  if (!restored) console.log('   the tuning tables are NOT restored between models');
  console.log(
    `   ${same}/${FLEET.length} cars identical to 12 decimal places over an 8 s trace` +
      `, and still identical after all six other models have run: ${restored ? 'yes' : 'NO'}`
  );
  if (same !== FLEET.length || !restored) stockBroken = true;
}

/* ── it has to APPLY LIVE, on the car being driven, without a reload ─────────
 * The requirement in the operator's own framing is that he picks the one that works best, which
 * means switching between them back to back on the same drive — reloading the page between two
 * models makes them impossible to compare, because he would be comparing a memory.
 *
 * So this drives ONE `Vehicle`, never re-created, holding a constant steering input at a constant
 * speed, and calls `applyDrivingModel()` on it mid-corner. If the module is honest the yaw rate
 * moves to the new model's number within a few tenths and the car keeps its position, heading and
 * speed across the switch — a swap, not a teleport. `setDrivingModel` is used exactly the way a
 * menu would use it, so this is the integration path and not a private back door. */
console.log('\n── live switching, mid-corner, on one Vehicle that is never re-created ─────────────────');
{
  const kph = refSpeed(CAR, 50, 0.72);
  restoreStockTuning();
  setDrivingModel('stock');
  const feel = applyDrivingModel(CAR);
  const car = new Vehicle({ tier: CAR.tier, terrain: FLAT, preset: feel.assist });
  car.placeAt(0, 0, 0);
  spinTo(car, kph);
  const IN = { ...NEUTRAL, steer: 1, throttle: 0.3 };
  const settle = (secs) => {
    for (let i = 0; i < Math.round(secs / PHYSICS_DT); i++) {
      IN.throttle = holdSpeed(car, kph);
      car._step(PHYSICS_DT, IN);
    }
    return (Math.abs(car.yawRate) * 180) / Math.PI;
  };
  const yawOf = new Map(rows.map(({ m, r }) => [m.id, r.yaw]));
  let moved = 0;
  let jumped = 0;
  let prevYaw = null;
  let lastStock = null;
  for (const id of ['stock', 'kart', 'tailhappy', 'graft', 'pendulum', 'stock']) {
    const before = { x: car.x, z: car.z, yaw: car.yaw, kph: car.kph };
    setDrivingModel(id);
    applyDrivingModel(CAR, car); // ← the one call the game makes. No reload, no new Vehicle.
    const jump = Math.hypot(car.x - before.x, car.z - before.z) + Math.abs(car.yaw - before.yaw) + Math.abs(car.kph - before.kph);
    if (jump > 1e-9) jumped++;
    const got = settle(3);
    if (prevYaw !== null && Math.abs(got - prevYaw) / Math.max(got, prevYaw) > 0.05) moved++;
    prevYaw = got;
    lastStock = id === 'stock' ? got : lastStock;
    console.log(
      `   -> ${currentDrivingModel().label.padEnd(11)} yaw settles ${got.toFixed(1).padStart(5)} °/s ` +
        `(from rest this model measures ${yawOf.get(id).toFixed(1)})   state across the switch: ` +
        `${jump < 1e-9 ? 'carried exactly' : `MOVED ${jump.toExponential(1)}`}`
    );
  }
  /* TAIL-HAPPY SETTLES ABOVE ITS OWN TABLE NUMBER HERE (62 °/s against 47), and that is the
   * physics being right rather than the switch being wrong. The table spins each model up in a
   * straight line and THEN applies lock; this hands the model a corner that is already in
   * progress, with a car already carrying the previous model's yaw and sideslip. A model whose
   * whole character is a low drift-yaw damping and a rear that lets go will settle into a bigger
   * held slide from that entry than from a clean one — the operator's "its back end swings out a
   * lot" doing exactly what it says. So the assertions are the ones that cannot be explained away:
   * every switch carries the car's state EXACTLY (no teleport, no lost speed), every switch
   * measurably changes how the car behaves, and coming back to `stock` after four other models
   * have been through the tables live reproduces stock's own from-rest number. */
  const backToStock = lastStock != null && Math.abs(lastStock - yawOf.get('stock')) <= 1.0;
  const ok = jumped === 0 && moved >= 4 && backToStock;
  console.log(
    `   ${jumped} of 6 switches disturbed the car's state, ${moved} of 5 changed how it behaves, ` +
      `and returning to stock reproduces its own ${yawOf.get('stock').toFixed(1)} °/s: ${backToStock ? 'yes' : 'NO'}`
  );
  console.log(`   ${ok ? 'live switching works — one Vehicle, seven characters, no reload.' : 'LIVE SWITCHING IS BROKEN'}`);
  if (!ok) stockBroken = true;
}

/* ── the distinctness matrix ────────────────────────────────────────────────────
 * "If two models measure the same, they are not distinct." So state what "the same" means and
 * then check it: two models are DISTINCT if at least three of the TEN measurements differ by
 * more than 12%, or if any single one differs by more than 40%. Three-of-ten rather than
 * one-of-ten because a single column can be moved by accident — a model that is only quicker to
 * 60 is a faster version of the same car, not a different way of driving. 12% is well clear of
 * this harness's own repeatability: the solver is deterministic and re-running any row reproduces
 * it to the last printed digit, so any spread at all is real. */
const METRICS = ['t60', 'lat', 'yaw', 'beta', 'slip', 'resp', 'work', 'path', 'stop', 'xfer'];
function compare(a, b) {
  let over12 = 0;
  let worst = 0;
  for (const k of METRICS) {
    const x = a[k];
    const y = b[k];
    const xOk = x != null && Number.isFinite(x);
    const yOk = y != null && Number.isFinite(y);
    /* BOTH missing is not a difference. Counting a shared "—" as a separation is how a genuine
     * clash hides: on the Scooter, where no model can reach 60 km/h, a naive version scored every
     * pair as differing on that column and would have passed two identical models. */
    if (!xOk && !yOk) continue;
    if (!xOk || !yOk) {
      over12++; // one of them cannot do the manoeuvre at all, which is the largest difference there is
      worst = 1;
      continue;
    }
    const d = Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), 1e-9);
    if (d > 0.12) over12++;
    worst = Math.max(worst, d);
  }
  return { over12, worst, ok: over12 >= 3 || worst > 0.4 };
}

console.log('\n── distinctness: how many of the ten measurements separate each pair by >12% ─────────');
console.log(line(['', ...DRIVING_MODELS.map((m) => m.label.slice(0, 7))]));
let clashes = 0;
for (let i = 0; i < rows.length; i++) {
  const cells = [DRIVING_MODELS[i].label];
  for (let j = 0; j < rows.length; j++) {
    if (i === j) {
      cells.push('·');
      continue;
    }
    const c = compare(rows[i].r, rows[j].r);
    if (i < j && !c.ok) clashes++;
    cells.push(`${c.over12}/10${c.ok ? '' : '!'}`);
  }
  console.log(line(cells));
}
console.log(`\n   a pair is DISTINCT at >=3 of 10 columns apart by >12%, or any one column apart by >40%.`);
console.log(`   ${clashes === 0 ? 'every one of the 21 pairs is distinct.' : `${clashes} PAIR(S) TOO ALIKE — marked with ! above.`}`);

/* ── composition: the model is a modifier, the car keeps its identity ─────────
 * The other half of the brief — "Composes WITH the per-car feel already in garage.js". The proof
 * is an ORDER that survives: whatever the model, the Estate must still be softer than the Sedan
 * and the Patrol must still stop harder than the Scooter, because those are the garage's
 * decisions and a driving model is not allowed to overrule them. */
if (argv.includes('--all')) {
  console.log('\n── composition: four cars under every model (peak lateral g / 60-0 m) ─────────────────');
  const CARS = ['estate', 'coupe', 'sedan', 'patrol'].map((id) => FLEET_BY_ID[id]);
  console.log(line(['model', ...CARS.map((c) => c.label.slice(0, 8))]));
  for (const m of DRIVING_MODELS) {
    const cells = [m.label];
    for (const c of CARS) cells.push(`${n(peakLatG(m, c), 2)}/${n(brake60(m, c).stop, 0)}`);
    console.log(line(cells));
  }
  console.log('\n   the ORDER across each row is the garage still speaking: a model shifts the whole row,');
  console.log('   it does not reshuffle it.\n');
}

restoreStockTuning();
process.exit(clashes === 0 && cheated === 0 && !stockBroken ? 0 : 1);
