/* Wanderoad — chunk meshing.
 *
 * The world is a quadtree of square nodes. A node always has the SAME vertex count
 * (GRID×GRID) whatever its size, so a 4 km node costs exactly as much to build as a 128 m
 * one — cost scales with the number of visible nodes, not with the area they cover. That
 * is what makes an 8 km view distance affordable.
 *
 * Cracks between neighbouring LODs are closed with a skirt: a ring of vertices dropped
 * straight down from the node's edge. It is one extra quad strip, it never needs to know
 * what the neighbour did, and under this game's flat painterly shading the skirt is
 * invisible — a stitched or morphed seam would cost far more for no visible gain.
 *
 * Everything in this file is pure and worker-safe: no three.js, no DOM, no globals.
 */

import { Terrain } from './terrain.js';
import { BIOME_COUNT, waterLevelAt, BIOME_TERRAIN } from './biomes.js';
import { clamp01 } from '../core/math.js';

/** Smallest node in metres. At GRID 65 that is 1 m between vertices under the wheels — a
 *  road is eight metres wide, so it gets eight quads across and reads as a road rather
 *  than as a polygon. */
export const LEAF = 64;
/** Depth of the quadtree. LEAF * 2^(LEVELS-1) is the biggest node: 8.2 km. */
export const LEVELS = 8;
/** Skirt depth in metres — must exceed the worst height difference across one LOD step. */
const SKIRT = 30;

/**
 * Vertices per side, by level. Constant vertex count per node means a 4 km node costs the
 * same as a 64 m one — but it also means the far field spends as many vertices as the near
 * field, which is exactly backwards. Dropping to 33 beyond the third ring halves the
 * vertex budget of the five biggest levels and is invisible past 800 m.
 */
export const gridFor = (level) => (level <= 2 ? 65 : 33);

/** The finest grid — used by anything that indexes the level-0 height cache. */
export const GRID = 65;

/** World size of a node at a given LOD level (0 = finest). */
export const nodeSize = (level) => LEAF * (1 << level);

/**
 * Build one terrain node.
 *
 * @param {object} req  { cx, cz, level, seed }  cx/cz are node indices at that level
 * @returns {object} transferable-friendly buffers plus metadata
 */
export function buildChunk(req) {
  const { cx, cz, level, seed } = req;
  const size = nodeSize(level);
  const GRID = gridFor(level);
  const ox = cx * size;
  const oz = cz * size;
  const step = size / (GRID - 1);

  // One Terrain per node: it caches the climate grid and the local road edges for this
  // box, so the per-vertex cost collapses to noise plus a handful of segment distances.
  const terr = new Terrain(seed, ox, oz, ox + size, oz + size, Math.max(80, step * 3));

  const n = GRID * GRID;
  const skirtCount = (GRID - 1) * 4;
  const vertCount = n + skirtCount;

  const position = new Float32Array(vertCount * 3);
  const normal = new Float32Array(vertCount * 3);
  const biome = new Uint8Array(vertCount * 4); // weights 0..3; index 4 = 255 - sum
  const road = new Uint8Array(vertCount * 2); // [carve mask, carriageway]
  const heights = new Float32Array(n); // kept for CPU collision on the finest level

  let minY = Infinity;
  let maxY = -Infinity;
  let waterMin = Infinity;
  let waterMax = -Infinity;
  let hasWater = false;

  const w = new Float32Array(BIOME_COUNT);
  const carve = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0 };

  // ── grid vertices ──
  for (let j = 0; j < GRID; j++) {
    const z = oz + j * step;
    for (let i = 0; i < GRID; i++) {
      const x = ox + i * step;
      const k = j * GRID + i;

      const y = terr.height(x, z);
      heights[k] = y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      // Local coordinates. The node origin goes to the shader as a uniform, so a vertex
      // never carries a value bigger than the node size and float32 keeps full precision
      // no matter how far from the origin the player has driven.
      position[k * 3] = i * step;
      position[k * 3 + 1] = y;
      position[k * 3 + 2] = j * step;

      terr.weights(x, z, w);
      biome[k * 4] = (w[0] * 255) | 0;
      biome[k * 4 + 1] = (w[1] * 255) | 0;
      biome[k * 4 + 2] = (w[2] * 255) | 0;
      biome[k * 4 + 3] = (w[3] * 255) | 0;

      terr.roads.carve(x, z, carve);
      road[k * 2] = (clamp01(carve.mask) * 255) | 0;
      road[k * 2 + 1] = (clamp01(carve.edge) * 255) | 0;

      const wl = waterLevelAt(w, y);
      if (wl !== null) {
        hasWater = true;
        if (wl < waterMin) waterMin = wl;
        if (wl > waterMax) waterMax = wl;
      }
    }
  }

  // ── normals from the mesh itself ──
  // Central differences on the stored grid rather than four more height() calls: same
  // result, a quarter of the cost, and it is guaranteed consistent with the triangles we
  // actually draw (a car wheel and a lit pixel then agree about which way is up).
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i;
      const hl = heights[j * GRID + Math.max(0, i - 1)];
      const hr = heights[j * GRID + Math.min(GRID - 1, i + 1)];
      const hd = heights[Math.max(0, j - 1) * GRID + i];
      const hu = heights[Math.min(GRID - 1, j + 1) * GRID + i];
      const sx = i === 0 || i === GRID - 1 ? step : step * 2;
      const sz = j === 0 || j === GRID - 1 ? step : step * 2;
      let nx = (hl - hr) / sx;
      let nz = (hd - hu) / sz;
      const len = Math.hypot(nx, 1, nz);
      normal[k * 3] = nx / len;
      normal[k * 3 + 1] = 1 / len;
      normal[k * 3 + 2] = nz / len;
    }
  }

  // ── indices ──
  const quadCount = (GRID - 1) * (GRID - 1);
  const idxCount = quadCount * 6 + skirtCount * 6;
  const Index = vertCount > 65535 ? Uint32Array : Uint16Array;
  const index = new Index(idxCount);
  let t = 0;
  for (let j = 0; j < GRID - 1; j++) {
    for (let i = 0; i < GRID - 1; i++) {
      const a = j * GRID + i;
      const b = a + 1;
      const c = a + GRID;
      const d = c + 1;
      // Flip the diagonal per quad so the triangulation does not comb the whole surface in
      // one direction — a uniform diagonal is very visible on a gentle slope.
      if (((i ^ j) & 1) === 0) {
        index[t++] = a;
        index[t++] = c;
        index[t++] = b;
        index[t++] = b;
        index[t++] = c;
        index[t++] = d;
      } else {
        index[t++] = a;
        index[t++] = c;
        index[t++] = d;
        index[t++] = a;
        index[t++] = d;
        index[t++] = b;
      }
    }
  }

  // ── skirt ──
  // Walk the border clockwise, dropping a copy of every edge vertex by SKIRT metres.
  let s = n;
  const addSkirt = (edgeIdx) => {
    const src = edgeIdx * 3;
    position[s * 3] = position[src];
    position[s * 3 + 1] = position[src + 1] - SKIRT;
    position[s * 3 + 2] = position[src + 2];
    // Skirt normals point outward-ish; they are never really lit, but a sane normal keeps
    // the NaN firewall and the fog term happy.
    normal[s * 3] = normal[src];
    normal[s * 3 + 1] = normal[src + 1];
    normal[s * 3 + 2] = normal[src + 2];
    biome[s * 4] = biome[edgeIdx * 4];
    biome[s * 4 + 1] = biome[edgeIdx * 4 + 1];
    biome[s * 4 + 2] = biome[edgeIdx * 4 + 2];
    biome[s * 4 + 3] = biome[edgeIdx * 4 + 3];
    road[s * 2] = road[edgeIdx * 2];
    road[s * 2 + 1] = road[edgeIdx * 2 + 1];
    return s++;
  };

  const border = [];
  for (let i = 0; i < GRID - 1; i++) border.push(i); // north edge, +x
  for (let j = 0; j < GRID - 1; j++) border.push(j * GRID + (GRID - 1)); // east, +z
  for (let i = GRID - 1; i > 0; i--) border.push((GRID - 1) * GRID + i); // south, -x
  for (let j = GRID - 1; j > 0; j--) border.push(j * GRID); // west, -z

  const skirtIdx = border.map(addSkirt);
  for (let e = 0; e < border.length; e++) {
    const a = border[e];
    const b = border[(e + 1) % border.length];
    const c = skirtIdx[e];
    const d = skirtIdx[(e + 1) % border.length];
    index[t++] = a;
    index[t++] = c;
    index[t++] = b;
    index[t++] = b;
    index[t++] = c;
    index[t++] = d;
  }

  // ── water ──
  // One flat quad per chunk at the blended local level, drawn only when some of the
  // terrain is actually below it. Stylised water does not need geometry — the shader does
  // the work — so a two-triangle plane clipped by the terrain is exactly enough.
  let water = null;
  if (hasWater) {
    const level = (waterMin + waterMax) * 0.5;
    water = { level, minY, maxY };
  }

  return {
    cx,
    cz,
    level,
    size,
    ox,
    oz,
    step,
    grid: GRID,
    minY,
    maxY,
    vertCount,
    position,
    normal,
    biome,
    road,
    index,
    heights: level === 0 ? heights : null,
    water,
  };
}

/** The list of ArrayBuffers to transfer when posting a built chunk back. */
export function chunkTransferables(c) {
  const list = [c.position.buffer, c.normal.buffer, c.biome.buffer, c.road.buffer, c.index.buffer];
  if (c.heights) list.push(c.heights.buffer);
  return list;
}
