/* Wanderoad — where does a road actually STOP, and why?
 *
 * The operator's screenshot (a): a lane ending in open grass with its edge lines, centre
 * dashes and a give-way bar running right up to the cut. That is a road with no reason to
 * stop — the single loudest complaint in the round.
 *
 * `isLeafLane` culls one ply of hash-degree-1 lanes. `linkLive` culls lanes that cross a lake.
 * Neither knows about the other on purpose (see the long note on isLeafLane: making the leaf
 * cull water-aware compounded and took the network to 62% of its length). So a stump can still
 * survive, and this file's job is to say HOW MANY, WHERE and BY WHICH MECHANISM, rather than
 * leaving that to a screenshot.
 *
 * The measurement error that cost a full round last time was counting an endpoint near the
 * query box as a dead end when it is really a CLIPPED edge — 31 apparent against 6 real. This
 * file cannot make that mistake, and the reason is worth stating rather than assuming: it does
 * not look at endpoints at all. It walks NODES and asks `linkAudit` about each node's four
 * links, and `linkAudit` is pure, local and box-independent (a hash test plus water probes on
 * the base geometry). A node's live degree is therefore exact wherever it sits, including one
 * metre inside the box edge, so no clip margin is needed and none is applied.
 *
 *   node tools/diag-deadends.mjs
 */

import { TIERS, nodePos, degreeAt, linkAudit, edgesInBox } from '../src/world/roads.js';
import { fieldTag } from '../src/world/field.js';

const SEEDS = [1, 3, 7, 20260726, 424242];
/** Half-width of the box each seed is scored over: 6 km, so 144 km² — the same box
 *  diag-causeway.mjs and the density work use, big enough to hold real arterial lattice. */
const HALF = 6000;

/** The four links that meet at node (i,j): east/south of it, and west/north into it. */
function linksAt(i, j) {
  return [
    [i, j, 0],
    [i, j, 1],
    [i - 1, j, 0],
    [i, j - 1, 1],
  ];
}

/** Live degree of a node: how many roads are actually BUILT there, both culls applied. */
function liveDegree(i, j, tier, seed, tag) {
  let n = 0;
  for (const [li, lj, d] of linksAt(i, j)) if (linkAudit(li, lj, d, tier, seed, tag).live) n++;
  return n;
}

/** Why is this node a stump? The first cause that removed a link it would otherwise have. */
function causeAt(i, j, tier, seed, tag) {
  let drowned = 0;
  let leafed = 0;
  for (const [li, lj, d] of linksAt(i, j)) {
    const a = linkAudit(li, lj, d, tier, seed, tag);
    if (!a.hashed) continue;
    if (a.drowned) drowned++;
    else if (a.leaf) leafed++;
  }
  if (drowned && leafed) return 'both';
  if (drowned) return 'water-orphan';
  if (leafed) return 'leaf-orphan';
  return 'hash-degree-1';
}

function scoreSeed(seed) {
  const tag = fieldTag(seed);
  const cell0 = TIERS[0].cell;
  const cell1 = TIERS[1].cell;
  const out = { seed, ends: [], edges: 0 };

  for (let tier = 0; tier < TIERS.length; tier++) {
    const cell = tier === 0 ? cell0 : cell1;
    const i0 = Math.floor((-HALF - cell) / cell);
    const i1 = Math.floor((HALF + cell) / cell);
    const j0 = Math.floor((-HALF - cell) / cell);
    const j1 = Math.floor((HALF + cell) / cell);
    const p = [0, 0];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        nodePos(i, j, tier, seed, p);
        if (Math.abs(p[0]) > HALF || Math.abs(p[1]) > HALF) continue;
        const deg = liveDegree(i, j, tier, seed, tag);
        if (deg !== 1) continue;
        out.ends.push({
          tier,
          i,
          j,
          x: p[0],
          z: p[1],
          hashDeg: degreeAt(i, j, tier, seed),
          cause: causeAt(i, j, tier, seed, tag),
        });
      }
    }
  }
  out.edges = edgesInBox(-HALF, -HALF, HALF, HALF, seed).length;
  return out;
}

const AREA = ((HALF * 2) / 1000) ** 2; // km² per seed

console.log('=== dead ends — roads that stop for no reason ===');
console.log(`five seeds, ${(HALF * 2) / 1000} km square about the origin (${AREA} km²), both tiers`);
console.log('node-based, so no clip margin: linkAudit is pure and local, live degree is exact\n');

const causes = new Map();
let total = 0;
const worst = [];

for (const seed of SEEDS) {
  const r = scoreSeed(seed);
  total += r.ends.length;
  for (const e of r.ends) {
    causes.set(e.cause, (causes.get(e.cause) || 0) + 1);
    worst.push({ seed, ...e });
  }
  const byTier = [0, 1].map((t) => r.ends.filter((e) => e.tier === t).length);
  console.log(
    `seed ${String(seed).padEnd(10)} edges ${String(r.edges).padStart(4)}   dead ends ${String(r.ends.length).padStart(3)}` +
      `  (arterial ${byTier[0]}, lane ${byTier[1]})`,
  );
}

console.log('\nby mechanism:');
for (const [k, v] of [...causes].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${v}`);

console.log(
  `\ndead ends: ${total} over 5 seeds  =  ${(total / 5).toFixed(1)} per ${AREA} km²  =  ${((total / 5 / AREA) * 16).toFixed(1)} per 16 km²`,
);

if (worst.length) {
  console.log('\nfirst 12, for driving to:');
  for (const w of worst.slice(0, 12)) {
    console.log(
      `  seed ${w.seed}  tier${w.tier}  node ${w.i},${w.j}  at (${w.x.toFixed(0)},${w.z.toFixed(0)})  hashDeg ${w.hashDeg}  ${w.cause}`,
    );
  }
}

/* ── THE BAR, AND WHY IT IS NOT ZERO ─────────────────────────────────────────────────────────
 *
 * The number this file first measured was **6.1 dead ends per 16 km²**, against the "still 1
 * per 16 km²" written in BACKLOG.md after the leaf cull shipped. Both are honest; they are
 * different measurements. That entry counted ENDPOINTS of edges enumerated over a 4 km box and
 * threw away anything near the boundary as clipped — which, on a box that small, throws away
 * almost the whole box. This walks NODES and asks `linkAudit`, which is pure and local, so
 * there is nothing to clip and nothing to throw away. 6.1 is the real figure and this line is
 * the correction.
 *
 * Driving it to zero is a bad trade and the price is already measured. 121 of the 275 found
 * here are lanes orphaned when the neighbour they continued into was culled for crossing a
 * lake; killing those means cascading the leaf cull onto the LIVE degree, and
 * `tools/diag-density.mjs` prices that at 62% of the network's length and 52% of its junctions.
 * A game whose whole activity is driving on roads does not pay that for tidiness.
 *
 * What the operator actually asked for is that a road must not stop WITHOUT EXPLANATION. That
 * requirement is discharged in `render/road.js`, which gives every one of these a turning head
 * and a closing bar, and it is `tools/diag-terminus.mjs` that proves it (T1b: every dead end in
 * a real drawing window got one, 27 of 27). So the gate HERE is a regression bar on the census:
 * the population must not grow, because every one that appears costs a turning head and a
 * player who has to turn round.
 */
const BAR = 6.5;
const per = (total / SEEDS.length / AREA) * 16;
/* And a hard one on the residual the one-ply leaf cull structurally cannot reach — a node the
 * hash itself gave a single link. Three across five seeds is the tail `isLeafLane`'s "one ply,
 * not a fixed point" note predicts; a jump here would mean that cull had stopped working. */
const UNEXPLAINED_BAR = 8;
const unexplained = causes.get('hash-degree-1') || 0;
const ok = per <= BAR && unexplained <= UNEXPLAINED_BAR;
console.log(`\n${per <= BAR ? 'PASS' : 'FAIL'} — ${per.toFixed(1)} dead ends per 16 km²  (regression bar: ${BAR})`);
console.log(
  `${unexplained <= UNEXPLAINED_BAR ? 'PASS' : 'FAIL'} — ${unexplained} of them hash-degree-1, the residual the one-ply leaf cull cannot reach  (bar: ${UNEXPLAINED_BAR})`,
);
console.log('  every one of these gets a turning head and a closing bar — see tools/diag-terminus.mjs');
process.exitCode = ok ? 0 : 1;
