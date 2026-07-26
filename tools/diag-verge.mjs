/* Wanderoad — how much room is there beside the road before the world stops being drivable?
 *
 * tools/diag-water.mjs already proves no road is ever UNDER water. That is not the same
 * question as "if you drift off the carriageway, what is out there": the browser suite's
 * straight-line run-ups drive off the edge on a bend, and one of them ended up two metres
 * under a lake ten metres from the centreline.
 *
 * So this walks out perpendicular from a lot of road samples and reports the first distance
 * at which the water is deeper than the rescue's 0.6 m gate, and the drop from the road
 * surface to the ground there. It imports only terrain.js, biomes.js and presets.js, so the
 * same file runs unchanged against an older checkout for a before/after.
 *
 *   node tools/diag-verge.mjs [--terrain meadow] [--samples 900]
 */

import { Terrain } from '../src/world/terrain.js';
import { BIOME_COUNT, waterLevelAt, biomeWeights, setBiomeBias } from '../src/world/biomes.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const SEED = 20260726;
const LAND = arg('terrain', 'meadow');
const WANT = +arg('samples', 900);
const DEEP = 0.6; // src/game/rescue.js's gate
const OUT = 24; // metres we bother walking out

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));

const W = new Float32Array(BIOME_COUNT);
const depthAt = (T, x, z) => {
  const y = T.height(x, z);
  biomeWeights(x, z, SEED, W);
  const wy = waterLevelAt(W, y);
  return wy === null ? 0 : wy - y;
};

let samples = 0;
let deepWithin = 0;
let sumFirst = 0;
const hist = new Array(7).fill(0); // <6, <9, <12, <15, <18, <24, none
let curveDeg = 0;
let curveLen = 0;
const worst = [];

/* Walk a grid of 720 m terrain windows so the road set is not one neighbourhood. */
outer: for (let gx = -2; gx <= 2; gx++) {
  for (let gz = -2; gz <= 2; gz++) {
    const cx = gx * 700;
    const cz = gz * 700;
    const T = new Terrain(SEED, cx - 360, cz - 360, cx + 360, cz + 360, 260);
    for (const e of T.roads.edges) {
      const n = e.pts.length / 2;
      for (let k = 1; k < n - 1; k++) {
        const x = e.pts[k * 2];
        const z = e.pts[k * 2 + 1];
        if (Math.abs(x - cx) > 300 || Math.abs(z - cz) > 300) continue;
        // Road tangent, then the normal to walk out along. Both sides.
        const tx = e.pts[k * 2 + 2] - e.pts[k * 2 - 2];
        const tz = e.pts[k * 2 + 3] - e.pts[k * 2 - 1];
        const L = Math.hypot(tx, tz) || 1;
        const nx = -tz / L;
        const nz = tx / L;
        curveLen += L * 0.5;
        {
          const ax = e.pts[k * 2] - e.pts[k * 2 - 2];
          const az = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
          const bx = e.pts[k * 2 + 2] - e.pts[k * 2];
          const bz = e.pts[k * 2 + 3] - e.pts[k * 2 + 1];
          let d = Math.atan2(bx, bz) - Math.atan2(ax, az);
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          curveDeg += Math.abs(d) * 57.2958;
        }
        for (const s of [1, -1]) {
          samples++;
          let first = Infinity;
          for (let m = 4; m <= OUT; m += 1) {
            if (depthAt(T, x + nx * s * m, z + nz * s * m) > DEEP) {
              first = m;
              break;
            }
          }
          if (first < Infinity) {
            deepWithin++;
            sumFirst += first;
            const drop = e.y[k] - T.height(x + nx * s * first, z + nz * s * first);
            if (worst.length < 8 || first <= worst[worst.length - 1].first)
              worst.push({ x: +x.toFixed(0), z: +z.toFixed(0), first, drop: +drop.toFixed(1) });
          }
          hist[first < 6 ? 0 : first < 9 ? 1 : first < 12 ? 2 : first < 15 ? 3 : first < 18 ? 4 : first <= 24 ? 5 : 6]++;
        }
        if (samples >= WANT * 2) break outer;
      }
    }
  }
}

worst.sort((a, b) => a.first - b.first);
console.log(`\nland "${LAND}"   ${samples} verge samples (both sides of ${samples / 2} road points)`);
console.log(`road curvature over the same points: ${((curveDeg / Math.max(curveLen, 1)) * 1000).toFixed(0)} deg/km`);
console.log(`water deeper than ${DEEP} m within ${OUT} m of the centreline: ${deepWithin} (${((100 * deepWithin) / samples).toFixed(2)}%)`);
if (deepWithin) console.log(`  mean first-deep distance ${(sumFirst / deepWithin).toFixed(1)} m`);
const labels = ['<6 m', '<9 m', '<12 m', '<15 m', '<18 m', '<24 m', 'dry to 24 m'];
hist.forEach((c, i) => console.log(`  ${labels[i].padEnd(12)} ${String(c).padStart(6)}  ${((100 * c) / samples).toFixed(2)}%`));
console.log('closest deep water to a carriageway:');
for (const w of worst.slice(0, 6)) console.log(`  (${w.x}, ${w.z})  ${w.first} m out, road stands ${w.drop} m above it`);
