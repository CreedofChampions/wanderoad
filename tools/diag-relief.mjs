/* How much land is there, and is there anywhere to go?
 *
 * Two numbers the operator actually feels:
 *
 *   RELIEF — max minus min land height inside a 720 m square, which is roughly what fits on
 *            screen at a cozy speed. 9 m of this is a flatline; you want tens.
 *   RISE   — the best hill within 4 km of spawn, and whether you can SEE it from there. A
 *            landmark you cannot see is not a landmark, so line of sight is checked against
 *            the ground between you and it rather than assumed.
 *
 * Runs on raw land only (landHeight, no roads) because that is the layer the presets touch
 * and the layer the road network itself reads. Deterministic: same seed, same numbers.
 */
import { landHeight, findSpawn } from '../src/world/terrain.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { applyTerrain, terrainBias, TERRAINS } from '../src/game/presets.js';

const SEED = Number(process.argv[3] || 20260726);
const WIN = 720; // the square the operator is looking at
const ONLY = process.argv[2] && TERRAINS[process.argv[2]] ? process.argv[2] : null;

/** Relief inside one WIN×WIN square. */
function relief(cx, cz, step = 20) {
  let lo = Infinity,
    hi = -Infinity;
  for (let x = cx - WIN / 2; x <= cx + WIN / 2; x += step) {
    for (let z = cz - WIN / 2; z <= cz + WIN / 2; z += step) {
      const h = landHeight(x, z, SEED);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  return hi - lo;
}

/* Fixed sample squares spread over 16 km — an odd stride so they do not all land on the same
 * phase of any one field. */
const SQUARES = [];
for (let i = 0; i < 28; i++) {
  SQUARES.push([((i * 2113) % 16000) - 8000, ((i * 3571) % 16000) - 8000]);
}

function reliefStats(name) {
  applyTerrain(name);
  setBiomeBias(terrainBias(name));
  const vals = SQUARES.map(([x, z]) => relief(x, z)).sort((a, b) => a - b);
  const med = vals[vals.length >> 1];
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { name, med, mean, min: vals[0], max: vals[vals.length - 1] };
}

console.log(`seed ${SEED} — relief in a ${WIN} m square, ${SQUARES.length} squares over 16 km\n`);
console.log('preset      median    mean     min     max');
for (const name of Object.keys(TERRAINS)) {
  if (ONLY && name !== ONLY) continue;
  const s = reliefStats(name);
  console.log(
    `${s.name.padEnd(10)} ${s.med.toFixed(1).padStart(7)} ${s.mean.toFixed(1).padStart(7)} ` +
      `${s.min.toFixed(1).padStart(7)} ${s.max.toFixed(1).padStart(7)}`
  );
}

/* ── at spawn ────────────────────────────────────────────────────────────────
 * The browser suite measures W4 and W5 where the CAR is, not over a 16 km average, and
 * that is the honest test: a world with 100 m of relief somewhere is still a flatline if
 * spawn sits on the one plateau. findSpawn deliberately looks for the flattest arterial
 * point it can find, so this is the pessimistic reading by construction. */
function atSpawn(name) {
  applyTerrain(name);
  setBiomeBias(terrainBias(name));
  const sp = findSpawn(SEED);
  const y0 = landHeight(sp.x, sp.z, SEED);

  // W4's own window: 24×24 samples at 30 m, exactly what tools/browser-test.mjs does.
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < 24; i++)
    for (let j = 0; j < 24; j++) {
      const h = landHeight(sp.x + (i - 12) * 30, sp.z + (j - 12) * 30, SEED);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }

  // W5: high ground within 4 km that you can actually SEE from the driver's seat.
  const cands = [];
  for (let x = -4000; x <= 4000; x += 40) {
    for (let z = -4000; z <= 4000; z += 40) {
      const d = Math.hypot(x, z);
      if (d > 4000 || d < 300) continue;
      const h = landHeight(sp.x + x, sp.z + z, SEED);
      cands.push({ x: sp.x + x, z: sp.z + z, h, d });
    }
  }
  cands.sort((a, b) => b.h - a.h);

  /* Line of sight: eye 1.6 m over the ground at spawn (the DRIVER's eye, not the chase
   * camera, which sits several metres higher and would flatter the answer). Walk the ground
   * between and find how far it pokes above the sight line — positive means hidden.
   *
   * The tallest point within 4 km is often a summit whose last few metres are grazed by a
   * nearer ridge, which says nothing useful; what the requirement asks is whether there is
   * high ground you can see and steer at. So walk the candidates down from the top and
   * report the first one that is genuinely in view. */
  const eye = y0 + 1.6;
  const occlusion = (c) => {
    let block = -Infinity;
    const N = 200;
    for (let k = 1; k < N; k++) {
      const t = k / N;
      const g = landHeight(sp.x + (c.x - sp.x) * t, sp.z + (c.z - sp.z) * t, SEED);
      block = Math.max(block, g - (eye + (c.h - eye) * t));
    }
    return block;
  };
  const top = cands[0];
  let seen = null;
  for (let i = 0; i < cands.length && i < 900; i += 3) {
    const b = occlusion(cands[i]);
    if (b < 0) {
      seen = { ...cands[i], block: b };
      break;
    }
  }
  return { name, sp, y0, relief: hi - lo, top, rise: top.h - y0, seen };
}

console.log('\nat the real spawn (findSpawn) — W4 window and W5 landmark');
console.log('preset     spawn x,z            relief  bestRise  VISIBLE rise  dist(m)  clear(m)');
for (const name of Object.keys(TERRAINS)) {
  if (ONLY && name !== ONLY) continue;
  const r = atSpawn(name);
  const v = r.seen;
  console.log(
    `${r.name.padEnd(10)} ${(r.sp.x.toFixed(0) + ',' + r.sp.z.toFixed(0)).padEnd(18)} ` +
      `${r.relief.toFixed(1).padStart(6)} ${r.rise.toFixed(1).padStart(9)}   ` +
      (v
        ? `${(v.h - r.y0).toFixed(1).padStart(11)} ${v.d.toFixed(0).padStart(8)} ${(-v.block).toFixed(1).padStart(9)}`
        : '     none visible')
  );
}

/* ── W5, the other way round: is there a MASSIF on the skyline? ──────────────
 *
 * The column above measures the biggest visible RISE within 4 km, in metres, and it is not the
 * same question. An audit stood at the old default spawn — where that column read a healthy
 * 314 m — photographed all four cardinal directions, and reported flat plains on three of them
 * and "faint hills lost in haze". Both readings were honest: 314 m at 2.8 km is 6.3° spread
 * across a broad swell, which is scenery, not a destination.
 *
 * So this prints what the requirement actually asks for — "a TALL DISTANT LANDMARK visible from
 * spawn so there is somewhere to head towards" — as the two numbers that decide it: how tall
 * the NEAREST massif is, and how many degrees of sky the most dominant one fills. At the old
 * spawn the nearest massif was 104 m, which is the very bottom of the 90–330 m range, and that
 * is the number that matches what the photographs showed.
 *
 * Read the two blocks TOGETHER. `findSpawn` now scores this (see terrain.js), and the two
 * metrics genuinely trade against each other: moving the spawn under a near massif can lower
 * the best-rise-within-4-km figure while raising the dominance of the thing on the skyline.
 */
console.log('\nW5 again — the massif on the skyline (what "somewhere to head for" actually means)');
console.log('preset     nearest massif        most dominant massif in view');
for (const name of Object.keys(TERRAINS)) {
  if (ONLY && name !== ONLY) continue;
  applyTerrain(name);
  setBiomeBias(terrainBias(name));
  const sp = findSpawn(SEED, 0, 0, TERRAINS[name]?.spawn || {});
  const { nearestLandmark, landmarkView } = await import('../src/world/landmarks.js');
  const n = nearestLandmark(sp.x, sp.z, SEED);
  const v = landmarkView(sp.x, sp.z, SEED, sp.y);
  console.log(
    `${name.padEnd(10)} ${n.h.toFixed(0).padStart(4)} m at ${(n.d / 1000).toFixed(2)} km   ` +
      (v.site
        ? `${v.site.h.toFixed(0).padStart(4)} m at ${(v.site.d / 1000).toFixed(2)} km = ${v.deg.toFixed(1).padStart(4)}° of sky`
        : 'none in range')
  );
}

/* ── steep ground, per preset ────────────────────────────────────────────────
 * tools/diag-cliffs.mjs only ever measures the default world, because it never calls
 * applyTerrain. Alpine runs 1.12x the biome amplitude AND 1.7x the massif height, so it is
 * the configuration most likely to grow a wall, and nothing was watching it. Same method as
 * diag-cliffs — the carved surface normal over a 5 m span — on a coarser grid so all six
 * presets fit in one run. */
console.log('\nground over 45°, per preset (carved surface, 2 km square around spawn)');
console.log('preset      samples   over45      %');
for (const name of Object.keys(TERRAINS)) {
  if (ONLY && name !== ONLY) continue;
  applyTerrain(name);
  setBiomeBias(terrainBias(name));
  const sp = findSpawn(SEED);
  const R = 1000,
    STEP = 6;
  const { Terrain } = await import('../src/world/terrain.js');
  const T = new Terrain(SEED, sp.x - R, sp.z - R, sp.x + R, sp.z + R);
  let n = 0,
    over = 0;
  for (let x = sp.x - R; x < sp.x + R; x += STEP) {
    for (let z = sp.z - R; z < sp.z + R; z += STEP) {
      const nn = T.normal(x, z, 2.5);
      n++;
      if (Math.acos(Math.min(1, nn[1])) * 57.2958 > 45) over++;
    }
  }
  console.log(`${name.padEnd(10)} ${String(n).padStart(8)} ${String(over).padStart(8)} ${((100 * over) / n).toFixed(3).padStart(7)}`);
}

/* ── does any of this reach the screen? ──────────────────────────────────────
 * A worker has its OWN module graph: it never sees a mutation the main thread made, and a
 * worldgen change that is not reachable from src/world/chunkWorker.js looks perfect in a node
 * script and does nothing on screen. chunkWorker calls applyTerrain per job, applyTerrain
 * calls setLandmarkScale, and buildChunk goes through the same Terrain everything else does —
 * so this repeats what the worker does, per preset, and asserts the mesh actually moves.
 *
 * It also re-runs one measurement twice to prove the generator is repeatable, because every
 * number above is worthless if it is not. */
{
  const { buildChunk } = await import('../src/world/chunk.js');
  const { LANDMARK } = await import('../src/world/landmarks.js');
  console.log('\nvia the worker path (buildChunk + applyTerrain, as chunkWorker.js does it)');
  console.log('preset      peak  chunk minY   maxY   relief   repeat-identical');
  // level 0 — the only level that keeps its `heights` array, which is what the car
  // collides against and therefore the thing worth comparing.
  const req = { cx: 6, cz: 9, level: 0, seed: SEED };
  for (const name of Object.keys(TERRAINS)) {
    if (ONLY && name !== ONLY) continue;
    applyTerrain(name);
    setBiomeBias(terrainBias(name));
    const a = buildChunk(req);
    const b = buildChunk(req);
    let same = a.heights.length === b.heights.length;
    for (let i = 0; same && i < a.heights.length; i++) same = a.heights[i] === b.heights[i];
    console.log(
      `${name.padEnd(10)} ${LANDMARK.scale.toFixed(2).padStart(5)} ${a.minY.toFixed(1).padStart(10)} ` +
        `${a.maxY.toFixed(1).padStart(8)} ${(a.maxY - a.minY).toFixed(1).padStart(7)}   ${same ? 'yes' : 'NO — NOT DETERMINISTIC'}`
    );
  }
}

/* ── is the landmark drivable? ───────────────────────────────────────────────
 * A massif that puts a wall across a road is worse than no massif. Two things settle it: the
 * steepest face the dome geometry can produce (a closed form — 1.54·h/r), and the steepest
 * gradient anywhere on the finished road network, which is the number that says whether the
 * roads that climb it are roads or ramps. */
{
  const { nearestLandmark } = await import('../src/world/landmarks.js');
  const { Terrain } = await import('../src/world/terrain.js');
  console.log('\nthe nearest massif, and the roads that have to cross it');
  console.log('preset     summit h(m)  radius(m)  steepest face  median grade  worst grade');
  for (const name of Object.keys(TERRAINS)) {
    if (ONLY && name !== ONLY) continue;
    applyTerrain(name);
    setBiomeBias(terrainBias(name));
    const sp = findSpawn(SEED);
    const lm = nearestLandmark(sp.x, sp.z, SEED);
    const T = new Terrain(SEED, sp.x - 2000, sp.z - 2000, sp.x + 2000, sp.z + 2000, 200);
    /* Gradient over the TRUE horizontal run between samples, not e.span. e.span is the
     * nominal chord/n and ignores the winding, which inflates every gradient by however much
     * the road bends — it read 115% where the real worst is 30%. */
    const g = [];
    for (const e of T.roads.edges) {
      if (e.tier !== 0) continue; // arterials: the roads a cozy cruise is actually on
      for (let k = 1; k < e.y.length; k++) {
        const dx = e.pts[k * 2] - e.pts[k * 2 - 2],
          dz = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
        g.push(Math.abs(e.y[k] - e.y[k - 1]) / (Math.hypot(dx, dz) || 1));
      }
    }
    g.sort((a, b) => a - b);
    const med = g[g.length >> 1],
      worst = g[g.length - 1];
    console.log(
      `${name.padEnd(10)} ${lm.h.toFixed(0).padStart(10)} ${lm.r.toFixed(0).padStart(10)} ` +
        `${(Math.atan(lm.maxGrade) * 57.2958).toFixed(1).padStart(13)}° ` +
        `${(med * 100).toFixed(1).padStart(12)}% ${(worst * 100).toFixed(1).padStart(11)}%`
    );
  }
}
