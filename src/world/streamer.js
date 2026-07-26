/* Wanderoad — the chunk streamer.
 *
 * Holds a quadtree over the infinite plane, decides which nodes should exist this frame,
 * feeds the ones that are missing to a worker pool, and swaps meshes in when they arrive.
 *
 * Three rules keep it from hitching:
 *   1. Selection is cheap and runs every frame; generation is expensive and runs in
 *      workers.
 *   2. A node is never removed until its replacement has actually been uploaded, so the
 *      ground never flickers away under the car.
 *   3. The job queue is a priority queue sorted by distance, and it is re-sorted (not
 *      re-filled) as the player moves — so driving 200 m does not throw away 200 m of
 *      queued work, it just reorders it.
 */

import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  Object3D,
  Sphere,
  Vector3,
} from 'three';
import { GRID, LEAF, LEVELS, nodeSize, gridFor, buildChunk } from './chunk.js';
import { chunkKey } from '../core/math.js';

/** Split a node when the camera is closer than size * this. Higher = more detail, more nodes. */
const SPLIT_FACTOR = 1.7;
/** Hard cap on live meshes, so a pathological view cannot exhaust memory. */
const MAX_LIVE = 520;

export class Streamer {
  /**
   * @param {object} opts
   * @param {number} opts.seed
   * @param {THREE.Material} opts.material
   * @param {THREE.Material} [opts.depthMaterial]
   * @param {number} [opts.workers]
   * @param {number} [opts.viewDistance] metres; clamps the top of the quadtree
   */
  constructor({ seed, material, depthMaterial = null, workers = 0, viewDistance = 7000, onChunk = null, onRelease = null, terrain = 'rolling' }) {
    this.seed = seed >>> 0;
    this.material = material;
    this.depthMaterial = depthMaterial;
    this.viewDistance = viewDistance;
    this.onChunk = onChunk;
    this.onRelease = onRelease;
    this.terrainPreset = terrain;

    this.group = new Object3D();
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;

    /** key -> { mesh, level, cx, cz, size, ox, oz, heights } */
    this.live = new Map();
    /** key -> true while a job is in flight */
    this.pending = new Map();
    /** queued jobs, re-sorted each selection pass */
    this.queue = [];

    this.stats = { built: 0, queued: 0, live: 0, workers: 0, lastMs: 0 };

    const n = workers || Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 2));
    this.workers = [];
    this.busy = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (ev) => this._onWorkerMessage(i, ev.data);
      w.onerror = (e) => console.error('[streamer] worker error', e.message);
      this.workers.push(w);
      this.busy.push(null);
    }
    this.stats.workers = n;
    this._jobId = 1;
    this._camera = new Vector3();
    this._maxLevel = Math.min(LEVELS - 1, Math.max(0, Math.ceil(Math.log2(viewDistance / LEAF))));
  }

  /* ── selection ─────────────────────────────────────────────────────────── */

  /**
   * Walk the quadtree from the top, splitting nodes that are close enough. Returns the set
   * of node keys that SHOULD be live.
   */
  _select(camX, camZ) {
    const want = new Map();
    const top = this._maxLevel;
    const topSize = nodeSize(top);
    const r = Math.ceil(this.viewDistance / topSize) + 1;
    const ci = Math.floor(camX / topSize);
    const cj = Math.floor(camZ / topSize);

    const stack = [];
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) stack.push([i, j, top]);
    }

    while (stack.length) {
      const [cx, cz, level] = stack.pop();
      const size = nodeSize(level);
      const midX = (cx + 0.5) * size;
      const midZ = (cz + 0.5) * size;
      // Distance to the node's edge, not its centre — otherwise a big node you are
      // standing inside reports a large distance and refuses to split.
      const dx = Math.max(Math.abs(camX - midX) - size * 0.5, 0);
      const dz = Math.max(Math.abs(camZ - midZ) - size * 0.5, 0);
      const d = Math.hypot(dx, dz);

      if (d > this.viewDistance) continue;

      if (level > 0 && d < size * SPLIT_FACTOR) {
        const nl = level - 1;
        stack.push([cx * 2, cz * 2, nl]);
        stack.push([cx * 2 + 1, cz * 2, nl]);
        stack.push([cx * 2, cz * 2 + 1, nl]);
        stack.push([cx * 2 + 1, cz * 2 + 1, nl]);
      } else {
        want.set(`${level}:${cx},${cz}`, { cx, cz, level, d });
      }
    }
    return want;
  }

  /**
   * Update the world around a camera position. Call once per frame; it is cheap.
   */
  update(camX, camZ) {
    const t0 = performance.now();
    const want = this._select(camX, camZ);

    // Queue anything missing.
    this.queue.length = 0;
    for (const [key, n] of want) {
      if (this.live.has(key) || this.pending.has(key)) continue;
      this.queue.push({ key, ...n });
    }
    // Nearest first. A player at speed cares far more about the next 300 m than about a
    // 4 km node behind a hill.
    this.queue.sort((a, b) => a.d - b.d);

    // Retire anything no longer wanted. Keep it if it still covers the camera and nothing
    // has replaced it — that is the "never remove the ground you are standing on" rule.
    for (const [key, rec] of this.live) {
      if (want.has(key)) continue;
      this._release(key, rec);
    }

    // Emergency trim if something pathological happened.
    if (this.live.size > MAX_LIVE) {
      const sorted = [...this.live.entries()].sort((a, b) => {
        const da = Math.hypot(a[1].ox + a[1].size * 0.5 - camX, a[1].oz + a[1].size * 0.5 - camZ);
        const db = Math.hypot(b[1].ox + b[1].size * 0.5 - camX, b[1].oz + b[1].size * 0.5 - camZ);
        return db - da;
      });
      for (let i = 0; i < sorted.length - MAX_LIVE; i++) this._release(sorted[i][0], sorted[i][1]);
    }

    this._pump();
    this.stats.queued = this.queue.length;
    this.stats.live = this.live.size;
    this.stats.lastMs = performance.now() - t0;
  }

  _pump() {
    for (let i = 0; i < this.workers.length && this.queue.length; i++) {
      if (this.busy[i]) continue;
      const job = this.queue.shift();
      if (this.live.has(job.key) || this.pending.has(job.key)) {
        i--;
        continue;
      }
      const jobId = this._jobId++;
      this.busy[i] = job.key;
      this.pending.set(job.key, jobId);
      this.workers[i].postMessage({
        jobId,
        cx: job.cx,
        cz: job.cz,
        level: job.level,
        seed: this.seed,
        terrain: this.terrainPreset,
      });
    }
  }

  _onWorkerMessage(slot, msg) {
    const key = this.busy[slot];
    this.busy[slot] = null;
    if (msg.type === 'error') {
      console.error('[streamer] chunk build failed', msg.message);
      if (key) this.pending.delete(key);
      this._pump();
      return;
    }
    if (msg.type !== 'chunk') return;
    const k = `${msg.level}:${msg.cx},${msg.cz}`;
    this.pending.delete(k);
    if (!this.live.has(k)) this._adopt(k, msg);
    this._pump();
  }

  _adopt(key, c) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(c.position, 3));
    g.setAttribute('normal', new BufferAttribute(c.normal, 3));
    g.setAttribute('aBiome', new BufferAttribute(c.biome, 4, true));
    g.setAttribute('aRoad', new BufferAttribute(c.road, 2, true));
    g.setIndex(new BufferAttribute(c.index, 1));
    // Bounding sphere by hand: computeBoundingSphere would walk every vertex again, and we
    // already know the extents from the mesher.
    const r = Math.hypot(c.size, c.maxY - c.minY) * 0.72;
    g.boundingSphere = new Sphere(
      new Vector3(c.size * 0.5, (c.minY + c.maxY) * 0.5, c.size * 0.5),
      r
    );

    const mesh = new Mesh(g, this.material);
    mesh.position.set(c.ox, 0, c.oz);
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.level = c.level;
    // Render coarse nodes first: they are behind everything, and filling the far field
    // early gives the depth buffer a head start on the near field.
    mesh.renderOrder = -c.level;

    this.group.add(mesh);
    const rec = {
      mesh,
      level: c.level,
      cx: c.cx,
      cz: c.cz,
      size: c.size,
      ox: c.ox,
      oz: c.oz,
      step: c.step,
      grid: c.grid,
      minY: c.minY,
      maxY: c.maxY,
      heights: c.heights || null,
      water: c.water || null,
    };
    this.live.set(key, rec);
    this.stats.built++;
    if (this.onChunk) this.onChunk(rec, c);
  }

  _release(key, rec) {
    // Tell the decorators first: water planes, instanced flora and collision solids all
    // hang off a chunk, and freeing the mesh out from under them leaves orphans in the
    // scene that nothing will ever remove.
    if (this.onRelease) this.onRelease(rec);
    this.group.remove(rec.mesh);
    rec.mesh.geometry.dispose();
    this.live.delete(key);
  }

  /**
   * Ground height from the CPU copy of the finest live chunk under a point. Returns null
   * when that chunk has not streamed in yet — the caller (the car) then falls back to its
   * own local Terrain sampler, which is exact but slower.
   */
  sampleHeight(x, z) {
    const size = LEAF;
    const key = `0:${Math.floor(x / size)},${Math.floor(z / size)}`;
    const rec = this.live.get(key);
    if (!rec || !rec.heights) return null;
    const fx = (x - rec.ox) / rec.step;
    const fz = (z - rec.oz) / rec.step;
    let i = Math.floor(fx),
      j = Math.floor(fz);
    const G = rec.grid || GRID;
    if (i < 0 || j < 0 || i > G - 2 || j > G - 2) return null;
    const tx = fx - i,
      tz = fz - j;
    const h = rec.heights;
    const a = h[j * G + i];
    const b = h[j * G + i + 1];
    const c = h[(j + 1) * G + i];
    const d = h[(j + 1) * G + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** True once there is ground under the given point at the finest level. */
  isReady(x, z) {
    return this.sampleHeight(x, z) !== null;
  }

  /** Synchronously build the chunk containing (x,z) at level 0 — used to unblock a spawn. */
  forceChunk(x, z) {
    const cx = Math.floor(x / LEAF);
    const cz = Math.floor(z / LEAF);
    const key = `0:${cx},${cz}`;
    if (this.live.has(key)) return;
    const c = buildChunk({ cx, cz, level: 0, seed: this.seed });
    this.pending.delete(key);
    this._adopt(key, c);
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const [k, rec] of this.live) this._release(k, rec);
  }
}
