/* created by AI
 * Wanderoad — PHOTOGRAPH THE SCOOTER IN THE LIVE GAME.
 *
 * Operator's standing rule: prove every fix with a screenshot or it did not happen. The wobble is
 * proven by measurement (tools/diag-scooter-wobble.mjs); this proves the thing exists, is rideable,
 * and looks like a scooter rather than a floating box — which no roll-rate number can tell you.
 *
 * It drives the real beta build in a real browser, on the real road, with `?unlock=123` so the
 * vehicle can be selected without first earning it.
 *
 *   node tools/shot-scooter.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'https://cozydriver.com/beta/';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9988;
const OUT = 'shots';

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-first-run',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-shot-' + process.pid,
    '--window-size=1280,720',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
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

const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
const { result: att } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
const S = att.sessionId;
await send('Page.enable', {}, S);
await send('Runtime.enable', {}, S);
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }, S)).result?.result?.value;

const URL_ = `${BASE}?unlock=123&fresh=1&car=scooter&seed=20260726`;
console.log('opening', URL_);
await send('Page.navigate', { url: URL_ }, S);
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) break;
}
await sleep(3000);
// dismiss the title card, then drive so the shot is of a moving vehicle on a road
for (const type of ['keyDown', 'keyUp'])
  await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
await sleep(6000);
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
await sleep(600);

const info = await ev(
  "(() => { const W = window.WANDEROAD; return JSON.stringify({ car: W.carId ?? (W.carSpec && W.carSpec.id) ?? 'unknown', kph: Math.round(W.car.kph), roll: +(W.car.roll * 180 / Math.PI).toFixed(2) }); })()"
);
console.log('   in game:', info);

mkdirSync(OUT, { recursive: true });
const { result: shot } = await send('Page.captureScreenshot', { format: 'png' }, S);
const file = `${OUT}/scooter-live.png`;
writeFileSync(file, Buffer.from(shot.data, 'base64'));
console.log('   wrote', file, Buffer.from(shot.data, 'base64').length, 'bytes');

sock.close();
chrome.kill();
