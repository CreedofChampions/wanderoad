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
import { edgesInBox, TIERS } from '../world/roads.js';
import { landFn } from '../world/terrain.js';
import { hash2i, clamp01, lerp } from '../core/math.js';
import { RGB } from '../core/palette.js';
import { PB, pbox, pcyl, finishPainted, createPaintedMaterial, MAT } from './painted.js';

/** How far from the car road geometry exists. Beyond this the terrain tint carries it. */
const RANGE = 1900;
/** Metres the ribbon floats above the carved ground, to beat z-fighting without a visible lip. */
const LIFT = 0.07;
/** Cross-section: how many strips across the ribbon. 4 gives kerb / lane / lane / kerb. */
const ACROSS = 6;
/** Marker posts down the shoulder, in metres. Real roads use 50 m; 28 reads better at speed. */
const POST_SPACING = 28;

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
 * Sweep one road edge into a ribbon. Returns a BufferGeometry in world coordinates, which
 * is fine because road geometry only exists within ~2 km of the player.
 */
function buildRibbon(edge) {
  const n = edge.pts.length / 2;
  // Resample: the network stores 10–14 points per edge, which is enough for a curve but far
  // too coarse for a surface that must sit on rolling ground. One vertex ring every ~6 m.
  const ring = [];
  for (let k = 0; k < n - 1; k++) {
    const ax = edge.pts[k * 2],
      az = edge.pts[k * 2 + 1];
    const bx = edge.pts[k * 2 + 2],
      bz = edge.pts[k * 2 + 3];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.round(len / 6));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      ring.push({ x: lerp(ax, bx, t), z: lerp(az, bz, t), y: lerp(edge.y[k], edge.y[k + 1], t) });
    }
  }
  const last = n - 1;
  ring.push({ x: edge.pts[last * 2], z: edge.pts[last * 2 + 1], y: edge.y[last] });

  const rings = ring.length;
  const verts = rings * ACROSS;
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const across = new Float32Array(verts * 2);
  const index = new Uint32Array((rings - 1) * (ACROSS - 1) * 6);

  const half = edge.width * 0.5;
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

    for (let j = 0; j < ACROSS; j++) {
      const f = (j / (ACROSS - 1)) * 2 - 1; // -1 .. 1
      const wx = p.x + rx * f * half;
      const wz = p.z + rz * f * half;
      // Camber, matching the terrain carve so the ribbon lies flush with the shelf.
      const camber = -Math.abs(f) * Math.abs(f) * 0.18;
      const k = i * ACROSS + j;
      position[k * 3] = wx;
      // Follow the SMOOTHED ROAD elevation, full stop. An earlier version clamped this
      // against the raw land height to stop the ribbon floating over bumps — but the raw
      // land is what exists BEFORE the terrain carves the shelf, so in a cutting the clamp
      // lifted the ribbon above the carved surface and the road buried the car that was
      // driving on it.
      position[k * 3 + 1] = p.y + camber + LIFT;
      position[k * 3 + 2] = wz;
      normal[k * 3] = 0;
      normal[k * 3 + 1] = 1;
      normal[k * 3 + 2] = 0;
      across[k * 2] = f;
      across[k * 2 + 1] = travelled;
    }
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
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i];
    const o = ring[i - 1];
    dist += Math.hypot(p.x - o.x, p.z - o.z);

    let tx = p.x - o.x;
    let tz = p.z - o.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const rx = tz;
    const rz = -tx;

    // curvature: how much the tangent turns over the next ~18 m
    let bend = 0;
    const j = Math.min(i + 3, ring.length - 1);
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
      const side = (i & 1) === 0 ? 1 : -1;
      items.push({
        kind: 'post',
        x: p.x + rx * side * (half + 1.5),
        z: p.z + rz * side * (half + 1.5),
        y: p.y,
        yaw: Math.atan2(tx, tz),
      });
    }

    if (Math.abs(bend) > 0.22 && i % 4 === 0) {
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
    this._height = landFn(this.seed);
    this.stats = { edges: 0, tris: 0 };
  }

  /** Rebuild the window when the car has moved far enough to need new road. */
  update(camX, camZ) {
    if (Math.hypot(camX - this._lastX, camZ - this._lastZ) < 180) return;
    this._lastX = camX;
    this._lastZ = camZ;

    const R = this.range;
    const edges = edgesInBox(camX - R, camZ - R, camX + R, camZ + R, this.seed, 40);
    const wanted = new Set();

    for (const e of edges) {
      wanted.add(e.key);
      if (this.live.has(e.key)) continue;
      // The network stores no elevation until a RoadField fills it in, so do that here from
      // the raw land — the same function the terrain carve used, which is why the ribbon and
      // the shelf agree.
      const nY = e.y.length;
      for (let k = 0; k < nY; k++) e.y[k] = this._height(e.pts[k * 2], e.pts[k * 2 + 1]);
      const passes = e.tier === 0 ? 6 : 3;
      const tmp = new Float32Array(nY);
      for (let p = 0; p < passes; p++) {
        for (let k = 0; k < nY; k++) {
          const a = e.y[Math.max(0, k - 1)];
          const b = e.y[k];
          const c = e.y[Math.min(nY - 1, k + 1)];
          tmp[k] = a * 0.25 + b * 0.5 + c * 0.25;
        }
        e.y.set(tmp);
      }

      const { geometry, ring, half } = buildRibbon(e);
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
