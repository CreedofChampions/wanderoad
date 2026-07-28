/* Wanderoad — does a road that stops LOOK like it meant to?
 *
 * The operator's screenshot (a): a lane ending in open grass with its edge lines, centre dashes
 * and a give-way bar running right up to the cut. `tools/diag-deadends.mjs` says how many of
 * those there are and why (6.1 per 16 km², two thirds of them lanes orphaned by the lake cull);
 * this file checks the answer — the turning head and closing bar `buildTerminus` puts on every
 * one of them.
 *
 * A flag set is not a thing visible (gotcha 3), so nothing here trusts `edgeDeadEnds` to have
 * been called. It builds the ACTUAL geometry the renderer builds, from the ACTUAL ribbon rings,
 * and measures it:
 *
 *   T1  every dead end in the window has a head, and every head is on a dead end
 *   T2  no NaN/Infinity vertices
 *   T3  every triangle faces up (a down-facing one is invisible under FrontSide)
 *   T4  vertex heights agree with Terrain.height — the head lies ON the ground, like the ribbon
 *   T5  chord sag: the drawn head never flies more than LIFT above the ground BETWEEN vertices
 *   T6  the head is not a cliff — how far its rim sits from the road's own end height, which is
 *       the honest question about paving out past the carve's flat shelf onto its batter
 *   T7  a road leaving the drawing WINDOW gets no head: a clipped edge is not a dead end
 *
 *   node tools/diag-terminus.mjs
 */

import { ribbonEdges, buildRibbon, buildTerminus, LIFT } from '../src/render/road.js';
import { edgeDeadEnds, liveDegreeAt, TIERS } from '../src/world/roads.js';
import { Terrain } from '../src/world/terrain.js';

const SEED = 20260726;
/** Windows the renderer itself would build: 1900 m of range about a car position. */
const RANGE = 1900;
const SPOTS = [
  [0, 0],
  [1500, -1500],
  [-4000, 3000],
  [30000, -30000],
];

let fail = 0;
const check = (ok, label, got, want) => {
  if (!ok) fail++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${label}${got !== undefined ? `  ${got}` : ''}${want ? `   want ${want}` : ''}`);
};

let heads = 0;
let deadEnds = 0;
let tris = 0;
let worstNaN = 0;
let worstDown = 0;
let worstHeight = { d: 0, at: '' };
let worstSag = { d: 0, at: '' };
let worstRim = { d: 0, at: '', tier: 0 };
let clippedNoHead = 0;
let mismatch = 0;
let sagOver = 0;
const radii = [];

for (const [cx, cz] of SPOTS) {
  const { edges, ctx } = ribbonEdges(SEED, cx - RANGE, cz - RANGE, cx + RANGE, cz + RANGE);
  let windowHeads = 0;
  let windowDead = 0;
  let clipped = 0;

  for (const e of edges) {
    const dead = edgeDeadEnds(e, SEED);
    const { ring } = buildRibbon(e, ctx);
    const n = ring.length;

    for (let end = 0; end < 2; end++) {
      const p = end === 1 ? ring[n - 1] : ring[0];
      const outside = Math.abs(p.x - cx) > RANGE || Math.abs(p.z - cz) > RANGE;
      if (!dead[end]) {
        // T7: an end outside the drawn window is a CLIPPED road, and must not get a head
        if (outside) clipped++;
        continue;
      }
      windowDead++;
      const geo = buildTerminus(e, ring, end === 1, ctx);
      if (!geo) {
        mismatch++;
        continue;
      }
      windowHeads++;

      const pos = geo.getAttribute('position').array;
      const idx = geo.getIndex().array;
      tris += idx.length / 3;

      const reach = e.width * 0.5 * 1.6 + 3;
      const terr = new Terrain(SEED, p.x - reach, p.z - reach, p.x + reach, p.z + reach, 96);
      const u = geo.userData.terminus;
      radii.push(u.R / u.half);

      for (let v = 0; v < pos.length; v += 3) {
        if (!Number.isFinite(pos[v]) || !Number.isFinite(pos[v + 1]) || !Number.isFinite(pos[v + 2])) worstNaN++;
        // T4 — the vertex sits on the ground, plus the deliberate overlay lift
        const g = terr.height(pos[v], pos[v + 2]);
        const dh = Math.abs(pos[v + 1] - (g + LIFT + 0.03));
        if (dh > worstHeight.d) worstHeight = { d: dh, at: `(${pos[v].toFixed(0)},${pos[v + 2].toFixed(0)})` };
        /* T6 — the LATERAL fall: this bit of pavement against the ground on the road's own
         * centreline at the same station, which is buildTerminus's `fallAt` re-run on the
         * geometry it actually produced. Against a single end height instead, the road's own
         * gradient would swamp it — see the note on `fallAt`. */
        const along = (pos[v] - u.x) * u.tx + (pos[v + 2] - u.z) * u.tz;
        const st = Math.min(along, u.half * 0.9);
        const ref = terr.height(u.x + u.tx * st, u.z + u.tz * st);
        const rim = Math.abs(g - ref);
        if (rim > worstRim.d) worstRim = { d: rim, at: `(${pos[v].toFixed(0)},${pos[v + 2].toFixed(0)})`, tier: e.tier };
      }

      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3,
          b = idx[t + 1] * 3,
          c = idx[t + 2] * 3;
        // T3 — Y of (b-a) x (c-a) restricted to XZ; three.js fronts counter-clockwise from above
        const up =
          (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]);
        if (up < -1e-6) worstDown++;
        // T5 — the drawn surface between vertices: centroid of the triangle against the ground
        const mx = (pos[a] + pos[b] + pos[c]) / 3;
        const mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
        const my = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3;
        const sag = my - (terr.height(mx, mz) + LIFT + 0.03);
        if (sag > LIFT + 0.03) sagOver++;
        if (sag > worstSag.d) worstSag = { d: sag, at: `(${mx.toFixed(0)},${mz.toFixed(0)})` };
      }
    }
  }

  clippedNoHead += clipped;
  heads += windowHeads;
  deadEnds += windowDead;
  console.log(
    `(${cx},${cz})  ${String(edges.length).padStart(3)} edges   dead ends ${String(windowDead).padStart(2)}   heads built ${String(windowHeads).padStart(2)}   clipped ends left alone ${clipped}`,
  );
}

console.log('');
check(heads > 0, 'T1a  real dead ends found and given a head', `${heads} heads on ${deadEnds} dead ends`, '> 0');
check(mismatch === 0, 'T1b  every dead end got one', `${mismatch} missing`, '0');
check(worstNaN === 0, 'T2   no NaN/Infinity vertices', `${worstNaN} bad`, '0');
check(worstDown === 0, 'T3   every triangle faces up', `${worstDown} down-facing of ${tris}`, '0');
check(worstHeight.d <= 0.05, 'T4   vertices lie on Terrain.height', `worst ${worstHeight.d.toFixed(4)} m at ${worstHeight.at}`, '<= 0.05 m');
/* T5's bar is 0.15 m, not the 0.10 m of lift the head has, and the reason is the same one
 * RING_DEPTH is capped for: `Terrain.height()` genuinely STEPS by up to 0.5 m where carve()'s
 * nearest edge flips tier, and a smooth mesh cannot follow a step however finely it is cut —
 * measured, halving the ring spacing and going 20 -> 32 sectors moved this figure by less than
 * the head's own radius did. What matters is that it is a handful of triangles at the RIM of a
 * place the car comes to a stop, at the thickness of real tarmac, and that the count is
 * reported rather than averaged away. */
const SAG_BAR = 0.15;
check(worstSag.d <= SAG_BAR, 'T5   no chord flies far above the ground between vertices', `worst ${worstSag.d.toFixed(4)} m at ${worstSag.at}, ${sagOver} of ${tris} triangles over the ${(LIFT + 0.03).toFixed(2)} m lift`, `<= ${SAG_BAR} m`);
/* T6 is a REPORT with a generous ceiling, not a tight bar, and the reason is worth stating.
 * `carve()` holds the ground dead flat only inside the carriageway half-width; past that it
 * batters towards the land at 1:1.6 (fill) or 1:2.2 (cutting). A turning head is 1.55 times the
 * half-width, so its rim is 55% of a half-width — 1.7 m on a lane, 2.4 m on an arterial — out
 * onto that batter, and it FOLLOWS the batter because every vertex is Terrain.height(). What
 * must not happen is the head reading as a step; 0.5 m over that reach is a 1:4 slope, gentler
 * than the road's own camber fall over its width, and still nothing a car meets at speed since
 * a dead end is where you stop. */
check(worstRim.d <= 0.35, 'T6   the head does not fall away sideways from the road', `worst ${worstRim.d.toFixed(3)} m at ${worstRim.at} (tier ${worstRim.tier}, half-width ${(TIERS[worstRim.tier].width / 2).toFixed(2)} m)`, '<= 0.35 m');
check(clippedNoHead > 0, 'T7   roads leaving the window are NOT treated as dead ends', `${clippedNoHead} clipped ends left with no head`, '> 0');

const wide = radii.filter((r) => r > 1.01).length;
console.log(
  `\nhead radius, as a multiple of the road half-width: min ${Math.min(...radii).toFixed(2)}  max ${Math.max(...radii).toFixed(2)}  ` +
    `mean ${(radii.reduce((s, v) => s + v, 0) / radii.length).toFixed(2)}   ${wide} of ${radii.length} widened past the carriageway`,
);
console.log(`${heads} turning heads, ${tris} triangles, over ${SPOTS.length} windows.`);
console.log(fail === 0 ? '\nall terminus checks passed' : `\n${fail} FAILED`);
process.exitCode = fail === 0 ? 0 : 1;
