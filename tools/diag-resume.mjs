/* DOES THE GAME PUT YOU BACK WHERE YOU LEFT OFF? — against the live bundle.
 *
 * Operator: "we need to make it so people can continue were they left off."
 *
 * The only honest test of a resume is a RELOAD. Everything here goes through the real page lifecycle:
 * the position is written by the game's own `pagehide` handler, the tab is genuinely navigated away
 * and back, and what comes up is read out of the running game rather than out of localStorage. A
 * check that read back the record it just wrote would pass with the restore completely unwired.
 *
 *   node tools/diag-resume.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const SEED = 20260726;
const BASE = process.argv[2] || 'https://cozydriver.com/beta/?debug';
const URL = `${BASE}&seed=${SEED}`;
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9968;
let pass = 0;
let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(56)} ${String(got).padStart(14)}   want ${want}`);
  if (ok) pass++;
  else fail++;
};

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-first-run',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-resume-' + process.pid,
    '--window-size=1280,720',
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
const evalIn = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true }, S)).result?.result?.value;
const key = async (code, vk, k) => {
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: vk, key: k, code }, S);
};
const boot = async (url) => {
  await send('Page.navigate', { url }, S);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (await evalIn('!!(window.WANDEROAD && window.WANDEROAD.car)')) break;
  }
  await sleep(2500);
  await key('KeyW', 87, 'w');
  await sleep(1200);
};

/* ── a genuinely fresh player ───────────────────────────────────────────────── */
await boot(URL + '&fresh=1');
const spawn0 = await evalIn(
  "(() => { const c = window.WANDEROAD.car; return JSON.stringify({ x: Math.round(c.x), z: Math.round(c.z) }); })()"
);
const p0 = JSON.parse(spawn0);
check(true, 'a fresh player starts at the spawn point', `${p0.x}, ${p0.z}`, 'anywhere');

/* ── go somewhere, take a different car, and burn some fuel ─────────────────── */
await evalIn('window.WANDEROAD.wallet.addSuns(5000); true');
await evalIn(
  `(() => { const c = window.WANDEROAD.car; c.placeAt(${p0.x + 1800}, ${p0.z - 1400}, 1.234); c.vx = 0; c.vz = 0; c.speed = 0;
     window.WANDEROAD.fuel.seconds = window.WANDEROAD.fuel.capacity * 0.31; return true; })()`
);
await sleep(3000);
const before = await evalIn(
  "(() => { const W = window.WANDEROAD; return JSON.stringify({ x: Math.round(W.car.x), z: Math.round(W.car.z), yaw: +W.car.yaw.toFixed(3), car: W.model && W.model.source, fuel: Math.round(W.fuel.seconds), frac: +W.fuel.fraction.toFixed(2) }); })()"
);
const b = JSON.parse(before);
console.log(`       parked at ${b.x}, ${b.z} in the ${b.car} with ${b.frac * 100}% of a tank`);
check(Math.hypot(b.x - p0.x, b.z - p0.z) > 1000, 'drove a long way from the spawn point', `${Math.round(Math.hypot(b.x - p0.x, b.z - p0.z))} m`, '> 1000 m');

/* THE REAL LIFECYCLE. `pagehide` is what the game listens for, so fire it the way a closing tab
 * would rather than calling the save function directly — the point is to prove the wiring. */
await evalIn("window.dispatchEvent(new PageTransitionEvent('pagehide')); true");
await sleep(800);
const stored = await evalIn("localStorage.getItem('wanderoad.session.v1')");
check(!!stored, 'closing the tab writes a session record', stored ? 'written' : 'nothing', 'written');

/* ── come back ──────────────────────────────────────────────────────────────── */
await boot(URL);
const after = await evalIn(
  "(() => { const W = window.WANDEROAD; return JSON.stringify({ x: Math.round(W.car.x), z: Math.round(W.car.z), yaw: +W.car.yaw.toFixed(3), car: W.model && W.model.source, fuel: Math.round(W.fuel.seconds) }); })()"
);
const a = JSON.parse(after);
const moved = Math.hypot(a.x - b.x, a.z - b.z);
console.log(`       came back at ${a.x}, ${a.z} in the ${a.car} with ${a.fuel}s of fuel`);
check(moved < 5, 'you come back WHERE YOU LEFT OFF', `${moved.toFixed(1)} m away`, '< 5 m');
check(Math.abs(a.yaw - b.yaw) < 0.05, 'facing the same way', `${Math.abs(a.yaw - b.yaw).toFixed(3)} rad`, '< 0.05');
check(a.car === b.car, 'in the same car', a.car, b.car);
check(Math.abs(a.fuel - b.fuel) < 20, 'with the fuel you parked on, not a free tank', `${a.fuel}s vs ${b.fuel}s`, 'within 20 s');
check(Math.hypot(a.x - p0.x, a.z - p0.z) > 1000, 'and NOT back at the spawn point', `${Math.round(Math.hypot(a.x - p0.x, a.z - p0.z))} m from spawn`, '> 1000 m');

/* ── ?fresh=1 must still mean fresh, or every diagnostic in tools/ is lying ─── */
await boot(URL + '&fresh=1');
const fresh = await evalIn(
  "(() => { const c = window.WANDEROAD.car; return JSON.stringify({ x: Math.round(c.x), z: Math.round(c.z) }); })()"
);
const f = JSON.parse(fresh);
check(Math.hypot(f.x - b.x, f.z - b.z) > 500, '?fresh=1 still starts you over', `${Math.round(Math.hypot(f.x - b.x, f.z - b.z))} m from the saved spot`, '> 500 m');

/* ── a position from ANOTHER world must be refused ──────────────────────────── */
await evalIn(
  `(() => { const c = window.WANDEROAD.car; c.placeAt(${p0.x + 2400}, ${p0.z + 2400}, 0.5); return true; })()`
);
await sleep(1500);
await evalIn("window.dispatchEvent(new PageTransitionEvent('pagehide')); true");
await sleep(800);
await boot(`${BASE}&seed=${SEED + 7}`);
const other = await evalIn(
  "(() => { const c = window.WANDEROAD.car; return JSON.stringify({ x: Math.round(c.x), z: Math.round(c.z) }); })()"
);
const o = JSON.parse(other);
check(
  Math.hypot(o.x - (p0.x + 2400), o.z - (p0.z + 2400)) > 500,
  'a saved spot is NOT restored into a different seed',
  `${Math.round(Math.hypot(o.x - (p0.x + 2400), o.z - (p0.z + 2400)))} m away`,
  '> 500 m'
);

console.log(`\n${pass}/${pass + fail} checks passed`);
sock.close();
chrome.kill();
process.exit(fail ? 1 : 0);
