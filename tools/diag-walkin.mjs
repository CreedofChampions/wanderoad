/* CAN YOU ACTUALLY WALK INTO A SHOWROOM AND BUY A CAR? — in the live bundle.
 *
 * Operator: "Walk-in showrooms seperate to gas stations (walkable mode)".
 *
 * Placement is checked purely by tools/diag-halls.mjs. This is the other half, and it is the half
 * that has historically been wrong in this repo: a rule that passes a fixture while the GAME reads a
 * different list. So this drives the shipped bundle at a real showroom found from the seed, and asks
 * the game itself at every step.
 *
 *   node tools/diag-walkin.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { showroomsInBox, hallSpots, SHOWROOM_HALF_D } from '../src/world/props.js';
import { FLEET, unlockRule } from '../src/game/garage.js';
import { landHeight } from '../src/world/terrain.js';

const SEED = 20260726;
const URL = (process.argv[2] || 'https://cozydriver.com/beta/?debug') + `&seed=${SEED}`;
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9964;
let pass = 0;
let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(54)} ${String(got).padStart(12)}   want ${want}`);
  if (ok) pass++;
  else fail++;
};

const probe = { height: (x, z) => landHeight(x, z, SEED) };
const halls = showroomsInBox(-9000, -9000, 9000, 9000, SEED, probe).sort(
  (a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)
);
const hall = halls[0];
if (!hall) {
  console.log('no showroom within 9 km of the origin — nothing to walk into');
  process.exit(1);
}
const spots = hallSpots(hall);
console.log(`showroom at ${Math.round(hall.x)}, ${Math.round(hall.z)} — ${halls.length} within 9 km`);

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-first-run',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-walk-' + process.pid,
    '--window-size=1382,664',
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

await send('Page.navigate', { url: URL }, S);
for (let i = 0; i < 90; i++) {
  await sleep(500);
  if (await evalIn('!!(window.WANDEROAD && window.WANDEROAD.car)')) break;
}
await sleep(2500);
await key('KeyW', 87, 'w');
await sleep(1200);
await evalIn('localStorage.clear(); window.WANDEROAD.wallet.addSuns(4000); true');

// Park outside the frontage, where a driver would stop.
const ca = Math.cos(hall.yaw);
const sa = Math.sin(hall.yaw);
const parkX = hall.x + (SHOWROOM_HALF_D + 9) * -sa;
const parkZ = hall.z + (SHOWROOM_HALF_D + 9) * ca;
await evalIn(
  `(() => { const c = window.WANDEROAD.car; c.placeAt(${parkX}, ${parkZ}, ${hall.yaw + Math.PI}); c.vx = 0; c.vz = 0; c.speed = 0; return true; })()`
);
/* WAIT FOR THE CELL TO WARM. Showroom placement is gated on `showroomCellsWarm` for the frame
 * budget — a cold cell's road queries cost hundreds of milliseconds each, so an unwarmed tile gets
 * no showroom and picks one up once `warmOne` has resolved it, exactly as airfields and harbours do.
 * A fixed sleep therefore measures the warm-up, not the feature: this polls instead. */
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const n = await evalIn('(window.WANDEROAD.props && window.WANDEROAD.props.halls || []).length');
  if (n > 0) break;
}
await sleep(1500);

/* THE TILER MUST HAVE BUILT IT. `props.halls` is what the game can walk into; a hall that only
 * exists in the seed is not a building. */
const built = await evalIn(
  `(() => { const hs = window.WANDEROAD.props && window.WANDEROAD.props.halls; if (!hs) return 'no list'; const c = window.WANDEROAD.car; let bd = Infinity; for (const h of hs) bd = Math.min(bd, Math.hypot(h.x - c.x, h.z - c.z)); return JSON.stringify({ n: hs.length, nearest: Math.round(bd) }); })()`
);
const b = built && built.startsWith('{') ? JSON.parse(built) : null;
check(!!b && b.n > 0, 'the tiler actually built a showroom', b ? b.n : built, '> 0');
check(!!b && b.nearest < 40, 'and it is the one we parked at', b ? `${b.nearest} m` : '-', '< 40 m');

// Get out.
await key('KeyZ', 90, 'z');
await sleep(1600);
const onFoot = await evalIn(
  "(() => { const w = window.WANDEROAD.walker; return w ? JSON.stringify({ active: w.active, toCar: +w.toCar.toFixed(1) }) : 'not exposed'; })()"
);
const w1 = onFoot && onFoot.startsWith('{') ? JSON.parse(onFoot) : null;
check(!!w1 && w1.active === true, 'pressing Z gets you OUT of the car', w1 ? w1.active : onFoot, 'true');
check(!!w1 && w1.toCar < 4, 'and puts you beside it, not inside it', w1 ? `${w1.toCar} m` : '-', '< 4 m');

/* WALK IN THROUGH THE DOORWAY. Teleporting the walker inside would prove nothing about the doorway
 * being a hole in the wall, so this walks: hold W, aimed at the door, and see where it ends up. */
const doorX = hall.x + SHOWROOM_HALF_D * -sa;
const doorZ = hall.z + SHOWROOM_HALF_D * ca;
/* OUTSIDE the doorway, facing it. Local +z is the road-facing side, which in world is (-sa, ca), so
 * "5 m outside the door" is the door PLUS that, and the heading that walks in is its negation. The
 * first version got both signs wrong and started the walker inside the building, then reported the
 * doorway as impassable — the check was broken, not the door. */
const outX = doorX + -sa * 5;
const outZ = doorZ + ca * 5;
const inYaw = Math.atan2(sa, -ca);
await evalIn(
  `(() => { const w = window.WANDEROAD.walker; w.x = ${outX}; w.z = ${outZ}; w.yaw = ${inYaw}; return true; })()`
);
await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
await sleep(4200);
await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
await sleep(600);
const inside = await evalIn(
  `(() => { const w = window.WANDEROAD.walker; const ca = ${ca}, sa = ${sa};
    const dx = w.x - ${hall.x}, dz = w.z - ${hall.z};
    return JSON.stringify({ lx: +(dx * ca + dz * sa).toFixed(1), lz: +(-dx * sa + dz * ca).toFixed(1) }); })()`
);
const p2 = JSON.parse(inside);
check(
  Math.abs(p2.lz) < SHOWROOM_HALF_D && Math.abs(p2.lx) < 17,
  'walking forward carries you IN through the doorway',
  `local ${p2.lx}, ${p2.lz}`,
  `inside +/-17 x +/-${SHOWROOM_HALF_D}`
);

// Stand at a bay and buy the car there.
/* THE FIRST BAY HOLDING A CAR YOU CAN ONLY BUY, found by rule rather than by index.
 *
 * This used to hard-code bay 4 and the name "Sedan". Bays are filled in FLEET order, so the moment
 * the hatch became the starter car the order shifted and bay 4 held the Coupe — the check went red
 * with nothing wrong. A wallet with 4000 suns collected already owns every `earn` car, so only a
 * `buy` car can prove that pressing X actually BUYS something. */
const buyIdx = FLEET.findIndex((c) => unlockRule(c).how === 'buy');
const buyCar = FLEET[buyIdx];
const target = spots[buyIdx];
console.log(`       bay ${buyIdx + 1} holds the ${buyCar.label}, which can only be bought`);
await evalIn(`(() => { const w = window.WANDEROAD.walker; w.x = ${target.x}; w.z = ${target.z + 2.4}; return true; })()`);
await evalIn("(() => { window.__says = []; const el = document.getElementById('toast'); new MutationObserver(() => { const t = (el.textContent || '').trim(); if (t && window.__says[window.__says.length - 1] !== t) window.__says.push(t); }).observe(el, { childList: true, characterData: true, subtree: true }); return true; })()");
await sleep(2200);
const says = JSON.parse((await evalIn('JSON.stringify(window.__says || [])')) || '[]');
const named = says.find((l) => new RegExp(buyCar.label, 'i').test(l)) || '';
check(!!named, 'standing at a bay names the car on it', `"${named.slice(0, 28) || says.join('|').slice(0, 28)}"`, `names ${buyCar.label}`);

await key('KeyX', 88, 'x');
await sleep(3000);
const after = await evalIn(
  `(() => ({ owns: window.WANDEROAD.wallet.owns('${buyCar.id}', '${FLEET[0].id}'), car: window.WANDEROAD.model && window.WANDEROAD.model.source, suns: window.WANDEROAD.wallet.suns }))()`
);
check(after && after.owns === true, 'and pressing X in the showroom BUYS it', after && after.owns, 'true');
check(after && after.car === buyCar.id, 'and puts you in it', after && after.car, buyCar.id);

/* GETTING BACK IN HAS TO NEED YOU TO BE THERE. Otherwise the car is a teleport, not a car. */
await evalIn(`(() => { const w = window.WANDEROAD.walker; w.x = w.carX + 60; w.z = w.carZ + 60; return true; })()`);
await sleep(700);
await key('KeyZ', 90, 'z');
await sleep(1200);
const stillOut = await evalIn('window.WANDEROAD.walker.active');
check(stillOut === true, 'you cannot get in from 85 m away', stillOut, 'true (still on foot)');
await evalIn(`(() => { const w = window.WANDEROAD.walker; w.x = w.carX + 1.2; w.z = w.carZ; return true; })()`);
await sleep(700);
await key('KeyZ', 90, 'z');
await sleep(1400);
const backIn = await evalIn('window.WANDEROAD.walker.active');
check(backIn === false, 'and you can from beside it', backIn, 'false (driving)');

console.log(`\n${pass}/${pass + fail} checks passed`);
sock.close();
chrome.kill();
process.exit(fail ? 1 : 0);
