/* Wanderoad — flower beds and ground cover.
 *
 * The layer between the grass and the trees: drifts of colour in the sward, and the soft
 * leafy stuff that grows with them. It exists because a meadow made only of blades is a
 * texture, and a texture has no PLACES in it. A bed of cream daisies on the inside of a bend
 * is a place — you remember it on the way back.
 *
 * WHAT MAKES THIS COZY RATHER THAN CONFETTI, in order of how easy each is to lose:
 *
 *  1. A drift is ONE species in ONE colour. `bloomSpecies` in world/scatter.js is a 240 m
 *     noise field, so a whole bank of flowers is the same flower. Randomising colour per
 *     plant is the single fastest way to turn a meadow into a sweet shop.
 *  2. Most of the layer is not in flower at all. The patch field decides how much grows; the
 *     bloom field decides how much of it blooms. What you get at the edge of a bed is leaf,
 *     then leaf with a few heads in it, then the bed — never a hard rectangle of colour.
 *  3. The colours are the palette's own creams, straws and dusty roses pulled towards
 *     `wallA`, not saturated primaries. A flower is a light value against the green, not a
 *     hue competing with it.
 *
 * THE PAINTED PIPELINE. Every mesh here is built with render/painted.js's own builders
 * (PB / pv / pq / pcyl / finishPainted) and its palette helpers, and the fragment shader is
 * painted.js's matte path — the same base/lit/mid/shade construction, the same object-space
 * paint grain, the same `paint()` ramp and `aerial()`. What it cannot use verbatim is
 * `createPaintedMaterial()`: PAINTED_VS reads the object transform out of `modelMatrix`, and
 * two thousand flowers cannot be two thousand draw calls. So the vertex shader is the
 * instanced twin of PAINTED_VS — same varyings, same conventions — and the per-vertex `vmat`
 * channel carries which PART of a plant a vertex is instead of which of painted.js's seven
 * looks it takes, since all of them are matte. That is written down here rather than in
 * painted.js because painted.js is shared and this convention is local.
 *
 * COST. One draw call per silhouette (three), instanced, no shadow casting (a 0.5 m plant
 * casts a shadow smaller than one shadow-map texel), and three culls before any real work:
 * chunks outside the ring never enter a buffer, and inside the vertex shader an instance is
 * rejected on distance and then on the same view cone the grass uses, in about eight
 * instructions, before it is transformed or the wind is sampled.
 */

import {
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  RawShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { vertHead, fragHead, GL_HASH, GL_NOISE, GL_SHADOW, GL_LIGHT, glCloudField } from '../core/glsl.js';
import { C, biomeTintArrays } from '../core/palette.js';
import { PB, pv, pq, pt3, pcyl, finishPainted, LC, tint, mixc } from './painted.js';
import { sharedUniforms } from './uniforms.js';
import { GL_WIND, windUniforms } from './wind.js';
import { TAU, clamp, hash2i, rng } from '../core/math.js';
import { FLOWER_SPECIES, flowerBudget } from '../world/scatter.js';

/* Must match whatever renders the cloud-shadow map into uCloudSh — render/terrainMaterial.js
 * and render/trees.js both use 9200 m. A flower lit by a different cloud than the grass it
 * is standing in is very visible at this range. */
const CLOUD_SHADOW_SPAN = 9200;

/**
 * How far flowers are drawn. Two things pin this number and they pull in opposite
 * directions. Below it, a bed you are driving towards must already be there — 190 m is about
 * two seconds at a fast cruise and ten at a cozy one, and the size fade means it grows in
 * rather than appearing. Above it, world/scatter.js only emits flowers on level-0 nodes, and
 * the streamer guarantees those out to nodeSize(1) * SPLIT_FACTOR = 217 m. Going past that
 * would draw a hard, moving circular edge where the ground stops carrying flowers.
 */
const CULL = 190;
/** Where instances start shrinking, so nothing ever pops in at the ring. */
const FADE_FROM = 128;

/** The per-vertex channel. Not painted.js's MAT — see the file header. */
const FMAT = { FOLIAGE: 0, PETAL: 1, EYE: 2 };

/* ── the palette of a meadow ─────────────────────────────────────────────────
 * Five species, all pulled a long way towards the wall cream so they read as light values
 * rather than hues. The last one is the spire, and it is the only one allowed to be a real
 * colour — one tall lavender spike per bed is punctuation. */
/* A flower reads as a LIGHT VALUE against the green, not as a hue — so these are checked
 * against the foliage they stand in rather than picked by name. Relative luminance: the
 * grass and ground palette run 0.05–0.13, and every species below is 0.34–0.58, i.e. three
 * to nine times as bright. The first draft had the lupin at 0.15 and it read as a dark spike
 * — a shadow, not a flower — which is what happens when you choose a colour by its name. */
const SPECIES = [
  LC('wallA'), // 0 — ox-eye daisy: warm white
  mixc(LC('windowGlow'), LC('wallA'), 0.6), // 1 — buttercup, well off full yellow
  mixc(LC('roofA'), LC('wallA'), 0.62), // 2 — dog rose: dusty pink
  mixc(LC('cloudUnder'), LC('wallA'), 0.42), // 3 — scabious: grey-lilac
  mixc(mixc(LC('cloudUnder'), LC('skyUpper'), 0.34), LC('wallA'), 0.45), // 4 — lupin spire
];

/* Foliage. Straight out of the grass palette so a plant standing in the sward is the same
 * family of greens as the sward — except the tuft, which is deliberately a touch silver so
 * ground cover reads as a DIFFERENT plant and not as bald grass. */
const F_STEM = mixc(LC('gMid'), LC('gLow'), 0.35);
const F_LEAF = LC('gPatchB');
const F_TUFT = mixc(LC('gPatchA'), LC('mist'), 0.2);
const F_EYE = tint(LC('gDry'), 1.06);

/* Nominal heights, metres. These go to the shader as uStemH: the wind lean is normalised by
 * it, so it has to match the mesh or a daisy whips like a sapling. The sward around them is
 * ~0.35 m of hay with tussocks to 0.8 m (render/grass.js), which is why the daisy is an
 * ox-eye at half a metre and not a lawn daisy at eight centimetres — anything shorter is
 * simply not visible from a car. */
export const FLOWER_ARCH = {
  daisy: { h: 0.55, flex: 1.0 },
  spire: { h: 0.9, flex: 1.35 },
  tuft: { h: 0.26, flex: 0.5 },
};

const KINDS = Object.keys(FLOWER_ARCH);

/* ── geometry ────────────────────────────────────────────────────────────────
 * Everything is built once, at metre scale, with the root at the origin.
 *
 * The head is a scalloped fan and not a ring of modelled petals, for the reason the grass
 * shader gives about sub-pixel detail: a 9 cm flower head at 20 m is under three pixels
 * across, and five separately modelled petals at three pixels do not read as five petals,
 * they read as noise that crawls when the camera moves. Alternating the fan's radius gives
 * the scalloped SILHOUETTE — which does survive at three pixels — for eight triangles.
 */

/** One flower head: a shallow cup with a scalloped rim and a warm eye. */
function addHead(M, cx, cy, cz, r, lobes, tiltX, tiltZ, col) {
  const ct = Math.cos(tiltX);
  const st = Math.sin(tiltX);
  const cz2 = Math.cos(tiltZ);
  const sz2 = Math.sin(tiltZ);
  // Tilt the whole head off vertical; a bed where every face points at the sky is a
  // pincushion. Two small rotations, applied to points and normals alike.
  const P = (x, y, z) => {
    const y1 = y * ct - z * st;
    const z1 = y * st + z * ct;
    const x2 = x * cz2 - y1 * sz2;
    const y2 = x * sz2 + y1 * cz2;
    return [cx + x2, cy + y2, cz + z1];
  };
  const n = P(0, 1, 0);
  const nx = n[0] - cx;
  const ny = n[1] - cy;
  const nz = n[2] - cz;
  const c0 = P(0, 0, 0);
  const eye = pv(M, c0[0], c0[1], c0[2], nx, ny, nz, F_EYE, FMAT.EYE);
  const ring = [];
  for (let i = 0; i < lobes * 2; i++) {
    const a = (i / (lobes * 2)) * TAU;
    // Alternating radius: the long points are petal tips, the short ones the notches
    // between them. The rim also drops a little, so the head is a cup and catches the sun
    // on one side.
    const rr = i % 2 === 0 ? r : r * 0.62;
    const p = P(Math.cos(a) * rr, -r * 0.18, Math.sin(a) * rr);
    ring.push(pv(M, p[0], p[1], p[2], nx, ny, nz, col, FMAT.PETAL));
  }
  for (let i = 0; i < ring.length; i++) pt3(M, eye, ring[i], ring[(i + 1) % ring.length]);
}

/**
 * A leaf: a tapered strip that rises out of the crown and flops over at the tip. Three rows,
 * two quads — the fourth row cost as many triangles again for a curve nobody can resolve at
 * the range these are seen from.
 */
function addLeaf(M, ang, y0, len, wide, rise, col) {
  const dx = Math.cos(ang);
  const dz = Math.sin(ang);
  const px = -dz * 0.5;
  const pz = dx * 0.5;
  const pts = [];
  for (let i = 0; i <= 2; i++) {
    const t = i / 2;
    const w = wide * (1 - t) * (0.4 + 1.4 * t); // broad at the base, pointed at the tip
    const y = y0 + rise * (t * 1.5 - t * t * 1.1);
    pts.push([
      [dx * len * t + px * w, y, dz * len * t + pz * w],
      [dx * len * t - px * w, y, dz * len * t - pz * w],
    ]);
  }
  const rows = pts.map((pair) => {
    // A leaf is lit as a broad surface, so both edges share the blade's own normal rather
    // than a face normal — otherwise the fold down the middle reads as a crease of shadow.
    const n = [-dz * 0.25, 0.94, dx * 0.25];
    return [
      pv(M, pair[0][0], pair[0][1], pair[0][2], n[0], n[1], n[2], col, FMAT.FOLIAGE),
      pv(M, pair[1][0], pair[1][1], pair[1][2], n[0], n[1], n[2], col, FMAT.FOLIAGE),
    ];
  });
  for (let i = 0; i < rows.length - 1; i++) pq(M, rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]);
}

/* Petals are built WHITE. The drift's colour arrives per instance and the vertex shader
 * multiplies it in, so anything but 1.0 here would be applied twice — a cream daisy would
 * come out at half its intended value and a pink one at a third. The one that is NOT
 * multiplied is the eye, which is why that one carries a real colour. */
const PETAL_BASE = [1, 1, 1];

/** Build one silhouette. `seed` fixes the arrangement — the same for every instance. */
function makeFlower(kind, seed) {
  const M = PB();
  const r = rng(seed >>> 0);
  const A = FLOWER_ARCH[kind];

  if (kind === 'daisy') {
    const heads = 4;
    for (let i = 0; i < heads; i++) {
      const a = (i / heads) * TAU + r() * 1.1;
      const off = 0.035 + r() * 0.07;
      const h = A.h * (0.62 + r() * 0.38);
      const lean = 0.05 + r() * 0.1;
      const tipX = Math.cos(a) * (off + lean);
      const tipZ = Math.sin(a) * (off + lean);
      pcyl(M, [Math.cos(a) * off * 0.3, 0, Math.sin(a) * off * 0.3], [tipX, h, tipZ], 0.007, 0.005, 3, F_STEM, FMAT.FOLIAGE);
      addHead(M, tipX, h + 0.012, tipZ, 0.042 + r() * 0.016, 5, (r() - 0.5) * 0.7, (r() - 0.5) * 0.7, PETAL_BASE);
    }
    for (let i = 0; i < 3; i++) addLeaf(M, (i / 3) * TAU + r(), 0.01, 0.13 + r() * 0.05, 0.045, 0.05, F_LEAF);
  } else if (kind === 'spire') {
    // One tall stem carrying a column of small bells, densest low down and opening upward:
    // the shape of every lupin and foxglove, and it reads at a hundred metres as a vertical
    // stroke of colour, which is exactly what a meadow wants one of.
    const h = A.h;
    pcyl(M, [0, 0, 0], [0.03, h, 0.02], 0.011, 0.006, 3, F_STEM, FMAT.FOLIAGE);
    const bells = 8;
    for (let i = 0; i < bells; i++) {
      const t = i / (bells - 1);
      const a = i * 2.399; // golden angle, the way a raceme actually spirals
      const rr = 0.036 * (1 - t * 0.55);
      const y = h * (0.42 + 0.55 * t);
      addHead(M, Math.cos(a) * rr * 0.7 + 0.03 * t, y, Math.sin(a) * rr * 0.7 + 0.02 * t, rr, 3, 1.15, a * 0.3, PETAL_BASE);
    }
    for (let i = 0; i < 3; i++) addLeaf(M, (i / 3) * TAU + r(), 0.01, 0.15 + r() * 0.05, 0.04, 0.07, F_LEAF);
  } else {
    // Ground cover: a low rosette of soft leaves and a couple of spent seed stems. No
    // flower. Half of what the scatter emits is this, and it is what makes a bed sit IN the
    // meadow instead of on top of it.
    // It has to clear the sward to exist at all: render/grass.js grows a hay meadow at
    // ~0.35 m with tussocks to twice that, and the first draft of this rosette topped out at
    // 12 cm, which is a lot of triangles to bury in grass.
    const n = 6;
    for (let i = 0; i < n; i++) {
      addLeaf(M, (i / n) * TAU + r() * 0.5, 0.005, 0.17 + r() * 0.08, 0.07, 0.13 + r() * 0.07, F_TUFT);
    }
  }
  return M;
}

/** Bake a painted builder into an INSTANCED geometry. */
function instanced(M) {
  const g0 = finishPainted(M);
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', g0.getAttribute('position'));
  g.setAttribute('nrm', g0.getAttribute('nrm'));
  g.setAttribute('vcol', g0.getAttribute('vcol'));
  g.setAttribute('vmat', g0.getAttribute('vmat'));
  g.setIndex(g0.getIndex());
  return g;
}

/* ── shaders ─────────────────────────────────────────────────────────────────── */

const glv3 = (c) => `vec3(${c[0].toFixed(4)},${c[1].toFixed(4)},${c[2].toFixed(4)})`;

/** Species colours and the biome foliage tints, as GLSL constant arrays. */
function glslTables() {
  const t = biomeTintArrays();
  const fol = [];
  for (let i = 0; i < t.count; i++) {
    fol.push(glv3([t.foliage[i * 3], t.foliage[i * 3 + 1], t.foliage[i * 3 + 2]]));
  }
  return /* glsl */ `
const int NSPEC = ${FLOWER_SPECIES};
const vec3 SPECIES[${FLOWER_SPECIES}] = vec3[${FLOWER_SPECIES}](${SPECIES.map(glv3).join(',')});
const int NFOL = ${t.count};
const vec3 B_FOLIAGE[${t.count}] = vec3[${t.count}](${fol.join(',')});
`;
}

/* The instanced twin of painted.js's PAINTED_VS. Same varyings and the same object-space
 * `vL`, so the fragment shader below is painted.js's matte path unchanged. */
const FLOWER_VS = /* glsl */ `
uniform float uStemH;    // nominal height of this silhouette, metres
uniform float uFlex;     // how loosely it moves: a tuft barely does, a spire whips
uniform vec2  uRing;     // x = where the size fade starts, y = the cull radius
/* THE ANGULAR SIZE FLOOR, in radians of screen per pixel times the pixels a flower must keep.
 *
 * Grass has had one of these since it was written — the max against dist * uLodB.x in
 * render/grass.js — and flowers never did, which is the whole of B37: at the 190 m cull a flower
 * subtends about 0.6 px on a 720 px viewport, and a sub-pixel white petal against green does not
 * dim — it flickers on and off as the sample point moves, which is the speckle the operator sees
 * crawling over far hillsides.
 *
 * Same rule, same source of truth: main.js hands both layers (camera.fov * DEG) / innerHeight, so
 * a resize or a field-of-view change moves grass and flowers together. Zero disables it, which is
 * what a tool measuring the BEFORE state sets. */
uniform float uPixFloor;
/* The width the flower geometry is BUILT at, in metres — everything is modelled at metre scale
 * with the root at the origin (see buildFlower), and a head is about 12 cm across. Named rather
 * than inlined so the floor above reads as a ratio of like for like. */
const float FLOWER_REF_W = 0.12;
in vec3 nrm; in vec3 vcol; in float vmat;
in vec4 iPos;            // xyz = root on the ground, w = scale
in vec4 iVar;            // yaw, species, phase, biome
out vec3 vW; out vec3 vN; out vec3 vC; out vec3 vL; out float vM; out float vDist;
void degenerate(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }

void main(){
  // Three rejections before anything is transformed. Distance first because it is one dot
  // product, then the same ground-plane view cone render/grass.js culls blades against —
  // more than half of every ring is behind the camera and this is what stops us paying for
  // it. Instances within about six metres are exempt: at that range the plant's own width
  // subtends more than the cone's pad.
  vec2 toB = iPos.xz - uCamPos.xz;
  float d2 = dot(toB, toB);
  float invD = inversesqrt(max(d2, 1e-4));
  float dist = d2 * invD;
  if(dist > uRing.y){ degenerate(); return; }
  if(d2 > 40.0 && dot(toB, uCull.xy)*invD < uCull.z){ degenerate(); return; }
  float fade = 1.0 - smoothstep(uRing.x, uRing.y, dist);
  if(fade < 0.02){ degenerate(); return; }

  // Shrink out rather than pop out. The floor of 0.4 matters: a plant that reaches zero
  // size is invisible for the last few metres of the ring anyway, and starting the shrink
  // from 1.0 makes the whole far field visibly breathe as the car moves.
  float sc = iPos.w * (0.4 + 0.6*fade);
  /* ...and then never smaller than the floor. uPixFloor is radians-per-pixel times the pixels to
   * hold, so dist times uPixFloor is the world width that subtends them at this range; dividing by
   * the plant's own built width turns that into the scale it needs. FLOWER_REF_W is the width the
   * geometry is built at (metre scale, root at the origin — see buildFlower), so this is a ratio
   * of like for like rather than a fudge factor. Applied as a max, so nothing NEAR the camera is
   * touched: the floor only ever bites once a plant is small enough to sparkle. */
  sc = max(sc, dist * uPixFloor / FLOWER_REF_W);
  float rot = iVar.x;
  float ca = cos(rot), sa = sin(rot);
  vec3 lp = position * sc;
  vec3 p  = vec3(lp.x*ca - lp.z*sa, lp.y, lp.x*sa + lp.z*ca);
  vec3 n  = vec3(nrm.x*ca - nrm.z*sa, nrm.y, nrm.x*sa + nrm.z*ca);

  // The same wind field the grass and the trees read, so a gust crosses all three at once.
  // A stem is a cantilever: lean goes as the square of the height, which is what makes the
  // head swing while the rosette at the foot stays put.
  vec4 W = windSample(iPos.xz - uWindLag);
  float H = max(uStemH * sc, 0.02);
  vec2 wv = W.rg * windProfile(H * 0.7);
  float ph = iVar.z;
  float f0 = 1.05 + 0.85*fract(ph*0.31831);
  float osc = sin(uTime*6.2831853*f0 + ph);
  float bend = (length(wv)*0.085 + (W.a*0.42 + max(W.b-1.0, 0.0)*0.55)*0.16*osc) * uFlex;
  bend = clamp(bend, -0.5, 0.6);
  vec2 bd = normalize(wv + vec2(1e-5));
  float yn = clamp(p.y / H, 0.0, 1.3);
  p.xz += bd * (bend * yn*yn * H * 0.55);
  p.y  -= bend*bend * yn*yn * H * 0.2;

  int spec = clamp(int(iVar.y + 0.5), 0, NSPEC-1);
  vec3 fol = B_FOLIAGE[clamp(int(iVar.w + 0.5), 0, NFOL-1)];
  // A petal takes the drift's colour; leaf and stem keep the palette green they were built
  // with. The biome tint lands on both, but only half strength on a petal — a cream daisy
  // in the highlands should cool down, not turn into a highland leaf.
  vec3 c = vcol * (vmat > 0.5 && vmat < 1.5 ? SPECIES[spec] : vec3(1.0));
  vC = c * mix(vec3(1.0), fol, vmat > 0.5 && vmat < 1.5 ? 0.5 : 1.0);

  vec3 wp = iPos.xyz + p;
  vW = wp; vN = normalize(n); vM = vmat;
  // Object space for the paint grain, offset per instance so two thousand plants do not
  // share one brush stroke.
  vL = position + vec3(ph*0.37);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/* painted.js's matte path, verbatim in structure: the same base grain, the same three-stop
 * lit/mid/shade construction, the same paint() and aerial(). The two additions are both
 * about petals — they are thin, so they transmit, and they are the one thing in the frame
 * that should catch a low sun from behind. */
const FLOWER_FS = /* glsl */ `
in vec3 vW; in vec3 vN; in vec3 vC; in vec3 vL; in float vM; in float vDist;
out vec4 outColor;
void main(){
  vec3 N = normalize(vN);
  // Every surface here is a single-sided sheet — a petal, a leaf — and half of them are
  // seen from below.
  if(!gl_FrontFacing) N = -N;
  vec3 V = normalize(uCamPos - vW);
  float petal = (vM > 0.5 && vM < 1.5) ? 1.0 : 0.0;
  float eye   = step(1.5, vM);

  vec3 base = vC;
  float g = pn2(vL.xz*4.3 + vL.y*3.7)*0.5+0.5;
  base *= 0.92 + 0.16*g;

  vec3 lit = base*1.12;
  vec3 mid = mix(base*0.76, K_AMB_SKY*0.22, 0.16);
  vec3 shd = mix(base*0.40, K_SHADOW*0.60, 0.44);
  // A white petal must not go grey in shadow — it goes cool and stays light, or the bed
  // turns into gravel the moment a cloud crosses it.
  shd = mix(shd, mix(base*0.66, K_AMB_SKY*0.30, 0.34), petal);
  lit = mix(lit, base*1.24 + K_SUN*0.06, petal*0.8);

  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vW, ndl) * cloudShadow(vW);
  Surf s;
  s.N=N; s.V=V; s.P=vW; s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = mix(0.08, 0.19, clamp(vDist*0.006, 0.0, 1.0));
  s.jit  = (vn2(vL.xz*3.9 + vL.y*1.7) - 0.5)*0.055;
  s.shadow = sh;
  s.trans  = mix(0.45, 1.25, petal);
  s.transCol = mix(${C.cTrans}, ${C.gTrans}, petal*0.5);
  s.rim = mix(0.30, 0.66, petal);
  s.ao = mix(0.86, 1.0, petal + eye);
  s.ambient = 1.0;
  vec3 col = paint(s);
  // the warm centre, kept bright enough to read as one dot at ten metres
  col = mix(col, col*1.18 + K_SUN*0.10, eye);
  col = aerial(col, vDist, V, vW.y);
  outColor = vec4(SAFE3(col), gFogAmt);
}`;

function flowerMaterial(kind, ring, pixFloor) {
  const A = FLOWER_ARCH[kind];
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(
      Object.assign(
        {
          uStemH: { value: A.h },
          uFlex: { value: A.flex },
          uRing: { value: ring },
          // The SHARED object, not a copy — one write in setAngular has to reach all three
          // materials, the same reason `ring` is shared. Defaults to 0, i.e. no floor at all,
          // which is exactly the old behaviour and is what a tool sets to measure the BEFORE.
          uPixFloor: pixFloor ?? { value: 0 },
        },
        windUniforms()
      )
    ),
    vertexShader: vertHead(GL_HASH, GL_NOISE, GL_WIND, glslTables(), FLOWER_VS),
    fragmentShader: fragHead(GL_HASH, GL_NOISE, glCloudField({ cshSpan: CLOUD_SHADOW_SPAN }), GL_SHADOW, GL_LIGHT, FLOWER_FS),
    // Petals and leaves are single sheets and are lit from behind on purpose.
    side: DoubleSide,
  });
}

/* ── the scene-side manager ─────────────────────────────────────────────────── */

/**
 * Every flower and tuft in the world, as three instanced draws.
 *
 * The bookkeeping is deliberately plainer than render/trees.js's. Flora's block-and-
 * copyWithin scheme exists because a tree chunk can be 256 m across and there can be
 * hundreds of them live; flowers only exist within one ring of level-0 nodes, which is at
 * most a few dozen chunks and a couple of thousand instances. Rebuilding all three buffers
 * from scratch whenever the visible set changes is a few tens of microseconds of typed-array
 * copying — cheaper than the code that would avoid it, and impossible to get subtly wrong.
 */
export class Flowers {
  /**
   * @param {object} opts
   * @param {number} opts.seed world seed — must match the scatter's
   * @param {import('three').Object3D} opts.parent what to hang the meshes off
   * @param {number} [opts.quality] 1 = full; scales the ring
   * @param {number} [opts.cullDistance] metres
   */
  constructor({ seed, parent, quality = 1, cullDistance = CULL }) {
    this.seed = seed >>> 0;
    this.quality = clamp(quality, 0.4, 2);
    this.cull = Math.min(cullDistance * clamp(this.quality, 0.6, 1.15), CULL);
    this.fadeFrom = Math.min(FADE_FROM, this.cull * 0.68);

    this.group = new Object3D();
    this.group.name = 'flowers';
    this.group.matrixAutoUpdate = false;
    parent.add(this.group);

    /** chunk key -> { mx, mz, vis, kinds: Map(kind -> {pos, vari, n}) } */
    this.chunks = new Map();
    /** kind -> batch */
    this.batches = new Map();
    this._dirty = false;
    this._cam = new Vector3();
    this._hasCam = false;
    this.stats = { chunks: 0, visible: 0, instances: 0, tris: 0, buildMs: 0 };

    // One ring vector shared by all three materials: changing the cull distance at runtime
    // then costs one write instead of three.
    this._ring = new Vector2(this.fadeFrom, this.cull);
    /* THE ANGULAR FLOOR, shared the same way the ring is. Grass has carried one since it was
     * written; flowers never did, and that is B37 — see uPixFloor in the shader. It starts at 0
     * (no floor, exactly the old behaviour) and main.js sets it from the live camera, so a build
     * that forgets to call setAngular looks like it always did rather than silently different. */
    this._pixFloor = { value: 0 };
    for (const kind of KINDS) this._batch(kind);
  }

  /**
   * Radians of vertical field of view per screen pixel — the same number main.js hands
   * `grass.setAngular`, so the two layers hold their far detail to one rule and a resize moves
   * both. `px` is how many pixels wide the smallest flower may be; 1.5 rather than 1.0 because a
   * white petal against green is a high-contrast sample and starts to twinkle before it is
   * technically sub-pixel — measured on hillsides at 130-190 m, which is where the operator saw it.
   */
  setAngular(angPerPx, px = 1.5) {
    this._pixFloor.value = angPerPx * px;
    return this;
  }

  _batch(kind) {
    let b = this.batches.get(kind);
    if (b) return b;
    const geom = instanced(makeFlower(kind, hash2i(KINDS.indexOf(kind) + 1, 7, 0x62100d)));
    // One level-0 node at the densest the world gets, so a drive through a meadow does not
    // reallocate on every chunk.
    const cap = Math.max(128, flowerBudget());
    const iPos = new Float32Array(cap * 4);
    const iVar = new Float32Array(cap * 4);
    const aPos = new InstancedBufferAttribute(iPos, 4);
    const aVar = new InstancedBufferAttribute(iVar, 4);
    aPos.setUsage(DynamicDrawUsage);
    aVar.setUsage(DynamicDrawUsage);
    geom.setAttribute('iPos', aPos);
    geom.setAttribute('iVar', aVar);
    geom.instanceCount = 0;
    // Instances are absolute world metres and the set is a disc centred on the camera, so
    // there is no bounding volume three could usefully cull against — every batch would
    // always intersect the frustum. Culling is ours: per chunk on the CPU, per instance
    // against uCull in the vertex shader.
    geom.boundingSphere = new Sphere(new Vector3(), 1e6);

    const mesh = new Mesh(geom, flowerMaterial(kind, this._ring, this._pixFloor));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.renderOrder = 3; // after the terrain and the trees, before the grass rings
    mesh.visible = false;
    this.group.add(mesh);

    const tri = geom.getIndex().count / 3;
    b = { kind, geom, mesh, iPos, iVar, aPos, aVar, cap, count: 0, tri };
    this.batches.set(kind, b);
    return b;
  }

  /**
   * Take one chunk's flower list.
   *
   * @param {string} key   the caller's own chunk key — Flora already has one, and two
   *                       modules inventing the same key format is how they drift apart
   * @param {object[]} list `scatterChunk(...).flowers`, which is empty above level 0
   * @param {number} mx    chunk centre, world x
   * @param {number} mz    chunk centre, world z
   */
  add(key, list, mx, mz) {
    if (!list || !list.length) return;
    if (this.chunks.has(key)) return;
    const kinds = new Map();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      let g = kinds.get(p.kind);
      if (!g) {
        g = { pos: [], vari: [] };
        kinds.set(p.kind, g);
      }
      // Sway phase is a property of the PLACE, not of the build order — the same reasoning
      // as Flora's, and for the same reason: a chunk that is rebuilt must not re-shuffle the
      // rhythm of the bed it contains.
      const phase = (hash2i(Math.round(p.x * 8), Math.round(p.z * 8), this.seed) / 4294967296) * 10;
      // Sunk a little: a rosette of leaves on a slope would otherwise show daylight under
      // its uphill side.
      g.pos.push(p.x, p.y - 0.04 * p.scale, p.z, p.scale);
      g.vari.push(p.yaw, p.species, phase, p.biome);
    }
    // Deliberately not marking dirty here: the chunk goes in as invisible and the next
    // update's ring pass is what flips it and asks for the rebuild. A chunk that streams in
    // beyond the ring — which happens every time the tree cull ring is wider than this one —
    // then costs nothing at all until you drive towards it.
    this.chunks.set(key, { mx, mz, vis: false, kinds });
    this.stats.chunks = this.chunks.size;
  }

  /** Call from the streamer's release path. Safe for a chunk that never had flowers. */
  remove(key) {
    const c = this.chunks.get(key);
    if (!c) return;
    this.chunks.delete(key);
    this.stats.chunks = this.chunks.size;
    if (c.vis) this._dirty = true;
  }

  /** @param {import('three').Vector3} camPos */
  update(camPos) {
    if (camPos) {
      this._cam.copy(camPos);
      this._hasCam = true;
    }
    if (!this._hasCam) return;
    const t0 = performance.now();
    // A chunk is 64 m across, so its corner reaches sqrt(2)/2 * 64 = 45 m past its centre.
    const reach = this.cull + 46;
    let visible = 0;
    for (const c of this.chunks.values()) {
      const vis = Math.hypot(c.mx - this._cam.x, c.mz - this._cam.z) <= reach;
      if (vis !== c.vis) {
        c.vis = vis;
        this._dirty = true;
      }
      if (vis) visible++;
    }
    this.stats.visible = visible;
    if (this._dirty) this._rebuild();
    this.stats.buildMs = performance.now() - t0;
  }

  _rebuild() {
    this._dirty = false;
    for (const b of this.batches.values()) b.count = 0;
    // Two passes: size every batch first, so a growing meadow reallocates once instead of
    // once per chunk.
    for (const c of this.chunks.values()) {
      if (!c.vis) continue;
      for (const [kind, g] of c.kinds) {
        const b = this.batches.get(kind);
        if (b) b.count += g.pos.length / 4;
      }
    }
    for (const b of this.batches.values()) {
      if (b.count > b.cap) {
        let cap = b.cap;
        while (cap < b.count) cap *= 2;
        b.iPos = new Float32Array(cap * 4);
        b.iVar = new Float32Array(cap * 4);
        b.aPos = new InstancedBufferAttribute(b.iPos, 4);
        b.aVar = new InstancedBufferAttribute(b.iVar, 4);
        b.aPos.setUsage(DynamicDrawUsage);
        b.aVar.setUsage(DynamicDrawUsage);
        b.geom.setAttribute('iPos', b.aPos);
        b.geom.setAttribute('iVar', b.aVar);
        b.cap = cap;
      }
      b.count = 0;
    }
    for (const c of this.chunks.values()) {
      if (!c.vis) continue;
      for (const [kind, g] of c.kinds) {
        const b = this.batches.get(kind);
        if (!b) continue;
        b.iPos.set(g.pos, b.count * 4);
        b.iVar.set(g.vari, b.count * 4);
        b.count += g.pos.length / 4;
      }
    }
    let total = 0;
    let tris = 0;
    for (const b of this.batches.values()) {
      b.geom.instanceCount = b.count;
      b.mesh.visible = b.count > 0;
      b.aPos.needsUpdate = true;
      b.aVar.needsUpdate = true;
      total += b.count;
      tris += b.count * b.tri;
    }
    this.stats.instances = total;
    this.stats.tris = tris;
  }

  dispose() {
    for (const b of this.batches.values()) {
      this.group.remove(b.mesh);
      b.geom.dispose();
      b.mesh.material.dispose();
    }
    this.batches.clear();
    this.chunks.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
