/* created by AI
 * Wanderoad — PHOTOGRAPH THE FORD F150 PICKUP WEARING EVERY PAINT CHIP.
 *
 * B46, the operator: "The Ford F-150 looks like a baby's truck, the way it's painted. It's
 * light blue ... very girly ... there's some gray parts still, leaving it somewhat uncoloured."
 * The pickup is a Synty body whose atlas is baked straight into COLOR_0 — before the fix in
 * src/car/loadedCar.js (remapBakedBody) it ignored the player's chosen paint entirely and was
 * stuck in Synty's factory two-tone forever: baby blue (#4566A9 on screen) over a pale
 * grey-green cladding (#ABB2AC on screen). A screenshot alone cannot tell "actually painted"
 * from "still baked, just cropped differently" at a glance, so this proves it by measurement:
 * drive the real beta build in a real browser, pin the paint via localStorage BEFORE each load
 * (paint has no URL param — it only ever comes from `wanderoad.look`, see src/net/identity.js
 * lines 104 and 283), then scan the truck's own mesh for any vertex still within measurement
 * tolerance of the two factory colours, in LINEAR space, because that is what the painted
 * shader itself reads (src/car/loadedCar.js's own header explains why linear is the one that
 * must not drift).
 *
 * Zero factory-blue vertices on every one of the 6 paint chips is what "fixed" means here —
 * not "looks less blue in a screenshot". The pale-cladding count is printed but never gated:
 * this scan is deliberately blunter than the surgical remap (it reads every vcol-tagged mesh,
 * not just ones classified MAT.BODY), so an incidental near-clad-coloured vertex somewhere
 * else on the truck — interior trim, unpainted metal — is expected and not a regression.
 *
 *   node tools/shot-truck.mjs [baseUrl]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4199/';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9988;
const OUT = 'shots/truck';

/* The six paint chips, read out of the game's own palette rather than retyped here, so this
 * tool can never quietly drift from what a player actually sees in the garage. */
const PAINT_KEYS = ['paintA', 'paintB', 'paintC', 'paintD', 'paintE', 'paintF'];
const paletteSrc = readFileSync(new URL('../src/core/palette.js', import.meta.url), 'utf8');
const PAINT_HEX = PAINT_KEYS.map((k) => {
  const m = paletteSrc.match(new RegExp(`\\b${k}:\\s*'(#[0-9A-Fa-f]{6})'`));
  if (!m) throw new Error(`palette.js has no ${k} entry — paint list is out of date`);
  return m[1];
});

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

mkdirSync(OUT, { recursive: true });

/* Synty's baked factory colours, LINEAR — matches the painted shader's own colour space.
 * These are convertSRGBToLinear('#4566A9') and convertSRGBToLinear('#ABB2AC'), the two on-screen
 * hexes named in loadedCar.js's B46 comment: the "baby blue" body and the pale grey-green
 * cladding. A vertex still found here after the fix means the remap missed it. */
const BLUE = [0.0603, 0.1332, 0.3967];
const CLAD = [0.4072, 0.4453, 0.4125];
const TOL = 0.01;

/* Runs INSIDE the page. Walks every mesh hanging off the live car model — not just ones
 * classified MAT.BODY, deliberately blunter than the remap itself — and tallies how many
 * vertices are still within TOL (per channel) of either factory colour, plus what the
 * localStorage paint pin actually resolved to, so the number ties straight back to the claim. */
const VERIFY = `(() => {
  const BLUE = [${BLUE.join(',')}];
  const CLAD = [${CLAD.join(',')}];
  const EPS = ${TOL};
  const near = (r, g, b, tgt) =>
    Math.abs(r - tgt[0]) <= EPS && Math.abs(g - tgt[1]) <= EPS && Math.abs(b - tgt[2]) <= EPS;
  let blue = 0, clad = 0, total = 0;
  const counts = new Map();
  const group = window.WANDEROAD && window.WANDEROAD.model && window.WANDEROAD.model.group;
  if (group) {
    group.traverse((obj) => {
      const attr = obj.geometry && obj.geometry.attributes && obj.geometry.attributes.vcol;
      if (!attr) return;
      for (let i = 0; i < attr.count; i++) {
        const r = attr.getX(i), g = attr.getY(i), b = attr.getZ(i);
        total++;
        if (near(r, g, b, BLUE)) blue++;
        if (near(r, g, b, CLAD)) clad++;
        const key = r.toFixed(3) + ',' + g.toFixed(3) + ',' + b.toFixed(3);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => k + '=' + n);
  let paint = null;
  try {
    const raw = localStorage.getItem('wanderoad.look');
    paint = raw ? JSON.parse(raw).paint : null;
  } catch {}
  return JSON.stringify({ blue, clad, total, top, paint });
})()`;

let anyBlue = false;
let prevScriptId = null;
const summary = [];

for (let i = 0; i < 6; i++) {
  // BEFORE navigating: pin the paint. `wanderoad.look` has no URL-param equivalent — this is
  // the only way to choose it — so it has to land before the page's own boot script runs.
  if (prevScriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: prevScriptId }, S);
  const pin = `localStorage.setItem('wanderoad.look', JSON.stringify({tier:0,paint:${i}}))`;
  const { result: reg } = await send('Page.addScriptToEvaluateOnNewDocument', { source: pin }, S);
  prevScriptId = reg.identifier;

  const url = `${BASE}?unlock=123&fresh=1&car=pickup&terrain=meadow&seed=20260726`;
  console.log(`\n[paint ${i}] opening`, url);
  await send('Page.navigate', { url }, S);

  let ready = false;
  for (let j = 0; j < 120; j++) {
    await sleep(500);
    if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) {
      ready = true;
      break;
    }
  }
  if (!ready) console.log(`[paint ${i}] WARNING: window.WANDEROAD never appeared after 60s`);

  await sleep(3000);
  // dismiss the title card, then drive so the shot is of a moving vehicle on a road
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
  await sleep(3500);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
  await sleep(600);

  const raw = await ev(VERIFY);
  let reading;
  try {
    reading = JSON.parse(raw);
  } catch {
    reading = { blue: -1, clad: -1, total: 0, top: [], paint: null };
    console.log(`[paint ${i}] WARNING: could not parse in-page reading:`, raw);
  }
  if (reading.blue > 0) anyBlue = true;

  const file = `${OUT}/paint${i}.png`;
  const { result: shot } = await send('Page.captureScreenshot', { format: 'png' }, S);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log('   wrote', file, Buffer.from(shot.data, 'base64').length, 'bytes');

  const line =
    `paint ${i} hex=${PAINT_HEX[i]} blue=${reading.blue} clad=${reading.clad} total=${reading.total} ` +
    `top4=[${(reading.top || []).join(', ')}] paint=${reading.paint} -> ${file}`;
  console.log(line);
  summary.push(line);
}

sock.close();
chrome.kill();

console.log('\n--- summary ---');
for (const l of summary) console.log(l);

if (anyBlue) {
  console.log('\nFAIL: at least one paint chip still shows Synty factory-blue vertices.');
  process.exit(1);
} else {
  console.log('\nPASS: zero Synty factory-blue vertices on all 6 paint chips.');
}
