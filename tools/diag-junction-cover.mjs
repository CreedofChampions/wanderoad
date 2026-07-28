/* Wanderoad — does the junction patch actually cover the mess?
 *
 * The operator's screenshot (b), verbatim: "all sorts of lines everywhere, total mess" — a
 * shallow merge where BOTH roads' edge lines and centre dashes carried on straight across each
 * other with nothing masking them.
 *
 * `tools/diag-junction-geom.mjs` already checks that a junction patch is WELL-FORMED (no NaN,
 * faces up, sits on the ground, reaches half the narrower road). None of that is the question
 * here. The question is whether the patch is BIG ENOUGH, and the reason it was not is purely
 * geometric: two carriageways crossing at angle θ overlap over a parallelogram that runs
 * `w / sin θ` along each road, and the patch was built as if θ were always 90°.
 *
 * So this tool measures area, on the real generated network, with the real footprint the
 * renderer uses (`junctionFootprint`, exported from render/road.js so there is one opinion
 * about where a patch is, not two):
 *
 *   overlap        m² where BOTH carriageways exist — the region that must be one paved area
 *   uncovered      m² of that with no junction patch over it
 *   line-on-road   m² where one road's PAINTED BAND (the shader's own edge-line and centre-dash
 *                  bands, read straight off ROAD_FS) lies on the other road's carriageway
 *   uncovered      m² of that with no patch over it — this is the screenshot, in numbers
 *
 * The bands are the shader's, not an approximation of them: `edge` is |across| in 0.80..0.90
 * and `centre` is |across| <= 0.055, and `across` is the ribbon's own -1..1 cross coordinate,
 * i.e. perpendicular distance over the half-width.
 *
 *   node tools/diag-junction-cover.mjs
 */

import { edgesInBox, findCrossings } from '../src/world/roads.js';
import { junctionFootprint, inJunctionFootprint } from '../src/render/road.js';
import { segDist } from '../src/core/math.js';

const SEED = 20260726;
/** Windows walked, each 4 km across. The first is the shipped spawn; the others are ordinary
 *  world picked far from it so the numbers are not one lucky patch of lattice. */
const WINDOWS = [
  [0, 0],
  [1500, -1500],
  [30000, -30000],
  [-4000, 3000],
];
const HALF = 2000;
/** Sample pitch over a crossing, in metres. 0.25 m gives ~0.0625 m² a sample: fine enough that
 *  a 0.1-wide painted band (about 0.4 m of tarmac) is several samples across. */
const PITCH = 0.25;
/** The shader's own marking bands, copied from ROAD_FS. Not re-derived — read off it. */
const EDGE_LO = 0.8,
  EDGE_HI = 0.9,
  CENTRE = 0.055;

/** Perpendicular distance from (x,z) to an edge's polyline, over its own half-width. */
function acrossOf(edge, x, z) {
  const pts = edge.pts;
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const r = segDist(x, z, pts[k], pts[k + 1], pts[k + 2], pts[k + 3]);
    if (r.d < best) best = r.d;
  }
  return best / (edge.width * 0.5);
}

/** Is |a| inside one of the shader's painted bands? */
const painted = (a) => a <= CENTRE || (a >= EDGE_LO && a <= EDGE_HI);

/**
 * The patch as it was at HEAD, for the before/after column: the identical formula with the
 * shallow-angle stretch taken back out, i.e. `other.width/2 + margin` along each tangent.
 * Derived by dividing the live footprint by its own `stretch` rather than by writing the old
 * expression out a second time, so this cannot quietly drift away from what actually shipped.
 */
function headFootprint(f) {
  return { ...f, halfAlongMajor: f.halfAlongMajor / f.stretch, halfAlongMinor: f.halfAlongMinor / f.stretch };
}

function scoreWindow(cx, cz, head) {
  const edges = edgesInBox(cx - HALF, cz - HALF, cx + HALF, cz + HALF, SEED);
  const crossings = findCrossings(edges);
  const feet = crossings.map(junctionFootprint).map((f) => (head ? headFootprint(f) : f));

  const cell = PITCH * PITCH;
  let overlap = 0,
    overlapBad = 0,
    line = 0,
    lineBad = 0;
  let worst = null;

  for (let ci = 0; ci < crossings.length; ci++) {
    const c = crossings[ci];
    const f = feet[ci];
    /* Sample a box big enough to hold the whole theoretical overlap even where the patch has
     * been capped by SHALLOW_CAP — otherwise a patch that is too small would be scored against
     * a window that is also too small and read as perfect. Half the sum of both half-extents
     * over sin θ, plus both widths, is past any of it. */
    const span =
      (f.halfAlongMajor + f.halfAlongMinor) / Math.max(f.sinT, 0.15) + c.a.width + c.b.width;
    const n = Math.ceil(span / PITCH);
    let cOverlap = 0,
      cBad = 0,
      cLine = 0,
      cLineBad = 0;
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const x = c.x + i * PITCH;
        const z = c.z + j * PITCH;
        const aA = acrossOf(c.a, x, z);
        if (aA > 1) continue;
        const aB = acrossOf(c.b, x, z);
        if (aB > 1) continue;
        // both carriageways here: this is overlap
        let covered = false;
        for (const g of feet) {
          if (inJunctionFootprint(g, x, z)) {
            covered = true;
            break;
          }
        }
        cOverlap += cell;
        if (!covered) cBad += cell;
        if (painted(aA) || painted(aB)) {
          cLine += cell;
          if (!covered) cLineBad += cell;
        }
      }
    }
    overlap += cOverlap;
    overlapBad += cBad;
    line += cLine;
    lineBad += cLineBad;
    if (!worst || cLineBad > worst.lineBad) {
      worst = { x: c.x, z: c.z, dev: c.deviationDeg, lineBad: cLineBad, overlapBad: cBad };
    }
  }
  return { crossings: crossings.length, overlap, overlapBad, line, lineBad, worst };
}

console.log('=== junction coverage — is the paved patch big enough to hide the crossing? ===');
console.log(`seed ${SEED}, ${WINDOWS.length} windows of ${(HALF * 2) / 1000} km, sampled at ${PITCH} m\n`);

let tOverlap = 0,
  tOverlapBad = 0,
  tLine = 0,
  tLineBad = 0,
  tCross = 0;
let hOverlapBad = 0,
  hLineBad = 0;
let globalWorst = null;

for (const [cx, cz] of WINDOWS) {
  const h = scoreWindow(cx, cz, true);
  hOverlapBad += h.overlapBad;
  hLineBad += h.lineBad;
  const r = scoreWindow(cx, cz, false);
  tOverlap += r.overlap;
  tOverlapBad += r.overlapBad;
  tLine += r.line;
  tLineBad += r.lineBad;
  tCross += r.crossings;
  if (r.worst && (!globalWorst || r.worst.lineBad > globalWorst.lineBad)) globalWorst = r.worst;
  const pc = (a, b) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0');
  console.log(
    `(${cx},${cz})  ${String(r.crossings).padStart(3)} crossings   ` +
      `overlap ${r.overlap.toFixed(0).padStart(5)} m², uncovered ${r.overlapBad.toFixed(0).padStart(5)} m² (${pc(r.overlapBad, r.overlap)}%)   ` +
      `line-on-road ${r.line.toFixed(0).padStart(4)} m², uncovered ${r.lineBad.toFixed(0).padStart(4)} m² (${pc(r.lineBad, r.line)}%)`,
  );
}

const pcOverlap = tOverlap > 0 ? (tOverlapBad / tOverlap) * 100 : 0;
const pcLine = tLine > 0 ? (tLineBad / tLine) * 100 : 0;

const hPcOverlap = tOverlap > 0 ? (hOverlapBad / tOverlap) * 100 : 0;
const hPcLine = tLine > 0 ? (hLineBad / tLine) * 100 : 0;

console.log(`\n${tCross} crossings total`);
console.log(
  `  carriageway overlap        ${tOverlap.toFixed(0)} m², uncovered ${hOverlapBad.toFixed(0)} m² (${hPcOverlap.toFixed(2)}%) at HEAD  ->  ${tOverlapBad.toFixed(0)} m² (${pcOverlap.toFixed(2)}%) now`,
);
console.log(
  `  painted line on other road ${tLine.toFixed(0)} m², uncovered ${hLineBad.toFixed(0)} m² (${hPcLine.toFixed(2)}%) at HEAD  ->  ${tLineBad.toFixed(0)} m² (${pcLine.toFixed(2)}%) now`,
);
if (globalWorst) {
  console.log(
    `  worst single junction: (${globalWorst.x.toFixed(0)},${globalWorst.z.toFixed(0)}) ` +
      `${globalWorst.dev.toFixed(1)}° off square, ${globalWorst.lineBad.toFixed(1)} m² of stray marking showing`,
  );
}

/* The bars. Uncovered OVERLAP is the geometric requirement — outside the patch at most one
 * carriageway may exist — and it is meant to be zero up to the sampling pitch. Uncovered
 * LINE-ON-ROAD is the operator's actual complaint and is the one that must not regress. */
const OVERLAP_BAR = 2.0; // %
const LINE_BAR = 1.0; // %
const ok = pcOverlap <= OVERLAP_BAR && pcLine <= LINE_BAR;
console.log(`\n${ok ? 'PASS' : 'FAIL'} — uncovered overlap ${pcOverlap.toFixed(2)}% (bar ${OVERLAP_BAR}%), stray markings ${pcLine.toFixed(2)}% (bar ${LINE_BAR}%)`);
process.exitCode = ok ? 0 : 1;
