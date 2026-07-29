/* Wanderoad — does auto-drive actually stop itself, instead of the player having to?
 *
 * Two playtest reports, both about auto-drive not knowing when to give up:
 *
 *   1. A road can end in open ground with nothing marking why — the lattice in
 *      src/world/roads.js hands out real dead ends by construction, a node with no qualifying
 *      link on one side, the same way any hashed lattice always produces some leaf nodes. That
 *      is not a bug. Driving straight past the last vertex into the field beyond it was: the
 *      old speed plan only knew how to brake for a bend, and a dead end reads as a flat,
 *      un-bending road right up until there is no road left at all.
 *   2. Wedge the car against anything — a rock, a verge, a fence — and the old auto-drive just
 *      kept commanding throttle at a car that could not move, forever, unless the player
 *      noticed and pressed R themselves.
 *
 * bench-drive.mjs is the wrong shape of test for either: it drives a normal stretch and reports
 * how well the car holds the centreline, and neither of these is a normal stretch — they are
 * specific situations that have to be engineered on purpose and then watched. So this builds a
 * real generated network, finds an edge that is a genuine dead end by the SAME test the
 * autopilot itself now uses (nextEdge() returning nothing), drives straight at it, and checks
 * the car stops on the tarmac instead of rolling into the field past the last vertex. Then it
 * pins a car's velocity to simulate being wedged (this harness has no collision system to wedge
 * it against something for real) and checks the stuck detector resets it to the road inside a
 * bounded time, using the exact same recover() shape main.js wires up for real. Last, it checks
 * the activation ping fires once per G-press and not once per frame.
 *
 *   node tools/bench-autopilot-safety.mjs [--seed 20260726]
 */
import { Vehicle } from '../src/car/vehicle.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Autopilot, pathOf, headingAt, locate, nextEdge } from '../src/car/autopilot.js';
import { PHYSICS_DT } from '../src/car/tuning.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? +argv[i + 1] : d;
};
const SEED = opt('seed', 20260726);
const NOTHING = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}

/** World position at arc length `s` along an edge's own polyline. The inverse of locate(). */
function xzAt(edge, path, s) {
  const n = path.n;
  s = Math.max(0, Math.min(path.total, s));
  let k = 0;
  while (k < n - 1 && path.cum[k + 1] < s) k++;
  const segLen = path.len[k] || 1e-6;
  const t = (s - path.cum[k]) / segLen;
  const ax = edge.pts[k * 2], az = edge.pts[k * 2 + 1];
  const bx = edge.pts[k * 2 + 2], bz = edge.pts[k * 2 + 3];
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t };
}

/* ── find a genuine dead end ────────────────────────────────────────────── */
function findDeadEnd(seed, radius) {
  const terr = new Terrain(seed, -radius, -radius, radius, radius);
  const field = terr.roads;
  let best = null;
  for (const edge of field.edges) {
    const path = pathOf(edge);
    for (const dir of [1, -1]) {
      if (nextEdge(field, edge, path, dir)) continue;
      // Prefer a long edge so the car has real runway to get up to speed before it has to
      // brake — a more honest test than starting it a stone's throw from the end.
      if (!best || path.total > best.path.total) best = { terr, field, edge, path, dir };
      if (best.path.total > 200) break;
    }
    if (best && best.path.total > 200) break;
  }
  return best;
}

let found = null;
let usedRadius = 0;
for (let tries = 0, radius = 1100; tries < 5 && !found; tries++, radius += 700) {
  found = findDeadEnd(SEED, radius);
  if (found) usedRadius = radius;
}
if (!found) {
  console.log(`FAIL  no dead end turned up within radius ${usedRadius} m of the origin on seed ${SEED} — widen the search`);
  process.exit(1);
}
const { terr, field, edge, path, dir } = found;
console.log(`dead end found: edge ${edge.key}, dir ${dir}, edge length ${path.total.toFixed(0)} m (search radius ${usedRadius} m)\n`);

/* ── check 1: drives at it, must stop short, not roll past the last vertex ── */
{
  const runway = Math.min(260, path.total);
  const s0 = dir > 0 ? path.total - runway : runway;
  const start = xzAt(edge, path, s0);
  const heading = dir > 0 ? headingAt(path, s0) : headingAt(path, s0) + Math.PI;

  const endS = dir > 0 ? path.total : 0;
  const endPos = xzAt(edge, path, endS);
  const endHeading = dir > 0 ? headingAt(path, path.total) : headingAt(path, 0) + Math.PI;
  const endTx = Math.sin(endHeading), endTz = Math.cos(endHeading);

  const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'cruise' });
  car.placeAt(start.x, start.z, heading);

  const auto = new Autopilot({ cruise: 22 });
  auto.on = true;
  // Latch it onto the target edge directly, in the target direction — a deterministic drive at
  // the ONE dead end this run picked, rather than trusting query-based re-acquisition to find
  // the same one back if something nearby happens to be closer.
  auto._field = field;
  auto._edge = edge;
  auto._key = edge.key;
  auto._dir = dir;

  let maxOvershoot = -Infinity;
  let sawDeadEnd = false;
  let minDeadAhead = Infinity;
  let stoppedReason = '';
  const SECS = 45;
  let secsRun = 0;
  for (let i = 0; i < SECS / PHYSICS_DT; i++) {
    secsRun = i * PHYSICS_DT;
    if (!auto.on) {
      stoppedReason = auto.lastReason;
      break;
    }
    const cmd = auto.update(car, NOTHING, PHYSICS_DT) || NOTHING;
    if (auto.tel.deadEnd) {
      sawDeadEnd = true;
      minDeadAhead = Math.min(minDeadAhead, auto.tel.deadAhead);
    }
    car._step(PHYSICS_DT, cmd);
    const overshoot = (car.x - endPos.x) * endTx + (car.z - endPos.z) * endTz;
    maxOvershoot = Math.max(maxOvershoot, overshoot);
  }

  console.log(`  ran ${secsRun.toFixed(1)}s, closest dead-end read ${isFinite(minDeadAhead) ? minDeadAhead.toFixed(1) : 'n/a'} m, ` +
    `max distance past the last vertex ${maxOvershoot.toFixed(2)} m, handed back with reason "${stoppedReason}"`);
  check('dead end: autopilot detects it (nextEdge finds nothing) before reaching it', sawDeadEnd);
  check('dead end: never ends up past the road\'s last vertex into open terrain', maxOvershoot < 2, `max overshoot ${maxOvershoot.toFixed(2)} m`);
  check('dead end: stops and hands back control AT the road, not off it', stoppedReason === 'the road ends here', `reason was "${stoppedReason}"`);
}

/* ── dead end WITH an R key wired up: it turns round and keeps driving ────────
 * Operator: "must click r when end of road on auto drive mode". The run above proves the
 * fallback — no recover() hook, so it stops and hands back, which is what it always did. This
 * one proves the behaviour the game actually ships: main.js hands the autopilot the same
 * backToRoad() the R key calls, so reaching a dead end must press it and carry on rather than
 * park in a field and hand the wheel back to somebody who is not there.
 *
 * Same fixture, same latched edge, same direction. The only difference is the hook.
 */
{
  const runway = Math.min(260, path.total);
  const s0 = dir > 0 ? path.total - runway : runway;
  const start = xzAt(edge, path, s0);
  const heading = dir > 0 ? headingAt(path, s0) : headingAt(path, s0) + Math.PI;
  const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'cruise' });
  car.placeAt(start.x, start.z, heading);

  let recovered = 0;
  const said = [];
  const auto = new Autopilot({
    cruise: 22,
    say: (t) => said.push(t),
    /* main.js's backToRoad(), reduced to what this test needs to see: put the car on the
     * nearest centreline pointing whichever way has more road left. The real one also resets
     * the chase camera and the streak's grace; neither is visible from here. */
    recover: () => {
      recovered++;
      const q = terr.roads.query(car.x, car.z);
      if (!isFinite(q.d)) return;
      let h = Math.atan2(q.tx, q.tz);
      // point back down the road rather than off the end of it
      const fwd = Math.sin(car.yaw) * q.tx + Math.cos(car.yaw) * q.tz;
      if (fwd > 0) h += Math.PI;
      car.placeAt(q.qx, q.qz, h);
    },
  });
  auto.on = true;
  auto._field = field;
  auto._edge = edge;
  auto._key = edge.key;
  auto._dir = dir;

  let stillOn = true;
  let maxOff = 0;
  let metresAfter = 0;
  let lastX = car.x;
  let lastZ = car.z;
  const SECS = 60;
  for (let i = 0; i < SECS / PHYSICS_DT; i++) {
    if (!auto.on) {
      stillOn = false;
      break;
    }
    const cmd = auto.update(car, NOTHING, PHYSICS_DT) || NOTHING;
    car._step(PHYSICS_DT, cmd);
    const q = car.terrain.roads.query(car.x, car.z);
    const d = isFinite(q.d) ? q.d : 999;
    maxOff = Math.max(maxOff, d);
    if (recovered > 0) metresAfter += Math.hypot(car.x - lastX, car.z - lastZ);
    lastX = car.x;
    lastZ = car.z;
  }
  console.log(`  pressed R ${recovered} time(s); drove ${metresAfter.toFixed(0)} m afterwards; worst distance from a centreline ${maxOff.toFixed(1)} m; still driving itself: ${stillOn}`);
  console.log(`  said: ${said.map((t) => `"${t}"`).join(', ') || '(nothing)'}`);
  check('dead end + R wired: it presses R instead of parking', recovered >= 1, `${recovered} press(es)`, '>= 1');
  check('dead end + R wired: it is still driving itself a minute later', stillOn, String(stillOn), 'true');
  check('dead end + R wired: and it carried on down the road, not into a field', metresAfter > 100, `${metresAfter.toFixed(0)} m after the reset`, '> 100 m');
  check('dead end + R wired: never leaves the carriageway doing it', maxOff < 12, `${maxOff.toFixed(1)} m`, '< 12 m');
  check('dead end + R wired: and it says so', said.some((t) => /ends here/.test(t)), said.join(' | ') || '(nothing)', 'mentions the road ending');
}


/* ── check 2: wedged somewhere, must reset to the road within a bounded time ── */
{
  // Off the network entirely: scan a grid across the SAME window this bench already built and
  // take whichever point reads farthest from any road. Two things this deliberately avoids:
  //   - accepting an Infinity reading. query() only ever looks at THIS field's own edge list
  //     (see roads.js), so a point far enough to leave every edge's bounding box reads as
  //     Infinity, which means "outside the window this bench built", not "off the road" the
  //     way the rest of this check means it — and it would go on reading Infinity after
  //     recover() moves the car too, against this same static field, failing the "back near a
  //     road" assertion below for a reason that has nothing to do with autopilot.
  //   - a single fixed direction. Perpendicular-from-the-dead-end sounded clear in principle
  //     but on one seed walked almost straight down a second, unrelated road (0 m off it) —
  //     the lattice is denser than a single line out from one edge accounts for. A grid over
  //     the whole window is not fooled by any one direction being unlucky.
  const MIN_OFF_ROAD = 60; // comfortably past either tier's own off-network trigger radius (~28-33 m)
  const span = usedRadius * 0.75; // stay well inside the window, clear of any edge-of-generation artefacts
  let offX = 0, offZ = 0, bestD = -Infinity;
  const STEPS = 10;
  for (let gi = -STEPS; gi <= STEPS; gi++) {
    for (let gj = -STEPS; gj <= STEPS; gj++) {
      const cx = (span * gi) / STEPS;
      const cz = (span * gj) / STEPS;
      const q = field.query(cx, cz);
      if (isFinite(q.d) && q.d > bestD) {
        bestD = q.d;
        offX = cx;
        offZ = cz;
      }
    }
  }

  const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'cruise' });
  car.placeAt(offX, offZ, 0);
  const startQ = field.query(offX, offZ);
  console.log(`\nstuck check: car placed ${isFinite(startQ.d) ? startQ.d.toFixed(0) : 'inf'} m from the nearest road`);

  let recoverCalls = 0;
  const auto = new Autopilot({
    cruise: 16,
    recover: () => {
      recoverCalls++;
      const q = terr.roads.query(car.x, car.z);
      if (isFinite(q.d)) car.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz));
      else {
        const s = findSpawn(SEED, car.x, car.z);
        car.placeAt(s.x, s.z, s.heading);
      }
    },
  });
  auto.on = true;

  let recoveredAt = 0;
  const SECS = 12;
  for (let i = 0; i < SECS / PHYSICS_DT; i++) {
    const cmd = auto.update(car, NOTHING, PHYSICS_DT) || NOTHING;
    car._step(PHYSICS_DT, cmd);
    // Simulate being wedged: pin the velocity every step so speed can never build past one
    // tick's worth of acceleration, the same OBSERVABLE symptom a collision with an immovable
    // solid would produce. This harness has no collision system to wedge the car against for
    // real (that lives in game/collide.js, not exercised here).
    car.vx = 0;
    car.vz = 0;
    if (recoverCalls > 0) {
      recoveredAt = (i + 1) * PHYSICS_DT;
      break;
    }
  }

  const afterQ = terr.roads.query(car.x, car.z);
  console.log(`  recover() called ${recoverCalls} time(s), first at ${recoveredAt ? recoveredAt.toFixed(2) + 's' : 'never'}, ` +
    `car now ${isFinite(afterQ.d) ? afterQ.d.toFixed(1) : 'inf'} m from the nearest road, autopilot still on: ${auto.on}`);
  check('stuck: was actually off the road network to start with', isFinite(startQ.d) && startQ.d > MIN_OFF_ROAD, `start dist ${isFinite(startQ.d) ? startQ.d.toFixed(0) : 'inf'} m`);
  check('stuck: calls the injected recover() (the same backToRoad main.js passes in)', recoverCalls > 0);
  check('stuck: resolves within a bounded time (< 4.2s, ahead of the 4s lost-road path)', recoveredAt > 0 && recoveredAt < 4.2, `${recoveredAt.toFixed(2)}s`);
  check('stuck: stays engaged through its own recovery rather than just handing back control', auto.on === true);
  check('stuck: actually ends up back near a road afterwards', isFinite(afterQ.d) && afterQ.d < 15, `roadDist ${isFinite(afterQ.d) ? afterQ.d.toFixed(1) : 'inf'} m`);
}

/* ── check 3: the activation ping fires once per G-press, never per frame ── */
{
  const s0 = dir > 0 ? Math.max(0, path.total - 100) : Math.min(path.total, 100);
  const start = xzAt(edge, path, s0);
  const heading = dir > 0 ? headingAt(path, s0) : headingAt(path, s0) + Math.PI;
  const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'cruise' });
  car.placeAt(start.x, start.z, heading);

  let pings = 0;
  const auto = new Autopilot({ cruise: 16, ping: () => pings++ });

  auto.toggle(car); // on
  check('ping: fires exactly once on activation', pings === 1, `pings=${pings} after toggle-on`);

  for (let i = 0; i < 240; i++) {
    const cmd = auto.update(car, NOTHING, PHYSICS_DT) || NOTHING;
    car._step(PHYSICS_DT, cmd);
  }
  check('ping: does not fire again while just driving (not per-frame)', pings === 1, `pings=${pings} after 240 frames`);

  auto.toggle(car); // off
  check('ping: does not fire on deactivation', pings === 1, `pings=${pings} after toggle-off`);

  auto.toggle(car); // on again
  check('ping: fires again on re-activation', pings === 2, `pings=${pings} after a second toggle-on`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
