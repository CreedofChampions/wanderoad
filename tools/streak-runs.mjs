/* Wanderoad — ten runs, each trying for a kilometre.
 *
 * The operator's testing brief, verbatim: "Every time you test, you should do ten runs, where
 * you try to get a streak of at least one kilometre, and see what needs to be changed along
 * the way."
 *
 * So this drives the game ten times with the auto-pilot, each run trying to hold a streak to
 * 1 km, and reports WHY each one ended. That last part is the whole value: a pass rate tells
 * you the game is hard, but a breakdown of what ended each run tells you what to fix.
 *
 *   node tools/streak-runs.mjs [url] [--runs 10] [--target 1000]
 *
 * Exits non-zero if fewer than half the runs reach the target — a kilometre on an empty road
 * is not supposed to be an achievement.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = process.argv.slice(2);
const URL_BASE = args.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? +args[i + 1] : d;
};
const RUNS = opt('runs', 10);
const TARGET = opt('target', 1000);
const PORT = 9600 + (process.pid % 200);

async function main() {
  mkdirSync(resolve('shots/runs'), { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1280,760',
      '--hide-scrollbars',
      '--no-first-run',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--user-data-dir=' + resolve('.chrome-runs'),
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let target = null;
  for (let i = 0; i < 90 && !target; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {
      /* not up */
    }
  }
  if (!target) {
    chrome.kill();
    throw new Error('headless chrome did not start');
  }

  const ws = await new Promise((res, rej) => {
    const s = new WebSocket(target.webSocketDebuggerUrl);
    s.onopen = () => res(s);
    s.onerror = () => rej(new Error('cdp failed'));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evalJs = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_BASE + (URL_BASE.includes('?') ? '&' : '?') + 'cheat&offline&terrain=meadow' });

  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    if (await evalJs(`!!(window.WANDEROAD && window.WANDEROAD.car)`)) break;
  }
  await sleep(6000);

  console.log(`\nTEN RUNS AT ${TARGET} m — ${URL_BASE}\n${'-'.repeat(72)}`);
  const runs = [];

  for (let r = 0; r < RUNS; r++) {
    /* Each run: put the car on a road somewhere new, switch the auto-pilot on, and watch
     * until the streak reaches the target or breaks. The auto-pilot only presses keys, so a
     * run it cannot finish is a run a person would also struggle with. */
    const out = await evalJs(`(async () => {
      const W = window.WANDEROAD, c = W.car;
      // Somewhere new each run, so ten runs are not one road ten times.
      const ang = ${r} * 2.4, rad = 900 + ${r} * 700;
      c.placeAt(c.x + Math.cos(ang) * rad, c.z + Math.sin(ang) * rad, c.yaw);
      W.streak.distance = 0; W.streak.score = 0; W.streak._off = 0;
      await new Promise(res => setTimeout(res, 2500));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', bubbles: true }));
      await new Promise(res => setTimeout(res, 1200));
      if (!W.auto.on) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }));

      const t0 = performance.now();
      let peak = 0, lastOn = true, why = 'timeout', offAt = null, minSpd = 999, hits = 0;
      const solids = W.solids; const orig = solids.resolve.bind(solids);
      solids.resolve = (...a) => { const hit = orig(...a); if (hit && hit.severity > 0.3) hits++; return hit; };

      while (performance.now() - t0 < 120000) {
        await new Promise(res => setTimeout(res, 250));
        const st = W.streak.state;
        peak = Math.max(peak, st.distance);
        const spd = Math.abs(c.kph);
        if (spd > 4) minSpd = Math.min(minSpd, spd);
        if (st.distance >= ${TARGET}) { why = 'reached'; break; }
        if (lastOn && !st.onRoad && !st.grace) {
          const s = c.terrain.surface(c.x, c.z);
          offAt = { x: Math.round(c.x), z: Math.round(c.z), kph: Math.round(spd),
                    slip: Math.round(c.slip * 57.3), roadDist: +c.terrain.roads.query(c.x, c.z).d.toFixed(1) };
        }
        lastOn = st.onRoad;
        if (peak > 60 && st.distance < peak * 0.4) {
          // It broke. Work out the most likely cause from the state at the moment it left.
          if (hits > 0) why = 'hit something';
          else if (offAt && Math.abs(offAt.slip) > 22) why = 'slid off';
          else if (offAt && offAt.kph > 90) why = 'too fast for the corner';
          else if (offAt && offAt.roadDist > 25) why = 'road ran out';
          else why = 'drifted off the edge';
          break;
        }
        if (spd < 1.5 && performance.now() - t0 > 12000) { why = 'stopped moving'; break; }
      }
      solids.resolve = orig;
      if (!W.auto.on) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true }));
      return { peak: Math.round(peak), why, offAt, hits, secs: +((performance.now()-t0)/1000).toFixed(0),
               biome: document.getElementById('biome')?.textContent };
    })()`);

    runs.push(out);
    const ok = out.why === 'reached';
    console.log(
      `run ${String(r + 1).padStart(2)}  ${ok ? 'REACHED' : 'ended  '}  ` +
        `${String(out.peak).padStart(5)} m  ${String(out.secs).padStart(3)}s  ` +
        `${out.why.padEnd(24)} ${out.biome || ''}` +
        (out.offAt ? `  @${out.offAt.x},${out.offAt.z} ${out.offAt.kph}km/h slip ${out.offAt.slip}deg` : '')
    );
  }

  const s = await send('Page.captureScreenshot', { format: 'png' });
  if (s.result?.data) writeFileSync(resolve('shots/runs/last.png'), Buffer.from(s.result.data, 'base64'));

  ws.close();
  chrome.kill();

  const reached = runs.filter((r) => r.why === 'reached').length;
  const peaks = runs.map((r) => r.peak).sort((a, b) => a - b);
  const median = peaks[Math.floor(peaks.length / 2)] || 0;
  const causes = {};
  for (const r of runs) if (r.why !== 'reached') causes[r.why] = (causes[r.why] || 0) + 1;

  console.log('-'.repeat(72));
  console.log(`reached ${TARGET} m: ${reached}/${RUNS}   median peak ${median} m   best ${peaks[peaks.length - 1] || 0} m`);
  if (Object.keys(causes).length) {
    console.log('what ended the others:');
    for (const [k, v] of Object.entries(causes).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(2)} x ${k}`);
  }
  process.exitCode = reached >= Math.ceil(RUNS / 2) ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
