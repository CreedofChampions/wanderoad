/* Wanderoad — the C3 "stop and turn around" manoeuvre, and what the water rescue does to it.
 *
 * C3 in tools/browser-test.mjs is open-loop: W for 4 s, S for 4 s, then A+W for 7 s, and it
 * measures how far the heading moved. Nothing steers it back onto the road, so on a road that
 * curves the car ends up in whatever is beside the road — and beside a road in this world
 * there is sometimes a lake. That is how a rescue lands in the middle of a U-turn.
 *
 * This replays exactly that key sequence against the real Vehicle, the real Terrain and the
 * real Rescue, so the interaction can be measured without a browser. It exists because the
 * rescue's recover step is a judgement call — snap the car back along the centreline, or
 * leave the driver's heading alone — and a judgement call should be settled with numbers.
 *
 *   node tools/diag-c3.mjs              sweep road starts, both recover behaviours
 *   node tools/diag-c3.mjs 852 519      trace one start in detail
 *
 * The car is the Hatch on purpose: browser-test.mjs taps V once before it gets here, and with
 * ?cheat every car is unlocked, so FLEET[1] is what is under you by the time C3 runs. The
 * meadow preset is applied for the same reason — the suite runs with ?terrain=meadow, and the
 * preset mutates the biome tables, so without it this rig would measure a different world.
 */

import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Rescue, waterDepth } from '../src/game/rescue.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { applyCarFeel, FLEET } from '../src/game/garage.js';
import { setBiomeBias } from '../src/world/biomes.js';

const SEED = 20260726;
const DT = 1 / 60;

applyTerrain('meadow');
setBiomeBias(terrainBias('meadow'));
const CAR = FLEET[1];
applyCarFeel(CAR);

/* The three ways of running it:
 *   'off'   no rescue at all — what C3 measured before the rescue existed
 *   'snap'  rescue with keepHeading false — the first shipped version, faces you along the road
 *   'keep'  rescue as it ships now — the driver's heading survives the recovery
 */
const MODES = ['off', 'snap', 'keep'];

const KEYS = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: false };
const cmd = (steer, throttle, brake) => ({ ...KEYS, steer, throttle, brake });

/** A rolling exact-terrain window, the same one main.js keeps around the player. */
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

/** main.js's backToRoad(), minus the camera and the HUD. Unchanged by any of this. */
function backToRoad(car) {
  const q = car.terrain.roads.query(car.x, car.z);
  if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
}

function makeRescue(car, mode, onPlace) {
  return new Rescue({
    keepHeading: mode === 'keep',
    recover: () => { onPlace(); backToRoad(car); },
  });
}

/**
 * Run the C3 sequence from one point on a road.
 * @returns {{turned:number, rescues:number, worstDepth:number, endDepth:number, trace:string[]}}
 */
function runC3(x0, z0, { mode = 'keep', trace = false } = {}) {
  const localFor = makeWorld();
  const car = new Vehicle({ tier: CAR.tier, terrain: localFor(x0, z0), preset: CAR.feel.assist });
  const q = car.terrain.roads.query(x0, z0);
  if (!isFinite(q.d)) return null;
  car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));

  let rescues = 0;
  const rescue = makeRescue(car, mode, () => rescues++);

  const yaw0 = car.yaw;
  let worstDepth = 0;
  const log = [];
  let t = 0;

  // W 4 s, S 4 s, then A+W 7 s — the same three phases, in the same order, as C3.
  for (const [secs, input] of [[4, cmd(0, 1, 0)], [4, cmd(0, 0, 1)], [7, cmd(1, 1, 0)]]) {
    for (let i = 0; i < Math.round(secs / DT); i++) {
      car.terrain = localFor(car.x, car.z);
      car.update(DT, input);
      const surf = car.terrain.surface(car.x, car.z);
      if (mode !== 'off') rescue.update(DT, car, surf);
      worstDepth = Math.max(worstDepth, waterDepth(surf));
      t += DT;
      if (trace && i % 60 === 0) {
        let d = car.yaw - yaw0;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        // surf.roadDist comes from carve(), which gives up past the shoulder — the browser
        // trace read roads.query(), which never does. Use query here so the two line up.
        const rq = car.terrain.roads.query(car.x, car.z).d;
        log.push(
          `t=${t.toFixed(0).padStart(2)}s  kph ${car.kph.toFixed(1).padStart(5)}  y ${car.y.toFixed(2).padStart(6)}` +
          `  roadDist ${(isFinite(rq) ? rq : 999).toFixed(1).padStart(5)}` +
          `  onRoad ${surf.onRoad.toFixed(2)}  depth ${waterDepth(surf).toFixed(2)}` +
          `  turned ${(Math.abs(d) * 57.3).toFixed(0).padStart(3)}°  state ${rescue.state}`
        );
      }
    }
  }

  let turned = Math.abs(car.yaw - yaw0);
  while (turned > Math.PI * 2) turned -= Math.PI * 2;
  if (turned > Math.PI) turned = Math.PI * 2 - turned;
  const endDepth = waterDepth(car.terrain.surface(car.x, car.z));
  return { turned: turned * 57.3, rescues, worstDepth, endDepth, trace: log };
}

/* ── one start, traced ───────────────────────────────────────────────────── */
const argv = process.argv.slice(2).map(Number).filter((n) => isFinite(n));
if (argv.length === 2) {
  const [x, z] = argv;
  for (const m of MODES) {
    const r = runC3(x, z, { mode: m, trace: true });
    console.log(`\n── start (${x}, ${z})  rescue '${m}' ────────────────────────────`);
    console.log(r.trace.join('\n'));
    console.log(`  turned ${r.turned.toFixed(0)}°   rescues ${r.rescues}   worst depth ${r.worstDepth.toFixed(2)} m`);
  }
  process.exit(0);
}

/* ── sweep: how often does the rescue eat the U-turn? ────────────────────── */
const spawn = findSpawn(SEED);
const starts = [];
{
  // Walk outward from spawn in a spiral and keep the points that are on a road, so the sample
  // is real road rather than a grid of arbitrary coordinates.
  const localFor = makeWorld();
  for (let r = 200; r <= 2000 && starts.length < 80; r += 60) {
    for (let a = 0; a < 12 && starts.length < 80; a++) {
      const x = spawn.x + Math.cos((a / 12) * Math.PI * 2) * r;
      const z = spawn.z + Math.sin((a / 12) * Math.PI * 2) * r;
      const q = localFor(x, z).roads.query(x, z);
      if (isFinite(q.d) && q.d < 40) starts.push([+q.qx.toFixed(1), +q.qz.toFixed(1)]);
    }
  }
}

const score = {}, nRescues = {}, endedWet = {};
for (const m of MODES) { score[m] = 0; nRescues[m] = 0; endedWet[m] = 0; }
let wet = 0;
const rows = [];
for (const [x, z] of starts) {
  const per = {};
  for (const m of MODES) {
    const r = runC3(x, z, { mode: m });
    if (!r) { per.bad = true; break; }
    per[m] = r;
    if (r.turned > 100) score[m]++;
    nRescues[m] += r.rescues;
    if (r.endDepth > 0.6) endedWet[m]++;
  }
  if (per.bad) continue;
  if (per.snap.worstDepth > 0.6) wet++;
  if (per.snap.rescues > 0) {
    rows.push(`(${x}, ${z})  ` + MODES.map((m) => `${m} ${per[m].turned.toFixed(0)}°`).join('  ') +
      `   ${per.snap.rescues}/${per.keep.rescues} rescues`);
  }
}
console.log(`\n${starts.length} road starts, C3 key sequence replayed at each (bar is > 100° of turn)`);
for (const m of MODES) {
  console.log(
    `  rescue '${m}'`.padEnd(20) +
    `${String(score[m]).padStart(2)}/${starts.length} pass   ` +
    `${String(nRescues[m]).padStart(2)} rescues fired   ${endedWet[m]} runs ended in the water`
  );
}
console.log(`  ${wet} of the ${starts.length} starts put the car in over 0.6 m of water at some point`);
if (rows.length) console.log(`\n  every start where the rescue fired:\n    ${rows.join('\n    ')}`);

/* ── the other half: drive STRAIGHT in, no steering, and hold the throttle ──
 * This is the case where keeping the driver's heading is suspicious — the way they were
 * pointing is the way that put them in the lake, so a rescue that leaves it alone can hand
 * them straight back to the water. If a recover behaviour loops here it is wrong, whatever it
 * does for C3. This is what the "second one re-aims you" rule in rescue.js is for. */
console.log('\n── drive straight in at a lake, hold W for 20 s, no steering ─────');
{
  const localFor = makeWorld();
  const sites = [];
  for (const [x, z] of starts) {
    const t = localFor(x, z);
    for (let a = 0; a < 16; a++) {
      const h = (a / 16) * Math.PI * 2;
      let hit = false;
      for (let s = 6; s <= 40; s += 2) {
        if (waterDepth(t.surface(x + Math.sin(h) * s, z + Math.cos(h) * s)) > 1.5) { hit = true; break; }
      }
      if (hit) { sites.push([x, z, h]); break; }
    }
    if (sites.length >= 12) break;
  }
  for (const m of MODES) {
    let rescues = 0, wetEnd = 0, roadEnd = 0;
    for (const [x, z, h] of sites) {
      const lf = makeWorld();
      const car = new Vehicle({ tier: CAR.tier, terrain: lf(x, z), preset: CAR.feel.assist });
      car.placeAt(x, z, h);
      const rescue = makeRescue(car, m, () => rescues++);
      for (let i = 0; i < 20 / DT; i++) {
        car.terrain = lf(car.x, car.z);
        car.update(DT, cmd(0, 1, 0));
        if (m !== 'off') rescue.update(DT, car, car.terrain.surface(car.x, car.z));
      }
      const surf = car.terrain.surface(car.x, car.z);
      if (waterDepth(surf) > 0.6) wetEnd++;
      if (surf.onRoad > 0.45) roadEnd++;
    }
    console.log(`  rescue '${m}'`.padEnd(20) + `${String(rescues).padStart(2)} rescues over ${sites.length} sites, ` +
      `${wetEnd} still in the water at 20 s, ${roadEnd} on the carriageway`);
  }
}
