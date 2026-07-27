// created by AI
/* Wanderoad — proving the grow-in is real geometry, not just code that runs.
 *
 * Gotcha #3: a flag being set is not a thing being visible. This does not check that
 * `_growPass()` executed — it reads the SAME typed array the GPU actually uploads
 * (`batch.iPos`, the `iPos` instanced attribute `TREE_VS` multiplies every local vertex by)
 * for one real, newly-attached tree instance, every simulated frame, and prints the scale
 * curve. If this were dead code the value would jump straight to its target on the first
 * sample; a real grow-in prints a smooth ramp from small to full over GROW_SECS.
 *
 *   node tools/diag-treegrow.mjs [--seed 20260726] [--terrain meadow]
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
const DT = 1 / 60;

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));
const CAR = FLEET_BY_ID[FIRST_CAR];
applyCarFeel(CAR);

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
auto.cruise = 26.4;

const camera = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);
const chase = new ChaseCamera(camera, { mode: 'sport' });

const scene = new Object3D();
const flora = new Flora({ seed: SEED, scene });

const streamer = new MiniStreamer({
  seed: SEED,
  onChunk: (rec) => {
    if (rec.level <= SCATTER_MAX_LEVEL) {
      const s = scatterChunk({ cx: rec.cx, cz: rec.cz, level: rec.level, seed: SEED });
      flora.add(rec, s);
    }
  },
  onRelease: (rec) => flora.remove(rec),
});

const wasAttached = new Set();
let watched = null; // { block, idx, targetScale }
const curve = [];
let simClock = 0;
let frames = 0;

console.log(`\n=== grow-in verification, seed ${SEED}, terrain "${LAND}" ===`);

while (frames < 200000) {
  car.terrain = localFor(car.x, car.z);
  const cmd = auto.update(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true }, DT);
  car.update(DT, cmd || { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true });

  simClock += DT * 1000;
  streamer.tick(car.x, car.z, simClock);
  flora.update(DT, camera.position);
  chase.update(car, DT, (x, z) => car.terrain.height(x, z), { drift: false });

  if (!watched) {
    // grab the first tree block that attaches once the world has settled a little, so it is
    // an ordinary leading-edge attach and not the very first frame's mass spawn-in.
    if (simClock > 3000) {
      for (const [key, entry] of flora.chunks) {
        if (entry.blocks && !wasAttached.has(key)) {
          for (const block of entry.blocks) {
            if (block.len > 0 && block.batch.kind !== 'scrub') {
              watched = { block, idx: 0, targetScale: block.g.pos[3], attachClock: simClock };
              break;
            }
          }
        }
        if (entry.blocks) wasAttached.add(key);
      }
    }
  }

  if (watched) {
    const { block, idx, targetScale } = watched;
    const liveScale = block.alive ? block.batch.iPos[(block.start + idx) * 4 + 3] : null;
    curve.push({ t: (simClock - watched.attachClock) / 1000, scale: liveScale, needsUpdate: block.batch.aPos.needsUpdate });
    if (curve.length > 130) break; // > GROW_SECS worth of frames at 60 Hz, plus margin
  }

  frames++;
}

if (!watched) {
  console.log('  no tree attach event captured in this run — try a longer drive or a different seed.');
  process.exit(1);
}

console.log(`  watching a real "${watched.block.batch.kind}" instance (LOD ${watched.block.batch.detail}), target scale ${watched.targetScale.toFixed(3)}`);
console.log('  t(s)   iPos.w (the exact float the vertex shader multiplies every local vertex by)');
for (let i = 0; i < curve.length; i += 6) {
  const c = curve[i];
  const bar = '#'.repeat(Math.round((c.scale / watched.targetScale) * 40));
  console.log(`  ${c.t.toFixed(2).padStart(5)}  ${c.scale.toFixed(4).padStart(7)}  ${bar}`);
}
const first = curve[0];
const last = curve[curve.length - 1];
console.log(`\n  first sample: ${first.scale.toFixed(4)} (${((first.scale / watched.targetScale) * 100).toFixed(1)}% of target)`);
console.log(`  last sample:  ${last.scale.toFixed(4)} (${((last.scale / watched.targetScale) * 100).toFixed(1)}% of target) at t=${last.t.toFixed(2)}s`);
const monotonic = curve.every((c, i) => i === 0 || c.scale >= curve[i - 1].scale - 1e-6);
const reachedFull = last.scale > watched.targetScale * 0.999;
console.log(`  monotonically non-decreasing across ${curve.length} frames: ${monotonic}`);
console.log(`  reached (>99.9% of) full target scale by the end of the window: ${reachedFull}`);
// No WebGLRenderer exists in this harness (nothing here ever draws a frame), so
// `needsUpdate` has nothing to reset it back to false the way the real renderer would after
// an upload — it would read `true` forever after the first grow tick regardless of whether
// _growPass() is re-arming it every frame, so it is not evidence of anything here and is
// deliberately not reported. The scale curve above is: real floats, straight out of the same
// `iPos` typed array the GPU actually binds.
