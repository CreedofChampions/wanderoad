/* Wanderoad — photograph the water from a real shoreline.
 *
 * Operator: "water does not look good once your like 15 m from shore -- try more spread out texture it
 * looks like toothpaste -- too much white too little blue -- near shore often looks good".
 *
 * That is a DISTANCE-DEPENDENT and ANGLE-DEPENDENT defect, so a screenshot from anywhere else measures
 * nothing at all: the camera has to stand at the waterline and look out across the water. Hence this
 * file rather than a `tools/shoot.mjs --play` run, which photographs wherever the autopilot wandered.
 *
 * STILL NOT WORKING, and it is recorded here rather than quietly dropped. It finds a shore — the shore
 * test is done in NODE against the pure world modules, because the built bundle does not expose a
 * water height — and parks the car 8 m back from it facing out, but both attempts so far photographed
 * dune sand with no water in frame. `isDryAt` says wet at those coordinates while the visible surface
 * is a dune crest, so either the test and the render disagree about the water table in DUNES, or the
 * lake is beyond the ridge the camera is behind. Finding out which is the next step, and it is worth
 * doing: if the two really do disagree, that is a bug considerably more interesting than the foam.
 *
 * Until it works, the foam change it was written to verify has NOT been confirmed by eye — only by
 * diag-watershader's static checks and the suite staying green.
 *
 *   node tools/diag-watershot.mjs [url] [out.png]
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const URL = process.argv[2] || 'https://cozydriver.com/beta/?debug';
const OUT = process.argv[3] || 'D:/OpenClaw/tmp/shots/water.png';
const PORT = 9930;
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-first-run',
  '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-w-' + process.pid, '--window-size=1400,800', 'about:blank'], { stdio: 'ignore' });
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
for (let i = 0; i < 90; i++) { await sleep(500); if (await ev('!!(window.WANDEROAD && window.WANDEROAD.car)')) break; }
await sleep(4000);

/* THE SHORE IS FOUND IN NODE. The page's surface record has no water height on it (`w` is the biome
 * blend; the height comes from `waterLevelAt`, which the built bundle does not expose), so the search
 * runs here against the pure world modules and only the ANSWER is passed in. Same shape as the fix in
 * diag-station-scan.mjs, and for the same reason. */
const { Terrain, isDryAt } = await import('file:///D:/Github-Projects/wanderoad/src/world/terrain.js');
const pose = await ev(`(() => { const c = window.WANDEROAD.car; return { x: c.x, z: c.z, seed: window.WANDEROAD.seed }; })()`);
const terr = new Terrain(pose.seed, pose.x - 1600, pose.z - 1600, pose.x + 1600, pose.z + 1600);
let found = null;
for (let r = 40; r < 1400 && !found; r += 20) {
  for (let a = 0; a < 24 && !found; a++) {
    const th = (a / 24) * Math.PI * 2;
    const x = pose.x + Math.cos(th) * r;
    const z = pose.z + Math.sin(th) * r;
    if (!isDryAt(x, z, pose.seed)) continue;                     // must be standing on land
    const x2 = pose.x + Math.cos(th) * (r + 34);
    const z2 = pose.z + Math.sin(th) * (r + 34);
    if (isDryAt(x2, z2, pose.seed)) continue;                    // and water 34 m further on
    /* A REAL LAKE, not a puddle and not a dune hollow: wet all the way out to 260 m along the same
     * bearing, and wet 60 m either side of it, so what the camera sees is open water rather than a
     * damp patch behind a ridge. The first version checked 34 m and 90 m and pointed the camera at a
     * sand dune. */
    let ok = true;
    for (const d of [60, 120, 190, 260]) {
      if (isDryAt(pose.x + Math.cos(th) * (r + d), pose.z + Math.sin(th) * (r + d), pose.seed)) { ok = false; break; }
    }
    if (!ok) continue;
    const px = -Math.sin(th), pz = Math.cos(th); // across the bearing
    for (const side of [-60, 60]) {
      const wx = pose.x + Math.cos(th) * (r + 140) + px * side;
      const wz = pose.z + Math.sin(th) * (r + 140) + pz * side;
      if (isDryAt(wx, wz, pose.seed)) { ok = false; break; }
    }
    if (!ok) continue;
    // stand 8 m back from the waterline, looking straight out over it
    found = {
      x: Math.round(pose.x + Math.cos(th) * (r - 8)),
      z: Math.round(pose.z + Math.sin(th) * (r - 8)),
      yaw: Math.atan2(Math.cos(th), Math.sin(th)),
      r,
    };
  }
}
if (found) {
  await ev(`(() => { const c = window.WANDEROAD.car;
    c.placeAt(${found.x}, ${found.z}, ${found.yaw});
    c.vx = 0; c.vz = 0; c.speed = 0; })()`);
}
console.log('shore:', JSON.stringify(found));
await sleep(9000); // the streamer needs to settle: an unsettled frame photographs the loading, not the water
const { result: shot } = await send('Page.captureScreenshot', { format: 'png' }, S);
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('wrote', OUT);
sock.close(); chrome.kill();
