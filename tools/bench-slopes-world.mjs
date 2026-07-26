import { Terrain } from '../src/world/terrain.js';
import { biomeWeights, BIOME_NAMES, BIOME_COUNT } from '../src/world/biomes.js';
const SEED=20260726;
const T=new Terrain(SEED,-900,-900,900,900);
let maxDeg=0, sum=0, n=0, over25=0, over40=0, hmin=1e9, hmax=-1e9;
for(let i=0;i<300;i++)for(let j=0;j<300;j++){
  const x=-900+i*6, z=-900+j*6;
  const nrm=T.normal(x,z,3);
  const deg=Math.acos(Math.min(1,nrm[1]))*57.2958;
  maxDeg=Math.max(maxDeg,deg); sum+=deg; n++;
  if(deg>25)over25++; if(deg>40)over40++;
  const h=T.height(x,z); hmin=Math.min(hmin,h); hmax=Math.max(hmax,h);
}
console.log('1.8km box: mean slope', (sum/n).toFixed(1)+'°', ' max', maxDeg.toFixed(1)+'°',
  ' >25°:', (100*over25/n).toFixed(2)+'%', ' >40°:', (100*over40/n).toFixed(2)+'%');
console.log('height', hmin.toFixed(1),'..',hmax.toFixed(1));
const counts=new Array(BIOME_COUNT).fill(0);
for(let i=0;i<140;i++)for(let j=0;j<140;j++){const r=biomeWeights((i-70)*430,(j-70)*430,SEED);counts[r.dominant]++;}
counts.forEach((c,i)=>console.log(' ',BIOME_NAMES[i].padEnd(18),(100*c/(140*140)).toFixed(1)+'%'));
