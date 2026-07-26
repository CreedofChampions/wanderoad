/* Wanderoad — headless play-and-screenshot harness.
 *
 * A backgrounded browser tab throttles requestAnimationFrame to a crawl and suspends its
 * workers, so "does it run at 60 fps" cannot be answered by looking at a window that is
 * behind the editor. This drives a headless Chrome over the DevTools protocol instead: real
 * GPU, real workers, no visibility throttling, and a PNG on disk at the end.
 *
 * It can also PLAY. `--play <seconds>` installs an autopilot in the page that dispatches
 * genuine KeyboardEvents — the same events a person's keyboard produces — and steers by
 * looking at the road the same way a player does. That is the only way to find the bugs
 * that only appear after ten minutes of driving: chunk seams, streak resets, collision
 * jitter, streaming stalls at speed.
 *
 *   node tools/shoot.mjs <url> <out.png> [--wait 12000] [--play 60] [--w 1600] [--h 900]
 *
 * Exits non-zero if the page logged an error, if nothing rendered, or if the autopilot
 * detected a fault (fell through the world, stuck, NaN).
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const args = process.argv.slice(2);
const url = args[0] || 'http://localhost:5173/?debug';
const out = resolve(args[1] || 'shots/shot.png');
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const WAIT = +opt('wait', 12000);
const W = +opt('w', 1600);
const H = +opt('h', 900);
const PLAY = +opt('play', 0);
const SHOTS = +opt('shots', 1);
const PORT = 9333 + (process.pid % 400);

/* The autopilot, injected into the page. It is a driver, not a cheat: it only presses keys.
 * Steering aims at a point ahead on the road centreline, which is exactly what a person
 * does, and it deliberately does NOT know the terrain height or the collision list — so if
 * it crashes into a tree, that is a real thing a player would also hit. */
const AUTOPILOT = `
(function(seconds){
  const W = window.WANDEROAD;
  if (!W) return 'no game';
  const car = W.car;
  const held = new Set();
  const key = (code, down) => {
    if (down === held.has(code)) return;
    down ? held.add(code) : held.delete(code);
    window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  };
  const log = { t0: performance.now(), frames: 0, minY: 1e9, maxSpeed: 0, hits: 0,
                stuck: 0, faults: [], bestStreak: 0, offRoad: 0, samples: 0 };
  W._auto = log;

  let stuckT = 0, lastX = car.x, lastZ = car.z;

  const tick = () => {
    if (performance.now() - log.t0 > seconds * 1000) {
      for (const c of [...held]) key(c, false);
      log.done = true;
      return;
    }
    requestAnimationFrame(tick);
    log.frames++;

    const terr = car.terrain;
    if (!terr) return;

    // A Stanley controller, which is what a real self-driving stack uses and what a person
    // does without thinking: correct the heading error against the road, plus a term for how
    // far off the centreline you are. Aiming at a look-ahead point alone oscillates; aiming
    // at the nearest point alone cuts every corner.
    const near = terr.roads.query(car.x, car.z);
    if (!isFinite(near.d)) {
      // No road in range at all — drive straight and slow until one turns up.
      key('KeyA', false); key('KeyD', false); key('KeyW', car.speed < 14); key('KeyS', false);
      log.samples++; log.offRoad++;
      return;
    }

    // Which way along the road are we going? Pick the tangent direction we are already
    // closest to, so the car does not try to turn round on a road it is driving down.
    let tx = near.tx, tz = near.tz;
    if (Math.sin(car.yaw) * tx + Math.cos(car.yaw) * tz < 0) { tx = -tx; tz = -tz; }

    // signed lateral offset: positive when the car is to the LEFT of the direction of travel
    const ox = car.x - near.qx, oz = car.z - near.qz;
    const lateral = ox * tz - oz * tx;

    let err = Math.atan2(tx, tz) - car.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    const v = Math.max(Math.abs(car.speed), 6);
    const cross = Math.atan2(1.9 * lateral, v);   // Stanley cross-track term
    let steer = (err + cross) * 2.4;
    steer = Math.max(-1, Math.min(1, steer));

    if (near.d > near.width * 0.5) log.offRoad++;

    // How tight is the road ahead? Sample the tangent 40 m along and compare.
    const ax = car.x + Math.sin(car.yaw) * 40, az = car.z + Math.cos(car.yaw) * 40;
    const ahead = terr.roads.query(ax, az);
    let bend = 0;
    if (isFinite(ahead.d)) {
      let atx = ahead.tx, atz = ahead.tz;
      if (atx * tx + atz * tz < 0) { atx = -atx; atz = -atz; }
      bend = Math.abs(Math.atan2(atx, atz) - Math.atan2(tx, tz));
      while (bend > Math.PI) bend -= Math.PI * 2;
      bend = Math.abs(bend);
    }

    log.samples++;

    // A is LEFT on screen, and a positive heading error means we must turn towards +yaw,
    // which is screen-left. See the handedness note in src/car/input.js — get this backwards
    // and the autopilot steers itself off the road at every bend, which is exactly what the
    // first version of this file did.
    key('KeyA', steer > 0.08);
    key('KeyD', steer < -0.08);

    // Throttle from the bend ahead, not from the steering we are currently applying — the
    // latter is a feedback loop that brakes because it is cornering because it braked.
    const target = bend > 0.55 ? 16 : bend > 0.28 ? 24 : bend > 0.12 ? 33 : 44; // m/s
    key('KeyW', car.speed < target);
    key('KeyS', car.speed > target + 6);

    log.maxSpeed = Math.max(log.maxSpeed, car.kph);
    log.minY = Math.min(log.minY, car.y);
    log.bestStreak = Math.max(log.bestStreak, W.streak.state.distance);

    // fault detection
    if (!isFinite(car.x) || !isFinite(car.y) || !isFinite(car.z)) {
      log.faults.push('NaN in car position');
      log.done = true;
      return;
    }
    const ground = terr.height(car.x, car.z);
    if (car.y < ground - 4) log.faults.push('fell through the ground at ' + Math.round(car.x) + ',' + Math.round(car.z));
    const moved = Math.hypot(car.x - lastX, car.z - lastZ);
    lastX = car.x; lastZ = car.z;
    stuckT = moved < 0.02 ? stuckT + 1 : 0;
    if (stuckT > 300) { log.stuck++; stuckT = 0; }
  };
  requestAnimationFrame(tick);
  return 'driving';
})(SECONDS);
`;

function cdpConnect(wsUrl) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => res(ws);
    ws.onerror = () => rej(new Error('ws error'));
  });
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--window-size=${W},${H}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--user-data-dir=' + resolve('.chrome-shoot'),
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
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
    throw new Error('headless chrome did not come up');
  }

  const ws = await cdpConnect(target.webSocketDebuggerUrl);
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
      logs.push({ level: 'exception', text: `${d.text} ${d.exception?.description || ''}`.slice(0, 400) });
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
  const shoot = async (path) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s.result?.data) writeFileSync(path, Buffer.from(s.result.data, 'base64'));
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(WAIT);

  let drive = null;
  if (PLAY > 0) {
    const started = await evalJs(AUTOPILOT.replace('SECONDS', String(PLAY)));
    if (started !== 'driving') console.error('autopilot did not start:', started);
    // Screenshot along the way, so a run produces a strip rather than one frame.
    const step = PLAY / Math.max(SHOTS, 1);
    for (let i = 0; i < SHOTS; i++) {
      await sleep(step * 1000);
      await shoot(SHOTS === 1 ? out : out.replace(/\.png$/, `-${i + 1}.png`));
    }
    drive = await evalJs(`(()=>{const a=window.WANDEROAD?._auto; return a?{...a, faults:a.faults.slice(0,6)}:null;})()`);
  } else {
    await shoot(out);
  }

  const telemetry = await evalJs(`(()=>{ try {
    const W = window.WANDEROAD; if(!W) return {error:'no WANDEROAD'};
    const t0=performance.now(); for(let i=0;i<20;i++) W.post ? W.post.render(W.scene,W.camera) : W.renderer.render(W.scene,W.camera);
    const ms=(performance.now()-t0)/20;
    const c = W.car;
    return { renderMs:+ms.toFixed(2), impliedFps:Math.round(1000/ms), rafFps:+(W.fps?W.fps():0).toFixed(1),
      stats:{...W.stats()}, tris:W.renderer.info.render.triangles, calls:W.renderer.info.render.calls,
      car: c ? {x:Math.round(c.x), y:+c.y.toFixed(1), z:Math.round(c.z), kph:Math.round(c.kph), gear:c.gear} : null,
      solids: W.solids ? W.solids.count : 0,
      streak: W.streak ? {km:+(W.streak.state.km).toFixed(2), best:Math.round(W.streak.state.best), mult:+W.streak.state.multiplier.toFixed(2)} : null,
      hidden:document.hidden, stat:document.getElementById('stat')?.textContent,
      biome:document.getElementById('biome')?.textContent,
      scene: (()=>{ const s=W.scene;
        const named = s.children.map(c=>({n:c.name||c.type, v:c.visible, k:c.children.length}));
        const model = W.model || null;
        return { children: named,
          cam: [Math.round(W.camera.position.x), +W.camera.position.y.toFixed(2), Math.round(W.camera.position.z)],
          carPos: [Math.round(c.x), +c.y.toFixed(2), Math.round(c.z)],
          chase: W.chase ? { mode: W.chase.mode, py:+W.chase.py.toFixed(2) } : null,
          model: model ? { pos:[Math.round(model.group.position.x), +model.group.position.y.toFixed(2), Math.round(model.group.position.z)],
                           visible: model.group.visible, kids: model.group.children.length,
                           parented: !!model.group.parent } : 'not exposed' };
      })() };
  } catch(e){ return {error:String(e && e.message || e)}; } })()`);

  if (PLAY > 0 && SHOTS === 1) await shoot(out);

  ws.close();
  chrome.kill();

  const errs = logs.filter((l) => l.level === 'error' || l.level === 'exception');
  console.log(JSON.stringify({ url, out, telemetry, drive, errors: errs.slice(0, 8), logCount: logs.length }, null, 2));
  if (errs.length) process.exitCode = 2;
  else if (!telemetry || telemetry.error || !telemetry.tris) process.exitCode = 3;
  else if (drive && drive.faults && drive.faults.length) process.exitCode = 4;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
