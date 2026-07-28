/* created by AI
 * Wanderoad — reverse-gear traces.
 *
 * The operator's own words: "Reversing seems almost impossible — the gear system forces you
 * into reverse but then you can't move using either key once you're in reverse. Tapping
 * multiple times sometimes works. It should be simple: push and hold S to reverse."
 *
 * Root cause, found by tracing the UNMODIFIED code before this fix: reverse used to arm on an
 * edge-triggered latch (`_brakeWasOff`) that required the brake pedal to be RELEASED and
 * freshly RE-PRESSED once the car was already slow. Braking hard from speed and holding S
 * THROUGH the stop consumed that latch on the very first press — long before the car was slow
 * enough for the arm check to fire — so a continuous hold never engaged reverse at all; the car
 * just braked to a stop and sat there. Only releasing S and pressing it again (the "tapping")
 * ever worked. car/vehicle.js now reads the pedals and the speed fresh every step, no latch.
 *
 * Three traces, all must pass:
 *   1. From a dead standstill, hold S for 3 s -> car moves backwards, > 5 km/h.
 *   2. From 50 km/h, hold S continuously (never release) -> brakes to a stop, THEN reverses
 *      without the key ever coming up.
 *   3. While reversing, press W -> goes forward.
 *
 *   node tools/diag-reverse.mjs
 */
import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT, REVERSE } from '../src/car/tuning.js';

const FLAT = {
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};
const fresh = () => {
  const c = new Vehicle({ tier: 'sports', terrain: FLAT, preset: 'sport' });
  c.placeAt(0, 0, 0);
  return c;
};
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(52)} ${String(got).padStart(14)}   want ${want}`);
};

console.log('\n── 1. dead standstill, hold S for 3 s ──────────────────────────────');
{
  const car = fresh();
  const S = { ...NEUTRAL, brake: 1 };
  let armedAt = null;
  for (let i = 0; i < 120 * 3; i++) {
    car._step(PHYSICS_DT, S);
    if (armedAt === null && car.reverse) armedAt = (i * PHYSICS_DT).toFixed(3);
  }
  console.log(`   reverse armed at t=${armedAt}s`);
  check(car.reverse, 'reverse engaged', car.reverse, 'true');
  check(car.kph > 5, 'speed after 3 s of hold', `${car.kph.toFixed(2)} km/h backwards`, '> 5 km/h');
}

console.log('\n── 2. 50 km/h, hold S continuously through the stop ────────────────');
{
  const car = fresh();
  const FULL = { ...NEUTRAL, throttle: 1 };
  while (car.kph < 50) car._step(PHYSICS_DT, FULL);
  const S = { ...NEUTRAL, brake: 1 }; // pressed once, held for the whole run — never released
  let nearStopAt = null; // first moment slow enough to arm (the ARM_SPEED gate itself)
  let reverseAt = null;
  let backAt = null; // first moment it is genuinely moving backwards, not just stopped
  for (let i = 0; i < 120 * 8; i++) {
    car._step(PHYSICS_DT, S);
    const t = i * PHYSICS_DT;
    if (nearStopAt === null && Math.abs(car.speed) < REVERSE.armSpeed) nearStopAt = t;
    if (reverseAt === null && car.reverse) reverseAt = t;
    if (backAt === null && car.speed < -1.39 /* 5 km/h */) backAt = t;
  }
  console.log(`   under the ${REVERSE.armSpeed} m/s arm speed at t=${nearStopAt?.toFixed(2)}s, reverse armed at t=${reverseAt?.toFixed(2)}s, past 5 km/h backwards at t=${backAt?.toFixed(2)}s`);
  check(nearStopAt !== null, 'braked down to the arm speed first', nearStopAt !== null, 'true');
  check(reverseAt !== null && nearStopAt !== null && reverseAt >= nearStopAt - 0.02, 'reverse armed only once slow enough', `armed ${reverseAt?.toFixed(2)}s vs slow-enough ${nearStopAt?.toFixed(2)}s`, 'armed at/after the arm speed');
  check(backAt !== null, 'reversed WITHOUT releasing the key', backAt !== null, 'true — key never came up');
}

console.log('\n── 3. reversing, press W -> forward ─────────────────────────────────');
{
  const car = fresh();
  const S = { ...NEUTRAL, brake: 1 };
  for (let i = 0; i < 120 * 2; i++) car._step(PHYSICS_DT, S); // get it moving backwards first
  const wasReversing = car.reverse && car.speed < -1;
  console.log(`   before W: reverse=${car.reverse} speed=${car.speed.toFixed(2)} m/s (${car.kph.toFixed(1)} km/h)`);
  const W = { ...NEUTRAL, throttle: 1 };
  let clearedAt = null;
  let forwardAt = null;
  for (let i = 0; i < 120 * 5; i++) {
    car._step(PHYSICS_DT, W);
    const t = i * PHYSICS_DT;
    if (clearedAt === null && !car.reverse) clearedAt = t;
    if (forwardAt === null && car.speed > 0.5) forwardAt = t;
  }
  console.log(`   reverse cleared at t=${clearedAt?.toFixed(2)}s, forward (>0.5 m/s) at t=${forwardAt?.toFixed(2)}s, final ${car.kph.toFixed(1)} km/h forward`);
  check(wasReversing, 'was actually reversing beforehand', wasReversing, 'true');
  check(clearedAt !== null && clearedAt < 0.1, 'reverse cleared immediately on W', `${clearedAt?.toFixed(3)}s`, '< 0.1s');
  check(forwardAt !== null, 'car goes forward', forwardAt !== null, 'true');
  check(car.speed > 5, 'genuinely driving forward, not just stopped', `${car.speed.toFixed(2)} m/s`, '> 5 m/s');
}

console.log(`\n${failures === 0 ? 'ALL REVERSE TRACES PASSED' : failures + ' TRACE(S) FAILED'}\n`);
process.exitCode = failures ? 1 : 0;
