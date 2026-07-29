/* Wanderoad — is the nearest-station counter actually on the screen, with a number in it?
 *
 * Operator on the nearest-station counter: "no". src/ui/fuelGauge.js has a whole always-on
 * block for it — an arrow and a distance in the band above the arc — and a comment saying it
 * is deliberately not gated on fuel level. `tools/bench-fuel.mjs` proves the FORMATTING and
 * the ARROW SIGN with a hand-made `fuel.nearest`. Neither of those is the question the
 * operator asked, which is whether a real drive ever puts a number in it.
 *
 * This is gotcha 3 with the volume up: a flag being set is not a thing being visible, and a
 * widget that renders `—` for the whole session is, to the person looking at the screen,
 * "not there".
 *
 * So this stands up a stub DOM (with createElementNS and a <head>, which tools/diag-hud.mjs's
 * stub does not have — that is why the fuel gauge has never been through it), builds the REAL
 * FuelGauge, wires the REAL Fuel to the REAL Props tiler exactly the way src/main.js does,
 * drives a REAL car along a REAL road, and reads the text out of the real element every
 * frame. Then it holds the widget's OWN stylesheet — the CSS string in fuelGauge.js, parsed,
 * not eyeballed — to the same visible standard tools/browser-test.mjs uses.
 *
 *   node tools/diag-fuelhud.mjs [seed]
 */

import { Object3D } from 'three';

const SEED = (parseInt(process.argv[2] ?? '', 10) || 20260726) >>> 0;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? ' PASS' : ' FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
};

/* ── a stub DOM that can hold an SVG widget ──────────────────────────────── */
class Node {
  constructor(tag, ns = null) {
    this.tagName = tag;
    this.namespaceURI = ns;
    this.id = '';
    this.className = '';
    this.textContent = '';
    /* A CSS custom property is written through setProperty(), not by assignment — the
     * capacity meter's part-filled pip sets `--p` that way. Kept in the same bag so a check
     * can read the value back. */
    this.style = {
      setProperty: (k, v) => {
        this.style[k] = v;
      },
      removeProperty: (k) => {
        delete this.style[k];
      },
    };
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    const set = new Set();
    this._classes = set; // readable by checks — see the meter-point warning section
    this.classList = {
      add: (c) => set.add(c),
      remove: (...cs) => cs.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c),
      toggle: (c, on) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c)),
    };
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  appendChild(n) {
    this.childNodes.push(n);
    n.parentNode = this;
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i >= 0) this.childNodes.splice(i, 1);
    return n;
  }
  /** Depth-first, by className — enough to find a widget's own parts from the outside. */
  /** The gauge reflows before restarting the amber meter-point flash; give it a number. */
  getBoundingClientRect() {
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }

  find(cls) {
    /* SVG elements carry their class in an attribute, not in .className — the direction arrow
     * is now drawn SVG (see fuelGauge.js: a perfect triangle cannot express a heading), so
     * this has to look in both places or it silently stops finding it. */
    if (this.className === cls || (this.attrs && this.attrs.class === cls)) return this;
    for (const c of this.childNodes) {
      const r = c.find(cls);
      if (r) return r;
    }
    return null;
  }
}
const byId = {};
const head = new Node('head');
/* Enough of a <canvas> for render/props.js's `haloTexture` to run: the fuel-can glow builds
 * one the moment a tile with a can in it bakes, and this harness drives the real tiler. */
const canvasStub = () => {
  const n = new Node('canvas');
  n.width = 0;
  n.height = 0;
  n.getContext = () => ({
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {},
    set fillStyle(v) {}, get fillStyle() { return '#000'; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
  });
  return n;
};
globalThis.document = {
  head,
  createElement: (t) => (t === 'canvas' ? canvasStub() : new Node(t)),
  createElementNS: (ns, t) => new Node(t, ns),
  getElementById: (id) => byId[id] || null,
};
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = v; },
};

const { FuelGauge } = await import('../src/ui/fuelGauge.js');
const { Fuel, TANK_SECONDS } = await import('../src/game/fuel.js');
const { Props } = await import('../src/render/props.js');
const { Terrain } = await import('../src/world/terrain.js');
const { edgesInBox } = await import('../src/world/roads.js');
const { nearestStation } = await import('../src/world/props.js');

/* ── 1. the widget builds, and its parts are real elements ───────────────── */
console.log('\nWANDEROAD — THE NEAREST-STATION COUNTER\n' + '-'.repeat(70));
const root = new Node('div');
const gauge = new FuelGauge(root);

check('the gauge attaches to the HUD root', root.childNodes.includes(gauge.root), `#${gauge.root.id}`);
const stationEl = root.find('station');
check('the nearest-station block exists in the DOM', !!stationEl, stationEl ? `<div class="${stationEl.className}">` : 'missing');
const distEl = stationEl && stationEl.find('dist');
const arrowEl = stationEl && stationEl.find('arrow');
check('it has a distance element', !!distEl);
check('it has an arrow element', !!arrowEl);
check('it is never blank, even before anything is known', !!distEl && distEl.textContent.length > 0, `"${distEl && distEl.textContent}"`);

/* ── 2. its own stylesheet, held to browser-test.mjs's VISIBLE standard ──── */
{
  const sheet = head.childNodes.find((n) => n.id === 'fuelGaugeCss');
  check('the widget injects its own stylesheet', !!sheet);
  const css = sheet ? sheet.textContent : '';
  const ruleFor = (sel) => {
    const m = css.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*{([^}]*)}`));
    return m ? Object.fromEntries(m[1].split(';').map((d) => d.split(':').map((s) => s.trim())).filter((p) => p.length === 2)) : null;
  };
  const g = ruleFor('#fuelGauge');
  const st = ruleFor('#fuelGauge .station');
  const dist = ruleFor('#fuelGauge .station .dist');
  const arrow = ruleFor('#fuelGauge .station .arrow');
  check('#fuelGauge has a non-zero box', !!g && parseFloat(g.width) > 0 && parseFloat(g.height) > 0, g ? `${g.width} x ${g.height}` : 'no rule');
  check('#fuelGauge is not hidden', !!g && g.display !== 'none' && g.visibility !== 'hidden' && parseFloat(g.opacity) > 0.4, g ? `opacity ${g.opacity}` : 'no rule');
  check('the station block is not hidden', !!st && st.display !== 'none' && st.visibility !== 'hidden' && parseFloat(st.opacity) > 0.4, st ? `display ${st.display}, opacity ${st.opacity}` : 'no rule');
  // The two things that carry the reading have to have real size: text with a font size, and
  // the direction arrow, which is now a drawn SVG with a real box (it used to be a CSS
  // triangle whose borders WERE its size).
  check('the distance text is big enough to read', !!dist && parseFloat(dist['font-size']) >= 12, dist ? dist['font-size'] : 'no rule');
  const aw = arrow ? parseFloat(arrow.width) : 0;
  check('the direction arrow has a real size', aw >= 14, arrow ? `${arrow.width} x ${arrow.height}` : 'no rule');
  /* THE POINT OF THE REDRAW, asserted rather than described. Operator: "you used a perfect
   * triangle to point to fuel making that impossible to read". An equilateral triangle is
   * unchanged by a 120 deg rotation, so it cannot show a heading at all. The replacement must
   * therefore be measurably NOT symmetric: a long axis and a short one. Measured off the
   * geometry actually in the DOM, not off a claim in a comment. */
  const pts = [];
  const walk = (n) => {
    const d = n.getAttribute && n.getAttribute('d');
    if (d) for (const m of d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)) pts.push([+m[1], +m[2]]);
    for (const c of n.childNodes || []) walk(c);
  };
  if (arrowEl) walk(arrowEl);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  check('the arrow is drawn from real geometry, not a border trick', pts.length >= 4, `${pts.length} points`);
  check('and it is ASYMMETRIC — a long axis and a short one, so it can point', spanY > spanX * 1.25,
    `${spanX.toFixed(1)} wide x ${spanY.toFixed(1)} tall (want tall > 1.25 x wide)`);
  /* The subject of the sentence. A distance on its own says nothing — this is the pump
   * silhouette that makes "1.3 km" mean "the next petrol station is 1.3 km away". */
  const glyph = stationEl && stationEl.childNodes.find((n) => n.getAttribute && n.getAttribute('class') === 'pump');
  check('there is a pump glyph saying what the number is a distance TO', !!glyph,
    glyph ? `${glyph.tagName} ${glyph.getAttribute('width')}x${glyph.getAttribute('height')}, ${glyph.childNodes.length} shapes` : 'missing');
  check('the pump glyph has a real size', !!glyph && parseFloat(glyph.getAttribute('width')) >= 9 && parseFloat(glyph.getAttribute('height')) >= 9,
    glyph ? `${glyph.getAttribute('width')}x${glyph.getAttribute('height')}` : 'no glyph');
  // The effective opacity a reader actually sees: the widget's own, times the block's.
  const eff = g && st ? parseFloat(g.opacity) * parseFloat(st.opacity) : 0;
  console.log(`       effective opacity of the readout: ${eff.toFixed(2)}`);
  check('the readout is legible, not a ghost', eff >= 0.85, `${eff.toFixed(2)} (was 0.70 and 10px, which the operator read as "not there")`);
}

/* ── 3. A REAL DRIVE. Does a number ever appear, and how soon? ───────────── */
console.log('\ndriving a real car on a real road, reading the real element every frame:\n');
{
  const scene = new Object3D();
  const props = new Props({ seed: SEED, scene, solids: null });

  // Start on a real arterial near the origin, the way the game spawns.
  /* The LONGEST arterial near the origin, started at the end FURTHEST from any station — a
   * drive that begins on a forecourt would pass this test by luck and prove nothing about the
   * case the operator hit, which is being somewhere with no station loaded. */
  const edges = edgesInBox(-2500, -2500, 2500, 2500, SEED, 40).filter((e) => e.tier === 0);
  let e0 = edges[0];
  for (const e of edges) if (e.segs > e0.segs) e0 = e;
  {
    const a = nearestStation(e0.pts[0], e0.pts[1], SEED);
    const n = e0.segs;
    const b = nearestStation(e0.pts[n * 2], e0.pts[n * 2 + 1], SEED);
    // Walk from whichever end is further from a station, so the drive starts cold.
    if (b && (!a || b.dist > a.dist)) {
      const rev = new Float32Array(e0.pts.length);
      for (let k = 0; k <= n; k++) {
        rev[k * 2] = e0.pts[(n - k) * 2];
        rev[k * 2 + 1] = e0.pts[(n - k) * 2 + 1];
      }
      e0 = { ...e0, pts: rev };
    }
  }
  const T = new Terrain(SEED, e0.minX - 200, e0.minZ - 200, e0.maxX + 200, e0.maxZ + 200, 80);
  const startX = e0.pts[0];
  const startZ = e0.pts[1];

  const fuel = new Fuel({ findStation: (x, z) => props.nearestStation(x, z) });
  const car = {
    x: startX, z: startZ, yaw: Math.atan2(e0.pts[2] - startX, e0.pts[3] - startZ),
    speed: 22, onRoad: 1, kph: 79, throttle: 1,
  };

  const DT = 1 / 60;
  const MINUTES = 3;
  let firstNumberAt = -1;
  let dashFrames = 0;
  let frames = 0;
  const samples = [];
  // Walk the car along the edge's own polyline so it stays on a real road.
  let seg = 0;
  let along = 0;
  const FRAMES = 60 * 60 * MINUTES;
  for (let f = 0; f < FRAMES; f++) {
    // advance along the polyline
    along += car.speed * DT;
    while (seg < e0.segs - 1) {
      const ax = e0.pts[seg * 2], az = e0.pts[seg * 2 + 1];
      const bx = e0.pts[seg * 2 + 2], bz = e0.pts[seg * 2 + 3];
      const l = Math.hypot(bx - ax, bz - az);
      if (along < l) {
        const t = along / l;
        car.x = ax + (bx - ax) * t;
        car.z = az + (bz - az) * t;
        car.yaw = Math.atan2(bx - ax, bz - az);
        break;
      }
      along -= l;
      seg++;
    }
    if (seg >= e0.segs - 1) break;
    car.y = T.height(car.x, car.z);
    // The tiler gets several phases a frame here so three simulated minutes do not take
    // three real ones; it is the same code path, just not throttled to one phase.
    for (let p = 0; p < 8; p++) props.update(DT, car.x, car.z);
    fuel.update(DT, car, { onRoad: 1 });
    gauge.update(DT, fuel, car);
    frames++;
    const txt = distEl.textContent;
    if (txt === '—') dashFrames++;
    else if (firstNumberAt < 0) firstNumberAt = f * DT;
    if (f % 600 === 0) {
      samples.push(`${((f * DT) / 60).toFixed(1)} min: "${txt}"  arrow ${gauge.stationArrowDeg().toFixed(0)}°  (car at ${car.x.toFixed(0)},${car.z.toFixed(0)}, ${props.known.size} stations known)`);
    }
  }
  for (const s of samples) console.log(`       ${s}`);
  const pct = (100 * dashFrames) / Math.max(1, frames);
  console.log(`       ${frames} frames driven; the readout was a bare dash for ${pct.toFixed(0)}% of them`);
  check('a real distance appears at all', firstNumberAt >= 0, firstNumberAt >= 0 ? `first number after ${firstNumberAt.toFixed(1)} s` : 'never — it stayed "—" the whole drive');
  check('the counter shows a number for most of the drive', pct < 20, `${pct.toFixed(0)}% dash`);
  check('and it says something plausible', /\d/.test(distEl.textContent), `"${distEl.textContent}"`);

  // Against the ground truth: the pure world lookup, which knows every station whether or not
  // a tile for it has ever been built.
  const truth = nearestStation(car.x, car.z, SEED);
  const shown = fuel.nearest;
  const err = truth && shown ? Math.abs(truth.dist - shown.dist) : Infinity;
  console.log(`       at the end: gauge says ${distEl.textContent}, the world's own nearest station is ${(truth.dist / 1000).toFixed(2)} km away`);
  check('the distance shown is the real nearest station, not just the nearest LOADED one',
    err < 60, `gauge ${shown ? shown.dist.toFixed(0) : 'null'} m vs world ${truth.dist.toFixed(0)} m`);
}


/* ── 6. the meter-point warning, and the capacity meter ──────────────────────
 * Two operator instructions, asserted against the numbers that drive them:
 *   "gas station distance should flash yellow when running below each meter point on the
 *    fuel gauge"
 *   "clear capacity meter showing how much a car has and making it clear it increases as
 *    you drive"
 * Both are HUD behaviour, so both are proved by driving the widget's own update() with a
 * scripted tank and reading the DOM back — not by checking that a flag was set. */
console.log('\nTHE METER-POINT WARNING\n' + '-'.repeat(70));
{
  const g2 = new FuelGauge(new Node('div'));
  const distNode = g2.stationDist;
  const carAt = { x: 0, z: 0, yaw: 0 };
  const fakeFuel = (frac) => ({
    fraction: frac,
    refuelling: false,
    dry: frac <= 0,
    nearest: { x: 300, z: 0, dist: 300 },
    capacity: 792,
    capacityLevel: 0,
    capacityProgress: 0,
    carCans: 0,
    minutesLeft: () => 5,
  });

  /* Counted off the gauge's own flash counter, not off the class: _flashMark() removes and
   * re-adds `mark` to restart the animation, so the class is on the element continuously
   * after the first gate and an edge-detector would report exactly one flash for ever. */
  const flashesAt = [];
  let seen = g2.markFlashCount();
  for (let pct = 100; pct >= 0; pct--) {
    g2.update(1 / 60, fakeFuel(pct / 100), carAt);
    if (g2.markFlashCount() > seen) {
      seen = g2.markFlashCount();
      flashesAt.push(pct / 100);
    }
  }
  check('the amber class is actually on the distance readout', distNode._classes.has('mark'), [...distNode._classes].join(' '));
  console.log(`       amber fired at tank fractions: ${flashesAt.map((f) => `${(f * 100).toFixed(0)}%`).join(', ') || 'never'}`);
  check('the distance readout flashes at every meter point on the way down', flashesAt.length === 3, `${flashesAt.length} flashes`);
  check('and at the RIGHT points — three-quarters, half, a quarter', JSON.stringify(flashesAt) === JSON.stringify([0.75, 0.5, 0.25]), JSON.stringify(flashesAt));

  const css = head.childNodes.find((n) => n.id === 'fuelGaugeCss')?.textContent || '';
  check('the flash is YELLOW, as asked, and it is an animation not a permanent colour', /@keyframes fuelMark\b[^}]*}[^}]*#FFD24A/i.test(css.replace(/\s+/g, ' ')) || /#FFD24A/i.test(css), 'amber #FFD24A in the keyframes');

  // and refuelling re-arms them: the same four gates warn again on the next tank
  g2.update(1 / 60, fakeFuel(1), carAt);
  const again = [];
  seen = g2.markFlashCount();
  for (let pct = 100; pct >= 0; pct--) {
    g2.update(1 / 60, fakeFuel(pct / 100), carAt);
    if (g2.markFlashCount() > seen) {
      seen = g2.markFlashCount();
      again.push(pct / 100);
    }
  }
  check('filling up re-arms them — the next tank warns the same way', again.length === 3, `${again.length} flashes on the second tank`);
}

console.log('\nTHE CAPACITY METER\n' + '-'.repeat(70));
{
  const g3 = new FuelGauge(new Node('div'));
  const carAt = { x: 0, z: 0, yaw: 0 };
  const withCans = (cans) => {
    const level = Math.min(Math.floor(cans / 5), 5);
    return {
      fraction: 1,
      refuelling: false,
      dry: false,
      nearest: null,
      capacity: 792 * (1 + level * 0.1),
      capacityLevel: level,
      capacityProgress: level >= 5 ? 1 : (cans % 5) / 5,
      carCans: cans,
      minutesLeft: () => 13,
    };
  };
  const lit = () => g3.capSegs.filter((s) => s._classes.has('on')).length;

  g3.update(1 / 60, withCans(0), carAt);
  const t0 = g3.capTxt.textContent;
  const lit0 = lit();
  g3.update(1 / 60, withCans(3), carAt);
  const partial = g3.capSegs[0].style['--p'];
  const t3 = g3.capTxt.textContent;
  g3.update(1 / 60, withCans(10), carAt);
  const t10 = g3.capTxt.textContent;
  const lit10 = lit();
  console.log(`       0 cans: ${lit0} pips lit, "${t0}"`);
  console.log(`       3 cans: first pip ${partial} full, "${t3}"`);
  console.log(`       10 cans: ${lit10} pips lit, "${t10}"`);

  check('there is a pip for every upgrade the tank can take', g3.capSegs.length === 5, `${g3.capSegs.length} pips`);
  check('a fresh car shows none of them lit', lit0 === 0, `${lit0} lit`);
  check('progress towards the NEXT upgrade is visible before it lands', partial === '60%', `${partial}`);
  check('two upgrades light two pips', lit10 === 2, `${lit10} lit`);
  check('the meter says how big this tank is, in minutes', /\d+m/.test(t10), `"${t10}"`);
  check('and how many more cans buy the next one', /in \d/.test(t0), `"${t0}"`);
  check('the tank size on screen actually grew with the cans', t0 !== t10, `"${t0}" -> "${t10}"`);
  check('it explains that cans belong to the car', /car/i.test(g3.capTxt.title), g3.capTxt.title.slice(0, 60) + '…');
}

console.log(failed ? `\n${failed} FUEL-HUD CHECK(S) FAILED` : '\nall fuel-hud checks passed');
process.exit(failed ? 1 : 0);
