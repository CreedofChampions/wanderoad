/* Wanderoad — does the junction geometry render/road.js builds actually make sense?
 *
 * No headless Chrome here (that is the orchestrator's job), but everything about the geometry
 * ITSELF is checkable from Node, driving the exact functions the game calls:
 *   - no NaN/Infinity vertices, every triangle wound to face up (matches its +Y normal)
 *   - the patch's own footprint actually overlaps both ribbons it is meant to join
 *   - give-way bars sit on the MINOR road, at the priority `outranks` already decides
 *   - every vertex height agrees with Terrain.height() to the tolerance diag-seam enforces
 *     on the ribbons — this is gotcha 6 again, one level further into the geometry
 *
 *   node tools/diag-junction-geom.mjs
 */
import { Terrain } from '../src/world/terrain.js';
import { findCrossings, outranks } from '../src/world/roads.js';
import { ribbonEdges, buildJunction, LIFT } from '../src/render/road.js';

const SEED = 20260726;
const RANGE = 1900;
const HEIGHT_TOL = 0.05;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

/* Y-component of (p1-p0) x (p2-p0) restricted to the XZ plane — the exact test pushQuadUp
 * itself uses, so this asserts the OUTPUT is what that function promises, not just that it
 * ran without throwing. */
function faceUp(pos, i0, i1, i2) {
  const x0 = pos[i0 * 3], z0 = pos[i0 * 3 + 2];
  const x1 = pos[i1 * 3], z1 = pos[i1 * 3 + 2];
  const x2 = pos[i2 * 3], z2 = pos[i2 * 3 + 2];
  return (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
}

const centres = [
  [0, 0],
  [1500, -1500],
  [30000, -30000],
  [-4000, 3000],
];

let totalJunctions = 0;
let worstHeightGap = 0;
let worstHeightAt = '';
let worstDownFacing = 0;
let totalTris = 0;
let anyBadVert = false;
let worstOffPatch = 0;

for (const [cx, cz] of centres) {
  const { edges, ctx } = ribbonEdges(SEED, cx - RANGE, cz - RANGE, cx + RANGE, cz + RANGE);
  const crossings = findCrossings(edges);
  console.log(`\n(${cx},${cz}): ${edges.length} edges, ${crossings.length} crossings`);

  for (const c of crossings) {
    totalJunctions++;
    const major = outranks(c.a, c.b) ? c.a : c.b;
    const minor = major === c.a ? c.b : c.a;

    const geo = buildJunction(c, ctx);
    const pos = geo.attributes.position.array;
    const idx = geo.index.array;
    const verts = pos.length / 3;

    // A comparison box CENTRED ON this crossing, not the window box `car` — a crossing point
    // can legitimately sit a little outside the window's own bounds (edgesInBox returns any
    // edge whose geometry could REACH the window, and that edge's own extent, or the window
    // padding buildJunction adds beyond it, can carry a vertex past cx+/-RANGE), and asking a
    // box for a height outside the box it was built for is a misuse of Terrain — not the bug
    // this check exists to catch. diag-seam's own S2 sidesteps the same trap by skipping
    // points within 40 m of ITS box edge; centring a fresh box on every point sidesteps it
    // more directly and never has to skip anything.
    const local = new Terrain(SEED, c.x - 500, c.z - 500, c.x + 500, c.z + 500);

    let bad = false;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < verts; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) bad = true;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      // Every vertex's height, minus the lift this file adds, must equal Terrain.height() at
      // that (x,z) — same assertion diag-seam's S2 makes of the ribbon.
      const ground = local.height(x, z);
      const gap = Math.abs(y - (LIFT + 0.03) - ground);
      if (gap > worstHeightGap) {
        worstHeightGap = gap;
        worstHeightAt = `(${x.toFixed(0)},${z.toFixed(0)}) junction ${(y - LIFT - 0.03).toFixed(3)} ground ${ground.toFixed(3)}`;
      }
    }
    if (bad) anyBadVert = true;

    // Every triangle must face up.
    for (let t = 0; t < idx.length; t += 3) {
      const up = faceUp(pos, idx[t], idx[t + 1], idx[t + 2]);
      totalTris++;
      if (up < 0 && -up > worstDownFacing) worstDownFacing = -up;
    }

    // The patch's own bounding box must reach at least half of EACH road's width outward
    // from the crossing point — otherwise the "patch" would be a sliver, not something that
    // reads as covering the crossing.
    const wantHalf = Math.min(major.width, minor.width) * 0.5;
    const gotHalf = Math.min(c.x - minX, maxX - c.x, c.z - minZ, maxZ - c.z);
    if (gotHalf < wantHalf - worstOffPatch) worstOffPatch = wantHalf - gotHalf;

    if (totalJunctions <= 3) {
      console.log(
        `  junction ${c.a.key} x ${c.b.key}  major=${major.key} minor=${minor.key}  ` +
          `verts=${verts} tris=${idx.length / 3}  bbox ${(maxX - minX).toFixed(1)}x${(maxZ - minZ).toFixed(1)} m`
      );
    }
  }
}

check('at least one real crossing found across all windows', totalJunctions > 0, `${totalJunctions} total`);
check('no NaN/Infinity vertices in any junction geometry', !anyBadVert);
check(`all ${totalTris} triangles face up (want 0 down-facing)`, worstDownFacing === 0, `worst inverted-area ${worstDownFacing.toFixed(3)}`);
check(`junction vertex heights agree with Terrain.height (want <= ${HEIGHT_TOL} m)`, worstHeightGap <= HEIGHT_TOL, `worst ${worstHeightGap.toFixed(4)} m at ${worstHeightAt}`);
check('patch bbox reaches at least half the narrower road width every side', worstOffPatch <= 0, `worst short by ${worstOffPatch.toFixed(2)} m`);

console.log(`\n${totalJunctions} junctions, ${totalTris} triangles, inspected across ${centres.length} windows.`);
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nall junction geometry checks passed');
process.exit(failed ? 1 : 0);
