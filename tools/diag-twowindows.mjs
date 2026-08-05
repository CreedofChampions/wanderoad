/* Wanderoad — DO TWO REAL BROWSER WINDOWS ACTUALLY SEE EACH OTHER?
 *
 * B5 has sat open since CP3 with the note "tools/net-test.mjs covers the wire, not two browsers",
 * and B19 is the operator's own report: "Multiplayer never syncs". Every other multiplayer check in
 * this repo tests a MODULE — net-test.mjs mounts the panel against a stub document, diag-ghostcar
 * checks the ghost factory in node with no GLTFLoader. None of them opens two windows, and the one
 * thing nobody had done is the one thing the bug is about.
 *
 * So this drives two real pages in one headless Chrome, against the LIVE BETA, and asks the SECOND
 * window what it can see of the first. Two windows on one machine share one identity in
 * localStorage — that is the documented "2 cars in the same place don't see each other" trap — so
 * the second window takes `?seat=2`, exactly as the Garage's own "Drive together" panel tells a
 * player to.
 *
 * WHAT IT ASSERTS, and why each one is here rather than being assumed:
 *   1. both windows reach the backend at all (`netInfo()` is 'online', not 'solo'). A page that
 *      quietly fell back to local play looks completely normal on screen and can never sync.
 *   2. the seat worked — the two windows are DIFFERENT players. Without this, everything below
 *      would pass trivially by each window seeing itself.
 *   3. window B can see window A at all.
 *   4. and window A can see window B — sync has to be symmetric or one player is a ghost to the
 *      other and not the reverse.
 *   5. THE GHOST MOVES. This is the check that matters: a peer record that appears once and then
 *      sits still is exactly what a stale or one-shot write looks like, and it would satisfy every
 *      check above. So window A drives, and window B's view of A's position has to change.
 *
 *   node tools/diag-twowindows.mjs [url]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'https://cozydriver.com/beta/';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + (process.pid % 200);
const SEED = '20260726';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

/* TWO BROWSERS, NOT TWO TABS — and that is a measurement, not a preference.
 *
 * The first version opened two TARGETS in one Chrome. Only one target can be the foreground one,
 * and a backgrounded renderer has its requestAnimationFrame paused, so whichever window was not in
 * front simply stopped running the game. It showed up as two different false results in turn:
 * first window A reported 0.0 m of travel after a real 7-second keydown, and then — once A was
 * brought to the front — window B's view of A froze at EXACTLY 251.8 m before and after, to the
 * decimetre, while A really did drive 47 m. A frozen observer cannot test sync.
 *
 * Two separate Chrome processes each own their foreground page, so both game loops run. */
function launch(port, tag) {
  return spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--window-size=1000,640',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    // WITHOUT THESE, WINDOW A NEVER DRIVES. Only one target can be visible, and Chrome pauses
    // requestAnimationFrame in a backgrounded renderer — so the hidden window's game loop stops,
    // its car does not move, and the whole test measures nothing. Found by measuring: A's own
    // car reported 0.0 m of travel after a real 7-second keydown.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--use-angle=default',
    '--enable-unsafe-swiftshader',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-two-' + process.pid + '-' + tag,
    'about:blank',
  ],
  { stdio: 'ignore' }
  );
}

const browsers = [];

/** One browser, one page, already booted into the game, with its own eval/keys. */
async function openWindow(label, url, port) {
  const proc = launch(port, label);
  browsers.push(proc);
  let target = null;
  for (let i = 0; i < 90 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      /* not up yet */
    }
  }
  if (!target) throw new Error(`${label}: headless chrome did not start`);

  const ws = await new Promise((res, rej) => {
    const w = new WebSocket(target.webSocketDebuggerUrl);
    w.addEventListener('open', () => res(w));
    w.addEventListener('error', () => rej(new Error(`${label}: cdp websocket failed`)));
  });
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => {
    const x = JSON.parse(m.data);
    if (x.id && pending.has(x.id)) {
      pending.get(x.id)(x);
      pending.delete(x.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const n = ++msgId;
      pending.set(n, res);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.navigate', { url });

  let ready = false;
  for (let i = 0; i < 140; i++) {
    await sleep(500);
    if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) {
      ready = true;
      break;
    }
  }
  if (!ready) throw new Error(`${label}: the game never finished loading`);
  /* A real keydown, not a flag: the intro cinematic only clears on genuine input, and while it is
   * up the camera is 180 m in the air on a fly-around and the car is not being driven by anything
   * (the same trap diag-watershot recorded). ONE press is not enough either — the cinematic starts
   * a few seconds AFTER window.WANDEROAD.car exists, so a press sent immediately can land before
   * there is anything to skip. Caught by photographing window B and getting the title card, with
   * "any key or button to drive" still across it. So: press until the game says the cinematic is
   * actually down. */
  let clear = false;
  for (let i = 0; i < 24 && !clear; i++) {
    for (const type of ['keyDown', 'keyUp'])
      await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' });
    await sleep(600);
    clear = (await ev('(()=>{try{return !window.WANDEROAD.cine.active;}catch(e){return false;}})()')) === true;
  }
  if (!clear) console.log(`  (${label}: the intro cinematic never cleared — the photograph will show it)`);
  await sleep(1200);
  const key = async (type) => send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' });
  const shot = async (path) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    if (!r.result?.data) return null;
    mkdirSync('shots/two', { recursive: true });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
    return path;
  };
  return { label, ev, key, send, shot };
}

const url = (seat) => {
  const u = new global.URL(URL_BASE);
  u.searchParams.set('seed', SEED);
  u.searchParams.set('unlock', '123');
  /* The game's own supported way past the intro. Pressing a key was tried first and is a race:
   * `cine.active` reported FALSE while the title overlay was still on screen, so the photograph
   * came back as the washed-out "any key or button to drive" card twice. A URL parameter has no
   * race in it. */
  u.searchParams.set('intro', 'off');
  if (seat) u.searchParams.set('seat', String(seat));
  return u.href;
};

console.log(`\nWanderoad — TWO REAL WINDOWS, against ${URL_BASE}\n`);

const A = await openWindow('A', url(null), PORT);
const B = await openWindow('B', url(2), PORT + 1);

/* The identity keys are `wanderoad.secret` / `wanderoad.name` with a PER-SEAT SUFFIX — that
 * suffix is the whole mechanism by which a second window becomes a second player, so reading the
 * bare key (as the first version of this file did) returns nothing and proves nothing. */
const netOf = (w) => w.ev('(()=>{try{return String(window.WANDEROAD.netInfo());}catch(e){return "err:"+e.message;}})()');
const posOf = (w) => w.ev('(()=>{const c=window.WANDEROAD.car;return [c.x,c.z];})()');
const peersOf = (w) => w.ev('(()=>{try{return JSON.stringify(window.WANDEROAD.remotes.list());}catch(e){return "[]";}})()');
/* The ghost's ABSOLUTE position as this window knows it. `list()` reports a DISTANCE, measured
 * from the observer's own camera — so if the observer moves, or freezes, the number moves or
 * freezes for reasons that have nothing to do with the peer. The pose is the honest measurement. */
const ghostPoseOf = (w) =>
  w.ev(
    '(()=>{try{const m=window.WANDEROAD.remotes.peers;for(const [id,rec] of m){const p=rec.pose;' +
      'if(p)return JSON.stringify({id,x:p.x,z:p.z});}return "null";}catch(e){return "null";}})()'
  );

/* Put B where A is actually LOOKING, not merely near A.
 *
 * The first version placed B at a fixed offset (+18, +6). Both windows then reported the other at
 * 13-18 m and neither photograph contained the other car, because the offset happened to sit behind
 * A's chase camera. The direction is taken from A's own camera matrix rather than from a yaw
 * convention — three.js keeps the view direction in the third column of matrixWorld, negated — so
 * there is nothing to get backwards. */
const [ax, az] = await posOf(A);
const fwd = await A.ev(
  '(()=>{const m=window.WANDEROAD.camera.matrixWorld.elements;const fx=-m[8],fz=-m[10];' +
    'const l=Math.hypot(fx,fz)||1;return JSON.stringify([fx/l,fz/l]);})()'
);
const [fx, fz] = JSON.parse(fwd || '[0,1]');
const bxWant = ax + fx * 20;
const bzWant = az + fz * 20;
await B.ev(`(()=>{const c=window.WANDEROAD.car;c.placeAt&&c.placeAt(${bxWant},${bzWant},0);return 1;})()`);

// The transport posts on an interval; give both windows several beats before asking anything.
await sleep(9000);

/* A PHOTOGRAPH OF THE THING ITSELF. Every number below can be satisfied by a data structure; the
 * question the operator actually asked ("multiplayer never syncs") is about seeing another car on
 * your screen. So window B is photographed with A parked beside it. */
const [bx, bz] = await posOf(B);
const gap = Math.hypot(bx - ax, bz - az);
console.log(`  the two cars are ${gap.toFixed(1)} m apart — photographing window B
`);
await B.shot('shots/two/B-sees-A.png');
await A.shot('shots/two/A-sees-B.png');

const netA = await netOf(A);
const netB = await netOf(B);
check('window A reached the backend (not solo)', netA === 'online', `netInfo=${netA}`);
check('window B reached the backend (not solo)', netB === 'online', `netInfo=${netB}`);

const seatA = await A.ev("(()=>{try{return new URL(location.href).searchParams.get('seat')||'(none)';}catch(e){return 'err';}})()");
const seatB = await B.ev("(()=>{try{return new URL(location.href).searchParams.get('seat')||'(none)';}catch(e){return 'err';}})()");
/* IDENTITY, ASSERTED ON WHAT THE GAME REPORTS rather than on a storage key.
 * Two earlier versions of this check read localStorage directly and returned an empty string both
 * times — the key carries a per-seat suffix and the name is not necessarily written at boot. The
 * honest question is not "what is in storage", it is "does each window see a DIFFERENT player, and
 * is that player not itself" — which is exactly what the peer lists answer. */

const seenByB0 = JSON.parse((await peersOf(B)) || '[]');
const seenByA0 = JSON.parse((await peersOf(A)) || '[]');
check(
  'the seat made them two different players (each sees the OTHER, not itself)',
  seenByA0.length > 0 && seenByB0.length > 0 && seenByA0[0].id !== seenByB0[0].id,
  `A seat ${seatA} sees "${seenByA0[0]?.name ?? 'nobody'}" · B seat ${seatB} sees "${seenByB0[0]?.name ?? 'nobody'}"`
);
check('window B can see window A', seenByB0.length > 0, `B sees ${seenByB0.length} peer(s): ${seenByB0.map((p) => `${p.name}@${Math.round(p.dist)}m`).join(', ') || 'nobody'}`);
check('window A can see window B', seenByA0.length > 0, `A sees ${seenByA0.length} peer(s): ${seenByA0.map((p) => `${p.name}@${Math.round(p.dist)}m`).join(', ') || 'nobody'}`);

/* THE ONE THAT MATTERS. A drives; B's view of A has to move. A peer that appears once and then
 * freezes would pass every check above and is exactly what a stale write looks like. */
const before = JSON.parse((await ghostPoseOf(B)) || 'null');
const posA0 = await posOf(A);
await A.key('keyDown');
await sleep(7000);
await A.key('keyUp');
const posA1 = await posOf(A);
await sleep(3500); // let the move reach the server and come back to B
const after = JSON.parse((await ghostPoseOf(B)) || 'null');

const drove = Math.hypot(posA1[0] - posA0[0], posA1[1] - posA0[1]);
check('window A actually drove somewhere', drove > 15, `${drove.toFixed(1)} m`);
const ghostMoved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : null;
check(
  'and window B SAW it move — the ghost is live, not a stale record',
  ghostMoved !== null && ghostMoved > 10,
  before === null || after === null
    ? `B held ${before === null ? 'no ghost before' : 'no ghost after'}`
    : `B's copy of A moved ${ghostMoved.toFixed(1)} m while A drove ${drove.toFixed(1)} m`
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(' · ')}`);
else console.log('TWO WINDOWS SEE EACH OTHER.');

for (const b of browsers) b.kill();
process.exit(failed.length ? 1 : 0);
