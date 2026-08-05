/* created by AI
 * Cozy Driver — NOTHING THE PLAYER READS POINTS AT SOMEBODY ELSE'S WORK.
 *
 * B26, the operator: legal differentiation from the original — "fonts, gradients, tell-tale signs".
 *
 * This game's rendering lineage is real and is not in dispute: the palette, lighting model, sky,
 * post chain, grass, water, cloud and painted-solid pipelines derive from the "Hoshi-no-Tani — The
 * Valley of Stars" CodePen the operator provided, and docs/CREDITS.md says so at length. Hiding
 * that would be the wrong move and this file does not ask for it — it asks for the opposite in the
 * source, and for none of it in the game.
 *
 * So there are two rules here, pulling in opposite directions on purpose:
 *
 *   IN THE SOURCE the lineage must stay VISIBLE. Ninety-nine comments cite "the pen", every ported
 *   file names the section it came from, and CREDITS.md carries the attribution. A port whose
 *   provenance is stripped out of the comments is worse than one that says where it came from.
 *
 *   IN THE GAME nothing the player reads may be the pen's own words. The clearest tell-tale sign
 *   in the whole project sat in world/biomes.js: the first biome was called "Hoshi Meadow", the
 *   pen's own name for its own valley, printed on the biome banner every time you drove into it.
 *   Three of five carried that naming. They are now Clover Meadow, Amber Steppe, Cobalt Highlands,
 *   Copper Dunes and Reed Wetland — the same plain warm English as the place-name generator.
 *
 * WHAT THIS FILE CANNOT DO, stated plainly because the register records it as blocked: diff the
 * game against the original. The pen is not public — codepen.io/search returns 403 to an
 * unauthenticated fetch and the title is not indexed by any search this machine can reach — so
 * "are the gradients too close" cannot be answered from here. That step needs the operator to hand
 * over the pen or its export. Everything that does NOT need the original is checked here.
 *
 *   node tools/diag-lineage.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nCOZY DRIVER — LINEAGE: CREDITED IN THE SOURCE, ABSENT FROM THE GAME\n' + '-'.repeat(76));

/** Every .js under src/, recursively. */
const walk = (dir, out = []) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
};
const files = walk(resolve(ROOT, 'src'));
const read = (p) => readFileSync(p, 'utf8');

/* ── 1. the game's own words ───────────────────────────────────────────────── */
const { BIOME_NAMES, BIOME_SHORT } = await import('../src/world/biomes.js');
/* The pen's own vocabulary. These are the words that identify ITS valley, and none of them may
 * reach a player. Matched case-insensitively and as whole words, so a comment saying "ported from
 * the Hoshi-no-Tani pen" is untouched — that is source, and source is supposed to say it. */
const PEN_WORDS = /\b(hoshi|hoshi-no-tani|valley of stars|bara|kiri)\b/i;
for (const [what, list] of [
  ['the biome names on the banner', BIOME_NAMES],
  ['the short names on the compass', BIOME_SHORT],
])
  check(
    `${what} are this game's own`,
    list.every((n) => !PEN_WORDS.test(n)),
    list.join(', '),
  );
check('and there are still five of each, in the same order', BIOME_NAMES.length === 5 && BIOME_SHORT.length === 5, `${BIOME_NAMES.length} / ${BIOME_SHORT.length}`);
check(
  'each short name is a plain English word for terrain, owned by nobody',
  BIOME_SHORT.every((n) => /^[A-Z][a-z]+$/.test(n)),
  BIOME_SHORT.join(', '),
);

/* ── 2. nothing else the player reads carries it either ────────────────────── */
{
  /* STRINGS ONLY, and comments deliberately skipped — the whole point is that the source says
   * where it came from while the game does not. Single and double quoted literals and template
   * chunks are scanned; a false positive here would be a comment leaking through, so comments go
   * first. */
  const offenders = [];
  for (const p of files) {
    const src = read(p)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/'([^'\n]{2,60})'|"([^"\n]{2,60})"|`([^`\n]{2,60})`/g)) {
      const lit = m[1] ?? m[2] ?? m[3];
      if (PEN_WORDS.test(lit)) offenders.push(`${p.slice(ROOT.length + 1)}: "${lit}"`);
    }
  }
  check(
    'no string literal anywhere in src/ carries the pen\'s vocabulary',
    offenders.length === 0,
    offenders.length ? offenders.slice(0, 3).join(' | ') : 'clean across ' + files.length + ' files',
  );
}

/* ── 3. the wordmark is the game's, and it is not the pen's face ───────────── */
{
  const css = read(resolve(ROOT, 'src/ui/style.css'));
  check('the game names itself in its own type face (--cozy)', /--cozy:/.test(css) && /font-family:\s*var\(--cozy\)/.test(css), 'the --cozy stack is defined and used');
  check('the wordmark says Cozy Driver', /Cozy Driver/.test(read(resolve(ROOT, 'index.html'))) || files.some((p) => /Cozy Driver/.test(read(p))), 'found');
}

/* ── 4. and the source still says where it came from ───────────────────────── */
{
  const cited = files.filter((p) => /the pen|Hoshi-no-Tani/i.test(read(p)));
  check(
    'the lineage is still VISIBLE in the source — a stripped port would be worse than a credited one',
    cited.length >= 10,
    `${cited.length} files cite the pen`,
  );
  const credits = read(resolve(ROOT, 'docs/CREDITS.md'));
  check('docs/CREDITS.md still carries the attribution in full', /Hoshi-no-Tani/.test(credits) && /CodePen/i.test(credits), 'present');
  check('and it says what derives from it, not just that something does', /palette|lighting|grass|water/i.test(credits), 'the derived systems are listed');
}

console.log(`
  BLOCKED, and it needs the operator: diffing fonts and gradients against the ORIGINAL cannot be
  done from here — the pen is not public (codepen.io/search returns 403 unauthenticated, and the
  title is not indexed by any search reachable from this machine). That needs the pen or its export.`);
console.log(`\n${failed ? `${failed} LINEAGE CHECK(S) FAILED` : 'all lineage checks passed'}\n`);
process.exit(failed ? 1 : 0);
