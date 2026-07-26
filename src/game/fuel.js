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

import { clamp, clamp01, damp } from '../core/math.js';
import { STATION_RADIUS } from '../world/props.js';

/** A full tank, in seconds of cruising. This IS the six minutes. */
export const TANK_SECONDS = 360;

/* The cruise the tank is measured against, taken from the car itself rather than guessed:
 * a `cruise`-preset Vehicle holding 95 km/h on flat tarmac settles at a mean throttle of
 * 0.288 and 26.4 m/s (tools/bench-fuel.mjs re-measures this every run and fails if the car
 * changes underneath it). */
export const CRUISE_V = 26.4;
export const CRUISE_THROTTLE = 0.288;

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
const REFILL_SECONDS = 5.0;
/** You are refuelling if you are this slow, this close to the pumps. */
const REFUEL_SPEED = 1.6;
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

export class Fuel {
  /**
   * @param {object} opts
   * @param {(x:number,z:number)=>({x:number,z:number,dist:number}|null)} [opts.findStation]
   *        nearest petrol station. render/props.js already has the loaded ones, so this is a
   *        scan of a handful of entries — do NOT wire it to world/props.js nearestStation(),
   *        which rebuilds the road network and costs tens of milliseconds.
   * @param {(text:string, secs:number)=>void} [opts.say] one quiet HUD line.
   * @param {number} [opts.start] starting fill, 0..1.
   */
  constructor({ findStation = null, say = null, start = 0.72 } = {}) {
    this.findStation = findStation;
    this.say = say || (() => {});
    /** Seconds of cruise left in the tank. The single source of truth. */
    this.seconds = TANK_SECONDS * clamp01(start);
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
    /** Totals, for the acceptance harness and for anyone debugging a burn rate. */
    this.stats = { burned: 0, filled: 0, rescues: 0, refuels: 0, drySeconds: 0 };
  }

  get fraction() {
    return clamp01(this.seconds / TANK_SECONDS);
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
    return IDLE + LOAD * t + DRAG * vv * vv;
  }

  /**
   * One tick. Call BEFORE the car is stepped, so `gate()` reflects this frame's tank.
   * @param {number} dt seconds
   * @param {object} car the Vehicle
   */
  update(dt, car) {
    if (!(dt > 0)) return;
    const speed = Math.abs(car.speed || 0);

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
    const atPump = !!this.nearest && this.nearest.dist <= STATION_RADIUS && speed <= REFUEL_SPEED;
    if (atPump) {
      this.refuelling = this.seconds < TANK_SECONDS - 0.001;
      if (this.refuelling) {
        if (!this._visiting) {
          this._visiting = true;
          this.stats.refuels++;
          this.say('filling up — take your time', 3.0);
        }
        const before = this.seconds;
        this.seconds = Math.min(TANK_SECONDS, this.seconds + (TANK_SECONDS / REFILL_SECONDS) * dt);
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
    if (this.seconds > 0) {
      const used = this.rate(car) * dt;
      this.seconds = Math.max(0, this.seconds - used);
      this.stats.burned += used;
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
      this.seconds = TANK_SECONDS * RESCUE_FRACTION;
      this.stats.rescues++;
      this._clearDry();
      this.power = 0.35; // damps back up to 1 over the next second
      const n = this.nearest;
      this.say(n ? `someone shares a can — pumps ${fmtDist(n.dist)} away` : 'someone shares a can', 4.2);
    }
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

  /** Top the tank up (debug console, and the acceptance harness). */
  fill(fraction = 1) {
    this.seconds = TANK_SECONDS * clamp01(fraction);
    this._clearDry();
    this.power = 1;
  }
}

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

export { STATION_RADIUS };
