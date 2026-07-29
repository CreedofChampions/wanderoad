/* How much do the roads actually bend?
 *
 * This is the R5 number, measured EXACTLY the way tools/browser-test.mjs measures it so the
 * two are comparable: walk every edge of a road field, sum the absolute heading change at each
 * interior vertex, divide by the polyline length, report degrees of turn per kilometre. The
 * browser test builds its field the way main.js does — an 840 m box around the car — so that
 * is the primary box here too, with a few larger ones as a sanity check that the figure is not
 * an artefact of one patch of ground.
 *
 * It also reports the things that a "make it curvier" change can silently break:
 *   - the tightest radius on the network, because a hairpin a car cannot take at cruising
 *     speed is not a cozy road, it is a handbrake turn
 *   - the gap between an edge's end and the next edge's start at the shared node, because
 *     curvature that comes from moving control points can pull the ends apart
 *   - reversals: a segment that points backwards relative to the straight line between the
 *     two nodes, i.e. the road doubling back on itself
 *
 *   node tools/diag-curve.mjs
 */
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { edgesInBox, TIERS, nodePos } from '../src/world/roads.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;

/** browser-test.mjs R5, verbatim in shape: turn per metre over the whole edge list. */
function curvature(edges) {
  let turn = 0,
    len = 0;
  for (const e of edges) {
    const n = e.pts.length / 2;
    for (let k = 1; k < n - 1; k++) {
      const ax = e.pts[k * 2] - e.pts[k * 2 - 2],
        az = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
      const bx = e.pts[k * 2 + 2] - e.pts[k * 2],
        bz = e.pts[k * 2 + 3] - e.pts[k * 2 + 1];
      const la = Math.hypot(ax, az) || 1;
      let d = Math.atan2(bx, bz) - Math.atan2(ax, az);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      turn += Math.abs(d);
      len += la;
    }
  }
  return { degPerKm: +(((turn * 57.2958) / Math.max(len, 1)) * 1000).toFixed(0), km: +(len / 1000).toFixed(2) };
}

/* Tightest turn on the network, as a radius. Menger curvature of the three consecutive
 * points: R = |ab||bc||ca| / (4 * area). A cozy cruise is ~70 km/h; at 0.35 g of comfortable
 * lateral acceleration that wants R > 110 m. Below ~45 m you are steering hard. */
function tightest(edges) {
  let worst = Infinity;
  let where = null;
  for (const e of edges) {
    const n = e.pts.length / 2;
    for (let k = 1; k < n - 1; k++) {
      const ax = e.pts[k * 2 - 2],
        az = e.pts[k * 2 - 1];
      const bx = e.pts[k * 2],
        bz = e.pts[k * 2 + 1];
      const cx = e.pts[k * 2 + 2],
        cz = e.pts[k * 2 + 3];
      const A = Math.hypot(bx - ax, bz - az);
      const B = Math.hypot(cx - bx, cz - bz);
      const C = Math.hypot(cx - ax, cz - az);
      const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
      if (area2 < 1e-9) continue;
      const R = (A * B * C) / (2 * area2);
      if (R < worst) {
        worst = R;
        where = { key: e.key, k, x: bx, z: bz };
      }
    }
  }
  return { R: worst, where };
}

/* Do edges still meet? Every edge starts at nodePos(i,j) and ends at the neighbour's node, so
 * the ends of two edges sharing a node must be at the same point. Anything above a millimetre
 * is a gap the player would drive through. */
function gaps(edges, seed) {
  let worst = 0;
  for (const e of edges) {
    const [tier, rest] = e.key.split(':');
    const [i, j, dir] = rest.split(',').map(Number);
    const p0 = nodePos(i, j, +tier, seed, [0, 0]);
    const p1 = nodePos(dir === 0 ? i + 1 : i, dir === 0 ? j : j + 1, +tier, seed, [0, 0]);
    const n = e.pts.length / 2;
    worst = Math.max(worst, Math.hypot(e.pts[0] - p0[0], e.pts[1] - p0[1]));
    worst = Math.max(worst, Math.hypot(e.pts[(n - 1) * 2] - p1[0], e.pts[(n - 1) * 2 + 1] - p1[1]));
  }
  return worst;
}

/* Doubling back: project every segment onto the node-to-node chord. A negative projection is
 * the road running the wrong way down its own edge. Report the worst as a fraction of the
 * segment length, and how much of the network is affected. */
function reversals(edges) {
  let bad = 0,
    total = 0,
    worst = 0;
  for (const e of edges) {
    const n = e.pts.length / 2;
    const chx = e.pts[(n - 1) * 2] - e.pts[0];
    const chz = e.pts[(n - 1) * 2 + 1] - e.pts[1];
    const cl = Math.hypot(chx, chz) || 1;
    const ux = chx / cl,
      uz = chz / cl;
    for (let k = 0; k < n - 1; k++) {
      const dx = e.pts[k * 2 + 2] - e.pts[k * 2];
      const dz = e.pts[k * 2 + 3] - e.pts[k * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      const proj = (dx * ux + dz * uz) / l;
      total++;
      if (proj < 0) {
        bad++;
        worst = Math.min(worst, proj);
      }
    }
  }
  return { bad, total, worst };
}

function report(name, edges, seed = SEED) {
  const c = curvature(edges);
  const t = tightest(edges);
  const g = gaps(edges, seed);
  const r = reversals(edges);
  const t0 = edges.filter((e) => e.tier === 0);
  const t1 = edges.filter((e) => e.tier === 1);
  console.log(
    `${name.padEnd(26)} ${String(c.degPerKm).padStart(4)} deg/km over ${String(c.km).padStart(6)} km  ` +
      `(arterial ${String(curvature(t0).degPerKm).padStart(4)}, lane ${String(curvature(t1).degPerKm).padStart(4)})  ` +
      `tightest R ${t.R.toFixed(0).padStart(4)} m  gap ${g.toFixed(4)} m  reversed ${r.bad}/${r.total}`
  );
  return c.degPerKm;
}

const spawn = findSpawn(SEED);
console.log(`seed ${SEED}  spawn ${spawn.x.toFixed(0)},${spawn.z.toFixed(0)}\n`);

// The box main.js gives the car, which is the box browser-test.mjs measures.
const car = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
const primary = report('car box (840 m, R5)', car.roads.edges);
console.log('');

// Wider boxes: same measurement, more road, so one flat patch cannot flatter the figure.
report('4 km box', edgesInBox(-2000, -2000, 2000, 2000, SEED));
report('4 km box @ +30 km', edgesInBox(28000, -32000, 32000, -28000, SEED));
report('12 km box', edgesInBox(-6000, -6000, 6000, 6000, SEED));

/* The R5 check measures ONE 840 m box, around one spawn, so it is a small sample with real
 * variance — 6 or 7 km of road, three or four arterial edges. A tuning that clears 200 on the
 * default seed and fails on the next one has not fixed anything, so measure the same box on
 * eight worlds and report the worst. */
console.log('');
let worstSeed = Infinity;
for (let s = 0; s < 8; s++) {
  const seed = (SEED + s * 7919) >>> 0;
  const sp = findSpawn(seed);
  const t = new Terrain(seed, sp.x - 420, sp.z - 420, sp.x + 420, sp.z + 420);
  const v = report(`car box seed ${seed}`, t.roads.edges, seed);
  worstSeed = Math.min(worstSeed, v);
}

/* R1 and R2 from the browser suite, measured here because both of them can be broken by a
 * change to the road's SHAPE and neither of them shows up in a curvature figure: R1 is the
 * carved ground standing proud of the road surface, R2 is two roads crossing at different
 * heights. Same arithmetic as tools/browser-test.mjs. */
{
  const t = car;
  let n = 0,
    buried = 0,
    worstOver = 0;
  for (const e of t.roads.edges) {
    for (let k = 0; k < e.y.length; k++) {
      const over = t.height(e.pts[k * 2], e.pts[k * 2 + 1]) - e.y[k];
      n++;
      if (over > 0.35) {
        buried++;
        worstOver = Math.max(worstOver, over);
      }
    }
  }
  const seg = (e, k) => [e.pts[k * 2], e.pts[k * 2 + 1], e.pts[k * 2 + 2], e.pts[k * 2 + 3], e.y[k], e.y[k + 1]];
  const isect = (a, b) => {
    const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
    if (Math.abs(d) < 1e-9) return null;
    const ua = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d;
    const ub = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
    if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
    return [a[4] + (a[5] - a[4]) * ua, b[4] + (b[5] - b[4]) * ub];
  };
  const es = t.roads.edges;
  let crossings = 0,
    mismatched = 0,
    worstStep = 0;
  for (let i = 0; i < es.length; i++)
    for (let j = i + 1; j < es.length; j++)
      for (let k = 0; k < es[i].pts.length / 2 - 1; k++)
        for (let m = 0; m < es[j].pts.length / 2 - 1; m++) {
          const r = isect(seg(es[i], k), seg(es[j], m));
          if (!r) continue;
          crossings++;
          const dh = Math.abs(r[0] - r[1]);
          if (dh > 1.0) {
            mismatched++;
            worstStep = Math.max(worstStep, dh);
          }
        }
  console.log(`\nR1 ground above the road: ${buried}/${n} points, worst ${worstOver.toFixed(2)} m (want 0)`);
  console.log(`R2 crossings out of level: ${mismatched}/${crossings}, worst ${worstStep.toFixed(2)} m (want 0)`);
}

/* ── the number that actually predicts R5 ────────────────────────────────────────────────
 *
 * Everything above measures the box at SPAWN, and that is the blind spot that let a failure
 * through: the box at spawn read 229-241 deg/km while the browser check, run after the drive
 * tests had moved the car, read 116. R5 does not measure the network. It measures whatever
 * edges are loaded in the 840 m box around wherever the car happens to be, and an 840 m box
 * can hold ONE two-kilometre arterial and nothing else — in which case the check is reading a
 * single edge and the network median is irrelevant.
 *
 * So: walk the road network, stand the car on it at a few hundred points, and report the WORST
 * window. That is the figure that has to clear 200, because the car can be at any of them.
 */
{
  const PAD = 80; // RoadField's own CARVE_REACH — the pad main.js's Terrain ends up using
  const box = 2000;
  const es = edgesInBox(-box - 500, -box - 500, box + 500, box + 500, SEED);
  let worst = { deg: Infinity };
  const all = [];
  for (const e of es) {
    const m = e.pts.length / 2;
    for (let k = 0; k < m; k += Math.max(1, Math.floor(m / 6))) {
      const x = e.pts[k * 2],
        z = e.pts[k * 2 + 1];
      if (Math.abs(x) > box || Math.abs(z) > box) continue;
      const c = curvature(edgesInBox(x - 420, z - 420, x + 420, z + 420, SEED, PAD));
      all.push(c.degPerKm);
      if (c.degPerKm < worst.deg) worst = { deg: c.degPerKm, km: c.km, x: Math.round(x), z: Math.round(z) };
    }
  }
  all.sort((a, b) => a - b);
  console.log(
    `\non-road windows swept: ${all.length} over a ${(2 * box) / 1000} km square` +
      `\n  worst ${worst.deg} deg/km over ${worst.km} km at (${worst.x},${worst.z})` +
      `  p5 ${all[Math.floor(0.05 * all.length)]}  median ${all[Math.floor(0.5 * all.length)]}`
  );
  console.log(`R5 worst window (the real check) = ${worst.deg} deg/km — want > 200`);
}

console.log(`\nTIERS ${JSON.stringify(TIERS)}`);
console.log(`\nR5 (car box, default seed) = ${primary} deg/km — want > 200`);
console.log(`R5 worst of 8 seeds        = ${worstSeed} deg/km`);
