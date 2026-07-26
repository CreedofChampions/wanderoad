/* Wanderoad — prop placement.
 *
 * Where every tree, rock, bush, reed and post in the world stands. This is world state, not
 * decoration: two clients on the same seed must agree on it exactly, because you will drive
 * past a tree that someone else is parked behind.
 *
 * Placement is a jittered grid on a GLOBAL lattice, not a per-chunk one. That distinction is
 * the whole design:
 *
 *   - `chunkRng(cx,cz,seed)` would give a stream per chunk, but the same square metre of
 *     ground is covered by a level-0 node when you are near it and a level-2 node when you
 *     are 400 m away. A per-chunk stream would move every tree in the frame the LOD flips.
 *     A lattice cell keyed by its own integer coordinates does not care which node contains
 *     it, so a tree stays put while the ground under it is rebuilt at four resolutions.
 *   - A cell's props are a pure function of (cell index, seed). Chunking is therefore just a
 *     filter: emit the cells whose jittered point lands inside this node's box. No cell can
 *     be emitted twice and none can be missed, because a jittered point never leaves its own
 *     cell.
 *
 * Density comes from `BIOME_SCATTER[i]` (props per 100 m x 100 m), blended by biome weight,
 * and is applied as an ACCEPTANCE PROBABILITY on a fixed lattice rather than by resizing the
 * lattice. Same expected count, but the pattern stays irregular and — critically — the
 * lattice geometry is seed-global, so a meadow that fades into steppe thins out rather than
 * re-shuffling.
 *
 * No three.js, no DOM, no Math.random: this runs in a worker.
 */

import { Terrain } from './terrain.js';
import { BIOME_SCATTER, BIOME_COUNT, blendScalar, waterLevelAt } from './biomes.js';
import { nodeSize } from './chunk.js';
import { TAU, DEG, hash3i, rng } from '../core/math.js';

/**
 * Beyond this LOD level a node is at least 512 m across and its props are a couple of
 * pixels tall. Generating them costs a Terrain build and several hundred height samples for
 * something the eye resolves as noise on the hillside, which the terrain shader already
 * draws for free.
 */
export const SCATTER_MAX_LEVEL = 2;

/* The prop classes, in the order they are generated. The keys match BIOME_SCATTER exactly —
 * that table is the only place a density is allowed to live. */
const CLASSES = ['trees', 'rocks', 'bushes', 'reeds', 'posts'];

/* One salt per class so the five lattices are statistically independent. A rock and a tree
 * that share a cell index must not share a jitter, or every rock in the world would sit in
 * the shadow of a tree. */
const SALT = { trees: 0x54524545, rocks: 0x524f434b, bushes: 0x42555348, reeds: 0x52454544, posts: 0x504f5354 };

/* Peak occupancy of a lattice cell. The cell is sized so that the DENSEST biome fills 70% of
 * its cells: at 100% the densest biome would fill every cell and the jittered grid would
 * read as an orchard, and below ~50% the cells get large enough that clearings appear as
 * square holes. 0.7 is where neither artefact is visible at 20 m. */
const OCCUPANCY = 0.7;

/* Posts are roadside furniture, so their whole budget is spent on the few percent of the
 * ground that is within POST_REACH of a centreline. Sized from the biome peak like the
 * others, the lattice would be 76 m across and a road would get a marker every 300 m.
 * A fixed 34 m cell plus a concentration multiplier spends the SAME per-hectare budget in
 * the corridor where it belongs: a post about every 50 m of verge, and none in open field.
 * The multiplier is capped at probability 1 — the jitter is what keeps the line irregular. */
const POST_CELL = 34;
const ROADSIDE_CONCENTRATION = 6;

/** Cell size and area per class, derived from the peak density in biomes.js. */
const CELL = {};
const CELL_AREA = {};
const BOOST = {};
for (const key of CLASSES) {
  let peak = 0;
  for (let i = 0; i < BIOME_COUNT; i++) peak = Math.max(peak, BIOME_SCATTER[i][key]);
  // area such that (peak density) * area / 100x100 m === OCCUPANCY
  CELL[key] = key === 'posts' ? POST_CELL : Math.sqrt((1e4 * OCCUPANCY) / peak);
  CELL_AREA[key] = CELL[key] * CELL[key];
  BOOST[key] = key === 'posts' ? ROADSIDE_CONCENTRATION : 1;
}

/* Steepest ground each class will stand on, as cos(angle) against the surface normal's Y.
 * Trees at 34 deg is the brief's number and it is a good one — above that a root plate has
 * nothing to sit on and the trunk visibly floats out of the hillside. Rocks are allowed on
 * anything short of a cliff because a boulder resting on a scree slope is the point. */
const MAX_SLOPE = {
  trees: Math.cos(34 * DEG),
  rocks: Math.cos(58 * DEG),
  bushes: Math.cos(42 * DEG),
  reeds: Math.cos(12 * DEG),
  posts: Math.cos(24 * DEG),
};

/** Anything with this much carriageway under it is standing in the road. */
const CARRIAGEWAY = 0.15;

/** Posts are roadside furniture — beyond this from a centreline there is nothing to mark. */
const POST_REACH = 26;

/** Reeds live in the shallows: this far below the waterline to this far above it. */
const REED_DEPTH = 1.6;
const REED_RISE = 0.35;

/** Finite-difference arm for the slope test, in metres. */
const SLOPE_ARM = 2.0;

/* Per-class gates, applied in the order the site loop can afford them.
 *
 *   roadOk   after the road query, before ANY height sample
 *   waterOk  after one height sample, before the two more the slope test costs
 *
 * Ordering the rejections instead of doing them all in the emit callback is worth about a
 * third of the whole pass, because the two classes that reject the most — reeds outside the
 * shallows, posts away from a road — now reject before they have paid for anything.
 * `d` is metres to the nearest centreline, `w` its carriageway width. */
const ROAD_OK = {
  // Canopies need real clearance: a broadleaf planted on the verge overhangs the lane.
  trees: (edge, d, w) => edge <= CARRIAGEWAY && d >= w * 0.5 + 2.5,
  bushes: (edge, d, w) => edge <= CARRIAGEWAY && d >= w * 0.5 + 1.4,
  rocks: (edge, d, w) => edge <= CARRIAGEWAY && d >= w * 0.5 + 1.2,
  reeds: (edge) => edge <= CARRIAGEWAY,
  posts: (edge, d) => edge <= 0.05 && d <= POST_REACH,
};

/* Metres of dry ground above the local water plane. Rocks take a negative freeboard because
 * a boulder half in a stream is worth having; reeds invert the test entirely, which is what
 * puts a fringe around every marsh pool without anyone having to find the shoreline. */
const WATER_OK = {
  trees: (y, wy) => wy === null || y >= wy + 0.9,
  bushes: (y, wy) => wy === null || y >= wy + 0.5,
  rocks: (y, wy) => wy === null || y >= wy - 0.6,
  posts: (y, wy) => wy === null || y >= wy + 0.3,
  reeds: (y, wy) => wy !== null && wy - y <= REED_DEPTH && wy - y >= -REED_RISE,
};

/** Pick a biome by weight from a uniform draw. Used to choose which biome's species list a
 *  tree comes from, so a meadow/highland border grows a genuine mix of broadleaf and pine. */
function pickBiome(w, u) {
  let acc = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    acc += w[i];
    if (u < acc) return i;
  }
  return BIOME_COUNT - 1;
}

/**
 * Walk every lattice cell of one class that can land in this node, in a fixed order, and
 * hand the accepted ones to `emit`.
 *
 * `emit(s, rnd)` receives a scratch site record — valid only for the duration of the call,
 * every field is overwritten for the next candidate — and the cell's own PRNG stream. It
 * returns nothing; it pushes whatever record it wants.
 */
function eachSite(key, terr, seed, ox, oz, size, w, s, emit) {
  const cell = CELL[key];
  const area = CELL_AREA[key];
  const boost = BOOST[key];
  const salt = SALT[key];
  const maxSlope = MAX_SLOPE[key];
  const roadOk = ROAD_OK[key];
  const waterOk = WATER_OK[key];
  const g0 = Math.floor(ox / cell);
  const g1 = Math.floor((ox + size - 1e-6) / cell);
  const h0 = Math.floor(oz / cell);
  const h1 = Math.floor((oz + size - 1e-6) / cell);

  for (let gj = h0; gj <= h1; gj++) {
    for (let gi = g0; gi <= g1; gi++) {
      const rnd = rng(hash3i(gi, gj, salt, seed));
      const x = (gi + rnd()) * cell;
      const z = (gj + rnd()) * cell;
      // A jittered point never leaves its cell, so testing the box here is what guarantees
      // exactly-once emission across neighbouring nodes and across LOD levels.
      if (x < ox || x >= ox + size || z < oz || z >= oz + size) continue;

      // Cheapest rejection first: density is one climate-grid lookup plus five multiplies.
      const b = terr.weights(x, z);
      w.set(b.w); // b.w is Terrain's own scratch and is clobbered by the height calls below
      const dominant = b.dominant;
      const density = blendScalar(w, BIOME_SCATTER, key);
      if (rnd() >= (density * area * boost) / 1e4) continue;

      // Then the road: one segment sweep over a handful of cached edges, no heights.
      const c = terr.roads.carve(x, z);
      if (!roadOk(c.edge, c.d, c.width)) continue;

      const y = terr.height(x, z);
      // -Infinity asks waterLevelAt for the water PLANE here rather than "am I under it";
      // the caller needs the height itself to work out freeboard or wading depth.
      const wy = waterLevelAt(w, -Infinity);
      if (!waterOk(y, wy)) continue;

      // Slope by forward differences rather than Terrain.normal(): two height samples
      // instead of four, and at a 2 m arm it agrees with the mesh normal to well under a
      // degree on anything a tree could stand on anyway.
      const nx = (y - terr.height(x + SLOPE_ARM, z)) / SLOPE_ARM;
      const nz = (y - terr.height(x, z + SLOPE_ARM)) / SLOPE_ARM;
      const ny = 1 / Math.hypot(nx, 1, nz);
      if (ny < maxSlope) continue;

      s.x = x;
      s.z = z;
      s.y = y;
      s.ny = ny;
      s.dominant = dominant;
      s.wy = wy;
      s.onRoad = c.edge;
      s.roadD = c.d;
      s.roadW = c.width;
      s.roadTx = c.tx;
      s.roadTz = c.tz;
      emit(s, rnd);
    }
  }
}

/**
 * Every prop in one terrain node.
 *
 * @param {object} req {cx, cz, level, seed} — node indices at that level, as the streamer
 *                     and chunk mesher use them.
 * @returns {{trees:object[],rocks:object[],bushes:object[],reeds:object[],posts:object[]}}
 *          World-space records. `y` is the ground height at the prop's foot; sinking the
 *          root is the renderer's business, because a rock and a tree bury differently.
 */
export function scatterChunk({ cx, cz, level, seed }) {
  const out = { trees: [], rocks: [], bushes: [], reeds: [], posts: [] };
  if (!(level >= 0) || level > SCATTER_MAX_LEVEL) return out;

  const size = nodeSize(level);
  const ox = cx * size;
  const oz = cz * size;
  // The pad only has to cover the furthest thing a site can ask about, which is a post
  // looking POST_REACH metres for a road it can stand beside. Terrain adds another 64 m of
  // its own for the climate grid, and every extra metre is climate samples nobody reads.
  const terr = new Terrain(seed, ox, oz, ox + size, oz + size, Math.max(POST_REACH + 16, size * 0.25));

  const w = new Float32Array(BIOME_COUNT);
  const s = {
    x: 0, z: 0, y: 0, ny: 1, wy: null, dominant: 0,
    onRoad: 0, roadD: Infinity, roadW: 0, roadTx: 1, roadTz: 0,
  };

  // ── trees ──────────────────────────────────────────────────────────────────
  eachSite('trees', terr, seed, ox, oz, size, w, s, (site, rnd) => {
    const kinds = BIOME_SCATTER[pickBiome(w, rnd())].kinds;
    out.trees.push({
      x: site.x,
      y: site.y,
      z: site.z,
      yaw: rnd() * TAU,
      // The canopy geometry is one mesh per species, so scale is the only silhouette
      // variation instancing can give us. A 2:1 spread reads as a mixed-age stand.
      scale: 0.72 + rnd() * 0.66,
      kind: kinds[(rnd() * kinds.length) | 0],
      hue: rnd(),
      biome: site.dominant,
    });
  });

  // ── bushes ─────────────────────────────────────────────────────────────────
  eachSite('bushes', terr, seed, ox, oz, size, w, s, (site, rnd) => {
    out.bushes.push({
      x: site.x,
      y: site.y,
      z: site.z,
      yaw: rnd() * TAU,
      scale: 0.62 + rnd() * 0.7,
      kind: 'scrub',
      hue: rnd(),
      biome: site.dominant,
    });
  });

  // ── rocks ──────────────────────────────────────────────────────────────────
  eachSite('rocks', terr, seed, ox, oz, size, w, s, (site, rnd) => {
    const u = rnd();
    out.rocks.push({
      x: site.x,
      y: site.y,
      z: site.z,
      yaw: rnd() * TAU,
      // Heavy-tailed: mostly cobbles with the occasional erratic. A uniform size makes a
      // scree slope look like gravel scattered by a machine.
      scale: 0.34 + Math.pow(rnd(), 2.4) * 3.1,
      kind: u < 0.58 ? 'boulder' : u < 0.86 ? 'slab' : 'shard',
      // Slabs lie down, shards stand up; the tilt is how far off vertical the long axis is.
      tilt: (rnd() - 0.5) * (u < 0.58 ? 0.5 : u < 0.86 ? 0.9 : 0.3),
      hue: rnd(),
      biome: site.dominant,
    });
  });

  // ── reeds ──────────────────────────────────────────────────────────────────
  eachSite('reeds', terr, seed, ox, oz, size, w, s, (site, rnd) => {
    out.reeds.push({
      x: site.x,
      y: site.y,
      z: site.z,
      yaw: rnd() * TAU,
      scale: 0.6 + rnd() * 0.7,
      kind: 'reed',
      hue: rnd(),
      depth: site.wy - site.y, // positive = standing in water; the renderer sinks by this
      biome: site.dominant,
    });
  });

  // ── posts ──────────────────────────────────────────────────────────────────
  // Roadside furniture, so it is placed against the road rather than against the biome:
  // the biome only decides how much of it there is. A post in the middle of a field is a
  // fence post and reads as litter; a line of them along a verge reads as a road.
  eachSite('posts', terr, seed, ox, oz, size, w, s, (site, rnd) => {
    const verge = site.roadD < site.roadW * 0.5 + 3.5;
    out.posts.push({
      x: site.x,
      y: site.y,
      z: site.z,
      // A marker post faces the traffic; a field post is planted at whatever angle.
      yaw: verge ? Math.atan2(site.roadTx, site.roadTz) + Math.PI * 0.5 : rnd() * TAU,
      scale: verge ? 0.85 + rnd() * 0.3 : 0.7 + rnd() * 0.5,
      kind: verge ? (rnd() < 0.12 ? 'milestone' : 'marker') : 'fence',
      lean: (rnd() - 0.5) * 0.16, // nothing planted by hand is ever plumb
      hue: rnd(),
      biome: site.dominant,
    });
  });

  return out;
}

/**
 * Expected prop count for a node, without generating it. The renderer uses this to size its
 * instance buffers before the first chunk arrives, so the first hundred chunks do not each
 * trigger a reallocation.
 */
export function scatterBudget(level) {
  if (!(level >= 0) || level > SCATTER_MAX_LEVEL) return 0;
  const area = nodeSize(level) * nodeSize(level);
  let peak = 0;
  for (const key of CLASSES) {
    let m = 0;
    for (let i = 0; i < BIOME_COUNT; i++) m = Math.max(m, BIOME_SCATTER[i][key]);
    peak += m;
  }
  return Math.ceil((peak * area) / 1e4);
}
