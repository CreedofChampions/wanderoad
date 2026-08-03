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
  gLow: '#446E43',   // was #436E4F — see gBase
  gBase: '#2C563E',  /* was #2B564F, and this is the grass half of B24.
                     *
                     * The blade's SHADOW colours are what a dense sward shows you at distance — `shd`
                     * is mix(gBase*0.82, gLow) and `mid` starts at gBase — and both were TEAL, not
                     * dark green: gBase #2B564F is r43 g86 b79, blue 36 ABOVE red, and gLow #436E4F
                     * is 12 above. Every lit colour in the ramp is strongly green (gMid -37, gUpper
                     * -69, gTip -91), so the field reads green close up, where the lit faces show,
                     * and turns blue-grey at range, where the shaded interior takes over. That is
                     * exactly the complaint: "more blue than green for human eye".
                     *
                     * Both are brought to a dark GREEN of the same value — the shadows stay as deep
                     * as they were, they simply stop being teal. */
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
  ambSky: '#BCCFDD',  /* was #9EC6E6, and this is the answer to B24 after five investigations.
                       *
                       * Operator, for weeks: "the land is a dark blue/green ... more blue than green
                       * for human eye". Measured, the land is GREEN (grass alone reads b-r -22.6).
                       * The ROAD is blue (+22.2 before today, +13.6 after the post grade was warmed).
                       *
                       * core/glsl.js builds its hemispheric ambient as
                       *     hemi = mix(K_AMB_GND, K_AMB_SKY, N.y*0.5 + 0.5)
                       * so a surface facing STRAIGHT UP takes the full sky colour — and #9EC6E6 is
                       * r158 g198 b230, blue 72 above red. Tarmac is flat, faces straight up, and is
                       * a near-neutral grey (#8E8B86) with no colour of its own to hide the tint.
                       * Grass blades face every which way and are saturated green, which swamps it.
                       * Same lighting, opposite readings — which is exactly what was measured.
                       *
                       * Paled rather than neutralised: a blue sky bounce is real and is what keeps
                       * shadows from going flat grey. It just should not be dyeing the carriageway. */
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
    /* 2 — Cobalt Highlands: ridged rock, pine, snowline. The AIR is cold and thin (see `haze`);
     * the GROUND is not, and that distinction is the whole of the fix below.
     *
     * Operator, with a photograph: "ground is blue here in highlands". It measured +17.7 blue over
     * red (`node tools/shot-stats.mjs`) on a sunlit hillside — ground that is literally bluer than it
     * is red, in daylight, which nothing outdoors is except water and ice.
     *
     * Two things were pushing it there and this is one of them: `rock` multiplied the shared rock
     * stops by [0.9, 0.95, 1.06], cutting red 10% and lifting blue 6% — a 17% relative shift into
     * blue, applied on exactly the steep faces (rockAmt starts at slope 0.36) that a hillside is made
     * of. Now a whisper warm instead. The other was the ground ramp; see BIOME_GROUND below.
     *
     * What stays blue is `haze`, and it should: aerial perspective really is blue, it is what makes
     * a far ridge read as far, and it only touches distance. Cold air, warm stone. */
    ground: [0.82, 0.9, 0.98],
    rock: [1.02, 1.0, 0.97],
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

/* ── per-biome GROUND RAMPS ────────────────────────────────────────────────
 *
 * BIOME_TINT's `ground` entry is a MULTIPLIER over the one shared green ramp above, and a
 * multiplier cannot change a hue — it can only make the same green lighter, darker or
 * warmer. That limitation has now cost two separate rounds. The dunes entry claimed a
 * "rose-and-ochre sand sea" for months while the ground measured (139,138,93) olive, and it
 * was only fixed by giving sand its OWN stops; then the operator looked at the finished
 * world and said "u just renamed them but they are similar 3 biomes sand, snow, hills".
 *
 * Same disease, four more patients. So every biome now declares its own four-stop ramp —
 * lit / mid / shade / hollow, the same four the terrain shader has always mixed by its
 * `blot` field — and the shader blends the RAMPS by biome weight instead of blending one
 * ramp through five multipliers. One extra table, no new mechanism, and the special-cased
 * `sand` block in terrainMaterial.js collapses into it.
 *
 * MEADOW IS THE BASE PALETTE, UNCHANGED, ON PURPOSE. Its four entries are literally tLit /
 * tMid / tShade / tHollow, so the reference valley the pen drew renders exactly as it did
 * before this table existed, and any colour difference measured anywhere else is a real
 * difference rather than a global shift.
 *
 * The four others are chosen to separate on HUE, not on brightness, because brightness is
 * what the sun and the aerial haze already vary by the time it reaches the eye:
 *   STEPPE    gold/straw — the yellow of standing dead grass, the one colour the meadow's
 *             green can never be mistaken for.
 *   HIGHLAND  BARE WARM STONE, and it is the one biome that separates by being nearly
 *             ACHROMATIC rather than by hue. Two rounds got this wrong in opposite directions.
 *             First it was a 0.82/0.90/0.98 multiplier over the green ramp — a slightly bluer
 *             green, i.e. still green, which is why "hills" was one of three biomes the operator
 *             could name and "highland" was not one of five. The fix for that overshot into
 *             '#9FB0B8'/'#748A99'/'#4E6274'/'#36455A', a genuinely blue slate: 33% and 40%
 *             saturated in the two dark stops, which are the stops a slope facing away from the
 *             sun is painted with. Result, photographed and then measured with
 *             `node tools/shot-stats.mjs`: +17.7 blue over red on a sunlit hillside. Ground in
 *             daylight is never bluer than it is red.
 *
 *             So the third answer is neither green nor blue: desaturated LICHEN-GREY rock, about 10%
 *             saturation, red and green within about three points of each other and blue held below
 *             both, so it is warm without being warm-hued.
 *
 *             That last clause is not fussiness — the first attempt at it ('#C2BCAF'/'#98917F'/
 *             '#6A665C'/'#4A473F') put red comfortably above green and photographed as a SAND
 *             hillside, which trades a collision with the wetland for a collision with the dunes and
 *             is no better. Sand's own mid stop is '#CDA877', red 37 above green; this ramp keeps
 *             that gap at 3, which is the whole difference between stone and desert. It is still unmistakable next to the other four BECAUSE it is the
 *             grey one — every other biome here is strongly hued, so "no hue" is itself an
 *             identity, and it is the honest one for a bare ridge above the treeline.
 *
 *             The cold is not lost, it moved to where cold belongs: BIOME_TINT's blue `haze`
 *             (air), the snow blend above 120 m (terrainMaterial.js), and the snowline grass
 *             suppression that shares that ramp (render/grass.js).
 *   DUNES     the existing sand stops, promoted out of their special case.
 *   WETLAND   SEDGE GREEN. It was '#8BBCC2'/'#5A939D'/'#3B6A7A'/'#254550' — "silver-teal peat" —
 *             and the operator caught it exactly as he caught the highlands: "wetland at -3000
 *             +10,000 is blue land/grass (should be green)". Those four stops run +55 to +67 blue
 *             over red; ground in daylight is never bluer than it is red, and a marsh is not an
 *             exception — a marsh is GREEN, and greener than dry land, because it never dries out.
 *
 *             This is the SECOND biome to make the same mistake (highlands was the first, fixed the
 *             same way with the same tool), and both came from the same good intention: separating
 *             the biomes by hue. The lesson is that the hue budget only runs from warm to cool
 *             through green and gold — it does not extend to blue, because blue is water. Wetland now
 *             separates from the meadow by being LESS YELLOW and darker (b-r -24 against the meadow's
 *             -58) rather than by being cool, which keeps them apart without either going blue.
 */
export const BIOME_GROUND = [
  [P.tLit, P.tMid, P.tShade, P.tHollow], // 0 MEADOW — the pen's own valley, untouched
  ['#D7D278', '#A9B84A', '#7F8438', '#57592B'], // 1 STEPPE   — sun-bleached gold
  ['#BCBCAE', '#8F9280', '#64685A', '#464A3F'], // 2 HIGHLAND — lichen-grey stone (see note below)
  [P.sandLit, P.sandMid, P.sandShade, P.sandHollow], // 3 DUNES — rose-and-ochre sand
  ['#9CBB84', '#6C9163', '#456A4F', '#2E4838'], // 4 WETLAND  — sedge green (see the note below)
];

/* How hard the ground palette snaps to the dominant biome, as one exponent.
 *
 * The weights arriving at the shader are a genuine 5-way partition and they are SOFT: over a
 * 44 km scan of the shipped seed, meadow never exceeds 0.509 and steppe never exceeds 0.448
 * (`node tools/diag-biomes.mjs`). Blend five ramps by those and every green biome averages to
 * the same olive — which is exactly the report. Raising the weights to a power and
 * renormalising pulls the dominant biome's own ramp forward without introducing any
 * discontinuity: it is smooth wherever the weights are, and it preserves the partition and
 * the ordering.
 *
 * IT IS APPLIED TO COLOUR ONLY. Sharpening the weights at source in world/biomes.js was tried
 * and swept, and it takes `node tools/diag-cliffs.mjs` from 0.008% to 0.625% at the equivalent
 * strength, because those same weights blend the terrain relief. See the long note in
 * biomes.js. 3.0 is swept — see docs/BACKLOG.md. */
export const GROUND_SHARPEN = 3.0;

/** Flat Float32Array of the per-biome ground ramps: 4 stops x vec3, linear. */
export function biomeGroundArrays() {
  const n = BIOME_GROUND.length;
  const out = [0, 1, 2, 3].map(() => new Float32Array(n * 3));
  BIOME_GROUND.forEach((ramp, i) => {
    ramp.forEach((hex, s) => {
      const c = new Color(hex).convertSRGBToLinear();
      out[s].set([c.r, c.g, c.b], i * 3);
    });
  });
  return { lit: out[0], mid: out[1], shade: out[2], hollow: out[3], count: n };
}

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
