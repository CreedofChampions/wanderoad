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
 */

import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { Fuel, TANK_SECONDS, CRUISE_V, CRUISE_THROTTLE } from '../src/game/fuel.js';
import { STATION_RADIUS, nearestStation } from '../src/world/props.js';

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
