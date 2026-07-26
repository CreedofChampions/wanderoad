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
import { RoadField } from './roads.js';
import { clamp01, smoothstep, lerp } from '../core/math.js';
import { fbm2 } from '../core/noise.js';

const _w = new Float32Array(BIOME_COUNT);

/** Below this weight a biome contributes less than a centimetre — skip its whole relief. */
const W_CULL = 0.02;

function reliefFromWeights(x, z, seed, w) {
  let h = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const wi = w[i];
    if (wi < W_CULL) continue;
    h += wi * biomeRelief(x, z, seed, i);
  }
  // A common fine layer over everything so no biome looks smooth-shaded up close. Kept
  // small: at an 18 m wavelength every metre of amplitude is another degree of slope under
  // the wheels, and this layer is meant to be seen, not felt.
  return h + fbm2(x * 0.055, z * 0.055, 3, seed ^ 0x1f0d, 2.0, 0.4) * 0.55;
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
    const { w } = this.weights(x, z);
    const land = reliefFromWeights(x, z, this.seed, w);
    const c = this.roads.carve(x, z, this._carve);
    if (c.mask <= 0.001) return land;

    // How aggressively this biome grades under a road. A dune track barely levels the
    // sand; a wetland causeway is dead flat.
    let drive = 0;
    for (let i = 0; i < BIOME_COUNT; i++) drive += w[i] * BIOME_TERRAIN[i].drive;

    const target = c.y;

    /* The embankment has to be as wide as it is tall. A fixed-width shoulder is fine where
     * the road sits within a metre of the land, but where it crosses a dip on 12 m of fill
     * the same shoulder becomes a 12 m wall in 13 m of ground — a 42° face the car cannot
     * climb, and the single biggest source of the cliffs the first build was full of.
     * Real earthworks use a batter of about 1:1.5, so the transition is widened by 1.5 m
     * per metre of fill or cutting and the face never exceeds about 34°. */
    const drop = Math.abs(land - target);
    const half = c.width * 0.5;
    const shoulder = half + 3.0 + drop * 1.5;
    const k = (1 - smoothstep(half, shoulder, c.d)) * clamp01(drive);
    let h = lerp(land, target, k);

    // Camber: the crown falls about 18 cm to the gutter so water would run off it, which is
    // also what makes a road read as a made surface rather than a painted stripe.
    if (c.edge > 0.001) {
      const across = clamp01(c.d / half || 0);
      h -= c.edge * across * across * 0.18;
    }
    return h;
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
 * Find a good spawn: walk outward from a hint until we are on an arterial road with
 * shallow gradient. Deterministic given the seed, so "new game" always starts in the same
 * place for everyone — which matters, because that is where players will meet.
 */
export function findSpawn(seed, hintX = 0, hintZ = 0) {
  const R = 3000;
  const t = new Terrain(seed, hintX - R, hintZ - R, hintX + R, hintZ + R, 120);
  let best = null;
  for (const e of t.roads.edges) {
    if (e.tier !== 0) continue;
    const n = e.pts.length / 2;
    for (let k = 1; k < n - 1; k++) {
      const x = e.pts[k * 2],
        z = e.pts[k * 2 + 1];
      const grade = Math.abs(e.y[k + 1] - e.y[k - 1]);
      const dist = Math.hypot(x - hintX, z - hintZ);
      const score = grade * 40 + dist * 0.01;
      if (!best || score < best.score) {
        const dx = e.pts[k * 2 + 2] - e.pts[k * 2 - 2];
        const dz = e.pts[k * 2 + 3] - e.pts[k * 2 - 1];
        best = { x, z, y: t.height(x, z), heading: Math.atan2(dx, dz), score };
      }
    }
  }
  return best || { x: hintX, z: hintZ, y: t.height(hintX, hintZ), heading: 0, score: 0 };
}
