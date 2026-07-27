/* Wanderoad — fuel: acceptance measurements.
 *
 *   node tools/bench-fuel.mjs
 *
 * Everything here drives the REAL Vehicle solver with the REAL Fuel module in the loop, in
 * the same order main.js uses (fuel.update, then car.update(fuel.gate(cmd))). Nothing is
 * simulated twice and no rate is asserted against itself.
 *
 * The questions:
 *   - does the car still cruise at the throttle fuel.js was calibrated against
 *   - how many minutes of cruising is a tank, actually
 *   - does the throttle limit REACH THE SOLVER (the "declared but never applied" bug)
 *   - does stopping at a station refill the tank, read out of the model
 *   - is running dry gentle, and is it always recoverable
 *   - does the gauge needle actually move
 *   - is the always-on nearest-station distance/direction honest — a real reading when one
 *     exists, a real "unknown" when it does not, never a stale or fabricated one
 */

import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { Fuel, TANK_SECONDS, CRUISE_V, CRUISE_THROTTLE } from '../src/game/fuel.js';
import { STATION_RADIUS, nearestStation, CAN_FRACTION } from '../src/world/props.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(46)} ${String(got).padStart(12)}   want ${want}`);
};

/* Flat, grippy, endless road: the test is of the fuel model, not of the terrain. Same stub
 * shape tools/bench-car.mjs uses, and the normal matters — without one the solver NaNs. */
const FLAT = {
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0.06, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};

const fresh = (preset = 'cruise') => {
  const c = new Vehicle({ tier: 'touring', terrain: FLAT, preset });
  c.placeAt(0, 0, 0);
  return c;
};

/** Hold a target speed with a PI controller and return the commanded throttle. */
function cruiseController(targetKph) {
  let i = 0;
  return (car, dt) => {
    const err = targetKph - car.kph;
    i = Math.max(-1, Math.min(1, i + err * dt * 0.02));
    return Math.max(0, Math.min(1, err * 0.012 + i));
  };
}

console.log('\n── the cruise the tank is measured against ───────────────────────────────');
{
  const car = fresh();
  const ctl = cruiseController(95);
  let thr = 0;
  let v = 0;
  let n = 0;
  const steps = Math.round(120 / PHYSICS_DT);
  for (let k = 0; k < steps; k++) {
    car._step(PHYSICS_DT, { steer: 0, throttle: ctl(car, PHYSICS_DT), brake: 0, handbrake: 0, analogue: true });
    if (k > steps * 0.6) {
      thr += car.throttle;
      v += Math.abs(car.speed);
      n++;
    }
  }
  thr /= n;
  v /= n;
  console.log(`       a 'cruise'-preset touring car holding 95 km/h settles at throttle ${thr.toFixed(3)}, ${v.toFixed(2)} m/s`);
  check(Math.abs(thr - CRUISE_THROTTLE) < 0.05, 'fuel.js CRUISE_THROTTLE still matches the car', thr.toFixed(3), `${CRUISE_THROTTLE} +- 0.05`);
  check(Math.abs(v - CRUISE_V) < 1.0, 'fuel.js CRUISE_V still matches the car', v.toFixed(2), `${CRUISE_V} +- 1.0`);
}

console.log('\n── minutes per tank ──────────────────────────────────────────────────────');
const results = {};
for (const [label, kph] of [['dawdling  60 km/h', 60], ['cruising  95 km/h', 95], ['pressing 125 km/h', 125], ['flat out (throttle pinned)', -1]]) {
  const car = fresh();
  const fuel = new Fuel({ start: 1 });
  const ctl = kph > 0 ? cruiseController(kph) : null;
  let t = 0;
  let dist = 0;
  const DT = 1 / 60;
  // Get up to speed first, on a tank that is topped back up, so the measurement is of
  // CRUISING and not of one acceleration run.
  for (let k = 0; k < 60 * 40; k++) {
    const cmd = { steer: 0, throttle: ctl ? ctl(car, DT) : 1, brake: 0, handbrake: 0, analogue: true };
    car.update(DT, cmd);
  }
  fuel.fill(1);
  while (fuel.seconds > 0 && t < 3600) {
    const cmd = { steer: 0, throttle: ctl ? ctl(car, DT) : 1, brake: 0, handbrake: 0, analogue: true };
    fuel.update(DT, car);
    car.update(DT, fuel.gate(cmd));
    dist += Math.abs(car.speed) * DT;
    t += DT;
  }
  results[label] = { mins: t / 60, km: dist / 1000, kph: (dist / t) * 3.6 };
  console.log(`       ${label.padEnd(28)} ${(t / 60).toFixed(2)} min   ${(dist / 1000).toFixed(1)} km   mean ${((dist / t) * 3.6).toFixed(0)} km/h`);
}
{
  const m = results['cruising  95 km/h'].mins;
  check(m > 5.4 && m < 6.6, 'MINUTES OF CRUISING PER TANK', m.toFixed(2), '6.0 +- 0.6 (the brief: "roughly six")');
  check(results['dawdling  60 km/h'].mins > m, 'a gentle drive goes further in time', results['dawdling  60 km/h'].mins.toFixed(2), `> ${m.toFixed(2)}`);
  check(results['flat out (throttle pinned)'].mins < m, 'hurrying costs more', results['flat out (throttle pinned)'].mins.toFixed(2), `< ${m.toFixed(2)}`);
  check(results['cruising  95 km/h'].km > 7 && results['cruising  95 km/h'].km < 11, 'kilometres per tank at cruise', results['cruising  95 km/h'].km.toFixed(1), '7 .. 11 (stations are ~2.9 km apart)');
}

console.log('\n── the limit actually reaches the solver ─────────────────────────────────');
{
  /* This is the bug that has bitten this project twice: a tunable declared in one file that
   * never reaches the place it matters. gate() scales input.throttle; Vehicle.update reads
   * input.throttle. So drive two identical cars with identical commands, one through gate()
   * with the power pinned down, and measure the CAR, not the flag. */
  const DT = 1 / 60;
  const run = (power) => {
    const car = fresh();
    const fuel = new Fuel({ start: 1 });
    for (let k = 0; k < 60 * 30; k++) {
      const cmd = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
      fuel.update(DT, car);
      fuel.power = power; // pinned after update() so the tank cannot argue
      car.update(DT, fuel.gate(cmd));
    }
    return { kph: car.kph, thr: car.throttle };
  };
  const full = run(1);
  const half = run(0.4);
  const zero = run(0);
  console.log(`       full power ${full.kph.toFixed(0)} km/h (car throttle ${full.thr.toFixed(2)}), 0.4 -> ${half.kph.toFixed(0)} km/h (${half.thr.toFixed(2)}), 0 -> ${zero.kph.toFixed(0)} km/h (${zero.thr.toFixed(2)})`);
  check(half.thr < full.thr * 0.75, "the car's own throttle follows the limit", half.thr.toFixed(3), `< ${(full.thr * 0.75).toFixed(3)}`);
  check(half.kph < full.kph - 15, 'and so does the speed it reaches', half.kph.toFixed(0), `< ${(full.kph - 15).toFixed(0)}`);
  check(zero.kph < 1, 'zero power cannot pull the car at all', zero.kph.toFixed(2), '< 1 km/h');
  check(zero.thr < 0.01, 'zero power leaves no throttle in the engine', zero.thr.toFixed(4), '< 0.01');
}

console.log('\n── refuelling at a real station ──────────────────────────────────────────');
{
  /* A real station from the real world generator, not a made-up point. Drive the tank down,
   * park on the forecourt, and read the tank back out of the model. */
  const st = nearestStation(0, 0, SEED, 4000);
  check(!!st, 'found a station near the origin', st ? `${st.x.toFixed(0)}, ${st.z.toFixed(0)} (${(st.dist / 1000).toFixed(2)} km)` : 'none', 'one');
  const car = fresh();
  const fuel = new Fuel({ start: 1, findStation: (x, z) => {
    const d = Math.hypot(st.x - x, st.z - z);
    return { x: st.x, z: st.z, dist: d };
  } });
  const DT = 1 / 60;

  // 1. burn it down away from the pumps
  car.placeAt(st.x + 400, st.z, 0);
  for (let k = 0; k < 60 * 120; k++) {
    const cmd = { steer: 0, throttle: 0.35, brake: 0, handbrake: 0, analogue: true };
    fuel.update(DT, car);
    car.update(DT, fuel.gate(cmd));
    car.x = st.x + 400; // hold it away from the station; we are testing the tank, not driving
    car.z = st.z;
  }
  const low = fuel.fraction;
  console.log(`       after two minutes at part throttle, the tank reads ${(low * 100).toFixed(1)}%`);
  check(low < 0.85 && low > 0.2, 'the tank went down', `${(low * 100).toFixed(1)}%`, '20% .. 85%');

  // 2. roll onto the forecourt and stop
  car.placeAt(st.x + 3, st.z + 2, 0);
  car.speed = 0;
  car.vx = 0;
  car.vz = 0;
  const before = fuel.seconds;
  let refuelSecs = 0;
  const trace = [];
  for (let k = 0; k < 60 * 12; k++) {
    fuel.update(DT, car);
    car.update(DT, fuel.gate({ steer: 0, throttle: 0, brake: 1, handbrake: 1, analogue: true }));
    car.x = st.x + 3;
    car.z = st.z + 2;
    car.speed = 0;
    if (fuel.refuelling) refuelSecs += DT;
    if (k % 60 === 0) trace.push(`${(k / 60) | 0}s:${(fuel.fraction * 100).toFixed(0)}%`);
  }
  console.log(`       parked ${Math.hypot(3, 2).toFixed(1)} m from the pumps (radius ${STATION_RADIUS} m): ${trace.join(' ')}`);
  check(fuel.seconds > before, 'the tank rose while parked at the pumps', `${before.toFixed(0)} -> ${fuel.seconds.toFixed(0)} s`, 'higher');
  check(Math.abs(fuel.seconds - TANK_SECONDS) < 0.5, 'and reached a full tank', fuel.seconds.toFixed(1), `${TANK_SECONDS}`);
  check(refuelSecs > 1 && refuelSecs < 8, 'seconds spent filling', refuelSecs.toFixed(1), '1 .. 8');
  check(fuel.stats.refuels === 1, 'counted as one visit', fuel.stats.refuels, '1');

  // 3. driving past at speed must NOT refuel — a pump is a place you stop at
  const car2 = fresh();
  const fuel2 = new Fuel({ start: 0.5, findStation: () => ({ x: 0, z: 0, dist: 2 }) });
  for (let k = 0; k < 60 * 3; k++) {
    car2.speed = 25;
    fuel2.update(DT, car2);
  }
  check(fuel2.fraction < 0.5, 'driving through a forecourt does not refuel', `${(fuel2.fraction * 100).toFixed(1)}%`, '< 50%');
}

console.log('\n── a floating can, collected ──────────────────────────────────────────────');
{
  /* collectCans is pull-based: render/props.js's Props class detects proximity itself (it
   * already gets the car's position every frame) and hands back the total fraction gained
   * since the last call. This stubs that contract directly, the same way the station test
   * above stubs findStation, so the question asked is "does Fuel apply what it is handed",
   * not "does Props detect proximity" — that is proven separately, with a real Props
   * instance, in tools/bench-props.mjs's "a can, bobbing and collected" section. */
  const DT = 1 / 60;
  const said = [];
  const car = fresh();
  const fuel = new Fuel({ start: 0.5, say: (t) => said.push(t), collectCans: () => 0 });
  fuel.update(DT, car);
  // Not exactly 0.5: idling still burns (IDLE = 0.14 of the rate, applied for one frame),
  // the same tiny amount it would with no can system involved at all — 0.01 comfortably
  // covers one frame of it and nothing more.
  check(Math.abs(fuel.fraction - 0.5) < 0.01, 'nothing gained while collectCans reports 0', fuel.fraction.toFixed(4), '~0.5');

  let paid = false;
  fuel.collectCans = () => {
    if (paid) return 0;
    paid = true;
    return CAN_FRACTION;
  };
  const before = fuel.seconds;
  fuel.update(DT, car);
  // Within 0.01 s rather than exact: the top-up and that same frame's own idle burn both
  // happen inside this one update() call, in that order, so the net gain is CAN_FRACTION of
  // a tank minus a fraction of a frame's idle burn, not CAN_FRACTION to the last digit.
  check(Math.abs(fuel.seconds - (before + TANK_SECONDS * CAN_FRACTION)) < 0.01,
    'a collected can adds CAN_FRACTION of a tank', fuel.seconds.toFixed(2), `~${(before + TANK_SECONDS * CAN_FRACTION).toFixed(2)}`);
  check(fuel.stats.cansCollected === 1, 'counted as one can', fuel.stats.cansCollected, '1');
  check(said.some((s) => /can/i.test(s)), 'said something about it', said.join(' | '), 'mentions "can"');

  // A can found on a near-full tank must cap at TANK_SECONDS, exactly like a pump would.
  const car2 = fresh();
  const fuel2 = new Fuel({ start: 0.95, collectCans: () => 0.5 });
  fuel2.update(DT, car2);
  check(fuel2.seconds <= TANK_SECONDS + 1e-6, 'a can cannot overfill the tank', fuel2.seconds.toFixed(2), `<= ${TANK_SECONDS}`);
  check(Math.abs(fuel2.seconds - TANK_SECONDS) < 0.01, 'and tops out at a full tank', fuel2.seconds.toFixed(2), `~${TANK_SECONDS}`);

  // Running dry, then a can arrives: power must recover immediately, the same as a pump does.
  const car3 = fresh();
  const fuel3 = new Fuel({ start: 0.001, collectCans: () => 0 });
  const ctl = cruiseController(95);
  for (let k = 0; k < 60 * 20 && fuel3.seconds > 0; k++) {
    fuel3.update(DT, car3);
    car3.update(DT, fuel3.gate({ steer: 0, throttle: ctl(car3, DT), brake: 0, handbrake: 0, analogue: true }));
  }
  check(fuel3.dry, 'ran dry as set up', fuel3.dry, 'true');
  const powerAtEmpty = fuel3.power;
  fuel3.collectCans = () => 0.3;
  fuel3.update(DT, car3);
  check(!fuel3.dry, 'a can clears the dry state on the very frame it lands, like a pump', fuel3.dry, 'false');
  // Power itself ramps back up over about a second (damp(power, 1, 4, dt)) rather than
  // snapping — "the engine picks back up rather than snapping on", the same phrase this
  // file already uses for a rescue — so the check is a couple of seconds later, not this
  // same frame.
  fuel3.collectCans = () => 0;
  for (let k = 0; k < 120; k++) fuel3.update(DT, car3);
  check(fuel3.power > powerAtEmpty, 'power is climbing, not snapped, right after the can lands', `${powerAtEmpty.toFixed(3)} -> ${fuel3.power.toFixed(3)}`, 'higher');
  check(fuel3.power > 0.95, 'and is most of the way back after driving on for 2 s', fuel3.power.toFixed(3), '> 0.95');
}

console.log('\n── running dry is gentle and always recoverable ──────────────────────────');
{
  const DT = 1 / 60;
  const said = [];
  const car = fresh();
  const fuel = new Fuel({ start: 0.02, say: (t) => said.push(t), findStation: () => ({ x: 900, z: 0, dist: 900 }) });
  const ctl = cruiseController(95);
  for (let k = 0; k < 60 * 40; k++) car.update(DT, { steer: 0, throttle: ctl(car, DT), brake: 0, handbrake: 0, analogue: true });
  fuel.fill(0.02);

  let emptyAt = -1;
  let stoppedAt = -1;
  let rescuedAt = -1;
  let kphAtEmpty = 0;
  let kphAtRescue = 0;
  let fuelAfterRescue = 0;
  let worstDecel = 0;
  const vWindow = [];
  const speeds = [];
  let lastV = Math.abs(car.speed);
  // Run only until the rescue lands, plus a few seconds to see the car pull away. Running on
  // would simply empty the can again and measure the second lap, not the first.
  for (let k = 0; k < 60 * 200; k++) {
    const t = k / 60;
    fuel.update(DT, car);
    car.update(DT, fuel.gate({ steer: 0, throttle: ctl(car, DT), brake: 0, handbrake: 0, analogue: true }));
    const v = Math.abs(car.speed);
    if (emptyAt < 0 && fuel.seconds <= 0) {
      emptyAt = t;
      kphAtEmpty = car.kph;
    }
    if (emptyAt >= 0) {
      /* Averaged over half a second, not per 1/60 s step. A stepped solver produces
       * single-frame spikes at every gearshift that no driver can feel, and the question
       * being asked here is whether the car SLOWS gently, not whether one substep did. */
      vWindow.push(v);
      if (vWindow.length > 30) vWindow.shift();
      if (vWindow.length === 30) worstDecel = Math.max(worstDecel, (vWindow[0] - v) / 0.5);
      if (Math.round(t * 2) / 2 === t && t <= emptyAt + 20) speeds.push(`${(t - emptyAt).toFixed(0)}s:${car.kph.toFixed(0)}`);
      if (stoppedAt < 0 && v < 0.8) stoppedAt = t;
      if (rescuedAt < 0 && fuel.stats.rescues > 0) {
        rescuedAt = t;
        kphAtRescue = car.kph;
        fuelAfterRescue = fuel.fraction;
      }
    }
    lastV = v;
    if (rescuedAt >= 0 && t > rescuedAt + 12) break;
  }
  console.log(`       ran dry at ${emptyAt.toFixed(1)}s doing ${kphAtEmpty.toFixed(0)} km/h, rolled to a stop at ${stoppedAt.toFixed(1)}s, a can arrived at ${rescuedAt.toFixed(1)}s (${kphAtRescue.toFixed(0)} km/h)`);
  console.log(`       lines shown: ${said.map((s) => `"${s}"`).join(', ')}`);
  check(emptyAt >= 0, 'the tank did empty', emptyAt.toFixed(1) + 's', 'yes');
  console.log(`       km/h after running dry: ${speeds.filter((_, i) => i % 4 === 0).join(' ')}`);
  const meanDecel = (kphAtEmpty / 3.6) / Math.max(0.001, stoppedAt - emptyAt);
  check(meanDecel < 1.6, 'mean deceleration from empty to stopped (m/s^2)', meanDecel.toFixed(2), '< 1.6 (0.16 g — a coast)');
  check(worstDecel < 3.0, 'sharpest half-second of it (m/s^2)', worstDecel.toFixed(2), '< 3.0 (0.3 g; it happens below 30 km/h, on the downshifts)');
  check(stoppedAt > emptyAt + 5, 'seconds of coasting before it stopped', (stoppedAt - emptyAt).toFixed(1), '> 5 (unhurried)');
  check(rescuedAt > stoppedAt && rescuedAt < stoppedAt + 8, 'the can arrives AFTER the car has stopped', `${(rescuedAt - stoppedAt).toFixed(1)}s later`, '0 .. 8 s');
  check(fuel.stats.rescues === 1, 'someone came past', fuel.stats.rescues, '1');
  check(fuelAfterRescue > 0.1, 'and left fuel in the tank', `${(fuelAfterRescue * 100).toFixed(0)}%`, '> 10%');
  check(car.kph > 40, 'the car is driving again 12 s later', car.kph.toFixed(0) + ' km/h', '> 40');
  check(!said.some((s) => /game over|failed|penalty|lost|fail/i.test(s)), 'nothing that reads as a failure', said.length + ' lines', 'no failure wording');

  // The backstop: coasting downhill for ever must still get rescued.
  const car3 = fresh();
  const fuel3 = new Fuel({ start: 0.001, say: () => {} });
  for (let k = 0; k < 60 * 120; k++) {
    fuel3.update(DT, car3);
    car3.speed = 30; // never stops
    car3.throttle = 0;
  }
  check(fuel3.stats.rescues >= 1, 'rescued even while never stopping', fuel3.stats.rescues, '>= 1');
}

console.log('\n── the gauge needle actually moves ───────────────────────────────────────');
{
  /* A flag being set is not a thing being visible. So: run the real gauge against a stub DOM
   * and read the rotation actually written into the needle's transform attribute. */
  installDomStub();
  const { FuelGauge } = await import('../src/ui/fuelGauge.js');
  const root = globalThis.document.createElement('div');
  const g = new FuelGauge(root);
  const car = fresh();
  const fuel = new Fuel({ start: 1 });
  for (let k = 0; k < 240; k++) g.update(1 / 60, fuel, car); // let the needle settle
  const atFull = g.needleAngle();
  const fullAttr = g.needle.attrs.transform;
  fuel.fill(0);
  for (let k = 0; k < 600; k++) g.update(1 / 60, fuel, car);
  const atEmpty = g.needleAngle();
  const emptyAttr = g.needle.attrs.transform;
  console.log(`       full: ${fullAttr}`);
  console.log(`       empty: ${emptyAttr}`);
  check(atFull > 55, 'needle angle at a full tank (deg)', atFull.toFixed(1), '> 55');
  check(atEmpty < -55, 'needle angle at an empty tank (deg)', atEmpty.toFixed(1), '< -55');
  check(fullAttr !== emptyAttr, 'the transform attribute changed', 'yes', 'yes');
  check(/rotate\(/.test(emptyAttr), 'and it is a rotation the browser will apply', emptyAttr.slice(0, 12), 'rotate(...)');
}

console.log('\n── the nearest-station counter is always on ──────────────────────────────');
{
  /* Distance and direction to the nearest known pump, unconditional on fuel level — unlike
   * `.mins` above, which only shows a distance once the tank is critically low. This sets
   * fuel.nearest directly, the same way the "refuelling at a real station" section's own
   * findStation stub effectively does, rather than driving a real Props scan — the question
   * here is whether the GAUGE reads fuel.nearest honestly, not whether Props finds one, which
   * is proven separately in tools/bench-props.mjs. */
  installDomStub();
  const { FuelGauge } = await import('../src/ui/fuelGauge.js');
  const g2 = new FuelGauge(globalThis.document.createElement('div'));
  const fuel = new Fuel({ start: 0.9 });
  const car = fresh(); // placeAt(0,0,0): yaw 0, forward is +Z (vehicle.js: "forward is (sin yaw, cos yaw)")

  // nothing known yet: an honest resting state, never a blank box, never a fabricated direction
  for (let k = 0; k < 30; k++) g2.update(1 / 60, fuel, car);
  check(g2.stationDist.textContent === '—', 'before any station is known, an honest placeholder, not a blank box', g2.stationDist.textContent, '—');
  check(Math.abs(g2.stationArrowDeg()) < 3, 'and the arrow rests dead ahead rather than pointing at a fabricated direction', `${g2.stationArrowDeg().toFixed(1)}°`, '~0°');

  // straight ahead, 500 m
  fuel.nearest = { x: 0, z: 500, dist: 500 };
  for (let k = 0; k < 180; k++) g2.update(1 / 60, fuel, car);
  check(g2.stationDist.textContent === '500 m', 'distance straight ahead formats under 1 km in metres', g2.stationDist.textContent, '500 m');
  check(Math.abs(g2.stationArrowDeg()) < 3, 'and the arrow points dead ahead', `${g2.stationArrowDeg().toFixed(1)}°`, '~0°');

  // 2.4 km to the LEFT (+X — three.js handedness: "+X is screen-left looking down +Z")
  fuel.nearest = { x: 2400, z: 0, dist: 2400 };
  for (let k = 0; k < 180; k++) g2.update(1 / 60, fuel, car);
  check(g2.stationDist.textContent === '2.4 km', 'distance formats km once past 1000 m', g2.stationDist.textContent, '2.4 km');
  check(g2.stationArrowDeg() < -30, "a station to the LEFT turns the arrow the way every bearing in this project turns (diag-o2.mjs's own rule)", `${g2.stationArrowDeg().toFixed(1)}°`, '< -30°');

  // 500 m to the RIGHT (-X)
  fuel.nearest = { x: -300, z: 400, dist: 500 };
  for (let k = 0; k < 180; k++) g2.update(1 / 60, fuel, car);
  check(g2.stationArrowDeg() > 30, 'and a station to the RIGHT turns it the other way', `${g2.stationArrowDeg().toFixed(1)}°`, '> 30°');

  // loses the signal again: relaxes to neutral, shown honestly, never a frozen stale reading
  fuel.nearest = null;
  for (let k = 0; k < 300; k++) g2.update(1 / 60, fuel, car);
  check(g2.stationDist.textContent === '—', 'forgetting a station is shown honestly too, not a frozen stale distance', g2.stationDist.textContent, '—');
  check(Math.abs(g2.stationArrowDeg()) < 3, 'and the arrow relaxes back to neutral', `${g2.stationArrowDeg().toFixed(1)}°`, '~0°');
}

console.log('\n── capacity upgrades: every 5th can raises the tank, capped at +50% ───────');
{
  /* collectCans always hands back a small, fixed amount — the same pull-based, single-shot
   * shape render/props.js's real drainCollectedFuel() delivers a can in — so N update() calls
   * collect exactly N cans, one at a time. */
  const car = fresh();
  const fuel = new Fuel({ start: 1, collectCans: () => 0.01 });
  const capAt = [];
  for (let n = 1; n <= 30; n++) {
    fuel.update(1 / 60, car);
    capAt.push(fuel.capacity);
  }
  console.log(
    `       capacity after can # : 1=${capAt[0].toFixed(0)}  4=${capAt[3].toFixed(0)}  5=${capAt[4].toFixed(0)}  ` +
      `9=${capAt[8].toFixed(0)}  10=${capAt[9].toFixed(0)}  25=${capAt[24].toFixed(0)}  26=${capAt[25].toFixed(0)}  30=${capAt[29].toFixed(0)}`
  );
  check(Math.abs(capAt[3] - TANK_SECONDS) < 0.5, 'still the base tank after 4 cans', capAt[3].toFixed(1), `~${TANK_SECONDS}`);
  check(Math.abs(capAt[4] - TANK_SECONDS * 1.1) < 0.5, 'first upgrade fires exactly on the 5th can (+10%)', capAt[4].toFixed(1), `~${(TANK_SECONDS * 1.1).toFixed(1)}`);
  check(Math.abs(capAt[8] - TANK_SECONDS * 1.1) < 0.5, 'still one upgrade at 9 cans', capAt[8].toFixed(1), `~${(TANK_SECONDS * 1.1).toFixed(1)}`);
  check(Math.abs(capAt[9] - TANK_SECONDS * 1.2) < 0.5, 'second upgrade on the 10th can (+20% total)', capAt[9].toFixed(1), `~${(TANK_SECONDS * 1.2).toFixed(1)}`);
  check(Math.abs(capAt[24] - TANK_SECONDS * 1.5) < 0.5, 'fifth upgrade (25th can) reaches the +50% ceiling', capAt[24].toFixed(1), `~${(TANK_SECONDS * 1.5).toFixed(1)}`);
  check(Math.abs(capAt[25] - TANK_SECONDS * 1.5) < 0.5, 'a 26th can refuels but the tank stops growing — the cap holds', capAt[25].toFixed(1), `~${(TANK_SECONDS * 1.5).toFixed(1)}`);
  check(Math.abs(capAt[29] - TANK_SECONDS * 1.5) < 0.5, 'and neither does a 30th — not an unbounded grind', capAt[29].toFixed(1), `~${(TANK_SECONDS * 1.5).toFixed(1)}`);

  // The upgrade message fires on the milestone can specifically, not on an ordinary one.
  const said = [];
  const car2 = fresh();
  const fuel2 = new Fuel({ start: 1, say: (t) => said.push(t), collectCans: () => 0.01 });
  for (let k = 0; k < 5; k++) fuel2.update(1 / 60, car2);
  check(said.some((s) => /capacity|bigger tank/i.test(s)), 'the 5th can announces the upgrade', said.join(' | '), 'mentions capacity/bigger tank');
  const said2 = [];
  const car3 = fresh();
  const fuel3 = new Fuel({ start: 1, say: (t) => said2.push(t), collectCans: () => 0.01 });
  for (let k = 0; k < 4; k++) fuel3.update(1 / 60, car3);
  check(!said2.some((s) => /capacity|bigger tank/i.test(s)), 'an ordinary can (1st-4th) does not', said2.join(' | ') || '(nothing capacity-related)', 'no capacity mention');

  // fill(1) on an upgraded tank fills PAST the original 360 — capacity generalises everywhere
  // "a full tank" is used, not just the top-up path.
  fuel.fill(1);
  check(Math.abs(fuel.seconds - TANK_SECONDS * 1.5) < 0.5, 'fill(1) on a maxed-out tank fills past the original 360', fuel.seconds.toFixed(1), `~${(TANK_SECONDS * 1.5).toFixed(1)}`);
}

console.log('\n── downhill coasting costs almost nothing ──────────────────────────────────');
{
  /* A real, if simplified, downhill grade — height falls as you drive forward (+Z). The sign
   * was verified empirically against the real Vehicle solver before this test was written
   * (car.vy reads NEGATIVE while descending it), per this project's own handedness gotcha:
   * "Verify signs empirically," never assume. */
  const GRADE = 0.14; // 14% — inside what this world's own roads produce (see fuel.js DESCENT_FULL)
  const DOWNHILL = {
    surface: (x, z) => ({
      y: -z * GRADE, nx: 0, ny: 1 / Math.sqrt(1 + GRADE * GRADE), nz: GRADE / Math.sqrt(1 + GRADE * GRADE),
      grip: 1, rough: 0.06, surfaceKind: 'tarmac', onRoad: 1, dominant: 0,
    }),
    height: (x, z) => -z * GRADE,
  };
  // The canonical cruise speed this whole file already calibrates against (CRUISE_V/
  // CRUISE_THROTTLE, "the cruise the tank is measured against" section above) — not chosen to
  // flatter the ratio, but because a slower coast makes a WEAKER case for the same reason a
  // slow car always would: IDLE is a fixed floor and DRAG grows with v^2, so the FASTER you
  // were coasting, the more of the flat rate is speed-cost the hill genuinely waives, and the
  // more dramatic (and more honest) the saving looks — which is exactly the situation "almost
  // no fuel" is meant to describe: it is at speed that a downhill coast pays for itself.
  const START_KPH = 95;

  /* Ramp up to the SAME speed the SAME way for both runs — on the FLAT, always, proven stable
   * elsewhere in this file — then hand the already-cruising car over to the surface actually
   * being measured and come completely OFF the throttle for a short, real coast. Deliberately
   * NOT "hold a target speed with a controller ON the hill itself": the cruiseController used
   * elsewhere here has no brake, and a grade steep enough to push the car past a held target
   * with the pedal already at zero has nothing left for a no-brake PI loop to do but oscillate
   * — measured, not guessed, an earlier version of this exact test tried exactly that and
   * produced a downhill run that never even reached a clean starting speed. Position is reset
   * to (0, 0) at the hand-off (a no-op for the flat's own uniform height, and what stops the
   * downhill's height() jumping to wherever 30 s of flat driving had carried z) so the switch
   * is a continuous join in height, not a physics discontinuity.
   *
   * The measured window skips the first 1.5 s of the coast before averaging: fuel.js's own
   * descent signal is smoothed (DESCENT_SMOOTH, so a kerb cannot flicker the discount), and it
   * starts from zero at the exact instant the throttle lifts — averaging over that ramp-up
   * would blend "the discount has not caught up yet" into the number and understate what a
   * SETTLED downhill coast actually costs. 1.5 s is comfortably past its own convergence (a
   * ~0.4 s time constant). The window is then short (1.5 s of averaging) so the two runs stay
   * close to their starting speed rather than drifting apart on natural deceleration alone
   * (which a flat coast does far more than a downhill one, and would understate the discount
   * in the OTHER direction — a longer average making the flat side look artificially cheap too
   * as it slows down on its own). */
  const coastRate = (terrain) => {
    const car = new Vehicle({ tier: 'touring', terrain: FLAT, preset: 'cruise' });
    car.placeAt(0, 0, 0); // yaw 0 -> heading +Z, matching the slope's own "downhill in +Z" sign
    const ctl = cruiseController(START_KPH);
    const DT = 1 / 60;
    for (let k = 0; k < 60 * 30; k++) car.update(DT, { steer: 0, throttle: ctl(car, DT), brake: 0, handbrake: 0, analogue: true });
    car.x = 0;
    car.z = 0; // see the comment above: a clean, continuous hand-off to the surface being measured
    car.terrain = terrain;
    const fuel = new Fuel({ start: 1 });
    let rateSum = 0, n = 0;
    const kphAt = [];
    for (let k = 0; k < 60 * 3; k++) {
      const cmd = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true }; // off the pedal, entirely
      fuel.update(DT, car);
      car.update(DT, fuel.gate(cmd));
      if (k >= 60 * 1.5) {
        rateSum += fuel.rate(car);
        n++;
      }
      if (k % 30 === 0) kphAt.push(car.kph.toFixed(0));
    }
    return { rate: rateSum / n, kphTrace: kphAt.join(' -> ') };
  };

  const flat = coastRate(FLAT);
  const down = coastRate(DOWNHILL);
  console.log(`       coasting from ${START_KPH} km/h, throttle off, on the flat:            mean burn rate (settled 1.5-3 s) ${flat.rate.toFixed(3)}, speed ${flat.kphTrace} km/h`);
  console.log(`       coasting from ${START_KPH} km/h, throttle off, on a ${(GRADE * 100).toFixed(0)}% downhill: mean burn rate (settled 1.5-3 s) ${down.rate.toFixed(3)}, speed ${down.kphTrace} km/h`);
  check(flat.rate > 0.1, 'sanity: coasting on the flat still costs something real to compare against', flat.rate.toFixed(3), '> 0.10');
  check(down.rate < flat.rate * 0.35, 'DOWNHILL COAST: settled burn rate drops to a small fraction of the flat coast — "almost no fuel"', down.rate.toFixed(3), `< ${(flat.rate * 0.35).toFixed(3)} (flat coast was ${flat.rate.toFixed(3)})`);
  check(down.rate > 0.05, 'and never goes to zero or negative — the engine is still on', down.rate.toFixed(3), '> 0.05');
}

console.log('\n── off-road driving costs double ────────────────────────────────────────────');
{
  /* Part 1: an ISOLATED read of rate() itself — same car object, same throttle, same speed,
   * flipping ONLY car.onRoad — so this measures exactly the multiplier fuel.js applies, with
   * no confound from anything else. */
  const car = fresh();
  car.throttle = CRUISE_THROTTLE;
  car.speed = CRUISE_V;
  car.onRoad = 1;
  const onRoadRate = new Fuel({}).rate(car);
  car.onRoad = 0;
  const offRoadRate = new Fuel({}).rate(car);
  const isoRatio = offRoadRate / onRoadRate;
  console.log(`       same car, same throttle/speed, only car.onRoad flipped: on-road rate ${onRoadRate.toFixed(3)}, off-road rate ${offRoadRate.toFixed(3)}, ratio ${isoRatio.toFixed(3)}x`);
  check(Math.abs(isoRatio - 2.0) < 0.02, 'OFF-ROAD: the rate() multiplier is exactly double, as coded', isoRatio.toFixed(3), '~2.0 ("double fuel to off-road")');

  /* Part 2: the honest, end-to-end number. Holding the SAME target speed for real, off-road's
   * own already-higher rolling resistance (src/car/vehicle.js: `crr = lerp(0.145, 0.014,
   * onRoad)`) compounds with this x2 multiplier, so real off-road driving costs MORE than a
   * clean 2x — reported here, not hidden, and only loosely bounded because that compounding
   * is real physics, not a number this file owns. */
  const OFFROAD = {
    surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 0.55, rough: 0.5, surfaceKind: 'ground', onRoad: 0, dominant: 0 }),
    height: () => 0,
  };
  /* Below vehicle.js's own OFF-ROAD SPEED CEILING (44 km/h — "Off-road speed ceiling was dead
   * code" in docs/BACKLOG.md, `offCap = lerp(12.2, 200, ...)` at onRoad=0 is 12.2 m/s), with
   * real margin, so BOTH runs can genuinely reach and hold it rather than one pinning against
   * a ceiling this test did not intend to measure. */
  const TARGET_KPH2 = 32;
  const runHoldingSpeed2 = (terrain, seconds) => {
    const car2 = new Vehicle({ tier: 'touring', terrain, preset: 'cruise' });
    car2.placeAt(0, 0, 0);
    const fuel2 = new Fuel({ start: 1 });
    const ctl = cruiseController(TARGET_KPH2);
    const DT = 1 / 60;
    for (let k = 0; k < 60 * 30; k++) car2.update(DT, { steer: 0, throttle: ctl(car2, DT), brake: 0, handbrake: 0, analogue: true });
    fuel2.fill(1);
    let rateSum = 0, kphSum = 0, n = 0;
    for (let k = 0; k < 60 * seconds; k++) {
      const cmd = { steer: 0, throttle: ctl(car2, DT), brake: 0, handbrake: 0, analogue: true };
      fuel2.update(DT, car2);
      car2.update(DT, fuel2.gate(cmd));
      if (k > 60 * 2) { rateSum += fuel2.rate(car2); kphSum += car2.kph; n++; }
    }
    return { rate: rateSum / n, kph: kphSum / n };
  };
  const onRoadDrive = runHoldingSpeed2(FLAT, 6);
  const offRoadDrive = runHoldingSpeed2(OFFROAD, 6);
  const driveRatio = offRoadDrive.rate / onRoadDrive.rate;
  console.log(`       real drive holding ${TARGET_KPH2} km/h: on-road rate ${onRoadDrive.rate.toFixed(3)} (${onRoadDrive.kph.toFixed(1)} km/h), off-road rate ${offRoadDrive.rate.toFixed(3)} (${offRoadDrive.kph.toFixed(1)} km/h), ratio ${driveRatio.toFixed(2)}x`);
  check(Math.abs(onRoadDrive.kph - TARGET_KPH2) < 8, 'the on-road drive held the target speed', onRoadDrive.kph.toFixed(1), `~${TARGET_KPH2}`);
  check(Math.abs(offRoadDrive.kph - TARGET_KPH2) < 10, 'so did the off-road drive — a fair like-for-like comparison', offRoadDrive.kph.toFixed(1), `~${TARGET_KPH2}`);
  check(driveRatio > 1.8, 'and the real, driven ratio is at least the double this file promises (often more, from rolling resistance)', driveRatio.toFixed(2), '> 1.8');
}

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all fuel checks passed'}\n`);
process.exit(failures ? 1 : 0);

/* ── a DOM small enough to fit in a test ──────────────────────────────────────
 * Not a browser: just enough of one that src/ui/fuelGauge.js runs unmodified and its output
 * can be inspected. If the gauge ever needs more than this, that is a signal in itself. */
function installDomStub() {
  class El {
    constructor(tag) {
      this.tag = tag;
      this.attrs = {};
      this.children = [];
      this.style = {};
      this.textContent = '';
      this._classes = new Set();
      this.classList = {
        add: (c) => this._classes.add(c),
        remove: (c) => this._classes.delete(c),
        toggle: (c, on) => (on ? this._classes.add(c) : this._classes.delete(c)),
        contains: (c) => this._classes.has(c),
      };
    }
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    }
    getAttribute(k) {
      return this.attrs[k];
    }
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    }
    removeChild(c) {
      this.children = this.children.filter((x) => x !== c);
    }
    querySelector() {
      return null;
    }
  }
  const byId = new Map();
  globalThis.document = {
    head: new El('head'),
    createElement: (t) => new El(t),
    createElementNS: (_ns, t) => new El(t),
    getElementById: (id) => byId.get(id) || null,
  };
  // The gauge registers its stylesheet by id; honour that so the second construction is a
  // no-op the way it is in a browser.
  const realAppend = El.prototype.appendChild;
  El.prototype.appendChild = function appendChild(c) {
    if (c.id) byId.set(c.id, c);
    return realAppend.call(this, c);
  };
}
