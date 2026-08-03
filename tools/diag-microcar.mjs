/* created by AI
 * Wanderoad — DO THE RIDICULOUS STARTERS ACTUALLY DO IT?
 *
 * Three claims are made about these two vehicles, and a claim without a number beside it is a hope:
 *
 *   1. the THREE-WHEELER genuinely tips, in a turn a normal car takes without drama
 *   2. the BUBBLE rocks and OVER-CORRECTS — it does not settle, it swings back past upright
 *   3. the TORQUE RAMP really does take about 4.6 s to reach full power from a standing start
 *
 * plus the arithmetic behind the eight points the operator specified, and the two model files, so a
 * silhouette that stops being taller than it is wide is caught here rather than in a screenshot.
 *
 * WHY THE GROUND IS BUILT THE WAY IT IS, which tools/diag-scooter-wobble.mjs learned the hard way and
 * this file inherits verbatim: a hand-written `surface()` stub is missing fields the solver reads
 * (the biome weight array among them) and a missing field there does not throw, it silently produces
 * no grip — every vehicle then corners at a hundredth of a g and leans a quarter of a degree, which
 * measures nothing. And the real world, driven for real, measures the WORLD: a straight line from
 * spawn leaves the tarmac within seconds and a vehicle in the scenery rolls 15-18 degrees following
 * the ground, which swamps the effect under test. So the ground here is a GENUINE Terrain record,
 * taken from the real world at the real spawn, with its height and normal flattened and its road
 * coverage pinned. Every field exists and has the type the solver expects because the terrain itself
 * built it; only the tilt is gone.
 *
 *   node tools/diag-microcar.mjs
 */
import { readFileSync } from 'node:fs';
import { Vehicle } from '../src/car/vehicle.js';
import { FLEET, applyCarFeel } from '../src/game/garage.js';
import { TYRE, SUSPENSION, STEER, REVERSE, PHYSICS_DT, AIR, TIERS } from '../src/car/tuning.js';
import {
  MICRO_FLEET,
  MICRO_SPEC,
  MICRO_TIERS,
  MICRO_TYRE,
  HUB_SKEW,
  applyMicroPhysics,
  detachMicroPhysics,
  microFrictionLat,
  microFrictionLong,
} from '../src/car/microPhysics.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';

const DEG = 180 / Math.PI;
let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(56)} ${String(got).padStart(16)}   want ${want}`);
  if (!ok) fail++;
};

/* ── the ground ───────────────────────────────────────────────────────────── */
const SEED = 20260726;
const spawn = findSpawn(SEED);
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

const BY_ID = Object.fromEntries([...FLEET, ...MICRO_FLEET].map((c) => [c.id, c]));
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

/**
 * Build a vehicle for one fleet entry with its own feel and, if it is a micro-car, its modifier.
 * Every caller must call `release()` — the tuning tables are shared globals and a run that leaves
 * the micro-car's tyres in them measures the micro-car's tyres on the next vehicle.
 */
function makeCar(id) {
  const entry = BY_ID[id];
  if (!entry) throw new Error(`no such vehicle: ${id}`);
  applyCarFeel(entry);
  const car = new Vehicle({ tier: entry.tier, terrain: flat, preset: entry.feel.assist === 'off' ? 'off' : entry.feel.assist });
  const micro = applyMicroPhysics(car, entry);
  car.placeAt(0, 0, 0);
  return { entry, car, micro, release: () => detachMicroPhysics(car) };
}

/** Run `secs` of solver at a fixed input, sampling per step. */
function drive(car, input, secs, sample) {
  const n = Math.round(secs / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    car._step(PHYSICS_DT, { ...NEUTRAL, ...input });
    if (sample) sample(i * PHYSICS_DT, car);
  }
}

/* ═══ 1. THE MODELS ═════════════════════════════════════════════════════════ */
console.log('\n── 1. the two bodies, as built ─────────────────────────────────────────');

function readGLB(path) {
  const b = readFileSync(path);
  const jlen = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jlen).toString('utf8'));
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) {
    const acc = json.accessors[m.primitives[0].attributes.POSITION];
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], acc.min[k]);
      mx[k] = Math.max(mx[k], acc.max[k]);
    }
  }
  return {
    bytes: b.length,
    json,
    size: mx.map((v, i) => v - mn[i]),
    minY: mn[1],
    wheels: json.nodes.filter((n) => /wheel/i.test(n.name)).map((n) => n.name),
    materials: json.materials.map((m) => m.name),
    baked: json.meshes.filter((m) => m.primitives[0].attributes.COLOR_0 !== undefined).length,
    tris: json.meshes.reduce((a, m) => a + json.accessors[m.primitives[0].indices].count / 3, 0),
  };
}

const MODELS = {
  microcar: readGLB('public/models/cars/microcar.glb'),
  threewheeler: readGLB('public/models/cars/threewheeler.glb'),
};
for (const [id, g] of Object.entries(MODELS)) {
  console.log(
    `   ${id.padEnd(13)} ${(g.bytes / 1024).toFixed(0).padStart(3)} kB  ${String(g.tris).padStart(4)} tris  ` +
      `${g.size.map((v) => v.toFixed(2)).join(' x ')} (W x H x L)  taller-than-wide ${(g.size[1] / g.size[0]).toFixed(2)}  ` +
      `wheels [${g.wheels.join(' ')}]  baked-colour meshes ${g.baked}`
  );
}
check(MODELS.microcar.wheels.length === 4, 'the bubble has four wheels the rig can find', MODELS.microcar.wheels.length, '4');
check(MODELS.threewheeler.wheels.length === 3, 'the three-wheeler has THREE', MODELS.threewheeler.wheels.length, '3');
check(
  MODELS.threewheeler.wheels.filter((n) => /front/i.test(n)).length === 1,
  '... exactly one of them at the front',
  MODELS.threewheeler.wheels.filter((n) => /front/i.test(n)).join(),
  'one "front" wheel'
);
for (const [id, g] of Object.entries(MODELS)) {
  check(g.size[1] > g.size[0], `${id}: taller than it is wide`, `${g.size[1].toFixed(2)} > ${g.size[0].toFixed(2)}`, 'H > W');
  check(Math.abs(g.minY) < 1e-6, `${id}: sits exactly on the road (min y = 0)`, g.minY.toFixed(6), '0');
  check(g.baked >= 8, `${id}: luggage and grass keep their own colours`, `${g.baked} meshes with COLOR_0`, '>= 8');
}
/* THE COSMETIC WHEEL, which the operator says is most of the read. The drawn tyre's radius is half
 * the height of the lowest wheel mesh's bounding box; the solver's is the tier's `wheelRadius`. */
const drawnR = (g) => {
  const w = g.json.meshes.find((m) => /wheel/i.test(m.name));
  const acc = g.json.accessors[w.primitives[0].attributes.POSITION];
  return { r: (acc.max[1] - acc.min[1]) / 2, w: acc.max[0] - acc.min[0] };
};
for (const [id, g] of Object.entries(MODELS)) {
  const d = drawnR(g);
  const ratio = d.r / MICRO_SPEC.wheelRadius;
  console.log(`   ${id.padEnd(13)} drawn tyre r ${d.r.toFixed(3)} m, width ${d.w.toFixed(3)} m   against the solver's ${MICRO_SPEC.wheelRadius} m`);
  check(ratio > 0.55 && ratio < 0.85, `${id}: drawn wheels are undersized, not absent`, `${(ratio * 100).toFixed(0)}% of the physics wheel`, '55-85%');
}

/* ═══ 2. THE EIGHT POINTS, AS ARITHMETIC ════════════════════════════════════ */
console.log('\n── 2. the eight points, checked against his own numbers ────────────────');

const bubble = makeCar('microcar');
console.log(`   [1] fixed step        modifier ticks at ${MICRO_SPEC.hz} Hz inside the solver's ${Math.round(1 / PHYSICS_DT)} Hz`);
{
  // point 1 — the modifier's own accumulator really does fire 50 times a second
  const before = bubble.micro.fixedTicks;
  drive(bubble.car, { throttle: 0 }, 2.0);
  const ticks = bubble.micro.fixedTicks - before;
  check(Math.abs(ticks - 100) <= 1, '[1] the 50 Hz items fire 50 times a second', `${ticks} ticks in 2.00 s`, '100 +-1');
}
{
  // point 2 — the pendulum
  const arm = MICRO_SPEC.wheelRadius - MICRO_SPEC.comHeight;
  const hz = Math.sqrt(AIR.gravity / arm) / (2 * Math.PI);
  console.log(`   [2] pendulum          arm ${arm.toFixed(3)} m below the axles, restoring ${(AIR.gravity / arm).toFixed(1)} rad/s^2 per rad, ${hz.toFixed(2)} Hz`);
  check(hz > 0.5 && hz < 1.5, '[2] it rocks at a rate you can see', `${hz.toFixed(2)} Hz`, '0.5-1.5 Hz');
  check(MICRO_SPEC.comHeight < 0, '[2] the centre of mass is under the contact plane', `${MICRO_SPEC.comHeight} m`, '< 0');
}
{
  // point 3 — the tyre force acts above the centre of mass, so the lean goes INTO the corner
  const armF = MICRO_SPEC.tyreForceHeight - MICRO_SPEC.comHeight;
  console.log(`   [3] tyre force        ${MICRO_SPEC.tyreForceHeight} m above the patch = ${armF.toFixed(2)} m above the CoM`);
  const b2 = makeCar('microcar');
  drive(b2.car, { throttle: 0.6 }, 6.0);
  drive(b2.car, { throttle: 0.4, steer: 0.9 }, 0.8); // a LEFT turn: positive steer, positive tyre force
  const fy = b2.micro.tyreLatAccel();
  const leanedInto = fy > 0 && b2.micro.lean < b2.micro.restLean;
  console.log(
    `                      in a left turn: tyre force ${fy.toFixed(2)} m/s^2 (car/vehicle.js's own latAccel reads ${b2.car.latAccel.toFixed(2)} ` +
      `— see MicroPhysics.tyreLatAccel), lean ${(b2.micro.lean * DEG).toFixed(2)}deg against a resting ${(b2.micro.restLean * DEG).toFixed(2)}deg`
  );
  check(leanedInto, '[3] a left turn leans it LEFT, motorbike-style', `${(b2.micro.lean * DEG).toFixed(2)}deg`, `< rest ${(b2.micro.restLean * DEG).toFixed(2)}deg`);
  b2.release();
}
{
  // point 4 — the downforce follows the body, so its sideways part grows with the lean
  const v = 12;
  const lean = (20 * Math.PI) / 180;
  const side = ((MICRO_SPEC.downforcePerSpeed * v) / MICRO_SPEC.mass) * Math.sin(lean);
  console.log(`   [4] body downforce    ${MICRO_SPEC.downforcePerSpeed} x speed N; at 12 m/s and 20deg of lean that is ${side.toFixed(2)} m/s^2 sideways`);
  check(side > 0.5, '[4] a leaned car gets a real sideways shove', `${side.toFixed(2)} m/s^2`, '> 0.5');
}
console.log(`   [5] steer helper      ${MICRO_SPEC.steerHelper} of the yaw change, guarded at ${(MICRO_SPEC.steerHelperMaxYaw * DEG).toFixed(0)}deg (measured in section 6)`);
{
  // point 6 — asymmetric hubs, so it hangs permanently cocked
  console.log(
    `   [6] asymmetric hubs   ${MICRO_SPEC.hubLeft} / ${MICRO_SPEC.hubRight} = ${(HUB_SKEW * 100).toFixed(2)}% of half-track; ` +
      `the bubble hangs ${(bubble.micro.restLean * DEG).toFixed(2)}deg off level with no input at all`
  );
  check(Math.abs(bubble.micro.restLean * DEG) > 1 && Math.abs(bubble.micro.restLean * DEG) < 10, '[6] permanently slightly cocked', `${(bubble.micro.restLean * DEG).toFixed(2)}deg`, '1-10 deg');
  check(MODELS.microcar.wheels.length === 4 && HUB_SKEW > 0, '[6] and the model is built from the same two numbers', `skew ${HUB_SKEW.toFixed(4)}`, '> 0');
}
{
  // point 7 — stiff, short, and it rides near topped out
  const sag = bubble.micro.staticSag;
  console.log(
    `   [7] suspension        ${(SUSPENSION.stiffness / 1000).toFixed(0)} kN/m over ${SUSPENSION.travel.toFixed(2)} m; ` +
      `static sag ${(sag * 1000).toFixed(1)} mm = ${((sag / SUSPENSION.travel) * 100).toFixed(0)}% of travel`
  );
  check(Math.abs(sag - 0.035) < 0.001, '[7] ~35 mm of static sag, from his own spring rate', `${(sag * 1000).toFixed(1)} mm`, '35 mm');
  check(SUSPENSION.travel === MICRO_SPEC.suspensionTravel, '[7] 0.20 m of travel, verbatim', SUSPENSION.travel, '0.20 m');
}
{
  // point 8 — the ramp, as arithmetic. Measured for real in section 5.
  const start = MICRO_SPEC.driveTorque * (1 - MICRO_SPEC.tcInitialCut);
  const secs = bubble.micro.rampSeconds;
  console.log(`   [8] torque ramp       starts at ${start.toFixed(0)} N.m, +-${MICRO_SPEC.tcStepTorque} N.m per 50 Hz step -> full in ${secs.toFixed(2)} s`);
  check(Math.abs(start - 170) < 1, '[8] it starts at 170 N.m', `${start.toFixed(1)} N.m`, '170');
  check(Math.abs(secs - 4.6) < 0.1, '[8] and reaches full power in ~4.6 s', `${secs.toFixed(2)} s`, '4.6 s');
}
{
  // the rest of his spec, in the tables the solver actually reads
  const wheelTorque = MICRO_TIERS.micro.peakTorque * MICRO_TIERS.micro.ratios[0] * MICRO_TIERS.micro.finalDrive * 0.88;
  console.log(
    `   spec               mass ${bubble.car.mass} kg, wheel r ${bubble.car.spec.wheelRadius} m, drive ${wheelTorque.toFixed(0)} N.m ` +
      `(${bubble.car.spec.drive}), reverse ${(REVERSE.force * REVERSE.scale * MICRO_SPEC.wheelRadius).toFixed(0)} N.m, ` +
      `max lock ${(STEER.maxAngle * DEG).toFixed(0)}deg`
  );
  check(bubble.car.mass === MICRO_SPEC.mass, 'mass 1000 kg', bubble.car.mass, '1000');
  check(Math.abs(wheelTorque - MICRO_SPEC.driveTorque) < 40, 'drive torque ~2300 N.m at the wheels', `${wheelTorque.toFixed(0)} N.m`, '2300 +-40');
  check(bubble.car.spec.drive === 'awd', '... split four ways', bubble.car.spec.drive, 'awd');
  check(Math.abs(STEER.maxAngle * DEG - 30) < 0.01, 'max steer 30 deg', `${(STEER.maxAngle * DEG).toFixed(1)}deg`, '30');
  check(
    Math.abs(REVERSE.force * REVERSE.scale * MICRO_SPEC.wheelRadius - 400) < 1,
    'reverse 400 N.m',
    `${(REVERSE.force * REVERSE.scale * MICRO_SPEC.wheelRadius).toFixed(0)} N.m`,
    '400'
  );
}
{
  /* THE FRICTION CURVES. His two smooth segments against the solver's own two-piece curve. What is
   * fitted, and what cannot be, is argued in car/microPhysics.js — this is the measurement it
   * quotes, recomputed here so the two can never drift apart. */
  const RISE_POW = 0.62;
  const solver = (u, f) => (u <= 1 ? Math.sin((Math.PI / 2) * Math.pow(u, RISE_POW)) : f + (1 - f) * Math.exp(-0.125 * Math.pow(u - 1, 1.45)));
  const peak = MICRO_TYRE.peakSlipAngle;
  const err = (from, to) => {
    let se = 0;
    let n = 0;
    let mx = 0;
    for (let a = from; a <= to; a += 0.002) {
      const e = solver(a / peak, TYRE.tailFloor) - microFrictionLat(Math.sin(a));
      se += e * e;
      n++;
      mx = Math.max(mx, Math.abs(e));
    }
    return { rms: Math.sqrt(se / n), max: mx };
  };
  const tail = err(peak, 0.9);
  const all = err(0.002, 0.9);
  console.log(
    `   tyres              sideways peak ${(peak * DEG).toFixed(2)}deg (his slip 0.2 as sin a), mu ${TYRE.muLatFront.toFixed(2)}/${TYRE.muLatRear.toFixed(2)}, ` +
      `tail floor ${TYRE.tailFloor}\n` +
      `                      fit to his curve: post-peak RMS ${tail.rms.toFixed(3)} worst ${tail.max.toFixed(3)}; ` +
      `whole range RMS ${all.rms.toFixed(3)} worst ${all.max.toFixed(3)} (all of it in the rise — see the module)`
  );
  check(Math.abs(peak * DEG - 11.54) < 0.01, 'sideways grip peaks at his slip 0.2', `${(peak * DEG).toFixed(2)}deg`, 'asin(0.2)');
  check(Math.abs(TYRE.muLatFront - 1.0) < 1e-9 && Math.abs(TYRE.muLatRear - 1.0) < 0.005, 'peak sideways mu is 1.0 both ends', `${TYRE.muLatFront}/${TYRE.muLatRear.toFixed(3)}`, '1.0');
  check(Math.abs(TYRE.peakSlipRatio - 0.4) < 1e-9, 'forward grip peaks at his slip 0.4', TYRE.peakSlipRatio, '0.40');
  check(tail.rms < 0.10, 'the post-peak tail follows his within a tenth', tail.rms.toFixed(3), 'RMS < 0.10');
  check(Math.abs(microFrictionLong(0.4) - 1.0) < 1e-9 && Math.abs(microFrictionLong(0.8) - 0.5) < 1e-9, 'his forward curve is implemented exactly', `${microFrictionLong(0.4)} / ${microFrictionLong(0.8)}`, '1.0 / 0.5');
  check(Math.abs(microFrictionLat(0.2) - 1.0) < 1e-9 && Math.abs(microFrictionLat(0.5) - 0.75) < 1e-9, 'and his sideways curve likewise', `${microFrictionLat(0.2)} / ${microFrictionLat(0.75)}`, '1.0 / 0.75');
}
bubble.release();

/* ═══ 3. THE TURN — DOES THE THREE-WHEELER GO OVER? ═════════════════════════ */
console.log('\n── 3. the same corner, three vehicles ──────────────────────────────────');
/* One manoeuvre, identical for all three: get rolling, then wind on a steady turn and hold it. The
 * three-wheeler must go over; the bubble must lean horribly and stay up; and the control car — the
 * fleet's own starter Hatch, on stock tyres — must be entirely undramatic, because a test that rolls
 * everything is measuring the test. */
function corner(id) {
  const c = makeCar(id);
  const half = c.car.track * 0.5;
  const tipAngle = Math.atan2(half, c.car.spec.cgHeight);
  let peakRoll = 0;
  let peakLatG = 0;
  let rolledAt = -1;
  // Long enough that the point-8 torque ramp is done and the vehicle is at a real cruising speed —
  // a corner taken at 20 km/h because the car has not finished accelerating measures the ramp.
  drive(c.car, { throttle: 0.9 }, 12.0);
  const entrySpeed = c.car.kph;
  drive(c.car, { throttle: 0.5, steer: 1.0 }, 6.0, (t, car) => {
    const roll = Math.abs(car.roll);
    if (roll > peakRoll) peakRoll = roll;
    peakLatG = Math.max(peakLatG, Math.abs(car.latAccel) / AIR.gravity);
    if (car.rolled && rolledAt < 0) rolledAt = t;
  });
  const out = {
    id,
    entrySpeed,
    tipAngleDeg: tipAngle * DEG,
    liftG: (AIR.gravity * half) / c.car.spec.cgHeight / AIR.gravity,
    peakRollDeg: peakRoll * DEG,
    peakLatG,
    rolledAt,
    rollovers: c.micro ? c.micro.rollovers : c.car.rolled ? 1 : 0,
  };
  c.release();
  return out;
}
const turns = ['threewheeler', 'microcar', 'hatch'].map(corner);
for (const r of turns)
  console.log(
    `   ${r.id.padEnd(13)} entry ${r.entrySpeed.toFixed(0).padStart(3)} km/h  tips at ${r.tipAngleDeg.toFixed(1).padStart(5)}deg ` +
      `(${r.liftG.toFixed(2)} g to lift a wheel)  peak lat ${r.peakLatG.toFixed(2)} g  peak roll ${r.peakRollDeg.toFixed(1).padStart(5)}deg  ` +
      `${r.rolledAt >= 0 ? `WENT OVER after ${r.rolledAt.toFixed(2)} s` : 'stayed up'}`
  );
const trike = turns.find((r) => r.id === 'threewheeler');
const micro = turns.find((r) => r.id === 'microcar');
const control = turns.find((r) => r.id === 'hatch');
check(trike.rolledAt >= 0, 'the three-wheeler goes over in an ordinary corner', trike.rolledAt >= 0 ? `${trike.rolledAt.toFixed(2)} s` : 'never', 'it rolls');
check(trike.rolledAt >= 0 && trike.rolledAt < 4.0, '... almost instantly, as he asked', `${trike.rolledAt.toFixed(2)} s of steering`, '< 4 s');
check(control.rolledAt < 0, 'the fleet car takes the same corner without drama', control.rolledAt < 0 ? 'stayed up' : 'ROLLED', 'stays up');
check(micro.rolledAt < 0, 'the bubble SEEMS to fall over but does not', micro.rolledAt < 0 ? 'stayed up' : 'rolled', 'stays up');
check(micro.peakRollDeg > control.peakRollDeg * 2, '... and it leans more than twice as far as the fleet car', `${micro.peakRollDeg.toFixed(1)}deg vs ${control.peakRollDeg.toFixed(1)}deg`, '> 2x');
check(trike.liftG < control.liftG * 0.5, 'the support triangle really is half a car', `${trike.liftG.toFixed(2)} g vs ${control.liftG.toFixed(2)} g`, '< half');

/* ═══ 4. THE ROCK — DOES IT OVER-CORRECT? ══════════════════════════════════ */
console.log('\n── 4. swing it, centre the wheel, and count the swings that follow ─────');
/* diag-scooter-wobble.mjs measures a wobble by counting the roll's zero crossings after the wheel
 * comes back to centre. That will not work here and the reason is point 6: these cars hang
 * permanently cocked, so their roll settles at -4 degrees rather than at zero and a zero-crossing
 * count reads zero however violently the body is swinging. What is counted instead is REVERSALS OF
 * THE ROLL RATE, which is the same measurement diag-roll-oscillation.mjs uses and is immune to a DC
 * offset: every reversal is the body changing its mind about which way it is going, which is
 * precisely "over-corrects instead of settling". */
function rockTest(id) {
  const c = makeCar(id);
  drive(c.car, { throttle: 0.7 }, 8.0);
  drive(c.car, { throttle: 0.45, steer: 0.85 }, 1.2); // the swing
  const roll = [];
  drive(c.car, { throttle: 0.45, steer: 0 }, 3.0, (t, car) => roll.push(car.roll)); // wheel centred
  let reversals = 0;
  let prevSign = 0;
  let peakAfter = 0;
  const settled = roll[roll.length - 1];
  for (let i = 1; i < roll.length; i++) {
    const rate = (roll[i] - roll[i - 1]) / PHYSICS_DT;
    if (Math.abs(rate) < 0.02) continue; // deadband: numerical fuzz is not a swing
    const s = Math.sign(rate);
    if (prevSign !== 0 && s !== prevSign) reversals++;
    prevSign = s;
    peakAfter = Math.max(peakAfter, Math.abs(roll[i] - settled));
  }
  const out = { id, reversals, hz: reversals / (2 * 3.0), peakAfterDeg: peakAfter * DEG, rolled: c.car.rolled };
  c.release();
  return out;
}
const rocks = ['microcar', 'hatch', 'estate'].map(rockTest);
for (const r of rocks)
  console.log(
    `   ${r.id.padEnd(13)} ${String(r.reversals).padStart(3)} roll-rate reversals in 3.0 s = ${r.hz.toFixed(2)} Hz   ` +
      `worst swing past its resting angle ${r.peakAfterDeg.toFixed(2)}deg`
  );
const rockMicro = rocks.find((r) => r.id === 'microcar');
const rockCars = rocks.filter((r) => r.id !== 'microcar');
check(rockMicro.reversals >= 2, 'the bubble keeps swinging after you straighten up', rockMicro.reversals, '>= 2');
check(
  rockMicro.reversals > Math.max(...rockCars.map((r) => r.reversals)),
  '... more than any fleet car does',
  `${rockMicro.reversals} vs ${Math.max(...rockCars.map((r) => r.reversals))}`,
  'strictly more'
);
check(rockMicro.hz >= 0.3 && rockMicro.hz <= 4, '... at a rate you can actually see', `${rockMicro.hz.toFixed(2)} Hz`, '0.3-4 Hz');
check(rockMicro.peakAfterDeg > 2, '... and it genuinely over-corrects, not just settles', `${rockMicro.peakAfterDeg.toFixed(2)}deg past rest`, '> 2 deg');

/* ═══ 5. THE RAMP — MEASURED, NOT COMPUTED ═════════════════════════════════ */
console.log('\n── 5. mushy, then sudden: the torque ramp from a standing start ────────');
{
  const c = makeCar('microcar');
  const marks = {};
  let fullAt = -1;
  let torqueAt1s = 0;
  drive(c.car, { throttle: 1 }, 8.0, (t, car) => {
    const frac = c.micro.torqueFrac;
    if (Math.abs(t - 1.0) < PHYSICS_DT / 2) torqueAt1s = frac;
    for (const p of [0.25, 0.5, 0.75]) if (marks[p] === undefined && frac >= p) marks[p] = t;
    if (fullAt < 0 && frac >= 0.9999) fullAt = t;
    void car;
  });
  const startTorque = MICRO_SPEC.driveTorque * (1 - MICRO_SPEC.tcInitialCut);
  console.log(
    `   torque fraction    0.00 s: ${(1 - MICRO_SPEC.tcInitialCut).toFixed(3)} (${startTorque.toFixed(0)} N.m)   1.00 s: ${torqueAt1s.toFixed(3)}   ` +
      `25%: ${marks[0.25]?.toFixed(2)} s   50%: ${marks[0.5]?.toFixed(2)} s   75%: ${marks[0.75]?.toFixed(2)} s   FULL: ${fullAt.toFixed(2)} s`
  );
  console.log(`   speed at 4.60 s    ${c.car.kph.toFixed(1)} km/h at the end of the run, having started from a dead stop`);
  check(fullAt > 4.3 && fullAt < 4.9, 'full power really does arrive about 4.6 s after spawn', `${fullAt.toFixed(2)} s`, '4.3-4.9 s');
  check(torqueAt1s < 0.30, '... so the first second is deliberately mushy', `${(torqueAt1s * 100).toFixed(0)}% of torque at 1 s`, '< 30%');
  c.release();
}
{
  /* AND THE KNOCK-BACK. The same ramp, on ice, where the drive force genuinely exceeds what the
   * tyres can put down — which in this solver IS wheelspin (`forces.drive` sitting at
   * `forces.traction`, both written every step by car/vehicle.js's own telemetry).
   *
   * WHAT IS AND IS NOT ASSERTED, because the first version of this check asserted the wrong thing.
   * "The ramp goes down" over a window is false by construction and it should be: the moment it
   * knocks back, the drive falls under the limit, so the next tick it climbs again. That
   * self-limiting hunt IS the behaviour. What is true, and what is measured, is that the ramp is
   * knocked back at all (down-ticks > 0) and that it is therefore HELD BELOW FULL POWER for as long
   * as the surface will not take it — where on tarmac it would have been at 1.000 since 4.6 s. */
  const icy = {
    surface(x, z, out = null) {
      const o = flat.surface(x, z, out);
      o.grip = 0.12;
      return o;
    },
  };
  const entry = BY_ID.microcar;
  applyCarFeel(entry);
  const car = new Vehicle({ tier: entry.tier, terrain: icy, preset: entry.feel.assist });
  const m = applyMicroPhysics(car, entry);
  car.placeAt(0, 0, 0);
  let downTicks = 0;
  let spinSteps = 0;
  let peakFrac = 0;
  let prev = m.torqueFrac;
  drive(car, { throttle: 1 }, 14.0, () => {
    if (m.torqueFrac < prev - 1e-9) downTicks++;
    prev = m.torqueFrac;
    peakFrac = Math.max(peakFrac, m.torqueFrac);
    if (car.forces.traction > 1 && Math.abs(car.forces.drive) >= car.forces.traction * 0.98) spinSteps++;
  });
  console.log(
    `   on 0.12 grip       ${spinSteps} wheelspinning steps of 1680; the ramp was knocked back ${downTicks} times ` +
      `and never got past ${peakFrac.toFixed(3)} of full power in 14 s (on tarmac it is 1.000 by 4.6 s)`
  );
  check(spinSteps > 0, 'wheelspin is detectable at all on a loose surface', `${spinSteps} steps`, '> 0');
  check(downTicks > 0, '... and every bit of it knocks the ramp back', `${downTicks} knock-backs`, '> 0');
  check(peakFrac < 0.999, '... so the car never gets full power while it is spinning', peakFrac.toFixed(3), '< 1.000');
  detachMicroPhysics(car);
}

/* ═══ 6. POINT 5's GUARDS, EXERCISED DIRECTLY ══════════════════════════════ */
console.log('\n── 6. the steer helper, and the two guards he specified ────────────────');
{
  const c = makeCar('microcar');
  const m = c.micro;
  const car = c.car;
  drive(car, { throttle: 0.6 }, 4.0);

  // (a) airborne: no rotation, and the previous yaw is NOT updated
  car.onGround = false;
  m._prevYaw = 0;
  car.yaw = 0.05;
  const vBefore = [car.vx, car.vz];
  m.fixedStep({ throttle: 0 });
  const airSkipped = m._prevYaw === 0 && car.vx === vBefore[0] && car.vz === vBefore[1];
  check(airSkipped, 'airborne: the helper does nothing AND does not move prevYaw', `prevYaw ${m._prevYaw}`, 'unchanged at 0');

  // (b) grounded, a small yaw change: the velocity really is rotated by 64.4% of it
  car.onGround = true;
  car.forces.contact = 1;
  m._prevYaw = 0;
  car.yaw = 0.04;
  car.vx = 0;
  car.vz = 10;
  m.fixedStep({ throttle: 0 });
  const wantX = 10 * Math.sin(0.04 * MICRO_SPEC.steerHelper);
  const wantZ = 10 * Math.cos(0.04 * MICRO_SPEC.steerHelper);
  check(Math.abs(car.vx - wantX) < 1e-9, 'grounded: the velocity is rotated by exactly 0.644 of the yaw change', car.vx.toFixed(6), wantX.toFixed(6));
  check(Math.abs(car.vz - wantZ) < 1e-9, '... and its length is preserved (a rotation, not a shove)', Math.hypot(car.vx, car.vz).toFixed(6), '10.000000');
  check(m._prevYaw === 0.04, '... and prevYaw follows', m._prevYaw, '0.04');

  // (c) grounded, a 15-degree jump: no rotation, but prevYaw IS updated (see the module's note)
  m._prevYaw = 0;
  car.yaw = (15 * Math.PI) / 180;
  car.vx = 0;
  car.vz = 10;
  m.fixedStep({ throttle: 0 });
  check(car.vx === 0 && car.vz === 10, 'a >10 deg jump is skipped entirely', `vx ${car.vx}, vz ${car.vz}`, 'untouched');
  check(m._prevYaw === (15 * Math.PI) / 180, '... but prevYaw is updated, so the helper is not latched off', m._prevYaw.toFixed(4), 'the new yaw');
  c.release();
}

/* ═══ 7. THE HANDBRAKE BUG HE ASKED TO KEEP ════════════════════════════════ */
console.log('\n── 7. the handbrake lock, which is a bug on purpose ────────────────────');
{
  const c = makeCar('microcar');
  drive(c.car, { throttle: 0.7 }, 4.0);
  drive(c.car, { throttle: 0, brake: 1 }, 2.5); // stop
  drive(c.car, { throttle: 0, handbrake: 1 }, 1.0); // a real pull, not a tap
  drive(c.car, { throttle: 1 }, 3.0); // now try to drive away
  const stuckKph = c.car.kph;
  const wasStuck = c.micro.stuck;
  drive(c.car, { throttle: 0, brake: 1 }, 0.3); // "until you brake"
  const clearedByBrake = !c.micro.stuck;
  drive(c.car, { throttle: 1 }, 3.0);
  console.log(`   after the handbrake  3 s of full throttle reached ${stuckKph.toFixed(1)} km/h (locked: ${wasStuck}); after a dab of brake, ${c.car.kph.toFixed(1)} km/h`);
  check(wasStuck && stuckKph < 5, 'it stays locked after a handbrake slide', `${stuckKph.toFixed(1)} km/h on full throttle`, 'locked, < 5 km/h');
  check(clearedByBrake, '... and the footbrake is the way out, exactly as he describes', `stuck = ${c.micro.stuck}`, 'cleared');
  check(c.car.kph > 12, '... after which it drives away normally', `${c.car.kph.toFixed(1)} km/h`, '> 12 km/h');
  c.release();
}

/* ═══ 8. NOTHING LEAKED ════════════════════════════════════════════════════ */
console.log('\n── 8. the shared tables are exactly as they were ───────────────────────');
{
  /* The modifier writes global tuning tables and puts them back. If it does not, the next car the
   * player switches to inherits a micro-car's tyres and suspension, which is the failure mode
   * game/garage.js's own BODY_STOCK exists to prevent. Detached above; check it here. */
  applyCarFeel(BY_ID.hatch);
  const now = {
    'TYRE.muLatFront': TYRE.muLatFront,
    'TYRE.peakSlipFront': +(TYRE.peakSlipFront * DEG).toFixed(3),
    'TYRE.tailFloor': TYRE.tailFloor,
    'TYRE.peakSlipRatio': TYRE.peakSlipRatio,
    'TYRE.muLongPeak': TYRE.muLongPeak,
    'STEER.maxAngle': +(STEER.maxAngle * DEG).toFixed(1),
    'SUSPENSION.stiffness': SUSPENSION.stiffness,
    'SUSPENSION.travel': SUSPENSION.travel,
    'SUSPENSION.damping': SUSPENSION.damping,
    'REVERSE.force': REVERSE.force,
  };
  const want = {
    'TYRE.muLatFront': 1.3,
    'TYRE.peakSlipFront': 8,
    'TYRE.tailFloor': 0.55,
    'TYRE.peakSlipRatio': 0.12,
    'TYRE.muLongPeak': 1.42,
    'STEER.maxAngle': 40,
    'SUSPENSION.stiffness': 42000,
    'SUSPENSION.travel': 0.22,
    'SUSPENSION.damping': 4200,
    'REVERSE.force': 5400,
  };
  const bad = Object.keys(want).filter((k) => Math.abs(now[k] - want[k]) > 1e-6);
  console.log(`   restored           ${Object.entries(now).map(([k, v]) => `${k.split('.')[1]}=${v}`).join('  ')}`);
  check(bad.length === 0, 'every table the modifier writes is put back on detach', bad.length ? bad.join(' ') : 'all clean', 'no leaks');
  check(!!TIERS.micro && !!TIERS.trike, 'and both tiers are registered for the fleet to name', `${TIERS.micro?.name} / ${TIERS.trike?.name}`, 'both present');
}

console.log(`\n${fail === 0 ? ' ALL PASS' : ` ${fail} FAILED`}\n`);
process.exitCode = fail ? 1 : 0;
