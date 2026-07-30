/* Wanderoad — loot: gold suns along the road, diamonds on open water.
 *
 * Two placement functions, no three.js and no DOM, in the same spirit as world/props.js:
 * everything here is a pure function of (x, z, seed) so the client and the server (if this
 * ever grows one) can never disagree about where a sun sits, and so a tile that leaves the
 * rolling window and comes back hands out the SAME suns rather than inventing new ones.
 *
 * SUNS follow the exact idiom world/props.js's `fuelCansInBox` already established: walk
 * every road edge in the box by arc length, slot every SUN_SLOT metres, accept a slot with a
 * plain hash before a PRNG stream is ever built (nineteen slots in twenty die on that one
 * cheap test — see props.js's own comment on why that ordering matters). The one real
 * difference from a fuel can is that a sun is common enough to be the game's everyday
 * currency, so ONE accepted slot buys a small CLUSTER of suns rather than a single pickup —
 * a scatter of suns along the tarmac reads as "money on this stretch of road" at a glance,
 * where one sun every 150 m would just look like debris.
 *
 * A sun needs nothing but the road's OWN elevation — it stands right on the centreline, not
 * off in the verge where a footprint or a slope could matter — so this never builds a Terrain
 * or asks a caller for a ground probe the way propsInBox/fuelCansInBox do. `edgeProfile()`
 * (world/roads.js), the same call stationForEdge makes, is enough, and it is memoised per edge
 * so walking the same road twice in one session costs nothing the second time.
 *
 * GEMS reuse render/ships.js's own lattice idiom and gate order exactly (real depth, then the
 * large-open-water proxy, then road clearance, then a rarity draw — cheapest and most
 * discriminating rejections first, ships.js's own comment explains why): one jittered
 * candidate per GEM_TILE cell, and a gem only ever sits on genuinely large, genuinely open
 * water, far from any road. Diamonds are a boat's reward, so nothing here places one anywhere
 * a car could ever reach without one.
 *
 * DEVIATION from the usual world/ <- render/ direction: `waterOpenness()` is owned by
 * render/water.js (it also drives that shader's own calm/foam terms), and this file imports it
 * rather than duplicating the flood-proxy math a second time — the same "one source of truth"
 * reasoning that already governs the seed, the road network and everything else two systems
 * both need to agree on. See docs/BOAT-PLAN.md's own deviations log.
 */

import { edgesInBox, edgeProfile, roadDistance } from './roads.js';
import { landFn, waterFn, landHeight } from './terrain.js';
import { biomeWeights, waterLevelAt, BIOME_COUNT } from './biomes.js';
import { waterOpenness } from '../render/water.js';
import { hash3i, rng, clamp01 } from '../core/math.js';

/** uint32 -> [0,1). Same constant every other placement hash in this project uses. */
const F32 = 1 / 4294967296;

/* ── the road walk — copied from world/props.js's fuelCansInBox idiom ─────────
 * Not shared with that file: neither props.js nor this one exports its arc-walk helpers, so
 * every placement domain in this project that needs one keeps its own small copy rather than
 * introduce a shared module for three ten-line functions. See the file header's own note.
 */

/** `e.key` is `${tier}:${i},${j},${dir}` — see roads.js buildEdge. */
const KEY_RE = /^(\d+):(-?\d+),(-?\d+),(\d+)$/;
function edgeIds(e) {
  const m = KEY_RE.exec(e.key);
  if (!m) {
    console.error('[loot] road edge key format changed:', e.key);
    return { tier: 0, i: 0, j: 0, dir: 0 };
  }
  return { tier: +m[1], i: +m[2], j: +m[3], dir: +m[4] };
}

/** Cumulative arc length along an edge's polyline. */
function arcTable(e) {
  const n = e.pts.length / 2;
  const cum = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    const dx = e.pts[k * 2] - e.pts[k * 2 - 2];
    const dz = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
    cum[k] = cum[k - 1] + Math.hypot(dx, dz);
  }
  return cum;
}

/** Point, unit tangent and segment index at arc length `s` along an edge. */
function atArc(e, cum, s, out) {
  const n = cum.length;
  let k = 1;
  while (k < n - 1 && cum[k] < s) k++;
  const s0 = cum[k - 1];
  const seg = cum[k] - s0 || 1;
  const t = clamp01((s - s0) / seg);
  const ax = e.pts[k * 2 - 2], az = e.pts[k * 2 - 1];
  const bx = e.pts[k * 2], bz = e.pts[k * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  const l = Math.hypot(bx - ax, bz - az) || 1;
  out.tx = (bx - ax) / l;
  out.tz = (bz - az) / l;
  out.k = k;
  out.t = t;
  return out;
}

/* ── suns ────────────────────────────────────────────────────────────────── */

const SALT_SUN = 0x434f4931; // 'COI1'

/** Candidate slot every this many metres of road arc. */
/* One sun per kilometre of road, not twenty-six. Operator: "Suns -- 1 per km max".
 * Expected suns per metre = (P / SLOT) * mean(cluster). At 64 m / 0.42 / 3-5 that was
 * 0.026/m = 26 per km. At 620 m / 0.62 / 1 it is 0.0010/m = ~1.0 per km. */
export const SUN_SLOT = 620;
/** Accept probability per slot — a single scalar, not tiered like the props/cans arrays,
 *  because suns are meant to be everyday and equally likely on a lane or an arterial. */
export const SUN_SLOT_P = 0.62;
/** Metres above the road surface a sun's origin sits at — render/loot.js blits the geometry
 *  at this height above the ground-contact point, the same "hover is a fixed constant, not
 *  part of placement" rule world/props.js's floating can uses. */
export const SUN_HOVER = 0.6;
/** A cluster is this many suns, inclusive. */
export const SUN_CLUSTER_MIN = 1;
export const SUN_CLUSTER_MAX = 1;
/** Metres between suns in a cluster, measured along the road's own tangent. */
export const SUN_SPACING = 7;
/** How far a sun may wander off the centreline, as a fraction of the carriageway's own half
 *  width — small, because a sun belongs ON the road, not beside it (that is the fuel can's
 *  job). */
export const SUN_LATERAL_JITTER = 0.2;
/** Query-box expansion. Generous over the small lateral jitter above, so a sun whose slot
 *  sits just outside the box but whose position lands inside it is never missed. */
const SUN_MAX_OFFSET = 20;

let _land = null;
let _water = null;
let _fnSeed = null;
/** Cached per seed, exactly like world/props.js's own `pureFns` — landFn/waterFn build a
 *  closure and this is called once per accepted road edge. */
function pureFns(seed) {
  if (_fnSeed !== seed) {
    _fnSeed = seed;
    _land = landFn(seed);
    _water = waterFn(seed);
  }
  return { land: _land, water: _water };
}

/**
 * Every sun whose position lands inside the box.
 *
 * @param {number} x0,z0,x1,z1 world box
 * @param {number} seed
 * @returns {Array<{x:number, z:number, y:number, id:string}>}
 */
export function sunsInBox(x0, z0, x1, z1, seed) {
  const out = [];
  const edges = edgesInBox(x0 - SUN_MAX_OFFSET, z0 - SUN_MAX_OFFSET, x1 + SUN_MAX_OFFSET, z1 + SUN_MAX_OFFSET, seed, 20);
  const { land, water } = pureFns(seed);
  const at = { x: 0, z: 0, tx: 1, tz: 0, k: 0, t: 0 };

  for (const e of edges) {
    const ids = edgeIds(e);
    const cum = arcTable(e);
    const total = cum[cum.length - 1];
    const slots = Math.floor(total / SUN_SLOT);
    if (slots < 1) continue;
    const key0 = ids.i * 4 + ids.dir * 2 + ids.tier;
    const half = e.width * 0.5;
    // The road's own elevation, ONCE per edge (not per slot) — memoised inside edgeProfile
    // itself, the same call stationForEdge (world/props.js) makes for the identical reason.
    edgeProfile(e, seed, land, water);

    for (let s = 0; s < slots; s++) {
      // Acceptance from a plain hash before any PRNG stream exists — see fuelCansInBox's own
      // comment in world/props.js for why this ordering is the one that keeps the cost down.
      if (hash3i(key0, ids.j, s, seed ^ SALT_SUN) * F32 >= SUN_SLOT_P) continue;
      const rnd = rng(hash3i(key0, ids.j, s, seed ^ SALT_SUN ^ 0x1c2b3a4d));
      const n = SUN_CLUSTER_MIN + Math.floor(rnd() * (SUN_CLUSTER_MAX - SUN_CLUSTER_MIN + 1));
      // Jitter the cluster's start within the slot, leaving room for its own spread so the
      // whole cluster stays inside the slot it was drawn from rather than spilling far into
      // the next one.
      const s0 = (s + 0.1 + rnd() * 0.25) * SUN_SLOT;

      for (let ci = 0; ci < n; ci++) {
        const sArc = s0 + ci * SUN_SPACING;
        if (sArc >= total) break;
        atArc(e, cum, sArc, at);
        if (at.x < x0 - SUN_MAX_OFFSET || at.x > x1 + SUN_MAX_OFFSET) continue;

        // A small lateral jitter off the centreline, never off the carriageway — half the
        // road's own width times SUN_LATERAL_JITTER, the same right-hand normal convention
        // propsInBox and render/road.js both use: (rx, rz) = (tz, -tx).
        const lat = (rnd() - 0.5) * 2 * half * SUN_LATERAL_JITTER;
        const x = at.x + at.tz * lat;
        const z = at.z - at.tx * lat;
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;

        const roadY = e.y[at.k - 1] + (e.y[at.k] - e.y[at.k - 1]) * at.t;
        out.push({ x, z, y: roadY + SUN_HOVER, id: `co:${e.key}:${s}:${ci}` });
      }
    }
  }
  return out;
}

/* ── gems ─────────────────────────────────────────────────────────────────── */

const SALT_GEM = 0x47454d31; // 'GEM1'

/** Candidate lattice spacing, metres — same idea as render/ships.js's own TILE, one jittered
 *  candidate per cell. */
export const GEM_TILE = 260;
/** Real depth, metres, the candidate point must clear. */
export const GEM_MIN_DEPTH = 1.2;
/** waterOpenness() floor — same large-open-water gate render/ships.js's boats use, a touch
 *  above render/water.js's own OPEN_LO for the same margin-of-safety reason that file states. */
export const GEM_OPEN_MIN = 0.55;
/** Minimum distance from any road centreline, metres. */
export const GEM_ROAD_CLEAR = 50;
/** Rarity draw applied to a site that has already passed every placement test. */
export const GEM_ACCEPT_P = 0.5;
/** Metres above the water surface a gem's origin sits at. */
export const GEM_HOVER = 0.9;

const _wGem = new Float32Array(BIOME_COUNT);
/** Metres of dry ground above the local water table at (x, z); negative means underwater.
 *  Same shape as render/ships.js's own freeboardAt — duplicated rather than imported because
 *  that one is a private, unexported helper there. */
function freeboardAt(x, z, seed) {
  const b = biomeWeights(x, z, seed, _wGem);
  const plane = waterLevelAt(b.w, -Infinity);
  return plane === null ? 1e9 : landHeight(x, z, seed) - plane;
}
/** The water surface height at (x, z) — always a number here, since gemsForTile only ever
 *  calls this once freeboardAt() has already confirmed the point is wet. */
function waterPlaneAt(x, z, seed) {
  const b = biomeWeights(x, z, seed, _wGem);
  return waterLevelAt(b.w, -Infinity);
}

/**
 * Evaluate one gem-lattice cell. Returns a placement spec or null. Gate order is cheapest and
 * most discriminating first — see render/ships.js's own comment for why: most of any tile is
 * dry land, so the depth test alone throws most candidates away before the more expensive
 * openness and road-distance tests are ever paid for.
 *
 * @param {number} gi,gj lattice cell indices
 * @param {number} seed
 * @returns {{x:number, z:number, y:number, id:string} | null}
 */
export function gemsForTile(gi, gj, seed) {
  const r = rng(hash3i(gi, gj, 0x67656d31, seed ^ SALT_GEM));
  const x = (gi + r()) * GEM_TILE;
  const z = (gj + r()) * GEM_TILE;

  // 1. real depth, cheapest and most discriminating — most of any tile is dry land.
  const fb = freeboardAt(x, z, seed);
  if (fb >= -GEM_MIN_DEPTH) return null;

  // 2. large-body gate — the same proxy render/water.js's shader and render/ships.js's boats
  // both already agree on, so a gem never sits somewhere that reads as a puddle.
  if (waterOpenness(x, z, seed) < GEM_OPEN_MIN) return null;

  // 3. road clearance, the most expensive single test, so it runs last among the hard gates.
  const rd = roadDistance(x, z, seed, landFn(seed));
  if (rd.d < GEM_ROAD_CLEAR) return null;

  // 4. rarity draw, only ever paid for by a site that already cleared everything above.
  if (r() >= GEM_ACCEPT_P) return null;

  const y = waterPlaneAt(x, z, seed);
  return { x, z, y: y + GEM_HOVER, id: `gm:${gi},${gj}` };
}
