/* Wanderoad — the heightfield.
 *
 * Two layers, in this order, and the order matters:
 *
 *   1. LAND   — the weighted sum of the five biomes' relief. Pure function of (x, z, seed).
 *               This is what the road network reads to decide its own elevation.
 *   2. ROAD   — the land bent towards the road surface by the carve mask. A shelf on a
 *               hillside, a causeway over a marsh, a cutting through a dune.
 *
 * Because step 1 never looks at the road, there is no circularity and no iteration. Both
 * steps are deterministic, so the ground under your wheels is the same ground under
 * someone else's wheels 40 km away on another continent.
 */

import {
  biomeWeights,
  biomeWeightsFromClimate,
  climateUniform,
  biomeRelief,
  BIOME_COUNT,
  BIOME_TERRAIN,
  BIOME_ROAD,
  waterLevelAt,
} from './biomes.js';
import { RoadField, roadCamber } from './roads.js';
import { landmarkHeight } from './landmarks.js';
import { clamp01, smoothstep, lerp } from '../core/math.js';
import { fbm2 } from '../core/noise.js';

const _w = new Float32Array(BIOME_COUNT);

/* Below this weight a biome's relief is not evaluated at all — it is the single biggest
 * saving in the heightfield, because a culled biome is a whole fbm stack not computed.
 *
 * IT MUST NOT BE A HARD SWITCH. A threshold test drops `threshold × that biome's relief`
 * from the sum the instant the weight crosses it, and the highlands' relief is measured in
 * hundreds of metres: at 2% that is a step of several metres between two samples 5 m apart —
 * a vertical wall, drawn along the entire 2% contour of every biome. The first run with the
 * new amplitudes measured 0.89% of ground over 45° against 0.027% before, and every one of
 * the twelve steepest points in the world was a spot where the highland weight was sitting on
 * 0.02. Invisible at the old amplitudes, catastrophic at the new ones, and nothing whatever
 * to do with the noise.
 *
 * So the contribution fades in across [W_CULL, W_FADE] and the sum is renormalised by the
 * weight actually used. The renormalisation is what makes it exact rather than merely
 * smoother: h is the weighted MEAN of the biomes in play, so a biome arriving with weight
 * epsilon moves it by epsilon×(its deviation from the mean), which goes to zero with epsilon.
 * The old code divided by an implicit 1.0 and therefore pulled the height towards zero
 * wherever anything was culled. */
const W_CULL = 0.015;
const W_FADE = 0.055;

/* Metres of shoulder per metre of fill or cutting — the batter. 1.6 is what RoadField.carve
 * uses for its own mask and this had drifted to 1.5, which is a shoulder 6% narrower than
 * the mask that is meant to contain it.
 *
 * DO NOT CLAMP THE DROP THIS IS MULTIPLIED BY. Capping it at the road's own maximum
 * earthwork looks tidy and is exactly backwards: the deep fills are precisely the ones that
 * need the widest shoulder, and capping the width while the height keeps growing is how you
 * build a wall. Measured over the standard 2.4 km square: 1.6 uncapped gives 69 samples over
 * 45°, 1.6 capped at 22 m gives 130, and 1.5 uncapped — what was here — gives 80. Going the
 * other way is worse again (1.9 → 108, 2.4 → 1016) because past a point the shoulder is
 * wider than the mask that contains it and the ground steps down where the mask ends. */
const BATTER = 1.6;

/**
 * How the embankment face falls away, from 1 at the road edge to 0 at the toe.
 *
 * smoothstep, and it was worth proving rather than assuming. Its steepest point is 1.5x the
 * average gradient over the band, so a batter that AVERAGES a comfortable 1:1.6 has a ~43°
 * stripe through its middle — and since every sample in the world over 45° is an embankment
 * face with the land's own slope added, that stripe is the entire population. The obvious fix
 * is a real batter: straight, with the toe and crest eased, peak 1.25x instead of 1.5x.
 *
 * It is worse. Measured: the extreme tail collapses (past 50° went 61 samples to 25) but the
 * total over 45° goes from 95 to 158, because the same drop over the same width has to go
 * somewhere — smoothstep puts the excess in a thin stripe that mostly stays under the line,
 * the straight batter spreads it across 60% of the face at a gradient the land's own slope
 * then tips over. Concentrating the steepness is the thing that minimises the AREA of
 * unclimbable ground, which is what the player actually meets.
 *
 * Keep smoothstep. The lever that does work is the WIDTH — see the batter comment in
 * Terrain.height.
 */
function batterFall(half, shoulder, d) {
  return 1 - smoothstep(half, shoulder, d);
}

/**
 * THE GROUND, given a carve sample and the raw land under it. Terrain.height() is this
 * function plus the two evaluations that feed it — one place, so that "where is the ground"
 * has one answer. Anything that needs it calls Terrain.height() rather than reassembling
 * this from parts: render/road.js reassembled it, drifted, and put the drawn road 24 m from
 * the drivable one, which is the bug this whole round is about.
 */
function groundFromCarve(c, land, drive = 1) {
  if (c.mask <= 0.001) return land;
  const target = c.y;

  /* The embankment has to be as wide as it is tall. A fixed-width shoulder is fine where
   * the road sits within a metre of the land, but where it crosses a dip on 12 m of fill
   * the same shoulder becomes a 12 m wall in 13 m of ground — a 42° face the car cannot
   * climb, and the single biggest source of the cliffs the first build was full of. Real
   * earthworks use a batter of about 1:1.6, so the transition widens by 1.6 m per metre of
   * fill or cutting and the face stays shallow however deep the fill gets.
   *
   * This is where essentially every sample over 45° in the world lives: 181 of 199 of them
   * are fill, standing more than 4 m above the land, with the land 20–33 m below the road
   * surface. The raw land has none at all, at any preset. So the batter, not the noise, is
   * the thing to tune — and it is a WIDTH problem, not a shape problem (see batterFall). */
  const drop = Math.abs(land - target);
  const half = c.width * 0.5;
  const shoulder = half + 3.0 + drop * BATTER;
  const k = batterFall(half, shoulder, c.d) * clamp01(drive);
  const h = lerp(land, target, k);

  // Camber: the crown falls about 18 cm to the gutter so water would run off it, which is
  // also what makes a road read as a made surface rather than a painted stripe. It comes
  // out of roads.js so the visible ribbon can cut the identical shape — see roadCamber.
  return h - roadCamber(c);
}

function reliefFromWeights(x, z, seed, w) {
  let h = 0;
  let tw = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const wi = w[i];
    if (wi < W_CULL) continue;
    const k = wi * smoothstep(W_CULL, W_FADE, wi);
    if (k <= 0) continue;
    h += k * biomeRelief(x, z, seed, i);
    tw += k;
  }
  if (tw > 0) h /= tw;
  /* The massifs. Added OUTSIDE the biome sum, and that is deliberate — see the header of
   * world/landmarks.js. Two reasons in one line: a mountain weighted by biome mix dissolves
   * exactly where the mix is transitional, and anything derived from biome weights reads
   * wrong outside a sampler's climate box, which is precisely the query "can I see that
   * mountain from spawn". */
  h += landmarkHeight(x, z, seed);
  /* A common fine layer over everything so no biome looks smooth-shaded up close. Kept
   * small, and kept SLACK: this layer is meant to be seen, not felt. It used to run at an
   * 18 m wavelength with gain 0.4 against lacunarity 2.0, which put about 0.19 of gradient
   * on every square metre of the world — including the faces of road embankments, which are
   * already the steepest ground there is and are where every single sample over 45° lives
   * (95 of 100, all within 40 m of a road; the raw land has none). Same amplitude, 33 m
   * wavelength, gain 0.3: still visible, half the gradient, and it stops nudging the
   * embankments over the line.
   *
   * Lacunarity stays at 2.0 rather than going up with the biome stacks. At 2.5 the third
   * octave lands on a 5.3 m wavelength, which is the spacing tools/diag-cliffs.mjs measures
   * the normal over — the field then reads its own worst case at every sample and the
   * over-45° count went UP while the actual gradient went down. 2.0 keeps the finest octave
   * at 8 m, comfortably coarser than anything that samples it. */
  return h + fbm2(x * 0.03, z * 0.03, 3, seed ^ 0x1f0d, 2.0, 0.3) * 0.55;
}

/**
 * RAW LAND HEIGHT — biomes only, no roads. This is the function the road network samples,
 * so it must never call anything road-related.
 */
export function landHeight(x, z, seed) {
  const { w } = biomeWeights(x, z, seed, _w);
  return reliefFromWeights(x, z, seed, w);
}

/** Bound a factory so RoadField can call it without knowing the seed. */
export const landFn = (seed) => (x, z) => landHeight(x, z, seed);

/**
 * Water surface height at a point, or null if the land there is dry. The road network reads
 * this so it can build a causeway instead of driving into a lake.
 */
export const waterFn = (seed) => (x, z) => {
  const { w } = biomeWeights(x, z, seed, _wWater);
  return waterLevelAt(w, reliefFromWeights(x, z, seed, w));
};
const _wWater = new Float32Array(BIOME_COUNT);

/* ── climate cache ──────────────────────────────────────────────────────────
 * The climate fields have wavelengths of 7–15 km, but computing one costs three warped
 * fbm evaluations — the single most expensive thing in the generator, and the heightfield
 * needs it at every vertex. Sampling it onto a coarse lattice and bilinearly interpolating
 * is not an approximation you can see: at 48 m spacing the reconstruction error on a 7 km
 * feature is far below the width of one biome's blend band. It is, measurably, the
 * difference between 90 µs and 6 µs per surface sample.
 */
const CLIM_STEP = 48;

class ClimateGrid {
  constructor(seed, x0, z0, x1, z1, pad = 128) {
    this.seed = seed;
    this.x0 = Math.floor((x0 - pad) / CLIM_STEP) * CLIM_STEP;
    this.z0 = Math.floor((z0 - pad) / CLIM_STEP) * CLIM_STEP;
    this.nx = Math.ceil((x1 + pad - this.x0) / CLIM_STEP) + 2;
    this.nz = Math.ceil((z1 + pad - this.z0) / CLIM_STEP) + 2;
    const n = this.nx * this.nz;
    this.ue = new Float32Array(n);
    this.ua = new Float32Array(n);
    this.ut = new Float32Array(n);
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const c = climateUniform(this.x0 + i * CLIM_STEP, this.z0 + j * CLIM_STEP, seed);
        const k = j * this.nx + i;
        this.ue[k] = c.ue;
        this.ua[k] = c.ua;
        this.ut[k] = c.ut;
      }
    }
    this._out = { ue: 0, ua: 0, ut: 0, e: 0, t: 0, m: 0 };
  }

  sample(x, z) {
    const fx = (x - this.x0) / CLIM_STEP;
    const fz = (z - this.z0) / CLIM_STEP;
    let i = Math.floor(fx),
      j = Math.floor(fz);
    if (i < 0) i = 0;
    else if (i > this.nx - 2) i = this.nx - 2;
    if (j < 0) j = 0;
    else if (j > this.nz - 2) j = this.nz - 2;
    const tx = clamp01(fx - i),
      tz = clamp01(fz - j);
    const k00 = j * this.nx + i,
      k10 = k00 + 1,
      k01 = k00 + this.nx,
      k11 = k01 + 1;
    const bl = (a) => lerp(lerp(a[k00], a[k10], tx), lerp(a[k01], a[k11], tx), tz);
    const o = this._out;
    o.ue = bl(this.ue);
    o.ua = bl(this.ua);
    o.ut = bl(this.ut);
    return o;
  }
}

/**
 * A terrain sampler for one region of the world. Build one per chunk (in the worker) or
 * one per physics step around the car; it caches the local road edges so per-vertex
 * queries are a handful of segment distances rather than a network rebuild.
 */
export class Terrain {
  /**
   * @param {number} seed
   * @param {number} x0,z0,x1,z1 the world box this sampler will be asked about
   * @param {number} pad extra margin for the road field
   */
  constructor(seed, x0, z0, x1, z1, pad = 80) {
    this.seed = seed;
    this.climate = new ClimateGrid(seed, x0, z0, x1, z1, pad + 64);
    this.roads = new RoadField(x0, z0, x1, z1, seed, landFn(seed), pad, waterFn(seed));
    this._carve = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0 };
    this._wl = new Float32Array(BIOME_COUNT);
  }

  /** Biome weights here, using the cached climate grid. */
  weights(x, z, out = this._wl) {
    return biomeWeightsFromClimate(this.climate.sample(x, z), out);
  }

  /** Raw land height (no roads) using the cached climate. */
  land(x, z) {
    const { w } = this.weights(x, z);
    return reliefFromWeights(x, z, this.seed, w);
  }

  /** Final ground height, roads included. */
  height(x, z) {
    const c = this.roads.carve(x, z, this._carve);
    const { w } = this.weights(x, z);
    if (c.mask <= 0.001) return reliefFromWeights(x, z, this.seed, w);

    // How aggressively this biome grades under a road. A dune track barely levels the
    // sand; a wetland causeway is dead flat.
    let drive = 0;
    for (let i = 0; i < BIOME_COUNT; i++) drive += w[i] * BIOME_TERRAIN[i].drive;

    /* Inside the nearest road's own carriageway the batter is exactly 1, so
     * lerp(land, target, 1) is the target and the raw land cancels out of the arithmetic
     * entirely — which means the biome relief stack under it, the most expensive thing in
     * the whole generator, never has to be evaluated. The same number by a shorter route:
     * measured 4.3 µs a sample on a road against 8.0 µs off one, and the road ribbon now
     * takes fifty thousand of them per window. The `drive` guard is not decoration — this
     * shortcut is only exact while every biome grades flat under a road, and the moment one
     * does not, that biome falls through to the full formula on its own. */
    if (c.d <= c.width * 0.5 && drive >= 0.99999) return c.y - roadCamber(c);

    return groundFromCarve(c, reliefFromWeights(x, z, this.seed, w), drive);
  }

  /** Surface normal by central differences. `e` is the sample spacing in metres. */
  normal(x, z, e = 0.6, out = [0, 1, 0]) {
    const hL = this.height(x - e, z);
    const hR = this.height(x + e, z);
    const hD = this.height(x, z - e);
    const hU = this.height(x, z + e);
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * e;
    const l = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / l;
    out[1] = ny / l;
    out[2] = nz / l;
    return out;
  }

  /**
   * Everything the car and the renderer need about a point in one pass: height, normal,
   * biome weights, road membership, grip and roughness. This is the function the vehicle
   * calls four times a step (once per wheel), so it stays allocation free.
   */
  surface(x, z, out = null) {
    const o =
      out ||
      (this._surf ||= {
        y: 0,
        nx: 0,
        ny: 1,
        nz: 0,
        w: new Float32Array(BIOME_COUNT),
        dominant: 0,
        onRoad: 0,
        roadDist: Infinity,
        roadTier: 0,
        roadTx: 1,
        roadTz: 0,
        grip: 1,
        rough: 0,
        surfaceKind: 'grass',
      });

    const b = biomeWeightsFromClimate(this.climate.sample(x, z), o.w);
    o.dominant = b.dominant;
    o.y = this.height(x, z);
    const n = this.normal(x, z);
    o.nx = n[0];
    o.ny = n[1];
    o.nz = n[2];

    const c = this.roads.carve(x, z, this._carve);
    o.onRoad = c.edge;
    o.roadDist = c.d;
    o.roadTier = c.tier;
    o.roadTx = c.tx;
    o.roadTz = c.tz;

    // Grip: blend the biome road grip on-road, and a much lower off-road value that also
    // depends on how dry/loose the biome is.
    let roadGrip = 0,
      roadRough = 0;
    for (let i = 0; i < BIOME_COUNT; i++) {
      roadGrip += o.w[i] * BIOME_ROAD[i].grip;
      roadRough += o.w[i] * BIOME_ROAD[i].rough;
    }
    const offGrip = lerp(0.52, 0.72, o.w[0] + o.w[4]); // grass and marsh bite more than sand
    const offRough = lerp(0.85, 0.45, o.w[0]);
    o.grip = lerp(offGrip, roadGrip, o.onRoad);
    o.rough = lerp(offRough, roadRough, o.onRoad);
    o.surfaceKind = o.onRoad > 0.5 ? BIOME_ROAD[b.dominant].surface : 'ground';
    return o;
  }

  /** Cheap height-only probe for props and scatter rejection. */
  quickHeight(x, z) {
    return this.height(x, z);
  }
}

/**
 * A standalone one-shot height for code that has no Terrain to hand (menus, spawn search,
 * the minimap). Builds a small local road field, so do not use it in a loop.
 */
export function heightAt(x, z, seed) {
  const t = new Terrain(seed, x - 60, z - 60, x + 60, z + 60, 20);
  return t.height(x, z);
}

/**
 * Metres of clearance the drivable ground must keep above the local water table before the
 * car may be dropped there with no driver input. Shared by every place that does that —
 * findSpawn's own loop, findSpawn's last-resort fallback, and backToRoad()'s fallback to
 * findSpawn — so "dry enough" means exactly the same thing everywhere. See the header note on
 * findDrySpot below for why 0.5 m and not 0.
 */
export const DRY_MARGIN = 0.5;

/**
 * How far above the local water table a point's ACTUAL drivable ground — Terrain.height(),
 * roads included — sits, in metres. Negative means underwater.
 *
 * Built on waterLevelAt(), the one water-height function this game has, rather than a second
 * formula: passing -Infinity as the "current" ground height makes the `groundY < y` gate
 * inside it always true, so it always hands back the table height instead of null. null from
 * a normal call only ever means "not flooded right now" — it says nothing about how close the
 * ground is, which is exactly what a spawn needs to know.
 *
 * This asks about Terrain.height(), never about an edge's own e.y[k] and never about raw
 * land, and that is not interchangeable: a road CUTTING can duck below the local water table
 * while the land right there stays dry, because profileEdge()'s own water floor (and
 * diag-water.mjs's check) both gate on raw land, not on the road's own smoothed-and-clamped
 * height. Measured on the seeded world: a real tier-0 sample sat 2.25 m under its local water
 * table while the raw land 0 m away was 8.1 m clear — dry by every existing check, 2.25 m
 * underwater by the one that matters. That is the case this function exists to catch.
 */
export function waterMargin(t, x, z, y = t.height(x, z)) {
  const { w } = t.weights(x, z);
  const wl = waterLevelAt(w, -Infinity);
  return wl === null ? Infinity : y - wl;
}

/** Safe to hand the car (x, z) with no driver input: dry, and clear of the water table by at
 *  least DRY_MARGIN. */
export function isDrySpot(t, x, z, y = t.height(x, z)) {
  return waterMargin(t, x, z, y) >= DRY_MARGIN;
}

/**
 * Standalone dry check for callers with no Terrain in hand, or whose Terrain might not
 * actually cover (x, z) — same pattern as heightAt(): a small local sampler, fine for one
 * call, not for a loop.
 */
export function isDryAt(x, z, seed) {
  const t = new Terrain(seed, x - 60, z - 60, x + 60, z + 60, 20);
  return isDrySpot(t, x, z);
}

/**
 * Last resort for findSpawn(): no tier-0 arterial at all within the main loop's search box —
 * a young or sparse corner of the lattice — so there is no road to be picky about, but the
 * point handed back still has to be dry. This used to be `{ x: hintX, z: hintZ, ... }`,
 * completely unvalidated: a hint that happens to land in or near water handed the player a
 * car already sitting in it with no recourse. This is also exactly what backToRoad() falls
 * back to when R is pressed (or the water rescue fires) somewhere with no road in range —
 * see main.js.
 *
 * Ring search, growing outward, rebuilding the sampler whenever the ring would step outside
 * the box it covers — Terrain silently clamps a query outside its own box to the box edge
 * rather than erroring, which would be a worse bug than a slow search. Deterministic, like
 * everything under world/: same rings, same order, every time for a given seed and hint.
 */
export function findDrySpot(seed, hintX = 0, hintZ = 0) {
  const RING_STEP = 150;
  const DIRS = 16;
  const MAX_RINGS = 64; // 9.6 km out — if nothing here is dry the seed neighbourhood is water

  let boxR = 3000;
  let t = new Terrain(seed, hintX - boxR, hintZ - boxR, hintX + boxR, hintZ + boxR, 120);
  let driest = null; // best-effort answer if literally nothing clears the margin

  const probe = (x, z) => {
    const y = t.height(x, z);
    const margin = waterMargin(t, x, z, y);
    if (!driest || margin > driest.margin) driest = { x, z, y, margin };
    return margin >= DRY_MARGIN ? { x, z, y } : null;
  };

  const hit0 = probe(hintX, hintZ);
  if (hit0) return { ...hit0, heading: 0, score: 0 };

  for (let ring = 1; ring <= MAX_RINGS; ring++) {
    const r = ring * RING_STEP;
    if (r > boxR - 200) {
      // Walked outside the sampler's own box — rebuild one that reaches further rather than
      // ever trusting a point this function has not actually measured.
      boxR = r + 3000;
      t = new Terrain(seed, hintX - boxR, hintZ - boxR, hintX + boxR, hintZ + boxR, 120);
    }
    for (let a = 0; a < DIRS; a++) {
      const ang = (a / DIRS) * Math.PI * 2;
      const hit = probe(hintX + Math.cos(ang) * r, hintZ + Math.sin(ang) * r);
      if (hit) return { ...hit, heading: 0, score: 0 };
    }
  }

  // Every point this function measured, out to nearly 10 km, was within DRY_MARGIN of water.
  // Hand back the driest one it actually saw — never a point nobody checked.
  return { x: driest.x, z: driest.z, y: driest.y, heading: 0, score: 0 };
}

/**
 * Find a good spawn: walk outward from a hint until we are on an arterial road with
 * shallow gradient. Deterministic given the seed, so "new game" always starts in the same
 * place for everyone — which matters, because that is where players will meet.
 *
 * `opts.highBias` (0..1, default 0) rewards ALTITUDE: at 1 a candidate earns up to 800
 * points of score credit for sitting up to 400 m above datum. It exists for the alpine
 * preset — "alpine start should be in the mountains" (operator) — whose massifs are the
 * whole point and whose spawn used to land on the flattest valley pocket like everyone
 * else's. The numbers are chosen against the two terms already in the score, in this
 * order of priority:
 *   1. WATER-SAFETY is untouched — the waterMargin gate below rejects wet candidates
 *      before scoring can save them, biased or not (BACKLOG item W8 stays fixed).
 *   2. GRADE still wins: the credit ceiling (800) is below the saturated grade penalty
 *      (900), and more to the point a HIGH candidate at a sane grade always beats a high
 *      candidate at a cliff grade by hundreds of points, so the bias picks the gentlest
 *      road up the mountain rather than the steepest road anywhere.
 *   3. Distance (0.012/m, ≤36 points over the box) becomes a tie-break, which is what
 *      it already was between pleasant candidates.
 * Deterministic: same seed, same opts, same spawn. Presets that do not set it (the other
 * five) score exactly as before, to the bit.
 */
export function findSpawn(seed, hintX = 0, hintZ = 0, opts = {}) {
  const R = 3000;
  const highBias = opts.highBias || 0;
  const t = new Terrain(seed, hintX - R, hintZ - R, hintX + R, hintZ + R, 120);
  let best = null;
  for (const e of t.roads.edges) {
    if (e.tier !== 0) continue;
    const n = e.pts.length / 2;
    for (let k = 1; k < n - 1; k++) {
      const x = e.pts[k * 2],
        z = e.pts[k * 2 + 1];
      /* Only STEEPNESS is a problem, not gradient as such. This used to score the raw height
       * difference linearly against forty times its weight, so the winner was always the
       * single flattest arterial sample within 3 km — the one billiard table in a world of
       * hills. Every relief measurement then read that pocket and reported a flatline, and so
       * did the player. Below about 4.5% a start is simply pleasant and there is nothing to
       * choose between candidates; above 13% it is a bad place to be handed a car. So the
       * grade term saturates at both ends and distance decides everything in between. */
      const grade = Math.abs(e.y[k + 1] - e.y[k - 1]) / (2 * e.span);
      const dist = Math.hypot(x - hintX, z - hintZ);
      // e.y[k] is the road's own profile height — already computed, so the altitude credit
      // costs nothing on the presets that don't ask for it (highBias 0 multiplies it away).
      const high = highBias * Math.min(Math.max(e.y[k], 0), 400) * 2.0;
      const score = smoothstep(0.045, 0.13, grade) * 900 + dist * 0.012 - high;
      // Cheap reject before the height/water probe below: a candidate that cannot beat the
      // current best on score alone can never win, wet or not, so there is no reason to pay
      // for a Terrain.height() + biome-weights call on it.
      if (best && score >= best.score) continue;
      const y = t.height(x, z);
      // NEVER hand back a point in water, or within DRY_MARGIN of it — see the header note
      // on waterMargin() for why a cutting can fail this while looking dry to every other
      // check in the file.
      if (waterMargin(t, x, z, y) < DRY_MARGIN) continue;
      const dx = e.pts[k * 2 + 2] - e.pts[k * 2 - 2];
      const dz = e.pts[k * 2 + 3] - e.pts[k * 2 - 1];
      best = { x, z, y, heading: Math.atan2(dx, dz), score };
    }
  }
  // The old fallback returned the hint completely unvalidated. findDrySpot() never does.
  return best || findDrySpot(seed, hintX, hintZ);
}
