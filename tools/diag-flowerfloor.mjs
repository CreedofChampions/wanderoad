/* created by AI
 * Cozy Driver — a far flower is never allowed to go sub-pixel.
 *
 * B37: the operator saw white speckle crawling over far hillsides. Diagnosed while chasing the
 * grass-aliasing item, and the diagnosis was that grass has an angular WIDTH FLOOR and flowers had
 * none: at the 190 m cull a flower subtends about 0.6 px on a 720 px viewport. A sub-pixel white
 * petal against green does not fade — it flickers on and off as the sample point crosses it, which
 * is exactly what "sparkle" looks like.
 *
 * The fix is the rule grass already uses, applied to the flower's scale, and these checks are
 * about the two ways that rule goes wrong after it is written: it stops being applied (nobody
 * calls setAngular, so the floor sits at 0 and everything looks like it did), and it starts being
 * applied to things it should not touch (a flower two metres away should be its own size, not the
 * floor's).
 *
 * The arithmetic is checked here; how it LOOKS was measured on the live beta, where the same
 * formula takes a flower from 0.20 / 0.16 / 0.14 px at 130 / 160 / 190 m to 1.50 px at all three.
 *
 *   node tools/diag-flowerfloor.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nCOZY DRIVER — THE FLOWER SIZE FLOOR\n' + '-'.repeat(72));

const flowers = read('src/render/flowers.js');
const main = read('src/main.js');

/* ── the rule is in the shader, and it is a floor rather than a replacement ── */
check(
  'the flower shader carries an angular floor uniform',
  /uniform float uPixFloor;/.test(flowers),
  'uPixFloor declared',
);
check(
  'and applies it as a MAX, so a flower near the camera keeps its own size',
  /sc = max\(sc, dist \* uPixFloor \/ FLOWER_REF_W\);/.test(flowers),
  'max against the fade result, not instead of it',
);
check(
  'the reference width it divides by is the width the geometry is built at',
  /const float FLOWER_REF_W = 0\.12;/.test(flowers),
  '0.12 m — a flower head, metre scale',
);

/* ── it is actually switched on, by the same number grass gets ─────────────── */
check(
  'Flowers exposes setAngular, the way Grass does',
  /setAngular\(angPerPx, px = 1\.5\)/.test(flowers),
  '1.5 px, not 1.0 — a white petal on green twinkles before it is technically sub-pixel',
);
{
  const grassCalls = [...main.matchAll(/grass\.setAngular\(\(camera\.fov \* DEG\) \/ innerHeight\)/g)].length;
  const flowerCalls = [...main.matchAll(/flowers\?\.setAngular\?\.\(\(camera\.fov \* DEG\) \/ innerHeight\)/g)].length;
  check(
    'main.js hands the flowers the SAME number it hands the grass, everywhere it hands it',
    flowerCalls === grassCalls && grassCalls >= 2,
    `${grassCalls} grass calls, ${flowerCalls} flower calls — boot and resize`,
  );
}
check(
  'the uniform object is SHARED with the materials, so one write reaches all three',
  /uPixFloor: pixFloor \?\? \{ value: 0 \}/.test(flowers) && /flowerMaterial\(kind, this\._ring, this\._pixFloor\)/.test(flowers),
  'passed by reference, like the ring vector beside it',
);
check(
  'and it defaults to 0 — a build that forgets to call setAngular looks exactly as it always did',
  /this\._pixFloor = \{ value: 0 \};/.test(flowers),
  'no floor until someone sets one',
);

/* ── the arithmetic itself ─────────────────────────────────────────────────── */
{
  /* The shader's own two lines, in JS, at the viewport the operator plays at. `iPos.w` is the
   * per-plant scale; 1.0 is the nominal one. */
  const REF_W = 0.12;
  const px = (65 * (Math.PI / 180)) / 720; // 65 deg fov, 720 px tall
  const floor = px * 1.5;
  const widthPx = (d, sc) => (sc * REF_W) / (d * px);
  const before = (d) => widthPx(d, 1.0 * (0.4 + 0.6 * (1 - Math.min(1, Math.max(0, (d - 130) / (190 - 130))))));
  const after = (d) => widthPx(d, Math.max(1.0 * (0.4 + 0.6 * (1 - Math.min(1, Math.max(0, (d - 130) / (190 - 130))))), (d * floor) / REF_W));
  for (const d of [130, 160, 190])
    console.log(`       ${d} m: ${before(d).toFixed(2)} px  ->  ${after(d).toFixed(2)} px`);
  check('every distance in the speckle band clears one pixel afterwards', [130, 160, 190].every((d) => after(d) >= 1.0), 'the band the operator reported, 130-190 m');
  check('and at least one of them was under a pixel before', [130, 160, 190].some((d) => before(d) < 1.0), 'so the floor is doing something');
  check(
    'a flower at two metres is untouched — the floor bites only where things sparkle',
    Math.abs(after(2) - before(2)) < 1e-9,
    `${before(2).toFixed(1)} px both ways`,
  );
}

console.log(`\n${failed ? `${failed} FLOWER-FLOOR CHECK(S) FAILED` : 'all flower-floor checks passed'}\n`);
process.exit(failed ? 1 : 0);
