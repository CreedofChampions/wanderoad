/* Wanderoad — does the WORKER'S MESH stand where the CAR'S SAMPLER says the ground is?
 *
 * This is gotcha 2 in its dangerous direction, measured offline. The worker meshes a chunk
 * out of `src/world/chunk.js buildChunk()` — vertices from a Terrain built on the NODE's box
 * with pad max(80, step*3) — while the car queries `Terrain.height()` on main.js's own
 * +/-420 m box, rebuilt every 240 m. If those two ever disagree, the car stands on a surface
 * that is not the one being drawn, which is a car falling through visible ground.
 *
 * tools/diag-seam.mjs already proves the FUNCTION agrees between boxes (S1), but it compares
 * `Terrain.height` with `Terrain.height`. It never touches a triangle. The mesh is not the
 * function: it is a piecewise-linear interpolation of it at `step` metres, so the surface the
 * player's car is drawn against can differ from the sampler even when every vertex agrees.
 * This harness closes that gap. Every frame it:
 *
 *   1. builds the level-0 node under the car with buildChunk() — the exact call
 *      src/world/chunkWorker.js makes, same module graph, same pad;
 *   2. reads the height of the TRIANGLE at the car's (x, z), reproducing chunk.js's own
 *      per-quad diagonal flip, i.e. the surface a downward raycast would hit;
 *   3. compares it with car.terrain.height(x, z) — the number the wheels stand on.
 *
 * The driver is the game's own Autopilot, the solver the real Vehicle at the real physics
 * rate, with real solids and the real rescue. No server, no browser, deterministic.
 *
 * It also reports the counterfactual: the same comparison against the level 1/2/3 meshes of
 * the same ground. Those are the surfaces the streamer WOULD be showing if a coarse node were
 * still standing in for a fine one, so the number says how bad this mechanism could be if it
 * ever fired — which is the only reason to care that it currently does not.
 *
 *   node tools/diag-meshgap.mjs                    # standard sweep
 *   node tools/diag-meshgap.mjs 20260726 rolling 120
 */

import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { Solids, solidsFromScatter } from '../src/game/collide.js';
import { Rescue } from '../src/game/rescue.js';
import { Autopilot } from '../src/car/autopilot.js';
import { scatterChunk } from '../src/world/scatter.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { buildChunk, nodeSize, LEAF } from '../src/world/chunk.js';

/** Levels compared. 0 is what the streamer serves under the car; 1..3 are the counterfactual. */
const LEVELS = [0, 1, 2, 3];
/** A centimetre and a half of interpolation error is nothing; 0.52 m is past suspension travel. */
const BUCKETS = [0.1, 0.3, 0.52];

/* ── the worker's mesh, sampled the way a downward ray samples it ─────────────
 * chunk.js lays out GRID x GRID vertices, x = i*step, z = j*step, local to (ox, oz), and
 * flips the quad diagonal on ((i ^ j) & 1). Both triangulations are reproduced here; getting
 * this wrong would show up as a sawtooth error of the quad's own curvature, so it is worth
 * being exact rather than averaging the four corners.
 */
function meshHeight(c, x, z) {
  const { ox, oz, step, grid, position } = c;
  const fx = (x - ox) / step;
  const fz = (z - oz) / step;
  let i = Math.floor(fx);
  let j = Math.floor(fz);
  if (i < 0) i = 0;
  if (j < 0) j = 0;
  if (i > grid - 2) i = grid - 2;
  if (j > grid - 2) j = grid - 2;
  const u = fx - i;
  const v = fz - j;
  const h = (ii, jj) => position[(jj * grid + ii) * 3 + 1];
  const a = h(i, j);
  const b = h(i + 1, j);
  const cc = h(i, j + 1);
  const d = h(i + 1, j + 1);
  if (((i ^ j) & 1) === 0) {
    // triangles (a, c, b) and (b, c, d): the shared edge is the anti-diagonal u + v = 1
    return u + v <= 1 ? a + u * (b - a) + v * (cc - a) : d + (1 - u) * (cc - d) + (1 - v) * (b - d);
  }
  // triangles (a, c, d) and (a, d, b): the shared edge is the main diagonal v = u
  return v >= u ? a + v * (cc - a) + u * (d - cc) : a + u * (b - a) + v * (d - b);
}

/** Lazily built, LRU-ish by distance. Keyed level:cx,cz. */
function meshCache(seed) {
  const map = new Map();
  return (level, x, z) => {
    const size = nodeSize(level);
    const cx = Math.floor(x / size);
    const cz = Math.floor(z / size);
    const key = `${level}:${cx},${cz}`;
    let c = map.get(key);
    if (!c) {
      c = buildChunk({ cx, cz, level, seed });
      map.set(key, c);
      if (map.size > 96) map.delete(map.keys().next().value);
    }
    return c;
  };
}

function run(seed, preset, seconds, tier = 'sports') {
  applyTerrain(preset);
  setBiomeBias(terrainBias(preset));

  const spawn = findSpawn(seed);
  let local = new Terrain(seed, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
  let lcx = spawn.x;
  let lcz = spawn.z;
  // main.js: the car's sampler box is rebuilt once it has drifted 240 m from its centre.
  const localFor = (x, z) => {
    if (Math.abs(x - lcx) > 240 || Math.abs(z - lcz) > 240) {
      local = new Terrain(seed, x - 420, z - 420, x + 420, z + 420);
      lcx = x;
      lcz = z;
    }
    return local;
  };

  const car = new Vehicle({ tier, terrain: local, preset: 'sport' });
  car.placeAt(spawn.x, spawn.z, spawn.heading);

  const solids = new Solids();
  const liveChunks = new Set();
  const streamSolids = (x, z) => {
    const want = new Set();
    const c0 = Math.floor(x / LEAF);
    const c1 = Math.floor(z / LEAF);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) want.add(`${c0 + i},${c1 + j}`);
    for (const k of want) {
      if (liveChunks.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      solids.addChunk(k, solidsFromScatter(scatterChunk({ cx, cz, level: 0, seed })));
      liveChunks.add(k);
    }
    for (const k of [...liveChunks]) if (!want.has(k)) { solids.removeChunk(k); liveChunks.delete(k); }
  };

  const backToRoad = () => {
    const t = car.terrain || local;
    const q = t.roads.query(car.x, car.z);
    if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    else {
      const s = findSpawn(seed, car.x, car.z);
      car.placeAt(s.x, s.z, s.heading);
    }
  };
  const rescue = new Rescue({ recover: backToRoad, say: () => {} });
  const auto = new Autopilot();
  auto.toggle(car);

  const mesh = meshCache(seed);
  const stat = {};
  for (const L of LEVELS) stat[L] = { worst: 0, at: null, sum: 0, n: 0, over: BUCKETS.map(() => 0) };

  const FRAME = 1 / 60;
  const frames = Math.round(seconds * 60);
  const SUB = Math.max(1, Math.round(FRAME / PHYSICS_DT));
  let dist = 0;
  let px = car.x;
  let pz = car.z;

  for (let f = 0; f < frames; f++) {
    car.terrain = localFor(car.x, car.z);
    streamSolids(car.x, car.z);

    const cmd =
      auto.update(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true }, FRAME) ||
      { steer: 0, throttle: 0.3, brake: 0, handbrake: 0, analogue: true };
    if (!auto.on) auto.toggle(car);
    for (let s = 0; s < SUB; s++) car._step(PHYSICS_DT, cmd);
    solids.resolve(car, 1.05, FRAME);
    const surf = car.terrain.surface(car.x, car.z);
    rescue.update(FRAME, car, surf);

    // The number the wheels stand on, from the car's own sampler on its own box.
    const sampY = car.terrain.height(car.x, car.z);
    for (const L of LEVELS) {
      const c = mesh(L, car.x, car.z);
      const drawn = meshHeight(c, car.x, car.z);
      const gap = Math.abs(drawn - sampY);
      const s = stat[L];
      s.n++;
      s.sum += gap;
      for (let b = 0; b < BUCKETS.length; b++) if (gap > BUCKETS[b]) s.over[b]++;
      if (gap > s.worst) {
        s.worst = gap;
        s.at = { x: +car.x.toFixed(1), z: +car.z.toFixed(1), mesh: +drawn.toFixed(3), sampler: +sampY.toFixed(3), onRoad: +surf.onRoad.toFixed(2) };
      }
    }

    dist += Math.hypot(car.x - px, car.z - pz);
    px = car.x;
    pz = car.z;
  }
  return { seed, preset, km: dist / 1000, frames, stat };
}

/* ── report ───────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const RUNS = args.length
  ? [[Number(args[0]), args[1] || 'rolling', Number(args[2] || 120)]]
  : [
      [20260726, 'rolling', 120],
      [20260726, 'alpine', 120],
      [7, 'rolling', 120],
      [7, 'alpine', 120],
      [424242, 'rolling', 120],
      [424242, 'meadow', 120],
    ];

console.log('\nWANDEROAD MESH GAP — worker-built triangles vs the car\'s own sampler');
console.log('-'.repeat(78));
console.log('seed      preset      km   frames   |mesh(L0) - sampler|  worst    mean');

const total = {};
for (const L of LEVELS) total[L] = { worst: 0, at: null, sum: 0, n: 0, over: BUCKETS.map(() => 0) };
let km = 0;
for (const [seed, preset, secs] of RUNS) {
  const r = run(seed, preset, secs);
  km += r.km;
  for (const L of LEVELS) {
    const s = r.stat[L];
    const t = total[L];
    t.n += s.n;
    t.sum += s.sum;
    for (let b = 0; b < BUCKETS.length; b++) t.over[b] += s.over[b];
    if (s.worst > t.worst) {
      t.worst = s.worst;
      t.at = { ...s.at, seed, preset };
    }
  }
  const s0 = r.stat[0];
  console.log(
    `${String(r.seed).padEnd(9)} ${r.preset.padEnd(8)} ${r.km.toFixed(2).padStart(5)}  ${String(r.frames).padStart(6)}` +
      `                     ${s0.worst.toFixed(3).padStart(6)} m  ${(s0.sum / Math.max(1, s0.n)).toFixed(4).padStart(7)} m`
  );
}

console.log(`\nTOTAL ${km.toFixed(2)} km auto-driven, ${total[0].n} sampled frames\n`);
console.log('level  node    step   worst gap   mean gap   >0.10 m   >0.30 m   >0.52 m');
for (const L of LEVELS) {
  const t = total[L];
  const step = nodeSize(L) / ((L <= 2 ? 65 : 33) - 1);
  const pc = (v) => `${((100 * v) / Math.max(1, t.n)).toFixed(2)}%`;
  console.log(
    `  ${L}   ${String(nodeSize(L)).padStart(5)} m ${step.toFixed(2).padStart(6)} m  ` +
      `${t.worst.toFixed(3).padStart(8)} m  ${(t.sum / Math.max(1, t.n)).toFixed(4).padStart(8)} m  ` +
      `${pc(t.over[0]).padStart(8)}  ${pc(t.over[1]).padStart(8)}  ${pc(t.over[2]).padStart(8)}` +
      (L === 0 ? '   <- what the streamer serves under the car' : '')
  );
}
console.log(`\nworst level-0 disagreement: ${JSON.stringify(total[0].at)}`);

/* The verdict this harness exists to give. Level 0 is the only level the streamer was ever
 * observed serving under the car; if its mesh and the car's sampler agree to well inside
 * suspension travel, gotcha 2 cannot be the fall-through. */
const ok = total[0].worst < 0.52 && total[0].over[2] === 0;
console.log(
  ok
    ? `\nPASS  the drawn level-0 surface and the car's sampler never differed by suspension travel (0.52 m).`
    : `\nFAIL  the drawn level-0 surface and the car's sampler disagree by ${total[0].worst.toFixed(2)} m.`
);
process.exit(ok ? 0 : 1);
