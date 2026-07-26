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
 * A BIOME DENSITY IS AN AVERAGE, NOT A LAYOUT. On its own it puts the same 26 trees on every
 * hectare of meadow in the world, and the eye reads that instantly as wallpaper: you can see
 * the same distance in every direction forever, and no piece of ground is anywhere. So each
 * clustered class is multiplied by a low-frequency FIELD (`forestDensity`, `coverDensity`)
 * whose area mean is 1: the biome table still says what a hectare of meadow averages, but
 * that average is now spent as real woods, real thin scrub and real open plain you can see
 * across. The fields are noise on world coordinates, so they cost no state and cross biome
 * borders without a seam — a wood runs from meadow into highland and changes species halfway.
 *
 * No three.js, no DOM, no Math.random: this runs in a worker.
 */

import { Terrain } from './terrain.js';
import { BIOME_SCATTER, BIOME_COUNT, blendScalar, waterLevelAt } from './biomes.js';
import { nodeSize } from './chunk.js';
import { TAU, DEG, hash3i, rng, smoothstep, clamp01 } from '../core/math.js';
import { fbm2, warpedFbm2, noise2 } from '../core/noise.js';

/**
 * Beyond this LOD level a node is at least 512 m across and its props are a couple of
 * pixels tall. Generating them costs a Terrain build and several hundred height samples for
 * something the eye resolves as noise on the hillside, which the terrain shader already
 * draws for free.
 */
export const SCATTER_MAX_LEVEL = 2;

/**
 * Flowers and ground cover are knee-high and only exist on the finest nodes. Level 0 is
 * 64 m and the streamer splits a level-1 node once its nearest edge is within
 * `nodeSize(1) * SPLIT_FACTOR` = 217 m, so every square metre inside 217 m of the car is
 * covered by a level-0 node. Anything the flower renderer draws inside that radius is
 * therefore always present — no LOD ladder, no popping as a node splits, and none of the
 * cost of scattering a 4 m lattice over a 256 m node nobody can see the flowers in.
 */
export const FLOWER_MAX_LEVEL = 0;

/* The prop classes, in the order they are generated. The first five keys match BIOME_SCATTER
 * exactly — that table is the only place a per-biome density is allowed to live. */
const CLASSES = ['trees', 'rocks', 'bushes', 'reeds', 'posts', 'flowers'];

/* One salt per class so the lattices are statistically independent. A rock and a tree that
 * share a cell index must not share a jitter, or every rock in the world would sit in the
 * shadow of a tree. */
const SALT = {
  trees: 0x54524545, rocks: 0x524f434b, bushes: 0x42555348,
  reeds: 0x52454544, posts: 0x504f5354, flowers: 0x464c4f57,
};

/* ── the density fields ──────────────────────────────────────────────────────
 * Two slow scalar fields over the world, in the same spirit as the climate fields in
 * biomes.js: pure functions of (x, z, seed), no state, identical on every client.
 *
 * FOREST. Wavelength matters more than shape here. At 1.25 km a wood takes the best part of
 * a minute to drive through at a cruise and you come out of it into somewhere that looks
 * different — which is the entire point. Much shorter and the world flickers between wood
 * and field; much longer and a single stand outlives the player's attention. The grain term
 * is a fifth of the amplitude at a fifth of the wavelength: it ravels the edge of a wood and
 * punches clearings in the middle of one, and it is the reason a forest border is a ragged
 * line of outliers rather than a contour.
 */
const FOREST_SCALE = 1 / 1250;
const FOREST_GRAIN = 1 / 265;

/**
 * How much denser than the biome's book figure a closed canopy gets. Everything downstream
 * is sized off this: the tree lattice cell is shrunk by the same factor so that the DEEPEST
 * forest is the thing sitting at OCCUPANCY, rather than the plain average. Raise it and the
 * lattice gets finer and the pass gets slower; there is no free density.
 */
const FOREST_MAX = 3.4;

/* Where the three regimes meet, on the raw field. Tuned by measurement, not by eye — see
 * tools/diag-forests.mjs, which reports the area mean (it must stay at 1.00, or the biome
 * table stops meaning what it says) and the share of the world in each regime. */
const PLAIN_EDGE = -0.09; // below: open plain, not one tree
const WOOD_EDGE = 0.08; // here: exactly the biome's book density
const DEEP_EDGE = 0.24; // and here: closed canopy at FOREST_MAX

/** The raw forest field, roughly [-1, 1]. Exported for the diagnostics tool. */
export function forestField(x, z, seed) {
  const s = (seed ^ 0x0f0125) | 0;
  const base = warpedFbm2(x * FOREST_SCALE, z * FOREST_SCALE, 4, s, 0.75);
  const grain = fbm2(x * FOREST_GRAIN, z * FOREST_GRAIN, 3, (s ^ 0x51de) | 0);
  return base + grain * 0.2;
}

/**
 * Tree density multiplier at a point: 0 on the plains, 1 in ordinary woodland, up to
 * FOREST_MAX in the deep. `smoothstep` clamps at both ends, so the zero is a REAL zero — a
 * plain has no trees at all rather than a few thin ones — and the peak is exactly
 * FOREST_MAX, which is what lets the lattice be sized for it.
 */
export function forestDensity(x, z, seed) {
  const f = forestField(x, z, seed);
  const wood = smoothstep(PLAIN_EDGE, WOOD_EDGE, f);
  const deep = smoothstep(WOOD_EDGE, DEEP_EDGE, f);
  return wood * (1 + (FOREST_MAX - 1) * deep);
}

/* Undergrowth follows the wood but does not vanish with it: a bare plain still carries
 * scrub, and the thicket under a closed canopy is denser than either. Half fixed, half
 * forest, so the mean is preserved and the peak is 0.5 + 0.5 * FOREST_MAX. */
const BUSH_FLOOR = 0.5;
const BUSH_MAX = BUSH_FLOOR + (1 - BUSH_FLOOR) * FOREST_MAX;

/* GROUND COVER. A drift of flowers is tens of metres across, not hundreds — you should be
 * able to drive past one, not through one for a minute. The squared ramp is what makes it a
 * BED rather than a gradient: the middle of a patch is several times the density of its rim,
 * so it reads as a deliberate splash of colour with a soft edge instead of a haze of flowers
 * everywhere. */
const COVER_SCALE = 1 / 175;
const COVER_GRAIN = 1 / 46;
const COVER_MAX = 6;
const COVER_EDGE0 = -0.02;
const COVER_EDGE1 = 0.62;

/**
 * Ground-cover density multiplier, 0..COVER_MAX. Deep forest shade suppresses it: a closed
 * canopy floor is leaf litter, and flowers on it would look like a lit meadow under a roof.
 */
export function coverDensity(x, z, seed) {
  const s = (seed ^ 0x62100d) | 0;
  const base = fbm2(x * COVER_SCALE, z * COVER_SCALE, 3, s);
  const grain = fbm2(x * COVER_GRAIN, z * COVER_GRAIN, 2, (s ^ 0x2f11) | 0);
  const g = smoothstep(COVER_EDGE0, COVER_EDGE1, base + grain * 0.28);
  // Two thirds of the world is between patches, and there the five noise taps above are the
  // whole cost. The forest lookup is another twenty, so it is bought only where it can
  // change the answer — this ordering is most of what keeps the finest lattice in the file
  // affordable.
  if (g <= 0) return 0;
  return g * g * COVER_MAX * (1 - canopyShade(x, z, seed) * 0.7);
}

/**
 * How closed the canopy is overhead, 0 (open sky) .. 1 (deep forest). Everything that grows
 * ON the ground reads this: the flower beds above, and the grass in render/grass.js, which
 * thins and shortens under it. A forest floor is leaf litter, not hay, and a wood with a
 * full meadow sward inside it reads as trees standing on a lawn.
 */
export function canopyShade(x, z, seed) {
  return clamp01((forestDensity(x, z, seed) - 1) / (FOREST_MAX - 1));
}

/* Which patches are actually in flower, and with what. Both fields are deliberately SLOWER
 * than the patch field: a drift is one species in one colour, and the next drift down the
 * road is usually the same one. Randomising colour per plant is the single fastest way to
 * turn a meadow into confetti, and confetti is not cozy. */
const BLOOM_SCALE = 1 / 320;
const SPECIES_SCALE = 1 / 240;

/** Fraction of a patch's plants that carry flowers rather than being leaf. */
export function bloomFraction(x, z, seed) {
  const n = noise2(x * BLOOM_SCALE, z * BLOOM_SCALE, (seed ^ 0x0b100) | 0);
  return smoothstep(-0.34, 0.3, n) * 0.88;
}

/** How many flower species the renderer must have colours for. */
export const FLOWER_SPECIES = 5;

/** Which species is in flower here. Slow, so a whole drift shares one colour. */
export function bloomSpecies(x, z, seed) {
  const n = noise2(x * SPECIES_SCALE, z * SPECIES_SCALE, (seed ^ 0x5bec1e5) | 0) * 0.5 + 0.5;
  const i = (clamp01(n) * FLOWER_SPECIES) | 0;
  return i >= FLOWER_SPECIES ? FLOWER_SPECIES - 1 : i;
}

/* Per-class density multiplier. `null` means the class is uniform inside its biome, which is
 * right for the two that are geology and road furniture rather than vegetation: an empty
 * plain still wants its boulders, or it is not a landscape, it is a lawn.
 * FIELD_MAX is the field's largest possible value, and it is not decoration — it is what the
 * lattice cell is sized against, so a field that could exceed it would saturate the
 * acceptance probability at 1 and turn the densest ground into a visible grid. */
const FIELD = {
  trees: forestDensity,
  bushes: (x, z, seed) => BUSH_FLOOR + (1 - BUSH_FLOOR) * forestDensity(x, z, seed),
  flowers: coverDensity,
  rocks: null,
  reeds: null,
  posts: null,
};
const FIELD_MAX = { trees: FOREST_MAX, bushes: BUSH_MAX, flowers: COVER_MAX, rocks: 1, reeds: 1, posts: 1 };

/* ── the fields are sampled on a lattice, not per candidate ──────────────────
 * `forestDensity` is 817 ns and `coverDensity` 705 ns (tools/bench-flowers.mjs) — they are
 * fbm, and there is no cheap fbm. Paying that per candidate is what the lattice avoids: the
 * flower class alone walks about eleven hundred cells on a 64 m node, and at 705 ns each
 * that was more than the entire rest of the scatter pass — for a field whose finest detail
 * is 23 m across.
 *
 * The step per class is set by the field's own finest octave: the forest grain runs to a
 * 66 m wavelength, ground cover to 23 m. Sampling at half of that and interpolating costs a
 * couple of percent of density error and about a tenth of the time.
 *
 * THE LATTICE IS ANCHORED TO THE WORLD, NOT TO THE NODE. That is not tidiness, it is the
 * exactly-once invariant at the top of this file: the same tree cell is walked by a level-0
 * node when you are near it and a level-2 node when you are far, and if the two interpolated
 * different densities the tree would exist at one LOD and vanish at the other. Multiples of
 * `step` are the same points whoever asks.
 */
const FIELD_STEP = { trees: 32, bushes: 32, flowers: 8 };

function fieldLattice(field, step, seed, ox, oz, size) {
  const i0 = Math.floor(ox / step);
  const j0 = Math.floor(oz / step);
  const nx = Math.floor((ox + size) / step) - i0 + 2;
  const nz = Math.floor((oz + size) / step) - j0 + 2;
  const v = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) v[j * nx + i] = field((i0 + i) * step, (j0 + j) * step, seed);
  }
  return { v, i0, j0, nx, nz, step };
}

/** Bilinear read. Bilinear of values in [0, FIELD_MAX] is in [0, FIELD_MAX], so the
 *  acceptance probability still cannot saturate — which is what the cell size assumes. */
function fieldAt(L, x, z) {
  const fx = x / L.step - L.i0;
  const fz = z / L.step - L.j0;
  let ix = fx | 0;
  let iz = fz | 0;
  if (ix > L.nx - 2) ix = L.nx - 2;
  if (iz > L.nz - 2) iz = L.nz - 2;
  const tx = fx - ix;
  const tz = fz - iz;
  const k = iz * L.nx + ix;
  const a = L.v[k] + (L.v[k + 1] - L.v[k]) * tx;
  const b = L.v[k + L.nx] + (L.v[k + L.nx + 1] - L.v[k + L.nx]) * tx;
  return a + (b - a) * tz;
}

/* ── the ground, for the classes that come in hundreds ───────────────────────
 * `Terrain.height` is 2.9 µs (tools/bench-flowers.mjs) and a site costs THREE of them: one
 * for the ground and two more for the finite-difference slope. At 26 trees a hectare nobody
 * cares. At the heart of a flower bed a 64 m node holds several hundred plants, and 3 µs
 * each is a five-millisecond node — a visible hitch as you drive into the prettiest thing in
 * the world.
 *
 * So flowers read the ground off a lattice: the same globally-anchored bilinear structure as
 * the density fields, filled with heights, giving BOTH the height and the slope (as the
 * gradient of the bilinear patch) for one read. It is built LAZILY, on the first plant that
 * gets as far as needing the ground, because most of the world is between beds and must not
 * pay for one.
 *
 * 12 m is where the two costs cross: 49 samples on a 64 m node, which is what sixteen plants
 * would have cost exactly, and the average node carries about twenty. Measured against exact
 * samples over 24 real nodes it is 2.8 cm out on average, 12 cm at worst off-road and 17 cm
 * across a road grading — on a plant that stands half a metre tall in a third of a metre of
 * grass. The point of it is not the average anyway: it is that the node in the middle of a
 * bed, with three hundred plants on it, costs the same as the node with three.
 */
const GROUND_STEP = { flowers: 12 };

const _gnd = { y: 0, ny: 1 };
function groundAt(L, x, z) {
  const fx = x / L.step - L.i0;
  const fz = z / L.step - L.j0;
  let ix = fx | 0;
  let iz = fz | 0;
  if (ix > L.nx - 2) ix = L.nx - 2;
  if (iz > L.nz - 2) iz = L.nz - 2;
  const tx = fx - ix;
  const tz = fz - iz;
  const k = iz * L.nx + ix;
  const a = L.v[k];
  const b = L.v[k + 1];
  const c = L.v[k + L.nx];
  const d = L.v[k + L.nx + 1];
  _gnd.y = (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  // The exact gradient of the patch the point is standing on — no extra samples, and it
  // agrees with the interpolated surface rather than with some other one.
  const gx = ((b - a) * (1 - tz) + (d - c) * tz) / L.step;
  const gz = ((c - a) * (1 - tx) + (d - b) * tx) / L.step;
  _gnd.ny = 1 / Math.hypot(gx, 1, gz);
  return _gnd;
}

/* Flowers get no column in BIOME_SCATTER and must not get one: that table is biomes.js's,
 * and a flower is not a prop budget — it is a fraction of the sward. So the per-biome flower
 * budget IS the biome's grass multiplier. A biome that grows grass grows flowers; the dunes
 * (0.06) grow neither, and nobody has to keep two tables in step. */
const FLOWER_PEAK = 300;
const SCATTER = BIOME_SCATTER.map((b) => Object.assign({}, b, { flowers: FLOWER_PEAK * b.grass }));

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
  for (let i = 0; i < BIOME_COUNT; i++) peak = Math.max(peak, SCATTER[i][key]);
  // The peak is now the densest BIOME times the densest the FIELD ever gets there, because
  // that combination is what has to fit inside one cell. Sizing the cell off the biome alone
  // would cap a closed canopy at one tree per cell — the acceptance probability would clamp
  // at 1, every cell would be filled, and the deep forest would come out as a plantation.
  peak *= FIELD_MAX[key];
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
  // Flowers sit flat on the ground and are only ever seen from close up, where a plant
  // standing normal to a steep bank reads as leaning out of it. Keep them on ground the eye
  // accepts as level-ish.
  flowers: Math.cos(30 * DEG),
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
  // Flowers stop at the tarmac and not a metre before it: a verge in flower right up to the
  // white line is one of the nicest things you drive past, and it costs nothing to allow.
  flowers: (edge) => edge <= CARRIAGEWAY,
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
  // Damp ground is where the flowers are, so the freeboard is the smallest of the lot —
  // but a daisy floating on a pool is still a bug.
  flowers: (y, wy) => wy === null || y >= wy + 0.25,
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
  const field = FIELD[key] === null ? null : fieldLattice(FIELD[key], FIELD_STEP[key], seed, ox, oz, size);
  const gstep = GROUND_STEP[key] || 0;
  let ground = null; // built on the first site that gets as far as needing the ground
  const g0 = Math.floor(ox / cell);
  const g1 = Math.floor((ox + size - 1e-6) / cell);
  const h0 = Math.floor(oz / cell);
  const h1 = Math.floor((oz + size - 1e-6) / cell);

  for (let gj = h0; gj <= h1; gj++) {
    for (let gi = g0; gi <= g1; gi++) {
      // Empty-cell test BEFORE the PRNG. Hashing a cell and building its stream is a closure
      // allocation, and the flower lattice walks eleven hundred cells on a 64 m node — most
      // of them on ground that carries nothing at all. Every class with a field has a cell
      // smaller than that field's lattice step, so the value at the cell's CENTRE is a fair
      // read of whether anything in the cell can live; the exact value at the jittered point
      // is still what sets the density below. It trims the outermost half-cell of a patch,
      // where the density is a rounding error anyway, and it costs no determinism because it
      // depends only on position.
      if (field !== null && fieldAt(field, (gi + 0.5) * cell, (gj + 0.5) * cell) <= 0) continue;

      const rnd = rng(hash3i(gi, gj, salt, seed));
      const x = (gi + rnd()) * cell;
      const z = (gj + rnd()) * cell;
      // A jittered point never leaves its cell, so testing the box here is what guarantees
      // exactly-once emission across neighbouring nodes and across LOD levels.
      if (x < ox || x >= ox + size || z < oz || z >= oz + size) continue;

      // The density field goes ahead of the climate lookup. On a plain it is exactly zero for
      // trees and on ordinary ground it is zero for flowers, so for the two classes with the
      // finest lattices it throws away most of what is left for one bilinear read.
      const mul = field === null ? 1 : fieldAt(field, x, z);
      if (mul <= 0) continue;

      // Then the biome: one climate-grid lookup plus five multiplies.
      const b = terr.weights(x, z);
      w.set(b.w); // b.w is Terrain's own scratch and is clobbered by the height calls below
      const dominant = b.dominant;
      const density = blendScalar(w, SCATTER, key) * mul;
      if (rnd() >= (density * area * boost) / 1e4) continue;

      // Then the road: one segment sweep over a handful of cached edges, no heights.
      const c = terr.roads.carve(x, z);
      if (!roadOk(c.edge, c.d, c.width)) continue;

      // `g` is the shared scratch out of groundAt and stays valid until the next call —
      // there is none between here and the slope test below.
      let g = null;
      let y;
      if (gstep !== 0) {
        if (ground === null) ground = fieldLattice((gx, gz) => terr.height(gx, gz), gstep, seed, ox, oz, size);
        g = groundAt(ground, x, z);
        y = g.y;
      } else {
        y = terr.height(x, z);
      }
      // -Infinity asks waterLevelAt for the water PLANE here rather than "am I under it";
      // the caller needs the height itself to work out freeboard or wading depth.
      const wy = waterLevelAt(w, -Infinity);
      if (!waterOk(y, wy)) continue;

      // The slope stays AFTER the water test, because for the exact classes it is the two
      // most expensive samples in the loop and reeds reject almost everything on water.
      let ny;
      if (g !== null) {
        ny = g.ny;
      } else {
        // Forward differences rather than Terrain.normal(): two height samples instead of
        // four, and at a 2 m arm it agrees with the mesh normal to well under a degree on
        // anything a tree could stand on anyway.
        const nx = (y - terr.height(x + SLOPE_ARM, z)) / SLOPE_ARM;
        const nz = (y - terr.height(x, z + SLOPE_ARM)) / SLOPE_ARM;
        ny = 1 / Math.hypot(nx, 1, nz);
      }
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
 * @returns {{trees:object[],rocks:object[],bushes:object[],reeds:object[],posts:object[],
 *           flowers:object[]}}
 *          World-space records. `y` is the ground height at the prop's foot; sinking the
 *          root is the renderer's business, because a rock and a tree bury differently.
 *          `flowers` is empty above FLOWER_MAX_LEVEL.
 */
export function scatterChunk({ cx, cz, level, seed }) {
  const out = { trees: [], rocks: [], bushes: [], reeds: [], posts: [], flowers: [] };
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

  // ── flowers and ground cover ───────────────────────────────────────────────
  // One lattice, two things on it. The patch field decides HOW MUCH grows here; the bloom
  // field decides how much of it is in flower. Splitting them that way is what stops a bed
  // being a rash of colour on bare earth: the same drift carries leaf, seed heads and
  // blooms, and its edge fades into plain green cover before it fades out altogether.
  if (level <= FLOWER_MAX_LEVEL) {
    eachSite('flowers', terr, seed, ox, oz, size, w, s, (site, rnd) => {
      const flowering = rnd() < bloomFraction(site.x, site.z, seed);
      const species = bloomSpecies(site.x, site.z, seed);
      // Two flower silhouettes, chosen by species rather than per plant, so a drift is one
      // KIND of flower and not a mixed border. Spires are the minority — a spike of bells
      // standing above the sward is punctuation, and punctuation stops working if it is
      // everywhere.
      const kind = !flowering ? 'tuft' : species >= FLOWER_SPECIES - 1 ? 'spire' : 'daisy';
      out.flowers.push({
        x: site.x,
        y: site.y,
        z: site.z,
        yaw: rnd() * TAU,
        scale: 0.74 + rnd() * 0.52,
        kind,
        species,
        hue: rnd(),
        biome: site.dominant,
      });
    });
  }

  return out;
}

/**
 * Expected prop count for a node, without generating it. The renderer uses this to size its
 * instance buffers before the first chunk arrives, so the first hundred chunks do not each
 * trigger a reallocation.
 *
 * Flowers are deliberately NOT in this figure. It sizes the FLORA batches — trees, bushes —
 * and a flower lattice at 400 plants a hectare would inflate every one of those buffers by
 * an order of magnitude for instances that never land in them. The flower renderer sizes
 * itself from `flowerBudget` instead.
 */
export function scatterBudget(level) {
  if (!(level >= 0) || level > SCATTER_MAX_LEVEL) return 0;
  const area = nodeSize(level) * nodeSize(level);
  let peak = 0;
  for (const key of CLASSES) {
    if (key === 'flowers') continue;
    let m = 0;
    for (let i = 0; i < BIOME_COUNT; i++) m = Math.max(m, SCATTER[i][key]);
    peak += m * FIELD_MAX[key];
  }
  return Math.ceil((peak * area) / 1e4);
}

/**
 * Expected flower count for one level-0 node at the densest the world gets. The renderer
 * allocates one node's worth up front so a drive through a meadow does not reallocate on
 * every chunk; anything past it grows by doubling.
 */
export function flowerBudget() {
  const area = nodeSize(FLOWER_MAX_LEVEL) * nodeSize(FLOWER_MAX_LEVEL);
  let m = 0;
  for (let i = 0; i < BIOME_COUNT; i++) m = Math.max(m, SCATTER[i].flowers);
  return Math.ceil((m * FIELD_MAX.flowers * area) / 1e4);
}
