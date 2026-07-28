/* Wanderoad — is another player's car the car they are actually driving?
 *
 * The playtest verdict was: "both tabs were on 'estate', but the player's own car is a loaded
 * GLB (scene node car:estate / NormalCar2_*) while remotes are built by buildGhostCar in
 * src/car/model.js, which only has three procedural shapes (CAR_TIERS = gt/sports/hyper) ...
 * Seven cars collapse to three ghost bodies and none of them is the model being driven."
 *
 * src/net/ghostCar.js fixes that by loading the same per-fleet GLB the driver is driving. This
 * tool checks the half of that which can honestly be checked in node:
 *
 *   - every fleet index 0..6 resolves to its OWN car, not to three shared silhouettes. That is
 *     the actual defect: seven cars, seven answers.
 *   - a ghost is usable IMMEDIATELY. src/net/remotes.js's _spawn() is synchronous and cannot
 *     await a 180 KB download, so the handle has to come back with a live Object3D in it on
 *     the same tick or a peer has nothing to interpolate into.
 *   - update() drives the wheels off the wire's own steer/brake/velocity, which no ghost has
 *     ever done — remotes.js has called `rec.api?.update?.(pose, dt)` for a long time and
 *     buildGhostCar's handle has no such method.
 *   - dispose() is safe at any point, INCLUDING while the GLB is still in flight, which is the
 *     one path a peer driving out of range takes every time.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM: node has no fetch-backed GLTFLoader here, so the GLB
 * load fails and the procedural stand-in remains. That makes this a test of the FALLBACK and
 * of the identity mapping, not of the loaded model appearing. `ghostStats.upgraded` in a real
 * browser is the number that proves the GLB landed, and it is exposed on window.WANDEROAD.
 *
 *   node tools/diag-ghostcar.mjs
 */

import { Object3D } from 'three';
import { makeGhostFactory, ghostStats } from '../src/net/ghostCar.js';
import { FLEET } from '../src/game/garage.js';
import { CAR_TIERS } from '../src/car/model.js';

const factory = makeGhostFactory({ base: 'file:///nonexistent/models/cars/' });

console.log('\nWanderoad — remote players\' car models\n');
console.log(`  the fleet is ${FLEET.length} cars: ${FLEET.map((c) => c.id).join(', ')}`);
console.log(`  the OLD ghost had ${CAR_TIERS.length} shapes: ${CAR_TIERS.join(', ')}\n`);

const ghosts = [];
const ids = new Set();
let immediate = 0;
let updatesOk = 0;
console.log('    wire tier   fleet car     ghost root name        has a body on frame 1');
for (let tier = 0; tier < FLEET.length; tier++) {
  const g = factory({ tier, paint: tier % 6 });
  ghosts.push(g);
  ids.add(g.carId);
  const hasBody = g.root instanceof Object3D && g.root.children.length > 0;
  if (hasBody) immediate++;
  console.log(
    `    ${String(tier).padStart(9)}   ${FLEET[tier].id.padEnd(12)}  ${g.root.name.padEnd(22)} ${hasBody ? 'yes' : 'NO'}`
  );
  // The wire's own fields, as remotes.js's interpolator hands them over.
  try {
    for (let f = 0; f < 30; f++) g.update({ steer: 0.4, brake: 0.2, vx: 0, vz: 26, throttle: 1 }, 1 / 60);
    g.update(null, 1 / 60); // remotes can call this before a pose exists
    updatesOk++;
  } catch (err) {
    console.log(`      update() threw: ${err.message}`);
  }
}

/* Out of range while the model is still loading — the ordinary path every peer takes when
 * it drives away, and the one that leaks a whole car's geometry if dispose() cannot cope with
 * an in-flight promise. */
const transient = factory({ tier: 2, paint: 0 });
let disposeThrew = null;
try {
  transient.dispose();
  transient.dispose(); // twice: remotes despawns once, but idempotence is cheap insurance
} catch (err) {
  disposeThrew = err.message;
}

console.log(`\n  distinct cars across the 7 wire tiers: ${ids.size} (${[...ids].join(', ')})`);
console.log(`  ghostStats: built ${ghostStats.built}, upgraded ${ghostStats.upgraded}, failed ${ghostStats.failed}, live ${ghostStats.live}`);

// An out-of-range wire value must not throw inside a network tick.
let oob = null;
try {
  const g = factory({ tier: 99, paint: 400 });
  oob = g.root.children.length > 0;
  g.dispose();
} catch (err) {
  oob = err.message;
}

const checks = [
  ['all seven wire tiers resolve to seven DIFFERENT cars', ids.size === FLEET.length, `${ids.size} distinct of ${FLEET.length}`],
  ['...which is more than the three shapes the old ghost had', ids.size > CAR_TIERS.length, `${ids.size} vs ${CAR_TIERS.length}`],
  ['every ghost has a body on the frame it is created', immediate === FLEET.length, `${immediate} of ${FLEET.length}`],
  ['update() drives the wheels without throwing', updatesOk === FLEET.length, `${updatesOk} of ${FLEET.length}`],
  ['update() survives a null pose', updatesOk === FLEET.length, 'remotes calls it before the buffer fills'],
  ['dispose() is safe mid-load and idempotent', disposeThrew === null, disposeThrew ?? 'disposed twice, cleanly'],
  ['an out-of-range tier off the wire does not throw', oob === true, String(oob)],
  ['the live count is book-kept', ghostStats.live === FLEET.length, `${ghostStats.live} live, ${ghostStats.built} built`],
];

console.log('');
let failed = 0;
for (const [nm, ok, detail] of checks) {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${nm}  — ${detail}`);
  if (!ok) failed++;
}
console.log(`
 NOTE  the GLB itself cannot load in node, so every ghost above is still on its procedural
       stand-in — which is what makes this a fallback test. That the REAL model appears is
       proven by ghostStats.upgraded being non-zero in a live browser with a peer present,
       and by the ghost no longer being a translucent angular sedan in a screenshot.
`);
console.log(`${failed === 0 ? 'all checks passed' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
