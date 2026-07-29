/* Wanderoad — which SEED should the game boot into?
 *
 * The operator, on the shipped default (20260726): *"5 roads which go no where"*. He judges the
 * world by the two minutes he spends around the spawn, not by a 144 km² average, so the default
 * seed is a real product decision and it deserves a real measurement.
 *
 * Everything here is scored in a 1.5 km disc around the seed's OWN `findSpawn` result — the
 * exact point main.js hands the player the car — through the same functions the game builds the
 * network from (`linkAudit`, `edgesInBox`, `floodAt`), so there is no second opinion about what
 * is culled or where the water is (gotcha 6, and the "a stub probe lies" trap: no stub probes,
 * the real field).
 *
 * The five numbers, and why each one is the thing the player sees:
 *
 *   deadEnds    live-degree-1 nodes inside the disc, both tiers. This IS his "roads which go no
 *               where" — a node exactly one road reaches, with nothing on the far side. Counted
 *               from nodes via `linkAudit`, which is pure and local, so there is no clip margin
 *               and no boundary artefact (the 31-vs-6 error recorded in diag-deadends.mjs).
 *   causeway    metres of NON-WETLAND open water under the arterial he drives out on, over the
 *               first 4 km in EACH direction, summed — he is handed the car pointing one way
 *               and turns round whenever he likes. Wetland crossings are kept and not counted;
 *               that picture was never the bug.
 *   roadKm      live road length inside the disc. A spawn on a lone arterial is a corridor.
 *   junctions   live-degree >= 3 nodes inside the disc. Somewhere to turn off.
 *   reachKm     road length reachable from the spawn node by live tier-0 links inside 6 km —
 *               "does the road he is standing on actually lead somewhere", asked as a graph
 *               walk rather than as a hope.
 *
 *   node tools/diag-seedpick.mjs [n]        score n candidate seeds (default 24)
 *   node tools/diag-seedpick.mjs --seeds a,b,c
 */

import { TIERS, nodePos, linkAudit, edgesInBox } from '../src/world/roads.js';
import { fieldTag, floodAt } from '../src/world/field.js';
import { findSpawn, Terrain } from '../src/world/terrain.js';

const argv = process.argv.slice(2);
const listArg = argv.find((a) => a.startsWith('--seeds='));
const DISC = 1500; // metres — "around the spawn", the operator's own two minutes
const REACH = 6000; // metres — how far out "leads somewhere" is asked
const DRIVE = 4000; // metres of drive-out scored for causeway

/** The four links that meet at node (i,j): east/south of it, and west/north into it. */
const linksAt = (i, j) => [
  [i, j, 0],
  [i, j, 1],
  [i - 1, j, 0],
  [i, j - 1, 1],
];

function liveDegree(i, j, tier, seed, tag) {
  let n = 0;
  for (const [li, lj, d] of linksAt(i, j)) if (linkAudit(li, lj, d, tier, seed, tag).live) n++;
  return n;
}

/** Live tier-0 road length reachable from the node nearest `(sx,sz)`, within REACH metres. */
function reachable(sx, sz, seed, tag) {
  const cell = TIERS[0].cell;
  const p = [0, 0];
  // nearest tier-0 node to the spawn
  let start = null,
    bd = Infinity;
  const c0 = Math.floor(sx / cell),
    c1 = Math.floor(sz / cell);
  for (let j = c1 - 1; j <= c1 + 1; j++)
    for (let i = c0 - 1; i <= c0 + 1; i++) {
      nodePos(i, j, 0, seed, p);
      const d = Math.hypot(p[0] - sx, p[1] - sz);
      if (d < bd) {
        bd = d;
        start = [i, j];
      }
    }
  if (!start) return 0;
  const seen = new Set([start.join(',')]);
  const q = [start];
  let len = 0;
  const counted = new Set();
  while (q.length) {
    const [i, j] = q.shift();
    for (const [li, lj, d] of linksAt(i, j)) {
      const a = linkAudit(li, lj, d, 0, seed, tag);
      if (!a.live) continue;
      const ek = `${li},${lj},${d}`;
      if (!counted.has(ek)) {
        counted.add(ek);
        len += a.len;
      }
      const ni = d === 0 ? (li === i ? li + 1 : li) : li;
      const nj = d === 0 ? lj : lj === j ? lj + 1 : lj;
      const far = li === i && lj === j ? [ni, nj] : [li, lj];
      const k = far.join(',');
      if (seen.has(k)) continue;
      nodePos(far[0], far[1], 0, seed, p);
      if (Math.hypot(p[0] - sx, p[1] - sz) > REACH) continue;
      seen.add(k);
      q.push(far);
    }
  }
  return len;
}

/** Non-wetland open-water metres under the first DRIVE m of arterial out of the spawn. */
function causewayOut(sx, sz, seed) {
  const arts = edgesInBox(sx - 5000, sz - 5000, sx + 5000, sz + 5000, seed, 0).filter((e) => e.tier === 0);
  let best = null;
  for (const e of arts) {
    const n = e.pts.length / 2;
    for (let k = 0; k < n; k++) {
      const d = Math.hypot(e.pts[k * 2] - sx, e.pts[k * 2 + 1] - sz);
      if (!best || d < best.d) best = { d, e, k };
    }
  }
  if (!best) return { m: Infinity, first: 0, dist: Infinity };
  const e = best.e;
  const n = e.pts.length / 2;
  // score BOTH directions off the spawn point; the player picks one, so take the better.
  const walk = (dir) => {
    let travelled = 0,
      over = 0,
      first = -1;
    for (let k = best.k; k > 0 && k < n - 1 && travelled < DRIVE; k += dir) {
      const a = dir > 0 ? k : k - 1;
      const ax = e.pts[a * 2],
        az = e.pts[a * 2 + 1];
      const bx = e.pts[a * 2 + 2],
        bz = e.pts[a * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const f = floodAt((ax + bx) * 0.5, (az + bz) * 0.5, seed);
      if (f.wet && f.depth > 0.35 && f.marsh < 0.4) {
        over += len;
        if (first < 0) first = travelled;
      }
      travelled += len;
    }
    return { over, first, travelled };
  };
  const a = walk(1),
    b = walk(-1);
  /* BOTH directions are counted, not the better one. The player is handed the car pointing one
   * way and turns round whenever he likes, so a spawn with a clean run one way and a 400 m
   * embankment the other way is a spawn with a 400 m embankment. */
  const worse = a.over >= b.over ? a : b;
  return { m: a.over + b.over, first: worse.first, worst: worse.over, dist: best.d, key: e.key };
}

export function scoreSeed(seed) {
  const tag = fieldTag(seed);
  const sp = findSpawn(seed, 0, 0);
  const sx = sp.x,
    sz = sp.z;

  let deadEnds = 0,
    junctions = 0;
  const p = [0, 0];
  for (let tier = 0; tier < TIERS.length; tier++) {
    const cell = TIERS[tier].cell;
    const i0 = Math.floor((sx - DISC - cell) / cell),
      i1 = Math.floor((sx + DISC + cell) / cell);
    const j0 = Math.floor((sz - DISC - cell) / cell),
      j1 = Math.floor((sz + DISC + cell) / cell);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        nodePos(i, j, tier, seed, p);
        if (Math.hypot(p[0] - sx, p[1] - sz) > DISC) continue;
        const d = liveDegree(i, j, tier, seed, tag);
        if (d === 1) deadEnds++;
        else if (d >= 3) junctions++;
      }
  }

  // live road length inside the disc, from the real enumerator
  let roadM = 0;
  for (const e of edgesInBox(sx - DISC, sz - DISC, sx + DISC, sz + DISC, seed, 0)) {
    const n = e.pts.length / 2;
    for (let k = 0; k < n - 1; k++) {
      const ax = e.pts[k * 2],
        az = e.pts[k * 2 + 1];
      const bx = e.pts[k * 2 + 2],
        bz = e.pts[k * 2 + 3];
      if (Math.hypot((ax + bx) * 0.5 - sx, (az + bz) * 0.5 - sz) > DISC) continue;
      roadM += Math.hypot(bx - ax, bz - az);
    }
  }

  const cw = causewayOut(sx, sz, seed);
  const reachM = reachable(sx, sz, seed, tag);

  /* THE SCORE. Weights chosen so the operator's own two complaints dominate and the rest only
   * breaks ties: a dead end inside his disc costs 60, and a metre of causeway on the road he
   * drives out on costs 0.25 (so the 403 m one on the shipped seed is worth ~1.7 dead ends).
   * Road length and junctions are credited gently — a busier spawn is nicer, but a seed does
   * not win by being dense if it is also full of stumps. */
  const score =
    -60 * deadEnds -
    0.25 * cw.m +
    2.0 * (roadM / 1000) * 5 +
    8 * junctions +
    1.2 * (reachM / 1000);

  return { seed, x: Math.round(sx), z: Math.round(sz), deadEnds, junctions, roadKm: roadM / 1000, causeway: cw.m, causewayFirst: cw.first, causewayWorst: cw.worst, reachKm: reachM / 1000, score };
}

/* ── THE TERRAIN SCREEN, AND WHY THE ROAD SCORE ALONE IS NOT ENOUGH ──────────────────────────
 *
 * The first run of this file picked 21234763 on road quality alone: 0 dead ends in the disc,
 * 15 junctions, 29.1 km of road, 0 m of causeway on the drive out — a clean sweep, and the road
 * network really is better there. Then it was measured against the terrain gates and it was a
 * disaster: `diag-cliffs.mjs` 0.009% -> **0.324%** of ground over 45°, R1 **36 of 1030** points
 * of ground standing proud of the road (want 0, shipped seed reads 0), R2 **4 of 21** crossings
 * out of level, worst **22.44 m** — which is the fall-through class of defect this project spent
 * days eliminating. It is simply a mountainous seed, and the road scorer cannot see mountains.
 *
 * So a candidate has to clear the terrain gates as well, and they are HARD gates, not weights:
 * a seed that is prettier to drive but drops the car through a 22 m crossing step is not a
 * better default at any road score. Same arithmetic as tools/browser-test.mjs's R1 and R2 and
 * tools/diag-cliffs.mjs, on the 840 m box at the seed's own spawn — the box the browser suite
 * itself builds.
 */
export function screenSeed(seed) {
  const sp = findSpawn(seed, 0, 0);
  const t = new Terrain(seed, sp.x - 420, sp.z - 420, sp.x + 420, sp.z + 420);

  // R1: carved ground standing above the road surface.
  let n = 0,
    buried = 0,
    worstOver = 0;
  for (const e of t.roads.edges)
    for (let k = 0; k < e.y.length; k++) {
      const over = t.height(e.pts[k * 2], e.pts[k * 2 + 1]) - e.y[k];
      n++;
      if (over > 0.35) {
        buried++;
        worstOver = Math.max(worstOver, over);
      }
    }

  // R2: two roads crossing at different heights.
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

  // cliffs, diag-cliffs.mjs's own measurement, on a 1.2 km box at the spawn.
  let steep = 0,
    tot = 0;
  for (let x = sp.x - 600; x < sp.x + 600; x += 6)
    for (let z = sp.z - 600; z < sp.z + 600; z += 6) {
      const nn = t.normal(x, z, 2.5);
      tot++;
      if (Math.acos(Math.min(1, nn[1])) * 57.2958 > 45) steep++;
    }

  return { seed, r1: buried, r1n: n, r1worst: worstOver, r2: mismatched, r2n: crossings, r2worst: worstStep, cliffPct: (steep / tot) * 100 };
}

if (process.argv[1].endsWith('diag-seedpick.mjs') && argv[0] === '--hunt') {
  /* GATES FIRST, then rank. The first pass of this file ranked on road quality and then
   * screened the leaders, and all twelve leaders failed R1/R2 — so the screen has to come
   * first or the ranking is over a set that cannot ship. */
  const n = parseInt(argv[1] ?? '', 10) || 300;
  const seeds = [20260726];
  for (let k = 1; k < n; k++) seeds.push((20260726 + k * 7919) >>> 0);
  console.log(`=== hunting ${seeds.length} seeds: R1 = 0 and R2 = 0 first, then road score ===`);
  const kept = [];
  for (const s of seeds) {
    let g;
    try {
      g = screenSeed(s);
    } catch (err) {
      console.log(`skip ${s}: ${err.message}`);
      continue;
    }
    if (g.r1 !== 0 || g.r2 !== 0) continue;
    const r = scoreSeed(s);
    kept.push({ ...r, ...g });
    console.log(
      `PASS ${String(s).padEnd(12)} R1 0/${String(g.r1n).padStart(4)}  R2 0/${String(g.r2n).padStart(3)}  cliffs ${g.cliffPct.toFixed(3)}%` +
        `   dead ${r.deadEnds}  jct ${r.junctions}  road ${r.roadKm.toFixed(2)} km  causeway ${r.causeway.toFixed(0)} m  score ${r.score.toFixed(0)}`,
    );
  }
  kept.sort((a, b) => b.score - a.score);
  console.log(`\n${kept.length} of ${seeds.length} seeds clear R1 = 0 and R2 = 0. Best by road score:`);
  for (const r of kept.slice(0, 12))
    console.log(
      `  ${String(r.seed).padEnd(12)} score ${r.score.toFixed(0).padStart(5)}  dead ${r.deadEnds}  jct ${r.junctions}  road ${r.roadKm.toFixed(2)} km` +
        `  causeway ${r.causeway.toFixed(0)} m  cliffs ${r.cliffPct.toFixed(3)}%  spawn (${r.x},${r.z})`,
    );
} else if (process.argv[1].endsWith('diag-seedpick.mjs')) {
  let seeds;
  if (listArg) seeds = listArg.slice(8).split(',').map(Number);
  else {
    const n = parseInt(argv[0] ?? '', 10) || 24;
    /* Candidates are the shipped seed plus dates around the competition and a spread of round
     * numbers — arbitrary is fine, the SCORE is what decides, but keeping the list fixed means
     * a re-run reproduces the same winner. */
    seeds = [20260726];
    for (let k = 1; k < n; k++) seeds.push((20260726 + k * 7919) >>> 0);
  }

  console.log('=== default-seed pick — scored in a 1.5 km disc around each seed\'s own spawn ===');
  console.log('seed          spawn            dead  jct   roadKm  causeway(m)  reachKm   score');
  const rows = [];
  for (const s of seeds) {
    const t0 = Date.now();
    const r = scoreSeed(s);
    rows.push(r);
    console.log(
      `${String(r.seed).padEnd(12)} (${String(r.x).padStart(6)},${String(r.z).padStart(6)})  ` +
        `${String(r.deadEnds).padStart(4)} ${String(r.junctions).padStart(4)}  ` +
        `${r.roadKm.toFixed(2).padStart(6)}  ${r.causeway.toFixed(0).padStart(6)} (worst dir ${r.causewayWorst.toFixed(0)})  ` +
        `${r.reachKm.toFixed(1).padStart(6)}  ${r.score.toFixed(1).padStart(7)}   ${Date.now() - t0} ms`,
    );
  }
  rows.sort((a, b) => b.score - a.score);
  console.log('\n--- ranked ---');
  for (const r of rows.slice(0, 10)) {
    console.log(
      `${String(r.seed).padEnd(12)} score ${r.score.toFixed(1).padStart(7)}   dead ${r.deadEnds}  jct ${r.junctions}  ` +
        `road ${r.roadKm.toFixed(2)} km  causeway ${r.causeway.toFixed(0)} m  reach ${r.reachKm.toFixed(1)} km  spawn (${r.x},${r.z})`,
    );
  }
  const shipped = rows.find((r) => r.seed === 20260726);
  if (shipped) console.log(`\nshipped 20260726 ranks ${rows.indexOf(shipped) + 1} of ${rows.length}`);

  /* The terrain screen on the leaders, plus the shipped seed for comparison. A candidate is
   * only a better DEFAULT if it clears both — see the note on screenSeed. */
  console.log('\n--- terrain screen on the leaders (hard gates: R1 0, R2 0) ---');
  const screenList = [...rows.slice(0, 12).map((r) => r.seed)];
  if (shipped && !screenList.includes(20260726)) screenList.push(20260726);
  for (const s of screenList) {
    const g = screenSeed(s);
    const road = rows.find((r) => r.seed === s);
    const ok = g.r1 === 0 && g.r2 === 0;
    console.log(
      `${ok ? 'OK  ' : 'REJ '} ${String(s).padEnd(12)} R1 ${String(g.r1).padStart(3)}/${String(g.r1n).padStart(4)} (worst ${g.r1worst.toFixed(2)} m)` +
        `   R2 ${String(g.r2).padStart(2)}/${String(g.r2n).padStart(3)} (worst ${g.r2worst.toFixed(2)} m)` +
        `   cliffs ${g.cliffPct.toFixed(3)}%   roadScore ${road ? road.score.toFixed(0) : '-'}`,
    );
  }
}
