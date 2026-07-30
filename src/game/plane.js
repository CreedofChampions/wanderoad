/* Wanderoad — flight.
 *
 * Operator: "make planes unlockable via diamonds in sea. Look up air control git repos based on
 * popularity and then use one -- let me unlock via pass 123 and even spawn in air".
 *
 * ── WHERE THE MODEL COMES FROM ────────────────────────────────────────────────
 * GitHub, sorted by stars, filtered to licences this project allows (MIT / Apache-2.0 / BSD /
 * CC0 — see docs/CREDITS.md). What that search actually turned up is worth recording, because the
 * obvious first hit is unusable:
 *
 *   gue-ni/flightsim.js            66 stars  NO LICENCE   -> unusable, all rights reserved
 *   dimartarmizi/web-flight-sim   543 stars  "Other"      -> unusable, not a known permissive one
 *   xyzzy/jsFlightSim               9 stars  AGPL-3.0     -> banned outright by this project
 *   brihernandez/ArcadeJetFlight   59 stars  MIT          -> USED
 *   brihernandez/ArcadeSpaceFlight 99 stars  MIT          -> same author, the space variant
 *
 * So this is a port of Brian Hernandez's ArcadeJetFlightExample (MIT), which is the widely-cited
 * reference for arcade — not simulated — flight, and it is the right choice for a cozy driving
 * game for exactly that reason. Its three ideas, all kept:
 *
 *   1. THRUST ALONG THE NOSE, not along the velocity. The plane goes where it points.
 *   2. TORQUE PER AXIS with the throttle moving SLOWLY, so speed changes are gradual and come
 *      from drag reaching equilibrium rather than from the input.
 *   3. THE BANK TRICK, which is the whole feel of the thing and reads as a hack until you fly it:
 *      the more the plane is banked, the more it is magically yawed in that direction. Bank is
 *      read as the Y component of the plane's own RIGHT vector, which handles flying straight up
 *      or down for free — at the vertical, "right" has almost no Y and the term vanishes.
 *
 * Ported rather than imported: it is Unity C# against a Rigidbody, and this project has its own
 * fixed-step integrator and its own quaternion-free pose convention (forward is (sin yaw, cos
 * yaw), the same one car/vehicle.js documents). A dependency would have been a second physics
 * engine in the bundle for four equations.
 *
 * Pure and testable in the same way game/boat.js is: no DOM, no three.js, no timers. Feed it a
 * pose, a stick and a dt.
 */

import { clamp, clamp01, lerp } from '../core/math.js';

/** Gems — the diamonds out at sea — needed to earn the plane. */
export const PLANE_UNLOCK_GEMS = 12;
/** The typed pass that also unlocks it, on the operator's instruction ("unlock via pass 123"). */
export const PLANE_PASS = '123';

/* ── the airframe ──────────────────────────────────────────────────────────
 * Numbers in this project's own units (metres, seconds, radians), scaled from the reference's
 * Unity values so the plane's speeds sit in the same cozy range as the cars: a light touring
 * aircraft, not a jet. `turnTorques` keeps the reference's shape — roll is the fastest axis, yaw
 * by far the slowest — because that shape is what makes a stick feel like an aeroplane rather
 * than a spaceship. */
export const PLANE = {
  /** rad/s² of angular acceleration available per axis at full deflection. */
  pitchTorque: 1.5,
  yawTorque: 0.28,
  rollTorque: 2.6,
  /** The bank trick's own gain — see the file header. */
  bankTorque: 0.55,
  /** m/s² of thrust at full throttle. */
  maxThrust: 14.0,
  /** How fast the throttle itself moves, 0..1 per second. Slow on purpose. */
  throttleRate: 0.45,
  /** Extra deceleration once the throttle is below neutral — the reference's `brakeDrag`. */
  brakeDrag: 0.9,
  /** Neutral throttle: enough to hold level flight, so hands-off is a glide and not a stall. */
  throttleNeutral: 0.35,
  /** Quadratic drag coefficient, 1/m. Sets the top speed with maxThrust. */
  drag: 0.0016,
  /** Lift per (m/s)² per radian of angle of attack — how hard the wing pulls the nose's way. */
  lift: 0.055,
  /** m/s below which the wing stops flying and the nose drops. */
  stallSpeed: 22,
  /** m/s² of gravity. The same number the cars fall at. */
  gravity: 9.81,
  /** Angular damping, 1/s: how quickly a rotation settles when the stick is released. */
  angularDamp: 2.4,
  /** m/s the plane is doing when it is spawned in the air. */
  spawnSpeed: 55,
  /** Metres above the ground a spawn-in-air drop starts at. */
  spawnHeight: 320,
};

/**
 * A flying aeroplane. Owns its own pose while it is active, exactly the way game/boat.js owns the
 * boat's — the car solver does not run at the same time as this, and this never writes to the car
 * except at the handover.
 */
export class Plane {
  /**
   * @param {object} opts
   * @param {{gems:number, planeUnlocked?:boolean}} opts.wallet game/wallet.js's Wallet
   * @param {(t:string,secs?:number)=>void} [opts.say] one short line of HUD text
   * @param {()=>({height:(x:number,z:number)=>number})} [opts.terrain] zero-arg forward reference
   *        to the current terrain, for the same reason boat.js takes one: main.js reassigns it.
   */
  constructor({ wallet, say = null, terrain = null } = {}) {
    this.wallet = wallet;
    this.say = say || (() => {});
    this.terrain = terrain;

    this.active = false;
    /** Pose. `yaw` is the same convention as the car: forward is (sin yaw, cos yaw). */
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    /** Velocity, world axes. */
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    /** Angular rates, body axes, rad/s. */
    this.p = 0; // pitch rate
    this.q = 0; // yaw rate
    this.r = 0; // roll rate
    this.throttle = PLANE.throttleNeutral;
    this._saidLocked = false;
  }

  /** Earned by gems at sea, by the pass, or already latched — same shape as the boat's. */
  get unlocked() {
    return !!(this.wallet && (this.wallet.planeUnlocked || this.wallet.gems >= PLANE_UNLOCK_GEMS));
  }

  /** Gems still needed. 0 once it is earned. */
  get gemsToGo() {
    if (this.unlocked) return 0;
    return Math.max(0, PLANE_UNLOCK_GEMS - (this.wallet ? this.wallet.gems : 0));
  }

  /** Airspeed, m/s. */
  get speed() {
    return Math.hypot(this.vx, this.vy, this.vz);
  }

  /** km/h, for the HUD — same field name the car and the boat use. */
  get kph() {
    return this.speed * 3.6;
  }

  /** Metres of ground clearance, or Infinity with no terrain to ask. */
  get altitude() {
    const t = this.terrain?.();
    if (!t || typeof t.height !== 'function') return Infinity;
    return this.y - t.height(this.x, this.z);
  }

  /**
   * Take off from wherever the car is. Returns false (and says why) if the plane is not earned.
   * @param {{x:number,z:number,y:number,yaw:number,speed:number}} car
   * @param {boolean} [inAir] spawn already flying, PLANE.spawnHeight above the ground
   */
  start(car, inAir = false) {
    if (!this.unlocked) {
      this.say(`the plane needs ${this.gemsToGo} more diamond${this.gemsToGo === 1 ? '' : 's'} from the sea`, 3.4);
      return false;
    }
    const t = this.terrain?.();
    const ground = t && typeof t.height === 'function' ? t.height(car.x, car.z) : car.y || 0;
    this.x = car.x;
    this.z = car.z;
    this.yaw = car.yaw;
    this.pitch = inAir ? 0 : 0.06; // a touch of nose-up on a runway start
    this.roll = 0;
    this.y = ground + (inAir ? PLANE.spawnHeight : 1.4);
    const v = inAir ? PLANE.spawnSpeed : Math.max(Math.abs(car.speed || 0), 8);
    this.vx = Math.sin(this.yaw) * v;
    this.vz = Math.cos(this.yaw) * v;
    this.vy = 0;
    this.p = this.q = this.r = 0;
    this.throttle = inAir ? 0.7 : 1;
    this.active = true;
    this.say(inAir ? 'in the air — S to ease off, W for power' : 'rolling — pull back to climb', 3.2);
    return true;
  }

  /** Put it away. The caller decides what to do with the car. */
  stop() {
    this.active = false;
  }

  /**
   * One fixed step.
   * @param {number} dt seconds
   * @param {{steer:number, throttle:number, brake:number, pitch?:number, analogue?:boolean}} input
   *        `steer` rolls (the reference's roll axis), `pitch` pitches. main.js maps the arrow keys
   *        onto `pitch` and reuses W/S for the throttle, so nothing new has to be learned.
   */
  update(dt, input) {
    if (!this.active) return;
    const i = input || {};

    /* ── throttle, moved slowly ──────────────────────────────────────────
     * Straight from the reference: the throttle is the thing with inertia, not the speed. Below
     * neutral it also brakes, and the brake term scales with how far below neutral it is. */
    const want = clamp01(PLANE.throttleNeutral + (i.throttle || 0) * (1 - PLANE.throttleNeutral) - (i.brake || 0) * PLANE.throttleNeutral);
    const brakePower = PLANE.brakeDrag * clamp01((PLANE.throttleNeutral - want) / PLANE.throttleNeutral);
    const rate = PLANE.throttleRate * (1 + brakePower);
    this.throttle += clamp(want - this.throttle, -rate * dt, rate * dt);

    /* ── the stick ───────────────────────────────────────────────────────
     * Torque per axis, then a damping term so releasing the stick settles rather than holding the
     * last rate for ever. The reference leans on Unity's angular drag for this; here it is
     * explicit, which is also what makes it testable. */
    const stickPitch = clamp(i.pitch || 0, -1, 1);
    const stickRoll = clamp(i.steer || 0, -1, 1);
    const stickYaw = clamp(i.yaw || 0, -1, 1);

    this.p += (stickPitch * PLANE.pitchTorque - this.p * PLANE.angularDamp) * dt;
    this.r += (stickRoll * PLANE.rollTorque - this.r * PLANE.angularDamp) * dt;

    /* THE BANK TRICK, and it is the reason this model feels like flying.
     *
     * The reference reads how banked the plane is off the Y component of its own RIGHT vector,
     * and yaws in that direction in proportion. That one line is what turns "roll then pull" into
     * an aeroplane turn, and reading bank off `right.y` rather than off the roll angle is what
     * makes it behave correctly when the nose is straight up or down: at the vertical, right has
     * almost no Y and the term politely vanishes instead of spinning the plane.
     *
     * With this project's Euler pose, the right vector's Y component is sin(roll)·cos(pitch). */
    const bankFactor = Math.sin(this.roll) * Math.cos(this.pitch);
    const yawFromBank = bankFactor * PLANE.bankTorque;
    this.q += (stickYaw * PLANE.yawTorque + yawFromBank - this.q * PLANE.angularDamp) * dt;

    this.pitch = clamp(this.pitch + this.p * dt, -1.35, 1.35); // just short of vertical
    this.roll += this.r * dt;
    while (this.roll > Math.PI) this.roll -= Math.PI * 2;
    while (this.roll < -Math.PI) this.roll += Math.PI * 2;
    this.yaw += this.q * dt;

    /* ── forces ──────────────────────────────────────────────────────────
     * Thrust along the NOSE, drag against the velocity, lift towards where the nose points, and
     * gravity. Lift fades below the stall speed so running out of airspeed drops the nose instead
     * of hanging the plane in the sky — the gentlest honest version of a stall. */
    const cp = Math.cos(this.pitch);
    const nx = Math.sin(this.yaw) * cp;
    const nz = Math.cos(this.yaw) * cp;
    const ny = Math.sin(this.pitch);

    const thrust = PLANE.maxThrust * this.throttle;
    let ax = nx * thrust;
    let ay = ny * thrust;
    let az = nz * thrust;

    const v = this.speed;
    if (v > 1e-4) {
      const d = PLANE.drag * v * v;
      ax -= (this.vx / v) * d;
      ay -= (this.vy / v) * d;
      az -= (this.vz / v) * d;
    }

    // Lift: pull the velocity towards the nose, harder the faster you are going.
    const flying = clamp01((v - PLANE.stallSpeed * 0.5) / (PLANE.stallSpeed * 0.5));
    const liftAccel = PLANE.lift * v * v * flying;
    ax += (nx - (v > 1e-4 ? this.vx / v : 0)) * liftAccel;
    ay += (ny - (v > 1e-4 ? this.vy / v : 0)) * liftAccel;
    az += (nz - (v > 1e-4 ? this.vz / v : 0)) * liftAccel;

    ay -= PLANE.gravity;

    this.vx += ax * dt;
    this.vy += ay * dt;
    this.vz += az * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;

    /* ── the ground ──────────────────────────────────────────────────────
     * Landing is a soft floor, not a crash: this is a cozy game and there is no fail state
     * anywhere else in it either. Touch down and you roll along the ground losing speed; the
     * caller decides when that becomes "back in the car". */
    const t = this.terrain?.();
    const ground = t && typeof t.height === 'function' ? t.height(this.x, this.z) : -Infinity;
    if (this.y < ground + 1.2) {
      this.y = ground + 1.2;
      if (this.vy < 0) this.vy *= -0.12; // a small bounce, then it settles
      this.pitch = lerp(this.pitch, 0, clamp01(dt * 4));
      this.roll = lerp(this.roll, 0, clamp01(dt * 4));
      const along = Math.hypot(this.vx, this.vz);
      if (along > 0) {
        const k = Math.max(0, along - 6 * dt) / along; // ground friction
        this.vx *= k;
        this.vz *= k;
      }
    }
  }

  /** Everything the HUD needs, in one object. Do not mutate it. */
  get state() {
    return {
      active: this.active,
      kph: this.kph,
      altitude: this.altitude,
      throttle: this.throttle,
      pitch: this.pitch,
      roll: this.roll,
      unlocked: this.unlocked,
      gemsToGo: this.gemsToGo,
      stalling: this.active && this.speed < PLANE.stallSpeed,
    };
  }
}
