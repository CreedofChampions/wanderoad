/* Wanderoad — do roads go AROUND lakes, or straight across them?
 *
 * The operator, verbatim: "we should have roads that go around the lake, not through it
 * necessarily... in the wetlands we could still continue to go through, but the way we're
 * doing it now is not correct."
 *
 * `diag-water.mjs` already answers a DIFFERENT question — is the road deck under the water —
 * and it answers it with a clean 0. A causeway is not underwater. It is a road correctly
 * lifted 1.1 m clear of a lake it should never have been built across in the first place.
 * This tool measures the thing that is actually wrong: how many METRES of road run over
 * FLOODED GROUND, split by whether the local biome is wetland (where a causeway is the right
 * answer and reads beautifully) or not (where it is a two-kilometre embankment with open
 * water on both horizons).
 *
 * Everything is measured on the real network through `edgesInBox`, at the real polyline
 * samples the renderer and the carve both read, against `waterFn` — the identical function
 * `profileEdge` uses to decide the road's own water floor. No second opinion about where the
 * water is.
 *
 *   node tools/diag-causeway.mjs [seed]
 */

import { edgesInBox } from '../src/world/roads.js';
import { waterFn, findSpawn } from '../src/world/terrain.js';
import { biomeWeights, BIOME } from '../src/world/biomes.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const water = waterFn(SEED);
const _w = new Float32Array(5);

/* The audit's box: 144 km² around the default spawn — 12 km on a side. Same box every run so
 * a before/after diff means something. */
const HALF = 6000;
const spawn = findSpawn(SEED, 0, 0);
const CX = Math.round(spawn.x),
  CZ = Math.round(spawn.z);

console.log(`=== roads over water — seed ${SEED} ===`);
console.log(`spawn (${CX}, ${CZ}); box ${(HALF * 2) / 1000} km square around it\n`);

const edges = edgesInBox(CX - HALF, CZ - HALF, CX + HALF, CZ + HALF, SEED, 0);

const inBox = (x, z) => x >= CX - HALF && x <= CX + HALF && z >= CZ - HALF && z <= CZ + HALF;

let total = 0;
let wet = 0;
let wetMarsh = 0;
let wetOpen = 0;
const runs = []; // contiguous non-wetland over-water stretches

for (const e of edges) {
  const n = e.pts.length / 2;
  let run = 0,
    runStartX = 0,
    runStartZ = 0;
  for (let k = 0; k < n - 1; k++) {
    const ax = e.pts[k * 2],
      az = e.pts[k * 2 + 1];
    const bx = e.pts[k * 2 + 2],
      bz = e.pts[k * 2 + 3];
    if (!inBox(ax, az)) {
      run = 0;
      continue;
    }
    const len = Math.hypot(bx - ax, bz - az);
    total += len;
    const mx = (ax + bx) * 0.5,
      mz = (az + bz) * 0.5;
    const flooded = water(mx, mz) !== null;
    if (!flooded) {
      if (run > 0) runs.push({ len: run, x: runStartX, z: runStartZ, tier: e.tier, key: e.key });
      run = 0;
      continue;
    }
    wet += len;
    const b = biomeWeights(mx, mz, SEED, _w);
    const marsh = b.w[BIOME.WETLAND];
    if (marsh >= 0.4) {
      wetMarsh += len;
      if (run > 0) runs.push({ len: run, x: runStartX, z: runStartZ, tier: e.tier, key: e.key });
      run = 0;
    } else {
      wetOpen += len;
      if (run === 0) {
        runStartX = ax;
        runStartZ = az;
      }
      run += len;
    }
  }
  if (run > 0) runs.push({ len: run, x: runStartX, z: runStartZ, tier: e.tier, key: e.key });
}

runs.sort((a, b) => b.len - a.len);
const long = runs.filter((r) => r.len > 150);

const km = (m) => (m / 1000).toFixed(2);
console.log(`edges in box                 ${edges.length}`);
console.log(`total road length            ${km(total)} km`);
console.log(`over flooded ground          ${km(wet)} km  (${((wet / total) * 100).toFixed(2)}%)`);
console.log(`  ...in WETLAND (correct)    ${km(wetMarsh)} km`);
console.log(`  ...in open water (WRONG)   ${km(wetOpen)} km  (${((wetOpen / total) * 100).toFixed(2)}%)`);
console.log(`non-wetland causeway runs >150 m: ${long.length}`);
console.log(`longest non-wetland causeway:     ${runs.length ? runs[0].len.toFixed(0) : 0} m`);
if (runs.length) {
  console.log('\nworst 8 runs:');
  for (const r of runs.slice(0, 8)) {
    console.log(`  ${r.len.toFixed(0).padStart(6)} m  from (${r.x.toFixed(0)}, ${r.z.toFixed(0)})  tier${r.tier} ${r.key}`);
  }
}

/* ── the road you actually meet: straight out of the default spawn ─────────────────────── */
console.log('\n--- the first 4 km of arterial out of spawn ---');
{
  const f = edgesInBox(CX - 4000, CZ - 4000, CX + 4000, CZ + 4000, SEED, 0).filter((e) => e.tier === 0);
  let best = null;
  for (const e of f) {
    const n = e.pts.length / 2;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(e.pts[k * 2] - CX, e.pts[k * 2 + 1] - CZ);
      if (!best || d < best.d) best = { d, e, k };
    }
  }
  if (!best) console.log('  no arterial near spawn (?)');
  else {
    let travelled = 0,
      overWater = 0,
      firstWet = -1;
    const e = best.e;
    const n = e.pts.length / 2;
    for (let k = best.k; k < n - 1 && travelled < 4000; k++) {
      const ax = e.pts[k * 2],
        az = e.pts[k * 2 + 1];
      const bx = e.pts[k * 2 + 2],
        bz = e.pts[k * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const mx = (ax + bx) * 0.5,
        mz = (az + bz) * 0.5;
      if (water(mx, mz) !== null) {
        const b = biomeWeights(mx, mz, SEED, _w);
        if (b.w[BIOME.WETLAND] < 0.4) {
          overWater += len;
          if (firstWet < 0) firstWet = travelled;
        }
      }
      travelled += len;
    }
    console.log(`  edge ${e.key}: ${overWater.toFixed(0)} m of the first ${travelled.toFixed(0)} m is non-wetland causeway`);
    console.log(`  first open water at ${firstWet < 0 ? 'never' : firstWet.toFixed(0) + ' m'}`);
  }
}

const PASS = wetOpen < 5000;
console.log(`\n${PASS ? 'PASS' : 'FAIL'} — non-wetland over-water road ${km(wetOpen)} km (bar: under 5.00 km)`);
process.exit(PASS ? 0 : 1);
