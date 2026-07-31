/* Wanderoad — does driving well actually pay?
 *
 * Operator: "Streaks = suns." A bench can prove the arithmetic (tools/bench-economy.mjs does),
 * but only the real game can prove the WIRING: that main.js calls mintStreak with the streak's
 * real distance, every frame, in the built bundle that is actually deployed. So this drives a
 * real headless Chrome down a real road with a real keypress and watches the wallet.
 *
 *   node tools/diag-suns.mjs [url]
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

console.log(`\nWANDEROAD — DRIVING WELL PAYS\n${'-'.repeat(76)}\n${URL}\n`);

const start = await evalJs(`(() => { const W = window.WANDEROAD;
  return { suns: W.wallet ? W.wallet.suns : -1, hasWallet: !!W.wallet }; })()`);
check(start.hasWallet, 'the game exposes the wallet it actually spends from', start.hasWallet, 'true');

/* Put the car on a road pointing along it — the same backToRoad() R calls — then hold W. A
 * streak only accrues above 8 m/s and only on the carriageway, so a run that never gets on a
 * road is measuring the terrain, not the economy. */
await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
  const q = c.terrain.roads.query(c.x, c.z);
  if (isFinite(q.d)) c.placeAt(q.qx, q.qz, Math.atan2(q.tx, q.tz)); })()`);
await sleep(400);

/* DRIVE IT DOWN THE ROAD, WITH STEERING. Holding W alone leaves the carriageway at the first
 * bend, which measures the terrain rather than the economy — the first version of this file did
 * exactly that and banked 19 m.
 *
 * PORTED FROM `DRIVE_BY_HAND` in tools/browser-test.mjs (the law `diag-manual-streak.mjs` already
 * trusts offline, "proves it banks on five different roads" — see that file's own header). The
 * PREVIOUS version of this function was a cruder ancestor of that law: heading-only steering, no
 * lateral term, and — critically — no speed cap, so it held W all the way to 86 km/h and could not
 * keep up with a real curve at that speed. Measured live: leg 5 went from 86 km/h to 0 and stayed
 * there for legs 6-8, the streak dead for the rest of the run. `DRIVE_BY_HAND` adds the lateral
 * term, a speed cap that tightens in a turn (36 vs 45 km/h), a brake once over cap+15, and one
 * budgeted R-rescue if it does still get lost — KEEP IN STEP WITH both those files if the law
 * changes again. */
const drive = (ms) => evalJs(`(() => new Promise((done) => {
  const W = window.WANDEROAD, c = W.car;
  const send = (code, type) => window.dispatchEvent(
    new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
  const held = new Set();
  const set = (code, want) => {
    if (want && !held.has(code)) { held.add(code); send(code, 'keydown'); }
    else if (!want && held.has(code)) { held.delete(code); send(code, 'keyup'); }
  };
  let best = 0, suns = W.wallet.suns, rescues = 0, lost = 0;
  const t0 = performance.now();
  const id = setInterval(() => {
    const since = performance.now() - t0;
    try {
      const q = c.terrain.roads.query(c.x, c.z);
      const kph = Math.abs(c.kph);
      const off = !isFinite(q.d) || q.d > q.width * 0.5 + 1.5;
      lost = off ? lost + 0.04 : 0;
      if (lost >= 0.6 && rescues < 1 && since < ${ms} - 10000) {
        send('KeyR', 'keydown'); send('KeyR', 'keyup');
        rescues++; lost = 0;
        set('KeyA', false); set('KeyD', false); set('KeyS', false); set('KeyW', true);
      } else if (isFinite(q.d)) {
        let tx = q.tx, tz = q.tz;
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        if (fx * tx + fz * tz < 0) { tx = -tx; tz = -tz; }
        const lateral = (c.x - q.qx) * tz - (c.z - q.qz) * tx;
        let head = Math.atan2(tx, tz) - c.yaw;
        while (head > Math.PI) head -= Math.PI * 2;
        while (head < -Math.PI) head += Math.PI * 2;
        const want = -lateral * 0.30 + head * 2.4;
        set('KeyA', want > 0.16);
        set('KeyD', want < -0.16);
        const cap = Math.abs(lateral) > 1.6 ? 36 : 45;
        set('KeyW', kph < cap);
        set('KeyS', kph > cap + 15);
      } else {
        set('KeyA', false); set('KeyD', false); set('KeyS', false); set('KeyW', kph < 40);
      }
      best = Math.max(best, W.streak.state.distance);
      suns = W.wallet.suns;
    } catch (e) { /* one bad frame must not leave the keys jammed down */ }
    if (since >= ${ms}) {
      clearInterval(id);
      for (const code of Array.from(held)) set(code, false);
      done({ best, suns, rescues, kph: +c.kph.toFixed(1) });
    }
  }, 40);
}))()`);

/* MILESTONES_M/milestoneReward, not a flat STREAK_METRES_PER_SUN: the economy was rewritten to
 * "ONE BAR, ONE MILESTONE, ONE SUN" (wallet.js's own header) — the first bar is a full 1000 m,
 * not a flat few-hundred-metre rate, so this needs enough road to actually finish one. `wallet.js`
 * stopped exporting STREAK_METRES_PER_SUN when that landed and this file was never updated to
 * match — it was failing on every run, always reporting "rate: one per undefined m", regardless
 * of the drive. Caught running the mandated testing cycle after an unrelated change. */
const { MILESTONES_M, milestoneLength, milestoneReward } = await import('../src/game/wallet.js');

let best = 0;
let suns = start.suns;
// Up to 20 legs (300 s): the first 1000 m milestone is real road, and this seed's own network
// has at least one spot (measured: ~850-900 m in) the ported DRIVE_BY_HAND steering still loses
// once in a while — its own budgeted R-rescue recovers it, but that resets the streak, so the
// run needs enough legs left afterward to rebuild past 1000 m rather than a shorter first bar.
for (let leg = 0; leg < 20 && suns < start.suns + 2 && best < MILESTONES_M[0] * 1.2; leg++) {
  const r = await drive(15000);
  if (!r) continue;
  best = Math.max(best, r.best);
  suns = r.suns;
  console.log(`       leg ${leg + 1}: ${r.kph} km/h, best streak this leg ${r.best.toFixed(0)} m, ${r.suns} suns`);
}

const earned = suns - start.suns;
// Suns owed for every milestone actually finished, walking the real ladder rather than a flat
// rate — same arithmetic bench-economy.mjs already asserts, just fed this run's own `best`.
let expect = 0;
let cum = 0;
for (let i = 0; cum + milestoneLength(i) <= best; i++) {
  expect += milestoneReward(i);
  cum += milestoneLength(i);
}
console.log(`       banked ${best.toFixed(0)} m of streak and earned ${earned} sun(s) (first milestone: ${MILESTONES_M[0]} m for ${milestoneReward(0)} sun)`);
check(best > MILESTONES_M[0], 'the drive actually banked a streak worth paying for', `${best.toFixed(0)} m`, `> ${MILESTONES_M[0]} m (the first milestone)`);
check(earned >= 1, 'DRIVING WELL PAYS SUNS in the built game', earned, '>= 1');
check(earned <= expect + 1, 'and it pays the rate, not a random number', earned, `<= ${expect + 1}`);

/* And the shop is reachable from where the car actually is. Asked of the WORLD function rather
 * than the renderer: render/props.js only knows the tiles that happen to be loaded, so a null
 * from it means "not streamed in yet", not "there is no dealership". The world function is pure
 * and knows the whole plane. */
const pose = await evalJs(`(() => { const c = window.WANDEROAD.car;
  return { x: c.x, z: c.z, seed: window.WANDEROAD.seed ?? null }; })()`);
const { stationsInBox } = await import('../src/world/props.js');
if (pose.seed === null || pose.seed === undefined) {
  console.log('       (the page does not expose its seed; the shop check needs it)');
  check(false, 'the page exposes its seed so the shop can be found', 'null', 'a number');
} else {
  const R = 3000;
  const near = stationsInBox(pose.x - R, pose.z - R, pose.x + R, pose.z + R, pose.seed);
  const deals = near.filter((s) => s.deal);
  let closest = Infinity;
  for (const d of deals) closest = Math.min(closest, Math.hypot(d.x - pose.x, d.z - pose.z));
  console.log(`       from (${pose.x.toFixed(0)},${pose.z.toFixed(0)}): ${near.length} stations within ${R} m, ${deals.length} dealerships, nearest ${isFinite(closest) ? closest.toFixed(0) + ' m' : 'none'}`);
  check(deals.length > 0, 'there is somewhere to spend the suns near the car', deals.length, '>= 1');
  check(isFinite(closest) && closest < R, 'and it is within driving distance', isFinite(closest) ? `${closest.toFixed(0)} m` : 'none', `< ${R} m`);
}

console.log(`\n${failures ? `${failures} SUN CHECK(S) FAILED` : 'all sun checks passed'}\n`);
sock.close();
chrome.kill();
process.exit(failures ? 1 : 0);
