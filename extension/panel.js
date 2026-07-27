/* Wanderoad — the search box in the side panel's watch half.
 *
 * WHAT THIS FILE IS ALLOWED TO DO, and the reason the whole file is this short:
 *
 *   docs/EXTENSION.md commits us to never scraping, never reading video data, and never
 *   calling a YouTube API. So this is not a search client. It is a URL builder. It takes the
 *   text the player typed, works out — with string parsing and nothing else, no network call
 *   of any kind — whether that text already names something to watch, and then either points
 *   our own iframe at youtube.com's own public embed endpoint, or hands the words to
 *   youtube.com's own results page in a new tab and forgets about them.
 *
 *   It never sees a result, a title, a duration, a thumbnail, a channel or a recommendation.
 *   There is no request from this extension to youtube.com anywhere in this file: the only
 *   fetching that happens is the browser loading an <iframe src>, which is the same thing that
 *   happens on any site with a video embedded in it, and it is done by the browser on the
 *   player's instruction, not by us on their behalf.
 *
 * WHY WORDS OPEN A TAB INSTEAD OF FILLING THE FRAME. YouTube serves /results and /watch with
 * frame-ancestors set, so they cannot be embedded — only /embed/ can. The IFrame API used to
 * expose `listType=search&list=<query>`, which would have filled the frame with results
 * directly, but it was deprecated in November 2020 and no longer works; wiring the box to it
 * would look like a broken panel rather than a search. Reading the results ourselves and
 * building our own list is exactly the scraping we are not going to do. So the honest split
 * is: a LINK gets embedded here, WORDS get handed to YouTube's own search page. One box, and
 * it tells you which it did.
 *
 * An ES module (panel.html loads it with type="module") for one reason beyond tidiness: the
 * two pure functions below export, so they can be checked from node without a browser — the
 * DOM wiring at the bottom is behind a `document` guard so importing this file outside a page
 * is a no-op rather than a crash.
 */

/** Where an embed lives. `playsinline` keeps it in this panel instead of hijacking a native
 *  fullscreen player; muted autoplay is the only autoplay every browser allows without a prior
 *  interaction with that video, so it genuinely starts playing and one click unmutes it. Same
 *  three params, for the same reasons, as src/ui/musicPanel.js's MUSIC_EMBED_SRC. */
const embed = (path, extra = '') =>
  `https://www.youtube.com/embed/${path}?playsinline=1&autoplay=1&mute=1&rel=0${extra}`;

/* An id is 11 characters of the URL-safe alphabet; a list id is longer. Both are matched
 * against the TEXT the player typed — no page is loaded to find out. */
const ID = String.raw`([\w-]{11})`;
const VIDEO_PATTERNS = [
  new RegExp(String.raw`youtu\.be/` + ID, 'i'),
  new RegExp(String.raw`youtube\.com/(?:watch\?\S*?\bv=|embed/|shorts/|live/|v/)` + ID, 'i'),
  new RegExp(String.raw`^\s*` + ID + String.raw`\s*$`), // a bare id, pasted on its own
];
const LIST_PATTERN = /[?&]list=([\w-]{12,})/i;

/**
 * What the player's text names, if anything. Pure string work.
 * @param {string} text
 * @returns {{kind:'video'|'list', src:string}|null} null means "these are search words"
 */
export function watchTarget(text) {
  const list = LIST_PATTERN.exec(text);
  for (const re of VIDEO_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      // A watch URL that also carries a playlist keeps the playlist, so "play my mix from
      // here" survives the paste. `index` is deliberately not carried: the video id already
      // says where to start, and two ways of saying it can disagree.
      return { kind: 'video', src: embed(m[1], list ? `&list=${list[1]}` : '') };
    }
  }
  if (list) return { kind: 'list', src: embed('videoseries', `&list=${list[1]}`) };
  return null;
}

/** YouTube's own results page, with the words exactly as typed. No key, no API, nothing read
 *  back — this URL is navigated to in a new tab and then forgotten about. */
export function searchUrl(text) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(text)}`;
}

/* ── the page ─────────────────────────────────────────────────────────────
 * Guarded so `import`ing this module without a DOM (a node check) does nothing at all. */
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const split = $('split');
  const stage = $('stage');
  const hint = $('hint');
  const q = $('q');

  /* Built once, then only ever re-`src`ed — so searching again does not tear the player down
   * and rebuild it, and the game half never reflows around it. And built on FIRST USE, not at
   * load: an install whose search box is never touched sends no request to youtube.com at all.
   * Same lazy-load reasoning as src/ui/musicPanel.js. */
  let frame = null;
  const play = (src) => {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'video';
      frame.allow =
        'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      frame.allowFullscreen = true;
      stage.appendChild(frame);
    }
    frame.src = src;
    stage.classList.add('playing');
    split.classList.remove('solo');
  };

  $('bar').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;

    const found = watchTarget(text);
    if (found) {
      play(found.src);
      q.blur(); // hand the keyboard straight back to the road
      return;
    }

    // Words, not a link. Plain navigation, in its own tab. `noreferrer` because which panel
    // they typed it in is nobody's business.
    window.open(searchUrl(text), '_blank', 'noreferrer');
    stage.classList.remove('playing');
    hint.textContent =
      `Searching for “${text}” in a new tab. Copy the link of whatever you like the look of ` +
      `and paste it back in the box — it will play in this half.`;
  });

  /* Folding the watch half away gives the game the whole panel; unfolding puts the 50/50 back.
   * The button's label lives in panel.html's stylesheet (::after on #fold), so there is one
   * source of truth for which word it shows in which state. */
  $('fold').addEventListener('click', () => split.classList.toggle('solo'));
}
