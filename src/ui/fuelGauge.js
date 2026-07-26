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
 * A note on gotcha 3 (a flag being set is not a thing being visible): everything here is a
 * measured geometric property of an SVG, not a class toggle. `needleAngle()` returns the
 * angle actually written into the transform, which is what tools/bench-fuel.mjs asserts
 * against, so "the gauge moved" is provable without a browser.
 */

import { LOW_FRACTION } from '../game/fuel.js';

const NS = 'http://www.w3.org/2000/svg';

/* The needle sweeps this arc, in degrees, measured from straight up.
 * -60 is empty on the left, +60 is full on the right — a real gauge's sweep, not a full
 * circle, because a short sweep is legible at a glance and a long one is not. */
const SWEEP = 60;

const CSS = `
#fuelGauge{
  position:absolute; right:18px; bottom:74px; width:104px; height:70px;
  pointer-events:none; opacity:.82; transition:opacity .5s ease;
  font:500 11px/1.2 ui-rounded,-apple-system,Segoe UI,Roboto,sans-serif;
  color:#F6ECD8; text-shadow:0 1px 3px rgba(28,34,48,.55);
}
#fuelGauge.low{ opacity:1; animation:fuelBreathe 3.4s ease-in-out infinite; }
#fuelGauge.filling{ opacity:1; }
#fuelGauge .lbl{ position:absolute; left:0; right:0; bottom:-2px; text-align:center; letter-spacing:.08em; }
#fuelGauge .mins{ position:absolute; left:0; right:0; bottom:10px; text-align:center; opacity:.72; font-size:10px; }
@keyframes fuelBreathe{ 0%,100%{opacity:.72} 50%{opacity:1} }
@media (max-width:640px){ #fuelGauge{ width:78px; height:54px; right:10px; bottom:60px; } }
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

    for (const f of [0, 0.5, 1]) {
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
      tick.setAttribute('stroke-width', '1.6');
      tick.setAttribute('opacity', '0.55');
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
    this.label = document.createElement('div');
    this.label.className = 'lbl';
    this.label.textContent = 'FUEL';
    this.root.appendChild(this.label);

    this._cx = CX;
    this._cy = CY;
    this._shown = 1;
    this._angle = SWEEP;
    root.appendChild(this.root);
  }

  /** The angle currently written into the needle transform, degrees. Test hook. */
  needleAngle() {
    return this._angle;
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
