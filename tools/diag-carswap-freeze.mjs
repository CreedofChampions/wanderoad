// created by AI
/* Wanderoad — car-swap freeze diagnostic.
 *
 * Swapping cars in the garage — the Bubble microcar for the Hatch and back — used to freeze the
 * tab. The cost was never the swap itself; it was three.js's own `debug.checkShaderErrors`,
 * which is on by default and reads back `getProgramInfoLog` after every shader link. That
 * readback forces the GPU driver to FINISH compiling right now, synchronously, on the main
 * thread it shares with the game loop. Measured live on the beta (GTX 1060, ANGLE D3D11):
 * roughly a second blocked per swap direction (978 ms one way, 949 ms the other) — and twice
 * out of five runs the readback never returned at all. Not a slow frame: a permanently wedged
 * tab, because a context loss mid-compile does not hand the main thread back.
 *
 * The fix is two halves, both in src/main.js: `checkShaderErrors` gated to dev builds only (a
 * production build never pays for the readback), and the incoming car's programs warmed with
 * `renderer.compileAsync` — off the main thread, while the OLD car keeps drawing — before it
 * ever enters the scene. A `carSwapBusy` latch guards the gap `await` leaves open so two swaps
 * cannot race each other into the same `model` variable. This file exists to keep all three
 * honest after the next edit lands near them, the way tools/diag-collide.mjs keeps the tree
 * colliders honest after the next edit near theirs.
 *
 * SECTION 1 reads src/main.js as text and checks the fix is actually there, in the right order.
 * No renderer, no server, no Chrome — it always runs, and it is the only section a check of
 * this file's own diff can rely on.
 *
 * SECTION 2 drives a real headless Chrome through eight swaps (four Bubble-to-Hatch-and-back
 * pairs) against a real build and measures what SECTION 1 can only take on faith: that nothing
 * hangs, that the car on screen actually changes, and that the shader-compile bill stays small.
 * It needs something to point the browser at — either
 *
 *   npm run build && npm run preview
 *
 * (served at :4173, which this looks for by default) or a URL passed on the command line, e.g.
 * the live beta. Without either it prints why it is skipping and leaves SECTION 1 as the whole
 * answer.
 *
 *   node tools/diag-carswap-freeze.mjs [url]
 *
 * Exits 0 only if every check that ran passed.
 */

import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

console.log(`\nWANDEROAD CAR-SWAP FREEZE DIAGNOSTIC\n${'-'.repeat(64)}`);

/* ══════════════════════ SECTION 1 — source scan, no browser ══════════════════════ */
console.log('\n-- section 1: src/main.js, read as text --');

const MAIN_JS = resolve('src/main.js');
let src = '';
try {
  src = readFileSync(MAIN_JS, 'utf8');
} catch (err) {
  console.log(` note   could not read ${MAIN_JS}: ${err.message} — the checks below will fail`);
}

check(
  'a) checkShaderErrors is gated to dev builds',
  src.includes('renderer.debug.checkShaderErrors = import.meta.env.DEV'),
  'reading a shader program\'s info log forces the driver to finish compiling synchronously; ' +
    'this line is what keeps a production build from ever paying for that readback'
);

/* `indexOf` rather than a regex: the ORDER is the whole bug. compileAsync warms the incoming
 * car's programs off the main thread; if the old car is torn out of the scene first, there is
 * nothing left drawing while that warm-up runs and the stall is back, just moved a few lines. */
const COMPILE_CALL = 'renderer.compileAsync(next.group, camera, scene)';
const SCENE_REMOVE = 'scene.remove(model.group)';
const compileAt = src.indexOf(COMPILE_CALL);
const removeAt = src.indexOf(SCENE_REMOVE);
check(
  'b) the incoming car is warmed with compileAsync before it enters the scene',
  compileAt !== -1 && removeAt !== -1 && compileAt < removeAt,
  compileAt === -1
    ? `not found: ${COMPILE_CALL}`
    : removeAt === -1
      ? `not found: ${SCENE_REMOVE}`
      : compileAt < removeAt
        ? `compileAsync at char ${compileAt}, scene.remove at char ${removeAt} — correct order`
        : `scene.remove at char ${removeAt} comes BEFORE compileAsync at char ${compileAt} — ` +
          'the new car would enter the scene uncompiled and pay the bill on the first painted frame'
);

const busyHits = src.split('carSwapBusy').length - 1;
check(
  'c) a carSwapBusy guard exists against overlapping swaps',
  busyHits >= 4,
  `carSwapBusy appears ${busyHits} time${busyHits === 1 ? '' : 's'} in src/main.js (need >= 4: ` +
    'declare, check, set busy, clear busy)'
);

const section1Pass = results.every((r) => r.ok);
console.log(`-- section 1: ${results.filter((r) => r.ok).length}/${results.length} passed --`);

/* ══════════════════════ SECTION 2 — live browser measurement ══════════════════════ */

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const argv = process.argv.slice(2);
const URL_ARG = argv.find((a) => a.startsWith('http'));
const DEFAULT_URL = 'http://localhost:4173/';

async function serverIsUp(url) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

/* GL timing spy and longtask observer — copied from carswap/repro-time.mjs, the harness that
 * first measured this freeze on the live beta. Unchanged: the same wrapped calls, the same
 * >1ms floor for a GL call worth recording, the same longtask PerformanceObserver, the same
 * `mark` field so a call or a task can be pinned on the swap that caused it. */
const SPY = `(() => {
  if (window.__t) return 'on';
  window.__t = { calls: [], mark: '' };
  const wrap = (proto, name) => {
    const orig = proto[name];
    proto[name] = function (...args) {
      const t0 = performance.now();
      const r = orig.apply(this, args);
      const ms = performance.now() - t0;
      if (ms > 1) window.__t.calls.push({ op: name, ms: Math.round(ms * 10) / 10, at: window.__t.mark });
      return r;
    };
  };
  for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    for (const n of ['compileShader', 'linkProgram', 'getProgramInfoLog', 'getShaderInfoLog', 'getProgramParameter', 'getShaderParameter']) wrap(P, n);
  }
  window.__t.long = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__t.long.push({ ms: Math.round(e.duration), at: window.__t.mark });
  }).observe({ entryTypes: ['longtask'] });
  return 'spy on';
})()`;

async function main() {
  let baseUrl = URL_ARG;
  if (!baseUrl && (await serverIsUp(DEFAULT_URL))) baseUrl = DEFAULT_URL;

  if (!baseUrl) {
    console.log(' SKIP browser section — no server');
    console.log('  (pass a URL, or: npm run build && npm run preview)');
    process.exit(section1Pass ? 0 : 1);
  }

  console.log('\n-- section 2: live browser measurement --');
  /* `intro=off` is the game's own switch (see tools/diag-twowindows.mjs's lesson): skipping the
   * cinematic with a keypress is a race, and while `cine.active` the garage key is IGNORED
   * (main.js gates menu.toggle on it) — the first version of this diag clicked at nothing. */
  const TEST_URL = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'fresh=1&unlock=123&intro=off';
  const PORT = 9600 + (process.pid % 90);
  const PROFILE_DIR = resolve('tools/.chrome-swapdiag');
  mkdirSync(PROFILE_DIR, { recursive: true });

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1280,760',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      `--user-data-dir=${PROFILE_DIR}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  process.on('exit', () => {
    try {
      chrome.kill();
    } catch {
      /* already gone */
    }
  });

  let ws;
  let seq = 0;
  const pending = new Map();

  async function connect() {
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        const target = list.find((t) => t.type === 'page');
        if (target) {
          ws = new WebSocket(target.webSocketDebuggerUrl);
          await new Promise((res, rej) => {
            ws.onopen = res;
            ws.onerror = rej;
          });
          ws.onmessage = (m) => {
            const msg = JSON.parse(m.data);
            if (msg.id && pending.has(msg.id)) {
              pending.get(msg.id)(msg);
              pending.delete(msg.id);
            }
          };
          return true;
        }
      } catch {
        /* not up yet */
      }
      await sleep(500);
    }
    return false;
  }

  function send(method, params = {}, timeoutMs = 12000) {
    const id = ++seq;
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`CDP_TIMEOUT ${method}`));
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(t);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  const evaluate = async (expr, timeoutMs = 8000) =>
    (await send('Runtime.evaluate', { expression: expr, returnByValue: true }, timeoutMs)).result?.value;
  async function key(code, k, vk) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk });
    await sleep(70);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  }
  async function clickAt(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /* Escape opens the garage; click the requested car's tile. Copied from carswap/repro-time.mjs,
   * the harness that already proved this recipe swaps a real car on the real beta. */
  async function swapVia(carId) {
    await key('Escape', 'Escape', 27);
    await sleep(700);
    const rect = await evaluate(
      `(() => { const b = document.querySelector('[data-group="car"] button[data-key="${carId}"]'); if (!b) return null; b.scrollIntoView({block:'center'}); const r = b.getBoundingClientRect(); return r.width ? JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)}) : null; })()`,
      6000
    );
    if (!rect) {
      await key('Escape', 'Escape', 27);
      await sleep(300);
      return false;
    }
    const { x, y } = JSON.parse(rect);
    await clickAt(x, y);
    return true;
  }

  try {
    console.log(`connecting to headless Chrome on :${PORT}`);
    if (!(await connect())) {
      check('headless Chrome came up', false, `no CDP target on port ${PORT} after 30 s`);
      return;
    }
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: TEST_URL });
    console.log('navigated:', TEST_URL);

    let booted = false;
    for (let i = 0; i < 60 && !booted; i++) {
      try {
        booted = (await evaluate(`!!(window.WANDEROAD && document.querySelector('canvas'))`, 4000)) === true;
      } catch {
        /* not yet */
      }
      if (!booted) await sleep(1000);
    }
    if (!check('the game boots (WANDEROAD + canvas within 60 s)', booted)) return;

    await sleep(5000); // let the world stream in before anything is measured

    console.log('spy:', await evaluate(SPY, 5000));

    const PAIRS = 5;
    const sequence = [];
    for (let i = 1; i <= PAIRS; i++) {
      sequence.push({ tag: `p${i}:microcar`, carId: 'microcar' });
      sequence.push({ tag: `p${i}:hatch`, carId: 'hatch' });
    }

    let hang = null;
    const swaps = [];
    for (const step of sequence) {
      if (hang) break;
      try {
        await evaluate(`window.__t.mark = ${JSON.stringify(step.tag)}; 1`, 6000);
        const clicked = await swapVia(step.carId);
        await sleep(1500); // settle
        // THE HANG PROBE. If the main thread is wedged behind a synchronous compile, this
        // Runtime.evaluate never comes back and send()'s own timer rejects with CDP_TIMEOUT —
        // the same failure mode measured live: "the readback never returned at all".
        await evaluate('1', 6000);
        const name = await evaluate(
          `(window.WANDEROAD.model && window.WANDEROAD.model.group && window.WANDEROAD.model.group.name) || null`,
          6000
        );
        swaps.push({ tag: step.tag, carId: step.carId, clicked, name, expect: `car:${step.carId}` });
        console.log(`  ${step.tag.padEnd(14)} clicked ${String(clicked).padEnd(5)} group.name ${name}`);
      } catch (e) {
        hang = { tag: step.tag, message: e.message, isTimeout: /CDP_TIMEOUT/.test(e.message) };
        swaps.push({ tag: step.tag, carId: step.carId, clicked: null, name: null, expect: `car:${step.carId}`, error: e.message });
        console.log(`  ${step.tag}: HUNG — ${e.message}`);
      }
    }

    check(
      'd) no hang: every swap probe returned',
      hang === null,
      hang
        ? hang.isTimeout
          ? `main thread hung during swap (${hang.tag}): ${hang.message}`
          : `swap (${hang.tag}) errored, not a timeout: ${hang.message}`
        : `${swaps.length} swaps, every probe returned inside its timeout`
    );

    const completed = swaps.filter((s) => !s.error);
    const mismatched = completed.filter((s) => s.name !== s.expect);
    check(
      'e) the car really changes on every swap',
      completed.length === sequence.length && mismatched.length === 0,
      completed.length !== sequence.length
        ? `only ${completed.length}/${sequence.length} swaps completed (see check d); ` +
          `of those, ${mismatched.length} did not flip`
        : mismatched.length
          ? `${mismatched.length}/${completed.length} swap(s) did not flip: ` +
            mismatched.map((s) => `${s.tag} wanted ${s.expect}, saw ${s.name}`).join('; ')
          : `${completed.length}/${completed.length} swaps flipped model.group.name correctly ` +
            '(car:microcar / car:hatch)'
    );

    let calls = [];
    let long = [];
    try {
      const data = await evaluate(`JSON.stringify({ calls: window.__t.calls, long: window.__t.long })`, 6000);
      ({ calls, long } = JSON.parse(data));
    } catch (e) {
      console.log(`  (could not read the spy back after the run: ${e.message})`);
    }

    console.log('\nGL calls that blocked >1ms (op, ms, during):');
    for (const c of calls) console.log(`  ${c.op.padEnd(22)} ${String(c.ms).padStart(8)}ms  ${c.at || 'boot/stream'}`);
    console.log('\nLong tasks >50ms:');
    const byMark = {};
    for (const l of long) {
      const k = l.at || 'boot/stream';
      byMark[k] = byMark[k] || [];
      byMark[k].push(l.ms);
    }
    for (const [k, v] of Object.entries(byMark))
      console.log(`  ${k.padEnd(18)} ${v.length} tasks, worst ${Math.max(...v)}ms, total ${v.reduce((a, b) => a + b, 0)}ms`);

    const infoLogCalls = calls.filter((c) => c.op === 'getProgramInfoLog');
    const infoLogMs = infoLogCalls.reduce((sum, c) => sum + c.ms, 0);
    check(
      'f) total getProgramInfoLog blocking time across all swaps stays under 60 ms',
      infoLogMs < 60,
      `${infoLogMs.toFixed(1)} ms total across ${infoLogCalls.length} call(s) — this is the exact ` +
        'call that blocked 978 ms / 949 ms on the live beta before the fix'
    );

    /* Pair 1 is the warm-up and is EXEMPT here, deliberately: the first visit to each car pays
     * its one-time GLB parse and geometry upload on the main thread, which is a different bill
     * from the one this diag guards. The player's complaint was REPEATED swapping — "to the
     * Bubble and back" — and from pair 2 on, both cars' programs exist, so a hitch there is a
     * regression of exactly the reported freeze. */
    const steady = long.filter((l) => l.at && !l.at.startsWith('p1:'));
    const worstLong = steady.length ? Math.max(...steady.map((l) => l.ms)) : 0;
    check(
      'g) worst single long task during steady-state swaps (pair 2 on) stays under 500 ms',
      worstLong < 500,
      steady.length
        ? `worst was ${worstLong} ms across ${steady.length} long task(s)`
        : 'no long tasks recorded after the warm-up pair'
    );
  } finally {
    try {
      chrome.kill();
    } catch {
      /* already gone */
    }
  }
}

await main();

const allPass = results.every((r) => r.ok);
console.log(`\n${'-'.repeat(64)}\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(allPass ? 0 : 1);
