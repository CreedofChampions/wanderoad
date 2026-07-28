// created by AI
/* Wanderoad — the hardware-acceleration notice.
 *
 * Operator, verbatim: "people without hardware acceleration lag tremendously — detect it and
 * let them know." Two independent signals, either one is enough:
 *
 *   1. SOFTWARE WEBGL. The renderer string (WEBGL_debug_renderer_info's UNMASKED_RENDERER_WEBGL,
 *      falling back to plain RENDERER if the browser has blocked the debug extension) names a
 *      software rasteriser — SwiftShader, llvmpipe/softpipe (Mesa's software path), or Windows'
 *      own "Microsoft Basic Render Driver" fallback. This is known the instant the WebGL context
 *      exists, before a single frame is drawn.
 *
 *   2. SUSTAINED LOW FRAME RATE. Some machines pass the renderer-string check (a real GPU name)
 *      and still crawl — an old iGPU, a laptop on battery-saver, a machine already pegged by
 *      something else. PerfMonitor watches the first ~10 s of real frame times and fires only if
 *      most of that window (60%+) was under 20 fps — "tremendously" laggy, not one hitch while a
 *      chunk streams in.
 *
 * ONE gentle notice, ever. PerfNotice shows at most once — sessionStorage remembers it across a
 * reload within the same tab so refreshing to "see if it goes away" does not just show it again,
 * and an in-memory flag covers the case where sessionStorage is unavailable (private mode). It
 * is dismissible, it never reappears once dismissed, and it never nags mid-drive on a second dip.
 *
 * Pure logic (isSoftwareRenderer, PerfMonitor) is separated from the DOM (PerfNotice) so both are
 * checked without a browser — see tools/diag-perf-notice.mjs.
 */

/** True if `gl`'s renderer string names a software rasteriser rather than a real GPU. Reads the
 *  unmasked string through WEBGL_debug_renderer_info when the browser allows it (most do); falls
 *  back to the plain, often-generic RENDERER parameter otherwise — still enough to catch the
 *  three fallbacks above. Never throws: a broken/mocked `gl` just reads as "not software". */
export function isSoftwareRenderer(gl) {
  if (!gl || typeof gl.getParameter !== 'function') return false;
  try {
    const ext = typeof gl.getExtension === 'function' ? gl.getExtension('WEBGL_debug_renderer_info') : null;
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER ?? 0x1f01);
    return /swiftshader|llvmpipe|softpipe|software rasterizer|microsoft basic render/i.test(String(raw || ''));
  } catch {
    return false;
  }
}

/** Watches a rolling window of frame times and decides, once, whether the start of this session
 *  was "laggy" — most of the window spent under the fps floor, not a single stutter. Pure: no
 *  DOM, no timers of its own, fed one sample per rendered frame by the caller. */
export class PerfMonitor {
  constructor({ windowSeconds = 10, fpsThreshold = 20, badFraction = 0.6 } = {}) {
    this.windowSeconds = windowSeconds;
    this.fpsThreshold = fpsThreshold;
    this.badFraction = badFraction;
    this._elapsed = 0;
    this._badTime = 0;
    this._done = false;
    this.triggered = false;
  }

  get done() {
    return this._done;
  }

  /** Feed one frame: `dt` in seconds, `fps` the instantaneous rate for that frame. Only does
   *  anything until the window closes, then settles `triggered` once and stops. Returns
   *  `triggered` for convenience, but callers should gate on `.done` becoming true before
   *  acting on it — `triggered` is meaningless mid-window. */
  sample(dt, fps) {
    if (this._done || !(dt > 0)) return this.triggered;
    this._elapsed += dt;
    if (fps < this.fpsThreshold) this._badTime += dt;
    if (this._elapsed >= this.windowSeconds) {
      this._done = true;
      this.triggered = this._badTime / this._elapsed >= this.badFraction;
    }
    return this.triggered;
  }
}

const SESSION_KEY = 'wanderoad.perfNotice.shown.v1';
/** Module-level fallback for the "once per session" rule when sessionStorage is unavailable
 *  (private browsing, some embedded webviews) — still holds for the life of this page load,
 *  which is the part of "once per session" that matters most. */
let shownThisLoad = false;

/** The dismissible banner itself — a thin strip at the very top of the screen (see #perfNotice
 *  in style.css), the one edge nothing else on this HUD claims (see hud.js's own note on the
 *  bottom-left headroom for the rest of the map). Never blocks input to the game underneath:
 *  `pointer-events: none` on the strip itself, `auto` only once `.show` lifts it into view. */
export class PerfNotice {
  constructor(root) {
    this.root = root || (typeof document !== 'undefined' ? document.body : null);
    this.el = null;
  }

  _alreadyShown() {
    if (shownThisLoad) return true;
    try {
      return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      return false;
    }
  }

  _markShown() {
    shownThisLoad = true;
    try {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* private mode / quota — the in-memory flag above still holds for this page load */
    }
  }

  /** Show the notice once, with `text`. A no-op if it has already been shown (this load or a
   *  prior one this session) or if there is nowhere to mount it. */
  show(text) {
    if (this._alreadyShown() || !this.root) return false;
    this._markShown();
    const el = document.createElement('div');
    el.id = 'perfNotice';
    const msg = document.createElement('span');
    msg.textContent = text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'got it';
    btn.addEventListener('click', () => this.hide());
    el.appendChild(msg);
    el.appendChild(btn);
    this.root.appendChild(el);
    this.el = el;
    // A frame late, so the opacity/transform transition in the stylesheet actually plays
    // instead of the banner snapping straight in at its resting state.
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    raf(() => el.classList.add('show'));
    return true;
  }

  hide() {
    if (!this.el) return;
    const el = this.el;
    el.classList.remove('show');
    setTimeout(() => el.remove(), 650);
    this.el = null;
  }
}
