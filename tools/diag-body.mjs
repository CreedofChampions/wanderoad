/* Wanderoad — car body diagnostics: per-wheel off-road, rollover, and pitch on a slope.
 *
 * Three questions bench-car.mjs does not ask, because bench-car drives on a dead-flat,
 * dead-grippy, entirely-on-road world by design:
 *
 *   1. does the car know it is off the road when a WHEEL is off the road, not when the
 *      badge on its bonnet crosses the line?
 *   2. can it go over, and does it get back up?
 *   3. does the body sit on the slope it is standing on, or point into it?
 *
 *   node tools/diag-body.mjs
 */

import { Vehicle } from '../src/car/vehicle.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { PHYSICS_DT, BODY } from '../src/car/tuning.js';

const DEG = 180 / Math.PI;
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
const f = (n, w = 6, d = 2) => n.toFixed(d).padStart(w);

/* ── 1. per-wheel off-road, in the real world ─────────────────────────────── */
console.log('\n── 1. per-wheel off-road (real terrain, real road) ───────────────');
{
  const SEED = 20260726;
  const spawn = findSpawn(SEED);
  const terr = new Terrain(SEED, spawn.x - 300, spawn.z - 300, spawn.x + 300, spawn.z + 300);
  const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'sport' });

  /* Walk along the road for a stretch straight enough that the front and rear wheels cross
   * the verge at the same offset — on a bend they do not, and the interesting case (one
   * SIDE off) hides behind a diagonal one. */
  let near = terr.roads.query(spawn.x, spawn.z);
  let px0 = spawn.x;
  let pz0 = spawn.z;
  for (let step = 0; step < 60; step++) {
    const a = terr.roads.query(px0 + near.tx * 2.0, pz0 + near.tz * 2.0);
    const b = terr.roads.query(px0 - near.tx * 2.0, pz0 - near.tz * 2.0);
    const bend = Math.abs(Math.atan2(a.tx, a.tz) - Math.atan2(b.tx, b.tz));
    if (bend < 0.004) break;
    px0 += near.tx * 8;
    pz0 += near.tz * 8;
    near = terr.roads.query(px0, pz0);
    px0 = near.qx;
    pz0 = near.qz;
  }
  const heading = Math.atan2(near.tx, near.tz);
  // step sideways from the centreline until the LEFT pair is on tarmac and the RIGHT pair
  // is on grass — a clean side-straddle, not a diagonal one over a bend
  let best = null;
  const table = [];
  for (let d = 0; d <= 6; d += 0.02) {
    const px = px0 + near.tz * d;
    const pz = pz0 - near.tx * d;
    car.placeAt(px, pz, heading);
    const w = car.wheels.map((k) => k.onRoad);
    const centre = terr.surface(px, pz).onRoad;
    if (Math.abs(d * 100 - Math.round(d * 5) * 20) < 1)
      table.push(`   ${d.toFixed(2)} m: centre ${centre.toFixed(2)}  wheels ${w.map((v) => v.toFixed(2)).join(' ')}`);
    const leftOn = w[0] > 0.99 && w[2] > 0.99 && w[1] < 0.01 && w[3] < 0.01;
    const rightOn = w[1] > 0.99 && w[3] > 0.99 && w[0] < 0.01 && w[2] < 0.01;
    // the case the complaint is about: the centre still says "on the road"
    if ((leftOn || rightOn) && (!best || centre > best.centre)) best = { d, px, pz, centre };
  }
  console.log('        offset from the centreline → what the centre says vs what the wheels say');
  for (const row of table) console.log(`     ${row}`);
  console.log(`        road here is ${near.width.toFixed(2)} m wide, heading ${(heading * DEG).toFixed(1)}°`);
  if (!best) {
    console.log('        FAILED to find a straddling offset');
  } else {
    car.placeAt(best.px, best.pz, heading);
    console.log(`        car at x ${best.px.toFixed(2)}  z ${best.pz.toFixed(2)}   (${best.d.toFixed(2)} m off the centreline)`);
    const names = ['front-left ', 'front-right', 'rear-left  ', 'rear-right '];
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      console.log(`          ${names[i]}  x ${f(w.x, 9)}  z ${f(w.z, 9)}   onRoad ${f(w.onRoad, 5)}   ${w.onRoad < 0.5 ? 'GRASS' : 'tarmac'}`);
    }
    console.log(
      `        car:  onRoad avg ${f(car.onRoad, 5)}   worst wheel ${f(car.onRoadMin, 5)}   wheels off ${car.wheelsOffRoad}   surfaceKind '${car.surfaceKind}'`
    );
    const centre = terr.surface(best.px, best.pz);
    console.log(`        the OLD centre-only test would have said: onRoad ${f(centre.onRoad, 5)}  ('${centre.surfaceKind}')`);
  }
}

/* ── 2. rollover ──────────────────────────────────────────────────────────── */
console.log('\n── 2. rollover and recovery ──────────────────────────────────────');
{
  // A field with a bank across it: flat until x = 0, then rising at `bank` degrees. Off-road
  // everywhere, which is the only place a car can trip.
  const field = (bankDeg) => {
    const t = Math.tan((bankDeg * Math.PI) / 180);
    const h = (x) => (x > 0 ? x * t : 0);
    return {
      height: (x) => h(x),
      surface: (x, z) => {
        const e = 0.5;
        const nx = h(x - e) - h(x + e);
        const ny = 2 * e;
        const l = Math.hypot(nx, ny) || 1;
        return { y: h(x), nx: nx / l, ny: ny / l, nz: 0, grip: 0.55, rough: 0.85, onRoad: 0, surfaceKind: 'ground', dominant: 0 };
      },
    };
  };

  for (const [label, bank, vLat, from] of [
    ['flat field, 40 km/h sideways ', 0, 11, -30],
    ['flat field, 54 km/h sideways ', 0, 15, -30],
    ['flat field, 72 km/h sideways ', 0, 20, -30],
    ['36 km/h sideways into a 22° bank', 22, 10, -3],
    ['54 km/h sideways into a 22° bank', 22, 15, -3],
  ]) {
    const car = new Vehicle({ tier: 'sports', terrain: field(bank), preset: 'sport' });
    car.placeAt(from, 0, 0);
    // broadside: pointing along +Z, travelling mostly along +X. Body +X is the car's left,
    // so this is a car sliding to its left at speed — the classic trip.
    car.vz = 14;
    car.vx = vLat;
    let maxRoll = 0;
    let overAt = null;
    let uprightAt = null;
    let t = 0;
    const marks = [];
    for (let i = 0; i < 120 * 14; i++) {
      car._step(PHYSICS_DT, NEUTRAL);
      t += PHYSICS_DT;
      const roll = Math.abs(car.roll) * DEG;
      if (roll > maxRoll) maxRoll = roll;
      if (overAt === null && roll > 90) overAt = t;
      if (overAt !== null && uprightAt === null && roll < 5) uprightAt = t;
      if (i % 60 === 0 && t < 8) marks.push(`${t.toFixed(1)}s ${(car.roll * DEG).toFixed(0)}°`);
    }
    console.log(`   ${label}  max roll ${f(maxRoll, 6, 1)}°   over 90° at ${overAt ? overAt.toFixed(2) + 's' : '  never'}   upright again at ${uprightAt ? uprightAt.toFixed(2) + 's' : '  never'}`);
    console.log(`          ${marks.join('  ')}`);
    console.log(`          end: roll ${f(car.roll * DEG, 6, 1)}°  rolled=${car.rolled}  speed ${f(car.kph, 5, 1)} km/h`);
  }

  /* NEVER STUCK. A rollover you cannot drive away from is the one thing this must not be,
   * so throw a spread of them at it — every tier, every bank, sideways at everything from a
   * scrape to a big one — and insist that every single car ends the run upright, flag
   * cleared, and able to move. */
  {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let flips = 0;
    let stuck = 0;
    let worstRecovery = 0;
    const trials = 60;
    for (let k = 0; k < trials; k++) {
      const bank = [0, 8, 16, 22, 30][k % 5];
      const tier = ['gt', 'sports', 'hyper'][k % 3];
      const car = new Vehicle({ tier, terrain: field(bank), preset: ['sport', 'cruise', 'off', 'hardcore'][k % 4] });
      car.placeAt(-4 - rnd() * 8, 0, rnd() * 6 - 3);
      const v = 6 + rnd() * 22;
      const ang = rnd() * Math.PI * 2;
      car.vx = Math.cos(ang) * v;
      car.vz = Math.sin(ang) * v;
      car.yawRate = rnd() * 4 - 2;
      let flipped = false;
      let flipAt = 0;
      let backAt = null;
      let t = 0;
      for (let i = 0; i < 120 * 20; i++) {
        car._step(PHYSICS_DT, { ...NEUTRAL, throttle: i > 120 * 12 ? 0.6 : 0 });
        t += PHYSICS_DT;
        if (Math.abs(car.roll) > Math.PI / 2) {
          if (!flipped) flipAt = t;
          flipped = true;
          backAt = null; // it went over again — start the clock afresh
        }
        if (flipped && backAt === null && !car.rolled && Math.abs(car._tip) < 0.05) backAt = t;
      }
      if (flipped && backAt !== null) worstRecovery = Math.max(worstRecovery, backAt - flipAt);
      if (flipped && backAt === null) stuck++;
      if (flipped) flips++;
      // upright, flag clear, sitting on the ground plane and not on its side
      const ok = !car.rolled && Math.abs(car._tip) < 0.05 && Math.abs(car.roll - car.groundRoll) < 0.2;
      if (!ok) stuck++;
      void flipAt;
    }
    console.log(
      `        stress: ${trials} random off-road spills across all three tiers and four presets — ` +
        `${flips} went over 90°, ${stuck} ended stuck, slowest pick-up ${worstRecovery.toFixed(2)} s`
    );
  }

  // Does the ploughing force actually reach the solver? Compare the lateral velocity one
  // step apart against forces.trip.
  const car = new Vehicle({ tier: 'sports', terrain: field(0), preset: 'sport' });
  car.placeAt(-30, 0, 0);
  car.vz = 14;
  car.vx = 15;
  car._step(PHYSICS_DT, NEUTRAL);
  const before = car.vx;
  car._step(PHYSICS_DT, NEUTRAL);
  console.log(
    `        trip force reaches the solver: forces.trip ${f(car.forces.trip, 9, 0)} N` +
      `   →  vLat ${f(before, 6)} → ${f(car.vx, 6)} m/s in one 8.3 ms step (a = ${f((car.vx - before) / PHYSICS_DT, 6, 1)} m/s²)`
  );
}

/* ── 3. body pitch against the slope it is standing on ────────────────────── */
console.log('\n── 3. pitch on a climb ───────────────────────────────────────────');
{
  // a constant ramp rising toward +Z, exactly as bench-slope.mjs builds it
  const ramp = (deg) => {
    const t = Math.tan((deg * Math.PI) / 180);
    const ny = Math.cos((deg * Math.PI) / 180);
    const nz = -Math.sin((deg * Math.PI) / 180);
    return {
      height: (x, z) => z * t,
      surface: (x, z) => ({ y: z * t, nx: 0, ny, nz, grip: 1, rough: 0, onRoad: 1, surfaceKind: 'tarmac', dominant: 0 }),
    };
  };
  console.log('        slope   nose-up angle   true slope   error    (nose-up = −pitch; positive pitch is nose DOWN)');
  for (const deg of [0, 5, 10, 15, 20, 25]) {
    const car = new Vehicle({ tier: 'sports', terrain: ramp(deg), preset: 'sport' });
    car.placeAt(0, 0, 0);
    // climb it under power for four seconds, then read the attitude at a steady speed
    for (let i = 0; i < 120 * 4; i++) car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 0.45 });
    const noseUp = -car.pitch * DEG;
    console.log(
      `        ${String(deg).padStart(3)}°     ${f(noseUp, 8, 2)}°       ${f(deg, 6, 2)}°   ${f(noseUp - deg, 6, 2)}°   at ${f(car.kph, 5, 1)} km/h`
    );
  }
  // and the springs on top: flat road, brake hard, the nose must go DOWN
  const car = new Vehicle({ tier: 'sports', terrain: ramp(0), preset: 'sport' });
  car.placeAt(0, 0, 0);
  /* Guarded, and targeted at a speed the car can actually reach. The fleet was halved on the
   * operator's instruction, so the sports car tops out at 88 km/h -- an unbounded
   * `while (car.kph < N)` for any N above that is not a slow test, it is a hang. */
  let spin = 0;
  while (car.kph < 80 && spin++ < 120 * 60) car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 1 });
  const cruise = -car.pitch * DEG;
  for (let i = 0; i < 40; i++) car._step(PHYSICS_DT, { ...NEUTRAL, brake: 1 });
  console.log(`        flat road: nose-up ${f(cruise, 6, 2)}° at 90 km/h, ${f(-car.pitch * DEG, 6, 2)}° a third of a second into full braking (dive still works)`);
  // a real climbing road, not a stub: drive it and compare the body against the ground it is
  // standing on, every step
  {
    const SEED = 20260726;
    const spawn = findSpawn(SEED);
    let terr = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
    let cx = spawn.x;
    let cz = spawn.z;
    const c2 = new Vehicle({ tier: 'sports', terrain: terr, preset: 'cruise' });
    c2.placeAt(spawn.x, spawn.z, spawn.heading);
    let worstGround = 0;
    let worstGroundAt = 0;
    let worstTotal = 0;
    let steepest = 0;
    let climbs = 0;
    for (let i = 0; i < 120 * 60; i++) {
      if (Math.abs(c2.x - cx) > 240 || Math.abs(c2.z - cz) > 240) {
        terr = new Terrain(SEED, c2.x - 420, c2.z - 420, c2.x + 420, c2.z + 420);
        c2.terrain = terr;
        cx = c2.x;
        cz = c2.z;
      }
      // a plain Stanley controller, the same one bench-drive.mjs uses, so the car stays on
      // the road instead of wandering into a field and measuring nothing
      const q = terr.roads.query(c2.x, c2.z);
      let steer = 0;
      if (isFinite(q.d)) {
        let tx = q.tx;
        let tz = q.tz;
        if (Math.sin(c2.yaw) * tx + Math.cos(c2.yaw) * tz < 0) { tx = -tx; tz = -tz; }
        const lateral = (c2.x - q.qx) * tz - (c2.z - q.qz) * tx;
        let err = Math.atan2(tx, tz) - c2.yaw;
        while (err > Math.PI) err -= 2 * Math.PI;
        while (err < -Math.PI) err += 2 * Math.PI;
        const v = Math.max(Math.abs(c2.speed), 6);
        steer = Math.max(-1, Math.min(1, (err * 1.5 - Math.atan2(3.2 * lateral, v)) * 2.1));
      }
      c2._step(PHYSICS_DT, { ...NEUTRAL, steer, throttle: Math.abs(c2.speed) < 15 ? 0.5 : 0.04, analogue: true });
      if (!c2.onGround) continue;
      // the true slope along the car, straight off the terrain a wheelbase apart
      const s = Math.sin(c2.yaw);
      const cc = Math.cos(c2.yaw);
      const hF = terr.height(c2.x + s * c2.a, c2.z + cc * c2.a);
      const hR = terr.height(c2.x - s * c2.b, c2.z - cc * c2.b);
      const trueUp = Math.atan2(hF - hR, c2.wb) * DEG;
      if (Math.abs(trueUp) > Math.abs(steepest)) steepest = trueUp;
      if (trueUp > 3) climbs++;
      const groundErr = -c2.groundPitch * DEG - trueUp; // the ground-following part alone
      const totalErr = -c2.pitch * DEG - trueUp; // including dive and squat
      if (Math.abs(groundErr) > Math.abs(worstGround)) { worstGround = groundErr; worstGroundAt = trueUp; }
      if (Math.abs(totalErr) > Math.abs(worstTotal)) worstTotal = totalErr;
    }
    console.log(
      `        60 s on a real road (${(climbs / 120).toFixed(0)} s of it climbing, steepest ${f(steepest, 5, 2)}°):` +
        `  worst ground-following error ${f(worstGround, 5, 2)}° (on a ${f(worstGroundAt, 5, 2)}° slope),` +
        ` worst total ${f(worstTotal, 5, 2)}° once dive and squat are in`
    );

    /* Roads are graded, so a road drive never climbs much. The complaint is about hills, so
     * go and find one: scan for real ground at 10–20° and drive straight up it. */
    // a terrain of its own — the road drive above moved `terr` a kilometre down the map
    const terrH = new Terrain(SEED, spawn.x - 320, spawn.z - 320, spawn.x + 320, spawn.z + 320);
    let hill = null;
    for (let i = 0; i < 100 && !hill; i++) {
      for (let j = 0; j < 100 && !hill; j++) {
        const x = spawn.x - 300 + i * 6;
        const z = spawn.z - 300 + j * 6;
        const n = terrH.normal(x, z, 3);
        const deg = Math.acos(Math.min(1, n[1])) * DEG;
        // shallow enough that the car can genuinely drive up it off-road: a 20° field is a
        // slope this car is meant to fail on, and a parked car proves nothing about pitch
        if (deg > 7 && deg < 12) hill = { x, z, deg, up: Math.atan2(-n[0], -n[2]) };
      }
    }
    if (!hill) console.log('        no 7–12° hillside found near the spawn');
    else {
      const c3 = new Vehicle({ tier: 'sports', terrain: terrH, preset: 'sport' });
      c3.placeAt(hill.x, hill.z, hill.up); // pointing straight up the fall line
      c3.vz = Math.cos(hill.up) * 8; c3.vx = Math.sin(hill.up) * 8;
      const sx = c3.x;
      const sz = c3.z;
      let sumV = 0;
      let worst = 0;
      let worstTrue = 0;
      let steep = 0;
      let steepNose = 0;
      let steepErr = 0;
      let n = 0;
      let sum = 0;
      for (let i = 0; i < 120 * 6; i++) {
        c3._step(PHYSICS_DT, { ...NEUTRAL, throttle: 0.8 });
        if (!c3.onGround || i < 60) continue;
        const s = Math.sin(c3.yaw);
        const cc = Math.cos(c3.yaw);
        const hF = terrH.height(c3.x + s * c3.a, c3.z + cc * c3.a);
        const hR = terrH.height(c3.x - s * c3.b, c3.z - cc * c3.b);
        const trueUp = Math.atan2(hF - hR, c3.wb) * DEG;
        const err = -c3.pitch * DEG - trueUp;
        sum += err;
        sumV += Math.abs(c3.kph);
        n++;
        if (Math.abs(err) > Math.abs(worst)) { worst = err; worstTrue = trueUp; }
        if (trueUp > steep) { steep = trueUp; steepNose = -c3.pitch * DEG; steepErr = err; }
      }
      console.log(
        `        6 s climbing a real hillside at (${hill.x.toFixed(0)}, ${hill.z.toFixed(0)}), ${hill.deg.toFixed(1)}° where it started:`
      );
      console.log(
        `          steepest ground the car actually stood on ${f(steep, 5, 2)}° → nose-up ${f(steepNose, 5, 2)}°, error ${f(steepErr, 5, 2)}°` +
          `   |   mean error over the climb ${f(sum / n, 5, 2)}°, worst ${f(worst, 5, 2)}° (on ${f(worstTrue, 5, 2)}°)`
      );
      console.log(
        `          (it moved ${Math.hypot(c3.x - sx, c3.z - sz).toFixed(1)} m at a mean ${(sumV / n).toFixed(1)} km/h — a measurement on a parked car would prove nothing)`
      );
    }
  }
}

/* ── 4. the attitude through the REAL transform chain ─────────────────────────
 * A pitch that is right in a number and wrong on screen is the failure this project has had
 * before, so this puts car.roll / car.pitch through exactly what main.js and model.js do to
 * them — group.rotation.set(0, yaw, 0), chassis.rotation.z = roll, chassis.rotation.x =
 * pitch, real three.js matrices — and then asks where the nose and the left flank END UP
 * against where the ground actually is. If a sign is wrong anywhere in that chain, including
 * three.js's own handedness, these numbers disagree.
 */
console.log('\n── 4. where the body ends up, through three.js itself ────────────');
{
  const { Object3D, Vector3 } = await import('three');
  const SEED = 20260726;
  const spawn = findSpawn(SEED);
  const terr = new Terrain(SEED, spawn.x - 320, spawn.z - 320, spawn.x + 320, spawn.z + 320);
  // find a hillside with a bit of both pitch and roll in it
  let spot = null;
  for (let i = 0; i < 100 && !spot; i++) {
    for (let j = 0; j < 100 && !spot; j++) {
      const x = spawn.x - 300 + i * 6;
      const z = spawn.z - 300 + j * 6;
      const n = terr.normal(x, z, 3);
      const deg = Math.acos(Math.min(1, n[1])) * DEG;
      if (deg > 9 && deg < 14) spot = { x, z, deg };
    }
  }
  const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'sport' });
  for (const headingDeg of [0, 55, 130, 250]) {
    car.placeAt(spot.x, spot.z, (headingDeg * Math.PI) / 180);
    for (let i = 0; i < 20; i++) car._step(PHYSICS_DT, NEUTRAL); // let it settle on the ground
    const group = new Object3D();
    group.position.set(car.x, car.y - 0.36, car.z);
    group.rotation.set(0, car.yaw, 0);
    const chassis = new Object3D();
    chassis.rotation.z = car.roll;
    chassis.rotation.x = car.pitch;
    group.add(chassis);
    group.updateMatrixWorld(true);
    const at = (lx, ly, lz) => chassis.localToWorld(new Vector3(lx, ly, lz));
    const mid = at(0, 0, 0);
    const nose = at(0, 0, car.a); // front axle, straight ahead
    const left = at(car.track * 0.5, 0, 0); // +X is the driver's left
    const gAt = (p) => terr.height(p.x, p.z);
    const noseModel = nose.y - mid.y;
    const noseGround = gAt(nose) - gAt(mid);
    const leftModel = left.y - mid.y;
    const leftGround = gAt(left) - gAt(mid);
    console.log(
      `        heading ${String(headingDeg).padStart(3)}°:  nose rises ${f(noseModel, 6, 3)} m in the model vs ${f(noseGround, 6, 3)} m of ground` +
        `   |   left flank ${f(leftModel, 6, 3)} m vs ${f(leftGround, 6, 3)} m` +
        `   (roll ${f(car.roll * DEG, 6, 2)}° = ground ${f(car.groundRoll * DEG, 5, 2)}° + ${f(car._lean * BODY.visualRollMul * DEG, 5, 2)}° of spring lean,` +
        ` pitch ${f(car.pitch * DEG, 6, 2)}° = ground ${f(car.groundPitch * DEG, 5, 2)}° + ${f(car._dive * DEG, 5, 2)}° of dive)`
    );
  }
  console.log('        a nose that rises with the ground is a nose pointing UP the hill; a negative one is buried in it.');
}

/* ── 5. what it costs ─────────────────────────────────────────────────────── */
console.log('\n── 5. cost of the four probes ────────────────────────────────────');
{
  const SEED = 20260726;
  const spawn = findSpawn(SEED);
  const terr = new Terrain(SEED, spawn.x - 300, spawn.z - 300, spawn.x + 300, spawn.z + 300);
  const IN = { ...NEUTRAL, throttle: 0.35 };
  const N = 6000; // 50 s of physics, ON the road, which is where the probes cost the most
  const timeIt = (probe) => {
    const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'sport' });
    car.placeAt(spawn.x, spawn.z, spawn.heading);
    if (!probe) car._probeWheels = () => {};
    for (let i = 0; i < 600; i++) car._step(PHYSICS_DT, IN); // warm
    car.placeAt(spawn.x, spawn.z, spawn.heading);
    const t0 = performance.now();
    for (let i = 0; i < N; i++) car._step(PHYSICS_DT, IN);
    return ((performance.now() - t0) * 1000) / N;
  };
  const withP = timeIt(true);
  const without = timeIt(false);
  console.log(
    `        step ${withP.toFixed(0)} µs with the four probes, ${without.toFixed(0)} µs without them` +
      `  →  +${(withP - without).toFixed(0)} µs a step, ${((withP - without) * 120e-3).toFixed(1)} ms per second of play at 120 Hz`
  );
}

console.log('');
