/* created by AI
 * Cozy Driver — THE AEROPLANE LOOKS LIKE IT IS DOING WHAT IT IS DOING.
 *
 * Operator, four times now, in his own words: "the plane when being steered left goes right and vice
 * versa"; "Left and right are still inverted -- visually right but actually wrong"; "Flying The D key
 * goes left instead of right"; and most recently "air controls are inverted again left goes left but
 * looks like going right".
 *
 * Read that last one carefully, because it is the whole reason this file exists: he is not saying
 * the aeroplane turns the wrong way. He is saying it TURNS THE RIGHT WAY AND LOOKS WRONG. Three
 * separate fixes went into the mesh's rotation signs chasing that, and for the first three reports
 * the mesh was fine every time. The fault then was one line in the chase camera:
 *
 *     camera.up.set(Math.sin(plane.roll), Math.cos(plane.roll), 0)...
 *
 * Roll the camera by the same angle as the aeroplane and the aeroplane is drawn level in the frame —
 * the WING never appears to move, and what tilts instead is the whole world, the opposite way.
 *
 * A check that only reads the flight model passes while that is happening. bench-plane.mjs does read
 * the model, thoroughly, and it passed through all four reports. So this one measures what the
 * PLAYER SEES: it projects the two wingtips through the live camera and asks which one is higher on
 * screen. That number cannot be argued with and does not care which of the three transforms is at
 * fault — mesh sign, euler order, or camera up.
 *
 * AND THE FIFTH REPORT (4 Aug: "the plane tilts to the right instead of the left, but it goes to
 * the left") was the mesh sign after all — the camera fix had landed, and with a level horizon the
 * mirrored roll finally showed itself plainly. This file would have caught it on the day, except
 * its own wingtip labels carried the identical +X-is-the-right-wing error and cancelled it out.
 * Labels corrected below; the assertions were always the honest ones.
 *
 *   node tools/diag-plane-view.mjs [url]
 *
 * Exits non-zero if any check fails.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'https://cozydriver.com/beta/';
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9700 + (process.pid % 200);

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,800',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--use-angle=default',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-planeview-' + process.pid,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let target = null;
for (let i = 0; i < 90 && !target; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {
    /* not up yet */
  }
}
if (!target) {
  chrome.kill();
  throw new Error('headless chrome did not start');
}

const ws = await new Promise((res, rej) => {
  const w = new WebSocket(target.webSocketDebuggerUrl);
  w.addEventListener('open', () => res(w));
  w.addEventListener('error', () => rej(new Error('cdp websocket failed')));
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
const ev = async (expr) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Page.enable');
await send('Runtime.enable');

const pageUrl = new URL(URL_BASE);
pageUrl.searchParams.set('intro', 'off'); // no cinematic to race with — see diag-twowindows
pageUrl.searchParams.set('seed', '20260726');
pageUrl.searchParams.set('unlock', '123');
pageUrl.searchParams.set('fresh', '1');

console.log(`\nCOZY DRIVER — WHAT THE AEROPLANE LOOKS LIKE IT IS DOING\n${'-'.repeat(72)}\n${pageUrl}\n`);

/* A FRESH PAGE PER MEASUREMENT. Running all three in one page made the aeroplane look asymmetric —
 * A reached 35 deg of bank and 1.6 deg of heading where D reached 66 and 10.9 — and the model is
 * not asymmetric at all: bench-plane.mjs holds each for six seconds and gets A +59 deg, D -59 deg.
 * What carries over is the input smoothing and the residual roll RATE from the previous hold, since
 * `plane.start()` zeroes the angles but the page keeps running. Cheap to reload; not cheap to spend
 * another session deciding whether the aeroplane really does turn better one way. */
const boot = async () => {
  await send('Page.navigate', { url: pageUrl.toString() });
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car && window.WANDEROAD.planeMesh)')) return true;
  }
  return false;
};
check('the game booted with an aeroplane in it', await boot());

/* The whole measurement, in the page. Spawns the aeroplane in the air (the same call main.js makes
 * when you press P, with `airborne` true — see game/plane.js), holds one key for a beat, lets go,
 * and then reads the pose AND the projection. Returning both is the point: a build where the flight
 * model is right and the picture is wrong reads as a contradiction here rather than as a pass. */
const FLY = (code, key, ms) => `(async () => {
  const W = window.WANDEROAD, c = W.car, p = W.plane;
  const k = (t, code, key) => window.dispatchEvent(new KeyboardEvent(t, { key, code, bubbles: true }));
  p.start({ x: c.x, z: c.z, y: c.y, yaw: 0, speed: 45 }, true);
  const yaw0 = p.yaw, y0 = p.y;
  k('keydown', 'KeyW', 'w');
  await new Promise((r) => setTimeout(r, 600));
  k('keydown', ${JSON.stringify(code)}, ${JSON.stringify(key)});
  /* READ WHILE THE KEY IS STILL DOWN. The first version let go and waited a beat, and the
   * self-centring roll (PLANE.rollCentre) had already pulled the wings back level by the time the
   * wingtips were projected — the bank being measured was the one AFTER the input, not during it.
   * Heading needs the hold to be long enough to accumulate too: the bank trick yaws in proportion
   * to bank, so a 900 ms pull moved the nose 0.3 deg and read as a failure of a control that works. */
  await new Promise((r) => setTimeout(r, ${ms}));
  const m = W.planeMesh, cam = W.camera;
  /* Project a point of the MODEL through the LIVE camera — three.js's own localToWorld and
   * project, so the answer includes every transform the player's frame includes: the mesh's
   * euler, the camera's position, and the camera's up vector. Screen y is +1 at the top. */
  const V = m.position.constructor;
  const at = (x, y, z) => { const v = new V(x, y, z); m.localToWorld(v); v.project(cam); return v; };
  /* WHICH TIP IS WHICH. The nose is +Z, and in a right-handed Y-up frame a body facing +Z has its
   * RIGHT hand on -X (rotate +Z by -90 about Y and land on (-1,0,0)). The first version of this
   * file put the right wing on +X, which flipped every wingtip verdict below and blessed a
   * mirrored bank as correct — the same +X mistake main.js's roll sign was arguing from. */
  const R = at(-4.5, 0, 0), L = at(4.5, 0, 0), NOSE = at(0, 0, 3.5), TAIL = at(0, 0, -3.5);
  k('keyup', ${JSON.stringify(code)}, ${JSON.stringify(key)});
  k('keyup', 'KeyW', 'w');
  const deg = (r) => +(r * 180 / Math.PI).toFixed(1);
  return JSON.stringify({
    roll: deg(p.roll), pitch: deg(p.pitch),
    meshZ: deg(m.rotation.z), meshX: deg(m.rotation.x),
    dYaw: deg(p.yaw - yaw0), dAlt: +(p.y - y0).toFixed(1),
    rightY: +R.y.toFixed(3), leftY: +L.y.toFixed(3),
    noseY: +NOSE.y.toFixed(3), tailY: +TAIL.y.toFixed(3),
    camUp: [+cam.up.x.toFixed(2), +cam.up.y.toFixed(2), +cam.up.z.toFixed(2)],
  });
})()`;

/* ── the camera does not roll with the aeroplane ──────────────────────────── */
{
  const r = JSON.parse((await ev(FLY('KeyA', 'a', 2600))) || '{}');
  console.log(`       A: roll ${r.roll} deg, heading ${r.dYaw} deg, right wingtip y ${r.rightY} vs left ${r.leftY}, camera up ${r.camUp}`);
  check(
    'the camera keeps the world upright — it does not roll with the aeroplane',
    Math.abs(r.camUp[0]) < 0.02 && r.camUp[1] > 0.98,
    `up = ${r.camUp}`,
  );
  check('A turns the aeroplane LEFT — positive heading change, the car’s convention', r.dYaw > 2, `${r.dYaw} deg`);
  check('and the model banks into it', r.roll > 2, `${r.roll} deg`);
  check(
    'AND IT LOOKS LIKE IT: the RIGHT wingtip is higher on screen, which is a left bank',
    r.rightY > r.leftY,
    `right ${r.rightY} vs left ${r.leftY}`,
  );
}

/* ── the mirror, because a sign error that flips both is still a sign error ── */
{
  await boot();
  const r = JSON.parse((await ev(FLY('KeyD', 'd', 2600))) || '{}');
  console.log(`       D: roll ${r.roll} deg, heading ${r.dYaw} deg, right wingtip y ${r.rightY} vs left ${r.leftY}`);
  check('D turns the aeroplane RIGHT — negative heading change', r.dYaw < -2, `${r.dYaw} deg`);
  check('and the model banks into that one too', r.roll < -2, `${r.roll} deg`);
  check(
    'AND IT LOOKS LIKE IT: the LEFT wingtip is higher on screen, which is a right bank',
    r.leftY > r.rightY,
    `left ${r.leftY} vs right ${r.rightY}`,
  );
}

/* ── pull back and the NOSE goes up, on screen, not just in the model ───────
 * The pitch keys are ShiftLeft/KeyK for up and ControlLeft/KeyI for down (car/input.js) — NOT the
 * arrows, which are throttle and brake. The first run of this file used ArrowUp and measured a
 * pitch of exactly 0, i.e. it was holding the throttle and calling it a climb. */
{
  await boot();
  const r = JSON.parse((await ev(FLY('ShiftLeft', 'Shift', 2200))) || '{}');
  console.log(`       pull back: pitch ${r.pitch} deg, altitude ${r.dAlt} m, nose y ${r.noseY} vs tail ${r.tailY}`);
  const climbed = r.dAlt > 0 || r.pitch > 2;
  check('pulling back pitches the aeroplane up', r.pitch > 2, `${r.pitch} deg`);
  check('and it gains height doing it', climbed, `${r.dAlt} m`);
  check(
    'AND IT LOOKS LIKE IT: the nose is higher on screen than the tail',
    r.noseY > r.tailY,
    `nose ${r.noseY} vs tail ${r.tailY}`,
  );
}

mkdirSync('shots/plane', { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) {
  writeFileSync('shots/plane/view.png', Buffer.from(shot.result.data, 'base64'));
  console.log('\n  photographed: shots/plane/view.png');
}

ws.close();
chrome.kill();
console.log(`\n${failed ? `${failed} PLANE-VIEW CHECK(S) FAILED` : 'the aeroplane looks like it is doing what it is doing'}\n`);
process.exit(failed ? 1 : 0);
