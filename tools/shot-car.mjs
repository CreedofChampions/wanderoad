/* created by AI
 * Wanderoad — PHOTOGRAPH ANY CAR IN THE FLEET, ON ANY BUILD.
 *
 * Operator's standing rule: prove every fix with a picture or it did not happen. There was already
 * `tools/shot-scooter.mjs`, but it is welded to one vehicle and one probe — its final telemetry
 * eval reads `W.car.kph`, which is not a field on the Vehicle, and the run hangs there rather than
 * failing, so it cannot be pointed at a second car without editing it. Rather than fork it a
 * second time for the Warthog and a third time for whatever comes next, this is the general
 * version: pass a car id, get a photograph.
 *
 * WHY A PHOTOGRAPH AND NOT A NUMBER. The Rally used to be the Quaternius SportsCar mesh with
 * different tyre constants, and the operator's complaint was "they look the same as well". No
 * suspension figure, bounding box or triangle count can answer that — only a picture can, and
 * only a picture of the car as the GAME actually assembles it (loadedCar.js measures the model,
 * scales it to the fleet entry's `length`, and sits it on the road; a render of the raw .glb
 * would skip every one of those steps and prove nothing about what a player sees).
 *
 * Every eval here is wrapped so a missing field returns a string instead of stalling the run —
 * that is the specific failure mode inherited from shot-scooter.mjs and it is not repeated.
 *
 *   node tools/shot-car.mjs --car rally --url http://127.0.0.1:4188/ --out shots/warthog.png
 *   node tools/shot-car.mjs --car coupe --drive 6000 --seed 20260804
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const CAR = arg('car', 'rally');
const BASE = arg('url', 'http://127.0.0.1:4188/');
const SEED = arg('seed', '20260804');
const DRIVE = Number(arg('drive', 6000));
const OUT = arg('out', `shots/${CAR}.png`);
const EXTRA = arg('params', '');
const SETUP = arg('setup', '');
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
/* A port of its own. The proof gallery holds 9993 and shot-scooter holds 9988; two harnesses
 * sharing a debugging port attach to each other's tabs and produce a screenshot of the wrong
 * page, which is worse than failing. */
const PORT = Number(arg('port', 9971));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,800',
    '--hide-scrollbars',
    '--no-first-run',
    '--user-data-dir=' + (process.env.TEMP || '.') + `/shot-car-${PORT}`,
    '--enable-unsafe-swiftshader',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws = null;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(500);
  try {
    ws = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
  } catch {
    /* chrome is still coming up */
  }
}
if (!ws) {
  chrome.kill();
  throw new Error('chrome never opened a debugging socket');
}

const sock = new WebSocket(ws);
await new Promise((res, rej) => {
  sock.onopen = res;
  sock.onerror = () => rej(new Error('cdp websocket failed'));
});
let id = 0;
const pending = new Map();
sock.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
/* EVERY CALL IS TIMED OUT. An un-timed CDP round trip is exactly how shot-scooter.mjs ends up
 * with "unsettled top-level await" and no picture: one evaluate that never answers stalls the
 * whole script with no error to read. A rejected promise at least says which call died. */
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const n = ++id;
    const t = setTimeout(() => rej(new Error(`cdp timeout on ${method}`)), 90000);
    pending.set(n, (m) => {
      clearTimeout(t);
      res(m);
    });
    sock.send(JSON.stringify({ id: n, method, params, sessionId }));
  });

const { result: t } = await send('Target.createTarget', { url: 'about:blank' });
const { result: att } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
const S = att.sessionId;
await send('Page.enable', {}, S);
await send('Runtime.enable', {}, S);

/** Evaluate in the page, and NEVER throw out of it — a bad probe returns a string, not a stall. */
const ev = async (expr) => {
  try {
    const r = await send('Runtime.evaluate', { expression: `(()=>{try{return (${expr});}catch(e){return 'ERR '+e.message;}})()`, returnByValue: true }, S);
    return r.result?.result?.value;
  } catch (e) {
    return 'ERR ' + e.message;
  }
};

const url = `${BASE}?unlock=123&fresh=1&car=${CAR}&seed=${SEED}${EXTRA ? '&' + EXTRA : ''}`;
console.log('opening', url);
await send('Page.navigate', { url }, S);
let booted = false;
for (let i = 0; i < 120; i++) {
  await sleep(500);
  if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) {
    booted = true;
    break;
  }
}
if (!booted) {
  chrome.kill();
  throw new Error('the game never booted — window.WANDEROAD.car never appeared');
}
await sleep(2500);

/* Drive, so the picture is of a car on a road rather than a car on a title card. The first
 * keyDown/keyUp pair dismisses the intro; the second press is the one that actually moves. */
const key = async (type, code, vk) => send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: vk, key: code === 'KeyW' ? 'w' : 'r', code }, S);
await key('keyDown', 'KeyW', 87);
await key('keyUp', 'KeyW', 87);
await sleep(400);
await key('keyDown', 'KeyW', 87);
await sleep(DRIVE);
await key('keyUp', 'KeyW', 87);
await sleep(700);

if (SETUP) {
  console.log('   setup:', await ev(SETUP));
  await sleep(1200);
  /* Drive AFTER the setup too. A setup that parks the car somewhere interesting — at the foot of a
   * jump, beside a crate — leaves it stationary, and a photograph of a stopped car proves only that
   * the teleport worked. `--after <ms>` holds W again so the shot is taken while the car is doing
   * the thing the setup put it there to do. */
  const after = Number(arg('after', 0));
  if (after > 0) {
    await key('keyDown', 'KeyW', 87);
    await sleep(after);
    await key('keyUp', 'KeyW', 87);
    await sleep(150);
  }
}

/* THE READING TAKEN AT THE MOMENT OF THE SHOT. A picture with no telemetry beside it cannot say
 * which car it is of, which is the entire question being asked here. `sag` is the live spring
 * compression in metres — the number that says whether the suspension is the soft long-travel
 * one or the stock 42000 N/m fleet spring. */
/* An EXTRA reading, taken after the drive rather than before it — `--read <expr>`. The built-in
 * telemetry below says which car and how fast; a per-run question ("did the suns go up when I drove
 * over that crate") can only be asked by the caller, and it has to be asked AFTER the driving, which
 * is why it lives here and not in `--setup`. */
const READ = arg('read', '');
if (READ) console.log('   reading:', await ev(READ));

const info = await ev(
  `JSON.stringify({
     car: (window.WANDEROAD.model && window.WANDEROAD.model.spec && window.WANDEROAD.model.spec.id) || 'unknown',
     kph: +(window.WANDEROAD.car.speed * 3.6).toFixed(1),
     sag: +(window.WANDEROAD.car.sag ?? 0).toFixed(3),
     onGround: window.WANDEROAD.car.onGround,
     roll: +((window.WANDEROAD.car.roll ?? 0) * 180 / Math.PI).toFixed(2),
   })`
);
console.log('   in game:', info);

mkdirSync(dirname(OUT), { recursive: true });
const shotMsg = await send('Page.captureScreenshot', { format: 'png' }, S);
if (!shotMsg.result) { console.error('captureScreenshot returned:', JSON.stringify(shotMsg).slice(0, 400)); throw new Error('no screenshot data'); }
const shot = shotMsg.result;
const buf = Buffer.from(shot.data, 'base64');
writeFileSync(OUT, buf);
console.log('   wrote', OUT, buf.length, 'bytes');

/* A FLAT FRAME IS NOT A PHOTOGRAPH. browser-test.mjs's own rule: a black screen passes every
 * check ever written, so the picture is measured before it is believed. */
if (buf.length < 20000) console.error('WARNING: suspiciously small PNG — the frame may be blank');

sock.close();
chrome.kill();
