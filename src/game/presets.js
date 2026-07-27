/* Wanderoad — preview presets.
 *
 * Driving feel is not something you can settle from a spec; you settle it by driving. So the
 * whole feel is a handful of numbers that can be swapped from the URL, and a gallery page
 * links to every combination. `?feel=cruiser&terrain=alpine` is a complete configuration.
 *
 * Nothing here is a code path — every preset drives the same solver. If a preset needs new
 * code to exist, it is not a preset, it is a feature.
 */

import { STEER, PRESETS as ASSIST_PRESETS, CAMERA, TYRE } from '../car/tuning.js';
import { BIOME_TERRAIN } from '../world/biomes.js';
import { setLandmarkScale } from '../world/landmarks.js';

/* ── how the car feels ────────────────────────────────────────────────────
 *  comfortG   lateral acceleration at full stick. THE number for darty vs planted.
 *  assist     which aid ladder rung to start on
 *  camera     which chase rig
 *  rearGrip   multiplier on rear lateral μ — below 1 the car rotates on throttle
 *  buildRate  how fast a keyboard press reaches full stick, in units/second
 */
export const FEELS = {
  cruiser: {
    label: 'Cruiser',
    blurb: 'Calm and planted. Full stick is 0.7 g, the camera never moves in a hurry. This is the cozy default.',
    comfortG: 7.0,
    assist: 'cruise',
    camera: 'cruise',
    rearGrip: 1.04,
    buildRate: 1.6,
    tier: 'gt',
    car: 'estate',
  },
  road: {
    label: 'Road',
    blurb: 'The default. A fast road car: 0.96 g at full stick, sport aids, the chase camera looks into the corner.',
    comfortG: 9.4,
    assist: 'sport',
    camera: 'sport',
    rearGrip: 1.0,
    buildRate: 2.0,
    tier: 'sports',
    car: 'coupe',
  },
  sharp: {
    label: 'Sharp',
    blurb: 'More lock, faster hands. 1.25 g at full stick and a quicker steering ramp — quick, still not twitchy.',
    comfortG: 12.2,
    assist: 'sport',
    camera: 'sport',
    rearGrip: 0.98,
    buildRate: 3.2,
    tier: 'sports',
    car: 'rally',
  },
  drift: {
    label: 'Drift',
    blurb: 'Loose rear end and a lot of lock. Made for holding a slide, not for lap times.',
    comfortG: 13.5,
    assist: 'off',
    camera: 'sport',
    rearGrip: 0.86,
    buildRate: 3.6,
    tier: 'sports',
    car: 'sedan',
  },
  sim: {
    label: 'Raw',
    blurb: 'No assists at all, no comfort limit — the full 40° rack, tapered only by speed. Hard.',
    comfortG: 40.0,
    assist: 'hardcore',
    camera: 'sport',
    rearGrip: 1.0,
    buildRate: 4.0,
    tier: 'sports',
    car: 'coupe',
  },
  hyper: {
    label: 'Hyper',
    blurb: 'All-wheel drive, 800 hp, 340 km/h. Planted at speed, and quick enough to need the calm camera.',
    comfortG: 10.5,
    assist: 'sport',
    camera: 'sport',
    rearGrip: 1.02,
    buildRate: 2.2,
    tier: 'hyper',
    car: 'patrol',
  },
};

/* ── what the land looks like ─────────────────────────────────────────────
 * Each entry scales the five biomes' relief. The reference is the Hoshi-no-Tani pen: soft,
 * readable, nothing vertical.
 *
 *   amp   scales biome relief height
 *   wave  scales biome relief wavelength — raising wave at constant amp is the single knob
 *         that makes terrain gentler without making it flat
 *   peak  scales the massif layer in world/landmarks.js: the mountains on the horizon, the
 *         thing you drive TOWARDS. This is a separate knob from `amp` because the two do
 *         different jobs — `amp` is what the road undulates over, `peak` is the skyline. A
 *         preset that turns one down does not have to turn the other down.
 *
 * `amp` is no longer the whole story of how dramatic a preset is; the octave stack in
 * biomes.js is. Turning `amp` up here scales every octave together, which is the expensive
 * way to buy relief — keep these multipliers near 1 and change the biome table instead.
 */
export const TERRAINS = {
  meadow: {
    label: 'Meadow',
    blurb: 'The pen’s own valley. Soft rolling hills, wide sightlines, nothing you cannot drive over.',
    amp: 0.95,
    wave: 1.12,
    peak: 1.0,
    bias: [2.2, 1.0, 0.35, 0.3, 0.8],
  },
  rolling: {
    label: 'Rolling',
    blurb: 'The default mix. Meadow and steppe with hills and the occasional mountain on the horizon.',
    amp: 1.0,
    wave: 1.0,
    peak: 1.0,
    bias: [1, 1, 1, 1, 1],
  },
  alpine: {
    label: 'Alpine',
    blurb: 'Mountains close in. Switchbacks, cuttings and long climbs — the most dramatic and the least forgiving.',
    amp: 1.12,
    wave: 0.97,
    peak: 1.7,
    bias: [0.6, 0.5, 3.0, 0.2, 0.5],
  },
  plains: {
    label: 'Plains',
    blurb: 'Almost flat. Kilometres of straight road under a huge sky — the best place to feel top speed.',
    amp: 0.9,
    wave: 1.18,
    peak: 0.78,
    bias: [0.8, 3.0, 0.15, 1.2, 0.7],
  },
  dunes: {
    label: 'Dunes',
    blurb: 'Rose and ochre sand sea. Loose grip, long crests, the road half-buried.',
    /* Playtest, round 2: "dunes must be a new desert theme... dunes smooth but tall", not
     * another hilly preset with a sand texture. `amp` raised from the old 0.9 — this preset's
     * own bias already pushes HIGHLAND weight down to 0.2, so the boundary hot-spot that
     * capped how far `BIOME_TERRAIN[DUNES].amp` itself could move (see biomes.js) is far
     * weaker here, and this multiplier is scoped to this preset alone: it cannot touch
     * `diag-cliffs.mjs`'s default-preset gate, which never calls applyTerrain. 0.98 keeps
     * `node tools/diag-relief.mjs dunes`'s own cliffs% comfortably under alpine's ("the most
     * dramatic and the least forgiving") — taller without becoming the jaggedest preset in
     * the game, which is not what "smooth" asked for. */
    amp: 0.98,
    wave: 1.1,
    peak: 0.8,
    bias: [0.3, 0.9, 0.2, 3.5, 0.2],
  },
  marsh: {
    label: 'Wetland',
    blurb: 'Flooded reed flats under standing mist. Dead flat, causeways and mirrors.',
    amp: 0.75,
    wave: 1.15,
    peak: 0.75,
    bias: [0.7, 0.3, 0.2, 0.1, 3.5],
  },
};

/** Apply a feel preset. Mutates the tuning tables, which is the point — one solver, many cars. */
export function applyFeel(name) {
  const f = FEELS[name] || FEELS.road;
  STEER.comfortG = f.comfortG;
  STEER.attackG = f.comfortG * 1.6;
  STEER.buildBase = f.buildRate;
  STEER.buildBonus = f.buildRate;
  TYRE.muLatRear = 1.34 * f.rearGrip;
  return f;
}

/** Apply a terrain preset. Also mutates, for the same reason. */
export function applyTerrain(name) {
  const t = TERRAINS[name] || TERRAINS.rolling;
  if (!BIOME_TERRAIN.__base) {
    BIOME_TERRAIN.__base = BIOME_TERRAIN.map((b) => ({ ...b }));
  }
  const base = BIOME_TERRAIN.__base;
  for (let i = 0; i < BIOME_TERRAIN.length; i++) {
    // `* (t.bias[i] > 1 ? 1 : 1)` used to sit on this line. It multiplies by one either way;
    // it was a per-biome amplitude bias that was never finished, and leaving it there made
    // it look as though the bias affected height when it only ever affected biome share.
    BIOME_TERRAIN[i].amp = base[i].amp * t.amp;
    BIOME_TERRAIN[i].wave = base[i].wave * t.wave;
  }
  // The massifs are a separate layer with its own module-level state, and like the biome
  // table it has to be re-applied inside the chunk worker — the worker has its own module
  // graph and never sees a mutation the main thread made. chunkWorker.js calls applyTerrain
  // per job, so putting it here is what makes it reach the screen.
  setLandmarkScale(t.peak ?? 1);
  return t;
}

/** Biome weight bias, read by world/biomes.js so a preview can be mostly one biome. */
export function terrainBias(name) {
  const t = TERRAINS[name] || TERRAINS.rolling;
  return t.bias;
}

/** Parse the whole configuration out of a URL.
 *
 * `feel` is kept only so old preview links still resolve to something sensible. The feel is
 * now a property of the CAR — see src/game/garage.js — because picking a body and then
 * separately picking how it handles is a testing convenience, not a game. */
export function configFromUrl(search = location.search) {
  const p = new URLSearchParams(search);
  const feel = FEELS[p.get('feel')] ? p.get('feel') : 'road';
  const terrain = TERRANS_OK(p.get('terrain')) ? p.get('terrain') : 'rolling';
  return { feel, terrain, debug: p.has('debug'), offline: p.has('offline'), cheat: p.has('cheat') };
}
const TERRANS_OK = (k) => !!TERRAINS[k];
