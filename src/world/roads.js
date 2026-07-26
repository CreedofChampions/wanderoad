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
  constructor(x0, z0, x1, z1, seed, landHeight, pad = 60) {
    this.edges = edgesInBox(x0, z0, x1, z1, seed, pad);
    this.seed = seed;
    // Give every edge its elevation profile: the raw land under the curve, then a
    // three-pass box smooth so the road climbs at a gradient a car can actually take.
    for (const e of this.edges) {
      const n = e.y.length;
      for (let k = 0; k < n; k++) e.y[k] = landHeight(e.pts[k * 2], e.pts[k * 2 + 1]);
      // Arterials get more smoothing passes than lanes: a trunk road is graded, a back
      // lane follows the land. Five passes on a 1.8 km span pulls the steepest gradients
      // down from ~15% to something a car can climb without dropping two gears, and the
      // difference between the smoothed line and the raw land becomes the cutting or
      // embankment that terrain.js then carves.
      const passes = e.tier === 0 ? 6 : 3;
      const tmp = new Float32Array(n);
      for (let pass = 0; pass < passes; pass++) {
        for (let k = 0; k < n; k++) {
          const a = e.y[Math.max(0, k - 1)];
          const b = e.y[k];
          const c = e.y[Math.min(n - 1, k + 1)];
          tmp[k] = a * 0.25 + b * 0.5 + c * 0.25;
        }
        e.y.set(tmp);
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
   * The carve mask at a point: 1 on the road crown, falling to 0 at the far edge of the
   * verge. Terrain multiplies its own relief down by this and adds the road height, which
   * is what cuts a shelf into a hillside and raises a causeway over a marsh.
   */
  carve(x, z, out = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0 }) {
    const q = this.query(x, z);
    out.d = q.d;
    out.y = q.y;
    out.tier = q.tier;
    out.tx = q.tx;
    out.tz = q.tz;
    out.width = q.width;
    if (!isFinite(q.d)) {
      out.mask = 0;
      out.edge = 0;
      return out;
    }
    const half = q.width * 0.5;
    const verge = TIERS[q.tier].verge;
    // Fully flat across the carriageway, then a shoulder that eases back into the land.
    out.mask = 1 - smoothstep(half, half + verge * 2.6, q.d);
    // 'edge' is 1 exactly on the carriageway — used for the tarmac texture and for grip.
    out.edge = 1 - smoothstep(half - 0.4, half + 0.35, q.d);
    return out;
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
