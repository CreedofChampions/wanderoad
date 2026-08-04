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
/* The raw land and the water on it. `field.js` exists precisely so this file can read them:
 * terrain.js imports THIS file, so this file can never import terrain.js. See field.js. */
import { floodAt, fieldTag } from './field.js';

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
    // bend 155, not 220: an arterial edge is two kilometres of road, and at 220 m per bend the
    // straightest of them ran 116 deg/km — nine bends over 2 km, with long straight runs
    // between them. Same radius, more of them: the worst arterial in an eight-seed sweep went
    // from 148 to 168 deg/km and the tightest radius on the tier did not move (median 103 m).
    //
    // step 19, not 38 — the operator: "roads need to be smoother -- less 2/4s attached end to
    // end more smooth winding track". That is not a complaint about HOW MUCH the road turns
    // (R5 already passes) but about the road being delivered as chords: a polyline stepping
    // `step` metres round a radius R breaks by step/R at every vertex, so at 38 m on this
    // tier's 122 m floor every bend was an 18-degree-per-vertex polygon. Measured over the
    // 12 km box at the default spawn (`node tools/diag-smooth.mjs`, new this round): the
    // arterial facet angle goes mean 9.17 -> 5.88 deg, p95 17.85 -> 11.15, max 27.00 -> 18.23,
    // and the share of vertices breaking by more than 10 deg goes 44.6% -> 9.0%.
    //
    // IT IS CHEAP, which is the only reason it ships: `bench-chunk.mjs` over all eight levels
    // 1183 -> 1231 ms, +4%. The vertex count doubles but the terrain sampling, not the road
    // polyline, is what a chunk build actually spends its time on. R5 went UP as a side effect,
    // 216 -> 232 deg/km, because the finer polyline resolves turn the old chords cut off, and
    // `diag-cliffs.mjs` improved 48 -> 31 samples over 45 deg (finer sampling, less earthwork —
    // the same effect recorded when the winding first landed). `diag-seam.mjs` clean.
    //
    // The `grade` smoothing length below is in METRES and `passesFor` converts it to a pass
    // count, so halving the step does not shorten the elevation smoothing — but it does need
    // 273 passes where 38 m needed 68, which is why that function's clamp had to go from 160
    // to 320. Without that the road would have started following the ground it used to ride
    // over. It also costs about a third of the density headroom: `diag-density.mjs` arterial
    // length kept goes 77.7% -> 75.6% against its 74% bar, because the water cull samples the
    // base polyline and a finer one clips three more arterials into a lake.
    curve: 0.44, step: 19, bend: 155, radius: 122, swing: 0.10, grade: 222,
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

/**
 * How much of the base curve's own radius the winding's sideways offset may use up at any one
 * sample. The offset is taken along the base curve's normal, so an offset that reaches the base
 * radius turns the curve inside out; 0.45 keeps a wide margin on that. Applied per sample —
 * see step 4 of `windOf`.
 */
const FOLD_FRACTION = 0.45;

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

/** The raw hash test — does cell (i,j) connect east (dir 0) or south (dir 1)? */
function connectsRaw(i, j, dir, tier, seed) {
  const T = TIERS[tier];
  const h = hash2i(i * 2 + dir, j, seed ^ (tier === 0 ? 0x9c41 : 0x4f77));
  return h * F < T.connect;
}

/** Degree from the raw hash alone. Never calls connects(), so the rescue below cannot recurse. */
function rawDegree(i, j, tier, seed) {
  return (
    (connectsRaw(i, j, 0, tier, seed) ? 1 : 0) +
    (connectsRaw(i, j, 1, tier, seed) ? 1 : 0) +
    (connectsRaw(i - 1, j, 0, tier, seed) ? 1 : 0) +
    (connectsRaw(i, j - 1, 1, tier, seed) ? 1 : 0)
  );
}

/* The four links at a node, in a fixed order: [i, j, dir] of each candidate. Shared by the
 * degree counts and the rescue so "the node's links" means one thing everywhere. */
const LINKS_AT = (i, j) => [
  [i, j, 0],
  [i, j, 1],
  [i - 1, j, 0],
  [i, j - 1, 1],
];

/**
 * Would this link be ADDED to rescue a dead end at (ni, nj)?
 *
 * THE OPERATOR'S RULE, verbatim: "no road should fail to connect to other roads." Every
 * previous attempt at this DELETED the offending lane, and every one of them cost too much:
 * one ply took junction density to 65.1% against a 66% floor, a full cascade to 60.3%, and a
 * road network with a third of its roads missing is a worse game than one with a few stubs.
 *
 * So this does the opposite. A node the hash gave exactly ONE link gets a SECOND one, chosen
 * deterministically from its own remaining candidates. Nothing is deleted, the network only
 * ever gains road, and a dead end stops existing rather than being decorated with a turning
 * head. Density goes UP, which is the first time any answer to this has moved that number the
 * right way.
 *
 * It is pure and symmetric: both endpoints of a link run the identical test against the same
 * hashes, so the two sides always agree without talking to each other — which is what lets
 * this work in a chunked, infinitely streamed world with no global pass.
 *
 * ONE PLY ONLY, and deliberately. Adding a link changes the degree of the node at its far end,
 * so a full fixed point is a global solve on an infinite lattice. One ply removes the dead end
 * the player is actually looking at.
 */
function rescueLink(i, j, dir, tier, seed) {
  // Which node is this link's "own" node, and which is the far one.
  const fi = dir === 0 ? i + 1 : i;
  const fj = dir === 0 ? j : j + 1;
  for (const [ni, nj] of [[i, j], [fi, fj]]) {
    if (rawDegree(ni, nj, tier, seed) !== 1) continue;
    /* Pick this node's rescue link deterministically: the first candidate that the hash did
     * NOT already give it. Fixed order, so every caller picks the same one. */
    for (const [li, lj, ld] of LINKS_AT(ni, nj)) {
      if (connectsRaw(li, lj, ld, tier, seed)) continue;
      // The first unused candidate IS the rescue. Is it the link being asked about?
      return li === i && lj === j && ld === dir;
    }
  }
  return false;
}

/** Does cell (i,j) connect east (dir 0) or south (dir 1)? */
export function connects(i, j, dir, tier, seed) {
  if (connectsRaw(i, j, dir, tier, seed)) return true;
  return rescueLink(i, j, dir, tier, seed);
}

/**
 * How many roads meet at node (i,j) — its four possible links, from four hash tests. Pure,
 * local and cheap, which is the only reason the dead-end cull below is affordable at all.
 */
export function degreeAt(i, j, tier, seed) {
  return (
    (connects(i, j, 0, tier, seed) ? 1 : 0) +
    (connects(i, j, 1, tier, seed) ? 1 : 0) +
    (connects(i - 1, j, 0, tier, seed) ? 1 : 0) +
    (connects(i, j - 1, 1, tier, seed) ? 1 : 0)
  );
}

/**
 * Is this edge a LEAF — a lane running out to a node nothing else reaches?
 *
 * The operator, twice, with a screenshot: roads "stop without explanation in the middle of no
 * where". Measured on the shipped seed over a 4 km box, counting only interior endpoints (an
 * endpoint near the query box is a CLIPPED edge, not a dead end — that distinction is the
 * difference between 31 apparent dead ends and 6 real ones): six genuine dead ends per 16 km²,
 * every single one a tier-1 lane, zero arterials. So the cruising network was already fully
 * connected and only the lanes stopped dead.
 *
 * Arterials are deliberately left alone: they are the network the player actually cruises, they
 * had no dead ends to fix, and thinning them would change the road density every other system
 * is tuned against. This culls ONE ply — an edge whose far node has nothing else on it. It does
 * not cascade, because chasing it to a fixed point is a global solve on an infinite lattice and
 * this is a hashed, deterministic world with no global anything. One ply removes the great
 * majority and keeps the function pure and local.
 *
 * IT COUNTS THE HASH DEGREE, NOT THE LIVE ONE, AND THAT IS DELIBERATE. Judging this on the
 * post-water-cull degree looks more correct and is much worse: the water cull deletes a link,
 * the node it left behind now has one link, and this then deletes that one too — so every lake
 * crossing removed a second, dry lane somewhere else. Measured over a 3 km square at five seeds
 * (`tools/diag-density.mjs`), that compounding took the network to 62% of the length and 52% of
 * the junctions it had before either cull existed. On the hash degree the two culls are
 * independent and multiply out to nothing worse than either alone.
 *
 * What that leaves is a lane that ends at the water, which is a road with a REASON for
 * stopping — the thing the operator asked for was roads that don't stop in the middle of
 * nowhere, and a shoreline is not nowhere.
 */
function isLeafLane(i, j, dir, tier, seed) {
  if (tier !== 1) return false;
  // The far node in this direction: east (dir 0) -> (i+1, j), south (dir 1) -> (i, j+1).
  const fi = dir === 0 ? i + 1 : i;
  const fj = dir === 0 ? j : j + 1;
  if (degreeAt(fi, fj, tier, seed) <= 1) return true;
  // ...and the near node, so a lane that dangles off its own start is culled too.
  return degreeAt(i, j, tier, seed) <= 1;
}

/* ── roads go AROUND lakes ───────────────────────────────────────────────────────────────
 *
 * The operator, verbatim: "we should have roads that go around the lake, not through it
 * necessarily... in the wetlands we could still continue to go through, but the way we're
 * doing it now is not correct."
 *
 * `profileEdge` already lifts a road 1.1 m clear of any water under it, and `diag-water.mjs`
 * confirms 0 underwater samples anywhere. That is a DIFFERENT question, and passing it is why
 * this went unnoticed: a causeway is not a drowned road, it is a correctly-engineered
 * embankment across a lake that should never have had a road on it. Measured on the shipped
 * seed over the 144 km² box around the default spawn: 343.9 km of road, 56.2 km of it over
 * flooded ground, of which only 1.4 km was in wetland. The longest single run was 2.48 km
 * starting 600 m from where the player is handed the car.
 *
 * WHY THIS IS A CULL AND NOT A REROUTE. There is no road map — there is a lattice, a hash and
 * a rule (see the file header), and every consumer re-derives the network from that rule at
 * whatever box it happens to care about. "Route around the lake" is a global solve, and this
 * world has no global anything; the one previous attempt at terrain-aware routing was reverted
 * for making cliffs worse (0.029% -> 0.071%) and tripling build time. So this is a local, pure,
 * per-edge predicate — the same shape as `isLeafLane` above — and it costs one bounded set of
 * samples per edge, cached.
 *
 * AND THE PRICE IS REAL, WHICH THE FIRST CUT OF THIS DENIED. It read: "delete the links that
 * cross the water and the links round the shore are still there — the route around the lake is
 * what is left." That is a hope, not a property of a 4-connected lattice, and it is measurably
 * false here. A lane node carries two links on average, so quite often the shore route does not
 * exist and deleting the crossing deletes the only road there was. `tools/diag-density.mjs`
 * prices exactly this and its bars exist so the next cull cannot be added on a hope either. The
 * thresholds below are the point on that curve we chose, not a bar that costs nothing.
 *
 * WETLAND IS NOT A LAKE. A road on a low embankment through a marsh is the picture the
 * operator asked to keep, and it is the prettiest thing in the game. So a wet sample only
 * counts against the edge where the WETLAND weight is below `MARSH_OK`; at or above it, the
 * run resets, exactly as `tools/diag-causeway.mjs` scores it.
 */

/** Metres between water probes along an edge. */
const CAUSEWAY_STEP = 100;
/**
 * Metres of CONTINUOUS open, non-wetland water an edge may run over before it is deleted
 * instead of built — one figure per tier, and they are a long way apart on purpose.
 *
 * The first cut of this cull used a single threshold of "two adjacent wet probes", about
 * 100 m, for both tiers, and it was a quiet disaster. `tools/diag-density.mjs`, over a 3 km
 * square at five seeds: arterial road fell from 292.2 km to 172.0 km — 41% of the cruising
 * network deleted, and junctions across both tiers halved. An arterial cell is 1800 m, so an
 * arterial edge is a two-kilometre road, and a two-kilometre road in a world with this much
 * water will clip 100 m of a lake somewhere along its length most of the time. Deleting the
 * whole road for it is wildly out of proportion, and the player felt it immediately: a run-up
 * lands on a lone straight arterial with nothing to turn off onto.
 *
 * The engineering answer is the real-world one. A trunk road meeting a hundred metres of water
 * gets a bridge, and `profileEdge` already builds exactly that — deck lifted 1.1 m clear,
 * embankment either side. What a trunk road does NOT get is a two-and-a-half-kilometre
 * embankment straight over the middle of a lake, which is the thing the operator actually
 * pointed at. So the arterial bar is set well above a bridge and well below that causeway;
 * lanes, which are short, plentiful and lose nothing by going round, keep the tight bar.
 */
const CAUSEWAY_SPAN = [520, 150];
/** Wetland weight at or above which standing water under a road is the design, not the bug. */
const MARSH_OK = 0.4;
/** Depth below which "flooded" is a damp pan rather than a lake. The water plane can sit a
 *  few centimetres over a flat, and lifting the road 1.1 m over that reads as a normal road on
 *  slightly boggy ground, not as a causeway. Measured against the real spawn causeway, which
 *  stands in 13.6 m. */
const CAUSEWAY_DEPTH = 0.35;

/** Cache ceiling for the per-edge water measurement below. */
const WET_RUN_CAP = 8192;
/** `${tag}:${seed}:${key}` -> `{ run, wet }` for that edge, both in metres. */
const WET_RUN = new Map();

/**
 * How much open, non-wetland water this lattice edge would be built over: `run`, the longest
 * CONTINUOUS stretch, and `wet`, the total. Pure in (i, j, dir, tier, seed) plus the height
 * field, which is what `tag` fingerprints — the terrain preset rewrites the field in place,
 * including inside the chunk worker, so anything cached off it has to be keyed by what the
 * field currently is.
 *
 * A measurement rather than a verdict, because the verdict is per-tier (see CAUSEWAY_SPAN) and
 * because `tools/diag-density.mjs` has to price both sides of this trade — road deleted against
 * causeway avoided — without this file having already thrown the numbers away.
 *
 * Sampled on the BASE geometry, before `squareCrossings` bends anything, and that ordering is
 * deliberate: the squared geometry is built from the neighbours that exist, so deciding
 * existence from the squared shape would be circular. The base shape and the final shape never
 * differ by more than a junction window, which is far below the hundreds of metres of water
 * this is looking for.
 */
function waterOn(i, j, dir, tier, seed, tag) {
  const key = `${tag}:${seed}:${tier}:${i},${j},${dir}`;
  const hit = WET_RUN.get(key);
  if (hit !== undefined) return hit;

  const g = baseGeomFor(i, j, dir, tier, seed);
  const pts = g.pts;
  const n = pts.length / 2;
  const stride = Math.max(1, Math.round(CAUSEWAY_STEP / Math.max(g.span, 1e-3)));

  /* Metres, not probes: a run is the distance between the wet probes that bound it, so one
   * isolated wet sample scores 0 and a pair ~100 m apart scores ~100. The old probe COUNT hid
   * the fact that the same count meant different distances on the two tiers. */
  let run = 0;
  let worst = 0;
  let total = 0;
  let prevWet = false;
  let px = 0,
    pz = 0;
  for (let k = 0; k < n; k += stride) {
    const x = pts[k * 2],
      z = pts[k * 2 + 1];
    const f = floodAt(x, z, seed);
    const wet = f.wet && f.depth > CAUSEWAY_DEPTH && f.marsh < MARSH_OK;
    if (wet && prevWet) {
      const d = Math.hypot(x - px, z - pz);
      run += d;
      total += d;
      if (run > worst) worst = run;
    } else if (!wet) run = 0;
    prevWet = wet;
    px = x;
    pz = z;
  }

  const out = { run: worst, wet: total };
  if (WET_RUN.size >= WET_RUN_CAP) WET_RUN.clear();
  WET_RUN.set(key, out);
  return out;
}

/** Is this edge a causeway across a lake rather than a road with a bridge on it? */
function drownsInWater(i, j, dir, tier, seed, tag) {
  return waterOn(i, j, dir, tier, seed, tag).run >= CAUSEWAY_SPAN[tier];
}

/**
 * Is there actually a ROAD along this link? The hash says yes (`connects`) and the water says
 * maybe. Every place that enumerates the network goes through here, so the renderer, the
 * terrain carve, the station placer and the crossing search all see the identical network —
 * which is the invariant this file exists to protect (gotcha 6).
 */
function linkLive(i, j, dir, tier, seed, tag) {
  if (!connects(i, j, dir, tier, seed)) return false;
  if (drownsInWater(i, j, dir, tier, seed, tag)) return false;
  /* The bad-crossing cull belongs HERE, not only at the enumeration loop, so that every other
   * question about the network — is this node a leaf, is that a drowned stub, does this end
   * need a turning head — is asked about the road network that actually exists. Culling an
   * edge only where edges are listed left the dead-end machinery reasoning about a lane that
   * had already been taken away, and tools/diag-manual-streak.mjs caught the consequence: a
   * drive that followed a lane into a junction that was no longer there and put a wheel 33 m
   * into the grass. See crossesArterialBadly. */
  return !crossesArterialBadly(i, j, dir, tier, seed, tag);
}

/**
 * A road that runs out into open water and STOPS.
 *
 * The operator, with a screenshot of a carriageway ending on a lake shore: "roads should not go
 * out into the middle of the sea and stop like this either."
 *
 * These are not hash dead ends — the hash gave the node two or more links, so `isLeafLane` and
 * the degree-1 rescue both correctly leave it alone. What happened is that the water cull
 * deleted the CONTINUATION for drowning in a lake, and the surviving stub was left pointing at
 * the water it was culled from. The right answer is not to rescue it (that would put the road
 * back over the lake, which is the thing the cull exists to prevent) and not to decorate it —
 * it is to take the stub away too, so the network stops short of the shore instead of walking
 * into it.
 *
 * NARROW ON PURPOSE. It fires only when the far node has no live link left OTHER than this one
 * AND at least one of the links it lost was lost to water. A blanket live-degree cull was
 * measured twice and cost the junction count its floor (65.1% and 60.3% against 66%); this
 * targets the specific shape in the screenshot and nothing else.
 */
function drownedStub(i, j, dir, tier, seed, tag) {
  const fi = dir === 0 ? i + 1 : i;
  const fj = dir === 0 ? j : j + 1;
  let others = 0;
  let drowned = 0;
  for (const [li, lj, ld] of LINKS_AT(fi, fj)) {
    if (li === i && lj === j && ld === dir) continue; // the link being tested
    if (!connects(li, lj, ld, tier, seed)) continue; // the hash never offered it
    if (drownsInWater(li, lj, ld, tier, seed, tag)) drowned++;
    else if (!isLeafLane(li, lj, ld, tier, seed)) others++;
  }
  return others === 0 && drowned > 0;
}

/**
 * How many roads are actually BUILT at node (i, j) — the same two-part test `geomsInBox` runs
 * before it emits an edge (`linkLive` and not `isLeafLane`), applied to the node's four links.
 * A node with a live degree of 1 is a genuine DEAD END: exactly one road reaches it and there
 * is nothing on the far side.
 *
 * WHY THE RENDERER NEEDS THIS, and why it must be this function and not a second copy of the
 * rule. The one-ply leaf cull runs on the HASH degree on purpose (see `isLeafLane`: making it
 * water-aware compounded with the lake cull and took the network to 62% of its length), so
 * stumps survive — `tools/diag-deadends.mjs` measures 6.1 per 16 km², two-thirds of them lanes
 * orphaned when their neighbour drowned. Those are roads that stop for a REASON, but the
 * player cannot see the reason, and the operator's screenshot is one of them: edge lines,
 * centre dashes and all, running straight into the grass at the cut.
 *
 * So render/road.js gives every one of them a visible termination instead, and asks THIS
 * function which ends need one. If the renderer re-derived "is this a dead end" from its own
 * copy of the rule it would be a second opinion about the network, which is the exact class of
 * bug this file's header spends four paragraphs on.
 *
 * Pure and local: four hash tests plus, at most, four cached water profiles. No box, no
 * enumeration, so the answer is the same one metre inside a query window as one metre outside
 * it — which is what lets a diagnostic count dead ends without a clip margin.
 */
export function liveDegreeAt(i, j, tier, seed, tag = fieldTag(seed)) {
  let n = 0;
  // east and south OF this node, and the west and north links INTO it — the same four the
  // hash-degree `degreeAt` above counts, so the two are directly comparable.
  const links = [
    [i, j, 0],
    [i, j, 1],
    [i - 1, j, 0],
    [i, j - 1, 1],
  ];
  for (const [li, lj, d] of links) {
    if (!linkLive(li, lj, d, tier, seed, tag)) continue;
    if (isLeafLane(li, lj, d, tier, seed)) continue;
    n++;
  }
  return n;
}

/**
 * Which of an edge's two ends stop dead — `[atStart, atEnd]`, matching the order of its own
 * `pts` (index 0 is the (i,j) node, the last sample is the far node).
 *
 * `e.key` is `${tier}:${i},${j},${dir}`, the same string `edgeNodeKeys` parses; parsed here
 * rather than carried on the edge so nothing has to be threaded through `edgeFrom` and the
 * chunk worker's separate module graph (gotcha 2).
 */
/* MEMOISED, and it has to be. `continuesFrom` below builds the GEOMETRY of every neighbouring link to
 * ask which way it leaves, and this is called for both ends of every edge in every baked tile — so
 * uncached it dropped the game to 9.1 fps, which the browser suite caught immediately ("running at a
 * playable rate once warm: 9.1 fps", and a car that would not pull away). The answer is a pure
 * function of the edge, the seed and the height-field tag, so it is computed once and read thereafter.
 * Same lesson, and the same fix, as the airfield and harbour cells. */
const _deadEndCache = new Map();
export function edgeDeadEnds(e, seed, tag = fieldTag(seed)) {
  const ck = `${tag}:${e.key}`;
  const hit = _deadEndCache.get(ck);
  if (hit) return hit;
  const out = _edgeDeadEnds(e, seed, tag);
  if (_deadEndCache.size > 40000) _deadEndCache.clear();
  _deadEndCache.set(ck, out);
  return out;
}

function _edgeDeadEnds(e, seed, tag) {
  const [tierStr, rest] = e.key.split(':');
  const tier = Number(tierStr);
  const [i, j, dir] = rest.split(',').map(Number);
  const i1 = dir === 0 ? i + 1 : i;
  const j1 = dir === 0 ? j : j + 1;
  return [
    liveDegreeAt(i, j, tier, seed, tag) <= 1 || !continuesFrom(e, i, j, tier, seed, tag),
    liveDegreeAt(i1, j1, tier, seed, tag) <= 1 || !continuesFrom(e, i1, j1, tier, seed, tag),
  ];
}

/* ── A DEAD END FOR A DRIVER IS NOT THE SAME AS A DEGREE-1 NODE ───────────────
 *
 * Operator, after the closures were already shipping: "Road still ends without" any warning.
 *
 * The turning heads, bollards and closing boards are placed where a node's live degree is 1 — one
 * road in, nothing out — and that rule is right as far as it goes. What it misses is the node where
 * two roads BOTH ARRIVE FROM THE SAME DIRECTION. Its degree is 2, so it gets no closure, and yet a
 * driver coming up one of them finds the tarmac simply stops in front of them: the only other road
 * there goes back the way they came.
 *
 * This is the same defect as the junction braiding (docs/BACKLOG.md, ~33% of node pairs leave within
 * 26 degrees of each other) seen from the driver's seat, and it is why closures kept being reported
 * as missing on roads that the dead-end count said were fine. A real example on the shipped seed:
 * arterials 0:0,-2,1 and 0:-1,-1,0 both end at (773,-909) with their tangents 5.4 degrees apart.
 *
 * So an approach counts as continuing only if some OTHER live link at that node leaves within
 * CONTINUE_MAX_TURN of straight ahead. Anything tighter than that is a hairpin, not a continuation,
 * and the road needs to be closed off in front of you. Pure in the lattice, like everything else
 * here, and it can only ever ADD closures — it never removes one the old rule asked for. */
const CONTINUE_MAX_TURN = (118 * Math.PI) / 180;
/** continuesFrom's own node-position scratch — declared here rather than reusing _p/_q, which belong
 *  to nodeDir and are live while this runs. */
const _cp = [0, 0];

function continuesFrom(e, ni, nj, tier, seed, tag) {
  // the direction this edge ARRIVES at the node, as a unit vector pointing along travel
  nodePos(ni, nj, tier, seed, _cp);
  const n = e.pts.length / 2;
  const headFirst = Math.hypot(e.pts[0] - _cp[0], e.pts[1] - _cp[1]) < Math.hypot(e.pts[(n - 1) * 2] - _cp[0], e.pts[(n - 1) * 2 + 1] - _cp[1]);
  const k = headFirst ? 0 : n - 1;
  const k2 = headFirst ? 1 : n - 2;
  // pointing INTO the node is the reverse of the away-tangent
  let ax = e.pts[k * 2] - e.pts[k2 * 2];
  let az = e.pts[k * 2 + 1] - e.pts[k2 * 2 + 1];
  const al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;

  for (const [li, lj, ld] of LINKS_AT(ni, nj)) {
    if (!linkLive(li, lj, ld, tier, seed, tag)) continue;
    if (isLeafLane(li, lj, ld, tier, seed)) continue;
    const other = geomFor(li, lj, ld, tier, seed, tag);
    if (!other || other.key === e.key) continue;
    const m = other.pts.length / 2;
    const oFirst = Math.hypot(other.pts[0] - _cp[0], other.pts[1] - _cp[1]) < Math.hypot(other.pts[(m - 1) * 2] - _cp[0], other.pts[(m - 1) * 2 + 1] - _cp[1]);
    const o0 = oFirst ? 0 : m - 1;
    const o1 = oFirst ? 1 : m - 2;
    let bx = other.pts[o1 * 2] - other.pts[o0 * 2]; // AWAY from the node
    let bz = other.pts[o1 * 2 + 1] - other.pts[o0 * 2 + 1];
    const bl = Math.hypot(bx, bz) || 1;
    bx /= bl;
    bz /= bl;
    const turn = Math.acos(clamp(ax * bx + az * bz, -1, 1));
    if (turn <= CONTINUE_MAX_TURN) return true; // a road you can actually drive onto
  }
  return false;
}

/**
 * DIAGNOSTIC ONLY — nothing in the game calls this; `tools/diag-density.mjs` does.
 *
 * Two independent culls now sit between the hash and the tarmac, and they MULTIPLY: the water
 * cull deletes a link, that drops a node's live degree, and the dead-end cull then takes the
 * surviving lane off that node as well. Priced blind, the pair removed a third of the world's
 * road. So the cost of each is measurable from outside, at the same lattice the enumerator
 * walks, rather than being something a screenshot has to notice.
 */
export function linkAudit(i, j, dir, tier, seed, tag) {
  if (!connects(i, j, dir, tier, seed)) {
    return { hashed: false, drowned: false, leaf: false, live: false, len: 0, wetRun: 0, wetLen: 0 };
  }
  const w = waterOn(i, j, dir, tier, seed, tag);
  const drowned = drownsInWater(i, j, dir, tier, seed, tag);
  const leaf = isLeafLane(i, j, dir, tier, seed);
  const pts = baseGeomFor(i, j, dir, tier, seed).pts;
  let len = 0;
  for (let k = 2; k < pts.length; k += 2) {
    len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]);
  }
  return { hashed: true, drowned, leaf, live: !drowned && !leaf, len, wetRun: w.run, wetLen: w.wet };
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
/* Curvature of the BASE hermite at each of this edge's own samples, filled by `buildBaseGeom`
 * immediately before it calls `windOf`. It is the fold-over budget, sample by sample — see
 * step 4 below for why one number for the whole edge was not good enough. */
const _kb = new Float32Array(128);

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

  /* 4. scale to a hashed fraction of the tier's tightest radius, then hold it back further if
   *    that would swing the road too far sideways. The swing cap is not cosmetic: the offset is
   *    taken along the base curve's normal, and an offset approaching the base curve's own
   *    radius folds it over.
   *
   *    That fold-over budget is LOCAL and it has to be spent locally. It used to be one number
   *    for the whole edge — max|w| against 0.45 / the base curve's PEAK curvature — and the
   *    peak is almost always a junction whip in the first or last few samples, where a shared
   *    node tangent leaves at a wide angle to this chord. `w` is zero at both ends by
   *    construction, so there was never any fold-over risk there; the edge was being flattened
   *    along its whole length to pay for a corner it was not winding into. Measured over eight
   *    seeds' worth of 6 km squares: 31% of arterial edges were held back by that global cap,
   *    and they are exactly the ones that read as straight — the worst delivered 93 deg/km of
   *    winding where it had asked for 275, and the finished road measured 116 deg/km against a
   *    network median of 243. That single edge is what the R5 browser check landed on.
   *
   *    So compare each sample's own offset against each sample's own budget. Nothing may fold:
   *    the test is the same one, applied where it is actually true rather than at the tightest
   *    point on the edge. It cannot make any road tighter than `T.radius` — the peak
   *    normalisation above still governs that — it only stops a straight stretch being
   *    surrendered for a bend somewhere else. */
  // Bits 0-9 of h are the only ones the shape above did not spend; using an overlapping slice
  // would tie how tight an edge bends to which harmonic happened to be loud on it.
  const want = (1 / T.radius) * (0.8 + 0.2 * ((h & 0x3ff) / 1023));
  let s = peak > 1e-9 ? (want * chord * chord) / peak : 0;
  let over = 0;
  for (let k = 0; k <= n; k++) {
    const budget = Math.min(maxSwing, _kb[k] > 1e-9 ? FOLD_FRACTION / _kb[k] : Infinity);
    const need = (Math.abs(_wOff[k]) * s) / Math.max(budget, 1e-9);
    if (need > over) over = need;
  }
  if (over > 1) s /= over;
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
  /* THE PLAN HALF OF THE SIXTH APPROACH — each edge leaves a node biased towards where IT is
   * actually going, instead of along the node's one shared line.
   *
   * Operator, repeatedly: "when 2 roads get close they need to start to connect via a 90 degree
   * junction not like part into each other", and later, plainly, that roads "go in and out of each
   * other". nodeDir's own comment states the cause as though it were a feature: the tangent
   * "belongs to the NODE, not to either edge, so both edges meeting here leave along the same
   * line". That is exactly what braiding IS — two roads leaving a junction on top of one another
   * and only slowly separating. Measured: 33.3% of node pairs leave under 26 degrees apart, and
   * the tightest pair in the sample is 0 degrees.
   *
   * The fix is not to abandon the shared tangent — it is what keeps the network kink-free, and
   * throwing it away puts a corner at every node. It is blended towards THIS edge's own chord by
   * NODE_FAN, which fans the departures apart near the node while leaving the far end of the
   * tangent alone. The blend is renormalised, so tangent LENGTH is untouched and every downstream
   * measurement that depends on it — the backoff loop directly below, the curvature floor, the
   * squaring pass — sees the same magnitudes it always did. */
  const _cx = (p1[0] - p0[0]) / chord;
  const _cz = (p1[1] - p0[1]) / chord;
  for (const [t, sgn] of [[_t0, 1], [_t1, 1]]) {
    const bx = t[0] + (_cx * sgn - t[0]) * NODE_FAN;
    const bz = t[1] + (_cz * sgn - t[1]) * NODE_FAN;
    const bl = Math.hypot(bx, bz) || 1;
    t[0] = bx / bl;
    t[1] = bz / bl;
  }
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
  const want = chord * Math.min(T.curve * 2, 1.25) * JOINT_TANGENT;
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
  /* How far sideways the winding may go. Two limits, and they are enforced in two different
   * places because they are two different shapes of limit. This one is a fraction of the chord,
   * so a road never wanders far enough to tangle with its neighbours, and it is a property of
   * the whole edge. */
  const swingCap = T.swing * chord;
  /* The other half of that limit — the base curve's own radius — is per-sample, because the
   * fold is per-sample. Same curvature formula as `basePeak`, at this edge's own samples, so
   * `windOf` can spend the budget where the winding actually goes. */
  {
    const dx = p1[0] - p0[0],
      dz = p1[1] - p0[1];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const g01 = 6 * t - 6 * t * t,
        g10 = 3 * t * t - 4 * t + 1,
        g11 = 3 * t * t - 2 * t;
      const bx = g01 * dx + g10 * m0x + g11 * m1x;
      const bz = g01 * dz + g10 * m0z + g11 * m1z;
      const cx = (6 - 12 * t) * dx + (6 * t - 4) * m0x + (6 * t - 2) * m1x;
      const cz = (6 - 12 * t) * dz + (6 * t - 4) * m0z + (6 * t - 2) * m1z;
      const sp = Math.hypot(bx, bz);
      _kb[k] = sp > 1e-6 ? Math.abs(bx * cz - bz * cx) / (sp * sp * sp) : 0;
    }
  }
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

/* `tag` is accepted and ignored: the BASE shape is a pure function of the lattice and the
 * seed and knows nothing about the ground, which is exactly why the water cull samples it
 * (see `drownsInWater`). It is in the signature only so this and `geomFor` can be passed to
 * `geomsInBox` interchangeably. */
function baseGeomFor(i, j, dir, tier, seed, _tag) {
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
function geomsInBox(x0, z0, x1, z1, seed, pad, fetch, tag0, onlyTier) {
  const out = [];
  /* Once per call, not once per edge: the fingerprint of the height field the water cull's
   * cache is keyed on. Two land-and-water samples — the same price `worldTag` pays for the
   * height caches, and for the same reason (the terrain preset rewrites the field in place).
   * A caller already inside one edge's build (`baseNeighbors`) passes ITS tag down instead,
   * so a single `buildGeom` can never see the field change halfway through itself. */
  const tag = tag0 !== undefined ? tag0 : fieldTag(seed);
  for (let tier = 0; tier < TIERS.length; tier++) {
    /* An arterial only ever levels against other arterials, and asking for the lanes as well
     * meant BUILDING every lane's geometry inside a 1.8 km box just to filter it straight back
     * out — measured at +280 ms on an 8 km coarse chunk (tools/bench-chunk.mjs L7 498 -> 775 ms).
     * Skipping the tier here is exactly equivalent to filtering the result, so nothing about
     * box-independence changes; it just does not pay for the answer it throws away. */
    if (onlyTier !== undefined && tier !== onlyTier) continue;
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
          if (!linkLive(i, j, dir, tier, seed, tag)) continue; // no hash link, or it crosses a lake
          if (isLeafLane(i, j, dir, tier, seed)) continue; // a lane to nowhere is not a road
          if (drownedStub(i, j, dir, tier, seed, tag)) continue; // a road that ends in a lake
          const g = fetch(i, j, dir, tier, seed, tag);
          const m = g.width * 0.5 + g.verge + pad;
          if (g.maxX < x0 - m || g.minX > x1 + m || g.maxZ < z0 - m || g.minZ > z1 + m) continue;
          out.push(g);
        }
      }
    }
  }
  return out;
}

/* ── NO ROAD MAY CROSS ANOTHER AT A BAD ANGLE ────────────────────────────────
 *
 * Operator, twice and unambiguously: "No 2 roads can ever overlap or cross", and the
 * screenshot behind it — "lines intersecting lines blinking through each other".
 *
 * `squareCrossings` bends an edge's tangent towards square near a junction, and it fixes most
 * of them: over a 12 km box, 175 crossings at a mean of 16.5 deg off square, with a healthy
 * majority already inside 10 deg. What it cannot fix is the tail — a lane that meets an
 * arterial at 8 deg is not a junction anyone would build, it is two roads sharing tarmac for
 * a hundred metres, and no amount of tangent-bending inside a 420 m window turns that into a
 * crossroads. Five separate attempts to widen, re-space or re-jitter it into submission were
 * measured and reverted (see docs/BACKLOG.md).
 *
 * So the tail is removed instead of bent: a LANE that crosses an ARTERIAL further than
 * CROSS_CULL_DEV degrees from square is not built at all. Arterials are never culled — they
 * are the network you cruise, and they are the senior tier everywhere else in this file
 * (`outranks`), so the junior tier is the one that yields here too, exactly as it already
 * does when the two are squared up.
 *
 * Read on BASE geometry, never on the squared-up result, for the same reason
 * `squareCrossings` reads its neighbours' base shapes: culling changes geometry, and a rule
 * that read the post-cull world would decide differently depending on what it had already
 * decided. Base shapes are a pure function of (i, j, dir, tier, seed), so this is too — and
 * it is therefore cacheable and box-independent, which is what keeps two chunks that overlap
 * from disagreeing about whether a lane exists.
 */
const CROSS_CULL_DEV = 32; // degrees off square; beyond this the lane yields rather than bends
/* AND A LANE MAY NOT CROSS AN ARTERIAL ON TOP OF ITS OWN LATTICE NODE.
 *
 * This is the answer to B2's last survivors, and it is not a levelling problem at all — eight
 * attempts aimed at levelAgainst (ramp length, capture radius, earthwork budget, feather shape,
 * respect masks) moved the number by nothing, because the levelling was already working.
 *
 * Instrumented at the worst one, (-1459,-1562) on the shipped seed: the lane's sample 22 m along
 * was pulled 22.2 m DOWN onto the arterial exactly as intended, with full authority and no clamp
 * binding. Sample 0 is the lane's own lattice node, and a node cannot move — every other edge
 * meeting there is pinned to the same height, which is what diag-seam's S3 measures and what
 * killed BACKLOG attempts #3/#4/#5. The crossing falls BETWEEN those two samples, 18.6 m from the
 * pinned one, so the polyline simply interpolates and the crossing point rides 3.94 m high.
 *
 * Nothing that levels roads can fix that, and the alternative — putting a sample on the crossing —
 * would meet the arterial by asking the lane for a 24 m drop in 18.6 m, a 128% grade, which is a
 * worse road than the step is. The honest answer is the one this file already takes for a crossing
 * that is too far off square: a lane that cannot make a junction here does not make one. Measured
 * over five seeds and 121 lane-x-arterial crossings, culling at 40 m removes the four worst
 * mismatches (3.94, 3.92, 1.87 and 1.74 m — every one over 1.7 m) and costs six crossings that
 * were level. The 1.0–1.3 m tail sits 114–400 m from any node and is a different question.
 *
 * 40 m: the four bad ones are at 10.4, 18.6, 34.8 and 38.0 m, and the nearest LEVEL crossing that
 * this also removes is at 3.9 m — i.e. there is no clean gap to cut in, so the number is set at
 * the far edge of the failures rather than pretending one exists. Same units and same spirit as
 * LEVEL_END_KEEP, which is how much road the feather already refuses to spend near a node. */
const CROSS_CULL_NODE = 40;
const _cullCache = new Map();
function crossesArterialBadly(i, j, dir, tier, seed, tag) {
  if (tier !== 1) return false; // arterials never yield
  const key = `${i},${j},${dir},${seed}`;
  const hit = _cullCache.get(key);
  if (hit !== undefined) return hit;
  const base = baseGeomFor(i, j, dir, tier, seed);
  const arterials = geomsInBox(base.minX, base.minZ, base.maxX, base.maxZ, seed, CROSS_PAD, baseGeomFor, tag, 0);
  /* This lane's own two lattice nodes, in world metres — the pins a crossing may not sit on top
   * of. Read from `nodePos` rather than from the base polyline's ends so it is the same number
   * `pinToNodes` uses; a base shape's first point IS the node, but saying so twice is how the two
   * drift apart. */
  const _n0 = [0, 0];
  const _n1 = [0, 0];
  nodePos(i, j, tier, seed, _n0);
  nodePos(dir === 0 ? i + 1 : i, dir === 0 ? j : j + 1, tier, seed, _n1);
  let bad = false;
  for (const c of findCrossings([base, ...arterials])) {
    if (c.a !== base && c.b !== base) continue;
    if (c.deviationDeg > CROSS_CULL_DEV) {
      bad = true;
      break;
    }
    // See CROSS_CULL_NODE: too close to one of this lane's own pins to be levelled at all.
    if (
      Math.hypot(c.x - _n0[0], c.z - _n0[1]) < CROSS_CULL_NODE ||
      Math.hypot(c.x - _n1[0], c.z - _n1[1]) < CROSS_CULL_NODE
    ) {
      bad = true;
      break;
    }
  }
  /* NEVER STRAND A NODE. Operator, with a screenshot: "no road should fail to connect to other
   * roads". A cull that takes the last live link at either end turns a junction into a stub
   * pointing at nothing, and a driver following it arrives at speed with no road ahead — which
   * is exactly what tools/diag-manual-streak.mjs caught, the car still doing 45 km/h as the
   * nearest centreline froze at the terminus behind it. A crossing that is 40 deg off square
   * is a worse-looking junction; a road that stops in a field is a broken one. The junction
   * loses. `connects` + water only, deliberately: asking the neighbours whether THEY are culled
   * would be circular, and the conservative answer (assume they live) is the safe direction —
   * it keeps roads rather than removing them. */
  if (bad) {
    for (const [ni, nj] of [
      [i, j],
      [dir === 0 ? i + 1 : i, dir === 0 ? j : j + 1],
    ]) {
      let others = 0;
      for (const [li, lj, ld] of LINKS_AT(ni, nj)) {
        if (li === i && lj === j && ld === dir) continue;
        if (!connects(li, lj, ld, tier, seed)) continue;
        if (drownsInWater(li, lj, ld, tier, seed, tag)) continue;
        others++;
      }
      if (others === 0) {
        bad = false;
        break;
      }
    }
  }
  if (_cullCache.size > 40000) _cullCache.clear();
  _cullCache.set(key, bad);
  return bad;
}

/** Every OTHER edge's BASE shape that could cross this one — `partnersOf`, one layer down,
 *  before either edge has a height or a squared-up crossing angle. `pad` is `CROSS_PAD`,
 *  defined further down with `levelAgainst`; reused rather than re-picked so "how far away
 *  can't possibly be a crossing" is one number for both height and angle. */
function baseNeighbors(base, seed, pad, tag) {
  const list = geomsInBox(base.minX, base.minZ, base.maxX, base.maxZ, seed, pad, baseGeomFor, tag);
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
 *
 * 62 -> 40, and the reason it is affordable now is `CROSS_WIN_K`/`CROSS_WIN_MAX` below, which
 * were raised in the same change. The instrumented sweep that produced this (a copy of this
 * file with counters in `squareCrossings`) found the mechanism was not radius-limited by the
 * BEND, it was window-limited: at 62 the mean correction ASKED for was 30.9 deg and the mean
 * actually APPLIED was 14.7 deg — under half — with 34 of 181 corrected crossings backed all
 * the way off to 0.16 of their ask. Widening the window first and only then dropping the
 * radius target buys the correction back at almost no curvature cost: over seven seeds and a
 * 12 km box each, tightest radius anywhere in the network improves on five seeds
 * (37/52/45/26/50/40/58 m -> 37/47/45/26/50/46/48 m), and the two that fall (52 -> 47,
 * 58 -> 48) stay well clear of `UNKNOT_RADIUS`. Swept: 30 and 35 square up slightly better
 * still (all-seed mean 14.8 and 15.1 against 15.5) and were REJECTED, because at 30 the
 * tightest turn on the 4 km box falls 56 -> 38 m — a road nobody should have to steer round at
 * cruising speed, which is the wrong trade for a cozy game (the same reasoning as `radius` at
 * the top of this file).
 */
const CROSS_SAFE_RADIUS = 40;

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
 *
 * Finer than it was (six steps -> eight), because the search takes the FIRST fraction that
 * clears `CROSS_SAFE_RADIUS` and coarse steps therefore throw away everything between that
 * fraction and the one above it: a crossing that could afford 0.7 of its ask was being handed
 * 0.58. Worth about 1.5 deg of the ask on its own, and it cannot cost anything, since every
 * fraction is still checked against the same radius.
 */
const DELTA_BACKOFF = [1, 0.85, 0.7, 0.58, 0.46, 0.34, 0.22, 0.12];

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
function squareCrossings(base, seed, tag) {
  const neighbors = baseNeighbors(base, seed, CROSS_PAD, tag);
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
    //
    // CROSS_WIN_K/CROSS_WIN_MAX doubled (160/230 -> 320/420), and this — not the radius
    // target — is what was actually holding the correction back. Turning `delta` inside a
    // half-window of W metres needs a radius of about W/delta, so a 45 deg crossing asked for
    // a 150 m window and therefore a ~190 m radius on paper, but a hermite's PEAK curvature
    // runs several times its mean, so the radius test kept failing and DELTA_BACKOFF kept
    // giving the correction away. Twice the window is twice the radius for the same ask, and
    // it is spent on exactly the crossings that need it (the window is proportional to the
    // ask, so a nearly-square crossing still gets a short nudge). The window is still clamped
    // below by this edge's own nodes and by its neighbouring crossings, so a long arterial can
    // use the whole 420 m and a short lane simply gets less.
    const desiredM = clamp(24 + Math.abs(delta) * 320, 24, 420);
    // Symmetric on purpose. An ASYMMETRIC window (all the room on whichever side has it) was
    // built and measured, and it is a trap: it rescues the 39-of-220 crossings that currently
    // get no correction at all for lack of room, and the all-seed mean and median both improve
    // (15.7 -> 14.4, 8.2 -> 6.5) — but the WORST crossing in the 12 km box goes 63 deg off
    // square to 87 deg off, because bending an edge hard against one end swings a nearby
    // stretch of it into near-parallel with something else. Worse worst case is a regression
    // on the exact thing being fixed here, so the lopsided window is not taken.
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
function buildGeom(i, j, dir, tier, seed, tag) {
  const base = baseGeomFor(i, j, dir, tier, seed);
  const pts = squareCrossings(base, seed, tag);
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

function geomFor(i, j, dir, tier, seed, tag) {
  /* KEYED BY THE HEIGHT FIELD, not by the lattice alone — new this round, and load-bearing.
   *
   * Before the water cull, an edge's final shape was a pure function of (lattice, seed):
   * `squareCrossings` reads its neighbours' BASE shapes, and a base shape knows nothing about
   * the ground. Now the set of neighbours that EXIST depends on where the water is, so the
   * squared shape depends on the water too — and the terrain preset rewrites the water in
   * place, including inside the chunk worker.
   *
   * Without the tag in this key, a preset switch left a stale, differently-SAMPLED polyline
   * here against a freshly-keyed height profile, and the two disagreed about their array
   * length: `RangeError: offset is out of bounds` out of canonicalProfile. Found by
   * tools/diag-stations.mjs, which is the only tool in the repo that drives more than one
   * preset in one process — every single-preset check passed straight through it. */
  const key = `${tag}:${seed}:${tier}:${i},${j},${dir}`;
  let g = GEOM.get(key);
  if (g === undefined) {
    g = buildGeom(i, j, dir, tier, seed, tag);
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
/* ── WHERE ROADS MEET, AS OPPOSED TO WHERE THEY CROSS ───────────────────────
 *
 * Operator, four times now: "junctions still overlapping roads not t splits and 4 ways -- many
 * issues."
 *
 * THIS IS WHY, and it is not the thing five previous attempts went after. `findCrossings` below
 * deliberately SKIPS every pair of edges that shares a lattice node (see `sharesNode`), and it is
 * right to: those pairs are the network CONTINUING, and counting them as crossings swamped the angle
 * census 8 to 1. But render/road.js builds its junction geometry from `findCrossings` and from
 * nothing else. So a T-split or a four-way at a lattice node — which is what almost every junction
 * in this world actually is — got NO junction patch at all. The ribbons simply ran over each other,
 * which is precisely "overlapping roads, not T splits and 4 ways", and being coplanar is also what
 * made them flash.
 *
 * Five plan-view fixes were falsified against the braid (docs/BACKLOG.md) — fan mixes, node jitter,
 * shorter junction tangents, crossing-angle knobs. Every one of them was trying to change where the
 * roads GO. None of them could have worked, because the roads were never the problem: the junction
 * was missing from the picture.
 *
 * So: group live edges by the node they share, keep the nodes where three or more meet, and hand
 * back one record per NODE for the renderer to lay an apron over. `findCrossings` is left exactly as
 * it is — the census depends on it, and a "crossing point" at a shared node is degenerate anyway.
 *
 * @param {Array} edges as `edgesInBox` returns them
 * @param {number} seed
 * @returns {Array<{nodeKey:string, x:number, z:number, tier:number, legs:Array, radius:number}>}
 */
export function findNodeJunctions(edges, seed) {
  const byNode = new Map();
  for (const e of edges) {
    for (const k of edgeNodeKeys(e)) {
      let list = byNode.get(k);
      if (!list) byNode.set(k, (list = []));
      list.push(e);
    }
  }
  const out = [];
  const pos = [0, 0];
  for (const [nodeKey, legs] of byNode) {
    /* THREE IS THE DEFINITION OF A JUNCTION. Two edges at a node is the road carrying on — nodeDir
     * gives them one shared tangent, so they are a straight or a bend, and laying an apron over
     * every bend in the network would be both wrong and enormously expensive. */
    if (legs.length < 3) continue;
    const [tier, rest] = nodeKey.split(':');
    const [i, j] = rest.split(',').map(Number);
    nodePos(i, j, Number(tier), seed, pos);
    let width = 0;
    for (const e of legs) width = Math.max(width, e.width || 6);
    out.push({
      nodeKey,
      x: pos[0],
      z: pos[1],
      tier: Number(tier),
      legs,
      /* An apron a little wider than the widest leg's half-width. 1.6x covers the corner fillets
       * where two legs leave at an angle without throwing tarmac out into the fields — about 6.9 m
       * on an arterial, against the ~80 m the braid currently smears across. */
      radius: (width / 2) * 1.6,
    });
  }
  return out;
}

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

/* A TURNING HEAD IS PAVED GROUND, SO THE CARVE HOLDS IT FLAT.
 *
 * Operator, four times: "roads still end without a closure" — and every closure was there.
 * tools/diag-terminus.mjs T1b/T8/T9 report 0 dead ends without a head, 0 heads with fewer than two
 * bollards and 0 without a board, over 106 heads. What it also reported, and what the eye actually
 * sees, is T5 and T6: the drawn head flying up to 0.157 m above the ground it is laid on, and its
 * rim falling away from the road beside it. A paved lip hanging over an embankment is what a road
 * that "just stops" looks like.
 *
 * The renderer already searches TERMINUS_RADII downwards trying to hold that fall under 0.16 m,
 * but on a steep sidehill the search bottoms out at 1.0 — no widening at all — and the fall is
 * still over a metre, because `carve()` holds the ground DEAD FLAT only inside the carriageway
 * half-width and batters everything past it at 1:1.6. The head cannot be built level on ground the
 * carve never levelled.
 *
 * So the ground is told about the head. Within a head's radius of an end that genuinely stops, the
 * flat shelf grows to the head's own footprint and the batter starts from there. 1.55 is the same
 * number as the renderer's widest radius, so the paved disc and the level ground are one disc by
 * construction rather than two numbers that happen to agree.
 *
 * MEASURED: the chord sag over every head goes 0.157 m -> 0.0146 m worst, and the triangles flying
 * above the 0.10 m of lift the overlay has go 44 of 51092 -> 0 of 42836. What it does NOT fix is
 * T6's single outlier at (31213,-31823), 31 km out, which stays at ~1.2 m: that head sits on
 * ground steep enough that a level disc of any size has a rim well below the road, and the honest
 * answer there is a smaller head, not a flatter one. Recorded rather than hidden.
 *
 * Blended, not switched: a hard `if (dEnd < r)` would put a step in the carve exactly along the
 * circle where the test flips, which is the failure this file keeps having. */
const TERMINUS_PAVE = 1.55;
/**
 * The carriageway half-width to use at (x,z) — the edge's own, except near an end that stops dead,
 * where it opens out to the turning head's footprint. Falls back to `e.width * 0.5` for any edge a
 * caller built without `deadEnds` (RoadField fills it in; a bare edge from `edgesInBox` has none),
 * so this can never be the reason a query changes its answer.
 */
function terminusHalf(e, x, z) {
  const half = e.width * 0.5;
  const ends = e.deadEnds;
  if (!ends || !ends.length) return half;
  const r = half * TERMINUS_PAVE;
  let best = Infinity;
  for (let i = 0; i < ends.length; i += 2) {
    const d = Math.hypot(x - ends[i], z - ends[i + 1]);
    if (d < best) best = d;
  }
  if (best >= r * 1.4) return half;
  return lerp(r, half, smoothstep(r * 0.6, r * 1.4, best));
}

/** Deepest fill or cutting a road is allowed to ask the land for, in metres. */
const MAX_EARTHWORK = 18;
/* THE SAME BUDGET, DOUBLED, BUT ONLY WHERE TWO ROADS ACTUALLY CROSS.
 *
 * Operator, with a repro: "terrain deformation issues around junctions: alpine seed 4189486",
 * and before that a screenshot of roads stepping through each other.
 *
 * The clamp in levelAgainst caps a levelling target to the LAND plus/minus MAX_EARTHWORK, and
 * that is right for open road: a lane crossing an arterial that runs 40 m lower in a valley
 * must not be dragged the whole way down and left needing a 30 m embankment. But applied AT a
 * crossing it produces the worse thing: the two roads simply do not meet, and the census in
 * tools/diag-crosslevel.mjs showed exactly that — 27 of 926 crossings more than a metre out,
 * the worst 24.33 m at (-2389,886) on seed 7, which on screen is a wall with tarmac on top.
 *
 * A 24 m wall across a road you are driving on is worse than a 24 m embankment beside it. So
 * the budget doubles inside the capture radius, which is where a crossing actually is, and
 * stays exactly as it was everywhere else. Doubling rather than removing: it has to remain
 * bounded, or a crossing in a ravine asks the carve for an unbuildable tower. */
const CROSS_EARTHWORK = MAX_EARTHWORK * 2;

/* ── how long a levelled junction takes to hand the road back ────────────────────────────────
 *
 * See pass 2 of `levelAgainst` for the mechanism and the before/after numbers. These three
 * numbers are the whole of the operator's "smooth this out incredibly", so they are stated in
 * metres of road, which is the unit a driver feels, and not in samples.
 *
 * LEVEL_RAMP 260 m. Highway practice sizes a vertical curve as L = K * A, where A is the
 * algebraic change of grade in per cent and K is a comfort constant — about 10 m per per-cent
 * for a road driven at these speeds. The worst junction in the 6 km census asked for a 30 pp
 * change of grade, so 260 m is that curve with a little to spare, and it is comfortably inside
 * the 620 m tier-1 cell so a lane still has open road between its junctions.
 *
 * Swept 120/180/260/340 m on tools/diag-junction-smooth.mjs, and the grade BREAK is flat across
 * the range (mean 1.15/1.04/1.06/1.08 pp) — what actually moves is how steep the road is
 * THROUGH a junction, mean grade 8.79 / 8.56 / 8.39 / 8.34 per cent, which is the thing a driver
 * feels as the road heaving up to meet another one. It flattens out past 260 and the extra reach
 * only buys more road moved, so that is where it stops.
 *
 * LEVEL_PLATEAU_W 0.55. How much of the apex's authority a neighbouring sample must still carry
 * to count as being ON the junction rather than on the approach to it. Pass 1's weight falls
 * from 1 to 0 as the road pulls away from the other carriageway between 4 m and 18 m, so 0.55
 * puts the plateau edge at about 10.5 m from the other centreline — just past the far side of
 * an arterial's 8.6 m carriageway, which is the width the two roads genuinely share.
 *
 * LEVEL_SITE_MAX 70 m. A run of captured samples longer than this is not one crossing, it is a
 * lane running ALONGSIDE another road, and describing several hundred metres of that with one
 * sample's correction would lift the lot. Long runs are cut into pieces this size, each with
 * its own plateau, and the blend below knits them back together.
 */
const LEVEL_RAMP = 260;
const LEVEL_PLATEAU_W = 0.55;
const LEVEL_SITE_MAX = 70;

/* ── THE ELEVATION HALF OF THE SIXTH APPROACH (B1) ───────────────────────────────────────────
 *
 * docs/BACKLOG.md, after five falsified attempts: "The separation and the gradient are only in
 * conflict because the tangent is doing both jobs. Give the node a SHORT tangent for the first few
 * samples and let the profile smooth over a longer window than the geometry does."
 *
 * The plan half of that already shipped as NODE_FAN. This is the other half, and it exists because
 * of the table in approach 5: shortening the tangent buys separation and pays for it in GRADIENT,
 * one for one (0.60 -> spread 25.8% but alpine 39.0%; 0.22 -> spread 7.3% but 63.6%). The reason is
 * written down there — "a short tangent makes the road hug its chord, and the chord does not follow
 * the terrain". That is an ELEVATION consequence of a PLAN decision, so it can be answered in
 * elevation: near a node, smooth the height profile over a longer window than the rest of the edge
 * uses, and the road rides over the ground the chord cuts through instead of following it.
 *
 * JOINT_GRADE_BOOST multiplies the tier's own `grade` smoothing length, and JOINT_WINDOW is how far
 * from a node that longer window applies, in metres of road — the same unit as LEVEL_RAMP, and
 * chosen to sit just inside it so this releases before the junction feather does. The blend is a
 * smoothstep, so there is no grade break where the two windows meet.
 *
 * Both end samples are untouched by construction (the mask is applied to a blur of the SAME
 * profile, and `pinToNodes` runs afterwards and owns the ends), so S3 — a node has one height —
 * cannot move. diag-seam is the check that would catch it if it did.
 */
const JOINT_GRADE_BOOST = 2.0;
const JOINT_WINDOW = 140;

/* The PLAN half's second lever: the tangent length itself, as a fraction of what the backoff loop
 * would otherwise keep. This is approach 5 out of docs/BACKLOG.md, which was falsified ON ITS OWN
 * because it traded separation for gradient one for one. It is only worth re-opening WITH the
 * longer elevation window above, which is the whole idea of the sixth approach. 1 = off. */
const JOINT_TANGENT = 1;

/* How close to this edge's own lattice node the feather's PLATEAU may come, metres.
 *
 * MEASURED, and it is the single thing that decides whether this change ships. `pinToNodes` puts
 * an edge's two endpoints on their node's one height, every other edge at that node is on the
 * same height, and tools/diag-seam.mjs's S3 measures that agreement at a bar of 1 m. It is
 * 0.0000 m and it is what falsified three of the four fixes in BACKLOG B2.
 *
 * With the plateau free to run all the way to an endpoint, S3 went 0.0000 -> 2.7296 m at node
 * 1:-1,0 on seed 424242: a crossing ten metres short of a node held its correction ONTO the node
 * sample, and the sibling lane meeting there had no such crossing and stayed put. Collapsing the
 * plateau to its single apex sample put S3 straight back to 0.0000 with the 260 m ramp still in
 * place, so it is the plateau reaching the node that does it and not the ramp — the ramp is
 * already clipped to the room it has and lands on exactly zero at the endpoint.
 *
 * 20 m, i.e. one ordinary sample step of road (`step` is 19 on both tiers): the smallest clip
 * that keeps a plateau off the endpoint at all. Bigger is worse, not safer, and measurably so —
 * at 60 m and 110 m the clip stops merely trimming a plateau and starts RELOCATING it away from
 * the crossing it belongs to, and the worst open-road grade break went 38.81 -> 100.60 pp and
 * 93.34 pp respectively while the junctions themselves got no better. S3 is 0.0000 at every
 * value tried, so this is chosen on the smoothness numbers, not on the seam.
 *
 * The DIFFERENCE between this and B2's falsified attempt #4 — which switched levelling off near
 * nodes and collapsed the crossing census from 34 bad boxes to 131 — is that only the FEATHER is
 * held back here. Whatever pass 1 asked for at a sample still happens, everywhere, exactly as it
 * did before this change: a crossing 10 m from a node is levelled just as hard as it ever was, it
 * simply does not get to drag its neighbours into a node it does not own.
 */
const LEVEL_END_KEEP = 20;

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
  return clamp(Math.round((metres * metres) / (2 * w * spacing * spacing)), 1, 320);
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

  /* THE ELEVATION HALF OF THE SIXTH APPROACH (B1): a LONGER smoothing window for the road either
   * side of a node than the middle of the edge gets. See JOINT_GRADE_BOOST above for why.
   *
   * IT RUNS AFTER THE EARTHWORK CLAMP, and that position is a measurement, not a preference. Run
   * BEFORE the clamp it made every median grade better (alpine 5.7 -> 5.1%) and every WORST grade
   * worse (meadow 26.3 -> 28.5, rolling 26.1 -> 29.0, alpine 28.1 -> 28.8): a flatter approach
   * leaves the land further away, the clamp then chops it back to MAX_EARTHWORK, and a clamp is a
   * corner. Here the long window smooths the corner the clamp just made instead of feeding it.
   *
   * The floors are re-applied below, so this cannot put the road under water. Both end samples are
   * untouched (`pinToNodes` owns them and has already run), so S3 cannot move. */
  if (JOINT_GRADE_BOOST > 1 && n > 4) {
    const long = Float32Array.from(e.y);
    blur(long, tmp, n, passesFor(T.grade * JOINT_GRADE_BOOST, e.span, 0.25), 0.25);
    for (let k = 1; k < n - 1; k++) {
      // metres of road to the nearer end — e.span is this edge's own mean sample spacing
      const d = Math.min(k, n - 1 - k) * e.span;
      if (d >= JOINT_WINDOW) continue;
      const w = 1 - smoothstep(0, JOINT_WINDOW, d);
      const y = e.y[k] + (long[k] - e.y[k]) * w;
      e.y[k] = y > wl[k] ? y : wl[k];
    }
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
 *   L0    raw, levelled against the ARTERIALS that outrank it where they cross it away from
 *         its own lattice nodes. Only tier 0 has one, and for tier 0 it is the final answer.
 *   L1    raw, levelled against the L0 height of every ARTERIAL that crosses this edge.
 *   L2    L1, levelled against the L1 height of every LANE that crosses it and outranks it
 *         (the same stable key order the old two-pass code used), and never in a place the
 *         arterial pass already claimed.
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
/** How far each edge's departure tangent is blended from the node's shared line towards its own
 *  chord. 0 is the old behaviour (every edge leaves a node along one line — the braiding).
 *
 *  0.28 is chosen for MARGIN, not because it is the best number. Measured braiding, worst seed:
 *      0.00 -> 33.3%   0.12 -> 31.8%   0.20 -> 26.9%   0.24 -> 21.5%
 *      0.28 -> 15.4%   0.31 -> 12.8%   0.35 -> 9.5% but BREAKS THE BOAT
 *  At 0.35 five checks in bench-boat fail — the boat is no longer afloat and will not turn — because
 *  fanning the departures moves whole edges, and past that point a road reaches water the bench's
 *  steep-bank fixture depends on. 0.31 is clean and 0.35 is not, so the cliff is somewhere between;
 *  0.28 sits a fifth below it rather than a tenth. Worth knowing before anyone turns this up: the
 *  thing that breaks is the BOAT, not the roads, and it breaks suddenly.
 *
 *  AND IT COSTS MID-EDGE SQUARENESS, at every strength tried — this is a TRADE, not a free win,
 *  and it is recorded here rather than left to be discovered. diag-crossing-angle, 12 km box:
 *      fan 0.00  mean 6.89 deg  worst 31.5      fan 0.14  mean 8.39  worst 50.9
 *      fan 0.20  mean 9.34      worst 74.5      fan 0.28  mean 9.43  worst 61.5
 *  Braiding is what the operator reports over and over ("roads go in and out of each other"), and
 *  the crossing-STEP census improves alongside it (34 boxes/7.03 m -> 26 boxes/3.94 m), so the fan
 *  is taken — but a road crossing another at 61 degrees off square is a real thing he can see, and
 *  it is now its own tracked item rather than a footnote. */
const NODE_FAN = 0.31;

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
/** key -> Float32Array, an ARTERIAL levelled against the arterials that outrank it. Tier 0 only. */
const LVL0 = new Map();
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
  /* `fieldTag` first, and it is not redundant with the two land probes that follow.
   *
   * Those probe the land function the CALLER passed, which is what the profile is actually
   * built from and which tools do sometimes substitute. `fieldTag` probes world/field.js's own
   * land AND its water plane — the field the water cull reads, and therefore the field that
   * decides which edges exist and what shape the survivors are squared into. A preset that
   * moved sea level without moving a metre of ground would leave the two land probes
   * identical while changing the network underneath them, and a cached profile would then be
   * a different LENGTH from the edge it was cached against. Cheap insurance against a class of
   * bug that shows up as a RangeError three files away. */
  return `${fieldTag(seed)}|${waterAt ? 'w' : 'd'}|${Math.round(land(0, 0) * 64)}|${Math.round(land(1237.5, -911.25) * 64)}`;
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

/** `partnersOf`, but only the ARTERIALS — the same box, without building the lanes in it. */
function arterialPartnersOf(e, seed) {
  const list = geomsInBox(e.minX, e.minZ, e.maxX, e.maxZ, seed, CROSS_PAD, geomFor, undefined, 0).map(edgeFrom);
  const out = [];
  for (const o of list) if (o.key !== e.key) out.push(o);
  out.sort(keyOrder);
  return out;
}

/**
 * How close to a lattice node an arterial's profile becomes untouchable, in metres.
 *
 * The whole reason arterial-vs-arterial levelling was reverted last time is at a node: two
 * arterials that SHARE an end node each smooth their own profile over their own kilometre of
 * ground, arrive at that node disagreeing, and pulling one onto the other there moved 17 of 17
 * arterials in a 4 km square by up to 36 m and put a 134% gradient on the trunk network.
 *
 * `pinToNodes` already settles the node itself — both edges are pinned to ONE `nodeY`. So the
 * node is not a levelling question and never was; the crossing a kilometre AWAY from it is.
 * This radius is what separates the two. 150 m: four tier-0 samples (step 38 m) of ramp, so a
 * correction feathers in over a real length rather than stepping; comfortably past the 18 m
 * capture radius below so a node can never be levelled "by accident" as the nearest point on a
 * partner; and a twelfth of the 1800 m tier-0 cell, so it cannot swallow a genuine mid-edge
 * crossing.
 */
const GUARD_RADIUS = 150;

/** World positions of the two lattice nodes an edge runs between, as a flat [x,z,x,z]. */
function edgeNodeXZ(e, seed) {
  const [tier, rest] = e.key.split(':');
  const [i, j, dir] = rest.split(',').map(Number);
  const t = Number(tier);
  const p = [0, 0];
  const out = new Array(4);
  nodePos(i, j, t, seed, p);
  out[0] = p[0];
  out[1] = p[1];
  nodePos(dir === 0 ? i + 1 : i, dir === 0 ? j : j + 1, t, seed, p);
  out[2] = p[0];
  out[3] = p[1];
  return out;
}

/**
 * THE elevation of an ARTERIAL: raw, levelled against the arterials that outrank it where they
 * genuinely cross it mid-run, and never touched within `GUARD_RADIUS` of its own lattice nodes.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT THE THING THAT WAS REVERTED ──────────────────────────
 *
 * Two arterials crossing each other were never levelled at all, and the census in
 * tools/diag-crosslevel.mjs prices that at 19 crossings over 1 m across five seeds in a 6 km
 * box, worst 27.33 m — a road passing bodily through another road, which is the fall-through
 * this project spent days eliminating. It is also what held back the operator's #1 request:
 * spawning the car facing the other way down the road drives it through one of them.
 *
 * The earlier attempt failed for a reason that is precise, and this is the difference:
 *
 *   IT FIRED AT SHARED NODES. Two arterials leaving one node run side by side there by
 *   construction (`nodeDir` gives them one shared tangent), so `levelAgainst`'s 18 m capture
 *   finds the partner at the node itself, on every adjacent pair in the network — which is
 *   every arterial, not a handful of crossings. `guard` closes that: an arterial's own two
 *   nodes are untouchable, so this pass can only ever move the MIDDLE of a road.
 *
 * The measurement that says it worked this time is not "17 of 17 moved" against "some moved" —
 * it is the same numbers the revert was judged on: tools/diag-relief.mjs's per-preset worst
 * gradient and tools/diag-seam.mjs's S3 (edges meeting at a shared node), both of which the
 * reverted version wrecked and both of which are gates on this one.
 *
 * Recursion is bounded the same way L1/L2 are: an arterial yields only to arterials whose key
 * sorts BEFORE its own, so the chain is strictly decreasing and cannot cycle, and every level
 * is memoised.
 */
function level0(e, tag, seed, land, waterAt) {
  const k = `${tag}:${e.key}`;
  const hit = LVL0.get(k);
  if (hit) return hit;
  const raw = rawProfile(e, tag, seed, land, waterAt);
  const winners = arterialPartnersOf(e, seed).filter((o) => o.key < e.key);
  if (!winners.length) return cacheSet(LVL0, k, raw.y);
  // Claim the cache BEFORE recursing so a partner that somehow asks back gets the raw profile
  // rather than looping. The key order makes that impossible, but a cache that depends on an
  // invariant holding elsewhere is the kind of thing this file has been bitten by.
  cacheSet(LVL0, k, raw.y);
  const work = workEdge(e, raw);
  for (const o of winners) o.y.set(level0(o, tag, seed, land, waterAt));
  levelAgainst(work, winners, winners.length, { guard: edgeNodeXZ(e, seed) });
  /* NO POST-CLAMP HERE, and that is a measured decision, not an omission.
   *
   * canonicalProfile ends with an earthwork-and-water clamp over the lane it just levelled, so
   * the obvious thing is to do the same to an arterial. Doing it cost the trunk network its
   * gradients, and by a lot: worst arterial grade rolling 27.8% -> 45.2%, alpine 28.1% -> 50.1%,
   * dunes 21.9% -> 46.7% on tools/diag-relief.mjs, with everything else in this function
   * unchanged. Removing the clamp put all six presets back on their exact pre-change figures.
   *
   * The mechanism is written down 300 lines below, in levelAgainst's own comment: a clamp
   * applied AFTER the feather puts a step in the profile between one sample and the next, which
   * is a wall, not a road. An arterial's raw profile can legitimately sit outside the ±18 m
   * earthwork budget already (profileEdge's clamp is against a different quantity), so the
   * clamp was not trimming a correction, it was cutting the ORIGINAL profile in half a metre of
   * road — and tier 0's samples are 19 m apart, so a 4 m cut is a 21% gradient on its own.
   *
   * The two things the clamp was there to protect are protected where they belong instead:
   * levelAgainst caps its TARGET at land ± MAX_EARTHWORK before it feathers anything, and no
   * road may go under water — which is a gate, `node tools/diag-water.mjs`, held at 0 samples
   * underwater across this change.
   */
  return cacheSet(LVL0, k, work.y);
}

/**
 * Levelled against the arterials that cross it, each at its FINAL height. Final for arterials,
 * which are settled by `level0`.
 */
function level1(e, tag, seed, land, waterAt) {
  if (e.tier === 0) return level0(e, tag, seed, land, waterAt);
  const k = `${tag}:${e.key}`;
  const hit = LVL1.get(k);
  if (hit) return hit;
  const raw = rawProfile(e, tag, seed, land, waterAt);
  const work = workEdge(e, raw);
  const arts = partnersOf(e, seed).filter((o) => o.tier === 0);
  for (const o of arts) o.y.set(level0(o, tag, seed, land, waterAt));
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
  if (e.tier === 0) return cacheSet(LVL2, k, { y: level0(e, tag, seed, land, waterAt), water: raw.water });

  const arts = [];
  const lanes = [];
  for (const o of partnersOf(e, seed)) {
    if (o.tier === 0) arts.push(o);
    // "Outranks" is the same stable key order the old two-pass code used: arbitrary, but
    // CONSISTENT, which is what stops A pulling B while B pulls A and the pair oscillating.
    else if (o.key < e.key) lanes.push(o);
  }

  const work = workEdge(e, raw);
  for (const o of arts) o.y.set(level0(o, tag, seed, land, waterAt));
  /* The authority the ARTERIAL pass takes, kept and handed to the lane pass below.
   *
   * Without it the second pass quietly undid the first. At (-253,1182) on the shipped seed —
   * 990 m from spawn, straight down the reversed heading, which is why it mattered — lane
   * 1:-1,1,0 crosses arterial 0:-1,0,0 and was correctly pulled onto it, and then crosses
   * lane 1:-1,0,1 SEVENTEEN METRES further on, which is inside the 18 m capture radius, and
   * was pulled straight back off it. Result: 2.51 m out of level at an arterial junction, in
   * every box, on a road the player is now pointed at. The arterial is the top of the
   * priority order or it is not; this is what makes it so. */
  const held = new Float32Array(work.y.length);
  /* Where the ARTERIAL pass actually took hold, remember it — the final earthwork clamp below
   * has to know the difference between "this lane wandered 20 m off the ground on its own" and
   * "this lane was pulled 20 m to meet an arterial it crosses". Clamping both the same way was
   * cutting the correction straight back off and leaving the step.
   *
   * `pulled` is the FEATHER's reach and `held` is the crossing's own tight authority; they were
   * one array until pass 2's ramp became a real length, at which point they had to part company.
   * See levelAgainst's `budget` note: one of them blocks the next pass, the other opens the
   * earthwork budget, and giving the second job to the first number locks the lane-vs-lane pass
   * out of every road within a ramp length of an arterial. */
  const pulled = new Float32Array(work.y.length);
  levelAgainst(work, arts, arts.length, { record: held, budget: pulled });
  cacheSet(LVL1, k, Float32Array.from(work.y));
  // Each outranking lane at ITS OWN level-1 height. One hop, and no further: that bound is
  // the difference between an answer and the unbounded chain the old code had.
  for (const o of lanes) o.y.set(level1(o, tag, seed, land, waterAt));
  /* No `record` on this one any more, and that is a deletion rather than an oversight: the only
   * reader of the lane pass's authority was the merge into `pulled` on the line below, and
   * `budget` now writes there directly. A third pass over this edge would need it back. */
  levelAgainst(work, lanes, lanes.length, { respect: held, budget: pulled });

  /* Floors last, and both of them. levelCrossings runs after profileEdge's earthwork clamp,
   * so a correction that meets a road in a valley can leave the lane far outside the 18 m
   * budget the carve's batter is sized for; and a lane pulled down over water can end up
   * under it. Every other constraint here has a tolerance — "the road is under the lake"
   * does not. */
  const y = work.y;
  const wl = raw.water;
  const ld = raw.land;
  for (let i = 0; i < y.length; i++) {
    /* The budget is bigger exactly where a crossing was levelled, and eases back to the open-road
     * figure over the same feather the correction itself used (`pulled` is the weight that pass
     * recorded, so this cannot put a step anywhere the correction did not). Without it this loop
     * was undoing the levelling it runs after: 12.91 m of step survived at (1448,-1952) between
     * an arterial and a lane that had been correctly pulled onto it and then clamped back off. */
    const budget = lerp(MAX_EARTHWORK, CROSS_EARTHWORK, clamp01(pulled[i]));
    const d = y[i] - ld[i];
    if (d > budget) y[i] = ld[i] + budget;
    else if (d < -budget) y[i] = ld[i] - budget;
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
      /* WHERE THIS EDGE STOPS DEAD, in world metres — [x,z,...], empty for a road that carries on
       * at both ends. `carve` widens its flat shelf to a turning head's footprint at these points;
       * see TERMINUS_PAVE. Computed once per field rather than per query because `edgeDeadEnds` is
       * roads.js's own live-degree rule and the answer cannot change while a field is alive. */
      const dead = edgeDeadEnds(e, seed, tag);
      const n = e.pts.length;
      e.deadEnds = [];
      if (dead[0]) e.deadEnds.push(e.pts[0], e.pts[1]);
      if (dead[1]) e.deadEnds.push(e.pts[n - 2], e.pts[n - 1]);
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
    // Identity of whichever edge currently holds `cover` (the largest single weight seen) —
    // tier/tangent are directions, not heights, so unlike y/width they are picked from ONE
    // edge rather than blended; see the note where `cover` is updated below.
    let bt = 0,
      btx = 1,
      btz = 0;
    /* `out.d` is the TRUE nearest edge, tracked unconditionally below (every edge that clears
     * `reach`, before the weight gate can `continue` past it) rather than blended, or handed
     * to whichever edge currently holds `cover`, the way tier/tangent are just below.
     * Distance-to-road is not a quantity a junction should average or hand to the higher-
     * weighted edge: a point standing dead centre on edge A (its own `ed` is 0) with a wider
     * edge B merely nearby would report several metres out instead of 0, and groundFromCarve
     * (terrain.js) reads `d` against `y`/`width` to size its batter falloff — inflating it
     * there under-commits to the road you are actually standing on and over-blends toward the
     * raw land beside it. On a lakeside cutting that read as wet while standing still on dry
     * tarmac (tools/bench-rescue.mjs's lakeside-road check). This also doubles as the fallback
     * for out.tier/tx/tz below when nothing has any blend weight at all (wSum stays 0). */
    let bdAny = Infinity;
    let btAny = 0,
      btxAny = 1,
      btzAny = 0;
    /* The raw land here, evaluated at most ONCE and only if some edge actually needs it.
     * It used to be sampled inside the per-edge loop, so a point near a junction paid for
     * the same biome-and-relief evaluation three times — and it is the single most expensive
     * thing in this function at 3.6 µs against 5.0 µs for the whole call. NaN is the "not
     * yet" marker because a height of 0 is a perfectly ordinary answer. */
    let landH = NaN;

    for (const e of this.edges) {
      const half = terminusHalf(e, x, z);
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

      // Loose fallback: every edge that clears the coarse box, regardless of its own weight —
      // see the comment on bdAny above.
      if (ed < bdAny) {
        bdAny = ed;
        btAny = e.tier;
        btxAny = etx;
        btzAny = etz;
      }

      /* Shoulder width scales with the height difference this edge is asking for, so an
       * embankment is battered at about 1:1.5 and never becomes a wall.
       *
       * Inside the carriageway there is no batter yet — smoothstep(half, shoulder, ed) is
       * identically zero for ed <= half whatever the shoulder works out to — so the weight
       * is exactly 1 and the land sample that only feeds the shoulder is not needed. That is
       * not an approximation, it is the same number by a shorter route, and it is the whole
       * population of points the road ribbon asks about.
       *
       * drop is NOT capped here — see terrain.js's own BATTER/groundFromCarve, which uses this
       * identical formula on this identical drop, uncapped, on purpose ("capping the width
       * while the height keeps growing is how you build a wall"). This copy used to cap it at
       * MAX_EARTHWORK + 4, sized for a different question (how far a ROAD's own profile can
       * sit from the land directly under it) than the one `drop` actually answers here (how far
       * THIS query point's land sits from the road) — the two disagree by exactly the query
       * point's own local relief, which is unbounded by that clamp. The result: a point could
       * read mask/cover near zero here (outside the capped shoulder) while groundFromCarve,
       * five lines later, blended a third of the way to a road 40 m away anyway, because ITS
       * shoulder was never capped. That gap between "roads.js says negligible" and "terrain.js
       * still blends" is where a smoothly-fading tail turns into the one or two dark, near-
       * vertical strips the operator's screenshots showed — mask crossing terrain.js's 0.001
       * cutoff at a totally different distance than where the uncapped falloff is actually
       * small. Matching the two removes the gap; `Math.min(..., reach)` below is a safety
       * ceiling only, tied to the box this edge already qualified against, never tighter than
       * what real measurement needed (drop maxed out at 29 m over a 2.4 km square around the
       * default spawn, seed 20260726 — the same sample diag-cliffs.mjs walks; the ceiling only
       * bites past ~41–44 m, well clear of that). */
      let w = 1;
      if (ed > half) {
        if (landH !== landH) landH = this._land(x, z);
        const drop = Math.abs(ey - landH);
        /* 1.6 on the fill side, 2.2 on the CUTTING side (land above road) — the identical
         * split terrain.js's groundFromCarve applies to the identical drop. The whole long
         * note above is about what happens when these two copies stop agreeing, so when one
         * moves the other moves in the same commit. See terrain.js's CUT_BATTER for why the
         * cutting side can afford a wider shoulder and the fill side cannot. */
        const shoulder = Math.min(half + 3.0 + drop * (landH > ey ? 2.2 : 1.6), reach);
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
      // tier/tangent are a direction and a tier number, not heights — blending two crossing
      // roads' tangents would point neither along the actual carriageway, so these are picked
      // from whichever single edge currently holds the largest weight rather than averaged.
      if (w > cover) {
        cover = w;
        bt = e.tier;
        btx = etx;
        btz = etz;
      }
      // "Am I on SOME carriageway" is a max over edges, not a property of whichever is
      // nearest — max of continuous functions is continuous, nearest-edge selection is not.
      const edgeHere = 1 - smoothstep(half - 0.4, half + 0.35, ed);
      if (edgeHere > edgeMax) edgeMax = edgeHere;
    }

    out.d = bdAny;
    out.tier = wSum > 1e-6 ? bt : btAny;
    out.tx = wSum > 1e-6 ? btx : btxAny;
    out.tz = wSum > 1e-6 ? btz : btzAny;
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
 *
 * `opts` carries the three things a SECOND levelling pass over the same edge needs, all of
 * them measured requirements rather than options anybody chose:
 *
 *   record   Float32Array(n) — the authority this pass took at each sample, written out.
 *   respect  Float32Array(n) — authority an EARLIER pass took, which this one may not undo.
 *            Without it the lane-vs-lane pass silently overwrote the lane-vs-arterial pass
 *            17 m away from an arterial junction and put the lane back 2.51 m above the
 *            arterial it had just been levelled onto — measured at (-253,1182) on the shipped
 *            seed, 990 m from spawn straight down the reversed heading.
 *   guard    [x,z,...] — points this edge's profile may not be moved near, at GUARD_RADIUS.
 *            Used for an edge's OWN lattice nodes when arterials level against each other:
 *            an arterial endpoint is pinned to a node height its neighbours are also pinned
 *            to, and moving it is precisely how the reverted attempt put a 134% gradient on
 *            the trunk network.
 *   budget   Float32Array(n) — how far the FEATHER reaches, written out, 0..1. Deliberately a
 *            second array rather than `record` doing both jobs: `record` feeds `respect`, which
 *            BLOCKS a later pass, and must stay tight to the crossing or the lane-vs-lane pass
 *            would be locked out of every road within a ramp length of an arterial. `budget`
 *            feeds canonicalProfile's earthwork clamp, which has to know the whole reach or it
 *            cuts the far end of the ramp back to the open-road budget and puts back exactly
 *            the step this pass exists to remove.
 */
function levelAgainst(lane, others, count, opts = null) {
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
  const respect = opts && opts.respect;
  const record = opts && opts.record;
  const guard = opts && opts.guard;
  // Pass 1: find every point of this lane that sits on another road, and by how much it is
  // out. Feathering happens in pass 2 so one crossing cannot undo another.
  const fix = new Float32Array(n);
  const weight = new Float32Array(n);
  /* What share of each sample this pass may touch AT ALL — kept so the feather in pass 2 can be
   * masked by it too. Smoothing a correction outwards is exactly how a pass reaches into a
   * sample it was not allowed to claim directly. */
  const own = new Float32Array(n);
  for (let k = 0; k < n; k++) own[k] = 1;
  for (let k = 0; k < n; k++) {
    const x = lane.pts[k * 2];
    const z = lane.pts[k * 2 + 1];
    /* How much of this sample this pass is allowed to own: nothing an earlier, higher-priority
     * pass already claimed, and nothing inside a guarded node. Computed before the distance
     * search so a fully-blocked sample costs no segment tests at all. */
    let allow = respect ? 1 - respect[k] : 1;
    if (guard && allow > 0) {
      for (let g = 0; g < guard.length; g += 2) {
        const gd = Math.hypot(x - guard[g], z - guard[g + 1]);
        if (gd < GUARD_RADIUS) allow = Math.min(allow, smoothstep(0, GUARD_RADIUS, gd));
      }
    }
    own[k] = allow;
    if (allow <= 0.001) continue;
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
      // CROSS_EARTHWORK, not MAX_EARTHWORK — see its own comment. This branch only runs within
      // 18 m of another carriageway, i.e. only at a crossing.
      const tgt = clamp(bestY, ld - CROSS_EARTHWORK, ld + CROSS_EARTHWORK);
      fix[k] = tgt - lane.y[k];
      weight[k] = w * allow;
    }
  }
  if (record) for (let k = 0; k < n; k++) if (weight[k] > record[k]) record[k] = weight[k];

  /* ── Pass 2: give the correction back to the road over a LENGTH OF ROAD ───────────────────
   *
   * Operator, 3 Aug 2026: "Whenever there's a 90 degree angle junction between two roads, it's
   * going to try to bring those two roads together in a way that they're on the same elevation.
   * The problem is, it does this very abruptly. Instead it should smooth this out incredibly,
   * so that everything is nice and smooth across the board."
   *
   * WHAT IT USED TO DO, AND WHY IT WAS ABRUPT EVERYWHERE IT MATTERED. Pass 2 was a three-tap
   * blur repeated `passesFor(85, lane.span, 0.3)` times, with the crossing samples pinned so
   * the correction could not be smoothed away. That is a diffusion in ARRAY INDEX space, and
   * `passesFor` converts 85 m into a pass count using `lane.span` — the edge's MEAN sample
   * spacing, about 20 m. But an edge is not evenly sampled: `squareCrossings` re-emits the
   * polyline at `CROSS_SQUARE_STEP` (4 m) through exactly the windows this pass cares about,
   * so at a levelled crossing the samples are five times closer together than `span` claims and
   * the same 30 passes reach sqrt(2*0.3*30)*4 = 17 m of road instead of 85. The feather was
   * therefore SHORTEST precisely where the correction was LARGEST — and a pinned apex with a
   * short two-sided ramp is a tent, whose peak is a slope discontinuity by construction.
   *
   * The evidence is tools/diag-junction-smooth.mjs — 3 seeds, 6 km box, 100 levelled crossings,
   * every profile resampled onto a uniform 8 m of arc first so nothing here is an artefact of
   * where the polyline happens to put its vertices. GRADE BREAK is the change of gradient over
   * one 8 m step, in percentage points; the open-road column is the same statistic on road more
   * than 320 m clear of any crossing, on the very same edges, because every road has grade
   * breaks and a junction number alone would mean nothing.
   *
   *                       worst    mean     p95    mean, junction : open road
   *     before            101.24    1.63    8.57            5.97x
   *     after              99.72    1.06    4.79            3.59x
   *
   * The mean halves, the p95 halves, junction approaches breaking by more than 10 pp go 68 -> 54
   * and by more than 20 pp go 43 -> 27, and the road is less steep through a junction as well
   * (mean grade 9.05% -> 8.39%). The WORST is unmoved, and that is honest rather than
   * disappointing: at 99.72 pp it is lane 1:-5,2,0 climbing a 33%-per-step hillside, where the
   * raw profile already carries 90% gradients before anything is levelled at all. That one is
   * tools/diag-relief.mjs's problem, not this pass's.
   *
   * WHAT IT DOES NOW. The same thing the rest of this file already does with every other
   * smoothing length: it works in metres. The correction is described as a small number of
   * SITES — one per run of samples this pass captured — each a plateau across the junction
   * itself and a `smoothstep` release either side over `LEVEL_RAMP` metres of arc length.
   * `smoothstep` is flat at both ends, so the profile leaves the plateau with zero change of
   * gradient and arrives at open road with zero change of gradient: there is no tent apex left
   * to feel. Nothing about pass 1 changed, so WHICH crossings are levelled, and by how much AT
   * the crossing, is exactly what it was — this is the elevation half only, and the plan view
   * is untouched.
   *
   * THREE VARIANTS FALSIFIED, WITH THEIR NUMBERS, so nobody spends the afternoon again:
   *
   *  a) DROP THE FLOOR ENTIRELY and let the smooth field be the whole answer. Best smoothness of
   *     anything tried — worst break 99.72 -> 74.99, mean 1.06 -> 0.85, over-10-pp 54 -> 42 — and
   *     it wrecks the thing this pass is FOR: tools/diag-crosslevel.mjs's car-box sweep goes 34 of
   *     266 to 79 of 266, crossings over a metre 34 -> 103, and the reversed-spawn gate 1 -> 3.
   *  b) GIVE A SITE THE LARGEST correction anywhere in its run rather than the one at its
   *     highest-weight sample, so the floor almost never bites. Reads well here (worst 99.72 ->
   *     74.14, over-10-pp 54 -> 49, over-20-pp 27 -> 22) and over-corrects the shoulders of a
   *     junction, pushing the lane past the road it is meeting: sweep 34 -> 61 of 266, reversed
   *     spawn 1 -> 2.
   *  c) APPLY THE FLOOR ONLY ON THE PLATEAU, leaving the shoulders to the smooth field. Buys
   *     nothing at a junction (mean 1.06 -> 1.08, worst identical) and puts a 70.98 pp break on
   *     OPEN ROAD where 30.72 was the worst — the shoulders stop agreeing with the plateau.
   *
   * All three say the same thing: the exact per-sample correction pass 1 computes is load-bearing,
   * and the only safe place to be generous is OUTSIDE it.
   */

  /* Nothing captured, nothing to feather — and this is the common case, because `_near` above
   * only asks whether the two edges' BOXES overlap. Checked before the arc length below so an
   * edge that merely passes near another one does not pay for a length integral it cannot use. */
  let any = false;
  for (let k = 0; k < n && !any; k++) if (weight[k] > 0) any = true;
  if (!any) return;

  const s = new Float64Array(n);
  for (let k = 1; k < n; k++)
    s[k] = s[k - 1] + Math.hypot(lane.pts[k * 2] - lane.pts[k * 2 - 2], lane.pts[k * 2 + 1] - lane.pts[k * 2 - 1]);
  const total = s[n - 1];

  /* One site per run of captured samples, split every LEVEL_SITE_MAX metres so a lane that runs
   * ALONGSIDE an arterial for a few hundred metres — which does happen, and is one long run,
   * not one crossing — is described by several local plateaus rather than by one road's worth of
   * a single sample's correction. */
  const sites = [];
  for (let k = 0; k < n; ) {
    if (weight[k] <= 0) {
      k++;
      continue;
    }
    let end = k;
    while (end + 1 < n && weight[end + 1] > 0) end++;
    for (let a = k; a <= end; ) {
      let b = a;
      while (b + 1 <= end && s[b + 1] - s[a] < LEVEL_SITE_MAX) b++;
      let ap = a;
      for (let q = a; q <= b; q++) if (weight[q] > weight[ap]) ap = q;
      // The plateau is the part of the site that is really ON the junction: everything still
      // carrying most of the apex's authority. Held flat so the road crosses level rather than
      // peaking at one sample.
      const floor = weight[ap] * LEVEL_PLATEAU_W;
      let p0 = ap;
      let p1 = ap;
      while (p0 > a && weight[p0 - 1] >= floor) p0--;
      while (p1 < b && weight[p1 + 1] >= floor) p1++;
      /* The plateau stops short of this edge's own lattice nodes — see LEVEL_END_KEEP. Done
       * HERE, by moving the plateau, rather than by fading the finished feather out near a
       * node, and the difference is measurable: a fade multiplied into the ramp subtracts from
       * a stretch the ramp was still climbing and digs a dip, which took the worst OPEN-ROAD
       * grade break from 38.81 pp to 98.06. Shortening the plateau instead leaves one monotone
       * shape — flat over the junction, one smoothstep down to nothing — and the ramp's own
       * room clip below then lands it on exactly zero at the node. */
      const keep = Math.min(LEVEL_END_KEEP, total * 0.4);
      let q0 = Math.max(s[p0], keep);
      let q1 = Math.min(s[p1], total - keep);
      if (q0 > q1) q0 = q1 = clamp(s[ap], keep, Math.max(keep, total - keep));
      sites.push({ v: fix[ap] * weight[ap], s0: q0, s1: q1 });
      a = b + 1;
    }
    k = end + 1;
  }
  if (!sites.length) return;

  const budget = opts && opts.budget;
  for (let k = 0; k < n; k++) {
    let acc = 0;
    let cov = 0;
    for (let i = 0; i < sites.length; i++) {
      const st = sites[i];
      const before = s[k] < st.s0;
      const d = before ? st.s0 - s[k] : s[k] > st.s1 ? s[k] - st.s1 : 0;
      let f;
      if (d <= 0) f = 1;
      else {
        /* The release may not run off the end of the edge. `pinToNodes` put this edge's two
         * endpoints ON their lattice nodes and every other edge at those nodes is pinned to the
         * same height; diag-seam's S3 measures exactly that agreement, and it is what killed the
         * three previous attempts at this (BACKLOG B2, #3/#4/#5). A ramp that reaches the end of
         * the edge with anything left in it drags one edge off a shared node and not the other.
         * So the ramp is shortened to the room it actually has, which still leaves it far longer
         * than the 17 m it had before, and smoothstep hits exactly zero with zero slope at the
         * node itself. */
        const room = before ? st.s0 : total - st.s1;
        const ramp = Math.min(LEVEL_RAMP, room);
        if (!(d < ramp)) continue;
        f = 1 - smoothstep(0, ramp, d);
      }
      acc += f * st.v;
      cov += f;
    }
    // Where two sites overlap, share the sample between them rather than adding both — two
    // crossings 60 m apart must not level a lane twice over.
    let v = cov > 1 ? acc / cov : acc;
    /* A FLOOR, not a replacement: whatever pass 1 asked for at this sample still happens. The
     * feather can only ever add reach, so no crossing can come out of this change less level
     * than it went in, which is what keeps tools/diag-crosslevel.mjs honest. */
    const core = fix[k] * weight[k];
    if (Math.abs(core) > Math.abs(v)) v = core;
    /* `fix` and `weight` were both settled in pass 1 and nothing below reads `lane.y`, so the
     * correction can go straight on rather than into a third scratch array. */
    lane.y[k] += v * own[k];
    if (budget) {
      const c = clamp01(cov) * own[k];
      if (c > budget[k]) budget[k] = c;
    }
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
