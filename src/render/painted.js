/* Wanderoad — the "painted solid" pipeline.
 *
 * Ported from the Hoshi-no-Tani pen (PB / pv / pq / pt3 / rotY / pbox / pcyl / proof /
 * finishPainted / PAINTED_VS / PAINTED_FS, hoshi.html:3543-3683). This is how EVERY
 * hand-modelled object in the pen gets its look: the village, the mill, the locomotive,
 * the fences. One builder accumulates plain JS arrays, one call bakes them into a
 * BufferGeometry, one RawShaderMaterial draws the lot.
 *
 * The trick worth understanding before you use it: colour is a per-vertex attribute and
 * the material index is a per-vertex attribute, so a whole village — dozens of buildings,
 * four roof colours, lit windows, glass, timber — is ONE geometry and ONE draw call. Do
 * not build a mesh per object. Build one M, throw everything at it, finishPainted(M).
 *
 * Two deliberate changes from the pen, both flagged at the site:
 *   1. the paint grain and the band-edge jitter are sampled in OBJECT space, not world
 *      space (the pen's painted objects never moved; the car does);
 *   2. material slots 4-6 are new — dynamic emissive channels, for lamps that switch on
 *      and off. The pen had nothing that switched.
 */

import {
  RawShaderMaterial, BufferGeometry, BufferAttribute, DoubleSide, Vector3,
  CustomBlending, AddEquation, SrcAlphaFactor, OneMinusSrcAlphaFactor, ZeroFactor, OneFactor,
} from 'three';
import { vertHead, fragHead, GL_HASH, GL_NOISE, GL_SHADOW, GL_LIGHT, glCloudField, DEPTH_FS } from '../core/glsl.js';
import { RGB } from '../core/palette.js';
import { sharedUniforms } from './uniforms.js';
import { TAU, lerp } from '../core/math.js';

/* ── the material-index convention ─────────────────────────────────────────────
 * The `mat` argument every builder takes. It rides on the mesh as a per-vertex float
 * (`vmat`) and the fragment shader branches on it, so one material draws all seven
 * looks. Slots 0-3 are the pen's, unchanged and in the pen's order — a geometry built
 * by the pen's own code would still shade correctly here.
 */
export const MAT = {
  /** 0 — matte: plaster, thatch, timber, rubber, unpainted anything. The base ramp. */
  MATTE: 0,
  /** 1 — painted metal: tighter bands and a hot rim. Loco boiler, car bodywork. */
  METAL: 1,
  /** 2 — self-lit: a window at golden hour. Unshaded, unfogged, slow flicker. */
  EMIT: 2,
  /** 3 — glass / dark opening: sky-tinted lit band, fierce fresnel rim. */
  GLASS: 3,
  /** 4 — lamp on channel A (`uLamp.x`): off = a dead lens, on = a light source. */
  LAMP_A: 4,
  /** 5 — lamp on channel B (`uLamp.y`). */
  LAMP_B: 5,
  /** 6 — lamp on channel C (`uLamp.z`). Brake discs; glows from dull metal to cherry. */
  LAMP_C: 6,
  /**
   * 7 — coach paint: a car body panel, and the only surface in the game whose COLOUR is
   * the subject rather than the light on it. MATTE and METAL both trade chroma for air —
   * MATTE mixes flat sky into its mid band, METAL puts a hot rim on everything — and on a
   * whole body shell either one reads as the paint having been watered down. This slot
   * keeps the hue through all three bands. Bodywork only: a plaster wall painted with it
   * would look like plastic.
   */
  BODY: 7,
};

/* ── colour helpers ────────────────────────────────────────────────────────────
 * Linear rgb triples, because that is what the shader wants and converting per vertex
 * would be absurd. LC() hands back palette.js's own array — read it, never write it;
 * tint() and mixc() both return fresh arrays. */

/** Linear triple for a palette key. Shared array: treat as immutable. */
export const LC = (k) => RGB[k];
/** Scale a linear triple — the pen's way of getting a family of related shades. */
export const tint = (c, f) => [c[0] * f, c[1] * f, c[2] * f];
/** Blend two linear triples. */
export const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ── the builder ───────────────────────────────────────────────────────────────
 * Plain arrays, pushed at. No typed arrays until finishPainted: a builder does not know
 * how big it will get, and Array.push into a JIT'd number array is faster than growing
 * and copying Float32Arrays.
 */

/** A fresh painted-mesh builder. */
export function PB() {
  return { pos: [], nrm: [], col: [], mat: [], idx: [], n: 0 };
}

/** Push one vertex; returns its index. `c` is a linear rgb triple, `m` a MAT slot. */
export function pv(M, x, y, z, nx, ny, nz, c, m) {
  M.pos.push(x, y, z);
  M.nrm.push(nx, ny, nz);
  M.col.push(c[0], c[1], c[2]);
  M.mat.push(m || 0);
  return M.n++;
}

/** Two triangles from four existing indices, in ring order. */
export function pq(M, a, b, c, d) {
  M.idx.push(a, b, c, a, c, d);
}

/** One triangle from three existing indices. */
export function pt3(M, a, b, c) {
  M.idx.push(a, b, c);
}

/** Rotate (x,z) about the Y axis by an angle whose cos/sin are already known. */
export function rotY(x, z, ca, sa) {
  return [x * ca - z * sa, x * sa + z * ca];
}

/**
 * An axis-aligned box, yawed about Y, centred on (cx,cy,cz) with half-extents (hx,hy,hz).
 * Every face gets its own four vertices so the normals stay flat — the whole look depends
 * on faces not sharing normals.
 */
export function pbox(M, cx, cy, cz, hx, hy, hz, yaw, col, mat) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const P = (sx, sy, sz) => {
    const [x, z] = rotY(sx * hx, sz * hz, ca, sa);
    return [cx + x, cy + sy * hy, cz + z];
  };
  const NF = (nx, nz) => {
    const [x, z] = rotY(nx, nz, ca, sa);
    return [x, 0, z];
  };
  const faces = [
    { q: [[1, -1, -1], [1, -1, 1], [1, 1, 1], [1, 1, -1]], n: NF(1, 0) },
    { q: [[-1, -1, 1], [-1, -1, -1], [-1, 1, -1], [-1, 1, 1]], n: NF(-1, 0) },
    { q: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]], n: [0, 1, 0] },
    { q: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]], n: [0, -1, 0] },
    { q: [[-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]], n: NF(0, 1) },
    { q: [[1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, -1]], n: NF(0, -1) },
  ];
  for (const f of faces) {
    const v = f.q.map((s) => {
      const p = P(s[0], s[1], s[2]);
      return pv(M, p[0], p[1], p[2], f.n[0], f.n[1], f.n[2], col, mat);
    });
    pq(M, v[0], v[1], v[2], v[3]);
  }
}

/**
 * A cone/cylinder between two arbitrary points, radius r0 at `a` and r1 at `b`, `seg`
 * sides. Caps are optional and get their own vertices (flat end normals). Low `seg`
 * counts are the point: a six-sided "pipe" reads as a hand-painted pipe.
 */
export function pcyl(M, a, b, r0, r1, seg, col, mat, capA, capB) {
  let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const L = Math.hypot(t[0], t[1], t[2]) || 1;
  t = [t[0] / L, t[1] / L, t[2] / L];
  let up = [0, 1, 0];
  if (Math.abs(t[1]) > 0.94) up = [1, 0, 0];
  let s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
  const sl = Math.hypot(s[0], s[1], s[2]) || 1;
  s = [s[0] / sl, s[1] / sl, s[2] / sl];
  const u = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]];
  const r0i = [], r1i = [];
  for (let i = 0; i < seg; i++) {
    const ang = (i / seg) * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
    const nx = s[0] * ca + u[0] * sa, ny = s[1] * ca + u[1] * sa, nz = s[2] * ca + u[2] * sa;
    r0i.push(pv(M, a[0] + nx * r0, a[1] + ny * r0, a[2] + nz * r0, nx, ny, nz, col, mat));
    r1i.push(pv(M, b[0] + nx * r1, b[1] + ny * r1, b[2] + nz * r1, nx, ny, nz, col, mat));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    pq(M, r0i[i], r1i[i], r1i[j], r0i[j]);
  }
  if (capB) {
    const c = pv(M, b[0], b[1], b[2], t[0], t[1], t[2], col, mat);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const p1 = pv(M, M.pos[r1i[i] * 3], M.pos[r1i[i] * 3 + 1], M.pos[r1i[i] * 3 + 2], t[0], t[1], t[2], col, mat);
      const p2 = pv(M, M.pos[r1i[j] * 3], M.pos[r1i[j] * 3 + 1], M.pos[r1i[j] * 3 + 2], t[0], t[1], t[2], col, mat);
      pt3(M, c, p1, p2);
    }
  }
  if (capA) {
    const c = pv(M, a[0], a[1], a[2], -t[0], -t[1], -t[2], col, mat);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const p1 = pv(M, M.pos[r0i[i] * 3], M.pos[r0i[i] * 3 + 1], M.pos[r0i[i] * 3 + 2], -t[0], -t[1], -t[2], col, mat);
      const p2 = pv(M, M.pos[r0i[j] * 3], M.pos[r0i[j] * 3 + 1], M.pos[r0i[j] * 3 + 2], -t[0], -t[1], -t[2], col, mat);
      pt3(M, c, p2, p1);
    }
  }
}

/** A gabled roof with an overhang; the ridge runs along local X, yawed about Y. */
export function proof(M, cx, cy, cz, hx, hz, hh, yaw, col, mat) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const P = (x, y, z) => {
    const [rx, rz] = rotY(x, z, ca, sa);
    return [cx + rx, cy + y, cz + rz];
  };
  const A = P(-hx, 0, -hz), B = P(hx, 0, -hz), Cc = P(hx, 0, hz), D = P(-hx, 0, hz);
  const E = P(-hx, hh, 0), F = P(hx, hh, 0);
  const slope = (sz) => {
    const n = [0, hz, sz * hh];
    const l = Math.hypot(n[1], n[2]) || 1;
    const [x, z] = rotY(0, n[2] / l, ca, sa);
    return [x, n[1] / l, z];
  };
  const nA = slope(-1), nB = slope(1);
  let v = [A, B, F, E].map((p) => pv(M, p[0], p[1], p[2], nA[0], nA[1], nA[2], col, mat));
  pq(M, v[0], v[1], v[2], v[3]);
  v = [D, E, F, Cc].map((p) => pv(M, p[0], p[1], p[2], nB[0], nB[1], nB[2], col, mat));
  pq(M, v[0], v[1], v[2], v[3]);
  const nE = (() => { const [x, z] = rotY(-1, 0, ca, sa); return [x, 0, z]; })();
  const nF = (() => { const [x, z] = rotY(1, 0, ca, sa); return [x, 0, z]; })();
  let t = [A, E, D].map((p) => pv(M, p[0], p[1], p[2], nE[0], nE[1], nE[2], col, mat));
  pt3(M, t[0], t[1], t[2]);
  t = [B, Cc, F].map((p) => pv(M, p[0], p[1], p[2], nF[0], nF[1], nF[2], col, mat));
  pt3(M, t[0], t[1], t[2]);
}

/* Flat normal of a triangle, or +Y if it is degenerate — a zero normal would come out of
 * paint() as pure ambient and read as a hole in the object. */
function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  return l > 1e-9 ? [nx / l, ny / l, nz / l] : [0, 1, 0];
}

/**
 * One flat triangle from three points. The pen never needed a loose triangle — every
 * shape it modelled was a box, a cylinder or a gable — but anything lofted (a car body,
 * a bridge deck) does, and its normal must come from the winding rather than be guessed.
 */
export function ptri(M, a, b, c, col, mat) {
  const n = faceNormal(a, b, c);
  const i0 = pv(M, a[0], a[1], a[2], n[0], n[1], n[2], col, mat);
  const i1 = pv(M, b[0], b[1], b[2], n[0], n[1], n[2], col, mat);
  const i2 = pv(M, c[0], c[1], c[2], n[0], n[1], n[2], col, mat);
  pt3(M, i0, i1, i2);
}

/**
 * One flat quad from four points in ring order. If `outward` (a direction, not
 * normalised) is given, the winding is corrected to face that way — hand-written vertex
 * rings get their winding backwards constantly, and a back-facing panel on a car is an
 * instant hole in the silhouette.
 */
export function pquad(M, a, b, c, d, col, mat, outward) {
  let p1 = b, p3 = d;
  let n = faceNormal(a, b, d);
  if (outward && n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2] < 0) {
    p1 = d; p3 = b;
    n = [-n[0], -n[1], -n[2]];
  }
  const i0 = pv(M, a[0], a[1], a[2], n[0], n[1], n[2], col, mat);
  const i1 = pv(M, p1[0], p1[1], p1[2], n[0], n[1], n[2], col, mat);
  const i2 = pv(M, c[0], c[1], c[2], n[0], n[1], n[2], col, mat);
  const i3 = pv(M, p3[0], p3[1], p3[2], n[0], n[1], n[2], col, mat);
  pq(M, i0, i1, i2, i3);
}

/** Bake a builder into a BufferGeometry. The builder is finished; do not reuse it. */
export function finishPainted(M) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(M.pos), 3));
  g.setAttribute('nrm', new BufferAttribute(new Float32Array(M.nrm), 3));
  g.setAttribute('vcol', new BufferAttribute(new Float32Array(M.col), 3));
  g.setAttribute('vmat', new BufferAttribute(new Float32Array(M.mat), 1));
  g.setIndex(M.idx);
  g.computeBoundingSphere();
  return g;
}

/* ── the shaders ───────────────────────────────────────────────────────────────
 * `nrm` and not `normal`: RawShaderMaterial has no built-in attributes, and three
 * reserves the name `normal` for its own bindings. The pen hit the same wall.
 */
const PAINTED_VS = /* glsl */ `
in vec3 nrm; in vec3 vcol; in float vmat;
out vec3 vW; out vec3 vN; out vec3 vC; out vec3 vL; out float vM; out float vDist;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.0);
  vW = wp.xyz; vN = normalize(mat3(modelMatrix)*nrm); vC = vcol; vM = vmat;
  vL = position;
  vec4 mv = viewMatrix*wp; vDist = -mv.z;
  gl_Position = projectionMatrix*mv;
}`;

function paintedFS(ghost) {
  // Ghosts carry their own constant alpha; everything else puts the fog amount in alpha,
  // which is the channel the post chain reads back as distance.
  const A = ghost ? 'uGhostAlpha' : 'gFogAmt';
  const A0 = ghost ? 'uGhostAlpha' : '0.0';
  return /* glsl */ `
uniform vec3 uLamp;   // x,y,z = the three switchable emissive channels, 0..1
${ghost ? 'uniform float uGhostAlpha;' : ''}
in vec3 vW; in vec3 vN; in vec3 vC; in vec3 vL; in float vM; in float vDist;
out vec4 outColor;
void main(){
  vec3 N=normalize(vN), V=normalize(uCamPos-vW);
  vec3 base = vC;
  // Grain in OBJECT space, not the pen's world space. The pen's painted objects were
  // bolted to the valley floor, so the two were the same thing; a car doing 90 m/s
  // through a world-space noise field crawls with paint-coloured static.
  float g  = pn2(vL.xz*4.3 + vL.y*3.7)*0.5+0.5;
  float g2 = pn2(vL.xz*17.0 - vL.y*9.0)*0.5+0.5;
  base *= 0.90 + 0.20*g + 0.06*g2;

  // lit / mid / shade travel along a hue path, never a brightness ramp
  vec3 lit = base*1.12;
  vec3 mid = mix(base*0.76, K_AMB_SKY*0.22, 0.16);
  vec3 shd = mix(base*0.40, K_SHADOW*0.60, 0.44);
  float rim = 0.30, ao = 1.0;

  // Upper bound as well as lower: slot 7 sits above the lamps and would otherwise be
  // decoded as lamp channel C and come out as a brake disc.
  if(vM > 3.5 && vM < 6.5){                 // switchable lamp, channels A/B/C
    float ch = vM < 4.5 ? uLamp.x : (vM < 5.5 ? uLamp.y : uLamp.z);
    vec3 dead = mix(base*0.50, K_SKY_MID*0.30, 0.35);
    vec3 hot  = base*2.6 + K_SUN*0.22;
    vec3 c = mix(dead, hot, ch);
    // An unlit lens is an object and hazes with everything else; a lamp that is ON is a
    // light source and must stay legible through the haze, so the fog is faded out with
    // the channel rather than applied flat.
    c = mix(aerial(c, vDist, V, vW.y), c, ch);
    outColor = vec4(SAFE3(c), ${A});
    return;
  }
  if(vM > 1.5 && vM < 2.5){                 // lit window
    float flick = 0.94 + 0.06*sin(uTime*2.1 + vW.x*3.1 + vW.z*1.7);
    outColor = vec4(SAFE3(base*2.4*flick + K_SUN*0.25), ${A0});
    return;
  }
  if(vM > 0.5 && vM < 1.5){                 // painted metal: crisper bands
    lit = base*1.25; mid = base*0.62;
    shd = mix(base*0.30, K_SHADOW*0.7, 0.5);
    rim = 0.62;
  }
  if(vM > 2.5 && vM < 3.5){                 // glass / dark opening
    lit = mix(base, K_SKY_MID, 0.55); mid = base*0.7; shd = base*0.42; rim = 0.75;
  }
  if(vM > 6.5){                             // coach paint — the body of a car
    /* Two measured losses are being paid back here, both of them downstream of this
     * shader and neither of them fixable downstream without regrading the whole frame
     * (numbers from tools/diag-carpaint.mjs, which walks a body fragment through this
     * shader, the tonemap and the grade and prints what the browser suite would read):
     *
     *   1. The filmic tonemap in render/post.js has a slope of ~3.8 near black and ~0.8
     *      up at 0.8, so it lifts a paint's two dark channels far harder than it
     *      compresses its bright one. A body colour that is 0.88 saturated in linear
     *      comes out of the composite at 0.42. Pushing the base away from its own
     *      luminance BEFORE the ramp is the only place that is recoverable, because
     *      everything after this point is shared with the sky and the grass.
     *   2. MATTE mixes 16% flat sky ambient into its mid band and 44% flat shadow tint
     *      into its shade band. On plaster and thatch that reads as air. Across a whole
     *      body shell it reads as the paint going grey — and on the dark chips the
     *      shadow tint simply wins, which is why an ink car and a verdigris car used to
     *      arrive at the same blue.
     *
     * Deliberately NOT metal's ramp: rim 0.62 puts a hot sun edge on every panel, which
     * is what bleached the shell when the body was drawn as METAL. 0.34 is a sheen. */
    float bl = dot(base, vec3(0.2126,0.7152,0.0722));
    vec3 deep = max(base + (base - vec3(bl))*0.30, vec3(0.0));
    lit = deep*1.18;
    mid = deep*0.74;
    shd = mix(deep*0.34, K_SHADOW*0.44, 0.22);
    rim = 0.34;
  }

  float ndl = dot(N,uSunDir);
  float sh = sunShadow(vW,ndl)*cloudShadow(vW);
  Surf s; s.N=N; s.V=V; s.P=vW; s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = mix(0.075, 0.19, clamp(vDist*0.004,0.0,1.0));
  s.jit = (vn2(vL.xz*3.9 + vL.y*1.7) - 0.5)*0.055;
  s.shadow=sh; s.trans=0.0; s.transCol=vec3(0.0);
  s.rim=${ghost ? 'rim*2.1' : 'rim'}; s.ao=ao; s.ambient=1.0;
  vec3 col=paint(s);
  ${ghost ? `
  // A ghost is a rumour of a car: keep the silhouette and the sun-side rim, let the
  // middle of every panel drift towards the sky it is standing in front of.
  float fres = pow(1.0 - clamp(dot(N,V),0.0,1.0), 2.6);
  col = mix(col*0.72 + K_SKY_MID*0.16, col + K_SUN*0.35, fres);
  ` : ''}
  col = aerial(col,vDist,V,vW.y);
  outColor = vec4(SAFE3(col), ${A});
}`;
}

// The cloud-shadow map is baked ONCE per frame for the whole scene, so every material
// that reads it must agree on its span and deck height. 9200 / 980 is what
// render/terrainMaterial.js uses; changing one without the other slides the cloud
// shadows off the objects standing in them.
const CLOUD = glCloudField({ cshSpan: 9200, cloudDeck: 980 });

/**
 * The material every painted geometry is drawn with.
 *
 *   side      — DoubleSide like the pen (thin panels and hand-wound rings are common).
 *   ghost     — the remote-player variant: constant alpha, rim-lit, sky-washed.
 *   opacity   — ghost alpha only; ignored otherwise.
 *   uniforms  — extra entries merged into the shared block.
 *
 * `uniforms.uLamp` is per-material (a Vector3, channels A/B/C in 0..1) so two cars can
 * have their headlights in different states while sharing every other uniform in the game.
 */
export function createPaintedMaterial({ side = DoubleSide, ghost = false, opacity = 0.85, uniforms = {} } = {}) {
  const extra = { uLamp: { value: new Vector3(0, 0, 0) } };
  if (ghost) extra.uGhostAlpha = { value: opacity };
  const mat = new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(Object.assign(extra, uniforms)),
    vertexShader: vertHead(PAINTED_VS),
    fragmentShader: fragHead(GL_HASH, GL_NOISE, CLOUD, GL_SHADOW, GL_LIGHT, paintedFS(ghost)),
    side,
  });
  if (ghost) {
    // Blend the colour by uGhostAlpha but leave the alpha channel alone: alpha is the
    // scene's fog/depth channel, and a ghost car must not punch its own opacity into it.
    mat.transparent = true;
    mat.depthWrite = true;
    mat.blending = CustomBlending;
    mat.blendSrc = SrcAlphaFactor;
    mat.blendDst = OneMinusSrcAlphaFactor;
    mat.blendEquation = AddEquation;
    mat.blendSrcAlpha = ZeroFactor;
    mat.blendDstAlpha = OneFactor;
    mat.blendEquationAlpha = AddEquation;
  }
  return mat;
}

/**
 * Depth-only twin for the sun shadow pass. Same vertex transform, no shading, and
 * colorWrite off — the shadow map's colour attachment is never read, and turning it off
 * lets the hardware take its double-speed depth path.
 */
export function createPaintedDepthMaterial() {
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(),
    vertexShader: vertHead(PAINTED_VS),
    fragmentShader: DEPTH_FS,
    side: DoubleSide,
    colorWrite: false,
  });
}
