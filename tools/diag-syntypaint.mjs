/* created by AI
 * Wanderoad — does remapBakedBody actually repaint a Synty body, on the REAL shipped assets?
 *
 * B46 (see src/car/loadedCar.js:67-98): the Synty pickup shipped stuck in the artist's own
 * factory two-tone — "#4566A9 ... baby blue" over "#ABB2AC ... grey parts still" — because the
 * baked branch of loadCar() handed the whole body's COLOR_0 straight to the GPU and never asked
 * what the player picked. remapBakedBody() is the fix: cluster the baked vertex colours back
 * into the artist's own flat regions, find the one saturated cluster big enough to be "the
 * paint", find the one near-neutral mid-tone cluster big enough to be "the cladding", and
 * replace only those two families — everything else (glass reflections baked into the shell,
 * tail-light bleed, the tan interior trim) is meant to survive completely untouched.
 *
 * That is a lot of judgement landing on TWO real assets this game actually ships: a saturation
 * threshold, a hue window, a luminance window for cladding, a belt line at 78% of body height,
 * a shading clamp. A unit test against a hand-rolled fixture would prove the arithmetic works on
 * data nobody drives past; remapBakedBody's own header names both real files by hex and vertex
 * count specifically so a check could be written against THEM instead. This is that check: it
 * reads public/models/cars/synty-pickup.glb and synty-convertible.glb itself (its own small GLB
 * parser, copied from tools/synty-car.mjs — importing that file would run its own argv/exit CLI
 * as a side effect of module load), builds a real three BufferGeometry per Body mesh exactly as
 * loadCar() would feed remapBakedBody, and calls the REAL exported function — never a re-typed
 * copy of its colour math — once per shipped GLB per paint chip in the fleet.
 *
 * The one thing reused rather than re-derived here is remapBakedBody's OWN classification knobs
 * (PAINT_SAT, CLAD_SAT, CLAD_LUM, PAINT_HUE, BELT, SHADE_CLAMP): they are not exported — module-
 * private on purpose, per that file's own comment, because the rule is meant to be computed from
 * the mesh rather than a typed list. Hand-copying six numbers here would silently drift from the
 * real ones the moment either file was tuned without the other in mind, so instead they are read
 * straight out of loadedCar.js's own source text at run time — the same trick
 * tools/diag-carpaint.mjs uses to pull constants out of painted.js's GLSL. Everything downstream
 * of those six numbers — which vertices count as "paint", which count as "cladding", what each
 * cluster's shading multiplier should be, where the belt line falls — is worked out
 * independently in plain JS as the EXPECTED answer, then checked against what remapBakedBody()
 * actually returned. That independent working is colour theory (luminance, hue, saturation) and
 * the clustering trick remapBakedBody documents as recovering the artist's own flat regions —
 * not a restatement of "what the fix should do", which would just be testing this file's own
 * assumptions against themselves.
 *
 * WHAT A PASS HERE PROVES: that on the two Synty bodies this game ships, remapBakedBody's CPU-
 * side colour arithmetic matches its own written spec — the factory paint is gone, the paint
 * family lands on paintCol scaled by the right per-cluster ratio (clamped), the cladding splits
 * at the belt into paint-above/trim-below at the right ratio, and every cluster outside both
 * families is left bit-for-bit alone.
 *
 * WHAT IT CANNOT PROVE: anything downstream of the vertex colour. It does not load the scene
 * through loadCar()/classify(), so it cannot prove the baked branch is actually still WIRED to
 * call remapBakedBody at all — and it never touches the painted shader, the tonemap or the
 * grade, so it says nothing about the pixel the chase camera ends up seeing (that is
 * tools/diag-carpaint.mjs's job, and tools/diag-carshot.mjs's). It also does not render the belt
 * line in 3D, so a belt that is geometrically in a silly place on the model would still "pass"
 * here as long as the split it computes is internally consistent.
 *
 *   node tools/diag-syntypaint.mjs
 */

import { readFileSync } from 'node:fs';
import { BufferGeometry, BufferAttribute } from 'three';
import { remapBakedBody, bodyPaintLinear } from '../src/car/loadedCar.js';
import { RGB } from '../src/core/palette.js';

/* ── GLB reader, copied from tools/synty-car.mjs:42-74 ──────────────────────────────────────
 * Not imported: synty-car.mjs is a converter CLI that reads process.argv and calls
 * process.exit(1) at MODULE SCOPE the instant it is loaded without the right argv — exactly
 * what importing it as a library here would trigger. Copying two small, stable functions is
 * cheaper than teaching that file to be both a CLI and a library. */
function readGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let p = 20 + jsonLen;
  let bin = Buffer.alloc(0);
  while (p < buf.length) {
    const len = buf.readUInt32LE(p);
    const type = buf.readUInt32LE(p + 4);
    if (type === 0x004e4942) bin = buf.subarray(p + 8, p + 8 + len);
    p += 8 + len;
  }
  return { gltf, bin };
}

function readAccessor(gltf, bin, idx) {
  const a = gltf.accessors[idx];
  const bv = gltf.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const stride = bv.byteStride || 0;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const at = base + (stride ? i * stride : i * comps * (a.componentType === 5123 ? 2 : a.componentType === 5121 ? 1 : 4));
    for (let c = 0; c < comps; c++) {
      if (a.componentType === 5126) out.push(bin.readFloatLE(at + c * 4));
      else if (a.componentType === 5125) out.push(bin.readUInt32LE(at + c * 4));
      else if (a.componentType === 5123) out.push(bin.readUInt16LE(at + c * 2));
      else if (a.componentType === 5121) out.push(bin.readUInt8(at + c));
      else throw new Error('unhandled componentType ' + a.componentType);
    }
  }
  return out;
}

/** Read one GLB's Body mesh — the primitive whose glTF material is named 'White' — into a real
 *  three BufferGeometry carrying just `position` and `color`, exactly what remapBakedBody reads.
 *  Both shipped Synty bodies bake POSITION and COLOR_0 as FLOAT VEC3 (tools/synty-car.mjs's own
 *  output format), so no normalisation or type juggling is needed beyond wrapping the floats. */
function loadBody(url, label) {
  const { gltf, bin } = readGlb(readFileSync(url));
  let found = null;
  for (const m of gltf.meshes || []) {
    for (const prim of m.primitives) {
      if (gltf.materials[prim.material]?.name === 'White') {
        found = { m, prim };
        break;
      }
    }
    if (found) break;
  }
  if (!found) throw new Error(`${label}: no primitive with material 'White' (the Body) — has the export changed?`);
  const { m, prim } = found;
  const pos = new Float32Array(readAccessor(gltf, bin, prim.attributes.POSITION));
  const col = new Float32Array(readAccessor(gltf, bin, prim.attributes.COLOR_0));
  if (col.length !== pos.length) throw new Error(`${label}: COLOR_0 (${col.length / 3}) and POSITION (${pos.length / 3}) vertex counts disagree`);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(pos, 3));
  geometry.setAttribute('color', new BufferAttribute(col, 3));
  return { geometry, pos, col, n: pos.length / 3, meshName: m.name };
}

/* ── remapBakedBody's own classification knobs, read out of its source rather than re-typed ──
 * loadedCar.js does not export PAINT_SAT/CLAD_SAT/CLAD_LUM/PAINT_HUE/BELT/SHADE_CLAMP. Hand-
 * copying six numbers here would silently drift from the real ones the moment either file was
 * tuned without the other in mind, so they are read straight out of the ACTUAL source text. */
const CAR_SRC = readFileSync(new URL('../src/car/loadedCar.js', import.meta.url), 'utf8');
const lit = (re, what) => {
  const m = re.exec(CAR_SRC);
  if (!m) throw new Error(`could not read ${what} out of loadedCar.js — remapBakedBody's constants moved`);
  return m.slice(1).map(Number);
};
const PAINT_SAT = lit(/const PAINT_SAT = ([\d.]+);/, 'PAINT_SAT')[0];
const CLAD_SAT = lit(/const CLAD_SAT = ([\d.]+);/, 'CLAD_SAT')[0];
const CLAD_LUM = lit(/const CLAD_LUM = \[([\d.]+), ([\d.]+)\];/, 'CLAD_LUM');
const PAINT_HUE = lit(/const PAINT_HUE = ([\d.]+);/, 'PAINT_HUE')[0];
const BELT = lit(/const BELT = ([\d.]+);/, 'BELT')[0];
const SHADE_CLAMP = lit(/const SHADE_CLAMP = \[([\d.]+), ([\d.]+)\];/, 'SHADE_CLAMP');

/* ── the same colorimetry remapBakedBody uses, copied from loadedCar.js:100-126 ─────────────
 * These four are generic (Rec.709 luminance, hue, hue distance, saturation) — copying them is
 * copying colour theory, not copying the thing under test. The thing under test is which
 * vertices get called "paint" or "cladding" and what they become, which is worked out below in
 * buildPlan() and then checked against remapBakedBody's REAL output, never assumed. */
const lum709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function hue(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d <= 1e-6) return NaN;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b);
  return mx <= 1e-6 ? 0 : (mx - Math.min(r, g, b)) / mx;
};

/** Quantise a body's baked vertex colours into flat-region clusters, exactly as remapBakedBody
 *  does (8-bit rounding recovers the artist's own regions, per its own comment) — this is the
 *  ONLY reason the two computations agree on which vertices share a cluster; it is re-derived
 *  here rather than read back off remapBakedBody, because that function returns colours, not
 *  its own working. */
function clusterOf(col, n) {
  const clusters = new Map();
  const keyOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = col[i * 3];
    const g = col[i * 3 + 1];
    const b = col[i * 3 + 2];
    const k = ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)) >>> 0;
    keyOf[i] = k;
    let c = clusters.get(k);
    if (!c) clusters.set(k, (c = { n: 0, r, g, b, sat: satOf(r, g, b), lum: lum709(r, g, b), h: hue(r, g, b) }));
    c.n++;
  }
  return { clusters, keyOf };
}

/** The EXPECTED plan: which cluster becomes "paint", which becomes "cladding", and by how much
 *  each is scaled — worked out independently from the body's own baked colours, before
 *  remapBakedBody is ever called. `null` means "this body has no saturated cluster to anchor
 *  on", which is fail-safe (ii)'s condition; both real GLBs must clear it. */
function buildPlan(clusters) {
  let anchor = null;
  for (const c of clusters.values()) if (c.sat >= PAINT_SAT && (!anchor || c.n > anchor.n)) anchor = c;
  if (!anchor) return null;

  let clad = null;
  for (const c of clusters.values()) {
    if (c.sat < CLAD_SAT && c.lum >= CLAD_LUM[0] && c.lum <= CLAD_LUM[1] && (!clad || c.n > clad.n)) clad = c;
  }

  const shade = (l, ref) => Math.min(SHADE_CLAMP[1], Math.max(SHADE_CLAMP[0], ref > 1e-6 ? l / ref : 1));
  const plan = new Map();
  for (const [k, c] of clusters) {
    if (c.sat >= PAINT_SAT && !Number.isNaN(c.h) && hueGap(c.h, anchor.h) <= PAINT_HUE) {
      plan.set(k, { family: 'paint', mul: shade(c.lum, anchor.lum) });
    } else if (clad && c.sat < CLAD_SAT && c.lum >= CLAD_LUM[0] && c.lum <= CLAD_LUM[1]) {
      plan.set(k, { family: 'clad', mul: shade(c.lum, clad.lum) });
    }
  }
  return { anchor, clad, plan };
}

/* ── formatting + the PASS/FAIL ledger, same shape tools/diag-carbody.mjs uses ─────────────── */
const linToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
const hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(linToSrgb(v) * 255))).toString(16).padStart(2, '0')).join('');

let total = 0;
let failures = 0;
const check = (ok, label, got, want) => {
  total++;
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${String(got).padStart(20)}   want ${want}`);
  return ok;
};

/* Float32 storage rounding only: paintCol/trimCol/mul are float64, `out` is a Float32Array, so
 * even an exactly-correct answer loses ~1e-7 of relative precision going in. 1e-5 is generous
 * against that and still four orders of magnitude tighter than the smallest real bug this test
 * is looking for (a wrong cluster, a wrong mul, a wrong family — all far bigger than 1e-5). */
const FLOAT_EPS = 1e-5;
const closeVec = (got, exp, eps = FLOAT_EPS) =>
  Math.abs(got[0] - exp[0]) <= eps && Math.abs(got[1] - exp[1]) <= eps && Math.abs(got[2] - exp[2]) <= eps;

/* ── the two real assets remapBakedBody's own header names ─────────────────────────────────── */
const CHIP_NAMES = ['paintA', 'paintB', 'paintC', 'paintD', 'paintE', 'paintF'];
const GLBS = [
  {
    url: new URL('../public/models/cars/synty-pickup.glb', import.meta.url),
    label: 'synty-pickup.glb',
    // Only the pickup's own header names cladding on BOTH sides of the belt as measured fact —
    // the convertible's cladding turns out to sit entirely below it (see stdout), which is a
    // property of that body's shape, not a defect, so this is not asserted on every GLB.
    requireCladBothSides: true,
  },
  {
    url: new URL('../public/models/cars/synty-convertible.glb', import.meta.url),
    label: 'synty-convertible.glb',
    requireCladBothSides: false,
  },
];

for (const { url, label, requireCladBothSides } of GLBS) {
  console.log(`\n══ ${label} ${'═'.repeat(Math.max(1, 64 - label.length))}`);
  const { geometry, pos, col, n, meshName } = loadBody(url, label);
  const { clusters, keyOf } = clusterOf(col, n);
  console.log(`  Body mesh '${meshName}', ${n} verts, ${clusters.size} baked colour clusters`);

  const built = buildPlan(clusters);
  if (!built) {
    check(false, `${label}: has a saturated (sat >= ${PAINT_SAT}) cluster to anchor paint on`, 'none found', 'at least one');
    continue; // nothing below is meaningful without a paint anchor
  }
  const { anchor, clad, plan } = built;
  console.log(
    `  anchor(paint) ${hex(anchor.r, anchor.g, anchor.b)}  n=${anchor.n}  sat=${anchor.sat.toFixed(3)}  lum=${anchor.lum.toFixed(3)}  hue=${anchor.h.toFixed(1)}°`
  );
  console.log(
    clad
      ? `  anchor(clad)  ${hex(clad.r, clad.g, clad.b)}  n=${clad.n}  sat=${clad.sat.toFixed(3)}  lum=${clad.lum.toFixed(3)}`
      : `  anchor(clad)  none — this body has no near-neutral mid-tone cluster in CLAD_LUM's window`
  );

  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1];
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  const yBelt = ymin + BELT * (ymax - ymin);
  console.log(`  belt y = ${yBelt.toFixed(3)}  (bbox y ${ymin.toFixed(3)} .. ${ymax.toFixed(3)}, ${(BELT * 100).toFixed(0)}% up)`);

  for (let chipIdx = 0; chipIdx < CHIP_NAMES.length; chipIdx++) {
    const paintCol = bodyPaintLinear(chipIdx);
    const trimCol = RGB.carTrim;
    console.log(`  ── chip ${chipIdx} ${CHIP_NAMES[chipIdx]}  ${hex(paintCol[0], paintCol[1], paintCol[2])} ──`);

    // The one and only call into the real function under test. Everything below checks its
    // actual return value; nothing below re-derives what the colour "should" look like from
    // scratch without comparing to this.
    const out = remapBakedBody(geometry, paintCol, trimCol);
    if (
      !check(
        out instanceof Float32Array && out.length === n * 3,
        '[setup] remapBakedBody returned a full-length Float32Array',
        out instanceof Float32Array ? out.length : String(out),
        `Float32Array(${n * 3})`
      )
    ) {
      continue; // a malformed/absent result makes every check below meaningless
    }

    /* (a) — the factory colour must not survive ANYWHERE in the output, not only in vertices
     * that started in the anchor cluster: a bug that left it untouched, or one that accidentally
     * repainted something else back to it, would both show up here. */
    const ONE_255 = 1 / 255;
    let survivors = 0;
    for (let i = 0; i < n; i++) {
      if (
        Math.abs(out[i * 3] - anchor.r) <= ONE_255 &&
        Math.abs(out[i * 3 + 1] - anchor.g) <= ONE_255 &&
        Math.abs(out[i * 3 + 2] - anchor.b) <= ONE_255
      )
        survivors++;
    }
    check(survivors === 0, '[a] factory-blue anchor colour survivors in output', survivors, '0');

    /* (b) — every paint-family vertex must equal paintCol scaled by ITS OWN cluster's ratio to
     * the anchor's luminance, clamped. Checked per vertex against the independently-built plan,
     * not against one single expected colour, because the paint family is not always exactly one
     * cluster (e.g. the pickup carries a tiny second cluster in its own shade of the same blue). */
    let paintTotal = 0;
    let paintBad = 0;
    let mulMin = Infinity;
    let mulMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = plan.get(keyOf[i]);
      if (!p || p.family !== 'paint') continue;
      paintTotal++;
      mulMin = Math.min(mulMin, p.mul);
      mulMax = Math.max(mulMax, p.mul);
      const exp = [paintCol[0] * p.mul, paintCol[1] * p.mul, paintCol[2] * p.mul];
      if (!closeVec([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]], exp)) paintBad++;
    }
    check(
      paintTotal > 0 && paintBad === 0,
      '[b1] paint-family verts == paintCol * mul',
      `${paintTotal - paintBad}/${paintTotal} ok`,
      `${paintTotal}/${paintTotal} ok`
    );
    check(
      paintTotal === 0 || (mulMin >= SHADE_CLAMP[0] - 1e-9 && mulMax <= SHADE_CLAMP[1] + 1e-9),
      '[b2] paint-family mul stays inside the shade clamp',
      paintTotal ? `${mulMin.toFixed(3)}..${mulMax.toFixed(3)}` : 'n/a',
      `within [${SHADE_CLAMP[0]}, ${SHADE_CLAMP[1]}]`
    );

    /* (c) — cladding splits at the belt: above it becomes paint, below it becomes RGB.carTrim,
     * each scaled by that cluster's own ratio to the CLADDING anchor (a different reference
     * luminance than paint uses). */
    let cladAbove = 0;
    let cladBelow = 0;
    let cladBad = 0;
    for (let i = 0; i < n; i++) {
      const p = plan.get(keyOf[i]);
      if (!p || p.family !== 'clad') continue;
      const below = pos[i * 3 + 1] < yBelt;
      if (below) cladBelow++;
      else cladAbove++;
      const src = below ? trimCol : paintCol;
      const exp = [src[0] * p.mul, src[1] * p.mul, src[2] * p.mul];
      if (!closeVec([out[i * 3], out[i * 3 + 1], out[i * 3 + 2]], exp)) cladBad++;
    }
    check(
      cladAbove + cladBelow === 0 || cladBad === 0,
      '[c1] cladding verts == (paint above belt / RGB.carTrim below) * mul',
      `${cladAbove + cladBelow - cladBad}/${cladAbove + cladBelow} ok`,
      `${cladAbove + cladBelow}/${cladAbove + cladBelow} ok`
    );
    if (requireCladBothSides) {
      check(cladAbove > 0, '[c2] cladding remapped to paint ABOVE the belt', cladAbove, '> 0');
      check(cladBelow > 0, '[c3] cladding remapped to RGB.carTrim BELOW the belt', cladBelow, '> 0');
    } else {
      console.log(`         (cladding above=${cladAbove}, below=${cladBelow} — >0-on-both-sides is only required on the pickup)`);
    }

    /* (d) — every OTHER cluster (tail-light bleed, tan interior, chrome, glass reflections baked
     * into the shell...) must come out of the array exactly as it went in. Not "close": these
     * are the same underlying Float32 values passed straight through with no arithmetic done to
     * them at all, so the only tolerance that belongs here is zero. */
    let untouchedClusters = 0;
    let untouchedVerts = 0;
    for (const [k, c] of clusters) {
      if (plan.has(k)) continue;
      untouchedClusters++;
      untouchedVerts += c.n;
    }
    let drift = 0;
    for (let i = 0; i < n; i++) {
      if (plan.has(keyOf[i])) continue;
      if (out[i * 3] !== col[i * 3] || out[i * 3 + 1] !== col[i * 3 + 1] || out[i * 3 + 2] !== col[i * 3 + 2]) drift++;
    }
    check(
      drift === 0,
      '[d] non-family clusters byte-identical to input',
      `${untouchedClusters} clusters / ${untouchedVerts} verts, drift ${drift}`,
      'drift 0'
    );

    /* (e) — the whole reason for a belt line: the shell should read as two tones, not a flat
     * repaint. Measured over the WHOLE output (every family, not only cladding), because that is
     * what a camera actually sees. */
    let sumAbove = 0;
    let cntAbove = 0;
    let sumBelow = 0;
    let cntBelow = 0;
    for (let i = 0; i < n; i++) {
      const l = lum709(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
      if (pos[i * 3 + 1] < yBelt) {
        sumBelow += l;
        cntBelow++;
      } else {
        sumAbove += l;
        cntAbove++;
      }
    }
    const meanAbove = cntAbove ? sumAbove / cntAbove : NaN;
    const meanBelow = cntBelow ? sumBelow / cntBelow : NaN;
    check(
      Number.isFinite(meanAbove) && Number.isFinite(meanBelow) && Math.abs(meanAbove - meanBelow) > 1e-6,
      '[e] two-tone survives: mean lum above belt != below',
      `${meanAbove.toFixed(4)} vs ${meanBelow.toFixed(4)}`,
      'different'
    );
  }
}

/* ── fail-safes: the two ways a body must be LEFT ALONE rather than guessed at ─────────────── */
console.log(`\n══ fail-safes ${'═'.repeat(50)}`);
{
  const paintCol = bodyPaintLinear(0);
  const trimCol = RGB.carTrim;

  /* (i) no colour attribute at all — the baked branch should never call this on a mesh that was
   * not itself baked with COLOR_0, and remapBakedBody must decline rather than guess. */
  const gNoColor = new BufferGeometry();
  gNoColor.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const rNoColor = remapBakedBody(gNoColor, paintCol, trimCol);
  check(rNoColor === null, '[fail-safe i] geometry with no color attribute -> null', String(rNoColor), 'null');

  /* (ii) every vertex the same neutral grey — sat=0 everywhere, so no cluster ever clears
   * PAINT_SAT and there is nothing to anchor on. This is the "not a Synty two-tone at all" case
   * remapBakedBody's own comment names as a fail-safe rather than a guess. */
  const GREY_N = 12;
  const posArr = new Float32Array(GREY_N * 3);
  const colArr = new Float32Array(GREY_N * 3);
  for (let i = 0; i < GREY_N; i++) {
    posArr[i * 3] = Math.cos(i);
    posArr[i * 3 + 1] = i * 0.1;
    posArr[i * 3 + 2] = Math.sin(i);
    colArr[i * 3] = colArr[i * 3 + 1] = colArr[i * 3 + 2] = 0.5;
  }
  const gGrey = new BufferGeometry();
  gGrey.setAttribute('position', new BufferAttribute(posArr, 3));
  gGrey.setAttribute('color', new BufferAttribute(colArr, 3));
  const rGrey = remapBakedBody(gGrey, paintCol, trimCol);
  check(rGrey === null, '[fail-safe ii] all-neutral-grey colours -> null', String(rGrey), 'null');
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${total - failures}/${total} assertions passed`);
process.exit(failures === 0 ? 0 : 1);
