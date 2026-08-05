/* created by AI
 * Wanderoad — DOES THE SCOOTER ACTUALLY WOBBLE, and do the cars still not?
 *
 * Operator: "Get the old wobbly controls back and give them to a scooter you can unlock".
 *
 * The wobble is his own comparison. When the cars leaned too much he wrote "Car still wobbles left
 * to right immensely, LIKE A SCOOTER", and three numbers were changed to stop it (rollZeta 0.85 ->
 * 1.3, loadTauRoll 0.15 -> 0.22, groundFollowRate unbounded -> 3 rad/s). The Scooter takes them
 * back. This file is the evidence that it did, and that nothing else did.
 *
 * WHY NOT diag-roll-oscillation.mjs. That file drives dead straight on the autopilot and counts
 * roll-rate sign changes, which is the right measurement for the bug it was written for — a car
 * that will not settle while you are trying to go straight. It cannot measure this: on that route
 * peak body roll is under 1.2 degrees for every vehicle and every seed tried, the lean spring is
 * hardly excited at all, and sweeping the Scooter's damping from zeta 1.3 down to 0.20 moved the
 * reading by 0.06 crossings/s. A measurement that cannot distinguish the two ends of the parameter
 * it is measuring is not evidence, so it is not used as any.
 *
 * WHAT THIS MEASURES INSTEAD is the thing the words describe. Steer hard one way, hold it, then
 * CENTRE THE STEERING and keep driving straight. A well-damped body returns to upright and stays
 * there: the roll signal crosses zero once and is done. An underdamped one overshoots, comes back,
 * overshoots the other way — it wobbles left to right — and the count of those crossings after the
 * input has stopped is exactly the ringing, with the driver's own steering removed from the
 * picture because there is no longer any.
 *
 * Both vehicles drive the same manoeuvre on the same flat ground, so the only difference between
 * the two numbers is the vehicle.
 *
 *   node tools/diag-scooter-wobble.mjs
 */
import { Vehicle } from '../src/car/vehicle.js';
import { FLEET, applyCarFeel } from '../src/game/garage.js';
import { BODY, PHYSICS_DT } from '../src/car/tuning.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';

const DEG = 180 / Math.PI;

/* A REAL SURFACE RECORD, FLATTENED — which is not the same as a hand-written one.
 *
 * Both earlier approaches measured the wrong thing, and both are worth recording:
 *
 *   A hand-written `surface()` stub (level, full grip, on-road) starved the tyre model. That record
 *   is missing fields it reads — the biome weight array among them — and a missing field there does
 *   not throw, it silently produces no grip: every vehicle cornered at a hundredth of a g and leant
 *   a quarter of a degree, damping or no damping.
 *
 *   The real world, driven for real, measures the WORLD. A straight-line drive from the spawn
 *   leaves the tarmac within a couple of seconds however gently it is steered, and a vehicle in the
 *   scenery rolls 15-18 degrees following the ground — swamping the two-degree lean under test and
 *   ending the run at walking pace.
 *
 * So the ground here is a genuine Terrain record, taken from the real world at the real spawn, with
 * its height and its normal flattened and its road coverage pinned. Every field the solver reads
 * exists and has the type the solver expects, because the terrain itself built it; what changes is
 * only that the ground no longer tilts or runs out. The lean spring is then the only thing left in
 * the roll signal, which is the whole point.
 */
const SEED = 20260726;
const spawn = findSpawn(SEED);

/** A real surface record from the real world, with the ground made level and endlessly on-road. */
const realTerrain = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
const TEMPLATE = { ...realTerrain.surface(spawn.x, spawn.z) };
const flat = {
  surface(x, z, out = null) {
    const o = out || {};
    Object.assign(o, TEMPLATE);
    o.y = 0;
    o.nx = 0;
    o.ny = 1;
    o.nz = 0;
    o.onRoad = 1;
    o.roadDist = 0;
    o.grip = 1;
    o.rough = 0;
    o.surfaceKind = 'tarmac';
    return o;
  },
};

/**
 * Swing it, straighten up, and record the roll for the seconds that follow.
 *
 * @param {string} id fleet id
 * @returns {{crossings:number, peakDeg:number, settleS:number, kph:number}}
 */
function swingAndRelease(id) {
  const entry = FLEET.find((c) => c.id === id);
  if (!entry) throw new Error(`no such vehicle: ${id}`);
  applyCarFeel(entry); // this is what writes the vehicle's body-roll numbers into BODY
  const car = new Vehicle({
    tier: entry.tier,
    terrain: flat,
    preset: entry.feel.assist === 'off' ? 'off' : 'sport',
  });
  car.placeAt(0, 0, 0);

  /* DRIVEN BY HAND, gently, and the autopilot is not involved.
   *
   * Two earlier attempts are recorded here because each one measured something other than the
   * vehicle. Driving hard from a standing start (full throttle, then 0.6 of lock) put all three
   * into the scenery inside two seconds — they finished at 0-2 km/h and what that measures is the
   * ground beside the road. Letting the autopilot drive and adding a steering pulse on top measured
   * the AUTOPILOT: it is a lane-holding controller, so it immediately counter-steers the pulse away
   * and every vehicle leant about a degine and a half regardless of its damping.
   *
   * A modest input, held briefly, from a rolling start does neither: enough lateral load to make the
   * body lean properly, little enough that the vehicle is still in its lane when the wheel comes
   * back to centre and the ringing can be counted.
   */
  const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
  const drive = (steer, throttle, secs) => {
    const n = Math.round(secs / PHYSICS_DT);
    const out = [];
    for (let i = 0; i < n; i++) {
      car._step(PHYSICS_DT, { ...NEUTRAL, steer, throttle, analogue: true });
      out.push(car.roll);
    }
    return out;
  };

  drive(0, 0.55, 5.0); // a rolling start, not a launch
  const turn = drive(0.35, 0.35, 1.0); // the swing: a turn a player takes, held one second
  const after = drive(0, 0.35, 2.5); // wheel back to centre — from here it is the body on its own

  /* Zero crossings of the ROLL ITSELF (not its rate) after release: each one is the body passing
   * back through upright, which is one swing of a wobble. A settled body does this once. */
  let crossings = 0;
  let peak = 0;
  /* 0, not the full window: a body that never leaves upright at all has settled from the first
   * sample, and initialising to the window length reported the calmest vehicle as the twitchiest. */
  let settle = 0;
  const SETTLED = (0.25 * Math.PI) / 180; // a quarter of a degree is not a wobble
  for (let i = 1; i < after.length; i++) {
    if (after[i - 1] < 0 !== after[i] < 0) crossings++;
    peak = Math.max(peak, Math.abs(after[i]));
  }
  for (let i = after.length - 1; i > 0; i--) {
    if (Math.abs(after[i]) > SETTLED) {
      settle = i * PHYSICS_DT;
      break;
    }
  }
  return { turnPeakDeg: Math.max(...turn.map(Math.abs)) * DEG, latG: car.latAccel ?? car._loadLat ?? 0, yaw: car.yawRate ?? 0, crossings, peakDeg: peak * DEG, settleS: settle, kph: car.kph, rolled: !!car.rolled };
}

console.log('── swing hard, centre the steering, count the swings that follow ────────');
let fail = 0;
const rows = [];
for (const id of ['scooter', 'hatch', 'sports', 'pickup']) {
  if (!FLEET.some((c) => c.id === id)) continue;
  const r = swingAndRelease(id);
  rows.push({ id, ...r, zeta: BODY.rollZeta, clamp: +(BODY.rollClamp * DEG).toFixed(1) });
}
for (const r of rows)
  console.log(
    `   ${r.id.padEnd(9)} zeta ${String(r.zeta).padEnd(5)} clamp ${String(r.clamp).padEnd(5)}°  ` +
      `lean IN the turn ${r.turnPeakDeg.toFixed(2)}°  latG ${Number(r.latG).toFixed(2)}  yawRate ${Number(r.yaw).toFixed(2)}  swings ${String(r.crossings).padStart(3)}   peak after ${r.peakDeg.toFixed(2)}°   still moving for ${r.settleS.toFixed(2)}s   at ${r.kph.toFixed(0)} km/h`
  );

const scooter = rows.find((r) => r.id === 'scooter');
const cars = rows.filter((r) => r.id !== 'scooter');
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(50)} ${String(got).padStart(12)}   want ${want}`);
  if (!ok) fail++;
};

check(
  rows.every((r) => !r.rolled),
  'nothing fell over taking an ordinary corner',
  rows.filter((r) => r.rolled).map((r) => r.id).join(' ') || 'none did',
  'none'
);
check(scooter.crossings >= 2, 'the scooter keeps swinging after you straighten up', scooter.crossings, '>= 2 swings');
check(
  scooter.crossings > Math.max(...cars.map((c) => c.crossings)),
  'and it swings more than any car does',
  `${scooter.crossings} vs ${Math.max(...cars.map((c) => c.crossings))}`,
  'strictly more'
);
check(
  cars.every((c) => c.crossings <= 1),
  'every car still settles without ringing',
  cars.map((c) => `${c.id}:${c.crossings}`).join(' '),
  'all <= 1'
);
/* THE FREQUENCY BAND, which replaced a "settles last" check that was measuring nothing: on a level
 * surface every vehicle's roll falls under a quarter of a degree at about the same moment, and the
 * three readings landed within 0.2 s of each other. What actually distinguishes a wobble is its
 * RATE. Sixty reversals in two and a half seconds — the first tuning of this vehicle — is a 24 Hz
 * buzz that reads as a broken renderer; nought is a car. "Wobbles left to right" is about a cycle a
 * second, so the swing has to land in a band you can see, and a number outside it in EITHER
 * direction is a failure. */
const WINDOW_S = 2.5;
const hz = scooter.crossings / (2 * WINDOW_S);
check(hz >= 0.3 && hz <= 4, 'and it wobbles at a rate you can actually see', `${hz.toFixed(2)} Hz`, '0.3-4 Hz');
const hatch = rows.find((r) => r.id === 'hatch');
check(
  scooter.peakDeg > hatch.peakDeg * 1.5,
  'it leans harder than the car it is parked beside',
  `${scooter.peakDeg.toFixed(2)}deg vs hatch ${hatch.peakDeg.toFixed(2)}deg`,
  '1.5x the hatch'
);

console.log(`\n${fail === 0 ? ' ALL PASS' : ` ${fail} FAILED`}`);
process.exitCode = fail ? 1 : 0;
