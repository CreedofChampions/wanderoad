/* Wanderoad — does a wheel actually spin round its own axle?
 *
 *   node tools/diag-wheelwobble.mjs
 *
 * The operator's report was "wheels don't spin perfectly round — they wobble oddly". That is
 * not a thing source review can settle, because a wheel's on-screen motion is the product of
 * three nested nodes and a lump of geometry whose origin nobody controls (the GLB cars come
 * from a pack). So this measures it, headless, on the REAL rig both builders produce.
 *
 * Two numbers per wheel, both of which are zero for a wheel that spins true:
 *
 *   ROUND  — take the rim point furthest from the hub. Spin the wheel through a full turn and
 *            measure that point's distance from the AXLE LINE (the line through the wheel's
 *            own geometric centre, in the body frame, at spin = 0). A wheel whose geometry is
 *            centred on the node it spins on traces a perfect circle about that line, so the
 *            distance never changes. A wheel whose geometry sits off its spin node ORBITS:
 *            the distance swings by twice the offset, and that is the wobble. Reported in mm.
 *
 *   AXIS   — the wheel's own axle direction, in the body frame, sampled through the same full
 *            turn. It must not move. If spin and steer ever share one Euler, or the spin is
 *            applied on a node whose frame is not the steered wheel's, the axle sweeps a cone
 *            and the wheel visibly judders. Reported in degrees.
 *
 * Both are measured at several steer angles, because a rig can be true straight-ahead and
 * wrong on lock — that is precisely the bug this file's predecessor was written for.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Vector3, Box3, Matrix4 } from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* GLTFLoader wants a URL and a fetch. Node has fetch but not the file. One shim, scoped to a
 * scheme that cannot collide with anything real, and the loader is none the wiser. */
if (typeof globalThis.ProgressEvent === 'undefined') {
  // three's FileLoader reports download progress with one; node has no DOM events.
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (req, init) => {
  const url = typeof req === 'string' ? req : req.url;
  if (url.startsWith('wr-local://')) {
    const p = path.join(ROOT, 'public', url.slice('wr-local://'.length));
    return new Response(readFileSync(p), {
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  }
  return realFetch(req, init);
};

const { buildCar } = await import(new URL('../src/car/model.js', import.meta.url));
const { loadCar, CAR_KEYS } = await import(new URL('../src/car/loadedCar.js', import.meta.url));

/* ── measurement ───────────────────────────────────────────────────────────── */

const STEERS = [0, 0.12, -0.12, 0.35, -0.35];
const SPIN_STEPS = 72; // every 5°

/** World-space AABB of a node's own meshes (not its parents'). */
function meshBox(node) {
  const box = new Box3();
  node.updateMatrixWorld(true);
  node.traverse((o) => { if (o.isMesh) box.expandByObject(o); });
  return box;
}

/**
 * One wheel, one steer angle. `model` is the car api, `wheel` the node that spin is applied
 * to, `pick` a rim point expressed in that node's LOCAL frame.
 *
 * Everything is measured in the CAR BODY frame (group's inverse world matrix), so the car's
 * own yaw/roll/pitch cannot flatter or spoil the number.
 */
function sweep(model, wheel, pick) {
  const inv = new Matrix4();
  const p = new Vector3();
  const axis = new Vector3();
  const centre = new Vector3();

  const sample = (spin) => {
    model.setWheelSpin(spin);
    model.group.updateMatrixWorld(true);
    inv.copy(model.group.matrixWorld).invert();
    // rim point, in body space
    p.copy(pick).applyMatrix4(wheel.matrixWorld).applyMatrix4(inv);
    // the wheel's own +X (the axle), in body space, direction only
    axis.set(1, 0, 0).transformDirection(wheel.matrixWorld).transformDirection(inv).normalize();
    // the wheel's geometric centre, in body space
    const b = meshBox(wheel);
    b.getCenter(centre);
    centre.applyMatrix4(inv);
    return { p: p.clone(), axis: axis.clone(), centre: centre.clone() };
  };

  const ref = sample(0);
  let rMin = Infinity, rMax = -Infinity, axisDrift = 0, centreWander = 0;
  const d = ref.axis;                 // axle direction, frozen at spin = 0
  const c0 = ref.centre;              // a point on the axle line, frozen at spin = 0

  for (let i = 0; i <= SPIN_STEPS; i++) {
    const s = sample((i / SPIN_STEPS) * Math.PI * 2);
    const v = s.p.clone().sub(c0);
    const r = v.clone().sub(d.clone().multiplyScalar(v.dot(d))).length();
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    axisDrift = Math.max(axisDrift, Math.acos(Math.min(1, Math.abs(s.axis.dot(d)))));
    centreWander = Math.max(centreWander, s.centre.distanceTo(c0));
  }
  model.setWheelSpin(0);
  return {
    roundMM: (rMax - rMin) * 1000,
    axisDeg: (axisDrift * 180) / Math.PI,
    centreMM: centreWander * 1000,
    radius: rMax,
  };
}

/** The rim point to track: the vertex furthest from the spin node's origin in YZ. */
function rimPoint(wheel) {
  wheel.updateMatrixWorld(true);
  const toNode = new Matrix4().copy(wheel.matrixWorld).invert();
  const v = new Vector3();
  let best = null, bestR = -1;
  wheel.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const m = new Matrix4().multiplyMatrices(toNode, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const r = Math.hypot(v.y, v.z);
      if (r > bestR) { bestR = r; best = v.clone(); }
    }
  });
  return best || new Vector3();
}

/**
 * Which way do the front wheels point on lock?
 *
 * `node tools/diag-wheelwobble.mjs --sign` prints the physics that settles it: a positive
 * `car.steerAngle` is a positive yaw rate, so the nose swings toward +X and the front wheels
 * must point toward +X too. Three's +X is the driver's LEFT looking down +Z, which is exactly
 * why nobody should reason about this sign — measure it.
 *
 * Returns the front wheels' forward direction, X component, at +20° of lock. Must be > 0.
 */
function steerDirX(model) {
  model.setSteer(0);
  model.setWheelSpin(0);
  model.group.updateMatrixWorld(true);
  const inv = new Matrix4().copy(model.group.matrixWorld).invert();
  const p = new Vector3();
  // The front wheels are the ones furthest toward +Z in the car's own frame.
  const z = model.wheels.map((w) => p.setFromMatrixPosition(w.matrixWorld).applyMatrix4(inv).z);
  const zMax = Math.max(...z);
  const front = model.wheels.filter((w, i) => z[i] > zMax - 0.25);
  model.setSteer(0.35);
  model.group.updateMatrixWorld(true);
  let worst = Infinity;
  const d = new Vector3();
  for (const w of front) {
    d.set(0, 0, 1).transformDirection(w.matrixWorld).transformDirection(inv).normalize();
    worst = Math.min(worst, d.x);
  }
  model.setSteer(0);
  model.group.updateMatrixWorld(true);
  return { x: worst, n: front.length };
}

/**
 * Is body attitude applied in the CAR's frame or the world's?
 *
 * main.js writes `group.rotation.set(0, car.yaw, 0)` and then calls setBodyRoll(). If roll and
 * pitch land on that same Euler, XYZ order applies the pitch OUTSIDE the yaw — about the world
 * X axis — and a car heading due east pitches by leaning over sideways instead. Point the car
 * at +X, pitch it, and watch what actually moves.
 *
 * Returns the two numbers that tell them apart:
 *   nose  — how much the body's own forward axis tips. Should be -sin(pitch): rotation.x takes
 *           +Z toward -Y, so a positive `car.pitch` is nose-DOWN. That sign is vehicle.js's
 *           business and is not asserted here beyond both builders agreeing on it — which is
 *           the property that actually matters, since main.js drives them identically.
 *   lean  — how much the body's own lateral axis tips. Must be ~0. A car pointed at +X that
 *           leans when it is asked to pitch is the world-frame bug.
 */
function attitudeFrame(model, pitch = 0.20) {
  // The biggest mesh that is not a wheel is the shell, and it is the thing being pitched.
  let shell = null, bestN = -1;
  const wheelSet = new Set();
  for (const w of model.wheels) w.traverse((o) => wheelSet.add(o));
  model.group.traverse((o) => {
    if (!o.isMesh || wheelSet.has(o)) return;
    const n = o.geometry.attributes.position.count;
    if (n > bestN) { bestN = n; shell = o; }
  });
  model.setBodyRoll(0, 0);
  model.group.rotation.set(0, Math.PI / 2, 0); // heading due +X
  model.setBodyRoll(0, pitch);
  model.group.updateMatrixWorld(true);
  const fwd = new Vector3(0, 0, 1).transformDirection(shell.matrixWorld).normalize();
  const lat = new Vector3(1, 0, 0).transformDirection(shell.matrixWorld).normalize();
  model.setBodyRoll(0, 0);
  model.group.rotation.set(0, 0, 0);
  model.group.updateMatrixWorld(true);
  return { nose: fwd.y, lean: lat.y, want: -Math.sin(pitch) };
}

function report(name, model) {
  const nodes = model.wheels;
  console.log(`\n── ${name} — ${nodes.length} wheel node(s) ──────────────────────────────`);
  let worstRound = 0, worstAxis = 0, worstCentre = 0;
  for (let wi = 0; wi < nodes.length; wi++) {
    const wheel = nodes[wi];
    model.setSteer(0);
    model.setWheelSpin(0);
    model.group.updateMatrixWorld(true);
    const pick = rimPoint(wheel);
    const rows = [];
    for (const st of STEERS) {
      model.setSteer(st);
      model.group.updateMatrixWorld(true);
      const r = sweep(model, wheel, pick);
      rows.push(r);
      worstRound = Math.max(worstRound, r.roundMM);
      worstAxis = Math.max(worstAxis, r.axisDeg);
      worstCentre = Math.max(worstCentre, r.centreMM);
    }
    model.setSteer(0);
    const label = (wheel.name || `wheel${wi}`).padEnd(22);
    const worst = rows.reduce((a, b) => (b.roundMM > a.roundMM ? b : a));
    console.log(
      `   ${label} r=${worst.radius.toFixed(3)}m  ROUND ${worst.roundMM.toFixed(1).padStart(8)} mm` +
      `   AXIS ${rows.reduce((a, b) => Math.max(a, b.axisDeg), 0).toFixed(3).padStart(7)}°` +
      `   centre-wander ${worst.centreMM.toFixed(1).padStart(7)} mm`
    );
  }
  const st = steerDirX(model);
  const at = attitudeFrame(model);
  /* Re-pivoting a wheel must not MOVE it. Both builders put the car's lowest point on y = 0
   * — that is what makes the tyres touch the road — so if the rig displaced a corner while
   * re-parenting it, the car stops sitting on the ground and this drifts off zero. */
  model.setSteer(0);
  model.setWheelSpin(0);
  model.group.rotation.set(0, 0, 0);
  model.group.position.set(0, 0, 0);
  model.group.updateMatrixWorld(true);
  const sit = new Box3().setFromObject(model.group).min.y;
  console.log(`   WORST: round ${worstRound.toFixed(1)} mm, axis ${worstAxis.toFixed(3)}°, centre ${worstCentre.toFixed(1)} mm`);
  console.log(`   steer +20° on ${st.n} front wheel(s): forward.x = ${st.x.toFixed(3)} (must be > 0, i.e. into the turn)`);
  console.log(`   pitch +0.20 rad heading +X: nose ${at.nose.toFixed(3)} (want ${at.want.toFixed(3)}), lean ${at.lean.toFixed(3)} (want 0.000)`);
  console.log(`   car sits with its lowest point at y = ${sit.toFixed(4)} m (want 0.0000 — nothing moved)`);
  return { worstRound, worstAxis, worstCentre, steerX: st.x, nose: at.nose, lean: at.lean, wantNose: at.want, sit };
}

/* ── which way is "into the turn"? ─────────────────────────────────────────────
 * Not a matter of opinion, and not a matter of reading the source: three's +X is the
 * driver's LEFT looking down +Z and this repo has had the sign backwards three times. Drive
 * the real Vehicle with full right stick for a second and see where it ends up. Everything
 * below asserts the wheels point the same way the car actually goes. */
async function physicsSteerSign() {
  const { Vehicle } = await import(new URL('../src/car/vehicle.js', import.meta.url));
  const { PHYSICS_DT } = await import(new URL('../src/car/tuning.js', import.meta.url));
  const FLAT = {
    surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
    height: () => 0,
  };
  const car = new Vehicle({ tier: 'sports', terrain: FLAT, preset: 'off' });
  car.placeAt(0, 0, 0);
  car.vz = 20;
  const IN = { steer: 1, throttle: 0.3, brake: 0, handbrake: 0, analogue: true };
  for (let i = 0; i < 120; i++) car._step(PHYSICS_DT, IN);
  return { steerAngle: car.steerAngle, yaw: car.yaw, x: car.x, z: car.z };
}

/* ── run ───────────────────────────────────────────────────────────────────── */

console.log('── steering sign, from the physics ───────────────────────────────');
try {
  const s = await physicsSteerSign();
  console.log(
    `   full right stick, 1 s: steerAngle ${s.steerAngle.toFixed(4)}  yaw ${s.yaw.toFixed(3)}` +
    `  ended at x ${s.x.toFixed(2)} m, z ${s.z.toFixed(2)} m`
  );
  console.log(
    `   positive steerAngle drives the car toward ${s.x > 0 ? '+X' : '-X'}, so the front wheels` +
    ` must point that way: wheel rotation.y = ${s.x > 0 ? '+' : '-'}steerAngle`
  );
} catch (e) {
  console.log(`   (could not measure — car/vehicle.js did not load: ${e.message})`);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const results = [];

for (const tier of ['gt', 'sports', 'hyper']) {
  if (only.length && !only.includes(tier)) continue;
  const m = buildCar({ tier, paint: 0 });
  results.push([`hand-built ${tier}`, report(`hand-built ${tier}`, m)]);
}

for (const car of CAR_KEYS) {
  if (only.length && !only.includes(car)) continue;
  const m = await loadCar({ car, paint: 0, base: 'wr-local://models/cars/' });
  results.push([`glb ${car}`, report(`glb ${car}`, m)]);
}

console.log('\n══ summary ═══════════════════════════════════════════════════════');
let bad = 0;
for (const [name, r] of results) {
  // 1 mm of rim wander on a 340 mm wheel is invisible; 10 mm is the operator's "wobble".
  const round = r.worstRound < 1.0 && r.worstAxis < 0.05;
  const steer = r.steerX > 0.05;
  const attitude = Math.abs(r.nose - r.wantNose) < 0.02 && Math.abs(r.lean) < 0.02;
  const sits = Math.abs(r.sit) < 0.01;
  const ok = round && steer && attitude && sits;
  if (!ok) bad++;
  const why = [round ? null : 'WOBBLE', steer ? null : 'STEERS-OUT',
    attitude ? null : 'PITCH-IN-WORLD-FRAME', sits ? null : 'OFF-THE-GROUND']
    .filter(Boolean).join(' ');
  console.log(
    `${ok ? ' PASS' : ' FAIL'}  ${name.padEnd(20)} round ${r.worstRound.toFixed(2).padStart(8)} mm` +
    `   axis ${r.worstAxis.toFixed(3).padStart(7)}°   centre ${r.worstCentre.toFixed(2).padStart(8)} mm` +
    `   steer.x ${r.steerX.toFixed(3).padStart(6)}   nose ${r.nose.toFixed(3).padStart(6)}` +
    `   lean ${r.lean.toFixed(3).padStart(6)}   sits ${r.sit.toFixed(4).padStart(7)}` +
    (why ? `   ${why}` : '')
  );
}
console.log(`\n${bad === 0 ? 'ALL WHEELS SPIN TRUE' : bad + ' CAR(S) WRONG'}\n`);
process.exitCode = bad ? 1 : 0;
