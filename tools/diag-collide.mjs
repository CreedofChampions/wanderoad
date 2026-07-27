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
import { readFileSync } from 'node:fs';
import { makeTree, TREE_ARCH } from '../src/render/trees.js';
import { scatterChunk } from '../src/world/scatter.js';
import { Solids, solidsFromScatter, TRUNK_R, TREE_SINK } from '../src/game/collide.js';
import { hash2i } from '../src/core/math.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { BIOME_COUNT, waterLevelAt } from '../src/world/biomes.js';
import { LEAF, LEVELS, nodeSize } from '../src/world/chunk.js';
import { Vehicle } from '../src/car/vehicle.js';

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

/* ══════════════════════════════════════════════════════════════════════════
 * THE COUNT IS NOT THE POINT. THE RELATION IS.
 *
 * `solids.count` fell from 340 to 37 around the player when the forest field landed, and
 * every check that watched it passed both times, because they all watched an absolute
 * number. An absolute number cannot be right: 37 is correct on a plain and a catastrophe in
 * a wood. So the rest of this file measures the RELATION instead — for a given piece of
 * ground, is the set of colliders EXACTLY the set of drawn trees of a solid species — and
 * then drives a real car into real trees to prove the relation is worth having.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Reproduce main.js's onChunk for one level-0 node: what is drawn, and what is solid. */
function reconcile(ncx, ncz) {
  const sc = scatterChunk({ cx: ncx, cz: ncz, level: 0, seed: SEED });
  // Flora._scatter emits EVERY record in props.trees, so "drawn" is the whole list; the ones
  // that must be solid are the ones whose species is in TRUNK_R.
  const shouldBeSolid = sc.trees.filter((p) => TRUNK_R[p.kind] !== undefined);
  const driveThrough = sc.trees.length - shouldBeSolid.length;
  const solid = solidsFromScatter(sc).filter((o) => o.kind === 'tree');
  // Exact set equality on position, not a count: two colliders on one tree and none on the
  // next would balance a count and still be a tree you can drive through.
  const want = new Map(shouldBeSolid.map((p) => [`${p.x},${p.z}`, p]));
  let missing = 0;
  let orphan = 0;
  let worst = 0;
  for (const o of solid) {
    const p = want.get(`${o.x},${o.z}`);
    if (!p) {
      orphan++;
      continue;
    }
    want.delete(`${o.x},${o.z}`);
    worst = Math.max(worst, Math.abs(o.y - (p.y - TREE_SINK * p.scale)), Math.abs(o.r - TRUNK_R[p.kind] * p.scale));
  }
  missing = want.size;
  return { trees: sc.trees.length, drawnSolid: shouldBeSolid.length, driveThrough, solid: solid.length, missing, orphan, worst };
}

/* ── the relation across the whole range of tree density ──────────────────── */
console.log('\n── the same relation in a wood, in thin woodland and on an empty plain ──');
console.log('The forest field makes density a place rather than a constant, so the only');
console.log('honest test is that colliders follow it. Each row is 25 real level-0 chunks.\n');

/** 25 chunks in a 5x5 block whose centre chunk sits in the wanted regime. */
function block(centreCx, centreCz) {
  const out = [];
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) out.push([centreCx + i, centreCz + j]);
  return out;
}
/* Real coordinates on the shipped seed, PINNED rather than searched for at run time. Pinning
 * is the point: if a worldgen change moves the density, these rows move with it and somebody
 * has to look, whereas a tool that goes and finds the densest block every run would report
 * "dense forest: dense" forever. They were picked by scanning a 9 km square of level-0 chunks
 * for the densest 5x5 block, a mid-range one and an empty one.
 *
 * THE `dry` COLUMN IS NOT DECORATION. The first empty block this scan turned up was empty
 * because it was 95% SEA, which makes "colliders = trees = 0" true and worthless, and would
 * have shipped a row labelled "open plain" over open water. A regime row has to be dry land
 * or it is not evidence about tree density at all — so the dryness is measured and the run
 * fails if a pin drifts underwater. */
const REGIMES = [
  ['deep forest ', -13, 61],
  ['thin wood   ', -28, -70],
  ['open plain  ', -22, -31],
];
let relationBad = 0;
console.log('where            centre (m)      trees  drawn-solid  colliders  drive-thru   trees/ha   dry  verdict');
for (const [label, bcx, bcz] of REGIMES) {
  let t = 0;
  let ds = 0;
  let so = 0;
  let dt = 0;
  let miss = 0;
  let orph = 0;
  let worst = 0;
  for (const [ncx, ncz] of block(bcx, bcz)) {
    const r = reconcile(ncx, ncz);
    t += r.trees;
    ds += r.drawnSolid;
    so += r.solid;
    dt += r.driveThrough;
    miss += r.missing;
    orph += r.orphan;
    worst = Math.max(worst, r.worst);
  }
  // Dry land, on a 16 m grid over the whole block: freeboard measured the way scatter's own
  // WATER_OK test measures it.
  const ox = (bcx - 2) * 64;
  const oz = (bcz - 2) * 64;
  const TB = new Terrain(SEED, ox, oz, ox + 320, oz + 320, 120);
  const wv = new Float32Array(BIOME_COUNT);
  let dry = 0;
  let cells = 0;
  for (let z = oz; z < oz + 320; z += 16) {
    for (let x = ox; x < ox + 320; x += 16) {
      wv.set(TB.weights(x, z).w);
      const y = TB.height(x, z);
      const wy = waterLevelAt(wv, -Infinity);
      if (wy === null || y >= wy + 0.4) dry++;
      cells++;
    }
  }
  const dryPct = (100 * dry) / cells;
  const ok = miss === 0 && orph === 0 && so === ds && worst === 0 && dryPct > 90;
  if (!ok) relationBad++;
  const ha = (25 * 64 * 64) / 1e4;
  console.log(
    `${label}  (${String((bcx + 0.5) * 64).padStart(6)},${String((bcz + 0.5) * 64).padStart(6)})   ` +
      `${String(t).padStart(5)}  ${String(ds).padStart(11)}  ${String(so).padStart(9)}  ${String(dt).padStart(10)}   ` +
      `${(t / ha).toFixed(1).padStart(8)}  ${`${dryPct.toFixed(0)}%`.padStart(4)}  ` +
      (dryPct <= 90
        ? `NOT LAND — this row is ${(100 - dryPct).toFixed(0)}% water and proves nothing`
        : ok
          ? 'colliders = drawn trees, exactly'
          : `BROKEN: ${miss} missing, ${orph} orphan, r/y worst ${worst}`),
  );
}

/* ── and the number the browser suite reports, explained ──────────────────── */
/* Reproduce Streamer._select for level 0. Only the finest level carries collision, and the
 * finest level is exactly the ground within nodeSize(1) * SPLIT_FACTOR = 218 m of the
 * camera, so "solids nearby" is a fixed ~64-chunk ring whose CONTENTS are whatever the
 * forest field put there. That is the whole explanation of 340 -> 37. */
const SPLIT_FACTOR = 1.7; // src/world/streamer.js
const VIEW = 6800; // main.js
const TOP = Math.min(LEVELS - 1, Math.max(0, Math.ceil(Math.log2(VIEW / LEAF))));
function level0Ring(camX, camZ) {
  const out = [];
  const topSize = nodeSize(TOP);
  const r = Math.ceil(VIEW / topSize) + 1;
  const ci = Math.floor(camX / topSize);
  const cj = Math.floor(camZ / topSize);
  const stack = [];
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) stack.push([i, j, TOP]);
  while (stack.length) {
    const [ncx, ncz, level] = stack.pop();
    const size = nodeSize(level);
    const dx = Math.max(Math.abs(camX - (ncx + 0.5) * size) - size * 0.5, 0);
    const dz = Math.max(Math.abs(camZ - (ncz + 0.5) * size) - size * 0.5, 0);
    const d = Math.hypot(dx, dz);
    if (d > VIEW) continue;
    if (level > 0 && d < size * SPLIT_FACTOR) {
      const nl = level - 1;
      stack.push([ncx * 2, ncz * 2, nl], [ncx * 2 + 1, ncz * 2, nl], [ncx * 2, ncz * 2 + 1, nl], [ncx * 2 + 1, ncz * 2 + 1, nl]);
    } else if (level === 0) out.push([ncx, ncz]);
  }
  return out;
}

console.log('\n── "solids nearby", which is a ring of level-0 chunks and nothing else ──');
const spawn = findSpawn(SEED);
const PLACES = [
  ['spawn', spawn.x, spawn.z],
  ['deep forest', (-13 + 0.5) * 64, (61 + 0.5) * 64],
  ['thin wood', (-28 + 0.5) * 64, (-70 + 0.5) * 64],
  ['open plain', (-22 + 0.5) * 64, (-31 + 0.5) * 64],
];
for (const [label, X, Z] of PLACES) {
  const ring = level0Ring(X, Z);
  let t = 0;
  let so = 0;
  for (const [ncx, ncz] of ring) {
    const r = reconcile(ncx, ncz);
    t += r.trees;
    so += r.solid;
  }
  const ha = (ring.length * 64 * 64) / 1e4;
  console.log(
    `  ${label.padEnd(12)} (${X.toFixed(0)}, ${Z.toFixed(0)})  ${String(ring.length).padStart(3)} level-0 chunks, ` +
      `${ha.toFixed(1)} ha:  ${String(t).padStart(4)} trees, ${String(so).padStart(4)} tree colliders  (${(t / ha).toFixed(1)} trees/ha)`,
  );
}
console.log('  The ring is the same size everywhere. What changes is what is standing in it.');

/* ══════════════════════════════════════════════════════════════════════════
 * AND NOW THE THING THE PLAYER ACTUALLY FEELS.
 *
 * Everything above compares two lists. A list is not a wall. These last two sections drive
 * at the trees, because "the collider is registered" and "the car stops" are different
 * claims and only the second one is the game.
 * ══════════════════════════════════════════════════════════════════════════ */

const CAR_R = 1.05; // exactly what main.js passes solids.resolve
/** A real wood on the shipped seed — the densest 5x5 block found in a 9 km square. */
const FCX = -13;
const FCZ = 61;
const forestScatter = scatterChunk({ cx: FCX, cz: FCZ, level: 0, seed: SEED });
const targets = solidsFromScatter(forestScatter).filter((o) => o.kind === 'tree');
const kindOf = new Map(forestScatter.trees.map((p) => [`${p.x},${p.z}`, p.kind]));

/* ── 1. not one of them is passable ───────────────────────────────────────── */
/* Every collider in that chunk, at its real position, its real species radius and its real
 * instance scale, swept through at speeds and frame times no car in the fleet can reach.
 * Each tree gets its own Solids so the answer is about THAT tree: in a wood this dense the
 * run-up to one trunk goes past three others, and "something stopped me" is not the claim.
 * The sweep is Solids.resolve itself — the same code main.js calls — driven by a kinematic
 * body, so a pass here is a statement about the collider and not about the engine. */
console.log('\n── is any tree in a real wood passable? ─────────────────────────────────');
let tunnelled = 0;
let smallest = Infinity;
let smallestKind = '';
const SWEEPS = [
  [180 / 3.6, 1 / 60],
  [180 / 3.6, 1 / 30],
  [360 / 3.6, 1 / 30],
  [360 / 3.6, 0.1], // 10 m of travel in one step, against trunks 0.6 m across
];
for (const tree of targets) {
  const one = new Solids();
  one.addChunk('t', [tree]);
  if (tree.r < smallest) {
    smallest = tree.r;
    smallestKind = kindOf.get(`${tree.x},${tree.z}`);
  }
  for (const [mps, dt] of SWEEPS) {
    // Straight through the centre, from -Z. Forward is (sin yaw, cos yaw) — car/input.js —
    // so this is yaw 0, and +X would be the driver's LEFT if he were in it.
    const body = { x: tree.x, y: tree.y + 0.6, z: tree.z - mps * dt - 4, vx: 0, vz: mps, yawRate: 0 };
    one._px = null;
    let caught = false;
    for (let i = 0; i < 400 && !caught; i++) {
      body.x += body.vx * dt;
      body.z += body.vz * dt;
      if (one.resolve(body, CAR_R, dt)) caught = true;
      if (body.z > tree.z + 20) break;
    }
    // Caught means caught BEFORE the centre: a "hit" reported on the far side is a tunnel
    // that happened to be noticed afterwards, and the car is already through the trunk.
    if (!caught || body.z > tree.z) {
      tunnelled++;
      console.log(
        `  PASSABLE  ${(kindOf.get(`${tree.x},${tree.z}`) || '?').padEnd(10)} (${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}) ` +
          `r ${tree.r.toFixed(2)} at ${(mps * 3.6).toFixed(0)} km/h, dt ${dt.toFixed(3)} — ended at z ${body.z.toFixed(2)}`,
      );
    }
  }
}
console.log(
  `  ${targets.length} real colliders in chunk (${FCX},${FCZ}) x ${SWEEPS.length} sweeps = ` +
    `${targets.length * SWEEPS.length} runs, ${tunnelled} passable. ` +
    `Thinnest trunk in the wood: ${smallestKind} at r ${smallest.toFixed(3)} m.`,
);

/* ── 2. and driving into one stops the car dead ───────────────────────────── */
/* The full game loop this time: a real Vehicle on the real heightfield, real roads under it,
 * the whole neighbourhood's colliders loaded the way the streamer loads them, and
 * car.update() then solids.resolve() in main.js's order. The car steers itself at the
 * target, because on real ground a car held at zero steer drifts off the line down the fall
 * of the hill and misses — which is a fact about the hill and not about the tree. */
console.log('\n── and driving into one, for real ───────────────────────────────────────');
const OX = FCX * 64;
const OZ = FCZ * 64;
const T = new Terrain(SEED, OX - 320, OZ - 320, OX + 384, OZ + 384, 220);
const drive = new Solids();
for (let j = -3; j <= 3; j++) {
  for (let i = -3; i <= 3; i++) {
    drive.addChunk(
      `${FCX + i},${FCZ + j}`,
      solidsFromScatter(scatterChunk({ cx: FCX + i, cz: FCZ + j, level: 0, seed: SEED })),
    );
  }
}
const RUNUP = 40; // metres of run-up — a 'sports' tier reaches 45-60 km/h in that
let stops = 0;
let missed = 0;
let worstResidual = 0;
const rows = [];
for (const tree of targets.slice(0, 12)) {
  const car = new Vehicle({ tier: 'sports', terrain: T, preset: 'sport' });
  car.placeAt(tree.x, tree.z - RUNUP, 0);
  drive._px = null;
  let speedIn = 0;
  let result = null;
  for (let i = 0; i < 60 * 20; i++) {
    // Hold the bearing on the tree. Positive steer turns LEFT and a positive yaw rate
    // rotates forward towards +X (vehicle.js says both), so a positive heading error wants
    // a positive steer — get this backwards and the car drives away from the tree, which is
    // the third time handedness has bitten this project.
    let e = Math.atan2(tree.x - car.x, tree.z - car.z) - car.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    const input = { steer: Math.max(-1, Math.min(1, e * 3)), throttle: 1, brake: 0, handbrake: 0, analogue: true };
    const pre = Math.hypot(car.vx, car.vz);
    car.update(1 / 60, input);
    const h = drive.resolve(car, CAR_R, 1 / 60);
    const d = Math.hypot(car.x - tree.x, car.z - tree.z);
    if (h) {
      result = { onTarget: d < tree.r + CAR_R + 0.35, speed: Math.hypot(car.vx, car.vz), d, kind: h.kind };
      speedIn = pre;
      break;
    }
    if (d > RUNUP + 25) break; // driven away from it entirely — inconclusive, counted below
  }
  const name = (kindOf.get(`${tree.x},${tree.z}`) || '?').padEnd(10);
  if (result && result.onTarget) {
    stops++;
    worstResidual = Math.max(worstResidual, result.speed * 3.6);
    rows.push(
      `  ${name} (${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}) r ${tree.r.toFixed(2)}   ` +
        `${(speedIn * 3.6).toFixed(1).padStart(6)} -> ${(result.speed * 3.6).toFixed(2)} km/h   ` +
        `resting ${result.d.toFixed(2)} m from the trunk (r+car ${(tree.r + CAR_R).toFixed(2)})`,
    );
  } else if (result) {
    // A trunk between here and there stopped the car first. That is still a tree stopping a
    // car — it is section 1's job to say the target itself is solid — so it is reported, not
    // failed.
    stops++;
    worstResidual = Math.max(worstResidual, result.speed * 3.6);
    rows.push(
      `  ${name} (${tree.x.toFixed(1)}, ${tree.z.toFixed(1)})   stopped ${(speedIn * 3.6).toFixed(1)} -> ` +
        `${(result.speed * 3.6).toFixed(2)} km/h on an intervening ${result.kind} ${result.d.toFixed(1)} m short`,
    );
  } else {
    missed++;
    rows.push(`  ${name} (${tree.x.toFixed(1)}, ${tree.z.toFixed(1)})   never reached it (terrain) — inconclusive`);
  }
}
for (const r of rows) console.log(r);
console.log(
  `  ${rows.length} real drives at real trees: ${stops} dead stops, ${missed} inconclusive. ` +
    `Worst speed left after a hit: ${worstResidual.toFixed(2)} km/h.`,
);

/* ── and the browser suite's version of the same question can still fail ───── */
/* tools/browser-test.mjs asks Chrome the same thing this file asks node, and a check that
 * cannot fail is worse than no check at all — that is the whole reason this task existed.
 * So the expression it sends to the page is pulled out of that file and run HERE, against a
 * stand-in for window.WANDEROAD built from the real Solids and the real Flora emit rule,
 * once on a correct world and once for each way of breaking it. No browser, no port. */
console.log('\n── the browser suite asks this in the page: can its version fail? ──────');
{
  const src = readFileSync(new URL('./browser-test.mjs', import.meta.url), 'utf8');
  const m = src.match(/const solid = await evalJs\(`([\s\S]*?)`\);/);
  if (!m) {
    // Not a failure of the collider. Somebody has restructured browser-test.mjs, and the
    // honest thing is to say out loud that its logic went unverified rather than to imply
    // it passed.
    console.log('  NOTICE: could not find the check in tools/browser-test.mjs — NOT verified here.');
  } else {
    const run = new Function('window', 'return (' + m[1] + ')');
    /** A ring of level-0 chunks wired up exactly as main.js's onChunk wires the real one. */
    const stand = ({ drop = false, ghost = false, shift = false } = {}) => {
      const S = new Solids();
      const live = new Map();
      const chunks = new Map();
      let n = 0;
      for (let j = -4; j <= 4; j++) {
        for (let i = -4; i <= 4; i++) {
          const ncx = FCX + i;
          const ncz = FCZ + j;
          const sc = scatterChunk({ cx: ncx, cz: ncz, level: 0, seed: SEED });
          // Flora._scatter emits EVERY tree record, grouped by `${kind}:${detail}`, with the
          // root sunk by 0.35 * scale.
          const groups = new Map();
          for (const p of sc.trees) {
            const bk = `${p.kind}:2`;
            if (!groups.has(bk)) groups.set(bk, { kind: p.kind, detail: 2, pos: [] });
            groups.get(bk).pos.push(p.x, p.y - TREE_SINK * p.scale, p.z, p.scale);
          }
          chunks.set(`0:${ncx},${ncz}`, { groups, blocks: [] });
          let list = solidsFromScatter(sc);
          if (n === 4 && list.length) {
            if (drop) list = list.slice(1);
            if (shift) list = list.map((o, k) => (k ? o : { ...o, y: o.y + 0.5 }));
          }
          if (ghost && n === 4) list = list.concat([{ x: ncx * 64 + 5, y: 0, z: ncz * 64 + 5, r: 1, h: 9, kind: 'tree', solid: true }]);
          S.addChunk(`${ncx},${ncz}`, list);
          live.set(`0:${ncx},${ncz}`, { level: 0, cx: ncx, cz: ncz });
          n++;
        }
      }
      return { WANDEROAD: { solids: S, flora: { chunks }, streamer: { live } } };
    };
    // The same predicate browser-test.mjs applies to the result.
    const verdict = (r) => r.chunks >= 16 && r.missing === 0 && r.orphan === 0 && r.worstY === 0;
    const CASES = [
      ['the world as it actually is', {}, true],
      ['one drawn tree loses its collider', { drop: true }, false],
      ['a collider standing on nothing', { ghost: true }, false],
      ['a collider 0.5 m off its trunk', { shift: true }, false],
    ];
    for (const [label, opts, want] of CASES) {
      const r = run(stand(opts));
      const got = verdict(r);
      if (got !== want) relationBad++;
      console.log(
        `  ${got === want ? 'ok  ' : 'BAD '} ${label.padEnd(34)} ${got ? 'PASS' : 'FAIL'} (wanted ${want ? 'PASS' : 'FAIL'})  ` +
          `${r.colliders} colliders / ${r.drawn} drawn over ${r.chunks} chunks, ` +
          `${r.missing} missing, ${r.orphan} orphan, dy ${r.worstY}, ${r.passable} drive-through`,
      );
    }
  }
}

const okAll =
  bad === 0 && maxOff === 0 && relationBad === 0 && tunnelled === 0 && stops >= 10 && worstResidual < 1;
console.log(okAll ? '\nCOLLIDERS MATCH THE DRAWN TREES, AND NONE OF THEM IS PASSABLE.' : '\nMISMATCH.');
process.exit(okAll ? 0 : 1);
