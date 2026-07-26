/* Wanderoad — does the camera actually move, and can you actually drive afterwards?
 *
 * This project has shipped a build where the flag was set and the pixels were wrong, so the
 * bar for a camera change is measured geometry, not "it runs". Everything below drives the
 * REAL modules — the real Cinematic, the real ChaseCamera, the real Vehicle on real generated
 * terrain — at a fixed 60 Hz, and reads the camera's world position back out of a real
 * three.js PerspectiveCamera afterwards.
 *
 * It answers, in order:
 *   1. the intro's shot list, its duration, and where the camera actually is over time
 *   2. that the camera never ends up underground (a shot you cannot see is not a shot)
 *   3. that the last frame of the intro lands EXACTLY on the chase camera's rest pose
 *   4. that any key ends it, and how long the hand-off takes
 *   5. that the car drives, and the chase camera follows it, once the intro is over
 *   6. that the auto-drive camera drifts, how fast, and that it returns to the sport camera
 *      bit-for-bit when the player takes the wheel back
 *
 * No renderer, no server, no browser. Run: node tools/diag-cinematic.mjs
 */

import { PerspectiveCamera } from 'three';
import { Terrain, findSpawn, landHeight } from '../src/world/terrain.js';
import { Vehicle } from '../src/car/vehicle.js';
import { ChaseCamera } from '../src/car/camera.js';
import { Autopilot } from '../src/car/autopilot.js';
import { Cinematic } from '../src/game/cinematic.js';
import { CAMERA } from '../src/car/tuning.js';

const SEED = Number(process.argv[2]) || 20260726;
const DT = 1 / 60;
const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: false };

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const f = (n, d = 2) => Number(n).toFixed(d);

function world() {
  const spawn = findSpawn(SEED);
  const terrain = new Terrain(SEED, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
  const car = new Vehicle({ tier: 'gt', terrain, preset: 'sport' });
  car.placeAt(spawn.x, spawn.z, spawn.heading);
  const camera = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);
  const chase = new ChaseCamera(camera, { mode: 'sport' });

  /* The same rolling local sampler main.js uses. Without it the Terrain runs out 420 m from
   * the spawn and every height past that is a clamped edge value — which reads as "the camera
   * went underground" when the truth is that the ruler ended. */
  let local = terrain;
  let lx = spawn.x;
  let lz = spawn.z;
  const localFor = (x, z) => {
    if (Math.abs(x - lx) > 240 || Math.abs(z - lz) > 240) {
      local = new Terrain(SEED, x - 420, z - 420, x + 420, z + 420);
      lx = x;
      lz = z;
    }
    return local;
  };
  const step = (dt, input) => {
    car.terrain = localFor(car.x, car.z);
    car.update(dt, input);
  };
  const ground = (x, z) => localFor(car.x, car.z).height(x, z);
  return { spawn, terrain, car, camera, chase, step, ground };
}

/* Ground height under an ARBITRARY point, carved roads included, anywhere in the world.
 * landHeight() is the raw land BEFORE the road network is cut into it, so measuring camera
 * clearance against it reports "20 m underground" any time the shot is over a cutting. The
 * renderer draws the carved surface, so the carved surface is the ruler. Rolling window,
 * because a Terrain is a bounded object and the intro camera roams a kilometre. */
function carvedSampler(seed) {
  let t = null;
  let cx = NaN;
  let cz = NaN;
  return (x, z) => {
    if (!t || Math.abs(x - cx) > 240 || Math.abs(z - cz) > 240) {
      t = new Terrain(seed, x - 420, z - 420, x + 420, z + 420);
      cx = x;
      cz = z;
    }
    return t.height(x, z);
  };
}

const camPos = (camera) => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/* ── 1..4: the intro ──────────────────────────────────────────────────────── */

console.log(`\n=== INTRO (seed ${SEED}) ===`);
{
  const { spawn, terrain, car, camera, chase, step, ground } = world();
  let ended = 0;
  const cine = new Cinematic({
    camera,
    seed: SEED,
    spawn,
    terrain,
    chase,
    groundAt: ground,
    mode: 'full',
    onEnd: () => {
      ended++;
      chase.reset();
    },
  });

  console.log(
    `  programme: ${cine.shots.map((s) => `${s.name} ${f(s.dur, 1)}s`).join(' | ')}   total ${f(cine.duration, 2)}s`,
  );
  const subj = cine.subjects;
  console.log(
    `  subjects:  landmark ${subj.landmark.h | 0} m tall, ${subj.landmark.d | 0} m away` +
      `   water ${subj.water ? `${subj.water.d | 0} m away at y=${f(subj.water.y, 1)}` : 'none within 1.5 km (rise shot substituted)'}`,
  );

  cine.begin();
  ok(cine.active, 'intro is running after begin()');

  const samples = [];
  let travelled = 0;
  let worstClearance = Infinity;
  let worstAt = null;
  let maxStep = 0;
  let prev = null;
  let t = 0;
  let frames = 0;
  let lastShot = '';
  const carved = carvedSampler(SEED);
  const cuts = [];
  const perShot = new Map();

  while (cine.active && t < 120) {
    // Physics keeps running underneath, exactly as it does in main.js.
    step(DT, NEUTRAL);
    cine.update(DT, car);
    t += DT;
    frames++;
    const p = camPos(camera);
    const g = carved(p.x, p.z);
    if (p.y - g < worstClearance) {
      worstClearance = p.y - g;
      worstAt = { name: cine.shotName, t };
    }
    /* Skip the frame a cut lands on. A cut is meant to be a discontinuity — measuring it as
     * camera velocity says "29 000 m/s" and means nothing. Count them separately instead. */
    const cut = cine.shotName !== lastShot;
    if (prev && !cut) {
      const d = dist(prev, p);
      travelled += d;
      if (d > maxStep) maxStep = d;
      const e = perShot.get(cine.shotName) || { d: 0, s: 0, peak: 0 };
      e.d += d;
      e.s += DT;
      if (d / DT > e.peak) e.peak = d / DT;
      perShot.set(cine.shotName, e);
    } else if (prev && cut) {
      cuts.push({ t, from: lastShot, to: cine.shotName, jump: dist(prev, p) });
    }
    lastShot = cine.shotName;
    if (frames % 90 === 0) samples.push({ t, name: cine.shotName, ...p, fov: camera.fov });
    prev = p;
  }

  console.log('\n  camera path — one sample every 1.5 s:');
  console.log('    t(s)   shot     x          y         z        fov   m above ground');
  for (const s of samples) {
    const g = carved(s.x, s.z);
    console.log(
      `    ${f(s.t, 2).padStart(5)}  ${s.name.padEnd(7)} ${f(s.x, 1).padStart(9)} ${f(s.y, 1).padStart(8)} ${f(s.z, 1).padStart(9)}  ${f(s.fov, 1).padStart(5)}  ${f(g === null ? 0 : s.y - g, 1).padStart(7)}`,
    );
  }

  console.log('\n  per shot (cut frames excluded — a cut is a discontinuity on purpose):');
  for (const [name, e] of perShot) {
    console.log(
      `    ${name.padEnd(7)} ${f(e.s, 2).padStart(6)} s   ${f(e.d, 1).padStart(7)} m travelled   mean ${f(e.d / e.s, 2).padStart(6)} m/s (${f((e.d / e.s) * 3.6, 0)} km/h)   peak ${f(e.peak, 2)} m/s`,
    );
  }
  console.log(`  cuts: ${cuts.map((c) => `${c.from}->${c.to} at ${f(c.t, 1)}s`).join(', ')}  (${cuts.length} in ${f(cine.duration, 0)} s — Ocarina's opening has four)`);
  console.log(`  road track: biggest gap between adjacent rail nodes ${f(cine.roadKink, 2)} m (5 m nominal; over 10 m falls back to a straight rail)`);

  ok(travelled > 200, 'the camera actually moves', `${f(travelled, 1)} m of camera travel`);
  ok(maxStep / DT < 25, 'no shot exceeds a cozy pace', `fastest frame ${f(maxStep / DT, 2)} m/s = ${f((maxStep / DT) * 3.6, 0)} km/h`);
  ok(cuts.length <= 4, 'a handful of cuts, not a montage', `${cuts.length}`);
  ok(worstClearance > 1.0, 'camera never goes underground', `closest ${f(worstClearance, 2)} m (${worstAt?.name} at ${f(worstAt?.t, 1)} s)`);
  ok(Math.abs(t - cine.duration) < 0.05, 'intro ran for its declared duration', `${f(t, 2)} s of ${f(cine.duration, 2)} s`);
  ok(ended === 1 && !cine.active, 'intro ended and handed control back exactly once');

  /* The hand-off. The last cinematic frame must be the pose the chase camera reproduces on
   * the very next frame, or there is a visible cut into gameplay. */
  const last = camPos(camera);
  const rest = chase.restPose(car, {}, ground);
  console.log(
    `\n  hand-off: intro ended at (${f(last.x, 3)}, ${f(last.y, 3)}, ${f(last.z, 3)}) ` +
      `vs chase rest pose (${f(rest.px, 3)}, ${f(rest.py, 3)}, ${f(rest.pz, 3)})`,
  );
  ok(dist(last, { x: rest.px, y: rest.py, z: rest.pz }) < 0.01, 'last intro frame == chase rest pose', `${f(dist(last, { x: rest.px, y: rest.py, z: rest.pz }) * 1000, 3)} mm apart`);

  /* ...and the very next chase-camera frame must not move it either. Physics is deliberately
   * NOT stepped in between: this is a test of camera continuity, and if the car is rolling the
   * camera is supposed to follow it. Whatever is left is the size of the cut. */
  chase.update(car, DT, ground, { drift: false });
  const first = camPos(camera);
  console.log(`  car was doing ${f(car.kph, 1)} km/h at the hand-off; first chase frame moved the camera ${f(dist(last, first) * 1000, 1)} mm`);
  ok(dist(last, first) < 0.05, 'first gameplay frame does not jump', `${f(dist(last, first) * 1000, 1)} mm`);

  /* Now drive it. This is the "is the game reachable" test: full throttle for four seconds
   * after the intro, and the car had better move and the camera had better follow. */
  const x0 = car.x;
  const z0 = car.z;
  for (let i = 0; i < 240; i++) {
    step(DT, { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: false });
    chase.update(car, DT, ground, { drift: false });
  }
  const moved = Math.hypot(car.x - x0, car.z - z0);
  const behind = Math.hypot(camera.position.x - car.x, camera.position.z - car.z);
  console.log(`\n  after the intro: 4 s of throttle moved the car ${f(moved, 1)} m to ${f(car.kph, 1)} km/h; camera is ${f(behind, 2)} m behind it`);
  ok(moved > 20 && car.kph > 25, 'the car is drivable after the intro');
  ok(behind > 3 && behind < 14, 'the chase camera is following it');
}

/* ── the skip ─────────────────────────────────────────────────────────────── */

console.log('\n=== SKIP (any key, 12 s in) ===');
{
  const { spawn, terrain, car, camera, chase, step, ground } = world();
  let ended = 0;
  const cine = new Cinematic({
    camera, seed: SEED, spawn, terrain, chase, groundAt: ground, mode: 'full',
    onEnd: () => { ended++; chase.reset(); },
  });
  cine.begin();
  let t = 0;
  while (t < 12) {
    step(DT, NEUTRAL);
    cine.update(DT, car);
    t += DT;
  }
  const atKey = camPos(camera);
  const before = cine.remaining;
  // This is what a keydown does — the same call main.js and the module's own window listener make.
  cine.skip();
  let after = 0;
  while (cine.active && after < 5) {
    step(DT, NEUTRAL);
    cine.update(DT, car);
    after += DT;
  }
  const rest = chase.restPose(car, {}, ground);
  const end = camPos(camera);
  console.log(`  key pressed ${f(t, 2)} s in, during the "${cine.shots[0].name === 'handoff' ? 'skipped' : ''}" programme with ${f(before, 2)} s still to run`);
  console.log(`  camera was at (${f(atKey.x, 1)}, ${f(atKey.y, 1)}, ${f(atKey.z, 1)}), ${f(dist(atKey, { x: rest.px, y: rest.py, z: rest.pz }), 1)} m from the gameplay pose`);
  ok(!cine.active, 'skip ended the intro');
  ok(after < 0.62, 'hand-off ease is under 0.62 s', `${f(after, 3)} s (${f(before, 1)} s of programme skipped)`);
  ok(ended === 1, 'onEnd fired once on a skip too');
  ok(dist(end, { x: rest.px, y: rest.py, z: rest.pz }) < 0.01, 'skip also lands on the chase rest pose', `${f(dist(end, { x: rest.px, y: rest.py, z: rest.pz }) * 1000, 3)} mm`);

  const x0 = car.x, z0 = car.z;
  for (let i = 0; i < 180; i++) {
    step(DT, { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: false });
    chase.update(car, DT, ground, { drift: false });
  }
  ok(Math.hypot(car.x - x0, car.z - z0) > 15, 'the car is drivable after a skip', `${f(Math.hypot(car.x - x0, car.z - z0), 1)} m in 3 s`);
}

/* Skipping on the very first frame, before anything has been drawn, must not leave a
 * half-built ease behind. */
console.log('\n=== SKIP before the first frame ===');
{
  const { spawn, terrain, car, camera, chase, ground } = world();
  let ended = 0;
  const cine = new Cinematic({ camera, seed: SEED, spawn, terrain, chase, groundAt: ground, mode: 'full', onEnd: () => { ended++; chase.reset(); } });
  cine.begin();
  cine.skip();
  ok(!cine.active && ended === 1, 'instant skip ends it immediately, no ease from a null pose');
}

/* ── the short programme ──────────────────────────────────────────────────── */

console.log('\n=== RETURN VISIT (short) and ?intro=off ===');
{
  const { spawn, terrain, car, camera, chase, step, ground } = world();
  const cine = new Cinematic({ camera, seed: SEED, spawn, terrain, chase, groundAt: ground, mode: 'short' });
  console.log(`  short programme: ${cine.shots.map((s) => s.name).join(', ')}   ${f(cine.duration, 2)} s`);
  cine.begin();
  let t = 0;
  while (cine.active && t < 60) { step(DT, NEUTRAL); cine.update(DT, car); t += DT; }
  ok(Math.abs(t - cine.duration) < 0.05 && !cine.active, 'short programme runs and ends', `${f(t, 2)} s`);

  const w2 = world();
  const off = new Cinematic({ camera: w2.camera, seed: SEED, spawn: w2.spawn, terrain: w2.terrain, chase: w2.chase, mode: 'off' });
  ok(off.begin() === false && !off.active, '?intro=off never takes the camera at all');
}

/* ── determinism ──────────────────────────────────────────────────────────── */

console.log('\n=== DETERMINISM ===');
{
  const sample = () => {
    const { spawn, terrain, camera, chase, car, ground } = world();
    const c = new Cinematic({ camera, seed: SEED, spawn, terrain, chase, groundAt: ground, mode: 'full' });
    c.begin();
    const out = [];
    for (let i = 0; i < 600; i++) {
      c.update(DT, car);
      if (i % 50 === 0) out.push([camera.position.x, camera.position.y, camera.position.z]);
    }
    c.stop();
    return out;
  };
  const a = sample();
  const b = sample();
  ok(JSON.stringify(a) === JSON.stringify(b), 'two runs of the same seed produce the identical camera path', `${a.length} sampled poses`);
}

/* ── 6: the auto-drive camera ─────────────────────────────────────────────── */

console.log('\n=== AUTO-DRIVE CAMERA ===');
{
  const { spawn, terrain, car, camera, chase, step, ground } = world();
  const auto = new Autopilot();

  // Settle the car and the rig on the sport camera first.
  for (let i = 0; i < 120; i++) {
    step(DT, { steer: 0, throttle: 0.55, brake: 0, handbrake: 0, analogue: false });
    chase.update(car, DT, ground, { drift: false });
  }

  /* The measurement that matters: the boom angle relative to the car, and how far behind and
   * how high the rig sits. With the drift off these are pinned; with it on they must move —
   * slowly. Anything faster than about 12 deg/s is not a cozy camera. */
  const boomOf = () => {
    const dx = camera.position.x - car.x;
    const dz = camera.position.z - car.z;
    let a = Math.atan2(-dx, -dz) - car.yaw; // the heading the boom points along, car-relative
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return { angle: a, r: Math.hypot(dx, dz), h: camera.position.y - car.y };
  };

  const plain = [];
  for (let i = 0; i < 300; i++) {
    step(DT, { steer: 0, throttle: 0.55, brake: 0, handbrake: 0, analogue: false });
    chase.update(car, DT, ground, { drift: false });
    plain.push(boomOf());
  }
  const swingPlain = Math.max(...plain.map((p) => Math.abs(p.angle))) * (180 / Math.PI);
  console.log(`  sport camera, 5 s straight: boom ${f(plain.at(-1).r, 2)} m behind, ${f(plain.at(-1).h, 2)} m up, swing ±${f(swingPlain, 2)}°  (driftW ${chase.driftW})`);
  ok(chase.driftW === 0, 'drift weight is exactly 0 with auto-drive off');

  // Now let the autopilot take over — the same call main.js makes — and watch the rig wander.
  auto.toggle(car);
  const drift = [];
  let tt = 0;
  for (let i = 0; i < 60 * 60; i++) {
    const cmd = auto.update(car, NEUTRAL, DT) || NEUTRAL;
    step(DT, cmd);
    chase.update(car, DT, ground, { drift: auto.on });
    tt += DT;
    /* Clearance against the CARVED height, sampled now — landHeight() is the raw land before
     * the road is cut into it, so measuring against it reports a camera "underground" whenever
     * the car is in a cutting. */
    drift.push({
      t: tt, ...boomOf(), fov: camera.fov, w: chase.driftW,
      clear: camera.position.y - ground(camera.position.x, camera.position.z),
      x: camera.position.x, z: camera.position.z,
    });
    if (!auto.on) break;
  }
  const ang = drift.map((d) => d.angle * (180 / Math.PI));
  const rate = [];
  for (let i = 1; i < ang.length; i++) rate.push(Math.abs(ang[i] - ang[i - 1]) / DT);
  console.log('\n  auto-drive, one minute — boom relative to the car:');
  console.log('    t(s)   orbit(deg)  boom(m)  height(m)  fov   weight   m above ground');
  for (let i = 0; i < drift.length; i += 600) {
    const d = drift[i];
    console.log(
      `    ${f(d.t, 1).padStart(5)}  ${f(d.angle * 180 / Math.PI, 1).padStart(9)}  ${f(d.r, 2).padStart(7)}  ${f(d.h, 2).padStart(8)}  ${f(d.fov, 1)}  ${f(d.w, 3).padStart(6)}  ${f(d.clear, 1).padStart(7)}`,
    );
  }
  const swing = Math.max(...ang.map(Math.abs));
  const booms = drift.map((d) => d.r);
  const minAbove = Math.min(...drift.map((d) => d.clear));
  console.log(
    `\n  orbit swing ±${f(swing, 1)}° (was ±${f(swingPlain, 2)}° without drift), boom ${f(Math.min(...booms), 2)}–${f(Math.max(...booms), 2)} m, ` +
      `peak observed rate ${f(Math.max(...rate), 2)} deg/s (includes the CAR's own yaw on a bending road), lowest clearance ${f(minAbove, 1)} m`,
  );
  ok(swing > 12, 'the auto-drive camera visibly orbits', `±${f(swing, 1)}°`);
  ok(Math.max(...booms) - Math.min(...booms) > 4, 'and pulls back and closes in', `${f(Math.max(...booms) - Math.min(...booms), 1)} m of boom range`);
  ok(chase.driftW > 0.99, 'drift weight reaches full', f(chase.driftW, 4));
  ok(minAbove > 1.0, 'the drifting camera never dips into the ground', `lowest ${f(minAbove, 2)} m`);

  /* The rate above is contaminated: it is the boom measured against the CAR, and the car is
   * being steered round bends. To measure the RIG on its own, hold a car dead straight at a
   * constant speed and watch the same angle for three minutes. Anything left is the drift. */
  {
    const w2 = world();
    const straight = new ChaseCamera(w2.camera, { mode: 'sport' });
    const fake = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 14, speed: 14, steer: 0, longAccel: 0, limit: 0, maxSteerAngle: () => 0.5 };
    let peak = 0;
    let peakAt = 0;
    let rampPeak = 0;
    let last = 0;
    let maxOrbit = 0;
    for (let i = 0; i < 60 * 180; i++) {
      fake.z += 14 * DT;
      straight.update(fake, DT, null, { drift: true });
      const a = Math.atan2(-(w2.camera.position.x - fake.x), -(w2.camera.position.z - fake.z)) * (180 / Math.PI);
      if (i > 0) {
        const r = Math.abs(a - last) / DT;
        if (i < 60 * 12) rampPeak = Math.max(rampPeak, r); // the ramp-in
        else if (r > peak) { peak = r; peakAt = i * DT; }
      }
      maxOrbit = Math.max(maxOrbit, Math.abs(a));
      last = a;
    }
    console.log(
      `  rig alone (car held dead straight, 180 s): orbit reaches ±${f(maxOrbit, 1)}°, ` +
        `steady-state peak ${f(peak, 2)} deg/s at t=${f(peakAt, 0)}s, ramp-in peak ${f(rampPeak, 2)} deg/s`,
    );
    ok(peak < 10, 'the rig itself never whips', `peak ${f(peak, 2)} deg/s (design budget 5.4 + 3.0)`);
    ok(rampPeak < 10, 'and engaging it does not sweep the camera round', `${f(rampPeak, 2)} deg/s`);
  }

  /* Take the wheel back. The autopilot drops out on any real input, main.js stops passing
   * drift:true, and the rig must return to the sport camera — exactly, not nearly.
   *
   * "Nearly" is what a boom-length threshold measures, and it is not good enough. So run a
   * SHADOW rig on the same camera-less path: a second ChaseCamera fed the identical car state
   * every frame with drift permanently off. If the two converge, the drifting rig has
   * demonstrably become the sport rig — not something that resembles it. */
  const shadowCam = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);
  const shadow = new ChaseCamera(shadowCam, { mode: 'sport' });
  const before = boomOf();
  let handBack = -1;
  let converged = -1;
  for (let i = 0; i < 60 * 6; i++) {
    const cmd = { steer: 0.4, throttle: 0.6, brake: 0, handbrake: 0, analogue: false };
    auto.update(car, cmd, DT); // this is what cancels the autopilot
    step(DT, cmd);
    chase.update(car, DT, ground, { drift: auto.on });
    shadow.update(car, DT, ground, { drift: false });
    if (chase.driftW === 0 && handBack < 0) handBack = (i + 1) * DT;
    const sep = Math.hypot(camera.position.x - shadowCam.position.x, camera.position.y - shadowCam.position.y, camera.position.z - shadowCam.position.z);
    if (sep < 0.05 && converged < 0 && i > 0) converged = (i + 1) * DT;
  }
  const sep = Math.hypot(camera.position.x - shadowCam.position.x, camera.position.y - shadowCam.position.y, camera.position.z - shadowCam.position.z);
  console.log(`  player took the wheel at orbit ${f(before.angle * 180 / Math.PI, 1)}°; drift weight hit exactly 0 after ${f(handBack, 2)} s`);
  ok(!auto.on, 'a steering input cancels auto-drive');
  ok(handBack > 0 && handBack < 1.6, 'the camera is back to sport within a second and a half', `${f(handBack, 2)} s`);
  ok(chase.driftW === 0, 'and the drift term is exactly zero, not nearly zero');

  const after = boomOf();
  console.log(
    `  sport rig restored: boom ${f(after.r, 2)} m (sport rest ${CAMERA.sport.behind} + up to ${CAMERA.sport.stretch} of stretch), height ${f(after.h, 2)} m (sport rest ${CAMERA.sport.above});` +
      ` a shadow rig that never drifted is ${f(sep * 1000, 1)} mm away`,
  );
  ok(converged > 0 && converged < 2.5, 'the drifted rig converges onto a rig that never drifted', `within 50 mm after ${f(converged, 2)} s`);
  ok(sep < 0.02, 'and they are the same camera by the end', `${f(sep * 1000, 2)} mm apart`);
}

/* ── the DOM half ─────────────────────────────────────────────────────────────
 * "A flag being set is not a thing being visible" cuts both ways: an element that is created
 * and never removed is just as bad as one that is never created. There is no browser here, so
 * stand up the smallest possible fake one and check what actually lands in the tree, what
 * comes back out of it, and that a plain keydown on window is enough to end the cinematic.
 */

console.log('\n=== DOM: the skip hint, the listeners, the HUD dim ===');
{
  const listeners = new Map();
  const mkEl = (tag) => {
    const el = {
      tag,
      id: '',
      textContent: '',
      children: [],
      parent: null,
      style: { cssText: '' },
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild(c) {
        c.parent = el;
        el.children.push(c);
        return c;
      },
      querySelector: () => mkEl('div'),
      remove() {
        if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el);
        el.parent = null;
      },
    };
    return el;
  };
  const body = mkEl('body');
  globalThis.document = { body, createElement: mkEl, getElementById: () => mkEl('div') };
  globalThis.window = {
    addEventListener: (ev, fn) => listeners.set(ev, [...(listeners.get(ev) || []), fn]),
    removeEventListener: (ev, fn) => listeners.set(ev, (listeners.get(ev) || []).filter((g) => g !== fn)),
  };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  globalThis.location = { search: '' };

  /* The REAL Hud, not a stand-in for it. This is the class whose `hidden` attribute once
   * shipped the game unplayable, so the thing under test is its actual setCinematic(). */
  const hudRoot = mkEl('div');
  globalThis.document.getElementById = (id) => (id === 'hud' ? hudRoot : mkEl('div'));
  const { Hud } = await import('../src/ui/hud.js');
  const fakeHud = new Hud();
  ok(fakeHud.root === hudRoot, 'the real Hud class is under test here, not a stand-in');

  /* The browser suite's own visibility predicate, arithmetic for arithmetic:
   *   display !== 'none' && visibility !== 'hidden' && +opacity > 0.01 && box > 1x1
   * Only the opacity term is under this file's control. #hud is `position:fixed; inset:0`
   * with no display, visibility or opacity rule anywhere in style.css, and main.js clears the
   * `hidden` attribute on the line before cine.begin() — so in a real browser the other three
   * terms are already true while the intro runs. (The probe that caught this bug measured
   * exactly that: hidden cleared, display:block, a 1382x724 box, opacity '0'.) So the sum
   * below is the one term that failed, evaluated the way tools/browser-test.mjs evaluates it. */
  const RESTING = 1; // what the computed opacity is once the inline value is dropped
  const hudOpacity = () => (hudRoot.style.opacity === '' ? RESTING : +hudRoot.style.opacity);
  const hudShowing = () => hudOpacity() > 0.01;

  const { spawn, terrain, car, camera, chase, ground } = world();
  const cine = new Cinematic({ camera, seed: SEED, spawn, terrain, chase, groundAt: ground, hud: fakeHud, onEnd: () => chase.reset() });
  ok(cine.mode === 'full', 'first visit gets the full programme (nothing in localStorage yet)', cine.mode);
  cine.begin();

  const hint = body.children.find((c) => c.id === 'introSkip');
  ok(!!hint, 'the skip hint really is in the document', hint ? `"${hint.textContent}"` : 'missing');
  ok(!!hint && /pointer-events:none/.test(hint.style.cssText), 'and it cannot swallow a click', 'pointer-events:none');
  ok(!!hint && /z-index:30/.test(hint.style.cssText), 'and it sits under the loading veil (z 40) and the garage (z 60)', 'z-index:30');
  ok(
    hudRoot.style.opacity !== '' && hudShowing(),
    'the HUD is dimmed with opacity — never with `hidden`, and never all the way to nothing',
    `opacity="${hudRoot.style.opacity}", the suite wants > 0.01`,
  );
  ok(
    ['keydown', 'pointerdown', 'touchstart', 'wheel'].every((e) => (listeners.get(e) || []).length === 1),
    'keyboard, mouse, touch and wheel all end it',
    ['keydown', 'pointerdown', 'touchstart', 'wheel'].map((e) => `${e}:${(listeners.get(e) || []).length}`).join(' '),
  );

  for (let i = 0; i < 120; i++) cine.update(DT, car);
  const beforeKey = cine.remaining;
  listeners.get('keydown')[0]({ code: 'KeyQ' }); // a plain, unmapped key
  let after = 0;
  while (cine.active && after < 3) {
    cine.update(DT, car);
    after += DT;
  }

  ok(!cine.active, 'a raw keydown on window skipped it', `${f(beforeKey, 1)} s of programme dropped`);
  ok(!body.children.some((c) => c.id === 'introSkip'), 'the hint element is REMOVED from the document, not merely hidden');
  ok(hudRoot.style.opacity === '', 'the HUD dim is taken back off', `opacity="${hudRoot.style.opacity}"`);
  ok(['keydown', 'pointerdown', 'touchstart', 'wheel'].every((e) => (listeners.get(e) || []).length === 0), 'and every listener is unhooked');
  ok(store.get('wanderoad.intro.seen') === '1', 'the visit is remembered, so the next one gets the short programme');

  /* THE ONE THIS BLOCK USED TO MISS. Every assertion above looks at the opacity at begin()
   * and again after a skip two seconds in. A HUD held off the screen for the whole programme
   * satisfies both of those and still fails the browser suite, which looks the instant the
   * veil lifts — and that is exactly what shipped. So: run the entire 38 s programme and
   * assert the instruments are readable on every frame of it, not merely at the ends. */
  {
    const full = new Cinematic({
      camera, seed: SEED, spawn, terrain, chase, groundAt: ground, hud: fakeHud, mode: 'full',
      onEnd: () => chase.reset(),
    });
    full.begin();
    let worst = Infinity;
    let worstT = 0;
    let worstShot = '';
    let t2 = 0;
    let n = 0;
    while (full.active && t2 < 120) {
      full.update(DT, car);
      t2 += DT;
      n++;
      const o = hudOpacity();
      if (o < worst) { worst = o; worstT = t2; worstShot = full.shotName; }
    }
    ok(
      worst > 0.01,
      'the HUD is readable on EVERY frame of the full programme, not just at the ends',
      `dimmest ${worst} at ${f(worstT, 1)} s (shot "${worstShot}"), ${n} frames / ${f(t2, 1)} s`,
    );
    ok(hudShowing() && hudRoot.style.opacity === '', 'and it is back to the stylesheet once the programme runs out');
  }

  const opts = { camera, seed: SEED, spawn, terrain, chase, groundAt: ground };
  ok(new Cinematic(opts).mode === 'short', 'second visit: the closing shot only');
  globalThis.location.search = '?intro=full';
  ok(new Cinematic(opts).mode === 'full', '?intro=full plays the whole thing again');
  globalThis.location.search = '?intro=off';
  const off = new Cinematic(opts);
  ok(off.mode === 'off' && off.begin() === false, '?intro=off never takes the camera');

  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.localStorage;
  delete globalThis.location;
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
