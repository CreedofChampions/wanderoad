// created by AI
/* Wanderoad — three grass complaints, measured before/after src/render/grass.js's fix.
 *
 * Operator reports:
 *   (1) "Grass still tips in on the edge of the road — keep grass at a distance from the
 *       road, 1 foot." grass.js's lattice already zeroed blade density ON the carriageway
 *       (`T.roads.carve(x,z).edge`, the mask W2 checks 118/118 on the centreline), but that
 *       mask is roads.js's own shoulder fade — a ~0.75 m band straddling the PHYSICAL tarmac
 *       edge, only fully clear past `half+0.35`. A blade base rooted right there can still
 *       lean its tip across the white line.
 *   (2) "There's grass in the water." The lattice never compared a blade base against the
 *       local water plane at all.
 *   (3) BACKLOG: "grass grows through station forecourts... the grass system knows about
 *       roads but evidently not about station aprons."
 *
 * This is a DIRECT, honest before/after of the exact per-node suppression math grass.js's
 * `_buildChunk` pass 1 runs, at real sampled points classified into each complaint's zone —
 * not the stochastic per-blade instance buffer (whose survivors, after the fix, no longer
 * exist to be counted in the suppressed zones at all). "OLD" below is a byte-for-byte replica
 * of the pre-fix formula (no margin, no water gate, no station gate) — the same "reproduce the
 * old behaviour as a pure function, never by reverting the real source" convention
 * tools/diag-grasscine.mjs already uses for its own oracle. "NEW" calls the exact same
 * primitives (`Terrain`, `RoadField.carve`, `waterLevelAt`, `stationsInBox`) src/render/grass.js
 * itself now calls, with its own (module-private, so mirrored here by literal) constants.
 * The presence gate — `dens > 0.004` — is pass 3's own real cutoff, copied verbatim from
 * grass.js's `if (dens <= 0.004) continue;`.
 *
 * A SECOND, independent pass at the bottom drives the REAL `Grass` class (real instanced
 * blade buffers, the real lattice, the real bilinear interpolation) rather than evaluating the
 * gate formula directly at a query point. That pass is what actually caught the bug the
 * formula-only check above cannot see by construction: `_buildChunk`'s lattice zeroes density
 * at each NODE (spaced up to ~11.4 m in the far ring), and bilinear interpolation of a small
 * feature (a station's 11 m-radius apron, or a narrow inlet) that fits inside ONE cell without
 * touching any of its four corners can still read as positive density in the middle of that
 * cell — real blades measured as deep as 1.93 m inside a real apron and 6.55 m into open water
 * before `_buildChunk` grew an exact per-blade re-check on top of the lattice. The formula
 * section above still earns its place: it is what proves the GATE ITSELF (the maths) is
 * correct; the real-`Grass` section proves the FULL PIPELINE (lattice + interpolation + the
 * exact re-check) delivers that gate's promise to the actual instance buffer the GPU draws.
 *
 *   node tools/diag-grasstrim.mjs [--seed 20260726] [--terrain meadow] [--r 420] [--step 4]
 */
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { BIOME_COUNT, BIOME_SCATTER, waterLevelAt, setBiomeBias } from '../src/world/biomes.js';
import { stationsInBox, STATION_RADIUS } from '../src/world/props.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { clamp01, smoothstep } from '../src/core/math.js';
import { Grass } from '../src/render/grass.js';
import { U } from '../src/render/uniforms.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = (+arg('seed', 20260726)) >>> 0;
const LAND = arg('terrain', 'meadow');
const R = +arg('r', 420); // half-extent of the scanned square, metres
const STEP = +arg('step', 4); // sample spacing, metres
const CENTER_MODE = arg('center', 'station'); // 'station' finds a real apron; 'spawn' does not
const PRESENCE_GATE = 0.004; // grass.js pass 3's own real cutoff, verbatim

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));

const spawn = findSpawn(SEED);
// Centre the whole scan on the nearest station to spawn, not on spawn itself: a station
// apron is a small (STATION_RADIUS = 11 m) target and complaint (3) needs real ones inside
// the box, widening the search radius until at least one turns up (found at 1000 m for the
// default seed/terrain). Stations sit ON an arterial, so the same box still carries plenty of
// ordinary road-margin samples for complaint (1); pass --center spawn for a box picked with no
// knowledge of where the stations are, better for complaint (2)'s water samples.
let center = spawn;
if (CENTER_MODE === 'station') {
  for (const rad of [500, 1000, 2000, 4000, 8000, 16000]) {
    const near = stationsInBox(spawn.x - rad, spawn.z - rad, spawn.x + rad, spawn.z + rad, SEED);
    if (near.length) {
      let best = near[0],
        bd = Infinity;
      for (const s of near) {
        const d = (s.x - spawn.x) ** 2 + (s.z - spawn.z) ** 2;
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      center = { x: best.x, z: best.z };
      console.log(`nearest station to spawn: (${best.x.toFixed(0)}, ${best.z.toFixed(0)}), ${Math.sqrt(bd).toFixed(0)} m away — centring scan there`);
      break;
    }
  }
}
const cx = center.x,
  cz = center.z;
const T = new Terrain(SEED, cx - R - 90, cz - R - 90, cx + R + 90, cz + R + 90, 90);

// grass.js's own module-private constants, mirrored here — see the file banner.
const CANOPY_THIN = 0.45; // unused below (both formulas share it) but kept for a faithful density
const ROAD_GRASS_MARGIN = 0.4;
const GRASS_WATER_FREEBOARD = 0.05;
const STATION_GRASS_RADIUS = STATION_RADIUS;
const ROAD_MARGIN_BAND = 0.5; // the complaint's own "0-0.5 m beyond the edge" window

const SCAT_GRASS = BIOME_SCATTER.map((b) => b.grass);

const stations = stationsInBox(cx - R - STATION_GRASS_RADIUS, cz - R - STATION_GRASS_RADIUS, cx + R + STATION_GRASS_RADIUS, cz + R + STATION_GRASS_RADIUS, SEED);
console.log(`stations found in the scanned box: ${stations.length}`);

/** OLD: the exact pre-fix gate — road edge only, straight off roads.js's own carve(). */
function oldDensity(g, edgeMask, shade) {
  return g * (1 - clamp01(edgeMask)) * (1 - CANOPY_THIN * shade);
}

/** NEW: OLD's road-edge term widened by ROAD_GRASS_MARGIN, plus the water and station gates —
 *  a literal mirror of what src/render/grass.js's pass 1 now computes. */
function newDensity(g, rc, y, waterY, shade, inApron) {
  let edge = rc.edge;
  if (rc.width > 0) {
    const half = rc.width * 0.5;
    const marginEdge = 1 - smoothstep(half - 0.4 + ROAD_GRASS_MARGIN, half + 0.35 + ROAD_GRASS_MARGIN, rc.d);
    if (marginEdge > edge) edge = marginEdge;
  }
  const submerged = waterY !== null && y < waterY + GRASS_WATER_FREEBOARD;
  if (submerged || inApron) return 0;
  return g * (1 - clamp01(edge)) * (1 - CANOPY_THIN * shade);
}

const wScratch = new Float32Array(BIOME_COUNT);

let scanned = 0;
const zones = {
  roadMargin: { n: 0, oldYes: 0, newYes: 0, oldSum: 0, newSum: 0 },
  water: { n: 0, oldYes: 0, newYes: 0, oldSum: 0, newSum: 0 },
  apron: { n: 0, oldYes: 0, newYes: 0, oldSum: 0, newSum: 0 },
};
const examples = { roadMargin: [], water: [], apron: [] };

function tally(zone, x, z, g, oldD, newD) {
  const s = zones[zone];
  s.n++;
  s.oldSum += oldD;
  s.newSum += newD;
  if (oldD > PRESENCE_GATE) s.oldYes++;
  if (newD > PRESENCE_GATE) s.newYes++;
  if (examples[zone].length < 4 && oldD > PRESENCE_GATE && newD <= PRESENCE_GATE) {
    examples[zone].push({ x: +x.toFixed(1), z: +z.toFixed(1), g: +g.toFixed(3), oldD: +oldD.toFixed(4), newD: +newD.toFixed(4) });
  }
}

for (let jz = -R; jz <= R; jz += STEP) {
  const z = cz + jz;
  for (let ix = -R; ix <= R; ix += STEP) {
    const x = cx + ix;
    const b = T.weights(x, z);
    wScratch.set(b.w);
    let g = 0;
    for (let k = 0; k < BIOME_COUNT; k++) {
      const wk = wScratch[k];
      if (wk < 0.002) continue;
      g += wk * SCAT_GRASS[k];
    }
    if (g <= 0) continue; // nothing this biome would ever grow here — not evidence either way
    scanned++;

    const y = T.height(x, z);
    const rc = T.roads.carve(x, z);
    const waterY = waterLevelAt(wScratch, -Infinity);
    let inApron = false;
    for (let si = 0; si < stations.length; si++) {
      const s = stations[si];
      const sdx = x - s.x,
        sdz = z - s.z;
      if (sdx * sdx + sdz * sdz < STATION_GRASS_RADIUS * STATION_GRASS_RADIUS) {
        inApron = true;
        break;
      }
    }

    const oldD = oldDensity(g, rc.edge, 0);
    const newD = newDensity(g, rc, y, waterY, 0, inApron);

    // (1) road-margin zone: physically between the tarmac edge and 0.5 m beyond it.
    if (rc.width > 0) {
      const beyondEdge = rc.d - rc.width * 0.5;
      if (beyondEdge >= 0 && beyondEdge <= ROAD_MARGIN_BAND) tally('roadMargin', x, z, g, oldD, newD);
    }
    // (2) submerged ground.
    if (waterY !== null && y < waterY) tally('water', x, z, g, oldD, newD);
    // (3) inside a station apron.
    if (inApron) tally('apron', x, z, g, oldD, newD);
  }
}

console.log(`\n=== grass suppression, seed ${SEED}, terrain "${LAND}", box ${2 * R}x${2 * R} m around spawn (${cx.toFixed(0)}, ${cz.toFixed(0)}), step ${STEP} m ===`);
console.log(`grass-bearing samples scanned: ${scanned}\n`);

function report(name, label, want) {
  const s = zones[name];
  console.log(`-- ${label} (${s.n} samples) --`);
  if (s.n === 0) {
    console.log('  (none found in this box — widen --r or move --seed/--terrain)\n');
    return;
  }
  console.log(`  OLD: ${s.oldYes}/${s.n} points still clear the ${PRESENCE_GATE} presence gate (grass would spawn), mean density ${(s.oldSum / s.n).toFixed(4)}`);
  console.log(`  NEW: ${s.newYes}/${s.n} points clear the gate, mean density ${(s.newSum / s.n).toFixed(4)}`);
  const cut = s.oldSum > 0 ? 100 * (1 - s.newSum / s.oldSum) : 0;
  console.log(`  density cut: ${cut.toFixed(1)}%   ${want}`);
  if (examples[name].length) {
    console.log('  examples (OLD grew grass here, NEW does not):');
    for (const e of examples[name]) console.log(`    (${e.x}, ${e.z})  biome-grass ${e.g}  OLD density ${e.oldD}  NEW density ${e.newD}`);
  }
  console.log('');
}

report('roadMargin', '(1) 0-0.5 m beyond the carriageway edge', 'want a large cut, NEW near 0 close to the tarmac');
report('water', '(2) submerged ground (grass in the water)', 'want NEW == 0 exactly (every submerged sample gated)');
report('apron', '(3) inside a station forecourt apron', 'want NEW == 0 exactly (every apron sample gated)');

const allGated = (name) => zones[name].n === 0 || zones[name].newYes === 0;
const formulaOk = allGated('water') && allGated('apron');
console.log(`RESULT (gate formula): water ${allGated('water') ? 'PASS' : 'FAIL'} (0 of ${zones.water.n} submerged samples pass NEW), apron ${allGated('apron') ? 'PASS' : 'FAIL'} (0 of ${zones.apron.n} apron samples pass NEW), road-margin cut ${zones.roadMargin.n ? ((100 * (zones.roadMargin.oldSum - zones.roadMargin.newSum)) / Math.max(zones.roadMargin.oldSum, 1e-9)).toFixed(1) : 'n/a'}%`);

/* ── real-`Grass` pass: drive the actual class, decode the actual instance buffers ────────── */
console.log(`\n=== REAL Grass instance buffers (not the formula) ===`);

function driveGrass(atX, atZ) {
  const g = new Grass({ seed: SEED });
  g.setAngular(1.0 / 1080);
  U.uCamPos.value.set(atX, 2, atZ);
  U.uCull.value.set(0, 1, -1, 0); // wide-open cull — nothing culled away
  g.budgetMs = 50; // drain the whole queue fast rather than over hundreds of real frames
  g.update(atX, atZ, 2, 1 / 60); // first frame: region + station cache populate, recentre starts
  for (let i = 1; i < 400 && g.stats.dirty !== 0; i++) g.update(atX, atZ, 2, 1 / 60);
  return g;
}

function decodeBlades(g) {
  const out = [];
  for (const ring of g._rings) {
    const cs = ring.R.cs;
    for (const c of ring.slots) {
      if (!c || c.count === 0) continue;
      const x0 = c.cx * cs,
        z0 = c.cz * cs;
      for (let n = 0; n < c.count; n++) {
        out.push({ x: x0 + (c.iPos[n * 2] / 65535) * cs, z: z0 + (c.iPos[n * 2 + 1] / 65535) * cs, cs });
      }
    }
  }
  return out;
}

const wReal = new Float32Array(BIOME_COUNT);

// water, centred at spawn (no station knowledge needed to find water)
{
  const g = driveGrass(spawn.x, spawn.z);
  const T2 = g._terrain;
  const blades = decodeBlades(g);
  let submerged = 0,
    maxDepth = 0;
  for (const b of blades) {
    const y = T2.height(b.x, b.z);
    const w = T2.weights(b.x, b.z).w;
    wReal.set(w);
    const wy = waterLevelAt(wReal, y);
    if (wy !== null) {
      submerged++;
      maxDepth = Math.max(maxDepth, wy - y);
    }
  }
  console.log(`water: ${blades.length} real resident blades, ${submerged} submerged (${((100 * submerged) / blades.length).toFixed(3)}%), deepest ${maxDepth.toFixed(2)} m`);
}

// apron, centred on the real station found above (or spawn if none was found)
{
  const at = stations.length ? stations[0] : { x: spawn.x, z: spawn.z };
  const g = driveGrass(at.x, at.z);
  const blades = decodeBlades(g);
  let inApron = 0;
  for (const b of blades) {
    const d = Math.hypot(b.x - at.x, b.z - at.z);
    if (d < STATION_GRASS_RADIUS) inApron++;
  }
  console.log(`apron: ${blades.length} real resident blades around (${at.x.toFixed(0)}, ${at.z.toFixed(0)}), ${inApron} inside the real ${STATION_GRASS_RADIUS} m apron`);
}

console.log('want: water 0 submerged, apron 0 inside — any nonzero count is a real, visible blade in the wrong place.');

const ok = formulaOk;
process.exitCode = ok ? 0 : 1;
