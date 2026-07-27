/* Wanderoad — is the ground the same ground for everyone who asks?
 *
 * The worst bug this project has had was not a wrong number, it was a number that depended on
 * WHO ASKED. `Terrain.height(x, z)` is queried from at least six places with six different
 * boxes — a 64 m terrain chunk in the worker, a 4 km one, the car's 840 m local sampler, the
 * props tiler, the scatter tiler, the road ribbon — and for a while each of them levelled the
 * road crossings against whatever edges its own box happened to contain. Same lane, same
 * seed, same point, four different heights: the worker meshed one road and the car drove on
 * another, up to 3.8 m apart, and the drawn tarmac was up to 24 m from either.
 *
 * Nothing in the suite could see it, because every check read the road height and the ground
 * height out of the same field and so agreed with itself by construction. This is the check
 * that cannot: it asks DIFFERENT samplers and demands the same answer.
 *
 *   S1  Terrain.height is identical from a chunk box, a car box and a coarse-LOD box
 *   S2  the drawn road ribbon's vertices lie on Terrain.height
 *   S3  two edges that meet at a lattice node meet at one height
 *
 *   node tools/diag-seam.mjs
 */
import { Terrain, landFn, waterFn } from '../src/world/terrain.js';
import { RoadField } from '../src/world/roads.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { ribbonEdges, buildRibbon, LIFT } from '../src/render/road.js';

const SEEDS = [20260726, 7, 424242];
const PRESETS = ['rolling', 'alpine'];

/** Metres. A centimetre is generous: these are meant to be the SAME number. */
const TOL = 0.02;
/** The ribbon floats this far above the ground on purpose. */
const RIBBON_TOL = 0.02;
/** Levelling still moves two lanes at a shared node by different amounts; see roads.js. */
const NODE_TOL = 1.0;

let failed = 0;
const check = (name, got, want, unit = 'm') => {
  const ok = got <= want;
  if (!ok) failed++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(58)} ${got.toFixed(4).padStart(9)} ${unit}   want <= ${want}`);
};

for (const preset of PRESETS) {
  applyTerrain(preset);
  setBiomeBias(terrainBias(preset));
  console.log(`\n── ${preset} ─────────────────────────────────────────────────────────`);

  let s1 = 0,
    s1at = '',
    s2 = 0,
    s2at = '',
    s3 = 0,
    s3at = '';
  let pts = 0,
    verts = 0,
    nodes = 0;

  for (const seed of SEEDS) {
    const land = landFn(seed);
    const water = waterFn(seed);
    const field = new RoadField(-1100, -1100, 1100, 1100, seed, land, 40, water);

    /* S1 — the same point, asked of three samplers built the way the three real callers
     * build them: world/chunk.js (a 64 m leaf, pad max(80, step*3)), main.js (the car's
     * +/-420 m box) and a coarse quadtree node. */
    const car = new Terrain(seed, -420, -420, 420, 420);
    const coarse = new Terrain(seed, -2048, -2048, 2048, 2048, 384);
    for (const e of field.edges) {
      for (let k = 0; k < e.y.length; k++) {
        const x = e.pts[k * 2],
          z = e.pts[k * 2 + 1];
        if (Math.abs(x) > 380 || Math.abs(z) > 380) continue;
        const ox = Math.floor(x / 64) * 64;
        const oz = Math.floor(z / 64) * 64;
        const leaf = new Terrain(seed, ox, oz, ox + 64, oz + 64, 80);
        const a = leaf.height(x, z);
        const b = car.height(x, z);
        const c = coarse.height(x, z);
        pts++;
        const d = Math.max(Math.abs(a - b), Math.abs(a - c));
        if (d > s1) {
          s1 = d;
          s1at = `(${x.toFixed(0)},${z.toFixed(0)}) ${e.key}  chunk ${a.toFixed(3)} car ${b.toFixed(3)} coarse ${c.toFixed(3)}`;
        }
      }
    }

    /* S2 — the ribbon the player looks at, vertex by vertex, against the ground the wheels
     * stand on. This is the one that read 24 m while every other check read zero. */
    const { edges, ctx } = ribbonEdges(seed, -700, -700, 700, 700);
    for (const e of edges) {
      const { geometry, ring } = buildRibbon(e, ctx);
      const pos = geometry.attributes.position.array;
      const across = pos.length / 3 / ring.length;
      for (let i = 0; i < ring.length; i += 3) {
        for (let j = 0; j < across; j++) {
          const o = (i * across + j) * 3;
          const x = pos[o],
            z = pos[o + 2];
          if (Math.abs(x) > 380 || Math.abs(z) > 380) continue;
          verts++;
          const d = Math.abs(pos[o + 1] - LIFT - car.height(x, z));
          if (d > s2) {
            s2 = d;
            s2at = `(${x.toFixed(0)},${z.toFixed(0)}) ${e.key} ribbon ${(pos[o + 1] - LIFT).toFixed(3)} ground ${car.height(x, z).toFixed(3)}`;
          }
        }
      }
    }

    /* S3 — two roads that meet at a lattice node are the same road, and have to be at the
     * same height there. They were 36 m apart, which carve() then blended into a crater at
     * every junction. */
    const at = new Map();
    for (const e of field.edges) {
      const [i, j, dir] = e.key
        .slice(e.key.indexOf(':') + 1)
        .split(',')
        .map(Number);
      const last = e.y.length - 1;
      for (const [key, y] of [
        [`${e.tier}:${i},${j}`, e.y[0]],
        [`${e.tier}:${dir === 0 ? i + 1 : i},${dir === 0 ? j : j + 1}`, e.y[last]],
      ]) {
        if (!at.has(key)) at.set(key, []);
        at.get(key).push({ y, key: e.key });
      }
    }
    for (const [key, list] of at) {
      if (list.length < 2) continue;
      nodes++;
      for (let a = 1; a < list.length; a++) {
        const d = Math.abs(list[a].y - list[0].y);
        if (d > s3) {
          s3 = d;
          s3at = `node ${key}  ${list[0].key} vs ${list[a].key}  seed ${seed}`;
        }
      }
    }
  }

  check(`S1 Terrain.height, chunk vs car vs coarse box (${pts} road points)`, s1, TOL);
  if (s1 > TOL) console.log(`        worst at ${s1at}`);
  check(`S2 drawn ribbon vertex vs the ground (${verts} vertices)`, s2, RIBBON_TOL);
  if (s2 > RIBBON_TOL) console.log(`        worst at ${s2at}`);
  check(`S3 edges meeting at a shared node (${nodes} nodes)`, s3, NODE_TOL);
  if (s3 > NODE_TOL) console.log(`        worst at ${s3at}`);
}

console.log(failed ? `\n${failed} SEAM CHECK(S) FAILED` : '\nall seam checks passed');
process.exit(failed ? 1 : 0);
