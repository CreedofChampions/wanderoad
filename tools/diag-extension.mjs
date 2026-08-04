/* created by AI
 * Cozy Driver — DOES THE EXTENSION ACTUALLY LOAD, IN A REAL CHROME.
 *
 * B4/CP4 has sat open since the extension was written, with the note "web_accessible_resources is
 * youtube.com-gated, so headless cannot load panel.html. Needs a real window". That note is half
 * right and it is the half that matters that is wrong: `web_accessible_resources` gates who may
 * reach the file FROM A PAGE, and it has nothing to do with the extension opening its own panel.
 * A Chrome launched with `--load-extension` can navigate straight to
 * `chrome-extension://<id>/panel.html`, which is the same document the side panel shows.
 *
 * The real wall was somewhere else entirely, and it is worth writing down: since Chrome 137 the
 * `--load-extension` command line flag is IGNORED, silently. Headless or headed makes no
 * difference — `chrome://extensions-internals` listed only Chrome's own components, which is how
 * this was caught rather than guessed. The replacement is the CDP `Extensions` domain: launch with
 * `--enable-unsafe-extension-debugging` and call `Extensions.loadUnpacked`, which returns the id.
 * The path must be a real Windows path (`D:/...` or `D:\...`); a POSIX-style `/D:/...` is refused
 * with "File path cannot be resolved", and a trailing separator yields a DIFFERENT id, so it is
 * passed exactly as `resolve()` gives it.
 *
 * So this tool stops taking the note's word for it and measures the four things that would
 * actually be broken if the extension did not work:
 *
 *   1. Chrome accepted the manifest — the background service worker is a live target. A manifest
 *      error is silent otherwise: the extension simply is not there.
 *   2. panel.html opens, and the GAME BOOTS INSIDE IT — a canvas with a WebGL context, the game's
 *      own handle on window, and a car with a position. A panel that renders an empty shell would
 *      pass a "did the page load" check and fail a player.
 *   3. The bundled build is genuinely offline: nothing in the panel goes to the network beyond
 *      the extension's own origin. This is the promise docs/EXTENSION.md makes ("bundled,
 *      offline, and it never touches the page"), and it is exactly the kind of promise that
 *      rots when a bundler inlines a font CDN.
 *   4. No console errors while it does any of that.
 *
 * It uses the packed `extension/` directory as it stands, so run `node tools/pack-extension.mjs`
 * first if the game has been rebuilt — the tool says so if `extension/game` is missing.
 *
 *   node tools/diag-extension.mjs
 *
 * Exits non-zero if any check fails. The Chrome profile goes in a temp directory OUTSIDE the
 * repository and is deleted afterwards, because a `.chrome-*` profile must never be committed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = resolve(ROOT, 'extension');
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9994;
const PROFILE = resolve(tmpdir(), `cozy-ext-${process.pid}`);
const SHOTS = resolve(ROOT, 'shots', 'extension');
const PROOF_OUT = resolve(ROOT, 'shots', 'proof');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

if (!existsSync(resolve(EXT, 'game', 'index.html'))) {
  console.error('extension/game is missing — run `node tools/pack-extension.mjs` first');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });
mkdirSync(PROOF_OUT, { recursive: true });

console.log('\nCOZY DRIVER — THE EXTENSION, IN A REAL CHROME\n' + '-'.repeat(72));

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    /* The one flag that makes any of this possible on a modern Chrome — see the note above.
     * `--load-extension` is not passed at all, because it does nothing. */
    '--enable-unsafe-extension-debugging',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

/** One CDP round trip over the HTTP endpoint's websocket, kept tiny — no dependency for four calls. */
async function cdp(wsUrl, calls, { collect = [] } = {}) {
  const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }));
  const ws = new WebSocket(wsUrl);
  const events = [];
  const out = [];
  await new Promise((ok, no) => {
    ws.onopen = ok;
    ws.onerror = no;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result ?? msg.error);
      pending.delete(msg.id);
    } else if (msg.method && collect.includes(msg.method)) events.push(msg);
  };
  const send = (method, params = {}) =>
    new Promise((ok) => {
      const i = ++id;
      pending.set(i, ok);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  for (const c of calls) out.push(await c(send));
  ws.close();
  return { out, events };
}

const list = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();

try {
  // wait for the browser
  for (let i = 0; i < 60; i++) {
    try {
      await list();
      break;
    } catch {
      await sleep(500);
    }
  }

  /* ── 1. did Chrome accept the manifest ───────────────────────────────────── */
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  const loaded = await cdp(version.webSocketDebuggerUrl, [(s) => s('Extensions.loadUnpacked', { path: EXT })]);
  const extId = loaded.out[0]?.id ?? null;
  check(
    'Chrome accepted the manifest and loaded the extension',
    !!extId,
    extId ? `chrome-extension://${extId}` : JSON.stringify(loaded.out[0]),
  );
  if (!extId) throw new Error('extension did not load');
  const targets = await list();

  /* ── 2. the panel opens and the GAME BOOTS in it ─────────────────────────── */
  const panelUrl = `chrome-extension://${extId}/panel.html`;
  const page = targets.find((t) => t.type === 'page');
  const ws = page.webSocketDebuggerUrl;
  const boot = await cdp(
    ws,
    [
      (s) => s('Page.enable'),
      (s) => s('Runtime.enable'),
      (s) => s('Log.enable'),
      (s) => s('Network.enable'),
      (s) => s('Page.navigate', { url: panelUrl }),
    ],
    { collect: ['Runtime.consoleAPICalled', 'Log.entryAdded', 'Network.requestWillBeSent'] },
  );
  void boot;

  // give the bundled build time to boot a world
  await sleep(12000);

  /* THE GAME IS IN AN IFRAME, and that is the whole reason the first version of this check read
   * an empty panel: panel.html is the 50/50 shell, and `game/index.html` is a child document
   * inside it. Both are chrome-extension://<same id>, so the frames are same-origin and
   * `contentWindow` reaches straight in — no frame-target juggling needed. The game frame is
   * picked by src rather than by position, so moving the halves around does not silently start
   * measuring the YouTube embed instead. */
  const probe = `(() => {
    const frames = [...document.querySelectorAll('iframe')];
    const gf = frames.find((f) => (f.getAttribute('src') || '').includes('game/'));
    const doc = gf ? gf.contentDocument : document;
    const win = gf ? gf.contentWindow : window;
    const c = doc && doc.querySelector('canvas');
    const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
    const W = win && win.WANDEROAD;
    return JSON.stringify({
      title: document.title,
      gameFrame: gf ? gf.getAttribute('src') : null,
      canvas: !!c, w: c ? c.width : 0, h: c ? c.height : 0,
      gl: !!gl,
      frames: W && typeof W.fps === 'function' ? Math.round(W.fps()) : null,
      car: W && W.car ? [Math.round(W.car.x), Math.round(W.car.z)] : null,
      iframe: frames.length,
      search: !!document.querySelector('input'),
      /* THE 50/50 THE PANEL PROMISES — measured off the live boxes rather than trusted to the
       * stylesheet. Both halves are flex 1 1 0 with min-height and min-width 0, and that is the
       * thing that breaks first when an iframe joins a flex row: the frame's intrinsic size wins
       * and one half quietly eats the other. */
      panelW: document.documentElement.clientWidth,
      gameW: gf ? Math.round(gf.getBoundingClientRect().width) : 0,
    });
  })()`;

  const fresh = (await list()).find((t) => t.url.startsWith('chrome-extension://') && t.type === 'page');
  const { out, events } = await cdp(
    fresh ? fresh.webSocketDebuggerUrl : ws,
    [
      (s) => s('Runtime.enable'),
      (s) => s('Log.enable'),
      (s) => s('Runtime.evaluate', { expression: probe, returnByValue: true }),
      (s) => s('Page.captureScreenshot', { format: 'png' }),
    ],
    { collect: ['Runtime.consoleAPICalled', 'Log.entryAdded'] },
  );
  const state = JSON.parse(out[2]?.result?.value ?? '{}');
  console.log(`       panel: "${state.title}" game frame ${state.gameFrame}, canvas ${state.w}x${state.h}, car at ${state.car}, ${state.frames} fps`);

  check('the panel document opens from the extension itself', !!state.title, state.title || '(no document)');
  check('there is a canvas in it, with a real WebGL context', !!state.canvas && !!state.gl, `${state.w}x${state.h}, gl ${state.gl}`);
  check(
    'THE GAME BOOTED — a live car with a position, not an empty shell',
    Array.isArray(state.car),
    state.car ? `car at (${state.car[0]}, ${state.car[1]})` : 'window.WANDEROAD absent',
  );
  check('and it is drawing frames', typeof state.frames === 'number' && state.frames > 0, `${state.frames} fps`);
  /* The watch half is the SEARCH BOX plus the game beside it. The video frame is deliberately not
   * asserted: panel.js only builds one once the player has typed something, and making this check
   * type would have it fetch a youtube.com embed — a network call this tool exists partly to prove
   * the panel does not make on its own. What the URL builder does with the words is checked in node
   * by tools/diag-panel-urls.mjs, which needs no browser at all. */
  check('the watch half is there too — the search box, with the game in its own frame beside it', !!state.search && !!state.gameFrame, `input ${state.search}, game frame ${state.gameFrame}`);
  const split = state.panelW ? state.gameW / state.panelW : 0;
  check(
    'and it really is a 50/50 — the iframe has not eaten the watch half',
    Math.abs(split - 0.5) < 0.02,
    `${state.gameW} of ${state.panelW} px = ${(split * 100).toFixed(1)}%`,
  );

  if (out[3]?.data) {
    writeFileSync(resolve(SHOTS, 'panel.png'), Buffer.from(out[3].data, 'base64'));
    console.log(`       shot: ${resolve(SHOTS, 'panel.png')}`);
  }

  /* ── 3. offline: nothing left the extension's own origin ─────────────────── */
  const offsite = (boot.events || [])
    .filter((e) => e.method === 'Network.requestWillBeSent')
    .map((e) => e.params.request.url)
    .filter((u) => !u.startsWith(`chrome-extension://${extId}`) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check(
    'the panel is genuinely offline — every request stayed inside the extension',
    offsite.length === 0,
    offsite.length ? offsite.slice(0, 3).join(' ') : 'no off-origin requests',
  );

  /* ── 4. and it did all that without complaining ──────────────────────────── */
  const errs = events
    .filter((e) => (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
    .map((e) => e.params.entry?.text || (e.params.args || []).map((a) => a.value).join(' '));
  check('no console errors in the panel', errs.length === 0, errs.slice(0, 2).join(' | ') || 'clean');

  /* ── 5. and, with PROOF=1, three and a half seconds of it MOVING ──────────
   *
   * Operator: "with games the proof has to be more than just an image but a GIF showing movement
   * (or webm for space) so it can be seen frame by frame across 3 seconds minimum". A still of the
   * panel cannot tell a running game from a frozen first frame, which is exactly the failure mode
   * a side panel has. So the clip is filmed here rather than by tools/proof-gallery.mjs: that tool
   * drives the deployed site, and there is no URL for an extension panel to drive. */
  if (process.env.PROOF && extId) {
    const target = (await list()).find((t) => t.url.includes('panel.html'));
    const frames = resolve(PROOF_OUT, '.extframes');
    rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    const { WebSocket } = await import('ws');
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok) => (sock.onopen = ok));
    let mid = 0;
    const pend = new Map();
    let n = 0;
    let recording = false;
    const t0 = Date.now();
    sock.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pend.has(msg.id)) {
        pend.get(msg.id)(msg.result ?? msg.error);
        pend.delete(msg.id);
        return;
      }
      /* Screencast frames arrive as EVENTS, not as replies, and they stop after two unless each
       * one is acked. Both of those cost a run's worth of empty clips to learn. */
      if (msg.method === 'Page.screencastFrame') {
        if (recording) writeFileSync(resolve(frames, `f${String(++n).padStart(4, '0')}.jpg`), Buffer.from(msg.params.data, 'base64'));
        send2('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
      }
    };
    function send2(method, params = {}) {
      return new Promise((ok) => {
        const i = ++mid;
        pend.set(i, ok);
        sock.send(JSON.stringify({ id: i, method, params }));
      });
    }
    await send2('Page.enable');
    // Click the game half so the iframe has focus, then hold W — a parked car proves nothing.
    await send2('Input.dispatchMouseEvent', { type: 'mousePressed', x: 190, y: 250, button: 'left', clickCount: 1 });
    await send2('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 190, y: 250, button: 'left', clickCount: 1 });
    await send2('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' });
    await sleep(1200);
    recording = true;
    await send2('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1 });
    await sleep(3800);
    await send2('Page.stopScreencast');
    recording = false;
    const secs = (Date.now() - t0 - 1200) / 1000;
    const fps = Math.max(1, Math.round(n / secs));
    const webm = resolve(PROOF_OUT, 'B4.webm');
    const enc = spawnSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', resolve(frames, 'f%04d.jpg'),
       '-vf', 'scale=960:-2', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-an', webm],
      { encoding: 'utf8' },
    );
    const { data } = await send2('Page.captureScreenshot', { format: 'png' });
    if (data) writeFileSync(resolve(PROOF_OUT, 'B4.png'), Buffer.from(data, 'base64'));
    await send2('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' });
    sock.close();
    rmSync(frames, { recursive: true, force: true });
    check(
      `PROOF: ${n} frames over ${secs.toFixed(1)}s of the panel while the game is driven`,
      enc.status === 0 && n >= 12 && secs >= 3,
      enc.status === 0 ? `${webm} @${fps}fps` : (enc.stderr || '').slice(0, 120),
    );
    /* Merged into the ACCUMULATING archive, which is what tools/publish-proof.py and the to-do
     * page both read. Writing the per-run manifest instead is how an earlier session published an
     * empty proof page. */
    const arch = resolve(PROOF_OUT, 'archive.json');
    const rows = existsSync(arch) ? JSON.parse(readFileSync(arch, 'utf8')) : [];
    const row = {
      id: 'B4',
      label: 'B4 the extension loads in a real Chrome — the game running in the side panel, beside the watch half',
      file: 'B4.png',
      clip: 'B4.webm',
      seconds: +secs.toFixed(1),
      fps,
      frames: n,
      reading: `chrome-extension://${extId}/panel.html — canvas ${state.w}x${state.h}, car at (${state.car}), ${state.frames} fps, no off-origin requests`,
      ok: true,
    };
    writeFileSync(arch, JSON.stringify([...rows.filter((r) => r.id !== 'B4'), row], null, 2));
  }
} catch (e) {
  check(`the run completed`, false, e.message);
} finally {
  chrome.kill();
  await sleep(500);
  try {
    rmSync(PROFILE, { recursive: true, force: true });
  } catch {
    /* a locked profile directory is not a test result */
  }
}

console.log(`\n${failed ? `${failed} EXTENSION CHECK(S) FAILED` : 'all extension checks passed'}\n`);
process.exit(failed ? 1 : 0);
