/* Wanderoad — does driving well actually pay?
 *
 * Operator: "Streaks = coins." A bench can prove the arithmetic (tools/bench-economy.mjs does),
 * but only the real game can prove the WIRING: that main.js calls mintStreak with the streak's
 * real distance, every frame, in the built bundle that is actually deployed. So this drives a
 * real headless Chrome down a real road with a real keypress and watches the wallet.
 *
 *   node tools/diag-coins.mjs [url]
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
  return { coins: W.wallet ? W.wallet.coins : -1, hasWallet: !!W.wallet }; })()`);
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
 * exactly that and banked 19 m. This is browser-test.mjs's own roadRunUp steering, verbatim in
 * shape: real KeyboardEvents, only ever A, D or neither, aiming at the centreline a second or so
 * up the road. try/FINALLY so a thrown terrain rebuild cannot leave W held down. */
const drive = (ms) => evalJs(`(async () => { const W = window.WANDEROAD; const c = W.car;
  const K = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
  let cur = 0;
  const set = (s) => { if (s === cur) return;
    if (cur === 1) K('KeyA','keyup'); else if (cur === -1) K('KeyD','keyup');
    if (s === 1) K('KeyA','keydown'); else if (s === -1) K('KeyD','keydown');
    cur = s; };
  const q0 = c.terrain.roads.query(c.x, c.z);
  if (isFinite(q0.d)) c.placeAt(q0.qx, q0.qz, Math.atan2(q0.tx, q0.tz));
  let best = 0, coins = W.wallet.coins;
  K('KeyW','keydown');
  try {
    const t0 = performance.now();
    while (performance.now() - t0 < ${ms}) {
      await new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } };
        requestAnimationFrame(f); setTimeout(f, 50); });
      const L = Math.min(34, Math.max(10, 8 + Math.abs(c.speed) * 0.75));
      const q = c.terrain.roads.query(c.x + Math.sin(c.yaw)*L, c.z + Math.cos(c.yaw)*L);
      if (!isFinite(q.d)) { set(0); continue; }
      let e = Math.atan2(q.qx - c.x, q.qz - c.z) - c.yaw;
      while (e > Math.PI) e -= Math.PI*2; while (e <= -Math.PI) e += Math.PI*2;
      set(e > 0.02 ? 1 : e < -0.02 ? -1 : 0);
      best = Math.max(best, W.streak.state.distance);
      coins = W.wallet.coins;
    }
  } finally { set(0); K('KeyW','keyup'); }
  return { best, coins, kph: +c.kph.toFixed(1) }; })()`);

let best = 0;
let coins = start.coins;
for (let leg = 0; leg < 4 && coins < start.coins + 2; leg++) {
  const r = await drive(15000);
  if (!r) continue;
  best = Math.max(best, r.best);
  coins = r.coins;
  console.log(`       leg ${leg + 1}: ${r.kph} km/h, best streak this leg ${r.best.toFixed(0)} m, ${r.coins} coins`);
}

const { STREAK_METRES_PER_COIN } = await import('../src/game/wallet.js');
const earned = coins - start.coins;
const expect = Math.floor(best / STREAK_METRES_PER_COIN);
console.log(`       banked ${best.toFixed(0)} m of streak and earned ${earned} coin(s) (rate: one per ${STREAK_METRES_PER_COIN} m)`);
check(best > STREAK_METRES_PER_COIN, 'the drive actually banked a streak worth paying for', `${best.toFixed(0)} m`, `> ${STREAK_METRES_PER_COIN} m`);
check(earned >= 1, 'DRIVING WELL PAYS COINS in the built game', earned, '>= 1');
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
  check(deals.length > 0, 'there is somewhere to spend the coins near the car', deals.length, '>= 1');
  check(isFinite(closest) && closest < R, 'and it is within driving distance', isFinite(closest) ? `${closest.toFixed(0)} m` : 'none', `< ${R} m`);
}

console.log(`\n${failures ? `${failures} COIN CHECK(S) FAILED` : 'all coin checks passed'}\n`);
sock.close();
chrome.kill();
process.exit(failures ? 1 : 0);
