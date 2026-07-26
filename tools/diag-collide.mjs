/* Do the collision solids stand where the props are actually drawn?
 *
 * A hitbox you cannot see is the worst bug this game can ship: you either stop in mid-air or
 * you drive through a trunk. So this measures rather than asserts. It rebuilds the SAME tree
 * archetypes the renderer builds (same seed, same LOD) straight out of src/render/trees.js,
 * slices each trunk with a horizontal plane at bumper height, and compares the drawn trunk
 * with the TRUNK_R table in src/game/collide.js.
 *
 * The slice is restricted to the connected mesh component containing vertex 0, which is the
 * trunk tube: `makeTree` lays the trunk down first and every canopy clump is its own island,
 * so that one test separates wood from leaves without knowing anything about the species.
 *
 * Run: node tools/diag-collide.mjs
 */
import { makeTree, TREE_ARCH } from '../src/render/trees.js';
import { scatterChunk } from '../src/world/scatter.js';
import { solidsFromScatter, TRUNK_R, TREE_SINK } from '../src/game/collide.js';
import { hash2i } from '../src/core/math.js';

const SEED = 20260726;

/* Both numbers have to come from the renderer or the comparison is circular.
 * Flora._detailFor(level) = clamp(2 - level - (quality < 0.75 ? 1 : 0), 0, 2), so a level-0
 * chunk — the only level that gets colliders — draws at detail 2, or 1 on a slow machine.
 * Flora._batch seeds each archetype with hash2i(kindIndex + 1, detail + 1, 0x5eed1eaf),
 * kindIndex being the position in Object.keys(TREE_ARCH). */
const KIND_ORDER = Object.keys(TREE_ARCH);
const DETAILS = [1, 2];

/* The heights a car's bodywork sweeps through. The renderer sinks a root by
 * TREE_SINK * scale, so in the archetype's own unscaled coordinates the ground is at
 * y = TREE_SINK and a bumper 0.1–1.1 m off the ground is at y = TREE_SINK + that. */
const BAND = [0.45, 0.7, 0.95, 1.2, 1.45];

/** Horizontal slice of one mesh component, as radial distances from the instance origin. */
function trunkSlice(M, Y) {
  const par = new Int32Array(M.n);
  for (let i = 0; i < M.n; i++) par[i] = i;
  const find = (a) => {
    while (par[a] !== a) {
      par[a] = par[par[a]];
      a = par[a];
    }
    return a;
  };
  const uni = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) par[b] = a;
  };
  for (let k = 0; k < M.idx.length; k += 3) {
    uni(M.idx[k], M.idx[k + 1]);
    uni(M.idx[k + 1], M.idx[k + 2]);
  }
  const root = find(0);
  const out = [];
  for (let k = 0; k < M.idx.length; k += 3) {
    if (find(M.idx[k]) !== root) continue;
    const t = [M.idx[k], M.idx[k + 1], M.idx[k + 2]];
    for (let e = 0; e < 3; e++) {
      const a = t[e];
      const b = t[(e + 1) % 3];
      const ya = M.pos[a * 3 + 1];
      const yb = M.pos[b * 3 + 1];
      if ((ya - Y) * (yb - Y) > 0 || ya === yb) continue;
      const u = (Y - ya) / (yb - ya);
      const x = M.pos[a * 3] + (M.pos[b * 3] - M.pos[a * 3]) * u;
      const z = M.pos[a * 3 + 2] + (M.pos[b * 3 + 2] - M.pos[a * 3 + 2]) * u;
      out.push(Math.hypot(x, z));
    }
  }
  return out;
}

let bad = 0;
console.log('drawn trunk, radially from the instance origin, over the bumper band');
console.log('species      LOD1 near..far     LOD2 near..far     TRUNK_R   verdict');
console.log('-'.repeat(78));
for (const kind of KIND_ORDER) {
  const cols = [];
  let near = Infinity;
  let far = 0;
  for (const detail of DETAILS) {
    const M = makeTree(kind, detail, hash2i(KIND_ORDER.indexOf(kind) + 1, detail + 1, 0x5eed1eaf));
    let lo = Infinity;
    let hi = 0;
    for (const Y of BAND) {
      for (const r of trunkSlice(M, Y)) {
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
    }
    near = Math.min(near, lo);
    far = Math.max(far, hi);
    cols.push(lo === Infinity ? '   (no trunk)   ' : `${lo.toFixed(3)}..${hi.toFixed(3)}`.padEnd(16));
  }
  const R = TRUNK_R[kind];
  // In range: the circle touches the trunk somewhere (>= near) and never reaches past the
  // drawn silhouette (<= far). Outside that it is either passable or an invisible wall.
  const ok = R === undefined || (R >= near - 1e-9 && R <= far + 1e-9);
  if (!ok) bad++;
  console.log(
    `${kind.padEnd(12)} ${cols.join(' ')} ${(R === undefined ? 'none' : R.toFixed(3)).padStart(8)}   ` +
      (R === undefined ? 'drive-through on purpose' : ok ? `ok (inside ${near.toFixed(2)}..${far.toFixed(2)})` : 'MISMATCH'),
  );
}

/* ── and now the placement, on real world data ────────────────────────────── */
console.log('');
// A chunk with plenty of trees AND at least one of the drive-through species, so the report
// covers both halves of the rule.
let best = null;
for (let cz = -12; cz <= 12 && !best; cz++) {
  for (let cx = -12; cx <= 12; cx++) {
    const s = scatterChunk({ cx, cz, level: 0, seed: SEED });
    if (s.trees.length >= 10 && s.trees.some((p) => TRUNK_R[p.kind] === undefined)) {
      best = { cx, cz, s };
      break;
    }
  }
}
const { cx, cz, s } = best;
const trees = solidsFromScatter(s).filter((o) => o.kind === 'tree');
// Reproduce Flora._scatter's emit() exactly: the instance root it writes into iPos.
const drawn = s.trees
  .filter((p) => TRUNK_R[p.kind] !== undefined)
  .map((p) => ({ x: p.x, y: p.y - TREE_SINK * p.scale, z: p.z, kind: p.kind, scale: p.scale }));

let maxOff = 0;
for (let i = 0; i < Math.min(trees.length, drawn.length); i++) {
  maxOff = Math.max(
    maxOff,
    Math.abs(trees[i].x - drawn[i].x),
    Math.abs(trees[i].y - drawn[i].y),
    Math.abs(trees[i].z - drawn[i].z),
  );
}
console.log(`chunk (${cx},${cz}) level 0: ${s.trees.length} trees scattered, ${trees.length} solid, ${drawn.length} drawn`);
console.log(`worst |collider centre - drawn instance root| over x, y and z: ${maxOff.toExponential(2)} m`);
for (let i = 0; i < Math.min(6, trees.length); i++) {
  const a = trees[i];
  const b = drawn[i];
  console.log(
    `  ${b.kind.padEnd(10)} collider (${a.x.toFixed(3)}, ${a.y.toFixed(3)}, ${a.z.toFixed(3)}) r ${a.r.toFixed(3)}` +
      `   drawn root (${b.x.toFixed(3)}, ${b.y.toFixed(3)}, ${b.z.toFixed(3)}) scale ${b.scale.toFixed(3)}`,
  );
}
const skipped = s.trees.filter((p) => TRUNK_R[p.kind] === undefined);
if (skipped.length) {
  const kinds = [...new Set(skipped.map((p) => p.kind))].join(', ');
  console.log(`  ${skipped.length} drive-through (${kinds}) — knee-high, no collider on purpose`);
}
console.log(`  ${s.rocks.length} rocks, ${s.posts.length} posts, ${s.reeds.length} reeds scattered here — NOTHING draws these, so none of them is solid`);

const okAll = bad === 0 && maxOff === 0;
console.log(okAll ? '\nCOLLIDERS MATCH THE DRAWN TREES.' : '\nMISMATCH.');
process.exit(okAll ? 0 : 1);
