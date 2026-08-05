/* created by AI
 * Wanderoad — DOES ESCAPE ACTUALLY SILENCE THE GAME?
 *
 * Operator: "esc = pause = no sound".
 *
 * The world was already stopped while the Garage is open — main.js gates the car, the boat, the
 * fuel burn and the rest on `!menu.open` — but the audio graph kept running underneath it, so a
 * paused game sat there with an engine idling and birds singing over a menu.
 *
 * This reads the REAL master gain out of the live WebAudio graph, not the flag that was set. A
 * check that asserts `audio._paused === true` proves only that an assignment happened; the thing
 * the operator can hear is the gain node, so that is what is measured. It also confirms the sound
 * comes BACK, because a pause that silences the game for ever is a worse bug than the one it fixes.
 *
 *   node tools/diag-pause-silence.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] || 'https://cozydriver.com/beta/';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9991;
let pass = 0;
let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(50)} ${String(got).padStart(12)}   want ${want}`);
  if (ok) pass++;
  else fail++;
};

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-first-run',
    // A headless Chrome has no audio device; without this the graph never starts and every
    // gain reads 0, which would pass this test for entirely the wrong reason.
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-pause-' + process.pid,
    '--window-size=1100,700',
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
const key = async (code, vk) => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: vk, key: code === 'Escape' ? 'Escape' : 'w', code }, S);
};

await send('Page.navigate', { url: `${BASE}?fresh=1&seed=20260726` }, S);
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) break;
}
await sleep(2500);
// drive, which is what starts the audio graph in the first place
await key('KeyW', 87);
await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
await sleep(4000);
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
await sleep(800);

/** The real master gain, straight off the WebAudio node. */
const gain = () => ev('(() => { const a = window.WANDEROAD.audio; return a && a.master ? +a.master.gain.value.toFixed(5) : -1; })()');
/* Read the PANEL, not a flag. The Garage is not on the debug handle, and more to the point a
 * screenful of menu is what "paused" means to the person looking at it — `#menu` being unhidden is
 * the same thing they can see. */
const menuOpen = () => ev("(() => { const el = document.getElementById('menu'); return !!el && !el.hidden; })()");

const before = await gain();
check(before > 0.001, 'the game is making noise before Escape', before, '> 0.001');

await key('Escape', 27);
await sleep(700);
const opened = await menuOpen();
const during = await gain();
check(opened === true, 'Escape opened the Garage', String(opened), 'true');
check(during <= 0.001, 'and the sound went with it', during, '<= 0.001');

await key('Escape', 27);
await sleep(900);
const closed = await menuOpen();
const after = await gain();
check(closed === false, 'Escape closed it again', String(closed), 'false');
check(after > 0.001, 'and the sound came back', after, '> 0.001');

console.log(`\n${pass}/${pass + fail} checks passed`);
sock.close();
chrome.kill();
process.exit(fail ? 1 : 0);
