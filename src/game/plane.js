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
/* The one water-height function this game has — the same one boat.js floats on. See the sea-floor
 * note in the ground clamp. */
import { waterLevelAt } from '../world/biomes.js';

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
  /* Quadratic drag, 1/m. Sets the top speed together with maxThrust: thrust = drag x v^2, so
   * 14 / 0.0092 gives about 39 m/s, i.e. 140 km/h flat out. The first port had 0.0016 and therefore
   * 336 km/h, which is a jet — in a game whose fastest CAR does 183 and whose grand tourer does 67,
   * that is not a light aircraft over a cozy landscape, it is a missile. */
  drag: 0.0092,
  /** Lift per (m/s)² per radian of angle of attack — how hard the wing pulls the nose's way. */
  lift: 0.055,
  /** m/s below which the wing stops flying and the nose drops. */
  stallSpeed: 22,
  /* A STALL THAT ACTUALLY STALLS. Operator: "they should stall out when going upwards." stallDrop
   * is rad/s² of nose-down torque the wing forces at a full stall, deliberately MORE than
   * pitchTorque (1.5) so holding the stick back cannot out-muscle it — a real wing does not care
   * how hard the stick is pulled once it has stopped flying. 3.6 rather than the 2.4 first tried:
   * at 2.4 the two torques found a polite equilibrium eleven degrees below the peak and the
   * aeroplane MUSHED there, nose high, for ever (bench-plane check 8 measured it before this
   * number moved). This nose-drop, and the HUD callout beside it in main.js, are what make
   * running out of wing legible instead of the plane just quietly refusing to gain height. */
  stallDrop: 3.6,
  /** How much pitch authority fades at full stall — the stick still does something, just not as
   * much as a wing that is still flying would give it. */
  stallSoften: 0.6,
  /* CLIMBING RAISES THE SPEED THE WING NEEDS. On paper a full-power climb equilibrates just under
   * stallSpeed (thrust 14 minus gravity 9.81, over drag 0.0092 gives about 21 m/s straight up) —
   * but the pitch clamp stops at 77 degrees, not the vertical, and MEASURED (bench-plane, 14 s of
   * full power and full back stick) the climb bottoms out at 22.2 m/s: a hair ABOVE the wing's
   * 22, so the "stall" never arrived and the aeroplane hung on its propeller for ever. Rather
   * than nudge numbers until two curves happen to cross, the threshold does what a real wing
   * does: demand more airspeed the harder you are climbing (a climb is flown at higher angle of
   * attack, and gravity is taxing the airspeed the whole way up). The stall speed grows by this
   * fraction of itself at a vertical climb, scaled by vy/v — zero when level, and a DESCENT can
   * never stall, which is what keeps the hands-off glide (throttleNeutral's whole point) a glide. */
  climbStall: 0.35,
  /** m/s² of gravity. The same number the cars fall at. */
  gravity: 9.81,
  /* BANKING COSTS ALTITUDE. Operator: "planes should lose altitude when moving to the left or to
   * the right, as they would naturally." A wing's lift points along the wing's own up, not the
   * world's — bank it over and the vertical share of that lift shrinks, so gravity keeps whatever
   * share it gave up. bankSink is that shortfall expressed as a fraction of g at knife-edge (90
   * degrees of bank, no vertical lift left at all). See the forces section below for the term
   * itself. */
  bankSink: 1.5,
  /** Angular damping, 1/s: how quickly a rotation settles when the stick is released. */
  angularDamp: 2.4,
  /* Roll self-centring, 1/s^2 per radian of bank — a stand-in for the dihedral a real wing has.
   * Without it a held roll input just keeps rolling: measured at 125 degrees after ten seconds, which
   * is past inverted and not what anyone means by "bank into the turn". With it, full stick settles at
   * a steep-but-sane angle and letting go brings the wings back level on its own, which is what makes
   * the aeroplane feel friendly enough for this game. */
  rollCentre: 2.2,
  /** m/s the plane is doing when it is spawned in the air. About 130 km/h — cruising, not diving. */
  spawnSpeed: 36,
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
    /** 0..1, how stalled the wing was on the last step — update() writes it, state reads it. */
    this._stall = 0;
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
      this.say(`the plane needs ${this.gemsToGo} more diamond${this.gemsToGo === 1 ? '' : 's'} away`, 3.4);
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
    this._stall = 0;
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

    /* ── stall, computed once and spent twice below ─────────────────────
     * Operator: "they should stall out when going upwards." `stall` ramps 0 to 1 over the last 8
     * m/s above stallSpeed, so what follows arrives as a fade rather than a cliff edge. Gated on
     * being airborne — `altitude` is ground clearance, and Infinity with no terrain counts as
     * airborne too, same as everywhere else this getter is read — because a slow ground roll or a
     * landing flare is not a stall, it is the whole POINT of being slow near the runway, and the
     * same v0 < stallSpeed test would otherwise nose the plane into the tarmac on takeoff. */
    const v0 = this.speed;
    const airborne = this.altitude > 4; // ground roll and landing flare must not nose-drop
    /* The speed the wing needs right now: stallSpeed level, more in a climb (see climbStall's
     * comment), never more in a descent. */
    const climbing = v0 > 1e-4 ? Math.max(0, this.vy / v0) : 0;
    const needed = PLANE.stallSpeed * (1 + PLANE.climbStall * climbing);
    const stall = airborne ? clamp01((needed - v0) / 8) : 0;
    this._stall = stall;

    /* ── the stick ───────────────────────────────────────────────────────
     * Torque per axis, then a damping term so releasing the stick settles rather than holding the
     * last rate for ever. The reference leans on Unity's angular drag for this; here it is
     * explicit, which is also what makes it testable. */
    const stickPitch = clamp(i.pitch || 0, -1, 1);
  /* THE STICK'S SIGN, third time, and this one is measured against the CAR rather than argued.
   *
   * Operator, three times: "the plane when being steered left goes right", then "the D key goes
   * left instead of right", then decisively — "Left and right are still inverted -- visually right
   * but actually wrong." That last sentence is what solved it: the MODEL is correct, so the error
   * is here in the motion, not in the mesh.
   *
   * THE GROUND TRUTH, taken from the browser suite on the live build rather than from reasoning
   * about handedness, which got this wrong twice:
   *     A steers left  — yaw  59.7 deg  (POSITIVE = LEFT)
   *     D steers right — yaw -115.1 deg (NEGATIVE = RIGHT)
   * Those are the CAR's checks and they pass, so that is the convention this game means.
   *
   * car/input.js gives POSITIVE for left (`held('steerLeft') ? 1 : 0) - (held('steerRight') ...`).
   * A positive roll banks right, the bank trick below yaws in proportion to the bank, and yaw
   * therefore INCREASES — which by the convention above is a turn to the LEFT. So feeding the
   * stick through unchanged is what makes left mean left, and the negation added on 2 August is
   * exactly what made it mean right. It is removed.
   *
   * A flight clip taken on 3 August read "heading change -4.0 deg" with A held and I called that a
   * left turn. By the table above it is a RIGHT turn. The number was right; my reading of it was
   * not. tools/bench-plane.mjs now asserts the sign against this convention explicitly so the next
   * person does not have to take anyone's word for it. */
    const stickRoll = clamp(i.steer || 0, -1, 1);
    const stickYaw = clamp(i.yaw || 0, -1, 1);

    this.p += (stickPitch * PLANE.pitchTorque * (1 - PLANE.stallSoften * stall) - stall * PLANE.stallDrop - this.p * PLANE.angularDamp) * dt;
    this.r += (stickRoll * PLANE.rollTorque - this.r * PLANE.angularDamp - Math.sin(this.roll) * PLANE.rollCentre) * dt;

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
    /* BANKING COSTS ALTITUDE. Operator: "planes should lose altitude when moving to the left or to
     * the right, as they would naturally." `1 - cos(roll)` is the vertical share of lift a banked
     * wing has given up — 0 wings-level, 1 at knife-edge — and `Math.min(1, ...)` holds it there
     * rather than letting inverted flight (roll past 90) claim MORE than a full g back, which
     * would double-charge what gravity is already collecting on its own. Multiplying by `flying`
     * rather than gating it separately means a wing that has already stalled is not charged for
     * banking on top of having no lift to lose in the first place — see bankSink's own comment in
     * the PLANE constants above for the rest of the reasoning. */
    ay -= PLANE.gravity * Math.min(1, 1 - Math.cos(this.roll)) * PLANE.bankSink * flying;

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
    const land = t && typeof t.height === 'function' ? t.height(this.x, this.z) : -Infinity;
    /* THE SEA IS A FLOOR, NOT A WINDOW. Operator: "u can fly under water (should be a boat)."
     *
     * The clamp below only ever asked the LAND, and out at sea the land is the seabed — so the
     * aeroplane descended straight through the surface and kept flying underwater. `waterLevelAt`
     * is the same function game/boat.js floats on (via rescue.js's waterDepth), so the height the
     * plane stops at and the height the boat sits on are ONE number rather than two that agree
     * for now.
     *
     * It stops AT the surface rather than ditching. A ditching is a nicer idea and a much bigger
     * one — it wants a wreck state, a way out of it and a way back to the car — and inventing that
     * here would be a feature nobody asked for wearing a bug fix's clothes. What was asked for is
     * that the sea not be a window. */
    let ground = land;
    if (t && typeof t.surface === 'function') {
      const surf = t.surface(this.x, this.z);
      const wl = surf && surf.w ? waterLevelAt(surf.w, surf.y) : null;
      if (wl !== null && wl > ground) ground = wl;
    }
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
      /* True when the stall has actually taken hold — the same climb-aware measure the physics
       * runs on, past the point where the nose-drop is winning — not at the first whisper of it,
       * so the HUD callout means "the wing has let go", not "you are a little slow". */
      stalling: this.active && this._stall > 0.35,
    };
  }
}
