/* Wanderoad — fuel.
 *
 * The brief, and it decides every number below: a petrol station is A REASON TO STOP
 * SOMEWHERE PRETTY, not a fail state. So:
 *
 *   - A tank is about six minutes of cruising. Long enough that you forget about it, short
 *     enough that a station is a place you actually visit rather than scenery you pass.
 *   - Running dry is NOT a game over and not a reset. The engine fades out over a few
 *     seconds, the car rolls to a stop wherever it happens to be, and then someone comes
 *     along and shares a can. You lose a minute and a bit of momentum. That is all.
 *   - There is no price, no currency, no timer and no penalty. Refuelling is: stop near the
 *     pumps, wait a few seconds, drive on.
 *
 * The consumption model is deliberately expressed in SECONDS OF CRUISE rather than litres.
 * "Six minutes a tank" is then a definition rather than the accidental product of three
 * invented constants, and the acceptance test measures the thing the brief actually asked
 * for. The gauge shows a fraction and a minutes-remaining estimate; nowhere does the game
 * claim a fuel economy it has not got a physical engine to back up.
 *
 * WHERE THE LIMIT IS APPLIED, because a number that never reaches the solver is this
 * project's most repeated bug: `gate()` scales the THROTTLE of the input command, and
 * main.js passes its result straight into `car.update()`. Vehicle.update reads
 * `input.throttle` (src/car/vehicle.js, `const tTarget = Math.pow(clamp01(input.throttle),
 * PEDAL.throttleCurve)`), damps it into `this.throttle`, and multiplies engine torque by it.
 * Nothing else in this file touches the car, so if `gate()` is ever dropped from the call
 * chain the fuel system does nothing at all — which is loud, rather than subtle.
 */

import { clamp, clamp01, damp, lerp } from '../core/math.js';
import { STATION_RADIUS } from '../world/props.js';

/** A full tank, in seconds of cruising. This IS the six minutes. */
export const TANK_SECONDS = 360;

/* 200% MORE FUEL TO START, on instruction: "Gas now runs out too quick -- 200% more total fuel
 * to start please". Read as three times the range, not three times a fill you cannot hold, so
 * it multiplies the TANK rather than the level -- a full tank is a full tank, there is just
 * more of it. Every derived number follows automatically because capacity is a getter.
 *
 * 2.2, not 3, because the OTHER half of the change is that you now start FULL rather than at
 * 0.72 of the tank: 360 x 0.72 = 259 s before, 360 x 2.2 x 1.0 = 792 s now, which is exactly
 * three times the fuel you actually set off with. Tripling the multiplier AND filling the tank
 * would have been 4.2x, past what was asked. */
export const START_CAPACITY_MUL = 2.2;

/* The cruise the tank is measured against, taken from the car itself rather than guessed:
 * a `cruise`-preset Vehicle holding 55 km/h on flat tarmac settles at a mean throttle of
 * 0.159 and 15.28 m/s (tools/bench-fuel.mjs re-measures this every run and fails if the car
 * changes underneath it).
 *
 * RE-MEASURED after the fleet was halved -- "Make the cars 1/2 slower". The reference used to
 * be 95 km/h, which is now ABOVE the touring car's 70 km/h top speed, so the bench was holding
 * the throttle pinned and calling it a cruise. A reference speed the car cannot reach measures
 * nothing, and it silently made a tank read 2.9 minutes instead of six. */
export const CRUISE_V = 15.28;
export const CRUISE_THROTTLE = 0.216;

/* Burn rate, normalised so that rate === 1 at exactly that cruise:
 *
 *   rate = IDLE + LOAD*throttle + DRAG*(v/CRUISE_V)^2
 *
 * Idling is 14% of cruise, so you can sit at a viewpoint with the engine running for the
 * better part of an hour — a cozy game must not punish stopping to look at something. Drag
 * is quadratic in speed, which is the one piece of real physics worth keeping: it is what
 * makes a hurried drive cost more than an unhurried one, and that is the exact behaviour
 * this game wants to reward. */
const IDLE = 0.14;
const DRAG = 0.4;
const LOAD = (1 - IDLE - DRAG) / CRUISE_THROTTLE;

/** Seconds to fill an empty tank at a pump. Long enough to look around, short enough to
 *  never be a chore. */
export const REFILL_SECONDS = 5.0;
/** You are refuelling if you are this slow, this close to the pumps. */
const REFUEL_SPEED = 1.6;
/** How near a pump counts as 'at the pump' — generous on purpose, see its use below. */
export const REFUEL_RADIUS = 26;
/** How long the engine takes to die once the tank is empty. Coughing, not a switch. */
const DRY_FADE = 6.0;
/** Once you have actually stopped, how long before someone comes past. */
const RESCUE_WAIT = 4.0;
/* And a hard backstop, so coasting for ever cannot strand you. It is deliberately long:
 * a car that runs dry at 95 km/h takes the better part of a minute to roll to a stop on the
 * flat, and being handed a can while still doing 50 reads as magic. The stop is the normal
 * path; this only exists so a permanent descent cannot become a dead end. */
const RESCUE_LATEST = 75;
/** How much a shared can is worth. Enough to reach a pump, not enough to ignore them. */
const RESCUE_FRACTION = 0.16;
/** Below this the gauge starts asking for attention. */
export const LOW_FRACTION = 0.18;

/* ── proximity fuel sharing: real players, real transfer ─────────────────────────────────
 * Operator: "let them also share gas when close -- so they can team up". Distinct from the
 * passive "someone shares a can" mercy below (an impersonal, always-available rescue): this
 * is an ACTIVE gift between two ACTUAL connected players, keyed to a press (main.js), and it
 * has to be a real transfer — the giver's tank drops by exactly what the receiver's tank
 * gains — never both sides topping up from nothing.
 *
 * There is no server-side concept of fuel at all (server/drive.php's presence row has no
 * such column, and nothing here should ask it to grow one just for this), so the transfer
 * rides on the one generic, already-relayed channel the wire has: the `flags` integer every
 * tick already carries (car.onGround / car.handbrake — src/main.js carPacket()). Bit 2 is
 * free. The receiving side lives in src/net/remotes.js, which already tracks one buffer per
 * peer and is the natural place to notice a flag's RISING edge; this file only defines what
 * the bit and the radius mean, so main.js (the giver) and remotes.js (the receiver) read the
 * same three numbers off one source rather than three independently-typed copies.
 *
 * Giving is capped by the giver's OWN remaining fuel (MIN_GIVER_RESERVE) so generosity can
 * never stand someone up themselves, and the amount is a flat, un-scaled SHARE_FRACTION —
 * see the note above tryGiveFuel() for why this one, unlike the passive mercy below, is
 * deliberately NOT scaled by distance from spawn.
 */
/** Bit 2 of the wire `flags` field: "I am actively sharing fuel with a nearby player right
 *  now." A short broadcast pulse, not a message to a specific peer — the wire has no per-peer
 *  channel for anything but a WebRTC offer/answer/ice (server/drive.php's wr_relay_signal
 *  rejects any other `kind` outright), so this reuses a spare bit already carried on every
 *  tick instead of asking the live backend for a new message type it cannot be given this
 *  round. */
export const SHARE_FLAG = 4;
/** How close two REAL players' reported positions must be, giver and receiver alike, for a
 *  share to be offered or accepted. Wider than STATION_RADIUS (11 m): two independently
 *  interpolated, still-moving cars are harder to line up than a fixed pump. */
export const SHARE_RADIUS = 25;
/** Fraction of a tank one "give fuel" action moves, giver and receiver alike — the same
 *  number on both ends is what makes it a real transfer rather than two independent gifts
 *  from nowhere. Exported so net/remotes.js (decoding the receiving side off the wire) and
 *  main.js (wiring the giving key) read the one number this file owns. */
export const SHARE_FRACTION = 0.2;
/** Giving never drops the giver's OWN fraction below this. */
const MIN_GIVER_RESERVE = 0.12;
/** How long the share flag stays set after a press, in seconds. Presence ticks as slow as
 *  0.25 Hz alone and up to 4 Hz close in; this only has to outlast ONE tick on the slower of
 *  the two connections, so it is generous on purpose. */
const SHARE_PULSE_S = 1.6;

/* ── the passive mercy mechanic gets a bottom ─────────────────────────────────────────────
 * Operator, verbatim, overriding this file's own former "never a game over" note on purpose:
 * "3x max 'someone gives you a gas can' and then game over (restart og position) so its
 * teamwork to find gas stations and get the furthest from home." The mechanic itself (the
 * RESCUE_WAIT / RESCUE_LATEST branch below) is unchanged; what changes is that it now keeps
 * count, for ever, per player — MERCY_MAX uses and then a reset, not a fourth rescue.
 *
 * "3 uses total" persisted PER PLAYER is the same durability contract streak.js's `best`
 * already has (see Streak.save()/load()) — one small localStorage record, read once at
 * construction, written once each time it changes. It does not reset when the reset itself
 * fires: this is a lifetime cap on the free safety net, exactly as asked, and the FIRST
 * consequence a fuel mismanagement can have in this game. The reset moment itself stays
 * gentle in tone regardless — a toast and a graceful teleport, never a fail screen — see the
 * note above the RESCUE_WAIT branch in update(). */
const MERCY_MAX = 3;
const MERCY_KEY = 'wanderoad.fuel.mercy.v1';
/** What you wake up with after being sent home. FULL, on instruction: "respawn them with full
 *  tank not half". Half a tank meant the reset handed you a second fuel emergency on top of the
 *  first, which is a punishment stacked on a punishment. */
const RESET_REFILL = 1.0;

/* THE THREE LIVES REFILL WHEN YOU ARE SENT HOME. Operator: "3 lives after respawn too not 1".
 * The lifetime cap was exactly that -- lifetime -- so the fourth dry stop ever ended the run
 * for good and every one after it too. That is not a game, it is a wall. The count is now a
 * per-RUN allowance: three shares, then home, then three again. It still costs you your
 * position and your streak, which is the consequence; it just does not confiscate the
 * mechanic. */
const MERCY_RESETS_ON_RESPAWN = true;

/* ── "make getting gas much easier at start and slowly harder" ───────────────────────────
 * The OTHER half of the operator's own sentence is world/props.js's job (station spacing
 * scales with distance from spawn — stationDistanceMul() there) and is not duplicated here.
 * What DOES belong here: the passive mercy above should stay "still findable, not too hard"
 * (props.js's own stated goal for its curve) even as stations thin out, so it is scaled by
 * the INVERSE of the exact same curve — mirrored rather than imported, because
 * stationDistanceMul() and its three constants are not exported from props.js (module-
 * private there) and props.js is another agent's file this round, not mine to add an export
 * to. Same breakpoints, same shape, same numbers: `git diff -- src/world/props.js` was read
 * before writing this, and this is deliberately not a second, invented curve. A natural
 * follow-up once both passes land: export stationDistanceMul from props.js and delete this
 * copy.
 *
 * Distance is read off (car.x, car.z) directly — the world origin, not the literal spawn
 * point — for the same reason props.js's own comment gives for doing the same thing:
 * findSpawn() always lands within a few km of the origin by construction, so "far from the
 * origin" and "far from spawn" are the same statement in practice, and this file has no
 * other reason to be handed the spawn point.
 *
 * Only the PASSIVE mercy uses this. The ACTIVE, player-to-player share (SHARE_FRACTION,
 * above) deliberately does not — see the note above tryGiveFuel(). */
const DIST_NEAR_KM = 9;
const DIST_FAR_KM = 70;
const DIST_FAR_MUL = 0.4;
function stationDistanceMul(distM) {
  const km = distM / 1000;
  if (km <= DIST_NEAR_KM) return 1;
  if (km >= DIST_FAR_KM) return DIST_FAR_MUL;
  const t = (km - DIST_NEAR_KM) / (DIST_FAR_KM - DIST_NEAR_KM);
  const s = t * t * (3 - 2 * t);
  return 1 - s * (1 - DIST_FAR_MUL);
}
/** How much further the safety net has to reach at this distance from spawn — the exact
 *  inverse of the rarity curve above. 1.0 near home, up to 1/DIST_FAR_MUL = 2.5x by
 *  DIST_FAR_KM out, so a mercy top-up keeps covering roughly the same number of "stations
 *  you might have missed" at any distance. */
function mercyScarcityMul(distM) {
  return 1 / stationDistanceMul(distM);
}

/* ── capacity upgrades ─────────────────────────────────────────────────────────
 * Operator: "findable gas cans for each one you get, you can increase your fuel capacity."
 * The floating cans already top up the tank on the spot (CAN_FRACTION, above); this is a
 * SEPARATE, permanent reward layered on top of that immediate one, so a can is always worth
 * finding twice over — once now, and a little more forever after.
 *
 * The rule, stated precisely: every CAPACITY_UPGRADE_EVERY-th can collected (the 5th, 10th,
 * 15th...) permanently raises the tank's own maximum by CAPACITY_UPGRADE_STEP (10%) of the
 * BASE tank, capped at CAPACITY_UPGRADE_MAX (+50%) — five upgrades and it stops. Chosen so it
 * is a real milestone (a five-can streak, not every single find) and bounded so it cannot
 * become an unbounded grind: the 26th can and every one after it still refuels normally, just
 * does not grow the tank any further. `capacity` below is a GETTER derived straight from
 * `stats.cansCollected` rather than separate tracked state, so there is exactly one number
 * this rule can ever disagree with itself about. */
export const CAPACITY_UPGRADE_EVERY = 5;
export const CAPACITY_UPGRADE_STEP = 0.10;
const CAPACITY_UPGRADE_MAX = 0.50;
export const CAPACITY_UPGRADE_LEVELS = Math.round(CAPACITY_UPGRADE_MAX / CAPACITY_UPGRADE_STEP);

/* ── burn-rate tuning: the hill gives some back, and rough ground takes more ─────────────
 * Operator, verbatim: "It should cost almost no fuel to coast downhill. It should cost double
 * fuel to off-road." Both read REAL vehicle state — car.vy (the car's own actual vertical
 * speed) and car.onRoad (the four-wheel average the rest of the vehicle's own rolling
 * resistance and speed ceiling already read, src/car/vehicle.js) — never a second, hand-
 * rolled slope or surface estimate.
 */
/** A descent this steep (rise/run) and the speed-and-throttle part of the burn is fully
 *  discounted at zero throttle. ~11% — comfortably inside what this world's own roads produce
 *  (meadow arterials alone run up to 27% at their worst, docs/BACKLOG.md), so an ordinary hill
 *  qualifies, not only the steepest one in the game. */
const DESCENT_FULL = 0.11;
/** Smoothing rate (see core/math.js damp()) for the descent signal, so one kerb-sized bump or
 *  a moment of suspension bounce cannot flicker the discount on and off frame to frame — it
 *  has to be a real, sustained hill, read the same way the coast itself would feel. */
const DESCENT_SMOOTH = 2.5;
/** Off-road multiplier on the WHOLE burn rate — "double fuel", the operator's own words taken
 *  literally. */
const OFF_ROAD_MUL = 2.0;

export class Fuel {
  /**
   * @param {object} opts
   * @param {(x:number,z:number)=>({x:number,z:number,dist:number}|null)} [opts.findStation]
   *        nearest petrol station. render/props.js already has the loaded ones, so this is a
   *        scan of a handful of entries — do NOT wire it to world/props.js nearestStation(),
   *        which rebuilds the road network and costs tens of milliseconds.
   * @param {()=>number} [opts.collectCans] fuel gained (a fraction of a tank, 0 if none) from
   *        floating cans collected since the last call — render/props.js's Props class owns
   *        the live meshes and already gets the car's position every frame (the same
   *        argument findStation makes), so this is pull-based and needs nothing scanned here.
   * @param {(text:string, secs:number)=>void} [opts.say] one quiet HUD line.
   * @param {()=>number} [opts.incomingShares] fuel shared toward us by a nearby REAL player
   *        since the last call, a fraction of a tank, 0 if none — net/remotes.js's
   *        drainIncomingShares(), pull-based exactly like collectCans() above.
   * @param {()=>void} [opts.resetToSpawn] called once the passing-driver mercy is exhausted
   *        (see MERCY_MAX) and a dry stop happens anyway — main.js wires this to the same
   *        car.placeAt()/chase.reset()/trail.reset() sequence backToRoad() uses, but aimed at
   *        the session's ORIGINAL spawn point rather than the nearest road. Optional and
   *        deliberately so: a harness that only cares about the fuel numbers, not the car's
   *        position, can exercise this whole class without wiring a Vehicle at all.
   * @param {number} [opts.start] starting fill, 0..1.
   * @param {string} [opts.mercyKey] localStorage key for the lifetime mercy counter — the
   *        acceptance harness overrides this so it never touches the real player's count.
   */
  constructor({
    findStation = null,
    collectCans = null,
    incomingShares = null,
    say = null,
    resetToSpawn = null,
    /* 200% more fuel to start, on instruction ("Gas now runs out too quick -- 200% more total
     * fuel to start please"). 0.72 of a tank became 3x that, which is more than one tank holds,
     * so the surplus is carried as a bigger STARTING TANK rather than a fill above full: see
     * START_CAPACITY_MUL below. */
    start = 1.0,
    mercyKey = MERCY_KEY,
    carId = 'default',
  } = {}) {
    this.findStation = findStation;
    this.collectCans = collectCans;
    this.incomingShares = incomingShares;
    this.resetToSpawn = resetToSpawn;
    this.say = say || (() => {});
    /* Car identity FIRST: capacity is a getter off this car's own can count, and the starting
     * tank is a fraction OF that capacity, so both must exist before seconds is set. */
    this._carId = carId;
    this._carCans = this._loadCarCans();
    /** Seconds of cruise left in the tank. The single source of truth. */
    this.seconds = this.capacity * clamp01(start); // capacity, not TANK_SECONDS — see START_CAPACITY_MUL
    /** Throttle authority, 0..1. Read by gate(); nothing else may write it. */
    this.power = 1;
    this.refuelling = false;
    this.dry = false;
    this.nearest = null;
    this._dryFor = 0;
    this._stoppedFor = 0;
    this._nextScan = 0;
    this._saidLow = false;
    this._saidDry = false;
    this._visiting = false;
    /** Smoothed 0..1 "how steeply am I descending, relative to my own speed" signal rate()
     *  reads for the downhill discount — see DESCENT_SMOOTH above for why it is damped rather
     *  than read raw every frame. Updated once per update() call, read (never mutated) from
     *  rate(), so calling rate() itself — minutesLeft() does, for a display estimate — stays a
     *  pure function of the car and this already-settled value. */
    this._descent = 0;
    /** True while our own "sharing fuel" broadcast pulse (SHARE_FLAG) should be on the wire —
     *  read by main.js's carPacket() every tick, decayed here in update(). See tryGiveFuel(). */
    this.sharing = false;
    this._shareUntil = 0;
    /** Uses of the passing-driver mercy so far, THIS LIFETIME (see MERCY_MAX/MERCY_KEY's own
     *  comment) — loaded once here, persisted on every change, never reset by _clearDry() or
     *  by the reset-to-spawn event itself. */
    this._mercyKey = mercyKey;
    this.mercyUsed = this._loadMercy();
    /** Totals, for the acceptance harness and for anyone debugging a burn rate. */
    this.stats = {
      burned: 0,
      filled: 0,
      rescues: 0,
      refuels: 0,
      drySeconds: 0,
      cansCollected: 0,
      sharesGiven: 0,
      sharesReceived: 0,
      resets: 0,
      /** Seconds of driving that cost nothing because the car was driving itself — see the
       *  `opts.burn` note on update(). */
      freeSeconds: 0,
    };
  }

  /* ── the lifetime mercy count ─────────────────────────────────────────────────────────
   * Same shape as Streak's own load()/save() (src/game/streak.js): one small JSON record,
   * read once at construction, written every time the number changes. A corrupt or
   * unavailable store degrades to "no mercies used yet" rather than a crash — running out
   * of localStorage is not a reason to break a cozy driving game. */
  _loadMercy() {
    try {
      const raw = localStorage.getItem(this._mercyKey);
      if (!raw) return 0;
      const n = +JSON.parse(raw).used;
      return Number.isFinite(n) ? clamp(n, 0, MERCY_MAX) : 0;
    } catch {
      return 0;
    }
  }

  _saveMercy() {
    try {
      localStorage.setItem(this._mercyKey, JSON.stringify({ used: this.mercyUsed }));
    } catch {
      /* private mode, quota, whatever — mercyUsed still works for the rest of this session */
    }
  }

  /** The tank's own current maximum, in seconds of cruise — TANK_SECONDS plus whatever
   *  capacity upgrades (see the CAPACITY_UPGRADE_* comment above) have been earned so far.
   *  A getter, not tracked state, so this rule has exactly one source of truth:
   *  `stats.cansCollected`. */
  get capacity() {
    return TANK_SECONDS * START_CAPACITY_MUL * (1 + this.capacityLevel * CAPACITY_UPGRADE_STEP);
  }

  /* How many upgrades THIS CAR has earned. Operator: "each car unlock = capacity does not
   * transfer from car to car. Reason to restart capacity". So the cans are counted per car and
   * persisted per car — swapping to a freshly unlocked car really does hand you a small tank
   * again, which is the point: the new car is faster and thirstier and has to earn its range,
   * so unlocking one is a decision rather than a strict upgrade. */
  get capacityLevel() {
    return Math.min(Math.floor(this.carCans / CAPACITY_UPGRADE_EVERY), CAPACITY_UPGRADE_LEVELS);
  }

  /** 0..1 across this car's own upgrade ladder — what the HUD meter draws. */
  get capacityProgress() {
    if (this.capacityLevel >= CAPACITY_UPGRADE_LEVELS) return 1;
    return (this.carCans % CAPACITY_UPGRADE_EVERY) / CAPACITY_UPGRADE_EVERY;
  }

  /** Cans this car has collected, ever. Per car, persisted. */
  get carCans() {
    return this._carCans;
  }

  _capKey() {
    return `wanderoad.fuel.cans.v1.${this._carId || 'default'}`;
  }

  _loadCarCans() {
    try {
      const raw = globalThis.localStorage?.getItem(this._capKey());
      return raw ? Math.max(0, +JSON.parse(raw).cans || 0) : 0;
    } catch {
      return 0;
    }
  }

  _saveCarCans() {
    try {
      globalThis.localStorage?.setItem(this._capKey(), JSON.stringify({ cans: this._carCans }));
    } catch {
      /* private mode — the count still works for this session */
    }
  }

  /** Switch car: capacity starts again, because it belongs to the car and not to the player. */
  setCar(carId) {
    if (carId === this._carId) return;
    this._saveCarCans(); // flush the car being left, before its id is gone
    this._carId = carId;
    this._carCans = this._loadCarCans();
    this.seconds = Math.min(this.seconds, this.capacity);
  }

  get fraction() {
    return clamp01(this.seconds / this.capacity);
  }

  /** Rough minutes left AT THE CURRENT rate — honest when cruising, honest when flat out. */
  minutesLeft(car) {
    const r = car ? Math.max(0.05, this.rate(car)) : 1;
    return this.seconds / r / 60;
  }

  /** Burn rate multiplier, 1.0 at cruise. */
  rate(car) {
    const v = Math.abs(car.speed || 0);
    // The car's OWN damped throttle, not the commanded one. It has already been through
    // gate(), so multiplying by this.power here again would double-count the limit and make
    // a dying engine look thriftier than it is.
    const t = clamp01(car.throttle || 0);
    const vv = v / CRUISE_V;
    const speedCost = LOAD * t + DRAG * vv * vv;

    /* Coasting downhill: `this._descent` (updated in update(), below) is a smoothed reading
     * of the car's OWN vertical speed relative to how fast it is going overall — the real
     * descent the suspension and the camera already show, not a second hand-rolled slope
     * estimate. Discounts only the part of the cost that scales with speed/throttle — IDLE
     * always stays, the engine is still on — and is gated by how far off the pedal is: pin
     * the throttle down the same hill and you are accelerating on purpose, and pay for it
     * like anyone would. At full descent and zero throttle the speed cost is fully waived,
     * which is "almost no fuel" (IDLE alone survives) taken at its word. */
    const coast = clamp01(this._descent / DESCENT_FULL) * (1 - t);

    /* Off-road: DOUBLES the whole rate, IDLE included — a stationary engine on rough ground
     * works a little harder too, and one multiplier at the end is easier to state precisely
     * ("double fuel to off-road") than several partial ones. `car.onRoad` is the SAME
     * four-wheel average the rolling resistance and the speed ceiling already read
     * (src/car/vehicle.js), not a second surface probe. */
    const onRoadMul = lerp(OFF_ROAD_MUL, 1, clamp01(car.onRoad ?? 1));

    return (IDLE + speedCost * (1 - coast)) * onRoadMul;
  }

  /**
   * One tick. Call BEFORE the car is stepped, so `gate()` reflects this frame's tank.
   * @param {number} dt seconds
   * @param {object} car the Vehicle
   * @param {object} [opts]
   * @param {boolean} [opts.burn] false while the car is driving ITSELF (auto-drive). Operator,
   *        verbatim: auto-drive consumes "no fuel". Only the BURN is suppressed — cans are still
   *        collected, shares still arrive, the station scan still runs and a pump still fills
   *        the tank, because none of those is fuel being spent and switching them off would
   *        quietly break the fuel gauge, the pickup chime and the nearest-pump readout for as
   *        long as the chauffeur had the wheel. Time spent this way is counted on
   *        `stats.freeSeconds` so a harness can prove the suppression happened rather than
   *        infer it from a tank that merely did not move much.
   */
  update(dt, car, opts = null) {
    if (!(dt > 0)) return;
    const burn = !opts || opts.burn !== false;
    const speed = Math.abs(car.speed || 0);

    /* Smoothed downhill signal for rate() below — see DESCENT_SMOOTH's own comment for why
     * this lives here (updated once, every real tick) rather than inside rate() itself, which
     * minutesLeft() also calls, purely, for a display estimate. `v` is deliberately the RAW
     * speed, not clamped, so a near-standstill car (about to divide by a tiny number) reads as
     * "not descending" rather than an exploding ratio. */
    {
      const v = Math.abs(car.speed || 0);
      const descentNow = v > 1.5 ? clamp(-(car.vy || 0) / v, 0, 1) : 0;
      this._descent = damp(this._descent, descentNow, DESCENT_SMOOTH, dt);
    }

    /* ── our own "sharing" broadcast pulse decays on its own clock ───────────
     * See tryGiveFuel(): pressing the give key sets this true for SHARE_PULSE_S seconds so a
     * slow-ticking connection still gets at least one snapshot with the bit up; nothing else
     * in this file reads _shareUntil, only main.js's carPacket() reads `sharing`. */
    if (this._shareUntil > 0) {
      this._shareUntil -= dt;
      if (this._shareUntil <= 0) {
        this._shareUntil = 0;
        this.sharing = false;
      }
    }

    /* ── fuel a nearby REAL player just shared toward us ──────────────────────
     * Unconditional and first, same reasoning as the can below: a share is a find, not a
     * state to be "in". net/remotes.js already re-checked proximity at the moment the share
     * arrived (see its ingest()), so nothing here re-derives distance — this file only
     * applies the number. */
    if (this.incomingShares) {
      const got = this.incomingShares();
      if (got > 0) {
        const cap = this.capacity;
        const before = this.seconds;
        this.seconds = Math.min(cap, this.seconds + cap * got);
        this.stats.filled += this.seconds - before;
        this.stats.sharesReceived++;
        this._clearDry();
        this.say('a nearby driver shares some fuel — teamwork', 2.8);
      }
    }

    /* ── a can, if one was just driven past ──────────────────────────────────
     * Unconditional and first: a can is a find, not a state you can be "in", so it has none
     * of the pump's visiting/refuelling machinery — just a top-up and a single quiet line.
     * Capped at the tank's own CURRENT capacity (see the `capacity` getter above), not the
     * fixed TANK_SECONDS, so a can found on an already-fullish, upgraded tank cannot push it
     * over ITS OWN maximum — the same "cannot overfill" promise this always made, generalised
     * to a tank that can now be bigger than it started. */
    if (this.collectCans) {
      const gained = this.collectCans();
      if (gained > 0) {
        const before = this.seconds;
        const capBefore = this.capacity;
        this.stats.cansCollected++;
        this._carCans++;
        this._saveCarCans();
        const capAfter = this.capacity;
        this.seconds = Math.min(capAfter, this.seconds + capAfter * gained);
        this.stats.filled += this.seconds - before;
        this._clearDry();
        // The capacity-upgrade line takes precedence on the frame it happens — a five-can
        // milestone is the bigger news than the ordinary top-up that came with it, and say()
        // only ever shows one line at a time.
        if (capAfter > capBefore + 0.5) {
          /* Against the BASE tank of a fresh car, not against TANK_SECONDS. Once the tank
           * itself was multiplied (START_CAPACITY_MUL) the old sum read "+142%" for a 10%
           * upgrade, which is worse than saying nothing. And spell out the rule while we are
           * here — operator: "explain the streaks = gas capacity thing better". */
          const base = TANK_SECONDS * START_CAPACITY_MUL;
          const pct = Math.round(((capAfter - base) / base) * 100);
          const mins = (capAfter / 60).toFixed(0);
          this.say(`${CAPACITY_UPGRADE_EVERY} cans — this car's tank is now +${pct}% (${mins} min). cans grow THIS car`, 4.6);
        } else {
          this.say('found a can of fuel', 2.6);
        }
      }
    }

    // ── where is the nearest pump ───────────────────────────────────────────
    // Twice a second is plenty for a gauge and cheap even if the provider is not.
    this._nextScan -= dt;
    if (this.findStation && this._nextScan <= 0) {
      this._nextScan = 0.5;
      this.nearest = this.findStation(car.x, car.z);
    }

    /* ── stopped at the pumps ────────────────────────────────────────────────
     * One branch for the whole state, and it does NOT burn: you have stopped, the engine is
     * off, and a cozy game does not charge you for standing still somewhere nice. That is
     * also what makes the state stable — an earlier version let the idle burn nibble the
     * tank the instant it hit full, which put it back below the "needs filling" line on the
     * very next frame and counted 104 separate visits to one petrol station. */
    /* Operator: "Large range for gas station so you can be NEAR to fill". STATION_RADIUS (11 m)
     * is the APRON, so you had to stop almost on the pump island. 26 m lets you pull up
     * anywhere on the forecourt, or on the verge beside it, and still fill. */
    const atPump = !!this.nearest && this.nearest.dist <= REFUEL_RADIUS && speed <= REFUEL_SPEED;
    if (atPump) {
      // Full is relative to the tank's OWN current capacity, same reasoning as the can top-up
      // above: an upgraded tank fills all the way to its own, bigger, maximum.
      const cap = this.capacity;
      this.refuelling = this.seconds < cap - 0.001;
      if (this.refuelling) {
        if (!this._visiting) {
          this._visiting = true;
          this.stats.refuels++;
          this.say('filling up — take your time', 3.0);
        }
        const before = this.seconds;
        this.seconds = Math.min(cap, this.seconds + (cap / REFILL_SECONDS) * dt);
        this.stats.filled += this.seconds - before;
      } else if (this._visiting) {
        this._visiting = false;
        this.say('full tank', 2.4);
      }
      // Fuel in the tank ends the dry sequence immediately: the point of a pump.
      this._clearDry();
      this.power = damp(this.power, 1, 4, dt);
      return;
    }
    this.refuelling = false;
    this._visiting = false;

    // ── burn ────────────────────────────────────────────────────────────────
    // ...unless somebody else is driving. See `opts.burn` on update() above.
    if (this.seconds > 0 && burn) {
      const used = this.rate(car) * dt;
      this.seconds = Math.max(0, this.seconds - used);
      this.stats.burned += used;
    } else if (!burn) {
      this.stats.freeSeconds += dt;
    }

    // ── low, and then empty ─────────────────────────────────────────────────
    if (!this._saidLow && this.fraction <= LOW_FRACTION && this.seconds > 0) {
      this._saidLow = true;
      const n = this.nearest;
      this.say(n ? `running low — pumps ${fmtDist(n.dist)} away` : 'running low on fuel', 4.0);
    }

    if (this.seconds > 0) {
      this._clearDry();
      // Recovering from a rescue: the engine picks back up rather than snapping on.
      this.power = damp(this.power, 1, 4, dt);
      return;
    }

    /* Dry. Everything from here is designed to be survivable and slightly charming, and
     * nothing in it takes control away from the player — you still steer, you still brake,
     * the car just stops pulling. */
    this.dry = true;
    this._dryFor += dt;
    this.stats.drySeconds += dt;
    if (!this._saidDry) {
      this._saidDry = true;
      this.say('out of fuel — coasting', 3.4);
    }
    // Fade rather than cut. A cut at 100 km/h feels like a bug; a fade feels like a car.
    this.power = clamp(1 - this._dryFor / DRY_FADE, 0, 1);

    if (speed < 0.8) this._stoppedFor += dt;
    else this._stoppedFor = 0;

    if (this._stoppedFor >= RESCUE_WAIT || this._dryFor >= RESCUE_LATEST) {
      /* Operator, verbatim, deliberately overriding this file's own former "never a game
       * over" note: "3x max 'someone gives you a gas can' and then game over (restart og
       * position) so its teamwork to find gas stations and get the furthest from home."
       * MERCY_MAX free rescues, for ever, per player (see the const's own comment) — and on
       * the one after that, no fourth can: a graceful teleport home instead, kept gentle in
       * TONE even though the operator explicitly wants it to be a real, felt consequence in
       * substance. Below MERCY_MAX, the fraction handed back scales with mercyScarcityMul()
       * (see its own comment) so a mercy this far from home is still enough to reach the
       * next, sparser station — "still findable, not too hard" applied to the safety net,
       * not only to the stations themselves. */
      if (this.mercyUsed < MERCY_MAX) {
        this.mercyUsed++;
        this._saveMercy();
        const scarcity = mercyScarcityMul(Math.hypot(car.x, car.z));
        this.seconds = Math.min(this.capacity, this.capacity * RESCUE_FRACTION * scarcity);
        this.stats.rescues++;
        this._clearDry();
        this.power = 0.35; // damps back up to 1 over the next second
        /* SPELL THE RULE OUT, every single time. Operator: "You need to explain the 3 gas can
         * respawn thing each time they run out". The old copy was atmosphere — "someone shares a
         * can" — which is lovely and tells a new player nothing about the system they are inside.
         * Every rescue now names the count, what is left, and what happens at zero. */
        const n = this.nearest;
        const left = MERCY_MAX - this.mercyUsed;
        const where = n ? ` — pumps ${fmtDist(n.dist)} away` : '';
        const after =
          left > 0
            ? `${left} can${left === 1 ? '' : 's'} left, then you're towed home`
            : `no cans left — run dry again and you're towed home`;
        this.say(`a passing driver shares a can — ${this.mercyUsed} of ${MERCY_MAX} used. ${after}${where}`, 5.5);
      } else {
        this.stats.resets++;
        this._clearDry();
        this.seconds = this.capacity * RESET_REFILL;
        this.power = 1;
        /* THE THREE CANS COME BACK. Operator: "3 lives after respawn too not 1". The count is a
         * per-RUN allowance, not a per-save one: three cans, then a tow home, then three again.
         * A permanent counter meant every later run was strictly harsher than the first, which
         * is the opposite of a cozy game. */
        if (MERCY_RESETS_ON_RESPAWN) {
          this.mercyUsed = 0;
          this._saveMercy();
        }
        this.say('towed home — full tank, and your 3 gas cans are back', 5.0);
        this.resetToSpawn?.();
      }
    }
  }

  /**
   * Press-to-give: a real transfer to whichever real player is nearest, if one is close
   * enough. Called from main.js on a fresh keypress (edge-triggered there, not held-repeat).
   *
   * Unlike the passive mercy above, this is NOT scaled by distance from spawn. It is a
   * choice between two consenting players, not something the game hands out on a timer —
   * scaling it up far from home would ask a distant giver to sacrifice more of their OWN
   * increasingly precious fuel to be equally generous, which is a cost falling on the
   * player being kind, not on the game being harder, and is not what "make getting gas...
   * slowly harder" was asking for. Kept flat and simple: SHARE_FRACTION, always, if you can
   * spare it.
   *
   * @param {number} nearestRealPeerDist metres to the closest ACTUAL other player — a ghost
   *        that is really someone else's car, never a locally-simulated one. main.js passes
   *        remotes.nearestDistance(); Infinity if nobody is around.
   * @returns {boolean} whether a share was actually sent.
   */
  tryGiveFuel(nearestRealPeerDist) {
    if (!(nearestRealPeerDist <= SHARE_RADIUS)) {
      this.say('no one close enough to share with', 2.2);
      return false;
    }
    if (this.fraction < SHARE_FRACTION + MIN_GIVER_RESERVE) {
      this.say('not enough spare fuel to share', 2.2);
      return false;
    }
    this.seconds -= SHARE_FRACTION * this.capacity;
    this.stats.sharesGiven++;
    this.sharing = true;
    this._shareUntil = SHARE_PULSE_S;
    this.say('sharing fuel — teamwork', 2.6);
    return true;
  }

  _clearDry() {
    this.dry = false;
    this._dryFor = 0;
    this._stoppedFor = 0;
    this._saidDry = false;
    this._saidLow = this.fraction <= LOW_FRACTION;
  }

  /**
   * The one place fuel touches the car: scale the commanded throttle.
   *
   * Returns a NEW object rather than mutating, because the input command is also the
   * autopilot's own record of what it asked for and quietly halving it there would make the
   * autopilot's steering integrator chase a throttle it never commanded.
   */
  gate(cmd) {
    if (!cmd || this.power >= 0.999) return cmd;
    return { ...cmd, throttle: (cmd.throttle || 0) * this.power };
  }

  /** Top the tank up (debug console, and the acceptance harness). Relative to the tank's OWN
   *  current capacity — fill(1) always means "as full as this tank can now get". */
  fill(fraction = 1) {
    this.seconds = this.capacity * clamp01(fraction);
    this._clearDry();
    this.power = 1;
  }
}

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

export { STATION_RADIUS };
