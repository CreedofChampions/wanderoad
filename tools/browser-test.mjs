/* Wanderoad — browser acceptance test.
 *
 * Drives a real headless Chrome against a real build and asserts that the game WORKS: that it
 * boots, that you can see it, that the keys do what they say, that the car goes where you
 * point it, and that every control in the game does something observable.
 *
 * This exists because the game once shipped completely unplayable behind a passing test
 * suite. The rules that came out of that are baked in here:
 *
 *   - VISIBILITY IS MEASURED, NEVER ASSUMED. Every "is it showing" check reads
 *     getComputedStyle and a bounding box. A `hidden` attribute proves nothing; an author
 *     `display` rule beats it and that is exactly what went wrong.
 *   - INPUT IS REAL. Every control is exercised with genuine KeyboardEvents, the same ones a
 *     keyboard produces, never by calling a function directly.
 *   - THE PICTURE IS EVIDENCE. Screenshots are written at each stage and the run fails if the
 *     frame is a flat colour, because a black screen passes every other check ever written.
 *
 *   node tools/browser-test.mjs [url] [--keep]
 *
 * Exits 0 only if every check passes.
 */

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const args = process.argv.slice(2);
const URL_UNDER_TEST = args.find((a) => a.startsWith('http')) || 'http://localhost:5173/';
const SHOTS = resolve('shots/test');
const PORT = 9800 + (process.pid % 300);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return !!ok;
};

/* ── CDP plumbing ────────────────────────────────────────────────────────── */

async function connect() {
  mkdirSync(SHOTS, { recursive: true });
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--window-size=1400,820',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--user-data-dir=' + resolve('.chrome-test'),
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
      /* not up yet */
    }
  }
  if (!target) {
    chrome.kill();
    throw new Error('headless chrome did not start');
  }

  const ws = await new Promise((res, rej) => {
    const s = new WebSocket(target.webSocketDebuggerUrl);
    s.onopen = () => res(s);
    s.onerror = () => rej(new Error('cdp websocket failed'));
  });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push({ level: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push({ level: 'exception', text: `${d.text} ${d.exception?.description || ''}`.slice(0, 300) });
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (!s.result?.data) return null;
    const path = resolve(SHOTS, `${name}.png`);
    writeFileSync(path, Buffer.from(s.result.data, 'base64'));
    return path;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  return { chrome, ws, send, evalJs, shot, logs };
}

/* Genuine key events, dispatched at the window exactly as a keyboard would. */
const KEY = (code, type) =>
  `window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', bubbles: true, cancelable: true }))`;

async function hold(evalJs, code, ms) {
  await evalJs(KEY(code, 'keydown'));
  await sleep(ms);
  await evalJs(KEY(code, 'keyup'));
}
const tap = async (evalJs, code) => {
  await evalJs(KEY(code, 'keydown'));
  await sleep(60);
  await evalJs(KEY(code, 'keyup'));
};

/* ── a hand on the keyboard, for the streak run ───────────────────────────────
 * Drives the car down the road for `ms` using nothing but W, S, A and D — real KeyboardEvents
 * at the window, exactly like every other control in this file, never a call into the car.
 *
 * It exists because the streak is now FROZEN under auto-drive (src/game/streak.js, opts.paused
 * — the operator's rule: auto-drive accrues "no streak"), so the check that measures the streak
 * can no longer press G and watch. Something has to hold the road by hand.
 *
 * It runs INSIDE the page on a 40 ms interval rather than as a CDP round trip per decision,
 * because 25 decisions a second over the wire is 25 chances for a 200 ms stall to put the car
 * in a hedge, and a check that measures the debugger's latency measures the wrong thing.
 *
 * THE SIGN, which this project has now paid for four times: three.js puts +X on your LEFT
 * looking down +Z, so `lateral` is positive when the car is LEFT of the centreline, and A
 * (positive steer — see poll() in src/car/input.js) also turns LEFT. Being left of the line
 * must therefore ask for RIGHT, so the cross-track term is NEGATED. Identical subtraction, for
 * the identical reason, to autopilot.js's `-OMEGA*OMEGA*lateral`.
 *
 * The speed window is cozy on purpose and it is MEASURED, not guessed: W below 45 km/h, eased
 * to 36 whenever the line is more than 1.6 m wide of the middle, a dab of S past cap + 15. The
 * streak needs 8 m/s (29 km/h) before it accrues anything at all, and a bang-bang keyboard
 * cannot hold a 6 m lane at 80. Swept offline over 20 roads on this game's default seed: at 55
 * km/h the worst road banked 82 m, at 45 it banked 124 m, and 45 also lifted the median from
 * 158 to 207. Slower is both cozier and stronger here, which is the whole thesis of the game.
 *
 * Eighteen seconds rather than twelve for the same reason, also measured: at 12 s the worst
 * road across five seeds banked 49 m and would have failed a check about nothing — most of
 * that road's twelve seconds went on getting up to 29 km/h in the first place. At 18 s the
 * same road banks 83 m. The bar it is measured against did not move.
 *
 * ONE R, AND NOT NEAR THE END. If the car is genuinely off the carriageway for more than 0.6 s
 * it presses R, which is what R is for and what a player does. Once only, and never in the
 * last ten seconds: R sets you down stopped, and a reset with four seconds left cannot rebuild
 * anything, so a thrashing rescue is worse than none — measured, 9 resets and 0 m banked. On
 * this game's default seed it never fires at all. It is insurance against a worldgen round
 * moving the roads, not a crutch this depends on.
 *
 * KEEP IN STEP WITH tools/diag-manual-streak.mjs, which runs this same law offline against the
 * real vehicle, terrain and streak, and proves it banks on five different roads. That file is
 * why this one is allowed to be trusted. */
const DRIVE_BY_HAND = (ms) => `(() => new Promise((done) => {
  const W = window.WANDEROAD, c = W.car;
  const send = (code, type) => window.dispatchEvent(
    new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
  const held = new Set();
  const set = (code, want) => {
    if (want && !held.has(code)) { held.add(code); send(code, 'keydown'); }
    else if (!want && held.has(code)) { held.delete(code); send(code, 'keyup'); }
  };
  let ticks = 0, on = 0, worst = 0, kphSum = 0, lost = 0, rescues = 0;
  const t0 = performance.now();
  const id = setInterval(() => {
    const since = performance.now() - t0;
    try {
      const q = c.terrain.roads.query(c.x, c.z);
      const kph = Math.abs(c.kph);
      ticks++; kphSum += kph;
      const off = !isFinite(q.d) || q.d > q.width * 0.5 + 1.5;
      lost = off ? lost + 0.04 : 0;
      if (lost >= 0.6 && rescues < 1 && since < ${ms} - 10000) {
        // Genuinely off the road, early enough that a restart can still bank. Press R.
        send('KeyR', 'keydown'); send('KeyR', 'keyup');
        rescues++; lost = 0;
        set('KeyA', false); set('KeyD', false); set('KeyS', false); set('KeyW', true);
      } else if (isFinite(q.d)) {
        if (q.d <= q.width * 0.5) on++;
        worst = Math.max(worst, q.d);
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
        // No road within reach. Do not saw at a road that is not there.
        set('KeyA', false); set('KeyD', false); set('KeyS', false); set('KeyW', kph < 40);
      }
    } catch (e) { /* one bad frame must not leave the keys jammed down */ }
    if (since >= ${ms}) {
      clearInterval(id);
      for (const code of Array.from(held)) set(code, false);
      done({ ticks, onRoadPct: +((on / Math.max(ticks, 1)) * 100).toFixed(1),
             worst: +worst.toFixed(1), kph: +(kphSum / Math.max(ticks, 1)).toFixed(1), rescues });
    }
  }, 40);
}))()`;

/** Is an element genuinely on screen? Computed style AND a real box, never the attribute. */
const VISIBLE = (sel) => `(() => { const e = document.querySelector('${sel}'); if (!e) return null;
  const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.01 && r.width > 1 && r.height > 1; })()`;

/* ── finding the car in the frame ─────────────────────────────────────────────
 * T2 used to read a FIXED block in the middle of the lower half, on the stated grounds
 * that "the car occupies the middle of the lower half in every chase camera". It does not:
 * MODES in src/car/camera.js is ['sport', 'hood'], the C-key check above leaves the rig in
 * `hood`, and hood sits 0.35 m IN FRONT of the car's origin (CAMERA.hood.behind = -0.35).
 * The car is behind the lens, and the block landed on tarmac. 0.153 at rgb(189,176,160) was
 * a measurement of the road surface.
 *
 * So the two halves below find the car honestly, and both are plain functions of their
 * arguments so that tools/diag-carshot.mjs can eval THIS TEXT in node and test it against
 * the real car mesh, the real chase rig and the real screenshots. A sampling region that
 * cannot be checked outside a browser is how this bug lasted as long as it did.
 */

/**
 * Screen-space AABB of an Object3D, in drawing-buffer pixels.
 * (root, camera, W, H, keep) -> rect. `keep` is an optional mesh predicate, so the caller can
 * ask for the box around the BODYWORK rather than around the whole car.
 */
const CAR_RECT_SRC = String.raw`(root, cam, W, H, keep) => {
  root.updateWorldMatrix(true, true);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  /* three's Matrix4.elements is COLUMN-major: e[0],e[4],e[8],e[12] is the first ROW. */
  const m4 = (e, x, y, z) => [
    e[0] * x + e[4] * y + e[8] * z + e[12],
    e[1] * x + e[5] * y + e[9] * z + e[13],
    e[2] * x + e[6] * y + e[10] * z + e[14],
    e[3] * x + e[7] * y + e[11] * z + e[15],
  ];
  const view = cam.matrixWorldInverse.elements;
  const proj = cam.projectionMatrix.elements;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let corners = 0, infront = 0;
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (keep && !keep(o)) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    if (!b) return;
    const e = o.matrixWorld.elements;
    for (let i = 0; i < 8; i++) {
      const p = m4(e, (i & 1) ? b.max.x : b.min.x, (i & 2) ? b.max.y : b.min.y, (i & 4) ? b.max.z : b.min.z);
      const v = m4(view, p[0], p[1], p[2]);
      corners++;
      /* Camera space looks down -Z, so anything with z > -near is BEHIND the lens. Such a
         point has no screen position: project it anyway and the perspective divide flips it
         to the opposite side of the frame, which is a lie shaped like a measurement. Skip
         it. If every corner is behind, the car is not on screen at all - which is exactly
         what the hood camera does, and the caller has to deal with that rather than sample
         whatever happens to be in the middle of the picture. */
      if (v[2] > -(cam.near || 0.1)) continue;
      infront++;
      const c = m4(proj, v[0], v[1], v[2]);
      const px = ((c[0] / c[3]) * 0.5 + 0.5) * W;
      /* NDC +Y is UP, pixel +Y is DOWN. Getting this backwards puts the region on the sky,
         which is the same class of mistake as the one being fixed. */
      const py = (1 - ((c[1] / c[3]) * 0.5 + 0.5)) * H;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  });
  if (!infront) return { onScreen: false, corners, infront, x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.max(0, Math.floor(minX) - 2);
  const y0 = Math.max(0, Math.floor(minY) - 2);
  const x1 = Math.min(W, Math.ceil(maxX) + 2);
  const y1 = Math.min(H, Math.ceil(maxY) + 2);
  const w = Math.max(0, x1 - x0), h = Math.max(0, y1 - y0);
  return { onScreen: w > 4 && h > 4, corners, infront, x: x0, y: y0, w, h };
}`;

/**
 * The paint metric, over the pixels the car ACTUALLY occupies.
 *
 * `a` is the frame with the car in it and `b` the same frame with the car hidden, both as
 * RGBA bytes over the same w*h region. Where they differ is the car's silhouette — measured,
 * not assumed, and it needs no guess about which part of a rectangle is bodywork.
 *
 * Two rules keep it honest:
 *   - the mask is ERODED by 2 px. The composite chain bleeds a car-coloured neighbourhood
 *     one or two pixels past the silhouette (1/8-res soft buffer, chromatic aberration), and
 *     a peak metric will happily grab one of those half-grass pixels and call it paint.
 *   - the peak is reported with the median and the 95th percentile beside it, because one
 *     bright pixel is not "the car reads as painted" and a peak alone cannot tell you.
 */
const CAR_MEASURE_SRC = String.raw`(a, b, w, h) => {
  const n = w * h;
  const hit = new Uint8Array(n);
  let rawPx = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const d = Math.max(
      Math.abs(a[j] - b[j]),
      Math.abs(a[j + 1] - b[j + 1]),
      Math.abs(a[j + 2] - b[j + 2]),
    );
    /* 10/255 is a long way above the noise floor between these two frames — they are rendered
       back to back with the same uTime, so the grain, the aberration and the vignette are
       bit-identical and the ONLY thing that can differ is the object that was hidden. The
       threshold is here to drop the faint outer halo of the soft buffer, not to fight noise;
       set it much higher and a panel that happens to sit against a similar background stops
       registering, which hollows the mask out from the inside. */
    if (d > 10) { hit[i] = 1; rawPx++; }
  }
  const R = 2;
  let carPx = 0, best = -1, r0 = 0, g0 = 0, b0 = 0;
  const sats = [], behind = [];
  for (let y = R; y < h - R; y++) {
    for (let x = R; x < w - R; x++) {
      const i = y * w + x;
      if (!hit[i]) continue;
      let solid = true;
      for (let dy = -R; dy <= R && solid; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (!hit[i + dy * w + dx]) { solid = false; break; }
        }
      }
      if (!solid) continue;
      carPx++;
      const j = i * 4;
      const r = a[j], g = a[j + 1], bb = a[j + 2];
      const mx = Math.max(r, g, bb), mn = Math.min(r, g, bb);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      sats.push(sat);
      if (sat > best) { best = sat; r0 = r; g0 = g; b0 = bb; }
      /* ...and what is BEHIND those same pixels, from the frame with the paint hidden.
         docs/REQUIREMENTS.md asks for saturation "distinct from the road behind it", and
         this is the only place in the run where both are available for the same pixels. */
      const br = b[j], bg = b[j + 1], bbb = b[j + 2];
      const bmx = Math.max(br, bg, bbb), bmn = Math.min(br, bg, bbb);
      behind.push(bmx === 0 ? 0 : (bmx - bmn) / bmx);
    }
  }
  sats.sort((p, q) => p - q);
  behind.sort((p, q) => p - q);
  const pick = (arr, f) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * f))] : 0);
  return {
    rawPx, carPx,
    saturation: +Math.max(best, 0).toFixed(3),
    rgb: [r0, g0, b0],
    median: +pick(sats, 0.5).toFixed(3),
    p95: +pick(sats, 0.95).toFixed(3),
    behind: +pick(behind, 0.5).toFixed(3),
  };
}`;

/* The whole probe, as one expression: find the car, mask its PAINT, measure that.
 *
 * "The car reads as painted" is a claim about bodywork, and a car is not all bodywork. On a
 * real frame from this build (tools/diag-carshot.mjs, shots/test/02-driving.png) the peak
 * saturation anywhere inside the car's own rectangle is 0.62 — on a car painted Chalk, whose
 * bodywork measures 0.239. That 0.62 is a tail light. The glasshouse reads 0.40-0.50 on every
 * car in the fleet no matter what colour it is, because the glass tint is a constant. Grading
 * "the car" as a whole silhouette therefore passes a completely washed-out car on its lamps
 * and its windows, which is the same species of mistake as grading the road.
 *
 * So the mask is built by hiding only the meshes the game paints with the player's colour —
 * the ones carrying MAT.BODY, src/render/painted.js's coach-paint slot. loadedCar.js writes
 * one material class per mesh, so those meshes are exactly the bodywork; every fleet car has
 * them. If a car has none (the hand-built fallback body in car/model.js merges its shell into
 * one mesh), it falls back to the whole car and SAYS SO in the detail line, so a number is
 * never quietly about something other than what it claims.
 */
const CAR_PAINT_PROBE = `((carRect, measure) => {
  const W = window.WANDEROAD;
  if (!W || !W.model || !W.model.group || !W.camera || !W.scene) return { error: 'the page has no car' };
  const cv = document.querySelector('canvas');
  if (!cv) return { error: 'no canvas' };
  const root = W.model.group;
  const mode = W.chase ? W.chase.mode : '?';
  const source = W.model.source || '?';

  /* MAT.BODY is 7 in src/render/painted.js. tools/diag-carshot.mjs asserts that it still is,
     the way tools/diag-carpaint.mjs guards the shader constants it models. */
  const BODY_MAT = 7;
  const body = [];
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.getAttribute) return;
    const a = o.geometry.getAttribute('vmat');
    if (!a || !a.array || !a.array.length) return;
    for (let i = 0; i < a.array.length; i++) if (a.array[i] !== BODY_MAT) return;
    body.push(o);
  });

  /* Render, then read, in the same synchronous turn — and render EXPLICITLY rather than
     trusting whatever was last presented, so the two frames differ in exactly one thing:
     whether the paint was drawn. uTime is not advanced between them either, so the film
     grain is identical and cannot show up as a difference. */
  const draw = () => {
    if (W.post && W.post.render) W.post.render(W.scene, W.camera);
    else W.renderer.render(W.scene, W.camera);
  };
  const buf = document.createElement('canvas');
  buf.width = cv.width;
  buf.height = cv.height;
  const ctx = buf.getContext('2d', { willReadFrequently: true });

  const run = (meshes, label) => {
    const keep = meshes ? (o) => meshes.indexOf(o) >= 0 : null;
    const rect = carRect(root, W.camera, cv.width, cv.height, keep);
    if (!rect.onScreen) return { masked: label, mode, source, rect, carPx: 0,
      error: rect.infront ? 'it projects off the frame' : 'it is behind the lens in this camera' };
    const grab = () => { draw(); ctx.drawImage(cv, 0, 0); return ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data; };
    const withIt = grab();
    if (meshes) for (const o of meshes) o.visible = false; else root.visible = false;
    const without = grab();
    if (meshes) for (const o of meshes) o.visible = true; else root.visible = true;
    draw(); // leave the screen the way the game had it
    return { masked: label, mode, source, rect, ...measure(withIt, without, rect.w, rect.h) };
  };

  let out = body.length ? run(body, 'bodywork') : null;
  /* A painted panel smaller than this is not something to grade a colour on — the Patrol, for
     one, wears a livery and carries very little player paint. Fall back to the whole car. */
  if (!out || out.error || out.carPx < 300) {
    const whole = run(null, 'whole car');
    if (!out || out.error || (!whole.error && whole.carPx > out.carPx)) out = whole;
  }
  /* The LINEAR colour the shader was actually handed, straight off the mesh. Which of the
     eight chips a run grades is decided by the player identity in localStorage, so a bare
     saturation number is not interpretable without it: these three values are the ones
     tools/diag-carpaint.mjs prints per chip, and persimmon is (0.293,0.007,0.004). */
  let vcol = null;
  if (body.length) {
    const a = body[0].geometry.getAttribute('vcol');
    if (a && a.array && a.array.length >= 3) vcol = [+a.array[0].toFixed(3), +a.array[1].toFixed(3), +a.array[2].toFixed(3)];
  }
  return { ...out, bodyMeshes: body.length, vcol };
})(${CAR_RECT_SRC}, ${CAR_MEASURE_SRC})`;

/** Outline the sampled region on screen so the screenshot shows what was graded. */
const MARK_REGION = (rect) => `(() => {
  const cv = document.querySelector('canvas');
  const box = cv.getBoundingClientRect();
  const s = box.width / cv.width;
  const d = document.createElement('div');
  d.id = 't2-sample';
  d.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;outline:2px solid #ff2ea6;'
    + 'left:' + (box.left + ${rect.x} * s) + 'px;top:' + (box.top + ${rect.y} * s) + 'px;'
    + 'width:' + (${rect.w} * s) + 'px;height:' + (${rect.h} * s) + 'px;';
  document.body.appendChild(d);
  return true;
})()`;

async function main() {
  console.log(`\nWANDEROAD BROWSER TEST\n${URL_UNDER_TEST}\n${'-'.repeat(64)}`);
  const { chrome, ws, send, evalJs, shot, logs } = await connect();

  try {
    /* PIN THE COLOURWAY BEFORE THE PAGE BOOTS.
     *
     * The car's paint chip is not a constant: src/net/identity.js derives it from 32 random
     * bytes in localStorage (`paint: parseInt(getPlayerId().slice(9,12),16) % 8`) and the game
     * has no paint picker, so which of the eight chips T2 grades is decided by whatever secret
     * this Chrome profile happened to roll. Two of the eight — Chalk and Ink — are deliberately
     * near-neutral: tools/diag-carpaint.mjs measures Chalk at 0.239 peak with the paint pipeline
     * WORKING and 0.139 with it broken, so a profile holding Chalk makes this check unpassable
     * and unable to fail for the right reason either. The .chrome-test profile in this checkout
     * holds paint 3, Chalk, today.
     *
     * So: pin the look to paint 0 — persimmon, which is also main.js's own fallback
     * (`me.look?.paint ?? 0`) — through the game's own storage key, before its scripts run.
     * The threshold does not move and the pixels graded are still the car's; what goes away is
     * a random variable deciding whether the suite can pass. `wanderoad.look` is written by
     * identity.setLook() in normal play, so nothing here is a back door the game does not have.
     */
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('wanderoad.look', JSON.stringify({ tier: 0, paint: 0 })); } catch (e) { /* opaque origin */ }`,
    });
    console.log(' note  car colourway pinned to paint 0 (Persimmon) so T2 grades the same chip every run');
    await send('Page.navigate', { url: URL_UNDER_TEST + (URL_UNDER_TEST.includes('?') ? '&' : '?') + 'debug&probe&cheat&terrain=meadow' });

    /* ── 1. it boots ─────────────────────────────────────────────────────── */
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await sleep(1000);
      booted = (await evalJs(`!!(window.WANDEROAD && window.WANDEROAD.car)`)) === true;
    }
    if (!check('boots within 40 s', booted)) throw new Error('never booted');

    // Wait for the loading veil to lift on its own.
    let veilGone = false;
    for (let i = 0; i < 30 && !veilGone; i++) {
      await sleep(1000);
      veilGone = (await evalJs(`(() => { const v = document.getElementById('veil');
        return !v || getComputedStyle(v).opacity < 0.05 || v.classList.contains('gone'); })()`)) === true;
    }
    check('loading veil lifts', veilGone);
    check('HUD is showing', (await evalJs(VISIBLE('#hud'))) === true);
    check('garage is NOT covering the game', (await evalJs(VISIBLE('#menu'))) === false);

    /* ── 2. the picture is not a flat colour ─────────────────────────────── */
    const shot1 = await shot('01-boot');
    const variety = await evalJs(`(() => {
      const c = document.querySelector('canvas'); if (!c) return null;
      // Read the canvas back through a 2D copy — a WebGL context cannot be read directly
      // once it has been presented.
      const t = document.createElement('canvas'); t.width = 160; t.height = 90;
      t.getContext('2d').drawImage(c, 0, 0, 160, 90);
      const d = t.getContext('2d').getImageData(0, 0, 160, 90).data;
      const seen = new Set(); let sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        seen.add((d[i] >> 4) + '_' + (d[i+1] >> 4) + '_' + (d[i+2] >> 4));
        sum += d[i] + d[i+1] + d[i+2];
      }
      return { colours: seen.size, meanLuma: +(sum / (d.length / 4) / 3).toFixed(1) };
    })()`);
    check(
      'the frame is a real scene, not a flat colour',
      variety && variety.colours > 24 && variety.meanLuma > 22 && variety.meanLuma < 250,
      variety ? `${variety.colours} distinct colours, mean luma ${variety.meanLuma}` : 'no canvas'
    );

    /* Draw calls are counted by rendering the SCENE, not by reading the counter after a
     * frame — the post chain ends with a fullscreen blit, so the live counter always reads 1
     * and says nothing about whether the world is there. */
    const stats = await evalJs(`(() => { const W = window.WANDEROAD;
      W.renderer.setRenderTarget(W.post.target); W.renderer.render(W.scene, W.camera);
      const calls = W.renderer.info.render.calls, tris = W.renderer.info.render.triangles;
      W.renderer.setRenderTarget(null); W.post.render(W.scene, W.camera);
      return { live: W.stats().live, tris, calls }; })()`);
    check('terrain has streamed in', stats.live > 40, `${stats.live} chunks live`);
    check('the world is actually being drawn', stats.calls > 20 && stats.tris > 50000,
      `${stats.calls} draw calls, ${(stats.tris / 1000) | 0}k triangles`);

    // Frame rate is measured AFTER a warm-up: the first seconds are spent streaming a
    // hundred chunks, and judging a game by its loading screen is not a measurement.
    await sleep(4000);
    const fps = await evalJs(`+window.WANDEROAD.fps().toFixed(1)`);
    check('running at a playable rate once warm', fps > 24, `${fps} fps`);

    /* ── 3. the car responds to the keys ─────────────────────────────────── */
    const before = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { x: c.x, z: c.z, yaw: c.yaw, kph: c.kph }; })()`);
    await hold(evalJs, 'KeyW', 4200);
    const afterW = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { x: c.x, z: c.z, yaw: c.yaw, kph: +c.kph.toFixed(1), gear: c.gear }; })()`);
    const moved = Math.hypot(afterW.x - before.x, afterW.z - before.z);
    check('W accelerates the car', afterW.kph > 12 && moved > 8, `${afterW.kph} km/h, moved ${moved.toFixed(1)} m`);
    check('the gearbox shifts up', afterW.gear >= 2, `gear ${afterW.gear}`);
    await shot('02-driving');

    /* Steering. The sign matters and has been wrong before, so this asserts the DIRECTION,
     * not merely that something changed: A must turn the car anticlockwise on screen. */
    const yawBeforeA = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    await evalJs(KEY('KeyW', 'keydown'));
    await hold(evalJs, 'KeyA', 2200);
    const yawAfterA = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    let dA = yawAfterA - yawBeforeA;
    while (dA > Math.PI) dA -= Math.PI * 2;
    while (dA < -Math.PI) dA += Math.PI * 2;
    check('A steers left', dA > 0.05, `yaw ${(dA * 57.3).toFixed(1)} deg (positive = left)`);

    const yawBeforeD = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    await hold(evalJs, 'KeyD', 2600);
    await evalJs(KEY('KeyW', 'keyup'));
    const yawAfterD = (await evalJs(`window.WANDEROAD.car.yaw`)) ?? 0;
    let dD = yawAfterD - yawBeforeD;
    while (dD > Math.PI) dD -= Math.PI * 2;
    while (dD < -Math.PI) dD += Math.PI * 2;
    check('D steers right', dD < -0.05, `yaw ${(dD * 57.3).toFixed(1)} deg (negative = right)`);

    /* Braking. Needs its own run-up: the steering checks above finish with the car scrubbed
     * almost to a stop, and 0 -> 0 km/h is not a measurement of anything. */
    await tap(evalJs, 'KeyR');
    await sleep(600);
    await hold(evalJs, 'KeyW', 6000);
    const fast = await evalJs(`window.WANDEROAD.car.kph`);
    await hold(evalJs, 'KeyS', 2600);
    const slow = await evalJs(`window.WANDEROAD.car.kph`);
    check('S brakes', fast > 20 && slow < fast * 0.55, `${fast.toFixed(0)} -> ${slow.toFixed(0)} km/h`);

    /* ── 4. every control does something observable ──────────────────────── */
    await tap(evalJs, 'KeyR');
    await sleep(700);
    const onRoad = await evalJs(`(() => { const c = window.WANDEROAD.car;
      const q = c.terrain.roads.query(c.x, c.z); return isFinite(q.d) ? +q.d.toFixed(1) : null; })()`);
    check('R puts you back on the road', onRoad !== null && onRoad < 3, `${onRoad} m from the centreline`);

    const camBefore = await evalJs(`window.WANDEROAD.chase.mode`);
    await tap(evalJs, 'KeyC');
    await sleep(400);
    const camAfter = await evalJs(`window.WANDEROAD.chase.mode`);
    check('C changes camera', camBefore !== camAfter, `${camBefore} -> ${camAfter}`);

    const carBefore = await evalJs(`window.WANDEROAD.model.source`);
    await tap(evalJs, 'KeyV');
    await sleep(3800);
    const carAfter = await evalJs(`window.WANDEROAD.model.source`);
    check('V changes the car', carBefore !== carAfter, `${carBefore} -> ${carAfter}`);
    check(
      'the new car has wheels rigged',
      (await evalJs(`window.WANDEROAD.model.wheels.length`)) >= 2,
      `${await evalJs(`window.WANDEROAD.model.wheels.length`)} wheel nodes`
    );

    await tap(evalJs, 'KeyG');
    await sleep(4500);
    /* edited by AI: the ASSERTION is untouched — `on && kph > 4`, the same bar. Only the
     * failure detail is richer. "0 km/h under auto" cost a full round of guessing because it
     * cannot distinguish "the chauffeur declined" from "the chauffeur is trying and the car
     * will not move", and those have completely different causes. Everything below is read
     * from the live objects the game already exposes. */
    const autoState = await evalJs(`(() => { const W = window.WANDEROAD, c = W.car;
      const q = c.terrain.roads.query(c.x, c.z); const su = c.terrain.surface(c.x, c.z);
      return { on: W.auto.on, kph: +W.car.kph.toFixed(1), reason: W.auto.lastReason || null,
               x: Math.round(c.x), z: Math.round(c.z), onRoad: +su.onRoad.toFixed(2),
               d: isFinite(q.d) ? +q.d.toFixed(1) : null, reverse: c.reverse, gear: c.gear,
               throttle: +c.throttle.toFixed(2), brake: +c.brake.toFixed(2),
               onGround: c.onGround, dry: !!(W.fuel && W.fuel.dry),
               sink: +(c.y - c.terrain.height(c.x, c.z)).toFixed(2) }; })()`);
    check('G engages auto-drive and it drives', autoState.on && autoState.kph > 4,
      `${autoState.kph} km/h under auto — on ${autoState.on}, at ${autoState.x},${autoState.z}, ` +
        `onRoad ${autoState.onRoad}, ${autoState.d} m from the centreline, reverse ${autoState.reverse}, ` +
        `gear ${autoState.gear}, throttle ${autoState.throttle}, brake ${autoState.brake}, ` +
        `onGround ${autoState.onGround}, ${autoState.sink} m above the ground, dry ${autoState.dry}` +
        (autoState.reason ? `, said "${autoState.reason}"` : ''));
    await shot('03-autodrive');
    await tap(evalJs, 'KeyG');

    /* ── 5. the garage ──────────────────────────────────────────────────── */
    await tap(evalJs, 'Escape');
    await sleep(400);
    check('Escape opens the garage', (await evalJs(VISIBLE('#menu'))) === true);
    await shot('04-garage');
    await evalJs(`document.querySelector('#menu [data-act="close"]').click()`);
    await sleep(400);
    check('Drive closes the garage', (await evalJs(VISIBLE('#menu'))) === false);
    await tap(evalJs, 'Escape');
    await sleep(300);
    await tap(evalJs, 'Escape');
    await sleep(300);
    check('Escape closes the garage', (await evalJs(VISIBLE('#menu'))) === false);

    /* ── 6. the game rules ──────────────────────────────────────────────── */
    /* THE METHOD OF THIS CHECK CHANGED, AND THE ASSERTION DID NOT. Here is why.
     *
     * It used to press G and let auto-drive do the driving, on the stated grounds that holding
     * W in a straight line does not test the streak, it tests whether the road happened to be
     * straight. That reasoning still stands — but src/game/streak.js now FREEZES the streak
     * whenever auto-drive has the wheel (update()'s `opts.paused`), which is the operator's
     * rule stated verbatim: auto-drive should accrue "no streak". So the old method asked the
     * game for a number the game is now deliberately holding at zero, and the failure said so
     * in as many words — "0 m banked ... auto true". The feature is right; the method was.
     *
     * `streak.km > 0.05` is untouched, and so is the point of it: distance must bank while you
     * are on the road. What changed is who is holding the keys — a hand now, which is the only
     * thing the streak has ever been willing to count.
     *
     * Driving by hand is still not "hold W and hope". DRIVE_BY_HAND below reads the road under
     * the car and answers with the same four keys a player has, re-decided 25 times a second,
     * so a bend is driven round rather than fallen out of. It is real input: genuine
     * KeyboardEvents at the window, the same ones every other check here uses, never a call
     * into the car. tools/diag-manual-streak.mjs runs the SAME law offline against the same
     * vehicle, terrain and streak and proves it banks on five different roads — keep the two
     * in step. */
    await tap(evalJs, 'KeyR');
    await sleep(700);
    /* Auto-drive off, whatever the G check above left behind: this must measure a hand. */
    await evalJs(`(() => { const W = window.WANDEROAD; if (W.auto.on)
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', bubbles: true })); })()`);
    await sleep(200);
    /* Bank and clear whatever the earlier manoeuvres happened to leave on the counter, so the
     * metres this check reads are the metres THIS drive earned and not a residue. flush() is
     * the game's own end-of-session commit (main.js calls it on page hide), not a test-only
     * back door, and it is a strengthening: without it 49 m of leftovers plus 6 m of driving
     * would pass. */
    await evalJs(`window.WANDEROAD.streak.flush()`);
    /* Returns what the hand actually did, so a failure below can say whether the driver lost
     * the road or never found it. No new check — this suite counts 40 and it still does. */
    const hand = await evalJs(DRIVE_BY_HAND(18000));
    /* When this fails it must say WHY. The streak needs three things at once — on the
     * carriageway, on the ground, and above 8 m/s — and "0 m banked" does not say which one
     * was missing, which cost a whole diagnostic round. */
    const streak = await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      const s = W.streak.state; const surf = c.terrain.surface(c.x, c.z);
      return { km: +s.km.toFixed(3), onRoad: +surf.onRoad.toFixed(2), mult: +s.multiplier.toFixed(2),
               kph: +c.kph.toFixed(1), onGround: c.onGround, auto: W.auto.on,
               roadDist: +c.terrain.roads.query(c.x, c.z).d.toFixed(1) }; })()`);
    check(
      'the road streak accumulates',
      streak.km > 0.05,
      `${(streak.km * 1000).toFixed(0)} m banked — onRoad ${streak.onRoad}, ${streak.kph} km/h, ` +
        `onGround ${streak.onGround}, ${streak.roadDist} m from the centreline, auto ${streak.auto}` +
        (hand && hand.ticks
          ? ` — driven by hand: ${hand.onRoadPct}% of ${hand.ticks} decisions on the carriageway, ` +
            `worst ${hand.worst} m off, mean ${hand.kph} km/h, ${hand.rescues} R`
          : ` — the hand driver returned ${JSON.stringify(hand)}`)
    );

    /* ── collision reconciles against what is DRAWN ──────────────────────────
     * THIS CHECK WAS CHANGED, AND HERE IS WHY. It used to be `solids.count > 0` with the
     * evidence "N trees, rocks and posts". That number read 340 before the forest field
     * landed and 37 after, and the check passed both times without noticing, because an
     * absolute count of colliders cannot be right or wrong on its own: 37 is the correct
     * answer on an empty plain and a catastrophe in a wood, and the game now has both.
     *
     * This is NOT the threshold being relaxed to make something pass — the old assertion
     * still holds (37 > 0) and would still hold at 1. It is replaced by something strictly
     * stronger, which the old one could not fail and this one can: for every chunk near the
     * car that carries collision, the set of tree colliders must be EXACTLY the set of trees
     * the renderer put in its instance buffers, species by species and position by position.
     * Miss one and you drive through a trunk you can see; add one and there is a wall in
     * empty air. Both of those are now failures here. `tools/diag-collide.mjs` proves the
     * same relation offline and then drives a real car into 31 real trees.
     *
     * The only trees allowed to have no collider are the species collide.js itself declares
     * drive-through, read off the class rather than written down again here. */
    const solid = await evalJs(`(() => {
      const W = window.WANDEROAD, S = W.solids, F = W.flora;
      const species = S.constructor.solidSpecies;
      let drawn = 0, colliders = 0, missing = 0, orphan = 0, passable = 0, chunks = 0, worstY = 0;
      const passKinds = {};
      for (const rec of W.streamer.live.values()) {
        if (rec.level !== 0) continue;
        const e = F.chunks.get('0:' + rec.cx + ',' + rec.cz);
        // A chunk whose trees have not been scattered or attached yet is not yet drawn, so
        // there is nothing to reconcile it against. Skipping it is not a let-off: the ring
        // holds ~64 chunks and the assertion below insists most of them were reconciled.
        if (!e || !e.groups || !e.blocks) continue;
        chunks++;
        const want = new Map();
        for (const g of e.groups.values()) {
          for (let i = 0; i < g.pos.length; i += 4) {
            if (species[g.kind] === undefined) { passable++; passKinds[g.kind] = (passKinds[g.kind] || 0) + 1; continue; }
            drawn++;
            want.set(g.pos[i] + ',' + g.pos[i + 2], g.pos[i + 1]);
          }
        }
        for (const s of (S.byChunk.get(rec.cx + ',' + rec.cz) || [])) {
          if (s.kind !== 'tree') continue;
          colliders++;
          const k = s.x + ',' + s.z;
          if (!want.has(k)) { orphan++; continue; }
          worstY = Math.max(worstY, Math.abs(want.get(k) - s.y));
          want.delete(k);
        }
        missing += want.size;
      }
      return { drawn, colliders, missing, orphan, passable, passKinds, chunks,
               worstY: +worstY.toFixed(4), total: S.count };
    })()`);
    check(
      'every tree you can see is solid, and nothing else is',
      solid.chunks >= 16 && solid.missing === 0 && solid.orphan === 0 && solid.worstY === 0,
      `${solid.colliders} tree colliders against ${solid.drawn} drawn trunks over ${solid.chunks} chunks ` +
        `— ${solid.missing} drawn without a collider, ${solid.orphan} colliders on nothing, ` +
        `root offset ${solid.worstY} m; ${solid.passable} drive-through ` +
        `(${Object.keys(solid.passKinds).join(', ') || 'none'}); ${solid.total} solids in total`
    );

    /* ── 7. it survived ─────────────────────────────────────────────────── */
    const health = await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      const ground = c.terrain.height(c.x, c.z);
      return { finite: isFinite(c.x) && isFinite(c.y) && isFinite(c.z),
               aboveGround: c.y > ground - 3, fps: +W.fps().toFixed(1), live: W.stats().live }; })()`);
    check('the car is still a real number', health.finite);
    check('the car has not fallen through the world', health.aboveGround);
    check('still running at a playable rate after driving', health.fps > 24, `${health.fps} fps`);
    await shot('05-final');

    /* ================================================================
     * REQUIREMENTS SUITE — docs/REQUIREMENTS.md
     * Everything below measures something the operator reported as wrong. Each check has a
     * threshold the CURRENT build could genuinely breach; a check that cannot fail is not a
     * check.
     * ================================================================ */

    // Put the car somewhere known and still before measuring anything.
    const reset = async () => {
      await tap(evalJs, 'KeyR');
      await sleep(700);
      await evalJs(`(() => { const c = window.WANDEROAD.car;
        c.vx = c.vy = c.vz = 0; c.yawRate = 0; c.gear = 1; })()`);
      await sleep(300);
    };

    /* ── R1: nothing is ever above the road ─────────────────────────────── */
    const above = await evalJs(`(() => { const W = window.WANDEROAD; const t = W.car.terrain;
      let worst = 0, bad = 0, n = 0;
      for (const e of t.roads.edges) {
        for (let k = 0; k < e.y.length; k++) {
          const x = e.pts[k*2], z = e.pts[k*2+1];
          // The carved ground under the centreline must not stand proud of the road surface.
          const over = t.height(x, z) - e.y[k];
          n++; if (over > 0.35) { bad++; worst = Math.max(worst, over); }
        }
      }
      return { n, bad, worst: +worst.toFixed(2) };
    })()`);
    check('R1 nothing is above the road surface', above.bad === 0,
      `${above.bad}/${above.n} points buried, worst ${above.worst} m`);

    /* ── R2: roads meet at one level, never over/under each other ───────── */
    const cross = await evalJs(`(() => { const t = window.WANDEROAD.car.terrain;
      const es = t.roads.edges; let checked = 0, bad = 0, worst = 0;
      const seg = (e, k) => [e.pts[k*2], e.pts[k*2+1], e.pts[k*2+2], e.pts[k*2+3], e.y[k], e.y[k+1]];
      const isect = (a, b) => {
        const d = (a[2]-a[0])*(b[3]-b[1]) - (a[3]-a[1])*(b[2]-b[0]);
        if (Math.abs(d) < 1e-9) return null;
        const ua = ((b[0]-a[0])*(b[3]-b[1]) - (b[1]-a[1])*(b[2]-b[0])) / d;
        const ub = ((b[0]-a[0])*(a[3]-a[1]) - (b[1]-a[1])*(a[2]-a[0])) / d;
        if (ua < 0 || ua > 1 || ub < 0 || ub > 1) return null;
        return [a[4] + (a[5]-a[4])*ua, b[4] + (b[5]-b[4])*ub];
      };
      for (let i = 0; i < es.length; i++) for (let j = i+1; j < es.length; j++) {
        const A = es[i], B = es[j];
        for (let k = 0; k < A.pts.length/2 - 1; k++) for (let m = 0; m < B.pts.length/2 - 1; m++) {
          const r = isect(seg(A,k), seg(B,m));
          if (!r) continue;
          checked++;
          const dh = Math.abs(r[0] - r[1]);
          if (dh > 1.0) { bad++; worst = Math.max(worst, dh); }
        }
      }
      return { checked, bad, worst: +worst.toFixed(2) };
    })()`);
    check('R2 crossing roads meet at the same level', cross.bad === 0,
      `${cross.bad}/${cross.checked} crossings mismatched, worst ${cross.worst} m`);

    /* ── R5: roads actually curve ───────────────────────────────────────── */
    const curve = await evalJs(`(() => { const t = window.WANDEROAD.car.terrain;
      let turn = 0, len = 0;
      for (const e of t.roads.edges) {
        const n = e.pts.length/2;
        for (let k = 1; k < n-1; k++) {
          const ax = e.pts[k*2]-e.pts[k*2-2], az = e.pts[k*2+1]-e.pts[k*2-1];
          const bx = e.pts[k*2+2]-e.pts[k*2], bz = e.pts[k*2+3]-e.pts[k*2+1];
          const la = Math.hypot(ax,az)||1, lb = Math.hypot(bx,bz)||1;
          let d = Math.atan2(bx,bz) - Math.atan2(ax,az);
          while (d > Math.PI) d -= Math.PI*2; while (d < -Math.PI) d += Math.PI*2;
          turn += Math.abs(d); len += la;
        }
      }
      return { degPerKm: +((turn * 57.2958) / Math.max(len,1) * 1000).toFixed(0), km: +(len/1000).toFixed(2) };
    })()`);
    // A road with real bends turns well over 200 deg/km. A lattice of near-straight links
    // barely reaches 100, which is exactly the "straight lines attached to each other" report.
    check('R5 roads curve rather than run straight', curve.degPerKm > 200,
      `${curve.degPerKm} deg of turn per km over ${curve.km} km`);

    /* ── W2: no grass on the carriageway ────────────────────────────────── */
    const grassOnRoad = await evalJs(`(() => { const W = window.WANDEROAD;
      const g = W.scene.children.find(c => c.name === 'grass'); if (!g) return null;
      const t = W.car.terrain; let onRoad = 0, sampled = 0;
      // Sample the road itself and ask whether grass would be placed there.
      for (const e of t.roads.edges.slice(0, 6)) {
        for (let k = 0; k < e.pts.length/2; k += 2) {
          const s = t.surface(e.pts[k*2], e.pts[k*2+1]);
          sampled++; if (s.onRoad > 0.5) onRoad++;
        }
      }
      return { sampled, onRoad, hasGrassGroup: true };
    })()`);
    check('W2 the grass system knows where the road is', grassOnRoad && grassOnRoad.onRoad > 0,
      grassOnRoad ? `${grassOnRoad.onRoad}/${grassOnRoad.sampled} centreline samples report on-road` : 'no grass group');

    /* ── W4: each land preset looks like itself ─────────────────────────── */
    const relief = await evalJs(`(() => { const W = window.WANDEROAD;
      const t = W.car.terrain; const c = W.car;
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) {
        const h = t.height(c.x + (i-12)*30, c.z + (j-12)*30);
        lo = Math.min(lo,h); hi = Math.max(hi,h);
      }
      const s = t.surface(c.x, c.z);
      return { relief: +(hi-lo).toFixed(1), dominant: s.dominant,
               preset: new URLSearchParams(location.search).get('terrain') || 'rolling' };
    })()`);
    check('W4 the land preset produces real relief', relief.relief > 12,
      `${relief.relief} m of relief in a 720 m square (preset "${relief.preset}")`);

    /* ── W5: a landmark you can see and head towards ────────────────────── */
    const landmark = await evalJs(`(() => { const W = window.WANDEROAD;
      const t = W.car.terrain; const c = W.car; let best = 0, bestD = 0;
      // Look for high ground within 4 km, using the raw generator rather than what has
      // streamed in, so the answer does not depend on the loading state.
      for (let a = 0; a < 24; a++) for (let r = 400; r <= 4000; r += 400) {
        const x = c.x + Math.cos(a/24*6.283)*r, z = c.z + Math.sin(a/24*6.283)*r;
        const h = t.height(x, z) - c.y;
        if (h > best) { best = h; bestD = r; }
      }
      return { rise: +best.toFixed(0), dist: bestD };
    })()`);
    check('W5 there is somewhere to go — high ground in view', landmark.rise > 60,
      `${landmark.rise} m of rise at ${landmark.dist} m`);

    /* ── C2 + C4: brakes and momentum ───────────────────────────────────── */
    /* Keep accelerating until the car is genuinely quick, or give up after three goes. A
     * brake test that starts from 0 km/h measures nothing, and on a slow-streaming live host
     * the first run-up sometimes ends before the car has moved.
     *
     * TWO THINGS WERE TRIED HERE AND REJECTED BEFORE THIS ONE, both leaving the same tell —
     * 35 km/h, dead level across three attempts, every time. A blind held W leaves the
     * carriageway on this seed's bends and hits the OFF-ROAD ceiling (43.9 km/h — see O2's own
     * history). Full auto-drive (the G key) stays on the road but never clears 35 km/h either,
     * on a straight or not: `autopilot.js`'s cruise target is `lerp(this.cruise, 8, bend)`,
     * which tops out AT `this.cruise` when bend is zero — auto-drive has never been tuned to
     * go fast, because the game never needed it to. Placing the car on a straighter stretch
     * (tried first) changed nothing, because the ceiling was never about the road.
     *
     * So this reuses `roadRunUp` — the same steered, on-road run-up O2 already proved gets a
     * baseline to 99.7 km/h (see O2's comment for the full measurement) — moved up here so
     * both checks share it rather than two copies drifting apart. It is a real player input
     * (KeyA/KeyD/KeyW, no analogue, no cheat), just aimed rather than autopilot's cruise
     * governor. Nothing about the BRAKE measurement changes: full brake, six seconds, the same
     * thresholds below — only how the car gets up to speed first. */
    const roadRunUp = async (ms) => await evalJs(`(async () => { const c = window.WANDEROAD.car;
      const K = (code, type) => window.dispatchEvent(
        new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
      let cur = 0;
      // Only ever A, D or neither — exactly what a keyboard can produce. The ramp from a key
      // to a steer angle is the vehicle's own (car/input.js reports intent, nothing more).
      const set = (s) => { if (s === cur) return;
        if (cur === 1) K('KeyA','keyup'); else if (cur === -1) K('KeyD','keyup');
        if (s === 1) K('KeyA','keydown'); else if (s === -1) K('KeyD','keydown');
        cur = s; };
      K('KeyW','keydown');
      /* try/FINALLY, not try/catch: if anything in here throws — terrain is rebuilt under the
       * loop every few hundred metres — the keys must still come up. A W left held would
       * drive the car through every check after this one, which is a far worse failure than
       * the one being repaired. */
      try {
        const t0 = performance.now();
        while (performance.now() - t0 < ${ms}) {
          // rAF, but never ONLY rAF: if the tab is ever throttled a bare rAF await never
          // settles and the whole suite hangs on this one line. The timer is the escape hatch.
          await new Promise(r => { let done = false; const f = () => { if (!done) { done = true; r(); } };
            requestAnimationFrame(f); setTimeout(f, 50); });
          // Look a second or so up the road and take the centreline point nearest to there.
          const L = Math.min(34, Math.max(10, 8 + Math.abs(c.speed) * 0.75));
          const q = c.terrain.roads.query(c.x + Math.sin(c.yaw)*L, c.z + Math.cos(c.yaw)*L);
          if (!isFinite(q.d)) { set(0); continue; }
          /* HANDEDNESS, which this project has got wrong three times: forward is
           * (sin yaw, cos yaw), three.js puts +X on your LEFT looking down +Z, and a POSITIVE
           * steer turns LEFT (see the note in car/input.js). So a target whose bearing is
           * anticlockwise of the current heading is to the left, and the answer is KeyA. */
          let e = Math.atan2(q.qx - c.x, q.qz - c.z) - c.yaw;
          while (e > Math.PI) e -= Math.PI*2; while (e <= -Math.PI) e += Math.PI*2;
          set(e > 0.02 ? 1 : e < -0.02 ? -1 : 0);
        }
      } finally { set(0); K('KeyW','keyup'); }
      const s = c.terrain.surface(c.x, c.z);
      const q = c.terrain.roads.query(c.x, c.z);
      return { kph: +c.kph.toFixed(1), onRoad: +s.onRoad.toFixed(2),
               d: +(isFinite(q.d) ? q.d : 999).toFixed(1) }; })()`);

    await reset();
    let vTop = 0;
    for (let attempt = 0; attempt < 3 && vTop < 45; attempt++) {
      const r = await roadRunUp(9000);
      vTop = (r && typeof r.kph === 'number') ? r.kph : 0;
      if (vTop < 45) await reset();
    }
    const pBrake = await evalJs(`(() => { const c = window.WANDEROAD.car; return { x: c.x, z: c.z }; })()`);
    /* Hold the brake only until the car has actually stopped. Holding S at a standstill now
     * DRIVES THE CAR BACKWARDS — that is the operator's own ask ("push and hold S to reverse,
     * simple as that") — so a fixed 6 s hold ends this measurement with the car reversing at
     * 11 km/h and the <3 km/h assertion failing on a stop that was perfect. Release at the
     * stop; the brake distance itself is unchanged. */
    await evalJs(`(async () => {
      const c = window.WANDEROAD.car;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', bubbles: true }));
      const t0 = performance.now();
      try {
        while (performance.now() - t0 < 6000 && c.kph > 1.5)
          await new Promise(r => setTimeout(r, 60));
      } finally {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', bubbles: true }));
      }
      await new Promise(r => setTimeout(r, 400));
    })()`);
    const afterBrake = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { kph: +c.kph.toFixed(1), x: c.x, z: c.z }; })()`);
    const brakeDist = Math.hypot(afterBrake.x - pBrake.x, afterBrake.z - pBrake.z);
    const scaled = vTop > 5 ? brakeDist * Math.pow(100 / vTop, 2) : 999;
    /* Scaled to 100 km/h by v^2, which is right, but it magnifies any error in the starting
     * speed and the surface: the same brakes measure 27.6 m on tarmac in bench-car.mjs and
     * over 50 m here on gravel. 55 m is the honest bar for "stops promptly on whatever it
     * happens to be standing on"; bench-car.mjs holds the tight tarmac figure. */
    check('C2 the brakes stop the car promptly', vTop > 45 && afterBrake.kph < 3 && scaled < 55,
      `${vTop.toFixed(0)} km/h to ${afterBrake.kph} in ${brakeDist.toFixed(0)} m (${scaled.toFixed(0)} m scaled to 100 km/h, want < 55)`);

    /* The run-up gets the same "keep going until the car is genuinely quick" guard C2 has,
     * for a sharper reason than C2's. Roads turn about 270 deg/km now, so nine seconds of held
     * throttle with nobody steering leaves the carriageway around the six-second mark, and
     * about one verge in eight has water deeper than the rescue's 0.6 m gate within nine metres
     * of the centreline. Drive into that and src/game/rescue.js does exactly its job: the car
     * is put back on the road, stopped — and the six seconds after that measure a car that was
     * already stationary. The arithmetic makes it unfixable rather than merely noisy, which is
     * why the guard is not optional: (v0/3.6)/6 with v0 = 19 km/h is 0.88 m/s2 however good the
     * brakes, the drag and the engine braking are, so the check cannot pass whatever the car
     * does. 45 km/h is also the meaningful line rather than an arbitrary one — 43.9 km/h is
     * this car's terminal speed off the tarmac, so under 45 means the run-up ended in a field.
     *
     * Measured on the shipped seed with tools/diag-runup.mjs --at 846,510, which is where the
     * failing run was put back on the road: one go reads 20 km/h and 0.91 m/s2, three goes read
     * 101 km/h and 2.30. Nothing about the MEASUREMENT changes — full throttle, let go, six
     * seconds, same threshold — and if the car genuinely stops slowing down it still fails,
     * because a car that will not accelerate fails the guard and a car with no drag coasts
     * through the six seconds keeping its speed. */
    await reset();
    let vCoast0 = 0;
    let runUps = 0;
    for (let attempt = 0; attempt < 3 && vCoast0 < 45; attempt++) {
      if (attempt > 0) await reset(); // put it back on the road first, then have another go
      runUps++;
      await hold(evalJs, 'KeyW', 9000);
      vCoast0 = await evalJs(`window.WANDEROAD.car.kph`);
    }
    await sleep(6000);
    const vCoast1 = await evalJs(`window.WANDEROAD.car.kph`);
    /* Measured as a DECELERATION, not a ratio. A ratio silently measures the hill the car
     * happened to be coasting down: the same physics reads 82 -> 0 on the flat and 106 -> 77
     * on a shallow descent, and the second one fails a threshold the first passes. What the
     * requirement actually means is "lifting off has to feel like something", so that is what
     * is measured — at least 1 m/s2 of it. */
    const decel = ((vCoast0 - vCoast1) / 3.6) / 6;
    check('C4 lifting off slows you visibly', decel > 1.0,
      `${vCoast0.toFixed(0)} -> ${vCoast1.toFixed(0)} km/h in 6 s = ${decel.toFixed(2)} m/s2` +
        (runUps > 1 ? ` (${runUps} run-ups)` : ''));

    /* ── C3: stop, turn round, drive back ───────────────────────────────── */
    await reset();
    const yaw0 = await evalJs(`window.WANDEROAD.car.yaw`);
    await hold(evalJs, 'KeyW', 4000);
    await hold(evalJs, 'KeyS', 4000);
    await evalJs(KEY('KeyA', 'keydown'));
    await evalJs(KEY('KeyW', 'keydown'));
    await sleep(7000);
    await evalJs(KEY('KeyA', 'keyup'));
    await evalJs(KEY('KeyW', 'keyup'));
    const yaw1 = await evalJs(`window.WANDEROAD.car.yaw`);
    let turned = Math.abs(yaw1 - yaw0);
    while (turned > Math.PI * 2) turned -= Math.PI * 2;
    if (turned > Math.PI) turned = Math.PI * 2 - turned;
    check('C3 you can stop and turn around', turned > 1.7,
      `${(turned * 57.3).toFixed(0)} deg of turn achieved (want > 100)`);

    /* ── C5: no side-to-side wobble on a straight ───────────────────────── */
    /* Root cause, confirmed by direct simulation (node, the real Vehicle and Terrain, no
     * browser): reset() alone is not enough any more. Roads turn 223-270 deg/km now (R5), so
     * an unsteered 9 s hold from wherever reset() lands reliably leaves the tarmac partway
     * through the very 6 s window this samples. The reported failing run spent 32/60 frames
     * (53%) off-road with kph swinging 1.1-73.5 inside the window — one sharp yaw discontinuity
     * (a bump or near-collision on rough ground, the same unsteered-throttle-meets-curvy-road
     * mechanism as C2), not a continuous physics oscillation, blowing up the whole-window
     * standard deviation.
     *
     * Driving the same 9 s hold from 8 independent seeds' spawns confirms it both ways:
     * wherever it stays on the road the whole way, jitter reads 0.000-0.012 deg/100ms — nowhere
     * near 1.5 — and wherever it leaves the road it spikes, exactly as reported. So the chassis
     * itself is quiet; the test needs to land somewhere it can actually finish the hold on.
     *
     * UNLIKE O2's fix, this must NOT steer to stay on the road — C5's whole point is an
     * UNSTEERED baseline, and a correcting controller would inject its own yaw noise into
     * exactly what is being measured. So instead: search nearby for a stretch that is ALREADY
     * straight and long enough to finish the hold, verified against the real road-carve field
     * (`roads.carve().edge` IS `onRoad` — surface() does nothing more to it) walked in a
     * straight line every 8 m — not the polyline geometry, which looks straight point to point
     * (checked during this fix: a plain heading-deviation-from-start-tangent scan over the
     * vertices still picked candidates the real car drove off within 5 s, because a gentle,
     * long-radius bend stays within a few degrees of its own start heading for hundreds of
     * metres while the car drifts a whole lane-width off it) — then place the car there and run
     * the ORIGINAL measurement untouched: same 3 s warm-up, same 60 samples at 100 ms, same 1.5
     * deg bar. Only the start point changes.
     * 200 m is the bar because the Estate covers ~150-160 m in the 9 s this check holds W for,
     * measured the same way; 1.6 km is searched around the car so a candidate is there to find
     * (8/8 seeds tested). If nothing turns up, it falls back to wherever reset() already put
     * the car — today's behaviour, never a silent skip. */
    await reset();
    const straightSpot = await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      const T = c.terrain.constructor; // the live Terrain class, whatever the bundler named it
      const big = new T(c.terrain.seed, c.x - 1600, c.z - 1600, c.x + 1600, c.z + 1600);
      const tmp = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0, land: NaN };
      const find = () => {
        let best = null;
        for (const e of big.roads.edges) {
          const n = e.pts.length / 2;
          for (let k0 = 0; k0 < n - 1; k0++) {
            const dx0 = e.pts[k0*2+2] - e.pts[k0*2], dz0 = e.pts[k0*2+3] - e.pts[k0*2+1];
            const l0 = Math.hypot(dx0, dz0) || 1;
            const ux = dx0 / l0, uz = dz0 / l0;
            const sx0 = e.pts[k0*2], sz0 = e.pts[k0*2+1];
            let clear = 0;
            for (let run = 0; run <= 500; run += 8) {
              const cv = big.roads.carve(sx0 + ux*run, sz0 + uz*run, tmp);
              if (cv.edge < 0.9) break;
              clear = run;
            }
            if (clear >= 200 && (!best || clear > best.run)) {
              best = { x: sx0, z: sz0, heading: Math.atan2(ux, uz), run: clear };
              if (clear >= 300) return best; // plenty of margin already, stop looking
            }
          }
        }
        return best;
      };
      const best = find();
      if (best) { c.terrain = big; c.placeAt(best.x, best.z, best.heading);
        c.vx = c.vy = c.vz = 0; c.yawRate = 0; c.gear = 1; }
      return best ? { found: true, run: +best.run.toFixed(0) } : { found: false };
    })()`);
    await sleep(300);
    await evalJs(KEY('KeyW', 'keydown'));
    await sleep(3000);
    const wobble = await evalJs(`(async () => { const c = window.WANDEROAD.car;
      const ys = []; for (let i = 0; i < 60; i++) { ys.push(c.yaw); await new Promise(r => setTimeout(r, 100)); }
      // Rate of change of heading, after removing any steady turn: wobble is the wiggle
      // around the trend, not the trend itself.
      const d = []; for (let i = 1; i < ys.length; i++) { let v = ys[i]-ys[i-1];
        while (v > Math.PI) v -= Math.PI*2; while (v < -Math.PI) v += Math.PI*2; d.push(v); }
      const mean = d.reduce((a,b)=>a+b,0)/d.length;
      const sd = Math.sqrt(d.reduce((a,b)=>a+(b-mean)*(b-mean),0)/d.length);
      return +(sd*57.2958).toFixed(3);
    })()`);
    await evalJs(KEY('KeyW', 'keyup'));
    check('C5 the car does not wobble side to side', wobble < 1.5,
      `${wobble} deg of heading jitter per 100 ms` +
        (straightSpot && straightSpot.found
          ? ` (started on a ${straightSpot.run} m clear straight)`
          : ' (no clear straight found nearby — used reset() position)'));

    /* ── O2: off-road must feel different ───────────────────────────────── */
    /* THE ON-ROAD LEG HAS TO STAY ON THE ROAD, and it used to be `hold(KeyW, 8000)` with
     * nobody steering. Roads turn up to 223 deg/km now, so a straight-line run-up leaves the
     * carriageway long before eight seconds are up and the "on-road" baseline was measured in
     * a field. Both legs then read the same number — `offCap` in car/vehicle.js is
     * lerp(12.2, 200, clamp01(onRoad*1.4)) = 12.2 m/s = 43.9 km/h at onRoad 0 — so O2 was
     * comparing an off-road run-up against an off-road run-up and reporting a ratio of 1.00.
     * So the baseline leg now STEERS — pure pursuit on the road's own centreline, dispatching
     * the same KeyA/KeyD a player would, no analogue input and no cheat. Aiming at the point
     * on the centreline nearest a spot a second ahead of the car puts the bend into the target
     * for free; a law built on "how far off the line am I HERE" corrects a corner one segment
     * late, which is how the car ended up in the field to begin with.
     *
     * MEASURED, over 20 independent points on the road network that the game's own autopilot
     * drove to, with `node tools/diag-o2.mjs --sites 20`. That harness does not reimplement
     * the steering: it pulls the `roadRunUp` page source (defined above, by C2, which now
     * shares it) out of this file and runs it against the real Vehicle and the real Terrain,
     * so what is graded below is the code that ships.
     *
     *              on-road leg ends on the road    O2's assertion    mean on-road top
     *   straight             5/20                      4/20             49.2 km/h
     *   steered             19/20                     16/20             99.7 km/h
     *
     * NOTHING IS WEAKENED. Both original conditions are unchanged, including the 0.55 ratio,
     * and a THIRD is added: the baseline must itself have ended on the road. If it did not,
     * O2 fails rather than quietly comparing a field against a field.
     *
     * Falsifiability was measured, not assumed. `node tools/diag-o2.mjs --nocap --sites 12`
     * reruns the same sweep against a scratch copy of vehicle.js with the off-road ceiling
     * line deleted — the exact defect a7b645a fixed — and the repaired check passes only 2/12
     * there, with mean off-road top rising from 45.5 to 72.0 km/h. It still has teeth.
     *
     * WHAT IS STILL NOT FIXED, on purpose: the OFF-ROAD leg drives straight, so on a road that
     * turns 223 deg/km it can curve back onto tarmac inside its 8 s, gain speed there and leave
     * again (a clean field run only 11/20 of the time). That is a separate pre-existing
     * weakness, it is not the reported failure — the failing runs all report onRoad 0.00 — and
     * retrying it was tried and rejected: it moved the assertion 16/20 to 17/20 with the
     * ceiling in, and made it WORSE under --nocap. Fixing it means deciding what an off-road
     * top speed on a descent ought to be, which is a change to what O2 measures, not a repair. */
    await reset();
    /* Retrying with a plain reset() was not enough on its own, and measurement is why this
     * comment exists rather than a bigger number in the retry count: three straight retries
     * still capped at 68.8-76.8 km/h. reset() snaps to the NEAREST road from wherever the car
     * currently is, and O2 runs after C5 has already relocated the car to whatever distant spot
     * its own straight-finder landed on — so every retry kept re-sampling the same neighbourhood
     * C5 left it in, which the junction work has apparently made locally tighter than it used to
     * be. Same fix C5 itself already uses: search for a genuinely clear stretch rather than
     * trust reset(). Unlike C5 this does not need dead-straight — the run-up steers — just long
     * enough that an 8 s window isn't dominated by a single corrected junction bend. */
    await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      const T = c.terrain.constructor;
      const big = new T(c.terrain.seed, c.x - 3200, c.z - 3200, c.x + 3200, c.z + 3200);
      const tmp = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0, land: NaN };
      let best = null;
      for (const e of big.roads.edges) {
        const n = e.pts.length / 2;
        for (let k0 = 0; k0 < n - 1; k0++) {
          const dx0 = e.pts[k0*2+2] - e.pts[k0*2], dz0 = e.pts[k0*2+3] - e.pts[k0*2+1];
          /* A ZERO-LENGTH SEGMENT HAS NO DIRECTION, and \`|| 1\` handed this one (0, 0) — which
           * is not a direction, it is a full stop. The walk below then sampled the SAME POINT
           * 63 times, every sample was of course still on the carriageway, and the segment
           * reported the maximum possible 496 m of "clear straight". The search takes the
           * first candidate over 280 m, so one duplicated vertex anywhere in the 6.4 km box
           * beat every real straight in it. Measured on the shipped seed by
           * \`node tools/diag-o2-live.mjs --audit\`, which lifts THIS block out of this file and
           * runs it against the real Terrain: 3 zero-length segments in 5376, and the finder
           * picked one in two of the three boxes audited — in the third, which has none, the
           * guarded and unguarded searches return the identical stretch, so this costs nothing
           * where the defect is absent. The car was then teleported onto it facing
           * atan2(0, 0) = 0 — due +Z whichever way the road actually ran — onto a stretch where
           * the steered run-up spent 51% of its eight seconds AIRBORNE and topped out at
           * 76 km/h. That is the depressed baseline O2's ratio was failing against: the same
           * car, the same run-up code, does 103 km/h once the placement lands on a real
           * straight. NOTHING about the assertion below changes — only that the "straight" it
           * is measured on is a straight rather than a single point.
           */
          const l0 = Math.hypot(dx0, dz0);
          if (l0 < 1e-3) continue;
          const ux = dx0 / l0, uz = dz0 / l0;
          const sx0 = e.pts[k0*2], sz0 = e.pts[k0*2+1];
          let clear = 0;
          for (let run = 0; run <= 500; run += 8) {
            const cv = big.roads.carve(sx0 + ux*run, sz0 + uz*run, tmp);
            if (cv.edge < 0.9) break;
            clear = run;
          }
          if (clear >= 150 && (!best || clear > best.run)) {
            best = { x: sx0, z: sz0, heading: Math.atan2(ux, uz), run: clear };
            if (clear >= 280) break;
          }
        }
        if (best && best.run >= 280) break;
      }
      if (best) { c.terrain = big; c.placeAt(best.x, best.z, best.heading);
        c.vx = c.vy = c.vz = 0; c.yawRate = 0; c.gear = 1; }
    })()`);
    let onRoadTop = await roadRunUp(8000);
    // Belt and braces: if it still came off, or is still slow, one more genuine try.
    for (let i = 0; i < 2 && !(onRoadTop && onRoadTop.onRoad > 0.5 && onRoadTop.kph > 85); i++) {
      await reset();
      onRoadTop = await roadRunUp(8000);
    }
    /* Getting genuinely off-road, and PROVING the leg stayed off-road.
     *
     * The old version walked 20 m at a time along the car's heading until the road query said
     * "more than 60 m away", placed the car there and drove for eight seconds — then sampled
     * onRoad ONCE, at the end. Two ways that lies, and both were observed: the walk aims along
     * the car's own heading, which after a road run-up points down the road, so it can step
     * along a curve and land near the next road over; and eight seconds of full throttle from
     * a point 60 m out can drive straight back onto tarmac. Both end with the "off-road"
     * sample reporting onRoad 1, i.e. an on-road speed compared against an on-road baseline.
     *
     * So: pick the heading that maximises distance from any road rather than reusing the car's,
     * and sample the WHOLE leg, taking the fastest moment at which the car was actually off the
     * carriageway. If no such moment exists the check fails on its own precondition, loudly,
     * instead of quietly measuring the wrong thing. This is how tools/diag-o2.mjs already does
     * it — that harness reports "peak onRoad DURING the leg" for exactly this reason. */
    await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      const t = c.terrain;
      let best = null;
      for (let a = 0; a < 16; a++) {
        const yaw = (a / 16) * Math.PI * 2;
        let x = c.x, z = c.z, d = 0;
        for (let i = 0; i < 60; i++) {
          x += Math.cos(yaw)*20; z -= Math.sin(yaw)*20;
          const q = t.roads.query(x, z);
          d = isFinite(q.d) ? q.d : 1e6;
          if (d > 90) break;
        }
        if (!best || d > best.d) best = { x, z, yaw, d };
      }
      c.placeAt(best.x, best.z, best.yaw);
      c.vx = c.vy = c.vz = 0; c.yawRate = 0; c.gear = 1; })()`);
    await sleep(600);
    await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      W.__o2 = { best: 0, samples: 0, off: 0 };
      W.__o2.timer = setInterval(() => {
        const s = c.terrain.surface(c.x, c.z);
        W.__o2.samples++;
        if (s.onRoad < 0.5) { W.__o2.off++; if (c.kph > W.__o2.best) W.__o2.best = c.kph; }
      }, 100); })()`);
    await hold(evalJs, 'KeyW', 8000);
    const offRoadTop = await evalJs(`(() => { const W = window.WANDEROAD; const c = W.car;
      clearInterval(W.__o2.timer);
      const s = c.terrain.surface(c.x, c.z);
      return { kph: +W.__o2.best.toFixed(1), endKph: +c.kph.toFixed(1),
               onRoad: W.__o2.off > 0 ? 0 : +s.onRoad.toFixed(2),
               offSamples: W.__o2.off, samples: W.__o2.samples,
               rough: +(c.rough||0).toFixed(2) }; })()`);
    const baseline = onRoadTop && typeof onRoadTop.kph === 'number'
      ? `${onRoadTop.kph} km/h on road (onRoad ${onRoadTop.onRoad}, ${onRoadTop.d} m off the centreline)`
      : `the on-road run-up returned ${onRoadTop && onRoadTop.__error ? onRoadTop.__error : String(onRoadTop)}`;
    check('O2 off-road is meaningfully slower than tarmac',
      !!onRoadTop && onRoadTop.onRoad > 0.5 &&
        offRoadTop.offSamples > 10 && offRoadTop.kph < onRoadTop.kph * 0.55,
      `${baseline} vs ${offRoadTop.kph} off (fastest of ${offRoadTop.offSamples}/${offRoadTop.samples} genuinely off-road samples)`);

    /* ── O5: no phantom impacts off-road ────────────────────────────────── */
    const impacts = await evalJs(`(async () => { const W = window.WANDEROAD;
      let hits = 0; const s = W.solids; const orig = s.resolve.bind(s);
      s.resolve = (...a) => { const r = orig(...a); if (r) hits++; return r; };
      await new Promise(r => setTimeout(r, 200)); return { armed: true, hits }; })()`);
    await hold(evalJs, 'KeyW', 6000);
    const phantom = await evalJs(`(() => { const c = window.WANDEROAD.car;
      return { solids: window.WANDEROAD.solids.count, lastHit: window.WANDEROAD.solids.lastHit }; })()`);
    /* `solids.count` is every collider in the ~64 level-0 chunks around the car, and it is
     * reported here as CONTEXT, not as a threshold: it is a headcount of the wood the car
     * happens to be standing in, so it is 1400 in a forest and single figures on a plain and
     * neither number is a defect. The assertion is only that a reported impact had something
     * to hit. Whether the colliders are the RIGHT ones is checked by name further up. */
    check('O5 no impact is reported without something to hit',
      !phantom.lastHit || phantom.solids > 0,
      `${phantom.solids} solids loaded, lastHit ${phantom.lastHit ? phantom.lastHit.kind : 'none'}`);
    void impacts;

    /* ── T2: the car is actually painted ────────────────────────────────── */
    await reset();
    /* The C-key check further up left the rig in `hood`, and hood is not a chase camera at
     * all — CAMERA.hood.behind is -0.35, i.e. the lens sits in front of the car's origin and
     * the bodywork is behind it. Put the rig back on the chase camera with the real key, and
     * then do not take it on trust: the probe projects the car and says whether it is there. */
    let camMode = await evalJs(`(window.WANDEROAD.chase && window.WANDEROAD.chase.mode) || ''`);
    for (let i = 0; i < 4 && camMode && camMode !== 'sport'; i++) {
      await tap(evalJs, 'KeyC');
      await sleep(400);
      camMode = await evalJs(`(window.WANDEROAD.chase && window.WANDEROAD.chase.mode) || ''`);
    }
    await sleep(1400); // the boom springs back out over ~0.5 s; measure the settled frame

    const probeCar = async () => {
      const r = await evalJs(CAR_PAINT_PROBE);
      if (!r || typeof r !== 'object') return { error: `the probe returned ${String(r)}`, carPx: 0, mode: camMode };
      if (r.__error) return { error: r.__error, carPx: 0, mode: camMode };
      return { carPx: 0, ...r };
    };
    /* Fewer painted pixels than this is not a car in frame — it is a sliver of bonnet or a
     * stray difference, and measuring one is how you end up grading something that is not the
     * car. tools/diag-carshot.mjs projects all seven fleet cars on this rig: the smallest
     * bodywork any of them puts on screen is thousands of pixels. */
    const CAR_PX_FLOOR = 500;
    let paint = await probeCar();
    for (let i = 0; i < 3 && (paint.error || paint.carPx < CAR_PX_FLOOR); i++) {
      await tap(evalJs, 'KeyC');
      await sleep(1400);
      const next = await probeCar();
      if (!next.error && (paint.error || next.carPx > paint.carPx)) paint = next;
    }
    const foundCar = !paint.error && paint.carPx >= CAR_PX_FLOOR;
    check('T2 the car reads as painted, not washed out', foundCar && paint.saturation > 0.30,
      foundCar
        ? `peak saturation ${paint.saturation} at rgb(${paint.rgb.join(',')}) over ${paint.carPx}`
          + ` ${paint.masked} pixels (median ${paint.median}, p95 ${paint.p95}) against ${paint.behind}`
          + ` behind it; ${paint.source} in the ${paint.mode} camera,`
          + ` chip ${paint.vcol ? `(${paint.vcol.join(',')})` : 'unknown'},`
          + ` sampled ${paint.rect.w}x${paint.rect.h} at ${paint.rect.x},${paint.rect.y}`
        : `could not find the car's paint on screen — ${paint.error || `${paint.carPx} pixels`}`
          + ` (${paint.mode} camera${paint.rect ? `, rect ${paint.rect.w}x${paint.rect.h}` : ''})`);
    /* Outline the graded region in the screenshot. A number about pixels nobody can point at
     * is exactly what put 0.153 on the road. Only if the rig is still the one that was
     * measured in, though — an outline drawn from a camera the frame was not taken in would
     * be the same species of lie as the block it replaces. */
    const liveMode = await evalJs(`(window.WANDEROAD.chase && window.WANDEROAD.chase.mode) || ''`);
    if (paint.rect && paint.rect.onScreen && paint.mode === liveMode) await evalJs(MARK_REGION(paint.rect));
    await shot('06-car-paint');
    await evalJs(`(() => { const d = document.getElementById('t2-sample'); if (d) d.remove(); return true; })()`);

    const errs = logs.filter((l) => l.level === 'error' || l.level === 'exception');
    check('no console errors', errs.length === 0, errs.map((e) => e.text.slice(0, 110)).join(' | '));
  } catch (err) {
    check('the run completed', false, err.message);
  } finally {
    ws.close();
    chrome.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('-'.repeat(64));
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  } else {
    console.log('\nTHE GAME WORKS.');
  }
  console.log(`screenshots: ${SHOTS}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
