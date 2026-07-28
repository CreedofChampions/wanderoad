/* Wanderoad — WHY the browser's C3 "stop and turn around" reads 61-70 deg when the plain
 * node replay (tools/diag-c3.mjs) reads well over 100 at nearly every road start.
 *
 * diag-c3.mjs drives a bare Vehicle over a bare Terrain. main.js's frame does three more
 * things to the same car every tick, and all three can eat a U-turn, so this rig adds them:
 *
 *   1. solids.resolve()  — trees, rocks and fence posts. A U-turn is the one manoeuvre that
 *                          leaves the carriageway on purpose, and beside a tier-1 lane the
 *                          verge is where the trees are. Worth 1-3 starts, and it is what
 *                          turns (-899, 1246.7) from 170 deg into 83.
 *   2. fuel.gate()       — a dry tank scales the THROTTLE to nothing. C3 runs after C2's
 *                          run-ups and C4's three 9 s full-throttle goes. Not the cause here:
 *                          the tank is nowhere near empty by C3.
 *   3. a real frame dt   — 30 fps against 60 changes nothing measurable (both columns below).
 *
 * It reports the turn TWO ways, because the browser check folds its answer into [0, 180] deg
 * (`if (turned > PI) turned = 2PI - turned`): a car that sweeps 300 deg is reported as 60, so
 * "under-turned" and "went right round" are the same number. That had to be ruled out before
 * anything was changed, and it IS ruled out for the current world — every failing start below
 * reports folded === |net|, so the failures are genuine under-turns, not folded 300s. (It was
 * NOT always so: on the road layout of an hour earlier, 4 of 54 starts turned 350-357 deg and
 * folded down to 4-10. If this ever fails with folded << |net|, the check is measuring the
 * wrong thing and the car is fine.)
 *
 * WHAT IT FOUND. The failing starts are all the same picture, visible in the trace: the
 * unsteered 4 s W hold puts the car off the carriageway, and the U-turn is then attempted at
 * the off-road speed governor (43.9 km/h) on rough ground, where the car was spending a THIRD
 * of the manoeuvre genuinely airborne (`ground 0` in the trace) because the loose-surface bump
 * impulse in vehicle.js was a 4 g launch rather than a shake — see tools/diag-bump.mjs, which
 * measures that on flat ground with the terrain taken away. Bounding it (BUMP_MAX_A) is the
 * repair, measured here on the SAME 46 road starts and the same road layout:
 *
 *                       pass    mean folded    worst failures
 *   before              40/46      133 deg      18, 49, 83, 83, 87, 89
 *   after               42/46      140 deg      15, 82, 83, 91
 *
 *   node tools/diag-c3-turn.mjs                sweep, every combination
 *   node tools/diag-c3-turn.mjs 852 519        one start, traced
 *
 * Same car (FLEET[1], what one tap of V selects) and same preset (?terrain=meadow) as
 * tools/browser-test.mjs and tools/diag-c3.mjs, for the same reasons.
 */

import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Rescue, waterDepth } from '../src/game/rescue.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { applyCarFeel, FLEET } from '../src/game/garage.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { Solids, solidsFromScatter } from '../src/game/collide.js';
import { scatterChunk } from '../src/world/scatter.js';
import { nodeSize } from '../src/world/chunk.js';
import { Fuel } from '../src/game/fuel.js';

const SEED = 20260726;
const LEAF = nodeSize(0);

applyTerrain('meadow');
setBiomeBias(terrainBias('meadow'));
const CAR = FLEET[1];
applyCarFeel(CAR);

const KEYS = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: false };
const cmd = (steer, throttle, brake) => ({ ...KEYS, steer, throttle, brake });

function makeWorld() {
  let cx = 0, cz = 0, terr = null;
  return (x, z) => {
    if (!terr || Math.abs(x - cx) > 240 || Math.abs(z - cz) > 240) {
      terr = new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
      cx = x; cz = z;
    }
    return terr;
  };
}

/** main.js's level-0 scatter -> Solids streaming, kept to the chunks around the car. */
function makeSolids() {
  const solids = new Solids();
  const live = new Set();
  return {
    solids,
    follow(x, z) {
      const cx = Math.floor(x / LEAF), cz = Math.floor(z / LEAF);
      const want = new Set();
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) want.add(`${cx + dx},${cz + dz}`);
      }
      for (const k of live) if (!want.has(k)) { solids.removeChunk(k); live.delete(k); }
      for (const k of want) {
        if (live.has(k)) continue;
        const [kx, kz] = k.split(',').map(Number);
        const s = scatterChunk({ cx: kx, cz: kz, level: 0, seed: SEED });
        solids.addChunk(k, solidsFromScatter(s));
        live.add(k);
      }
    },
  };
}

function backToRoad(car) {
  const q = car.terrain.roads.query(car.x, car.z);
  if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
}

const fold = (a) => {
  let t = Math.abs(a);
  while (t > Math.PI * 2) t -= Math.PI * 2;
  if (t > Math.PI) t = Math.PI * 2 - t;
  return t;
};

/**
 * Replay C3: W 4 s, S 4 s, A+W 7 s.
 * @returns {{folded:number, swept:number, net:number, hits:number, dry:boolean,
 *            kphEnd:number, minKph:number, trace:string[]}}
 */
function runC3(x0, z0, { hitSolids = false, useFuel = 0, dt = 1 / 60, trace = false, variant = null } = {}) {
  const localFor = makeWorld();
  const car = new Vehicle({ tier: CAR.tier, terrain: localFor(x0, z0), preset: CAR.feel.assist });
  if (variant) variant(car);
  const q = car.terrain.roads.query(x0, z0);
  if (!isFinite(q.d)) return null;
  car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));

  const rescue = new Rescue({ keepHeading: true, recover: () => backToRoad(car) });
  const stream = hitSolids ? makeSolids() : null;
  const fuel = useFuel > 0 ? new Fuel({ start: useFuel }) : null;

  const yaw0 = car.yaw;
  let prevYaw = car.yaw, swept = 0, net = 0, hits = 0, minKph = 1e9, worstDepth = 0;
  let air = 0, frames = 0;
  const log = [];
  let t = 0;

  for (const [secs, input] of [[4, cmd(0, 1, 0)], [4, cmd(0, 0, 1)], [7, cmd(1, 1, 0)]]) {
    for (let i = 0; i < Math.round(secs / dt); i++) {
      car.terrain = localFor(car.x, car.z);
      if (stream) stream.follow(car.x, car.z);
      let drive = input;
      if (fuel) { fuel.update(dt, car, { burn: true }); drive = fuel.gate(input); }
      car.update(dt, drive);
      if (stream) { const h = stream.solids.resolve(car, 1.05, dt); if (h) hits++; }
      const surf = car.terrain.surface(car.x, car.z);
      rescue.update(dt, car, surf);
      worstDepth = Math.max(worstDepth, waterDepth(surf));
      let d = car.yaw - prevYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      swept += Math.abs(d);
      net += d;
      prevYaw = car.yaw;
      if (t > 8) { // the U-turn phase only
        minKph = Math.min(minKph, car.kph);
        frames++;
        if (!car.onGround) air++;
      }
      t += dt;
      if (trace && i % Math.round(0.5 / dt) === 0) {
        log.push(
          `t=${t.toFixed(1).padStart(4)}s kph ${car.kph.toFixed(1).padStart(6)} g${car.gear}` +
          ` steer ${car.steer.toFixed(2).padStart(5)}/${((car.steerAngle || 0) * 57.3).toFixed(1).padStart(5)}deg` +
          ` yawRate ${((car.yawRate || 0) * 57.3).toFixed(0).padStart(4)}d/s` +
          ` slip ${((car.slip || 0) * 57.3).toFixed(0).padStart(4)}` +
          ` grip ${(car.gripScale ?? 0).toFixed(2)} onRoadMin ${(car.onRoadMin ?? 0).toFixed(2)}` +
          ` ground ${car.onGround ? 1 : 0} slope ${((car.slopeAngle || 0) * 57.3).toFixed(0).padStart(2)}` +
          ` net ${(net * 57.3).toFixed(0).padStart(4)} swept ${(swept * 57.3).toFixed(0).padStart(4)} hits ${hits}` +
          (fuel ? ` tank ${fuel.seconds.toFixed(0)}s pow ${fuel.power.toFixed(2)}` : '')
        );
      }
    }
  }
  return {
    folded: fold(car.yaw - yaw0) * 57.3,
    swept: swept * 57.3,
    net: net * 57.3,
    hits,
    dry: fuel ? fuel.dry : false,
    kphEnd: car.kph,
    air: frames ? air / frames : 0,
    minKph: minKph === 1e9 ? 0 : minKph,
    worstDepth,
    trace: log,
  };
}

const argv = process.argv.slice(2).map(Number).filter((n) => isFinite(n));
if (argv.length === 2) {
  const [x, z] = argv;
  for (const mode of [
    ['bare', {}],
    ['+solids', { hitSolids: true }],
    ['+solids, 30 fps', { hitSolids: true, dt: 1 / 30 }],
    ['+solids, near-dry tank', { hitSolids: true, useFuel: 0.004 }],
  ]) {
    const r = runC3(x, z, { ...mode[1], trace: true });
    console.log(`\n── (${x}, ${z})  ${mode[0]} ───────────────────────────────`);
    console.log(r.trace.join('\n'));
    console.log(`  folded ${r.folded.toFixed(0)}deg   net ${r.net.toFixed(0)}deg   ` +
      `swept ${r.swept.toFixed(0)}deg   hits ${r.hits}   dry ${r.dry}   end ${r.kphEnd.toFixed(0)} km/h   ` +
      `${(r.air * 100).toFixed(0)}% of the U-turn off the ground`);
  }
  process.exit(0);
}

/* ── sweep ──────────────────────────────────────────────────────────────── */
const spawn = findSpawn(SEED);
const starts = [];
{
  const localFor = makeWorld();
  for (let r = 200; r <= 2000 && starts.length < 80; r += 60) {
    for (let a = 0; a < 12 && starts.length < 80; a++) {
      const x = spawn.x + Math.cos((a / 12) * Math.PI * 2) * r;
      const z = spawn.z + Math.sin((a / 12) * Math.PI * 2) * r;
      const qq = localFor(x, z).roads.query(x, z);
      if (isFinite(qq.d) && qq.d < 40) starts.push([+qq.qx.toFixed(1), +qq.qz.toFixed(1)]);
    }
  }
}

/* ── candidate repairs, each measured against the same 40 starts ─────────────
 * All of them are monkey-patches HERE, in the harness, so nothing in src/ moves until the
 * numbers say which one is worth shipping. */
import { STEER as STEER_T } from '../src/car/tuning.js';

/** The shipped limiter, re-implemented so a variant can change one term of it. */
const lockOf = (car, { gFactor = 1, parkTop = 12 } = {}) => {
  const v = Math.abs(car.speed);
  const taper = STEER_T.minAngle +
    (STEER_T.maxAngle - STEER_T.minAngle) / (1 + Math.pow(v / STEER_T.taperSpeed, STEER_T.taperPow));
  const g = STEER_T.comfortG * gFactor;
  const byG = v > 1 ? Math.atan((car.wb * g) / (v * v)) : STEER_T.maxAngle;
  const parkish = 1 - Math.min(1, Math.max(0, (v - 5) / (parkTop - 5)));
  const byRadius = Math.atan(car.wb / STEER_T.minRadius) * parkish;
  let m = Math.min(taper, Math.max(byG, byRadius));
  m = Math.max(m, car.assist.lockFloor * 0.35, STEER_T.minAngle * 0.22);
  const beta = Math.abs(car.slip);
  if (beta > STEER_T.driftLow) m = Math.max(m, taper * (1 + STEER_T.driftBonus));
  return m;
};

const VARIANTS = {
  none: null,
  /* The limiter promises COMFORT_G of cornering whatever the car is standing on. Off the
   * tarmac the tyres cannot deliver it, so full lock is past the front tyres' peak slip and
   * the car ploughs. Ask for only what the surface can give. */
  gripAware: (car) => { car.maxSteerAngle = function () { return lockOf(this, { gFactor: Math.max(0.55, this.gripScale) }); }; },
  /* The mechanical minimum-radius floor currently fades out by 12 m/s. Hold it to 18. */
  floor18: (car) => { car.maxSteerAngle = function () { return lockOf(this, { parkTop: 18 }); }; },
  both: (car) => {
    car.maxSteerAngle = function () {
      return lockOf(this, { gFactor: Math.max(0.55, this.gripScale), parkTop: 18 });
    };
  },
  /* How much lock is the counter-steer assist taking off the driver during the U-turn? */
  noCounterSteer: (car) => { car.assist.counterSteer = 0; },
};

const MODES = [
  ['bare (diag-c3.mjs)', {}],
  ['+solids', { hitSolids: true }],
  ['+solids 30 fps', { hitSolids: true, dt: 1 / 30 }],
  ['+solids, no c-steer', { hitSolids: true, variant: VARIANTS.noCounterSteer }],
  ['+solids, grip-aware', { hitSolids: true, variant: VARIANTS.gripAware }],
  ['+solids, floor to 18', { hitSolids: true, variant: VARIANTS.floor18 }],
  ['+solids, both', { hitSolids: true, variant: VARIANTS.both }],
];
console.log(`\n${starts.length} road starts, C3 replayed at each. Bar: folded > 100 deg.\n`);
for (const [label, opts] of MODES) {
  let pass = 0, hits = 0, over180 = 0, sumFold = 0, sumSwept = 0, worstList = [];
  for (const [x, z] of starts) {
    const r = runC3(x, z, opts);
    if (!r) continue;
    if (r.folded > 100) pass++; else worstList.push(`(${x},${z}) ${r.folded.toFixed(0)}/${Math.abs(r.net).toFixed(0)}`);
    hits += r.hits;
    if (Math.abs(r.net) > 180) over180++;
    sumFold += r.folded;
    sumSwept += r.swept;
  }
  console.log(
    `  ${label.padEnd(20)} ${String(pass).padStart(2)}/${starts.length} pass   ` +
    `mean folded ${(sumFold / starts.length).toFixed(0)}deg   mean swept ${(sumSwept / starts.length).toFixed(0)}deg   ` +
    `${over180} runs turned past 180deg   ${hits} collision frames`
  );
  if (worstList.length) console.log(`      failures (folded/|net|): ${worstList.slice(0, 12).join('  ')}`);
}
