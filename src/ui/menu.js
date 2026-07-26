/* Wanderoad — the garage.
 *
 * One overlay, opened with Escape or M, that lets the player change their mind about the
 * decisions they made on the way in: which car, which feel, which land, and where the camera
 * sits. A cozy game should never make you close the tab to try the other car.
 *
 * Changing the CAR is live — it swaps the model in place and keeps your position, speed and
 * streak. Changing the FEEL is live too, because a feel is only a few numbers. Changing the
 * LAND is not: the terrain is meshed in workers from those numbers, so it reloads the page.
 * That distinction is honest rather than hidden — the button says so.
 */

import { CARS, CAR_KEYS } from '../car/loadedCar.js';
import { FEELS, TERRAINS } from '../game/presets.js';

const ESC = ['Escape', 'KeyM'];

export class Menu {
  /**
   * @param {object} hooks
   * @param {(key:string)=>Promise<void>} hooks.onCar     swap the car, live
   * @param {(key:string)=>void}          hooks.onFeel    swap the feel, live
   * @param {(key:string)=>void}          hooks.onTerrain change the land (reloads)
   * @param {()=>string}                  hooks.camera    current camera mode
   * @param {()=>string}                  hooks.cycleCam
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.open = false;
    this.current = { car: 'coupe', feel: 'road', terrain: 'rolling' };

    const el = (this.root = document.createElement('div'));
    el.id = 'menu';
    el.hidden = true;
    el.innerHTML = `
      <div class="sheet">
        <h2>Garage</h2>
        <p class="hint">Escape or M to close · everything here is also a URL parameter</p>

        <h3>Car <small>changes now</small></h3>
        <div class="row" data-group="car"></div>

        <h3>Feel <small>changes now</small></h3>
        <div class="row" data-group="feel"></div>

        <h3>Land <small>reloads the world</small></h3>
        <div class="row" data-group="terrain"></div>

        <div class="foot">
          <button data-act="camera">Camera: —</button>
          <button data-act="reset">Put me back on the road (R)</button>
          <a class="btn" href="./previews/">All previews</a>
          <button data-act="close">Drive</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    this._fill('car', CAR_KEYS.map((k) => [k, CARS[k].label]));
    this._fill('feel', Object.keys(FEELS).map((k) => [k, FEELS[k].label]));
    this._fill('terrain', Object.keys(TERRAINS).map((k) => [k, TERRAINS[k].label]));

    el.addEventListener('click', (e) => this._onClick(e));
    addEventListener('keydown', (e) => {
      if (!ESC.includes(e.code)) return;
      e.preventDefault();
      this.toggle();
    });
  }

  _fill(group, entries) {
    const row = this.root.querySelector(`[data-group="${group}"]`);
    row.innerHTML = entries
      .map(([k, label]) => `<button data-group="${group}" data-key="${k}">${label}</button>`)
      .join('');
  }

  _mark() {
    for (const b of this.root.querySelectorAll('button[data-key]')) {
      b.classList.toggle('on', this.current[b.dataset.group] === b.dataset.key);
    }
    const cam = this.root.querySelector('[data-act="camera"]');
    if (cam && this.hooks.camera) cam.textContent = `Camera: ${this.hooks.camera()}`;
  }

  async _onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const { group, key, act } = b.dataset;

    if (act === 'close') return this.hide();
    if (act === 'reset') {
      this.hooks.onReset?.();
      return this.hide();
    }
    if (act === 'camera') {
      this.hooks.cycleCam?.();
      return this._mark();
    }

    if (group === 'car') {
      this.current.car = key;
      this._mark();
      b.disabled = true;
      await this.hooks.onCar?.(key);
      b.disabled = false;
      this.hide();
    } else if (group === 'feel') {
      this.current.feel = key;
      this._mark();
      this.hooks.onFeel?.(key);
      this.hide();
    } else if (group === 'terrain') {
      // The land is baked in the workers, so this one genuinely has to reload. Carry the
      // rest of the configuration across so the player does not lose their car.
      const p = new URLSearchParams(location.search);
      p.set('terrain', key);
      p.set('feel', this.current.feel);
      p.set('car', this.current.car);
      location.search = p.toString();
    }
  }

  setCurrent(cfg) {
    Object.assign(this.current, cfg);
    this._mark();
  }

  show() {
    this.open = true;
    this.root.hidden = false;
    this._mark();
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }
}
