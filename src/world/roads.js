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
 * That much is the SKELETON, and on its own it draws straight lines between nodes: 100 degrees
 * of turn per kilometre, where a road with real bends turns more than 200. The bends come from
 * a lateral offset laid over each edge, built from a curvature profile rather than from an
 * amplitude — see "the winding" below, which is where most of the thinking in this file is.
 *
 * Two tiers ride on top of each other:
 *   tier 0  ARTERIAL  1800 m lattice, well connected, wide, sweeping — the cruising roads
 *   tier 1  LOCAL      620 m lattice, sparser, narrower, twistier — the ones you find
 *
 * The road's own height is the terrain height sampled ALONG the curve and smoothed. That
 * breaks the circular dependency (terrain needs the road to flatten itself, the road needs
 * the terrain to know its height) without any iteration: the road reads the *raw* land, and
 * the land then bends towards the road.
 */

import { hash2i, clamp, clamp01, smoothstep, lerp, segDist, TAU } from '../core/math.js';

/*
 * cell     lattice spacing, metres
 * jitter   how far a node may sit from its cell centre, as a fraction of the cell
 * connect  probability a link exists
 * curve    tangent length at a node, as a fraction of HALF the edge's own chord
 * step     target metres between polyline samples — the road's resolution
 * bend     target metres per bend; sets how many bends an edge is cut into
 * radius   the TIGHTEST radius a bend on this tier may reach, metres
 * swing    how far the winding may stray sideways, as a fraction of the edge's chord
 * grade    smoothing length of the height profile, metres. Independent of `step` on purpose:
 *          sampling finer must not make the road follow every bump in the ground.
 */
export const TIERS = [
  {
    cell: 1800, jitter: 0.34, connect: 0.86, width: 8.6, verge: 5.0,
    curve: 0.44, step: 38, bend: 220, radius: 122, swing: 0.10, grade: 222,
  },
  {
    cell: 620, jitter: 0.42, connect: 0.5, width: 6.2, verge: 3.0,
    curve: 0.62, step: 19, bend: 140, radius: 103, swing: 0.11, grade: 76,
  },
];

/** Harmonics in the curvature shape. Three is enough for an S-bend and a sweeper. */
const HARMONICS = 3;

/**
 * The tightest the BASE hermite between two nodes is allowed to turn, metres of radius.
 *
 * Where the winding's floor is a design choice, this one is a safety net: a node's tangent is
 * shared by every edge at it, so at a junction where one leg leaves at a wide angle to that
 * shared tangent the hermite has to whip round to reach its far node, and the jitter can make
 * that leg short as well. Measured over a 12 km square the network turned inside a 6 m radius
 * in a couple of places, which on screen is a lane tying a knot in itself.
 */
const BASE_MIN_RADIUS = 130;

/* Why `radius` is where it is, and why it must not go much lower: the autopilot brakes for the
 * bend ahead and reaches its floor of 8 m/s at about 0.55 rad of heading change per 42 m of
 * look-ahead — a 76 m radius. The streak stops accruing at exactly 8 m/s. A road built out of
 * 76 m bends is therefore a road nobody is ever allowed to cruise on, which is the opposite of
 * the point. At 103 m the autopilot still asks for about 8.8 m/s at the very tightest bend a
 * lane can have, and measured over 150 s of auto-drive it stayed above 8 m/s for 99% of the
 * time — the same figure as the old straight roads. */

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
 * DIRECTION of the road through a node: the average of the unit directions to every neighbour
 * it is joined to. Two opposite neighbours give a straight-through tangent; an L-junction
 * gives a diagonal, which is what turns the corner smoothly.
 *
 * It is a unit vector and it belongs to the NODE, not to either edge, so both edges meeting
 * here leave along the same line and the network stays kink-free. The neighbour directions are
 * normalised before averaging — summing them raw let the longer link drag the tangent round,
 * so a junction between a short link and a long one bent the short one sideways.
 */
function nodeDir(i, j, tier, seed, out) {
  nodePos(i, j, tier, seed, _p);
  let tx = 0,
    tz = 0;
  let dx, dz, l;
  // east neighbour
  if (connects(i, j, 0, tier, seed)) {
    nodePos(i + 1, j, tier, seed, _q);
    dx = _q[0] - _p[0];
    dz = _q[1] - _p[1];
    l = Math.hypot(dx, dz) || 1;
    tx += dx / l;
    tz += dz / l;
  }
  // west neighbour (its own east link)
  if (connects(i - 1, j, 0, tier, seed)) {
    nodePos(i - 1, j, tier, seed, _q);
    dx = _p[0] - _q[0];
    dz = _p[1] - _q[1];
    l = Math.hypot(dx, dz) || 1;
    tx += dx / l;
    tz += dz / l;
  }
  // south neighbour
  if (connects(i, j, 1, tier, seed)) {
    nodePos(i, j + 1, tier, seed, _q);
    dx = _q[0] - _p[0];
    dz = _q[1] - _p[1];
    l = Math.hypot(dx, dz) || 1;
    tx += dx / l;
    tz += dz / l;
  }
  // north neighbour
  if (connects(i, j - 1, 1, tier, seed)) {
    nodePos(i, j - 1, tier, seed, _q);
    dx = _p[0] - _q[0];
    dz = _p[1] - _q[1];
    l = Math.hypot(dx, dz) || 1;
    tx += dx / l;
    tz += dz / l;
  }
  const len = Math.hypot(tx, tz);
  if (len < 1e-5) {
    // Two neighbours that cancel exactly, or none at all. Any direction will do as long as
    // every edge at this node agrees on it, so hash one out of the node's own coordinates.
    const a = (hash2i(i, j, seed ^ 0x3ad7) * F) * TAU;
    out[0] = Math.cos(a);
    out[1] = Math.sin(a);
  } else {
    out[0] = tx / len;
    out[1] = tz / len;
  }
  return out;
}

const _t0 = [0, 0];
const _t1 = [0, 0];
const _bp = [0, 0];
const _bd = [0, 0];

/** Tangent lengths to try, longest first, when a junction's shared tangent fights the chord. */
const TANGENT_BACKOFF = [1, 0.72, 0.5, 0.34, 0.22];

/**
 * The last line of defence: no vertex of a finished road may turn inside this radius.
 *
 * Everything above works on the analytic curve, and it gets the analytic curve right — but a
 * node's tangent is shared by every edge at it, and at a junction where the legs fan out past
 * about 150 degrees there is no single tangent that all of them can leave along. One leg then
 * has to swing out and come back, and no tangent LENGTH fixes a tangent DIRECTION: measured
 * over a 12 km square, a couple of dozen lanes in four hundred turned inside 60 m and one tied
 * an actual knot at 2 m. That is a lane looping over itself on screen.
 *
 * So the polyline is relaxed afterwards. Only vertices that are over the limit move, and only
 * towards the midpoint of their neighbours, which is the direction that unwinds a loop; the two
 * end vertices never move, so the edge still lands exactly on both of its nodes and the network
 * still joins up. An edge that was already within the limit — nearly all of them — is untouched
 * and the loop exits after one pass.
 *
 * 70 m is well clear of the 115 m the winding itself is allowed to ask for, so this can only
 * ever catch the junction geometry, never the design.
 */
const UNKNOT_RADIUS = 70;

function unknot(pts, n) {
  for (let pass = 0; pass < 48; pass++) {
    let moved = false;
    for (let k = 1; k < n; k++) {
      const ax = pts[k * 2 - 2],
        az = pts[k * 2 - 1];
      const bx = pts[k * 2],
        bz = pts[k * 2 + 1];
      const cx = pts[k * 2 + 2],
        cz = pts[k * 2 + 3];
      const ux = bx - ax,
        uz = bz - az;
      const vx = cx - bx,
        vz = cz - bz;
      /* The turn ANGLE, not the circumradius. The circle through three points goes to infinity
       * when they are collinear — including when they are collinear because the road turned
       * through 180 degrees and came back down its own line, which is the exact shape of the
       * worst knot in the network. A circumradius test scores that as perfectly straight and
       * walks past it. */
      const turn = Math.atan2(Math.abs(ux * vz - uz * vx), ux * vx + uz * vz);
      const span = (Math.hypot(ux, uz) + Math.hypot(vx, vz)) * 0.5;
      if (turn * UNKNOT_RADIUS <= span) continue;
      // Pull towards the midpoint, harder the tighter it is, capped so one pass cannot
      // overshoot into a kink the other way.
      const g = clamp(0.5 * (1 - span / (turn * UNKNOT_RADIUS)), 0.1, 0.5);
      pts[k * 2] = bx + ((ax + cx) * 0.5 - bx) * g;
      pts[k * 2 + 1] = bz + ((az + cz) * 0.5 - bz) * g;
      moved = true;
    }
    if (!moved) break;
  }
}

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

/** Derivative of the same curve. Needed for the normal the winding is applied along. */
function hermiteTan2(p0x, p0z, m0x, m0z, p1x, p1z, m1x, m1z, t, out) {
  const t2 = t * t;
  const g00 = 6 * t2 - 6 * t;
  const g10 = 3 * t2 - 4 * t + 1;
  const g01 = -6 * t2 + 6 * t;
  const g11 = 3 * t2 - 2 * t;
  out[0] = g00 * p0x + g10 * m0x + g01 * p1x + g11 * m1x;
  out[1] = g00 * p0z + g10 * m0z + g01 * p1z + g11 * m1z;
  return out;
}

/**
 * Peak curvature of the base hermite, sampled. Used only to spot a cusp, so 17 samples is
 * plenty — a cubic cannot hide a knot between them.
 */
function basePeak(p0x, p0z, p1x, p1z, t0x, t0z, t1x, t1z, m) {
  const dx = p1x - p0x,
    dz = p1z - p0z;
  const m0x = t0x * m,
    m0z = t0z * m,
    m1x = t1x * m,
    m1z = t1z * m;
  let peak = 0;
  for (let s = 0; s <= 16; s++) {
    const t = s / 16;
    const g01 = 6 * t - 6 * t * t;
    const g10 = 3 * t * t - 4 * t + 1;
    const g11 = 3 * t * t - 2 * t;
    const bx = g01 * dx + g10 * m0x + g11 * m1x;
    const bz = g01 * dz + g10 * m0z + g11 * m1z;
    const cx = (6 - 12 * t) * dx + (6 * t - 4) * m0x + (6 * t - 2) * m1x;
    const cz = (6 - 12 * t) * dz + (6 * t - 4) * m0z + (6 * t - 2) * m1z;
    const sp = Math.hypot(bx, bz);
    if (sp < 1e-6) return Infinity;
    const k = Math.abs(bx * cz - bz * cx) / (sp * sp * sp);
    if (k > peak) peak = k;
  }
  return peak;
}

/* ── the winding ────────────────────────────────────────────────────────────
 *
 * On its own a lattice link is very nearly a straight line. The node tangent is the average
 * direction of the node's own links, so a node in the middle of an east-west run points
 * straight through, and the curve between two such nodes is a line with a hint of S in it.
 * Measured the way tools/browser-test.mjs measures it, the whole network turned 100 degrees per
 * kilometre. A road with real bends turns more than 200. "They're still straight lines attached
 * to each other."
 *
 * The bends are added as a lateral offset ON TOP of the hermite rather than by moving the nodes
 * about, because the nodes are the part that has to stay put — they are where edges meet, and
 * routing the lattice itself over the terrain made the cliffs worse and tripled the build time
 * the last time it was tried (docs/BACKLOG.md).
 *
 *     P(t) = B(t) + N(t) * w(t)
 *
 * B is the hermite and N its left-hand unit normal. Everything then hangs on w, and w has to
 * satisfy w(0) = w(1) = 0 AND w'(0) = w'(1) = 0. The first pair keeps the edge on its nodes;
 * the second keeps it leaving along the shared node tangent, which is what makes the network C1
 * at every junction. Get the second one wrong — the obvious choice, a plain sin(2*PI*h*t), does
 * — and every junction in the world grows a corner.
 *
 * WHAT w IS. The first attempt made w a sum of cosine harmonics with hashed amplitudes. It
 * worked, but it saturated: turn per kilometre is the MEAN curvature while the thing you have
 * to limit is the PEAK, and a sum of sinusoids spends most of its length nowhere near its own
 * peak. Tripling the amplitude took the network from 187 to 212 deg/km and no further, because
 * every extra metre of swing was eaten by the tightest-bend clamp.
 *
 * So w is built the other way round, from the curvature outwards:
 *
 *   1. a soft square wave — tanh of a few hashed harmonics — as the curvature SHAPE, so the
 *      road holds a radius through a bend and swaps to the other lock, rather than easing in
 *      and straight back out. That is what a road with round turns actually does, and it is
 *      what makes the mean approach the peak instead of 64% of it.
 *   2. integrate it twice to get the offset,
 *   3. take out whatever slope and position are left over at t = 1, which restores all four
 *      boundary conditions,
 *   4. scale the whole thing so its tightest bend is a hashed fraction of the tier's floor.
 *
 * Step 4 is why the tier tunable is a RADIUS. Every edge is normalised to it, so the curvature
 * is a property of the road rather than of how the hash happened to fall, and asking for more
 * bend is a matter of asking for a smaller radius rather than pushing an amplitude until the
 * clamp swallows it.
 */
const _c = new Float32Array(128);
const _wOff = new Float32Array(128);

function windOf(i, j, dir, tier, chord, n, maxSwing, seed) {
  const T = TIERS[tier];
  const h = hash2i(i * 2 + dir, j, seed ^ (tier === 0 ? 0x5b3d1a7f : 0x1e9d77c3));
  const g = hash2i(j * 2 + dir, i, seed ^ 0x2c77e10b);
  /* One cycle is TWO bends, one each way, so this is the count of cycles that gives bends of
   * about `bend` metres. The lead harmonic has to dominate: with three harmonics of similar
   * weight the sign of the sum wanders, some stretches hold one lock for half the edge, and the
   * sideways swing that produces then scales the WHOLE edge back down through the cap below.
   * That was worth 60 deg/km — the roads were being flattened by their own longest bend. */
  const first = Math.max(1, Math.round(chord / (2 * T.bend)));

  // 1. the curvature shape. tanh(2.4 x) is flat-topped enough to read as a held radius and
  //    still rounded enough not to snap between locks.
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    let a = Math.sin(TAU * first * t + ((g & 0x3ff) / 1023) * TAU);
    for (let q = 1; q < HARMONICS; q++) {
      const amp = 0.42 * (((h >>> (q * 10)) & 0x3ff) / 1023);
      const ph = (((g >>> (q * 10)) & 0x3ff) / 1023) * TAU;
      a += amp * Math.sin(TAU * (first + q) * t + ph);
    }
    _c[k] = Math.tanh(2.4 * a);
  }

  // 2. two trapezoid integrations. `dt` is in curve parameter, so everything below is in
  //    parameter units until the scale at the end puts it back into metres.
  const dt = 1 / n;
  let v = 0,
    w = 0;
  _wOff[0] = 0;
  for (let k = 1; k <= n; k++) {
    const vn = v + (_c[k - 1] + _c[k]) * 0.5 * dt;
    w += (v + vn) * 0.5 * dt;
    v = vn;
    _wOff[k] = w;
  }

  /* 3. put the far end back on its node, and back on its tangent, in two steps — and the order
   *    is the whole reason this reaches 200 deg/km.
   *
   *    The leftover SLOPE v1 is just the net of the curvature over the edge, and the phase
   *    means it is rarely zero. Cancelling it with a cubic works, but the cubic's own second
   *    derivative runs from -2*v1 to 4*v1 and lands on top of a curvature whose whole range is
   *    -1 to 1. Step 4 then normalises the PEAK, so an edge with a bit of leftover slope had
   *    its every bend scaled back to make room for a correction term. Measured: peak 1.6 where
   *    the mean was 0.8, so the roads were delivering 40% of the radius they asked for.
   *
   *    So take the slope out at the source instead: subtracting a constant v1 from the
   *    curvature is a linear ramp out of the slope and a quadratic out of the offset, and it
   *    costs 1 of the 1.0 the curvature had to give rather than 0.6. Only the leftover
   *    POSITION then needs a cubic, and that one is small. */
  const v1 = v;
  const w1 = _wOff[n] - v1 * 0.5;
  let peak = 0;
  let swing = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n,
      t2 = t * t,
      t3 = t2 * t;
    const val = _wOff[k] - v1 * t2 * 0.5 - (-2 * t3 + 3 * t2) * w1;
    _wOff[k] = val;
    if (Math.abs(val) > swing) swing = Math.abs(val);
    // curvature of what is left, still in parameter units
    const cc = Math.abs(_c[k] - v1 - (6 - 12 * t) * w1);
    if (cc > peak) peak = cc;
  }

  // 4. scale to a hashed fraction of the tier's tightest radius, then hold it back further if
  //    that would swing the road too far sideways. The swing cap is not cosmetic: the offset is
  //    taken along the base curve's normal, and an offset approaching the base curve's own
  //    radius folds it over.
  // Bits 0-9 of h are the only ones the shape above did not spend; using an overlapping slice
  // would tie how tight an edge bends to which harmonic happened to be loud on it.
  const want = (1 / T.radius) * (0.8 + 0.2 * ((h & 0x3ff) / 1023));
  let s = peak > 1e-9 ? (want * chord * chord) / peak : 0;
  if (swing * s > maxSwing) s = maxSwing / Math.max(swing, 1e-9);
  for (let k = 0; k <= n; k++) _wOff[k] *= s;
}

/**
 * The BASE geometry of a single edge, sampled into a polyline: the hermite, the winding and
 * the unknot relaxation, and nothing about any OTHER edge. `pts` is [x0,z0,x1,z1,...].
 *
 * Pure in (i, j, dir, tier, seed) — no heights, nothing about the land — which is why the
 * result can be cached and shared. It is the elevation that used to be box-dependent, never
 * the shape.
 *
 * "Base" because `buildGeom` below adds one more pass on top — squaring up crossings against
 * a NEIGHBOUR edge — and that pass has to read the neighbour's shape from somewhere that is
 * not itself squared, on pain of two edges each waiting on the other to go first. This
 * function is that somewhere: every caller that wants "what does this edge cross" reads
 * edges through `baseGeomFor`, never through `geomFor`, for exactly that reason.
 */
function buildBaseGeom(i, j, dir, tier, seed) {
  const T = TIERS[tier];
  const i1 = dir === 0 ? i + 1 : i;
  const j1 = dir === 0 ? j : j + 1;
  const p0 = nodePos(i, j, tier, seed, [0, 0]);
  const p1 = nodePos(i1, j1, tier, seed, [0, 0]);
  const chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;

  nodeDir(i, j, tier, seed, _t0);
  nodeDir(i1, j1, tier, seed, _t1);
  /* Tangent LENGTH scales with this edge's own chord, not with the lattice cell. It used to be
   * cell * curve * 2, which is fine while two nodes sit a cell apart — but the jitter can put
   * them a fifth of that apart, and a 769 m tangent on a 130 m link is a cusp, not a curve.
   * Measured over a 12 km square the old network turned inside a 6 m radius in places and had
   * 38 segments running backwards down their own edge. Scaling with the chord keeps the
   * overshoot proportional, which is what a Catmull-Rom does and why it does not loop.
   *
   * Proportional is still not always enough. Where a node's shared tangent leaves at a wide
   * angle to this particular chord, the hermite has to swing out and come back, and past a
   * certain tangent length that swing closes into a loop. So: try the full length, measure what
   * the curve actually does, and shorten until it behaves. Shorter is not automatically safer —
   * a very short tangent turns the corner in almost no distance, which is just as tight — so
   * this keeps the LONGEST length that clears the floor, and if none of them does, the least
   * bad. It runs the measurement on every edge but only shortens a handful in a 12 km square. */
  const want = chord * Math.min(T.curve * 2, 1.25);
  let m = want;
  let bestPeak = Infinity;
  for (let a = 0; a < 5; a++) {
    const trial = want * TANGENT_BACKOFF[a];
    const peak = basePeak(p0[0], p0[1], p1[0], p1[1], _t0[0], _t0[1], _t1[0], _t1[1], trial);
    if (peak < bestPeak) {
      bestPeak = peak;
      m = trial;
    }
    if (peak * BASE_MIN_RADIUS <= 1) break;
  }
  const m0x = _t0[0] * m,
    m0z = _t0[1] * m;
  const m1x = _t1[0] * m,
    m1z = _t1[1] * m;

  const n = clamp(Math.round(chord / T.step), 8, 96);
  /* How far sideways the winding may go. Two limits, whichever is tighter: a fraction of the
   * chord, so a road never wanders far enough to tangle with its neighbours; and a fraction of
   * the BASE curve's own radius, because the offset is taken along the base normal and an
   * offset that reaches the base radius folds the curve inside out. That fold is where the 3 m
   * turns came from — not from asking for too much bend, but from asking for it in the middle
   * of a corner the base curve was already taking. */
  const swingCap = Math.min(T.swing * chord, bestPeak > 1e-9 ? 0.45 / bestPeak : Infinity);
  windOf(i, j, dir, tier, chord, n, swingCap, seed);

  const pts = new Float32Array((n + 1) * 2);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    hermite2(p0[0], p0[1], m0x, m0z, p1[0], p1[1], m1x, m1z, t, _bp);
    hermiteTan2(p0[0], p0[1], m0x, m0z, p1[0], p1[1], m1x, m1z, t, _bd);
    const dl = Math.hypot(_bd[0], _bd[1]) || 1;
    // left-hand normal in the ground plane (three puts +X on your left looking down +Z, so
    // "left" here is only a name — the offset is signed and swings both ways)
    const nx = -_bd[1] / dl,
      nz = _bd[0] / dl;
    const w = _wOff[k];
    pts[k * 2] = _bp[0] + nx * w;
    pts[k * 2 + 1] = _bp[1] + nz * w;
  }
  unknot(pts, n);
  // A per-edge width wobble so no two roads are identical, and a per-edge surface roll
  // that biomes can override.
  const h = hash2i(i * 3 + dir, j * 7, seed ^ 0x77c1);
  const wj = 1 + ((h & 0xff) / 255 - 0.5) * 0.22;
  const g = {
    tier,
    pts,
    // Nominal metres between samples. The winding adds a couple of per cent of arc length on
    // top; this is only used to convert a smoothing LENGTH into a number of passes.
    span: chord / n,
    width: T.width * wj,
    verge: T.verge,
    key: `${tier}:${i},${j},${dir}`,
    // axis-aligned bounds, and the per-block ones, filled below
    minX: 0,
    maxX: 0,
    minZ: 0,
    maxZ: 0,
    segs: n,
    blk: null,
  };
  bounds(g);
  return g;
}

/** Cached base shapes, exactly parallel to GEOM/geomFor below but never squared against a
 *  neighbour — this is what `baseNeighbors` hands `squareCrossings`, so that squaring one
 *  edge can never depend on another edge's own squaring having happened first. */
const GEOM_BASE_CAP = 4096;
const GEOM_BASE = new Map();

function baseGeomFor(i, j, dir, tier, seed) {
  const key = `${seed}:${tier}:${i},${j},${dir}`;
  let g = GEOM_BASE.get(key);
  if (g === undefined) {
    g = buildBaseGeom(i, j, dir, tier, seed);
    if (GEOM_BASE.size >= GEOM_BASE_CAP) GEOM_BASE.clear();
    GEOM_BASE.set(key, g);
  }
  return g;
}

/**
 * Every lattice edge (either tier) whose geometry, fetched through `fetch`, could reach the
 * box [x0,x1]x[z0,z1] padded by `pad`. The reach math is `edgesInBox`'s; factored out here so
 * that function and `baseNeighbors` below ask the same question of two different geometry
 * layers — the final one and the base one — without the reach formula existing twice and
 * quietly drifting apart.
 */
function geomsInBox(x0, z0, x1, z1, seed, pad, fetch) {
  const out = [];
  for (let tier = 0; tier < TIERS.length; tier++) {
    const T = TIERS[tier];
    const maxChord = T.cell * (1 + 2 * T.jitter);
    const bulge = (8 / 27) * Math.min(T.curve * 2, 1.25) * maxChord + T.swing * maxChord;
    const reach = T.cell * (1 + T.jitter) + bulge + pad;
    const i0 = Math.floor((x0 - reach) / T.cell);
    const i1 = Math.floor((x1 + reach) / T.cell);
    const j0 = Math.floor((z0 - reach) / T.cell);
    const j1 = Math.floor((z1 + reach) / T.cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (let dir = 0; dir < 2; dir++) {
          if (!connects(i, j, dir, tier, seed)) continue;
          const g = fetch(i, j, dir, tier, seed);
          const m = g.width * 0.5 + g.verge + pad;
          if (g.maxX < x0 - m || g.minX > x1 + m || g.maxZ < z0 - m || g.minZ > z1 + m) continue;
          out.push(g);
        }
      }
    }
  }
  return out;
}

/** Every OTHER edge's BASE shape that could cross this one — `partnersOf`, one layer down,
 *  before either edge has a height or a squared-up crossing angle. `pad` is `CROSS_PAD`,
 *  defined further down with `levelAgainst`; reused rather than re-picked so "how far away
 *  can't possibly be a crossing" is one number for both height and angle. */
function baseNeighbors(base, seed, pad) {
  const list = geomsInBox(base.minX, base.minZ, base.maxX, base.maxZ, seed, pad, baseGeomFor);
  const out = [];
  for (const o of list) if (o.key !== base.key) out.push(o);
  return out;
}

/**
 * Does A outrank B — must B yield to A where they cross? The same rule `levelAgainst` uses
 * for height: arterials are never moved by anything, and among lanes the lower key wins, a
 * stable order so a pair can never both defer to each other. Angle correction reuses it so a
 * lane squares its crossing against the SAME road it already levels its height against,
 * rather than the two mechanisms picking different winners at one junction.
 *
 * Exported so render/road.js can pick the same winner when it decides which side of a drawn
 * junction gets the give-way markings — one priority rule, not two that could disagree.
 */
export function outranks(a, b) {
  if (a.tier !== b.tier) return a.tier < b.tier;
  return a.key < b.key;
}

/**
 * The radius a junction bend is allowed to tighten to while squaring a crossing — tighter
 * than BASE_MIN_RADIUS (130 m, the open network's own floor) on purpose, the same way a real
 * junction's own curve is tighter than the road either side of it, but with real clearance
 * above UNKNOT_RADIUS (70 m) so this pass does not lean on that safety net to do its job.
 */
const CROSS_SQUARE_RADIUS = 90;

/**
 * Tangent-length multipliers (of the chord) `huntTangent` tries. `buildBaseGeom`'s own
 * TANGENT_BACKOFF only ever backs a tangent OFF (down to 0.22 of its starting guess) because a
 * junction there is fighting a SHARED node tangent it cannot change the direction of, and a
 * shorter tangent is the only lever available. Squaring a crossing picks its OWN end tangents
 * (this edge's original one at each window edge, the rotated target at the crossing), so the
 * failure mode is different: swept on one real crossing that needed 64 degrees of net turn
 * over an 84 m chord, peak curvature FELL from a 0.7 m radius at 0.1x chord to a best of 27 m
 * at 1.2x, then rose again to 12 m at 2x and 1.7 m at 3x — a single interior optimum, not a
 * monotonic backoff. Bracketing it from both sides is why 1.4 and 1.6 are here alongside
 * everything TANGENT_BACKOFF already covers.
 */
const CROSS_TANGENT_TRIALS = [1.6, 1.4, 1.2, 1, 0.72, 0.5, 0.34, 0.22];

/**
 * The radius this pass insists on before it will settle for a correction. Deliberately BELOW
 * UNKNOT_RADIUS (70 m), not above it, and tuned by measuring both ends of that choice on
 * tools/diag-curve.mjs's own tightest-R figure against tools/diag-crossing-angle.mjs's
 * distribution: asking for a target above 70 (78 was tried) left `unknot` doing real work
 * pulling corrections back in on almost every crossing tight enough to need one, which cost
 * more of the correction than the radius was worth — mean deviation across the 12 km box was
 * 22.8 deg. Asking for 62 lets more crossings keep a bigger share of their bend BEFORE unknot
 * gets a say, and unknot (still run unconditionally afterwards) only has to touch the genuine
 * outliers: mean deviation improved to 20.4 deg on the same box while tightest-R came back to
 * within 2 m of the UNCORRECTED network's own baseline (56 m vs 58 m on the 4 km box, 42 m vs
 * 42 m on the 12 km box — this file's tightest turns are not at a squared junction either way).
 * Not every crossing can reach 90 degrees AND this radius inside a window this file is willing
 * to spend — see `DELTA_BACKOFF` — so this is a target `squareCrossings` tries hard for, not a
 * guarantee; `unknot` is the guarantee.
 */
const CROSS_SAFE_RADIUS = 62;

/**
 * Fallback fractions of the full `delta` correction, tried in order until the best hermite
 * `huntTangent` can find clears `CROSS_SAFE_RADIUS`. A crossing that would need a very sharp
 * bend to reach exactly 90 degrees — a lane meeting a road at a shallow, near-parallel angle —
 * cannot be squared all the way up without turning tighter than a car should have to steer at
 * cruising speed, however wide the window is allowed to grow: measured on one real crossing,
 * even the best of eight tangent-length trials only reached a 27 m radius at the FULL
 * correction. Landing partway to square and staying smooth reads as a road that gently curves
 * to meet a junction; landing exactly at 90 degrees by turning inside 30 m reads as a car spun
 * out at the junction. The task this file was built for accepts the former as an honest
 * partial fix and asks for the number, not a cliff-edge switch to "give up entirely".
 */
const DELTA_BACKOFF = [1, 0.78, 0.58, 0.42, 0.28, 0.16];

/**
 * Best hermite tangent length among `CROSS_TANGENT_TRIALS` (of the chord) — whichever peaks
 * lowest, full search rather than first-to-clear, since the landscape has one interior optimum
 * rather than a monotonic one `buildBaseGeom`'s own backoff search could stop early on. Only
 * ever asked of a handful of crossings, so evaluating every trial costs nothing that matters.
 */
function huntTangent(p0x, p0z, p1x, p1z, t0x, t0z, t1x, t1z, chord) {
  let m = chord,
    bestPeak = Infinity;
  for (const f of CROSS_TANGENT_TRIALS) {
    const trial = chord * f;
    const peak = basePeak(p0x, p0z, p1x, p1z, t0x, t0z, t1x, t1z, trial);
    if (peak < bestPeak) {
      bestPeak = peak;
      m = trial;
    }
  }
  return m;
}

/**
 * Bend `pts` — a private, mutable copy of `base.pts` — so that wherever this edge crosses a
 * road that OUTRANKS it (see `outranks`), the crossing reads as a right angle.
 *
 * The crossing sample `kc` is re-anchored as a shared waypoint between two LOCAL hermite
 * pieces: one from the window's start (`k0`, its position and tangent both left exactly as
 * they were) to `kc` (target tangent = this edge's own tangent there, rotated onto whichever
 * of the other road's two perpendiculars is nearer), and one from `kc` on to the window's end
 * (`k1`, again untouched). Both pieces are built with `hermite2`, the SAME curve family
 * `buildBaseGeom` already builds the whole network from, so k0 and k1 are hit exactly (a
 * hermite lands on its control points by construction) and the tangent the untouched curve
 * already has there is matched exactly too — no residual position or slope left over at
 * either edge of the window, and so no discontinuity for `unknot` (below) to have to smooth
 * away in the first place.
 *
 * An earlier version of this rotated the existing SAMPLES bodily about the crossing point
 * instead of rebuilding the curve. That does keep k0 and k1 fixed, but rotating a whole
 * neighbourhood of points about ONE external pivot by an angle that varies sample to sample
 * does not preserve segment LENGTH the way a proper curvature-controlled bend does — points
 * further from the pivot get dragged further per degree than points closer to it — and the
 * result was locally tighter than it looked, tight enough that `unknot` (correctly) spent
 * several of its 48 passes undoing most of the correction: measured on one real crossing, a
 * 48.3 deg deviation that the rotation approach had brought to 30.8 deg came back out at
 * 3.6 deg once `unknot` finished with it. Rebuilding the curve instead of relocating its
 * samples removes the artefact `unknot` was reacting to, rather than fighting `unknot`.
 *
 * Only the LOWER-priority edge of a crossing pair ever moves, so this can never be circular:
 * an edge bends only towards a neighbour's BASE shape, and any neighbour that outranks it is
 * by construction never bent by this same pass on THIS edge's account (it is either tier 0,
 * which this pass never moves, or a lower key, which this edge only ever yields TO, never
 * FROM). `unknot` still runs again afterwards, the same safety net `buildBaseGeom` already
 * trusts, in case a crossing too close to this edge's own node left no room for a full window.
 */
/**
 * Metres per sample this pass resamples a corrected window at, deliberately finer than a
 * tier's own `step`. The window can carry up to 90 degrees of turn — the same as HALF of one
 * of the network's own tightest bends — inside as little as 48 m, and sampling it at a lane's
 * ordinary ~19 m spacing was nowhere near enough to represent that: measured on one real
 * crossing, the ANALYTIC hermite tangent at the crossing sample landed exactly on target
 * (verified against `hermiteTan2`), but the discrete SECANT between it and its one neighbour
 * — the only shape `unknot` or the renderer ever gets to see — read 32 degrees short of it,
 * because a sharply turning hermite does not cover arc length evenly in its parameter, and 4
 * samples could not resolve where the turn actually was. 4 m is comfortably finer than the
 * `RING_STEP` (6 m) render/road.js already resolves the ribbon at, so nothing downstream is
 * throwing resolution away either.
 */
const CROSS_SQUARE_STEP = 4;

/**
 * Returns `base.pts` bent so that wherever this edge crosses a road that OUTRANKS it (see
 * `outranks`), the crossing reads as a right angle — a NEW Float32Array when anything moved,
 * or `base.pts` itself, unchanged, when nothing did (the common case: most edges cross
 * nothing that outranks them, and handing back the same array costs nothing and stays safe
 * because pts is never written to in place once built — see `geomFor`'s own doc comment).
 *
 * Each crossing that needs fixing is treated as a shared waypoint between two LOCAL hermite
 * pieces — window-start (`k0`, its position and tangent both read off the untouched curve) to
 * the crossing (target tangent = this edge's own tangent there, rotated onto whichever of the
 * other road's two perpendiculars is nearer), and the crossing on to window-end (`k1`, same
 * idea). Both pieces are `hermite2`, the SAME curve family `buildBaseGeom` already builds the
 * whole network from, so k0 and k1 are hit exactly and the tangent the untouched curve already
 * has there is matched exactly too — no residual position or slope left over at either edge of
 * the window. Unlike the base curve, though, each piece is then resampled at `CROSS_SQUARE_STEP`
 * — far finer than the edge's own ordinary spacing — and SPLICED into the polyline in place of
 * the coarse window it replaces, so the output edge has more points than it started with
 * wherever it actually had to bend. See `CROSS_SQUARE_STEP` for why the resampling has to be
 * finer, not just the bend itself smoother.
 *
 * Only the LOWER-priority edge of a crossing pair ever moves, so this can never be circular:
 * an edge bends only towards a neighbour's BASE shape, and any neighbour that outranks it is
 * by construction never bent by this same pass on THIS edge's account (it is either tier 0,
 * which this pass never moves, or a lower key, which this edge only ever yields TO, never
 * FROM). `unknot` still runs again afterwards on the spliced result, the same safety net
 * `buildBaseGeom` already trusts, in case a crossing too close to this edge's own node left no
 * room for a full window.
 */
function squareCrossings(base, seed) {
  const neighbors = baseNeighbors(base, seed, CROSS_PAD);
  if (!neighbors.length) return base.pts;

  const found = findCrossings([base, ...neighbors]);
  const mine = [];
  for (const c of found) {
    if (c.a !== base) continue; // base is always list[0] so always `a`; defensive anyway
    if (!outranks(c.b, base)) continue; // base outranks the other: base does not yield here
    mine.push({ ka: c.ka, mx: c.ax, mz: c.az, ox: c.bx, oz: c.bz });
  }
  if (!mine.length) return base.pts;
  mine.sort((p, q) => p.ka - q.ka);

  const src = base.pts;
  const n = src.length / 2;
  const out = [];
  let cursor = -1; // last index of `src` already written to `out`
  let bent = false;

  for (let idx = 0; idx < mine.length; idx++) {
    const m = mine[idx];
    const kc = clamp(Math.round(m.ka), 1, n - 2);
    if (kc <= cursor) continue; // this window would start before the last one finished

    /* The minimal rotation of MY tangent that lands it on whichever of the other tangent's
     * two perpendiculars is nearer, so the road bends towards the crossing it already had
     * instead of flipping to face the other way. Both tangents are treated as LINES (mod PI,
     * via atan2 then folded), not vectors, so a road sampled "backwards" gets the same
     * answer either way — there is no handedness assumption here at all (gotcha 1), only a
     * dot-product-shaped fold. */
    const thetaM = Math.atan2(m.mx, m.mz);
    const thetaO = Math.atan2(m.ox, m.oz);
    let raw = (thetaM - thetaO) % Math.PI;
    if (raw <= -Math.PI / 2) raw += Math.PI;
    else if (raw > Math.PI / 2) raw -= Math.PI;
    const delta = raw >= 0 ? Math.PI / 2 - raw : -Math.PI / 2 - raw;
    if (Math.abs(delta) < 1e-4) continue; // already square

    // The window grows with the correction so a near-parallel crossing (up to 90 deg to
    // find) gets the room to bend without turning tighter than CROSS_SQUARE_RADIUS; a
    // crossing already close to square gets a short, barely-visible nudge.
    const desiredM = clamp(24 + Math.abs(delta) * 160, 24, 230);
    let win = Math.max(2, Math.round(desiredM / Math.max(base.span, 1e-3)));
    win = Math.min(win, kc - Math.max(cursor, 0), n - 1 - kc);
    if (idx < mine.length - 1) win = Math.min(win, Math.floor((clamp(Math.round(mine[idx + 1].ka), 1, n - 2) - kc) * 0.5));
    if (win < 2) continue; // no room since the last window, this edge's own node, or the next crossing

    const k0 = kc - win,
      k1 = kc + win;
    const p0x = src[k0 * 2],
      p0z = src[k0 * 2 + 1];
    const p1x = src[k1 * 2],
      p1z = src[k1 * 2 + 1];
    const pcx = src[kc * 2],
      pcz = src[kc * 2 + 1];

    // The tangent the untouched curve already has at each end of the window — forward/backward
    // differences into `src`, which this pass never writes to, so always safe to read.
    let d0x = src[(k0 + 1) * 2] - p0x,
      d0z = src[(k0 + 1) * 2 + 1] - p0z;
    let l = Math.hypot(d0x, d0z) || 1;
    d0x /= l;
    d0z /= l;
    let d1x = p1x - src[(k1 - 1) * 2],
      d1z = p1z - src[(k1 - 1) * 2 + 1];
    l = Math.hypot(d1x, d1z) || 1;
    d1x /= l;
    d1z /= l;

    const chordA = Math.hypot(pcx - p0x, pcz - p0z) || 1;
    const chordB = Math.hypot(p1x - pcx, p1z - pcz) || 1;

    // Target tangent at the crossing: my tangent there, rotated by a FRACTION of `delta`,
    // backed off (same idea as TANGENT_BACKOFF: try the full ask first, retreat only as far
    // as it takes) until the best hermite either segment can manage clears CROSS_SAFE_RADIUS.
    // The rotation itself is in the same atan2(x, z) convention `thetaM`/`thetaO` were read
    // in — NOT the textbook x*cos-z*sin form, which is for atan2(z, x) and, tried first,
    // quietly reflected every correction onto the wrong angle instead of just getting the
    // sign backwards, which is what the before/after crossing-angle measurement caught.
    let tgx = m.mx,
      tgz = m.mz,
      mA = 0,
      mB = 0,
      bestRadius = -Infinity;
    for (const df of DELTA_BACKOFF) {
      const d = delta * df;
      const ca = Math.cos(d),
        sa = Math.sin(d);
      const tx = m.mx * ca + m.mz * sa;
      const tz = -m.mx * sa + m.mz * ca;
      const trialA = huntTangent(p0x, p0z, pcx, pcz, d0x, d0z, tx, tz, chordA);
      const trialB = huntTangent(pcx, pcz, p1x, p1z, tx, tz, d1x, d1z, chordB);
      const r = Math.min(1 / basePeak(p0x, p0z, pcx, pcz, d0x, d0z, tx, tz, trialA), 1 / basePeak(pcx, pcz, p1x, p1z, tx, tz, d1x, d1z, trialB));
      if (r > bestRadius) {
        bestRadius = r;
        tgx = tx;
        tgz = tz;
        mA = trialA;
        mB = trialB;
      }
      if (r >= CROSS_SAFE_RADIUS) break;
    }

    // Unchanged src up to (but not including) k0 — k0 itself is about to be re-emitted as
    // the first sample of the fine resample below, which lands on it exactly (hermite at
    // t=0 reproduces p0x,p0z), so including it here too would duplicate a zero-length step.
    for (let k = cursor + 1; k < k0; k++) out.push(src[k * 2], src[k * 2 + 1]);

    const stepsA = clamp(Math.round(chordA / CROSS_SQUARE_STEP), win, 80);
    for (let s = 0; s <= stepsA; s++) {
      const t = s / stepsA;
      hermite2(p0x, p0z, d0x * mA, d0z * mA, pcx, pcz, tgx * mA, tgz * mA, t, _bp);
      out.push(_bp[0], _bp[1]);
    }
    const stepsB = clamp(Math.round(chordB / CROSS_SQUARE_STEP), win, 80);
    // s starts at 1: s=0 (t=0) reproduces pcx,pcz, which segment A's own t=1 sample just wrote.
    for (let s = 1; s <= stepsB; s++) {
      const t = s / stepsB;
      hermite2(pcx, pcz, tgx * mB, tgz * mB, p1x, p1z, d1x * mB, d1z * mB, t, _bp);
      out.push(_bp[0], _bp[1]);
    }
    cursor = k1;
    bent = true;
  }
  if (!bent) return base.pts;

  for (let k = cursor + 1; k < n; k++) out.push(src[k * 2], src[k * 2 + 1]);
  const result = Float32Array.from(out);
  unknot(result, result.length / 2 - 1);
  return result;
}

/**
 * THE geometry of an edge: the base shape, then squared up against whatever crosses it and
 * outranks it. Pure in (i, j, dir, tier, seed) — `squareCrossings` only ever reads
 * NEIGHBOURS' BASE shapes, never another edge's final one, so this has no more inputs than
 * `buildBaseGeom` did and is exactly as cacheable.
 *
 * This — not `buildBaseGeom` — is what `carve()`, `RoadField.query()` and the road ribbon all
 * actually see, because `geomFor` below calls this and everything in the file reaches the
 * network through `geomFor`/`edgesInBox`. One shape, every consumer: the crossing angle is
 * decided ONCE, here, and both the terrain carve and the renderer read the result of that one
 * decision rather than two independent opinions about where the road bends (gotcha 6).
 */
function buildGeom(i, j, dir, tier, seed) {
  const base = baseGeomFor(i, j, dir, tier, seed);
  const pts = squareCrossings(base, seed);
  if (pts === base.pts) return base; // nothing crossed and outranked this edge; no new object
  const g = { ...base, pts };
  bounds(g);
  return g;
}

/**
 * Cached edge geometry, and the mutable per-query wrapper laid over it.
 *
 * `buildGeom` is the most expensive pure function in the file — a hermite, a winding
 * integration and an unknot relaxation per edge, measured at 41 µs — and a road field asks
 * for the same edges over and over: every terrain chunk, every rebuild of the car's local
 * sampler, and the road ribbon all re-enumerate the same lattice. Caching the SHAPE is free
 * of any correctness question because the shape has no inputs beyond the lattice and the
 * seed.
 *
 * `pts` and `blk` are shared by every wrapper handed out for the same key, so NOTHING may
 * write to them. `y`, `water` and `land` are per-wrapper, because those are what the caller
 * fills in.
 */
const GEOM_CAP = 4096;
const GEOM = new Map();

function geomFor(i, j, dir, tier, seed) {
  const key = `${seed}:${tier}:${i},${j},${dir}`;
  let g = GEOM.get(key);
  if (g === undefined) {
    g = buildGeom(i, j, dir, tier, seed);
    if (GEOM.size >= GEOM_CAP) GEOM.clear();
    GEOM.set(key, g);
  }
  return g;
}

function edgeFrom(g) {
  const n = g.pts.length / 2;
  return {
    tier: g.tier,
    pts: g.pts,
    y: new Float32Array(n),
    // water surface under each sample, -Infinity where the ground is dry. Filled by
    // profileEdge and kept, because working it out is as expensive as a height sample.
    water: new Float32Array(n),
    // raw land under each sample, filled by profileEdge — the earthwork clamp needs it again
    // after the crossings have been levelled.
    land: null,
    span: g.span,
    width: g.width,
    verge: g.verge,
    key: g.key,
    minX: g.minX,
    maxX: g.maxX,
    minZ: g.minZ,
    maxZ: g.maxZ,
    segs: g.segs,
    blk: g.blk,
  };
}

/**
 * Segments per bounding block in the index below.
 *
 * The roads carry three times as many samples as they used to, and every one of them is a
 * segment that carve() and query() would otherwise test against every vertex of every chunk.
 * A block box costs four compares and skips eight segDist calls, and a road is coherent enough
 * that a block box is tight — so a chunk vertex near a road now tests a couple of blocks and
 * two or three segments instead of the whole polyline.
 */
const BLK = 8;

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

  const segs = e.pts.length / 2 - 1;
  e.segs = segs;
  const nb = Math.ceil(segs / BLK);
  const b = new Float32Array(nb * 4);
  for (let g = 0; g < nb; g++) {
    const k0 = g * BLK;
    const k1 = Math.min(segs, k0 + BLK);
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    // k1 inclusive: a block of segments k0..k1-1 spans points k0..k1
    for (let k = k0; k <= k1; k++) {
      const x = e.pts[k * 2],
        z = e.pts[k * 2 + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    b[g * 4] = x0;
    b[g * 4 + 1] = z0;
    b[g * 4 + 2] = x1;
    b[g * 4 + 3] = z1;
  }
  e.blk = b;
}

/**
 * Squared distance from (x,z) to a block box. Zero inside. A segment inside the box can never
 * be closer than this, so a block whose box is already further away than the best distance
 * found so far cannot hold the answer — which makes the skip EXACT rather than a tolerance.
 * Getting that wrong would silently shorten the road query range, and half the game asks
 * "how far is the nearest road" for something.
 */
function blockDist2(blk, g, x, z) {
  let dx = blk[g] - x;
  if (dx < 0) {
    dx = x - blk[g + 2];
    if (dx < 0) dx = 0;
  }
  let dz = blk[g + 1] - z;
  if (dz < 0) {
    dz = z - blk[g + 3];
    if (dz < 0) dz = 0;
  }
  return dx * dx + dz * dz;
}

/**
 * Every edge whose curve could come within `pad` metres of the axis-aligned box
 * [x0,x1]×[z0,z1]. Deterministic and order-stable, so two clients build identical lists.
 *
 * The furthest an edge that STARTS in cell (i,j) can get from that cell's centre — its far
 * node is a cell away plus the jitter; the hermite bulges off the chord by up to 4/27 of each
 * tangent; the winding swings on top of that — is `geomsInBox`'s reach formula, shared with
 * `baseNeighbors` so the two layers of geometry (final and pre-crossing) never disagree about
 * what counts as "nearby". Under-reaching here does not cost time, it loses whole roads at a
 * chunk boundary, so it is generous on purpose.
 */
export function edgesInBox(x0, z0, x1, z1, seed, pad = 40) {
  return geomsInBox(x0, z0, x1, z1, seed, pad, geomFor).map(edgeFrom);
}

/** The two lattice-node keys an edge's ends are pinned to — `${tier}:${i},${j}` each. */
function edgeNodeKeys(e) {
  const [tier, rest] = e.key.split(':');
  const [i, j, dir] = rest.split(',').map(Number);
  const i1 = dir === 0 ? i + 1 : i;
  const j1 = dir === 0 ? j : j + 1;
  return [`${tier}:${i},${j}`, `${tier}:${i1},${j1}`];
}

/**
 * Do edges A and B share a lattice node? Two edges that meet at a shared node are the network
 * CONTINUING — nodeDir() already makes them leave that node along one shared tangent, so they
 * are close to parallel there by design (a straight run) or turn smoothly (a bend), and that
 * point is not a junction in the operator's sense at all. Without this filter the brute-force
 * segment test below finds that shared endpoint as a "crossing" on every single adjacent edge
 * pair in the network and reports it as a near-0-degree crossing (two nearly-parallel tangents
 * touching at one point) — which swamped the real crossings 8 to 1 the first time this was
 * measured and made the same-tier numbers look catastrophically worse than the cross-tier
 * ones, exactly backwards from what two independent lattices predicts.
 */
function sharesNode(a, b) {
  if (a.tier !== b.tier) return false; // different tiers never share a node, ever
  const [a0, a1] = edgeNodeKeys(a);
  const [b0, b1] = edgeNodeKeys(b);
  return a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1;
}

/**
 * Every point where edge A's polyline actually crosses edge B's (A !== B, and not sharing a
 * lattice node — see `sharesNode`), for a list of edges as `edgesInBox` (or anything shaped
 * like its output) returns them. Geometry only, no heights needed, and pairwise with a
 * bounding-box pre-check so it stays cheap into the thousands of segments a multi-kilometre
 * box carries.
 *
 * THIS is the one crossing detector in the file. `squareCrossings` below (which bends an
 * edge's own tangent near a junction) and render/road.js (which draws the junction patch and
 * its markings) both call it rather than re-deriving "where do roads cross" a second and
 * third time — see the file-level rule next to `levelAgainst`.
 *
 * Returns [{ a, b, x, z, ka, kb, ax, az, bx, bz, angleDeg, deviationDeg }, ...]: a/b are the
 * two edges, (x,z) the crossing point, ka/kb the segment index of each edge the crossing
 * falls on, (ax,az)/(bx,bz) each edge's UNIT TANGENT there, angleDeg the ACUTE angle between
 * the two tangents (0 = parallel, 90 = perpendicular) and deviationDeg = |90 - angleDeg| — 0
 * is a perfect right-angle junction. The angle comes from a dot product of unit vectors, which
 * has no notion of handedness or "which side is left", so it cannot be bitten by gotcha 1.
 */
export function findCrossings(edges) {
  const out = [];
  for (let ai = 0; ai < edges.length; ai++) {
    const a = edges[ai];
    const na = a.pts.length / 2 - 1;
    for (let bi = ai + 1; bi < edges.length; bi++) {
      const b = edges[bi];
      if (a.key === b.key) continue;
      if (sharesNode(a, b)) continue;
      if (a.maxX < b.minX || a.minX > b.maxX || a.maxZ < b.minZ || a.minZ > b.maxZ) continue;
      const nb = b.pts.length / 2 - 1;
      for (let ka = 0; ka < na; ka++) {
        const ax0 = a.pts[ka * 2],
          az0 = a.pts[ka * 2 + 1];
        const ax1 = a.pts[ka * 2 + 2],
          az1 = a.pts[ka * 2 + 3];
        const alx = ax1 - ax0,
          alz = az1 - az0;
        const la = Math.hypot(alx, alz) || 1;
        for (let kb = 0; kb < nb; kb++) {
          const bx0 = b.pts[kb * 2],
            bz0 = b.pts[kb * 2 + 1];
          const bx1 = b.pts[kb * 2 + 2],
            bz1 = b.pts[kb * 2 + 3];
          const blx = bx1 - bx0,
            blz = bz1 - bz0;
          const d = alx * blz - alz * blx;
          if (Math.abs(d) < 1e-9) continue; // parallel segments never cross at a point
          const ua = ((bx0 - ax0) * blz - (bz0 - az0) * blx) / d;
          const ub = ((bx0 - ax0) * alz - (bz0 - az0) * alx) / d;
          if (ua < 0 || ua > 1 || ub < 0 || ub > 1) continue;
          const lb = Math.hypot(blx, blz) || 1;
          const uax = alx / la,
            uaz = alz / la;
          const ubx = blx / lb,
            ubz = blz / lb;
          let angleDeg = Math.acos(clamp(uax * ubx + uaz * ubz, -1, 1)) * 57.29577951308232;
          if (angleDeg > 90) angleDeg = 180 - angleDeg;
          out.push({
            a,
            b,
            x: ax0 + alx * ua,
            z: az0 + alz * ua,
            ka,
            kb,
            ax: uax,
            az: uaz,
            bx: ubx,
            bz: ubz,
            angleDeg,
            deviationDeg: Math.abs(90 - angleDeg),
          });
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
 * One [w, 1-2w, w] pass over an elevation profile, repeated. Ends are clamped, not wrapped.
 */
function blur(y, tmp, n, passes, w) {
  const c = 1 - 2 * w;
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < n; k++) {
      const a = y[k > 0 ? k - 1 : 0];
      const b = y[k];
      const d = y[k < n - 1 ? k + 1 : n - 1];
      tmp[k] = a * w + b * c + d * w;
    }
    y.set(tmp);
  }
}

/**
 * How many of those passes reach a smoothing length of `metres` at this sample spacing.
 *
 * One pass adds 2*w*spacing^2 of variance, so N passes give sigma = sqrt(2*w*N) * spacing.
 * This exists because the pass count used to be a constant (6 for arterials, 3 for lanes) —
 * which quietly means "however far six samples reach". Sampling the road three times finer to
 * make it curve would then have smoothed it over a third of the distance, and the road would
 * have started following every bump in the ground it used to ride over. The gradient a car can
 * climb is a length in metres, not a number of array elements.
 *
 * Cost is O(passes * n) and passes grows as n^2, so this is cubic in the sampling rate. At the
 * rates in TIERS that is a few thousand adds per edge and invisible; it is the reason `step`
 * has a floor rather than being "as fine as you like".
 */
function passesFor(metres, spacing, w) {
  return clamp(Math.round((metres * metres) / (2 * w * spacing * spacing)), 1, 160);
}

/* ── a node has ONE height ───────────────────────────────────────────────────
 *
 * Every edge smooths its own elevation over its own kilometre of ground, and two edges that
 * meet at a lattice node smooth over different ground — so they arrive at the SAME PLACE at
 * different heights. Measured on the seeded world: three arterials meet at node 0:(0,0) at
 * 17.0, 1.2 and 1.2 metres, and at a pass one edge left its shared node 18 m below the land
 * while the other left it 18 m above, 36 m apart at a single point.
 *
 * carve() then blends the ground between them, so a junction is a crater: the shelf under
 * each road sits metres below that road's own surface, the drawn tarmac hangs over a hole,
 * and the car drops into it. That is the operator's "falling through onto a lower plane",
 * and no amount of levelling crossings fixes it, because the two roads are not crossing —
 * they are the same road.
 *
 * The fix is upstream of all of it: the node owns the height, both edges are pinned to it,
 * and the pin is a pure function of (i, j, tier, seed) so every sampler agrees. The value is
 * the land averaged over a disc the size of the tier's own smoothing length, which is what
 * the smoothing was approximating in the first place — so the pin moves a well-behaved
 * profile by centimetres and only bites where the two edges genuinely disagreed.
 */
const NODEY = new Map();
const _np = [0, 0];
/** Sample offsets on the disc: centre, an inner ring and an outer ring, with their weights. */
const DISC = (() => {
  const out = [[0, 0, 1]];
  for (let a = 0; a < 8; a++) {
    const th = (a / 8) * TAU;
    out.push([Math.cos(th) * 0.55, Math.sin(th) * 0.55, 0.5]);
    out.push([Math.cos(th + TAU / 16), Math.sin(th + TAU / 16), 0.22]);
  }
  return out;
})();

function nodeY(i, j, tier, seed, landHeight, tag) {
  const key = `${tag}:${tier}:${i},${j}`;
  const hit = NODEY.get(key);
  if (hit !== undefined) return hit;
  nodePos(i, j, tier, seed, _np);
  const r = TIERS[tier].grade * 0.5;
  let s = 0,
    w = 0;
  for (const [dx, dz, ww] of DISC) {
    s += ww * landHeight(_np[0] + dx * r, _np[1] + dz * r);
    w += ww;
  }
  const here = landHeight(_np[0], _np[1]);
  // Inside the same earthwork budget every other part of the profile obeys, so the clamp
  // below cannot pull the endpoint back off the node and un-share it again.
  const y = clamp(s / w, here - MAX_EARTHWORK, here + MAX_EARTHWORK);
  if (NODEY.size >= PROFILE_CAP) NODEY.clear();
  NODEY.set(key, y);
  return y;
}

/**
 * Move an edge's two ends onto their nodes' heights, feathering the correction inwards over
 * the tier's smoothing length so the road ramps to the junction instead of stepping at it.
 */
function pinToNodes(e, landHeight, seed, tag) {
  const [i, j, dir] = e.key
    .slice(e.key.indexOf(':') + 1)
    .split(',')
    .map(Number);
  const y0 = nodeY(i, j, e.tier, seed, landHeight, tag);
  const y1 = nodeY(dir === 0 ? i + 1 : i, dir === 0 ? j : j + 1, e.tier, seed, landHeight, tag);
  const n = e.y.length;
  const d0 = y0 - e.y[0];
  const d1 = y1 - e.y[n - 1];
  if (d0 === 0 && d1 === 0) return;
  /* Reach in SAMPLES, from a length in metres, exactly as the smoothing does. 2.6 grade
   * lengths is where the gradient this correction adds stops mattering: measured on the
   * standard massif, the worst arterial grade goes 28.0% at one length to 26.7% at 2.6
   * against 24.5% for the unpinned network, and tools/diag-cliffs.mjs improves from 0.006%
   * of ground over 45° to 0.002% (it was 0.019% before any of this).
   *
   * Capped at half the edge so the two feathers meet in the middle rather than overlapping:
   * a jittered lane can be a fifth of its cell long, and where both ramps still had authority
   * at an endpoint the pin no longer landed on the node — which is the one thing it is for. */
  const reach = clamp((TIERS[e.tier].grade * 2.6) / Math.max(e.span, 1e-3), 2, (n - 1) * 0.5);
  for (let k = 0; k < n; k++) {
    const a = 1 - smoothstep(0, reach, k);
    const b = 1 - smoothstep(0, reach, n - 1 - k);
    e.y[k] += d0 * a + d1 * b;
  }
}

/**
 * The FIRST of the two stages that give an edge its elevation: the raw profile, before any
 * crossing is levelled. Module-private on purpose — it used to be exported, three other files
 * called it to get "the road height", and every one of them was then drawing or placing
 * something on a road that had since been levelled somewhere else. `edgeProfile()` below is
 * the one and only public answer to "how high is this road".
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
function profileEdge(e, landHeight, waterAt = null, seed = null, tag = null) {
  const n = e.y.length;
  const land = new Float32Array(n);
  for (let k = 0; k < n; k++) land[k] = landHeight(e.pts[k * 2], e.pts[k * 2 + 1]);
  e.y.set(land);
  /* Kept, not thrown away: levelling a crossing happens AFTER the earthwork clamp below, so
   * the clamp has to be re-applied afterwards, and re-sampling the land to do it would cost
   * as much as the whole profile. */
  e.land = land;

  /* The water surface under every sample, worked out ONCE. It used to be re-queried in each of
   * the three floor passes below and again in RoadField's constructor — four times per sample
   * — and waterAt costs a full biome-and-relief evaluation, the same as a height sample. On an
   * 8 km chunk that was 47 ms of the 87 ms road build spent computing the same number over
   * again. -Infinity means dry, so every floor test below reads identically wet or dry and
   * there is no branch on "is there water here". */
  const wl = e.water;
  for (let k = 0; k < n; k++) {
    const w = waterAt ? waterAt(e.pts[k * 2], e.pts[k * 2 + 1]) : null;
    // A causeway, not a ford. 1.1 m of freeboard reads as a raised road rather than a road
    // that happens to be dry. Stored WITH the freeboard so the floor is a single compare.
    wl[k] = w === null ? -Infinity : w + 1.1;
  }

  // Arterials are graded harder than lanes: a trunk road is engineered, a back lane follows
  // the ground.
  const tmp = new Float32Array(n);
  const T = TIERS[e.tier];
  blur(e.y, tmp, n, passesFor(T.grade, e.span, 0.25), 0.25);

  /* Both edges at a junction to the junction's own height, BEFORE the earthwork clamp and the
   * two smoothing passes below, so those can absorb the correction the way they were designed
   * to. They preserve the end samples themselves, so the pin survives them. */
  if (tag !== null) pinToNodes(e, landHeight, seed, tag);

  for (let k = 0; k < n; k++) {
    const d = e.y[k] - land[k];
    if (d > MAX_EARTHWORK) e.y[k] = land[k] + MAX_EARTHWORK;
    else if (d < -MAX_EARTHWORK) e.y[k] = land[k] - MAX_EARTHWORK;
    if (e.y[k] < wl[k]) e.y[k] = wl[k];
  }

  // Clamping breaks the smoothness it was applied to, so smooth once more — gently. Then
  // re-apply the floors, because a smoothing pass averages a raised point back down towards
  // its drowned neighbours and quietly puts the road under the water again. Floors last.
  const fine = passesFor(T.grade * 0.4, e.span, 0.2);
  for (let p = 0; p < fine; p++) {
    for (let k = 1; k < n - 1; k++) tmp[k] = e.y[k - 1] * 0.2 + e.y[k] * 0.6 + e.y[k + 1] * 0.2;
    tmp[0] = e.y[0];
    tmp[n - 1] = e.y[n - 1];
    e.y.set(tmp);
  }
  if (waterAt) {
    for (let k = 0; k < n; k++) if (e.y[k] < wl[k]) e.y[k] = wl[k];
    // One more smooth of the SHAPE only, clamped so it can never dip below the floor again.
    const last = passesFor(T.grade * 0.4, e.span, 0.25);
    for (let p = 0; p < last; p++) {
      for (let k = 1; k < n - 1; k++) {
        const avg = e.y[k - 1] * 0.25 + e.y[k] * 0.5 + e.y[k + 1] * 0.25;
        tmp[k] = avg > wl[k] ? avg : wl[k];
      }
      tmp[0] = e.y[0];
      tmp[n - 1] = e.y[n - 1];
      e.y.set(tmp);
    }
  }
  return e;
}

/* ── one road, ONE height ────────────────────────────────────────────────────
 *
 * `profileEdge` is pure: give it a key and a seed and it always returns the same elevation.
 * `levelCrossings` was not, and that one fact was the worst bug in the game.
 *
 * It levelled a lane against `this.edges` — whatever happened to be inside the RoadField's
 * BOX — so an edge's height was a property of the question you asked, not of the world. The
 * boxes are all different: a level-0 terrain chunk is 64 m with 80 m of pad, a coarse chunk
 * is kilometres, the car's local sampler is 840 m, the road ribbon's window is 3800 m. Same
 * lane, same seed, same point, four different heights — measured at up to 3.8 m between the
 * chunk the worker meshes and the ground the car stands on, and up to 24 m between the
 * ribbon the player can see and either of them. The car drove out from under a road that was
 * still being drawn, and since the ribbon is FrontSide it vanished on the way through.
 *
 * So the levelling neighbourhood is now derived from the EDGE, never from the caller:
 *
 *   raw   profileEdge and nothing else. Already pure.
 *   L1    raw, levelled against every ARTERIAL that crosses this edge. Arterials are never
 *         moved by anything, so for tier 0 this is also the final answer.
 *   L2    L1, levelled against the L1 height of every LANE that crosses it and outranks it
 *         (the same stable key order the old two-pass code used).
 *
 * Each level is a pure function of (seed, edge key, height field) and is memoised, so every
 * sampler in every worker returns the same number and the recursion is one hop deep — L2
 * needs its partners at L1, and L1 needs nobody. That bound is the point: the old code's
 * "level against whatever is in the list, in order" is an unbounded chain, which is exactly
 * why widening the box kept changing the answer.
 */

/** How far outside an edge's own bounds a road has to be before it cannot be crossing it.
 *  levelAgainst captures at 18 m of horizontal distance; edgesInBox's own margin adds the
 *  partner's half-width and verge on top of this, so 24 m is comfortably generous. */
const CROSS_PAD = 24;

/**
 * The furthest a road can reach into carve(), and therefore the smallest pad any field may
 * have — enforced in the constructor, not asked of the callers.
 *
 * carve() blends over every edge whose shoulder covers the point, and it stops looking at
 * `half + verge * 2.6 + 60`, which is 77.8 m for the widest arterial. A field built with a
 * smaller pad than that can be missing a road that the carve at its own boundary depends on,
 * and then carve() — and with it Terrain.height() — is once again a function of the box you
 * asked about rather than of the world. There are eight call sites building fields with
 * eight different pads (chunk.js, terrain.js x3, props.js, scatter.js, grass.js, the road
 * ribbon), three of them below 80; a floor here is the only place that fixes all of them at
 * once. Costs nothing measurable now that edge geometry is cached.
 */
const CARVE_REACH = 80;

const PROFILE_CAP = 4096;
/** key -> { y, water, land } straight out of profileEdge */
const RAW = new Map();
/** key -> Float32Array, levelled against arterials only */
const LVL1 = new Map();
/** key -> { y, water }, the final canonical profile */
const LVL2 = new Map();

function cacheSet(map, key, v) {
  if (map.size >= PROFILE_CAP) map.clear();
  map.set(key, v);
  return v;
}

/**
 * THE elevation of one edge, applied to it: profiled, pinned to its junctions and levelled
 * against everything that crosses it, exactly as a RoadField would give it.
 *
 * For code that needs a road's height without wanting a whole field — world/props.js puts a
 * petrol-station forecourt on an arterial, and it used to profile a private copy precisely
 * BECAUSE a RoadField's `y` was not a function of the edge alone. It is now, so the private
 * copy is not just unnecessary, it is a second opinion about where the road is, which is the
 * one thing this file no longer allows.
 */
export function edgeProfile(e, seed, landHeight, waterAt = null) {
  const p = canonicalProfile(e, worldTag(seed, landHeight, waterAt), seed, landHeight, waterAt);
  e.y.set(p.y);
  e.water.set(p.water);
  return e;
}

/**
 * What the cached heights were computed FROM, as one short string.
 *
 * The profile caches hold metres, so they are only valid while the height field itself is
 * unchanged — and the terrain preset mutates that field in place (game/presets.js
 * applyTerrain rewrites BIOME_TERRAIN, world/biomes.js setBiomeBias, landmarks.js
 * setLandmarkScale), including inside the chunk worker, which re-applies it on every job.
 * A "bump a counter in every setter" scheme would therefore invalidate the cache once per
 * chunk, and would silently rot the moment someone added a sixth knob. Fingerprinting the
 * field itself cannot rot: two land samples, taken ONCE per RoadField rather than per edge,
 * so the cost is two height evaluations against a build that already costs milliseconds.
 */
function worldTag(seed, land, waterAt) {
  return `${seed}|${waterAt ? 'w' : 'd'}|${Math.round(land(0, 0) * 64)}|${Math.round(land(1237.5, -911.25) * 64)}`;
}

const keyOrder = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function rawProfile(e, tag, seed, land, waterAt) {
  const k = `${tag}:${e.key}`;
  const hit = RAW.get(k);
  if (hit) return hit;
  profileEdge(e, land, waterAt, seed, tag);
  return cacheSet(RAW, k, {
    y: Float32Array.from(e.y),
    water: Float32Array.from(e.water),
    land: Float32Array.from(e.land),
  });
}

function applyRaw(e, p) {
  e.y.set(p.y);
  e.water.set(p.water);
  e.land = p.land;
}

/** A private copy of an edge that shares its (immutable) geometry but owns its heights. */
function workEdge(e, raw) {
  const w = edgeFrom(e);
  w.y.set(raw.y);
  w.water.set(raw.water);
  // levelAgainst caps its corrections against this, so it has to be here, not null.
  w.land = raw.land;
  return w;
}

/**
 * Every edge that could cross this one, in key order, with no heights on it yet.
 *
 * The box is the EDGE's own bounds — that is the whole trick. Two samplers asking about the
 * same edge ask the same question and get the same list. The heights are left to the caller
 * because a profile is forty land-and-water samples and most of this list is not used: an
 * edge yields only to the arterials and to the lanes whose key sorts before its own.
 */
function partnersOf(e, seed) {
  const list = edgesInBox(e.minX, e.minZ, e.maxX, e.maxZ, seed, CROSS_PAD);
  const out = [];
  for (const o of list) if (o.key !== e.key) out.push(o);
  out.sort(keyOrder);
  return out;
}

/**
 * Levelled against the arterials that cross it, each at its RAW height. Final for arterials,
 * which are never moved by anything.
 *
 * Letting arterials level against each other was tried and is in the git history of this
 * comment for a reason: two arterials SHARE their end node, and each smooths its own profile
 * over its own kilometre of ground, so at a pass one arrives 18 m below the land and the
 * other 18 m above it. Levelling that pair moved every arterial in a 4 km square, by up to
 * 36 m, and put a 134% gradient on the trunk network where tools/diag-relief.mjs had been
 * reading 24%. The disagreement is real and worth fixing one day — at the source, with a
 * node height that both edges are pinned to — but it is not a levelling problem.
 */
function level1(e, tag, seed, land, waterAt) {
  if (e.tier === 0) return rawProfile(e, tag, seed, land, waterAt).y;
  const k = `${tag}:${e.key}`;
  const hit = LVL1.get(k);
  if (hit) return hit;
  const raw = rawProfile(e, tag, seed, land, waterAt);
  const work = workEdge(e, raw);
  const arts = partnersOf(e, seed).filter((o) => o.tier === 0);
  for (const o of arts) applyRaw(o, rawProfile(o, tag, seed, land, waterAt));
  levelAgainst(work, arts, arts.length);
  return cacheSet(LVL1, k, work.y);
}

/**
 * THE road elevation. Pure in (seed, edge key, height field) — assert that and the ribbon,
 * the chunk mesh and the car's wheels can no longer disagree about where the road is.
 */
function canonicalProfile(e, tag, seed, land, waterAt) {
  const k = `${tag}:${e.key}`;
  const hit = LVL2.get(k);
  if (hit) return hit;
  const raw = rawProfile(e, tag, seed, land, waterAt);
  if (e.tier === 0) return cacheSet(LVL2, k, { y: raw.y, water: raw.water });

  const arts = [];
  const lanes = [];
  for (const o of partnersOf(e, seed)) {
    if (o.tier === 0) arts.push(o);
    // "Outranks" is the same stable key order the old two-pass code used: arbitrary, but
    // CONSISTENT, which is what stops A pulling B while B pulls A and the pair oscillating.
    else if (o.key < e.key) lanes.push(o);
  }

  const work = workEdge(e, raw);
  for (const o of arts) applyRaw(o, rawProfile(o, tag, seed, land, waterAt));
  levelAgainst(work, arts, arts.length);
  cacheSet(LVL1, k, Float32Array.from(work.y));
  // Each outranking lane at ITS OWN level-1 height. One hop, and no further: that bound is
  // the difference between an answer and the unbounded chain the old code had.
  for (const o of lanes) o.y.set(level1(o, tag, seed, land, waterAt));
  levelAgainst(work, lanes, lanes.length);

  /* Floors last, and both of them. levelCrossings runs after profileEdge's earthwork clamp,
   * so a correction that meets a road in a valley can leave the lane far outside the 18 m
   * budget the carve's batter is sized for; and a lane pulled down over water can end up
   * under it. Every other constraint here has a tolerance — "the road is under the lake"
   * does not. */
  const y = work.y;
  const wl = raw.water;
  const ld = raw.land;
  for (let i = 0; i < y.length; i++) {
    const d = y[i] - ld[i];
    if (d > MAX_EARTHWORK) y[i] = ld[i] + MAX_EARTHWORK;
    else if (d < -MAX_EARTHWORK) y[i] = ld[i] - MAX_EARTHWORK;
    if (y[i] < wl[i]) y[i] = wl[i];
  }
  return cacheSet(LVL2, k, { y, water: wl });
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
    this.edges = edgesInBox(x0, z0, x1, z1, seed, Math.max(pad, CARVE_REACH));
    this.seed = seed;
    this._land = landHeight;
    const tag = worldTag(seed, landHeight, waterAt);
    for (const e of this.edges) {
      const p = canonicalProfile(e, tag, seed, landHeight, waterAt);
      e.y.set(p.y);
      e.water.set(p.water);
    }
  }

  /**
   * A field covering ONE edge from end to end, for anything that has to know the carved
   * ground along a whole road rather than around a point — the visible ribbon, above all.
   *
   * A ribbon is built for the entire edge at once and an arterial is over two kilometres
   * long, so most of it lies outside whatever window asked for it. Carving it against the
   * window's edge list left the far end blending over an incomplete set of neighbours and
   * put the tarmac 18 m off the ground there. Like the levelling, the answer has to be a
   * property of the edge.
   */
  static forEdge(edge, seed, landHeight, waterAt = null) {
    return new RoadField(edge.minX, edge.minZ, edge.maxX, edge.maxZ, seed, landHeight, CARVE_REACH, waterAt);
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
      const blk = e.blk;
      for (let g = 0; g < blk.length; g += 4) {
        // Pruned against the best distance found ANYWHERE so far, not just on this edge.
        if (blockDist2(blk, g, x, z) >= bd * bd) continue;
        const k0 = (g >> 2) * BLK;
        const k1 = Math.min(e.segs, k0 + BLK);
        for (let k = k0; k < k1; k++) {
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
  carve(x, z, out = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0, land: NaN }) {
    let wSum = 0;
    let ySum = 0;
    let widthSum = 0;
    let cover = 0;
    let edgeMax = 0;
    let bd = Infinity;
    let bt = 0,
      btx = 1,
      btz = 0;
    /* The raw land here, evaluated at most ONCE and only if some edge actually needs it.
     * It used to be sampled inside the per-edge loop, so a point near a junction paid for
     * the same biome-and-relief evaluation three times — and it is the single most expensive
     * thing in this function at 3.6 µs against 5.0 µs for the whole call. NaN is the "not
     * yet" marker because a height of 0 is a perfectly ordinary answer. */
    let landH = NaN;

    for (const e of this.edges) {
      const half = e.width * 0.5;
      // The widest this edge could possibly reach: its shoulder grows with how far the road
      // sits above or below the land, and 60 m covers the tallest embankment the smoothing
      // can produce.
      const reach = half + e.verge * 2.6 + 60;
      if (x < e.minX - reach || x > e.maxX + reach || z < e.minZ - reach || z > e.maxZ + reach) continue;

      const pts = e.pts;
      const blk = e.blk;
      let ed = Infinity;
      let ey = 0;
      let etx = 1,
        etz = 0;
      // Anything past `reach` is thrown away below anyway, so start the block cut-off there.
      let bound2 = reach * reach;
      for (let g = 0; g < blk.length; g += 4) {
        if (blockDist2(blk, g, x, z) >= bound2) continue;
        const k0 = (g >> 2) * BLK;
        const k1 = Math.min(e.segs, k0 + BLK);
        for (let k = k0; k < k1; k++) {
          const ax = pts[k * 2],
            az = pts[k * 2 + 1];
          const bx = pts[k * 2 + 2],
            bz = pts[k * 2 + 3];
          const r = segDist(x, z, ax, az, bx, bz);
          if (r.d < ed) {
            ed = r.d;
            bound2 = ed * ed;
            ey = lerp(e.y[k], e.y[k + 1], r.t);
            const dx = bx - ax,
              dz = bz - az;
            const l = Math.hypot(dx, dz) || 1;
            etx = dx / l;
            etz = dz / l;
          }
        }
      }
      if (ed > reach) continue;

      /* Nearest-edge bookkeeping (bd/bt/btx/btz — groundFromCarve reads bd straight off `out.d`
       * for the batter shoulder) has to happen for every edge that clears `reach`, BEFORE the
       * weight threshold below can `continue` past it. It used to sit after that continue, so
       * the edge that is geometrically closest — and is exactly what a point on its shoulder,
       * away from every OTHER road, wants for its batter — could drop out of the running the
       * moment its own blend weight dipped under 0.0005, and `d` would jump to whatever edge
       * was next, tens of metres further out. Measured over the alpine preset that was worth
       * an 18 m step in Terrain.height() 2 cm away, dwarfing the width/edge cliffs this
       * function was already rewritten to remove. A weight near zero barely moves wSum/ySum
       * either way, so gating the BLEND on it is fine; gating WHICH EDGE IS NEAREST on it is
       * not — those are different questions and only one of them cares about the threshold. */
      if (ed < bd) {
        bd = ed;
        bt = e.tier;
        btx = etx;
        btz = etz;
      }

      /* Shoulder width scales with the height difference this edge is asking for, so an
       * embankment is battered at about 1:1.5 and never becomes a wall.
       *
       * Inside the carriageway there is no batter yet — smoothstep(half, shoulder, ed) is
       * identically zero for ed <= half whatever the shoulder works out to — so the weight
       * is exactly 1 and the land sample that only feeds the shoulder is not needed. That is
       * not an approximation, it is the same number by a shorter route, and it is the whole
       * population of points the road ribbon asks about. */
      let w = 1;
      if (ed > half) {
        if (landH !== landH) landH = this._land(x, z);
        const drop = Math.abs(ey - landH);
        const shoulder = half + 3.0 + Math.min(drop, MAX_EARTHWORK + 4) * 1.6;
        w = 1 - smoothstep(half, shoulder, ed);
        if (w <= 0.0005) continue;
      }

      wSum += w;
      ySum += w * ey;
      // Same weight as y: a narrow lane and a wide arterial with near-equal claims on this
      // point blend their WIDTH too, so the batter's half-width (groundFromCarve) and the
      // camber's half-width (roadCamber) can never step just because the nearest edge flipped
      // from one to the other — that flip is exactly where every 0.5 m cliff under a road
      // measured out to.
      widthSum += w * e.width;
      cover = Math.max(cover, w);
      // "Am I on SOME carriageway" is a max over edges, not a property of whichever is
      // nearest — max of continuous functions is continuous, nearest-edge selection is not.
      const edgeHere = 1 - smoothstep(half - 0.4, half + 0.35, ed);
      if (edgeHere > edgeMax) edgeMax = edgeHere;
    }

    out.d = bd;
    out.tier = bt;
    out.tx = btx;
    out.tz = btz;
    out.width = wSum > 1e-6 ? widthSum / wSum : 0;
    out.mask = cover;
    out.edge = edgeMax;
    out.y = wSum > 1e-6 ? ySum / wSum : 0;
    /* The raw land, if this call happened to need it, and NaN if it did not. Handed out so a
     * caller that has to reproduce Terrain.height() — the road ribbon does — can finish the
     * job without paying for a second land sample. It is only ever NaN when every
     * contributing road had the point INSIDE its carriageway, and that is exactly the case
     * where the land drops out of the formula anyway (the batter is 1, the ground is the
     * road). Anything else and the nearest edge itself took the shoulder branch above. */
    out.land = landH;
    return out;
  }
}

/**
 * The crown-to-gutter fall the ground is given under a road, in metres, from one carve
 * sample. About 18 cm across the carriageway, so water would run off it — and it is also
 * what makes a road read as a made surface rather than a painted stripe.
 *
 * It is its own function, rather than four lines inline, because Terrain.height() needs it
 * on two paths — the full formula and the carriageway shortcut — and a second copy of the
 * 0.18 is exactly how the visible road and the drivable one drifted apart in the first
 * place. render/road.js used to keep one. It does not any more.
 */
export function roadCamber(c) {
  if (c.edge <= 0.001) return 0;
  const half = c.width * 0.5;
  const across = clamp01(half > 0 ? c.d / half : 0);
  return c.edge * across * across * 0.18;
}

/**
 * Pull one lane onto the roads that cross it, so a junction is one surface.
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
 *
 * WHO `others` IS MATTERS MORE THAN WHAT THIS FUNCTION DOES. See canonicalProfile: the list
 * is derived from the lane's own bounds and never from a caller's query box, which is what
 * makes the result a property of the world instead of of the question.
 */
function levelAgainst(lane, others, count) {
  if (!count) return;

  /* Which of `others` could touch this lane at all? One box test each, hoisted out of the
   * per-point loop. It used to sit inside it, so the test ran (points x others) times per
   * lane; sampling the roads three times finer to make them curve would have made the hottest
   * loop in the build three times hotter for no extra information. */
  const _near = [];
  let nn = 0;
  for (let a = 0; a < count; a++) {
    const o = others[a];
    const reach = o.width * 0.5 + 14;
    if (lane.maxX < o.minX - reach || lane.minX > o.maxX + reach) continue;
    if (lane.maxZ < o.minZ - reach || lane.minZ > o.maxZ + reach) continue;
    _near[nn++] = o;
  }
  if (!nn) return;

  const n = lane.y.length;
  // Pass 1: find every point of this lane that sits on another road, and by how much it is
  // out. Feathering happens in pass 2 so one crossing cannot undo another.
  const fix = new Float32Array(n);
  const weight = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const x = lane.pts[k * 2];
    const z = lane.pts[k * 2 + 1];
    let bestD = Infinity;
    let bestY = 0;
    for (let ai = 0; ai < nn; ai++) {
      const a = _near[ai];
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
      /* Meet the other road, but never ask the land for more earthwork than profileEdge was
       * allowed to. A lane crossing an arterial that runs 40 m lower in a valley used to be
       * dragged the whole way down, ending up so far from the ground that the carve built a
       * 30 m embankment to reach it. Capping the TARGET here rather than clamping the RESULT
       * afterwards matters: a clamp applied after the feather puts a step in the profile
       * between one sample and the next, which is a wall, not a road. */
      const ld = lane.land ? lane.land[k] : lane.y[k];
      const tgt = clamp(bestY, ld - MAX_EARTHWORK, ld + MAX_EARTHWORK);
      fix[k] = tgt - lane.y[k];
      weight[k] = w;
    }
  }

  /* Pass 2: apply, then feather the correction into the neighbouring points so the lane ramps
   * up to the junction instead of stepping at it. The ramp is a LENGTH — about 85 m of lane,
   * which is what the old fixed three passes reached at the old spacing — so the pass count
   * follows the sample spacing for the same reason profileEdge's does. */
  const delta = new Float32Array(n);
  for (let k = 0; k < n; k++) delta[k] = fix[k] * weight[k];
  const smooth = new Float32Array(n);
  const passes = passesFor(85, lane.span, 0.3);
  for (let pass = 0; pass < passes; pass++) {
    for (let k = 0; k < n; k++) {
      const a = delta[k > 0 ? k - 1 : 0];
      const b = delta[k];
      const c = delta[k < n - 1 ? k + 1 : n - 1];
      // Never smooth AWAY a correction at a crossing — the junction itself must stay exact.
      smooth[k] = weight[k] > 0.75 ? b : a * 0.3 + b * 0.4 + c * 0.3;
    }
    delta.set(smooth);
  }
  for (let k = 0; k < n; k++) lane.y[k] += delta[k];
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
