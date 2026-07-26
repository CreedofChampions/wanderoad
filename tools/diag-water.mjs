/* Are any roads underwater? Walk every edge in a big box and compare the road surface to the
 * local water level. The player reported driving underwater; this is the number that says
 * whether it is fixed. */
import { Terrain, waterFn } from '../src/world/terrain.js';
const SEED = 20260726;
const R = 2500;
const T = new Terrain(SEED, -R, -R, R, R, 200);
const water = waterFn(SEED);
let pts = 0, wet = 0, worst = 0;
for (const e of T.roads.edges) {
  for (let k = 0; k < e.y.length; k++) {
    const x = e.pts[k * 2], z = e.pts[k * 2 + 1];
    const w = water(x, z);
    pts++;
    if (w !== null && e.y[k] < w) { wet++; worst = Math.max(worst, w - e.y[k]); }
  }
}
console.log(`road samples ${pts}  underwater ${wet} (${(100*wet/pts).toFixed(2)}%)  deepest ${worst.toFixed(2)} m`);
