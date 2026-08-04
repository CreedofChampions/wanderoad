/* Wanderoad — DOES THE "DRIVE TOGETHER" COPY BUTTON ACTUALLY COPY, AND DOES THE PAGE JUMP?
 *
 * Operator, 31 July: "drive togetheer buttons seem to push u to top of screen and do nothing else".
 *
 * Both halves of that were diagnosed in src/net/invite.js and a fix was written: the async clipboard
 * API fails SILENTLY without a secure context and a focused document, so the handler fell through to
 * SELECTING the address, and selecting text scrolls the selection into view inside the Garage's
 * scrolling sheet. Nothing copied, and the view moved.
 *
 * That fix has never been exercised by a real click. `net-test.mjs` mounts the panel against a stub
 * document, which cannot have a clipboard, a scroll position, or a user gesture — so it can prove the
 * markup and not the complaint. This file is the missing half: a real Chrome, the real page, a real
 * mouse press on the real button, and then the clipboard read back out of the browser.
 *
 * WHAT IT ASSERTS:
 *   1. the panel is actually in the Garage where the player is told to look
 *   2. the address shown is this world's address, seat and all
 *   3. a REAL CLICK on Copy puts that exact text on the system clipboard
 *   4. the button says "Copied" — the success path, not the "Select and copy" fallback
 *   5. THE VIEW DOES NOT JUMP. This is the operator's actual sentence, and it is the one thing the
 *      unit test can never see: the scroll position of the Garage sheet, and of the window, must be
 *      the same after the click as before it.
 *
 *   node tools/diag-invite-buttons.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'https://cozydriver.com/beta/';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9500 + (process.pid % 200);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,800',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--use-angle=default',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-invite-' + process.pid,
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
  const w = new WebSocket(target.webSocketDebuggerUrl);
  w.addEventListener('open', () => res(w));
  w.addEventListener('error', () => rej(new Error('cdp websocket failed')));
});
let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const x = JSON.parse(m.data);
  if (x.id && pending.has(x.id)) {
    pending.get(x.id)(x);
    pending.delete(x.id);
  }
});
const send = (method, params = {}) =>
  new Promise((res) => {
    const n = ++msgId;
    pending.set(n, res);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');

const pageUrl = new URL(URL_BASE);
pageUrl.searchParams.set('intro', 'off'); // no cinematic to race with — see diag-twowindows
pageUrl.searchParams.set('seed', '20260726');

/* The clipboard is permissioned, and a headless browser grants nothing by default. This is the
 * BROWSER granting a page a permission the user would be asked for — it is not a credential and it
 * reaches nothing outside this throwaway profile. Without it, `readText()` rejects and the test
 * would be measuring Chrome's permission prompt rather than the button. */
await send('Browser.grantPermissions', {
  origin: pageUrl.origin,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
});

console.log(`\nWanderoad — the "Drive together" buttons, clicked for real, on ${pageUrl.origin}\n`);
await send('Page.navigate', { url: pageUrl.href });

let ready = false;
for (let i = 0; i < 140; i++) {
  await sleep(500);
  if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) {
    ready = true;
    break;
  }
}
if (!ready) {
  chrome.kill();
  throw new Error('the game never finished loading');
}
await sleep(1500);

// Escape opens the Garage — the same one route the game gives a player (browser-test covers that
// binding; here it is just the way in).
for (const type of ['keyDown', 'keyUp'])
  await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' });
await sleep(1200);

const panel = await ev(
  `(() => {
     const s = document.getElementById('invite');
     if (!s) return JSON.stringify({ found: false });
     const btns = [...s.querySelectorAll('button')].map((b) => b.textContent);
     const addr = [...s.querySelectorAll('span')].map((n) => n.textContent).filter((t) => t && t.startsWith('http'));
     const vis = !!(s.offsetParent || s.getClientRects().length);
     return JSON.stringify({ found: true, visible: vis, buttons: btns, addresses: addr });
   })()`
);
const P = JSON.parse(panel || '{"found":false}');
check('the "Drive together" panel is in the Garage', P.found && P.visible, P.found ? `${P.buttons.length} buttons, ${P.addresses.length} addresses` : 'no #invite element');
check(
  'it shows this world\'s address, seat and all',
  (P.addresses || []).some((a) => a.includes('seat=') && a.includes('seed=20260726')),
  (P.addresses || [])[0] || 'none shown'
);

/* THE REAL CLICK. Not element.click() — that dispatches an event without a user gesture, and a user
 * gesture is exactly what the clipboard API requires, so a synthetic call would test a path no
 * player ever takes. This is a mouse press at the button's own screen coordinates. */
const box = await ev(
  `(() => {
     const s = document.getElementById('invite');
     const b = [...s.querySelectorAll('button')].find((n) => n.textContent === 'Copy');
     if (!b) return 'null';
     b.scrollIntoView({ block: 'center' });
     const r = b.getBoundingClientRect();
     return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
   })()`
);
const B = JSON.parse(box || 'null');

// The scroll positions BEFORE the click — the operator's complaint is that these move.
const scrollBefore = await ev(
  `(() => {
     const s = document.getElementById('invite');
     let el = s, sc = null;
     while (el && !sc) { if (el.scrollHeight > el.clientHeight + 4) sc = el; el = el.parentElement; }
     return JSON.stringify({ sheet: sc ? sc.scrollTop : null, win: window.scrollY, id: sc ? (sc.id || sc.className || 'anon') : 'none' });
   })()`
);
const SB = JSON.parse(scrollBefore);
await sleep(300);

/* WHAT IS ACTUALLY UNDER THE CURSOR. A click that misses would look identical to a broken handler —
 * empty clipboard, unchanged label — so the coordinates are re-derived immediately before the press
 * (nothing between, so nothing can scroll them stale) and the element under them is named. */
const aim = await ev(
  `(() => {
     const s = document.getElementById('invite');
     const b = [...s.querySelectorAll('button')].find((n) => n.textContent === 'Copy');
     if (!b) return 'null';
     const r = b.getBoundingClientRect();
     const x = r.left + r.width / 2, y = r.top + r.height / 2;
     const hit = document.elementFromPoint(x, y);
     return JSON.stringify({ x, y, w: r.width, h: r.height,
       hit: hit ? hit.tagName + '.' + (hit.className || '') + '["' + (hit.textContent || '').slice(0, 14) + '"]' : 'nothing',
       isTheButton: hit === b });
   })()`
);
const AIM = JSON.parse(aim || 'null');
console.log(`  aiming at ${AIM ? `(${AIM.x.toFixed(0)},${AIM.y.toFixed(0)}) ${AIM.w.toFixed(0)}x${AIM.h.toFixed(0)} — under it: ${AIM.hit}` : 'nothing'}`);
if (AIM) B.x = AIM.x, B.y = AIM.y;
check('the cursor is actually over the Copy button', !!AIM && AIM.isTheButton, AIM ? AIM.hit : 'no button found');

/* Does a click EVENT reach the button at all? The label not changing means the handler did not run,
 * and a handler that does not run is a completely different bug from one that runs and fails. A
 * capture-phase listener on the document records what the browser actually delivered. */

if (B) {
/* WHO IS SCROLLING, sampled from OUTSIDE the page so nothing of mine can throw inside it.
 * The scroll position and the focused element, every 50 ms across the press and the release. */
const sample = `(() => {
  const s = document.getElementById('invite');
  let el = s, sc = null;
  while (el && !sc) { if (el.scrollHeight > el.clientHeight + 4) sc = el; el = el.parentElement; }
  const a = document.activeElement;
  return Math.round(sc ? sc.scrollTop : -1) + ' | ' + (a ? a.tagName + ':' + String(a.textContent || '').trim().slice(0, 18) : 'none');
})()`;
const trace = [];
trace.push('before press      ' + (await ev(sample)));
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: B.x, y: B.y, button: 'none', clickCount: 0 });
trace.push('after mouseMoved  ' + (await ev(sample)));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: B.x, y: B.y, button: 'left', clickCount: 1 });
for (let i = 0; i < 6; i++) { await sleep(50); trace.push(`press +${(i + 1) * 50}ms     ` + (await ev(sample))); }
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: B.x, y: B.y, button: 'left', clickCount: 1 });
for (let i = 0; i < 4; i++) { await sleep(50); trace.push(`release +${(i + 1) * 50}ms   ` + (await ev(sample))); }
console.log('  scrollTop | focused element');
for (const t of trace) console.log('    ' + t);
console.log('');
}
await sleep(1200);


const stillSame = await ev(
  `(() => { const s = document.getElementById('invite');
            const b = [...s.querySelectorAll('button')].find((n) => /Copy|Copied|Select/.test(n.textContent));
            return JSON.stringify({ sameElement: b === window.__btn, open: !!document.querySelector('#invite')?.offsetParent }); })()`
);


console.log(`  panel state after click: ${stillSame}`);

const clip = await ev('navigator.clipboard.readText().then(t => t).catch(e => "ERR:" + e.message)');
const label = await ev(
  `(() => { const s = document.getElementById('invite');
            const b = [...s.querySelectorAll('button')].find((n) => /Copied|Select and copy|Copy/.test(n.textContent));
            return b ? b.textContent : 'none'; })()`
);
const scrollAfter = await ev(
  `(() => {
     const s = document.getElementById('invite');
     let el = s, sc = null;
     while (el && !sc) { if (el.scrollHeight > el.clientHeight + 4) sc = el; el = el.parentElement; }
     return JSON.stringify({ sheet: sc ? sc.scrollTop : null, win: window.scrollY });
   })()`
);
const SA = JSON.parse(scrollAfter);

const shown = (P.addresses || [])[0] || '';
check('a real click on Copy put the address on the clipboard', typeof clip === 'string' && clip.startsWith('http') && clip === shown, typeof clip === 'string' ? `clipboard = ${String(clip).slice(0, 72)}` : 'nothing readable');
check('the button reports the SUCCESS path, not the fallback', label === 'Copied', `button says "${label}"`);

const sheetMoved = SB.sheet !== null && SA.sheet !== null ? Math.abs(SA.sheet - SB.sheet) : 0;
const winMoved = Math.abs((SA.win || 0) - (SB.win || 0));
check(
  'THE VIEW DOES NOT JUMP — the operator\'s actual complaint',
  sheetMoved < 2 && winMoved < 2,
  `sheet(${SB.id}) ${SB.sheet} -> ${SA.sheet}, window ${SB.win} -> ${SA.win}`
);

mkdirSync('shots/invite', { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  writeFileSync('shots/invite/after-copy.png', Buffer.from(shot.result.data, 'base64'));
  console.log('\n  photographed: shots/invite/after-copy.png');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(' · ')}`);
else console.log('THE BUTTONS WORK.');

chrome.kill();
process.exit(failed.length ? 1 : 0);
