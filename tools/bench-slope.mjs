/* Does the car behave on hills, and does it stop when you lift off? */
import { Vehicle } from '../src/car/vehicle.js';
import { PHYSICS_DT } from '../src/car/tuning.js';

// a world that is a constant ramp of `deg` degrees, rising toward +Z
const ramp = (deg) => {
  const t = Math.tan((deg * Math.PI) / 180);
  const ny = Math.cos((deg * Math.PI) / 180), nz = -Math.sin((deg * Math.PI) / 180);
  return {
    height: (x, z) => z * t,
    surface: (x, z) => ({ y: z * t, nx: 0, ny, nz, grip: 1, rough: 0, onRoad: 1, surfaceKind: 'tarmac', dominant: 0 }),
  };
};
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

console.log('\nclimb test — full throttle up a ramp, 20 s, speed reached');
for (const deg of [0, 5, 10, 20, 30, 40, 55, 70]) {
  const car = new Vehicle({ tier: 'sports', terrain: ramp(deg), preset: 'sport' });
  car.placeAt(0, 0, 0);
  for (let i = 0; i < 120 * 20; i++) car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 1 });
  const climbed = car.z;
  console.log(`  ${String(deg).padStart(2)}°  ${car.kph.toFixed(0).padStart(4)} km/h   climbed ${climbed.toFixed(0).padStart(5)} m`);
}

console.log('\ncoast test — reach 80 km/h on the flat, then lift off');
{
  const car = new Vehicle({ tier: 'sports', terrain: ramp(0), preset: 'sport' });
  car.placeAt(0, 0, 0);
  /* Guarded, and targeted at a speed the car can actually reach. The fleet was halved on the
   * operator's instruction, so the sports car tops out at 88 km/h -- an unbounded
   * `while (car.kph < N)` for any N above that is not a slow test, it is a hang. */
  let spin = 0;
  while (car.kph < 80 && spin++ < 120 * 60) car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 1 });
  const z0 = car.z;
  let t = 0;
  const marks = [];
  while (car.kph > 2 && t < 300) {
    car._step(PHYSICS_DT, NEUTRAL);
    t += PHYSICS_DT;
    for (const k of [100, 60, 30, 10]) {
      if (!marks.find((m) => m.k === k) && car.kph <= k) marks.push({ k, t, d: car.z - z0 });
    }
  }
  for (const m of marks) console.log(`  down to ${String(m.k).padStart(3)} km/h after ${m.t.toFixed(1)}s, ${m.d.toFixed(0)} m`);
  console.log(`  stopped after ${t.toFixed(1)}s and ${(car.z - z0).toFixed(0)} m`);
}

console.log('\nrollback test — stopped on a 20° slope, no throttle, 5 s');
{
  const car = new Vehicle({ tier: 'sports', terrain: ramp(20), preset: 'sport' });
  car.placeAt(0, 0, 0);
  for (let i = 0; i < 120 * 5; i++) car._step(PHYSICS_DT, NEUTRAL);
  console.log(`  moved ${car.z.toFixed(1)} m (negative = rolled downhill, want < -3)`);
}
