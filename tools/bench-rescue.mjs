/* Wanderoad — the water rescue, on the real world.
 *
 * W7 says water is a trap: you drive in and you are stuck. It is worse than stuck — the bank
 * drops at about 35 degrees and the bed is flat, so the car simply carries on driving along
 * the bottom of the lake, eleven metres under, forever. This measures the way out.
 *
 * Two things have to be true and they pull against each other:
 *   - drive in, and you are back on a road and driving inside a couple of seconds
 *   - potter about at the shoreline, or drive a lakeside road, and NOTHING happens
 *
 *   node tools/bench-rescue.mjs
 */

import { Terrain, findSpawn, isDryAt } from '../src/world/terrain.js';
import { BIOME_COUNT, waterLevelAt } from '../src/world/biomes.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { Rescue, waterDepth } from '../src/game/rescue.js';

const SEED = 20260726;
const DT = 1 / 60;

/* A lake beside a road on the shipped seed. tools/diag-water.mjs proves no road is ever
 * underwater, so a lakeshore this close to tarmac is the exact place the rescue has to be
 * both present and invisible. */
const LAKE = { x: 968, z: -160 };
const T = new Terrain(SEED, LAKE.x - 320, LAKE.z - 320, LAKE.x + 320, LAKE.z + 320, 240);
const W = new Float32Array(BIOME_COUNT);
const depthAt = (x, z) => {
  const y = T.height(x, z);
  T.weights(x, z, W);
  const wy = waterLevelAt(W, y);
  return wy === null ? 0 : wy - y;
};

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(46)} ${String(got).padStart(15)}   want ${want}`);
};

/** Exactly what main.js's backToRoad() does, so the bench measures the shipped path — water
 *  check included, since a nearest-road point is not automatically dry (a cutting can duck
 *  below the local water table while the land beside it stays dry; see the header note on
 *  waterMargin() in world/terrain.js). */
function makeRig({ tier = 'sports' } = {}) {
  const car = new Vehicle({ tier, terrain: T, preset: 'sport' });
  const log = [];
  let placements = 0;
  const rescue = new Rescue({
    say: (t) => log.push(t),
    recover: () => {
      placements++;
      const q = T.roads.query(car.x, car.z);
      if (isFinite(q.d) && isDryAt(q.qx, q.qz, SEED)) {
        car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
      } else {
        const s = findSpawn(SEED, car.x, car.z);
        car.placeAt(s.x, s.z, s.heading);
      }
    },
  });
  return { car, rescue, log, placed: () => placements };
}

const DRIVE = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };

console.log('\n── the shore, measured ───────────────────────────────────────────');
{
  const q = T.roads.query(LAKE.x, LAKE.z);
  const dx = LAKE.x - q.qx;
  const dz = LAKE.z - q.qz;
  const L = Math.hypot(dx, dz);
  const row = [];
  for (let s = 0; s <= 20; s += 2) row.push(`${s}m:${depthAt(q.qx + (dx / L) * s, q.qz + (dz / L) * s).toFixed(2)}`);
  console.log(`  road centre (${q.qx.toFixed(1)}, ${q.qz.toFixed(1)}) -> lake, depth by distance:`);
  console.log(`  ${row.join('  ')}`);
}

console.log('\n── drive in, and you come back ───────────────────────────────────');
{
  const { car, rescue, log, placed } = makeRig();
  const q = T.roads.query(LAKE.x, LAKE.z);
  const dx = LAKE.x - q.qx;
  const dz = LAKE.z - q.qz;
  const L = Math.hypot(dx, dz);
  // Start on the road, pointing at the water, and drive straight in.
  car.placeAt(q.qx, q.qz, Math.atan2(dx / L, dz / L));

  let tWet = null;
  let tDeep = null;
  let tPlaced = null;
  let tDrivable = null;
  let deepest = 0;
  for (let i = 0; i < 60 * 20; i++) {
    const t = i * DT;
    car.update(DT, DRIVE);
    const surf = T.surface(car.x, car.z);
    const d = waterDepth(surf);
    if (d > deepest) deepest = d;
    if (d > 0 && tWet === null) tWet = t;
    if (d > 0.6 && tDeep === null) tDeep = t;
    const moved = rescue.update(DT, car, surf);
    if (moved && tPlaced === null) tPlaced = t;
    if (
      tPlaced !== null &&
      tDrivable === null &&
      t > tPlaced + 0.5 &&
      surf.onRoad > 0.45 &&
      d === 0 &&
      Math.hypot(car.vx, car.vz) > 3
    ) {
      tDrivable = t;
    }
    if (tDrivable !== null) break;
  }
  console.log(`  first wet ${tWet === null ? '-' : tWet.toFixed(2)} s, past 0.6 m at ${tDeep === null ? '-' : tDeep.toFixed(2)} s, deepest ${deepest.toFixed(1)} m`);
  console.log(`  said: ${log.join(' | ') || '(nothing)'}`);
  check(
    tPlaced !== null && tPlaced - tDeep < 2.4,
    'in deep water -> back on the road',
    `${(tPlaced - tDeep).toFixed(2)} s`,
    'about 2 s (1 s under + 1 s settling)',
  );
  check(
    tDrivable !== null,
    'and driving again, on a road, out of the water',
    `${(tDrivable - tDeep).toFixed(2)} s after going under`,
    'under 3 s',
  );
  check(placed() === 1, 'placed exactly once', `${placed()} placements`, '1');
}

console.log('\n── and it never fights you ───────────────────────────────────────');
{
  /* 1. Pottering about in the shallows. Found by search rather than by hand: a point in
   * 0.12–0.5 m of water with no deep water within four metres, which is the only honest
   * version of "deliberately near a shoreline" in a world whose banks are this steep. */
  let shelf = null;
  for (let z = LAKE.z - 300; z < LAKE.z + 220 && !shelf; z += 3) {
    for (let x = LAKE.x - 300; x < LAKE.x + 300; x += 3) {
      const d = depthAt(x, z);
      if (d < 0.12 || d > 0.5) continue;
      let ok = true;
      for (const [ox, oz] of [[5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, -4]]) {
        if (depthAt(x + ox, z + oz) > 0.55) ok = false;
      }
      if (ok) {
        shelf = { x, z, d };
        break;
      }
    }
  }
  const { car, rescue, placed } = makeRig();
  car.placeAt(shelf.x, shelf.z, 0);
  let worst = 0;
  // Half a minute of parking, then half a minute of paddling around in it.
  for (let i = 0; i < 60 * 30; i++) {
    car.update(DT, { steer: 0, throttle: 0, brake: 0, handbrake: 1, analogue: true });
    rescue.update(DT, car, T.surface(car.x, car.z));
    worst = Math.max(worst, rescue.depth);
  }
  for (let i = 0; i < 60 * 30; i++) {
    car.update(DT, { steer: Math.sin(i / 90) * 0.5, throttle: 0.25, brake: 0, handbrake: 0, analogue: true });
    rescue.update(DT, car, T.surface(car.x, car.z));
    worst = Math.max(worst, rescue.depth);
  }
  check(
    placed() === 0,
    `60 s in the shallows at (${shelf.x}, ${shelf.z}), ${shelf.d.toFixed(2)} m`,
    `${placed()} rescues`,
    `0 (deepest it got: ${worst.toFixed(2)} m)`,
  );
}
{
  // 2. Driving the lakeside road for a minute, with deep water nine metres away.
  const { car, rescue, placed } = makeRig();
  const auto = new Autopilot();
  const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
  const q = T.roads.query(LAKE.x, LAKE.z);
  car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
  auto.toggle(car);
  let nearestWater = Infinity;
  let offRoad = 0;
  for (let i = 0; i < 60 * 60; i++) {
    if (!auto.on) auto.toggle(car); // it drops out over rough ground; we want the whole minute
    const cmd = auto.update(car, NEUTRAL, DT) || NEUTRAL;
    car.update(DT, cmd);
    const surf = T.surface(car.x, car.z);
    rescue.update(DT, car, surf);
    if (surf.onRoad < 0.45) offRoad++;
    // How close the deep water got, to either side of the car
    for (const s of [6, 9, 12, 16, 20]) {
      const nx = Math.cos(car.yaw);
      const nz = -Math.sin(car.yaw);
      if (depthAt(car.x + nx * s, car.z + nz * s) > 0.6 || depthAt(car.x - nx * s, car.z - nz * s) > 0.6) {
        nearestWater = Math.min(nearestWater, s);
      }
    }
  }
  check(
    placed() === 0,
    `60 s of lakeside road (deep water ${nearestWater === Infinity ? '>20' : nearestWater} m off)`,
    `${placed()} rescues, ${(offRoad / 60).toFixed(1)} s off the carriageway`,
    '0 rescues',
  );
}
{
  // 3. Dipping in and out: a second under is not enough if you come straight back up.
  const { car, rescue, placed } = makeRig();
  // A hand-made surface record, so the dip is exact rather than terrain-dependent.
  const wet = new Float32Array(BIOME_COUNT);
  wet[4] = 1; // wetland, the biome with the highest water table
  const probe = (deep) => ({ w: wet, y: deep ? -3 : 12, onRoad: 0 });
  car.placeAt(LAKE.x, LAKE.z, 0);
  for (let cycle = 0; cycle < 12; cycle++) {
    for (let i = 0; i < 60 * 0.9; i++) rescue.update(DT, car, probe(true));
    for (let i = 0; i < 60 * 0.2; i++) rescue.update(DT, car, probe(false));
  }
  check(placed() === 0, '12 x (0.9 s under, 0.2 s out)', `${placed()} rescues`, '0 — the timer restarts');
  // ...and one continuous second is.
  for (let i = 0; i < 60 * 2.2; i++) rescue.update(DT, car, probe(true));
  check(placed() === 1, 'then 2.2 s under without a break', `${placed()} rescues`, '1');
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL GOOD'}\n`);
process.exit(failures ? 1 : 0);
