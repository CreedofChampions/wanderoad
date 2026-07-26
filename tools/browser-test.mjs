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

    /* Braking. */
    await hold(evalJs, 'KeyW', 3500);
    const fast = await evalJs(`window.WANDEROAD.car.kph`);
    await hold(evalJs, 'KeyS', 2600);
    const slow = await evalJs(`window.WANDEROAD.car.kph`);
    check('S brakes', slow < fast * 0.55, `${fast.toFixed(0)} -> ${slow.toFixed(0)} km/h`);

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
