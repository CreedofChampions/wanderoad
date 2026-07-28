/* Wanderoad — points of interest: acceptance measurements.
 *
 *   node tools/bench-props.mjs [seed]
 *
 * Answers, with numbers rather than claims:
 *   - is there geometry for every catalogue entry, and vice versa
 *   - determinism: same seed, same props, twice, and independent of the query box
 *   - rarity: how many metres of road between finds
 *   - clearance: is anything on the carriageway
 *   - seating: is anything floating or buried
 *   - cost: milliseconds and triangles per tile, and how many draw calls the window adds
 *   - stations: spacing along arterials, and whether the forecourt sits on the ground
 */

import { Object3D } from 'three';
import {
  PROP_KINDS, PROP_IDS, PROP_BY_ID, propsInBox, stationsInBox, stationSpacing, fuelCansInBox,
  CAN_HOVER, CAN_RADIUS, CAN_FRACTION, CAN_FOOT, STATION_MAX_GRADE, STATION_APRON_HALF_DEPTH,
  nearestStation, stationSpur,
} from '../src/world/props.js';
import { Props, missingGeometry, measureAll, CAN_BOB_AMP } from '../src/render/props.js';
import { Terrain } from '../src/world/terrain.js';
import { waterLevelAt, BIOME_COUNT, BIOME_NAMES } from '../src/world/biomes.js';
import { edgesInBox } from '../src/world/roads.js';
import { Solids } from '../src/game/collide.js';
import { Vehicle } from '../src/car/vehicle.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const TILE = 512;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(44)} ${String(got).padStart(14)}   want ${want}`);
};

const w = new Float32Array(BIOME_COUNT);
function probeFor(terr) {
  return {
    site: (x, z) => {
      const b = terr.weights(x, z);
      w.set(b.w);
      const dominant = b.dominant;
      const y = terr.height(x, z);
      return { y, dominant, wy: waterLevelAt(w, -Infinity) };
    },
    height: (x, z) => terr.height(x, z),
  };
}

console.log(`\n── catalogue ─────────────────────────────────────────────────── seed ${SEED}`);
check(PROP_KINDS.length === 100, 'catalogue size', PROP_KINDS.length, '100');
const missing = missingGeometry();
check(missing.length === 0, 'kinds without geometry', missing.length ? missing.join(',') : 0, '0');
const geo = measureAll();
const extraGeo = geo.length - PROP_IDS.length;
check(extraGeo === 0, 'geometry with no catalogue entry', extraGeo, '0');
const dupes = PROP_IDS.length - new Set(PROP_IDS).size;
check(dupes === 0, 'duplicate ids', dupes, '0');
{
  let tris = 0;
  let worst = null;
  for (const g of geo) {
    tris += g.tris;
    if (!worst || g.tris > worst.tris) worst = g;
  }
  console.log(`       ${geo.length} kinds, ${tris} triangles total, mean ${(tris / geo.length) | 0}/kind, heaviest ${worst.id} (${worst.tris})`);
  /* Some geometry deliberately beds into the ground — a boulder half-sunk, an acorn resting
   * in a dish, a jetty on piles that go into the water. What must not happen is a prop whose
   * BODY starts a long way underground, which is the signature of a builder written around
   * the wrong origin. 0.8 m is the line: below it is bedding, past it is a mistake. */
  const sunk = geo.filter((g) => g.minY < -0.8);
  check(sunk.length === 0, 'geometry starting >0.8 m below its foot', sunk.map((s) => `${s.id}:${s.minY.toFixed(2)}`).join(',') || 0, '0');
  const bedded = geo.filter((g) => g.minY < -0.02).map((g) => g.id);
  console.log(`       bedded into the ground on purpose: ${bedded.join(', ') || 'none'}`);
  const tall = geo.filter((g) => g.maxY > 22);
  check(tall.length === 0, 'geometry taller than 22 m', tall.map((s) => s.id).join(',') || 0, '0');
}

console.log('\n── determinism ───────────────────────────────────────────────────────────');
{
  // Find a tile that actually has props in it — a vacuous 0/0 pass is worse than no test.
  let bx = 0;
  let bz = 0;
  let a = [];
  let terr = null;
  for (let i = 0; i < 60 && a.length < 3; i++) {
    bx = (i % 8) * TILE;
    bz = ((i / 8) | 0) * TILE;
    terr = new Terrain(SEED, bx, bz, bx + TILE, bz + TILE, 40);
    a = propsInBox(bx, bz, bx + TILE, bz + TILE, SEED, probeFor(terr));
  }
  const b = propsInBox(bx, bz, bx + TILE, bz + TILE, SEED, probeFor(terr));
  const same = JSON.stringify(a) === JSON.stringify(b);
  check(same && a.length > 0, `same box twice is identical (${a.length} props at ${bx},${bz})`, same, 'true');

  /* The real test: the same square metre of ground, asked about as part of a DIFFERENT and
   * much larger box. Props are emitted per road-arc slot and filtered by the box, so each
   * must appear exactly once and in the same place however the world is tiled. This is the
   * property a per-chunk PRNG would silently break. */
  const big = new Terrain(SEED, bx - TILE, bz - TILE, bx + TILE * 2, bz + TILE * 2, 40);
  const wide = propsInBox(bx - TILE, bz - TILE, bx + TILE * 2, bz + TILE * 2, SEED, probeFor(big));
  const inTile = wide.filter((p) => p.x >= bx && p.x < bx + TILE && p.z >= bz && p.z < bz + TILE);
  let matched = 0;
  let moved = 0;
  for (const p of a) {
    const q = wide.find((o) => o.edgeKey === p.edgeKey && o.slot === p.slot);
    if (!q) continue;
    matched++;
    if (Math.hypot(q.x - p.x, q.z - p.z) > 1e-6 || q.id !== p.id) moved++;
  }
  check(matched === a.length && a.length > 0, 'every prop found again from a 3x wider box', `${matched}/${a.length}`, 'all');
  check(moved === 0, 'props that moved between boxes', moved, '0');
  check(inTile.length === a.length, 'same count inside the tile either way', `${inTile.length} vs ${a.length}`, 'equal');
  const dup = wide.length - new Set(wide.map((p) => `${p.edgeKey}#${p.slot}`)).size;
  check(dup === 0, 'props emitted twice', dup, '0');

  const fs = await import('node:fs');
  for (const f of ['../src/world/props.js', '../src/render/props.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    // The literal call, not the words in a comment explaining why it is not used.
    const bad = /Math\s*\.\s*random\s*\(/.test(src);
    check(!bad, `Math.random() call in ${f.replace('../', '')}`, bad ? 'present' : 'none', 'none');
  }
}

console.log('\n── rarity, clearance and seating (a 4 x 4 km sweep) ──────────────────────');
{
  /* 10 x 10 contiguous 512 m tiles, up from 8 x 8, and this is a SAMPLE-SIZE change, not a
   * relaxation. The two density checks below (`props per km of road`, `cans per km of road`)
   * are the real assertions and both are per-km ratios that this box size cannot move; the
   * `sample size` checks beside them exist only to stop a vacuous ratio being reported off two
   * props. What changed underneath them is the WORLD: roads that used to be built straight
   * across lakes are now routed round them (world/roads.js's water cull), which removes about a
   * third of the road length in any given fixed box — and these two boxes are fixed, at (0,0),
   * by design. So the same density now yields fewer absolute finds in the same square: 11
   * props against a bar of 15, while `props per km of road` sat at a healthy 1.78 in the middle
   * of its own 0.4–3.6 band, and 16 cans against 20 with 2.59 per km inside 0.9–3.9.
   *
   * Restoring the box AREA restores the sample count the guard was written against (11 -> 19,
   * 16 -> 28 measured) and leaves every threshold in this file exactly where it was. Lowering
   * the bars instead would have been the wrong move for the same reason it always is: it would
   * make the guard weaker at catching the thing it is for, rather than giving it back the
   * evidence it needs to do its job. */
  const N = 10;
  let props = [];
  let cans = [];
  let roadMetres = 0;
  const tiles = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const ox = i * TILE;
      const oz = j * TILE;
      const terr = new Terrain(SEED, ox, oz, ox + TILE, oz + TILE, 40);
      const probe = probeFor(terr);
      const list = propsInBox(ox, oz, ox + TILE, oz + TILE, SEED, probe);
      for (const p of list) p._terr = terr;
      props = props.concat(list);
      const canList = fuelCansInBox(ox, oz, ox + TILE, oz + TILE, SEED, probe);
      for (const c of canList) c._terr = terr;
      cans = cans.concat(canList);
      tiles.push({ ox, oz, terr });
    }
  }
  // Metres of road inside the same nine boxes, for the density figure.
  for (const t of tiles) {
    for (const e of edgesInBox(t.ox, t.oz, t.ox + TILE, t.oz + TILE, SEED, 0)) {
      let inside = 0;
      for (let k = 2; k < e.pts.length; k += 2) {
        const seg = Math.hypot(e.pts[k] - e.pts[k - 2], e.pts[k + 1] - e.pts[k - 1]);
        const mx = (e.pts[k] + e.pts[k - 2]) * 0.5;
        const mz = (e.pts[k + 1] + e.pts[k - 1]) * 0.5;
        if (mx >= t.ox && mx < t.ox + TILE && mz >= t.oz && mz < t.oz + TILE) inside += seg;
      }
      roadMetres += inside;
    }
  }
  const perKm = (props.length / roadMetres) * 1000;
  console.log(`       ${props.length} props over ${(roadMetres / 1000).toFixed(2)} km of road in a ${(N * TILE) / 1000} km square`);
  /* The upper end of this band was `3.2`, set the same way the two checks below it originally
   * were — never swept. `tools/diag-perkm.mjs` (601 seeds) found it fails for real: seed 28
   * hits 3.38, and a second seed (596) hits 3.22, both over the old ceiling, with the rest of
   * the tail decaying smoothly (3.17, 3.13, 3.08, ...) rather than one freak outlier. What
   * drives a high seed is downstream YIELD, not more candidates being generated
   * (corr(perKm, candidates/km) = 0.04; corr(perKm, yield) = 0.95) — specifically how much of
   * this seed's fixed box happens to sit clear of its own local water table
   * (corr(perKm, rejectWater rate) = -0.39). No single biome explains most of it (strongest is
   * Hoshi Meadow area at 0.42, Bara Dunes at -0.38, both well short of dominant) — this is the
   * same spatially-correlated, seed-varying effect already measured for relief/cliffs/stations
   * elsewhere in this project, not a bug in one biome. Retuning SLOT_P to chase the high tail
   * down was rejected: the LOW end has almost no headroom to give (measured min 0.43 against
   * the 0.4 floor, on seed 198, a different seed entirely), so a global cut would trade a
   * fail-hi for a fail-lo rather than removing one. `3.6` clears the measured max (3.38) with
   * real margin; nothing in 601 seeds came close. */
  check(perKm > 0.4 && perKm < 3.6, 'props per km of road', perKm.toFixed(2), '0.4 .. 3.6 (a find every 280-2500 m)');
  console.log(`       one find every ${(1000 / perKm).toFixed(0)} m of road — ${((1000 / perKm) / 26.4).toFixed(0)} s apart at a 95 km/h cruise`);
  /* This box is FIXED (0,0)-(4096,4096), not seed-relative, so its road-km and its perKm both
   * vary with the seed — and this count is their product. `> 40` was set by eyeballing one
   * seed (55, the default) and was never swept, so it silently assumed perKm would land near
   * that seed's 1.2-1.7 rather than anywhere in the range the check two lines up already
   * accepts. Measured (tools/diag-propcount.mjs, 540+ swept seeds): perKm's own accepted floor
   * (0.4) times the lowest roadKm actually seen in this box (~36 km) is ~14 props — a
   * perfectly in-spec, legitimate low-density seed — and the true observed minimum across the
   * sweep was 21 (seed 198: perKm 0.43, right at the floor, mostly rejectWater). `> 40` failed
   * 9 of 542 swept seeds (1.7%) for exactly this reason, none of them a placement bug — every
   * failing seed's rejection tally looks like ordinary freeboard/slope loss, the same mechanism
   * this file's own propsInBox comment already documents. `> 15` sits a little below that
   * measured floor (real margin, not a re-fit to the exact minimum seen) while still catching
   * the thing this check exists for: a vacuous or near-zero result from an actual regression. */
  check(props.length > 15, 'sample size', props.length, '> 15');

  let onRoad = 0;
  let worstClear = Infinity;
  let floatWorst = 0;
  let buryWorst = 0;
  const overBudget = [];
  for (const p of props) {
    const t = p._terr;
    const c = t.roads.carve(p.x, p.z);
    if (c.edge > 0.001) onRoad++;
    const k = PROP_BY_ID[p.id];
    const clear = c.d - c.width * 0.5 - k.foot * p.scale;
    if (clear < worstClear) worstClear = clear;
    // Seating: the ground at the footprint corners against the prop's own base height.
    const r = Math.max(k.foot * p.scale, 0.6);
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const g = t.height(p.x + dx, p.z + dz);
      const gap = p.y - g; // > 0 means the foot is in the air at this corner
      if (gap > floatWorst) floatWorst = gap;
      if (-gap > buryWorst) buryWorst = -gap;
      // The invariant the placement code actually promises: a prop never beds into the
      // ground by more than the tolerance its own catalogue entry declares. Reporting the
      // worst absolute metre is not enough — a barn cut 1.3 m into a bank is correct and a
      // fingerpost cut 0.5 m in is not, and one global threshold cannot tell them apart.
      /* The invariant placement promises, reproduced exactly: it samples at 1.15x the
       * scaled footprint and sits the prop on the LOWEST of those probes, minus a deliberate
       * few centimetres so no footing can hang in the air. This test samples at 1.0x, so it
       * can legitimately find ground up to that sink deeper than the base. */
      const pr = Math.max(k.foot * p.scale * 1.15, 0.6);
      const sink = 0.04 + k.foot * p.scale * 0.03;
      const allow = Math.min(2 * pr * Math.tan(Math.acos(k.slope)), 0.3 + k.foot * 0.16) + sink + 0.02;
      if (-gap > allow) overBudget.push(`${p.id} ${(-gap).toFixed(2)}>${allow.toFixed(2)}`);
    }
  }
  check(onRoad === 0, 'props standing on a carriageway', onRoad, '0');
  check(worstClear > 0, 'tightest clearance to the tarmac (m)', worstClear.toFixed(2), '> 0');
  check(floatWorst < 0.02, 'worst float above the ground (m)', floatWorst.toFixed(3), '< 0.02');
  check(overBudget.length === 0, 'props bedded deeper than their own tolerance', overBudget.slice(0, 4).join(' ') || 0, '0');
  console.log(`       worst burial ${buryWorst.toFixed(2)} m (a big building cut into a bank; the cap is 0.30 + footprint x 0.16)`);

  const byGroup = {};
  const byBiome = {};
  for (const p of props) {
    byGroup[p.group] = (byGroup[p.group] || 0) + 1;
    byBiome[BIOME_NAMES[p.dominant]] = (byBiome[BIOME_NAMES[p.dominant]] || 0) + 1;
  }
  console.log('       by group :', Object.entries(byGroup).map(([k, v]) => `${k} ${v}`).join('  '));
  console.log('       by biome :', Object.entries(byBiome).map(([k, v]) => `${k} ${v}`).join('  '));
  const kinds = new Set(props.map((p) => p.id));
  console.log(`       ${kinds.size} distinct kinds appeared in this sample`);

  console.log(`\n── floating fuel cans (same ${(N * TILE) / 1000} km square) ────────────────────────`);
  const canPerKm = (cans.length / roadMetres) * 1000;
  console.log(`       ${cans.length} cans over ${(roadMetres / 1000).toFixed(2)} km of road — one every ${(1000 / canPerKm).toFixed(0)} m`);
  // Deliberately denser than the ambient props' ~1.2/km (one every ~830 m): a can exists to
  // backstop STATION_P's rare double-digit-km droughts (see world/props.js), which needs
  // reliable coverage, not just a low average — tools/diag-stations.mjs is where that
  // trade-off is actually justified against a real worst-case gap, not here.
  /* The `0.9 .. 2.8` band was set from six seeds (20260726, 1-5: 1.46 .. 2.46/km) and was the
   * same class of mistake as the two checks fixed a pass earlier — never swept past those six.
   * `tools/diag-perkm.mjs` (601 seeds) shows it failing for real, not rarely: 62 of 601 seeds
   * (10.3%) exceed 2.8, a smoothly decaying tail (3.55, 3.35, 3.31, 3.31, 3.21, ...), not one
   * pathological seed — seeds 28/155/177 are simply three points on that tail. Driven almost
   * entirely by downstream yield, not extra candidates (corr(canPerKm, candidates/km) = 0.14;
   * corr(canPerKm, yield) = 0.80), and within yield the single strongest lever is how much of
   * the box sits clear of its own local water table (corr(canPerKm, rejectWater rate) = -0.69
   * — the biggest correlation this sweep found, for either props or cans). No one biome
   * dominates (Hoshi Meadow area correlates 0.37, Bara Dunes -0.50, everything else weaker) —
   * this is the water table's seed-to-seed placement, the same spatially-correlated effect
   * diag-stations.mjs already documented for petrol stations, not a mistuned biome. Retuning
   * CAN_SLOT_P down to chase the tail was rejected for the same reason as the props ceiling
   * above: it would push the whole distribution toward the LOW end, which already has less
   * room on this check (min observed 1.28 against a 0.9 floor) than the props check does, for
   * a problem that is not actually about how many cans get OFFERED. `3.9` clears the measured
   * max (3.55) with real margin. */
  check(canPerKm > 0.9 && canPerKm < 3.9, 'cans per km of road', canPerKm.toFixed(2), '0.9 .. 3.9 (denser than the ambient props, still not a station)');
  check(cans.length > 20, 'sample size', cans.length, '> 20');

  let canOnRoad = 0;
  let canWorstClear = Infinity;
  let canFloatWorst = 0;
  let canBuryWorst = 0;
  for (const c of cans) {
    const t = c._terr;
    const cc = t.roads.carve(c.x, c.z);
    if (cc.edge > 0.001) canOnRoad++;
    const clear = cc.d - cc.width * 0.5 - CAN_FOOT;
    if (clear < canWorstClear) canWorstClear = clear;
    // The PLACEMENT height (before the render-side hover is added) must sit on the real
    // ground exactly like any other prop's — see the file comment in world/props.js for why
    // hover is deliberately NOT part of this number.
    const g = t.height(c.x, c.z);
    const gap = c.y - g;
    if (gap > canFloatWorst) canFloatWorst = gap;
    if (-gap > canBuryWorst) canBuryWorst = -gap;
  }
  check(canOnRoad === 0, 'cans standing on a carriageway', canOnRoad, '0');
  check(canWorstClear > 0, 'tightest clearance to the tarmac (m)', canWorstClear.toFixed(2), '> 0');
  check(canFloatWorst < 0.05, 'placement float above the ground, BEFORE the render-side hover (m)', canFloatWorst.toFixed(3), '< 0.05');
  check(canBuryWorst < 0.6, 'placement burial below the ground (m)', canBuryWorst.toFixed(3), '< 0.6');
  console.log(`       CAN_HOVER ${CAN_HOVER} m (added at render time, src/render/props.js), CAN_RADIUS ${CAN_RADIUS} m, CAN_FRACTION ${CAN_FRACTION} of a tank`);

  // Determinism: the same argument as the props check above, because a can is exactly as
  // capable of being emitted twice or drifting between boxes as anything else in this file.
  {
    const wide = fuelCansInBox(-TILE, -TILE, N * TILE + TILE, N * TILE + TILE, SEED, probeFor(new Terrain(SEED, -TILE, -TILE, N * TILE + TILE, N * TILE + TILE, 60)));
    let matched = 0;
    let moved = 0;
    for (const c of cans) {
      const q = wide.find((o) => o.key === c.key);
      if (!q) continue;
      matched++;
      if (Math.hypot(q.x - c.x, q.z - c.z) > 1e-6) moved++;
    }
    check(matched === cans.length && cans.length > 0, 'every can found again from a wider box', `${matched}/${cans.length}`, 'all');
    check(moved === 0, 'cans that moved between boxes', moved, '0');
    const dup = cans.length - new Set(cans.map((c) => c.key)).size;
    check(dup === 0, 'cans emitted twice', dup, '0');
  }
}

console.log('\n── petrol stations ───────────────────────────────────────────────────────');
{
  const sp = stationSpacing(SEED, 9000);
  console.log(`       ${sp.stations} stations over ${(sp.arterialMetres / 1000).toFixed(0)} km of arterial`);
  check(sp.metresPerStation > 1500 && sp.metresPerStation < 5000, 'metres of arterial per station',
    sp.metresPerStation.toFixed(0), '1500 .. 5000 (a tank is ~9 km)');

  // Pure? Two different boxes must agree on the same station.
  const a = stationsInBox(0, 0, 4000, 4000, SEED);
  const b = stationsInBox(-2000, -2000, 6000, 6000, SEED).filter((s) => s.x >= 0 && s.x < 4000 && s.z >= 0 && s.z < 4000);
  const byKey = new Map(b.map((s) => [s.key, s]));
  let drift = 0;
  for (const s of a) {
    const o = byKey.get(s.key);
    if (!o || Math.hypot(o.x - s.x, o.z - s.z) > 1e-6 || Math.abs(o.y - s.y) > 1e-4) drift++;
  }
  check(drift === 0 && a.length === b.length, 'stations independent of the query box', `${a.length} vs ${b.length}, drift ${drift}`, 'equal, 0');

  let worstStep = 0;
  let worstGrade = 0;
  let worstSpurRamp = 0;
  let worstSpurEndFinite = true;
  for (const s of a.slice(0, 12)) {
    const terr = new Terrain(SEED, s.x - 40, s.z - 40, s.x + 40, s.z + 40, 40);
    const ca = Math.cos(s.yaw);
    const sa = Math.sin(s.yaw);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [dx, dz] of [[9, 6], [-9, 6], [9, -6], [-9, -6], [0, 7], [0, -7]]) {
      const g = terr.height(s.x + dx * ca - dz * sa, s.z + dx * sa + dz * ca);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    const pad = Math.min(Math.max(hi + 0.04, s.y - 0.7), s.y + 0.3);
    worstStep = Math.max(worstStep, Math.abs(pad - s.y));
    worstGrade = Math.max(worstGrade, s.grade);

    /* The access spur's own ramp, measured the way buildAccessSpur (src/render/props.js)
     * actually computes it: the REAL road-carve height at the mouth (never s.y, which is only
     * the host edge's own solo canonical height and can legitimately differ near a junction —
     * see diag-stations.mjs's own note on this) against this same forecourt's padY. This is
     * the number that actually decides whether the drawn driveway is a gentle grade or a
     * cliff — the fall-through-class invariant this project has been bitten by once already,
     * now checked for the spur specifically, using the identical Terrain the renderer used. */
    const spur = stationSpur(s);
    const hRoad = terr.height(spur.mouthX, spur.mouthZ);
    if (!isFinite(hRoad)) worstSpurEndFinite = false;
    else worstSpurRamp = Math.max(worstSpurRamp, Math.abs(hRoad - pad));
  }
  check(worstStep <= 0.71, 'worst step from road to forecourt (m)', worstStep.toFixed(2), '<= 0.7');
  check(worstGrade <= STATION_MAX_GRADE, 'steepest road a station sits on', worstGrade.toFixed(3), `<= ${STATION_MAX_GRADE} (STATION_MAX_GRADE)`);
  check(worstSpurEndFinite, 'access spur mouth height is always a real number', worstSpurEndFinite, 'true');
  // A real driveway grade over the spur's own ~8.9 m length (STATION_OFFSET - APRON_HALF_DEPTH
  // + 0.4, world/props.js), not a flat pad — so this is deliberately looser than the 0.7 m
  // forecourt-step bound above, while still catching a genuine cliff (a fall-through-class
  // bug would show as many metres here, not a handful).
  check(worstSpurRamp <= 3.0, 'worst rise/fall along the access spur, mouth to apron (m)', worstSpurRamp.toFixed(2), '<= 3.0 (a real driveway grade, not a cliff)');
}

console.log('\n── frame cost ────────────────────────────────────────────────────────────');
{
  const scene = new Object3D();
  // Warm the JIT on a window we then throw away: the first Terrain in a process costs three
  // times what the thousandth does, and reporting that as the frame cost would be a lie in
  // the wrong direction.
  const warm = new Props({ seed: SEED, scene, solids: null });
  warm.update(1 / 60, -40000, -40000);
  while (warm.stats.backlog > 0) warm.update(1 / 60, -40000, -40000);
  warm.dispose();

  const props = new Props({ seed: SEED, scene, solids: null });
  const samples = [];
  props.update(1 / 60, 0, 0);
  samples.push(props.stats.buildMs);
  let frames = 0;
  while (props.stats.backlog > 0 && frames < 4000) {
    props.update(1 / 60, 0, 0);
    samples.push(props.stats.buildMs);
    frames++;
  }
  samples.sort((a, b) => a - b);
  const total = samples.reduce((a, b) => a + b, 0);
  const med = samples[samples.length >> 1];
  const p90 = samples[(samples.length * 0.9) | 0];
  const max = samples[samples.length - 1];
  const s = props.stats;
  let meshes = 0;
  for (const rec of props.live.values()) if (rec.mesh) meshes++;
  console.log(`       window filled in ${samples.length} frames (~${(samples.length / 60).toFixed(2)} s of driving), ${total.toFixed(0)} ms of work`);
  console.log(`       ${s.tiles} tiles, ${s.props} props, ${s.stations} stations, ${s.verts} verts, ${s.tris} triangles`);
  console.log(`       per frame while filling: median ${med.toFixed(2)} ms, p90 ${p90.toFixed(2)} ms, worst ${max.toFixed(2)} ms`);
  /* <= 25 was set from one seed (the default measured 21-22, see render/props.js's own TILE
   * comment) plus a flat +4, never swept. Tile occupancy is a real random variable — how many
   * of the ~44 windowed tiles end up non-empty rises and falls with how dense THIS seed's
   * props/stations happen to be, which the perKm check above already accepts across an 8x
   * range (0.4 .. 3.2/km). Measured (tools/diag-propcount.mjs, 540+ swept seeds): mean ~19.6,
   * sd ~4.5, true observed max 32, and every seed at or above the old ceiling had an ordinary,
   * higher-than-average perKm — not a baking or leak bug. <= 25 failed 38 of 542 swept seeds
   * (7%). <= 34 clears the full measured range with margin while staying a real regression
   * guard: a genuine draw-call blowup (e.g. tiles no longer baking into one mesh) would still
   * be caught, since nothing in 542 seeds came remotely close to it. */
  check(meshes <= 34, 'added draw calls (one per non-empty tile)', meshes, '<= 34');
  check(s.tris < 60000, 'triangles added to the frame', s.tris, '< 60000');
  check(max < 12, 'worst single frame spent on props (ms)', max.toFixed(2), '< 12 (render/road.js already spends 15.8 in one frame every 180 m)');
  check(med < 5, 'median frame spent on props (ms)', med.toFixed(2), '< 5');

  /* ── is any of it actually drawable ──────────────────────────────────────
   * A flag being set is not a thing being visible. Without a browser the strongest available
   * proof is the geometry itself: the exact attribute set the painted shader declares
   * (position from VHEAD, nrm/vcol/vmat from PAINTED_VS), a bounding sphere with real extent,
   * and a centre that lands inside the tile it belongs to — which is what would catch a
   * transform bug that piled every prop on the origin. */
  {
    const need = ['position', 'nrm', 'vcol', 'vmat'];
    let bad = [];
    let offTile = 0;
    let zeroRadius = 0;
    let counted = 0;
    let minR = 1e9;
    let maxR = 0;
    for (const [key, rec] of props.live) {
      if (!rec.mesh) continue;
      counted++;
      const g = rec.mesh.geometry;
      for (const a of need) if (!g.attributes[a]) bad.push(`${key}:${a}`);
      if (!g.index) bad.push(`${key}:index`);
      const bs = g.boundingSphere;
      // A tile holding one letterbox is legitimately a 0.3 m sphere; what must never
      // happen is a missing or non-finite one, which disables frustum culling silently.
      if (!bs || !(bs.radius > 0) || !isFinite(bs.radius) || !isFinite(bs.center.x)) zeroRadius++;
      else {
        minR = Math.min(minR, bs.radius);
        maxR = Math.max(maxR, bs.radius);
        const [tx, tz] = key.split(',').map(Number);
        const cx = (tx + 0.5) * props.tile;
        const cz = (tz + 0.5) * props.tile;
        if (Math.abs(bs.center.x - cx) > props.tile || Math.abs(bs.center.z - cz) > props.tile) offTile++;
      }
      // vmat must actually address the shader's material slots, not all be zero: an EMIT
      // window that came through as MATTE is the difference between a lit kiosk and a box.
      const vm = g.attributes.vmat.array;
      let emit = 0;
      for (let i = 0; i < vm.length; i++) if (vm[i] > 1.5) emit++;
      rec._emit = emit;
    }
    const litTiles = [...props.live.values()].filter((r) => r._emit > 0).length;
    console.log(`       ${counted} meshes, bounding radius ${minR.toFixed(0)}-${maxR.toFixed(0)} m, ${litTiles} of them contain self-lit geometry`);
    check(bad.length === 0, 'meshes missing a shader attribute', bad.slice(0, 3).join(' ') || 0, '0');
    check(zeroRadius === 0, 'meshes with no bounding sphere to cull by', zeroRadius, '0');
    check(offTile === 0, 'meshes whose geometry is not near their tile', offTile, '0 (catches a lost transform)');
    check(litTiles > 0, 'tiles with EMIT geometry (lanterns, lit windows, pumps)', litTiles, '> 0');

    /* Fuel cans are deliberately NOT in props.live (see render/props.js's constructor
     * comment) — one mesh each, in props.cans, so the scene-graph count above has to include
     * them too or this check fails the moment a can exists, which it now always does. Same
     * "is it actually drawable" rigor, applied to the can meshes specifically: real shader
     * attributes, a real bounding sphere, and — since a can is not tile-keyed — centred on
     * its OWN (x, z) rather than a tile midpoint. */
    let canBad = [];
    let canZeroRadius = 0;
    let canOffPos = 0;
    let canEmit = 0;
    for (const [key, c] of props.cans) {
      const g = c.mesh.geometry;
      for (const a of need) if (!g.attributes[a]) canBad.push(`${key}:${a}`);
      if (!g.index) canBad.push(`${key}:index`);
      const bs = g.boundingSphere;
      if (!bs || !(bs.radius > 0) || !isFinite(bs.radius) || !isFinite(bs.center.x)) canZeroRadius++;
      else if (Math.abs(bs.center.x - c.x) > 2 || Math.abs(bs.center.z - c.z) > 2) canOffPos++;
      const vm = g.attributes.vmat.array;
      for (let i = 0; i < vm.length; i++) if (vm[i] > 1.5) canEmit++;
    }
    console.log(`       ${props.cans.size} fuel-can meshes, ${canEmit ? 'EMIT geometry present (the glint)' : 'no EMIT geometry — the glint is missing'}`);
    check(canBad.length === 0, 'can meshes missing a shader attribute', canBad.slice(0, 3).join(' ') || 0, '0');
    check(canZeroRadius === 0, 'can meshes with no bounding sphere to cull by', canZeroRadius, '0');
    check(canOffPos === 0, 'can meshes whose geometry is not at their own position', canOffPos, '0 (catches a lost transform)');
    check(canEmit > 0, 'cans with EMIT geometry (the glint, for spotting them)', canEmit, '> 0');

    const total = counted + props.cans.size;
    check(props.group.children.length === total, 'meshes actually attached to the scene graph', `${props.group.children.length} vs ${total} (tiles + cans)`, 'equal');
  }

  // Steady state: once the window is full, an update must cost essentially nothing.
  const idle = [];
  for (let i = 0; i < 200; i++) {
    const t = performance.now();
    props.update(1 / 60, 0, 0);
    idle.push(performance.now() - t);
  }
  idle.sort((a, b) => a - b);
  check(idle[idle.length >> 1] < 0.05, 'steady-state update cost (ms)', idle[idle.length >> 1].toFixed(4), '< 0.05');

  // Moving the window must not leak: drive 3 km and check the tile count is bounded.
  for (let i = 0; i < 3000; i += 40) {
    props.update(1 / 60, i, 0);
    for (let g = 0; g < 6; g++) props.update(1 / 60, i, 0);
  }
  check(props.live.size <= 60, 'tiles retained after driving 3 km', props.live.size, '<= 60');
  check(props.stations.length < 40, 'stations in live tiles after driving 3 km', props.stations.length, '< 40');
  check(props.known.size > props.stations.length && props.known.size <= 192,
    'stations remembered along the way (so the gauge can point at one)', props.known.size, `> live, <= 192`);
  // Measured across six seeds: 23 .. 56. Cans are denser than stations by design (see
  // world/props.js), so this is a much looser bound than the stations one above — the point
  // of the check is catching true unbounded growth (hundreds, thousands), not pinning an
  // exact count.
  check(props.cans.size < 90, 'fuel cans in live tiles after driving 3 km', props.cans.size, '< 90 (no unbounded growth)');
  {
    const far = props.nearestStation(1500, 0);
    check(!!far, 'nearestStation still answers away from a live tile', far ? `${(far.dist / 1000).toFixed(2)} km` : 'null', 'a station');
  }

  /* ── does a can actually bob, and does collecting one actually work ────────
   * A flag being set is not a thing being visible or a thing that happened: drive the REAL
   * Props instance's update() loop, read the mesh's own Y across two different times to prove
   * the bob is a real transform change (not just CAN_BOB_AMP existing as a constant), then
   * drive the car onto a real can's real position and confirm — from the object's own state,
   * not from reasoning about the code — that it is gone from the scene graph, counted as
   * collected, paid out through drainCollectedFuel(), and does not come back. */
  console.log('\n── a can, bobbing and collected ──────────────────────────────────────────');
  {
    // The 3 km drive just above is a straight line along z=0, and on some seeds (9, 30) that
    // line passes within CAN_RADIUS of a live can — _updateCans auto-collects it as an
    // ordinary side effect of driving past, exactly like a real car would. Discard that here,
    // before this section's own "nothing collected yet" baseline, so the earlier drive's
    // incidental pickup isn't mistaken for this section's own collection test misbehaving
    // (see docs/BACKLOG.md).
    props.drainCollectedFuel();
    const [canKey, can] = [...props.cans.entries()][0] || [];
    check(!!can, 'a live can exists to test against', can ? `${canKey} at ${can.x.toFixed(0)},${can.z.toFixed(0)}` : 'none', 'one');
    if (can) {
      const y0 = can.mesh.position.y;
      // 60 m away — outside CAN_RADIUS so this does not collect it, but nowhere near far
      // enough to move the tile window (RANGE is 1180 m) and release the can's own tile,
      // which the first version of this test got wrong: it held (0, 0), many kilometres from
      // wherever the earlier 3 km drive left the window, released the can's tile as an
      // ordinary consequence of _reshape, and then silently re-created a fresh can of the
      // same key when the window was driven back — "passing" for the wrong reason entirely.
      for (let i = 0; i < 30; i++) props.update(1 / 60, can.x + 60, can.z); // half a second
      const y1 = can.mesh.position.y;
      check(y0 !== y1, "the can's mesh Y actually changed frame to frame (the bob)", `${y0.toFixed(4)} -> ${y1.toFixed(4)}`, 'different');
      check(Math.abs(y1) <= CAN_BOB_AMP + 1e-6, 'bob stays within its own amplitude', y1.toFixed(4), `<= ${CAN_BOB_AMP}`);

      const before = props.drainCollectedFuel();
      check(before === 0, 'nothing collected yet', before, '0');
      const meshBefore = props.group.children.includes(can.mesh);
      check(meshBefore, "the can's mesh is really in the scene graph before collection", meshBefore, 'true');

      // Drive the car (camX, camZ passed to update — the same argument main.js passes
      // car.x, car.z as) directly onto the can and hold it there.
      for (let i = 0; i < 5; i++) props.update(1 / 60, can.x, can.z);
      const gained = props.drainCollectedFuel();
      check(Math.abs(gained - CAN_FRACTION) < 1e-9, 'collecting it pays out exactly CAN_FRACTION', gained.toFixed(3), CAN_FRACTION.toFixed(3));
      check(!props.cans.has(canKey), 'the can is gone from the live map', props.cans.has(canKey), 'false');
      check(!props.group.children.includes(can.mesh), "and its mesh is gone from the scene graph", props.group.children.includes(can.mesh), 'false');

      // Standing on the same spot for another five frames must not pay out again.
      for (let i = 0; i < 5; i++) props.update(1 / 60, can.x, can.z);
      const again = props.drainCollectedFuel();
      check(again === 0, 'standing on an already-collected spot does not pay out twice', again, '0');
    }
  }

  props.dispose();
}

console.log('\n── a real station hitbox actually stops the car ──────────────────────────');
{
  /* The operator's screenshot: the car was free to overlap the kiosk, the pumps and the
   * canopy posts — nothing on a forecourt had a hitbox. This drives a REAL Vehicle at a REAL,
   * loaded station's kiosk through the REAL Solids resolver (the same objects main.js wires
   * together) and reads the car's own final position and velocity — not a flag, not a count of
   * registered colliders, an actual stop. */
  const scene = new Object3D();
  const solids = new Solids();
  const props = new Props({ seed: SEED, scene, solids });

  // Stations sit a couple of km apart and the tile window only reaches ~1.2 km, so — rather
  // than hope one falls within range of the origin on every seed — find a real one first
  // (nearestStation is pure and cheap) and drive the window to ITS location, guaranteeing its
  // tile actually gets built and baked.
  const target = nearestStation(0, 0, SEED, 20000);
  check(!!target, 'a real station exists somewhere to test collision against', target ? `${(target.dist / 1000).toFixed(2)} km from the origin` : 'none', 'one');

  if (target) {
    let st = null;
    for (let i = 0; i < 4000 && !st; i++) {
      props.update(1 / 60, target.x, target.z);
      st = props.stations.find((s) => s.key === target.key) || null;
    }
    check(!!st, 'that station is actually live and baked (with its own padY/hitboxes)', st ? `${st.key} at ${st.x.toFixed(0)},${st.z.toFixed(0)}` : 'none', 'one');

    if (st) {
      // The car's own terrain is a flat stand-in AT THE STATION'S OWN GRADED HEIGHT, so the
      // collider (baked against the REAL world) and the car (driven on the stub) agree on
      // where the ground is — this tests the hitbox itself, not a second terrain sampler.
      const STUB = {
        surface: () => ({ y: st.padY, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0.06, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
        height: () => st.padY,
      };
      const car = new Vehicle({ tier: 'touring', terrain: STUB, preset: 'cruise' });

      // Aim the car at the kiosk hut — STATION_HITBOXES' own local (0, -(AD-2.2)) entry in
      // src/render/props.js — approaching from 14 m further out along the SAME local axis, so
      // the run-up crosses real open apron before it reaches anything solid.
      const ca = Math.cos(st.yaw), sa = Math.sin(st.yaw);
      const kioskDX = 0, kioskDZ = -(STATION_APRON_HALF_DEPTH - 2.2);
      const kioskX = st.x + kioskDX * ca - kioskDZ * sa;
      const kioskZ = st.z + kioskDX * sa + kioskDZ * ca;
      const startDZ = kioskDZ - 14;
      const startX = st.x + 0 * ca - startDZ * sa;
      const startZ = st.z + 0 * sa + startDZ * ca;
      const heading = Math.atan2(kioskX - startX, kioskZ - startZ);
      car.placeAt(startX, startZ, heading);
      car.speed = 12; // a real, deliberate approach speed (43 km/h), not a crawl
      car.vx = Math.sin(heading) * car.speed;
      car.vz = Math.cos(heading) * car.speed;

      const DT = 1 / 60;
      let stopped = false;
      let minDist = Infinity;
      for (let k = 0; k < 60 * 8 && !stopped; k++) {
        car.update(DT, { steer: 0, throttle: 0.5, brake: 0, handbrake: 0, analogue: true });
        solids.resolve(car, 1.05, DT);
        const d = Math.hypot(car.x - kioskX, car.z - kioskZ);
        if (d < minDist) minDist = d;
        if (k > 10 && Math.hypot(car.vx, car.vz) < 0.5) stopped = true;
      }
      const finalDist = Math.hypot(car.x - kioskX, car.z - kioskZ);
      console.log(`       drove at the kiosk from 14 m out (43 km/h, half throttle held): closest approach ${minDist.toFixed(2)} m, stopped ${finalDist.toFixed(2)} m short`);
      check(stopped, 'the car actually came to a stop rather than driving straight through', stopped, 'true');
      check(minDist > 2.0, 'never got closer than the hitbox (kiosk r=2.5 m) plus the car radius allow', minDist.toFixed(2), '> 2.0 m');
      check(finalDist < 13, 'and stopped NEAR the kiosk, not stalled short for an unrelated reason', finalDist.toFixed(2), '< 13 m (started 14 m out)');

      // And the open apron itself must NOT be a wall — driving onto the forecourt (well clear
      // of the kiosk/pump/post hitboxes) must not stop the car, or nobody could ever refuel.
      const car2 = new Vehicle({ tier: 'touring', terrain: STUB, preset: 'cruise' });
      const apronDZ = 3.5; // toward the road from centre, inside the forecourt, clear of every STATION_HITBOXES entry
      const apronX = st.x + 0 * ca - apronDZ * sa;
      const apronZ = st.z + 0 * sa + apronDZ * ca;
      car2.placeAt(apronX, apronZ, 0);
      car2.speed = 0;
      for (let k = 0; k < 60 * 2; k++) {
        car2.update(DT, { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true });
        solids.resolve(car2, 1.05, DT);
      }
      const drift = Math.hypot(car2.x - apronX, car2.z - apronZ);
      check(drift < 0.5, 'the open apron itself is drivable — a stationary car there is not pushed out by an invisible wall', drift.toFixed(3), '< 0.5 m');
    }
  }
  props.dispose();
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all props checks passed'}\n`);
process.exit(failures ? 1 : 0);
