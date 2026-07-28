/* Wanderoad — the water rescue, on the real world.
 *
 * W7 says water is a trap: you drive in and you are stuck. It is worse than stuck — the bank
 * drops at about 35 degrees and the bed is flat, so the car simply carries on driving along
 * the bottom of the lake, eleven metres under, forever. This measures the way out.
 *
 * Two things have to be true and they pull against each other:
 *   - touch the water, and you are back on a road and driving inside about a second
 *   - potter about at the shoreline, or drive a lakeside road, and NOTHING happens
 *
 * 2026-07-27 — "Water = respawn (R) on contact not float under". The first of those got much
 * stricter: the gate is now 0.25 m of water held for 0.25 s, then 0.35 s of settling, instead
 * of 0.6 m held for a second and a second of settling. So the timings asserted below are
 * measured from FIRST CONTACT with the water rather than from crossing the old 0.6 m line,
 * and the dip test now runs at the scale of the new arming window instead of the old one — a
 * 0.9 s submersion is no longer a "dip", it is the thing the operator asked to be rescued
 * from, and there is a check below that proves it now fires. The false-positive set is
 * otherwise unchanged and still has to come out at zero.
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
 * both present and invisible.
 *
 * FOUND BY SEARCH, not written down, and that change is the point rather than tidiness. This
 * was the hard-coded pair (968, -160) — a real lakeside road on the shipped seed when it was
 * written, and no longer a road at all: it was one of the causeways, and roads no longer run
 * across open water (see world/roads.js's water cull, and tools/diag-causeway.mjs). The whole
 * rig then quietly degenerated, because `T.roads.query` returns d = Infinity with qx/qz at
 * their (0, 0) defaults when nothing is in range — so the car was placed at the origin,
 * pointed at nothing, never got wet, and FOUR checks failed reporting "0.00 s" as though the
 * rescue had stopped working. It had not; the fixture had.
 *
 * The rest of this file already searches for its own shelf point rather than naming one ("the
 * only honest version of 'deliberately near a shoreline'"). Same discipline here: scan
 * outward from the old point for a place that genuinely IS what the test needs — deep water
 * with a road on the bank — so a future world change moves the fixture instead of silently
 * hollowing it out. Deterministic: fixed scan order, first hit wins. */
function findLakesideRoad() {
  const scan = new Terrain(SEED, -3000, -3000, 3000, 3000, 240);
  const w = new Float32Array(BIOME_COUNT);
  const depth = (x, z) => {
    const y = scan.height(x, z);
    scan.weights(x, z, w);
    const wy = waterLevelAt(w, y);
    return wy === null ? 0 : wy - y;
  };
  /* A plain grid, then the qualifying point nearest the historical fixture. A radial sweep was
   * tried first and is a bad shape for this: its angular spacing is metres at small radius and
   * a hundred metres at large, so it walks straight past a shoreline that a uniform grid finds
   * immediately. Nearest-to-(968,-160) rather than first-hit so the fixture stays as close to
   * the site this file's recorded numbers were measured at as the world still allows. */
  let best = null;
  for (let z = -3500; z <= 3500; z += 25) {
    for (let x = -3500; x <= 3500; x += 25) {
      // Deep enough that driving in is unambiguous, with tarmac close enough to walk back to.
      if (depth(x, z) < 1.5) continue;
      const q = scan.roads.query(x, z);
      if (!isFinite(q.d) || q.d > 45 || q.d < 12) continue;
      // ...and the road itself must be dry, or this is a ford, not a bank.
      if (depth(q.qx, q.qz) > 0) continue;
      const dd = Math.hypot(x - 968, z + 160);
      if (!best || dd < best.dd) best = { x, z, dd };
    }
  }
  if (!best) throw new Error('bench-rescue: no lakeside road found in a 7 km square about the origin');
  return { x: best.x, z: best.z };
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
  // Named so the expectations below quote the shipped numbers rather than restating them.
  const CONTACT = 0.25;
  const { car, rescue, log, placed } = makeRig();
  const q = T.roads.query(LAKE.x, LAKE.z);
  const dx = LAKE.x - q.qx;
  const dz = LAKE.z - q.qz;
  const L = Math.hypot(dx, dz);
  // Start on the road, pointing at the water, and drive straight in.
  car.placeAt(q.qx, q.qz, Math.atan2(dx / L, dz / L));

  let tWet = null;
  let tContact = null;
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
    if (d > CONTACT && tContact === null) tContact = t;
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
  const f = (v) => (v === null ? '-' : v.toFixed(2));
  console.log(`  first wet ${f(tWet)} s, past ${CONTACT} m at ${f(tContact)} s, past 0.6 m at ${f(tDeep)} s, deepest ${deepest.toFixed(1)} m`);
  console.log(`  said: ${log.join(' | ') || '(nothing)'}`);
  check(
    tPlaced !== null && tPlaced - tContact < 1.0,
    'water contact -> back on the road',
    `${(tPlaced - tContact).toFixed(2)} s`,
    'about 0.6 s (0.25 s in + 0.35 s settling)',
  );
  check(
    tPlaced !== null && tPlaced - tWet < 1.2,
    'measured from the very first drop of water',
    `${(tPlaced - tWet).toFixed(2)} s`,
    'under 1.2 s',
  );
  check(
    tDrivable !== null && tDrivable - tContact < 1.6,
    'and driving again, on a road, out of the water',
    `${(tDrivable - tContact).toFixed(2)} s after contact`,
    'under 1.6 s',
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
/* A hand-made surface record, so the dips below are exact rather than terrain-dependent.
 * `deep` is the bottom of a lake; `wash` is 0.14 m — the depth measured at the water's edge on
 * the dunes at (668, -439), i.e. the surf on a beach; `dry` is well clear of any water table. */
const wet = new Float32Array(BIOME_COUNT);
wet[4] = 1; // wetland, the biome with the highest water table
const WATER_TABLE = waterLevelAt(wet, -99);
const probe = (kind) => ({
  w: wet,
  y: kind === 'deep' ? -3 : kind === 'wash' ? WATER_TABLE - 0.14 : WATER_TABLE + 9,
  onRoad: 0,
});
{
  /* 3. Dipping in and out — a ford, or clipping a shoreline. The window is the ARMING window,
   * so this runs at the new scale: 0.2 s in the water is four metres of ford at 70 km/h, or a
   * corner cut through the edge of a lake, and it has to pass straight through. */
  const { car, rescue, placed } = makeRig();
  car.placeAt(LAKE.x, LAKE.z, 0);
  for (let cycle = 0; cycle < 12; cycle++) {
    for (let i = 0; i < 60 * 0.2; i++) rescue.update(DT, car, probe('deep'));
    for (let i = 0; i < 60 * 0.2; i++) rescue.update(DT, car, probe('dry'));
  }
  check(placed() === 0, '12 x (0.2 s under, 0.2 s out) — fords, clipped shores', `${placed()} rescues`, '0 — the timer restarts');
  // ...and staying in is not.
  for (let i = 0; i < 60 * 1.0; i++) rescue.update(DT, car, probe('deep'));
  check(placed() === 1, 'then 1.0 s under without a break', `${placed()} rescues`, '1');
}
{
  /* 4. Standing in the surf. Same 0.14 m the dunes shoreline measures, off the road, for a
   * solid minute — the case that rules out gating on d > 0 rather than on a contact depth. */
  const { car, rescue, placed } = makeRig();
  car.placeAt(LAKE.x, LAKE.z, 0);
  for (let i = 0; i < 60 * 60; i++) rescue.update(DT, car, probe('wash'));
  check(placed() === 0, '60 s parked in 0.14 m of beach wash', `${placed()} rescues`, '0');
}
{
  /* 5. And the thing the operator actually reported. The old gate let the car sit in a metre
   * of water for two full seconds before anything happened; a 0.9 s submersion used to be
   * short enough to pass unnoticed entirely. It is not "a dip" — it is floating under. */
  const { car, rescue, placed } = makeRig();
  car.placeAt(LAKE.x, LAKE.z, 0);
  let tFired = null;
  for (let i = 0; i < 60 * 0.9 && tFired === null; i++) {
    if (rescue.update(DT, car, probe('deep'))) tFired = i * DT;
  }
  check(
    tFired !== null && tFired < 0.7,
    'the old 0.9 s "dip" now IS a rescue (it used to be 0)',
    `fired at ${tFired === null ? 'never' : `${tFired.toFixed(2)} s`}`,
    'under 0.7 s — this is the reported bug',
  );
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL GOOD'}\n`);
process.exit(failures ? 1 : 0);
