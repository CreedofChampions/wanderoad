import { Terrain, landHeight, findSpawn } from '../src/world/terrain.js';
import { biomeWeights, BIOME_NAMES, BIOME_COUNT } from '../src/world/biomes.js';
import { RoadField, edgesInBox } from '../src/world/roads.js';

const SEED = 1337;
console.log('--- determinism: same input twice ---');
const a = landHeight(1234.5, -987.25, SEED), b = landHeight(1234.5, -987.25, SEED);
console.log('landHeight equal:', a === b, a.toFixed(6));

console.log('--- biome coverage over 60km x 60km ---');
const counts = new Array(BIOME_COUNT).fill(0);
let hmin=1e9,hmax=-1e9,hsum=0,n=0;
for (let i=0;i<160;i++) for (let j=0;j<160;j++){
  const x=(i-80)*375, z=(j-80)*375;
  const r = biomeWeights(x,z,SEED); counts[r.dominant]++;
  const h = landHeight(x,z,SEED); hmin=Math.min(hmin,h); hmax=Math.max(hmax,h); hsum+=h; n++;
}
counts.forEach((c,i)=>console.log(' ', BIOME_NAMES[i].padEnd(18), (100*c/(160*160)).toFixed(1)+'%'));
console.log('  height range', hmin.toFixed(1), '..', hmax.toFixed(1), 'mean', (hsum/n).toFixed(1));

console.log('--- road network density ---');
const edges = edgesInBox(-2000,-2000,2000,2000,SEED);
console.log('  edges in 4km box:', edges.length, 'tier0:', edges.filter(e=>e.tier===0).length, 'tier1:', edges.filter(e=>e.tier===1).length);

console.log('--- terrain + road carve ---');
const t0=Date.now();
const T = new Terrain(SEED, -500,-500,500,500);
console.log('  Terrain build ms:', Date.now()-t0, 'edges:', T.roads.edges.length);
let onRoad=0, samples=0, t1=Date.now();
for (let i=0;i<200;i++) for (let j=0;j<200;j++){
  const x=-500+i*5, z=-500+j*5;
  const s = T.surface(x,z); samples++;
  if (s.onRoad>0.5) onRoad++;
}
console.log('  40k surface() samples ms:', Date.now()-t1, ' on-road fraction:', (100*onRoad/samples).toFixed(2)+'%');

console.log('--- road continuity: walk an arterial, check height gradient ---');
const art = T.roads.edges.filter(e=>e.tier===0)[0];
if (art){
  let worst=0;
  for (let k=1;k<art.y.length;k++){
    const dx=art.pts[k*2]-art.pts[k*2-2], dz=art.pts[k*2+1]-art.pts[k*2-1];
    const run=Math.hypot(dx,dz)||1; const rise=Math.abs(art.y[k]-art.y[k-1]);
    worst=Math.max(worst, rise/run);
  }
  console.log('  steepest arterial gradient:', (worst*100).toFixed(1)+'%');
} else console.log('  no arterial in box');

console.log('--- spawn ---');
const sp = findSpawn(SEED);
console.log('  spawn', sp.x.toFixed(1), sp.y.toFixed(1), sp.z.toFixed(1), 'heading', (sp.heading*57.3).toFixed(1));
const chk = new Terrain(SEED, sp.x-50, sp.z-50, sp.x+50, sp.z+50);
const ss = chk.surface(sp.x, sp.z);
console.log('  spawn onRoad=', ss.onRoad.toFixed(3), 'grip=', ss.grip.toFixed(2), 'biome=', BIOME_NAMES[ss.dominant]);
