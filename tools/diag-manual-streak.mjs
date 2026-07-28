/* Wanderoad — can a HAND on the keyboard bank a streak?
 *
 * WHY THIS EXISTS. `src/game/streak.js` now freezes the streak whenever auto-drive has the
 * wheel (`update()`'s `opts.paused`) — the operator's rule, verbatim: auto-drive should accrue
 * "no streak". tools/browser-test.mjs's "the road streak accumulates" check used to switch
 * auto-drive ON in order to stay on the road while it measured, so the moment that rule landed
 * the check was measuring a counter the game is now deliberately holding at zero. The feature
 * is right and the check's METHOD was wrong: it has to drive by hand.
 *
 * Driving by hand means a bang-bang keyboard — A, D, W, S, on or off, decided ~25 times a
 * second, not a smooth analogue steering angle solved at 120 Hz. That is a genuinely different
 * control problem from the autopilot's, and "a human could do it" is not evidence. So this
 * runs the SAME control law the browser check injects into the page, against the SAME
 * src/car/vehicle.js, src/world/terrain.js and src/game/streak.js, at the same 25 Hz key
 * cadence over a 120 Hz solver, and asserts that it banks more than the 50 m the browser check
 * asks for — on several different roads, so one lucky straight cannot carry it.
 *
 * THE LAW IS DUPLICATED, DELIBERATELY, AND HERE IS THE RULE FOR KEEPING IT HONEST: the browser
 * harness is a standalone CDP script that injects a string into a page and cannot import from
 * src/, so the same decision function exists there too, as `DRIVE_BY_HAND`. Both copies carry
 * this note. Change one, change the other, and re-run this.
 *
 * IT IS CAR-AGNOSTIC, WHICH MATTERS: the browser check has already pressed V by the time it
 * measures, so the car under it is not the one it started with. The speed cap is what makes
 * that irrelevant — every car in the fleet can hold 45 km/h. Proved rather than assumed:
 * `--tier gt|sports|hyper` banks 138 / 137 / 135 m on the worst of five roads.
 *
 * What this CANNOT see (same limits as tools/streak-auto.mjs): trees, props and other solids,
 * which src/game/collide.js resolves in main.js. A run here proves the keyboard law holds the
 * road, not that the road was clear.
 *
 *   node tools/diag-manual-streak.mjs [--runs 5] [--secs 18] [--seed 20260726] [--verbose]
 */

// The streak persists to localStorage, which does not exist in node. Same stub bench-streak
// and streak-auto use.
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
const { Streak } = await import('../src/game/streak.js');
const { PHYSICS_DT } = await import('../src/car/tuning.js');

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? +argv[i + 1] : d;
};
const RUNS = opt('runs', 5);
/** The browser check drives for 18 s. Match it — a law that only works given 40 s is no use. */
const SECS = opt('secs', 18);
const SEED = opt('seed', 20260726);
/** How often the keys are re-decided, Hz. The browser loop runs on a 40 ms setInterval. */
const KEY_HZ = opt('keyhz', 25);
/** What the browser check asserts, in metres. Not a threshold this file gets to choose. */
const WANT_M = opt('want', 50);
const VERBOSE = argv.includes('--verbose');
/** Which car. The browser check has pressed V by the time it measures, so the hand must not
 *  depend on one tier — the speed cap is what makes it car-agnostic, and this proves it. */
const TIER = (argv.indexOf('--tier') >= 0 ? argv[argv.indexOf('--tier') + 1] : 'sports');

const spawn = findSpawn(SEED);

/** main.js's localFor(): one 840 m field, rebuilt when the car nears its edge. */
const fieldFor = (x, z) => new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);

/* main.js's backToRoad(), which is what R does — and the browser check presses R immediately
 * before it measures, so EVERY run here must begin the way the browser's does: on a real
 * carriageway, pointing along it, somewhere a car could plausibly have driven to.
 *
 * THE FIRST VERSION OF THIS MEASURED THE FIXTURE, NOT THE DRIVER, and it is worth writing down
 * because it is exactly the trap this project keeps falling into. It took the spiral point as
 * given and, when there was no road anywhere near it, fell back to findSpawn(). On run 0 the
 * spiral point (900 m due east of spawn on seed 20260726) is in genuinely road-free desert —
 * `roads.query` there is Infinity even out to a 6.4 km box — and the fallback dropped the car
 * onto a sand-bedded lane where it laboured at 18 km/h and banked nothing. Nothing about that
 * is the keyboard's fault, and a red line saying so would have sent the next reader to tune
 * gains that were already fine.
 *
 * So the spiral now WALKS until it finds tarmac instead of pretending the first point had
 * some. Same five distinct roads, none of them invented. */
function putOnRoad(car, r) {
  for (let i = 0; i < 48; i++) {
    const ang = r * 2.4 + i * 0.37;
    const rad = 900 + r * 700 + i * 90;
    const x = spawn.x + Math.cos(ang) * rad;
    const z = spawn.z + Math.sin(ang) * rad;
    const terr = fieldFor(x, z);
    const q = terr.roads.query(x, z);
    if (!isFinite(q.d)) continue;
    const field = fieldFor(q.qx, q.qz); // the 840 m field main.js actually drives in
    car.terrain = field;
    car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    return field;
  }
  // Should not happen on any seed with roads; if it does, the run reports startedOnRoad false.
  const s = findSpawn(SEED, spawn.x, spawn.z);
  const terr = fieldFor(s.x, s.z);
  car.terrain = terr;
  car.placeAt(s.x, s.z, s.heading);
  return terr;
}

/* ── THE DRIVER ────────────────────────────────────────────────────────────────────────────
 * Keep this in step with DRIVE_BY_HAND in tools/browser-test.mjs. It decides four booleans —
 * A, D, W, S — from the road under the car, exactly the way a player reads the windscreen.
 *
 * THE SIGN, because this project has paid for it three times: three.js puts +X on your LEFT
 * looking down +Z, so `lateral` is positive when the car is LEFT of the centreline, and A
 * (positive steer, see the note in src/car/input.js poll()) also turns LEFT. So being left of
 * the line has to ask for RIGHT — the cross-track term is NEGATED. Same subtraction, and the
 * same reason, as autopilot.js's `-OMEGA*OMEGA*lateral`.
 *
 * Cozy speed window on purpose, and MEASURED rather than picked: hold W under 45 km/h, ease to
 * 36 whenever the line is more than 1.6 m wide of the middle, dab the brake past cap + 15. The
 * streak needs 8 m/s (29 km/h) to accrue at all, and a bang-bang keyboard cannot hold a 6 m
 * lane at 80. Swept over 20 roads on the default seed: 55 km/h banks 82 m on the worst of them
 * and 45 banks 124 m, and 45 also lifts the median from 158 to 207. Slower is stronger here.
 *
 * ONE R, AND NOT NEAR THE END. Genuinely off the carriageway for 0.6 s and it presses R, the
 * same reset the key does, once, and never in the last ten seconds — R sets you down stopped,
 * so a rescue with four seconds left cannot rebuild anything and a thrashing one is worse than
 * none (measured: nine resets, 0 m banked). It does not fire at all on the default seed. */
const KEYS = { A: false, D: false, W: false, S: false };
/** How long the car has been off the carriageway, seconds, and how many R's it has spent. */
function decide(car, keys, st) {
  const q = car.terrain.roads.query(car.x, car.z);
  const kph = Math.abs(car.kph);
  const off = !isFinite(q.d) || q.d > q.width * 0.5 + 1.5;
  st.lost = off ? st.lost + st.step : 0;
  if (st.lost >= 0.6 && st.rescues < 1 && st.t < st.secs - 10) {
    // main.js's backToRoad(), which is what R does: nearest centreline, pointing along it.
    const r = car.terrain.roads.query(car.x, car.z);
    if (isFinite(r.d)) car.placeAt(r.qx, r.qz, Math.atan2(r.tx, r.tz));
    st.rescues++;
    st.lost = 0;
    keys.A = keys.D = keys.S = false;
    keys.W = true;
    return { d: isFinite(q.d) ? q.d : 999, want: 0 };
  }
  if (!isFinite(q.d)) {
    // No road within reach — do not thrash the wheel at a road that is not there.
    keys.A = keys.D = false;
    keys.W = kph < 40;
    keys.S = false;
    return { d: 999, want: 0 };
  }
  let tx = q.tx,
    tz = q.tz;
  const fx = Math.sin(car.yaw),
    fz = Math.cos(car.yaw);
  if (fx * tx + fz * tz < 0) {
    tx = -tx;
    tz = -tz;
  }
  const lateral = (car.x - q.qx) * tz - (car.z - q.qz) * tx;
  let head = Math.atan2(tx, tz) - car.yaw;
  while (head > Math.PI) head -= Math.PI * 2;
  while (head < -Math.PI) head += Math.PI * 2;
  const want = -lateral * 0.3 + head * 2.4;
  keys.A = want > 0.16;
  keys.D = want < -0.16;
  const cap = Math.abs(lateral) > 1.6 ? 36 : 45;
  keys.W = kph < cap;
  keys.S = kph > cap + 15;
  return { d: q.d, want };
}
/** src/car/input.js's poll(), for the keyboard half: A is +1 (left), D is -1. */
const asInput = (keys) => ({
  steer: (keys.A ? 1 : 0) - (keys.D ? 1 : 0),
  throttle: keys.W ? 1 : 0,
  brake: keys.S ? 1 : 0,
  handbrake: 0,
  analogue: false,
});

function run(r) {
  /* Somewhere new each run — the same spiral streak-auto.mjs walks, so five runs are five
   * different roads rather than one road five times. */
  const car = new Vehicle({ tier: TIER, terrain: null, preset: 'cruise' });
  let terr = putOnRoad(car, r);
  let cx = car.x,
    cz = car.z;
  const streak = new Streak({ storageKey: `manual${r}` });
  const keys = { ...KEYS };
  // Where R leaves you. Reported so a bad run can never be blamed on the driver by mistake.
  const start = terr.roads.query(car.x, car.z);
  const startedOnRoad = isFinite(start.d) && start.d <= start.width * 0.5;

  const every = Math.max(1, Math.round(120 / KEY_HZ));
  const n = Math.round(SECS / PHYSICS_DT);
  const drv = { lost: 0, rescues: 0, t: 0, secs: SECS, step: every * PHYSICS_DT };
  let cmd = asInput(keys);
  let onRoad = 0,
    steps = 0,
    worst = 0,
    breaks = 0,
    peak = 0,
    kphSum = 0;
  let wasOn = true;
  for (let i = 0; i < n; i++) {
    if (Math.abs(car.x - cx) > 240 || Math.abs(car.z - cz) > 240) {
      terr = fieldFor(car.x, car.z);
      car.terrain = terr;
      cx = car.x;
      cz = car.z;
    }
    if (i % every === 0) {
      drv.t = i * PHYSICS_DT;
      decide(car, keys, drv);
      cmd = asInput(keys);
    }
    car._step(PHYSICS_DT, cmd);
    const surf = car.terrain.surface(car.x, car.z);
    // paused is FALSE — this is the whole point. A hand on the keyboard banks distance.
    streak.update(PHYSICS_DT, car, surf, { paused: false });

    const q = car.terrain.roads.query(car.x, car.z);
    const d = isFinite(q.d) ? q.d : 999;
    steps++;
    if (d <= q.width * 0.5) onRoad++;
    worst = Math.max(worst, Math.min(d, 999));
    kphSum += Math.abs(car.kph);
    const st = streak.state;
    peak = Math.max(peak, st.distance);
    if (wasOn && !st.onRoad && !st.grace) breaks++;
    wasOn = st.onRoad;
  }
  const st = streak.state;
  return {
    r,
    km: +st.km.toFixed(3),
    banked: Math.round(st.distance),
    peak: Math.round(peak),
    onRoadPct: +((onRoad / Math.max(steps, 1)) * 100).toFixed(1),
    worst: +worst.toFixed(1),
    breaks,
    kph: +(kphSum / Math.max(steps, 1)).toFixed(1),
    paused: st.paused,
    rescues: drv.rescues,
    startedOnRoad,
    at: `${Math.round(car.x)},${Math.round(car.z)}`,
  };
}

console.log(`\n── driving by hand, ${RUNS} runs of ${SECS} s, ${TIER}, seed ${SEED}, keys re-decided at ${KEY_HZ} Hz ──`);
const rows = [];
for (let r = 0; r < RUNS; r++) {
  const row = run(r);
  rows.push(row);
  console.log(
    `  run ${r}: ${String(row.banked).padStart(4)} m banked  (peak ${String(row.peak).padStart(4)} m)  ` +
      `on-road ${String(row.onRoadPct).padStart(5)}%  worst ${String(row.worst).padStart(6)} m  ` +
      `breaks ${row.breaks}  R ${row.rescues}  mean ${row.kph} km/h  paused ${row.paused}  ` +
      `started on road ${row.startedOnRoad}`
  );
  if (VERBOSE) console.log('   ', JSON.stringify(row));
}

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(46)} ${String(got).padStart(14)}   want ${want}`);
};

console.log('');
const worstRun = rows.reduce((a, b) => (a.banked < b.banked ? a : b));
check(
  rows.every((x) => x.startedOnRoad),
  'every run started where R leaves you — on tarmac',
  `${rows.filter((x) => x.startedOnRoad).length}/${rows.length} on the carriageway`,
  'all of them'
);
const median = [...rows].sort((a, b) => a.banked - b.banked)[rows.length >> 1];
check(
  worstRun.banked > WANT_M,
  'every run banks what the browser check asks',
  `${worstRun.banked} m worst (run ${worstRun.r})`,
  `> ${WANT_M} m`
);
check(median.banked > WANT_M * 3, 'and the typical run banks well clear of it', `${median.banked} m median`, `> ${WANT_M * 3} m`);
check(
  rows.every((x) => x.paused === false),
  'the streak was never frozen — no auto-drive here',
  rows.every((x) => x.paused === false) ? 'paused false throughout' : 'a run was paused',
  'false'
);
check(
  rows.every((x) => x.kph > 29),
  'and it was above the 8 m/s the streak needs',
  `${Math.min(...rows.map((x) => x.kph))} km/h slowest mean`,
  '> 29 km/h'
);

/* The counter-test, and the reason this file is evidence rather than a demonstration: the SAME
 * drive with paused:true must bank nothing at all. If this ever banks metres, the operator's
 * rule has quietly stopped holding and the browser check would go green for the wrong reason —
 * which is precisely how the old auto-drive method went red, only in the other direction. */
{
  const car = new Vehicle({ tier: TIER, terrain: null, preset: 'cruise' });
  putOnRoad(car, 0);
  const streak = new Streak({ storageKey: 'manualPaused' });
  const keys = { ...KEYS };
  let cmd = asInput(keys);
  const every = Math.max(1, Math.round(120 / KEY_HZ));
  const drv = { lost: 0, rescues: 0, t: 0, secs: SECS, step: every * PHYSICS_DT };
  for (let i = 0; i < Math.round(SECS / PHYSICS_DT); i++) {
    if (i % every === 0) {
      drv.t = i * PHYSICS_DT;
      decide(car, keys, drv);
      cmd = asInput(keys);
    }
    car._step(PHYSICS_DT, cmd);
    streak.update(PHYSICS_DT, car, car.terrain.surface(car.x, car.z), { paused: true });
  }
  check(streak.state.distance === 0, 'the same drive under auto-drive banks nothing', `${Math.round(streak.state.distance)} m`, '0 m');
}

console.log(failures ? `\n${failures} failed\n` : '\nall good\n');
process.exit(failures ? 1 : 0);
