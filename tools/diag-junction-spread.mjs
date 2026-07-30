/* Wanderoad — do two roads leave a junction along the same line?
 *
 * The braiding in the operator's screenshot (i.imgur.com/oU5myVN.png): carriageways leaving one
 * point side by side, centre lines crossing each other. This measures it.
 *
 * WHY THIS FILE EXISTS RATHER THAN THE OBVIOUS ONE-LINER. A first attempt grouped edge ends by
 * ROUNDED COORDINATE and reported a third of all junctions as braided on three seeds. That number
 * was wrong and went into the backlog before anyone checked it. Two faults:
 *
 *   1. Bucketing by coordinate merges genuinely different nodes that happen to sit within the
 *      bucket of each other, and the lattice jitter puts nodes that close together often enough
 *      to matter.
 *   2. It never established which lattice node each end of an edge actually WAS, so a road
 *      passing through a node could be read as two roads leaving it the same way.
 *
 * So this identifies nodes from the edge KEY — `tier:i,j,dir` says exactly which two lattice
 * nodes an edge joins — and asks `nodePos` where they are. No bucketing, no guessing.
 *
 * THE MEASUREMENT. At a node, take each incident edge's unit tangent pointing AWAY from that node
 * along its own geometry. Two roads are separated by the angle between those tangents:
 *
 *     180 deg  a road passing straight through   (the two halves leave back to back)
 *      90 deg  a clean crossroads arm
 *      ~0 deg  BRAIDED — two carriageways down the same line, which is the defect
 *
 * so the interesting figure is the SMALLEST separation at each node, and the count of pairs under
 * BRAIDED_DEG.
 *
 *   node tools/diag-junction-spread.mjs [halfSpan] [seed ...]
 */

import { edgesInBox, nodePos } from '../src/world/roads.js';

const HALF = +(process.argv[2] || 6000);
const SEEDS = process.argv.slice(3).map(Number).filter((n) => Number.isFinite(n));
if (!SEEDS.length) SEEDS.push(20260726, 7, 424242);

/** Below this, two roads leaving a node are the same road twice as far as a driver is concerned. */
const BRAIDED_DEG = 26;
/* THE REGRESSION BAR, and it is deliberately set AT today's number rather than at the number
 * anyone would want.
 *
 * 33.3% of pairs is not acceptable and this file does not pretend otherwise — it is written down
 * in docs/BACKLOG.md with the five approaches that have been measured against it and the cost that
 * killed each one. What this bar is FOR is stopping it getting worse while that is unsolved: every
 * approach so far traded separation for something else (network straightness, loops at junctions,
 * new arterial-x-arterial crossings, or road gradient one-for-one), and a change that quietly
 * pushed this number up while fixing something else would be invisible without a guard.
 *
 * Lower this the day the geometry improves. Do not raise it. */
const BAR_PCT = 34.0;

const DEG = 180 / Math.PI;

/** The two lattice nodes an edge joins, from its key alone: `tier:i,j,dir`. */
function nodesOf(edge) {
  const m = /^(\d+):(-?\d+),(-?\d+),(\d)$/.exec(edge.key);
  if (!m) return null;
  const tier = +m[1];
  const i = +m[2];
  const j = +m[3];
  const dir = +m[4];
  return [
    { id: `${tier}:${i},${j}`, i, j, tier },
    { id: `${tier}:${dir === 0 ? i + 1 : i},${dir === 0 ? j : j + 1}`, i: dir === 0 ? i + 1 : i, j: dir === 0 ? j : j + 1, tier },
  ];
}

/** Unit tangent leaving `end` (0 = the edge's first point, 1 = its last) along the geometry. */
function awayTangent(edge, end) {
  const n = edge.pts.length / 2;
  const k = end === 0 ? 0 : n - 1;
  const k2 = end === 0 ? 1 : n - 2;
  const dx = edge.pts[k2 * 2] - edge.pts[k * 2];
  const dz = edge.pts[k2 * 2 + 1] - edge.pts[k * 2 + 1];
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(58)} ${String(got).padStart(14)}   want ${want}`);
};

console.log(`\nWANDEROAD — DO TWO ROADS LEAVE A JUNCTION THE SAME WAY?\n${'-'.repeat(84)}`);
console.log(`${HALF * 2} m box, nodes identified from edge keys (not from rounded coordinates)\n`);

let worstPct = 0;
const rows = [];
for (const seed of SEEDS) {
  const edges = edgesInBox(-HALF, -HALF, HALF, HALF, seed, 0);
  /** node id -> [{key, tangent}] */
  const at = new Map();
  const scratch = [0, 0];
  for (const e of edges) {
    const nodes = nodesOf(e);
    if (!nodes) continue;
    // which end of the geometry is which node: compare the first point to node A's position
    nodePos(nodes[0].i, nodes[0].j, nodes[0].tier, seed, scratch);
    const dA = Math.hypot(e.pts[0] - scratch[0], e.pts[1] - scratch[1]);
    const n = e.pts.length / 2;
    const dB = Math.hypot(e.pts[(n - 1) * 2] - scratch[0], e.pts[(n - 1) * 2 + 1] - scratch[1]);
    const firstIsA = dA <= dB;
    for (const [end, node] of [
      [0, firstIsA ? nodes[0] : nodes[1]],
      [1, firstIsA ? nodes[1] : nodes[0]],
    ]) {
      if (!at.has(node.id)) at.set(node.id, []);
      at.get(node.id).push({ key: e.key, t: awayTangent(e, end) });
    }
  }

  let pairs = 0;
  let braided = 0;
  let worst = 180;
  let worstAt = '';
  const examples = [];
  for (const [id, list] of at) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const dot = list[a].t[0] * list[b].t[0] + list[a].t[1] * list[b].t[1];
        const sep = Math.acos(Math.max(-1, Math.min(1, dot))) * DEG;
        pairs++;
        if (sep < BRAIDED_DEG) {
          braided++;
          if (examples.length < 3) examples.push(`${id}: ${list[a].key} vs ${list[b].key} only ${sep.toFixed(0)} deg apart`);
        }
        if (sep < worst) {
          worst = sep;
          worstAt = `${id} (${list[a].key} vs ${list[b].key})`;
        }
      }
    }
  }
  const pct = pairs ? (100 * braided) / pairs : 0;
  worstPct = Math.max(worstPct, pct);
  rows.push({ seed, nodes: at.size, pairs, braided, pct, worst, worstAt });
  console.log(`  seed ${String(seed).padStart(9)}: ${String(at.size).padStart(4)} nodes, ${String(pairs).padStart(4)} pairs — ${String(braided).padStart(3)} braided (${pct.toFixed(1)}%), tightest separation ${worst.toFixed(0)} deg at ${worstAt}`);
  for (const ex of examples) console.log(`      ${ex}`);
}

console.log('');
check(worstPct <= BAR_PCT, `pairs of roads leaving a node under ${BRAIDED_DEG} deg apart`, `${worstPct.toFixed(1)}% worst seed`, `<= ${BAR_PCT}%`);
const anyNodes = rows.every((r) => r.nodes > 20 && r.pairs > 20);
check(anyNodes, 'the measurement actually found a network to measure', rows.map((r) => r.pairs).join('/'), '> 20 pairs each');

console.log(`\n${failures ? `${failures} SPREAD CHECK(S) FAILED` : 'all junction-spread checks passed'}\n`);
process.exit(failures ? 1 : 0);
