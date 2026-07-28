/* Wanderoad — the turning circle, measured on flat ground so it is the CAR being measured
 * and not the hill it happened to be parked on.
 *
 * This exists because "C3 you can stop and turn around" fails in the browser at 61-70 deg of
 * turn while the world-level replay (tools/diag-c3-turn.mjs) passes at four road starts in
 * five. A number that depends that much on where the car is standing is not telling you
 * about the car, so this rig takes the world away: dead flat, one grip value, from rest,
 * full lock, and it reports how long the car takes to come round 180 deg and how much room
 * it needs to do it.
 *
 * WHAT IT ESTABLISHED, and the reason nothing in the steering was touched:
 *
 *   - On flat ground the car passes the manoeuvre on BOTH surfaces (tarmac 197 deg, grass 146
 *     in the 7 s the check allows), so C3's failures are not "the car cannot turn" — they are
 *     the state the car is in by the time it tries.
 *   - No assist is the lever. Counter-steer off, stability off, stability 1.0, traction
 *     control 1.0, a 40 deg lock floor, double the steering limiter, sport and off presets:
 *     the whole matrix lands between 127 and 165 deg against a shipped 132-146. Trace it and
 *     the reason is plain — the front tyres are already just past peak slip, so more lock buys
 *     nothing. What sets the turn is SPEED, and with the throttle pinned the car pins itself
 *     to the off-road governor at 43.9 km/h, where the limiter's own atan(L·comfortG/v²) is
 *     8.5 deg of lock and 40 m of radius. That IS the operator's "it just keeps kind of going
 *     in a particular direction", and the honest fix for it is a speed one, which is O2's
 *     territory (off-road speed) rather than this check's.
 *   - What DID move was the car being off the ground — see tools/diag-bump.mjs.
 *
 * The 0.20-throttle rows read 0 deg because the car genuinely does not pull away at that
 * throttle from rest. That is pre-existing, it is not what C3 measures (the check floors it),
 * and it is left alone deliberately.
 *
 *   node tools/diag-uturn.mjs
 */

import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { applyCarFeel, FLEET } from '../src/game/garage.js';

const CAR = FLEET[1]; // one tap of V, the car C3 is driving
applyCarFeel(CAR);

const world = (grip, onRoad) => ({
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip, rough: 0,
                    surfaceKind: onRoad ? 'tarmac' : 'ground', onRoad, dominant: 0 }),
  height: () => 0,
});

/**
 * Full left lock from rest, with the throttle held as given.
 * @returns {{t180:number, radius:number, kph:number, deg:number, rate:number}}
 */
function uturn(grip, onRoad, throttle, secs = 7, tweak = null) {
  const car = new Vehicle({ tier: CAR.tier, terrain: world(grip, onRoad), preset: CAR.feel.assist });
  if (tweak) tweak(car);
  car.placeAt(0, 0, 0);
  const n = Math.round(secs / PHYSICS_DT);
  const input = { steer: 1, throttle, brake: 0, handbrake: 0, analogue: false };
  let net = 0, prev = car.yaw, t180 = NaN;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (let i = 0; i < n; i++) {
    car._step(PHYSICS_DT, input);
    let d = car.yaw - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    net += d;
    prev = car.yaw;
    minX = Math.min(minX, car.x); maxX = Math.max(maxX, car.x);
    minZ = Math.min(minZ, car.z); maxZ = Math.max(maxZ, car.z);
    if (!isFinite(t180) && Math.abs(net) >= Math.PI) t180 = (i + 1) * PHYSICS_DT;
  }
  return {
    t180,
    width: Math.max(maxX - minX, maxZ - minZ), // the road width a U-turn would need
    kph: car.kph,
    deg: net * 57.3,
    rate: (net * 57.3) / secs,
  };
}

const row = (label, r) =>
  console.log(
    `  ${label.padEnd(34)} ${r.deg.toFixed(0).padStart(4)} deg in 7 s (${r.rate.toFixed(0).padStart(3)} deg/s)   ` +
    `180 deg at ${isFinite(r.t180) ? r.t180.toFixed(1) + ' s' : ' never'}   ` +
    `needs ${r.width.toFixed(1).padStart(5)} m   ends at ${r.kph.toFixed(0).padStart(3)} km/h`
  );

console.log(`\nFull left lock from rest — car "${CAR.label ?? CAR.name ?? 'FLEET[1]'}" (${CAR.tier}, ${CAR.feel.assist})`);
console.log('\n── tarmac (grip 1.00, on the carriageway) ───────────────────────────');
for (const th of [1, 0.6, 0.35, 0.2]) row(`throttle ${th.toFixed(2)}`, uturn(1.0, 1, th));
console.log('\n── grass (grip 0.57, off the carriageway) ───────────────────────────');
for (const th of [1, 0.6, 0.35, 0.2]) row(`throttle ${th.toFixed(2)}`, uturn(0.57, 0, th));
/* ── the manoeuvre the check actually performs ────────────────────────────
 * C3 does not turn from rest. It holds W for 4 s, S for 4 s — and S past a standstill is
 * REVERSE in this car (see tuning.js's REVERSE block) — and only then applies A+W, so the
 * turn could be starting with the car travelling BACKWARDS, where a left lock yaws it the
 * other way and eats the window. That was a live suspicion and this priced it: it is NOT
 * happening. Four seconds of brake leaves the car at 0.0 km/h on both surfaces (reverse never
 * engages from a plain brake hold here), and cutting the brake phase short to catch it
 * mid-reverse changes the turn by 3 deg and produces zero degrees the wrong way. The wrong-way
 * degrees seen in the WORLD traces are the car sliding on a bank, not reverse. */
console.log('\n── W 4 s, S 4 s, then A+W 7 s — the check\'s own sequence, flat ─────');
for (const [label, grip, onRoad] of [['tarmac', 1.0, 1], ['grass', 0.57, 0]]) {
  for (const brakeSecs of [4, 2, 1.2]) {
    const car = new Vehicle({ tier: CAR.tier, terrain: world(grip, onRoad), preset: CAR.feel.assist });
    car.placeAt(0, 0, 0);
    const step = (secs, input) => {
      for (let i = 0; i < Math.round(secs / PHYSICS_DT); i++) car._step(PHYSICS_DT, input);
    };
    step(4, { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: false });
    step(brakeSecs, { steer: 0, throttle: 0, brake: 1, handbrake: 0, analogue: false });
    const vRev = car.speed; // negative = reversing
    const yaw0 = car.yaw;
    let net = 0, prev = car.yaw, wrongWay = 0;
    const turn = { steer: 1, throttle: 1, brake: 0, handbrake: 0, analogue: false };
    for (let i = 0; i < Math.round(7 / PHYSICS_DT); i++) {
      car._step(PHYSICS_DT, turn);
      let d = car.yaw - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      net += d;
      if (d < 0) wrongWay += -d;
      prev = car.yaw;
    }
    console.log(
      `  ${label.padEnd(7)} brake ${brakeSecs.toFixed(1)} s -> ${(vRev * 3.6).toFixed(1).padStart(6)} km/h at the wheel` +
      `   turn ${(net * 57.3).toFixed(0).padStart(4)} deg (${(wrongWay * 57.3).toFixed(0)} deg of it the wrong way)` +
      `   ${net * 57.3 > 100 ? 'PASS' : 'FAIL'}`
    );
  }
}

console.log('\n── grass, full throttle, one assist changed at a time ───────────────');
for (const [label, tweak] of [
  ['as shipped', null],
  ['counter-steer off', (c) => { c.assist.counterSteer = 0; }],
  ['stability off', (c) => { c.assist.stability = 0; }],
  ['stability 1.0', (c) => { c.assist.stability = 1; }],
  ['traction control 1.0', (c) => { c.assist.tcs = 1; }],
  ['lock floor 40 deg', (c) => { c.assist.lockFloor = (40 * Math.PI) / 180; }],
  ['maxSteerAngle x2', (c) => { const f = c.maxSteerAngle.bind(c); c.maxSteerAngle = (a) => f(a) * 2; }],
  ['maxSteerAngle x0.6', (c) => { const f = c.maxSteerAngle.bind(c); c.maxSteerAngle = (a) => f(a) * 0.6; }],
  ['preset sport', (c) => { c.setPreset('sport'); }],
  ['preset off', (c) => { c.setPreset('off'); }],
]) row(label, uturn(0.57, 0, 1, 7, tweak));
console.log('\n── tarmac, full throttle, the same ─────────────────────────────────');
for (const [label, tweak] of [
  ['as shipped', null],
  ['counter-steer off', (c) => { c.assist.counterSteer = 0; }],
  ['stability 1.0', (c) => { c.assist.stability = 1; }],
  ['maxSteerAngle x2', (c) => { const f = c.maxSteerAngle.bind(c); c.maxSteerAngle = (a) => f(a) * 2; }],
]) row(label, uturn(1.0, 1, 1, 7, tweak));

/* ── where does the missing grip go? ──────────────────────────────────────
 * On grass the tyres are good for about 0.74 g. A 180 deg turn at that, at the speed the car
 * actually reaches, is a 21 m circle and 5.4 s — inside the 7 s the check allows. It does not
 * happen, so the question is which term is eating the difference: the steering limiter (how
 * much lock the driver is allowed), the front tyres (are they past peak slip, i.e. ploughing),
 * or the stability assist (is it damping the yaw it is meant to be helping). */
console.log('\n── grass, full throttle, traced ─────────────────────────────────────');
{
  const car = new Vehicle({ tier: CAR.tier, terrain: world(0.57, 0), preset: CAR.feel.assist });
  car.placeAt(0, 0, 0);
  const input = { steer: 1, throttle: 1, brake: 0, handbrake: 0, analogue: false };
  const peakF = (8.0 * Math.PI) / 180; // TYRE.peakSlipFront
  for (let i = 0; i < Math.round(7 / PHYSICS_DT); i++) {
    car._step(PHYSICS_DT, input);
    if (i % Math.round(0.5 / PHYSICS_DT) === 0) {
      const cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
      const vLong = car.vz * cy + car.vx * sy;
      const vLat = car.vx * cy - car.vz * sy;
      const aF = Math.atan2(vLat + car.a * car.yawRate, Math.max(Math.abs(vLong), 0.5)) - car.steerAngle;
      const v = Math.hypot(vLong, vLat);
      const latG = (v * Math.abs(car.yawRate)) / 9.81;
      console.log(
        `  t=${((i + 1) * PHYSICS_DT).toFixed(1).padStart(4)}s  ${car.kph.toFixed(1).padStart(5)} km/h  ` +
        `lock ${(car.steerAngle * 57.3).toFixed(1).padStart(5)}deg  ` +
        `frontSlip ${(aF * 57.3).toFixed(1).padStart(6)}deg (peak ${(peakF * 57.3).toFixed(1)})  ` +
        `yaw ${(car.yawRate * 57.3).toFixed(0).padStart(3)}d/s  latG ${latG.toFixed(2)}  ` +
        `radius ${(v / Math.max(Math.abs(car.yawRate), 1e-3)).toFixed(0).padStart(3)}m`
      );
    }
  }
}

console.log('\n── how much of that is the counter-steer assist? ────────────────────');
{
  const car = new Vehicle({ tier: CAR.tier, terrain: world(0.57, 0), preset: CAR.feel.assist });
  console.log(`  preset "${CAR.feel.assist}": counterSteer ${car.assist.counterSteer}, stability ${car.assist.stability}`);
}
console.log('');
