/* Wanderoad — lifting off, measured on the car alone.
 *
 * The browser suite's C4 reads a coast-down out in the world, which means it also reads
 * whatever hill, verge or lake the run-up happened to end on. This one takes the world out of
 * it: a flat tarmac plane, no road geometry, no slope, nothing to hit. What is left is the
 * engine braking, the rolling resistance and the aero — the three things "lifting off slows
 * you visibly" is actually about.
 *
 * It imports only vehicle.js and garage.js, so the same file runs unchanged against an older
 * checkout and the two numbers can be compared.
 *
 *   node tools/diag-coast.mjs
 */

import { Vehicle } from '../src/car/vehicle.js';
import { applyCarFeel, FLEET_BY_ID, FIRST_CAR } from '../src/game/garage.js';

const DT = 1 / 60;

/* A flat tarmac plane. Every field the solver reads off a real surface record, with the
 * values a road would give: level ground, full grip, on-road, no roughness. */
const W = new Float32Array(5);
W[0] = 1;
const FLAT = {
  height: () => 0,
  normal: () => [0, 1, 0],
  surface: (x, z) => ({
    w: W,
    dominant: 0,
    y: 0,
    nx: 0,
    ny: 1,
    nz: 0,
    onRoad: 1,
    roadDist: 0,
    roadTier: 0,
    roadTx: 0,
    roadTz: 1,
    grip: 1,
    rough: 0,
    surfaceKind: 'tarmac',
  }),
  roads: { query: () => ({ d: Infinity }), carve: () => ({ edge: 1, d: 0, tier: 0, tx: 0, tz: 1 }) },
};

const CAR = FLEET_BY_ID[FIRST_CAR];
applyCarFeel(CAR);
const car = new Vehicle({ tier: CAR.tier, terrain: FLAT, preset: CAR.feel.assist });
car.placeAt(0, 0, 0);

const GO = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
const OFF = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

const run = (target) => {
  car.placeAt(0, 0, 0);
  car.vx = car.vy = car.vz = 0;
  car.yawRate = 0;
  for (let i = 0; i < 60 * 40 && car.kph < target; i++) car.update(DT, GO);
  const v0 = car.kph;
  for (let i = 0; i < 60 * 6; i++) car.update(DT, OFF);
  const v1 = car.kph;
  return { v0, v1, decel: (v0 - v1) / 3.6 / 6 };
};

console.log(`\ncar "${CAR.id}" (${CAR.tier}, assists "${CAR.feel.assist}") on flat tarmac, lift off and coast for 6 s`);
for (const target of [40, 60, 90, 110]) {
  const r = run(target);
  console.log(
    `  from ${r.v0.toFixed(0).padStart(3)} km/h -> ${r.v1.toFixed(0).padStart(3)} km/h   ` +
      `= ${r.decel.toFixed(2)} m/s2   (C4 wants > 1.0)`
  );
}
