/* Wanderoad — does the grass match the ground it stands on?
 *
 * Operator: the grass colour does not match the ground underneath it, especially crossing from
 * one biome into another. That is a claim about PIXELS — a colour looking "wrong" next to
 * another colour is not something a shader constant or a tint-table entry can settle on its
 * own (see diag-biomes.mjs's own header: a tint multiplier is not a colour, a palette entry has
 * read "rose-and-ochre" for months while the ground rendered olive). So this measures the
 * actual rendered frame, the same way diag-biomes.mjs settled "three biomes not five" and
 * shot-stats.mjs settled "the ground is blue in highlands": decode the PNG, average a region,
 * report a number.
 *
 * THE MEASUREMENT. At a fixed camera pose (car parked, zero velocity, chase cam settled):
 *   A — a screenshot with the grass rendered, exactly as a player sees it.
 *   B — the SAME frame, ONLY the grass hidden (`scene.getObjectByName('grass').visible =
 *       false`), two-to-three real rendered frames later so the toggle has actually reached
 *       the screen, then restored to visible before moving on.
 * Nothing else changes between A and B — not the camera, not the sun, not the car — so every
 * pixel that differs is a pixel a blade was covering. For that pixel SET (not the whole frame:
 * most of a frame is sky, road and car, and folding those in dilutes a real mismatch into
 * noise):
 *   mean colour in A              = what the grass reads as
 *   mean colour in B, same pixels = what the ground underneath actually reads as
 * The gap between those two means is reported five ways: raw dR/dG/dB, the house dB-minus-dR
 * metric (see shot-stats.mjs — blue-minus-red is the number that has caught real bugs here
 * before), and a hue-angle + chroma difference computed the colour-managed way (see COLOUR
 * SPACE below). Coverage rides along on every row so a reader can tell a real measurement from
 * a box that barely had any grass in it.
 *
 * WHY TWO DEPTH BANDS. Near and far grass fail differently — a blade three metres from the lens
 * and a blade two hundred metres out are lit, mip-filtered and fogged nothing alike, so one
 * frame-wide average can hide a defect that only shows at range (or only up close) by blending
 * it with the band where the match is fine. NEAR and FAR below are fixed frame-fraction boxes,
 * not a computed horizon line — the same simplification shot-stats.mjs and diag-waterlive.mjs
 * already made successfully (a hand-picked BAND, not geometry), because the chase camera's
 * framing is fixed and known: it keeps the car centre-bottom and the horizon in the same rough
 * third of the screen on every shot. Both boxes sit on the LEFT of frame for the same reason
 * shot-stats.mjs picks the lower-left corner: the car sits centre-bottom and the HUD sits
 * centre-and-right, so the left strip is the one place reliably neither. NEAR is the bottom
 * third ("near half" in the brief, "bottom third" in the same breath — the concrete definition
 * is used verbatim). FAR is the middle third, the horizon-adjacent band above the ground line.
 *
 * COLOUR SPACE. dR/dG/dB and dB-minus-dR are plain means of the raw sRGB bytes — "linear-ish",
 * not radiometric — because that is what every other tool in this family already reports, and
 * a reader holding this table next to shot-stats.mjs output should not have to convert units in
 * their head. Hue and chroma are held to a higher bar on purpose, because "does this hue look
 * wrong" is exactly the question a raw RGB delta answers badly (a patch that is merely darker
 * has a big RGB delta and a near-zero perceptual one). So those two go through the real
 * pipeline: sRGB byte -> linear light (the standard piecewise sRGB EOTF) -> CIE XYZ (D65) ->
 * CIE L*a*b*. Lab over HSL on purpose: HSL's "hue" is a hexagonal projection of the RGB cube
 * that swings wildly near its own seams (grey has no stable hue in HSL — it is whatever the
 * last noise sample left it at), where Lab's hue angle (atan2(b*, a*)) comes from an opponent
 * space built so hue survives a lightness change — which is the normal case here, since grass
 * and the ground under it are rarely the same brightness. Hue difference is the circular
 * distance in [0,180] — LOWER IS A BETTER MATCH, and that number is what a before/after run is
 * judged on. Chroma difference is signed, grass minus ground, same convention as dR/dG/dB.
 *
 * WHY COVERAGE GATES A ROW. A per-pixel diff mask (Manhattan distance across R+G+B — see
 * CHANGE_THRESH) separates "this pixel is a blade" from "this pixel is dither / cloud-shadow
 * drift / sun glitter that happened to differ between two frames 50 ms apart". The screenshots
 * are lossless PNG, so a truly unchanged pixel is bit-identical, but the world is not perfectly
 * static even with the car parked (foliage sways elsewhere in frame, clouds drift). If that
 * mask covers under ~3% of a region, there was barely any grass in the box to begin with —
 * DUNES is the expected case here, not a bug: BIOME_SCATTER's dunes.grass multiplier is 0.0 by
 * design (biomes.js: "a sand sea has no lawn... green sticking through the bottom" was the
 * complaint that zeroed it) — and averaging a few dozen stray pixels into a "mean colour"
 * produces a number that looks precise and means nothing. Flagged rows are still PRINTED (a
 * tool that hides a measurement it dislikes is worse than one that never took it) but excluded
 * from the summary averages at the bottom.
 *
 * SAMPLE SITES. One per biome, found in NODE by importing src/world/biomes.js directly — a
 * read-only import, a different file from the one being worked on live in this worktree — and
 * scanning outward from the origin in expanding rings for the coordinate where each biome's own
 * weight is highest. Same underlying call diag-biomes.mjs already validated; that file's own
 * header records the real ceiling each biome reaches over a comparable scan (meadow 0.509,
 * steppe 0.448, highland 0.876, dunes 0.710, wetland 0.906), so do not expect these five sites
 * to be pure. Coordinates and the winning weight print before Chrome even exists, so the sample
 * is auditable independent of anything that happens in the browser afterward.
 *
 * HAZARDS ALREADY PAID FOR, reused rather than rediscovered (the full story, paid for the hard
 * way, is in tools/diag-watershot.mjs):
 *   - the CDP plumbing — headless Chrome, --remote-debugging-port, a raw WebSocket, no
 *     playwright in this repo — is the same shape as diag-watershot.mjs and diag-waterlive.mjs.
 *   - the title-card cinematic (src/game/cinematic.js) flies its own camera around the car
 *     until a REAL keydown at `window` ends it. Skip it before touching the car at all, or
 *     every shot is of the 180 m intro fly-around, not the driving camera.
 *   - `car.placeAt(x, z, yaw)` moves the CAR; the camera only follows once the cinematic above
 *     has actually handed off to the chase rig.
 *   - a teleport lands in unstreamed ground. Wait for the chunk count AND the frame rate to
 *     stop moving, then a few more seconds of wall clock on top — a shot taken mid-stream
 *     photographs holes, and these biome sites can be many kilometres from spawn, further than
 *     diag-watershot.mjs's shoreline search ever had to jump.
 *
 * PNGs are decoded with `decodePng`, IMPORTED from tools/shot-stats.mjs rather than
 * reimplemented — one PNG reader for the whole tool family, per that file's own header.
 *
 * This has to run UNCHANGED against the current live build and a later modified local one — it
 * is the before/after instrument for the fix, not a one-shot report — so nothing here assumes
 * which build it is pointed at; the URL is the only thing that changes between runs.
 *
 *   node tools/diag-grassmatch.mjs [url] [--out DIR] [--json FILE]
 *
 * Defaults: url https://cozydriver.com/beta/, out D:/OpenClaw/tmp/shots/grassmatch/, json
 * <out>/grassmatch.json. Writes an A/B PNG pair per biome plus the JSON. Prints a summary
 * table. Exits non-zero on anything that stopped the run from actually completing — a missing
 * 'grass' object, a missing placeAt, a boot that never finished, a screenshot that never landed
 * — this never exits 0 having silently measured nothing.
 */

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { decodePng } from './shot-stats.mjs';
import { biomeWeights, BIOME, BIOME_COUNT } from '../src/world/biomes.js';

/* ── configuration ────────────────────────────────────────────────────────── */

/* src/main.js: `export const SEED = (parseInt(params.get('seed') ?? '', 10) || 20260726) >>> 0;`
 * — READ, not imported (main.js pulls in the renderer and cannot run outside a browser). This
 * is the seed the live build actually boots with when no ?seed= is on the URL, so it is also
 * the seed the site-scan below has to use to land on real, driveable ground. */
const SEED = 20260726;

/* The five biomes, in the order biomeWeights indexes them, named the way the brief names them
 * ('highland' singular, not BIOME_SHORT's 'Highlands'). Checked against biomes.js's own enum
 * just below rather than trusted blind. */
const BIOMES = [
  { i: 0, name: 'meadow' },
  { i: 1, name: 'steppe' },
  { i: 2, name: 'highland' },
  { i: 3, name: 'dunes' },
  { i: 4, name: 'wetland' },
];
{
  const want = { meadow: BIOME.MEADOW, steppe: BIOME.STEPPE, highland: BIOME.HIGHLAND, dunes: BIOME.DUNES, wetland: BIOME.WETLAND };
  for (const b of BIOMES) {
    if (want[b.name] !== b.i) throw new Error(`biomes.js BIOME enum order changed — '${b.name}' is now index ${want[b.name]}, not ${b.i}. Fix the BIOMES table above.`);
  }
}

/* Manhattan distance across R+G+B (0-765) above which a pixel counts as "a blade was here", not
 * dither. The screenshots are lossless PNG, so a genuinely unchanged pixel is bit-identical;
 * this threshold exists only to absorb the world's own idle animation (distant sway, cloud
 * shadow, sun glitter) between the two shots. Kept small on purpose — grass removal is a large,
 * spatially coherent change (a whole blade's worth of colour), not a few-unit dither, so this
 * errs toward catching too much rather than too little. */
const CHANGE_THRESH = 24;

/* Below this fraction of a region's pixels having changed, there was not enough grass in the
 * box to say anything about it — see the header's COVERAGE note. */
const COVERAGE_MIN = 0.03;

/* Fixed frame-fraction sample boxes, left-of-frame to dodge both the car (centre-bottom) and
 * the HUD (centre-and-right) — shot-stats.mjs's own lower-left convention, split into the two
 * depth bands the brief asks for. Eyeball these against a real capture in shots/grassmatch/ and
 * adjust here if the chase camera's framing ever changes. */
const BANDS = {
  near: { x0: 0.04, y0: 0.667, x1: 0.42, y1: 0.95 }, // bottom third
  far: { x0: 0.04, y0: 0.40, x1: 0.42, y1: 0.62 }, // middle third, horizon-adjacent
};

const WIN = { w: 1400, h: 800 };
const CHROME = process.env.CHROME_PATH || String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
const PORT = 9500 + (process.pid % 300);

/* ── args: node tools/diag-grassmatch.mjs [url] [--out DIR] [--json FILE] ──── */
const argv = process.argv.slice(2);
let urlArg = null, outArg = null, jsonArg = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outArg = argv[++i];
  else if (argv[i] === '--json') jsonArg = argv[++i];
  else if (!argv[i].startsWith('--') && urlArg === null) urlArg = argv[i];
}
const URL = urlArg || 'https://cozydriver.com/beta/';
const OUT = resolve(outArg || 'D:/OpenClaw/tmp/shots/grassmatch/');
const JSON_FILE = resolve(jsonArg || join(OUT, 'grassmatch.json'));
mkdirSync(OUT, { recursive: true });

/* ── colour: sRGB byte -> linear -> CIE Lab, for hue + chroma ONLY ───────────
 * (dR/dG/dB stay plain sRGB-byte means — see the header's COLOUR SPACE note for why the two
 * paths are held to different standards on purpose.) */
function srgbToLinear(c8) {
  const v = c8 / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function labFromSrgb8(r, g, b) {
  const rl = srgbToLinear(r), gl = srgbToLinear(g), bl = srgbToLinear(b);
  // sRGB primaries -> CIE XYZ, D65 white.
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;
  const Xn = 0.95047, Yn = 1.0, Zn = 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const fx = f(x / Xn), fy = f(y / Yn), fz = f(z / Zn);
  const L = 116 * fy - 16;
  const A = 500 * (fx - fy);
  const B = 200 * (fy - fz);
  let hue = (Math.atan2(B, A) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { L, a: A, b: B, chroma: Math.hypot(A, B), hue };
}
/** Circular distance between two hue angles, in [0,180]. Lower = closer hues. */
function hueDiffDeg(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

/* ── 1. sample sites, in NODE, before Chrome exists ──────────────────────────
 * Scans OUTWARD FROM THE ORIGIN in expanding rings (not a raster) so the search really is what
 * the brief asks for, keeping a running per-biome best so the answer is the true maximum over
 * the scanned disc rather than just the first local one crossed. Same call diag-biomes.mjs
 * already validated at a comparable scale, just walked in rings instead of a square sweep. */
function findBiomeSites(seed) {
  const STEP = 200, MAX_R = 20000;
  const w = new Float32Array(BIOME_COUNT);
  const best = Array.from({ length: BIOME_COUNT }, () => ({ x: 0, z: 0, w: -1 }));
  const consider = (x, z) => {
    biomeWeights(x, z, seed, w);
    for (let i = 0; i < BIOME_COUNT; i++) {
      if (w[i] > best[i].w) best[i] = { x: Math.round(x), z: Math.round(z), w: w[i] };
    }
  };
  consider(0, 0);
  for (let r = STEP; r <= MAX_R; r += STEP) {
    const steps = Math.max(8, Math.round((2 * Math.PI * r) / STEP));
    for (let a = 0; a < steps; a++) {
      const th = (a / steps) * Math.PI * 2;
      consider(Math.cos(th) * r, Math.sin(th) * r);
    }
  }
  return best;
}

/* FIXED SITES, when a before/after is being run — and this is not a nicety, it is what makes the
 * two runs comparable at all. The scan below picks the strongest weight it can find and the car
 * then drives for a few seconds before the shot, so two runs of this tool photograph two different
 * places: the first before/after pair measured here had 89% grass coverage in one run's far band
 * and 1.7% in the other's, which makes the two tables unrelatable no matter how careful the
 * arithmetic afterwards is. `--spots file.json` pins the coordinates so only the CODE differs
 * between runs. Format: [{"name":"steppe","x":2700,"z":-4677}]. */
const spotsArg = (() => {
  const i = argv.indexOf('--spots');
  return i >= 0 ? argv[i + 1] : null;
})();
const sites = spotsArg
  ? (() => {
      const rows = JSON.parse(readFileSync(spotsArg, 'utf8'));
      const out = {};
      for (const b of BIOMES) {
        const r = rows.find((x) => x.name === b.name);
        if (!r) throw new Error(`--spots file has no entry for ${b.name}`);
        out[b.i] = { x: r.x, z: r.z, w: biomeWeights(r.x, r.z, SEED).w[b.i] };
      }
      return out;
    })()
  : findBiomeSites(SEED);
console.log(`\n── grass/ground colour match — seed ${SEED} — ${URL} ──\n`);
console.log('sample sites (scanned outward from the origin, src/world/biomes.js biomeWeights):');
for (const b of BIOMES) {
  const s = sites[b.i];
  console.log(`  ${b.name.padEnd(9)} x=${String(s.x).padStart(7)}  z=${String(s.z).padStart(7)}   weight=${s.w.toFixed(3)}`);
}
console.log('');

/* ── 2. CDP plumbing — same shape as diag-watershot.mjs / diag-waterlive.mjs ── */
async function connect() {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--window-size=${WIN.w},${WIN.h}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--mute-audio',
      '--use-angle=default',
      '--enable-unsafe-swiftshader',
      '--user-data-dir=' + (process.env.TEMP || '/tmp') + '/wr-grassmatch-' + process.pid,
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
    } catch { /* not up yet */ }
  }
  if (!target) { chrome.kill(); throw new Error(`headless chrome did not start (CHROME_PATH=${CHROME})`); }
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
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') {
      logs.push({ level: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      logs.push({ level: 'exception', text: `${d.text} ${d.exception?.description || ''}`.slice(0, 300) });
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  /* Throws on a page-side exception rather than swallowing it into `undefined` — this whole
   * tool's mandate is to fail loudly, not hand back a value indistinguishable from "zero". */
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      const d = r.result.exceptionDetails;
      throw new Error(`page eval threw: ${d.text} ${d.exception?.description || ''}`.trim());
    }
    return r.result?.result?.value;
  };
  const shotPng = async () => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (!s.result?.data) throw new Error('Page.captureScreenshot returned no data');
    return Buffer.from(s.result.data, 'base64');
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { chrome, ws, send, evalJs, shotPng, logs };
}

/** Wait for N requestAnimationFrame callbacks to have actually run in the page. */
function rafExpr(n) {
  return `new Promise(res => { let i = 0; const step = () => { if (++i >= ${n}) res(true); else requestAnimationFrame(step); }; requestAnimationFrame(step); })`;
}

/** Chunk count AND frame rate both stop moving, then a few more seconds of wall clock on top —
 *  see the header's HAZARDS note. Capped so one stubborn teleport cannot hang the whole run. */
async function waitSettle(evalJs) {
  let lastLive = -1, lastFps = -1, stable = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    await sleep(500);
    const live = await evalJs('window.WANDEROAD.stats().live');
    const fps = await evalJs('window.WANDEROAD.fps()');
    if (typeof live === 'number' && typeof fps === 'number' && live === lastLive && Math.abs(fps - lastFps) < 4) {
      if (++stable >= 3) break;
    } else stable = 0;
    lastLive = live; lastFps = fps;
  }
  await sleep(3000); // "a couple of seconds of wall clock" on top of the polled settle, per the brief
  return { live: lastLive, fps: lastFps };
}

/* ── 3. region stats between two decoded PNGs ────────────────────────────────
 * A over B, both already decoded. Returns coverage plus the two masked means, or null means if
 * literally nothing in the box changed. */
function regionStats(A, B, box) {
  const { w, h, ch } = A;
  const x0 = Math.floor(box.x0 * w), x1 = Math.floor(box.x1 * w);
  const y0 = Math.floor(box.y0 * h), y1 = Math.floor(box.y1 * h);
  let total = 0, changed = 0;
  let arA = 0, agA = 0, abA = 0, arB = 0, agB = 0, abB = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * ch;
      const rA = A.px[i], gA = A.px[i + 1], bA = A.px[i + 2];
      const rB = B.px[i], gB = B.px[i + 1], bB = B.px[i + 2];
      total++;
      if (Math.abs(rA - rB) + Math.abs(gA - gB) + Math.abs(bA - bB) > CHANGE_THRESH) {
        changed++;
        arA += rA; agA += gA; abA += bA;
        arB += rB; agB += gB; abB += bB;
      }
    }
  }
  if (!changed) return { total, changed, coverage: 0, meanA: null, meanB: null };
  return {
    total, changed, coverage: changed / total,
    meanA: { r: arA / changed, g: agA / changed, b: abA / changed },
    meanB: { r: arB / changed, g: agB / changed, b: abB / changed },
  };
}

function buildRow(biome, band, A, B, box) {
  const s = regionStats(A, B, box);
  const row = { biome, band, pixelsTotal: s.total, pixelsChanged: s.changed, coverage: +s.coverage.toFixed(4) };
  if (!s.meanA) {
    row.flagged = true;
    row.note = 'zero pixels changed in this region — the grass toggle had no visible effect here';
    return row;
  }
  row.flagged = s.coverage < COVERAGE_MIN;
  if (row.flagged) row.note = `coverage ${(s.coverage * 100).toFixed(1)}% < ${(COVERAGE_MIN * 100).toFixed(0)}% — not enough grass in this box to mean anything`;
  const round1 = (o) => ({ r: +o.r.toFixed(1), g: +o.g.toFixed(1), b: +o.b.toFixed(1) });
  const grassLab = labFromSrgb8(s.meanA.r, s.meanA.g, s.meanA.b);
  const groundLab = labFromSrgb8(s.meanB.r, s.meanB.g, s.meanB.b);
  Object.assign(row, {
    grass: { ...round1(s.meanA), hue: +grassLab.hue.toFixed(1), chroma: +grassLab.chroma.toFixed(2) },
    ground: { ...round1(s.meanB), hue: +groundLab.hue.toFixed(1), chroma: +groundLab.chroma.toFixed(2) },
    dR: +(s.meanA.r - s.meanB.r).toFixed(1),
    dG: +(s.meanA.g - s.meanB.g).toFixed(1),
    dB: +(s.meanA.b - s.meanB.b).toFixed(1),
    dBminusR: +((s.meanA.b - s.meanA.r) - (s.meanB.b - s.meanB.r)).toFixed(1),
    hueDiffDeg: +hueDiffDeg(grassLab.hue, groundLab.hue).toFixed(1),
    chromaDiff: +(grassLab.chroma - groundLab.chroma).toFixed(2),
  });
  return row;
}

/* ── 4. run it live ───────────────────────────────────────────────────────── */
let chrome = null, ws = null;
let hardFail = false;
const perBiomeFailures = [];
const rows = [];
const runtimeApi = {};

try {
  const conn = await connect();
  chrome = conn.chrome; ws = conn.ws;
  const { send, evalJs, shotPng, logs } = conn;

  await send('Page.navigate', { url: URL });
  let haveCar = false;
  for (let i = 0; i < 120 && !haveCar; i++) {
    await sleep(500);
    haveCar = !!(await evalJs('!!(window.WANDEROAD && window.WANDEROAD.car)'));
  }
  if (!haveCar) throw new Error(`window.WANDEROAD.car never appeared at ${URL} — page did not boot`);
  console.log(`booted: ${URL}`);

  /* Skip the title-card cinematic. Dispatched repeatedly rather than once after a single check,
   * because the listener that catches it attaches asynchronously once the car model finishes
   * loading (diag-watershot.mjs's B9 note) — firing on a timer until `cine.active` actually
   * goes false is self-healing against that race rather than trying to catch the exact instant
   * the listener attaches. Backquote: bound to nothing in src/car/input.js's KEYMAP, so it
   * cannot also trigger some unrelated action (M opens the Garage, Z gets the driver out, etc). */
  let cineOver = false;
  for (let i = 0; i < 50 && !cineOver; i++) {
    await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', bubbles: true }))`);
    await sleep(400);
    cineOver = !!(await evalJs('!(window.WANDEROAD.cine && window.WANDEROAD.cine.active)'));
  }
  console.log(`intro cinematic skipped: ${cineOver ? 'yes' : 'NO — still active, shots may be the fly-around'}`);

  const boot = await waitSettle(evalJs);
  console.log(`initial stream settle: live=${boot.live} fps=${typeof boot.fps === 'number' ? boot.fps.toFixed(1) : boot.fps}`);

  /* FAIL LOUDLY if the thing this whole tool measures does not exist, rather than quietly
   * reporting five rows of "0% coverage" that read like a finding instead of a broken probe. */
  const grassInfo = await evalJs(`(() => {
    const W = window.WANDEROAD;
    if (!W || !W.scene) return { error: 'window.WANDEROAD.scene missing' };
    const g = W.scene.getObjectByName('grass');
    if (!g) return { error: "no object named 'grass' in the scene", topLevel: W.scene.children.map(c => c.name || c.type) };
    return { found: true, name: g.name, type: g.type, visible: g.visible };
  })()`);
  if (!grassInfo || grassInfo.error) {
    throw new Error(`grass object not found: ${grassInfo?.error || 'evaluate failed'}${grassInfo?.topLevel ? ' — scene top level has: ' + grassInfo.topLevel.join(', ') : ''}`);
  }
  runtimeApi.grass = grassInfo;
  console.log(`runtime check: scene.getObjectByName('grass') -> found, type=${grassInfo.type}, visible=${grassInfo.visible}`);

  const placeAtInfo = await evalJs(`(() => {
    const c = window.WANDEROAD.car;
    return { hasCar: !!c, kind: c ? typeof c.placeAt : 'no car', params: c && c.placeAt ? c.placeAt.length : null };
  })()`);
  if (!placeAtInfo || placeAtInfo.kind !== 'function') {
    throw new Error(`window.WANDEROAD.car.placeAt is not a function: ${JSON.stringify(placeAtInfo)}`);
  }
  runtimeApi.placeAt = placeAtInfo;
  console.log(`runtime check: window.WANDEROAD.car.placeAt is a function (${placeAtInfo.params} declared params) — calling as placeAt(x, z, yaw)\n`);

  for (const biome of BIOMES) {
    const site = sites[biome.i];
    console.log(`── ${biome.name} (${site.x}, ${site.z}) weight ${site.w.toFixed(3)} ──`);
    try {
      await evalJs(`(() => {
        const c = window.WANDEROAD.car;
        c.placeAt(${site.x}, ${site.z}, 0);
        c.vx = 0; c.vy = 0; c.vz = 0; c.speed = 0; c.yawRate = 0;
      })()`);
      const settle = await waitSettle(evalJs);
      console.log(`   settled: live=${settle.live} fps=${typeof settle.fps === 'number' ? settle.fps.toFixed(1) : settle.fps}`);

      // A: grass visible — asserted, not assumed, in case a previous biome's restore failed.
      await evalJs(`window.WANDEROAD.scene.getObjectByName('grass').visible = true`);
      await evalJs(rafExpr(3));
      await sleep(50); // small compositor-flush margin on top of the rAF wait
      const bufA = await shotPng();
      writeFileSync(join(OUT, `${biome.name}-A.png`), bufA);
      const pngA = decodePng(bufA);

      let pngB;
      try {
        // B: same pose, grass hidden.
        await evalJs(`window.WANDEROAD.scene.getObjectByName('grass').visible = false`);
        await evalJs(rafExpr(3));
        await sleep(50);
        const bufB = await shotPng();
        writeFileSync(join(OUT, `${biome.name}-B.png`), bufB);
        pngB = decodePng(bufB);
      } finally {
        // Restore is guaranteed even if the B capture above threw, so the NEXT biome's "A" is
        // never silently shot with the grass still hidden from this one.
        await evalJs(`window.WANDEROAD.scene.getObjectByName('grass').visible = true`);
      }

      if (pngA.w !== pngB.w || pngA.h !== pngB.h) throw new Error(`screenshot size changed between A/B (${pngA.w}x${pngA.h} vs ${pngB.w}x${pngB.h})`);

      for (const [bandName, box] of Object.entries(BANDS)) {
        const row = buildRow(biome.name, bandName, pngA, pngB, box);
        rows.push(row);
        const cov = (row.coverage * 100).toFixed(1).padStart(5);
        if (row.grass) {
          console.log(`   ${bandName.padEnd(4)} cov ${cov}%  dRGB ${String(row.dR).padStart(5)},${String(row.dG).padStart(5)},${String(row.dB).padStart(5)}  dB-dR ${String(row.dBminusR).padStart(5)}  hueDiff ${String(row.hueDiffDeg).padStart(5)}deg  chromaDiff ${row.chromaDiff}${row.flagged ? '  [FLAGGED: ' + row.note + ']' : ''}`);
        } else {
          console.log(`   ${bandName.padEnd(4)} cov ${cov}%  [FLAGGED: ${row.note}]`);
        }
      }
    } catch (e) {
      perBiomeFailures.push({ biome: biome.name, error: e.message });
      console.error(`   FAIL  ${biome.name}: ${e.message}`);
    }
  }

  const errs = logs.filter((l) => l.level === 'error' || l.level === 'exception');
  if (errs.length) console.log(`\n(${errs.length} console error/exception line(s) during the run — see JSON 'consoleErrors')`);
  runtimeApi.consoleErrors = errs.slice(0, 10);
} catch (e) {
  hardFail = true;
  console.error(`\nFAIL  ${e.message}`);
} finally {
  try { ws && ws.close(); } catch { /* already gone */ }
  try { chrome && chrome.kill(); } catch { /* already gone */ }
}

if (perBiomeFailures.length) hardFail = true;

/* ── 5. summary table + JSON ─────────────────────────────────────────────── */
console.log('\n── summary ──────────────────────────────────────────────────────────────');
console.log('biome      band   coverage   dR     dG     dB   dB-dR  hueDiff  chromaDiff');
for (const r of rows) {
  if (!r.grass) {
    console.log(`${r.biome.padEnd(10)} ${r.band.padEnd(5)} ${(r.coverage * 100).toFixed(1).padStart(6)}%   -- FLAGGED: ${r.note}`);
    continue;
  }
  console.log(
    `${r.biome.padEnd(10)} ${r.band.padEnd(5)} ${(r.coverage * 100).toFixed(1).padStart(6)}%  ` +
    `${String(r.dR).padStart(5)}  ${String(r.dG).padStart(5)}  ${String(r.dB).padStart(5)}  ` +
    `${String(r.dBminusR).padStart(5)}  ${String(r.hueDiffDeg).padStart(6)}   ${String(r.chromaDiff).padStart(6)}` +
    `${r.flagged ? '  [FLAGGED: low coverage]' : ''}`,
  );
}
const valid = rows.filter((r) => r.grass && !r.flagged);
if (!rows.length) {
  console.log('\nno samples collected at all — see the FAIL line above');
} else if (valid.length) {
  const meanHue = valid.reduce((a, r) => a + r.hueDiffDeg, 0) / valid.length;
  const best = valid.reduce((a, r) => (r.hueDiffDeg < a.hueDiffDeg ? r : a));
  const worst = valid.reduce((a, r) => (r.hueDiffDeg > a.hueDiffDeg ? r : a));
  console.log(`\nmean hue difference over ${valid.length} unflagged sample(s): ${meanHue.toFixed(1)} deg  (LOWER = better grass/ground match)`);
  console.log(`best match:  ${best.biome}/${best.band}  ${best.hueDiffDeg} deg`);
  console.log(`worst match: ${worst.biome}/${worst.band}  ${worst.hueDiffDeg} deg`);
} else {
  console.log('\nno unflagged samples — every region was below the coverage floor');
}
console.log(`\nfailures: ${perBiomeFailures.length ? perBiomeFailures.map((f) => f.biome).join(', ') : 'none'}`);
console.log(`shots + JSON: ${OUT}\n`);

const report = {
  tool: 'diag-grassmatch', ok: !hardFail, ranAt: new Date().toISOString(), url: URL, seed: SEED,
  windowSize: WIN, changeThresh: CHANGE_THRESH, coverageMin: COVERAGE_MIN, bands: BANDS,
  runtimeApi, sites: BIOMES.map((b) => ({ biome: b.name, ...sites[b.i] })),
  rows, failures: perBiomeFailures,
};
writeFileSync(JSON_FILE, JSON.stringify(report, null, 2));

process.exit(hardFail ? 1 : 0);
