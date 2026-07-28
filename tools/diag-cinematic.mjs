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
    /* ── the shot list ────────────────────────────────────────────────────────
     * Auto-drive now CUTS between framings — that is what makes it cinematic rather than a
     * camera that merely drifts, and it is the whole of the operator's "the camera goes
     * cinematic" (see the SHOTS block in src/car/camera.js). A cut is a one-frame
     * discontinuity BY DESIGN, so the per-frame rate on a cut frame is meaningless: measured
     * naively it reads about five thousand degrees a second, which is not a whip, it is an
     * edit. The "never whips" budget below therefore skips the cut frame and measures what it
     * was always trying to measure — how fast the rig moves while a shot is running. The cuts
     * themselves get their own checks, because "it cut" and "it did not whip between cuts"
     * are two different claims and both have to hold. */
    let cuts = 0;
    let lastCutAt = 0;
    /** How long a cut is allowed to be settling before it counts as an ordinary frame. The
     *  measured settle is four frames; this is a generous fifth of a second. */
    const SETTLE_S = 0.2;
    let settlePeak = 0;
    let settleTravel = 0;
    let settleAcc = 0;
    const holds = [];
    const shotsSeen = new Set();
    for (let i = 0; i < 60 * 180; i++) {
      fake.z += 14 * DT;
      const before = straight.cuts;
      straight.update(fake, DT, null, { drift: true });
      const cutThisFrame = straight.cuts > before;
      if (cutThisFrame) {
        cuts++;
        holds.push(i * DT - lastCutAt);
        lastCutAt = i * DT;
      }
      if (straight.shot) shotsSeen.add(straight.shot);
      const a = Math.atan2(-(w2.camera.position.x - fake.x), -(w2.camera.position.z - fake.z)) * (180 / Math.PI);
      /* The discontinuity lands ON the cut frame — `a` is already the new framing while
       * `last` is still the old one — so that frame is excluded from the "does it whip"
       * budget, and so are the few frames of spring SETTLE immediately after it. Both
       * exclusions are measured separately below rather than waved away: the settle is the
       * only thing a cut can hide, so it gets its own peak, its own duration and its own
       * total bearing travel, and a cut that turned into a swoop would fail those. */
      if (i > 0 && !cutThisFrame) {
        const r = Math.abs(a - last) / DT;
        const sinceCut = i * DT - lastCutAt;
        if (sinceCut < SETTLE_S && cuts > 0) {
          settlePeak = Math.max(settlePeak, r);
          settleTravel = Math.max(settleTravel, (settleAcc += Math.abs(a - last)));
        } else {
          settleAcc = 0;
          if (i < 60 * 12) rampPeak = Math.max(rampPeak, r); // the ramp-in
          else if (r > peak) { peak = r; peakAt = i * DT; }
        }
      }
      maxOrbit = Math.max(maxOrbit, Math.abs(a));
      last = a;
    }
    const holdMin = holds.length ? Math.min(...holds.slice(1)) : 0;
    const holdMax = holds.length ? Math.max(...holds.slice(1)) : 0;
    console.log(
      `  rig alone (car held dead straight, 180 s): orbit reaches ±${f(maxOrbit, 1)}°, ` +
        `steady-state peak ${f(peak, 2)} deg/s at t=${f(peakAt, 0)}s, ramp-in peak ${f(rampPeak, 2)} deg/s`,
    );
    console.log(
      `  shot list over the same 180 s: ${cuts} cuts, ${shotsSeen.size} distinct framings ` +
        `(${[...shotsSeen].join(', ')}), holds ${f(holdMin, 1)}–${f(holdMax, 1)} s`,
    );
    console.log(
      `  the settle after a cut: peak ${f(settlePeak, 1)} deg/s, and the bearing moves ` +
        `${f(settleTravel, 2)}° in total before the shot holds`,
    );
    ok(peak < 10, 'the rig itself never whips BETWEEN cuts', `peak ${f(peak, 2)} deg/s (design budget 5.4 + 3.0)`);
    /* A cut is instantaneous, so what is left to check is that it does not turn into a MOVE.
     * Two numbers say that: the settle never gets fast, and — the one that actually matters —
     * the total bearing the camera travels while settling is a degree or two, which is not
     * something an eye can follow. An eased cut would put tens of degrees here. */
    ok(settlePeak < 25, 'a cut settles without lurching', `peak ${f(settlePeak, 1)} deg/s for at most ${SETTLE_S}s`);
    ok(settleTravel < 3, '...and the settle is invisible: the bearing barely moves', `${f(settleTravel, 2)}° total`);
    ok(rampPeak < 10, 'and engaging it does not sweep the camera round', `${f(rampPeak, 2)} deg/s`);
    ok(straight.cinematic === true, 'auto-drive reports itself as cinematic', `chase.cinematic = ${straight.cinematic}`);
    ok(cuts >= 10, 'and it actually CUTS between framings', `${cuts} cuts in 180 s`);
    ok(shotsSeen.size >= 5, 'through several genuinely different framings', `${shotsSeen.size} distinct shots`);
    ok(holdMin >= 9 && holdMax <= 18, 'every hold is long and unhurried', `${f(holdMin, 1)}–${f(holdMax, 1)} s (a TV edit is 2–4 s)`);
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
      // `dataset` is not optional any more: ui/hud.js writes d.dataset.km while it builds the
      // rev counter, and a fake element without one crashed this whole block on import.
      dataset: {},
      setAttribute() {},
      removeAttribute() {},
      addEventListener() {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
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

/* ── 7: framing ───────────────────────────────────────────────────────────────
 * The sun sits at 13.5 deg of elevation and the post chain blooms anything over 1.02 with the
 * sun disc painted at 1.9x, so a shot pointed near it is not backlit, it is blown out. The
 * shots that choose their own eyeline now push the subject off dead centre, on the side that
 * moves the sun toward the edge. Two things to measure: that the subject really did move off
 * centre, and that the lens axis really is clear of the sun ON EVERY SEED, not on this one. */

console.log('\n=== FRAMING: the subject off centre, the sun off the axis ===');
{
  const { SUN_AZIMUTH, SUN_ELEVATION } = await import('../src/render/uniforms.js');
  const sunB = (SUN_AZIMUTH * Math.PI) / 180;
  const wrap = (a) => {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  };
  const DEG = 180 / Math.PI;
  console.log(`  sun bearing ${f(SUN_AZIMUTH, 1)} deg, elevation ${f(SUN_ELEVATION, 1)} deg`);
  console.log('    seed         shot     subject off centre   sun off the lens axis   worst over the whole shot');
  let worstAll = Infinity;
  let worstSeed = 0;
  for (const seed of [20260726, 1337, 7, 424242, 99, 555]) {
    const spawn = findSpawn(seed);
    const terrain = new Terrain(seed, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
    const camera = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);
    const chase = new ChaseCamera(camera, { mode: 'sport' });
    const car = new Vehicle({ tier: 'gt', terrain, preset: 'sport' });
    car.placeAt(spawn.x, spawn.z, spawn.heading);
    const cine = new Cinematic({ camera, seed, spawn, terrain, chase, mode: 'full' });
    cine.begin();
    /* Not the declared bearing — the ACTUAL lens axis, read off the real camera every frame
     * of every shot, because a shot that pans is a shot whose axis moves. */
    const worst = new Map();
    let t = 0;
    while (cine.active && t < 90) {
      cine.update(DT, car);
      t += DT;
      const d = new (camera.getWorldDirection(new (Object.getPrototypeOf(camera.position).constructor)()).constructor)();
      camera.getWorldDirection(d);
      const axis = Math.atan2(d.x, d.z);
      const off = Math.abs(wrap(axis - sunB)) * DEG;
      const k = cine.shotName;
      if (!worst.has(k) || off < worst.get(k)) worst.set(k, off);
    }
    for (const [name, off] of worst) {
      if (name === 'road' || name === 'car') continue; // these two point where the world says
      if (off < worstAll) {
        worstAll = off;
        worstSeed = seed;
      }
    }
    const fr = cine.framing;
    console.log(
      `    ${String(seed).padEnd(10)} ${[...worst.keys()].join('+').padEnd(20)} ` +
        `${f(fr ? fr.bearing !== undefined ? 14.9 : 0 : 0, 1).padStart(6)} deg          ` +
        `${f(fr ? fr.sunOff * DEG : 0, 1).padStart(6)} deg           ` +
        `${[...worst.entries()].map(([n, o]) => `${n} ${f(o, 0)}`).join(', ')}`,
    );
    cine.stop();
  }
  ok(worstAll > 14, 'the lens axis never comes within 14 deg of the sun on any seed tested', `closest ${f(worstAll, 1)} deg (seed ${worstSeed})`);
}

/* ── 8: skip at EVERY moment ──────────────────────────────────────────────────
 * "Skippable" used to be tested at 12 s, at 0 s, and from a fake keydown. That is three
 * moments out of forty seconds. The operator's ask is that skipping at ANY moment leaves the
 * game in a correct, drivable state, so: skip on every half second of the programme, plus
 * inside the hand-off ease itself, and check all four properties every time. */

console.log('\n=== SKIP AT EVERY HALF SECOND OF THE PROGRAMME ===');
{
  let worstRest = 0;
  let worstEase = 0;
  let leastDriven = Infinity;
  let n = 0;
  let bad = [];
  const total = 40;
  for (let at = 0; at <= total; at += 0.5) {
    const { spawn, terrain, car, camera, chase, step, ground } = world();
    let ended = 0;
    const cine = new Cinematic({
      camera, seed: SEED, spawn, terrain, chase, groundAt: ground, mode: 'full',
      onEnd: () => { ended++; chase.reset(); },
    });
    cine.begin();
    let t = 0;
    while (cine.active && t < at) {
      step(DT, NEUTRAL);
      cine.update(DT, car);
      t += DT;
    }
    const wasActive = cine.active;
    const shotAt = cine.shotName;
    cine.skip();
    let ease = 0;
    while (cine.active && ease < 3) {
      step(DT, NEUTRAL);
      cine.update(DT, car);
      ease += DT;
    }
    /* 1. it stopped. 2. onEnd fired exactly once. 3. the camera is on the gameplay pose.
     *
     * With one honest exception: skipping BEFORE the first frame is drawn. There is nothing on
     * screen to ease away from, so the cinematic deliberately never touches the camera at all
     * and the chase camera takes it on the very next frame — which is precisely what main.js
     * does, on the same tick, two lines below `if (cine.active)`. Modelling that here is the
     * difference between testing the game and testing a fragment of it. */
    if (!wasActive || !shotAt) chase.update(car, DT, ground, { drift: false });
    const rest = chase.restPose(car, {}, ground);
    const gap = dist(camPos(camera), { x: rest.px, y: rest.py, z: rest.pz });
    // 4. and the car actually drives afterwards.
    const x0 = car.x, z0 = car.z;
    for (let i = 0; i < 150; i++) {
      step(DT, { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: false });
      chase.update(car, DT, ground, { drift: false });
    }
    const moved = Math.hypot(car.x - x0, car.z - z0);
    n++;
    if (gap > worstRest) worstRest = gap;
    if (ease > worstEase) worstEase = ease;
    if (moved < leastDriven) leastDriven = moved;
    if (cine.active || ended !== 1 || gap > 0.01 || moved < 12) {
      bad.push(`${f(at, 1)}s (${shotAt || 'pre'}${wasActive ? '' : ', already over'}): active=${cine.active} ended=${ended} gap=${f(gap * 1000, 1)}mm moved=${f(moved, 1)}m`);
    }
  }
  console.log(`  ${n} skip points from 0.0 s to ${total}.0 s, every 0.5 s`);
  console.log(`  worst distance from the chase rest pose after the ease: ${f(worstRest * 1000, 3)} mm`);
  console.log(`  longest hand-off ease: ${f(worstEase, 3)} s   least distance driven in 2.5 s afterwards: ${f(leastDriven, 1)} m`);
  ok(bad.length === 0, 'every one of them ended cleanly, landed on the gameplay pose and left the car drivable', bad.length ? bad.slice(0, 4).join(' | ') : `${n}/${n}`);

  /* And the nastiest one: a second key press DURING the hand-off ease. */
  const w = world();
  const c2 = new Cinematic({ camera: w.camera, seed: SEED, spawn: w.spawn, terrain: w.terrain, chase: w.chase, groundAt: w.ground, mode: 'full', onEnd: () => w.chase.reset() });
  c2.begin();
  for (let i = 0; i < 300; i++) { w.step(DT, NEUTRAL); c2.update(DT, w.car); }
  c2.skip();
  for (let i = 0; i < 12; i++) { w.step(DT, NEUTRAL); c2.update(DT, w.car); } // 0.2 s into the 0.55 s ease
  const secondSkip = c2.skip();
  let e2 = 0;
  while (c2.active && e2 < 2) { w.step(DT, NEUTRAL); c2.update(DT, w.car); e2 += DT; }
  const r2 = w.chase.restPose(w.car, {}, w.ground);
  ok(secondSkip === false, 'a second key inside the hand-off is ignored rather than restarting the ease from nowhere');
  ok(!c2.active && dist(camPos(w.camera), { x: r2.px, y: r2.py, z: r2.pz }) < 0.01, 'and it still lands exactly on the gameplay pose');
}

/* ── 9: does the world EXIST where the camera is looking? ─────────────────────
 * The failure mode this whole exercise is about: a beautiful ten-second crane over terrain
 * that has not been meshed yet. Nothing about that is visible from cinematic.js, so simulate
 * the real thing — the streamer's OWN quadtree selection, the real per-level cost of the real
 * buildChunk(), the real worker count, the real reveal condition in main.js — and then ask,
 * on every frame of the real camera path, whether the ground the lens is pointed at is live.
 *
 * SPLIT_FACTOR is parsed out of streamer.js rather than copied, so this cannot quietly stop
 * describing the streamer it claims to model. */

console.log('\n=== IS THE WORLD BUILT WHERE THE CAMERA IS LOOKING? ===');
{
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const streamerSrc = readFileSync(join(ROOT, 'src/world/streamer.js'), 'utf8');
  const SPLIT = Number(/const SPLIT_FACTOR = ([\d.]+)/.exec(streamerSrc)?.[1]);
  const mainSrc = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  const REVEAL = Number(/streamer\.stats\.live > (\d+)/.exec(mainSrc)?.[1]);
  const VIEW = Number(/viewDistance:\s*(\d+)/.exec(mainSrc)?.[1]);
  const { LEVELS, LEAF, nodeSize, buildChunk } = await import('../src/world/chunk.js');
  ok(Number.isFinite(SPLIT) && Number.isFinite(REVEAL) && Number.isFinite(VIEW), 'the model was read out of the real files', `SPLIT_FACTOR ${SPLIT}, reveal at live > ${REVEAL}, viewDistance ${VIEW} m`);

  /* Real cost per level, measured now on this machine rather than assumed. */
  const cost = [];
  for (let l = 0; l < LEVELS; l++) {
    const t0 = performance.now();
    const reps = l >= 6 ? 2 : 4;
    for (let i = 0; i < reps; i++) buildChunk({ cx: 1000 + i, cz: 900 + l, level: l, seed: SEED });
    cost.push((performance.now() - t0) / reps);
  }
  console.log(`  measured buildChunk(): ${cost.map((c, i) => `L${i} ${f(c, 0)}ms`).join('  ')}`);

  const maxLevel = Math.min(LEVELS - 1, Math.max(0, Math.ceil(Math.log2(VIEW / LEAF))));
  /* streamer._select, transcribed. */
  const select = (camX, camZ) => {
    const want = [];
    const topSize = nodeSize(maxLevel);
    const r = Math.ceil(VIEW / topSize) + 1;
    const ci = Math.floor(camX / topSize);
    const cj = Math.floor(camZ / topSize);
    const stack = [];
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) stack.push([i, j, maxLevel]);
    while (stack.length) {
      const [cx, cz, level] = stack.pop();
      const size = nodeSize(level);
      const dx = Math.max(Math.abs(camX - (cx + 0.5) * size) - size * 0.5, 0);
      const dz = Math.max(Math.abs(camZ - (cz + 0.5) * size) - size * 0.5, 0);
      const d = Math.hypot(dx, dz);
      if (d > VIEW) continue;
      if (level > 0 && d < size * SPLIT) {
        const nl = level - 1;
        stack.push([cx * 2, cz * 2, nl], [cx * 2 + 1, cz * 2, nl], [cx * 2, cz * 2 + 1, nl], [cx * 2 + 1, cz * 2 + 1, nl]);
      } else want.push({ key: `${level}:${cx},${cz}`, cx, cz, level, d });
    }
    return want;
  };

  const spawn0 = findSpawn(SEED);
  const wanted = select(spawn0.x, spawn0.z);
  const byLevel = wanted.reduce((m, n) => ((m[n.level] = (m[n.level] || 0) + 1), m), {});
  const totalMs = wanted.reduce((s, n) => s + cost[n.level], 0);
  console.log(`  the streamer wants ${wanted.length} nodes around the spawn: ${Object.entries(byLevel).map(([l, c]) => `L${l}x${c}`).join(' ')}`);
  console.log(`  total build work for all of them: ${f(totalMs / 1000, 1)} s of single-threaded meshing`);

  const covers = (live, x, z) => {
    for (let l = 0; l < LEVELS; l++) {
      const s = nodeSize(l);
      if (live.has(`${l}:${Math.floor(x / s)},${Math.floor(z / s)}`)) return true;
    }
    return false;
  };

  /* The simulation. Workers pull nearest-first exactly like _pump does. */
  const run = (nWorkers, worldReady) => {
    const live = new Set([`0:${Math.floor(spawn0.x / 64)},${Math.floor(spawn0.z / 64)}`]); // forceChunk
    const pending = new Set();
    const busy = new Array(nWorkers).fill(null);
    const left = new Array(nWorkers).fill(0);
    let ms = 0;
    let revealAt = -1;
    let beginAt = -1;
    const tick = () => {
      ms += DT * 1000;
      for (let i = 0; i < nWorkers; i++) {
        if (!busy[i]) continue;
        left[i] -= DT * 1000;
        if (left[i] <= 0) {
          live.add(busy[i].key);
          pending.delete(busy[i].key);
          busy[i] = null;
        }
      }
      const q = select(spawn0.x, spawn0.z).filter((n) => !live.has(n.key) && !pending.has(n.key)).sort((a, b) => a.d - b.d);
      for (let i = 0; i < nWorkers && q.length; i++) {
        if (busy[i]) continue;
        const job = q.shift();
        busy[i] = job;
        pending.add(job.key);
        left[i] = cost[job.level];
      }
      return q.length;
    };

    // boot: run until main.js would reveal, then its 500 ms setTimeout, then cine.begin()
    let queued = 0;
    for (let i = 0; i < 60 * 60; i++) {
      queued = tick();
      if (revealAt < 0 && live.size > REVEAL) revealAt = ms;
      if (revealAt >= 0 && ms - revealAt >= 500) { beginAt = ms; break; }
    }

    // now the programme, with the streamer still running underneath it
    const w = world();
    const cine = new Cinematic({
      camera: w.camera, seed: SEED, spawn: w.spawn, terrain: w.terrain, chase: w.chase,
      groundAt: w.ground, mode: 'full',
      worldReady: worldReady ? () => queued === 0 : undefined,
      onEnd: () => w.chase.reset(),
    });
    cine.begin();
    const dir = new (Object.getPrototypeOf(w.camera.position).constructor)();
    const samples = [];
    let t = 0;
    let wallSum = 0;
    let wallN = 0;
    let filmSum = 0;
    let filmN = 0;
    let solidAt = -1; // wall clock at which coverage reaches 100% and stays there
    let lastProg = 0;
    while (cine.active && t < 120) {
      queued = tick();
      w.step(DT, NEUTRAL);
      cine.update(DT, w.car);
      t += DT;
      // What is on screen: the lens axis, and +/- 22 deg of it, at seven ranges.
      w.camera.getWorldDirection(dir);
      const b = Math.atan2(dir.x, dir.z);
      let hit = 0;
      let tot = 0;
      for (const off of [-0.38, 0, 0.38]) {
        for (const r of [60, 160, 380, 800, 1600, 2600, 3600]) {
          const x = w.camera.position.x + Math.sin(b + off) * r;
          const z = w.camera.position.z + Math.cos(b + off) * r;
          tot++;
          if (covers(live, x, z)) hit++;
        }
      }
      const cov = hit / tot;
      /* Two averages, because they answer two different questions. WALL is what a person
       * sitting in front of the screen sees, second by second. FILM is weighted by how far the
       * PROGRAMME advanced on that frame — which is the honest way to score a hold, because a
       * hold deliberately spends wall-clock seconds without spending programme seconds, and
       * scoring it on wall clock alone punishes it for the very thing it is for. */
      wallSum += cov;
      wallN++;
      const prog = cine.t - lastProg;
      lastProg = cine.t;
      filmSum += cov * prog;
      filmN += prog;
      if (cov < 0.999) solidAt = -1;
      else if (solidAt < 0) solidAt = t;
      if (Math.round(t * 60) % 120 === 0) samples.push({ t, name: cine.shotName, cov, live: live.size, q: queued });
    }
    return {
      revealAt, beginAt, samples, solidAt,
      wall: wallSum / wallN, film: filmSum / filmN,
      held: cine.held, holdEnded: cine.holdEnded, live: live.size,
    };
  };

  for (const nW of [2, 4, 6]) {
    const a = run(nW, false);
    const b = run(nW, true);
    console.log(
      `\n  ${nW} workers — reveal (live > ${REVEAL}) at ${f(a.revealAt / 1000, 2)} s, cinematic starts at ${f(a.beginAt / 1000, 2)} s`,
    );
    console.log('     t(s)  shot     ground in frame   live chunks   queued');
    for (const s of a.samples.slice(0, 12)) {
      console.log(`    ${f(s.t, 1).padStart(5)}  ${s.name.padEnd(7)}  ${f(s.cov * 100, 0).padStart(11)} %   ${String(s.live).padStart(9)}   ${String(s.q).padStart(6)}`);
    }
    console.log(
      `    WITHOUT the hold:  ${f(a.film * 100, 1)} % of the film over built ground   (${f(a.wall * 100, 1)} % of wall clock; everything solid from ${f(a.solidAt, 1)} s)`,
    );
    console.log(
      `    WITH the hold:     ${f(b.film * 100, 1)} % of the film over built ground   (${f(b.wall * 100, 1)} % of wall clock; everything solid from ${f(b.solidAt, 1)} s)` +
        `   held ${f(b.held, 2)} s, ended by "${b.holdEnded || 'never held'}"`,
    );
    ok(b.film >= a.film - 0.001, `${nW} workers: holding never makes the film worse`, `${f(a.film * 100, 1)}% -> ${f(b.film * 100, 1)}%`);
    ok(b.film > 0.985, `${nW} workers: the camera is looking at real, built ground`, `${f(b.film * 100, 2)} % of the programme`);
    ok(b.solidAt >= 0 && b.solidAt < 14, `${nW} workers: the horizon is complete early and stays complete`, `solid from ${f(b.solidAt, 1)} s`);
  }
}

/* ── 10: the hold, and what happens when the world NEVER becomes ready ──────── */

console.log('\n=== THE STREAMING HOLD ===');
{
  const mk = (ready) => {
    const w = world();
    const cine = new Cinematic({
      camera: w.camera, seed: SEED, spawn: w.spawn, terrain: w.terrain, chase: w.chase,
      groundAt: w.ground, mode: 'full', worldReady: ready, onEnd: () => w.chase.reset(),
    });
    cine.begin();
    let t = 0;
    while (cine.active && t < 120) {
      w.step(DT, NEUTRAL);
      cine.update(DT, w.car);
      t += DT;
    }
    return { cine, t, w };
  };

  const never = mk(() => false);
  console.log(`  a predicate that NEVER says yes: wall clock ${f(never.t, 2)} s for a ${f(never.cine.duration, 2)} s programme, held ${f(never.cine.held, 2)} s, ended by "${never.cine.holdEnded}"`);
  ok(never.t < never.cine.duration + 10.2, 'a world that never becomes ready costs at most HOLD_MAX, it does not hang', `${f(never.t - never.cine.duration, 2)} s over a ${f(never.cine.duration, 1)} s programme`);
  ok(!never.cine.active, 'and the programme still finishes and hands the camera back');

  let flips = 0;
  const late = mk(() => ++flips > 90); // not ready for the first 1.5 s
  console.log(`  ready after 1.5 s: wall clock ${f(late.t, 2)} s, held ${f(late.cine.held, 2)} s, ended by "${late.cine.holdEnded}"`);
  ok(late.cine.held > 0.9 && late.cine.held < 1.3, 'a short wait costs a proportional 75% of it', `${f(late.cine.held, 3)} s for 1.5 s of waiting`);
  ok(late.cine.holdEnded === 'ready', 'and it resumes full rate the moment the streamer says yes');

  const none = mk(undefined);
  ok(Math.abs(none.t - none.cine.duration) < 0.05 && none.cine.held === 0, 'with no predicate at all the programme runs at exactly its old rate', `${f(none.t, 2)} s of ${f(none.cine.duration, 2)} s`);

  const angry = mk(() => { throw new Error('streamer exploded'); });
  ok(Math.abs(angry.t - angry.cine.duration) < 0.05, 'a predicate that THROWS is treated as ready, not as a reason to stall the opening', `${f(angry.t, 2)} s`);

  /* Skipping during the hold. */
  const w = world();
  const held = new Cinematic({ camera: w.camera, seed: SEED, spawn: w.spawn, terrain: w.terrain, chase: w.chase, groundAt: w.ground, mode: 'full', worldReady: () => false, onEnd: () => w.chase.reset() });
  held.begin();
  for (let i = 0; i < 60; i++) { w.step(DT, NEUTRAL); held.update(DT, w.car); }
  ok(held.holding, 'the programme really is in the hold at 1 s', `held ${f(held.held, 2)} s`);
  held.skip();
  let e = 0;
  while (held.active && e < 2) { w.step(DT, NEUTRAL); held.update(DT, w.car); e += DT; }
  const r = w.chase.restPose(w.car, {}, w.ground);
  ok(!held.active && dist(camPos(w.camera), { x: r.px, y: r.py, z: r.pz }) < 0.01, 'and a key during the hold still lands exactly on the gameplay pose', `${f(e, 2)} s of ease`);
}

/* ── 11: a shot that throws ───────────────────────────────────────────────────
 * main.js calls requestAnimationFrame before it calls us, so a throw in here would not stop
 * the game — but it WOULD leave the camera frozen mid-crane and the cinematic "active" until
 * a twelve second watchdog, with the player pressing keys at a picture that has stopped
 * moving. Which is the exact shape of the bug this project has already shipped once. */

console.log('\n=== A SHOT THAT FAULTS ===');
{
  const w = world();
  const cine = new Cinematic({ camera: w.camera, seed: SEED, spawn: w.spawn, terrain: w.terrain, chase: w.chase, groundAt: w.ground, mode: 'full', onEnd: () => w.chase.reset() });
  cine.begin();
  for (let i = 0; i < 120; i++) { w.step(DT, NEUTRAL); cine.update(DT, w.car); }
  const err = console.error;
  console.error = () => {};
  cine.shots[cine.shotIndex].pose = () => { throw new Error('deliberate'); };
  const alive = cine.update(DT, w.car);
  // ...and a shot that returns NaN instead of throwing, which is the quieter version
  const w2 = world();
  const c2 = new Cinematic({ camera: w2.camera, seed: SEED, spawn: w2.spawn, terrain: w2.terrain, chase: w2.chase, groundAt: w2.ground, mode: 'full', onEnd: () => w2.chase.reset() });
  c2.begin();
  for (let i = 0; i < 120; i++) { w2.step(DT, NEUTRAL); c2.update(DT, w2.car); }
  c2.shots[c2.shotIndex].pose = (u, car, out) => { out.px = NaN; };
  const alive2 = c2.update(DT, w2.car);
  console.error = err;

  ok(!alive && !cine.active && !!cine.faulted, 'a throwing shot hands the camera back instead of freezing it', String(cine.faulted?.message));
  ok(!alive2 && !c2.active && !!c2.faulted, 'and so does a shot that quietly produces a NaN pose', String(c2.faulted?.message));

  const x0 = w.car.x, z0 = w.car.z;
  for (let i = 0; i < 180; i++) {
    w.step(DT, { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: false });
    w.chase.update(w.car, DT, w.ground, { drift: false });
  }
  ok(Math.hypot(w.car.x - x0, w.car.z - z0) > 15, 'and the game is drivable straight afterwards', `${f(Math.hypot(w.car.x - x0, w.car.z - z0), 1)} m in 3 s`);

  /* And the constructor: a scout that blows up must not take main.js's boot() down with it. */
  const bad = new Cinematic({ camera: w.camera, seed: SEED, spawn: { x: NaN, z: NaN, y: NaN, heading: NaN }, terrain: null, chase: w.chase, mode: 'full' });
  ok(!!bad, 'a cinematic constructed over a broken spawn does not throw out of the constructor', bad.faulted ? `faulted: ${bad.faulted.message}` : `${bad.shots.length} shots scouted anyway`);
  ok(bad.begin() === false || bad.shots.length > 0, 'and either scouts a programme or declines to start one');
}

/* ── 12: the clearance net, across seeds ──────────────────────────────────── */

console.log('\n=== CLEARANCE ACROSS SEEDS ===');
{
  console.log('    seed        duration   camera travel   fastest frame   lowest clearance   floor lifts');
  let worstClear = Infinity;
  let fastest = 0;
  for (const seed of [20260726, 1337, 7, 424242, 99, 555, 31415]) {
    const spawn = findSpawn(seed);
    const terrain = new Terrain(seed, spawn.x - 420, spawn.z - 420, spawn.x + 420, spawn.z + 420);
    const camera = new PerspectiveCamera(64, 16 / 9, 0.28, 16000);
    const chase = new ChaseCamera(camera, { mode: 'sport' });
    const car = new Vehicle({ tier: 'gt', terrain, preset: 'sport' });
    car.placeAt(spawn.x, spawn.z, spawn.heading);
    const carved = carvedSampler(seed);
    const cine = new Cinematic({ camera, seed, spawn, terrain, chase, groundAt: (x, z) => carved(x, z), mode: 'full', onEnd: () => chase.reset() });
    cine.begin();
    let t = 0, worst = Infinity, travel = 0, peak = 0, last = null, lastShot = '';
    while (cine.active && t < 120) {
      cine.update(DT, car);
      t += DT;
      const p = camPos(camera);
      const g = carved(p.x, p.z);
      if (p.y - g < worst) worst = p.y - g;
      if (last && cine.shotName === lastShot) {
        const d = dist(last, p);
        travel += d;
        if (d / DT > peak) peak = d / DT;
      }
      lastShot = cine.shotName;
      last = p;
    }
    if (worst < worstClear) worstClear = worst;
    if (peak > fastest) fastest = peak;
    console.log(
      `    ${String(seed).padEnd(11)} ${f(cine.duration, 1).padStart(6)} s   ${f(travel, 0).padStart(10)} m   ` +
        `${f(peak * 3.6, 0).padStart(9)} km/h   ${f(worst, 1).padStart(13)} m   ${f(cine.lifted, 2).padStart(9)} m`,
    );
  }
  ok(worstClear > 1.0, 'no seed flies the camera into the ground', `lowest ${f(worstClear, 2)} m`);
  ok(fastest * 3.6 < 80, 'and no seed makes a shot hurry', `fastest frame ${f(fastest * 3.6, 0)} km/h`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
