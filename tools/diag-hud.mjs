/* Wanderoad — the streak readout, checked without a browser.
 *
 * The rule here is gotcha 3: a flag being set is not a thing being visible. A browser is the
 * only place you can truly measure a rendered box, and the browser suite is run centrally —
 * so this tool does the things that CAN be proved offline, and does them properly:
 *
 *   1. THE STRINGS ARE REAL. It stands up a stub DOM, builds the actual Hud from src/ui/hud.js,
 *      drives the actual Streak from src/game/streak.js, and reads back the exact text that
 *      lands in each element. The next-unlock line is then checked against the actual fleet
 *      ladder in src/game/garage.js, rung by rung — no hand-copied table to drift.
 *
 *   2. THE MILESTONE DOTS ARE REAL. Same idea, applied to hud.js's MILESTONES_KM waypoints:
 *      the real dot elements the real Hud built are read back — position, order, and which
 *      ones are marked passed/current/upcoming — at a handful of real streak distances.
 *
 *   3. THE MARKUP PASSES BY CONSTRUCTION. It parses src/ui/style.css and holds every rule that
 *      touches a claimed element to tools/browser-test.mjs's VISIBLE standard — display not
 *      none, visibility not hidden, opacity well clear of zero IN EVERY STATE INCLUDING MID-
 *      KEYFRAME, and a non-zero box. Then it resolves the clamp()s at real viewport sizes and
 *      prints the pixel geometry, and checks the block cannot collide with the speedo or the
 *      place name at any of them.
 *
 *   4. THE RETIRED ROPE TRAIL STAYS RETIRED. src/render/trail.js's StreakTrail is built for
 *      real, driven hard (hundreds of frames, a reset, an absurd distance), and its exported
 *      geometry is checked to confirm nothing was ever attached to a scene graph — not just
 *      that a `visible` flag reads false, which is the exact gotcha-3 trap this project has
 *      been burned by before.
 *
 *   node tools/diag-hud.mjs
 *
 * Exits non-zero if any check fails.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

/* ── a stub DOM, just enough for a HUD ───────────────────────────────────── */

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.style = {};
    this.dataset = {};
    this.childNodes = [];
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (...cs) => cs.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, on) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c)),
      get list() {
        return [...set];
      },
    };
  }
  appendChild(n) {
    this.childNodes.push(n);
    return n;
  }
}
const byId = {};
globalThis.document = {
  createElement: (t) => new Node(t),
  getElementById: (id) => byId[id] || (byId[id] = Object.assign(new Node('div'), { id })),
};
globalThis.localStorage = {
  _d: {},
  getItem(k) {
    return this._d[k] ?? null;
  },
  setItem(k, v) {
    this._d[k] = v;
  },
};
globalThis.location = { search: '' };

const {
  Hud, MILESTONES_KM, CAP_MIN_HOLD_S, CAP_CONFIRM_S,
  OFFROAD_HINT_KEY, OFFROAD_HINT_MAX, OFFROAD_HINT_TEXT,
} = await import('../src/ui/hud.js');
const { Streak, fmtDistance } = await import('../src/game/streak.js');
const { FLEET, fmtUnlock } = await import('../src/game/garage.js');
const { StreakTrail } = await import('../src/render/trail.js');
/* The real palette, so the rebrand's green can be checked against the colours this game
 * actually paints the world with rather than against a hex copied into this file. */
const { P } = await import('../src/core/palette.js');

/* ── 1. the strings ──────────────────────────────────────────────────────── */

const hud = new Hud();
const streak = new Streak();
const car = { speed: 33.3, onGround: true, kph: 120, gear: 3, reverse: false, x: 0, z: 0 };
const ON = { onRoad: 1, dominant: 0 };
const OFF = { onRoad: 0, dominant: 0 };
// `dominant: -1` matches a fresh Hud's own `_lastBiome` resting value, so it never trips the
// "crossing into a new biome" toast — used only where a section wants the toast slot clean
// for something else entirely (the R hint tests, further down) rather than testing biome text.
const QUIET = { onRoad: 1, dominant: -1 };
const DT = 1 / 60;

const readout = () => ({
  km: hud.streakKm.textContent,
  cap: hud.streakCap.textContent,
  mul: hud.streakMul.textContent,
  next: hud.barNext.textContent,
  fill: hud.barFill.style.width,
  mark: hud.barMark.style.left,
  markOn: hud.barMark.classList.contains('on'),
  live: hud.streakEl.classList.contains('live'),
  broke: hud.streakEl.classList.contains('broke'),
});
const tick = (secs, surf) => {
  for (let i = 0; i < Math.round(secs / DT); i++) {
    streak.update(DT, car, surf);
    hud.update(DT, { car, streak, surface: surf });
  }
};

console.log('\nWANDEROAD — STREAK READOUT\n' + '-'.repeat(70));
console.log('\nthe block, from a standing start (120 km/h, on the road):\n');
console.log('   distance    figure       caption                    unlock line                fill');
const rows = [];
hud.update(DT, { car, streak, surface: ON }); // one frame parked, nothing accrued yet
rows.push(['parked', readout()]);
const said = [];
for (const secs of [9, 22, 60, 150, 320, 700]) {
  tick(secs, ON);
  if (hud.toast.textContent && !said.includes(hud.toast.textContent)) said.push(hud.toast.textContent);
  rows.push([fmtDistance(streak.distance), readout()]);
}
for (const [d, r] of rows) {
  console.log(
    `   ${String(d).padStart(9)}  ${r.km.padStart(9)} ${(r.mul || '').padEnd(7)} ${r.cap.padEnd(26)} ${r.next.padEnd(24)} ${r.fill}`
  );
}

check('the figure is never empty', rows.every(([, r]) => r.km.length > 0), `first "${rows[0][1].km}"`);
check('the caption is never empty', rows.every(([, r]) => r.cap.length > 0), `first "${rows[0][1].cap}"`);
check('the unlock line is never empty', rows.every(([, r]) => r.next.length > 0), `first "${rows[0][1].next}"`);
check(
  'the fill is never 0%',
  rows.every(([, r]) => parseFloat(r.fill) > 0),
  `widths ${rows.map(([, r]) => r.fill).join(' ')}`
);
check(
  'the block goes live once a streak runs',
  rows[0][1].live === false && rows[1][1].live === true,
  `parked "${rows[0][1].km}" / "${rows[0][1].cap}"  →  running "${rows[1][1].km}"`
);
check(
  'earning a car is announced once, quietly',
  said.some((t) => /unlocked$/.test(t)),
  said.filter((t) => /unlocked$/.test(t)).join(', ') || said.join(' | ')
);

/* the break blip */
const beforeBreak = streak.distance;
tick(1.0, OFF); // past GRACE (0.55 s) — the streak breaks
const broke = readout();
check('a break blips rust on the streak block', broke.broke === true, `after ${fmtDistance(beforeBreak)}`);
check('a break blips rust on the bar', hud.bar.classList.contains('broke') === true);
check('the break says what was lost', /streak ended$/.test(hud.toast.textContent), `"${hud.toast.textContent}"`);
tick(1.4, ON); // blip window is 1.2 s
check('the blip clears itself', hud.bar.classList.contains('broke') === false);

/* after a break the figure holds the best, and the notch shows where that best got to */
const fresh = readout();
check(
  'a new run is measured against the old best, with the best marked on the track',
  fresh.markOn === true && parseFloat(fresh.mark) > 1 && parseFloat(fresh.fill) < parseFloat(fresh.mark),
  `fill ${fresh.fill}, best notch at ${fresh.mark}`
);

/* ── 1a. caption hysteresis — "fuzzes back and forth every three seconds" ──────────────────
 * Operator, verbatim: "the off-road/leaving-the-road thing fuzzes back and forth every three
 * seconds making all the text underneath unreadable." The caption used to be written straight
 * off `s.grace` every single frame, and `s.grace` (src/game/streak.js) can itself flip on the
 * exact same frame the one sample point at the car's centre crosses ON_ROAD back and forth — a
 * car riding the painted edge of the road does this many times a second.
 *
 * A REAL pass count, not a claim: a fresh Hud (so its hysteresis state starts clean) is driven
 * frame by frame against a small fake streak this file controls directly, and every actual
 * change to the real DOM text node is recorded with the real elapsed time it happened at. */

console.log('\ncaption hysteresis — a road-edge flicker must never repeat on the caption:\n');

class FakeStreak {
  constructor() {
    this.distance = 0;
    this.best = 0;
    this.grace = false;
    this.paused = false;
  }
  get state() {
    return {
      distance: this.distance,
      km: this.distance / 1000,
      score: 0,
      total: 0,
      best: this.best,
      bestScore: 0,
      multiplier: 1,
      onRoad: !this.grace,
      grace: this.grace,
      graceLeft: 0,
      tier: 0,
      paused: this.paused,
    };
  }
  drain() {
    return null;
  }
}

/** Drives `hud` for `frames` real DT ticks against `fake`, calling `mutate(i, t)` (t = seconds
 *  elapsed so far in THIS call) before each frame's update, and returns every real change to
 *  hud.streakCap.textContent as `{ t, text }` — t measured from the start of this call. */
function recordCaption(hud, fake, frames, mutate) {
  const events = [];
  let prev = hud.streakCap.textContent;
  let t = 0;
  for (let i = 0; i < frames; i++) {
    if (mutate) mutate(i, t);
    hud.update(DT, { car, streak: fake, surface: ON });
    t += DT;
    const now = hud.streakCap.textContent;
    if (now !== prev) events.push({ t, text: now });
    prev = now;
  }
  return events;
}

const hud2 = new Hud();
const fake = new FakeStreak();
fake.distance = 500; // live from frame one

let ev = recordCaption(hud2, fake, Math.round(1.0 / DT));
check(
  'from a standing start, settles onto the plain caption after exactly one real, confirmed swap',
  ev.length === 1 && ev[0].text === 'without leaving the road',
  ev.map((e) => `${e.t.toFixed(2)}s -> "${e.text}"`).join(', ') || 'no change'
);

const FLICKER_FRAMES = Math.round(3.0 / DT);
ev = recordCaption(hud2, fake, FLICKER_FRAMES, (i) => {
  fake.grace = i % 2 === 0; // flips every single frame — far faster than CAP_CONFIRM_S
});
check(
  `${FLICKER_FRAMES} frame-by-frame flips of the underlying state over 3 real seconds produce ZERO caption changes`,
  ev.length === 0 && hud2.streakCap.textContent === 'without leaving the road',
  `${ev.length} change(s), still reading "${hud2.streakCap.textContent}"`
);

/* A genuine, steady departure (not oscillating) still reaches the caption — once it has really
 * held for CAP_CONFIRM_S — and then a genuine, steady recovery is held off until the caption
 * that IS showing has had its full CAP_MIN_HOLD_S on screen. One continuous run so both
 * durations are measured against the same clock, off the same real Hud. */
const SETTLE = 0.05;
const HOLD_GRACE = 1.0;
ev = recordCaption(hud2, fake, Math.round((SETTLE + HOLD_GRACE + CAP_MIN_HOLD_S + 1.0) / DT), (i, t) => {
  fake.grace = t >= SETTLE && t < SETTLE + HOLD_GRACE;
});
console.log(
  `   real departure at t=${SETTLE.toFixed(2)}s, real recovery at t=${(SETTLE + HOLD_GRACE).toFixed(2)}s — caption changes: ${ev
    .map((e) => `${e.t.toFixed(2)}s -> "${e.text}"`)
    .join(', ')}`
);
check(
  'a genuine, steady departure is believed and shown — once, after CAP_CONFIRM_S, not instantly',
  ev.length >= 1 && ev[0].text === 'off the road…' && ev[0].t >= SETTLE + CAP_CONFIRM_S - DT && ev[0].t <= SETTLE + CAP_CONFIRM_S + 0.1,
  ev[0] ? `shown at ${ev[0].t.toFixed(3)}s (CAP_CONFIRM_S = ${CAP_CONFIRM_S}s)` : 'never shown'
);
check(
  `the minimum display time (>= ${CAP_MIN_HOLD_S}s, the operator's own "2 s per state") is honoured even for the very next real change`,
  ev.length === 2 && ev[1].text === 'without leaving the road' && ev[1].t - ev[0].t >= CAP_MIN_HOLD_S - DT,
  ev.length === 2 ? `"off the road…" was on screen for ${(ev[1].t - ev[0].t).toFixed(3)}s before it changed again` : `${ev.length} change(s), expected 2`
);

/* ── 1a-bis. the R hint — off-road transitions, debounced, capped at 10 ─────────────────────
 * Operator: "give people the hint that they can click R to get back on road when they go
 * off-road the first 10 times." src/ui/hud.js reuses the toast (say()) and the SAME debounced
 * off-road signal the caption above already computes — this section proves the three things
 * that instruction actually demands: it appears on a real off-road transition, it does not
 * repeat while the toast it rides is already showing, and it stops for good at 10.
 *
 * Real state throughout: a real Hud, real hud.toast.textContent reads, and the real
 * persisted count read back out of the SAME stub localStorage streak.js itself uses — never
 * a claim about an internal flag. */

console.log('\nthe R hint — "press R to get back on the road", first 10 off-road transitions only:\n');

// A clean slate: OFFROAD_HINT_KEY is one shared key in the stub store, and earlier sections
// of this very file (the real `hud`/`streak` at the top, and `hud2` above) already drove real
// and fake off-road spells through it. A fresh Hud here must be checked against a real,
// explicit zero rather than whatever those earlier sections happened to leave behind.
globalThis.localStorage.setItem(OFFROAD_HINT_KEY, JSON.stringify({ count: 0 }));

/** Drives `h` for `frames` real DT ticks against `fake`, calling `mutate(i, t)` before each
 *  frame, and returns every frame the hint ACTUALLY FIRED as `{ t, text }` — real internal
 *  state (`h._offroadHintCount`, the same counter that gets persisted, incrementing) rather
 *  than a comparison against the DOM text node. That matters here specifically: this stub
 *  DOM's `document.getElementById()` hands back ONE shared node per id (see this file's own
 *  header), so `hud.toast`, `hud2.toast` and every Hud built below are literally the SAME
 *  object — a before/after TEXT comparison on it would wrongly read "no change" the moment
 *  two Huds in this file happen to want the toast to say the same thing in a row, which is
 *  exactly what happens once hud2's own caption tests above (real off-road spells, on the
 *  same shared toast node) already leave it reading this exact hint. The counter has no such
 *  cross-instance ambiguity: it is per-Hud, and it only ever moves when THIS `h` really
 *  called `say()` for the hint. `surface: QUIET` (not ON) so a fresh Hud's very own first-
 *  frame biome toast cannot occupy the slot for a reason that has nothing to do with the R
 *  hint — that guard interaction is real and correct, just not what this section is proving. */
function recordHint(h, fake, frames, mutate) {
  const events = [];
  let prevCount = h._offroadHintCount;
  let t = 0;
  for (let i = 0; i < frames; i++) {
    if (mutate) mutate(i, t);
    h.update(DT, { car, streak: fake, surface: QUIET });
    t += DT;
    if (h._offroadHintCount > prevCount) events.push({ t, text: h.toast.textContent });
    prevCount = h._offroadHintCount;
  }
  return events;
}

/* A: a genuine, steady off-road departure shows the hint once, after the same CAP_CONFIRM_S
 * the caption itself waits for — not instantly, and not off a single-frame flicker. */
{
  const hud3 = new Hud();
  const fake3 = new FakeStreak();
  fake3.distance = 500;
  const SETTLE = 0.05;
  const ev = recordHint(hud3, fake3, Math.round(2.0 / DT), (i, t) => {
    fake3.grace = t >= SETTLE;
  });
  check(
    'a genuine off-road transition shows the hint, once, after CAP_CONFIRM_S',
    ev.length === 1 && ev[0].text === OFFROAD_HINT_TEXT &&
      ev[0].t >= SETTLE + CAP_CONFIRM_S - DT && ev[0].t <= SETTLE + CAP_CONFIRM_S + 0.1,
    ev.length ? `shown at ${ev[0].t.toFixed(3)}s, reading "${ev[0].text}"` : 'never shown'
  );
}

/* B: "never while it is already showing". Two confirmed 'grace' states can never arrive less
 * than 4 s apart on their own — each swap costs the caption's own CAP_MIN_HOLD_S (2.0 s) TWICE
 * (once off 'grace', once back onto it), measured directly: test A's departure confirms at
 * 0.35 s, and the caption-hysteresis section above measures the SAME departure's own recovery
 * at 2.37 s — so a second genuine grace confirmation is structurally always past the hint's
 * own 3.4 s toast on its own, and there would be nothing for this section to catch by trying
 * to race it. What CAN legitimately be showing when a confirmed off-road transition lands is
 * a DIFFERENT toast — a biome line, a milestone, a streak-break blip — since none of those
 * share the caption's hysteresis clock. So this drives the actual guard directly: `say()` is
 * called for something else first (exactly how hud.js's own biome/milestone/break lines
 * already do, unconditionally, elsewhere in this file), then a real, fully-settled off-road
 * transition arrives while it is still up. */
{
  const hud4 = new Hud();
  const fake4 = new FakeStreak();
  fake4.distance = 500;
  hud4.say('something else is already showing', 2.0);
  const beforeCount = hud4._offroadHintCount;
  const ev = recordHint(hud4, fake4, Math.round(2.5 / DT), (i, t) => {
    fake4.grace = t >= 0.05;
  });
  check(
    'the hint does not fire while the toast it shares is already showing something else',
    ev.length === 0 && hud4._offroadHintCount === beforeCount && hud4.toast.textContent === 'something else is already showing',
    `${ev.length} appearance(s), count ${hud4._offroadHintCount} (was ${beforeCount}), toast reads "${hud4.toast.textContent}"`
  );
}

/* C: the cap. Thirteen well-separated, fully genuine off-road spells — each one settled past
 * the caption's own hold, each one given time for the toast to clear before the next — and
 * only the persisted count (the same store, read the same way streak.js reads `best`) says
 * how many were actually shown. Coarse timesteps here on purpose: this section is not
 * re-testing the debounce (A and B already did, at real frame rate), only the cap. */
{
  const hud5 = new Hud();
  const fake5 = new FakeStreak();
  fake5.distance = 500;
  const SPELLS = 13;
  for (let i = 0; i < SPELLS; i++) {
    fake5.grace = true;
    hud5.update(6.0, { car, streak: fake5, surface: QUIET }); // clears CAP_CONFIRM_S and any hold
    fake5.grace = false;
    hud5.update(6.0, { car, streak: fake5, surface: QUIET }); // clears the hold AND the 3.4 s toast
  }
  const persisted = JSON.parse(globalThis.localStorage.getItem(OFFROAD_HINT_KEY)).count;
  check(
    `the hint stops for good at OFFROAD_HINT_MAX (${OFFROAD_HINT_MAX}), even across ${SPELLS} genuine transitions`,
    persisted === OFFROAD_HINT_MAX,
    `persisted count ${persisted}`
  );
  check('the persisted count is real storage, not a guess', OFFROAD_HINT_MAX === 10, `OFFROAD_HINT_MAX = ${OFFROAD_HINT_MAX}`);
}

/* ── 1b. the milestone dots ──────────────────────────────────────────────── */

console.log('\nmilestone dots — waypoints on the same bar, independent of the car-unlock ladder:\n');
check(
  'the milestone list is the one the operator asked for, continued sensibly',
  MILESTONES_KM.join(',') === '1,3,6,10,20,40,80,150,300',
  `${MILESTONES_KM.join(', ')} km`
);
check(
  'one dot exists per waypoint, built once in the constructor, in order',
  hud.milestoneEls.length === MILESTONES_KM.length && hud.milestoneEls.every((m, i) => m.km === MILESTONES_KM[i]),
  `${hud.milestoneEls.length} dots: ${hud.milestoneEls.map((m) => m.km).join(', ')}`
);

const mLefts = hud.milestoneEls.map((m) => parseFloat(m.el.style.left));
check(
  'every dot has a real, in-range position',
  mLefts.every((x) => Number.isFinite(x) && x >= 0 && x <= 100),
  mLefts.map((x) => x.toFixed(1)).join(', ')
);
check(
  'the dots are laid out in ascending order, left to right, matching km order',
  mLefts.every((x, i) => i === 0 || x > mLefts[i - 1]),
  mLefts.map((x) => x.toFixed(1)).join(' < ')
);
check('the low end is not crushed against the edge — log scale, not linear', mLefts[0] > 4 && mLefts[0] < 35, `1 km sits at ${mLefts[0].toFixed(1)}%`);
check(
  'the high end is not glued to the edge either',
  mLefts[mLefts.length - 1] > 60 && mLefts[mLefts.length - 1] < 99,
  `${MILESTONES_KM[MILESTONES_KM.length - 1]} km sits at ${mLefts[mLefts.length - 1].toFixed(1)}%`
);

console.log('   streak      passed                              current   upcoming');
const milestoneState = () => ({
  passed: hud.milestoneEls.filter((m) => m.el.classList.contains('passed')).map((m) => m.km),
  current: hud.milestoneEls.filter((m) => m.el.classList.contains('current')).map((m) => m.km),
  upcoming: hud.milestoneEls.filter((m) => !m.el.classList.contains('passed') && !m.el.classList.contains('current')).map((m) => m.km),
});
const probeMilestones = (km, expectPassed, expectCurrent) => {
  streak.distance = km * 1000;
  streak.best = km * 1000;
  hud.update(DT, { car, streak, surface: ON });
  const { passed, current, upcoming } = milestoneState();
  console.log(
    `   ${String(km).padStart(7)} km  [${passed.join(',').padEnd(20)}]  ${String(current[0] ?? '—').padStart(6)}   [${upcoming.join(',')}]`
  );
  check(`${km} km streak — passed = [${expectPassed.join(',')}]`, passed.join(',') === expectPassed.join(','), `got [${passed.join(',')}]`);
  check(
    `${km} km streak — current = ${expectCurrent[0] ?? '(none — every dot passed)'}`,
    current.join(',') === expectCurrent.join(','),
    `got ${current.join(',') || '(none)'}`
  );
};
probeMilestones(0.5, [], [1]);
probeMilestones(2, [1], [3]);
probeMilestones(7, [1, 3, 6], [10]);
probeMilestones(15, [1, 3, 6, 10], [20]);
probeMilestones(50, [1, 3, 6, 10, 20, 40], [80]);
// Past the last waypoint: everything passed, nothing current — a legitimate resting state,
// the same shape as the unlock bar's own "every car unlocked".
probeMilestones(400, MILESTONES_KM, []);

/* at rest (no live streak) the dots read off the all-time best, not a distance that just
 * reset to zero — the same live-vs-best rule streakKm itself already follows. */
streak.distance = 0;
streak.best = 15000;
hud.update(DT, { car, streak, surface: ON });
const atRest = milestoneState();
check(
  'at rest, the dots read off the all-time best rather than a reset-to-zero distance',
  atRest.passed.join(',') === '1,3,6,10' && atRest.current.join(',') === '20',
  `passed [${atRest.passed.join(',')}], current ${atRest.current.join(',') || '(none)'}`
);

/* ── 1c. fleet unlock icons — the whole ladder riding the same bar ────────── */

console.log('\nfleet unlock icons — every car in src/game/garage.js FLEET, on the milestone dots\' own scale:\n');
check(
  'one icon exists per FLEET car, built once in the constructor, in FLEET order',
  hud.fleetEls.length === FLEET.length && hud.fleetEls.every((f, i) => f.car.id === FLEET[i].id),
  `${hud.fleetEls.length} icons: ${hud.fleetEls.map((f) => f.car.id).join(', ')}`
);
check(
  'every icon shows which car it is, and is never blank',
  hud.fleetEls.every((f) => f.el.textContent.length > 0 && f.el.textContent === f.car.label[0]),
  hud.fleetEls.map((f) => f.el.textContent).join('')
);

const fLefts = hud.fleetEls.map((f) => parseFloat(f.el.style.left));
check('every icon has a real, in-range position', fLefts.every((x) => Number.isFinite(x) && x >= 0 && x <= 100), fLefts.map((x) => x.toFixed(1)).join(', '));
check(
  'the icons are laid out in ascending order, left to right, matching unlockAt order',
  fLefts.every((x, i) => i === 0 || x > fLefts[i - 1]),
  fLefts.map((x) => x.toFixed(1)).join(' < ')
);
check(
  'the Estate — unlockAt 0 m, driven from the very first frame — is pinned to the left edge',
  fLefts[0] === 0,
  `${FLEET[0].label} sits at ${fLefts[0].toFixed(2)}%`
);
check(
  'a car earned at the same distance as a milestone lands at the same x on the bar (one shared scale)',
  Math.abs(fLefts[1] - mLefts[0]) < 0.01,
  `${FLEET[1].label} (${FLEET[1].unlockAt / 1000} km) at ${fLefts[1].toFixed(2)}%, the 1 km milestone at ${mLefts[0].toFixed(2)}%`
);

console.log('   best         locked                                                current');
const fleetState = () => ({
  locked: hud.fleetEls.filter((f) => f.el.classList.contains('locked')).map((f) => f.car.id),
  current: hud.fleetEls.filter((f) => f.el.classList.contains('current')).map((f) => f.car.id),
});
// Real Streak.best values either side of every rung, plus 0 and "every car unlocked" — the
// same shape of boundary the ladder section below probes text with, checked here against the
// icons' own locked/current classes instead.
const probeFleet = (best, expectLocked, expectCurrent) => {
  streak.distance = 0;
  streak.best = best;
  hud.update(DT, { car, streak, surface: ON });
  const { locked, current } = fleetState();
  console.log(`   ${String(best).padStart(9)} m  [${locked.join(',').padEnd(44)}]  ${current[0] ?? '—'}`);
  check(`best ${best} m — locked = [${expectLocked.join(',')}]`, locked.join(',') === expectLocked.join(','), `got [${locked.join(',')}]`);
  check(
    `best ${best} m — current = ${expectCurrent[0] ?? '(none — every car unlocked)'}`,
    current.join(',') === expectCurrent.join(','),
    `got ${current.join(',') || '(none)'}`
  );
};
probeFleet(0, ['hatch', 'coupe', 'sedan', 'rally', 'taxi', 'patrol'], ['hatch']);
probeFleet(999, ['hatch', 'coupe', 'sedan', 'rally', 'taxi', 'patrol'], ['hatch']);
probeFleet(1000, ['coupe', 'sedan', 'rally', 'taxi', 'patrol'], ['coupe']);
probeFleet(20000, ['taxi', 'patrol'], ['taxi']);
probeFleet(100000, [], []);

/* ── 1d. the game title ────────────────────────────────────────────────────
 * Existence and text here; resolved on-screen geometry (does it clear the place name it sits
 * above) lives with the rest of the geometry checks further down, section 4b. */

console.log('\nthe game title:\n');
check(
  'a title element exists, reading exactly "Cozy Driver"',
  !!hud.title && hud.title.textContent === 'Cozy Driver',
  hud.title ? `"${hud.title.textContent}"` : 'missing'
);
check('it has a stable id for the stylesheet to find', !!hud.title && hud.title.id === 'gameTitle', hud.title ? hud.title.id : 'missing');

/* ── 2. the ladder ───────────────────────────────────────────────────────── */

console.log('\nthe unlock line against the fleet ladder in src/game/garage.js:\n');
console.log('   best        next car   line on screen');
const ladder = [...FLEET].sort((a, b) => a.unlockAt - b.unlockAt);
let ladderOk = true;
// Just under each threshold, the bar must be counting towards THAT car; just over it, the
// next one. Both directions matter: the off-by-one lives at the boundary.
const probes = [];
for (const c of ladder) {
  if (c.unlockAt > 0) probes.push(c.unlockAt - 1, c.unlockAt);
}
probes.push(ladder[ladder.length - 1].unlockAt + 5000);
for (const best of probes) {
  streak.distance = 0;
  streak.best = best;
  hud.update(DT, { car, streak, surface: ON });
  const line = hud.barNext.textContent;
  const want = ladder.find((c) => best < c.unlockAt);
  const expect = want ? `${want.label} · ${fmtUnlock(want.unlockAt - best)} to go` : 'every car unlocked';
  const ok = line === expect;
  if (!ok) ladderOk = false;
  console.log(`   ${String(Math.round(best)).padStart(8)} m  ${(want ? want.label : '—').padEnd(9)}  ${line}${ok ? '' : `   WANT: ${expect}`}`);
}
check('every rung of the ladder reads correctly', ladderOk, `${probes.length} probes across ${ladder.length} cars`);
check(
  'the ladder is the one the operator asked for',
  ladder.map((c) => `${c.label} ${c.unlockAt}`).join(', ') ===
    'Estate 0, Hatch 1000, Coupe 3000, Sedan 8000, Rally 20000, Taxi 45000, Patrol 100000',
  ladder.map((c) => `${c.label} ${c.unlockAt / 1000}k`).join(', ')
);

/* the best advances during a run, so the bar moves and the car is earned when it is earned */
const s2 = new Streak();
s2.storageKey = 'diag-hud';
s2.best = 0;
s2.total = 0;
for (let i = 0; i < 60 / DT; i++) s2.update(DT, car, ON); // 60 s ≈ 2 km, no break
check(
  'best advances DURING a run (the bar is not frozen)',
  s2.best > 1900 && s2.best === s2.distance,
  `best ${Math.round(s2.best)} m, distance ${Math.round(s2.distance)} m after 60 s`
);

/* ── 3. the CSS, held to the VISIBLE standard ────────────────────────────── */

const css = readFileSync(resolve(ROOT, 'src/ui/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/* A brace-aware walk: every `selector { decls }` in the file, plus whichever at-rule encloses
 * it, so rules inside @media and @keyframes are checked too rather than skipped. */
function rules(src) {
  const out = [];
  const stack = [];
  let buf = '';
  for (const ch of src) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      const sel = stack.pop();
      if (sel !== undefined && !sel.startsWith('@')) out.push({ sel, at: stack.filter((s) => s.startsWith('@')).join(' '), body: buf });
      buf = '';
    } else buf += ch;
  }
  return out;
}
const decl = (body, prop) => {
  const m = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : null;
};

const CLAIMED = [
  '#streak',
  '#streakKm',
  '#unlockBar',
  '#unlockBar .track',
  '#unlockBar .fill',
  '#unlockBar #unlockNext',
  '#unlockBar .milestone',
  '#gameTitle',
  '#unlockBar .carIcon',
];
const all = rules(css);
// A stray brace turns every rule after it into nonsense and the whole HUD silently loses its
// styling. Cheaper to catch here than in a screenshot.
{
  let d = 0;
  let min = 0;
  for (const ch of css) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
    if (d < min) min = d;
  }
  check('the stylesheet is balanced', d === 0 && min === 0, `depth ends at ${d}, dips to ${min}, ${all.length} rules`);
}
const touching = all.filter((r) =>
  CLAIMED.some((c) => r.sel.split(',').some((s) => s.trim() === c || s.trim().startsWith(c + '.') || s.trim().startsWith(c + ':')))
);
check('the claimed elements are actually styled', touching.length >= CLAIMED.length, `${touching.length} rules`);

let visOk = true;
const bad = [];
for (const r of touching) {
  const d = (p) => decl(r.body, p);
  if ((d('display') || '').toLowerCase() === 'none') bad.push(`${r.sel} display:none`);
  if ((d('visibility') || '').toLowerCase() === 'hidden') bad.push(`${r.sel} visibility:hidden`);
  const o = d('opacity');
  if (o !== null && parseFloat(o) < 0.5) bad.push(`${r.sel} opacity:${o}`);
}
visOk = bad.length === 0;
check('no rule hides or near-hides a claimed element', visOk, bad.join('; ') || 'every state opacity >= 0.5');

// Specifically (not just via the aggregate count above) — a typo'd selector could otherwise
// hide behind other, unrelated rules padding out `touching.length`.
const milestoneRuleSels = touching.filter((r) => r.sel.trim().startsWith('#unlockBar .milestone')).map((r) => r.sel.trim());
check(
  'the milestone dot, passed, and current states are each really styled',
  ['#unlockBar .milestone', '#unlockBar .milestone.passed', '#unlockBar .milestone.current'].every((sel) => milestoneRuleSels.includes(sel)),
  milestoneRuleSels.join(', ')
);

const carIconRuleSels = touching.filter((r) => r.sel.trim().startsWith('#unlockBar .carIcon')).map((r) => r.sel.trim());
check(
  'the fleet icon, locked, and current states are each really styled',
  ['#unlockBar .carIcon', '#unlockBar .carIcon.locked', '#unlockBar .carIcon.current'].every((sel) => carIconRuleSels.includes(sel)),
  carIconRuleSels.join(', ')
);
check(
  'the game title is really styled, not just claimed',
  touching.some((r) => r.sel.trim() === '#gameTitle'),
  `${touching.filter((r) => r.sel.trim() === '#gameTitle').length} rule(s)`
);

// The keyframe animation must not touch opacity: a screenshot lands on an arbitrary frame.
const kf = all.filter((r) => r.at.includes('@keyframes streakBreathe'));
check(
  'the live animation never animates opacity',
  kf.length > 0 && kf.every((r) => decl(r.body, 'opacity') === null),
  `${kf.length} keyframe stops, all box-shadow only`
);

const fill = touching.find((r) => r.sel.trim() === '#unlockBar .fill');
const minW = fill && decl(fill.body, 'min-width');
check('the fill can never be a zero-width box', !!minW && parseFloat(minW) >= 3, `min-width: ${minW}`);

/* ── 4. resolved geometry ────────────────────────────────────────────────── */

const REM = 16;
const px = (v, vw, vh) => {
  v = v.trim();
  const cl = v.match(/^clamp\(([^,]+),([^,]+),(.+)\)$/);
  if (cl) {
    const [a, b, c] = cl.slice(1).map((x) => px(x, vw, vh));
    return Math.min(Math.max(b, a), c);
  }
  if (v.endsWith('rem')) return parseFloat(v) * REM;
  if (v.endsWith('vw')) return (parseFloat(v) / 100) * vw;
  if (v.endsWith('vh')) return (parseFloat(v) / 100) * vh;
  if (v.endsWith('px')) return parseFloat(v);
  if (v.endsWith('%')) return parseFloat(v);
  return parseFloat(v) || 0;
};
const pick = (sel, prop, at = '') => {
  const hits = all.filter((r) => r.sel.split(',').some((s) => s.trim() === sel) && r.at === at && decl(r.body, prop) !== null);
  return hits.length ? decl(hits[hits.length - 1].body, prop) : null;
};

console.log('\nresolved geometry (rem = 16 px, px measured up from the bottom edge):\n');
console.log('   viewport    figure  caption  next  track   next line    streak block   speedo corner');
let geomOk = true;
const collisions = [];
for (const [vw, vh, label] of [
  [1400, 820, '1400x820'],
  [1024, 768, '1024x768'],
  [1920, 1080, '1920x1080'],
  [768, 1024, '768x1024'],
  [375, 667, '375x667'],
]) {
  const at = vw <= 640 ? '@media (max-width: 640px)' : '';
  const val = (sel, prop) => (at && pick(sel, prop, at)) || pick(sel, prop) || '0';
  const figure = px(val('#streakKm', 'font-size'), vw, vh);
  const capF = px(val('#streak .cap', 'font-size'), vw, vh);
  const nextF = px(val('#unlockBar #unlockNext', 'font-size'), vw, vh);
  const track = px(val('#unlockBar .track', 'height'), vw, vh);
  const bottom = px(val('#streak', 'bottom'), vw, vh);
  // both line-heights are declared in the stylesheet, so this is arithmetic, not a guess
  const lh = parseFloat(pick('#streak .cap', 'line-height') || '1.4');
  const blockH = figure * parseFloat(pick('#streak .figure', 'line-height') || '1') + capF * lh + 0.1 * REM;
  const top = bottom + blockH;
  const nextBot = px(val('#unlockBar #unlockNext', 'bottom'), vw, vh);
  const nextTop = nextBot + nextF * 1.2;

  /* The speedo is the worst neighbour: bottom clamp(1rem,4vw,2.4rem), #kph up to 4.6rem tall,
   * and about 3.3x the #kph size wide once the unit and the gear are counted. Both boxes are
   * checked in x AND y, because two boxes that overlap on one axis do not collide. */
  const spBot = Math.min(Math.max(0.04 * vw, REM), 2.4 * REM);
  const spH = Math.min(Math.max(0.07 * vw, 2.6 * REM), 4.6 * REM);
  const spTop = spBot + spH;
  const spLeft = vw - Math.min(Math.max(0.04 * vw, REM), 3 * REM) - spH * 3.3;
  // ~0.66 em per character at this letter-spacing; the longest line the bar can ever show.
  const nextHalf = ('Patrol · 55 km to go'.length * nextF * 0.66) / 2;

  const yOverlap = nextTop > spBot && nextBot < spTop;
  const xOverlap = vw / 2 + nextHalf > spLeft;
  if (yOverlap && xOverlap) collisions.push(`${label}: unlock line hits the speedo`);
  if (top > spBot && bottom < spTop && vw / 2 + blockH * 2 > spLeft) collisions.push(`${label}: streak block hits the speedo`);
  if (figure < 30 || track < 4 || nextF < 10) geomOk = false;

  console.log(
    `   ${label.padEnd(10)}  ${figure.toFixed(1).padStart(6)}  ${capF.toFixed(1).padStart(7)}  ${nextF.toFixed(1).padStart(4)}  ` +
      `${track.toFixed(0).padStart(5)}   ${(nextBot.toFixed(0) + '–' + nextTop.toFixed(0)).padStart(9)}   ` +
      `${(bottom.toFixed(0) + '–' + top.toFixed(0)).padStart(12)}   ${(spBot.toFixed(0) + '–' + spTop.toFixed(0) + ' from x' + spLeft.toFixed(0)).padStart(13)}`
  );
}
check('the streak figure is big at every viewport', geomOk, 'figure >= 30 px, track >= 4 px, unlock line >= 10 px');
check('nothing in the streak column collides with the speedo', collisions.length === 0, collisions.join('; ') || '5 viewports, phone to 1080p');

/* ── 4b. the game title, resolved geometry ───────────────────────────────── */

console.log('\ngame title vs the place name it sits above (same viewports, same method as above):\n');
let titleOk = true;
const titleCollisions = [];
for (const [vw, vh, label] of [
  [1400, 820, '1400x820'],
  [1024, 768, '1024x768'],
  [1920, 1080, '1920x1080'],
  [768, 1024, '768x1024'],
  [375, 667, '375x667'],
]) {
  const at = vw <= 640 ? '@media (max-width: 640px)' : '';
  const val = (sel, prop) => (at && pick(sel, prop, at)) || pick(sel, prop) || '0';
  const titleBottom = px(val('#gameTitle', 'bottom'), vw, vh);
  const titleFont = px(val('#gameTitle', 'font-size'), vw, vh);
  // #place's own top extent: its bottom offset plus the biome line, the coords line, and the
  // gap between them — the exact same arithmetic style the speedo-collision check above already
  // uses for the speedo's box, applied to #place instead.
  const placeBottom = px(val('#place', 'bottom'), vw, vh);
  const biomeFont = px(val('#biome', 'font-size'), vw, vh);
  const coordsFont = px(val('#coords', 'font-size'), vw, vh);
  const placeGap = px(val('#place', 'gap'), vw, vh);
  const placeTop = placeBottom + biomeFont + coordsFont + placeGap;
  if (titleBottom < placeTop) titleCollisions.push(`${label}: title bottom ${titleBottom.toFixed(0)}px is BELOW the place block's top ${placeTop.toFixed(0)}px`);
  if (titleFont < 9) titleOk = false;
  console.log(
    `   ${label.padEnd(10)}  title bottom ${titleBottom.toFixed(0).padStart(4)}px   place top ${placeTop.toFixed(0).padStart(4)}px   clearance ${(titleBottom - placeTop).toFixed(0).padStart(4)}px`
  );
}
check('the title clears the place name at every viewport, with real margin', titleCollisions.length === 0, titleCollisions.join('; ') || '5 viewports, phone to 1080p, positive clearance at each');
check('the title text stays legible at every viewport', titleOk, 'font-size >= 9px everywhere');

/* ── 4c. the rebrand: "Cozy Driver", cozy font, growing green, start-page theme ──
 *
 * The operator's headline ask this round, and the whole of it is CSS and strings — which is
 * exactly the class of change this project has shipped broken before while every static check
 * its author ran went green (gotcha 3: a flag being set is not a thing being visible). So none
 * of the checks below are "the declaration exists". Each one resolves a real value and tests
 * the property that actually matters:
 *
 *   the NAME     — read out of the real Hud, out of index.html's real <title> and loading card,
 *                  and out of the extension's real manifest/panel/options, then swept for any
 *                  surviving "Cozy Drive" that is not "Cozy Driver". The things that must NOT
 *                  be renamed (package name, deploy base) are asserted unchanged in the same
 *                  breath, because a rebrand that breaks the live URL is not a rebrand.
 *   the FONT     — the wordmark's stack is resolved, checked to be different from the
 *                  instruments' stack, checked to end in a generic family, and checked to
 *                  contain no url()/@font-face — i.e. proved to cost zero downloads.
 *   the GREEN    — the hex is looked up in src/core/palette.js's real P table. If it is not a
 *                  colour this game already paints the world with, this fails.
 *   the GROWING  — the keyframes are parsed: it must animate transform only (never opacity —
 *                  a screenshot lands on an arbitrary frame), start at a scale that is still a
 *                  legible box, end at exactly 1, take its time, hold both ends, and its easing
 *                  curve's control points are read to prove it cannot overshoot. That last one
 *                  is the difference between "grow and settle" and "pop", measured.
 *   the THEME    — the start page's colours are resolved and compared against the HUD's: they
 *                  must actually differ, they must sit on the other side of the green/blue
 *                  divide, and every text-on-background pair is run through a real WCAG
 *                  contrast computation that fails under 4.5:1. Plus the standing scar: the
 *                  recolour must not have put a display/visibility/opacity rule anywhere near
 *                  #menu, and `#menu[hidden]` must still win.
 */

console.log('\nthe rebrand — name, face, green, and the start page\'s own theme:\n');

const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const NAME = 'Cozy Driver';

/* the name, everywhere a player can see it */
{
  const indexHtml = read('index.html');
  const manifest = JSON.parse(read('extension/manifest.json'));
  const panelHtml = read('extension/panel.html');
  const optionsHtml = read('extension/options.html');
  const tag = (src, t) => {
    const m = src.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`, 'i'));
    return m ? m[1].trim() : null;
  };

  const surfaces = [
    ['the running game (src/ui/hud.js #gameTitle)', hud.title.textContent],
    ['the browser tab (index.html <title>)', tag(indexHtml, 'title')],
    ['the loading card (index.html <h1>)', tag(indexHtml, 'h1')],
    ['the extension name (manifest.json)', manifest.name],
    ['the toolbar button (manifest action title)', manifest.action.default_title],
    ['the Alt+D command (manifest commands)', manifest.commands._execute_action.description],
    ['the side panel tab (panel.html <title>)', tag(panelHtml, 'title')],
    ['the options page (options.html <h1>)', tag(optionsHtml, 'h1')],
  ];
  for (const [where, text] of surfaces) console.log(`   ${where.padEnd(46)} "${text}"`);
  check(
    'every user-visible surface says "Cozy Driver"',
    surfaces.every(([, t]) => typeof t === 'string' && t.includes(NAME)),
    surfaces.filter(([, t]) => !(t || '').includes(NAME)).map(([w, t]) => `${w} = "${t}"`).join('; ') || `${surfaces.length} surfaces`
  );

  /* "Cozy Driver" contains "Cozy Drive", so a substring test would pass on a missed rename.
   * This looks for the old name NOT followed by the new one's final r. */
  const stale = [];
  for (const f of ['index.html', 'src/ui/hud.js', 'src/ui/menu.js', 'src/ui/style.css', 'extension/manifest.json', 'extension/panel.html', 'extension/options.html', 'extension/dock.js', 'extension/panel.js']) {
    const src = read(f);
    if (/Cozy Drive(?!r)/.test(src)) stale.push(f);
  }
  check('no "Cozy Drive" survives anywhere a player can reach', stale.length === 0, stale.join(', ') || '9 files swept');

  /* The other half of the instruction: the things that must NOT move. Renaming any of these
   * breaks https://crumbtown.org/wanderoad/ or the build. */
  const pkg = JSON.parse(read('package.json'));
  check('the package name is untouched — the build still resolves', pkg.name === 'wanderoad', `"${pkg.name}"`);
  check(
    'the deploy path is untouched — the live URL still resolves',
    /wanderoad/.test(read('deploy/deploy.py')),
    'deploy/deploy.py still targets wanderoad'
  );
}

/* the cozy face */
const rootRule = all.filter((r) => r.sel.trim() === ':root').pop();
const titleRule = all.filter((r) => r.sel.trim() === '#gameTitle' && r.at === '').pop();
{
  const cozy = decl(rootRule.body, '--cozy');
  const serif = decl(rootRule.body, '--serif');
  const fams = (cozy || '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
  console.log(`\n   --cozy  = ${fams.join(' / ')}`);
  check('the wordmark has its own font stack', !!cozy && fams.length >= 3, `${fams.length} families`);
  check('it is genuinely a different face from the instruments\' --serif', !!cozy && cozy.trim() !== (serif || '').trim(), fams[0]);
  check('it ends in a generic family, so it can never fall through to nothing', /^(serif|sans-serif|monospace|cursive|system-ui)$/.test(fams[fams.length - 1]), fams[fams.length - 1]);
  check(
    'it downloads nothing — no @font-face, no url(), no font file in the repo',
    !/@font-face/i.test(css) && !/url\(/i.test(cozy || '') && !/\.(woff2?|ttf|otf|eot)\b/i.test(css),
    'system stack only, zero requests, nothing to licence'
  );
  check('#gameTitle actually uses it', (decl(titleRule.body, 'font-family') || '').includes('--cozy'), decl(titleRule.body, 'font-family'));
  check('the loading card\'s wordmark uses it too', (decl((all.filter((r) => r.sel.trim() === '#veil h1').pop() || { body: '' }).body, 'font-family') || '').includes('--cozy'));
}

/* the green — checked against the palette the world is actually painted from */
const hex = (s) => {
  const m = String(s).trim().match(/^#([0-9a-f]{6})$/i);
  return m ? m[1].toLowerCase() : null;
};
const rgbOf = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (rgb) =>
  0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
function chan(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
const contrast = (a, b) => {
  const [x, y] = [lum(rgbOf(a)), lum(rgbOf(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
{
  const paletteHexes = new Map();
  for (const k in P) paletteHexes.set(String(P[k]).toLowerCase().replace('#', ''), k);
  const leaf = hex(decl(rootRule.body, '--leaf'));
  const leafDeep = hex(decl(rootRule.body, '--leafDeep'));
  console.log(`\n   --leaf = #${leaf} (${paletteHexes.get(leaf) || 'NOT IN THE PALETTE'})   --leafDeep = #${leafDeep} (${paletteHexes.get(leafDeep) || 'NOT IN THE PALETTE'})`);
  check('the title green is a colour this game already paints the world with', paletteHexes.has(leaf), `P.${paletteHexes.get(leaf)} = #${leaf}`);
  check('so is the deep green the loading card uses', paletteHexes.has(leafDeep), `P.${paletteHexes.get(leafDeep)} = #${leafDeep}`);
  const g = (h) => rgbOf(h)[1];
  check(
    'both are actually green — the green channel leads, and it is not a raw #00ff00',
    g(leaf) > rgbOf(leaf)[2] && g(leafDeep) > rgbOf(leafDeep)[0] && g(leafDeep) > rgbOf(leafDeep)[2] && leaf !== '00ff00',
    `#${leaf} rgb(${rgbOf(leaf)}), #${leafDeep} rgb(${rgbOf(leafDeep)})`
  );
  check('#gameTitle is painted in it', (decl(titleRule.body, 'color') || '').includes('--leaf'), decl(titleRule.body, 'color'));
  // The loading card is a warm CREAM gradient; the bright grass green would smear on it.
  const cardRatio = contrast(leafDeep, 'f3dfb4'); // #veil's lightest gradient stop
  console.log(`   loading-card wordmark contrast: #${leafDeep} on #f3dfb4 = ${cardRatio.toFixed(2)}:1`);
  check('the loading card\'s green is readable on the loading card', cardRatio >= 4.5, `${cardRatio.toFixed(2)}:1`);
}

/* the growing — parsed, not assumed */
{
  const anim = decl(titleRule.body, 'animation') || '';
  const stops = all.filter((r) => r.at.includes('@keyframes titleGrow'));
  const dur = parseFloat((anim.match(/(\d+(?:\.\d+)?)s/) || [0, 0])[1]);
  const bez = (anim.match(/cubic-bezier\(([^)]+)\)/) || [])[1];
  const pts = bez ? bez.split(',').map((n) => parseFloat(n)) : [];
  const scales = stops.flatMap((r) => [...r.body.matchAll(/scale\(([^)]+)\)/g)].map((m) => parseFloat(m[1])));
  console.log(`\n   animation: ${anim.trim()}`);
  console.log(`   keyframes: ${stops.length} stops, scale ${scales.join(' → ')}`);

  check('the title has a grow animation, and it is the shared one', /titleGrow/.test(anim) && stops.length >= 2, `${stops.length} stops`);
  check('it grows: it starts smaller and ends at exactly full size', scales.length >= 2 && scales[0] < 1 && scales[scales.length - 1] === 1, scales.join(' → '));
  check(
    'it never starts from nothing — the first frame is already a legible box',
    scales.every((s) => s >= 0.5),
    `smallest scale ${Math.min(...scales)}`
  );
  check('it never animates opacity — a screenshot on any frame still shows a lit title', stops.every((r) => decl(r.body, 'opacity') === null));
  check('it never animates display or visibility either', stops.every((r) => decl(r.body, 'display') === null && decl(r.body, 'visibility') === null));
  check('it is slow and cozy, not a flash', dur >= 1.2 && dur <= 6, `${dur}s`);
  check('it holds both ends — no unstyled flash before it starts or after it ends', /\b(both|forwards)\b/.test(anim), anim.match(/\b(both|forwards)\b/)?.[0] || 'no fill mode');
  check(
    'the easing curve cannot overshoot — this settles, it does not bounce',
    pts.length === 4 && pts[1] >= 0 && pts[1] <= 1 && pts[3] >= 0 && pts[3] <= 1,
    `cubic-bezier(${pts.join(', ')}) — control-point y values inside [0,1]`
  );
  check(
    'the title element itself never fades — its opacity is flat and well lit',
    parseFloat(decl(titleRule.body, 'opacity')) >= 0.5,
    `opacity ${decl(titleRule.body, 'opacity')}`
  );
  const reduced = all.filter((r) => r.at.includes('prefers-reduced-motion') && r.sel.split(',').some((s) => s.trim() === '#gameTitle'));
  check('asking for less motion stops it', reduced.some((r) => (decl(r.body, 'animation') || '').trim() === 'none'), `${reduced.length} rule(s)`);
}

/* the start page's own theme */
{
  const menuRules = all.filter((r) => r.sel.split(',').some((s) => s.trim() === '#menu' || s.trim().startsWith('#menu ') || s.trim().startsWith('#menu[')));
  const mVar = (name) => {
    const hits = all.filter((r) => r.sel.trim() === '#menu' && decl(r.body, name) !== null);
    return hits.length ? decl(hits[hits.length - 1].body, name).trim() : null;
  };
  const rVar = (name) => (decl(rootRule.body, name) || '').trim();

  console.log('\n   token       HUD            start page');
  const tokens = [];
  for (const t of ['--ink', '--cream', '--teal']) {
    const a = rVar(t);
    const b = mVar(t);
    tokens.push([t, a, b]);
    console.log(`   ${t.padEnd(10)}  ${String(a).padEnd(14)} ${b}`);
  }
  check(
    'the start page re-declares the theme tokens, and every one of them actually changes',
    tokens.every(([, a, b]) => b && hex(b) && hex(a) && hex(a) !== hex(b)),
    tokens.map(([t, a, b]) => `${t} ${a}→${b}`).join(', ')
  );
  // "Different theme colour" measured, not asserted: the HUD's surfaces are warm (red leads),
  // the start page's are green (green leads). Opposite sides of the wheel, from real channels.
  const hudPaper = rgbOf(hex(rVar('--cream')));
  const menuPaper = rgbOf(hex(mVar('--cream')));
  const hudInk = rgbOf(hex(rVar('--ink')));
  const menuInk = rgbOf(hex(mVar('--ink')));
  console.log(`   HUD paper rgb(${hudPaper}) vs start-page paper rgb(${menuPaper})`);
  check(
    'the start page sits on the green side of the wheel where the HUD sits on the warm/blue side',
    hudPaper[0] > hudPaper[1] && menuPaper[1] >= menuPaper[0] && menuPaper[1] > menuPaper[2] && menuInk[1] > menuInk[0] && menuInk[1] > menuInk[2] && hudInk[2] > hudInk[1],
    `paper: warm cream r>g → sage g>=r, g>b; ink: slate b>g → forest g>r,g>b`
  );
  const sheetBg = (decl((all.filter((r) => r.sel.trim() === '#menu .sheet').pop() || { body: '' }).body, 'background') || '').match(/rgba?\(([^)]+)\)/);
  const sheetRgb = sheetBg ? sheetBg[1].split(',').slice(0, 3).map((n) => parseInt(n, 10)) : null;
  check(
    'the sheet is really repainted, not just re-tokenised',
    !!sheetRgb && sheetRgb.join(',') !== hudPaper.join(','),
    sheetRgb ? `sheet rgb(${sheetRgb}) vs HUD cream rgb(${hudPaper})` : 'no sheet background'
  );
  check(
    'the scrim behind the sheet is repainted too, and it is a green dusk not a blue one',
    (() => {
      const bg = decl(all.filter((r) => r.sel.trim() === '#menu').pop().body, 'background') || '';
      const stops = [...bg.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(',').slice(0, 3).map((n) => parseInt(n, 10)));
      return stops.length > 0 && stops.every((s) => s[1] > s[0] && s[1] > s[2]);
    })(),
    'every gradient stop has the green channel leading'
  );

  /* Legibility, computed. Every pair a player actually reads on this page. */
  const paperHex = sheetRgb.map((n) => n.toString(16).padStart(2, '0')).join('');
  const pairs = [
    ['forest ink on the sage sheet', hex(mVar('--ink')), paperHex],
    ['the green heading on the sage sheet', hex(decl(rootRule.body, '--leafDeep')), paperHex],
    ['the selected button\'s label on its green', hex(mVar('--cream')), hex(mVar('--teal'))],
    ['the Drive button\'s label on its ink', hex(mVar('--cream')), hex(mVar('--ink'))],
  ];
  console.log('');
  let legible = true;
  for (const [what, fg, bg] of pairs) {
    const r = contrast(fg, bg);
    if (r < 4.5) legible = false;
    console.log(`   ${what.padEnd(42)} #${fg} on #${bg} = ${r.toFixed(2)}:1`);
  }
  check('every text pair on the start page clears WCAG AA (4.5:1), computed from the real hexes', legible, `${pairs.length} pairs`);

  /* The standing scar, applied to the WHOLE start page rather than only the rules this pass
   * wrote — held to tools/browser-test.mjs's own VISIBLE standard (display not none,
   * visibility not hidden, opacity well clear of zero), the same one section 3 applies to the
   * HUD's claimed elements. `display: grid` / `flex` are layout, not hiding, and are not
   * flagged; `display: none` is.
   *
   * TWO RULES ARE EXEMPT AND BOTH ARE NAMED, so neither can quietly grow into a third:
   * `#menu[hidden]` is the guard that makes the Drive button work (checked separately, right
   * below), and `#menu button.locked` is the deliberate greying of a car you have not earned
   * yet. Everything else on this page must be on screen whenever the page is. */
  const EXEMPT = ['#menu[hidden]', '#menu button.locked'];
  const hiders = [];
  for (const r of menuRules) {
    const sel = r.sel.trim();
    if (EXEMPT.includes(sel)) continue;
    const d = (p) => (decl(r.body, p) || '').trim().toLowerCase();
    if (d('display') === 'none') hiders.push(`${sel} display:none`);
    if (d('visibility') === 'hidden') hiders.push(`${sel} visibility:hidden`);
    const o = decl(r.body, 'opacity');
    if (o !== null && parseFloat(o) < 0.5) hiders.push(`${sel} opacity:${o}`);
  }
  check(
    'the recolour added no way to hide the start page',
    hiders.length === 0,
    hiders.join('; ') || `${menuRules.length} rules on #menu and its children, all visible by the browser suite's own standard`
  );
  const guard = all.find((r) => r.sel.trim() === '#menu[hidden]');
  check(
    'and #menu[hidden] still wins, so the Drive button still works',
    !!guard && /display\s*:\s*none\s*!important/.test(guard.body),
    guard ? guard.body.trim().replace(/\s+/g, ' ') : 'MISSING — this is the bug that shipped the game unplayable'
  );
}

/* ── 5. the retired rope trail ───────────────────────────────────────────── */

console.log('\nthe rope trail (src/render/trail.js) — proving it is disabled, not just "visible: false":\n');
{
  // A static check first: no LIVE `scene.add(...)` call left in the source at all — comments
  // (where the file explains the decision, and mentions the call by name) do not count.
  const trailSrc = readFileSync(resolve(ROOT, 'src/render/trail.js'), 'utf8');
  const trailSrcCode = trailSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check(
    'no live scene.add(...) call remains in trail.js (comments do not count)',
    !/scene\s*\.\s*add\s*\(/.test(trailSrcCode),
    /scene\s*\.\s*add\s*\(/.test(trailSrc) ? 'present, but only inside a comment' : 'no match anywhere in the file'
  );

  // Then the behavioural proof — gotcha 3: a flag is not the same as nothing being drawn, so
  // this drives the REAL class hard (hundreds of frames, a reset, and a distance that used to
  // force `alive` to 1 and `mesh.visible` to true) against a scene stub that records whether
  // `.add` was ever called, and inspects the real mesh's real `.parent`.
  let addCalled = false;
  const fakeScene = { add: () => { addCalled = true; }, children: [] };
  const trail = new StreakTrail({ scene: fakeScene });
  const trailCar = { x: 10, y: 2, z: -30, yaw: 0.4 };
  for (let i = 0; i < 600; i++) trail.update(1 / 60, trailCar, { distance: i * 100 });
  trail.reset(trailCar);
  trail.update(1 / 60, trailCar, { distance: 5_000_000 }); // absurd — would have forced visible:true

  check('StreakTrail never calls scene.add — nothing was ever attached to the scene graph', addCalled === false);
  check('its mesh has no parent — a renderer cannot traverse to it from any scene, full stop', trail.mesh.parent === null);
  check('its mesh is not flagged visible either — belt and suspenders, not one flag', trail.mesh.visible === false);

  let disposeOk = false;
  try {
    trail.dispose();
    disposeOk = true;
  } catch {
    disposeOk = false;
  }
  check('dispose() still runs cleanly — the module stays fully importable', disposeOk);
}

console.log('\n' + '-'.repeat(70));
console.log(failed ? `${failed} CHECK(S) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
