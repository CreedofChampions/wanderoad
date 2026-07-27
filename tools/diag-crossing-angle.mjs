/* Wanderoad — how square are road junctions?
 *
 * The operator: "When two roads intersect, they must intersect at a 90 degree angle, no other
 * way, and they should have a proper junction." This walks a real generated area, finds every
 * point where two DIFFERENT edges' polylines actually cross, and measures the angle between
 * their tangents AT the crossing point. 90 deg is a perfect right angle; 0 deg is two roads
 * running parallel through the same point (the worst case, and geometrically the hardest to
 * square up without an ugly kink).
 *
 * Run before a fix and after it, on the SAME seed and boxes, and diff the two histograms.
 *
 *   node tools/diag-crossing-angle.mjs
 */
import { edgesInBox, findCrossings, TIERS } from '../src/world/roads.js';

const SEED = 20260726;

function angleStats(edges, label) {
  const crossings = findCrossings(edges);

  const buckets = { '<=1': 0, '<=2': 0, '<=5': 0, '<=10': 0, '<=20': 0, '<=45': 0, '>45': 0 };
  const bump = (dev) => {
    if (dev <= 1) buckets['<=1']++;
    else if (dev <= 2) buckets['<=2']++;
    else if (dev <= 5) buckets['<=5']++;
    else if (dev <= 10) buckets['<=10']++;
    else if (dev <= 20) buckets['<=20']++;
    else if (dev <= 45) buckets['<=45']++;
    else buckets['>45']++;
  };

  let sameTier = [];
  let crossTier = [];
  let sum = 0;
  const worst = [];

  for (const c of crossings) {
    bump(c.deviationDeg);
    sum += c.deviationDeg;
    (c.a.tier === c.b.tier ? sameTier : crossTier).push(c.deviationDeg);
    worst.push(c);
  }
  worst.sort((a, b) => b.deviationDeg - a.deviationDeg);

  const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : NaN);
  const median = (arr) => {
    if (!arr.length) return NaN;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  console.log(`\n── ${label} ──────────────────────────────────────────────`);
  console.log(`total crossings found: ${crossings.length}  (same-tier ${sameTier.length}, cross-tier ${crossTier.length})`);
  console.log(
    `deviation from 90°: mean ${mean(crossings.map((c) => c.deviationDeg)).toFixed(2)}°  ` +
      `median ${median(crossings.map((c) => c.deviationDeg)).toFixed(2)}°  ` +
      `worst ${crossings.length ? worst[0].deviationDeg.toFixed(2) : 'n/a'}°`
  );
  console.log(`  same-tier   mean ${mean(sameTier).toFixed(2)}°  median ${median(sameTier).toFixed(2)}°`);
  console.log(`  cross-tier  mean ${mean(crossTier).toFixed(2)}°  median ${median(crossTier).toFixed(2)}°`);
  console.log(
    `histogram: ` +
      Object.entries(buckets)
        .map(([k, v]) => `${k}°:${v}`)
        .join('  ')
  );
  console.log('worst 8 outliers:');
  for (const c of worst.slice(0, 8)) {
    console.log(
      `  ${c.deviationDeg.toFixed(1).padStart(5)}°  (${c.x.toFixed(0)},${c.z.toFixed(0)})  ` +
        `tier${c.a.tier}:${c.a.key} x tier${c.b.tier}:${c.b.key}`
    );
  }
  return { crossings: crossings.length, meanDev: mean(crossings.map((c) => c.deviationDeg)), worst: worst[0]?.deviationDeg ?? 0, buckets };
}

console.log(`seed ${SEED}`);
console.log(`TIERS ${JSON.stringify(TIERS.map((t) => ({ cell: t.cell, swing: t.swing, radius: t.radius })))}`);

const box4 = edgesInBox(-2000, -2000, 2000, 2000, SEED);
const r4 = angleStats(box4, '4 km box (-2000..2000)');

const box4b = edgesInBox(28000, -32000, 32000, -28000, SEED);
const r4b = angleStats(box4b, '4 km box @ +30 km');

const box12 = edgesInBox(-6000, -6000, 6000, 6000, SEED);
const r12 = angleStats(box12, '12 km box (-6000..6000)');

console.log(
  `\nSUMMARY  4km: ${r4.crossings} crossings, mean dev ${r4.meanDev.toFixed(2)}°, worst ${r4.worst.toFixed(1)}°` +
    `  |  4km@30km: ${r4b.crossings}, mean ${r4b.meanDev.toFixed(2)}°, worst ${r4b.worst.toFixed(1)}°` +
    `  |  12km: ${r12.crossings}, mean ${r12.meanDev.toFixed(2)}°, worst ${r12.worst.toFixed(1)}°`
);
