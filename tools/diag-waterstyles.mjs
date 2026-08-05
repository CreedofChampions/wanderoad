// created by AI
/* Wanderoad — the gate on the seven water surfaces.
 *
 * THE REASON THIS RUNS A REAL BROWSER. A GLSL reserved word (`patch`) once turned this whole
 * game black while passing every static check its author ran, and the lesson written into
 * tools/diag-watershader.mjs was that a static scan "is NOT that gate and does not pretend to
 * be — it cannot link a program and it cannot catch a type error". src/render/waterStyles.js
 * adds six more complete fragment shaders and one more vertex shader, none of which any
 * existing check touches, and none of which is even reachable from src/main.js yet (the
 * integration agent owns that file), so `npm run build` would happily bundle a build with six
 * broken shaders in it and say nothing.
 *
 * So this tool does what the scar demands: it compiles and LINKS all seven programs on a real
 * GPU, through the exact same '#version 300 es' + source that three.js hands the driver for a
 * RawShaderMaterial with glslVersion GLSL3 (WebGLProgram: for a raw material the whole prefix
 * is the version string and nothing else). A style that fails here is invisible water and no
 * error message anyone will ever see.
 *
 * It also prints the per-fragment noise budget of each style, because "do not tank the frame
 * budget" has to be a number: the game streams a 7 km view distance and water is a full-screen
 * sheet whenever the camera looks out over a bay.
 *
 *   node tools/diag-waterstyles.mjs            compile + link all seven on a real GPU
 *   node tools/diag-waterstyles.mjs --no-gpu   static scan only (for a machine with no Chrome)
 *
 * Exits 0 only if every style passes.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { waterFragShader } from '../src/render/water.js';
import {
  WATER_STYLES,
  WATER_STYLE_DEFAULT,
  currentWaterStyle,
  setWaterStyle,
  applyWaterStyle,
} from '../src/render/waterStyles.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const NO_GPU = process.argv.includes('--no-gpu');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + (process.pid % 200);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

/* ── 1. build every style's two shader sources ─────────────────────────────── */

const built = WATER_STYLES.map((s) => ({ style: s, src: s.build(SEED) }));

/* The shared prefix — fragHead() with an empty body — so the per-style BODY can be isolated
 * from the ~40 KB of hash/noise/sky/cloud/shadow/light library every water shader carries.
 * Counting noise calls across the library would report the same number for all seven. */
const SHARED_PREFIX = waterFragShader('');
const bodyOf = (fs) => (fs.startsWith(SHARED_PREFIX) ? fs.slice(SHARED_PREFIX.length) : fs);
/* Comments stripped for every scan below, for the reason diag-watershader.mjs states: a
 * shader's comments NAME the identifiers they explain, so scanning them reports every
 * well-commented variable as a failure — a check that punishes the thing it encourages. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/* GLSL ES 3.00 keywords and reserved keywords (spec 3.6), minus the ones a shader legitimately
 * uses. Anything here appearing as a DECLARED identifier is the `patch` bug again. */
const RESERVED = [
  'attribute', 'varying', 'common', 'partition', 'active', 'asm', 'class', 'union', 'enum',
  'typedef', 'template', 'this', 'goto', 'inline', 'noinline', 'volatile', 'public', 'static',
  'extern', 'external', 'interface', 'long', 'short', 'double', 'half', 'fixed', 'unsigned',
  'superp', 'input', 'output', 'hvec2', 'hvec3', 'hvec4', 'fvec2', 'fvec3', 'fvec4',
  'sampler3DRect', 'filter', 'image1D', 'image2D', 'image3D', 'imageCube', 'sizeof', 'cast',
  'namespace', 'using', 'patch', 'sample', 'subroutine', 'resource', 'noperspective',
  'coherent', 'restrict', 'readonly', 'writeonly', 'atomic_uint', 'row_major',
];
const DECL = /\b(?:float|int|uint|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4|void|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

console.log(`\n── seven water styles, seed ${SEED} ────────────────────────────────────\n`);

let allStatic = true;
const table = [];
for (const { style, src } of built) {
  const body = strip(bodyOf(src.fragmentShader));
  const vbody = strip(src.vertexShader);
  const both = body + '\n' + vbody;

  // reserved words, as DECLARED identifiers
  const bad = new Set();
  for (const m of both.matchAll(DECL)) if (RESERVED.includes(m[1])) bad.add(m[1]);
  // ...and as a declared FUNCTION name, which the pattern above already covers, plus as a
  // parameter name, which it does not.
  for (const m of both.matchAll(/\(([^)]*)\)\s*\{/g)) {
    for (const p of m[1].split(',')) {
      const nm = p.trim().split(/\s+/).pop();
      if (nm && RESERVED.includes(nm)) bad.add(nm);
    }
  }
  const okReserved = bad.size === 0;

  // brace and paren balance, on both stages
  const count = (s, ch) => (s.match(new RegExp(`\\${ch}`, 'g')) || []).length;
  const okBraces = count(both, '{') === count(both, '}') && count(both, '(') === count(both, ')');

  /* The contract every style owes the rest of the renderer. Each of these is a scar and the
   * long-form reason for each is in the header of src/render/waterStyles.js. */
  const okDiscard = /discard/.test(body) && /vD\.x\s*>\s*-0\.5/.test(body);
  const okAerial = /aerial\s*\(/.test(body);
  const okAlpha = /fragColor\s*=\s*vec4\(\s*SAFE3\(/.test(body) && /gFogAmt/.test(body);
  // the moire fix: SOMETHING must fade the high-frequency terms out with distance
  const okFar = /farFlat|nearW/.test(body);
  // the analytic mip gate on noise
  const okBand = /bandGate|bandLimit/.test(body);

  // per-fragment noise budget — the frame-cost proxy. Static call sites; there are no loops.
  const calls = (re) => (body.match(re) || []).length;
  const noise = calls(/\bpn2\s*\(/g) + calls(/\bpn3\s*\(/g) + calls(/\bfbm2\s*\(/g) * 3;
  const sky = calls(/\bskyDomeLite\s*\(/g) + calls(/\bskyDome\s*\(/g);

  const ok = okReserved && okBraces && okDiscard && okAerial && okAlpha && okFar && okBand;
  allStatic = check(`${style.id.padEnd(9)} static scan`, ok,
    ok
      ? `${noise} noise taps, ${sky} sky, ${(src.fragmentShader.length / 1024).toFixed(1)} kB`
      : [
          okReserved ? '' : `reserved word(s): ${[...bad].join(', ')}`,
          okBraces ? '' : 'unbalanced braces/parens',
          okDiscard ? '' : 'missing the dry-bed discard',
          okAerial ? '' : 'missing aerial()',
          okAlpha ? '' : 'missing SAFE3/gFogAmt alpha contract',
          okFar ? '' : 'no far-field gate (the moire fix)',
          okBand ? '' : 'no band gate on its noise',
        ].filter(Boolean).join('; ')) && allStatic;

  table.push({ id: style.id, label: style.label, noise, sky, kb: src.fragmentShader.length / 1024 });
}

/* ── 2. the exported API behaves ────────────────────────────────────────────── */

console.log('');
check('seven styles, no duplicate ids', WATER_STYLES.length === 7 &&
  new Set(WATER_STYLES.map((s) => s.id)).size === 7, WATER_STYLES.map((s) => s.id).join(' '));
check('the shipped water is one of them', WATER_STYLES.some((s) => s.id === WATER_STYLE_DEFAULT),
  `default = ${WATER_STYLE_DEFAULT}`);
check('every style carries apply()', WATER_STYLES.every((s) => typeof s.apply === 'function'));

/* A stand-in for the one real water material. It only has to look enough like one for
 * applyWaterStyle to work on it, which is the point: the switch touches two strings and a
 * flag, and nothing about it needs a GPU or a scene. */
const fake = { isMaterial: true, userData: { waterSeed: SEED }, vertexShader: '', fragmentShader: '', needsUpdate: false };
const first = applyWaterStyle(fake, WATER_STYLES[0]);
check('applyWaterStyle swaps the shader and asks for a recompile',
  first === 1 && fake.needsUpdate === true && fake.fragmentShader.length > 1000,
  `${(fake.fragmentShader.length / 1024).toFixed(1)} kB on the material`);
fake.needsUpdate = false;
check('re-applying the same style is a no-op (no needless recompile)',
  applyWaterStyle(fake, WATER_STYLES[0]) === 0 && fake.needsUpdate === false);

let switched = true;
for (const s of WATER_STYLES.slice(1)) {
  const before = fake.fragmentShader;
  applyWaterStyle(fake, s);
  if (fake.fragmentShader === before || fake.userData.waterStyle !== s.id) switched = false;
}
check('every style produces a genuinely different shader', switched);

check('setWaterStyle takes an id', setWaterStyle('abyss')?.id === 'abyss' && currentWaterStyle().id === 'abyss');
check('setWaterStyle takes an index', setWaterStyle(3)?.id === WATER_STYLES[3].id);
check('setWaterStyle rejects a name that is not a style', setWaterStyle('lava') === null);
setWaterStyle(WATER_STYLE_DEFAULT);

/* ── 3. the real gate: compile and LINK all seven on a GPU ──────────────────── */

async function gpuCompile() {
  /* Exactly what three.js hands the driver for a RawShaderMaterial with glslVersion GLSL3:
   * for a raw material the whole prefix is the version string (WebGLProgram skips the entire
   * built-in define block, which is what `isRawShaderMaterial !== true` guards). */
  const payload = built.map(({ style, src }) => ({
    id: style.id,
    vs: '#version 300 es\n' + src.vertexShader,
    fs: '#version 300 es\n' + src.fragmentShader,
  }));

  const dir = mkdtempSync(join(tmpdir(), 'wanderoad-water-'));
  const page = join(dir, 'compile.html');
  writeFileSync(
    page,
    `<!doctype html><meta charset="utf-8"><canvas id="c" width="16" height="16"></canvas>
<script id="payload" type="application/json">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
<script>
window.__result = null;
(function(){
  var gl = document.getElementById('c').getContext('webgl2', { antialias:false });
  if(!gl){ window.__result = { fatal:'no webgl2 context' }; return; }
  var jobs = JSON.parse(document.getElementById('payload').textContent);
  var out = [];
  for (var i=0;i<jobs.length;i++){
    var j = jobs[i], err = '';
    var vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, j.vs); gl.compileShader(vs);
    if(!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) err = 'vertex: ' + gl.getShaderInfoLog(vs);
    var fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, j.fs); gl.compileShader(fs);
    if(!err && !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) err = 'fragment: ' + gl.getShaderInfoLog(fs);
    if(!err){
      var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      if(!gl.getProgramParameter(p, gl.LINK_STATUS)) err = 'link: ' + gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    out.push({ id: j.id, ok: !err, err: (err||'').trim().slice(0, 400) });
  }
  window.__result = { renderer: (function(){ var d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })(), styles: out };
})();
<\/script>`
  );

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--window-size=400,300',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--allow-file-access-from-files',
      '--user-data-dir=' + resolve('.chrome-water'),
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let i = 0; i < 90 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      /* not up yet */
    }
  }
  if (!target) {
    chrome.kill();
    throw new Error(`headless chrome did not start (CHROME_PATH=${CHROME})`);
  }

  const ws = await new Promise((res, rej) => {
    const s = new WebSocket(target.webSocketDebuggerUrl);
    s.onopen = () => res(s);
    s.onerror = () => rej(new Error('cdp websocket failed'));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: pathToFileURL(page).href });

  let out = null;
  for (let i = 0; i < 80 && !out; i++) {
    await sleep(250);
    out = await evalJs('window.__result');
  }
  try {
    ws.close();
  } catch {
    /* already gone */
  }
  chrome.kill();
  return out;
}

let gpuOk = true;
if (NO_GPU) {
  console.log('\n(--no-gpu: skipping the real compile. The static scan above is NOT a gate.)');
} else {
  console.log('\n── compiling and linking all seven on a real GPU ───────────────────────\n');
  try {
    const out = await gpuCompile();
    if (!out) throw new Error('the compile page never reported a result');
    if (out.fatal) throw new Error(out.fatal);
    console.log(`  renderer: ${out.renderer}\n`);
    for (const s of out.styles) gpuOk = check(`${s.id.padEnd(9)} compiles + links`, s.ok, s.err) && gpuOk;
    gpuOk = check('all seven programs linked', out.styles.length === 7 && out.styles.every((s) => s.ok)) && gpuOk;
  } catch (e) {
    gpuOk = check('real GPU compile', false, e.message);
  }
}

/* ── 4. the budget table ────────────────────────────────────────────────────── */

console.log('\n── per-fragment noise budget (static call sites in the style body) ─────\n');
console.log('   style      label            noise taps   sky   shader');
for (const r of table) {
  console.log(
    `   ${r.id.padEnd(10)} ${r.label.padEnd(16)} ${String(r.noise).padStart(10)} ${String(r.sky).padStart(5)}   ${r.kb.toFixed(1)} kB`
  );
}
console.log(
  '\n   `painted` is the shipped surface and therefore the budget every other style is\n' +
  '   measured against: no style here may cost more per fragment than the water the game\n' +
  '   already ships, because the game already runs at 7 km of view distance with it.\n'
);

const painted = table.find((r) => r.id === 'painted');
const worst = table.reduce((a, b) => (b.noise > a.noise ? b : a));
check('no style costs more noise per fragment than the shipped one',
  worst.noise <= painted.noise, `worst = ${worst.id} at ${worst.noise} vs painted ${painted.noise}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `FAIL  ${failed.length} of ${results.length}` : `PASS  all ${results.length}`} checks\n`);
process.exit(failed.length ? 1 : 0);
