/* created by AI */
/* Wanderoad — can a real car actually DRIVE from the road, up the access spur, and stop at
 * the pumps?
 *
 * The operator's report, twice: "The road up to the gas station still doesn't work at all."
 * Marked fixed twice already. Both previous rounds (tools/diag-spur.mjs, and bench-props.mjs's
 * "a real station hitbox actually stops the car") proved something real and neither proved
 * this:
 *
 *   - diag-spur.mjs proves the drawn spur SURFACE sits on the ground the car drives on — a
 *     purely VERTICAL claim. It says nothing about whether the surface is a path you can
 *     steer down, or whether anything solid stands across it.
 *   - bench-props.mjs's station-collision test drives a real Vehicle in from the spur mouth,
 *     but its own candidate-selection loop (`reach()`) accepts the FIRST of up to six nearby
 *     stations where the car hits ANY solid tagged `kind: 'station'` — and the forecourt's own
 *     KERB WALL carries that exact tag (`stationSolids`' apron edge, `kind: 'station', apron:
 *     true`). A car that drives twelve metres up the spur and rams a kerb wall dead across the
 *     entrance satisfies that condition. The harness cannot tell "reached the kiosk" from
 *     "got walled off at the driveway" — it was never asked to, because it exists to test the
 *     KIOSK'S collider, not the spur. So a station whose entrance is solid can still be the
 *     one the harness picks to declare "a station a car can actually drive into", and it never
 *     lets a broken one fail the suite: one working station in six is enough to pass.
 *
 * So: drive EVERY sampled station (not the first lucky one), starting from a real approach
 * along the road — not already lined up on the spur's own axis, the way bench-props.mjs's own
 * launch() does — and ask a question neither check above asks: does the car END UP WITHIN
 * STATION_RADIUS OF THE PUMPS, stopped, having never rolled over?
 *
 * THE DRIVER MODEL, and why it is not a trivial "aim and go". A first version steered by simple
 * proportional pursuit straight at a moving waypoint (mouth, then the station centre) at a
 * constant 12 m/s. It measured a REAL bug (see the `yaw` fix in world/props.js, and the 25% ->
 * 14% swing this tool's own git history shows when that fix went in against the naive
 * controller) — but it also measured its own instability: mouth, the spur's own apron-end and
 * the station centre are exactly colinear (they all sit on the one road-to-station normal), so
 * the only real corner in the route is a near-90 degree turn off the road, on the mouth's own
 * ~5-7 m flare, and the fleet's own STEER.minRadius (7 m, car/tuning.js) makes that a GENUINELY
 * tight manoeuvre. A short pure-pursuit lookahead close to the corner (5 m, shorter than the
 * car's own turn radius) asks for more curvature than the car can deliver and the controller
 * span out into a widening circle — measured, one candidate station went from centreDist 14.3 m
 * to 29.5 m over nine seconds while never touching a single collider (`hit: null` throughout),
 * which is a test-driver failure, not a game one. FIXED by two changes, both about giving the
 * corner room rather than demanding it be cut tight: a LOOKAHEAD held at 9 m throughout (at or
 * above the car's own minimum radius, which is what pure-pursuit theory says a stable lookahead
 * has to be) instead of shrinking near the corner, and slowing from cruise to 5 m/s over the
 * 25 m approaching the mouth rather than only in the last few metres — the same thing a real
 * driver does before a tight driveway. Measured on the first 22 stations of seed 20260726: the
 * unstable controller reached 13/20 (65%, two never baked); the stable one reached 21/22 (95%).
 * That remaining number is now a real one — see the outcome buckets below for what a failure
 * beyond that looks like.
 *
 *   NEVER TURNED IN     — closest approach to the spur's own MOUTH stayed wide. The car never
 *                         got close to the mouth at all — a geometry or steering-radius fault,
 *                         not a spur one.
 *   BLOCKED AT ENTRANCE — got close to the mouth, spent itself right there, never reached the
 *                         apron. What a misaligned kerb wall, or a doorway gap cut into the
 *                         wrong edge of the forecourt, looks like from the driver's seat.
 *   STALLED ON SPUR     — got PAST the mouth, into the run between road and forecourt, and lost
 *                         all speed before reaching the apron. What "too steep" looks like —
 *                         STATION_MAX_STEP allows a 3.0 m rise over an 8.9 m run, a 34% grade,
 *                         and nothing before this measured whether a real touring car can climb
 *                         one.
 *   ROLLED               — the car tipped over at any point in the run.
 *   TIMED OUT            — none of the above; the run simply never settled inside RUN_S. With
 *                         the stable controller this is the leftover bucket for a genuinely
 *                         difficult approach (a tree on the line, a bank the car cannot hold a
 *                         line on) rather than a controller artefact — see the header above for
 *                         the measurement that tells the two apart.
 *   REACHED             — inside STATION_RADIUS of the pumps and able to come to rest there,
 *                         never having rolled. The claim the operator's report is actually
 *                         about.
 *
 *   node tools/diag-spur-drive.mjs [seed]
 */

import { Object3D } from 'three';
import {
  stationsInBox, stationSpur, STATION_RADIUS, STATION_APRON_HALF_DEPTH,
} from '../src/world/props.js';
import { Props } from '../src/render/props.js';
import { Terrain } from '../src/world/terrain.js';
import { Solids } from '../src/game/collide.js';
import { Vehicle } from '../src/car/vehicle.js';
import { clamp } from '../src/core/math.js';

const SEEDS = process.argv[2] ? [Number(process.argv[2]) >>> 0] : [20260726, 7, 424242, 90210];
/** Stations measured per seed. Not six, and not "until one works" — diag-stations.mjs's own
 *  argument applies here too: a driver meets every station on their route, not the luckiest
 *  one in a sample, so the check has to look at all of them to mean anything. */
const PER_SEED = 24;
const DT = 1 / 60;
const RUN_S = 24; // generous — a stalled or looping car shows it well inside this
const CAR_R = 1.05;
/** m/s a car cruises an arterial at, before it starts slowing for the turn — 36 km/h. */
const CRUISE_V = 10;
/** m/s the corner itself is taken at, eased down to over the 25 m approaching the mouth — a
 *  real driveway turn, not a cruise-speed clip. */
const CORNER_V = 5;
/** How far out from the mouth the corner slow-down begins. */
const CORNER_EASE = 25;
/** Pure-pursuit lookahead, held constant — see the file header for why shrinking this near the
 *  corner is what made the first version of this tool unstable. */
const LOOKAHEAD = 9;
/** Below this, and still outside the pump radius, the car has stopped rather than parked. */
const STALL_V = 0.5;
/** Consecutive stalled frames before a stall is counted as real rather than a momentary dip
 *  crossing a bump — half a second. */
const STALL_FRAMES = 30;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(58)} ${String(got).padStart(10)}   want ${want}`);
};

/** Distance from point P to the nearest point of segment AB, and how far along it (0..1). */
function projectToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return { x: ax + dx * t, z: az + dz * t, t, d: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)) };
}

/** Walk `remaining` metres further along segment AB from parameter `t`, clamped to the segment's
 *  own end — `left` is whatever distance did not fit, for the caller to carry into the next leg. */
function walkAhead(ax, az, bx, bz, t, remaining) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const s = clamp(t * len + remaining, 0, len);
  return { x: ax + (dx / len) * s, z: az + (dz / len) * s, left: remaining - (s - t * len) };
}

/** One run: launch a Vehicle back along the ROAD (not already aimed down the spur) at a real
 *  cruise speed, and drive it by pure pursuit against the actual route a driver takes — road,
 *  the corner at the mouth, then straight up the spur to the pumps. See the file header for why
 *  this needs a held-constant lookahead and an early, gradual corner slow-down rather than a
 *  naive "aim at the next waypoint" controller. */
function driveIn(st, terrain, solids) {
  const sp = stationSpur(st);
  // The road's own tangent at this station — `along` is the same atan2(tx,tz) convention every
  // other heading in this file uses, so tx = sin(along), tz = cos(along).
  const tx = Math.sin(st.along);
  const tz = Math.cos(st.along);
  // Start 35 m back along the carriageway from the mouth, heading TOWARD it — a real approach,
  // not a car already sitting on the driveway's own axis pointed at the forecourt. The road has
  // no inherent "forward" at this point (it is a two-way carriageway); +tangent is used and
  // driven exactly like the other direction would be.
  const startX = sp.mouthX - tx * 35;
  const startZ = sp.mouthZ - tz * 35;
  // The route: down the road to the mouth, then straight up the spur's own line (mouth, apron-
  // end and station centre are exactly colinear — see stationSpur) to the pumps, extended a
  // little past centre so pursuit does not stall chasing a target it has already reached.
  const midX = st.x + (st.x - sp.apronX) * 0.15;
  const midZ = st.z + (st.z - sp.apronZ) * 0.15;
  const route = [[startX, startZ], [sp.mouthX, sp.mouthZ], [st.x, st.z], [midX, midZ]];

  const car = new Vehicle({ tier: 'touring', terrain, preset: 'cruise' });
  car.placeAt(startX, startZ, st.along);
  car.speed = CRUISE_V;
  car.vx = tx * CRUISE_V;
  car.vz = tz * CRUISE_V;

  let minMouthDist = Infinity;
  let minCentreDist = Infinity;
  let reachedAt = -1;
  let stallStreak = 0;
  let stalledAt = null; // { t, mouthDist, centreDist } the first sustained stall
  let rolled = false;
  let seg = 0; // which route segment the car is currently closest to — monotonic, never rewinds

  for (let k = 0; k < RUN_S / DT; k++) {
    const mouthDist = Math.hypot(car.x - sp.mouthX, car.z - sp.mouthZ);
    const centreDist = Math.hypot(car.x - st.x, car.z - st.z);
    if (mouthDist < minMouthDist) minMouthDist = mouthDist;
    if (centreDist < minCentreDist) minCentreDist = centreDist;
    if (reachedAt < 0 && centreDist < STATION_RADIUS) reachedAt = k * DT;

    // Advance `seg` to whichever upcoming segment the car now projects closest to, but never
    // back to an earlier one — a car that has passed the corner is not aiming at the road again.
    let best = projectToSegment(car.x, car.z, route[seg][0], route[seg][1], route[seg + 1][0], route[seg + 1][1]);
    for (let s = seg + 1; s < route.length - 1; s++) {
      const p = projectToSegment(car.x, car.z, route[s][0], route[s][1], route[s + 1][0], route[s + 1][1]);
      if (p.d < best.d) { best = p; seg = s; }
    }
    let remaining = LOOKAHEAD;
    let tgtX = 0, tgtZ = 0;
    let s = seg;
    let t = best.t;
    for (;;) {
      const w = walkAhead(route[s][0], route[s][1], route[s + 1][0], route[s + 1][1], t, remaining);
      tgtX = w.x; tgtZ = w.z;
      if (w.left <= 0 || s >= route.length - 2) break;
      remaining = w.left; s++; t = 0;
    }

    let e = Math.atan2(tgtX - car.x, tgtZ - car.z) - car.yaw;
    while (e > Math.PI) e -= Math.PI * 2;
    while (e < -Math.PI) e += Math.PI * 2;
    const aligned = Math.abs(e) < 0.5;
    // Brake to a stop once inside the radius AND roughly pointing at the pumps — braking purely
    // on distance (tried first) caught the car mid-turn, right on the boundary of the braking
    // radius, and left it oscillating between throttle and brake with too little speed left to
    // finish the corner at all.
    const braking = centreDist < STATION_RADIUS && aligned;
    // Slow for the corner well before it, the way an actual approach to a driveway does — full
    // cruise on the straight, eased down to CORNER_V over CORNER_EASE metres of approach to the
    // mouth, so the car is already slow and turning well before the turn's own tightest point.
    const cornerTarget = mouthDist < CORNER_EASE
      ? CORNER_V + (CRUISE_V - CORNER_V) * clamp((mouthDist - 6) / (CORNER_EASE - 6), 0, 1)
      : CRUISE_V;
    const targetV = braking ? 0 : Math.min(cornerTarget, CRUISE_V * clamp(1 - (Math.abs(e) / (Math.PI * 0.5)) * 0.6, 0.35, 1));
    const speedNow = Math.hypot(car.vx, car.vz);
    const throttle = braking ? 0 : speedNow < targetV ? 1 : 0;
    const brake = braking ? 0.6 : speedNow > targetV + 1 ? 0.5 : 0;
    car.update(DT, { steer: clamp(e * 2.2, -1, 1), throttle, brake, handbrake: 0, analogue: true });
    solids.resolve(car, CAR_R, DT);
    if (car.rolled) rolled = true;

    const speed = Math.hypot(car.vx, car.vz);
    if (speed < STALL_V && centreDist >= STATION_RADIUS) {
      stallStreak++;
      if (stallStreak === STALL_FRAMES && !stalledAt) {
        stalledAt = { t: k * DT, mouthDist, centreDist };
      }
    } else {
      stallStreak = 0;
    }
    // Settled at the pumps: reached, slow, and staying slow — no need to burn the rest of RUN_S.
    if (reachedAt >= 0 && speed < STALL_V && k * DT > reachedAt + 1) break;
  }

  const finalSpeed = Math.hypot(car.vx, car.vz);
  const finalCentreDist = Math.hypot(car.x - st.x, car.z - st.z);
  const parked = finalCentreDist < STATION_RADIUS && finalSpeed < 2.0 && !rolled;

  let outcome;
  if (rolled) outcome = 'ROLLED';
  else if (parked) outcome = 'REACHED';
  else if (minMouthDist > 20) outcome = 'NEVER TURNED IN';
  else if (stalledAt && stalledAt.mouthDist < STATION_APRON_HALF_DEPTH + 5) outcome = 'BLOCKED AT ENTRANCE';
  else if (stalledAt) outcome = 'STALLED ON SPUR';
  else outcome = 'TIMED OUT';

  return { outcome, minMouthDist, minCentreDist, finalCentreDist, finalSpeed, stalledAt, spurLen: Math.hypot(sp.apronX - sp.mouthX, sp.apronZ - sp.mouthZ) };
}

const scene = new Object3D();
const tally = {};
let totalTested = 0;

for (const SEED of SEEDS) {
  console.log(`\n── seed ${SEED} ──────────────────────────────────────────────────────`);
  const near = stationsInBox(-9000, -9000, 9000, 9000, SEED)
    .map((s) => ({ s, d: Math.hypot(s.x, s.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, PER_SEED);

  const solids = new Solids();
  const props = new Props({ seed: SEED, scene, solids });

  let n = 0;
  for (const cand of near) {
    let live = null;
    for (let i = 0; i < 4000 && !live; i++) {
      props.update(1 / 60, cand.s.x, cand.s.z);
      live = props.stations.find((q) => q.key === cand.s.key) || null;
    }
    if (!live) continue;
    n++;
    totalTested++;

    const T = new Terrain(SEED, live.x - 150, live.z - 150, live.x + 150, live.z + 150, 100);
    const r = driveIn(live, T, solids);
    tally[r.outcome] = (tally[r.outcome] || 0) + 1;
    const stallMsg = r.stalledAt ? `stalled at t=${r.stalledAt.t.toFixed(1)}s, ${r.stalledAt.mouthDist.toFixed(1)}m from mouth, ${r.stalledAt.centreDist.toFixed(1)}m from centre` : 'no stall';
    console.log(
      `       ${live.key.padEnd(16)} ${r.outcome.padEnd(20)} closestMouth ${r.minMouthDist.toFixed(1).padStart(6)}m  closestCentre ${r.minCentreDist.toFixed(1).padStart(6)}m  ` +
        `finalSpeed ${(r.finalSpeed * 3.6).toFixed(1).padStart(5)}km/h  spurLen ${r.spurLen.toFixed(1)}m  ${stallMsg}`,
    );
  }
  check(n >= 6, 'stations actually driven', n, '>= 6');
}

console.log('\n── summary across all seeds ────────────────────────────────────────────────');
for (const [k, v] of Object.entries(tally)) {
  console.log(`       ${k.padEnd(20)} ${v} / ${totalTested}  (${((100 * v) / totalTested).toFixed(0)}%)`);
}
const reached = tally.REACHED || 0;
check(totalTested >= 12, 'total stations tested', totalTested, '>= 12 (a real sample, not one lucky pick)');
check(reached / totalTested >= 0.85, 'drove from the road to a stop at the pumps', `${reached}/${totalTested} (${((100 * reached) / totalTested).toFixed(0)}%)`, '>= 85%');
check((tally.ROLLED || 0) === 0, 'stations that flip the car', tally.ROLLED || 0, '0');
check((tally['BLOCKED AT ENTRANCE'] || 0) / totalTested <= 0.1, 'stations where the entrance itself is blocked', `${tally['BLOCKED AT ENTRANCE'] || 0}/${totalTested}`, '<= 10%');

console.log(failures ? `\n${failures} SPUR-DRIVE CHECK(S) FAILED` : '\nall spur-drive checks passed');
process.exit(failures ? 1 : 0);
