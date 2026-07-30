/* Wanderoad — loot: the suns and gems you actually see, and their pickup.
 *
 * Two rolling windows, each borrowed wholesale from a system this project already trusts,
 * because both are already the right shape for what a sun and a gem need:
 *
 *   SUNS piggyback src/render/props.js's own tile-walk (a grid of square tiles around the
 *   car, released and rebuilt as it moves) but with its own, smaller TILE/RANGE — suns never
 *   need a Terrain build the way a prop does (world/loot.js's sunsInBox is a pure function of
 *   the road network alone), so unlike Props there is no multi-phase per-tile job: one tile's
 *   suns are cheap enough to build in a single step, and only a small budget of tiles is
 *   drained per frame so a teleport-sized jump (a reset, a spawn) never costs one big frame.
 *
 *   GEMS reuse src/render/ships.js's lattice idiom exactly: one jittered candidate per cell,
 *   evaluated on a 0.5 s rescan rather than every frame, at most one gem per tile.
 *
 * Both are INDIVIDUALLY MESHED, never baked into one shared tile geometry the way ambient
 * props are — the render/props.js `_updateCans` pattern this file follows: a pickup has to
 * disappear the instant it is collected and has to animate every frame, and a static bake can
 * do neither without rebuilding the whole tile for one object. Geometry is built once, in
 * LOCAL space centred on the object's own origin, so the per-frame bob and spin are ordinary
 * Object3D transform writes rather than a re-bake — nothing here touches a vertex after the
 * mesh is built.
 */

import { Mesh, Object3D } from 'three';
import { PB, pcyl, ptri, finishPainted, createPaintedMaterial, MAT, LC, mixc } from './painted.js';
import { sunsInBox, gemsForTile, GEM_TILE } from '../world/loot.js';
import { hash3i, rng, TAU } from '../core/math.js';

/* ── sun window (props.js tile-walk idiom) ──────────────────────────────────
 * Smaller than Props' own TILE/RANGE (384/1180): suns are a road-hugging feature seen close
 * up, not a landmark that has to read from a kilometre away the way a windmill does. */
export const TILE = 384;
export const RANGE = 900;
/** How many un-built sun tiles this may bake in one frame. Building one tile is cheap (an
 *  edge walk plus a memoised elevation lookup — no Terrain, unlike Props), but a fast reset or
 *  a car teleported across the map can want dozens of tiles at once, and none of them should
 *  cost one frame all together. */
const SUN_TILE_BUDGET = 2;

/* ── gem window (ships.js lattice idiom) ─────────────────────────────────── */
export const GEM_RANGE = 1200;
const GEM_RESCAN_INTERVAL = 0.5;
const GEM_UNLOAD_MARGIN = GEM_TILE * 1.5;

/** Drive within this of a sun and it is collected. */
export const SUN_RADIUS = 7;
/** Drive within this of a gem and it is collected — only while boating. */
export const GEM_RADIUS = 10;

/* ── bob and spin — cozy, not garish; see docs/BOAT-PLAN.md's own numbers for the two it
 * states explicitly (the bob amplitudes and the sun's spin rate). The bob rates themselves are
 * this file's own call, pitched between the floating fuel can's lively 0.52 Hz (render/props.js
 * CAN_BOB_HZ) and the anchored ship's slow 0.11 Hz swell — a sun is smaller and livelier than
 * either, a gem a little more serene. */
export const SUN_BOB_AMP = 0.12;
const SUN_BOB_HZ = 0.6;
const SUN_SPIN_RATE = 2.2; // rad/s
const GEM_BOB_AMP = 0.2;
const GEM_BOB_HZ = 0.38;
const GEM_SPIN_RATE = 1.1; // rad/s
/* A gentle scale pulse, ON TOP of the bob/spin above rather than replacing either — a second,
 * slow "breathing" cue that helps a gem separate from a static scribble on the water even
 * before its colour or size does the rest of the work. ±8% at ~0.5 Hz, per-gem phase so a
 * cluster does not pulse in lockstep. */
const GEM_PULSE_AMP = 0.08;
const GEM_PULSE_HZ = 0.5;

/* ── geometry, built once per item, in LOCAL space centred on its own origin ────────────────
 * Nothing here is blitted at a world position — see the file header for why: the mesh's own
 * Object3D.position/.rotation carry the world placement AND the animation, every frame, so the
 * geometry never has to know where in the world it lives.
 */

export const SUN_R = 0.55;
const SUN_THICK = 0.12;
/* A HOT CORE, not painted metal. Operator: "coin looks like the sun not coin -- i like that lets
 * make it collecting suns", then "make them shine :P".
 *
 * MAT.EMIT rather than MAT.METAL is the whole change in one word: EMIT is unlit by the sun (it is
 * the material the station beacons and lit windows use), so a pickup glows at dusk and under trees
 * instead of going grey with everything else. The colour is pushed towards white at the centre for
 * the same reason a real light source photographs blown-out in the middle. */
const SUN_COL = mixc(LC('lineYellow'), LC('paintB'), 0.35);
const SUN_HOT = mixc(SUN_COL, [1, 0.98, 0.9], 0.55);
/** How far the rays reach past the body, as a fraction of SUN_R. */
export const SUN_RAY_LEN = 0.95;
const SUN_RAYS = 8;

/** A little sun: a glowing disc with eight rays around it.
 *
 *  Still the "cylinder lying on an axis" trick render/props.js's `pwheel` uses for a wheel — a disc
 *  standing on edge — but with a brighter inner disc proud of the face and a ring of tapered spokes.
 *  Spinning the finished mesh about Y (see `_animate`) sweeps the rays past the eye, which is what
 *  makes it twinkle rather than merely rotate. */
function buildSun(M) {
  // the body, and a hotter inner disc a hair in front of each face so the middle reads brightest
  pcyl(M, [-SUN_THICK * 0.5, 0, 0], [SUN_THICK * 0.5, 0, 0], SUN_R, SUN_R, 12, SUN_COL, MAT.EMIT, true, true);
  for (const side of [-1, 1]) {
    const a = side * (SUN_THICK * 0.5 + 0.006);
    pcyl(M, [a, 0, 0], [a + side * 0.02, 0, 0], SUN_R * 0.58, SUN_R * 0.58, 10, SUN_HOT, MAT.EMIT, true, true);
  }
  /* THE RAYS. Tapered spokes in the disc's own plane (the disc lies in Y/Z, since it is a cylinder
   * along X), alternating long and short so the silhouette is a star rather than a gear. */
  for (let k = 0; k < SUN_RAYS; k++) {
    const th = (k / SUN_RAYS) * Math.PI * 2;
    const len = SUN_R * SUN_RAY_LEN * (k % 2 ? 0.62 : 1);
    const from = SUN_R * 0.86;
    const to = SUN_R + len;
    pcyl(
      M,
      [0, Math.sin(th) * from, Math.cos(th) * from],
      [0, Math.sin(th) * to, Math.cos(th) * to],
      SUN_THICK * 0.42,
      SUN_THICK * 0.06,
      4,
      SUN_HOT,
      MAT.EMIT,
      false,
      false
    );
  }
}

// 1.5x the original 0.8 — playtest report: "diamonds invisible against the new pale foam
// water" was partly a size problem too, not only colour.
const GEM_SCALE = 1.2;
// Was mixc(glass, wSpark, 0.4) — a pale, near-white blend that all but vanished against the
// foam drawings' own near-white ${C.wFoam} strokes (playtest report, verbatim). paintC mixed
// TOWARD glass instead: a saturated, deep cyan-blue, darker and bluer than any foam on this
// water, so a gem reads as a gem against the white scribbles rather than disappearing into
// them.
const GEM_COL = mixc(LC('paintC'), LC('glass'), 0.35);

/** An octahedron: two four-sided pyramids joined base to base. `painted.js` has no built-in
 *  octahedron primitive (pbox/pcyl/proof cover the pen's own catalogue, which never needed
 *  one), so this is eight loose triangles built with `ptri` — the same "lofted shape, no
 *  primitive fits" reasoning render/ships.js's own hull uses. */
function buildGem(M) {
  const r = 0.5 * GEM_SCALE;
  const h = 0.72 * GEM_SCALE;
  const top = [0, h, 0];
  const bot = [0, -h, 0];
  const ring = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    ring.push([Math.sin(a) * r, 0, Math.cos(a) * r]);
  }
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    ptri(M, top, ring[i], ring[j], GEM_COL, MAT.GLASS);
    ptri(M, bot, ring[j], ring[i], GEM_COL, MAT.GLASS);
  }
}

/**
 * Suns along the road and gems on open water — placement (world/loot.js), rendering and
 * pickup all in one class, the same shape src/render/ships.js and src/render/props.js's own
 * fuel cans already take.
 */
export class Loot {
  /** @param {object} opts @param {number} opts.seed @param {THREE.Object3D} opts.scene */
  constructor({ seed, scene }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.material = createPaintedMaterial();

    this.group = new Object3D();
    this.group.name = 'loot';
    scene.add(this.group);

    /** id -> { mesh, x, y, z, phase, tile } */
    this.suns = new Map();
    /** "tx,tz" -> array of sun ids that tile owns */
    this.sunTiles = new Map();
    this._sunPending = [];
    /** Collected this session — never respawns while the tile stays loaded, same fuel-can
     *  rule (world/props.js's own note): the world is a pure function of the seed, so without
     *  this a tile that leaves the window and comes back would hand out the same sun again. */
    this._collectedSuns = new Set();
    this._pendingSuns = 0;
    this._lastSunCx = Infinity;
    this._lastSunCz = Infinity;

    /** "gi,gj" -> null (evaluated, nothing there) | { mesh, x, y, z, phase, id } */
    this.gemTiles = new Map();
    this._collectedGems = new Set();
    this._pendingGems = 0;
    this._gemRescanT = 0;

    this._t = 0;
    this.stats = { suns: 0, sunTiles: 0, gems: 0, gemTiles: 0 };
  }

  /**
   * @param {number} dt seconds
   * @param {object} car needs .x, .z — the car's own position, not the camera's, the same
   *        convention render/props.js's Props.update() documents for its own nearestStation().
   * @param {boolean} boatActive gems are only collectible while boating (docs/BOAT-PLAN.md) —
   *        driven by src/game/boat.js (workstream C); see src/main.js's own wiring note for
   *        the placeholder this runs against until that lands.
   */
  update(dt, car, boatActive) {
    this._t += dt;
    this._reshapeSuns(car.x, car.z);
    this._drainSunTiles();

    this._gemRescanT -= dt;
    if (this._gemRescanT <= 0) {
      this._gemRescanT = GEM_RESCAN_INTERVAL;
      this._rescanGems(car.x, car.z);
    }

    this._animate(car, boatActive);
  }

  /** Suns collected since the last call, as a count (0 if none). Fuel-can drain pattern
   *  (render/props.js drainCollectedFuel / src/game/streak.js drain). */
  drainSuns() {
    const n = this._pendingSuns;
    this._pendingSuns = 0;
    return n;
  }

  /** Gems collected since the last call, as a count (0 if none). */
  drainGems() {
    const n = this._pendingGems;
    this._pendingGems = 0;
    return n;
  }

  /* ── suns ─────────────────────────────────────────────────────────────── */

  _reshapeSuns(camX, camZ) {
    const cx = Math.floor(camX / TILE);
    const cz = Math.floor(camZ / TILE);
    if (cx === this._lastSunCx && cz === this._lastSunCz) return;
    this._lastSunCx = cx;
    this._lastSunCz = cz;

    const n = Math.ceil(RANGE / TILE);
    const want = new Set();
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const tx = cx + i;
        const tz = cz + j;
        const dx = Math.max(0, Math.abs((tx + 0.5) * TILE - camX) - TILE * 0.5);
        const dz = Math.max(0, Math.abs((tz + 0.5) * TILE - camZ) - TILE * 0.5);
        if (Math.hypot(dx, dz) > RANGE) continue;
        want.add(`${tx},${tz}`);
      }
    }
    for (const key of want) {
      if (this.sunTiles.has(key) || this._sunPending.some((p) => p.key === key)) continue;
      const [tx, tz] = key.split(',').map(Number);
      this._sunPending.push({ key, tx, tz });
    }
    this._sunPending.sort((a, b) => this._sunD2(a, camX, camZ) - this._sunD2(b, camX, camZ));
    for (const [key, ids] of this.sunTiles) {
      if (want.has(key)) continue;
      this._releaseSunTile(key, ids);
    }
    this._sunPending = this._sunPending.filter((p) => want.has(p.key));
  }

  _sunD2(p, camX, camZ) {
    const mx = (p.tx + 0.5) * TILE - camX;
    const mz = (p.tz + 0.5) * TILE - camZ;
    return mx * mx + mz * mz;
  }

  _drainSunTiles() {
    let budget = SUN_TILE_BUDGET;
    while (budget-- > 0 && this._sunPending.length) {
      this._buildSunTile(this._sunPending.shift());
    }
  }

  _buildSunTile(job) {
    const { key, tx, tz } = job;
    const ox = tx * TILE;
    const oz = tz * TILE;
    const suns = sunsInBox(ox, oz, ox + TILE, oz + TILE, this.seed);
    const ids = [];
    for (const c of suns) {
      if (this._collectedSuns.has(c.id)) continue;
      const M = PB();
      buildSun(M);
      const geom = finishPainted(M);
      const mesh = new Mesh(geom, this.material);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = true;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      // Own bob/spin phase per sun, keyed on its rounded world position — stable across a
      // tile rebuild, the same argument render/props.js's own can/prop phase makes.
      const phase = rng(hash3i(Math.round(c.x * 4), Math.round(c.z * 4), 0x636f6e31, this.seed))() * TAU;
      this.suns.set(c.id, { mesh, x: c.x, y: c.y, z: c.z, phase, tile: key });
      ids.push(c.id);
    }
    this.sunTiles.set(key, ids);
    this._recount();
  }

  _releaseSunTile(key, ids) {
    for (const id of ids) {
      const c = this.suns.get(id);
      if (!c) continue; // already collected, and therefore already removed
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      this.suns.delete(id);
    }
    this.sunTiles.delete(key);
    this._recount();
  }

  /* ── gems ──────────────────────────────────────────────────────────────── */

  _rescanGems(camX, camZ) {
    const gi0 = Math.floor((camX - GEM_RANGE) / GEM_TILE);
    const gi1 = Math.floor((camX + GEM_RANGE) / GEM_TILE);
    const gj0 = Math.floor((camZ - GEM_RANGE) / GEM_TILE);
    const gj1 = Math.floor((camZ + GEM_RANGE) / GEM_TILE);
    const want = new Set();
    for (let gj = gj0; gj <= gj1; gj++) {
      for (let gi = gi0; gi <= gi1; gi++) {
        const key = `${gi},${gj}`;
        want.add(key);
        if (this.gemTiles.has(key)) continue;
        const spec = gemsForTile(gi, gj, this.seed);
        if (!spec || this._collectedGems.has(spec.id)) {
          this.gemTiles.set(key, null);
          continue;
        }
        const M = PB();
        buildGem(M);
        const geom = finishPainted(M);
        const mesh = new Mesh(geom, this.material);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = true;
        mesh.renderOrder = 2;
        this.group.add(mesh);
        const phase = rng(hash3i(gi, gj, 0x67656d32, this.seed))() * TAU;
        this.gemTiles.set(key, { mesh, x: spec.x, y: spec.y, z: spec.z, phase, id: spec.id });
      }
    }
    for (const [key, rec] of this.gemTiles) {
      if (want.has(key)) continue;
      const [gi, gj] = key.split(',').map(Number);
      const cx = (gi + 0.5) * GEM_TILE;
      const cz = (gj + 0.5) * GEM_TILE;
      if (Math.abs(cx - camX) < GEM_RANGE + GEM_UNLOAD_MARGIN && Math.abs(cz - camZ) < GEM_RANGE + GEM_UNLOAD_MARGIN) continue;
      if (rec) {
        this.group.remove(rec.mesh);
        rec.mesh.geometry.dispose();
      }
      this.gemTiles.delete(key);
    }
    this._recount();
  }

  /* ── per-frame animation and pickup ───────────────────────────────────────
   * One pass each, no allocation: Math.hypot/Math.sin take numbers, mesh.position.set() and
   * mesh.rotation.y writes mutate the existing Object3D, and updateMatrix() is the same manual
   * call render/props.js's own `_updateCans` makes (matrixAutoUpdate is off on every item mesh
   * for exactly that reason). Collection is the only branch that allocates anything, and it is
   * rare by design. */
  _animate(car, boatActive) {
    const t = this._t;
    for (const [id, c] of this.suns) {
      const d = Math.hypot(c.x - car.x, c.z - car.z);
      if (d <= SUN_RADIUS) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.suns.delete(id);
        this._collectedSuns.add(id);
        this._pendingSuns++;
        continue;
      }
      const bob = Math.sin(t * SUN_BOB_HZ * TAU + c.phase) * SUN_BOB_AMP;
      c.mesh.position.set(c.x, c.y + bob, c.z);
      c.mesh.rotation.y = (t + c.phase) * SUN_SPIN_RATE;
      c.mesh.updateMatrix();
    }

    for (const [key, g] of this.gemTiles) {
      if (!g) continue;
      if (boatActive) {
        const d = Math.hypot(g.x - car.x, g.z - car.z);
        if (d <= GEM_RADIUS) {
          this.group.remove(g.mesh);
          g.mesh.geometry.dispose();
          this.gemTiles.set(key, null);
          this._collectedGems.add(g.id);
          this._pendingGems++;
          continue;
        }
      }
      const bob = Math.sin(t * GEM_BOB_HZ * TAU + g.phase) * GEM_BOB_AMP;
      g.mesh.position.set(g.x, g.y + bob, g.z);
      g.mesh.rotation.y = (t + g.phase) * GEM_SPIN_RATE;
      const pulse = 1 + Math.sin(t * GEM_PULSE_HZ * TAU + g.phase) * GEM_PULSE_AMP;
      g.mesh.scale.setScalar(pulse);
      g.mesh.updateMatrix();
    }
  }

  _recount() {
    this.stats.suns = this.suns.size;
    this.stats.sunTiles = this.sunTiles.size;
    let gems = 0;
    for (const g of this.gemTiles.values()) if (g) gems++;
    this.stats.gems = gems;
    this.stats.gemTiles = this.gemTiles.size;
  }

  dispose() {
    for (const c of this.suns.values()) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
    }
    this.suns.clear();
    this.sunTiles.clear();
    this._sunPending = [];
    for (const g of this.gemTiles.values()) {
      if (!g) continue;
      this.group.remove(g.mesh);
      g.mesh.geometry.dispose();
    }
    this.gemTiles.clear();
    this.scene.remove(this.group);
    this.material.dispose();
    this.stats.suns = 0;
    this.stats.sunTiles = 0;
    this.stats.gems = 0;
    this.stats.gemTiles = 0;
  }
}
