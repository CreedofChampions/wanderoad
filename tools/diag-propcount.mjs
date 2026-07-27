/* Wanderoad — why do bench-props.mjs's "added draw calls <= 25" and "sample size > 40"
 * checks fail on seeds 3 and 5? Investigating BACKLOG.md's own open item: both were only ever
 * validated against the default seed (20260726) before being written down as fixed ceilings/
 * floors, and never swept across the seeds the rest of this project's checks are held to.
 *
 *   node tools/diag-propcount.mjs [seedCount] [startSeed]
 *
 * Reproduces bench-props.mjs's two measurements EXACTLY (same window-fill code for the tile/
 * draw-call count, same 4x4 km fixed sweep for the sample-size count) across a real spread of
 * seeds, plus a per-candidate rejection tally so a low sample count can be attributed to an
 * actual cause (fewer road candidates in this fixed box vs. harsher freeboard/slope rejection)
 * instead of guessed at.
 */
import { Object3D } from 'three';
import { propsInBox } from '../src/world/props.js';
import { Props } from '../src/render/props.js';
import { Terrain } from '../src/world/terrain.js';
import { waterLevelAt, BIOME_COUNT } from '../src/world/biomes.js';
import { edgesInBox } from '../src/world/roads.js';

const N_SEEDS = parseInt(process.argv[2] ?? '', 10) || 40;
const START = process.argv[3] !== undefined ? parseInt(process.argv[3], 10) : 0;
const EXTRA = [20260726]; // the project's own default seed, always included
const TILE_SWEEP = 512;
const N = 8; // 8x8 contiguous 512 m tiles, byte-identical to bench-props.mjs's sweep

const w = new Float32Array(BIOME_COUNT);
function probeFor(terr) {
  return {
    site: (x, z) => {
      const b = terr.weights(x, z);
      w.set(b.w);
      const y = terr.height(x, z);
      return { y, dominant: b.dominant, wy: waterLevelAt(w, -Infinity) };
    },
    height: (x, z) => terr.height(x, z),
  };
}

/** Exactly bench-props.mjs's "frame cost" window-fill: warm, then fill a fresh Props at (0,0)
 *  and count non-empty tiles (`meshes`, one draw call each) the same way the bench does. */
function meshCount(seed) {
  const scene = new Object3D();
  const warm = new Props({ seed, scene, solids: null });
  warm.update(1 / 60, -40000, -40000);
  while (warm.stats.backlog > 0) warm.update(1 / 60, -40000, -40000);
  warm.dispose();

  const props = new Props({ seed, scene, solids: null });
  props.update(1 / 60, 0, 0);
  let frames = 0;
  while (props.stats.backlog > 0 && frames < 4000) {
    props.update(1 / 60, 0, 0);
    frames++;
  }
  let meshes = 0;
  for (const rec of props.live.values()) if (rec.mesh) meshes++;
  const tiles = props.stats.tiles;
  props.dispose();
  return { meshes, tiles };
}

/** Exactly bench-props.mjs's "rarity" 4x4 km fixed sweep — same box, same tiling — plus a
 *  rejection tally propsInBox will fill in when given a stats bag. */
function sweepSample(seed) {
  let props = [];
  let roadMetres = 0;
  const stats = {};
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const ox = i * TILE_SWEEP;
      const oz = j * TILE_SWEEP;
      const terr = new Terrain(seed, ox, oz, ox + TILE_SWEEP, oz + TILE_SWEEP, 40);
      const probe = probeFor(terr);
      const list = propsInBox(ox, oz, ox + TILE_SWEEP, oz + TILE_SWEEP, seed, probe, stats);
      props = props.concat(list);
      for (const e of edgesInBox(ox, oz, ox + TILE_SWEEP, oz + TILE_SWEEP, seed, 0)) {
        let inside = 0;
        for (let k = 2; k < e.pts.length; k += 2) {
          const seg = Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]);
          const mx = (e.pts[k] + e.pts[k - 2]) * 0.5;
          const mz = (e.pts[k + 1] + e.pts[k - 1]) * 0.5;
          if (mx >= ox && mx < ox + TILE_SWEEP && mz >= oz && mz < oz + TILE_SWEEP) inside += seg;
        }
        roadMetres += inside;
      }
    }
  }
  return { count: props.length, roadMetres, perKm: (props.length / roadMetres) * 1000, stats };
}

function stat(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(variance), min: Math.min(...arr), max: Math.max(...arr) };
}

const seeds = [...EXTRA, ...Array.from({ length: N_SEEDS }, (_, i) => START + i)];
const rows = [];
console.log(`seed        meshes  tiles   sample  roadKm  perKm   candidates rejRoad rejWater rejSlope placed`);
for (const seed of seeds) {
  const mc = meshCount(seed >>> 0);
  const sw = sweepSample(seed >>> 0);
  const s = sw.stats;
  rows.push({ seed, ...mc, ...sw });
  console.log(
    `${String(seed).padEnd(11)} ${String(mc.meshes).padStart(6)}  ${String(mc.tiles).padStart(5)}  ` +
    `${String(sw.count).padStart(6)}  ${(sw.roadMetres / 1000).toFixed(2).padStart(6)}  ${sw.perKm.toFixed(2).padStart(5)}   ` +
    `${String(s.candidates || 0).padStart(10)} ${String(s.rejectRoad || 0).padStart(7)} ${String(s.rejectWater || 0).padStart(8)} ${String(s.rejectSlope || 0).padStart(8)} ${String(s.placed || 0).padStart(6)}`
  );
}

const meshes = rows.map((r) => r.meshes);
const counts = rows.map((r) => r.count);
const roadKm = rows.map((r) => r.roadMetres / 1000);
const perKm = rows.map((r) => r.perKm);
const ms = stat(meshes);
const cs = stat(counts);
const rs = stat(roadKm);
const ps = stat(perKm);

console.log(`\n${rows.length} seeds swept (${seeds.join(',')})\n`);
console.log(`meshes   : mean ${ms.mean.toFixed(2)}  sd ${ms.sd.toFixed(2)}  min ${ms.min}  max ${ms.max}   ` +
  `fail(<=25): ${meshes.filter((m) => m > 25).length}/${rows.length}`);
console.log(`sample   : mean ${cs.mean.toFixed(2)}  sd ${cs.sd.toFixed(2)}  min ${cs.min}  max ${cs.max}   ` +
  `fail(>40): ${counts.filter((c) => c <= 40).length}/${rows.length}`);
console.log(`roadKm   : mean ${rs.mean.toFixed(2)}  sd ${rs.sd.toFixed(2)}  min ${rs.min.toFixed(2)}  max ${rs.max.toFixed(2)}`);
console.log(`perKm    : mean ${ps.mean.toFixed(2)}  sd ${ps.sd.toFixed(2)}  min ${ps.min.toFixed(2)}  max ${ps.max.toFixed(2)}   (acceptance band is 0.4 .. 3.2)`);

// Pearson correlation: is a low sample count explained by low road-km in this fixed box
// (an instrument artefact, same class as diag-stations.mjs's box-vs-real-route finding) or by
// a low per-km rate (an actual rarity/rejection effect)?
function corr(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}
console.log(`\ncorr(sample count, roadKm)  = ${corr(counts, roadKm).toFixed(3)}`);
console.log(`corr(sample count, perKm)   = ${corr(counts, perKm).toFixed(3)}`);
console.log(`corr(roadKm, perKm)         = ${corr(roadKm, perKm).toFixed(3)}  (near 0 expected if independent)`);
