/* created by AI
 * Wanderoad — body-roll OSCILLATION, not amplitude.
 *
 * The operator's own words: "Car still wobbles left to right immensely, like a scooter." A
 * prior audit measured worst-case body roll (8.98 deg peak) and called it fine — but peak
 * AMPLITUDE is the wrong number for "wobbles": a car that leans a few degrees once, holds it
 * through a corner and comes back is not a wobble, it is body roll doing its job. A car that
 * swings left, then right, then left again, several times a second, reads as a wobble even if
 * no single swing is large — that is a RATE / FREQUENCY problem, not an amplitude problem.
 *
 * So this drives dead straight down a real road, on the real Autopilot (the same one G/G key
 * drives with in game: cruises, brakes for the corner ahead, stays on the road — a hand-rolled
 * steering stub that loses the road at speed measures a crash, not a wobble, and the first
 * version of this file did exactly that), and measures, from car.roll every physics step:
 *
 *   1. roll RATE, deg/s, via a central difference (120 Hz)
 *   2. ZERO CROSSINGS of that rate — how many times a second the roll reverses direction
 *
 * Only ON-ROAD samples count (onRoadMin > 0.9): a wheel off the verge is a different, already-
 * measured phenomenon (the loose-surface block in vehicle.js), not the ordinary tarmac wobble
 * the operator is describing.
 *
 * A calm car holds a roll rate near zero except when the road genuinely asks for a lean; a
 * "scooter" oscillates through zero over and over on flat-ish ground, several times a second.
 * The pass bar is the operator's own frame: >2 crossings/s SUSTAINED is a wobble.
 *
 *   node tools/diag-roll-oscillation.mjs
 */
import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { PHYSICS_DT } from '../src/car/tuning.js';

const DEG = 180 / Math.PI;
const MANUAL_NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0 }; // "hands off the wheel"

/** Drive a real road on the real Autopilot for `secs`, sampling roll every physics step. */
function driveRoad(seed, spawnPoint, secs) {
  let terr = new Terrain(seed, spawnPoint.x - 420, spawnPoint.z - 420, spawnPoint.x + 420, spawnPoint.z + 420);
  const car = new Vehicle({ tier: 'sports', terrain: terr, preset: 'sport' });
  car.placeAt(spawnPoint.x, spawnPoint.z, spawnPoint.heading);
  const auto = new Autopilot({ cruise: 16 });
  auto.toggle(car); // same call main.js's G key makes
  let cx = spawnPoint.x;
  let cz = spawnPoint.z;
  const n = Math.round(secs / PHYSICS_DT);
  const roll = [];
  const onRoad = [];
  for (let i = 0; i < n; i++) {
    if (Math.abs(car.x - cx) > 240 || Math.abs(car.z - cz) > 240) {
      terr = new Terrain(seed, car.x - 420, car.z - 420, car.x + 420, car.z + 420);
      car.terrain = terr;
      cx = car.x;
      cz = car.z;
    }
    const cmd = auto.update(car, MANUAL_NEUTRAL, PHYSICS_DT) || { ...MANUAL_NEUTRAL, analogue: true, auto: true };
    car._step(PHYSICS_DT, cmd);
    roll.push(car.roll);
    onRoad.push(car.onRoadMin);
    // The stuck detector can switch itself off (e.g. after a recover() with no `recover`
    // wired up here); if so, hand it straight back on rather than coasting for the rest of
    // the window — the point is a sustained drive, not one attempt.
    if (!auto.on) auto.toggle(car);
  }
  return { car, roll, onRoad };
}

/**
 * Roll rate (deg/s, central difference) and zero-crossing rate over the SUSTAINED, ON-ROAD
 * window (skips the first `settleSecs` to let the initial drop/settle transient clear, and
 * skips any sample where a wheel has left the made surface).
 */
function analyse(roll, onRoad, settleSecs) {
  const skip = Math.round(settleSecs / PHYSICS_DT);
  const n = roll.length;
  const rate = new Float64Array(n); // deg/s
  for (let i = 1; i < n - 1; i++) rate[i] = ((roll[i + 1] - roll[i - 1]) / (2 * PHYSICS_DT)) * DEG;
  let crossings = 0;
  let peakRate = 0;
  let peakRoll = 0;
  let prevSign = 0;
  let counted = 0;
  for (let i = Math.max(1, skip); i < n - 1; i++) {
    if (onRoad[i] < 0.9) { prevSign = 0; continue; } // off the tarmac — a different failure mode
    counted++;
    const r = rate[i];
    if (Math.abs(r) > peakRate) peakRate = Math.abs(r);
    if (Math.abs(roll[i] * DEG) > peakRoll) peakRoll = Math.abs(roll[i] * DEG);
    // Deadband against numerical noise: only count a crossing once the rate has genuinely
    // swung the other way by more than 0.5 deg/s, not a sign flip on a near-zero value.
    if (Math.abs(r) > 0.5) {
      const s = Math.sign(r);
      if (prevSign !== 0 && s !== prevSign) crossings++;
      prevSign = s;
    }
  }
  const windowSecs = counted * PHYSICS_DT;
  return { crossingsPerSec: windowSecs > 0 ? crossings / windowSecs : 0, peakRateDegS: peakRate, peakRollDeg: peakRoll, windowSecs, onRoadFrac: counted / (n - skip) };
}

console.log('── driving a real road on the real Autopilot, no manual correction ──────');
const SEED = 20260726;
const spawn = findSpawn(SEED);
const SECS = 35; // this seed's route hits a dead end at ~39s; stop short of the standing tail
const { car, roll, onRoad } = driveRoad(SEED, spawn, SECS);
const a = analyse(roll, onRoad, 3);

console.log(
  `   ${SECS}s drive, ${a.windowSecs.toFixed(1)}s on-road sustained window (${(a.onRoadFrac * 100).toFixed(0)}% of the run stayed on the tarmac), ended at ${car.kph.toFixed(0)} km/h, rolled=${car.rolled}`
);
console.log(`   peak |roll| ${a.peakRollDeg.toFixed(2)}°   peak |roll rate| ${a.peakRateDegS.toFixed(1)} deg/s`);
console.log(`   ZERO CROSSINGS: ${a.crossingsPerSec.toFixed(2)} / s   (operator's own frame: >2/s sustained = a wobble)`);

const ok = a.crossingsPerSec <= 2.0 && !car.rolled && a.onRoadFrac > 0.5;
console.log(`\n${ok ? ' PASS' : ' FAIL'}  roll oscillation ${ok ? 'calm' : 'a genuine wobble (or the drive itself failed)'} — ${a.crossingsPerSec.toFixed(2)} crossings/s   want <= 2.0`);
process.exitCode = ok ? 0 : 1;
