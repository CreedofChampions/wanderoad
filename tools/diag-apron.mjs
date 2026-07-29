/* Wanderoad — can you drive THROUGH the side of a petrol station forecourt?
 *
 * Operator on the station collision: "somewhat but not BOTTOM done". `tools/bench-props.mjs`
 * already drives a real car in off the road and into the kiosk, and that passes — the seven
 * things STANDING on a forecourt have hitboxes and stop you dead. What had no hitbox at all
 * was the forecourt itself. A station is a graded slab; on anything but flat ground it stands
 * proud of the land beside it with a batter skirt running down to meet it (real ground spread
 * under one apron: median 1.60 m, up to STATION_MAX_ROUGH). Aim at that face from the low side
 * and there was nothing there — the car drove through several metres of drawn tarmac and came
 * out under the canopy.
 *
 * The check bench-props already had could not see it, and that is the interesting part: it
 * slices the drawn station at BUMPER HEIGHT ABOVE THE PAD, and the whole apron face is BELOW
 * the pad. It measured 0.228 m of structure outside a hitbox and was correct about everything
 * it looked at.
 *
 * So this drives the REAL Vehicle, on the REAL heightfield, through the REAL Solids resolver,
 * at a REAL station, from BEARINGS ALL THE WAY ROUND, and reports metres of penetration past
 * the slab edge. It runs the identical set of approaches twice — once with the apron edge
 * colliders the tiler registers, once with them filtered out — so the number it prints is a
 * before/after on one station rather than an assertion.
 *
 * It also checks the opposite failure: the DOORWAY. The access spur has to arrive at an
 * opening, or the fix is a wall around every petrol station in the world.
 *
 *   node tools/diag-apron.mjs [seed]
 */

import { Object3D } from 'three';
import {
  stationsInBox, stationSpur, stationPad,
  STATION_APRON_HALF_WIDTH as AW, STATION_APRON_HALF_DEPTH as AD,
} from '../src/world/props.js';
import { Props } from '../src/render/props.js';
import { Terrain } from '../src/world/terrain.js';
import { Solids } from '../src/game/collide.js';
import { Vehicle } from '../src/car/vehicle.js';
import { clamp } from '../src/core/math.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
/** How many bearings to attack the forecourt from. 16 is every 22.5 degrees. */
const BEARINGS = 16;
/** Metres out from the apron centre each run starts. */
const RUN_UP = 26;
/** Arrival speed, m/s. 12 is 43 km/h — the same launch bench-props' kiosk run uses. */
const APPROACH_V = 12;
/** A slab edge lower than this is a kerb the car is meant to drive over (render/props.js
 *  APRON_KERB_MIN), so the car being inside the footprint there is correct, not a bug. */
const KERB = 0.55;
/** render/props.js APRON_DOOR_HALF — the opening the access spur arrives through. */
const DOOR_HALF = 4.2;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(56)} ${String(got).padStart(10)}   want ${want}`);
};

const scene = new Object3D();
const solids = new Solids();
const props = new Props({ seed: SEED, scene, solids });

/* A station whose apron actually stands proud of the ground on some side — a forecourt on
 * billiard-table ground has no face to drive through and would be a vacuous pass. */
const near = stationsInBox(-9000, -9000, 9000, 9000, SEED)
  .map((s) => ({ s, d: Math.hypot(s.x, s.z) }))
  .sort((a, b) => a.d - b.d)
  .slice(0, 10);

let st = null;
let T = null;
let padFace = 0;
for (const cand of near) {
  let live = null;
  for (let i = 0; i < 4000 && !live; i++) {
    props.update(1 / 60, cand.s.x, cand.s.z);
    live = props.stations.find((q) => q.key === cand.s.key) || null;
  }
  if (!live) continue;
  const TT = new Terrain(SEED, live.x - 140, live.z - 140, live.x + 140, live.z + 140, 120);
  const P = stationPad(live, (x, z) => TT.height(x, z));
  const face = P.y - P.lo;
  if (face > padFace) {
    padFace = face;
    st = live;
    T = TT;
  }
  if (padFace > 1.2) break;
}

check(!!st, 'a real, baked station to attack', st ? `${st.key} at ${st.x.toFixed(0)},${st.z.toFixed(0)}` : 'none', 'one');
if (!st) process.exit(1);
console.log(`       ${st.key}: slab top ${st.padY.toFixed(2)} m, the lowest ground under it ${(st.padY - padFace).toFixed(2)} m — a ${padFace.toFixed(2)} m face at its deepest`);

const ca = Math.cos(st.yaw);
const sa = Math.sin(st.yaw);
const L2W = (dx, dz) => [st.x + dx * ca - dz * sa, st.z + dx * sa + dz * ca];
const W2L = (x, z) => {
  const ox = x - st.x;
  const oz = z - st.z;
  return [ox * ca + oz * sa, -ox * sa + oz * ca];
};

/** Every collider near this station, split into the buildings and the apron edge. */
const all = [];
for (const list of solids.byChunk.values()) {
  for (const s of list) if (Math.hypot(s.x - st.x, s.z - st.z) < 40) all.push(s);
}
const apron = all.filter((s) => s.apron);
console.log(`       ${all.filter((s) => s.kind === 'station' && !s.apron).length} building colliders, ${apron.length} apron-edge colliders registered`);
check(apron.length > 0, 'the apron edge has colliders at all', apron.length, '> 0');

/**
 * Drive at the forecourt from `bearing` and report the deepest the car got INSIDE the slab's
 * own footprint while standing below its surface — i.e. how far it drove into drawn tarmac.
 * `withApron` false rebuilds the resolver without the apron edge, which is the before picture.
 */
function attack(bearing, withApron) {
  const scratch = new Solids();
  for (const [k, l] of solids.byChunk) scratch.addChunk(k, withApron ? l : l.filter((s) => !s.apron));
  const sx = st.x + Math.sin(bearing) * RUN_UP;
  const sz = st.z + Math.cos(bearing) * RUN_UP;
  const car = new Vehicle({ tier: 'touring', terrain: T, preset: 'cruise' });
  const heading = Math.atan2(st.x - sx, st.z - sz);
  car.placeAt(sx, sz, heading);
  car.speed = APPROACH_V;
  car.vx = Math.sin(heading) * APPROACH_V;
  car.vz = Math.cos(heading) * APPROACH_V;
  let deepest = 0;
  let inside = false;
  let throughFace = false;
  let entry = '';
  for (let k = 0; k < 60 * 12; k++) {
    let e = Math.atan2(st.x - car.x, st.z - car.z) - car.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    car.update(1 / 60, { steer: clamp(e * 3, -1, 1), throttle: 1, brake: 0, handbrake: 0, analogue: true });
    scratch.resolve(car, 1.05, 1 / 60);
    const [lx, lz] = W2L(car.x, car.z);
    const nowIn = Math.abs(lx) < AW && Math.abs(lz) < AD;
    if (!nowIn) {
      inside = false;
      throughFace = false;
      continue;
    }
    if (!inside) {
      /* The moment it crossed the boundary. WHICH EDGE it came over is the whole question:
       * coming in through the DOORWAY and then finding the slab standing over the ground
       * further in is the forecourt's own plinth, which is what a graded pad is and what the
       * batter skirt is drawn for — not a car driving through a wall. Only a crossing over a
       * stretch that is actually walled counts here. */
      inside = true;
      const doorway = lz > 0 && Math.abs(lx) < DOOR_HALF && AD - Math.abs(lz) < AW - Math.abs(lx);
      const face0 = st.padY - T.height(car.x, car.z);
      throughFace = !doorway && face0 > KERB;
      entry = `${doorway ? 'doorway' : 'face'} at local (${lx.toFixed(1)}, ${lz.toFixed(1)}), ${face0.toFixed(2)} m of slab there`;
    }
    if (!throughFace) continue;
    const face = st.padY - T.height(car.x, car.z);
    if (face <= KERB) continue;
    // How far past the nearest edge it is — the depth of the incursion.
    const d = Math.min(AW - Math.abs(lx), AD - Math.abs(lz));
    if (d > deepest) deepest = d;
  }
  return { deepest, entry };
}

console.log(`\n── ${BEARINGS} approaches at ${(APPROACH_V * 3.6).toFixed(0)} km/h, from ${RUN_UP} m out ──────────────────`);
let worstBefore = 0;
let worstAfter = 0;
let brokenBefore = 0;
let brokenAfter = 0;
for (let i = 0; i < BEARINGS; i++) {
  const b = (i / BEARINGS) * Math.PI * 2;
  const before = attack(b, false).deepest;
  const a2 = attack(b, true);
  const after = a2.deepest;
  if (before > 0.5) brokenBefore++;
  if (after > 0.5) brokenAfter++;
  if (before > worstBefore) worstBefore = before;
  if (after > worstAfter) worstAfter = after;
  const flag = after > 0.5 ? `  <-- still through, entered by the ${a2.entry}` : '';
  console.log(`       bearing ${((b * 180) / Math.PI).toFixed(0).padStart(3)}°  through the slab face: without the edge colliders ${before.toFixed(2)} m, with them ${after.toFixed(2)} m${flag}`);
}

console.log('');
console.log(`       worst penetration past the slab edge: ${worstBefore.toFixed(2)} m -> ${worstAfter.toFixed(2)} m`);
check(worstBefore > 0.5, 'the bug reproduces without the apron colliders (a real before)', `${worstBefore.toFixed(2)} m`, '> 0.5 m');
check(brokenAfter === 0, 'approaches that still drive through the slab face', `${brokenAfter}/${BEARINGS}`, '0');
check(worstAfter <= 0.5, 'deepest a car gets inside the raised slab (m)', worstAfter.toFixed(2), '<= 0.5');

/* ── and the doorway ────────────────────────────────────────────────────────
 * The other half of the requirement, and the one a wall-everything fix would break: a car
 * coming in off the road up the access spur has to REACH the pumps. */
console.log('\n── the way in ────────────────────────────────────────────────────────────');
{
  const scratch = new Solids();
  for (const [k, l] of solids.byChunk) scratch.addChunk(k, l);
  const sp = stationSpur(st);
  // Aim at the middle of the open apron, short of the pump island (local +1.0, r 1.55).
  const [tx, tz] = L2W(0, 3.6);
  const car = new Vehicle({ tier: 'touring', terrain: T, preset: 'cruise' });
  const heading = Math.atan2(tx - sp.mouthX, tz - sp.mouthZ);
  car.placeAt(sp.mouthX, sp.mouthZ, heading);
  car.speed = 6;
  car.vx = Math.sin(heading) * 6;
  car.vz = Math.cos(heading) * 6;
  let closest = Infinity;
  for (let k = 0; k < 60 * 12; k++) {
    let e = Math.atan2(tx - car.x, tz - car.z) - car.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    car.update(1 / 60, { steer: clamp(e * 3, -1, 1), throttle: 0.55, brake: 0, handbrake: 0, analogue: true });
    scratch.resolve(car, 1.05, 1 / 60);
    closest = Math.min(closest, Math.hypot(car.x - tx, car.z - tz));
  }
  console.log(`       drove up the spur from its mouth at 22 km/h; closest approach to the pump apron ${closest.toFixed(2)} m`);
  check(closest < 3.0, 'the access spur still gets a car onto the forecourt', `${closest.toFixed(2)} m`, '< 3 m (not walled out)');
}

console.log(failures ? `\n${failures} APRON CHECK(S) FAILED` : '\nall apron checks passed');
process.exit(failures ? 1 : 0);
