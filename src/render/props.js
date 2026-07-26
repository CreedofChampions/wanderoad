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

import { Mesh, Object3D } from 'three';
import { PB, pv, pq, pbox, pcyl, proof, pquad, finishPainted, createPaintedMaterial, MAT, LC, tint, mixc } from './painted.js';
import { Terrain } from '../world/terrain.js';
import { waterLevelAt, BIOME_COUNT } from '../world/biomes.js';
import { propsInBox, stationsInBox, PROP_BY_ID, PROP_IDS } from '../world/props.js';
import { TAU, rng, hash3i, clamp, lerp } from '../core/math.js';

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
export function buildStation(M, r, skirt) {
  const AW = 9.5; // apron half-width, along the road
  const AD = 7.0; // apron half-depth, away from the road
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
  pbox(M, 0, CH + 0.5, 1.0, CW + 0.95, 0.14, CD + 0.95, 0, VERMILION, MAT.MATTE);
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
    this.stats = { tiles: 0, props: 0, stations: 0, verts: 0, tris: 0, buildMs: 0, backlog: 0 };
    this._scratchW = new Float32Array(BIOME_COUNT);
  }

  /** Nearest station this session knows about, or null. Cheap: a scan of a short list. */
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
        };
        job.phase = 1;
        return;
      }
      case 1:
        job.props = propsInBox(ox, oz, ox + size, oz + size, this.seed, job.probe);
        job.phase = 2;
        return;
      case 2:
        job.stations = stationsInBox(ox, oz, ox + size, oz + size, this.seed);
        job.phase = 3;
        return;
      default:
        this._bake(job);
        this._job = null;
    }
  }

  /** Turn one tile's queried props into one geometry, one mesh and one solids block. */
  _bake(job) {
    const { key, props, stations } = job;
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

    for (const s of stations) {
      // Level with the road, but never buried: if the ground at a corner of the apron is
      // above the road, lift the slab to meet it, capped so the step off the carriageway
      // stays something a car drives over rather than climbs.
      let lo = Infinity;
      let hi = -Infinity;
      for (const [dx, dz] of [[0, 0], [9, 6], [-9, 6], [9, -6], [-9, -6], [0, 7], [0, -7]]) {
        const ca = Math.cos(s.yaw);
        const sa = Math.sin(s.yaw);
        const g = height(s.x + dx * ca - dz * sa, s.z + dx * sa + dz * ca);
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
      const y = clamp(hi + 0.04, s.y - 0.7, s.y + 0.3);
      const L = PB();
      buildStation(L, rng(hash3i(Math.round(s.x), Math.round(s.z), 0x5747, this.seed)), y - lo + 0.4);
      blit(M, L, s.x, y, s.z, s.yaw, 1);
      s.padY = y;
      s.tile = key;
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
      const list = propSolids(props);
      if (list.length) this.solids.addChunk(`prop:${key}`, list);
    }
    for (const s of stations) {
      this.stations.push(s);
      this.known.set(s.key, s);
    }
    if (this.known.size > KNOWN_STATIONS) this._forgetFurthest();

    this.live.set(key, { mesh, props, stations, verts: M.n, tris: M.idx.length / 3 });
    this._recount();
  }

  _release(key, rec) {
    if (rec.mesh) {
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
    }
    if (this.solids) this.solids.removeChunk(`prop:${key}`);
    if (rec.stations.length) this.stations = this.stations.filter((s) => s.tile !== key);
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
