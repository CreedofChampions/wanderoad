/* Wanderoad — draw the road network, straight out of edgesInBox, as an SVG.
 *
 * Built because a metric was wrong. A script that measured "two roads leaving a node in the
 * same direction" reported a third of all junctions as braided on three seeds, and that number
 * went into the backlog — but it was counting a STRAIGHT ROAD PASSING THROUGH a node as a
 * 180-degree hairpin, because of which way the two tangents point. Every conclusion drawn from
 * it was therefore suspect.
 *
 * A picture cannot be wrong in that way. If two carriageways are braided together you can see
 * it; if a junction loops back on itself you can see that too. Use this to look before
 * trusting any new road metric.
 *
 *   node tools/diag-roadmap.mjs [seed] [halfSpanMetres] [out.svg]
 */
import { edgesInBox } from '../src/world/roads.js';
import { writeFileSync } from 'node:fs';
const SEED = +(process.argv[2] || 20260726);
const R = +(process.argv[3] || 2500);
const OUT = process.argv[4] || 'roadmap.svg';
const es = edgesInBox(-R, -R, R, R, SEED, 0);
const W = 1200, sc = W / (2 * R);
const X = (x) => ((x + R) * sc).toFixed(1);
const Z = (z) => ((z + R) * sc).toFixed(1);
let body = '';
for (const g of es) {
  const n = g.pts.length / 2;
  let d = `M ${X(g.pts[0])} ${Z(g.pts[1])}`;
  for (let k = 1; k < n; k++) d += ` L ${X(g.pts[k * 2])} ${Z(g.pts[k * 2 + 1])}`;
  const w = (g.width * sc).toFixed(2);
  body += `<path d="${d}" fill="none" stroke="${g.tier === 0 ? '#3a3a42' : '#55555f'}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
  body += `<path d="${d}" fill="none" stroke="#F6ECD8" stroke-width="${Math.max(0.7, w * 0.09).toFixed(2)}" stroke-dasharray="6 7" opacity="0.85"/>\n`;
}
// node dots so junctions are obvious
const seen = new Set();
for (const g of es) {
  const n = g.pts.length / 2;
  for (const [x, z] of [[g.pts[0], g.pts[1]], [g.pts[(n-1)*2], g.pts[(n-1)*2+1]]]) {
    const k = `${Math.round(x)},${Math.round(z)}`;
    if (seen.has(k)) continue; seen.add(k);
    body += `<circle cx="${X(x)}" cy="${Z(z)}" r="2.5" fill="#E0B14E" opacity="0.9"/>\n`;
  }
}
writeFileSync(OUT, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}"><rect width="${W}" height="${W}" fill="#8FA37E"/>\n${body}</svg>`);
console.log(`${OUT}: ${es.length} edges, ${seen.size} nodes, ${2*R} m across, seed ${SEED}`);
