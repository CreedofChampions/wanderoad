/* created by AI
 * Cozy Driver — what the side panel's search box does with the words you type.
 *
 * extension/panel.js is a URL BUILDER, not a search client, and docs/EXTENSION.md commits us to
 * keeping it one: never scrape, never read video data, never call a YouTube API. The two exported
 * functions are the whole of that promise, and they export precisely so this can be checked in
 * node with no browser — which is why this file exists beside tools/diag-extension.mjs rather than
 * inside it. The browser tool proves the panel loads; this one proves what it does with a link.
 *
 * The rule it encodes, from panel.js's own header: a LINK gets embedded here (youtube.com's own
 * public /embed/ endpoint, the same move any site with a video on it makes), WORDS get handed to
 * youtube.com's own results page in a new tab. Nothing in between, and nothing read back.
 *
 *   node tools/diag-panel-urls.mjs
 */
const { watchTarget, searchUrl } = await import('../extension/panel.js');

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nCOZY DRIVER — THE PANEL SEARCH BOX IS A URL BUILDER\n' + '-'.repeat(72));

/* ── a link is recognised, whatever shape it arrives in ─────────────────────── */
const LINKS = [
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['http://youtube.com/watch?v=dQw4w9WgXcQ&t=42', 'dQw4w9WgXcQ'],
  ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['  https://youtu.be/dQw4w9WgXcQ?si=abc  ', 'dQw4w9WgXcQ'],
];
/* `watchTarget` returns { kind, src } rather than a bare string — `kind` is what the panel uses
 * to say whether it embedded a video or a playlist, so both halves are asserted. */
for (const [text, id] of LINKS) {
  const t = watchTarget(text);
  check(
    `a link is turned into an embed, not a search: ${text.trim().slice(0, 44)}`,
    !!t && t.kind === 'video' && typeof t.src === 'string' && t.src.includes(`/embed/${id}`) && t.src.startsWith('https://www.youtube'),
    t ? `${t.kind} ${t.src}` : String(t),
  );
}

/* A playlist link with no video in it embeds the LIST, which is the other half of the same rule. */
{
  const t = watchTarget('https://www.youtube.com/playlist?list=PL1234567890abcdefg');
  check(
    'a playlist link embeds the playlist rather than falling through to a search',
    !!t && t.kind === 'list' && t.src.includes('videoseries') && t.src.includes('list=PL1234567890abcdefg'),
    t ? `${t.kind} ${t.src}` : String(t),
  );
}

/* ── words are NOT ─────────────────────────────────────────────────────────── */
for (const words of ['lofi beats', 'how to change a tyre', 'dQw4w9WgXcQ is a video', '']) {
  const t = watchTarget(words);
  check(`words are not mistaken for a link: "${words}"`, !t, String(t));
}

/* ── and words go to YouTube's own results page, with nothing added ─────────── */
{
  const u = searchUrl('lofi beats');
  let parsed = null;
  try {
    parsed = new URL(u);
  } catch {
    /* an unparseable URL fails the checks below on its own */
  }
  check('words build a link to youtube.com’s own results page', !!parsed && /(^|\.)youtube\.com$/.test(parsed.host) && parsed.pathname === '/results', u);
  check('the words are passed as the query and nothing else is added', !!parsed && parsed.searchParams.get('search_query') === 'lofi beats' && [...parsed.searchParams.keys()].length === 1, parsed ? [...parsed.searchParams.keys()].join(',') : '(unparsed)');
  check('and they are escaped, so a query cannot smuggle parameters', /%26|&amp;|%3D/.test(searchUrl('a&b=c')) || !searchUrl('a&b=c').includes('&b='), searchUrl('a&b=c'));
}

/* ── the promise itself: no network call anywhere in the file ──────────────── */
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../extension/panel.js', import.meta.url), 'utf8');
  /* Comments in this file discuss fetch and the API at length — deliberately, since the reason
   * they are absent is the point. So the scan strips comments before looking, or it would fail on
   * its own documentation. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [what, re] of [
    ['fetch(', /\bfetch\s*\(/],
    ['XMLHttpRequest', /XMLHttpRequest/],
    ['googleapis', /googleapis\.com/],
    ['an API key', /AIza[0-9A-Za-z_-]{10}/],
  ])
    check(`no ${what} in extension/panel.js — it never asks YouTube anything`, !re.test(code));
}

console.log(`\n${failed ? `${failed} PANEL URL CHECK(S) FAILED` : 'all panel URL checks passed'}\n`);
process.exit(failed ? 1 : 0);
