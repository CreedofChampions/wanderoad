/* Wanderoad — do the seagulls actually exist, and are they actually near the water?
 *
 * The operator's ask was "birds -- seagulls -- visible around the map, especially near water",
 * and the audit that found nothing there was right: there was no birds module at all. This
 * tool answers the two questions that ask contains, over the REAL seeded world, with no
 * renderer:
 *
 *   1. COVERAGE — how many flocks and how many individual birds exist in a square of world,
 *      and how far apart they are. "Visible around the map" is a density statement.
 *   2. WATER BIAS — of the flocks that exist, how many are sea flocks, and how does the
 *      density of birds over water compare with the density over dry land. "Especially near
 *      water" is a ratio, and this prints it.
 *
 * It drives src/render/birds.js's own evaluateFlockSite() — the exact function the running
 * game calls — rather than a re-implementation, which is the only reason the numbers here
 * mean anything. Everything it prints is a real query against src/world.
 *
 *   node tools/diag-birds.mjs [seed] [halfSizeMetres]
 */

import { Object3D } from 'three';
import { Birds, evaluateFlockSite, TILE, RANGE, SEA_WET_MIN, SEA_ACCEPT_P, LAND_ACCEPT_P, MAX_BIRDS } from '../src/render/birds.js';
import { biomeWeights, waterLevelAt, BIOME_COUNT } from '../src/world/biomes.js';
import { landHeight } from '../src/world/terrain.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const HALF = parseInt(process.argv[3] ?? '', 10) || 6000;

const _w = new Float32Array(BIOME_COUNT);
const wetAt = (x, z) => {
  const b = biomeWeights(x, z, SEED, _w);
  const plane = waterLevelAt(b.w, -Infinity);
  return plane !== null && landHeight(x, z, SEED) < plane;
};

const g0 = Math.floor(-HALF / TILE);
const g1 = Math.floor(HALF / TILE);
const tiles = (g1 - g0 + 1) ** 2;

let flocks = 0;
let birds = 0;
let sea = 0;
let land = 0;
let seaBirds = 0;
let landBirds = 0;
const sites = [];

for (let gj = g0; gj <= g1; gj++) {
  for (let gi = g0; gi <= g1; gi++) {
    const f = evaluateFlockSite(gi, gj, SEED);
    if (!f) continue;
    flocks++;
    birds += f.birds.length;
    if (f.kind === 'sea') {
      sea++;
      seaBirds += f.birds.length;
    } else {
      land++;
      landBirds += f.birds.length;
    }
    sites.push(f);
  }
}

/* How much of this square is water at all — the denominator that turns "most flocks are sea
 * flocks" into a real statement about bias rather than a statement about the map. */
let wetSamples = 0;
const N = 160;
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = -HALF + ((i + 0.5) / N) * HALF * 2;
    const z = -HALF + ((j + 0.5) / N) * HALF * 2;
    if (wetAt(x, z)) wetSamples++;
  }
}
const wetFrac = wetSamples / (N * N);

const areaKm2 = ((HALF * 2) / 1000) ** 2;

console.log(`\nWanderoad — seagull placement, seed ${SEED}, ${(HALF * 2) / 1000} km square (${areaKm2.toFixed(1)} km2)\n`);
console.log(`  lattice                ${TILE} m tiles, ${tiles} evaluated`);
console.log(`  gates                  sea if >= ${(SEA_WET_MIN * 100).toFixed(0)}% of the two probe rings is wet`);
console.log(`  rarity                 sea ${SEA_ACCEPT_P}, land ${LAND_ACCEPT_P}`);
console.log(`  draw ceiling           ${MAX_BIRDS} birds\n`);
console.log(`  water in this square   ${(wetFrac * 100).toFixed(1)}%`);
console.log(`  flocks                 ${flocks}  (${sea} sea, ${land} land)`);
console.log(`  individual birds       ${birds}  (${seaBirds} sea, ${landBirds} land)`);
console.log(`  birds per km2          ${(birds / areaKm2).toFixed(2)}`);
console.log(`  share of birds at sea  ${birds ? ((seaBirds / birds) * 100).toFixed(1) : '0.0'}%`);
if (wetFrac > 0.001) {
  const bias = seaBirds / wetFrac / Math.max(landBirds / Math.max(1 - wetFrac, 0.001), 1e-6);
  console.log(`  water bias             ${bias.toFixed(1)}x  (birds per km2 of water vs per km2 of land)`);
}

/* What a driver actually sees: sweep the visible window along a straight 12 km line and
 * report how often at least one flock is inside RANGE. "Visible around the map" fails if the
 * answer is 4%. */
let withFlock = 0;
let sumBirds = 0;
const STEPS = 240;
for (let s = 0; s < STEPS; s++) {
  const x = -HALF + (s / (STEPS - 1)) * HALF * 2;
  const z = x * 0.31; // a diagonal, so the sample line is not axis-aligned with the lattice
  let n = 0;
  for (const f of sites) {
    if (Math.hypot(f.x - x, f.z - z) <= RANGE) n += f.birds.length;
  }
  if (n > 0) withFlock++;
  sumBirds += n;
}
console.log(`\n  along a 12 km diagonal drive (${STEPS} samples, ${RANGE} m view window):`);
console.log(`    frames with birds in range   ${((withFlock / STEPS) * 100).toFixed(1)}%`);
console.log(`    mean birds in range          ${(sumBirds / STEPS).toFixed(1)}`);

/* Determinism is not optional under src/world (and this file's placement obeys the same
 * rule even though it lives under src/render). Re-evaluate every accepted site and insist on
 * the identical answer — a single Math.random anywhere in the chain fails this. */
let stable = true;
for (const f of sites.slice(0, 200)) {
  const gi = Math.floor(f.x / TILE);
  const gj = Math.floor(f.z / TILE);
  const again = evaluateFlockSite(gi, gj, SEED);
  if (!again || again.x !== f.x || again.z !== f.z || again.birds.length !== f.birds.length) stable = false;
}

/* ── the part that matters: does anything actually get DRAWN ─────────────────
 * Placement statistics are not a bird on screen. This runs the real Birds class against a
 * real THREE scene graph, at a real coastal coordinate, and reads the geometry back — the
 * live vertex count, the draw range, and the spread of the positions actually written into
 * the buffer. The audit that raised this item did exactly that for the old code and got
 * zero, so a harness that stops at "the flock spec is non-null" would be answering a
 * different question than the one that was asked. */
const scene = new Object3D();
const live = new Birds({ seed: SEED, scene });
// Somewhere with water: reuse the busiest sample point the sweep above already found.
let busiest = { x: 0, z: 0, n: -1 };
for (let s = 0; s < STEPS; s++) {
  const x = -HALF + (s / (STEPS - 1)) * HALF * 2;
  const z = x * 0.31;
  let n = 0;
  for (const f of sites) if (Math.hypot(f.x - x, f.z - z) <= RANGE) n += f.birds.length;
  if (n > busiest.n) busiest = { x, z, n };
}
let drawnPeak = 0;
let minY = Infinity;
let maxY = -Infinity;
let allFinite = true;
let wingSpread = 0;
for (let f = 0; f < 180; f++) {
  live.update(1 / 60, busiest.x, busiest.z);
  drawnPeak = Math.max(drawnPeak, live.stats.drawn);
}
{
  const pos = live.geometry.attributes.position.array;
  const n = live.stats.drawn * 12; // VERTS_PER_BIRD
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1];
    if (!Number.isFinite(pos[i * 3]) || !Number.isFinite(y) || !Number.isFinite(pos[i * 3 + 2])) allFinite = false;
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  // A bird whose twelve vertices are all at one point is a bird that will not be seen.
  for (let b = 0; b < live.stats.drawn; b++) {
    const o = b * 12 * 3;
    let mn = Infinity;
    let mx = -Infinity;
    for (let v = 0; v < 12; v++) {
      mn = Math.min(mn, pos[o + v * 3]);
      mx = Math.max(mx, pos[o + v * 3]);
    }
    wingSpread = Math.max(wingSpread, mx - mn);
  }
}
const inScene = scene.children.some((c) => c.name === 'birds');
const range = live.geometry.drawRange;

console.log(`\n  a real scene at the busiest point on that line, (${busiest.x.toFixed(0)}, ${busiest.z.toFixed(0)}), after 3 s:`);
console.log(`    mesh in the scene graph      ${inScene ? "yes, named 'birds'" : 'NO'}`);
console.log(`    birds written to the buffer  ${live.stats.drawn} (peak ${drawnPeak})`);
console.log(`    index draw range             ${range.start}..${range.start + range.count} of ${live.geometry.index.count}`);
console.log(`    altitude band                ${minY.toFixed(1)} m to ${maxY.toFixed(1)} m`);
console.log(`    widest wingspan drawn        ${wingSpread.toFixed(2)} m`);

const checks = [
  ['flocks exist at all', flocks > 0, `${flocks} flocks`],
  ['the mesh is really in the scene graph', inScene, inScene ? "scene child named 'birds'" : 'not added'],
  ['birds are actually written into the geometry', live.stats.drawn > 0, `${live.stats.drawn} drawn`],
  ['...and the draw range covers them', range.count === live.stats.drawn * 24, `${range.count} indices for ${live.stats.drawn} birds`],
  ['every vertex is finite', allFinite, `${live.stats.drawn * 12} vertices checked`],
  ['the birds have real wingspans, not degenerate points', wingSpread > 0.3, `${wingSpread.toFixed(2)} m`],
  ['they are in the air, not in the ground', minY > 0, `lowest vertex ${minY.toFixed(1)} m`],
  ['most birds are over water', seaBirds > landBirds, `${seaBirds} sea vs ${landBirds} land`],
  ['birds are in view for most of a drive', withFlock / STEPS > 0.5, `${((withFlock / STEPS) * 100).toFixed(1)}% of samples`],
  ['a full view window never exceeds the draw ceiling by much', sumBirds / STEPS < MAX_BIRDS, `mean ${(sumBirds / STEPS).toFixed(1)} of ${MAX_BIRDS}`],
  ['placement is deterministic', stable, 're-evaluated 200 sites'],
];

console.log('');
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`);
  if (!ok) failed++;
}
console.log(`\n${failed === 0 ? 'all checks passed' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
