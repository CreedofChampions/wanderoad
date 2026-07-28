/* Wanderoad — seagulls, and a few smaller land birds.
 *
 * Operator report, verbatim: "birds -- seagulls -- visible around the map, especially near
 * water." The audit that raised it found nothing to build on: a case-insensitive search of
 * src/render, src/world, src/game and src/main.js for seagull/gull/bird returned exactly one
 * hit, `bird_house_pole` in world/props.js, which is a roadside nest BOX and not a bird. So
 * this file is the whole feature — placement, geometry, motion and the wire into the audio
 * layer that was already calling birds without anything to show for it.
 *
 * WHY IT IS BUILT THE WAY IT IS
 *
 * 1. PLACEMENT copies src/render/ships.js exactly, and deliberately: a rolling lattice of
 *    tiles around the car, one deterministically jittered candidate per tile, gated in
 *    increasing order of cost. Ships.js's own header explains why a sparse feature must not
 *    hang off the terrain quadtree (a chunk changing LOD would re-decide, and potentially
 *    re-place, the whole flock). A gull colony has exactly that problem, so it gets exactly
 *    that solution. No Math.random anywhere — hash3i/rng off the world seed, like every
 *    other generator in this game (gotcha 4 in the project notes, paid for in full).
 *
 * 2. WATER IS THE PRIMARY CUE, and it is asked the same way the ambience layer asks it —
 *    biome weights -> the blended water plane -> raw land height, i.e. ships.js's
 *    `freeboardAt()` and audio/ambience.js's probes, not a third opinion. A flock wants
 *    OPEN water nearby rather than under it: gulls wheel over the shore, so the site is
 *    scored on how much water is within a ring around it, not on whether the exact point is
 *    wet. Woodland gets a smaller, lower, quieter flock through the same machinery
 *    (forestDensity, the same field trees.js and ambience.js read).
 *
 * 3. ONE DRAW CALL, NO NEW SHADER. Every live bird in the world is re-baked into a single
 *    preallocated BufferGeometry every frame — ~40 birds x 14 vertices is 560 vertices of
 *    JS arithmetic, which is nothing, and it buys a wing that actually flaps without a
 *    custom instanced vertex shader. That trade is made on purpose: this project has
 *    already lost a full round to a shader that passed every static check its author ran
 *    and turned the game black on a real GPU, and a feature whose entire job is to be SEEN
 *    should not be gated on a compile nobody in this pass can run. The material is
 *    painted.js's stock one, unchanged, so a gull is shaded by the same pipeline as a fence.
 *
 * 4. THE GEOMETRY IS REBUILT IN LOCAL SPACE around a periodically re-snapped anchor, so
 *    `position` stays small. painted.js's vertex shader passes object space straight through
 *    as `vL` and the fragment shader samples the paint grain from it; feeding it raw world
 *    coordinates in the thousands would sample that noise field at a scale it was never
 *    tuned for.
 *
 * COZY IS THE FILTER. Gulls glide far more than they flap, they never dive at the car, they
 * are silhouettes rather than models, and there are a couple of dozen of them in view rather
 * than a flock simulation. Nothing here is loud, fast or startling.
 */

import { BufferGeometry, BufferAttribute, Mesh } from 'three';
import { createPaintedMaterial, MAT, LC, tint, mixc } from './painted.js';
import { biomeWeights, waterLevelAt, BIOME_COUNT } from '../world/biomes.js';
import { landHeight } from '../world/terrain.js';
import { forestDensity } from '../world/scatter.js';
import { TAU, hash3i, rng, lerp, clamp, clamp01 } from '../core/math.js';

/* ── placement tunables ────────────────────────────────────────────────────────
 * All exported so tools/diag-birds.mjs prints the numbers the game actually uses rather
 * than a re-typed guess at them — the same contract ships.js has with diag-openwater.mjs.
 */

/** Candidate lattice spacing, metres. Tighter than ships.js's 500 m: a flock is a much
 *  cheaper thing to place than a boat (no shoreline ring, no road clearance) and the
 *  operator asked for birds to be VISIBLE AROUND THE MAP, which is a coverage statement.
 *  One flock per 340 m tile that qualifies. */
export const TILE = 340;
/** How far out flocks exist at all. Birds are small; past this they are under a pixel. */
export const RANGE = 900;
/** Metres of the ring around a candidate that must be wet for it to be a SEA flock, as a
 *  fraction of the ring's samples. 0.22 = "about a fifth of what is around here is water",
 *  which is a shore, a river mouth or a lake edge — not a puddle and not mid-ocean. */
export const SEA_WET_MIN = 0.22;
/** Ring radius and sample count for that test. Two rings, so a narrow river bank and a big
 *  bay both register, and neither costs more than 16 landHeight() calls once, ever. */
export const RING_R1 = 90;
export const RING_R2 = 230;
export const RING_DIRS = 8;
/** Trees per hectare (the same field world/scatter.js places real trees from) at or above
 *  which a dry tile may carry a small LAND flock instead. */
export const WOOD_TREES_MIN = 9;
/** Rarity draws, applied only to a site that already passed its gate. Sea flocks are common
 *  where there is sea — that is the whole ask — land flocks are an occasional grace note. */
export const SEA_ACCEPT_P = 0.62;
export const LAND_ACCEPT_P = 0.16;

/** Birds per flock. A handful wheeling over a bay, never a cloud. */
export const SEA_FLOCK = [3, 7];
export const LAND_FLOCK = [2, 4];

/** Hard ceiling on birds drawn at once. The geometry is preallocated to exactly this, and
 *  the rescan stops adding flocks once it is reached, so the vertex budget is a constant
 *  and cannot be blown by an unlucky seed over a coastline. */
export const MAX_BIRDS = 84;

/* ── flight ───────────────────────────────────────────────────────────────────
 * Every period below is chosen against the others so nothing beats into a visible pulse,
 * and every rate is small: the fastest thing a bird does here is a wing beat, and it spends
 * most of its time not doing that. The design target is "you notice them on the second look".
 */
const SEA_ALT = [16, 46]; // metres above the water plane
const LAND_ALT = [11, 26]; // ...above the ground, for the woodland flock
const SEA_RADIUS = [26, 90]; // orbit radius, metres
const LAND_RADIUS = [14, 38];
/** Angular speed, rad/s. 0.09-0.22 over a 26-90 m orbit is 2.3-20 m/s — a gull's cruise. */
const OMEGA = [0.09, 0.22];
/** Slow vertical breathing on the orbit, so a flock is a volume rather than a disc. */
const BOB_AMP = [1.4, 4.2];
const BOB_HZ = [0.055, 0.115];
/** Wing beat, and how much of the time a bird is actually beating rather than gliding.
 *  A gull glides most of the time; the burst envelope is what makes that read. */
const FLAP_HZ = [1.15, 1.9];
const GLIDE_HZ = [0.041, 0.077]; // the slow envelope that switches beating on and off
/** Wingspan, metres. A herring gull is about 1.4 m; the land birds are half that. */
const SEA_SPAN = [1.15, 1.55];
const LAND_SPAN = [0.42, 0.62];

/* ── colours ──────────────────────────────────────────────────────────────────
 * A gull read against a bright sky is a pale silhouette with dark wingtips — that contrast
 * IS the read at distance, and it is the only detail this geometry carries. Palette keys,
 * never hex: painted.js's material wants linear triples and core/palette.js is where this
 * game's linear values are defined (see loadedCar.js's own note on what happens when a file
 * skips that table).
 */
const GULL_BODY = tint(LC('wFoam'), 1.02);
const GULL_TIP = mixc(LC('tyre'), LC('wDeepShade'), 0.45);
const LAND_BODY = mixc(LC('trunkShade'), LC('timber'), 0.35);
const LAND_TIP = tint(LC('trunkShade'), 0.7);

/* ── geometry layout ──────────────────────────────────────────────────────────
 * One bird is a fixed 12 vertices and 8 triangles, always, so the index buffer can be built
 * once for MAX_BIRDS and never touched again — the per-frame work is positions/normals and
 * a setDrawRange(). The shape, from above:
 *
 *      tip ---- elbow                 wings are two quads (inner + outer panel) so a flap
 *          \      |  \                bends at the elbow rather than pivoting the whole
 *           `---- root -- nose        span like a plank, which is most of what makes a
 *                   |                 gull read as a bird and not as a paper dart
 *                 tail
 *
 * Vertices 0-3 are the body (nose, tail, and the two wing roots), 4-7 the left wing
 * (elbow-front, elbow-back, tip-front, tip-back), 8-11 the right.
 */
const VERTS_PER_BIRD = 12;
const TRIS_PER_BIRD = 8;
const IDX_PER_BIRD = TRIS_PER_BIRD * 3;

/** The one triangle list every bird shares, offset per bird. */
function buildIndices(maxBirds) {
  const idx = new Uint16Array(maxBirds * IDX_PER_BIRD);
  let w = 0;
  for (let b = 0; b < maxBirds; b++) {
    const o = b * VERTS_PER_BIRD;
    // body: nose(0) tail(1) rootL(2) rootR(3) — two triangles, drawn DoubleSide by the
    // painted material, so a bird seen from below is not a hole in the sky.
    idx[w++] = o + 0; idx[w++] = o + 2; idx[w++] = o + 1;
    idx[w++] = o + 0; idx[w++] = o + 1; idx[w++] = o + 3;
    // left wing: root(2) -> elbow(4,5) -> tip(6,7)
    idx[w++] = o + 2; idx[w++] = o + 4; idx[w++] = o + 5;
    idx[w++] = o + 2; idx[w++] = o + 5; idx[w++] = o + 1;
    idx[w++] = o + 4; idx[w++] = o + 6; idx[w++] = o + 7;
    idx[w++] = o + 4; idx[w++] = o + 7; idx[w++] = o + 5;
    // right wing: root(3) -> elbow(8,9) -> tip(10,11)
    idx[w++] = o + 3; idx[w++] = o + 9; idx[w++] = o + 8;
    idx[w++] = o + 8; idx[w++] = o + 10; idx[w++] = o + 11;
  }
  return idx;
}

const _wBird = new Float32Array(BIOME_COUNT);

/** Metres of dry ground above the local water table at (x, z); negative means underwater.
 *  Same three lines as ships.js's freeboardAt() and ambience.js's probe, for the same
 *  reason: "is this wet" must have one answer in this game, not three. */
function freeboardAt(x, z, seed) {
  const b = biomeWeights(x, z, seed, _wBird);
  const plane = waterLevelAt(b.w, -Infinity);
  return plane === null ? 1e9 : landHeight(x, z, seed) - plane;
}

/** The water surface height at (x, z) — always a number, since the blended plane is. */
function waterPlaneAt(x, z, seed) {
  const b = biomeWeights(x, z, seed, _wBird);
  return waterLevelAt(b.w, -Infinity);
}

/**
 * Evaluate one lattice cell. Returns a flock spec or null.
 *
 * Exported and side-effect-free (nothing here touches THREE) so tools/diag-birds.mjs can
 * drive it over thousands of cells for real coverage statistics without a renderer — the
 * same contract ships.js's evaluateShipSite() has with tools/diag-openwater.mjs, and the
 * only honest way to answer "are there actually birds near the water on this seed".
 */
export function evaluateFlockSite(gi, gj, seed) {
  const r = rng(hash3i(gi, gj, 0x6b12d, seed));
  const x = (gi + r()) * TILE;
  const z = (gj + r()) * TILE;

  /* How much water is around here? Two rings rather than one point: the gulls belong OVER
   * the shore, so a site directly on dry sand beside a bay must qualify and a site in the
   * middle of a farm field must not. Cheapest discriminating test first — this is the only
   * expensive thing in the function and everything else is arithmetic. */
  let wet = 0;
  for (let i = 0; i < RING_DIRS; i++) {
    const a = (i / RING_DIRS) * TAU;
    const s = Math.sin(a);
    const c = Math.cos(a);
    if (freeboardAt(x + s * RING_R1, z + c * RING_R1, seed) < 0) wet++;
    if (freeboardAt(x + s * RING_R2, z + c * RING_R2, seed) < 0) wet++;
  }
  const wetFrac = wet / (RING_DIRS * 2);

  if (wetFrac >= SEA_WET_MIN) {
    if (r() >= SEA_ACCEPT_P) return null;
    // Sit the flock over the water rather than over the dry side of the shore: the plane is
    // flat and unambiguous, which is what makes "birds over the sea" read at a glance.
    const base = waterPlaneAt(x, z, seed);
    return makeFlock(r, 'sea', x, z, base, wetFrac);
  }

  // Dry tile: a small woodland flock, if there is actually a wood here.
  const trees = forestDensity(x, z, seed) * 26; // the meadow book density — see biomes.js
  if (trees < WOOD_TREES_MIN) return null;
  if (r() >= LAND_ACCEPT_P) return null;
  return makeFlock(r, 'land', x, z, landHeight(x, z, seed), 0);
}

function makeFlock(r, kind, x, z, baseY, wetFrac) {
  const sea = kind === 'sea';
  const [lo, hi] = sea ? SEA_FLOCK : LAND_FLOCK;
  const n = lo + Math.floor(r() * (hi - lo + 1));
  const birds = [];
  for (let i = 0; i < n; i++) {
    const alt = sea ? SEA_ALT : LAND_ALT;
    const rad = sea ? SEA_RADIUS : LAND_RADIUS;
    const span = sea ? SEA_SPAN : LAND_SPAN;
    birds.push({
      r: lerp(rad[0], rad[1], r()),
      y: lerp(alt[0], alt[1], r()),
      w: lerp(OMEGA[0], OMEGA[1], r()) * (r() < 0.5 ? -1 : 1), // both ways round, per bird
      phase: r() * TAU,
      bobA: lerp(BOB_AMP[0], BOB_AMP[1], r()),
      bobHz: lerp(BOB_HZ[0], BOB_HZ[1], r()),
      flapHz: lerp(FLAP_HZ[0], FLAP_HZ[1], r()),
      flapPhase: r() * TAU,
      glideHz: lerp(GLIDE_HZ[0], GLIDE_HZ[1], r()),
      glidePhase: r() * TAU,
      span: lerp(span[0], span[1], r()),
    });
  }
  return { kind, x, z, baseY, wetFrac, birds };
}

/* ── one bird's twelve vertices ───────────────────────────────────────────────
 * Written straight into the preallocated arrays at `v` — no allocation per bird, per frame,
 * ever. `yaw` is the heading (game convention: forward is (sin, cos)), `bank` the roll about
 * that heading, `flap` the wing dihedral in radians (positive = wings up).
 */
function writeBird(pos, nrm, col, mtl, v, cx, cy, cz, yaw, bank, flap, span, body, tip) {
  const sy = Math.sin(yaw);
  const cy2 = Math.cos(yaw);
  const half = span * 0.5;
  const chord = span * 0.30; // nose-to-tail, roughly a fifth of the span plus the tail
  const cb = Math.cos(bank);
  const sb = Math.sin(bank);

  /* Local frame: +f forward, +l to the LEFT of the heading, +u up. The left vector is
   * (cos yaw, -sin yaw): three.js is right-handed and puts +X on your LEFT looking down +Z,
   * which this project has now been bitten by in car/input.js, car/autopilot.js, the lateral
   * clamp in car/camera.js and the cinematic. It is written out here rather than derived at
   * the call site so there is one place to be wrong. */
  const fx = sy;
  const fz = cy2;
  const lx0 = cy2;
  const lz0 = -sy;

  // Bank rolls the wing plane about the forward axis: the left/up pair rotate, forward does
  // not. Only the wings care, but the body's roots ride the same frame so nothing detaches.
  const lx = lx0 * cb;
  const lz = lz0 * cb;
  const lyv = -sb; // the left vector's vertical component once rolled
  const ux = -lx0 * sb;
  const uz = -lz0 * sb;
  const uy = cb;

  const P = (f, l, u) => {
    pos[v * 3] = cx + fx * f + lx * l + ux * u;
    pos[v * 3 + 1] = cy + lyv * l + uy * u;
    pos[v * 3 + 2] = cz + fz * f + lz * l + uz * u;
    // Normals: every bird is a flat silhouette, so one up-ish normal per vertex is honest
    // and keeps the painted shader's three-band ramp on the light side of the sky.
    nrm[v * 3] = ux * 0.25;
    nrm[v * 3 + 1] = uy;
    nrm[v * 3 + 2] = uz * 0.25;
    v++;
  };

  const base = v;
  // 0 nose, 1 tail, 2 root-left, 3 root-right
  P(chord * 0.62, 0, 0);
  P(-chord * 0.85, 0, 0);
  P(-chord * 0.05, half * 0.16, 0);
  P(-chord * 0.05, -half * 0.16, 0);
  // wings. The elbow sits at 45% of the span and carries HALF the flap angle, the tip the
  // full one — a real wing bends more at the tip, and this is the cheapest way to say so.
  const eU = Math.sin(flap * 0.5);
  const eL = Math.cos(flap * 0.5);
  const tU = Math.sin(flap);
  const tL = Math.cos(flap);
  const e = half * 0.45;
  const swp = chord * 0.22; // the sweep back along the span, so the wing is a scythe
  // 4,5 left elbow (front, back); 6,7 left tip (front, back)
  P(-swp * 0.4, e * eL, e * eU);
  P(-swp * 0.4 - chord * 0.34, e * eL, e * eU);
  P(-swp * 1.15, half * tL, half * tU);
  P(-swp * 1.15 - chord * 0.13, half * tL, half * tU);
  // 8,9 right elbow; 10,11 right tip
  P(-swp * 0.4, -e * eL, e * eU);
  P(-swp * 0.4 - chord * 0.34, -e * eL, e * eU);
  P(-swp * 1.15, -half * tL, half * tU);
  P(-swp * 1.15 - chord * 0.13, -half * tL, half * tU);

  // Colour: pale body, dark outer panel. The tip colour is what carries the read at 300 m.
  for (let i = 0; i < VERTS_PER_BIRD; i++) {
    const outer = i === 6 || i === 7 || i === 10 || i === 11;
    const c = outer ? tip : body;
    const o = (base + i) * 3;
    col[o] = c[0];
    col[o + 1] = c[1];
    col[o + 2] = c[2];
    mtl[base + i] = MAT.MATTE;
  }
  return v;
}

/* ── the live set ─────────────────────────────────────────────────────────────*/

const RESCAN_INTERVAL = 0.55; // seconds; a rolling window, not a per-frame scan
const UNLOAD_MARGIN = TILE * 1.5; // hysteresis so a tile at the edge does not thrash
/** Re-snap the local geometry origin once the car has moved this far from it. Keeps the
 *  vertex coordinates the paint grain is sampled from inside a few hundred metres. */
const ANCHOR_STEP = 256;

export class Birds {
  /**
   * @param {object} opts
   * @param {number} opts.seed
   * @param {import('three').Object3D} opts.scene
   * @param {boolean} [opts.enabled] off switch for a harness that wants no THREE at all
   */
  constructor({ seed, scene, enabled = true }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.enabled = enabled;

    /** "gi,gj" -> null (evaluated, empty) | flock spec */
    this.tiles = new Map();
    this._rescanT = 0;
    this._t = 0;
    this._ax = 0;
    this._az = 0;
    /** Read by tools/diag-birds.mjs and by the live-scene probe the audit will run.
     *  `drawn` is the number of birds ACTUALLY written into the geometry this frame — not
     *  the number that exist, and not a flag. A flag being set is not a thing being visible,
     *  and this project has shipped that bug before. */
    this.stats = { flocks: 0, birds: 0, drawn: 0, sea: 0, land: 0, evaluated: 0 };

    if (!enabled || !scene) return;

    this.material = createPaintedMaterial();
    const g = new BufferGeometry();
    this._pos = new Float32Array(MAX_BIRDS * VERTS_PER_BIRD * 3);
    this._nrm = new Float32Array(MAX_BIRDS * VERTS_PER_BIRD * 3);
    this._col = new Float32Array(MAX_BIRDS * VERTS_PER_BIRD * 3);
    this._mat = new Float32Array(MAX_BIRDS * VERTS_PER_BIRD);
    g.setAttribute('position', new BufferAttribute(this._pos, 3));
    g.setAttribute('nrm', new BufferAttribute(this._nrm, 3));
    g.setAttribute('vcol', new BufferAttribute(this._col, 3));
    g.setAttribute('vmat', new BufferAttribute(this._mat, 1));
    g.setIndex(new BufferAttribute(buildIndices(MAX_BIRDS), 1));
    g.setDrawRange(0, 0);
    this.geometry = g;

    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'birds';
    /* Never frustum-culled: the bounding sphere would have to be recomputed every frame from
     * a geometry that moves every frame, and a wrong one pops the whole flock out of frame at
     * the exact moment the camera turns toward it. Sixty-odd triangles do not need culling. */
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /**
   * @param {number} dt seconds
   * @param {number} carX
   * @param {number} carZ
   */
  update(dt, carX, carZ) {
    if (!this.enabled || !this.mesh) return;
    this._t += dt;
    this._rescanT -= dt;
    if (this._rescanT <= 0) {
      this._rescanT = RESCAN_INTERVAL;
      this._rescan(carX, carZ);
    }

    // Re-anchor in steps rather than continuously: a continuously moving origin would make
    // the paint grain crawl over every bird as the car drives.
    if (Math.abs(carX - this._ax) > ANCHOR_STEP || Math.abs(carZ - this._az) > ANCHOR_STEP) {
      this._ax = Math.round(carX / ANCHOR_STEP) * ANCHOR_STEP;
      this._az = Math.round(carZ / ANCHOR_STEP) * ANCHOR_STEP;
      this.mesh.position.set(this._ax, 0, this._az);
    }

    const t = this._t;
    const pos = this._pos;
    const nrm = this._nrm;
    const col = this._col;
    const mtl = this._mat;
    let v = 0;
    let drawn = 0;

    for (const flock of this.tiles.values()) {
      if (!flock) continue;
      const sea = flock.kind === 'sea';
      const body = sea ? GULL_BODY : LAND_BODY;
      const tipc = sea ? GULL_TIP : LAND_TIP;
      for (const b of flock.birds) {
        if (drawn >= MAX_BIRDS) break;
        const a = b.phase + t * b.w;
        const s = Math.sin(a);
        const c = Math.cos(a);
        const x = flock.x + s * b.r;
        const z = flock.z + c * b.r;
        // Cheap range reject AFTER the orbit is known, so a bird does not pop as its own
        // orbit carries it over the line — the flock centre is what the rescan windows on.
        const dx = x - carX;
        const dz = z - carZ;
        if (dx * dx + dz * dz > RANGE * RANGE) continue;

        const y = flock.baseY + b.y + Math.sin(t * b.bobHz * TAU + b.phase) * b.bobA;
        /* Heading is the orbit TANGENT. d/da of (sin a, cos a) is (cos a, -sin a), and the
         * sign of the angular speed decides which way round the ring the bird is going. */
        const yaw = Math.atan2(c * Math.sign(b.w), -s * Math.sign(b.w));
        // A banked turn: lean into the circle, harder the tighter and faster the orbit.
        const bank = clamp((b.w * b.w * b.r) / 9.81, -0.6, 0.6) * (b.w > 0 ? 1 : -1);
        /* Flap in bursts. `glide` is a slow envelope: for most of its cycle the wings are
         * held in a shallow glide and only the burst actually beats. A bird that flaps
         * metronomically for ever is the single most artificial thing a cheap flock can do. */
        const glide = clamp01(Math.sin(t * b.glideHz * TAU + b.glidePhase) * 1.9 - 0.35);
        const beat = Math.sin(t * b.flapHz * TAU + b.flapPhase);
        const flap = 0.13 + glide * beat * 0.62;

        v = writeBird(pos, nrm, col, mtl, v, x - this._ax, y, z - this._az, yaw, bank, flap, b.span, body, tipc);
        drawn++;
      }
      if (drawn >= MAX_BIRDS) break;
    }

    this.stats.drawn = drawn;
    this.geometry.setDrawRange(0, drawn * IDX_PER_BIRD);
    if (drawn > 0) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.nrm.needsUpdate = true;
      this.geometry.attributes.vcol.needsUpdate = true;
      this.geometry.attributes.vmat.needsUpdate = true;
    }
  }

  _rescan(carX, carZ) {
    const gi0 = Math.floor((carX - RANGE) / TILE);
    const gi1 = Math.floor((carX + RANGE) / TILE);
    const gj0 = Math.floor((carZ - RANGE) / TILE);
    const gj1 = Math.floor((carZ + RANGE) / TILE);
    const want = new Set();
    for (let gj = gj0; gj <= gj1; gj++) {
      for (let gi = gi0; gi <= gi1; gi++) {
        const key = `${gi},${gj}`;
        want.add(key);
        if (this.tiles.has(key)) continue;
        this.stats.evaluated++;
        this.tiles.set(key, evaluateFlockSite(gi, gj, this.seed));
      }
    }
    for (const [key] of this.tiles) {
      if (want.has(key)) continue;
      const [gi, gj] = key.split(',').map(Number);
      const cx = (gi + 0.5) * TILE;
      const cz = (gj + 0.5) * TILE;
      if (Math.abs(cx - carX) < RANGE + UNLOAD_MARGIN && Math.abs(cz - carZ) < RANGE + UNLOAD_MARGIN) continue;
      this.tiles.delete(key);
    }

    let flocks = 0;
    let birds = 0;
    let sea = 0;
    let land = 0;
    for (const f of this.tiles.values()) {
      if (!f) continue;
      flocks++;
      birds += f.birds.length;
      if (f.kind === 'sea') sea++;
      else land++;
    }
    this.stats.flocks = flocks;
    this.stats.birds = birds;
    this.stats.sea = sea;
    this.stats.land = land;
  }

  /** Metres to the nearest live bird, or Infinity — the audio layer's own bird-call rate is
   *  driven by tree density (audio/ambience.js), and this lets a caller keep the two honest
   *  about each other without this file reaching into the WebAudio graph. */
  nearestDistance(x, z) {
    let best = Infinity;
    for (const f of this.tiles.values()) {
      if (!f) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < best) best = d;
    }
    return best;
  }

  dispose() {
    this.tiles.clear();
    if (!this.mesh) return;
    this.scene?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
    this.mesh = null;
    this.stats.drawn = 0;
  }
}
