/* Wanderoad — QA phase one-off: does a genuinely COLD page load ever hand you a car sitting
 * in or touching water, measured in a REAL browser rather than a node harness.
 *
 * tools/diag-spawn-water.mjs answers the same question by calling findSpawn() directly in
 * node. That is a good check and it is green, but it can never see the thing the operator
 * plays: the actual boot path in src/main.js, in a real Chrome, with a real module graph,
 * with no shortcuts. "Code existing is not code running" — this is the running-code version.
 *
 * For each seed: a BRAND NEW headless Chrome process with its own --user-data-dir (no shared
 * profile, no cached localStorage/IndexedDB/cache from a previous run — a genuinely cold
 * load), navigate to `${url}?seed=N`, wait for window.WANDEROAD to appear, then read the
 * car's position the moment it does and ask the game's OWN water function
 * (game/rescue.js:waterDepth(), built on world/biomes.js:waterLevelAt(), the one water-height
 * function this game has) whether the ground under the car is wet.
 *
 *   node tools/diag-cold-spawn-live.mjs [url] [--n 25] [--start 1]
 *
 * Exits 1 if any spawn was touching water.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? +argv[i + 1] : d;
};
const URL_UNDER_TEST = argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const N = opt('n', 25);
const START = opt('start', 1);

async function connectFresh(profileDir, port) {
  rmSync(profileDir, { recursive: true, force: true });
  mkdirSync(profileDir, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--window-size=1400,820',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--user-data-dir=' + resolve(profileDir),
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
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
  await send('Runtime.enable');
  await send('Page.enable');
  return { chrome, ws, send, evalJs, logs };
}

/* Polls for boot inside the page itself (cheaper than round-tripping from node every 100ms),
 * then reads the spawn position through the game's OWN water function the instant it can. */
const READ_SPAWN = `(async () => {
  const t0 = performance.now();
  for (let i = 0; i < 300; i++) {
    if (window.WANDEROAD && window.WANDEROAD.car && window.WANDEROAD.car.terrain) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const W = window.WANDEROAD;
  if (!W || !W.car || !W.car.terrain) return { ok: false, why: 'never booted (30s)' };
  const car = W.car;
  let depth = null, err = null;
  try {
    const mod = await import('/src/game/rescue.js');
    const surf = car.terrain.surface(car.x, car.z);
    depth = mod.waterDepth(surf);
    return {
      ok: true,
      seed: W.SEED,
      x: +car.x.toFixed(2), z: +car.z.toFixed(2), y: +car.y.toFixed(2),
      onRoad: +surf.onRoad.toFixed(3),
      dominant: surf.dominant,
      depth: +depth.toFixed(3),
      touching: depth > 0,
      deep: depth > 0.6,
      bootMs: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return { ok: false, why: 'water probe threw: ' + (e && e.message) };
  }
})()`;

async function main() {
  console.log(`\nWANDEROAD COLD-START WATER CHECK  ${URL_UNDER_TEST}  seeds ${START}..${START + N - 1}\n${'-'.repeat(70)}`);
  const results = [];
  for (let i = 0; i < N; i++) {
    const seed = START + i;
    const port = 9700 + (i % 250);
    const dir = resolve(`.chrome-cold-${i % 6}`); // rotate a handful of dirs rather than 25 distinct ones on disk
    let chrome, ws;
    try {
      const conn = await connectFresh(dir, port);
      chrome = conn.chrome;
      ws = conn.ws;
      await conn.send('Page.navigate', { url: `${URL_UNDER_TEST}${URL_UNDER_TEST.includes('?') ? '&' : '?'}seed=${seed}` });
      const r = await conn.evalJs(READ_SPAWN);
      results.push({ seed, ...r });
      if (r && r.ok) {
        console.log(
          `seed ${String(seed).padStart(3)}: ${r.touching ? `WET  depth=${r.depth}m` : 'dry '}  ` +
            `onRoad=${r.onRoad}  biome=${r.dominant}  (${r.x},${r.z})  y=${r.y}  boot=${r.bootMs}ms`
        );
      } else {
        console.log(`seed ${String(seed).padStart(3)}: ERROR ${JSON.stringify(r)}  console=${conn.logs.slice(0, 3).join(' | ')}`);
      }
    } catch (e) {
      results.push({ seed, ok: false, why: String(e && e.message) });
      console.log(`seed ${String(seed).padStart(3)}: LAUNCH ERROR ${e && e.message}`);
    } finally {
      try { ws && ws.close(); } catch { /* already gone */ }
      try { chrome && chrome.kill(); } catch { /* already gone */ }
    }
  }
  for (let k = 0; k < 6; k++) {
    try { rmSync(resolve(`.chrome-cold-${k}`), { recursive: true, force: true }); } catch { /* best effort */ }
  }

  const ok = results.filter((r) => r.ok);
  const wet = ok.filter((r) => r.touching);
  const deep = ok.filter((r) => r.deep);
  const errored = results.filter((r) => !r.ok);
  console.log(`\n${'-'.repeat(70)}`);
  console.log(`COLD-START WATER CHECK: ${results.length} cold loads, ${ok.length} booted cleanly, ${errored.length} errored`);
  console.log(`  TOUCHING WATER (depth > 0):  ${wet.length} / ${ok.length}`);
  console.log(`  DEEP (depth > 0.6 m, the game's own rescue threshold): ${deep.length} / ${ok.length}`);
  for (const w of wet) console.log(`     WET  seed=${w.seed}  depth=${w.depth}m  at (${w.x},${w.z})  onRoad=${w.onRoad}`);
  for (const e of errored) console.log(`     ERR  seed=${e.seed}  ${e.why}`);
  console.log(wet.length === 0 && errored.length === 0 ? '\nALL COLD SPAWNS DRY' : '\nFAIL — see above');
  process.exit(wet.length || errored.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
