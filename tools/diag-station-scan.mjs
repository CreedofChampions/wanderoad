/* Wanderoad — does the game know which petrol station you are standing on?
 *
 * Operator, twice: "turning into gas station still kills streak!!", and after a fix shipped, "Hey
 * going in gas station still cancels streak".
 *
 * The forgiveness rule itself was never broken — a fixture proved it kept every metre of a streak
 * across a forecourt. What was broken is what the rule was handed. `fuel.nearest` came from
 * `props.nearestStation`, which reports out of the tiles the RENDERER has baked, and this diagnostic
 * is what caught it: parked on a real forecourt, that list knew of no station at all.
 *
 *   before: { truthDist: 0, reported: null, nearStation: false, baked: null }
 *   after:  { truthDist: 0, reported: 0,    nearStation: true,  baked: null }
 *
 * `baked: null` in BOTH is the finding. The renderer's answer was absent, so a rule expressed as a
 * radius around it could never fire, and no amount of widening the radius would have helped. main.js
 * now asks the pure world function as well and takes the nearer answer.
 *
 * Kept as a check rather than a one-off script because this is a class of bug, not an instance: any
 * rule that reads a STREAMED list and is expressed in metres can fail exactly this way.
 *
 *   node tools/diag-station-scan.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const URL = process.argv[2] || 'http://localhost:5173/?debug';
const PORT = 9910;
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run',
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-st-' + process.pid, '--window-size=1200,800', 'about:blank'], { stdio: 'ignore' });
let ws = null;
for (let i = 0; i < 60 && !ws; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); ws = (await r.json()).webSocketDebuggerUrl; } catch {} }
const sock = new WebSocket(ws); await new Promise(r => sock.addEventListener('open', r));
let id = 0; const pend = new Map();
sock.addEventListener('message', m => { const x = JSON.parse(m.data); if (x.id && pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
const send = (method, params = {}, sessionId) => new Promise(res => { const n = ++id; pend.set(n, res); sock.send(JSON.stringify({ id: n, method, params, sessionId })); });
const { result: t } = await send('Target.getTargets');
const page = t.targetInfos.find(x => x.type === 'page');
const { result: att } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const S = att.sessionId;
await send('Page.enable', {}, S); await send('Runtime.enable', {}, S);
await send('Page.navigate', { url: URL }, S);
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, S)).result?.result?.value;
for (let i = 0; i < 80; i++) { await sleep(500); if (await ev('!!(window.WANDEROAD && window.WANDEROAD.fuel)')) break; }

/* THE TRUTH IS COMPUTED IN NODE, not in the page.
 *
 * The first version did `await import('/src/world/props.js')` inside the browser, which works against
 * the dev server and fails silently against a DEPLOYED build — there is no /src there, only a bundle,
 * so every reading came back undefined and the checks "failed" for a reason that had nothing to do
 * with the game. The pure world functions are importable here, so this asks node where the nearest
 * station is and only uses the browser for what only a browser can answer. */
const { nearestStation } = await import('../src/world/props.js');

const pose = await ev(`(() => { const c = window.WANDEROAD.car;
  return { x: c.x, z: c.z, seed: window.WANDEROAD.seed }; })()`);
const truth = pose ? nearestStation(pose.x, pose.z, pose.seed, 4000) : null;

let out;
if (!truth) {
  out = { error: `no station within 4 km of (${pose ? pose.x.toFixed(0) : '?'},${pose ? pose.z.toFixed(0) : '?'}) on seed ${pose ? pose.seed : '?'}` };
} else {
  /* Park the car ON that forecourt and give the game a moment: the station scan runs on a timer (see
   * main.js's stationScan) and the streak needs a frame or two to report its own state. */
  out = await ev(`(async () => {
    const W = window.WANDEROAD, c = W.car;
    c.placeAt(${truth.x}, ${truth.z}, c.yaw);
    await new Promise(r => setTimeout(r, 1400));
    const near = W.fuel.nearest;
    return {
      truthDist: Math.round(Math.hypot(${truth.x} - c.x, ${truth.z} - c.z)),
      reported: near ? Math.round(near.dist) : null,
      nearStation: !!W.streak.state.nearStation,
      baked: (() => { const b = W.props.nearestStation(c.x, c.z); return b ? Math.round(b.dist) : null; })(),
    };
  })()`);
}

let failures = 0;
const check = (ok, label, got, want) => {
  if (!ok) failures++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${label.padEnd(58)} ${String(got).padStart(14)}   want ${want}`);
};

console.log(`
WANDEROAD — DOES THE GAME KNOW WHICH STATION YOU ARE ON?
${'-'.repeat(80)}
${URL}
`);
if (!out || out.error) {
  check(false, 'a station was found in the world near spawn', out ? out.error : 'no result', 'a station');
} else {
  console.log(`       parked ON a forecourt: the world says ${out.truthDist} m, the game reports ${out.reported === null ? 'null' : out.reported + ' m'}, the renderer's baked list says ${out.baked === null ? 'null' : out.baked + ' m'}`);
  check(out.truthDist <= 2, 'the car really is on the forecourt', `${out.truthDist} m`, '<= 2 m');
  check(out.reported !== null, 'the game knows there is a station here at all', out.reported === null ? 'null' : `${out.reported} m`, 'a distance');
  check(out.reported !== null && out.reported <= 5, 'and knows it is THIS one, not one a kilometre away', out.reported === null ? 'null' : `${out.reported} m`, '<= 5 m');
  check(out.nearStation === true, 'so the streak forgiveness is actually active', out.nearStation, 'true');
}
console.log(`
${failures ? `${failures} STATION-SCAN CHECK(S) FAILED` : 'all station-scan checks passed'}
`);
sock.close();
chrome.kill();
process.exit(failures ? 1 : 0);
