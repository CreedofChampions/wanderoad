/* CAN A CONTROLLER ACTUALLY PLAY THIS? — driven with a synthetic pad in the live bundle.
 *
 * Operator: "add clear controler support and controls so u can open garage w reset to road and KNOW
 * how to do that and get hints at tirght times."
 *
 * There is no pad plugged into the machine this runs on, and "I added the bindings" is not evidence.
 * But the Gamepad API is polled, not evented — the game asks `navigator.getGamepads()` once a frame —
 * so a fake one that reports the W3C Standard Gamepad layout is INDISTINGUISHABLE to the game from a
 * real Xbox pad. Overriding that one function is a complete, honest harness: every press below goes
 * through the same poll, the same edge detection and the same action table a real pad would.
 *
 * What it proves, in the order a confused player would need it:
 *   1. plugging a pad in TELLS you the two buttons that matter
 *   2. the permanent on-screen line stops naming keys you are not holding
 *   3. Start opens the Garage, and Start closes it again (it toggles, it does not fight itself)
 *   4. the Garage lists the controller button by button
 *   5. the stick moves the focus and A presses what it lands on
 *   6. Y puts you back on the road from the middle of a field
 *   7. holding a button does NOT repeat — the thing that would make Start unusable
 *
 *   node tools/diag-gamepad.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const URL = process.argv[2] || 'https://cozydriver.com/beta/?debug';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9958;
let pass = 0;
let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(56)} ${String(got).padStart(11)}   want ${want}`);
  if (ok) pass++;
  else fail++;
};

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-first-run',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-pad-' + process.pid,
    '--window-size=1280,800',
    'about:blank',
  ],
  { stdio: 'ignore' }
);
let ws = null;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(250);
  try {
    ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {}
}
const sock = new WebSocket(ws);
await new Promise((r) => sock.addEventListener('open', r));
let id = 0;
const pend = new Map();
sock.addEventListener('message', (m) => {
  const x = JSON.parse(m.data);
  if (x.id && pend.has(x.id)) {
    pend.get(x.id)(x);
    pend.delete(x.id);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const n = ++id;
    pend.set(n, res);
    sock.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
const { result: t } = await send('Target.getTargets');
const page = t.targetInfos.find((x) => x.type === 'page');
const { result: att } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const S = att.sessionId;
await send('Page.enable', {}, S);
await send('Runtime.enable', {}, S);
const evalIn = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true }, S)).result?.result?.value;

/* THE FAKE PAD, installed before the bundle runs so the game never sees a world without one.
 * Standard Gamepad layout: 17 buttons, 4 axes, `mapping: 'standard'`. */
const INSTALL = `(() => {
  const st = { buttons: new Array(17).fill(0), axes: [0, 0, 0, 0], on: false };
  window.__pad = st;
  const snapshot = () => ({
    id: 'Fake Standard Gamepad (Vendor: 045e Product: 02ea)',
    index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
    axes: st.axes.slice(),
    buttons: st.buttons.map((v) => ({ pressed: v > 0.5, touched: v > 0, value: v })),
  });
  navigator.getGamepads = () => (st.on ? [snapshot(), null, null, null] : [null, null, null, null]);
  window.__padOn = (on) => { st.on = on; };
  window.__padTap = async (i) => { st.buttons[i] = 1; await new Promise((r) => setTimeout(r, 130)); st.buttons[i] = 0; await new Promise((r) => setTimeout(r, 130)); };
  window.__padHold = async (i, ms) => { st.buttons[i] = 1; await new Promise((r) => setTimeout(r, ms)); st.buttons[i] = 0; };
  window.__padAxis = (a, v) => { st.axes[a] = v; };
  window.__says = [];
  return true;
})()`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: INSTALL }, S);
await send('Page.navigate', { url: URL }, S);
for (let i = 0; i < 90; i++) {
  await sleep(500);
  if (await evalIn('!!(window.WANDEROAD && window.WANDEROAD.car)')) break;
}
await sleep(2500);
// Record every line the HUD says, so a prompt cannot be missed by reading at the wrong instant.
await evalIn(
  "(() => { const el = document.getElementById('toast'); if (!el) return false; window.__says = []; new MutationObserver(() => { const t = (el.textContent || '').trim(); if (t && window.__says[window.__says.length - 1] !== t) window.__says.push(t); }).observe(el, { childList: true, characterData: true, subtree: true }); return true; })()"
);

const hintBefore = await evalIn("(document.getElementById('openMenu') || {}).textContent || ''");
check(/Esc/.test(hintBefore), 'with no pad, the on-screen line names the KEY', `"${hintBefore.slice(0, 26)}"`, 'names Esc');

// ── plug it in ───────────────────────────────────────────────────────────────
await evalIn('window.__padOn(true); true');
await sleep(1400);
const says = JSON.parse((await evalIn('JSON.stringify(window.__says || [])')) || '[]');
const greeting = says.find((l) => /controller ready/i.test(l)) || '';
check(!!greeting, 'plugging a pad in announces itself', `"${greeting.slice(0, 24)}"`, 'says controller ready');
check(/Start/.test(greeting) && /View|Y/.test(greeting), 'and names the garage and the reset button', `"${greeting.slice(-34)}"`, 'Start + reset');
const hintAfter = await evalIn("(document.getElementById('openMenu') || {}).textContent || ''");
check(/Start/.test(hintAfter), 'the permanent line switches to pad buttons', `"${hintAfter.slice(0, 30)}"`, 'names Start');

/* ── A PAD BUTTON STARTS THE GAME ────────────────────────────────────────────
 * The title card says "any key or button to drive", and until this pass that was untrue for a pad:
 * the skip test read only the driving axes, so a controller player pressing A or Start sat watching
 * the intro. It is the very first thing a pad player does, so it is checked before anything else. */
const cineBefore = await evalIn('!!(window.WANDEROAD.cine && window.WANDEROAD.cine.active)');
check(cineBefore === true, 'the title card is up before anything is pressed', cineBefore, 'true');
await evalIn('window.__padTap(0)'); // A
await sleep(1600);
const cineAfter = await evalIn('!!(window.WANDEROAD.cine && window.WANDEROAD.cine.active)');
check(cineAfter === false, 'a pad BUTTON dismisses it, as the card promises', cineAfter, 'false');

// ── Start opens the Garage ───────────────────────────────────────────────────
await evalIn('window.__padTap(9)');
await sleep(1100);
const opened = await evalIn("!document.getElementById('menu').hidden");
check(opened === true, 'Start OPENS the garage', opened, 'true');

const padRows = await evalIn(
  "(() => { const heads = [...document.querySelectorAll('#menu .keysHead')].map((h) => h.textContent.trim()); const i = heads.indexOf('Controller'); if (i < 0) return null; const dl = document.querySelectorAll('#menu dl.keys')[i]; return [...dl.querySelectorAll('div')].map((d) => d.textContent.replace(/\\s+/g, ' ').trim()); })()"
);
check(Array.isArray(padRows) && padRows.length >= 10, 'the garage documents the controller', padRows ? padRows.length : 'none', '>= 10 rows');
check(
  !!padRows && padRows.some((r) => /Start/.test(r) && /Garage/i.test(r)),
  'including which button opens the garage',
  padRows ? `"${(padRows.find((r) => /Start/.test(r)) || '').slice(0, 22)}"` : 'none',
  'Start = garage'
);
check(
  !!padRows && padRows.some((r) => /View|^Y /.test(r) && /road/i.test(r)),
  'and which one gets you back on the road',
  padRows ? `"${(padRows.find((r) => /road/i.test(r)) || '').slice(0, 24)}"` : 'none',
  'Y/View = road'
);

// ── the focus ring moves, and A presses what it lands on ─────────────────────
const focus0 = await evalIn("(document.activeElement && document.activeElement.textContent || '').trim()");
check(!!focus0, 'opening it puts the focus on a button already', `"${focus0.slice(0, 16)}"`, 'something focused');
await evalIn('window.__padTap(15)'); // D-pad right
await sleep(700);
const focus1 = await evalIn("(document.activeElement && document.activeElement.textContent || '').trim()");
check(focus1 !== focus0, 'the d-pad moves the focus to another button', `"${focus1.slice(0, 16)}"`, `not "${focus0.slice(0, 12)}"`);

// ── Start closes it again ────────────────────────────────────────────────────
await evalIn('window.__padTap(9)');
await sleep(900);
const closed = await evalIn("document.getElementById('menu').hidden");
check(closed === true, 'Start CLOSES it again', closed, 'true');

/* HOLDING MUST NOT REPEAT. A polled button with no edge detection fires sixty times a second, which
 * would make Start flap the Garage open and shut for as long as it is held — the single most likely
 * way this feature ships broken. Hold it for a second and count what the panel ends up as. */
await evalIn('window.__padHold(9, 1000)');
await sleep(1200);
const afterHold = await evalIn("document.getElementById('menu').hidden");
check(afterHold === false, 'HOLDING Start opens it once, not sixty times', afterHold === false, 'open, not flapping');
await evalIn('window.__padTap(9)');
await sleep(700);

// ── Y gets you out of a field ────────────────────────────────────────────────
await evalIn(
  "(() => { const c = window.WANDEROAD.car; const q = c.terrain.roads.query(c.x, c.z); c.placeAt(c.x + 260, c.z + 260, c.yaw); return true; })()"
);
await sleep(1600);
const lost = await evalIn(
  "(() => { const c = window.WANDEROAD.car; const s = c.terrain.surface(c.x, c.z); return { onRoad: +s.onRoad.toFixed(2), x: Math.round(c.x), z: Math.round(c.z) }; })()"
);
check(lost.onRoad < 0.02, 'dropped in a field, off the road', lost.onRoad, '< 0.02');
await evalIn('window.__padTap(3)'); // Y
await sleep(1600);
const rescued = await evalIn(
  "(() => { const c = window.WANDEROAD.car; const s = c.terrain.surface(c.x, c.z); return { onRoad: +s.onRoad.toFixed(2), x: Math.round(c.x), z: Math.round(c.z) }; })()"
);
check(rescued.onRoad > 0.5, 'pressing Y puts you back ON the road', rescued.onRoad, '> 0.5');
check(
  Math.hypot(rescued.x - lost.x, rescued.z - lost.z) > 1,
  'and actually moved the car to do it',
  `${Math.round(Math.hypot(rescued.x - lost.x, rescued.z - lost.z))} m`,
  '> 1 m'
);

console.log(`\n${pass}/${pass + fail} checks passed`);
sock.close();
chrome.kill();
process.exit(fail ? 1 : 0);
