/* created by AI */
/* Wanderoad — HOW ABRUPT is a levelled junction? Put a number on "smooth".
 *
 * The operator, verbatim: "Whenever there's a 90 degree angle junction between two roads, it's
 * going to try to bring those two roads together in a way that they're on the same elevation.
 * The problem is, it does this very abruptly. Instead it should smooth this out incredibly, so
 * that everything is nice and smooth across the board."
 *
 * "Abrupt" is a feeling, and a feeling cannot be regression-tested. This file turns it into two
 * numbers a car actually experiences, both taken along the road's own canonical profile — the
 * one the ribbon, the chunk mesh and the wheels all read:
 *
 *   GRADE          (dy/ds, per cent) — how steep the road is over one STEP of road.
 *   GRADE BREAK    (percentage points between one step and the next) — how much that steepness
 *                  CHANGES over a step. This is the one that matters. A road can climb 20%
 *                  forever and feel fine; a road that goes from 0% to 20% in one step is a
 *                  kink, and a kink is what the operator is feeling. Highway engineering calls
 *                  the same quantity the "algebraic difference in grade" and sizes every crest
 *                  and sag curve to spread it over a length.
 *
 * ── THE PROFILE IS RESAMPLED FIRST, AND THAT IS NOT A DETAIL ────────────────────────────────
 *
 * The road's polyline is NOT evenly spaced. `squareCrossings` re-emits it at 4 m through the
 * window around a levelled crossing while the rest of the edge runs at 19 m, so a statistic
 * taken per POLYLINE VERTEX is measuring the sampling rate as much as the road: the same real
 * bump reads five times smaller in grade-break terms where the samples are five times closer.
 * The first version of this file did exactly that and its "worst junction" turned out to be a
 * 30% hillside the road was hugging at 4 m resolution, not a junction at all.
 *
 * So every edge is linearly resampled onto a uniform STEP metres of arc length before anything
 * is measured, and both columns are then in the same unit everywhere on the network.
 *
 *   pp        the change of grade over one STEP of road
 *   pp/100 m  the same thing per hundred metres — a constant multiple, printed because it is
 *             the form road-building practice states comfort in (L = K * A)
 *
 * ── WHY THERE IS A CONTROL ──────────────────────────────────────────────────────────────────
 *
 * Every road has grade breaks — it follows the ground. A number for "through a junction" alone
 * says nothing. So the same statistic is taken over OPEN ROAD (every sample more than
 * CONTROL_CLEAR metres of arc length from any crossing) on the very same edges, and the two are
 * printed side by side with their ratio. The claim this file can support is therefore not
 * "junctions are smooth" but "driving through a levelled junction is no more of a kink than the
 * open road either side of it" — which is exactly what the operator asked for.
 *
 * ── WHAT IS A "CROSSING" HERE ───────────────────────────────────────────────────────────────
 *
 * The same segment intersection tools/diag-crosslevel.mjs and tools/browser-test.mjs's R2 use,
 * so the two files are talking about the same events. A crossing where the two edges SHARE the
 * lattice node it sits on is the network continuing rather than a junction being levelled, and
 * `levelAgainst` sees no disagreement there because `pinToNodes` already gave both edges one
 * height — those are counted separately and excluded from the headline.
 *
 *   node tools/diag-junction-smooth.mjs
 */

import { Terrain } from '../src/world/terrain.js';
import { nodePos } from '../src/world/roads.js';

const SEEDS = [20260726, 7, 424242];
const HALF = 3000; // 6 km box — the same census box diag-crosslevel.mjs uses

/* The uniform arc-length step everything is measured on, metres. 8 m is a third of a second at
 * cruising speed and finer than the road's own coarse sampling, so a levelling ramp is resolved
 * in full — and it is coarse enough not to chase the 4 m facets `squareCrossings` emits, which
 * is what made the first version of this file report a hillside as the worst junction. */
const STEP = 8;
/** Arc length either side of a crossing that counts as "through the junction", metres. */
const WINDOW = 150;
/** Arc length a sample must be clear of EVERY crossing to count as open-road control, metres. */
const CONTROL_CLEAR = 320;
/* Past a shared lattice node by this much and a crossing is a real junction rather than the
 * network continuing. 60 m, the same figure and the same reasoning as diag-crosslevel.mjs. */
const NODE_RADIUS = 60;

/** Segment k of edge e as [x0,z0,x1,z1] — plan view only; heights come off e.y directly. */
const seg = (e, k) => [e.pts[k * 2], e.pts[k * 2 + 1], e.pts[k * 2 + 2], e.pts[k * 2 + 3]];

/** Where two plan segments cross, as [x, z, ua, ub], or null. diag-crosslevel's `isect`, trimmed. */
function isect(a, b) {
  const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
  if (Math.abs(d) < 1e-9) return null;
  const ua = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d;
  const ub = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return [a[0] + (a[2] - a[0]) * ua, a[1] + (a[3] - a[1]) * ua, ua, ub];
}

/** The two lattice nodes an edge runs between, as [key, i, j, tier]. */
function nodesOf(e) {
  const [tier, rest] = e.key.split(':');
  const [i, j, dir] = rest.split(',').map(Number);
  const i1 = dir === 0 ? i + 1 : i;
  const j1 = dir === 0 ? j : j + 1;
  return [
    [`${tier}:${i},${j}`, i, j, Number(tier)],
    [`${tier}:${i1},${j1}`, i1, j1, Number(tier)],
  ];
}

/** Is this crossing point sitting on a lattice node the two edges SHARE? */
function atSharedNode(a, b, x, z, seed) {
  if (a.tier !== b.tier) return false;
  const nb = nodesOf(b);
  const p = [0, 0];
  for (const [ka, i, j, tier] of nodesOf(a)) {
    if (!nb.some(([kb]) => kb === ka)) continue;
    nodePos(i, j, tier, seed, p);
    if (Math.hypot(x - p[0], z - p[1]) <= NODE_RADIUS) return true;
  }
  return false;
}

/** Cumulative arc length along an edge's polyline, in metres, one entry per sample. */
function arcOf(e) {
  const n = e.y.length;
  const s = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    const dx = e.pts[k * 2] - e.pts[k * 2 - 2];
    const dz = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
    s[k] = s[k - 1] + Math.hypot(dx, dz);
  }
  return s;
}

/**
 * The edge's elevation on a uniform grid of STEP metres of arc length, with the grade over each
 * step and the grade BREAK at each interior station. See the header: the polyline itself is not
 * evenly spaced, so nothing is measured on it directly.
 *
 * grade[i] belongs to the step from station i to i+1; brk[i] belongs to station i, where
 * grade[i-1] meets grade[i], so it is defined for 1 <= i <= m-2.
 */
function resampleOf(e, s) {
  const n = e.y.length;
  const total = s[n - 1];
  const m = Math.max(3, Math.floor(total / STEP) + 1);
  const y = new Float64Array(m);
  const px = new Float64Array(m);
  const pz = new Float64Array(m);
  let k = 0;
  for (let i = 0; i < m; i++) {
    const si = Math.min(i * STEP, total);
    while (k < n - 2 && s[k + 1] < si) k++;
    const span = s[k + 1] - s[k];
    const t = span > 1e-9 ? (si - s[k]) / span : 0;
    y[i] = e.y[k] + (e.y[k + 1] - e.y[k]) * t;
    px[i] = e.pts[k * 2] + (e.pts[k * 2 + 2] - e.pts[k * 2]) * t;
    pz[i] = e.pts[k * 2 + 1] + (e.pts[k * 2 + 3] - e.pts[k * 2 + 1]) * t;
  }
  const grade = new Float64Array(m - 1);
  for (let i = 0; i < m - 1; i++) grade[i] = ((y[i + 1] - y[i]) / STEP) * 100;
  const brk = new Float64Array(m);
  for (let i = 1; i < m - 1; i++) brk[i] = Math.abs(grade[i] - grade[i - 1]);
  return { m, y, px, pz, grade, brk, total };
}

/** Running min/mean/max/p95 over a stream of numbers, with a note of where the max came from. */
function stats() {
  return {
    n: 0,
    sum: 0,
    max: 0,
    at: null,
    all: [],
    add(v, where) {
      this.n++;
      this.sum += v;
      this.all.push(v);
      if (v > this.max) {
        this.max = v;
        this.at = where;
      }
    },
    get mean() {
      return this.n ? this.sum / this.n : 0;
    },
    p(q) {
      if (!this.n) return 0;
      const a = Float64Array.from(this.all).sort();
      return a[Math.min(a.length - 1, Math.floor(q * a.length))];
    },
  };
}

console.log('=== how abrupt is a levelled junction? ===');
console.log(
  `${SEEDS.length} seeds, ${(HALF * 2) / 1000} km box, canonical profiles; ` +
    `junction window +-${WINDOW} m of arc, control is road more than ${CONTROL_CLEAR} m clear of every crossing\n`,
);

const jGrade = stats();
const jBreak = stats();
const jBreak100 = stats();
const cGrade = stats();
const cBreak = stats();
const cBreak100 = stats();
/** The worst break on each individual junction, so the tail can be printed rather than guessed. */
const perJunction = [];
let crossN = 0;
let sharedN = 0;

for (const seed of SEEDS) {
  const t = new Terrain(seed, -HALF, -HALF, HALF, HALF);
  const es = t.roads.edges;
  const arc = es.map(arcOf);
  const prof = es.map((e, i) => resampleOf(e, arc[i]));
  /** For each edge, the arc positions of every crossing on it. */
  const sites = es.map(() => []);

  for (let i = 0; i < es.length; i++)
    for (let j = i + 1; j < es.length; j++) {
      const A = es[i],
        B = es[j];
      if (A.maxX < B.minX || A.minX > B.maxX || A.maxZ < B.minZ || A.minZ > B.maxZ) continue;
      for (let k = 0; k < A.pts.length / 2 - 1; k++)
        for (let m = 0; m < B.pts.length / 2 - 1; m++) {
          const r = isect(seg(A, k), seg(B, m));
          if (!r) continue;
          if (atSharedNode(A, B, r[0], r[1], seed)) {
            sharedN++;
            continue;
          }
          crossN++;
          sites[i].push({ s: arc[i][k] + (arc[i][k + 1] - arc[i][k]) * r[2], x: r[0], z: r[1], other: B.key });
          sites[j].push({ s: arc[j][m] + (arc[j][m + 1] - arc[j][m]) * r[3], x: r[0], z: r[1], other: A.key });
        }
    }

  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    const p = prof[i];
    const m = p.m;
    const at = (idx) => `${e.key} at (${p.px[idx].toFixed(0)},${p.pz[idx].toFixed(0)}) seed ${seed}`;
    for (let idx = 1; idx < m - 1; idx++) {
      let near = Infinity;
      for (const c of sites[i]) near = Math.min(near, Math.abs(idx * STEP - c.s));
      const b100 = (p.brk[idx] / STEP) * 100;
      if (near <= WINDOW) {
        jGrade.add(Math.abs(p.grade[idx]), at(idx));
        jBreak.add(p.brk[idx], at(idx));
        jBreak100.add(b100, at(idx));
      } else if (near >= CONTROL_CLEAR) {
        cGrade.add(Math.abs(p.grade[idx]), at(idx));
        cBreak.add(p.brk[idx], at(idx));
        cBreak100.add(b100, at(idx));
      }
    }
    if (!sites[i].length) continue;
    /* The worst break on the road through each crossing on this edge, one row per (edge,
     * crossing) — and WHERE in the window it sits. That last column is not decoration: a
     * window is 150 m of arc and a lane edge can be 400 m long, so without it a kink at the
     * edge's own lattice node would be filed under "junction" and a fix aimed at the levelling
     * would be aimed at the wrong thing entirely. `dEnd` is the arc length to the nearer end
     * of the edge, i.e. to a node, for the same reason. */
    for (const c of sites[i]) {
      let worst = 0;
      let wk = -1;
      for (let idx = 1; idx < m - 1; idx++) {
        if (Math.abs(idx * STEP - c.s) > WINDOW) continue;
        if (p.brk[idx] > worst) {
          worst = p.brk[idx];
          wk = idx;
        }
      }
      if (wk >= 0)
        perJunction.push({
          worst,
          seed,
          key: e.key,
          other: c.other,
          x: c.x,
          z: c.z,
          dCross: Math.abs(wk * STEP - c.s),
          dEnd: Math.min(wk * STEP, p.total - wk * STEP),
        });
    }
  }
}

const row = (label, g, b, b100) =>
  `  ${label.padEnd(30)} ${g.max.toFixed(1).padStart(7)} ${g.mean.toFixed(2).padStart(8)} ` +
  `${b.max.toFixed(2).padStart(9)} ${b.mean.toFixed(2).padStart(8)} ${b.p(0.95).toFixed(2).padStart(7)} ` +
  `${b100.max.toFixed(1).padStart(9)} ${b100.mean.toFixed(2).padStart(8)}`;

console.log(`${crossN} levelled crossings (+ ${sharedN} shared-node continuations, excluded)\n`);
console.log('                                   grade %          grade break, pp/step        pp/100 m');
console.log('                                worst     mean      worst    mean     p95      worst     mean');
console.log(row('through junctions', jGrade, jBreak, jBreak100));
console.log(row('open road (control)', cGrade, cBreak, cBreak100));
const ratioMax = cBreak.max > 0 ? jBreak.max / cBreak.max : 0;
const ratioMean = cBreak.mean > 0 ? jBreak.mean / cBreak.mean : 0;
console.log(
  `  ${'ratio junction : open road'.padEnd(30)} ${' '.repeat(16)}` +
    `${ratioMax.toFixed(2).padStart(9)} ${ratioMean.toFixed(2).padStart(8)}`,
);
console.log(`\n  samples: ${jBreak.n} through junctions, ${cBreak.n} open road`);
if (jBreak.at) console.log(`  worst junction break: ${jBreak.max.toFixed(2)} pp at ${jBreak.at}`);
if (cBreak.at) console.log(`  worst open-road break: ${cBreak.max.toFixed(2)} pp at ${cBreak.at}`);

perJunction.sort((a, b) => b.worst - a.worst);
console.log('\nthe ten most abrupt junctions (worst grade break on the road through them):');
for (const j of perJunction.slice(0, 10)) {
  console.log(
    `  ${j.worst.toFixed(2).padStart(6)} pp   ${j.key} x ${j.other}   at (${j.x.toFixed(0)},${j.z.toFixed(0)})  seed ${j.seed}` +
      `   ${j.dCross.toFixed(0)} m from the crossing, ${j.dEnd.toFixed(0)} m from a node`,
  );
}
{
  // Is the abruptness AT the crossing, or is it the edge's own end node being blamed for it?
  const near = perJunction.filter((j) => j.worst > 10);
  const atCross = near.filter((j) => j.dCross <= 40).length;
  const atNode = near.filter((j) => j.dEnd <= 40).length;
  console.log(
    `  of the ${near.length} approaches breaking by more than 10 pp: ` +
      `${atCross} break within 40 m of the crossing, ${atNode} within 40 m of a lattice node`,
  );
}
const over = (t) => perJunction.filter((j) => j.worst > t).length;
console.log(
  `\njunction approaches whose worst break exceeds:  ` +
    `5 pp: ${over(5)}   10 pp: ${over(10)}   20 pp: ${over(20)}   of ${perJunction.length}`,
);

/* ── THE BARS ────────────────────────────────────────────────────────────────────────────────
 *
 * Regression bars, set AT the measured state on 3 August 2026 — the day `levelAgainst`'s feather
 * became a length in metres instead of a count of array elements — and not one of them is an
 * aspiration. They exist so this cannot quietly get worse again while the junction work is open.
 *
 * The state they are set at, against the state before that change, on the same command:
 *
 *                    worst    mean    p95    mean ratio    >10 pp    >20 pp
 *     before        101.24    1.63   8.57         5.97x        68        43
 *     after          99.72    1.06   4.79         3.59x        54        27
 *
 * The WORST is deliberately not the headline. At 99.72 pp it is lane 1:-5,2,0 on seed 20260726
 * climbing a hillside that rises 33% per step, where the road's raw profile already carries 90%
 * gradients before any levelling happens — that number belongs to tools/diag-relief.mjs. The
 * ones that answer the operator are the mean, the p95 and the counts, which are what a driver
 * meets on ordinary ground.
 */
const BAR_WORST = Number(process.env.JSMOOTH_BAR_WORST ?? 100);
const BAR_MEAN_RATIO = Number(process.env.JSMOOTH_BAR_RATIO ?? 3.7);
const BAR_OVER10 = Number(process.env.JSMOOTH_BAR_OVER10 ?? 55);
const okWorst = jBreak.max <= BAR_WORST;
const okRatio = ratioMean <= BAR_MEAN_RATIO;
const okOver = over(10) <= BAR_OVER10;
console.log(
  `\n${okWorst ? 'PASS' : 'FAIL'} — worst grade break through a junction ${jBreak.max.toFixed(2)} pp (bar: ${BAR_WORST})`,
);
console.log(
  `${okRatio ? 'PASS' : 'FAIL'} — mean junction break is ${ratioMean.toFixed(2)}x the open road (bar: ${BAR_MEAN_RATIO})`,
);
console.log(
  `${okOver ? 'PASS' : 'FAIL'} — ${over(10)} junction approaches break by more than 10 pp (bar: ${BAR_OVER10})`,
);
process.exitCode = okWorst && okRatio && okOver ? 0 : 1;
