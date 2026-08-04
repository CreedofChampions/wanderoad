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
import { C, BIOME_TINT, biomeGroundArrays, GROUND_SHARPEN } from '../core/palette.js';
import { U, sharedUniforms } from './uniforms.js';
import { GL_WIND, windUniforms } from './wind.js';
import { Terrain } from '../world/terrain.js';
import { BIOME, BIOME_COUNT, BIOME_SCATTER, waterLevelAt } from '../world/biomes.js';
import { canopyShade } from '../world/scatter.js';
import { stationsInBox, STATION_RADIUS, showroomsInBox, SHOWROOM_HALF_W, SHOWROOM_HALF_D } from '../world/props.js';
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
/* The snow ramp, shared with the shader. render/terrainMaterial.js does
 * `smoothstep(120.0, 240.0, vWorld.y)`; these are the same two numbers, written here rather than
 * hard-coded a second time because the one thing that must never happen is the grass and the snow
 * disagreeing about where the snow line is — that disagreement is exactly the "blue ground" the
 * operator photographed in Highlands. */
const SNOW_START_Y = 120;
const SNOW_FULL_Y = 240;

/* ── HOW FAR THE GRASS GOES, AND WHO PAYS FOR IT ──────────────────────────
 *
 * Operator: "the original grass is visible from much farther -- put that on by default and have a
 * slider for settings to reduce lag for lesser pcs".
 *
 * He is right that it was cut, and the header above says so in the repo's own words: K was reduced
 * from the pen's ~20 400 to 4 400 and the far ring stopped at 560 m against the pen's 1250 m. That
 * was a frame-budget decision made for everyone, and it made the default look thinner than the thing
 * it was modelled on.
 *
 * The fix is not to pick a different single number — that just moves whose machine is unhappy. It is
 * to make it a SETTING, default it to the generous end, and let anyone on a slower machine turn it
 * down. `quality` scales two things together, because they are the two halves of the same cost:
 * how many blades per square metre, and how far the field reaches.
 *
 * Persisted, because a player who turns it down should not have to do it again every load. Read once
 * at module scope: the rings are built from these numbers at construction, so changing it mid-session
 * reloads the page (the Garage's own Land buttons already work that way, for the same reason).
 */
export const GRASS_QUALITY_KEY = 'wanderoad.grass.v1';

/** The named steps behind the slider. `k` scales density, `reach` scales the far ring's distance. */
export const GRASS_STEPS = [
  { id: 'low', label: 'Low', k: 0.55, reach: 0.55 },
  { id: 'medium', label: 'Medium', k: 0.8, reach: 0.75 },
  { id: 'high', label: 'High', k: 1.0, reach: 1.0 },
  { id: 'far', label: 'Far', k: 1.0, reach: 1.4 },
  { id: 'ultra', label: 'Ultra — the original reach', k: 1.35, reach: 2.2 },
];

/* THE DEFAULT IS MEASURED, NOT CHOSEN. The operator asked for the far look by default, and `ultra`
 * is that look — the pen's own 1250 m. Shipped as the default it measured 7.7 fps on the browser
 * suite's own "running at a playable rate once warm" check, because the outer ring's cost goes with
 * the SQUARE of its reach (2.2x reach is 4.8x the area) and it is the ring with the most chunks.
 *
 * `far` (1.4x reach) is no better as a default, and the numbers say exactly why: the browser suite
 * reports 3.6 fps on "running at a playable rate once warm" but 50.3 fps on "still running at a
 * playable rate after driving". That is not a frame-rate problem, it is a COLD-START STALL — every
 * ring is built up front in the constructor, and the outer one now has far more chunks to build
 * before the first frame. Once it is built the game runs fine.
 *
 * So the default is the step that loads cleanly, and `far` and `ultra` are one click away in the
 * Garage for anyone who wants the reach. The real fix is to build the outer ring LAZILY over the
 * first few seconds instead of before the first frame, at which point the default can move out;
 * that is a bigger change than this one and is logged rather than rushed. Shipping a default that
 * opens at 3.6 fps is not giving someone the original's look, it is taking the game away from them
 * in the first ten seconds. */
/** Rings from this index up are built lazily, after the first frames — see the constructor. */
const LAZY_FROM = 3;

export const GRASS_DEFAULT = 'far';

export function grassQuality() {
  let id = GRASS_DEFAULT;
  try {
    const url = new URLSearchParams(globalThis.location?.search ?? '').get('grass');
    id = url || globalThis.localStorage?.getItem(GRASS_QUALITY_KEY) || GRASS_DEFAULT;
  } catch {
    /* no storage or no location — the default is a perfectly good answer */
  }
  return GRASS_STEPS.find((q) => q.id === id) || GRASS_STEPS[GRASS_STEPS.length - 1];
}

export function setGrassQuality(id) {
  try {
    globalThis.localStorage?.setItem(GRASS_QUALITY_KEY, id);
  } catch {
    /* nothing to persist to; the change still applies to this session */
  }
}

const Q = grassQuality();

/* 4400 was the shipped cut. The quality step multiplies it, so 'high' is exactly what shipped
 * before this and 'far' is the generous default the operator asked for. */
const K_DENSITY = 4400 * Q.k;
const DENS_POW = 1.5;

/* Four overlapping rings. `cs` metres per chunk, `near`/`far` the distance band (with soft
 * overlaps), `dn` the distance at which this ring's density is 100%, `grid` the chunk grid
 * (odd, wide enough that the ring physically reaches its own `far` — a hand-picked grid is
 * how you get an un-grassed annulus between two rings), `lat` the terrain lattice
 * subdivisions per chunk, `segs` Bézier segments per blade -> (2n+1) vertices, `wpx` the
 * angular width floor in pixels, `hs` a height scale that lets the far rings trade blade
 * count for stroke width one-for-one. */
const RINGS = (() => {
  /* Only the OUTERMOST ring stretches with `reach`. The near rings are what you actually drive
   * through and their spacing is tuned to the car, not to the horizon; stretching them would thin
   * the sward at the bumper, which is the one place it must never thin. Its chunk size grows with
   * it so the instance count per chunk stays sane — a ring that reaches twice as far with the same
   * 160 m chunks would need four times as many of them. */
  const reach = Q.reach;
  return [
    { cs: 12, near: 0, far: 26, dn: 7, grid: 7, lat: 8, segs: 3, wpx: 1.7, hs: 1.0, prepass: true },
    { cs: 28, near: 22, far: 88, dn: 22, grid: 9, lat: 10, segs: 2, wpx: 2.0, hs: 1.08, prepass: true },
    { cs: 80, near: 80, far: 300, dn: 80, grid: 9, lat: 14, segs: 1, wpx: 3.8, hs: 1.36, prepass: false },
    {
      cs: Math.round(160 * Math.max(1, reach)),
      near: 270,
      far: Math.round(560 * reach),
      dn: 270,
      grid: 9,
      lat: 14,
      segs: 1,
      wpx: 6.0,
      hs: 1.95,
      prepass: false,
    },
  ];
})();

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

/* Operator report (round 2 — round 1's flat 0.4 m margin below did NOT fix this, re-measured
 * rather than assumed): "grass still tips in on the edge of the road — keep grass at a distance
 * from the road, 1 foot." The lattice below already zeroes blade DENSITY on the carriageway
 * via `T.roads.carve(x,z).edge` (W2 passes 118/118 on the centreline), but that mask is
 * roads.js's own shoulder fade — full suppression only up to `half-0.4`, faded out entirely by
 * `half+0.35`, a ~0.75 m band straddling the physical tarmac edge (see `carve()`'s `edgeHere`
 * in world/roads.js). Round 1 pushed that whole window out by a flat `ROAD_GRASS_MARGIN`, but
 * that only ever tests the blade's ROOT — GRASS_VS's own Bezier solve (`iv2`, then the gravity
 * droop `gF` and the wind term `wf`, then the length-preserving rescale `rr = hgt/L`) swings the
 * TIP up to `hgt` sideways of the root, and `hgt` scales with each ring's own `uLodB.y` (`R.hs`
 * here — 1.0 near, 1.95 far). A base standing just past a flat margin can carry a tip that
 * swings straight back onto the tarmac; a byte-for-byte CPU port of that vertex shader
 * (`tools/diag-grasslean.mjs` — hashes, `vn2`, the Bezier solve, both state corrections, run
 * against the real `Terrain`/`carve()`) measured it directly at the shipped 0.4 m: **2253 of
 * 100354 surviving blade tips (2.25%) landed ON the tarmac**, worst offender 0.392 m deep, at
 * the near ring alone — 3170 of 61449 (5.2%), worst 0.836 m, at the far ring's taller grass.
 *
 * Fixed by making the margin a function of the ring's own height scale rather than one flat
 * number — swept `tools/diag-grasslean.mjs --formula` against all four shipped rings (hs = 1.0,
 * 1.08, 1.36, 1.95), three seeds, three terrain presets and the wind field's own upper gust-
 * meander bound (1.45x base speed): `ROAD_GRASS_MARGIN_A + ROAD_GRASS_MARGIN_B * R.hs` first
 * reaches 0 tip-on-tarmac occurrences, with a real margin of safety, at A=0.55/B=0.45 — near
 * ring 1.00 m, far ring 1.43 m. `_buildChunk` computes it once per chunk from `R.hs`, never
 * per blade. Widened significantly past "about a foot": that request was against the ROOT, and
 * the honest finding here is that guaranteeing the TIP never crosses costs more than a foot at
 * the tallest grass — recorded rather than split the difference and re-opening this again. */
const ROAD_GRASS_MARGIN_A = 0.55;
const ROAD_GRASS_MARGIN_B = 0.45;

/* Operator report: "there's grass in the water." The lattice never compared a blade's base
 * against the local water plane at all — a stub that silently omits `.wy` "does not fail, it
 * lies" (docs/BACKLOG.md, the stationTownInBox water-probe story), and the equivalent bug here
 * was never even asking the question. Follows world/scatter.js's own WATER_OK convention:
 * `waterLevelAt(weights, -Infinity)` asks unconditionally for the water PLANE (never null,
 * unlike passing the real ground height, which only returns non-null when already submerged),
 * then the real ground height is freeboard-tested against it here — the same two-step split
 * render/props.js's own probe uses. A hair of freeboard keeps a blade rooted exactly on the
 * shoreline from reading as half-drowned. */
const GRASS_WATER_FREEBOARD = 0.05;

/* BACKLOG: "grass grows through station forecourts... the grass system knows about roads but
 * evidently not about station aprons." Stations sit off to the side of their host road
 * entirely, so the road edge mask above never touches them. `STATION_RADIUS` is world/props.js's
 * own apron radius — not a fuzzier number invented here — matching exactly the paved circle
 * `stationForEdge` grades flat and `_bake` (render/props.js) actually builds. */
const STATION_GRASS_RADIUS = STATION_RADIUS;

/* B12: "grass grows through a showroom's floor slab" — the hall's floor is prop geometry laid
 * over terrain (render/props.js's showroom builder), and everything above knows only about
 * roads and station aprons, nothing about it. Same fix shape as STATION_GRASS_RADIUS: a
 * bounding CIRCLE around the rectangular 34x22 m footprint (SHOWROOM_HALF_W/D, world/props.js —
 * the single source of truth the floor slab itself is built from), radius = the rectangle's own
 * half-diagonal so the circle fully covers it regardless of the hall's yaw. Slightly
 * over-excludes at the four corners rather than under-excluding — the same trade STATION_GRASS_
 * RADIUS already makes. */
const HALL_GRASS_RADIUS = Math.hypot(SHOWROOM_HALF_W, SHOWROOM_HALF_D);

/* One `Terrain` serves every ring. Its box has to contain the far ring's outermost chunk
 * corner (4.5 chunks of 160 m = 800 m) plus however far the car may drive before the box is
 * rebuilt. The constructor is atomic — it builds a climate lattice and a road network in one
 * go — so its cost lands on a single frame and the box is kept as small as the far ring
 * allows: ~3.6 ms every 100 m of travel, i.e. once per 1.1 s flat out and once per 3 s at a
 * realistic cruise. */
const REGION_HALF = 930;
const REGION_DRIFT = 100;

/* Stations, cached at their OWN, much coarser cadence — never `stationsInBox` per chunk build,
 * and not even at the Terrain region's own 100 m drift. Measured (`node --eval`, warm module,
 * varied boxes): `stationsInBox` costs a median 12-20 ms and a WORST case up to 65 ms even for
 * one region-sized box — it grades every candidate edge fresh with no cache of its own, so a
 * chunk-sized call (0.5-3 ms) still would have meant paying that on every one of the dozen
 * chunk rebuilds the 2.5 ms `DEFAULT_BUDGET_MS` allows in a single frame. Stations do not move,
 * so a stale-by-a-thousand-metres cache is exactly as correct as a fresh one as long as it
 * still covers the far ring (worst reach ~730 m: 4 chunks x 160 m + a chunk's own 80 m corner +
 * the apron radius) around wherever the car now is — which is what the generous margin between
 * the two constants below buys back (HALF - DRIFT = 800 m > 730 m, always safe) for a cadence
 * about 14x coarser than the Terrain region's, i.e. once every ~53 s at a realistic cruise. */
const STATION_REGION_HALF = 2200;
const STATION_REGION_DRIFT = 1400;

/* Halls, same coarse-cadence reasoning as stations just above — showroomsInBox walks the same
 * road network (nearestRoadPoint per candidate) and is not cheap either. Reused verbatim rather
 * than re-derived. */
const HALL_REGION_HALF = STATION_REGION_HALF;
const HALL_REGION_DRIFT = STATION_REGION_DRIFT;

/* Wall-clock JS the rebuild queue may spend per frame. A ring that took 200 ms would pop
 * in visibly at 90 m/s; at this budget the queue keeps up with 90 m/s with ~20% to spare
 * (measured cost model: ~2.0 ms/frame at 90 m/s, ~1.0 ms/frame at 45 m/s). */
const DEFAULT_BUDGET_MS = 2.5;

/* Per-blade instance data, 14 bytes:
 *   iPos  u16 x2  position as a fraction of the chunk  (<2.5 mm even on the 160 m chunks)
 *   iGrd  u16     ground height, normalised over the chunk's own Y range
 *   iTint u8  x4  dryness, snow, wetness, lushness — all five biomes blended by weight
 *   iGnd  u8  x4  the ground colour this blade stands on — the SAME blended colour
 *                 render/terrainMaterial.js paints at this spot (see _buildChunk pass 1/3),
 *                 linear rgb, sqrt-encoded (GRASS_FS squares it back). `.a` rides along
 *                 unused — itemSize 4 for attribute alignment, not a fourth channel.
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

/* The SAME four-stop-per-biome ground ramp render/terrainMaterial.js paints the terrain
 * from (core/palette.js's BIOME_GROUND, via biomeGroundArrays()) — imported rather than
 * re-hardcoded, so the ramp the grass matches against can never silently drift out of step
 * with the one the ground is actually painted from. See _buildChunk pass 1 below for what
 * it feeds. */
const GROUND = biomeGroundArrays();
/* Scratch for GROUND_SHARPEN's own per-node weights, reused rather than allocated: pass 1
 * below evaluates this at every lattice node of every chunk build — up to (lat+1)² of them,
 * 225 on the coarse rings' own 14-subdivision lattice, and an allocation there is an
 * allocation a couple of hundred times over on every chunk rebuild. */
const GND_GW = new Float32Array(BIOME_COUNT);

/* How hard a blade's colour is pulled toward the CHROMATICITY of the blended ground colour it
 * stands on (GRASS_FS's `gch`, built from the `vGnd` varying — see _buildChunk pass 1/3 and
 * the `iGnd` instance attribute above). The operator's own words: "Grass color should almost
 * match the color of the ground it's around ... as far as the base color is concerned." Not
 * 1.0 — at full strength every blade's hue/chroma would simply BE the ground's, and grass
 * would lose its own colour identity (the tip-to-root hue path, the curing-to-straw dryness
 * mix, the seed heads) entirely into a mono-hued patch — it would keep its own shading only.
 *
 * MEASURED, NOT PICKED: swept 0.60/0.78/0.90 against all five ground ramps and all three
 * blade plates (lit/mid/shd), scoring each as hue error in degrees against that biome's own
 * ground. Worst plate per biome, before -> at 0.78:
 *     meadow 1->1   steppe 29->9   highland 37->22   dunes 90->10   wetland 5->5
 * (tools/diag-grasstint.mjs prints the full table.) 0.90 pulls hue error under 10° everywhere
 * but takes the grass close enough to the dirt that it stops reading as grass at all; 0.60
 * leaves steppe and dunes visibly still wrong (higher hue error, and dunes barely below its
 * pre-fix 90°). 0.78 is the point where every biome reads as grass standing on ITS OWN ground
 * rather than grass standing on nobody's — "almost match", the operator's own word, taken
 * literally: close, not fused. Saturation moves too, which a value-only fix never could:
 * highland grass goes from 0.85 saturated standing on 0.43-saturated stone to 0.56 — visibly
 * greyer without going grey. */
const GROUND_MATCH = 0.78;

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
in vec4  iGnd;                 // ground colour this blade stands on, sqrt-encoded (see below)
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
out vec3  vGnd;      // the blended ground colour here, linear rgb (decoded from iGnd)
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
  // Undo the sqrt encode (see the iGnd instance attribute's own comment in grass.js for why
  // it is sqrt rather than a plain linear u8 — the dark stops would band).
  vGnd  = iGnd.rgb * iGnd.rgb;
`
}
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`;

/* tier 0/1 = full quality (PCF shadow, painterly noise);
   tier 2   = fast 4-tap shadow, no per-pixel noise;
   tier 3   = cloud shadow only (it is beyond the shadow map anyway).          */
const GRASS_FS = (tier) => /* glsl */ `
in vec3 vW; in vec3 vN; in float vT; in float vBend;
in vec3 vTint; in vec2 vBio; in vec3 vGnd; in float vSide; in float vOccl; in float vVar;
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

  float snowB = vBio.x;

  /* BIOME_TINT's foliage multipliers used to end here — three hand-authored per-biome colour
   * multipliers (F_DRY/F_COLD/F_WET, built from BIOME_TINT[].foliage) applied along the three
   * scalar axes the instance carries. That table was a SECOND, independently-authored answer
   * to "what colour is this biome's ground", and BIOME_GROUND (core/palette.js) is already the
   * first one — the one the terrain itself is painted from. A blade standing on lichen-grey
   * highland stone tinted itself 0.72/0.86/0.86 (a COOLER GREEN) while the ground under it had
   * already committed to a desaturated grey; the two never had to agree, and they disagreed
   * hardest exactly where the operator kept looking — a biome border, or a biome extreme like
   * the highlands or the dunes. Replaced with a real match to 'vGnd' — the SAME blended ground
   * colour render/terrainMaterial.js paints at this exact spot (see _buildChunk's pass 1/3 and
   * the 'iGnd' instance attribute, both in this file) — so the grass and the ground share one
   * source of truth and can no longer disagree about which biome's palette a spot belongs to.
   *
   * FIRST ATTEMPT, MEASURED WRONG: ratio the blade's ramp against the MEADOW's own ground
   * (vGnd / a meadow reference), clamp, then divide out the luma so only hue/chroma moved. It
   * barely touched the two biomes that needed it most — hue error 29°->27° on steppe, 90°->85°
   * on dunes (tools/diag-grasstint.mjs's own before/after table) — because a ratio against a
   * strongly green, nearly-blue-free reference is dominated by the REFERENCE's own channel
   * imbalance: the raw steppe ratio came out (7.17, 2.88, 0.73), and renormalising THAT by luma
   * lands red:green back around (1.09:1.05) — no real change on the one axis, green-to-gold,
   * that actually matters. It only ever crushed blue, and a blade's blue is already near zero,
   * so nothing visible happened.
   *
   * WHAT ACTUALLY WORKS: blend CHROMATICITY at constant luma, with no reference at all. Divide
   * a colour by its own luma to get its chromaticity (colour direction, brightness removed),
   * mix that toward the ground's chromaticity, then multiply that SAME colour's own luma back
   * on. Applied separately to 'lit', 'mid' and 'shd' below — each keeps its OWN luma throughout,
   * so only the COLOUR moves: the blade keeps every bit of its own light/dark shading, its
   * tip-to-root gradient, its per-patch mosaic. */
  vec3 gch = vGnd / max(dot(vGnd, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  // How hard a blade's colour is pulled toward that ground chromaticity — see grass.js's own
  // comment on this constant for the operator's ask and the sweep that picked 0.78.
  const float GROUND_MATCH = ${GROUND_MATCH.toFixed(4)};
  float litLum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
  float midLum = dot(mid, vec3(0.2126, 0.7152, 0.0722));
  float shdLum = dot(shd, vec3(0.2126, 0.7152, 0.0722));
  lit = mix(lit / max(litLum, 1e-4), gch, GROUND_MATCH) * litLum;
  mid = mix(mid / max(midLum, 1e-4), gch, GROUND_MATCH) * midLum;
  shd = mix(shd / max(shdLum, 1e-4), gch, GROUND_MATCH) * shdLum;

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
  /* AMBIENT EASES OFF WITH DISTANCE, and this is the grass half of B24 ("the land is a dark
   * blue/green ... more blue than green for human eye").
   *
   * Two lines above, the blade's normal is bent towards straight UP as it recedes — deliberately,
   * because a fanned normal is sub-pixel detail at range and sparkles. But a blade facing straight
   * up faces the SKY, and with s.ambient at a flat 1.0 it then collects the maximum possible
   * dose of sky-coloured ambient. That is why far grass reads blue while the ground beneath it does
   * not: the two are lit by different amounts of sky, and the further the grass is, the more of it
   * it takes.
   *
   * Measured at a fixed spot on an identical 58330-pixel region, after the ground's own blue cast
   * was fixed in post.js: bare ground reads b-r +0.8, and the same view with far grass reads +8.1 —
   * so the grass alone was adding +7.3.
   *
   * Eased rather than cut: ambient is what stops distant grass going flat and dead, so it keeps
   * three quarters of it at range. */
  s.rim = 0.34*(0.25 + 0.75*nearK); s.ao = vAO; s.ambient = mix(0.74, 1.0, nearK);
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
  //
  // Converges toward vGnd — THIS spot's own blended ground colour — rather than the old
  // hard-coded meadow tMid. The constant made every biome's distant grass fade toward meadow
  // green regardless of what was actually underneath it, which is the single most visible half
  // of the mismatch the operator reported: a grey highland hillside wearing a green haze at
  // range, because the one thing that DOES resolve at 300 m — the field's mean colour — was
  // wrong for every biome except the one it was authored on.
  col = mix(col, mix(col, vGnd, 0.62), smoothstep(90.0, 430.0, vDist)*0.42);

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
    // resample the ground. ~7.4 kB on the coarse rings, and it is the single biggest saving
    // in the whole rebuild path: half of all rebuilds are densenings. 6th channel per node is
    // the raw "is this node submerged" flag, 7th is the node's own clearance from the nearest
    // tarmac edge, 8th-10th are the blended ground colour (linear rgb) GRASS_FS matches its
    // blade colour to — see pass 3's own comments on why the first two ride separately from
    // the already-suppressed density channel, and _buildChunk pass 1 for the colour blend.
    this.lat = new Float32Array((ring.R.lat + 1) * (ring.R.lat + 1) * 10);

    this.iPos = new Uint16Array(cap * 2);
    this.iGrd = new Uint16Array(cap);
    this.iTint = new Uint8Array(cap * 4);
    this.iGnd = new Uint8Array(cap * 4);

    const g = new InstancedBufferGeometry();
    g.setAttribute('position', ring.blade.position); // shared with every chunk of the ring
    g.setIndex(ring.blade.index);
    this.aPos = new InstancedBufferAttribute(this.iPos, 2, true);
    this.aGrd = new InstancedBufferAttribute(this.iGrd, 1, true);
    this.aTint = new InstancedBufferAttribute(this.iTint, 4, true);
    this.aGnd = new InstancedBufferAttribute(this.iGnd, 4, true);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iGrd', this.aGrd);
    g.setAttribute('iTint', this.aTint);
    g.setAttribute('iGnd', this.aGnd);
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
    /** Stations within reach of the current position, refreshed on their own coarse cadence —
     *  see `_ensureRegion`'s comment and STATION_REGION_HALF/DRIFT for why. */
    this._stations = [];
    this._stationRegionX = Infinity;
    this._stationRegionZ = Infinity;
    /** Walk-in showroom halls within reach, same cadence reasoning as `_stations` — see B12's
     *  note by HALL_GRASS_RADIUS. */
    this._halls = [];
    this._hallRegionX = Infinity;
    this._hallRegionZ = Infinity;

    this.stats = { chunks: 0, dirty: 0, drawn: 0, built: 0, extended: 0, buildMs: 0, bytes: 0 };
    /* THE OUTER RING IS BUILT LAZILY, and this is what F19 was waiting on.
     *
     * Operator: "the original grass is visible from much farther -- put that on by default and have
     * a slider for settings to reduce lag for lesser pcs". The slider shipped; the DEFAULT did not,
     * and the note above GRASS_DEFAULT records exactly why — every ring was built here, in the
     * constructor, before the first frame, so choosing `far` opened the game at 3.6 fps. That note
     * also names the fix: "build the outer ring LAZILY over the first few seconds instead of before
     * the first frame, at which point the default can move out".
     *
     * So the near rings — the ones you are actually driving through — are built now, and any ring
     * beyond LAZY_FROM is queued and built one per update once the game is running. The queue is
     * drained by `update`, which already runs a wall-clock budget for rebuilds, so a deferred ring
     * arrives as a few busy frames a second or two in rather than as a frozen opening.
     *
     * Nothing about the FIELD changes: the same rings, the same densities, the same chunk grids.
     * Only when the far one is assembled moves. */
    this._rings = [];
    this._pendingRings = [];
    for (let i = 0; i < RINGS.length; i++) {
      if (i < LAZY_FROM) this._rings.push(this._buildRing(RINGS[i], i));
      else this._pendingRings.push(i);
    }
  }

  /** Build at most one queued ring. Called from `update`, so it costs a frame, not the opening. */
  _drainPendingRings() {
    if (!this._pendingRings.length) return;
    const i = this._pendingRings.shift();
    const ring = this._buildRing(RINGS[i], i);
    /* Rings are addressed by index elsewhere (setAngular walks `this._rings` and writes each one's
     * uLodB), so a lazily-built ring has to land at ITS OWN index, not on the end. */
    this._rings[i] = ring;
    if (this.angPerPx) this.setAngular(this.angPerPx);
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
      fragmentShader: fragHead(GL_HASH, GL_NOISE, cloud, GL_SHADOW, GL_LIGHT, GRASS_FS(index)),
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
    this._drainPendingRings();
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
    if (!(this._terrain && Math.abs(camX - this._regionX) < REGION_DRIFT && Math.abs(camZ - this._regionZ) < REGION_DRIFT)) {
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
    this._ensureStations(camX, camZ);
    this._ensureHalls(camX, camZ);
  }

  /**
   * Stations, fetched on their OWN much coarser cadence than the Terrain region above — never
   * per chunk build, and not even at the region's 100 m drift. Every grass chunk build (there
   * can be a dozen in one 2.5 ms rebuild budget) just filters this small, already-fetched
   * array by plain distance, which costs nothing measurable; the expensive part happens here,
   * rarely. See STATION_REGION_HALF/DRIFT's own comment for the measured cost that forced the
   * coarser cadence.
   */
  _ensureStations(camX, camZ) {
    if (this._stationRegionX !== Infinity && Math.abs(camX - this._stationRegionX) < STATION_REGION_DRIFT && Math.abs(camZ - this._stationRegionZ) < STATION_REGION_DRIFT) {
      return;
    }
    this._stations = stationsInBox(
      camX - STATION_REGION_HALF - STATION_GRASS_RADIUS,
      camZ - STATION_REGION_HALF - STATION_GRASS_RADIUS,
      camX + STATION_REGION_HALF + STATION_GRASS_RADIUS,
      camZ + STATION_REGION_HALF + STATION_GRASS_RADIUS,
      this.seed
    );
    this._stationRegionX = camX;
    this._stationRegionZ = camZ;
  }

  /** Halls, fetched on their own coarse cadence — see HALL_REGION_HALF/DRIFT's comment. */
  _ensureHalls(camX, camZ) {
    if (this._hallRegionX !== Infinity && Math.abs(camX - this._hallRegionX) < HALL_REGION_DRIFT && Math.abs(camZ - this._hallRegionZ) < HALL_REGION_DRIFT) {
      return;
    }
    this._halls = showroomsInBox(
      camX - HALL_REGION_HALF - HALL_GRASS_RADIUS,
      camZ - HALL_REGION_HALF - HALL_GRASS_RADIUS,
      camX + HALL_REGION_HALF + HALL_GRASS_RADIUS,
      camZ + HALL_REGION_HALF + HALL_GRASS_RADIUS,
      this.seed
    );
    this._hallRegionX = camX;
    this._hallRegionZ = camZ;
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
    c.iGnd.set(old.iGnd.subarray(0, old.count * 4));
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
    c.aGnd.needsUpdate = true;
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
    this.stats.bytes += need * 14;
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
      this.stats.bytes -= c.cap * 14;
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
    // Needed by pass 3's exact water re-check on EVERY call, not just a lattice (re)build.
    const T = this._terrain;

    /* Station forecourts this chunk could overlap. Filtered from `this._stations` — fetched
     * ONCE per REGION rebuild, not here — down to the handful, if any, within reach of this
     * one chunk. `stationsInBox` itself was measured at 0.5-3 ms even for one small
     * chunk-sized box (it grades every candidate edge fresh, no cache of its own); calling it
     * per chunk would blow the WHOLE 2.5 ms rebuild budget on a single chunk. See
     * `_ensureRegion`'s comment for where the real fetch now lives.
     *
     * Computed OUTSIDE the `chunk.built === 0` gate below (cheap — filtering a handful of
     * already-fetched entries) because pass 3 needs it on EVERY call, including a pure
     * densening where the lattice itself is not rebuilt. */
    const regionStations = this._stations;
    const stations = [];
    for (let si = 0; si < regionStations.length; si++) {
      const s = regionStations[si];
      if (
        s.x >= x0 - STATION_GRASS_RADIUS &&
        s.x <= x0 + cs + STATION_GRASS_RADIUS &&
        s.z >= z0 - STATION_GRASS_RADIUS &&
        s.z <= z0 + cs + STATION_GRASS_RADIUS
      ) {
        stations.push(s);
      }
    }

    // B12: showroom halls this chunk could overlap, filtered from `this._halls` down to the
    // handful in reach — same shape as the `stations` filter just above.
    const regionHalls = this._halls;
    const halls = [];
    for (let hi = 0; hi < regionHalls.length; hi++) {
      const h = regionHalls[hi];
      if (
        h.x >= x0 - HALL_GRASS_RADIUS &&
        h.x <= x0 + cs + HALL_GRASS_RADIUS &&
        h.z >= z0 - HALL_GRASS_RADIUS &&
        h.z <= z0 + cs + HALL_GRASS_RADIUS
      ) {
        halls.push(h);
      }
    }

    // Needed by pass 3 on EVERY call (not just a lattice rebuild): the lattice cell's own
    // diagonal, i.e. the largest gap a road narrower than the lattice could hide inside
    // without touching any of the four corners it interpolates between.
    const step = cs / L;
    const cellDiag = step * Math.SQRT2;

    if (chunk.built === 0) {
      // Taller grass leans further (hgt scales with R.hs — see GRASS_VS's `hgt *= uLodB.y`),
      // so its tip needs more clearance from the tarmac than a short blade's does. Computed
      // once per chunk build, not per node: see ROAD_GRASS_MARGIN_A/B's comment for the sweep.
      const roadGrassMargin = ROAD_GRASS_MARGIN_A + ROAD_GRASS_MARGIN_B * R.hs;

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
          let sand = 0; // dunes weight — see the suppression note in the loop below
          for (let b = 0; b < BIOME_COUNT; b++) {
            const wb = w[b];
            if (wb < 0.002) continue;
            g += wb * SCAT_GRASS[b];
            // Dunes' own grass is 0, but this is a WEIGHTED BLEND: at 70% dunes / 30% meadow
            // the meadow share still grows a third of a lawn, which is why the operator still
            // sees "grass on dunes" after that table was zeroed. Sand has to SUPPRESS, not
            // merely abstain -- tracked here and applied to the total below.
            if (b === BIOME.DUNES) sand += wb;
            dry += wb * TINT_DRY[b];
            snow += wb * TINT_SNOW[b];
            wet += wb * TINT_WET[b];
          }

          /* ── ground colour: the SAME blended colour terrainMaterial.js paints here ──────
           * Sharpened exactly as render/terrainMaterial.js's TERRAIN_FS does (GROUND_SHARPEN,
           * core/palette.js) — the grass and the ground pull toward the SAME dominant biome's
           * ramp, so a blade standing on lichen-grey highland stone can never choose green
           * while the ground beneath it has already committed to grey. Deliberately over ALL
           * five biomes, unthresholded (unlike the `wb < 0.002` skip just above) — the terrain
           * shader's own gw[]/gsum loop (TERRAIN_FS) never skips a biome either, and matching
           * it term-for-term is the whole point: the two must never be free to disagree.
           *
           * MEAN BLOT rather than the shader's real per-pixel fbm (`blot`): this runs once per
           * LATTICE NODE — up to (lat+1)² of them, 225 on the coarse rings' own 14-subdivision
           * lattice — rather than once per screen pixel, and a blade root does not need to
           * resolve paint-grain fine enough that its own mean would read any differently. See
           * GRASS_FS's `vGnd`/`gch` comment for the rest of this reasoning. */
          let gsum = 0;
          for (let b = 0; b < BIOME_COUNT; b++) {
            GND_GW[b] = Math.pow(Math.max(w[b], 0), GROUND_SHARPEN);
            gsum += GND_GW[b];
          }
          gsum = Math.max(gsum, 1e-6);
          let gr = 0,
            gg = 0,
            gb = 0;
          for (let b = 0; b < BIOME_COUNT; b++) {
            const f = GND_GW[b] / gsum;
            const m = b * 3;
            // mix(B_MID[i], B_SHADE[i], blot*0.40) at blot's own mean (0.5) -> mix(...,0.20) —
            // render/terrainMaterial.js's TERRAIN_FS mid plate, verbatim, at the mean rather
            // than the sample.
            gr += f * (GROUND.mid[m] + (GROUND.shade[m] - GROUND.mid[m]) * 0.2);
            gg += f * (GROUND.mid[m + 1] + (GROUND.shade[m + 1] - GROUND.mid[m + 1]) * 0.2);
            gb += f * (GROUND.mid[m + 2] + (GROUND.shade[m + 2] - GROUND.mid[m + 2]) * 0.2);
          }

          // The carriageway is bald. 'edge' is the tarmac mask, so the verge — where the
          // carve mask is high but the edge mask is falling — keeps its grass, which is
          // what makes a road read as cut into the land rather than mown around.
          /* SAND SUPPRESSES GRASS, it does not merely abstain. Zeroing the dunes row in
           * BIOME_SCATTER was necessary and not sufficient: the loop above is a weighted
           * blend, so a point that is 70% dunes and 30% meadow still grew 30% of a meadow's
           * lawn, and the operator kept seeing "grass on dunes" after that table read 0.
           * THRESHOLDED TO THE REAL WEIGHT RANGE, not squared. Biome weights in this world
           * never approach 1: measured over a 6 km disc on the shipped seed, the duniest point
           * anywhere is 0.696, so squaring left HALF a lawn (0.516) standing on the deepest
           * sand in the map. The same trap GROUND_SHARPEN documents for colour — a blend whose
           * dominant weight peaks near 0.5 needs a threshold, not a curve. Grass thins from a
           * quarter dunes and is gone by 0.55, which is a real sand sea. */
          g *= 1 - smoothstep(0.25, 0.55, sand);

          /* AND SNOW SUPPRESSES IT TOO, for exactly the same reason sand does.
           *
           * Operator, with a screenshot from Highlands at (7220, 9929): "ground is blue here". The
           * ground is not blue — it is SNOW. render/terrainMaterial.js blends a snow plate in above
           * 120 m (smoothstep(120, 240, world.y), held off steep faces), and HIGHLAND has amp 205 on
           * base 14, so most of a highland sits inside that ramp. The snow itself is right; what made
           * it read as "blue ground" is that a full green lawn was still growing on top of it, and a
           * white-blue surface under green blades looks like coloured dirt rather than snow.
           *
           * The SAME numbers as the shader, deliberately — if these two ever disagree you get grass
           * standing in snow again, which is the bug. Slope is not available at this point in the
           * pass (it is computed in pass 2 below), so this uses the elevation term only: that is the
           * conservative half, since a steep face holds less snow and would want LESS suppression,
           * never more. */
          g *= 1 - smoothstep(SNOW_START_Y, SNOW_FULL_Y, y);

          const rc = T.roads.carve(x, z);
          let edge = rc.edge;
          // Widen the carriageway suppression past roads.js's own shoulder fade reach, far
          // enough that the TIP a leaning blade can reach never lands on tarmac either — see
          // ROAD_GRASS_MARGIN_A/B's comment. `rc.width` only reads back a real blended
          // half-width while SOME edge still has weight here (roads.js's carve(), same file);
          // off in open country it is 0 and this term drops out on its own.
          if (rc.width > 0) {
            const half = rc.width * 0.5;
            const marginEdge = 1 - smoothstep(half - 0.4 + roadGrassMargin, half + 0.35 + roadGrassMargin, rc.d);
            if (marginEdge > edge) edge = marginEdge;
          }
          // No grass with its base under water — see GRASS_WATER_FREEBOARD's comment.
          const waterY = waterLevelAt(w, -Infinity);
          const submerged = waterY !== null && y < waterY + GRASS_WATER_FREEBOARD;
          // No grass inside a station's paved apron — see STATION_GRASS_RADIUS's comment.
          let inApron = false;
          for (let si = 0; si < stations.length; si++) {
            const s = stations[si];
            const sdx = x - s.x;
            const sdz = z - s.z;
            if (sdx * sdx + sdz * sdz < STATION_GRASS_RADIUS * STATION_GRASS_RADIUS) {
              inApron = true;
              break;
            }
          }
          // No grass under a showroom's floor slab (B12) — see HALL_GRASS_RADIUS's comment.
          let inHall = false;
          for (let hi = 0; hi < halls.length; hi++) {
            const h = halls[hi];
            const hdx = x - h.x;
            const hdz = z - h.z;
            if (hdx * hdx + hdz * hdz < HALL_GRASS_RADIUS * HALL_GRASS_RADIUS) {
              inHall = true;
              break;
            }
          }
          const k = (j * N + i) * 10;
          lat[k] = y;
          lat[k + 1] = submerged || inApron || inHall ? 0 : g * (1 - clamp01(edge)) * (1 - CANOPY_THIN * shade);
          lat[k + 2] = dry;
          lat[k + 3] = snow;
          lat[k + 4] = wet;
          // The raw "is this NODE itself submerged" flag, kept separately from the density
          // above — see pass 3's own comment on why.
          lat[k + 5] = submerged ? 1 : 0;
          // This NODE's own clearance from the nearest tarmac edge (negative = the node
          // itself sits on the carriageway). See pass 3's "EXACT road re-check" comment: a
          // node being clear does not mean the CELL is, if a narrow road threads between
          // this node and its neighbours without touching any of the cell's four corners.
          lat[k + 6] = rc.width > 0 ? rc.d - rc.width * 0.5 : Infinity;
          // The blended ground colour this node sits on, linear rgb — see the block above
          // that computed gr/gg/gb. Bilinearly interpolated in pass 3 exactly like dry/snow/
          // wet just above, then sqrt-encoded into iGnd once per surviving BLADE.
          lat[k + 7] = gr;
          lat[k + 8] = gg;
          lat[k + 9] = gb;
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
          const gx = (lat[(j * N + im) * 10] - lat[(j * N + ip) * 10]) / dx;
          const gz = (lat[(jm * N + i) * 10] - lat[(jp * N + i) * 10]) / dz;
          const ny = 1 / Math.sqrt(gx * gx + gz * gz + 1);
          lat[(j * N + i) * 10 + 1] *= smoothstep(SLOPE_N0, SLOPE_N1, ny);
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
    const iGnd = chunk.iGnd;
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
      const k00 = (iz * N + ix) * 10;
      const k10 = k00 + 10;
      const k01 = k00 + N * 10;
      const k11 = k01 + 10;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;

      const dens = lat[k00 + 1] * w00 + lat[k10 + 1] * w10 + lat[k01 + 1] * w01 + lat[k11 + 1] * w11;
      if (dens <= 0.004) continue;

      /* EXACT water re-check, at the blade's own precise world position, not the lattice's —
       * same root cause as the station note just below: a small pond or a narrow inlet can sit
       * entirely inside one bilinear cell without any of its four corners actually being wet,
       * so the interpolated `dens` above can come out positive for a point standing in open
       * water. Caught with real, driven `Grass` output: blades as deep as 6.55 m into open
       * water, worst in the coarsest rings. Only escalated to a real `Terrain` query — the
       * thing the whole lattice exists to avoid paying per blade — when the four corners of
       * THIS cell actually disagree about being submerged (the raw flag pass 1 wrote to
       * `lat[k+5]`, kept separately from the already-suppressed density channel for exactly
       * this reason): a shoreline is thin, so most blades are nowhere near one and this reads
       * four already-fetched floats and returns. */
      const wet00 = lat[k00 + 5],
        wet10 = lat[k10 + 5],
        wet01 = lat[k01 + 5],
        wet11 = lat[k11 + 5];
      /* EXACT road re-check, same principle, for the carriageway itself. `edge`/`ROAD_GRASS_
       * MARGIN_A/B` suppress density at each NODE, but a road wide enough to matter (a two-lane
       * arterial, ~7-8 m) is narrower than the far ring's own ~11.4 m node spacing — a real
       * lane can thread THROUGH a cell without any of its four corners reading close to it at
       * all, so `dens` above can come out fully unsuppressed for a point standing on tarmac.
       * Caught with real, driven `Grass` output (not assumed): base positions as deep as
       * 0.25 m onto real pavement, concentrated in exactly the coarse rings this predicts (ring
       * 2: 0.63% of instances, ring 3: 0.53%, ring 0 at 1.5 m spacing: 0.08%). `clr` is each
       * node's own signed clearance from the nearest tarmac edge (pass 1's `lat[k+6]`,
       * `Infinity` off in open country); if the SMALLEST of the four is inside one cell
       * diagonal (`cellDiag` — the largest gap a road could hide inside without touching a
       * corner), a road could plausibly be threading this cell and the exact position is worth
       * the one extra `carve()` call. Chunks with nothing nearby (open country, most of the
       * world) never pay it. */
      const clr00 = lat[k00 + 6],
        clr10 = lat[k10 + 6],
        clr01 = lat[k01 + 6],
        clr11 = lat[k11 + 6];
      const nearRoad = Math.min(clr00, clr10, clr01, clr11) < cellDiag;
      const needsBladePos = stations.length > 0 || halls.length > 0 || nearRoad || wet00 !== wet10 || wet00 !== wet01 || wet00 !== wet11;
      const bx = needsBladePos ? x0 + ux * INV_U16 * cs : 0;
      const bz = needsBladePos ? z0 + uz * INV_U16 * cs : 0;
      if (wet00 !== wet10 || wet00 !== wet01 || wet00 !== wet11) {
        const by = lat[k00] * w00 + lat[k10] * w10 + lat[k01] * w01 + lat[k11] * w11;
        const bw = T.weights(bx, bz).w;
        const waterY = waterLevelAt(bw, -Infinity);
        if (waterY !== null && by < waterY + GRASS_WATER_FREEBOARD) continue;
      }
      if (nearRoad) {
        // `carve()`, not the cheaper single-edge `query()` — tried query() first (5.7x
        // cheaper per call) and it let real on-tarmac blades straight back through at real
        // junctions: `query()` picks whichever ONE edge is nearest by centreline distance,
        // but a point can sit on edge A's own tarmac while a narrower edge B happens to have
        // the closer centreline, so `query()`'s d/width pair describes the WRONG edge. `edge`
        // above (what pass 1 actually gates on) is computed from carve()'s blended field, so
        // the exact re-check has to match it or it is exact against a different question.
        // Measured (not assumed) after the swap: 0 on-tarmac survivors across six seeds.
        const rc2 = T.roads.carve(bx, bz);
        if (rc2.width > 0 && rc2.d < rc2.width * 0.5) continue;
      }

      /* EXACT station-apron re-check, at the blade's own precise world position, not the
       * lattice's. The lattice suppression in pass 1 zeroes density at each NODE, but the far
       * ring's node spacing (cs/lat, up to ~11.4 m) is comparable to or bigger than a station's
       * own apron (STATION_RADIUS = 11 m radius, 22 m across) — a real apron can sit entirely
       * inside ONE bilinear cell without touching any of its four corners, so the
       * lattice-interpolated `dens` above can come out positive for a point that is, in world
       * space, standing on the tarmac. Caught with real, driven `Grass` output
       * (tools/diag-grasstrim.mjs's real-blade check): blades as deep as 1.93 m inside an
       * 11 m-radius apron, worst in the cs=160 ring where node spacing (11.4 m) is coarsest.
       * `stations` is already filtered to the handful in reach of this chunk, so the extra
       * cost here is one cheap loop, only paid when it is non-empty. */
      if (stations.length) {
        let onApron = false;
        for (let si = 0; si < stations.length; si++) {
          const s = stations[si];
          const sdx = bx - s.x;
          const sdz = bz - s.z;
          if (sdx * sdx + sdz * sdz < STATION_GRASS_RADIUS * STATION_GRASS_RADIUS) {
            onApron = true;
            break;
          }
        }
        if (onApron) continue;
      }

      /* EXACT hall-slab re-check (B12), same reasoning as the station apron above — the far
       * ring's node spacing can exceed the hall's own half-diagonal (HALL_GRASS_RADIUS), so a
       * bilinear cell can sit entirely inside the footprint without touching a corner. */
      if (halls.length) {
        let onSlab = false;
        for (let hi = 0; hi < halls.length; hi++) {
          const h = halls[hi];
          const hdx = bx - h.x;
          const hdz = bz - h.z;
          if (hdx * hdx + hdz * hdz < HALL_GRASS_RADIUS * HALL_GRASS_RADIUS) {
            onSlab = true;
            break;
          }
        }
        if (onSlab) continue;
      }

      // The coin is hashed from (chunk, template index), never from the world position the
      // shader's own thinning hash uses: if the two hashes correlated, the field would thin
      // in stripes instead of uniformly.
      if (hash3i(cx, cz, n, seed) * INV_U32 > dens) continue;

      const y = lat[k00] * w00 + lat[k10] * w10 + lat[k01] * w01 + lat[k11] * w11;
      const dry = lat[k00 + 2] * w00 + lat[k10 + 2] * w10 + lat[k01 + 2] * w01 + lat[k11 + 2] * w11;
      const snow = lat[k00 + 3] * w00 + lat[k10 + 3] * w10 + lat[k01 + 3] * w01 + lat[k11 + 3] * w11;
      const wet = lat[k00 + 4] * w00 + lat[k10 + 4] * w10 + lat[k01 + 4] * w01 + lat[k11 + 4] * w11;
      // Bilinearly interpolated exactly like dry/snow/wet just above — see pass 1's own
      // comment on where the four corner values came from.
      const gr = lat[k00 + 7] * w00 + lat[k10 + 7] * w10 + lat[k01 + 7] * w01 + lat[k11 + 7] * w11;
      const gg = lat[k00 + 8] * w00 + lat[k10 + 8] * w10 + lat[k01 + 8] * w01 + lat[k11 + 8] * w11;
      const gb = lat[k00 + 9] * w00 + lat[k10 + 9] * w10 + lat[k01 + 9] * w01 + lat[k11 + 9] * w11;

      iPos[out * 2] = ux;
      iPos[out * 2 + 1] = uz;
      iGrd[out] = ((y - minY) * invSpan * 65535) | 0;
      const o4 = out * 4;
      iTint[o4] = (clamp01(dry) * 255) | 0;
      iTint[o4 + 1] = (clamp01(snow) * 255) | 0;
      iTint[o4 + 2] = (clamp01(wet) * 255) | 0;
      iTint[o4 + 3] = (clamp01(dens) * 255) | 0;
      // sqrt-encode: a plain linear u8 quantises the dark stops (a shaded highland stone, a
      // dark peat) far too coarsely — GRASS_VS squares it straight back (`vGnd = iGnd.rgb *
      // iGnd.rgb`). `.a` (o4+3) is left at 255, unused — itemSize 4 purely for attribute
      // alignment, see the byte-layout comment by INV_U16 above.
      iGnd[o4] = Math.round(Math.sqrt(clamp01(gr)) * 255);
      iGnd[o4 + 1] = Math.round(Math.sqrt(clamp01(gg)) * 255);
      iGnd[o4 + 2] = Math.round(Math.sqrt(clamp01(gb)) * 255);
      iGnd[o4 + 3] = 255;
      out++;
    }

    chunk.count = out;
    chunk.built = cap;
    chunk.aPos.needsUpdate = true;
    chunk.aGrd.needsUpdate = true;
    chunk.aTint.needsUpdate = true;
    chunk.aGnd.needsUpdate = true;

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
