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

import { hash2i, clamp, smoothstep, lerp, segDist, TAU } from '../core/math.js';

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
 * A single edge, sampled into a polyline. `pts` is [x0,z0,x1,z1,...]; `y` is filled later
 * by the caller from the raw land height, then smoothed.
 */
function buildEdge(i, j, dir, tier, seed) {
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
  return {
    tier,
    pts,
    y: new Float32Array(n + 1),
    // water surface under each sample, -Infinity where the ground is dry. Filled by
    // profileEdge and kept, because working it out is as expensive as a height sample.
    water: new Float32Array(n + 1),
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
 */
export function edgesInBox(x0, z0, x1, z1, seed, pad = 40) {
  const out = [];
  for (let tier = 0; tier < TIERS.length; tier++) {
    const T = TIERS[tier];
    /* The furthest an edge that STARTS in cell (i,j) can get from that cell's centre. Its far
     * node is a cell away plus the jitter; the hermite bulges off the chord by up to 4/27 of
     * each tangent; the winding swings on top of that. Under-reaching here does not cost time,
     * it loses whole roads at a chunk boundary, so this is generous on purpose. */
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
        // e.water already carries the 1.1 m of freeboard, and is dry-safe (-Infinity).
        for (let k = 0; k < e.y.length; k++) if (e.y[k] < e.water[k]) e.y[k] = e.water[k];
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

  for (const lane of lanes) levelAgainst(lane, arterials, arterials.length);
  // Each lane now yields to every lane ahead of it in the stable order.
  for (let i = 1; i < lanes.length; i++) levelAgainst(lanes[i], lanes, i);
}

/* Scratch for the shortlist below — reused, because levelAgainst runs once per PAIR of lanes
 * and a few hundred lanes in an 8 km field is tens of thousands of calls. */
const _near = [];

function levelAgainst(lane, others, count) {
  if (!count) return;

  /* Which of `others` could touch this lane at all? One box test each, hoisted out of the
   * per-point loop. It used to sit inside it, so the test ran (points x others) times per
   * lane; sampling the roads three times finer to make them curve would have made the hottest
   * loop in the build three times hotter for no extra information. */
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
      fix[k] = bestY - lane.y[k];
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
