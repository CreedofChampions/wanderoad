/* Wanderoad — boat mode: the last unlock, and the water barrier before it.
 *
 * docs/BOAT-PLAN.md, workstream C. Two jobs, one small state machine, in this order because
 * the second only exists to protect the first:
 *
 *   1. WHILE THE BOAT IS LOCKED, deep off-road water must never be reachable at all — not
 *      "damped toward it more slowly", ACTUALLY unreachable: the barrier removes the velocity
 *      component pointing at the water every single frame, so a floored throttle cannot re-add
 *      it, and — because the probe is AHEAD of the car and a frame can still cover real ground —
 *      walks the car itself back out of anything deeper than a wet wheel if it ever ends up
 *      there anyway. No wallow, no rescue-teleport at the shoreline (rescue.js used to own
 *      that; see its own "Rescue integration" note). See _stepBarrier() below for both halves.
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
/* 0.28, not 0.6. Operator: "u need to be stopped when hitting water and switched to boat --
 * right now i can cover half my car in water before that". They are describing this number
 * exactly: with the boat unlocked there is no barrier, so the car drives on until the water
 * at its own position is 0.6 m deep — a wheel is 0.34 m in radius and the sills sit around
 * 0.5 m, so 0.6 m IS half the car, and the switch happened after the swim rather than at the
 * waterline. 0.28 m is just over wheel-hub deep: the moment the wheels are properly wet.
 *
 * 0.34 m is exactly a wheel radius: the switch happens when the wheels are under, not when the
 * doors are. It is not pushed lower than that because EXIT_DEPTH is 0.2 m and the two need real
 * hysteresis between them or a boat sitting at the waterline flickers between car and boat.
 *
 * The other half of the complaint — "u need to be STOPPED when hitting water" — is ENTER_AHEAD
 * below: the same look-ahead cushion the locked barrier uses now also runs while the boat is
 * UNLOCKED, so the water brings the car to a halt at the shore and the handover happens there,
 * instead of the car carrying 60 km/h into a lake and only then becoming a boat. */
const ENTER_DEPTH = 0.34;
/** Metres ahead, along the car's own travel, that the UNLOCKED cushion probes — the same
 *  look-ahead shape (and distance) the locked barrier uses, for the same reason: a car at
 *  40 km/h covers 11 m a second, so anything that only reads where the car already IS fires
 *  late. This does not ENTER the boat — it slows the car so that entry happens at the
 *  waterline with the car nearly stopped. */
const ENTER_AHEAD = 2.5;
/** Fraction of the car's forward speed that survives meeting the water. Small on purpose: see
 *  _enter. Not zero, because a boat that is dead in the water the instant it floats cannot be
 *  steered clear of the bank it just came off. */
const ENTER_SPEED_KEPT = 0.18;
/** m/s the car may still be doing over the last couple of metres before the water. About
 *  11 km/h — a crawl, so the handover reads as arriving at the shore rather than launching off
 *  it, which is what the operator asked for. An unlocked driver is meant to REACH the water,
 *  so this caps the approach rather than refusing it. */
const ENTER_APPROACH = 3.0;
/** Depth the ahead-probe must show for entry. Shallower than ENTER_DEPTH on purpose: it is a
 *  forecast, not a measurement, and a shoreline shelves, so 0.18 m two metres ahead means real
 *  water by the time the nose is there. Same number as BARRIER_CLAMP_DEPTH and rescue.js's own
 *  CONTACT — "your wheels are in the water" is one line in this project, not three. */
const ENTER_AHEAD_DEPTH = 0.18;
/** Depth at the boat's own position below which it has grounded and hands back to the car.
 *  Exported alongside EXIT_PROBE_DIST/EXIT_STEEP_SLOPE below for the same reason — a fixture
 *  search that wants "a shore this class can actually exit onto" needs all three. */
export const EXIT_DEPTH = 0.2;
/** Metres ahead of the boat, along its own heading, the exit check probes the raw ground —
 *  same shape as the barrier's own AHEAD probe (BARRIER_AHEAD), just against height rather
 *  than water depth. Exported so tools/bench-boat.mjs's own fixture search can require a
 *  landing this class will actually let a boat use, rather than re-deriving the number. */
export const EXIT_PROBE_DIST = 2.5;
/** Rise over that run above which the exit is declined — "beaching nose-first onto a >~20°
 *  bank strands the car" (playtest report). tan(20°) ≈ 0.36. */
export const EXIT_STEEP_SLOPE = 0.36;
/** Fraction of the boat's own speed turned into the one-shot pushback below — "bounce gently"
 *  so the boat noses back off under its own way rather than grinding to a halt against the
 *  slope. A MAGNITUDE, not a signed multiplier any more (fix round 2): the old code applied
 *  this every single frame the bank stayed shallow-and-steep, which — since |EXIT_BOUNCE_MUL|
 *  is less than 1 — is a sign-flipping geometric decay (+2 -> -0.7 -> +0.245 -> -0.086 -> ...)
 *  that collapses to zero speed in a few frames AND, because it lived inside the branch that
 *  skipped the throttle/steer block entirely, left the driver with no way to power off, reverse,
 *  or turn along the bank while it did — the actual soft-lock (playtest report: "the boat
 *  freezes at any steep shoreline nose-in, no input works"). See EXIT_BOUNCE_COOLDOWN's own
 *  comment for the redesign: a single push, not a state the boat sits in. */
const EXIT_BOUNCE_MUL = 0.35;
/** m/s — floor on the one-shot pushback's own magnitude, so a boat that noses into the bank at
 *  near-zero speed (e.g. after drifting to a stop right at the waterline) still gets kicked
 *  clear rather than bouncing at an unmeasurably small speed and re-triggering the exit test
 *  again next frame. */
const EXIT_BOUNCE_MIN_SPEED = 0.8;
/** Seconds the EXIT TEST is suspended for after a bounce — not the driver's controls, which
 *  never stop running (see _stepActive's own header comment). Long enough that the boat has
 *  visibly cleared the bank under the pushback (and whatever the driver commands on top of it)
 *  before the exit test is allowed to fire again and possibly decline (and re-bounce) a second
 *  time; short enough that a driver who immediately powers straight back at the same steep spot
 *  gets bounced again rather than waiting out a long, unresponsive-feeling lockout. */
const EXIT_BOUNCE_COOLDOWN = 1.0;
/** Metres the barrier probes ahead of the car along its own velocity (or heading, nearly
 *  stopped) — "probe the surface ~2.5 m ahead of the car along its velocity." */
const BARRIER_AHEAD = 2.5;
/** Depth the AHEAD PROBE must clear before the barrier bites — deliberately not the same
 *  number as ENTER_DEPTH: the probe is a look-ahead, not a measurement of where the car
 *  already is, so it can afford to be a little shallower and still stop the car in time. */
const BARRIER_DEPTH = 0.45;
/** 1/s, MILD exponential decay on whatever velocity survives the projection in _stepBarrier's
 *  own (a) below — a cushion on top of a cushion, not the primary defence any more. Back near
 *  docs/BOAT-PLAN.md's own original "~6/s" ask: the old value (14) was tuned specifically to
 *  out-fight a re-added throttle component that (a) now removes outright, every frame, before
 *  this ever runs — there is no tug-of-war left for a hard rate to have to win. */
const BARRIER_DAMP_RATE = 6;
/** Metres of water over the CAR ITSELF (not the ahead-probe) above which _stepBarrier's
 *  positional clamp — (b) below — walks it back out. The same number rescue.js calls CONTACT:
 *  the barrier's whole job is to keep a boat-locked car on the dry side of the same line
 *  rescue.js already draws for everyone else ("your wheels are in the water", not "you are
 *  under it"). */
const BARRIER_CLAMP_DEPTH = 0.18;
/** Metres per walk-back step — "in ≤0.3 m steps". Small enough that the full budget below
 *  covers under two metres, comfortably inside the ~2 m the shipped seed's own banks take to
 *  go from dry to knee-deep (rescue.js's own measurement) — the loop only ever has to undo one
 *  frame's worth of penetration, not search for the shore. */
const BARRIER_CLAMP_STEP = 0.3;
/** Step budget for the walk-back — "max ~6 steps". Cheap (one terrain sample each) and
 *  bounded, so a car somehow deeper than six steps can reach stops trying rather than looping
 *  the sampler forever. */
const BARRIER_CLAMP_MAX_STEPS = 6;
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
    /** seconds remaining on the post-bounce exit-test suspension — see EXIT_BOUNCE_COOLDOWN's
     *  own comment. Zero means the exit test runs normally. */
    this._bounceCooldown = 0;
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

  /** True while the post-bounce exit-test suspension is running — same idea as
   *  blockedToastPending's own getter above, one level down: a bench that wants to know the
   *  exact frame a steep-bank decline fired its one-shot pushback, without reaching into
   *  `_bounceCooldown` (an implementation detail of the exit test, not a public contract) or
   *  guessing from a sudden change in `speed`. */
  get bouncing() {
    return this._bounceCooldown > 0;
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
      const offRoad = (surf ? surf.onRoad : 0) < ON_ROAD;
      if (offRoad && waterDepth(surf) > ENTER_DEPTH) {
        this._enter(car);
        return;
      }
      /* Not deep enough yet — but if there is water a couple of metres ahead, the water is
       * what stops the car. Velocity only: the locked barrier's positional walk-back is
       * deliberately NOT run here, because an unlocked driver is allowed to end up in the
       * lake; they just are not allowed to arrive there at speed. */
      if (this._waterAhead(car)) this._cushion(dt, car);
      return;
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
   *
   * TWO DEFENCES, not one. An exponential damp on its own settles at whatever equilibrium the
   * SOLVER's own re-added throttle and the damp's own decay agree on — nonzero, at a floored
   * throttle, which is a slow but real creep into the lake (measured: rescue's own 0.25 m
   * contact gate crossed in ~6 s). So (a) the velocity component pointing at the water is
   * PROJECTED OUT every frame — removed, not decayed — before the residual damp even runs,
   * which is what makes "the solver re-adds it next frame" a non-event instead of a
   * tug-of-war; and (b), because the probe is ahead of the car and a single frame can still
   * cover real ground, a positional backstop: if the car's own position is ever wetter than
   * BARRIER_CLAMP_DEPTH anyway, it is walked back out along the same heading in real
   * terrain-sampled steps before its velocity is zeroed. Between the two, deep water is not
   * damped toward, it is unreachable.
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

    // (a) Project OUT the velocity component pointing at the water — subtract the POSITIVE
    // part of (vx,vz) dotted with the probe heading — rather than merely decay it, so lateral
    // movement and backing away (a non-positive dot) are left entirely alone. A mild overall
    // damp on whatever is left is still applied, as a cushion rather than the whole defence.
    const toward = car.vx * hx + car.vz * hz;
    if (toward > 0) {
      car.vx -= toward * hx;
      car.vz -= toward * hz;
    }
    const k = Math.exp(-BARRIER_DAMP_RATE * dt);
    car.vx *= k;
    car.vz *= k;

    // (b) Positional backstop: the probe is AHEAD of the car, so one fast frame can still
    // carry the car's own position past BARRIER_CLAMP_DEPTH before (a) above gets a chance to
    // act on it. Walk it back out along the same heading, in real terrain-sampled steps,
    // rather than trust the velocity fix alone to have been enough.
    let here = t.surface(car.x, car.z);
    if (waterDepth(here) > BARRIER_CLAMP_DEPTH) {
      for (let i = 0; i < BARRIER_CLAMP_MAX_STEPS && waterDepth(here) > BARRIER_CLAMP_DEPTH; i++) {
        car.x -= hx * BARRIER_CLAMP_STEP;
        car.z -= hz * BARRIER_CLAMP_STEP;
        here = t.surface(car.x, car.z);
      }
      car.vx = 0;
      car.vz = 0;
    }

    if (this._sinceSay >= BARRIER_SAY_COOLDOWN) {
      this._sinceSay = 0;
      this.say('you need a boat to enter the water', 2.6);
    }
  }

  /** Unlocked, deep enough, off-road: hand the wheel to the boat. */
  /** Is there real water within ENTER_AHEAD metres along the way this car is actually going?
   *  Same probe the locked barrier uses (see _stepBarrier), including the heading fallback for
   *  a car that is stopped and pointed at the lake. */
  _waterAhead(car) {
    if (!this.terrain) return false;
    const t = this.terrain();
    if (!t) return false;
    const vMag = Math.hypot(car.vx, car.vz);
    const hx = vMag > 0.3 ? car.vx / vMag : Math.sin(car.yaw);
    const hz = vMag > 0.3 ? car.vz / vMag : Math.cos(car.yaw);
    const probe = t.surface(car.x + hx * ENTER_AHEAD, car.z + hz * ENTER_AHEAD);
    if ((probe ? probe.onRoad : 0) >= ON_ROAD) return false; // a causeway is not a lake
    return waterDepth(probe) > ENTER_AHEAD_DEPTH;
  }

  /** The velocity half of the barrier, reused: project out whatever part of the car's motion
   *  points at the water and damp the rest. Shared shape with _stepBarrier's (a) — see its
   *  comment for why projecting beats decaying (lateral movement and backing away are left
   *  completely alone). */
  _cushion(dt, car) {
    const vMag = Math.hypot(car.vx, car.vz);
    if (vMag < 1e-4) return;
    const hx = car.vx / vMag;
    const hz = car.vz / vMag;
    const toward = car.vx * hx + car.vz * hz;
    if (toward <= ENTER_APPROACH) return; // already crawling — let them in
    /* A CAP, not a damp. The locked barrier damps towards zero because a locked driver must
     * not reach the water at all; an unlocked one must, so this only ever removes the excess
     * above a walking-pace approach. Damping here instead was measured and is a trap: the
     * exponential never quite reaches the waterline, so the boat could not be entered at all
     * and tools/bench-boat.mjs went from "afloat in 2.2 s" to never afloat. */
    const scale = ENTER_APPROACH / toward;
    car.vx *= scale;
    car.vz *= scale;
  }

  _enter(car) {
    this._active = true;
    // Clamped into the boat's own operating range rather than carried over exactly — a car
    // arriving at 90 km/h should not spend its first boating frame governed back down as
    // though it had hit a wall; see BOAT_MAX_SPEED/BOAT_REVERSE_MUL for the range.
    /* HITTING WATER STOPS YOU. Operator: "u need to be stopped when hitting water and switched
     * to boat". Water is not a ramp — a car that arrives at 60 km/h does not keep 60 km/h once
     * it is floating, and carrying the speed over is what made the entry read as sliding into
     * the lake rather than meeting it. So the entry speed is scaled hard and then clamped into
     * the boat's own range: you arrive, you are stopped by the water, and you set off again
     * under the boat's own power. Reverse is left alone — backing INTO water is already
     * deliberate. */
    const arriving = car.speed > 0 ? car.speed * ENTER_SPEED_KEPT : car.speed;
    this.speed = clamp(arriving, -BOAT_MAX_SPEED * BOAT_REVERSE_MUL, BOAT_MAX_SPEED);
    // and the car itself stops dead, so nothing of the old momentum survives the handover
    car.vx = 0;
    car.vz = 0;
    car.speed = this.speed;
    this.yaw = car.yaw;
    this.roll = 0;
    this._bounceCooldown = 0; // a fresh voyage starts with the exit test live, not mid-cooldown
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
    //
    // Shallow is not always beachable, though: a bow pointed nose-first at a bank steeper than
    // EXIT_STEEP_SLOPE strands the exit below flush on ground the car solver cannot climb —
    // "beaching nose-first onto a >~20° bank strands the car (W does nothing, only reverse
    // works)", playtest report — because the reseat assumes a gentle beach. Probe the ground a
    // short distance ahead, the same shape _stepBarrier's own AHEAD probe uses; too steep to
    // land on, decline the exit.
    //
    // ONE-SHOT PUSHBACK, not a state the boat sits in (fix round 2 — see EXIT_BOUNCE_MUL's own
    // comment for the bug this replaced: applying the bounce every frame is a sign-flipping
    // decay that collapses speed to zero AND, because it lived in a branch that skipped the
    // throttle/steer block below, froze the boat with no input working at all). A decline here
    // is a single backward kick and a cooldown that suspends the EXIT TEST for
    // EXIT_BOUNCE_COOLDOWN seconds — the throttle/steer/drag block below is not inside that
    // cooldown and is never skipped, bounced or not, so the driver can always power off the
    // bank, reverse, or turn along it on the very same frame as the bounce and every frame
    // after.
    if (this._bounceCooldown > 0) this._bounceCooldown = Math.max(0, this._bounceCooldown - dt);
    if (this._bounceCooldown <= 0 && waterDepth(surf) < EXIT_DEPTH) {
      const t = this.terrain ? this.terrain() : null;
      if (t && this._steepAhead(car, t)) {
        // Guaranteed minimum kick (EXIT_BOUNCE_MIN_SPEED) so a boat that drifted up to the bank
        // at near-zero speed still gets pushed clear rather than bouncing at an unmeasurable
        // speed and re-declining next frame.
        this.speed = Math.min(-Math.abs(this.speed) * EXIT_BOUNCE_MUL, -EXIT_BOUNCE_MIN_SPEED);
        this._bounceCooldown = EXIT_BOUNCE_COOLDOWN;
      } else {
        this._exit(car);
        return;
      }
    }

    // Normal throttle/steer/drag dynamics — ALWAYS run, bounced-this-frame or not; see the
    // redesign note above for why this used to be conditional and why that was the bug.
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

  /** True if the raw ground EXIT_PROBE_DIST ahead of the boat, along its own heading, rises
   *  steeper than a beachable slope — see the note at the exit check in _stepActive() above
   *  for why this exists. Same probe shape as _stepBarrier's own ahead-probe, just against
   *  height rather than water depth: a boat exit runs INTO the shore, so "ahead" is uphill. */
  _steepAhead(car, t) {
    const hereY = t.height(car.x, car.z);
    const aheadY = t.height(car.x + Math.sin(this.yaw) * EXIT_PROBE_DIST, car.z + Math.cos(this.yaw) * EXIT_PROBE_DIST);
    return (aheadY - hereY) / EXIT_PROBE_DIST > EXIT_STEEP_SLOPE;
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
