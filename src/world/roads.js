/* Wanderoad — the infinite road network.
 *
 * There is no road map. There is a lattice, a hash, and a rule.
 *
 * Each lattice cell owns exactly one NODE, placed at a hash-jittered offset inside the
 * cell. A node connects to its +X and +Z neighbour if a hash test passes. Every edge is a
 * cubic Hermite curve, and a node's tangent is the average direction of its own
 * connections — so the curve leaves a junction in the same direction on both sides and the
 * network is C1 continuous everywhere. No kinks at cell borders, no seams, no stored data.
 *
 * Two tiers ride on top of each other:
 *   tier 0  ARTERIAL  1800 m lattice, well connected, wide, gentle — the cruising roads
 *   tier 1  LOCAL      620 m lattice, sparser, narrower, twistier — the ones you find
 *
 * The road's own height is the terrain height sampled ALONG the curve and smoothed. That
 * breaks the circular dependency (terrain needs the road to flatten itself, the road needs
 * the terrain to know its height) without any iteration: the road reads the *raw* land, and
 * the land then bends towards the road.
 */

import { hash2i, clamp01, smoothstep, lerp, segDist } from '../core/math.js';

export const TIERS = [
  { cell: 1800, jitter: 0.34, connect: 0.86, width: 8.6, verge: 5.0, curve: 0.44, samples: 14 },
  { cell: 620, jitter: 0.42, connect: 0.5, width: 6.2, verge: 3.0, curve: 0.62, samples: 10 },
];

const F = 1 / 4294967296;

/** Node world position for lattice cell (i, j) of a tier. Deterministic, no state. */
export function nodePos(i, j, tier, seed, out) {
  const T = TIERS[tier];
  const h = hash2i(i, j, seed ^ (tier === 0 ? 0x517a : 0x2b9d));
  const ox = ((h & 0xffff) * F * 65536 - 0.5) * 2 * T.jitter;
  const oy = (((h >>> 16) & 0xffff) * F * 65536 - 0.5) * 2 * T.jitter;
  out[0] = (i + 0.5 + ox) * T.cell;
  out[1] = (j + 0.5 + oy) * T.cell;
  return out;
}

/** Does cell (i,j) connect east (dir 0) or south (dir 1)? */
export function connects(i, j, dir, tier, seed) {
  const T = TIERS[tier];
  const h = hash2i(i * 2 + dir, j, seed ^ (tier === 0 ? 0x9c41 : 0x4f77));
  return h * F < T.connect;
}

const _p = [0, 0];
const _q = [0, 0];

/**
 * Tangent at a node: the average of the directions to every neighbour it is joined to,
 * scaled by the tier's curviness. Two opposite neighbours give a straight-through tangent;
 * an L-junction gives a diagonal, which is what turns the corner smoothly.
 */
function nodeTangent(i, j, tier, seed, out) {
  const T = TIERS[tier];
  nodePos(i, j, tier, seed, _p);
  let tx = 0,
    tz = 0;
  // east neighbour
  if (connects(i, j, 0, tier, seed)) {
    nodePos(i + 1, j, tier, seed, _q);
    tx += _q[0] - _p[0];
    tz += _q[1] - _p[1];
  }
  // west neighbour (its own east link)
  if (connects(i - 1, j, 0, tier, seed)) {
    nodePos(i - 1, j, tier, seed, _q);
    tx += _p[0] - _q[0];
    tz += _p[1] - _q[1];
  }
  // south neighbour
  if (connects(i, j, 1, tier, seed)) {
    nodePos(i, j + 1, tier, seed, _q);
    tx += _q[0] - _p[0];
    tz += _q[1] - _p[1];
  }
  // north neighbour
  if (connects(i, j - 1, 1, tier, seed)) {
    nodePos(i, j - 1, tier, seed, _q);
    tx += _p[0] - _q[0];
    tz += _p[1] - _q[1];
  }
  const l = Math.hypot(tx, tz);
  if (l < 1e-5) {
    out[0] = T.cell;
    out[1] = 0;
  } else {
    const s = (T.cell * T.curve * 2) / l;
    out[0] = tx * s;
    out[1] = tz * s;
  }
  return out;
}

const _t0 = [0, 0];
const _t1 = [0, 0];

function hermite2(p0x, p0z, m0x, m0z, p1x, p1z, m1x, m1z, t, out) {
  const t2 = t * t,
    t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  out[0] = h00 * p0x + h10 * m0x + h01 * p1x + h11 * m1x;
  out[1] = h00 * p0z + h10 * m0z + h01 * p1z + h11 * m1z;
  return out;
}

/**
 * A single edge, sampled into a polyline. `pts` is [x0,z0,x1,z1,...]; `y` is filled later
 * by the caller from the raw land height, then smoothed.
 */
function buildEdge(i, j, dir, tier, seed) {
  const T = TIERS[tier];
  const i1 = dir === 0 ? i + 1 : i;
  const j1 = dir === 0 ? j : j + 1;
  const p0 = nodePos(i, j, tier, seed, [0, 0]);
  const p1 = nodePos(i1, j1, tier, seed, [0, 0]);
  nodeTangent(i, j, tier, seed, _t0);
  nodeTangent(i1, j1, tier, seed, _t1);
  const n = T.samples;
  const pts = new Float32Array((n + 1) * 2);
  const tmp = [0, 0];
  for (let k = 0; k <= n; k++) {
    hermite2(p0[0], p0[1], _t0[0], _t0[1], p1[0], p1[1], _t1[0], _t1[1], k / n, tmp);
    pts[k * 2] = tmp[0];
    pts[k * 2 + 1] = tmp[1];
  }
  // A per-edge width wobble so no two roads are identical, and a per-edge surface roll
  // that biomes can override.
  const h = hash2i(i * 3 + dir, j * 7, seed ^ 0x77c1);
  const wj = 1 + ((h & 0xff) / 255 - 0.5) * 0.22;
  return {
    tier,
    pts,
    y: new Float32Array(n + 1),
    width: T.width * wj,
    verge: T.verge,
    key: `${tier}:${i},${j},${dir}`,
    // axis-aligned bounds, filled below
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
  };
}

function bounds(e) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let k = 0; k < e.pts.length; k += 2) {
    const x = e.pts[k],
      z = e.pts[k + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  e.minX = minX;
  e.maxX = maxX;
  e.minZ = minZ;
  e.maxZ = maxZ;
}

/**
 * Every edge whose curve could come within `pad` metres of the axis-aligned box
 * [x0,x1]×[z0,z1]. Deterministic and order-stable, so two clients build identical lists.
 */
export function edgesInBox(x0, z0, x1, z1, seed, pad = 40) {
  const out = [];
  for (let tier = 0; tier < TIERS.length; tier++) {
    const T = TIERS[tier];
    // A hermite segment can bulge outside its two cells by roughly the tangent length.
    const reach = T.cell * (0.5 + T.curve) + pad;
    const i0 = Math.floor((x0 - reach) / T.cell);
    const i1 = Math.floor((x1 + reach) / T.cell);
    const j0 = Math.floor((z0 - reach) / T.cell);
    const j1 = Math.floor((z1 + reach) / T.cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (let dir = 0; dir < 2; dir++) {
          if (!connects(i, j, dir, tier, seed)) continue;
          const e = buildEdge(i, j, dir, tier, seed);
          bounds(e);
          const m = e.width * 0.5 + e.verge + pad;
          if (e.maxX < x0 - m || e.minX > x1 + m || e.maxZ < z0 - m || e.minZ > z1 + m) continue;
          out.push(e);
        }
      }
    }
  }
  return out;
}

const _seg = { d: 0, t: 0, x: 0, z: 0 };

/** Deepest fill or cutting a road is allowed to ask the land for, in metres. */
const MAX_EARTHWORK = 18;

/**
 * Give an edge its elevation profile. Shared by the collision/carve field and by the visible
 * ribbon so the two can never disagree about where the road is.
 *
 * Three passes, in order, and the order matters:
 *   1. sample the raw land under the curve
 *   2. smooth it, so the gradient is one a car can climb
 *   3. clamp how far the smoothed line may stray from the land, and lift it clear of water
 *
 * Step 3 is what stops the cliffs and the drowned roads. Without the clamp, a smoothed line
 * across a valley sits forty metres above the ground and the embankment that connects them
 * is a wall no batter can soften. Without the water lift, the smoothed line follows the land
 * straight down into a lake, and the player drives underwater — both were reported from the
 * first live build.
 */
export function profileEdge(e, landHeight, waterAt = null) {
  const n = e.y.length;
  const land = new Float32Array(n);
  for (let k = 0; k < n; k++) land[k] = landHeight(e.pts[k * 2], e.pts[k * 2 + 1]);
  e.y.set(land);

  // Arterials are graded harder than lanes: a trunk road is engineered, a back lane follows
  // the ground.
  const passes = e.tier === 0 ? 6 : 3;
  const tmp = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < n; k++) {
      const a = e.y[Math.max(0, k - 1)];
      const b = e.y[k];
      const c = e.y[Math.min(n - 1, k + 1)];
      tmp[k] = a * 0.25 + b * 0.5 + c * 0.25;
    }
    e.y.set(tmp);
  }

  for (let k = 0; k < n; k++) {
    const d = e.y[k] - land[k];
    if (d > MAX_EARTHWORK) e.y[k] = land[k] + MAX_EARTHWORK;
    else if (d < -MAX_EARTHWORK) e.y[k] = land[k] - MAX_EARTHWORK;
    if (waterAt) {
      const w = waterAt(e.pts[k * 2], e.pts[k * 2 + 1]);
      // A causeway, not a ford. 1.1 m of freeboard reads as a raised road rather than a
      // road that happens to be dry.
      if (w !== null && e.y[k] < w + 1.1) e.y[k] = w + 1.1;
    }
  }

  // Clamping breaks the smoothness it was applied to, so smooth once more — gently. Then
  // re-apply the floors, because a smoothing pass averages a raised point back down towards
  // its drowned neighbours and quietly puts the road under the water again. Floors last.
  for (let k = 1; k < n - 1; k++) tmp[k] = e.y[k - 1] * 0.2 + e.y[k] * 0.6 + e.y[k + 1] * 0.2;
  tmp[0] = e.y[0];
  tmp[n - 1] = e.y[n - 1];
  e.y.set(tmp);
  if (waterAt) {
    for (let k = 0; k < n; k++) {
      const w = waterAt(e.pts[k * 2], e.pts[k * 2 + 1]);
      if (w !== null && e.y[k] < w + 1.1) e.y[k] = w + 1.1;
    }
    // One more smooth of the SHAPE only, clamped so it can never dip below the floor again.
    for (let k = 1; k < n - 1; k++) {
      const avg = e.y[k - 1] * 0.25 + e.y[k] * 0.5 + e.y[k + 1] * 0.25;
      const w = waterAt(e.pts[k * 2], e.pts[k * 2 + 1]);
      tmp[k] = w !== null ? Math.max(avg, w + 1.1) : avg;
    }
    tmp[0] = e.y[0];
    tmp[n - 1] = e.y[n - 1];
    e.y.set(tmp);
  }
  return e;
}

/**
 * A prebuilt road field for one region. Build it once per chunk (or once per physics
 * frame for the car) and query it thousands of times; the edge list is tiny.
 */
export class RoadField {
  /**
   * @param {number} x0,z0,x1,z1 world-space box this field covers
   * @param {number} seed world seed
   * @param {(x:number,z:number)=>number} landHeight raw land height, WITHOUT road carving
   */
  constructor(x0, z0, x1, z1, seed, landHeight, pad = 60, waterAt = null) {
    this.edges = edgesInBox(x0, z0, x1, z1, seed, pad);
    this.seed = seed;
    this._land = landHeight;
    for (const e of this.edges) profileEdge(e, landHeight, waterAt);
    levelCrossings(this.edges);
    /* Levelling can pull a lane down to meet a road that crosses it lower, and a lane that
     * crosses water can end up a few centimetres under it. Re-apply the water floor last:
     * every other constraint has a tolerance, and "the road is under the lake" does not. */
    if (waterAt) {
      for (const e of this.edges) {
        for (let k = 0; k < e.y.length; k++) {
          const w = waterAt(e.pts[k * 2], e.pts[k * 2 + 1]);
          if (w !== null && e.y[k] < w + 1.1) e.y[k] = w + 1.1;
        }
      }
    }
  }

  /**
   * Nearest road at (x, z).
   * Returns { d, y, width, tier, tx, tz, edge } where `d` is metres to the centreline,
   * `y` the road surface height there and (tx,tz) the unit tangent (driving direction).
   * `d` is Infinity when no road is in range.
   */
  query(x, z) {
    let bd = Infinity;
    let by = 0,
      bw = 0,
      bt = 0,
      btx = 1,
      btz = 0,
      bqx = 0,
      bqz = 0,
      be = null;
    for (const e of this.edges) {
      const m = e.width * 0.5 + e.verge + 30;
      if (x < e.minX - m || x > e.maxX + m || z < e.minZ - m || z > e.maxZ + m) continue;
      const pts = e.pts;
      const n = pts.length / 2 - 1;
      for (let k = 0; k < n; k++) {
        const ax = pts[k * 2],
          az = pts[k * 2 + 1];
        const bx = pts[k * 2 + 2],
          bz = pts[k * 2 + 3];
        const r = segDist(x, z, ax, az, bx, bz);
        if (r.d < bd) {
          bd = r.d;
          by = lerp(e.y[k], e.y[k + 1], r.t);
          bw = e.width;
          bt = e.tier;
          const dx = bx - ax,
            dz = bz - az;
          const l = Math.hypot(dx, dz) || 1;
          btx = dx / l;
          btz = dz / l;
          bqx = r.x;
          bqz = r.z;
          be = e;
        }
      }
    }
    _seg.d = bd;
    // qx/qz are the closest point ON the centreline. A steering controller needs the point,
    // not just the distance, or it cannot tell which side of the road it is on.
    return { d: bd, y: by, width: bw, tier: bt, tx: btx, tz: btz, qx: bqx, qz: bqz, edge: be };
  }

  /**
   * The carve field at a point, blended over EVERY nearby road rather than snapped to the
   * nearest one.
   *
   * This used to take the single closest edge and bend the land towards it. That is fine
   * until two roads pass near each other at different elevations — and then the "closest
   * edge" flips from one to the other between neighbouring vertices, the carve target jumps
   * by twenty metres, and the terrain grows an 80° wall. Every cliff in the first playable
   * build came from this, and so did the Z-shaped kink where the road appeared to break and
   * jump sideways: measured over a 2.4 km square, the raw land had ZERO slopes above 45° and
   * the carved land had 1296 of them, all within 12 m of a road.
   *
   * So: accumulate. Each edge contributes a weight that falls off across its own shoulder,
   * the target height is the weighted mean, and the mask is the combined coverage. Two roads
   * near each other now produce a smooth saddle between them instead of a step.
   */
  carve(x, z, out = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0 }) {
    let wSum = 0;
    let ySum = 0;
    let cover = 0;
    let bestEdge = 0;
    let bd = Infinity;
    let bw = 0,
      bt = 0,
      btx = 1,
      btz = 0;

    for (const e of this.edges) {
      const half = e.width * 0.5;
      // The widest this edge could possibly reach: its shoulder grows with how far the road
      // sits above or below the land, and 60 m covers the tallest embankment the smoothing
      // can produce.
      const reach = half + e.verge * 2.6 + 60;
      if (x < e.minX - reach || x > e.maxX + reach || z < e.minZ - reach || z > e.maxZ + reach) continue;

      const pts = e.pts;
      const n = pts.length / 2 - 1;
      let ed = Infinity;
      let ey = 0;
      let etx = 1,
        etz = 0;
      for (let k = 0; k < n; k++) {
        const ax = pts[k * 2],
          az = pts[k * 2 + 1];
        const bx = pts[k * 2 + 2],
          bz = pts[k * 2 + 3];
        const r = segDist(x, z, ax, az, bx, bz);
        if (r.d < ed) {
          ed = r.d;
          ey = lerp(e.y[k], e.y[k + 1], r.t);
          const dx = bx - ax,
            dz = bz - az;
          const l = Math.hypot(dx, dz) || 1;
          etx = dx / l;
          etz = dz / l;
        }
      }
      if (ed > reach) continue;

      // Shoulder width scales with the height difference this edge is asking for, so an
      // embankment is battered at about 1:1.5 and never becomes a wall.
      const drop = Math.abs(ey - this._land(x, z));
      const shoulder = half + 3.0 + Math.min(drop, MAX_EARTHWORK + 4) * 1.6;
      const w = 1 - smoothstep(half, shoulder, ed);
      if (w <= 0.0005) continue;

      wSum += w;
      ySum += w * ey;
      cover = Math.max(cover, w);
      if (ed < bd) {
        bd = ed;
        bw = e.width;
        bt = e.tier;
        btx = etx;
        btz = etz;
        bestEdge = 1 - smoothstep(half - 0.4, half + 0.35, ed);
      }
    }

    out.d = bd;
    out.tier = bt;
    out.tx = btx;
    out.tz = btz;
    out.width = bw;
    out.mask = cover;
    out.edge = bestEdge;
    out.y = wSum > 1e-6 ? ySum / wSum : 0;
    return out;
  }
}

/**
 * Make every road that crosses another meet it at the same height.
 *
 * The two tiers are independent lattices, so a lane and an arterial cross wherever they
 * happen to and each arrives at its own smoothed elevation. Measured over a 2.4 km square,
 * 3 of 10 crossings were more than a metre apart, worst 1.52 m — which is a lane passing
 * visibly over or under a road, and is what the player falls through when the carve leaves a
 * gap between them.
 *
 * Real junctions are levelled by the more important road, so: the ARTERIAL keeps its height
 * and the lane is pulled to match, with the correction feathered out along the lane so it
 * arrives level rather than stepping. No new geometry, no junction graph — the roads simply
 * agree about where they are.
 */
function levelCrossings(edges) {
  /* Two passes with the same machinery. First every lane is levelled against the arterials,
   * then every lane against the lanes that outrank it. "Outranks" is just a stable sort on the
   * edge key: it is arbitrary, but it is CONSISTENT, which is what stops A pulling B while B
   * pulls A and the pair oscillating. Levelling only against arterials left 2 of 10 crossings
   * out, all of them lane-on-lane. */
  const sorted = [...edges].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const arterials = sorted.filter((e) => e.tier === 0);
  const lanes = sorted.filter((e) => e.tier !== 0);
  if (!lanes.length) return;

  levelAgainst(lanes, arterials);
  // Each lane now yields to every lane ahead of it in the stable order.
  for (let i = 1; i < lanes.length; i++) levelAgainst([lanes[i]], lanes.slice(0, i));
}

function levelAgainst(lanes, arterials) {
  if (!arterials.length) return;

  for (const lane of lanes) {
    const n = lane.y.length;
    // Pass 1: find every point of this lane that sits on an arterial, and by how much it is
    // out. Feathering happens in pass 2 so one crossing cannot undo another.
    const fix = new Float32Array(n);
    const weight = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = lane.pts[k * 2];
      const z = lane.pts[k * 2 + 1];
      let bestD = Infinity;
      let bestY = 0;
      for (const a of arterials) {
        const reach = a.width * 0.5 + 14;
        if (x < a.minX - reach || x > a.maxX + reach || z < a.minZ - reach || z > a.maxZ + reach) continue;
        const m = a.pts.length / 2 - 1;
        for (let i = 0; i < m; i++) {
          const r = segDist(x, z, a.pts[i * 2], a.pts[i * 2 + 1], a.pts[i * 2 + 2], a.pts[i * 2 + 3]);
          if (r.d < bestD) {
            bestD = r.d;
            bestY = lerp(a.y[i], a.y[i + 1], r.t);
          }
        }
      }
      if (bestD < 18) {
        // Full authority on the carriageway, easing off across the shoulder.
        const w = 1 - smoothstep(4, 18, bestD);
        fix[k] = bestY - lane.y[k];
        weight[k] = w;
      }
    }

    // Pass 2: apply, then feather the correction into the neighbouring points so the lane
    // ramps up to the junction instead of stepping at it.
    const delta = new Float32Array(n);
    for (let k = 0; k < n; k++) delta[k] = fix[k] * weight[k];
    const smooth = new Float32Array(n);
    for (let pass = 0; pass < 3; pass++) {
      for (let k = 0; k < n; k++) {
        const a = delta[Math.max(0, k - 1)];
        const b = delta[k];
        const c = delta[Math.min(n - 1, k + 1)];
        // Never smooth AWAY a correction at a crossing — the junction itself must stay exact.
        smooth[k] = weight[k] > 0.75 ? b : a * 0.3 + b * 0.4 + c * 0.3;
      }
      delta.set(smooth);
    }
    for (let k = 0; k < n; k++) lane.y[k] += delta[k];
  }
}

/**
 * A cheap standalone distance query for when a whole RoadField is overkill — used by
 * scatter rejection and by the minimap. Builds a tiny local field each call, so do not
 * put it in a per-vertex loop.
 */
export function roadDistance(x, z, seed, landHeight) {
  const f = new RoadField(x - 80, z - 80, x + 80, z + 80, seed, landHeight, 20);
  return f.query(x, z);
}
