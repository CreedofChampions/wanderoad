/* Can a simple controller actually follow a road? If a Stanley controller cannot, a person
 * has no chance, and the problem is the car or the road — not the driver. */
import { Vehicle } from '../src/car/vehicle.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { PHYSICS_DT } from '../src/car/tuning.js';

const SEED = 20260726;
const spawn = findSpawn(SEED);
let terr = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'cruise' });
car.placeAt(spawn.x, spawn.z, spawn.heading);

let cx = spawn.x, cz = spawn.z;
let on = 0, n = 0, maxD = 0, dist = 0, px = car.x, pz = car.z;
const trace = [];

for (let i = 0; i < 120 * 90; i++) {
  if (Math.abs(car.x - cx) > 240 || Math.abs(car.z - cz) > 240) {
    terr = new Terrain(SEED, car.x - 420, car.z - 420, car.x + 420, car.z + 420);
    car.terrain = terr; cx = car.x; cz = car.z;
  }
  const near = terr.roads.query(car.x, car.z);
  let steer = 0, target = 30;
  if (isFinite(near.d)) {
    let tx = near.tx, tz = near.tz;
    if (Math.sin(car.yaw) * tx + Math.cos(car.yaw) * tz < 0) { tx = -tx; tz = -tz; }
    const lateral = (car.x - near.qx) * tz - (car.z - near.qz) * tx;
    let err = Math.atan2(tx, tz) - car.yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const v = Math.max(Math.abs(car.speed), 6);
    steer = Math.max(-1, Math.min(1, (err * 1.15 + Math.atan2(0.55 * lateral, v)) * 1.6));
    if (near.d <= near.width * 0.5) on++;
    maxD = Math.max(maxD, Math.min(near.d, 999));
  }
  n++;
  car._step(PHYSICS_DT, { steer, throttle: Math.abs(car.speed) < target ? 0.6 : 0.05,
                          brake: Math.abs(car.speed) > target + 8 ? 0.4 : 0, handbrake: 0, analogue: true });
  dist += Math.hypot(car.x - px, car.z - pz); px = car.x; pz = car.z;
  if (i % 1200 === 0) {
    const q = terr.roads.query(car.x, car.z);
    trace.push(`${(i / 120).toFixed(0).padStart(3)}s  ${car.kph.toFixed(0).padStart(3)}km/h  roadDist ${(isFinite(q.d)?q.d:999).toFixed(1).padStart(6)}  steer ${steer.toFixed(2).padStart(5)}  slip ${(car.slip*57.3).toFixed(0).padStart(4)}°`);
  }
}
console.log(trace.join('\n'));
console.log(`\non-road ${(100*on/n).toFixed(1)}%   travelled ${(dist/1000).toFixed(2)} km   worst offset ${maxD.toFixed(1)} m`);
