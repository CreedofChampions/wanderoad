/* Wanderoad — the props you actually see, and the petrol stations.
 *
 * Every one of the 100 kinds in src/world/props.js is MODELLED HERE, in this project's own
 * painted-solid pipeline (src/render/painted.js). That is a deliberate choice over importing
 * a hundred CC0 GLBs, and the reasons are practical rather than ideological:
 *
 *   1. LICENCE. Geometry written here is this project's own. There is no third-party file to
 *      audit, no "free for personal use" page that quietly changed, no dead Sketchfab link
 *      that makes a grant unverifiable a year later. The rule is no GPL/AGPL and every asset
 *      logged; the cheapest way to satisfy it for a hundred objects is to not have a hundred
 *      third-party objects. (The cars stay bought — see docs/CREDITS.md for why they earn it.)
 *   2. LOOK. The painted shader reads colour and material from per-vertex attributes. A GLB
 *      has to be re-materialled by guessing at material names (src/car/loadedCar.js does
 *      exactly that, and it works because Quaternius names things plainly — most packs do
 *      not). Built here, a prop is in the painting from the first vertex.
 *   3. COST. Colour-per-vertex means a whole tile — a shrine, a barn, a fingerpost, a
 *      petrol station — bakes into ONE geometry and draws in ONE call. A hundred GLBs is a
 *      hundred materials and a hundred draws, for objects that are rare by design.
 *
 * The window is a rolling grid of tiles around the car, like render/road.js, not a hook on
 * the terrain streamer: props are sparse, so tying them to a quadtree would rebuild the same
 * shrine at four LODs for nothing.
 */

import { Mesh, Object3D, Sprite, SpriteMaterial, CanvasTexture, AdditiveBlending } from 'three';
import { PB, pv, pq, pbox, pcyl, proof, pquad, finishPainted, createPaintedMaterial, MAT, LC, tint, mixc } from './painted.js';
import { Terrain } from '../world/terrain.js';
import { waterLevelAt, BIOME_COUNT } from '../world/biomes.js';
import {
  propsInBox, stationsInBox, fuelCansInBox, stationTownInBox, stationSpur, stationPad, PROP_BY_ID, PROP_IDS,
  airfieldsInBox,
  harboursInBox,
  harbourCellsWarm,
  airfieldCellsWarm,
  warmOne,
  CAN_HOVER, CAN_RADIUS, CAN_FRACTION, STATION_APRON_HALF_WIDTH, STATION_APRON_HALF_DEPTH,
  SHOWROOM_SLOTS,
} from '../world/props.js';
import { TAU, rng, hash3i, clamp, lerp, smoothstep } from '../core/math.js';
// The same freeboard the drawn road ribbon floats at, imported rather than copied: the access
// spur is tarmac on the same ground and has to clear the terrain mesh by the same amount, and
// tools/diag-seam.mjs and tools/diag-spur.mjs both subtract exactly this number.
import { LIFT } from './road.js';

/* ── window ───────────────────────────────────────────────────────────────── */

/* Tile edge, metres. Measured across 320 / 384 / 448 / 512 with everything else fixed:
 * 512 gives 32 tiles, 21 draw calls and a 10.7 ms worst frame; 384 gives 44 tiles, the SAME
 * 21 draw calls (bigger tiles are more likely to contain something, so the two effects
 * cancel) and a 6.9 ms worst frame; 320 shaves another millisecond but costs six more draw
 * calls. 384 is the knee. */
const TILE = 384;
/** How far props exist. A windmill has to be visible long before you reach it. */
const RANGE = 1180;
/** A frame already longer than this gets no tile at all. Props are scenery; a hitch is not.
 *  One tile costs 1-3 ms (a Terrain build plus the bake), so the rule is simply "one tile a
 *  frame, and none on a frame that is already struggling". Filling the whole window then
 *  takes about half a second of driving — far less than the ground under it takes to
 *  stream, so nothing is ever visibly missing. */
const SKIP_FRAME = 1 / 45;
/** How many petrol stations a session remembers. 192 covers roughly a 40 km drive. */
const KNOWN_STATIONS = 192;
/* PAD_STEP (1.2 m) used to live here: the band the forecourt slab was clamped into around the
 * host edge's own graded height `s.y`. It is gone, and deliberately. `s.y` comes from
 * `land()`, the raw biome relief, and the car drives on `Terrain.height()`, the same land bent
 * by the road carve — beside a road those are different surfaces by metres (see stationPad's
 * header in src/world/props.js). Clamping the slab toward a height taken off the wrong surface
 * is what buried forecourts in hillsides and floated their access spurs. The slab now sits on
 * the highest REAL ground under its own apron, and the spur ramps to it along that same real
 * ground. */
/** The gentle bob a floating can does — "cozy, not garish": a few centimetres, a little
 *  under one cycle every two seconds. Applied to the finished mesh's own transform each
 *  frame, on top of its baked, already-hovering (+CAN_HOVER) position — see buildFuelCan. */
export const CAN_BOB_AMP = 0.055;
const CAN_BOB_HZ = 0.52;

/* ── "bigger, and glowing, so they are not missed" ────────────────────────────
 * Operator, docs/BACKLOG.md. Measured before the change: the can's geometry bounding box was
 * 0.312 x 0.440 x 0.242 m — a real jerry can, correct next to a 4.5 m car and, at 14 m, an
 * eleven-pixel red speck on a 1582 px frame. Correct scale was the wrong answer to "can you
 * see it".
 *
 * Three changes, in the order they matter:
 *   1. SIZE. Every dimension of the geometry x CAN_SCALE, about its own base, so the hover
 *      height (CAN_HOVER, world/props.js) and the ground-contact `y` every placement test in
 *      world/props.js reasons about are both untouched — the can grows upward out of the same
 *      point on the ground, and nothing about where a can may legally be placed changes.
 *   2. GLOW. A soft additive billboard behind it (CAN_HALO_*, `_haloTexture` below). Additive,
 *      depth-TESTED so a hill still hides it, and no bigger than the can it surrounds: it is
 *      a lantern, not a waypoint marker. It breathes on the same slow clock as the bob so the
 *      two read as one object rather than two effects.
 *   3. A NEIGHBOUR. Every can now stands beside a LITTER BIN (buildLitterBin below) — the
 *      other half of the same backlog line, and the thing that makes a can legible from far
 *      enough away to react to: a hovering 0.7 m can is a dot at 150 m, and a can plus a
 *      waist-high bin with a lit band is a roadside STOP, which is a shape you recognise.
 *      The bin bakes into the tile's shared mesh (no extra draw call, no bob), so it stays
 *      after the can is taken — a bin is part of the road, not part of the pickup.
 *
 * COZY IS THE FILTER, and it is what sets the numbers: 2.3x rather than 3x (a jerry can the
 * size of a wheelie bin is a joke, not a pickup), halo opacity 0.3 rather than 1, and a 0.55 Hz
 * breath rather than a pulse. Nothing here flashes.
 */
export const CAN_SCALE = 2.3;
/** Halo radius in metres — sized to sit just outside the scaled can, not to be seen from space. */
const CAN_HALO_R = 1.35;
/** Peak opacity of the halo, and how far it breathes either side of it. */
const CAN_HALO_A = 0.3;
const CAN_HALO_SWING = 0.09;
/** Metres from the can to its litter bin. Far enough to read as two objects, close enough to
 *  read as one stop — and inside the can's own VERGE_CLEAR + CAN_FOOT margin (2.7 m, see
 *  world/props.js) so the bin cannot end up on the carriageway even in the worst case, which
 *  is the whole reason the offset direction below is chosen AWAY from the road. */
const BIN_OFFSET = 1.6;

/* ── palette shortcuts ────────────────────────────────────────────────────────
 * Everything is a linear triple from src/core/palette.js. Props that need a colour the
 * palette does not have (a green cabinet, vermilion lacquer) mix one rather than inventing a
 * hex — that is what keeps a hundred objects looking like one world. */
const WOOD = LC('timber');
const WOOD_L = LC('trunkLit');
const WOOD_D = LC('trunkShade');
const POST_W = LC('postWood');
const PAINT_W = LC('postPaint');
const STONE = LC('sB');
const STONE_L = LC('sC');
const STONE_A = LC('sA');
const STONE_D = LC('sShade');
const STONE_X = LC('sDeep');
const MORTAR = LC('mortar');
const PLASTER = LC('wallA');
const PLASTER2 = LC('wallB');
const ROOF_A = LC('roofA');
const ROOF_B = LC('roofB');
const SLATE = LC('roofSlate');
const THATCH = LC('thatch');
const MOSS = LC('moss');
const LICHEN = LC('lichen');
const GLOW = LC('windowGlow');
/* The dealership's own fascia and pennant colour, so a showroom is not mistaken for a pump at
 * a distance. Deliberately from the same painted palette as everything else here. */

const GLASSC = LC('glass');
const CHROME = LC('chrome');
const TYRE = LC('tyre');
const LEAF = LC('cMid');
const LEAF_L = LC('cLit');
const LEAF_D = LC('cShade');
const DRY = LC('gDry');
const RED = LC('paintA');
const AMBER = LC('paintB');
const BLUE = LC('paintC');
const CREAM = LC('paintD');
const TEAL = LC('paintE');
/* The dealership's own fascia and pennant colour — TEAL against the pumps' VERMILION, so a
 * showroom is not mistaken for a petrol station at a distance. Same painted palette as every
 * other prop in this file; nothing new is loaded for it. */
const SIGN_DEAL = TEAL;
const INK = LC('paintF');
const GRAVEL = LC('gravelLit');
const GRAVEL_D = LC('gravelShade');
const TARMAC = LC('tarmacLit');
const TARMAC_D = LC('tarmacShade');
const LINE = LC('lineWhite');
const RUST = mixc(ROOF_B, WOOD_D, 0.35);
const VERMILION = mixc(RED, AMBER, 0.18);
const GREENBOX = mixc(LEAF_D, INK, 0.35);

/* ── extra primitives ────────────────────────────────────────────────────────
 * painted.js gives boxes, cylinders and gables, which is everything the pen ever needed
 * because the pen modelled a village. A hundred props needs one more shape: a blob. Heads,
 * mushroom caps, topiary, hay, foliage — all of it is a squashed low-poly sphere, and doing
 * it with boxes reads as Minecraft. */
function pball(M, cx, cy, cz, rx, ry, rz, col, mat, seg = 7, rings = 4) {
  const grid = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (i / rings) * Math.PI;
    const sy = Math.cos(phi);
    const sr = Math.sin(phi);
    const row = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      const nx = Math.cos(a) * sr;
      const nz = Math.sin(a) * sr;
      row.push(pv(M, cx + nx * rx, cy + sy * ry, cz + nz * rz, nx, sy, nz, col, mat));
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const k = (j + 1) % seg;
      pq(M, grid[i][j], grid[i][k], grid[i + 1][k], grid[i + 1][j]);
    }
  }
}

/** A wheel: a short fat cylinder lying on the X axis, with a paler hub. */
function pwheel(M, x, y, z, r, w, col, hub) {
  pcyl(M, [x - w * 0.5, y, z], [x + w * 0.5, y, z], r, r, 8, col, MAT.MATTE, true, true);
  if (hub) pcyl(M, [x - w * 0.62, y, z], [x + w * 0.62, y, z], r * 0.34, r * 0.34, 6, hub, MAT.METAL, true, true);
}

/**
 * Append `src` into `dst`, rotated about Y by `yaw`, scaled and translated.
 *
 * Props are built once each in local space and then blitted, rather than being built
 * directly in world space, because half of them share a builder with different parameters
 * and threading a transform through every pbox call would be error-prone in exactly the way
 * that puts a chimney through a roof.
 */
function blit(dst, src, x, y, z, yaw, s) {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const base = dst.n;
  for (let i = 0; i < src.n; i++) {
    const px = src.pos[i * 3] * s;
    const py = src.pos[i * 3 + 1] * s;
    const pz = src.pos[i * 3 + 2] * s;
    // Same handedness as painted.js rotY(): x' = x*ca - z*sa, z' = x*sa + z*ca.
    dst.pos.push(x + px * ca - pz * sa, y + py, z + px * sa + pz * ca);
    const nx = src.nrm[i * 3];
    const ny = src.nrm[i * 3 + 1];
    const nz = src.nrm[i * 3 + 2];
    dst.nrm.push(nx * ca - nz * sa, ny, nx * sa + nz * ca);
    dst.col.push(src.col[i * 3], src.col[i * 3 + 1], src.col[i * 3 + 2]);
    dst.mat.push(src.mat[i]);
    dst.n++;
  }
  for (let i = 0; i < src.idx.length; i++) dst.idx.push(base + src.idx[i]);
}

/* ── shape families ──────────────────────────────────────────────────────────
 * Twenty-odd of these cover the whole catalogue. A "kind" is then mostly a set of numbers,
 * which is what makes a hundred distinct objects tractable without a hundred hand-modelled
 * files — and it is also why they look related, which is what you want in one world.
 *
 * Local space for every builder: origin on the ground at the centre of the footprint, +Y up,
 * +Z is the FRONT (the side that faces the road when the placement asks for it).
 */

/** Walls, a gabled roof, and the optional bits that turn one into a barn or a chapel. */
function gHut(M, o) {
  const w = o.w, d = o.d, h = o.h;
  if (o.plinth) pbox(M, 0, o.plinth * 0.5, 0, w * 0.5 + 0.14, o.plinth * 0.5, d * 0.5 + 0.14, 0, o.plinthCol || STONE_D, MAT.MATTE);
  const y0 = o.plinth || 0;
  pbox(M, 0, y0 + h * 0.5, 0, w * 0.5, h * 0.5, d * 0.5, 0, o.wall, MAT.MATTE);
  // Corner posts read as timber framing and stop a plain box looking like a plain box.
  if (o.frame) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      pbox(M, sx * (w * 0.5 - 0.06), y0 + h * 0.5, sz * (d * 0.5 - 0.06), 0.075, h * 0.5, 0.075, 0, o.frameCol || WOOD, MAT.MATTE);
    }
    pbox(M, 0, y0 + h - 0.09, 0, w * 0.5 + 0.01, 0.09, d * 0.5 + 0.01, 0, o.frameCol || WOOD, MAT.MATTE);
  }
  proof(M, 0, y0 + h, 0, w * 0.5 + o.eave, d * 0.5 + o.eave, o.pitch, 0, o.roof, MAT.MATTE);
  if (o.door !== false) {
    pbox(M, o.doorX || 0, y0 + 0.92, d * 0.5 + 0.03, 0.42, 0.92, 0.05, 0, o.doorCol || WOOD_D, MAT.MATTE);
  }
  if (o.windows) {
    for (const wx of o.windows) {
      pbox(M, wx, y0 + h * 0.62, d * 0.5 + 0.04, 0.3, 0.26, 0.05, 0, o.lit ? GLOW : GLASSC, o.lit ? MAT.EMIT : MAT.GLASS);
      pbox(M, wx, y0 + h * 0.62, d * 0.5 + 0.03, 0.35, 0.31, 0.03, 0, o.frameCol || WOOD, MAT.MATTE);
    }
  }
  if (o.chimney) {
    pbox(M, w * 0.28, y0 + h + o.pitch * 0.55, 0, 0.17, o.pitch * 0.62, 0.17, 0, o.chimCol || STONE_D, MAT.MATTE);
    pbox(M, w * 0.28, y0 + h + o.pitch * 1.18, 0, 0.21, 0.06, 0.21, 0, MORTAR, MAT.MATTE);
  }
  if (o.porch) {
    const py = y0 + h * 0.82;
    pbox(M, 0, py, d * 0.5 + 0.55, w * 0.42, 0.06, 0.58, 0, o.roof, MAT.MATTE);
    for (const sx of [-1, 1]) pcyl(M, [sx * w * 0.36, y0, d * 0.5 + 1.0], [sx * w * 0.36, py, d * 0.5 + 1.0], 0.06, 0.05, 5, o.frameCol || WOOD, MAT.MATTE, false, false);
  }
}

/** A drum with a conical roof: dovecote, kiln, yurt, silo. */
function gRound(M, o) {
  const seg = o.seg || 9;
  pcyl(M, [0, 0, 0], [0, o.h, 0], o.r, o.r * (o.taper ?? 1), seg, o.wall, MAT.MATTE, false, false);
  if (o.band) pcyl(M, [0, o.h * 0.55, 0], [0, o.h * 0.55 + 0.12, 0], o.r * 1.03, o.r * 1.03, seg, o.band, MAT.MATTE, false, false);
  if (o.roofH) pcyl(M, [0, o.h, 0], [0, o.h + o.roofH, 0], o.r * (o.taper ?? 1) + (o.eave ?? 0.2), 0.04, seg, o.roof, MAT.MATTE, true, true);
  if (o.door !== false) pbox(M, 0, 0.82, o.r * 0.98, 0.36, 0.82, 0.06, 0, o.doorCol || WOOD_D, MAT.MATTE);
}

/** A tapering stack of drums with something on top. Towers, silos, lighthouses. */
function gTower(M, o) {
  const n = o.tiers || 3;
  let y = 0;
  let r = o.r;
  for (let i = 0; i < n; i++) {
    const hh = o.h / n;
    const r2 = lerp(o.r, o.rTop ?? o.r * 0.72, (i + 1) / n);
    pcyl(M, [0, y, 0], [0, y + hh, 0], r, r2, o.seg || 9, i % 2 && o.band ? o.band : o.wall, MAT.MATTE, false, false);
    y += hh;
    r = r2;
  }
  if (o.gallery) {
    pcyl(M, [0, y, 0], [0, y + 0.12, 0], r * 1.45, r * 1.45, o.seg || 9, o.galleryCol || SLATE, MAT.MATTE, true, true);
    pcyl(M, [0, y + 0.12, 0], [0, y + 0.55, 0], r * 1.4, r * 1.4, o.seg || 9, o.galleryCol || SLATE, MAT.MATTE, false, false);
    y += 0.55;
  }
  if (o.lamp) {
    pcyl(M, [0, y, 0], [0, y + o.lamp, 0], r * 0.92, r * 0.92, o.seg || 9, GLOW, MAT.EMIT, false, false);
    y += o.lamp;
  }
  if (o.cap) pcyl(M, [0, y, 0], [0, y + o.cap, 0], r * 1.2, 0.04, o.seg || 9, o.roof || SLATE, MAT.MATTE, true, true);
  if (o.clock) {
    for (const sz of [1, -1]) {
      pcyl(M, [0, y - o.cap - 0.9, sz * r * 0.9], [0, y - o.cap - 0.9, sz * r * 1.02], 0.42, 0.42, 9, CREAM, MAT.MATTE, false, true);
      pbox(M, 0, y - o.cap - 0.75, sz * r * 1.05, 0.03, 0.22, 0.02, 0, INK, MAT.MATTE);
      pbox(M, 0.14, y - o.cap - 0.9, sz * r * 1.05, 0.16, 0.03, 0.02, 0, INK, MAT.MATTE);
    }
  }
}

/** Posts holding a roof up, with nothing much in between. Shelters, gazebos, canopies. */
function gCanopy(M, o) {
  const w = o.w, d = o.d, h = o.h;
  const px = w * 0.5 - 0.1;
  const pz = d * 0.5 - 0.1;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    if (o.round) pcyl(M, [sx * px, 0, sz * pz], [sx * px, h, sz * pz], o.postR || 0.09, (o.postR || 0.09) * 0.9, 6, o.post, MAT.MATTE, true, false);
    else pbox(M, sx * px, h * 0.5, sz * pz, o.postR || 0.08, h * 0.5, o.postR || 0.08, 0, o.post, MAT.MATTE);
  }
  if (o.flat) pbox(M, 0, h + 0.09, 0, w * 0.5 + o.eave, 0.09, d * 0.5 + o.eave, 0, o.roof, MAT.MATTE);
  else proof(M, 0, h, 0, w * 0.5 + o.eave, d * 0.5 + o.eave, o.pitch || 0.6, 0, o.roof, MAT.MATTE);
  if (o.back) pbox(M, 0, h * 0.5, -d * 0.5, w * 0.5, h * 0.5, 0.06, 0, o.backCol || o.post, MAT.MATTE);
  if (o.bench) {
    pbox(M, 0, 0.44, -d * 0.22, w * 0.42, 0.045, 0.16, 0, o.benchCol || WOOD, MAT.MATTE);
    for (const sx of [-1, 1]) pbox(M, sx * w * 0.34, 0.22, -d * 0.22, 0.05, 0.22, 0.05, 0, o.benchCol || WOOD, MAT.MATTE);
  }
}

/** A post with boards on it. Fingerposts, notice boards, bus stops, village signs. */
function gSign(M, o) {
  const h = o.h;
  if (o.round) pcyl(M, [0, 0, 0], [0, h, 0], o.r || 0.06, (o.r || 0.06) * 0.85, 6, o.post, MAT.MATTE, true, true);
  else pbox(M, 0, h * 0.5, 0, o.r || 0.06, h * 0.5, o.r || 0.06, 0, o.post, MAT.MATTE);
  if (o.twin) pbox(M, o.w, h * 0.5, 0, o.r || 0.06, h * 0.5, o.r || 0.06, 0, o.post, MAT.MATTE);
  for (const b of o.boards) {
    // b = [y, halfW, halfH, colour, offsetX, yaw]
    pbox(M, b[4] || 0, b[0], 0.02, b[1], b[2], 0.025, b[5] || 0, b[3], MAT.MATTE);
  }
  if (o.finial) pball(M, 0, h + 0.06, 0, 0.08, 0.09, 0.08, o.post, MAT.MATTE, 6, 3);
}

/** A standing box you could open: phone box, vending machine, cabinet, post box. */
function gCabinet(M, o) {
  const w = o.w, d = o.d, h = o.h;
  pbox(M, 0, 0.05, 0, w * 0.5 + 0.05, 0.05, d * 0.5 + 0.05, 0, o.base || STONE_D, MAT.MATTE);
  pbox(M, 0, h * 0.5 + 0.1, 0, w * 0.5, h * 0.5, d * 0.5, 0, o.body, MAT.MATTE);
  if (o.face) pbox(M, 0, h * 0.58, d * 0.5 + 0.02, w * 0.4, h * 0.3, 0.03, 0, o.face, o.faceMat ?? MAT.MATTE);
  if (o.glazed) {
    for (const sx of [-1, 1]) pbox(M, sx * w * 0.24, h * 0.62, d * 0.5 + 0.02, w * 0.19, h * 0.26, 0.03, 0, GLASSC, MAT.GLASS);
  }
  if (o.cap) pbox(M, 0, h + 0.14, 0, w * 0.5 + 0.06, 0.06, d * 0.5 + 0.06, 0, o.capCol || o.body, MAT.MATTE);
  if (o.dome) pball(M, 0, h + 0.1, 0, w * 0.5, 0.22, d * 0.5, o.capCol || o.body, MAT.MATTE, 8, 3);
}

/** A run of posts and rails along local X. Fences, gates, washing lines, jetty rails. */
function gRunFence(M, o) {
  const n = o.n || 5;
  const step = o.len / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = -o.len * 0.5 + i * step;
    pbox(M, x, o.h * 0.5, 0, 0.055, o.h * 0.5, 0.055, o.lean ? (i % 2 ? 0.04 : -0.03) : 0, o.post, MAT.MATTE);
  }
  for (const ry of o.rails) pbox(M, 0, o.h * ry, 0, o.len * 0.5, 0.035, 0.03, 0, o.rail || o.post, MAT.MATTE);
}

/** A drystone wall: courses of jittered stones, which is the only way it reads as dry-laid. */
function gWall(M, o, r) {
  const courses = o.courses || 5;
  const ch = o.h / courses;
  for (let c = 0; c < courses; c++) {
    const inset = (c / courses) * o.batter;
    let x = -o.len * 0.5;
    while (x < o.len * 0.5) {
      const sw = 0.16 + r() * 0.22;
      const cw = Math.min(sw, o.len * 0.5 - x);
      if (cw < 0.04) break;
      const shade = r();
      const col = shade < 0.34 ? STONE : shade < 0.68 ? STONE_L : STONE_A;
      pbox(M, x + cw * 0.5, ch * (c + 0.5), 0, cw * 0.5, ch * 0.52, o.d * 0.5 - inset, (r() - 0.5) * 0.08, col, MAT.MATTE);
      x += cw * 2;
    }
  }
  if (o.cap) {
    for (let x = -o.len * 0.5; x < o.len * 0.5; x += 0.24) {
      pbox(M, x + 0.12, o.h + 0.07, 0, 0.11, 0.08, o.d * 0.4, 0.5 + (r() - 0.5) * 0.3, STONE_D, MAT.MATTE);
    }
  }
}

/** A body on wheels. Carts, tractors, trucks, caravans, trolleys. */
function gCart(M, o) {
  const w = o.w, d = o.d;
  pbox(M, 0, o.bedY, 0, w * 0.5, o.bedH * 0.5, d * 0.5, 0, o.body, MAT.MATTE);
  if (o.sides) {
    for (const sz of [-1, 1]) pbox(M, 0, o.bedY + o.bedH * 0.5 + o.sides * 0.5, sz * (d * 0.5 - 0.04), w * 0.5, o.sides * 0.5, 0.045, 0, o.body, MAT.MATTE);
    for (const sx of [-1, 1]) pbox(M, sx * (w * 0.5 - 0.04), o.bedY + o.bedH * 0.5 + o.sides * 0.5, 0, 0.045, o.sides * 0.5, d * 0.5, 0, o.body, MAT.MATTE);
  }
  if (o.cab) {
    pbox(M, 0, o.bedY + o.bedH * 0.5 + o.cab * 0.5, d * 0.5 - o.cabD * 0.5, w * 0.44, o.cab * 0.5, o.cabD * 0.5, 0, o.cabCol || o.body, MAT.MATTE);
    pbox(M, 0, o.bedY + o.bedH * 0.5 + o.cab * 0.72, d * 0.5 - o.cabD + 0.02, w * 0.36, o.cab * 0.2, 0.04, 0, GLASSC, MAT.GLASS);
  }
  for (const s of o.wheels) pwheel(M, s[0] * (w * 0.5 + 0.04), s[2], s[1], s[3], 0.13, o.tyre || TYRE, o.hub);
  if (o.shafts) {
    for (const sx of [-1, 1]) pcyl(M, [sx * w * 0.32, o.bedY, d * 0.5], [sx * w * 0.28, o.bedY * 0.55, d * 0.5 + o.shafts], 0.045, 0.035, 5, WOOD, MAT.MATTE, true, true);
  }
}

/** A pile of things. Crates, bales, barrels, logs, churns, pots. */
function gPile(M, o, r) {
  let placed = 0;
  for (let row = 0; row < o.rows; row++) {
    const per = Math.max(1, o.per - row);
    for (let i = 0; i < per; i++) {
      const x = (i - (per - 1) * 0.5) * o.step;
      const y = o.h * (row + 0.5);
      const jz = (r() - 0.5) * o.jitter;
      const jy = (r() - 0.5) * 0.06;
      const col = o.cols[(placed + row) % o.cols.length];
      if (o.round === 'x') pcyl(M, [x - o.w * 0.5, y + jy, jz], [x + o.w * 0.5, y + jy, jz], o.h * 0.48, o.h * 0.48, 8, col, MAT.MATTE, true, true);
      else if (o.round === 'y') pcyl(M, [x, y - o.h * 0.5 + jy, jz], [x, y + o.h * 0.5 + jy, jz], o.w * 0.5, o.w * 0.5 * (o.taper ?? 1), 8, col, MAT.MATTE, true, true);
      else pbox(M, x, y + jy, jz, o.w * 0.5, o.h * 0.48, o.d * 0.5, (r() - 0.5) * o.yaw, col, MAT.MATTE);
      placed++;
    }
  }
}

/** A pole with something on the end. Telegraph, flag, birdhouse, weather vane, windsock. */
function gPole(M, o) {
  pcyl(M, [0, 0, 0], [0, o.h, 0], o.r || 0.11, (o.r || 0.11) * 0.72, 7, o.post, MAT.MATTE, true, true);
  if (o.arms) {
    for (const a of o.arms) {
      pbox(M, 0, o.h * a, 0, o.armW, 0.035, 0.035, 0, o.arm || o.post, MAT.MATTE);
      for (const sx of [-1, 1]) pcyl(M, [sx * o.armW * 0.8, o.h * a + 0.04, 0], [sx * o.armW * 0.8, o.h * a + 0.14, 0], 0.035, 0.03, 5, GLASSC, MAT.GLASS, true, true);
    }
  }
  if (o.flag) {
    // A cloth that is not flat: three panels with a little wave, because a flat flag looks
    // like a decal and this world has wind in it everywhere else.
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      pbox(M, 0.16 + i * 0.3, o.h - 0.36, Math.sin(i * 1.4) * 0.07, 0.16, 0.22 - t * 0.03, 0.02, Math.sin(i * 1.4) * 0.35, o.flag, MAT.MATTE);
    }
  }
  if (o.sock) {
    for (let i = 0; i < 4; i++) {
      const r0 = 0.22 - i * 0.035;
      pcyl(M, [i * 0.26, o.h - 0.1 - i * 0.04, 0], [(i + 1) * 0.26, o.h - 0.12 - (i + 1) * 0.05, 0], r0, r0 - 0.035, 7, i % 2 ? VERMILION : CREAM, MAT.MATTE, false, false);
    }
    pcyl(M, [0, o.h - 0.1, 0], [0, o.h + 0.16, 0], 0.24, 0.24, 9, CHROME, MAT.METAL, false, false);
  }
  if (o.box) {
    pbox(M, 0, o.h + 0.16, 0, 0.17, 0.16, 0.15, 0, o.boxCol || WOOD_L, MAT.MATTE);
    proof(M, 0, o.h + 0.32, 0, 0.22, 0.2, 0.14, 0, o.roof || ROOF_A, MAT.MATTE);
    pcyl(M, [0, o.h + 0.2, 0.14], [0, o.h + 0.2, 0.17], 0.05, 0.05, 6, INK, MAT.MATTE, false, true);
  }
  if (o.vane) {
    pcyl(M, [0, o.h, 0], [0, o.h + 0.44, 0], 0.02, 0.02, 5, INK, MAT.MATTE, true, true);
    pbox(M, 0.24, o.h + 0.34, 0, 0.22, 0.12, 0.012, 0, INK, MAT.MATTE);
    pcyl(M, [-0.2, o.h + 0.34, 0], [0.02, o.h + 0.34, 0], 0.02, 0.02, 4, INK, MAT.MATTE, true, true);
    for (const [dx, dz] of [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]]) {
      pcyl(M, [0, o.h + 0.1, 0], [dx, o.h + 0.1, dz], 0.015, 0.015, 4, INK, MAT.MATTE, false, true);
    }
  }
}

/** A cluster of blobs on stalks, or just blobs. Mushrooms, topiary, bamboo, flowers. */
function gClump(M, o, r) {
  for (let i = 0; i < o.n; i++) {
    const a = (i / o.n) * TAU + r() * 0.9;
    const dd = Math.pow(r(), 0.6) * o.spread;
    const x = Math.cos(a) * dd;
    const z = Math.sin(a) * dd;
    const s = o.min + r() * (o.max - o.min);
    if (o.stalk) {
      pcyl(M, [x, 0, z], [x + (r() - 0.5) * 0.1 * s, o.stalkH * s, z + (r() - 0.5) * 0.1 * s], o.stalkR * s, o.stalkR * 0.82 * s, 6, o.stalkCol, MAT.MATTE, true, false);
    }
    const cy = o.stalk ? o.stalkH * s : o.capR * s * 0.85;
    if (o.cone) {
      pcyl(M, [x, cy, z], [x, cy + o.capR * s * 1.25, z], o.capR * s, 0.03, 8, o.capCol, MAT.MATTE, true, true);
    } else {
      const c = o.capCols ? o.capCols[(i + ((r() * 3) | 0)) % o.capCols.length] : o.capCol;
      pball(M, x, cy, z, o.capR * s, o.capR * s * (o.squash ?? 0.7), o.capR * s, c, MAT.MATTE, 7, 3);
    }
    if (o.gills) pcyl(M, [x, cy - 0.02 * s, z], [x, cy + 0.02 * s, z], o.capR * s * 0.86, o.capR * s * 0.86, 8, CREAM, MAT.MATTE, false, false);
  }
}

/** A hull: a lofted six-station shell, the cheapest thing that reads as a boat. */
function gBoat(M, o) {
  const L = o.len * 0.5;
  const stations = [];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    // Full amidships, pinched at both ends. The classic three-number hull.
    const beam = o.beam * Math.sin(Math.PI * (0.14 + t * 0.72));
    stations.push({ z: -L + t * o.len, b: beam, h: o.depth * (0.72 + 0.28 * Math.sin(Math.PI * t)) });
  }
  for (let i = 0; i < 5; i++) {
    const a = stations[i];
    const b = stations[i + 1];
    for (const sx of [-1, 1]) {
      pquad(M,
        [sx * a.b, a.h, a.z], [sx * b.b, b.h, b.z], [sx * b.b * 0.35, 0, b.z], [sx * a.b * 0.35, 0, a.z],
        o.hull, MAT.MATTE, [sx, 0.2, 0]);
    }
    pquad(M, [-a.b * 0.35, 0, a.z], [-b.b * 0.35, 0, b.z], [b.b * 0.35, 0, b.z], [a.b * 0.35, 0, a.z], o.hull, MAT.MATTE, [0, -1, 0]);
    if (!o.upturned) {
      pquad(M, [-a.b, a.h, a.z], [a.b, a.h, a.z], [b.b, b.h, b.z], [-b.b, b.h, b.z], o.inner || tint(o.hull, 0.7), MAT.MATTE, [0, 1, 0]);
    }
  }
  if (o.thwarts) {
    for (const t of [0.34, 0.66]) {
      const s = stations[Math.round(t * 5)];
      pbox(M, 0, s.h - 0.06, s.z, s.b * 0.92, 0.03, 0.08, 0, o.inner || WOOD_L, MAT.MATTE);
    }
  }
}

/** A masonry arch: two piers and a voussoir ring. */
function gArch(M, o) {
  const span = o.span;
  const r = span * 0.5;
  for (const sx of [-1, 1]) pbox(M, sx * (r + o.pier * 0.5), o.spring * 0.5, 0, o.pier * 0.5, o.spring * 0.5, o.d * 0.5, 0, o.stone, MAT.MATTE);
  const n = o.seg || 9;
  for (let i = 0; i < n; i++) {
    const a0 = Math.PI * (i / n);
    const a1 = Math.PI * ((i + 1) / n);
    const am = (a0 + a1) * 0.5;
    const x = -Math.cos(am) * r;
    const y = o.spring + Math.sin(am) * r;
    // Each voussoir is a box rotated to the tangent — a ring of boxes, which is how a real
    // arch is built and why it reads as one.
    const bw = (Math.PI * r) / n * 0.55;
    pbox(M, x, y, 0, o.thick * 0.5, bw, o.d * 0.5, 0, i % 2 ? o.stone : o.stone2 || o.stone, MAT.MATTE);
    // The box's own yaw cannot tilt in the XY plane, so lean it with a second thin slab.
    pquad(M,
      [x - Math.sin(am) * o.thick * 0.5, y + Math.cos(am) * o.thick * 0.5, o.d * 0.5],
      [x + Math.sin(am) * o.thick * 0.5, y - Math.cos(am) * o.thick * 0.5, o.d * 0.5],
      [x + Math.sin(am) * o.thick * 0.5, y - Math.cos(am) * o.thick * 0.5, -o.d * 0.5],
      [x - Math.sin(am) * o.thick * 0.5, y + Math.cos(am) * o.thick * 0.5, -o.d * 0.5],
      i % 2 ? o.stone2 || o.stone : o.stone, MAT.MATTE, [Math.cos(am), Math.sin(am), 0]);
  }
}

/** A torii: two battered posts, a curved kasagi, a nuki, a little gakuzuka. */
function gTorii(M, o) {
  const w = o.w;
  const h = o.h;
  for (const sx of [-1, 1]) {
    pcyl(M, [sx * w, 0, 0], [sx * w * 0.94, h, 0], o.r, o.r * 0.86, 8, o.col, MAT.MATTE, true, true);
  }
  // Kasagi: three slabs with a rise, because a straight lintel is a goalpost, not a torii.
  for (let i = -2; i <= 2; i++) {
    const t = i / 2;
    pbox(M, t * w * 0.62, h + 0.1 + (1 - t * t) * o.curve, 0, w * 0.31, o.r * 0.52, o.r * 1.15, 0, o.col, MAT.MATTE);
  }
  pbox(M, 0, h + 0.1 + o.curve + o.r * 0.5, 0, w * 1.25, o.r * 0.3, o.r * 0.8, 0, o.col2 || o.col, MAT.MATTE);
  pbox(M, 0, h * 0.72, 0, w * 1.06, o.r * 0.55, o.r * 0.7, 0, o.col, MAT.MATTE);
  pbox(M, 0, h * 0.86, 0, o.r * 0.8, h * 0.14, o.r * 0.7, 0, o.col2 || o.col, MAT.MATTE);
  if (o.moss) {
    for (const sx of [-1, 1]) pcyl(M, [sx * w, 0, 0], [sx * w * 0.98, h * 0.28, 0], o.r * 1.04, o.r * 0.98, 8, MOSS, MAT.MATTE, false, false);
  }
}

/** A stone lantern: base, shaft, platform, fire box, roof, jewel. */
function gLantern(M, o) {
  const s = o.s;
  pcyl(M, [0, 0, 0], [0, 0.16 * s, 0], 0.30 * s, 0.26 * s, 8, o.col, MAT.MATTE, false, true);
  pcyl(M, [0, 0.16 * s, 0], [0, 0.86 * s, 0], 0.11 * s, 0.10 * s, 7, o.col, MAT.MATTE, false, false);
  pcyl(M, [0, 0.86 * s, 0], [0, 1.02 * s, 0], 0.26 * s, 0.24 * s, 8, o.col, MAT.MATTE, false, true);
  pbox(M, 0, 1.24 * s, 0, 0.20 * s, 0.22 * s, 0.20 * s, 0.4, o.col, MAT.MATTE);
  // The fire window: EMIT, so it is warm at any hour. A lantern that is not lit is a rock.
  for (const [dx, dz] of [[0.205, 0], [-0.205, 0], [0, 0.205], [0, -0.205]]) {
    pbox(M, dx * s * 1.0, 1.24 * s, dz * s * 1.0, 0.1 * s, 0.11 * s, 0.1 * s, 0.4, GLOW, MAT.EMIT);
  }
  pcyl(M, [0, 1.46 * s, 0], [0, 1.74 * s, 0], 0.40 * s, 0.06 * s, 6, o.col2 || o.col, MAT.MATTE, true, true);
  pball(M, 0, 1.80 * s, 0, 0.08 * s, 0.11 * s, 0.08 * s, o.col2 || o.col, MAT.MATTE, 6, 3);
}

/** A small standing figure on a plinth: jizo, fox, cat, buddha. */
function gFigure(M, o) {
  const s = o.s;
  pbox(M, 0, 0.08 * s, 0, 0.26 * s, 0.08 * s, 0.24 * s, 0, o.plinth || STONE_D, MAT.MATTE);
  pcyl(M, [0, 0.16 * s, 0], [0, 0.62 * s, 0], 0.17 * s, 0.15 * s, 8, o.col, MAT.MATTE, false, false);
  pball(M, 0, 0.74 * s, 0, 0.17 * s, 0.19 * s, 0.17 * s, o.col, MAT.MATTE, 8, 4);
  if (o.ears) {
    for (const sx of [-1, 1]) pcyl(M, [sx * 0.1 * s, 0.84 * s, 0], [sx * 0.13 * s, 1.0 * s, -0.02 * s], 0.055 * s, 0.01, 5, o.col, MAT.MATTE, true, true);
  }
  if (o.bib) pcyl(M, [0, 0.52 * s, 0], [0, 0.60 * s, 0], 0.20 * s, 0.17 * s, 8, o.bib, MAT.MATTE, false, true);
  if (o.hat) pcyl(M, [0, 0.86 * s, 0], [0, 0.98 * s, 0], 0.26 * s, 0.05 * s, 8, o.hat, MAT.MATTE, true, true);
  if (o.moss) pball(M, 0, 0.2 * s, 0.02, 0.2 * s, 0.12 * s, 0.2 * s, MOSS, MAT.MATTE, 7, 3);
}

/** Loose stones: cairns, erratics, standing stones, rubble. */
function gStones(M, o, r) {
  for (let i = 0; i < o.n; i++) {
    const a = (i / o.n) * TAU + r() * 1.4;
    const dd = o.stack ? 0 : Math.pow(r(), 0.5) * o.spread;
    const x = Math.cos(a) * dd;
    const z = Math.sin(a) * dd;
    const s = o.min + r() * (o.max - o.min);
    const y = o.stack ? o.step * (i + 0.5) : s * (o.upright ? 0.5 : 0.34);
    const col = r() < 0.4 ? STONE : r() < 0.7 ? STONE_L : STONE_D;
    if (o.upright) {
      pbox(M, x, y, z, s * 0.32, s * 0.5, s * 0.24, r() * TAU, col, MAT.MATTE);
      pbox(M, x, y * 1.75, z, s * 0.24, s * 0.28, s * 0.18, r() * TAU, col, MAT.MATTE);
    } else {
      pball(M, x, y, z, s * 0.5, s * (o.flat ? 0.24 : 0.36), s * 0.44, col, MAT.MATTE, 7, 3);
    }
    if (o.moss && r() < 0.5) pball(M, x, y + s * 0.2, z, s * 0.34, s * 0.1, s * 0.3, MOSS, MAT.MATTE, 6, 3);
  }
}

/** Steps cut into a bank, going away from the road. */
function gSteps(M, o) {
  for (let i = 0; i < o.n; i++) {
    pbox(M, 0, o.rise * (i + 0.5), -o.tread * (i + 0.5), o.w * 0.5, o.rise * 0.55, o.tread * 0.5, 0, i % 2 ? STONE : STONE_L, MAT.MATTE);
  }
}

/* ── the catalogue's geometry ─────────────────────────────────────────────────
 * One entry per id in src/world/props.js. `r` is the prop's own deterministic stream, `hue`
 * its 0..1 variation draw. The two files are asserted to agree by tools/bench-props.mjs. */
const BUILDERS = {
  /* shrines */
  torii_red: (M, r) => gTorii(M, { w: 1.5, h: 3.6, r: 0.17, curve: 0.16, col: VERMILION, col2: INK }),
  torii_stone: (M, r) => gTorii(M, { w: 1.4, h: 3.1, r: 0.19, curve: 0.1, col: STONE, col2: STONE_D }),
  torii_moss: (M, r) => gTorii(M, { w: 1.1, h: 2.4, r: 0.15, curve: 0.09, col: STONE_D, col2: STONE_X, moss: true }),
  jizo_trio: (M, r) => {
    for (let i = -1; i <= 1; i++) {
      const L = PB();
      gFigure(L, { s: 0.85 + r() * 0.25, col: STONE_L, bib: VERMILION, hat: r() < 0.5 ? VERMILION : null, moss: r() < 0.4 });
      blit(M, L, i * 0.52, 0, (r() - 0.5) * 0.12, r() * 0.5, 1);
    }
  },
  jizo_single: (M, r) => gFigure(M, { s: 1.0, col: STONE_L, bib: VERMILION, hat: r() < 0.6 ? VERMILION : null, moss: r() < 0.5 }),
  stone_lantern: (M) => gLantern(M, { s: 1.2, col: STONE, col2: STONE_D }),
  lantern_pair: (M, r) => {
    for (const sx of [-1, 1]) {
      const L = PB();
      gLantern(L, { s: 1.1 + r() * 0.2, col: STONE, col2: STONE_D });
      blit(M, L, sx * 1.5, 0, 0, 0, 1);
    }
  },
  paper_lanterns: (M, r) => {
    for (const sx of [-1, 1]) pcyl(M, [sx * 2.6, 0, 0], [sx * 2.6, 2.5, 0], 0.08, 0.07, 6, WOOD_D, MAT.MATTE, true, true);
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const x = lerp(-2.6, 2.6, t);
      const sag = Math.sin(t * Math.PI) * 0.34;
      pcyl(M, [x, 2.42 - sag, 0], [x, 2.06 - sag, 0], 0.15 + r() * 0.03, 0.13, 8, i % 2 ? CREAM : VERMILION, MAT.EMIT, true, true);
    }
  },
  wayside_shrine: (M, r) => {
    gHut(M, { w: 1.1, d: 0.9, h: 1.1, wall: WOOD_L, roof: SLATE, pitch: 0.45, eave: 0.24, plinth: 0.5, door: false, frame: true, frameCol: WOOD_D });
    pbox(M, 0, 1.1, 0.46, 0.34, 0.34, 0.03, 0, GLOW, MAT.EMIT);
    if (r() < 0.6) pbox(M, 0, 0.28, 0.5, 0.2, 0.06, 0.14, 0, VERMILION, MAT.MATTE);
  },
  ema_rack: (M, r) => {
    for (const sx of [-1, 1]) pcyl(M, [sx * 0.9, 0, 0], [sx * 0.9, 1.5, 0], 0.06, 0.055, 6, WOOD, MAT.MATTE, true, true);
    pbox(M, 0, 1.44, 0, 1.0, 0.05, 0.05, 0, WOOD, MAT.MATTE);
    for (let i = 0; i < 9; i++) {
      const x = -0.8 + i * 0.2;
      pbox(M, x, 1.24 - (r() * 0.04), 0.02, 0.075, 0.09, 0.012, (r() - 0.5) * 0.25, i % 3 === 0 ? CREAM : WOOD_L, MAT.MATTE);
    }
  },
  shimenawa_post: (M, r) => {
    gStones(M, { n: 1, spread: 0, min: 1.5, max: 1.7, upright: true, moss: r() < 0.5 }, r);
    pcyl(M, [-0.42, 0.92, 0], [0.42, 0.92, 0], 0.075, 0.075, 6, CREAM, MAT.MATTE, true, true);
    for (let i = 0; i < 4; i++) pbox(M, -0.3 + i * 0.2, 0.76, 0, 0.035, 0.1, 0.01, 0.2, CREAM, MAT.MATTE);
  },
  fox_statue: (M, r) => gFigure(M, { s: 0.85, col: STONE_L, ears: true, bib: VERMILION, moss: r() < 0.3 }),
  cat_statue: (M, r) => gFigure(M, { s: 0.8, col: CREAM, ears: true, bib: VERMILION, moss: r() < 0.2 }),
  moss_buddha: (M, r) => gFigure(M, { s: 1.35, col: STONE_D, moss: true, hat: r() < 0.4 ? MOSS : null }),
  prayer_cairn: (M, r) => gStones(M, { n: 5 + ((r() * 3) | 0), stack: true, step: 0.22, min: 0.5, max: 0.8, flat: true, moss: true }, r),
  standing_stones: (M, r) => gStones(M, { n: 6, spread: 5.0, min: 2.2, max: 3.4, upright: true, moss: true }, r),
  stone_arch: (M, r) => {
    gArch(M, { span: 3.4, pier: 0.7, spring: 1.9, d: 0.8, thick: 0.42, stone: STONE, stone2: STONE_A, seg: 9 });
    if (r() < 0.6) pball(M, -1.9, 1.2, 0.3, 0.4, 0.16, 0.34, MOSS, MAT.MATTE, 7, 3);
  },

  /* farm */
  barn: (M, r) => {
    gHut(M, { w: 9, d: 6.5, h: 4.2, wall: mixc(RED, WOOD_D, 0.25), roof: SLATE, pitch: 2.0, eave: 0.4, frame: true, frameCol: CREAM, doorX: 0, windows: [-3, 3], lit: r() < 0.35 });
    pbox(M, 0, 2.4, 3.3, 1.5, 2.4, 0.08, 0, WOOD_D, MAT.MATTE);
    pbox(M, 0, 5.6, 3.3, 0.4, 0.5, 0.12, 0, WOOD, MAT.MATTE);
  },
  shed: (M, r) => gHut(M, { w: 2.6, d: 2.2, h: 1.9, wall: WOOD, roof: SLATE, pitch: 0.6, eave: 0.22, frame: true, windows: r() < 0.6 ? [0.85] : null }),
  potting_shed: (M, r) => {
    gHut(M, { w: 2.6, d: 2.4, h: 1.8, wall: WOOD_L, roof: GLASSC, pitch: 0.75, eave: 0.16, frame: true, frameCol: PAINT_W, windows: [-0.8, 0.8], lit: false });
    gPile(M, { rows: 1, per: 4, step: 0.28, w: 0.2, h: 0.24, d: 0.2, jitter: 0.1, yaw: 0.5, cols: [ROOF_B, ROOF_A] }, r);
  },
  grain_silo: (M) => gRound(M, { r: 1.9, h: 7.2, wall: CHROME, band: STONE_D, roofH: 1.5, roof: SLATE, eave: 0.14, seg: 12, door: false }),
  charcoal_kiln: (M, r) => {
    gRound(M, { r: 1.5, h: 1.5, wall: STONE_D, roofH: 1.3, roof: STONE_X, eave: 0.05, seg: 10, taper: 0.75 });
    if (r() < 0.7) pcyl(M, [0, 2.8, 0], [0, 3.3, 0], 0.16, 0.14, 6, STONE_X, MAT.MATTE, false, true);
  },
  hay_bales: (M, r) => gPile(M, { rows: 2, per: 3, step: 1.15, w: 1.05, h: 1.0, d: 0.55, jitter: 0.14, yaw: 0.12, round: 'x', cols: [DRY, THATCH, mixc(DRY, THATCH, 0.5)] }, r),
  hay_cart: (M, r) => {
    gCart(M, { w: 1.8, d: 3.2, bedY: 0.85, bedH: 0.16, sides: 0.55, body: WOOD, wheels: [[-1, 1.0, 0.55, 0.55], [1, 1.0, 0.55, 0.55], [-1, -1.0, 0.45, 0.45], [1, -1.0, 0.45, 0.45]], shafts: 1.2, hub: WOOD_D });
    gPile(M, { rows: 1, per: 3, step: 0.6, w: 0.55, h: 0.5, d: 0.55, jitter: 0.12, yaw: 0.4, cols: [DRY, THATCH] }, r);
  },
  hand_cart: (M) => gCart(M, { w: 1.0, d: 1.5, bedY: 0.5, bedH: 0.12, sides: 0.3, body: WOOD_L, wheels: [[-1, -0.3, 0.36, 0.36], [1, -0.3, 0.36, 0.36]], shafts: 0.9 }),
  scarecrow: (M, r) => {
    pcyl(M, [0, 0, 0], [0, 1.7, 0], 0.06, 0.05, 5, WOOD_D, MAT.MATTE, true, true);
    pbox(M, 0, 1.28, 0, 0.62, 0.04, 0.04, 0, WOOD_D, MAT.MATTE);
    pbox(M, 0, 1.1, 0, 0.24, 0.3, 0.14, 0, r() < 0.5 ? BLUE : ROOF_B, MAT.MATTE);
    pball(M, 0, 1.55, 0, 0.16, 0.17, 0.16, DRY, MAT.MATTE, 7, 3);
    pcyl(M, [0, 1.62, 0], [0, 1.72, 0], 0.34, 0.1, 8, THATCH, MAT.MATTE, true, true);
  },
  beehives: (M, r) => {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 1.1;
      pbox(M, x, 0.12, 0, 0.34, 0.12, 0.3, 0, WOOD_D, MAT.MATTE);
      for (let b = 0; b < 3; b++) pbox(M, x, 0.28 + b * 0.26, 0, 0.3, 0.13, 0.27, 0, b % 2 ? CREAM : PAINT_W, MAT.MATTE);
      pcyl(M, [x, 1.06, 0], [x, 1.2, 0], 0.4, 0.08, 4, r() < 0.5 ? ROOF_A : SLATE, MAT.MATTE, true, true);
    }
  },
  milk_churns: (M, r) => {
    pbox(M, 0, 0.35, 0, 0.9, 0.06, 0.4, 0, WOOD, MAT.MATTE);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) pbox(M, sx * 0.8, 0.17, sz * 0.32, 0.06, 0.17, 0.06, 0, WOOD, MAT.MATTE);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.5 + (r() - 0.5) * 0.08;
      pcyl(M, [x, 0.41, 0], [x, 0.85, 0], 0.16, 0.13, 8, CHROME, MAT.METAL, true, false);
      pcyl(M, [x, 0.85, 0], [x, 0.94, 0], 0.09, 0.1, 8, CHROME, MAT.METAL, false, true);
    }
  },
  water_trough: (M, r) => {
    pbox(M, 0, 0.28, 0, 1.1, 0.28, 0.42, 0, STONE, MAT.MATTE);
    pbox(M, 0, 0.5, 0, 0.98, 0.08, 0.32, 0, LC('wMid'), MAT.GLASS);
    if (r() < 0.5) pball(M, -1.0, 0.16, 0.3, 0.24, 0.1, 0.2, MOSS, MAT.MATTE, 6, 3);
  },
  drystone_wall: (M, r) => gWall(M, { len: 9, h: 1.0, d: 0.5, batter: 0.06, courses: 5, cap: true }, r),
  pasture_fence: (M) => gRunFence(M, { len: 10, h: 1.15, n: 7, rails: [0.4, 0.72, 0.98], post: POST_W, lean: true }),
  wooden_gate: (M) => {
    for (const sx of [-1, 1]) pcyl(M, [sx * 1.6, 0, 0], [sx * 1.6, 1.4, 0], 0.11, 0.1, 6, POST_W, MAT.MATTE, true, true);
    for (const ry of [0.28, 0.52, 0.76, 1.0, 1.22]) pbox(M, 0, ry, 0, 1.55, 0.045, 0.035, 0, PAINT_W, MAT.MATTE);
    pbox(M, 0, 0.75, 0, 1.5, 0.04, 0.03, 0.72, PAINT_W, MAT.MATTE);
  },
  washing_line: (M, r) => {
    for (const sx of [-1, 1]) {
      pcyl(M, [sx * 3.0, 0, 0], [sx * 3.0, 2.0, 0], 0.06, 0.05, 5, WOOD, MAT.MATTE, true, true);
      pbox(M, sx * 3.0, 1.85, 0, 0.22, 0.03, 0.03, 0, WOOD, MAT.MATTE);
    }
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const x = lerp(-2.7, 2.7, t);
      const sag = Math.sin(t * Math.PI) * 0.2;
      const w = 0.16 + r() * 0.1;
      pbox(M, x, 1.85 - sag - 0.22, 0, w, 0.22, 0.012, (r() - 0.5) * 0.16, [CREAM, BLUE, ROOF_B, TEAL][i % 4], MAT.MATTE);
    }
  },
  sunflower_patch: (M, r) => gClump(M, { n: 12, spread: 1.8, min: 0.85, max: 1.25, stalk: true, stalkH: 1.6, stalkR: 0.035, stalkCol: LEAF_D, capR: 0.24, squash: 0.35, capCols: [AMBER, mixc(AMBER, RED, 0.25)] }, r),
  flower_bed: (M, r) => {
    gWall(M, { len: 2.2, h: 0.3, d: 0.34, batter: 0, courses: 2, cap: false }, r);
    gClump(M, { n: 14, spread: 1.0, min: 0.5, max: 0.9, stalk: true, stalkH: 0.42, stalkR: 0.022, stalkCol: LEAF_D, capR: 0.1, squash: 0.9, capCols: [CREAM, VERMILION, AMBER, BLUE, PLASTER] }, r);
  },
  topiary: (M, r) => {
    pcyl(M, [0, 0, 0], [0, 0.5, 0], 0.11, 0.1, 6, WOOD_D, MAT.MATTE, true, false);
    pball(M, 0, 0.95, 0, 0.55, 0.5, 0.55, LEAF, MAT.MATTE, 9, 4);
    pball(M, 0, 1.6 + r() * 0.12, 0, 0.36, 0.34, 0.36, LEAF_L, MAT.MATTE, 8, 4);
  },
  hedge_arch: (M, r) => {
    for (const sx of [-1, 1]) pball(M, sx * 1.35, 0.95, 0, 0.5, 0.95, 0.45, LEAF, MAT.MATTE, 8, 4);
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.1 + 0.8 * (i / 4));
      pball(M, -Math.cos(a) * 1.35, 1.85 + Math.sin(a) * 0.5, 0, 0.34 + r() * 0.05, 0.3, 0.42, i % 2 ? LEAF : LEAF_L, MAT.MATTE, 7, 3);
    }
  },
  tractor: (M, r) => {
    gCart(M, { w: 1.3, d: 2.6, bedY: 0.8, bedH: 0.4, body: r() < 0.5 ? RED : TEAL, cab: 0.55, cabD: 0.9, cabCol: INK, wheels: [[-1, -0.7, 0.72, 0.72], [1, -0.7, 0.72, 0.72], [-1, 0.9, 0.4, 0.4], [1, 0.9, 0.4, 0.4]], hub: CREAM });
    pcyl(M, [0.42, 1.2, 0.7], [0.42, 1.85, 0.7], 0.075, 0.07, 6, INK, MAT.MATTE, true, true);
    pbox(M, 0, 1.35, -0.5, 0.34, 0.04, 0.3, 0.5, INK, MAT.MATTE);
  },
  plough: (M, r) => {
    pbox(M, 0, 0.55, 0, 0.09, 0.07, 1.1, 0, RUST, MAT.MATTE);
    for (let i = 0; i < 3; i++) {
      const z = -0.7 + i * 0.7;
      pbox(M, 0.1, 0.3, z, 0.05, 0.28, 0.07, 0, RUST, MAT.MATTE);
      pball(M, 0.24, 0.12, z, 0.24, 0.1, 0.14, CHROME, MAT.METAL, 6, 3);
    }
    pwheel(M, -0.5, 0.42, 0.9, 0.42, 0.08, RUST, null);
    if (r() < 0.5) pball(M, -0.4, 0.1, -0.7, 0.3, 0.1, 0.24, MOSS, MAT.MATTE, 6, 3);
  },

  /* roadside */
  bus_shelter: (M, r) => {
    gCanopy(M, { w: 2.8, d: 1.5, h: 2.2, eave: 0.16, flat: true, post: PAINT_W, roof: SLATE, back: true, backCol: r() < 0.5 ? PLASTER : WOOD_L, bench: true, benchCol: WOOD });
    pbox(M, 0, 1.45, -0.72, 0.6, 0.4, 0.03, 0, GLASSC, MAT.GLASS);
  },
  bus_stop_sign: (M) => gSign(M, { h: 2.4, r: 0.05, round: true, post: PAINT_W, boards: [[2.15, 0.28, 0.2, CREAM], [1.75, 0.2, 0.12, BLUE]] }),
  bench: (M, r) => {
    for (const sx of [-1, 1]) {
      pbox(M, sx * 0.72, 0.22, 0, 0.06, 0.22, 0.22, 0, r() < 0.5 ? STONE_D : WOOD_D, MAT.MATTE);
      pbox(M, sx * 0.72, 0.62, -0.2, 0.05, 0.24, 0.05, 0, WOOD_D, MAT.MATTE);
    }
    for (let i = 0; i < 3; i++) pbox(M, 0, 0.46, -0.16 + i * 0.16, 0.85, 0.03, 0.06, 0, WOOD_L, MAT.MATTE);
    for (let i = 0; i < 2; i++) pbox(M, 0, 0.68 + i * 0.16, -0.24, 0.85, 0.06, 0.03, 0, WOOD_L, MAT.MATTE);
  },
  picnic_table: (M) => {
    pbox(M, 0, 0.74, 0, 0.85, 0.04, 0.4, 0, WOOD_L, MAT.MATTE);
    for (const sz of [-1, 1]) pbox(M, 0, 0.42, sz * 0.66, 0.85, 0.035, 0.16, 0, WOOD_L, MAT.MATTE);
    for (const sx of [-1, 1]) {
      pbox(M, sx * 0.6, 0.37, 0.3, 0.05, 0.37, 0.05, 0.35, WOOD, MAT.MATTE);
      pbox(M, sx * 0.6, 0.37, -0.3, 0.05, 0.37, 0.05, -0.35, WOOD, MAT.MATTE);
    }
  },
  picnic_shelter: (M) => gCanopy(M, { w: 3.4, d: 3.0, h: 2.2, eave: 0.4, pitch: 0.9, post: WOOD, roof: THATCH, round: true, postR: 0.11, bench: true }),
  phone_box: (M) => gCabinet(M, { w: 0.92, d: 0.9, h: 2.3, body: VERMILION, glazed: true, cap: true, capCol: mixc(VERMILION, INK, 0.3) }),
  vending_machine: (M, r) => gCabinet(M, { w: 1.05, d: 0.62, h: 1.75, body: r() < 0.5 ? BLUE : VERMILION, face: GLOW, faceMat: MAT.EMIT, cap: true }),
  post_box: (M) => gCabinet(M, { w: 0.44, d: 0.44, h: 1.1, body: VERMILION, dome: true, face: INK }),
  letterbox_post: (M) => {
    pcyl(M, [0, 0, 0], [0, 1.1, 0], 0.055, 0.05, 6, WOOD, MAT.MATTE, true, true);
    pbox(M, 0, 1.25, 0, 0.2, 0.13, 0.14, 0, CREAM, MAT.MATTE);
    pcyl(M, [-0.2, 1.32, 0], [0.2, 1.32, 0], 0.13, 0.13, 8, CREAM, MAT.MATTE, false, false);
    pbox(M, 0.21, 1.5, 0, 0.02, 0.1, 0.03, 0, VERMILION, MAT.MATTE);
  },
  notice_board: (M, r) => {
    for (const sx of [-1, 1]) pbox(M, sx * 0.55, 0.75, 0, 0.05, 0.75, 0.05, 0, WOOD, MAT.MATTE);
    pbox(M, 0, 1.35, 0, 0.62, 0.42, 0.05, 0, WOOD_L, MAT.MATTE);
    pbox(M, 0, 1.35, 0.055, 0.55, 0.36, 0.01, 0, CREAM, MAT.MATTE);
    for (let i = 0; i < 4; i++) pbox(M, -0.32 + (i % 2) * 0.36, 1.5 - ((i / 2) | 0) * 0.28, 0.07, 0.13, 0.1, 0.005, (r() - 0.5) * 0.16, PLASTER2, MAT.MATTE);
    proof(M, 0, 1.78, 0, 0.68, 0.12, 0.14, 0, SLATE, MAT.MATTE);
  },
  fingerpost: (M, r) => {
    const arms = 2 + ((r() * 3) | 0);
    gSign(M, { h: 2.6, r: 0.07, round: true, post: PAINT_W, boards: [], finial: true });
    for (let i = 0; i < arms; i++) {
      const y = 2.2 - i * 0.3;
      const yaw = r() * TAU;
      const L = PB();
      pbox(L, 0.44, y, 0, 0.44, 0.075, 0.02, 0, PAINT_W, MAT.MATTE);
      // The pointed end is what makes it a fingerpost rather than a plank.
      pbox(L, 0.88, y, 0, 0.075, 0.055, 0.02, 0.78, PAINT_W, MAT.MATTE);
      blit(M, L, 0, 0, 0, yaw, 1);
    }
  },
  village_sign: (M, r) => {
    for (const sx of [-1, 1]) pcyl(M, [sx * 0.75, 0, 0], [sx * 0.75, 2.0, 0], 0.075, 0.065, 6, WOOD, MAT.MATTE, true, true);
    pbox(M, 0, 1.95, 0, 0.85, 0.05, 0.05, 0, WOOD, MAT.MATTE);
    pbox(M, 0, 1.55, 0, 0.66, 0.33, 0.03, 0, r() < 0.5 ? CREAM : PLASTER, MAT.MATTE);
    pbox(M, 0, 1.55, 0.035, 0.6, 0.27, 0.01, 0, mixc(TEAL, INK, 0.3), MAT.MATTE);
  },
  milestone_big: (M, r) => {
    pbox(M, 0, 0.34, 0, 0.24, 0.34, 0.16, 0, STONE_L, MAT.MATTE);
    pcyl(M, [0, 0.68, 0], [0, 0.78, 0], 0.24, 0.16, 7, STONE_L, MAT.MATTE, false, true);
    pbox(M, 0, 0.42, 0.17, 0.16, 0.16, 0.015, 0, INK, MAT.MATTE);
    if (r() < 0.5) pball(M, 0, 0.1, -0.1, 0.2, 0.08, 0.12, MOSS, MAT.MATTE, 6, 3);
  },
  water_pump: (M) => {
    pbox(M, 0, 0.22, 0, 0.34, 0.22, 0.3, 0, STONE, MAT.MATTE);
    pcyl(M, [0, 0.44, 0], [0, 1.35, 0], 0.11, 0.09, 7, GREENBOX, MAT.METAL, false, true);
    pcyl(M, [0, 1.1, 0], [0, 1.1, 0.34], 0.05, 0.04, 6, GREENBOX, MAT.METAL, false, true);
    pbox(M, -0.28, 1.28, 0, 0.28, 0.035, 0.03, 0.25, GREENBOX, MAT.METAL);
  },
  electrical_cabinet: (M) => gCabinet(M, { w: 0.7, d: 0.42, h: 1.15, body: GREENBOX, cap: true, face: tint(GREENBOX, 1.2) }),
  bicycle: (M, r) => {
    for (const sz of [-1, 1]) pcyl(M, [0, 0.34, sz * 0.52], [0.04, 0.34, sz * 0.52], 0.34, 0.34, 12, INK, MAT.MATTE, false, false);
    pcyl(M, [0.02, 0.34, -0.5], [0.02, 0.62, 0.15], 0.025, 0.025, 5, r() < 0.5 ? TEAL : VERMILION, MAT.MATTE, true, true);
    pcyl(M, [0.02, 0.62, 0.15], [0.02, 0.34, 0.5], 0.025, 0.025, 5, r() < 0.5 ? TEAL : VERMILION, MAT.MATTE, true, true);
    pcyl(M, [0.02, 0.34, 0.5], [0.02, 0.95, 0.42], 0.022, 0.022, 5, INK, MAT.MATTE, true, true);
    pbox(M, 0.02, 0.98, 0.42, 0.16, 0.02, 0.02, 0, INK, MAT.MATTE);
    pbox(M, 0.02, 0.68, 0.05, 0.05, 0.03, 0.12, 0, WOOD_D, MAT.MATTE);
  },
  telegraph_pole: (M) => gPole(M, { h: 7.2, r: 0.13, post: POST_W, arms: [0.86, 0.94], armW: 0.65, arm: WOOD_D }),
  flag_pole: (M, r) => gPole(M, { h: 6.5, r: 0.09, post: PAINT_W, flag: [CREAM, VERMILION, BLUE, TEAL][(r() * 4) | 0] }),
  windsock: (M) => gPole(M, { h: 5.0, r: 0.1, post: PAINT_W, sock: true }),
  bird_house_pole: (M, r) => gPole(M, { h: 1.9, r: 0.05, post: WOOD, box: true, boxCol: r() < 0.5 ? WOOD_L : PLASTER, roof: r() < 0.5 ? ROOF_A : SLATE }),
  weather_vane: (M) => gPole(M, { h: 2.6, r: 0.06, post: WOOD, vane: true }),
  wind_chime_arch: (M, r) => {
    for (const sx of [-1, 1]) pcyl(M, [sx * 1.1, 0, 0], [sx * 1.0, 2.3, 0], 0.07, 0.06, 6, WOOD, MAT.MATTE, true, true);
    pbox(M, 0, 2.3, 0, 1.15, 0.05, 0.05, 0, WOOD, MAT.MATTE);
    for (let i = 0; i < 6; i++) {
      const x = -0.85 + i * 0.34;
      const L = 0.3 + r() * 0.35;
      pcyl(M, [x, 2.25 - L, 0], [x, 2.25, 0], 0.022, 0.022, 5, CHROME, MAT.METAL, true, true);
      pbox(M, x, 2.25 - L - 0.06, 0, 0.05, 0.06, 0.008, 0, CREAM, MAT.MATTE);
    }
  },
  sundial: (M) => {
    pcyl(M, [0, 0, 0], [0, 0.85, 0], 0.18, 0.13, 8, STONE, MAT.MATTE, false, false);
    pcyl(M, [0, 0.85, 0], [0, 0.95, 0], 0.34, 0.34, 10, STONE_L, MAT.MATTE, false, true);
    pbox(M, 0, 1.08, -0.06, 0.02, 0.14, 0.16, 0, CHROME, MAT.METAL);
  },
  stone_steps: (M) => gSteps(M, { n: 5, rise: 0.19, tread: 0.34, w: 1.5 }),
  crate_stack: (M, r) => gPile(M, { rows: 3, per: 3, step: 0.52, w: 0.48, h: 0.44, d: 0.44, jitter: 0.14, yaw: 0.35, cols: [WOOD_L, WOOD, mixc(WOOD, DRY, 0.4)] }, r),
  barrel_stack: (M, r) => gPile(M, { rows: 2, per: 3, step: 0.62, w: 0.56, h: 0.78, d: 0.56, jitter: 0.1, yaw: 0, round: 'y', taper: 0.88, cols: [WOOD_D, WOOD, RUST] }, r),
  market_stall: (M, r) => {
    gCanopy(M, { w: 2.4, d: 1.6, h: 2.0, eave: 0.3, pitch: 0.35, post: WOOD, roof: r() < 0.5 ? VERMILION : TEAL, round: true, postR: 0.06 });
    pbox(M, 0, 0.85, 0, 1.1, 0.05, 0.7, 0, WOOD_L, MAT.MATTE);
    pbox(M, 0, 0.45, -0.6, 1.1, 0.45, 0.05, 0, WOOD, MAT.MATTE);
    gPile(M, { rows: 1, per: 3, step: 0.6, w: 0.22, h: 0.2, d: 0.2, jitter: 0.1, yaw: 0.4, cols: [ROOF_B, LEAF, AMBER] }, r);
  },

  /* dwellings */
  cottage: (M, r) => gHut(M, { w: 5.4, d: 4.2, h: 2.6, wall: r() < 0.5 ? PLASTER : PLASTER2, roof: THATCH, pitch: 1.9, eave: 0.42, plinth: 0.2, plinthCol: STONE_D, frame: true, chimney: true, windows: [-1.5, 1.5], lit: true, porch: r() < 0.5 }),
  log_cabin: (M, r) => {
    gHut(M, { w: 4.4, d: 3.6, h: 2.3, wall: WOOD, roof: SLATE, pitch: 1.5, eave: 0.5, frame: false, chimney: true, chimCol: STONE, windows: [-1.2, 1.2], lit: r() < 0.7 });
    // Log courses: the reason it reads as logs and not planks.
    for (let i = 0; i < 6; i++) pcyl(M, [-2.3, 0.2 + i * 0.38, 1.8], [2.3, 0.2 + i * 0.38, 1.8], 0.19, 0.19, 6, i % 2 ? WOOD : WOOD_L, MAT.MATTE, true, true);
  },
  tea_house: (M, r) => {
    gHut(M, { w: 3.4, d: 3.0, h: 2.1, wall: PLASTER, roof: SLATE, pitch: 1.15, eave: 0.75, plinth: 0.45, plinthCol: WOOD_D, frame: true, frameCol: WOOD_D, windows: [-0.9, 0.9], lit: true, door: false });
    pbox(M, 0, 1.05, 1.55, 0.5, 0.9, 0.04, 0, GLOW, MAT.EMIT);
    if (r() < 0.6) {
      const L = PB();
      gLantern(L, { s: 0.7, col: STONE, col2: STONE_D });
      blit(M, L, 2.1, 0, 1.6, 0, 1);
    }
  },
  chapel: (M) => {
    gHut(M, { w: 3.4, d: 5.0, h: 2.8, wall: PLASTER2, roof: SLATE, pitch: 1.7, eave: 0.3, plinth: 0.25, plinthCol: STONE_D, frame: false, windows: [-1.0, 1.0], lit: true });
    pbox(M, 0, 3.4, -2.2, 0.55, 1.4, 0.55, 0, PLASTER2, MAT.MATTE);
    pcyl(M, [0, 4.8, -2.2], [0, 6.2, -2.2], 0.75, 0.05, 6, SLATE, MAT.MATTE, true, true);
    pbox(M, 0, 1.7, 2.55, 0.28, 0.5, 0.03, 0, GLOW, MAT.EMIT);
  },
  dovecote: (M, r) => {
    gRound(M, { r: 1.2, h: 3.2, wall: PLASTER, roofH: 1.2, roof: SLATE, eave: 0.3, seg: 10, taper: 0.9 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      pbox(M, Math.cos(a) * 1.08, 2.3 + (i % 2) * 0.35, Math.sin(a) * 1.08, 0.1, 0.1, 0.1, -a, INK, MAT.MATTE);
    }
    if (r() < 0.5) pball(M, 0, 4.5, 0, 0.14, 0.16, 0.2, CREAM, MAT.MATTE, 6, 3);
  },
  gazebo: (M) => {
    gCanopy(M, { w: 3.0, d: 3.0, h: 2.3, eave: 0.45, pitch: 1.0, post: PAINT_W, roof: SLATE, round: true, postR: 0.1, bench: true, benchCol: PAINT_W });
    pbox(M, 0, 0.1, 0, 1.7, 0.1, 1.7, 0, WOOD_L, MAT.MATTE);
  },
  bandstand: (M) => {
    pcyl(M, [0, 0, 0], [0, 0.55, 0], 2.3, 2.3, 10, STONE_L, MAT.MATTE, false, true);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      pcyl(M, [Math.cos(a) * 2.0, 0.55, Math.sin(a) * 2.0], [Math.cos(a) * 2.0, 3.0, Math.sin(a) * 2.0], 0.09, 0.08, 6, PAINT_W, MAT.MATTE, true, true);
    }
    pcyl(M, [0, 3.0, 0], [0, 4.1, 0], 2.5, 0.2, 10, SLATE, MAT.MATTE, true, true);
    pcyl(M, [0, 4.1, 0], [0, 4.5, 0], 0.12, 0.04, 5, CHROME, MAT.METAL, true, true);
  },
  yurt: (M) => {
    gRound(M, { r: 2.2, h: 1.5, wall: CREAM, roofH: 1.1, roof: PLASTER2, eave: 0.12, seg: 12, band: mixc(VERMILION, AMBER, 0.4) });
    pcyl(M, [0, 2.6, 0], [0, 2.85, 0], 0.3, 0.3, 8, WOOD_D, MAT.MATTE, false, false);
  },
  signal_box: (M) => {
    gHut(M, { w: 2.6, d: 2.0, h: 1.4, wall: WOOD_D, roof: SLATE, pitch: 0.5, eave: 0.35, plinth: 1.4, plinthCol: mixc(WOOD_D, INK, 0.4), door: false, frame: true, frameCol: CREAM });
    for (const sz of [1, -1]) pbox(M, 0, 2.2, sz * 1.02, 1.15, 0.5, 0.04, 0, GLOW, MAT.EMIT);
    pbox(M, 1.4, 1.1, 0, 0.06, 1.1, 0.5, 0, WOOD_D, MAT.MATTE);
  },
  clock_tower: (M) => gTower(M, { r: 1.3, rTop: 1.05, h: 10.5, tiers: 3, seg: 8, wall: STONE_A, band: STONE, cap: 1.9, roof: SLATE, gallery: true, galleryCol: STONE_D, clock: true }),
  water_tower: (M) => {
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      pcyl(M, [sx * 1.5, 0, sz * 1.5], [sx * 0.85, 8.5, sz * 0.85], 0.14, 0.11, 5, RUST, MAT.MATTE, true, true);
    }
    for (const y of [2.5, 5.5]) for (const [ax, az] of [[1, 0], [0, 1]]) {
      pbox(M, ax ? 0 : 1.2, y, az ? 0 : 1.2, ax ? 1.3 : 0.05, 0.05, az ? 1.3 : 0.05, 0, RUST, MAT.MATTE);
    }
    pcyl(M, [0, 8.5, 0], [0, 12.4, 0], 2.1, 2.1, 12, mixc(CHROME, TEAL, 0.3), MAT.METAL, true, false);
    pcyl(M, [0, 12.4, 0], [0, 13.4, 0], 2.2, 0.1, 12, SLATE, MAT.MATTE, true, true);
  },
  windmill: (M, r) => {
    gTower(M, { r: 2.3, rTop: 1.5, h: 8.5, tiers: 3, seg: 10, wall: PLASTER, band: PLASTER2 });
    pcyl(M, [0, 8.5, 0], [0, 10.3, 0], 1.7, 0.6, 10, SLATE, MAT.MATTE, true, true);
    // Four sails on a hub, tilted the way a real cap-mill's shaft is.
    const hub = [0, 9.1, 1.6];
    pcyl(M, [0, 9.1, 1.2], hub, 0.2, 0.16, 6, WOOD_D, MAT.MATTE, true, true);
    const spin = r() * TAU;
    for (let i = 0; i < 4; i++) {
      const a = spin + (i / 4) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pcyl(M, hub, [ca * 4.4, 9.1 + sa * 4.4, 1.7], 0.09, 0.06, 5, WOOD_D, MAT.MATTE, true, true);
      for (let j = 1; j <= 4; j++) {
        const t = j / 4.6;
        pbox(M, ca * 4.4 * t, 9.1 + sa * 4.4 * t, 1.78, 0.42, 0.42, 0.02, a, CREAM, MAT.MATTE);
      }
    }
  },
  watermill: (M, r) => {
    gHut(M, { w: 4.2, d: 3.4, h: 3.0, wall: PLASTER, roof: SLATE, pitch: 1.5, eave: 0.4, plinth: 0.3, plinthCol: STONE, frame: true, frameCol: WOOD_D, windows: [-1.1, 1.1], lit: true });
    // The wheel, on the flank, where the leat would run.
    const cx = 2.5;
    pcyl(M, [cx - 0.35, 1.6, 0], [cx + 0.35, 1.6, 0], 1.55, 1.55, 12, WOOD_D, MAT.MATTE, false, false);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      pbox(M, cx, 1.6 + Math.sin(a) * 1.5, Math.cos(a) * 1.5, 0.36, 0.16, 0.06, 0, i % 3 ? WOOD_L : WOOD, MAT.MATTE);
    }
    if (r() < 0.7) pball(M, cx, 0.4, 1.2, 0.5, 0.16, 0.4, MOSS, MAT.MATTE, 7, 3);
  },
  lighthouse: (M) => gTower(M, { r: 2.0, rTop: 1.25, h: 12.5, tiers: 4, seg: 12, wall: CREAM, band: VERMILION, gallery: true, galleryCol: INK, lamp: 1.6, cap: 1.2, roof: INK }),
  mooring_mast: (M) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU;
      pcyl(M, [Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5], [0, 16.0, 0], 0.16, 0.06, 5, RUST, MAT.MATTE, true, true);
    }
    for (const y of [4, 8, 12]) {
      const rr = 1.5 * (1 - y / 17);
      pcyl(M, [rr, y, 0], [-rr * 0.5, y, rr * 0.87], 0.05, 0.05, 4, RUST, MAT.MATTE, true, true);
      pcyl(M, [-rr * 0.5, y, rr * 0.87], [-rr * 0.5, y, -rr * 0.87], 0.05, 0.05, 4, RUST, MAT.MATTE, true, true);
      pcyl(M, [-rr * 0.5, y, -rr * 0.87], [rr, y, 0], 0.05, 0.05, 4, RUST, MAT.MATTE, true, true);
    }
    pcyl(M, [0, 16.0, 0], [0, 17.2, 0], 0.35, 0.22, 8, CHROME, MAT.METAL, true, true);
    pball(M, 0, 17.4, 0, 0.2, 0.2, 0.2, GLOW, MAT.EMIT, 6, 3);
  },

  /* ruins */
  ruined_tower: (M, r) => {
    gTower(M, { r: 1.7, rTop: 1.45, h: 5.5, tiers: 3, seg: 9, wall: STONE_D, band: STONE });
    // The broken crown: a ring of stubs at falling heights is what says "ruin" instantly.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const hh = 0.15 + r() * 1.1;
      pbox(M, Math.cos(a) * 1.4, 5.5 + hh * 0.5, Math.sin(a) * 1.4, 0.34, hh * 0.5, 0.3, -a, i % 2 ? STONE_D : STONE_X, MAT.MATTE);
    }
    gStones(M, { n: 4, spread: 2.6, min: 0.4, max: 0.8, moss: true }, r);
  },
  ruined_wall: (M, r) => {
    gWall(M, { len: 6, h: 1.6, d: 0.7, batter: 0.1, courses: 7, cap: false }, r);
    for (let i = 0; i < 3; i++) pbox(M, -2 + i * 2 + r(), 1.7 + r() * 0.7, 0, 0.3, 0.5, 0.3, r(), STONE_D, MAT.MATTE);
    gStones(M, { n: 5, spread: 2.4, min: 0.3, max: 0.7, moss: true }, r);
  },
  rusted_truck: (M, r) => {
    gCart(M, { w: 1.9, d: 4.2, bedY: 1.0, bedH: 0.5, sides: 0.4, body: RUST, cab: 0.9, cabD: 1.3, cabCol: mixc(RUST, TEAL, 0.35), wheels: [[-1, -1.2, 0.5, 0.5], [1, -1.2, 0.5, 0.5], [-1, 1.3, 0.5, 0.5], [1, 1.3, 0.5, 0.5]], hub: RUST });
    // What makes it cozy rather than grim: it has been reclaimed, not abandoned.
    pball(M, 0, 1.6, -0.6, 0.8, 0.3, 0.9, MOSS, MAT.MATTE, 8, 3);
    if (r() < 0.6) gClump(M, { n: 4, spread: 0.9, min: 0.5, max: 0.9, stalk: true, stalkH: 0.5, stalkR: 0.02, stalkCol: LEAF_D, capR: 0.12, capCols: [CREAM, AMBER] }, r);
  },
  caravan: (M, r) => {
    gCart(M, { w: 2.0, d: 3.4, bedY: 1.2, bedH: 0.85, body: r() < 0.5 ? CREAM : mixc(TEAL, CREAM, 0.5), wheels: [[-1, -0.4, 0.42, 0.42], [1, -0.4, 0.42, 0.42]], hub: CHROME });
    pcyl(M, [-2.0, 2.05, 0], [2.0, 2.05, 0], 1.0, 1.0, 8, PLASTER, MAT.MATTE, false, false);
    for (const sz of [1, -1]) pbox(M, 0, 1.55, sz * 1.68, 0.5, 0.3, 0.04, 0, GLOW, MAT.EMIT);
    pcyl(M, [0, 0.5, 1.9], [0, 0.2, 2.6], 0.05, 0.05, 5, INK, MAT.MATTE, true, true);
    if (r() < 0.6) pbox(M, 1.5, 1.2, -1.0, 0.6, 0.02, 0.02, 0.2, CREAM, MAT.MATTE); // an awning line
  },
  rail_trolley: (M, r) => {
    for (const sx of [-1, 1]) pbox(M, sx * 0.72, 0.09, 0, 0.06, 0.09, 3.0, 0, RUST, MAT.MATTE);
    for (let i = 0; i < 9; i++) pbox(M, 0, 0.05, -2.7 + i * 0.7, 1.05, 0.05, 0.14, 0, WOOD_D, MAT.MATTE);
    gCart(M, { w: 1.3, d: 1.5, bedY: 0.55, bedH: 0.14, sides: 0.28, body: WOOD, wheels: [[-1, -0.5, 0.24, 0.24], [1, -0.5, 0.24, 0.24], [-1, 0.5, 0.24, 0.24], [1, 0.5, 0.24, 0.24]], hub: RUST });
    pcyl(M, [0, 0.7, 0], [0, 1.25, 0], 0.05, 0.05, 5, RUST, MAT.MATTE, true, true);
    pbox(M, 0, 1.25 + (r() - 0.5) * 0.1, 0, 0.5, 0.045, 0.045, 0, RUST, MAT.MATTE);
  },

  /* water's edge */
  jetty: (M, r) => {
    for (let i = 0; i < 5; i++) {
      const z = -2.4 + i * 1.2;
      for (const sx of [-1, 1]) pcyl(M, [sx * 0.75, -0.6, z], [sx * 0.75, 0.42, z], 0.1, 0.09, 6, WOOD_D, MAT.MATTE, true, true);
    }
    for (let i = 0; i < 7; i++) pbox(M, 0, 0.48, -2.7 + i * 0.9, 0.85, 0.045, 0.4, 0, i % 2 ? WOOD_L : WOOD, MAT.MATTE);
    if (r() < 0.5) gRunFence(M, { len: 5.4, h: 0.9, n: 4, rails: [0.75], post: WOOD_D });
  },
  rowboat: (M, r) => {
    gBoat(M, { len: 3.6, beam: 0.72, depth: 0.5, hull: r() < 0.5 ? PAINT_W : TEAL, inner: WOOD_L, thwarts: true });
    pcyl(M, [0.5, 0.55, -0.6], [-0.4, 0.2, 1.4], 0.04, 0.06, 5, WOOD, MAT.MATTE, true, true);
  },
  upturned_boat: (M, r) => {
    const L = PB();
    gBoat(L, { len: 3.4, beam: 0.7, depth: 0.5, hull: r() < 0.5 ? mixc(TEAL, WOOD_D, 0.4) : WOOD_D, upturned: true });
    // Turn it over: mirror in Y by hand, since blit only rotates about Y.
    for (let i = 0; i < L.n; i++) {
      L.pos[i * 3 + 1] = 0.55 - L.pos[i * 3 + 1];
      L.nrm[i * 3 + 1] = -L.nrm[i * 3 + 1];
    }
    blit(M, L, 0, 0, 0, 0, 1);
    if (r() < 0.6) pball(M, 0.3, 0.6, -0.4, 0.4, 0.1, 0.5, MOSS, MAT.MATTE, 7, 3);
  },
  fishing_hut: (M, r) => {
    gHut(M, { w: 2.4, d: 2.0, h: 1.9, wall: WOOD_D, roof: RUST, pitch: 0.5, eave: 0.3, plinth: 0.5, plinthCol: WOOD_D, frame: true, windows: [0.6], lit: r() < 0.6 });
    for (let i = 0; i < 3; i++) pbox(M, -1.2, 1.2 + i * 0.3, 1.05, 0.03, 0.12, 0.3, 0.3, CREAM, MAT.MATTE);
  },
  boathouse: (M) => {
    gHut(M, { w: 3.6, d: 4.4, h: 2.2, wall: WOOD, roof: SLATE, pitch: 1.1, eave: 0.45, plinth: 0.35, plinthCol: WOOD_D, door: false, frame: true });
    pbox(M, 0, 1.0, 2.24, 1.1, 1.0, 0.06, 0, INK, MAT.MATTE);
    for (const sx of [-1, 1]) pcyl(M, [sx * 1.9, -0.7, 2.6], [sx * 1.9, 0.4, 2.6], 0.12, 0.1, 6, WOOD_D, MAT.MATTE, true, true);
  },
  crab_pots: (M, r) => gPile(M, { rows: 2, per: 3, step: 0.62, w: 0.55, h: 0.4, d: 0.5, jitter: 0.16, yaw: 0.6, cols: [mixc(WOOD_D, INK, 0.3), WOOD_D, RUST] }, r),
  buoy_cluster: (M, r) => {
    for (let i = 0; i < 5; i++) {
      const a = r() * TAU;
      const dd = Math.pow(r(), 0.6) * 0.9;
      const s = 0.22 + r() * 0.14;
      pball(M, Math.cos(a) * dd, s * 0.9, Math.sin(a) * dd, s, s * 1.15, s, [VERMILION, CREAM, AMBER, TEAL][(r() * 4) | 0], MAT.MATTE, 8, 4);
      pcyl(M, [Math.cos(a) * dd, s * 2.0, Math.sin(a) * dd], [Math.cos(a) * dd, s * 2.4, Math.sin(a) * dd], 0.025, 0.025, 4, INK, MAT.MATTE, true, true);
    }
  },

  /* wild */
  giant_mushrooms: (M, r) => gClump(M, { n: 5, spread: 1.4, min: 0.7, max: 1.5, stalk: true, stalkH: 0.85, stalkR: 0.14, stalkCol: CREAM, capR: 0.55, squash: 0.55, gills: true, capCols: [VERMILION, mixc(VERMILION, AMBER, 0.4), mixc(CREAM, WOOD_L, 0.4)] }, r),
  giant_acorn: (M, r) => {
    pball(M, 0, 0.85, 0, 0.72, 0.9, 0.72, mixc(WOOD_L, DRY, 0.4), MAT.MATTE, 9, 5);
    pcyl(M, [0, 1.35, 0], [0, 1.72, 0], 0.76, 0.5, 9, WOOD_D, MAT.MATTE, false, true);
    pcyl(M, [0, 1.72, 0], [0, 2.0, 0], 0.09, 0.06, 5, WOOD_D, MAT.MATTE, true, true);
    if (r() < 0.5) pball(M, 0.5, 0.35, 0.3, 0.3, 0.12, 0.26, MOSS, MAT.MATTE, 6, 3);
  },
  bamboo_clump: (M, r) => {
    for (let i = 0; i < 11; i++) {
      const a = r() * TAU;
      const dd = Math.pow(r(), 0.5) * 1.1;
      const h = 3.4 + r() * 2.6;
      const x = Math.cos(a) * dd;
      const z = Math.sin(a) * dd;
      const lean = (r() - 0.5) * 0.5;
      pcyl(M, [x, 0, z], [x + lean, h, z + lean * 0.6], 0.055, 0.038, 5, i % 3 ? LEAF : LEAF_L, MAT.MATTE, true, true);
      for (let j = 0; j < 3; j++) {
        const t = 0.55 + j * 0.15;
        pball(M, x + lean * t, h * t, z + lean * 0.6 * t, 0.28, 0.08, 0.28, LEAF_L, MAT.MATTE, 6, 3);
      }
    }
  },
  tree_stump_axe: (M, r) => {
    pcyl(M, [0, 0, 0], [0, 0.62, 0], 0.5, 0.44, 9, WOOD_D, MAT.MATTE, false, true);
    pcyl(M, [0, 0.62, 0], [0, 0.64, 0], 0.42, 0.42, 9, WOOD_L, MAT.MATTE, false, true);
    pcyl(M, [0.1, 0.6, 0.05], [-0.35, 1.35, -0.1], 0.035, 0.03, 5, WOOD, MAT.MATTE, true, true);
    pbox(M, -0.36, 1.36, -0.1, 0.13, 0.1, 0.04, 0.5, CHROME, MAT.METAL);
    if (r() < 0.6) pball(M, 0.42, 0.2, 0.2, 0.3, 0.12, 0.26, MOSS, MAT.MATTE, 6, 3);
  },
  fallen_log: (M, r) => {
    pcyl(M, [-2.4, 0.42, 0], [2.6, 0.34, 0.2], 0.42, 0.34, 9, WOOD_D, MAT.MATTE, true, true);
    for (let i = 0; i < 3; i++) {
      const t = -1.6 + i * 1.5;
      pcyl(M, [t, 0.5, 0], [t + (r() - 0.5), 0.9 + r() * 0.4, (r() - 0.5) * 0.8], 0.08, 0.04, 5, WOOD_D, MAT.MATTE, true, true);
    }
    pball(M, 0.3, 0.66, 0.1, 1.3, 0.16, 0.34, MOSS, MAT.MATTE, 9, 3);
  },
  log_pile: (M, r) => gPile(M, { rows: 3, per: 4, step: 0.42, w: 1.5, h: 0.4, d: 0.4, jitter: 0.06, yaw: 0, round: 'x', cols: [WOOD_D, WOOD, WOOD_L] }, r),
  erratic_boulder: (M, r) => {
    gStones(M, { n: 1, spread: 0, min: 2.4, max: 3.0, moss: true }, r);
    gStones(M, { n: 3, spread: 2.2, min: 0.4, max: 0.9, moss: true }, r);
  },
};

/* ── the petrol station ───────────────────────────────────────────────────────
 * Built as one piece because it is one place. The brief is the important part: this is a
 * REASON TO STOP somewhere pretty, not a fail state and not a chore. So it is small, warm
 * and open — a canopy, two pumps, a lit kiosk, an air line, a bench under a tree's worth of
 * shade — and it never has a barrier, a queue or a price.
 *
 * `skirt` is how far the apron slab is dropped below its top face. The forecourt is graded
 * level with the ROAD (a real one is), so on anything but dead-flat ground one edge would
 * otherwise show daylight underneath.
 */
/* ── A HARBOUR ───────────────────────────────────────────────────────────────
 * Operator: "buying a boat ... isn't automatic, but something you get at the harbor. So you're going
 * to have to build a harbor."
 *
 * Modelled in code, like every other prop in this file. The Synty POLYGON packs on the household
 * share were offered for this and cannot be used: proprietary EULA, and this repo is public (see the
 * note by harbourForCell in world/props.js).
 *
 * What a harbour has to say from a distance is "boats are bought here", so: a stone quay out over
 * the water with mooring bollards and a rope line, a crane on the quay head, stacked crates and
 * barrels, a harbourmaster's hut, and a moored boat. Local axes: +Z runs out along the quay, away
 * from the shore, and +X across it.
 */
export function buildHarbour(M, r, h, skirt) {
  const Q = h.quay || 46;
  const W = h.halfWid || 11;
  const drop = Math.max(1.2, skirt);

  /* The quay: a slab from the shore out over the water, on stone piers. The slab's top face is at
   * y=0 in local space (blit puts it at h.y, just clear of the water) and the skirt reaches down
   * past the sea bed so no edge floats. */
  pbox(M, 0, -drop * 0.5, Q * 0.5, W, drop * 0.5, Q * 0.5, 0, STONE, MAT.MATTE);
  pbox(M, 0, 0.01, Q * 0.5, W - 0.6, 0.02, Q * 0.5 - 0.6, 0, STONE_L, MAT.MATTE);
  // piers under the outer half, so it reads as standing in water rather than as a wall of rock
  for (let k = 0; k < 4; k++) {
    const z = Q * 0.35 + (k / 3) * Q * 0.55;
    for (const sx of [-1, 1]) {
      pcyl(M, [sx * (W - 1.6), -drop, z], [sx * (W - 1.6), 0, z], 0.62, 0.7, 8, WOOD_D, MAT.MATTE, false, false);
    }
  }

  /* MOORING BOLLARDS down both edges, with a rope slung between them. The rope is what makes it a
   * working quay rather than a jetty. */
  for (let k = 0; k <= 5; k++) {
    const z = 3 + (k / 5) * (Q - 6);
    for (const sx of [-1, 1]) {
      pcyl(M, [sx * (W - 1.1), 0, z], [sx * (W - 1.1), 0.78, z], 0.24, 0.3, 8, INK, MAT.MATTE, false, false);
      if (k < 5) {
        const z2 = 3 + ((k + 1) / 5) * (Q - 6);
        pbox(M, sx * (W - 1.1), 0.58, (z + z2) * 0.5, 0.05, 0.05, (z2 - z) * 0.5, 0, WOOD, MAT.MATTE);
      }
    }
  }

  /* THE CRANE on the quay head — the tallest thing here and the one that says "harbour" at range. */
  {
    const cz = Q - 7;
    pbox(M, -W + 3.4, 0.5, cz, 1.6, 0.5, 1.6, 0, INK, MAT.MATTE);
    pcyl(M, [-W + 3.4, 0.9, cz], [-W + 3.4, 9.4, cz], 0.42, 0.34, 8, VERMILION, MAT.MATTE, false, false);
    // the jib, out over the water
    pbox(M, -W + 3.4 + 3.2, 9.2, cz, 3.4, 0.22, 0.3, 0, VERMILION, MAT.MATTE);
    pbox(M, -W + 3.4 - 1.2, 9.2, cz, 1.3, 0.2, 0.28, 0, VERMILION, MAT.MATTE); // counterjib
    // and the hook line, hanging
    pbox(M, -W + 3.4 + 6.2, 6.6, cz, 0.045, 2.6, 0.045, 0, INK, MAT.MATTE);
    pbox(M, -W + 3.4 + 6.2, 4.1, cz, 0.3, 0.3, 0.3, 0, INK, MAT.MATTE);
  }

  /* THE HARBOURMASTER'S HUT, at the landward end, and the crates and barrels around it. */
  {
    const hz = 5.5;
    pbox(M, W - 3.6, 1.5, hz, 2.3, 1.5, 2.1, 0, PLASTER, MAT.MATTE);
    pbox(M, W - 3.6, 3.25, hz, 2.6, 0.3, 2.4, 0, ROOF_B, MAT.MATTE);
    pbox(M, W - 3.6, 1.5, hz - 2.15, 0.7, 0.9, 0.06, 0, WOOD_D, MAT.MATTE); // door
    pbox(M, W - 5.1, 1.9, hz, 0.05, 0.5, 0.6, 0, GLASSC, MAT.GLASS); // window
  }
  for (const [bx, bz, bh] of [
    [-W + 2.6, 9.5, 0],
    [-W + 2.6, 11.2, 0],
    [-W + 2.6, 10.3, 1],
    [W - 3.2, 13.5, 0],
    [W - 4.6, 13.9, 0],
  ]) {
    pbox(M, bx, 0.55 + bh * 1.05, bz, 0.52, 0.52, 0.52, r() * 0.4, WOOD, MAT.MATTE);
  }
  for (const [bx, bz] of [
    [W - 2.4, 17.5],
    [W - 3.5, 18.4],
    [-W + 2.4, 16.0],
  ]) {
    pcyl(M, [bx, 0, bz], [bx, 0.9, bz], 0.34, 0.34, 10, WOOD_D, MAT.MATTE, false, false);
  }

  /* A MOORED BOAT alongside — hull, cabin, mast — so what is sold here is obvious before anyone
   * reads a word of HUD text. */
  {
    const bx = W + 3.2;
    const bz = Q * 0.62;
    pbox(M, bx, -0.5, bz, 1.5, 0.55, 4.2, 0, CREAM, MAT.MATTE); // hull
    pbox(M, bx, 0.1, bz, 1.6, 0.14, 4.3, 0, WOOD, MAT.MATTE); // deck
    pbox(M, bx, 0.7, bz - 0.9, 0.9, 0.62, 1.2, 0, PLASTER, MAT.MATTE); // cabin
    pbox(M, bx, 0.95, bz - 0.9, 0.95, 0.08, 1.25, 0, ROOF_A, MAT.MATTE);
    pcyl(M, [bx, 0.2, bz + 0.6], [bx, 4.4, bz + 0.6], 0.09, 0.07, 6, CREAM, MAT.MATTE, false, false); // mast
  }

  /* AND THE BEACON, the same device the stations and airfields use: an EMIT column, unlit by the
   * sun, so a harbour can be seen from far enough away to be worth driving to. Blue-white here
   * rather than warm — it is a light over water. */
  {
    const H = 70;
    for (let i = 0; i < 3; i++) {
      const y0 = 4 + (H * i) / 3;
      const y1 = 4 + (H * (i + 1)) / 3;
      const r0 = 0.62 * (1 - i / 3) + 0.1;
      const r1 = 0.62 * (1 - (i + 1) / 3) + 0.1;
      pcyl(M, [W - 3.6, y0, 5.5], [W - 3.6, y1, 5.5], r0, r1, 4, GLOW, MAT.EMIT, false, false);
    }
  }
}

/* ── AN AIRFIELD ─────────────────────────────────────────────────────────────
 * Operator: "place airports out 500m from roads randomly with a few things near by for people to
 * be able to see it".
 *
 * "A few things near by" is the requirement that matters, and it is why this is not just a grey
 * rectangle: an airstrip in open grass with nothing beside it reads as a texture bug from any
 * distance. So it gets the silhouette an airfield actually has — a hangar with an arched roof, a
 * windsock on a pole, runway threshold bars, and a parked light aircraft — which together say
 * "aviation" from far enough away to be worth driving to.
 *
 * Local axes: +Z is down the runway, +X across it. `blit` in _bake rotates the lot to the strip's
 * own heading, exactly as it does for a station.
 */
export function buildAirfield(M, r, f, skirt) {
  const L = f.halfLen;
  const W = f.halfWid;
  const drop = Math.max(0.4, skirt);

  // the strip itself, and a skirt down into the ground so no edge floats
  pbox(M, 0, -drop * 0.5, 0, W, drop * 0.5, L, 0, TARMAC, MAT.MATTE);
  pbox(M, 0, 0.006, 0, W - 0.5, 0.01, L - 0.5, 0, TARMAC_D, MAT.MATTE);

  // centreline dashes, and threshold bars at both ends — the markings that read as a RUNWAY
  const dashes = Math.max(6, Math.round(L / 26));
  for (let i = -dashes; i <= dashes; i++) {
    pbox(M, 0, 0.02, (i / dashes) * (L - 12), 0.55, 0.012, 5.5, 0, LINE, MAT.MATTE);
  }
  for (const end of [-1, 1]) {
    for (let b = -3; b <= 3; b++) {
      pbox(M, b * 2.6, 0.02, end * (L - 4), 0.85, 0.012, 3.2, 0, LINE, MAT.MATTE);
    }
  }

  /* THE HANGAR, off to one side. An arched roof out of a few boxes rather than a curve: the same
   * "modelled in code, no imported mesh" rule the hundred roadside props follow. */
  const hx = W + 16;
  const hz = -L * 0.45;
  pbox(M, hx, 3.1, hz, 8.5, 3.1, 6.5, 0, PLASTER, MAT.MATTE);
  for (let k = 0; k < 5; k++) {
    const t = (k + 0.5) / 5;
    const y = 6.2 + Math.sin(t * Math.PI) * 2.6;
    const w = 8.5 * Math.cos((t - 0.5) * 1.1);
    pbox(M, hx, y, hz, Math.max(1.2, w), 0.42, 6.7, 0, ROOF_A, MAT.MATTE);
  }
  // the open doorway, facing the strip
  pbox(M, hx, 2.6, hz + 6.6, 5.2, 2.6, 0.2, 0, INK, MAT.MATTE);

  /* THE WINDSOCK. Small, and the one thing here that is unmistakably an aerodrome. */
  const wx = -W - 7;
  pcyl(M, [wx, 0, 0], [wx, 6.2, 0], 0.14, 0.12, 7, CREAM, MAT.MATTE, false, false);
  for (let k = 0; k < 3; k++) {
    const t = k / 3;
    pbox(M, wx + 0.9 + t * 2.4, 5.6 - t * 0.5, 0, 0.62, 0.5 - t * 0.12, 0.5 - t * 0.12, 0, k % 2 ? CREAM : VERMILION, MAT.MATTE);
  }

  /* A PARKED AEROPLANE beside the hangar — high wing, tail fin, three wheels. Rough on purpose;
   * it is a silhouette at two hundred metres, and it is what makes the whole thing legible. */
  const px = W + 6;
  const pz = -L * 0.2;
  pbox(M, px, 1.5, pz, 0.85, 0.7, 3.6, 0, CREAM, MAT.MATTE); // fuselage
  pbox(M, px, 2.35, pz + 0.3, 6.4, 0.16, 1.05, 0, CREAM, MAT.MATTE); // wing
  pbox(M, px, 2.1, pz - 3.2, 0.12, 0.95, 0.8, 0, VERMILION, MAT.MATTE); // fin
  pbox(M, px, 1.5, pz - 3.1, 1.7, 0.12, 0.55, 0, CREAM, MAT.MATTE); // tailplane
  pcyl(M, [px - 0.06, 1.62, pz + 2.0], [px + 0.06, 1.62, pz + 2.0], 0.5, 0.5, 8, INK, MAT.MATTE, false, false); // prop disc
  for (const [ox, oz] of [[-1.1, 0.4], [1.1, 0.4], [0, -2.6]]) {
    pcyl(M, [px + ox - 0.07, 0.34, pz + oz], [px + ox + 0.07, 0.34, pz + oz], 0.34, 0.34, 8, TYRE, MAT.MATTE, false, false);
  }

  /* AND A BEACON, the same trick the petrol stations use: an EMIT column, unlit by the sun, so an
   * airfield is visible from outside its own draw distance. Taller than a station's, because this
   * one is 500 m off the road and has to be seen from the road. */
  {
    const H = 90;
    for (let i = 0; i < 3; i++) {
      const y0 = 8 + (H * i) / 3;
      const y1 = 8 + (H * (i + 1)) / 3;
      const r0 = 0.7 * (1 - i / 3) + 0.1;
      const r1 = 0.7 * (1 - (i + 1) / 3) + 0.1;
      pcyl(M, [hx, y0, hz], [hx, y1, hz], r0, r1, 4, GLOW, MAT.EMIT, false, false);
    }
  }
}


/* ── the cars standing on a dealership's apron ───────────────────────────────
 * The four that can only be bought at a dealership (game/garage.js's `unlockRule` calls them
 * `buy`), hard-coded as a table rather than imported, for the reason every other table in this
 * renderer is: render/props.js is loaded by the tile worker and must not pull the game's own
 * modules in behind it. `tools/bench-props.mjs` asserts the two lists agree, so the duplication
 * cannot drift silently.
 *
 * The colours are pulled apart deliberately — four cars in four shades of the same paint is the
 * "similar 3 biomes" mistake again, on a smaller stage. */
export const SHOWROOM_CARS = [
  /* FOUR COLOURS THAT ARE ACTUALLY FOUR COLOURS. The first version put paintA on the Sedan and
   * VERMILION on the Rally — and VERMILION is paintA mixed 18% towards amber, so photographed on the
   * apron they were two reds side by side and the row read as three cars, not four. Blue, red,
   * amber, teal: the four most separated hues the painted palette has. */
  { id: 'sedan', length: 4.5, colour: LC('paintC') }, // slate blue
  { id: 'rally', length: 4.2, colour: VERMILION }, // rally red
  { id: 'taxi', length: 4.5, colour: AMBER }, // and a taxi is amber, obviously
  // The pickup, and it is the only one on the row you can pick out by its OUTLINE — 5.91 m against
  // the saloons' 4.5, which is the whole reason a truck is worth adding to a fleet of cars.
  { id: 'pickup', length: 5.91, colour: CREAM },
  { id: 'patrol', length: 4.6, colour: TEAL },
];

/**
 * One car standing on the forecourt: plinth, body, cabin, four wheels, and a plaque facing out.
 *
 * Built from the same primitives as everything else here, at the car's REAL length, so a Patrol
 * beside a Rally is visibly the longer car. Parked nose-out along local +z, which is the way the
 * apron faces, so you drive up the aisle and see the fronts.
 *
 * @param {object} M painted-mesh builder
 * @param {number} px local x of the slot
 * @param {number} pz local z of the slot
 * @param {number} len the car's real length in metres
 * @param {number[]} colour linear paint colour
 */
function showroomCar(M, px, pz, len, colour) {
  /* pbox TAKES HALF-EXTENTS, and getting that wrong is visible from space: the first version passed
   * a full 1.82 m width into the half-width slot and produced four 3.6 m-wide slabs standing on the
   * forecourt like shipping containers. Every number below is a HALF.
   *
   * The cars are parked nose-out along local +z (the way the apron faces), so LENGTH is the z
   * half-extent and WIDTH is the x one — the reverse of the silhouette behind the glass above, which
   * lies across the window. The slots are 4.2 m apart in x, which is why a 4.6 m Patrol has to run
   * along z: broadside they would overlap. */
  const hl = len * 0.5;
  const HW = 0.9; // half of a 1.8 m body
  // a low plinth, so a display car reads as parked ON something rather than dropped on tarmac
  pbox(M, px, 0.07, pz, HW + 0.35, 0.07, hl + 0.3, 0, CREAM, MAT.MATTE);
  // body and cabin. The cabin is shorter, narrower and set back, which is what makes a box a car.
  pbox(M, px, 0.58, pz, HW, 0.26, hl, 0, colour, MAT.MATTE);
  /* The cabin sits ON the body rather than overlapping it, and the glass band is BETWEEN the two —
   * body, glass, roof. Drawn as one flat lozenge the first time, the row photographed as four trays
   * on plinths; the horizontal break at window height is the whole of what makes a box a car. */
  pbox(M, px, 0.94, pz - len * 0.06, HW - 0.07, 0.11, hl * 0.5, 0, GLASSC, MAT.GLASS);
  pbox(M, px, 1.15, pz - len * 0.06, HW - 0.12, 0.11, hl * 0.46, 0, colour, MAT.MATTE);
  for (const wx of [-1, 1])
    for (const wz of [-1, 1]) {
      const cx = px + wx * (HW - 0.06);
      const cz = pz + wz * hl * 0.62;
      pcyl(M, [cx - 0.1, 0.3, cz], [cx + 0.1, 0.3, cz], 0.3, 0.3, 8, TYRE, MAT.MATTE, false, false);
    }
  // the plaque, on a short post at the front bumper, in the dealership's own teal
  pcyl(M, [px, 0, pz + hl + 0.5], [px, 0.72, pz + hl + 0.5], 0.05, 0.05, 6, INK, MAT.MATTE, false, false);
  pbox(M, px, 0.86, pz + hl + 0.5, 0.34, 0.11, 0.03, 0, SIGN_DEAL, MAT.MATTE);
}

export function buildStation(M, r, skirt, deal = false) {
  // Single source of truth in src/world/props.js — the access spur, the collision hitboxes
  // and the station's own placement code all read the same two numbers.
  const AW = STATION_APRON_HALF_WIDTH; // apron half-width, along the road
  const AD = STATION_APRON_HALF_DEPTH; // apron half-depth, away from the road
  const drop = Math.max(0.35, skirt);

  // apron + skirt, one box: the top face is at y=0 and the sides run down into the ground
  pbox(M, 0, -drop * 0.5, 0, AW, drop * 0.5, AD, 0, TARMAC, MAT.MATTE);
  pbox(M, 0, 0.005, 0, AW - 0.15, 0.01, AD - 0.15, 0, TARMAC_D, MAT.MATTE);
  // the painted lead-in, so it reads as a forecourt from the road
  for (let i = -2; i <= 2; i++) pbox(M, i * 2.1, 0.02, AD - 0.6, 0.9, 0.012, 0.09, 0, LINE, MAT.MATTE);

  // canopy: four posts and a flat deck with a coloured fascia
  const CW = 5.2;
  const CD = 3.4;
  const CH = 4.3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    pcyl(M, [sx * CW, 0, sz * CD + 1.0], [sx * CW, CH, sz * CD + 1.0], 0.16, 0.15, 8, CREAM, MAT.MATTE, false, false);
  }
  pbox(M, 0, CH + 0.22, 1.0, CW + 0.9, 0.22, CD + 0.9, 0, CREAM, MAT.MATTE);
  pbox(M, 0, CH + 0.5, 1.0, CW + 0.95, 0.14, CD + 0.95, 0, deal ? SIGN_DEAL : VERMILION, MAT.MATTE);

  /* ── A DEALERSHIP READS AS A DEALERSHIP ──────────────────────────────────────
   * Operator: "add dealerships where you can buy cars with suns". Same apron, same canopy,
   * same spur — a dealership is a station with the `deal` flag (see world/props.js) so all of
   * that placement work is shared. What has to differ is what you SEE from the road, or the
   * two are the same building and the player cannot tell which one sells cars.
   *
   * So: a glass showroom box under the canopy with a car-shaped silhouette inside it, and the
   * fascia in a different colour. Drawn in code like every other prop here; no new material,
   * no texture, nothing downloaded. */
  if (deal) {
    // the showroom: a glazed box, lit, so it glows at dusk from a long way off
    pbox(M, 0, 1.55, 1.0, CW - 0.5, 1.55, CD - 0.4, 0, GLASSC, MAT.GLASS);
    pbox(M, 0, 0.06, 1.0, CW - 0.45, 0.06, CD - 0.35, 0, CREAM, MAT.MATTE);
    // a car on the stand — body, roof, four wheels. Small and rough on purpose: it is a
    // silhouette behind glass, not a model anyone gets close to.
    pbox(M, 0, 0.55, 1.0, 1.7, 0.32, 0.78, 0, VERMILION, MAT.MATTE);
    pbox(M, -0.1, 0.95, 1.0, 0.95, 0.28, 0.68, 0, VERMILION, MAT.MATTE);
    for (const wx of [-1.15, 1.15]) for (const wz of [-0.62, 0.62]) {
      pcyl(M, [wx, 0.28, 1.0 + wz], [wx, 0.28, 1.0 + wz + 0.14], 0.26, 0.26, 8, TYRE, MAT.MATTE, false, false);
    }
    // and a price-flag pennant on the corner post, which is what a real forecourt would do
    pbox(M, CW - 0.2, CH - 0.9, CD + 1.0, 0.9, 0.42, 0.03, 0, SIGN_DEAL, MAT.MATTE);

    /* ── THE LINE-UP ─────────────────────────────────────────────────────────
     * Operator: "The dealership should have the other cars, you know, show room type situation
     * where they can see the different cars physically and choose them."
     *
     * The silhouette behind the glass above says "this place sells cars" from the road. It does
     * not let anyone SEE the cars — it is one shape, always the same, and it is not any of them.
     * So the four dealership cars stand out on the apron at full size, each at its own real
     * length, each in its own colour, each on a low plinth with a plaque.
     *
     * Full size matters. A row of miniatures would read as decoration; a Patrol that is visibly
     * longer than a Rally is the thing the operator asked for, and it is the only way "choose
     * them" means anything before you have driven one.
     *
     * The slots come from world/props.js, NOT from numbers written here, because the collider and
     * the game's "which car am I standing next to" test read the same list — see SHOWROOM_SLOTS. */
    SHOWROOM_CARS.forEach((c, i) => {
      const slot = SHOWROOM_SLOTS[i];
      if (!slot) return;
      showroomCar(M, slot.dx, slot.dz, c.length, c.colour);
    });
  }
  /* THE BEACON. The operator asked for "a minecraft becon style light people can drive to,
   * seen from distance above gas station" -- a station you can only find by driving past it is
   * not findable, and the fuel gauge's arrow tells you the direction but not that you have
   * ARRIVED.
   *
   * A tapering EMIT column, widest at the canopy and narrowest at the top, 60 m tall. EMIT is
   * unlit by the sun, so it holds its colour against a bright sky as well as at dusk, and the
   * taper keeps the silhouette light rather than a solid slab. No new material, no sprite, no
   * second draw call -- it is part of the same painted mesh as the station itself, so it costs
   * one prop and disappears with the tile like everything else.
   *
   * Deliberately narrow: 0.55 m at the base. Wide enough to read across a valley, thin enough
   * that parking under it does not fill the screen. */
  {
    const BEACON_H = 60;
    const SEGS = 2; // two tapered sections read the same at distance and cost a third
    for (let i = 0; i < SEGS; i++) {
      const y0 = CH + 0.6 + (BEACON_H * i) / SEGS;
      const y1 = CH + 0.6 + (BEACON_H * (i + 1)) / SEGS;
      const r0 = 0.55 * (1 - i / SEGS) + 0.08;
      const r1 = 0.55 * (1 - (i + 1) / SEGS) + 0.08;
      pcyl(M, [0, y0, 1.0], [0, y1, 1.0], r0, r1, 4, GLOW, MAT.EMIT, false, false);
    }
  }

  // Under-canopy light. EMIT, because a forecourt at dusk is the whole mood of the thing.
  pbox(M, 0, CH - 0.02, 1.0, CW * 0.72, 0.03, CD * 0.5, 0, GLOW, MAT.EMIT);

  // two pumps, back to back on an island
  pbox(M, 0, 0.14, 1.0, 2.0, 0.14, 0.9, 0, GRAVEL_D, MAT.MATTE);
  for (const sx of [-1, 1]) {
    const px = sx * 1.15;
    pbox(M, px, 0.95, 1.0, 0.42, 0.81, 0.32, 0, CREAM, MAT.MATTE);
    pbox(M, px, 1.5, 1.0 + sx * 0.34, 0.3, 0.24, 0.03, 0, GLOW, MAT.EMIT);
    pbox(M, px, 1.82, 1.0, 0.44, 0.06, 0.36, 0, VERMILION, MAT.MATTE);
    // the hose, hanging in a curve rather than sticking out straight
    pcyl(M, [px + sx * 0.4, 1.4, 1.0], [px + sx * 0.62, 0.95, 1.0], 0.035, 0.035, 5, INK, MAT.MATTE, true, true);
    pcyl(M, [px + sx * 0.62, 0.95, 1.0], [px + sx * 0.52, 0.55, 1.0], 0.035, 0.03, 5, INK, MAT.MATTE, true, true);
  }

  // the kiosk at the back, lit, with a bench outside it
  const L = PB();
  gHut(L, {
    w: 4.0, d: 2.8, h: 2.4, wall: PLASTER, roof: SLATE, pitch: 0.9, eave: 0.45,
    plinth: 0.16, plinthCol: STONE_D, frame: true, frameCol: WOOD, windows: [-1.1, 1.1], lit: true, porch: true,
  });
  blit(M, L, 0, 0, -AD + 2.2, Math.PI, 1);
  const B = PB();
  BUILDERS.bench(B, r);
  blit(M, B, -AW + 2.0, 0, -AD + 2.6, 0.4, 1);

  // the sign on a pole, high enough to see over a hedge
  pcyl(M, [AW - 1.4, 0, AD - 1.6], [AW - 1.4, 5.4, AD - 1.6], 0.17, 0.15, 8, CREAM, MAT.MATTE, true, false);
  pbox(M, AW - 1.4, 5.9, AD - 1.6, 1.25, 0.75, 0.16, 0, VERMILION, MAT.MATTE);
  pbox(M, AW - 1.4, 5.9, AD - 1.42, 1.0, 0.55, 0.04, 0, GLOW, MAT.EMIT);

  // air line and a bin, the small true details
  pbox(M, -AW + 1.2, 0.55, 1.2, 0.22, 0.55, 0.22, 0, GREENBOX, MAT.MATTE);
  pcyl(M, [-AW + 1.2, 1.1, 1.2], [-AW + 1.2, 1.35, 1.2], 0.1, 0.08, 6, CHROME, MAT.METAL, false, true);
}

/* ── the access spur ──────────────────────────────────────────────────────────
 * A screenshot showed an existing station on a raised forecourt with a barrier/curb-like edge
 * running its whole perimeter and nothing connecting it to the road — you would have to drive
 * over that edge to reach the pumps. This is the fix: a short, real, paved driveway from the
 * edge of the HOST road's own tarmac to the forecourt slab. See world/props.js's stationSpur()
 * for exactly where its two ends are and why (mouth right at the carriageway edge, apron end
 * tucked under the forecourt) — pure geometry, computed once, shared with the diagnostic that
 * proves it connects.
 *
 * Built as a flared trapezoid rather than a full lattice junction. Two reasons, not one:
 *
 *   1. It already meets the host road at a TRUE right angle by construction — it runs along
 *      the exact normal every forecourt is already offset on, which is perpendicular to the
 *      road's own tangent by definition. There is no angle left to square.
 *   2. Per the operator, "it should also not cancel your street" — wiring a synthetic edge
 *      into the road lattice (the way a real crossing junction works, buildJunction() in
 *      render/road.js) would touch the host edge's own continuity to make room for it. This
 *      never reads a single vertex of the arterial's own ribbon or its RoadField carve, so the
 *      host road is completely untouched — the documented, sanctioned fallback for exactly
 *      this reason.
 *
 * Heights are the two real numbers either end already has to agree with — the actual ground
 * probe at the road mouth (literally Terrain.height(), the same number the car drives on) and
 * the forecourt's own graded pad height — never a third, hand-rolled estimate, so this cannot
 * reopen the class of bug where the drawn surface and the driven one disagree. A thin batter
 * skirt on both long edges (the same trick buildStation's own apron `skirt` uses) absorbs
 * whatever a straight-line height guess misses over the real ground in between.
 */
export function buildAccessSpur(M, mouthX, mouthZ, hRoad, apronX, apronZ, hApron, hostWidth, height = null) {
  const dx = apronX - mouthX;
  const dz = apronZ - mouthZ;
  const len = Math.hypot(dx, dz) || 1;
  const tx = dx / len, tz = dz / len; // road -> apron
  const px = -tz, pz = tx; // perpendicular, either sign — used symmetrically below

  const halfW = Math.max(1.6, (hostWidth || 3.2) * 0.5);
  const mouthHalf = Math.min(halfW * 1.35, halfW + 3.0); // a flared mouth, like a real driveway
  const apronHalf = 2.7; // a single-vehicle driveway width at the forecourt end
  const inset = 0.16;

  /* WHAT HEIGHT THE TARMAC IS AT, and the whole point of this rewrite.
   *
   * It used to be one flat trapezoid: hRoad at the mouth, hApron at the far end, a straight
   * line in between. Measured (tools/diag-spur.mjs, 42 stations on three seeds) that put the
   * drawn surface up to 16.28 m ABOVE Terrain.height, with 24 of the 42 over half a metre —
   * a driveway you can see and cannot drive on, which is the operator's "the roads that lead
   * to them need to work (no fall through)" exactly.
   *
   * So the spur is a RIBBON now, not a plank: SECTIONS cross-sections along its run, each
   * vertex sitting on the real ground probe plus the same LIFT the road ribbon uses, easing
   * up to the forecourt's flat pad plane only over the last stretch (BLEND onward) so the two
   * still meet flush with no hairline step. `height` is the tile's own Terrain.height — the
   * SAME ground the car drives on and the same one stationPad graded the slab against, never
   * a second opinion (gotcha: one elevation profile, one road truth).
   *
   * With no probe (an old harness fixture) it degrades to the original straight line rather
   * than throwing, which is exactly the geometry every earlier measurement was taken on.
   */
  /* 24, not 12: with 12 the run is sampled every 0.74 m and the straight line between two
   * sections still cut a 0.30 m corner off a real hummock (tools/diag-spur.mjs, seed 424242
   * st:0:-1,1,0). 24 sections is 0.37 m of tarmac each, 120 quads, and it takes the worst
   * drawn-vs-driven error on the whole spur under 0.2 m. */
  const SECTIONS = 24;
  const BLEND = 0.55;
  const g = height ? (x, z) => height(x, z) + LIFT : null;

  /* Across-offsets per section: the two painted edge lines, and COLS interior columns between
   * them. The interior columns are not decoration — with a single quad spanning the full
   * carriageway the drawn surface cut 0.30 m off a cross-slope, which is a fall-through in the
   * other axis (measured the same way, tools/diag-spur.mjs). The mouth is ~5 m wide, so 6
   * columns is under a metre of tarmac each. */
  const COLS = 6;
  const across = (t) => {
    const hw = mouthHalf + (apronHalf - mouthHalf) * t;
    const cols = [-hw, -hw + inset];
    for (let i = 1; i < COLS; i++) cols.push(-hw + inset + ((hw - inset) * 2 * i) / COLS);
    cols.push(hw - inset, hw);
    return cols;
  };
  /** One cross-section: its four top corners, plus how far the skirt must drop to bury itself. */
  const section = (t) => {
    const cx = mouthX + dx * t;
    const cz = mouthZ + dz * t;
    const e = smoothstep(BLEND, 1, t);
    const cols = across(t);
    const top = [];
    let drop = 0.35;
    for (const o of cols) {
      const x = cx + px * o;
      const z = cz + pz * o;
      const ground = g ? g(x, z) : hRoad + (hApron - hRoad) * t;
      const y = ground + (hApron - ground) * e;
      top.push([x, y, z]);
      // The skirt has to reach below the REAL ground under this corner or the low side shows
      // daylight — the same argument buildStation's own `drop` makes for the apron slab.
      if (g) drop = Math.max(drop, y - (g(x, z) - LIFT) + 0.35);
    }
    return { top, drop };
  };

  let prev = section(0);
  for (let i = 1; i <= SECTIONS; i++) {
    const cur = section(i / SECTIONS);
    const a = prev.top, b = cur.top;
    const last = a.length - 1;
    // the paved top: a painted edge line, the tarmac columns, the other painted edge line
    for (let c = 0; c < last; c++) {
      const mat = c === 0 || c === last - 1 ? LINE : TARMAC;
      pquad(M, a[c], a[c + 1], b[c + 1], b[c], mat, MAT.MATTE, [0, 1, 0]);
    }
    // the batter skirt on both long edges
    const aLd = [a[0][0], a[0][1] - prev.drop, a[0][2]];
    const bLd = [b[0][0], b[0][1] - cur.drop, b[0][2]];
    pquad(M, aLd, a[0], b[0], bLd, TARMAC_D, MAT.MATTE, [-px, 0, -pz]);
    const aRd = [a[last][0], a[last][1] - prev.drop, a[last][2]];
    const bRd = [b[last][0], b[last][1] - cur.drop, b[last][2]];
    pquad(M, a[last], aRd, bRd, b[last], TARMAC_D, MAT.MATTE, [px, 0, pz]);
    prev = cur;
  }
}

/* ── collision for the built structures on a forecourt ───────────────────────
 * Per the operator's screenshot: the car was free to overlap the kiosk, the pump island and
 * the canopy posts — nothing on a forecourt had a hitbox at all. Local-space (dx, dz) offsets
 * are read straight off buildStation's own numbers above; if that geometry ever moves, these
 * should move with it.
 *
 * The open apron itself, the canopy's open air, and the access spur stay deliberately clear —
 * a forecourt (or a driveway) you cannot drive onto is not a station you can visit.
 *
 * SOLID, since the operator reported the collisions "still non-existent" a second time. These
 * used to be registered without `solid: true`, i.e. as scrape-and-slide roadside architecture.
 * Driven for real (tools/bench-props.mjs's station section, which now runs the full approach
 * on the real heightfield rather than a 14 m nudge on a flat stub) that reads as nothing at
 * all. A/B on one station, everything else identical: without the flag a 44.0 km/h arrival
 * scrubs to 2.70 km/h and grinds on along the face of the building; with it, 44.0 -> 0.00. Let
 * go of the wheel instead of steering back into it and the un-flagged version simply slides off
 * the pump island and drives on across the forecourt at full speed, which is precisely the
 * "collisions are non-existent" being reported. A kiosk is a BUILDING; you stop. Same treatment a
 * tree gets and it inherits the same cozy let-offs from game/collide.js for free — under
 * STOP_CLOSING (2.5 m/s ≈ 9 km/h closing) it is still only a nudge, and a glancing contact
 * under GRAZE still slides — so nosing up to the pumps to refuel is unchanged, and only
 * actually driving INTO the building stops you.
 */
const STATION_HITBOXES = [
  // the kiosk hut (gHut w=4.0, d=2.8, h=2.4, pitch=0.9), blit at local (0, -AD+2.2), rotated
  // by pi — a rotation by pi does not change a symmetric footprint's circumscribed radius.
  // 2.8, not the 2.44 the bare 4.0 x 2.8 hut footprint circumscribes: gHut's `porch: true`
  // pushes the drawn structure to 2.78 from the blit point at bumper height (measured, see the
  // silhouette slice at the end of tools/bench-props.mjs — the same method diag-collide.mjs
  // uses on trunks). Enclosing rather than splitting the difference, for the reason
  // collide.js's TRUNK_R comment gives: stopping a few centimetres early is invisible, driving
  // through a wall is not.
  { dx: 0, dz: -(STATION_APRON_HALF_DEPTH - 2.2), r: 2.8, h: 3.6 },
  // the pump island and the two pumps standing on it, as one cylinder
  { dx: 0, dz: 1.0, r: 1.55, h: 2.0 },
  // the four canopy posts (CW=5.2, CD=3.4, offset +1.0 in local z)
  { dx: -5.2, dz: -2.4, r: 0.22, h: 4.3 },
  { dx: 5.2, dz: -2.4, r: 0.22, h: 4.3 },
  { dx: -5.2, dz: 4.4, r: 0.22, h: 4.3 },
  { dx: 5.2, dz: 4.4, r: 0.22, h: 4.3 },
  // the sign, on its own pole
  { dx: STATION_APRON_HALF_WIDTH - 1.4, dz: STATION_APRON_HALF_DEPTH - 1.6, r: 0.28, h: 6.4 },
];

/* ── the apron's own EDGE ─────────────────────────────────────────────────────
 * Operator on the station collision: "somewhat but not BOTTOM done". The seven boxes above
 * are the things STANDING on the forecourt — the kiosk, the pump island, the canopy posts,
 * the sign. The forecourt ITSELF had nothing. A petrol station is a graded pad, so on any
 * ground that is not flat the slab stands proud of the land beside it, with a batter skirt
 * running down to meet it; the real ground spread under one is a median 1.60 m and up to
 * STATION_MAX_ROUGH (measured over 185 stations, see stationPad in src/world/props.js). Drive
 * at that face from the low side and there was nothing there: you passed through several
 * metres of drawn tarmac and out under the canopy.
 *
 * The existing silhouette check at the end of tools/bench-props.mjs could never catch it,
 * and that is worth writing down: it slices the drawn geometry at BUMPER HEIGHT ABOVE THE
 * PAD, and the whole apron face lives BELOW the pad. It reported 0.228 m of structure outside
 * a hitbox and was right about everything it looked at.
 *
 * WHAT IS AND IS NOT WALLED. Only the stretches where the slab actually stands over the
 * ground beside it by more than APRON_KERB_MIN — a 20 cm lip is a kerb you drive over, and
 * making it solid would be the un-cozy version of this fix. And never the DOORWAY: the
 * stretch of the road-facing edge that the access spur arrives on stays open, because a
 * forecourt you cannot drive onto is not a station you can visit. The spur's own tarmac
 * follows the real ground into that gap (buildAccessSpur), so the way in is a ramp, not a
 * step.
 *
 * Each collider's base is the REAL GROUND under it, not the pad: a car outside the forecourt
 * is standing on that ground, and collide.js's fly-over gate (`car.y - 0.4 > s.y + s.h`) has
 * to see a wall that starts where the car is, or it would correctly discard the whole thing
 * as something the car is already above.
 */
/** Below this the slab edge is a kerb, not a wall, and stays drivable. */
const APRON_KERB_MIN = 0.55;
/** Half the doorway the access spur arrives through, metres either side of the apron's own
 *  centre on its road-facing edge. The spur is 2 * 2.7 m wide where it meets the slab
 *  (buildAccessSpur's `apronHalf`), plus a car's width of slack so a slightly wide entry is
 *  not a scrape. */
const APRON_DOOR_HALF = 4.2;
/** Spacing of the cylinders that make up one wall, and their radius. Overlapping on purpose —
 *  collide.js's narrow phase is swept against circles, so a gap between two of them is a gap
 *  a car can be teleported through at speed. */
const KERB_STEP = 1.5;
const KERB_R = 1.05;

/** Turn placed stations into collision solids, the same shape propSolids() below gives the
 *  ambient props — see STATION_HITBOXES' own comment for what is and is not included.
 *  `height`, when the caller has a real ground probe (the tiler always does), adds the apron
 *  edge itself — see the section comment above. */
export function stationSolids(stations, height = null) {
  const out = [];
  for (const s of stations) {
    const ca = Math.cos(s.yaw);
    const sa = Math.sin(s.yaw);
    const baseY = s.padY ?? s.y;
    /* A DISPLAY CAR IS A REAL OBJECT. Operator: "see the different cars physically". A row of
     * cars you can drive straight through is scenery, not a showroom — and the collider is also
     * what stops you parking inside one while reading its price. Dealerships only, since a plain
     * petrol station has no line-up. Radius 1.35 encloses the 1.82 m body across its width. */
    const boxes = s.deal
      ? STATION_HITBOXES.concat(SHOWROOM_SLOTS.map((b) => ({ dx: b.dx, dz: b.dz, r: 1.35, h: 1.5 })))
      : STATION_HITBOXES;
    for (const b of boxes) {
      out.push({
        x: s.x + b.dx * ca - b.dz * sa,
        z: s.z + b.dx * sa + b.dz * ca,
        y: baseY,
        r: b.r,
        h: b.h,
        kind: 'station',
        // See STATION_HITBOXES' own comment: a forecourt structure stops the car dead, the
        // same as a trunk, with collide.js's own STOP_CLOSING/GRAZE let-offs still applying.
        solid: true,
      });
    }
    if (!height) continue;

    /* The four edges of the apron rectangle, walked in the station's own local frame. Local
     * +z faces the road (yaw = atan2(-nx, -nz)), so the +z edge is the one with the doorway
     * in it. Corners are covered by both of the edges that meet there — one extra overlapping
     * cylinder is cheaper than reasoning about which edge owns a corner. */
    const AW = STATION_APRON_HALF_WIDTH;
    const AD = STATION_APRON_HALF_DEPTH;
    const wall = (lx, lz, doorway) => {
      const x = s.x + lx * ca - lz * sa;
      const z = s.z + lx * sa + lz * ca;
      const g = height(x, z);
      const face = baseY - g;
      if (!(face > APRON_KERB_MIN)) return;
      if (doorway && Math.abs(lx) < APRON_DOOR_HALF) return;
      out.push({
        x, z, y: g, r: KERB_R,
        // Up to the slab's top face and a little proud, so a car cannot ride up over the
        // corner of it on a bump — the same enclosing-rather-than-splitting rule TRUNK_R uses.
        h: face + 0.3,
        kind: 'station',
        solid: true,
        /* Tagged so a harness can tell the apron's edge from the buildings standing on it
         * without inventing a second `kind` — `kind` is what collide.js and the HUD read, and
         * hitting the edge of a forecourt IS hitting a station. */
        apron: true,
      });
    };
    const nAlong = Math.max(2, Math.ceil((AW * 2) / KERB_STEP));
    for (let i = 0; i <= nAlong; i++) {
      const lx = -AW + (2 * AW * i) / nAlong;
      wall(lx, AD, true); // the road-facing edge, with the spur's doorway left open
      wall(lx, -AD, false); // the back edge
    }
    const nAcross = Math.max(2, Math.ceil((AD * 2) / KERB_STEP));
    for (let i = 0; i <= nAcross; i++) {
      const lz = -AD + (2 * AD * i) / nAcross;
      wall(AW, lz, false);
      wall(-AW, lz, false);
    }
  }
  return out;
}

/* ── the floating fuel can ────────────────────────────────────────────────────
 * A small, warm, easy-to-spot pickup — a supplementary, denser layer to `stationsInBox`
 * above, placed by `fuelCansInBox` in src/world/props.js. See that file's comment for why it
 * exists and exactly what "floating" means: this local-space geometry is modelled with its
 * OWN base at +CAN_HOVER, so placing it at a can's world (x, y, z) — the same ground-contact
 * point every other prop uses — is what makes it read as hovering. Nothing downstream of this
 * function needs to know that; it is just where the vertices start.
 *
 * The gentle bob (`Props._updateCans` below) is a SEPARATE, tiny, time-based wobble applied
 * to the finished mesh's own transform every frame — it is not part of this geometry at all,
 * which is what keeps the placement math in world/props.js honestly "on the ground" for its
 * own freeboard and slope tests.
 */
function buildFuelCan(M, r) {
  const y0 = CAN_HOVER;
  /* Every offset and half-extent below is in the can's ORIGINAL, real-jerry-can metres and is
   * multiplied by S here rather than being rewritten — so the shape stays the shape that was
   * modelled and reviewed, and "how big is a can" remains one number (CAN_SCALE) instead of
   * thirty edited literals that can drift apart. `y0 +` sits OUTSIDE every product on purpose:
   * the scale is about the can's own base, not about the ground, so the hover gap is not
   * scaled with it. */
  const S = CAN_SCALE;
  const body = mixc(RED, INK, 0.1);
  const panel = mixc(body, CREAM, 0.3);
  // squat body, narrower at the neck — reads as a jerry can at a glance, not a box
  pbox(M, 0, y0 + 0.16 * S, 0, 0.14 * S, 0.16 * S, 0.095 * S, 0, body, MAT.MATTE);
  pbox(M, 0, y0 + 0.16 * S, 0.096 * S, 0.095 * S, 0.11 * S, 0.005 * S, 0, panel, MAT.MATTE); // embossed panel, front
  pbox(M, 0, y0 + 0.16 * S, -0.096 * S, 0.095 * S, 0.11 * S, 0.005 * S, 0, panel, MAT.MATTE); // and back
  pcyl(M, [0, y0 + 0.32 * S, 0.015 * S], [0, y0 + 0.4 * S, 0.015 * S], 0.04 * S, 0.035 * S, 6, body, MAT.MATTE, true, false);
  pcyl(M, [0, y0 + 0.4 * S, 0.015 * S], [0, y0 + 0.44 * S, 0.015 * S], 0.044 * S, 0.044 * S, 6, CREAM, MAT.MATTE, true, true);
  // carrying handle: a thin loop over the top
  pbox(M, 0, y0 + 0.35 * S, -0.045 * S, 0.075 * S, 0.018 * S, 0.018 * S, 0, body, MAT.MATTE);
  for (const sx of [-1, 1]) {
    pcyl(M, [sx * 0.075 * S, y0 + 0.24 * S, -0.045 * S], [sx * 0.075 * S, y0 + 0.35 * S, -0.045 * S], 0.013 * S, 0.013 * S, 4, body, MAT.MATTE, true, true);
  }
  /* The lit panel. It used to be a 0.045 x 0.045 m chip — a 5 cm glint on a 30 cm object, which
   * is why an audit that went looking for a glow found "no halo, no bloom, no pulse". It is now
   * most of the front face (0.105 of 0.14 half-width), which is a can with a LIT PANEL rather
   * than a can with a speck on it, and it still costs one quad. */
  pbox(M, 0, y0 + 0.17 * S, 0.1 * S, 0.105 * S, 0.105 * S, 0.004 * S, 0, GLOW, MAT.EMIT);
  pbox(M, 0, y0 + 0.17 * S, -0.1 * S, 0.105 * S, 0.105 * S, 0.004 * S, 0, GLOW, MAT.EMIT); // ...and the back, so it reads from either side
  // A lit collar under the cap: a second, smaller light at a different height, which is what
  // makes the object read as three-dimensional at distance instead of as a flat card.
  pcyl(M, [0, y0 + 0.395 * S, 0.015 * S], [0, y0 + 0.415 * S, 0.015 * S], 0.05 * S, 0.05 * S, 8, GLOW, MAT.EMIT, true, true);
  if (r() < 0.5) pball(M, 0.02 * S, y0 + 0.02 * S, 0.06 * S, 0.05 * S, 0.02 * S, 0.05 * S, mixc(body, INK, 0.4), MAT.MATTE, 6, 3); // a puddle-shaped drip, half the time
}

/* ── the litter bin ───────────────────────────────────────────────────────────
 * The other half of the operator's line ("fuel cans and trash cans: bigger, and glowing, so
 * they are not missed"). There was no trash can anywhere in the project — no catalogue entry,
 * no geometry, no string — so this is built from scratch, in the same painted pipeline as the
 * other hundred props, from the same palette. Nothing downloaded; see this file's own header
 * for why that is the standing rule here.
 *
 * WHERE IT LIVES, and why it is not one of world/props.js's 100 catalogue kinds: it is placed
 * against the fuel cans (see _bake), so it lands exactly where it is useful — beside the thing
 * you are meant to spot — instead of being sprinkled at catalogue density across a wilderness
 * that has no bins in it. It also means this whole feature is one file's change.
 *
 * WHAT IT LOOKS LIKE: a waist-high green drum, a slightly proud dark lid, a hoop foot, and a
 * lit band around the shoulder. The band is the point. A bin is a silhouette you already know,
 * and a horizontal lit line at 0.9 m is legible at a distance where the drum itself is four
 * pixels of green against green.
 */
function buildLitterBin(M, r) {
  const green = mixc(LC('tShade'), INK, 0.12);
  const dark = mixc(green, INK, 0.45);
  const R = 0.34;
  const H = 1.02;
  // the drum, very slightly tapered so it does not read as a pipe
  pcyl(M, [0, 0.06, 0], [0, H, 0], R * 0.92, R, 10, green, MAT.MATTE, true, false);
  // a hoop foot, and the lid
  pcyl(M, [0, 0, 0], [0, 0.06, 0], R * 0.86, R * 0.9, 10, dark, MAT.MATTE, true, true);
  pcyl(M, [0, H, 0], [0, H + 0.09, 0], R * 1.06, R * 0.86, 10, dark, MAT.MATTE, true, true);
  // the lit band around the shoulder — EMIT, so it is warm at any hour, same trick the can's
  // panel and a lantern's fire window both use
  pcyl(M, [0, H - 0.2, 0], [0, H - 0.09, 0], R * 1.02, R * 1.02, 10, GLOW, MAT.EMIT, true, true);
  // two vertical ribs, for something to catch the light on the drum itself
  for (const a of [0.7, 0.7 + Math.PI]) {
    pbox(M, Math.sin(a) * R * 0.97, 0.55, Math.cos(a) * R * 0.97, 0.03, 0.44, 0.03, a, dark, MAT.MATTE);
  }
  // a bag corner poking out under the lid, half the time — a bin somebody actually uses
  if (r() < 0.5) pbox(M, R * 0.5, H + 0.02, 0, 0.12, 0.07, 0.1, r() * TAU, CREAM, MAT.MATTE);
}

/* ── the can's glow ───────────────────────────────────────────────────────────
 * A single 64 px radial-gradient texture, built once, shared by every halo sprite in the game.
 * Additive and depth-TESTED: it brightens what is behind it and a hill still hides it, which is
 * the difference between a lantern and an objective marker.
 *
 * Guarded on `document` and cached in a module local, because this module is also imported by
 * tools/bench-props.mjs, which builds real tiles in node with no DOM at all. No canvas, no
 * halo, and every other measurement that harness makes is unaffected.
 */
let _haloTex;
function haloTexture() {
  if (_haloTex !== undefined) return _haloTex;
  if (typeof document === 'undefined' || !document.createElement) return (_haloTex = null);
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  if (!g) return (_haloTex = null);
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  /* Warm amber in the middle, out to nothing. The stops are weighted to the INSIDE (0.28 is
   * already at half brightness) so the halo has a small bright heart and a wide soft skirt —
   * a hard-edged disc reads as a decal stuck on the world. */
  grad.addColorStop(0.0, 'rgba(255,236,190,1)');
  grad.addColorStop(0.28, 'rgba(255,198,110,0.5)');
  grad.addColorStop(0.62, 'rgba(255,168,80,0.14)');
  grad.addColorStop(1.0, 'rgba(255,150,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  const tex = new CanvasTexture(c);
  return (_haloTex = tex);
}

/* ── the scene-side manager ───────────────────────────────────────────────── */

/**
 * Every prop and petrol station near the car, as one baked geometry per tile.
 *
 * @param {object} opts
 * @param {number} opts.seed
 * @param {THREE.Object3D} opts.scene
 * @param {object} [opts.solids] a game/collide.js Solids to register hittable props with
 */
export class Props {
  constructor({ seed, scene, solids = null, range = RANGE, tile = TILE }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.solids = solids;
    this.range = range;
    this.tile = tile;

    this.group = new Object3D();
    this.group.name = 'props';
    this.group.matrixAutoUpdate = false;
    scene.add(this.group);

    this.material = createPaintedMaterial();
    /** tile key -> { mesh, props, stations } */
    this.live = new Map();
    this.pending = [];
    /** the tile currently being built, one phase per frame; null between tiles */
    this._job = null;
    this._lastCx = Infinity;
    this._lastCz = Infinity;
    /** Every station in a tile that is currently loaded. */
    this.stations = [];
    /* Every station this session has ever loaded, whether or not its tile is still live.
     * Stations are a pure function of the seed, so remembering one is not a cache that can go
     * stale — and it matters: they sit about 2.9 km apart along arterials while this window
     * only reaches 1.2 km, so without a memory the fuel gauge could not tell you where the
     * nearest pump was for most of a tank. Capped, dropping the furthest, so a long drive
     * cannot grow it without bound. */
    this.known = new Map();
    /** Harbours, per baked tile key — see nearestHarbour for why they are cached here and not
     *  queried live. */
    this._harbours = new Map();
    /** Airfields, per baked tile key — see nearestAirfield. */
    this._airfields = new Map();
    /** The probe warmOne() uses, kept from the most recent tile job — the placement tests need a
     *  real Terrain and a tile has already built one. Null until the first tile is built, which is
     *  fine: there is nothing to warm before then either. */
    this._warmProbe = null;
    /* Fuel cans, key -> { mesh, x, z, phase, tile }. Unlike props and stations these are
     * INDIVIDUAL meshes, never baked into a tile's shared geometry: a can has to disappear
     * the instant it is collected and has to bob every frame, and a static bake can do
     * neither without rebuilding the whole tile for one object. There are few enough of them
     * live at once (measured, tools/bench-props.mjs: about a can every 600 m) that one draw
     * call each is cheap. */
    this.cans = new Map();
    /* Collected this session, by the can's own key (`cn:${edgeKey}:${slot}`, world/props.js).
     * A can is a pure function of the seed like everything else here, so if a tile leaves the
     * window and comes back, fuelCansInBox would hand back the SAME can — this is what stops
     * it reappearing after it has been taken. Session-only, same as `known` never persists:
     * the world regenerates from the seed, "already collected" is play-session state. */
    this._collectedCans = new Set();
    /** Fuel gained by collecting a can since the last drainCollectedFuel() call. */
    this._pendingFuel = 0;
    this._bobT = 0;
    this.stats = { tiles: 0, props: 0, stations: 0, cans: 0, verts: 0, tris: 0, buildMs: 0, backlog: 0 };
    this._scratchW = new Float32Array(BIOME_COUNT);
  }

  /** Nearest station this session knows about, or null. Cheap: a scan of a short list. */
  /* Nearest HARBOUR, out of the tiles that are already built.
   *
   * Same pattern as nearestStation below and for a much sharper reason: main.js first asked the pure
   * world function directly, on a timer, and it starved the frame — harboursInBox walks a 5 km
   * lattice and probes the sea bed at every candidate, and the car dropped to 9 km/h on a road (the
   * browser suite caught it: "C4 lifting off slows you visibly: 22 -> 21 km/h"). A tile has already
   * done that work; asking it again is free. The cost is that a harbour is only findable once its
   * tile has streamed in, which is exactly the same deal every station has. */
  /** Nearest AIRFIELD out of the built tiles — same reasoning as nearestHarbour just below. */
  nearestAirfield(x, z) {
    let best = null;
    let bd = Infinity;
    for (const list of this._airfields.values()) {
      for (const f of list) {
        const d = Math.hypot(f.x - x, f.z - z);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
    }
    return best ? { ...best, dist: bd } : null;
  }

  nearestHarbour(x, z) {
    let best = null;
    let bd = Infinity;
    for (const list of this._harbours.values()) {
      for (const h of list) {
        const d = Math.hypot(h.x - x, h.z - z);
        if (d < bd) {
          bd = d;
          best = h;
        }
      }
    }
    return best ? { ...best, dist: bd } : null;
  }

  nearestStation(x, z) {
    let best = null;
    let bd = Infinity;
    for (const s of this.known.values()) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { ...best, dist: bd } : null;
  }

  update(dt, camX, camZ) {
    const cx = Math.floor(camX / this.tile);
    const cz = Math.floor(camZ / this.tile);
    if (cx !== this._lastCx || cz !== this._lastCz) {
      this._lastCx = cx;
      this._lastCz = cz;
      this._reshape(camX, camZ);
    }
    this._drain(dt);

    /* ONE HARBOUR-OR-AIRFIELD CELL PER FRAME, and no more. See the warming note in world/props.js:
     * resolving a cold 5 km cell costs 96-182 ms, and doing it inside a tile bake (nine cells at
     * once) is what dropped the game to 11.8 fps with a car that could not pass 25 km/h. Paying for
     * exactly one, deliberately, off the tile pipeline, spreads it over the seconds a player spends
     * driving towards the ground it describes.
     *
     * Only while a tile job is NOT in flight, so this never lands in the same frame as a bake. */
    if (!this._job && this._warmProbe) warmOne(camX, camZ, this.seed, this._warmProbe);

    // Every frame, tile change or not: the bob has to keep moving and a can has to be
    // collectible the instant the car is close enough, not just when a tile boundary crosses.
    this._updateCans(dt, camX, camZ);
  }

  /**
   * Bob every live can and collect any within CAN_RADIUS of (camX, camZ) — main.js calls
   * update() with the car's own x/z (see nearestStation's own comment above for the same
   * point about station distance), so this is the car's real position, not the camera's.
   */
  _updateCans(dt, camX, camZ) {
    this._bobT += dt;
    for (const [key, c] of this.cans) {
      const d = Math.hypot(c.x - camX, c.z - camZ);
      if (d <= CAN_RADIUS) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        this._dropHalo(c);
        this.cans.delete(key);
        this._collectedCans.add(key);
        this._pendingFuel += CAN_FRACTION;
        continue;
      }
      // The can's geometry is already baked hovering at +CAN_HOVER above the ground (see
      // buildFuelCan); this is a SEPARATE, tiny delta on the mesh's own transform on top of
      // that, never touching the baked vertices.
      const bob = Math.sin(this._bobT * CAN_BOB_HZ * TAU + c.phase) * CAN_BOB_AMP;
      c.mesh.position.y = bob;
      c.mesh.updateMatrix();
      /* The halo rides the same bob and breathes on the same phase, a quarter turn behind it,
       * so the can is brightest as it reaches the top of its rise. One clock for the whole
       * object: two independent oscillators would beat against each other and read as a flicker,
       * which is exactly the not-cozy failure this is meant to avoid. */
      if (c.halo) {
        c.halo.position.y = c.baseY + bob;
        c.halo.material.opacity = CAN_HALO_A + CAN_HALO_SWING * Math.sin(this._bobT * CAN_BOB_HZ * TAU + c.phase - Math.PI / 2);
      }
    }
  }

  /** Take a can's halo off the scene and free its material. The shared texture is NOT disposed —
   *  it belongs to the module, not to any one can. Both places a can leaves the world (collected
   *  in _updateCans, tile released in _release) go through this one function. */
  _dropHalo(c) {
    if (!c || !c.halo) return;
    this.group.remove(c.halo);
    c.halo.material.dispose();
    c.halo = null;
  }

  /**
   * Fuel gained from cans collected since the last call, as a fraction of a tank (0 if none).
   * Pull-based so game/fuel.js needs nothing about this class beyond one callback — see the
   * findStation wiring in main.js, which this mirrors.
   */
  drainCollectedFuel() {
    const f = this._pendingFuel;
    this._pendingFuel = 0;
    return f;
  }

  /** Decide which tiles should exist, queue the missing ones, drop the far ones. */
  _reshape(camX, camZ) {
    const n = Math.ceil(this.range / this.tile);
    const want = new Set();
    const cx = this._lastCx;
    const cz = this._lastCz;
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const tx = cx + i;
        const tz = cz + j;
        // Distance to the tile's nearest edge, so a tile the car is standing in the corner
        // of is never dropped.
        const dx = Math.max(0, Math.abs((tx + 0.5) * this.tile - camX) - this.tile * 0.5);
        const dz = Math.max(0, Math.abs((tz + 0.5) * this.tile - camZ) - this.tile * 0.5);
        if (Math.hypot(dx, dz) > this.range) continue;
        want.add(`${tx},${tz}`);
      }
    }
    for (const key of want) {
      if (this.live.has(key) || (this._job && this._job.key === key) || this.pending.some((p) => p.key === key)) continue;
      const [tx, tz] = key.split(',').map(Number);
      this.pending.push({ key, tx, tz });
    }
    // Nearest first: the tile you are about to drive into matters more than the one behind.
    this.pending.sort((a, b) => this._d2(a, camX, camZ) - this._d2(b, camX, camZ));
    for (const [key, rec] of this.live) {
      if (want.has(key)) continue;
      this._release(key, rec);
    }
    this.pending = this.pending.filter((p) => want.has(p.key));
    // A half-built tile that has left the window is thrown away rather than finished: its
    // Terrain is the expensive part and it has already been paid for, but baking a mesh
    // nobody will see and then immediately releasing it is pure waste.
    if (this._job && !want.has(this._job.key)) this._job = null;
  }

  _d2(p, camX, camZ) {
    const mx = (p.tx + 0.5) * this.tile - camX;
    const mz = (p.tz + 0.5) * this.tile - camZ;
    return mx * mx + mz * mz;
  }

  /**
   * One PHASE of one tile per frame.
   *
   * Building a whole tile in one go measured at 11 ms on this machine — two thirds of a
   * 60 Hz frame, five frames running every time you cross a tile boundary, which is exactly
   * the kind of periodic hitch a cozy game cannot have. The work splits cleanly into four
   * pieces that do not need each other's intermediate state, and the largest of them (the
   * Terrain build) is about 4 ms typical, 8 ms worst. So: one piece a frame. The window takes
   * four times as many frames to fill and nobody can tell, because the ground under it is
   * still streaming.
   *
   * For calibration, because it is easy to gold-plate this: render/road.js already spends a
   * MEDIAN of 10 ms and a worst of 15.8 ms in one frame every 180 m of driving, and 107 ms on
   * its first fill. An 8 ms phase once per tile is comfortably inside the envelope the game
   * already has. A tried-and-reverted refinement is recorded here so it is not tried twice:
   * skipping the Terrain on tiles with no props and no stations sounds free and is not —
   * with a 150 m placement reach almost every tile has a candidate somewhere in its halo, so
   * the pre-pass ran on all 44 tiles, skipped one, and put the median UP from 3.5 to 4.2 ms.
   */
  _drain(dt) {
    this.stats.buildMs = 0;
    this.stats.backlog = this.pending.length + (this._job ? 1 : 0);
    if (dt > SKIP_FRAME) return;
    if (!this._job) {
      if (!this.pending.length) return;
      this._job = this.pending.shift();
      this._job.phase = 0;
    }
    const t0 = performance.now();
    this._step(this._job);
    this.stats.buildMs = performance.now() - t0;
    this.stats.backlog = this.pending.length + (this._job ? 1 : 0);
  }

  _step(job) {
    const size = this.tile;
    const ox = job.tx * size;
    const oz = job.tz * size;
    switch (job.phase) {
      case 0: {
        /* The Terrain reaches 40 m past the tile: the furthest anything asks about is a
         * petrol-station apron corner at 11 m and a barn's footprint probe at 9 m. It does
         * NOT have to cover the roads the props hang off — those come from this module's own
         * edgesInBox call, and Terrain's own RoadField already expands its query by more
         * than a kilometre of tangent reach whatever pad it is given. Padding it to 96 m
         * cost 1.5 ms a tile for nothing. */
        job.terr = new Terrain(this.seed, ox, oz, ox + size, oz + size, 40);
        const w = this._scratchW;
        job.probe = {
          site: (x, z) => {
            const b = job.terr.weights(x, z);
            // Terrain.weights() hands back its OWN scratch and Terrain.height() clobbers it,
            // so the copy is not defensive style, it is required. scatter.js hit this first.
            w.set(b.w);
            const dominant = b.dominant;
            const y = job.terr.height(x, z);
            return { y, dominant, wy: waterLevelAt(w, -Infinity) };
          },
          height: (x, z) => job.terr.height(x, z),
          /* `dry` and `waterY` are what the airfields and the harbours need over and above a
           * height: an airstrip must not be under water, and a quay has to have something to
           * float a boat in. Both go through waterLevelAt, the one water-height function this
           * game has (see terrain.js's own note), rather than a second opinion about the sea. */
          dry: (x, z) => {
            const b = job.terr.weights(x, z);
            w.set(b.w);
            const y = job.terr.height(x, z);
            const wl = waterLevelAt(w, -Infinity);
            return !(wl !== null && Number.isFinite(wl) && wl > y);
          },
          waterY: (x, z) => {
            const b = job.terr.weights(x, z);
            w.set(b.w);
            const wl = waterLevelAt(w, -Infinity);
            return wl !== null && Number.isFinite(wl) ? wl : null;
          },
        };
        job.phase = 1;
        /* Keep this probe for warmOne() — see update(). It belongs to a Terrain covering this tile,
         * which is exactly the neighbourhood the next cells to warm are in. */
        this._warmProbe = job.probe;
        return;
      }
      case 1:
        // Ambient scatter plus each nearby station's own small "town" halo (a couple of
        // telegraph poles and a small structure or two — see stationTownInBox's own comment
        // in world/props.js) merged into the same list, so it bakes through the identical
        // BUILDERS[id] dispatch and picks up a collision hitbox for free wherever the
        // catalogue entry already declares one.
        job.props = propsInBox(ox, oz, ox + size, oz + size, this.seed, job.probe)
          .concat(stationTownInBox(ox, oz, ox + size, oz + size, this.seed, job.probe));
        job.phase = 2;
        return;
      case 2:
        /* WITH the tile's own ground probe. `stationsInBox` is pure without one and stays that
         * way for `nearestStation`, but a tile has a real Terrain in hand already (phase 0),
         * and that is the only place a forecourt can be checked against the ground the car
         * actually drives on rather than against `land()`. A station whose apron ground is
         * too broken to grade a slab into is dropped here — see stationPad/STATION_MAX_ROUGH
         * in src/world/props.js. Costs nine height() calls per candidate on an already-built
         * Terrain, which is why it is affordable here and nowhere else. */
        job.stations = stationsInBox(ox, oz, ox + size, oz + size, this.seed, null, job.probe);
        job.phase = 3;
        return;
      case 3:
        job.cans = fuelCansInBox(ox, oz, ox + size, oz + size, this.seed, job.probe);
        job.phase = 4;
        return;
      case 4:
        /* Airfields — but ONLY if their cells are already resolved. See the warming note in
         * world/props.js: a cold cell is 96-182 ms and a tile spans nine of them, which is where the
         * 11.8 fps came from. An unwarmed tile simply gets no airfield and picks one up when it is
         * next rebuilt, which streaming does as you move. */
        if (!airfieldCellsWarm(ox, oz, ox + size, oz + size, this.seed)) {
          job.airfields = [];
          job.phase = 5;
          return;
        }
        /* Airfields, with the tile's own probe — the flat-along-the-strip and dry tests in
         * world/props.js need real ground, exactly like a station's apron does. Its own phase so a
         * tile that happens to contain one does not pay for it in the same frame as the stations. */
        job.airfields = airfieldsInBox(ox, oz, ox + size, oz + size, this.seed, {
          height: job.probe.height,
          dry: job.probe.dry,
        });
        job.phase = 5;
        return;
      case 5:
        if (!harbourCellsWarm(ox, oz, ox + size, oz + size, this.seed)) {
          job.harbours = [];
          job.phase = 6;
          return;
        }
        /* Harbours, with the tile's own probe. `waterY` is the extra one they need over an
         * airfield's: "deep enough to float a boat" cannot be answered from height alone. */
        job.harbours = harboursInBox(ox, oz, ox + size, oz + size, this.seed, {
          height: job.probe.height,
          dry: job.probe.dry,
          waterY: job.probe.waterY,
        });
        job.phase = 6;
        return;
      default:
        this._bake(job);
        this._job = null;
    }
  }

  /** Turn one tile's queried props into one geometry, one mesh and one solids block. */
  _bake(job) {
    const { key, props, stations, cans, airfields, harbours } = job;
    const height = job.probe.height;
    const M = PB();
    for (const p of props) {
      const build = BUILDERS[p.id];
      if (!build) {
        console.error('[props] no geometry for kind', p.id, '— src/world/props.js and src/render/props.js disagree');
        continue;
      }
      const L = PB();
      // The prop's own stream. Keyed on the ROUNDED WORLD POSITION, not on build order, so a
      // prop keeps its variation when the tile is rebuilt — the same argument trees.js makes
      // for its sway phase.
      const r = rng(hash3i(Math.round(p.x * 4), Math.round(p.z * 4), 0x9e37, this.seed));
      build(L, r, p.hue);
      blit(M, L, p.x, p.y, p.z, p.yaw, p.scale);
    }

    if (harbours && harbours.length) this._harbours.set(key, harbours);
    for (const h of harbours || []) {
      /* One geometry per harbour, blitted along the quay's own heading. The skirt has to reach the
       * SEA BED, not the shore: the outer half of the slab stands in water. */
      const L3 = PB();
      let bed = h.y;
      for (let t = 0; t <= 1.0001; t += 0.2) {
        const px = h.x + h.hx * (h.quay || 46) * t;
        const pz = h.z + h.hz * (h.quay || 46) * t;
        const g = height(px, pz);
        if (Number.isFinite(g)) bed = Math.min(bed, g);
      }
      buildHarbour(L3, rng(hash3i(Math.round(h.x), Math.round(h.z), 0x48b0, this.seed)), h, h.y - bed + 0.8);
      blit(M, L3, h.x, h.y, h.z, h.heading, 1);
    }

    if (airfields && airfields.length) this._airfields.set(key, airfields);
    for (const f of airfields || []) {
      /* One geometry per airfield, blitted at the strip's own heading. The skirt depth is worked
       * out the same way a station's is: how far the ground falls away under the slab. */
      const L2 = PB();
      let lo = f.y;
      for (let t = -1; t <= 1.0001; t += 0.25) {
        for (const w of [-1, 1]) {
          const px = f.x + f.hx * f.halfLen * t - f.hz * f.halfWid * w;
          const pz = f.z + f.hz * f.halfLen * t + f.hx * f.halfWid * w;
          const h = height(px, pz);
          if (Number.isFinite(h)) lo = Math.min(lo, h);
        }
      }
      buildAirfield(L2, rng(hash3i(Math.round(f.x), Math.round(f.z), 0x41f1, this.seed)), f, f.y - lo + 0.5);
      blit(M, L2, f.x, f.y, f.z, f.heading, 1);
    }

    for (const s of stations) {
      /* Where the slab's top face goes, and how deep its skirt has to reach — ONE function,
       * in src/world/props.js, taking the tile's real ground probe. It used to be seven
       * offsets and a clamp toward `s.y` written out here, and `s.y` is the host edge's own
       * graded height from a surface (`land()`) the car does not drive on: see stationPad's
       * own header for the 16 m of floating tarmac that cost. The slab now sits on the
       * HIGHEST real ground under the apron, so a forecourt can never be buried. */
      const pad = stationPad(s, height);
      const y = pad.y;
      const L = PB();
      buildStation(L, rng(hash3i(Math.round(s.x), Math.round(s.z), 0x5747, this.seed)), y - pad.lo + 0.4, !!s.deal);
      blit(M, L, s.x, y, s.z, s.yaw, 1);
      s.padY = y;
      s.padLo = pad.lo;
      s.tile = key;

      // The access spur: a real, short, paved connection from the edge of the host road's
      // own tarmac to this forecourt — see buildAccessSpur's own comment for why this shape
      // and not a full lattice junction. Built straight into the shared tile mesh in world
      // space (no blit() needed), so it costs nothing extra in draw calls. The ground probe
      // goes with it: the driveway FOLLOWS the ground the car drives on rather than spanning
      // between its two ends in a straight line over whatever is in between.
      const spur = stationSpur(s);
      buildAccessSpur(M, spur.mouthX, spur.mouthZ, pad.hRoad, spur.apronX, spur.apronZ, y, s.width, height);
    }

    /* A litter bin beside every fuel can — see buildLitterBin's own comment for what it is and
     * why it is placed here rather than in world/props.js's catalogue.
     *
     * INTO THE SHARED TILE MESH, deliberately: a bin has no bob, no collection and no reason to
     * be its own draw call, and baking it here means it survives the can being taken (the road
     * keeps its bin) and is released with the tile like every other prop.
     *
     * WHICH SIDE. Straight-line offsets in the can's own random yaw would sometimes put a bin
     * a metre from the tarmac. So the direction is chosen AWAY FROM THE ROAD, and it is
     * measured, not guessed: the road field's carve() is asked for the distance to the
     * centreline at both candidate positions and the further one wins. That is the same
     * RoadField every other part of this project reads (gotcha 6 — one elevation/one road
     * truth), never a second opinion about where the road is. Falls back to the can's own yaw
     * if a probe without a road field is ever handed in (a harness fixture), which is still
     * always at least 1.1 m clear of the tarmac — see BIN_OFFSET. */
    const roads = job.terr && job.terr.roads;
    const carveA = { edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0 };
    for (const c of cans) {
      let dx = Math.sin(c.yaw);
      let dz = Math.cos(c.yaw);
      if (roads && roads.carve) {
        const at = roads.carve(c.x, c.z, carveA);
        // The two normals to the road's tangent. +X is on your LEFT looking down +Z (gotcha 1),
        // so these are simply the tangent rotated both ways; which one points outward is what
        // the two probes below decide, rather than a sign anyone has to get right by reasoning.
        const nx = at.tz;
        const nz = -at.tx;
        const dA = roads.carve(c.x + nx * BIN_OFFSET, c.z + nz * BIN_OFFSET, carveA).d;
        const dB = roads.carve(c.x - nx * BIN_OFFSET, c.z - nz * BIN_OFFSET, carveA).d;
        const s = dA >= dB ? 1 : -1;
        dx = nx * s;
        dz = nz * s;
      }
      const bx = c.x + dx * BIN_OFFSET;
      const bz = c.z + dz * BIN_OFFSET;
      const L = PB();
      // Same "keyed on rounded world position, not on build order" rule the props above use, so
      // a bin keeps its variation across a tile rebuild.
      buildLitterBin(L, rng(hash3i(Math.round(bx * 4), Math.round(bz * 4), 0x6a19, this.seed)));
      // Facing the can, so the lit band and the ribs are square-on to a driver arriving at it.
      blit(M, L, bx, height(bx, bz) - 0.02, bz, Math.atan2(-dx, -dz), 1);
    }

    let mesh = null;
    if (M.n) {
      const geom = finishPainted(M);
      mesh = new Mesh(geom, this.material);
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix(); // identity: every vertex is already in absolute world metres
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }

    if (this.solids) {
      // With the tile's real ground probe, so the forecourt's own raised EDGE gets colliders
      // as well as the buildings standing on it — see stationSolids' section comment.
      const list = propSolids(props).concat(stationSolids(stations, height));
      if (list.length) this.solids.addChunk(`prop:${key}`, list);
    }
    for (const s of stations) {
      this.stations.push(s);
      this.known.set(s.key, s);
    }
    if (this.known.size > KNOWN_STATIONS) this._forgetFurthest();

    /* Fuel cans: one small mesh EACH, never folded into M above — see the constructor's
     * comment on why a can cannot be a static bake. Skips anything already in
     * `_collectedCans`, which is what stops a taken can reappearing when its tile reloads —
     * fuelCansInBox itself does not know about collection, by design (it is a pure function
     * of the seed, same as every other placement query in this file). */
    const canKeys = [];
    for (const c of cans) {
      if (this._collectedCans.has(c.key)) continue;
      const L = PB();
      buildFuelCan(L, rng(hash3i(Math.round(c.x * 4), Math.round(c.z * 4), 0x6a17, this.seed)));
      const CM = PB();
      blit(CM, L, c.x, c.y, c.z, c.yaw, 1);
      const cgeom = finishPainted(CM);
      const cmesh = new Mesh(cgeom, this.material);
      cmesh.frustumCulled = true;
      cmesh.matrixAutoUpdate = false;
      cmesh.updateMatrix();
      cmesh.renderOrder = 2;
      this.group.add(cmesh);
      /* The glow. A separate additive billboard rather than more EMIT geometry, because EMIT is
       * still an opaque painted face — it cannot bleed past its own silhouette, and "bleeds past
       * its own silhouette" is the entire definition of a halo. renderOrder 3 puts it after the
       * opaque pass; depthWrite off so it never occludes anything, depthTest ON so terrain
       * still hides it. Null in node (no DOM, no canvas) — see haloTexture(). */
      let halo = null;
      const htex = haloTexture();
      if (htex) {
        halo = new Sprite(
          new SpriteMaterial({
            map: htex,
            blending: AdditiveBlending,
            transparent: true,
            depthWrite: false,
            opacity: CAN_HALO_A,
          })
        );
        halo.scale.set(CAN_HALO_R * 2, CAN_HALO_R * 2, 1);
        halo.renderOrder = 3;
        // Centred on the middle of the scaled can, not on its base.
        halo.position.set(c.x, c.y + CAN_HOVER + 0.2 * CAN_SCALE, c.z);
        this.group.add(halo);
      }
      this.cans.set(c.key, {
        mesh: cmesh,
        halo,
        baseY: c.y + CAN_HOVER + 0.2 * CAN_SCALE,
        x: c.x,
        z: c.z,
        // Own bob phase per can, keyed on position like the props' own sway phase above, so
        // it is stable across a tile rebuild rather than jumping when build order changes.
        phase: rng(hash3i(Math.round(c.x * 4), Math.round(c.z * 4), 0x6a18, this.seed))() * TAU,
        tile: key,
      });
      canKeys.push(c.key);
    }

    this.live.set(key, { mesh, props, stations, cans: canKeys, verts: M.n, tris: M.idx.length / 3 });
    this._recount();
  }

  _release(key, rec) {
    if (rec.mesh) {
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
    }
    if (this.solids) this.solids.removeChunk(`prop:${key}`);
    if (rec.stations.length) this.stations = this.stations.filter((s) => s.tile !== key);
    for (const ck of rec.cans || []) {
      const c = this.cans.get(ck);
      if (!c) continue; // already collected, and therefore already removed by _updateCans
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      this._dropHalo(c);
      this.cans.delete(ck);
    }
    this.live.delete(key);
    this._recount();
  }

  /** Drop the stations furthest from the middle of the live window. */
  _forgetFurthest() {
    const cx = (this._lastCx + 0.5) * this.tile;
    const cz = (this._lastCz + 0.5) * this.tile;
    const list = [...this.known.values()].sort(
      (a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)
    );
    for (let i = KNOWN_STATIONS; i < list.length; i++) this.known.delete(list[i].key);
  }

  _recount() {
    let props = 0;
    let verts = 0;
    let tris = 0;
    for (const rec of this.live.values()) {
      props += rec.props.length;
      verts += rec.verts;
      tris += rec.tris;
    }
    this.stats.tiles = this.live.size;
    this.stats.props = props;
    this.stats.stations = this.stations.length;
    this.stats.cans = this.cans.size;
    this.stats.verts = verts;
    this.stats.tris = tris;
  }

  dispose() {
    this._job = null;
    this.pending.length = 0;
    this.known.clear();
    for (const [key, rec] of [...this.live]) this._release(key, rec);
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

/**
 * Turn placed props into collision solids, the same shape game/collide.js wants from
 * scatter. Only the kinds whose catalogue entry declares a radius: a bench, a flower bed and
 * a fingerpost are things you brush past, and stopping the car dead on a fingerpost is the
 * least cozy thing in the file.
 */
export function propSolids(props) {
  const out = [];
  for (const p of props) {
    const k = PROP_BY_ID[p.id];
    if (!k || !k.r) continue;
    out.push({ x: p.x, z: p.z, y: p.y, r: k.r * p.scale, h: k.h * p.scale, kind: 'prop' });
  }
  return out;
}

/** For the acceptance harness: which catalogue ids have no geometry. */
export function missingGeometry() {
  return PROP_IDS.filter((id) => typeof BUILDERS[id] !== 'function');
}

/** For the acceptance harness: build one of everything and report its size and extent. */
export function measureAll() {
  const out = [];
  for (const id of PROP_IDS) {
    const b = BUILDERS[id];
    if (!b) continue;
    const M = PB();
    b(M, rng(hash3i(1, 2, 3, 4)), 0.5);
    let minY = Infinity;
    let maxY = -Infinity;
    let maxR = 0;
    for (let i = 0; i < M.n; i++) {
      const x = M.pos[i * 3];
      const y = M.pos[i * 3 + 1];
      const z = M.pos[i * 3 + 2];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const rr = Math.hypot(x, z);
      if (rr > maxR) maxR = rr;
    }
    out.push({ id, verts: M.n, tris: M.idx.length / 3, minY, maxY, radius: maxR });
  }
  return out;
}

export { BUILDERS };
