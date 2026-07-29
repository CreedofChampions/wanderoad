/* Wanderoad — does the music actually play, by itself, at the level it was asked for?
 *
 * Operator: "Music should be autoplay at 30%". Two claims, and neither can be answered from
 * the source: a constant set to 0.3 proves nothing about whether a gain node in a running
 * AudioContext is at 0.3, and "autoplay" is a browser policy question that only a browser can
 * answer. So this drives a real headless Chrome, presses a real key (the gesture the policy
 * requires — and the same first key any player presses), and then reads the AudioContext and
 * the radio's own output gain out of the live page.
 *
 * Gotcha this file exists to avoid: `radio.station !== 0` is a FLAG, and a flag being set is
 * not a thing being heard. The assertion below is on `radio.out.gain.value` — the number the
 * Web Audio graph is multiplying by — and on `ctx.state === 'running'`, which is the only
 * evidence that anything is coming out at all.
 *
 *   node tools/diag-radio.mjs [url]
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://localhost:5173/?debug';
const PORT = 9700 + (process.pid % 200);

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(56)} ${String(got).padStart(12)}   want ${want}`);
};

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu-vsync',
    '--no-first-run',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + `/wr-radio-${process.pid}`,
    // NOT --autoplay-policy=no-user-gesture-required: that would make the test pass on a
    // setting no player has. The point is that the game works under the DEFAULT policy.
    '--window-size=900,600',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let ws = null;
for (let i = 0; i < 60 && !ws; i++) {
  await sleep(250);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    ws = (await r.json()).webSocketDebuggerUrl;
  } catch {
    /* not up yet */
  }
}
if (!ws) {
  console.log('could not start Chrome');
  chrome.kill();
  process.exit(1);
}

const sock = new WebSocket(ws); // node 22+ has WebSocket built in — same as tools/shoot.mjs
await new Promise((r) => sock.addEventListener('open', r));

let id = 0;
const pending = new Map();
sock.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((res) => {
    const n = ++id;
    pending.set(n, res);
    sock.send(JSON.stringify({ id: n, method, params, sessionId }));
  });

const { result: targets } = await send('Target.getTargets');
const page = targets.targetInfos.find((t) => t.type === 'page');
const { result: att } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const S = att.sessionId;
await send('Page.enable', {}, S);
await send('Runtime.enable', {}, S);
await send('Input.enable', {}, S).catch(() => {});
await send('Page.navigate', { url: URL }, S);

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, S);
  return r.result?.result?.value;
};

// wait for the game
for (let i = 0; i < 80; i++) {
  await sleep(500);
  if (await evalJs('!!(window.WANDEROAD && window.WANDEROAD.audio)')) break;
}

console.log(`\nWANDEROAD — THE RADIO PLAYS BY ITSELF\n${'-'.repeat(76)}\n${URL}\n`);

const before = await evalJs(`(() => { const a = window.WANDEROAD.audio;
  return { started: !!a._started, ctx: a.ctx ? a.ctx.state : 'none' }; })()`);
console.log(`       before any input: audio graph ${before.started ? 'built' : 'not built'}, context "${before.ctx}"`);
check(!before.started, 'nothing is playing before the player touches anything', before.started ? 'playing' : 'silent', 'silent (browser policy)');

/* The gesture. A real keydown+keyup pair through the DevTools input domain — the same events a
 * keyboard produces, and the same W any player presses first. Pairs, not a bare keydown: this
 * project has been bitten before by a harness that sent only half of one. */
for (const type of ['keyDown', 'keyUp']) {
  await send('Input.dispatchKeyEvent', { type, key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, nativeVirtualKeyCode: 87 }, S);
}
await sleep(2500);

const after = await evalJs(`(() => { const a = window.WANDEROAD.audio; const r = a.radio;
  return { started: !!a._started, ctx: a.ctx ? a.ctx.state : 'none',
           station: r ? r.station : -1, label: r ? r.label : '', on: r ? r.on : false,
           gain: r ? +r.out.gain.value.toFixed(5) : 0, volume: r ? r.volume : 0 }; })()`);

console.log(`       after one keypress: context "${after.ctx}", station ${after.station} "${after.label}", radio gain ${after.gain}`);
check(after.ctx === 'running', 'the audio context is running after one keypress', `"${after.ctx}"`, '"running"');
check(after.on === true, 'a station is selected without anyone choosing one', `${after.station} "${after.label}"`, 'not "Radio off"');
check(Math.abs(after.volume - 0.3) < 1e-6, 'the radio volume is the 30% that was asked for', after.volume, '0.30');
check(after.gain > 0, 'and the gain node in the graph is actually open', after.gain, '> 0');
/* 0.3 x RADIO_GAIN (0.16) = 0.048. Asserted against the product rather than against 0.3,
 * because the number that decides what you HEAR is the one on the node. */
check(Math.abs(after.gain - 0.048) < 0.004, 'at exactly 30% of the radio own ceiling', after.gain, '0.048 (0.30 x 0.16)');

// and the radio key still works: one press should take it off, another back on
await evalJs(`window.WANDEROAD.audio.nextStation()`);
await sleep(400);
const nextOne = await evalJs(`(() => { const r = window.WANDEROAD.audio.radio;
  return { station: r.station, label: r.label, on: r.on }; })()`);
console.log(`       one press of the radio key: station ${nextOne.station} "${nextOne.label}"`);
check(nextOne.station !== after.station, 'the radio key still cycles from wherever it woke up', `${after.station} -> ${nextOne.station}`, 'a different station');

console.log(`\n${failures ? `${failures} RADIO CHECK(S) FAILED` : 'all radio checks passed'}\n`);
sock.close();
chrome.kill();
process.exit(failures ? 1 : 0);
