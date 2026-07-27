/* Wanderoad — does the game ever hand you a car that is already in the water?
 *
 * The operator's report: "its a buggy mess still starting on water". findSpawn() (the
 * function behind the very first spawn, the R key's fallback, and the water rescue's
 * fallback) scores candidates on steepness and distance from a hint point and, until this
 * fix, had NO water check anywhere — including its own last-resort fallback, which used to
 * hand back the hint point completely unvalidated whenever no tier-0 arterial edge was found
 * nearby.
 *
 * THE MECHANISM, confirmed by direct measurement (not assumed): a road CUTTING can duck
 * below the local water table while the raw land at that exact point stays dry. A road's
 * height is smoothed over a ~200 m window and clamped to at most 18 m of cut from the land
 * (see MAX_EARTHWORK in roads.js), so a stretch of road heading down into a valley can sit
 * well below the ground immediately beside it — that is the whole point of a cutting. But
 * profileEdge()'s own water floor (and diag-water.mjs's check, which uses the identical
 * function) only ever asks "is the RAW LAND here underwater" via waterFn() — never "is the
 * ROAD's OWN height here underwater" — so a cutting that dips below a nearby water table
 * while the land at that sample is dry sails through both checks untouched. Measured: seed 15
 * at (2161, 3164), tier-0 edge 0:1,1,1 sample 6 — raw land 8.33 m (dry), e.y[k] -2.04 m (the
 * road's OWN height, unchanged by any cross-edge blending), water table 0.20 m: the road is
 * 2.25 m UNDER water while every existing check calls the spot dry. This is a variant of the
 * bug findSpawn's own header describes ("the carve there sits below the water table"), and it
 * is exactly why findSpawn (and backToRoad) must check the ACTUAL drivable height
 * (Terrain.height()) against the water table directly, never the raw land and never an
 * edge's own pre-computed floor.
 *
 * Everything below is measured against that same direct check — Terrain.height() vs
 * waterLevelAt() — computed independently in THIS file (not imported from the fix), so this
 * is never just asking the fix whether it agrees with itself.
 *
 *   A. findSpawn(seed)                      — the exact call main.js makes on first load.
 *   B. findSpawn(seed, hintX, hintZ)         — hint placed AT the worst real point the road
 *                                              network itself produces for that seed (see
 *                                              worstRoadPoint below) — the shape of call
 *                                              backToRoad()'s fallback makes when R is pressed
 *                                              near one of these cuttings with no road in
 *                                              range at all.
 *   C. the last-resort fallback, direct      — findSpawn's own "no arterial nearby" path,
 *                                              forced with the same adversarial hints, since
 *                                              triggering it naturally needs a >3 km-wide hole
 *                                              in the road lattice that essentially never
 *                                              happens — see the note inside findSpawn.
 *   D. backToRoad()'s own logic, replicated  — nearest-road query, else findSpawn — with the
 *                                              car starting exactly AT the worst point, which
 *                                              is what "drive near a bad cutting, press R"
 *                                              actually looks like: the nearest road IS that
 *                                              cutting. rescue.js delegates 100% of ITS
 *                                              positioning to this same function (see
 *                                              rescue.js _place(): the only thing it does on
 *                                              its own is choose a heading, at the (x, z)
 *                                              recover() already picked), so this section
 *                                              stands in for the water rescue too.
 *
 * Section D's backToRoadLike() is hand-kept in sync with main.js's backToRoad() — the same
 * arrangement tools/bench-rescue.mjs already uses for its recover() stub, and for the same
 * reason: main.js boots a WebGLRenderer at import time and cannot be imported under Node.
 *
 *   node tools/diag-spawn-water.mjs
 */
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { waterLevelAt, BIOME_COUNT } from '../src/world/biomes.js';

let isDryAt = null,
  findDrySpot = null;
try {
  // Only present after the fix. Section C prints a note instead of failing when these are
  // not there yet, so this one file runs before AND after and the diff is exactly the fix.
  ({ isDryAt, findDrySpot } = await import('../src/world/terrain.js'));
} catch {
  /* ignore */
}

/* 30 deterministic "real" seeds: the shipped default plus 29 spread across the uint32 range
 * by a small fixed PRNG, so the list is reproducible and was not hand-picked to flatter
 * either the before or the after number. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0xc0ffee);
const SEEDS = [20260726];
while (SEEDS.length < 30) SEEDS.push((rnd() * 4294967296) >>> 0);

const DRY_MARGIN = 0.5; // the clearance the task calls for; kept local, not imported, so this
// file can judge the pre-fix code too, which exports no such constant.

/** Metres a point's ACTUAL drivable ground (Terrain.height, roads included) sits above the
 *  local water table. Negative means underwater. Built directly on waterLevelAt() — asking it
 *  for the table height unconditionally via groundY = -Infinity, the same trick the fix uses
 *  in terrain.js's own waterMargin() — computed independently here, against a fresh small
 *  Terrain, so this file is never just asking the fix whether it agrees with itself. */
function marginAt(seed, x, z) {
  const t = new Terrain(seed, x - 150, z - 150, x + 150, z + 150, 120);
  const y = t.height(x, z);
  const { w } = t.weights(x, z);
  const wl = waterLevelAt(w, -Infinity);
  return wl === null ? Infinity : y - wl;
}

/** The worst (lowest water-margin) point on the REAL tier-0 road network within R of the
 *  origin, for one seed — i.e. exactly the kind of point findSpawn's candidate loop looks at,
 *  and exactly the kind of point t.roads.query() can hand back to backToRoad(). This is what
 *  manufactures a realistic adversarial hint: not an arbitrary lake, a real cutting. */
function worstRoadPoint(seed, R = 3000) {
  const t = new Terrain(seed, -R, -R, R, R, 120);
  const w0 = new Float32Array(BIOME_COUNT);
  let worst = null;
  for (const e of t.roads.edges) {
    if (e.tier !== 0) continue;
    const n = e.pts.length / 2;
    for (let k = 1; k < n - 1; k++) {
      const x = e.pts[k * 2],
        z = e.pts[k * 2 + 1];
      const y = t.height(x, z);
      const { w } = t.weights(x, z, w0);
      const wl = waterLevelAt(w, -Infinity);
      const margin = wl === null ? Infinity : y - wl;
      if (!worst || margin < worst.margin) worst = { x, z, margin };
    }
  }
  return worst;
}

/** Mirrors main.js's backToRoad(). Kept honest by hand — see the header note. */
function backToRoadLike(seed, carX, carZ) {
  const t = new Terrain(seed, carX - 420, carZ - 420, carX + 420, carZ + 420, 120);
  const q = t.roads.query(carX, carZ);
  if (isFinite(q.d) && (!isDryAt || isDryAt(q.qx, q.qz, seed))) {
    return { x: q.qx, z: q.qz };
  }
  const s = findSpawn(seed, carX, carZ);
  return { x: s.x, z: s.z };
}

function report(label, rows) {
  const bad = rows.filter((r) => r.margin < DRY_MARGIN);
  const worst = rows.reduce((m, r) => Math.min(m, r.margin), Infinity);
  console.log(`\n${label}`);
  console.log(`  ${rows.length} tried, ${bad.length} within ${DRY_MARGIN} m of water (or under it), worst margin ${worst === Infinity ? 'n/a' : worst.toFixed(2)} m`);
  for (const r of bad) {
    const tag = r.margin < 0 ? `UNDERWATER by ${(-r.margin).toFixed(2)} m` : `only ${r.margin.toFixed(2)} m clear`;
    console.log(`    seed ${r.seed}  (${r.x.toFixed(0)}, ${r.z.toFixed(0)})  ${tag}`);
  }
  return bad.length;
}

console.log(`(scanning the real road network for the worst point per seed — this takes a little while)`);
const WORST = SEEDS.map((seed) => ({ seed, ...worstRoadPoint(seed) }));
console.log(
  `worst point actually present on the road network, per seed: ${WORST.filter((w) => w.margin < DRY_MARGIN).length}/${WORST.length} seeds have one within ${DRY_MARGIN} m of water`,
);

let failures = 0;

/* ── A. findSpawn(seed) — the real boot call ─────────────────────────────────── */
{
  const rows = SEEDS.map((seed) => {
    const sp = findSpawn(seed);
    return { seed, x: sp.x, z: sp.z, margin: marginAt(seed, sp.x, sp.z) };
  });
  failures += report('A. findSpawn(seed) — boot spawn, hint (0,0)', rows);
}

/* ── B. findSpawn(seed, hint) — hint AT the worst real road point ───────────── */
{
  const rows = WORST.map(({ seed, x: hx, z: hz }) => {
    const sp = findSpawn(seed, hx, hz);
    return { seed, x: sp.x, z: sp.z, margin: marginAt(seed, sp.x, sp.z) };
  });
  failures += report('B. findSpawn(seed, hint) — hint at the worst real road point for that seed', rows);
}

/* ── C. the last-resort fallback, forced directly ────────────────────────────── */
if (findDrySpot) {
  const rows = WORST.map(({ seed, x: hx, z: hz }) => {
    const sp = findDrySpot(seed, hx, hz);
    return { seed, x: sp.x, z: sp.z, margin: marginAt(seed, sp.x, sp.z) };
  });
  failures += report('C. findDrySpot(seed, hint) — fallback forced directly, hint at the worst real road point', rows);
} else {
  console.log('\nC. findDrySpot — not present yet (pre-fix run). By inspection: the old fallback');
  console.log('   `best || { x: hintX, z: hintZ, ... }` returns the hint VERBATIM with zero check.');
}

/* ── D. backToRoad()'s own logic, car starting at the worst point ───────────── */
{
  const rows = WORST.map(({ seed, x: hx, z: hz }) => {
    const p = backToRoadLike(seed, hx, hz);
    return { seed, x: p.x, z: p.z, margin: marginAt(seed, p.x, p.z) };
  });
  failures += report('D. backToRoad() replica — car starts at the worst real road point (R press / rescue near a bad cutting)', rows);
}

console.log(`\n${failures ? `${failures} WET RESULT(S)` : 'ALL DRY'}\n`);
process.exit(0); // diagnostic, not a gate — the numbers are the point, see npm test for the gates
