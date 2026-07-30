// created by AI
/* Wanderoad — is loot actually there, at the density docs/BOAT-PLAN.md promises?
 *
 *   node tools/diag-loot.mjs [seed]
 *
 * No renderer: this calls the same two pure placement functions src/render/loot.js's Loot
 * class calls (sunsInBox, gemsForTile) directly.
 *
 * Suns are measured off a REAL, connected drive — the same walk tools/diag-stations.mjs uses
 * (walkOptions/driveRoute/edgeAt, duplicated here for the same reason that file's own comment
 * on box-vs-route measurement gives: a map-wide average can look fine while one real corridor
 * a driver actually follows is starved or flooded). Gems are measured over a real 6 km square,
 * because a gem has no road to walk — it lives on open water instead.
 */
import { connects, nodePos, edgesInBox } from '../src/world/roads.js';
import { sunsInBox, gemsForTile, GEM_TILE, SUN_SLOT_P, GEM_ACCEPT_P } from '../src/world/loot.js';
import { hash2i } from '../src/core/math.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
let FAILED = 0;
const check = (ok, what) => {
  if (!ok) FAILED++;
  return ok ? 'ok' : `FAIL <- ${what}`;
};

const F = 1 / 4294967296;
const OPP = { E: 'W', W: 'E', S: 'N', N: 'S' };

/** The up-to-4 arterial edges leaving lattice node (i, j) — copied from tools/diag-stations.mjs,
 *  which does not export it (a script, not a module). */
function walkOptions(i, j, seed) {
  const opts = [];
  if (connects(i, j, 0, 0, seed)) opts.push({ dir: 'E', ni: i + 1, nj: j, ei: i, ej: j, edir: 0, fwd: true });
  if (connects(i - 1, j, 0, 0, seed)) opts.push({ dir: 'W', ni: i - 1, nj: j, ei: i - 1, ej: j, edir: 0, fwd: false });
  if (connects(i, j, 1, 0, seed)) opts.push({ dir: 'S', ni: i, nj: j + 1, ei: i, ej: j, edir: 1, fwd: true });
  if (connects(i, j - 1, 1, 0, seed)) opts.push({ dir: 'N', ni: i, nj: j - 1, ei: i, ej: j - 1, edir: 1, fwd: false });
  return opts;
}

/** A deterministic, connected chain of arterial edges — a real drive, not a box sample. */
function driveRoute(seed, walkSalt, hops, startI, startJ) {
  let i = startI;
  let j = startJ;
  let cameFrom = null;
  const route = [];
  for (let h = 0; h < hops; h++) {
    const opts = walkOptions(i, j, seed);
    if (!opts.length) break;
    let pool = cameFrom ? opts.filter((o) => o.dir !== cameFrom) : opts;
    if (!pool.length) pool = opts;
    const hh = hash2i(i * 2654435761 + j * 40503, h, seed ^ walkSalt) * F;
    const pick = pool[Math.min(pool.length - 1, Math.floor(hh * pool.length))];
    route.push(pick);
    cameFrom = OPP[pick.dir];
    i = pick.ni;
    j = pick.nj;
  }
  return route;
}

/** The one real edge object (as edgesInBox would hand it out) for a specific (i, j, dir). */
function edgeAt(i, j, dir, seed) {
  const p0 = nodePos(i, j, 0, seed, [0, 0]);
  const i1 = dir === 0 ? i + 1 : i;
  const j1 = dir === 0 ? j : j + 1;
  const p1 = nodePos(i1, j1, 0, seed, [0, 0]);
  const pad = 1600;
  const x0 = Math.min(p0[0], p1[0]) - pad;
  const x1 = Math.max(p0[0], p1[0]) + pad;
  const z0 = Math.min(p0[1], p1[1]) - pad;
  const z1 = Math.max(p0[1], p1[1]) + pad;
  const key = `0:${i},${j},${dir}`;
  for (const e of edgesInBox(x0, z0, x1, z1, seed, 0)) if (e.key === key) return e;
  return null;
}

function edgeLength(e) {
  let s = 0;
  for (let k = 2; k < e.pts.length; k += 2) s += Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]);
  return s;
}

console.log(`=== loot: sun density along a real route, gem density over open water — seed ${SEED} ===\n`);
console.log(`SUN_SLOT_P ${SUN_SLOT_P}   GEM_ACCEPT_P ${GEM_ACCEPT_P}\n`);

/* ── 1. suns/km along a real, connected drive ─────────────────────────────── */
console.log('--- 1. suns along a real, connected drive ---');
const HOPS = 220;
const route = driveRoute(SEED, 0xc01e, HOPS, 0, 0);
let routeM = 0;
let sunCount = 0;
const clusterSet = new Set();
for (const pick of route) {
  const e = edgeAt(pick.ei, pick.ej, pick.edir, SEED);
  if (!e) continue;
  const total = edgeLength(e);
  const pad = 30; // clears the sun's own small lateral jitter plus the query-box expansion
  const suns = sunsInBox(e.minX - pad, e.minZ - pad, e.maxX + pad, e.maxZ + pad, SEED);
  const mine = `co:${e.key}:`;
  for (const c of suns) {
    if (!c.id.startsWith(mine)) continue; // belongs to a neighbouring edge whose box overlaps
    sunCount++;
    clusterSet.add(c.id.split(':')[2]); // the slot index — one cluster per accepted slot
  }
  routeM += total;
}
const sunsPerKm = routeM > 0 ? sunCount / (routeM / 1000) : 0;
console.log(`  ${(routeM / 1000).toFixed(1)} km of real connected arterial (${HOPS} hops)`);
console.log(`  ${sunCount} suns in ${clusterSet.size} clusters — ${sunsPerKm.toFixed(1)} suns/km`);
console.log(`${check(sunsPerKm >= 0.5 && sunsPerKm <= 2.5, `suns/km ${sunsPerKm.toFixed(1)} outside [0.5, 2.5]`)}  suns/km within [0.5, 2.5]\n`);

/* ── 2. gems over a real 6 km square ────────────────────────────────────────── */
console.log('--- 2. gems over a 6 km square ---');
const HALF = 3000;
const gi0 = Math.floor(-HALF / GEM_TILE);
const gi1 = Math.floor(HALF / GEM_TILE);
const gems = [];
for (let gj = gi0; gj <= gi1; gj++) {
  for (let gi = gi0; gi <= gi1; gi++) {
    const g = gemsForTile(gi, gj, SEED);
    if (g) gems.push(g);
  }
}
const areaKm2 = ((HALF * 2) / 1000) ** 2;
console.log(`  ${gems.length} gems over ${areaKm2.toFixed(1)} km² of the shipped seed (${(gems.length / areaKm2).toFixed(2)}/km²)`);

/* "at least 3 gems within 1.5 km of SOME open-water point" — every placed gem IS an open-water
 * point (gemsForTile's own gate order guarantees that), so the densest gem-centred
 * neighbourhood among the gems themselves is exactly that measurement, without guessing at a
 * lake centre a second, independent way. */
let best = 0;
let bestAt = null;
for (const a of gems) {
  let n = 0;
  for (const b of gems) if (Math.hypot(a.x - b.x, a.z - b.z) <= 1500) n++;
  if (n > best) {
    best = n;
    bestAt = a;
  }
}
console.log(
  `  densest 1.5 km neighbourhood: ${best} gems` + (bestAt ? ` (centred near ${bestAt.x.toFixed(0)}, ${bestAt.z.toFixed(0)})` : '')
);
console.log(
  `${check(best >= 3, `no 1.5 km neighbourhood in the square has 3+ gems (best: ${best})`)}  >= 3 gems within 1.5 km of some open-water point\n`
);

console.log(`${FAILED === 0 ? 'loot: OK' : `loot: ${FAILED} FAILED`}`);
process.exitCode = FAILED === 0 ? 0 : 1;

/* ── A SUN MUST NOT DRAW THROUGH THE ROAD ────────────────────────────────────
 * Operator: "make it so that suns are not glitching through the road, but are hovering slightly above
 * the road."
 *
 * The clipping arrived with the rays. A sun was a flat disc of radius SUN_R, and SUN_HOVER was set to
 * clear that; it is now a star whose spokes reach SUN_R + SUN_R*SUN_RAY_LEN from the centre, and the
 * bob swings it further down again. Nobody re-derived the hover, so the lowest spoke ended up 0.59 m
 * under the tarmac.
 *
 * This checks the RELATIONSHIP rather than the number, so making the sun bigger again cannot silently
 * re-break it — that is exactly the failure mode this is here to catch.
 */
{
  const { SUN_HOVER } = await import('../src/world/loot.js');
  const { SUN_R, SUN_RAY_LEN, SUN_BOB_AMP } = await import('../src/render/loot.js');
  const reach = SUN_R + SUN_R * SUN_RAY_LEN; // the tip of the longest spoke, from the centre
  const lowest = SUN_HOVER - SUN_BOB_AMP - reach; // its lowest point over a whole bob cycle
  console.log(
    `\n-- a sun clears the road --\n       hover ${SUN_HOVER} m, spokes reach ${reach.toFixed(2)} m, bob ${SUN_BOB_AMP} m ` +
      `-> lowest point ${lowest.toFixed(2)} m above the surface`
  );
  const ok1 = lowest > 0.05;
  const ok2 = SUN_HOVER < 2.2;
  console.log(`${ok1 ? ' PASS' : ' FAIL'}  the lowest spoke stays above the road                  ${lowest.toFixed(2)} m   want > 0.05 m`);
  console.log(`${ok2 ? ' PASS' : ' FAIL'}  and it hovers, rather than floating out of reach       ${SUN_HOVER} m   want < 2.2 m`);
  if (!ok1 || !ok2) process.exitCode = 1;
}
