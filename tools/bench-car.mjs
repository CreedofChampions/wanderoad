/* Wanderoad — vehicle acceptance tests.
 *
 * Four reproducible manoeuvres, one per named failure mode of the games we are learning
 * from. If any of these drift, the car has stopped being the car we designed.
 *
 *   node tools/bench-car.mjs
 */

import { Vehicle } from '../src/car/vehicle.js';
import { TIERS, TYRE, PHYSICS_DT } from '../src/car/tuning.js';

const G = 9.81;

/** A dead-flat, dead-grippy world, so the test measures the car and not the terrain. */
const FLAT = {
  // The normal matters: the solver resolves gravity onto it, so a stub without one makes
  // every number NaN. Real Terrain.surface() always returns one.
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};

function fresh(tier = 'sports', preset = 'sport') {
  const c = new Vehicle({ tier, terrain: FLAT, preset });
  c.placeAt(0, 0, 0);
  return c;
}

const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
const run = (car, secs, input) => {
  const n = Math.round(secs / PHYSICS_DT);
  for (let i = 0; i < n; i++) car._step(PHYSICS_DT, input);
};

const pass = (ok, label, got, want) =>
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(38)} ${String(got).padStart(12)}   want ${want}`);

let failures = 0;
const check = (ok, ...a) => {
  if (!ok) failures++;
  pass(ok, ...a);
};

console.log('\n── tyre curve shape ──────────────────────────────────────────────');
{
  // "Lateral force must never fall more than 12% within any single 5° window" — the
  // grip-transition acceptance test. This is the highest-priority number in the design.
  const car = fresh();
  const peak = TYRE.peakSlipFront;
  // replicate the curve exactly as the solver sees it (vehicle.js: tyreCurve)
  const sample = (deg) => {
    const u = Math.abs((deg * Math.PI) / 180) / peak;
    if (u <= 1) return Math.sin((Math.PI / 2) * Math.pow(u, 0.62));
    return TYRE.tailFloor + (1 - TYRE.tailFloor) * Math.exp(-0.125 * Math.pow(u - 1, 1.45));
  };
  let worstDrop = 0;
  let worstAt = 0;
  for (let d = 0; d <= 55; d += 1) {
    const drop = (sample(d) - sample(d + 5)) / Math.max(sample(d), 1e-6);
    if (drop > worstDrop) {
      worstDrop = drop;
      worstAt = d;
    }
  }
  check(worstDrop <= 0.12, `no >12% drop in any 5° window`, `${(worstDrop * 100).toFixed(1)}% @${worstAt}°`, '<= 12%');
  const plateau = [6, 8, 10, 13].map(sample);
  check(Math.min(...plateau) >= 0.96, 'plateau 6°–13° holds >=96% of peak', Math.min(...plateau).toFixed(3), '>= 0.96');
  check(sample(45) >= 0.6, 'still 60%+ of peak at 45° slip', sample(45).toFixed(3), '>= 0.60');
  void car;
}

console.log('\n── straight-line performance ─────────────────────────────────────');
for (const tier of ['gt', 'sports', 'hyper']) {
  const spec = TIERS[tier];
  const car = fresh(tier, 'sport');
  let t = 0;
  let to100 = null;
  const FULL = { ...NEUTRAL, throttle: 1 };
  for (let i = 0; i < 120 * 60; i++) {
    car._step(PHYSICS_DT, FULL);
    t += PHYSICS_DT;
    if (to100 === null && car.kph >= 100) to100 = t;
  }
  const top = car.kph;
  check(
    Math.abs(to100 - spec.zeroTo100) < spec.zeroTo100 * 0.35,
    `${tier} 0-100 km/h`,
    `${to100 ? to100.toFixed(2) : '—'}s`,
    `${spec.zeroTo100}s ±35%`
  );
  check(Math.abs(top - spec.topSpeed) < spec.topSpeed * 0.12, `${tier} top speed`, `${top.toFixed(0)} km/h`, `${spec.topSpeed} ±12%`);
}

console.log('\n── braking ───────────────────────────────────────────────────────');
{
  const car = fresh('sports', 'sport');
  const FULL = { ...NEUTRAL, throttle: 1 };
  while (car.kph < 100) car._step(PHYSICS_DT, FULL);
  const x0 = car.z;
  const BRK = { ...NEUTRAL, brake: 1 };
  let guard = 0;
  while (car.kph > 1 && guard++ < 120 * 20) car._step(PHYSICS_DT, BRK);
  const dist = Math.hypot(car.z - x0, car.x);
  check(dist > 24 && dist < 52, '100-0 km/h with ABS', `${dist.toFixed(1)} m`, '24–52 m (target ~34)');
}

console.log('\n── peak lateral grip ─────────────────────────────────────────────');
{
  // NOT a fixed-radius skidpad. At 22 m/s a 60 m circle only demands 0.82 g, so a radius
  // test silently measures the test rig rather than the tyres — which is exactly what the
  // first version of this file did. Instead: hold a speed, sweep the steering upward, and
  // record the highest SUSTAINED lateral acceleration reached. The tyre table says 1.30
  // front / 1.34 rear on a 47/53 car, so ~1.32 g is the ceiling to expect.
  const car = fresh('sports', 'off');
  let best = 0;
  let bestSteer = 0;
  let bestRadius = 0;
  for (let steer = 0.06; steer <= 1.0; steer += 0.02) {
    car.placeAt(0, 0, 0);
    car.vz = 40;
    car.vx = 0;
    // Hold the speed with a crude cruise control. A fixed throttle no longer works now that
    // engine braking is real: the car scrubs off speed in the corner and the measurement
    // ends up reporting the speed it decayed to rather than the grip it had.
    const IN = { ...NEUTRAL, steer, throttle: 0.3, analogue: true };
    const hold = () => { IN.throttle = Math.abs(car.speed) < 40 ? 0.55 : 0.05; };
    for (let i = 0; i < Math.round(3 / PHYSICS_DT); i++) { hold(); car._step(PHYSICS_DT, IN); }
    let sum = 0;
    const N = Math.round(1 / PHYSICS_DT);
    // True lateral acceleration is the rate at which the VELOCITY vector turns, times
    // speed. v * yawRate is only the same thing when sideslip is constant, and during a
    // slide it reads high enough to make a 1.3 g car look like a 2 g car.
    let prevHeading = Math.atan2(car.vx, car.vz);
    for (let i = 0; i < N; i++) {
      hold();
      car._step(PHYSICS_DT, IN);
      const h = Math.atan2(car.vx, car.vz);
      let d = h - prevHeading;
      if (d > Math.PI) d -= 2 * Math.PI;
      else if (d < -Math.PI) d += 2 * Math.PI;
      prevHeading = h;
      sum += (Math.abs(car.speed) * Math.abs(d / PHYSICS_DT)) / G;
    }
    const g = sum / N; // averaged over a second, so a transient cannot flatter it
    if (g > best) {
      best = g;
      bestSteer = steer;
      bestRadius = Math.abs(car.speed) / Math.max(Math.abs(car.yawRate), 1e-6);
    }
  }
  console.log(`        peak at steer ${bestSteer.toFixed(2)}, radius ${bestRadius.toFixed(0)} m`);
  // The band starts at 0.95, not at the tyre table's 1.32, because this test holds speed
  // through the corner. The friction ellipse spends part of the tyre on that, exactly as it
  // would in a real car — a coasting skidpad reads higher, and a car being driven does not.
  check(best > 0.95 && best < 1.55, 'sustained lateral g', best.toFixed(2), '0.95-1.55 g');
}

console.log('\n── slide catch (the whole point) ─────────────────────────────────');
{
  // Induce ~30° of sideslip at 90 km/h and see whether the SPORT keyboard preset recovers.
  let recovered = 0;
  const TRIALS = 12;
  for (let k = 0; k < TRIALS; k++) {
    const car = fresh('sports', 'sport');
    car.placeAt(0, 0, 0);
    car.vz = 25;
    // kick it sideways
    car.vx = 25 * Math.tan(((22 + k) * Math.PI) / 180);
    car.yawRate = 0.55;
    let ok = true;
    for (let i = 0; i < 120 * 4; i++) {
      // a plausible human: steer against the slide, ease off the throttle
      const want = Math.max(-1, Math.min(1, car.slip * 3.2)); // steer INTO the slide
      car._step(PHYSICS_DT, { steer: want, throttle: 0.18, brake: 0, handbrake: 0, analogue: false });
      if (Math.abs(car.slip) > (75 * Math.PI) / 180) {
        ok = false;
        break;
      }
    }
    if (ok && Math.abs(car.slip) < (14 * Math.PI) / 180) recovered++;
  }
  check(recovered / TRIALS >= 0.8, 'slides recovered (SPORT, keyboard)', `${recovered}/${TRIALS}`, '>= 80%');
}

console.log('\n── steering lock taper ───────────────────────────────────────────');
{
  const car = fresh();
  // Two different numbers matter here and conflating them hides a bug in either direction.
  // CRUISING lock is deliberately tiny at speed — full stick is a lateral acceleration, so a
  // road car uses under a degree at 200 km/h and anything more is the darty, flying feel the
  // first build had. SLIDING lock must stay large, because running out of steering mid-slide
  // is the single most-complained-about failure in the game we are learning from.
  const at = (kph, slipDeg = 0) => {
    car.vz = kph / 3.6;
    car.speed = kph / 3.6;
    car.slip = (slipDeg * Math.PI) / 180;
    return (car.maxSteerAngle() * 180) / Math.PI;
  };
  console.log('        cruise ', [0, 40, 80, 130, 180, 250].map((k) => `${k}:${at(k).toFixed(1)}°`).join('  '));
  console.log('        sliding', [40, 80, 130, 180, 250].map((k) => `${k}:${at(k, 20).toFixed(1)}°`).join('  '));
  check(at(0) > 34 && at(0) <= 41, 'full lock at rest', `${at(0).toFixed(0)}°`, '35–41°');
  check(at(50) < 9, 'cruising lock is calm at 50 km/h', `${at(50).toFixed(1)}°`, '< 9° (not a go-kart)');
  check(at(250, 20) >= 8, 'lock retained mid-slide at 250 km/h', `${at(250, 20).toFixed(1)}°`, '>= 8° (catch a slide)');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exitCode = failures ? 1 : 0;
