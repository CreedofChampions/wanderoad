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
import { mountInvite } from '../net/invite.js';

const ESC = ['Escape', 'KeyM'];

/* ── the controls, as they actually are ──────────────────────────────────────
 * "Controls need to be visible in the Garage" — the operator. This is the only place in the
 * running game that says what the keys do, so it has to be RIGHT, and every line below was
 * read out of the code that handles the key rather than out of a document:
 *
 *   src/car/input.js KEYMAP        steering, throttle, brake, handbrake, fine, attack, and
 *                                  the tapped() actions main.js consumes
 *   src/main.js frame()            camera C, reverse B, next car V, horn H, radio N,
 *                                  auto-drive G, reset R/T, give fuel F, assists 1-4
 *   src/ui/musicPanel.js           the music window on J
 *   this file, ESC above           Escape / M
 *
 * TWO BINDINGS IN KEYMAP ARE NOT LISTED, ON PURPOSE. `shiftUp: ['KeyE','ShiftRight']` and
 * `shiftDown: ['KeyQ']` exist in input.js's map but NOTHING reads them — `tapped('shiftUp')`
 * and `tapped('shiftDown')` appear nowhere in src/ or tools/, and vehicle.js's gearbox shifts
 * itself (see its up/down logic around `this.gear++`). Printing them here would be telling the
 * player about a control that does nothing, which is worse than not mentioning gears at all.
 *
 * input.js also exports a KEY_HELP array. It is imported by nobody, and it is out of date —
 * no F, no J, no Ctrl, and it credits Shift generally rather than the left one. It is not the
 * source of truth and it is not used here; consolidating the two means editing input.js, which
 * is not this pass's file. Flagged rather than silently duplicated.
 *
 * Shape: [group heading, [[keycaps], what it does]]. */
const CONTROLS = [
  [
    'Driving',
    [
      [['W', '↑'], 'throttle'],
      [['S', '↓'], 'brake'],
      [['A', 'D'], 'steer — or ← →'],
      [['Space'], 'handbrake'],
      [['B'], 'reverse'],
      [['Shift'], 'gentle — eases the throttle and the steering for cruising'],
      [['Ctrl'], 'keen — sharper steering, for when you mean it'],
      [['1', '2', '3', '4'], 'assists: cruise · sport · off · hardcore'],
    ],
  ],
  [
    'Everything else',
    [
      [['R'], 'put me back on the road (T does it too)'],
      [['C'], 'change camera'],
      [['V'], 'next car'],
      [['G'], 'auto-drive — sit back and watch'],
      [['N'], 'radio station'],
      [['J'], 'music window'],
      [['H'], 'horn'],
      [['F'], 'give fuel to a driver beside you'],
      [['Esc', 'M'], 'this Garage'],
    ],
  ],
  [
    'Not the keyboard',
    [
      // input.js poll(): axes[0] steering with a radial deadzone, buttons[7] throttle,
      // buttons[6] brake, buttons[0] handbrake. Devices are combined by magnitude and the game
      // never auto-switches between them, so a plugged-in pad never steals the keyboard.
      [['Gamepad'], 'left stick steers · triggers are throttle and brake · A is the handbrake'],
      // input.js attachTouch(), wired to the canvas in main.js.
      [['Touch'], 'left half of the screen steers · right half is throttle above, brake below'],
    ],
  ],
];

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

        <h3>Controls <small>a gamepad or a touchscreen works too</small></h3>
        ${CONTROLS.map(
          ([heading, rows]) => `
        <p class="keysHead">${heading}</p>
        <dl class="keys">${rows
          .map(
            ([keys, what]) =>
              `<div><dt>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</dt><dd>${what}</dd></div>`,
          )
          .join('')}</dl>`,
        ).join('')}

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

    /* How a second person joins — its own module, so the Garage knows nothing about seats or
     * identity. Above the button row rather than on the driving screen: this is the panel the
     * player is already reading when they wonder how any of this works. */
    const sheet = el.querySelector('.sheet');
    const invite = mountInvite(sheet);
    if (invite) sheet.insertBefore(invite, sheet.querySelector('.foot'));

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
