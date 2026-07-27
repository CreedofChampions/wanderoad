/* created by AI
 * Repro harness for browser-test.mjs's C2 ("the brakes stop the car promptly") without a
 * browser. Drives the real Terrain/Roads world with the shipped Vehicle physics, using the
 * SAME run-up (steer toward a lookahead point on the centreline, full throttle) and the SAME
 * brake hold (raw `brake: 1`, no steering correction, 6 simulated seconds) the live check
 * uses, so it can be re-run cheaply with `node` to see WHERE the deceleration goes soft —
 * on the tarmac, or after the car has drifted onto the shoulder while going straight through
 * a bend under braking.
 *
 *   node tools/diag-c2-repro.mjs [--seed 20260726]
 */
import { Vehicle } from '../src/car/vehicle.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { PHYSICS_DT } from '../src/car/tuning.js';
import { FLEET, applyCarFeel } from '../src/game/garage.js';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? +argv[i + 1] : d;
};
const SEED = opt('seed', 20260726);

// The default car the live page actually loads with (main.js's carFromUrl fallback), not an
// arbitrary tier — brakeMul and top speed both come from this.
const carDef = FLEET[0];
applyCarFeel({ feel: carDef.feel });

const spawn = findSpawn(SEED);
let terr = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
const car = new Vehicle({ tier: carDef.tier, terrain: terr, preset: carDef.feel.assist });
car.placeAt(spawn.x, spawn.z, spawn.heading);

const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
const keepTerrain = () => {
  if (Math.abs(car.x - terr.x0 - 420) > 240 || Math.abs(car.z - terr.z0 - 420) > 240) {
    terr = new Terrain(SEED, car.x - 420, car.z - 420, car.x + 420, car.z + 420);
    car.terrain = terr;
  }
};

// ── run-up: identical shape to browser-test.mjs's roadRunUp — full throttle, steer toward a
// lookahead point on the centreline, up to three 9 s attempts until vTop > 45 km/h. ──
let vTop = 0;
for (let attempt = 0; attempt < 3 && vTop < 45; attempt++) {
  car.placeAt(spawn.x, spawn.z, spawn.heading);
  car.vx = car.vy = car.vz = 0;
  const steps = Math.round(9 / PHYSICS_DT);
  for (let i = 0; i < steps; i++) {
    keepTerrain();
    const L = Math.min(34, Math.max(10, 8 + Math.abs(car.speed) * 0.75));
    const q = terr.roads.query(car.x + Math.sin(car.yaw) * L, car.z + Math.cos(car.yaw) * L);
    let steer = 0;
    if (isFinite(q.d)) {
      let e = Math.atan2(q.qx - car.x, q.qz - car.z) - car.yaw;
      while (e > Math.PI) e -= Math.PI * 2;
      while (e <= -Math.PI) e += Math.PI * 2;
      steer = e > 0.02 ? 1 : e < -0.02 ? -1 : 0;
    }
    car._step(PHYSICS_DT, { ...NEUTRAL, throttle: 1, steer });
  }
  vTop = car.kph;
}
console.log(`run-up: ${vTop.toFixed(1)} km/h`);

// ── brake: identical shape to browser-test.mjs — full brake, NO steering correction, 6 s. ──
const p0 = { x: car.x, z: car.z };
const BRK = { ...NEUTRAL, brake: 1 };
const steps = Math.round(6 / PHYSICS_DT);
let leftRoad = -1;
for (let i = 0; i < steps; i++) {
  keepTerrain();
  car._step(PHYSICS_DT, BRK);
  const s = terr.surface(car.x, car.z);
  if (leftRoad < 0 && s.onRoad < 0.5) leftRoad = i * PHYSICS_DT;
  if (i % Math.round(0.5 / PHYSICS_DT) === 0) {
    console.log(
      `t=${(i * PHYSICS_DT).toFixed(2)}s  kph=${car.kph.toFixed(1)}  onRoad=${s.onRoad.toFixed(2)} ` +
        `onRoadMin=${car.onRoadMin.toFixed(2)} grip=${car.gripScale.toFixed(2)} vy=${car.vy.toFixed(2)}`
    );
  }
}
const dist = Math.hypot(car.x - p0.x, car.z - p0.z);
console.log(`\nfinal: ${car.kph.toFixed(1)} km/h, ${dist.toFixed(1)} m travelled`);
console.log(leftRoad >= 0 ? `left the tarmac at t=${leftRoad.toFixed(2)}s during braking` : 'stayed on the tarmac throughout');
console.log(`RESULT: ${vTop > 45 && car.kph < 3 ? 'PASS' : 'FAIL'} (want vTop>45 && kph<3; vTop=${vTop.toFixed(0)} kph=${car.kph.toFixed(1)})`);
