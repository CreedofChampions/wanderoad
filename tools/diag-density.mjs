/* Wanderoad — how much road is actually left after the culls?
 *
 * This file exists because of a specific mistake. Two independent, individually sensible culls
 * were added to `roads.js` — "a lane must not stop in the middle of nowhere" and "a road must
 * not be built straight across a lake" — and each was verified against the thing it was FOR
 * (dead ends went to zero, open-water causeway went under the bar) and neither was ever
 * verified against the thing it COST. Together they removed roughly a third of the world's
 * road, and they did it multiplicatively: the water cull deletes a link, that drops a node's
 * live degree to one, and the dead-end cull then removes the surviving lane off that node too.
 *
 * The player noticed before any check did — a run-up now lands on a lone straight arterial with
 * nothing to turn off onto. In a game whose entire activity is driving on roads, road density
 * is a first-class quantity and it needs a number, not a vibe.
 *
 * So this tool prices EVERY cull separately, at the same lattice the enumerator walks, through
 * `linkAudit` (roads.js) so there is no second opinion about what is culled:
 *
 *   hash-only    the raw lattice, both culls off — the ceiling
 *   HEAD         dead-end cull on the HASH degree — what shipped before this round
 *   water-only   water cull on, dead-end cull off
 *   live         what the game builds today
 *
 * Junction density is reported alongside kilometres because they fail differently: you can
 * lose a modest amount of length and still gut the lattice, and it is the LATTICE — somewhere
 * to turn off — that makes a road network feel like a place rather than a corridor.
 *
 *   node tools/diag-density.mjs
 */

import { TIERS, connects, degreeAt, linkAudit } from '../src/world/roads.js';
import { fieldTag } from '../src/world/field.js';

/* Five seeds, the same five every run, so a before/after diff means something. 20260726 is the
 * shipped default. */
const SEEDS = [1, 3, 7, 20260726, 424242];
/* A 3 km square about the origin: big enough to hold a couple of arterial cells and a real
 * patch of lane lattice, small enough that the water cull's per-edge sampling stays quick. */
const HALF = 1500;

/** The dead-end cull as it was at HEAD: judged on the HASH degree, which cannot see water. */
function hashLeaf(i, j, dir, tier, seed) {
  if (tier !== 1) return false;
  const fi = dir === 0 ? i + 1 : i;
  const fj = dir === 0 ? j : j + 1;
  return degreeAt(fi, fj, tier, seed) <= 1 || degreeAt(i, j, tier, seed) <= 1;
}

const MODES = ['hash', 'head', 'water', 'live'];

/** Score one seed's box under every mode at once, so each edge is audited exactly once. */
function scoreSeed(seed) {
  const tag = fieldTag(seed);
  const acc = {};
  for (const m of MODES) acc[m] = { edges: 0, len: 0, t0: 0, t1: 0, len0: 0, len1: 0, wet: 0, worst: 0 };
  /* live-degree tallies per mode, keyed `tier:i,j`, so junctions can be counted from the same
   * pass rather than from a second, differently-culled walk of the lattice. */
  const deg = {};
  for (const m of MODES) deg[m] = new Map();

  const bump = (m, tier, i, j, dir, len, wet, worst) => {
    const a = acc[m];
    a.edges++;
    a.len += len;
    a.wet += wet;
    if (worst > a.worst) a.worst = worst;
    if (tier === 0) {
      a.t0++;
      a.len0 += len;
    } else {
      a.t1++;
      a.len1 += len;
    }
    const fi = dir === 0 ? i + 1 : i;
    const fj = dir === 0 ? j : j + 1;
    const d = deg[m];
    for (const k of [`${tier}:${i},${j}`, `${tier}:${fi},${fj}`]) d.set(k, (d.get(k) ?? 0) + 1);
  };

  for (let tier = 0; tier < TIERS.length; tier++) {
    const cell = TIERS[tier].cell;
    const i0 = Math.floor(-HALF / cell) - 1;
    const i1 = Math.floor(HALF / cell) + 1;
    for (let j = i0; j <= i1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (let dir = 0; dir < 2; dir++) {
          const a = linkAudit(i, j, dir, tier, seed, tag);
          if (!a.hashed) continue;
          bump('hash', tier, i, j, dir, a.len, a.wetLen, a.wetRun);
          if (!hashLeaf(i, j, dir, tier, seed)) bump('head', tier, i, j, dir, a.len, a.wetLen, a.wetRun);
          if (!a.drowned) bump('water', tier, i, j, dir, a.len, a.wetLen, a.wetRun);
          if (a.live) bump('live', tier, i, j, dir, a.len, a.wetLen, a.wetRun);
        }
      }
    }
  }

  const out = {};
  for (const m of MODES) {
    let junctions = 0;
    for (const d of deg[m].values()) if (d >= 3) junctions++;
    out[m] = { ...acc[m], junctions };
  }
  return out;
}

const km = (m) => (m / 1000).toFixed(1);

console.log('=== road density — what the culls cost ===');
console.log(`five seeds, ${(HALF * 2) / 1000} km square about the origin, both tiers\n`);

const totals = {};
for (const m of MODES) totals[m] = { edges: 0, len: 0, t0: 0, t1: 0, len0: 0, len1: 0, junctions: 0, wet: 0, worst: 0 };

for (const seed of SEEDS) {
  const s = scoreSeed(seed);
  for (const m of MODES) {
    for (const k of Object.keys(totals[m])) if (k !== 'worst') totals[m][k] += s[m][k];
    if (s[m].worst > totals[m].worst) totals[m].worst = s[m].worst;
  }
  const row = MODES.map((m) => `${String(s[m].edges).padStart(4)} / ${km(s[m].len).padStart(6)} km`);
  console.log(`seed ${String(seed).padEnd(9)} ${MODES.map((m, x) => `${m}: ${row[x]}`).join('   ')}`);
}

console.log('');
console.log('mode        edges     km    arterial      lane      junctions   causeway  longest');
for (const m of MODES) {
  const t = totals[m];
  console.log(
    `${m.padEnd(10)} ${String(t.edges).padStart(5)} ${km(t.len).padStart(7)}` +
      `   ${String(t.t0).padStart(3)}/${km(t.len0).padStart(5)}km` +
      `  ${String(t.t1).padStart(4)}/${km(t.len1).padStart(6)}km` +
      `   ${String(t.junctions).padStart(5)}` +
      `   ${km(t.wet).padStart(6)}km  ${t.worst.toFixed(0).padStart(5)}m`,
  );
}

const head = totals.head;
const live = totals.live;
const lenKeep = live.len / head.len;
const edgeKeep = live.edges / head.edges;
const jctKeep = live.junctions / Math.max(head.junctions, 1);
const artKeep = live.len0 / Math.max(head.len0, 1e-9);

console.log('');
console.log(`kept vs HEAD   length ${(lenKeep * 100).toFixed(1)}%   edges ${(edgeKeep * 100).toFixed(1)}%` +
  `   junctions ${(jctKeep * 100).toFixed(1)}%   arterial length ${(artKeep * 100).toFixed(1)}%`);
console.log(`  of which water cull alone: ${((totals.water.len / totals.hash.len) * 100).toFixed(1)}% of the raw lattice kept`);
console.log(`  dead-end cull alone (HEAD): ${((head.len / totals.hash.len) * 100).toFixed(1)}%`);

/* THE BARS, AND WHAT THEY ARE FOR.
 *
 * These are TRIPWIRES, not targets. They sit a couple of points under what the network measures
 * today, and their whole job is that the next cull to be added here cannot quietly take another
 * third of the world before anyone opens a screenshot. Do not read them as "77% is the goal".
 *
 * They are not at 100% because removing lake crossings genuinely costs road and is supposed to.
 * The trade is real and it is steep — swept across thresholds, the frontier on this world's
 * water runs roughly:
 *
 *   length kept   causeway left   longest causeway
 *      100%          77.5 km          2430 m     no water cull at all
 *       92%          50.4 km          2430 m     lanes culled, arterials never
 *       78%          10.6 km           509 m     CAUSEWAY_SPAN = [520, 150]  <- shipped
 *       72%           4.3 km           300 m
 *       62%           0.5 km            99 m     one tier-blind ~100 m bar (the 35% collapse)
 *
 * There is no setting that keeps both, because this world's lakes are wider than an arterial
 * cell: 41% of arterial edges touch open water at all, and 23% of them cross more than 500 m of
 * it. [520, 150] is the chosen point — the 2.5 km embankment out of spawn that the operator
 * pointed at is gone, nothing longer than 630 m survives anywhere in 144 km² (diag-causeway),
 * and the player keeps four fifths of their road instead of five eighths. */
const bars = [
  ['total road length', lenKeep, 0.75],
  ['junction count', jctKeep, 0.66],
  ['arterial length', artKeep, 0.74],
];
console.log('');
let ok = true;
for (const [label, got, want] of bars) {
  const pass = got >= want;
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${label} kept ${(got * 100).toFixed(1)}% of HEAD (bar: ${(want * 100).toFixed(0)}%)`);
}
console.log(`\n${ok ? 'PASS' : 'FAIL'} — road density after the culls`);
process.exit(ok ? 0 : 1);
