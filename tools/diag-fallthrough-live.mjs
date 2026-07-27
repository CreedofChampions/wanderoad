/* Wanderoad — "am I falling through the road?", measured IN THE BROWSER, against the
 * triangles that were actually drawn.
 *
 * tools/diag-fallthrough.mjs answers this in node. It is a good check and it comes back
 * almost clean, but it cannot see the thing the operator is playing: in node the "ground"
 * is Terrain.height(), a continuous function. On screen the ground is a MESH, built in
 * src/world/chunkWorker.js at whatever quadtree level the streamer had ready at that moment,
 * and a mesh is a piecewise-linear approximation of that function. Where the two disagree —
 * a coarse chunk that has not been replaced by a fine one yet, a chunk that arrived late —
 * the car stands on the function while the player looks at the triangles. That is a car
 * falling through a surface that is visibly there, and no node harness can ever see it.
 *
 * So this one raycasts. Straight down, every frame, against:
 *   - the 'terrain' group (the streamer's worker-built chunk meshes)
 *   - the 'roads' group  (render/road.js's ribbon)
 * and compares the first thing it hits with where the car's bodywork floor actually is.
 *
 *   VISIBLE FALL   the car's floor is more than BODY_THRESH below the nearest drawn surface
 *                  above it — i.e. the player can see the car inside/under the road.
 *   MESH GAP       |drawn terrain - car's own Terrain.height()|. This is the root-cause
 *                  number for the worker-vs-car disagreement, reported whether or not it is
 *                  large enough to become a fall.
 *
 * The car is driven by the game's own autopilot, in the real game loop, with real streaming.
 *
 *   node tools/diag-fallthrough-live.mjs [url] [--secs 300] [--runs 1] [--keep]
 *
 * Read-only: it drives and it measures, it never patches the game.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? +argv[i + 1] : d;
};
const URL_UNDER_TEST = argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const SECS = opt('secs', 300);
const RUNS = opt('runs', 1);
/* The autopilot picks its own cruise (11–22 m/s, src/car/autopilot.js) and settles around
 * 35 km/h on roads that now curve as hard as these do. A player does not. `--cruise 22` holds
 * it at the top of the range the game itself allows, which is the version of this test that
 * can actually outrun the streamer — and outrunning the streamer is the only mechanism by
 * which the car could stand on ground that has not been meshed yet. 0 = leave it alone. */
const CRUISE = opt('cruise', 0);
/* `--manual` drives it the way a player who is enjoying themselves drives it: throttle pinned,
 * no autopilot, 130 km/h down whatever is in front. The autopilot cannot produce that, and
 * speed is the only thing that can make the car arrive somewhere the streamer has not meshed
 * yet — which is the one remaining mechanism for standing on ground that is not drawn. */
const MANUAL = argv.includes('--manual');
const SHOTS = resolve('shots/fallthrough');
const PORT = 9400 + (process.pid % 300);

/** main.js: model.group.position.y = car.y - 0.36. That is where the bodywork floor is. */
const MODEL_DROP = 0.36;
/** Suspension travel is 0.22 m (car/tuning.js); 0.3 m past full travel is a hole, not damping.
 *  Same numbers tools/diag-fallthrough.mjs uses, so the two are directly comparable. */
const BODY_THRESH = 0.52;

/* ── CDP plumbing (same shape as tools/browser-test.mjs) ─────────────────── */

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
      '--user-data-dir=' + resolve('.chrome-fallthrough'),
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
      logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push(`EXCEPTION ${d.text} ${d.exception?.description || ''}`.slice(0, 300));
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
    const p = resolve(SHOTS, `${name}.png`);
    writeFileSync(p, Buffer.from(s.result.data, 'base64'));
    return p;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { chrome, ws, send, evalJs, shot, logs };
}

const KEY = (code, type) =>
  `window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true, cancelable: true }))`;
const tap = async (evalJs, code) => {
  await evalJs(KEY(code, 'keydown'));
  await sleep(60);
  await evalJs(KEY(code, 'keyup'));
};

/* ── the in-page sampler ─────────────────────────────────────────────────────
 * Installed once, runs on its own rAF so it samples AFTER the game's frame has moved the car
 * and the streamer has swapped in whatever chunks arrived. Everything it reports is read from
 * the live scene graph; nothing is recomputed from worldgen.
 */
const INSTALL_SAMPLER = `(() => {
  const W = window.WANDEROAD, T = window.THREE;
  if (!W || !T) return { ok: false, why: 'no WANDEROAD/THREE' };
  if (window.__ftl) return { ok: true, already: true };

  const scene = W.scene;
  const terrainGroup = scene.getObjectByName('terrain');
  const roadGroup = scene.getObjectByName('roads');
  if (!terrainGroup) return { ok: false, why: 'no terrain group in the scene' };

  const rc = new T.Raycaster();
  rc.far = 600;
  const DOWN = new T.Vector3(0, -1, 0);
  const ORIGIN = new T.Vector3();

  const S = {
    n: 0, dist: 0, px: null, pz: null,
    onRoadFrames: 0,
    fallFrames: 0, fallEvents: [], inFall: false,
    noTerrainHit: 0,
    meshGapWorst: 0, meshGapAt: null, meshGapSum: 0, meshGapN: 0,
    gapOver10: 0, gapOver30: 0, gapOver52: 0,
    worstFall: 0, worstFallAt: null,
    levels: {},
    minFps: 999, fpsN: 0, fpsSum: 0,
    started: performance.now(),
  };
  window.__ftl = S;

  // Only raycast the chunk meshes whose footprint is actually under the car. Refreshed
  // rarely: it is a cost dial, not a measurement.
  let cand = [], candAt = -1e9, candRoad = [];
  const refresh = (x, z) => {
    cand = []; candRoad = [];
    for (const m of terrainGroup.children) {
      if (!m.isMesh || !m.geometry) continue;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere; if (!bs) continue;
      const c = bs.center.clone().applyMatrix4(m.matrixWorld);
      if (Math.hypot(c.x - x, c.z - z) < bs.radius + 140) cand.push(m);
    }
    if (roadGroup) for (const m of roadGroup.children) {
      // the ribbon only: instanced decor in the same group is not a surface you drive on
      if (!m.isMesh || m.isInstancedMesh || !m.geometry) continue;
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
      const bs = m.geometry.boundingSphere; if (!bs) continue;
      const c = bs.center.clone().applyMatrix4(m.matrixWorld);
      if (Math.hypot(c.x - x, c.z - z) < bs.radius + 140) candRoad.push(m);
    }
    candAt = performance.now();
  };

  const tick = () => {
    requestAnimationFrame(tick);
    const car = W.car; if (!car || !isFinite(car.x)) return;
    if (performance.now() - candAt > 400) refresh(car.x, car.z);

    ORIGIN.set(car.x, car.y + 120, car.z);
    rc.set(ORIGIN, DOWN);

    let tY = null, tLevel = null;
    const hitT = rc.intersectObjects(cand, false);
    if (hitT.length) { tY = hitT[0].point.y; tLevel = hitT[0].object.userData && hitT[0].object.userData.level; }
    let rY = null;
    if (candRoad.length) { const h = rc.intersectObjects(candRoad, false); if (h.length) rY = h[0].point.y; }

    S.n++;
    if (S.px !== null) S.dist += Math.hypot(car.x - S.px, car.z - S.pz);
    S.px = car.x; S.pz = car.z;

    if (tY === null) { S.noTerrainHit++; return; }
    if (tLevel !== undefined && tLevel !== null) S.levels[tLevel] = (S.levels[tLevel] || 0) + 1;

    // The car's OWN opinion of the ground, i.e. what the physics stands on.
    const sampY = car.terrain ? car.terrain.height(car.x, car.z) : null;
    if (sampY !== null && isFinite(sampY)) {
      const gap = Math.abs(tY - sampY);
      S.meshGapSum += gap; S.meshGapN++;
      if (gap > 0.10) S.gapOver10++;
      if (gap > 0.30) S.gapOver30++;
      if (gap > 0.52) S.gapOver52++;
      if (gap > S.meshGapWorst) {
        S.meshGapWorst = gap;
        S.meshGapAt = { x: +car.x.toFixed(1), z: +car.z.toFixed(1), mesh: +tY.toFixed(2), sampler: +sampY.toFixed(2), level: tLevel };
      }
    }

    // The drawn surface the car should be sitting on: the road if there is one here, else land.
    const onRoad = rY !== null;
    if (onRoad) S.onRoadFrames++;
    const drawn = onRoad ? Math.max(rY, tY) : tY;
    const floor = car.y - ${MODEL_DROP};
    const under = drawn - floor;

    if (under > ${BODY_THRESH}) {
      S.fallFrames++;
      if (under > S.worstFall) {
        S.worstFall = under;
        S.worstFallAt = { x: +car.x.toFixed(1), z: +car.z.toFixed(1), drawn: +drawn.toFixed(2), floor: +floor.toFixed(2),
          kph: +car.kph.toFixed(0), onRoad, level: tLevel, sampler: sampY === null ? null : +sampY.toFixed(2) };
      }
      if (!S.inFall) {
        S.inFall = true;
        if (S.fallEvents.length < 60)
          S.fallEvents.push({ x: +car.x.toFixed(0), z: +car.z.toFixed(0), under: +under.toFixed(2),
            kph: +car.kph.toFixed(0), onRoad, level: tLevel, km: +(S.dist / 1000).toFixed(2) });
      }
    } else S.inFall = false;
  };
  requestAnimationFrame(tick);
  return { ok: true, terrainChildren: terrainGroup.children.length, roadGroup: !!roadGroup };
})()`;

const READ = `(() => { const S = window.__ftl; if (!S) return null;
  const W = window.WANDEROAD;
  return { n: S.n, km: +(S.dist/1000).toFixed(3), onRoadFrames: S.onRoadFrames,
    fallFrames: S.fallFrames, fallEvents: S.fallEvents, noTerrainHit: S.noTerrainHit,
    meshGapWorst: +S.meshGapWorst.toFixed(3), meshGapAt: S.meshGapAt,
    meshGapMean: S.meshGapN ? +(S.meshGapSum/S.meshGapN).toFixed(4) : null,
    gapOver10: S.gapOver10, gapOver30: S.gapOver30, gapOver52: S.gapOver52,
    worstFall: +S.worstFall.toFixed(2), worstFallAt: S.worstFallAt,
    levels: S.levels, fps: +W.fps().toFixed(0), stats: W.stats(),
    auto: !!(W.auto && W.auto.on), carY: +W.car.y.toFixed(2), kph: +W.car.kph.toFixed(0) };
})()`;

async function main() {
  console.log(`\nWANDEROAD LIVE FALL-THROUGH  ${URL_UNDER_TEST}  ${SECS}s x ${RUNS}\n${'-'.repeat(70)}`);
  const { chrome, ws, evalJs, shot, send, logs } = await connect();
  const all = [];
  try {
    for (let run = 1; run <= RUNS; run++) {
      await send('Page.navigate', { url: URL_UNDER_TEST + (URL_UNDER_TEST.includes('?') ? '&' : '?') + `debug&cheat&seed=${20260726 + (run - 1) * 101}` });
      let booted = false;
      for (let i = 0; i < 45 && !booted; i++) {
        await sleep(1000);
        booted = (await evalJs(`!!(window.WANDEROAD && window.WANDEROAD.car && window.THREE)`)) === true;
      }
      if (!booted) throw new Error('never booted');
      // let the world stream in and the veil lift
      for (let i = 0; i < 30; i++) {
        await sleep(1000);
        if ((await evalJs(`window.WANDEROAD.stats().live > 14`)) === true) break;
      }
      await sleep(2500);

      if (MANUAL) {
        // Throttle down and left there. The keydown also ends the intro, exactly as it does
        // for a player who starts driving instead of watching.
        await evalJs(KEY('KeyW', 'keydown'));
        await sleep(500);
      } else {
        // Skip the intro and switch the autopilot on, exactly as a player would.
        await tap(evalJs, 'KeyG');
        await sleep(500);
        if ((await evalJs(`!!window.WANDEROAD.auto.on`)) !== true) {
          await tap(evalJs, 'KeyG');
          await sleep(400);
        }
      }
      if (CRUISE) await evalJs(`window.WANDEROAD.auto.cruise = ${CRUISE}`);
      const autoOn = await evalJs(`!!window.WANDEROAD.auto.on`);
      const inst = await evalJs(INSTALL_SAMPLER);
      console.log(`run ${run}: auto-drive ${autoOn ? 'ON' : 'OFF'}, cruise ${await evalJs(`+window.WANDEROAD.auto.cruise.toFixed(1)`)} m/s, sampler ${JSON.stringify(inst)}`);

      const t0 = Date.now();
      let lastKm = 0;
      while ((Date.now() - t0) / 1000 < SECS) {
        await sleep(15000);
        // The autopilot re-derives its cruise whenever it is switched back on (a rescue does
        // that), so a forced cruise has to be re-asserted rather than set once.
        if (CRUISE) await evalJs(`window.WANDEROAD.auto.cruise = ${CRUISE}`);
        // A rescue or a menu can eat the keydown; re-assert it so "flat out" stays flat out.
        if (MANUAL) await evalJs(KEY('KeyW', 'keydown'));
        const r = await evalJs(READ);
        if (r) {
          console.log(
            `   ${(((Date.now() - t0) / 1000) | 0).toString().padStart(4)}s  ${r.km.toFixed(2)} km  ` +
              `${r.kph} km/h  fps ${r.fps}  auto ${r.auto}  falls ${r.fallEvents.length}  ` +
              `meshgap worst ${r.meshGapWorst} m  live ${r.stats.live}`
          );
          lastKm = r.km;
        }
      }
      const r = await evalJs(READ);
      await shot(`run${run}-end`);
      all.push(r);
      console.log(`   run ${run} done: ${r.km.toFixed(2)} km, ${r.fallEvents.length} fall events`);
    }

    /* ── report ─────────────────────────────────────────────────────────── */
    let km = 0, ev = 0, frames = 0, onRoad = 0, fallFrames = 0, worst = 0, worstAt = null;
    let gapWorst = 0, gapAt = null, g10 = 0, g30 = 0, g52 = 0, gn = 0, noHit = 0;
    const levels = {};
    for (const r of all) {
      if (!r) continue;
      km += r.km; ev += r.fallEvents.length; frames += r.n; onRoad += r.onRoadFrames;
      fallFrames += r.fallFrames; noHit += r.noTerrainHit;
      g10 += r.gapOver10; g30 += r.gapOver30; g52 += r.gapOver52; gn += r.n;
      if (r.worstFall > worst) { worst = r.worstFall; worstAt = r.worstFallAt; }
      if (r.meshGapWorst > gapWorst) { gapWorst = r.meshGapWorst; gapAt = r.meshGapAt; }
      for (const [k, v] of Object.entries(r.levels)) levels[k] = (levels[k] || 0) + v;
      for (const e of r.fallEvents) console.log(`   FALL  ${e.under} m under at (${e.x},${e.z}) ${e.kph} km/h onRoad ${e.onRoad} lod ${e.level} @${e.km} km`);
    }
    console.log(`\n${'-'.repeat(70)}`);
    console.log(`TOTAL ${km.toFixed(2)} km driven in the browser, ${frames} sampled frames`);
    console.log(`  VISIBLE FALL-THROUGH (floor > ${BODY_THRESH} m under the drawn surface)  ${ev} events = ${(ev / Math.max(km, 1e-3)).toFixed(3)} per km`);
    console.log(`     ${fallFrames} frames = ${((100 * fallFrames) / Math.max(1, frames)).toFixed(3)}% of frames`);
    if (worstAt) console.log(`     worst ${worst} m  ${JSON.stringify(worstAt)}`);
    console.log(`  MESH vs CAR SAMPLER  worst ${gapWorst} m` + (gapAt ? `  ${JSON.stringify(gapAt)}` : ''));
    console.log(`     over 0.10 m ${((100 * g10) / Math.max(1, gn)).toFixed(2)}%   over 0.30 m ${((100 * g30) / Math.max(1, gn)).toFixed(2)}%   over 0.52 m ${((100 * g52) / Math.max(1, gn)).toFixed(2)}%`);
    console.log(`  frames the ray hit no terrain at all: ${noHit}`);
    console.log(`  chunk LOD under the car: ${JSON.stringify(levels)}`);
    console.log(`  on-road frames ${((100 * onRoad) / Math.max(1, frames)).toFixed(1)}%`);
    const errs = logs.filter((l) => /EXCEPTION|error/i.test(l)).slice(0, 8);
    if (errs.length) console.log(`  console errors:\n     ${errs.join('\n     ')}`);
    console.log(`screenshots: ${SHOTS}`);
  } finally {
    if (!argv.includes('--keep')) {
      try { ws.close(); } catch { /* already gone */ }
      chrome.kill();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
