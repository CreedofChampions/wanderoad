// created by AI
/* Wanderoad — Reset to Road must not turn you around.
 *
 * Operator, verbatim: "Reset to Road needs to check your cardinal direction... so you continue
 * in that direction." backToRoad() in src/main.js used to place the car facing straight along
 * Math.atan2(q.tx, q.tz) — the road's raw tangent, which is only ever ONE of the two directions
 * a road runs. A driver heading north who strayed off could press R and be spun to face south.
 *
 * The fix is closestHeading() in src/core/math.js: given the car's own yaw (read BEFORE
 * placeAt() overwrites it) and the road's raw tangent, it keeps whichever of the tangent or its
 * exact opposite is the shorter turn — so R can never turn the car more than a quarter turn
 * from the direction it was already facing.
 *
 * This traces the REAL Vehicle through the REAL math, the same placeAt() call backToRoad()
 * itself makes: yaw before R, the tangent the road query would have handed back, and yaw after
 * — for tangents pointing both ways along both a north/south and an east/west road, so both
 * directions are proven, not just the one that happens to already work.
 *
 *   node tools/diag-reset-heading.mjs
 */

import { closestHeading, angleDelta, RAD2DEG } from '../src/core/math.js';
import { Vehicle } from '../src/car/vehicle.js';
import { FLEET, applyCarFeel } from '../src/game/garage.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

const CAR = FLEET[0];
applyCarFeel(CAR);
// Flat, on-road, nothing else in play — this is a heading question, not a physics one.
const world = {
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};

/** The exact sequence backToRoad() runs: read car.yaw, hand it and the road's raw tangent to
 *  closestHeading(), then placeAt() with the result — on a REAL Vehicle, not a bare number. */
function pressR(yawBefore, tangent) {
  const car = new Vehicle({ tier: CAR.tier, terrain: world, preset: CAR.feel.assist });
  car.placeAt(0, 0, yawBefore);
  const heading = closestHeading(car.yaw, tangent);
  car.placeAt(1, 1, heading); // the same placeAt() backToRoad() calls with the road query's point
  return car.yaw;
}

console.log('\nWANDEROAD — RESET-TO-ROAD HEADING\n' + '-'.repeat(70));

const NORTH = Math.atan2(0, 1); // a road running due north/south, tangent read as "north"
const EAST = Math.PI / 2; // a road running due east/west, tangent read as "east"

console.log('\nyaw before R    road tangent    yaw after R    turned by      driving...');
const cases = [
  ['already facing the way the tangent points', NORTH + 0.02, NORTH],
  ['facing dead opposite the tangent (this is the operator\'s complaint)', NORTH + Math.PI - 0.02, NORTH],
  ['drifted off at an angle, closer to the tangent', NORTH + 1.1, NORTH],
  ['drifted off at an angle, closer to the tangent\'s opposite', NORTH + Math.PI + 0.8, NORTH],
  ['east/west road: already facing the tangent', EAST - 0.1, EAST],
  ['east/west road: facing dead opposite the tangent', EAST + Math.PI + 0.1, EAST],
];
let neverReversed = true;
for (const [label, before, tangent] of cases) {
  const after = pressR(before, tangent);
  const turned = Math.abs(angleDelta(before, after));
  // closestHeading only ever picks between the tangent and its exact opposite, so this is a
  // hard guarantee of the function, not a tolerance — but it is checked against the REAL
  // Vehicle's REAL resulting yaw, not the pure function in isolation.
  if (turned > Math.PI / 2 + 1e-6) neverReversed = false;
  console.log(
    `   ${(before * RAD2DEG).toFixed(0).padStart(5)}°          ${(tangent * RAD2DEG).toFixed(0).padStart(5)}°           ${(after * RAD2DEG).toFixed(0).padStart(5)}°         ${(turned * RAD2DEG).toFixed(0).padStart(4)}°       ${label}`
  );
}
check(
  'pressing R never turns the car more than a quarter turn from its own heading, on both a N/S and an E/W road, approaching from either side',
  neverReversed,
  `${cases.length} cases traced through a real Vehicle.placeAt()`
);

/* The two literal headings the operator described, checked against an exact expected yaw
 * rather than just "didn't reverse" — this is the part that would have failed before the fix,
 * when backToRoad() always used the raw tangent regardless of car.yaw. */
const sameWay = pressR(NORTH, NORTH);
check(
  'facing the same way the tangent points: R keeps that exact heading (the old code also passed this one)',
  Math.abs(angleDelta(sameWay, NORTH)) < 1e-9,
  `${(sameWay * RAD2DEG).toFixed(1)}°`
);
const oppositeWay = pressR(NORTH + Math.PI, NORTH);
check(
  'facing dead opposite the tangent: R keeps the car facing the way it was already driving, not the raw road tangent — THIS is what the old `Math.atan2(q.tx, q.tz)` alone got backwards',
  Math.abs(angleDelta(oppositeWay, NORTH + Math.PI)) < 1e-9,
  `${(oppositeWay * RAD2DEG).toFixed(1)}° (raw tangent was ${(NORTH * RAD2DEG).toFixed(1)}°)`
);

/* The pure function on its own, at the exact boundary — the one spot the Vehicle trace above
 * cannot probe precisely because placeAt() doesn't round-trip a boundary yaw exactly. */
check(
  'at precisely a quarter turn either side, closestHeading is not caught between the two — it always returns one or the other, never something in between',
  [closestHeading(NORTH + Math.PI / 2, NORTH), closestHeading(NORTH - Math.PI / 2, NORTH)].every(
    (h) => Math.abs(angleDelta(h, NORTH)) < 1e-9 || Math.abs(angleDelta(h, NORTH + Math.PI)) < 1e-9
  ),
  'boundary inputs resolve cleanly to the tangent or its opposite'
);

console.log('\n' + '-'.repeat(70));
console.log(failed ? `${failed} CHECK(S) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
