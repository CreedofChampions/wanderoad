/* Wanderoad — what colour does the car ACTUALLY come out?
 *
 * tools/browser-test.mjs's T2 check grabs the canvas, downsamples it to 200x120, reads the
 * 40x34 block where the chase camera always puts the car, and reports the PEAK
 * (max-min)/max over those pixels. That is a number about the final 8-bit sRGB frame, not
 * about the paint chip we started from — between the two sit the painted shader's band
 * ramp, the painter's light model, the filmic tonemap and the whole grade in post.js.
 *
 * This harness walks a body fragment through every one of those stages in plain JS and
 * prints the same number. It cannot launch Chrome (other agents are using this checkout),
 * so instead it reproduces the arithmetic — and the proof that the arithmetic is the right
 * arithmetic is that on the code as it stood it lands inside the 0.11..0.30 band the
 * browser suite actually measured.
 *
 *   node tools/diag-carpaint.mjs            — the paint the game ships
 *   node tools/diag-carpaint.mjs --raw      — as if hex/255 were fed in as linear (the bug)
 *   node tools/diag-carpaint.mjs --slot matte|metal|body
 *
 * WHAT IT MODELS AND WHAT IT DOES NOT
 *   modelled: vertex colour -> paintedFS body branch -> paint() (GL_LIGHT) -> aerial()
 *             -> tonemap -> grade -> sat boost -> vignette -> sRGB -> 8-bit -> T2's metric.
 *   not modelled (each argued to be neutral or conservative at the sample point):
 *     FXAA      — a flat body panel fails its own contrast gate and is returned untouched.
 *     CA        — ~0.0018 of the radius on a flat panel; samples the same colour.
 *     bloom     — the body's luma is well under the 1.02 bright-pass threshold, so it
 *                 contributes nothing; light bleeding IN from the sky would only add.
 *     grain     — a +/-3% multiplier on all three channels; ratios, and so saturation,
 *                 are untouched.
 *     radial    — T2 runs from a standstill, so uRadial is 0.
 *     chroma bleed — modelled, at its WORST case: the 1/8-res soft buffer is assumed to
 *                 carry no chroma at all, which pulls 9% of the way to grey. If the car
 *                 fills the neighbourhood the real loss is nearer zero.
 */

import { readFileSync } from 'node:fs';
import { RGB } from '../src/core/palette.js';
import { sunDirection } from '../src/render/uniforms.js';
import { BODY_PAINTS, bodyPaintLinear } from '../src/car/loadedCar.js';

/* ── vec3 ─────────────────────────────────────────────────────────────────── */
const v = (x, y, z) => [x, y, z];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clamp3 = (a, lo, hi) => a.map((x) => clamp(x, lo, hi));
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
/* GLSL smoothstep, including the reversed-edge case aerial() relies on. */
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/* ── MAT.BODY's ramp, read straight out of the shader source ──────────────── */
const PAINTED_SRC = readFileSync(new URL('../src/render/painted.js', import.meta.url), 'utf8');
const BODY_BRANCH = PAINTED_SRC.slice(PAINTED_SRC.indexOf('if(vM > 6.5)'));
const num = (re, what) => {
  const m = re.exec(BODY_BRANCH);
  if (!m) throw new Error(`could not read ${what} out of painted.js — the MAT.BODY branch has moved`);
  return m.slice(1).map(Number);
};
const BODY_GLSL = {
  chroma: num(/vec3 deep = max\(base \+ \(base - vec3\(bl\)\)\*([\d.]+)/, 'the chroma push')[0],
  lit: num(/lit = deep\*([\d.]+)/, 'the lit band')[0],
  mid: num(/mid = deep\*([\d.]+)/, 'the mid band')[0],
  shdMul: num(/shd = mix\(deep\*([\d.]+),/, 'the shade band')[0],
  shdTint: num(/shd = mix\(deep\*[\d.]+, K_SHADOW\*([\d.]+),/, 'the shade tint')[0],
  shdMix: num(/shd = mix\(deep\*[\d.]+, K_SHADOW\*[\d.]+, ([\d.]+)\)/, 'the shade mix')[0],
  rim: num(/rim = ([\d.]+);/, 'the rim')[0],
};

/* ── the palette, exactly as glslPalette() bakes it into every shader ─────── */
const K_SUN = RGB.sun;
const K_AMB_SKY = RGB.ambSky;
const K_AMB_GND = RGB.ambGround;
const K_SHADOW = RGB.shadowTint;

/* ── GL_LIGHT: ramp3 + paint(), core/glsl.js:293-347 ─────────────────────── */
function ramp3(t, shade, mid, lit, soft, jit) {
  const a = sstep(0.17 - soft + jit, 0.17 + soft + jit, t);
  const b = sstep(0.58 - soft + jit, 0.58 + soft + jit, t);
  return mix3(mix3(shade, mid, a), lit, b);
}

function paint(s, sun) {
  const ndl = dot(s.N, sun);
  const wrap = clamp(ndl * 0.62 + 0.46, 0, 1);
  const t = wrap * (0.34 + (1.0 - 0.34) * s.shadow);
  let col = ramp3(t, s.shade, s.mid, s.lit, s.soft, s.jit);

  const litAmt = sstep(0.34, 0.86, t);
  col = mul(col, mix3([0.94, 0.94, 0.94], scl(K_SUN, 1.32), litAmt * 0.62));

  col = mix3(add(scl(col, 0.80), scl(K_SHADOW, 0.040)), col, s.shadow * 0.82 + 0.18);

  const hemi = mix3(K_AMB_GND, K_AMB_SKY, s.N[1] * 0.5 + 0.5);
  const hueOnly = scl(hemi, 1 / Math.max(luma(hemi), 1e-3));
  col = mul(col, mix3([1, 1, 1], hueOnly, 0.22 * s.ambient * (1 - litAmt * 0.55)));
  col = add(col, scl(hemi, 0.052 * s.ambient * s.ao * (1 - litAmt * 0.85)));

  const back = sstep(0.05, 0.85, dot(s.V, scl(sun, -1)));
  const fres = Math.pow(1 - clamp(dot(s.N, s.V), 0, 1), 4.2);
  col = add(col, scl(K_SUN, fres * back * s.rim * 1.15 * s.shadow));
  return scl(col, s.ao);
}

/* aerial(), core/glsl.js:356. At 6-8 m with uFogNear = 140 both the exponential term and
 * the valley-floor mist pool are identically zero, in every biome — nothing in the game
 * ever writes uFogNear/uFogFar/uFogMul, so the car is never hazed by its own camera. */
function aerial(col, dist) {
  const d = Math.max(dist - 140, 0);
  const f = 1 - Math.exp(-Math.pow(d / 4200, 1.28) * 3.1);
  const pool = sstep(46, 8, 0.8) * sstep(120, 420, dist);
  return { col, fog: clamp(f + pool * 0.16, 0, 1) };
}

/* ── the body branches of paintedFS, render/painted.js:286-326 ───────────── */
function bodyRamp(slot, base) {
  if (slot === 'metal') {
    return {
      lit: scl(base, 1.25),
      mid: scl(base, 0.62),
      shd: mix3(scl(base, 0.30), scl(K_SHADOW, 0.7), 0.5),
      rim: 0.62,
    };
  }
  if (slot === 'body') {
    // MAT.BODY. The constants are READ OUT of the `vM > 6.5` branch in painted.js rather
    // than copied here, so this harness cannot quietly report a tuning the game does not
    // have. --chroma / --rim override them for experiments.
    const bl = luma(base);
    const deep = clamp3(base.map((c) => c + (c - bl) * CHROMA), 0, 64);
    return {
      lit: scl(deep, BODY_GLSL.lit),
      mid: scl(deep, BODY_GLSL.mid),
      shd: mix3(scl(deep, BODY_GLSL.shdMul), scl(K_SHADOW, BODY_GLSL.shdTint), SHDMIX),
      rim: RIM,
    };
  }
  return {
    lit: scl(base, 1.12),
    mid: mix3(scl(base, 0.76), scl(K_AMB_SKY, 0.22), 0.16),
    shd: mix3(scl(base, 0.40), scl(K_SHADOW, 0.60), 0.44),
    rim: 0.30,
  };
}

function shadeBody({ vcol, slot, N, V, dist, shadow, grain }) {
  const base = scl(vcol, grain);
  const r = bodyRamp(slot, base);
  const s = {
    N, V, shade: r.shd, mid: r.mid, lit: r.lit,
    soft: 0.075 + (0.19 - 0.075) * clamp(dist * 0.004, 0, 1),
    jit: 0,                 // the +/-0.055 band wobble averages out; 0 is the middle of it
    shadow, rim: r.rim, ao: 1, ambient: 1,
  };
  const lit = paint(s, SUN);
  return aerial(lit, dist);
}

/* ── COMPOSITE_FS, render/post.js:157-265 ────────────────────────────────── */
function tonemap(x) {
  return x.map((c) => {
    c = Math.max(c, 0);
    return clamp((c * (c * 0.36 + 0.42)) / (c * (c * 0.34 + 0.66) + 0.11), 0, 1);
  });
}
const toSRGB = (c) => c.map((x) => (x < 0.0031308 ? x * 12.92 : 1.055 * Math.pow(Math.max(x, 1e-5), 1 / 2.4) - 0.055));

function composite(linear, { r2 = 0.025, bleed = 0.09, paintAmt = 1, vigSpeed = 0.10 } = {}) {
  let c = linear;
  // chroma bleed toward the blurred neighbourhood — worst case, no chroma out there
  const lc = luma(c);
  c = mix3(c, [lc, lc, lc], bleed * paintAmt);
  c = tonemap(c);

  let l = luma(c);
  const shadowPush = mix3([0.90, 0.95, 1.16], [1, 1, 1], sstep(0.0, 0.34, l));
  const highPush = mix3([1, 1, 1], [1.055, 1.012, 0.925], sstep(0.44, 0.98, l));
  c = mul(c, mul(mix3([1, 1, 1], shadowPush, 0.85 * paintAmt), mix3([1, 1, 1], highPush, 0.9 * paintAmt)));
  const lift = scl([0.017, 0.021, 0.036], paintAmt);
  c = add(mul(c, [1 - lift[0], 1 - lift[1], 1 - lift[2]]), lift);
  c = mix3(c, c.map((x) => x * x * (3 - 2 * x)), 0.16 * paintAmt);
  l = luma(c);
  const satBoost = 1 + 0.16 * paintAmt * sstep(0.10, 0.42, l) * (1 - sstep(0.62, 0.96, l));
  c = mix3([l, l, l], c, satBoost);

  const vig = Math.pow(clamp(1 - r2 * 1.15, 0, 1), 1.55);
  c = mul(c, mix3([1, 1, 1], mix3([0.62, 0.60, 0.66], [1, 1, 1], vig), 0.85));
  const vigS = Math.pow(clamp(1 - r2 * 2.10, 0, 1), 1.10);
  c = mul(c, mix3([1, 1, 1], mix3([0.55, 0.55, 0.60], [1, 1, 1], vigS), vigSpeed));

  return toSRGB(clamp3(c, 0, 1));
}

/** T2's own metric, on 8-bit pixels. tools/browser-test.mjs:575-580. */
function t2sat(srgb) {
  const d = srgb.map((x) => Math.round(clamp(x, 0, 1) * 255));
  const mx = Math.max(...d), mn = Math.min(...d);
  return { sat: mx === 0 ? 0 : (mx - mn) / mx, rgb: d };
}

/* ── the scene the T2 shot is taken in ───────────────────────────────────── */
const SUN = [...sunDirection().toArray()];

/* Panels of a car shell, in the car's own frame (+Z nose, +X the driver's left). The peak
 * in T2 is the best pixel anywhere on the body, so what matters is the best-lit panel that
 * is actually facing the camera. */
const PANELS = [
  ['deck', norm(v(0, 1, 0))],
  ['bonnet', norm(v(0, 0.94, 0.34))],
  ['flank L', norm(v(1, 0.16, 0))],
  ['flank R', norm(v(-1, 0.16, 0))],
  ['shoulder L', norm(v(0.72, 0.70, 0))],
  ['shoulder R', norm(v(-0.72, 0.70, 0))],
  ['nose', norm(v(0, 0.26, 1))],
  ['tail', norm(v(0, 0.30, -1))],
  ['haunch L', norm(v(0.80, 0.42, -0.42))],
  ['haunch R', norm(v(-0.80, 0.42, -0.42))],
];

const rotY = (a, h) => {
  const c = Math.cos(h), s = Math.sin(h);
  return [a[0] * c + a[2] * s, a[1], -a[0] * s + a[2] * c];
};

/**
 * Peak T2 saturation over the visible panels of a car pointing along `heading`.
 * CAMERA.sport sits 6 m behind and 1.85 m above (car/tuning.js:359+), looking at the roof
 * line, so the view vector is fixed in the car's frame and rotates with it.
 */
function peakForHeading(vcol, slot, heading, shadow, grain) {
  const fwd = [Math.sin(heading), 0, Math.cos(heading)];
  const surf = v(0, 0.8, 0);
  const cam = v(-fwd[0] * 6.2, 1.9, -fwd[2] * 6.2);
  const V = norm([cam[0] - surf[0], cam[1] - surf[1], cam[2] - surf[2]]);
  const dist = Math.hypot(cam[0] - surf[0], cam[1] - surf[1], cam[2] - surf[2]);

  let best = { sat: -1 }, bright = { l: -1 };
  for (const [name, nLocal] of PANELS) {
    const N = rotY(nLocal, heading);
    if (dot(N, V) < 0.06) continue;            // facing away: not the pixel T2 sees
    const { col } = shadeBody({ vcol, slot, N, V, dist, shadow, grain });
    const out = t2sat(composite(col));
    if (out.sat > best.sat) best = { ...out, panel: name };
    // Brightest panel too: "more saturated" must not have been bought by turning the car
    // into a dark blob, and a peak-saturation number alone cannot tell you that.
    const l = luma(out.rgb);
    if (l > bright.l) bright = { l, rgb: out.rgb, panel: name };
  }
  return { ...best, bright };
}

function sweep(vcol, slot, shadow, grain) {
  let best = { sat: -1 }, worst = { sat: 2 }, bright = { l: -1 };
  const per = [];
  for (let i = 0; i < 16; i++) {
    const h = (i / 16) * Math.PI * 2;
    const b = peakForHeading(vcol, slot, h, shadow, grain);
    per.push({ heading: Math.round((h * 180) / Math.PI), ...b });
    if (b.sat > best.sat) best = { ...b, heading: Math.round((h * 180) / Math.PI) };
    if (b.sat < worst.sat) worst = { ...b, heading: Math.round((h * 180) / Math.PI) };
    if (b.bright.l > bright.l) bright = b.bright;
  }
  return { best, worst, bright, per };
}

/* ── report ──────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const RAW = argv.includes('--raw');
const SLOT = arg('slot', 'body');
const GRAIN = +arg('grain', 1.03);   // 0.90 + 0.20*g + 0.06*g2 averages 1.03
/* Defaults are whatever painted.js currently says; the flags are for A/B-ing a change. */
const CHROMA = +arg('chroma', BODY_GLSL.chroma);
const SHDMIX = +arg('shdmix', BODY_GLSL.shdMix);
const RIM = +arg('rim', BODY_GLSL.rim);

/* --raw reproduces the conversion loadedCar.js used to do: the sRGB hex byte / 255, handed
 * straight to a shader that treats every colour it is given as linear. Everything else asks
 * the GAME for the triple, so a number printed here is a number the shader is really given
 * — a tunable that is defined but never reaches the mesh is the exact bug class this
 * harness exists to rule out. */
const hexRaw = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};

const NAMES = ['paintA persimmon', 'paintB barley', 'paintC cobalt', 'paintD chalk', 'paintE verdigris', 'paintF ink'];
const paints = BODY_PAINTS.map((hex, i) => ({
  name: NAMES[i] || `paint${i}`,
  hex,
  vcol: RAW ? hexRaw(hex) : [...bodyPaintLinear(i)],
}));

/* ── drift guard ──────────────────────────────────────────────────────────────
 * The stages above are a hand port of GLSL that lives in three other files. If someone
 * retunes the shader and not this, every number below silently becomes fiction. Cheap
 * insurance: assert the constants are still the ones modelled. */
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\s+/g, ' ');
const MUST = [
  ['../src/render/painted.js', 'lit = base*1.12', 'MATTE lit band'],
  ['../src/render/painted.js', 'mid = mix(base*0.76, K_AMB_SKY*0.22, 0.16)', 'MATTE mid band'],
  ['../src/render/painted.js', 'shd = mix(base*0.40, K_SHADOW*0.60, 0.44)', 'MATTE shade band'],
  ['../src/render/painted.js', 'vec3 deep = max(base + (base - vec3(bl))*0.30, vec3(0.0))', 'BODY chroma push'],
  ['../src/render/painted.js', 'lit = deep*1.18', 'BODY lit band'],
  ['../src/render/painted.js', 'shd = mix(deep*0.34, K_SHADOW*0.44, 0.22)', 'BODY shade band'],
  ['../src/core/glsl.js', 'float wrap = clamp(ndl*0.62 + 0.46, 0.0, 1.0)', 'half-lambert wrap'],
  ['../src/core/glsl.js', 'col *= mix(vec3(0.94), K_SUN * 1.32, litAmt * 0.62)', 'sun tint'],
  ['../src/render/post.js', 'vec3 a = x*(x*0.36 + 0.42)', 'tonemap numerator'],
  ['../src/render/post.js', 'float satBoost = 1.0 + 0.16*uPaint', 'midtone sat boost'],
];
let drift = 0;
for (const [file, needle, what] of MUST) {
  if (!src(file).includes(needle.replace(/\s+/g, ' '))) { console.error(`DRIFT: ${what} no longer matches ${file}`); drift++; }
}
if (drift) console.error(`${drift} modelled constant(s) have moved — the numbers below are stale.\n`);

/* ...and the slot the car is actually built with, for the same reason. */
const carSrc = readFileSync(new URL('../src/car/loadedCar.js', import.meta.url), 'utf8');
const shipsWith = /return \{ col: paintCol, mat: MAT\.(\w+) \}/.exec(carSrc);
console.log(`loadedCar.js paints bodywork with MAT.${shipsWith ? shipsWith[1] : '???'}`
  + `; measuring slot "${SLOT}"${shipsWith && shipsWith[1].toLowerCase() !== SLOT && !RAW ? '  <-- MISMATCH' : ''}`);

console.log(`car paint through the full pipeline — slot=${SLOT} ${RAW ? '(RAW hex/255, the bug)' : '(sRGB->linear, shipped)'} grain=${GRAIN}`);
console.log(`sun: elev 13.5 az 118 -> (${SUN.map((x) => x.toFixed(3)).join(', ')})   T2 threshold: 0.30, target: 0.35+`);
console.log('');
console.log('paint                 vcol (linear)          best sat  rgb           panel        worst sat  under cloud  brightest panel');
console.log('-'.repeat(130));

let overallBest = 0, overallWorstOfBest = 1, cloudWorst = 1;
for (const p of paints) {
  const clear = sweep(p.vcol, SLOT, 1.0, GRAIN);
  // cloudShadow() bottoms out at 1 - 0.64 = 0.36 under the thickest part of a cumulus
  const cloud = sweep(p.vcol, SLOT, 0.36, GRAIN);
  const vc = `(${p.vcol.map((x) => x.toFixed(3)).join(',')})`;
  console.log(
    `${p.name.padEnd(20)}  ${vc.padEnd(22)} ${clear.best.sat.toFixed(3).padStart(7)}   `
    + `${`rgb(${clear.best.rgb.join(',')})`.padEnd(18)} ${String(clear.best.panel).padEnd(11)} `
    + `${clear.worst.sat.toFixed(3).padStart(7)}   ${cloud.best.sat.toFixed(3).padStart(7)}      `
    + `rgb(${clear.bright.rgb.join(',')})`,
  );
  // "chalk" and "ink" are deliberately near-neutral paints; they cannot and should not be
  // saturated, so they do not count toward the acceptance number.
  if (!/chalk|ink/.test(p.name)) {
    overallBest = Math.max(overallBest, clear.best.sat);
    overallWorstOfBest = Math.min(overallWorstOfBest, clear.best.sat);
    cloudWorst = Math.min(cloudWorst, cloud.best.sat);
  }
}
console.log('-'.repeat(112));
/* --panels: every panel of one car at one heading. A peak-saturation number cannot tell
 * you whether the colour was won by turning the whole car dark, and that is a real risk
 * with a chroma push — this is the check for it. */
if (argv.includes('--panels')) {
  const which = +arg('paint', 0);
  const heading = (+arg('heading', 40) * Math.PI) / 180;
  const vcol = RAW ? hexRaw(BODY_PAINTS[which]) : [...bodyPaintLinear(which)];
  const fwd = [Math.sin(heading), 0, Math.cos(heading)];
  const surf = v(0, 0.8, 0);
  const cam = v(-fwd[0] * 6.2, 1.9, -fwd[2] * 6.2);
  const V = norm([cam[0] - surf[0], cam[1] - surf[1], cam[2] - surf[2]]);
  const dist = Math.hypot(cam[0] - surf[0], cam[1] - surf[1], cam[2] - surf[2]);
  console.log('');
  console.log(`every visible panel of ${NAMES[which]} at heading ${arg('heading', 40)} deg, slot=${SLOT}:`);
  let sum = 0, n = 0;
  for (const [name, nLocal] of PANELS) {
    const N = rotY(nLocal, heading);
    if (dot(N, V) < 0.06) continue;
    const { col } = shadeBody({ vcol, slot: SLOT, N, V, dist, shadow: 1.0, grain: GRAIN });
    const out = t2sat(composite(col));
    sum += luma(out.rgb); n++;
    console.log(`  ${name.padEnd(11)} rgb(${out.rgb.join(',').padEnd(11)})  sat ${out.sat.toFixed(3)}  luma ${luma(out.rgb).toFixed(1)}`);
  }
  console.log(`  mean luma over ${n} visible panels: ${(sum / n).toFixed(1)} / 255`);
}

console.log(`coloured paints: peak ${overallBest.toFixed(3)}, worst-case peak across all 16 headings `
  + `${overallWorstOfBest.toFixed(3)}, worst under full cloud shadow ${cloudWorst.toFixed(3)}`);

/* Grain extremes: the object-space paint grain multiplies base by 0.90..1.16, and the
 * tonemap is non-linear, so the same panel reads slightly differently frame to frame. This
 * is where T2's frame-to-frame spread comes from. */
const lo = sweep(paints[0].vcol, SLOT, 1.0, 0.90).best.sat;
const hi = sweep(paints[0].vcol, SLOT, 1.0, 1.16).best.sat;
console.log(`grain spread on persimmon: ${lo.toFixed(3)} (dark grain) .. ${hi.toFixed(3)} (light grain)`);
