// created by AI
/* Wanderoad — the hardware-acceleration notice, checked without a browser.
 *
 * Operator, verbatim: "people without hardware acceleration lag tremendously — detect it and
 * let them know." src/ui/perfNotice.js has two detectors and one dismissible banner:
 *
 *   1. isSoftwareRenderer(gl) — the renderer STRING, checked against real strings a software
 *      path actually reports (SwiftShader, Mesa's llvmpipe/softpipe, Windows' own "Microsoft
 *      Basic Render Driver" fallback) and real strings a genuine GPU reports, so this is a
 *      sweep of concrete cases rather than one hand-picked example either way.
 *
 *   2. PerfMonitor — a real ~10 s window of real per-frame samples, checked at a steady 60 fps
 *      (must never trigger), a sustained sub-20 fps crawl (must trigger), and a single dip that
 *      recovers (must NOT trigger — one hitch while a chunk streams in is not "tremendous lag").
 *
 *   3. PerfNotice — driven against the same stub DOM tools/diag-hud.mjs uses, proving the
 *      banner mounts real text, dismisses on its own button, and — the operator's "shows once
 *      per session" — never shows a second time even if asked to.
 *
 *   node tools/diag-perf-notice.mjs
 */

import { isSoftwareRenderer, PerfMonitor, PerfNotice } from '../src/ui/perfNotice.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

console.log('\nWANDEROAD — HARDWARE-ACCELERATION NOTICE\n' + '-'.repeat(70));

/* ── 1. the renderer-string sniff ────────────────────────────────────────── */

console.log('\nisSoftwareRenderer — real strings both kinds of hardware actually report:\n');

/** A minimal stub of the bit of WebGLRenderingContext this function touches. */
const glWith = (unmasked, plainRenderer = unmasked) => ({
  getExtension: (name) => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 'UNMASKED_RENDERER_WEBGL' } : null),
  getParameter: (p) => (p === 'UNMASKED_RENDERER_WEBGL' ? unmasked : plainRenderer),
  RENDERER: 'RENDERER',
});
const glNoDebugExt = (plainRenderer) => ({
  getExtension: () => null, // some browsers block WEBGL_debug_renderer_info entirely
  getParameter: (p) => (p === 'RENDERER' ? plainRenderer : 'generic'),
  RENDERER: 'RENDERER',
});

const softwareStrings = [
  'Google SwiftShader',
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  'llvmpipe (LLVM 15.0.7, 256 bits)',
  'Mesa Offscreen (softpipe)',
  'Microsoft Basic Render Driver',
  'Software Rasterizer',
];
const gpuStrings = [
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)',
  'Apple M2',
  'AMD Radeon RX 6800 XT',
  'Adreno (TM) 640',
];

let sweepOk = true;
for (const s of softwareStrings) {
  const r1 = isSoftwareRenderer(glWith(s));
  const r2 = isSoftwareRenderer(glNoDebugExt(s));
  console.log(`   SOFTWARE  "${s}"  ->  debug-ext ${r1}, plain-RENDERER-fallback ${r2}`);
  if (!r1 || !r2) sweepOk = false;
}
for (const s of gpuStrings) {
  const r1 = isSoftwareRenderer(glWith(s));
  console.log(`   REAL GPU  "${s}"  ->  ${r1}`);
  if (r1) sweepOk = false;
}
check('every known software-renderer string is caught, real GPU strings never are', sweepOk, `${softwareStrings.length} software + ${gpuStrings.length} GPU strings`);

check('a missing/broken gl never throws — reads as "not software"', isSoftwareRenderer(null) === false && isSoftwareRenderer({}) === false);
check(
  'a gl whose getParameter throws (a real browser quirk on some software paths) still reads as "not software" rather than crashing boot',
  isSoftwareRenderer({
    getExtension: () => {
      throw new Error('blocked');
    },
    getParameter: () => 'x',
  }) === false
);

/* ── 2. the fps window ───────────────────────────────────────────────────── */

console.log('\nPerfMonitor — a real ~10 s window of real per-frame samples:\n');

const DT60 = 1 / 60;
const runFor = (monitor, seconds, fpsAt) => {
  let n = 0;
  let t = 0;
  while (!monitor.done) {
    const dt = DT60;
    monitor.sample(dt, fpsAt(t));
    t += dt;
    n++;
    if (n > 100000) break; // safety valve — this must never spin forever
  }
  return t;
};

const steady = new PerfMonitor();
const tSteady = runFor(steady, 10, () => 60);
check('a steady 60 fps for the whole window never triggers', steady.done && steady.triggered === false, `closed at ${tSteady.toFixed(2)}s`);

const crawl = new PerfMonitor();
const tCrawl = runFor(crawl, 10, () => 8); // ~120 ms/frame — genuinely unplayable
check('a sustained sub-20 fps crawl for the whole window DOES trigger', crawl.done && crawl.triggered === true, `closed at ${tCrawl.toFixed(2)}s`);

const oneHitch = new PerfMonitor();
const tHitch = runFor(oneHitch, 10, (t) => (t < 0.3 ? 5 : 60)); // one bad third-of-a-second, then fine
check('a single early hitch that recovers does NOT trigger — this is a lag notice, not a hiccup counter', oneHitch.done && oneHitch.triggered === false, `closed at ${tHitch.toFixed(2)}s`);

const borderline = new PerfMonitor();
// bad for exactly the configured fraction of the window — proves the threshold is really
// read from the constructor, not hard-coded past it.
const tBorder = runFor(borderline, 10, (t) => (t < 10 * borderline.badFraction - 0.05 ? 10 : 60));
check(
  'just under the configured bad-fraction does not trigger, holding right at the edge',
  borderline.done && borderline.triggered === false,
  `closed at ${tBorder.toFixed(2)}s, badFraction ${borderline.badFraction}`
);

const tighter = new PerfMonitor({ windowSeconds: 2, fpsThreshold: 15, badFraction: 0.5 });
const tTighter = runFor(tighter, 2, () => 5);
check('custom thresholds are actually used, not just accepted and ignored', tighter.done && tighter.triggered === true && Math.abs(tTighter - 2) < 0.05, `closed at ${tTighter.toFixed(2)}s (windowSeconds 2)`);

check('sampling after the window has closed is a no-op, not a re-arm', (() => {
  const m = new PerfMonitor({ windowSeconds: 1 });
  runFor(m, 1, () => 60);
  const before = m.triggered;
  m.sample(1, 1); // a huge, terrible frame AFTER the window already closed clean
  return m.triggered === before && before === false;
})());

/* ── 3. the banner itself — a stub DOM, the same idea tools/diag-hud.mjs uses ─────────────── */

console.log('\nPerfNotice — mounts once, dismisses, and never shows twice:\n');

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.textContent = '';
    this._listeners = {};
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
    };
  }
  appendChild(n) {
    this.children.push(n);
    return n;
  }
  remove() {
    this._removed = true;
  }
  addEventListener(type, fn) {
    this._listeners[type] = fn;
  }
  click() {
    this._listeners.click?.();
  }
}
globalThis.document = { createElement: (t) => new Node(t) };
globalThis.requestAnimationFrame = (fn) => fn(); // run synchronously — no real frame to wait for
let ssData = {};
globalThis.sessionStorage = {
  getItem: (k) => ssData[k] ?? null,
  setItem: (k, v) => {
    ssData[k] = v;
  },
};
// setTimeout exists in node already; hide's 650 ms removal delay is not under test here.

{
  const root = new Node('body');
  const notice = new PerfNotice(root);
  const shown = notice.show('turn on hardware acceleration');
  check('show() actually mounts a #perfNotice under the given root', shown === true && root.children.length === 1 && root.children[0].id === 'perfNotice');
  check('it carries the real message text', root.children[0].children[0].textContent === 'turn on hardware acceleration');
  check('the transition class is applied (a frame late, via requestAnimationFrame)', root.children[0].classList.contains('show') === true);

  const secondShown = notice.show('a different message');
  check('a second show() call on the SAME instance is a no-op — one notice per notice', secondShown === false && root.children.length === 1);

  // A cache-busting re-import is a genuinely separate module instance — the module-level
  // `shownThisLoad` flag in a fresh copy of perfNotice.js starts false again, the way it
  // would after an actual page reload. Only sessionStorage (which a real browser keeps
  // across a reload within the same tab) should still be able to refuse the second show.
  const freshModule = await import(`../src/ui/perfNotice.js?probe=${Date.now()}-${Math.random()}`);
  const freshRoot = new Node('body');
  const freshNotice = new freshModule.PerfNotice(freshRoot);
  const thirdShown = freshNotice.show('yet another message');
  check(
    "the operator's own rule — shows ONCE PER SESSION — survives a reload: a fresh module instance (in-memory flag reset) is STILL refused, because sessionStorage remembers it",
    thirdShown === false && freshRoot.children.length === 0,
    'fresh module instance, same sessionStorage — still refuses to show again'
  );
}

{
  // A clean session AND a fresh module instance — `notice` (the top-level import) already
  // used its one show() in section 3's first block, so its module-level flag alone would
  // block this regardless of sessionStorage. A new cache-busted import is a genuinely
  // unused PerfNotice, the same way a real second tab in the same browser session would be.
  ssData = {};
  const freshModule = await import(`../src/ui/perfNotice.js?probe=${Date.now()}-${Math.random()}`);
  const root = new Node('body');
  const notice = new freshModule.PerfNotice(root);
  notice.show('software rendering detected');
  const banner = root.children[0];
  check('the dismiss button exists and is really a button', banner.children[1].tagName === 'button');
  banner.children[1].click();
  check("clicking dismiss removes the 'show' class (fading it out) rather than yanking it instantly", banner.classList.contains('show') === false);
}

console.log('\n' + '-'.repeat(70));
console.log(failed ? `${failed} CHECK(S) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
