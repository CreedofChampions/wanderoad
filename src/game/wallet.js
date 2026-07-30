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

/* ── COINS ARE THE WHOLE ECONOMY ─────────────────────────────────────────────
 * Operator: "make the whole new reward system run via coins. Streaks = coins. Gas bonus = buy
 * it for coins. New cars = coins."
 *
 * So driving well is the only income and everything is bought with the same money. Three
 * consequences, all of them in this file because this is where the money lives:
 *
 *   1. A streak MINTS coins as it runs — see mintStreak(). Coins picked up off the verge stay,
 *      but they are pocket change next to a long run, which is the right way round: the reward
 *      should come from the thing the game is about.
 *   2. Coins can be SPENT. That breaks the old `boatUnlocked` shortcut, which read "do you hold
 *      50 coins right now" — spending would have un-earned the boat. The latched `boat` flag was
 *      always the real source of truth (see its own comment); now it is the only one.
 *   3. Owning a car is a thing you buy, not a distance you pass. `owned` is persisted here
 *      rather than in garage.js because it is a purchase, and purchases live with the money.
 */

/** Metres of unbroken streak per coin minted. 250 m at 60 km/h is a coin every 15 seconds — a
 *  drip you notice, and about 4 coins a kilometre against the roughly 1 a kilometre the verge
 *  pickups give, so a good run out-earns scavenging without making the pickups pointless. */
export const STREAK_METRES_PER_COIN = 250;

/** Coins for one spare fuel can at a pump, and the most you may carry. */
export const CAN_PRICE = 8;
export const CAN_MAX = 3;

export class Wallet {
  constructor({ storageKey = 'wanderoad.loot.v1' } = {}) {
    this.storageKey = storageKey;
    this.coins = 0;
    this.gems = 0;
    /** Earned outright by reaching BOAT_UNLOCK_COINS at least once, ever — persisted, so the
     *  boat stays unlocked even if coins were somehow spent (there is no spending yet, but the
     *  flag, not the running total, is the source of truth for "have I earned this"). */
    this.boat = false;
    /** Car ids bought outright, ever. A Set in memory, an array on disk. The starting car is
     *  not in here — see `owns()`, which always says yes to it: a game that opens with no car
     *  is not a game. */
    this.owned = new Set();
    /** Fuel-capacity upgrades bought, PER CAR: { [carId]: levels }. Per car because capacity
     *  belongs to the car (see game/fuel.js's own note) and so does the money spent on it. */
    this.tanks = {};
    /** Streak metres already paid out, so a run that is re-read every frame mints once. */
    this._paidM = 0;
    /** Spare fuel cans in the boot, bought at a pump — see buyCan. */
    this._cans = 0;
    /** The plane, earned with sea diamonds or the pass — see planeUnlocked. */
    this.plane = false;
    /** Have we already said "you can afford a boat"? Once is a nudge, twice is nagging. */
    this._toldAffordBoat = false;

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
      if (Array.isArray(d.owned)) this.owned = new Set(d.owned);
      if (d.tanks && typeof d.tanks === 'object') this.tanks = { ...d.tanks };
      this._cans = Math.max(0, Math.min(CAN_MAX, +d.cans || 0));
      this.plane = !!d.plane;
    } catch {
      // A corrupt or unavailable store is not worth a crash on a cozy driving game — same
      // stance streak.js's own load() takes.
    }
  }

  save() {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          coins: this.coins,
          gems: this.gems,
          boat: this.boat,
          owned: [...this.owned],
          tanks: this.tanks,
          cans: this._cans,
          plane: this.plane,
        })
      );
      this._dirty = false;
      this._sinceSave = 0;
    } catch {
      /* private mode, quota, whatever — the wallet still works this session */
    }
  }

  /** Unlocked by having earned it, by having enough coins right now, or by cheat mode — see
   *  the file header for why only the FIRST of those is an event. */
  get boatUnlocked() {
    /* `coins >= BOAT_UNLOCK_COINS` used to be part of this and is deliberately gone: now that
     * coins can be spent, holding fewer than 50 would have taken the boat back off you. The
     * latch below is set the moment you first reach 50 (see addCoins), which is the event that
     * actually earns it. */
    return this.boat || cheatOn();
  }

  /** Does the player own this car? The first car in the fleet is always owned — see `owned`. */
  owns(carId, freeId = 'estate') {
    return carId === freeId || this.owned.has(carId) || cheatOn();
  }

  /**
   * Spend, if there is enough. Returns true only when the money actually moved, so a caller
   * can use it as the gate itself rather than checking the balance and then spending — two
   * steps that can disagree if anything happens between them.
   * @param {number} n coins
   */
  spend(n) {
    if (!(n > 0) || this.coins < n) return false;
    this.coins -= n;
    this._dirty = true;
    this.save(); // a purchase is not left to the debounce; losing one is worse than a write
    return true;
  }

  /** Buy a car. Idempotent: buying one you already own costs nothing and returns false. */
  buyCar(carId, price) {
    if (this.owns(carId)) return false;
    if (!this.spend(price)) return false;
    this.owned.add(carId);
    this._events.push({ kind: 'car-bought', carId, price });
    this.save();
    return true;
  }

  /** Fuel-capacity upgrades bought for one car. */
  tankLevel(carId) {
    return Math.max(0, +this.tanks[carId] || 0);
  }

  /** Buy one more capacity upgrade for a car. */
  buyTank(carId, price) {
    if (!this.spend(price)) return false;
    this.tanks[carId] = this.tankLevel(carId) + 1;
    this._events.push({ kind: 'tank-bought', carId, level: this.tanks[carId], price });
    this.save();
    return true;
  }

  /**
   * Pay out a running streak. Called every frame with the streak's CURRENT distance in metres;
   * mints one coin per STREAK_METRES_PER_COIN of new ground and remembers what it has already
   * paid for, so this is safe to call at 120 Hz. A streak that BREAKS resets to zero, which is
   * less than `_paidM`, so the counter follows it down and the next run starts paying again
   * from its own first metre — you are never paid twice for the same tarmac, and never charged
   * for a run you lost.
   * @param {number} distanceM the streak's current distance
   * @returns {number} coins minted this call
   */
  mintStreak(distanceM) {
    const m = Math.max(0, distanceM || 0);
    if (m < this._paidM) this._paidM = m; // the streak broke, or a new run began
    const owed = Math.floor((m - this._paidM) / STREAK_METRES_PER_COIN);
    if (owed <= 0) return 0;
    this._paidM += owed * STREAK_METRES_PER_COIN;
    this.addCoins(owed);
    return owed;
  }

  /** @param {number} n coins gained this call (0 is a no-op, never a write). */
  addCoins(n) {
    if (!n) return;
    this.coins += n;
    this._dirty = true;
    /* THE BOAT IS NO LONGER GIVEN AWAY HERE. Operator: "making buying a boat and unlock that. It
     * isn't automatic, but something you get at the harbor."
     *
     * Reaching BOAT_UNLOCK_COINS used to latch `boat` and fire a toast right here, which made it
     * the one unlock in the game that happened TO you rather than because you went somewhere. It is
     * bought at a harbour now — see buyBoat — and the only thing crossing the price does is tell
     * you that you can afford it, once. */
    if (!this.boat && this.coins >= BOAT_UNLOCK_COINS && !this._toldAffordBoat) {
      this._toldAffordBoat = true;
      this._events.push({ kind: 'boat-affordable' });
    }
  }

  /* ── THE PLANE ────────────────────────────────────────────────────────────────
   * Operator: "make planes unlockable via diamonds in sea ... let me unlock via pass 123".
   *
   * Gems, not coins, and that is the point of it: coins come from the road and gems only exist out on
   * open water, so the plane is the one thing you cannot buy by driving well. You have to have gone
   * to sea for it, which is what makes the boat worth owning. The pass is the operator's own back
   * door and it latches the same flag, so a passed unlock behaves identically to an earned one. */
  get planeUnlocked() {
    return this.plane || cheatOn();
  }

  /** Earn the plane with gems. Returns false if there are not enough. */
  buyPlane(gemsNeeded) {
    if (this.plane) return false;
    if (this.gems < gemsNeeded) return false;
    this.gems -= gemsNeeded;
    this.plane = true;
    this._events.push({ kind: 'plane-unlock' });
    this.save();
    return true;
  }

  /** The pass. Latches the same flag — see the note above. */
  unlockPlaneWithPass(typed, pass) {
    if (this.plane) return false;
    if (String(typed).trim() !== String(pass)) return false;
    this.plane = true;
    this._events.push({ kind: 'plane-unlock', viaPass: true });
    this.save();
    return true;
  }

  /** Buy the boat. Only ever called when the car is actually at a harbour — main.js gates it. */
  buyBoat() {
    if (this.boat) return false;
    if (!this.spend(BOAT_UNLOCK_COINS)) return false;
    this.boat = true;
    this._events.push({ kind: 'boat-unlock' });
    this.save();
    return true;
  }

  /* ── GAS CANS, BOUGHT AT A PUMP ──────────────────────────────────────────────
   * Operator: "Make it so you can buy gas cans in the petrol stations."
   *
   * A can in the boot is a tank you carry: it refills you once, wherever you are, which is the one
   * thing coins could not buy before and the thing you actually want when a station is 3 km away and
   * the needle is on the pin. Held as a count rather than as fuel so it survives a car swap and a
   * reload — you bought a can, you still have a can. */
  get cans() {
    return this._cans;
  }

  /** Buy one spare can. */
  buyCan(price) {
    if (this._cans >= CAN_MAX) return false;
    if (!this.spend(price)) return false;
    this._cans++;
    this._events.push({ kind: 'can-bought', cans: this._cans, price });
    this.save();
    return true;
  }

  /** Use one. Returns true if there was one to use. */
  useCan() {
    if (this._cans <= 0) return false;
    this._cans--;
    this._dirty = true;
    this.save();
    return true;
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
