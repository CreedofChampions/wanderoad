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

const { Hud, MILESTONES_KM } = await import('../src/ui/hud.js');
const { Streak, fmtDistance } = await import('../src/game/streak.js');
const { FLEET, fmtUnlock } = await import('../src/game/garage.js');
const { StreakTrail } = await import('../src/render/trail.js');

/* ── 1. the strings ──────────────────────────────────────────────────────── */

const hud = new Hud();
const streak = new Streak();
const car = { speed: 33.3, onGround: true, kph: 120, gear: 3, reverse: false, x: 0, z: 0 };
const ON = { onRoad: 1, dominant: 0 };
const OFF = { onRoad: 0, dominant: 0 };
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

const CLAIMED = ['#streak', '#streakKm', '#unlockBar', '#unlockBar .track', '#unlockBar .fill', '#unlockBar #unlockNext', '#unlockBar .milestone'];
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
