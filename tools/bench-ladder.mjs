/* created by AI
 * Cozy Driver — WHAT EACH CAR IN THE LADDER CAN ACTUALLY DO.
 *
 * The operator has asked for three things across three messages, and they are one question:
 *
 *   "skooter should be default car" / "bubble drives just how skooter should"   (B85)
 *   "make the bubble the second default, so first scooter then bubble ... that way you have the
 *    funnest cars first"                                                        (F59)
 *   "tall mountains that have a reasonably high slope are not climbable by the starter cars. It
 *    forces you to unlock new cars to unlock new biomes ... maybe the hatch should be able, and
 *    maybe the hatch should be the third car you can unlock, but the scooter and the bubble should
 *    not"                                                                       (F63)
 *
 * and one against them:
 *
 *   "no car should be as slow as 22kmph (gear issue?)"                          (B86)
 *
 * Those last two are only compatible if the gate is DELIBERATE and legible: crawling up a mountain
 * in the scooter is the gate, crawling on ordinary road is the bug. This file measures the numbers
 * that tell them apart, per car, so the ladder can be reordered against evidence rather than
 * against a hunch — and so that the reorder can be checked afterwards.
 *
 * IT IS ALSO THE RISK REGISTER FOR THAT REORDER. A previous attempt to put a micro-car at the
 * bottom of the ladder took tools/browser-test.mjs from 38/40 to 36/40: the tricycle steered the
 * wrong way under D, stopped in 0 m and managed 32 degrees of a required 100. Those are the exact
 * numbers this file reports, so the next attempt can see them before it deploys rather than after.
 *
 *   node tools/bench-ladder.mjs
 *
 * Reports; it does not gate. The bars belong to browser-test, which drives the real game.
 */
import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { FLEET, FLEET_BY_ID, FIRST_CAR, applyCarFeel } from '../src/game/garage.js';

const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
/* The same terrain stub bench-car.mjs uses, and its comment is the one that matters: the solver
 * resolves gravity onto the NORMAL, so a stub without one makes every number NaN. */
const flat = () => ({
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
});
/** A constant slope of `grade` (rise per run) running along +z — the shape a long hill has. The
 *  normal tilts with it, or the car would feel a flat road while climbing a mountain. */
const ramp = (grade) => {
  const l = Math.hypot(grade, 1);
  return {
    surface: (x, z) => ({
      y: z * grade,
      nx: 0,
      ny: 1 / l,
      nz: -grade / l,
      grip: 1,
      rough: 0,
      surfaceKind: 'tarmac',
      onRoad: 1,
      dominant: 0,
    }),
    height: (x, z) => z * grade,
  };
};

/** A car set up exactly as the game sets it up when you select it in the Garage. */
function carFor(id, terrain) {
  const spec = FLEET_BY_ID[id];
  /* 'sport' — the game's own default. The valid names are cruise/sport/off/hardcore; anything else
   * used to spread `undefined` into the assist table and NaN the whole car, which is how this file
   * first reported eleven cars that "never" reached 60 km/h. src/car/vehicle.js now falls back
   * instead, and this passes a real one regardless. */
  const v = new Vehicle({ tier: spec.tier, terrain, preset: 'sport' });
  /* `applyCarFeel` reads the fleet entry off the CAR (`car.feel`) and writes the shared steering
   * and tyre tables — it takes the car, not the spec, and the spec has to be on it first. Same
   * order main.js uses when you pick a car in the Garage. */
  v.feel = spec.feel;
  v.length = spec.length;
  applyCarFeel(v);
  /* A Vehicle is built with no position. Without this every pose is NaN from the first step, and
   * the whole table reads "never" — which looks like eleven broken cars rather than one missing
   * call. bench-car.mjs's own `fresh()` does the same thing for the same reason. */
  v.placeAt(0, 0, 0);
  return v;
}
/* `_step` rather than `update`, exactly as bench-car.mjs drives it: `update` runs the fixed-step
 * accumulator against wall-clock, which a synthetic run has none of. */
const step = (v, secs, input) => {
  const n = Math.round(secs / PHYSICS_DT);
  for (let i = 0; i < n; i++) v._step(PHYSICS_DT, input);
};

/** 0 to 60 km/h on the flat, in seconds — Infinity if it never gets there. */
function zeroTo60(id) {
  const v = carFor(id, flat());
  const input = { ...NEUTRAL, throttle: 1 };
  for (let t = 0; t < 40; t += PHYSICS_DT) {
    v._step(PHYSICS_DT, input);
    if (v.kph >= 60) return t;
  }
  return Infinity;
}

/** Metres to stop from 60 km/h with the brake pinned. */
function brakeFrom60(id) {
  const v = carFor(id, flat());
  step(v, 40, { ...NEUTRAL, throttle: 1 });
  if (v.kph < 55) return null; // never reached the test speed; the number would be a lie
  const x0 = v.x;
  const z0 = v.z;
  for (let t = 0; t < 20; t += PHYSICS_DT) {
    v._step(PHYSICS_DT, { ...NEUTRAL, brake: 1 });
    if (v.kph < 0.5) break;
  }
  return Math.hypot(v.x - x0, v.z - z0);
}

/** Degrees of heading swept in 7 s of full lock from a standing start — browser-test's C3 window. */
function turnIn7s(id) {
  const v = carFor(id, flat());
  const yaw0 = v.yaw;
  step(v, 7, { ...NEUTRAL, throttle: 1, steer: 1 });
  return (Math.abs(v.yaw - yaw0) * 180) / Math.PI;
}

/** Steepest constant grade the car can still be climbing after 12 s, as a percentage. */
function climbLimit(id) {
  let best = 0;
  for (let g = 2; g <= 70; g += 2) {
    const v = carFor(id, ramp(g / 100));
    step(v, 12, { ...NEUTRAL, throttle: 1 });
    if (v.kph > 8) best = g;
    else break;
  }
  return best;
}

/** Speed it settles at on a 20% climb — the number he read off the HUD as "22 kmph". */
function climbSpeed(id, grade = 0.2) {
  const v = carFor(id, ramp(grade));
  step(v, 16, { ...NEUTRAL, throttle: 1 });
  return v.kph;
}

console.log('\nCOZY DRIVER — WHAT EACH CAR CAN DO\n' + '='.repeat(96));
console.log(`the starter today is "${FIRST_CAR}"\n`);
console.log(
  'car'.padEnd(14) +
    'tier'.padEnd(9) +
    '0-60 s'.padStart(8) +
    '60-0 m'.padStart(9) +
    'turn 7s'.padStart(9) +
    'climb %'.padStart(9) +
    'on a 20% hill'.padStart(15),
);
console.log('-'.repeat(96));
const rows = [];
for (const c of FLEET) {
  const r = {
    id: c.id,
    label: c.label || c.id,
    tier: c.tier,
    to60: zeroTo60(c.id),
    brake: brakeFrom60(c.id),
    turn: turnIn7s(c.id),
    climb: climbLimit(c.id),
    hill: climbSpeed(c.id),
  };
  rows.push(r);
  console.log(
    String(r.label).padEnd(14) +
      String(r.tier).padEnd(9) +
      (Number.isFinite(r.to60) ? r.to60.toFixed(1) : 'never').padStart(8) +
      (r.brake === null ? 'n/a' : r.brake.toFixed(1)).padStart(9) +
      `${r.turn.toFixed(0)}째`.padStart(9) +
      `${r.climb}%`.padStart(9) +
      `${r.hill.toFixed(1)} km/h`.padStart(15),
  );
}

/* ── what this means for the ladder he asked for ─────────────────────────── */
console.log('\n── the ladder he asked for: scooter, then bubble, then hatch ──────────────');
const pick = (id) => rows.find((r) => r.id === id);
for (const id of ['scooter', 'microcar', 'hatch']) {
  const r = pick(id);
  if (!r) continue;
  console.log(
    `  ${String(r.label).padEnd(10)} 0-60 ${Number.isFinite(r.to60) ? r.to60.toFixed(1) + ' s' : 'never'}, stops in ${
      r.brake === null ? 'n/a' : r.brake.toFixed(1) + ' m'
    }, sweeps ${r.turn.toFixed(0)}째 in 7 s, climbs up to ${r.climb}%`,
  );
}

/* THE GATE HE WANTS, stated as the numbers that would make it true. */
const sc = pick('scooter');
const bu = pick('microcar');
const ha = pick('hatch');
if (sc && bu && ha) {
  console.log('\n  the gate F63 asks for — the hatch opens country the first two cannot reach:');
  console.log(
    `    scooter ${sc.climb}%, bubble ${bu.climb}%, hatch ${ha.climb}%  ` +
      (ha.climb > bu.climb && ha.climb > sc.climb
        ? '— the hatch already climbs further than both, so the gate exists in the physics'
        : '— NO GAP YET: the hatch does not out-climb them, so there is nothing to unlock'),
  );
}

/* WHAT WOULD BREAK, against browser-test's own C-check windows. Reported, not enforced: those bars
 * belong to the live suite, and the point here is to see them before a deploy rather than after. */
console.log('\n── against browser-test C2/C3, which measure whatever car the game starts in ──');
for (const id of ['scooter', 'microcar', 'threewheeler', 'hatch']) {
  const r = pick(id);
  if (!r) continue;
  const stops = r.brake !== null && r.brake > 0;
  const turns = r.turn > 100;
  console.log(
    `  ${String(r.label).padEnd(13)} C2 stop ${stops ? 'ok' : `WOULD FAIL (${r.brake === null ? 'never reaches 60' : r.brake.toFixed(1) + ' m'})`}` +
      `   C3 turn ${turns ? 'ok' : `WOULD FAIL (${r.turn.toFixed(0)}째 of 100째)`}`,
  );
}
console.log(
  '\n  Those two checks measure the STARTER. If the starter is meant to be comic and slow, the checks\n' +
    '  have to name the car they mean instead of taking whatever is first — which is a change to what\n' +
    '  they ASSERT, not a loosening of it, and it has to be made deliberately rather than to make a\n' +
    '  red suite go green.\n',
);
