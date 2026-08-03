/* created by AI
 * Wanderoad — PHOTOGRAPH EVERY FIX ON THE LIVE SITE, AND PUBLISH THE PHOTOGRAPHS.
 *
 * Operator: "YOU MUST PROVIDE SCREENSHOT PROOF of completion on website -- DONT STOP BEFORE PROVEN."
 *
 * A claim in a commit message is not proof, and neither is a screenshot sitting on this machine —
 * the operator is nearly blind to a wall of text and reads deliverables as ONE ONLINE LINK. So this
 * drives the LIVE BETA in a real browser, takes one photograph per to-do item, and writes them to a
 * page on nibblet.net with the item id and its own words beside each shot.
 *
 * It shoots the deployed URL, never a dev server: a screenshot of localhost proves the code on this
 * disk works, which is not the thing being claimed.
 *
 * Manifest format — a JSON array, one entry per shot:
 *   [{ "id": "B41", "label": "the estate handles like it looks",
 *      "url": "?unlock=123&fresh=1&car=estate",   // appended to the base
 *      "setup": "(() => { …runs in the page before the shot… })()",
 *      "driveMs": 6000,        // hold W for this long first (default 5000)
 *      "waitMs": 2500 }]       // settle after setup (default 2500)
 *
 * A STILL IS NOT ENOUGH FOR A GAME. Operator: "with games the proof has to be more than just an
 * image but a GIF showing movement (or webm for space) so it can be seen frame by frame across 3
 * seconds minimum". He is right, and the reason is specific to this project: almost every bug he has
 * reported this month is a bug in MOTION — ghosts pinned to one snapshot, a body that wobbles, a
 * plane that turns the wrong way, junctions that flash, things falling out of the sky. A photograph
 * of any of those looks perfectly fine. So each item is recorded as a CLIP, at least three seconds,
 * captured through CDP's screencast while the game is actually being played, and published as WebM
 * with a poster frame. WebM rather than GIF for the reason he gave — space — and the page it lands
 * on has frame-step buttons so it can be walked frame by frame.
 *
 *   node tools/proof-gallery.mjs <manifest.json> [baseUrl]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MANIFEST = process.argv[2];
const BASE = process.argv[3] || 'https://cozydriver.com/beta/';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9993;
const OUT = 'shots/proof';
/** Minimum clip length, in seconds. The operator's floor, not a suggestion. */
const CLIP_S = Number(process.env.PROOF_CLIP_S || 3.5);
const FRAMES = 'shots/proof/.frames';

if (!MANIFEST) {
  console.error('usage: node tools/proof-gallery.mjs <manifest.json> [baseUrl]');
  process.exit(2);
}
const shots = JSON.parse(readFileSync(MANIFEST, 'utf8'));
mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-proof-' + process.pid,
    '--window-size=1280,720',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
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
const listeners = new Map(); // CDP method -> handler
sock.addEventListener('message', (m) => {
  const x = JSON.parse(m.data);
  if (x.id && pend.has(x.id)) {
    pend.get(x.id)(x);
    pend.delete(x.id);
    return;
  }
  // Screencast frames arrive as EVENTS. The first version of this file only ever resolved replies,
  // so every frame was silently dropped and the clip came out empty.
  if (x.method && listeners.has(x.method)) listeners.get(x.method)(x.params);
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

const results = [];
for (const shot of shots) {
  const url = BASE + (shot.url || '?fresh=1');
  process.stdout.write(`  ${shot.id.padEnd(6)} ${shot.label.slice(0, 52).padEnd(54)}`);
  try {
    await send('Page.navigate', { url }, S);
    let ready = false;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) {
        ready = true;
        break;
      }
    }
    if (!ready) throw new Error('the game never finished loading');
    await sleep(2500);
    // dismiss the title card, then drive, so the shot is of a game being played
    for (const type of ['keyDown', 'keyUp'])
      await send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
    const driveMs = shot.driveMs ?? 5000;
    if (driveMs > 0) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
      await sleep(driveMs);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
    }
    if (shot.setup) await ev(shot.setup);
    await sleep(shot.waitMs ?? 2500);

    /* A READING TAKEN FROM THE GAME ITSELF, printed under the photograph. A picture proves something
     * was on screen; the number proves it was the thing claimed. */
    const reading = shot.read ? await ev(shot.read) : null;

    /* THE CLIP. Page.captureScreenshot in a loop tops out around six frames a second and stutters;
     * startScreencast streams them as the compositor produces them, so the motion is the game's
     * real motion rather than a slideshow of it. Frames are acked one at a time — an unacked
     * screencast stops sending after a couple of frames. */
    /* NOTHING RECORDS THE MENU BY ACCIDENT. The first plane clip came out as 51 KB of a static
     * Garage panel: the readings were taken before the capture and showed the aeroplane genuinely
     * flying at 103 m, but the three and a half seconds of film were of a menu. A clip that shows
     * the wrong thing is worse than no clip, because it looks like evidence. Items that are ABOUT
     * the menu opt out with "keepMenu": true. */
    if (!shot.keepMenu) {
      const shut = await ev(
        "(() => { const el = document.getElementById('menu'); if (!el || el.hidden) return 'already closed';" +
          " window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));" +
          " return 'closed it'; })()"
      );
      if (shut === 'closed it') await sleep(700);
      const still = await ev("(() => { const el = document.getElementById('menu'); return !!el && !el.hidden; })()");
      if (still) throw new Error('the Garage would not close — the clip would be of a menu');
    }
    rmSync(FRAMES, { recursive: true, force: true });
    mkdirSync(FRAMES, { recursive: true });
    let n = 0;
    const t0 = Date.now();
    listeners.set('Page.screencastFrame', (p) => {
      writeFileSync(`${FRAMES}/f${String(++n).padStart(4, '0')}.jpg`, Buffer.from(p.data, 'base64'));
      send('Page.screencastFrameAck', { sessionId: p.sessionId }, S);
    });
    await send('Page.startScreencast', { format: 'jpeg', quality: 82, everyNthFrame: 1 }, S);
    // keep the car MOVING for the whole clip — a still car proves nothing about motion
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
    /* AND IT STAYS CLOSED WHILE THE CAMERA RUNS. Closing it once before recording was not enough:
     * the panel opened again DURING the capture — the car is dragged along under the aeroplane, and
     * passing a showroom opens the picker — so the second attempt filmed the same menu as the
     * first. A watchdog is the honest fix; silently accepting whatever landed on screen is not. */
    const shutter = shot.keepMenu
      ? null
      : setInterval(() => {
          ev(
            "(() => { const el = document.getElementById('menu'); if (el && !el.hidden) {" +
              " window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));" +
              " document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })); } })()"
          ).catch(() => {});
        }, 400);
    await sleep(CLIP_S * 1000);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 87, key: 'w', code: 'KeyW' }, S);
    await send('Page.stopScreencast', {}, S);
    listeners.delete('Page.screencastFrame');
    const secs = (Date.now() - t0) / 1000;
    if (n < 12) throw new Error(`only ${n} frames captured in ${secs.toFixed(1)}s — that is not a clip`);
    if (secs < 3) throw new Error(`the clip is only ${secs.toFixed(1)}s — the floor is 3s`);
    const fps = Math.max(1, Math.round(n / secs));

    // WebM, at the rate the frames were actually produced, so playback runs at life speed.
    const webm = `${OUT}/${shot.id}.webm`;
    const enc = spawnSync(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', `${FRAMES}/f%04d.jpg`,
       /* Scaled to 960 wide and CRF 40. At source resolution a three-and-a-half second clip came
        * out at 5.8 MB, and a page of thirty of those is a page nobody waits for. 960 px still
        * shows a wobbling body and a flashing junction perfectly well, and the frame RATE — which
        * is what carries motion — is untouched. */
       '-vf', 'scale=960:-2', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40',
       '-row-mt', '1', '-pix_fmt', 'yuv420p', '-an', webm],
      { encoding: 'utf8' }
    );
    if (enc.status !== 0) throw new Error(`ffmpeg failed: ${(enc.stderr || '').slice(0, 200)}`);

    /* The poster is taken while the watchdog is STILL running. Stopping it first produced three
     * runs where the clip was perfect flight footage and the poster was the Garage — the panel
     * reopened in the moment between the two. A poster that contradicts its own clip reads as a
     * failed proof to anyone glancing at the page. */
    const { result: png } = await send('Page.captureScreenshot', { format: 'png' }, S);
    if (shutter) clearInterval(shutter);
    const clipBytes = readFileSync(webm).length;
    console.log(`ok  clip ${secs.toFixed(1)}s @${fps}fps ${(clipBytes / 1024).toFixed(0)} KB${reading ? '  ' + String(reading).slice(0, 36) : ''}`);
    results.push({ ...shot, file: `${shot.id}.png`, clip: `${shot.id}.webm`, seconds: +secs.toFixed(1), fps, frames: n, bytes: clipBytes, reading, ok: true });
  } catch (e) {
    console.log(`FAILED — ${e.message}`);
    results.push({ ...shot, ok: false, error: e.message });
  }
}

writeFileSync(`${OUT}/manifest-out.json`, JSON.stringify(results, null, 2));
const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} shots captured -> ${OUT}/`);

sock.close();
chrome.kill();
process.exit(ok === results.length ? 0 : 1);
