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

/** One boat, built into the shared builder `M` at its own world position.
 *
 * `spec.L`/`spec.hullCol`, if present, PIN the length and hull colour instead of deriving
 * them from `scaleT`/`hue` — the one thing buildPlayerBoat() (below) needs that an anchored
 * ship never does: a fixed, car-scale hull in the fleet's own paintC, not a random one from
 * the lattice's own rng. Every anchored ship (evaluateShipSite's own specs, above) never sets
 * either field, so this is a pure addition — `git diff` on the anchored path is empty. */
function buildBoat(M, spec) {
  const { x, y, z, yaw, scaleT, hue, trimT, hasCabin, hasMast } = spec;
  const L = spec.L != null ? spec.L : lerp(6.5, 11, scaleT);
  const B = L * 0.33;
  const H = L * 0.17;
  const hullCol = spec.hullCol || HULL_PALETTE[Math.min(HULL_PALETTE.length - 1, (hue * HULL_PALETTE.length) | 0)];
  const cabinCol = mixc(LC('wallA'), LC('wallB'), trimT);

  const { P, gun } = addHull(M, x, y, z, yaw, L, B, H, hullCol, DECK_COL);

  if (hasCabin) {
    const c = P(0, gun + H * 0.34, -L * 0.08);
    pbox(M, c[0], c[1], c[2], B * 0.30, H * 0.36, L * 0.15, yaw, cabinCol, MAT.MATTE);
  }
  if (hasMast) {
    // `spec.mastH`/`spec.mastZ`, if present, PIN the mast the same way `spec.L`/`spec.hullCol`
    // pin the hull above, rather than deriving it from `L`/the stern offset below. Nothing sets
    // either any more (buildPlayerBoat() dropped its own mast entirely — see that function's
    // own comment: a masthead sits on the local X=0 centreline no matter where along Z it is
    // pinned, and the chase camera sits dead astern of exactly that centreline, so no Z-only
    // pin could ever have fixed the mast splitting its view). Left in place as generic pinning
    // capability, unused today, rather than stripped: every anchored ship (evaluateShipSite's
    // own specs) never sets either field, so this is a pure addition on that path either way —
    // the fleet's own L*0.6 mast a metre and a half above deck, near the stern, is untouched.
    const mastH = spec.mastH != null ? spec.mastH : L * 0.6;
    const mastZ = spec.mastZ != null ? spec.mastZ : -L * 0.05;
    const base = P(0, gun, mastZ);
    const top = P(0, gun + mastH, mastZ);
    pcyl(M, base, top, L * 0.013, L * 0.007, 5, MAST_COL, MAT.MATTE, true, false);
    // a small pennant near the masthead, big enough to read as motion when it slowly swings —
    // same fractions of the mast's own height as before (0.56/0.6, 0.50/0.6, 0.47/0.6), so a
    // shorter pinned mast keeps the same proportioned flag rather than a fixed offset sliding
    // off a shorter pole.
    const pA = P(0, gun + mastH * 0.933, mastZ);
    const pB = P(L * 0.11, gun + mastH * 0.833, mastZ);
    const pC = P(0, gun + mastH * 0.783, mastZ);
    ptri(M, pA, pB, pC, hullCol, MAT.MATTE);
  }
}

/** Car-scale length for the player's own boat — small enough to thread a river mouth, still
 *  read as a boat next to the (6.5-11 m) anchored fleet. See docs/BOAT-PLAN.md workstream C. */
export const PLAYER_BOAT_LENGTH = 5.2;
/** A fixed, pleasant cabin trim. The anchored fleet's `trimT` is an rng draw per ship because
 *  there are dozens of them; there is exactly one player boat, so a single chosen constant
 *  (not 0, not 1 — the midpoint blend of wallA/wallB) is honester than dressing up one number
 *  as if it were still a draw. */
const PLAYER_TRIM_T = 0.5;
/** Player flagstaff height, metres — REPLACES the player boat's own pinned mast (removed; see
 *  addFlagstaff()'s own comment for why moving a mast along the boat's LENGTH could never have
 *  fixed the chase camera splitting on it: a mast anywhere on the local X=0 centreline still
 *  sits dead ahead of a camera that itself sits dead astern on that same centreline — measured,
 *  NDC x = 0.000 regardless of how far up/down the hull it was pinned. Only a LATERAL offset
 *  moves it off screen centre, hence a corner flagstaff rather than a shorter/repositioned
 *  mast). Short: a flagstaff, not a mast — "a cozy little motor-launch with a flag". */
const PLAYER_FLAGSTAFF_H = 0.9;

/**
 * Player-only: a short flagstaff at the PORT STERN CORNER of the transom, with a small
 * triangular pennant — see PLAYER_FLAGSTAFF_H's own comment for why a lateral (X) offset, not
 * a fore-aft (Z) one, is what actually clears the chase camera. Same low-poly cylinder +
 * triangle shapes buildBoat()'s own `hasMast` block draws for the fleet, just placed off to one
 * side instead of on the centreline. `buildBoat()` is not reused directly here (it has no hook
 * for an off-centreline extra) — small enough, and specific enough to the one player boat, that
 * a dedicated function reads clearer than threading a new option through the fleet's own path.
 *
 * `cx`/`cy`/`cz`/`ca`/`sa` are threaded through like addHull()'s own `P()` even though
 * buildPlayerBoat() below only ever calls this at the local origin with no rotation — the same
 * "no silent trap for a future non-origin caller" reasoning addHull() already follows.
 */
function addFlagstaff(M, cx, cy, cz, ca, sa, L, B, H, col) {
  const P = (lx, ly, lz) => {
    const [x, z] = rotY(lx, lz, ca, sa);
    return [cx + x, cy + ly, cz + z];
  };
  const gun = H * 0.58; // addHull()'s own gunwale height (H*0.58), duplicated — buildBoat()
  // keeps that figure private to its own closure, and this is the only other place in the file
  // that needs deck height for a boat it did not itself build.
  // PORT (local -X, matching addHull()'s own port/starboard labelling) STERN (local -Z, the
  // transom end) corner, inset a little off the exact edge so the staff reads as standing ON
  // the boat rather than skewered through its own silhouette.
  const fx = -B * 0.5 * 0.82;
  const fz = -L * 0.5 * 0.82;
  const base = P(fx, gun, fz);
  const top = P(fx, gun + PLAYER_FLAGSTAFF_H, fz);
  pcyl(M, base, top, L * 0.01, L * 0.005, 5, MAST_COL, MAT.MATTE, true, false);
  // Pennant near the top, flying outboard (further to port, away from the hull) — same
  // top-of-pole fractions buildBoat()'s own fleet pennant uses (0.933/0.833/0.783 of the
  // pole's own height), so a much shorter staff still reads as a proportioned little flag
  // rather than a fixed offset sliding off the end of it.
  const pA = P(fx, gun + PLAYER_FLAGSTAFF_H * 0.933, fz);
  const pB = P(fx - L * 0.09, gun + PLAYER_FLAGSTAFF_H * 0.833, fz);
  const pC = P(fx, gun + PLAYER_FLAGSTAFF_H * 0.783, fz);
  ptri(M, pA, pB, pC, col, MAT.MATTE);
}

/**
 * The player's own boat — built once (main.js constructs it lazily, the first time
 * `wallet.boatUnlocked` goes true) and repositioned every frame like the car model is,
 * never rebuilt. Same low-poly hull `buildBoat()` above draws for the anchored fleet, pinned
 * to car-scale (`PLAYER_BOAT_LENGTH`) with the cabin always present — the anchored fleet only
 * has it SOMETIMES (hasCabin is an rng draw over dozens of hulls); the one boat the player
 * actually drives should always read as a complete little boat, not the stripped-down
 * rowing-skiff end of that draw. Hull colour is `paintC`, the fleet's own trim colour
 * (car/model.js's PAINTS), so the boat reads as "your car's own boat" rather than a piece of
 * anchored scenery.
 *
 * NO MAST (fix round 2): `hasMast` is off here, and an addFlagstaff() call below adds a short
 * flagstaff at the port stern corner instead — see PLAYER_FLAGSTAFF_H's and addFlagstaff()'s
 * own comments for why a masthead on the hull's own centreline can never clear the chase
 * camera, which sits on that same centreline, no matter how it is pinned along the length.
 *
 * Built at the local origin with yaw 0, exactly like car/model.js's buildCar() — main.js
 * positions and rotates the returned Mesh's own `.position`/`.rotation` every frame instead
 * of baking a world transform in here.
 *
 * @param {THREE.Material} [material] shared painted-solid material — pass the live `Ships`
 *        instance's own `.material` so the player's boat and the anchored fleet render off
 *        ONE compiled program rather than a second one for a single extra mesh; falls back to
 *        a fresh `createPaintedMaterial()` for a caller (a future standalone tool, a bench)
 *        with no `Ships` instance to hand.
 * @returns {THREE.Mesh}
 */
export function buildPlayerBoat(material = createPaintedMaterial()) {
  const M = PB();
  buildBoat(M, {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    L: PLAYER_BOAT_LENGTH,
    hullCol: LC('paintC'),
    trimT: PLAYER_TRIM_T,
    hasCabin: true,
    hasMast: false,
  });
  addFlagstaff(M, 0, 0, 0, 1, 0, PLAYER_BOAT_LENGTH, PLAYER_BOAT_LENGTH * 0.33, PLAYER_BOAT_LENGTH * 0.17, LC('paintC'));
  const geom = finishPainted(M);
  const mesh = new Mesh(geom, material);
  mesh.name = 'playerBoat';
  return mesh;
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
