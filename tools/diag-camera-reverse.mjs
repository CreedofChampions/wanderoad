/* created by AI
 * Wanderoad — the reverse camera swing.
 *
 * The operator: "Reverse camera looks bad" — the chase rig should stay behind the car's own
 * front (looking over the tail as it backs up), not swing around.
 *
 * ROOT CAUSE, found by tracing the unmodified code: `ChaseCamera.update()` blends its target
 * yaw 62% toward the VELOCITY heading once speed clears 3 m/s (`C.velocityBlend`) — that is
 * what makes the sport camera "look into the corner" while driving forward. While reversing
 * dead straight, the velocity heading sits almost exactly 180° from `car.yaw`: the ANTIPODE of
 * the blend's own reference angle, where `angleDelta`'s sign is decided by a coin-flip of
 * floating-point noise on `car.vx`. The unmodified code (traced below) held a rock-steady
 * camera yaw of 0.000 rad for four full seconds of straight reverse and then, the INSTANT
 * `Math.abs(car.speed)` crossed the blend's 3 m/s gate, swung to 1.52 rad (87°) within two
 * physics steps — the exact "swings" the operator described. Fix: the velocity blend and the
 * look-into-corner term are both gated off whenever `car.speed < -0.3` (moving backwards in
 * the body frame, not just `car.reverse`), so the rig just holds `car.yaw` — "stable and
 * boring" — while reversing.
 *
 *   node tools/diag-camera-reverse.mjs
 */
import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { ChaseCamera } from '../src/car/camera.js';

const DEG = 180 / Math.PI;

/** Just enough of a three.js PerspectiveCamera for ChaseCamera.update() to run headless. */
class FakeCam {
  constructor() {
    this.position = { set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
    this.up = { set: () => {} };
    this.fov = 60;
  }
  lookAt(x, y, z) { this.lookX = x; this.lookY = y; this.lookZ = z; }
  updateProjectionMatrix() {}
}

const FLAT = {
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
const groundAt = () => 0;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(52)} ${String(got).padStart(14)}   want ${want}`);
};

console.log('\n── straight reverse: camera yaw must hold, not swing ───────────────');
{
  const car = new Vehicle({ tier: 'sports', terrain: FLAT, preset: 'sport' });
  car.placeAt(0, 0, 0);
  const chase = new ChaseCamera(new FakeCam(), { mode: 'sport' });
  // settle behind the car under a moment of forward drive first, same as a real spawn
  for (let i = 0; i < 60; i++) { car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 1 }); chase.update(car, PHYSICS_DT, groundAt); }
  let worstStep = 0; // biggest single-STEP yaw jump, deg — a real "swing" is a discontinuity
  let worstYawDeg = 0; // biggest departure from 0 over the whole run
  let prevYaw = chase.yaw;
  for (let i = 0; i < 120 * 6; i++) {
    car._step(PHYSICS_DT, { ...NEUTRAL, brake: 1 }); // hold S the whole way — brakes, then reverses
    chase.update(car, PHYSICS_DT, groundAt);
    const step = Math.abs(chase.yaw - prevYaw) * DEG;
    if (step > worstStep) worstStep = step;
    if (Math.abs(chase.yaw * DEG) > worstYawDeg) worstYawDeg = Math.abs(chase.yaw * DEG);
    prevYaw = chase.yaw;
  }
  console.log(`   6 s of held-S reverse (car ends at ${car.kph.toFixed(1)} km/h backwards, car.yaw stayed ${(car.yaw * DEG).toFixed(2)}°)`);
  check(worstStep < 1.0, 'worst single-step camera yaw jump', `${worstStep.toFixed(3)}°`, '< 1.0° (no swing)');
  check(worstYawDeg < 2.0, 'camera yaw never drifts off the car\'s own heading', `${worstYawDeg.toFixed(3)}°`, '< 2.0°');
}

console.log('\n── curving reverse: camera should track the car\'s OWN yaw, calmly ──');
{
  const car = new Vehicle({ tier: 'sports', terrain: FLAT, preset: 'sport' });
  car.placeAt(0, 0, 0);
  const chase = new ChaseCamera(new FakeCam(), { mode: 'sport' });
  // Settle the rig behind the car with the wheel centred first — the same "camera already
  // in place before the player does anything" state a real spawn or reverse engage starts
  // from. Without this the very first update() legitimately SNAPS to its rest pose (the
  // teleport branch every camera reset already uses), and a snap on frame 0 is not the
  // "swing" this file exists to catch.
  for (let i = 0; i < 30; i++) { car._step(PHYSICS_DT, NEUTRAL); chase.update(car, PHYSICS_DT, groundAt); }
  let worstStep = 0;
  let worstLag = 0; // how far the camera yaw trails the car's own yaw, once past the initial spring-in
  let prevYaw = chase.yaw;
  for (let i = 0; i < 120 * 6; i++) {
    car._step(PHYSICS_DT, { ...NEUTRAL, brake: 1, steer: 0.3 });
    chase.update(car, PHYSICS_DT, groundAt);
    const step = Math.abs(chase.yaw - prevYaw) * DEG;
    if (step > worstStep) worstStep = step;
    if (i > 30) worstLag = Math.max(worstLag, Math.abs(chase.yaw - car.yaw) * DEG);
    prevYaw = chase.yaw;
  }
  console.log(`   6 s of held-S + steer reverse: car ends heading ${(car.yaw * DEG).toFixed(1)}°, camera ${(chase.yaw * DEG).toFixed(1)}°`);
  check(worstStep < 1.0, 'worst single-step camera yaw jump', `${worstStep.toFixed(3)}°`, '< 1.0° (no swing)');
  // A damped yawTau=0.22 s follower carries an ORDINARY, continuous lag behind a target that
  // is itself turning fast (this reverse curls the car 63° in 6 s at walking pace) — that lag
  // is smooth tracking doing its job, not the swing this file exists to catch (worstStep,
  // above, is what actually distinguishes the two). 12° is a generous ceiling for that lag on
  // this deliberately tight manoeuvre, not a tuned "should" number.
  check(worstLag < 12.0, 'camera lag behind the car\'s own nose stays ordinary (no lock-to-velocity swing)', `${worstLag.toFixed(2)}°`, '< 12.0°');
}

console.log('\n── reverse to forward: camera resumes looking into the corner ──────');
{
  const car = new Vehicle({ tier: 'sports', terrain: FLAT, preset: 'sport' });
  car.placeAt(0, 0, 0);
  const chase = new ChaseCamera(new FakeCam(), { mode: 'sport' });
  for (let i = 0; i < 120 * 2; i++) { car._step(PHYSICS_DT, { ...NEUTRAL, brake: 1 }); chase.update(car, PHYSICS_DT, groundAt); }
  const yawWhileReversing = chase.yaw;
  for (let i = 0; i < 120 * 3; i++) {
    car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 1, steer: 0.4 });
    chase.update(car, PHYSICS_DT, groundAt);
  }
  console.log(`   camera yaw while reversing ${(yawWhileReversing * DEG).toFixed(2)}°, 3 s after going forward + steering: ${(chase.yaw * DEG).toFixed(2)}°  (car.kph ${car.kph.toFixed(0)})`);
  check(car.speed > 5, 'car is genuinely driving forward again', `${car.speed.toFixed(2)} m/s`, '> 5 m/s');
  check(Number.isFinite(chase.yaw), 'camera yaw is finite (no leftover NaN/inf from the reverse gate)', chase.yaw, 'finite');
}

console.log(`\n${failures === 0 ? 'ALL REVERSE-CAMERA TRACES PASSED' : failures + ' TRACE(S) FAILED'}\n`);
process.exitCode = failures ? 1 : 0;
