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
import { PROP_KINDS, PROP_IDS, PROP_BY_ID, propsInBox, stationsInBox, stationSpacing } from '../src/world/props.js';
import { Props, missingGeometry, measureAll } from '../src/render/props.js';
import { Terrain } from '../src/world/terrain.js';
import { waterLevelAt, BIOME_COUNT, BIOME_NAMES } from '../src/world/biomes.js';
import { edgesInBox } from '../src/world/roads.js';

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
  const N = 8; // 8 x 8 contiguous 512 m tiles
  let props = [];
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
  check(perKm > 0.4 && perKm < 3.2, 'props per km of road', perKm.toFixed(2), '0.4 .. 3.2 (a find every 300-2500 m)');
  console.log(`       one find every ${(1000 / perKm).toFixed(0)} m of road — ${((1000 / perKm) / 26.4).toFixed(0)} s apart at a 95 km/h cruise`);
  check(props.length > 40, 'sample size', props.length, '> 40');

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
  }
  check(worstStep <= 0.71, 'worst step from road to forecourt (m)', worstStep.toFixed(2), '<= 0.7');
  check(worstGrade <= 0.06, 'steepest road a station sits on', worstGrade.toFixed(3), '<= 0.06');
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
  check(meshes <= 25, 'added draw calls (one per non-empty tile)', meshes, '<= 25');
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
    check(props.group.children.length === counted, 'meshes actually attached to the scene graph', `${props.group.children.length} vs ${counted}`, 'equal');
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
  {
    const far = props.nearestStation(1500, 0);
    check(!!far, 'nearestStation still answers away from a live tile', far ? `${(far.dist / 1000).toFixed(2)} km` : 'null', 'a station');
  }
  props.dispose();
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all props checks passed'}\n`);
process.exit(failures ? 1 : 0);
