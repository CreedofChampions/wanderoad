/* Wanderoad — what happens when you hit a tree.
 *
 * Three questions, and the third is the one that bites:
 *
 *   1. Does a square hit actually STOP you? (W1: "a real, immediate, readable stop")
 *   2. Can a fast car get PAST a thin trunk? A 0.36 m collider and 8 m of travel in one step
 *      is a point test's blind spot, and a thin collider plus a fast car is the classic miss.
 *   3. Does anything get reported as a hit when there was nothing there? That is the browser
 *      suite's 'O5 no phantom impacts off-road', answered here against a brute-force oracle
 *      over a real chunk's worth of trees, before the browser ever opens.
 *
 * Speeds are read off the WORLD velocity, hypot(vx, vz). `car.kph` comes from the solver's
 * own body-space `speed`, which is only recomputed inside a step — read straight after a
 * collision it still reports the speed the car had on the way in.
 *
 *   node tools/bench-impact.mjs
 */

import { Vehicle } from '../src/car/vehicle.js';
import { Autopilot } from '../src/car/autopilot.js';
import { MAX_SUBSTEPS, PHYSICS_DT } from '../src/car/tuning.js';
import { Solids, solidsFromScatter, TRUNK_R } from '../src/game/collide.js';
import { scatterChunk } from '../src/world/scatter.js';
import { Terrain } from '../src/world/terrain.js';

const SEED = 20260726;
const R = 1.05; // the car's collision radius, as main.js passes it
const SIM_CAP = MAX_SUBSTEPS * PHYSICS_DT; // the most one Vehicle.update() ever advances

/** A dead-flat, dead-grippy world, so the test measures the collision and not the terrain. */
const FLAT = {
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(46)} ${String(got).padStart(15)}   want ${want}`);
};
const kph = (c) => Math.hypot(c.vx, c.vz) * 3.6;

/** One tree of one species, standing `ahead` metres up +Z from the origin. */
function world(kind = 'pine', scale = 1, ahead = 120) {
  const s = new Solids();
  s.addChunk('t', solidsFromScatter({ trees: [{ x: 0, y: 0, z: ahead, scale, kind, yaw: 0, hue: 0, biome: 0 }] }));
  return s;
}
const treeOf = (s) => s.byChunk.get('t')[0];

/* The car's forward is (sin yaw, cos yaw) — see the note in car/input.js — so yaw 0 drives
 * up +Z, which is where the tree is. */
const DRIVE = { steer: 0, throttle: 1, brake: 0, handbrake: 0, analogue: true };
const COAST = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };

/** Run a real Vehicle at whatever is in `solids` and report the speed either side of impact. */
function runAt(solids, tier, dt, { offset = 0, spin = 40 } = {}) {
  const tree = treeOf(solids);
  const car = new Vehicle({ tier, terrain: FLAT, preset: 'sport' });
  car.placeAt(offset, -400, 0);
  // Get up to speed a long way from the tree at a sane frame time, then hand over to the
  // frame time under test — spinning up AT dt = 0.1 would measure the integrator, not the hit.
  for (let i = 0; i < 60 * spin; i++) car.update(1 / 60, DRIVE);
  // Drop the car in just short of the tree so the speed is still there when it arrives.
  car.z = tree.z - Math.max(6, Math.hypot(car.vx, car.vz) * dt * 1.5);
  solids._px = null;
  let before = 0;
  let after = null;
  let hit = null;
  for (let i = 0; i < 600; i++) {
    car.update(dt, COAST);
    const pre = kph(car);
    const h = solids.resolve(car, R, dt);
    if (h && !hit) {
      hit = h;
      before = pre;
      after = kph(car);
    }
    if (hit) break;
    if (car.z > tree.z + 30) break;
    before = pre;
  }
  return { before, after: after === null ? kph(car) : after, x: car.x, z: car.z, hit };
}

/** Same run with a kinematic body, so the speed is whatever we say instead of what an engine
 *  can reach. Used to push the sweep past anything the game can actually do. */
function runKinematic(solids, mps, dt) {
  const tree = treeOf(solids);
  const car = { x: 0, y: 0, z: tree.z - mps * dt - 4, vx: 0, vz: mps, yawRate: 0 };
  solids._px = null;
  let hit = null;
  for (let i = 0; i < 200; i++) {
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    const h = solids.resolve(car, R, dt);
    if (h && !hit) hit = h;
    if (hit || car.z > tree.z + 30) break;
  }
  return { hit, z: car.z, v: Math.hypot(car.vx, car.vz) };
}

console.log('\n── a square hit is a dead stop ───────────────────────────────────');
for (const tier of ['gt', 'sports', 'hyper']) {
  const s = world('pine');
  const r = runAt(s, tier, 1 / 60);
  const tree = treeOf(s);
  const gap = tree.z - r.z; // centre-to-centre at rest
  check(
    r.after < 0.5 && r.hit !== null && Math.abs(gap - (tree.r + R)) < 0.1,
    `${tier} head-on into a pine`,
    `${r.before.toFixed(1)} -> ${r.after.toFixed(2)} km/h`,
    `-> 0, at rest ${gap.toFixed(2)} m out (touching = ${(tree.r + R).toFixed(2)})`,
  );
}
{
  // The widest trunk in the world, and the narrowest, at the same speed.
  for (const [kind, scale] of [['broadleaf', 1.38], ['palm', 0.72]]) {
    const s = world(kind, scale);
    const r = runAt(s, 'hyper', 1 / 60);
    const tree = treeOf(s);
    check(
      r.after < 0.5 && r.hit !== null,
      `${kind} scale ${scale} (r ${tree.r.toFixed(2)})`,
      `${r.before.toFixed(1)} -> ${r.after.toFixed(2)} km/h`,
      '-> 0',
    );
  }
}

console.log('\n── the margin a point test was living on ─────────────────────────');
{
  /* A discrete point test survives only while one step is shorter than the capture window,
   * 2 * (trunk radius + car radius). Both halves of that are measured here rather than
   * argued, because "it happens to work today" is exactly the kind of thing that stops
   * working the week someone adds a faster car. */
  let top = 0;
  for (const tier of ['gt', 'sports', 'hyper']) {
    const car = new Vehicle({ tier, terrain: FLAT, preset: 'sport' });
    car.placeAt(0, 0, 0);
    for (let i = 0; i < 60 * 45; i++) car.update(1 / 60, DRIVE);
    top = Math.max(top, Math.hypot(car.vx, car.vz));
  }
  const step = top * SIM_CAP;
  // The thinnest collider the scatter can produce: the smallest species at the smallest scale.
  let thinnest = Infinity;
  let which = '';
  for (const [kind, r] of Object.entries(TRUNK_R)) {
    if (r * 0.72 < thinnest) {
      thinnest = r * 0.72;
      which = kind;
    }
  }
  const window = 2 * (thinnest + R);
  console.log(
    `  fastest car ${(top * 3.6).toFixed(0)} km/h -> ${step.toFixed(2)} m per solver step ` +
      `(${MAX_SUBSTEPS} x ${(PHYSICS_DT * 1000).toFixed(1)} ms)`,
  );
  console.log(`  thinnest trunk ${which} at scale 0.72: r ${thinnest.toFixed(3)} m -> capture window ${window.toFixed(2)} m`);
  console.log(`  a point test's margin: ${((window / step - 1) * 100).toFixed(0)}%  — the sweep does not need one`);
}

console.log('\n── and it does not tunnel, at any speed or any frame time ────────');
/* dt 0.1 is the cap main.js puts on a frame; 1/30 is a bad frame; 1/60 is normal. The tree is
 * a pine at the small end of the scale range — the thinnest collider the world contains. */
for (const dt of [1 / 60, 1 / 30, 0.1]) {
  const s = world('pine', 0.72);
  const r = runAt(s, 'hyper', dt);
  const tree = treeOf(s);
  check(
    r.z < tree.z && r.hit !== null && r.after < 0.5,
    `real car, dt ${dt.toFixed(3)}, r ${tree.r.toFixed(2)}`,
    `${r.before.toFixed(0)} -> ${r.after.toFixed(2)} km/h`,
    `stopped short of z ${tree.z}, got ${r.z.toFixed(2)}`,
  );
}
for (const dt of [1 / 60, 1 / 30, 0.1]) {
  for (const mps of [50, 100, 200, 400]) {
    const s = world('pine', 0.72);
    const r = runKinematic(s, mps, dt);
    const tree = treeOf(s);
    check(
      r.hit !== null && r.z < tree.z,
      `kinematic ${(mps * 3.6).toFixed(0)} km/h, dt ${dt.toFixed(3)}, step ${(mps * dt).toFixed(1)} m`,
      `z ${r.z.toFixed(2)}`,
      `caught before z ${tree.z}`,
    );
  }
}

{
  /* The nastiest frame in the game: one 100 ms hitch, then normal frames while the solver
   * works through the backlog. On those catch-up frames the car covers a full 42 ms of
   * simulation while the FRAME thinks 8 ms went by, so a sweep budget written against dt
   * alone declares the step a teleport and quietly stops guarding. */
  const s = world('pine', 0.72);
  const tree = treeOf(s);
  const car = new Vehicle({ tier: 'hyper', terrain: FLAT, preset: 'sport' });
  car.placeAt(0, -400, 0);
  for (let i = 0; i < 60 * 40; i++) car.update(1 / 60, DRIVE);
  car.z = tree.z - 30;
  s._px = null;
  let hit = null;
  let before = 0;
  for (let i = 0; i < 400 && !hit; i++) {
    car.update(i % 12 === 0 ? 0.1 : 0.008, COAST); // hitch, then eleven catch-up frames
    const pre = kph(car);
    const h = s.resolve(car, R, i % 12 === 0 ? 0.1 : 0.008);
    if (h) {
      hit = h;
      before = pre;
    }
    if (car.z > tree.z + 20) break;
  }
  check(
    hit !== null && car.z < tree.z && kph(car) < 0.5,
    'a 100 ms hitch then 8 ms catch-up frames',
    `z ${car.z.toFixed(2)}, ${before.toFixed(0)} -> ${kph(car).toFixed(2)} km/h`,
    `caught before z ${tree.z}`,
  );
}

console.log('\n── a graze is still a graze ──────────────────────────────────────');
{
  /* Offset so the car's circle only just clips the trunk's. Anything in this band must slide
   * and keep its speed, because a trunk is a post you brush past, not a wall you stop on. */
  const s = world('pine', 1);
  const minD = treeOf(s).r + R;
  const g = runAt(s, 'hyper', 1 / 60, { offset: minD * 0.995 });
  check(
    g.hit !== null && g.after > g.before * 0.75,
    `clipped at ${(minD * 0.995).toFixed(2)} m offset (minD ${minD.toFixed(2)})`,
    `${g.before.toFixed(1)} -> ${g.after.toFixed(1)} km/h`,
    '> 75% kept — slides past',
  );
  const m = runAt(s, 'hyper', 1 / 60, { offset: minD * 1.02 });
  check(m.hit === null && m.z > treeOf(s).z, 'clean miss just outside the collider', `${m.after.toFixed(1)} km/h`, 'no hit, drives on');
}

console.log('\n── no impact is ever reported without something to hit ───────────');
function forestChunk() {
  for (let j = -12; j <= 12; j++) {
    for (let i = -12; i <= 12; i++) {
      const t = scatterChunk({ cx: i, cz: j, level: 0, seed: SEED });
      if (t.trees.length >= 10) return { cx: i, cz: j, scat: t };
    }
  }
  throw new Error('no chunk with trees — the scatter changed');
}
{
  /* The oracle: a brute-force swept segment-versus-circle test over every collider in a real
   * chunk. resolve() must agree with it exactly — no hit it cannot justify, and no collider
   * it walked through without noticing. */
  const { cx, cz, scat } = forestChunk();
  const list = solidsFromScatter(scat);
  const solids = new Solids();
  solids.addChunk(`${cx},${cz}`, list);

  let n = 0;
  let reported = 0;
  let real = 0;
  let falsePos = 0;
  let missed = 0;
  const ox = cx * 64;
  const oz = cz * 64;
  // A deterministic fan of straight steps over the chunk. No Math.random: this run has to be
  // the same run tomorrow.
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2;
    const vx = Math.cos(ang) * 60;
    const vz = Math.sin(ang) * 60;
    for (let k = 0; k < 64; k++) {
      const px = ox + (k % 8) * 8 + 4;
      const pz = oz + ((k / 8) | 0) * 8 + 4;
      const dt = 1 / 30;
      // An overlapping start is a different (legitimate) code path and would muddy a clean
      // in/out oracle, so those starts are skipped.
      let inside = false;
      for (const s of list) if (Math.hypot(px - s.x, pz - s.z) < s.r + R) inside = true;
      if (inside) continue;
      n++;
      let truth = false;
      for (const s of list) {
        const minD = s.r + R;
        const fx = px - s.x;
        const fz = pz - s.z;
        const ex = vx * dt;
        const ez = vz * dt;
        const A = ex * ex + ez * ez;
        const B = 2 * (fx * ex + fz * ez);
        const C = fx * fx + fz * fz - minD * minD;
        const disc = B * B - 4 * A * C;
        if (disc <= 0) continue;
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        if (t >= 0 && t <= 1) truth = true;
      }
      const car = { x: px + vx * dt, y: 0, z: pz + vz * dt, vx, vz, yawRate: 0 };
      solids._px = px;
      solids._pz = pz;
      const h = solids.resolve(car, R, dt);
      if (h) reported++;
      if (truth) real++;
      if (h && !truth) falsePos++;
      if (!h && truth) missed++;
    }
  }
  check(falsePos === 0, `${n} swept steps over chunk (${cx},${cz})`, `${falsePos} phantom`, `0 (${reported} reported, ${real} real)`);
  check(missed === 0, 'and nothing was driven through', `${missed} missed`, '0 missed');
}
{
  // Open ground with no solids at all: 60 seconds flat out, nothing may be reported.
  const solids = new Solids();
  const car = new Vehicle({ tier: 'hyper', terrain: FLAT, preset: 'sport' });
  car.placeAt(0, 0, 0);
  let hits = 0;
  for (let i = 0; i < 60 * 60; i++) {
    car.update(1 / 60, DRIVE);
    if (solids.resolve(car, R, 1 / 60)) hits++;
  }
  check(hits === 0, `60 s flat out over empty ground (${(car.z / 1000).toFixed(2)} km)`, `${hits} hits`, '0');
}

console.log('\n── a teleport is not a drive ─────────────────────────────────────');
{
  /* R, and the water rescue, move the car hundreds of metres with the velocity zeroed. If the
   * sweep believed that step it would report every trunk on the line. */
  const { cx, cz, scat } = forestChunk();
  const list = solidsFromScatter(scat);
  const solids = new Solids();
  solids.addChunk(`${cx},${cz}`, list);
  const tree = list[0];
  const car = { x: tree.x, y: tree.y, z: tree.z - 40, vx: 0, vz: 0, yawRate: 0 };
  solids.resolve(car, R, 1 / 60);
  car.x = tree.x + 6; // placeAt, from 40 m away, straight past the trunk
  car.z = tree.z + 6;
  const h = solids.resolve(car, R, 1 / 60);
  check(h === null, 'placed 40 m across a wood at zero speed', `${h ? h.kind : 'no hit'}`, 'no hit');
}

console.log('\n── the real world, driven ────────────────────────────────────────');
{
  /* Everything above is a rig. This is the game: real terrain, real roads, the real level-0
   * chunks the streamer would have loaded, and the same call order main.js uses —
   * car.update, then solids.resolve, then the surface sample. */
  // A real wood with a real road leading past it: chunk (2,-9) on the shipped seed holds 28
  // trees and the nearest carriageway is 117 m away.
  const wood = { x: 2 * 64 + 32, z: -9 * 64 + 32 };
  const T = new Terrain(SEED, wood.x - 400, wood.z - 400, wood.x + 400, wood.z + 400, 240);
  const q0 = T.roads.query(wood.x, wood.z);
  const solids = new Solids();
  const loaded = new Set();
  const stream = (x, z) => {
    const c0 = Math.floor(x / 64);
    const c1 = Math.floor(z / 64);
    for (let j = -3; j <= 3; j++) {
      for (let i = -3; i <= 3; i++) {
        const key = `${c0 + i},${c1 + j}`;
        if (loaded.has(key)) continue;
        loaded.add(key);
        solids.addChunk(key, solidsFromScatter(scatterChunk({ cx: c0 + i, cz: c1 + j, level: 0, seed: SEED })));
      }
    }
  };

  // 1. Sixty seconds of autopilot on the road. Nothing may be reported: the scatter keeps
  //    trees a carriageway-and-a-half clear of the tarmac, so a hit here is a phantom.
  const car = new Vehicle({ tier: 'sports', terrain: T, preset: 'sport' });
  car.placeAt(q0.qx, q0.qz, Math.atan2(q0.tx, q0.tz));
  const auto = new Autopilot();
  const NEUTRAL = { steer: 0, throttle: 0, brake: 0, handbrake: 0, analogue: true };
  auto.toggle(car);
  let hits = 0;
  let metres = 0;
  let px = car.x;
  let pz = car.z;
  for (let i = 0; i < 60 * 60; i++) {
    if (!auto.on) auto.toggle(car);
    stream(car.x, car.z);
    car.update(1 / 60, auto.update(car, NEUTRAL, 1 / 60) || NEUTRAL);
    if (solids.resolve(car, R, 1 / 60)) hits++;
    metres += Math.hypot(car.x - px, car.z - pz);
    px = car.x;
    pz = car.z;
  }
  check(hits === 0, `${(metres / 1000).toFixed(2)} km of autopilot on the road`, `${hits} hits`, `0 (${solids.count} solids loaded)`);

  // 2. Now leave the road and drive into the wood. The stop has to land on a real collider.
  let stopped = null;
  let before = 0;
  for (let attempt = 0; attempt < 48 && !stopped; attempt++) {
    const q = T.roads.query(wood.x, wood.z);
    const dx = wood.x - q.qx;
    const dz = wood.z - q.qz;
    const L = Math.hypot(dx, dz);
    // Fan the heading either side of "straight at the wood" until one line finds a trunk.
    const fan = ((attempt % 2 ? 1 : -1) * Math.ceil(attempt / 2) * 3 * Math.PI) / 180;
    car.placeAt(q.qx, q.qz, Math.atan2(dx / L, dz / L) + fan);
    solids._px = null;
    for (let i = 0; i < 60 * 12; i++) {
      stream(car.x, car.z);
      car.update(1 / 60, DRIVE);
      const pre = kph(car);
      const h = solids.resolve(car, R, 1 / 60);
      if (h) {
        before = pre;
        stopped = { h, x: car.x, z: car.z, after: kph(car) };
        break;
      }
    }
  }
  if (!stopped) {
    check(false, 'drove off-road into a tree', 'no tree found', 'a hit');
  } else {
    // Which collider is it standing against, and does that collider belong to a drawn tree?
    let nearest = null;
    let nd = Infinity;
    for (const list of solids.byChunk.values()) {
      for (const s of list) {
        const d = Math.hypot(stopped.x - s.x, stopped.z - s.z) - (s.r + R);
        if (Math.abs(d) < Math.abs(nd)) {
          nd = d;
          nearest = s;
        }
      }
    }
    console.log(
      `  stopped at (${stopped.x.toFixed(2)}, ${stopped.z.toFixed(2)}) against a ${nearest.kind} at ` +
        `(${nearest.x.toFixed(2)}, ${nearest.z.toFixed(2)}) r ${nearest.r.toFixed(2)} — surface gap ${nd.toFixed(3)} m`,
    );
    check(
      stopped.after < 0.5 && Math.abs(nd) < 0.05,
      `off-road impact at ${before.toFixed(0)} km/h`,
      `${stopped.after.toFixed(2)} km/h`,
      '-> 0, touching a real collider',
    );
  }
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL GOOD'} — ${Object.keys(TRUNK_R).length} solid species\n`);
process.exit(failures ? 1 : 0);
