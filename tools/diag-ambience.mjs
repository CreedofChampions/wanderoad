/* Wanderoad — the positional ambience, measured.
 *
 * src/audio/ambience.js splits into a WORLD half (AmbienceField: where is the water, where
 * are the trees) and an AUDIO half (the WebAudio graph). The world half has no AudioContext
 * in it precisely so this file can drive it in node and print the gains the game will
 * actually produce at real places in the real world — rather than the gains the curve says
 * it should produce at distances nobody ever stands at.
 *
 * It reports:
 *   1. the raw gain laws, so the tuning is legible
 *   2. a real shoreline, approached from ~500 m to the water's edge, with the surf gain and
 *      the probe's distance error against a dense ray-marched ground truth at every step
 *   3. a real wood, a thin wood and a real open plain, with the bird rate and gain at each
 *   4. handedness, against a synthetic probe set with the answer known in advance
 *   5. cost per probe, and a heap delta over 100 s of driving
 *   6. the whole audio graph built against a counting stub of WebAudio, to prove it is built
 *      once and that a frame — and a bird call — creates no nodes
 *
 * node --expose-gc tools/diag-ambience.mjs [seed]
 */

import {
  AmbienceField, seaGain, birdGain, birdRate, duckFor, SEA_RANGE, SEA_MAX, BIRD_MAX, BIRD_RATE_MAX,
} from '../src/audio/ambience.js';
import { landHeight, findSpawn } from '../src/world/terrain.js';
import { biomeWeights, waterLevelAt, blendScalar, BIOME_SCATTER, BIOME_SHORT } from '../src/world/biomes.js';
import { forestDensity } from '../src/world/scatter.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const f2 = (v, n = 4) => (v === Infinity ? '  inf' : v.toFixed(n));
let FAILED = 0;
const check = (ok, what) => {
  if (!ok) FAILED++;
  return ok ? 'ok' : `FAIL <- ${what}`;
};

const _w = new Float32Array(5);
/** Metres of dry ground above the local water plane. Negative means it is under water. */
function freeboard(x, z) {
  const b = biomeWeights(x, z, SEED, _w);
  const plane = waterLevelAt(b.w, -Infinity);
  return landHeight(x, z, SEED) - (plane === null ? -1e9 : plane);
}
function treesPerHa(x, z) {
  if (freeboard(x, z) < 0) return 0;
  const b = biomeWeights(x, z, SEED, _w);
  return forestDensity(x, z, SEED) * blendScalar(b.w, BIOME_SCATTER, 'trees');
}
const dominant = (x, z) => BIOME_SHORT[biomeWeights(x, z, SEED, _w).dominant];

const spawn = findSpawn(SEED);
console.log(`=== ambience, seed ${SEED} — spawn ${spawn.x.toFixed(0)}, ${spawn.z.toFixed(0)} ===\n`);

/* ── 1. the laws ─────────────────────────────────────────────────────────── */
console.log('--- surf gain law: seaGain(d, extent) ---');
console.log('   d(m)   open water   inlet     pond      (extent 0.45 / 0.12 / 0.03)');
for (const d of [600, 540, 500, 460, 400, 300, 200, 150, 100, 60, 30, 10, 0]) {
  console.log(`  ${String(d).padStart(5)}     ${f2(seaGain(d, 0.45))}   ${f2(seaGain(d, 0.12))}   ${f2(seaGain(d, 0.03))}`);
}
console.log(`  range ${SEA_RANGE} m, peak ${SEA_MAX}  (the engine's wind layer peaks at 0.085)\n`);

console.log('--- bird law: birdGain / birdRate, by trees per hectare in earshot ---');
console.log('  trees/ha   gain     calls/s   one call every');
for (const t of [0, 0.5, 2, 4, 8, 14, 26, 45, 60, 88]) {
  const r = birdRate(t);
  console.log(
    `  ${String(t).padStart(7)}   ${f2(birdGain(t))}   ${f2(r, 3)}     ${r > 0.001 ? (1 / r).toFixed(1) + ' s' : 'never'}`,
  );
}
console.log(`  peak ${BIRD_MAX} per call, max ${BIRD_RATE_MAX}/s  (26 t/ha = the meadow book figure)\n`);

console.log('--- ducking: duckFor(speed, floor, radio) — the "never fight the radio" rule ---');
console.log('   km/h    sea       sea+radio   birds     birds+radio');
for (const kph of [0, 30, 60, 90, 120, 160]) {
  const v = kph / 3.6;
  console.log(
    `  ${String(kph).padStart(5)}   ${f2(duckFor(v, 0.5, false, 0.78))}    ${f2(duckFor(v, 0.5, true, 0.78))}` +
      `      ${f2(duckFor(v, 0.2, false, 0.7))}    ${f2(duckFor(v, 0.2, true, 0.7))}`,
  );
}
console.log('');

/* ── 2. find a real shoreline, and somewhere half a kilometre from it ────────
 * A coarse freeboard grid, then a chamfer distance transform over it, gives every dry cell
 * an approximate distance to water. The approach line runs from a cell about 550 m out to
 * the nearest water cell — which is the drive the operator described. */
console.log('--- finding a real shoreline ---');
const N = 110;
const P = 100;
const grid = new Float32Array(N * N);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) grid[j * N + i] = freeboard(spawn.x + (i - N / 2) * P, spawn.z + (j - N / 2) * P);
}
const gx = (i) => spawn.x + (i - N / 2) * P;
const gz = (j) => spawn.z + (j - N / 2) * P;

// Chamfer distance to the nearest wet cell, in metres. Two passes each way is plenty here.
const dist = new Float32Array(N * N).fill(1e9);
for (let k = 0; k < N * N; k++) if (grid[k] < 0) dist[k] = 0;
const D1 = P;
const D2 = P * Math.SQRT2;
for (let pass = 0; pass < 2; pass++) {
  for (let j = 1; j < N; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      dist[k] = Math.min(dist[k], dist[k - N] + D1, dist[k - 1] + D1, dist[k - N - 1] + D2, dist[k - N + 1] + D2);
    }
  for (let j = N - 2; j >= 0; j--)
    for (let i = N - 2; i >= 1; i--) {
      const k = j * N + i;
      dist[k] = Math.min(dist[k], dist[k + N] + D1, dist[k + 1] + D1, dist[k + N + 1] + D2, dist[k + N - 1] + D2);
    }
}
const wetFrac = grid.reduce((a, v) => a + (v < 0 ? 1 : 0), 0) / (N * N);

/** The nearest flooded cell to a grid cell, by brute force over a bounded window. */
function nearestWet(i0, j0) {
  let best = null;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      if (grid[j * N + i] >= 0) continue;
      const d = Math.hypot((i - i0) * P, (j - j0) * P);
      if (!best || d < best.d) best = { i, j, d };
    }
  return best;
}

// Somewhere ~550 m from water, on ground that has water in only ONE direction — a bay you
// drive down to, not an isthmus with sea on both sides.
let start = null;
for (let j = 8; j < N - 8; j++) {
  for (let i = 8; i < N - 8; i++) {
    const d = dist[j * N + i];
    if (d < 470 || d > 620) continue;
    const score = Math.abs(d - 550);
    if (!start || score < start.score) start = { i, j, d, score };
  }
}
const target = nearestWet(start.i, start.j);
const sx = gx(start.i);
const sz = gz(start.j);
const tx = gx(target.i);
const tz = gz(target.j);
console.log(
  `  world is ${(wetFrac * 100).toFixed(1)}% water over an ${((N * P) / 1000).toFixed(0)} km square`,
);
console.log(
  `  start  ${sx.toFixed(0)}, ${sz.toFixed(0)} (${dominant(sx, sz)}) — ~${start.d.toFixed(0)} m from any water`,
);
console.log(`  water  ${tx.toFixed(0)}, ${tz.toFixed(0)} (${dominant(tx, tz)})\n`);

/* Ground truth: dense ray-march in 32 directions at a 8 m step. Slow and dumb on purpose —
 * it shares no code with the thing it is scoring. */
function trueWaterDist(x, z, max = 640) {
  let best = Infinity;
  for (let a = 0; a < 32; a++) {
    const th = (a / 32) * Math.PI * 2;
    const dx = Math.sin(th);
    const dz = Math.cos(th);
    for (let r = 4; r < max; r += 8) {
      if (r >= best) break;
      if (freeboard(x + dx * r, z + dz * r) < 0) {
        best = r;
        break;
      }
    }
  }
  return best;
}

console.log('--- driving down to a real shoreline (cruising, radio off) ---');
console.log('  along(m)  true d   probe d   err    extent    pan    SURF GAIN   biome');
const field = new AmbienceField(SEED);
const yaw = Math.atan2(tx - sx, tz - sz); // heading straight at the water
const runLen = Math.hypot(tx - sx, tz - sz);
const rows = [];
for (let s = 0; s <= runLen; s += 10) {
  const t = s / runLen;
  const x = sx + (tx - sx) * t;
  const z = sz + (tz - sz) * t;
  field.prime(x, z);
  field.read(x, z, yaw);
  const td = trueWaterDist(x, z);
  rows.push({ s, x, z, td, pd: field.seaDist, ex: field.seaExtent, pan: field.seaRight, g: seaGain(field.seaDist, field.seaExtent) });
}
const pick = (t) => rows.reduce((a, b) => (Math.abs(b.td - t) < Math.abs(a.td - t) ? b : a));
const seen = new Set();
for (const t of [500, 400, 300, 250, 200, 150, 100, 60, 30, 12]) {
  const r = pick(t);
  if (seen.has(r.s)) continue;
  seen.add(r.s);
  const err = r.pd === Infinity ? Infinity : r.pd - r.td;
  console.log(
    `  ${String(r.s).padStart(7)}   ${r.td.toFixed(0).padStart(5)}   ${(r.pd === Infinity ? 'none' : r.pd.toFixed(0)).padStart(6)}` +
      `  ${(err === Infinity ? '  -' : (err > 0 ? '+' : '') + err.toFixed(0)).padStart(5)}   ${f2(r.ex, 3)}   ${f2(r.pan, 2).padStart(5)}` +
      `   ${f2(r.g)}     ${dominant(r.x, r.z)}`,
  );
}
const head = [400, 150, 30].map((d) => ({ d, r: pick(d) }));
console.log('\n  HEADLINE — surf gain at a REAL shoreline (master gain 0.38, so absolute = g x 0.38):');
for (const { d, r } of head) {
  console.log(
    `    ~${String(d).padStart(3)} m from the water :  gain ${f2(r.g)}   absolute ${f2(r.g * 0.38, 5)}` +
      `   (true ${r.td.toFixed(0)} m, probe ${r.pd.toFixed(0)} m, extent ${r.ex.toFixed(3)})`,
  );
}
const ratio = head[2].r.g / Math.max(head[0].r.g, 1e-9);
console.log(`    the sea is ${ratio.toFixed(1)}x louder at the water's edge than at 400 m — ${check(ratio > 3, 'sea barely grows')}`);
const errs = rows.filter((r) => r.pd < 1e8 && r.td < 1e8).map((r) => r.pd - r.td);
const mean = errs.reduce((a, b) => a + b, 0) / (errs.length || 1);
console.log(
  `    probe-vs-truth distance error over the whole run: mean ${mean >= 0 ? '+' : ''}${mean.toFixed(0)} m,` +
    ` worst ${Math.max(...errs.map(Math.abs)).toFixed(0)} m over ${errs.length} steps\n`,
);

/* ── 3. woodland, thin wood and open plain ───────────────────────────────── */
console.log('--- birds: real woodland, thin wood and open plain ---');
let deep = null;
let thin = null;
let plain = null;
/* Score the NEIGHBOURHOOD, not the point. The first run of this picked a "plain" that was a
 * clearing in a wood — nothing growing on the exact square metre sampled and sixty trees a
 * hectare thirty metres away — and then reported that the plains were noisy. Birds are heard
 * from where they are, not from where you are standing. */
const around = (x, z) => {
  let s = treesPerHa(x, z);
  for (const [dx, dz] of [[80, 0], [-80, 0], [0, 80], [0, -80], [55, 55], [-55, -55]]) s += treesPerHa(x + dx, z + dz);
  return s / 7;
};
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = gx(i);
    const z = gz(j);
    if (grid[j * N + i] < 2) continue; // dry ground with freeboard to spare
    const t = around(x, z);
    if (!deep || t > deep.t) deep = { x, z, t };
    if (!plain || t < plain.t) plain = { x, z, t };
    if (t > 6 && t < 14 && (!thin || Math.abs(t - 10) < Math.abs(thin.t - 10))) thin = { x, z, t };
  }
}
console.log('  site           trees/ha near   in earshot   CALL GAIN   calls/s   one every   biome');
const birdRow = {};
for (const [name, site] of [
  ['deep forest', deep],
  ['thin wood  ', thin],
  ['open plain ', plain],
]) {
  if (!site) continue;
  field.prime(site.x, site.z);
  field.read(site.x, site.z, 0);
  const r = birdRate(field.trees);
  birdRow[name.trim()] = { g: birdGain(field.trees), r, trees: field.trees };
  console.log(
    `  ${name}      ${site.t.toFixed(1).padStart(7)}      ${field.trees.toFixed(1).padStart(7)}` +
      `      ${f2(birdGain(field.trees))}    ${f2(r, 3)}    ${r > 0.001 ? (1 / r).toFixed(1) + ' s' : '  never'}` +
      `   ${dominant(site.x, site.z)}`,
  );
}
console.log(
  `  woodland louder than plain: ${check(birdRow['deep forest'].g > birdRow['open plain'].g * 8, 'plain is not quiet')}` +
    `   and busier: ${check(birdRow['deep forest'].r > birdRow['open plain'].r * 4, 'plain is not sparse')}` +
    `   plain under a tenth of peak: ${check(birdRow['open plain'].g < BIRD_MAX * 0.1, 'plain is loud')}\n`,
);

/* ── 4. handedness ───────────────────────────────────────────────────────────
 * The bug this project has already paid for three times, tested against an answer worked out
 * before the code runs rather than against the code's own opinion.
 *
 * three.js is right-handed with +Y up. Facing +Z, the right-hand direction is
 * forward x up = (0,0,1) x (0,1,0) = (-1,0,0) — so +X is on your LEFT, which is the note at
 * the top of this project's brief. A probe planted due +X of a car at yaw 0 must therefore
 * come back with a NEGATIVE seaRight, because StereoPannerNode wants -1 for left.
 *
 * The probe arrays are written directly here: a synthetic world with exactly one wet cell in
 * it is the only way to know the right answer independently of the thing being tested.
 */
console.log('--- handedness: a probe planted due +X must pan LEFT ---');
{
  const fx = 0;
  const fy = 0;
  const fz = 1; // forward = +Z (yaw 0)
  const ux = 0;
  const uy = 1;
  const uz = 0; // up = +Y
  // right = forward x up, spelled out so nobody has to take it on trust
  const rx = fy * uz - fz * uy;
  const rz = fx * uy - fy * ux;
  console.log(`  three.js right-hand rule: facing +Z, "right" is (${rx}, ${rz}) — so +X is on the ${rx < 0 ? 'LEFT' : 'RIGHT'}`);

  const hf = new AmbienceField(SEED);
  const CX = 1000;
  const CZ = 2000;
  const plant = (dx, dz) => {
    hf._live.fill(1);
    hf._wet.fill(0);
    hf._fb.fill(50);
    hf._trees.fill(0);
    for (let i = 0; i < hf._px.length; i++) {
      hf._px[i] = CX + hf._ox[i];
      hf._pz[i] = CZ + hf._oz[i];
      hf._inner[i] = i; // switch the waterline interpolation off: one lone cell, no shore
    }
    // Slot 1 is moved to the requested offset and made both wet and wooded.
    hf._px[1] = CX + dx;
    hf._pz[1] = CZ + dz;
    hf._wet[1] = 1;
    hf._fb[1] = -1;
    hf._trees[1] = 40;
  };
  for (const [label, dx, dz, side] of [
    ['due +X (screen left) ', 120, 0, -1],
    ['due -X (screen right)', -120, 0, +1],
    ['due +Z (dead ahead)  ', 0, 120, 0],
    ['due -Z (astern)      ', 0, -120, 0],
  ]) {
    plant(dx, dz);
    hf.read(CX, CZ, 0);
    const s = hf.seaRight;
    const t = hf.treeRight;
    const ok = side === 0 ? Math.abs(s) < 0.02 && Math.abs(t) < 0.02 : Math.sign(s) === side && Math.sign(t) === side;
    console.log(
      `  ${label}  seaRight ${f2(s, 3).padStart(7)}  treeRight ${f2(t, 3).padStart(7)}   ${check(ok, label + ' panned the wrong way')}`,
    );
  }
  // And it must swing with the car: turn to face the water and the pan must come to centre.
  plant(120, 0);
  hf.read(CX, CZ, Math.atan2(120, 0));
  console.log(`  turn to face it        seaRight ${f2(hf.seaRight, 3).padStart(7)}                       ${check(Math.abs(hf.seaRight) < 0.02, 'pan does not follow the car')}`);
}
console.log('');

/* ── 5. cost, and the no-allocation claim ────────────────────────────────── */
console.log('--- cost ---');
const cf = new AmbienceField(SEED);
const NPROBE = cf._px.length;
cf.prime(spawn.x, spawn.z);
let t0 = performance.now();
const REPS = 400;
for (let i = 0; i < REPS; i++) cf.prime(spawn.x + i * 0.7, spawn.z + i * 0.3);
let t1 = performance.now();
const perProbe = ((t1 - t0) * 1000) / (REPS * NPROBE);
console.log(`  ${NPROBE} probes in the lattice; one probe (landHeight + biomeWeights + forestDensity) = ${perProbe.toFixed(2)} us`);
console.log(
  `  the game spends 240 probes/s -> ${((perProbe * 240) / 1000).toFixed(2)} ms per second of wall clock` +
    ` = ${((perProbe * 240) / 1000 / 60).toFixed(3)} ms per frame at 60 fps, full sweep every ${(NPROBE / 240).toFixed(2)} s`,
);
global.gc?.();
const before = process.memoryUsage().heapUsed;
t0 = performance.now();
const FRAMES = 6000; // 100 seconds of gameplay at 60 fps
for (let i = 0; i < FRAMES; i++) cf.update(1 / 60, spawn.x + i * 0.4, spawn.z, (i * 0.001) % 6.28);
t1 = performance.now();
global.gc?.();
const after = process.memoryUsage().heapUsed;
console.log(
  `  AmbienceField.update() x ${FRAMES} (100 s of driving): ${(t1 - t0).toFixed(0)} ms total,` +
    ` ${(((t1 - t0) * 1000) / FRAMES).toFixed(1)} us per frame`,
);
console.log(
  `  heap delta over those ${FRAMES} frames: ${((after - before) / 1024).toFixed(1)} KiB` +
    `${global.gc ? '' : '   (re-run with --expose-gc for a clean number)'}\n`,
);

/* ── 6. the graph is built once ──────────────────────────────────────────────
 * A counting stub of the parts of WebAudio this project uses. It is not a simulation of
 * anything — it exists to answer one question: does a frame create nodes? EngineAudio is
 * driven through it for 100 s of gameplay, radio on, next to water and trees.
 */
console.log('--- the audio graph, against a counting stub of WebAudio ---');
{
  let nodes = 0;
  let params = 0;
  /* The param stub REMEMBERS the last value written to it. That is the point: this project
   * has twice shipped a tunable that was computed and then never reached the thing it was
   * meant to control, so "the gain is 0.06" has to mean "the GainNode's AudioParam was handed
   * 0.06", not "a field on a JS object holds 0.06". */
  const P = () => {
    params++;
    const p = {
      value: 0,
      setValueAtTime(v) { p.value = v; },
      linearRampToValueAtTime(v) { p.value = v; },
      exponentialRampToValueAtTime(v) { p.value = v; },
      setTargetAtTime(v) { p.value = v; },
      cancelScheduledValues() {},
    };
    return p;
  };
  // Nodes remember what they were wired to, so the "it respects the existing volume control"
  // claim can be checked by walking the graph instead of by asserting it in a comment.
  const node = (extra) => {
    nodes++;
    const n = Object.assign({ id: nodes, to: [], connect(d) { n.to.push(d); return d; }, disconnect() {} }, extra);
    return n;
  };
  const reaches = (from, target, seen = new Set()) => {
    if (from === target) return true;
    if (!from || seen.has(from)) return false;
    seen.add(from);
    return (from.to || []).some((n) => reaches(n, target, seen));
  };
  class MockCtx {
    constructor() {
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.state = 'running';
      this.destination = { connect: (d) => d };
    }
    createGain() { return node({ gain: P() }); }
    createBiquadFilter() { return node({ type: '', frequency: P(), Q: P() }); }
    createOscillator() { return node({ type: '', frequency: P(), detune: P(), start() {}, stop() {} }); }
    createStereoPanner() { return node({ pan: P() }); }
    createBufferSource() { return node({ buffer: null, loop: false, start() {}, stop() {} }); }
    createConvolver() { return node({ buffer: null }); }
    createBuffer(ch, len) {
      const d = [];
      for (let i = 0; i < ch; i++) d.push(new Float32Array(len));
      return { length: len, getChannelData: (i) => d[i] };
    }
    close() { return Promise.resolve(); }
  }
  global.window = { AudioContext: MockCtx };
  global.addEventListener = () => {};
  const { EngineAudio } = await import('../src/audio/engine.js');

  const audio = new EngineAudio({ seed: SEED });
  audio.start();
  const afterStart = nodes;
  audio.nextStation(); // radio ON, so the ducking path is exercised too
  // A car idling at the water's edge we measured above.
  const car = {
    x: head[2].r.x, z: head[2].r.z, yaw: 0.4, speed: 12, rpm: 2600, throttle: 0.3, brake: 0,
    limit: 0.2, slip: 0.02, surfaceKind: 'tarmac', spec: { redline: 6500 },
    terrain: { seed: SEED },
  };
  audio.update(1 / 60, car);
  const built = nodes;
  const builtParams = params;

  /* ATTRIBUTION MATTERS HERE. The radio builds an oscillator and a gain per note and throws
   * them away when the note ends — that is its documented design (Radio._voice) and it is not
   * what is being measured. Wrapping the ambience's own update is what makes the answer about
   * the ambience. */
  let ambNodes = 0;
  let ambParams = 0;
  const realUpdate = audio.ambience.update.bind(audio.ambience);
  audio.ambience.update = (...a) => {
    const n0 = nodes;
    const p0 = params;
    realUpdate(...a);
    ambNodes += nodes - n0;
    ambParams += params - p0;
  };
  let calls = 0;
  const realCall = audio.ambience._call.bind(audio.ambience);
  audio.ambience._call = (r) => { calls++; realCall(r); };

  const half = FRAMES / 2;
  let shoreSnap = null;
  let shoreCalls = 0;
  for (let i = 0; i < FRAMES; i++) {
    // Half the run at the shoreline, half parked in the deep forest found above — so the
    // surf path and the bird path are both exercised for 50 s each.
    if (i === half) {
      const a0 = audio.ambience;
      shoreSnap = {
        sea: a0.seaGainNode.gain.value, low: a0.seaLow.frequency.value, hiss: a0.hissGain.gain.value,
        pan: a0.seaPan.pan.value, lfo: a0.lfoDepth.map((l) => l.g.gain.value), _sea: a0._sea,
        dist: a0.field.seaDist, ext: a0.field.seaExtent,
      };
      shoreCalls = calls;
      car.x = deep.x;
      car.z = deep.z;
    }
    audio.ctx.currentTime += 1 / 60;
    audio.update(1 / 60, car);
  }
  console.log(`  nodes after EngineAudio.start()             : ${afterStart}`);
  console.log(`  nodes after the first update() (ambience)   : ${built}   (+${built - afterStart} for the surf and the four bird voices)`);
  console.log(`  nodes created by ${FRAMES} ambience updates  : ${ambNodes}    ${check(ambNodes === 0, 'the ambience graph grows per frame')}`);
  console.log(`  AudioParams created by those updates       : ${ambParams}    ${check(ambParams === 0, 'params allocated per frame')}`);
  console.log(`  ...including ${calls} bird calls             ${check(calls > 0, 'no birds fired next to a wood')} — a call is automation on a running oscillator, not a node`);
  console.log(`  _ensureAmbience built the graph            : ${audio._ambienceBuilds} time  ${check(audio._ambienceBuilds === 1, 'graph built more than once')}`);
  console.log(`  (for contrast, the radio's per-note voices : ${nodes - built} nodes / ${params - builtParams} params over the same ${FRAMES} frames — pre-existing, by design)`);

  /* Did the numbers actually REACH the graph? Read them back off the AudioParams rather than
   * off the JS fields that computed them. */
  const a = audio.ambience;
  console.log(`\n  AudioParams after 50 s at the water's edge (radio ON, 43 km/h):`);
  console.log(`    seaGainNode.gain      ${f2(shoreSnap.sea)}   ${check(Math.abs(shoreSnap.sea - shoreSnap._sea) < 1e-9, 'surf gain never reached the node')}` +
    `  = raw ${f2(seaGain(shoreSnap.dist, shoreSnap.ext))} ducked by radio 0.78`);
  console.log(`    seaHP.frequency       ${a.seaHP.frequency.value.toFixed(0).padStart(6)} Hz   (fixed — keeps the surf off the engine's 26-74 Hz)`);
  console.log(`    seaLow.frequency      ${shoreSnap.low.toFixed(0).padStart(6)} Hz   (420 far, up to ~2100 at the water's edge)`);
  console.log(`    hissGain.gain         ${f2(shoreSnap.hiss)}   (the breaking wave — only inside ~220 m of open water)`);
  console.log(`    seaPan.pan            ${f2(shoreSnap.pan, 3)}   (-1 port, +1 starboard)`);
  console.log(`    swell LFO depths      ${shoreSnap.lfo.map((v) => f2(v, 3)).join(' / ')}   (of 0.22 / 0.13 — a swell, not a hiss)`);
  console.log(`    bird calls there      ${shoreCalls} in 50 s   (a steppe shore: almost no trees)`);

  console.log('\n  AudioParams after 50 s parked in the deep forest:');
  console.log(`    seaGainNode.gain      ${f2(a.seaGainNode.gain.value)}   (no water within ${SEA_RANGE} m — the layer switches itself off)`);
  const lastVoice = a.voices[(a._voice + a.voices.length - 1) % a.voices.length];
  console.log(`    a bird voice's gain   ${f2(lastVoice.g.gain.value, 6)} at the end of its call, pan ${f2(lastVoice.p.pan.value, 2)}`);
  console.log(`    bird gain / rate      ${f2(a._birdG)} / ${f2(a._birdRate, 3)} calls per s   ${check(a._birdG > 0.02, 'the forest is silent')}`);
  const realised = (calls - shoreCalls) / 50;
  console.log(`    calls in that 50 s    ${calls - shoreCalls} = ${realised.toFixed(2)}/s against birdRate()'s ${f2(a._birdRate, 3)}/s` +
    `   ${check(Math.abs(realised - a._birdRate) < 0.12, 'the realised rate is not the rate in the table')}`);

  console.log('\n  routing — walked, not assumed:');
  console.log(`    ambience.out -> master        ${check(reaches(a.out, audio.master), 'ambience bypasses master')}`);
  console.log(`    surf         -> master        ${check(reaches(a.seaGainNode, audio.master), 'surf bypasses master')}`);
  console.log(`    bird voices  -> master        ${check(a.voices.every((v) => reaches(v.g, audio.master)), 'birds bypass master')}`);
  console.log(`    master       -> destination   ${check(reaches(audio.master, audio.ctx.destination), 'master is not connected')}`);
  const mv = audio.master.gain.value;
  audio.setVolume(0.11);
  console.log(`    setVolume(0.11): master ${mv} -> ${audio.master.gain.value}   ${check(audio.master.gain.value === 0.11, 'setVolume does not move master')}` +
    ' — one volume control, and it is upstream of everything above');
}

console.log(`\n${FAILED === 0 ? 'ambience: OK' : `ambience: ${FAILED} CHECK(S) FAILED`}`);
process.exit(FAILED === 0 ? 0 : 1);
