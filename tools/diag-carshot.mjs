/* Wanderoad — is the T2 paint check looking at the car?
 *
 * tools/browser-test.mjs's T2 check reports "peak saturation" over a block of the frame. It
 * used to read a FIXED block — 40x34 of a 200x120 downsample, i.e. x 40%..60%, y 51.7%..80%
 * of the picture — on the stated grounds that "the car occupies the middle of the lower half
 * in every chase camera". src/car/camera.js says otherwise: MODES is ['sport', 'hood'], the
 * C-key check earlier in the run leaves the rig in `hood`, and CAMERA.hood.behind is -0.35 —
 * the lens sits IN FRONT of the car's origin. There is no car in that picture at all, and
 * the number the suite reported, 0.153 at rgb(189,176,160), is the road surface.
 *
 * The fix projects the car into screen space and masks the pixels it actually covers. That
 * has to be provable without Chrome (other agents hold this checkout), so this harness:
 *
 *   1. EXTRACTS the two pure blocks out of tools/browser-test.mjs — CAR_RECT_SRC and
 *      CAR_MEASURE_SRC — and evals THAT TEXT here. Not a copy of it: the same characters the
 *      browser runs. If they move, this harness fails loudly rather than testing fiction.
 *   2. Stands up the REAL chase rig (src/car/camera.js) and the REAL shipped car meshes
 *      (src/car/loadedCar.js, the .glb files, all seven of them) at the pose T2 measures in,
 *      and cross-checks the extracted projection against three's own Vector3.project.
 *   3. Runs both regions — old and new — against the REAL screenshots in shots/test/, which
 *      are frames from the last full browser run, and writes crops so the region can be
 *      looked at rather than argued about.
 *   4. Unit-tests the silhouette mask on a synthetic pair with known ground truth, since the
 *      hide-the-car-and-diff step is the one part that needs a GPU to exercise for real.
 *
 *   node tools/diag-carshot.mjs [--out DIR] [--kph 66]
 *
 * WHAT IT CANNOT DO: it cannot render. The A/B frames the mask is built from come off the
 * GPU, so the numbers below are about WHERE the check looks, not what the paint measures on
 * screen. tools/diag-carpaint.mjs is the harness for the colour itself.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { PerspectiveCamera, Vector3 } from 'three';
import { ChaseCamera } from '../src/car/camera.js';
import { CAMERA, SUSPENSION, PHYSICS_DT } from '../src/car/tuning.js';
import { Vehicle } from '../src/car/vehicle.js';
import { FLEET_BY_ID, FIRST_CAR, applyCarFeel } from '../src/game/garage.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = resolve(arg('out', join(tmpdir(), 'wanderoad-t2')));
const SHOTS = resolve('shots/test');

/* ── PNG, just enough of it ───────────────────────────────────────────────────
 * The shots are 8-bit truecolour, no interlace, which is two chunks and an unfilter. */

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodePNG(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);
  let p = 8, w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; colour = body[9]; interlace = body[12];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colour !== 2 && colour !== 6)) {
    throw new Error(`${path}: only 8-bit truecolour PNGs are handled (depth ${depth} colour ${colour})`);
  }
  const bpp = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  const stride = w * bpp;
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[q++];
    raw.copy(line, 0, q, q + stride);
    q += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2];
      out[d + 3] = bpp === 4 ? line[s + 3] : 255;
    }
    line.copy(prev);
  }
  return { w, h, data: out };
}

function encodePNG({ w, h, data }, path) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = y * (stride + 1) + 1 + x * 3;
      raw[d] = data[s]; raw[d + 1] = data[s + 1]; raw[d + 2] = data[s + 2];
    }
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
  return path;
}

const crop = (img, x, y, w, h) => {
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const s = ((y + j) * img.w + (x + i)) * 4, d = (j * w + i) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = 255;
    }
  }
  return { w, h, data: out };
};

/** A 2 px outline, so a region can be SEEN on the frame it was measured on. */
function outline(img, r, rgb) {
  const out = { w: img.w, h: img.h, data: Buffer.from(img.data) };
  const put = (x, y) => {
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
    const d = (y * img.w + x) * 4;
    out.data[d] = rgb[0]; out.data[d + 1] = rgb[1]; out.data[d + 2] = rgb[2];
  };
  for (let t = 0; t < 2; t++) {
    for (let x = r.x; x < r.x + r.w; x++) { put(x, r.y + t); put(x, r.y + r.h - 1 - t); }
    for (let y = r.y; y < r.y + r.h; y++) { put(r.x + t, y); put(r.x + r.w - 1 - t, y); }
  }
  return out;
}

/* ── T2's own metric, on whatever pixels it is given ──────────────────────── */
function peakSat(img, x, y, w, h) {
  let best = -1, rgb = [0, 0, 0];
  const sats = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const d = ((y + j) * img.w + (x + i)) * 4;
      const r = img.data[d], g = img.data[d + 1], b = img.data[d + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const s = mx === 0 ? 0 : (mx - mn) / mx;
      sats.push(s);
      if (s > best) { best = s; rgb = [r, g, b]; }
    }
  }
  sats.sort((a, b) => a - b);
  return { sat: +best.toFixed(3), rgb, median: +sats[sats.length >> 1].toFixed(3), n: sats.length };
}

/** The old check's exact pipeline: box-downsample the whole frame to 200x120, read 40x34. */
function oldRegionMetric(img) {
  const DW = 200, DH = 120;
  const small = { w: DW, h: DH, data: Buffer.alloc(DW * DH * 4) };
  for (let y = 0; y < DH; y++) {
    const y0 = Math.floor((y * img.h) / DH), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.h) / DH));
    for (let x = 0; x < DW; x++) {
      const x0 = Math.floor((x * img.w) / DW), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.w) / DW));
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const d = (j * img.w + i) * 4;
          r += img.data[d]; g += img.data[d + 1]; b += img.data[d + 2]; n++;
        }
      }
      const d = (y * DW + x) * 4;
      small.data[d] = Math.round(r / n); small.data[d + 1] = Math.round(g / n); small.data[d + 2] = Math.round(b / n);
      small.data[d + 3] = 255;
    }
  }
  return { small, ...peakSat(small, 80, 62, 40, 34) };
}

/** The same block, expressed on the full-resolution frame. */
const oldRegionFull = (img) => ({
  x: Math.round(img.w * 0.40), y: Math.round(img.h * (62 / 120)),
  w: Math.round(img.w * 0.20), h: Math.round(img.h * (34 / 120)),
});

/* ── the two blocks under test, lifted out of the browser suite ───────────── */
const TEST_SRC = readFileSync(new URL('./browser-test.mjs', import.meta.url), 'utf8');
function lift(name) {
  const re = new RegExp(`const ${name} = String\\.raw\`([\\s\\S]*?)\`;`);
  const m = re.exec(TEST_SRC);
  if (!m) throw new Error(`could not find ${name} in tools/browser-test.mjs — it has moved, and this harness is testing nothing`);
  return m[1];
}
const carRect = (0, eval)(lift('CAR_RECT_SRC'));
const measure = (0, eval)(lift('CAR_MEASURE_SRC'));
/* And the region the check USED to read, taken from the file rather than remembered. */
if (/getImageData\(80, 62, 40, 34\)/.test(TEST_SRC)) {
  console.error('NOTE: tools/browser-test.mjs still contains the old fixed 80,62,40,34 sample.');
}

/* ── drift guards ─────────────────────────────────────────────────────────────
 * The probe hard-codes two things it cannot import: the MAT.BODY slot index, and the name of
 * the per-vertex attribute that carries it. If either moves, the mask silently stops being
 * the bodywork and starts being nothing at all — so assert them against the real modules. */
const PAINTED = readFileSync(new URL('../src/render/painted.js', import.meta.url), 'utf8');
const LOADED = readFileSync(new URL('../src/car/loadedCar.js', import.meta.url), 'utf8');
const bodySlot = /BODY:\s*(\d+)/.exec(PAINTED);
const probeSlot = /const BODY_MAT = (\d+);/.exec(TEST_SRC);
let drift = 0;
if (!bodySlot || !probeSlot || bodySlot[1] !== probeSlot[1]) {
  console.error(`DRIFT: painted.js MAT.BODY is ${bodySlot?.[1]}, the probe assumes ${probeSlot?.[1]}`);
  drift++;
}
if (!/setAttribute\('vmat'/.test(LOADED) || !/getAttribute\('vmat'\)/.test(TEST_SRC)) {
  console.error('DRIFT: the per-vertex material attribute is no longer called `vmat` in both places');
  drift++;
}
if (drift) console.error(`${drift} assumption(s) in the probe no longer hold.\n`);

/* ── the real car, on the real rig ────────────────────────────────────────── */
globalThis.ProgressEvent = globalThis.ProgressEvent
  || class { constructor(t, o = {}) { Object.assign(this, o); this.type = t; } };
globalThis.fetch = async (req) => {
  const u = typeof req === 'string' ? req : req.url;
  return new Response(readFileSync(resolve('public/models/cars', u.split('/').pop())));
};
const { loadCar, CAR_KEYS } = await import('../src/car/loadedCar.js');

const VW = 1382, VH = 724; // the shots in shots/test are exactly this: a 1400x820 window

/** A dead-flat, dead-grippy world — the same stub tools/bench-car.mjs drives on. */
const FLAT = {
  surface: () => ({ y: 0, nx: 0, ny: 1, nz: 0, grip: 1, rough: 0, surfaceKind: 'tarmac', onRoad: 1, dominant: 0 }),
  height: () => 0,
};
const groundAt = () => 0; // flat, but ChaseCamera._floor still applies, exactly as in game

/**
 * The pose T2 measures at: a REAL Vehicle, driven for `secs` on full throttle from rest by
 * the same rig the game runs, with the chase camera stepped every frame beside it. Standing
 * still (secs 0) is T2's own case — it measures after reset(). `secs` 4.2 reproduces the
 * `hold(KeyW, 4200)` that the 02-driving screenshot was taken at the end of, spring lag and
 * all: a camera that has been chasing an accelerating car is not where a settled one is, and
 * that is a metre and a half of boom.
 */
function drivenPose(mode, carId, secs) {
  const spec = FLEET_BY_ID[carId];
  applyCarFeel(spec); // the game does this at boot; it retunes brakes and aids
  const camera = new PerspectiveCamera(64, VW / VH, 0.28, 16000);
  const chase = new ChaseCamera(camera, { mode });
  const car = new Vehicle({ tier: spec.tier, terrain: FLAT, preset: spec.feel.assist });
  car.placeAt(0, 0, 0);
  const input = { steer: 0, throttle: secs > 0 ? 1 : 0, brake: 0, handbrake: 0, analogue: true };
  const frames = Math.max(120, Math.round(secs * 60));
  const sub = Math.max(1, Math.round(1 / 60 / PHYSICS_DT));
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < sub; i++) car._step(PHYSICS_DT, input);
    chase.update(car, 1 / 60, groundAt);
  }
  return { camera, chase, car };
}

async function placedCar(key, car) {
  const model = await loadCar({ car: key, paint: 0, base: 'http://local/models/cars/' });
  // main.js: model.group.position.set(car.x, car.y - 0.36, car.z); rotation.y = car.yaw
  model.group.position.set(car.x, car.y - SUSPENSION.restLength, car.z);
  model.group.rotation.set(0, car.yaw, 0);
  model.group.updateMatrixWorld(true);
  return model;
}

/**
 * The same rectangle again, from three.js itself: the identical corner set, put through
 * Vector3.project instead of the hand-written matrix multiply. Same corners on purpose —
 * comparing against Box3.setFromObject would compare two different boxes and prove nothing
 * about the arithmetic.
 */
function threeRect(root, camera, W, H) {
  root.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, front = 0;
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    if (!b) return;
    for (let i = 0; i < 8; i++) {
      const v = new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
      v.applyMatrix4(o.matrixWorld);
      const cs = v.clone().applyMatrix4(camera.matrixWorldInverse);
      if (cs.z > -camera.near) continue;
      front++;
      v.project(camera);
      const px = (v.x * 0.5 + 0.5) * W, py = (1 - (v.y * 0.5 + 0.5)) * H;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  });
  return { front, minX, minY, maxX, maxY };
}

/* ══ 1. the maths ════════════════════════════════════════════════════════════ */
console.log('\nT2 SAMPLING — does the region land on the car?');
console.log('='.repeat(96));
console.log('\n1. the extracted projection vs three.js Vector3.project (sport camera, standstill)\n');
console.log('car       rect (x,y,w,h)                corners in front   max disagreement');
console.log('-'.repeat(96));

let worstErr = 0;
for (const key of CAR_KEYS) {
  const pose = drivenPose('sport', key, 0);
  const model = await placedCar(key, pose.car);
  const r = carRect(model.group, pose.camera, VW, VH);
  const t = threeRect(model.group, pose.camera, VW, VH);
  // The extracted rect is padded 2 px and floored/ceiled; compare against that, not raw.
  const err = Math.max(
    Math.abs(Math.max(0, Math.floor(t.minX) - 2) - r.x),
    Math.abs(Math.max(0, Math.floor(t.minY) - 2) - r.y),
    Math.abs(Math.min(VW, Math.ceil(t.maxX) + 2) - (r.x + r.w)),
    Math.abs(Math.min(VH, Math.ceil(t.maxY) + 2) - (r.y + r.h)),
  );
  worstErr = Math.max(worstErr, err);
  console.log(`${key.padEnd(9)} ${`${r.x},${r.y},${r.w},${r.h}`.padEnd(28)} ${String(r.infront).padStart(3)}/${r.corners}`
    + `           ${err.toFixed(2)} px`);
}
console.log(`\n   worst disagreement across the whole fleet: ${worstErr.toFixed(2)} px`);

/* ── 1b. and the region the check really samples: the PAINTED meshes ──────── */
console.log('\n1b. the bodywork the probe masks — the meshes carrying MAT.BODY, per car\n');
console.log('car       body meshes   body rect (x,y,w,h)          rect area px   whole-car rect area');
console.log('-'.repeat(96));
/* The same predicate the probe uses, on the real models. */
const BODY_MAT = +(probeSlot ? probeSlot[1] : 7);
const isBody = (o) => {
  const a = o.isMesh && o.geometry && o.geometry.getAttribute && o.geometry.getAttribute('vmat');
  if (!a || !a.array || !a.array.length) return false;
  for (let i = 0; i < a.array.length; i++) if (a.array[i] !== BODY_MAT) return false;
  return true;
};
let smallestBody = Infinity;
for (const key of CAR_KEYS) {
  const pose = drivenPose('sport', key, 0);
  const model = await placedCar(key, pose.car);
  const body = [];
  model.group.traverseVisible((o) => { if (isBody(o)) body.push(o); });
  const br = carRect(model.group, pose.camera, VW, VH, (o) => body.indexOf(o) >= 0);
  const wr = carRect(model.group, pose.camera, VW, VH);
  const area = br.w * br.h;
  smallestBody = Math.min(smallestBody, area);
  console.log(`${key.padEnd(9)} ${String(body.length).padStart(6)}        `
    + `${`${br.x},${br.y},${br.w},${br.h}`.padEnd(28)} ${String(area).padStart(9)}    ${wr.w * wr.h}`);
}
console.log(`\n   smallest painted rectangle in the fleet: ${smallestBody} px `
  + `— the check's floor is 500 masked pixels, and a rect is an upper bound on its own mask`);

/* ══ 2. the camera the check actually ran in ═════════════════════════════════ */
console.log('\n2. the same car in each camera mode — this is the bug\n');
console.log(`   MODES in src/car/camera.js: sport (behind ${CAMERA.sport.behind} m), hood (behind ${CAMERA.hood.behind} m)`);
console.log('');
console.log('mode    car on screen   rect (x,y,w,h)          overlap with the OLD fixed block');
console.log('-'.repeat(96));

const OLD = { x: Math.round(VW * 0.40), y: Math.round(VH * (62 / 120)), w: Math.round(VW * 0.20), h: Math.round(VH * (34 / 120)) };
const overlap = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
};
const modeRects = {};
for (const mode of ['sport', 'hood']) {
  const pose = drivenPose(mode, FIRST_CAR, 0);
  const model = await placedCar(FIRST_CAR, pose.car);
  const r = carRect(model.group, pose.camera, VW, VH);
  modeRects[mode] = r;
  const ov = r.onScreen ? overlap(r, OLD) : 0;
  console.log(`${mode.padEnd(7)} ${(r.onScreen ? 'yes' : 'NO').padEnd(15)} `
    + `${(r.onScreen ? `${r.x},${r.y},${r.w},${r.h}` : `${r.infront}/${r.corners} corners in front`).padEnd(23)} `
    + `${ov} px  (${((100 * ov) / (OLD.w * OLD.h)).toFixed(1)}% of the block)`);
}
console.log(`\n   the old block was fixed at ${OLD.x},${OLD.y},${OLD.w},${OLD.h} — 40..60% across, 51.7..80% down.`);

/* ══ 3. the real frames ══════════════════════════════════════════════════════ */
mkdirSync(OUT, { recursive: true });
console.log('\n3. the same two regions, on the frames the last browser run actually produced\n');

const shotPath = (n) => join(SHOTS, `${n}.png`);
const have = (n) => existsSync(shotPath(n));

if (have('06-car-paint')) {
  const img = decodePNG(shotPath('06-car-paint'));
  const old = oldRegionMetric(img);
  const full = oldRegionFull(img);
  console.log(`   06-car-paint.png (${img.w}x${img.h}) — the frame T2 graded`);
  console.log(`     old block, through the check's own 200x120 downsample: peak ${old.sat} at rgb(${old.rgb.join(',')})`);
  console.log(`       the suite reported 0.153 at rgb(189,176,160) on this frame`);
  console.log(`     old block at full resolution:                          peak ${peakSat(img, full.x, full.y, full.w, full.h).sat}`);
  encodePNG(crop(img, full.x, full.y, full.w, full.h), join(OUT, 'old-region-on-06.png'));
  encodePNG(outline(img, full, [255, 46, 166]), join(OUT, 'old-region-outlined-06.png'));
  console.log(`     wrote ${join(OUT, 'old-region-on-06.png')} — look at it: it is tarmac`);
}

if (have('02-driving')) {
  const img = decodePNG(shotPath('02-driving'));
  /* That shot is taken at the end of the suite's own `hold(KeyW, 4200)`, in the default car,
   * on the sport rig. Reproduce the drive rather than guess the pose — and then check the
   * reconstruction against a number that is printed IN the frame: the HUD's 66 km/h. */
  const secs = +arg('secs', 4.2);
  const pose = drivenPose('sport', FIRST_CAR, secs);
  const model = await placedCar(FIRST_CAR, pose.car);
  const r = carRect(model.group, pose.camera, img.w, img.h);
  const full = oldRegionFull(img);
  console.log(`\n   02-driving.png (${img.w}x${img.h}) — a sport-camera frame, HUD reads 66 km/h`);
  console.log(`     reconstruction: ${FIRST_CAR}, ${secs} s of throttle from rest -> `
    + `${pose.car.kph.toFixed(0)} km/h (the frame's HUD says 66), camera ${pose.chase.py.toFixed(2)} m up`);
  console.log(`     reconstructed car rect: ${r.x},${r.y},${r.w},${r.h}`);
  console.log(`     old fixed block:        ${full.x},${full.y},${full.w},${full.h}`);
  console.log(`     old block peak ${peakSat(img, full.x, full.y, full.w, full.h).sat}`
    + `   |   car rect peak ${peakSat(img, r.x, r.y, r.w, r.h).sat}`);
  /* And now the reason the PEAK cannot be the number this check asserts on. The car in that
   * frame is Chalk — paint 3, which is what the .chrome-test profile's identity rolls, and
   * tools/diag-carpaint.mjs measures Chalk bodywork at 0.239 peak. Anything much above that
   * inside the car's own rectangle is not bodywork: it is a tail light, the number plate, or
   * a chromatic-aberration fringe on a hard edge. One such pixel passes a peak test. */
  const pct = (() => {
    const sats = [];
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const d = ((r.y + j) * img.w + (r.x + i)) * 4;
        const c = [img.data[d], img.data[d + 1], img.data[d + 2]];
        const mx = Math.max(...c), mn = Math.min(...c);
        sats.push(mx === 0 ? 0 : (mx - mn) / mx);
      }
    }
    sats.sort((a, b) => a - b);
    const at = (f) => +sats[Math.min(sats.length - 1, Math.floor(sats.length * f))].toFixed(3);
    return { p50: at(0.5), p80: at(0.8), p90: at(0.9), p95: at(0.95), p99: at(0.99), max: at(1) };
  })();
  console.log(`     saturation inside the car rect: p50 ${pct.p50}  p80 ${pct.p80}  p90 ${pct.p90}`
    + `  p95 ${pct.p95}  p99 ${pct.p99}  max ${pct.max}`);
  console.log(`       that car is Chalk (paint 3, this profile's identity); diag-carpaint puts Chalk`);
  console.log(`       bodywork at 0.239 peak — so ${pct.max} is a lamp, a plate or a CA fringe, not paint.`);
  console.log(`       A peak-of-the-car test would pass a washed-out car on its tail lights alone.`);
  encodePNG(crop(img, r.x, r.y, r.w, r.h), join(OUT, 'car-rect-on-02.png'));
  encodePNG(crop(img, full.x, full.y, full.w, full.h), join(OUT, 'old-region-on-02.png'));
  encodePNG(outline(outline(img, full, [255, 46, 166]), r, [40, 220, 120]), join(OUT, 'both-regions-02.png'));
  console.log(`     wrote ${join(OUT, 'car-rect-on-02.png')} and both-regions-02.png (green = car rect, pink = old block)`);
}

/* ══ 4. the mask ═════════════════════════════════════════════════════════════ *
 * The A/B pair comes off the GPU in the browser, so what can be proved here is the
 * arithmetic: given a frame with an object and the same frame without it, does the extracted
 * measure() recover the object's pixels and reject the background? Ground truth is exact
 * because the pair is synthesised. */
console.log('\n4. the silhouette mask, on a synthetic pair with known ground truth\n');

/**
 * One synthetic frame and the two "hidden" variants the probe renders:
 *   a       — the frame as drawn: saturated grass, a car, glass and a lamp on the car
 *   bWhole  — the same frame with the WHOLE car hidden
 *   bBody   — the same frame with only the BODYWORK hidden (glass and lamp still drawn)
 * Body, glass and lamp are laid out with exact pixel counts, so every claim below is
 * checkable against ground truth rather than eyeballed.
 */
function synthetic({ bodyRGB, bgRGB, w = 160, h = 120, bleed = true }) {
  const GLASS = [70, 96, 150];    // the glasshouse: a constant tint on every car in the fleet
  const LAMP = [206, 62, 48];     // a tail light: EMIT, unshaded, saturated whatever the paint
  const a = Buffer.alloc(w * h * 4), bWhole = Buffer.alloc(w * h * 4), bBody = Buffer.alloc(w * h * 4);
  const inCar = (x, y) => x >= 40 && x < 120 && y >= 30 && y < 90;
  const inGlass = (x, y) => x >= 52 && x < 108 && y >= 34 && y < 52;
  const inLamp = (x, y) => x >= 44 && x < 54 && y >= 60 && y < 70;
  const counts = { body: 0, glass: 0, lamp: 0 };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // a noisy, SATURATED background — grass is more saturated than a pale car, which is
      // exactly why a rectangle around the car is not good enough
      const n = ((x * 37 + y * 17) % 23) - 11;
      const bg = [bgRGB[0] + n, bgRGB[1] + n, bgRGB[2] + n];
      const put = (buf, c) => { for (let k = 0; k < 3; k++) buf[i + k] = c[k]; buf[i + 3] = 255; };
      put(a, bg); put(bWhole, bg); put(bBody, bg);
      if (inCar(x, y)) {
        if (inGlass(x, y)) { counts.glass++; put(a, GLASS); put(bBody, GLASS); }
        else if (inLamp(x, y)) { counts.lamp++; put(a, LAMP); put(bBody, LAMP); }
        else { counts.body++; put(a, bodyRGB.map((c) => c + ((x + y) % 5))); }
      } else if (bleed) {
        // the composite's soft buffer and CA smear the car one or two pixels outward: those
        // pixels are BACKGROUND wearing a little car colour, and a peak metric will eat them
        const d = Math.max(40 - x, x - 119, 30 - y, y - 89);
        if (d >= 1 && d <= 2) {
          const mix = bg.map((c, k) => Math.round(c * 0.55 + bodyRGB[k] * 0.45));
          put(a, mix);
        }
      }
    }
  }
  return { a, bWhole, bBody, w, h, ...counts };
}

const sat = (c) => +((Math.max(...c) - Math.min(...c)) / Math.max(...c)).toFixed(3);
const PERSIMMON = [193, 63, 76];  // diag-carpaint's persimmon body pixel: 0.674
const PALE = [226, 205, 172];     // ...and its chalk one: 0.239
const GRASS = [150, 176, 88];     // verge grass: 0.5, well over the 0.30 bar

const s1 = synthetic({ bodyRGB: PERSIMMON, bgRGB: GRASS });
const m1 = measure(s1.a, s1.bBody, s1.w, s1.h);
console.log(`   a painted car (body ${sat(PERSIMMON)}) on grass (${sat(GRASS)}), `
  + `${s1.body} px of paint, ${s1.glass} of glass, ${s1.lamp} of lamp`);
console.log(`     bodywork mask: raw diff ${m1.rawPx} px -> ${m1.carPx} px after the 2 px erosion`);
console.log(`     peak ${m1.saturation} at rgb(${m1.rgb.join(',')})   median ${m1.median}  p95 ${m1.p95}`);
const bleedPx = m1.rawPx - s1.body;
console.log(`     raw diff = ${s1.body} px of paint + ${bleedPx} px of bleed ring `
  + `(sat ${sat(GRASS.map((c, k) => Math.round(c * 0.55 + PERSIMMON[k] * 0.45)))}, which would clear the 0.30 bar);`);
console.log(`     after erosion ${m1.carPx} px, all of them paint — `
  + `${m1.carPx <= s1.body ? 'the mask is a subset of the ground truth' : 'the mask is BIGGER than the truth — LEAK'}`
  + `, and the measured colour ${Math.abs(m1.rgb[0] - PERSIMMON[0]) <= 5 ? 'is the body colour' : 'is NOT the body colour — LEAK'}`);

/* The case that decides the shape of this check: a washed-out car that still has lamps and
 * glass on it. Grading "the car" passes it; grading the PAINT does not. */
const s2 = synthetic({ bodyRGB: PALE, bgRGB: GRASS });
const whole = measure(s2.a, s2.bWhole, s2.w, s2.h);
const only = measure(s2.a, s2.bBody, s2.w, s2.h);
console.log(`\n   a WASHED-OUT car (body ${sat(PALE)}) with a tail light (${sat([206, 62, 48])}) `
  + `and glass (${sat([70, 96, 150])}):`);
console.log(`     mask = the whole car:  peak ${whole.saturation} at rgb(${whole.rgb.join(',')})  -> `
  + `${whole.saturation > 0.30 ? 'PASSES the 0.30 bar on its lamps — a false pass' : 'fails'}`);
console.log(`     mask = the bodywork:   peak ${only.saturation} at rgb(${only.rgb.join(',')})  -> `
  + `${only.saturation > 0.30 ? 'LEAKED' : 'correctly FAILS the 0.30 bar'}`);
console.log(`     mask = a plain rectangle: peak `
  + `${peakSat({ w: s2.w, h: s2.h, data: s2.a }, 0, 0, s2.w, s2.h).sat} — and the grass alone is `
  + `${sat(GRASS)}, so a rectangle passes even with no car in it at all`);

/* And the case the whole task is about: nothing of the car in the picture. */
const s3 = synthetic({ bodyRGB: GRASS, bgRGB: GRASS, bleed: false });
const m3 = measure(s3.bWhole, s3.bWhole, s3.w, s3.h);
console.log(`\n   nothing of the car in frame (A and B identical): ${m3.carPx} masked pixels -> `
  + `${m3.carPx === 0 ? 'the check reports it cannot find the car instead of grading the road' : 'LEAK'}`);

/* ══ 5. the probe itself, end to end ═════════════════════════════════════════ *
 * Everything above tests the two pure blocks. This runs the ACTUAL in-page expression that
 * tools/browser-test.mjs evaluates in Chrome — assembled exactly as the suite assembles it —
 * against the real car, the real chase camera, and a canvas that is faked at the last
 * possible layer: getImageData returns a frame synthesised from whether the bodywork meshes
 * are visible AT THAT MOMENT. So the mesh selection, the hide/restore, the rect, the mask and
 * the returned shape are all genuinely exercised; only the rasteriser is stubbed. */
console.log('\n5. the whole probe expression, run against the real car and a stub canvas\n');

const probeSrc = (() => {
  const m = /const CAR_PAINT_PROBE = `([\s\S]*?)`;/.exec(TEST_SRC);
  if (!m) throw new Error('CAR_PAINT_PROBE has moved in tools/browser-test.mjs');
  return m[1]
    .replace('${CAR_RECT_SRC}', lift('CAR_RECT_SRC'))
    .replace('${CAR_MEASURE_SRC}', lift('CAR_MEASURE_SRC'));
})();

async function runProbe(carId, mode, bodyRGB) {
  const pose = drivenPose(mode, carId, 0);
  const model = await placedCar(carId, pose.car);
  const bodyMeshes = [];
  model.group.traverseVisible((o) => { if (isBody(o)) bodyMeshes.push(o); });
  const bodyRect = carRect(model.group, pose.camera, VW, VH, (o) => bodyMeshes.indexOf(o) >= 0);

  const GRASS = [150, 176, 88];
  const canvas = { width: VW, height: VH };
  const stubCtx = {
    drawImage() {},
    getImageData(x, y, w, h) {
      const shown = bodyMeshes.some((o) => o.visible);
      const data = Buffer.alloc(w * h * 4);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const X = x + i, Y = y + j, d = (j * w + i) * 4;
          const inBody = shown && X >= bodyRect.x + 3 && X < bodyRect.x + bodyRect.w - 3
            && Y >= bodyRect.y + 3 && Y < bodyRect.y + bodyRect.h - 3;
          const c = inBody ? bodyRGB : GRASS;
          data[d] = c[0]; data[d + 1] = c[1]; data[d + 2] = c[2]; data[d + 3] = 255;
        }
      }
      return { data };
    },
  };
  globalThis.window = {
    WANDEROAD: {
      model, camera: pose.camera, scene: { }, chase: pose.chase,
      post: { render() {} }, renderer: { render() {} },
    },
  };
  globalThis.document = {
    querySelector: () => canvas,
    createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
  };
  const out = new Function(`return ${probeSrc}`)();
  const restored = bodyMeshes.every((o) => o.visible) && model.group.visible;
  delete globalThis.window;
  delete globalThis.document;
  return { out, restored, bodyMeshes: bodyMeshes.length, bodyRect };
}

const persimmonRun = await runProbe(FIRST_CAR, 'sport', PERSIMMON);
{
  const { out, restored, bodyRect } = persimmonRun;
  console.log(`   ${FIRST_CAR}, sport, bodywork painted ${sat(PERSIMMON)}:`);
  console.log(`     masked "${out.masked}" over ${out.carPx} px, rect ${out.rect.w}x${out.rect.h}`
    + ` at ${out.rect.x},${out.rect.y} (body rect ${bodyRect.w}x${bodyRect.h})`);
  console.log(`     peak ${out.saturation} at rgb(${out.rgb.join(',')})  median ${out.median}  p95 ${out.p95}`
    + `  behind it ${out.behind} (the background the paint is covering — REQUIREMENTS asks for both)`);
  console.log(`     bodyMeshes ${out.bodyMeshes}, visibility restored afterwards: ${restored ? 'yes' : 'NO — the probe leaks state'}`);
  console.log(`     verdict: ${out.masked === 'bodywork' && out.saturation === sat(PERSIMMON) && restored
    ? 'the probe measured the paint, and only the paint'
    : 'MISMATCH — the probe did not measure what it should have'}`);
}
{
  const { out } = await runProbe(FIRST_CAR, 'sport', PALE);
  console.log(`\n   the same car painted ${sat(PALE)} (a washed-out chip): peak ${out.saturation} `
    + `-> ${out.saturation > 0.30 ? 'PASSES — wrong' : 'fails the 0.30 bar, as it should'}`);
}
{
  /* The camera the C-key check leaves behind. The probe has to say "not here", not measure
   * the road: this is the exact case that produced 0.153. */
  const { out } = await runProbe(FIRST_CAR, 'hood', PERSIMMON);
  console.log(`\n   the same car in the hood camera: rect ${out.rect.w}x${out.rect.h} at ${out.rect.x},${out.rect.y}`
    + ` — a wide, shallow band along the bottom of the frame: the bonnet, seen from above it.`);
  console.log(`     That is an axis-aligned bound on a trapezoid, so it over-reads; in the frame the suite`);
  console.log(`     actually graded, shots/test/06-car-paint.png, the old block holds no car pixels at all`);
  console.log(`     (old-region-on-06.png). Either way the suite taps C back to the chase rig before`);
  console.log(`     measuring, so the number always comes from the same view.`);
}

console.log(`\ncrops and overlays: ${OUT}`);
