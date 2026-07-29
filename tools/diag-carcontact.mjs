/* created by AI
 * Wanderoad — DO THE DRAWN WHEELS TOUCH THE DRAWN GROUND?
 *
 * The operator's marks 27/28/29: "all four wheels on the road — issue still", "front wheels
 * digging in — sometimes issue", "wheels clipping right through the ground — still a little".
 * An earlier round fixed the RIDE HEIGHT (the render used SUSPENSION.restLength where the
 * springs actually sit ~85-115 mm compressed) and the residual is still being seen, so this
 * measures the thing itself rather than that one number: it builds the REAL rig the live game
 * builds (src/car/loadedCar.js's GLB cars — main.js loads those and only falls back to
 * model.js), places it EXACTLY as main.js's render block places it:
 *
 *     group.position.set(car.x, car.y - 0.36 + car.sag, car.z)
 *     group.rotation.set(0, car.yaw, 0)
 *     model.setBodyRoll(car.roll, car.pitch)
 *     model.setSteer(car.steerAngle)
 *
 * ...then takes REAL TYRE VERTICES — the lowest 6% of each wheel mesh's own vertices, i.e. the
 * contact patch and the tread either side of it — carries them into world space every frame and
 * compares each one with terrain.height() directly underneath it. Real geometry against the
 * real driven surface: a field, a flag or a ride-height constant is not a wheel touching a road
 * (gotcha 3).
 *
 *   penetration > 0  =  tyre BELOW the ground (digging in / clipping through)
 *   penetration < 0  =  tyre floating above it
 *
 * ONLY ON-ROAD FRAMES COUNT (onRoadMin > 0.85). A wheel hanging over a road's own 20-35°
 * embankment batter is a different, already-known thing; the complaint is about the road.
 *
 * WHY THE ANSWER IS NOT "car.sag": with a GLB car, setBodyRoll rotates the `attitude` node,
 * which contains the WHOLE car INCLUDING ITS WHEELS (loadedCar.js), about the contact plane at
 * the car's CENTRE. So every degree of body attitude that is NOT the ground plane — the
 * cosmetic spring lean and the dive — drives the outboard/forward tyres straight into the
 * terrain by halfTrack·sin(lean) and halfWheelbase·sin(dive). That is a RENDERING fact, not a
 * physics one, and it is only visible from here.
 *
 * NOTE ON THE RIG: Quaternius packs give three wheel nodes, not four — the two rear tyres are
 * one `BackWheels` mesh. Measuring per-VERTEX rather than per-hub is what makes that harmless.
 *
 *   node tools/diag-carcontact.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Vector3, Matrix4 } from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* GLTFLoader wants a URL and a fetch; node has fetch but not the file. Same shim
 * tools/diag-wheelwobble.mjs uses, scoped to a scheme nothing real can collide with. */
if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (req, init) => {
  const url = typeof req === 'string' ? req : req.url;
  if (url.startsWith('wr-local://')) {
    return new Response(readFileSync(path.join(ROOT, 'public', url.slice('wr-local://'.length))), {
      status: 200, headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
  return realFetch(req, init);
};

const { Vehicle } = await import('../src/car/vehicle.js');
const { Autopilot } = await import('../src/car/autopilot.js');
const { Terrain, findSpawn } = await import('../src/world/terrain.js');
const { PHYSICS_DT } = await import('../src/car/tuning.js');
const { loadCar } = await import('../src/car/loadedCar.js');
const { FLEET, applyCarFeel } = await import('../src/game/garage.js');

const SEED = 20260726;
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
const ON_ROAD = 0.85;

/* ── the contact patch, in real vertices ───────────────────────────────────── */

/**
 * The lowest `frac` of each wheel mesh's vertices, expressed in the MESH's own local frame
 * with the mesh's own matrix, ready to be re-transformed every frame. Picked once, at spin 0
 * and steer 0 — the tyre is a solid of revolution, so which vertices are "the bottom" changes
 * as it spins, but the SET of tread vertices does not, and every one of them passes through
 * the contact patch. Taking the whole tread band and asking for the lowest each frame is
 * therefore exact, not a sample.
 */
function treadPoints(model, frac = 0.34) {
  const out = [];
  for (const w of model.wheels) {
    w.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const local = [];
      for (let i = 0; i < pos.count; i++) local.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
      // radius about the wheel's own axle (local X for these packs, after the rig's re-parent)
      const withR = local.map((p) => ({ p, r: Math.hypot(p.y, p.z) }));
      withR.sort((a, b) => b.r - a.r);
      const keep = Math.max(8, Math.round(withR.length * frac));
      out.push({ mesh: o, pts: withR.slice(0, keep).map((e) => e.p) });
    });
  }
  return out;
}

const _w = new Vector3();
const _mm = new Matrix4();
/** Worst tyre penetration this frame, in mm (positive = below ground). */
function worstPenetration(tread, terrain) {
  let worst = -1e9;
  for (const { mesh, pts } of tread) {
    _mm.copy(mesh.matrixWorld);
    for (const p of pts) {
      _w.copy(p).applyMatrix4(_mm);
      const gy = terrain.height(_w.x, _w.z);
      const pen = gy - _w.y;
      if (pen > worst) worst = pen;
    }
  }
  return worst * 1000;
}

/** main.js's own render block, verbatim in effect. */
function placeModel(model, car) {
  model.group.position.set(car.x, car.y - 0.36 + (car.sag || 0), car.z);
  model.group.rotation.set(0, car.yaw, 0);
  model.setBodyRoll(car.roll, car.pitch);
  model.setSteer(car.steerAngle || 0);
  model.setWheelSpin(car.wheelSpin);
  model.group.updateMatrixWorld(true);
}

/* ── the drives ─────────────────────────────────────────────────────────────── */

const freshTerrain = (x, z) => new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);

/**
 * Real Autopilot down a real road. `wiggleHz`/`wiggleAmp` superimpose a steering input on the
 * chauffeur's, which is what a keyboard driver's corrections look like and what actually loads
 * the body's roll spring — a hands-off chauffeur corners so gently it never asks the lean for
 * anything, and measuring THAT would flatter the result.
 */
function drive(model, tread, secs, { tier = 'sports', wiggleHz = 0, wiggleAmp = 0, cruise = 22 } = {}) {
  const spawn = findSpawn(SEED);
  let terr = freshTerrain(spawn.x, spawn.z);
  const car = new Vehicle({ tier, terrain: terr, preset: 'sport' });
  car.placeAt(spawn.x, spawn.z, spawn.heading);
  const auto = new Autopilot({ cruise });
  auto.toggle(car);
  let cx = spawn.x, cz = spawn.z;

  const B = {
    flat: { dig: -1e9, n: 0 },
    climb: { dig: -1e9, n: 0 },
    descent: { dig: -1e9, n: 0 },
  };
  let worst = -1e9, where = null, offRoadFrames = 0, total = 0;

  const n = Math.round(secs / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    if (Math.abs(car.x - cx) > 240 || Math.abs(car.z - cz) > 240) {
      terr = freshTerrain(car.x, car.z);
      car.terrain = terr;
      cx = car.x; cz = car.z;
    }
    let cmd = auto.update(car, NEUTRAL, PHYSICS_DT) || { ...NEUTRAL, analogue: true, auto: true };
    if (wiggleAmp > 0) {
      const t = i * PHYSICS_DT;
      cmd = { ...cmd, steer: Math.max(-1, Math.min(1, (cmd.steer || 0) + wiggleAmp * Math.sin(2 * Math.PI * wiggleHz * t))), analogue: true };
    }
    car._step(PHYSICS_DT, cmd);
    if (!auto.on) auto.toggle(car);

    if (i % 2 !== 0) continue;              // sample at 60 Hz — this is a RENDER measurement
    if (i * PHYSICS_DT < 2) continue;       // let the initial drop settle
    total++;
    if (car.onRoadMin < ON_ROAD) { offRoadFrames++; continue; }

    placeModel(model, car);
    const dig = worstPenetration(tread, terr);
    const gradeDeg = (car.groundPitch * 180) / Math.PI;   // + = nose up = climbing
    const b = B[gradeDeg > 2.5 ? 'climb' : gradeDeg < -2.5 ? 'descent' : 'flat'];
    b.n++;
    if (dig > b.dig) b.dig = dig;
    if (dig > worst) {
      worst = dig;
      where = {
        kph: car.kph, gradeDeg,
        rollDeg: (car.roll * 180) / Math.PI, pitchDeg: (car.pitch * 180) / Math.PI,
        leanDeg: (car._lean * 180) / Math.PI, diveDeg: (car._dive * 180) / Math.PI,
        sagMM: (car.sag || 0) * 1000, latG: car.latAccel / 9.81,
      };
    }
  }
  return { B, worst, where, onRoadFrac: 1 - offRoadFrames / Math.max(total, 1) };
}

/* ── report ─────────────────────────────────────────────────────────────────── */

const mm = (v) => (v <= -1e8 ? '     —' : `${v >= 0 ? '+' : ''}${v.toFixed(0)} mm`);

console.log('\n══ THE DRAWN WHEELS AGAINST THE DRIVEN GROUND ══════════════════════════════');
console.log(`   seed ${SEED}, real Terrain + real Roads, real Autopilot, real GLB rig,`);
console.log('   placed exactly as main.js places it. On-road frames only (onRoadMin > 0.85).');
console.log('   Positive = tyre UNDER the tarmac.\n');

const PICK = ['estate', 'coupe', 'patrol'];
let worstAll = -1e9, worstAllLabel = '';

for (const id of PICK) {
  const spec = FLEET.find((c) => c.id === id);
  applyCarFeel(spec);
  const model = await loadCar({ car: spec.id, base: 'wr-local://models/cars/' });
  const tread = treadPoints(model);
  const nPts = tread.reduce((a, t) => a + t.pts.length, 0);
  console.log(`── ${spec.label} (${spec.id}, tier ${spec.tier}) — ${tread.length} wheel meshes, ${nPts} tread vertices tested/frame`);
  for (const [label, opts] of [
    ['chauffeur, hands off', { tier: spec.tier }],
    ['+ keyboard weave', { tier: spec.tier, wiggleHz: 0.6, wiggleAmp: 0.55 }],
    ['+ fast weave', { tier: spec.tier, wiggleHz: 1.6, wiggleAmp: 0.4, cruise: 30 }],
  ]) {
    const r = drive(model, tread, 26, opts);
    const parts = ['flat', 'climb', 'descent']
      .filter((k) => r.B[k].n)
      .map((k) => `${k} ${mm(r.B[k].dig)}(${r.B[k].n})`)
      .join('   ');
    console.log(`   ${label.padEnd(22)} ${parts}`);
    if (r.where) {
      const w = r.where;
      console.log(
        `   ${''.padEnd(22)} WORST ${mm(r.worst)} @ ${w.kph.toFixed(0)} km/h  grade ${w.gradeDeg.toFixed(1)}°  ` +
        `roll ${w.rollDeg.toFixed(2)}°  pitch ${w.pitchDeg.toFixed(2)}°  lean ${w.leanDeg.toFixed(2)}°  ` +
        `dive ${w.diveDeg.toFixed(2)}°  latG ${w.latG.toFixed(2)}  sag ${w.sagMM.toFixed(0)} mm  ` +
        `[${(r.onRoadFrac * 100).toFixed(0)}% on road]`
      );
    }
    if (r.worst > worstAll) { worstAll = r.worst; worstAllLabel = `${spec.id} / ${label}`; }
  }
  model.dispose?.();
  console.log('');
}

console.log(`WORST TYRE PENETRATION, ON THE ROAD: ${mm(worstAll)}  — ${worstAllLabel}`);
console.log('   10 mm is invisible. 50 mm is a visible sink. 100 mm is buried to the axle line,');
console.log('   which is what "wheels clipping right through the ground" means.\n');
