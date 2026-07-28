// created by AI
/* Wanderoad — does the car button's video capture and URL-building actually work?
 *
 * extension/dock.js is a classic (non-module) Chrome content script: it has no `export`
 * (adding one would be a SyntaxError the moment Chrome tried to run it) and its top level
 * calls `chrome.storage`, `MutationObserver` and `boot()`, none of which exist in node. So it
 * cannot be `import`ed here the way src/ui/musicPanel.js can (see diag-video-param.mjs).
 *
 * THE LOGIC IS DUPLICATED, DELIBERATELY, AND HERE IS THE RULE FOR KEEPING IT HONEST — the same
 * rule tools/diag-manual-streak.mjs already states for its own duplicated control law: this
 * mirrors extension/dock.js's `currentVideoRequest()` and `frameSrc()` (search for those names
 * there) line for line. Change one, change the other, and re-run this.
 *
 *   node tools/diag-dock-video.mjs
 */

const VIDEO_ID_RE = /^[\w-]{11}$/;
const LIST_ID_RE = /^[\w-]{10,64}$/;

// Mirrors extension/dock.js currentVideoRequest().
function currentVideoRequest(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
  let id = url.searchParams.get('v');
  if (!id) {
    const m = /\/(?:shorts|live)\/([\w-]{11})/.exec(url.pathname);
    if (m) id = m[1];
  }
  if (!id || !VIDEO_ID_RE.test(id)) return null;
  const listRaw = url.searchParams.get('list');
  const list = listRaw && LIST_ID_RE.test(listRaw) ? listRaw : null;
  const indexRaw = url.searchParams.get('index');
  const index = list && indexRaw && /^\d{1,4}$/.test(indexRaw) ? indexRaw : null;
  return { id, list, index };
}

// Mirrors extension/dock.js frameSrc(), with getURL stubbed the way chrome.runtime.getURL
// behaves: the extension's own origin plus the given relative path.
function frameSrc(video, getURL = (p) => `chrome-extension://test/${p}`) {
  const p = new URLSearchParams();
  p.set('offline', '');
  p.set('car', 'estate');
  p.set('terrain', 'meadow');
  if (video) {
    p.set('video', video.id);
    if (video.list) p.set('list', video.list);
    if (video.index) p.set('index', video.index);
  }
  return `${getURL('game/index.html')}?${p.toString()}`;
}

let fails = 0;
function check(label, cond) {
  if (cond) console.log(`ok   ${label}`);
  else {
    fails++;
    console.log(`FAIL ${label}`);
  }
}

/* ── capturing the id off a real watch-page URL ─────────────────────────────────────────── */
{
  const req = currentVideoRequest('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
  check('plain watch URL -> id captured', req && req.id === 'dQw4w9WgXcQ');
  check('no list on that URL -> list null', req && req.list === null);
}
{
  const req = currentVideoRequest(
    'https://www.youtube.com/watch?v=blQN5oEaXq4&list=PL0YXg_RQHLsM0bK7elp9gyOcGKhVveWoM&index=13'
  );
  check('watch URL with a playlist -> id + list + index all captured', req && req.id === 'blQN5oEaXq4' && req.list && req.index === '13');
}
{
  const req = currentVideoRequest('https://www.youtube.com/shorts/dQw4w9WgXcQ');
  check('a Shorts URL -> id captured from the path', req && req.id === 'dQw4w9WgXcQ');
}
{
  const req = currentVideoRequest('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share');
  check('a live URL -> id captured from the path', req && req.id === 'dQw4w9WgXcQ');
}
{
  check('a channel page (no id anywhere) -> null, no throw', currentVideoRequest('https://www.youtube.com/@somechannel') === null);
  check('a non-YouTube page -> null even with a matching-shaped param', currentVideoRequest('https://example.com/watch?v=dQw4w9WgXcQ') === null);
  check('garbage input -> null, never throws', currentVideoRequest('not a url at all') === null);
}

/* ── the id becomes the right iframe src for the game ───────────────────────────────────── */
{
  const src = frameSrc({ id: 'dQw4w9WgXcQ', list: null, index: null });
  check('frameSrc still carries the three defaults every dock load has always had', src.includes('offline=') && src.includes('car=estate') && src.includes('terrain=meadow'));
  check('frameSrc carries the captured video', src.includes('video=dQw4w9WgXcQ'));
  check('frameSrc points at game/index.html', src.startsWith('chrome-extension://test/game/index.html?'));
}
{
  const src = frameSrc(null);
  check('no video captured -> no video= param at all (unchanged from before this feature)', !src.includes('video='));
}
{
  const src = frameSrc({ id: 'blQN5oEaXq4', list: 'PL0YXg_RQHLsM0bK7elp9gyOcGKhVveWoM', index: '13' });
  check('frameSrc carries list + index alongside the video', src.includes('list=PL0YXg_RQHLsM0bK7elp9gyOcGKhVveWoM') && src.includes('index=13'));
}

console.log(fails === 0 ? '\nPASS — the car button captures a video id and builds the right game URL' : `\n${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
