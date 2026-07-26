/* Wanderoad — what the flower layer costs, measured rather than guessed.
 *
 * There is no GL context here, so this measures the two halves the CPU actually pays for
 * every frame — scattering a chunk and turning it into instance buffers — and counts the
 * geometry the GPU is then handed. It drives a real 8 km line through the world with the
 * real Flora/Flowers classes and the real streamer geometry, one level-0 ring at a time.
 *
 * node tools/bench-flowers.mjs [seed]
 */

import { Object3D, Vector3 } from 'three';
import { Flora } from '../src/render/trees.js';
import { FLOWER_ARCH } from '../src/render/flowers.js';
import { scatterChunk, flowerBudget } from '../src/world/scatter.js';
import { nodeSize } from '../src/world/chunk.js';
import { landHeight, Terrain } from '../src/world/terrain.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const LEAF = nodeSize(0);

/* ── 0. determinism, including across LOD ────────────────────────────────────
 * The scatter's headline invariant is that a prop is a pure function of its lattice cell,
 * so the same tree comes out of the level-0 node you are standing in and the level-1 node
 * that replaces it when you drive away. The density fields are interpolated off a lattice
 * and that is exactly the kind of change that can break it: anchor the lattice to the node
 * instead of to the world and every prop moves the moment the LOD flips.
 */
{
  const key = (p) => `${p.x.toFixed(4)},${p.z.toFixed(4)},${p.kind},${p.scale.toFixed(4)},${p.yaw.toFixed(4)}`;
  const a = scatterChunk({ cx: 11, cz: -7, level: 1, seed: SEED });
  const b = scatterChunk({ cx: 11, cz: -7, level: 1, seed: SEED });
  const same = ['trees', 'rocks', 'bushes'].every(
    (k) => a[k].length === b[k].length && a[k].every((p, i) => key(p) === key(b[k][i]))
  );
  const kids = [];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) kids.push(scatterChunk({ cx: 22 + i, cz: -14 + j, level: 0, seed: SEED }));
  }
  let ok = true;
  const detail = [];
  for (const k of ['trees', 'rocks', 'bushes', 'reeds', 'posts']) {
    const parent = a[k].map(key).sort();
    const child = kids.flatMap((c) => c[k].map(key)).sort();
    const eq = parent.length === child.length && parent.every((v, i) => v === child[i]);
    detail.push(`${k} ${parent.length}=${child.length}${eq ? '' : ' MISMATCH'}`);
    ok = ok && eq;
  }
  console.log('--- determinism ---');
  console.log('  same call twice identical :', same);
  console.log('  level-1 node === its four level-0 children :', ok, ' [', detail.join(', '), ']');
}

/* ── 1. the scatter pass ─────────────────────────────────────────────────────── */
console.log('\n--- scatterChunk, mean ms per node (100 real nodes each) ---');
for (const level of [0, 1, 2]) {
  const size = nodeSize(level);
  // warm the JIT on the same shape of work we are about to time
  for (let i = 0; i < 12; i++) scatterChunk({ cx: 900 + i, cz: -400, level, seed: SEED });
  const t0 = performance.now();
  let props = 0;
  let flowers = 0;
  const N = 100;
  for (let i = 0; i < N; i++) {
    const s = scatterChunk({ cx: -50 + i, cz: 37 + ((i * 7) % 13), level, seed: SEED });
    props += s.trees.length + s.rocks.length + s.bushes.length + s.reeds.length + s.posts.length;
    flowers += s.flowers.length;
  }
  const ms = (performance.now() - t0) / N;
  // The Terrain the pass builds first dominates it, so quote it: a delta against a 5 ms
  // floor means something different from a delta against a 0.3 ms one, and the floor moves
  // by 5x depending on what else this machine is doing.
  const t1 = performance.now();
  for (let i = 0; i < N; i++) {
    const ox = (-50 + i) * size;
    const oz = (37 + ((i * 7) % 13)) * size;
    const t = new Terrain(SEED, ox, oz, ox + size, oz + size, Math.max(42, size * 0.25));
    if (!t.roads) throw new Error('no roads');
  }
  const tms = (performance.now() - t1) / N;
  console.log(
    `  level ${level} (${size} m): ${ms.toFixed(3)} ms/node  (of which new Terrain ${tms.toFixed(3)} ms)` +
      `   props ${(props / N).toFixed(1)}/node   flowers ${(flowers / N).toFixed(1)}/node`
  );
}

/* ── 1b. the worst node in a big region ──────────────────────────────────────
 * The mean is not what drops a frame. Find the level-0 node with the most flowers in a
 * 2 km square and time that one on its own.
 */
{
  let worst = null;
  for (let j = 0; j < 32; j++) {
    for (let i = 0; i < 32; i++) {
      const cx = 100 + i;
      const cz = 68 + j;
      const n = scatterChunk({ cx, cz, level: 0, seed: SEED }).flowers.length;
      if (!worst || n > worst.n) worst = { cx, cz, n };
    }
  }
  for (let i = 0; i < 5; i++) scatterChunk({ cx: worst.cx, cz: worst.cz, level: 0, seed: SEED });
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) scatterChunk({ cx: worst.cx, cz: worst.cz, level: 0, seed: SEED });
  const ms = (performance.now() - t0) / 20;
  console.log(
    `  worst level-0 node in a 2 km square: ${worst.n} flowers (${((worst.n / (LEAF * LEAF)) * 1e4).toFixed(0)}/ha)` +
      ` in ${ms.toFixed(3)} ms at (${worst.cx * LEAF}, ${worst.cz * LEAF})`
  );
}

/* ── 2. the whole per-frame path, driving ────────────────────────────────────
 * A level-1 node splits at 217 m, so the level-0 ring the flowers live in is 7x7 nodes wide.
 * Walk the car along a line, feed the ring in and out exactly as the streamer would, and
 * time Flora.update — which is where the flower rebuild lands.
 */
const scene = new Object3D();
const flora = new Flora({ seed: SEED, scene });
const RING = 3; // nodes either side of the car; 7x7 covers 224 m
const live = new Map();
const cam = new Vector3();

function recFor(cx, cz) {
  return { level: 0, cx, cz, ox: cx * LEAF, oz: cz * LEAF, size: LEAF };
}

let addMs = 0;
let updMs = 0;
let frames = 0;
let peakInst = 0;
let peakTri = 0;
let sumInst = 0;
let worstUpd = 0;
/* 1.5 m per frame is 90 m/s at 60 fps — the car flat out, which is the worst case for
 * streaming pressure. Anything faster measures a car that does not exist. */
const STEP = 1.5;
const FRAMES = 2600;
for (let f = 0; f < FRAMES; f++) {
  // A gentle curve, not a slalom: the lateral term has to stay small against STEP or the
  // car is secretly travelling four times as fast as the label on this bench says.
  const px = -3600 + f * STEP;
  const pz = 1300 + Math.sin(f * 0.0016) * 210;
  cam.set(px, landHeight(px, pz, SEED) + 2, pz);
  const cx0 = Math.floor(px / LEAF);
  const cz0 = Math.floor(pz / LEAF);

  const want = new Set();
  for (let j = -RING; j <= RING; j++) {
    for (let i = -RING; i <= RING; i++) want.add(`${cx0 + i},${cz0 + j}`);
  }
  for (const k of live.keys()) {
    if (want.has(k)) continue;
    const [cx, cz] = k.split(',').map(Number);
    flora.remove(recFor(cx, cz));
    live.delete(k);
  }
  const t0 = performance.now();
  for (const k of want) {
    if (live.has(k)) continue;
    const [cx, cz] = k.split(',').map(Number);
    const rec = recFor(cx, cz);
    flora.add(rec, scatterChunk({ cx, cz, level: 0, seed: SEED }));
    live.set(k, 1);
  }
  addMs += performance.now() - t0;

  const t1 = performance.now();
  flora.update(1 / 60, cam);
  const dt = performance.now() - t1;
  updMs += dt;
  if (f > 30) {
    if (dt > worstUpd) worstUpd = dt;
    const s = flora.flowers.stats;
    sumInst += s.instances;
    if (s.instances > peakInst) peakInst = s.instances;
    if (s.tris > peakTri) peakTri = s.tris;
  }
  frames++;
}

console.log(
  `\n--- driving ${((FRAMES * STEP) / 1000).toFixed(1)} km at 90 m/s, ${FRAMES} frames, level-0 ring 7x7 ---`
);
console.log('  scatter + Flora.add   :', (addMs / frames).toFixed(3), 'ms/frame  (shared with the collision solids)');
console.log('  Flora.update total    :', (updMs / frames).toFixed(3), 'ms/frame');
console.log('  worst single update   :', worstUpd.toFixed(3), 'ms');
console.log('  flower instances mean :', (sumInst / (frames - 31)).toFixed(0), ' peak:', peakInst);
console.log('  flower triangles peak :', peakTri.toLocaleString());
console.log('  flowerBudget()/node   :', flowerBudget());

/* ── 3. the flower half of Flora.update, on its own ──────────────────────────── */
let fMs = 0;
let fWorst = 0;
for (let i = 0; i < 400; i++) {
  const px = 1200 + i * 6;
  const pz = 1900;
  cam.set(px, 0, pz);
  const t = performance.now();
  flora.flowers.update(cam);
  const dt = performance.now() - t;
  fMs += dt;
  if (dt > fWorst) fWorst = dt;
}
console.log('\n  Flowers.update alone  :', (fMs / 400).toFixed(4), 'ms/frame   worst:', fWorst.toFixed(3), 'ms');

const tri = {};
for (const [kind, b] of flora.flowers.batches) tri[kind] = `${b.tri} tris`;
console.log('  geometry per instance :', JSON.stringify(tri), 'heights', JSON.stringify(FLOWER_ARCH));
console.log('  draw calls added      :', flora.flowers.batches.size);
