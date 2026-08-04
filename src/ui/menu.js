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
import { FLEET, FLEET_BY_ID, isUnlocked, priceOf, unlockRule, cheatOn, fmtUnlock } from '../game/garage.js';
import { BOAT_UNLOCK_SUNS, CAN_PRICE, CAN_MAX } from '../game/wallet.js';
import { mountInvite } from '../net/invite.js';
import { PAD_HELP } from '../car/input.js';
import { GRASS_STEPS, grassQuality, setGrassQuality } from '../render/grass.js';
import { WATER_STYLES, currentWaterStyle, setWaterStyle } from '../render/waterStyles.js';
import { DRIVING_MODELS, currentDrivingModel, cycleDrivingModel } from '../car/drivingModels.js';

/* ── STEP A CYCLING LIST ──────────────────────────────────────────────────────
 * The Water and Driving rows are the same control twice over, so they are one function once.
 * Exported because it is the whole of the arithmetic those two buttons do, and
 * `node tools/diag-switchers.mjs` can then hold the wrap-around to account directly rather than
 * inferring it from a rendered label.
 *
 * `dir` of -1 off the front lands on the last entry, which is not decoration: with seven of each,
 * overshooting by one and then having to press six more times to get back is the difference between
 * a control and a punishment.
 *
 * @param {Array<{id:string}>} list
 * @param {string|{id:string}} current  the entry in force, or its id
 * @param {number} dir  +1 for the next, -1 for the one before
 */
export function nextInCycle(list, current, dir = 1) {
  const n = list?.length | 0;
  if (!n) return null;
  const id = typeof current === 'string' ? current : current?.id;
  const at = list.findIndex((x) => x.id === id);
  const i = at < 0 ? 0 : at; // an id nothing matches means "start at the beginning", never NaN
  return list[(((i + dir) % n) + n) % n];
}


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
 * THE CONTROLLER SECTION IS NOT WRITTEN OUT HERE — it is built from input.js's PAD_HELP, beside
 * the PADMAP it documents. That is the lesson of the KEY_HELP array, which also lives in input.js,
 * is imported by nobody, and drifted out of date unnoticed (no F, no J, no Ctrl, and it credits
 * Shift generally rather than the left one). A help list that lives away from its bindings becomes
 * a lie at the speed the bindings change. The keyboard half above still has that problem and is
 * flagged rather than silently duplicated; the pad half is now immune to it by construction.
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
    /* THE CONTROLLER, BUTTON BY BUTTON.
     *
     * This was one line — "left stick steers · triggers are throttle and brake · A is the handbrake"
     * — which was an honest description of a pad that could do four things. It can do fourteen now,
     * and the operator's ask was as much about KNOWING as about the bindings: "so u can open garage
     * w reset to road and KNOW how to do that".
     *
     * Built from input.js's PAD_HELP rather than written out again here, so a binding that changes
     * changes this list with it. The duplicated KEY_HELP is the cautionary tale — it sat in input.js
     * for months, imported by nobody and quietly out of date. */
    'Controller',
    PAD_HELP.map(([, cap, what]) => [[cap], what]),
  ],
  [
    'Touch',
    [
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
        <p class="hint">Escape, M or Start to close · on a pad: stick to move, A to choose, B to leave</p>

        <h3>Suns <small>everything you have ever collected, and what it opens next</small></h3>
        <div data-group="suns"></div>

        <h3>Car <small>each one drives differently — the first three by collecting, the rest at a dealership</small></h3>
        <div class="row" data-group="car"></div>

        <h3>Driving <small>seven ways the same car can feel — click the name for the next, it changes as you drive</small></h3>
        <div class="row" data-group="drive"></div>
        <p class="hint" data-hint="drive"></p>

        <h3>Tank <small>a bigger tank for the car you are driving — bought at a dealership</small></h3>
        <div class="row" data-group="tank"></div>
        <div class="row" data-group="town"></div>

        <h3>Shop <small>a boat at a harbour, spare fuel cans at a petrol station</small></h3>
        <div class="row" data-group="shop"></div>

        <h3>Grass <small>how far the meadow reaches — turn it down if the game runs slowly</small></h3>
        <div class="row" data-group="grass"></div>

        <h3>Water <small>seven different seas — click the name for the next, the sea changes at once</small></h3>
        <div class="row" data-group="water"></div>
        <p class="hint" data-hint="water"></p>

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

    this._fillSuns();
    this._fillGrass();
    this._fillWater();
    this._fillDrive();
    this._fillCars();
    this._fillTank();
    this._fillTown();
    this._fillShop();
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
    /* NO KEY LISTENER HERE ANY MORE.
     *
     * Escape and M used to be caught right here, which is why a gamepad could never open the Garage:
     * the binding lived in the panel instead of in the action table every other control goes through.
     * main.js now consumes `tapped('garage')`, so Escape, M and Start all arrive by one route.
     *
     * Leaving this listener in place as well was a real regression for a few minutes — Escape fired
     * BOTH handlers, the panel toggled twice in one frame, and it looked like the key had stopped
     * working. `browser-test` caught it on the line "Escape opens the garage". */
  }

  /* Cars carry their unlock state. A locked one is shown, greyed, with what it costs —
   * seeing what you have not earned yet is the entire point of an unlock ladder.
   *
   * What it costs is now SUNS, not distance (operator: "New cars = suns"), and the label says
   * whether you can afford it right now, because a price you cannot act on is just a number.
   * The greyed ones are still shown and still say what they cost: that is the shop window. */
  /* ── EVERY SUN YOU HAVE EVER COLLECTED, AND WHAT IT OPENS ────────────────────
   *
   * Operator: "We could then say, click escape to see all the suns you've collected, and then have a
   * progress bar toward unlocks like cars."
   *
   * Two numbers, because they are genuinely different and confusing them is how a player concludes
   * the game took their money: COLLECTED is the odometer and never falls, IN POCKET is what is left
   * to spend. The odometer is the headline because it is the one that opens the first three cars.
   *
   * Then a bar per car still to come, in fleet order, each measured against the ladder that actually
   * governs it — the earned ones against the odometer, the dealership ones against the balance. A bar
   * that fills against the wrong number is worse than no bar: it would sit at 100% while the car
   * stayed locked. `unlockRule` in game/garage.js is the single source of which is which.
   *
   * Cars already yours are listed as a plain line rather than dropped, because "what have I got" is
   * half of what someone opens this panel to find out. */
  /* THE GRASS SLIDER. Operator: "the original grass is visible from much farther -- put that on by
   * default and have a slider for settings to reduce lag for lesser pcs."
   *
   * A reload, like the Land buttons beside it and for the same honest reason: the grass rings are
   * built from these numbers when the field is constructed, and pretending otherwise would mean
   * tearing down and rebuilding four instanced meshes mid-frame. The button says "reloads". */
  _fillGrass() {
    const row = this.root.querySelector('[data-group="grass"]');
    if (!row) return;
    const now = grassQuality().id;
    row.innerHTML = GRASS_STEPS.map(
      (q) => `<button data-group="grass" data-key="${q.id}"${q.id === now ? ' class="on"' : ''}>${q.label}</button>`
    ).join('');
  }

  /* ── THE TWO CYCLERS: WATER AND DRIVING ──────────────────────────────────────
   *
   * Operator, of the seven waters: "make seven different water types that I can stick in-game by
   * just clicking a button". So: a button, and it says what you are looking at.
   *
   * A CYCLER RATHER THAN A ROW OF SEVEN, which is the one design decision in here. Every other row
   * in this panel lays its options out side by side, and for four grass steps or eleven cars that is
   * right. Seven waters and seven driving models would add fourteen buttons to a sheet that already
   * scrolls, and — more to the point — the labels alone ('Low-poly', 'Glass', 'Graft') do not tell
   * you what you would be choosing. One button that NAMES what is in force, with the style's own
   * one-line blurb under it, answers "what am I looking at" first and "what else is there" second,
   * which is the order someone opening this panel actually asks them in.
   *
   * The ◀ beside it is the price of a cycler and is paid rather than ignored: seven entries means
   * overshooting by one otherwise costs six more presses.
   *
   * NEITHER OF THESE RELOADS, and that is the difference from the Grass row directly above the Water
   * one. Grass reloads honestly — its four instanced meshes are built from the quality numbers at
   * construction. The water is ONE material shared by every plane in the world, so swapping the
   * shader source and setting `needsUpdate` changes the whole sea in that frame; a driving model is
   * numbers in the shared tuning tables, which the solver re-reads on its next 120 Hz step. The
   * headings say "changes at once" and "as you drive" because that is what happens, and a heading
   * that promised a reload here would be a lie in the other direction.
   *
   * `this.current[group]` is set to the entry in force so `_mark()` agrees with the `on` class
   * written here instead of clearing it on the next redraw — both are read off the same `now.id`.
   *
   * @param {string} group  the data-group, and the key in `this.current`
   * @param {string} title  the word the button leads with, for anyone who cannot read the small
   *                        uppercase heading above it
   * @param {Array<{id:string,label:string,blurb:string}>} list
   * @param {{id:string,label:string,blurb:string}} now  the entry in force
   */
  _fillCycle(group, title, list, now) {
    const row = this.root.querySelector(`[data-group="${group}"]`);
    if (!row || !now) return;
    const i = list.findIndex((s) => s.id === now.id);
    row.innerHTML =
      `<button data-group="${group}" data-key="prev" title="the one before" aria-label="${title}: the one before">◀</button>` +
      `<button data-group="${group}" data-key="${now.id}" class="on" title="${now.blurb}">${title}: ${now.label}</button>`;
    const hint = this.root.querySelector(`[data-hint="${group}"]`);
    if (hint) hint.textContent = `${now.blurb} — ${Math.max(0, i) + 1} of ${list.length}`;
    this.current[group] = now.id;
  }

  /** The sea. Live, and remembered — see render/waterStyles.js. */
  _fillWater() {
    this._fillCycle('water', 'Water', WATER_STYLES, currentWaterStyle());
  }

  /** How the car you are in behaves. Live, and remembered — see car/drivingModels.js. */
  _fillDrive() {
    this._fillCycle('drive', 'Driving', DRIVING_MODELS, currentDrivingModel());
  }

  _fillSuns() {
    const box = this.root.querySelector('[data-group="suns"]');
    if (!box) return;
    const wallet = this.hooks.wallet ? this.hooks.wallet() : null;
    if (!wallet) {
      box.innerHTML = '';
      return;
    }
    const best = this.hooks.bestStreak ? this.hooks.bestStreak() : 0;
    const owned = FLEET.filter((c) => isUnlocked(c, best, wallet));
    const togo = FLEET.filter((c) => !isUnlocked(c, best, wallet));

    const bars = togo
      .map((c) => {
        const r = unlockRule(c);
        const have = r.how === 'earn' ? wallet.sunsEarned : wallet.suns;
        const pct = r.at > 0 ? Math.max(0, Math.min(1, have / r.at)) : 1;
        const left = Math.max(0, r.at - have);
        const how =
          r.how === 'earn'
            ? left > 0
              ? `${left} more to collect`
              : 'unlocked'
            : left > 0
              ? `${left} more, then a dealership`
              : 'affordable — find a dealership';
        return `<div class="unlockRow">
            <div class="unlockTop"><span>${c.label}</span><span>${have} / ${r.at}</span></div>
            <div class="unlockBar${r.how === 'earn' ? ' earn' : ''}"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
            <div class="unlockWhat">${how}</div>
          </div>`;
      })
      .join('');

    box.innerHTML = `
      <div class="sunTotals">
        <div><b>${wallet.sunsEarned}</b><span>collected in all</span></div>
        <div><b>${wallet.suns}</b><span>in your pocket</span></div>
        <div><b>${owned.length}/${FLEET.length}</b><span>cars</span></div>
      </div>
      <p class="ownedList">${owned.map((c) => c.label).join(' · ')}</p>
      ${bars || '<p class="ownedList">Every car is yours.</p>'}`;
  }

  _fillCars() {
    const best = this.hooks.bestStreak ? this.hooks.bestStreak() : 0;
    const wallet = this.hooks.wallet ? this.hooks.wallet() : null;
    const row = this.root.querySelector('[data-group="car"]');
    row.innerHTML = FLEET.map((c) => {
      const open = isUnlocked(c, best, wallet);
      /* TWO LADDERS, AND THE LABEL HAS TO SAY WHICH ONE YOU ARE ON. Operator: "Maybe we can have
       * the first three cars be total collected, and then the rest will be find a dealership."
       *
       * A locked car that says "45 suns" when the way to get it is to collect seventy in total is
       * worse than saying nothing — it sends you to a dealership you cannot buy it at. So an EARNED
       * car names the total and how far off you are, and a BOUGHT car names the price. `unlockRule`
       * is the single source of that split; the garage does not re-derive it. */
      const rule = unlockRule(c);
      const price = priceOf(c);
      let tag;
      if (!wallet) tag = fmtUnlock(c.unlockAt);
      else if (rule.how === 'earn')
        tag = `collect ${rule.at} suns in all — you have collected ${wallet.sunsEarned}`;
      else tag = `${price} suns at a dealership${wallet.suns >= price ? '' : ` — you have ${wallet.suns}`}`;
      return `<button data-group="car" data-key="${c.id}" title="${c.blurb}"${
        open ? '' : ` class="locked" data-unlock="${tag}"`
      }>${c.label}</button>`;
    }).join('');
  }

  /* The gas bonus, as a purchase. Operator: "Gas bonus = buy it for suns."
   *
   * One button, because there is one thing to buy: the next capacity step for the car you are
   * in. It says the price, whether you can afford it, and — when you are not standing at a
   * dealership — where to go, which is the only actionable thing to say at that point. */
  _fillTank() {
    const row = this.root.querySelector('[data-group="tank"]');
    if (!row) return;
    const fuel = this.hooks.fuel ? this.hooks.fuel() : null;
    const wallet = this.hooks.wallet ? this.hooks.wallet() : null;
    if (!fuel || !wallet) {
      row.innerHTML = '';
      return;
    }
    if (!fuel.tankUpgradable) {
      row.innerHTML = '<button class="locked" data-unlock="this tank is as big as it gets">Tank at maximum</button>';
      return;
    }
    const price = fuel.tankPrice;
    const canAfford = wallet.suns >= price;
    const label = `+10% tank · ${price} suns`;
    row.innerHTML = `<button data-group="tank" data-key="buy"${
      canAfford ? '' : ` class="locked" data-unlock="you have ${wallet.suns}"`
    }>${label}</button>`;
  }

  /* ── UPGRADING THE TOWN YOU ARE STANDING IN ──────────────────────────────
   * Operator: "Towns can be upgraded". A town belongs to a PLACE, so this row follows the shop's
   * rule rather than the tank's: it is always shown, and when you are not at a station it says
   * where to go instead of disappearing. A row that vanishes when it is not usable is a feature
   * the player never learns exists. */
  _fillTown() {
    const row = this.root.querySelector('[data-group="town"]');
    if (!row) return;
    const wallet = this.hooks.wallet ? this.hooks.wallet() : null;
    const here = this.hooks.townHere ? this.hooks.townHere() : null;
    if (!wallet) {
      row.innerHTML = '';
      return;
    }
    if (!here || !here.key) {
      row.innerHTML =
        '<button class="locked" data-unlock="drive onto a forecourt to build up its town">Upgrade a town · at a station</button>';
      return;
    }
    const tier = wallet.townLevel(here.key);
    const price = wallet.townPrice(here.key);
    if (price === null) {
      row.innerHTML = `<button class="locked" data-unlock="every building this town can have is built">${here.name || 'This town'} is fully built</button>`;
      return;
    }
    const canAfford = wallet.suns >= price;
    const label = `Build up ${here.name || 'this town'} · tier ${tier + 1} · ${price} suns`;
    row.innerHTML = `<button data-group="town" data-key="buy"${
      canAfford ? '' : ` class="locked" data-unlock="you have ${wallet.suns}"`
    }>${label}</button>`;
  }

  /* The two purchases that belong to a PLACE rather than to the car: the boat at a harbour and a
   * spare fuel can at a pump. Operator: "buying a boat ... isn't automatic, but something you get at
   * the harbor", and "make it so you can buy gas cans in the petrol stations".
   *
   * Both buttons are always shown, and when you are not standing in the right place the button says
   * where to go — which is the only useful thing to say at that point, and is what stops the shop
   * from being a menu you have to already understand. */
  _fillShop() {
    const row = this.root.querySelector('[data-group="shop"]');
    if (!row) return;
    const wallet = this.hooks.wallet ? this.hooks.wallet() : null;
    if (!wallet) {
      row.innerHTML = '';
      return;
    }
    const here = { pump: !!this.hooks.atPump?.(), harbour: !!this.hooks.atHarbour?.() };
    const out = [];

    if (wallet.boat) {
      out.push('<button class="locked" data-unlock="yours — B to take it out">Boat owned</button>');
    } else {
      const price = BOAT_UNLOCK_SUNS;
      const why = !here.harbour ? 'at a harbour' : wallet.suns < price ? `you have ${wallet.suns}` : '';
      out.push(
        `<button data-group="shop" data-key="boat"${why ? ` class="locked" data-unlock="${why}"` : ''}>Boat · ${price} suns</button>`
      );
    }

    const canFull = wallet.cans >= CAN_MAX;
    const canWhy = canFull ? 'boot is full' : !here.pump ? 'at a petrol station' : wallet.suns < CAN_PRICE ? `you have ${wallet.suns}` : '';
    out.push(
      `<button data-group="shop" data-key="can"${canWhy ? ` class="locked" data-unlock="${canWhy}"` : ''}>Fuel can · ${CAN_PRICE} suns (${wallet.cans}/${CAN_MAX})</button>`
    );
    row.innerHTML = out.join('');
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
    /* THE SHORTCUT IN THE LABEL HAS TO BE A SHORTCUT THE PLAYER HAS.
     *
     * "Put me back on the road (R)" is the most important button in the panel and it named a key —
     * so on a controller it advertised the one thing the pad player could not do, right next to the
     * button that would have done it. `device()` comes from main.js, which owns the Input. Auto-drive
     * keeps its (G) because there is deliberately no pad binding for it: it is a spectator toggle,
     * not something to hand a face button to. */
    const rs = this.root.querySelector('[data-act="reset"]');
    if (rs) {
      const pad = this.hooks.device && this.hooks.device() === 'pad';
      rs.textContent = `Put me back on the road (${pad ? 'Y' : 'R'})`;
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

    if (group === 'grass') {
      setGrassQuality(key);
      this._fillGrass();
      this.hooks.say?.('reloading with the new grass…', 2.0);
      setTimeout(() => location.reload(), 350);
      return;
    }

    /* THE SEA, CHANGED WHILE YOU LOOK AT IT. No reload and no `setTimeout` — compare the grass
     * branch directly above, which needs both. `setWaterStyle` remembers the choice and puts the new
     * shader on every water material in the scene before it returns; the panel is still open over a
     * sea that has already changed, which is why the toast is short. */
    if (group === 'water') {
      const style = setWaterStyle(nextInCycle(WATER_STYLES, currentWaterStyle(), key === 'prev' ? -1 : 1).id);
      if (!style) return;
      this._fillWater();
      this._mark();
      this.hooks.say?.(`water: ${style.label} — ${style.blurb}`, 3.0);
      return;
    }

    /* HOW THE CAR FEELS, CHANGED WHILE YOU DRIVE IT. Two halves, deliberately: `cycleDrivingModel`
     * chooses and persists (car/drivingModels.js's own wrapping cycler — the water module has no
     * equivalent, which is why the line above computes its step and this one does not), and the
     * `onDrive` hook is main.js putting it on the Vehicle the player is actually sitting in. The
     * panel does not know which car that is, and should not. */
    if (group === 'drive') {
      const model = cycleDrivingModel(key === 'prev' ? -1 : 1);
      this.hooks.onDrive?.(model);
      this._fillDrive();
      this._mark();
      this.hooks.say?.(`driving: ${model.label} — ${model.blurb}`, 3.4);
      return;
    }

    if (group === 'car') {
      const spec = FLEET_BY_ID[key];
      const best = this.hooks.bestStreak ? this.hooks.bestStreak() : 0;
      const wallet = this.hooks.wallet ? this.hooks.wallet() : null;
      /* Clicking a car you do not own is an attempt to BUY it. It only goes through at a
       * dealership — `canBuy` is main.js's own proximity test — so the garage is where you
       * choose between the cars you own, and a dealership is where the fleet grows. */
      if (spec && !isUnlocked(spec, best, wallet)) {
        /* An EARNED car cannot be bought at any price, so offering to sell it would be a lie. Say
         * what actually opens it and how far off it is. */
        const rule = unlockRule(spec);
        if (wallet && rule.how === 'earn') {
          this.hooks.say?.(
            `${spec.label} opens at ${rule.at} suns collected — you have ${wallet.sunsEarned}`,
            3.4,
          );
          return;
        }
        if (!wallet || !this.hooks.canBuy?.()) {
          this.hooks.say?.(`${spec.label} costs ${priceOf(spec)} suns — buy it at a dealership`, 3.2);
          return;
        }
        if (!wallet.buyCar(spec.id, priceOf(spec))) {
          this.hooks.say?.(`${spec.label} costs ${priceOf(spec)} suns — you have ${wallet.suns}`, 3.2);
          return;
        }
        this.hooks.say?.(`${spec.label} is yours`, 3.0);
        this._fillSuns();
        this._fillCars();
        this._mark();
      }
      this.current.car = key;
      this._mark();
      b.disabled = true;
      await this.hooks.onCar?.(key);
      b.disabled = false;
      this.hide();
    } else if (group === 'tank') {
      const fuel = this.hooks.fuel?.();
      const wallet = this.hooks.wallet?.();
      if (!fuel || !wallet) return;
      if (!this.hooks.canBuy?.()) {
        this.hooks.say?.('a bigger tank is fitted at a dealership', 3.0);
        return;
      }
      if (!fuel.tankUpgradable) return;
      const price = fuel.tankPrice;
      if (!wallet.buyTank(fuel.carId, price)) {
        this.hooks.say?.(`a bigger tank costs ${price} suns — you have ${wallet.suns}`, 3.2);
        return;
      }
      this.hooks.say?.(`bigger tank fitted — ${(fuel.capacity / 60).toFixed(0)} min now`, 3.0);
      this._fillTank();
    } else if (group === 'town') {
      const wallet = this.hooks.wallet?.();
      const here = this.hooks.townHere?.();
      if (!wallet) return;
      if (!here || !here.key) {
        this.hooks.say?.('towns are built up at a station — drive onto a forecourt', 3.4);
        return;
      }
      const price = wallet.townPrice(here.key);
      if (price === null) return;
      const tier = wallet.buyTown(here.key);
      if (!tier) {
        this.hooks.say?.(`building this town up costs ${price} suns — you have ${wallet.suns}`, 3.4);
        return;
      }
      this.hooks.say?.(`${here.name || 'the town'} grew — tier ${tier}`, 3.2);
      /* The town has to appear NOW, not the next time this tile streams — you are standing in it.
       * See Props.rebuildAround for why forcing a reshape is not enough on its own. */
      this.hooks.rebuildTown?.(here);
      this._fillTown();
    } else if (group === 'shop') {
      const wallet = this.hooks.wallet?.();
      if (!wallet) return;
      if (key === 'boat') {
        if (wallet.boat) return;
        if (!this.hooks.atHarbour?.()) {
          this.hooks.say?.('boats are sold at a harbour — look for the light over the water', 3.4);
          return;
        }
        if (!wallet.buyBoat()) {
          this.hooks.say?.(`the boat costs ${BOAT_UNLOCK_SUNS} suns — you have ${wallet.suns}`, 3.4);
          return;
        }
        this.hooks.say?.('the boat is yours — B to take it out on the water', 4.0);
      } else if (key === 'can') {
        if (!this.hooks.atPump?.()) {
          this.hooks.say?.('fuel cans are sold at a petrol station', 3.2);
          return;
        }
        if (!wallet.buyCan(CAN_PRICE)) {
          this.hooks.say?.(
            wallet.cans >= CAN_MAX ? 'the boot is already full of cans' : `a can costs ${CAN_PRICE} suns — you have ${wallet.suns}`,
            3.2
          );
          return;
        }
        this.hooks.say?.(`a spare can in the boot — ${wallet.cans} of ${CAN_MAX}. Press F to use one`, 4.0);
      }
      this._fillShop();
      this._mark();
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


  /**
   * Drive the Garage from a gamepad.
   *
   * Operator: "add clear controler support and controls so u can open garage". Start opens it - but
   * a panel you can open and then not touch is worse than one you cannot open, so the pad moves a
   * focus ring through the buttons and A presses the one it is on.
   *
   * The focus is the BROWSER's own focus, not a private index, for two reasons: the ring is drawn
   * for free and correctly, and Tab from a keyboard and the stick from a pad end up in the same
   * place rather than fighting over two ideas of "the current button".
   *
   * `dy` steps a whole ROW because the rows are the sections - Car, Tank, Shop, Land - and stepping
   * one button at a time through a fleet of seven to reach the next section is not navigation.
   *
   * @param {{dx:number, dy:number, confirm:boolean, cancel:boolean}} nav from Input.padNav()
   */
  padNav(nav) {
    if (!this.open || !nav) return;
    if (nav.cancel) {
      this.hide();
      return;
    }
    const rows = [...this.root.querySelectorAll('.sheet .row, .sheet .foot')].filter((r) =>
      r.querySelector('button, .btn')
    );
    if (!rows.length) return;
    const buttons = (r) => [...r.querySelectorAll('button, .btn')];
    const active = document.activeElement;
    let ri = rows.findIndex((r) => r.contains(active));
    let bi = ri >= 0 ? buttons(rows[ri]).indexOf(active) : -1;
    if (ri < 0) {
      /* FOCUS IS SOMEWHERE THIS WALKER DOES NOT KNOW — AND THAT IS NOT AN INVITATION TO MOVE IT.
       *
       * This branch used to seed at row 0 unconditionally, and it is the whole of B19: "drive
       * togetheer buttons seem to push u to top of screen and do nothing else".
       *
       * `rows` is `.sheet .row, .sheet .foot`. The "Drive together" panel is a `<div id="invite">`
       * and is neither, so pressing its Copy button gives `ri = -1` — and padNav, which runs every
       * frame while the Garage is open, immediately took that as "nothing is focused", pulled the
       * focus back to the first row and scrolled the sheet to it. Traced on the live beta, with the
       * stack, in the millisecond after mousedown:
       *
       *   pointerdown on BUTTON[Copy]  top=2073
       *   focusout BUTTON[Hatch] -> focusin BUTTON[Copy]      (the browser does the right thing)
       *   focusout BUTTON[Copy]  -> focusin BUTTON[Hatch]  top=519   (padNav takes it straight back)
       *   scrollIntoView(BUTTON[Hatch]) at padNav
       *   mouseup on DIV[Garage] -> click on DIV[Garage]
       *
       * The sheet jumps 1554 px between press and release, so the button is no longer under the
       * cursor and the click lands on the container: the view moves AND the handler never runs,
       * which is both halves of his sentence from one cause.
       *
       * The guard below ("nothing asked for; do not steal a focus the player set with Tab") already
       * states the correct rule — it just never covered this branch. A pad player still gets a
       * highlight the moment they ask for one, because seeding is what dy/dx/confirm do here. */
      if (!nav.dy && !nav.dx && !nav.confirm) return;
      ri = 0;
      bi = 0;
    } else if (nav.dy) {
      ri = (ri + nav.dy + rows.length) % rows.length;
      bi = Math.min(Math.max(bi, 0), buttons(rows[ri]).length - 1);
    } else if (nav.dx) {
      const list = buttons(rows[ri]);
      bi = (bi + nav.dx + list.length) % list.length;
    } else if (!nav.confirm) {
      return; // nothing asked for; do not steal a focus the player set with Tab
    }
    const target = buttons(rows[ri])[Math.max(0, bi)];
    if (!target) return;
    if (nav.confirm && active === target) {
      target.click();
      return;
    }
    target.focus({ preventScroll: false });
    target.scrollIntoView({ block: 'nearest' });
  }

  show() {
    /* REFILL EVERY ROW THAT READS THE WALLET, not just the cars.
     *
     * Only `_fillCars` was refreshed here, so the Tank and Shop rows kept whatever balance they were
     * built with — a photograph of the panel shows "+10% tank · 15 suns / you have 0" next to a
     * headline reading 75 in your pocket. The panel contradicting itself is worse than it being
     * absent, and it is the sort of thing that reads as the game having lost your money. */
    this._fillSuns();
    this._fillCars();
    this._fillTank();
    this._fillShop();
    /* The two cyclers are refilled here as well, for the same reason as the wallet rows: their state
     * lives outside this panel. `?water=cel` on the URL, or a choice made in a previous session and
     * read back out of localStorage, both mean the label built in the constructor can already be
     * stale by the time anyone opens the Garage. A picker showing the wrong current value is worse
     * than no picker — it is the panel disagreeing with the sea in the window behind it. */
    this._fillWater();
    this._fillDrive();
    this.refreshSeed();
    this.open = true;
    this.root.hidden = false;
    this._mark();
    /* Put the focus somewhere on the way in. A pad player who opens the Garage and has to flick the
     * stick once before anything highlights has been shown a dead panel for a second, which is
     * exactly long enough to conclude the controller does not work in here. */
    const first = this.root.querySelector('.sheet .row button, .sheet .row .btn');
    if (first) first.focus({ preventScroll: true });
  }

  hide() {
    this.open = false;
    this.root.hidden = true;
  }

  toggle() {
    this.open ? this.hide() : this.show();
  }
}
