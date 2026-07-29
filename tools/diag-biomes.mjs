/* Are the five biomes actually different?
 *
 * The operator's words: "u just renamed them but they are similar 3 biomes sand, snow, hills".
 * That is a claim about what reaches the SCREEN, so this tool measures the screen colour, not
 * the tint table — a tint table entry is a multiplier and a multiplier is not a colour (the
 * dunes entry claimed a "rose-and-ochre sand sea" for months while the ground rendered olive).
 *
 * How the colour is obtained, so nobody has to trust it:
 *   • `src/render/terrainMaterial.js`'s TERRAIN_FS ground-colour block is mirrored here line
 *     for line — the same GROUND_SHARPEN weight power, the same five-ramp blend, the same
 *     rock-on-slope and snow-above-the-line terms, in the same order.
 *   • The two noise fields it reads (`blot`, `grain`) are the GLSL ones, ported from
 *     core/glsl.js's GL_HASH/GL_NOISE (hash12 -> pn2 -> fbm2) rather than from core/noise.js,
 *     which is a DIFFERENT generator. Float32 rounding is applied at each step. Exact
 *     per-fragment parity with the GPU is not claimed and is not needed: every figure below is
 *     a mean over hundreds of real samples, so a last-bit difference in a noise lookup cannot
 *     move it.
 *   • Everything downstream of the ground colour — paint(), the aerial haze, the tone map — is
 *     shared by all five biomes and monotone, so it cannot make two different albedos equal.
 *     What is reported is therefore the GROUND ALBEDO in sRGB 0-255.
 *
 * Sites are the coordinates where each biome is DOMINANT, strongest first, found by scanning
 * the real `biomeWeights` — so these are colours at places the player can actually drive to,
 * not at hypothetical pure weights. The raw dominance table is printed first because it is
 * the finding: three of the five never even reach 0.8, and two never reach 0.5.
 *
 * Usage:  node tools/diag-biomes.mjs [seed] [--thresh 0.8]
 */
import { landHeight } from '../src/world/terrain.js';
import { biomeWeights, BIOME, BIOME_COUNT, BIOME_SHORT, BIOME_SCATTER, BIOME_TERRAIN } from '../src/world/biomes.js';
import { LIN, BIOME_TINT, biomeGroundArrays, GROUND_SHARPEN } from '../src/core/palette.js';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;
const ti = process.argv.indexOf('--thresh');
const THRESH = ti > 0 ? Number(process.argv[ti + 1]) : 0.8;

/* ── the GLSL noise, ported ──────────────────────────────────────────────── */
const f32 = Math.fround;
const fract = (x) => f32(x - Math.floor(x));
function hash12(px, py) {
  // vec3 p3 = fract(vec3(p.xyx)*0.1031)
  let a = fract(f32(px * 0.1031)), b = fract(f32(py * 0.1031)), c = fract(f32(px * 0.1031));
  // p3 += dot(p3, p3.yzx + 33.33)
  const d = f32(a * f32(b + 33.33) + b * f32(c + 33.33) + c * f32(a + 33.33));
  a = f32(a + d); b = f32(b + d); c = f32(c + d);
  return fract(f32(f32(a + b) * c));
}
function grad2(ix, iy) {
  const ang = f32(hash12(ix, iy) * 6.2831853);
  return [Math.cos(ang), Math.sin(ang)];
}
function pn2(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const g00 = grad2(ix, iy), g10 = grad2(ix + 1, iy), g01 = grad2(ix, iy + 1), g11 = grad2(ix + 1, iy + 1);
  const a = g00[0] * fx + g00[1] * fy;
  const b = g10[0] * (fx - 1) + g10[1] * fy;
  const c = g01[0] * fx + g01[1] * (fy - 1);
  const d = g11[0] * (fx - 1) + g11[1] * (fy - 1);
  const mix = (u, v, t) => u + (v - u) * t;
  return mix(mix(a, b, ux), mix(c, d, ux), uy) * 1.42;
}
function fbm2g(px, py, oct) {
  let a = 0.5, s = 0, n = 0, x = px, y = py;
  for (let i = 0; i < oct; i++) {
    s += a * pn2(x, y);
    n += a;
    x = x * 2.02 + 3.1;
    y = y * 2.02 + 1.7;
    a *= 0.5;
  }
  return s / n;
}
function vn2(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix, fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const mix = (u, v, t) => u + (v - u) * t;
  return mix(
    mix(hash12(ix, iy), hash12(ix + 1, iy), ux),
    mix(hash12(ix, iy + 1), hash12(ix + 1, iy + 1), ux),
    uy,
  );
}

/* ── vec helpers ─────────────────────────────────────────────────────────── */
const V = (c) => [c.r, c.g, c.b];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** linear -> sRGB 0..255, the same transfer three.js's output encoding applies. */
function srgb8(c) {
  return c.map((v) => {
    v = Math.max(0, Math.min(1, v));
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(s * 255);
  });
}

const K = {
  rockLit: V(LIN.rockLit), rockShade: V(LIN.rockShade),
};
const RAMP = biomeGroundArrays();

/**
 * TERRAIN_FS's ground-colour block, mirrored. Returns { lit, mid, shade } in LINEAR rgb.
 * `w` is the five-weight vector, `y` the world height, `slope` = 1 - N.y.
 */
export function groundColour(x, z, y, slope, w) {
  let tintR = [0, 0, 0];
  let snowScal = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const b = BIOME_TINT[i];
    tintR = [tintR[0] + b.rock[0] * w[i], tintR[1] + b.rock[1] * w[i], tintR[2] + b.rock[2] * w[i]];
    snowScal += b.snow * w[i];
  }

  const blot = fbm2g(x * 0.0042, z * 0.0042, 4) * 0.5 + 0.5;
  const grain = pn2(x * 0.16, z * 0.16) * 0.5 + 0.5;

  // The sharpened PALETTE weights — TERRAIN_FS's gw[] verbatim.
  const gw = new Array(BIOME_COUNT);
  let gsum = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    gw[i] = Math.pow(Math.max(w[i], 0), GROUND_SHARPEN);
    gsum += gw[i];
  }
  gsum = Math.max(gsum, 1e-6);
  for (let i = 0; i < BIOME_COUNT; i++) gw[i] /= gsum;

  // Blend the five RAMPS, not one ramp through five multipliers.
  let lit = [0, 0, 0], mid = [0, 0, 0], shade = [0, 0, 0];
  for (let i = 0; i < BIOME_COUNT; i++) {
    const bl = RAMP.lit.slice(i * 3, i * 3 + 3);
    const bm = RAMP.mid.slice(i * 3, i * 3 + 3);
    const bs = RAMP.shade.slice(i * 3, i * 3 + 3);
    const bh = RAMP.hollow.slice(i * 3, i * 3 + 3);
    const l = mix3([...bl], [...bm], blot * 0.55);
    const m = mix3([...bm], [...bs], blot * 0.4);
    const s = mix3([...bs], [...bh], blot * 0.62);
    for (let c = 0; c < 3; c++) { lit[c] += l[c] * gw[i]; mid[c] += m[c] * gw[i]; shade[c] += s[c] * gw[i]; }
  }
  const sandAmt = gw[3];

  const rockAmt = smoothstep(0.36, 0.66, slope) * (0.55 + 0.45 * grain);
  const rLit = mul3(K.rockLit, tintR), rShd = mul3(K.rockShade, tintR);
  lit = mix3(lit, rLit, rockAmt);
  mid = mix3(mid, mix3(rLit, rShd, 0.5), rockAmt);
  shade = mix3(shade, rShd, rockAmt);

  const snowLine = smoothstep(120, 240, y) * snowScal;
  const snowHold = smoothstep(0.55, 0.16, slope);
  const snow = clamp01(snowLine * snowHold * (0.6 + 0.5 * grain));
  lit = mix3(lit, [0.95, 0.96, 0.99], snow);
  mid = mix3(mid, [0.8, 0.85, 0.94], snow);
  shade = mix3(shade, [0.58, 0.66, 0.82], snow);

  return { lit, mid, shade, blot, grain, snow, rockAmt, sandAmt, gw };
}

/** Slope from the raw land, the same finite difference diag-cliffs uses on Terrain.normal. */
function landSlope(x, z, d = 2.5) {
  const hx = landHeight(x + d, z, SEED) - landHeight(x - d, z, SEED);
  const hz = landHeight(x, z + d, SEED) - landHeight(x, z - d, SEED);
  const nx = -hx, nz = -hz, ny = 2 * d;
  const l = Math.hypot(nx, ny, nz);
  return 1 - ny / l;
}

/** Relief inside a 720 m square, the same window diag-relief.mjs reports. */
function relief(cx, cz, win = 720, step = 20) {
  let lo = Infinity, hi = -Infinity;
  for (let x = cx - win / 2; x <= cx + win / 2; x += step)
    for (let z = cz - win / 2; z <= cz + win / 2; z += step) {
      const h = landHeight(x, z, SEED);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  return hi - lo;
}

/* ── find real ground for each biome ─────────────────────────────────────── */
const SPAN = 44000, STEP = 220;
const sites = Array.from({ length: BIOME_COUNT }, () => []);
const w = new Float32Array(BIOME_COUNT);
const maxW = new Array(BIOME_COUNT).fill(0);
const overThresh = new Array(BIOME_COUNT).fill(0);
let scanned = 0;
for (let x = -SPAN / 2; x < SPAN / 2; x += STEP) {
  for (let z = -SPAN / 2; z < SPAN / 2; z += STEP) {
    const r = biomeWeights(x, z, SEED, w);
    scanned++;
    sites[r.dominant].push([x, z, w[r.dominant]]);
    for (let i = 0; i < BIOME_COUNT; i++) {
      if (w[i] > maxW[i]) maxW[i] = w[i];
      if (w[i] > THRESH) overThresh[i]++;
    }
  }
}
for (const s of sites) s.sort((a, b) => b[2] - a[2]);

console.log(`seed ${SEED} — ground albedo where each biome DOMINATES, ${SPAN / 1000} km scan at ${STEP} m`);
console.log('');
console.log('RAW BIOME DOMINANCE — the reason five biomes read as three.');
console.log('biome        dominant%   highest weight anywhere   share over ' + THRESH.toFixed(2));
for (let i = 0; i < BIOME_COUNT; i++) {
  console.log(
    `${BIOME_SHORT[i].padEnd(11)} ${((100 * sites[i].length) / scanned).toFixed(2).padStart(8)}% ` +
      `${maxW[i].toFixed(3).padStart(22)} ${((100 * overThresh[i]) / scanned).toFixed(2).padStart(15)}%`,
  );
}
console.log(
  'A biome whose weight never passes 0.5 is never seen on its own: its ramp is always\n' +
    'averaged with its neighbour\'s. That is what GROUND_SHARPEN (core/palette.js) undoes,\n' +
    'in the palette only — the terrain height blend is deliberately left soft.\n',
);

const PICK = 14, PATCH = 5, PATCH_STEP = 60;
const rows = [];
for (let i = 0; i < BIOME_COUNT; i++) {
  const pool = sites[i];
  if (!pool.length) { rows.push(null); continue; }
  // The PICK strongest points this biome has anywhere in the scan — its own best ground.
  const picks = pool.slice(0, PICK);

  let acc = { lit: [0, 0, 0], mid: [0, 0, 0], shade: [0, 0, 0] };
  let n = 0, slopeSum = 0, snowSum = 0, rockSum = 0, ySum = 0, wSum = 0, gwSum = 0;
  const reliefs = [];
  for (const [sx, sz] of picks) {
    reliefs.push(relief(sx, sz));
    for (let a = 0; a < PATCH; a++)
      for (let b = 0; b < PATCH; b++) {
        const x = sx + (a - (PATCH - 1) / 2) * PATCH_STEP;
        const z = sz + (b - (PATCH - 1) / 2) * PATCH_STEP;
        biomeWeights(x, z, SEED, w);
        const y = landHeight(x, z, SEED);
        const sl = landSlope(x, z);
        const g = groundColour(x, z, y, sl, w);
        for (let c = 0; c < 3; c++) {
          acc.lit[c] += g.lit[c]; acc.mid[c] += g.mid[c]; acc.shade[c] += g.shade[c];
        }
        slopeSum += Math.acos(Math.min(1, 1 - sl)) * 57.2958;
        snowSum += g.snow; rockSum += g.rockAmt; ySum += y;
        wSum += w[i]; gwSum += g.gw[i];
        n++;
      }
  }
  reliefs.sort((a, b) => a - b);
  rows.push({
    i,
    sites: picks.length,
    n,
    lit: srgb8(acc.lit.map((v) => v / n)),
    mid: srgb8(acc.mid.map((v) => v / n)),
    shade: srgb8(acc.shade.map((v) => v / n)),
    reliefMed: reliefs[reliefs.length >> 1],
    reliefMin: reliefs[0],
    reliefMax: reliefs[reliefs.length - 1],
    slope: slopeSum / n,
    snow: snowSum / n,
    rock: rockSum / n,
    y: ySum / n,
    wRaw: wSum / n,
    wPal: gwSum / n,
  });
}

console.log('GROUND ALBEDO (sRGB 0-255), mean over each biome’s own strongest sites, 5x5 patch each');
console.log('biome      sites   n   wRaw  wPal      lit            mid            shade         snow  rock');
for (const r of rows) {
  if (!r) continue;
  const f = (c) => `(${String(c[0]).padStart(3)},${String(c[1]).padStart(3)},${String(c[2]).padStart(3)})`;
  console.log(
    `${BIOME_SHORT[r.i].padEnd(10)} ${String(r.sites).padStart(4)} ${String(r.n).padStart(4)} ` +
      `${r.wRaw.toFixed(2).padStart(6)} ${r.wPal.toFixed(2).padStart(5)}  ` +
      `${f(r.lit)} ${f(r.mid)} ${f(r.shade)} ${r.snow.toFixed(2).padStart(5)} ${r.rock.toFixed(2).padStart(5)}`,
  );
}

console.log('\nPAIRWISE COLOUR DISTANCE (euclidean in sRGB 0-255, on the mid stop)');
const live = rows.filter(Boolean);
process.stdout.write('           ' + live.map((r) => BIOME_SHORT[r.i].slice(0, 8).padStart(9)).join('') + '\n');
let worstPair = { d: Infinity, a: -1, b: -1 };
for (const a of live) {
  let line = BIOME_SHORT[a.i].padEnd(11);
  for (const b of live) {
    const d = Math.hypot(a.mid[0] - b.mid[0], a.mid[1] - b.mid[1], a.mid[2] - b.mid[2]);
    line += (a.i === b.i ? '-' : d.toFixed(1)).padStart(9);
    if (a.i < b.i && d < worstPair.d) worstPair = { d, a: a.i, b: b.i };
  }
  console.log(line);
}
console.log(
  `closest pair: ${BIOME_SHORT[worstPair.a]} vs ${BIOME_SHORT[worstPair.b]} = ${worstPair.d.toFixed(1)}`,
);

console.log('\nRELIEF SIGNATURE — 720 m square at each site (m of land, raw, no roads)');
console.log('biome        median     min     max   meanSlope°   meanY');
for (const r of rows) {
  if (!r) continue;
  console.log(
    `${BIOME_SHORT[r.i].padEnd(10)} ${r.reliefMed.toFixed(1).padStart(8)} ` +
      `${r.reliefMin.toFixed(1).padStart(7)} ${r.reliefMax.toFixed(1).padStart(7)} ` +
      `${r.slope.toFixed(2).padStart(11)} ${r.y.toFixed(1).padStart(7)}`,
  );
}

/* ── DUNES: does sand actually win wherever dunes wins? ────────────────────
 * The operator still marks the dunes item not done after a sand-colour fix, so the claim
 * "dunes reads as sand" is checked at EVERY dunes-dominant site in the scan rather than at
 * the handful of strongest ones — the previous fix's threshold, smoothstep(0.30, 0.80, w[3]),
 * only reached full sand at w[3] = 0.80, and w[3] never gets above 0.710 ANYWHERE. Most
 * dunes-dominant ground sat at w[3] ~ 0.45, i.e. about 22% sand over 78% olive dry grass.
 * A site FAILS here if red does not lead green — sand is red-led, dry grass is green-led. */
{
  const pool = sites[BIOME.DUNES] || sites[3];
  let green = 0, worst = { m: 1e9, x: 0, z: 0, rgb: null, w: 0 };
  let rMinusG = 0;
  for (const [x, z, wd] of pool) {
    biomeWeights(x, z, SEED, w);
    const y = landHeight(x, z, SEED);
    const g = groundColour(x, z, y, landSlope(x, z), w);
    const c = srgb8(g.mid);
    const margin = c[0] - c[1];
    rMinusG += margin;
    if (margin <= 0) green++;
    if (margin < worst.m) worst = { m: margin, x, z, rgb: c, w: wd };
  }
  console.log('\nDUNES SAND CHECK — every dunes-dominant site in the scan');
  console.log(
    `sites ${pool.length}   reading GREEN/OLIVE (mid green >= mid red): ${green}   ` +
      `mean red-minus-green ${(rMinusG / pool.length).toFixed(1)}`,
  );
  console.log(
    `weakest site: (${worst.x},${worst.z})  dunes weight ${worst.w.toFixed(3)}  ` +
      `mid rgb (${worst.rgb.join(',')})  red-green margin ${worst.m}`,
  );
}

console.log('\nSCATTER SIGNATURE (per 100 m x 100 m, from BIOME_SCATTER) + amp/wave');
console.log('biome       trees  rocks  bushes  reeds  grass   amp   wave  kinds');
for (let i = 0; i < BIOME_COUNT; i++) {
  const s = BIOME_SCATTER[i], t = BIOME_TERRAIN[i];
  console.log(
    `${BIOME_SHORT[i].padEnd(10)} ${String(s.trees).padStart(5)} ${String(s.rocks).padStart(6)} ` +
      `${String(s.bushes).padStart(7)} ${String(s.reeds).padStart(6)} ${s.grass.toFixed(2).padStart(6)} ` +
      `${String(t.amp).padStart(5)} ${String(t.wave).padStart(6)}  ${s.kinds.join('/')}`,
  );
}

/* ── the gate ────────────────────────────────────────────────────────────── */
const MIN_COLOUR = 40; // sRGB euclidean on the mid stop
const MIN_RELIEF_RATIO = 1.25; // between adjacent biomes when sorted by relief
let fails = 0;
console.log('');
for (const a of live) {
  for (const b of live) {
    if (a.i >= b.i) continue;
    const d = Math.hypot(a.mid[0] - b.mid[0], a.mid[1] - b.mid[1], a.mid[2] - b.mid[2]);
    if (d < MIN_COLOUR) {
      console.log(`FAIL  ${BIOME_SHORT[a.i]} vs ${BIOME_SHORT[b.i]}: colour distance ${d.toFixed(1)} < ${MIN_COLOUR}`);
      fails++;
    }
  }
}
const byRelief = live.slice().sort((p, q) => p.reliefMed - q.reliefMed);
for (let k = 1; k < byRelief.length; k++) {
  const lo = byRelief[k - 1], hi = byRelief[k];
  const ratio = hi.reliefMed / Math.max(1e-3, lo.reliefMed);
  const tag = ratio >= MIN_RELIEF_RATIO ? 'ok  ' : 'flat';
  console.log(
    `relief step ${tag} ${BIOME_SHORT[lo.i].padEnd(10)} ${lo.reliefMed.toFixed(1).padStart(6)} m  ->  ` +
      `${BIOME_SHORT[hi.i].padEnd(10)} ${hi.reliefMed.toFixed(1).padStart(6)} m   x${ratio.toFixed(2)}`,
  );
}
console.log(fails === 0 ? '\nall five biomes distinct on colour' : `\n${fails} colour pair(s) too close`);
process.exitCode = fails === 0 ? 0 : 1;
