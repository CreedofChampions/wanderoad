// created by AI
/* Wanderoad — proving the cinematic-camera grass pop-out, and that the fix holds.
 *
 * Operator report: "cinimatic cam shows grass popping out of existence behind car." Drives a
 * REAL car with the REAL `Autopilot` on a REAL road, through the REAL `ChaseCamera` with its
 * DRIFT orbit engaged (`{ drift: true }`, exactly how main.js wires `auto.on`) — reproducing
 * the actual position/angle envelope `src/car/camera.js` puts the lens through, not an
 * assumed one — against the REAL `Grass` class.
 *
 * `main.js`'s own frame loop sets `U.uCamPos`/`U.uCull` from the TRUE camera and calls
 * `grass.update(car.x, car.z, car.y, dt)` — car position, not camera — every frame, in that
 * order, so this reproduces exactly that sequence.
 *
 * For every resident grass chunk (real blade data, `count > 0`) this independently computes,
 * every sampled frame, two things purely as arithmetic (no grass.js internals touched):
 *   - "car-relative": the same distance/cone test grass.js used to run, fed the CAR's own
 *     position — reproducing the pre-fix behaviour without ever reverting the source file.
 *   - "camera-relative": the same test fed the TRUE camera position/direction — the correct
 *     answer, and what the fixed `_draw()` now actually computes internally.
 * Then it reads the REAL `mesh.visible` the REAL, CURRENT `Grass` instance just set, and
 * confirms it agrees with "camera-relative" — i.e. that the fix in grass.js, not just this
 * tool's understanding of it, is what is running.
 *
 *   node tools/diag-grasscine.mjs [--seed 20260726] [--terrain meadow] [--km 3]
 */

import { performance } from 'node:perf_hooks';
import { PerspectiveCamera, Object3D, Vector3 } from 'three';
import { Terrain, findSpawn } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { ChaseCamera } from '../src/car/camera.js';
import { applyTerrain, terrainBias } from '../src/game/presets.js';
import { setBiomeBias } from '../src/world/biomes.js';
import { applyCarFeel, FLEET_BY_ID, FIRST_CAR } from '../src/game/garage.js';
import { Grass } from '../src/render/grass.js';
import { U } from '../src/render/uniforms.js';
import { DEG, smoothstep, clamp01 } from '../src/core/math.js';

// grass.js's own density-law exponent — not exported (module-private), reproduced here only
// to complete the oracle below; see the note above `const DENS_POW` in grass.js.
const DENS_POW = 1.5;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SEED = (+arg('seed', 20260726)) >>> 0;
const LAND = arg('terrain', 'meadow');
const KM = +arg('km', 3);
const DT = 1 / 60;

applyTerrain(LAND);
setBiomeBias(terrainBias(LAND));
const CAR = FLEET_BY_ID[FIRST_CAR];
applyCarFeel(CAR);

let tcx = 0,
  tcz = 0,
  terr = null;
const localFor = (x, z) => {
  if (!terr || Math.abs(x - tcx) > 240 || Math.abs(z - tcz) > 240) {
    terr = new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
    tcx = x;
    tcz = z;
  }
  return terr;
};
const spawn = findSpawn(SEED);
const car = new Vehicle({ tier: CAR.tier, terrain: localFor(spawn.x, spawn.z), preset: CAR.feel.assist });
car.placeAt(spawn.x, spawn.z, spawn.heading);

const auto = new Autopilot();
auto.toggle(car); // auto.on = true from here — this IS what gates DRIFT in main.js
auto.cruise = 26.4;

const camera = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);
const chase = new ChaseCamera(camera, { mode: 'sport' });

const scene = new Object3D();
const grass = new Grass({ seed: SEED, scene });
grass.setAngular((camera.fov * DEG) / 1080); // matches main.js's real call

/* ── the independent reference test, run twice per sample: once fed the CAR (the pre-fix
 * behaviour), once fed the TRUE camera (the fix) — a line-for-line copy of EVERY gate
 * `_draw()` applies before it sets `mesh.visible`, including the density/fade "n <= 0" gate,
 * not just the distance/cone tests — otherwise a chunk `_draw()` correctly thins to zero
 * instances at its own fade edge would read as a false "disagreement" below, for a reason
 * that has nothing to do with the car/camera fix. Kept here ONLY as an oracle to check the
 * real code against, never as a second implementation the game depends on. */
function wouldBeVisible(chunk, R, refX, refY, refZ, cull) {
  if (chunk.count === 0) return false;
  const cs = R.cs;
  const nearW = Math.max(7, R.near * 0.26);
  const farW = R.far * 0.26;
  const dx = chunk.wx - refX;
  const dy = chunk.wy - refY;
  const dz = chunk.wz - refZ;
  const dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dd - cs * 0.75 > R.far) return false;
  if (dd + cs * 0.75 < R.near - nearW) return false;
  if (dd > cs * 1.6) {
    const inv = 1 / Math.sqrt(dx * dx + dz * dz || 1);
    const pad = (cs * 0.75) / dd;
    if ((dx * cull.x + dz * cull.y) * inv < cull.z - pad) return false;
  }
  const nx = Math.max(Math.abs(dx) - cs * 0.5, 0);
  const nz = Math.max(Math.abs(dz) - cs * 0.5, 0);
  const dNear = Math.max(Math.sqrt(nx * nx + nz * nz + dy * dy), R.dn);
  const dens = Math.min(1, Math.pow(R.dn / dNear, DENS_POW));
  let f = 1;
  if (R.near > 0.01) f *= smoothstep(R.near - nearW - cs * 0.6, R.near + nearW, dd);
  f *= 1 - smoothstep(R.far - farW, R.far + cs * 0.6, dd);
  const cf = chunk.frac;
  const keep = Math.min(dens, cf);
  const n = Math.round(chunk.count * (keep / cf) * clamp01(f));
  return n > 0;
}

const dir = new Vector3();
let simClock = 0;
let frames = 0;
let traveled = 0;
let lastX = car.x,
  lastZ = car.z;
const TARGET_M = KM * 1000;

/* ── sampling ── */
let samples = 0;
let popEvents = 0; // car-relative says NO, camera-relative says YES: a chunk that should be
// visible from the real lens but the pre-fix test would have hidden
let mismatchAgainstReal = 0; // camera-relative oracle vs the REAL mesh.visible grass.js set
let checkedReal = 0;
let maxOffset = 0;
let maxAngleDeg = 0;
const worstPops = [];
const offsetTrace = [];
let grassUpdateMsTotal = 0;
let grassUpdateMsMax = 0;

while (traveled < TARGET_M && frames < 200000) {
  car.terrain = localFor(car.x, car.z);
  const cmd = auto.update(car, { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true }, DT);
  car.update(DT, cmd || { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true });

  chase.update(car, DT, (x, z) => car.terrain.height(x, z), { drift: auto.on });

  // exactly main.js's own sequence: true camera published to U, THEN grass.update(car pos)
  U.uCamPos.value.copy(camera.position);
  camera.getWorldDirection(dir);
  U.uCull.value.set(dir.x, dir.z, Math.cos(1.15), 0);

  simClock += DT * 1000;
  const tg0 = performance.now();
  grass.update(car.x, car.z, car.y, DT);
  const gms = performance.now() - tg0;
  grassUpdateMsTotal += gms;
  grassUpdateMsMax = Math.max(grassUpdateMsMax, gms);

  const offset = Math.hypot(camera.position.x - car.x, camera.position.z - car.z);
  // The sport rig sits BEHIND the car (bearing car.yaw + PI); the number worth reporting is
  // how far the DRIFT orbit has swung it away from that "directly behind" reference, not the
  // raw car->camera bearing (which is always close to 180 deg for any chase camera at all,
  // drift or not, and would make every sample look like an extreme swing).
  const toCam = Math.atan2(camera.position.x - car.x, camera.position.z - car.z);
  let orbitRad = toCam - (car.yaw + Math.PI);
  orbitRad = ((orbitRad % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  const angleOff = Math.abs((orbitRad * 180) / Math.PI);
  maxOffset = Math.max(maxOffset, offset);
  maxAngleDeg = Math.max(maxAngleDeg, angleOff);

  if (frames % 5 === 0) {
    offsetTrace.push({ t: simClock / 1000, offset, angleOff });
    const cull = U.uCull.value;
    for (const ring of grass._rings) {
      const R = ring.R;
      for (const chunk of ring.slots) {
        if (!chunk || chunk.count === 0) continue;
        samples++;
        const carOK = wouldBeVisible(chunk, R, car.x, car.y, car.z, cull);
        const camOK = wouldBeVisible(chunk, R, camera.position.x, camera.position.y, camera.position.z, cull);
        if (camOK && !carOK) {
          popEvents++;
          if (worstPops.length < 8) {
            worstPops.push({ t: simClock / 1000, ring: R.cs, offset, angleOff, dist: Math.hypot(chunk.wx - camera.position.x, chunk.wz - camera.position.z) });
          }
        }
        // cross-check the REAL code against the oracle fed the true camera — proves the FIX
        // ITSELF, not just this tool's model of it, agrees.
        checkedReal++;
        const realVisible = chunk.mesh.visible;
        if (realVisible !== camOK) mismatchAgainstReal++;
      }
    }
  }
  traveled += Math.hypot(car.x - lastX, car.z - lastZ);
  lastX = car.x;
  lastZ = car.z;
  frames++;
}

console.log(`\n=== cinematic-camera grass residency, seed ${SEED}, terrain "${LAND}", ${(traveled / 1000).toFixed(2)} km / ${(simClock / 1000).toFixed(0)} s driven ===`);
console.log(`autopilot cruise ${auto.cruise.toFixed(1)} m/s, drift engaged the whole run (auto.on=${auto.on})`);
console.log(`camera-vs-car offset during the drive: max ${maxOffset.toFixed(1)} m, orbit swing off "directly behind": max ${maxAngleDeg.toFixed(1)} deg`);
console.log(`Grass.update() cost: mean ${(grassUpdateMsTotal / frames).toFixed(3)} ms/frame, worst single frame ${grassUpdateMsMax.toFixed(2)} ms, over ${frames} frames`);

console.log(`\n-- resident-chunk visibility samples: ${samples} (every 5th frame, all four rings) --`);
console.log(`  chunks the TRUE camera should see but the OLD car-relative test would have hidden (the pop-out bug): ${popEvents} (${((100 * popEvents) / Math.max(1, samples)).toFixed(2)}%)`);
if (worstPops.length) {
  console.log('  examples (camera offset from car / orbit swing off "directly behind" / chunk distance from the real lens):');
  for (const p of worstPops) {
    console.log(`    t=${p.t.toFixed(1)}s  ring ${p.ring}m  cam offset ${p.offset.toFixed(1)} m, orbit swing ${p.angleOff.toFixed(0)} deg  ->  chunk ${p.dist.toFixed(0)} m from the real lens, wrongly hidden`);
  }
}

console.log(`\n-- the REAL grass.js's actual mesh.visible vs. the camera-relative oracle: ${checkedReal} checks --`);
console.log(`  disagreements: ${mismatchAgainstReal} (${((100 * mismatchAgainstReal) / Math.max(1, checkedReal)).toFixed(3)}%)  [0 means the fix in the actual source is doing exactly what the oracle says it should]`);

console.log('\n-- camera offset/angle over time (every ~1.7s) --');
const step = Math.max(1, Math.floor(offsetTrace.length / 12));
for (let i = 0; i < offsetTrace.length; i += step) {
  const o = offsetTrace[i];
  console.log(`  t=${o.t.toFixed(0).padStart(4)}s  offset ${o.offset.toFixed(1).padStart(5)} m  orbit swing ${o.angleOff.toFixed(0).padStart(3)} deg`);
}
