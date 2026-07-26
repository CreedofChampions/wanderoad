/* Wanderoad — forests, plains and flower beds, measured.
 *
 * The density fields in world/scatter.js only work if their AREA MEAN is 1: the biome table
 * says a hectare of meadow averages 26 trees, and it has to go on being true after the field
 * redistributes them. This reports that mean, the share of the world in each regime, and
 * then goes and counts real trees on real ground by running the real scatter — because a
 * field with the right mean can still put every tree in one place.
 *
 * node tools/diag-forests.mjs [seed]
 */

import {
  forestField, forestDensity, coverDensity, bloomFraction, scatterChunk, flowerBudget,
} from '../src/world/scatter.js';
import { biomeWeights, waterLevelAt, BIOME_SHORT } from '../src/world/biomes.js';
import { landHeight } from '../src/world/terrain.js';
import { nodeSize } from '../src/world/chunk.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const HA = 1e4;

/* ── field statistics over a big square of world ─────────────────────────────
 * 400x400 samples on a 40 m pitch = 16 km square, which is a dozen forest wavelengths and
 * plenty of climate. Stratified, not random: this has to be reproducible. */
const N = 400;
const PITCH = 40;
let sum = 0;
let cSum = 0;
let cAny = 0;
const bins = [0, 0, 0, 0]; // plain, thin, woodland, deep
const hist = new Array(24).fill(0);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = (i - N / 2) * PITCH;
    const z = (j - N / 2) * PITCH;
    const d = forestDensity(x, z, SEED);
    sum += d;
    if (d <= 0) bins[0]++;
    else if (d < 0.55) bins[1]++;
    else if (d < 1.6) bins[2]++;
    else bins[3]++;
    const f = forestField(x, z, SEED);
    const h = Math.min(23, Math.max(0, ((f + 1.2) * 10) | 0));
    hist[h]++;
    const c = coverDensity(x, z, SEED);
    cSum += c;
    if (c > 0.02) cAny++;
  }
}
const cells = N * N;
console.log(`--- density fields, seed ${SEED}, ${((N * PITCH) / 1000).toFixed(0)} km square ---`);
console.log('  forest multiplier mean :', (sum / cells).toFixed(3), '(must be ~1.00 or the biome table lies)');
console.log('  plain   (0 trees)      :', ((100 * bins[0]) / cells).toFixed(1) + '%');
console.log('  thin    (<0.55x)       :', ((100 * bins[1]) / cells).toFixed(1) + '%');
console.log('  woodland(0.55-1.6x)    :', ((100 * bins[2]) / cells).toFixed(1) + '%');
console.log('  forest  (>1.6x)        :', ((100 * bins[3]) / cells).toFixed(1) + '%');
console.log('  cover multiplier mean  :', (cSum / cells).toFixed(3), ' ground with any cover:', ((100 * cAny) / cells).toFixed(1) + '%');

/* ── find real ground of each kind ───────────────────────────────────────────
 * Scan a coarse grid for the best example of each regime that is also somewhere trees can
 * physically grow (a meadow, not a dune), then count what the scatter actually emits there.
 */
function tilesAt(x, z, level, span) {
  const size = nodeSize(level);
  const cx0 = Math.floor(x / size);
  const cz0 = Math.floor(z / size);
  const n = Math.max(1, Math.round(span / size));
  const out = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([cx0 + i, cz0 + j]);
  return { tiles: out, area: (n * size) * (n * size) };
}

/** Count props over `span` metres square of ground, at the finest scatter level. */
function census(x, z, span = 256) {
  const { tiles, area } = tilesAt(x, z, 0, span);
  const n = { trees: 0, bushes: 0, rocks: 0, flowers: 0, blooms: 0 };
  for (const [cx, cz] of tiles) {
    const s = scatterChunk({ cx, cz, level: 0, seed: SEED });
    n.trees += s.trees.length;
    n.bushes += s.bushes.length;
    n.rocks += s.rocks.length;
    n.flowers += s.flowers.length;
    n.blooms += s.flowers.filter((f) => f.kind !== 'tuft').length;
  }
  const ha = area / HA;
  return {
    ha,
    trees: n.trees / ha,
    bushes: n.bushes / ha,
    rocks: n.rocks / ha,
    flowers: n.flowers / ha,
    blooms: n.blooms / ha,
  };
}

/* Pick the sample points: the deepest forest, an honest thin wood and the emptiest plain.
 *
 * All three are held to the SAME kind of ground on purpose — meadow-dominant, dry, and the
 * field averaged over the whole census box rather than read at one corner. Both of those
 * cost a paragraph and are worth it: the first run of this tool picked a "dense forest" that
 * was a waterlogged meadow/wetland border, where the scatter's freeboard test throws every
 * tree away and the field looks broken when it is fine. Comparing a forest in the marsh
 * against a plain in the meadow measures the biome table and the water, not the field. */
const SPAN = 256;
function boxField(x, z) {
  let s = 0;
  for (let j = 0; j < 5; j++) {
    for (let i = 0; i < 5; i++) s += forestDensity(x + (i * SPAN) / 4, z + (j * SPAN) / 4, SEED);
  }
  return s / 25;
}
/** Metres of dry ground under the blended water plane — the scatter's own freeboard test. */
function freeboard(x, z) {
  const b = biomeWeights(x, z, SEED);
  const wy = waterLevelAt(b.w, -Infinity);
  return landHeight(x, z, SEED) - (wy === null ? -1e9 : wy);
}
let best = null;
let thin = null;
let plain = null;
let bed = null;
for (let j = -38; j <= 38; j++) {
  for (let i = -38; i <= 38; i++) {
    const x = i * SPAN;
    const z = j * SPAN;
    const b = biomeWeights(x, z, SEED);
    if (b.dominant !== 0) continue; // meadow, so the three samples share a base density
    if (freeboard(x + SPAN / 2, z + SPAN / 2) < 2.5) continue; // dry enough to hold a tree
    const d = boxField(x, z);
    if (!best || d > best.d) best = { x, z, d, biome: b.dominant };
    if (d > 0.25 && d < 0.55 && (!thin || Math.abs(d - 0.4) < Math.abs(thin.d - 0.4))) thin = { x, z, d, biome: b.dominant };
    if (d <= 0.001 && (!plain || forestField(x, z, SEED) < plain.f)) {
      plain = { x, z, d, f: forestField(x, z, SEED), biome: b.dominant };
    }
    const c = coverDensity(x, z, SEED) * bloomFraction(x, z, SEED);
    if (!bed || c > bed.c) bed = { x, z, c, d, biome: b.dominant };
  }
}

console.log('\n--- tree density on real ground (256 m square = 6.55 ha, level-0 scatter) ---');
for (const [label, p] of [['DENSE forest', best], ['THIN woodland', thin], ['OPEN plain', plain]]) {
  if (!p) {
    console.log(' ', label.padEnd(14), 'not found in the search box');
    continue;
  }
  const c = census(p.x, p.z);
  console.log(
    ` ${label.padEnd(14)} (${p.x}, ${p.z}) ${BIOME_SHORT[p.biome].padEnd(9)} field x${p.d.toFixed(2)} (box mean)` +
      `  trees/ha ${c.trees.toFixed(1).padStart(5)}  bushes/ha ${c.bushes.toFixed(1).padStart(5)}` +
      `  rocks/ha ${c.rocks.toFixed(1).padStart(4)}  flowers/ha ${c.flowers.toFixed(0).padStart(4)}` +
      ` (${c.blooms.toFixed(0)} in flower)`
  );
}

if (bed) {
  // A bed is tens of metres across, so a 64 m square already averages its core with the
  // plain grass around it. Quote both: the square, and a 16 m disc on the core itself —
  // the second is what you are actually looking at through the windscreen.
  const c = census(bed.x, bed.z, 64);
  const size = nodeSize(0);
  const cx0 = Math.floor(bed.x / size);
  const cz0 = Math.floor(bed.z / size);
  let core = 0;
  let coreBloom = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      for (const f of scatterChunk({ cx: cx0 + i, cz: cz0 + j, level: 0, seed: SEED }).flowers) {
        if (Math.hypot(f.x - bed.x, f.z - bed.z) > 16) continue;
        core++;
        if (f.kind !== 'tuft') coreBloom++;
      }
    }
  }
  const coreHa = (Math.PI * 16 * 16) / HA;
  console.log(
    `\n--- the densest flower bed found, at (${bed.x}, ${bed.z}) ---\n` +
      `  cover x${coverDensity(bed.x, bed.z, SEED).toFixed(2)}  bloom fraction ${bloomFraction(bed.x, bed.z, SEED).toFixed(2)}\n` +
      `  over 64 m square (0.41 ha): plants/ha ${c.flowers.toFixed(0)}, in flower ${c.blooms.toFixed(0)}\n` +
      `  over the 16 m core (0.08 ha): plants/ha ${(core / coreHa).toFixed(0)}, in flower ${(coreBloom / coreHa).toFixed(0)}` +
      `  (${(1 / Math.sqrt(core / coreHa / HA)).toFixed(1)} m apart)`
  );
}

/* ── flowers: what the renderer will actually be asked to draw ───────────────
 * The flower cull is a radius, so the honest figure is the instance count inside it. Walk a
 * long straight line and report the worst case as well as the average, because the worst
 * case is the frame that drops. */
console.log('\n--- flower instances inside a 190 m cull, walking 12 km ---');
const CULL = 190;
let worst = 0;
let worstAt = null;
let tot = 0;
let samples = 0;
for (let step = 0; step < 60; step++) {
  const px = -6000 + step * 200;
  const pz = 1300 + Math.sin(step * 0.21) * 900;
  const size = nodeSize(0);
  const r = Math.ceil(CULL / size);
  const cx0 = Math.floor(px / size);
  const cz0 = Math.floor(pz / size);
  let n = 0;
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const mx = (cx0 + i + 0.5) * size;
      const mz = (cz0 + j + 0.5) * size;
      if (Math.hypot(mx - px, mz - pz) > CULL + size) continue;
      const s = scatterChunk({ cx: cx0 + i, cz: cz0 + j, level: 0, seed: SEED });
      for (const f of s.flowers) if (Math.hypot(f.x - px, f.z - pz) <= CULL) n++;
    }
  }
  tot += n;
  samples++;
  if (n > worst) {
    worst = n;
    worstAt = [px, pz];
  }
}
console.log('  mean instances in view:', (tot / samples).toFixed(0));
console.log('  worst instances in view:', worst, 'at', worstAt.map((v) => v.toFixed(0)).join(', '));
console.log('  flowerBudget() per level-0 node:', flowerBudget());
console.log('  bloomFraction at that worst point:', bloomFraction(worstAt[0], worstAt[1], SEED).toFixed(2));
