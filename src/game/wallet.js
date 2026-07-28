/* Wanderoad — the wallet: coins, gems, and the boat unlock.
 *
 * Pure and testable, no DOM, no three.js — the same "feed it plain numbers" discipline
 * src/game/streak.js documents for itself. localStorage is the one side effect, and it is
 * debounced and flushed exactly the way streak.js's own `save()`/`flush()` split works: a
 * coin collected every second of driving must not mean a write every second, but a long
 * session must not lose one either.
 *
 * The boat is the one piece of state here that is not just a running total. Collecting your
 * five-hundredth coin is an EVENT — "the boat is yours" — not a threshold main.js has to poll
 * for, so crossing BOAT_UNLOCK_COINS queues a one-shot message the same way
 * src/game/streak.js's own milestone ladder does (drain(), popped once by the frame loop).
 * `?cheat` (src/game/garage.js's cheatOn()) also unlocks the boat, per docs/BOAT-PLAN.md's own
 * hard rules — but that is a standing STATE check on `boatUnlocked`, not an event: turning
 * cheat mode on mid-drive should not fire the same toast a real 500-coin drive earns.
 */

import { cheatOn } from './garage.js';

/** Coins needed to earn the boat outright. */
/* 50, not 500. Coins are now ~1 per kilometre (see world/loot.js), so 500 was a 500 km
 * errand — the operator's own number for the boat is 50. */
export const BOAT_UNLOCK_COINS = 50;

/** How rarely a dirty wallet is actually written to localStorage, seconds — see update(). */
const SAVE_INTERVAL = 2;

export class Wallet {
  constructor({ storageKey = 'wanderoad.loot.v1' } = {}) {
    this.storageKey = storageKey;
    this.coins = 0;
    this.gems = 0;
    /** Earned outright by reaching BOAT_UNLOCK_COINS at least once, ever — persisted, so the
     *  boat stays unlocked even if coins were somehow spent (there is no spending yet, but the
     *  flag, not the running total, is the source of truth for "have I earned this"). */
    this.boat = false;

    this._events = []; // drained by main.js, same shape as streak.js's own queue
    this._dirty = false;
    this._sinceSave = 0;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.coins = Math.max(0, +d.coins || 0);
      this.gems = Math.max(0, +d.gems || 0);
      this.boat = !!d.boat;
    } catch {
      // A corrupt or unavailable store is not worth a crash on a cozy driving game — same
      // stance streak.js's own load() takes.
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ coins: this.coins, gems: this.gems, boat: this.boat }));
      this._dirty = false;
      this._sinceSave = 0;
    } catch {
      /* private mode, quota, whatever — the wallet still works this session */
    }
  }

  /** Unlocked by having earned it, by having enough coins right now, or by cheat mode — see
   *  the file header for why only the FIRST of those is an event. */
  get boatUnlocked() {
    return this.boat || this.coins >= BOAT_UNLOCK_COINS || cheatOn();
  }

  /** @param {number} n coins gained this call (0 is a no-op, never a write). */
  addCoins(n) {
    if (!n) return;
    const before = this.coins;
    this.coins += n;
    this._dirty = true;
    if (before < BOAT_UNLOCK_COINS && this.coins >= BOAT_UNLOCK_COINS && !this.boat) {
      this.boat = true;
      this._events.push({ kind: 'boat-unlock' });
      this.save(); // an event this important is not left to the debounce
    }
  }

  /** @param {number} n gems gained this call. */
  addGems(n) {
    if (!n) return;
    this.gems += n;
    this._dirty = true;
  }

  /** Pop the next one-shot event, or null — streak.js's own drain() pattern. */
  drain() {
    if (!this._events.length) return null;
    return this._events.shift();
  }

  /** Debounced write, called once a frame from main.js. A dirty wallet is written at most
   *  once every SAVE_INTERVAL seconds; a clean one costs nothing. */
  update(dt) {
    if (!this._dirty) return;
    this._sinceSave += dt;
    if (this._sinceSave >= SAVE_INTERVAL) this.save();
  }

  /** Called on quit / page hide, same call sites as streak.js's own flush(). */
  flush() {
    if (this._dirty) this.save();
  }
}
