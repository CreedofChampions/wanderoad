/* Wanderoad — a static gate on the water fragment shader, and the far-field curve it draws.
 *
 * TWO JOBS, and the first one exists because of a scar. A GLSL RESERVED WORD (`patch`) once
 * turned this entire game black while passing every static check its author ran, so shader
 * work in this project is supposed to be gated on a real GPU compile. This tool is NOT that
 * gate and does not pretend to be — it cannot link a program and it cannot catch a type
 * error. What it CAN do is catch the specific class of mistake that produced the black
 * screen (an identifier that GLSL ES 3.0 has taken for itself, or has reserved for later),
 * plus unbalanced braces and use-before-declaration of the symbols this pass introduced,
 * which between them cover the ways a template-string shader usually breaks. Anything it
 * says is PASS still has to be seen running.
 *
 * The second job is the one that matters to the report. The playtest verdict on the water
 * was: calm, flat, soft-shored, ships and sea sound all good — but "coarse diagonal streak
 * banding" and "a fine crosshatch shimmer band forming at mid-to-far distance ... in motion
 * it will crawl". This prints the exact far-field curve the shader now applies, at real
 * distances, so the claim "there is no high-frequency signal left past 300 m" is a number
 * and not an adjective.
 *
 *   node tools/diag-watershader.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { farFlatten, farAmpMultiplier, FAR_FLAT_NEAR, FAR_FLAT_FULL, ampMultiplier, gustMultiplier } from '../src/render/water.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'src', 'render', 'water.js'), 'utf8');

/* The fragment shader body, lifted out of the template literal. Read from the file rather
 * than imported because WATER_FS is module-private (and should stay that way — nothing in
 * the game has any business assembling it). */
const m = SRC.match(/const WATER_FS = \(axis\) => \/\* glsl \*\/ `([\s\S]*?)\n`;/);
if (!m) {
  console.error('FAIL  could not find WATER_FS in src/render/water.js — did its shape change?');
  process.exit(1);
}
// Substitute the JS interpolations with a placeholder number/token so the brace and word
// scans see something shaped like real GLSL.
const body = m[1].replace(/\$\{[^}]*\}/g, '0.5');
/* Comments stripped, for every check below. A shader's comments are prose about the shader
 * and routinely NAME the identifiers they explain — scanning them for "is this declared
 * before it is used" reports every well-commented variable as a failure, which is a check
 * that punishes the thing it is meant to encourage. Block comments first, then line ones. */
const code = body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/* ── 1. reserved words ────────────────────────────────────────────────────────
 * The GLSL ES 3.00 keyword and reserved-keyword lists (spec section 3.6), minus the ones a
 * shader legitimately uses as keywords. Anything here appearing as a DECLARED IDENTIFIER is
 * the `patch` bug again. */
const RESERVED = [
  'attribute', 'varying', 'common', 'partition', 'active', 'asm', 'class', 'union', 'enum',
  'typedef', 'template', 'this', 'goto', 'inline', 'noinline', 'volatile', 'public', 'static',
  'extern', 'external', 'interface', 'long', 'short', 'double', 'half', 'fixed', 'unsigned',
  'superp', 'input', 'output', 'hvec2', 'hvec3', 'hvec4', 'fvec2', 'fvec3', 'fvec4',
  'sampler3DRect', 'filter', 'image1D', 'image2D', 'image3D', 'imageCube', 'sizeof', 'cast',
  'namespace', 'using', 'patch', 'sample', 'subroutine', 'resource', 'noperspective',
  'coherent', 'restrict', 'readonly', 'writeonly', 'atomic_uint', 'row_major',
];

// Every `type name` declaration and every `name =` assignment target in the body.
const declared = new Set();
for (const d of code.matchAll(/\b(?:float|int|uint|bool|vec2|vec3|vec4|ivec2|ivec3|ivec4|mat2|mat3|mat4|void)\s+([A-Za-z_]\w*)/g)) {
  declared.add(d[1]);
}
const clashes = [...declared].filter((n) => RESERVED.includes(n));

/* ── 2. balance ───────────────────────────────────────────────────────────── */
const count = (ch) => (code.match(new RegExp(`\\${ch}`, 'g')) || []).length;
const braces = count('{') - count('}');
const parens = count('(') - count(')');

/* ── 3. the symbols this pass introduced, declared before every use ─────────── */
function declaredBeforeUse(name) {
  const decl = code.search(new RegExp(`\\bfloat\\s+${name}\\b`));
  if (decl < 0) return { ok: false, why: 'never declared' };
  const uses = [...code.matchAll(new RegExp(`\\b${name}\\b`, 'g'))].map((u) => u.index);
  const early = uses.filter((i) => i < decl);
  return { ok: early.length === 0, why: early.length ? `${early.length} use(s) before the declaration` : `declared at char ${decl}, ${uses.length - 1} use(s), all after` };
}
const farFlatOk = declaredBeforeUse('farFlat');
const nearWOk = declaredBeforeUse('nearW');

/* ── 4. every term that carried a per-pixel signal now takes the far-field gate ─
 * Named explicitly, because "I multiplied some things by it" is not a check. These are the
 * four the report's two artefacts came out of. */
const gated = {
  'the gust field (cat\'s-paw striping)': /float gust = gustAt[^;]*nearW;/.test(code),
  'the ripple normal amplitude': /amp \*= nearW;/.test(code),
  'the flow ribbons': /bandLimit\(fw, vec2\(0\.155, 1\.05\)\)\*nearW/.test(code),
  'the quantised sun glitter': /float glint =[^;]*nearW;/.test(code),
  'the normal flatten reaches fully flat': /max\(smoothstep\(70\.0, 430\.0, vDist\)\*0\.92, farFlat\)/.test(code),
};

/* ── the curve, in metres ──────────────────────────────────────────────────── */
console.log(`\nWanderoad — water far-field flattening (the moire fix)\n`);
console.log(`  fade window   ${FAR_FLAT_NEAR} m -> ${FAR_FLAT_FULL} m\n`);
console.log('    distance    flatten    ripple normal amplitude left');
for (const d of [0, 40, 90, 120, 150, 200, 250, 300, 400, 800, 2000]) {
  const f = farFlatten(d);
  console.log(`    ${String(d).padStart(6)} m    ${f.toFixed(3)}      ${(farAmpMultiplier(d) * 100).toFixed(1)}%`);
}
console.log(`\n  ...and how it stacks with the existing open-water calming, on a big lake (openness 1.0):`);
for (const d of [40, 150, 250, 300]) {
  const total = ampMultiplier(1.0) * farAmpMultiplier(d);
  console.log(`    ${String(d).padStart(6)} m    ripple amplitude ${(total * 100).toFixed(1)}% of a small-pond wave, gust ${(gustMultiplier(1.0) * (1 - farFlatten(d)) * 100).toFixed(1)}%`);
}

console.log('\n  every per-pixel term takes the far-field gate:');
for (const [name, ok] of Object.entries(gated)) console.log(`    ${ok ? 'yes' : 'NO '}  ${name}`);

const checks = [
  ['no GLSL ES reserved word is used as an identifier', clashes.length === 0, clashes.length ? clashes.join(', ') : `${declared.size} identifiers scanned`],
  ['braces balance', braces === 0, `${braces >= 0 ? '+' : ''}${braces}`],
  ['parentheses balance', parens === 0, `${parens >= 0 ? '+' : ''}${parens}`],
  ['farFlat is declared before every use', farFlatOk.ok, farFlatOk.why],
  ['nearW is declared before every use', nearWOk.ok, nearWOk.why],
  ['all four per-pixel terms are gated', Object.values(gated).every(Boolean), `${Object.values(gated).filter(Boolean).length} of ${Object.keys(gated).length}`],
  ['the surface is genuinely flat past the window', farAmpMultiplier(FAR_FLAT_FULL) === 0, `${(farAmpMultiplier(FAR_FLAT_FULL) * 100).toFixed(1)}% amplitude at ${FAR_FLAT_FULL} m`],
  ['foreground water is untouched', farFlatten(FAR_FLAT_NEAR) === 0 && farFlatten(0) === 0, `0% flattening inside ${FAR_FLAT_NEAR} m`],
  ['the fade is well under way by 200 m (the reported distance)', farFlatten(200) > 0.45, `${(farFlatten(200) * 100).toFixed(0)}% flattened at 200 m`],
];

console.log('');
let failed = 0;
for (const [name, ok, detail] of checks) {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`);
  if (!ok) failed++;
}
console.log(`
 NOTE  this is a STATIC gate. It cannot compile GLSL and it is not a substitute for seeing
       the water on a real GPU. The visual claim this pass makes — that the streak banding
       and the crosshatch shimmer are gone at (974, 2101) — is NOT proven by this tool and
       must be re-photographed at the same spot before it is believed.
`);
console.log(`${failed === 0 ? 'all static checks passed' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
