/* Wanderoad — the five biomes.
 *
 * The world is one continuous surface. There is no biome "map" and no region boundary you
 * can cross; there are three slow scalar fields — elevation, temperature, moisture — and a
 * biome is just a region of that 3-space. Two clients with the same seed compute the same
 * fields, so they see the same world.
 *
 *   elevation  e  ∈ [0,1]  the continental mass field (also drives terrain height)
 *   temperature t ∈ [0,1]  warm/cold, driven by a very-low-frequency field and by altitude
 *   moisture   m ∈ [0,1]   dry/wet, driven by another low-frequency field
 *
 * Every biome scores itself against (e, t, m). The scores are softmax-blended, so a point
 * is never "in" one biome — it is 0.7 meadow, 0.3 steppe, and the terrain height, colour,
 * scatter density and road surface are all weighted averages. That is what removes seams.
 *
 * Fields are deliberately huge (5–20 km wavelengths). At 200 km/h you want a biome to last
 * several minutes of driving, not several seconds.
 */

import { fbm2, warpedFbm2, ridged, billow, noise2 } from '../core/noise.js';
import { clamp01, smoothstep, lerp } from '../core/math.js';

export const BIOME = {
  MEADOW: 0,
  STEPPE: 1,
  HIGHLAND: 2,
  DUNES: 3,
  WETLAND: 4,
};

export const BIOME_COUNT = 5;

export const BIOME_NAMES = ['Hoshi Meadow', 'Amber Steppe', 'Cobalt Highlands', 'Bara Dunes', 'Kiri Wetland'];

/** Short label for the HUD compass. */
export const BIOME_SHORT = ['Meadow', 'Steppe', 'Highlands', 'Dunes', 'Wetland'];

/* ── field wavelengths, in metres ────────────────────────────────────────── */
const ELEV_SCALE = 1 / 7200; // continental mass
const TEMP_SCALE = 1 / 15500; // climate band
const MOIST_SCALE = 1 / 9800; // rain shadow
const DETAIL_SCALE = 1 / 2600; // the wobble that stops borders being straight

/**
 * The three climate fields at a world position. Pure, cheap enough to call per vertex,
 * and the only place the biome layout is decided.
 */
export function climateAt(x, z, seed) {
  // Elevation: warped fbm plus a ridged component, so mountain ranges are chains rather
  // than blobs. Biased slightly low so most of the world is drivable lowland.
  const eBase = warpedFbm2(x * ELEV_SCALE, z * ELEV_SCALE, 5, seed ^ 0x1a2b, 0.8);
  const eRidge = ridged(x * ELEV_SCALE * 1.7, z * ELEV_SCALE * 1.7, 4, seed ^ 0x5c3d);
  let e = clamp01(0.5 + eBase * 0.62 + Math.max(0, eRidge) * 0.34 - 0.06);

  // Temperature: a slow band plus a cold penalty for altitude. Mountains are cold because
  // they are high, which is what makes the snowline follow the terrain instead of a map.
  const tBase = fbm2(x * TEMP_SCALE + 41.3, z * TEMP_SCALE - 17.9, 3, seed ^ 0x77ab);
  let t = clamp01(0.5 + tBase * 0.85 - smoothstep(0.52, 0.95, e) * 0.62);

  // Moisture: another slow band, pushed down on the lee side of high ground (rain shadow)
  // and up in the hollows (water collects).
  const mBase = fbm2(x * MOIST_SCALE - 88.1, z * MOIST_SCALE + 12.7, 4, seed ^ 0x33f1);
  const hollow = smoothstep(0.44, 0.16, e); // low ground -> wet
  let m = clamp01(0.5 + mBase * 0.9 + hollow * 0.3 - smoothstep(0.55, 0.9, e) * 0.25);

  // A little high-frequency jitter on all three so the borders are ragged, not smooth.
  const jitter = noise2(x * DETAIL_SCALE, z * DETAIL_SCALE, seed ^ 0x9e37) * 0.045;
  e = clamp01(e + jitter);
  t = clamp01(t + jitter * 1.4);
  m = clamp01(m - jitter * 1.1);

  return { e, t, m };
}

/* The raw fields are sums of noise octaves, so they are bell-shaped around 0.5 with the
 * 10th–90th percentiles landing near 0.20–0.77 (measured over a 84 km square). Scoring
 * biomes directly against those values makes the extremes unreachable: a desert centred on
 * "very hot, very dry" simply never occurs. `spread` stretches the useful band out to
 * roughly uniform [0,1] so every biome centre is somewhere the world can actually go. */
const spread = (v) => clamp01(0.5 + (v - 0.5) * 1.92);

/**
 * Climate remapped into the space the biome centres live in.
 *   ue  elevation, ~uniform
 *   ut  temperature, ~uniform
 *   ua  ARIDITY — the single axis that separates marsh → meadow → steppe → desert. Making
 *       it one axis instead of a hot∧dry conjunction is what stops the desert being a 1%
 *       curiosity: a conjunction of two independent uniforms has ~6% mass in its corner,
 *       one axis has as much as you give it.
 */
export function climateUniform(x, z, seed) {
  const c = climateAt(x, z, seed);
  const ue = spread(c.e);
  const ut = spread(c.t);
  const ua = clamp01(0.5 + (c.t - c.m) * 1.45);
  return { ue, ut, ua, e: c.e, t: c.t, m: c.m };
}

/* ── biome scoring ───────────────────────────────────────────────────────── */

// Each biome is an anisotropic gaussian in (elevation, aridity, temperature) space. The
// three 'k' values are how sharply the biome falls off along each axis: a small k means a
// wide forgiving basin, a large k a tight and specific one. 'gain' scales the whole lobe,
// which is how the share of the world each biome takes is tuned without moving its centre.
const CENTRES = [
  // ue    ua    ut     ke    ka    kt    gain
  [0.5, 0.45, 0.52, 1.9, 2.3, 1.3, 1.0], // 0 MEADOW   — the default world
  [0.48, 0.72, 0.64, 1.6, 2.6, 1.6, 1.32], // 1 STEPPE    — warm, dry, open
  [0.88, 0.45, 0.26, 3.0, 1.1, 2.0, 1.35], // 2 HIGHLAND  — high and cold
  [0.42, 0.95, 0.8, 1.5, 3.1, 1.7, 1.55], // 3 DUNES     — the arid extreme
  [0.13, 0.12, 0.52, 2.6, 2.6, 1.0, 1.5], // 4 WETLAND   — low and soaked
];

const _w = new Float32Array(BIOME_COUNT);

/* A per-biome multiplier the preview presets set, so a gallery page can be "mostly dunes"
 * without a second world generator. Default is all ones, which is the shipping world. */
export const BIOME_BIAS = new Float32Array([1, 1, 1, 1, 1]);
export function setBiomeBias(arr) {
  for (let i = 0; i < BIOME_COUNT; i++) BIOME_BIAS[i] = arr && arr[i] > 0 ? arr[i] : 1;
}

/**
 * Biome weights at a point. Returns a Float32Array of length 5 summing to 1, plus the
 * dominant index. The array is REUSED between calls — copy it if you need to keep it.
 */
export function biomeWeights(x, z, seed, out = _w) {
  const u = climateUniform(x, z, seed);
  return biomeWeightsFromClimate(u, out);
}

/** Same, but from an already-computed climate sample — lets callers cache the fields. */
export function biomeWeightsFromClimate(u, out = _w) {
  let total = 0;
  let best = 0;
  let bestV = -1;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const c = CENTRES[i];
    const de = (u.ue - c[0]) * c[3];
    const da = (u.ua - c[1]) * c[4];
    const dt = (u.ut - c[2]) * c[5];
    // exp(-d²) gives a soft basin. No additive floor: a floor would put a trace of desert
    // in every marsh and wash the whole palette towards the mean.
    const v = c[6] * BIOME_BIAS[i] * Math.exp(-(de * de + da * da + dt * dt));
    out[i] = v;
    total += v;
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  const inv = 1 / (total || 1);
  for (let i = 0; i < BIOME_COUNT; i++) out[i] *= inv;
  return { w: out, dominant: best, e: u.e, t: u.t, m: u.m, ue: u.ue, ua: u.ua, ut: u.ut };
}

/* ── per-biome terrain character ─────────────────────────────────────────────
 * Each biome contributes a height offset and an amplitude. The final height is the
 * weighted sum, which is why a meadow/highland border is a foothill and not a cliff.
 *
 *  amp      metres of relief the biome adds
 *  base     metres the biome shifts the ground up or down. Keep the spread between biomes
 *           SMALL: a base difference is a step that appears wherever the biome mix changes
 *           quickly, and it is the one source of steep ground that is not a road embankment.
 *           Height differences belong in `amp`, which is spread over a wavelength.
 *  rough    how much ridged (sharp) vs fbm (soft) noise it uses, 0..1
 *  wave     the dominant wavelength of its relief, in metres
 *  drive    how much the biome flattens under a road. This is 1.0 everywhere and should
 *           stay there: the road MESH is laid at the smoothed spline elevation, so any
 *           biome that only part-grades leaves the carved ground and the ribbon at
 *           different heights — the ground pokes through the tarmac in cuttings and the
 *           tarmac floats over it on embankments.
 */
/* The amplitude-to-wavelength ratio IS the slope. The first playable build used ratios up
 * to 0.30 (340 m of relief over a 1150 m wavelength, compounded over six octaves) and the
 * result was a world of cliffs a car could not drive on and a player who said, correctly,
 * that it was "not smooth enough". These are the tuned-down numbers: gentle rolling hills
 * near the ground the player actually drives on, with drama kept for the mountains you look
 * at rather than the ones you climb. The reference is the Hoshi-no-Tani valley — soft,
 * readable landforms, nothing vertical.
 *
 * Water is shallow everywhere for the same reason: a river you cannot cross is a wall, and
 * the player reported exactly that. Nothing here floods deeper than 2.5 m. */
export const BIOME_TERRAIN = [
  { amp: 30, base: 6, rough: 0.18, wave: 460, drive: 1.0, water: 1.2 }, // MEADOW
  { amp: 18, base: 3, rough: 0.1, wave: 900, drive: 1.0, water: 0.0 }, // STEPPE
  { amp: 178, base: 14, rough: 0.86, wave: 1600, drive: 1.0, water: 0.6 }, // HIGHLAND
  { amp: 26, base: 2, rough: 0.02, wave: 430, drive: 1.0, water: 0.0 }, // DUNES
  { amp: 7, base: -2, rough: 0.05, wave: 700, drive: 1.0, water: 2.5 }, // WETLAND
];

/**
 * Biome-specific relief. Called by world/terrain.js with the already-computed weights so
 * the climate fields are only evaluated once per sample.
 */
export function biomeRelief(x, z, seed, i) {
  const b = BIOME_TERRAIN[i];
  const s = 1 / b.wave;
  switch (i) {
    case BIOME.MEADOW: {
      // Soft rolling hills with a hint of ridge for the enclosing valley walls.
      const soft = warpedFbm2(x * s, z * s, 5, seed ^ 0xa11, 0.55);
      const ridge = ridged(x * s * 0.6, z * s * 0.6, 3, seed ^ 0xa12, 2.0, 0.4);
      return b.base + (soft * 0.82 + ridge * 0.18) * b.amp;
    }
    case BIOME.STEPPE: {
      // Long low swells. Wide-open, so the relief has to be gentle or it reads as clutter.
      const soft = fbm2(x * s, z * s, 4, seed ^ 0xb21, 2.0, 0.42);
      const sweep = noise2(x * s * 0.35, z * s * 0.35, seed ^ 0xb22);
      return b.base + (soft * 0.55 + sweep * 0.45) * b.amp;
    }
    case BIOME.HIGHLAND: {
      // Ridged multifractal is the whole point: sharp crests, deep glacial valleys. The
      // shaping curve is deliberately asymmetric — a mountain range rises far more than
      // its valleys sink, so the exponent lifts the crests while the floor is clamped
      // shallow. Without that, the same amplitude that gives a 300 m peak also digs a
      // 300 m pit and the road network ends up threading a canyon system.
      const r = ridged(x * s, z * s, 6, seed ^ 0xc31, 2.0, 0.4);
      const f = fbm2(x * s * 2.1, z * s * 2.1, 4, seed ^ 0xc32, 2.0, 0.4);
      const u = clamp01(r * 0.5 + 0.5);
      const shaped = Math.pow(u, 1.55) * 1.62 - 0.36;
      return b.base + (shaped * 0.88 + f * 0.12) * b.amp;
    }
    case BIOME.DUNES: {
      // Billow gives the rounded backs; the transverse wave gives the wind-combed crests
      // that all face the same way, which is what makes a dune field read as a dune field.
      const bl = billow(x * s, z * s, 4, seed ^ 0xd41, 2.0, 0.42);
      const comb = Math.sin((x * 0.0121 + z * 0.0047) * 6.283 + fbm2(x * s * 0.5, z * s * 0.5, 3, seed ^ 0xd42) * 4.2);
      return b.base + (bl * 0.55 + comb * 0.45) * b.amp;
    }
    case BIOME.WETLAND: {
      // Almost flat, with shallow pans. The interest here is water, not height.
      const f = fbm2(x * s, z * s, 4, seed ^ 0xe51, 2.0, 0.42);
      const pan = smoothstep(0.15, -0.35, f);
      return b.base + f * b.amp - pan * 4.5;
    }
    default:
      return 0;
  }
}

/**
 * Sea/lake level for a point. Water is per-biome: the wetland floods, the meadow has
 * rivers, the dunes have none. Returns the world Y of the water surface, or null.
 */
export function waterLevelAt(weights, groundY) {
  let level = 0;
  let total = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const w = weights[i];
    if (w < 0.02) continue;
    level += BIOME_TERRAIN[i].water * w;
    total += w;
  }
  if (total <= 0) return null;
  const y = level / total;
  return groundY < y ? y : null;
}

/* ── scatter budgets ─────────────────────────────────────────────────────────
 * Per biome, per 100 m × 100 m of ground: how many of each prop kind to place. The
 * streamer multiplies these by biome weight and by the local slope/road mask.
 */
export const BIOME_SCATTER = [
  // trees rocks bushes reeds  posts  grassMul  treeKinds
  { trees: 26, rocks: 5, bushes: 16, reeds: 0, posts: 0.6, grass: 1.0, kinds: ['broadleaf', 'broadleaf', 'poplar'] }, // MEADOW
  { trees: 4.0, rocks: 8, bushes: 9, reeds: 0, posts: 0.9, grass: 0.72, kinds: ['acacia', 'scrub'] }, // STEPPE
  { trees: 18, rocks: 26, bushes: 6, reeds: 0, posts: 0.4, grass: 0.34, kinds: ['pine', 'pine', 'deadpine'] }, // HIGHLAND
  { trees: 0.5, rocks: 10, bushes: 2, reeds: 0, posts: 0.25, grass: 0.06, kinds: ['palm', 'scrub'] }, // DUNES
  { trees: 11, rocks: 2, bushes: 12, reeds: 34, posts: 1.2, grass: 0.8, kinds: ['willow', 'willow', 'broadleaf'] }, // WETLAND
];

/* ── road surface per biome ──────────────────────────────────────────────────
 * Not every road is tarmac. A steppe arterial is a graded gravel strip; a dune road is a
 * sand track that half-disappears. `grip` feeds straight into the tyre model, so the car
 * genuinely feels different in each biome — which is the point of having biomes at all.
 */
export const BIOME_ROAD = [
  { surface: 'tarmac', grip: 1.0, rough: 0.06, width: 8.0, lines: 1.0 }, // MEADOW
  { surface: 'gravel', grip: 0.78, rough: 0.3, width: 9.0, lines: 0.15 }, // STEPPE
  { surface: 'tarmac', grip: 0.92, rough: 0.14, width: 6.8, lines: 0.8 }, // HIGHLAND
  { surface: 'sand', grip: 0.62, rough: 0.42, width: 10.5, lines: 0.0 }, // DUNES
  { surface: 'tarmac', grip: 0.86, rough: 0.1, width: 7.2, lines: 0.6 }, // WETLAND
];

/** Blend a per-biome scalar by weights. */
export function blendScalar(weights, table, key) {
  let v = 0;
  for (let i = 0; i < BIOME_COUNT; i++) v += weights[i] * table[i][key];
  return v;
}
