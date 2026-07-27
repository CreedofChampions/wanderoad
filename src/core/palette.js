/* Wanderoad — the palette.
 *
 * Every colour in the game, in one place, exactly as the Hoshi-no-Tani pen had it. sRGB hex
 * in, linear vec3 out, because all the shading happens in linear space and the tone map
 * puts it back.
 *
 * The one thing that is new here: a biome TINT. The world is continuous — you drive from
 * meadow into steppe into highland without a loading screen — so we cannot swap palettes.
 * Instead every biome declares a small set of multiplicative/interpolative shifts against
 * the SAME base palette, and the terrain shader blends those shifts by biome weight. One
 * palette, five moods, no seams.
 */

import { Color } from 'three';

export const P = {
  // sky & air
  skyZenith: '#4E80B4',
  skyUpper: '#7BA9CE',
  skyMid: '#A8CAE0',
  skyHorizon: '#E4DAC2',
  skyHorizonSun: '#FBE2AE',
  sunGlow: '#FFF1CE',
  sunDisc: '#FFFAEA',
  skyAnti: '#C8D4D6',
  haze: '#A9BCC7',
  mist: '#D6DDD4',
  // clouds
  cloudTop: '#FFF8EC',
  cloudBody: '#F6E7D2',
  cloudTerm: '#E8CFB4',
  cloudUnder: '#B7ACC3',
  cloudCore: '#9791B0',
  cloudRim: '#FFEFBE',
  cirrus: '#F3E6D6',
  // grass
  gTip: '#C6D46B',
  gUpper: '#93B84E',
  gMid: '#6C9A47',
  gLow: '#436E4F',
  gBase: '#2B564F',
  gTrans: '#E9EE7C',
  gSheen: '#EDF0C8',
  gDry: '#D9C079',
  gPatchA: '#87AC4B',
  gPatchB: '#6C9A56',
  gPatchC: '#9DBC5E',
  gPatchD: '#5F8A5A',
  // terrain
  tLit: '#93B159',
  tMid: '#6A924F',
  tShade: '#456A54',
  tHollow: '#33564F',
  /* Sand, as its OWN set of stops rather than a tint over the green ones. BIOME_TINT's
   * dunes entry describes "rose-and-ochre sand sea", but it can only ever multiply the
   * green terrain stops above — and a multiplier cannot turn green into sand. Measured
   * beside the car at 89% dunes weight, the ground rendered (139,138,93): dry grass, not
   * desert. These get blended in by the dunes weight the same way the snow stops already
   * are by the snow scalar. */
  sandLit: '#E4C89A',
  sandMid: '#CDA877',
  sandShade: '#A67C55',
  sandHollow: '#7E5C42',
  ridgeNear: '#8FA9A2',
  ridgeMid: '#9CB0B4',
  ridgeFar: '#AEBCC9',
  ridgeFurthest: '#BFC8D4',
  pathLit: '#C9AD80',
  pathShade: '#7A664D',
  rockLit: '#B4A794',
  rockShade: '#5F5C58',
  bounce: '#AA9C64',
  // water
  wShallow: '#A5CBBE',
  wMid: '#5F9CA0',
  wDeep: '#2F5F6C',
  wDeepShade: '#274E5C',
  wSpark: '#FFFCEC',
  wFoam: '#EEF5EF',
  wetStone: '#6E7E75',
  // stone
  sA: '#CBB99E',
  sB: '#BDA98C',
  sC: '#D6C6AA',
  sD: '#B2A490',
  sShade: '#6C6355',
  sDeep: '#585A62',
  mortar: '#AB9C85',
  moss: '#6F8C4E',
  lichen: '#B3BE96',
  // trees
  cLit: '#84A94C',
  cMid: '#5A8148',
  cShade: '#2F5546',
  cDeep: '#254A44',
  cTrans: '#BED063',
  cVarA: '#98AC43',
  cVarB: '#6E9440',
  cVarC: '#A9B65C',
  trunkLit: '#8E7659',
  trunkShade: '#4C3F34',
  // built things
  roofA: '#B96A4C',
  roofB: '#A05C46',
  roofSlate: '#6E7583',
  thatch: '#BC9E66',
  wallA: '#EFE4D0',
  wallB: '#E4D5BA',
  timber: '#7C5D46',
  windowGlow: '#FFD98C',
  // the road (new — the pen only had a footpath)
  tarmacLit: '#8E8B86',
  tarmacShade: '#4A4C52',
  tarmacWet: '#5E6670',
  lineWhite: '#F2EADA',
  lineYellow: '#E7C87A',
  gravelLit: '#C3AE8B',
  gravelShade: '#78684F',
  kerb: '#CFC5B2',
  postWood: '#8A7357',
  postPaint: '#EFE4D0',
  // the car (new)
  paintA: '#C8503F',
  paintB: '#E0B14E',
  paintC: '#3F6E8C',
  paintD: '#EFE7D6',
  paintE: '#4E7F79',
  paintF: '#2E3440',
  chrome: '#D7DCE0',
  glass: '#7FA2B8',
  tyre: '#2A2A2E',
  tail: '#E4573F',
  head: '#FFF3D0',
  // light
  sun: '#FFD79C',
  ambSky: '#9EC6E6',
  ambGround: '#AA9C64',
  shadowTint: '#5C6E9E',
};

/** Linear THREE.Color per key. */
export const LIN = {};
for (const k in P) LIN[k] = new Color(P[k]).convertSRGBToLinear();

const v3 = (c) => `vec3(${c.r.toFixed(5)},${c.g.toFixed(5)},${c.b.toFixed(5)})`;

/** GLSL vec3 literal per key — inject straight into a shader with `${C.tLit}`. */
export const C = {};
for (const k in LIN) C[k] = v3(LIN[k]);

/** Linear rgb triple per key, for CPU-side work (particle colours, fog maths). */
export const RGB = {};
for (const k in LIN) RGB[k] = [LIN[k].r, LIN[k].g, LIN[k].b];

/**
 * The `const vec3 K_* = ...` block every shader opens with. Identical to the pen's GL_PAL,
 * plus the road/car keys and the biome tint uniforms the terrain shader needs.
 */
export function glslPalette() {
  return /* glsl */ `
const vec3 K_SUN        = ${C.sun};
const vec3 K_AMB_SKY    = ${C.ambSky};
const vec3 K_AMB_GND    = ${C.ambGround};
const vec3 K_SHADOW     = ${C.shadowTint};
const vec3 K_HAZE       = ${C.haze};
const vec3 K_MIST       = ${C.mist};
const vec3 K_SKY_ZEN    = ${C.skyZenith};
const vec3 K_SKY_UP     = ${C.skyUpper};
const vec3 K_SKY_MID    = ${C.skyMid};
const vec3 K_SKY_HOR    = ${C.skyHorizon};
const vec3 K_SKY_HORSUN = ${C.skyHorizonSun};
const vec3 K_SKY_ANTI   = ${C.skyAnti};
const vec3 K_SUN_GLOW   = ${C.sunGlow};
const vec3 K_SUN_DISC   = ${C.sunDisc};
const vec3 K_C_TOP      = ${C.cloudTop};
const vec3 K_C_BODY     = ${C.cloudBody};
const vec3 K_C_TERM     = ${C.cloudTerm};
const vec3 K_C_UNDER    = ${C.cloudUnder};
const vec3 K_C_CORE     = ${C.cloudCore};
const vec3 K_C_RIM      = ${C.cloudRim};
const vec3 K_T_LIT      = ${C.tLit};
const vec3 K_T_MID      = ${C.tMid};
const vec3 K_T_SHADE    = ${C.tShade};
const vec3 K_T_HOLLOW   = ${C.tHollow};
const vec3 K_SAND_LIT   = ${C.sandLit};
const vec3 K_SAND_MID   = ${C.sandMid};
const vec3 K_SAND_SHADE = ${C.sandShade};
const vec3 K_SAND_HOLLOW= ${C.sandHollow};
const vec3 K_ROCK_LIT   = ${C.rockLit};
const vec3 K_ROCK_SHADE = ${C.rockShade};
const vec3 K_PATH_LIT   = ${C.pathLit};
const vec3 K_PATH_SHADE = ${C.pathShade};
const vec3 K_TAR_LIT    = ${C.tarmacLit};
const vec3 K_TAR_SHADE  = ${C.tarmacShade};
const vec3 K_LINE_W     = ${C.lineWhite};
const vec3 K_LINE_Y     = ${C.lineYellow};
const vec3 K_GRAVEL_LIT = ${C.gravelLit};
const vec3 K_GRAVEL_SHD = ${C.gravelShade};
const vec3 K_W_SHALLOW  = ${C.wShallow};
const vec3 K_W_MID      = ${C.wMid};
const vec3 K_W_DEEP     = ${C.wDeep};
const vec3 K_BOUNCE     = ${C.bounce};
const float SUN_I = 1.38;
`;
}

/* ── biome tints ───────────────────────────────────────────────────────────
 * Each biome is a small deformation of the base palette, expressed as three colour
 * multipliers (ground, rock, foliage), a haze colour, a haze density scale and a grass
 * dryness. The terrain shader receives them as a per-vertex blended vec3/float set, so a
 * fragment sitting on a meadow/steppe border gets a genuine average of the two, not a
 * hard switch.
 *
 * Index order is fixed and shared with world/biomes.js — do not reorder.
 */
export const BIOME_TINT = [
  {
    // 0 — Hoshi Meadow: the pen's own valley, unmodified. The reference mood.
    ground: [1.0, 1.0, 1.0],
    rock: [1.0, 1.0, 1.0],
    foliage: [1.0, 1.0, 1.0],
    haze: P.haze,
    hazeMul: 1.0,
    dryness: 0.0,
    snow: 0.0,
    wet: 0.12,
  },
  {
    // 1 — Amber Steppe: sun-bleached grassland. Everything a stop warmer and a stop drier.
    ground: [1.24, 1.1, 0.72],
    rock: [1.12, 1.05, 0.92],
    foliage: [1.14, 1.02, 0.66],
    haze: '#D6C79E',
    hazeMul: 1.35,
    dryness: 0.85,
    snow: 0.0,
    wet: 0.02,
  },
  {
    // 2 — Cobalt Highlands: cold ridged rock, pine, snowline. Shadows go blue, air goes thin.
    ground: [0.82, 0.9, 0.98],
    rock: [0.9, 0.95, 1.06],
    foliage: [0.72, 0.86, 0.86],
    haze: '#9FB6CE',
    hazeMul: 0.72,
    dryness: 0.1,
    snow: 1.0,
    wet: 0.2,
  },
  {
    // 3 — Bara Dunes: rose-and-ochre sand sea. Almost no green survives here.
    ground: [1.42, 1.06, 0.78],
    rock: [1.3, 1.02, 0.86],
    foliage: [1.05, 0.9, 0.62],
    haze: '#E6C7AC',
    hazeMul: 1.6,
    dryness: 1.0,
    snow: 0.0,
    wet: 0.0,
  },
  {
    // 4 — Kiri Wetland: flooded reed marsh under standing mist. Desaturated, silver-green.
    ground: [0.88, 0.96, 0.9],
    rock: [0.86, 0.9, 0.9],
    foliage: [0.84, 0.96, 0.86],
    haze: '#CBD6D2',
    hazeMul: 1.9,
    dryness: 0.0,
    snow: 0.0,
    wet: 1.0,
  },
];

/** Flat Float32Array of the biome tints, ready to upload as a uniform array. */
export function biomeTintArrays() {
  const n = BIOME_TINT.length;
  const ground = new Float32Array(n * 3);
  const rock = new Float32Array(n * 3);
  const foliage = new Float32Array(n * 3);
  const haze = new Float32Array(n * 3);
  const scal = new Float32Array(n * 4); // hazeMul, dryness, snow, wet
  BIOME_TINT.forEach((b, i) => {
    ground.set(b.ground, i * 3);
    rock.set(b.rock, i * 3);
    foliage.set(b.foliage, i * 3);
    const h = new Color(b.haze).convertSRGBToLinear();
    haze.set([h.r, h.g, h.b], i * 3);
    scal.set([b.hazeMul, b.dryness, b.snow, b.wet], i * 4);
  });
  return { ground, rock, foliage, haze, scal, count: n };
}
