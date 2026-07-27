// created by AI
/* Wanderoad — measuring tree pop-in distance, for real.
 *
 * Operator report: "Trees pop in just in front of you (too late)." This reproduces the real
 * pipeline that puts a tree on screen — the streamer's quadtree node selection, a simulated
 * worker pool driving REAL `buildChunk()` calls (so queueing latency is real, not assumed),
 * `scatterChunk()` exactly as `main.js`'s `onChunk` calls it, and the real `Flora` class's own
 * attach/cull bookkeeping — against a REAL car driven by the REAL `Autopilot` along the REAL
 * road network, with a REAL `ChaseCamera`. For every tree instance, it records the exact
 * world-space distance from the camera to that tree at the frame it is first attached (i.e.
 * the frame it starts being drawn) — that is the pop-in distance, measured, not estimated.
 *
 * `chunkWorker.js` (gotcha #2) is just a thin postMessage wrapper around `buildChunk()`, so
 * simulating the worker POOL (same size formula, same SPLIT_FACTOR, same viewDistance as
 * `src/world/streamer.js` and `src/main.js`) around real `buildChunk()` timings reproduces the
 * same queueing dynamics without needing a browser or a real `Worker` thread.
 *
 *   node tools/diag-treepop.mjs [--km 4] [--terrain meadow] [--seed 20260726]
 */

import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { PerspectiveCamera, Object3D } from 'three';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { ChaseCamera } from '../src/car/camera.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { applyCarFeel, FLEET_BY_ID, FIRST_CAR } from '../src/game/garage.js';
import { LEAF, LEVELS, nodeSize, buildChunk } from '../src/world/chunk.js';
import { scatterChunk, SCATTER_MAX_LEVEL } from '../src/world/scatter.js';
import { Flora } from '../src/render/trees.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = (+arg('seed', 20260726)) >>> 0;
const LAND = arg('terrain', 'meadow');
const KM = +arg('km', 4);
// Lets this tool reproduce the PRE-widening behaviour (`--cap 2`) against the real, current
// Flora/scatterChunk, so a before/after cost comparison never needs to touch any file that
// other sessions in this workflow may also be editing right now — it is purely a limit on
// which levels THIS harness's onChunk offers to scatterChunk/Flora, same as main.js's own
// `rec.level <= SCATTER_MAX_LEVEL` gate used to read before this pass widened it.
const SCATTER_CAP = Math.min(SCATTER_MAX_LEVEL, +arg('cap', SCATTER_MAX_LEVEL));
const DT = 1 / 60;

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));
const CAR = FLEET_BY_ID[FIRST_CAR];
applyCarFeel(CAR);

/* ── the real quadtree selection, copied from src/world/streamer.js's `_select()` ──
 * SPLIT_FACTOR and viewDistance are not exported from streamer.js (they are local consts),
 * so they are reproduced here numerically — same pattern world/scatter.js already uses for
 * this exact constant ("the streamer splits a level-1 node once its nearest edge is within
 * nodeSize(1) * SPLIT_FACTOR = 217 m"). If streamer.js's own values ever move, this tool goes
 * stale; it is a diagnostic, not a second source of truth. */
const SPLIT_FACTOR = 1.7;
const VIEW_DISTANCE = 6800; // matches `new Streamer({ viewDistance: 6800, ... })` in main.js
const TOP_LEVEL = Math.min(LEVELS - 1, Math.max(0, Math.ceil(Math.log2(VIEW_DISTANCE / LEAF))));
const WORKERS = Math.max(2, Math.min(6, (os.cpus().length || 4) - 2)); // same formula as streamer.js

function selectWanted(camX, camZ) {
  const want = new Map();
  const topSize = nodeSize(TOP_LEVEL);
  const r = Math.ceil(VIEW_DISTANCE / topSize) + 1;
  const ci = Math.floor(camX / topSize);
  const cj = Math.floor(camZ / topSize);
  const stack = [];
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) stack.push([i, j, TOP_LEVEL]);
  while (stack.length) {
    const [cx, cz, level] = stack.pop();
    const size = nodeSize(level);
    const midX = (cx + 0.5) * size;
    const midZ = (cz + 0.5) * size;
    const dx = Math.max(Math.abs(camX - midX) - size * 0.5, 0);
    const dz = Math.max(Math.abs(camZ - midZ) - size * 0.5, 0);
    const d = Math.hypot(dx, dz);
    if (d > VIEW_DISTANCE) continue;
    if (level > 0 && d < size * SPLIT_FACTOR) {
      const nl = level - 1;
      stack.push([cx * 2, cz * 2, nl], [cx * 2 + 1, cz * 2, nl], [cx * 2, cz * 2 + 1, nl], [cx * 2 + 1, cz * 2 + 1, nl]);
    } else {
      want.set(`${level}:${cx},${cz}`, { cx, cz, level, d });
    }
  }
  return want;
}

/* ── a worker pool that runs the REAL buildChunk(), timed, against a simulated clock ──
 * Concurrency is modelled (WORKERS jobs may be "in flight" at once); the wall-clock cost of
 * each job is not assumed, it is the real measured time of the real function. */
class MiniStreamer {
  constructor({ seed, onChunk, onRelease }) {
    this.seed = seed;
    this.onChunk = onChunk;
    this.onRelease = onRelease;
    this.live = new Map();
    this.pending = new Set();
    this.queue = [];
    this.busy = new Array(WORKERS).fill(null);
    this.clock = 0;
    this.buildMsTotal = 0;
    this.buildCount = 0;
    this.maxQueue = 0;
    this.byLevel = new Map(); // level -> { n, ms }
  }

  tick(camX, camZ, clock) {
    this.clock = clock;
    this._drainCompleted();

    const want = selectWanted(camX, camZ);
    this.queue.length = 0;
    for (const [key, n] of want) {
      if (this.live.has(key) || this.pending.has(key)) continue;
      this.queue.push({ key, ...n });
    }
    this.queue.sort((a, b) => a.d - b.d);
    this.maxQueue = Math.max(this.maxQueue, this.queue.length);

    for (const [key, rec] of this.live) {
      if (want.has(key)) continue;
      if (this.onRelease) this.onRelease(rec);
      this.live.delete(key);
    }
    this._pump();
  }

  _pump() {
    for (let i = 0; i < this.busy.length && this.queue.length; i++) {
      if (this.busy[i]) continue;
      const job = this.queue.shift();
      if (this.live.has(job.key) || this.pending.has(job.key)) {
        i--;
        continue;
      }
      this.pending.add(job.key);
      const t0 = performance.now();
      const c = buildChunk({ cx: job.cx, cz: job.cz, level: job.level, seed: this.seed });
      const buildMs = performance.now() - t0;
      this.buildMsTotal += buildMs;
      this.buildCount++;
      let lv = this.byLevel.get(job.level);
      if (!lv) {
        lv = { n: 0, ms: 0 };
        this.byLevel.set(job.level, lv);
      }
      lv.n++;
      lv.ms += buildMs;
      this.busy[i] = { key: job.key, c, doneAt: this.clock + buildMs };
    }
  }

  _drainCompleted() {
    for (let i = 0; i < this.busy.length; i++) {
      const b = this.busy[i];
      if (b && b.doneAt <= this.clock) {
        this.busy[i] = null;
        this.pending.delete(b.key);
        if (!this.live.has(b.key)) {
          const rec = { level: b.c.level, cx: b.c.cx, cz: b.c.cz, size: b.c.size, ox: b.c.ox, oz: b.c.oz };
          this.live.set(b.key, rec);
          if (this.onChunk) this.onChunk(rec, b.c);
        }
        this._pump();
      }
    }
  }
}

/* ── the car, the autopilot, the real chase camera ── */
let cx = 0,
  cz = 0,
  terr = null;
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

const auto = new Autopilot();
auto.toggle(car);
auto.cruise = 26.4; // the project's own "cruise" convention (95 km/h) — see bench-fuel.mjs / bench-props.mjs

const camera = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);
const chase = new ChaseCamera(camera, { mode: 'sport' });

/* ── the real Flora, fed by the real scatterChunk(), through the simulated streamer ── */
const scene = new Object3D();
const flora = new Flora({ seed: SEED, scene });
const treesByChunkKey = new Map(); // mirrors flora's own key, holds the raw scatterChunk() trees

const streamer = new MiniStreamer({
  seed: SEED,
  onChunk: (rec, c) => {
    if (rec.level <= SCATTER_CAP) {
      const s = scatterChunk({ cx: rec.cx, cz: rec.cz, level: rec.level, seed: SEED });
      treesByChunkKey.set(`${rec.level}:${rec.cx},${rec.cz}`, s.trees);
      flora.add(rec, s);
    }
  },
  onRelease: (rec) => {
    flora.remove(rec);
    treesByChunkKey.delete(`${rec.level}:${rec.cx},${rec.cz}`);
  },
});

/* ── attach-event tracking ── */
const wasAttached = new Set();
const events = []; // { dist, ahead, simT, kind }
let simClock = 0;

function sampleAttachEvents(camPos, carX, carZ, carYaw) {
  const fwdX = Math.sin(carYaw);
  const fwdZ = Math.cos(carYaw);
  for (const [key, entry] of flora.chunks) {
    const attached = !!entry.blocks;
    if (attached && !wasAttached.has(key)) {
      wasAttached.add(key);
      const trees = treesByChunkKey.get(key);
      if (trees && trees.length) {
        for (const t of trees) {
          const dx = t.x - camPos.x;
          const dz = t.z - camPos.z;
          const dist = Math.hypot(dx, dz);
          // bearing of the tree from the CAR, relative to the car's own heading — "ahead"
          // means inside a windshield-width cone, which is what "just in front of you" means.
          const rx = t.x - carX,
            rz = t.z - carZ;
          const rl = Math.hypot(rx, rz) || 1;
          const cosAhead = (rx * fwdX + rz * fwdZ) / rl;
          events.push({ dist, ahead: cosAhead > Math.cos((50 * Math.PI) / 180), simT: simClock / 1000, kind: t.kind });
        }
      }
    } else if (!attached) {
      wasAttached.delete(key);
    }
  }
}

/* ── drive ──
 * main.js's boot only force-builds the ONE spawn chunk synchronously (`streamer.forceChunk`)
 * and drops the player in while the rest of the ~6800 m view-distance disk streams in around
 * them — there is no "wait for the world to finish loading" gate. So the cold-start queue
 * burst below is not a harness artefact, it is what a fresh session actually does. This tool
 * reports BOTH: the first `WARMUP_S` seconds (cold start, world still catching up) and
 * everything after it (steady state, once the initial disk is filled and only the leading
 * edge of the drive needs building) — because they are different experiences and the fix
 * has to work for both. */
const WARMUP_S = 45;
const TARGET_M = KM * 1000;
let traveled = 0;
let lastX = car.x,
  lastZ = car.z;
let frames = 0;
const t0Wall = performance.now();
const speeds = [];
const queueTrace = []; // { t, queue, live }
let floraUpdateMsTotal = 0;
let floraUpdateMsMax = 0;

while (traveled < TARGET_M && frames < 200000) {
  car.terrain = localFor(car.x, car.z);
  const cmd = auto.update(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true }, DT);
  car.update(DT, cmd || { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true });

  simClock += DT * 1000;
  streamer.tick(car.x, car.z, simClock);
  const tf0 = performance.now();
  flora.update(DT, camera.position); // real Flora: _drain (BUILD_BUDGET), _cullPass, _growPass, _flush
  floraUpdateMsTotal += performance.now() - tf0;
  floraUpdateMsMax = Math.max(floraUpdateMsMax, performance.now() - tf0);
  chase.update(car, DT, (x, z) => car.terrain.height(x, z), { drift: false });

  sampleAttachEvents(camera.position, car.x, car.z, car.yaw);

  if (frames % 30 === 0) {
    speeds.push(car.kph);
    queueTrace.push({ t: simClock / 1000, queue: streamer.queue.length, live: streamer.live.size });
  }
  traveled += Math.hypot(car.x - lastX, car.z - lastZ);
  lastX = car.x;
  lastZ = car.z;
  frames++;
}
const wallMs = performance.now() - t0Wall;

/* ── report ── */
function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pick = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  return { n: s.length, min: s[0], p10: pick(0.1), p50: pick(0.5), mean: s.reduce((a, b) => a + b, 0) / s.length, max: s[s.length - 1] };
}

const meanSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
const worstSpeed = Math.min(...speeds);
const cruiseMs = meanSpeed / 3.6;

function report(label, evs) {
  const ahead = evs.filter((e) => e.ahead).map((e) => e.dist);
  const all = evs.map((e) => e.dist);
  const aheadStats = stats(ahead);
  const allStats = stats(all);
  console.log(`\n-- ${label}: ${evs.length} attach events, ${ahead.length} inside the forward 100° windshield cone --`);
  if (allStats) console.log(`  ALL:     min ${allStats.min.toFixed(1)} m   p10 ${allStats.p10.toFixed(1)} m   median ${allStats.p50.toFixed(1)} m   mean ${allStats.mean.toFixed(1)} m   max ${allStats.max.toFixed(1)} m`);
  if (aheadStats) {
    console.log(`  AHEAD:   min ${aheadStats.min.toFixed(1)} m   p10 ${aheadStats.p10.toFixed(1)} m   median ${aheadStats.p50.toFixed(1)} m   mean ${aheadStats.mean.toFixed(1)} m   max ${aheadStats.max.toFixed(1)} m`);
    const worstEvents = evs.filter((e) => e.ahead).sort((a, b) => a.dist - b.dist).slice(0, 5);
    console.log('  closest 5 (ahead):');
    for (const e of worstEvents) {
      console.log(`    ${e.dist.toFixed(1)} m ahead (${e.kind}), t=${e.simT.toFixed(1)}s  -- ${(e.dist / cruiseMs).toFixed(1)}s from the car at mean speed`);
    }
  } else {
    console.log('  (no forward attach events recorded in this window)');
  }
  return { aheadStats, allStats };
}

console.log(`\n=== tree pop-in distance, seed ${SEED}, terrain "${LAND}", ${(traveled / 1000).toFixed(2)} km / ${(simClock / 1000).toFixed(0)} s driven ===`);
console.log(`SCATTER_MAX_LEVEL = ${SCATTER_MAX_LEVEL}, this run capped at level ${SCATTER_CAP}  (existence radius roughly nodeSize(${SCATTER_CAP + 1}) * ${SPLIT_FACTOR} = ${(nodeSize(SCATTER_CAP + 1) * SPLIT_FACTOR).toFixed(0)} m)`);
console.log(`worker pool: ${WORKERS} lanes, ${streamer.buildCount} chunk builds, mean ${(streamer.buildMsTotal / Math.max(1, streamer.buildCount)).toFixed(2)} ms/build, worst queue depth seen: ${streamer.maxQueue}`);
console.log(`speed: mean ${meanSpeed.toFixed(1)} km/h, worst (corner) ${worstSpeed.toFixed(1)} km/h  [autopilot cruise target 95 km/h, the project's own convention]`);
console.log(`camera fov: ${camera.fov.toFixed(0)}° vertical (matches main.js's PerspectiveCamera(64, ...))`);
console.log(`\nFlora.update() cost: mean ${(floraUpdateMsTotal / frames).toFixed(3)} ms/frame, worst single frame ${floraUpdateMsMax.toFixed(2)} ms, over ${frames} frames`);
console.log(`Flora final state: ${flora.stats.instances} instances, ${flora.stats.batches} batches, ${flora.stats.chunks} chunk records (${flora.stats.attached} attached), ${flora.chunks.size} tracked`);

console.log('\n-- builds by node level --');
for (const [lv, s] of [...streamer.byLevel.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  level ${lv} (${nodeSize(lv)} m nodes): ${s.n} builds, mean ${(s.ms / s.n).toFixed(2)} ms`);
}

console.log('\n-- queue depth over time (sampled every 30 frames) --');
const traceStep = Math.max(1, Math.floor(queueTrace.length / 16));
for (let i = 0; i < queueTrace.length; i += traceStep) {
  const q = queueTrace[i];
  console.log(`  t=${q.t.toFixed(0).padStart(4)}s  queued ${String(q.queue).padStart(4)}  live chunks ${q.live}`);
}

report(`COLD START (first ${WARMUP_S}s — world still filling in from the spawn's single forced chunk)`, events.filter((e) => e.simT < WARMUP_S));
report(`STEADY STATE (after ${WARMUP_S}s — the initial disk is filled, only the leading edge is building)`, events.filter((e) => e.simT >= WARMUP_S));

console.log(`\nwall time to run this diagnostic: ${(wallMs / 1000).toFixed(1)} s`);
