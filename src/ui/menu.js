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

/* ── the seed ────────────────────────────────────────────────────────────────
 * "Need to be able to change seed value." `?seed=` has always worked; nothing in the running
 * game ever said so, and typing a query string is not a control.
 *
 * A RELOAD IS THE HONEST MECHANISM, not laziness. The world is seed-deterministic and it is
 * meshed in workers from that number — the same reason the Land buttons a few lines up reload.
 * Swapping it live would mean tearing down every chunk, every prop, the road cache, the
 * streamer and the car's own position mid-frame, and the button would be lying about what it
 * did the moment one of them held a stale reference. The label says "reloads".
 *
 * The three functions below are exported and pure so `node tools/diag-seedui.mjs` can hold the
 * real produced URL to account without a browser and without navigating anywhere.
 */
const SEED_MAX = 4294967295; // the world reads it through `>>> 0`, so this is the real range

/** Whatever the player typed -> a usable seed, or null. Long numbers wrap rather than fail. */
export function normaliseSeed(text) {
  const digits = String(text ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  const wrapped = n % (SEED_MAX + 1);
  return (wrapped || 1) >>> 0; // seed 0 is the "absent" value in main.js's parseInt fallback
}

/** A fresh random world. Never 0, for the same reason. */
export function rollSeed() {
  return (Math.floor(Math.random() * SEED_MAX) + 1) >>> 0;
}

/**
 * The query string that lands the player in `seed`, carrying the rest of the configuration
 * so changing the world does not silently cost them their car, feel or land.
 */
export function seedSearch(seed, current = {}, search = '') {
  const p = new URLSearchParams(search);
  p.set('seed', String(seed >>> 0));
  if (current.terrain) p.set('terrain', current.terrain);
  if (current.feel) p.set('feel', current.feel);
  if (current.car) p.set('car', current.car);
  return p.toString();
}

/**
 * The seed this page is actually running. The URL is authoritative when it carries one;
 * otherwise the live world's own value is read off `window.WANDEROAD.SEED` — the same object
 * tools/browser-test.mjs reads — rather than re-deriving main.js's default here, which is
 * exactly how a second opinion about one number starts.
 */
export function currentSeed() {
  const fromUrl = normaliseSeed(new URLSearchParams(globalThis.location?.search ?? '').get('seed'));
  if (fromUrl !== null) return fromUrl;
  const live = globalThis.WANDEROAD?.SEED;
  return Number.isFinite(live) ? live >>> 0 : null;
}

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

        <h3>Seed <small>the number this whole world is grown from — reloads</small></h3>
        <div class="row seedRow">
          <input data-seed type="text" inputmode="numeric" autocomplete="off" spellcheck="false"
                 aria-label="World seed" placeholder="world seed"
                 style="font:inherit;font-size:0.92rem;color:var(--ink);background:rgba(255,252,244,0.9);border:1px solid rgba(58,67,86,0.28);border-radius:10px;padding:0.42rem 0.7rem;width:11ch;letter-spacing:0.06em">
          <button data-act="seedRoll">Roll a new one</button>
          <button data-act="seedGo">Use this seed</button>
        </div>

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
    /* Enter inside the seed field does what the button does. Bound on the field itself so it
     * cannot reach the game's own key handling, and stopPropagation for the same reason: the
     * Garage is open, but `M` is still a global binding and typing a seed must not toggle it. */
    const seedEl = el.querySelector('[data-seed]');
    if (seedEl) {
      seedEl.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.applySeed();
      });
    }
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
    if (act === 'seedRoll') {
      const f = this.root.querySelector('[data-seed]');
      if (f) f.value = String(rollSeed());
      return;
    }
    if (act === 'seedGo') return this.applySeed();

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

  /**
   * Take whatever is in the field and go there. Returns the query string it navigated to (or
   * null if the field held nothing usable), so the harness can assert on the real value this
   * method produced rather than on a re-implementation of it.
   */
  applySeed() {
    const f = this.root.querySelector('[data-seed]');
    const seed = normaliseSeed(f && f.value);
    if (seed === null) {
      // Nothing usable typed. Do not navigate — silently reloading the same world would read
      // as a broken button. Put the current seed back so the field is never left empty.
      this.refreshSeed();
      return null;
    }
    const q = seedSearch(seed, this.current, globalThis.location?.search ?? '');
    if (globalThis.location) globalThis.location.search = q;
    return q;
  }

  /** Show the seed the world is actually running. Called every time the Garage opens. */
  refreshSeed() {
    const f = this.root.querySelector('[data-seed]');
    if (!f) return null;
    const s = currentSeed();
    f.value = s === null ? '' : String(s);
    return f.value;
  }

  show() {
    this._fillCars();
    this.refreshSeed();
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
