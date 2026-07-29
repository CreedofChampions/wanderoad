/* Wanderoad — does a bend read as a CURVE, or as a chain of straight chords?
 *
 * The operator, verbatim: *"roads need to be smoother -- less 2/4s attached end to end more
 * smooth winding track"*. That is not a complaint about how much the road turns —
 * `tools/diag-curve.mjs` already measures that (R5, degrees of turn per kilometre) and it
 * passes. It is a complaint about how the turn is DELIVERED: a road that turns 200 deg/km in
 * eighteen-degree steps is a polygon, and a road that turns the same 200 deg/km in nine-degree
 * steps is a curve. Same R5, completely different picture out of the windscreen.
 *
 * So this measures the FACET ANGLE: the heading change at each interior vertex of the polyline
 * the renderer and the terrain carve both actually read (`e.pts` off `edgesInBox`). Reported
 * per tier, because the two tiers sample at different rates and averaging them hides which one
 * is faceted.
 *
 * The number that matters is not the mean — a long straight arterial run drags the mean to
 * nothing while the one bend on it is still a hexagon. It is the TAIL: p95 and max, and the
 * share of vertices turning more than 10 degrees, which is about where a chord break starts to
 * read as a corner rather than as a curve at road width.
 *
 * A closed-form sanity check, so the numbers can be predicted rather than just observed: a
 * polyline stepping `s` metres round a circle of radius `R` breaks by `s/R` radians at every
 * vertex. The arterial tier's tightest allowed radius is 122 m, so at the shipped step of 38 m
 * its worst facet is 38/122 = 0.31 rad = 17.8 deg. Halving the step halves that exactly.
 *
 *   node tools/diag-smooth.mjs [seed]
 */

import { edgesInBox, TIERS } from '../src/world/roads.js';
import { findSpawn } from '../src/world/terrain.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const spawn = findSpawn(SEED, 0, 0);
const CX = Math.round(spawn.x),
  CZ = Math.round(spawn.z);

/** Facet statistics over an edge list, split by tier. */
function facets(edges) {
  const per = [[], []];
  for (const e of edges) {
    const n = e.pts.length / 2;
    for (let k = 1; k < n - 1; k++) {
      const ax = e.pts[k * 2] - e.pts[k * 2 - 2],
        az = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
      const bx = e.pts[k * 2 + 2] - e.pts[k * 2],
        bz = e.pts[k * 2 + 3] - e.pts[k * 2 + 1];
      let d = Math.atan2(bx, bz) - Math.atan2(ax, az);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      per[e.tier].push(Math.abs(d) * 57.29577951308232);
    }
  }
  return per.map((a) => {
    if (!a.length) return { n: 0, mean: 0, p95: 0, max: 0, over10: 0, over15: 0 };
    a.sort((x, y) => x - y);
    const sum = a.reduce((s, v) => s + v, 0);
    return {
      n: a.length,
      mean: sum / a.length,
      p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))],
      max: a[a.length - 1],
      over10: a.filter((v) => v > 10).length / a.length,
      over15: a.filter((v) => v > 15).length / a.length,
    };
  });
}

console.log(`=== facet angle — is the bend a curve or a chain of chords? seed ${SEED} ===`);
console.log(`spawn (${CX}, ${CZ})`);
console.log(`TIERS step: arterial ${TIERS[0].step} m, lane ${TIERS[1].step} m`);
console.log(
  `predicted worst facet at the tier's tightest radius: arterial ` +
    `${((TIERS[0].step / TIERS[0].radius) * 57.2958).toFixed(1)}°, lane ` +
    `${((TIERS[1].step / TIERS[1].radius) * 57.2958).toFixed(1)}°\n`,
);

const BOXES = [
  ['car box (840 m)', 420],
  ['4 km box', 2000],
  ['12 km box', 6000],
];

let carArt = null;
for (const [label, half] of BOXES) {
  const edges = edgesInBox(CX - half, CZ - half, CX + half, CZ + half, SEED, 0);
  const [a, l] = facets(edges);
  if (label.startsWith('car')) carArt = a;
  console.log(`${label}   ${edges.length} edges`);
  for (const [tname, s] of [
    ['arterial', a],
    ['lane    ', l],
  ]) {
    if (!s.n) {
      console.log(`   ${tname}  (none in box)`);
      continue;
    }
    console.log(
      `   ${tname}  vertices ${String(s.n).padStart(5)}   mean ${s.mean.toFixed(2).padStart(5)}°` +
        `   p95 ${s.p95.toFixed(2).padStart(5)}°   max ${s.max.toFixed(2).padStart(6)}°` +
        `   >10° ${(s.over10 * 100).toFixed(1)}%   >15° ${(s.over15 * 100).toFixed(1)}%`,
    );
  }
  console.log('');
}

/* THE BAR — a regression tripwire, not a target, set a hair above what the build measures.
 *
 * MEASURED, 12 km box at the default spawn, arterial tier:
 *   step 38 m (before)   mean 9.17°   p95 17.85°   max 27.00°   44.6% of vertices over 10°
 *   step 19 m (shipped)  mean 5.88°   p95 11.15°   max 18.23°    9.0% of vertices over 10°
 *
 * Nearly half the arterial vertices used to break by more than ten degrees, which is exactly
 * the "2/4s attached end to end" the operator described; one in eleven does now. It cost 4% of
 * chunk build time (tools/bench-chunk.mjs, 1183 -> 1231 ms over all eight levels) and R5 went
 * UP, 216 -> 232 deg/km, because the finer polyline resolves turn the chords were cutting off.
 *
 * The max sits above the 8.9° a 122 m radius predicts because the tightest radius on the
 * network is not the tier's floor — junction tangents and the crossing squaring can locally
 * beat it (diag-curve reports a 37 m radius over the same box, which is 29° at this step). */
const edges12 = edgesInBox(CX - 6000, CZ - 6000, CX + 6000, CZ + 6000, SEED, 0);
const [a12] = facets(edges12);
const BAR_MAX = 20.0;
const ok = a12.max <= BAR_MAX;
console.log(`${ok ? 'PASS' : 'FAIL'} — worst arterial facet ${a12.max.toFixed(2)}° over the 12 km box (bar: ${BAR_MAX}°)`);
process.exitCode = ok ? 0 : 1;
