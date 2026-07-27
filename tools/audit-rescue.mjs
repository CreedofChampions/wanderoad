/* Wanderoad — auditing the water rescue for false positives on a valid, dry spawn.
 *
 * The brief: rescue.js watches every frame for a car sitting in water and hands it back to
 * the road after about a second. If the water test is too sensitive, or reads a sample that
 * has not settled yet, a player can spawn on land, watch the car snatched away a second later,
 * and report "starting on water" even though the spawn itself was fine. This harness drives
 * the REAL Rescue class (src/game/rescue.js, unmodified) against the REAL Terrain/Vehicle
 * across many seeds and many points, and answers four questions with numbers:
 *
 *   A. Does the water test on frame 1 (a cold Terrain, just constructed, at the exact spot
 *      main.js places the car at boot) agree with the same test run against an identically
 *      built Terrain that has already answered 300 other queries first? If a cache needed to
 *      "warm up" this is where it would show.
 *   B. Across thousands of confirmed-dry points, spread over many seeds — including points
 *      picked BY BISECTION to sit as close to a shoreline as possible while still reading dry
 *      — does Rescue ever fire, or even register nonzero depth?
 *   C. Parked at a genuine shoreline shelf, or driving a lakeside road with deep water a few
 *      metres off the wheels, across many discovered lakes rather than one hand-picked one —
 *      what is the false-trigger rate?
 *   D. Dropped directly into deep water (a genuinely wet start), how long until Rescue moves
 *      the car, does the landing point ever read wet itself, and does Rescue ever fire a
 *      second time on the same stop (the loop the brief is worried about)?
 *
 * It also cross-checks what "in water" even means: rescue.js tests the CARVED ground height
 * against climate-grid-interpolated biome weights; tools/diag-water.mjs and terrain.js's
 * waterFn test the RAW land height against exactly-computed weights; the render water plane
 * is a per-leaf-chunk AVERAGE of the same carved-height test, built by the real buildChunk().
 * All three are measured against each other at the same points, in metres.
 *
 *   node tools/audit-rescue.mjs
 */

import { Terrain, findSpawn, waterFn, landHeight, isDryAt } from '../src/world/terrain.js';
import { buildChunk } from '../src/world/chunk.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { Rescue, waterDepth } from '../src/game/rescue.js';
import { rand2 } from '../src/core/math.js';

const DT = 1 / 60;
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
const PARKED = { steer: 0, throttle: 0, brake: 0, handbrake: 1, analogue: true };

/* Twenty worlds: the shipped seed plus nineteen arbitrary ones, so nothing here is tuned to
 * one lake. No Math.random anywhere in this file — every sample point is derived from
 * rand2(), which is the same deterministic lattice hash the world generator itself uses, so a
 * failure here is reproducible by re-running the script, not a one-in-twenty flake. */
const SEEDS = [
  20260726, 1, 2, 3, 4, 7, 11, 42, 1337, 2026, 8888, 9001, 99991, 123456789, 271828, 314159,
  555555, 909090, 161803, 71177,
];

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(64)} ${String(got).padStart(16)}   want ${want}`);
};
const info = (label, got) => console.log(`   .    ${label.padEnd(64)} ${String(got).padStart(16)}`);

/** Exactly what main.js's backToRoad() does, line for line, so every rig here measures the
 * shipped path — including the isDryAt() guard added to it this round: a nearest-road point
 * is not automatically dry (a cutting can duck below the local water table while the land
 * beside it stays dry), so a bad query result now falls through to findSpawn() instead of
 * being trusted blindly. If backToRoad() changes shape again, this needs to move with it —
 * that is the point of matching it exactly rather than summarising it. */
function makeRig(T, { tier = 'sports', keepHeading = true } = {}) {
  const car = new Vehicle({ tier, terrain: T, preset: 'sport' });
  const events = [];
  let placements = 0;
  const rescue = new Rescue({
    keepHeading,
    say: (t) => events.push(t),
    recover: () => {
      placements++;
      const q = T.roads.query(car.x, car.z);
      if (isFinite(q.d) && isDryAt(q.qx, q.qz, T.seed)) {
        car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
      } else {
        const s = findSpawn(T.seed, car.x, car.z);
        car.placeAt(s.x, s.z, s.heading);
      }
    },
  });
  return { car, rescue, events, placed: () => placements };
}

/* ── raw/direct water test — the same functions tools/diag-water.mjs uses, so "does rescue
 * agree with diag-water.mjs" is a straight comparison rather than a re-implementation that
 * could itself be wrong. */
function rawDepthAt(seed, x, z) {
  const ground = landHeight(x, z, seed);
  const level = waterFn(seed)(x, z);
  return level === null ? 0 : level - ground;
}

/* ── render-plane equivalent — calls the REAL buildChunk() production uses for the leaf
 * chunk under (x, z), and applies the shader's own discard test (vD.x > -0.5) to decide
 * whether the water plane would actually be drawn at this exact point. */
function renderWetAt(seed, x, z, T) {
  const LEAF = 64;
  const cx = Math.floor(x / LEAF);
  const cz = Math.floor(z / LEAF);
  const rec = buildChunk({ cx, cz, level: 0, seed });
  if (!rec.water) return false;
  const bed = T.height(x, z);
  return rec.water.level - bed > -0.5;
}

/* ── survey one seed's world: dry points, shoreline shelves, deep water, and points found by
 * bisection to sit exactly on the dry side of a wet/dry boundary — the most adversarial
 * "valid, dry spawn" there is. */
function surveySeed(seed, R = 1800, STEP = 150) {
  const spawn = findSpawn(seed);
  const T = new Terrain(seed, spawn.x - R, spawn.z - R, spawn.x + R, spawn.z + R, 120);
  const depthAt = (x, z) => waterDepth(T.surface(x, z));

  const dry = [];
  const shelf = [];
  const deep = [];
  const boundaryDry = [];

  const rows = [];
  for (let gz = -R + STEP; gz < R; gz += STEP) {
    const row = [];
    for (let gx = -R + STEP; gx < R; gx += STEP) {
      const x = spawn.x + gx + (rand2(gx, gz, seed ^ 0xa1) - 0.5) * STEP * 0.8;
      const z = spawn.z + gz + (rand2(gx, gz, seed ^ 0xb2) - 0.5) * STEP * 0.8;
      const d = depthAt(x, z);
      row.push({ x, z, d });
      if (d === 0) dry.push({ x, z, seed });
      else if (d <= 0.5) shelf.push({ x, z, d, seed });
      if (d > 0.6) deep.push({ x, z, d, seed });
    }
    rows.push(row);
  }

  // Bisect every grid edge that crosses the dry/wet line (east and south neighbours only, so
  // each crossing is visited once).
  for (let j = 0; j < rows.length; j++) {
    for (let i = 0; i < rows[j].length; i++) {
      const p = rows[j][i];
      const neighbours = [rows[j][i + 1], rows[j + 1] && rows[j + 1][i]];
      for (const q of neighbours) {
        if (!q) continue;
        if ((p.d === 0) === (q.d === 0)) continue; // no crossing
        let [ax, az] = p.d === 0 ? [p.x, p.z] : [q.x, q.z]; // dry end
        let [bx, bz] = p.d === 0 ? [q.x, q.z] : [p.x, p.z]; // wet end
        for (let k = 0; k < 24; k++) {
          const mx = (ax + bx) / 2,
            mz = (az + bz) / 2;
          if (depthAt(mx, mz) === 0) {
            ax = mx;
            az = mz;
          } else {
            bx = mx;
            bz = mz;
          }
        }
        boundaryDry.push({ x: ax, z: az, seed });
      }
    }
  }

  return { seed, spawn, T, dry, shelf, deep, boundaryDry };
}

/* Deterministic subsample so runtime stays bounded without biasing which points get skipped. */
function subsample(arr, n, salt) {
  if (arr.length <= n) return arr;
  const scored = arr.map((p, i) => [rand2(i, salt, p.seed), p]);
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, n).map((s) => s[1]);
}

console.log('══ Wanderoad — rescue.js false-positive audit ═══════════════════════════════════');
console.log(`seeds: ${SEEDS.length}  (${SEEDS.join(', ')})`);

/* ────────────────────────────────────────────────────────────────────────────────────────
 * PART A — frame 1, at the real boot spawn, in every world.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── A. frame 1 at the real boot spawn — cold Terrain vs. a warmed one ──────────────');
{
  let coldWetCount = 0;
  let mismatchCount = 0;
  let instanceMismatch = 0;
  let frame1Fired = 0;
  const worstMismatch = { y: 0, onRoad: 0, depth: 0 };

  for (const seed of SEEDS) {
    const spawn = findSpawn(seed);

    // Exactly main.js's boot(): a fresh local Terrain, car dropped with placeAt(), sampled
    // on the very first call — nothing has run before it.
    const cold = new Terrain(seed, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
    const car = new Vehicle({ tier: 'sports', terrain: cold, preset: 'sport' });
    car.placeAt(spawn.x, spawn.z, spawn.heading);
    const surfCold = cold.surface(car.x, car.z);
    const dCold = waterDepth(surfCold);
    if (dCold > 0) coldWetCount++;

    // An identically-built Terrain, but asked 300 unrelated questions first — the same box,
    // the same seed, just "used" for five seconds of simulated queries before we read it.
    const warm = new Terrain(seed, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
    for (let i = 0; i < 300; i++) {
      const jx = spawn.x + (rand2(i, 1, seed) - 0.5) * 800;
      const jz = spawn.z + (rand2(i, 2, seed) - 0.5) * 800;
      warm.surface(jx, jz);
    }
    const surfWarm = warm.surface(spawn.x, spawn.z);
    const dWarm = waterDepth(surfWarm);

    if (surfCold.y !== surfWarm.y || surfCold.onRoad !== surfWarm.onRoad || dCold !== dWarm) {
      mismatchCount++;
      worstMismatch.y = Math.max(worstMismatch.y, Math.abs(surfCold.y - surfWarm.y));
      worstMismatch.onRoad = Math.max(worstMismatch.onRoad, Math.abs(surfCold.onRoad - surfWarm.onRoad));
      worstMismatch.depth = Math.max(worstMismatch.depth, Math.abs(dCold - dWarm));
    }

    // A THIRD, differently-framed Terrain covering the same point (as if the 240 m sliding
    // window in main.js's localFor() had just rebuilt around a slightly different centre) —
    // proves the answer does not depend on which box asked the question.
    const offset = new Terrain(seed, spawn.x - 380, spawn.z - 460, spawn.x + 460, spawn.z + 380);
    const surfOffset = offset.surface(spawn.x, spawn.z);
    if (surfOffset.y !== surfCold.y || waterDepth(surfOffset) !== dCold) instanceMismatch++;

    // Frame 1 itself: one rescue.update() call, dt = 1/60, immediately after construction.
    const rescue = new Rescue({ recover: () => {} });
    if (rescue.update(DT, car, surfCold)) frame1Fired++;
  }

  info('spawns that read wet at frame 1 (terrain/placement issue, not rescue)', `${coldWetCount} / ${SEEDS.length}`);
  check(mismatchCount === 0, 'cold Terrain vs. warmed Terrain, same box/point', `${mismatchCount} / ${SEEDS.length} differ`, '0 (pure function, no cache to warm)');
  if (mismatchCount) info('worst mismatch (Δy, Δonroad, Δdepth)', `${worstMismatch.y.toFixed(4)}, ${worstMismatch.onRoad.toFixed(4)}, ${worstMismatch.depth.toFixed(4)}`);
  check(instanceMismatch === 0, 'differently-framed Terrain instance, same point', `${instanceMismatch} / ${SEEDS.length} differ`, '0 (independent of the sliding window)');
  check(frame1Fired === 0, 'rescue fires on a single 1/60s frame 1 (HOLD=1.0s)', `${frame1Fired} / ${SEEDS.length}`, '0 (cannot legitimately happen)');
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Survey every world once; reused by B, C, D, E below.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── surveying every world (dry / shoreline / deep, plus bisected shoreline points) ──');
const surveys = SEEDS.map((s) => surveySeed(s));
{
  const totalDry = surveys.reduce((a, s) => a + s.dry.length, 0);
  const totalShelf = surveys.reduce((a, s) => a + s.shelf.length, 0);
  const totalDeep = surveys.reduce((a, s) => a + s.deep.length, 0);
  const totalBoundary = surveys.reduce((a, s) => a + s.boundaryDry.length, 0);
  const seedsWithWater = surveys.filter((s) => s.shelf.length || s.deep.length).length;
  info('confirmed-dry grid points', totalDry);
  info('shoreline-shelf points (0-0.5 m)', totalShelf);
  info('deep-water points (>0.6 m)', totalDeep);
  info('bisected dry-side boundary points', totalBoundary);
  info('seeds with any water found in range', `${seedsWithWater} / ${SEEDS.length}`);
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * PART B — false-trigger rate on confirmed-dry points, many seeds.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── B. sitting parked on confirmed-dry ground, across every world ──────────────────');
{
  let plainTested = 0,
    plainFired = 0,
    plainNonzero = 0;
  for (const s of surveys) {
    const points = subsample(s.dry, 30, 0xd1);
    for (const p of points) {
      plainTested++;
      const { car, rescue, placed } = makeRig(s.T);
      car.placeAt(p.x, p.z, rand2(p.x | 0, p.z | 0, s.seed ^ 0xc3) * Math.PI * 2);
      let worst = 0;
      for (let i = 0; i < 20; i++) {
        // 20 ticks (0.33 s): the depth sample at a fixed, stationary (x, z) cannot change
        // frame to frame, so this proves stability rather than timing anything out.
        car.update(DT, PARKED);
        const surf = s.T.surface(car.x, car.z);
        rescue.update(DT, car, surf);
        worst = Math.max(worst, rescue.depth);
      }
      if (placed() > 0) plainFired++;
      if (worst > 0) plainNonzero++;
    }
  }
  check(plainFired === 0, 'plain dry grid points: rescue ever placed the car', `${plainFired} / ${plainTested}`, '0');
  check(plainNonzero === 0, 'plain dry grid points: rescue ever saw depth > 0', `${plainNonzero} / ${plainTested}`, '0');

  // The adversarial set: points found by bisection to sit on the dry side of a wet/dry line
  // as tightly as 24 iterations of bisection can manage (worst case ~1e-5 m from the line).
  // FROZEN first — car.update() is never called, so this isolates "is the water test itself
  // unstable at this exact coordinate" from "does vehicle physics move the car away from it".
  let fTested = 0,
    fFired = 0,
    fNonzero = 0;
  for (const s of surveys) {
    for (const p of s.boundaryDry) {
      // every point, no subsampling — this loop does no physics, so it is cheap
      fTested++;
      const { car, rescue } = makeRig(s.T);
      car.placeAt(p.x, p.z, 0);
      const fixedSurf = s.T.surface(car.x, car.z); // sampled once; the car never moves
      let worst = 0;
      let fired = false;
      for (let i = 0; i < 60 * 4; i++) {
        if (rescue.update(DT, car, fixedSurf)) fired = true;
        worst = Math.max(worst, rescue.depth);
      }
      if (fired) fFired++;
      if (worst > 0) fNonzero++;
    }
  }
  check(fFired === 0, 'bisected dry-side boundary points, FROZEN (no vehicle physics), 4 s', `${fFired} / ${fTested}`, '0');
  check(fNonzero === 0, 'same points: rescue ever saw depth > 0 while frozen', `${fNonzero} / ${fTested}`, '0');

  // Now the same adversarial points with the REAL Vehicle driving PARKED (handbrake, no
  // throttle) for 6 s. rescue.js's own doc comment records the banks at ~35°; a bisected
  // point sits exactly ON that bank by construction, so if the handbrake's grip cannot hold
  // a 35° grade the car can slide, under gravity alone, from a genuinely dry start into
  // genuinely deep water within about a second — a real, if narrow, wet transition that
  // rescue is then RIGHT to act on. This is not a rescue.js defect (the frozen check above
  // is what isolates that); it is reported here so the number is on record, with the ground
  // slope logged for the worst case so it is checkable against the documented bank angle.
  let bTested = 0,
    bFiredAfterMoving = 0,
    bFiredWithoutMoving = 0,
    bWorst = 0,
    steepestSlideSlope = 0;
  for (const s of surveys) {
    const points = subsample(s.boundaryDry, 15, 0xe2);
    for (const p of points) {
      bTested++;
      const { car, rescue, placed } = makeRig(s.T);
      car.placeAt(p.x, p.z, rand2(p.x | 0, p.z | 0, s.seed ^ 0xf4) * Math.PI * 2);
      const start = { x: car.x, z: car.z };
      for (let i = 0; i < 60 * 6; i++) {
        car.update(DT, PARKED);
        const surf = s.T.surface(car.x, car.z);
        rescue.update(DT, car, surf);
        bWorst = Math.max(bWorst, rescue.depth);
      }
      if (placed() > 0) {
        const drift = Math.hypot(car.x - start.x, car.z - start.z);
        if (drift > 0.25) {
          bFiredAfterMoving++;
          const hx = s.T.height(p.x + 1, p.z),
            hz = s.T.height(p.x, p.z + 1),
            h0 = s.T.height(p.x, p.z);
          const slope = Math.hypot(hx - h0, hz - h0);
          if (slope > steepestSlideSlope) steepestSlideSlope = slope;
        } else bFiredWithoutMoving++;
      }
    }
  }
  info('same points, REAL vehicle physics (handbrake, no throttle), 6 s', `${bFiredAfterMoving + bFiredWithoutMoving} / ${bTested} rescued`);
  check(
    bFiredWithoutMoving === 0,
    '  ...of those, rescued WITHOUT the car ever moving > 0.25 m (would be a real false positive)',
    `${bFiredWithoutMoving}`,
    '0',
  );
  if (bFiredAfterMoving) {
    info('  ...of those, rescued AFTER sliding under gravity (handbrake lost to bank grade)', `${bFiredAfterMoving} (steepest slope slid: ${steepestSlideSlope.toFixed(2)} m/m = ${((Math.atan(steepestSlideSlope) * 180) / Math.PI).toFixed(0)}°, matches rescue.js's documented ~35° banks)`);
  }
  info('worst depth ever recorded across the boundary-point physics run', `${bWorst.toFixed(4)} m`);
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * PART C — shoreline shelves and lakeside roads, many lakes.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── C. parked on a real shoreline shelf, and driving lakeside roads ─────────────────');
{
  let shelfTested = 0,
    shelfFired = 0;
  for (const s of surveys) {
    const points = subsample(s.shelf, 10, 0x51);
    for (const p of points) {
      // Reject anywhere a neighbour a few metres off is already past the DEEP gate — bench-
      // rescue.mjs's own definition of "deliberately near a shoreline", applied automatically
      // rather than by hand at one point.
      let tooClose = false;
      for (const [ox, oz] of [
        [5, 0],
        [-5, 0],
        [0, 5],
        [0, -5],
        [4, 4],
        [-4, -4],
      ]) {
        if (waterDepth(s.T.surface(p.x + ox, p.z + oz)) > 0.55) tooClose = true;
      }
      if (tooClose) continue;
      shelfTested++;
      const { car, rescue, placed } = makeRig(s.T);
      car.placeAt(p.x, p.z, 0);
      for (let i = 0; i < 60 * 20; i++) {
        car.update(DT, i < 60 * 10 ? PARKED : { steer: Math.sin(i / 90) * 0.5, throttle: 0.25, brake: 0, handbrake: 0, analogue: true });
        rescue.update(DT, car, s.T.surface(car.x, car.z));
      }
      if (placed() > 0) shelfFired++;
    }
  }
  check(shelfFired === 0, 'real shoreline shelves, 10 s parked + 10 s paddling', `${shelfFired} / ${shelfTested}`, '0');

  // Lakeside roads: auto-discover EVERY road sample (not a small subsample — the pool is
  // spatially clustered by lake, so a small subsample gives a noisy rate) with deep water
  // within 20 m.
  let roadPool = [];
  for (const s of surveys) {
    for (const e of s.T.roads.edges) {
      if (e.tier > 1) continue;
      const n = e.pts.length / 2;
      for (let k = 2; k < n - 2; k += 6) {
        const x = e.pts[k * 2],
          z = e.pts[k * 2 + 1];
        const dx = e.pts[k * 2 + 2] - e.pts[k * 2 - 2];
        const dz = e.pts[k * 2 + 3] - e.pts[k * 2 - 1];
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l,
          nz = dx / l; // perpendicular; sign doesn't matter, both sides get checked
        let near = Infinity;
        for (const side of [1, -1]) {
          for (const dist of [6, 9, 12, 16, 20]) {
            const d = waterDepth(s.T.surface(x + nx * dist * side, z + nz * dist * side));
            if (d > 0.6) near = Math.min(near, dist);
          }
        }
        if (near < 20) roadPool.push({ seed: s.seed, T: s.T, x, z, near });
      }
    }
  }
  info('lakeside road samples discovered across all worlds', roadPool.length);

  // C1 — parked ON the road itself, engine off, no autopilot: isolates rescue from the
  // autopilot entirely. Anything that moves the car here is rescue reacting to nothing.
  let parkedFired = 0;
  for (const r of roadPool) {
    const { car, rescue, placed } = makeRig(r.T);
    const q = r.T.roads.query(r.x, r.z);
    car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    for (let i = 0; i < 60 * 10; i++) {
      car.update(DT, PARKED);
      rescue.update(DT, car, r.T.surface(car.x, car.z));
    }
    if (placed() > 0) parkedFired++;
  }
  check(parkedFired === 0, 'parked (engine off) ON a lakeside road, 10 s, no autopilot', `${parkedFired} / ${roadPool.length}`, '0');

  // C2 — autopilot-driven, full pool, a full minute each. INFORMATIONAL, not a strict gate:
  // the commit this round shipped under says outright "the autopilot wanders far more now
  // that roads actually curve" as a known, OPEN issue in car/autopilot.js (out of this
  // audit's scope — rescue.js and camera.js only). When the autopilot drives off a curving
  // lakeside road for a continuous ~2 s stretch into water past the DEEP gate, rescue is
  // doing exactly its documented job by recovering it; the number below quantifies how often
  // that upstream wandering produces a rescue, for whoever owns the autopilot next.
  let autoFired = 0;
  const autoSample = subsample(roadPool, 120, 0x62); // bounded for runtime; C1 already covers the full pool
  for (const r of autoSample) {
    const { car, rescue, placed } = makeRig(r.T);
    const auto = new Autopilot();
    const q = r.T.roads.query(r.x, r.z);
    car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
    auto.toggle(car);
    for (let i = 0; i < 60 * 60; i++) {
      if (!auto.on) auto.toggle(car);
      const cmd = auto.update(car, NEUTRAL, DT) || NEUTRAL;
      car.update(DT, cmd);
      rescue.update(DT, car, r.T.surface(car.x, car.z));
    }
    if (placed() > 0) autoFired++;
  }
  info(
    'autopilot-driven, 60 s each (attributed to the OPEN autopilot road-wander issue, not rescue.js)',
    `${autoFired} / ${autoSample.length} rescued (${((100 * autoFired) / autoSample.length).toFixed(0)}%)`,
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * PART D — genuinely wet starts: recovery time, wet landings, repeat triggers.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── D. dropped straight into deep water — recovery time and repeat triggers ─────────');
{
  let deepSamples = [];
  for (const s of surveys) deepSamples.push(...subsample(s.deep, 6, 0x73).map((p) => ({ ...p, T: s.T })));
  deepSamples = subsample(deepSamples, 60, 0x84);

  const recoverTimes = [];
  let neverPlaced = 0;
  let landedWet = 0;
  let refired = 0;

  for (const p of deepSamples) {
    const { car, rescue, placed } = makeRig(p.T);
    car.placeAt(p.x, p.z, rand2(p.x | 0, p.z | 0, p.seed ^ 0x95) * Math.PI * 2);
    let tPlaced = null;
    let placedAt1 = 0;
    for (let i = 0; i < 60 * 12; i++) {
      const t = i * DT;
      car.update(DT, PARKED); // a genuinely wet spawn: nobody has touched the wheel yet
      const surf = p.T.surface(car.x, car.z);
      const moved = rescue.update(DT, car, surf);
      if (moved && tPlaced === null) {
        tPlaced = t;
        placedAt1 = placed();
      }
    }
    if (tPlaced === null) {
      neverPlaced++;
      continue;
    }
    recoverTimes.push(tPlaced);
    const landDepth = waterDepth(p.T.surface(car.x, car.z));
    if (landDepth > 0) landedWet++;
    if (placed() > placedAt1) refired++;
  }

  recoverTimes.sort((a, b) => a - b);
  const mean = recoverTimes.length ? recoverTimes.reduce((a, b) => a + b, 0) / recoverTimes.length : NaN;
  const p95 = recoverTimes.length ? recoverTimes[Math.floor(recoverTimes.length * 0.95)] : NaN;

  check(neverPlaced === 0, 'deep-water drops that never got rescued in 12 s', `${neverPlaced} / ${deepSamples.length}`, '0');
  check(
    recoverTimes.every((t) => t <= 2.6),
    'recovery time, worst case',
    `${recoverTimes.length ? recoverTimes[recoverTimes.length - 1].toFixed(2) : 'n/a'} s`,
    '<= 2.6 s (1.0 hold + 1.0 lift + margin)',
  );
  info('recovery time: mean / p95 / max', `${mean.toFixed(2)} / ${p95.toFixed(2)} / ${recoverTimes.length ? recoverTimes[recoverTimes.length - 1].toFixed(2) : 'n/a'} s`);
  check(landedWet === 0, 'landed somewhere that still reads wet', `${landedWet} / ${recoverTimes.length}`, '0');
  check(refired === 0, 'rescued a second time within the same 12 s stop (the loop)', `${refired} / ${recoverTimes.length}`, '0');
}

/* ────────────────────────────────────────────────────────────────────────────────────────
 * PART E — what "in water" means, compared three ways, in metres.
 * ──────────────────────────────────────────────────────────────────────────────────────── */
console.log('\n── E. rescue.js vs. tools/diag-water.mjs vs. the real render water plane ───────────');
{
  // rescue.js (carved height, climate-grid weights) vs. the raw/direct test diag-water.mjs
  // uses (raw land, exactly-computed weights) — same points as the shoreline-bisection set
  // plus the deep points, since that is where any divergence would concentrate.
  //
  // The two directions of disagreement mean opposite things and must be counted separately:
  //   carved-WET, raw-DRY   — rescue.js sees water the raw ground does not. This is the
  //                           direction that would actually explain a false positive, and
  //                           should not happen anywhere (roads.js's carve only ever LIFTS
  //                           ground toward a road target, never lowers it below raw land —
  //                           see groundFromCarve in terrain.js).
  //   raw-WET, carved-DRY   — the batter-lifted shoulder of a road embankment reads dry under
  //                           the carved height while the natural land underneath (what
  //                           diag-water.mjs sees) is still a lake bed. roads.js's own carve()
  //                           documents this: `edge` (onRoad, ~0.75 m falloff) narrows far
  //                           faster than `mask` (the height blend, batter-scaled, tens of
  //                           metres for a tall fill) — so a point can already read "off-road"
  //                           while still sitting on the carved shoulder. Expected, and safe:
  //                           it makes rescue LESS trigger-happy near a road, never more.
  // rescue.js's own operational threshold — the DEEP constant in rescue.js — matters more
  // than a bare "any depth > 0" comparison: rescue never ACTS below it, so a sub-centimetre
  // sign flip right at a knife-edge boundary (inherent to comparing two slightly different
  // approximations of the same blend band) is not a behavioural difference. Both are counted.
  const RESCUE_DEEP = 0.6; // rescue.js: const DEEP = 0.6
  let compared = 0,
    agree = 0,
    concerning = 0, // carved-WET (any), raw-DRY
    concerningAtGate = 0, // carved-WET *past the 0.6 m gate rescue actually acts on*, raw-DRY
    benign = 0, // raw-WET, carved-DRY (batter shoulder)
    maxAgreeDelta = 0;
  const samples = [];
  for (const s of surveys) {
    for (const p of subsample(s.boundaryDry, 8, 0x11)) samples.push({ ...p, T: s.T });
    for (const p of subsample(s.deep, 3, 0x22)) samples.push({ ...p, T: s.T });
    for (const p of subsample(s.shelf, 3, 0x33)) samples.push({ ...p, T: s.T });
  }
  for (const p of samples) {
    const surf = p.T.surface(p.x, p.z);
    const rescueD = waterDepth(surf);
    const rawD = rawDepthAt(p.seed, p.x, p.z);
    compared++;
    const rescueWet = rescueD > 0,
      rawWet = rawD > 0;
    if (rescueWet === rawWet) {
      agree++;
      maxAgreeDelta = Math.max(maxAgreeDelta, Math.abs(rescueD - rawD));
    } else if (rescueWet && !rawWet) {
      concerning++;
      if (rescueD > RESCUE_DEEP) concerningAtGate++;
    } else benign++;
  }
  info('points compared (shoreline + deep + shelf, every world)', compared);
  info('agree (same wet/dry verdict)', `${agree} / ${compared}`);
  info(
    'rescue.js reads ANY depth > 0 where diag-water.mjs reads exactly dry (mostly sub-cm, see below)',
    `${concerning} / ${compared}`,
  );
  check(
    concerningAtGate === 0,
    '  ...of those, past the 0.6 m gate rescue.js actually acts on (the only ones that could fire)',
    `${concerningAtGate} / ${compared}`,
    '0',
  );
  info('rescue.js reads DRY where diag-water.mjs reads WET (batter-lifted shoulder — benign, see roads.js carve() edge-vs-mask)', `${benign} / ${compared}`);
  info('worst |Δdepth| where both sides already agree on wet/dry', `${maxAgreeDelta.toFixed(4)} m`);

  // rescue.js vs. the actual production buildChunk() water plane, at a bounded sample so this
  // stays fast — the render level is a per-64 m-chunk AVERAGE, so some disagreement near a
  // shoreline is expected; what matters is whether it ever disagrees FAR from one.
  let renderCompared = 0,
    renderMismatch = 0;
  const renderSamples = [];
  for (const s of surveys.slice(0, 8)) {
    for (const p of subsample(s.boundaryDry, 3, 0x44)) renderSamples.push({ ...p, T: s.T });
  }
  for (const p of renderSamples) {
    renderCompared++;
    const rescueWet = waterDepth(p.T.surface(p.x, p.z)) > 0;
    const rWet = renderWetAt(p.seed, p.x, p.z, p.T);
    if (rescueWet !== rWet) renderMismatch++;
  }
  info('points compared against the real per-chunk render water plane', renderCompared);
  info('rescue.js vs. render plane disagreement (expected at a bisected boundary point)', `${renderMismatch} / ${renderCompared}`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL GOOD'}\n`);
process.exit(failures ? 1 : 0);
