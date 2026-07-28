/* Wanderoad — stylised water.
 *
 * Ported from the pen's river (`buildRiverGeometry`, `WATER_VS`, `WATER_FS`) and retargeted
 * from one hand-authored spline to per-chunk planes in an infinite world.
 *
 * The pen could afford to know everything about its water: a single ribbon swept along a
 * spline, so every vertex knew how far across the channel it sat, how wide the channel was
 * there and how fast it ran. None of that survives streaming. What the world DOES know, per
 * chunk, is the flooded level (`rec.water.level`, blended from the biome mix by
 * `waterLevelAt`) and the terrain height at every mesh vertex — so the three quantities the
 * shader actually consumes are rebuilt from those instead:
 *
 *   depth  metres of water over the bed. Replaces the pen's `1 - |across|`; it is what
 *          drives the colour plates, the caustics on the bed and the shore foam, and unlike
 *          the pen's proxy it is a real measurement, so foam lands exactly on the waterline.
 *   flow   the downhill direction of the bed. A flooded valley visibly creeps down-valley,
 *          which is what the pen's flow ribbons and streak advection need to read as water
 *          rather than as animated glass.
 *   speed  from the bed's gradient. A still wetland flood barely moves; a stream running off
 *          a highland shoulder does.
 *
 * All three are baked into one vec4 attribute at chunk-adopt time, so the per-frame cost of
 * water is a flat quad grid and nothing else.
 *
 * A fourth quantity, `wopen`, joins them for the same reason (see waterOpenness() below): a
 * genuinely large body of water reads as open, calm water, not as a lake-sized puddle showing
 * the same chop as a farm pond. Answering "how big is the water here" exactly would mean a
 * flood fill over the whole connected body, which this project does not do per frame or even
 * per chunk-adopt — instead a handful of point samples on two rings around the vertex, snapped
 * to a coarse world-aligned cell and cached (module-level, keyed by cell, never by chunk), so
 * every water chunk that shares a cell — which is most neighbours, since the cell is far bigger
 * than a chunk at any LOD below the coarsest — agrees exactly and draws no seam at the chunk
 * boundary, and the ring is only ever walked once per cell for the life of the session.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  Object3D,
  RawShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import {
  fragHead,
  vertHead,
  glCloudField,
  GL_HASH,
  GL_LIGHT,
  GL_NOISE,
  GL_SHADOW,
  GL_SKY,
} from '../core/glsl.js';
import { C } from '../core/palette.js';
import { clamp01, hash2i, TAU } from '../core/math.js';
import { sharedUniforms, U } from './uniforms.js';
import { biomeWeights, waterLevelAt, BIOME_COUNT } from '../world/biomes.js';
import { landHeight } from '../world/terrain.js';

/* The cloud-shadow projection must match the terrain's exactly or the water in a lake would
 * sit in a different cloud's shadow than the shore beside it. Same numbers as
 * createTerrainMaterial(). */
const CLOUD_SPAN = 9200;
const CLOUD_DECK = 980;

/* Above this quadtree level a chunk is wider than 1 km, and `rec.water.level` — a single
 * average over the whole node — stops describing anywhere in particular. Level 4 nodes live
 * between roughly 1.7 km and 3.5 km out, where aerial perspective is already at ~90%, so
 * dropping water beyond that costs nothing visible: the terrain shader's own wet-sheen term
 * keeps painting standing water out to the horizon. */
const MAX_WATER_LEVEL = 4;

/* Re-test visibility ten times a second rather than every frame. The set of water planes
 * changes at streaming rates, not at frame rates. */
const CULL_INTERVAL = 0.1;

/* ── water-body openness: a coarse, cached size estimate ─────────────────────
 * "Large" here means "surrounded by more water", which is the one thing a river or a farm
 * pond cannot fake: a point on a 6-8 m wide river almost always has dry bank within a couple
 * of hundred metres in most directions, however long the river runs, and a compact pond reads
 * the same way. A real lake or sea does not — most directions stay wet for hundreds of metres.
 *
 * Two rings (200 m and 400 m, ten spokes each) rather than one: a single ring is fooled by an
 * elongated shape (a long, narrow bay can read "open" at the one radius that happens to run
 * along it) and two independent radii very rarely agree on a false positive at once. Every
 * sample point snaps to the centre of a 220 m world-aligned cell and is cached there for the
 * life of the session — not just for speed (though it is: 20 point samples the first time a
 * cell is asked for, an object lookup every time after), but because it is what makes two
 * water CHUNKS that are neighbours in the world, and therefore usually share a cell or query
 * adjacent ones, agree closely enough that no seam shows at the boundary between them.
 *
 * Thresholds and the two radii were read off real bodies in the shipped seed, not guessed:
 * `node tools/diag-openwater.mjs` prints the table this was calibrated from. Over a 12 km
 * square, the twelve largest connected bodies (up to 11.1 km²) scored 0.60-1.00 at their most
 * open point; everything under 25,000 m² scored 0.00-0.70, the occasional high outlier being a
 * cluster of several small pools within one wetland rather than a single body — which this
 * proxy cannot and is not trying to tell apart from one genuinely large body, because doing
 * that exactly is the flood fill this file is explicitly not doing. */
const OPEN_CELL = 220; // metres — the world-aligned snap grid the cache keys on
const OPEN_R1 = 200;
const OPEN_R2 = 400;
const OPEN_DIRS = 10;
/** Below this score chop is unchanged; above it, fully calmed — see OPEN_CALM_* below. Exported,
 *  like ambience.js's SEA_RANGE/SEA_MAX, so tools/diag-openwater.mjs prints the real thresholds
 *  rather than a re-derived guess at them. */
export const OPEN_LO = 0.55;
export const OPEN_HI = 0.92;
/** Ripple/normal amplitude on the calmest, largest water: 30% of normal, not zero — a dead
 *  mirror reads as broken rather than as a calm sea, and the glint terms need SOME normal
 *  variation to have anything to catch. */
export const OPEN_CALM_AMP = 0.3;
/** Wind-gust darkening on the same water: cut by just over half, not to nothing — an open sea
 *  still shows cat's paws when the wind gets up, a village pond does not. */
export const OPEN_CALM_GUST = 0.45;

/**
 * Pure JS mirror of the shader's `calm` term (`smoothstep(OPEN_LO, OPEN_HI, openness)`), and of
 * how it scales the ripple amplitude and the gust darkening — the exact arithmetic the GLSL
 * above is generated from, at the same OPEN_LO/OPEN_HI/OPEN_CALM_* constants, so a diagnostic
 * tool can print real before/after amplitude numbers instead of a description of the shader.
 */
export function calmFactor(openness) {
  const t = Math.max(0, Math.min(1, (openness - OPEN_LO) / (OPEN_HI - OPEN_LO)));
  return t * t * (3 - 2 * t); // smoothstep
}
/** Ripple/normal-amplitude multiplier at a given openness, 1 (full chop) down to OPEN_CALM_AMP. */
export function ampMultiplier(openness) {
  const calm = calmFactor(openness);
  return 1 - calm * (1 - OPEN_CALM_AMP);
}
/** Wind-gust multiplier at a given openness, 1 down to OPEN_CALM_GUST. */
export function gustMultiplier(openness) {
  const calm = calmFactor(openness);
  return 1 - calm * (1 - OPEN_CALM_GUST);
}

/* ── far-field flattening: the moire fix ──────────────────────────────────────────────────
 * Playtest report, on the one part of the water that still failed: "coarse diagonal streak
 * banding across the whole left half of the lake", and at 2.4x zoom "a fine crosshatch
 * shimmer band forming at mid-to-far distance. In a still it is mild; in motion it will
 * crawl." Both are the same defect with two faces, and the analysis is worth writing down
 * because the obvious fix was already in this file and was not enough.
 *
 * bandLimit() below fades each ripple band out as its own frequency approaches the pixel
 * footprint, ANISOTROPICALLY — a deliberately clever thing to do, and correct as far as it
 * goes (its own comment explains why the isotropic version blurs the whole sheet the moment
 * the camera drops to eye level, which in a driving game is always). What it cannot do is
 * make a POINT SAMPLE behave like an anisotropic average. At grazing incidence a pixel is
 * tens of metres long down the view and less than a metre across it; the cross-axis
 * frequency is still comfortably resolvable, so the band stays alive, and the surviving
 * band is then sampled once somewhere inside a fifteen-metre-long footprint. That is
 * textbook undersampling ALONG the view, and undersampling along the view of a set of bands
 * that all run down one fixed world axis (RIP_AXIS) is exactly a diagonal streak that
 * crawls when you move.
 *
 * The honest fix for that is more samples, which a full-screen sheet of water cannot afford.
 * So the surface stops trying: past FAR_FLAT_FULL metres there IS no high-frequency signal
 * left to alias, because everything that carries one is faded to nothing — the ripple normal
 * (so the reflection stops churning), the gust field (so the cat's-paw darkening stops
 * striping), the flow ribbons and the quantised glitter. What remains far out is the depth-
 * graded body colour, the sky wash and the aerial haze: a plate of luminous blue, which is
 * exactly what this file's own reflection comment already says it wants distant water to be,
 * and exactly what the operator asked for ("large bodies of water should be flat").
 *
 * The near number is 90 m and not 200: the fade has to be WELL under way by the distance the
 * report photographed, and 90 m is comfortably past the foreground water a driving camera
 * sees in detail. Nothing inside 90 m changes at all.
 */
/** Metres at which the far-field flattening starts. Below this, nothing changes. */
export const FAR_FLAT_NEAR = 90;
/** ...and at which it is complete: no ripple normal, no gust, no ribbons, no glitter. */
export const FAR_FLAT_FULL = 300;
/** Pure JS mirror of the shader's `farFlat` term, so tools/diag-water.mjs can print the real
 *  curve. 0 = untouched foreground water, 1 = a flat plate of colour. */
export function farFlatten(dist) {
  const t = Math.max(0, Math.min(1, (dist - FAR_FLAT_NEAR) / (FAR_FLAT_FULL - FAR_FLAT_NEAR)));
  return t * t * (3 - 2 * t); // smoothstep, the same one the GLSL uses
}
/** How tall the ripple normal is allowed to stand at a distance, 1 near and 0 far. */
export function farAmpMultiplier(dist) {
  return 1 - farFlatten(dist);
}

const _openCache = new Map(); // "ci,cj" -> 0..1, world-aligned so neighbours agree exactly
const OPEN_CACHE_MAX = 20000; // ~a very long session's worth of explored coastline; then reset
const _wOpen = new Float32Array(BIOME_COUNT);

/** True if the RAW LAND at (x, z) sits under the local water table. Same ground-truth pattern
 *  as src/audio/ambience.js's own probes: biome weights -> the blended water plane -> raw land
 *  height, no Terrain instance and no road query, because all this needs is "is it wet". */
function isWetAt(x, z, seed) {
  const b = biomeWeights(x, z, seed, _wOpen);
  const plane = waterLevelAt(b.w, -Infinity);
  return plane !== null && landHeight(x, z, seed) < plane;
}

/**
 * Coarse water-body-size estimate at (x, z), 0..1. See the file-level comment above for what
 * it means and how it was calibrated. Cheap after the first call for a given 220 m cell; NOT
 * cheap enough for a per-frame, per-pixel loop — callers bake it at chunk-adopt time (this
 * file) or at candidate-placement time (src/render/ships.js), never in the render loop.
 */
export function waterOpenness(x, z, seed) {
  const ci = Math.round(x / OPEN_CELL);
  const cj = Math.round(z / OPEN_CELL);
  const key = `${ci},${cj}`;
  const hit = _openCache.get(key);
  if (hit !== undefined) return hit;

  const cx = ci * OPEN_CELL;
  const cz = cj * OPEN_CELL;
  let wet = 0;
  for (let i = 0; i < OPEN_DIRS; i++) {
    const a = (i / OPEN_DIRS) * TAU;
    const sx = Math.sin(a);
    const sz = Math.cos(a);
    if (isWetAt(cx + sx * OPEN_R1, cz + sz * OPEN_R1, seed)) wet++;
    if (isWetAt(cx + sx * OPEN_R2, cz + sz * OPEN_R2, seed)) wet++;
  }
  const v = wet / (OPEN_DIRS * 2);
  if (_openCache.size >= OPEN_CACHE_MAX) _openCache.clear(); // cheap to rebuild; never leak
  _openCache.set(key, v);
  return v;
}

const WATER_VS = /* glsl */ `
in vec4 wdat;      // x depth in metres, yz bed-downhill direction, w flow speed
in float wopen;    // 0..1 coarse water-body-size estimate — see waterOpenness() above
out vec3 vW;
out vec4 vD;
out float vDist;
out float vOpen;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vD = wdat;
  vOpen = wopen;
  vDist = length(wp.xyz - uCamPos);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FS = (axis) => /* glsl */ `
in vec3 vW;
in vec4 vD;
in float vDist;
in float vOpen;
out vec4 fragColor;

// The pen read its gusts out of a 256² wind render target that every system in the valley
// shared. Wanderoad has no wind pass yet (uWindTex is unbound), and sampling an unbound
// sampler is a black texture, not a calm day — so the cat's-paw field is analytic here.
// Two octaves at ~130 m per cell, advected slowly across the world: gust cells that are big
// enough to darken a whole bay and slow enough that you watch one arrive.
float gustAt(vec2 p){
  vec2 q = p * 0.0078 - vec2(uTime * 0.052, uTime * 0.019);
  float g = fbm2(q, 3) * 0.5 + 0.5;
  // Ceiling of 1.25 rather than the pen's 1.6: an fbm hits its ceiling far more often than
  // the pen's simulated wind field did, and at 1.6 the surface is permanently at full chop.
  return clamp(smoothstep(0.44, 0.90, g) * 1.25, 0.0, 1.25);
}

// ── band limiting ───────────────────────────────────────────────────────────
// The pen never had to solve this: its water was a 12-to-30 m ribbon that left the screen
// after a few hundred metres. A flooded wetland is a sheet running to the horizon, seen
// almost edge-on, so a pixel two kilometres out covers tens of metres of surface — and every
// noise band finer than that pixel turns into moire chevrons instead of ripples.
//
// fw is the pixel footprint per flow-space axis, straight off the hardware derivatives, and
// f is a band's frequency along each of those axes. Their dot product is how many cycles of
// that band fit inside one pixel; past about a half the band carries no information, so it
// is faded out rather than point-sampled. Same idea as a mip chain, done analytically
// because these bands are functions rather than textures.
//
// It has to be the dot product and not max(fw)*max(f). Both the footprint and the ripple
// bands are strongly anisotropic, and at grazing incidence they are anisotropic in the SAME
// direction: the pixel is long down the view, the ripples are long down the flow. Collapsing
// either to a single number is the isotropic-mip mistake, and it blurs the whole surface to
// a flat sheet the moment the camera drops towards eye level — which, in a driving game, is
// where the camera lives.
// 0.20/0.52, tightened from 0.28/0.72. Nyquist is at HALF a cycle per pixel, and the old
// window did not finish until 0.72 — i.e. a band was still being point-sampled well past the
// point where it provably carried nothing but aliasing. Every band now goes out by 0.52, and
// the fade begins comfortably before the limit rather than at it. Foreground water does not
// change: at short range dot(fw, f) is a small fraction of either threshold.
float bandLimit(vec2 fw, vec2 f){ return 1.0 - smoothstep(0.20, 0.52, dot(fw, abs(f))); }

// Anisotropic chop: four bands, all far longer down the ripple axis than across it, which is
// the single thing that makes water look like it is going somewhere. The pen's frequencies
// and weights, each gated at its own Nyquist limit, and each advected by the local current as
// a domain offset in metres rather than as a term buried inside the frequency scaling.
float ripple(vec2 q, vec2 drift, float t, float gust, vec2 fw){
  vec2 d1 = q - drift*1.122;   // 0.055/0.049 — the pen's own downstream rate, in metres
  vec2 d2 = q - drift*0.950;   // 0.115/0.121
  vec2 d3 = q - drift*0.810;   // 0.255/0.315
  // The capillary chop is wind-driven, not current-driven, so it keeps the pen's fixed
  // advection instead of following the bed.
  vec2 d4 = q - vec2(t*2.087, -t*0.667);
  float n1 = pn2(vec2(d1.x*0.049, d1.y*0.40))        * bandLimit(fw, vec2(0.049, 0.40));
  float n2 = pn2(vec2(d2.x*0.121, d2.y*0.92) + 7.0)  * bandLimit(fw, vec2(0.121, 0.92));
  float n3 = pn2(vec2(d3.x*0.315, d3.y*2.30) + 19.0) * bandLimit(fw, vec2(0.315, 2.30));
  float n4 = pn2(vec2(d4.x*1.15, d4.y*1.05) + 31.0)  * bandLimit(fw, vec2(1.15, 1.05)) * gust;
  return n1*0.52 + n2*0.30 + n3*0.17 + n4*0.30;
}

// ── the ripple frame ────────────────────────────────────────────────────────
// A rigid, world-anchored rotation of world space, gently domain-warped, seeded per world.
//
// It CANNOT be the pen's per-fragment flow frame (q = dot(P.xz, flow)). Out here a world
// position is thousands of metres long, so a two-degree wobble in an interpolated flow
// direction moves the noise domain by a hundred metres — and the downhill field of any lake
// converges on a line down its middle, where that direction sweeps through 180 degrees inside
// a single quad. The result is a fan of zebra stripes radiating from every deep channel, at a
// frequency no amount of band limiting can reach, because in the domain the stripes really
// are there.
//
// So the frame is global and linear in position: continuous everywhere, no chunk seams, and
// stable no matter how far from the origin the player has driven. The local current still
// does the work you can see — it enters as the advection velocity below, where it multiplies
// TIME instead of position and therefore cannot blow up.
const vec2 RIP_AXIS = vec2(${axis.x.toFixed(6)}, ${axis.z.toFixed(6)});
vec2 rippleFrame(vec2 p){
  // A ~270 m domain warp so the streaks meander instead of ruling the whole world in parallel
  // lines. Amplitude times frequency stays well under one, so the map keeps a bounded
  // derivative and the frame stays as well-behaved as the plain rotation underneath it.
  // 22 m of warp, down from 46: at 46 the finer ripple bands were bent into closed
  // fingerprint whorls — the surface read as marbled paper. At 22 the streaks still
  // meander (the wavelength is unchanged) but stay open lines, the way wind-streaks lie
  // on real water and in the pen's river.
  vec2 w = vec2(pn2(p*0.0037 + 11.3), pn2(p*0.0037 + 41.7)) * 22.0;
  vec2 s = p + w;
  return vec2(dot(s, RIP_AXIS), dot(s, vec2(-RIP_AXIS.y, RIP_AXIS.x)));
}

void main(){
  // Dry bed. The terrain already occludes the plane wherever the ground rises through it, so
  // this only matters at LOD cracks and along the shoreline, where a metre of tolerance stops
  // the plane's own 2 m-sampled waterline from cutting inside the mesh's 1 m-sampled one.
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float sp = vD.w;

  vec2 q = rippleFrame(P.xz);
  vec2 fw = max(fwidth(q), vec2(1e-4));

  // The local current, expressed in the ripple frame. Interpolation is safe here: where two
  // vertices flow at each other the vector simply shortens towards zero, which is slack water
  // and reads as slack water, instead of spinning through every heading inside one quad.
  vec2 fl = vD.yz;
  fl *= min(1.0, inversesqrt(max(dot(fl, fl), 1e-8)));
  vec2 adv = vec2(dot(fl, RIP_AXIS), dot(fl, vec2(-RIP_AXIS.y, RIP_AXIS.x)));
  vec2 drift = adv * (uTime * sp);

  // Large, open water reads calm rather than choppy — see waterOpenness() and the OPEN_*
  // constants at the top of this file for what vOpen means and how the two constants below
  // were read off the real seeded world. This only ever scales an amplitude that already goes
  // through the anti-aliasing/band-limiting above and below it; nothing about HOW the ripple or
  // the gust field is built changes, only how tall they are allowed to stand on water this open.
  float calm = smoothstep(${OPEN_LO.toFixed(3)}, ${OPEN_HI.toFixed(3)}, vOpen);

  /* Far-field flattening — the moire fix. See FAR_FLAT_NEAR/FAR_FLAT_FULL and the long note
   * above them in this file for why band limiting alone could not reach this: an anisotropic
   * gate keeps a band alive whose cross-axis frequency is resolvable, and that band is then
   * point-sampled once inside a pixel tens of metres long DOWN the view. Everything below
   * that carries a per-pixel signal is multiplied out by this one term, so past
   * FAR_FLAT_FULL metres there is nothing left that could alias. The name is farFlat and not
   * a short generic one on purpose: short generic identifiers in a shader are how this
   * project once shipped a black screen off a GLSL reserved word, and it is not worth
   * finding out again. */
  float farFlat = smoothstep(${FAR_FLAT_NEAR.toFixed(1)}, ${FAR_FLAT_FULL.toFixed(1)}, vDist);
  float nearW = 1.0 - farFlat;

  // Gust cells are ~32 m across at their finest, so they too stop carrying information once
  // the pixel is wider than that — and their surface darkening is the most visible aliasing
  // of the lot, because it is a contrast term rather than a colour one. The fbm's own
  // diagonal grain reading as stripes on a distant bay is the "coarse diagonal streak
  // banding" half of the report, so it takes the far-field term as well as its band gate.
  float gust = gustAt(P.xz) * bandLimit(fw, vec2(0.031)) * mix(1.0, ${OPEN_CALM_GUST.toFixed(3)}, calm) * nearW;

  // The finite differences that build the normal are sampled at the pixel footprint of their
  // OWN axis rather than at the pen's fixed 0.42 m, so each degrades into a box filter of
  // exactly the right width instead of into noise — and a grazing pixel does not drag the
  // across-axis difference out with it.
  vec2 e = max(fw, vec2(0.42));
  float h0 = ripple(q, drift, uTime, gust, fw);
  float hx = ripple(q + vec2(e.x, 0.0), drift, uTime, gust, fw);
  float hy = ripple(q + vec2(0.0, e.y), drift, uTime, gust, fw);
  // Gust coupling at 0.62+0.55 rather than the old 0.55+0.9: a gust used to nearly
  // treble the ripple amplitude, and a treble-height ripple field under a grazing
  // reflection is where the "marbled oil slick" read came from (see the normal-scale
  // note below) — patchy islands of maximum chop inside calm water.
  float amp = mix(0.055, 0.20, clamp(sp*0.22, 0.0, 1.0)) * (0.62 + 0.55*gust);
  // Shallow water is choppier: the bed shortens the wave.
  amp *= mix(1.35, 1.0, smoothstep(0.3, 2.6, depth));
  // Flat and calm on a genuinely large body — the operator's report, "large bodies of water
  // should be flat". Current and depth above are left untouched: a big body can still show a
  // current where its bed actually falls, and shallow water beside a deep lake still shortens
  // its own wave — this only pulls down the ceiling those terms are allowed to reach.
  amp *= mix(1.0, ${OPEN_CALM_AMP.toFixed(3)}, calm);
  /* ...and flat, full stop, past FAR_FLAT_FULL metres. This is the load-bearing line of the
   * moire fix: with the amplitude at zero the three finite differences below are equal, dh
   * is exactly zero, and the normal is exactly up — so there is no high-frequency signal in
   * the reflection for a fifteen-metre-long pixel to undersample. The distance mix on N a few
   * lines down is kept as well, because it still shapes the 70-300 m band this does not
   * finish covering, and belt-and-braces on the one term that produced the reported artefact
   * is cheap. */
  amp *= nearW;
  /* Normal scale 8.5, down from 14. The old value was tuned on the pen's narrow river,
   * always seen at a steep angle; on a lake seen at grazing incidence a hard-tilted normal
   * swings the reflected ray across the WHOLE sky dome, and the surface renders as
   * high-contrast marbled contour lines (white horizon band against blue zenith) instead of
   * as water. The operator's report — "the water is ugly" — was this, before anything else:
   * every screenshot at 100-600 m showed the marbling. The band-limiting above is untouched;
   * this is amplitude, not anti-aliasing. */
  vec2 dh = (vec2(hx, hy) - h0)/e * amp * 8.5;
  /* Soft-limit the tilt. The finite-difference slope scales with band FREQUENCY, so the
   * capillary bands tilt the normal several times harder than the long swells — hard
   * enough to swing the reflected ray from horizon to zenith between neighbouring pixels,
   * which is glitter on a real sea but marbling on a painted one. The rational soft clamp
   * leaves small slopes untouched (denominator ~1) and compresses the extremes toward an
   * asymptote of ~24 deg, so ripples keep their character and lose their violence. */
  dh /= 1.0 + 2.2*length(dh);
  // Back out of the ripple frame into world xz. The warp is ignored in this rotation: it is a
  // few degrees of shear, and the normal only has to look right, not integrate.
  vec2 axC = vec2(-RIP_AXIS.y, RIP_AXIS.x);
  vec3 N = normalize(vec3(-(dh.x*RIP_AXIS.x + dh.y*axC.x), 1.0, -(dh.x*RIP_AXIS.y + dh.y*axC.y)));
  // Flatten with distance so a lake two kilometres away is a plate of colour and not a
  // boiling field of highlights. Starts at 70 m and lands at 92% (was 110-560 m, 82%):
  // the marbling described above lived precisely in the 110-560 m window the old ramp
  // left at full strength, and a painting keeps its detailed brushwork for the FOREGROUND.
  // max(..., farFlat): the old ramp landed at 92% and left 8% of a ripple normal alive at
  // ANY distance, which on a sheet running to the horizon is 8% of a churn that has nothing
  // left to be a churn of. Whichever term is stronger at this distance wins, so the 70-430 m
  // shaping is untouched and the tail now actually reaches flat.
  N = normalize(mix(N, vec3(0.0,1.0,0.0), max(smoothstep(70.0, 430.0, vDist)*0.92, farFlat)));

  float ndl = dot(N, uSunDir);
  float sh = sunShadow(P, ndl) * cloudShadow(P);

  // ── depth-graded body colour, in bands ─────────────────────────────────────
  // Painted water is not a smooth gradient; it is a few flat plates of colour whose
  // boundaries you can point at. The pen keyed those plates off distance-across-the-channel;
  // here they key off real depth, so a shelving bay draws its own contour lines.
  float bedDepth = smoothstep(0.12, 4.4, depth);
  float plateJ = pn2(vec2(q.x*0.045, q.y*0.42) + 3.0)*0.070*bandLimit(fw, vec2(0.045, 0.42));
  float b1 = smoothstep(0.16 + plateJ, 0.30 + plateJ, bedDepth);
  float b2 = smoothstep(0.50 + plateJ, 0.68 + plateJ, bedDepth);
  vec3 body = mix(K_W_SHALLOW, K_W_MID, b1);
  body = mix(body, K_W_DEEP, b2);
  // the gravel bed showing through the shallows (cool wet stone, not sand)
  float bedN = pn2(P.xz*0.55)*0.5 + 0.5;
  vec3 wetBed = mix(${C.wetStone}, K_W_SHALLOW, 0.45) * mix(0.80, 1.06, mix(0.5, bedN, bandLimit(fw, vec2(0.55))));
  body = mix(wetBed, body, smoothstep(0.02, 0.22, bedDepth));
  // caustic light rocking over the shallow bed
  vec2 dc = q - drift*0.471;   // 0.8/1.7
  float caus = pn2(vec2(dc.x*1.7, dc.y*2.9 + uTime*0.5));
  caus = pow(clamp(caus*0.5 + 0.5, 0.0, 1.0), 3.0);
  // Caustics are a CLOSE-UP delight: past ~200 m the anisotropic footprint can keep the
  // band's view-aligned axis alive while the cross axis collapses, and what survived read
  // as white curls smeared over the shelf. The explicit distance fade ends the argument.
  body += ${C.wSpark}*caus*0.15*(1.0 - smoothstep(0.05, 0.40, bedDepth))*sh*bandLimit(fw, vec2(1.7, 2.9))
          * smoothstep(240.0, 110.0, vDist);

  // ── reflection ─────────────────────────────────────────────────────────────
  // Sky only. The pen also had a planar mirror pass for its one valley; a streaming world
  // would need one render target per water body per frame, and stylised water keeps its own
  // colour at grazing angles anyway — which is why the Fresnel term is clamped so low.
  /* The reflection COLOUR reads through a mostly-calmed normal, while the sun glitter
   * below keeps the full ripple normal. This is the painted-water decoupling: in a
   * painting the sheet of water is one smooth wash of sky colour with the ripples drawn
   * ON it as sparse strokes and sparkles — the wash never churns. Resampling the sky
   * dome through the full ripple field is what a simulation does, and at grazing
   * incidence it swings the reflected ray across the whole dome and renders marbled
   * contour lines instead of water (the operator's "the water is ugly", verbatim). */
  vec3 Nr = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.65));
  vec3 R = reflect(-V, N);      // full ripple normal — the glints live on this
  vec3 Rr = reflect(-V, Nr);    // calmed normal — the colour wash lives on this
  /* The reflected ray's elevation is floored at 0.11, not 0.012. At grazing incidence —
   * which is ALL distant water in a driving camera — a floor of 0.012 samples the sky's
   * pale horizon band, and the whole far lake came back as a sheet of grey-white. 0.11
   * samples the blue mid-sky instead: distant water is a plate of luminous blue. */
  vec3 refl = skyDomeLite(normalize(vec3(Rr.x, max(Rr.y, 0.11), Rr.z)));
  float fres = 0.045 + 0.60*pow(1.0 - clamp(dot(Nr,V), 0.0, 1.0), 4.0);
  // Cap 0.36 (was 0.46): stylised water keeps its own colour at grazing angles — the
  // body plates stay legible out to the haze instead of surrendering to the mirror.
  fres = clamp(fres, 0.0, 0.36);

  vec3 col = mix(body, refl, fres*0.86);
  col = mix(col*0.74 + K_SHADOW*0.10, col, sh*0.82 + 0.18);

  // ── flow ribbons ───────────────────────────────────────────────────────────
  // Long creases travelling downstream: they show which way the water is going with no motion
  // at all, which is what carries the read on a distant reach only twelve pixels wide.
  {
    vec2 e1 = q - drift*1.333;   // 0.10/0.075
    vec2 e2 = q - drift*1.097;   // 0.17/0.155
    float r1 = pn2(vec2(e1.x*0.075, e1.y*0.55) + 5.0);
    float r2 = pn2(vec2(e2.x*0.155, e2.y*1.05) + 41.0);
    float rib = smoothstep(0.28, 0.62, abs(r1)*0.75 + abs(r2)*0.45);
    float bright = smoothstep(0.0, 0.5, r1 + r2);
    // 0.10, down from 0.16 — near-white strokes over the pale shallow plate were carrying
    // half the marbled read on shelving shores. The creases still say "downstream".
    // ...and gone entirely in the far field: a crease is a stroke, and a stroke narrower than
    // the pixel drawing it is the crosshatch the report photographed at 2.4x zoom.
    col = mix(col, mix(${C.wDeepShade}, ${C.wSpark}, bright),
              rib*0.10*(0.4 + 0.6*sh)*bandLimit(fw, vec2(0.155, 1.05))*nearW);
  }

  // ── foam drawings (Wind Waker scribble lines) ──────────────────────────────
  // Hand-drawn white lines slowly crawling over open, deep water — laid ON TOP of the body,
  // reflection and flow ribbons resolved above, never replacing them. Reuses the ripple
  // frame q rather than a fresh domain so the drawings sit still relative to the water they
  // ride on instead of sliding independently across it.
  {
    vec2 fq = q * 0.055; // ~18 m features: a hand-scribble scale, coarser than the ripple bands
    vec2 warp = vec2(pn2(fq*0.35 + 3.7), pn2(fq*0.35 + 9.2)) * 1.8;
    // Slow drift along the local current, plus a small fixed crawl of its own — the pen's
    // lines visibly creep even where the water beneath them barely flows at all.
    vec2 fp = fq + warp - adv*(uTime*0.010) - vec2(uTime*0.008, uTime*0.003);

    // A scribble is a set of thin lines, not a filled shape, so it is drawn at pn2's
    // zero-crossings rather than at its peaks: two bands, the second finer and offset so the
    // pair reads as loose hand-drawn strokes rather than one repeating contour.
    float l1 = pn2(fp);
    float l2 = pn2(fp*1.9 + 17.0);
    float line1 = 1.0 - smoothstep(0.045, 0.13, abs(l1));
    float line2 = 1.0 - smoothstep(0.040, 0.11, abs(l2));
    float scrib = clamp(line1 + line2*0.6, 0.0, 1.0);

    // Open sea only, deep water only, and the same band-limit every other ripple term uses so
    // a stroke narrower than the pixel drawing it fades rather than aliases at distance.
    float gate = calm * bandLimit(fw, vec2(0.055*2.0)) * smoothstep(0.9, 2.2, depth);
    // Sun-facing views wash to cream (playtest report): this gate and the sun-glitter term
    // below it both brighten hardest looking straight down the same sun-facing line of sight,
    // and stacked the two read as a bleached patch rather than two separate effects. Same dot
    // product the glitter block computes for its own glitterPath (recomputed here, LOCALLY,
    // since this block runs before that one in the shader) — attenuate the foam gate along it
    // rather than let both terms keep brightening the same pixels unchecked.
    float foamSunPath = smoothstep(0.55, 1.0, dot(normalize(vec2(V.x,V.z)), -normalize(uSunDir.xz)));
    gate *= (1.0 - 0.45*foamSunPath);
    float wOpac = 0.42; // overall ceiling — the body plates underneath stay legible

    // The Wind Waker double line: a darker under-copy of l1, offset a couple of centimetres
    // in the scribble domain so it never coincides with the white stroke, drawn UNDER it at
    // ~0.35 of the white's weight — the "ink shadow" that gives the drawing its hand-drawn feel.
    float lShadow = pn2(fp + vec2(0.06));
    float lineShadow = 1.0 - smoothstep(0.045, 0.13, abs(lShadow));
    col = mix(col, mix(${C.wDeepShade}, K_SHADOW, 0.35), lineShadow*gate*wOpac*0.35);

    col = mix(col, ${C.wFoam}, scrib*gate*wOpac);
  }

  // ── quantised sun glitter ──────────────────────────────────────────────────
  // Hard-stepped into discrete winking glints rather than left as a specular lobe: a
  // specular lobe on stylised water reads as plastic.
  float f = dot(normalize(R), uSunDir);
  float broad = pow(max(f, 0.0), 22.0);
  vec2 dg = q - drift*0.579 - vec2(0.0, uTime*0.097);   // 1.1/1.9 and 0.35/3.6
  float glintN = pn2(dg*vec2(1.9, 3.6))*0.5 + 0.5;
  float twinkle = step(0.42, glintN) * (0.55 + 0.75*pn2((q - vec2(uTime*0.286))*7.0));
  // A winking glint is a sub-pixel event by construction, so once a pixel is wider than the
  // glint field it hands its energy to the broad lobe rather than strobing.
  /* nearW as well as the band gate, and this one is not belt-and-braces. Once the normal
   * above is flat, f is very nearly CONSTANT across a whole distant reach — so a threshold
   * as tight as 0.9975 stops being a field of winking points and becomes an all-or-nothing
   * sheet with a hard edge, which is a worse artefact than the one being removed. Far water
   * keeps the broad lobe below (smooth, and correct on a flat surface) and drops the
   * quantised glints entirely. */
  float glint = smoothstep(0.9975, 0.99925, f) * twinkle * bandLimit(fw, vec2(1.9, 3.6)) * nearW;
  float glitterPath = smoothstep(0.55, 1.0, dot(normalize(vec2(V.x,V.z)), -normalize(uSunDir.xz)));
  col += ${C.wSpark} * (glint*2.6 + broad*0.42) * sh * (0.35 + 0.75*glitterPath);

  // ── shore foam ─────────────────────────────────────────────────────────────
  // Keyed off the measured depth, so the foam band is a genuine contour of the bed and
  // widens by itself wherever the shore shelves gently. Reaches 0.55 m of depth, not the
  // old 1.25: on a gently shelving shore 1.25 m of depth is tens of metres of horizontal
  // run, and the "foam" was a chalk apron around every lake. A painted foam line is a
  // LINE — a scalloped ribbon at the waterline, not a coat.
  float edge = 1.0 - smoothstep(0.0, 0.40, depth);
  vec2 ds = q - drift*0.824;   // 0.7/0.85
  float scEdge = bandLimit(fw, vec2(0.85, 2.2));
  float scallop = mix(0.5, pn2(vec2(ds.x*0.85, ds.y*2.2))*0.5 + 0.5, scEdge);
  float foam = clamp(smoothstep(0.42, 0.96, edge*(0.50 + 0.95*scallop)), 0.0, 1.0);
  // Once the scallop noise is band-limited away the foam has no breakup left and turns
  // into a solid chalk apron across every distant flat shelf — so it dims with the same
  // gate that removed its texture, down to a pale suggestion rather than a coat.
  foam *= mix(0.35, 1.0, scEdge);
  // Foam belongs to the water: fade it out across the dry side of the waterline (raw
  // vD.x < 0 is the seam-tolerance band drawn over ground the terrain calls dry), so the
  // brightest paint in this shader never sits on the beach.
  foam *= smoothstep(-0.14, 0.02, vD.x);
  col = mix(col, ${C.wFoam}*mix(0.80, 1.10, scallop), foam*0.36);

  /* ── the waterline itself ──────────────────────────────────────────────────
   * The discard above keeps its full 0.5 m tolerance (the seam-prevention property —
   * see the comment at the discard). What changes is what the tolerance band LOOKS
   * like. It used to render as pale wet-stone with foam on top: a light grey ring
   * around every shore, whose aliased discard contour showed against the grass as a
   * jagged chalk line. Instead the band now fades to a dark wet-earth tone, deepest
   * at the outer (discard) edge — so the aliased contour is a dark-against-green edge
   * at one third the contrast, reading as the wet margin every painted lake has, and
   * the scallop noise breaks its line the way a brush would. */
  float rim = smoothstep(0.22, -0.30, vD.x) * mix(0.72, 1.0, scallop);
  col = mix(col, ${C.wetStone} * vec3(0.52, 0.55, 0.52), rim*0.85);

  // cat's paws darken the surface where a gust touches down — one shade calmer than
  // before (0.90 vs 0.86): at distance the fbm's diagonal grain was reading as stripes.
  col *= mix(1.0, 0.90, smoothstep(0.75, 1.6, gust));

  col += K_SUN * pow(clamp(dot(V,-uSunDir), 0.0, 1.0), 5.0) * 0.16 * sh;
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

/**
 * One material for every body of water in the world. The ripple axis is baked in as a GLSL
 * constant rather than passed as a uniform: it never changes for a given world, and a
 * constant lets the compiler fold the whole frame rotation.
 */
function createWaterMaterial(seed) {
  const a = (hash2i(0x2ca9, 0x11de, seed) / 4294967296) * TAU;
  const axis = { x: Math.cos(a), z: Math.sin(a) };
  const cloud = glCloudField({ cshSpan: CLOUD_SPAN, cloudDeck: CLOUD_DECK });
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(),
    vertexShader: vertHead(WATER_VS),
    fragmentShader: fragHead(GL_HASH, GL_NOISE, GL_SKY, cloud, GL_SHADOW, GL_LIGHT, WATER_FS(axis)),
    // Opaque: alpha carries the fog amount for the post chain, exactly as the terrain does.
    transparent: false,
    // A camera that dips below the surface must still see it, and a flat grid costs nothing
    // to draw twice-sided.
    side: DoubleSide,
  });
}

/* Index buffers depend only on the grid resolution, of which there are two in the whole
 * world. Cached as raw typed arrays rather than as BufferAttributes: sharing one attribute
 * across geometries means the first geometry.dispose() frees the GL buffer out from under
 * every other plane still using it. */
const _indexCache = new Map();
function planeIndex(n) {
  let idx = _indexCache.get(n);
  if (idx) return idx;
  idx = new Uint16Array((n - 1) * (n - 1) * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[t++] = a;
      idx[t++] = c;
      idx[t++] = b;
      idx[t++] = b;
      idx[t++] = c;
      idx[t++] = d;
    }
  }
  _indexCache.set(n, idx);
  return idx;
}

const _key = (rec) => `${rec.level}:${rec.cx},${rec.cz}`;

export class Water {
  /**
   * @param {object} opts
   * @param {number} opts.seed  world seed; only used for the still-water flow direction
   * @param {THREE.Object3D} opts.scene
   */
  constructor({ seed, scene }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.material = createWaterMaterial(this.seed);

    this.group = new Object3D();
    this.group.name = 'water';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    /** key -> Mesh */
    this.planes = new Map();
    this.stats = { live: 0, visible: 0 };
    this._cullT = 0;
    this._cam = new Vector3();
  }

  /**
   * Called from `Streamer.onChunk` for every chunk whose `rec.water` is non-null.
   * A chunk without water, or one too coarse for its averaged level to mean anything, is
   * silently ignored — so the caller can hand us every chunk it adopts.
   */
  add(rec) {
    if (!rec || !rec.water) return;
    if (rec.level > MAX_WATER_LEVEL) return;
    const key = _key(rec);
    if (this.planes.has(key)) return;

    const geom = this._buildPlane(rec);
    if (!geom) return;

    const mesh = new Mesh(geom, this.material);
    mesh.position.set(rec.ox, rec.water.level, rec.oz);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.frustumCulled = true;
    // After the ground. Every water fragment is depth-tested against terrain that is already
    // in the buffer, so the shoreline costs one z-test instead of one shader invocation.
    mesh.renderOrder = 1;
    mesh.userData.level = rec.level;

    this.group.add(mesh);
    this.planes.set(key, mesh);
    this.stats.live = this.planes.size;
  }

  /** Drop the plane belonging to a chunk the streamer has retired. */
  remove(rec) {
    if (!rec) return;
    const key = _key(rec);
    const mesh = this.planes.get(key);
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    this.planes.delete(key);
    this.stats.live = this.planes.size;
  }

  /**
   * Everything the surface does is driven by the shared `uTime`, so this exists to keep the
   * fill rate honest: a plane past the fog wall contributes nothing but overdraw, and there
   * is no point re-deciding that sixty times a second.
   */
  update(dt, camPos) {
    if (camPos) this._cam.set(camPos.x, camPos.y, camPos.z);
    this._cullT -= dt;
    if (this._cullT > 0) return;
    this._cullT = CULL_INTERVAL;

    // uFogFar is driven per-biome by the camera, so read it rather than hard-coding a range.
    const far = U.uFogFar.value * 1.25;
    const far2 = far * far;
    let visible = 0;
    for (const mesh of this.planes.values()) {
      const bs = mesh.geometry.boundingSphere;
      const dx = mesh.position.x + bs.center.x - this._cam.x;
      const dz = mesh.position.z + bs.center.z - this._cam.z;
      const reach = far + bs.radius;
      const on = dx * dx + dz * dz < reach * reach;
      mesh.visible = on;
      if (on) visible++;
    }
    this.stats.visible = visible;
  }

  dispose() {
    for (const mesh of this.planes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.planes.clear();
    this.scene.remove(this.group);
    this.material.dispose();
    this.stats.live = 0;
    this.stats.visible = 0;
  }

  /* ── geometry ───────────────────────────────────────────────────────────── */

  /**
   * A flat grid at the chunk's water level, carrying depth / flow / speed per vertex.
   *
   * Bed heights come from `rec.heights` at level 0 and from the chunk mesh's own position
   * attribute otherwise — the mesher writes the terrain height into `position.y`, so the
   * exact bed is already sitting in GPU-bound memory for every level and there is nothing to
   * approximate. The grid is halved against the terrain grid (65 -> 33, 33 -> 17): the
   * quantities it carries are all smooth, and a quarter of the vertices draws the same
   * shoreline.
   */
  _buildPlane(rec) {
    const G = rec.grid | 0;
    if (G < 3) return null;
    const bed = this._bedReader(rec, G);
    if (!bed) return null;

    const n = (G + 1) >> 1; // 65 -> 33, 33 -> 17; stride 2 either way
    const stride = (G - 1) / (n - 1);
    const level = rec.water.level;
    const cell = rec.size / (n - 1);
    // Widened stencil for the gradient: a one-sample difference on a 1 m grid picks up the
    // bank shingle rather than the fall of the valley, and the flow direction then jitters
    // from vertex to vertex.
    const stencil = stride * 2;

    // Deterministic fallback heading for water with no measurable fall — a wetland flood is
    // flat, but its ripples still have to run somewhere, and every player must see them run
    // the same way.
    const a = (hash2i(rec.cx, rec.cz, this.seed ^ 0x7a7e) / 4294967296) * TAU;
    const flatX = Math.cos(a);
    const flatZ = Math.sin(a);

    const pos = new Float32Array(n * n * 3);
    const dat = new Float32Array(n * n * 4);
    const open = new Float32Array(n * n);

    for (let j = 0; j < n; j++) {
      const gj = j * stride;
      for (let i = 0; i < n; i++) {
        const gi = i * stride;
        const k = j * n + i;

        pos[k * 3] = i * cell;
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = j * cell;
        // World position, not the local one just written above — waterOpenness()'s cache is
        // keyed on world-space cells specifically so neighbouring chunks agree; a chunk-local
        // coordinate would put every chunk's own (0,0) in the same cell regardless of where in
        // the world it actually is.
        open[k] = waterOpenness(rec.ox + i * cell, rec.oz + j * cell, this.seed);

        const im = gi - stencil < 0 ? 0 : gi - stencil;
        const ip = gi + stencil > G - 1 ? G - 1 : gi + stencil;
        const jm = gj - stencil < 0 ? 0 : gj - stencil;
        const jp = gj + stencil > G - 1 ? G - 1 : gj + stencil;
        // The stencil clamps at the chunk border, so the divisor is the baseline actually
        // measured — otherwise an edge vertex reports double the true fall.
        const dhx = ((bed(ip, gj) - bed(im, gj)) / ((ip - im) * rec.step)) || 0;
        const dhz = ((bed(gi, jp) - bed(gi, jm)) / ((jp - jm) * rec.step)) || 0;

        let fx = -dhx;
        let fz = -dhz;
        const m = Math.sqrt(fx * fx + fz * fz);
        if (m > 1e-3) {
          fx /= m;
          fz /= m;
        } else {
          fx = flatX;
          fz = flatZ;
        }

        const dep = level - bed(gi, gj);
        dat[k * 4] = dep;
        dat[k * 4 + 1] = fx;
        dat[k * 4 + 2] = fz;
        // Bed gradient -> current, damped by depth.
        //
        // The gradient alone is not enough, and getting that wrong is very visible: the sides
        // of a thirty-metre lake basin are as steep as any mountain stream, so a
        // gradient-only model paints a still tarn as whitewater rapids. Depth is what
        // separates the two — a shallow film running down a slope is fast, a deep body over
        // the same slope is a lake and barely moves. A 1:8 fall saturates the gradient term;
        // past that the advection is already as fast as the stylisation can carry.
        const still = 1 - 0.72 * clamp01((dep - 1.2) / 7);
        dat[k * 4 + 3] = (0.35 + 2.0 * clamp01(m * 8)) * still;
      }
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('wdat', new BufferAttribute(dat, 4));
    g.setAttribute('wopen', new BufferAttribute(open, 1));
    g.setIndex(new BufferAttribute(planeIndex(n), 1));
    // By hand: the plane is flat and chunk-sized, so walking every vertex to discover that
    // would be pure waste.
    g.boundingSphere = new Sphere(
      new Vector3(rec.size * 0.5, 0, rec.size * 0.5),
      rec.size * 0.7072
    );
    return g;
  }

  /**
   * `(i, j) -> bed height`, over the chunk's own terrain grid. Prefers the CPU height copy
   * the mesher keeps for level 0; otherwise reads the mesh's position attribute, whose first
   * G*G vertices are the grid in the same row-major order (the skirt vertices follow, and
   * are never indexed here).
   */
  _bedReader(rec, G) {
    const h = rec.heights;
    if (h && h.length >= G * G) return (i, j) => h[j * G + i];
    const attr = rec.mesh && rec.mesh.geometry && rec.mesh.geometry.getAttribute('position');
    if (!attr || attr.count < G * G) return null;
    const arr = attr.array;
    return (i, j) => arr[(j * G + i) * 3 + 1];
  }
}
