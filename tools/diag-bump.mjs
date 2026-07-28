/* Wanderoad — how hard does the off-road bump field throw the car?
 *
 * src/car/vehicle.js's loose-surface block used to add a vertical impulse straight to `this.vy`:
 *
 *   this.vy += wob * loose * Math.min(vMag, 24) * 0.055 * dt * 60;
 *
 * `0.055 * 60` is 3.3, so that term is an ACCELERATION of `wob * loose * vMag * 3.3` m/s².
 * Off the carriageway (loose 1) at this car's own off-road terminal speed of 12.2 m/s that is
 * 40 m/s² — four gravities — and `wob` is a position hash whose low-frequency half only
 * changes every 1/0.31 = 3.2 m, so it holds ONE SIGN for a quarter of a second at a time.
 * A quarter of a second of net upward acceleration at 4 g is not a bump, it is a launch.
 *
 * This measured it rather than asserting it, and it is what the fix is anchored to. On dead
 * flat, level ground, with the terrain contributing nothing whatsoever:
 *
 *              straight off-road run          full-lock U-turn
 *   before     23% of it AIRBORNE, 0.60 m      132 deg in 7 s, 8% airborne
 *   after       0%,                 0.33 m      146 deg in 7 s, 0% airborne
 *
 * A car in the air steers nothing, which is why this showed up as "C3 you can stop and turn
 * around" failing. Tarmac is untouched in both columns (0% either way) — the block is gated
 * on being off the carriageway. Re-run this after any change to the loose-surface block or to
 * BUMP_MAX_A; if the "airborne" column is not 0% on flat ground, the launch is back.
 *
 *   node tools/diag-bump.mjs
 */

import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { applyCarFeel, FLEET } from '../src/game/garage.js';

const CAR = FLEET[1];
applyCarFeel(CAR);

const world = (grip, onRoad) => ({
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip, rough: 0,
                    surfaceKind: onRoad ? 'tarmac' : 'ground', onRoad, dominant: 0 }),
  height: () => 0,
});

/** Straight-line run: how much air does the car get on flat, level ground? */
function airTime(grip, onRoad, secs = 12) {
  const car = new Vehicle({ tier: CAR.tier, terrain: world(grip, onRoad), preset: CAR.feel.assist });
  car.placeAt(0, 0, 0);
  const input = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: false };
  let off = 0, n = 0, worstY = 0, prevY = car.y;
  let maxRise = 0;
  for (let i = 0; i < Math.round(secs / PHYSICS_DT); i++) {
    car._step(PHYSICS_DT, input);
    if (i * PHYSICS_DT > 4) { // once it is up to speed
      n++;
      if (!car.onGround) off++;
      worstY = Math.max(worstY, car.y);
      maxRise = Math.max(maxRise, car.y - prevY);
    }
    prevY = car.y;
  }
  return { airFrac: off / Math.max(n, 1), peakY: worstY, kph: car.kph, maxRise };
}

/** Full-lock U-turn from rest, reporting time off the ground as well as the turn. */
function uturn(grip, onRoad, secs = 7) {
  const car = new Vehicle({ tier: CAR.tier, terrain: world(grip, onRoad), preset: CAR.feel.assist });
  car.placeAt(0, 0, 0);
  const input = { steer: 1, throttle: 1, brake: 0, handbrake: 0, analogue: false };
  let net = 0, prev = car.yaw, off = 0, n = 0;
  for (let i = 0; i < Math.round(secs / PHYSICS_DT); i++) {
    car._step(PHYSICS_DT, input);
    let d = car.yaw - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    net += d; prev = car.yaw;
    n++; if (!car.onGround) off++;
  }
  return { deg: net * 57.3, airFrac: off / n, kph: car.kph };
}

console.log('\nFlat, level ground — the terrain contributes NOTHING, every bump below is the');
console.log('loose-surface impulse in vehicle.js and nothing else.\n');
for (const [label, grip, onRoad] of [['tarmac', 1.0, 1], ['grass ', 0.57, 0]]) {
  const a = airTime(grip, onRoad);
  const u = uturn(grip, onRoad);
  console.log(
    `  ${label}  straight run: ${(a.airFrac * 100).toFixed(0).padStart(3)}% of the time OFF THE GROUND, ` +
    `peak ${a.peakY.toFixed(2)} m, ${a.kph.toFixed(0)} km/h\n` +
    `          full-lock U-turn: ${u.deg.toFixed(0).padStart(4)} deg in 7 s, ` +
    `${(u.airFrac * 100).toFixed(0).padStart(3)}% of it off the ground`
  );
}
console.log('');
