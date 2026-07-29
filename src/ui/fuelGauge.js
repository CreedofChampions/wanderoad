/* Wanderoad — the fuel gauge.
 *
 * Its own file and its own stylesheet rather than an addition to ui/hud.js, for the same
 * reason the streak block builds its own markup: a HUD element should own everything it
 * touches, and this one has to be able to appear and disappear without anyone else's CSS
 * having an opinion.
 *
 * The design brief is the HUD's own: "a cozy driving game should be able to be played with
 * the HUD switched off and lose almost nothing". So this is a quarter-circle of colour and
 * a needle, not a bar with a number and a warning triangle. It stays quiet — the only time
 * it does anything is when the tank is genuinely low, and then it breathes rather than
 * flashes. Nothing here ever blinks red.
 *
 * ONE THING ON THIS WIDGET IS DELIBERATELY NOT CONDITIONAL: the nearest-station distance and
 * a small compass arrow, in the empty band above the arc, on screen at every fuel level — not
 * just when the tank is low, unlike `.mins` below it, which only shows a distance once things
 * are critical. It reads `fuel.nearest` — the same answer render/props.js's Props class is
 * already recomputing twice a second for `.mins` and the low-fuel toast (see fuel.js's own
 * comment on `findStation`) — so this adds no new station lookup of its own, only a second,
 * permanent place to read the one that already exists. The arrow is a plain CSS triangle, not
 * a Unicode glyph: this project already prefers to draw its own shapes rather than borrow a
 * font's idea of one (the same reasoning that keeps the 100 roadside props "modelled in code").
 *
 * A note on gotcha 3 (a flag being set is not a thing being visible): everything here is a
 * measured geometric property of an SVG, not a class toggle. `needleAngle()` returns the
 * angle actually written into the transform, which is what tools/bench-fuel.mjs asserts
 * against, so "the gauge moved" is provable without a browser.
 */

import { LOW_FRACTION, CAPACITY_UPGRADE_EVERY, CAPACITY_UPGRADE_LEVELS, CAPACITY_UPGRADE_STEP } from '../game/fuel.js';
import { angleDelta, dampAngle, RAD2DEG } from '../core/math.js';

const NS = 'http://www.w3.org/2000/svg';

/* The needle sweeps this arc, in degrees, measured from straight up.
 * -60 is empty on the left, +60 is full on the right — a real gauge's sweep, not a full
 * circle, because a short sweep is legible at a glance and a long one is not. */
const SWEEP = 60;

/* The gauge's own tick fractions, and the gates the amber flash fires on. Descending, because
 * that is the order a tank passes them in. Shared by the dial's ticks and by update()'s
 * warning, so the thing that flashes and the thing that is drawn can never drift apart. */
const MARKS = [0.75, 0.5, 0.25];

const CSS = `
#fuelGauge{
  /* bottom:128 is measured, not picked: #speedo sits 2.4rem up with a 4.6rem numeral, so its
   top edge is about 104 px off the bottom, and the capacity line hangs 17 px below this box.
   At 96 px the two overlapped in a real screenshot. */
  position:absolute; right:18px; bottom:128px; width:150px; height:70px;
  pointer-events:none; opacity:.9; transition:opacity .5s ease;
  font:500 11px/1.2 ui-rounded,-apple-system,Segoe UI,Roboto,sans-serif;
  color:#F6ECD8; text-shadow:0 1px 3px rgba(28,34,48,.55);
}
#fuelGauge.low{ opacity:1; animation:fuelBreathe 3.4s ease-in-out infinite; }
#fuelGauge.filling{ opacity:1; }
/* The word FUEL is gone: the capacity line below now sits where it did and already says
 * TANK, and a screenshot of the real page showed the two of them printed on top of each
 * other. One label, in one place. */
#fuelGauge .mins{ position:absolute; left:0; right:0; bottom:11px; text-align:center; opacity:.78; font-size:11px; }
#fuelGauge .station{ position:absolute; left:-8px; right:-8px; top:-6px; display:flex; align-items:center; justify-content:center; gap:4px; opacity:1; }
/* A REAL ARROW, not a triangle. Operator: "you used a perfect triangle to point to fuel
 * making that impossible to read". They were right and the reason is geometric: the old
 * marker was an equilateral CSS triangle, and an equilateral triangle has three-fold
 * rotational symmetry — rotate it 120 deg and it is pixel-identical to where it started. A
 * shape that looks the same from three directions cannot tell you a direction. At 10 px, with
 * the reader's eyesight, "which way is that pointing" had no answer.
 *
 * Replaced by a drawn SVG arrow with a SHAFT and a broad head: one long axis, one short, zero
 * symmetry, so the heading is legible from the silhouette alone. Bigger too (18 px, was 10). */
#fuelGauge .station .arrow{ width:18px; height:18px; flex:0 0 auto; transition:transform .45s ease; transform-origin:50% 50%; filter:drop-shadow(0 1px 3px rgba(28,34,48,.85)); }
#fuelGauge .station .dist{ font-size:14px; font-weight:600; font-variant-numeric:tabular-nums; text-shadow:0 1px 4px rgba(28,34,48,.85); transition:color .35s ease; }
/* THE METER-POINT WARNING. Operator: "gas station distance should flash yellow when running
 * below each meter point on the fuel gauge". The gauge has ticks at 1, 3/4, 1/2, 1/4 and 0 of
 * a tank; dropping past ANY of them flashes the distance-to-pumps amber for a few seconds and
 * then lets it go quiet again. It is a nudge at each gate, not a permanent alarm — the cozy
 * rule is that nothing SHOUTS, not that nothing ever speaks. */
#fuelGauge .station .dist.mark{ animation:fuelMark 1.05s ease-in-out 4; }
#fuelGauge .station .arrow.mark{ animation:fuelMarkArrow 1.05s ease-in-out 4; }
@keyframes fuelMark{ 0%,100%{ color:#F6ECD8 } 50%{ color:#FFD24A } }
@keyframes fuelMarkArrow{ 0%,100%{ opacity:1 } 50%{ opacity:.45 } }
/* The capacity meter — see the 'cap' block in the constructor. One segment per upgrade the
 * tank can still take, so how much this CAR has earned is a thing you can count at a glance. */
/* Below the dial, not across it: a first screenshot of the real page had this line printed
 * over the needle hub. Right-aligned to the widget's own column so the pips cannot creep left
 * over the speedometer as the text changes length. */
#fuelGauge .cap{ position:absolute; left:0; right:0; bottom:-17px; display:flex; align-items:center; justify-content:flex-end; gap:3px; white-space:nowrap; }
#fuelGauge .cap .seg{ width:6px; height:4px; border-radius:1px; background:rgba(246,236,216,.24); transition:background .4s ease; }
#fuelGauge .cap .seg.on{ background:#93B84E; }
#fuelGauge .cap .seg.part{ background:linear-gradient(90deg,#E0B14E var(--p,0%),rgba(246,236,216,.24) var(--p,0%)); }
#fuelGauge .cap .txt{ font-size:10px; letter-spacing:.04em; opacity:.85; font-variant-numeric:tabular-nums; margin-left:3px; text-shadow:0 1px 3px rgba(28,34,48,.85); }
#fuelGauge .station .pump{ flex:0 0 auto; opacity:.95; }
@keyframes fuelBreathe{ 0%,100%{opacity:.72} 50%{opacity:1} }
@media (max-width:640px){ #fuelGauge{ width:132px; height:54px; right:10px; bottom:104px; } #fuelGauge .cap .txt{ font-size:9px; } }
`;

export class FuelGauge {
  /** @param {HTMLElement} root the #hud element */
  constructor(root) {
    if (!document.getElementById('fuelGaugeCss')) {
      const st = document.createElement('style');
      st.id = 'fuelGaugeCss';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    this.root = document.createElement('div');
    this.root.id = 'fuelGauge';

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 104 70');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    // The box is wider than the dial (the capacity line needs the room); keep the dial its own
    // shape and centred rather than letting it stretch to fill.
    svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');

    // The dial: an arc from empty to full, drawn once. Warm at the full end, dusk at the
    // empty end — the colour carries the reading, so the needle only has to confirm it.
    const grad = document.createElementNS(NS, 'linearGradient');
    grad.setAttribute('id', 'fuelArc');
    grad.setAttribute('x1', '0');
    grad.setAttribute('x2', '1');
    for (const [off, col] of [['0%', '#C8503F'], ['38%', '#E0B14E'], ['100%', '#93B84E']]) {
      const s = document.createElementNS(NS, 'stop');
      s.setAttribute('offset', off);
      s.setAttribute('stop-color', col);
      grad.appendChild(s);
    }
    const defs = document.createElementNS(NS, 'defs');
    defs.appendChild(grad);
    svg.appendChild(defs);

    const CX = 52;
    const CY = 62;
    const R = 40;
    const arc = document.createElementNS(NS, 'path');
    arc.setAttribute('d', arcPath(CX, CY, R, -SWEEP, SWEEP));
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', 'url(#fuelArc)');
    arc.setAttribute('stroke-width', '7');
    arc.setAttribute('stroke-linecap', 'round');
    arc.setAttribute('opacity', '0.9');
    svg.appendChild(arc);

    /* Five meter points, not three. They are the gates the amber flash fires on (see
     * MARKS/.dist.mark), so the dial has to SHOW the thing the warning refers to — a warning
     * at an unmarked place on a gauge is just a warning at a random moment. */
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const a = (-SWEEP + f * SWEEP * 2) * (Math.PI / 180);
      const tick = document.createElementNS(NS, 'line');
      const sx = CX + Math.sin(a) * (R - 9);
      const sy = CY - Math.cos(a) * (R - 9);
      const ex = CX + Math.sin(a) * (R - 14);
      const ey = CY - Math.cos(a) * (R - 14);
      tick.setAttribute('x1', sx.toFixed(2));
      tick.setAttribute('y1', sy.toFixed(2));
      tick.setAttribute('x2', ex.toFixed(2));
      tick.setAttribute('y2', ey.toFixed(2));
      tick.setAttribute('stroke', '#F6ECD8');
      const major = f === 0 || f === 0.5 || f === 1;
      tick.setAttribute('stroke-width', major ? '1.8' : '1.2');
      tick.setAttribute('opacity', major ? '0.62' : '0.4');
      svg.appendChild(tick);
    }

    this.needle = document.createElementNS(NS, 'g');
    const n = document.createElementNS(NS, 'path');
    n.setAttribute('d', `M ${CX} ${CY} L ${CX - 2.6} ${CY - 4} L ${CX} ${CY - R + 8} L ${CX + 2.6} ${CY - 4} Z`);
    n.setAttribute('fill', '#F6ECD8');
    this.needle.appendChild(n);
    const hub = document.createElementNS(NS, 'circle');
    hub.setAttribute('cx', String(CX));
    hub.setAttribute('cy', String(CY));
    hub.setAttribute('r', '3.6');
    hub.setAttribute('fill', '#F6ECD8');
    this.needle.appendChild(hub);
    svg.appendChild(this.needle);

    this.root.appendChild(svg);
    this.mins = document.createElement('div');
    this.mins.className = 'mins';
    this.root.appendChild(this.mins);

    /* Always-on nearest-station readout — see the file header for why this one is not gated
     * on fuel level the way `.mins` above is. Sits in the empty band above the arc (the arc's
     * own topmost point is at SVG y=22 of 70; see arcPath below), so nothing already drawn has
     * to move to make room. */
    this.station = document.createElement('div');
    this.station.className = 'station';
    /* A PUMP, drawn rather than borrowed, so the number beside it says what it is a number OF.
     *
     * Operator on this readout: "no". It was on the screen the whole time — a bare 10 px
     * figure at 0.70 effective opacity with a triangle next to it and nothing to say it meant
     * "the next petrol station is this far away". A distance with no subject is not a readout,
     * it is a decoration, and the person it is for is very close to legally blind. So: a real
     * silhouette (13 px, the same cream as the needle), the figure up from 10 to 13 px and
     * semibold with its own shadow, and the block's own opacity off .85. Nothing here blinks,
     * moves or changes colour — the cozy rule is that it never SHOUTS, not that it hides.
     *
     * Drawn in SVG for the same reason the hundred roadside props are modelled in code and the
     * arrow is a CSS triangle: no icon font, no glyph, nothing downloaded. */
    const pump = document.createElementNS(NS, 'svg');
    pump.setAttribute('class', 'pump');
    pump.setAttribute('viewBox', '0 0 12 14');
    pump.setAttribute('width', '11');
    pump.setAttribute('height', '13');
    const body = document.createElementNS(NS, 'path');
    // the pump body: a squat box with a rounded top and a window, standing on a base line
    body.setAttribute('d', 'M1.2 3.2 A1.6 1.6 0 0 1 2.8 1.6 H6.4 A1.6 1.6 0 0 1 8 3.2 V13 H1.2 Z');
    body.setAttribute('fill', '#F6ECD8');
    pump.appendChild(body);
    const win = document.createElementNS(NS, 'rect');
    win.setAttribute('x', '2.6');
    win.setAttribute('y', '3.4');
    win.setAttribute('width', '4');
    win.setAttribute('height', '2.6');
    win.setAttribute('rx', '0.6');
    win.setAttribute('fill', 'rgba(28,34,48,.75)');
    pump.appendChild(win);
    // the hose and nozzle, arcing off the side — the bit that makes the silhouette read
    const hose = document.createElementNS(NS, 'path');
    hose.setAttribute('d', 'M8 5.2 H9.6 A1.4 1.4 0 0 1 11 6.6 V9.4');
    hose.setAttribute('fill', 'none');
    hose.setAttribute('stroke', '#F6ECD8');
    hose.setAttribute('stroke-width', '1.3');
    hose.setAttribute('stroke-linecap', 'round');
    pump.appendChild(hose);
    this.pump = pump;
    this.station.appendChild(pump);
    /* The direction marker. See the `.arrow` CSS above for why a perfect triangle had to go:
     * an equilateral triangle is identical under a 120 deg rotation, so it cannot express a
     * heading. This one is a shaft plus a head — long axis, short axis, no symmetry. */
    this.arrow = document.createElementNS(NS, 'svg');
    this.arrow.setAttribute('class', 'arrow');
    this.arrow.setAttribute('viewBox', '0 0 20 20');
    const shaft = document.createElementNS(NS, 'path');
    shaft.setAttribute('d', 'M10 18 V8.5');
    shaft.setAttribute('stroke', '#F6ECD8');
    shaft.setAttribute('stroke-width', '2.8');
    shaft.setAttribute('stroke-linecap', 'round');
    shaft.setAttribute('fill', 'none');
    this.arrow.appendChild(shaft);
    const head = document.createElementNS(NS, 'path');
    head.setAttribute('d', 'M10 1.6 L16.4 10.2 L10 7.6 L3.6 10.2 Z');
    head.setAttribute('fill', '#F6ECD8');
    this.arrow.appendChild(head);
    this.stationDist = document.createElement('span');
    this.stationDist.className = 'dist';
    this.stationDist.textContent = '—'; // resting value before any station is known — never blank
    this.station.appendChild(this.arrow);
    this.station.appendChild(this.stationDist);
    this.root.appendChild(this.station);

    /* ── the capacity meter ───────────────────────────────────────────────
     * Operator, two requests that are really one: "explain the streaks = gas capacity thing
     * better. Should be visually clear", and "clear capacity meter showing how much a car has
     * and making it clear it increases as you drive".
     *
     * So: one small segment per upgrade this tank can take, the earned ones lit, the one
     * you are working on filling left-to-right as cans go in, and the tank's own size in
     * minutes beside it. That makes all three facts readable without a menu — how big this
     * car's tank is now, that it grows, and exactly how much more is coming. It is per CAR
     * (see Fuel.capacityLevel), which is the other half of the instruction: swapping cars
     * empties these pips, and the meter is where you SEE that happen. */
    this.cap = document.createElement('div');
    this.cap.className = 'cap';
    this.capSegs = [];
    for (let i = 0; i < CAPACITY_UPGRADE_LEVELS; i++) {
      const seg = document.createElement('i');
      seg.className = 'seg';
      this.cap.appendChild(seg);
      this.capSegs.push(seg);
    }
    this.capTxt = document.createElement('span');
    this.capTxt.className = 'txt';
    this.cap.appendChild(this.capTxt);
    this.root.appendChild(this.cap);

    this._cx = CX;
    this._cy = CY;
    /** Highest meter point the tank has already fallen past this fill, as an index into
     *  MARKS. Reset upward when the tank is refilled, so a driver who tops up and empties
     *  again gets the same four warnings again. */
    this._markIdx = -1;
    /** How many meter-point warnings have fired. Test hook — the class stays on the element
     *  between flashes (the animation is restarted, not the class), so a counter is the only
     *  honest way to prove the SECOND and THIRD gates fired at all. */
    this._markFlashes = 0;
    this._capKey = '';
    this._shown = 1;
    this._angle = SWEEP;
    /** Smoothed bearing to the nearest known station, relative to the car's own heading,
     *  radians, + = to the left of the car — the same convention every bearing in this project
     *  uses (see tools/diag-o2.mjs's own note on it). Smoothed with dampAngle, the short way
     *  round, so a station scan finding a new nearest pump swings the arrow rather than
     *  snapping it, and so it never spins the long way past 180°. */
    this._arrowRad = 0;
    this._stationText = '—';
    root.appendChild(this.root);
  }

  /** The angle currently written into the needle transform, degrees. Test hook. */
  needleAngle() {
    return this._angle;
  }

  /** The rotation currently written into the station arrow, degrees. Test hook, same idea as
   *  needleAngle() above: the number actually driving the transform, not one re-derived by
   *  parsing it back out of a DOM/CSS string. CSS rotate() turns clockwise for a positive
   *  angle, and a positive `_arrowRad` means the station is to the LEFT (see its own comment
   *  in the constructor) — so a left-hand station needs a NEGATIVE css turn to point there,
   *  hence the sign flip here. */
  stationArrowDeg() {
    return -this._arrowRad * RAD2DEG;
  }

  /**
   * @param {number} dt seconds
   * @param {import('../game/fuel.js').Fuel} fuel
   * @param {object} car
   */
  update(dt, fuel, car) {
    // Smooth the needle. A gauge that tracks the tank exactly twitches with every gearshift,
    // because the burn rate follows the throttle.
    const target = fuel.fraction;
    this._shown += (target - this._shown) * Math.min(1, dt * 2.4);
    this._angle = -SWEEP + this._shown * SWEEP * 2;
    this.needle.setAttribute('transform', `rotate(${this._angle.toFixed(2)} ${this._cx} ${this._cy})`);

    // LOW_FRACTION, not a copy of the number: the gauge going quiet at 18% while the toast
    // fired at 15% would be exactly the kind of two-sources-of-truth drift this project has
    // been bitten by.
    const low = target <= LOW_FRACTION;
    if (low !== this._low) {
      this._low = low;
      this.root.classList.toggle('low', low);
    }
    const filling = fuel.refuelling;
    if (filling !== this._filling) {
      this._filling = filling;
      this.root.classList.toggle('filling', filling);
    }

    // One line of text, and only when it is worth reading: the minutes when the tank is
    // getting low, the way to the pumps when it is nearly gone, nothing at all otherwise.
    let text = '';
    if (filling) {
      text = `${Math.round(target * 100)}%`;
    } else if (fuel.dry) {
      text = 'empty';
    } else if (target < 0.34) {
      const m = fuel.minutesLeft(car);
      text = m >= 1 ? `${m.toFixed(0)} min` : `${Math.round(m * 60)} s`;
      if (target < 0.12 && fuel.nearest) text = fmt(fuel.nearest.dist);
    }
    if (text !== this._text) {
      this._text = text;
      this.mins.textContent = text;
    }

    // ── nearest station, always on — never gated on fuel level ─────────────
    // bearing = atan2(dx, dz): this project's one bearing formula (car/vehicle.js's own
    // "forward is (sin yaw, cos yaw)" note, tools/diag-o2.mjs, game/cinematic.js all agree).
    // angleDelta(car.yaw, bearing) is then + when the target is to the LEFT — proved against
    // this exact convention in tools/bench-fuel.mjs's "nearest-station counter" section.
    const n = fuel.nearest;
    const bearingTarget = n ? angleDelta(car.yaw, Math.atan2(n.x - car.x, n.z - car.z)) : 0;
    this._arrowRad = dampAngle(this._arrowRad, bearingTarget, 3, dt);
    this.arrow.style.transform = `rotate(${this.stationArrowDeg().toFixed(1)}deg)`;
    const distText = n ? fmt(n.dist) : '—';
    if (distText !== this._stationText) {
      this._stationText = distText;
      this.stationDist.textContent = distText;
    }

    /* ── the meter-point warning ──────────────────────────────────────────
     * Operator: "gas station distance should flash yellow when running below each meter point
     * on the fuel gauge". Fires on the RAW fraction, not the smoothed needle: the needle lags
     * by design (see `_shown` above) and a warning that fires half a second after the tank
     * actually crossed the line is a warning about the wrong moment.
     *
     * `_markIdx` walks down MARKS and only ever moves one gate per crossing, so a single
     * flash happens per gate, not one per frame; and it walks back UP when you refuel, so the
     * same four warnings are there on the next tank. */
    let idx = -1;
    for (let i = 0; i < MARKS.length; i++) if (target <= MARKS[i]) idx = i;
    if (idx > this._markIdx) {
      this._markIdx = idx;
      this._flashMark();
    } else if (idx < this._markIdx) {
      this._markIdx = idx; // refuelled past a gate — arm it again
    }

    /* ── the capacity meter ───────────────────────────────────────────────
     * Cheap: only touches the DOM when the level, the progress bucket or the tank size
     * actually changes, which is a handful of times in a whole session. */
    const level = fuel.capacityLevel ?? 0;
    const prog = fuel.capacityProgress ?? 0;
    const cans = fuel.carCans ?? 0;
    const key = `${level}|${Math.round(prog * 100)}|${Math.round(fuel.capacity)}`;
    if (key !== this._capKey) {
      this._capKey = key;
      for (let i = 0; i < this.capSegs.length; i++) {
        const seg = this.capSegs[i];
        const on = i < level;
        const part = i === level && level < this.capSegs.length;
        seg.classList.toggle('on', on);
        seg.classList.toggle('part', part);
        if (part) seg.style.setProperty('--p', `${Math.round(prog * 100)}%`);
      }
      const mins = fuel.capacity / 60;
      const toNext = CAPACITY_UPGRADE_EVERY - (cans % CAPACITY_UPGRADE_EVERY);
      this.capTxt.textContent =
        level >= this.capSegs.length
          ? `TANK ${mins.toFixed(0)}m MAX`
          : `TANK ${mins.toFixed(0)}m +${Math.round(CAPACITY_UPGRADE_STEP * 100)}% in ${toNext}`;
      this.capTxt.title = `This car's tank holds ${mins.toFixed(1)} minutes of cruising. Every ${CAPACITY_UPGRADE_EVERY} fuel cans you pick up make it permanently ${Math.round(CAPACITY_UPGRADE_STEP * 100)}% bigger, up to ${this.capSegs.length} upgrades. Capacity belongs to the car — a different car starts again.`;
    }
  }

  /** Flash the distance-to-pumps readout amber. Restarts the animation cleanly even if one is
   *  already running (removing the class is not enough; the reflow read is what re-arms it). */
  _flashMark() {
    this._markFlashes++;
    for (const el of [this.stationDist, this.arrow]) {
      el.classList.remove('mark');
      void el.getBoundingClientRect().width;
      el.classList.add('mark');
    }
  }

  /** Which meter point the gauge has most recently warned at, as a fraction. Test hook, the
   *  same idea as needleAngle(): the number that actually drove the behaviour. */
  lastMark() {
    return this._markIdx >= 0 ? MARKS[this._markIdx] : null;
  }

  /** Total meter-point warnings fired since the gauge was built. Test hook. */
  markFlashCount() {
    return this._markFlashes;
  }

  dispose() {
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}

function fmt(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

/** SVG arc between two angles measured from straight up, clockwise positive. */
function arcPath(cx, cy, r, a0, a1) {
  const p = (deg) => {
    const a = deg * (Math.PI / 180);
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  };
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
