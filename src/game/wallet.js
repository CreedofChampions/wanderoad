/* Wanderoad — the wallet: suns, gems, and the boat unlock.
 *
 * Pure and testable, no DOM, no three.js — the same "feed it plain numbers" discipline
 * src/game/streak.js documents for itself. localStorage is the one side effect, and it is
 * debounced and flushed exactly the way streak.js's own `save()`/`flush()` split works: a
 * sun collected every second of driving must not mean a write every second, but a long
 * session must not lose one either.
 *
 * The boat is the one piece of state here that is not just a running total. Collecting your
 * five-hundredth sun is an EVENT — "the boat is yours" — not a threshold main.js has to poll
 * for, so crossing BOAT_UNLOCK_SUNS queues a one-shot message the same way
 * src/game/streak.js's own milestone ladder does (drain(), popped once by the frame loop).
 * `?cheat` (src/game/garage.js's cheatOn()) also unlocks the boat, per docs/BOAT-PLAN.md's own
 * hard rules — but that is a standing STATE check on `boatUnlocked`, not an event: turning
 * cheat mode on mid-drive should not fire the same toast a real 500-sun drive earns.
 */

import { cheatOn, FIRST_CAR } from './garage.js';

/** Suns needed to earn the boat outright. */
/* 50, not 500. Suns are now ~1 per kilometre (see world/loot.js), so 500 was a 500 km
 * errand — the operator's own number for the boat is 50. */
export const BOAT_UNLOCK_SUNS = 50;

/** How rarely a dirty wallet is actually written to localStorage, seconds — see update(). */
const SAVE_INTERVAL = 2;

/* ── SUNS ARE THE WHOLE ECONOMY ─────────────────────────────────────────────
 * Operator: "make the whole new reward system run via suns. Streaks = suns. Gas bonus = buy
 * it for suns. New cars = suns."
 *
 * So driving well is the only income and everything is bought with the same money. Three
 * consequences, all of them in this file because this is where the money lives:
 *
 *   1. A streak MINTS suns as it runs — see mintStreak(). Suns picked up off the verge stay,
 *      but they are pocket change next to a long run, which is the right way round: the reward
 *      should come from the thing the game is about.
 *   2. Suns can be SPENT. That breaks the old `boatUnlocked` shortcut, which read "do you hold
 *      50 suns right now" — spending would have un-earned the boat. The latched `boat` flag was
 *      always the real source of truth (see its own comment); now it is the only one.
 *   3. Owning a car is a thing you buy, not a distance you pass. `owned` is persisted here
 *      rather than in garage.js because it is a purchase, and purchases live with the money.
 */

/* ── ONE BAR, ONE MILESTONE, ONE SUN ─────────────────────────────────────────
 *
 * Operator, after playing on a phone: "The bar filled up almost instantly on mobile. I came to
 * understand that the bar at the bottom has no relationship established with the unlocks whatsoever.
 * So I had an idea. What if your first kilometer was the first bar from left to right of the screen?
 * Your next milestone would be the next bar. And each time you filled it up, it would give you one
 * sun that would appear on you, and jump onto you, so that it would be very visually understandable.
 * And then you would keep collecting suns every time you filled up the bar, so people would
 * understand that they need to fill up the bar. And the more they do it, the more suns they get."
 *
 * That is a better design than what was there and it replaces it outright. What was there paid a sun
 * every fixed 250 m and drew a repeating band of four ticks, so the bar was always somewhere in the
 * middle of filling and nothing about it said what filling it was FOR — on a phone, where the bar is
 * a couple of hundred pixels wide, it read as filling instantly and meaninglessly.
 *
 * Now: the bar IS the current milestone, left edge to right edge, and finishing it pays. The first
 * one is a kilometre; each one after that is longer, so the bar keeps its meaning as a run gets
 * serious instead of flickering past. The payout grows with the ladder, which is the "the more they
 * do it, the more suns they get" half — a fifth milestone is worth three suns, not one.
 *
 * PER RUN, and that is the point of it rather than an accident: leaving the road puts you back on the
 * first bar. A twelve-kilometre run is worth far more than twelve one-kilometre runs, which is what
 * makes staying on the road the thing the game is about.
 */
export const MILESTONES_M = [1000, 1500, 2000, 3000, 4000, 6000, 8000, 10000];
/** Metres added per milestone once the table above runs out — the ladder never ends. */
export const MILESTONE_STEP_M = 5000;

/** How long milestone `i` (0-based) is, in metres. */
export function milestoneLength(i) {
  if (i < MILESTONES_M.length) return MILESTONES_M[i];
  return MILESTONES_M[MILESTONES_M.length - 1] + (i - MILESTONES_M.length + 1) * MILESTONE_STEP_M;
}

/* Suns for finishing milestone `i` (0-based).
 *
 * Proportional to the bar's LENGTH, times a bonus that grows with how deep into the run you are. The
 * first shape tried was a flat 1, 1, 2, 2, 3, 3 ... and it was measurably backwards: thirty separate
 * 1 km runs paid 30 suns while one unbroken 30 km run paid 16, because the bars get longer while the
 * reward barely moved. That is the opposite of "the more they do it, the more suns they get", and it
 * would have taught players to break their streak on purpose.
 *
 * With the length term AND the escalation, a long run is worth more per kilometre as well as in
 * total — measured below in tools/bench-economy.mjs, which asserts exactly that comparison so the
 * curve can never quietly invert again. */
export function milestoneReward(i) {
  const km = milestoneLength(i) / 1000;
  return Math.max(1, Math.round(km * (1 + i * 0.15)));
}

/** Total metres to have finished milestones 0..i-1. */
export function milestoneStart(i) {
  let m = 0;
  for (let k = 0; k < i; k++) m += milestoneLength(k);
  return m;
}

/** Suns for one spare fuel can at a pump, and the most you may carry. */
/* ── WHAT A TOWN COSTS, AND HOW FAR IT GOES ─────────────────────────────────
 * Two tiers above the town every station already has, priced against the rest of the shop rather
 * than picked: a fuel can is 8 suns and the boat is 50, so 120 is a real saving-up and 400 is the
 * kind of number he set for the boat himself ("make it cost lets say 400 suns"). Tier 1 turns a
 * cluster of props into something with a street; tier 2 makes it visible from much further out,
 * which is the point of upgrading a place you keep driving back to. */
export const TOWN_PRICES = [120, 400];
export const TOWN_MAX_TIER = TOWN_PRICES.length;

export const CAN_PRICE = 8;
export const CAN_MAX = 3;

export class Wallet {
  constructor({ storageKey = 'wanderoad.loot.v1' } = {}) {
    this.storageKey = storageKey;
    this.suns = 0;
    this.gems = 0;
    /** Earned outright by reaching BOAT_UNLOCK_SUNS at least once, ever — persisted, so the
     *  boat stays unlocked even if suns were somehow spent (there is no spending yet, but the
     *  flag, not the running total, is the source of truth for "have I earned this"). */
    this.boat = false;
    /** Car ids bought outright, ever. A Set in memory, an array on disk. The starting car is
     *  not in here — see `owns()`, which always says yes to it: a game that opens with no car
     *  is not a game. */
    /* EVERY SUN YOU HAVE EVER COLLECTED, which is a different number from the one in your pocket.
     *
     * Operator: "Maybe we can have the first three cars be total collected, and then the rest will be
     * find a dealership." That needs a counter that SPENDING DOES NOT MOVE — otherwise buying a tank
     * would take a car back off you, which is the kind of thing that makes a shop feel like a trap.
     * So `suns` is the balance and `sunsEarned` is the odometer: it only ever goes up. */
    this.sunsEarned = 0;
    this.owned = new Set();
    /** Fuel-capacity upgrades bought, PER CAR: { [carId]: levels }. Per car because capacity
     *  belongs to the car (see game/fuel.js's own note) and so does the money spent on it. */
    this.tanks = {};
    /** TOWNS UPGRADED, PER STATION: { [stationKey]: tier }. Keyed by the station's own world key
     *  (`st:<edgeKey>` — see world/props.js), which is a pure function of the seed and the lattice,
     *  so the same town is the same town on every load and in every player's copy of the world.
     *  Same shape and same reasoning as `tanks` above: a thing you bought, attached to the thing
     *  you bought it for, rather than a global counter that would make every town upgrade at once. */
    this.towns = {};
    /** Metres of the CURRENT run, and which milestone bar it is on — see mintStreak. Per run, not
     *  persisted: leaving the road puts you back on the first bar, which is the whole design. */
    this._runM = 0;
    this._milestone = 0;
    /** The most recent milestone fill, for the HUD to fly a sun for. Popped by takeFill(). */
    this._lastFill = null;
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
      /* `?? d.coins` MIGRATES AN OLD SAVE. The currency was called coins until the operator looked
       * at the disc on screen and said "coin looks like the sun not coin -- i like that lets make it
       * collecting suns". Anyone who has already played beta has a balance stored under the old key,
       * and a rename that quietly zeroed it would be the worst possible way to ship a nicer name.
       * Written back under `suns` on the next save, so this only has to be read once per player. */
      this.suns = Math.max(0, +(d.suns ?? d.coins) || 0);
      /* MIGRATION, and it has to be generous. `sunsEarned` did not exist before the first-three-cars
       * unlock, so an existing player has no record of what they have collected. Falling back to the
       * BALANCE is the only honest floor available — they certainly earned at least what they are
       * holding — and it errs towards giving a returning player their cars rather than taking
       * progress away, which is the right way to be wrong. */
      this.sunsEarned = Math.max(this.suns, +d.sunsEarned || 0);
      this.gems = Math.max(0, +d.gems || 0);
      this.boat = !!d.boat;
      if (Array.isArray(d.owned)) this.owned = new Set(d.owned);
      if (d.tanks && typeof d.tanks === 'object') this.tanks = { ...d.tanks };
      if (d.towns && typeof d.towns === 'object') this.towns = { ...d.towns };
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
          suns: this.suns,
          sunsEarned: this.sunsEarned,
          gems: this.gems,
          boat: this.boat,
          owned: [...this.owned],
          tanks: this.tanks,
          towns: this.towns,
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

  /** Unlocked by having earned it, by having enough suns right now, or by cheat mode — see
   *  the file header for why only the FIRST of those is an event. */
  get boatUnlocked() {
    /* `suns >= BOAT_UNLOCK_SUNS` used to be part of this and is deliberately gone: now that
     * suns can be spent, holding fewer than 50 would have taken the boat back off you. The
     * latch below is set the moment you first reach 50 (see addSuns), which is the event that
     * actually earns it. */
    return this.boat || cheatOn();
  }

  /**
   * Does the player own this car?
   *
   * Three ways in, and they are deliberately different in kind:
   *   1. the first car in the fleet, always, from the first frame;
   *   2. TOTAL SUNS COLLECTED reaching the car's `earnAt` — the first three cars, which arrive just
   *      by playing and are what teach a new player that suns are worth picking up;
   *   3. having paid for it at a dealership, which is every car after those.
   *
   * Operator: "Maybe we can have the first three cars be total collected, and then the rest will be
   * find a dealership."
   *
   * Route 2 is a LIVE COMPARISON against `sunsEarned` rather than something latched into `owned` at
   * the moment it is crossed. A latch has to fire on exactly the right frame and be persisted
   * correctly or the car is silently lost; a comparison cannot miss, cannot double-fire, and is
   * automatically right for a save written before this rule existed.
   *
   * @param {string} carId
   * @param {string} freeId the fleet's first car
   * @param {number} [earnAt] lifetime suns this car unlocks at, if it is one of the earned ones
   */
  /* THE DEFAULT COMES FROM THE FLEET, NOT FROM A STRING. It was `'estate'`, and the moment the
   * operator asked for the Ford to be the starter car ("Starter car cant go up many hills -- replace
   * with ford") that literal made the Estate free forever AND made it unbuyable — `buyCar` calls
   * `owns()` with the default, saw true, and refused to take the money. Caught by bench-economy's
   * "paying for Estate works" going red. `FIRST_CAR` is `FLEET[0].id`, so the free car is whichever
   * car the fleet starts with, and reordering the fleet can never desynchronise the two again. */
  owns(carId, freeId = FIRST_CAR, earnAt = Infinity) {
    if (carId === freeId || this.owned.has(carId) || cheatOn()) return true;
    return Number.isFinite(earnAt) && this.sunsEarned >= earnAt;
  }

  /**
   * Spend, if there is enough. Returns true only when the money actually moved, so a caller
   * can use it as the gate itself rather than checking the balance and then spending — two
   * steps that can disagree if anything happens between them.
   * @param {number} n suns
   */
  spend(n) {
    if (!(n > 0) || this.suns < n) return false;
    this.suns -= n;
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

  /* ── TOWNS ───────────────────────────────────────────────────────────────
   * Operator: "Towns can be upgraded". A town is the cluster of buildings around a station; the
   * tier decides how much of it exists. Priced in suns like everything else, because suns are the
   * one currency in this game and a second one would be a second thing to explain. */

  /** What tier the town at this station is. 0 is the town every station starts with. */
  townLevel(stationKey) {
    return Math.max(0, Math.min(TOWN_MAX_TIER, +this.towns[stationKey] || 0));
  }

  /** Price of the NEXT tier for this town, or null when it is already fully built. */
  townPrice(stationKey) {
    const t = this.townLevel(stationKey);
    return t >= TOWN_MAX_TIER ? null : TOWN_PRICES[t];
  }

  /** Buy the next tier for one town. Returns the tier it is now, or 0 if nothing was bought. */
  buyTown(stationKey) {
    const price = this.townPrice(stationKey);
    if (price === null || !stationKey) return 0;
    if (!this.spend(price)) return 0;
    this.towns[stationKey] = this.townLevel(stationKey) + 1;
    this._events.push({ kind: 'town-bought', stationKey, level: this.towns[stationKey], price });
    this.save();
    return this.towns[stationKey];
  }

  /**
   * Pay out a running streak. Called every frame with the streak's CURRENT distance in metres;
   * mints one sun per STREAK_METRES_PER_SUN of new ground and remembers what it has already
   * paid for, so this is safe to call at 120 Hz. A streak that BREAKS resets to zero, which is
   * less than `_paidM`, so the counter follows it down and the next run starts paying again
   * from its own first metre — you are never paid twice for the same tarmac, and never charged
   * for a run you lost.
   * @param {number} distanceM the streak's current distance
   * @returns {number} suns minted this call
   */
  mintStreak(distanceM) {
    const m = Math.max(0, distanceM || 0);
    /* A BROKEN RUN GOES BACK TO THE FIRST BAR. `distance` drops to 0 when the streak breaks, so a
     * fall is the signal — no separate event to keep in step, and nothing to get out of step with.
     * You are never paid twice for the same tarmac and never charged for a run you lost. */
    if (m < this._runM) {
      this._runM = 0;
      this._milestone = 0;
    }
    this._runM = m;

    let minted = 0;
    let filled = 0;
    // A single frame can cross more than one boundary at high speed, so this is a loop, not an if.
    for (let guard = 0; guard < 64; guard++) {
      const need = milestoneStart(this._milestone) + milestoneLength(this._milestone);
      if (m < need) break;
      const paid = milestoneReward(this._milestone);
      minted += paid;
      filled++;
      this._lastFill = { index: this._milestone, suns: paid, atM: need };
      this._milestone++;
    }
    if (minted > 0) this.addSuns(minted);
    return minted;
  }

  /** 0..1 across the CURRENT milestone — what the bar draws. */
  milestoneProgress(distanceM) {
    const m = Math.max(0, distanceM || 0);
    const from = milestoneStart(this._milestone);
    const len = milestoneLength(this._milestone);
    return Math.max(0, Math.min(1, (m - from) / len));
  }

  /** Metres still to go on the current milestone. */
  milestoneToGo(distanceM) {
    const m = Math.max(0, distanceM || 0);
    const need = milestoneStart(this._milestone) + milestoneLength(this._milestone);
    return Math.max(0, need - m);
  }

  /** Which bar you are on (0-based), how long it is, and what finishing it pays. */
  get milestone() {
    return {
      index: this._milestone,
      length: milestoneLength(this._milestone),
      reward: milestoneReward(this._milestone),
    };
  }

  /** Pop the most recent milestone fill, or null. What the HUD flies a sun for. */
  takeFill() {
    const f = this._lastFill;
    this._lastFill = null;
    return f;
  }


  /** @param {number} n suns gained this call (0 is a no-op, never a write). */
  addSuns(n) {
    if (!n) return;
    this.suns += n;
    // The odometer, not the balance — see `sunsEarned`. Only gains count; spending never moves it.
    if (n > 0) this.sunsEarned += n;
    this._dirty = true;
    /* THE BOAT IS NO LONGER GIVEN AWAY HERE. Operator: "making buying a boat and unlock that. It
     * isn't automatic, but something you get at the harbor."
     *
     * Reaching BOAT_UNLOCK_SUNS used to latch `boat` and fire a toast right here, which made it
     * the one unlock in the game that happened TO you rather than because you went somewhere. It is
     * bought at a harbour now — see buyBoat — and the only thing crossing the price does is tell
     * you that you can afford it, once. */
    if (!this.boat && this.suns >= BOAT_UNLOCK_SUNS && !this._toldAffordBoat) {
      this._toldAffordBoat = true;
      this._events.push({ kind: 'boat-affordable' });
    }
  }

  /* ── THE PLANE ────────────────────────────────────────────────────────────────
   * Operator: "make planes unlockable via diamonds in sea ... let me unlock via pass 123".
   *
   * Gems, not suns, and that is the point of it: suns come from the road and gems only exist out on
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
    if (!this.spend(BOAT_UNLOCK_SUNS)) return false;
    this.boat = true;
    this._events.push({ kind: 'boat-unlock' });
    this.save();
    return true;
  }

  /* ── GAS CANS, BOUGHT AT A PUMP ──────────────────────────────────────────────
   * Operator: "Make it so you can buy gas cans in the petrol stations."
   *
   * A can in the boot is a tank you carry: it refills you once, wherever you are, which is the one
   * thing suns could not buy before and the thing you actually want when a station is 3 km away and
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
