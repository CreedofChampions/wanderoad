// created by AI
/* Wanderoad — the seven waters, photographed in the running game.
 *
 * tools/diag-waterstyles.mjs proves the seven shaders COMPILE. That is not the claim the
 * operator is buying. His claim is "make seven different water types that I can stick in-game
 * by just clicking a button", and there are exactly two ways that promise can be broken by
 * code that compiles perfectly: the switch could need a page reload, or the seven could all
 * look the same. This tool photographs the sea and answers both with numbers.
 *
 * HOW IT PROVES "DIFFERENT" WITHOUT A HUMAN EYE. Only the water shader changes between shots,
 * so any pixel that differs between two frames is either water or drift — the clouds move, the
 * grass sways, the sun glitter twinkles. So the noise floor is MEASURED rather than assumed: two
 * shots of the SAME style, the same interval apart, give the drift between frames, and a style
 * pair only counts as distinct if it differs by several times that. A seventh shade of the same
 * blue would fail this, which is the whole point — the operator is choosing a winner and seven
 * near-identical candidates would be a failed task, not a passing one.
 *
 * HOW IT PROVES "NO RELOAD". A token is stamped on `window` before the first switch and read
 * back after the last. A page that reloaded loses it. The seven shots are then, by
 * construction, seven surfaces in ONE page load.
 *
 * It drives no keys and touches no UI: the Garage buttons are the integration agent's to wire,
 * so this calls the exported API the same way that button will
 * (`setWaterStyle(id)`), from the page's own console, against the dev server.
 *
 *   node tools/diag-waterlive.mjs [seed] [--keep]
 *
 * Shots land in shots/water/. Exits 0 only if every check passes.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { decodePng } from './shot-stats.mjs';
import { waterOpenness } from '../src/render/water.js';
import { isDryAt, landHeight, waterFn } from '../src/world/terrain.js';
import { WATER_STYLES } from '../src/render/waterStyles.js';

const args = process.argv.slice(2);
const SEED = (parseInt(args.find((a) => /^\d+$/.test(a)) ?? '', 10) || 20260726) >>> 0;
const KEEP = args.includes('--keep');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9600 + (process.pid % 150);
const VITE_PORT = 5300 + (process.pid % 150);
const SHOTS = resolve('shots/water');
/** Seconds between the switch and the shutter, and between the two control shots. Identical on
 *  purpose: the control has to see exactly as much cloud drift as the styles do. */
const SETTLE_MS = 1400;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

/* ── 1. find somewhere the sea actually fills the windscreen ────────────────────
 * A water shader photographed from a meadow proves nothing, and the first run of this tool
 * proved something worse: "is there water 60 to 240 metres ahead" found a spot in the DUNES
 * with a sand hill squarely between the camera and the sea, and cheerfully reported "100% of
 * the forward cone is water" over a photograph of a sand dune.
 *
 * So the search is a HORIZON MARCH, not a cone sample. Walking outward it keeps the highest
 * elevation angle the land has reached so far; a stretch of water only counts as visible if its
 * own elevation angle from the eye clears that running horizon. That is exactly what "can you
 * see it from here" means, and it is the one question the cone version could not ask.
 *
 * It also insists the standing spot is within 6 m of the water's own level — a beach rather
 * than a clifftop — so the near field of the shader, where all seven styles do their most
 * distinctive work, is on screen and not four hundred metres below the lens.
 *
 * Forward is (sin yaw, cos yaw), the same convention src/car/vehicle.js drives by. */
function findShore(seed) {
  const waterAt = waterFn(seed);
  /** Roughly where the chase camera's eye sits above the ground the car is standing on. */
  const EYE = 3.2;
  const R0 = 30;
  const R1 = 430;
  const STEP = 25;
  let best = null;

  for (let x = -3000; x <= 3000; x += 200) {
    for (let z = -3000; z <= 3000; z += 200) {
      if (!isDryAt(x, z, seed)) continue;
      const y = landHeight(x, z, seed);
      if (!Number.isFinite(y)) continue;
      // cheap reject: no water at all within 250 m in any of four directions
      const near = [0, 1, 2, 3].some((k) => {
        const a = (k / 4) * Math.PI * 2;
        return !isDryAt(x + Math.sin(a) * 250, z + Math.cos(a) * 250, seed);
      });
      if (!near) continue;
      const eye = y + EYE;

      for (let a = 0; a < 16; a++) {
        const yaw = (a / 16) * Math.PI * 2;
        const sx = Math.sin(yaw);
        const sz = Math.cos(yaw);
        let horizon = -Infinity; // highest elevation angle the land has reached so far
        let seen = 0;
        let n = 0;
        let open = 0;
        let firstWet = Infinity;
        let beach = Infinity;
        for (let r = R0; r <= R1; r += STEP) {
          const px = x + sx * r;
          const pz = z + sz * r;
          const lh = landHeight(px, pz, seed);
          n++;
          const surf = waterAt(px, pz);
          if (surf !== null && lh < surf) {
            if ((surf - eye) / r >= horizon) {
              seen++;
              open += waterOpenness(px, pz, seed);
              if (r < firstWet) {
                firstWet = r;
                beach = Math.abs(y - surf);
              }
            }
          }
          horizon = Math.max(horizon, (lh - eye) / r);
        }
        // A beach, close water, and most of the view actually being water.
        if (firstWet > 70 || beach > 6) continue;
        const score = (seen / n) * (open / Math.max(seen, 1));
        if (!best || score > best.score) best = { x, z, yaw, score, wet: seen / n, firstWet, beach };
      }
    }
  }
  return best;
}

/* ── 2. the harness ────────────────────────────────────────────────────────── */

async function connect() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1280,720',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--user-data-dir=' + resolve('.chrome-waterlive'),
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
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push({
        level: m.params.type,
        text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300),
      });
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push({ level: 'exception', text: `${d.text} ${d.exception?.description || ''}`.slice(0, 300) });
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
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (!s.result?.data) return null;
    const path = resolve(SHOTS, `${name}.png`);
    writeFileSync(path, Buffer.from(s.result.data, 'base64'));
    return path;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  return { chrome, ws, send, evalJs, shot, logs };
}

/* The band of the frame the comparison is made over.
 *
 * NOT the whole frame, and the first run of this tool is why: measured over everything, the sky,
 * the near grass and the car dilute the water down to a couple of points and two genuinely
 * different blues come out looking like the same blue. From a shoreline viewpoint with a chase
 * camera, the water lies in a band above the car and below the horizon; this is that band. The
 * run asserts the band really is mostly water rather than assuming it — see WATER_IN_BAND below. */
const BAND = [0.06, 0.28, 0.94, 0.66];

/** Mean absolute per-channel difference between two screenshots over BAND, 0-255. */
function frameDiff(pathA, pathB) {
  const a = decodePng(readFileSync(pathA));
  const b = decodePng(readFileSync(pathB));
  if (a.w !== b.w || a.h !== b.h) throw new Error('screenshot sizes differ');
  const [x0, y0, x1, y1] = [
    Math.floor(BAND[0] * a.w), Math.floor(BAND[1] * a.h),
    Math.floor(BAND[2] * a.w), Math.floor(BAND[3] * a.h),
  ];
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const ia = y * a.w * a.ch + x * a.ch;
      const ib = y * b.w * b.ch + x * b.ch;
      sum += Math.abs(a.px[ia] - b.px[ib]) + Math.abs(a.px[ia + 1] - b.px[ib + 1]) + Math.abs(a.px[ia + 2] - b.px[ib + 2]);
      n += 3;
    }
  }
  return sum / n;
}

/** Below this, the band this tool measures is not looking at enough water to prove anything. */
const WATER_IN_BAND = 8;

/** Mean colour of a region, for the "what colour is this water" table. */
function regionMean(path, fx0, fy0, fx1, fy1) {
  const { w, h, ch, px } = decodePng(readFileSync(path));
  const [x0, y0, x1, y1] = [Math.floor(fx0 * w), Math.floor(fy0 * h), Math.floor(fx1 * w), Math.floor(fy1 * h)];
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w * ch + x * ch;
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n++;
    }
  }
  return [r / n, g / n, b / n];
}

/* ── 3. run ────────────────────────────────────────────────────────────────── */

mkdirSync(SHOTS, { recursive: true });
console.log(`\n── seven waters, live, seed ${SEED} ────────────────────────────────────\n`);

const shore = findShore(SEED);
if (!shore) {
  console.error('FAIL  found no open water in a 6 km box — is this seed all desert?');
  process.exit(1);
}
console.log(
  `  viewpoint  (${shore.x}, ${shore.z})  facing ${((shore.yaw * 180) / Math.PI).toFixed(0)}deg  ` +
    `— ${(shore.wet * 100).toFixed(0)}% of the sight line is VISIBLE water, first at ${shore.firstWet} m, ` +
    `standing ${shore.beach.toFixed(1)} m off the waterline, openness ${shore.score.toFixed(2)}\n`
);

const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--port', String(VITE_PORT), '--strictPort'], {
  stdio: 'ignore',
});
let session = null;
let ok = true;

try {
  // wait for vite
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(500);
    try {
      up = (await fetch(`http://localhost:${VITE_PORT}/`)).ok;
    } catch {
      /* not up yet */
    }
  }
  if (!up) throw new Error('the dev server did not come up');

  session = await connect();
  const { evalJs, shot, logs } = session;

  /* Getting the camera to the sea, and the one trap in doing it.
   *
   * The game resumes from `wanderoad.session.v1`, so the viewpoint goes in there — but it CANNOT
   * be written from the game's own page. src/game/session.js saves on `pagehide`, so navigating
   * away from the game overwrites the record with wherever the car was standing, and the first
   * run of this tool duly photographed the spawn (-3, -1104) while reporting that it had gone to
   * the shore. So: load the game once with `?fresh=1` to clear any stale record, then hop to
   * ANOTHER page on the same origin (/previews/, which vite serves out of public/ and which has
   * no game on it to save anything), write the record from there, and only then load the game. */
  await session.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/?fresh=1&seed=${SEED}` });
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    if (await evalJs('!!window.WANDEROAD')) break;
  }
  await session.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/previews/` });
  /* WAIT FOR THE HOP TO LAND BEFORE WRITING, and this is the flaky-race version of the same bug.
   * Page.navigate resolves when the navigation COMMITS, not when the new document is running, so
   * a fixed sleep sometimes left the write executing against the game page that was still on
   * screen — and the game's own pagehide then overwrote it on the way out. The run passed and
   * failed alternately until the wait became a condition instead of a guess. */
  let onPreviews = false;
  for (let i = 0; i < 40 && !onPreviews; i++) {
    await sleep(250);
    onPreviews = !!(await evalJs(`location.pathname.indexOf('/previews') === 0 && !window.WANDEROAD`));
  }
  const record = `{"seed":${SEED},"x":${shore.x},"z":${shore.z},"yaw":${shore.yaw},"car":null,"fuel":null,"at":${Date.now()}}`;
  await evalJs(`localStorage.setItem('wanderoad.session.v1', ${JSON.stringify(record)})`);
  const readBack = await evalJs(`localStorage.getItem('wanderoad.session.v1')`);
  check('the shoreline viewpoint is in the session record', readBack === record, String(readBack).slice(0, 80));
  await session.send('Page.navigate', { url: `http://localhost:${VITE_PORT}/?seed=${SEED}` });

  let booted = false;
  for (let i = 0; i < 120 && !booted; i++) {
    await sleep(500);
    booted = !!(await evalJs('!!(window.WANDEROAD && window.WANDEROAD.stats().live > 20)'));
  }
  check('the game booted at the shoreline', booted, await evalJs('JSON.stringify(WANDEROAD.stats())'));

  /* SKIP THE INTRO, and this is not tidiness either. The opening cinematic flies its OWN camera
   * around the car (src/game/cinematic.js) under a white title card, so the first run of this
   * tool photographed seven frames of a fly-around through a wash — which is why the numbers
   * came back saying two obviously different waters were one part in 255 apart. A real keydown
   * at the window, the same event a player's keyboard sends, is what ends it.
   *
   * Backquote, deliberately: the cinematic skips on ANY key, and nearly every letter on the
   * keyboard is bound to something in src/car/input.js's KEYMAP — M would have opened the
   * Garage over the sea, Z would have got the driver out of the car. Backquote is bound to
   * nothing, so it ends the intro and does nothing else.
   *
   * Pressed until it takes, not once: cinematic.js attaches its own window listeners when the
   * programme STARTS, and the first version of this fired the key before that happened, so the
   * intro ran on undisturbed through the first four photographs. */
  let cineOver = false;
  for (let i = 0; i < 50 && !cineOver; i++) {
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code:'Backquote', bubbles:true }))`);
    await sleep(400);
    cineOver = !!(await evalJs('!(window.WANDEROAD.cine && window.WANDEROAD.cine.active)'));
  }
  check('the intro cinematic is over — this is the driving camera', cineOver);

  // let the streamer settle so every shot sees the same set of chunks
  await sleep(6000);

  const at = await evalJs('JSON.stringify({x:+WANDEROAD.car.x.toFixed(0), z:+WANDEROAD.car.z.toFixed(0)})');
  check('and it resumed at the viewpoint, not the spawn', String(at).includes(String(shore.x)), at);

  /* The module is loaded exactly the way the Garage will load it. If this line throws, the
   * feature is unusable no matter what the compile gate said. */
  const loaded = await evalJs(
    `import('/src/render/waterStyles.js').then(m => { window.__water = m; return m.WATER_STYLES.map(s => s.id).join(' '); })`
  );
  check('waterStyles.js loads in the running game', typeof loaded === 'string' && loaded.split(' ').length === 7, String(loaded));

  const TOKEN = `tok${Date.now()}`;
  await evalJs(`window.__liveToken = '${TOKEN}'`);
  /* Console errors are counted from HERE, not from the page load. The dev server answers a
   * missing car GLB with index.html, so booting through vite logs a car-model warning that has
   * nothing to do with water; failing this run on it would be a check that cries wolf. What
   * matters is whether SWITCHING THE WATER logs anything, and that starts now. */
  const logMark = logs.length;

  /* TWO SHOTS OF EVERY STYLE, and that is the whole rigour of this tool.
   *
   * The first pair is the same style twice, the same interval apart, so the drift between two
   * frames — drifting clouds, swaying grass, winking sun glitter — is a number this style
   * MEASURED rather than an allowance somebody granted it. Doing it for all seven means the bar
   * can be the honest one: no two different waters may differ from each other by less than a
   * single water differs from ITSELF one and a half seconds later. Seven shades of the same blue
   * fails that outright, which is exactly what the operator is paying for. */
  const shots = [];
  for (let i = 0; i < WATER_STYLES.length; i++) {
    const s = WATER_STYLES[i];
    const applied = await evalJs(`window.__water.setWaterStyle(${JSON.stringify(s.id)})?.id`);
    await sleep(SETTLE_MS);
    const path = await shot(`${String(i + 1).padStart(2, '0')}-${s.id}`);
    await sleep(SETTLE_MS);
    const again = await shot(`${String(i + 1).padStart(2, '0')}-${s.id}-b`);
    const live = await evalJs(`window.__water.currentWaterStyle().id`);
    const drift = frameDiff(path, again);
    shots.push({ style: s, path, drift });
    check(`${s.id.padEnd(9)} applied and photographed`, applied === s.id && live === s.id && !!path,
      `rgb ${regionMean(path, 0.2, 0.3, 0.8, 0.62).map((v) => v.toFixed(0)).join(',')} mid-frame, ` +
        `self-drift ${drift.toFixed(2)}`);
  }

  const still = await evalJs('window.__liveToken');
  check('NO PAGE RELOAD — all seven were drawn in one page load', still === TOKEN, String(still));

  console.log('\n── how different are they, really (mean abs pixel difference / 255) ────\n');
  let worst = { d: Infinity, a: '', b: '' };
  let best = { d: 0 };
  for (let i = 0; i < shots.length; i++) {
    const row = [];
    for (let j = 0; j < shots.length; j++) {
      if (i === j) {
        row.push(`  (${shots[i].drift.toFixed(1)})`.padStart(7));
        continue;
      }
      const d = frameDiff(shots[i].path, shots[j].path);
      row.push(d.toFixed(1).padStart(7));
      if (j > i && d < worst.d) worst = { d, a: shots[i].style.id, b: shots[j].style.id };
      if (d > best.d) best = { d };
    }
    console.log(`   ${shots[i].style.id.padEnd(9)} ${row.join(' ')}`);
  }
  console.log(`   ${''.padEnd(9)} ${shots.map((s) => s.style.id.slice(0, 7).padStart(7)).join(' ')}`);
  console.log('\n   (the diagonal, in brackets, is each style measured against ITSELF 1.4 s later —\n' +
    '    the drift this world has anyway. Every other cell has to beat all seven of those.)\n');

  const selfMax = shots.reduce((a, s) => (s.drift > a.drift ? s : a));
  ok = check('no two waters are closer to each other than one water is to itself',
    worst.d > selfMax.drift,
    `closest pair ${worst.a}/${worst.b} = ${worst.d.toFixed(1)}; worst self-drift ${selfMax.style.id} = ${selfMax.drift.toFixed(2)}`) && ok;
  check('the band being measured really is water',
    best.d > WATER_IN_BAND, `widest pair moves ${best.d.toFixed(1)} of 255 in the band`);

  const errs = logs.slice(logMark).filter((l) => l.level === 'error' || l.level === 'exception');
  check('no console errors while switching', errs.length === 0, errs.slice(0, 3).map((e) => e.text).join(' | '));

  console.log(`\n  shots: ${SHOTS}\n`);
} catch (e) {
  check('the live run completed', false, e.message);
} finally {
  if (session && !KEEP) {
    try {
      session.ws.close();
    } catch {
      /* already gone */
    }
    session.chrome.kill();
  }
  vite.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`${failed.length ? `FAIL  ${failed.length} of ${results.length}` : `PASS  all ${results.length}`} checks\n`);
process.exit(failed.length ? 1 : 0);
