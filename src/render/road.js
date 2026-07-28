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
import { RoadField, TIERS, findCrossings, outranks, edgeDeadEnds } from '../world/roads.js';
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

/* ── junctions ──────────────────────────────────────────────────────────────
 *
 * roads.js now bends a minor road's own centreline to square its crossings up towards 90
 * degrees (see `squareCrossings`), but two ribbons swept independently still meet as two
 * overlapping strips, not one surface. A junction patch fills that gap: a small paved area,
 * drawn with the SAME road material every ribbon uses, that both roads visually flow into,
 * plus give-way bars marking the minor road's approaches — the two things that make a crossing
 * read as "a junction" instead of "two ribbons crossing".
 *
 * It is a second surface layered a few centimetres above the ribbons it overlaps rather than a
 * hole cut into them, on purpose: trimming buildRibbon's own polyline to stop exactly at a
 * junction boundary would mean re-deriving its already-tuned adaptive ring refinement (RING_TOL,
 * RING_DEPTH) for a boundary case, for no benefit a cozy driving game needs. The extra lift is
 * `JUNCTION_LIFT` — comfortably more than LIFT alone, so the two surfaces never z-fight — and
 * every vertex height still comes from `Terrain.height()`, the SAME function the ribbons and the
 * car's wheels read: a junction is exactly the kind of place two independent elevation opinions
 * used to disagree by tens of metres (gotcha 6), and this file does not get to have one again.
 */

/** Extra lift, ON TOP OF `LIFT`, for the junction overlay. */
const JUNCTION_LIFT = LIFT + 0.03;
/** Target metres between patch vertices. A junction is now as long as the crossing angle makes
 *  it (see `SHALLOW_CAP`), so a fixed subdivision count would leave 8 m chords flying over the
 *  carved ground on the shallow ones — the same chord-sag bug `RING_TOL` exists for on ribbons.
 *  Sampling by DISTANCE keeps the sag where it was at 90 degrees however long the patch gets. */
const JUNCTION_STEP = 3.2;
/** Subdivisions per axis: never fewer than the 4 the square case always used, never more than
 *  a 12x12 grid (169 vertices) so one shallow junction cannot cost more than a short ribbon. */
const JUNCTION_GRID_MIN = 4;
const JUNCTION_GRID_MAX = 12;
/** How far the patch reaches past the OTHER road's carriageway edge, measured PERPENDICULAR to
 *  that road (not along the tangent), so the overhang is the same 1.6 m at every angle. */
const JUNCTION_MARGIN = 1.6;
/**
 * The most the patch may be stretched to chase a shallow crossing, as a multiple of its
 * square-crossing size.
 *
 * TWO CARRIAGEWAYS CROSSING AT ANGLE θ OVERLAP OVER A PARALLELOGRAM, NOT A SQUARE, AND THAT IS
 * THE WHOLE OF THIS ROUND'S WORST SCREENSHOT. The overlap runs `w_other / sin θ` along each
 * road's own tangent: at 90 degrees that is exactly the other road's width, which is what this
 * patch was built to cover, but at the 21-degree crossings `diag-crossing-angle.mjs` still
 * finds in the tail it is 2.8 times longer. The patch covered the middle third of the mess and
 * both roads' edge lines and centre dashes ran out from under it and crossed each other in the
 * open — "all sorts of lines everywhere, total mess", verbatim.
 *
 * Dividing by sin θ makes the patch the overlap EXACTLY rather than approximately: a point at
 * `v` metres along the minor tangent sits `v · sin θ` from the major's centreline, so
 * `v = w_major / (2 sin θ)` is precisely the major's kerb. Outside the patch at most one
 * carriageway exists, so at most one road's lines can be painted — which is the requirement.
 *
 * The cap is a safety ceiling, not a tuning knob: 1/sin θ runs to infinity as two roads become
 * parallel, and `findCrossings` will report a crossing for a pair that merely graze. 3.5
 * covers every crossing in the 12 km box (worst deviation 69.05°, θ = 20.95°, 1/sin = 2.80)
 * with room over, and stops a grazing pair from painting a 100 m runway.
 */
const SHALLOW_CAP = 3.5;
/** Metres between the patch's own edge and a give-way bar on the minor road's approach. */
const GIVE_WAY_GAP = 1.0;
/** Metres a give-way bar is thick, along the road — reads as a stop line from the driver's
 *  seat without looking like a slab dropped across the lane. */
const GIVE_WAY_THICK = 0.55;
/** `aCross` values that make the EXISTING ROAD_FS shader paint solid tarmac (no line) or a
 *  solid white bar, without a single change to that shader: 0.4 sits well clear of both the
 *  centre-dash band (~0.055) and the edge-line band (0.80-0.90); 0.85 sits in the middle of
 *  the edge-line band, so `edge` reads 1 across the WHOLE quad it is applied to instead of
 *  just a thin stripe. Reusing the shader's own painted-line detection is the point — see the
 *  task note on reusing the existing road material rather than inventing a new one. */
const AC_PLAIN = 0.4;
const AC_LINE = 0.85;

/**
 * Push a quad (four existing vertex indices, in ring order) as two triangles, winding each one
 * so its geometric normal faces +Y — checked from the actual (x, z) positions rather than
 * assumed, because a junction quad's two edges are two DIFFERENT roads' tangents, not one
 * road's tangent and its own right-hand normal the way a ribbon's cross-section always is, so
 * there is no single fixed winding rule to copy from buildRibbon's ring/across pattern.
 */
function pushQuadUp(position, index, a, b, c, d) {
  const tri = (p0, p1, p2) => {
    const x0 = position[p0 * 3],
      z0 = position[p0 * 3 + 2];
    const x1 = position[p1 * 3],
      z1 = position[p1 * 3 + 2];
    const x2 = position[p2 * 3],
      z2 = position[p2 * 3 + 2];
    // Y-component of (p1-p0) x (p2-p0), restricted to the XZ plane: positive means the
    // triangle (p0,p1,p2) already winds counter-clockwise viewed from above, i.e. front-facing
    // for a +Y normal under three.js's default CCW-front convention.
    const up = (z1 - z0) * (x2 - x0) - (x1 - x0) * (z2 - z0);
    if (up >= 0) index.push(p0, p1, p2);
    else index.push(p0, p2, p1);
  };
  tri(a, b, c);
  tri(a, c, d);
}

/** Subdivisions along one patch axis of half-extent `halfExtent`, at roughly JUNCTION_STEP
 *  metres a vertex, floored and ceiled so neither a tiny nor a very shallow junction is a
 *  surprise in the vertex budget. */
function gridSteps(halfExtent) {
  const n = Math.round((halfExtent * 2) / JUNCTION_STEP);
  return Math.max(JUNCTION_GRID_MIN, Math.min(JUNCTION_GRID_MAX, n));
}

/**
 * Walk `dist` metres along `edge`'s own polyline from the point (x, z) on segment `k`, in the
 * direction of increasing (`sign` = +1) or decreasing (-1) sample index. Returns the point and
 * the UNIT TANGENT there, pointing the way we walked — or null if the road ends first, which
 * is the honest answer for "put a marking `dist` metres up this road" when there is no road
 * that far up it.
 *
 * The tangent is taken from the segment the walk finishes on, not from where it started, so a
 * marking placed 20 m up a bending lane is square to the lane where it is painted.
 */
function walkEdge(edge, k, x, z, sign, dist) {
  const pts = edge.pts;
  const n = pts.length / 2;
  let cx = x,
    cz = z;
  let left = dist;
  for (let seg = k; seg >= 0 && seg < n - 1; seg += sign) {
    const ax = pts[seg * 2],
      az = pts[seg * 2 + 1];
    const bx = pts[seg * 2 + 2],
      bz = pts[seg * 2 + 3];
    let tx = (bx - ax) * sign,
      tz = (bz - az) * sign;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // the far end of THIS segment in the walking direction
    const ei = sign > 0 ? seg + 1 : seg;
    const ex = pts[ei * 2],
      ez = pts[ei * 2 + 1];
    const d = Math.hypot(ex - cx, ez - cz);
    if (d >= left) return { x: cx + tx * left, z: cz + tz * left, tx, tz };
    left -= d;
    cx = ex;
    cz = ez;
  }
  return null;
}

/**
 * WHERE one junction's paved patch is, as a parallelogram in the ground plane — the single
 * source of truth for the patch's footprint, used by `buildJunction` to build it and by
 * `tools/diag-junction-cover.mjs` to test whether it actually covers the two carriageways'
 * overlap. Two opinions about a junction's extent is exactly the shape of bug this file has
 * paid for before, so there is one.
 *
 * Returns the centre, the two (non-orthogonal) axes — each road's unit tangent — and the
 * half-extent along each, plus `sinT`/`stretch` for reporting. A point (x, z) is inside iff
 * solving `p - centre = u·majorT·halfU + v·minorT·halfV` gives |u| <= 1 and |v| <= 1.
 */
export function junctionFootprint(c) {
  const major = outranks(c.a, c.b) ? c.a : c.b;
  const minor = major === c.a ? c.b : c.a;
  const majorTx = major === c.a ? c.ax : c.bx;
  const majorTz = major === c.a ? c.az : c.bz;
  const minorTx = minor === c.a ? c.ax : c.bx;
  const minorTz = minor === c.a ? c.az : c.bz;

  /* THE CROSSING ANGLE, from the cross product of the two unit tangents `findCrossings` already
   * returns. |a x b| IS sin θ for unit vectors, so there is no trigonometry to get wrong and —
   * because it is an absolute value of a cross product — no handedness for gotcha 1 to bite.
   * `stretch` is 1 at a square crossing, so a 90-degree junction's geometry is byte-identical
   * to what shipped; everything below only moves where the crossing is genuinely shallow. */
  const sinT = Math.abs(c.ax * c.bz - c.az * c.bx);
  const stretch = Math.min(1 / Math.max(sinT, 1e-4), SHALLOW_CAP);

  // Patch half-extent along EACH road's own tangent: the OTHER road's half-width plus a
  // perpendicular margin, divided by sin θ. That IS the overlap parallelogram of the two
  // carriageways (see SHALLOW_CAP) — one clean paved area at any crossing angle, with both
  // roads' painted lines disappearing under its edge instead of crossing in the open.
  const halfAlongMajor = (minor.width * 0.5 + JUNCTION_MARGIN) * stretch;
  const halfAlongMinor = (major.width * 0.5 + JUNCTION_MARGIN) * stretch;

  return {
    major,
    minor,
    majorTx,
    majorTz,
    minorTx,
    minorTz,
    halfAlongMajor,
    halfAlongMinor,
    sinT,
    stretch,
    x: c.x,
    z: c.z,
  };
}

/**
 * Is (x, z) under the paved patch of the junction whose footprint is `f`? Solves the 2x2
 * system for the (u, v) coordinates of the parallelogram. `det` is the cross product of the
 * two tangents, which is sin θ — never zero for a real crossing, since two parallel segments
 * cannot cross at a point (`findCrossings` skips them explicitly).
 */
export function inJunctionFootprint(f, x, z) {
  const det = f.majorTx * f.minorTz - f.majorTz * f.minorTx;
  if (Math.abs(det) < 1e-9) return false;
  const dx = x - f.x,
    dz = z - f.z;
  const a = (dx * f.minorTz - dz * f.minorTx) / det; // metres along the major tangent
  const b = (dz * f.majorTx - dx * f.majorTz) / det; // metres along the minor tangent
  return Math.abs(a) <= f.halfAlongMajor && Math.abs(b) <= f.halfAlongMinor;
}

/**
 * One junction's geometry: the paved patch plus give-way bars on the MINOR road's two
 * approaches (see `outranks` — the same priority rule roads.js already uses to decide who
 * yields height and angle decides who yields the right of way here too). Returns a
 * BufferGeometry meant to be drawn with the SAME road material every ribbon uses.
 *
 * Exported for tools/diag-junction-geom.mjs, the same reason buildRibbon and ribbonEdges are:
 * a diagnostic has to drive the exact geometry the game draws, not a description of it.
 */
export function buildJunction(c, seed) {
  const s = seed >>> 0;
  const f = junctionFootprint(c);
  const { major, minor, majorTx, majorTz, minorTx, minorTz, halfAlongMajor, halfAlongMinor } = f;
  const reach = halfAlongMajor + halfAlongMinor + GIVE_WAY_GAP + GIVE_WAY_THICK + major.width + 4;

  const terr = new Terrain(s, c.x - reach, c.z - reach, c.x + reach, c.z + reach, 48);
  /* PER-JUNCTION LIFT, so two patches that overlap cannot z-fight. Operator: "junction CANNOT
   * have 2 groups of overlapping stripes at same lvel flashing back between each other" — that
   * flashing is two junction overlays occupying the SAME plane, which happens wherever two
   * crossings fall close enough for their (now angle-stretched) footprints to overlap. A
   * deterministic sub-millimetre stagger keyed off the junction's own position breaks the tie
   * without moving the surface anywhere the car or the eye can tell: 8 steps of 0.4 mm, always
   * the same value for the same junction, so it is stable frame to frame and across clients. */
  const tie = ((Math.abs(Math.round(c.x) * 73856093 ^ Math.round(c.z) * 19349663) >>> 0) % 8) * 0.0004;
  const h = (x, z) => terr.height(x, z) + JUNCTION_LIFT + tie;

  const position = [];
  const normal = [];
  const across = [];
  const index = [];
  const pushVert = (x, z, ax, az) => {
    const idx = position.length / 3;
    position.push(x, h(x, z), z);
    normal.push(0, 1, 0);
    across.push(ax, az);
    return idx;
  };

  // ── the paved patch: a grid spanning the major tangent (u) and minor tangent (v) ──
  // Subdivided BY DISTANCE, not by a fixed count: a shallow junction is several times longer
  // than a square one and a fixed count would stretch its chords over the carved ground.
  const gridU = gridSteps(halfAlongMajor);
  const gridV = gridSteps(halfAlongMinor);
  const grid = [];
  for (let i = 0; i <= gridU; i++) {
    const u = (i / gridU) * 2 - 1; // -1..1 along the major road
    const row = [];
    for (let j = 0; j <= gridV; j++) {
      const v = (j / gridV) * 2 - 1; // -1..1 along the minor road
      const x = c.x + majorTx * u * halfAlongMajor + minorTx * v * halfAlongMinor;
      const z = c.z + majorTz * u * halfAlongMajor + minorTz * v * halfAlongMinor;
      // Away from the dead centre of either detection band, so the shader's own wear/chip
      // surface treatment shows through with no accidental line or dash.
      row.push(pushVert(x, z, AC_PLAIN, 0));
    }
    grid.push(row);
  }
  for (let i = 0; i < gridU; i++) {
    for (let j = 0; j < gridV; j++) {
      pushQuadUp(position, index, grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
    }
  }

  /* ── give-way bars on the minor road's two approaches ──
   *
   * WALKED ALONG THE MINOR ROAD'S OWN POLYLINE, not extrapolated along its tangent at the
   * crossing. That used to be the same thing to within a few centimetres because the bar sat
   * `major.width/2 + 2.6` metres out — under 7 m. A shallow crossing now pushes the patch edge
   * up to 3.5 times further, past 20 m on an arterial, and 20 m of straight line off a road
   * that is bending at its own 103 m minimum radius leaves the carriageway completely: the bar
   * would have been painted on the grass beside the road it is supposed to stop.
   */
  const barDist = halfAlongMinor + GIVE_WAY_GAP;
  const half = minor.width * 0.5;
  const t = GIVE_WAY_THICK * 0.5;
  const kMinor = minor === c.a ? c.ka : c.kb;
  for (const side of [1, -1]) {
    const at = walkEdge(minor, kMinor, c.x, c.z, side, barDist);
    if (!at) continue; // the road ends before the bar would be — no bar rather than a floating one
    // a perpendicular to the minor road THERE, in the ground plane — either sign does, since
    // the bar is symmetric across it and pushQuadUp fixes the winding regardless.
    const nx = -at.tz,
      nz = at.tx;
    const tx = at.tx * t,
      tz = at.tz * t;
    const p1 = pushVert(at.x + nx * half - tx, at.z + nz * half - tz, AC_LINE, 0);
    const p2 = pushVert(at.x - nx * half - tx, at.z - nz * half - tz, AC_LINE, 0);
    const p3 = pushVert(at.x - nx * half + tx, at.z - nz * half + tz, AC_LINE, 0);
    const p4 = pushVert(at.x + nx * half + tx, at.z + nz * half + tz, AC_LINE, 0);
    pushQuadUp(position, index, p1, p2, p3, p4);
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  geo.setAttribute('aCross', new BufferAttribute(new Float32Array(across), 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  return geo;
}

/* ── dead-end terminations ───────────────────────────────────────────────────
 *
 * The operator's other junction screenshot: a lane ENDING in open grass with its edge lines,
 * its centre dashes and a give-way bar running right up to the cut. A road that stops with its
 * markings still going is the single most artificial thing in the world, and it is the picture
 * behind "roads end randomly here and there".
 *
 * The stumps themselves are not a bug that can simply be deleted. `tools/diag-deadends.mjs`
 * measures 6.1 interior dead ends per 16 km² across five seeds and names the mechanism for
 * each: 121 of 275 are lanes orphaned when the neighbour they continued into was culled for
 * crossing a lake, 133 when the neighbour was culled as a leaf, 3 are hash degree 1. Chasing
 * them to zero means cascading the culls, and `tools/diag-density.mjs` already prices that at
 * 62% of the network's length and 52% of its junctions — the exact trade this project took
 * once and reverted.
 *
 * So the road is allowed to end, and it is given a REASON TO HAVE ENDED that the player can
 * see from the driver's seat: the carriageway opens out into a small turning head and a solid
 * white bar closes it off. Which is what a real dead-end lane does.
 *
 * Built from the ribbon's own `ring` (so the head sits exactly where the tarmac does) with
 * every vertex height from `Terrain.height()` — the same function the ribbon, the junction
 * patch and the car's wheels read. There is no fourth opinion about the ground here either.
 */

/**
 * Turning-head radii to try, as multiples of the road's own half-width, widest first.
 *
 * IT HAS TO BE A SEARCH, AND THE REASON IS `carve()`. The ground is held DEAD FLAT only inside
 * the carriageway half-width; past that it batters towards the raw land at 1:1.6 on fill and
 * 1:2.2 in cutting. A head at a fixed 1.55 half-widths therefore paves 55% of a half-width out
 * onto that batter, and measured over 27 real dead ends (`tools/diag-terminus.mjs`) the worst
 * rim sat **0.99 m** below the road it belongs to — a paved lip hanging over an embankment,
 * which is the "large cliffs where roads meet hills" complaint in miniature, self-inflicted.
 *
 * So the head asks the ground how big it is allowed to be. Every vertex is still
 * `Terrain.height()`; this only decides how far out to go before the answer stops being level.
 * The last entry is 1.0 — no widening at all, just the round cap of flat shelf the carve
 * already puts beyond a road's end — so the search always terminates on something that is by
 * construction on level ground, and even then the closing bar still reads.
 *
 * Deterministic: the ground is a pure function of position, so two players get the same head.
 */
const TERMINUS_RADII = [1.55, 1.42, 1.32, 1.22, 1.14, 1.07, 1.0];
/**
 * How far the head's rim may fall away sideways from the road beside it before it is shrunk,
 * in metres. See `fallAt` for what "sideways" means and why it is not measured against the
 * road's own end height.
 *
 * SWEPT, over 27 real dead ends in four windows, not picked. The figure trades how big the
 * turning head gets against how far it runs down the batter, and the batter is also where the
 * drawn surface starts flying over the carved ground between vertices (`Terrain.height()` STEPS
 * by up to 0.5 m where carve()'s nearest edge flips tier, and no subdivision follows a step):
 *
 *   drop 0.30  worst fall 0.350 m  worst chord 0.274 m  mean radius 1.48x  27/27 widened
 *   drop 0.22  worst fall 0.237 m  worst chord 0.194 m  mean radius 1.37x  27/27
 *   drop 0.18  worst fall 0.208 m  worst chord 0.167 m  mean radius 1.29x  25/27
 *   drop 0.16  the shipped figure — see tools/diag-terminus.mjs for the numbers it holds
 *   drop 0.14  worst fall 0.179 m  worst chord 0.111 m  mean radius 1.18x  21/27
 *
 * It cannot go to zero: the carve gives a road a crown-to-gutter camber, so the ground at the
 * kerb is already ~0.18 m below the crown and even a head no wider than the carriageway has a
 * fall. 0.16 keeps most heads visibly wider than the road while holding the chord near the
 * 0.10 m of lift the overlay has, and the residual is recorded rather than hidden.
 */
const TERMINUS_MAX_DROP = 0.16;
/**
 * Sectors round the head, and target metres between its concentric rings.
 *
 * Both are set by MEASUREMENT, not by eye. The head crosses the knee where `carve()` stops
 * holding the ground flat and starts battering it, and the ground turns hard there — 20 sectors
 * with 1.1 m rings left the drawn surface flying 0.164 m above it between vertices, against the
 * 0.10 m of lift that is all the separation this overlay has. That is the same chord-sag
 * failure `RING_TOL` exists for on ribbons, arriving by the same route.
 *
 * 32 x 0.5 m does NOT take it to zero and it is worth saying so plainly: the final measurement
 * is 0.146 m worst, on 14 of 13718 triangles. Beyond a certain point the residual stops being
 * resolution and starts being the STEP `Terrain.height()` genuinely has where carve()'s nearest
 * edge flips tier, which no subdivision follows — RING_DEPTH's own note records the same wall
 * on ribbons (depth 4, 6 and 8 all leave ~0.3 m). What moved this number was shrinking the head
 * (TERMINUS_MAX_DROP), not cutting it finer. The head is ~300 vertices either way, a tenth of
 * one short ribbon, so the finer grid is kept for the continuous part of the miss it does fix.
 */
const TERMINUS_SECTORS = 32;
const TERMINUS_RING_STEP = 0.5;
const TERMINUS_RINGS_MAX = 12;
/** Where the closing bar sits, as a fraction of the head's radius out from the road's last
 *  centreline point, and how thick it is in metres. 0.62 puts it near the far edge of the head
 *  with turning room behind it, so the head reads as somewhere to turn round rather than as a
 *  blob of tarmac past a stop line. */
const TERMINUS_BAR_AT = 0.62;
const TERMINUS_BAR_THICK = 0.7;

/**
 * The paved turning head and closing bar for ONE end of one edge — `atEnd` picks which.
 *
 * Returns a BufferGeometry drawn with the same road material as the ribbons and the junction
 * patches, lifted by the same `JUNCTION_LIFT` so it lies over the ribbon it overlaps without
 * z-fighting it. Exported for tools/diag-terminus.mjs.
 */
export function buildTerminus(edge, ring, atEnd, seed) {
  const s = seed >>> 0;
  const n = ring.length;
  if (n < 2) return null;
  const p = atEnd ? ring[n - 1] : ring[0];
  const q = atEnd ? ring[n - 2] : ring[1];
  // OUTWARD along the road, away from the rest of it. Empirically signed — from the ribbon's
  // own points, p minus q — rather than from any assumption about which way +X or +Z faces
  // on screen (gotcha 1).
  let tx = p.x - q.x,
    tz = p.z - q.z;
  const tl = Math.hypot(tx, tz) || 1;
  tx /= tl;
  tz /= tl;
  const nx = -tz,
    nz = tx; // a perpendicular; pushQuadUp fixes winding, so either sign does

  const half = edge.width * 0.5;
  /* Pad the sampler to 96 m, matching buildRibbon's. The carve blends over every road within
   * `half + verge*2.6 + 60` = 77.8 m, so a smaller pad makes Terrain.height() a function of the
   * box you asked it about — and this head shares its edge with a ribbon built at 96. */
  const reach = half * TERMINUS_RADII[0] + TERMINUS_BAR_THICK + 2;
  const terr = new Terrain(s, p.x - reach, p.z - reach, p.x + reach, p.z + reach, 96);

  /* (lateral, along) offsets of sector k on a rim of radius `rad`, and the world point. The
   * basis is (n, t) — across the road and along it — so `along` is a station on the road and
   * `lateral` is how far out to the side, which is the split the drop test below needs. */
  const rimAt = (rad, k) => {
    const a = (k / TERMINUS_SECTORS) * Math.PI * 2;
    const lat = Math.cos(a) * rad,
      along = Math.sin(a) * rad;
    return [p.x + nx * lat + tx * along, p.z + nz * lat + tz * along, lat, along];
  };
  /**
   * How far the ground at a head vertex falls away from the ROAD BESIDE IT — measured against
   * the ground on the centreline at the SAME station, not against the road's single end height.
   *
   * That distinction is the whole test. Comparing to one height folds in the road's own
   * LONGITUDINAL GRADIENT, which on this world's steepest lanes is tens of per cent: measured,
   * the worst "drop" read 0.62 m at a head that had already shrunk to no widening at all, and
   * every centimetre of it was the road going downhill underneath a head that was lying
   * perfectly on it. A head cannot fix a gradient and must not be shrunk for one. What it CAN
   * do is stop paving out over a batter, which is a lateral fall, and that is what this
   * isolates. The station is clamped just inside the flat cap the carve puts beyond a road's
   * end, so the reference is itself always on level ground.
   */
  const fallAt = (x, z, along) => {
    const st = Math.min(along, half * 0.9);
    return Math.abs(terr.height(x, z) - terr.height(p.x + tx * st, p.z + tz * st));
  };
  let R = half * TERMINUS_RADII[TERMINUS_RADII.length - 1];
  for (const mul of TERMINUS_RADII) {
    const rad = half * mul;
    let worst = 0;
    for (let k = 0; k < TERMINUS_SECTORS; k++) {
      const [rx, rz, , along] = rimAt(rad, k);
      const d = fallAt(rx, rz, along);
      if (d > worst) worst = d;
    }
    if (worst <= TERMINUS_MAX_DROP) {
      R = rad;
      break;
    }
  }
  const ringCount = Math.max(2, Math.min(TERMINUS_RINGS_MAX, Math.ceil(R / TERMINUS_RING_STEP)));

  const position = [];
  const normal = [];
  const across = [];
  const index = [];
  const pushVert = (x, z, ac) => {
    const idx = position.length / 3;
    position.push(x, terr.height(x, z) + JUNCTION_LIFT, z);
    normal.push(0, 1, 0);
    across.push(ac, 0);
    return idx;
  };

  // ── the head: a fan of concentric rings about the road's last centreline point ──
  const centre = pushVert(p.x, p.z, AC_PLAIN);
  const rings = [];
  for (let r = 1; r <= ringCount; r++) {
    const rad = (r / ringCount) * R;
    const row = [];
    for (let k = 0; k < TERMINUS_SECTORS; k++) {
      const [rx, rz] = rimAt(rad, k);
      row.push(pushVert(rx, rz, AC_PLAIN));
    }
    rings.push(row);
  }
  for (let k = 0; k < TERMINUS_SECTORS; k++) {
    const k1 = (k + 1) % TERMINUS_SECTORS;
    // innermost ring closes on the centre vertex as triangles, not quads
    const a = rings[0][k],
      b = rings[0][k1];
    const upA =
      (position[b * 3 + 2] - position[a * 3 + 2]) * (position[centre * 3] - position[a * 3]) -
      (position[b * 3] - position[a * 3]) * (position[centre * 3 + 2] - position[a * 3 + 2]);
    if (upA >= 0) index.push(a, b, centre);
    else index.push(a, centre, b);
    for (let r = 0; r + 1 < ringCount; r++) {
      pushQuadUp(position, index, rings[r][k], rings[r][k1], rings[r + 1][k1], rings[r + 1][k]);
    }
  }

  /* ── the closing bar ──
   * Chord half-width of the head at the bar's distance out, so the bar spans the head exactly
   * and neither floats short of its edge nor hangs over it into the grass. */
  const d = R * TERMINUS_BAR_AT;
  const w = Math.sqrt(Math.max(R * R - d * d, 0));
  const bx = p.x + tx * d,
    bz = p.z + tz * d;
  const t = TERMINUS_BAR_THICK * 0.5;
  const b1 = pushVert(bx + nx * w - tx * t, bz + nz * w - tz * t, AC_LINE);
  const b2 = pushVert(bx - nx * w - tx * t, bz - nz * w - tz * t, AC_LINE);
  const b3 = pushVert(bx - nx * w + tx * t, bz - nz * w + tz * t, AC_LINE);
  const b4 = pushVert(bx + nx * w + tx * t, bz + nz * w + tz * t, AC_LINE);
  pushQuadUp(position, index, b1, b2, b3, b4);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(position), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
  geo.setAttribute('aCross', new BufferAttribute(new Float32Array(across), 2));
  geo.setIndex(index);
  geo.computeBoundingSphere();
  /* The head's own frame, so tools/diag-terminus.mjs can re-run `fallAt` on the vertices this
   * actually produced instead of reconstructing the basis and getting a sign wrong (gotcha 1).
   * Nothing in the game reads it. */
  geo.userData.terminus = { x: p.x, z: p.z, tx, tz, nx, nz, half, R, ringCount };
  return geo;
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
    this.junctions = new Map(); // crossing key -> { mesh }
    this._lastX = Infinity;
    this._lastZ = Infinity;
    // No private land/water functions any more: ribbonEdges() builds the same RoadField the
    // terrain does, and a second height source next to it is exactly how this file drifted
    // 24 m away from the ground in the first place.
    this.stats = { edges: 0, tris: 0, junctions: 0 };
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

      /* A road that stops gets a turning head and a closing bar instead of its markings
       * running into the grass. `edgeDeadEnds` is roads.js's own live-degree rule, not a copy
       * of it — the renderer must not have a second opinion about which roads exist, which is
       * why that function lives in roads.js and is imported here. A road leaving the drawing
       * window is NOT a dead end and does not get one: the rule is box-independent. */
      const rec = { mesh, instanced: [], terminals: [] };
      const dead = edgeDeadEnds(e, this.seed);
      for (let end = 0; end < 2; end++) {
        if (!dead[end]) continue;
        const tgeo = buildTerminus(e, ring, end === 1, ctx);
        if (!tgeo) continue;
        const tm = new Mesh(tgeo, this.material);
        tm.frustumCulled = true;
        tm.matrixAutoUpdate = false;
        tm.renderOrder = 2; // over the ribbon, like a junction patch, for the same reason
        this.group.add(tm);
        rec.terminals.push(tm);
      }

      const items = furnitureFor(e, ring, half, this.seed);
      const posts = items.filter((i) => i.kind === 'post');
      const chevs = items.filter((i) => i.kind === 'chevron');
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
      for (const tm of rec.terminals) {
        this.group.remove(tm);
        tm.geometry.dispose();
      }
      this.live.delete(key);
    }
    this.stats.edges = this.live.size;

    /* Junctions: one crossing detector (`findCrossings`, the same one roads.js uses to square
     * angles in the first place — see its own doc comment) run over exactly the edges just
     * drawn, so a junction patch only ever appears where a ribbon actually does. Keyed by both
     * edges' keys plus the crossing's own rounded position, because two edges occasionally
     * cross more than once (the winding can carry a lane back and forth over a road it is
     * near), and each such point needs its own patch. */
    const wantedJ = new Set();
    for (const c of findCrossings(edges)) {
      const lo = c.a.key < c.b.key ? c.a.key : c.b.key;
      const hi = c.a.key < c.b.key ? c.b.key : c.a.key;
      const jkey = `${lo}~${hi}~${Math.round(c.x)},${Math.round(c.z)}`;
      wantedJ.add(jkey);
      if (this.junctions.has(jkey)) continue;

      const geometry = buildJunction(c, ctx);
      const mesh = new Mesh(geometry, this.material);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      // Drawn after the ribbons (renderOrder 1) it overlaps; the real separation that stops
      // z-fighting is JUNCTION_LIFT's few extra centimetres of height, not draw order, but
      // there is no reason to leave the tie-break to chance.
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.junctions.set(jkey, { mesh });
    }
    for (const [key, rec] of this.junctions) {
      if (wantedJ.has(key)) continue;
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      this.junctions.delete(key);
    }
    this.stats.junctions = this.junctions.size;
  }

  dispose() {
    for (const [k, rec] of this.live) {
      rec.mesh.geometry.dispose();
      for (const im of rec.instanced) im.dispose();
      for (const tm of rec.terminals) tm.geometry.dispose();
      this.live.delete(k);
    }
    for (const [k, rec] of this.junctions) {
      rec.mesh.geometry.dispose();
      this.junctions.delete(k);
    }
    this.material.dispose();
  }
}
