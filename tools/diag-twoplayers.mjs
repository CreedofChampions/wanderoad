/* DO TWO PLAYERS ACTUALLY SEE EACH OTHER MOVE? — two real browser windows.
 *
 * Operator: "whole multiplayer seems to never sybc properly".
 *
 * tools/net-test.mjs proves the WIRE: two clients register, the server stores each one's position
 * and hands it back. It passed the entire time multiplayer was broken, because the bug was not on
 * the wire — main.js fed `remotes.update` a requestAnimationFrame timestamp where an epoch
 * millisecond was required, so every ghost was pinned to the first snapshot ever received for that
 * peer. The wire was perfect and nothing moved.
 *
 * The only check that could have caught that is this one: two real pages, both in the same world,
 * one of them driving, and the OTHER one's scene asked whether the ghost it can see has moved. It
 * reads the rendered ghost's position out of the live scene graph rather than the network buffer,
 * because the buffer was always right.
 *
 *   node tools/diag-twoplayers.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BASE = process.argv[2] || 'https://cozydriver.com/beta/';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9986;
let pass = 0;
let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(54)} ${String(got).padStart(14)}   want ${want}`);
  if (ok) pass++;
  else fail++;
};

/* ONE BROWSER PER PLAYER, not one browser with two tabs.
 *
 * Two tabs in a single headless Chrome cannot both be running: the browser only produces frames
 * for the target it considers visible, so the occluded one's requestAnimationFrame stops. Its
 * network poll keeps going, so its snapshot buffer fills with perfectly good positions that
 * nothing ever reads, and the ghost sits at the origin looking exactly like a sync failure. It is
 * not one — a single hand-rolled update() call placed the ghost precisely on the other car.
 *
 * Two processes is also the more honest model of the thing being tested: two players are two
 * browsers, on two machines, with two profiles and two identities. A tab pair shares localStorage,
 * and therefore a player id, and the server correctly refuses to show you yourself.
 */
async function launch(port) {
  const proc = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      '--headless=new',
      '--no-first-run',
      '--user-data-dir=' + (process.env.TEMP || '/tmp') + `/wr-2p-${process.pid}-${port}`,
      '--window-size=900,600',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );
  let url = null;
  for (let i = 0; i < 60 && !url; i++) {
    await sleep(250);
    try {
      url = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {}
  }
  const sock = new WebSocket(url);
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
  return { proc, sock, send };
}

const B1 = await launch(PORT);
const B2 = await launch(PORT + 1);

/** Open a page and attach; returns an evaluator bound to it. */
async function openPage(B, url) {
  const { send } = B;
  const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: att } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const S = att.sessionId;
  await send('Page.enable', {}, S);
  await send('Runtime.enable', {}, S);
  await send('Page.navigate', { url }, S);
  const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }, S)).result?.result?.value;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) break;
  }
  await sleep(2500);
  // dismiss the title card so the frame loop and the network are both running
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
  await sleep(1200);
  return { ev, S };
}

const SEED = 20260726;
console.log('opening two windows in the same world…');
const p1 = await openPage(B1, `${BASE}?debug&fresh=1&seed=${SEED}`);
const p2 = await openPage(B2, `${BASE}?debug&fresh=1&seed=${SEED}&seat=2`);

/* Put them beside each other, well inside the range peers are drawn at. */
const HERE = { x: 40, z: -1100 };
await p1.ev(`(() => { const c = window.WANDEROAD.car; c.placeAt(${HERE.x}, ${HERE.z}, 0); c.vx=0;c.vz=0;c.speed=0; return true; })()`);
await p2.ev(`(() => { const c = window.WANDEROAD.car; c.placeAt(${HERE.x + 25}, ${HERE.z}, 0); c.vx=0;c.vz=0;c.speed=0; return true; })()`);

/* Wait for each to notice the other. The transport polls on its own schedule, so poll rather than
 * sleeping a guessed amount. */
let seen1 = 0;
let seen2 = 0;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  seen1 = (await p1.ev('window.WANDEROAD.remotes ? window.WANDEROAD.remotes.peers.size : 0')) || 0;
  seen2 = (await p2.ev('window.WANDEROAD.remotes ? window.WANDEROAD.remotes.peers.size : 0')) || 0;
  if (seen1 > 0 && seen2 > 0) break;
}
console.log('       backend:', await p1.ev('window.WANDEROAD.netInfo && window.WANDEROAD.netInfo()'), '/', await p2.ev('window.WANDEROAD.netInfo && window.WANDEROAD.netInfo()'));
check(seen1 > 0, 'window 1 sees a peer', seen1, '>= 1');
check(seen2 > 0, 'window 2 sees a peer', seen2, '>= 1');

/** Where window 1 currently DRAWS the other player's ghost — read from the scene, not the buffer. */
const ghostIn1 = () =>
  p1.ev(
    "(() => { const R = window.WANDEROAD.remotes; if (!R) return null; for (const [, rec] of R.peers) { const g = rec.obj; if (g) return JSON.stringify({ x: +g.position.x.toFixed(2), z: +g.position.z.toFixed(2) }); } return null; })()"
  );

const before = await ghostIn1();
check(!!before, 'window 1 has a ghost object it is drawing', before || 'none', 'a position');

/* MOVE WINDOW 2 A LONG WAY, and watch window 1's ghost follow.
 *
 * Placed rather than driven. Two full game instances in one headless Chrome run at a few frames a
 * second, and nine seconds of throttle covered six metres — which measures the harness, not the
 * sync. What is under test is whether a position CHANGE crosses the wire and reaches the other
 * window's scene graph; a teleport exercises exactly that path and is unambiguous. */
await p2.ev(`(() => { const c = window.WANDEROAD.car; c.placeAt(${HERE.x + 95}, ${HERE.z + 60}, 1.0); c.vx=0;c.vz=0;c.speed=0; return true; })()`);
await sleep(14000);

const moved2 = await p2.ev(`(() => { const c = window.WANDEROAD.car; return Math.round(Math.hypot(c.x - ${HERE.x + 25}, c.z - ${HERE.z})); })()`);
check(moved2 > 20, 'window 2 actually moved somewhere', `${moved2} m`, '> 20 m');

const after = await ghostIn1();
const a = before ? JSON.parse(before) : null;
const b = after ? JSON.parse(after) : null;
const ghostMoved = a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0;
console.log(`       window 1's ghost went ${before} -> ${after}`);
check(ghostMoved > 5, "window 1's GHOST moved when window 2 drove", `${ghostMoved.toFixed(1)} m`, '> 5 m');

console.log(`\n${pass}/${pass + fail} checks passed`);
B1.sock.close();
B2.sock.close();
B1.proc.kill();
B2.proc.kill();
process.exit(fail ? 1 : 0);
