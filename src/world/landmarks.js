/* Wanderoad — the things on the horizon.
 *
 * The biome relief in biomes.js owns the 400–2000 m band: the hills you drive over. Nothing
 * owned the band above that, and the result was a world with no destination in it — the
 * player's words were "there's somewhere to go, you know", and there wasn't.
 *
 * This layer is a lattice of massifs. One site per 3.6 km cell, jittered inside its cell,
 * each a smooth dome 90–330 m tall. It is added to the land OUTSIDE the biome weighting,
 * on purpose, for two reasons:
 *
 *   1. A mountain is a mountain. Weighting it by biome mix would dissolve it exactly where
 *      the mix is transitional, which is most of the world, and a landmark that fades in
 *      and out is not a landmark.
 *   2. Terrain samplers cache the climate fields on a coarse lattice and CLAMP outside their
 *      own box (see ClimateGrid in terrain.js). Anything derived from biome weights is
 *      therefore wrong when you sample 4 km outside a local sampler — which is precisely
 *      what "can I see that mountain from here" asks. A pure function of (x, z, seed) is
 *      right everywhere, at any range, from any sampler.
 *
 * SLOPE IS THE WHOLE DESIGN CONSTRAINT. A dome of height H and radius R with the profile
 * (1-u²)² has a maximum gradient of 1.54·H/R, and nothing else about it matters. Every
 * number below is chosen against that: the radius is tied to the height by a ratio, so a
 * taller mountain is automatically a wider one and the steepest face stays 13–17°. You
 * can make this layer enormous without making a single unclimbable metre — which is the
 * opposite of what happens if you scale a fractal's amplitude, where the fine octaves carry
 * most of the gradient and almost none of the height.
 */

import { hash2i, smoothstep, lerp } from '../core/math.js';
import { ridged } from '../core/noise.js';

/** Metres between massif sites. One per cell, always — see `siteAt`. */
const CELL = 3600;

/**
 * Height-to-radius ratio. 1.54/RATIO is the steepest gradient the dome can ever reach, so
 * 5.2 is about 16.5° and 6.8 is about 12.8°. Do not let this go below ~4 (21°) — the biome
 * relief and the road embankments have to fit in the same slope budget, and they meet.
 *
 * It also sets how much of the world is mountain at all: a wider dome is a bigger footprint,
 * and at ratio 10 the domes tiled the whole plane, lifted every lake out of its basin and
 * turned a cozy world into a permanent mountainside. At 5.2–6.8 they cover about a third.
 */
const RATIO_LO = 5.2;
const RATIO_HI = 6.8;

/** How tall the massifs are, before the preset multiplier. */
const H_LO = 90;
const H_HI = 330;

/* A per-preset multiplier on massif height. Mutated by game/presets.js and re-applied inside
 * the chunk worker, which has its own module graph — see chunkWorker.js. */
export const LANDMARK = { scale: 1 };
export function setLandmarkScale(s) {
  LANDMARK.scale = Number.isFinite(s) && s >= 0 ? s : 1;
}

const F = 1 / 4294967296;

/**
 * The massif belonging to one lattice cell. Deterministic: two integers and a seed in,
 * always the same mountain out.
 *
 * The site is kept away from the cell edges (0.18–0.82) rather than jittered across the
 * whole cell. Free jitter lets two neighbouring sites land a couple of hundred metres apart,
 * and two overlapping domes add their gradients where they meet — the one case where this
 * construction can produce a face steeper than its ratio promises.
 */
function siteAt(cx, cz, seed, out) {
  const h = hash2i(cx, cz, seed ^ 0x1a7d33);
  const g = hash2i(cx, cz, seed ^ 0x77c15b);
  const ox = 0.18 + 0.64 * ((h & 0xffff) / 65536);
  const oz = 0.18 + 0.64 * (((h >>> 16) & 0xffff) / 65536);
  const t = g * F; // 0..1
  // Skewed low: most cells get a hill, a few get the mountain you drive two days towards.
  const hh = H_LO + (H_HI - H_LO) * Math.pow(t, 1.45);
  const ratio = lerp(RATIO_LO, RATIO_HI, ((g >>> 9) & 0x3ff) / 1023);
  const s = LANDMARK.scale;
  out.x = (cx + ox) * CELL;
  out.z = (cz + oz) * CELL;
  out.h = hh * s;
  /* Radius against scale, in two halves, because the two directions want opposite things.
   *
   * Turning a preset DOWN (plains, marsh) should flatten it: the radius shrinks more slowly
   * than the height, so a 0.4-scale massif is a broad low swell rather than a small sharp
   * one. Turning it UP (alpine) must not make it steeper — alpine's drama is meant to be
   * that the mountains are 1.7x TALLER, not that their faces are 1.7x harder to climb, and
   * the whole slope budget is already spent on the road embankments that climb them. s^0.94
   * holds the face gradient within a couple of degrees of the default all the way up.
   *
   * The two branches agree at s = 1, which is the only place they have to. */
  out.r = hh * ratio * (s <= 1 ? 0.62 + 0.38 * s : Math.pow(s, 0.94));
  return out;
}

const _site = { x: 0, z: 0, h: 0, r: 0 };

/**
 * Height added by the massif layer at a point, and the local dome coverage.
 *
 * Domes are SUMMED, not maxed. Taking the max of two overlapping domes leaves a crease along
 * the surface where they cross — continuous in height, discontinuous in slope, and the eye
 * finds that seam immediately. Summing gives a saddle, which is what a real range does.
 */
function landmarkField(x, z, seed, out = { h: 0, cover: 0, top: 0 }) {
  const gx = Math.floor(x / CELL);
  const gz = Math.floor(z / CELL);
  let h = 0;
  let cover = 0;
  let top = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const s = siteAt(gx + i, gz + j, seed, _site);
      const dx = x - s.x,
        dz = z - s.z;
      const d2 = dx * dx + dz * dz;
      const r2 = s.r * s.r;
      if (d2 >= r2) continue;
      const u = 1 - d2 / r2; // (1-u²) with u = d/r, without the sqrt
      const p = u * u; // profile (1-(d/r)²)², max gradient 1.54·h/r
      h += s.h * p;
      if (p > cover) cover = p;
      if (s.h > top) top = s.h;
    }
  }
  out.h = h;
  out.cover = cover;
  out.top = top;
  return out;
}

const _lf = { h: 0, cover: 0, top: 0 };

/* Rock texture on the massifs. One ridged field for the whole world, masked to where the
 * domes actually are so it costs no slope out on the flat. The wavelength is long (940 m)
 * and the amplitude is 5.5% of the local massif height, which on a 330 m peak is 18 m over
 * 940 m — a few degrees of extra gradient on a face that already has 16. It is there to stop a
 * mountain reading as a pudding, not to make crags. */
const TEX_SCALE = 1 / 940;
const TEX_SHARE = 0.055;

/** The whole landmark contribution — dome plus its texture. Pure in (x, z, seed). */
export function landmarkHeight(x, z, seed) {
  const f = landmarkField(x, z, seed, _lf);
  if (f.h <= 0.01) return 0;
  const tex = ridged(x * TEX_SCALE, z * TEX_SCALE, 3, seed ^ 0x51e7, 2.1, 0.32);
  // Fade the texture out at the very foot of the dome so it cannot put a lip on the plain.
  return f.h + tex * f.top * TEX_SHARE * smoothstep(0.0, 0.22, f.cover);
}

/**
 * The nearest massif to a point: where its summit is, how tall, how wide, and therefore the
 * steepest face it can have (1.54·h/r — see the header). tools/diag-relief.mjs reads this to
 * assert that the thing the player is being asked to drive towards is drivable, which is the
 * one property of this layer that a picture cannot prove.
 */
export function nearestLandmark(x, z, seed) {
  const gx = Math.floor(x / CELL);
  const gz = Math.floor(z / CELL);
  let best = null;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const s = siteAt(gx + i, gz + j, seed, { x: 0, z: 0, h: 0, r: 0 });
      const d = Math.hypot(x - s.x, z - s.z);
      if (!best || d < best.d) best = { x: s.x, z: s.z, h: s.h, r: s.r, d, maxGrade: (1.5396 * s.h) / s.r };
    }
  }
  return best;
}

