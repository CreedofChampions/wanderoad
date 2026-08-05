// created by AI
/* Cozy Driver — DOES THE GRASS ACTUALLY WEAR THE COLOUR OF THE GROUND IT STANDS ON?
 *
 * Operator: "Grass color should almost match the color of the ground it's around, even when
 * transitioning from one biome to another, one series of colors to another, as far as the base
 * colour is concerned."
 *
 * render/grass.js now carries the blended ground colour per blade (`iGnd`) and GRASS_FS blends the
 * blade's chromaticity toward it. Three separate things can be wrong with that and only one of them
 * is visible in a screenshot, so all three are measured here, in node, against the REAL Grass and
 * the REAL Terrain:
 *
 *   1. THE BLEND. Every lattice node's stored colour must equal, exactly, what
 *      render/terrainMaterial.js paints at that spot — the same five ramps, the same
 *      GROUND_SHARPEN, the same mean-blot mid plate. If these two ever drift apart the grass
 *      matches a ground that no longer exists.
 *   2. THE ENCODE. `iGnd` is a sqrt-encoded byte per channel, so what the shader decodes must
 *      still be the colour the lattice held, within the quantisation that encoding actually costs.
 *      A silently wrong decode reads as "the fix does nothing", which is indistinguishable from
 *      not having shipped it.
 *   3. THE TRANSITION, which is half of what was asked for. Walking a line ACROSS a biome border,
 *      the stored colour has to move continuously — a step here is a visible seam in the field.
 *
 * And then the claim itself: the hue error between grass and ground, per biome, before and after,
 * computed through the exact formula the fragment shader runs. That table is the answer to the
 * request, so it is printed whether it passes or not.
 *
 *   node tools/diag-grasstint.mjs [--seed 20260726]
 */
import { Object3D } from 'three';
import { Grass } from '../src/render/grass.js';
import { biomeGroundArrays, GROUND_SHARPEN, BIOME_GROUND } from '../src/core/palette.js';
import { biomeWeights } from '../src/world/biomes.js';
import { Color } from 'three';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const SEED = (parseInt(arg('--seed', '20260726'), 10) || 20260726) >>> 0;

const RAMP = biomeGroundArrays();
const NB = RAMP.count;

/** The terrain shader's own mid plate at mean blot: mix(B_MID, B_SHADE, blot*0.40), blot mean 0.5. */
const MEAN_BLOT_MID = 0.2;

/** The independent oracle — written from terrainMaterial.js's GLSL, not from grass.js's copy.
 *
 * `weightsAt` is a parameter and not a hard-coded `T.weights` for a reason that cost this tool a
 * wrong reading: a `Terrain`'s climate lattice covers ONE region and `Climate.sample` CLAMPS
 * outside it, so asking a terrain built around the origin about a point 8 km away returns the
 * lattice edge — a flat answer that would make any continuity scan look perfect no matter what
 * the world does. The per-node check below wants the terrain the grass itself sampled; the
 * cross-country scan wants the region-free `biomeWeights`. */
function groundColourAt(weightsAt, x, z) {
  const w = weightsAt(x, z);
  const gw = new Float64Array(NB);
  let s = 0;
  for (let b = 0; b < NB; b++) {
    gw[b] = Math.pow(Math.max(w[b], 0), GROUND_SHARPEN);
    s += gw[b];
  }
  s = Math.max(s, 1e-6);
  const out = [0, 0, 0];
  for (let b = 0; b < NB; b++) {
    const f = gw[b] / s;
    for (let c = 0; c < 3; c++) {
      const mid = RAMP.mid[b * 3 + c];
      const shade = RAMP.shade[b * 3 + c];
      out[c] += (mid + (shade - mid) * MEAN_BLOT_MID) * f;
    }
  }
  return out;
}

const LUMA = [0.2126, 0.7152, 0.0722];
const lum = (c) => c[0] * LUMA[0] + c[1] * LUMA[1] + c[2] * LUMA[2];
const hue = (v) => {
  const m = Math.max(...v);
  const n = Math.min(...v);
  if (m - n < 1e-9) return 0;
  let h;
  if (m === v[0]) h = ((v[1] - v[2]) / (m - n)) % 6;
  else if (m === v[1]) h = (v[2] - v[0]) / (m - n) + 2;
  else h = (v[0] - v[1]) / (m - n) + 4;
  return ((h * 60) % 360 + 360) % 360;
};
const dHue = (a, b) => {
  const d = Math.abs(hue(a) - hue(b));
  return d > 180 ? 360 - d : d;
};
const satOf = (v) => {
  const m = Math.max(...v);
  return m < 1e-9 ? 0 : (m - Math.min(...v)) / m;
};

/* ── stand up the real thing ─────────────────────────────────────────────── */
const scene = new Object3D();
const grass = new Grass({ seed: SEED, scene });
grass.setAngular(1.012 / 1080);
// A few updates so the near rings are genuinely populated, exactly as main.js drives it.
for (let i = 0; i < 40; i++) grass.update(i * 3, i * 2, 0, 1 / 60);
const T = grass._terrain;
if (!T) {
  console.error('FAIL — the Grass never built a Terrain; nothing below would mean anything');
  process.exit(1);
}

/** The grass's own terrain, for points inside its region. */
const inRegion = (x, z) => T.weights(x, z).w;
/** The world itself, unbounded — what a scan across four biomes has to ask. */
const worldWide = (x, z) => biomeWeights(x, z, SEED).w;

/* ── 1. THE BLEND: every lattice node against the oracle ─────────────────── */
let nodeN = 0;
let nodeMax = 0;
let nodeSum = 0;
let bladeN = 0;
let bladeMax = 0;
let bladeSum = 0;

for (const ring of grass._rings) {
  if (!ring) continue;
  const cs = ring.R.cs;
  const L = ring.R.lat;
  const N = L + 1;
  const step = cs / L;
  for (const c of ring.slots) {
    if (!c || c.count <= 0) continue;
    const x0 = c.cx * cs;
    const z0 = c.cz * cs;
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const k = (j * N + i) * 10;
        const want = groundColourAt(inRegion, x0 + i * step, z0 + j * step);
        for (let ch = 0; ch < 3; ch++) {
          const e = Math.abs(c.lat[k + 7 + ch] - want[ch]);
          nodeMax = Math.max(nodeMax, e);
          nodeSum += e;
          nodeN++;
        }
      }
    }

    /* ── 2. THE ENCODE: decoded blades against the lattice they came from ── */
    for (let b = 0; b < c.count; b += Math.max(1, (c.count / 200) | 0)) {
      const fx = c.iPos[b * 2] / 65535;
      const fz = c.iPos[b * 2 + 1] / 65535;
      const gx = fx * L;
      const gz = fz * L;
      const ix = Math.min(L - 1, gx | 0);
      const iz = Math.min(L - 1, gz | 0);
      const tx = gx - ix;
      const tz = gz - iz;
      const k00 = (iz * N + ix) * 10;
      const k10 = k00 + 10;
      const k01 = k00 + N * 10;
      const k11 = k01 + 10;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;
      for (let ch = 0; ch < 3; ch++) {
        const want =
          c.lat[k00 + 7 + ch] * w00 + c.lat[k10 + 7 + ch] * w10 + c.lat[k01 + 7 + ch] * w01 + c.lat[k11 + 7 + ch] * w11;
        const dec = Math.pow(c.iGnd[b * 4 + ch] / 255, 2);
        const e = Math.abs(dec - want);
        bladeMax = Math.max(bladeMax, e);
        bladeSum += e;
        bladeN++;
      }
    }
  }
}

if (!nodeN || !bladeN) {
  console.error(`FAIL — nothing to measure (nodes ${nodeN}, blade channels ${bladeN})`);
  process.exit(1);
}
console.log(`1. blend vs terrainMaterial's own maths   nodes ${nodeN / 3 | 0}  max ${nodeMax.toExponential(2)}  mean ${(nodeSum / nodeN).toExponential(2)}`);
console.log(`2. sqrt encode round trip                 blades ${bladeN / 3 | 0}  max ${bladeMax.toFixed(5)}  mean ${(bladeSum / bladeN).toFixed(5)}`);

/* ── 3. THE TRANSITION: continuity across a real biome border ────────────── */
let worstStep = 0;
let worstAt = null;
let crossings = 0;
for (const [ax, az, bx, bz] of [
  [0, 6800, 2700, -4677],
  [2700, -4677, 1559, -900],
  [-8500, -2278, -6582, -3800],
  [-6582, -3800, 0, 0],
]) {
  const n = 1200;
  let prev = null;
  let prevDom = -1;
  for (let s = 0; s <= n; s++) {
    const x = ax + ((bx - ax) * s) / n;
    const z = az + ((bz - az) * s) / n;
    const c = groundColourAt(worldWide, x, z);
    const w = worldWide(x, z);
    let dom = 0;
    for (let b = 1; b < NB; b++) if (w[b] > w[dom]) dom = b;
    if (prevDom >= 0 && dom !== prevDom) crossings++;
    if (prev) {
      const dx = x - (ax + ((bx - ax) * (s - 1)) / n);
      const dz = z - (az + ((bz - az) * (s - 1)) / n);
      const metres = Math.max(Math.hypot(dx, dz), 1e-6);
      const d = Math.max(...c.map((v, i) => Math.abs(v - prev[i]))) / metres;
      if (d > worstStep) {
        worstStep = d;
        worstAt = [Math.round(x), Math.round(z)];
      }
    }
    prev = c;
    prevDom = dom;
  }
}
console.log(
  `3. continuity across ${crossings} biome changes    worst ${worstStep.toExponential(2)} linear/metre at ${worstAt ? worstAt.join(',') : '-'}`
);

/* ── the claim itself: hue error, before and after, per biome ────────────── */
const lin = (h) => {
  const c = new Color(h).convertSRGBToLinear();
  return [c.r, c.g, c.b];
};
const PLATES = { lit: lin('#93B84E'), mid: lin('#6C9A47'), shd: lin('#2C563E') };
/* The shipped strength, read out of the shader source itself rather than retyped — if the constant
 * moves and this table does not, the table is a lie. */
const src = (await import('node:fs')).readFileSync(new URL('../src/render/grass.js', import.meta.url), 'utf8');
const MATCH = Number(/const GROUND_MATCH = ([\d.]+)/.exec(src)?.[1]);
if (!(MATCH > 0)) {
  console.error('FAIL — could not read GROUND_MATCH out of src/render/grass.js');
  process.exit(1);
}

const NAMES = ['MEADOW', 'STEPPE', 'HIGHLAND', 'DUNES', 'WETLAND'];
console.log(`\n   the claim, at GROUND_MATCH ${MATCH} — grass-vs-ground hue error in degrees`);
console.log('   biome      groundHue  before   after (lit/mid/shade)   grass sat -> ground sat');
let worstHue = 0;
for (let b = 0; b < NB; b++) {
  const g = [0, 1, 2].map((c) => {
    const mid = RAMP.mid[b * 3 + c];
    const shade = RAMP.shade[b * 3 + c];
    return mid + (shade - mid) * MEAN_BLOT_MID;
  });
  const gch = g.map((v) => v / Math.max(lum(g), 1e-4));
  const after = [];
  const sats = [];
  for (const k of ['lit', 'mid', 'shd']) {
    const p = PLATES[k];
    const lp = lum(p);
    const out = p.map((v, i) => (v / lp + (gch[i] - v / lp) * MATCH) * lp);
    after.push(dHue(out, g));
    sats.push(satOf(out));
    worstHue = Math.max(worstHue, dHue(out, g));
  }
  const before = dHue(PLATES.mid, g);
  console.log(
    `   ${NAMES[b].padEnd(10)} ${String(Math.round(hue(g))).padEnd(10)} ${String(Math.round(before)).padEnd(8)} ` +
      `${after.map((v) => Math.round(v)).join(' / ').padEnd(23)} ${sats[1].toFixed(2)} -> ${satOf(g).toFixed(2)}`
  );
}

/* ── verdict ─────────────────────────────────────────────────────────────── */
let bad = 0;
if (nodeMax > 1e-5) {
  console.error(`FAIL — the grass and the terrain disagree about the ground colour (max ${nodeMax})`);
  bad++;
}
/* The encode's own floor: one byte in sqrt space is worth about 2*sqrt(v)/255 in linear, i.e. ~0.008
 * at the brightest stop here. 0.02 leaves room for that and nothing else. */
if (bladeMax > 0.02) {
  console.error(`FAIL — the sqrt encode is losing more than it should (max ${bladeMax})`);
  bad++;
}
/* A biome border is a smooth blend of weights, so the colour should never move faster than a few
 * thousandths of a linear unit per metre; a hard switch would be orders of magnitude above this. */
if (worstStep > 0.02) {
  console.error(`FAIL — the ground colour steps at a biome border (${worstStep}/m)`);
  bad++;
}
if (worstHue > 25) {
  console.error(`FAIL — grass still misses its ground by ${Math.round(worstHue)} degrees of hue`);
  bad++;
}
if (BIOME_GROUND.length !== NB) {
  console.error('FAIL — the ramp table changed shape under this test');
  bad++;
}
console.log(bad ? `\n${bad} check(s) failed` : '\nall checks passed');
process.exit(bad ? 1 : 0);
