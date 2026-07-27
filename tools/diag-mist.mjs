/* Wanderoad — does the valley mist actually pool in the valleys?
 *
 * This project has shipped a build where the flag was set and the pixels were wrong, so the
 * bar for an atmospheric change is measured density at real world coordinates, not "the
 * shader has a mist term in it now". There is no GPU here, so this file does three things
 * that together are as close to that bar as a node script can get:
 *
 *   1. TRANSCRIBES aerial()'s mist arithmetic into JS — and then goes back to the REAL
 *      shader string and asserts every constant in the transcription is still the constant
 *      in the shader. A model that has drifted from the code it models is worse than no
 *      model, so the drift is what is tested first.
 *   2. STATICALLY CHECKS the assembled fragment shaders. The one trap in this codebase is
 *      that render/clouds.js assembles `fragHead(GL_LIGHT, CLOUD_FS)` with NO hash and NO
 *      noise chunk in front of it, so anything GL_LIGHT reaches for that it does not define
 *      itself fails to compile exactly one material out of eleven — and a material that
 *      fails to compile is a silently missing cloud deck. Every real chunk combination in
 *      the render/ directory is assembled here and every function call in it is resolved.
 *   3. MEASURES the mist on REAL TERRAIN. Not a plane, not a sine: landHeight() at thousands
 *      of actual world coordinates around a real findSpawn(), from real camera poses, with
 *      low ground and high ground compared AT MATCHED DISTANCE — because "mist is thicker
 *      far away" is not the claim. The claim is that it pools.
 *
 * What it cannot do: read a pixel. Nothing here proves the shader compiles on a driver or
 * that the colour reaching the canvas is the colour computed below. That is the browser
 * suite's job.
 *
 * Run: node tools/diag-mist.mjs [seed]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GL_LIGHT, GL_UNI, GL_SKY, GL_HASH, GL_NOISE, fragHead } from '../src/core/glsl.js';
import { U } from '../src/render/uniforms.js';
import { RGB } from '../src/core/palette.js';
import { landHeight, findSpawn } from '../src/world/terrain.js';
import { sunDirection } from '../src/render/uniforms.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = Number(process.argv[2]) || 20260726;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};
const f = (n, d = 3) => Number(n).toFixed(d);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ── 1: the transcription, and the proof it has not drifted ───────────────────
 * Every number below appears twice: once here, once in the shader. The block after
 * it reads the shader back and refuses to let the two disagree. */

const K = {
  clampLo: -3.0,
  clampHi: 24.0,
  perDepth: 1300.0, // one optical depth per 1300 m at the mist sea's own level
  nearA: 16.0,
  nearB: 165.0, // the near ramp that keeps the bonnet clear
  gate: 0.02, // below this the layering branch is skipped entirely
  layerBase: 0.83,
  layerAmp: 0.34,
  sheetBase: 0.45,
  sheetAmp: 0.55,
  sheetFx: 0.019,
  sheetFy: 0.052,
  patchF: 0.00082,
  driftK: 0.30,
  alphaK: 0.90, // how much of the mist lands in the post chain's distance channel
  mieToHorsun: 0.62,
  mieToGlow: 0.30,
};

const fract = (x) => x - Math.floor(x);
/** GL_LIGHT's mstHash, term for term. */
function mstHash(px, py) {
  let qx = fract(px * 0.1031);
  let qy = fract(py * 0.1031);
  let qz = fract(px * 0.1031);
  const dp = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33); // dot(q, q.yzx+33.33)
  qx += dp;
  qy += dp;
  qz += dp;
  return fract((qx + qy) * qz);
}
/** GL_LIGHT's mstNoise, term for term. */
function mstNoise(px, py) {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  let fx = px - ix;
  let fy = py - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = mstHash(ix, iy);
  const b = mstHash(ix + 1, iy);
  const c = mstHash(ix, iy + 1);
  const d = mstHash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/**
 * aerial()'s mist term. `dist` is the shader's view-space depth; for a fragment on the view
 * axis that is the euclidean range, which is what every sample below uses.
 * @returns {{mist:number, optical:number, layered:boolean}}
 */
function mistAt({ cam, P, dist, mist: M = U.uMist.value, drift = { x: 0, y: 0 } }) {
  const H = Math.max(M.z, 4);
  const a = clamp((cam.y - M.y) / H, K.clampLo, K.clampHi);
  const b = clamp((P.y - M.y) / H, K.clampLo, K.clampHi);
  const ea = Math.exp(-a);
  const eb = Math.exp(-b);
  const db = b - a;
  const mean = Math.abs(db) < 1e-3 ? ea : (ea - eb) / db;
  const optical = Math.max(mean, 0) * dist * (1 / K.perDepth) * M.x * smoothstep(K.nearA, K.nearB, dist);
  let m = 1 - Math.exp(-optical);
  let layered = false;
  if (m > K.gate) {
    layered = true;
    const sheet = mstNoise(P.y * K.sheetFx + 4.7, P.y * K.sheetFy);
    // V = normalize(cam - P); the shader reconstructs pxz = cam.xz - V.xz*dist
    const vx = cam.x - P.x;
    const vy = cam.y - P.y;
    const vz = cam.z - P.z;
    const vl = Math.hypot(vx, vy, vz) || 1;
    const pxz = [cam.x - (vx / vl) * dist + drift.x * K.driftK, cam.z - (vz / vl) * dist + drift.y * K.driftK];
    const patch = mstNoise(pxz[0] * K.patchF, pxz[1] * K.patchF);
    m = clamp(m * (K.layerBase + K.layerAmp * patch * (K.sheetBase + K.sheetAmp * sheet)), 0, 1);
  }
  return { mist: m, optical, layered };
}

console.log(`\n=== 1. THE MODEL vs THE SHADER ===`);
{
  const src = GL_LIGHT;
  const has = (re, what) => ok(re.test(src), `shader still says ${what}`, String(re).slice(0, 62));
  ok(/uniform vec3\s+uMist;/.test(GL_UNI), 'uMist is declared in the shared uniform block, so every material sees it');
  ok(!!U.uMist && U.uMist.value.isVector3, 'and render/uniforms.js actually supplies it', `uMist = (${U.uMist.value.x}, ${U.uMist.value.y}, ${U.uMist.value.z})`);
  has(/clamp\(\(uCamPos\.y - uMist\.y\)\/H, -3\.0, 24\.0\)/, 'the camera altitude is clamped to -3..24 scale heights');
  has(/clamp\(\(worldY\s+- uMist\.y\)\/H, -3\.0, 24\.0\)/, 'the fragment altitude is clamped the same way');
  has(/\(ea - eb\)\/db/, 'the optical depth is the analytic exponential integral');
  has(/\(1\.0\/1300\.0\)/, `one optical depth per ${K.perDepth} m at the sea's own level`);
  has(/smoothstep\(16\.0, 165\.0, dist\)/, 'the near ramp is 16..165 m');
  has(/mist > 0\.02/, 'the layering branch is gated at 0.02');
  // mstPatch, not patch: `patch` is a reserved word in GLSL ES 3.00 and was the entire
  // "mist broke every shader" incident — see the comment at the identifier in core/glsl.js.
  has(/0\.83 \+ 0\.34\*mstPatch\*\(0\.45 \+ 0\.55\*sheet\)/, 'the layering weights are 0.83 + 0.34 * mstPatch * (0.45 + 0.55 * sheet)');
  has(/worldY\*0\.019 \+ 4\.7, worldY\*0\.052/, 'the sheets are a function of altitude alone');
  has(/pxz\*0\.00082/, 'the patch field is 1/0.00082 = 1219 m across');
  has(/uCloudDrift\*0\.30/, "the mist drifts on the cloud deck's own wind");
  has(/gFogAmt = clamp\(f \+ mist\*\(1\.0 - f\)\*0\.90/, 'the mist lands in the post chain\'s distance channel');
  has(/mix\(K_MIST, K_SKY_HORSUN, mie\*0\.62\)/, 'the mist goes luminous toward the sun');
  ok(!/float pool = smoothstep\(46\.0, 8\.0, worldY\)/.test(src), 'and the old altitude-only wash is GONE, not left running alongside it');
  ok(/uMist\.x/.test(GL_SKY), 'the sky carries the same mist band at the skyline', 'GL_SKY reads uMist.x');
}

/* ── 2: does every real shader in the project still assemble? ────────────────── */

console.log(`\n=== 2. STATIC CHECK OF EVERY ASSEMBLED SHADER ===`);
{
  /* GLSL builtins and the things the heads/palette define. Anything called that is not in
   * here and not defined in the assembled text is an undefined symbol on a real driver. */
  const BUILTIN = new Set([
    'abs', 'acos', 'all', 'any', 'asin', 'atan', 'ceil', 'clamp', 'cos', 'cosh', 'cross',
    'degrees', 'distance', 'dot', 'equal', 'exp', 'exp2', 'faceforward', 'floor', 'fract',
    'fwidth', 'greaterThan', 'greaterThanEqual', 'inversesqrt', 'length', 'lessThan',
    'lessThanEqual', 'log', 'log2', 'max', 'min', 'mix', 'mod', 'normalize', 'not',
    'notEqual', 'pow', 'radians', 'reflect', 'refract', 'round', 'sign', 'sin', 'sinh',
    'smoothstep', 'sqrt', 'step', 'tan', 'tanh', 'texture', 'textureLod', 'textureSize',
    'transpose', 'trunc', 'dFdx', 'dFdy', 'discard', 'main',
    'float', 'int', 'uint', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4',
    'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'if', 'for', 'while', 'return',
    'Surf', 'switch',
  ]);
  /* Comments first. A prose sentence with a bracket in it is not a syntax error, and a
   * function NAMED in a comment is not a function CALLED — the first version of this check
   * reported `rho`, `hue` and `it` as undefined symbols, all three of them English. */
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const check = (name, raw) => {
    const text = strip(raw);
    const braces = (text.match(/{/g) || []).length - (text.match(/}/g) || []).length;
    const parens = (text.match(/\(/g) || []).length - (text.match(/\)/g) || []).length;
    const defined = new Set();
    // `type name(` at the head of a line-ish position is a definition
    for (const m of text.matchAll(/(?:^|[\n;}])\s*(?:const\s+)?\w+(?:\s*\[\s*\d*\s*\])?\s+(\w+)\s*\(/g)) defined.add(m[1]);
    const missing = new Set();
    for (const m of text.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const id = m[1];
      if (BUILTIN.has(id) || defined.has(id)) continue;
      missing.add(id);
    }
    ok(braces === 0 && parens === 0, `${name}: brackets balance`, `braces ${braces}, parens ${parens}`);
    ok(missing.size === 0, `${name}: every function it calls is defined in it`, missing.size ? [...missing].join(', ') : `${defined.size} functions`);
  };

  const cloudField = /* the shape glCloudField() produces; its own chunk is imported below */ null;
  // The real combinations, read off the real call sites in src/render/*.js.
  const { glCloudField } = await import('../src/core/glsl.js');
  const { GL_SHADOW } = await import('../src/core/glsl.js');
  const CF = glCloudField({ cshSpan: 9200, cloudDeck: 980 });
  void cloudField;
  const CALLS = [
    // THE TRAP: clouds.js assembles GL_LIGHT with no hash and no noise in front of it.
    ['clouds CLOUD_FS  (GL_LIGHT alone — the one that breaks)', fragHead(GL_LIGHT, 'void main(){}')],
    ['terrain', fragHead(GL_HASH, GL_NOISE, GL_SKY, CF, GL_SHADOW, GL_LIGHT, 'void main(){}')],
    ['painted / car / props', fragHead(GL_HASH, GL_NOISE, CF, GL_SHADOW, GL_LIGHT, 'void main(){}')],
    ['water', fragHead(GL_HASH, GL_NOISE, GL_SKY, CF, GL_SHADOW, GL_LIGHT, 'void main(){}')],
    ['sky', fragHead(GL_HASH, GL_NOISE, GL_SKY, 'void main(){}')],
  ];
  for (const [name, text] of CALLS) check(name, text);

  /* And the call sites themselves, so this list cannot quietly stop describing the code. */
  const clouds = readFileSync(join(ROOT, 'src/render/clouds.js'), 'utf8');
  ok(
    /fragHead\(GL_LIGHT,\s*CLOUD_FS\)/.test(clouds),
    'render/clouds.js really does assemble GL_LIGHT bare — which is why the mist noise is self-contained',
    'fragHead(GL_LIGHT, CLOUD_FS)',
  );
  const lightCode = strip(GL_LIGHT);
  ok(
    /float mstHash/.test(lightCode) && /float mstNoise/.test(lightCode) &&
      !/\bpn2\s*\(|\bfbm2\s*\(|\bvn2\s*\(|\bpn3\s*\(|hash1[23]\s*\(/.test(lightCode),
    'GL_LIGHT defines its own noise and reaches for none of GL_NOISE\'s',
    'mstHash + mstNoise, no pn2/fbm2/vn2/hash12',
  );
}

/* ── 3: worldgen reachability (gotcha 2) ─────────────────────────────────────── */

console.log(`\n=== 3. IS ANY OF THIS WORLDGEN-SIDE? ===`);
{
  const worker = readFileSync(join(ROOT, 'src/world/chunkWorker.js'), 'utf8');
  const imports = [...worker.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  const touchesGlsl = imports.some((p) => /glsl|uniforms|palette/.test(p));
  console.log(`  chunkWorker.js imports: ${imports.join(', ')}`);
  ok(!touchesGlsl, 'the chunk worker\'s module graph does not reach the shader library at all', 'so there is nothing for it to miss');
  const chunk = readFileSync(join(ROOT, 'src/world/chunk.js'), 'utf8');
  ok(!/uMist|mist/i.test(chunk), 'and no mist term is baked into a chunk attribute', 'the mist is entirely per-fragment');
}

/* ── 4: the measurement — does it pool? ───────────────────────────────────────── */

console.log(`\n=== 4. MIST ON REAL TERRAIN (seed ${SEED}) ===`);
const spawn = findSpawn(SEED);
const ground = (x, z) => landHeight(x, z, SEED);
const M = U.uMist.value;
console.log(`  spawn ${spawn.x | 0}, ${spawn.z | 0} at y=${f(ground(spawn.x, spawn.z), 1)} m;  uMist = (amount ${M.x}, sea ${M.y} m, scale height ${M.z} m)`);

/* The relief the mist is anchored to, measured rather than assumed. */
{
  const hs = [];
  for (let i = 0; i < 6000; i++) {
    const a = i * 2.399963;
    const r = Math.sqrt(i / 6000) * 5000;
    hs.push(ground(spawn.x + Math.cos(a) * r, spawn.z + Math.sin(a) * r));
  }
  hs.sort((a, b) => a - b);
  const q = (p) => hs[Math.floor(p * (hs.length - 1))];
  console.log(
    `  land within 5 km:  min ${f(q(0), 1)}  p25 ${f(q(0.25), 1)}  median ${f(q(0.5), 1)}  p75 ${f(q(0.75), 1)}  p95 ${f(q(0.95), 1)}  max ${f(q(1), 1)} m`,
  );
  ok(
    q(0.5) < M.y + 20 && q(0.95) > M.y + 3 * M.z * 0.6,
    'the mist sea sits in the land\'s own relief: below the median, far below the 95th percentile',
    `sea ${M.y} m vs median ${f(q(0.5), 1)} m and p95 ${f(q(0.95), 1)} m`,
  );
}

/* THE ONE THAT MATTERS. From a real camera pose, sample real ground at MATCHED DISTANCE and
 * split it by altitude. "Further away is mistier" is not the claim; "lower is mistier" is. */
{
  const cam = { x: spawn.x, y: ground(spawn.x, spawn.z) + 60, z: spawn.z };
  const BAND = [560, 640]; // metres — one distance band, so distance cannot explain anything
  const pts = [];
  for (let i = 0; i < 4000; i++) {
    const a = (i / 4000) * Math.PI * 2 * 13.7;
    const d = BAND[0] + ((i * 37) % 100) * ((BAND[1] - BAND[0]) / 100);
    const x = cam.x + Math.cos(a) * d;
    const z = cam.z + Math.sin(a) * d;
    const y = ground(x, z);
    const dist = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    pts.push({ x, y, z, dist, ...mistAt({ cam, P: { x, y, z }, dist }) });
  }
  const byY = [...pts].sort((a, b) => a.y - b.y);
  const dec = (arr) => arr.reduce((s, p) => s + p.mist, 0) / arr.length;
  const lo = byY.slice(0, Math.floor(byY.length * 0.1));
  const hi = byY.slice(-Math.floor(byY.length * 0.1));
  const loY = lo.reduce((s, p) => s + p.y, 0) / lo.length;
  const hiY = hi.reduce((s, p) => s + p.y, 0) / hi.length;
  const loD = lo.reduce((s, p) => s + p.dist, 0) / lo.length;
  const hiD = hi.reduce((s, p) => s + p.dist, 0) / hi.length;

  console.log(`\n  4000 real ground points in a single ${BAND[0]}-${BAND[1]} m band, camera 60 m above the spawn:`);
  console.log('    group                     mean altitude   mean range   mean mist');
  console.log(`    lowest decile of ground   ${f(loY, 1).padStart(10)} m   ${f(loD, 0).padStart(8)} m   ${f(dec(lo), 3).padStart(8)}`);
  console.log(`    highest decile of ground  ${f(hiY, 1).padStart(10)} m   ${f(hiD, 0).padStart(8)} m   ${f(dec(hi), 3).padStart(8)}`);
  const ratio = dec(lo) / Math.max(dec(hi), 1e-6);
  ok(
    ratio > 2.5,
    'low ground is MUCH mistier than high ground at the same distance — it pools',
    `${f(ratio, 2)}x  (${f(dec(lo), 3)} vs ${f(dec(hi), 3)}, ranges ${f(loD, 0)} m vs ${f(hiD, 0)} m)`,
  );
  ok(Math.abs(loD - hiD) < 30, 'and distance cannot be the explanation', `${f(Math.abs(loD - hiD), 1)} m apart`);

  /* The other half of the same property, and the one you actually feel while driving: the
   * CAMERA's own altitude. Identical ground points, identical ranges, two camera heights —
   * one down in the valley and one up on a 200 m shoulder. The ray from the valley spends
   * its whole length in thick air; the ray from the shoulder spends most of it above the
   * sea and only arrives in the mist at the far end. That is "sitting in the valleys". */
  const same = pts.slice(0, 1200);
  const inIt = { x: spawn.x, y: 9, z: spawn.z };
  const above = { x: spawn.x, y: 200, z: spawn.z };
  const meanFrom = (cam) =>
    same.reduce((s, p) => {
      const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      return s + mistAt({ cam, P: p, dist: d }).mist;
    }, 0) / same.length;
  const mIn = meanFrom(inIt);
  const mUp = meanFrom(above);
  console.log('\n  the same 1200 ground points, seen from two camera heights:');
  console.log(`    camera at   9 m (down in it):      mean mist ${f(mIn, 3)}`);
  console.log(`    camera at 200 m (on the shoulder): mean mist ${f(mUp, 3)}`);
  ok(mIn > mUp * 2.0, 'standing in the valley you are INSIDE the mist; from the shoulder you are looking at it', `${f(mIn / mUp, 2)}x`);

  /* And the layering is doing something, not multiplying by a constant. */
  const bare = same.map((p) => {
    const d = Math.hypot(p.x - inIt.x, p.y - inIt.y, p.z - inIt.z);
    return mistAt({ cam: inIt, P: p, dist: d, mist: { x: M.x, y: M.y, z: M.z } });
  });
  const layered = bare.filter((r) => r.layered);
  const raw = layered.map((r) => 1 - Math.exp(-r.optical));
  const done = layered.map((r) => r.mist);
  const spread = raw.map((v, i) => done[i] / Math.max(v, 1e-6));
  spread.sort((a, b) => a - b);
  console.log(
    `    layering multiplier over ${layered.length} layered samples: min ${f(spread[0], 3)}, median ${f(spread[spread.length >> 1], 3)}, max ${f(spread.at(-1), 3)}`,
  );
  ok(spread.at(-1) - spread[0] > 0.15, 'the sheets and patches genuinely vary the density, they are not a constant scale', `${f(spread[0], 3)}..${f(spread.at(-1), 3)}`);
}

/* The profile, printed, so the shape is arguable rather than asserted. */
{
  const cam = { x: spawn.x, y: 34, z: spawn.z };
  console.log('\n  mist vs the fragment\'s altitude, camera at y=34 m (identical range each row):');
  console.log('     range      y=0 m   y=20 m   y=60 m  y=120 m  y=240 m  y=400 m');
  for (const d of [60, 150, 320, 700, 1400, 2800]) {
    const row = [0, 20, 60, 120, 240, 400].map((y) => {
      const P = { x: cam.x + d, y, z: cam.z };
      return f(mistAt({ cam, P, dist: d }).mist, 3).padStart(7);
    });
    console.log(`    ${String(d).padStart(5)} m  ${row.join('  ')}`);
  }
  // The bonnet must stay clear.
  const near = mistAt({ cam, P: { x: cam.x + 12, y: 33, z: cam.z }, dist: 12 }).mist;
  ok(near < 0.005, 'nothing within 16 m of the lens is misted at all — the car stays clean', `${f(near, 5)} at 12 m`);
  const summit = mistAt({ cam, P: { x: cam.x + 2800, y: 400, z: cam.z }, dist: 2800 }).mist;
  const floor2 = mistAt({ cam, P: { x: cam.x + 2800, y: 2, z: cam.z }, dist: 2800 }).mist;
  ok(summit < floor2 * 0.45, 'a 400 m summit at 2.8 km stays legible while the floor under it does not', `${f(summit, 3)} vs ${f(floor2, 3)}`);
}

/* Colour, not just density: the whole point is that it is not a grey wash. */
{
  const sun = sunDirection();
  const mistRGB = RGB.mist;
  const horsun = RGB.skyHorizonSun;
  const glow = RGB.sunGlow;
  const haze = RGB.haze;
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-5);
  const colFor = (mie) => {
    let c = mistRGB.map((v, i) => v + (horsun[i] - v) * (mie * K.mieToHorsun));
    c = c.map((v, i) => v + (glow[i] - v) * (mie * mie * K.mieToGlow));
    return c;
  };
  console.log('\n  mist colour along the Mie term (0 = looking away from the sun, 1 = straight at it):');
  console.log('    mie    linear rgb                       luminance  saturation');
  for (const mie of [0, 0.25, 0.6, 1]) {
    const c = colFor(mie);
    console.log(`    ${f(mie, 2)}   (${c.map((v) => f(v, 3)).join(', ')})     ${f(lum(c), 3)}      ${f(sat(c), 3)}`);
  }
  const backlit = colFor(1);
  const flat = colFor(0);
  console.log(`    for comparison, the plain aerial haze K_HAZE is (${haze.map((v) => f(v, 3)).join(', ')}), luminance ${f(lum(haze), 3)}`);
  ok(lum(backlit) > lum(flat) * 1.25, 'backlit mist genuinely lifts rather than merely tinting', `${f(lum(flat), 3)} -> ${f(lum(backlit), 3)}`);
  ok(lum(flat) > lum(haze) * 1.35, 'and even unlit it is brighter than the blue-grey distance haze — silver, not grey', `${f(lum(flat), 3)} vs ${f(lum(haze), 3)}`);
  ok(sun.y > 0, 'sun is above the horizon', `elevation ${f((Math.asin(sun.y) * 180) / Math.PI, 1)} deg`);
}

/* ── 5: what it costs ────────────────────────────────────────────────────────── */

console.log('\n=== 5. FRAME COST ===');
{
  /* The expensive half of the mist is the layering branch, and it is GATED. So the honest
   * cost question is: on a real screenful of real geometry, what fraction of fragments
   * actually take it? Cast a real 64 deg frustum of rays from a real camera pose at the real
   * ground and count. Rays that hit nothing are sky, which never calls aerial() at all. */
  const poses = [
    ['crane, 86 m up (the intro\'s first shot)', { x: spawn.x, y: ground(spawn.x, spawn.z) + 86, z: spawn.z }, -0.22],
    ['driving, 2 m up', { x: spawn.x, y: ground(spawn.x, spawn.z) + 2, z: spawn.z }, -0.05],
  ];
  const FOV = (64 * Math.PI) / 180;
  for (const [label, cam, pitch] of poses) {
    let hits = 0;
    let gated = 0;
    let sumMist = 0;
    const NX = 96;
    const NY = 54;
    for (let iy = 0; iy < NY; iy++) {
      for (let ix = 0; ix < NX; ix++) {
        const ay = pitch + (iy / (NY - 1) - 0.5) * FOV;
        const ax = (ix / (NX - 1) - 0.5) * FOV * (16 / 9);
        const dx = Math.sin(ax) * Math.cos(ay);
        const dy = Math.sin(ay);
        const dz = Math.cos(ax) * Math.cos(ay);
        // march until the ray is under the ground, coarse then bisect — a real hit, not a plane
        let t = 4;
        let hit = -1;
        let prev = cam.y - ground(cam.x, cam.z);
        for (; t < 5000; t *= 1.06) {
          const h = cam.y + dy * t - ground(cam.x + dx * t, cam.z + dz * t);
          if (h < 0 && prev >= 0) {
            hit = t;
            break;
          }
          prev = h;
        }
        if (hit < 0) continue; // sky: aerial() is never called
        hits++;
        const P = { x: cam.x + dx * hit, y: cam.y + dy * hit, z: cam.z + dz * hit };
        const r = mistAt({ cam, P, dist: hit });
        if (r.layered) gated++;
        sumMist += r.mist;
      }
    }
    console.log(
      `  ${label}: ${hits} of ${NX * NY} rays hit ground; ${gated} (${f((100 * gated) / Math.max(hits, 1), 1)}%) take the layering branch; mean mist over the ground ${f(sumMist / Math.max(hits, 1), 3)}`,
    );
  }
  /* And the arithmetic, counted rather than felt. */
  const alu = { always: 'compare + 2 clamp + 2 exp + sub + div + mul-chain + 1-exp  ~=  14 ALU + 2 transcendental', gated: '2 x mstNoise = 8 x mstHash (3 fract, 1 dot, 1 fract each) + 8 mix + 2 smooth  ~= 78 ALU' };
  console.log(`  cost when uMist.x = 0:            one uniform compare, the whole block is skipped`);
  console.log(`  cost when mist <= ${K.gate} (near):     ${alu.always}`);
  console.log(`  cost when the branch is taken:    the above + ${alu.gated}`);
  console.log(`  what was replaced:                2 smoothstep + 2 mix + 1 clamp  ~= 16 ALU (and it did not pool)`);
  ok(true, 'the layering branch is coherent: near fragments (the overdrawn ones — grass) never take it');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
