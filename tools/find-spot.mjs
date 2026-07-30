/* WHERE IS THE GROUND ABOVE THE SNOW LINE?
 *
 * Operator, with a photograph: "ground is blue here in highlands 7000/10,000". The terrain shader
 * blends snow in from 120 m to 240 m, and HIGHLAND has amp 205 / base 14, so most of a highland sits
 * inside that ramp — but the grass never knew about it, so snow read as coloured dirt with a lawn on
 * top. The fix suppresses grass over the same ramp and warms the palette; the fix has to be
 * PHOTOGRAPHED to count, and the first attempt photographed a 25 m meadow, which proves nothing.
 *
 * So: scan the plane for the highest HIGHLAND ground that has a road near it, and print the point.
 * Roads matter because the shot should be a driver's view, which is the view the complaint came from.
 */
import { landHeight } from '../src/world/terrain.js';
import { biomeWeights, BIOME, BIOME_SHORT } from '../src/world/biomes.js';
import { roadDistance } from '../src/world/roads.js';

const SEED = Number(process.argv[2] || 20260726);
const R = Number(process.argv[3] || 12000);
/* The BAND matters as much as the peak. Snow ramps 120 m to 240 m, so the ugly case is the MIDDLE of
 * that ramp — half-snow over green grass, which is what reads as blue dirt with a lawn. Pass a target
 * height to photograph the middle of the ramp rather than the top of it. */
const TARGET = process.argv[4] ? Number(process.argv[4]) : null;
/* Which biome to stand in. Highland was the one that was blue, but the SECOND half of that fix is
 * that highland must not now collide with the dunes — the operator's older complaint was "u just
 * renamed them but they are similar 3 biomes sand, snow, hills" — and the only honest way to check
 * that is to photograph both and measure them, which needs this to find either. */
const WANT = process.argv[5] ? (BIOME[process.argv[5].toUpperCase()] ?? BIOME.HIGHLAND) : BIOME.HIGHLAND;

let best = null;
for (let x = -R; x <= R; x += 300) {
  for (let z = -R; z <= R; z += 300) {
    const y = landHeight(x, z, SEED);
    if (TARGET === null ? y < 150 : Math.abs(y - TARGET) > 12) continue;
    // biomeWeights returns {w, dominant} and REUSES its array — read the share before
    // roadDistance runs, because that calls biomeWeights again and overwrites the same buffer.
    const hi = biomeWeights(x, z, SEED).w[WANT];
    if (hi < 0.55) continue;
    let d = Infinity;
    try {
      const q = roadDistance(x, z, SEED, landHeight);
      if (q && Number.isFinite(q.d)) d = q.d;
    } catch {}
    if (d > 400) continue; // a shot you cannot drive to is not the view being complained about
    const score = (TARGET === null ? y : -Math.abs(y - TARGET)) - d * 0.08;
    if (!best || score > best.score)
      best = { x, z, y: +y.toFixed(1), roadDist: +d.toFixed(0), hi: +hi.toFixed(2), biome: BIOME_SHORT[WANT], score };
  }
}
console.log(best ? JSON.stringify(best) : 'no highland above 150 m within reach of a road');
