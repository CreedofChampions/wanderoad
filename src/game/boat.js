/* Wanderoad — boat mode: the last unlock, and the water barrier before it.
 *
 * docs/BOAT-PLAN.md, workstream C. Two jobs, one small state machine, in this order because
 * the second only exists to protect the first:
 *
 *   1. WHILE THE BOAT IS LOCKED, deep off-road water must never be reachable at all — no
 *      wallow, no rescue-teleport at the shoreline (rescue.js used to own that; see its own
 *      "Rescue integration" note). Instead the car is cushioned to a soft stop just short of
 *      the water and told why, every time, gently.
 *   2. ONCE UNLOCKED, driving into deep water swaps the car's own physics for a small arcade
 *      boat — cozy, slow, easy to steer — until the driver comes back to a beach.
 *
 * NOT A SECOND PHYSICS ENGINE. There is no tyre model, no suspension, no collision here: one
 * scalar speed, one yaw, one position update, and the numbers this file owns are tuned by eye
 * against the anchored ships' own bob (render/ships.js) rather than derived from anything
 * this class simulates. car/vehicle.js's own solver is either running (car mode) or it is
 * not (boat mode) — the two are never blended, and this class is the only thing that decides
 * which.
 *
 * WHY `car.vx/vz/speed/yaw` ARE WRITTEN BACK EVERY ACTIVE FRAME rather than this class owning
 * its own pose: the camera (car/camera.js), the net packets (main.js's carPacket()), the HUD
 * speedometer and the streak trail all already read those four fields off the SAME Vehicle
 * object, and none of them needs to know a boat exists. Writing back is cheaper than teaching
 * four other files a second place to look.
 *
 * `terrain` is a zero-arg callback (`() => car.terrain`) rather than a captured reference,
 * for the same reason main.js's own `recover`/`say`/`ping` forward-references are: main.js
 * reassigns `car.terrain` every frame (`car.terrain = localFor(car.x, car.z)`, a local sampler
 * that follows the player around), so a reference captured once at construction would go
 * stale the first time the player crossed that sampler's own box.
 */

import { clamp, clamp01, damp, TAU } from '../core/math.js';
import { waterLevelAt } from '../world/biomes.js';
import { waterDepth } from './rescue.js';

/* ── the arcade boat ──────────────────────────────────────────────────────────
 * "Tune: max ~34 kph, accel to max in ~4 s, turn radius ~14 m at speed, roll into turns
 * ±0.06 rad, bob amp 0.14/0.11 Hz (the anchored-ship numbers)." — docs/BOAT-PLAN.md, verbatim.
 * ACCEL/TURN_RATE are DERIVED from the stated top speed/turn radius rather than picked
 * separately, so there is exactly one place ("max ~34 kph", "~14 m") that can ever disagree
 * with itself. */
export const BOAT_MAX_KPH = 34;
/** Top speed, m/s. `speed += (throttle*ACCEL - speed*DRAG)*dt` settles at ACCEL/DRAG for a
 *  pinned throttle, so this is that settle point, not a separately-clamped ceiling. */
export const BOAT_MAX_SPEED = BOAT_MAX_KPH / 3.6;
/** 1/s. At this rate a pinned throttle reaches 1 - e^(-DRAG*4) = 96% of BOAT_MAX_SPEED in the
 *  4 s the brief asks for. */
export const BOAT_DRAG = 0.8;
/** m/s² — the ONE free tuning number (the brief gives a settle speed and a settle time, which
 *  together fix DRAG; ACCEL is whatever reaches that settle point AT full throttle). */
export const BOAT_ACCEL = BOAT_MAX_SPEED * BOAT_DRAG;
/** Reverse tops out at a fraction of the forward speed — "Reverse at S, slow." */
const BOAT_REVERSE_MUL = 0.35;
/** Below this forward speed, holding the brake pedal means reverse rather than braking — the
 *  same "S is the brake until you are nearly stopped, then it is reverse" idiom
 *  car/vehicle.js's own pedal logic uses, collapsed to one scalar for a boat with no gears. */
const BOAT_REVERSE_ARM = 0.5;
/** Braking multiplier over plain drag, while there is still way on. */
const BOAT_BRAKE_MUL = 1.6;
/** rad/s at full lock and BOAT_MAX_SPEED — "turn radius ~14 m at speed" (radius = v / ω). */
const BOAT_TURN_RADIUS = 14;
export const BOAT_TURN_RATE = BOAT_MAX_SPEED / BOAT_TURN_RADIUS;
/** Below this speed the turn rate is scaled down (a boat with no way on cannot pivot on the
 *  spot) — the same `min(speed/8, 1)` shape the brief specifies. */
const BOAT_TURN_SPEED_FLOOR = 8;
/** rad — cosmetic lean into a turn, read by main.js for the boat mesh's own rotation.z. */
const BOAT_ROLL_MAX = 0.06;
/** 1/s, how fast the lean (dis)engages — see core/math.js's damp(). Fast enough to read as
 *  "leaning into this turn", slow enough not to twitch on a small steering correction. */
const BOAT_ROLL_RATE = 4;
/** The anchored ships' own numbers (render/ships.js's BOB_AMP/BOB_HZ) — not imported, because
 *  they are module-private consts over there and this is the only other place in the game
 *  that draws a boat riding water. Kept identical on purpose: one boat at anchor, one boat
 *  under way, the same sea underneath both. */
const BOAT_BOB_AMP = 0.14;
const BOAT_BOB_HZ = 0.11;
/** Fraction of the boat's own speed carried onto the beach on a normal exit — "keep heading +
 *  a chunk of speed", not a dead stop and not the whole thing (a boat grounding on a beach
 *  loses way). */
const EXIT_SPEED_KEEP = 0.55;

/* ── entry/exit and the locked barrier ────────────────────────────────────────
 * ON_ROAD reuses rescue.js's own threshold (docs/BOAT-PLAN.md: "reuse rescue.js's exact
 * gates") so "off-road" means the same thing in both files. */
const ON_ROAD = 0.45;
/** Depth at the CAR itself, unlocked, before boat mode engages. Well past rescue.js's own
 *  0.25 m contact gate — see the file header's "Rescue integration" note for why the two can
 *  safely disagree: below this, `wallet.boatUnlocked && inDeepWater` is already true and
 *  rescue.js is already skipping itself, so there is no gap for the old teleport to reappear
 *  in. */
const ENTER_DEPTH = 0.6;
/** Depth at the boat's own position below which it has grounded and hands back to the car. */
const EXIT_DEPTH = 0.2;
/** Metres the barrier probes ahead of the car along its own velocity (or heading, nearly
 *  stopped) — "probe the surface ~2.5 m ahead of the car along its velocity." */
const BARRIER_AHEAD = 2.5;
/** Depth the AHEAD PROBE must clear before the barrier bites — deliberately not the same
 *  number as ENTER_DEPTH: the probe is a look-ahead, not a measurement of where the car
 *  already is, so it can afford to be a little shallower and still stop the car in time. */
const BARRIER_DEPTH = 0.45;
/** 1/s, exponential decay of car.vx/vz while the barrier holds — "a soft cushion, not a
 *  wall-slam." Applied AFTER car/vehicle.js's own solver has already run this frame (see
 *  main.js's wiring), so it is genuinely a cushion pushing back against the driver's own
 *  throttle, not a substitute for the solver — the same shape rescue.js's own "lifting" phase
 *  already uses on the same two fields, tuned harder here because there is no placeAt() a
 *  fraction of a second later to finish the job. */
const BARRIER_DAMP_RATE = 14;
/** Seconds between "you need a boat" toasts, so holding the throttle into the barrier says it
 *  once every few seconds rather than every frame. */
const BARRIER_SAY_COOLDOWN = 4;

export class BoatMode {
  /**
   * @param {object} opts
   * @param {{boatUnlocked: boolean}} opts.wallet   game/wallet.js's Wallet (or a stub with
   *        the one field this class actually reads).
   * @param {(text: string, secs: number) => void} [opts.say]  one quiet HUD line.
   * @param {() => {surface(x:number,z:number): object}} [opts.terrain]  returns the CURRENT
   *        terrain sampler — see the file header for why this is a callback and not a
   *        captured reference.
   */
  constructor({ wallet, say = null, terrain = null } = {}) {
    this.wallet = wallet;
    this.say = say || (() => {});
    this.terrain = terrain;

    this._active = false;
    this._blockedToastPending = false;

    /** m/s, signed (+forward, -reverse) — the boat's own speed, independent of car.speed
     *  until it is written back at the end of every active frame. */
    this.speed = 0;
    /** radians — likewise the boat's own heading, written back to car.yaw every active frame. */
    this.yaw = 0;
    /** radians — cosmetic lean into a turn, read by main.js for the boat mesh's rotation.z. */
    this.roll = 0;
    /** seconds, free-running — drives the bob. Not car.terrain-relative, so it never resets
     *  mid-voyage the way a position-keyed phase would. */
    this._t = 0;
    /** seconds since the locked-barrier toast last said its line. */
    this._sinceSay = Infinity;
  }

  /** True while the car's own solver is stood down and this class is driving instead. */
  get active() {
    return this._active;
  }

  /** True on any frame the locked barrier is actively cushioning the car — read by a HUD or a
   *  bench that wants to know without depending on the `say` callback's own log. */
  get blockedToastPending() {
    return this._blockedToastPending;
  }

  /**
   * @param {number} dt seconds
   * @param {object} car a car/vehicle.js Vehicle
   * @param {object} surf car.terrain.surface(car.x, car.z) — the frame's own fresh sample,
   *        taken AFTER car.update() has run this frame if it ran at all (see main.js's own
   *        physics-section comment for the exact ordering and why it matters).
   * @param {object} input the command about to reach (or that just reached) the solver —
   *        main.js's `fuel.gate(drive)`, the same object car.update() itself receives.
   */
  update(dt, car, surf, input) {
    this._t += dt;
    this._sinceSay += dt;
    this._blockedToastPending = false;

    if (this._active) {
      this._stepActive(dt, car, surf, input);
      return;
    }

    // Not boating. car.update() has already run this frame (see main.js) — decide, cheapest
    // first, whether this is the moment to ENTER, and only if not, whether the LOCKED BARRIER
    // needs to bite.
    if (this.wallet.boatUnlocked) {
      const depthHere = waterDepth(surf);
      if (depthHere > ENTER_DEPTH && (surf ? surf.onRoad : 0) < ON_ROAD) this._enter(car);
      return; // unlocked and not deep enough yet — nothing else to do
    }

    this._stepBarrier(dt, car);
  }

  /**
   * The locked barrier. Probes AHEAD of the car rather than measuring where it already is,
   * so — on the shipped seed's own ~35° banks (rescue.js's own measurement: dry to 0.9 m deep
   * within two metres) — the cushion has already engaged before the car's own wheels are wet
   * at all, which is what "cushions to a stop at the waterline" (docs/BOAT-PLAN.md's
   * acceptance script) actually asks for. Runs every frame the boat is locked, whether or not
   * the car is anywhere near water — the probe itself is what is cheap enough to afford that.
   */
  _stepBarrier(dt, car) {
    if (!this.terrain) return; // no sampler handed in — nothing this class can probe with
    const vMag = Math.hypot(car.vx, car.vz);
    // Parked and pointed at the lake still deserves the cushion the instant the driver moves
    // — fall back to the car's own heading rather than reading "stationary" as "no direction".
    const hx = vMag > 0.3 ? car.vx / vMag : Math.sin(car.yaw);
    const hz = vMag > 0.3 ? car.vz / vMag : Math.cos(car.yaw);
    const t = this.terrain();
    if (!t) return;
    const probe = t.surface(car.x + hx * BARRIER_AHEAD, car.z + hz * BARRIER_AHEAD);
    if (waterDepth(probe) <= BARRIER_DEPTH || (probe ? probe.onRoad : 0) >= ON_ROAD) return;

    this._blockedToastPending = true;
    const k = Math.exp(-BARRIER_DAMP_RATE * dt);
    car.vx *= k;
    car.vz *= k;
    if (this._sinceSay >= BARRIER_SAY_COOLDOWN) {
      this._sinceSay = 0;
      this.say('you need a boat to enter the water', 2.6);
    }
  }

  /** Unlocked, deep enough, off-road: hand the wheel to the boat. */
  _enter(car) {
    this._active = true;
    // Clamped into the boat's own operating range rather than carried over exactly — a car
    // arriving at 90 km/h should not spend its first boating frame governed back down as
    // though it had hit a wall; see BOAT_MAX_SPEED/BOAT_REVERSE_MUL for the range.
    this.speed = clamp(car.speed, -BOAT_MAX_SPEED * BOAT_REVERSE_MUL, BOAT_MAX_SPEED);
    this.yaw = car.yaw;
    this.roll = 0;
  }

  /**
   * The arcade boat itself. `surf` is this frame's fresh sample at the car's position BEFORE
   * this call moves it — i.e. "the boat's position" the EXIT test below is checking against
   * is where the boat actually was a moment ago, one frame of lag exactly like rescue.js's
   * own tip-angle sampling accepts for the same reason (see that file's `contact` comment).
   */
  _stepActive(dt, car, surf, input) {
    // EXIT FIRST, before moving anything: a driver who pressed R/T this frame already had
    // backToRoad() reseat the car on dry land earlier in this same tick (see main.js), so
    // `surf` here already reads shallow and the boat must stand down immediately rather than
    // drive one more frame of arcade dynamics out from under a car that is no longer afloat.
    if (waterDepth(surf) < EXIT_DEPTH) {
      this._exit(car);
      return;
    }

    const throttle = clamp01(input?.throttle || 0);
    const brake = clamp01(input?.brake || 0);
    let want = throttle * BOAT_ACCEL;
    if (brake > 0.01) {
      // Braking while there is still way on; reversing, slowly, once nearly stopped — see
      // BOAT_REVERSE_ARM's own comment.
      want -= this.speed > BOAT_REVERSE_ARM ? brake * BOAT_ACCEL * BOAT_BRAKE_MUL : brake * BOAT_ACCEL * BOAT_REVERSE_MUL;
    }
    this.speed += (want - this.speed * BOAT_DRAG) * dt;
    this.speed = clamp(this.speed, -BOAT_MAX_SPEED * BOAT_REVERSE_MUL, BOAT_MAX_SPEED);

    const steer = clamp(input?.steer || 0, -1, 1);
    const turnFactor = Math.min(Math.abs(this.speed) / BOAT_TURN_SPEED_FLOOR, 1);
    const yawRate = steer * BOAT_TURN_RATE * turnFactor;
    this.yaw += yawRate * dt;
    this.roll = damp(this.roll, -steer * BOAT_ROLL_MAX * turnFactor, BOAT_ROLL_RATE, dt);

    // forward is (sin yaw, cos yaw) — car/vehicle.js's own convention, kept so the two never
    // disagree about which way the world's +X/+Z axes point.
    car.x += Math.sin(this.yaw) * this.speed * dt;
    car.z += Math.cos(this.yaw) * this.speed * dt;

    const wl = waterLevelAt(surf.w, surf.y);
    const waterY = wl === null ? surf.y : wl; // guard only: `active` implies wet by construction
    car.y = waterY + Math.sin(this._t * BOAT_BOB_HZ * TAU) * BOAT_BOB_AMP;

    car.yaw = this.yaw;
    car.vx = Math.sin(this.yaw) * this.speed;
    car.vz = Math.cos(this.yaw) * this.speed;
    car.speed = this.speed;
    car.yawRate = yawRate;
  }

  /** Grounded: hand the wheel back to the car. */
  _exit(car) {
    this._active = false;
    const keep = this.speed * EXIT_SPEED_KEEP;
    // placeAt() drops the car onto the ACTUAL ground here (height + suspension rest length,
    // every rollover/sand-bog DOF cleared) rather than leaving it at the water's own surface
    // height — the same reseat R/a reset already does, just without zeroing the speed R does.
    car.placeAt(car.x, car.z, this.yaw);
    car.vx = Math.sin(this.yaw) * keep;
    car.vz = Math.cos(this.yaw) * keep;
    car.speed = keep;
    this.speed = 0;
    this.roll = 0;
  }
}
