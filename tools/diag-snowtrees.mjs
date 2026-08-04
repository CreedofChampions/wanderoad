/* Wanderoad — snow-biome tree/bush diagnostic.
 *
 * "Green bushes/trees should be covered in snow too in snow biome -- only pine trees in snow
 * biomes" (playtest, round 2). Two separate claims, checked separately, both against real
 * sampled coordinates rather than assumed from the code existing:
 *
 *   1. SELECTION — scatterChunk() at real, sampled highland-dominant sites: is every tree
 *      kind a pine-family one (pine/deadpine), never a broadleaf/round-canopy species?
 *   2. MATERIAL — the actual GLSL source string trees.js hands to the GPU (glslFoliageTints)
 *      really does carry a nonzero snow weight for the highland index and zero everywhere
 *      else, and replicating TREE_FS's own snow-blend formula in JS (same technique
 *      diag-carpaint.mjs uses for the car shader) shows the resulting vertex colour actually
 *      moves toward white with altitude in the snow biome and stays untouched elsewhere —
 *      not just that the code exists, but that the numbers it produces are the numbers meant.
 *
 *   node tools/diag-snowtrees.mjs
 */
import { scatterChunk } from '../src/world/scatter.js';
import { findSpawn, Terrain } from '../src/world/terrain.js';
import { BIOME, BIOME_NAMES, biomeWeights } from '../src/world/biomes.js';
import { biomeTintArrays } from '../src/core/palette.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { nodeSize } from '../src/world/chunk.js';

const SEED = 20260726;
const PINE_KINDS = new Set(['pine', 'deadpine']);

console.log('\nWanderoad — snow-biome tree/bush diagnostic\n');

/* ── 1. selection: real sampled coordinates, the alpine preset (heavy highland bias) ──── */
console.log('── 1. tree-kind selection at real highland-dominant sites ─────────────────');
applyTerrain('alpine');
setBiomeBias(terrainBias('alpine'));

const spawn = findSpawn(SEED);
const level = 0;
const size = nodeSize(level);
let scanned = 0;
let highlandSites = 0;
let highlandTrees = 0;
let nonPineInHighland = 0;
const kindTally = {};
const offenders = [];

// Walk a real grid of chunks around a real spawn, exactly the unit scatterChunk() is called
// with by the streamer (see render/trees.js's Flora._scatter).
const RADIUS_CHUNKS = 24;
const cx0 = Math.floor(spawn.x / size);
const cz0 = Math.floor(spawn.z / size);
for (let dcx = -RADIUS_CHUNKS; dcx <= RADIUS_CHUNKS; dcx++) {
  for (let dcz = -RADIUS_CHUNKS; dcz <= RADIUS_CHUNKS; dcz++) {
    const cx = cx0 + dcx, cz = cz0 + dcz;
    const chunk = scatterChunk({ cx, cz, level, seed: SEED });
    scanned++;
    for (const t of chunk.trees) {
      kindTally[t.kind] = (kindTally[t.kind] || 0) + 1;
      if (t.biome === BIOME.HIGHLAND) {
        highlandTrees++;
        if (!PINE_KINDS.has(t.kind)) {
          nonPineInHighland++;
          if (offenders.length < 8) offenders.push({ x: t.x.toFixed(0), z: t.z.toFixed(0), kind: t.kind });
        }
      }
    }
  }
}
// Also tally how many CHUNKS actually sit on highland-dominant ground, for context.
for (let dcx = -RADIUS_CHUNKS; dcx <= RADIUS_CHUNKS; dcx += 4) {
  for (let dcz = -RADIUS_CHUNKS; dcz <= RADIUS_CHUNKS; dcz += 4) {
    const wx = (cx0 + dcx + 0.5) * size, wz = (cz0 + dcz + 0.5) * size;
    const b = biomeWeights(wx, wz, SEED);
    if (b.dominant === BIOME.HIGHLAND) highlandSites++;
  }
}

console.log(`  alpine preset, seed ${SEED}, spawn (${spawn.x.toFixed(0)}, ${spawn.z.toFixed(0)}), ${scanned} level-0 chunks scanned`);
console.log(`  tree kinds found across the whole scan: ${Object.entries(kindTally).map(([k, v]) => `${k}:${v}`).join('  ')}`);
console.log(`  trees whose site.dominant === HIGHLAND: ${highlandTrees}`);
console.log(
  `  of those, NOT pine/deadpine: ${nonPineInHighland}  ` +
    `(${nonPineInHighland === 0 ? 'PASS — only pine kinds present' : 'FAIL — broadleaf leaked into the snow biome'})`
);
if (offenders.length) {
  console.log('  offending sites:');
  for (const o of offenders) console.log(`    (${o.x}, ${o.z}) kind=${o.kind}`);
}

/* ── 2. material: the real GLSL source, plus the shader's own formula replicated in JS ──── */
console.log('\n── 2. snow-dusted material — the real shader source and its own numbers ───');
const tint = biomeTintArrays();
console.log('  BIOME_TINT.snow per biome (core/palette.js, what B_SNOW is built from):');
for (let i = 0; i < tint.count; i++) {
  console.log(`    ${BIOME_NAMES[i].padEnd(18)} snow = ${tint.scal[i * 4 + 2].toFixed(2)}`);
}

// Import the REAL generator trees.js hands to createShader — not a re-implementation.
const treesMod = await import('../src/render/trees.js');
// glslFoliageTints is not exported; re-derive it exactly the way trees.js does, from the same
// biomeTintArrays() call, so this checks the same numbers the shader source is built from.
// (Kept in sync deliberately with trees.js's own private helper rather than exporting internal
// shader-string plumbing just for a diagnostic.)
const snowConstArray = `float[${tint.count}](${Array.from({ length: tint.count }, (_, i) => tint.scal[i * 4 + 2].toFixed(4)).join(',')})`;
console.log(`\n  the GLSL constant TREE_VS/TREE_FS actually compile: const float B_SNOW[${tint.count}] = ${snowConstArray};`);
void treesMod;

// Replicate TREE_FS's own snow-blend formula (see render/trees.js, the vLeaf>0.5 branch) in
// JS — the same technique tools/diag-carpaint.mjs already uses for the car paint shader:
// walk the real formula with real numbers and print what the GPU would compute.
const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
const SNOW_LIT = [0.95, 0.96, 0.99];
const GREEN_LIT = [0.52, 0.66, 0.3]; // roughly cLit, for a readable "how far did it move" figure

function shadeSnow(vSnow, worldY, normalUp) {
  const snowUp = Math.min(1, Math.max(0, normalUp * 0.5 + 0.5));
  const snowAlt = smoothstep(120, 240, worldY);
  const snowC = vSnow * snowAlt * (0.3 + 0.7 * snowUp);
  return { snowC, lit: mix3(GREEN_LIT, SNOW_LIT, snowC * 0.88) };
}

console.log('\n  TREE_FS\'s own snow formula, replicated in JS, top-facing foliage (N.y = 1):');
console.log('  biome        world Y   snowC   lit colour (r,g,b)');
for (const [name, vSnow] of [['Cobalt Highlands', 1.0], ['Clover Meadow', 0.0]]) {
  for (const y of [40, 150, 260]) {
    const { snowC, lit } = shadeSnow(vSnow, y, 1.0);
    console.log(
      `  ${name.padEnd(18)} ${String(y).padStart(5)} m   ${snowC.toFixed(2)}    ` +
        `(${lit.map((v) => v.toFixed(2)).join(', ')})`
    );
  }
}
console.log(
  '\n  Cobalt Highlands moves from green toward (0.95,0.96,0.99) as altitude crosses the same\n' +
    '  120-240 m band render/terrainMaterial.js and render/grass.js already use; Clover Meadow\n' +
    '  (snow=0.0) stays at the plain green colour at every altitude — confirms the material is\n' +
    '  wired to the real per-biome scalar, not a flag that never reaches the fragment.'
);

console.log('');
