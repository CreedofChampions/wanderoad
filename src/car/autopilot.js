/* Wanderoad — auto-drive.
 *
 * Hands off the wheel and the car keeps going. This is the single feature the operator
 * picked out of Slow Roads, and it is the most cozy thing a driving game can offer: you stop
 * driving and start looking out of the window.
 *
 * Nothing about it is a cheat: it only produces the same steer, throttle and brake numbers a
 * player's keyboard would, and it obeys the same tyres, the same grip and the same brakes. If
 * the autopilot cannot get round a corner, neither could you. It gives up the moment you touch
 * anything, because an assist you have to fight is worse than no assist at all.
 *
 * ── what it does, and why it is not the Stanley controller it used to be ──────────────────
 *
 * It used to steer off two numbers taken straight from `roads.query(car.x, car.z)`: the
 * heading error against that query's tangent, and the distance to its centreline. That worked
 * while the roads were nearly straight and it fell apart the moment they curved, for two
 * reasons that are both about the QUERY rather than about the control law:
 *
 *   1. `query` returns the tangent of the nearest SEGMENT, and a road's polyline samples are
 *      19 m apart on a lane and 38 m on an arterial. So the reference heading is a staircase:
 *      it is constant for two seconds and then steps by the whole of that segment's turn —
 *      12° in one frame, measured. The controller saw that step as a sudden heading error and
 *      answered it with a stab of lock. That is the sawing, and on a real bend it is also
 *      most of the drift, because the correction always arrives one segment late.
 *   2. `query` returns the nearest road, and near a crossing the nearest road CHANGES. Traced
 *      on seed 20260726 the reference flipped to a road of a different width mid-corner, the
 *      heading error jumped 23°, the controller went to full lock to line up with a road the
 *      car was not on, and drove off the one it was on. (cinematic.js rejects the same false
 *      reading when it walks the road backwards — see the note there.)
 *
 * So this no longer asks the world "what is the nearest road?" every frame. It LATCHES onto
 * one edge and follows that edge's own polyline until it genuinely ends or genuinely is not
 * underneath the car any more, and it never adopts a road whose direction it could not be
 * driving down. A crossing lane cannot be picked up by accident, which makes point 2
 * impossible rather than merely unlikely.
 *
 * Along that latched edge it builds a heading that varies CONTINUOUSLY with arc length
 * (anchored at each segment's midpoint, linear in between), which removes the staircase, and
 * differentiating it gives the curvature — the thing the old controller had no idea about.
 * With curvature in hand the law is the textbook one:
 *
 *     steer angle = atan(L·κ)                     lean into the bend that is there
 *                 + atan(L·a/v²),  a = −ω²·e + 2ζω·v·ψ    hold the line against the bend
 *
 * The first term is what makes it a corner rather than a series of corrections. The second is
 * a critically-damped second-order loop on the lateral error, so ω is "how fast it pulls back
 * to the middle" in rad/s and ζ is "does it overshoot" — two numbers with meanings, instead of
 * three gains multiplied together. It is deliberately slow: ω of 0.95 rad/s takes a couple of
 * seconds to close a metre, which is what "calm" looks like from inside the car.
 *
 * THE SIGN, because this project has been bitten by it three times. three.js puts +X on your
 * LEFT looking down +Z, so `lateral` is positive when the car is LEFT of the centreline, and
 * positive steer also turns LEFT. The cross-track term therefore has to push the other way —
 * it is SUBTRACTED (it is the −ω²·e above). Measured, not reasoned: displacing the car 6 m to
 * the road's left and driving with the term added takes it to 94 m off in twelve seconds;
 * subtracted, it is back on the centreline in eight.
 *
 * ── two more things it now refuses to do ──────────────────────────────────────────────────
 *
 * Drive off the literal end of a road. The lattice hands out real dead ends on purpose — a
 * node with no qualifying link on one side is a leaf by construction, the same way any hashed
 * lattice always produces some — and that is not the bug. The bug the operator caught was what
 * autopilot did about it: a screenshot showed a road stopping in open ground for no visible
 * reason, and the car kept going straight past the last vertex and out into the field, because
 * `headAt()` holds the heading flat past the end of a chain on purpose (a dead end must not
 * read as a phantom hairpin) and nothing was reading "the chain stopped because there was
 * nothing left to chain" as anything different from "the chain stopped because we already
 * planned far enough ahead". `_horizon()` now tells those two apart — see its `deadEnd` — and
 * the speed plan brakes for a real stop against the one that means the road is actually
 * finishing, well before the reactive lost-the-road check below would ever notice, which by
 * definition only fires once the car is already off the tarmac.
 *
 * Sit wedged against something forever. If the speed stays near enough to zero for long enough
 * while this is still switched on — nose against a rock, hung up on a verge, anything that
 * physically pins it — it resets to the nearest road exactly the way R does, by calling the
 * SAME recover() function the R key and the water rescue both call (see rescue.js's own
 * `recover` constructor option). One function, so R, the water and this can never disagree
 * about where "the road" is.
 */

import { angleDelta, clamp, clamp01 } from '../core/math.js';

/* ── the lateral loop ──────────────────────────────────────────────────────
 * Treat "get back to the middle of the road" as a second-order system in the lateral error
 * and pick its natural frequency directly. 0.95 rad/s is a ~6 s round trip; ζ above 1 means
 * it never comes back through the middle and out the other side, which is the weave. */
const OMEGA = 0.95;
const ZETA = 1.15;
/** The most lateral acceleration the CORRECTION may ask for, m/s². The car has 8.4 available;
 *  spending half of it to fix a wandering line would be felt as a swerve. */
const LAT_BUDGET = 4.2;
/** Seconds the dead-end recover is held off after firing — long enough for the car to be
 *  moving again down the road it was just turned onto. */
const DEAD_END_RECOVER_COOLDOWN = 3.0;
/** Lateral acceleration the autopilot PLANS corners at, m/s². 0.3 g — brisk, not sporty. */
const CORNER_G = 2.9;
/** Virtual-wheel units per second. Full lock in a third of a second is quick for a road car
 *  and slow enough that nothing it does reads as a twitch. */
const SLEW = 3.2;
/** Never plan slower than this, m/s. The streak stops accruing at 8, so a chauffeur that
 *  crawls under it is a chauffeur who quietly cancels your run. Overridden by the dead-end
 *  stop below, on purpose — the one time this chauffeur is allowed to plan slower than a
 *  crawl is the run actually ending. */
const CRAWL = 9;

/* ── dead end ahead ────────────────────────────────────────────────────────
 * Edges in this network run from one lattice node to the next — hundreds of metres at both
 * tiers (TIERS.cell is 620 m and 1800 m in src/world/roads.js) — so a dead end is visible on
 * `h0`, the current edge alone, long before any braking distance below gets tight. The margin
 * and deceleration only have to cover the rare case of a short final stub. */
/** Metres short of the road's literal last vertex the plan aims to already be stopped by —
 *  room to halt with the car still on the tarmac, not with the bumper hanging over the edge.
 *  A bit more than one car length. */
const DEAD_END_MARGIN = 6;
/** The deceleration the dead-end stop plans around, m/s² (0.35 g) — firm enough to actually
 *  stop inside a normal edge's length, gentle enough to read as "slowing for the end of the
 *  road" and not a stamp on the brake pedal. If the plan turns out optimistic the live
 *  throttle/brake loop below leans on it harder by itself, the same way it already does for a
 *  corner that arrives tighter than kMax predicted — this is not the only thing standing
 *  between the car and open ground. */
const DEAD_END_DECEL = 3.4;

/* ── stuck detector ────────────────────────────────────────────────────────
 * CRAWL is 9 m/s and is the slowest speed anything above ever asks the plan for on purpose
 * (the dead-end stop is the one deliberate exception, and it hands control back or resets the
 * instant it finishes — see below), so real, working autopilot driving never spends long under
 * STUCK_SPEED. When it does anyway, something is physically stopping the car: wedged on a rock,
 * hung up on a verge, nose against a fence. */
/** Metres/second below which the car counts as "not moving" for the stuck detector. */
const STUCK_SPEED = 0.5;
/** Seconds of that before the stuck detector resets the car to the road. Deliberately shorter
 *  than the lost-road brake's own 4 s timeout just below, so the one case they overlap — off
 *  the network AND already stationary, i.e. actually wedged somewhere off-road rather than
 *  coasting away from it — resolves through the better of the two: reset and carry on, instead
 *  of coasting for the rest of those 4 s and then handing manual control back in whatever field
 *  the car had stopped in. */
const STUCK_TIMEOUT = 3.5;

/* ── the road as a path ────────────────────────────────────────────────────
 * Everything above needs arc length, a continuous heading and a curvature, and a road edge
 * carries none of them — it is a polyline and a height array. Derive them once per edge and
 * keep them on a WeakMap, because the edges are rebuilt with the terrain field every few
 * hundred metres and anything holding them strongly would leak a road network per rebuild.
 */
const PATHS = new WeakMap();

function pathOf(edge) {
  const cached = PATHS.get(edge);
  if (cached) return cached;
  const n = edge.segs;
  const pts = edge.pts;
  const len = new Float64Array(n);
  const cum = new Float64Array(n + 1);
  const th = new Float64Array(n); // absolute heading of each segment, UNWRAPPED
  const mid = new Float64Array(n); // arc length at each segment's midpoint
  let prev = 0;
  for (let k = 0; k < n; k++) {
    const dx = pts[k * 2 + 2] - pts[k * 2];
    const dz = pts[k * 2 + 3] - pts[k * 2 + 1];
    const l = Math.hypot(dx, dz) || 1e-6;
    len[k] = l;
    cum[k + 1] = cum[k] + l;
    mid[k] = cum[k] + l * 0.5;
    const a = Math.atan2(dx, dz);
    th[k] = prev = k ? prev + angleDelta(prev, a) : a;
  }
  const p = { n, len, cum, th, mid, total: cum[n] };
  PATHS.set(edge, p);
  return p;
}

/**
 * The road that carries on where this one stops.
 *
 * Without this the world ends at every node: the heading below reads STRAIGHT past the last
 * anchor of an edge, so a bend that starts just after a junction is invisible, the lean-in is
 * zero and the corner-speed plan sees an open road. Measured on seed 20260726 that is exactly
 * how the one remaining failure happened — the car crossed a node at 66 km/h into a bend it
 * had not been told about, ran to 16° of slip and left the carriageway.
 *
 * Roads share their node positions exactly (the winding has zero offset at both ends, and the
 * unknot pass only moves interior samples), so the continuation is whichever OTHER edge has an
 * end within a couple of metres of the one we are leaving by — and, of the ones that do, the
 * one that carries straightest on. A leg that turns off is not the road we are driving down.
 * Cached per edge and per direction: it costs one scan of the edge list, a few times a
 * kilometre, and the answer cannot change while the field lives.
 */
const NEXTS = new WeakMap();

function nextEdge(field, edge, path, dir) {
  let rec = NEXTS.get(edge);
  if (!rec) NEXTS.set(edge, (rec = {}));
  const slot = dir > 0 ? 'fwd' : 'back';
  if (slot in rec) return rec[slot];

  const n = path.n;
  const ex = dir > 0 ? edge.pts[n * 2] : edge.pts[0];
  const ez = dir > 0 ? edge.pts[n * 2 + 1] : edge.pts[1];
  const exit = dir > 0 ? path.th[n - 1] : path.th[0] + Math.PI;
  let best = null;
  let bestDot = 0.35; // anything sharper than ~70° is a turning, not a continuation
  for (const e2 of field.edges) {
    if (e2 === edge) continue;
    const m = e2.segs;
    for (let end = 0; end < 2; end++) {
      const nx = end ? e2.pts[m * 2] : e2.pts[0];
      const nz = end ? e2.pts[m * 2 + 1] : e2.pts[1];
      // Cheap first: four compares against the raw polyline. Deriving a path for every edge in
      // the field to answer "does it start here?" would be a few hundred needless array builds.
      if (Math.abs(nx - ex) > 2 || Math.abs(nz - ez) > 2) continue;
      const p2 = pathOf(e2);
      // Entering by its last vertex means driving it backwards.
      const d2 = end ? -1 : 1;
      const entry = d2 > 0 ? p2.th[0] : p2.th[m - 1] + Math.PI;
      const dot = Math.cos(entry - exit);
      if (dot > bestDot) {
        bestDot = dot;
        best = { edge: e2, path: p2, dir: d2 };
      }
    }
  }
  rec[slot] = best;
  return best;
}

/**
 * The road's heading at arc length `s`, varying continuously.
 *
 * A polyline's heading is a staircase — constant along a segment, stepping at every vertex —
 * and feeding a staircase to a steering controller is what made it saw. Anchoring each
 * segment's heading at that segment's MIDPOINT and going linearly between the anchors makes
 * the heading continuous, puts each vertex's turn exactly where the road turns, and makes the
 * derivative of this function the road's curvature.
 *
 * The two STUBS — the half-segment before the first anchor and after the last — carry on at
 * the curvature of the segment they belong to rather than going flat. On an arterial a segment
 * is 38 m long, so a flat stub is 19 m of road that bends while the controller is told it does
 * not, twice per edge, and both of those 19 m sit right at a junction where the car is also
 * changing which edge it follows. Traced on seed 20260726 that is worth 3 m of line by the
 * time the node arrives, which is most of a lane before the next bend has even started. The
 * extrapolation is bounded to the stub, so past the end of an edge the road still reads
 * straight and no phantom hairpin is invented beyond a dead end.
 */
function headingAt(p, s) {
  const n = p.n;
  if (n < 2) return p.th[0];
  if (s <= p.mid[0]) {
    const g = (p.th[1] - p.th[0]) / (p.mid[1] - p.mid[0] || 1);
    return p.th[0] - g * Math.min(p.mid[0] - s, p.mid[0]);
  }
  if (s >= p.mid[n - 1]) {
    const g = (p.th[n - 1] - p.th[n - 2]) / (p.mid[n - 1] - p.mid[n - 2] || 1);
    return p.th[n - 1] + g * Math.min(s - p.mid[n - 1], p.total - p.mid[n - 1]);
  }
  let k = 1;
  while (k < n - 1 && p.mid[k] < s) k++;
  const span = p.mid[k] - p.mid[k - 1] || 1;
  return p.th[k - 1] + (p.th[k] - p.th[k - 1]) * ((s - p.mid[k - 1]) / span);
}

/** Closest point on an edge to (x, z), in arc length. */
function locate(edge, p, x, z) {
  const pts = edge.pts;
  let bd2 = Infinity;
  let bs = 0;
  let bx = pts[0];
  let bz = pts[1];
  for (let k = 0; k < p.n; k++) {
    const ax = pts[k * 2];
    const az = pts[k * 2 + 1];
    const dx = pts[k * 2 + 2] - ax;
    const dz = pts[k * 2 + 3] - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const ex = x - cx;
    const ez = z - cz;
    const d2 = ex * ex + ez * ez;
    if (d2 < bd2) {
      bd2 = d2;
      bs = p.cum[k] + p.len[k] * t;
      bx = cx;
      bz = cz;
    }
  }
  return { s: bs, d: Math.sqrt(bd2), x: bx, z: bz };
}

/** Heading of a single hop `u` metres in from where we joined it, before the chain offset. */
function rawHead(hop, u) {
  return hop.dir > 0 ? headingAt(hop.path, hop.from + u) : headingAt(hop.path, hop.from - u) + Math.PI;
}

/**
 * The direction the ROAD points `u` metres ahead of the car, across as many edges as it takes.
 *
 * `base` on each hop is set so the chain is continuous at every join, which means this is a
 * heading you may subtract from another heading and get a real turn, and divide by distance
 * and get a real curvature. Past the end of the last hop it holds flat: no continuation found
 * is not the same as a hairpin, and guessing one would brake for nothing.
 */
function headAt(hops, n, u) {
  for (let i = 0; i < n; i++) {
    const h = hops[i];
    const local = u - h.start;
    if (local <= h.len || i === n - 1) return rawHead(h, local < 0 ? 0 : local > h.len ? h.len : local) + h.base;
  }
  return 0;
}

export class Autopilot {
  /**
   * @param {number} [opts.cruise] m/s the autopilot aims for on an open road
   * @param {Function} [opts.recover] called to reset the car onto the nearest road when the
   *        stuck detector fires — main.js hands this the same backToRoad() the R key and
   *        rescue.js's water rescue both call, so where any of the three puts you cannot drift
   *        apart. Optional: without one, a stuck car falls back to handing control back the
   *        way the lost-road brake already does, rather than sitting stuck forever.
   * @param {Function} [opts.say] one short line of HUD text — same shape as rescue.js's `say`.
   * @param {Function} [opts.ping] a short audio cue, called once the moment autopilot switches
   *        ON. Never called on the way off, and never called from anywhere but toggle().
   */
  constructor({ cruise = 16, recover = null, say = null, ping = null } = {}) {
    this.on = false;
    this.cruise = cruise; // m/s the autopilot aims for on an open road
    this.recover = recover;
    this.say = say;
    this.ping = ping;
    this.lastReason = '';
    this._lostFor = 0;
    this._stuckFor = 0; // seconds spent near-motionless while switched on — see STUCK_TIMEOUT
    this._steer = 0; // the wheel as commanded, so it can be slew-limited
    this._field = null; // the road field the latched edge belongs to
    this._edge = null; // the edge we are following
    this._key = ''; // ...by name, because the field is rebuilt as you drive
    this._dir = 1; // which way along that edge we are driving, with hysteresis
    this._deadEnd = false; // does the latched chain end in a confirmed dead end this frame?
    /** Seconds left before the dead-end R press may fire again. See the dead-end block in
     *  update(): without it the reset would re-fire every frame the car is still slow. */
    this._deadFired = 0;
    this._deadAhead = Infinity; // metres to it, if so — see _horizon()
    /* The road ahead, as up to three edges chained end to end. Preallocated and refilled in
     * place: this runs inside the physics loop and the vehicle next door counts its garbage. */
    this._hops = [
      { path: null, dir: 1, from: 0, len: 0, base: 0, start: 0 },
      { path: null, dir: 1, from: 0, len: 0, base: 0, start: 0 },
      { path: null, dir: 1, from: 0, len: 0, base: 0, start: 0 },
    ];
    this._nHops = 0;
    /* What it decided and why, rewritten in place every frame. There is no other way to see
     * inside this without a browser and a running game, and every round of debugging it has
     * needed so far has been a round of guessing at the numbers from outside. Read-only. */
    this.tel = {
      lateral: 0, err: 0, kappa: 0, kMax: 0, target: 0, delta: 0, maxA: 0, hops: 0, road: '',
      deadEnd: false, deadAhead: Infinity, stuckFor: 0,
    };
  }

  toggle(car) {
    this.on = !this.on;
    this._lostFor = 0;
    this._stuckFor = 0;
    this._steer = car?.steer || 0;
    this._edge = null;
    this._key = '';
    this._field = null;
    this._dir = 1;
    this._deadEnd = false;
    this._deadAhead = Infinity;
    if (this.on) {
      this.cruise = Math.max(11, Math.min(Math.abs(car?.speed || 0) || 16, 22));
      // Once per activation, never on the way off — a short cue that the wheel just let go,
      // additional to (never instead of) the HUD toast main.js already shows for this.
      this.ping?.();
    }
    return this.on;
  }

  off(reason = '') {
    if (!this.on) return false;
    this.on = false;
    this.lastReason = reason;
    return true;
  }

  /**
   * The edge we are following, its derived path, and where we are on it.
   *
   * Latched: an edge is kept until it stops being under the car or we reach its end, and a
   * replacement is only accepted if we could plausibly be driving down it. That last test is
   * the whole defence against a crossing lane stealing the reference mid-corner.
   */
  _track(field, x, z, fx, fz) {
    if (field !== this._field) {
      // The terrain rebuilds every few hundred metres and hands out fresh edge objects. Same
      // road, same deterministic key, new object — so re-find it rather than dropping the
      // latch, which would put us right back to trusting whatever is nearest.
      this._field = field;
      this._edge = this._key ? field.edges.find((e) => e.key === this._key) || null : null;
    }
    let edge = this._edge;
    let path = edge ? pathOf(edge) : null;
    let at = edge ? locate(edge, path, x, z) : null;
    const usable = at && at.d < edge.width * 0.5 + edge.verge + 8 && at.s > 0.5 && at.s < path.total - 0.5;
    if (usable) return { edge, path, at };

    const cand = field.query(x, z).edge;
    if (cand && cand !== edge) {
      const cp = pathOf(cand);
      const ca = locate(cand, cp, x, z);
      const ch = headingAt(cp, ca.s);
      // |alignment| because a road is two-way: what is rejected here is a road across our
      // path, not a road we happen to be driving down backwards.
      const align = Math.abs(Math.sin(ch) * fx + Math.cos(ch) * fz);
      if (align > 0.5 || !edge) {
        this._edge = edge = cand;
        this._key = cand.key;
        path = cp;
        at = ca;
      }
    }
    // If nothing aligned we keep the old edge with its projection clamped to the end, which
    // means "carry straight on through the junction" — and a moment later the road we have
    // actually driven onto is the nearest one, aligned, and gets picked up.
    return edge ? { edge, path, at } : null;
  }

  /**
   * Chain the road ahead into `this._hops` until it covers `need` metres or runs out.
   *
   * Also records WHY it stopped short, on `this._deadEnd` / `this._deadAhead` — and only one
   * reason counts as a dead end: `nextEdge()` was asked "what comes after this?" and reported
   * nothing. Running out of `hops` slots (there are 3) or already covering `need` are not that;
   * both mean "there may well be more road, we just did not need to look" and must not brake for
   * a dead end that was never confirmed. `this._deadAhead` is the arc length from the CAR (not
   * from the edge) to that confirmed end, in the same metres `plan`/`need` are measured in.
   */
  _horizon(field, edge, path, dir, s, need) {
    const hops = this._hops;
    const h0 = hops[0];
    h0.path = path;
    h0.dir = dir;
    h0.from = s;
    h0.len = Math.max(dir > 0 ? path.total - s : s, 0);
    h0.base = 0;
    h0.start = 0;
    let n = 1;
    let prev = h0;
    let prevEdge = edge;
    let deadEnd = false;
    while (n < hops.length && prev.start + prev.len < need) {
      const nx = nextEdge(field, prevEdge, prev.path, prev.dir);
      if (!nx) {
        deadEnd = true;
        break;
      }
      const h = hops[n];
      h.path = nx.path;
      h.dir = nx.dir;
      h.from = nx.dir > 0 ? 0 : nx.path.total;
      h.len = nx.path.total;
      h.start = prev.start + prev.len;
      // Join the two headings so the chain is continuous across the node.
      h.base = rawHead(prev, prev.len) + prev.base - rawHead(h, 0);
      prev = h;
      prevEdge = nx.edge;
      n++;
    }
    this._nHops = n;
    this._deadEnd = deadEnd;
    this._deadAhead = deadEnd ? prev.start + prev.len : Infinity;
    return n;
  }

  /**
   * Produce an input for this frame.
   *
   * @param {Vehicle} car
   * @param {object} manual the player's own input this frame — any of it cancels the autopilot
   * @param {number} dt seconds
   * @returns {object|null} an input object, or null when the autopilot is not driving
   */
  update(car, manual, dt) {
    if (!this.on) return null;

    // Any real input from the player hands control straight back. A nudge on the stick is a
    // nudge, not a request to be argued with.
    if (Math.abs(manual.steer) > 0.12 || manual.brake > 0.15 || manual.throttle > 0.5 || manual.handbrake > 0.1) {
      this.off('you took over');
      return null;
    }

    const terr = car.terrain;
    if (!terr || !terr.roads) return null;
    const step = Math.min(Math.max(dt, 1 / 240), 0.1);

    /* ── stuck detector ────────────────────────────────────────────────────
     * Ahead of the on-road/off-road split below on purpose: it has to catch a car wedged
     * anywhere, on the network or off it, so it cannot live inside a branch that only runs for
     * one of those. See STUCK_SPEED/STUCK_TIMEOUT above for why the threshold is safe against
     * ordinary driving and why the timeout beats the lost-road brake to the punch. */
    // Decay the dead-end R cooldown wherever the clock is already being read, so it cannot
    // drift out of step with the rest of update()'s timers.
    if (this._deadFired > 0) this._deadFired = Math.max(0, this._deadFired - step);

    if (Math.abs(car.speed) < STUCK_SPEED) {
      this._stuckFor += step;
      if (this._stuckFor > STUCK_TIMEOUT) {
        this._stuckFor = 0;
        if (this.recover) {
          this.say?.('stuck — resetting to the road', 2.4);
          this.recover();
          // The latch, the lost-road timer and the wheel all describe a car that no longer
          // exists the instant recover() moves this one — drop them so next frame re-acquires
          // fresh from wherever the car actually is now, the same way toggle() starts clean.
          this._edge = null;
          this._key = '';
          this._field = null;
          this._lostFor = 0;
          this._steer = 0;
        } else {
          // Nothing to reset to (a harness that never wired one up, say) — better to hand
          // control back, same as the lost-road path already does, than sit stuck forever.
          this.off('stuck');
        }
        return { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true, auto: true };
      }
    } else {
      this._stuckFor = 0;
    }

    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);

    const track = this._track(terr.roads, car.x, car.z, fx, fz);
    const width = track ? track.edge.width : 6;
    const away = track ? track.at.d : Infinity;
    if (!track || !isFinite(away) || away > width * 2.2 + 14) {
      /* Off the network. Coast to a stop rather than wander — the player asked for a
       * chauffeur, and a chauffeur who drives into a field is worse than one who stops. */
      this._lostFor += step;
      this._steer += clamp(-this._steer, -SLEW * step, SLEW * step);
      if (this._lostFor > 4) this.off('lost the road');
      return { steer: this._steer, throttle: 0, brake: 0.35, handbrake: 0, analogue: true, auto: true };
    }
    this._lostFor = 0;

    const { edge, path, at } = track;
    const roadH = headingAt(path, at.s);
    /* Which way along the road are we going? Whichever end of the tangent we are already
     * pointing at, so the car never decides to turn round on a road it is driving down. With a
     * deadband, because a bare sign test flips at exactly 90° — and a flip inverts the target
     * heading by 180°, which is a full-lock command for one frame. Sideways across a road is
     * the one moment that test is genuinely undecided, so it keeps its previous answer. */
    const along = Math.sin(roadH) * fx + Math.cos(roadH) * fz;
    if (along > 0.15) this._dir = 1;
    else if (along < -0.15) this._dir = -1;
    const dir = this._dir;

    const v = Math.abs(car.speed);
    const vv = Math.max(v, 4); // the law divides by speed; a stationary car is not a hazard
    const wb = car.wb || 2.7;

    /* How far ahead to plan the SPEED: far enough to slow down in. The steering only needs
     * about a second of preview, but both come off the same chain of edges, so build it once
     * to the longer of the two. */
    const plan = clamp(v * 2.4 + 30, 45, 130);
    const hops = this._hops;
    const nHops = this._horizon(terr.roads, edge, path, dir, at.s, plan);

    const travelH = headAt(hops, nHops, 0);
    const tx = Math.sin(travelH);
    const tz = Math.cos(travelH);

    // Signed distance from the centreline, POSITIVE TO THE LEFT of travel (see the header).
    const lateral = (car.x - at.x) * tz - (car.z - at.z) * tx;
    const err = angleDelta(car.yaw, travelH);

    /* Curvature of the road just ahead, averaged over the distance the car covers in a bit
     * under a second. Straight off the continuous heading, so it is the real bend and not a
     * guess taken from a second road query that might have found a different road. */
    const look = clamp(v * 0.8, 9, 26);
    const kappa = (headAt(hops, nHops, look) - travelH) / look;

    /* The correction, as a lateral acceleration: a critically-damped pull back to the middle.
     * −ω²·e is the spring (SUBTRACTED — the handedness note in the header), +2ζω·v·ψ is the
     * damper, because v·ψ is the rate the lateral error is changing. */
    const aLat = clamp(-OMEGA * OMEGA * lateral + 2 * ZETA * OMEGA * vv * err, -LAT_BUDGET, LAT_BUDGET);
    const delta = Math.atan((wb * aLat) / (vv * vv)) + Math.atan(wb * kappa);

    /* Ask for an ANGLE, in radians, and let the car say what fraction of its own lock that is.
     * maxSteerAngle() is a lateral-acceleration cap that shrinks with the square of speed, so
     * a fixed steer number means something completely different at 30 km/h and at 90; dividing
     * by it is what makes one set of gains work across the whole speed range. */
    const maxA = typeof car.maxSteerAngle === 'function' ? car.maxSteerAngle() : 0.09;
    const want = clamp(delta / Math.max(maxA, 1e-3), -1, 1);
    const slew = SLEW * step;
    this._steer += clamp(want - this._steer, -slew, slew);
    const steer = clamp(this._steer, -1, 1);

    /* How fast may we take what is coming? Take the tightest 45 m of road inside the distance
     * it takes to slow down, and pick the speed that corners it at CORNER_G. Braking for the
     * corner you are already in is too late; this brakes for the one coming — and it looks
     * across junctions, because the bend that caught this out started 20 m past a node. */
    let kMax = Math.abs(kappa);
    for (let s = 0; s + 45 <= plan; s += 15) {
      const turn = headAt(hops, nHops, s + 45) - headAt(hops, nHops, s);
      kMax = Math.max(kMax, Math.abs(turn) / 45);
    }
    let target = Math.max(Math.min(this.cruise, kMax > 1e-5 ? Math.sqrt(CORNER_G / kMax) : Infinity), CRAWL);

    /* ── dead end ahead ───────────────────────────────────────────────────
     * `this._deadEnd` is only true when _horizon() actually asked "what comes after this?"
     * and got nothing back — a confirmed end of the network, not merely the edge of what this
     * frame bothered to look at. Plan a stop against it: the same target-speed-then-let-the-
     * throttle/brake-loop-track-it shape the corner governor above already uses, just aimed at
     * a full stop instead of a bend. This is deliberately allowed to push `target` under CRAWL
     * — the one moment this chauffeur is allowed to plan slower than a crawl is the road
     * actually running out underneath it. */
    if (this._deadEnd) {
      const remain = Math.max(0, this._deadAhead - DEAD_END_MARGIN);
      target = Math.min(target, Math.sqrt(2 * DEAD_END_DECEL * remain));
      if (this._deadAhead < DEAD_END_MARGIN + 2 && v < 1) {
        /* Stopped, on the tarmac, short of the last vertex. IT PRESSES R AND CARRIES ON.
         *
         * Operator: "must click r when end of road on auto drive mode". This used to switch
         * itself off here and hand the wheel back with a toast, which is a reasonable thing for
         * a chauffeur to do and a terrible thing to come back to: you left the car driving
         * itself and returned to find it parked in a field at the end of a lane. R is what a
         * player presses in exactly this situation, so this presses it — the same recover()
         * the R key and the water rescue call (see the constructor's own note), which puts the
         * car on the nearest centreline pointing down whichever direction has more road left.
         * At a dead end that is back the way it came, which is precisely the right answer.
         *
         * Latches are cleared so the horizon is re-planned from the new pose rather than
         * against the chain that just ended, and _deadFired stops this firing every frame while
         * the car is still slow after the reset. Without a recover() to call it still hands
         * back, exactly as before — that is the honest fallback, not a silent no-op. */
        this._steer += clamp(-this._steer, -SLEW * step, SLEW * step);
        if (this.recover && this._deadFired <= 0) {
          this._deadFired = DEAD_END_RECOVER_COOLDOWN;
          this.recover();
          this._chain = null;
          this._deadEnd = false;
          this._deadAhead = Infinity;
          if (this.say) this.say('the road ends here — turning around', 2.6);
          return { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true, auto: true };
        }
        if (!this.recover) {
          this.off('the road ends here');
          return { steer: this._steer, throttle: 0, brake: 0.4, handbrake: 0, analogue: true, auto: true };
        }
      }
    }

    /* A proportional throttle alone cannot start a stationary car: at 1 m/s below target it
     * asks for 20% throttle, which does not overcome rolling resistance, and the car sits
     * there. Well below target, open it properly. */
    const deficit = target - v;
    const throttle = deficit <= 0 ? 0 : deficit > target * 0.25 ? clamp01(0.45 + deficit / 12) : clamp01(deficit / 5);
    const over = v - target;
    const brake = over > 1.5 ? clamp01((over - 1.5) / 7) * 0.5 : 0;

    const t = this.tel;
    t.lateral = lateral;
    t.err = err;
    t.kappa = kappa;
    t.kMax = kMax;
    t.target = target;
    t.delta = delta;
    t.maxA = maxA;
    t.hops = nHops;
    t.road = this._key;
    t.deadEnd = this._deadEnd;
    t.deadAhead = this._deadAhead;
    t.stuckFor = this._stuckFor;

    return { steer, throttle, brake, handbrake: 0, analogue: true, auto: true };
  }
}

/* The road-as-a-path helpers, exported so a harness can ask what the road actually does
 * (tools/bench-drive.mjs reports the turn per kilometre of the road it drove) without having
 * to stand a controller up or re-derive arc length from a polyline. `nextEdge` joins them so a
 * harness can find a genuine dead end (nextEdge returns null) with the exact same "qualifying
 * connection" test the autopilot itself brakes against, instead of a second guess at what one
 * looks like — see tools/bench-autopilot-safety.mjs. */
export { pathOf, headingAt, locate, nextEdge };
