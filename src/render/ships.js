/* Wanderoad — boats: a rare, slow silhouette on genuinely large open water.
 *
 * Operator report, verbatim: "large bodies of water should be flat and have ships on em." This
 * is the "ships" half; the "flat" half lives in src/render/water.js, which this file shares its
 * one size measurement with — waterOpenness() there is exactly the "is this a real lake, not a
 * puddle" question a ship placement needs too, so both features agree about what "large" means.
 *
 * Modelled in code through this project's own painted-solid pipeline (src/render/painted.js),
 * the same way the 100 roadside props are — see docs/CREDITS.md for why nothing here is a
 * downloaded asset. A boat is two low-poly shapes: a hull (five faces — transom, two sides, a
 * bottom, a deck, all tapering to a single stem edge at the bow) and, on some, a small cabin box
 * and a thin mast. Deliberately blocky: this project's whole visual language is a handful of
 * flat-shaded faces reading as a shape from a driving distance, not a hull with a lofted curve.
 *
 * PLACEMENT is a rolling lattice of tiles around the car — like src/render/props.js and
 * src/render/road.js, and for the same reason its own header gives: tying a sparse, rare
 * feature to the terrain quadtree would re-decide (and potentially re-place) it every time a
 * chunk's LOD changes, which is a worse bug than the one this avoids. One candidate site per
 * TILE, deterministically jittered from (seed, tile index) — no Math.random, ever, matching
 * every other generator in this game even though this file sits under src/render/ rather than
 * src/world/. A candidate must pass, in increasing order of cost (cheapest, most discriminating
 * rejections first — the same ordering discipline src/world/scatter.js documents for exactly
 * the same reason):
 *
 *   1. real depth at the exact point (not a damp patch)
 *   2. waterOpenness() over the large-body threshold (see src/render/water.js)
 *   3. a tight ring around the candidate's own footprint, ALL of it wet — the hard shoreline
 *      guarantee, independent of the openness classification above
 *   4. clear of every road by a wide margin (world/roads.js's own cheap standalone query)
 *   5. a rarity draw, so even a huge qualifying lake gets a handful of boats, not a fleet
 *
 * A ship never moves its (x, z) once placed — it bobs, rocks and slowly swings its heading in
 * place, like a boat at anchor, entirely in Object3D transform updates (see Ships.update()).
 * That is a deliberate safety property as much as a look: rules 3 and 4 above are only ever
 * checked once, at placement, so nothing that could drift a hull onto a road or a shore is ever
 * allowed to actually happen.
 */

import { Mesh, Object3D } from 'three';
import { PB, ptri, pquad, pbox, pcyl, rotY, finishPainted, createPaintedMaterial, MAT, LC, tint, mixc } from './painted.js';
import { waterOpenness } from './water.js';
import { biomeWeights, waterLevelAt, BIOME_COUNT } from '../world/biomes.js';
import { landHeight, landFn } from '../world/terrain.js';
import { roadDistance } from '../world/roads.js';
import { TAU, hash3i, rng, lerp } from '../core/math.js';

/* ── tunables, all read by tools/diag-openwater.mjs so the numbers printed there are the
 * numbers the game actually uses ────────────────────────────────────────────────────────── */

/** Candidate lattice spacing, metres. One jittered site per tile, gated hard below — see
 *  ACCEPT_P for why 500 m is not the rarity dial. Measured (`node tools/diag-openwater.mjs`):
 *  over a real 144 km² square of this seed, only 34 of 625 500 m tiles even have their single
 *  jittered point land somewhere that clears every placement gate but the rarity draw — a
 *  coarser tile (900 m was the first value tried) starves that number down to 7, which is thin
 *  enough that a single unlucky seed can realise zero ships anywhere in 144 km² even with a
 *  generous accept rate; 500 m keeps enough independent draws that ACCEPT_P alone controls how
 *  rare the RESULT looks, rather than the lattice spacing accidentally controlling it too. */
export const TILE = 500;
/** How far out ships exist at all. A hull is a big, simple silhouette — like the petrol
 *  stations, it should be visible well before you are near it. */
export const RANGE = 1500;
/** waterOpenness() floor to even be considered "large water". Same file, same calibration —
 *  see the OPEN_LO/OPEN_HI comment in src/render/water.js. Set a little above water.js's own
 *  OPEN_LO (0.55): visual calming can fade in gradually over a wide band and nothing breaks if
 *  it starts a little early, but a MISPLACED ship is a harder failure, so placement asks for
 *  more margin than the shader damping does. */
export const OPEN_MIN = 0.68;
/** Real depth, in metres, the exact candidate point must clear — keeps a ship off a damp
 *  wetland pan that happens to score open by proximity to other pools nearby. */
export const MIN_DEPTH = 1.5;
/** Tight all-round clearance ring, metres, and how many spokes — the hard "never touches shore"
 *  guarantee, independent of (and stricter at close range than) the openness classification. A
 *  9-11 m hull sits comfortably inside this with room for the bob/rock/swing animation to never
 *  approach the edge, since (x, z) itself never moves after placement. */
export const SHORE_CLEAR_R = 40;
export const SHORE_CLEAR_DIRS = 12;
/** Minimum distance from any road centreline, metres — generous over the widest carriageway
 *  (10.5 m, dunes) plus verge, so a lake-side road or a causeway is never in a ship's shadow. */
export const ROAD_CLEAR = 70;
/** Rarity draw applied to a site that has already passed every placement test. Tuned from
 *  `node tools/diag-openwater.mjs`'s "ships per km² of qualifying water" measurement, not
 *  guessed: at TILE 500 this real seed has 34 qualifying sites in 144 km² (12.08 km² of which
 *  is large-open-water by this same file's own gate), so 0.3 realises 7 real ships — about one
 *  per 1.7 km² of qualifying water, robust against an unlucky seed (34 independent draws at
 *  30% each puts realising zero at roughly 1 in 100,000) while still reading as rare rather
 *  than a fleet. See that tool's own printed table for the exact, current numbers. */
export const ACCEPT_P = 0.3;

const _wShip = new Float32Array(BIOME_COUNT);
/** Metres of dry ground above the local water table at (x, z); negative means underwater. */
function freeboardAt(x, z, seed) {
  const b = biomeWeights(x, z, seed, _wShip);
  const plane = waterLevelAt(b.w, -Infinity);
  return plane === null ? 1e9 : landHeight(x, z, seed) - plane;
}
/** The water surface height at (x, z) — always a number here, since callers only ask once
 *  freeboardAt() has already confirmed the point is wet. */
function waterPlaneAt(x, z, seed) {
  const b = biomeWeights(x, z, seed, _wShip);
  return waterLevelAt(b.w, -Infinity);
}

/**
 * Evaluate one lattice cell. Returns a placement spec or null. Exported (and side-effect-free —
 * no THREE object touched) so tools/diag-openwater.mjs can drive it directly over thousands of
 * cells for real placement statistics without a renderer.
 */
export function evaluateShipSite(gi, gj, seed) {
  const r = rng(hash3i(gi, gj, 0x51417, seed));
  const x = (gi + r()) * TILE;
  const z = (gj + r()) * TILE;

  // 1. real depth, cheapest and most discriminating — most of any tile is dry land.
  const fb = freeboardAt(x, z, seed);
  if (fb >= -MIN_DEPTH) return null;

  // 2. large-body gate.
  const openness = waterOpenness(x, z, seed);
  if (openness < OPEN_MIN) return null;

  // 3. tight shoreline clearance — every spoke must still be genuinely wet.
  for (let i = 0; i < SHORE_CLEAR_DIRS; i++) {
    const a = (i / SHORE_CLEAR_DIRS) * TAU;
    if (freeboardAt(x + Math.sin(a) * SHORE_CLEAR_R, z + Math.cos(a) * SHORE_CLEAR_R, seed) >= -0.3) return null;
  }

  // 4. road clearance — the most expensive single test, so it runs last among the hard gates.
  const rd = roadDistance(x, z, seed, landFn(seed));
  if (rd.d < ROAD_CLEAR) return null;

  // 5. rarity draw, only ever paid for by a site that already cleared everything above.
  if (r() >= ACCEPT_P) return null;

  const y = waterPlaneAt(x, z, seed);
  return {
    x,
    y,
    z,
    yaw: r() * TAU,
    scaleT: r(),
    hue: r(),
    trimT: r(),
    hasCabin: r() < 0.55,
    hasMast: r() < 0.4,
    phase: r() * TAU,
    openness,
  };
}

/* ── geometry ─────────────────────────────────────────────────────────────── */

const HULL_PALETTE = [LC('paintA'), LC('paintC'), LC('paintE'), tint(LC('timber'), 1.12)];
const DECK_COL = mixc(LC('timber'), LC('sA'), 0.35);
const MAST_COL = LC('trunkShade');

/**
 * A single low-poly hull, tapering to a stem edge at the bow. Five faces: transom, port side,
 * starboard side, bottom, deck — see the file header for why this shape and not a lofted curve.
 * `y` is the local origin, placed at the water's own surface: the keel sits a little below it
 * and most of the freeboard a little above, which is what reads as "floating" without any
 * actual water-surface intersection test, the same trick buildFuelCan() uses for hover.
 */
function addHull(M, cx, cy, cz, yaw, L, B, H, hullCol, deckCol) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const P = (lx, ly, lz) => {
    const [x, z] = rotY(lx, lz, ca, sa);
    return [cx + x, cy + ly, cz + z];
  };
  const OUT = (lx, lz) => {
    const [x, z] = rotY(lx, lz, ca, sa);
    return [x, 0, z];
  };
  const hz = L * 0.5;
  const hx = B * 0.5;
  const keel = -H * 0.42;
  const gun = H * 0.58;

  const sBL = P(-hx, keel, -hz);
  const sBR = P(hx, keel, -hz);
  const sTL = P(-hx, gun, -hz);
  const sTR = P(hx, gun, -hz);
  const bowB = P(0, keel * 0.7, hz);
  const bowT = P(0, gun, hz);

  pquad(M, sBL, sBR, sTR, sTL, hullCol, MAT.MATTE, OUT(0, -1)); // transom (stern)
  pquad(M, sBL, sTL, bowT, bowB, hullCol, MAT.MATTE, OUT(-1, 0.3)); // port side
  pquad(M, sTR, sBR, bowB, bowT, hullCol, MAT.MATTE, OUT(1, 0.3)); // starboard side
  ptri(M, sBR, sBL, bowB, tint(hullCol, 0.82), MAT.MATTE); // bottom, a touch darker (wet)
  ptri(M, sTL, sTR, bowT, deckCol, MAT.MATTE); // deck

  return { P, gun, hz };
}

/** One boat, built into the shared builder `M` at its own world position. */
function buildBoat(M, spec) {
  const { x, y, z, yaw, scaleT, hue, trimT, hasCabin, hasMast } = spec;
  const L = lerp(6.5, 11, scaleT);
  const B = L * 0.33;
  const H = L * 0.17;
  const hullCol = HULL_PALETTE[Math.min(HULL_PALETTE.length - 1, (hue * HULL_PALETTE.length) | 0)];
  const cabinCol = mixc(LC('wallA'), LC('wallB'), trimT);

  const { P, gun } = addHull(M, x, y, z, yaw, L, B, H, hullCol, DECK_COL);

  if (hasCabin) {
    const c = P(0, gun + H * 0.34, -L * 0.08);
    pbox(M, c[0], c[1], c[2], B * 0.30, H * 0.36, L * 0.15, yaw, cabinCol, MAT.MATTE);
  }
  if (hasMast) {
    const base = P(0, gun, -L * 0.05);
    const top = P(0, gun + L * 0.6, -L * 0.05);
    pcyl(M, base, top, L * 0.013, L * 0.007, 5, MAST_COL, MAT.MATTE, true, false);
    // a small pennant near the masthead, big enough to read as motion when it slowly swings
    const pA = P(0, gun + L * 0.56, -L * 0.05);
    const pB = P(L * 0.11, gun + L * 0.50, -L * 0.05);
    const pC = P(0, gun + L * 0.47, -L * 0.05);
    ptri(M, pA, pB, pC, hullCol, MAT.MATTE);
  }
}

/* ── the live set ─────────────────────────────────────────────────────────── */

const RESCAN_INTERVAL = 0.5; // seconds — a rolling window, not a per-frame scan
const UNLOAD_MARGIN = TILE * 1.5; // hysteresis so a tile at the window edge does not thrash

/** The gentle bob-rock-swing at anchor. Nothing here ever touches (x, z) — see the file header
 *  for why that is a safety property and not just a look. Tuned slower and larger than the
 *  floating fuel can (CAN_BOB_AMP/HZ in render/props.js): a boat is a bigger body on bigger
 *  water and should read as riding a slow swell, not bobbing like a cork. */
const BOB_AMP = 0.14;
const BOB_HZ = 0.11;
const ROCK_AMP = 0.032; // radians, ~1.8 degrees
const ROCK_HZ = 0.085;
const SWING_AMP = 0.12; // radians, ~7 degrees — swinging on its mooring with the current
const SWING_HZ = 0.045;

export class Ships {
  /** @param {object} opts @param {number} opts.seed @param {THREE.Object3D} opts.scene */
  constructor({ seed, scene }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.material = createPaintedMaterial();

    this.group = new Object3D();
    this.group.name = 'ships';
    scene.add(this.group);

    /** "gi,gj" -> null (evaluated, nothing there) | { mesh, baseY, yaw, phase } */
    this.tiles = new Map();
    this._rescanT = 0;
    this._t = 0;
    this.stats = { live: 0, evaluated: 0, triangles: 0 };
  }

  /** @param {number} dt seconds @param {number} carX @param {number} carZ */
  update(dt, carX, carZ) {
    this._t += dt;
    this._rescanT -= dt;
    if (this._rescanT <= 0) {
      this._rescanT = RESCAN_INTERVAL;
      this._rescan(carX, carZ);
    }

    let live = 0;
    for (const rec of this.tiles.values()) {
      if (!rec) continue;
      live++;
      const t = this._t;
      rec.mesh.position.y = rec.baseY + Math.sin(t * BOB_HZ * TAU + rec.phase) * BOB_AMP;
      rec.mesh.rotation.set(
        Math.sin(t * ROCK_HZ * TAU * 0.71 + rec.phase * 1.3) * ROCK_AMP * 0.6,
        rec.yaw + Math.sin(t * SWING_HZ * TAU + rec.phase * 0.6) * SWING_AMP,
        Math.sin(t * ROCK_HZ * TAU + rec.phase) * ROCK_AMP,
      );
    }
    this.stats.live = live;
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
        const spec = evaluateShipSite(gi, gj, this.seed);
        if (!spec) {
          this.tiles.set(key, null);
          continue;
        }
        const M = PB();
        buildBoat(M, spec);
        const geom = finishPainted(M);
        const mesh = new Mesh(geom, this.material);
        mesh.position.set(spec.x, spec.y, spec.z);
        mesh.rotation.y = spec.yaw;
        mesh.frustumCulled = true;
        this.group.add(mesh);
        this.stats.triangles += M.idx.length / 3;
        this.tiles.set(key, { mesh, baseY: spec.y, yaw: spec.yaw, phase: spec.phase });
      }
    }
    for (const [key, rec] of this.tiles) {
      if (want.has(key)) continue;
      const [gi, gj] = key.split(',').map(Number);
      const cx = (gi + 0.5) * TILE;
      const cz = (gj + 0.5) * TILE;
      if (Math.abs(cx - carX) < RANGE + UNLOAD_MARGIN && Math.abs(cz - carZ) < RANGE + UNLOAD_MARGIN) continue;
      if (rec) {
        this.group.remove(rec.mesh);
        this.stats.triangles -= rec.mesh.geometry.index.count / 3;
        rec.mesh.geometry.dispose();
      }
      this.tiles.delete(key);
    }
  }

  dispose() {
    for (const rec of this.tiles.values()) {
      if (!rec) continue;
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.scene.remove(this.group);
    this.material.dispose();
    this.stats.live = 0;
    this.stats.triangles = 0;
  }
}
