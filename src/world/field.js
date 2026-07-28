/* Wanderoad — THE RAW LAND, and the water sitting in its hollows.
 *
 * This is the bottom of the world. Biomes plus massifs plus a fine common layer, and the
 * per-biome water plane laid over the result. Nothing here knows that roads exist.
 *
 * It lives in its own file for one reason, and it is a structural one rather than a tidiness
 * one: BOTH `terrain.js` and `roads.js` need it, and `terrain.js` already imports `roads.js`.
 * The road network has to read the raw land to pick its own elevation — that is the trick
 * that breaks the circular dependency between "terrain needs the road to flatten itself" and
 * "the road needs the terrain to know its height" — and as of this round it also has to read
 * the WATER, so it can refuse to build a two-kilometre causeway across a lake. Putting these
 * functions here means roads.js can call them directly instead of having them injected, and
 * means there is still exactly ONE definition of where the ground is and one of where the
 * water is. The alternative — re-deriving the height formula inside roads.js — is the "two
 * opinions about the same surface" bug this codebase has already paid for twice.
 *
 * `terrain.js` re-exports everything below, so every existing importer is untouched.
 */

import { biomeWeights, biomeRelief, BIOME, BIOME_COUNT, waterLevelAt } from './biomes.js';
import { landmarkHeight } from './landmarks.js';
import { smoothstep } from '../core/math.js';
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
export const W_CULL = 0.015;
export const W_FADE = 0.055;

export function reliefFromWeights(x, z, seed, w) {
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

const _wWater = new Float32Array(BIOME_COUNT);

/**
 * Water surface height at a point, or null if the land there is dry. The road network reads
 * this so it can build a causeway instead of driving into a lake.
 */
export const waterFn = (seed) => (x, z) => {
  const { w } = biomeWeights(x, z, seed, _wWater);
  return waterLevelAt(w, reliefFromWeights(x, z, seed, w));
};

const _wFlood = new Float32Array(BIOME_COUNT);
const _flood = { wet: false, depth: 0, marsh: 0, land: 0 };

/**
 * IS THIS POINT FLOODED, and is it the KIND of flooded where a road across it is correct?
 *
 * One evaluation answers both, which is the whole reason this exists rather than the caller
 * making two: `waterLevelAt` already needs the biome weights and the raw relief, and the
 * wetland weight is one of the numbers it just looked at. The road cull asks this question
 * a dozen times per lattice edge, so paying twice for it would be paying twice for the
 * single most expensive function in the generator.
 *
 * `marsh` is the WETLAND weight, because a causeway through a marsh is not a mistake — it is
 * the picture the operator asked to keep ("in the wetlands we could still continue to go
 * through"). Everywhere else, standing water under a road means the road is in the wrong
 * place.
 *
 * Returns a shared, mutable object. Read it before the next call.
 */
export function floodAt(x, z, seed) {
  const { w } = biomeWeights(x, z, seed, _wFlood);
  const land = reliefFromWeights(x, z, seed, w);
  const plane = waterLevelAt(w, land);
  _flood.wet = plane !== null;
  _flood.depth = plane === null ? 0 : plane - land;
  _flood.marsh = w[BIOME.WETLAND];
  _flood.land = land;
  return _flood;
}

/**
 * A short string that changes whenever the height field itself changes.
 *
 * The terrain preset mutates the field in place — `game/presets.js` applyTerrain rewrites
 * BIOME_TERRAIN, `biomes.js` setBiomeBias, `landmarks.js` setLandmarkScale — including inside
 * the chunk worker, which re-applies it on every job. So anything CACHED off the field has to
 * be keyed by what the field currently is. `roads.js` already fingerprints it this way for its
 * height caches (`worldTag`); this is the same trick with the same two probe points, exported
 * so the water cull can key its own cache off the identical fingerprint rather than inventing
 * a second, subtly different one.
 *
 * Two samples, and they include the WATER PLANE as well as the land, because a preset can move
 * sea level without moving a metre of ground.
 */
export function fieldTag(seed) {
  const a = floodAt(0, 0, seed);
  const av = Math.round(a.land * 64) + (a.wet ? 1e7 : 0);
  const b = floodAt(1237.5, -911.25, seed);
  const bv = Math.round(b.land * 64) + (b.wet ? 1e7 : 0);
  return `${seed}|${av}|${bv}`;
}
