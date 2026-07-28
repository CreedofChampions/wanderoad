// created by AI
/* Wanderoad — the music window.
 *
 * The operator asked for their own playlist "linked in" as a window inside the game rather
 * than a separate tab: https://www.youtube.com/watch?v=blQN5oEaXq4&list=...&index=13. This is
 * chrome around that link, not a media player this project built — the iframe below points
 * straight at youtube.com's own embed endpoint, exactly the way any third-party site embeds a
 * video. No video or audio file is ever downloaded, proxied or bundled (see docs/CREDITS.md's
 * reasoning on why the props and audio elsewhere in this game are code, not files — an iframe
 * embed is the equivalent move here: zero media files, zero licence to audit).
 *
 * AUTOPLAY, HONESTLY: browsers block autoplay WITH SOUND unless the visitor has already
 * interacted with that content. Muted autoplay is the one thing every browser allows
 * unconditionally, so the embed starts muted the instant the panel first opens — it is
 * genuinely playing, not just sitting cued — and one click on the player's own unmute control
 * (a direct interaction with that video) is what a browser will actually honour with sound.
 * Nothing here claims silent-autoplay-with-sound works, because it does not, anywhere.
 *
 * FOCUS: opening the panel never calls .focus() on anything, so WASD keeps driving the instant
 * it appears. The one thing this file cannot override is that the iframe is a cross-origin
 * document — if the player clicks INTO the video to use YouTube's own play/volume controls,
 * keyboard focus moves into that frame the same way it would for any embedded video on any
 * site, and top-level key listeners (this game's driving controls included) stop seeing
 * keystrokes until focus returns to the page. That is a standard browser property of iframes,
 * not something this panel silently does — and the close button below is a mouse target that
 * always works to get out of it, no keyboard required.
 */

const VIDEO_ID = 'blQN5oEaXq4';
const PLAYLIST_ID = 'PL0YXg_RQHLsM0bK7elp9gyOcGKhVveWoM';
const START_INDEX = 13;

// Exactly the standard embed the operator's URL implies, plus three playback params: muted
// autoplay (the only autoplay every browser allows), playsinline (so iOS Safari plays inside
// this panel instead of hijacking the native fullscreen player — "in window" is the ask), and
// enablejsapi (already specified) for a future volume/play control if this is ever extended.
export const MUSIC_EMBED_SRC =
  `https://www.youtube.com/embed/${VIDEO_ID}` +
  `?list=${PLAYLIST_ID}&index=${START_INDEX}` +
  `&enablejsapi=1&autoplay=1&mute=1&playsinline=1`;

/* ── handing a specific video in from outside the game ─────────────────────
 *
 * The car button next to Subscribe (extension/dock.js) captures the id of whatever the
 * player is already watching on YouTube and hands it to the game as a `?video=` query param
 * on the SAME game/index.html the dock and side panel already load — see docs/EXTENSION.md
 * for why the game is bundled rather than framed, and extension/dock.js's own header for why
 * that file never reads or sends anything else. This module owns turning that one param into
 * an embed, so the parsing lives beside the thing it feeds rather than being duplicated in the
 * extension code that only ever needs to pass the id through unread.
 *
 * Two pure functions, exported so a node harness can prove the parsing and the URL it builds
 * without a browser (the same pattern extension/panel.js already uses for `watchTarget` /
 * `searchUrl`) — see tools/diag-video-param.mjs. */

const VIDEO_ID_RE = /^[\w-]{11}$/;
const LIST_ID_RE = /^[\w-]{10,64}$/;
const INDEX_RE = /^\d{1,4}$/;

/**
 * What `?video=`/`&list=`/`&index=` on the game's own URL ask for, if anything valid.
 * @param {string} search e.g. `location.search`
 * @returns {{id:string,list:string|null,index:string|null}|null} null means "nothing asked"
 */
export function parseVideoRequest(search) {
  const p = new URLSearchParams(search || '');
  const id = p.get('video');
  if (!id || !VIDEO_ID_RE.test(id)) return null;
  const listRaw = p.get('list');
  const list = listRaw && LIST_ID_RE.test(listRaw) ? listRaw : null;
  const indexRaw = p.get('index');
  const index = indexRaw && INDEX_RE.test(indexRaw) ? indexRaw : null;
  return { id, list, index: list ? index : null }; // an index with no list names nothing
}

/** The embed URL for a parsed request — same three playback params as MUSIC_EMBED_SRC, for
 *  the same reasons (muted autoplay, playsinline, enablejsapi). */
export function embedSrcForRequest(req) {
  const listPart = req.list ? `&list=${req.list}${req.index ? `&index=${req.index}` : ''}` : '';
  return (
    `https://www.youtube.com/embed/${req.id}?enablejsapi=1&autoplay=1&mute=1&playsinline=1` +
    listPart
  );
}

// J — jukebox. Checked against src/car/input.js's KEYMAP and src/ui/menu.js's ESC list before
// picking it: W A S D / arrows, Space, E, Q, C, R, T, B, V, N, G, H, Shift (L/R), Ctrl (L),
// Escape and M are all already bound. J is untouched by either.
const TOGGLE_KEY = 'KeyJ';

// Large-window sizing for a video handed in from outside (see above) — a bottom-right drag
// grip resizes further from there. Kept well clear of the compact fixed-size J-window's own
// CSS in src/ui/style.css on purpose: that box is untouched, still tiny, still top-left,
// still opens only on J or the tab click. This is a second, bigger presentation of the exact
// same panel, reached only via a valid `?video=` request.
const EXPANDED_MIN_W = 320;

function viewportSize() {
  const w = typeof innerWidth === 'number' ? innerWidth : 900;
  const h = typeof innerHeight === 'number' ? innerHeight : 600;
  return { w, h };
}

// ~40-50% of whatever hosts the game (the extension's side panel / dock IS that host — see
// docs/EXTENSION.md), clamped so a 16:9 frame never taller than 85% of the viewport and never
// narrower than the compact window would be pointless-small for "large".
function maxExpandedWidth() {
  const { w, h } = viewportSize();
  return Math.max(EXPANDED_MIN_W, Math.min(w * 0.92, h * 0.85 * (16 / 9)));
}
function defaultExpandedWidth() {
  const { w } = viewportSize();
  return Math.max(EXPANDED_MIN_W, Math.min(w * 0.46, maxExpandedWidth()));
}

/* The grip's look and its one positioning need (`#mpFrame` as the anchor for an
 * absolutely-positioned corner handle) live in a stylesheet THIS FILE injects and owns
 * outright — src/ui/style.css is not touched by this change. Injected once, id-guarded, and
 * only when a request actually needs it, so an install that never drives a video in never
 * gets an extra <style> tag it has no use for. The width itself is never set here — that is
 * always the inline style the constructor and the drag handler write directly, which beats
 * any stylesheet rule regardless of where the rule lives. */
function ensureExpandStyle() {
  if (typeof document === 'undefined' || document.getElementById('musicPanelExpandStyle')) return;
  const style = document.createElement('style');
  style.id = 'musicPanelExpandStyle';
  style.textContent = `
    #musicPanel #mpFrame { position: relative; }
    #musicPanel .mpGrip {
      display: none;
      position: absolute;
      right: 2px;
      bottom: 2px;
      width: 18px;
      height: 18px;
      cursor: nwse-resize;
      opacity: 0.55;
      background:
        linear-gradient(135deg, transparent 0 42%, rgba(246,236,216,0.55) 42% 50%,
          transparent 50% 62%, rgba(246,236,216,0.55) 62% 70%, transparent 70% 100%);
    }
    #musicPanel.expanded .mpGrip { display: block; }
    #musicPanel .mpGrip:hover { opacity: 0.9; }
  `;
  document.head.appendChild(style);
}

export class MusicPanel {
  constructor() {
    this.open = false;
    this._loaded = false;

    // A video handed in from the car button (extension/dock.js) beats the operator's own
    // playlist for this session only — nothing here is written back to the URL or storage, so
    // reloading the game plain (no `?video=`) is always back to the default playlist.
    const req = typeof location !== 'undefined' ? parseVideoRequest(location.search) : null;
    this._requested = !!req;
    this._embedSrc = req ? embedSrcForRequest(req) : MUSIC_EMBED_SRC;

    const root = (this.root = document.createElement('div'));
    root.id = 'musicPanel';
    root.innerHTML = `
      <button type="button" id="mpTab" title="music window (J)">&#9835; music <span class="mpKey">J</span></button>
      <div id="mpFrame">
        <div class="mpHead">
          <span>&#9835; radio window</span>
          <button type="button" class="mpClose" aria-label="close music window (J)">&times;</button>
        </div>
        <div class="mpBody"></div>
        <p class="mpHint">starts muted — click the player to unmute &middot; J or &times; to close</p>
        <div class="mpGrip" title="drag to resize"></div>
      </div>`;
    document.body.appendChild(root);

    this._frame = root.querySelector('#mpFrame');
    this._body = root.querySelector('.mpBody');
    root.querySelector('#mpTab').addEventListener('click', () => this.show());
    root.querySelector('.mpClose').addEventListener('click', () => this.hide());

    // An independent listener, the same pattern src/ui/menu.js uses for Escape/M: a one-shot
    // UI toggle like this does not belong in car/input.js's per-frame drive-command polling.
    this._onKey = (e) => {
      if (e.code !== TOGGLE_KEY) return;
      e.preventDefault();
      this.toggle();
    };
    addEventListener('keydown', this._onKey);

    if (this._requested) {
      // Large by default, and the grip below lets the player take it further — the compact
      // fixed-size box (no class here) is completely untouched for the plain J-window case.
      ensureExpandStyle();
      root.classList.add('expanded');
      this._frame.style.width = `${Math.round(defaultExpandedWidth())}px`;
      this._wireResize();
      this.show(); // the whole point of driving a video in was to see it without pressing J
    }
  }

  /* A single bottom-right grip, width-only (the frame's own aspect-ratio CSS follows height
   * from it) — the same drag shape as extension/dock.js's resize grip, for the same reason:
   * simple, one axis, nothing to get diagonally wrong. Only wired when `expanded`, so the
   * compact window never grows a grip it was never asked for. */
  _wireResize() {
    const grip = this._frame.querySelector('.mpGrip');
    if (!grip) return;
    let dragging = false;
    let startX = 0;
    let startW = 0;
    const move = (e) => {
      if (!dragging) return;
      const w = Math.max(EXPANDED_MIN_W, Math.min(startW + (e.clientX - startX), maxExpandedWidth()));
      this._frame.style.width = `${Math.round(w)}px`;
    };
    const stop = () => {
      if (!dragging) return;
      dragging = false;
      const f = this._body.querySelector('iframe');
      if (f) f.style.pointerEvents = '';
    };
    grip.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = this._frame.getBoundingClientRect().width;
      // The video iframe is cross-origin; capture makes pointermove keep reaching the grip
      // regardless of what the cursor is over, but this is the same extra belt-and-braces
      // extension/dock.js's own grip uses on its (same reasoning, different iframe) game
      // frame — cheap insurance, not a correction of an observed failure.
      const f = this._body.querySelector('iframe');
      if (f) f.style.pointerEvents = 'none';
      grip.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', stop);
    grip.addEventListener('pointercancel', stop);
  }

  /* The iframe is created on first open, not in the constructor, so a player who never
   * touches J never sends a single request to youtube.com. Built once and then only shown or
   * hidden after that, so closing and reopening the panel never restarts the video. */
  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    const f = document.createElement('iframe');
    f.src = this._embedSrc;
    f.title = 'Wanderoad radio window (YouTube)';
    f.frameBorder = '0';
    // YouTube's own standard embed permissions list.
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    f.allowFullscreen = true;
    this._body.appendChild(f);
  }

  show() {
    this._ensureLoaded();
    this.open = true;
    this.root.classList.add('open');
  }

  hide() {
    this.open = false;
    this.root.classList.remove('open');
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }

  dispose() {
    removeEventListener('keydown', this._onKey);
  }
}
