/* Wanderoad — ten runs at a kilometre, headless, with the REAL autopilot.
 *
 * tools/streak-runs.mjs does this in a browser. A browser is a bad place to iterate on a
 * controller: it needs a dev server and a headless Chrome, both of which collide when more
 * than one agent is working in the checkout, and a 120 s wall-clock run per attempt means ten
 * runs cost twenty minutes of doing nothing.
 *
 * This is the same experiment in node, at the same 120 Hz fixed step the browser solves at,
 * driving the SAME src/car/autopilot.js and scoring with the SAME src/game/streak.js. Nothing
 * about the car, the roads or the streak rules is re-implemented here — only the frame loop,
 * which is main.js's order of operations with the renderer taken out:
 *
 *     terrain -> autopilot -> car._step -> surface -> streak
 *
 * What it cannot see: trees, props and other solids (src/game/collide.js resolves those in
 * main.js and the browser harness hooks it). So a "reached" here means the autopilot held the
 * road for a kilometre, not that the kilometre was free of obstacles. Road-holding is what
 * this measures and all it claims.
 *
 *     node tools/streak-auto.mjs [--runs 10] [--target 1000] [--seed 20260726] [--secs 150]
 *
 * Exits non-zero if fewer than half the runs reach the target, like the browser one.
 */

// The streak persists to localStorage, which does not exist here. Same stub bench-streak uses.
globalThis.localStorage = {
  _d: {},
  getItem(k) {
    return this._d[k] ?? null;
  },
  setItem(k, v) {
    this._d[k] = v;
  },
};

const { Vehicle } = await import('../src/car/vehicle.js');
const { Terrain, findSpawn } = await import('../src/world/terrain.js');
const { Autopilot } = await import('../src/car/autopilot.js');
const { Streak } = await import('../src/game/streak.js');
const { PHYSICS_DT } = await import('../src/car/tuning.js');

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? +argv[i + 1] : d;
};
const RUNS = opt('runs', 10);
const TARGET = opt('target', 1000);
const SEED = opt('seed', 20260726);
const SECS = opt('secs', 150);
/* 0 = whatever the autopilot picks for itself when you switch it on, which is what a player
 * gets. A number here forces its cruise so the same roads can be re-run at pace. */
const CRUISE = opt('cruise', 0);
/* main.js asks the autopilot for an input ONCE PER RENDERED FRAME and then runs the solver at
 * 120 Hz underneath it, so a controller that only behaves when it is called every 8 ms is a
 * controller that does not work in the game. Default 60, the frame rate the game targets. */
const HZ = opt('hz', 60);
const VERBOSE = argv.includes('--verbose');

const spawn = findSpawn(SEED);
const NOTHING = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

/** main.js's localFor(): one 840 m field, rebuilt when the car nears its edge. */
function fieldFor(x, z) {
  return new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
}

/** main.js's backToRoad(): nearest centreline, pointing along it. */
function putOnRoad(car, x, z) {
  let terr = fieldFor(x, z);
  const q = terr.roads.query(x, z);
  if (isFinite(q.d)) {
    car.terrain = terr;
    car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    return terr;
  }
  const s = findSpawn(SEED, x, z);
  terr = fieldFor(s.x, s.z);
  car.terrain = terr;
  car.placeAt(s.x, s.z, s.heading);
  return terr;
}

function run(r) {
  /* Somewhere new each run, so ten runs are not one road ten times — the same spiral the
   * browser harness walks. */
  const ang = r * 2.4;
  const rad = 900 + r * 700;
  const car = new Vehicle({ tier: 'sports', terrain: null, preset: 'cruise' });
  let terr = putOnRoad(car, spawn.x + Math.cos(ang) * rad, spawn.z + Math.sin(ang) * rad);
  let cx = car.x;
  let cz = car.z;

  const auto = new Autopilot();
  auto.toggle(car);
  if (CRUISE) auto.cruise = CRUISE;
  const streak = new Streak({ storageKey: `run${r}` });

  let peak = 0;
  let why = 'timeout';
  let offAt = null;
  let wasOn = true;
  let slow = 0;
  let steps = 0;
  let onRoad = 0;
  let worst = 0;
  let dist = 0;
  let dSteer = 0;
  let prevSteer = 0;
  let held = NOTHING;
  let px = car.x;
  let pz = car.z;
  const trace = [];

  const n = Math.round(SECS / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    if (Math.abs(car.x - cx) > 240 || Math.abs(car.z - cz) > 240) {
      terr = fieldFor(car.x, car.z);
      car.terrain = terr;
      cx = car.x;
      cz = car.z;
    }
    // One controller update per frame, several solver substeps under it — main.js's order.
    const every = Math.max(1, Math.round(120 / HZ));
    if (i % every === 0) {
      held = auto.update(car, NOTHING, every * PHYSICS_DT) || NOTHING;
      if (!auto.on) {
        why = auto.lastReason || 'auto-drive gave up';
        break;
      }
      dSteer += Math.abs(held.steer - prevSteer);
      prevSteer = held.steer;
    }
    const cmd = held;
    car._step(PHYSICS_DT, cmd);
    const surf = terr.surface(car.x, car.z);
    streak.update(PHYSICS_DT, car, surf);

    const q = terr.roads.query(car.x, car.z);
    const d = isFinite(q.d) ? q.d : 999;
    steps++;
    if (d <= q.width * 0.5) onRoad++;
    worst = Math.max(worst, Math.min(d, 999));
    dist += Math.hypot(car.x - px, car.z - pz);
    px = car.x;
    pz = car.z;

    const st = streak.state;
    peak = Math.max(peak, st.distance);
    const kph = Math.abs(car.kph);
    if (wasOn && !st.onRoad && !st.grace) {
      offAt = { x: Math.round(car.x), z: Math.round(car.z), kph: Math.round(kph), slip: Math.round(car.slip * 57.3), roadDist: +d.toFixed(1) };
    }
    wasOn = st.onRoad;
    if (st.distance >= TARGET) {
      why = 'reached';
      break;
    }
    if (peak > 60 && st.distance < peak * 0.4) {
      if (offAt && Math.abs(offAt.slip) > 22) why = 'slid off';
      else if (offAt && offAt.kph > 90) why = 'too fast for the corner';
      else if (offAt && offAt.roadDist > 25) why = 'road ran out';
      else why = 'drifted off the edge';
      break;
    }
    if (kph < 5.4) slow += PHYSICS_DT;
    else slow = 0;
    if (slow > 6) {
      why = 'stopped moving';
      break;
    }
    if (VERBOSE && i % 1200 === 0) {
      trace.push(
        `  ${(i / 120).toFixed(0).padStart(3)}s ${car.kph.toFixed(0).padStart(3)}km/h  off ${d.toFixed(1).padStart(5)}m  steer ${cmd.steer.toFixed(2).padStart(5)}  streak ${st.distance.toFixed(0).padStart(4)}m`
      );
    }
  }

  const secs = steps * PHYSICS_DT;
  return {
    peak: Math.round(peak),
    why,
    offAt,
    secs: +secs.toFixed(0),
    onPct: steps ? (100 * onRoad) / steps : 0,
    worst,
    dist,
    saw: secs > 0 ? dSteer / secs : 0,
    trace,
  };
}

console.log(`\nTEN RUNS AT ${TARGET} m — headless, seed ${SEED}, real autopilot\n${'-'.repeat(86)}`);
const out = [];
const ONLY = opt('only', 0); // 1-based run number, for looking at one failure closely
for (let r = 0; r < RUNS; r++) {
  if (ONLY && r + 1 !== ONLY) continue;
  const res = run(r);
  out.push(res);
  console.log(
    `run ${String(r + 1).padStart(2)}  ${res.why === 'reached' ? 'REACHED' : 'ended  '}  ` +
      `${String(res.peak).padStart(5)} m  ${String(res.secs).padStart(3)}s  ${res.why.padEnd(22)}` +
      `on-road ${res.onPct.toFixed(1).padStart(5)}%  worst ${res.worst.toFixed(1).padStart(6)} m  d|steer|/s ${res.saw.toFixed(2)}` +
      (res.offAt ? `  @${res.offAt.x},${res.offAt.z} ${res.offAt.kph}km/h slip ${res.offAt.slip}deg` : '')
  );
  if (res.trace.length) console.log(res.trace.join('\n'));
}

const reached = out.filter((r) => r.why === 'reached').length;
const peaks = out.map((r) => r.peak).sort((a, b) => a - b);
const steps = out.reduce((a, r) => a + r.secs, 0);
const onPct = out.reduce((a, r) => a + r.onPct * r.secs, 0) / (steps || 1);
const causes = {};
for (const r of out) if (r.why !== 'reached') causes[r.why] = (causes[r.why] || 0) + 1;

console.log('-'.repeat(86));
console.log(
  `reached ${TARGET} m: ${reached}/${RUNS}   median peak ${peaks[Math.floor(peaks.length / 2)] || 0} m   ` +
    `best ${peaks[peaks.length - 1] || 0} m`
);
console.log(
  `on-road ${onPct.toFixed(1)}%   worst offset ${Math.max(...out.map((r) => r.worst)).toFixed(1)} m   ` +
    `travelled ${(out.reduce((a, r) => a + r.dist, 0) / 1000).toFixed(2)} km   ` +
    `mean d|steer|/s ${(out.reduce((a, r) => a + r.saw * r.secs, 0) / (steps || 1)).toFixed(2)}`
);
if (Object.keys(causes).length) {
  console.log('what ended the others:');
  for (const [k, v] of Object.entries(causes).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(2)} x ${k}`);
}
process.exitCode = reached >= Math.ceil(RUNS / 2) ? 0 : 1;
