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

// J — jukebox. Checked against src/car/input.js's KEYMAP and src/ui/menu.js's ESC list before
// picking it: W A S D / arrows, Space, E, Q, C, R, T, B, V, N, G, H, Shift (L/R), Ctrl (L),
// Escape and M are all already bound. J is untouched by either.
const TOGGLE_KEY = 'KeyJ';

export class MusicPanel {
  constructor() {
    this.open = false;
    this._loaded = false;

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
      </div>`;
    document.body.appendChild(root);

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
  }

  /* The iframe is created on first open, not in the constructor, so a player who never
   * touches J never sends a single request to youtube.com. Built once and then only shown or
   * hidden after that, so closing and reopening the panel never restarts the video. */
  _ensureLoaded() {
    if (this._loaded) return;
    this._loaded = true;
    const f = document.createElement('iframe');
    f.src = MUSIC_EMBED_SRC;
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
