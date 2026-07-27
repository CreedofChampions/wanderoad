// created by AI
/* Wanderoad — are petrol stations actually findable?
 *
 *   node tools/diag-stations.mjs [preset] [seed]
 *
 * The operator's report: fuel matters (the tank runs down) but they never actually met a
 * station while driving. tools/bench-props.mjs already asserts a BOX AVERAGE ("N stations
 * over M km of arterial in an 18x18 km square") and that average has been passing — so if
 * stations really are hard to find, the box average is the wrong instrument. Relief (and
 * therefore road grade, and therefore STATION_MAX_GRADE's verdict) is spatially correlated —
 * hills cluster — so a driver who stays on ONE corridor can go station-to-station for far
 * longer than the map-wide mean while the mean still looks fine, because some other, flatter
 * corridor is carrying it.
 *
 * So this measures the thing a driver actually experiences: walk a long, REAL, connected
 * chain of arterial edges (never a box sample) and read off the gaps between the stations
 * actually met along it. Alongside that: how many candidate sites existed, and how many were
 * rejected specifically by STATION_MAX_GRADE — the concrete, already-measured hypothesis is
 * that the world's relief was raised two sessions ago (meadow arterials now run up to 27%
 * worst grade, alpine up to 53% — docs/BACKLOG.md, the W4 and alpine-gradient entries) AFTER
 * STATION_MAX_GRADE (0.06) was tuned, so a design that meant "a station every ~3 km" may have
 * quietly become "a station every 30 km" without any number saying so.
 */
import { connects, nodePos, edgesInBox } from '../src/world/roads.js';
import {
  stationForEdge, STATION_MAX_GRADE, stationSpacing, fuelCansInBox, CAN_FRACTION,
  stationsInBox, stationSpur, STATION_APRON_HALF_WIDTH, STATION_APRON_HALF_DEPTH,
} from '../src/world/props.js';
import { Terrain } from '../src/world/terrain.js';
import { waterLevelAt, BIOME_COUNT } from '../src/world/biomes.js';
import { applyTerrain, terrainBias, TERRAINS } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { TANK_SECONDS, CRUISE_V } from '../src/game/fuel.js';
import { hash2i } from '../src/core/math.js';

const argPreset = process.argv[2] && TERRAINS[process.argv[2]] ? process.argv[2] : null;
const argSeed = Number(process.argv[3]) || null;
const PRESETS = argPreset ? [argPreset] : Object.keys(TERRAINS);
const SEEDS = argSeed ? [argSeed >>> 0] : [20260726, 8, 190417, 552023];
const HOPS = 260; // ~500-900 km of real, connected arterial per (preset, seed) — see totals printed

const F = 1 / 4294967296;
const OPP = { E: 'W', W: 'E', S: 'N', N: 'S' };

/** The up-to-4 arterial edges leaving lattice node (i, j), each tagged with which real edge
 *  (its own canonical i,j,dir) a driver would be on and which way they'd be travelling along
 *  its t=0..1 parameterisation. */
function walkOptions(i, j, seed) {
  const opts = [];
  if (connects(i, j, 0, 0, seed)) opts.push({ dir: 'E', ni: i + 1, nj: j, ei: i, ej: j, edir: 0, fwd: true });
  if (connects(i - 1, j, 0, 0, seed)) opts.push({ dir: 'W', ni: i - 1, nj: j, ei: i - 1, ej: j, edir: 0, fwd: false });
  if (connects(i, j, 1, 0, seed)) opts.push({ dir: 'S', ni: i, nj: j + 1, ei: i, ej: j, edir: 1, fwd: true });
  if (connects(i, j - 1, 1, 0, seed)) opts.push({ dir: 'N', ni: i, nj: j - 1, ei: i, ej: j - 1, edir: 1, fwd: false });
  return opts;
}

/** A deterministic, connected chain of arterial edges — a real drive, not a box sample.
 *  Prefers not to reverse straight back the way it came (a driver does not three-point-turn
 *  at every junction); takes it anyway at a dead end, which is rare at connect=0.86. */
function driveRoute(seed, walkSalt, hops, startI, startJ) {
  let i = startI;
  let j = startJ;
  let cameFrom = null;
  const route = [];
  for (let h = 0; h < hops; h++) {
    const opts = walkOptions(i, j, seed);
    if (!opts.length) break; // an isolated arterial node — possible, very rare at connect=0.86
    let pool = cameFrom ? opts.filter((o) => o.dir !== cameFrom) : opts;
    if (!pool.length) pool = opts;
    const hh = hash2i(i * 2654435761 + j * 40503, h, seed ^ walkSalt) * F;
    const pick = pool[Math.min(pool.length - 1, Math.floor(hh * pool.length))];
    route.push(pick);
    cameFrom = OPP[pick.dir];
    i = pick.ni;
    j = pick.nj;
  }
  return route;
}

/** The one real edge object (as edgesInBox would hand it out) for a specific (i, j, dir). */
function edgeAt(i, j, dir, seed) {
  const p0 = nodePos(i, j, 0, seed, [0, 0]);
  const i1 = dir === 0 ? i + 1 : i;
  const j1 = dir === 0 ? j : j + 1;
  const p1 = nodePos(i1, j1, 0, seed, [0, 0]);
  const pad = 1600; // comfortably past this one edge's own bulge + winding swing
  const x0 = Math.min(p0[0], p1[0]) - pad;
  const x1 = Math.max(p0[0], p1[0]) + pad;
  const z0 = Math.min(p0[1], p1[1]) - pad;
  const z1 = Math.max(p0[1], p1[1]) + pad;
  const key = `0:${i},${j},${dir}`;
  for (const e of edgesInBox(x0, z0, x1, z1, seed, 0)) if (e.key === key) return e;
  return null;
}

function edgeLength(e) {
  let s = 0;
  for (let k = 2; k < e.pts.length; k += 2) s += Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]);
  return s;
}

/** Walk one real route, tally why stations were or were not placed, and read off the gaps a
 *  driver following it would actually meet. */
function driveAndMeasure(seed, walkSalt) {
  const route = driveRoute(seed, walkSalt, HOPS, 0, 0);
  const stats = {};
  let routeM = 0;
  const stationAt = []; // absolute route-arc-length metres
  // Distance from the WORLD ORIGIN of each station in stationAt, same order — the "distance
  // from spawn" figure the STATION_NEAR_KM/STATION_FAR_KM distance-scaling in world/props.js
  // reads. Kept alongside the route-arc-length so gaps can be bucketed by how far from home
  // they actually happened, not just accumulated into one seed-wide average.
  const stationDist = [];
  let missingEdges = 0;

  for (const pick of route) {
    const e = edgeAt(pick.ei, pick.ej, pick.edir, seed);
    if (!e) {
      missingEdges++;
      continue;
    }
    const total = edgeLength(e);
    const st = stationForEdge(e, seed, stats);
    if (st) {
      const within = pick.fwd ? st.edgeFrac * total : (1 - st.edgeFrac) * total;
      stationAt.push(routeM + within);
      stationDist.push(Math.hypot(st.x, st.z));
    }
    routeM += total;
  }

  // Gaps in the ORIGINAL route order first (paired with the distance-from-origin of the
  // station at the FAR end of each gap — "how far from home were you when this particular
  // drought ended"), then a separate sorted copy for the existing median/worst figures below,
  // so sorting one never disturbs the other's pairing.
  const gaps = [];
  const gapDist = [];
  for (let k = 1; k < stationAt.length; k++) {
    gaps.push(stationAt[k] - stationAt[k - 1]);
    gapDist.push(stationDist[k]);
  }
  const sortedGaps = gaps.slice().sort((a, b) => a - b);
  const mean = sortedGaps.length ? sortedGaps.reduce((a, b) => a + b, 0) / sortedGaps.length : Infinity;
  const worst = sortedGaps.length ? sortedGaps[sortedGaps.length - 1] : Infinity;
  const median = sortedGaps.length ? sortedGaps[sortedGaps.length >> 1] : Infinity;
  // Leading gap: spawn to the first station. Trailing: last station to the end of the route.
  // Both count as real "how far before fuel" experience, so fold them in as worst-case checks.
  const lead = stationAt.length ? stationAt[0] : routeM;
  const trail = stationAt.length ? routeM - stationAt[stationAt.length - 1] : routeM;

  return { routeM, missingEdges, stations: stationAt.length, gaps, gapDist, mean, median, worst, lead, trail, stats };
}

console.log(`STATION_MAX_GRADE = ${STATION_MAX_GRADE} (${(STATION_MAX_GRADE * 100).toFixed(1)}%)`);
console.log(`fuel tank range: cruise ${(TANK_SECONDS * CRUISE_V / 1000).toFixed(1)} km  (bench-fuel.mjs also measures 9.5 km cruise / 5.6 km flat-out / 10.7 km dawdling)\n`);

const grand = { arterialEdges: 0, arterialSelected: 0, candidateSites: 0, rejectGrade: 0, edgeEmpty: 0, rejectCauseway: 0, placed: 0 };
let grandWorst = 0;
let grandRouteM = 0;

/* ── distance-from-spawn bands ────────────────────────────────────────────────
 * "The further you get from spawn, the further apart the gas stations are... still findable
 * though, not too hard" — world/props.js's stationDistanceMul() eases the accept probability
 * down between STATION_NEAR_KM (9) and STATION_FAR_KM (70), flat on both sides of that. Four
 * contiguous bands cover the whole curve: flat-near, easing, flat-far, and past the floor —
 * so this shows the "starting generous, slowly widening, capped" shape with real gaps, not
 * just the two or three headline numbers. Every gap already walked above is bucketed by the
 * distance-from-origin of the station at its FAR end (driveAndMeasure's own gapDist). */
const DIST_BANDS = [
  ['near      (< 10 km, flat)', 0, 10000],
  ['mid       (10-40 km, easing)', 10000, 40000],
  ['far       (40-80 km, near the floor)', 40000, 80000],
  ['very far  (> 80 km, at the floor)', 80000, Infinity],
];
const bandGaps = DIST_BANDS.map(() => []);

for (const preset of PRESETS) {
  applyTerrain(preset);
  setBiomeBias(terrainBias(preset));
  console.log(`── ${preset} ${'─'.repeat(70 - preset.length)}`);
  console.log('seed        box avg m/stn   route km   stations   mean gap   median gap   WORST gap   lead   trail');
  const s = { arterialEdges: 0, arterialSelected: 0, candidateSites: 0, rejectGrade: 0, edgeEmpty: 0, rejectCauseway: 0, placed: 0 };
  for (const seed of SEEDS) {
    const box = stationSpacing(seed, 9000);
    const d = driveAndMeasure(seed, 0xd12e);
    for (const k of Object.keys(grand)) grand[k] += d.stats[k] || 0;
    for (const k of Object.keys(s)) s[k] += d.stats[k] || 0;
    grandWorst = Math.max(grandWorst, d.worst === Infinity ? 0 : d.worst, d.lead, d.trail);
    grandRouteM += d.routeM;
    for (let gi = 0; gi < d.gaps.length; gi++) {
      const dist = d.gapDist[gi];
      for (let bi = 0; bi < DIST_BANDS.length; bi++) {
        if (dist >= DIST_BANDS[bi][1] && dist < DIST_BANDS[bi][2]) {
          bandGaps[bi].push(d.gaps[gi]);
          break;
        }
      }
    }
    console.log(
      `${String(seed).padEnd(11)} ${box.metresPerStation.toFixed(0).padStart(13)}   ` +
        `${(d.routeM / 1000).toFixed(1).padStart(8)}   ${String(d.stations).padStart(8)}   ` +
        `${(d.mean / 1000).toFixed(2).padStart(7)}km   ${(d.median / 1000).toFixed(2).padStart(9)}km   ` +
        `${(d.worst / 1000).toFixed(2).padStart(7)}km   ${(d.lead / 1000).toFixed(1).padStart(4)}km  ${(d.trail / 1000).toFixed(1).padStart(4)}km` +
        (d.missingEdges ? `   (${d.missingEdges} edge lookups missed)` : '')
    );
  }
  const lostPct = s.arterialSelected ? (100 * s.edgeEmpty) / s.arterialSelected : 0;
  const siteRejPct = s.candidateSites ? (100 * s.rejectGrade) / s.candidateSites : 0;
  const siteWetPct = s.candidateSites ? (100 * s.rejectCauseway) / s.candidateSites : 0;
  console.log(
    `       candidates: ${s.arterialEdges} arterial edges walked, ${s.arterialSelected} "wanted" a station (the p-gate), ` +
      `${s.candidateSites} candidate sites tried among them`
  );
  console.log(
    `       ${s.rejectGrade} of those ${s.candidateSites} sites (${siteRejPct.toFixed(0)}%) exceeded STATION_MAX_GRADE, ` +
      `${s.rejectCauseway} (${siteWetPct.toFixed(0)}%) sat over water; ` +
      `${s.edgeEmpty} of ${s.arterialSelected} edges (${lostPct.toFixed(0)}%) had NO candidate clear both and got NO station`
  );
  console.log(`       placed: ${s.placed}\n`);
}

const tankKm = (TANK_SECONDS * CRUISE_V) / 1000;
const flatOutKm = 5.6; // measured, tools/bench-fuel.mjs "flat out" row

console.log('── stations alone ────────────────────────────────────────────────────────');
console.log(`worst real gap seen anywhere above: ${(grandWorst / 1000).toFixed(2)} km, over ${(grandRouteM / 1000).toFixed(0)} km of real driven arterial`);
const stationsAloneOk = grandWorst / 1000 < flatOutKm * 0.85;
console.log(
  `${stationsAloneOk ? 'PASS' : 'still short'}  worst real STATION-only gap under the ${flatOutKm} km worst-case (flat-out) tank range: ` +
    `${(grandWorst / 1000).toFixed(2)} km ${stationsAloneOk ? '<' : '>='} ${(flatOutKm * 0.85).toFixed(2)} km`
);
console.log(
  `(cruise range is ${tankKm.toFixed(1)} km. STATION_P is an independent 72% draw per arterial edge, and that alone has a\n` +
    ` combinatorial tail no grade/water fix removes — see the floating-can section below for the deliberate second layer.)`
);

console.log('\n── station spacing by distance from spawn ──────────────────────────────────');
console.log('(every gap already walked above, across all 6 presets x 4 seeds, bucketed by how far from the origin it happened)');
console.log('band                              gaps    mean gap    median gap   WORST gap');
const bandMedians = [];
for (let bi = 0; bi < DIST_BANDS.length; bi++) {
  const list = bandGaps[bi].slice().sort((a, b) => a - b);
  const [label] = DIST_BANDS[bi];
  if (!list.length) {
    console.log(`${label.padEnd(32)}     0   (no gaps sampled this far out — HOPS did not reach this band)`);
    bandMedians.push(null);
    continue;
  }
  const meanG = list.reduce((a, b) => a + b, 0) / list.length;
  const medianG = list[list.length >> 1];
  const worstG = list[list.length - 1];
  console.log(
    `${label.padEnd(32)} ${String(list.length).padStart(5)}   ${(meanG / 1000).toFixed(2).padStart(7)}km   ` +
      `${(medianG / 1000).toFixed(2).padStart(8)}km   ${(worstG / 1000).toFixed(2).padStart(7)}km`
  );
  bandMedians.push(medianG);
}
// The curve this was built for, stated as a real, measured claim: each band's median should
// not be TIGHTER than the previous, more-generous one. Small dips are allowed (sampling noise
// on a semi-random route walk, especially where a band's own sample is thin) — the assertion
// is on the overall shape (first vs last sampled band), not a strict step-by-step monotone,
// which a walk this size cannot promise band-to-band.
const sampled = bandMedians.filter((m) => m !== null);
if (sampled.length >= 2) {
  const curveOk = sampled[sampled.length - 1] >= sampled[0] * 0.85; // real margin against noise, not exact equality
  console.log(
    `${curveOk ? 'PASS' : 'FAIL'}  overall shape: the furthest sampled band's median (${(sampled[sampled.length - 1] / 1000).toFixed(2)} km) ` +
      `is not tighter than the nearest's (${(sampled[0] / 1000).toFixed(2)} km) — "harder further out", never the reverse`
  );
  if (!curveOk) process.exitCode = 1;
}
console.log(
  '       the floating-can layer (constant density at any distance, unlike stations — see world/props.js) is what keeps every one ' +
    'of these bands "findable, not too hard" regardless of how wide the station spacing itself gets; the combined-source figure below measures that directly.'
);

/* ── stations AND floating cans, together ────────────────────────────────────
 * The system the player actually experiences is BOTH layers at once. Cans need a real ground
 * probe (freeboard, slope), so this walk builds a real, tightly-scoped Terrain per edge rather
 * than reusing the free pure station walk above — that costs real time, so this runs a smaller
 * scope (two presets, two seeds) rather than the full six-by-four sweep. Still hundreds of real
 * km, still a real connected route, never a box average.
 */
console.log('\n── stations AND floating cans, together ──────────────────────────────────');
const w = new Float32Array(BIOME_COUNT);
function probeFor(terr) {
  return {
    site: (x, z) => {
      const b = terr.weights(x, z);
      w.set(b.w);
      const y = terr.height(x, z);
      return { y, dominant: b.dominant, wy: waterLevelAt(w, -Infinity) };
    },
    height: (x, z) => terr.height(x, z),
  };
}

/** Nearest arc length, on this edge's own polyline, to a point off to the side of it — used
 *  to place a can (which is offset from the centreline) back onto the route's own arc length,
 *  the same coordinate the station gap math already works in. */
function nearestArc(e, cum, x, z) {
  let bestD2 = Infinity;
  let bestS = 0;
  for (let k = 0; k < e.pts.length - 2; k += 2) {
    const ax = e.pts[k], az = e.pts[k + 1];
    const bx = e.pts[k + 2], bz = e.pts[k + 3];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t, qz = az + dz * t;
    const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestS = cum[k / 2] + Math.hypot(dx, dz) * t;
    }
  }
  return bestS;
}

function driveCombined(seed, walkSalt, hops) {
  const route = driveRoute(seed, walkSalt, hops, 0, 0);
  const events = []; // absolute route-arc-length metres, one per fuel source met
  let routeM = 0;
  for (const pick of route) {
    const e = edgeAt(pick.ei, pick.ej, pick.edir, seed);
    if (!e) continue;
    const cum = [0];
    for (let k = 2; k < e.pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]));
    const total = cum[cum.length - 1];

    const st = stationForEdge(e, seed);
    if (st) {
      const within = pick.fwd ? st.edgeFrac * total : (1 - st.edgeFrac) * total;
      events.push(routeM + within);
    }

    // fuelCansInBox queries edgesInBox itself and will happily hand back candidates that
    // belong to a NEIGHBOURING edge whose bounds overlap this padded box (a lane crossing
    // near an arterial, or the next hop's own edge) — every can's key is `cn:${edgeKey}:${s}`
    // precisely so a caller CAN tell whose candidate it is; filter to this edge only, or two
    // adjacent hops each count the same physical can and the walk fabricates fuel stops that
    // do not exist.
    const pad = 40;
    const terr = new Terrain(seed, e.minX - pad, e.minZ - pad, e.maxX + pad, e.maxZ + pad, 40);
    const cans = fuelCansInBox(e.minX - pad, e.minZ - pad, e.maxX + pad, e.maxZ + pad, seed, probeFor(terr));
    const mine = `cn:${e.key}:`;
    for (const c of cans) {
      if (!c.key.startsWith(mine)) continue;
      const sAlong = nearestArc(e, cum, c.x, c.z);
      const within = pick.fwd ? sAlong : total - sAlong;
      if (within >= 0 && within <= total) events.push(routeM + within);
    }
    routeM += total;
  }
  events.sort((a, b) => a - b);
  const gaps = [];
  for (let k = 1; k < events.length; k++) gaps.push(events[k] - events[k - 1]);
  const lead = events.length ? events[0] : routeM;
  const trail = events.length ? routeM - events[events.length - 1] : routeM;
  const worst = Math.max(lead, trail, ...gaps, 0);
  return { routeM, events: events.length, worst, lead, trail };
}

let combinedWorst = 0;
let combinedRouteM = 0;
const COMBO_PRESETS = argPreset ? [argPreset] : PRESETS;
const COMBO_SEEDS = argSeed ? [argSeed >>> 0] : [20260726, 190417];
const COMBO_HOPS = 90;
console.log('preset      seed          route km   fuel stops   WORST gap   lead   trail');
for (const preset of COMBO_PRESETS) {
  applyTerrain(preset);
  setBiomeBias(terrainBias(preset));
  for (const seed of COMBO_SEEDS) {
    const c = driveCombined(seed, 0xd12e, COMBO_HOPS);
    combinedWorst = Math.max(combinedWorst, c.worst);
    combinedRouteM += c.routeM;
    console.log(
      `${preset.padEnd(11)} ${String(seed).padEnd(13)} ${(c.routeM / 1000).toFixed(1).padStart(8)}   ` +
        `${String(c.events).padStart(10)}   ${(c.worst / 1000).toFixed(2).padStart(7)}km   ` +
        `${(c.lead / 1000).toFixed(1).padStart(4)}km  ${(c.trail / 1000).toFixed(1).padStart(4)}km`
    );
  }
}

console.log(`\nworst gap to ANY fuel source (station or can): ${(combinedWorst / 1000).toFixed(2)} km, over ${(combinedRouteM / 1000).toFixed(0)} km of real driven road`);
console.log(`a can restores ${(CAN_FRACTION * 100).toFixed(0)}% of a tank, ${(CAN_FRACTION * tankKm).toFixed(1)} km of cruise range — enough to reach the next fuel source after a lucky find`);
const combinedOk = combinedWorst / 1000 < flatOutKm * 0.85;
console.log(
  `${combinedOk ? 'PASS' : 'FAIL'}  worst COMBINED gap has real margin under the ${flatOutKm} km worst-case (flat-out) tank range: ` +
    `${(combinedWorst / 1000).toFixed(2)} km ${combinedOk ? '<' : '>='} ${(flatOutKm * 0.85).toFixed(2)} km`
);

/* ── access road: does the spur actually reach both ends? ─────────────────────
 * A screenshot-free GEOMETRIC proof, not a rendering test (src/render/props.js's
 * buildAccessSpur draws the ribbon; this asks whether the two points that ribbon is stretched
 * between actually touch what they claim to). Two independent checks per station, using
 * machinery this file did not write for the purpose: a real, freshly-built Terrain's own
 * roads.carve() (the same road-network query the car itself uses) for the road end, and plain
 * vector arithmetic against the station's own recorded axes for the forecourt end.
 */
console.log('\n── access road: does the spur reach both the road and the forecourt? ───────');
{
  applyTerrain(PRESETS[0] || 'rolling');
  setBiomeBias(terrainBias(PRESETS[0] || 'rolling'));
  const sample = stationsInBox(-6000, -6000, 6000, 6000, SEEDS[0]).slice(0, 30);
  let touchesRoad = 0;
  let insideApron = 0;
  let lenSane = 0;
  let finiteHeights = 0;
  let worstMouthGap = -Infinity;
  let worstEdgeSignal = Infinity;
  let worstStepAtMouth = 0;
  // A first pass: how many candidate edges nearby, and how the carve BLENDS them, is a real
  // property of the world (near a crossing, more than one road contributes) — logged so a
  // large per-station "st.y vs the blend" gap is not mistaken for a bug. render/props.js's
  // buildAccessSpur already reads the BLENDED height (terr.height()), never stationForEdge's
  // own solo st.y, so that blend IS the authoritative number the renderer uses — this loop
  // checks THAT invariant, not an equality with st.y that the system never promised.
  let worstBlendVsSolo = 0;
  for (const st of sample) {
    const spur = stationSpur(st);
    const terr = new Terrain(SEEDS[0], spur.mouthX - 40, spur.mouthZ - 40, spur.mouthX + 40, spur.mouthZ + 40, 20);
    const c = terr.roads.carve(spur.mouthX, spur.mouthZ);

    // "On a road" per the SAME smooth field render/props.js's own terrain (and the car's own
    // physics) reads everywhere else — c.edge, not a hand-rolled distance formula. Widths can
    // legitimately BLEND across more than one nearby edge (see the note above), so a raw
    // distance-to-the-host-edge's-own-width can read as a few metres "short" near a junction
    // even though the point is genuinely still on tarmac by the field that actually governs
    // what the car drives on — c.edge is what that field says, so it is what this checks.
    if (c.edge < worstEdgeSignal) worstEdgeSignal = c.edge;
    if (c.edge > 0.05) touchesRoad++;
    const mouthGap = c.d - c.width * 0.5;
    if (mouthGap > worstMouthGap) worstMouthGap = mouthGap;

    const hRoad = terr.height(spur.mouthX, spur.mouthZ);
    if (isFinite(hRoad)) finiteHeights++;
    const blendVsSolo = Math.abs(hRoad - st.y);
    if (blendVsSolo > worstBlendVsSolo) worstBlendVsSolo = blendVsSolo;

    // The apron end must land inside the forecourt's own footprint — checked against the
    // SAME (nx, nz) axis the station record itself carries, not a re-derived rotation, so
    // this catches a real mismatch between stationSpur() and the forecourt's own dimensions
    // rather than re-proving arithmetic against itself.
    const ddx = spur.apronX - st.x;
    const ddz = spur.apronZ - st.z;
    const alongN = ddx * st.nx + ddz * st.nz; // metres along the road<->forecourt axis
    const alongP = ddx * -st.nz + ddz * st.nx; // metres along the road's own tangent
    if (Math.abs(alongN) <= STATION_APRON_HALF_DEPTH + 0.5 && Math.abs(alongP) <= STATION_APRON_HALF_WIDTH + 0.5) insideApron++;

    const len = Math.hypot(spur.apronX - spur.mouthX, spur.apronZ - spur.mouthZ);
    if (len > 1 && len < 20) lenSane++;
  }
  console.log(
    `       ${sample.length} real stations sampled: mouth reads as "on a road" (c.edge > 0.05) ${touchesRoad}/${sample.length}, ` +
      `apron end inside the forecourt ${insideApron}/${sample.length}, spur length sane (1-20 m) ${lenSane}/${sample.length}, ` +
      `mouth height finite ${finiteHeights}/${sample.length}`
  );
  console.log(
    `       worst mouth c.edge signal ${worstEdgeSignal.toFixed(3)} (0=off any road, 1=deep in a carriageway), ` +
      `worst raw mouth-to-nearest-edge-of-tarmac gap ${worstMouthGap.toFixed(2)} m`
  );
  console.log(
    `       largest gap between a mouth's BLENDED road height (what buildAccessSpur actually draws) and stationForEdge's own SOLO ` +
      `height at that edge: ${worstBlendVsSolo.toFixed(2)} m — expected to be occasionally large near a junction where more than one ` +
      `road contributes to the blend (RoadField.carve's whole reason to exist, see world/roads.js); NOT a bug, and not what the spur draws.`
  );
  const spurOk = sample.length > 0 && touchesRoad === sample.length && insideApron === sample.length && lenSane === sample.length && finiteHeights === sample.length;
  console.log(`${spurOk ? 'PASS' : 'FAIL'}  every sampled station's access spur genuinely connects the arterial to the forecourt`);
  if (!spurOk) process.exitCode = 1;
}

process.exit(combinedOk && process.exitCode !== 1 ? 0 : 1);
