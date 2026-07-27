/* Wanderoad — what O2 actually measures.
 *
 * The browser suite's O2 ("off-road is meaningfully slower than tarmac") takes an ON-ROAD
 * baseline by doing reset() (= KeyR = backToRoad) and then holding W for eight seconds IN A
 * STRAIGHT LINE. Roads turn up to 223 deg/km since bb1803a, so a straight-line run-up leaves
 * the tarmac well before eight seconds are up and the "on-road" number is measured in a field.
 * Both legs then read the off-road ceiling — offCap = lerp(12.2, 200, clamp01(onRoad*1.4)) =
 * 12.2 m/s = 43.9 km/h at onRoad 0 — and the ratio is 1.00.
 *
 * This reproduces the whole O2 sequence headlessly, at many independent points on the road
 * network, against the same seed / land preset / starting car the browser suite uses, with the
 * same water rescue attached. Three variants of the on-road leg:
 *
 *   straight  — what O2 does today: throttle only, no steering.
 *   steered   — throttle plus the bang-bang A/D steering the repaired check dispatches.
 *   retried   — steered, with the "did it end on the road?" guard and up to three goes.
 *
 * No renderer, no server, no Chrome.
 *
 *   node tools/diag-o2.mjs [--sites 8] [--secs 8] [--terrain meadow]
 */

import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle as RealVehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { Rescue } from '../src/game/rescue.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { applyCarFeel, FLEET_BY_ID, FIRST_CAR } from '../src/game/garage.js';
import { angleDelta, clamp } from '../src/core/math.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = 20260726;
const SECS = +arg('secs', 8); // O2 holds W for 8000 ms on both legs
const SITES = +arg('sites', 8);
const LAND = arg('terrain', 'meadow'); // the browser suite loads ?terrain=meadow
const DT = 1 / 60;

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));
const CAR = FLEET_BY_ID[FIRST_CAR]; // the browser test has no save, so it drives the Estate
applyCarFeel(CAR);

/* main.js keeps an exact 840 m terrain window around the car and rebuilds it once the car is
 * 240 m from its centre. Same as diag-runup.mjs — the sampled ground is what the solver reads. */
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

/* ── --nocap: can the repaired check still FAIL? ────────────────────────────
 * A check that cannot fail is not a check. The regression this one exists to catch is the one
 * a7b645a fixed: `offCap` sitting BELOW the force sum, where it clamped a `driveForce` that had
 * already been added into `fxTotal` and therefore limited nothing. So build a vehicle with
 * exactly that defect — the real vehicle.js with the one `if (contact && vLong > offCap …)`
 * line removed, imported from a scratch copy outside the repo so nothing in src/ is touched —
 * and run the same sweep against it. If the repaired O2 passes THAT, it is measuring nothing.
 */
let Vehicle = RealVehicle;
let scratch = null;
if (process.argv.includes('--nocap')) {
  const SRC = resolve(new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const src = readFileSync(join(SRC, 'car/vehicle.js'), 'utf8');
  const CAP = 'if (contact && vLong > offCap && driveForce > 0) driveForce = 0;';
  if (!src.includes(CAP)) throw new Error('the offCap line has moved — --nocap needs updating');
  const patched = src
    .replace(CAP, 'void offCap; // DELIBERATELY DEFEATED for the falsifiability probe')
    .replace("from './tuning.js'", `from ${JSON.stringify(pathToFileURL(join(SRC, 'car/tuning.js')).href)}`)
    .replace("from '../core/math.js'", `from ${JSON.stringify(pathToFileURL(join(SRC, 'core/math.js')).href)}`);
  scratch = mkdtempSync(join(tmpdir(), 'wanderoad-o2-'));
  const f = join(scratch, 'vehicle-nocap.js');
  writeFileSync(f, patched);
  ({ Vehicle } = await import(pathToFileURL(f).href));
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
  console.log('\n!! --nocap: the off-road ceiling has been DELIBERATELY DEFEATED in a scratch copy.');
  console.log('   The repaired O2 must FAIL here, or it is not measuring the ceiling at all.');
}

const spawn = findSpawn(SEED);
const car = new Vehicle({ tier: CAR.tier, terrain: localFor(spawn.x, spawn.z), preset: CAR.feel.assist });
car.placeAt(spawn.x, spawn.z, spawn.heading);

/* main.js's backToRoad(), which is what the R key and the rescue both call. */
function backToRoad() {
  const t = car.terrain;
  const q = t.roads.query(car.x, car.z);
  if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
  else {
    const s = findSpawn(SEED, car.x, car.z);
    car.placeAt(s.x, s.z, s.heading);
  }
}
let rescues = 0;
const rescue = new Rescue({
  recover: () => {
    rescues++;
    backToRoad();
  },
});

const FLAT = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
const COAST = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

function step(input) {
  car.terrain = localFor(car.x, car.z);
  car.update(DT, input);
  rescue.update(DT, car, car.terrain.surface(car.x, car.z));
}

/** The suite's reset(): tap R, then zero the velocities. */
function suiteReset() {
  backToRoad();
  car.vx = car.vy = car.vz = 0;
  car.yawRate = 0;
  car.gear = 1;
}

/* ── the on-road leg, three ways ───────────────────────────────────────── */

/** Today's O2: throttle down, nothing on the wheel. */
let legMaxOnRoad = 0;
let legDrop = 0;
function straightLeg(seconds) {
  legMaxOnRoad = 0;
  const y0 = car.y;
  let yLow = car.y;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    step(FLAT);
    // Did the "off-road" leg touch tarmac at any point? A leg that gained its speed on a
    // road it then left is not an off-road measurement, whatever it reads at the end.
    legMaxOnRoad = Math.max(legMaxOnRoad, car.terrain.surface(car.x, car.z).onRoad);
    yLow = Math.min(yLow, car.y);
  }
  legDrop = y0 - yLow;
}

/**
 * The steering the repaired check dispatches, modelled EXACTLY as keys: the browser can only
 * press A, press D, or press neither, so this produces steer = +1 / -1 / 0 and lets the
 * vehicle's own keyboard ramp do the rest. Nothing analogue, nothing the player could not do.
 *
 * HANDEDNESS: three.js puts +X on your LEFT looking down +Z. roads.query gives the closest
 * point on the centreline and the segment tangent, so `lateral` — positive when the car is
 * LEFT of the centreline — is (x-qx)*tz - (z-qz)*tx, the same expression autopilot.js uses.
 * Positive steer (KeyA) also turns LEFT, so being left of the line has to answer with KeyD.
 */
const KEY_STEER = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: false };
function roadSteerKey() {
  // Pure pursuit. Take the point on the centreline nearest to a spot a second or so AHEAD of
  // the car and aim at it. Doing it this way means the curve of the road is in the target for
  // free — a law built only on "distance from the line here" always corrects a bend one
  // segment late, which is exactly what left the car in a field.
  const L = clamp(8 + Math.abs(car.speed) * 0.75, 10, 34);
  const ax = car.x + Math.sin(car.yaw) * L;
  const az = car.z + Math.cos(car.yaw) * L;
  const qa = car.terrain.roads.query(ax, az);
  if (!isFinite(qa.d)) return 0;
  // Bearing to the target, in the game's heading convention: forward is (sin yaw, cos yaw).
  const bearing = Math.atan2(qa.qx - car.x, qa.qz - car.z);
  const err = angleDelta(car.yaw, bearing); // + = the target lies to the LEFT
  if (err > 0.02) return 1; // KeyA — positive steer turns LEFT (see input.js)
  if (err < -0.02) return -1; // KeyD
  return 0;
}
/* The browser takes its steering decision once per FRAME, not once per physics step, and the
 * suite only guarantees 24 fps. `--dechz` re-decides every Nth step so the same law can be run
 * at the frame rate the check is actually allowed to run at: 1 = 60 Hz, 3 = 20 Hz. */
const DEC = Math.max(1, +arg('decstep', 1));
function steeredLegLocal(seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    if (i % DEC === 0) KEY_STEER.steer = roadSteerKey();
    step(KEY_STEER);
  }
}

/* ── the SHIPPED page code, byte for byte, driving this same car ────────────
 * "Code being present is not code being run", and a reimplementation that agrees with itself
 * proves nothing about the thing that actually ships. So pull `roadRunUp`'s page source
 * straight out of tools/browser-test.mjs and RUN IT, against the real Vehicle and the real
 * Terrain, with just enough of a browser around it to be honest:
 *
 *   window.dispatchEvent  a real key set — keydown adds, keyup removes, nothing else
 *   the key set           mapped to steer/throttle through the SAME rule as car/input.js
 *                         (steerLeft - steerRight, so KeyA = +1 = left)
 *   requestAnimationFrame steps the physics ONE frame, then calls back — the browser's
 *                         ordering, where the keys held now act on the frame about to run
 *   performance.now       simulated time, so an 8000 ms leg is 8000 ms of SIMULATED driving
 *
 * If the shipped code has a sign error, a stale variable or a key it forgets to release, it
 * shows up here rather than in a browser nobody is allowed to start.
 */
const BT = new URL('./browser-test.mjs', import.meta.url);
const btSrc = readFileSync(BT, 'utf8');
const mRunUp = btSrc.match(/const roadRunUp = async \(ms\) => await evalJs\(`([\s\S]*?)`\);/);
if (!mRunUp) throw new Error('could not find roadRunUp in browser-test.mjs — has it been renamed?');
const PAGE_SRC = mRunUp[1];

function makeShippedLeg() {
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
  const fakeSetTimeout = () => 0; // the rAF path always wins; the timer is only a hang guard
  const input = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: false };
  const pump = () => {
    // car/input.js: kSteer = held(steerLeft) - held(steerRight); KeyA is steerLeft.
    input.steer = (held.has('KeyA') ? 1 : 0) - (held.has('KeyD') ? 1 : 0);
    input.throttle = held.has('KeyW') ? 1 : 0;
    input.brake = held.has('KeyS') ? 1 : 0;
    for (let k = 0; k < DEC; k++) {
      step(input);
      simMs += DT * 1000;
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
    win.__ms = ms;
    let done = false;
    let out = null;
    let err = null;
    fn(win, perf, raf, fakeSetTimeout, KeyboardEvent).then(
      (r) => { out = r; done = true; },
      (e) => { err = e; done = true; }
    );
    let guard = 0;
    while (!done && guard++ < 200000) {
      await new Promise((r) => setImmediate(r)); // flush microtasks
      if (done) break;
      const f = rafQ.shift();
      if (!f) continue;
      pump();
      f();
    }
    if (err) throw err;
    // The shipped code MUST leave the keyboard clean — a held W would drive every later check.
    out.keysLeftHeld = [...held];
    return out;
  };
}
const shippedLeg = makeShippedLeg();

/* ── the off-road leg, exactly as O2 relocates ─────────────────────────── */
function goOffRoad() {
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
}

const read = () => {
  const s = car.terrain.surface(car.x, car.z);
  const q = car.terrain.roads.query(car.x, car.z);
  return { kph: +car.kph.toFixed(1), onRoad: +s.onRoad.toFixed(2), d: isFinite(q.d) ? +q.d.toFixed(1) : 999 };
};

/* ── pick sites by DRIVING there, not by teleporting ───────────────────── */
const auto = new Autopilot();
function autoDrive(seconds) {
  if (!auto.on) auto.toggle(car);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    car.terrain = localFor(car.x, car.z);
    car.update(DT, auto.update(car, COAST, DT) || COAST);
    rescue.update(DT, car, car.terrain.surface(car.x, car.z));
  }
}

console.log(`\nseed ${SEED}  land "${LAND}"  car "${CAR.id}"  ${SITES} sites, ${SECS}s legs`);
console.log(`O2 today: onRoadTop from a straight run-up; passes if onRoad < 0.5 AND off < onRoadTop * 0.55\n`);

const LOCAL = process.argv.includes('--local');
const stuckKeys = [];
const rows = [];
for (let siteN = 0; siteN < SITES; siteN++) {
  autoDrive(siteN === 0 ? 20 : 45); // let the real autopilot carry the car to a fresh stretch
  auto.toggle(car); // hand the wheel back
  const home = { x: car.x, z: car.z, yaw: car.yaw };

  const home2 = () => {
    car.terrain = localFor(home.x, home.z);
    car.placeAt(home.x, home.z, home.yaw);
    suiteReset();
    rescue.reset();
  };
  /* `--local` swaps the shipped page code for the reimplementation above. The two should
   * agree; if they ever stop agreeing, the shipped one is the one that matters. */
  const takeSteered = async () => {
    if (LOCAL) {
      steeredLegLocal(SECS);
      return read();
    }
    return await shippedLeg(SECS * 1000);
  };

  home2();
  straightLeg(SECS);
  const straight = read();

  /* The steered baseline as the SHIPPED check takes it: up to three goes, reset between, and
   * the guard is "did this leg end on the road?" — the same shape as the run-up guard C4
   * already carries. */
  home2();
  let steered = await takeSteered();
  let steerGoes = 1;
  for (let i = 0; i < 2 && steered.onRoad <= 0.5; i++) {
    suiteReset();
    rescue.reset();
    steered = await takeSteered();
    steerGoes++;
  }
  steered.goes = steerGoes;
  if (steered.keysLeftHeld && steered.keysLeftHeld.length) stuckKeys.push(steered.keysLeftHeld.join('+'));

  // …and the off-road leg, taken from the same place, exactly as O2 takes it.
  home2();
  /* Up to three goes, exactly as the repaired check takes them: relocate, drive, and accept
   * the first leg that never touched tarmac. A leg that drove onto a road, gained speed on it
   * and left again is not a measurement of a field, whatever it reads at the end. */
  let off = null;
  let off1 = null; // go ONE on its own — what the check gets with no off-road retry at all
  let goes = 0;
  for (let go = 0; go < 3; go++) {
    goes++;
    goOffRoad();
    car.vx = car.vy = car.vz = 0;
    car.yawRate = 0;
    const landed = read();
    straightLeg(SECS);
    off = read();
    off.landedOnRoad = landed.onRoad;
    off.landedD = landed.d;
    off.maxOnRoad = legMaxOnRoad;
    off.drop = legDrop;
    off.goes = goes;
    if (!off1) off1 = off;
    if (off.maxOnRoad < 0.5) break;
  }

  rows.push({ home, straight, steered, off, off1 });
  console.log(
    `site ${String(siteN + 1).padStart(2)} (${home.x.toFixed(0)}, ${home.z.toFixed(0)})  ` +
      `STRAIGHT ${String(straight.kph).padStart(6)} km/h onRoad ${straight.onRoad.toFixed(2)} ${straight.d.toFixed(1).padStart(6)} m  |  ` +
      `STEERED ${String(steered.kph).padStart(6)} km/h onRoad ${steered.onRoad.toFixed(2)} ${steered.d.toFixed(1).padStart(6)} m  |  ` +
      `OFF ${String(off.kph).padStart(6)} km/h onRoad ${off.onRoad.toFixed(2)} ` +
      `(landed ${off.landedD.toFixed(0)} m out; peak onRoad DURING the leg ${off.maxOnRoad.toFixed(2)}, ` +
      `dropped ${off.drop.toFixed(1)} m, ${off.goes} go${off.goes > 1 ? 'es' : ''})`
  );
}

const pct = (n) => `${n}/${rows.length}`;
const straightOn = rows.filter((r) => r.straight.onRoad > 0.5).length;
const steeredOn = rows.filter((r) => r.steered.onRoad > 0.5).length;
/* The three variants of O2, all judged by O2's OWN assertion, unchanged:
 *   A  today            — straight baseline, one off-road go
 *   B  steered baseline — the repair, one off-road go
 *   C  B + off-road retry — B, plus re-taking an off-road leg that drove onto tarmac */
const ok = (base, o) => base.onRoad > 0.5 && o.onRoad < 0.5 && o.kph < base.kph * 0.55;
const passA = rows.filter((r) => r.off1.onRoad < 0.5 && r.off1.kph < r.straight.kph * 0.55).length;
const passB = rows.filter((r) => ok(r.steered, r.off1)).length;
const passC = rows.filter((r) => ok(r.steered, r.off)).length;
const fieldClean1 = rows.filter((r) => r.off1.maxOnRoad < 0.5).length;
const fieldCleanN = rows.filter((r) => r.off.maxOnRoad < 0.5).length;

console.log(`\n── the on-road baseline leg actually ends ON the road ──`);
console.log(`  straight, 1 go   (O2 today): ${pct(straightOn)}`);
console.log(`  steered, up to 3 (repaired): ${pct(steeredOn)}`);
console.log(`\n── the off-road leg never touches tarmac ──`);
console.log(`  1 go:            ${pct(fieldClean1)}`);
console.log(`  up to 3 goes:    ${pct(fieldCleanN)}`);
console.log(`\n── O2's own assertion, unchanged (onRoad < 0.5 AND off < baseline * 0.55) ──`);
console.log(`  A  straight baseline, 1 off-road go   (today):    ${pct(passA)} pass`);
console.log(`  B  steered baseline,  1 off-road go   (repair):   ${pct(passB)} pass`);
console.log(`  C  steered baseline,  off-road retry (repair+):   ${pct(passC)} pass`);
const mean = (f) => (rows.reduce((a, r) => a + f(r), 0) / rows.length).toFixed(1);
console.log(
  `\nmean on-road top: straight ${mean((r) => r.straight.kph)} km/h, steered ${mean((r) => r.steered.kph)} km/h;` +
    ` mean off-road top ${mean((r) => r.off.kph)} km/h`
);
console.log(`rescues fired during the whole sweep: ${rescues}`);
console.log(
  `steering source: ${LOCAL ? 'the reimplementation in this file (--local)' : "browser-test.mjs's OWN roadRunUp page code"}`
);
console.log(
  stuckKeys.length
    ? `!! the run-up left keys held down ${stuckKeys.length} time(s): ${stuckKeys.join(', ')}`
    : `the run-up left the keyboard clean every time (no key held after any leg)`
);
