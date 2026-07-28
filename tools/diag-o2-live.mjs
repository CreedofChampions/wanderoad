/* Wanderoad — WHY O2's on-road baseline reads 70 km/h in the browser and 103 in node.
 *
 * tools/diag-o2.mjs already proves the SHIPPED roadRunUp page code gets the car to 103.2 km/h
 * on tarmac when it is stepped at a fixed 1/60 s. The browser suite runs the identical code
 * and reads 70.4 / 69.8 km/h. Something about the RUNNING GAME, not about the run-up law, is
 * holding the baseline down, and O2's 0.55 ratio fails on that depressed number rather than on
 * anything the off-road leg does (it sits on offCap, 43.9 km/h, in both places).
 *
 * Two things differ between the browser and diag-o2.mjs, and this file measures both:
 *
 *   1. THE PHYSICS STEP. main.js steps the car with `dt = Math.min((now - last)/1000, 0.1)`,
 *      i.e. one physics step per RENDERED FRAME at whatever rate the tab manages. The suite
 *      only asserts fps > 24. diag-o2.mjs steps at a fixed 1/60. `--hz` sweeps that.
 *
 *   2. WHERE THE CAR IS PUT. O2 no longer measures from reset(): it builds a 6.4 km terrain,
 *      walks the road network for a stretch whose centreline holds carve.edge >= 0.9 for
 *      150 m+, and teleports there. diag-o2.mjs measures from autopilot-driven sites instead,
 *      so it has never sampled the stretches the check actually uses. `--finder` runs the
 *      browser's own placement code (lifted out of tools/browser-test.mjs, not re-typed).
 *
 * Nothing here is a fix and nothing here writes to src/. It is a measurement.
 *
 *   node tools/diag-o2-live.mjs [--hz 60,40,30,25] [--sites 4] [--finder] [--secs 8]
 */

import { readFileSync } from 'node:fs';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { Rescue } from '../src/game/rescue.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { applyCarFeel, FLEET_BY_ID, FIRST_CAR } from '../src/game/garage.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = 20260726;
const SECS = +arg('secs', 8);
const SITES = +arg('sites', 4);
const LAND = arg('terrain', 'meadow');
const HZ = String(arg('hz', '60,40,30,25'))
  .split(',')
  .map(Number)
  .filter((n) => n > 0);
const USE_FINDER = process.argv.includes('--finder');
const TRACE = process.argv.includes('--trace');

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));
const CAR = FLEET_BY_ID[FIRST_CAR];
applyCarFeel(CAR);

/* main.js's own window: an 840 m terrain around the car, rebuilt once it is 240 m from the
 * centre. This is what `car.terrain = localFor(car.x, car.z)` gives the solver every frame. */
let cx = 0;
let cz = 0;
let terr = null;
const localFor = (x, z) => {
  if (!terr || Math.abs(x - cx) > 240 || Math.abs(z - cz) > 240) {
    terr = new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
    cx = x;
    cz = z;
  }
  return terr;
};

const spawn = findSpawn(SEED);
const car = new Vehicle({ tier: CAR.tier, terrain: localFor(spawn.x, spawn.z), preset: CAR.feel.assist });
car.placeAt(spawn.x, spawn.z, spawn.heading);

function backToRoad() {
  const t = car.terrain;
  const q = t.roads.query(car.x, car.z);
  if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
  else {
    const s = findSpawn(SEED, car.x, car.z);
    car.placeAt(s.x, s.z, s.heading);
  }
}
const rescue = new Rescue({ recover: backToRoad });
const COAST = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

/* ── the SHIPPED page code, byte for byte, at a chosen frame rate ──────────
 * Same trick tools/diag-o2.mjs uses: pull roadRunUp's page source out of browser-test.mjs and
 * run it against the real Vehicle. The only difference here is that ONE rAF callback advances
 * the physics by ONE step of `dt`, which is exactly what main.js's frame() does. */
const btSrc = readFileSync(new URL('./browser-test.mjs', import.meta.url), 'utf8');
const mRunUp = btSrc.match(/const roadRunUp = async \(ms\) => await evalJs\(`([\s\S]*?)`\);/);
if (!mRunUp) throw new Error('could not find roadRunUp in browser-test.mjs — has it been renamed?');
const PAGE_SRC = mRunUp[1];

function makeShippedLeg(dt) {
  const held = new Set();
  const KeyboardEvent = class {
    constructor(type, o) {
      this.type = type;
      this.code = o.code;
    }
  };
  const win = {
    WANDEROAD: { get car() { return car; } },
    dispatchEvent(e) {
      if (e.type === 'keydown') held.add(e.code);
      else if (e.type === 'keyup') held.delete(e.code);
      return true;
    },
  };
  let simMs = 0;
  const perf = { now: () => simMs };
  const rafQ = [];
  const raf = (f) => rafQ.push(f);
  const fakeSetTimeout = () => 0;
  const input = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: false };
  const tel = { onRoadMin: 1, onRoadMean: 0, n: 0, steerFlips: 0, yLow: 0, yHigh: 0, kphMax: 0, rows: [], lastTrace: -1e9, air: 0, driveSum: 0 };
  let lastSteer = 0;
  const pump = () => {
    input.steer = (held.has('KeyA') ? 1 : 0) - (held.has('KeyD') ? 1 : 0);
    input.throttle = held.has('KeyW') ? 1 : 0;
    input.brake = held.has('KeyS') ? 1 : 0;
    if (input.steer !== lastSteer) tel.steerFlips++;
    lastSteer = input.steer;
    car.terrain = localFor(car.x, car.z);
    car.update(dt, input);
    rescue.update(dt, car, car.terrain.surface(car.x, car.z));
    simMs += dt * 1000;
    tel.onRoadMin = Math.min(tel.onRoadMin, car.onRoad);
    tel.onRoadMean += car.onRoad;
    tel.kphMax = Math.max(tel.kphMax, car.kph);
    if (!car.onGround) tel.air++;
    tel.driveSum += car.forces.drive * car.forces.contact;
    tel.yLow = Math.min(tel.yLow, car.y);
    tel.yHigh = Math.max(tel.yHigh, car.y);
    tel.n++;
    if (TRACE && simMs - tel.lastTrace >= 1000) {
      tel.lastTrace = simMs;
      const q = car.terrain.roads.query(car.x, car.z);
      tel.rows.push(
        `      t=${(simMs / 1000).toFixed(1)}s ${car.kph.toFixed(1).padStart(6)} km/h` +
          ` steer ${input.steer >= 0 ? '+' : ''}${input.steer} (wheel ${car.steer.toFixed(2)})` +
          ` yawRate ${car.yawRate.toFixed(2)} thr ${car.throttle.toFixed(2)} gear ${car.gear}` +
          ` rough ${(car.rough || 0).toFixed(2)} onRoad ${car.onRoad.toFixed(2)}` +
          ` d ${(isFinite(q.d) ? q.d : 999).toFixed(1)} m tier ${q.tier} y ${car.y.toFixed(1)}` +
          `\n            forces ` +
          Object.entries(car.forces)
            .map(([k, val]) => `${k} ${typeof val === 'number' ? val.toFixed(0) : val}`)
            .join(' ') +
          ` | slipF ${car.wheels[0].slipAngle.toFixed(3)} vLat ${(car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw)).toFixed(2)}`
      );
    }
  };
  const fn = new Function(
    'window',
    'performance',
    'requestAnimationFrame',
    'setTimeout',
    'KeyboardEvent',
    `return ${PAGE_SRC.replace(/\$\{ms\}/g, 'window.__ms')};`
  );
  return async (ms) => {
    simMs = 0;
    rafQ.length = 0;
    held.clear();
    lastSteer = 0;
    tel.onRoadMin = 1;
    tel.onRoadMean = 0;
    tel.n = 0;
    tel.steerFlips = 0;
    tel.kphMax = 0;
    tel.air = 0;
    tel.driveSum = 0;
    tel.rows = [];
    tel.lastTrace = -1e9;
    tel.yLow = car.y;
    tel.yHigh = car.y;
    win.__ms = ms;
    let done = false;
    let out = null;
    let err = null;
    fn(win, perf, raf, fakeSetTimeout, KeyboardEvent).then(
      (r) => { out = r; done = true; },
      (e) => { err = e; done = true; }
    );
    let guard = 0;
    while (!done && guard++ < 400000) {
      await new Promise((r) => setImmediate(r));
      if (done) break;
      const f = rafQ.shift();
      if (!f) continue;
      pump();
      f();
    }
    if (err) throw err;
    out.onRoadMin = +tel.onRoadMin.toFixed(2);
    out.onRoadMean = +(tel.onRoadMean / Math.max(1, tel.n)).toFixed(2);
    out.steps = tel.n;
    out.flips = tel.steerFlips;
    out.kphMax = +tel.kphMax.toFixed(1);
    out.airFrac = +(tel.air / Math.max(1, tel.n)).toFixed(2);
    out.meanDrive = Math.round(tel.driveSum / Math.max(1, tel.n));
    out.climb = +(car.y - tel.yLow).toFixed(1);
    out.keysLeftHeld = [...held];
    out.trace = tel.rows;
    return out;
  };
}

/* ── the browser's OWN placement, lifted out of browser-test.mjs ───────────
 * O2's "find a clear stretch" block is a page string in that file. Rather than re-type it (a
 * re-typed copy proves nothing about the shipped one), pull it out and run it with the same
 * `W.car` / `c.terrain.constructor` shape it expects. */
/* Anchored on the 3200 m box, which is O2's OWN placement block: C5 further up the same file
 * now carries a near-identical finder over a 1600 m box, and an unanchored match would lift
 * that one and quietly measure a different check's code. */
const mFind = btSrc.match(
  /const big = new T\(c\.terrain\.seed, c\.x - 3200,([\s\S]*?)\n    \}\)\(\)`\);/
);
if (!mFind) throw new Error("could not find O2's clear-stretch finder in browser-test.mjs");
let FIND_SRC =
  `(() => { const W = window.WANDEROAD; const c = W.car;\n  const T = c.terrain.constructor;\n` +
  `  const big = new T(c.terrain.seed, c.x - 3200,${mFind[1]}\n})()`;
/* `--unguarded` puts the zero-length-segment defect BACK, in this lifted copy only, so the
 * before and after can be measured from one build of the game with one command each. A repair
 * whose "before" number comes from a different checkout is not a comparison. */
if (process.argv.includes('--unguarded')) {
  const guarded = 'const l0 = Math.hypot(dx0, dz0);';
  if (!FIND_SRC.includes(guarded) || !FIND_SRC.includes('if (l0 < 1e-3) continue;')) {
    throw new Error('--unguarded: the zero-length guard has moved; update this probe');
  }
  FIND_SRC = FIND_SRC.replace(guarded, 'const l0 = Math.hypot(dx0, dz0) || 1;').replace(
    'if (l0 < 1e-3) continue;',
    ''
  );
  console.log('\n!! --unguarded: the zero-length-segment guard has been REMOVED from the lifted');
  console.log('   copy of the finder. This is what O2 measured before the repair.');
}
const runFinder = () => {
  const fn = new Function('window', `return ${FIND_SRC};`);
  fn({ WANDEROAD: { car } });
  // main.js hands the car its 840 m window back on the very next frame.
  car.terrain = localFor(car.x, car.z);
};

/* ── --audit: the defect itself, counted rather than argued about ──────────
 * How many segments in the road polylines have zero length, and does the finder land on one?
 * A zero-length segment has no direction; `Math.hypot(dx, dz) || 1` used to turn that into the
 * vector (0, 0), so the straight-line walk below never moved, sampled the same point 63 times,
 * found it on the carriageway every time and reported the maximum possible 496 m of "clear
 * straight". The search stops at the first candidate over 280 m, so one duplicated vertex beat
 * every real straight in the box. This prints both finders — as shipped before the guard, and
 * with it — from the same terrain. */
function audit(cxA, czA) {
  const T = new Terrain(SEED, cxA - 3200, czA - 3200, cxA + 3200, czA + 3200);
  const tmp = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0, land: NaN };
  let segs = 0;
  let degen = 0;
  for (const e of T.roads.edges) {
    for (let k = 0; k < e.pts.length / 2 - 1; k++) {
      segs++;
      if (Math.hypot(e.pts[k * 2 + 2] - e.pts[k * 2], e.pts[k * 2 + 3] - e.pts[k * 2 + 1]) < 1e-3) degen++;
    }
  }
  const find = (guard) => {
    let best = null;
    for (const e of T.roads.edges) {
      const n = e.pts.length / 2;
      for (let k0 = 0; k0 < n - 1; k0++) {
        const dx0 = e.pts[k0 * 2 + 2] - e.pts[k0 * 2];
        const dz0 = e.pts[k0 * 2 + 3] - e.pts[k0 * 2 + 1];
        const raw = Math.hypot(dx0, dz0);
        if (guard && raw < 1e-3) continue;
        const l0 = raw || 1;
        const ux = dx0 / l0;
        const uz = dz0 / l0;
        const sx0 = e.pts[k0 * 2];
        const sz0 = e.pts[k0 * 2 + 1];
        let clear = 0;
        for (let run = 0; run <= 500; run += 8) {
          if (T.roads.carve(sx0 + ux * run, sz0 + uz * run, tmp).edge < 0.9) break;
          clear = run;
        }
        if (clear >= 150 && (!best || clear > best.run)) {
          best = { x: sx0, z: sz0, ux, uz, run: clear, tier: e.tier, key: e.key };
          if (clear >= 280) break;
        }
      }
      if (best && best.run >= 280) break;
    }
    return best;
  };
  const say = (label, b) => {
    if (!b) return console.log(`  ${label}: found nothing`);
    // How straight is it REALLY? Walk the chosen line and ask the road how far away it is.
    const L = new Terrain(SEED, b.x - 420, b.z - 420, b.x + 420, b.z + 420);
    let worst = 0;
    let y0 = null;
    let yEnd = 0;
    for (let s = 0; s <= 200; s += 5) {
      const q = L.roads.query(b.x + b.ux * s, b.z + b.uz * s);
      if (isFinite(q.d)) worst = Math.max(worst, q.d);
      const y = L.height(b.x + b.ux * s, b.z + b.uz * s);
      if (y0 === null) y0 = y;
      yEnd = y;
    }
    console.log(
      `  ${label}: edge ${b.key} tier ${b.tier} at (${b.x.toFixed(0)}, ${b.z.toFixed(0)})` +
        ` claiming ${b.run} m clear, direction (${b.ux.toFixed(3)}, ${b.uz.toFixed(3)})` +
        ` — the line it walked stays within ${worst.toFixed(2)} m of the centreline over 200 m` +
        ` and the ground under it moves ${(y0 - yEnd).toFixed(1)} m`
    );
  };
  console.log(`\naudit around (${cxA.toFixed(0)}, ${czA.toFixed(0)}): ${T.roads.edges.length} edges,` +
    ` ${segs} segments, ${degen} of them ZERO-LENGTH`);
  say('finder WITHOUT the guard (what O2 shipped)', find(false));
  say('finder WITH the guard (this repair)      ', find(true));
}
if (process.argv.includes('--audit')) {
  for (const at of [[0, 0], [1103, -1407], [-1600, 3500]]) audit(at[0], at[1]);
  process.exit(0);
}

const auto = new Autopilot();
function autoDrive(seconds, dt = 1 / 60) {
  if (!auto.on) auto.toggle(car);
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    car.terrain = localFor(car.x, car.z);
    car.update(dt, auto.update(car, COAST, dt) || COAST);
    rescue.update(dt, car, car.terrain.surface(car.x, car.z));
  }
  if (auto.on) auto.toggle(car);
}

console.log(`\nseed ${SEED}  land "${LAND}"  car "${CAR.id}"  ${SECS}s legs`);
console.log(`placement: ${USE_FINDER ? "O2's own clear-stretch finder" : 'autopilot-driven sites'}`);
console.log(`physics step swept over ${HZ.join(', ')} Hz — main.js steps once per RENDERED FRAME\n`);

for (let siteN = 0; siteN < SITES; siteN++) {
  autoDrive(siteN === 0 ? 20 : 45);
  const home = { x: car.x, z: car.z, yaw: car.yaw };
  const line = [];
  for (const hz of HZ) {
    car.terrain = localFor(home.x, home.z);
    car.placeAt(home.x, home.z, home.yaw);
    car.vx = car.vy = car.vz = 0;
    car.yawRate = 0;
    car.gear = 1;
    rescue.reset();
    if (USE_FINDER) runFinder();
    const leg = makeShippedLeg(1 / hz);
    const r = await leg(SECS * 1000);
    // The same 8 s from the same spot with the WHEEL STRAIGHT — throttle only, no steering.
    // If this is fast and the steered leg is slow, the cost is the run-up's own steering.
    car.terrain = localFor(home.x, home.z);
    car.placeAt(home.x, home.z, home.yaw);
    car.vx = car.vy = car.vz = 0;
    car.yawRate = 0;
    car.gear = 1;
    rescue.reset();
    if (USE_FINDER) runFinder();
    let noSteer = 0;
    let offKph = 0;
    let offOnRoad = 1;
    {
      const dt = 1 / hz;
      const FLAT = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
      for (let i = 0; i < Math.round(SECS / dt); i++) {
        car.terrain = localFor(car.x, car.z);
        car.update(dt, FLAT);
        rescue.update(dt, car, car.terrain.surface(car.x, car.z));
      }
      noSteer = car.kph;
    }
    /* ...and then O2's OWN off-road leg, taken exactly as the check takes it: walk clear of
     * every road keeping the heading, start from rest, hold W for the same eight seconds. The
     * verdict below is O2's assertion verbatim — nothing relaxed, nothing dropped. */
    {
      const dt = 1 / hz;
      const FLAT = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
      let x = car.x;
      let z = car.z;
      for (let i = 0; i < 60; i++) {
        x += Math.cos(car.yaw) * 20;
        z -= Math.sin(car.yaw) * 20;
        car.terrain = localFor(x, z);
        const q = car.terrain.roads.query(x, z);
        if (!isFinite(q.d) || q.d > 60) break;
      }
      car.terrain = localFor(x, z);
      car.placeAt(x, z, car.yaw);
      car.vx = car.vy = car.vz = 0;
      car.yawRate = 0;
      car.gear = 1;
      rescue.reset();
      for (let i = 0; i < Math.round(SECS / dt); i++) {
        car.terrain = localFor(car.x, car.z);
        car.update(dt, FLAT);
        rescue.update(dt, car, car.terrain.surface(car.x, car.z));
      }
      const s = car.terrain.surface(car.x, car.z);
      offKph = car.kph;
      offOnRoad = s.onRoad;
    }
    const verdict =
      r.onRoad > 0.5 && offOnRoad < 0.5 && offKph < r.kph * 0.55 ? 'O2 PASSES' : 'O2 FAILS';
    if (TRACE) r.trace.forEach((t) => line.push(t));
    line.push(
      `${String(hz).padStart(3)} Hz ${String(r.kph).padStart(6)} km/h` +
        ` (peak ${String(r.kphMax).padStart(6)}, onRoad end ${r.onRoad.toFixed(2)}` +
        ` / min ${r.onRoadMin.toFixed(2)} / mean ${r.onRoadMean.toFixed(2)},` +
        ` ${r.d.toFixed(1)} m off, AIRBORNE ${(r.airFrac * 100).toFixed(0)}% of the leg, mean drive ${r.meanDrive} N, ${r.flips} steer changes)` +
        `  |  WHEEL STRAIGHT ${noSteer.toFixed(1)} km/h` +
        `
          OFF-ROAD ${offKph.toFixed(1)} km/h (onRoad ${offOnRoad.toFixed(2)}) —` +
        ` ratio ${(offKph / Math.max(r.kph, 1e-6)).toFixed(2)} against a 0.55 bar: ${verdict}`
    );
  }
  console.log(`site ${siteN + 1} (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`);
  for (const l of line) console.log(`   ${l}`);
  // Put the car back where the autopilot left it so the next site is a fresh stretch.
  car.terrain = localFor(home.x, home.z);
  car.placeAt(home.x, home.z, home.yaw);
}
