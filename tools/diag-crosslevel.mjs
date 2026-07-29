/* Wanderoad — do two roads that CROSS agree about where they are?
 *
 * This is the node-side twin of the browser suite's R2 check, and it exists because R2 is a
 * per-box lottery: it reads whatever edges happen to be in the 840 m box around wherever the
 * car stopped, so a crossing 3.63 m out of level can be invisible for a hundred runs and then
 * become the first thing a new player drives into the moment the spawn heading changes.
 *
 * Two measurements, and they answer different questions:
 *
 *   CENSUS   Every crossing in a multi-kilometre box, classified by TIER PAIR. That is the
 *            box-independent property of the world. `canonicalProfile` in world/roads.js
 *            derives an edge's levelling partners from the EDGE's own bounds and never from
 *            the caller's query box, so a crossing that is out of level here is out of level
 *            everywhere, including in the car's own little box when it gets there.
 *
 *   SWEEP    The browser R2 arithmetic verbatim, run over a few hundred 840 m car boxes
 *            standing on real road. This is the number the operator's "1 of 9" came from,
 *            and it is the one that gates the reversed spawn: if any box the car can reach
 *            around the default spawn holds a mismatched crossing, driving out that way can
 *            find it.
 *
 * The arithmetic is copied from tools/browser-test.mjs's R2 block on purpose — same segment
 * intersection, same 1.0 m threshold — so the two are directly comparable. It reads the
 * heights off `Terrain.roads.edges`, which are the canonical profiles the ribbon, the chunk
 * mesh and the car's wheels all read, so there is no second opinion here about where a road is.
 *
 *   node tools/diag-crosslevel.mjs
 */

import { Terrain, findSpawn } from '../src/world/terrain.js';
import { edgesInBox, nodePos } from '../src/world/roads.js';

const SEED = 20260726;
/** browser-test.mjs R2's own bar: a crossing more than this far apart is a step, not a joint. */
const BAD = 1.0;

/** Segment k of edge e as [x0,z0,x1,z1,y0,y1] — browser-test.mjs's `seg`, verbatim. */
const seg = (e, k) => [e.pts[k * 2], e.pts[k * 2 + 1], e.pts[k * 2 + 2], e.pts[k * 2 + 3], e.y[k], e.y[k + 1]];

/** Where two segments cross, and each one's HEIGHT there — browser-test.mjs's `isect`, verbatim. */
function isect(a, b) {
  const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]);
  if (Math.abs(d) < 1e-9) return null;
  const ua = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d;
  const ub = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
  if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
  return [a[4] + (a[5] - a[4]) * ua, b[4] + (b[5] - b[4]) * ub, a[0] + (a[2] - a[0]) * ua, a[1] + (a[3] - a[1]) * ua];
}

/** Every crossing in an edge list, with both heights. No filtering — the caller classifies. */
function crossings(es) {
  const out = [];
  for (let i = 0; i < es.length; i++)
    for (let j = i + 1; j < es.length; j++) {
      const A = es[i],
        B = es[j];
      if (A.maxX < B.minX || A.minX > B.maxX || A.maxZ < B.minZ || A.minZ > B.maxZ) continue;
      for (let k = 0; k < A.pts.length / 2 - 1; k++)
        for (let m = 0; m < B.pts.length / 2 - 1; m++) {
          const r = isect(seg(A, k), seg(B, m));
          if (!r) continue;
          out.push({ a: A, b: B, dh: Math.abs(r[0] - r[1]), x: r[2], z: r[3] });
        }
    }
  return out;
}

/** The two lattice nodes an edge runs between, as [key, i, j] — same derivation as `edgeNodeKeys`. */
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

/* HOW FAR FROM A SHARED NODE STOPS BEING "AT" IT.
 *
 * This distinction is the whole reason this file exists in the shape it does, and getting it
 * wrong the first time produced a completely false reading: classifying a CROSSING by whether
 * its two EDGES share a node reported 21 arterial-vs-arterial mismatches as "shared node,
 * not a junction" and 0 as real — when in fact two arterials that leave the same node can
 * ALSO cross each other a kilometre and a half away, and that far crossing is a genuine
 * mid-edge junction with nothing levelling it. The pair sharing a node says nothing about
 * where this particular intersection is.
 *
 * 60 m: comfortably past the widest arterial's carriageway-plus-verge (8.6/2 + 5 = 9.3 m) and
 * past the 18 m capture radius `levelAgainst` uses, so a crossing outside it cannot be the
 * shared node under another name; and well inside the 620 m tier-1 cell, so it cannot swallow
 * a real junction.
 */
const NODE_RADIUS = 60;

/** Distance from a crossing point to the nearest lattice node the two edges SHARE (Infinity if none). */
function sharedNodeDist(a, b, x, z, seed) {
  if (a.tier !== b.tier) return Infinity; // different tiers never share a node
  const nb = nodesOf(b);
  const p = [0, 0];
  let best = Infinity;
  for (const [ka, i, j, tier] of nodesOf(a)) {
    if (!nb.some(([kb]) => kb === ka)) continue;
    nodePos(i, j, tier, seed, p);
    best = Math.min(best, Math.hypot(x - p[0], z - p[1]));
  }
  return best;
}

/** Is this crossing point sitting on a lattice node the two edges share? */
function atSharedNode(a, b, x, z, seed) {
  return sharedNodeDist(a, b, x, z, seed) <= NODE_RADIUS;
}

/** Distance from a point to the nearest lattice node of EITHER edge — what roads.js guards. */
function ownNodeDist(a, b, x, z, seed) {
  const p = [0, 0];
  let best = Infinity;
  for (const e of [a, b])
    for (const [, i, j, tier] of nodesOf(e)) {
      nodePos(i, j, tier, seed, p);
      best = Math.min(best, Math.hypot(x - p[0], z - p[1]));
    }
  return best;
}

/* ── 1. CENSUS: every crossing in a big box, by tier pair ─────────────────────────────── */

const CENSUS_SEEDS = [20260726, 1, 3, 7, 424242];
const HALF = 3000; // 6 km box — the one the BACKLOG's arterial-vs-arterial numbers were taken over

console.log('=== crossings out of level — the node-side twin of browser R2 ===');
console.log(`census: ${(HALF * 2) / 1000} km box about the origin, ${CENSUS_SEEDS.length} seeds, canonical profiles\n`);

const buckets = new Map();
const worstBy = new Map();
let censusBad = 0;
let censusN = 0;
const censusList = [];

for (const seed of CENSUS_SEEDS) {
  const t = new Terrain(seed, -HALF, -HALF, HALF, HALF);
  for (const c of crossings(t.roads.edges)) {
    // A shared lattice node is the network CONTINUING, not a junction — and both edges are
    // pinned to one node height there, so it is not a levelling question at all.
    const shared = atSharedNode(c.a, c.b, c.x, c.z, seed);
    const key = `${Math.min(c.a.tier, c.b.tier)}x${Math.max(c.a.tier, c.b.tier)}${shared ? ' (shared node)' : ''}`;
    const b = buckets.get(key) || { n: 0, bad: 0 };
    b.n++;
    censusN++;
    if (c.dh > BAD) {
      b.bad++;
      censusBad++;
        censusList.push({
        seed,
        key,
        dh: c.dh,
        x: c.x,
        z: c.z,
        a: c.a.key,
        b: c.b.key,
        node: ownNodeDist(c.a, c.b, c.x, c.z, seed),
      });
    }
    buckets.set(key, b);
    if (c.dh > (worstBy.get(key) || 0)) worstBy.set(key, c.dh);
  }
}

console.log('tier pair                 crossings   over 1.0 m   worst');
for (const [k, v] of [...buckets].sort()) {
  console.log(`  ${k.padEnd(24)} ${String(v.n).padStart(5)}   ${String(v.bad).padStart(8)}   ${worstBy.get(k).toFixed(2)} m`);
}
console.log(`\ncensus: ${censusBad} of ${censusN} crossings over ${BAD} m`);

const artArt = censusList.filter((c) => c.key === '0x0');
console.log(`  of which arterial x arterial, TRUE mid-edge (no shared node): ${artArt.length}`);
for (const c of artArt.slice(0, 14)) {
  console.log(
    `    ${c.dh.toFixed(2).padStart(6)} m at (${c.x.toFixed(0)},${c.z.toFixed(0)})  seed ${c.seed}  ${c.a} x ${c.b}` +
      `   nearest own node ${c.node.toFixed(0)} m${c.node < 150 ? '  <- inside the roads.js node guard' : ''}`,
  );
}
const other = censusList.filter((c) => c.key !== '0x0');
if (other.length) {
  console.log(`  other mismatched crossings: ${other.length}`);
  for (const c of other.slice(0, 12)) {
    console.log(`    ${c.dh.toFixed(2)} m at (${c.x.toFixed(0)},${c.z.toFixed(0)})  seed ${c.seed}  ${c.key}  ${c.a} x ${c.b}`);
  }
}

/* ── 2. SWEEP: browser R2 over the car boxes the player can actually reach ─────────────── */

const SWEEP_HALF = 420; // main.js's own car box, which is what browser R2 reads
const SWEEP_BOX = 2500; // how far from spawn a player can plausibly get in an early drive

const sp = findSpawn(SEED);
console.log(
  `\nsweep: 840 m car boxes on real road within ${SWEEP_BOX} m of the default spawn (${sp.x.toFixed(0)},${sp.z.toFixed(0)})`,
);

const stations = [];
for (const e of edgesInBox(sp.x - SWEEP_BOX, sp.z - SWEEP_BOX, sp.x + SWEEP_BOX, sp.z + SWEEP_BOX, SEED)) {
  const m = e.pts.length / 2;
  for (let k = 0; k < m; k += Math.max(1, Math.floor(m / 5))) {
    const x = e.pts[k * 2],
      z = e.pts[k * 2 + 1];
    if (Math.hypot(x - sp.x, z - sp.z) > SWEEP_BOX) continue;
    stations.push([x, z]);
  }
}

let boxesBad = 0;
let sweepWorst = 0;
let sweepWhere = null;
let sweepCross = 0;
let sweepBadCross = 0;
/** How far from spawn the NEAREST car box holding a mismatched crossing is. */
let nearestBad = Infinity;
let nearestWhere = null;
for (const [x, z] of stations) {
  const t = new Terrain(SEED, x - SWEEP_HALF, z - SWEEP_HALF, x + SWEEP_HALF, z + SWEEP_HALF);
  let bad = 0;
  for (const c of crossings(t.roads.edges)) {
    sweepCross++;
    if (c.dh > BAD) {
      bad++;
      sweepBadCross++;
      if (c.dh > sweepWorst) {
        sweepWorst = c.dh;
        sweepWhere = { x: c.x, z: c.z, a: c.a.key, b: c.b.key, box: [Math.round(x), Math.round(z)] };
      }
    }
  }
  if (bad) {
    boxesBad++;
    const d = Math.hypot(x - sp.x, z - sp.z);
    if (d < nearestBad) {
      nearestBad = d;
      nearestWhere = [Math.round(x), Math.round(z)];
    }
  }
}

console.log(
  `  ${stations.length} boxes swept   ${boxesBad} hold a mismatched crossing   ` +
    `${sweepBadCross} of ${sweepCross} crossings over ${BAD} m   worst ${sweepWorst.toFixed(2)} m`,
);
if (sweepWhere)
  console.log(
    `  worst at (${sweepWhere.x.toFixed(0)},${sweepWhere.z.toFixed(0)})  ${sweepWhere.a} x ${sweepWhere.b}  ` +
      `first seen from a car box at (${sweepWhere.box[0]},${sweepWhere.box[1]})`,
  );
console.log(
  nearestBad === Infinity
    ? '  no car box anywhere in the sweep holds one'
    : `  NEAREST bad box to spawn: ${nearestBad.toFixed(0)} m away, centred (${nearestWhere[0]},${nearestWhere[1]})`,
);

/* ── 3. THE REVERSED SPAWN'S OWN QUESTION ────────────────────────────────────────────────
 *
 * The operator's #1 request is to spawn the car facing the other way down the road, and it is
 * held on exactly one number: does driving out that way put the player through a crossing that
 * is out of level? So ask that directly rather than inferring it from the sweep. Every crossing
 * within DRIVE_REACH of the spawn point, in EVERY direction — because a road bends, and a
 * heading is not a corridor. Browser R2's own 1.0 m threshold, on the same canonical heights.
 */
const DRIVE_REACH = 2600;
{
  const t = new Terrain(SEED, sp.x - DRIVE_REACH, sp.z - DRIVE_REACH, sp.x + DRIVE_REACH, sp.z + DRIVE_REACH);
  let n = 0;
  let bad = 0;
  let worst = 0;
  let where = null;
  for (const c of crossings(t.roads.edges)) {
    if (Math.hypot(c.x - sp.x, c.z - sp.z) > DRIVE_REACH) continue;
    n++;
    if (c.dh > BAD) {
      bad++;
      if (c.dh > worst) {
        worst = c.dh;
        where = c;
      }
    }
  }
  console.log(`\nreversed-spawn gate: ${n} crossings within ${DRIVE_REACH} m of spawn, ${bad} over ${BAD} m`);
  if (where) console.log(`  worst ${worst.toFixed(2)} m at (${where.x.toFixed(0)},${where.z.toFixed(0)})  ${where.a.key} x ${where.b.key}`);
  globalThis.__reverseBad = bad;
}

/* ── THE BARS ────────────────────────────────────────────────────────────────────────────
 *
 * Both are regression bars set at the measured state when this file was written, not
 * aspirations. The arterial x arterial figure is the one the reversed spawn waits on: the
 * operator's #1 request is held because driving out of spawn the other way routes the car
 * through a crossing 3.63 m out of level, and every one of those is an arterial meeting an
 * arterial mid-edge with nothing in world/roads.js levelling the pair.
 */
const BAR_ART = Number(process.env.CROSSLEVEL_BAR_ART ?? 10);
const BAR_SWEEP = Number(process.env.CROSSLEVEL_BAR_SWEEP ?? 19);
const okArt = artArt.length <= BAR_ART;
const okSweep = boxesBad <= BAR_SWEEP;
const okReverse = globalThis.__reverseBad === 0;
console.log(
  `\n${okArt ? 'PASS' : 'FAIL'} — ${artArt.length} arterial x arterial mid-edge crossings over ${BAD} m (regression bar: ${BAR_ART})`,
);
console.log(
  `${okSweep ? 'PASS' : 'FAIL'} — ${boxesBad} of ${stations.length} car boxes near spawn hold a mismatched crossing (regression bar: ${BAR_SWEEP})`,
);
console.log(
  `${okReverse ? 'PASS' : 'FAIL'} — ${globalThis.__reverseBad} mismatched crossings within ${DRIVE_REACH} m of spawn ` +
    `(bar: 0 — this is the one the reversed spawn waits on)`,
);
process.exitCode = okArt && okSweep && okReverse ? 0 : 1;
