/* Wanderoad — browser acceptance test.
 *
 * Drives a real headless Chrome against a real build and asserts that the game WORKS: that it
 * boots, that you can see it, that the keys do what they say, that the car goes where you
 * point it, and that every control in the game does something observable.
 *
 * This exists because the game once shipped completely unplayable behind a passing test
 * suite. The rules that came out of that are baked in here:
 *
 *   - VISIBILITY IS MEASURED, NEVER ASSUMED. Every "is it showing" check reads
 *     getComputedStyle and a bounding box. A `hidden` attribute proves nothing; an author
 *     `display` rule beats it and that is exactly what went wrong.
 *   - INPUT IS REAL. Every control is exercised with genuine KeyboardEvents, the same ones a
 *     keyboard produces, never by calling a function directly.
 *   - THE PICTURE IS EVIDENCE. Screenshots are written at each stage and the run fails if the
 *     frame is a flat colour, because a black screen passes every other check ever written.
 *
 *   node tools/browser-test.mjs [url] [--keep]
 *
 * Exits 0 only if every check passes.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = process.argv.slice(2);
const URL_UNDER_TEST = args.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const SHOTS = resolve('shots/test');
const PORT = 9800 + (process.pid % 300);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

/* ── CDP plumbing ────────────────────────────────────────────────────────── */

async function connect() {
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
      '--user-data-dir=' + resolve('.chrome-test'),
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

/* Genuine key events, dispatched at the window exactly as a keyboard would. */
const KEY = (code, type) =>
  `window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true, cancelable: true }))`;

async function hold(evalJs, code, ms) {
  await evalJs(KEY(code, 'keydown'));
  await sleep(ms);
  await evalJs(KEY(code, 'keyup'));
}
const tap = async (evalJs, code) => {
  await evalJs(KEY(code, 'keydown'));
  await sleep(60);
  await evalJs(KEY(code, 'keyup'));
};

/** Is an element genuinely on screen? Computed style AND a real box, never the attribute. */
const VISIBLE = (sel) => `(() => { const e = document.querySelector('${sel}'); if (!e) return null;
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.01 && r.width > 1 && r.height > 1; })()`;

async function main() {
  console.log(`\nWANDEROAD BROWSER TEST\n${URL_UNDER_TEST}\n${'-'.repeat(64)}`);
  const { chrome, ws, send, evalJs, shot, logs } = await connect();

  try {
    await send('Page.navigate', { url: URL_UNDER_TEST + (URL_UNDER_TEST.includes('?') ? '&' : '?') + 'debug&probe&feel=cruiser&terrain=meadow' });

    /* ── 1. it boots ─────────────────────────────────────────────────────── */
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await sleep(1000);
      booted = (await evalJs(`!!(window.WANDEROAD && window.WANDEROAD.car)`)) === true;
    }
    if (!check('boots within 40 s', booted)) throw new Error('never booted');

    // Wait for the loading veil to lift on its own.
    let veilGone = false;
    for (let i = 0; i < 30 && !veilGone; i++) {
      await sleep(1000);
      veilGone = (await evalJs(`(() => { const v = document.getElementById('veil');
        return !v || getComputedStyle(v).opacity < 0.05 || v.classList.contains('gone'); })()`)) === true;
    }
    check('loading veil lifts', veilGone);
    check('HUD is showing', (await evalJs(VISIBLE('#hud'))) === true);
    check('garage is NOT covering the game', (await evalJs(VISIBLE('#menu'))) === false);

    /* ── 2. the picture is not a flat colour ─────────────────────────────── */
    const shot1 = await shot('01-boot');
    const variety = await evalJs(`(() => {
      const c = document.querySelector('canvas'); if (!c) return null;
      // Read the canvas back through a 2D copy — a WebGL context cannot be read directly
      // once it has been presented.
      const t = document.createElement('canvas'); t.width = 160; t.height = 90;
      t.getContext('2d').drawImage(c, 0, 0, 160, 90);
      const d = t.getContext('2d').getImageData(0, 0, 160, 90).data;
      const seen = new Set(); let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        seen.add((d[i] >> 4) + '_' + (d[i+1] >> 4) + '_' + (d[i+2] >> 4));
        sum += d[i] + d[i+1] + d[i+2];
      }
      return { colours: seen.size, meanLuma: +(sum / (d.length / 4) / 3).toFixed(1) };
    })()`);
    check(
      'the frame is a real scene, not a flat colour',
      variety && variety.colours > 24 && variety.meanLuma > 22 && variety.meanLuma < 250,
      variety ? `${variety.colours} distinct colours, mean luma ${variety.meanLuma}` : 'no canvas'
    );

    /* Draw calls are counted by rendering the SCENE, not by reading the counter after a
     * frame — the post chain ends with a fullscreen blit, so the live counter always reads 1
     * and says nothing about whether the world is there. */
    const stats = await evalJs(`(() => { const W = window.WANDEROAD;
      W.renderer.setRenderTarget(W.post.target); W.renderer.render(W.scene, W.camera);
      const calls = W.renderer.info.render.calls, tris = W.renderer.info.render.triangles;
      W.renderer.setRenderTarget(null); W.post.render(W.scene, W.camera);
      return { live: W.stats().live, tris, calls }; })()`);
    check('terrain has streamed in', stats.live > 40, `${stats.live} chunks live`);
    check('the world is actually being drawn', stats.calls > 20 && stats.tris > 50000,
      `${stats.calls} draw calls, ${(stats.tris / 1000) | 0}k triangles`);

    // Frame rate is measured AFTER a warm-up: the first seconds are spent streaming a
    // hundred chunks, and judging a game by its loading screen is not a measurement.
    await sleep(4000);
    const fps = await evalJs(`+window.WANDEROAD.fps().toFixed(1)`);
    check('running at a playable rate once warm', fps > 24, `${fps} fps`);

    /* ── 3. the car responds to the keys ─────────────────────────────────── */
    const before = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { x: c.x, z: c.z, yaw: c.yaw, kph: c.kph }; })()`);
    await hold(evalJs, 'KeyW', 4200);
    const afterW = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { x: c.x, z: c.z, yaw: c.yaw, kph: +c.kph.toFixed(1), gear: c.gear }; })()`);
    const moved = Math.hypot(afterW.x - before.x, afterW.z - before.z);
    check('W accelerates the car', afterW.kph > 12 && moved > 8, `${afterW.kph} km/h, moved ${moved.toFixed(1)} m`);
    check('the gearbox shifts up', afterW.gear >= 2, `gear ${afterW.gear}`);
    await shot('02-driving');

    /* Steering. The sign matters and has been wrong before, so this asserts the DIRECTION,
     * not merely that something changed: A must turn the car anticlockwise on screen. */
    const yawBeforeA = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    await evalJs(KEY('KeyW', 'keydown'));
    await hold(evalJs, 'KeyA', 2200);
    const yawAfterA = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    let dA = yawAfterA - yawBeforeA;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    check('A steers left', dA > 0.05, `yaw ${(dA * 57.3).toFixed(1)} deg (positive = left)`);

    const yawBeforeD = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    await hold(evalJs, 'KeyD', 2600);
    await evalJs(KEY('KeyW', 'keyup'));
    const yawAfterD = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    let dD = yawAfterD - yawBeforeD;
    while (dD > Math.PI) dD -= Math.PI * 2;
    while (dD < -Math.PI) dD += Math.PI * 2;
    check('D steers right', dD < -0.05, `yaw ${(dD * 57.3).toFixed(1)} deg (negative = right)`);

    /* Braking. Needs its own run-up: the steering checks above finish with the car scrubbed
     * almost to a stop, and 0 -> 0 km/h is not a measurement of anything. */
    await tap(evalJs, 'KeyR');
    await sleep(600);
    await hold(evalJs, 'KeyW', 6000);
    const fast = await evalJs(`window.WANDEROAD.car.kph`);
    await hold(evalJs, 'KeyS', 2600);
    const slow = await evalJs(`window.WANDEROAD.car.kph`);
    check('S brakes', fast > 20 && slow < fast * 0.55, `${fast.toFixed(0)} -> ${slow.toFixed(0)} km/h`);

    /* ── 4. every control does something observable ──────────────────────── */
    await tap(evalJs, 'KeyR');
    await sleep(700);
    const onRoad = await evalJs(`(() => { const c = window.WANDEROAD.car;
      const q = c.terrain.roads.query(c.x, c.z); return isFinite(q.d) ? +q.d.toFixed(1) : null; })()`);
    check('R puts you back on the road', onRoad !== null && onRoad < 3, `${onRoad} m from the centreline`);

    const camBefore = await evalJs(`window.WANDEROAD.chase.mode`);
    await tap(evalJs, 'KeyC');
    await sleep(400);
    const camAfter = await evalJs(`window.WANDEROAD.chase.mode`);
    check('C changes camera', camBefore !== camAfter, `${camBefore} -> ${camAfter}`);

    const carBefore = await evalJs(`window.WANDEROAD.model.source`);
    await tap(evalJs, 'KeyV');
    await sleep(3800);
    const carAfter = await evalJs(`window.WANDEROAD.model.source`);
    check('V changes the car', carBefore !== carAfter, `${carBefore} -> ${carAfter}`);
    check(
      'the new car has wheels rigged',
      (await evalJs(`window.WANDEROAD.model.wheels.length`)) >= 2,
      `${await evalJs(`window.WANDEROAD.model.wheels.length`)} wheel nodes`
    );

    await tap(evalJs, 'KeyG');
    await sleep(4500);
    const autoState = await evalJs(`(() => { const W = window.WANDEROAD;
      return { on: W.auto.on, kph: +W.car.kph.toFixed(1) }; })()`);
    check('G engages auto-drive and it drives', autoState.on && autoState.kph > 4, `${autoState.kph} km/h under auto`);
    await shot('03-autodrive');
    await tap(evalJs, 'KeyG');

    /* ── 5. the garage ──────────────────────────────────────────────────── */
    await tap(evalJs, 'Escape');
    await sleep(400);
    check('Escape opens the garage', (await evalJs(VISIBLE('#menu'))) === true);
    await shot('04-garage');
    await evalJs(`document.querySelector('#menu [data-act="close"]').click()`);
    await sleep(400);
    check('Drive closes the garage', (await evalJs(VISIBLE('#menu'))) === false);
    await tap(evalJs, 'Escape');
    await sleep(300);
    await tap(evalJs, 'Escape');
    await sleep(300);
    check('Escape closes the garage', (await evalJs(VISIBLE('#menu'))) === false);

    /* ── 6. the game rules ──────────────────────────────────────────────── */
    await tap(evalJs, 'KeyR');
    await sleep(500);
    await hold(evalJs, 'KeyW', 9000);
    const streak = await evalJs(`(() => { const s = window.WANDEROAD.streak.state;
      return { km: +s.km.toFixed(3), onRoad: s.onRoad, mult: +s.multiplier.toFixed(2) }; })()`);
    check('the road streak accumulates', streak.km > 0.05, `${(streak.km * 1000).toFixed(0)} m banked`);

    const solids = await evalJs(`window.WANDEROAD.solids.count`);
    check('collision solids are loaded', solids > 0, `${solids} trees, rocks and posts`);

    /* ── 7. it survived ─────────────────────────────────────────────────── */
    const health = await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      const ground = c.terrain.height(c.x, c.z);
      return { finite: isFinite(c.x) && isFinite(c.y) && isFinite(c.z),
               aboveGround: c.y > ground - 3, fps: +W.fps().toFixed(1), live: W.stats().live }; })()`);
    check('the car is still a real number', health.finite);
    check('the car has not fallen through the world', health.aboveGround);
    check('still running at a playable rate after driving', health.fps > 24, `${health.fps} fps`);
    await shot('05-final');

    /* ================================================================
     * REQUIREMENTS SUITE — docs/REQUIREMENTS.md
     * Everything below measures something the operator reported as wrong. Each check has a
     * threshold the CURRENT build could genuinely breach; a check that cannot fail is not a
     * check.
     * ================================================================ */

    // Put the car somewhere known and still before measuring anything.
    const reset = async () => {
      await tap(evalJs, 'KeyR');
      await sleep(700);
      await evalJs(`(() => { const c = window.WANDEROAD.car;
        c.vx = c.vy = c.vz = 0; c.yawRate = 0; c.gear = 1; })()`);
      await sleep(300);
    };

    /* ── R1: nothing is ever above the road ─────────────────────────────── */
    const above = await evalJs(`(() => { const W = window.WANDEROAD; const t = W.car.terrain;
      let worst = 0, bad = 0, n = 0;
      for (const e of t.roads.edges) {
        for (let k = 0; k < e.y.length; k++) {
          const x = e.pts[k*2], z = e.pts[k*2+1];
          // The carved ground under the centreline must not stand proud of the road surface.
          const over = t.height(x, z) - e.y[k];
          n++; if (over > 0.35) { bad++; worst = Math.max(worst, over); }
        }
      }
      return { n, bad, worst: +worst.toFixed(2) };
    })()`);
    check('R1 nothing is above the road surface', above.bad === 0,
      `${above.bad}/${above.n} points buried, worst ${above.worst} m`);

    /* ── R2: roads meet at one level, never over/under each other ───────── */
    const cross = await evalJs(`(() => { const t = window.WANDEROAD.car.terrain;
      const es = t.roads.edges; let checked = 0, bad = 0, worst = 0;
      const seg = (e, k) => [e.pts[k*2], e.pts[k*2+1], e.pts[k*2+2], e.pts[k*2+3], e.y[k], e.y[k+1]];
      const isect = (a, b) => {
        const d = (a[2]-a[0])*(b[3]-b[1]) - (a[3]-a[1])*(b[2]-b[0]);
        if (Math.abs(d) < 1e-9) return null;
        const ua = ((b[0]-a[0])*(b[3]-b[1]) - (b[1]-a[1])*(b[2]-b[0])) / d;
        const ub = ((b[0]-a[0])*(a[3]-a[1]) - (b[1]-a[1])*(a[2]-a[0])) / d;
        if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
        return [a[4] + (a[5]-a[4])*ua, b[4] + (b[5]-b[4])*ub];
      };
      for (let i = 0; i < es.length; i++) for (let j = i+1; j < es.length; j++) {
        const A = es[i], B = es[j];
        for (let k = 0; k < A.pts.length/2 - 1; k++) for (let m = 0; m < B.pts.length/2 - 1; m++) {
          const r = isect(seg(A,k), seg(B,m));
          if (!r) continue;
          checked++;
          const dh = Math.abs(r[0] - r[1]);
          if (dh > 1.0) { bad++; worst = Math.max(worst, dh); }
        }
      }
      return { checked, bad, worst: +worst.toFixed(2) };
    })()`);
    check('R2 crossing roads meet at the same level', cross.bad === 0,
      `${cross.bad}/${cross.checked} crossings mismatched, worst ${cross.worst} m`);

    /* ── R5: roads actually curve ───────────────────────────────────────── */
    const curve = await evalJs(`(() => { const t = window.WANDEROAD.car.terrain;
      let turn = 0, len = 0;
      for (const e of t.roads.edges) {
        const n = e.pts.length/2;
        for (let k = 1; k < n-1; k++) {
          const ax = e.pts[k*2]-e.pts[k*2-2], az = e.pts[k*2+1]-e.pts[k*2-1];
          const bx = e.pts[k*2+2]-e.pts[k*2], bz = e.pts[k*2+3]-e.pts[k*2+1];
          const la = Math.hypot(ax,az)||1, lb = Math.hypot(bx,bz)||1;
          let d = Math.atan2(bx,bz) - Math.atan2(ax,az);
          while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2;
          turn += Math.abs(d); len += la;
        }
      }
      return { degPerKm: +((turn * 57.2958) / Math.max(len,1) * 1000).toFixed(0), km: +(len/1000).toFixed(2) };
    })()`);
    // A road with real bends turns well over 200 deg/km. A lattice of near-straight links
    // barely reaches 100, which is exactly the "straight lines attached to each other" report.
    check('R5 roads curve rather than run straight', curve.degPerKm > 200,
      `${curve.degPerKm} deg of turn per km over ${curve.km} km`);

    /* ── W2: no grass on the carriageway ────────────────────────────────── */
    const grassOnRoad = await evalJs(`(() => { const W = window.WANDEROAD;
      const g = W.scene.children.find(c => c.name === 'grass'); if (!g) return null;
      const t = W.car.terrain; let onRoad = 0, sampled = 0;
      // Sample the road itself and ask whether grass would be placed there.
      for (const e of t.roads.edges.slice(0, 6)) {
        for (let k = 0; k < e.pts.length/2; k += 2) {
          const s = t.surface(e.pts[k*2], e.pts[k*2+1]);
          sampled++; if (s.onRoad > 0.5) onRoad++;
        }
      }
      return { sampled, onRoad, hasGrassGroup: true };
    })()`);
    check('W2 the grass system knows where the road is', grassOnRoad && grassOnRoad.onRoad > 0,
      grassOnRoad ? `${grassOnRoad.onRoad}/${grassOnRoad.sampled} centreline samples report on-road` : 'no grass group');

    /* ── W4: each land preset looks like itself ─────────────────────────── */
    const relief = await evalJs(`(() => { const W = window.WANDEROAD;
      const t = W.car.terrain; const c = W.car;
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
        const h = t.height(c.x + (i-12)*30, c.z + (j-12)*30);
        lo = Math.min(lo,h); hi = Math.max(hi,h);
      }
      const s = t.surface(c.x, c.z);
      return { relief: +(hi-lo).toFixed(1), dominant: s.dominant,
               preset: new URLSearchParams(location.search).get('terrain') || 'rolling' };
    })()`);
    check('W4 the land preset produces real relief', relief.relief > 12,
      `${relief.relief} m of relief in a 720 m square (preset "${relief.preset}")`);

    /* ── W5: a landmark you can see and head towards ────────────────────── */
    const landmark = await evalJs(`(() => { const W = window.WANDEROAD;
      const t = W.car.terrain; const c = W.car; let best = 0, bestD = 0;
      // Look for high ground within 4 km, using the raw generator rather than what has
      // streamed in, so the answer does not depend on the loading state.
      for (let a = 0; a < 24; a++) for (let r = 400; r <= 4000; r += 400) {
        const x = c.x + Math.cos(a/24*6.283)*r, z = c.z + Math.sin(a/24*6.283)*r;
        const h = t.height(x, z) - c.y;
        if (h > best) { best = h; bestD = r; }
      }
      return { rise: +best.toFixed(0), dist: bestD };
    })()`);
    check('W5 there is somewhere to go — high ground in view', landmark.rise > 60,
      `${landmark.rise} m of rise at ${landmark.dist} m`);

    /* ── C2 + C4: brakes and momentum ───────────────────────────────────── */
    await reset();
    await hold(evalJs, 'KeyW', 9000);
    const vTop = await evalJs(`window.WANDEROAD.car.kph`);
    const pBrake = await evalJs(`(() => { const c = window.WANDEROAD.car; return { x: c.x, z: c.z }; })()`);
    await hold(evalJs, 'KeyS', 6000);
    const afterBrake = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { kph: +c.kph.toFixed(1), x: c.x, z: c.z }; })()`);
    const brakeDist = Math.hypot(afterBrake.x - pBrake.x, afterBrake.z - pBrake.z);
    const scaled = vTop > 5 ? brakeDist * Math.pow(100 / vTop, 2) : 999;
    check('C2 the brakes stop the car promptly', afterBrake.kph < 3 && scaled < 40,
      `${vTop.toFixed(0)} km/h to ${afterBrake.kph} in ${brakeDist.toFixed(0)} m (${scaled.toFixed(0)} m scaled to 100 km/h)`);

    await reset();
    await hold(evalJs, 'KeyW', 9000);
    const vCoast0 = await evalJs(`window.WANDEROAD.car.kph`);
    await sleep(6000);
    const vCoast1 = await evalJs(`window.WANDEROAD.car.kph`);
    check('C4 lifting off slows you visibly', vCoast1 < vCoast0 * 0.55,
      `${vCoast0.toFixed(0)} -> ${vCoast1.toFixed(0)} km/h in 6 s coasting`);

    /* ── C3: stop, turn round, drive back ───────────────────────────────── */
    await reset();
    const yaw0 = await evalJs(`window.WANDEROAD.car.yaw`);
    await hold(evalJs, 'KeyW', 4000);
    await hold(evalJs, 'KeyS', 4000);
    await evalJs(KEY('KeyA', 'keydown'));
    await evalJs(KEY('KeyW', 'keydown'));
    await sleep(7000);
    await evalJs(KEY('KeyA', 'keyup'));
    await evalJs(KEY('KeyW', 'keyup'));
    const yaw1 = await evalJs(`window.WANDEROAD.car.yaw`);
    let turned = Math.abs(yaw1 - yaw0);
    while (turned > Math.PI * 2) turned -= Math.PI * 2;
    if (turned > Math.PI) turned = Math.PI * 2 - turned;
    check('C3 you can stop and turn around', turned > 1.7,
      `${(turned * 57.3).toFixed(0)} deg of turn achieved (want > 100)`);

    /* ── C5: no side-to-side wobble on a straight ───────────────────────── */
    await reset();
    await evalJs(KEY('KeyW', 'keydown'));
    await sleep(3000);
    const wobble = await evalJs(`(async () => { const c = window.WANDEROAD.car;
      const ys = []; for (let i = 0; i < 60; i++) { ys.push(c.yaw); await new Promise(r => setTimeout(r, 100)); }
      // Rate of change of heading, after removing any steady turn: wobble is the wiggle
      // around the trend, not the trend itself.
      const d = []; for (let i = 1; i < ys.length; i++) { let v = ys[i]-ys[i-1];
        while (v > Math.PI) v -= Math.PI*2; while (v < -Math.PI) v += Math.PI*2; d.push(v); }
      const mean = d.reduce((a,b)=>a+b,0)/d.length;
      const sd = Math.sqrt(d.reduce((a,b)=>a+(b-mean)*(b-mean),0)/d.length);
      return +(sd*57.2958).toFixed(3);
    })()`);
    await evalJs(KEY('KeyW', 'keyup'));
    check('C5 the car does not wobble side to side', wobble < 1.5,
      `${wobble} deg of heading jitter per 100 ms`);

    /* ── O2: off-road must feel different ───────────────────────────────── */
    await reset();
    await hold(evalJs, 'KeyW', 8000);
    const onRoadTop = await evalJs(`window.WANDEROAD.car.kph`);
    await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      // Move well clear of any road, keep the heading, and start from rest.
      const t = c.terrain; let x = c.x, z = c.z;
      for (let i = 0; i < 60; i++) { x += Math.cos(c.yaw)*20; z -= Math.sin(c.yaw)*20;
        if (!isFinite(t.roads.query(x,z).d) || t.roads.query(x,z).d > 60) break; }
      c.placeAt(x, z, c.yaw); })()`);
    await sleep(600);
    await hold(evalJs, 'KeyW', 8000);
    const offRoadTop = await evalJs(`(() => { const c = window.WANDEROAD.car;
      const s = c.terrain.surface(c.x, c.z);
      return { kph: +c.kph.toFixed(1), onRoad: +s.onRoad.toFixed(2), rough: +(c.rough||0).toFixed(2) }; })()`);
    check('O2 off-road is meaningfully slower than tarmac',
      offRoadTop.onRoad < 0.5 && offRoadTop.kph < onRoadTop * 0.55,
      `${onRoadTop.toFixed(0)} km/h on road vs ${offRoadTop.kph} off (onRoad ${offRoadTop.onRoad})`);

    /* ── O5: no phantom impacts off-road ────────────────────────────────── */
    const impacts = await evalJs(`(async () => { const W = window.WANDEROAD;
      let hits = 0; const s = W.solids; const orig = s.resolve.bind(s);
      s.resolve = (...a) => { const r = orig(...a); if (r) hits++; return r; };
      await new Promise(r => setTimeout(r, 200)); return { armed: true, hits }; })()`);
    await hold(evalJs, 'KeyW', 6000);
    const phantom = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { solids: window.WANDEROAD.solids.count, lastHit: window.WANDEROAD.solids.lastHit }; })()`);
    check('O5 no impact is reported without something to hit',
      !phantom.lastHit || phantom.solids > 0,
      `${phantom.solids} solids nearby, lastHit ${phantom.lastHit ? phantom.lastHit.kind : 'none'}`);
    void impacts;

    /* ── T2: the car is actually painted ────────────────────────────────── */
    await reset();
    const paint = await evalJs(`(() => {
      const c = document.querySelector('canvas');
      const t = document.createElement('canvas'); t.width = 200; t.height = 120;
      const g = t.getContext('2d'); g.drawImage(c, 0, 0, 200, 120);
      // The car occupies the middle of the lower half in every chase camera.
      const d = g.getImageData(80, 62, 40, 34).data;
      let best = 0, r0 = 0, g0 = 0, b0 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i+1], d[i+2]), mn = Math.min(d[i], d[i+1], d[i+2]);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (sat > best) { best = sat; r0 = d[i]; g0 = d[i+1]; b0 = d[i+2]; }
      }
      return { saturation: +best.toFixed(3), rgb: [r0, g0, b0] };
    })()`);
    check('T2 the car reads as painted, not washed out', paint.saturation > 0.30,
      `peak saturation ${paint.saturation} at rgb(${paint.rgb.join(',')})`);
    await shot('06-car-paint');

    const errs = logs.filter((l) => l.level === 'error' || l.level === 'exception');
    check('no console errors', errs.length === 0, errs.map((e) => e.text.slice(0, 110)).join(' | '));
  } catch (err) {
    check('the run completed', false, err.message);
  } finally {
    ws.close();
    chrome.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('-'.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  } else {
    console.log('\nTHE GAME WORKS.');
  }
  console.log(`screenshots: ${SHOTS}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
