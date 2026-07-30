/* Wanderoad — the heads-up display.
 *
 * A cozy driving game should be able to be played with the HUD switched off and lose almost
 * nothing. So: a speed, a place, a streak, and a single line of text that appears when
 * something happens and then goes away. No meters, no pop-ups, no combo counter screaming at
 * you. When the streak breaks it fades rather than flashes, because losing eighty kilometres
 * should feel like a sigh, not an alarm.
 *
 * THE ONE EXCEPTION is the streak itself. It is the only mechanic in the game and it is what
 * opens the fleet, and for a long time it was a 15 px number in the top-left corner that
 * nobody ever noticed — behind the debug overlay, at 0.42 opacity, next to nothing. So the
 * streak now gets the bottom centre of the screen: a big distance, one line of plain English
 * saying what the number means, and a bar across the very bottom showing which car it is
 * buying and how far away that car is. Calm, but impossible to miss. It used to also have a
 * companion: a 3D "rope" trailing behind the car in the world (src/render/trail.js). The
 * operator called that out directly — "does not look good at all or make it clear... use the
 * bottom blue line instead" — so this bar is now the ONLY streak readout, and trail.js draws
 * nothing any more (see its own file header).
 *
 * The bar carries two independent readouts, both riding the same track:
 *   - the FILL/GLOW/MARK, unchanged: this run against the next car's unlock threshold.
 *   - MILESTONE DOTS (new): small fixed waypoints — 1, 3, 6, 10, 20 km and on — laid out along
 *     the same track and coloured passed / current / upcoming as the streak grows. These are
 *     not the car-unlock ladder (src/game/garage.js keeps its own numbers and is untouched);
 *     they are a second, longer-range sense of distance that keeps meaning something long
 *     after "every car unlocked" stops moving. See MILESTONES_KM below for the exact list and
 *     why it continues the way it does.
 *
 * Layout, bottom of the screen upward:
 *     [ · · ·|· · · · ]  the full-width unlock bar at y = 0 — fill/glow plus milestone dots
 *     Rally · 7.6 km to go
 *     2.14 km  ×1.42     the big figure
 *     without leaving the road
 * One column, one glance, and it never overlaps the speedo or the place name at any width.
 *
 * Two more additions ride the same bar and the same left column, both reusing machinery this
 * file already had rather than claiming a new HUD region: FLEET UNLOCK ICONS (fleetX() below)
 * — one small badge per car in src/game/garage.js's FLEET, on the milestone dots' own log
 * scale, so the whole unlock ladder is visible at once rather than just the single next rung
 * the bar text already names — and a quiet GAME TITLE sitting in the headroom above the place
 * name, the one stretch of screen edge nothing else claims (see musicPanel's own note in
 * style.css for the full map of which corner belongs to what).
 *
 * NOTHING HERE IS EVER SET TO AN EMPTY STRING. An element with no text has no box, and a box
 * with no size fails every honest visibility check there is (see tools/browser-test.mjs's
 * VISIBLE helper: display, visibility, opacity AND a bounding rect over 1 px). Every slot
 * that this file claims is visible has a resting value. The two decorative slots that may be
 * empty — the multiplier and the points — are never claimed and never affect layout.
 *
 * Markup is built with createElement rather than innerHTML so the whole block can be driven
 * by a stub DOM in node: tools/diag-hud.mjs asserts the real strings this file writes against
 * the real unlock ladder, without a browser.
 *
 * ONE MORE THING RIDES THE TOAST: the R hint, a few lines below the caption's own hysteresis
 * — "the first ten times you go off-road, say R gets you back on." It is not a new mechanism;
 * it fires off the SAME debounced off-road transition the caption already computes, through
 * the SAME say()/toast this file already had. See OFFROAD_HINT_KEY's own note for why.
 */

import { fmtScore, fmtDistance } from '../game/streak.js';
import { FLEET, FLEET_BY_ID, isUnlocked } from '../game/garage.js';
import { STREAK_METRES_PER_SUN } from '../game/wallet.js';
import { clamp01 } from '../core/math.js';
import { BIOME_SHORT } from '../world/biomes.js';

/* How far the HUD steps back while the opening cinematic has the screen. NOT 0 — see
 * setCinematic() for why that was wrong. 0.4 is a shade above the level this game already
 * treats as quiet-but-readable — #openMenu ("ESC — garage") sits at 0.34 permanently and is
 * the one persistent affordance on the screen — so the speed and the place name stay legible
 * over a camera move without competing with it. A string, because an inline style takes one. */
const CINE_DIM = '0.4';

/* Hysteresis for the streak caption. Operator, verbatim: "the off-road/leaving-the-road thing
 * fuzzes back and forth every three seconds making all the text underneath unreadable." The
 * caption used to be written straight off `s.grace`/`s.paused` every frame with no memory of
 * what it showed last — and `s.grace` (src/game/streak.js) is `_off > 0 && _off < GRACE`, which
 * a car riding the painted edge of the road can flip on and off every single frame as the one
 * sample point at its centre crosses ON_ROAD back and forth. A caption with no memory repeats
 * that flicker verbatim.
 *
 * The fix is a small state machine, `_setCaption()` below: a candidate state must stay the
 * SAME candidate for CAP_CONFIRM_S straight before it is believed at all (so a state that
 * never holds for even a third of a second — the flicker itself — never gets shown), and once
 * a state IS shown it stays up for at least CAP_MIN_HOLD_S regardless of what happens
 * underneath in the meantime (so even a confirmed swap cannot repeat more than once every two
 * seconds). Exported so tools/diag-hud.mjs can hold the real numbers to the operator's own
 * ">= 2 s" rather than a copy. */
export const CAP_MIN_HOLD_S = 2.0;
export const CAP_CONFIRM_S = 0.3;

/** Make a div/span with an id or class and, optionally, resting text. */
function el(tag, idOrClass, text) {
  const n = document.createElement(tag);
  if (idOrClass) {
    if (idOrClass[0] === '.') n.className = idOrClass.slice(1);
    else n.id = idOrClass;
  }
  if (text !== undefined) n.textContent = text;
  return n;
}

/* Distance waypoints for the unlock bar's milestone dots — independent of the car-unlock
 * ladder in src/game/garage.js (Estate 0, Hatch 1 km, Coupe 3, Sedan 8, Rally 20, Taxi 45,
 * Patrol 100), which keeps its own numbers untouched. Also a different thing from the
 * `ev.kind === 'milestone'` one-shot toasts drained from the streak a little further down in
 * this file — those fire once off src/game/streak.js's own multiplier-ladder thresholds
 * (1, 2.5, 5, 10, 20, 40, 80 km) and then never again; these dots are a persistent, always-on
 * readout on the bar itself, off a separate, longer list.
 *
 * The operator's own list — "1 km 3 km 6 km 10 km 20 km 40 km etc" — steps by roughly x3,
 * x2, x1.7, x2, x2. There is no natural end to "etc", so the sequence keeps the same ~x2
 * cadence past 40: 80, 150, 300. Exported so tools/diag-hud.mjs checks the real list rather
 * than a hand-copied one.
 */
/* Suns shown across the bar at once. Four means each tick is a quarter of the width, which is
 * big enough to read at a glance, and the band repeats — so a long run keeps filling and paying
 * instead of running out of bar. See the SUN TICKS note in the constructor for why the old
 * distance milestones (1, 3, 6, 10, 20, 40, 80, 150, 300 km on a log axis) had to go: cars are
 * bought with suns now, so a distance ladder promised something that no longer happens. */
export const SUN_TICKS = 4;

/* ── the R hint ───────────────────────────────────────────────────────────────
 * Operator, verbatim: "give people the hint that they can click R to get back on road when
 * they go off-road the first 10 times." Reuses the toast this file already has (`say()`),
 * on the SAME debounced off-road signal the streak caption already computes below
 * (`_setCaption`'s confirmed `_capKey === 'grace'`) — not a second flicker-prone flag read
 * straight off `s.grace` every frame. That debounce already exists precisely because a wheel
 * on the painted edge of the road can flip `s.grace` many times a second (CAP_CONFIRM_S/
 * CAP_MIN_HOLD_S above), and a hint that fired on every one of those flickers would be worse
 * than no hint at all.
 *
 * "Never while it is already showing" is `this._toastT <= 0` — the same timer `say()` itself
 * already drives — so the hint cannot stack on itself and cannot talk over whatever other
 * toast happens to be up. Persisted the way the streak best is persisted: one small JSON
 * blob in localStorage, read once in the constructor and written the moment the count moves,
 * so a shown count survives a reload the same way the streak's best does. */
export const OFFROAD_HINT_KEY = 'wanderoad.hint.offroad.v1';
export const OFFROAD_HINT_MAX = 10;
export const OFFROAD_HINT_TEXT = 'off the road — press R to get back on';

function loadOffroadHintCount() {
  try {
    const raw = localStorage.getItem(OFFROAD_HINT_KEY);
    if (!raw) return 0;
    return Math.max(0, +JSON.parse(raw).count || 0);
  } catch {
    return 0; // corrupt or unavailable store — same tolerance streak.js gives itself
  }
}

function saveOffroadHintCount(count) {
  try {
    localStorage.setItem(OFFROAD_HINT_KEY, JSON.stringify({ count }));
  } catch {
    /* private mode, quota, whatever — the hint still works this session, just unpersisted */
  }
}

/* Where a waypoint sits along the bar, 0–100. Log-scaled: linear would put 1 km and 3 km in
 * the first percent of the bar and leave 300 km alone at the far right, which fails exactly
 * the "legible at both ends" requirement this exists to meet. Only the DOT LAYOUT is
 * log-scaled — the streak figure itself (streakKm, below) is always the exact metre/kilometre
 * value; nothing about the number display is non-linear. Padding on each side (half the first
 * waypoint, 30% past the last) keeps the end dots off the very edge of the bar. */
function milestoneX(km) {
  const lo = Math.log10(MILESTONES_KM[0] * 0.5);
  const hi = Math.log10(MILESTONES_KM[MILESTONES_KM.length - 1] * 1.3);
  return clamp01((Math.log10(km) - lo) / (hi - lo)) * 100;
}

/* Where a car's unlock icon sits along the SAME bar, on the SAME log scale as the milestone
 * dots above — a car earned at 20 km and a milestone passed at 20 km land at the same x, so
 * the two overlays read as one continuous distance axis rather than a pair of unrelated ones.
 * The one exception is the Estate, which unlocks at 0 m — you are driving it from the first
 * frame. log10(0) is undefined, so it is pinned to the left edge by definition rather than
 * folded into a curve that has nothing to say about zero. */
function fleetX(unlockAtM) {
  return unlockAtM <= 0 ? 0 : milestoneX(unlockAtM / 1000);
}

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.kph = document.getElementById('kph');
    this.gear = document.getElementById('gear');
    this.biome = document.getElementById('biome');
    this.coords = document.getElementById('coords');
    this.players = document.getElementById('players');
    this.toast = document.getElementById('toast');

    /* The unlock bar, along the very bottom of the screen. It answers one question — how far
     * am I from the next car — and it is the only place the game ever asks the player to want
     * something. It lifts and glows while a streak is running and blips red when one breaks.
     *
     * The fill measures THIS RUN against the next car's threshold, not the all-time best
     * against it. That matters: a car is only ever earned by one unbroken run reaching its
     * number, so the run is the honest thing to draw, and it is also the only version that
     * moves while you drive. The all-time best is a separate notch on the track, which the
     * fill overtakes when you beat it. */
    this.bar = el('div', 'unlockBar');
    this.barNext = el('div', 'unlockNext', 'the road ahead');
    this.barTrack = el('div', '.track');
    this.barFill = el('div', '.fill');
    this.barMark = el('div', '.mark');
    this.barTrack.appendChild(this.barFill);
    this.barTrack.appendChild(this.barMark);
    /* No ticks. The bar is ONE milestone now (see the note in update()), so there is nothing to
     * subdivide it with — the previous version drew four of them over a repeating band and the
     * operator's verdict on a phone was that it "filled up almost instantly" and had "no relationship
     * established with the unlocks whatsoever". An empty track that fills once and pays is the whole
     * widget. */
    this.tickEls = [];
    this.bar.appendChild(this.barNext);
    this.bar.appendChild(this.barTrack);
    this.root.appendChild(this.bar);

    /* The off-road edge, and the sun balance. Both are new HUD surfaces asked for by the operator
     * while playing the beta: an immediate red edge ("red off road feedback happens right away")
     * and a prominent balance ("re-add the suns ticker to the top right, making it prominent").
     * Built here rather than in their own files because neither owns any behaviour — they are a
     * class toggle and a number — and a file each would be two more places to look. */
    this.offroadEdge = el('div', 'offroadEdge');
    this.root.appendChild(this.offroadEdge);
    /** Raw off-road state as last written to the DOM — see the note in update(). */
    this._offNow = false;

    this.sunTicker = el('div', 'sunTicker');
    this.sunTicker.innerHTML = '<i class="disc"></i><span class="n">0</span><span class="gain"></span>';
    this.sunN = this.sunTicker.querySelector('.n');
    this.sunGain = this.sunTicker.querySelector('.gain');
    this.root.appendChild(this.sunTicker);
    this._suns = -1;
    this._gainT = 0;

    /* The streak block. Built here rather than in index.html so the markup stays a shell and
     * this module owns everything it touches. */
    this.streakEl = el('div', 'streak');
    const figure = el('div', '.figure');
    this.streakKm = el('span', 'streakKm', '0 m');
    this.streakMul = el('span', 'streakMul');
    figure.appendChild(this.streakKm);
    figure.appendChild(this.streakMul);
    const cap = el('div', '.cap');
    this.streakCap = el('span', 'streakCap', 'stay on the road');
    this.streakPts = el('span', 'streakPts');
    cap.appendChild(this.streakCap);
    cap.appendChild(this.streakPts);
    this.streakEl.appendChild(figure);
    this.streakEl.appendChild(cap);
    this.root.appendChild(this.streakEl);

    /* The game's own name. There is otherwise no branding anywhere once the loading veil is
     * gone — the veil's "Wanderoad" card is a boot-time-only thing, never seen again once the
     * game itself is on screen. Every screen edge is already claimed (see musicPanel's own
     * note in style.css for the full map), so this rides quietly in the one column with
     * headroom to spare: bottom-left has nothing between the music tab up in the corner and
     * the biome/coords block down at the very edge. No animation is written for it here — it
     * gets its "fade in on first load" for free from #hud's own existing cinematic dim-then-
     * lift (see setCinematic below), the same way every other instrument on this screen
     * already arrives, and then it just sits there, quiet, forever after.
     *
     * THE NAME IS "Cozy Driver" — the operator's rebrand, and the single source of truth for
     * it in the running game. The stylesheet gives it the cozy serif, the palette green and
     * the slow grow-and-settle (#gameTitle in src/ui/style.css); everything else that shows
     * the name (index.html's <title> and loading card, the extension manifest and panel) is a
     * static string that has to match this one. tools/diag-hud.mjs asserts all of them. */
    this.title = el('div', 'gameTitle', 'Cozy Driver');
    this.root.appendChild(this.title);

    this._blip = 0;
    this._toastT = 0;
    this._lastGear = null;
    this._lastBiome = -1;
    this._shownKm = 0;
    /* Which car the bar is currently counting towards. When this moves ON — and only when the
     * best actually reached the old target — the old one was just earned. Switching cheat mode
     * also clears the target and that is not an achievement, hence the `best >=` test. */
    this._nextId = '';

    /* The streak caption's hysteresis state — see CAP_MIN_HOLD_S/CAP_CONFIRM_S above.
     * `_capKey` is whichever short key ('start'/'best'/'onroad'/'grace'/'paused') is actually
     * on screen right now; it starts as 'start' to match this.streakCap's own resting text set
     * a few lines up, so the very first frame never has to invent a swap just to agree with
     * itself. `_capHold` counts down the minimum-display floor; `_capPendingKey`/`_capPendingT`
     * track how long a NEW key has been asked for, continuously, before it is believed. */
    this._capKey = 'start';
    this._capHold = 0;
    this._capPendingKey = null;
    this._capPendingT = 0;

    /* The R hint's own count — see OFFROAD_HINT_KEY's note above. Loaded once here, the same
     * moment Streak.load() reads `best` in its own constructor. */
    this._offroadHintCount = loadOffroadHintCount();
  }

  /** Write `text` into the caption, but only once `key` has been the SAME desired state for
   *  CAP_CONFIRM_S straight (so a flicker that never holds that long never reaches the glass)
   *  AND the state currently on screen has already held for CAP_MIN_HOLD_S (so even a real,
   *  confirmed change cannot repeat faster than every two seconds). `key === this._capKey` is
   *  the fast path every ordinary frame takes: nothing pending, just keep the hold timer
   *  ticking down and the text as it is. */
  _setCaption(key, text, dt) {
    if (this._capHold > 0) this._capHold -= dt;
    if (key === this._capKey) {
      this._capPendingKey = null;
      this._capPendingT = 0;
      this.streakCap.textContent = text;
      return;
    }
    if (this._capPendingKey !== key) {
      this._capPendingKey = key;
      this._capPendingT = 0;
    }
    this._capPendingT += dt;
    if (this._capPendingT >= CAP_CONFIRM_S && this._capHold <= 0) {
      this._capKey = key;
      this._capHold = CAP_MIN_HOLD_S;
      this._capPendingKey = null;
      this._capPendingT = 0;
      this.streakCap.textContent = text;
    }
    // else: the candidate has not yet earned the swap (or the current caption has not held its
    // floor) — the text already on screen from the last confirmed key is left exactly as it is.
  }

  /** One short line, centred, gone in a few seconds. The only interruption in the game. */
  say(text, seconds = 3.6) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this._toastT = seconds;
  }

  /**
   * Let the instruments recede while the opening cinematic owns the screen, and bring them
   * back up when it hands over.
   *
   * OPACITY, never `hidden`, and an inline style rather than a class. That much is an old
   * scar: this game once shipped unplayable because a stylesheet rule beat the `hidden`
   * attribute, so nothing here touches the one attribute that makes the game visible.
   * Setting opacity back to '' drops the inline value and lets the stylesheet have it again,
   * transitioning on the way.
   *
   * DIMMED, NEVER BLANKED — and that is the second scar, cut from the other side of the same
   * knife. This used to go to 0, which put the HUD off the screen for the whole 38 s
   * programme. But the cinematic deliberately does NOT block the game: input is live from its
   * first frame and any key drives. A player who takes the wheel during the intro was
   * therefore steering with no readable instruments, and instruments you cannot read while
   * the car is drivable are the same defect as instruments that never arrive — it is the
   * failure the browser suite's "HUD is showing" check exists to catch, and it caught it.
   * So the camera gets the screen, the HUD steps back behind it, and "is the HUD showing"
   * stays honestly true for every second of the intro.
   */
  setCinematic(on) {
    if (!this.root) return;
    /* Back with no transition, up with one. main.js clears the `hidden` attribute and starts
     * the cinematic in the same tick, so a symmetric 1.2 s fade would show the whole HUD
     * arriving at full and then sinking again over the first shot. Going the other way a slow
     * fade up is the nicer arrival. */
    this.root.style.transition = on ? 'none' : 'opacity 1.2s ease';
    this.root.style.opacity = on ? CINE_DIM : '';
    this.root.style.pointerEvents = on ? 'none' : '';
  }

  update(dt, { car, streak, surface, remotes, netState, myName = '', wallet = null }) {
    // ── speed ──
    const kph = Math.round(car.kph);
    this.kph.textContent = kph;

    const g = car.reverse ? 'R' : Math.abs(car.speed) < 0.6 ? 'N' : String(car.gear);
    if (g !== this._lastGear) {
      this.gear.textContent = g;
      this._lastGear = g;
    }

    // ── place ──
    if (surface && surface.dominant !== this._lastBiome) {
      this._lastBiome = surface.dominant;
      this.biome.textContent = BIOME_SHORT[surface.dominant];
      // Crossing into a new biome is worth one quiet line — it is the main thing that
      // happens when you drive a long way in this game.
      this.say(BIOME_SHORT[surface.dominant], 2.8);
    }
    this.coords.textContent = `${Math.round(car.x)}, ${Math.round(car.z)}`;

    // ── streak ──
    const s = streak.state;
    const live = s.distance > 0;
    this.streakEl.classList.toggle('live', live);
    if (live) {
      // Smooth the displayed distance so the last digit is not a blur at 300 km/h.
      this._shownKm += (s.km - this._shownKm) * Math.min(1, dt * 9);
      this.streakKm.textContent = fmtDistance(this._shownKm * 1000);
      // The caption is what makes the big number mean anything. It says the mechanic out loud
      // once, quietly, forever — which is cheaper than a tutorial and calmer than a pop-up.
      /* `paused` comes first because it OVERRIDES the other two: while auto-drive has the wheel
       * the streak is frozen (src/game/streak.js), so neither "without leaving the road" nor
       * "off the road…" is true — the number on screen is not moving and the caption has to be
       * the one line that explains why. A big figure that has visibly stopped counting with no
       * explanation under it is exactly the sort of thing that reads as a bug.
       *
       * Routed through _setCaption() rather than written straight to the DOM: `s.grace` itself
       * can flip true/false every single frame while a wheel rides the painted edge of the road
       * (see CAP_MIN_HOLD_S/CAP_CONFIRM_S's own note above), and this is the caption the
       * operator called out by name as the thing fuzzing unreadable. */
      const capKey = s.paused ? 'paused' : s.grace ? 'grace' : 'onroad';
      const capText = s.paused
        ? 'held while auto-drive has the wheel'
        : s.grace
          ? 'off the road…'
          : 'without leaving the road';
      const capBefore = this._capKey; // for the R hint's edge test, below — captured before _setCaption can move it
      this._setCaption(capKey, capText, dt);
      // The warm "off the road" colour rides the SAME debounced state as the words it sits
      // under, not the raw frame-to-frame `s.grace` — a caption that has just decided to keep
      // reading "without leaving the road" through a flicker must not still blush warm
      // underneath it. Text and colour agree, or neither moves.
      this.streakEl.classList.toggle('grace', this._capKey === 'grace');

      /* AND THE IMMEDIATE ONE, off the RAW per-frame state with no confirm delay at all.
       *
       * Operator, playing the beta: "make it so red off road feedback happens right away (not
       * waiting until way off road like now)". Two delays were stacked: `s.grace` only turns on
       * once the streak's own off-road timer has started, the caption then holds any candidate
       * for CAP_CONFIRM_S before believing it, and `s.grace` turns off AGAIN the moment the grace
       * window expires — so the warning arrived late and then disappeared exactly when the streak
       * broke.
       *
       * `s.onRoad` is the streak's own worst-wheel test (car.onRoadMin), so this lights the
       * instant a single wheel crosses the verge. Flicker is handled by a 90 ms fade in CSS
       * rather than by a timer here, which is what lets it be immediate — see #streak.offroad and
       * #offroadEdge in ui/style.css. Not shown while auto-drive has the wheel: the streak is
       * frozen then, so there is nothing to warn about. */
      const offNow = !s.onRoad && !s.paused;
      if (offNow !== this._offNow) {
        this._offNow = offNow;
        this.streakEl.classList.toggle('offroad', offNow);
        this.offroadEdge.classList.toggle('on', offNow);
      }

      /* The R hint. Fires on the CONFIRMED off-road transition — `this._capKey` only just
       * became 'grace' this frame, having not been 'grace' the frame before — never on the
       * raw `s.grace` this section reads above, for the same flicker reason the caption
       * itself is debounced (see this file's own OFFROAD_HINT_KEY note). `this._toastT <= 0`
       * is "not already showing" reusing the one toast timer this file already owns, so the
       * hint can neither repeat on itself nor talk over another toast that is up. Capped at
       * OFFROAD_HINT_MAX for the life of the browser's storage, same durability as the
       * streak's own best. */
      if (
        this._capKey === 'grace' &&
        capBefore !== 'grace' &&
        this._offroadHintCount < OFFROAD_HINT_MAX &&
        this._toastT <= 0
      ) {
        this._offroadHintCount++;
        saveOffroadHintCount(this._offroadHintCount);
        this.say(OFFROAD_HINT_TEXT, 3.4);
      }
      this.streakMul.textContent = s.multiplier > 1.02 ? `×${s.multiplier.toFixed(2)}` : '';
      this.streakPts.textContent = s.score > 5 ? fmtScore(s.score) : '';
    } else {
      this._shownKm = 0;
      this.streakEl.classList.remove('grace');
      // At rest the figure holds the all-time best, because that is the number the fleet
      // unlocks against — the bar underneath is measured in the same units. Never blank:
      // fmtDistance(0) is "0 m", which is a true statement and, more to the point, a box.
      this.streakKm.textContent = fmtDistance(s.best);
      this._setCaption(s.best > 0 ? 'best' : 'start', s.best > 0 ? 'your longest run' : 'stay on the road', dt);
      this.streakMul.textContent = '';
      this.streakPts.textContent = '';
    }

    /* ── THE BAR IS THE MILESTONE ───────────────────────────────────────────
     * Operator, after playing on a phone: "The bar filled up almost instantly on mobile. I came to
     * understand that the bar at the bottom has no relationship established with the unlocks
     * whatsoever. So I had an idea. What if your first kilometer was the first bar from left to right
     * of the screen? Your next milestone would be the next bar. And each time you filled it up, it
     * would give you one sun that would appear on you, and jump onto you, so that it would be very
     * visually understandable."
     *
     * So the bar is now exactly one thing: the current milestone, left edge to right edge. It fills
     * once, pays, and the next (longer) one starts. No repeating band, no log axis, no ticks standing
     * for something that never arrives — the previous version drew four ticks over a repeating 1 km
     * band and on a phone, where the bar is two hundred pixels wide, that read as filling instantly
     * and meaninglessly.
     *
     * The wallet owns the ladder (game/wallet.js: milestoneLength/milestoneReward) so the number on
     * screen and the number paid cannot disagree. */
    const ms = wallet ? wallet.milestone : null;
    const runM = live ? s.distance : 0;
    const p01 = wallet ? wallet.milestoneProgress(runM) : 0;
    const toGo = wallet ? wallet.milestoneToGo(runM) : 0;
    this.bar.classList.toggle('live', live);
    this.barFill.style.width = `${(Math.max(p01, 0.004) * 100).toFixed(1)}%`;
    this.barMark.classList.remove('on');

    /* And say it in words, because the whole complaint was that the bar meant nothing. The line names
     * the bar's length, what finishing it pays, and how far is left — the three things you can act
     * on. `fmtDistance` so a phone reads "820 m" rather than "0.8 km". */
    /* A milestone length is always a round number (1, 1.5, 2, 3 km ...), so fmtDistance's two
     * decimals print "1.00 km" where the bar is trying to say "1 km". A phone has no room for the
     * noise and neither does the eye. */
    const km = (m) => (m < 1000 ? `${Math.round(m)} m` : `${+(m / 1000).toFixed(1)} km`);
    if (ms) {
      this.barNext.textContent = live
        ? `${km(ms.length)} without leaving the road → ${ms.reward} sun${ms.reward === 1 ? '' : 's'} · ${km(toGo)} to go`
        : `${km(ms.length)} without leaving the road → ${ms.reward} sun${ms.reward === 1 ? '' : 's'}`;
    }

    /* A FILLED BAR THROWS A SUN AT YOU. `takeFill()` pops the event the wallet recorded when the
     * milestone completed, so this fires exactly once per fill and cannot be missed by a dropped
     * frame the way reading a threshold every frame could. */
    if (wallet) {
      const fill = wallet.takeFill();
      if (fill) this.flySun(fill.suns);
    }
    if (this._blip > 0) {
      this._blip -= dt;
      if (this._blip <= 0) {
        this.bar.classList.remove('broke');
        this.streakEl.classList.remove('broke');
      }
    }

    const ev = streak.drain();
    if (ev) {
      if (ev.kind === 'milestone') this.say(ev.text, 3.2);
      else if (ev.kind === 'break') {
        this.say(`${fmtDistance(ev.distance)} — streak ended`, 3.0);
        // The blip: rust arrives instantly and fades out over the best part of a second. A
        // fade in and out both ways would read as a pulse, and a pulse is a scoreboard.
        this.bar.classList.add('broke');
        this.streakEl.classList.add('broke');
        this._blip = 1.2;
      }
    }

    /* ── who is here, INCLUDING YOU ──
     *
     * This list used to render remotes only, so your own name appeared nowhere in the game at
     * all. The operator, driving two windows: "names are a problem in multiplayer -- who is each
     * player when u cant see your own name?" Exactly right — with one name per window and no
     * self, there is no way to tell which car is yours, and the whole list is unreadable.
     *
     * You are always first, always marked, and always shown even when nobody else is about —
     * a name you can see is how you know what the other person is looking at when they say it. */
    if (remotes) {
      const list = remotes.list ? remotes.list() : [];
      const mine = myName
        ? `<div class="me">${escapeHtml(myName)} <span class="dist">you</span></div>`
        : '';
      const others = list
        .slice(0, 6)
        .map((p) => `<div>${escapeHtml(p.name)} <span class="dist">${Math.round(p.dist)} m</span></div>`)
        .join('');
      const html = mine + others;
      // Only touch the DOM when the text actually changes — this runs every frame.
      if (html !== this._playersHtml) {
        this._playersHtml = html;
        this.players.innerHTML = html;
      }
    }
    if (netState && netState !== this._lastNet) {
      this._lastNet = netState;
      this.root.dataset.net = netState;
    }

    // ── toast timer ──
    if (this._toastT > 0) {
      this._toastT -= dt;
      if (this._toastT <= 0) this.toast.classList.remove('show');
    }
  }

  /**
   * The sun balance, top right. Called every frame from main.js with the wallet.
   *
   * Operator: "we need to re-add the suns ticker to the top right, making it prominent, showing
   * how many suns you have in total". Everything is bought with suns now, so this is the most
   * actionable number on the screen and it was a 12 px figure tucked under the player list.
   *
   * `gained` is what was minted THIS frame, which is the half that makes earning felt: the number
   * bumps and a small green "+1" floats off it. That is the other half of "make it clear what you
   * get for not leaving the road" — the bar says the rule, this says it just happened.
   *
   * @param {number} dt @param {{suns:number}} wallet @param {number} [gained]
   */
  /**
   * Throw a sun from the car up into the balance. Operator: "it would give you one sun that would
   * appear on you, and jump onto you, so that it would be very visually understandable."
   *
   * A DOM element rather than a 3D object, deliberately: it has to travel from where the CAR is to
   * where the BALANCE is, and one of those two only exists in screen space. It starts just above the
   * car — which is always the middle-bottom of the screen, since the chase camera keeps it there —
   * and lands on #sunTicker. Removed on `animationend`, so nothing accumulates however long anyone
   * plays.
   *
   * @param {number} n how many suns this fill paid, shown on the token
   */
  flySun(n = 1) {
    if (!this.root) return;
    const el2 = document.createElement('div');
    el2.className = 'flySun';
    el2.innerHTML = `<i class="disc"></i>${n > 1 ? `<b>${n}</b>` : ''}`;
    this.root.appendChild(el2);
    el2.addEventListener('animationend', () => el2.remove(), { once: true });
    // If the browser never fires it (a hidden tab, say), do not leak the node.
    setTimeout(() => el2.remove(), 3000);
    this.say(n > 1 ? `bar filled — ${n} suns` : 'bar filled — a sun', 2.4);
  }

  suns(dt, wallet, gained = 0) {
    if (!wallet || !this.sunN) return;
    if (this._gainT > 0) {
      this._gainT -= dt;
      if (this._gainT <= 0) this.sunGain.classList.remove('show');
    }
    if (gained > 0) {
      this.sunGain.textContent = `+${gained}`;
      this.sunGain.classList.add('show');
      this._gainT = 1.1;
      this.sunTicker.classList.remove('bump');
      void this.sunTicker.getBoundingClientRect().width; // restart the animation
      this.sunTicker.classList.add('bump');
    }
    if (wallet.suns !== this._suns) {
      this._suns = wallet.suns;
      this.sunN.textContent = String(wallet.suns);
    }
  }
}

// Player names come off the network. They are rendered as text, never as markup.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
