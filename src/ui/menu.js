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
import { TERRAINS } from '../game/presets.js';
import { FLEET, FLEET_BY_ID, isUnlocked, cheatOn, fmtUnlock } from '../game/garage.js';

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

        <h3>Car <small>each one drives differently — unlocked by your best streak</small></h3>
        <div class="row" data-group="car"></div>

        <h3>Land <small>reloads the world</small></h3>
        <div class="row" data-group="terrain"></div>

        <div class="foot">
          <button data-act="auto">Auto-drive</button>
          <button data-act="cheat">Unlock all</button>
          <button data-act="camera">Camera: —</button>
          <button data-act="reset">Put me back on the road (R)</button>
          <a class="btn" href="./previews/">All previews</a>
          <button data-act="close">Drive</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    this._fillCars();
    this._fill('terrain', Object.keys(TERRAINS).map((k) => [k, TERRAINS[k].label]));

    el.addEventListener('click', (e) => this._onClick(e));
    addEventListener('keydown', (e) => {
      if (!ESC.includes(e.code)) return;
      e.preventDefault();
      this.toggle();
    });
  }

  /* Cars carry their unlock state. A locked one is shown, greyed, with what it costs —
   * seeing what you have not earned yet is the entire point of an unlock ladder. */
  _fillCars() {
    const best = this.hooks.bestStreak ? this.hooks.bestStreak() : 0;
    const row = this.root.querySelector('[data-group="car"]');
    row.innerHTML = FLEET.map((c) => {
      const open = isUnlocked(c, best);
      return `<button data-group="car" data-key="${c.id}" title="${c.blurb}"${
        open ? '' : ` class="locked" data-unlock="${fmtUnlock(c.unlockAt)}"`
      }>${c.label}</button>`;
    }).join('');
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
    const ch = this.root.querySelector('[data-act="cheat"]');
    if (ch) {
      ch.textContent = cheatOn() ? 'Unlocks: all open' : 'Unlock all (testing)';
      ch.classList.toggle('on', cheatOn());
    }
    const ad = this.root.querySelector('[data-act="auto"]');
    if (ad && this.hooks.isAuto) {
      const on = this.hooks.isAuto();
      ad.textContent = on ? 'Auto-drive: on (G)' : 'Auto-drive (G)';
      ad.classList.toggle('on', on);
    }
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
    if (act === 'cheat') {
      this.hooks.onCheat?.(!cheatOn());
      this._fillCars();
      this._mark();
      return;
    }
    if (act === 'auto') {
      this.hooks.onAuto?.();
      this._mark();
      return this.hide();
    }

    if (group === 'car') {
      const spec = FLEET_BY_ID[key];
      const best = this.hooks.bestStreak ? this.hooks.bestStreak() : 0;
      if (spec && !isUnlocked(spec, best)) return; // locked; the label already says why
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
    this._fillCars();
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
