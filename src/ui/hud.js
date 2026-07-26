/* Wanderoad — the heads-up display.
 *
 * A cozy driving game should be able to be played with the HUD switched off and lose almost
 * nothing. So: a speed, a place, a streak, and a single line of text that appears when
 * something happens and then goes away. No meters, no bars, no pop-ups, no combo counter
 * screaming at you. The streak number grows quietly; when it breaks it fades rather than
 * flashes, because losing eighty kilometres should feel like a sigh, not an alarm.
 */

import { fmtScore, fmtDistance } from '../game/streak.js';
import { nextUnlock, fmtUnlock } from '../game/garage.js';
import { clamp01 } from '../core/math.js';
import { BIOME_SHORT } from '../world/biomes.js';

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.kph = document.getElementById('kph');
    this.gear = document.getElementById('gear');
    this.biome = document.getElementById('biome');
    this.coords = document.getElementById('coords');
    this.players = document.getElementById('players');
    this.toast = document.getElementById('toast');

    // The streak block is built here rather than in index.html so the markup stays a
    // shell and this module owns everything it touches.
    this.streakEl = document.createElement('div');
    this.streakEl.id = 'streak';
    this.streakEl.innerHTML =
      '<span id="streakKm">—</span><span id="streakMul"></span><span id="streakPts"></span>';

    /* The unlock bar, along the bottom of the screen. It answers one question — how far am I
     * from the next car — and it is the only place the game ever asks the player to want
     * something. It glows while a streak is running and blips red when one breaks. */
    this.bar = document.createElement('div');
    this.bar.id = 'unlockBar';
    this.bar.innerHTML =
      '<div class="fill"></div><div class="lbl"><span class="run"></span><span class="next"></span></div>';
    this.root.appendChild(this.bar);
    this.barFill = this.bar.querySelector('.fill');
    this.barRun = this.bar.querySelector('.run');
    this.barNext = this.bar.querySelector('.next');
    this._blip = 0;
    this.root.appendChild(this.streakEl);
    this.streakKm = this.streakEl.querySelector('#streakKm');
    this.streakMul = this.streakEl.querySelector('#streakMul');
    this.streakPts = this.streakEl.querySelector('#streakPts');

    this._toastT = 0;
    this._lastGear = null;
    this._lastBiome = -1;
    this._shownKm = 0;
  }

  /** One short line, centred, gone in a few seconds. The only interruption in the game. */
  say(text, seconds = 3.6) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    this._toastT = seconds;
  }

  update(dt, { car, streak, surface, remotes, netState }) {
    // ── speed ──
    const kph = Math.round(car.kph);
    this.kph.textContent = kph;

    const g = car.reverse ? 'R' : Math.abs(car.speed) < 0.6 ? 'N' : String(car.gear);
    if (g !== this._lastGear) {
      this.gear.textContent = g;
      this._lastGear = g;
    }

    // ── place ──
    if (surface && surface.dominant !== this._lastBiome) {
      this._lastBiome = surface.dominant;
      this.biome.textContent = BIOME_SHORT[surface.dominant];
      // Crossing into a new biome is worth one quiet line — it is the main thing that
      // happens when you drive a long way in this game.
      this.say(BIOME_SHORT[surface.dominant], 2.8);
    }
    this.coords.textContent = `${Math.round(car.x)}, ${Math.round(car.z)}`;

    // ── streak ──
    const s = streak.state;
    if (s.distance > 0) {
      this.streakEl.classList.add('live');
      this.streakEl.classList.toggle('grace', s.grace);
      // Smooth the displayed distance so the last digit is not a blur at 300 km/h.
      this._shownKm += (s.km - this._shownKm) * Math.min(1, dt * 9);
      this.streakKm.textContent = fmtDistance(this._shownKm * 1000);
      this.streakMul.textContent = s.multiplier > 1.02 ? `×${s.multiplier.toFixed(2)}` : '';
      this.streakPts.textContent = s.score > 5 ? fmtScore(s.score) : '';
    } else {
      this.streakEl.classList.remove('live', 'grace');
      this._shownKm = 0;
      this.streakKm.textContent = s.best > 0 ? `best ${fmtDistance(s.best)}` : '';
      this.streakMul.textContent = '';
      this.streakPts.textContent = '';
    }

    /* ── the unlock bar ─────────────────────────────────────────────── */
    const nu = nextUnlock(Math.max(s.best, s.distance));
    const live = s.distance > 0;
    this.bar.classList.toggle('live', live);
    if (nu) {
      const p = clamp01(Math.max(s.best, s.distance) / nu.car.unlockAt);
      this.barFill.style.width = `${(p * 100).toFixed(1)}%`;
      this.barRun.textContent = live ? fmtDistance(s.distance) : `best ${fmtDistance(s.best)}`;
      this.barNext.textContent = `${nu.car.label} at ${fmtUnlock(nu.car.unlockAt)}`;
    } else {
      this.barFill.style.width = '100%';
      this.barRun.textContent = live ? fmtDistance(s.distance) : `best ${fmtDistance(s.best)}`;
      this.barNext.textContent = 'every car unlocked';
    }
    if (this._blip > 0) {
      this._blip -= dt;
      if (this._blip <= 0) this.bar.classList.remove('broke');
    }

    const ev = streak.drain();
    if (ev) {
      if (ev.kind === 'milestone') this.say(ev.text, 3.2);
      else if (ev.kind === 'break') {
        this.say(`${fmtDistance(ev.distance)} — streak ended`, 3.0);
        this.bar.classList.add('broke');
        this._blip = 1.2;
      }
      if (ev.kind === 'unlock') this.say(`${ev.label} unlocked`, 4.0);
    }

    // ── other people ──
    if (remotes) {
      const list = remotes.list ? remotes.list() : [];
      if (list.length) {
        this.players.innerHTML = list
          .slice(0, 6)
          .map((p) => `<div>${escapeHtml(p.name)} <span class="dist">${Math.round(p.dist)} m</span></div>`)
          .join('');
      } else if (this.players.childNodes.length) {
        this.players.innerHTML = '';
      }
    }
    if (netState && netState !== this._lastNet) {
      this._lastNet = netState;
      this.root.dataset.net = netState;
    }

    // ── toast timer ──
    if (this._toastT > 0) {
      this._toastT -= dt;
      if (this._toastT <= 0) this.toast.classList.remove('show');
    }
  }
}

// Player names come off the network. They are rendered as text, never as markup.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
