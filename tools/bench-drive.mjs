/* Can the car actually follow a road?
 *
 * This drives the SHIPPED auto-pilot — src/car/autopilot.js, the same object main.js hands the
 * wheel to when you press G. It used to carry its own inline copy of an older version of that
 * controller, and the two drifted: the copy still ADDED its cross-track term where the real one
 * subtracts it, and still used the 0.55 gain from before roads curved. So this bench reported
 * "on-road 16.1%, worst offset 623 m" for a controller the game does not contain, while the one
 * it does contain was holding the road. A benchmark that measures a copy measures the copy.
 *
 * It runs at cruise 22 m/s — the fastest the auto-pilot will ever choose for itself — because
 * the interesting question is not whether it can crawl round a bend but whether it holds the
 * road at the pace a player would actually be doing.
 *
 *   node tools/bench-drive.mjs [--cruise 22] [--secs 90] [--seed 20260726]
 */
import { Vehicle } from '../src/car/vehicle.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Autopilot, pathOf, headingAt, locate } from '../src/car/autopilot.js';
import { PHYSICS_DT } from '../src/car/tuning.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? +argv[i + 1] : d;
};
const SEED = opt('seed', 20260726);
const SECS = opt('secs', 90);
const CRUISE = opt('cruise', 22);

const spawn = findSpawn(SEED);
let terr = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'cruise' });
car.placeAt(spawn.x, spawn.z, spawn.heading);

const auto = new Autopilot({ cruise: CRUISE });
auto.on = true;
const NOTHING = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };

let cx = spawn.x,
  cz = spawn.z;
let on = 0,
  n = 0,
  maxD = 0,
  dist = 0,
  px = car.x,
  pz = car.z;
let dSteer = 0,
  lastSteer = 0,
  turn = 0,
  lastEdge = null,
  lastS = 0;
const trace = [];

for (let i = 0; i < SECS / PHYSICS_DT; i++) {
  if (Math.abs(car.x - cx) > 240 || Math.abs(car.z - cz) > 240) {
    terr = new Terrain(SEED, car.x - 420, car.z - 420, car.x + 420, car.z + 420);
    car.terrain = terr;
    cx = car.x;
    cz = car.z;
  }
  const cmd = auto.update(car, NOTHING, PHYSICS_DT) || NOTHING;
  if (!auto.on) {
    console.log(`\nthe auto-pilot handed back after ${(i * PHYSICS_DT).toFixed(0)} s: ${auto.lastReason}`);
    break;
  }
  car._step(PHYSICS_DT, cmd);

  const near = terr.roads.query(car.x, car.z);
  if (isFinite(near.d)) {
    if (near.d <= near.width * 0.5) on++;
    maxD = Math.max(maxD, Math.min(near.d, 999));
    /* How much does the road the car is on actually TURN? R5 made the network curve, and a
     * road-holding number means nothing without it: 100% on a straight line is not a result.
     * Counted off the road's own polyline, over the stretch actually driven. */
    if (near.edge === lastEdge) {
      const p = pathOf(near.edge);
      const s = locate(near.edge, p, car.x, car.z).s;
      if (Math.abs(s - lastS) < 30) turn += Math.abs(headingAt(p, s) - headingAt(p, lastS));
      lastS = s;
    } else if (near.edge) {
      lastEdge = near.edge;
      lastS = locate(near.edge, pathOf(near.edge), car.x, car.z).s;
    }
  }
  n++;
  dist += Math.hypot(car.x - px, car.z - pz);
  px = car.x;
  pz = car.z;
  dSteer += Math.abs(cmd.steer - lastSteer);
  lastSteer = cmd.steer;

  if (i % 1200 === 0) {
    const q = terr.roads.query(car.x, car.z);
    trace.push(
      `${(i / 120).toFixed(0).padStart(3)}s  ${car.kph.toFixed(0).padStart(3)}km/h  roadDist ${(isFinite(q.d) ? q.d : 999)
        .toFixed(1)
        .padStart(6)}  steer ${cmd.steer.toFixed(2).padStart(5)}  slip ${(car.slip * 57.3).toFixed(0).padStart(4)}°`
    );
  }
}
console.log(trace.join('\n'));
const secs = n * PHYSICS_DT;
console.log(
  `\non-road ${((100 * on) / n).toFixed(1)}%   travelled ${(dist / 1000).toFixed(2)} km   worst offset ${maxD.toFixed(1)} m`
);
console.log(
  `road turned ${((turn * 57.3) / Math.max(dist / 1000, 0.001)).toFixed(0)} deg/km   ` +
    `steering ${(dSteer / secs).toFixed(2)} units/s of change (mean |d steer|/s)`
);
