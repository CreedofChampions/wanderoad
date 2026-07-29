/* Wanderoad — boat mode, on the real world.
 *
 *   node tools/bench-boat.mjs
 *
 * Four questions, all against the REAL Vehicle solver and a REAL Terrain sampler on the
 * shipped seed — nothing here is simulated twice:
 *
 *   1. LOCKED: driving flat-out at a lakeshore with no boat, does the car actually stop
 *      short of the water rather than wallowing in it — no rescue-teleport needed at all.
 *   2. LOCKED + A REAL RESCUE: the same question again, but with a genuine src/game/rescue.js
 *      Rescue instance wired in exactly as main.js wires it — the playtest blocker this file
 *      exists to close ("locked water barrier still rescue-teleports on steep banks") was never
 *      visible to section 1 above, because section 1 has no Rescue object to teleport with at
 *      all; it could only ever prove the barrier's own numbers looked fine in isolation.
 *   3. UNLOCKED: does the boat actually engage, actually cover real ground on open water, and
 *      actually hand back a normal, drivable car on the way out.
 *   4. CONTROL RETENTION: nose the boat into the SAME steep bank section 2 uses and let the
 *      exit test decline it — does the one-shot pushback (src/game/boat.js's `_stepActive`, fix
 *      round 2) actually give the wheel back afterwards, or does it re-eat every frame of input
 *      the way the bug report described ("the boat freezes at any steep shoreline nose-in, no
 *      input works")? Sections 1-3 never drove a boat AT a steep bank from open water — section
 *      1/2's car never gets there (the barrier stops it before the shore), and section 3's own
 *      UNLOCKED shore is deliberately gentle (findLakesideRoad()'s own hasGentleLanding() gate)
 *      — so this is the one section that actually exercises the bounce path at all.
 *
 * The lakeside fixtures are FOUND BY SEARCH, the same discipline tools/bench-rescue.mjs already
 * uses and for the same reason stated there: a hard-coded coordinate silently rots the moment
 * the world generator changes, and failing checks that all read "0.00" look like a broken
 * feature when the fixture, not the feature, is what broke. Sections 2 and 4 reuse
 * tools/diag-playtest-fixtures.mjs's own finder rather than this file's own findLakesideRoad()
 * below — that finder additionally proves out a nearby gem and a dry road, which neither section
 * needs, but it is the SAME fixture the browser playtest (tools/diag-playtest-boat.mjs) drives
 * against, so a bank steep enough to have tripped the old rescue-teleport bug there (section 2)
 * is steep enough to be worth testing the new bounce-and-recover path against too (section 4).
 * That finder's own `road`/`water`/`headingOut`/`shoreProfile` are untouched by its OWN fix
 * round 2 (a separate `beachHome` field was added instead, for testVoyage's own sail-home leg —
 * see that file's own comment), so this stays the same steep shore both sections have always
 * used.
 */

import { Terrain, isDryAt } from '../src/world/terrain.js';
import { BIOME_COUNT, waterLevelAt } from '../src/world/biomes.js';
import { Vehicle } from '../src/car/vehicle.js';
import { BoatMode, BOAT_MAX_KPH, EXIT_DEPTH, EXIT_PROBE_DIST, EXIT_STEEP_SLOPE } from '../src/game/boat.js';
import { Rescue, waterDepth as rescueWaterDepth } from '../src/game/rescue.js';
import { findFixture } from './diag-playtest-fixtures.mjs';

const SEED = 20260726;
const DT = 1 / 60;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(52)} ${String(got).padStart(14)}   want ${want}`);
};

/* Same shape as bench-rescue.mjs's own findLakesideRoad(): a plain grid scan for a point that
 * is genuinely deep water with a genuinely dry road close enough to drive from. Also requires
 * a BEACHABLE immediate shoreline — src/game/boat.js's own EXIT_STEEP_SLOPE fix (issue 2 of
 * this fix round) declines the exit onto anything steeper than that, and the shipped seed's
 * banks are steep enough (rescue.js's own note: "~35°") that the first candidate the old,
 * slope-blind version of this search returned turned out to be one of them — the UNLOCKED
 * voyage below never beached there any more, not because the fix is wrong but because that
 * particular shore genuinely is too steep to land a boat on nose-first. Filtering here for a
 * shore this class will actually let the boat use is docs/BOAT-PLAN.md's own suggested fallback
 * ("assert via the existing voyage that exit still happens on the gentle shore") rather than
 * softening the fix to fit the fixture. */
function findLakesideRoad() {
  const scan = new Terrain(SEED, -3000, -3000, 3000, 3000, 240);
  const w = new Float32Array(BIOME_COUNT);
  const depth = (x, z) => {
    const y = scan.height(x, z);
    scan.weights(x, z, w);
    const wy = waterLevelAt(w, y);
    return wy === null ? 0 : wy - y;
  };
  /** True if a boat driving from the road at (qx, qz) out toward (x, z) has, along that line,
   *  a landing spot shallower than EXIT_DEPTH whose own approach is gentle enough that
   *  src/game/boat.js's exit check would actually let it through — the SAME probe that class
   *  runs itself (EXIT_PROBE_DIST ahead, EXIT_STEEP_SLOPE bar), just walked here in 0.5 m
   *  steps to find where depth first crosses EXIT_DEPTH along the way. */
  const hasGentleLanding = (qx, qz, x, z) => {
    const dx = x - qx,
      dz = z - qz;
    const L = Math.hypot(dx, dz);
    const ux = dx / L,
      uz = dz / L;
    for (let s = 0; s <= 30; s += 0.5) {
      if (depth(qx + ux * s, qz + uz * s) < EXIT_DEPTH) continue;
      const hereY = scan.height(qx + ux * s, qz + uz * s);
      const aheadY = scan.height(qx + ux * (s - EXIT_PROBE_DIST), qz + uz * (s - EXIT_PROBE_DIST));
      return (aheadY - hereY) / EXIT_PROBE_DIST <= EXIT_STEEP_SLOPE;
    }
    return false; // never got wet along this line inside 30 m
  };
  for (let z = -3500; z <= 3500; z += 25) {
    for (let x = -3500; x <= 3500; x += 25) {
      if (depth(x, z) < 2.0) continue; // real open water, not a damp margin
      const q = scan.roads.query(x, z);
      if (!isFinite(q.d) || q.d > 45 || q.d < 12) continue;
      if (depth(q.qx, q.qz) > 0) continue; // the road itself must be dry — a bank, not a ford
      if (!hasGentleLanding(q.qx, q.qz, x, z)) continue;
      return { x, z, q };
    }
  }
  throw new Error('bench-boat: no lakeside road with a beachable shore found in a 7 km square about the origin');
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

console.log('\n── LOCKED + A REAL RESCUE: the barrier, not the teleport, owns the water ──');
{
  /* tools/diag-playtest-fixtures.mjs's own finder rather than this file's findLakesideRoad()
   * above — see the file header for why: it is the SAME fixture the browser playtest drives,
   * which is where the "still rescue-teleports on steep banks" report actually came from. */
  const FIX = findFixture(SEED);
  console.log(`  steep-bank fixture: road (${FIX.road.x}, ${FIX.road.z}) -> water (${FIX.water.x}, ${FIX.water.z}), shore ${FIX.shoreProfile}`);

  const FT = new Terrain(SEED, FIX.road.x - 320, FIX.road.z - 320, FIX.road.x + 320, FIX.road.z + 320, 240);
  const car = new Vehicle({ tier: 'sports', terrain: FT, preset: 'sport' });
  car.placeAt(FIX.road.x, FIX.road.z, FIX.headingOut);

  const wallet = { boatUnlocked: false }; // a locked wallet stub — exactly what boat.js reads
  const boat = new BoatMode({ wallet, terrain: () => FT });
  let recoverCalls = 0;
  /* A REAL Rescue, wired exactly as main.js wires it: recover() counts invocations instead of
   * actually placing the car (nothing here needs backToRoad()'s road-finding), and `skip` is
   * main.js's own formula verbatim — `boatMode.active || (wallet.boatUnlocked && inWater)` —
   * against this SAME BoatMode instance and this SAME locked wallet stub. */
  const rescue = new Rescue({
    recover: () => {
      recoverCalls++;
    },
    skip: (inWater) => boat.active || (wallet.boatUnlocked && inWater),
  });

  let deepest = 0;
  for (let i = 0; i < 60 * 30; i++) {
    if (!boat.active) car.update(DT, DRIVE);
    // Pre-collision surf, matching main.js's own ordering (boat.update() runs before this
    // bench's stand-in for solids.resolve(), which does not exist here — there is nothing to
    // collide with at open water).
    boat.update(DT, car, FT.surface(car.x, car.z), DRIVE);
    // Then a FRESH sample, exactly like main.js's own post-collision `surf` that rescue.update()
    // actually reads — boat.update() itself can move the car (the barrier's own positional
    // clamp, workstream C's fix for this same bug), so re-sampling here is load-bearing, not
    // decoration.
    const surf = FT.surface(car.x, car.z);
    rescue.update(DT, car, surf);
    const d = rescueWaterDepth(surf);
    if (d > deepest) deepest = d;
  }
  console.log(`  30 s of pinned throttle: recover() called ${recoverCalls} time(s); deepest the car itself ever got ${deepest.toFixed(2)} m`);
  check(recoverCalls === 0, 'the real Rescue never teleports while the boat is locked', recoverCalls, '0');
  check(deepest < 0.25, "the car never gets wet enough to trip rescue's own contact gate", deepest.toFixed(2), '< 0.25 m');
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
  let enterDepth = 0, approachKph = 0, prevKph = 0;
  for (let i = 0; i < 60 * 10 && enteredAt === null; i++) {
    const t = i * DT;
    if (!boat.active) {
      car.update(DT, DRIVE);
      prevKph = Math.abs(car.kph); // the last speed the CAR had before the handover
    }
    const surfNow = T.surface(car.x, car.z);
    boat.update(DT, car, surfNow, DRIVE);
    if (boat.active) {
      enteredAt = t;
      enterX = car.x;
      enterZ = car.z;
      enterDepth = rescueWaterDepth(surfNow); // rescue.js's own helper — the same one boat.js gates on
      approachKph = prevKph;
    }
  }
  check(enteredAt !== null, 'boat mode engages once unlocked and deep enough', enteredAt === null ? 'never' : `${enteredAt.toFixed(2)} s`, 'within 10 s');
  /* THE OPERATOR'S TWO COMPLAINTS, MEASURED. "u need to be stopped when hitting water and
   * switched to boat -- right now i can cover half my car in water before that": so the depth
   * at the moment of handover must be about a wheel, not about a door sill, and the car must
   * arrive at a crawl rather than at speed. */
  console.log(`       handover at ${enterDepth.toFixed(2)} m of water, arriving at ${approachKph.toFixed(1)} km/h`);
  check(enterDepth < 0.45, 'the switch happens at the WATERLINE, not half way up the car', `${enterDepth.toFixed(2)} m`, '< 0.45 m (a wheel is 0.34 m)');
  check(approachKph < 16, 'and the water has already stopped the car by then', `${approachKph.toFixed(1)} km/h`, '< 16 km/h');
  check(Math.abs(boat.speed) < 4, "the boat sets off under its own power, not the car's momentum", `${Math.abs(boat.speed).toFixed(2)} m/s`, '< 4 m/s');

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

console.log('\n── CONTROL RETENTION: a steep-bank bounce never eats the driver\'s input ──');
{
  /* THE FIXTURE IS FOUND BY A STEEPNESS CRITERION, not inherited from findFixture().
   *
   * It used to be `findFixture(SEED)` — the gem-ranked pick section 2 uses. That rotted, in
   * exactly the way this file's own header warns a hard-coded coordinate would: `findFixture`
   * ranks candidate shores by how close a gem is, over a 25 m grid, gated on the road being
   * 12-45 m away. Resampling the arterial polyline finer (world/roads.js TIERS[0].step 38 -> 19,
   * the "roads read as chords" fix) moves the drawn road by up to the chord sagitta — 1.5 m —
   * and that was enough to flip which candidate won the gem ranking, from (721.1, 384.6) to
   * (774.9, 390.3). Measured: the new pick's transect is still steep by the static test
   * (0.4535 against boat.js's EXIT_STEEP_SLOPE of 0.36), and the boat still declined to bounce
   * there — it curved in on a gentler line and beached. Four checks then failed reading `false`
   * and `0.000 rad`, which looks exactly like the bounce-recovery feature being broken. It is
   * not: the rig had simply lost its steep bank. Nothing in the boat code changed.
   *
   * A single transect is not a strong enough precondition, and that is the lesson: the boat
   * arrives on whatever heading its own turning circle gives it, so a bank that is steep along
   * ONE line can still be exited a few degrees either side of it. So the search below requires
   * the bank to be steep across a FAN of headings — every 10 degrees over a 120 degree arc, the
   * first point shallower than EXIT_DEPTH walking inward must read steeper than
   * EXIT_STEEP_SLOPE, using boat.js's own exit probe. A shore that passes that is one the exit
   * check must decline whichever way the boat noses in, so the bounce path is exercised by
   * construction rather than by luck.
   *
   * This is NOT "search until the test passes": the selector is a static geometric criterion
   * evaluated before any boat is driven, and the rig's assertions below are unchanged and
   * unweakened. Verified independent of the change that exposed the rot — the first six shores
   * this finds all bounce and all stay in boat mode at arterial step 38 AND at 19. */
  const findSteepBank = () => {
    const scan = new Terrain(SEED, -3600, -3600, 3600, 3600, 240);
    const sw = new Float32Array(BIOME_COUNT);
    const sdepth = (x, z) => {
      const y = scan.height(x, z);
      scan.weights(x, z, sw);
      const wy = waterLevelAt(sw, y);
      return wy === null ? 0 : wy - y;
    };
    /** boat.js's own exit probe, walked inward from the water on heading `a`. */
    const declinesExit = (wx, wz, a) => {
      const ux = Math.cos(a),
        uz = Math.sin(a);
      for (let t = 0; t <= 40; t += 0.5) {
        const x = wx + ux * t,
          z = wz + uz * t;
        if (sdepth(x, z) >= EXIT_DEPTH) continue;
        const hereY = scan.height(x, z);
        const aheadY = scan.height(x + ux * EXIT_PROBE_DIST, z + uz * EXIT_PROBE_DIST);
        return (aheadY - hereY) / EXIT_PROBE_DIST > EXIT_STEEP_SLOPE;
      }
      return false; // never reached shallow water inside 40 m — not a bank at all
    };
    for (let z = -3000; z <= 3000; z += 25) {
      for (let x = -3000; x <= 3000; x += 25) {
        if (sdepth(x, z) < 2.5) continue;
        const q = scan.roads.query(x, z);
        if (!isFinite(q.d) || q.d > 45 || q.d < 12) continue;
        if (sdepth(q.qx, q.qz) > 0 || !isDryAt(q.qx, q.qz, SEED)) continue;
        const ang = Math.atan2(q.qz - z, q.qx - x); // from the water back toward the road
        let allSteep = true;
        for (let k = 0; k < 13 && allSteep; k++) {
          allSteep = declinesExit(x, z, ang - Math.PI / 3 + (k * Math.PI) / 18);
        }
        if (!allSteep) continue;
        return { road: { x: q.qx, z: q.qz }, water: { x, z }, headingOut: Math.atan2(x - q.qx, z - q.qz) };
      }
    }
    throw new Error('bench-boat: no bank steep across a 120 degree fan found in a 6 km square');
  };
  const FIX = findSteepBank();
  console.log(`  steep-bank fixture: road (${FIX.road.x.toFixed(1)}, ${FIX.road.z.toFixed(1)}) -> water (${FIX.water.x}, ${FIX.water.z})`);
  const FT = new Terrain(SEED, FIX.road.x - 320, FIX.road.z - 320, FIX.road.x + 320, FIX.road.z + 320, 240);
  const car = new Vehicle({ tier: 'sports', terrain: FT, preset: 'sport' });
  car.placeAt(FIX.road.x, FIX.road.z, FIX.headingOut);
  const wallet = { boatUnlocked: true };
  const boat = new BoatMode({ wallet, terrain: () => FT });

  // Launch (same full-throttle approach every other section uses), then a few seconds out on
  // open water so there is real way on before the turn back.
  for (let i = 0; i < 60 * 10 && !boat.active; i++) {
    if (!boat.active) car.update(DT, DRIVE);
    boat.update(DT, car, FT.surface(car.x, car.z), DRIVE);
  }
  check(boat.active, 'control-retention rig actually gets afloat first', boat.active, 'true');
  for (let i = 0; i < 60 * 4; i++) boat.update(DT, car, FT.surface(car.x, car.z), DRIVE);

  /* Turn around and drive straight back at the same steep shore under full throttle. Aimed at a
   * point 10 m INLAND of the road, along the exact reverse of headingOut, not at the road point
   * itself: chasing the road point directly lets the boat curve in from whatever angle its own
   * turning circle happens to arrive at, which — measured — drifted onto a gentler stretch of
   * this same shore a few metres over and exited cleanly instead of bouncing. Aiming at a point
   * on the far side of the road, along the exact line the shore's own steep profile was measured
   * on, forces the approach to retrace that transect. */
  const inlandX = FIX.road.x - Math.sin(FIX.headingOut) * 10;
  const inlandZ = FIX.road.z - Math.cos(FIX.headingOut) * 10;
  let sawBounce = false;
  let bounceX = 0,
    bounceZ = 0;
  for (let i = 0; i < 60 * 25 && !sawBounce; i++) {
    const err = ((Math.atan2(inlandX - car.x, inlandZ - car.z) - boat.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const cmd = { steer: Math.max(-1, Math.min(1, err * 2)), throttle: 1, brake: 0, handbrake: 0, analogue: true };
    boat.update(DT, car, FT.surface(car.x, car.z), cmd);
    if (boat.bouncing) {
      sawBounce = true;
      bounceX = car.x;
      bounceZ = car.z;
    }
  }
  check(sawBounce, 'nosing straight at the steep bank actually triggers the decline+bounce', sawBounce, 'true');

  // Hold reverse (brake) for 3 s right from the bounce: the old bug's own branch would have
  // eaten this input entirely (bounced === true skipped the throttle/steer block, every frame,
  // for as long as the boat stayed shallow-and-steep). The fix's own dynamics block never skips.
  const BRAKE = { steer: 0, throttle: 0, brake: 1, handbrake: 0, analogue: true };
  for (let i = 0; i < 60 * 3; i++) boat.update(DT, car, FT.surface(car.x, car.z), BRAKE);
  const clearedBank = Math.hypot(car.x - bounceX, car.z - bounceZ);
  check(clearedBank > 2, 'holding reverse for 3 s after the bounce moves the boat clear of the bank', `${clearedBank.toFixed(2)} m`, '> 2 m');

  // Then hold throttle + full steer for 6 s: input must keep working continuously — the boat
  // should turn a real amount and never sit dead in the water (bounced-and-frozen) for more
  // than a beat while the input is held.
  //
  // Steer sign: the SAME sign the turn-back approach above was already steering with (that loop
  // computed a negative `steer` throughout — see its own trace), continuing to swing the bow the
  // way it was already swinging, out along the shore and back to open water. The opposite sign
  // was tried and measured to swing the bow straight back across the bank it just bounced off —
  // a second real, correctly-declined bounce, then a THIRD, until the boat happens to cross a
  // gentler stretch nearby and genuinely exits (grounds as a car) partway through the 6 s
  // window — at which point `boat.speed` reads 0 by _exit()'s own design, not because control
  // was lost, but because the vehicle is not a boat any more. That is a real, correct exit this
  // section is not testing for; steering away from the bank instead keeps the whole 6 s a boat
  // question. Measured on the shipped seed: min depth 2.79 m throughout, boat.active never
  // drops, worst stall 0.02 s.
  let lastYaw = boat.yaw;
  let dyaw = 0;
  let stalledFor = 0;
  let worstStall = 0;
  let stayedAfloat = true;
  const TURN = { steer: -1, throttle: 1, brake: 0, handbrake: 0, analogue: true };
  for (let i = 0; i < 60 * 6; i++) {
    boat.update(DT, car, FT.surface(car.x, car.z), TURN);
    if (!boat.active) stayedAfloat = false;
    let d = boat.yaw - lastYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    dyaw += d;
    lastYaw = boat.yaw;
    if (Math.abs(boat.speed) < 0.05) {
      stalledFor += DT;
      if (stalledFor > worstStall) worstStall = stalledFor;
    } else {
      stalledFor = 0;
    }
  }
  console.log(`  bounced at (${bounceX.toFixed(1)}, ${bounceZ.toFixed(1)}); cleared ${clearedBank.toFixed(2)} m on reverse; |Δyaw| ${Math.abs(dyaw).toFixed(3)} rad over 6 s of throttle+full steer; worst stall ${worstStall.toFixed(2)} s`);
  check(stayedAfloat, 'stays in boat mode for the whole throttle+steer window (a real control question, not a beaching)', stayedAfloat, 'true');
  check(Math.abs(dyaw) > 0.5, 'throttle + full steer for 6 s actually turns the boat', `${Math.abs(dyaw).toFixed(3)} rad`, '> 0.5 rad');
  check(worstStall < 1.5, 'never sits at |speed| < 0.05 for more than 1.5 continuous seconds while an input is held', `${worstStall.toFixed(2)} s`, '< 1.5 s');
  check(Number.isFinite(car.x) && Number.isFinite(car.y) && Number.isFinite(car.z), 'car/boat pose stays finite through the whole bounce-and-recover', `${car.x.toFixed(1)}, ${car.y.toFixed(2)}, ${car.z.toFixed(1)}`, 'finite');
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all boat checks passed'}\n`);
process.exit(failures ? 1 : 0);
