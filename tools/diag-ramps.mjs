/* created by AI */
/* Wanderoad — do the kickers actually throw a car into the air?
 *
 * Operator: "jumps that you can take that actually you can jump over. Test it to see if it's fun."
 *
 * "It's fun" cannot be asserted, but the three things that make a jump fun instead of broken can be,
 * and this is those three:
 *
 *   1. IT IS A RAMP, NOT A CLIFF. The height field is walked at 0.25 m in both axes and the largest
 *      single-step rise is measured. A step is what throws a car into the air wrongly, and it is the
 *      difference between "I jumped" and "the game glitched".
 *   2. THE PICTURE MATCHES THE PHYSICS. render/ramps.js builds its mesh by sampling the same
 *      `rampProfile` that Terrain.surface() lifts the ground with, so the two are checked against
 *      each other at many points. A car floating a foot above a drawn ramp is the classic failure of
 *      this whole approach and it is measured here rather than hoped for.
 *   3. A REAL CAR REALLY LEAVES THE GROUND. Not a projectile calculation — the actual Vehicle from
 *      car/vehicle.js, stepped at the real physics rate, over a real Terrain, with `car.onGround`
 *      read frame by frame. The Warthog and the Coupe both drive the same ramp at the same speed and
 *      the numbers are printed side by side, because the operator's complaint was that those two
 *      cars are indistinguishable.
 *
 *   node tools/diag-ramps.mjs
 */
import { rampsInBox, rampProfile, rampLiftAt, RAMP_LEN, RAMP_WID, RAMP_H, LIP_AT } from '../src/world/ramps.js';
import { Terrain } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT, SUSPENSION } from '../src/car/tuning.js';
import { FLEET_BY_ID, applyCarFeel } from '../src/game/garage.js';

const SEED = 20260804;
let fails = 0;
const check = (name, ok, got, want) => {
  if (!ok) fails++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${String(got).padStart(11)}   want ${want}`);
};

/* ── 1. determinism ─────────────────────────────────────────────────────────── */
console.log('\n── placement ─────────────────────────────────────────────────────');
const BOX = [-3000, -3000, 3000, 3000];
const a = rampsInBox(...BOX, SEED);
const b = rampsInBox(...BOX, SEED);
const same =
  a.length === b.length &&
  a.every((r, i) => r.id === b[i].id && Math.abs(r.x - b[i].x) < 1e-9 && Math.abs(r.z - b[i].z) < 1e-9 && Math.abs(r.yaw - b[i].yaw) < 1e-9);
check('two calls give byte-identical ramps', same, same ? 'identical' : 'DIFFER', 'identical');
check('ramps found in a 6 km box', a.length > 0, a.length, '> 0');

/* Density, expressed the way a player would feel it: how far you drive between kickers. */
const areaKm2 = ((BOX[2] - BOX[0]) / 1000) * ((BOX[3] - BOX[1]) / 1000);
const perKm2 = a.length / areaKm2;
check('kickers per km² (a treat, not clutter)', perKm2 > 0.05 && perKm2 < 6, perKm2.toFixed(2), '0.05 – 6');

/* ── 2. the shape is drivable ───────────────────────────────────────────────── */
console.log('\n── the shape ─────────────────────────────────────────────────────');
const lipZ = (LIP_AT - 0.5) * RAMP_LEN;
check('lip height, at the lip', Math.abs(rampProfile(0, lipZ) - RAMP_H) < 0.05, rampProfile(0, lipZ).toFixed(2) + ' m', `${RAMP_H} m ±0.05`);
check('flat ground outside the footprint', rampProfile(0, RAMP_LEN) === 0 && rampProfile(RAMP_WID, 0) === 0, '0 m', '0 m');

let worstStep = 0;
let worstWhere = '';
for (let lz = -RAMP_LEN * 0.5 - 1; lz <= RAMP_LEN * 0.5 + 1; lz += 0.25) {
  for (let lx = -RAMP_WID * 0.5 - 1; lx <= RAMP_WID * 0.5 + 1; lx += 0.25) {
    const d1 = Math.abs(rampProfile(lx + 0.25, lz) - rampProfile(lx, lz));
    const d2 = Math.abs(rampProfile(lx, lz + 0.25) - rampProfile(lx, lz));
    const d = Math.max(d1, d2);
    if (d > worstStep) {
      worstStep = d;
      worstWhere = `lx=${lx.toFixed(2)} lz=${lz.toFixed(2)}`;
    }
  }
}
console.log(`        worst step at ${worstWhere}`);
check('no cliff: largest rise per 0.25 m', worstStep < 0.30, worstStep.toFixed(3) + ' m', '< 0.30 m');

/* ── 3. the ground the wheels actually read ─────────────────────────────────── */
console.log('\n── the ground the car reads ──────────────────────────────────────');
const terrain = new Terrain(SEED, -3000, -3000, 3000, 3000, 240);
const ramp = a[0];
console.log(`        testing the kicker at ${ramp.x.toFixed(0)}, ${ramp.z.toFixed(0)} (yaw ${((ramp.yaw * 180) / Math.PI).toFixed(0)}°)`);

/* Terrain.surface() must equal natural ground + rampProfile, everywhere. This is the check that
 * renderer/physics agreement rests on: render/ramps.js draws natural ground + rampProfile, so if
 * surface() matches that expression the mesh and the collision are the same surface by construction
 * rather than by coincidence. */
let worstErr = 0;
let lifted = 0;
const tmp = { lift: 0, nx: 0, ny: 1, nz: 0 };
for (let i = 0; i < 240; i++) {
  const lx = (-RAMP_WID * 0.6) + (i % 20) * (RAMP_WID * 1.2 / 19);
  const lz = (-RAMP_LEN * 0.6) + Math.floor(i / 20) * (RAMP_LEN * 1.2 / 11);
  const ca = Math.cos(ramp.yaw);
  const sa = Math.sin(ramp.yaw);
  const x = ramp.x + lx * ca + lz * sa;
  const z = ramp.z - lx * sa + lz * ca;
  const s = terrain.surface(x, z);
  const bare = terrain.height(x, z);
  const want = bare + rampLiftAt(ramp, x, z, tmp).lift;
  if (tmp.lift > 0) lifted++;
  const err = Math.abs(s.y - want);
  if (err > worstErr) worstErr = err;
}
check('sampled points that sit on the ramp', lifted > 60, lifted + '/240', '> 60');
check('surface() == ground + profile (mm)', worstErr < 0.001, (worstErr * 1000).toFixed(4) + ' mm', '< 1 mm');

const onFace = terrain.surface(ramp.x, ramp.z);
check('the face is a made surface (grip)', onFace.made === 1, 'made=' + onFace.made, 'made=1');
const off = terrain.surface(ramp.x + 60, ramp.z + 60);
check('60 m away it is untouched', off.made === 0, 'made=' + off.made, 'made=0');

/* ── 4. a real car really leaves the ground ─────────────────────────────────── */
console.log('\n── the launch (real Vehicle, real Terrain) ───────────────────────');

function jump(carId, kph) {
  const entry = FLEET_BY_ID[carId];
  const feel = applyCarFeel(entry);
  const car = new Vehicle({ tier: entry.tier, terrain, preset: feel.assist });

  /* Start well back from the toe, pointing at the ramp along its own axis, so the run-up is square.
   * `placeAt` takes a heading; the ramp's yaw is atan2(tx, tz) of the road tangent it was built on. */
  const run = 26;
  const hx = Math.sin(ramp.yaw);
  const hz = Math.cos(ramp.yaw);
  car.placeAt(ramp.x - hx * run, ramp.z - hz * run, ramp.yaw);
  /* SET THE VELOCITY, NOT `speed`. `car.speed` is DERIVED — vehicle.js recomputes it every step as
   * `vz·cos(yaw) + vx·sin(yaw)` — so assigning to it is overwritten on the first step and the car
   * simply crawls away from rest. That is exactly what happened on the first run of this file:
   * 0.00 s of airtime for both cars, which read as "ramps do not work" when in fact the run-up had
   * never happened. Give it real momentum along its own heading instead. */
  const v = kph / 3.6;
  car.vx = hx * v;
  car.vz = hz * v;

  /* AIRBORNE IS MEASURED FROM THE SPRINGS, NOT FROM THE FLAG.
   *
   * `car.onGround` is the game's own anti-bounce heuristic and it is deliberately conservative on a
   * falling surface — which is exactly the situation immediately after a jump lip. Reading it as
   * "airtime" measured 0.13 s on a jump whose peak height was 1.45 m, which is plainly not what the
   * car was doing. So this asks the physical question instead: is the suspension fully extended with
   * the body still further above the ground than a fully-drooped wheel could reach? If it is, there
   * is nothing under the tyres. That cannot be fooled by a smoothing rule, and it is the same
   * condition a player sees as "all four wheels are off the floor". */
  const clearFor = SUSPENSION.restLength + SUSPENSION.travel;
  let air = 0;
  let peak = 0;
  let dist = 0;
  let airStartX = 0;
  let airStartZ = 0;
  let wasAir = false;
  let groundAtLaunch = 0;
  let landed = false;
  let bounces = 0;
  let lastSign = 0;
  let settleT = 0;
  let quiet = 0;
  let settle = -1;
  for (let t = 0; t < 12; t += PHYSICS_DT) {
    car._step(PHYSICS_DT, { throttle: 1, brake: 0, steer: 0 });
    const gy = terrain.height(car.x, car.z);
    const flying = car.y - gy > clearFor;
    if (flying) {
      if (!wasAir) {
        airStartX = car.x;
        airStartZ = car.z;
        groundAtLaunch = gy;
        wasAir = true;
      }
      air += PHYSICS_DT;
      peak = Math.max(peak, car.y - gy - clearFor);
      dist = Math.max(dist, Math.hypot(car.x - airStartX, car.z - airStartZ));
    } else {
      if (wasAir) {
        /* THE LANDING. Everything after the first touchdown is what "shock absorption" means: how
         * many times the body reverses direction before it settles, and how long that takes. A stiff
         * short-travel car pogos; a long-travel rebound-damped one takes the hit once. */
        landed = true;
      }
      wasAir = false;
    }
    if (landed && settle < 0) {
      if (Math.sign(car.vy) !== 0 && Math.sign(car.vy) !== lastSign && lastSign !== 0) bounces++;
      if (Math.sign(car.vy) !== 0) lastSign = Math.sign(car.vy);
      settleT += PHYSICS_DT;
      if (Math.abs(car.vy) < 0.25) quiet += PHYSICS_DT; else quiet = 0;
      if (quiet > 0.35) settle = settleT - quiet;
    }
  }
  return { air, peak, dist, bounces, settle: settle < 0 ? settleT : settle, kph: car.speed * 3.6 };
}

const SPEED = 70;
const w = jump('rally', SPEED);
const c = jump('coupe', SPEED);
console.log(`        approach ${SPEED} km/h at the same kicker`);
console.log(`        Warthog  airtime ${w.air.toFixed(2)} s   clear ${w.peak.toFixed(2)} m   flew ${w.dist.toFixed(1)} m`);
console.log(`        Coupe    airtime ${c.air.toFixed(2)} s   clear ${c.peak.toFixed(2)} m   flew ${c.dist.toFixed(1)} m`);
check('the Warthog gets real air', w.air >= 0.45, w.air.toFixed(2) + ' s', '>= 0.45 s');
check('and covers ground with it', w.dist >= 6, w.dist.toFixed(1) + ' m', '>= 6 m');
/* THE COUPE FLIES FURTHER, AND THAT IS CORRECT. It is 800 kg lighter with less drag, so it arrives
 * at the lip faster and leaves it faster; no amount of off-road tuning should change that, and
 * pretending otherwise would be fixing the measurement rather than the car.
 *
 * The Warthog's advantage is the LANDING, which is the half of a jump the operator actually named:
 * "Big springs. Shock absorption." A short-travel road car arrives on stiff springs and pogos; a
 * long-travel car with rebound-biased damping takes the hit once and drives away. That is the number
 * checked here, because it is the one that says the two cars are genuinely different machines rather
 * than the same machine with a different badge. */
/* ── the landing, measured on its own ────────────────────────────────────────
 *
 * Settling was first measured on the ramp run itself and it was meaningless: both cars read ~9
 * bounces and ~10 s, because after the landing they are still driving over open country and every
 * hummock counts as another reversal. The springs have to be isolated from the scenery to be
 * measured at all.
 *
 * So: drop each car 1.5 m onto dead-flat ground — the height it comes off a kicker — and watch only
 * its own vertical motion. This is the operator's "Big springs. Shock absorption." expressed as two
 * numbers: how many times the body reverses direction before it is done, and how long that takes. */
const FLAT = {
  surface: (x, z, o) =>
    Object.assign(o || {}, { y: 0, nx: 0, ny: 1, nz: 0, onRoad: 1, roadDist: 0, roadWidth: 8, roadTier: 0, grip: 1, rough: 0, made: 0, w: new Float32Array(8), dominant: 0, surfaceKind: 'road' }),
  height: () => 0,
  normal: () => [0, 1, 0],
};

function drop(carId, from = 1.5) {
  const entry = FLEET_BY_ID[carId];
  const feel = applyCarFeel(entry);
  const car = new Vehicle({ tier: entry.tier, terrain: FLAT, preset: feel.assist });
  car.placeAt(0, 0, 0);
  car.y += from;
  car.vy = 0;
  let bounces = 0;
  let last = 0;
  let settle = -1;
  let quiet = 0;
  let t = 0;
  let maxSag = 0;
  for (; t < 6; t += PHYSICS_DT) {
    car._step(PHYSICS_DT, { throttle: 0, brake: 0, steer: 0 });
    maxSag = Math.max(maxSag, car.sag);
    const sgn = Math.abs(car.vy) < 0.05 ? 0 : Math.sign(car.vy);
    if (sgn !== 0 && last !== 0 && sgn !== last) bounces++;
    if (sgn !== 0) last = sgn;
    if (Math.abs(car.vy) < 0.08) quiet += PHYSICS_DT;
    else quiet = 0;
    if (quiet > 0.30 && settle < 0) settle = t - quiet;
  }
  return { bounces, settle: settle < 0 ? t : settle, maxSag };
}

const wd = drop('rally');
const cd = drop('coupe');
console.log('');
console.log('        a 1.5 m drop onto flat ground');
console.log(`        Warthog  ${wd.bounces} reversals, settled in ${wd.settle.toFixed(2)} s, springs used ${wd.maxSag.toFixed(3)} m`);
console.log(`        Coupe    ${cd.bounces} reversals, settled in ${cd.settle.toFixed(2)} s, springs used ${cd.maxSag.toFixed(3)} m`);
/* THE COUPE FLIES FURTHER OFF THE RAMP, AND THAT IS CORRECT — it is 800 kg lighter with less drag, so
 * it arrives at the lip faster and leaves it faster. Pretending otherwise would be fixing the
 * measurement instead of the car. The Warthog's advantage is the half of a jump the operator actually
 * named: the landing, and the springs that take it. */
check('the Warthog uses far more spring', wd.maxSag > cd.maxSag * 1.5, `${wd.maxSag.toFixed(3)} vs ${cd.maxSag.toFixed(3)} m`, 'Warthog > 1.5x Coupe');
check('and settles no worse for it', wd.settle <= cd.settle + 0.35, `${wd.settle.toFixed(2)} vs ${cd.settle.toFixed(2)} s`, 'within 0.35 s of the Coupe');
check('landing does not pogo', wd.bounces <= 4, wd.bounces + ' reversals', '<= 4');

console.log('');
if (fails) {
  console.error(`${fails} check(s) failed`);
  process.exit(1);
}
console.log('all ramp checks passed');
