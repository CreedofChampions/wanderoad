/* THE TWO UNLOCK LADDERS, IN THE LIVE GAME AND THROUGH THE REAL UI.
 *
 * Operator: "Maybe we can have the first three cars be total collected, and then the rest will be
 * find a dealership." The bench proves the rule; this proves the GAME — because a fixture passing is
 * not the game working, and this repo has already shipped a station-forgiveness rule that passed its
 * fixture for a week while being broken live.
 *
 * So this drives the shipped bundle: it adds suns the same way a pickup does, waits for the frame
 * loop to notice, then OPENS THE GARAGE and reads the buttons — locked or not, and what the label
 * says you have to do. The label is half the feature: a locked car that quotes a dealership price
 * when the way in is to collect seventy suns sends the player to the wrong place.
 *
 *   node tools/diag-unlocks.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { stationsInBox, showroomSpots } from '../src/world/props.js';

const URL = process.argv[2] || 'https://cozydriver.com/beta/?debug';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9954;
let pass = 0;
let fail = 0;
const check = (ok, what, got, want) => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${what.padEnd(58)} ${String(got).padStart(9)}   want ${want}`);
  if (ok) pass++;
  else fail++;
};

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-first-run',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-unlock-' + process.pid,
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
const evalIn = async (expression) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true }, S)).result?.result?.value;

/* A CLEAN PLAYER. The unlock rule reads a persisted odometer, so a store left over from an earlier
 * run would make every check below meaningless. Wipe, then load again. */
await send('Page.navigate', { url: URL }, S);
for (let i = 0; i < 60; i++) {
  await sleep(400);
  if (await evalIn('!!window.localStorage')) break;
}
await evalIn('localStorage.clear(); true');
await send('Page.navigate', { url: URL + (URL.includes('?') ? '&' : '?') + 'fresh=1' }, S);
for (let i = 0; i < 90; i++) {
  await sleep(500);
  if (await evalIn('!!(window.WANDEROAD && window.WANDEROAD.wallet)')) break;
}
await sleep(2500);

const start = await evalIn('(() => { const w = window.WANDEROAD.wallet; return { suns: w.suns, earned: w.sunsEarned }; })()');
check(start && start.earned === 0, 'a fresh player has collected nothing', start ? start.earned : 'null', '0');

/** Open the garage the way a player does, and report what the car row says. */
const openGarage = async () => {
  await evalIn(
    "(() => { const m = document.getElementById('menu'); if (m && m.hidden) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return true; })()"
  );
  await sleep(800);
  /* ASSERT IT IS ON SCREEN. An earlier version dispatched Escape at BOTH window and document, which
   * toggled the panel open and shut again in one call — and because show() refills the rows on the
   * way past, every DOM read below still looked correct while the player would have seen nothing.
   * A check that passes against a hidden panel is not checking the feature. */
  if (!(await evalIn("!document.getElementById('menu').hidden"))) throw new Error('the Garage did not open');
  return evalIn(
    "(() => { const row = document.querySelector('#menu [data-group=\"car\"]'); if (!row) return null; return [...row.querySelectorAll('button')].map((b) => ({ id: b.dataset.key, label: b.textContent.trim(), locked: b.classList.contains('locked'), tag: b.dataset.unlock || '' })); })()"
  );
};
const closeGarage = () =>
  evalIn(
    "(() => { const m = document.getElementById('menu'); if (m && !m.hidden) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return true; })()"
  );

let cars = await openGarage();
check(Array.isArray(cars) && cars.length >= 7, 'the garage lists the fleet', cars ? cars.length : 'null', '>= 7');
check(cars && !cars[0].locked, `${cars?.[0]?.label} is open from the first frame`, cars && !cars[0].locked, 'true');
check(cars && cars[1].locked, `${cars?.[1]?.label} starts locked`, cars && cars[1].locked, 'true');
check(
  cars && /collect \d+ suns in all/.test(cars[1].tag),
  `${cars?.[1]?.label} says how to COLLECT it, not a price`,
  cars ? `"${cars[1].tag.slice(0, 22)}…"` : 'null',
  'collect N suns'
);
const dealerCar = cars && cars.find((c) => /dealership/.test(c.tag));
check(!!dealerCar, 'and a later car says it is bought at a dealership', dealerCar ? dealerCar.label : 'none', 'one exists');
await closeGarage();

/* COLLECT, the way the game collects: wallet.addSuns is what a sun pickup and a filled milestone bar
 * both call. Nothing here reaches past the game to set `owned` by hand — that would prove nothing. */
await evalIn('window.WANDEROAD.wallet.addSuns(25); true');
await sleep(1400);
const afterEarn = await evalIn('(() => { const w = window.WANDEROAD.wallet; return { suns: w.suns, earned: w.sunsEarned }; })()');
check(afterEarn && afterEarn.earned === 25, 'collecting 25 moves the odometer', afterEarn ? afterEarn.earned : 'null', '25');
cars = await openGarage();
check(cars && !cars[1].locked, `${cars?.[1]?.label} is now unlocked BY COLLECTING`, cars && !cars[1].locked, 'true');
check(cars && cars[2].locked, `${cars?.[2]?.label} is not — it wants more`, cars && cars[2].locked, 'true');
await closeGarage();

/* SPENDING MUST NOT TAKE IT BACK. This is the check the whole sunsEarned/suns split exists for. */
await evalIn('window.WANDEROAD.wallet.spend(window.WANDEROAD.wallet.suns); true');
await sleep(700);
const bal = await evalIn('window.WANDEROAD.wallet.suns');
cars = await openGarage();
check(bal === 0, 'spend the balance to nothing', bal, '0');
check(cars && !cars[1].locked, `${cars?.[1]?.label} is STILL yours with an empty wallet`, cars && !cars[1].locked, 'true');
await closeGarage();

/* AND A FORTUNE MUST NOT OPEN THE DEALERSHIP FLEET — otherwise there is no reason to find one. */
await evalIn('window.WANDEROAD.wallet.addSuns(100000); true');
await sleep(1400);
cars = await openGarage();
const shut = cars ? cars.filter((c) => c.locked) : [];
const openNow = cars ? cars.filter((c) => !c.locked).map((c) => c.label) : [];
check(shut.length === 4, '100000 collected leaves the four dealership cars shut', `${shut.length} shut`, '4');
check(openNow.length === 3, 'exactly the first three are open', openNow.join(' '), '3 cars');

/* ── THE SHOWROOM: BUYING A CAR OFF THE FORECOURT ───────────────────────────
 * Operator: "The dealership should have the other cars ... show room type situation where they can
 * see the different cars physically and choose them."
 *
 * The garage checks above prove the LADDER. This proves the ACT: stand beside a real display car at
 * a real dealership in the live world and press the key. The same seed is used in node and in the
 * page, so the coordinates computed here are the coordinates the game drew the cars at — if those
 * two ever disagreed, the prompt would name a car that is not standing there.
 */
console.log('');
const SEED = 20260726;
const stations = stationsInBox(-6000, -6000, 6000, 6000, SEED) || [];
const dealer = stations.filter((s) => s.deal).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
if (!dealer) {
  check(false, 'a dealership exists within 6 km of the origin', 0, '>= 1');
} else {
  const spots = showroomSpots(dealer);
  check(spots.length === 4, 'the dealership has a four-car line-up', spots.length, '4');

  /* A CLEAN WALLET AGAIN. The section above deliberately banks 100000 suns to prove a fortune opens
   * no dealership car, and localStorage survives a navigate on the same origin — so without this the
   * balance check below reads 100320 and means nothing. */
  await evalIn('localStorage.clear(); true');
  await send('Page.navigate', { url: `https://cozydriver.com/beta/?debug&seed=${SEED}&fresh=2` }, S);
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    if (await evalIn('!!(window.WANDEROAD && window.WANDEROAD.wallet)')) break;
  }
  await sleep(2500);
  const seedOk = await evalIn('window.WANDEROAD.seed');
  check(seedOk === SEED, 'the page grew the same world these coordinates came from', seedOk, SEED);

  // Money, and a car to spend it on: the SECOND slot, so a slot mapping that is wrong by one cannot
  // pass by accident.
  await evalIn('window.WANDEROAD.wallet.addSuns(500); true');

  /* RECORD EVERY LINE THE HUD SAYS, rather than reading #toast at one instant. Parking on a
   * forecourt also fills the tank, so "full tank" lands on top of the showroom prompt within a
   * second or so — the first version of this check read the toast after the overwrite and reported
   * a working prompt as missing. A MutationObserver installed BEFORE the car arrives cannot miss it. */
  await evalIn(
    "(() => { window.__says = []; const el = document.getElementById('toast'); if (!el) return false; new MutationObserver(() => { const t = (el.textContent || '').trim(); if (t && window.__says[window.__says.length - 1] !== t) window.__says.push(t); }).observe(el, { childList: true, characterData: true, subtree: true }); return true; })()"
  );
  const target = spots[1];
  await evalIn(
    `(() => { const c = window.WANDEROAD.car; c.placeAt(${target.x}, ${target.z}, ${dealer.yaw}); c.vx = 0; c.vz = 0; c.speed = 0; return true; })()`
  );
  await sleep(2800);

  const says = (await evalIn('JSON.stringify(window.__says || [])')) || '[]';
  const lines = JSON.parse(says);
  const prompt = lines.find((l) => /Rally/.test(l)) || '';
  check(!!prompt, 'standing at slot 2 names the RALLY, not a neighbour', `"${prompt.slice(0, 30) || lines.join('|').slice(0, 30)}"`, 'names Rally');
  check(/\d+ suns/.test(prompt), 'and quotes a price', /\d+ suns/.exec(prompt)?.[0] || 'none', 'a price');

  const before = await evalIn("window.WANDEROAD.wallet.owns('rally', 'estate')");
  check(before === false, 'the Rally is not yours yet', before, 'false');

  // Press X, exactly as the prompt tells the player to.
  for (const type of ['keyDown', 'keyUp'])
    await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 88, key: 'x', code: 'KeyX' }, S);
  await sleep(3000);
  const after = await evalIn(
    "(() => ({ owns: window.WANDEROAD.wallet.owns('rally', 'estate'), suns: window.WANDEROAD.wallet.suns }))()"
  );
  check(after && after.owns === true, 'pressing X on the forecourt BUYS it', after && after.owns, 'true');
  check(after && after.suns === 320, 'and charges exactly its price out of 500', after && after.suns, '320');
}

console.log(`\n${pass}/${pass + fail} checks passed`);
sock.close();
chrome.kill();
process.exit(fail ? 1 : 0);
