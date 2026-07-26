import { buildChunk, nodeSize, gridFor, LEVELS } from '../src/world/chunk.js';
const SEED=20260726;
for (let L=0; L<LEVELS; L++){
  const t=Date.now();
  const c=buildChunk({cx:3,cz:-2,level:L,seed:SEED});
  const ms=Date.now()-t;
  console.log(`level ${L}  size ${nodeSize(L).toString().padStart(5)}m  grid ${gridFor(L)}  ${String(ms).padStart(6)} ms   verts ${c.vertCount}`);
}
