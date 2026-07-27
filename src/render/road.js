/* Wanderoad — the road you can actually see.
 *
 * The first playable build drew roads as a tint inside the terrain shader. It was cheap and
 * it was invisible: the player's verdict was "no roads to follow", which is fatal in a game
 * whose entire challenge is staying on one.
 *
 * So the road is now real geometry: a ribbon swept along each spline, laid a few centimetres
 * proud of the ground, with a painted surface, edge lines, a dashed centre line, marker
 * posts down both shoulders and warning chevrons on the bends. It is built in a rolling
 * window around the car rather than per terrain chunk, because a road is a line and the
 * terrain is a grid — chunking a line means rebuilding the same ribbon at four different
 * LODs and stitching the seams for no benefit.
 *
 * Everything is deterministic from the road network, so two players see the same white
 * lines in the same places.
 */

import {
  BufferGeometry,
  BufferAttribute,
  Mesh,
  Object3D,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
  RawShaderMaterial,
  DoubleSide,
  FrontSide,
} from 'three';
import { vertHead, fragHead, GL_HASH, GL_NOISE, GL_SKY, GL_SHADOW, GL_LIGHT, glCloudField } from '../core/glsl.js';
import { sharedUniforms } from './uniforms.js';
import { RoadField, TIERS } from '../world/roads.js';
import { Terrain, landFn, waterFn } from '../world/terrain.js';
import { hash2i, clamp01, lerp } from '../core/math.js';
import { RGB } from '../core/palette.js';
import { PB, pbox, pcyl, finishPainted, createPaintedMaterial, MAT } from './painted.js';

/** How far from the car road geometry exists. Beyond this the terrain tint carries it. */
const RANGE = 1900;
/** Metres the ribbon floats above the carved ground, to beat z-fighting without a visible lip. */
export const LIFT = 0.07;
/** Cross-section: how many strips across the ribbon. 4 gives kerb / lane / lane / kerb. */
const ACROSS = 6;
/** Marker posts down the shoulder, in metres. Real roads use 50 m; 28 reads better at speed. */
const POST_SPACING = 28;
/** The COARSEST a vertex ring may be, in metres. Everything below is the refinement of it. */
const RING_STEP = 6;
/**
 * How far the drawn tarmac is allowed to depart from the ground BETWEEN two rings, in metres.
 *
 * Every ribbon vertex sits on Terrain.height() exactly (diag-seam S2 measures 0.006 m), but a
 * ribbon is triangles, and a triangle is a straight line between two of those vertices. Where
 * the carved ground turns sharply inside one 6 m ring gap the chord flies over it, and that
 * gap — not the vertex heights, not LIFT — is the whole of the operator's "falling through the
 * road": measured over 421560 points on the carriageway, 77 of them had the drawn surface more
 * than 0.3 m above Terrain.height(), worst 0.877 m, and in ALL 77 the along-the-road chord
 * accounted for the error while the across-the-road one contributed nothing.
 *
 * The ground turns like that where two roads' earthworks overlap: the carve blends them, so
 * the shelf swings between one road's level and the other's over the width of a batter, which
 * is metres, not tens of metres. Uniform refinement is the wrong lever for it — measured, 1.5 m
 * rings (four times the geometry everywhere) still left 0.533 m — because the feature is
 * local. Bisecting only where the chord actually misses costs the geometry where the miss is.
 *
 * 5 cm is below the 7 cm the ribbon is lifted by, so the drawn surface cannot reach the ground
 * even at the worst allowed sag. Loosening it to 10 cm halves the extra geometry and still
 * clears the check; it is left at 5 cm because the cost is in the TEST, not in the rings the
 * test asks for — 0.18 m tolerance still measured 1563 ms against 1587 ms for 0.05 m.
 */
const RING_TOL = 0.05;
/**
 * Bisections allowed per ring gap. 4 takes 6 m down to 0.375 m.
 *
 * A cap, not a target, and it has to be one: where Terrain.height() genuinely STEPS — it does,
 * by up to 0.5 m, wherever carve()'s nearest edge flips from a lane to an arterial and the
 * batter's half-width jumps with it — no tolerance is ever satisfied and the recursion would
 * run to the float grid. Measured, deeper is not better across that kind of step: depth 6 and
 * depth 8 both leave the same ~0.3 m residual as depth 4, because half a step is half a step
 * however finely you chop the approach to it. Depth 4 is where the CONTINUOUS misses are gone.
 */
const RING_DEPTH = 4;

const ROAD_VS = /* glsl */ `
in vec3 normal;
in vec2 aCross;   // x = -1..1 across the carriageway, y = metres travelled along it
out vec3 vWorld;
out vec3 vNormal;
out vec2 vCross;
out float vDist;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vCross = aCross;
  vDist = length(wp.xyz - uCamPos);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ROAD_FS = /* glsl */ `
in vec3 vWorld;
in vec3 vNormal;
in vec2 vCross;
in float vDist;
out vec4 fragColor;

uniform float uLineMix;   // 0 = unmarked track, 1 = fully marked road
uniform vec3  uSurfLit;
uniform vec3  uSurfShade;

void main(){
  float across = vCross.x;          // -1 .. 1
  float along  = vCross.y;          // metres
  float a = abs(across);

  // Surface: two large wear streaks where the wheels run, plus a fine chip grain. The
  // streaks are what make a road read as USED, and used is what makes it read as a road.
  float wear  = smoothstep(0.62, 0.30, abs(a - 0.46));
  float chip  = vn2(vWorld.xz * 3.4) * 0.5 + vn2(vWorld.xz * 11.0) * 0.5;
  vec3 lit   = uSurfLit   * mix(1.0, 1.09, wear) * mix(0.95, 1.05, chip);
  vec3 shade = uSurfShade * mix(1.0, 0.93, wear);
  vec3 mid   = mix(lit, shade, 0.5);

  // ── markings ────────────────────────────────────────────────────────────
  // Generated from the ribbon's own coordinates, never from a texture: a texture would need
  // a UV atlas, a mip chain and an alignment pass, and would still shimmer at 250 km/h.
  float px = fwidth(across) * 1.6 + 1e-5;

  // continuous edge lines just inside the shoulder
  float edge = smoothstep(0.90 + px, 0.90 - px, a) * smoothstep(0.80 - px, 0.80 + px, a);
  // dashed centre line: 3 m of paint, 6 m of gap, which is close enough to real road
  // marking that it reads correctly at a glance
  float dash = step(fract(along / 9.0), 0.34);
  float centre = smoothstep(0.055 + px, 0.055 - px, a) * dash;

  // 'mark', not 'paint': paint() is the shared lighting function and a float of the same
  // name shadows it, which fails to compile with a message that points somewhere else.
  float mark = clamp(edge + centre, 0.0, 1.0) * uLineMix;
  vec3 markCol = mix(K_LINE_W, K_LINE_W * 0.86, wear * 0.7);
  lit   = mix(lit,   markCol,        mark);
  mid   = mix(mid,   markCol * 0.9,  mark);
  shade = mix(shade, markCol * 0.62, mark);

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vWorld, ndl) * cloudShadow(vWorld);

  Surf s;
  s.N = N; s.V = V; s.P = vWorld;
  s.shade = shade; s.mid = mid; s.lit = lit;
  s.soft = 0.20; s.jit = (vn2(vWorld.xz * 0.7) - 0.5) * 0.05;
  s.shadow = sh; s.trans = 0.0; s.transCol = vec3(0.0);
  s.rim = 0.08; s.ao = 1.0; s.ambient = 1.0;

  vec3 col = paint(s);
  col = aerial(col, vDist, V, vWorld.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;

function createRoadMaterial() {
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms({
      uLineMix: { value: 1 },
      uSurfLit: { value: new Vector3(...RGB.tarmacLit) },
      uSurfShade: { value: new Vector3(...RGB.tarmacShade) },
    }),
    vertexShader: vertHead(ROAD_VS),
    fragmentShader: fragHead(GL_HASH, GL_NOISE, GL_SKY, glCloudField({ cshSpan: 9200, cloudDeck: 980 }), GL_SHADOW, GL_LIGHT, ROAD_FS),
    side: FrontSide,
    // No polygon offset. A negative offset pulls the ribbon towards the viewer in depth,
    // which stops it z-fighting the terrain but also lets it draw OVER the car sitting on
    // it — the road ate the player's own vehicle on the first build with roads. The 7 cm
    // physical lift is plenty of separation on its own.
  });
}

/**
 * The edges the ribbon is swept along, with the ONE road elevation on them.
 *
 * This used to be `edgesInBox` plus a private `profileEdge` call, and the comment next to it
 * said the ribbon and the shelf could never disagree because they came from one function.
 * That stopped being true the day roads that cross were made to meet at the same height:
 * RoadField profiles an edge AND THEN levels it, the terrain carves towards the levelled
 * height, and the ribbon was still being drawn at the unlevelled one. Up to 24 m apart on a
 * lane with several crossings — the player drove out from under a road that was still being
 * drawn, and a FrontSide ribbon is invisible from below, so the road simply vanished.
 *
 * There is no second profile any more. The field is the same class the terrain uses, and
 * buildRibbon below takes every vertex height from Terrain.height() itself, so the tarmac
 * lies on the shelf BY CONSTRUCTION rather than by agreement. tools/diag-seam.mjs asserts it.
 */
export function ribbonEdges(seed, x0, z0, x1, z1) {
  const s = seed >>> 0;
  const field = new RoadField(x0, z0, x1, z1, s, landFn(s), 40, waterFn(s));
  return { edges: field.edges, ctx: s };
}

/**
 * Sweep one road edge into a ribbon. Returns a BufferGeometry in world coordinates, which
 * is fine because road geometry only exists within ~2 km of the player.
 *
 * Every vertex height is `Terrain.height()` — the very function the car's wheels ask — so the
 * drawn surface IS the drivable surface, to the millimetre, plus the deliberate 7 cm of lift.
 * Exported so tools/diag-seam.mjs and tools/diag-fallthrough.mjs can measure the triangles the
 * player is actually looking at instead of a replica of them.
 */
export function buildRibbon(edge, seed) {
  const n = edge.pts.length / 2;
  /* THE GROUND, from the same class the car's wheels ask. Not a reproduction of it — this
   * file has now twice been the place where a second opinion about where the road is grew
   * into a hole the player falls through, and the only way that cannot happen again is for
   * there to be no second opinion.
   *
   * The sampler covers THIS EDGE end to end, not the caller's window. An arterial is 2.4 km
   * long and the window is 3.8 km across, so most of a ribbon near the window's border hangs
   * outside it, and carve() blends over neighbours up to 78 m away that the window's edge
   * list does not contain out there: measured, the drawn tarmac sat 18.1 m above the ground
   * at the far end of arterial 0:0,-1,1 on seed 7. Terrain's own road field pads itself to
   * the carve reach, and its climate grid is snapped to a world lattice, so this sampler and
   * the car's 840 m one return bit-identical heights where they overlap. */
  const s = seed >>> 0;
  const terr = new Terrain(s, edge.minX, edge.minZ, edge.maxX, edge.maxZ, 96);
  /* Resample: the network stores 10–14 points per edge, which is enough for a curve but far
   * too coarse for a surface that must sit on rolling ground. One vertex ring every ~6 m —
   * AND THEN as many more as the ground under this particular six metres turns out to need.
   *
   * The refinement is done per polyline segment, which is why it lives inside this loop: a
   * segment is straight, so the ribbon's right-hand normal is constant along it and the two
   * kerb lines a candidate ring would carry are known without having to build the ring first.
   * The three probes are the two kerbs and the crown. The kerbs because that is mostly where
   * the miss is — of the 77 measured, 61 were in the outer half of the carriageway and 23 on
   * the kerb line itself, a kerb being what runs through the neighbouring road's earthwork.
   * The crown because the other 4 were ON it, and the crown is what the car and the roadside
   * furniture stand on: probing only the kerbs would have left those four. */
  const halfW = edge.width * 0.5;
  const ring = [];
  for (let k = 0; k < n - 1; k++) {
    const ax = edge.pts[k * 2],
      az = edge.pts[k * 2 + 1];
    const bx = edge.pts[k * 2 + 2],
      bz = edge.pts[k * 2 + 3];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / RING_STEP));
    // right-hand normal of THIS segment, in the ground plane
    const sx = (bx - ax) / (len || 1);
    const sz = (bz - az) / (len || 1);
    const nx = sz;
    const nz = -sx;
    /** Ground at the crown and both kerbs of the ring that parameter t would carry. */
    const probe = (t) => {
      const x = lerp(ax, bx, t),
        z = lerp(az, bz, t);
      return [
        terr.height(x - nx * halfW, z - nz * halfW),
        terr.height(x, z),
        terr.height(x + nx * halfW, z + nz * halfW),
      ];
    };
    /* `h` is the probe, kept ON the ring: the two kerb figures ARE the f = -1 and f = +1
     * vertices of this ring and the vertex pass below reads them back instead of asking the
     * terrain a second time. Free everywhere except at a polyline joint, where the ribbon
     * mitres its cross-section across two segment directions and the probe — taken along one
     * of them — is not the vertex; `joint` marks those, and they are re-sampled honestly.
     * Without this the refinement doubled the cost of a ribbon (738 ms -> 1876 ms over the
     * standard 185-edge window) purely in duplicated height samples. */
    const push = (t, h, joint) =>
      ring.push({ x: lerp(ax, bx, t), z: lerp(az, bz, t), y: lerp(edge.y[k], edge.y[k + 1], t), h, joint });
    /* Bisect (t0, t1) wherever the chord between the rings at its ends misses the ground in
     * the middle by more than RING_TOL, and emit the interior points in order. Recursive, and
     * bounded by RING_DEPTH rather than by tolerance alone: a genuine step in the ground never
     * satisfies a tolerance however far you cut it, and an unbounded loop on one is how a road
     * ribbon turns into a million triangles at one junction. */
    const bisect = (t0, p0, t1, p1, depth) => {
      const tm = (t0 + t1) * 0.5;
      const pm = probe(tm);
      let err = 0;
      for (let i = 0; i < 3; i++) {
        const e = Math.abs((p0[i] + p1[i]) * 0.5 - pm[i]);
        if (e > err) err = e;
      }
      if (err <= RING_TOL || depth >= RING_DEPTH) return;
      bisect(t0, p0, tm, pm, depth + 1);
      push(tm, pm, false);
      bisect(tm, pm, t1, p1, depth + 1);
    };
    let pPrev = probe(0);
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      const pNext = probe(t1);
      push(t0, pPrev, s === 0);
      bisect(t0, pPrev, t1, pNext, 0);
      pPrev = pNext;
    }
  }
  const last = n - 1;
  ring.push({ x: edge.pts[last * 2], z: edge.pts[last * 2 + 1], y: edge.y[last], h: null, joint: true });

  const rings = ring.length;
  const verts = rings * ACROSS;
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const across = new Float32Array(verts * 2);
  const index = new Uint32Array((rings - 1) * (ACROSS - 1) * 6);

  const half = halfW;
  let travelled = 0;

  for (let i = 0; i < rings; i++) {
    const p = ring[i];
    const q = ring[Math.min(i + 1, rings - 1)];
    const o = ring[Math.max(i - 1, 0)];
    let tx = q.x - o.x;
    let tz = q.z - o.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // right-hand normal in the ground plane
    const rx = tz;
    const rz = -tx;
    if (i > 0) travelled += Math.hypot(p.x - ring[i - 1].x, p.z - ring[i - 1].z);

    // The refinement probe already carved this ring's two kerbs, and away from a joint the
    // probe's cross-section IS the vertex cross-section. reuse[j] is that answer, or null.
    const kerb = p.h && !p.joint ? p.h : null;

    for (let j = 0; j < ACROSS; j++) {
      const f = (j / (ACROSS - 1)) * 2 - 1; // -1 .. 1
      const wx = p.x + rx * f * half;
      const wz = p.z + rz * f * half;
      const k = i * ACROSS + j;
      position[k * 3] = wx;
      position[k * 3 + 2] = wz;
      /* The ground here, and nothing else. The old line read `p.y + camber`, where p.y was
       * the road's own unlevelled profile and `camber` a private copy of terrain's 0.18 —
       * two independent ways of missing the same surface, and up to 24 m of miss.
       *
       * Asked at the coordinates that were STORED, not the ones that were computed. position
       * is a Float32Array: 2361.105224609375 is what a world x of 2361.1052322 becomes, about
       * 2e-4 m away, and where the carved ground steps — it does, by up to 0.5 m, wherever
       * carve()'s nearest edge flips from a lane to an arterial — that 2e-4 m of rounding
       * reads back a height 8.7 cm from the one written. Every consumer that re-samples the
       * ground at a vertex's own stored position sees that as a vertex off the ground:
       * diag-seam S2 does exactly that, and so does the live harness's downward raycast. */
      const g = kerb && j === 0 ? kerb[0] : kerb && j === ACROSS - 1 ? kerb[2] : terr.height(position[k * 3], position[k * 3 + 2]);
      position[k * 3 + 1] = g + LIFT;
      normal[k * 3] = 0;
      normal[k * 3 + 1] = 1;
      normal[k * 3 + 2] = 0;
      across[k * 2] = f;
      across[k * 2 + 1] = travelled;
    }
    /* The ring's own height. furnitureFor() hangs the marker posts and the chevron boards off
     * it, so they stand on the shelf with the road instead of on the road's old profile. The
     * probe's middle figure is the ground ON the centreline; ACROSS is even, so there is no
     * vertex there and without the probe it has to be averaged off the two either side. */
    const mid = i * ACROSS + (ACROSS >> 1);
    p.y = p.h ? p.h[1] : (position[(mid - 1) * 3 + 1] + position[mid * 3 + 1]) * 0.5 - LIFT;
  }

  let t = 0;
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < ACROSS - 1; j++) {
      const a = i * ACROSS + j;
      const b = a + 1;
      const c = a + ACROSS;
      const d = c + 1;
      index[t++] = a;
      index[t++] = c;
      index[t++] = b;
      index[t++] = b;
      index[t++] = c;
      index[t++] = d;
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setAttribute('aCross', new BufferAttribute(across, 2));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return { geometry: g, ring, half };
}

/**
 * Roadside furniture for one edge: marker posts down both shoulders, and a chevron board on
 * the outside of any bend tight enough to need warning. Real roads warn you before a corner;
 * that is precisely the information a driver needs and the reason signs exist at all.
 */
function furnitureFor(edge, ring, half, seed) {
  const items = [];
  let dist = 0;
  let chevDist = Infinity;
  let posts = 0;
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i];
    const o = ring[i - 1];
    const stride = Math.hypot(p.x - o.x, p.z - o.z);
    dist += stride;
    chevDist += stride;

    let tx = p.x - o.x;
    let tz = p.z - o.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const rx = tz;
    const rz = -tx;

    /* Curvature: how much the tangent turns over the next ~18 m — MEASURED IN METRES, walked
     * forward until 18 of them have gone by. It used to read `ring[i + 3]`, three rings ahead,
     * which was 18 m only while every ring gap was exactly 6. buildRibbon now bisects a gap
     * wherever the ground needs it, so three rings ahead can be a metre, and a metre of road
     * turns through nothing: the bend test would have gone quiet exactly on the tightest bends,
     * which are the ones the chevrons exist for. The same applies to the spacing below. */
    let bend = 0;
    let j = i;
    let ahead = 0;
    while (j < ring.length - 1 && ahead < 18) {
      ahead += Math.hypot(ring[j + 1].x - ring[j].x, ring[j + 1].z - ring[j].z);
      j++;
    }
    if (j > i) {
      let ux = ring[j].x - p.x;
      let uz = ring[j].z - p.z;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      bend = tx * uz - tz * ux; // signed
    }

    if (dist >= POST_SPACING) {
      dist = 0;
      // Posts alternate sides so they never form a corridor, and they are the cheapest
      // possible "the road goes this way" cue at 200 m.
      const side = posts++ & 1 ? 1 : -1;
      items.push({
        kind: 'post',
        x: p.x + rx * side * (half + 1.5),
        z: p.z + rz * side * (half + 1.5),
        y: p.y,
        yaw: Math.atan2(tx, tz),
      });
    }

    // One board per 24 m of bend, by distance. `i % 4 === 0` meant the same thing only while
    // every ring gap was 6 m; with refinement it would have stacked four boards on one post.
    if (Math.abs(bend) > 0.22 && chevDist >= 24) {
      chevDist = 0;
      const side = bend > 0 ? -1 : 1; // outside of the bend
      items.push({
        kind: 'chevron',
        x: p.x + rx * side * (half + 2.4),
        z: p.z + rz * side * (half + 2.4),
        y: p.y,
        yaw: Math.atan2(-rx * side, -rz * side),
        flip: bend > 0 ? 1 : -1,
      });
    }
  }
  void seed;
  return items;
}

/** One marker post and one chevron board, built once and instanced everywhere. */
function buildFurnitureGeometry() {
  const post = PB();
  pcyl(post, [0, 0, 0], [0, 1.05, 0], 0.075, 0.065, 6, [0.94, 0.9, 0.82], MAT.MATTE, true, true);
  pbox(post, 0, 0.92, 0.042, 0.055, 0.11, 0.01, 0, [0.92, 0.32, 0.22], MAT.MATTE);

  const chev = PB();
  pcyl(chev, [0, 0, 0], [0, 1.35, 0], 0.055, 0.05, 6, [0.42, 0.38, 0.33], MAT.MATTE, true, true);
  pbox(chev, 0, 1.45, 0, 0.6, 0.34, 0.035, 0, [0.95, 0.93, 0.86], MAT.MATTE);
  pbox(chev, -0.13, 1.45, 0.04, 0.16, 0.24, 0.01, 0.5, [0.18, 0.2, 0.24], MAT.MATTE);
  pbox(chev, 0.17, 1.45, 0.04, 0.16, 0.24, 0.01, 0.5, [0.18, 0.2, 0.24], MAT.MATTE);

  return { post: finishPainted(post), chevron: finishPainted(chev) };
}

export class Roads {
  constructor({ seed, scene, range = RANGE }) {
    this.seed = seed >>> 0;
    this.range = range;
    this.group = new Object3D();
    this.group.name = 'roads';
    scene.add(this.group);

    this.material = createRoadMaterial();
    this.paintedMaterial = createPaintedMaterial();
    this.furniture = buildFurnitureGeometry();

    this.live = new Map(); // edge key -> { mesh, posts, chevrons }
    this._lastX = Infinity;
    this._lastZ = Infinity;
    // No private land/water functions any more: ribbonEdges() builds the same RoadField the
    // terrain does, and a second height source next to it is exactly how this file drifted
    // 24 m away from the ground in the first place.
    this.stats = { edges: 0, tris: 0 };
  }

  /** Rebuild the window when the car has moved far enough to need new road. */
  update(camX, camZ) {
    if (Math.hypot(camX - this._lastX, camZ - this._lastZ) < 180) return;
    this._lastX = camX;
    this._lastZ = camZ;

    const R = this.range;
    const { edges, ctx } = ribbonEdges(this.seed, camX - R, camZ - R, camX + R, camZ + R);
    const wanted = new Set();

    for (const e of edges) {
      wanted.add(e.key);
      if (this.live.has(e.key)) continue;

      const { geometry, ring, half } = buildRibbon(e, ctx);
      const mesh = new Mesh(geometry, this.material);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);

      const items = furnitureFor(e, ring, half, this.seed);
      const posts = items.filter((i) => i.kind === 'post');
      const chevs = items.filter((i) => i.kind === 'chevron');
      const rec = { mesh, instanced: [] };
      for (const [geo, list] of [
        [this.furniture.post, posts],
        [this.furniture.chevron, chevs],
      ]) {
        if (!list.length) continue;
        const im = new InstancedMesh(geo, this.paintedMaterial, list.length);
        const m = new Matrix4();
        const q = new Quaternion();
        const pos = new Vector3();
        const scl = new Vector3(1, 1, 1);
        list.forEach((it, i) => {
          pos.set(it.x, it.y, it.z);
          q.setFromAxisAngle(new Vector3(0, 1, 0), it.yaw);
          m.compose(pos, q, scl);
          im.setMatrixAt(i, m);
        });
        im.instanceMatrix.needsUpdate = true;
        im.frustumCulled = false;
        this.group.add(im);
        rec.instanced.push(im);
      }
      this.live.set(e.key, rec);
    }

    for (const [key, rec] of this.live) {
      if (wanted.has(key)) continue;
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      for (const im of rec.instanced) {
        this.group.remove(im);
        im.dispose();
      }
      this.live.delete(key);
    }
    this.stats.edges = this.live.size;
  }

  dispose() {
    for (const [k, rec] of this.live) {
      rec.mesh.geometry.dispose();
      for (const im of rec.instanced) im.dispose();
      this.live.delete(k);
    }
    this.material.dispose();
  }
}
