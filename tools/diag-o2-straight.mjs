/* THROWAWAY investigation script — not part of the suite, not committed by policy.
 *
 * Question: does O2's fixed browser-suite test spot get there via C5's "find a long clear
 * straight nearby" placement, and if so, does TODAY's roads.js junction-squaring change the
 * speed achievable right after that straight ends, compared with the roads.js at HEAD (the
 * commit that claimed 40/40 on the browser suite, unchanged since)?
 *
 * Method: for N autopilot-reached sites (identical selection to diag-o2.mjs), run C5's own
 * straight-finder verbatim (copied from tools/browser-test.mjs), place the car at the START of
 * whatever straight it finds, drive it UNSTEERED for 9s exactly as C5 does (this is what would
 * leave the car near the END of that straight, which is where O2's reset() would then snap
 * to), then run the SHIPPED roadRunUp (pulled from tools/browser-test.mjs, same technique
 * diag-o2.mjs already uses) for 8s and read the on-road top. Repeat against two copies of
 * src/: one importing the real (NEW) src/world/roads.js, one importing a scratch copy with
 * roads.js swapped back to HEAD (OLD).
 *
 *   node tools/diag-o2-straight.mjs --sites 20 --old <scratch-src-dir>
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = 20260726;
const SITES = +arg('sites', 20);
const LAND = arg('terrain', 'meadow');
const DT = 1 / 60;
const OLD_SRC = arg('old', null); // path to a scratch src/ dir with old roads.js, or null = skip

async function loadModules(srcDir) {
  const u = (p) => pathToFileURL(resolve(srcDir, p)).href;
  const { Terrain, findSpawn } = await import(u('world/terrain.js'));
  const { Vehicle } = await import(u('car/vehicle.js'));
  const { Autopilot } = await import(u('car/autopilot.js'));
  const { Rescue } = await import(u('game/rescue.js'));
  const { applyTerrain, terrainBias } = await import(u('game/presets.js'));
  const { setBiomeBias } = await import(u('world/biomes.js'));
  const { applyCarFeel, FLEET_BY_ID, FIRST_CAR } = await import(u('game/garage.js'));
  return { Terrain, findSpawn, Vehicle, Autopilot, Rescue, applyTerrain, terrainBias, setBiomeBias, applyCarFeel, FLEET_BY_ID, FIRST_CAR };
}

const BT = new URL('./browser-test.mjs', import.meta.url);
const btSrc = readFileSync(BT, 'utf8');
const mRunUp = btSrc.match(/const roadRunUp = async \(ms\) => await evalJs\(`([\s\S]*?)`\);/);
if (!mRunUp) throw new Error('could not find roadRunUp in browser-test.mjs');
const PAGE_SRC = mRunUp[1];

async function runSweep(label, srcDir) {
  const M = await loadModules(srcDir);
  M.applyTerrain(LAND);
  M.setBiomeBias(M.terrainBias(LAND));
  const CAR = M.FLEET_BY_ID[M.FIRST_CAR];
  M.applyCarFeel(CAR);

  let cx = 0, cz = 0, terr = null;
  const localFor = (x, z) => {
    if (!terr || Math.abs(x - cx) > 240 || Math.abs(z - cz) > 240) {
      terr = new M.Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
      cx = x; cz = z;
    }
    return terr;
  };

  const spawn = M.findSpawn(SEED);
  const car = new M.Vehicle({ tier: CAR.tier, terrain: localFor(spawn.x, spawn.z), preset: CAR.feel.assist });
  car.placeAt(spawn.x, spawn.z, spawn.heading);

  function backToRoad() {
    const t = car.terrain;
    const q = t.roads.query(car.x, car.z);
    if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    else { const s = M.findSpawn(SEED, car.x, car.z); car.placeAt(s.x, s.z, s.heading); }
  }
  const rescue = new M.Rescue({ recover: () => backToRoad() });
  const COAST = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
  const FLAT = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
  function step(input) { car.terrain = localFor(car.x, car.z); car.update(DT, input); rescue.update(DT, car, car.terrain.surface(car.x, car.z)); }
  function suiteReset() { backToRoad(); car.vx = car.vy = car.vz = 0; car.yawRate = 0; car.gear = 1; }

  // ── C5's own straight-finder, copied verbatim (browser-test.mjs lines ~956-987) ──
  function findStraight() {
    const T = car.terrain.constructor;
    const big = new T(SEED, car.x - 1600, car.z - 1600, car.x + 1600, car.z + 1600);
    const tmp = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0, land: NaN };
    let best = null;
    for (const e of big.roads.edges) {
      const n = e.pts.length / 2;
      for (let k0 = 0; k0 < n - 1; k0++) {
        const dx0 = e.pts[k0 * 2 + 2] - e.pts[k0 * 2], dz0 = e.pts[k0 * 2 + 3] - e.pts[k0 * 2 + 1];
        const l0 = Math.hypot(dx0, dz0) || 1;
        const ux = dx0 / l0, uz = dz0 / l0;
        const sx0 = e.pts[k0 * 2], sz0 = e.pts[k0 * 2 + 1];
        let clear = 0;
        for (let run = 0; run <= 500; run += 8) {
          const cv = big.roads.carve(sx0 + ux * run, sz0 + uz * run, tmp);
          if (cv.edge < 0.9) break;
          clear = run;
        }
        if (clear >= 200 && (!best || clear > best.run)) {
          best = { x: sx0, z: sz0, heading: Math.atan2(ux, uz), run: clear };
          if (clear >= 300) return { best, big };
        }
      }
    }
    return { best, big };
  }

  function straightLeg(seconds) { for (let i = 0; i < Math.round(seconds / DT); i++) step(FLAT); }

  // ── shipped roadRunUp, run against THIS module set's real car/terrain ──
  function makeShippedLeg() {
    const held = new Set();
    const KeyboardEvent = class { constructor(type, o) { this.type = type; this.code = o.code; } };
    const win = { WANDEROAD: { get car() { return car; } }, dispatchEvent(e) {
      if (e.type === 'keydown') held.add(e.code); else if (e.type === 'keyup') held.delete(e.code); return true; } };
    let simMs = 0;
    const perf = { now: () => simMs };
    const rafQ = [];
    const raf = (f) => rafQ.push(f);
    const fakeSetTimeout = () => 0;
    const input = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: false };
    const pump = () => {
      input.steer = (held.has('KeyA') ? 1 : 0) - (held.has('KeyD') ? 1 : 0);
      input.throttle = held.has('KeyW') ? 1 : 0;
      input.brake = held.has('KeyS') ? 1 : 0;
      step(input); simMs += DT * 1000;
    };
    const fn = new Function('window', 'performance', 'requestAnimationFrame', 'setTimeout', 'KeyboardEvent',
      `return ${PAGE_SRC.replace(/\$\{ms\}/g, 'window.__ms')};`);
    return async (ms) => {
      simMs = 0; rafQ.length = 0; held.clear(); win.__ms = ms;
      let done = false, out = null, err = null;
      fn(win, perf, raf, fakeSetTimeout, KeyboardEvent).then((r) => { out = r; done = true; }, (e) => { err = e; done = true; });
      let guard = 0;
      while (!done && guard++ < 200000) {
        await new Promise((r) => setImmediate(r));
        if (done) break;
        const f = rafQ.shift();
        if (!f) continue;
        pump(); f();
      }
      if (err) throw err;
      return out;
    };
  }
  const shippedLeg = makeShippedLeg();

  const auto = new M.Autopilot();
  function autoDrive(seconds) {
    if (!auto.on) auto.toggle(car);
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      car.terrain = localFor(car.x, car.z);
      car.update(DT, auto.update(car, COAST, DT) || COAST);
      rescue.update(DT, car, car.terrain.surface(car.x, car.z));
    }
  }

  console.log(`\n── ${label} (${srcDir}) ──`);
  const rows = [];
  for (let siteN = 0; siteN < SITES; siteN++) {
    autoDrive(siteN === 0 ? 20 : 45);
    auto.toggle(car);
    // `home` isolates each site: the C5+O2 measurement below teleports the car far away
    // (findStraight searches up to 1600 m) and can leave it parked in a spot autoDrive then
    // never escapes (observed: every site from #2 on converging on one identical coordinate,
    // bit for bit — an attractor, not real site diversity). Snapping back to `home` before the
    // NEXT autoDrive call — exactly the discipline diag-o2.mjs's own home2() uses — keeps sites
    // independent, the way "20 independent points" is supposed to mean.
    const home = { x: car.x, z: car.z, yaw: car.yaw };

    const { best } = findStraight();
    if (!best) { console.log(`site ${siteN + 1}: no straight found nearby`); car.terrain = localFor(home.x, home.z); car.placeAt(home.x, home.z, home.yaw); continue; }
    car.placeAt(best.x, best.z, best.heading);
    car.vx = car.vy = car.vz = 0; car.yawRate = 0; car.gear = 1;
    rescue.reset();
    straightLeg(9); // C5's own 9s unsteered hold (3s warmup + 6s sampled, same total)
    const afterC5 = { x: car.x, z: car.z, kph: +car.kph.toFixed(1) };

    // O2's reset(): KeyR (backToRoad) + zero velocity, THEN steered roadRunUp.
    suiteReset();
    rescue.reset();
    const steered = await shippedLeg(8000);
    const onRoad = +car.terrain.surface(car.x, car.z).onRoad.toFixed(2);
    rows.push({ site: siteN + 1, straightRun: best.run, afterC5, steeredKph: steered.kph, onRoad });
    console.log(
      `site ${String(siteN + 1).padStart(2)}  straight found ${String(best.run).padStart(3)}m ` +
        `(${best.x.toFixed(0)},${best.z.toFixed(0)})  after-C5 ${String(afterC5.kph).padStart(6)} km/h  ->  ` +
        `O2 steered top ${String(steered.kph).padStart(6)} km/h  onRoad ${onRoad}  ` +
        `${steered.kph < 79 ? '<<< SLOW (would likely fail O2 at the current ~80 km/h bar)' : ''}`
    );
    // Restore to `home` so the NEXT site's autoDrive starts fresh (see the comment above).
    car.terrain = localFor(home.x, home.z);
    car.placeAt(home.x, home.z, home.yaw);
    car.vx = car.vy = car.vz = 0; car.yawRate = 0; car.gear = 1;
    rescue.reset();
  }
  const mean = rows.length ? (rows.reduce((a, r) => a + r.steeredKph, 0) / rows.length).toFixed(1) : 'n/a';
  const slow = rows.filter((r) => r.steeredKph < 79).length;
  console.log(`${label}: mean steered-after-straight top ${mean} km/h; ${slow}/${rows.length} sites under ~79 km/h (would fail O2's ratio)`);
  return rows;
}

const newRows = await runSweep('NEW (working tree, today\'s roads.js)', resolve('src'));
let oldRows = null;
if (OLD_SRC) oldRows = await runSweep('OLD (HEAD roads.js, pre-round)', OLD_SRC);
console.log('\ndone');
