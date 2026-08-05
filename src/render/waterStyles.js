// created by AI
/* Wanderoad — seven waters, one button each.
 *
 * Operator, verbatim: "make seven different water types that I can stick in-game by just
 * clicking a button on the menu." And twice before that, looking at the sea: "the water
 * textures have not improved", pointing at https://github.com/PauliusOS/pallet-town-3d as a
 * look he likes.
 *
 * LICENCE NOTE ON THAT REFERENCE. pallet-town-3d is MIT (checked against the GitHub API on
 * 2026-08-03: `license.spdx_id = "MIT"`), so it would have been compatible — but no code was
 * taken from it and none is needed. What was taken is an OBSERVATION about the look, which no
 * licence covers: its water reads as water because it is a small number of FLAT, SATURATED
 * plates with hard edges and a drawn shoreline, not because it simulates anything. That is
 * the `cel` style below, written from scratch against this project's own depth attribute.
 *
 * ── WHY SEVEN SHADERS AND NOT ONE SHADER WITH SEVEN BRANCHES ──────────────────
 * The obvious build is an ubershader with a `uWaterStyle` uniform. It was rejected on the
 * frame budget, which is the one thing this file is not allowed to spend: the game streams a
 * 7 km view distance and water is a full-screen sheet at the top of the frame whenever the
 * camera looks out over a bay. A uniform branch is coherent and costs nothing to EXECUTE, but
 * the compiler still allocates registers for the worst path in the file, and the worst path
 * here (the shipped painted surface, twelve pn2 evaluations for the ripple normal alone) is
 * about six times the cheapest (`cel`, which has three). Making everyone pay the painted
 * surface's occupancy so that a menu button can be a uniform write is a bad trade.
 *
 * So each style is its own complete fragment shader, and switching styles swaps the shader
 * source on the ONE shared material and sets `needsUpdate`. three keys its program cache on
 * the shader source for a RawShaderMaterial (WebGLShaderCache.getFragmentShaderID), so the
 * next draw links a fresh program — one compile hitch on the click, then nothing. No page
 * reload, which is what "just clicking a button" has to mean, and nothing per frame.
 *
 * ── WHAT EVERY STYLE MUST STILL DO ────────────────────────────────────────────
 * These are not stylistic. Each one is a scar:
 *
 *   discard on `!(vD.x > -0.5)`  the dry-bed test. The plane is drawn with half a metre of
 *                                tolerance past the waterline so the water's 2 m-sampled
 *                                shore does not cut inside the terrain's 1 m-sampled one;
 *                                without the discard that tolerance band is water painted on
 *                                dry grass.
 *   aerial() then SAFE3/gFogAmt  alpha is the post chain's distance channel, not opacity. A
 *                                style that forgets it comes back sharp out of the watercolour
 *                                pass, and one NaN fragment renders as a solid dark square.
 *   a far-field gate             every high-frequency term fades out between FAR_FLAT_NEAR and
 *                                FAR_FLAT_FULL. The playtest report that produced those two
 *                                constants — "coarse diagonal streak banding", "a fine
 *                                crosshatch shimmer band ... in motion it will crawl" — was
 *                                undersampling along a grazing view, and no amount of band
 *                                limiting reaches it. See the long note in water.js.
 *   bandGate() on noise          the analytic mip gate. Same 0.20/0.52 window water.js uses.
 *
 * ── COLOURS LIVE WITH THEIR STYLE, NOT IN palette.js ──────────────────────────
 * A deliberate exception to "every colour in the game, in one place". These seven are a
 * BAKE-OFF: the operator picks a winner and the losers are deleted. Threading thirty
 * throwaway keys through the master palette would leave six styles' worth of dead colour in
 * the file that every shader in the game reads, and — worse — sharing stops between them
 * would pull them toward each other, when the entire point is that they must not look alike.
 * When a winner is chosen, its stops move into palette.js and this note goes with them.
 */

import { Color } from 'three';
import { vertHead } from '../core/glsl.js';
import { C } from '../core/palette.js';
import {
  defaultWaterShaders,
  waterFragShader,
  waterVertexShader,
  waterRippleAxis,
  liveWaterMaterials,
  onWaterMaterial,
  FAR_FLAT_NEAR,
  FAR_FLAT_FULL,
  OPEN_LO,
  OPEN_HI,
} from './water.js';

/** sRGB hex -> a linear GLSL vec3 literal. The same two lines palette.js's `v3` is. */
const glslColour = (hex) => {
  const c = new Color(hex).convertSRGBToLinear();
  return `vec3(${c.r.toFixed(5)},${c.g.toFixed(5)},${c.b.toFixed(5)})`;
};

/* ── the shared prelude ────────────────────────────────────────────────────────
 * Concatenated in front of the six NEW fragment bodies (never in front of the shipped one,
 * which brings its own copies of these and must stay byte-for-byte what it always was).
 *
 * The varyings are exactly what water.js's vertex shader emits, so five of the six styles
 * need no vertex shader of their own. The sixth — `swell` — writes one, and re-declares these
 * four plus its own, which is why they are listed here rather than hidden in a helper.
 */
const STYLE_LIB = /* glsl */ `
in vec3 vW;        // world position of this fragment
in vec4 vD;        // x depth in metres, yz bed-downhill direction, w flow speed
in float vDist;    // metres from the camera
in float vOpen;    // 0..1 coarse water-body-size estimate — see waterOpenness()
out vec4 fragColor;

/* A hard edge exactly one pixel wide.
 *
 * This is the whole toolkit for a stylised surface: cel water, low-poly water and drawn
 * shorelines are all made of steps, and a raw step() on a full-screen sheet at grazing
 * incidence is a staircase that crawls. fwidth is the screen-space rate of change of the very
 * quantity being stepped, so the transition is always one pixel of THIS pixel's footprint —
 * which means the edge stays crisp in the foreground and dissolves honestly into the distance
 * with no distance term needed anywhere. It is a mip chain for a boundary. */
float aaStep(float edge, float x){ float w = max(fwidth(x), 1e-5); return smoothstep(edge - w, edge + w, x); }

/* The analytic band gate, identical to water.js's bandLimit() including its 0.20/0.52 window.
 * fw is the pixel footprint per axis straight off the derivatives, f is a band's frequency
 * along each axis; their dot product is cycles-per-pixel, and past about a half the band
 * carries no information and is faded rather than point-sampled. It has to be the dot product
 * and not max(fw)*max(f): at grazing incidence footprint and bands are anisotropic in the SAME
 * direction, and collapsing either to one number blurs the whole sheet the moment the camera
 * drops to eye level — which in a driving game is where the camera lives. */
float bandGate(vec2 fw, vec2 f){ return 1.0 - smoothstep(0.20, 0.52, dot(fw, abs(f))); }

/* 0 for untouched foreground water, 1 for a flat plate of colour. The moire fix, and it is
 * mandatory in every style: see the FAR_FLAT_NEAR/FAR_FLAT_FULL note in water.js. */
float farFlat(float d){ return smoothstep(${FAR_FLAT_NEAR.toFixed(1)}, ${FAR_FLAT_FULL.toFixed(1)}, d); }

/* How open the water here is, 0 (pond, river, puddle) to 1 (a real sea). Baked per vertex at
 * chunk-adopt time by waterOpenness(); the two constants are read off the shipped seed by
 * "node tools/diag-openwater.mjs", not guessed. */
float openWater(float o){ return smoothstep(${OPEN_LO.toFixed(3)}, ${OPEN_HI.toFixed(3)}, o); }

/* The wet margin every style draws at the waterline, and the reason it is dark rather than
 * pale. The discard above keeps its full 0.5 m tolerance; what this paints is that band, and
 * it used to be pale wet stone with foam on it — a light grey ring whose aliased discard
 * contour showed against the grass as a jagged chalk line. Dark-against-green is the same
 * contour at a third of the contrast, and it reads as the wet margin every painted lake has. */
vec3 wetRim(vec3 col, float rawDepth, float wobble){
  float rim = smoothstep(0.22, -0.30, rawDepth) * mix(0.72, 1.0, wobble);
  return mix(col, ${C.wetStone} * vec3(0.52, 0.55, 0.52), rim*0.85);
}
`;

/* ═══════════════════════════════════════════════════════════════════════════════
 * 2 — CEL.  Flat plates, hard edges, a drawn shoreline.
 *
 * The pallet-town-3d read, built from this world's own measurements. No reflection wash, no
 * fresnel gradient, no normal at all: the surface has no lighting model, only four plates of
 * flat colour chosen by DEPTH, a shoreline that runs in and out, and sparkles that are whole
 * hand-drawn marks winking on and off rather than a specular lobe.
 *
 * Deliberately the most saturated of the seven. It will not sit quietly beside the game's
 * muted Ghibli terrain and it is not meant to — the operator is choosing a winner, and a
 * candidate that hedges toward the others has wasted its slot.
 *
 * Cheapest of the seven by some distance: three pn2 evaluations against the shipped
 * surface's twelve-for-the-normal-alone.
 * ═══════════════════════════════════════════════════════════════════════════════ */
const CEL_FS = /* glsl */ `
const vec3 K_CEL_A    = ${glslColour('#8FE0D8')};  // the shallows, over sand
const vec3 K_CEL_B    = ${glslColour('#43BACB')};
const vec3 K_CEL_C    = ${glslColour('#2A7FB0')};
const vec3 K_CEL_D    = ${glslColour('#1E5089')};  // deep
const vec3 K_CEL_BED  = ${glslColour('#B9C2A8')};  // the bed showing through at the lip
const vec3 K_CEL_FOAM = ${glslColour('#F6FCFF')};

void main(){
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float nearW = 1.0 - farFlat(vDist);

  /* ── the plates ───────────────────────────────────────────────────────────
   * Four flat colours and three boundaries, and the boundaries wobble. A depth contour drawn
   * straight is a level curve off an ordnance map; a coastline is not straight, and the whole
   * legibility of this style rests on those three lines reading as drawn shapes. ~48 m of
   * wobble, drifting slowly, band-limited so a boundary a pixel wide stops wobbling rather
   * than fizzing. */
  vec2 q  = P.xz * 0.021;
  vec2 fw = max(fwidth(q), vec2(1e-4));
  float wob = pn2(q + vec2(uTime*0.011, uTime*0.004)) * 1.15 * bandGate(fw, vec2(1.0));
  float d = depth + wob;

  vec3 col = K_CEL_A;
  col = mix(col, K_CEL_B, aaStep(0.70, d));
  col = mix(col, K_CEL_C, aaStep(2.40, d));
  col = mix(col, K_CEL_D, aaStep(6.00, d));
  // The bed at the very lip. One plate, not a gradient — this style does not do gradients.
  col = mix(K_CEL_BED, col, aaStep(0.14, d));

  /* ── the shoreline, which is the drawing ──────────────────────────────────
   * Two bands: a wide wash that runs up the beach and a thin bright lip inside it. The phase
   * is advanced by a noise sample of world position rather than by uTime alone, because a
   * global sin(uTime) makes every shore in the world breathe in unison, which reads as a
   * heartbeat and not as water. Only the RUN is faded with distance — the bands themselves are
   * depth contours drawn with aaStep, so they mip themselves and stay legible to the horizon. */
  float phase = uTime*0.85 - pn2(P.xz*0.028)*7.0;
  float run   = (0.19 + 0.13*sin(phase)) * mix(0.25, 1.0, nearW);
  float wash  = 1.0 - aaStep(0.22 + run, depth);
  float lip   = 1.0 - aaStep(0.05 + run*0.40, depth);
  float onWet = smoothstep(-0.14, 0.02, vD.x);   // never paint the brightest ink on the beach
  col = mix(col, K_CEL_FOAM, wash*0.42*onWet);
  col = mix(col, K_CEL_FOAM, lip*0.85*onWet);

  /* ── two-tone light ───────────────────────────────────────────────────────
   * The surface is flat, so the sun angle is a constant and there is nothing to shade. What
   * there IS to draw is the cloud shadow crossing the bay, and a cel sea draws it as a shape
   * with an edge rather than as a gradient. aaStep keeps that edge one pixel wide. */
  float ndl = max(dot(vec3(0.0, 1.0, 0.0), uSunDir), 0.0);
  float sh  = sunShadow(P, ndl) * cloudShadow(P);
  col *= mix(0.80, 1.0, aaStep(0.55, sh));

  /* ── sparkle marks ────────────────────────────────────────────────────────
   * A coarse ~7 m cell grid, one dash per cell, each winking on for about a quarter of its own
   * cycle at its own offset — three-frame animation, not a specular highlight. Long across the
   * dash and thin along it, because that is how a person draws a glint. */
  vec2 g  = P.xz * 0.14;
  vec2 gi = floor(g);
  vec2 gf = fract(g) - 0.5;
  vec3 rnd = hash32(gi);
  float on = step(0.74, fract(rnd.z + uTime*0.22));
  vec2 dp  = gf - (rnd.xy - 0.5)*0.62;
  float mark = 1.0 - aaStep(0.115, abs(dp.x)*0.34 + abs(dp.y)*1.55);
  col = mix(col, K_CEL_FOAM,
            mark*on*sh*nearW*aaStep(1.2, depth)*bandGate(max(fwidth(g), vec2(1e-4)), vec2(3.0))*0.85);

  col = wetRim(col, vD.x, 1.0);
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

/* ═══════════════════════════════════════════════════════════════════════════════
 * 3 — SWELL.  The only style that moves the geometry.
 *
 * Four Gerstner components — 63 m, 37 m, 23 m and 13 m, at deep-water dispersion
 * (w = sqrt(g*k)), summing to about 1.5 m of crest. Gerstner rather than plain sines because
 * the horizontal term is what sharpens a crest and flattens a trough; a sum of sines is a
 * quilt, a sum of Gerstner waves is a sea.
 *
 * THE AMPLITUDES CAME UP AFTER THE FIRST PHOTOGRAPH. At 0.55/0.32/0.17/0.085, and with the
 * shoaling term killing the wave over the first 5.5 m of depth, the beach shot at (1800, 600)
 * showed a flat grey-blue sheet: everything within a hundred metres of the shore is shallower
 * than 5.5 m, so the entire visible near field had its swell attenuated to nothing and the one
 * style whose whole identity is that the surface MOVES was the one that moved least.
 *
 * TOTAL STEEPNESS IS CHECKED, NOT GUESSED. Sum of A*k = 0.075 + 0.071 + 0.060 + 0.053 = 0.259,
 * comfortably under 1, which is the point past which a Gerstner surface folds through itself
 * and renders as a knot of black triangles. It also stays inside the 2 m of slack water.js
 * adds to every water plane's bounding sphere for exactly this style.
 *
 * THREE THINGS THE DISPLACEMENT MUST NOT BREAK, and how each is handled:
 *
 *   chunk seams   the wave is a pure function of WORLD xz, so two chunks meeting at an edge
 *                 displace their shared vertices identically and no crack opens. This is why
 *                 it is computed from `wp.xz` after the model matrix and not from `position`.
 *   the shoreline amplitude is scaled to nothing over the first 3 m of depth, so the sheet
 *                 cannot climb the beach — and that is physically right anyway, since it is
 *                 the same shoaling that makes a real swell break rather than run inland.
 *   the far LOD   a level-3 water plane has 32 m between vertices, which cannot represent a
 *                 23 m wave and would alias horribly. Displacement is gone by 520 m, which is
 *                 inside the LOD-2 ring (8 m between vertices), so no plane ever tries.
 *
 * KNOWN LIMITATION, stated rather than hidden: the boat's bob (src/game/boat.js) is analytic
 * and computed from the water TABLE, so a boat does not ride these crests. Everything else —
 * the shoreline, the ships, the sea sound — keys off the same table and is unaffected.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** The four components, shared by the vertex shader and by nothing else. Kept as JS so the
 *  numbers above can be checked without reading GLSL. `l` metres, `a` metres, `q` steepness. */
const SWELL_WAVES = [
  { l: 63, a: 0.75, q: 0.55, deg: 0 },
  { l: 37, a: 0.42, q: 0.5, deg: 24 },
  { l: 23, a: 0.22, q: 0.45, deg: -31 },
  { l: 13, a: 0.11, q: 0.4, deg: 58 },
];

const SWELL_VS = (axis) => {
  const body = SWELL_WAVES.map((w, i) => {
    const k = (2 * Math.PI) / w.l;
    const speed = Math.sqrt(9.81 * k);
    const r = (w.deg * Math.PI) / 180;
    // The world's own ripple axis, rotated per component. Every water surface in this world
    // has to agree about which way the weather runs, or two styles disagree about the world.
    const dx = axis.x * Math.cos(r) - axis.z * Math.sin(r);
    const dz = axis.x * Math.sin(r) + axis.z * Math.cos(r);
    return /* glsl */ `
  {
    vec2 wdir = vec2(${dx.toFixed(6)}, ${dz.toFixed(6)});
    float ph = ${k.toFixed(6)}*dot(wdir, p) + uTime*${speed.toFixed(6)};
    float sn = sin(ph), cs = cos(ph);
    disp.y   += ${w.a.toFixed(4)}*sn;
    disp.xz  += wdir*(${(w.q * w.a).toFixed(6)}*cs);
    grad     += wdir*(${(w.a * k).toFixed(6)}*cs);
    crest    += ${w.a.toFixed(4)}*sn;
  }`;
  }).join('');

  return /* glsl */ `
in vec4 wdat;
in float wopen;
out vec3 vW;
out vec4 vD;
out float vDist;
out float vOpen;
out vec3 vWave;    // xy surface gradient of the swell, z signed crest height in metres

void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec2 p = wp.xz;

  /* Three attenuations, multiplied. See the header above for why each one exists. The depth
   * one is read from the SAME per-vertex attribute the fragment shader colours by, so the
   * swell dies exactly where the shallows begin rather than at a guessed distance from a
   * guessed shore. */
  float dAtt = smoothstep(0.0, 3.0, max(wdat.x, 0.0));
  float rAtt = 1.0 - smoothstep(200.0, 520.0, length(wp.xyz - uCamPos));
  float oAtt = mix(0.30, 1.0, smoothstep(${OPEN_LO.toFixed(3)}, ${OPEN_HI.toFixed(3)}, wopen));
  float amp = dAtt * rAtt * oAtt;

  vec3 disp = vec3(0.0);
  vec2 grad = vec2(0.0);
  float crest = 0.0;
${body}

  wp.xyz += disp * amp;
  vW = wp.xyz;
  vD = wdat;
  vOpen = wopen;
  vDist = length(wp.xyz - uCamPos);
  vWave = vec3(grad*amp, crest*amp);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
};

const SWELL_FS = /* glsl */ `
in vec3 vWave;

const vec3 K_SW_SHELF = ${glslColour('#5E9E9A')};
const vec3 K_SW_MID   = ${glslColour('#2C6E86')};
const vec3 K_SW_DEEP  = ${glslColour('#15405C')};

void main(){
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float nearW = 1.0 - farFlat(vDist);

  vec2 q  = P.xz;
  vec2 fw = max(fwidth(q), vec2(1e-4));

  /* The swell's own normal comes free: the vertex shader already summed d(height)/d(position)
   * for the same four components, so it is EXACT and interpolated rather than three more
   * noise taps. Only the capillary detail on top costs anything, and that is three pn2 — a
   * quarter of what the shipped surface spends on its normal. */
  float e  = max(max(fw.x, fw.y), 0.35);
  vec2  dq = q*0.62 - vec2(uTime*0.90, uTime*0.35);
  float g0 = pn2(dq);
  float gx = pn2(dq + vec2(0.35, 0.0));
  float gz = pn2(dq + vec2(0.0, 0.35));
  vec2 dg = (vec2(gx, gz) - g0) * (1.0/0.35) * 0.055 * bandGate(fw, vec2(0.62)) * nearW;
  vec3 N = normalize(vec3(-(vWave.x + dg.x), 1.0, -(vWave.y + dg.y)));

  float ndl = dot(N, uSunDir);
  float sh  = sunShadow(P, ndl) * cloudShadow(P);

  // A real sea ramp: green over the bar, blue over the shelf, near-navy where it drops away.
  float t = smoothstep(0.3, 9.0, depth);
  vec3 body = mix(K_SW_SHELF, K_SW_MID, smoothstep(0.10, 0.45, t));
  body = mix(body, K_SW_DEEP, smoothstep(0.45, 0.85, t));
  body = mix(mix(${C.wetStone}, K_SW_SHELF, 0.5), body, smoothstep(0.02, 0.18, t));

  /* The reflection colour reads through a partly-calmed normal while the glint below keeps the
   * full one. Same decoupling the shipped surface uses and for the same reason: resampling the
   * sky dome through the full wave field at grazing incidence swings the reflected ray across
   * the whole dome and renders marbled contour lines instead of water. */
  vec3 Nr = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.45));
  vec3 R  = reflect(-V, N);
  vec3 Rr = reflect(-V, Nr);
  vec3 refl = skyDomeLite(normalize(vec3(Rr.x, max(Rr.y, 0.09), Rr.z)));
  float fres = clamp(0.05 + 0.72*pow(1.0 - clamp(dot(Nr, V), 0.0, 1.0), 4.5), 0.0, 0.52);
  vec3 col = mix(body, refl, fres);
  col = mix(col*0.74 + K_SHADOW*0.10, col, sh*0.82 + 0.18);

  /* ── whitecaps ────────────────────────────────────────────────────────────
   * A crest breaks where it is BOTH high and steep, which is the one thing a sum of sines can
   * genuinely tell you and the reason this style displaces geometry at all. Broken up by a
   * noise field advected with the waves so the caps travel with the crests they sit on rather
   * than sliding through them. */
  float crestN = clamp(vWave.z*0.34 + 0.5, 0.0, 1.0);
  float steep  = clamp(length(vWave.xy)*3.2, 0.0, 1.0);
  float capN   = pn2(q*0.30 - vec2(uTime*0.55, uTime*0.18))*0.5 + 0.5;
  // 0.55/0.88 and a 0.8 m depth gate, loosened from 0.62/0.95 and 1.2 m for the same reason
  // the amplitudes came up: at the old thresholds nothing within sight of a beach ever broke.
  float cap = smoothstep(0.55, 0.88, crestN*0.62 + steep*0.55) * smoothstep(0.45, 0.85, capN);
  cap *= bandGate(fw, vec2(0.30)) * nearW * smoothstep(0.8, 2.5, depth);
  col = mix(col, ${C.wFoam}, cap*0.80);

  float f = max(dot(normalize(R), uSunDir), 0.0);
  col += ${C.wSpark} * pow(f, 60.0) * 0.90 * sh * nearW;
  col += K_SUN * pow(f, 12.0) * 0.20 * sh;

  // Shore foam, keyed off the measured depth so the band is a genuine contour of the bed and
  // widens by itself wherever the shore shelves gently.
  float edge = 1.0 - smoothstep(0.0, 0.55, depth);
  float scallop = mix(0.5, pn2(q*0.55 + vec2(uTime*0.15, 0.0))*0.5 + 0.5, bandGate(fw, vec2(0.55)));
  float foam = smoothstep(0.40, 0.95, edge*(0.50 + 0.90*scallop)) * smoothstep(-0.14, 0.02, vD.x);
  col = mix(col, ${C.wFoam}, foam*0.55);

  col = wetRim(col, vD.x, scallop);
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

/* ═══════════════════════════════════════════════════════════════════════════════
 * 4 — FACET.  Low-poly, and NOT low-polygon.
 *
 * The obvious way to make faceted water is to flat-shade the mesh. That would have been wrong
 * here and it is worth saying why: this water plane is a quadtree LOD, 2 m between vertices at
 * the car and 64 m five rings out, so mesh facets would be pebbles underfoot and cathedral
 * windows on the horizon, and they would visibly resize as you drove. The facets have to be a
 * function of WORLD SPACE, not of the mesh.
 *
 * So world xz is skewed into a triangular lattice of fixed ~7 m side, each triangle hashed to
 * its own tilt and its own paper tone, and the surface is shaded from that. The result is
 * mesh-independent, LOD-independent, seam-free across chunks (the lattice is global) and
 * exactly as coarse near the car as it is at 200 m — which is the origami look the mesh could
 * never have given.
 *
 * The facets flex rather than sit still: each carries its own phase, so the sheet buckles like
 * a folded paper sea instead of reading as a static texture.
 * ═══════════════════════════════════════════════════════════════════════════════ */
const FACET_FS = /* glsl */ `
const vec3 K_FC_A = ${glslColour('#9BC9CE')};
const vec3 K_FC_B = ${glslColour('#4E90A8')};
const vec3 K_FC_C = ${glslColour('#2B5A78')};

/** Metres along one edge of a facet. 7 is chunky on purpose — at 3 m this reads as noise. */
const float FACET_SIDE = 7.0;

void main(){
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float nearW = 1.0 - farFlat(vDist);

  /* ── the lattice ──────────────────────────────────────────────────────────
   * The standard simplex skew: it turns the unit square grid into 60-degree rhombi, and
   * step(1.0, x+y) picks which of the two triangles inside a rhombus this fragment is in. Two
   * floors and a step for a triangular tiling of the whole world. */
  vec2 sk = vec2(P.x + P.z*0.57735027, P.z*1.15470054) * (1.0/FACET_SIDE);
  vec2 fw = max(fwidth(sk), vec2(1e-4));
  vec2 si = floor(sk);
  vec2 sf = fract(sk);
  vec3 cellId = vec3(si, step(1.0, sf.x + sf.y));
  vec3 rnd = hash33(cellId + vec3(0.5));

  /* Each facet's own tilt, half fixed and half flexing on its own phase. The fade is the
   * mandatory far-field gate plus the band gate on the lattice itself: a facet narrower than
   * a couple of pixels is a normal discontinuity being point-sampled, which is the crawling
   * crosshatch this project has already shipped once. Past that, flat. */
  float ph = rnd.z*6.2831853 + uTime*0.55;
  vec2 tilt = (rnd.xy - 0.5)*1.10 + vec2(sin(ph), cos(ph*0.87))*0.30;
  float fade = bandGate(fw, vec2(1.6)) * nearW;
  tilt *= 0.42 * fade * mix(0.45, 1.0, smoothstep(0.4, 3.0, depth));
  vec3 N = normalize(vec3(tilt.x, 1.0, tilt.y));

  float ndl = dot(N, uSunDir);
  float sh  = sunShadow(P, ndl) * cloudShadow(P);

  /* The body colour is quantised BY FACET, not by fragment: the depth that chooses the plate
   * is jittered per facet, so the boundary between two plates is a jagged line of whole
   * triangles rather than a smooth contour. That jaggedness is the style. */
  float t = smoothstep(0.15, 6.0, depth + (rnd.x - 0.5)*0.55);
  vec3 body = mix(K_FC_A, K_FC_B, smoothstep(0.12, 0.42, t));
  body = mix(body, K_FC_C, smoothstep(0.45, 0.85, t));
  body *= mix(0.90, 1.10, rnd.y);   // every sheet of paper is a slightly different white

  vec3 R = reflect(-V, N);
  vec3 refl = skyDomeLite(normalize(vec3(R.x, max(R.y, 0.08), R.z)));
  float fres = clamp(0.06 + 0.55*pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0), 0.0, 0.45);
  vec3 col = mix(body, refl, fres);

  /* Hard facet lighting: the fold catches the sun or it does not. aaStep on a piecewise
   * CONSTANT field is exactly right — fwidth is zero inside a facet and large at its edge, so
   * the step is perfectly hard everywhere except the one pixel that straddles the fold. */
  col *= mix(0.86, 1.14, aaStep(0.5, clamp(ndl*1.6 + 0.35, 0.0, 1.0)));
  col = mix(col*0.74 + K_SHADOW*0.10, col, sh*0.82 + 0.18);

  // A scattering of white facets standing in for foam — 4.5% of them, deep water only.
  col = mix(col, ${C.wFoam}, step(0.955, rnd.x)*fade*smoothstep(1.5, 4.0, depth)*0.75);

  /* The shore band is faceted too, and that is the point: the foam ring comes out as a
   * jagged run of whole triangles, which is what the rest of the style has promised. */
  float edge = 1.0 - smoothstep(0.0, 0.45, depth);
  float foam = aaStep(0.55, edge*(0.55 + 0.75*rnd.z)) * smoothstep(-0.14, 0.02, vD.x);
  col = mix(col, ${C.wFoam}, foam*0.65);

  col = wetRim(col, vD.x, mix(0.6, 1.0, rnd.z));
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

/* ═══════════════════════════════════════════════════════════════════════════════
 * 5 — GLASS.  A mirror that breathes.
 *
 * The one style that deliberately breaks the shipped surface's rule about grazing angles. Its
 * comment says stylised water keeps its own colour at grazing angles and caps the fresnel term
 * at 0.36, because at 0.46 the far lake surrendered to the sky and came back a sheet of
 * grey-white. That is the correct call for painted water and the WRONG one for a mirror: a
 * still infinity pool at dawn IS a sheet of sky, the horizon smear is the whole effect, and a
 * candidate that hedges away from it is just the painted one again with a different blue.
 * So fresnel runs to 0.96 here, on purpose, and the operator can judge it.
 *
 * The ripples are ANALYTIC SINES, not noise. On a mirror every wave is visible as a whole
 * line, so they want to be real sinusoids — and a sinusoid's derivative is exact, which means
 * the normal costs three cosines instead of three noise taps and has no finite-difference
 * error to alias. Total surface gradient about 0.029, or 1.7 degrees of tilt: a mirror at
 * 7 degrees is not a mirror, it is a puddle.
 * ═══════════════════════════════════════════════════════════════════════════════ */
const GLASS_FS = /* glsl */ `
/* Darker than the first attempt ('#2C3A46'), and the reason is the photograph: with fresnel
 * running to 0.96 the far half of the frame is already sky, so unless the body underneath is
 * genuinely dark there is no contrast anywhere and the whole surface reads as haze rather than
 * as a mirror. A mirror is a DARK thing with a bright picture on it. */
const vec3 K_GL_SHALLOW = ${glslColour('#7A8C90')};
const vec3 K_GL_DEEP    = ${glslColour('#1B2831')};

void main(){
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float nearW = 1.0 - farFlat(vDist);

  vec2 q  = P.xz;
  vec2 fw = max(fwidth(q), vec2(1e-4));

  // ~90 m, ~40 m and ~20 m, crossing at deliberately unrelated angles so no two ever line up
  // into a corduroy. The finest two carry their own band gate; the longest never needs one.
  vec2 d1 = normalize(vec2( 0.94,  0.34));
  vec2 d2 = normalize(vec2(-0.42,  0.91));
  vec2 d3 = normalize(vec2( 0.18, -0.98));
  float p1 = 0.070*dot(d1, q) + uTime*0.42;
  float p2 = 0.155*dot(d2, q) - uTime*0.58;
  float p3 = 0.310*dot(d3, q) + uTime*0.81;
  vec2 grad = d1*(0.00385*cos(p1))
            + d2*(0.00341*cos(p2))*bandGate(fw, vec2(0.155))
            + d3*(0.00248*cos(p3))*bandGate(fw, vec2(0.310));
  /* 5.0, up from 3.0 — about 2.8 degrees of tilt. At 1.7 degrees the wave lines were below the
   * threshold at which a reflection shows them at all and the sheet read as flat haze; at 2.8
   * they are visible as long creases in the sky it is reflecting, which is what a real
   * near-still water surface looks like and is the entire difference between this style and a
   * pale rectangle. Still an order of magnitude calmer than any other style here. */
  grad *= 5.0 * nearW;
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

  float ndl = dot(N, uSunDir);
  float sh  = sunShadow(P, ndl) * cloudShadow(P);

  // The body barely gets a say, which is the point — a mirror shows the sky, not itself.
  float t = smoothstep(0.20, 5.0, depth);
  vec3 body = mix(K_GL_SHALLOW, K_GL_DEEP, t);
  body = mix(mix(${C.wetStone}, K_GL_SHALLOW, 0.5), body, smoothstep(0.02, 0.20, t));

  /* 0.02 rather than the shipped surface's 0.11 floor on the reflected ray's elevation. That
   * floor exists to keep the far lake out of the sky's pale horizon band; here the pale
   * horizon band IS the picture, so the ray is allowed all the way down to it. */
  vec3 R = reflect(-V, N);
  vec3 refl = skyDomeLite(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
  /* Exponent 5.5 rather than 5: the cap stays at 0.96 (a mirror IS a mirror at grazing) but the
   * curve is pulled tighter into the last few degrees, so the middle distance keeps enough of
   * the dark body above to have something for the reflection to be a reflection ON. */
  float fres = clamp(0.02 + 0.98*pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.5), 0.0, 0.96);
  vec3 col = mix(body, refl, fres);
  col = mix(col*0.80 + K_SHADOW*0.07, col, sh*0.82 + 0.18);

  /* The mirrored sun, and the pillar it lays down the water. The pillar needs no separate
   * term and no screen-space trick: the three ripples spread the reflected ray vertically
   * along the sun's own azimuth, so a wide-exponent lobe through the SAME normal comes out as
   * a column reaching toward the viewer. It is what a real mirror does and it is one pow(). */
  float f = max(dot(normalize(R), uSunDir), 0.0);
  col += ${C.wSpark} * (smoothstep(0.99965, 0.99992, f)*3.0 + pow(f, 260.0)*1.10) * sh * fres;

  // Almost no foam. A mirror has a LINE where it meets the land, and nothing else.
  float lip = 1.0 - aaStep(0.10, depth);
  col = mix(col, ${C.wFoam}, lip*0.30*smoothstep(-0.14, 0.02, vD.x));

  col = wetRim(col, vD.x, 1.0);
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

/* ═══════════════════════════════════════════════════════════════════════════════
 * 6 — TROPICAL.  Everything hangs off the shelf break.
 *
 * The distinctive thing about tropical water is not that it is turquoise, it is the LINE where
 * the sand stops. Inside it you see the bottom, the caustics and the sand's own colour;
 * outside it the light never comes back and the water goes sapphire in a couple of metres.
 * That line gets a luminous band of its own here — a narrow gaussian on the depth ramp,
 * centred where the sand ends — because it is the single feature that says "tropical" before
 * any of the colours do.
 *
 * The caustics are ridged noise (1 - |n|, sharpened) rather than the shipped surface's
 * cubed value noise: ridged gives the closed loops and bright filaments that read as
 * caustics, where the cubed version gives blobs. They are a CLOSE-UP delight and are gone by
 * 300 m — the shipped surface learned that the hard way, where the surviving band read as
 * white curls smeared across the shelf.
 * ═══════════════════════════════════════════════════════════════════════════════ */
const TROPICAL_FS = /* glsl */ `
const vec3 K_TR_SAND   = ${glslColour('#EFE0BE')};
const vec3 K_TR_LAGOON = ${glslColour('#6FE0D6')};
const vec3 K_TR_REEF   = ${glslColour('#17A8C4')};
const vec3 K_TR_DEEP   = ${glslColour('#0B4E8C')};
const vec3 K_TR_GLOW   = ${glslColour('#B8FFF4')};

/** Lagoon chop: short, crossed and gentle. Two bands is all this style needs — the colour is
 *  doing the work, and a busy normal would fight the sand showing through. */
float lagoonChop(vec2 p, vec2 dr, vec2 fw){
  float a = pn2((p - dr)*0.33)         * bandGate(fw, vec2(0.33));
  float b = pn2((p + dr*0.7)*0.78 + 13.0) * bandGate(fw, vec2(0.78));
  return a*0.62 + b*0.38;
}

void main(){
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float nearW = 1.0 - farFlat(vDist);

  vec2 q  = P.xz;
  vec2 fw = max(fwidth(q), vec2(1e-4));
  /* PER-AXIS, never one scalar. At grazing incidence a pixel is tens of metres down the view
   * and under a metre across it; taking the longer axis for both measures the across-axis
   * slope over a baseline forty times too wide, and what comes out is a chevron weave rather
   * than a normal. It cost the deep-ocean style below a whole round to find. */
  vec2 e = max(fw, vec2(0.40));
  vec2 dr = vec2(uTime*0.35, uTime*0.12);
  float n0 = lagoonChop(q, dr, fw);
  float nx = lagoonChop(q + vec2(e.x, 0.0), dr, fw);
  float nz = lagoonChop(q + vec2(0.0, e.y), dr, fw);
  // Shallow water is choppier — the bed shortens the wave — and the soft clamp keeps the
  // capillary bands from swinging the reflected ray from horizon to zenith between pixels.
  vec2 dh = (vec2(nx, nz) - n0)/e * 3.2 * nearW * mix(1.25, 1.0, smoothstep(0.3, 2.5, depth));
  dh /= 1.0 + 2.2*length(dh);
  vec3 N = normalize(vec3(-dh.x, 1.0, -dh.y));

  float ndl = dot(N, uSunDir);
  float sh  = sunShadow(P, ndl) * cloudShadow(P);

  float t = smoothstep(0.05, 12.0, depth);
  vec3 sand = K_TR_SAND * mix(0.94, 1.08, mix(0.5, pn2(q*0.5)*0.5 + 0.5, bandGate(fw, vec2(0.5))));
  vec3 body = mix(K_TR_LAGOON, K_TR_REEF, smoothstep(0.06, 0.24, t));
  body = mix(body, K_TR_DEEP, smoothstep(0.28, 0.62, t));
  body = mix(sand, body, smoothstep(0.005, 0.06, t));
  // The shelf break: a narrow band of light exactly where the sand stops. See the header.
  body += K_TR_GLOW * exp(-pow((t - 0.26)/0.055, 2.0)) * 0.35;

  // Caustics on the sand — ridged noise, two octaves, sharpened hard, close range only.
  vec2 cq = q*0.9 - vec2(uTime*0.25, uTime*0.11);
  float caus = pow(clamp(1.0 - abs(pn2(cq)*0.70 + pn2(cq*1.7 + 11.0)*0.50), 0.0, 1.0), 6.0);
  caus *= bandGate(fw, vec2(1.53)) * smoothstep(300.0, 120.0, vDist);
  body += K_TR_GLOW * caus * 0.55 * (1.0 - smoothstep(0.02, 0.16, t)) * sh;

  // Reflection is kept low: tropical water is the one water whose BODY colour wins.
  vec3 Nr = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.60));
  vec3 R  = reflect(-V, N);
  vec3 Rr = reflect(-V, Nr);
  vec3 refl = skyDomeLite(normalize(vec3(Rr.x, max(Rr.y, 0.14), Rr.z)));
  float fres = clamp(0.03 + 0.50*pow(1.0 - clamp(dot(Nr, V), 0.0, 1.0), 4.0), 0.0, 0.26);
  vec3 col = mix(body, refl, fres);
  col = mix(col*0.76 + K_SHADOW*0.09, col, sh*0.82 + 0.18);
  col += ${C.wSpark} * pow(max(dot(normalize(R), uSunDir), 0.0), 90.0) * 1.40 * sh * nearW;

  float edge = 1.0 - smoothstep(0.0, 0.55, depth);
  float scEdge = bandGate(fw, vec2(0.8));
  float scallop = mix(0.5, pn2(q*0.8 - vec2(uTime*0.2, 0.0))*0.5 + 0.5, scEdge);
  float foam = smoothstep(0.35, 0.92, edge*(0.50 + 1.00*scallop));
  // Once the scallop is band-limited away the foam has no breakup left and turns into a solid
  // chalk apron across every distant flat shelf, so it dims with the gate that took its texture.
  foam *= mix(0.35, 1.0, scEdge) * smoothstep(-0.14, 0.02, vD.x);
  col = mix(col, ${C.wFoam}*mix(0.90, 1.06, scallop), foam*0.62);

  col = wetRim(col, vD.x, scallop);
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

/* ═══════════════════════════════════════════════════════════════════════════════
 * 7 — ABYSS.  Dark water, hard light.
 *
 * The darkest thing in the game by a wide margin, and that is the whole idea: every other
 * surface here is a mid-tone, so the one candidate that goes properly dark separates from all
 * six of the others before you have looked at its hue. A low sun over deep water really does
 * render as near-black with a road of hard white on it, and the contrast is what makes the
 * specular read at all — a bright sea cannot have a bright glitter path.
 *
 * The reflected sky is multiplied by 0.42 rather than used straight. That is not physical and
 * it is not an accident: a mirror-bright sky reflection over a black body reads as an oil
 * slick, because the eye takes the brightest thing in the frame as the surface. Darkening the
 * reflection keeps the body the surface and the glitter the light.
 *
 * ── THE HERRINGBONE, AND THE THREE THINGS THAT CAUSED IT ──────────────────────
 * The first version of this style was photographed at a beach at (1800, 600) and came back
 * with a hard chevron weave across the whole bay — the exact artefact water.js has a
 * four-paragraph note about, reproduced from scratch by making all three of its mistakes at
 * once. Written down because each is easy to make again:
 *
 *   1. THE BANDS RAN DOWN A WORLD AXIS. deepChop was a function of raw P.xz, so every ripple
 *      in the world lay parallel to world Z. water.js solves this with rippleFrame(): a
 *      seeded rotation of world space with a ~270 m domain warp on it, so the streaks meander
 *      instead of ruling the whole world in parallel lines. Same frame, same warp, here.
 *   2. THE FINITE DIFFERENCE USED ONE SCALAR STEP. `max(max(fw.x, fw.y), 0.5)` takes the
 *      LONGER of the two pixel axes and uses it for both — and at grazing incidence a pixel is
 *      tens of metres down the view and under a metre across it, so the across-axis difference
 *      was being measured over a baseline forty times too wide. That is not a normal, it is a
 *      moire generator. Per-axis, exactly as the shipped surface does it.
 *   3. THE AMPLITUDE WAS ROUGHLY TWICE WHAT A PAINTED SURFACE CAN CARRY. 2.4 + 2.6 on open
 *      water, against the shipped surface's ~8.5 through a much gentler noise field. A
 *      hard-tilted normal at grazing incidence swings the reflected ray across the whole sky
 *      dome between neighbouring pixels, which is glitter on a real sea and marbling on a
 *      painted one. Halved, and the soft clamp tightened from 2.6 to 3.2.
 * ═══════════════════════════════════════════════════════════════════════════════ */
const ABYSS_FS = (axis) => /* glsl */ `
const vec3 K_AB_SHELF = ${glslColour('#27666B')};
const vec3 K_AB_MID   = ${glslColour('#0E3A4C')};
const vec3 K_AB_DEEP  = ${glslColour('#061E2C')};

/* The world's ripple axis and water.js's own domain warp — see cause 1 in the header. Amplitude
 * times frequency stays well under one, so the map keeps a bounded derivative and the frame is
 * as well-behaved as the plain rotation underneath it. */
const vec2 AB_AXIS = vec2(${axis.x.toFixed(6)}, ${axis.z.toFixed(6)});
vec2 abyssFrame(vec2 p){
  vec2 w = vec2(pn2(p*0.0037 + 11.3), pn2(p*0.0037 + 41.7)) * 22.0;
  vec2 s = p + w;
  return vec2(dot(s, AB_AXIS), dot(s, vec2(-AB_AXIS.y, AB_AXIS.x)));
}

/** Long, low ocean chop. Two bands, strongly anisotropic — long down one axis and short across
 *  it, which is the single thing that makes water look like it is going somewhere. */
float deepChop(vec2 p, float t, vec2 fw){
  float a = pn2(vec2((p.x - t*1.10)*0.055, p.y*0.34))        * bandGate(fw, vec2(0.055, 0.34));
  float b = pn2(vec2((p.x - t*0.80)*0.170, p.y*0.95) + 21.0) * bandGate(fw, vec2(0.170, 0.95));
  return a*0.64 + b*0.36;
}

void main(){
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float nearW = 1.0 - farFlat(vDist);
  float openF = openWater(vOpen);

  vec2 q  = abyssFrame(P.xz);
  vec2 fw = max(fwidth(q), vec2(1e-4));
  // Per-axis, and never narrower than the shipped surface's own 0.5 m floor — see cause 2.
  vec2 e = max(fw, vec2(0.50));
  float n0 = deepChop(q, uTime, fw);
  float nx = deepChop(q + vec2(e.x, 0.0), uTime, fw);
  float nz = deepChop(q + vec2(0.0, e.y), uTime, fw);
  // The open sea gets the taller chop here, the exact opposite of the shipped surface's calm
  // term — that one is about a lake reading as flat, this one is about an ocean reading as an
  // ocean. Same attribute, opposite intent, stated so nobody "fixes" it later.
  vec2 dh = (vec2(nx, nz) - n0)/e * (1.2 + 1.3*openF) * nearW;
  dh /= 1.0 + 3.2*length(dh);
  // Back out of the ripple frame into world xz. The warp is ignored in this rotation: it is a
  // few degrees of shear, and the normal only has to look right, not integrate.
  vec2 axC = vec2(-AB_AXIS.y, AB_AXIS.x);
  vec3 N = normalize(vec3(-(dh.x*AB_AXIS.x + dh.y*axC.x), 1.0, -(dh.x*AB_AXIS.y + dh.y*axC.y)));

  float ndl = dot(N, uSunDir);
  float sh  = sunShadow(P, ndl) * cloudShadow(P);

  float t = smoothstep(0.4, 14.0, depth);
  vec3 body = mix(K_AB_SHELF, K_AB_MID, smoothstep(0.05, 0.30, t));
  body = mix(body, K_AB_DEEP, smoothstep(0.35, 0.80, t));
  body = mix(mix(${C.wetStone}*0.55, K_AB_SHELF, 0.5), body, smoothstep(0.01, 0.09, t));

  vec3 Nr = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.55));
  vec3 R  = reflect(-V, N);
  vec3 Rr = reflect(-V, Nr);
  vec3 refl = skyDomeLite(normalize(vec3(Rr.x, max(Rr.y, 0.07), Rr.z))) * 0.42;
  float fres = clamp(0.02 + 0.85*pow(1.0 - clamp(dot(Nr, V), 0.0, 1.0), 5.0), 0.0, 0.55);
  vec3 col = mix(body, refl, fres);
  col = mix(col*0.66 + K_SHADOW*0.06, col, sh*0.82 + 0.18);

  /* ── the sun road ─────────────────────────────────────────────────────────
   * Two lobes and a quantised sparkle. The hard lobe alone is a field of winking points; the
   * wide one alone is a smear; together they are the column of broken light a low sun lays
   * across water, and "road" is how far down that column you are actually looking. The
   * sparkle is a sub-pixel event by construction, so it hands its energy to the wide lobe
   * once a pixel is wider than the field rather than strobing. */
  float f = max(dot(normalize(R), uSunDir), 0.0);
  float road = smoothstep(0.30, 1.0, dot(normalize(vec2(V.x, V.z) + vec2(1e-5)),
                                         -normalize(uSunDir.xz + vec2(1e-5))));
  float spark = step(0.62, pn2(q*2.1 - vec2(uTime*0.90, uTime*0.40))*0.5 + 0.5)
              * bandGate(fw, vec2(2.1)) * nearW;
  col += ${C.wSpark} * (pow(f, 420.0)*4.20*spark + pow(f, 34.0)*0.55) * sh * (0.25 + 0.90*road);

  // Sparse whitecaps, open sea only, deep water only. A pond does not get whitecaps.
  float capN = pn2(q*0.22 - vec2(uTime*0.30, uTime*0.09))*0.5 + 0.5;
  float cap = smoothstep(0.86, 0.98, capN) * openF * smoothstep(2.0, 6.0, depth)
            * bandGate(fw, vec2(0.22)) * nearW;
  col = mix(col, ${C.wFoam}*0.92, cap*0.55);

  float edge = 1.0 - smoothstep(0.0, 0.35, depth);
  float scallop = mix(0.5, pn2(q*0.9)*0.5 + 0.5, bandGate(fw, vec2(0.9)));
  float foam = smoothstep(0.45, 0.95, edge*(0.50 + 0.90*scallop)) * smoothstep(-0.14, 0.02, vD.x);
  col = mix(col, ${C.wFoam}*0.88, foam*0.42);

  col = wetRim(col, vD.x, scallop);
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

/* ── assembling a style's two shader sources ───────────────────────────────────
 * Cached per (style, seed). Not for the CPU time — building these strings is a handful of
 * concatenations — but because `applyWaterStyle` compares the produced source against what is
 * already on the material to decide whether a recompile is needed at all, and identical
 * strings coming out of the cache make that comparison a pointer compare in the common case.
 */
const _sourceCache = new Map();

function shadersFor(style, seed) {
  const key = `${style.id}:${seed >>> 0}`;
  const hit = _sourceCache.get(key);
  if (hit) return hit;
  const built = style.build(seed >>> 0);
  _sourceCache.set(key, built);
  return built;
}

/** Every non-displacing style: water.js's own vertex shader, the shared prelude, then a body. */
const painter = (body) => (/* seed */) => ({
  vertexShader: waterVertexShader(),
  fragmentShader: waterFragShader(STYLE_LIB + body),
});

/**
 * The seven, in the order they appear on the button row. `id` is what goes in localStorage
 * and in `?water=`, so it is a permanent name — relabel freely, never rename an id.
 */
export const WATER_STYLES = [
  {
    id: 'painted',
    /* THE LABEL SAYS "original" ON PURPOSE. This entry is src/render/water.js's shipped surface,
     * byte for byte, reached through defaultWaterShaders() — nothing about it is reimplemented
     * here. A player who tries the other six and wants the game back must be able to see which
     * button that is without guessing, and so must anyone reading a bug report about it. */
    label: 'Painted (original)',
    blurb: 'the shipped water — depth plates, flow ribbons and Wind Waker scribble foam',
    build: (seed) => defaultWaterShaders(seed),
  },
  {
    id: 'cel',
    label: 'Flat cel',
    blurb: 'four flat plates, hard edges and a drawn shoreline that runs in and out',
    build: painter(CEL_FS),
  },
  {
    id: 'swell',
    label: 'Ocean swell',
    blurb: 'four Gerstner waves that actually move the surface, with breaking whitecaps',
    /* The one style with a vertex shader of its own, and the one that needs the seed: the four
     * wave directions are the world's own ripple axis, rotated, so this sea runs the same way
     * the painted one's streaks do and the two are describing the same weather. */
    build: (seed) => ({
      vertexShader: vertHead(SWELL_VS(waterRippleAxis(seed))),
      fragmentShader: waterFragShader(STYLE_LIB + SWELL_FS),
    }),
  },
  {
    id: 'facet',
    label: 'Low-poly',
    blurb: 'a folded paper sea — 7 m triangular facets in world space, flat-shaded',
    build: painter(FACET_FS),
  },
  {
    id: 'glass',
    label: 'Glass',
    blurb: 'a near-perfect mirror: sky, horizon smear and a sun pillar down the water',
    build: painter(GLASS_FS),
  },
  {
    id: 'tropical',
    label: 'Tropical',
    blurb: 'white sand, turquoise lagoon, a glowing shelf break and bright caustics',
    build: painter(TROPICAL_FS),
  },
  {
    id: 'abyss',
    label: 'Deep ocean',
    blurb: 'near-black water under a hard road of sun glitter',
    /* Needs the seed for the same reason the swell does, and for a reason the swell does not:
     * its chop is strongly anisotropic, so without the world's own rotated-and-warped ripple
     * frame every wave in the world lies parallel to world Z and the sea renders as a chevron
     * weave. See the note above ABYSS_FS. */
    build: (seed) => ({
      vertexShader: waterVertexShader(),
      fragmentShader: waterFragShader(STYLE_LIB + ABYSS_FS(waterRippleAxis(seed))),
    }),
  },
];

/** Where the choice is remembered between sessions. */
export const WATER_STYLE_KEY = 'wanderoad.waterStyle';
/** The shipped surface. Nothing about the water changes until somebody presses a button. */
/* TROPICAL, because the operator chose it. Verbatim, having driven all seven: "Water tropical is
 * final good". His other verdicts, kept here so nobody re-litigates them: "Glass is close but not
 * it -- keep it in mind" (kept as the runner-up), "low poly is definitely not it", "Deep Ocean is
 * not it", "Flat Swell is definitely not it", and Ocean Swell "overwhelms the boat so that isn't
 * practical unless the boat goes up and down with the water. But it looks pretty good, to be
 * honest" — which is why the boat learned to ride waves (game/boat.js) before this line moved.
 *
 * 'painted' is still in the list and still selectable; it is simply no longer what you arrive to. */
export const WATER_STYLE_DEFAULT = 'tropical';

const byId = (id) => WATER_STYLES.find((s) => s.id === id) || null;

/** id, index, or a style object -> the style object, or null if it is none of those. */
function resolveStyle(idOrIndex) {
  if (idOrIndex == null) return null;
  if (typeof idOrIndex === 'number') return WATER_STYLES[idOrIndex] ?? null;
  if (typeof idOrIndex === 'object') return byId(idOrIndex.id);
  return byId(String(idOrIndex));
}

let _chosen = null;

/**
 * The style the game is running, resolved once from `?water=` then localStorage then the
 * default — the same order and the same fallbacks as render/grass.js's grassQuality(), because
 * this is the same kind of choice and two different answers to "where does a preference live"
 * is how a setting starts lying.
 */
export function currentWaterStyle() {
  if (_chosen) return byId(_chosen) || WATER_STYLES[0];
  let id = WATER_STYLE_DEFAULT;
  try {
    const url = new URLSearchParams(globalThis.location?.search ?? '').get('water');
    id = url || globalThis.localStorage?.getItem(WATER_STYLE_KEY) || WATER_STYLE_DEFAULT;
  } catch {
    /* no storage or no location — the default is a perfectly good answer */
  }
  _chosen = (byId(id) || WATER_STYLES[0]).id;
  return byId(_chosen);
}

/**
 * A Water instance, a material, a mesh, an iterable of any of those, or nothing at all (which
 * means every water material currently in a scene). Deliberately forgiving: the call site is a
 * menu handler, and a style chooser that throws because it was handed the renderer instead of
 * the material is a style chooser nobody wires up.
 */
function materialsOf(target) {
  if (!target) return [...liveWaterMaterials];
  if (target.isMaterial) return [target];
  if (target.material && target.material.isMaterial) return [target.material];
  if (typeof target === 'object' && typeof target[Symbol.iterator] === 'function') {
    return [...target].flatMap(materialsOf);
  }
  /* Handed something that is not a water surface at all — most likely the THREE renderer, which
   * is the other thing a caller reasonably has in hand when they think "change the water". The
   * honest reading of that is "change all of it", not "silently do nothing", and there is no
   * ambiguity to preserve: this module knows every water material in the scene. */
  return [...liveWaterMaterials];
}

/**
 * Put `style` on `target`, live. Returns the number of materials that actually changed.
 *
 * The source comparison is what makes this safe to call as often as you like: re-applying the
 * style a material already carries produces byte-identical strings and touches nothing, so the
 * boot-time restore below costs a string compare rather than a shader recompile, and clicking
 * the button you are already on does nothing at all.
 *
 * @param {object} [target]  Water instance / material / mesh / iterable / undefined for all
 * @param {object} [style]   defaults to currentWaterStyle()
 */
export function applyWaterStyle(target, style = currentWaterStyle()) {
  if (!style) return 0;
  let changed = 0;
  for (const mat of materialsOf(target)) {
    const seed = mat.userData?.waterSeed ?? 0;
    const src = shadersFor(style, seed);
    if (mat.vertexShader === src.vertexShader && mat.fragmentShader === src.fragmentShader) {
      mat.userData.waterStyle = style.id;
      continue;
    }
    mat.vertexShader = src.vertexShader;
    mat.fragmentShader = src.fragmentShader;
    mat.userData.waterStyle = style.id;
    /* This one line is the live switch. three keys its program cache on the shader SOURCE for
     * a RawShaderMaterial, so bumping the version makes the next draw link a new program for
     * the new source and every water plane in the world — they all share this material —
     * changes together in that frame. One compile hitch on the click; nothing per frame after. */
    mat.needsUpdate = true;
    changed++;
  }
  return changed;
}

/**
 * Choose a water. Remembers the choice and applies it to every water surface in the scene
 * immediately — no page reload, which is what "just clicking a button on the menu" has to
 * mean. Returns the style that is now running, or null if the argument named nothing.
 *
 * @param {string|number|object} idOrIndex  a style id, its index in WATER_STYLES, or the style
 */
export function setWaterStyle(idOrIndex) {
  const style = resolveStyle(idOrIndex);
  if (!style) return null;
  _chosen = style.id;
  try {
    globalThis.localStorage?.setItem(WATER_STYLE_KEY, style.id);
  } catch {
    /* private browsing, or no storage at all — the switch still works for this session */
  }
  applyWaterStyle(undefined, style);
  return style;
}

/* Every style carries the apply() the brief asked for, so a caller that has a style object in
 * hand — a button's own data, say — can use it directly and never touch the module functions.
 * It is the same code path; there is exactly one implementation. */
for (const style of WATER_STYLES) {
  style.apply = (target) => applyWaterStyle(target, style);
}

/* ── the boot-time restore ─────────────────────────────────────────────────────
 * Subscribing here, at module load, rather than asking main.js to make a call is what keeps
 * this whole feature out of the two files it is not allowed to touch. The hook fires for water
 * materials that already exist AND for the one main.js creates later, so a style chosen in a
 * previous session is on the sea from the first frame it is drawn — without which the player
 * would get painted water every time they loaded the game until they opened the Garage again.
 *
 * Cost when nobody has changed anything: currentWaterStyle() returns 'painted', the sources
 * come back byte-identical to what createWaterMaterial() already built, and applyWaterStyle
 * returns 0 having done nothing.
 */
onWaterMaterial((mat) => applyWaterStyle(mat));
