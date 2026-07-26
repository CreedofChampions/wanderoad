/* Where do the cliffs come from? Sample a big area, find the steepest points, and report
 * what is true at each one: which biomes, how fast the biome mix is changing, and whether a
 * road carve is nearby. Guessing at this has already cost two rounds. */
import { Terrain, landHeight } from '../src/world/terrain.js';
import { biomeWeights, BIOME_NAMES, BIOME_TERRAIN, BIOME_COUNT } from '../src/world/biomes.js';

const SEED = 20260726;
const R = 1200, STEP = 4;
const T = new Terrain(SEED, -R, -R, R, R);
const hits = [];
let hist = new Array(10).fill(0);

for (let x = -R; x < R; x += STEP) {
  for (let z = -R; z < R; z += STEP) {
    const n = T.normal(x, z, 2.5);
    const deg = Math.acos(Math.min(1, n[1])) * 57.2958;
    hist[Math.min(9, Math.floor(deg / 10))]++;
    if (deg > 45) hits.push({ x, z, deg });
  }
}
hits.sort((a, b) => b.deg - a.deg);
console.log('slope histogram (deg):', hist.map((c, i) => `${i * 10}-${i * 10 + 10}:${c}`).join(' '));
console.log(`points over 45°: ${hits.length} of ${Math.pow((2 * R) / STEP, 2)} (${(100 * hits.length / Math.pow((2 * R) / STEP, 2)).toFixed(3)}%)\n`);

const w = new Float32Array(BIOME_COUNT);
for (const h of hits.slice(0, 12)) {
  const b = biomeWeights(h.x, h.z, SEED, w);
  const mix = [...w].map((v, i) => (v > 0.08 ? `${BIOME_NAMES[i].split(' ')[1] || BIOME_NAMES[i]}:${v.toFixed(2)}` : null)).filter(Boolean).join(' ');
  // how fast is the mix changing here?
  const w2 = new Float32Array(BIOME_COUNT);
  biomeWeights(h.x + 8, h.z, SEED, w2);
  let dw = 0;
  for (let i = 0; i < BIOME_COUNT; i++) dw += Math.abs(w2[i] - w[i]);
  const road = T.roads.query(h.x, h.z);
  const raw = landHeight(h.x, h.z, SEED);
  const carved = T.height(h.x, h.z);
  console.log(
    `${h.deg.toFixed(0).padStart(3)}°  (${String(Math.round(h.x)).padStart(6)},${String(Math.round(h.z)).padStart(6)})  ` +
      `dMix/8m ${dw.toFixed(3)}  roadDist ${(isFinite(road.d) ? road.d.toFixed(0) : '  -').padStart(4)}  ` +
      `raw ${raw.toFixed(1).padStart(7)}  carved ${carved.toFixed(1).padStart(7)}  ${mix}`
  );
}

// Is it the carve or the land?
let steepRaw = 0, steepCarved = 0;
for (let i = 0; i < 4000; i++) {
  const x = ((i * 7919) % (2 * R)) - R, z = ((i * 104729) % (2 * R)) - R;
  const gRaw = Math.atan2(Math.abs(landHeight(x + 2, z, SEED) - landHeight(x - 2, z, SEED)), 4) * 57.3;
  const gCar = Math.atan2(Math.abs(T.height(x + 2, z) - T.height(x - 2, z)), 4) * 57.3;
  if (gRaw > 45) steepRaw++;
  if (gCar > 45) steepCarved++;
}
console.log(`\nover 45° in 4000 random samples:  raw land ${steepRaw}   after road carve ${steepCarved}`);
