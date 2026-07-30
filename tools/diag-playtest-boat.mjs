/* Wanderoad — the boat + loot PLAYTEST, played for real in a headless browser.
 *
 * docs/BOAT-PLAN.md ships with its own "Acceptance (playtest script)" — six numbered things a
 * person is supposed to sit down and do. This file does them, in a real headless Chrome over
 * the DevTools protocol, with a hand on the keyboard (genuine KeyboardEvents, never a call
 * into the car) and a screenshot at every step, because the questions being asked here — "is
 * it readable", "does it feel good", "are the scribbles actually visible" — cannot be answered
 * by a unit test and are not answered by tools/bench-boat.mjs, which never draws a pixel.
 *
 * House pattern throughout, taken from tools/browser-test.mjs and tools/shoot.mjs:
 *   - VISIBILITY IS MEASURED (getComputedStyle + a bounding box), never inferred from a flag.
 *   - INPUT IS REAL: every drive below is WASD dispatched at the window.
 *   - THE PICTURE IS EVIDENCE: a PNG per step under shots/test/boat-playtest/.
 *
 *   node tools/diag-playtest-boat.mjs [url] [--only road|barrier|voyage|foam|perf] [--keep]
 *
 * `?intro=off` is on every gameplay URL: the cinematic is the game's idle state and ANY input
 * ends it (src/game/cinematic.js's own note), so a driving test would end it on frame one
 * anyway — turning it off just stops a title-card frame landing in a screenshot.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { findFixture } from './diag-playtest-fixtures.mjs';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = process.argv.slice(2);
const BASE = args.find((a) => a.startsWith('http')) || 'http://localhost:5174/';
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const ONLY = opt('only', 'all');
const SHOTS = resolve('shots/test/boat-playtest');
const PORT = 9500 + (process.pid % 300);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};
const note = (...a) => console.log('      ·', ...a);

/* ── CDP plumbing (browser-test.mjs's own connect(), unchanged in shape) ──── */

async function connect(tag) {
  mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1400,820',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      /* Per-process profile so two scenarios can be played at once — one Chrome per profile
       * directory is a hard rule, and these runs are minutes long. `.chrome-*` is gitignored. */
      '--user-data-dir=' + resolve(`.chrome-playtest-${process.pid}`),
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
    throw new Error('headless chrome did not start');
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
      logs.push({ level: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
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
  /* GUARDED: a page-eval throw used to come straight back as a `{__error}` sentinel that
   * nothing downstream ever checked for — a caller expecting a number or a `.samples` array
   * got a strange object instead, and the first property/method access on it threw a TypeError
   * three call-frames away from the actual problem (measured: this crashed the whole run about
   * 1 in 3 boots). Most of these are the same kind of race placeCar()'s own 1500 ms wait
   * already treats as ordinary (the page hasn't caught up with a navigate or a terrain-sampler
   * rebuild yet), so one retry after the same beat clears almost all of them. If it is still
   * broken after that, it is a real failure, not a race — record it as its own failed check,
   * with the actual error text, right here at the point it happened, then throw a normal Error
   * so the caller's own `await` rejects cleanly instead of quietly being handed an object nothing
   * was ever written to expect. */
  const evalJs = async (expr) => {
    const attempt = async () => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text + ' ' + (r.result.exceptionDetails.exception?.description || '') };
      return r.result?.result?.value;
    };
    let out = await attempt();
    if (out && typeof out === 'object' && '__error' in out) {
      await sleep(1500);
      out = await attempt();
    }
    if (out && typeof out === 'object' && '__error' in out) {
      check('page eval', false, out.__error);
      throw new Error(out.__error);
    }
    return out;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (!s.result?.data) return null;
    const path = resolve(SHOTS, `${name}.png`);
    writeFileSync(path, Buffer.from(s.result.data, 'base64'));
    console.log(`      shot  ${path}`);
    return path;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { chrome, ws, send, evalJs, shot, logs, tag };
}

/** Boot the page at `url`, optionally wiping the profile first, and wait for the game.
 *
 * THE SENTINEL, which this file has already paid for once: a navigate or a reload does not
 * tear the old page down synchronously, so a poll for `window.WANDEROAD` issued straight
 * afterwards answers about the PREVIOUS document and returns true instantly — and everything
 * installed on the strength of that answer lands in a context that is about to be thrown away
 * (the first run of this file measured a car that never moved for exactly that reason). So a
 * flag is planted on the doomed document first, and the wait is for a page that has the game
 * AND does not have the flag. */
async function boot(S, url, { fresh = false } = {}) {
  await navigateFresh(S, url);
  if (fresh) {
    await S.evalJs(`localStorage.clear(), sessionStorage.clear(), 'cleared'`);
    await navigateFresh(S, url);
  }
  for (let i = 0; i < 5; i++) {
    const inst = await S.evalJs(INSTRUMENT);
    if (inst === 'probing' || inst === 'already') break;
    console.log(`      ! instrument said ${JSON.stringify(inst)} — retrying`);
    await sleep(1000);
  }
  await sleep(1200); // let the streamer settle before anything is measured
}

async function navigateFresh(S, url) {
  await S.evalJs(`window.__stale = 1`);
  await S.send('Page.navigate', { url });
  await waitForGame(S, 90);
}

async function waitForGame(S, secs) {
  for (let i = 0; i < secs * 4; i++) {
    const ok = await S.evalJs(`!!(window.WANDEROAD && window.WANDEROAD.car) && !window.__stale`);
    if (ok === true) return true;
    await sleep(250);
  }
  throw new Error('game never came up');
}

/* ── in-page instrumentation ──────────────────────────────────────────────────
 * One rAF loop that watches what a player would notice: where the car is, whether it jumped
 * (a rescue teleport is a discontinuity — nothing else in this game moves the car 3 m in a
 * frame at road speed), what the toast said, and the running fps. Everything it records is
 * read back by value; the reset hook lives on a separate global so the record itself stays
 * JSON-serialisable. */
const INSTRUMENT = `(() => {
  const W = window.WANDEROAD;
  if (!W) return 'no game';
  if (W._probe) return 'already';
  const P = { frames: 0, maxJump: 0, jumps: [], toasts: [], samples: [], nan: 0, t0: performance.now() };
  W._probe = P;
  /* Water depth the way src/game/rescue.js's own waterDepth() computes it — the module is
   * pulled in live off the dev server rather than reimplemented here, so "how deep is the car"
   * cannot drift from the number the game's own gates are reading. */
  window._wl = null;
  import('/src/world/biomes.js').then((m) => { window._wl = m.waterLevelAt; });
  const depthAt = (x, z) => {
    try {
      const t = W.car.terrain; if (!t || !window._wl) return null;
      const s = t.surface(x, z);
      const wy = window._wl(s.w, s.y);
      return wy === null ? 0 : wy - s.y;
    } catch { return null; }
  };
  window._depthAt = depthAt;
  const toastEl = document.getElementById('toast');
  let lastX = W.car.x, lastZ = W.car.z, lastToast = '', lastSample = -1;
  window._probeMark = (label) => {
    lastX = W.car.x; lastZ = W.car.z;
    P.maxJump = 0; P.jumps.length = 0; P.toasts.length = 0; P.samples.length = 0;
    P.t0 = performance.now(); P.mark = label || '';
    /* lastSample is on the SAME clock as P.t0, so resetting one without the other silently
     * suspends sampling for however long the previous stretch ran (measured: the first mark
     * cost this file its first seven seconds of depth samples). */
    lastSample = -1;
    return 'marked';
  };
  const tick = () => {
    requestAnimationFrame(tick);
    const c = W.car; P.frames++;
    const now = (performance.now() - P.t0) / 1000;
    if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z) || !isFinite(c.kph)) P.nan++;
    const d = Math.hypot(c.x - lastX, c.z - lastZ);
    if (d > P.maxJump) P.maxJump = d;
    if (d > 3) P.jumps.push({ t: +now.toFixed(2), d: +d.toFixed(1),
      from: [Math.round(lastX), Math.round(lastZ)], to: [Math.round(c.x), Math.round(c.z)], kph: Math.round(c.kph) });
    lastX = c.x; lastZ = c.z;
    const shown = toastEl && toastEl.classList.contains('show') ? (toastEl.textContent || '') : '';
    if (shown && shown !== lastToast) P.toasts.push({ t: +now.toFixed(2), text: shown });
    lastToast = shown;
    if (now - lastSample >= 0.2) {
      lastSample = now;
      P.samples.push({ t: +now.toFixed(2), x: +c.x.toFixed(1), y: +c.y.toFixed(2), z: +c.z.toFixed(1),
        kph: +c.kph.toFixed(1), yaw: +c.yaw.toFixed(3),
        boat: !!(W.boatMode && W.boatMode.active), roll: W.boatMode ? +W.boatMode.roll.toFixed(3) : 0,
        suns: W.wallet.suns, gems: W.wallet.gems, fps: +W.fps().toFixed(1),
        depth: (() => { const d = depthAt(c.x, c.z); return d === null ? null : +d.toFixed(2); })(),
        vis: !!(W.boatMesh && W.boatMesh.visible), carVis: !!(W.model && W.model.group.visible) });
      if (P.samples.length > 3000) P.samples.splice(0, 1000);
    }
  };
  requestAnimationFrame(tick);

  /* A hand on the keyboard, held between calls — src/car/input.js reads real key events and
   * nothing else, so this is the only honest way to drive from here. */
  const held = new Set();
  window._keys = (want) => {
    const w = new Set(want || []);
    for (const c of [...held]) if (!w.has(c)) { held.delete(c); window.dispatchEvent(new KeyboardEvent('keyup', { code: c, bubbles: true, cancelable: true })); }
    for (const c of w) if (!held.has(c)) { held.add(c); window.dispatchEvent(new KeyboardEvent('keydown', { code: c, bubbles: true, cancelable: true })); }
    return [...held];
  };
  window._tap = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true })), 60);
    return code;
  };
  return 'probing';
})()`;

const probe = (S) => S.evalJs(`(() => { const P = window.WANDEROAD._probe;
  return { frames: P.frames, maxJump: +P.maxJump.toFixed(2), jumps: P.jumps.slice(0, 8),
           toasts: P.toasts.slice(0, 30), nan: P.nan, samples: P.samples.slice() }; })()`);
const mark = (S, label) => S.evalJs(`window._probeMark(${JSON.stringify(label)})`);
const keys = (S, list) => S.evalJs(`window._keys(${JSON.stringify(list)})`);
const state = (S) => S.evalJs(`(() => { const W = window.WANDEROAD, c = W.car;
  return { x: +c.x.toFixed(1), y: +c.y.toFixed(2), z: +c.z.toFixed(1), kph: +c.kph.toFixed(1),
    boat: W.boatMode.active, boatMeshVisible: W.boatMesh.visible, carVisible: W.model.group.visible,
    boatUnlocked: W.wallet.boatUnlocked, suns: W.wallet.suns, gems: W.wallet.gems,
    lootStats: { ...W.loot.stats }, fps: +W.fps().toFixed(1),
    finite: [c.x, c.y, c.z, c.kph, c.yaw].every(Number.isFinite) }; })()`);

/** Teleport the car to a fixture and let the world catch up — SETUP, and always marked as such
 *  in the probe so it can never be mistaken for a rescue teleport by the checks below. */
async function placeCar(S, x, z, heading) {
  await S.evalJs(`(() => { const c = window.WANDEROAD.car; c.x = ${x}; c.z = ${z}; c.vx = 0; c.vz = 0; c.speed = 0; return 'moved'; })()`);
  await sleep(1500); // main.js rebuilds its 420 m local sampler as the car leaves the old box
  await S.evalJs(`(() => { const c = window.WANDEROAD.car; c.placeAt(${x}, ${z}, ${heading}); return 'placed'; })()`);
  await sleep(2500); // chunks stream in
}

/* The autopilot from tools/shoot.mjs, unchanged in substance: a Stanley controller pressing
 * WASD. It is the only way to get 90 s of ordinary road driving without a person. */
const AUTOPILOT = (seconds) => `(function(seconds){
  const W = window.WANDEROAD, car = W.car;
  const held = new Set();
  const key = (code, down) => { if (down === held.has(code)) return;
    down ? held.add(code) : held.delete(code);
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })); };
  const log = { t0: performance.now(), done: false, offRoad: 0, samples: 0 };
  W._auto = log;
  const tick = () => {
    if (performance.now() - log.t0 > seconds * 1000) { for (const c of [...held]) key(c, false); log.done = true; return; }
    requestAnimationFrame(tick);
    const terr = car.terrain; if (!terr) return;
    const near = terr.roads.query(car.x, car.z);
    if (!isFinite(near.d)) { key('KeyA', false); key('KeyD', false); key('KeyW', car.speed < 14); key('KeyS', false);
      log.samples++; log.offRoad++; return; }
    let tx = near.tx, tz = near.tz;
    if (Math.sin(car.yaw) * tx + Math.cos(car.yaw) * tz < 0) { tx = -tx; tz = -tz; }
    const ox = car.x - near.qx, oz = car.z - near.qz;
    const lateral = ox * tz - oz * tx;
    let err = Math.atan2(tx, tz) - car.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    const v = Math.max(Math.abs(car.speed), 6);
    let steer = (err + Math.atan2(1.9 * lateral, v)) * 2.4;
    steer = Math.max(-1, Math.min(1, steer));
    if (near.d > near.width * 0.5) log.offRoad++;
    const ax = car.x + Math.sin(car.yaw) * 40, az = car.z + Math.cos(car.yaw) * 40;
    const ahead = terr.roads.query(ax, az);
    let bend = 0;
    if (isFinite(ahead.d)) { let atx = ahead.tx, atz = ahead.tz;
      if (atx * tx + atz * tz < 0) { atx = -atx; atz = -atz; }
      bend = Math.abs(Math.atan2(atx, atz) - Math.atan2(tx, tz));
      while (bend > Math.PI) bend -= Math.PI * 2; bend = Math.abs(bend); }
    log.samples++;
    key('KeyA', steer > 0.08); key('KeyD', steer < -0.08);
    const target = bend > 0.55 ? 16 : bend > 0.28 ? 24 : bend > 0.12 ? 33 : 44;
    key('KeyW', car.speed < target); key('KeyS', car.speed > target + 6);
  };
  requestAnimationFrame(tick);
  return 'driving';
})(${seconds})`;

/** Steer at a world point with real keys for `ms`, the way a player chasing a shiny does.
 *
 * WITH HYSTERESIS, which this file has already paid for once: a bang-bang controller with a
 * 0.05 rad deadband and a 14 m turn circle (src/game/boat.js's own BOAT_TURN_RADIUS) does not
 * steer, it weaves — measured, it made 171 m of progress in 60 s of a 9.4 m/s boat, and then
 * orbited the destination at 8 m without ever arriving. Engage at 0.18 rad, release at 0.05,
 * and when the target is close, hold whatever heading is already good enough. */
const CHASE = (tx, tz, ms, opts = {}) => `(() => new Promise((done) => {
  const W = window.WANDEROAD, c = W.car;
  const send = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
  const held = new Set();
  const set = (code, want) => { if (want && !held.has(code)) { held.add(code); send(code, 'keydown'); }
    else if (!want && held.has(code)) { held.delete(code); send(code, 'keyup'); } };
  const t0 = performance.now();
  let best = Infinity, steer = 0, exited = false, entered = false;
  const id = setInterval(() => {
    const dx = ${tx} - c.x, dz = ${tz} - c.z;
    const dist = Math.hypot(dx, dz);
    if (dist < best) best = dist;
    if (W.boatMode.active) entered = true; else if (entered) exited = true;
    let err = Math.atan2(dx, dz) - c.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;
    if (steer === 0) { if (err > 0.18) steer = 1; else if (err < -0.18) steer = -1; }
    else if (Math.abs(err) < 0.05) steer = 0;
    else steer = err > 0 ? 1 : -1;
    set('KeyA', steer > 0); set('KeyD', steer < 0); set('KeyS', false);
    set('KeyW', true); // way on is what makes a boat steer at all — turnFactor scales with speed
    const stop = ${opts.stop ?? 4};
    if (performance.now() - t0 > ${ms} || dist < stop || (${!!opts.untilAshore} && exited)) {
      clearInterval(id);
      for (const k of [...held]) set(k, false);
      done({ dist: +dist.toFixed(1), closest: +best.toFixed(1), secs: +((performance.now() - t0) / 1000).toFixed(1), exited });
    }
  }, 50);
}))()`;

/** Read the frame back and describe it — "are there white scribbles on that water" needs
 *  numbers as well as a picture. Needs ?probe (preserveDrawingBuffer) on the URL. */
const PIXELS = (x0, y0, w, h) => `(() => {
  const cv = document.querySelector('#app canvas');
  const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
  const g = c2.getContext('2d'); g.drawImage(cv, 0, 0);
  const X = Math.round(${x0} * cv.width), Y = Math.round(${y0} * cv.height);
  const Wd = Math.round(${w} * cv.width), Ht = Math.round(${h} * cv.height);
  const d = g.getImageData(X, Y, Wd, Ht).data;
  let n = 0, sr = 0, sg = 0, sb = 0, lum = [];
  for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i+1]; sb += d[i+2];
    lum.push(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]); n++; }
  const mean = lum.reduce((a,b)=>a+b,0)/n;
  let sd = 0; for (const l of lum) sd += (l-mean)*(l-mean); sd = Math.sqrt(sd/n);
  let bright = 0, veryBright = 0, pale = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
    if (l > mean + 18) bright++;
    if (l > mean + 40) veryBright++;
    const mx = Math.max(d[i], d[i+1], d[i+2]), mn = Math.min(d[i], d[i+1], d[i+2]);
    if (l > 175 && mx - mn < 42) pale++;
  }
  return { px: n, meanRGB: [Math.round(sr/n), Math.round(sg/n), Math.round(sb/n)],
    meanLum: +mean.toFixed(1), sd: +sd.toFixed(1),
    brightFrac: +(bright/n).toFixed(4), veryBrightFrac: +(veryBright/n).toFixed(4),
    paleFrac: +(pale/n).toFixed(4) };
})()`;

/** Measure the loot counter the way browser-test.mjs measures everything: a real box and a
 *  real computed style. Taken MID-DRIVE, because the HUD is not up at rest — the first run of
 *  this file read a 0x0 box at boot and called the widget missing when it is simply not shown
 *  until the player is playing. Elements with a zero box are excluded from the overlap test
 *  for the same reason: an empty #players is display:none, and "overlaps something that is not
 *  on screen" is not a finding. */
async function readWidget(S) {
  return S.evalJs(`(() => { const el = document.getElementById('lootCounter');
    if (!el) return { present: false };
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const live = (q) => q.width > 0 && q.height > 0;
    const others = ['players','speedo','fuelGauge','streak','place','toast','openMenu','musicPanel'].map(id => {
      const o = document.getElementById(id); if (!o) return null;
      const q = o.getBoundingClientRect(); if (!live(q)) return null;
      return { id, overlap: !(q.right <= r.left || q.left >= r.right || q.bottom <= r.top || q.top >= r.bottom) }; }).filter(Boolean);
    return { present: true, text: el.textContent.trim(),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      display: cs.display, opacity: cs.opacity,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden' && live(r) && +cs.opacity > 0.05,
      overlaps: others.filter(o => o.overlap).map(o => o.id), vw: innerWidth, vh: innerHeight }; })()`);
}

/* ── smoke: does the hand on the keyboard actually reach the car? ──────────
 * Kept because the first run of this file measured a car that never moved, and "the game is
 * broken" and "the harness never pressed anything" look identical from the outside. */
async function testSmoke(S) {
  console.log('\n── 0. smoke: keys reach the car ───────────────────────────────────');
  await boot(S, `${BASE}?intro=off`, { fresh: true });
  note(`probe present: ${JSON.stringify(await S.evalJs(`!!window.WANDEROAD._probe`))}, _keys: ${JSON.stringify(await S.evalJs(`typeof window._keys`))}`);
  note(`before: ${JSON.stringify(await state(S))}`);
  note(`press: ${JSON.stringify(await keys(S, ['KeyW']))}`);
  await sleep(3000);
  note(`after 3 s: ${JSON.stringify(await state(S))}`);
  note(`menu: ${JSON.stringify(await S.evalJs(`(() => { const m = document.getElementById('menu'); const r = m ? m.getBoundingClientRect() : null;
    return { display: m ? getComputedStyle(m).display : null, w: r ? Math.round(r.width) : 0, hidden: document.hidden,
      fuel: window.WANDEROAD.fuel ? window.WANDEROAD.fuel.level : null,
      cine: window.WANDEROAD.cine ? !!window.WANDEROAD.cine.active : null }; })()`))}`);
  await keys(S, []);
  await S.shot('smoke');
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. FRESH PROFILE ON THE ROAD — suns visible, collected, counter climbing
 * ══════════════════════════════════════════════════════════════════════════ */
async function testRoad(S, FIX) {
  console.log('\n── 1. fresh profile, 90 s on the road ─────────────────────────────');
  await boot(S, `${BASE}?intro=off`, { fresh: true });
  const start = await state(S);
  check('fresh profile really is fresh (0 suns, boat locked)', start.suns === 0 && start.gems === 0 && start.boatUnlocked === false, JSON.stringify({ suns: start.suns, gems: start.gems, unlocked: start.boatUnlocked }));

  /* Start on a road with no water within 250 m — a suns-per-kilometre number measured on a
   * drive that ended in a lake is measuring the lake. */
  if (FIX.dryRoad) {
    await placeCar(S, FIX.dryRoad.x, FIX.dryRoad.z, FIX.dryRoad.heading);
    note(`started on dry road (${FIX.dryRoad.x}, ${FIX.dryRoad.z}), ${FIX.dryRoad.width} m wide`);
  }

  await mark(S, 'road-drive');
  await S.evalJs(AUTOPILOT(95));
  let firstSunAt = null;
  let firstVisibleAt = null;
  let widget = null;
  let stalled = 0;
  let resets = 0;
  for (let i = 0; i < 19; i++) {
    await sleep(5000);
    const st = await state(S);
    if (firstSunAt === null && st.suns > 0) firstSunAt = (i + 1) * 5;
    /* "suns become visible" measured the way a player sees them: project a live sun mesh
     * through the real camera and check it lands inside the viewport, in front of the lens. */
    const seen = await S.evalJs(`(() => { const W = window.WANDEROAD, T = window.THREE;
      const cam = W.camera; let onScreen = 0, nearest = 1e9;
      for (const [, c] of W.loot.suns) {
        const v = new T.Vector3(c.x, c.y, c.z).project(cam);
        const d = Math.hypot(c.x - W.car.x, c.z - W.car.z);
        if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) { onScreen++; nearest = Math.min(nearest, d); }
      }
      return { built: W.loot.stats.suns, onScreen, nearest: isFinite(nearest) ? +nearest.toFixed(1) : null }; })()`);
    if (firstVisibleAt === null && seen.onScreen > 0) firstVisibleAt = (i + 1) * 5;
    /* A player does not sit at 5 km/h in a hedge for a minute and a half; they press R. The
     * autopilot (tools/shoot.mjs's, borrowed whole) has no reset of its own, so this loop is
     * the hand that presses it — twice at most, and never in the last fifteen seconds. */
    if (st.kph < 12) stalled++;
    else stalled = 0;
    if (stalled >= 3 && resets < 2 && i < 15) {
      await S.evalJs(`window._tap('KeyR')`);
      resets++;
      stalled = 0;
      note(`t+${(i + 1) * 5}s  stuck at ${st.kph} km/h — pressed R (${resets})`);
    }
    if (i === 8) widget = await readWidget(S); // measured mid-drive, see readWidget's own note
    if (i === 2 || i === 8 || i === 17) await S.shot(`road-${(i + 1) * 5}s`);
    if (i % 3 === 0 || seen.onScreen) note(`t+${(i + 1) * 5}s  suns ${st.suns}  built ${seen.built}  on-screen ${seen.onScreen}${seen.nearest !== null ? ` (nearest ${seen.nearest} m)` : ''}  kph ${st.kph}  fps ${st.fps}`);
  }
  const p = await probe(S);
  const end = await state(S);
  await S.shot('road-final');

  widget = widget || (await readWidget(S));
  check('loot counter widget is measurably on screen while driving', widget.present && widget.visible, JSON.stringify(widget.rect) + ` opacity ${widget.opacity} "${(widget.text || '').replace(/\s+/g, ' ')}"`);
  check('loot counter does not overlap another visible HUD block', widget.overlaps && widget.overlaps.length === 0, `overlaps: ${(widget.overlaps || []).join(', ') || 'none'}`);

  /* The 🪙 in the counter is a Unicode 13 emoji. A missing glyph is a tofu box, and a tofu box
   * is indistinguishable from a designed square unless it is compared against a codepoint that
   * is GUARANTEED to have no glyph — so it is, on the page's own font stack. */
  const glyph = await S.evalJs(`(() => {
    const font = getComputedStyle(document.getElementById('lootCounter')).font;
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const g = cv.getContext('2d'); g.font = font; g.textBaseline = 'top';
    const draw = (ch) => { g.clearRect(0,0,64,64); g.fillStyle = '#000'; g.fillText(ch, 2, 2);
      return Array.from(g.getImageData(0,0,64,64).data).join(','); };
    const w = (ch) => { g.font = font; return +g.measureText(ch).width.toFixed(2); };
    const tofu = draw('\\u{10FFFD}');   // guaranteed no glyph on any font
    return { sun: { w: w('🪙'), tofu: draw('🪙') === tofu },
             gem:  { w: w('💎'), tofu: draw('💎') === tofu },
             boat: { w: w('⛵'), tofu: draw('⛵') === tofu }, font }; })()`);
  note(`glyphs: ${JSON.stringify(glyph)}`);
  check('the 🪙 sun glyph actually renders (not a tofu box)', glyph.sun && glyph.sun.tofu === false, `sun tofu=${glyph.sun?.tofu}, gem tofu=${glyph.gem?.tofu}, boat tofu=${glyph.boat?.tofu}`);

  check('suns exist in the world around the player', end.lootStats.suns > 0, `${end.lootStats.suns} sun meshes live in ${end.lootStats.sunTiles} tiles`);
  check('a sun was actually ON SCREEN (projected through the real camera)', firstVisibleAt !== null, firstVisibleAt !== null ? `first seen by t+${firstVisibleAt}s` : 'never framed one');
  check('suns collected within 60 s of driving (BOAT-PLAN acceptance #1)', firstSunAt !== null && firstSunAt <= 60, firstSunAt === null ? 'none in 95 s' : `first at t+${firstSunAt}s, ${end.suns} total`);
  check('counter widget shows the same number the wallet holds', String(await S.evalJs(`document.getElementById('lootCounter').textContent`)).includes(String(end.suns)), `wallet ${end.suns} / widget "${String(await S.evalJs(`document.getElementById('lootCounter').textContent.replace(/\\s+/g,' ')`)).trim()}"`);
  check('no NaN anywhere in 95 s of driving', p.nan === 0, `${p.nan} bad frames of ${p.frames}`);

  /* Distance driven, from the samples themselves — suns per KILOMETRE is the number
   * tools/diag-loot.mjs asserts against (15-45/km on the shipped seed), and suns per minute
   * of a drive that spent half its time stopped is not comparable to anything. */
  let km = 0;
  for (let i = 1; i < p.samples.length; i++) {
    const step = Math.hypot(p.samples[i].x - p.samples[i - 1].x, p.samples[i].z - p.samples[i - 1].z);
    if (step < 8) km += step; // 0.2 s apart: 8 m is 144 km/h, so anything above it is an R
  }
  km /= 1000;
  const perKm = end.suns / Math.max(km, 0.001);
  const sunPerMin = (end.suns / 95) * 60;
  note(`drove ${km.toFixed(2)} km in 95 s → ${end.suns} suns = ${perKm.toFixed(1)} suns/km (${sunPerMin.toFixed(0)}/min)`);
  note(`at that rate the 500-sun boat is ${(500 / Math.max(perKm, 0.01)).toFixed(0)} km / ${(500 / Math.max(sunPerMin, 0.01)).toFixed(0)} min away`);
  /* COLLECTED vs COLLECTABLE, decided rather than guessed. "8.8 suns/km against a placement
   * that claims 26.4" has two completely different explanations — the route genuinely had few
   * suns on it, or suns on the route were driven past and missed — and only one of them is a
   * bug. So the SAME pure placement function the renderer uses (src/world/loot.js's
   * sunsInBox) is asked how many suns lie within the pickup radius of the path that was
   * actually driven. */
  const path = p.samples.map((s) => [s.x, s.z]);
  let onPath = 0;
  let placedInBox = 0;
  if (path.length > 2) {
    const { sunsInBox, SUN_RADIUS: R } = await import('../src/world/loot.js').then((m) => ({ sunsInBox: m.sunsInBox, SUN_RADIUS: 7 }));
    const xs = path.map((q) => q[0]);
    const zs = path.map((q) => q[1]);
    const suns = sunsInBox(Math.min(...xs) - 60, Math.min(...zs) - 60, Math.max(...xs) + 60, Math.max(...zs) + 60, FIX.seed);
    placedInBox = suns.length;
    for (const c of suns) {
      for (let i = 0; i < path.length; i++) {
        if (Math.hypot(c.x - path[i][0], c.z - path[i][1]) <= R) { onPath++; break; }
      }
    }
  }
  note(`along the path actually driven: ${placedInBox} suns in the bounding box, ${onPath} of them within the 7 m pickup radius of the route; ${end.suns} collected`);
  check('every sun the car drove past was actually picked up', onPath === 0 || end.suns >= onPath - 1, `${end.suns} collected of ${onPath} reachable`);
  check('suns actually reach the player at the rate the placement claims (diag-loot: 26.4/km)', perKm > 12, `${perKm.toFixed(1)} suns/km collected vs 26.4/km placed`);
  note(`toasts: ${p.toasts.map((t) => `${t.t}s "${t.text}"`).join(' | ') || '(none)'}`);
  return { sunPerMin, perKm, km, suns: end.suns, glyph };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. THE LOCKED BARRIER — cushion, toast, and NO rescue teleport
 * ══════════════════════════════════════════════════════════════════════════ */
async function testBarrier(S, FIX) {
  console.log('\n── 2. locked: driving at the lake ─────────────────────────────────');
  await boot(S, `${BASE}?intro=off`, { fresh: true });
  const pre = await state(S);
  check('boat is locked on a fresh profile', pre.boatUnlocked === false, `unlocked=${pre.boatUnlocked}`);

  await placeCar(S, FIX.road.x, FIX.road.z, FIX.headingOut);
  await S.shot('barrier-0-at-the-road');
  const at = await state(S);
  note(`placed at (${at.x}, ${at.z}) facing the lake; shore profile ${FIX.shoreProfile}`);

  /* A player who wants to see the lake holds the throttle. 25 s of it, sampled finely, because
   * the interesting question is not the first second (tools/bench-boat.mjs already measured
   * that offline) but what the cushion settles at — a cushion that leaves a creep on is a
   * cushion that eventually puts the car in the water anyway. */
  await mark(S, 'barrier-approach');
  await keys(S, ['KeyW']);
  const trace = [];
  for (let i = 0; i < 50; i++) {
    await sleep(500);
    const st = await state(S);
    trace.push(st);
    if (i === 5) await S.shot('barrier-1-cushioning');
  }
  await keys(S, []);
  await sleep(800);
  await S.shot('barrier-2-stopped');
  const p = await probe(S);
  const end = await state(S);

  const peak = Math.max(...trace.map((t) => t.kph));
  const startPos = trace[0];
  const held = p.samples.filter((s) => s.t > 3);
  const creep = held.length ? held.reduce((a, s) => a + s.kph, 0) / held.length : 0;
  const deepest = Math.max(...p.samples.map((s) => (s.depth === null ? 0 : s.depth)), 0);
  const outFromRoad = Math.max(...p.samples.map((s) => Math.hypot(s.x - FIX.road.x, s.z - FIX.road.z)));
  note(`peak ${peak} km/h → ended ${end.kph} km/h at (${end.x}, ${end.z})`);
  note(`speed trace (0.5 s): ${trace.map((t) => t.kph).join(' ')}`);
  note(`mean speed after the cushion bit: ${creep.toFixed(2)} km/h; furthest off the road ${outFromRoad.toFixed(1)} m; deepest water reached ${deepest.toFixed(2)} m`);
  note(`toasts: ${p.toasts.map((t) => `${t.t}s "${t.text}"`).join(' | ') || '(none)'}`);
  note(`depth trace: ${p.samples.filter((s, i) => i % 5 === 0).map((s) => `${s.t}s:${s.depth}`).join(' ')}`);

  check('the car was actually up to speed before the barrier bit', peak > 15, `${peak} km/h`);
  check('cushions to near-stop at the shoreline', end.kph < 3, `${end.kph} km/h after 25 s of held throttle`);
  check('"you need a boat" toast appeared', p.toasts.some((t) => /need a boat/i.test(t.text)), p.toasts.map((t) => t.text).join(' | ') || '(none)');
  check('NO rescue teleport while the boat is locked (position continuous)', p.maxJump < 3 && p.jumps.length === 0, `biggest single-frame move ${p.maxJump} m; jumps ${JSON.stringify(p.jumps)}`);
  check('rescue never said its own line', !p.toasts.some((t) => /water has you/i.test(t.text)), p.toasts.map((t) => t.text).join(' | ') || '(none)');
  check('the cushion actually holds the car OUT of the water', deepest < 0.25, `deepest ${deepest.toFixed(2)} m (rescue\'s own contact gate is 0.25 m)`);
  check('the barrier does not leave a permanent creep', creep < 0.6, `mean ${creep.toFixed(2)} km/h over the held-throttle stretch`);
  check('never entered boat mode while locked', end.boat === false && end.boatMeshVisible === false, `boat=${end.boat} mesh=${end.boatMeshVisible}`);
  note(`started at (${startPos.x}, ${startPos.z}), ended (${end.x}, ${end.z})`);

  /* And the polite player: read the toast, let off. Does the car settle, or keep sliding in? */
  console.log('   ── and the player who reads the toast and lets off ──');
  await mark(S, 'barrier-letoff');
  await keys(S, ['KeyW']);
  await sleep(4000);
  await keys(S, []);
  await sleep(6000);
  const off = await state(S);
  const op = await probe(S);
  const offDeepest = Math.max(...op.samples.map((s) => (s.depth === null ? 0 : s.depth)), 0);
  note(`let-off: ended ${off.kph} km/h, deepest ${offDeepest.toFixed(2)} m, toasts ${op.toasts.map((t) => `"${t.text}"`).join(' | ') || '(none)'}`);
  check('letting off the throttle leaves the car parked, dry and un-teleported', off.kph < 2 && op.jumps.length === 0, `${off.kph} km/h, jumps ${op.jumps.length}, deepest ${offDeepest.toFixed(2)} m`);

  /* A SECOND shore. One odd bank is a fixture; two is the feature. */
  let alt = null;
  if (FIX.alt) {
    console.log('   ── a second, unrelated lakeshore ──');
    note(`alt shore (${FIX.alt.road.x}, ${FIX.alt.road.z}): ${FIX.alt.shoreProfile}`);
    await placeCar(S, FIX.alt.road.x, FIX.alt.road.z, FIX.alt.headingOut);
    await mark(S, 'barrier-alt');
    await keys(S, ['KeyW']);
    await sleep(16000);
    await keys(S, []);
    await sleep(800);
    await S.shot('barrier-3-second-shore');
    const ap2 = await probe(S);
    const altDeepest = Math.max(...ap2.samples.map((s) => (s.depth === null ? 0 : s.depth)), 0);
    alt = { jumps: ap2.jumps.length, deepest: altDeepest, toasts: ap2.toasts.map((t) => t.text) };
    note(`alt: jumps ${ap2.jumps.length}, deepest ${altDeepest.toFixed(2)} m, toasts ${ap2.toasts.map((t) => `${t.t}s "${t.text}"`).join(' | ') || '(none)'}`);
    check('second shore: no rescue teleport either', ap2.jumps.length === 0 && !ap2.toasts.some((t) => /water has you/i.test(t.text)), `${ap2.jumps.length} jump(s)`);
  }
  return { toasts: p.toasts, peak, end, creep, deepest, outFromRoad, alt };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3-5. THE VOYAGE — enter the boat, feel it, take a diamond, come home
 * ══════════════════════════════════════════════════════════════════════════ */
async function testVoyage(S, FIX) {
  console.log('\n── 3. ?cheat: into the water ──────────────────────────────────────');
  await boot(S, `${BASE}?cheat&intro=off&probe`, { fresh: true });
  const pre = await state(S);
  check('?cheat unlocks the boat instantly', pre.boatUnlocked === true, `unlocked=${pre.boatUnlocked}`);

  /* Launch from FIX.beachHome, not the raw FIX.road/water/headingOut: this function SAILS HOME
   * to wherever it launches from (see the "back to the beach" section below), and FIX.road's own
   * direct line to the water can be steeper than src/game/boat.js's own EXIT_STEEP_SLOPE bar —
   * the game now correctly refuses to land a returning boat there (docs/BOAT-PLAN.md fix round
   * 2). FIX.beachHome is the same shore, a few car-lengths along, verified beachable by
   * tools/diag-playtest-fixtures.mjs's own search (see that file's own comment on the field).
   * Nothing else in this file switches: testBarrier/testFoam/testLook/testPerf never try to
   * beach a boat, so FIX.road keeps meaning exactly what it always has for them. */
  const HOME = FIX.beachHome || FIX;
  await placeCar(S, HOME.road.x, HOME.road.z, HOME.headingOut);
  await S.shot('voyage-0-at-the-road');
  await mark(S, 'launch');
  await keys(S, ['KeyW']);
  let enteredAt = null;
  for (let i = 0; i < 24 && enteredAt === null; i++) {
    await sleep(250);
    const st = await state(S);
    if (st.boat) enteredAt = ((i + 1) * 250) / 1000;
  }
  await sleep(1200);
  await S.shot('voyage-1-afloat');
  const afloat = await state(S);
  check('boat mode engages on driving into deep water', afloat.boat === true, enteredAt === null ? 'never' : `at t+${enteredAt}s`);
  check('the car model is hidden and the boat mesh is shown', afloat.carVisible === false && afloat.boatMeshVisible === true, `car.visible=${afloat.carVisible} boat.visible=${afloat.boatMeshVisible}`);

  /* ── 4. the diamond, FIRST — the fixture put one ~50 m off this beach on purpose, and a
   * boat that has already spent 20 s messing about has usually driven over it by accident
   * (measured: the first run of this file collected it during the feel leg and then went
   * looking for one 246 m away). ── */
  console.log('\n── 4. a diamond, by boat ──────────────────────────────────────────');
  const nearGem = await S.evalJs(`(() => { const W = window.WANDEROAD; let best = null, bd = 1e9;
    for (const [, g] of W.loot.gemTiles) { if (!g) continue;
      const d = Math.hypot(g.x - W.car.x, g.z - W.car.z);
      if (d < bd) { bd = d; best = { x: +g.x.toFixed(1), y: +g.y.toFixed(2), z: +g.z.toFixed(1), id: g.id, d: +d.toFixed(1) }; } }
    return { best, live: W.loot.stats.gems, gems: W.wallet.gems }; })()`);
  note(`nearest live gem: ${JSON.stringify(nearGem)}`);
  check('there is a diamond within reach on this water', !!nearGem.best, nearGem.best ? `${nearGem.best.d} m away at (${nearGem.best.x}, ${nearGem.best.z})` : `${nearGem.live} gems live`);

  let gemRun = null;
  if (nearGem.best) {
    await mark(S, 'gem-chase');
    const onScreen = await S.evalJs(`(() => { const W = window.WANDEROAD, T = window.THREE;
      const v = new T.Vector3(${nearGem.best.x}, ${nearGem.best.y}, ${nearGem.best.z}).project(W.camera);
      return { ndc: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)], inFrame: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 }; })()`);
    note(`gem in frame before the chase: ${JSON.stringify(onScreen)}`);
    await S.shot('gem-0-before');
    gemRun = await S.evalJs(CHASE(nearGem.best.x, nearGem.best.z, 90000, { stop: 5 }));
    await sleep(800);
    await S.shot('gem-1-after');
    const g = await state(S);
    const gp = await probe(S);
    note(`chase: ${JSON.stringify(gemRun)}; toasts ${gp.toasts.map((t) => `"${t.text}"`).join(' | ') || '(none)'}`);
    check('collecting a diamond bumps the gem counter', g.gems > nearGem.gems, `${nearGem.gems} → ${g.gems}`);
    check('the diamond toast fires', gp.toasts.some((t) => /diamond/i.test(t.text)), gp.toasts.map((t) => t.text).join(' | ') || '(none)');
    check('the counter widget shows the diamond', String(await S.evalJs(`document.getElementById('lootCounter').textContent`)).includes(`💎 ${g.gems}`), String(await S.evalJs(`document.getElementById('lootCounter').textContent.replace(/\\s+/g,' ')`)).trim());
    check('still afloat and still finite after the pickup', g.boat === true && g.finite, `boat=${g.boat} finite=${g.finite}`);
  }

  /* ── feel: 20 s of ordinary messing about, measured, OUT ON THE OPEN WATER ──
   * Sailed to, not teleported to: the point of this section is what the boat feels like under
   * a hand, and a boat measured in the surf spends the measurement grounding. */
  console.log('\n── 3b. the feel of it, out on the open water ──────────────────────');
  if (FIX.deep) {
    note(`sailing out to (${FIX.deep.x}, ${FIX.deep.z}), ${FIX.deep.depth} m deep, ${FIX.deep.out} m off the beach`);
    const outbound = await S.evalJs(CHASE(FIX.deep.x, FIX.deep.z, 60000, { stop: 15 }));
    note(`outbound: ${JSON.stringify(outbound)}`);
  }
  await keys(S, []);
  await sleep(1500);
  await mark(S, 'feel');
  await keys(S, ['KeyW']);
  await sleep(6000);
  const straight = await probe(S);
  await keys(S, ['KeyW', 'KeyA']);
  await sleep(7000);
  await S.shot('voyage-2-turning');
  await keys(S, ['KeyW', 'KeyD']);
  await sleep(5000);
  await keys(S, []);
  await sleep(5000);
  await S.shot('voyage-3-coasting');
  const feel = await probe(S);
  const st2 = await state(S);

  const S2 = feel.samples;
  const topKph = Math.max(...S2.map((s) => s.kph));
  const straightKph = straight.samples.slice(-6).map((s) => s.kph);
  const bobY = S2.filter((s) => s.boat).map((s) => s.y);
  const bobAmp = bobY.length ? (Math.max(...bobY) - Math.min(...bobY)) / 2 : 0;
  const rolls = S2.map((s) => Math.abs(s.roll));
  /* turn radius, measured from the samples themselves: r = v / ω over the hard-left leg */
  const turnSeg = S2.filter((s) => s.t > 6.4 && s.t < 12.5 && s.boat);
  let radius = null;
  if (turnSeg.length > 6) {
    let dyaw = 0;
    for (let i = 1; i < turnSeg.length; i++) {
      let d = turnSeg[i].yaw - turnSeg[i - 1].yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      dyaw += d;
    }
    const dt = turnSeg[turnSeg.length - 1].t - turnSeg[0].t;
    const vAvg = (turnSeg.reduce((a, s) => a + s.kph, 0) / turnSeg.length) / 3.6;
    radius = Math.abs(dyaw) > 0.05 ? vAvg / (Math.abs(dyaw) / dt) : null;
  }
  /* how long from throttle-off to actually stopped — a player notices a boat that glides */
  const coast = S2.filter((s) => s.t > 18);
  const coastFrom = coast.length ? coast[0].kph : 0;
  const coastEnd = coast.length ? coast[coast.length - 1].kph : 0;

  note(`straight-line settle: ${straightKph.join(', ')} km/h (cap ${topKph.toFixed(1)})`);
  note(`bob: peak-to-peak ${(bobAmp * 2).toFixed(2)} m about y=${(bobY.reduce((a, b) => a + b, 0) / Math.max(bobY.length, 1)).toFixed(2)}`);
  note(`turn: max roll ${Math.max(...rolls).toFixed(3)} rad, measured radius ${radius ? radius.toFixed(1) + ' m' : 'n/a'}`);
  note(`coast: ${coastFrom.toFixed(1)} → ${coastEnd.toFixed(1)} km/h over ${(coast.length ? coast[coast.length - 1].t - coast[0].t : 0).toFixed(1)} s`);
  check('top speed is capped near 34 km/h', topKph > 28 && topKph <= 35.5, `${topKph.toFixed(1)} km/h`);
  check('the boat visibly bobs on the water', bobAmp > 0.05, `±${bobAmp.toFixed(2)} m`);
  check('it leans into a turn', Math.max(...rolls) > 0.02, `${Math.max(...rolls).toFixed(3)} rad`);
  check('turn radius is in the cozy range the brief asked for (~14 m)', radius !== null && radius < 26, radius ? `${radius.toFixed(1)} m` : 'not measurable');
  check('no NaN and no teleport across the whole voyage so far', feel.nan === 0 && feel.jumps.length === 0, `nan ${feel.nan}, jumps ${feel.jumps.length}, maxJump ${feel.maxJump} m`);

  /* ── 6a. foam, from the boat ── */
  console.log('\n── 6a. foam drawings, seen from the boat ──────────────────────────');
  await S.shot('foam-1-from-the-boat');
  const waterPx = await S.evalJs(PIXELS(0.08, 0.30, 0.84, 0.28));
  note(`open water band: ${JSON.stringify(waterPx)}`);

  /* ── 5. home ── */
  console.log('\n── 5. back to the beach ───────────────────────────────────────────');
  await mark(S, 'homeward');
  /* Aim 40 m INLAND of the launch point, not at the launch point itself: a boat told to stop
   * exactly at the waterline orbits it at its own 14 m turn radius forever (measured: 90 s,
   * closest 8.2 m, never beached). A player heading home aims at the beach, not at the edge. */
  const inX = +(HOME.road.x - Math.sin(HOME.headingOut) * 40).toFixed(1);
  const inZ = +(HOME.road.z - Math.cos(HOME.headingOut) * 40).toFixed(1);
  note(`aiming ashore at (${inX}, ${inZ}), 40 m inland of the launch point`);
  const home = await S.evalJs(CHASE(inX, inZ, 90000, { stop: 6, untilAshore: true }));
  await sleep(1500);
  await S.shot('voyage-4-ashore');
  const ashore = await state(S);
  const hp = await probe(S);
  note(`homeward: ${JSON.stringify(home)} → (${ashore.x}, ${ashore.z}) ${ashore.kph} km/h`);
  check('exits boat mode on reaching the shore', ashore.boat === false, `boat=${ashore.boat} at (${ashore.x}, ${ashore.z})`);
  check('the car model comes back and the boat mesh goes away', ashore.carVisible === true && ashore.boatMeshVisible === false, `car=${ashore.carVisible} boat=${ashore.boatMeshVisible}`);
  check('no NaN through the whole return', hp.nan === 0 && ashore.finite, `nan ${hp.nan}, finite ${ashore.finite}`);

  // and it is a CAR again: drive it. A player who has just beached tries forward, then
  // reverse, then — grudgingly — R. All three are measured, in that order.
  await mark(S, 'drive-away');
  const pose = await S.evalJs(`(() => { const W = window.WANDEROAD, c = W.car;
    const s = c.terrain.surface(c.x, c.z);
    return { gear: c.gear, y: +c.y.toFixed(2), ground: +c.terrain.height(c.x, c.z).toFixed(2),
      surfaceKind: s.surfaceKind, grip: +s.grip.toFixed(2), onRoad: +s.onRoad.toFixed(2),
      slopeDeg: +(Math.acos(Math.max(-1, Math.min(1, s.ny))) * 180 / Math.PI).toFixed(1),
      pitch: c.pitch !== undefined ? +c.pitch.toFixed(2) : null, roll: c.roll !== undefined ? +c.roll.toFixed(2) : null }; })()`);
  note(`beached pose: ${JSON.stringify(pose)}`);
  await keys(S, ['KeyW']);
  await sleep(8000);
  await keys(S, []);
  const away = await state(S);
  await S.shot('voyage-5-driving-again');
  note(`8 s of throttle after beaching: ${away.kph} km/h at (${away.x}, ${away.z})`);
  let rev = null;
  if (Math.abs(away.kph) < 5) {
    await keys(S, ['KeyS']);
    await sleep(5000);
    await keys(S, []);
    rev = await state(S);
    note(`then 5 s of reverse: ${rev.kph} km/h at (${rev.x}, ${rev.z})`);
    await S.shot('voyage-6-tried-reverse');
  }
  const ap = await probe(S);
  const ground = await S.evalJs(`(() => { const W = window.WANDEROAD, c = W.car;
    return { y: +c.y.toFixed(2), ground: +c.terrain.height(c.x, c.z).toFixed(2) }; })()`);
  check('the beached car can drive itself off the sand', Math.abs(away.kph) > 5 || (rev && Math.abs(rev.kph) > 5), `forward ${away.kph} km/h, reverse ${rev ? rev.kph + ' km/h' : 'not needed'} (${pose.surfaceKind}, ${pose.slopeDeg}° slope, grip ${pose.grip})`);
  check('no fall-through after the handover', ground.y > ground.ground - 3, `car y ${ground.y} vs ground ${ground.ground}`);
  check('no teleport on the handover', ap.jumps.length === 0, `maxJump ${ap.maxJump} m`);

  /* ── 6b. foam, from the shore ── */
  console.log('\n── 6b. foam drawings, seen from the shore ─────────────────────────');
  await S.shot('foam-2-from-the-shore');
  const shorePx = await S.evalJs(PIXELS(0.08, 0.28, 0.84, 0.24));
  note(`shore-side water band: ${JSON.stringify(shorePx)}`);
  return { waterPx, shorePx, topKph, radius, bobAmp };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6c. RIVERS AND PONDS — the small water must look untouched
 * ══════════════════════════════════════════════════════════════════════════ */
async function testFoam(S, FIX) {
  console.log('\n── 6c. small water: rivers and ponds ──────────────────────────────');
  await boot(S, `${BASE}?cheat&intro=off&probe`, { fresh: true });
  /* A river crossing, found by search: shallow flowing water ON a road, which is exactly the
   * water the spec says must be left alone. */
  const spot = await S.evalJs(`(() => { const W = window.WANDEROAD; return { seed: W.SEED }; })()`);
  note(`page seed ${spot.seed} (fixture seed ${FIX.seed})`);
  /* SMALL water means the water the foam gate is supposed to skip: `waterOpenness` (the same
   * flood proxy render/water.js's own `calm` term uses) low, or too shallow for the depth
   * gate. Imported live off the dev server rather than re-derived — src/world/loot.js's own
   * deviation note makes the same call about the same function for the same reason. */
  await S.evalJs(`import('/src/render/water.js').then(m => { window._openness = m.waterOpenness; })`);
  await sleep(800);
  const found = await S.evalJs(`(() => { const W = window.WANDEROAD, c = W.car, t = c.terrain;
    if (!window._openness || !window._depthAt) return { err: 'no sampler' };
    let best = null;
    for (let dz = -400; dz <= 400; dz += 10) for (let dx = -400; dx <= 400; dx += 10) {
      const x = c.x + dx, z = c.z + dz;
      const dep = window._depthAt(x, z);
      if (dep === null || dep < 0.25) continue;
      const open = window._openness(x, z, W.SEED);
      if (open > 0.45) continue;                 // that is open sea, not a river or a pond
      const d = Math.hypot(dx, dz);
      if (!best || d < best.d) best = { x: +x.toFixed(1), z: +z.toFixed(1), d: +d.toFixed(1), depth: +dep.toFixed(2), openness: +open.toFixed(2) };
    }
    return best; })()`);
  note(`nearest SMALL water (low openness) to spawn: ${JSON.stringify(found)}`);
  let smallPx = null;
  if (found && found.x !== undefined) {
    await placeCar(S, found.x + 22, found.z + 22, Math.atan2(-22, -22));
    await sleep(1500);
    await S.shot('foam-3-small-water');
    smallPx = await S.evalJs(PIXELS(0.15, 0.42, 0.7, 0.28));
    note(`small-water band: ${JSON.stringify(smallPx)}`);
    /* And the same measurement on OPEN water, from the same kind of viewpoint, so "unchanged"
     * has something to be unchanged relative to. */
    await placeCar(S, FIX.road.x, FIX.road.z, FIX.headingOut);
    await sleep(1500);
    await S.shot('foam-3b-open-water-for-comparison');
    const openPx = await S.evalJs(PIXELS(0.15, 0.42, 0.7, 0.28));
    note(`open-water band, same framing: ${JSON.stringify(openPx)}`);
    check('small water is visibly less scribbled than open water', smallPx.brightFrac < openPx.brightFrac * 0.9 || smallPx.sd < openPx.sd * 0.9, `small brightFrac ${smallPx.brightFrac} / sd ${smallPx.sd} vs open ${openPx.brightFrac} / ${openPx.sd}`);
    smallPx = { small: smallPx, open: openPx, spot: found };
  }

  /* DO THE LINES ACTUALLY DRIFT? "the lines visibly crawl, Wind Waker style" (BOAT-PLAN,
   * workstream A) is a claim about two moments, so it takes two frames from a camera that has
   * not moved between them — parked on the beach, ten seconds apart, same pixels compared. */
  console.log('   ── and do the drawings drift? ──');
  await placeCar(S, FIX.road.x, FIX.road.z, FIX.headingOut);
  await keys(S, []);
  await sleep(2500);
  const before = await S.evalJs(`(() => { const cv = document.querySelector('#app canvas');
    const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
    c2.getContext('2d').drawImage(cv, 0, 0);
    window._foamA = c2.getContext('2d').getImageData(0, Math.round(cv.height * 0.34), cv.width, Math.round(cv.height * 0.14)).data;
    return window._foamA.length; })()`);
  await S.shot('foam-4-drift-t0');
  await sleep(10000);
  await S.shot('foam-5-drift-t10');
  const drift = await S.evalJs(`(() => { const cv = document.querySelector('#app canvas');
    const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
    c2.getContext('2d').drawImage(cv, 0, 0);
    const b = c2.getContext('2d').getImageData(0, Math.round(cv.height * 0.34), cv.width, Math.round(cv.height * 0.14)).data;
    const a = window._foamA; let sum = 0, moved = 0, n = 0;
    for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i+1] - b[i+1]) + Math.abs(a[i+2] - b[i+2]);
      sum += d; if (d > 24) moved++; n++; }
    return { px: n, meanDelta: +(sum / n).toFixed(2), movedFrac: +(moved / n).toFixed(3) }; })()`);
  note(`10 s apart, camera parked: ${JSON.stringify(drift)} (before had ${before} bytes)`);
  check('the water surface visibly changes over 10 s (the drawings crawl)', drift.movedFrac > 0.02, `${(drift.movedFrac * 100).toFixed(1)}% of the water band changed, mean delta ${drift.meanDelta}`);
  return { smallPx, drift };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE UNLOCK MOMENT — the one beat of this feature nobody can reach by playing
 * for five minutes. The wallet is nudged to 499 and then the FIVE HUNDREDTH SUN IS DRIVEN
 * OVER: everything after that is the shipped path (Wallet.addSuns crosses BOAT_UNLOCK_SUNS,
 * queues its own event, main.js drains it, chime + toast + the counter's own unlocked state).
 * Nothing is called directly and no flag is set — the only thing touched is the running total
 * a player would have got to by driving twenty kilometres.
 * ══════════════════════════════════════════════════════════════════════════ */
async function testUnlock(S, FIX) {
  console.log('\n── the five-hundredth sun ────────────────────────────────────────');
  await boot(S, `${BASE}?intro=off`, { fresh: true });
  if (FIX.dryRoad) await placeCar(S, FIX.dryRoad.x, FIX.dryRoad.z, FIX.dryRoad.heading);
  await S.evalJs(`(() => { window.WANDEROAD.wallet.suns = 499; return window.WANDEROAD.wallet.suns; })()`);
  const before = await state(S);
  const w0 = await readWidget(S);
  await S.shot('unlock-0-at-499');
  check('499 suns is still locked', before.boatUnlocked === false, `unlocked=${before.boatUnlocked}, widget "${(w0.text || '').replace(/\s+/g, ' ')}"`);

  await mark(S, 'unlock');
  await S.evalJs(AUTOPILOT(70));
  let at = null;
  for (let i = 0; i < 14 && at === null; i++) {
    await sleep(5000);
    const st = await state(S);
    if (st.suns >= 500) at = (i + 1) * 5;
  }
  await sleep(1200);
  await S.shot('unlock-1-the-moment');
  const p = await probe(S);
  const after = await state(S);
  const w1 = await readWidget(S);
  note(`suns ${before.suns} → ${after.suns} after ${at === null ? '70 s (never)' : `t+${at}s`}`);
  note(`toasts: ${p.toasts.map((t) => `${t.t}s "${t.text}"`).join(' | ') || '(none)'}`);
  note(`counter now reads "${(w1.text || '').replace(/\s+/g, ' ')}"`);
  check('the 500th sun unlocks the boat', after.boatUnlocked === true, `suns ${after.suns}, unlocked ${after.boatUnlocked}`);
  check('the unlock says something', p.toasts.some((t) => /boat/i.test(t.text)), p.toasts.map((t) => t.text).join(' | ') || '(none)');
  check('the counter switches to its unlocked state', /boat unlocked/i.test(w1.text || ''), `"${(w1.text || '').replace(/\s+/g, ' ')}"`);
  const persisted = await S.evalJs(`localStorage.getItem('wanderoad.loot.v1')`);
  note(`localStorage: ${persisted}`);
  check('the unlock is persisted to wanderoad.loot.v1', typeof persisted === 'string' && /"boat":true/.test(persisted), String(persisted));
  return { at, toasts: p.toasts };
}

/* ══════════════════════════════════════════════════════════════════════════
 * LOOK — what the new things actually look like, from angles the chase camera
 * cannot give. The chase rig only has 'sport' and 'hood' (src/car/camera.js's own MODES), so
 * every gameplay screenshot of the boat is taken from directly behind it, which is the one
 * angle that shows a hull as a rectangle. This renders the SAME live scene through the SAME
 * post pipeline (W.post.render) from a camera this file owns, reads the canvas back, and
 * writes the PNG itself — inspection only, nothing in the game is touched.
 * ══════════════════════════════════════════════════════════════════════════ */
async function testLook(S, FIX) {
  console.log('\n── look: the boat, the gems, and the foam, from a camera that moves ──');
  await boot(S, `${BASE}?cheat&intro=off&probe`, { fresh: true });
  await placeCar(S, FIX.road.x, FIX.road.z, FIX.headingOut);
  await keys(S, ['KeyW']);
  let afloat = false;
  for (let i = 0; i < 40 && !afloat; i++) {
    await sleep(300);
    afloat = (await state(S)).boat;
  }
  check('afloat for the beauty shots', afloat, afloat ? 'yes' : 'never got afloat');
  if (FIX.deep) await S.evalJs(CHASE(FIX.deep.x, FIX.deep.z, 45000, { stop: 18 }));
  await keys(S, []);
  await sleep(2500);

  await S.evalJs(`(() => { const T = window.THREE, W = window.WANDEROAD;
    window._shotCam = new T.PerspectiveCamera(45, innerWidth / innerHeight, 0.2, 4000);
    window._renderFrom = (px, py, pz, tx, ty, tz, fov) => {
      const c = window._shotCam; c.fov = fov || 45; c.updateProjectionMatrix();
      c.position.set(px, py, pz); c.lookAt(tx, ty, tz);
      (W.post ? W.post.render(W.scene, c) : W.renderer.render(W.scene, c));
      return document.querySelector('#app canvas').toDataURL('image/png');
    }; return 'ok'; })()`);

  const grab = async (name, dx, dy, dz, fov) => {
    const url = await S.evalJs(`(() => { const c = window.WANDEROAD.car;
      return window._renderFrom(c.x + ${dx}, c.y + ${dy}, c.z + ${dz}, c.x, c.y + 0.6, c.z, ${fov || 45}); })()`);
    if (typeof url !== 'string' || !url.startsWith('data:image/png')) {
      console.log(`      ! ${name}: no image (${JSON.stringify(url).slice(0, 120)})`);
      return;
    }
    const path = resolve(SHOTS, `${name}.png`);
    writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`      shot  ${path}`);
  };

  /* THE WATERLINE, numerically, before any opinion is formed about it: src/render/ships.js's
   * addHull() puts the keel at -H*0.42 and the gunwale at +H*0.58 about the mesh origin, and
   * main.js pins that origin to car.y — so how much hull is under water is arithmetic, not a
   * matter of taste, and the pictures below are judged against it rather than instead of it. */
  const waterline = await S.evalJs(`(() => { const W = window.WANDEROAD, c = W.car;
    const L = 5.2, H = L * 0.17;               // ships.js PLAYER_BOAT_LENGTH and its H = L*0.17
    const keel = -H * 0.42, gun = H * 0.58;
    const wl = window._depthAt ? null : null;
    const s = c.terrain.surface(c.x, c.z);
    const wy = window._wl ? window._wl(s.w, s.y) : null;
    return { boatMeshY: +W.boatMesh.position.y.toFixed(3), carY: +c.y.toFixed(3),
      waterY: wy === null ? null : +wy.toFixed(3), hullHeight: +H.toFixed(3),
      keelBelowOrigin: +keel.toFixed(3), gunwaleAboveOrigin: +gun.toFixed(3),
      submergedNow: wy === null ? null : +(wy - (W.boatMesh.position.y + keel)).toFixed(3),
      hullFractionUnder: wy === null ? null : +(((wy - (W.boatMesh.position.y + keel)) / H)).toFixed(2) }; })()`);
  note(`waterline: ${JSON.stringify(waterline)}`);
  check('the hull actually sits IN the water, not on it', waterline.hullFractionUnder !== null && waterline.hullFractionUnder > 0.15 && waterline.hullFractionUnder < 0.85, `${(waterline.hullFractionUnder * 100).toFixed(0)}% of the hull is below the surface`);

  await grab('look-boat-side', 9, 2.2, 0, 40);
  /* Eye height 0.35 m over the water, close aboard: the one framing where a waterline either
   * reads or does not. */
  await S.evalJs(`(() => { const c = window.WANDEROAD.car, s = c.terrain.surface(c.x, c.z);
    window._wy = window._wl ? window._wl(s.w, s.y) : c.y; return window._wy; })()`);
  {
    const url = await S.evalJs(`(() => { const c = window.WANDEROAD.car;
      return window._renderFrom(c.x + 4.5, window._wy + 0.35, c.z + 0.5, c.x, window._wy + 0.30, c.z, 32); })()`);
    if (typeof url === 'string' && url.startsWith('data:image/png')) {
      writeFileSync(resolve(SHOTS, 'look-boat-waterline.png'), Buffer.from(url.split(',')[1], 'base64'));
      console.log(`      shot  ${resolve(SHOTS, 'look-boat-waterline.png')}`);
    }
  }
  await grab('look-boat-bow', 1, 1.8, 9, 40);
  await grab('look-boat-quarter', 7, 3.5, -7, 40);
  await grab('look-boat-close', 4.5, 1.2, 3, 35);
  await grab('look-water-from-above', 0, 26, 26, 55);
  await grab('look-water-flat', 0, 3, 34, 55);

  /* The anchored fleet, framed the same way, because "same visual family as the anchored
   * ships" (docs/BOAT-PLAN.md) is a claim about how the two look side by side. */
  const ship = await S.evalJs(`(() => { const W = window.WANDEROAD; let best = null, bd = 1e9;
    for (const rec of W.ships.tiles.values()) { if (!rec) continue;
      const p = rec.mesh.position; const d = Math.hypot(p.x - W.car.x, p.z - W.car.z);
      if (d < bd) { bd = d; best = { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), d: +d.toFixed(1) }; } }
    return best; })()`);
  note(`nearest anchored ship: ${JSON.stringify(ship)}`);
  if (ship) {
    const url = await S.evalJs(`window._renderFrom(${ship.x + 16}, ${ship.y + 5}, ${ship.z + 3}, ${ship.x}, ${ship.y + 2}, ${ship.z}, 40)`);
    if (typeof url === 'string' && url.startsWith('data:image/png')) {
      const path = resolve(SHOTS, 'look-anchored-ship.png');
      writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
      console.log(`      shot  ${path}`);
    }
  }

  /* And a gem, framed at the distance a player first sees one. */
  const gem = await S.evalJs(`(() => { const W = window.WANDEROAD; let best = null, bd = 1e9;
    for (const [, g] of W.loot.gemTiles) { if (!g) continue;
      const d = Math.hypot(g.x - W.car.x, g.z - W.car.z);
      if (d < bd) { bd = d; best = { x: +g.x.toFixed(1), y: +g.y.toFixed(2), z: +g.z.toFixed(1), d: +d.toFixed(1) }; } }
    return best; })()`);
  note(`nearest gem for the close-up: ${JSON.stringify(gem)}`);
  if (gem) {
    for (const [tag, back, up] of [['close', 6, 2], ['mid', 22, 4], ['far', 55, 7]]) {
      const url = await S.evalJs(`window._renderFrom(${gem.x + back * 0.7}, ${gem.y + up}, ${gem.z + back * 0.7}, ${gem.x}, ${gem.y}, ${gem.z}, 45)`);
      if (typeof url === 'string' && url.startsWith('data:image/png')) {
        const path = resolve(SHOTS, `look-gem-${tag}.png`);
        writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));
        console.log(`      shot  ${path}`);
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 7. PERF — boat vs road, same session, same machine
 * ══════════════════════════════════════════════════════════════════════════ */
async function testPerf(S, FIX) {
  console.log('\n── 7. frame rate: road baseline vs boat ───────────────────────────');
  await boot(S, `${BASE}?cheat&intro=off`, { fresh: true });

  const measure = async (label, secs) => {
    await mark(S, label);
    await sleep(secs * 1000);
    const p = await probe(S);
    const f = p.samples.map((s) => s.fps).filter((v) => v > 0).sort((a, b) => a - b);
    const render = await S.evalJs(`(() => { const W = window.WANDEROAD;
      const t0 = performance.now(); for (let i = 0; i < 20; i++) (W.post ? W.post.render(W.scene, W.camera) : W.renderer.render(W.scene, W.camera));
      return { renderMs: +((performance.now() - t0) / 20).toFixed(2), tris: W.renderer.info.render.triangles, calls: W.renderer.info.render.calls }; })()`);
    const med = f.length ? f[Math.floor(f.length / 2)] : 0;
    const low = f.length ? f[Math.floor(f.length * 0.05)] : 0;
    note(`${label}: median ${med} fps, 5th-pct ${low} fps, render ${render.renderMs} ms, ${render.tris} tris, ${render.calls} calls`);
    return { label, med, low, ...render };
  };

  // road baseline: real driving, same as a player
  await S.evalJs(AUTOPILOT(40));
  await sleep(6000);
  const road = await measure('road', 30);
  await sleep(6000);
  await S.shot('perf-road');

  // boat
  await placeCar(S, FIX.road.x, FIX.road.z, FIX.headingOut);
  await keys(S, ['KeyW']);
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    await sleep(300);
    ok = (await state(S)).boat;
  }
  check('reached boat mode for the perf run', ok, ok ? 'afloat' : 'never got afloat');
  await sleep(2000);
  const boat = await measure('boat', 30);
  await keys(S, []);
  await S.shot('perf-boat');

  const drop = road.med > 0 ? ((road.med - boat.med) / road.med) * 100 : 0;
  check('boat mode is not materially slower than the road', boat.med >= road.med * 0.85, `road ${road.med} fps vs boat ${boat.med} fps (${drop.toFixed(0)}% ${drop >= 0 ? 'lower' : 'higher'}), render ${road.renderMs} → ${boat.renderMs} ms`);
  return { road, boat };
}

/* ── run ──────────────────────────────────────────────────────────────────── */
async function main() {
  console.log(`playtest against ${BASE} (only: ${ONLY})`);
  const FIX = findFixture(20260726);
  console.log(`fixture: road (${FIX.road.x}, ${FIX.road.z}) → water (${FIX.water.x}, ${FIX.water.z}) depth ${FIX.water.depth} m; gem ${FIX.gem ? `(${FIX.gem.x}, ${FIX.gem.z})` : 'none'} ${FIX.gemDist} m off\n  shore: ${FIX.shoreProfile}`);

  const S = await connect('playtest');
  const out = {};
  try {
    const seedOk = await (async () => {
      await navigateFresh(S, `${BASE}?intro=off`);
      return await S.evalJs(`window.WANDEROAD.SEED`);
    })();
    check('page world seed matches the fixture seed', seedOk === FIX.seed, `page ${seedOk} vs fixture ${FIX.seed}`);

    if (ONLY === 'smoke') await testSmoke(S);
    if (ONLY === 'all' || ONLY === 'road') out.road = await testRoad(S, FIX);
    if (ONLY === 'all' || ONLY === 'barrier') out.barrier = await testBarrier(S, FIX);
    if (ONLY === 'all' || ONLY === 'voyage') out.voyage = await testVoyage(S, FIX);
    if (ONLY === 'all' || ONLY === 'unlock') out.unlock = await testUnlock(S, FIX);
    if (ONLY === 'all' || ONLY === 'look') await testLook(S, FIX);
    if (ONLY === 'all' || ONLY === 'foam') out.foam = await testFoam(S, FIX);
    if (ONLY === 'all' || ONLY === 'perf') out.perf = await testPerf(S, FIX);
  } catch (e) {
    console.error('\nPLAYTEST CRASHED:', e && e.stack ? e.stack : e);
    results.push({ name: 'harness completed', ok: false, detail: String(e && e.message ? e.message : e) });
  }

  const errs = S.logs.filter((l) => l.level === 'error' || l.level === 'exception');
  console.log(`\npage errors: ${errs.length}`);
  for (const e of errs.slice(0, 10)) console.log(`   [${e.level}] ${e.text.slice(0, 220)}`);
  check('no console errors or exceptions on the page', errs.length === 0, `${errs.length} logged`);

  S.ws.close();
  S.chrome.kill();

  const bad = results.filter((r) => r.ok === false);
  console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
  if (bad.length) {
    console.log('FAILURES:');
    for (const b of bad) console.log(`  - ${b.name} — ${b.detail}`);
  }
  console.log('\nJSON ' + JSON.stringify({ out, results }));
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
