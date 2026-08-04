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
  BIOME_COUNT,
  BIOME_TERRAIN,
  BIOME_ROAD,
  waterLevelAt,
} from './biomes.js';
import { RoadField, roadCamber } from './roads.js';
/* The petrol-station apron, so `surface()` can call a forecourt a made surface — see the note where
 * `onRoad` is set. props.js already imports nothing from terrain.js, so this direction is safe. */
import { nearestStation, STATION_APRON_HALF_WIDTH, STATION_APRON_HALF_DEPTH, STATION_OFFSET } from './props.js';
import { landmarkView } from './landmarks.js';
import { clamp01, smoothstep, lerp } from '../core/math.js';
/* The raw land and its water moved to field.js so that roads.js can read them directly —
 * this file imports roads.js, so roads.js can never import this one. See field.js's header.
 * Re-exported below, unchanged, so nothing that already imports them from here has to move. */
import { landHeight, landFn, waterFn, reliefFromWeights } from './field.js';

export { landHeight, landFn, waterFn, reliefFromWeights, floodAt, fieldTag, W_CULL, W_FADE } from './field.js';

const _w = new Float32Array(BIOME_COUNT);

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

/* The batter on the CUTTING side only — where the land stands ABOVE the road rather than
 * below it.
 *
 * The requirement is "there is never terrain standing above a road", and in high country it
 * was not being met: an audit driving the real game photographed a bank rising well clear of
 * the carriageway in the alpine highlands. The lever is the same WIDTH lever as above, but it
 * must not be pulled on both sides at once — the measurements in the BATTER note are for the
 * symmetric change, and they are damning (1.9 → 108 samples over 45°, 2.4 → 1016) because
 * every one of those samples is an embankment FILL, 181 of 199 of them, standing 20–33 m above
 * the ground beside it. Widening a fill's shoulder past the mask that contains it is what
 * builds the wall the note describes.
 *
 * A cutting is the opposite geometry and it does not share that failure mode: the widened
 * ground is being brought DOWN towards the road, into the hill, and there is no toe of a fill
 * for it to step off.
 *
 * 2.0 IS A KNEE, NOT A GUESS. Swept 1.6 / 2.0 / 2.4 / 2.6 on the alpine preset with
 * `node tools/diag-abovedeck.mjs --terrain alpine` against `diag-cliffs.mjs` and
 * `diag-relief.mjs`, all three on the same seed and the same boxes:
 *
 *   batter  bank 8 m off the tarmac      bank 24 m out       relief(alpine)   cliffs(default)
 *   1.6     mean 2.71 m, 95th 4.24 m     95th 15.16 m        0.091%           0.000%
 *   2.0     mean 2.25 m, 95th 3.40 m     95th 12.22 m        0.117%           0.000%
 *   2.4     mean 1.94 m, 95th 2.89 m     95th 10.21 m        ~0.13%           0.000%
 *   2.6     —                            —                   0.140%           0.004%
 *
 * The softening is real and roughly linear; so is what it costs in alpine relief. 2.0 buys
 * about 20% off the bank at every offset while the hard gate — `diag-cliffs.mjs`, the DEFAULT
 * preset, the one with a recorded ceiling — does not move off zero at all. 2.6 breaks it, so
 * the ceiling on this knob is a measured cliff edge rather than a feeling.
 *
 * ── 2.2, 28 July: re-swept on the CURRENT world, and the cliff cost is NOT monotonic ────────
 *
 * The operator asked for more softening again ("somewhat but not totally done -- more
 * smoothing"). The table above predicted 2.4 would cost cliffs; measured on the world as it
 * stands today (which is no longer the world that table was taken on — `diag-cliffs.mjs` reads
 * 0.009%, not the 0.000% recorded above), the curve turns out to have a dip in it:
 *
 *   batter  diag-cliffs (default, 360k samples)   alpine bank 8 m off       carriageway edge
 *   2.0     31  (0.009%)                          mean 2.32 m, 95th 3.35 m  0.45%
 *   2.2     28  (0.008%)   <- shipped             mean 2.15 m, 95th 3.06 m  0.42%
 *   2.4     36  (0.010%)                          mean 2.00 m, 95th 2.82 m  0.46%
 *
 * So 2.2 softens the bank by 7-9% at every offset and takes THREE SAMPLES OFF the cliff count
 * at the same time — it is not a trade at all on this world. 2.4 softens more and costs five
 * samples, so it was measured and left. The alpine bank 24 m out goes 95th 12.20 -> 11.08 m.
 * `diag-seam.mjs` clean on both presets, `npm test` green, `diag-abovedeck.mjs --terrain alpine`
 * PASS at 0.42% against its 1.00% bar.
 *
 * WHAT THIS CANNOT DO, stated so nobody re-opens it expecting more: in the alpine highlands
 * about 43% of the ground beside a road stands above it at ANY batter, because that is what a
 * mountain is. "Never terrain above a road" is only literally achievable by flattening the
 * mountains. This grades the shoulder; it does not delete the hillside.
 *
 * Both copies of the batter formula move together, always — see roads.js's carve(). */
const CUT_BATTER = 2.2;

/**
 * Score credit per degree of sky the best massif visible from a spawn candidate fills, capped
 * at 8°. Zero ships. See the long note inside findSpawn for the measured trade — the short
 * version is that the default seed no longer needs it and the browser suite's R1 check goes
 * red when the spawn moves, for a reason that is R1's own measurement rather than a defect in
 * the ground. 15 is the value the preset spawns want.
 */
const LANDMARK_SPAWN_BIAS = 0;

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
  // Cuttings get the wider shoulder; fills keep the one every cliff measurement is tuned on.
  const shoulder = half + 3.0 + drop * (land > target ? CUT_BATTER : BATTER);
  const k = batterFall(half, shoulder, c.d) * clamp01(drive);
  const h = lerp(land, target, k);

  // Camber: the crown falls about 18 cm to the gutter so water would run off it, which is
  // also what makes a road read as a made surface rather than a painted stripe. It comes
  // out of roads.js so the visible ribbon can cut the identical shape — see roadCamber.
  return h - roadCamber(c);
}

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
    /* A FORECOURT IS A MADE SURFACE TOO, and this line only ever knew about the ROAD CARVE.
     *
     * Operator, twice: "the road up to the gas station still does not work at all". Measured at
     * five stations — the centreline passes 18.3 to 20.0 m away and `onRoad` reads
     * 1.0 1.0 0.0 0.0 0.0 … from the kerb to the pumps, so the hard surface stops about two metres
     * past the kerb and you cross bare ground to a forecourt that is DRAWN as tarmac. The apron and
     * its access spur are built by props.js; nothing ever told the terrain they exist, so every
     * system that asks — grip, roughness, the off-road warning, the streak — treated a petrol
     * station as a field. Same class as the airstrip that did not count as tarmac for take-off (F39).
     *
     * The station is cached: `nearestStation` scans a box, and a query point moves a few metres
     * between frames while the answer does not. */
    {
      const st =
        this._apron && Math.hypot(x - this._apron.x, z - this._apron.z) < 400
          ? this._apron
          : (this._apron = nearestStation(x, z, this.seed, 400));
      if (st) {
        /* The apron's own rectangle in the station's frame — the same half-dimensions props.js lays
         * the slab with, so the drivable patch and the drawn patch are one rectangle rather than two
         * numbers that agree for now. */
        const dx = x - st.x;
        const dz = z - st.z;
        const ca = Math.cos(-(st.yaw || 0));
        const sa = Math.sin(-(st.yaw || 0));
        const lx = dx * ca - dz * sa;
        const lz = dx * sa + dz * ca;
        if (Math.abs(lx) <= STATION_APRON_HALF_WIDTH && Math.abs(lz) <= STATION_APRON_HALF_DEPTH) o.onRoad = 1;
        /* AND THE SPUR THAT JOINS IT TO THE ROAD. Teaching `surface()` about the apron alone left a
         * band of bare ground between the kerb and the slab — measured 1.0 1.0 0.0 0.0 0.0 0.0 1.0
         * 1.0 1.0 1.0 1.0 from kerb to pumps, i.e. the forecourt became drivable and the way onto it
         * did not, which is the same complaint one step further in. The corridor is a lane's width
         * about the station's own axis, reaching STATION_OFFSET (the distance props.js sets a station
         * back from the centreline) plus a little for the kerb itself. Both signs of `lz`, because
         * which way the station faces is props.js's business and this does not need to know. */
        else if (Math.abs(lx) <= 4.5 && Math.abs(lz) <= STATION_OFFSET + 5) o.onRoad = 1;
      }
    }
    o.roadDist = c.d;
    /* The carriageway's own width here. `carve` has always computed it (roads.js blends it across
     * overlapping edges) and it was simply never put on the record, so every caller that wanted "how
     * far past the EDGE am I" had to guess a half-width. game/streak.js needs exactly that for the
     * HUD's red warning — see OFFROAD_WARN_M — and a guess there is a warning that fires at the wrong
     * distance on half the network, since a lane is 6.2 m and an arterial 8.6 m. */
    o.roadWidth = c.width;
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
      /* SOMEWHERE TO HEAD FOR. The operator asked for "a tall distant landmark visible from
       * spawn"; an audit stood at the old default spawn, photographed all four cardinal
       * directions, and found flat plains on three of them and a 123 m wooded hill on the
       * fourth. The massif layer was not the problem — it works, and there was a 283 m peak
       * within a couple of kilometres of that spawn's own neighbourhood — the problem was that
       * nothing in this function had ever heard of it.
       *
       * `landmarkView` returns the apparent height in DEGREES of the most dominant massif
       * visible from the candidate, measured above the candidate's own ground (world/
       * landmarks.js). Degrees, not metres, because that is what "reads as a landmark"
       * physically is: 283 m at 1.6 km is 10.1° and owns the skyline; 318 m at 6.5 km is 2.8°
       * and is haze.
       *
       * SCALED TO SIT BETWEEN THE TWO TERMS THAT ALREADY EXIST, on purpose:
       *   - Saturates at 8°, so 320 points is the ceiling. That is comfortably under the
       *     saturated grade penalty (900), so a candidate under a magnificent mountain still
       *     loses to a gentler one — grade keeps priority, exactly as `highBias` does.
       *   - It is far larger than the distance term (≤36 points over the whole box), so this
       *     REPLACES distance as the tie-break between pleasant candidates rather than
       *     competing with it. That is the intended change: "nearest passable arterial" was
       *     never a thing the player wanted, it was just the only thing on offer.
       *   - The water gate below is untouched and still runs after scoring, so W8 stays fixed.
       * Every candidate pays 5x5 hashes for it; no heightfield samples, no line of sight.
       *
       * ── SHIPPED AT ZERO, DELIBERATELY, AND HERE IS THE WHOLE TRADE ────────────────────────
       *
       * On the DEFAULT seed this term is not needed any more, because routing the roads around
       * the lakes (world/roads.js's water cull) already moved the spawn off the plain it was
       * stuck on: nearest massif went from 104 m at 1.78 km — the very bottom of the 90-330 m
       * range, exactly what the audit's photographs showed — to 283 m at 1.59 km, filling 7.0°
       * of sky. That is the requirement met, on the world the operator actually boots into,
       * without this term doing anything.
       *
       * Turning it up to 15 buys the six PRESETS the same thing, and the numbers are real:
       * meadow's nearest massif 104 m -> 283 m, marsh 78 m -> 212 m, dunes 164 m -> 226 m, and
       * every preset lands within 1.3-1.6 km of a 212 m-plus peak.
       *
       * WHAT IT COSTS, measured, which is why it is off: it moves the default spawn ~200 m, and
       * the browser suite's R1 check ("nothing is above the road surface") then reads 1 of 103
       * points at 1.60 m instead of 0 of 60 at 0.00 m. R1 compares ONE edge's own height
       * profile against `Terrain.height`, which is RoadField.carve's blend over every nearby
       * road — near a junction those two legitimately differ, by design (the same gap made an
       * audit report 13.55 m of "terrain above the road" at a point where the drivable surface
       * was in fact level). So R1 is a per-box lottery, not a world property: measured across
       * eight seeds BEFORE any change this round, six of the eight 840 m boxes already had R1
       * hits, worst 8.44 m, and the default seed's box passing was luck. Diagnosed to the
       * point: at (-895,1253) two arterials that share node (-1,0) run 1.7 m apart, each graded
       * to its own ground, and the carve blends both.
       *
       * Fixing that properly means levelling near-parallel arterial pairs, and letting
       * arterials level against each other is recorded in roads.js as already tried and
       * reverted — it moved every arterial in a 4 km square by up to 36 m. That is a real
       * piece of work with its own measurement round, not something to slip in beside four
       * other fixes. So the capability ships wired, documented and proven (see the "W5 again"
       * section of `node tools/diag-relief.mjs`), the default seed gets the fix for free, and
       * the presets wait on one number here rather than on a rewrite. */
      const view = Math.min(landmarkView(x, z, seed, e.y[k]).score, 8) * LANDMARK_SPAWN_BIAS;
      const score = smoothstep(0.045, 0.13, grade) * 900 + dist * 0.012 - high - view;
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
      /* Point the car the OTHER way down the road. Operator: "Start people going the OPPOSITE
       * direction from the normal starting point from now on" — the forward tangent led into
       * the stretch he has driven a hundred times, so spawning reversed opens onto road he has
       * not seen without touching the spawn point, its water safety, or its grade gate. Adding
       * pi rather than negating the tangent: the heading is an absolute bearing, and -atan2
       * would mirror it across the axis instead of reversing it. */
      /* RESTORED. It was held back because driving out this way put the car through a crossing
       * genuinely 3.63 m out of level (browser R2, 1 of 9, reproduced twice), and aiming every
       * new player at a fall-through is worse than showing him road he has seen before.
       *
       * The crossing is fixed at the source, in world/roads.js: arterials now level against the
       * arterials that outrank them (`level0`), and the lane-vs-lane pass may no longer undo the
       * lane-vs-arterial pass that ran before it (`levelAgainst`'s `respect`). The measurement
       * that lifts the hold is `node tools/diag-crosslevel.mjs`: **0 crossings over 1.0 m within
       * 2600 m of this spawn point, in every direction**, against 46 over five 6 km boxes before.
       * The nearest car box that can still see a mismatched crossing at all is 2023 m away and
       * it lies in the FORWARD half — the heading below now points away from it.
       *
       * Adding pi rather than negating the tangent: the heading is an absolute bearing, and
       * -atan2 would mirror it across the axis instead of reversing it. */
      best = { x, z, y, heading: Math.atan2(dx, dz) + Math.PI, score };
    }
  }
  // The old fallback returned the hint completely unvalidated. findDrySpot() never does.
  return best || findDrySpot(seed, hintX, hintZ);
}
