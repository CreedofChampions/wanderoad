/* Wanderoad — is a real over-45° point a single road's own batter, or two roads' earthworks
 * overlapping? Both are checkable from Node: RoadField.carve() and Terrain.height() are the
 * exact functions the game samples, so a profile walked through them here is the profile the
 * player drives past.
 *
 * Written to diagnose the operator's "road cuttings read as stark cliffs" report. What it
 * found: 53 of 59 over-45° points in the standard window sat within carve()'s reach of TWO
 * road edges at once, and the worst of those was a 79.8° near-vertical face built from two
 * edges that were each individually well-behaved — a short lane, geometrically nearest but
 * already past its own narrow shoulder, was setting `out.d` while a distant, deeper arterial
 * cutting was setting `out.y`/target; groundFromCarve (terrain.js) then sized a wide shoulder
 * from the arterial's drop and evaluated it at the lane's much shorter distance. The same class
 * of mismatch, one edge alone this time, showed up wherever that edge's OWN capped-drop weight
 * (roads.js) crossed terrain.js's mask<=0.001 cutoff at a different point than its uncapped
 * falloff (terrain.js) actually went quiet. Both fixed in RoadField.carve(): `d` is now blended
 * the same weighted way as `y`/`width` rather than tracked separately, and the per-edge weight
 * uses the same uncapped drop terrain.js's own batter formula already did. Kept as a permanent
 * check: this file re-measures both symptoms on every run, so a future change to the batter
 * that reopens either mismatch shows up here, not just as a lower diag-cliffs.mjs percentage.
 *
 * Two things measured, separately:
 *   1. Of the real steep points diag-cliffs.mjs already finds, how many sit where MORE THAN
 *      ONE road edge is within carve()'s own reach of the point (a real crossing/overlap zone)
 *      versus where only one edge is anywhere near?
 *   2. The actual height PROFILE through the worst real multi-edge point and the worst real
 *      single-edge point found in part 1 — land, the carve's blended target, and the final
 *      ground height, walked along the local gradient so it is guaranteed to cross whatever
 *      the steepest part is. Peak gradient in degrees, not just the pass/fail cliff percentage.
 *
 *   node tools/diag-batter.mjs
 */
import { Terrain, landHeight } from '../src/world/terrain.js';
import { findCrossings } from '../src/world/roads.js';
import { segDist } from '../src/core/math.js';

const SEED = 20260726;

/** Replica of RoadField.carve()'s own reach test — read-only, exercises the public edge
 *  fields carve() itself reads, so it can report "how many edges are actually in range" at a
 *  point without needing carve() to expose that count itself. */
function edgesInReach(roads, x, z) {
  const out = [];
  for (const e of roads.edges) {
    const half = e.width * 0.5;
    const reach = half + e.verge * 2.6 + 60;
    if (x < e.minX - reach || x > e.maxX + reach || z < e.minZ - reach || z > e.maxZ + reach) continue;
    let ed = Infinity,
      ey = 0;
    for (let k = 0; k < e.segs; k++) {
      const ax = e.pts[k * 2],
        az = e.pts[k * 2 + 1];
      const bx = e.pts[k * 2 + 2],
        bz = e.pts[k * 2 + 3];
      const r = segDist(x, z, ax, az, bx, bz);
      if (r.d < ed) {
        ed = r.d;
        ey = e.y[k] + (e.y[k + 1] - e.y[k]) * r.t;
      }
    }
    if (ed <= reach) out.push({ e, ed, ey, half });
  }
  return out;
}

// ── part 1: of the real cliffs, how many are multi-edge zones? ─────────────────────────────
const R = 1200,
  STEP = 4;
const T = new Terrain(SEED, -R, -R, R, R);
let steep = [];
for (let x = -R; x < R; x += STEP) {
  for (let z = -R; z < R; z += STEP) {
    const n = T.normal(x, z, 2.5);
    const deg = Math.acos(Math.min(1, n[1])) * 57.29577951308232;
    if (deg > 45) steep.push({ x, z, deg });
  }
}
let multi = 0,
  single = 0;
let worstMulti = null,
  worstSingle = null;
for (const p of steep) {
  const near = edgesInReach(T.roads, p.x, p.z);
  if (near.length >= 2) {
    multi++;
    if (!worstMulti || p.deg > worstMulti.deg) worstMulti = { ...p, near };
  } else {
    single++;
    if (!worstSingle || p.deg > worstSingle.deg) worstSingle = { ...p, near };
  }
}
console.log(`over-45° samples: ${steep.length} total — ${multi} within reach of 2+ road edges, ${single} within reach of only 1`);
if (worstMulti) console.log(`  worst multi-edge:  ${worstMulti.deg.toFixed(1)}° at (${worstMulti.x},${worstMulti.z}), ${worstMulti.near.length} edges in reach: ${worstMulti.near.map((n) => `${n.e.key}@${n.ed.toFixed(1)}m,y=${n.ey.toFixed(1)}`).join(' | ')}`);
if (worstSingle) console.log(`  worst single-edge: ${worstSingle.deg.toFixed(1)}° at (${worstSingle.x},${worstSingle.z})`);

// ── part 2: real profiles through the worst REAL points part 1 already found ───────────────
// Walked along the local gradient direction (central differences on Terrain.height itself),
// so the walk is guaranteed to cross the steepest part of whichever batter is there, not a
// direction picked by hand.
function gradientDir(x, z, e = 1.0) {
  const hR = T.height(x + e, z),
    hL = T.height(x - e, z);
  const hU = T.height(x, z + e),
    hD = T.height(x, z - e);
  let dx = hR - hL,
    dz = hU - hD;
  const l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

function profileThrough(label, cx, cz, half = 22, step = 1) {
  const [dx, dz] = gradientDir(cx, cz);
  const x0 = cx - dx * half,
    z0 = cz - dz * half;
  const steps = Math.round((half * 2) / step);
  console.log(`\n${label}\n  centred on (${cx.toFixed(1)},${cz.toFixed(1)}), walking the local gradient direction (${dx.toFixed(2)},${dz.toFixed(2)}), ${half * 2}m total`);
  let peakGradDeg = 0,
    peakAt = 0;
  let prevH = null;
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + dx * step * i;
    const z = z0 + dz * step * i;
    const land = landHeight(x, z, SEED);
    const c = T.roads.carve(x, z);
    const h = T.height(x, z);
    const near = edgesInReach(T.roads, x, z);
    rows.push({ s: i * step - half, land, target: c.mask > 0.001 ? c.y : NaN, h, d: c.d, nEdges: near.length });
    if (prevH !== null) {
      const gDeg = Math.atan2(Math.abs(h - prevH), step) * 57.29577951308232;
      if (gDeg > peakGradDeg) {
        peakGradDeg = gDeg;
        peakAt = i * step - half;
      }
    }
    prevH = h;
  }
  for (const r of rows) {
    console.log(
      `   ${r.s.toFixed(1).padStart(6)}m  land ${r.land.toFixed(2).padStart(7)}  target ${(isNaN(r.target) ? '   -   ' : r.target.toFixed(2)).toString().padStart(7)}  h ${r.h.toFixed(2).padStart(7)}  edgeDist ${isFinite(r.d) ? r.d.toFixed(1).padStart(5) : '    -'}  edgesInReach ${r.nEdges}`
    );
  }
  console.log(`   peak gradient ${peakGradDeg.toFixed(1)}° at s=${peakAt.toFixed(1)}m`);
  return peakGradDeg;
}

if (worstMulti) profileThrough(`MULTI-EDGE profile (the worst real overlap point part 1 found, ${worstMulti.near.length} edges in reach)`, worstMulti.x, worstMulti.z);
if (worstSingle) profileThrough('SINGLE-EDGE profile (the worst real lone-cutting point part 1 found)', worstSingle.x, worstSingle.z);

const crossings = findCrossings(T.roads.edges);
console.log(`\n(${crossings.length} real crossings found in the ${2 * R}x${2 * R} m window, for reference)`);
