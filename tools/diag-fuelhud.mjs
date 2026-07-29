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
    this.style = {};
    this.attrs = {};
    this.childNodes = [];
    this.parentNode = null;
    const set = new Set();
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
  find(cls) {
    if (this.className === cls) return this;
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
  // a CSS-triangle arrow whose borders ARE its size (width/height are 0 by construction).
  check('the distance text is big enough to read', !!dist && parseFloat(dist['font-size']) >= 12, dist ? dist['font-size'] : 'no rule');
  const tri = arrow ? parseFloat(arrow['border-bottom']) : 0;
  check('the arrow triangle has a real size', tri >= 4, arrow ? `${arrow['border-bottom']} / ${arrow['border-left']}` : 'no rule');
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

console.log(failed ? `\n${failed} FUEL-HUD CHECK(S) FAILED` : '\nall fuel-hud checks passed');
process.exit(failed ? 1 : 0);
