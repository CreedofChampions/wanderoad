// created by AI
/* Wanderoad — do trees BLINK? (measured, not assumed)
 *
 * Operator report, second time round: "Trees keep spawning in and out of existence in my field
 * of view rather than being there already... can't have trees spawning behind you or right next
 * to you. They should have already spawned."
 *
 * `tools/diag-treepop.mjs` measures FIRST appearance (a tree the player has never seen becoming
 * visible). That is not what this measures. This measures the other thing, which is worse and
 * which no tool here has ever looked at: a tree that IS already drawn stopping being drawn and
 * then being drawn again a few frames later — a blink, at whatever distance the LOD ladder
 * happens to put it, including beside and behind the car.
 *
 * Why that can happen at all: `scatterChunk` is LOD-invariant (verified separately — a level-3
 * node's tree list is byte-identical to the union of its four level-2 children's, position,
 * scale, species and all). So the SAME tree is carried by a level-0 node when you are near it
 * and by a level-3 node when you are far. Every LOD change is therefore a remove-and-re-add of
 * a tree that never moved, and any gap between the remove and the add is a tree that vanishes
 * and comes back in front of the player.
 *
 * Everything here is the real pipeline: the REAL `src/world/streamer.js` on a stubbed worker
 * pool driving REAL `buildChunk()` calls (so queue latency is real), `scatterChunk()` exactly as
 * `main.js`'s `onChunk` calls it, the REAL `Flora` with its real BUILD_BUDGET drain, and a cruise
 * down the REAL road network from the REAL `findSpawn()` at the project's own 95 km/h — see the
 * driver's own comment for why it is a kinematic tracker rather than `Vehicle` + `Autopilot`.
 *
 * It reports, for a drive:
 *   1. BLINKS — every tree that went visible -> invisible -> visible, with the distance from the
 *      camera and the bearing from the car at the moment it came back, and how long it was gone.
 *   2. FIRST APPEARANCES — the diag-treepop metric, kept so this tool can show it did not regress.
 *   3. GROUND HOLES — world points inside 320 m with no live terrain node over them at all,
 *      because the same remove-before-add pattern in `world/streamer.js` shows up there as sky.
 *
 *   node tools/diag-treeblink.mjs [--km 4] [--terrain meadow] [--seed 20260726]
 */

import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { PerspectiveCamera, Object3D } from 'three';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { LEAF, LEVELS, nodeSize, buildChunk } from '../src/world/chunk.js';
import { scatterChunk, SCATTER_MAX_LEVEL } from '../src/world/scatter.js';
import { Flora } from '../src/render/trees.js';
import { Streamer } from '../src/world/streamer.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = (+arg('seed', 20260726)) >>> 0;
const LAND = arg('terrain', 'meadow');
const KM = +arg('km', 4);
const DT = 1 / 60;
const WARMUP_S = 45; // cold start vs steady state, same split diag-treepop.mjs uses

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));

/* Same numbers as src/world/streamer.js's local consts and main.js's Streamer options. If those
 * move, this tool goes stale — it is a diagnostic, not a second source of truth. */
const SPLIT_FACTOR = 1.7;
const VIEW_DISTANCE = 6800;
const TOP_LEVEL = Math.min(LEVELS - 1, Math.max(0, Math.ceil(Math.log2(VIEW_DISTANCE / LEAF))));
const WORKERS = Math.max(2, Math.min(6, (os.cpus().length || 4) - 2));

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

/* ── the REAL Streamer, on a stubbed worker pool ──────────────────────────────
 * `src/world/streamer.js` is the code under test, so the harness runs THAT class, not a copy of
 * it — the retire pass, the coverage recursion and the emergency trim measured below are the
 * ones that ship. Only the two browser things it needs are stubbed: `Worker` (gotcha #2 — the
 * worker has its own module graph, but it is a five-line wrapper around the same `buildChunk()`
 * this file can call directly) and `navigator.hardwareConcurrency`.
 *
 * Job latency is not assumed: `buildChunk()` is timed for real and its result is delivered to
 * the streamer only once that many milliseconds of SIMULATED time have passed, so the queueing
 * dynamics — which are what put a hole in the ground — are the real ones.
 */
/* node 24 defines `navigator` as a getter-only global, so this overrides the property rather
 * than assigning to it. The streamer only reads hardwareConcurrency off it. */
if (!globalThis.navigator || !globalThis.navigator.hardwareConcurrency) {
  Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: os.cpus().length || 4 }, configurable: true });
}
const INFLIGHT = [];
let buildCount = 0;
let buildMsTotal = 0;
globalThis.Worker = class StubWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
  }
  postMessage(req) {
    const t0 = performance.now();
    const c = buildChunk(req);
    const ms = performance.now() - t0;
    buildCount++;
    buildMsTotal += ms;
    c.type = 'chunk';
    c.jobId = req.jobId;
    INFLIGHT.push({ w: this, c, doneAt: simClock + ms });
  }
  terminate() {}
};
function deliverCompleted() {
  for (let i = INFLIGHT.length - 1; i >= 0; i--) {
    if (INFLIGHT[i].doneAt <= simClock) {
      const job = INFLIGHT.splice(i, 1)[0];
      if (job.w.onmessage) job.w.onmessage({ data: job.c });
    }
  }
}

/* `--legacy` swaps the real Streamer for the release-immediately rule it used to have, so the
 * before/after in this file's header can be reproduced from one tool on one checkout. */
const LEGACY = process.argv.includes('--legacy');

class MiniStreamer {
  constructor({ seed, onChunk, onRelease }) {
    this.seed = seed;
    this.onChunk = onChunk;
    this.onRelease = onRelease;
    this.live = new Map();
    this.retiring = new Map();
    this.pending = new Set();
    this.queue = [];
    this.busy = new Array(WORKERS).fill(null);
    this.clock = 0;
    this.buildMsTotal = 0;
    this.buildCount = 0;
    this.maxQueue = 0;
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

    // The OLD rule, kept verbatim for `--legacy`: release on the spot, replacement or not.
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

/* ── the drive ────────────────────────────────────────────────────────────────
 * A CRUISE, not a physics sim: the driver below tracks the REAL road network (the real
 * `RoadField.query()` on the real seed, from the real `findSpawn()` start) at the project's own
 * 95 km/h cruise, with a lookahead pursuit and a bounded yaw rate.
 *
 * Why not `Vehicle` + `Autopilot`, as tools/diag-treepop.mjs does: in this working tree the car
 * dead-stops at x≈867 m about 35 s in and never moves again (reproduced standalone, with no
 * streamer, no Flora and no camera in the loop — `car/vehicle.js` and `car/tuning.js` are both
 * open in another session right now). A streaming measurement only depends on where the
 * viewpoint is and how fast it moves, so this decouples the measurement from that: the numbers
 * below are the same numbers a working autopilot would produce, and they do not silently become
 * "the car parked for 55 minutes" if somebody else's physics edit lands mid-run.
 */
let tcx = 0,
  tcz = 0,
  terr = null;
const localFor = (x, z) => {
  if (!terr || Math.abs(x - tcx) > 240 || Math.abs(z - tcz) > 240) {
    terr = new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
    tcx = x;
    tcz = z;
  }
  return terr;
};
const spawn = findSpawn(SEED);
const CRUISE = 26.4; // m/s — 95 km/h, the project's own cruise convention
const LOOKAHEAD = 34; // m down the centreline the driver aims at
const YAW_RATE = 1.1; // rad/s cap, about what the real car manages at this speed
const car = { x: spawn.x, z: spawn.z, y: spawn.y, yaw: spawn.heading, kph: CRUISE * 3.6 };

function driveStep(dt) {
  const t = localFor(car.x, car.z);
  const q = t.roads.query(car.x, car.z);
  let fx = Math.sin(car.yaw);
  let fz = Math.cos(car.yaw);
  if (Number.isFinite(q.d)) {
    // Tangent sign is arbitrary per segment; take the one we are already going.
    const s = q.tx * fx + q.tz * fz >= 0 ? 1 : -1;
    const ax = q.qx + s * q.tx * LOOKAHEAD - car.x;
    const az = q.qz + s * q.tz * LOOKAHEAD - car.z;
    const want = Math.atan2(ax, az);
    let dy = want - car.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const cap = YAW_RATE * dt;
    car.yaw += Math.max(-cap, Math.min(cap, dy));
    fx = Math.sin(car.yaw);
    fz = Math.cos(car.yaw);
  }
  car.x += fx * CRUISE * dt;
  car.z += fz * CRUISE * dt;
  car.y = t.height(car.x, car.z);
}

/* The chase camera's own geometry, in the one respect this measurement can see it: about 7 m
 * behind the car and 2.6 m up (car/camera.js's sport rig). Every distance reported below is
 * from this point, as the player's lens is. */
const camera = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);

/* ── the real Flora, fed by the real scatterChunk() ── */
const scene = new Object3D();
const flora = new Flora({ seed: SEED, scene });
/* `--legacy` also puts Flora back to dropping a chunk the moment the streamer releases it, which
 * is what `remove()` used to do — so one tool can produce both halves of the before/after. */
if (LEGACY) flora._retirePass = function () { for (const e of [...this._retiring.values()]) this._purge(e); };
const treesByKey = new Map();

/* Exactly main.js's own onChunk/onRelease wiring for flora, minus the water and the collision
 * solids, which no part of this measurement can see. */
const hooks = {
  seed: SEED,
  onChunk: (rec) => {
    if (rec.level <= SCATTER_MAX_LEVEL) {
      const s = scatterChunk({ cx: rec.cx, cz: rec.cz, level: rec.level, seed: SEED });
      treesByKey.set(`${rec.level}:${rec.cx},${rec.cz}`, s.trees);
      flora.add(rec, s);
    }
  },
  onRelease: (rec) => {
    flora.remove(rec);
  },
};
const streamer = LEGACY
  ? new MiniStreamer(hooks)
  : new Streamer({ ...hooks, material: { isMaterial: true }, viewDistance: VIEW_DISTANCE, terrain: LAND });
/* main.js force-builds the one chunk under the spawn and drops the player in while the rest of
 * the disk streams around them. Same here, or the cold-start numbers are a different experience
 * from the real one. */
if (!LEGACY) streamer.forceChunk(spawn.x, spawn.z);
const tick = LEGACY
  ? (x, z) => streamer.tick(x, z, simClock)
  : (x, z) => {
      deliverCompleted();
      streamer.update(x, z);
    };

/* ── per-tree visibility ledger ───────────────────────────────────────────────
 * A tree is "visible" while at least one ATTACHED Flora chunk carries it, refcounted because a
 * handoff can legitimately have two chunks carrying it at once.
 *
 * The bookkeeping is deliberately ORDER-INDEPENDENT and evaluated once per frame, on the state
 * the renderer would actually draw. Doing it as a stream of attach/detach events would decide
 * the answer by Map iteration order: a clean same-frame swap looks like a blink if the detach is
 * seen first and like a double if the attach is, and either way the headline number would be an
 * artefact of this file rather than a fact about the game. So each frame every touched tree
 * remembers its count at the END of the previous frame (`n0`), all the attaches and detaches are
 * applied, and only then is the transition read off:
 *
 *   n0 > 0, n == 0   the tree stopped being drawn
 *   n0 == 0, n > 0   it started being drawn — a BLINK if it had been drawn before, else a FIRST
 *   n >= 2           two chunks are drawing the same tree in the same rendered frame (a double)
 */
const vis = new Map(); // treeId -> { n, n0, mark, x, z, goneT, goneD, seen }
const attachedKeys = new Set();
let simClock = 0;
let camX = 0,
  camZ = 0,
  carX = 0,
  carZ = 0,
  carFx = 0,
  carFz = 1;

const blinks = []; // { d, gapS, goneD, cos, t }
const firsts = []; // { d, cos, t }
let doubles = 0; // tree-frames drawn twice at once
let maxRef = 1;
let frameNo = 0;
const touched = [];

const idOf = (t) => `${Math.round(t.x * 100)},${Math.round(t.z * 100)}`;

function bearingCos(x, z) {
  const rx = x - carX;
  const rz = z - carZ;
  const rl = Math.hypot(rx, rz) || 1;
  return (rx * carFx + rz * carFz) / rl;
}

function bump(key, delta) {
  const trees = treesByKey.get(key);
  if (!trees) return;
  for (const t of trees) {
    const id = idOf(t);
    let rec = vis.get(id);
    if (!rec) {
      rec = { n: 0, n0: 0, mark: -1, x: t.x, z: t.z, goneT: -1, seen: false, goneD: 0 };
      vis.set(id, rec);
    }
    if (rec.mark !== frameNo) {
      rec.mark = frameNo;
      rec.n0 = rec.n;
      touched.push(rec);
    }
    rec.n += delta;
    if (rec.n < 0) rec.n = 0;
  }
}

function settleFrame() {
  const now = simClock / 1000;
  for (const rec of touched) {
    if (rec.n > maxRef) maxRef = rec.n;
    if (rec.n >= 2) doubles++;
    if (rec.n0 === 0 && rec.n > 0) {
      const d = Math.hypot(rec.x - camX, rec.z - camZ);
      const cos = bearingCos(rec.x, rec.z);
      if (rec.seen) blinks.push({ d, gapS: now - rec.goneT, goneD: rec.goneD, cos, t: now });
      else firsts.push({ d, cos, t: now });
      rec.seen = true;
    } else if (rec.n0 > 0 && rec.n === 0) {
      rec.goneT = now;
      rec.goneD = Math.hypot(rec.x - camX, rec.z - camZ);
    }
  }
  touched.length = 0;
}

function sampleVisibility() {
  frameNo++;
  // Attaches first, then detaches, then settle — see the ledger comment above.
  const gone = [];
  for (const [key, entry] of flora.chunks) {
    const att = !!entry.blocks;
    if (att && !attachedKeys.has(key)) {
      attachedKeys.add(key);
      bump(key, +1);
    } else if (!att && attachedKeys.has(key)) {
      attachedKeys.delete(key);
      gone.push(key);
    }
  }
  for (const key of [...attachedKeys]) {
    if (!flora.chunks.has(key)) {
      attachedKeys.delete(key);
      gone.push(key);
    }
  }
  for (const key of gone) bump(key, -1);
  settleFrame();
}

/* ── ground-hole probe ────────────────────────────────────────────────────────
 * A world-anchored 40 m lattice inside 320 m of the car. A cell is "covered" when some live
 * terrain node contains its centre. Uncovered = the player is looking at a hole where ground
 * should be. Sampled every 3rd frame; that is 20 ms of simulated time, far finer than any hole
 * a human would notice. */
const PROBE_CELL = 40;
const PROBE_R = 320;
const holeOpen = new Map(); // "gi,gj" -> { t0, d }
const holes = []; // { secs, d }

function probeGround() {
  const gi0 = Math.floor((carX - PROBE_R) / PROBE_CELL);
  const gi1 = Math.floor((carX + PROBE_R) / PROBE_CELL);
  const gj0 = Math.floor((carZ - PROBE_R) / PROBE_CELL);
  const gj1 = Math.floor((carZ + PROBE_R) / PROBE_CELL);
  const seen = new Set();
  for (let gj = gj0; gj <= gj1; gj++) {
    for (let gi = gi0; gi <= gi1; gi++) {
      const x = (gi + 0.5) * PROBE_CELL;
      const z = (gj + 0.5) * PROBE_CELL;
      const d = Math.hypot(x - carX, z - carZ);
      if (d > PROBE_R) continue;
      const gkey = `${gi},${gj}`;
      seen.add(gkey);
      let covered = false;
      for (let l = 0; l <= TOP_LEVEL; l++) {
        const s = nodeSize(l);
        if (streamer.live.has(`${l}:${Math.floor(x / s)},${Math.floor(z / s)}`)) {
          covered = true;
          break;
        }
      }
      if (covered) {
        const open = holeOpen.get(gkey);
        if (open) {
          holes.push({ secs: simClock / 1000 - open.t0, d: open.d, t: open.t0 });
          holeOpen.delete(gkey);
        }
      } else if (!holeOpen.has(gkey)) {
        holeOpen.set(gkey, { t0: simClock / 1000, d });
      }
    }
  }
  for (const k of [...holeOpen.keys()]) if (!seen.has(k)) holeOpen.delete(k);
}

/* ── drive ── */
const TARGET_M = KM * 1000;
let traveled = 0;
let lastX = car.x,
  lastZ = car.z;
let frames = 0;
const t0Wall = performance.now();
const speeds = [];
let floraMsTotal = 0;
let floraMsMax = 0;
let instMax = 0;
let streamMsTotal = 0;
let streamMsMax = 0;
const streamSamples = [];
let liveMax = 0;
let retMax = 0;
let floraRetMax = 0;

while (traveled < TARGET_M && frames < 200000) {
  driveStep(DT);
  camera.position.set(car.x - Math.sin(car.yaw) * 7, car.y + 2.6, car.z - Math.cos(car.yaw) * 7);

  simClock += DT * 1000;
  const ts0 = performance.now();
  tick(car.x, car.z);
  const tms = performance.now() - ts0;
  streamMsTotal += tms;
  streamSamples.push(tms);
  if (tms > streamMsMax) streamMsMax = tms;
  const tf0 = performance.now();
  flora.update(DT, camera.position);
  const ms = performance.now() - tf0;
  floraMsTotal += ms;
  if (ms > floraMsMax) floraMsMax = ms;

  camX = camera.position.x;
  camZ = camera.position.z;
  carX = car.x;
  carZ = car.z;
  carFx = Math.sin(car.yaw);
  carFz = Math.cos(car.yaw);

  sampleVisibility();
  if (frames % 3 === 0) probeGround();
  if (flora.stats.instances > instMax) instMax = flora.stats.instances;
  if (!LEGACY) {
    if (streamer.stats.live > liveMax) liveMax = streamer.stats.live;
    if (streamer.stats.retiring > retMax) retMax = streamer.stats.retiring;
  }
  if (flora.stats.retiring > floraRetMax) floraRetMax = flora.stats.retiring;

  if (frames % 30 === 0) speeds.push(car.kph);
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
  return { n: s.length, min: s[0], p10: pick(0.1), p50: pick(0.5), p90: pick(0.9), mean: s.reduce((a, b) => a + b, 0) / s.length, max: s[s.length - 1] };
}
const fmt = (s, u = 'm') => (s ? `min ${s.min.toFixed(1)}${u}  p10 ${s.p10.toFixed(1)}  med ${s.p50.toFixed(1)}  mean ${s.mean.toFixed(1)}  p90 ${s.p90.toFixed(1)}  max ${s.max.toFixed(1)}` : '(none)');

const meanSpeed = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
const AHEAD = Math.cos((50 * Math.PI) / 180);
const BEHIND = Math.cos((130 * Math.PI) / 180);

console.log(`\n=== tree BLINK audit — seed ${SEED}, terrain "${LAND}", ${(traveled / 1000).toFixed(2)} km / ${(simClock / 1000).toFixed(0)} s driven, ${frames} frames ===`);
console.log(`SCATTER_MAX_LEVEL ${SCATTER_MAX_LEVEL}, streamer: ${LEGACY ? 'LEGACY release-immediately (--legacy)' : 'real src/world/streamer.js'}`);
console.log(`speed mean ${meanSpeed.toFixed(1)} km/h; worker pool ${WORKERS} lanes, ${LEGACY ? streamer.buildCount : buildCount} builds, worst queue ${LEGACY ? streamer.maxQueue : streamer.stats.queued}`);
console.log(`Flora.update(): mean ${(floraMsTotal / frames).toFixed(3)} ms/frame, worst frame ${floraMsMax.toFixed(2)} ms; peak instances ${instMax}; final chunk records ${flora.chunks.size}`);
console.log(`streamer selection+retire cost (excludes the buildChunk() the stub does inline): see per-frame note below`);
console.log(`distinct trees tracked: ${vis.size}`);
console.log(`double-drawn tree-frames (same tree carried by two attached chunks in one rendered frame): ${doubles}, worst refcount ${maxRef}`);
{
  /* The stub worker runs buildChunk() INLINE (in the browser that is a real worker thread), so the
   * mean and the tail here are dominated by chunk generation and say nothing about the change.
   * The median frame dispatches no job, so the low percentiles are the selection + retire pass on
   * its own — which is the part this pass actually touched. */
  const ss = stats(streamSamples);
  console.log(`streamer per-frame: p10 ${ss.p10.toFixed(3)} ms  median ${ss.p50.toFixed(3)} ms  (a frame that dispatches no chunk = selection + retire pass only)`);
  console.log(`  ...with generation folded in (stub builds inline; a browser does this off-thread): mean ${ss.mean.toFixed(2)} ms  p90 ${ss.p90.toFixed(2)} ms  max ${ss.max.toFixed(1)} ms`);
}
console.log(`peak live terrain nodes ${liveMax} (MAX_LIVE is 520), peak superseded-but-still-drawn: terrain ${retMax}, flora ${floraRetMax}`);

for (const [label, filt] of [
  [`COLD START (t < ${WARMUP_S}s)`, (e) => e.t < WARMUP_S],
  [`STEADY STATE (t >= ${WARMUP_S}s)`, (e) => e.t >= WARMUP_S],
]) {
  const bl = blinks.filter(filt);
  const fi = firsts.filter(filt);
  console.log(`\n-- ${label} --`);
  console.log(`  BLINKS (already-visible tree vanished then came back): ${bl.length}`);
  console.log(`    reappear distance from camera : ${fmt(stats(bl.map((e) => e.d)))}`);
  console.log(`    time invisible                : ${fmt(stats(bl.map((e) => e.gapS)), 's')}`);
  const ahead = bl.filter((e) => e.cos > AHEAD);
  const side = bl.filter((e) => e.cos <= AHEAD && e.cos > BEHIND);
  const behind = bl.filter((e) => e.cos <= BEHIND);
  console.log(`    by bearing from the car       : ahead(<50°) ${ahead.length}, side ${side.length}, behind(>130°) ${behind.length}`);
  console.log(`    blinks inside 400 m           : ${bl.filter((e) => e.d < 400).length}   inside 200 m: ${bl.filter((e) => e.d < 200).length}`);
  if (ahead.length) console.log(`    AHEAD reappear distance       : ${fmt(stats(ahead.map((e) => e.d)))}`);
  /* A gap under half a second is an LOD handoff — the same tree, gone and back before the player
   * has driven 14 m. A long gap is the cull ring at ~1400 m doing its job on a bend, which is
   * not the complaint. Splitting them keeps the fix honest about which one it moved. */
  const snap = bl.filter((e) => e.gapS < 0.5);
  console.log(`    HANDOFF blinks (gap < 0.5 s)  : ${snap.length}  ${snap.length ? fmt(stats(snap.map((e) => e.d))) : ''}`);
  console.log(`    ...of those, inside 600 m     : ${snap.filter((e) => e.d < 600).length}`);
  console.log(`  FIRST APPEARANCES (never-seen tree becoming visible): ${fi.length}`);
  console.log(`    distance from camera          : ${fmt(stats(fi.map((e) => e.d)))}`);
  const fa = fi.filter((e) => e.cos > AHEAD);
  if (fa.length) console.log(`    AHEAD only                    : ${fmt(stats(fa.map((e) => e.d)))}`);
}

const steadyHoles = holes.filter((h) => h.secs > 0 && h.t >= WARMUP_S);
console.log(`\n-- GROUND HOLES inside ${PROBE_R} m (no live terrain node over the point) --`);
console.log(`  STEADY-STATE episodes (t >= ${WARMUP_S}s): ${steadyHoles.length}   cold-start episodes: ${holes.length - steadyHoles.length}   still open at end: ${holeOpen.size}`);
console.log(`  duration: ${fmt(stats(steadyHoles.map((h) => h.secs)), 's')}`);
console.log(`  distance from car at open: ${fmt(stats(steadyHoles.map((h) => h.d)))}`);
console.log(`\nwall time: ${(wallMs / 1000).toFixed(1)} s`);
