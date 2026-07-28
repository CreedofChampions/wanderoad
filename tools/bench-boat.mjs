/* Wanderoad — boat mode, on the real world.
 *
 *   node tools/bench-boat.mjs
 *
 * Two questions, both against the REAL Vehicle solver and a REAL Terrain sampler on the
 * shipped seed — nothing here is simulated twice:
 *
 *   1. LOCKED: driving flat-out at a lakeshore with no boat, does the car actually stop
 *      short of the water rather than wallowing in it — no rescue-teleport needed at all.
 *   2. UNLOCKED: does the boat actually engage, actually cover real ground on open water, and
 *      actually hand back a normal, drivable car on the way out.
 *
 * The lakeside fixture is FOUND BY SEARCH, the same discipline tools/bench-rescue.mjs already
 * uses and for the same reason stated there: a hard-coded coordinate silently rots the moment
 * the world generator changes, and four failing checks that all read "0.00" look like a broken
 * feature when the fixture, not the feature, is what broke.
 */

import { Terrain, isDryAt } from '../src/world/terrain.js';
import { BIOME_COUNT, waterLevelAt } from '../src/world/biomes.js';
import { Vehicle } from '../src/car/vehicle.js';
import { BoatMode, BOAT_MAX_KPH } from '../src/game/boat.js';

const SEED = 20260726;
const DT = 1 / 60;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(52)} ${String(got).padStart(14)}   want ${want}`);
};

/* Same shape as bench-rescue.mjs's own findLakesideRoad(): a plain grid scan for a point that
 * is genuinely deep water with a genuinely dry road close enough to drive from. */
function findLakesideRoad() {
  const scan = new Terrain(SEED, -3000, -3000, 3000, 3000, 240);
  const w = new Float32Array(BIOME_COUNT);
  const depth = (x, z) => {
    const y = scan.height(x, z);
    scan.weights(x, z, w);
    const wy = waterLevelAt(w, y);
    return wy === null ? 0 : wy - y;
  };
  for (let z = -3500; z <= 3500; z += 25) {
    for (let x = -3500; x <= 3500; x += 25) {
      if (depth(x, z) < 2.0) continue; // real open water, not a damp margin
      const q = scan.roads.query(x, z);
      if (!isFinite(q.d) || q.d > 45 || q.d < 12) continue;
      if (depth(q.qx, q.qz) > 0) continue; // the road itself must be dry — a bank, not a ford
      return { x, z, q };
    }
  }
  throw new Error('bench-boat: no lakeside road found in a 7 km square about the origin');
}
const LAKE = findLakesideRoad();
console.log(`lakeside road fixture: (${LAKE.x}, ${LAKE.z})`);

const T = new Terrain(SEED, LAKE.x - 320, LAKE.z - 320, LAKE.x + 320, LAKE.z + 320, 240);
const W = new Float32Array(BIOME_COUNT);
const depthAt = (x, z) => {
  const y = T.height(x, z);
  T.weights(x, z, W);
  const wy = waterLevelAt(W, y);
  return wy === null ? 0 : wy - y;
};

// Road centre, and the unit vector from it out into the lake.
const q = T.roads.query(LAKE.x, LAKE.z);
const dx0 = LAKE.x - q.qx;
const dz0 = LAKE.z - q.qz;
const L0 = Math.hypot(dx0, dz0);
const outX = dx0 / L0;
const outZ = dz0 / L0;
const headingOut = Math.atan2(outX, outZ); // forward is (sin yaw, cos yaw) — vehicle.js's own convention

const DRIVE = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

/** A fresh Vehicle on the real Terrain, at the road, pointed out at the water. */
function freshCar() {
  const car = new Vehicle({ tier: 'sports', terrain: T, preset: 'sport' });
  car.placeAt(q.qx, q.qz, headingOut);
  return car;
}

console.log('\n── the shore, measured ─────────────────────────────────────────────');
{
  const row = [];
  for (let s = 0; s <= 20; s += 2) row.push(`${s}m:${depthAt(q.qx + outX * s, q.qz + outZ * s).toFixed(2)}`);
  console.log(`  road centre (${q.qx.toFixed(1)}, ${q.qz.toFixed(1)}) -> lake, depth by distance:`);
  console.log(`  ${row.join('  ')}`);
}

console.log('\n── LOCKED: the barrier cushions the car, no rescue needed ─────────────');
{
  const car = freshCar();
  const said = [];
  const boat = new BoatMode({
    wallet: { boatUnlocked: false },
    say: (t) => said.push(t),
    terrain: () => T,
  });

  let deepest = 0;
  let tBarrier = null; // first frame the barrier actually bites, not the moment the car (still
  // parked) happens to read under 2 km/h — see the comment on tUnder2 below.
  let peakBeforeBarrier = 0;
  let tUnder2 = null;
  for (let i = 0; i < 60 * 8; i++) {
    const t = i * DT;
    if (!boat.active) car.update(DT, DRIVE);
    boat.update(DT, car, T.surface(car.x, car.z), DRIVE);
    const d = depthAt(car.x, car.z);
    if (d > deepest) deepest = d;
    if (tBarrier === null) {
      if (boat.blockedToastPending) tBarrier = t;
      else peakBeforeBarrier = Math.max(peakBeforeBarrier, car.kph);
    } else if (tUnder2 === null && car.kph < 2) {
      tUnder2 = t - tBarrier;
    }
  }
  console.log(`  reached ${peakBeforeBarrier.toFixed(1)} km/h before the barrier bit at ${tBarrier === null ? 'never' : `${tBarrier.toFixed(2)} s`}`);
  console.log(`  deepest the car ever got: ${deepest.toFixed(2)} m; ended at ${car.kph.toFixed(1)} km/h`);
  console.log(`  said: ${said.join(' | ') || '(nothing)'}`);
  check(boat.active === false, 'never entered boat mode while locked', boat.active, 'false');
  check(peakBeforeBarrier > 15, 'was actually up to real speed before the barrier caught it', peakBeforeBarrier.toFixed(1), '> 15 km/h');
  check(tBarrier !== null, 'the barrier actually engaged', tBarrier === null ? 'never' : `${tBarrier.toFixed(2)} s`, 'yes');
  check(tUnder2 !== null && tUnder2 < 3, 'speed damped below 2 km/h within 3 s of the barrier biting', tUnder2 === null ? 'never' : `${tUnder2.toFixed(2)} s`, '< 3 s');
  check(deepest < 1.0, 'never got more than 1 m deep', deepest.toFixed(2), '< 1.0 m');
  check(said.some((s) => /boat/i.test(s)), 'said something about needing a boat', said.join(' | ') || '(nothing)', 'mentions "boat"');
}

console.log('\n── UNLOCKED: the boat engages, covers real ground, and hands back ─────');
{
  const car = freshCar();
  const said = [];
  const events = [];
  const wallet = { boatUnlocked: true };
  const boat = new BoatMode({ wallet, say: (t) => said.push(t), terrain: () => T });

  // Drive from the road into the lake — same full-throttle approach as the locked case, so
  // the only variable that changed between the two sections is the wallet.
  let enteredAt = null;
  let enterX = 0, enterZ = 0;
  for (let i = 0; i < 60 * 10 && enteredAt === null; i++) {
    const t = i * DT;
    if (!boat.active) car.update(DT, DRIVE);
    boat.update(DT, car, T.surface(car.x, car.z), DRIVE);
    if (boat.active) {
      enteredAt = t;
      enterX = car.x;
      enterZ = car.z;
    }
  }
  check(enteredAt !== null, 'boat mode engages once unlocked and deep enough', enteredAt === null ? 'never' : `${enteredAt.toFixed(2)} s`, 'within 10 s');

  // 20 s of throttle, out across open water. car.update() is never called while active — see
  // main.js's own wiring — boat.update() is the whole of the car's motion here.
  let maxKph = 0;
  for (let i = 0; i < 60 * 20 && boat.active; i++) {
    boat.update(DT, car, T.surface(car.x, car.z), DRIVE);
    if (car.kph > maxKph) maxKph = car.kph;
  }
  const travelled = Math.hypot(car.x - enterX, car.z - enterZ);
  console.log(`  20 s under way: travelled ${travelled.toFixed(1)} m, peak ${maxKph.toFixed(1)} km/h (cap ${BOAT_MAX_KPH} km/h)`);
  check(boat.active, 'still afloat after 20 s of open water', boat.active, 'true');
  check(travelled > 60, 'covered real ground on the water', `${travelled.toFixed(1)} m`, '> 60 m');
  check(maxKph <= BOAT_MAX_KPH + 1, 'never exceeds its own top speed', maxKph.toFixed(1), `<= ${BOAT_MAX_KPH + 1}`);

  // Turn around and head back for the same shore the boat left from — the far side of THIS
  // exact departure, so the exit is measured against a shore this file already knows is dry.
  let exitedAt = null;
  for (let i = 0; i < 60 * 40 && exitedAt === null; i++) {
    const t = i * DT;
    const backHeading = Math.atan2(q.qx - car.x, q.qz - car.z);
    let steerErr = backHeading - boat.yaw;
    while (steerErr > Math.PI) steerErr -= Math.PI * 2;
    while (steerErr < -Math.PI) steerErr += Math.PI * 2;
    const cmd = { steer: Math.max(-1, Math.min(1, steerErr * 2)), throttle: 1, brake: 0, handbrake: 0, analogue: true };
    if (!boat.active) car.update(DT, cmd);
    boat.update(DT, car, T.surface(car.x, car.z), cmd);
    if (!boat.active) exitedAt = t;
  }
  console.log(`  back at the shore: (${car.x.toFixed(1)}, ${car.z.toFixed(1)}), ${car.kph.toFixed(1)} km/h, depth here ${depthAt(car.x, car.z).toFixed(2)} m`);
  check(exitedAt !== null, 'exits on reaching the shore', exitedAt === null ? 'never (still afloat)' : `${exitedAt.toFixed(2)} s`, 'within 40 s');
  check(!boat.active, 'boat mode is off — the car solver has the wheel again', boat.active, 'false');
  check(depthAt(car.x, car.z) < 1.0, 'come to rest on land, not out in the lake', depthAt(car.x, car.z).toFixed(2), '< 1.0 m');

  // And the car solver genuinely resumes: drive it a little further and check it behaves like
  // an ordinary car (not stuck, not still being driven by boat.js).
  let advanced = 0;
  const x0 = car.x, z0 = car.z;
  for (let i = 0; i < 60 * 2; i++) {
    car.update(DT, NEUTRAL);
    boat.update(DT, car, T.surface(car.x, car.z), NEUTRAL);
  }
  advanced = Math.hypot(car.x - x0, car.z - z0);
  check(boat.active === false, 'stays a car after a couple of quiet seconds', boat.active, 'false');
  check(Number.isFinite(car.x) && Number.isFinite(car.y) && Number.isFinite(car.z), 'car pose is finite — the reseat did not NaN anything', `${car.x.toFixed(1)}, ${car.y.toFixed(2)}, ${car.z.toFixed(1)}`, 'finite');
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all boat checks passed'}\n`);
process.exit(failures ? 1 : 0);
