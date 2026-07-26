/* Wanderoad — what happens when you just hold the accelerator.
 *
 * The browser suite's C4 ("lifting off slows you visibly") measures a coast-down, but to
 * measure one it first has to HAVE some speed: it resets onto the road, holds W for nine
 * seconds, then lets go and reads the loss over six seconds. That run-up is the fragile part.
 * If the car is anywhere other than "moving briskly" when the throttle is released, the
 * number the check prints is not a property of the car at all.
 *
 * So this reproduces the run-up headlessly, against the same seed, the same land preset and
 * the same starting car the browser test uses, with the same water rescue attached — and
 * prints where the car is, how fast, how far off the centreline, and how deep the water is,
 * every half second. No renderer, no server, no Chrome.
 *
 *   node tools/diag-runup.mjs [--secs 9] [--terrain meadow] [--runs 4]
 */

import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
/* Optional so the same file runs against an older checkout that predates the water rescue —
 * the before/after is the whole point of a diagnostic like this. */
let Rescue = class {
  reset() {}
  update() {
    return false;
  }
};
let waterDepth = () => 0;
try {
  ({ Rescue, waterDepth } = await import('../src/game/rescue.js'));
} catch {
  /* no rescue in this checkout */
}
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { applyCarFeel, FLEET_BY_ID, FIRST_CAR } from '../src/game/garage.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = 20260726;
const SECS = +arg('secs', 9);
const RUNS = +arg('runs', 4);
const LAND = arg('terrain', 'meadow'); // the browser suite loads ?terrain=meadow
const DT = 1 / 60;

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));
const CAR = FLEET_BY_ID[FIRST_CAR]; // the browser test has no save, so it drives the Estate
applyCarFeel(CAR);

/* main.js keeps an exact 840 m terrain window around the car and rebuilds it once the car is
 * 240 m from its centre. Copy that exactly — the sampled ground is what the solver reads. */
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

/* main.js's backToRoad(), which is also what the R key and the rescue both call. */
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

function drive(seconds, input) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    car.terrain = localFor(car.x, car.z);
    car.update(DT, input);
    rescue.update(DT, car, car.terrain.surface(car.x, car.z));
  }
}

/* Auto-drive, wired exactly as main.js wires it: the autopilot's input replaces the player's
 * when it is on. Feeding it a zero manual command is what the game does when nobody is
 * touching anything, so it does not hand control back. */
const auto = new Autopilot();
function autoDrive(seconds) {
  if (!auto.on) auto.toggle(car);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    car.terrain = localFor(car.x, car.z);
    car.update(DT, auto.update(car, COAST, DT) || COAST);
    rescue.update(DT, car, car.terrain.surface(car.x, car.z));
  }
}

const row = (t) => {
  const q = car.terrain.roads.query(car.x, car.z);
  const surf = car.terrain.surface(car.x, car.z);
  return (
    `  t${t.toFixed(1).padStart(5)}s  ${car.kph.toFixed(1).padStart(6)} km/h  ` +
    `roadDist ${(isFinite(q.d) ? q.d : 999).toFixed(1).padStart(6)}  onRoad ${surf.onRoad.toFixed(2)}  ` +
    `y ${car.y.toFixed(2).padStart(6)}  water ${waterDepth(surf).toFixed(2)}  rescues ${rescues}`
  );
};

console.log(`\nseed ${SEED}  land "${LAND}"  car "${CAR.id}"  spawn (${spawn.x.toFixed(0)}, ${spawn.z.toFixed(0)})`);

/** The suite's reset(): tap R, then zero the velocities. */
function suiteReset() {
  backToRoad();
  car.vx = car.vy = car.vz = 0;
  car.yawRate = 0;
}

/* `--at x,z` starts on the road nearest a given point, both ways along it. The browser trace
 * of the failing C4 ends with the car put back at (846, 510), so that is the stretch of road
 * the real suite was on when it read 19 km/h. */
const AT = arg('at', null);
if (AT) {
  const [ax, az] = AT.split(',').map(Number);
  const T = localFor(ax, az);
  const q = T.roads.query(ax, az);
  console.log(`\nnearest road to (${ax}, ${az}) is ${q.d.toFixed(1)} m away at (${q.qx.toFixed(0)}, ${q.qz.toFixed(0)})`);
  for (const dir of [1, -1]) {
    car.terrain = T;
    car.placeAt(q.qx, q.qz, Math.atan2(q.tx * dir, q.tz * dir));
    car.vx = car.vy = car.vz = 0;
    car.yawRate = 0;
    rescue.reset();
    const r0 = rescues;
    console.log(`\n── heading ${dir > 0 ? 'forwards' : 'backwards'} along it, throttle down ──`);
    for (let t = 0; t < SECS; t++) {
      drive(1, FLAT);
      console.log(row(t + 1));
    }
    const v0 = car.kph;
    drive(6, COAST);
    console.log(
      `  C4 would read: ${v0.toFixed(0)} -> ${car.kph.toFixed(0)} km/h in 6 s = ${((v0 - car.kph) / 3.6 / 6).toFixed(2)} m/s2` +
        `   rescues ${rescues - r0}`
    );
  }

  /* Does C2's retry rescue this? backToRoad() puts the car back at the same point facing the
   * same way — the tangent, not the heading it arrived with — so a retry can be the identical
   * run-up. This prints all three goes so that is visible rather than assumed. */
  console.log('\n── the same stretch, with C2\'s "up to three goes" guard ──');
  car.terrain = localFor(q.qx, q.qz);
  car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
  car.vx = car.vy = car.vz = 0;
  car.yawRate = 0;
  rescue.reset();
  let v = 0;
  for (let attempt = 0; attempt < 3 && v < 45; attempt++) {
    if (attempt > 0) suiteReset(); // exactly the order browser-test.mjs uses
    drive(SECS, FLAT);
    v = car.kph;
    console.log(`  go ${attempt + 1}: run-up ended at ${v.toFixed(1)} km/h, (${car.x.toFixed(0)}, ${car.z.toFixed(0)})`);
  }
  const vv = car.kph;
  drive(6, COAST);
  console.log(`  C4 would read: ${vv.toFixed(0)} -> ${car.kph.toFixed(0)} km/h = ${((vv - car.kph) / 3.6 / 6).toFixed(2)} m/s2`);
} else if (process.argv.includes('--sweep')) {
  /* The C4 sequence as the browser suite runs it, from a lot of independent places on the
   * road network, with and without the run-up retry C2 already has. This is the number that
   * says whether a retry is a fix or a coin toss. */
  const N = +arg('sweep', 40);
  const sites = [];
  for (let i = 0; i < N; i++) {
    // Spread the starting points over several km of world; roads.query snaps each to a road.
    const a = (i * 2.39996) % 6.28318;
    const r = 300 + i * 160;
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    car.terrain = localFor(px, pz);
    const q = car.terrain.roads.query(px, pz);
    if (isFinite(q.d)) sites.push({ x: q.qx, z: q.qz, h: Math.atan2(q.tx, q.tz) });
  }

  const atSite = (s) => {
    car.terrain = localFor(s.x, s.z);
    car.placeAt(s.x, s.z, s.h);
    car.vx = car.vy = car.vz = 0;
    car.yawRate = 0;
    rescue.reset();
  };

  /** One C4 as the suite runs it. `retries` 1 = today, 3 = the same guard C2 already has.
   *  The reset goes BEFORE a retry, not after a failed go, so a run that never gets there is
   *  still measured from wherever it actually finished rather than from a standing start. */
  const c4 = (s, retries) => {
    atSite(s);
    let v0 = 0;
    let goes = 0;
    for (let attempt = 0; attempt < retries && v0 < 45; attempt++) {
      if (attempt > 0) suiteReset();
      goes++;
      drive(SECS, FLAT);
      v0 = car.kph;
    }
    drive(6, COAST);
    return { v0, decel: (v0 - car.kph) / 3.6 / 6, goes };
  };

  /* Variant D: retry until the run-up ended quick AND the six seconds that follow are not
   * spent falling down a hill. Gravity on a descent cancels the drag the check is trying to
   * see — browser-test.mjs's own comment says as much — and the land has a lot more relief in
   * it than it used to. Whether that is worth the extra machinery is what this measures. */
  const c4level = (s, retries, dyMax) => {
    atSite(s);
    let last = null;
    let goes = 0;
    for (let attempt = 0; attempt < retries; attempt++) {
      if (attempt > 0) suiteReset();
      goes++;
      drive(SECS, FLAT);
      const v0 = car.kph;
      const y0 = car.y;
      drive(6, COAST);
      last = { v0, decel: (v0 - car.kph) / 3.6 / 6, dy: car.y - y0, goes };
      if (v0 >= 45 && Math.abs(last.dy) <= dyMax) break;
    }
    return last;
  };

  /* The third way: let auto-drive bring the car up to cruise ON THE ROAD, then switch it off
   * and coast. Same measurement, same six seconds, but the speed the car is carrying when the
   * throttle closes is not a lottery on how straight that stretch happened to be. This is the
   * remedy the streak check in browser-test.mjs already uses, for the same disease. */
  const c4auto = (s, secs) => {
    atSite(s);
    auto.off('bench');
    autoDrive(secs);
    auto.off('bench'); // the G key again — from here nobody is touching anything
    const v0 = car.kph;
    const onRoad = car.terrain.surface(car.x, car.z).onRoad;
    drive(6, COAST);
    return { v0, onRoad, decel: (v0 - car.kph) / 3.6 / 6 };
  };

  let plain = 0;
  let retry = 0;
  let piloted = 0;
  let level = 0;
  let goesSum = 0;
  let worstAuto = 9;
  const notes = [];
  for (const s of sites) {
    const a = c4(s, 1);
    const b = c4(s, 3);
    const c = c4auto(s, 14);
    const d = c4level(s, 3, 6);
    if (a.decel > 1.0) plain++;
    if (b.decel > 1.0) retry++;
    if (c.decel > 1.0) piloted++;
    if (d.decel > 1.0) level++;
    goesSum += d.goes;
    worstAuto = Math.min(worstAuto, c.decel);
    if (b.decel <= 1.0)
      notes.push(`  retry still FAILS at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}): v0 ${b.v0.toFixed(0)} km/h, decel ${b.decel.toFixed(2)} after ${b.goes} goes`);
    if (d.decel <= 1.0)
      notes.push(`  level guard FAILS at (${s.x.toFixed(0)}, ${s.z.toFixed(0)}): v0 ${d.v0.toFixed(0)} km/h, dy ${d.dy.toFixed(1)} m, decel ${d.decel.toFixed(2)} after ${d.goes} goes`);
  }
  console.log(`\n${sites.length} independent C4 runs, each done four ways from the same road point:`);
  console.log(`  decel > 1.0 m/s2, one blind go (what the suite does today): ${plain}/${sites.length}`);
  console.log(`  decel > 1.0 m/s2, up to 3 blind goes (C2's guard):         ${retry}/${sites.length}`);
  console.log(`  decel > 1.0 m/s2, auto-drive up to cruise then lift off:   ${piloted}/${sites.length}  (worst ${worstAuto.toFixed(2)})`);
  console.log(`  decel > 1.0 m/s2, 3 goes + "not falling downhill" guard:   ${level}/${sites.length}  (${(goesSum / sites.length).toFixed(1)} goes average)`);
  for (const n of notes) console.log(n);
} else {
  for (let run = 0; run < RUNS; run++) {
    suiteReset();
    const startRescues = rescues;
    console.log(`\n── run ${run + 1}: hold throttle for ${SECS} s from (${car.x.toFixed(0)}, ${car.z.toFixed(0)}) ──`);
    for (let t = 0; t < SECS; t += 1) {
      drive(1, FLAT);
      console.log(row(t + 1));
    }
    const v0 = car.kph;
    drive(6, COAST);
    const v1 = car.kph;
    const decel = (v0 - v1) / 3.6 / 6;
    console.log(
      `  C4 would read: ${v0.toFixed(0)} -> ${v1.toFixed(0)} km/h in 6 s = ${decel.toFixed(2)} m/s2  ` +
        `(want > 1.0)   rescues during run-up: ${rescues - startRescues}`
    );
  }
}
