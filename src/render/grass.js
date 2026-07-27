/* Wanderoad — the GPU grass field.
 *
 * Ported from the Hoshi-no-Tani pen (§6 GRASS: `buildBladeGeometry`, `buildBladeInstances`,
 * `GRASS_VS`, `GRASS_FS`, `class GrassField`, `grassBeforeRender`, `RINGS`, `DENS_POW`).
 * Every blade is still a quadratic Bézier solved for the quasi-static equilibrium of
 * gravity, wind and Hookean recovery (Jahrmann & Wimmer 2017) and then corrected so it can
 * neither stretch nor sink through the ground; four overlapping LOD rings still carry
 * blades from under the wheels to the far ridge; blade width is still floored to an
 * angular size so the far field thins in density but never in coverage.
 *
 * WHAT CHANGED, AND WHY
 *
 * 1. The pen sampled ground height, the grass mask and the tussock hue from three baked
 *    textures of one fixed 2.4 km valley. An infinite world cannot bake anything, so those
 *    three fetches are replaced by ONE instance attribute set built on the CPU from
 *    `world/terrain.js`. That inverts the pen's cost model — the GPU got cheaper, the CPU
 *    got a new job — which is what the rest of this file is about.
 *
 * 2. A chunk's blades are therefore CHUNK-SPECIFIC data, where the pen shared one instance
 *    buffer across a whole ring. Sampling the terrain per blade is out of the question
 *    (`Terrain.surface` is 12 µs, measured), so each chunk samples a coarse lattice —
 *    1.5 m in the near ring, 11 m in the far one — and every blade bilinearly interpolates
 *    it. The lattice is fine enough to resolve a carriageway everywhere it is legible.
 *
 * 3. Blades that fail the biome / road / slope test are never written at all. Because the
 *    template positions are Fisher-Yates shuffled BEFORE filtering, the survivors are still
 *    in shuffled order, so the pen's whole prefix trick survives intact: drawing the first
 *    K instances is still a uniform random thinning, and a dune chunk simply ends up with
 *    6% of the instances rather than 6% of the blades being invisible.
 *
 * 4. The rings re-centre on the car, and a chunk is only rebuilt when it enters the ring or
 *    when it comes close enough to need a denser buffer. On a ring shift the surviving
 *    chunks are PERMUTED between slots rather than rebuilt — at 90 m/s a full rebuild of
 *    every ring on every shift would be ~5.6 M blades per second of JS, five times the
 *    budget. Rebuilds run against a wall-clock budget (2.5 ms), nearest ring first.
 *
 * BLADE COUNTS. The pen ran 1100 blades/m² at the camera and ~2.5 M instances a frame in a
 * scene that contained nothing but a valley. This is a game: the same frame also carries
 * ~560 k streamed terrain triangles at a 7 km view distance, trees, water and a car. The
 * density law is kept — blades/m²(d) = K·min(1, (dn/d)^1.5), one continuous curve across
 * all four rings — and K is cut from the pen's ~20 400 to 4 400, i.e. 238 blades/m² at the
 * bumper against the pen's 1100. That is a 0.22x factor, and it lands at ~1.1 M instances
 * over the full circle, ~0.37 M actually drawn after the cone cull, ~1.4 M vertices — about
 * a fifth of the pen's vertex load, which is what leaves the frame to the rest of the game.
 * Coverage does not suffer, because coverage is density x width x height and the angular
 * width floor widens a far blade in proportion to its distance: at 300 m the sward is still
 * ~8x overdrawn. The far ring stops at 560 m rather than the pen's 1250 m — past that the
 * terrain material's own painted ground carries the hillside, and at 90 m/s nobody is
 * reading individual blades half a kilometre away.
 */

import {
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  RawShaderMaterial,
  Sphere,
  Vector3,
  Vector4,
} from 'three';
import {
  DEPTH_FS,
  GL_HASH,
  GL_LIGHT,
  GL_NOISE,
  GL_SHADOW,
  fragHead,
  glCloudField,
  vertHead,
} from '../core/glsl.js';
import { C, BIOME_TINT } from '../core/palette.js';
import { U, sharedUniforms } from './uniforms.js';
import { GL_WIND, windUniforms } from './wind.js';
import { Terrain } from '../world/terrain.js';
import { BIOME, BIOME_COUNT, BIOME_SCATTER } from '../world/biomes.js';
import { canopyShade } from '../world/scatter.js';
import { clamp, clamp01, hash3i, rng, smoothstep } from '../core/math.js';

/* ── the density law ─────────────────────────────────────────────────────────
 * blades/m²(d) = K · min(1, (dn/d)^DENS_POW), continuous across all four rings.
 *
 * The exponent is 1.5 rather than 1.7 or 1.45 for a reason beyond taste: at exactly 1.5
 * the shader evaluates (dn/d)^1.5 as x·x·inversesqrt(x) — three single-cycle instructions
 * where a general pow() is closer to ten — and this runs on every grass vertex in the
 * frame. Below 1.5 the blade count per steradian rises with distance and the horizon reads
 * as a meadow rather than a green plane; above it, the far field dissolves.
 */
const K_DENSITY = 4400;
const DENS_POW = 1.5;

/* Four overlapping rings. `cs` metres per chunk, `near`/`far` the distance band (with soft
 * overlaps), `dn` the distance at which this ring's density is 100%, `grid` the chunk grid
 * (odd, wide enough that the ring physically reaches its own `far` — a hand-picked grid is
 * how you get an un-grassed annulus between two rings), `lat` the terrain lattice
 * subdivisions per chunk, `segs` Bézier segments per blade -> (2n+1) vertices, `wpx` the
 * angular width floor in pixels, `hs` a height scale that lets the far rings trade blade
 * count for stroke width one-for-one. */
const RINGS = [
  { cs: 12, near: 0, far: 26, dn: 7, grid: 7, lat: 8, segs: 3, wpx: 1.7, hs: 1.0, prepass: true },
  { cs: 28, near: 22, far: 88, dn: 22, grid: 9, lat: 10, segs: 2, wpx: 2.0, hs: 1.08, prepass: true },
  { cs: 80, near: 80, far: 300, dn: 80, grid: 9, lat: 14, segs: 1, wpx: 3.8, hs: 1.36, prepass: false },
  { cs: 160, near: 270, far: 560, dn: 270, grid: 9, lat: 14, segs: 1, wpx: 6.0, hs: 1.95, prepass: false },
];

/* Below this fraction of full density a slot can never contribute a visible blade at any
 * camera position inside the centre cell, so it gets no mesh at all. It turns each ring's
 * square grid into a disc and drops ~20% of the draw calls. */
const SLOT_CULL = 0.004;

/* Buffer sizes are quantised onto a 1/sqrt(2) ladder, and THAT is what stops this design
 * from costing five times its budget. A ring shift moves every chunk one slot inward or
 * outward; if capacity were the exact per-slot figure, every inward-moving chunk — about
 * half the ring — would need a bigger buffer and therefore a rebuild, every shift. On the
 * ladder a chunk only rebuilds when it crosses a class boundary, which for a d^-1.5 law is
 * every 1.26x of distance: 9 chunks per shift instead of 18 in the near ring. The price is
 * at most 41% of over-allocation on a buffer, ~19% on average. */
const CAP_STEPS_PER_OCTAVE = 2;

/** Round a density fraction UP onto the ladder. Never returns more than 1. */
function quantCap(f) {
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  const e = Math.ceil(Math.log2(f) * CAP_STEPS_PER_OCTAVE);
  return Math.min(1, Math.pow(2, e / CAP_STEPS_PER_OCTAVE));
}

/* Grass stops on anything steeper than a walkable hillside. Edges are on the normal's Y:
 * 0.74 = 42.3°, 0.85 = 31.8°. The brief's "~40 degrees" is the half-way point. */
const SLOPE_N0 = 0.74;
const SLOPE_N1 = 0.85;

/* How much of the sward a closed canopy takes away. It thins the blades AND (via the
 * lushness channel, which is this same number) shortens them, so a wood floor is short
 * sparse grass rather than a hay meadow with trees standing in it. Not more than this: the
 * ground under a Ghibli wood is still green, and a bald forest floor at this palette reads
 * as scorched earth. */
const CANOPY_THIN = 0.45;

/* One `Terrain` serves every ring. Its box has to contain the far ring's outermost chunk
 * corner (4.5 chunks of 160 m = 800 m) plus however far the car may drive before the box is
 * rebuilt. The constructor is atomic — it builds a climate lattice and a road network in one
 * go — so its cost lands on a single frame and the box is kept as small as the far ring
 * allows: ~3.6 ms every 100 m of travel, i.e. once per 1.1 s flat out and once per 3 s at a
 * realistic cruise. */
const REGION_HALF = 930;
const REGION_DRIFT = 100;

/* Wall-clock JS the rebuild queue may spend per frame. A ring that took 200 ms would pop
 * in visibly at 90 m/s; at this budget the queue keeps up with 90 m/s with ~20% to spare
 * (measured cost model: ~2.0 ms/frame at 90 m/s, ~1.0 ms/frame at 45 m/s). */
const DEFAULT_BUDGET_MS = 2.5;

/* Per-blade instance data, 10 bytes:
 *   iPos  u16 x2  position as a fraction of the chunk  (<2.5 mm even on the 160 m chunks)
 *   iGrd  u16     ground height, normalised over the chunk's own Y range
 *   iTint u8  x4  dryness, snow, wetness, lushness — all five biomes blended by weight
 * The pen stored 4 bytes and read everything else from textures; at these instance counts
 * a byte removed is a byte removed a million times a frame, which is why the ground rides
 * in as 16 bits against a per-chunk range rather than as a float. */
const INV_U16 = 1 / 65535;
const INV_U32 = 1 / 4294967296;

/* ── biome tables, flattened once ─────────────────────────────────────────── */
const SCAT_GRASS = BIOME_SCATTER.map((b) => b.grass);
const TINT_DRY = BIOME_TINT.map((b) => b.dryness);
const TINT_SNOW = BIOME_TINT.map((b) => b.snow);
const TINT_WET = BIOME_TINT.map((b) => b.wet);

const glv3 = (a) => `vec3(${a[0].toFixed(4)},${a[1].toFixed(4)},${a[2].toFixed(4)})`;

/* The foliage multipliers straight out of BIOME_TINT. The blade shader does not branch per
 * biome and does not carry five weights, so the three that actually differ from the meadow
 * reference are reconstructed from the three axes the instance already carries. Steppe and
 * dunes differ from each other by less than 8% and both ride the dryness axis; the dunes
 * carry 6% of the meadow's grass anyway. */
const GRASS_TINTS = /* glsl */ `
const vec3 F_DRY  = ${glv3(BIOME_TINT[BIOME.STEPPE].foliage)};
const vec3 F_COLD = ${glv3(BIOME_TINT[BIOME.HIGHLAND].foliage)};
const vec3 F_WET  = ${glv3(BIOME_TINT[BIOME.WETLAND].foliage)};
`;

/* ── geometry ───────────────────────────────────────────────────────────────── */

/** One blade: `segs` quads up the stem, closed by a triangle at the tip. */
function buildBladeGeometry(segs) {
  const n = Math.max(1, segs);
  const nv = 2 * n + 1;
  const vtx = new Float32Array(nv * 3); // named `position` so three binds it
  let k = 0;
  for (let i = 0; i < n; i++) {
    const v = i / n;
    vtx[k++] = 0;
    vtx[k++] = v;
    vtx[k++] = 0;
    vtx[k++] = 1;
    vtx[k++] = v;
    vtx[k++] = 0;
  }
  vtx[k++] = 0.5;
  vtx[k++] = 1;
  vtx[k++] = 0;
  const tri = new Uint16Array((n - 1) * 6 + 3);
  let t = 0;
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    tri[t++] = a;
    tri[t++] = a + 2;
    tri[t++] = a + 1;
    tri[t++] = a + 1;
    tri[t++] = a + 2;
    tri[t++] = a + 3;
  }
  const a = (n - 1) * 2;
  tri[t++] = a;
  tri[t++] = 2 * n;
  tri[t++] = a + 1;
  return { position: new BufferAttribute(vtx, 3), index: new BufferAttribute(tri, 1) };
}

/**
 * The per-ring template of blade positions, as chunk fractions. Stratified so coverage is
 * even without a visible grid, then Fisher-Yates shuffled so that ANY prefix of the buffer
 * is a uniform random sample of the chunk — which is what lets a chunk be thinned simply by
 * drawing fewer of its blades, and what lets a chunk be BUILT at a lower density simply by
 * walking fewer of them.
 *
 * Every chunk of a ring walks the same template. Nothing tiles, because height, hue,
 * orientation and the seed head are all hashed from the blade's world position.
 */
function bladeTemplate(count, seed) {
  const r = rng(seed);
  const ip = new Uint16Array(count * 2);
  const side = Math.ceil(Math.sqrt(count));
  const cell = 1 / side;
  let k = 0;
  for (let i = 0; i < count; i++) {
    const gx = i % side;
    const gy = (i / side) | 0;
    ip[k++] = Math.min(65535, (gx + r()) * cell * 65535) | 0;
    ip[k++] = Math.min(65535, (gy + r()) * cell * 65535) | 0;
  }
  for (let i = count - 1; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const ax = ip[i * 2];
    const az = ip[i * 2 + 1];
    ip[i * 2] = ip[j * 2];
    ip[i * 2 + 1] = ip[j * 2 + 1];
    ip[j * 2] = ax;
    ip[j * 2 + 1] = az;
  }
  return ip;
}

/* ── shaders ────────────────────────────────────────────────────────────────── */

/**
 * `depthOnly` builds the variant used by the prepass. It solves the identical blade — it
 * has to, or the depth it lays down would not match — but emits no varyings and skips the
 * curved cross-section normal, the occlusion term and the tint, none of which a depth-only
 * pass can use. Interpolants written and immediately discarded are real vertex-export
 * bandwidth, and export bandwidth is exactly what a grass field runs out of.
 */
const GRASS_VS = (depthOnly) => /* glsl */ `
uniform float uChunkSize;
uniform vec4  uLod;            // near, nearWidth, far, farWidth
uniform vec3  uLodB;           // widthBoost(angular), heightScale, ringDistance
uniform float uWindGain;
uniform float uPlayerPush;
in vec2  iPos;
in float iGrd;
in vec4  iTint;                // dryness, snow, wetness, lushness
${
  depthOnly
    ? ''
    : `
out vec3  vW;
out vec3  vN;
out float vT;        // height along the blade 0..1
out float vBend;     // how far the blade is laid over 0..1
out vec3  vTint;     // swale, tussock, dryness
out vec2  vBio;      // snow, wetness
out float vSide;     // -1..1 across the blade
out float vOccl;     // shaded by taller neighbours
out float vVar;      // per-blade value/hue jitter, seed head packed in
`
}
void degenerate(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }

void main(){
  vec2 vtx = position.xy;              // x = across the blade, y = along it
  // The chunk origin comes straight out of the model matrix (three keeps that up to date
  // per object for free), so all of a ring's chunks share ONE material with ZERO per-draw
  // uniform traffic. Riding along with it: the density fraction the CPU drew in the X
  // scale and the chunk's ground-height range in the Y scale, both constant per chunk and
  // both otherwise a uniform upload per draw.
  vec2 cCen = vec2(modelMatrix[3][0], modelMatrix[3][2]);
  vec2 wxz  = (cCen - vec2(uChunkSize*0.5)) + iPos*uChunkSize;
  vec2 toB  = wxz - uCamPos.xz;
  float d2  = dot(toB, toB);
  float invD = inversesqrt(max(d2, 1e-4));
  float dist = d2*invD;

  /*  Lateral view-cone rejection, per blade, as the very first thing the shader does —
      five instructions, no memory access, no hashing. Culling happens per CHUNK on the
      CPU, and a chunk is a coarse unit: the one the car is standing in is always kept, yet
      more than half of its blades are behind you. uCull.xy is the view direction flattened
      onto the ground and uCull.z the cosine of the widest frustum corner, with a pad for
      blade width and wind lean. Blades within about five metres are exempt, since at that
      range a blade's own width subtends more than the pad. */
  if(d2 > 30.0 && dot(toB, uCull.xy)*invD < uCull.z){ degenerate(); return; }

  // ── overlapping LOD fades: blades grow in and shrink out, never pop ─────
  float fadeIn  = uLod.x <= 0.01 ? 1.0 : smoothstep(uLod.x - uLod.y, uLod.x + uLod.y, dist);
  float fadeOut = uLod.z <= 0.0  ? 1.0 : 1.0 - smoothstep(uLod.z - uLod.w, uLod.z, dist);
  float fade = fadeIn * fadeOut;
  if(fade < 0.006){ degenerate(); return; }

  // ── the density law, resolved per blade ────────────────────────────────
  // The CPU already thinned this chunk to the density its NEAREST corner deserves (it
  // deliberately over-draws), so all that is left here is to reject the surplus against
  // this blade's own true distance. The result is a perfectly smooth radial density
  // gradient with no chunk banding at all — which is what lets the far ring use 160 m
  // chunks and a few dozen draw calls.
  float rQ = hash12(wxz*1.317 + 7.71);
  float dn = uLodB.z;
  float chunkKeep = modelMatrix[0][0];
  // the exponent is 1.5 exactly so this is x·x·inversesqrt(x): three cheap instructions
  float xr = min(dn/max(dist, dn), 1.0);
  float bladeKeep = xr*xr*inversesqrt(max(xr, 1e-6));
  float need = rQ*chunkKeep;
  if(need > bladeKeep){ degenerate(); return; }   // conservative early gate

  /*  The pen issued three vertex texture fetches here — height, meadow, wind — carefully
      arranged so their addresses did not depend on each other. Two of the three are gone:
      the ground and everything the meadow texture used to carry now arrive as instance
      attributes, which cost no latency at all. What is left is the wind, sampled a little
      UPWIND of the blade: a spatial stand-in for the blade's own response lag, so a gust
      front visibly SWEEPS across the field instead of switching on. */
  float ground = modelMatrix[3][1] + iGrd * modelMatrix[1][1];
  vec4  Wsam   = windSample(wxz - uWindLag);

  float dryv  = iTint.x;
  float snowv = iTint.y;
  float lush  = iTint.w;
  // No grass mask gate: the CPU deleted every blade with no business existing — on the
  // carriageway, on a cliff, in the sand. What survives from the pen is the growth ramp,
  // because a hard accept/reject makes a blade POP into existence as you drive at it, and
  // a field full of popping blades shimmers.
  float thr  = bladeKeep*(0.78 + 0.22*lush);
  float grow = clamp((thr - need) / max(thr*0.22, 1e-5), 0.0, 1.0);
  if(grow <= 0.004){ degenerate(); return; }
  fade *= grow;

  // per-blade randomness hashed from WORLD position: the template is shared by every chunk
  // of this ring, yet nothing visibly tiles
  vec3 h3 = hash32(wxz*0.9173 + 11.0);
  float rH = h3.x, rO = h3.y, rS = h3.z;
  float rP = hash12(wxz*2.713 + 31.4);
  // Grass is negatively gravitropic — the stem grows toward vertical whatever the slope
  // does. Being correct here also removes four heightmap taps per vertex.
  vec3 up = vec3(0.0, 1.0, 0.0);

  // ── tussocks: height, hue and lean cluster at metre and decametre scales
  // The pen baked these two bands into its meadow texture because it could not afford
  // gradient noise on twelve million vertices. At a fifth of that count, two value-noise
  // taps are cheaper than the texture fetch they replace — and they stream for free.
  float clumpA = vn2(wxz * 0.0147);          // ~68 m tussock band
  float clumpB = vn2(wxz * 0.00342 + 17.3);  // ~292 m swales

  // a wild hay meadow, not a lawn
  float hgt = (0.30 + rH*0.30);
  hgt *= 0.68 + 0.74*clumpB;
  hgt *= 0.84 + 0.38*clumpA;
  hgt *= mix(1.24, 0.82, dryv);          // dry biomes carry a shorter sward
  hgt *= mix(0.55, 1.0, lush);
  // snow packs a sward flat long before it buries it
  hgt *= mix(1.0, 0.42, snowv * smoothstep(120.0, 240.0, ground));
  hgt *= uLodB.y;
  hgt  = max(hgt, 0.08);

  float wid = (0.0082 + rS*0.0070) * (0.84 + 0.40*clumpA);
  // angular floor: a blade is never allowed to fall below ~1 screen pixel wide
  wid = max(wid, dist * uLodB.x);

  float stiff = 0.52 + rS*0.46 + clumpB*0.10;

  // ── frame ──────────────────────────────────────────────────────────────
  float orient = rO*6.2831853 + clumpA*2.4;
  vec3 axis = vec3(cos(orient), 0.0, sin(orient));
  // at distance, swing the blade to present its face to the eye so it can never disappear
  // edge-on
  vec3 toCam = normalize(vec3(uCamPos.x - wxz.x, 0.0, uCamPos.z - wxz.y) + vec3(1e-5));
  float faceCam = smoothstep(16.0, 80.0, dist);
  axis = normalize(mix(axis, normalize(cross(vec3(0.0,1.0,0.0), toCam)), faceCam*0.88));

  vec3 sideV = normalize(cross(up, axis) + vec3(1e-6));
  vec3 front = normalize(cross(sideV, up));

  vec3 p0  = vec3(wxz.x, ground - 0.035, wxz.y);
  vec3 iv2 = p0 + up*hgt*0.965 + front*hgt*(0.20 + rH*0.34);

  // ── forces ─────────────────────────────────────────────────────────────
  vec2 wv = Wsam.rg; float gustN = Wsam.b, excite = Wsam.a;
  float prof = windProfile(hgt*0.70);
  vec3 wind3 = vec3(wv.x, 0.0, wv.y) * prof;

  vec3 gE = vec3(0.0,-1.0,0.0) * (1.6 + 1.4*rH);
  vec3 gF = 0.25 * length(gE) * front;
  vec3 gv = (gE + gF) * 0.048;

  vec3 dir0 = normalize(iv2 - p0);
  float fd = 1.0 - abs(dot(normalize(wind3 + vec3(1e-5)), dir0));   // alignment
  float fr = clamp(dot(iv2 - p0, up)/hgt, 0.0, 1.0);                // straightness
  vec3 wf = wind3 * (0.30 + 0.95*fd) * fr * uWindGain * (0.55 + 0.75*hgt);

  // quasi-static equilibrium of recovery + gravity + wind (Hooke)
  vec3 v2 = iv2 + (gv + wf) / max(stiff, 0.18);

  // ── ringing: a gust front leaves the blade quivering at its own frequency
  float fB = 1.85 + rS*1.55;
  float ph = rQ*6.2831853;
  float osc = sin(uTime*6.2831853*fB + ph);
  float amp = (excite*0.50 + max(gustN-0.85,0.0)*0.42) * (0.040 + 0.075*(1.0-stiff));
  vec2  wdirn = normalize(wv + vec2(1e-5));
  v2 += vec3(wdirn.x, 0.0, wdirn.y) * osc * amp * hgt;
  // never frozen: a low flutter always present
  v2 += sideV * sin(uTime*7.4*(0.65+rS) + ph*2.3) * hgt * 0.020 * (0.35 + gustN*0.65);

  // ── whatever is standing in the sward parts it ─────────────────────────
  // The pen pushed the grass aside around a walker. Here it is the camera: in a bumper or
  // bonnet view it is a metre off the ground and the sward opens around it; in a chase view
  // the vertical test switches it off, which is correct — the car is five metres ahead.
  if(uPlayerPush > 0.0){
    vec2 dp = wxz - uCamPos.xz;
    float pd = length(dp);
    if(pd < 2.4){
      float vert = 1.0 - smoothstep(1.3, 2.8, abs(uCamPos.y - ground));
      float push = smoothstep(1.85, 0.15, pd) * vert * uPlayerPush;
      v2 += vec3(dp.x, -0.55, dp.y)/max(pd, 0.02) * push * hgt * 0.85;
    }
  }

  // ── state corrections (Jahrmann §5.2) ──────────────────────────────────
  v2 -= up * min(dot(up, v2 - p0), 0.0);
  vec3 d20 = v2 - p0;
  float lproj = length(d20 - up*dot(d20, up));
  vec3 v1 = p0 + hgt*up*max(1.0 - lproj/hgt, 0.05*max(lproj/hgt, 1.0));
  float L0 = length(v2 - p0);
  float L1 = length(v1 - p0) + length(v2 - v1);
  float L  = (2.0*L0 + L1)/3.0;
  float rr = hgt / max(L, 1e-4);
  v1 = p0 + rr*(v1 - p0);
  v2 = v1 + rr*(v2 - v1);

  // ── evaluate the Bézier ────────────────────────────────────────────────
  float head = step(0.895, rP);     // one blade in ten carries a seed head
  float t = vtx.y;
  vec3 a = mix(p0, v1, t);
  vec3 b = mix(v1, v2, t);
  vec3 c = mix(a, b, t);
  vec3 tang = normalize(b - a + vec3(0.0,1e-5,0.0));

  // sqrt rather than pow(x, 0.40): the profile differs by a couple of percent over the
  // length of a blade and it is one transcendental fewer per vertex
  float wprof = sqrt(1.0 - t) * (0.60 + 0.42*smoothstep(0.0, 0.16, t));
  wprof = mix(wprof, wprof*1.9, head*smoothstep(0.80, 0.99, t));
  float u = (vtx.x - 0.5);
  vec3 sideW = normalize(sideV - tang*dot(sideV, tang) + vec3(1e-6));
  vec3 pos = c + sideW * (u * wid * wprof * 2.0 * fade);
  // shrink the whole blade as it fades, so LOD changes are invisible
  pos = mix(p0 + vec3(0.0, 0.02, 0.0), pos, 0.30 + 0.70*fade);

  // ── curved cross-section: two triangles wide, shades like a rolled leaf
  vec3 faceN = normalize(cross(sideW, tang));
  vec3 N = normalize(faceN + sideW*(u*2.0)*0.66);

${
  depthOnly
    ? ''
    : `
  vBend = clamp(1.0 - dot(normalize(v2-p0), up), 0.0, 1.0);
  vT    = t;
  vSide = u*2.0;
  vW    = pos;
  vN    = N;
  // a blade shorter than its neighbours sits in their shade: this is what gives a dense
  // sward its internal depth instead of one flat wall of green
  vOccl = smoothstep(0.18, 1.05, hgt / (0.42 + 0.72*clumpB));
  // the seed-head flag rides in the integer part of vVar
  vVar  = rS*0.6 + rH*0.4 + head*2.0;

  // per-blade hue: the meadow is a mosaic, never one green. The dryness gets a per-blade
  // wobble so a biome border reads as grass drying out patch by patch, not as a gradient.
  vTint = vec3(clumpB, clumpA, clamp(dryv + (rH-0.5)*0.22, 0.0, 1.0));
  vBio  = vec2(snowv, iTint.z);
`
}
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;

/* tier 0/1 = full quality (PCF shadow, painterly noise);
   tier 2   = fast 4-tap shadow, no per-pixel noise;
   tier 3   = cloud shadow only (it is beyond the shadow map anyway).          */
const GRASS_FS = (tier) => /* glsl */ `
in vec3 vW; in vec3 vN; in float vT; in float vBend;
in vec3 vTint; in vec2 vBio; in float vSide; in float vOccl; in float vVar;
out vec4 outColor;

void main(){
  vec3 N = normalize(vN);
  vec3 toEye = uCamPos - vW;
  float vDist = length(toEye);
  vec3 V = toEye / max(vDist, 1e-4);
  if(!gl_FrontFacing) N = -N;
  float vHead = step(1.5, vVar);
  float vVarF = vVar - vHead*2.0;
  float vAO   = mix(0.34, 1.0, pow(vT, 0.55));

  // ── vertical hue path: teal at the root, yellow-green at the tip ───────
  float t = vT;
  vec3 lit = mix(${C.gLow}, ${C.gMid}, smoothstep(0.00, 0.26, t));
  lit = mix(lit, ${C.gUpper}, smoothstep(0.20, 0.66, t));
  lit = mix(lit, ${C.gTip},   smoothstep(0.80, 1.00, t));
  vec3 mid = mix(${C.gBase}, ${C.gMid}, smoothstep(0.05, 0.80, t));
  vec3 shd = mix(${C.gBase}*0.82, ${C.gLow}, smoothstep(0.15, 0.95, t));

  // meadow mosaic
  lit = mix(lit, ${C.gPatchC}, smoothstep(0.35,0.85,vTint.x)*0.45);
  lit = mix(lit, ${C.gPatchA}, smoothstep(0.65,0.15,vTint.x)*0.35);
  mid = mix(mid, ${C.gPatchB}, smoothstep(0.3,0.8,vTint.y)*0.40);
  shd = mix(shd, ${C.tHollow}, smoothstep(0.4,0.9,vTint.y)*0.35);

  // ── the biome, as three scalars rather than five branches ──────────────
  // Dryness bleeds the greens toward straw from the tip down, because that is the order a
  // blade actually cures in. It is a hue rotation and not a desaturation: dead grass is
  // yellow, not grey.
  float dryB = vTint.z;
  float dry = smoothstep(0.10, 0.95, dryB) * smoothstep(0.30, 0.98, t);
  lit = mix(lit, ${C.gDry},      dry*0.72);
  mid = mix(mid, ${C.gDry}*0.72, dry*0.48);
  shd = mix(shd, ${C.gDry}*0.36, dry*0.30);

  // BIOME_TINT's foliage multipliers, along the three axes the instance carries.
  float snowB = vBio.x, wetB = vBio.y;
  vec3 fol = mix(vec3(1.0), F_DRY,  dryB);
  fol *= mix(vec3(1.0), F_COLD, snowB);
  fol *= mix(vec3(1.0), F_WET,  wetB);
  lit *= fol; mid *= fol; shd *= fol;

  // Snow above the line, on the same curve the terrain material uses so a snowfield and
  // the grass poking through it agree about where the line is.
  float snowC = snowB * smoothstep(120.0, 240.0, vW.y);
  lit = mix(lit, vec3(0.95,0.96,0.99), snowC*0.86);
  mid = mix(mid, vec3(0.80,0.85,0.94), snowC*0.86);
  shd = mix(shd, vec3(0.58,0.66,0.82), snowC*0.86);

  // no two blades in a meadow are the same green
  float vj = 0.84 + 0.34*vVarF;
  lit *= vj; mid *= vj*0.98; shd *= 0.92 + 0.20*vVarF;
  lit = mix(lit, ${C.gPatchB}, smoothstep(0.72, 1.0, vVarF)*0.30);

  float ndl = dot(N, uSunDir);
${
  tier <= 1
    ? `  float sh = sunShadow(vW, ndl) * cloudShadow(vW);`
    : tier === 2
      ? `  float sh = sunShadowFast(vW, ndl) * cloudShadow(vW);`
      : `  float sh = cloudShadow(vW);`
}
  float selfShadow = mix(0.62, 1.0, pow(t, 0.75));

  // Everything that varies ACROSS the width of a blade — the fanned normal, the rim, the
  // wind flash, the midrib — is sub-pixel detail once a blade is only two or three pixels
  // wide, and sub-pixel detail does not resolve, it sparkles. nearK retires those terms
  // with distance and leaves the ones that vary ALONG the blade, which stay several pixels
  // tall much further out.
  float nearK = 1.0 - smoothstep(55.0, 240.0, vDist);
  N = normalize(mix(vec3(0.0,1.0,0.0), N, 0.34 + 0.66*nearK));

  Surf s;
  s.N=N; s.V=V; s.P=vW;
  s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = ${tier <= 1 ? 'mix(0.11, 0.24, clamp(vDist*0.008,0.0,1.0))' : '0.20'};
  s.jit  = ${tier <= 1 ? '(vn2(vW.xz*3.9 + vW.y*1.7) - 0.5)*0.055' : '(vVarF-0.5)*0.05'};
  s.shadow = sh*selfShadow*mix(0.52, 1.0, vOccl);
  s.trans  = 1.00*smoothstep(0.12,0.68,t);
  s.transCol = ${C.gTrans};
  s.rim = 0.34*(0.25 + 0.75*nearK); s.ao = vAO; s.ambient = 1.0;
  vec3 col = paint(s);

  // ── the wind flash ─────────────────────────────────────────────────────
  // a blade laid over by a gust turns its broad face up and catches the light: this is what
  // makes a gust visible as a pale band racing across the field
  float geom = pow(clamp(1.0 - abs(dot(N,V)), 0.0, 1.0), 1.9)*0.45
             + pow(clamp(dot(N, normalize(uSunDir + V)), 0.0, 1.0), 3.2)*0.55;
  float flash = smoothstep(0.34, 0.86, vBend) * smoothstep(0.14, 0.78, t);
  col = mix(col, ${C.gSheen}, geom*flash*0.55*(0.30 + 0.70*sh)*(0.32 + 0.68*nearK));

  // seed head: a warm bronze plume on one blade in ten
  if(vHead > 0.5){
    float hd = smoothstep(0.78, 0.94, t);
    col = mix(col, mix(${C.gDry}, vec3(0.32,0.22,0.14), 0.42)*1.25, hd*0.82);
  }
  // a hint of the midrib, and the deep interior of the sward
  col *= 1.0 - abs(vSide)*0.13*nearK;
  col *= mix(0.46, 1.0, vOccl*0.55 + 0.45);

  // Out past a hundred metres a blade is only two or three pixels wide, and full contrast
  // against the ground behind it is what makes distant grass crawl and sparkle as the
  // camera moves. Converging it toward the sward mean keeps every bit of the texture and
  // takes the edge energy out of it — which is, not coincidentally, exactly what a painter
  // does at that depth.
  col = mix(col, mix(col, ${C.tMid}, 0.62), smoothstep(90.0, 430.0, vDist)*0.42);

  col = aerial(col, vDist, V, vW.y);
  outColor = vec4(SAFE3(col), gFogAmt);
}`;

/* ── one chunk of one ring ──────────────────────────────────────────────────── */

class GrassChunk {
  constructor(ring, cap) {
    this.cap = cap;
    this.count = 0;
    this.cx = 0;
    this.cz = 0;
    this.wx = 0;
    this.wy = 0;
    this.wz = 0;
    // The fraction of full density the buffer was BUILT at, and the fraction its current
    // slot wants. They differ while a chunk is drifting outward through slots it is too big
    // for — which is fine, and is exactly why the draw path reads 'frac' and not the slot's
    // figure: a chunk built dense and now sitting far away must not be thinned twice.
    this.frac = 1;
    this.wantFrac = 1;
    this.dirty = true;
    this.stamp = -1;
    // How many template entries have been walked. A chunk that only needs to get DENSER
    // resumes from here instead of starting over: the survivors already written are still a
    // correct, correctly-ordered prefix, so an upgrade costs the delta and nothing else.
    this.built = 0;
    this.minY = 0;
    this.ySpan = 1;
    // The terrain lattice this chunk was built from, kept so a densening does not have to
    // resample the ground. ~4.5 kB on the coarse rings, and it is the single biggest saving
    // in the whole rebuild path: half of all rebuilds are densenings.
    this.lat = new Float32Array((ring.R.lat + 1) * (ring.R.lat + 1) * 5);

    this.iPos = new Uint16Array(cap * 2);
    this.iGrd = new Uint16Array(cap);
    this.iTint = new Uint8Array(cap * 4);

    const g = new InstancedBufferGeometry();
    g.setAttribute('position', ring.blade.position); // shared with every chunk of the ring
    g.setIndex(ring.blade.index);
    this.aPos = new InstancedBufferAttribute(this.iPos, 2, true);
    this.aGrd = new InstancedBufferAttribute(this.iGrd, 1, true);
    this.aTint = new InstancedBufferAttribute(this.iTint, 4, true);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iGrd', this.aGrd);
    g.setAttribute('iTint', this.aTint);
    // The blade is displaced entirely in the vertex shader, so no bounding volume three
    // could compute would mean anything. Culling is ours: per chunk on the CPU, per blade
    // against uCull in the shader.
    g.boundingSphere = new Sphere(new Vector3(), 1e6);
    g.instanceCount = 0;
    this.geom = g;

    const m = new Mesh(g, ring.mat);
    m.frustumCulled = false;
    m.renderOrder = 4 + ring.index;
    m.visible = false;
    this.mesh = m;

    if (ring.preMat) {
      // Parented to the beauty chunk so it inherits both its visibility and its model
      // matrix (which is where the vertex shader reads the chunk origin, the density
      // fraction and the height range from) with no extra bookkeeping at all.
      const pm = new Mesh(g, ring.preMat);
      pm.frustumCulled = false;
      pm.renderOrder = -20 + ring.index; // before the terrain, before everything
      this.pre = pm;
      m.add(pm);
    } else {
      this.pre = null;
    }
  }

  dispose() {
    this.geom.dispose();
  }
}

/* ── the field ──────────────────────────────────────────────────────────────── */

export class Grass {
  /**
   * @param {{seed:number, scene?:import('three').Object3D, quality?:number,
   *          wind?:import('./wind.js').Wind}} opt
   */
  constructor({ seed, scene, quality = 1, wind = null } = {}) {
    this.seed = seed >>> 0;
    this.quality = clamp(quality, 0.25, 2);
    this.wind = wind;
    /** Wall-clock JS the rebuild queue may spend per frame, milliseconds. */
    this.budgetMs = DEFAULT_BUDGET_MS;
    /** Radians of view angle per screen pixel — the angular floor on blade width. */
    this.angPerPx = 1.012 / 1080; // 58° vertical fov at 1080 px; call setAngular on resize

    this._group = new Object3D();
    this._group.matrixAutoUpdate = false;
    this._group.name = 'grass';
    if (scene) scene.add(this._group);

    this._terrain = null;
    this._regionX = Infinity;
    this._regionZ = Infinity;

    this.stats = { chunks: 0, dirty: 0, drawn: 0, built: 0, extended: 0, buildMs: 0, bytes: 0 };
    this._rings = RINGS.map((R, i) => this._buildRing(R, i));
  }

  get group() {
    return this._group;
  }

  /**
   * A blade must never shrink below ~1 screen pixel or the field visibly thins with
   * distance instead of merely getting sparser. Pass `2*tan(fovY/2) / drawingBufferHeight`.
   */
  setAngular(angPerPx) {
    this.angPerPx = angPerPx;
    for (const ring of this._rings) ring.uni.uLodB.value.x = angPerPx * ring.R.wpx;
    return this;
  }

  _buildRing(R, index) {
    const blade = buildBladeGeometry(R.segs);
    const full = Math.max(64, Math.round(K_DENSITY / Math.pow(R.dn, DENS_POW) * R.cs * R.cs * this.quality));
    const tpl = bladeTemplate(full, 7000 + index * 131 + this.seed);

    const uni = sharedUniforms(
      Object.assign(
        {
          uChunkSize: { value: R.cs },
          uLod: { value: new Vector4(R.near, Math.max(7, R.near * 0.26), R.far, R.far * 0.26) },
          uLodB: { value: new Vector3(this.angPerPx * R.wpx, R.hs, R.dn) },
          uWindGain: { value: 0.235 },
          uPlayerPush: { value: index === 0 ? 1.0 : 0.0 },
        },
        windUniforms()
      )
    );

    // The cloud-shadow map spans the streamer's world, not the pen's valley.
    const cloud = glCloudField({ cshSpan: 9200, cloudDeck: 980 });

    /*  ONE material for the whole ring: three then sorts its chunks by depth (same material
        id -> the sort falls through to z), giving front-to-back draw order and therefore
        early-Z rejection of most fragments.
        The beauty pass writes depth even though the prepass already did. Skipping the write
        looks like free bandwidth and is a trap: the prepass occluder is not pixel-identical
        to the blade, so wherever the blade covers a pixel the prepass did not, nothing
        records that the pixel is now opaque — and the sky, drawn last against the far
        plane, walks straight through the silhouette. Correct beats clever. */
    const mat = new RawShaderMaterial({
      glslVersion: '300 es',
      uniforms: uni,
      vertexShader: vertHead(GL_HASH, GL_NOISE, GL_WIND, GRASS_VS(false)),
      fragmentShader: fragHead(GL_HASH, GL_NOISE, GRASS_TINTS, cloud, GL_SHADOW, GL_LIGHT, GRASS_FS(index)),
      side: DoubleSide,
    });

    /*  DEPTH PREPASS — the single most valuable thing in this renderer. Sitting in a sward
        at 238 blades/m², a near-horizontal view is roughly ten blades deep at every pixel.
        Sorting chunks front-to-back only gets early-Z BETWEEN chunks; inside a chunk the
        instance order is a deliberate shuffle, so nearly all of that depth complexity was
        being fully shaded and then thrown away. So the two near rings are drawn twice: once
        with colour writes off and no fragment work at all, then normally, where the
        hardware's early depth test now rejects every hidden fragment before the painterly
        shading, the shadow lookup or the cloud lookup ever runs. It also front-loads the
        depth for the TERRAIN, which is drawn after it.
        The occluder is the blade itself at full tessellation: a prepass may under-cover but
        never over-cover, and a straight chord at 86% width covers barely half of what a
        curved blade with a sqrt width profile does. */
    const preMat = R.prepass
      ? new RawShaderMaterial({
          glslVersion: '300 es',
          uniforms: uni,
          vertexShader: vertHead(GL_HASH, GL_NOISE, GL_WIND, GRASS_VS(true)),
          fragmentShader: DEPTH_FS,
          side: DoubleSide,
          colorWrite: false,
        })
      : null;

    const grid = R.grid;
    const half = (grid - 1) / 2;
    const cap = new Int32Array(grid * grid);
    const capFrac = new Float32Array(grid * grid);
    const order = [];
    for (let j = -half; j <= half; j++) {
      for (let i = -half; i <= half; i++) {
        const k = (j + half) * grid + (i + half);
        const raw = slotCapFrac(R, i, j);
        const f = raw < SLOT_CULL ? 0 : quantCap(raw);
        capFrac[k] = f;
        cap[k] = f <= 0 ? 0 : Math.max(48, Math.round(full * f));
        if (cap[k] > 0) order.push(k);
      }
    }
    // nearest slots first: at 90 m/s the sward under the bumper must never be the thing
    // waiting on the budget
    order.sort((a, b) => {
      const ai = (a % grid) - half;
      const aj = ((a / grid) | 0) - half;
      const bi = (b % grid) - half;
      const bj = ((b / grid) | 0) - half;
      return Math.max(Math.abs(ai), Math.abs(aj)) - Math.max(Math.abs(bi), Math.abs(bj));
    });

    const ring = {
      R,
      index,
      blade,
      tpl,
      full,
      uni,
      mat,
      preMat,
      grid,
      half,
      cap,
      capFrac,
      order,
      slots: new Array(grid * grid).fill(null),
      scratch: new Array(grid * grid).fill(null),
      pool: [],
      ox: 0,
      oz: 0,
      stamp: 0,
      ready: false,
    };
    return ring;
  }

  /* ── per-frame ───────────────────────────────────────────────────────────── */

  /**
   * `camX`/`camZ`/`camY` are the RING ANCHOR — main.js passes the car's position, on purpose
   * (see the file banner's point 4: "the rings re-centre on the car"), so the sward around
   * the car stays resident no matter where the camera itself roams. `_draw()` no longer takes
   * them: visibility reads the true camera straight out of the shared `U` block instead — see
   * its own comment for why that split matters.
   * @param {number} camX
   * @param {number} camZ
   * @param {number} camY
   * @param {number} dt seconds
   */
  update(camX, camZ, camY, dt) {
    if (this.wind) this.wind.update(dt, { x: camX, y: camY, z: camZ });

    const t0 = performance.now();
    this._ensureRegion(camX, camZ);
    for (const ring of this._rings) this._recentre(ring, camX, camZ);
    const built = this._drainQueue(t0);
    this.stats.buildMs = performance.now() - t0;
    this.stats.built += built;

    this._draw();
  }

  /** One `Terrain` for every ring, rebuilt only when the car leaves the box it covers. */
  _ensureRegion(camX, camZ) {
    if (this._terrain && Math.abs(camX - this._regionX) < REGION_DRIFT && Math.abs(camZ - this._regionZ) < REGION_DRIFT) {
      return;
    }
    this._terrain = new Terrain(
      this.seed,
      camX - REGION_HALF,
      camZ - REGION_HALF,
      camX + REGION_HALF,
      camZ + REGION_HALF,
      90
    );
    this._regionX = camX;
    this._regionZ = camZ;
  }

  /**
   * Slide a ring onto its new centre. Chunks are PERMUTED between slots — a ring shift
   * moves every chunk's slot index but not its world position, so all that actually needs
   * rebuilding is the row that entered plus any chunk that has come close enough to need a
   * bigger buffer than it is carrying.
   */
  _recentre(ring, camX, camZ) {
    const cs = ring.R.cs;
    const ox = Math.floor(camX / cs);
    const oz = Math.floor(camZ / cs);
    if (ring.ready && ox === ring.ox && oz === ring.oz) return;

    const g = ring.grid;
    const half = ring.half;
    if (ring.ready) {
      const dx = ox - ring.ox;
      const dz = oz - ring.oz;
      const src = ring.slots;
      const dst = ring.scratch;
      const stamp = ++ring.stamp;
      dst.fill(null);
      for (let j = -half; j <= half; j++) {
        const sj = j + dz;
        if (sj < -half || sj > half) continue;
        for (let i = -half; i <= half; i++) {
          const si = i + dx;
          if (si < -half || si > half) continue;
          const c = src[(sj + half) * g + (si + half)];
          if (!c) continue;
          c.stamp = stamp;
          dst[(j + half) * g + (i + half)] = c;
        }
      }
      for (let k = 0; k < src.length; k++) {
        const c = src[k];
        if (c && c.stamp !== stamp) this._release(ring, c);
      }
      ring.slots = dst;
      ring.scratch = src;
    }
    ring.ox = ox;
    ring.oz = oz;
    ring.ready = true;

    for (let n = 0; n < ring.order.length; n++) {
      const k = ring.order[n];
      const need = ring.cap[k];
      const old = ring.slots[k];
      if (old && old.cap >= need) continue; // migrated content is already correct
      const i = (k % g) - half;
      const j = ((k / g) | 0) - half;
      const c = this._acquire(ring, need);
      if (old) {
        // Same ground, more blades wanted. Carry the survivors, the write cursor and the
        // lattice across so the queue only has to walk the new tail of the template — and
        // so the chunk keeps drawing, at its old density, while it waits its turn.
        this._carryOver(old, c);
        this._release(ring, old);
        this.stats.extended++;
      } else {
        c.cx = ox + i;
        c.cz = oz + j;
      }
      c.wantFrac = ring.capFrac[k];
      ring.slots[k] = c;
    }
  }

  /** Move one chunk's built state into a bigger buffer. Typed-array copies, no rebuild. */
  _carryOver(old, c) {
    c.iPos.set(old.iPos.subarray(0, old.count * 2));
    c.iGrd.set(old.iGrd.subarray(0, old.count));
    c.iTint.set(old.iTint.subarray(0, old.count * 4));
    c.lat.set(old.lat);
    c.count = old.count;
    c.built = old.built;
    c.cx = old.cx;
    c.cz = old.cz;
    c.wx = old.wx;
    c.wy = old.wy;
    c.wz = old.wz;
    c.minY = old.minY;
    c.ySpan = old.ySpan;
    c.frac = old.frac;
    c.mesh.position.copy(old.mesh.position);
    c.mesh.scale.y = old.ySpan;
    c.aPos.needsUpdate = true;
    c.aGrd.needsUpdate = true;
    c.aTint.needsUpdate = true;
    c.dirty = true;
  }

  _acquire(ring, need) {
    let best = -1;
    for (let i = 0; i < ring.pool.length; i++) {
      const c = ring.pool[i];
      if (c.cap < need) continue;
      if (best < 0 || c.cap < ring.pool[best].cap) best = i;
    }
    if (best >= 0) {
      const c = ring.pool.splice(best, 1)[0];
      // Its content belongs to wherever it used to be. Drawing it at the old position while
      // another chunk is already covering that ground would double the sward there, so it
      // stays dark until the queue reaches it. (A densening overwrites all of this in
      // _carryOver — the chunk is the same ground and goes on drawing.)
      c.count = 0;
      c.built = 0;
      c.dirty = true;
      return c;
    }
    const c = new GrassChunk(ring, need);
    this._group.add(c.mesh);
    this.stats.chunks++;
    this.stats.bytes += need * 10;
    return c;
  }

  _release(ring, chunk) {
    chunk.mesh.visible = false;
    chunk.dirty = true;
    ring.pool.push(chunk);
    // The pool exists to stop GL buffer churn, not to hoard. A ring shift frees at most one
    // row, so anything past a row and a half is a buffer whose size class has gone out of
    // use — hand it back.
    const keep = ring.grid + 2;
    while (ring.pool.length > keep) {
      let worst = 0;
      for (let i = 1; i < ring.pool.length; i++) if (ring.pool[i].cap > ring.pool[worst].cap) worst = i;
      const c = ring.pool.splice(worst, 1)[0];
      this._group.remove(c.mesh);
      c.dispose();
      this.stats.chunks--;
      this.stats.bytes -= c.cap * 10;
    }
  }

  /** Rebuild dirty chunks, nearest ring first, until the frame's budget is gone. */
  _drainQueue(t0) {
    let built = 0;
    let dirty = 0;
    for (const ring of this._rings) {
      for (let n = 0; n < ring.order.length; n++) {
        const c = ring.slots[ring.order[n]];
        if (!c || !c.dirty) continue;
        dirty++;
        if (performance.now() - t0 >= this.budgetMs) continue;
        this._buildChunk(ring, c);
        built++;
      }
    }
    this.stats.dirty = dirty;
    return built;
  }

  /**
   * Sample the terrain on this chunk's lattice, then walk the ring's shuffled template and
   * keep the blades that survive biome density, the carriageway and the slope. A chunk that
   * has already been walked (`built > 0`) is only being DENSENED, so it resumes from its
   * cursor against its cached lattice — same ground, same answers, a third of the work.
   */
  _buildChunk(ring, chunk) {
    const R = ring.R;
    const cs = R.cs;
    const L = R.lat;
    const N = L + 1;
    const lat = chunk.lat;
    const x0 = chunk.cx * cs;
    const z0 = chunk.cz * cs;

    if (chunk.built === 0) {
      const T = this._terrain;
      const step = cs / L;

      /* Canopy shade at the chunk's four CORNERS, interpolated across the lattice below.
       * `canopyShade` is fbm and costs ~0.8 µs — a per-node lookup would be 225 of them on
       * every chunk build and this is the tightest budget in the renderer. Four is enough:
       * the forest field's finest grain is a 265 m wavelength and a grass chunk is at most
       * 160 m across, and because neighbouring chunks share their corner samples the
       * interpolation is continuous — no density step at a chunk seam. */
      const s00 = canopyShade(x0, z0, this.seed);
      const s10 = canopyShade(x0 + cs, z0, this.seed);
      const s01 = canopyShade(x0, z0 + cs, this.seed);
      const s11 = canopyShade(x0 + cs, z0 + cs, this.seed);

      // pass 1 — ground, biome scalars, carriageway
      let minY = Infinity;
      let maxY = -Infinity;
      for (let j = 0; j < N; j++) {
        const z = z0 + j * step;
        const tv = j / L;
        const sA = s00 + (s01 - s00) * tv;
        const sB = s10 + (s11 - s10) * tv;
        for (let i = 0; i < N; i++) {
          const x = x0 + i * step;
          const shade = sA + (sB - sA) * (i / L);
          const y = T.height(x, z);
          const w = T.weights(x, z).w;
          let g = 0;
          let dry = 0;
          let snow = 0;
          let wet = 0;
          for (let b = 0; b < BIOME_COUNT; b++) {
            const wb = w[b];
            if (wb < 0.002) continue;
            g += wb * SCAT_GRASS[b];
            dry += wb * TINT_DRY[b];
            snow += wb * TINT_SNOW[b];
            wet += wb * TINT_WET[b];
          }
          // The carriageway is bald. 'edge' is the tarmac mask, so the verge — where the
          // carve mask is high but the edge mask is falling — keeps its grass, which is
          // what makes a road read as cut into the land rather than mown around.
          const edge = T.roads.carve(x, z).edge;
          const k = (j * N + i) * 5;
          lat[k] = y;
          lat[k + 1] = g * (1 - clamp01(edge)) * (1 - CANOPY_THIN * shade);
          lat[k + 2] = dry;
          lat[k + 3] = snow;
          lat[k + 4] = wet;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      // pass 2 — slope, straight off the lattice. Four extra height() calls per node for a
      // real normal would have been 80% of the cost of this whole function.
      for (let j = 0; j < N; j++) {
        const jm = j > 0 ? j - 1 : j;
        const jp = j < N - 1 ? j + 1 : j;
        const dz = (jp - jm) * step;
        for (let i = 0; i < N; i++) {
          const im = i > 0 ? i - 1 : i;
          const ip = i < N - 1 ? i + 1 : i;
          const dx = (ip - im) * step;
          const gx = (lat[(j * N + im) * 5] - lat[(j * N + ip) * 5]) / dx;
          const gz = (lat[(jm * N + i) * 5] - lat[(jp * N + i) * 5]) / dz;
          const ny = 1 / Math.sqrt(gx * gx + gz * gz + 1);
          lat[(j * N + i) * 5 + 1] *= smoothstep(SLOPE_N0, SLOPE_N1, ny);
        }
      }

      chunk.minY = minY;
      chunk.ySpan = Math.max(maxY - minY, 0.5);
      chunk.wx = x0 + cs * 0.5;
      chunk.wz = z0 + cs * 0.5;
      chunk.wy = minY + chunk.ySpan * 0.5;
      chunk.count = 0;
    }

    // pass 3 — the blades
    const minY = chunk.minY;
    const invSpan = 1 / chunk.ySpan;
    const tpl = ring.tpl;
    const cap = chunk.cap;
    const iPos = chunk.iPos;
    const iGrd = chunk.iGrd;
    const iTint = chunk.iTint;
    const seed = this.seed;
    const cx = chunk.cx;
    const cz = chunk.cz;
    let out = chunk.count;
    for (let n = chunk.built; n < cap; n++) {
      const ux = tpl[n * 2];
      const uz = tpl[n * 2 + 1];
      const fx = ux * INV_U16 * L;
      const fz = uz * INV_U16 * L;
      let ix = fx | 0;
      if (ix > L - 1) ix = L - 1;
      let iz = fz | 0;
      if (iz > L - 1) iz = L - 1;
      const tx = fx - ix;
      const tz = fz - iz;
      const k00 = (iz * N + ix) * 5;
      const k10 = k00 + 5;
      const k01 = k00 + N * 5;
      const k11 = k01 + 5;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;

      const dens = lat[k00 + 1] * w00 + lat[k10 + 1] * w10 + lat[k01 + 1] * w01 + lat[k11 + 1] * w11;
      if (dens <= 0.004) continue;
      // The coin is hashed from (chunk, template index), never from the world position the
      // shader's own thinning hash uses: if the two hashes correlated, the field would thin
      // in stripes instead of uniformly.
      if (hash3i(cx, cz, n, seed) * INV_U32 > dens) continue;

      const y = lat[k00] * w00 + lat[k10] * w10 + lat[k01] * w01 + lat[k11] * w11;
      const dry = lat[k00 + 2] * w00 + lat[k10 + 2] * w10 + lat[k01 + 2] * w01 + lat[k11 + 2] * w11;
      const snow = lat[k00 + 3] * w00 + lat[k10 + 3] * w10 + lat[k01 + 3] * w01 + lat[k11 + 3] * w11;
      const wet = lat[k00 + 4] * w00 + lat[k10 + 4] * w10 + lat[k01 + 4] * w01 + lat[k11 + 4] * w11;

      iPos[out * 2] = ux;
      iPos[out * 2 + 1] = uz;
      iGrd[out] = ((y - minY) * invSpan * 65535) | 0;
      const o4 = out * 4;
      iTint[o4] = (clamp01(dry) * 255) | 0;
      iTint[o4 + 1] = (clamp01(snow) * 255) | 0;
      iTint[o4 + 2] = (clamp01(wet) * 255) | 0;
      iTint[o4 + 3] = (clamp01(dens) * 255) | 0;
      out++;
    }

    chunk.count = out;
    chunk.built = cap;
    chunk.aPos.needsUpdate = true;
    chunk.aGrd.needsUpdate = true;
    chunk.aTint.needsUpdate = true;

    // Position drives the depth sort AND, via the model matrix, everything the vertex
    // shader needs that is constant across the chunk: the origin, the ground-height range
    // (Y scale) and the density fraction the CPU drew (X scale). None of it costs a uniform
    // upload and none of it costs a pow() per vertex.
    chunk.mesh.position.set(chunk.wx, chunk.minY, chunk.wz);
    chunk.mesh.scale.y = chunk.ySpan;
    chunk.frac = chunk.wantFrac;
    chunk.dirty = false;
  }

  /**
   * Distance bands, cone cull and the per-chunk instance count. No allocation.
   *
   * edited by AI: reads the TRUE camera position/direction (`U.uCamPos`/`U.uCull`, already
   * refreshed by main.js earlier in the same frame — see `U.uCamPos.value.copy(camera.position)`
   * ahead of every `grass.update()` call) instead of the car position `update()` receives.
   * Operator report: "cinematic cam shows grass popping out of existence behind car."
   *
   * Root cause, confirmed by reading main.js's own frame loop: `grass.update(car.x, car.z,
   * car.y, dt)` is called with the CAR's position (the one caller in this file that is NOT
   * `camera.position` — flora/water/clouds/wind all get the real camera). That is fine for
   * ring RESIDENCY (`_recentre`/`_ensureRegion` stay keyed to the car on purpose, see the
   * file banner's point 4 — the sward under and around the car must stay built regardless of
   * where the camera roams), but this function used the SAME car-relative point for VISIBILITY
   * too: the cone-cull test compares a chunk's offset from the point passed in against
   * `uCull.xy`, which is always the true camera's forward direction. The sport camera sits
   * within about 6-7 m of the car and pointed much the same way, so the two rarely disagree.
   * `src/car/camera.js`'s DRIFT orbit (auto-drive only) swings the rig up to roughly 20 m out
   * and up to ~45 deg off the car's own heading while looking back across it — at that point
   * a chunk can be squarely inside the true camera's view and still fail a test measured from
   * 20 m and 45 deg away, so an already-built, already-resident chunk gets `mesh.visible =
   * false` for a frame or several as the orbit sweeps — which is exactly "grass popping out of
   * existence", since nothing about the chunk's own data changed. Traced with
   * `tools/diag-grasscine.mjs`, which reproduces the real DRIFT orbit's position/angle
   * envelope; see its output for the before/after ring-residency trace. Distance bands move to
   * the true camera too, for the same reason the shader's own per-blade density already uses
   * it — consistency, not just the cull.
   */
  _draw() {
    const trueCam = U.uCamPos.value;
    const cull = U.uCull.value;
    let drawn = 0;
    for (const ring of this._rings) {
      const R = ring.R;
      const cs = R.cs;
      const nearW = Math.max(7, R.near * 0.26);
      const farW = R.far * 0.26;
      const slots = ring.slots;
      for (let k = 0; k < slots.length; k++) {
        const c = slots[k];
        if (!c) continue;
        const mesh = c.mesh;
        if (c.count === 0) {
          mesh.visible = false;
          continue;
        }
        const dx = c.wx - trueCam.x;
        const dy = c.wy - trueCam.y;
        const dz = c.wz - trueCam.z;
        const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dd - cs * 0.75 > R.far) {
          mesh.visible = false;
          continue;
        }
        if (dd + cs * 0.75 < R.near - nearW) {
          mesh.visible = false;
          continue;
        }
        // Horizontal cone cull against the same vector the vertex shader uses, padded by
        // the chunk's own radius so a chunk straddling the frustum edge is never dropped.
        if (dd > cs * 1.6) {
          const inv = 1 / Math.sqrt(dx * dx + dz * dz || 1);
          const pad = (cs * 0.75) / dd;
          if ((dx * cull.x + dz * cull.y) * inv < cull.z - pad) {
            mesh.visible = false;
            continue;
          }
        }

        // The density law at the chunk's NEAREST point, so it is always an over-estimate:
        // the vertex shader then thins each blade against its own distance. The CPU may
        // over-draw but never under-draw, or the chunk would show a hard density seam at
        // its near edge.
        const nx = Math.max(Math.abs(dx) - cs * 0.5, 0);
        const nz = Math.max(Math.abs(dz) - cs * 0.5, 0);
        const dNear = Math.max(Math.sqrt(nx * nx + nz * nz + dy * dy), R.dn);
        const dens = Math.min(1, Math.pow(R.dn / dNear, DENS_POW));

        let f = 1;
        if (R.near > 0.01) f *= smoothstep(R.near - nearW - cs * 0.6, R.near + nearW, dd);
        f *= 1 - smoothstep(R.far - farW, R.far + cs * 0.6, dd);

        // A chunk holds a fraction 'frac' of full density, so it can never be asked for more
        // than that — and the shader must be told the fraction it is actually looking at, or
        // it would thin a chunk that is already as thin as it can get.
        const cf = c.frac;
        const keep = Math.min(dens, cf);
        const n = Math.round(c.count * (keep / cf) * clamp01(f));
        if (n <= 0) {
          mesh.visible = false;
          continue;
        }
        mesh.visible = true;
        mesh.scale.x = keep;
        c.geom.instanceCount = n;
        drawn += n;
      }
    }
    this.stats.drawn = drawn;
  }

  dispose() {
    for (const ring of this._rings) {
      for (const c of ring.slots) if (c) c.dispose();
      for (const c of ring.pool) c.dispose();
      ring.slots.fill(null);
      ring.pool.length = 0;
      ring.mat.dispose();
      if (ring.preMat) ring.preMat.dispose();
    }
    this._group.clear();
    if (this._group.parent) this._group.parent.remove(this._group);
    this._rings.length = 0;
    this.stats.chunks = 0;
    this.stats.bytes = 0;
  }
}

/* ── slot capacity ──────────────────────────────────────────────────────────
 * A slot sits at a fixed offset from the car's snapped chunk, so the range of distances it
 * can ever be at is known once, at construction. Its buffer is sized for the densest it
 * could ever legitimately be — the peak of law x fadeIn x fadeOut over that range — and
 * never resized while it stays in that slot. Sizing every slot for the ring's peak instead
 * would cost 5 M instances a ring; sizing them individually costs 3.3 M for all four.
 */
function slotCapFrac(R, i, j) {
  const nearW = Math.max(7, R.near * 0.26);
  const farW = R.far * 0.26;
  const dNear = Math.hypot(Math.max(Math.abs(i) - 1, 0) * R.cs, Math.max(Math.abs(j) - 1, 0) * R.cs);
  if (dNear > R.far) return 0;
  const dFar = Math.hypot((Math.abs(i) + 1) * R.cs, (Math.abs(j) + 1) * R.cs);
  let best = 0;
  const steps = 24;
  for (let s = 0; s <= steps; s++) {
    const d = dNear + ((dFar - dNear) * s) / steps;
    const law = Math.min(1, Math.pow(R.dn / Math.max(d, R.dn), DENS_POW));
    const fi = R.near <= 0.01 ? 1 : smoothstep(R.near - nearW, R.near + nearW, d);
    const fo = 1 - smoothstep(R.far - farW, R.far, d);
    const v = law * fi * fo;
    if (v > best) best = v;
  }
  return best;
}
