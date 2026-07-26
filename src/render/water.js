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

const WATER_VS = /* glsl */ `
in vec4 wdat;      // x depth in metres, yz bed-downhill direction, w flow speed
out vec3 vW;
out vec4 vD;
out float vDist;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vD = wdat;
  vDist = length(wp.xyz - uCamPos);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FS = (axis) => /* glsl */ `
in vec3 vW;
in vec4 vD;
in float vDist;
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
float bandLimit(vec2 fw, vec2 f){ return 1.0 - smoothstep(0.28, 0.72, dot(fw, abs(f))); }

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
  vec2 w = vec2(pn2(p*0.0037 + 11.3), pn2(p*0.0037 + 41.7)) * 46.0;
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

  // Gust cells are ~32 m across at their finest, so they too stop carrying information once
  // the pixel is wider than that — and their surface darkening is the most visible aliasing
  // of the lot, because it is a contrast term rather than a colour one.
  float gust = gustAt(P.xz) * bandLimit(fw, vec2(0.031));

  // The finite differences that build the normal are sampled at the pixel footprint of their
  // OWN axis rather than at the pen's fixed 0.42 m, so each degrades into a box filter of
  // exactly the right width instead of into noise — and a grazing pixel does not drag the
  // across-axis difference out with it.
  vec2 e = max(fw, vec2(0.42));
  float h0 = ripple(q, drift, uTime, gust, fw);
  float hx = ripple(q + vec2(e.x, 0.0), drift, uTime, gust, fw);
  float hy = ripple(q + vec2(0.0, e.y), drift, uTime, gust, fw);
  float amp = mix(0.055, 0.20, clamp(sp*0.22, 0.0, 1.0)) * (0.55 + 0.9*gust);
  // Shallow water is choppier: the bed shortens the wave.
  amp *= mix(1.35, 1.0, smoothstep(0.3, 2.6, depth));
  vec2 dh = (vec2(hx, hy) - h0)/e * amp * 14.0;
  // Back out of the ripple frame into world xz. The warp is ignored in this rotation: it is a
  // few degrees of shear, and the normal only has to look right, not integrate.
  vec2 axC = vec2(-RIP_AXIS.y, RIP_AXIS.x);
  vec3 N = normalize(vec3(-(dh.x*RIP_AXIS.x + dh.y*axC.x), 1.0, -(dh.x*RIP_AXIS.y + dh.y*axC.y)));
  // Flatten with distance so a lake two kilometres away is a plate of colour and not a
  // boiling field of highlights. Barely stronger than the pen's 0.75 over 120-520 m: with
  // the bands gated above, this is now a look control rather than an anti-aliasing measure.
  N = normalize(mix(N, vec3(0.0,1.0,0.0), smoothstep(110.0, 560.0, vDist)*0.82));

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
  body += ${C.wSpark}*caus*0.20*(1.0 - smoothstep(0.05, 0.40, bedDepth))*sh*bandLimit(fw, vec2(1.7, 2.9));

  // ── reflection ─────────────────────────────────────────────────────────────
  // Sky only. The pen also had a planar mirror pass for its one valley; a streaming world
  // would need one render target per water body per frame, and stylised water keeps its own
  // colour at grazing angles anyway — which is why the Fresnel term is clamped so low.
  vec3 R = reflect(-V, N);
  vec3 refl = skyDomeLite(normalize(vec3(R.x, max(R.y, 0.012), R.z)));
  float fres = 0.035 + 0.70*pow(1.0 - clamp(dot(N,V), 0.0, 1.0), 4.0);
  fres = clamp(fres, 0.0, 0.46);

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
    col = mix(col, mix(${C.wDeepShade}, ${C.wSpark}, bright),
              rib*0.16*(0.4 + 0.6*sh)*bandLimit(fw, vec2(0.155, 1.05)));
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
  float glint = smoothstep(0.9975, 0.99925, f) * twinkle * bandLimit(fw, vec2(1.9, 3.6));
  float glitterPath = smoothstep(0.55, 1.0, dot(normalize(vec2(V.x,V.z)), -normalize(uSunDir.xz)));
  col += ${C.wSpark} * (glint*2.6 + broad*0.42) * sh * (0.35 + 0.75*glitterPath);

  // ── shore foam ─────────────────────────────────────────────────────────────
  // Keyed off the measured depth, so the foam band is a genuine contour of the bed and
  // widens by itself wherever the shore shelves gently.
  float edge = 1.0 - smoothstep(0.0, 1.25, depth);
  vec2 ds = q - drift*0.824;   // 0.7/0.85
  float scallop = mix(0.5, pn2(vec2(ds.x*0.85, ds.y*2.2))*0.5 + 0.5, bandLimit(fw, vec2(0.85, 2.2)));
  float foam = clamp(smoothstep(0.42, 0.96, edge*(0.50 + 0.95*scallop)), 0.0, 1.0);
  col = mix(col, ${C.wFoam}*mix(0.80, 1.10, scallop), foam*0.55);

  // cat's paws darken the surface where a gust touches down
  col *= mix(1.0, 0.86, smoothstep(0.75, 1.6, gust));

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

    for (let j = 0; j < n; j++) {
      const gj = j * stride;
      for (let i = 0; i < n; i++) {
        const gi = i * stride;
        const k = j * n + i;

        pos[k * 3] = i * cell;
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = j * cell;

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
