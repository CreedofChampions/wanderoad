/* Wanderoad — seeds 28, 155 and 177 fail bench-props.mjs's "props per km of road" (0.4..3.2)
 * and/or "cans per km of road" (0.9..2.8) ceilings. Investigating BACKLOG.md's own flagged
 * open item: is this the SAME root cause as the already-fixed "added draw calls"/"sample size"
 * checks (a ceiling calibrated by eyeballing one seed and never swept), or do these seeds
 * reveal an actual SLOT_P/CAN_SLOT_P tuning problem — e.g. a road-tier or biome mix that
 * legitimately over-produces?
 *
 *   node tools/diag-perkm.mjs [seedCount] [startSeed]
 *
 * Reproduces bench-props.mjs's "rarity" 4x4 km fixed sweep EXACTLY (same box, same tiling) for
 * BOTH propsInBox and fuelCansInBox, across several hundred seeds, and additionally measures
 * the two mechanisms that could plausibly drive a seed's rate up on purpose rather than by
 * chance: the road-tier mix inside the box (SLOT_P/CAN_SLOT_P are both luckier on tier-1 lane
 * road than tier-0 arterial) and the biome-area mix (sampled independently of the road network,
 * since several prop kinds and the cans' water rule treat wet/dry ground differently). Prints
 * mean/sd/min/max, failure rate against the current ceilings, correlations against both
 * candidate mechanisms, and a full rejection-tally breakdown for the three flagged seeds.
 */
import { propsInBox, fuelCansInBox } from '../src/world/props.js';
import { Terrain } from '../src/world/terrain.js';
import { waterLevelAt, BIOME_COUNT, BIOME_NAMES } from '../src/world/biomes.js';
import { edgesInBox } from '../src/world/roads.js';

const N_SEEDS = parseInt(process.argv[2] ?? '', 10) || 500;
const START = process.argv[3] !== undefined ? parseInt(process.argv[3], 10) : 0;
const FLAGGED = [28, 155, 177]; // the seeds bench-props.mjs actually fails on today
const EXTRA = [20260726, 1, 2, 3, 4, 5, ...FLAGGED]; // the six canonical seeds + the flagged ones
const TILE = 512;
const N = 8; // 8x8 contiguous 512 m tiles, byte-identical to bench-props.mjs's sweep

// The ceilings under investigation, read from tools/bench-props.mjs verbatim.
const PROP_BAND = [0.4, 3.2];
const CAN_BAND = [0.9, 2.8];

const wArr = new Float32Array(BIOME_COUNT);
function probeFor(terr) {
  return {
    site: (x, z) => {
      const b = terr.weights(x, z);
      wArr.set(b.w);
      return { y: terr.height(x, z), dominant: b.dominant, wy: waterLevelAt(wArr, -Infinity) };
    },
    height: (x, z) => terr.height(x, z),
  };
}

/** Exactly bench-props.mjs's "rarity" 4x4 km fixed sweep, for both props and cans at once,
 *  plus tier-metres and an independent biome-area sample. */
function sweepSeed(seed) {
  let props = [];
  let cans = [];
  const pstats = {};
  const cstats = {};
  const biomeArea = new Array(BIOME_COUNT).fill(0);
  let biomeSamples = 0;
  const tiles = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const ox = i * TILE;
      const oz = j * TILE;
      const terr = new Terrain(seed, ox, oz, ox + TILE, oz + TILE, 40);
      const probe = probeFor(terr);
      props = props.concat(propsInBox(ox, oz, ox + TILE, oz + TILE, seed, probe, pstats));
      cans = cans.concat(fuelCansInBox(ox, oz, ox + TILE, oz + TILE, seed, probe, cstats));
      // Biome AREA, sampled on a fixed grid independent of where the road happens to run —
      // the road-anchored props/cans arrays above are the wrong instrument to ask "is this
      // seed's land mostly one biome", because they are already filtered by acceptance.
      for (const fx of [0.17, 0.5, 0.83]) {
        for (const fz of [0.17, 0.5, 0.83]) {
          const b = terr.weights(ox + fx * TILE, oz + fz * TILE);
          biomeArea[b.dominant]++;
          biomeSamples++;
        }
      }
      tiles.push({ ox, oz });
    }
  }
  let roadMetres = 0;
  let laneMetres = 0;
  for (const t of tiles) {
    for (const e of edgesInBox(t.ox, t.oz, t.ox + TILE, t.oz + TILE, seed, 0)) {
      let inside = 0;
      for (let k = 2; k < e.pts.length; k += 2) {
        const seg = Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]);
        const mx = (e.pts[k] + e.pts[k - 2]) * 0.5;
        const mz = (e.pts[k + 1] + e.pts[k - 1]) * 0.5;
        if (mx >= t.ox && mx < t.ox + TILE && mz >= t.oz && mz < t.oz + TILE) inside += seg;
      }
      roadMetres += inside;
      if (e.tier === 1) laneMetres += inside;
    }
  }
  const propBiome = new Array(BIOME_COUNT).fill(0);
  for (const p of props) propBiome[p.dominant]++;
  const canBiome = new Array(BIOME_COUNT).fill(0);
  for (const c of cans) canBiome[c.dominant]++;
  return {
    seed,
    roadMetres,
    laneFrac: laneMetres / roadMetres,
    props: props.length,
    perKm: (props.length / roadMetres) * 1000,
    pstats,
    propBiome,
    cans: cans.length,
    canPerKm: (cans.length / roadMetres) * 1000,
    cstats,
    canBiome,
    biomeArea: biomeArea.map((n) => n / biomeSamples),
  };
}

function stat(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, sd: Math.sqrt(variance), min: Math.min(...arr), max: Math.max(...arr) };
}

function corr(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : 0;
}

const seedSet = new Set([...EXTRA, ...Array.from({ length: N_SEEDS }, (_, i) => (START + i) >>> 0)]);
const seeds = [...seedSet];
console.log(`sweeping ${seeds.length} seeds (${N_SEEDS} from ${START}, plus ${EXTRA.length} canonical/flagged)\n`);
console.log(`seed        perKm  canPerKm  laneFrac  candP  placedP  candC  placedC  roadKm`);
const rows = [];
for (const seed of seeds) {
  const r = sweepSeed(seed);
  rows.push(r);
  const flag = FLAGGED.includes(r.seed) ? ' <== FLAGGED' : '';
  console.log(
    `${String(r.seed).padEnd(11)} ${r.perKm.toFixed(2).padStart(5)}  ${r.canPerKm.toFixed(2).padStart(8)}  ` +
    `${r.laneFrac.toFixed(2).padStart(8)}  ${String(r.pstats.candidates || 0).padStart(5)}  ${String(r.pstats.placed || 0).padStart(7)}  ` +
    `${String(r.cstats.candidates || 0).padStart(5)}  ${String(r.cstats.placed || 0).padStart(7)}  ${(r.roadMetres / 1000).toFixed(2).padStart(6)}${flag}`
  );
}

const perKm = rows.map((r) => r.perKm);
const canPerKm = rows.map((r) => r.canPerKm);
const laneFrac = rows.map((r) => r.laneFrac);
const ps = stat(perKm);
const cs = stat(canPerKm);
const propFailLo = perKm.filter((v) => v <= PROP_BAND[0]).length;
const propFailHi = perKm.filter((v) => v >= PROP_BAND[1]).length;
const canFailLo = canPerKm.filter((v) => v <= CAN_BAND[0]).length;
const canFailHi = canPerKm.filter((v) => v >= CAN_BAND[1]).length;

console.log(`\n${rows.length} seeds swept\n`);
console.log(`perKm    : mean ${ps.mean.toFixed(2)}  sd ${ps.sd.toFixed(2)}  min ${ps.min.toFixed(2)}  max ${ps.max.toFixed(2)}   ` +
  `band ${PROP_BAND[0]}..${PROP_BAND[1]}   fail-lo ${propFailLo}  fail-hi ${propFailHi}  (${(100 * (propFailLo + propFailHi) / rows.length).toFixed(1)}%)`);
console.log(`canPerKm : mean ${cs.mean.toFixed(2)}  sd ${cs.sd.toFixed(2)}  min ${cs.min.toFixed(2)}  max ${cs.max.toFixed(2)}   ` +
  `band ${CAN_BAND[0]}..${CAN_BAND[1]}   fail-lo ${canFailLo}  fail-hi ${canFailHi}  (${(100 * (canFailLo + canFailHi) / rows.length).toFixed(1)}%)`);

// Candidate mechanisms for a high seed: more lane-tier road (both SLOT_P and CAN_SLOT_P are
// luckier on tier 1), or a specific biome dominating the box's area.
console.log(`\ncorr(perKm, laneFrac)    = ${corr(perKm, laneFrac).toFixed(3)}`);
console.log(`corr(canPerKm, laneFrac) = ${corr(canPerKm, laneFrac).toFixed(3)}`);
for (let b = 0; b < BIOME_COUNT; b++) {
  const area = rows.map((r) => r.biomeArea[b]);
  console.log(`corr(perKm, ${BIOME_NAMES[b].padEnd(16)} area) = ${corr(perKm, area).toFixed(3)}   corr(canPerKm, same) = ${corr(canPerKm, area).toFixed(3)}`);
}

// Rejection-rate mechanisms: is a high seed high because more candidates are GENERATED, or
// because fewer of them are REJECTED?
const candPerKmP = rows.map((r) => ((r.pstats.candidates || 0) / r.roadMetres) * 1000);
const yieldP = rows.map((r) => (r.pstats.placed || 0) / Math.max(1, r.pstats.candidates || 0));
const candPerKmC = rows.map((r) => ((r.cstats.candidates || 0) / r.roadMetres) * 1000);
const yieldC = rows.map((r) => (r.cstats.placed || 0) / Math.max(1, r.cstats.candidates || 0));
console.log(`\ncorr(perKm, prop candidates/km)  = ${corr(perKm, candPerKmP).toFixed(3)}   corr(perKm, prop yield)  = ${corr(perKm, yieldP).toFixed(3)}`);
console.log(`corr(canPerKm, can candidates/km) = ${corr(canPerKm, candPerKmC).toFixed(3)}   corr(canPerKm, can yield) = ${corr(canPerKm, yieldC).toFixed(3)}`);

// Which specific rejection test is being avoided on a high-yield seed? Rate, not raw count,
// so a seed with fewer candidates overall does not look artificially "less rejected".
const rateP = (r, key) => (r.pstats[key] || 0) / Math.max(1, r.pstats.candidates || 0);
const rateC = (r, key) => (r.cstats[key] || 0) / Math.max(1, r.cstats.candidates || 0);
for (const key of ['rejectRoad', 'rejectWater', 'rejectSlope']) {
  const pr = rows.map((r) => rateP(r, key));
  const cr = rows.map((r) => rateC(r, key));
  console.log(`corr(perKm, prop ${key} rate) = ${corr(perKm, pr).toFixed(3)}   corr(canPerKm, can ${key} rate) = ${corr(canPerKm, cr).toFixed(3)}`);
}

// Full breakdown for the flagged seeds, plus whatever the sweep itself found worse — if 28,
// 155, 177 are not even the extreme tail of this distribution, that alone says they are not a
// special case that needs retuning, just where the existing suite happens to sample.
function dump(r) {
  const p = r.pstats, c = r.cstats;
  console.log(`\n── seed ${r.seed} ──────────────────────────────────────────`);
  console.log(`  roadKm ${(r.roadMetres / 1000).toFixed(2)}  laneFrac ${r.laneFrac.toFixed(3)}`);
  console.log(`  biome area  : ${BIOME_NAMES.map((n, i) => `${n} ${(r.biomeArea[i] * 100).toFixed(0)}%`).join('  ')}`);
  console.log(`  props  : ${r.props} over ${(r.roadMetres / 1000).toFixed(2)} km = ${r.perKm.toFixed(2)}/km` +
    `   candidates ${p.candidates || 0}  outsideBox ${p.outsideBox || 0}  rejectRoad ${p.rejectRoad || 0}  rejectWater ${p.rejectWater || 0}  rejectSlope ${p.rejectSlope || 0}  placed ${p.placed || 0}`);
  console.log(`  prop biome  : ${BIOME_NAMES.map((n, i) => `${n} ${r.propBiome[i]}`).join('  ')}`);
  console.log(`  cans   : ${r.cans} over ${(r.roadMetres / 1000).toFixed(2)} km = ${r.canPerKm.toFixed(2)}/km` +
    `   candidates ${c.candidates || 0}  outsideBox ${c.outsideBox || 0}  rejectRoad ${c.rejectRoad || 0}  rejectWater ${c.rejectWater || 0}  rejectSlope ${c.rejectSlope || 0}  placed ${c.placed || 0}`);
  console.log(`  can biome   : ${BIOME_NAMES.map((n, i) => `${n} ${r.canBiome[i]}`).join('  ')}`);
}

console.log(`\n════ flagged seeds (what bench-props.mjs actually fails on today) ════`);
for (const s of FLAGGED) {
  const r = rows.find((x) => x.seed === s);
  if (r) dump(r);
}

const worstProp = [...rows].sort((a, b) => b.perKm - a.perKm).slice(0, 5);
const worstCan = [...rows].sort((a, b) => b.canPerKm - a.canPerKm).slice(0, 5);
console.log(`\n════ top 5 by perKm in the sweep ════`);
for (const r of worstProp) console.log(`  seed ${String(r.seed).padEnd(9)} perKm ${r.perKm.toFixed(2)}  laneFrac ${r.laneFrac.toFixed(2)}  dominant biome area ${BIOME_NAMES[r.biomeArea.indexOf(Math.max(...r.biomeArea))]}`);
console.log(`\n════ top 5 by canPerKm in the sweep ════`);
for (const r of worstCan) console.log(`  seed ${String(r.seed).padEnd(9)} canPerKm ${r.canPerKm.toFixed(2)}  laneFrac ${r.laneFrac.toFixed(2)}  dominant biome area ${BIOME_NAMES[r.biomeArea.indexOf(Math.max(...r.biomeArea))]}`);
