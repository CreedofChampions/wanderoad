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
  CAN_HOVER, CAN_RADIUS, CAN_FRACTION, CAN_FOOT, STATION_MAX_GRADE, STATION_APRON_HALF_DEPTH, STATION_APRON_HALF_WIDTH,
  nearestStation, stationSpur, stationPad, stationSits, STATION_MAX_STEP,
  STATION_MAX_ROUGH, STATION_MAX_DOOR, PAD_BURY_MAX,
} from '../src/world/props.js';
import { Props, missingGeometry, measureAll, CAN_BOB_AMP, stationSolids, buildStation, SHOWROOM_CARS } from '../src/render/props.js';
import { PB } from '../src/render/painted.js';
import { Terrain } from '../src/world/terrain.js';
import { waterLevelAt, BIOME_COUNT, BIOME_NAMES } from '../src/world/biomes.js';
import { edgesInBox } from '../src/world/roads.js';
import { Solids } from '../src/game/collide.js';
import { Vehicle } from '../src/car/vehicle.js';
import { clamp, rng, hash3i } from '../src/core/math.js';

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
   * Clover Meadow area at 0.42, Copper Dunes at -0.38, both well short of dominant) — this is the
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
   * dominates (Clover Meadow area correlates 0.37, Copper Dunes -0.50, everything else weaker) —
   * this is the water table's seed-to-seed placement, the same spatially-correlated effect
   * diag-stations.mjs already documented for petrol stations, not a mistuned biome. Retuning
   * CAN_SLOT_P down to chase the tail was rejected for the same reason as the props ceiling
   * above: it would push the whole distribution toward the LOW end, which already has less
   * room on this check (min observed 1.28 against a 0.9 floor) than the props check does, for
   * a problem that is not actually about how many cans get OFFERED. `3.9` clears the measured
   * max (3.55) with real margin.
   *
   * HALVED, on the operator's instruction ("Cans a bit too abundant — reduce by 50%"):
   * CAN_SLOT_P went [0.35, 0.42] -> [0.175, 0.21] and this band came down WITH it, by the same
   * factor, rather than being left wide enough to pass either way. Re-measured on this exact
   * check, five seeds, everything else unchanged: 20260726 3.53 -> 1.62, and the new spread
   * across 7 / 424242 / 991 / 20260101 is 1.41 .. 1.86. The band is the old one halved
   * (0.45 .. 1.95, rounded to 2.0), so the CEILING is now a materially TIGHTER check than the
   * 3.9 it replaces — it fails if the halving is ever quietly undone — while the floor keeps
   * the same proportional headroom the 601-seed sweep above earned. */
  check(canPerKm > 0.45 && canPerKm < 2.0, 'cans per km of road', canPerKm.toFixed(2), '0.45 .. 2.0 (half the old density, on purpose)');
  /* B11: this absolute floor was `> 20`, set against the PRE-HALVING density (canPerKm's own
   * floor was 0.9 then) and never brought down when CAN_SLOT_P was halved for "cans a bit too
   * abundant". The ratio check just above was halved with it (0.9 -> 0.45); this one was not,
   * so it now fails on a correctly-functioning halved spawn rate — measured 18 cans at 0.50/km,
   * squarely inside the passing ratio band. Halved by the same factor as the density it is
   * guarding, same as the ratio check's own comment above describes doing. */
  check(cans.length > 10, 'sample size', cans.length, '> 10');

  let canOnRoad = 0;
  let canWorstClear = Infinity;
  let canFloatWorst = 0;
  let canBuryWorst = 0;
  /* ── can you get one WITHOUT breaking your streak ──────────────────────────
   * Operator: "Gas cans need to be accessible from the road, otherwise you have to break your
   * streak to get a gas can. Self-defeating."
   *
   * Measured, not asserted, and measured against game/streak.js's OWN rule rather than a
   * plausible-looking distance. streak.js breaks when `surf.onRoad < ON_ROAD` at the car's
   * centre or at any of the four wheels; `onRoad` is roads.js's
   * `edge = 1 - smoothstep(half - 0.4, half + 0.35, d)`, which crosses 0.45 within 5 mm of
   * `d = half`. So the furthest a wheel may be from the centreline is `half`, a wheel is
   * WHEEL_HALF off the car's own centreline, and the furthest a LEGAL driving line can be from
   * this can is therefore `canOffset - half + WHEEL_HALF`. If that is under CAN_RADIUS the can
   * is collectable from the tarmac; if it is not, taking it costs you the streak, which is the
   * bug the operator reported. `carve().d` is the real distance to the real centreline of the
   * road this can hangs off — the same RoadField everything else in this project reads. */
  const WHEEL_HALF = 0.8;
  let canWorstReach = 0;
  let canUnreachable = 0;
  for (const c of cans) {
    const t = c._terr;
    const cc = t.roads.carve(c.x, c.z);
    if (cc.edge > 0.001) canOnRoad++;
    const clear = cc.d - cc.width * 0.5 - CAN_FOOT;
    if (clear < canWorstClear) canWorstClear = clear;
    const reach = cc.d - cc.width * 0.5 + WHEEL_HALF;
    if (reach > canWorstReach) canWorstReach = reach;
    if (reach >= CAN_RADIUS) canUnreachable++;
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
  console.log(`       furthest any can sits from a streak-legal driving line: ${canWorstReach.toFixed(2)} m, against a ${CAN_RADIUS} m pickup`);
  check(canUnreachable === 0, 'cans that cost you the streak to collect', canUnreachable, '0 of ' + cans.length);
  check(canWorstReach < CAN_RADIUS - 2, 'worst reach from the tarmac to a can (m)', canWorstReach.toFixed(2), `< ${CAN_RADIUS - 2} (CAN_RADIUS with 2 m of margin)`);

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

  /* ...and the same number a DRIVER gets, which is not the same number. `stationSpacing` is
   * pure — it counts every station the placement chose. The tiler then drops the ones whose
   * forecourt cannot be graded onto the real, road-carved ground it is standing on (see
   * stationPad / STATION_MAX_ROUGH / STATION_MAX_DOOR in src/world/props.js), and a station
   * that is never drawn is not a station you can refuel at. Reporting only the pure figure
   * after adding that filter would overstate the world by exactly the drop rate, so the drop
   * rate is measured here, on real Terrain, and the effective spacing is printed next to it. */
  {
    const all = stationsInBox(-4500, -4500, 4500, 4500, SEED);
    let kept = 0;
    for (const s of all) {
      const t = new Terrain(SEED, s.x - 40, s.z - 40, s.x + 40, s.z + 40, 40);
      if (stationSits(s, (x, z) => t.height(x, z))) kept++;
    }
    const eff = sp.metresPerStation * (all.length / Math.max(1, kept));
    console.log(`       real-ground test keeps ${kept} of ${all.length} (${((100 * kept) / all.length).toFixed(0)}%) -> effective ${eff.toFixed(0)} m of arterial per station`);
    check(kept / all.length >= 0.7, 'forecourts that survive the real ground', `${kept}/${all.length}`, '>= 70%');
    check(eff < 5000, 'EFFECTIVE metres of arterial per drawn station', eff.toFixed(0), '< 5000 (a tank is ~9 km)');
  }

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
  /* ── the buried forecourt, which is why "the collisions are non-existent" ──
   * Operator, twice: "The collisions of fuel stations are still non-existent." The hitboxes
   * (render/props.js STATION_HITBOXES) were registered on every baked tile the whole time —
   * `solids.count` proves that and always did. What was NOT true is that they could be hit:
   * game/collide.js drops any collider the car is flying over (`car.y - 0.4 > s.y + s.h`),
   * which is right, and a forecourt graded to a road 19 m away on a hillside is UNDERGROUND,
   * so every hitbox on it was correctly and invisibly discarded.
   *
   * So this measures the actual mechanism, on real stations, with the real Terrain: how far
   * the ground stands above the pad the station is drawn on, and how many of its seven
   * colliders collide.js would therefore throw away for a car sitting on that ground. Before
   * the fix (STATION_MAX_STEP in world/props.js + PAD_STEP in render/props.js), across three
   * seeds and 30 stations: worst burial 11.27 m, 24.3% of all hitboxes gated out, and at 12 of
   * the 30 stations 4-6 of the 7 were gone. After: 0.95 m and 0.0%. */
  /* ── 28 July: the pad height is NOT re-derived here any more ────────────────
   * This block used to carry its own copy of the bake's clamp (`pad = clamp(hi + 0.04,
   * s.y ± 1.2)`) with a comment saying there was deliberately no way to import it. That copy
   * outlived the thing it was copying, and worse, both copies were grading against `s.y` —
   * the host edge's own height off `land()`, a surface the car does not drive on (see
   * stationPad's header in src/world/props.js). The harness therefore agreed with the renderer
   * about a number that was wrong in both places, and reported 1.20 m where the drawn tarmac
   * was standing 16 m over the ground. It now calls the SAME stationPad() the bake calls, with
   * a real Terrain, which is the only way this check can catch the two disagreeing again. */
  let worstBury = 0;
  let gatedOut = 0;
  let hitboxes = 0;
  let worstDoor = 0;
  let worstRough = 0;
  let sits = 0;
  let tried = 0;
  for (const s of a.slice(0, 12)) {
    const terr = new Terrain(SEED, s.x - 40, s.z - 40, s.x + 40, s.z + 40, 40);
    const P = stationPad(s, (x, z) => terr.height(x, z));
    const pad = P.y;
    tried++;
    if (stationSits(s, (x, z) => terr.height(x, z))) sits++;
    else continue; // a station the tiler will not draw cannot be measured as if it were drawn
    worstDoor = Math.max(worstDoor, P.door);
    worstRough = Math.max(worstRough, P.rough);
    worstStep = Math.max(worstStep, Math.abs(pad - P.hRoad));
    worstGrade = Math.max(worstGrade, s.grade);

    // Every hitbox this station will register, against the ground actually under each one.
    for (const b of stationSolids([{ ...s, padY: pad }])) {
      hitboxes++;
      const g = terr.height(b.x, b.z);
      if (g - pad > worstBury) worstBury = g - pad;
      // A car resting on that ground: Vehicle.y sits ~0.45 m over its contact patch.
      if (g + 0.45 - 0.4 > b.y + b.h) gatedOut++;
    }

    /* The access spur's own ramp, measured the way buildAccessSpur (src/render/props.js)
     * actually computes it: the REAL road-carve height at the mouth (never s.y, which is only
     * the host edge's own solo canonical height and can legitimately differ near a junction —
     * see diag-stations.mjs's own note on this) against this same forecourt's padY. This is
     * the number that actually decides whether the drawn driveway is a gentle grade or a
     * cliff — the fall-through-class invariant this project has been bitten by once already,
     * now checked for the spur specifically, using the identical Terrain the renderer used. */
    if (!isFinite(P.hRoad)) worstSpurEndFinite = false;
    else worstSpurRamp = Math.max(worstSpurRamp, Math.abs(P.hRoad - pad));
  }
  /* The step from the real carriageway edge to the forecourt slab. It used to be held at
   * PAD_STEP (1.2 m) by a clamp; that clamp is gone, because it was measured against `land()`
   * and it is what buried forecourts. What replaces it is not a looser bound on the same
   * quantity, it is a DIFFERENT and stricter guarantee: the slab is graded to the ground at
   * the driveway's own arrival point (worstDoor below, capped at STATION_MAX_DOOR), and the
   * spur then follows the real ground from the road to that point instead of spanning it. So
   * this number is now free to be whatever the hillside is, and tools/diag-spur.mjs is the
   * check that matters — it measures the DRAWN surface against the DRIVEN one directly. */
  console.log(`       worst road-to-forecourt height difference ${worstStep.toFixed(2)} m (carried by the spur, which follows the ground)`);
  check(worstDoor <= STATION_MAX_DOOR + 1e-6, 'step where the driveway meets the slab (m)', worstDoor.toFixed(2), `<= ${STATION_MAX_DOOR} (STATION_MAX_DOOR)`);
  check(worstRough <= STATION_MAX_ROUGH + 1e-6, 'real ground spread under a forecourt slab (m)', worstRough.toFixed(2), `<= ${STATION_MAX_ROUGH} (STATION_MAX_ROUGH)`);
  check(sits > 0 && sits >= tried * 0.5, 'forecourts that survive the real-ground test', `${sits}/${tried}`, '> half');
  check(worstGrade <= STATION_MAX_GRADE, 'steepest road a station sits on', worstGrade.toFixed(3), `<= ${STATION_MAX_GRADE} (STATION_MAX_GRADE)`);
  console.log(`       ${hitboxes} station hitboxes over ${sits} drawn stations, worst ground-above-pad ${worstBury.toFixed(2)} m`);
  check(gatedOut === 0, 'station hitboxes buried out of reach of collide.js', gatedOut, `0 of ${hitboxes}`);
  /* The bound is now a hard property of stationPad rather than a residue of two other caps:
   * the slab is lifted until nothing under it stands more than PAD_BURY_MAX over it, and
   * PAD_BURY_MAX (1.5 m) is under the height of the shortest forecourt hitbox plus collide.js's
   * own 0.4 m of slack, so a buried-out-of-reach collider is impossible by construction. The
   * check above is the one that proves that end-to-end; this one localises a regression to the
   * grading if it ever fails. Before this round, measured the same way: 0.95 .. 1.79 m. */
  check(worstBury <= PAD_BURY_MAX + 1e-6, 'deepest a forecourt is buried in its own hillside (m)', worstBury.toFixed(2), `<= ${PAD_BURY_MAX} (PAD_BURY_MAX)`);
  {
    // ...and the placement's own promise, read off the record it wrote rather than re-derived.
    let worstPlaced = 0;
    for (const s of a) worstPlaced = Math.max(worstPlaced, s.step ?? 0);
    check(worstPlaced <= STATION_MAX_STEP + 1e-6, 'worst forecourt ground step at placement (m)',
      worstPlaced.toFixed(2), `<= ${STATION_MAX_STEP} (STATION_MAX_STEP)`);
  }
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

    /* ── and BRUSHING PAST at speed collects one, from the road ────────────────
     * Operator: "make them a little nearer, with a giant hitbox so you can tap them easily."
     * The two halves of that are placement (the reachability check further up) and this: a can
     * has to be collected by a car that never slows down and never leaves the tarmac. So this
     * takes another live can, works out the nearest point on its own road's centreline, offsets
     * to the OUTERMOST STREAK-LEGAL driving line (half the carriageway minus a wheel's
     * half-track — see the reachability check for why that is the exact limit), and sweeps the
     * car past on that line at 120 km/h in single frames, never closer to the can than a car
     * staying honestly on the road can get. If _updateCans had a speed gate, or CAN_RADIUS were
     * too small for where the can is placed, nothing would be collected here. */
    const [driveKey, driveCan] = [...props.cans.entries()].find(([, c]) => c) || [];
    if (driveCan) {
      const terr = new Terrain(SEED, driveCan.x - 60, driveCan.z - 60, driveCan.x + 60, driveCan.z + 60, 80);
      const cc = terr.roads.carve(driveCan.x, driveCan.z);
      // Back onto the centreline, then out to the legal limit on the can's own side.
      const WHEEL_HALF = 0.8;
      const nx = cc.tz;
      const nz = -cc.tx;
      const sign = Math.sign((driveCan.x - (driveCan.x - nx * cc.d)) * nx + (driveCan.z - (driveCan.z - nz * cc.d)) * nz) || 1;
      const lane = Math.max(0, cc.width * 0.5 - WHEEL_HALF);
      const lineX = driveCan.x - nx * sign * (cc.d - lane);
      const lineZ = driveCan.z - nz * sign * (cc.d - lane);
      const gap = Math.hypot(lineX - driveCan.x, lineZ - driveCan.z);
      const V = 120 / 3.6; // m/s — faster than anything in the fleet cruises at
      const STEP = V / 60; // one frame of travel
      props.drainCollectedFuel();
      for (let i = -40; i <= 40; i++) props.update(1 / 60, lineX + cc.tx * i * STEP, lineZ + cc.tz * i * STEP);
      const drive = props.drainCollectedFuel();
      console.log(`       swept past ${driveKey} at 120 km/h on the outermost legal line, ${gap.toFixed(2)} m away (road ${cc.width.toFixed(1)} m wide)`);
      check(gap < CAN_RADIUS, 'that pass never left the tarmac and still came inside CAN_RADIUS', gap.toFixed(2), `< ${CAN_RADIUS}`);
      check(drive >= CAN_FRACTION - 1e-9, 'brushing past at speed collects the can', drive.toFixed(3), `>= ${CAN_FRACTION.toFixed(3)}`);
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

  /* Stations sit a couple of km apart and the tile window only reaches ~1.2 km, so — rather
   * than hope one falls within range of the origin on every seed — find real ones first
   * (stationsInBox is pure and cheap) and drive the window to each in turn, guaranteeing the
   * tile actually gets built and baked.
   *
   * SEVERAL candidates, not the nearest one: the run below drives on the REAL heightfield
   * through the REAL world, so the approach line to any given forecourt may have a tree on it
   * or a bank the car bogs down on. That is a fact about that hillside, not about the hitbox,
   * and on seed 424242 it is exactly what happens — the car stalls 25 m short having hit
   * nothing. So the harness takes the first station whose approach the car can actually
   * complete, and says which. It only fails if NONE of them will let a car reach a forecourt,
   * which is the thing this check is for. */
  /* WHERE THE RUN STARTS: the mouth of the station's own access spur, i.e. the edge of the
   * carriageway a real driver pulls off. Not a point out in the field — an earlier version
   * started 34 m out along the forecourt's own axis, which on some seeds is 10 m the far side
   * of the road in a marsh, and a touring car on a 'cruise' preset simply bogs down in it and
   * never arrives. Off the road, across the apron, into the building: the player's own path.
   *
   * ARRIVING AT SPEED, not accelerating from rest: the car is launched at 12 m/s (43 km/h) with
   * the throttle then held down, because the question is what a moving car does when it meets a
   * building, and how quickly a stationary one can get going on a given patch of ground is a
   * question about that ground. */
  const APPROACH_V = 12;
  const approachFrom = (s) => {
    const sp = stationSpur(s);
    return [sp.mouthX, sp.mouthZ];
  };
  const launch = (c, x, z, tx, tz) => {
    const heading = Math.atan2(tx - x, tz - z);
    c.placeAt(x, z, heading);
    c.speed = APPROACH_V;
    c.vx = Math.sin(heading) * APPROACH_V;
    c.vz = Math.cos(heading) * APPROACH_V;
  };

  const near = stationsInBox(-9000, -9000, 9000, 9000, SEED)
    .map((s) => ({ s, d: Math.hypot(s.x, s.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
  check(near.length > 0, 'real stations exist to test collision against', near.length ? `${(near[0].d / 1000).toFixed(2)} km from the origin` : 'none', 'at least one');

  {
    /* Find one that is baked AND reachable. `reach()` is the same run as the graded checks
     * below, cut short — it only asks whether the car gets to a forecourt structure at all. */
    let st = null;
    let attempts = 0;
    for (const cand of near) {
      let live = null;
      for (let i = 0; i < 4000 && !live; i++) {
        props.update(1 / 60, cand.s.x, cand.s.z);
        live = props.stations.find((q) => q.key === cand.s.key) || null;
      }
      if (!live) continue;
      attempts++;
      const c2 = Math.cos(live.yaw), s2 = Math.sin(live.yaw);
      const kz0 = -(STATION_APRON_HALF_DEPTH - 2.2);
      const kX = live.x + 0 * c2 - kz0 * s2;
      const kZ = live.z + 0 * s2 + kz0 * c2;
      const [sX, sZ] = approachFrom(live);
      const TT = new Terrain(SEED, live.x - 120, live.z - 120, live.x + 120, live.z + 120, 120);
      const probe = new Vehicle({ tier: 'touring', terrain: TT, preset: 'cruise' });
      launch(probe, sX, sZ, kX, kZ);
      const scratch = new Solids();
      for (const [k, l] of solids.byChunk) scratch.addChunk(k, l);
      let ok = false;
      for (let k = 0; k < 60 * 14 && !ok; k++) {
        let e = Math.atan2(kX - probe.x, kZ - probe.z) - probe.yaw;
        while (e > Math.PI) e -= Math.PI * 2;
        while (e < -Math.PI) e += Math.PI * 2;
        probe.update(1 / 60, { steer: clamp(e * 3, -1, 1), throttle: 1, brake: 0, handbrake: 0, analogue: true });
        const h = scratch.resolve(probe, 1.05, 1 / 60);
        if (h && h.kind === 'station') ok = true;
      }
      if (ok) {
        st = live;
        break;
      }
    }
    check(!!st, 'a station whose forecourt a car can actually drive into', st ? `${st.key} at ${st.x.toFixed(0)},${st.z.toFixed(0)} (tried ${attempts})` : `none of ${attempts}`, 'one');

    if (st) {
      /* THE REAL HEIGHTFIELD, not a flat stub at the pad. That substitution is exactly what
       * hid this bug for two rounds: on a stub at padY the car and the collider trivially agree
       * about where the ground is, so the height gate collide.js applies (`car.y - 0.4 >
       * s.y + s.h`) can never fire and a station buried three metres into a hillside tests
       * green. The car now drives on the same Terrain the world builds, so if the forecourt is
       * underground this check says so. */
      const ca = Math.cos(st.yaw), sa = Math.sin(st.yaw);
      const T = new Terrain(SEED, st.x - 120, st.z - 120, st.x + 120, st.z + 120, 120);
      const CAR_R = 1.05;
      const L2W = (dx, dz) => [st.x + dx * ca - dz * sa, st.z + dx * sa + dz * ca];

      // The kiosk hut — STATION_HITBOXES' own local (0, -(AD-2.2)) entry in render/props.js.
      const kioskDZ = -(STATION_APRON_HALF_DEPTH - 2.2);
      const [kioskX, kioskZ] = L2W(0, kioskDZ);
      // Every forecourt collider this station registered, so "did the car get inside a
      // building" is asked of the thing it actually reached first (the pump island stands
      // between the road and the kiosk) rather than only of the kiosk it was aimed at.
      const stationSolidsHere = [];
      const apronSolidsHere = [];
      for (const list of solids.byChunk.values()) {
        for (const s of list) {
          if (s.kind !== 'station' || Math.hypot(s.x - st.x, s.z - st.z) > 30) continue;
          (s.apron ? apronSolidsHere : stationSolidsHere).push(s);
        }
      }
      check(stationSolidsHere.length === 7, 'forecourt colliders registered with the resolver', stationSolidsHere.length, '7 (STATION_HITBOXES)');
      /* A REAL approach: in off the road at the spur mouth (see approachFrom/launch above),
       * full throttle held, steering held on the kiosk — on real ground a car at zero steer
       * wanders down the fall of the hill and misses, which is a fact about the hill and not
       * about the hitbox. The old version of this check gave the car 14 m and half throttle on
       * a FLAT STUB, which is a manoeuvre, not a collision. */
      const [startX, startZ] = approachFrom(st);
      const car = new Vehicle({ tier: 'touring', terrain: T, preset: 'cruise' });
      launch(car, startX, startZ, kioskX, kioskZ);
      const runUp = Math.hypot(startX - kioskX, startZ - kioskZ);
      solids._px = null;

      const DT = 1 / 60;
      let speedIn = 0;
      let speedOut = null;
      let hitKind = null;
      let stopped = false;
      /* Worst overlap with ANY forecourt structure at any point in the run, in metres —
       * positive means the car's own body was inside a building. This is the "penetration
       * before/after" number: with the colliders height-gated away it is the full depth of the
       * kiosk, because the car simply drives through it. */
      let worstPen = -Infinity;
      const penNow = () => {
        let p = -Infinity;
        for (const s of stationSolidsHere) {
          if (s.h && car.y - 0.4 > s.y + s.h) continue; // collide.js's own gate: not hittable
          p = Math.max(p, s.r + CAR_R - Math.hypot(car.x - s.x, car.z - s.z));
        }
        return p;
      };
      for (let k = 0; k < 60 * 14; k++) {
        let e = Math.atan2(kioskX - car.x, kioskZ - car.z) - car.yaw;
        while (e > Math.PI) e -= Math.PI * 2;
        while (e < -Math.PI) e += Math.PI * 2;
        const pre = Math.hypot(car.vx, car.vz);
        car.update(DT, { steer: clamp(e * 3, -1, 1), throttle: 1, brake: 0, handbrake: 0, analogue: true });
        const h = solids.resolve(car, CAR_R, DT);
        worstPen = Math.max(worstPen, penNow());
        if (h && speedOut === null) {
          speedIn = pre;
          speedOut = Math.hypot(car.vx, car.vz);
          hitKind = h.kind;
        }
        if (speedOut !== null && Math.hypot(car.vx, car.vz) < 0.5) {
          stopped = true;
          break;
        }
      }
      console.log(
        `       drove in off the road at the spur mouth, ${runUp.toFixed(1)} m from the kiosk, real ground, full throttle: hit a '${hitKind}' at ` +
          `${(speedIn * 3.6).toFixed(1)} km/h -> ${((speedOut ?? 0) * 3.6).toFixed(2)} km/h, ` +
          `deepest overlap with any forecourt structure ${worstPen.toFixed(3)} m`,
      );
      check(hitKind === 'station', 'the forecourt structures are registered AND reachable', hitKind ?? 'nothing', "'station'");
      check(speedOut !== null && speedOut < 0.6, 'a full-speed arrival is a DEAD STOP, not a slide-off', speedOut === null ? 'never hit' : `${(speedOut * 3.6).toFixed(2)} km/h`, '< 2.2 km/h');
      check(stopped, 'and the car stays stopped rather than pushing on through', stopped, 'true');
      check(worstPen <= 0.05, 'deepest the car ever got inside a forecourt structure (m)', worstPen.toFixed(3), '<= 0.05 (no overlap)');

      // And the open apron itself must NOT be a wall — driving onto the forecourt (well clear
      // of the kiosk/pump/post hitboxes) must not stop the car, or nobody could ever refuel.
      const car2 = new Vehicle({ tier: 'touring', terrain: T, preset: 'cruise' });
      const [apronX, apronZ] = L2W(0, 3.5); // inside the forecourt, clear of every hitbox
      car2.placeAt(apronX, apronZ, 0);
      car2.speed = 0;
      for (let k = 0; k < 60 * 2; k++) {
        car2.update(DT, { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true });
        solids.resolve(car2, CAR_R, DT);
      }
      const drift = Math.hypot(car2.x - apronX, car2.z - apronZ);
      check(drift < 0.6, 'the open apron itself is drivable — a stationary car there is not pushed out by an invisible wall', drift.toFixed(3), '< 0.6 m');

      /* ── and the hitboxes are where the BUILDINGS are ──────────────────────
       * The drive above proves the collider stops the car. It cannot prove the collider is on
       * the kiosk rather than three metres beside it, because it aims at the collider's own
       * coordinates — the same circularity diag-collide.mjs calls out for trees. So: rebuild
       * the station geometry the renderer actually bakes, slice it at the heights a bumper
       * sweeps through, and check every bit of drawn structure at that height is inside some
       * hitbox. Furniture with no collider on purpose (the bench, the air line — you brush past
       * those) is excluded by name, exactly as `scrub` is excluded from TRUNK_R. */
      const M = PB();
      buildStation(M, rng(hash3i(1, 2, 3, 4)), 0.4);
      const boxes = stationSolids([{ x: 0, z: 0, y: 0, yaw: 0, padY: 0 }]);
      const FURNITURE = [
        { x: -STATION_APRON_HALF_WIDTH + 2.0, z: -STATION_APRON_HALF_DEPTH + 2.6, r: 1.6 }, // the bench
        { x: -STATION_APRON_HALF_WIDTH + 1.2, z: 1.2, r: 0.6 },                             // the air line
      ];
      let worstOutside = 0;
      let outsideCount = 0;
      let sliced = 0;
      for (const Y of [0.35, 0.6, 0.85, 1.1, 1.35]) {
        for (let k = 0; k < M.idx.length; k += 3) {
          const tri = [M.idx[k], M.idx[k + 1], M.idx[k + 2]];
          for (let e = 0; e < 3; e++) {
            const a2 = tri[e];
            const b2 = tri[(e + 1) % 3];
            const ya = M.pos[a2 * 3 + 1];
            const yb = M.pos[b2 * 3 + 1];
            if ((ya - Y) * (yb - Y) > 0 || ya === yb) continue;
            const f = (Y - ya) / (yb - ya);
            const px = M.pos[a2 * 3] + (M.pos[b2 * 3] - M.pos[a2 * 3]) * f;
            const pz = M.pos[a2 * 3 + 2] + (M.pos[b2 * 3 + 2] - M.pos[a2 * 3 + 2]) * f;
            if (FURNITURE.some((q) => Math.hypot(px - q.x, pz - q.z) <= q.r)) continue;
            sliced++;
            let outside = Infinity;
            for (const b of boxes) {
              if (Y > b.h) continue;
              outside = Math.min(outside, Math.hypot(px - b.x, pz - b.z) - b.r);
            }
            if (outside > 0.001) {
              outsideCount++;
              if (outside > worstOutside) worstOutside = outside;
            }
          }
        }
      }
      console.log(`       ${sliced} slices of drawn structure at bumper height, ${outsideCount} of them outside a hitbox`);
      check(worstOutside <= 0.25, 'drawn structure sticking out past its hitbox (m)', worstOutside.toFixed(3), '<= 0.25 (the pump hose nozzles, which are rubber)');
    }
  }
  props.dispose();
}

/* ── the showroom line-up matches the fleet it claims to sell ─────────────── */
console.log('\n── a dealership stocks the cars you cannot collect ────────────────────────');
{
  const { FLEET, unlockRule } = await import('../src/game/garage.js');
  const { SHOWROOM_SLOTS, showroomSpots } = await import('../src/world/props.js');
  const shouldStock = FLEET.filter((c) => unlockRule(c).how === 'buy').map((c) => c.id);

  /* THE ONE THING THAT CAN DRIFT SILENTLY. render/props.js hard-codes its four display cars
   * because it is loaded by the tile worker and must not pull the game's modules in behind it,
   * while main.js derives the same four from `unlockRule`. If those lists ever disagree, the
   * plaque you read and the car you buy are different cars — and nothing else would notice. */
  check(
    SHOWROOM_CARS.map((c) => c.id).join(',') === shouldStock.join(','),
    'the drawn line-up IS the dealership fleet, in order',
    SHOWROOM_CARS.map((c) => c.id).join(','),
    shouldStock.join(',')
  );
  check(
    SHOWROOM_SLOTS.length >= SHOWROOM_CARS.length,
    'there is a slot for every car on show',
    SHOWROOM_SLOTS.length,
    `>= ${SHOWROOM_CARS.length}`
  );
  for (const c of SHOWROOM_CARS) {
    const spec = FLEET.find((f) => f.id === c.id);
    check(spec && Math.abs(spec.length - c.length) < 0.01, `${c.id} is drawn at its real length`, c.length, spec ? spec.length : 'missing');
  }

  /* Every slot must be inside the apron and clear of the canopy posts, the pump island and the
   * kiosk, or a display car is standing in the wall. These are STATION_HITBOXES' own numbers —
   * the kiosk's dz is PARAMETRIC on STATION_APRON_HALF_DEPTH there (`-(AD - 2.2)`), not a fixed
   * -4.8, and this table hard-coded the AD=7.0 answer rather than the formula. That was the
   * "one thing that can drift silently" the comment above already worried about, just not the
   * copy it was watching: AD moved to 9.0 (see that constant's own comment in world/props.js —
   * the entrance/showroom-row conflict this file's own dealership-drive measurements found) and
   * this table kept reporting the kiosk 2 m from where render/props.js actually draws it. */
  const FIXED = [
    { dx: 0, dz: -(STATION_APRON_HALF_DEPTH - 2.2), r: 2.8 },
    { dx: 0, dz: 1.0, r: 1.55 },
    { dx: -5.2, dz: -2.4, r: 0.22 },
    { dx: 5.2, dz: -2.4, r: 0.22 },
    { dx: -5.2, dz: 4.4, r: 0.22 },
    { dx: 5.2, dz: 4.4, r: 0.22 },
  ];
  let worstClear = Infinity;
  let worstSide = Infinity;
  let worstNose = 0;
  SHOWROOM_SLOTS.forEach((s, i) => {
    for (const f of FIXED) worstClear = Math.min(worstClear, Math.hypot(s.dx - f.dx, s.dz - f.dz) - f.r - 1.35);
    /* THE CAR'S OWN FOOTPRINT, not the slot centre. A 5.91 m truck and a 4.5 m saloon overhang the
     * apron by very different amounts, and checking the centre would have called both fine. The row's
     * WIDTH must stay on the tarmac; the nose is allowed onto the grass, and the figure is logged so
     * it can never grow quietly. */
    const len = SHOWROOM_CARS[i] ? SHOWROOM_CARS[i].length : 4.5;
    worstSide = Math.min(worstSide, STATION_APRON_HALF_WIDTH - (Math.abs(s.dx) + 0.9));
    worstNose = Math.max(worstNose, Math.abs(s.dz) + len / 2 - STATION_APRON_HALF_DEPTH);
  });
  check(worstClear > 0, 'no display car overlaps a post, pump or kiosk', `${worstClear.toFixed(2)} m`, '> 0');
  check(worstSide > 0, 'the row stays on the tarmac across its width', `${worstSide.toFixed(2)} m`, '> 0');
  console.log(`       the longest display car noses ${worstNose.toFixed(2)} m past the apron's front edge, onto grass (by design)`);

  /* THE ROW MUST NOT STAND IN THE ONE DOORWAY A DEALERSHIP HAS. Measured (this file, driving a
   * real Vehicle in from a real approach — see "a real station hitbox actually stops the car"
   * above and tools/diag-spur-drive.mjs) at the OLD STATION_APRON_HALF_DEPTH (7.0): every one of
   * 22 sampled dealerships had the access spur's own arrival point inside a display car's
   * collision radius plus a car's own (2.4 m combined) — the row was placed to clear the canopy
   * posts alone, back when the spur's real doorway edge was not correctly known (the `yaw` fix
   * a few lines up in world/props.js). The row is fixed in the station's local frame and the
   * spur's arrival point is a pure function of the same frame (`stationSpur`), so this is
   * checked geometrically, once, for every seed and every road heading, rather than by sampling
   * — the two are either always clear or the placement is wrong for every dealership. */
  {
    const CAR_R = 1.05;
    const st2 = { x: 0, z: 0, yaw: 0.6109, nx: -Math.sin(0.6109), nz: -Math.cos(0.6109), width: 6.0, deal: true };
    const sp2 = stationSpur(st2);
    const ca2 = Math.cos(st2.yaw), sa2 = Math.sin(st2.yaw);
    // The spur's own arrival point, in the station's local frame — same inverse rotation
    // probe-station-frame.mjs uses.
    const wx = sp2.apronX - st2.x, wz = sp2.apronZ - st2.z;
    const doorLx = wx * ca2 + wz * sa2, doorLz = -wx * sa2 + wz * ca2;
    let worstDoorClear = Infinity;
    SHOWROOM_SLOTS.forEach((s) => {
      worstDoorClear = Math.min(worstDoorClear, Math.hypot(s.dx - doorLx, s.dz - doorLz) - 1.35 - CAR_R);
    });
    check(worstDoorClear > 0, 'the showroom row leaves the access spur\'s own doorway clear', `${worstDoorClear.toFixed(2)} m`, '> 0');
  }

  // The world-space mapping must be a rigid motion: spacing on the apron survives the rotation.
  const st = { x: 1234, z: -567, yaw: 0.937, deal: true };
  const spots = showroomSpots(st);
  const d01 = Math.hypot(spots[0].x - spots[1].x, spots[0].z - spots[1].z);
  const l01 = Math.hypot(SHOWROOM_SLOTS[0].dx - SHOWROOM_SLOTS[1].dx, SHOWROOM_SLOTS[0].dz - SHOWROOM_SLOTS[1].dz);
  check(Math.abs(d01 - l01) < 1e-6, 'placing the row in the world does not stretch it', d01.toFixed(4), l01.toFixed(4));
  check(showroomSpots({ x: 0, z: 0, yaw: 0 }).length === 0, 'a plain petrol station has no line-up', showroomSpots({ x: 0, z: 0, yaw: 0 }).length, '0');
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all props checks passed'}\n`);
process.exit(failures ? 1 : 0);
