// created by AI
/* Wanderoad — does the game panel actually accept a video handed in from outside?
 *
 * WHY THIS EXISTS. The Chrome extension's car button (extension/dock.js, on YouTube pages
 * only, opt-in) is not importable here — it lives on a real youtube.com DOM and talks to the
 * `chrome` extension APIs, neither of which node has. What IS importable, with no browser at
 * all, is src/ui/musicPanel.js's own two pure functions: `parseVideoRequest` (what does
 * `?video=`/`&list=`/`&index=` on the game's URL ask for) and `embedSrcForRequest` (the exact
 * embed URL built from that). Those are the only two things standing between "the dock passed
 * a video id through" and "the J-window plays it" — proving them here is proving the panel's
 * half of the hand-off honestly, without faking a DOM it does not need.
 *
 *   node tools/diag-video-param.mjs
 */

import { parseVideoRequest, embedSrcForRequest, MUSIC_EMBED_SRC } from '../src/ui/musicPanel.js';

let fails = 0;
function check(label, cond) {
  if (cond) {
    console.log(`ok   ${label}`);
  } else {
    fails++;
    console.log(`FAIL ${label}`);
  }
}

/* ── a plain video id, the common case from a watch page's ?v= ─────────────────────────── */
{
  const req = parseVideoRequest('?offline&car=estate&terrain=meadow&video=dQw4w9WgXcQ');
  check('bare video id parses', req && req.id === 'dQw4w9WgXcQ');
  check('no list -> list null', req && req.list === null);
  check('no list -> index null even if absent', req && req.index === null);
  const src = embedSrcForRequest(req);
  check('embed src points at the right video', src.startsWith('https://www.youtube.com/embed/dQw4w9WgXcQ?'));
  check('embed src carries no list= when none was asked for', !src.includes('list='));
  check('embed src is muted, autoplay, playsinline, enablejsapi — same contract as MUSIC_EMBED_SRC', [
    'enablejsapi=1', 'autoplay=1', 'mute=1', 'playsinline=1',
  ].every((p) => src.includes(p)));
}

/* ── a watch-page URL that also carried a playlist and a start index ───────────────────── */
{
  const search = '?video=blQN5oEaXq4&list=PL0YXg_RQHLsM0bK7elp9gyOcGKhVveWoM&index=7';
  const req = parseVideoRequest(search);
  check('video id parses alongside a list', req && req.id === 'blQN5oEaXq4');
  check('list parses', req && req.list === 'PL0YXg_RQHLsM0bK7elp9gyOcGKhVveWoM');
  check('index parses', req && req.index === '7');
  const src = embedSrcForRequest(req);
  check('embed src carries the list', src.includes('list=PL0YXg_RQHLsM0bK7elp9gyOcGKhVveWoM'));
  check('embed src carries the index', src.includes('&index=7'));
}

/* ── an index with no list names nothing, so it is dropped rather than sent on its own ─── */
{
  const req = parseVideoRequest('?video=blQN5oEaXq4&index=7');
  check('index without a list is discarded', req && req.index === null);
}

/* ── garbage and absence must both come back null, never throw, never half-parse ───────── */
{
  check('too-short id -> null', parseVideoRequest('?video=short') === null);
  check('too-long id -> null', parseVideoRequest('?video=' + 'x'.repeat(12)) === null);
  check('no video param at all -> null', parseVideoRequest('?offline&car=estate') === null);
  check('empty search -> null', parseVideoRequest('') === null);
  check('undefined search -> null, not a throw', parseVideoRequest(undefined) === null);
  // A query string value can carry characters outside [\w-] once decoded; the regex must
  // reject rather than accept a wider alphabet that YouTube ids never actually use.
  check('id with a space -> null', parseVideoRequest('?video=abc def ghij') === null);
}

/* ── absent request must fall back to the operator's own playlist, unchanged ───────────── */
{
  check(
    'MUSIC_EMBED_SRC (the default playlist) is untouched by this feature',
    MUSIC_EMBED_SRC.includes('blQN5oEaXq4') && MUSIC_EMBED_SRC.includes('enablejsapi=1')
  );
}

console.log(fails === 0 ? '\nPASS — panel accepts ?video= and builds the right embed URL' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
