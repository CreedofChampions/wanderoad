/* Wanderoad — the car.
 *
 * A four-wheel arcade-sim solver at a fixed 120 Hz. Not a full rigid-body sim: the chassis
 * is a planar body with yaw, plus a vertical/pitch/roll layer driven by four independent
 * suspension probes. That is enough to get airborne over a crest, land settled, lean into a
 * corner and hold a slide, and it costs about 40 µs a step.
 *
 * The design brief, in one line: a slide must be READABLE before it starts and CATCHABLE
 * after it does. Every choice below is downstream of that. See tuning.js for where the
 * numbers came from.
 */

import {
  PHYSICS_DT,
  MAX_SUBSTEPS,
  TIERS,
  TYRE,
  STEER,
  PEDAL,
  BRAKE,
  GEARBOX,
  TORQUE_CURVE,
  curveAt,
  BODY,
  AIR,
  SUSPENSION,
  PRESETS,
  ASSIST,
} from './tuning.js';
import { clamp, clamp01, lerp, angleDelta, damp, hash2i } from '../core/math.js';

/** Deterministic [-1,1] from a position — the bump field for loose surfaces. */
const noiseAt = (x, z) => (hash2i(Math.round(x), Math.round(z), 0x5eed) / 4294967296) * 2 - 1;

const TWO_PI = Math.PI * 2;

/* The tyre curve is written in NORMALISED slip, u = α / α_peak, and in two explicit pieces
 * rather than as a raw magic formula. The reason is that the magic formula with a high
 * curvature factor (E = 0.92, which is what gives the long plateau we want) is NOT monotone
 * after its peak — it saturates and comes back up — and a tyre whose grip increases again at
 * 60° of slip is a tyre that behaves in a way no driver can predict.
 *
 * Piece 1, the rise: sin(π/2 · u^0.62). Fast off centre, then genuinely flat on top.
 * Piece 2, the fall: floor + (1 − floor)·exp(−0.125·(u−1)^1.45).
 *
 * The exponents are solved from the three points the design calls for — 91% of peak at 20°,
 * 80% at 30°, 67% at 45° — with the constraint that lateral force must never drop more than
 * 12% within any 5° window. That constraint IS the design: TDU2's defining failure is
 * "there's almost nothing between having maximum grip and no grip at all. There's no
 * transition." The 0.55 floor is what leaves you something to steer with once the car is
 * already sideways, and it is the difference between a slide you catch and a spin you watch.
 */
const RISE_POW = 0.62;
const FALL_K = 0.125;
const FALL_POW = 1.45;

function tyreCurve(u, floor) {
  if (u <= 1) return Math.sin((Math.PI / 2) * Math.pow(u, RISE_POW));
  return floor + (1 - floor) * Math.exp(-FALL_K * Math.pow(u - 1, FALL_POW));
}

/** Lateral force factor for a slip angle, |f| = 1 at the peak slip angle. */
function lateralCurve(alpha, peak) {
  const u = Math.abs(alpha) / peak;
  return Math.sign(alpha) * tyreCurve(u, TYRE.tailFloor);
}

/** Longitudinal force factor for a slip ratio, same construction, shallower tail. */
function longitudinalCurve(sr) {
  const u = Math.abs(sr) / TYRE.peakSlipRatio;
  return Math.sign(sr) * tyreCurve(u, 0.62);
}

export class Vehicle {
  /**
   * @param {object} opts
   * @param {string} opts.tier   'gt' | 'sports' | 'hyper'
   * @param {object} opts.terrain  anything with .surface(x,z) — see world/terrain.js
   */
  constructor({ tier = 'sports', terrain = null, preset = 'sport' } = {}) {
    this.setTier(tier);
    this.terrain = terrain;
    this.assist = { ...PRESETS[preset] };
    this.presetName = preset;

    // pose
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.roll = 0;
    this.pitch = 0;

    // velocity in world space; the solver works in body space and converts
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.yawRate = 0;

    // driver
    this.steer = 0; // -1..1 virtual wheel
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.gear = 1;
    this.rpm = GEARBOX.idleRpm;
    this.reverse = false;

    // internal
    this._shiftTimer = 0;
    this._shiftHold = 0;
    this._absPhase = 0;
    this._liftoff = 0;
    this._liftoffTimer = 0;
    this._airTime = 0;
    this._loadLong = 0;
    this._loadLat = 0;
    this._rollV = 0;
    this._pitchV = 0;
    this._csState = 0;
    this._hbRelease = 1;
    this._acc = 0;
    this._prevSpeed = 0;

    // outputs the rest of the game reads
    this.speed = 0; // m/s along the body
    this.slip = 0; // sideslip angle at the CG, radians
    this.limit = 0; // 0..1 how close to the grip limit — drives audio, shake, HUD
    this.wheelSpin = 0; // radians, for the wheel meshes
    this.longAccel = 0;
    this.latAccel = 0;
    this.onGround = true;
    this.surfaceKind = 'ground';
    this.gripScale = 1;
    this.rough = 0;
    this.forces = { drive: 0, brake: 0, contact: 1, traction: 0, drag: 0, rr: 0, engBrake: 0, net: 0, gear: 1, ratio: 0, latAvail: 1 };
    this.wheels = [
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true },
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true },
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true },
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true },
    ];
  }

  setTier(tier) {
    this.tier = tier;
    const S = TIERS[tier] || TIERS.sports;
    this.spec = S;
    this.mass = S.mass;
    this.izz = S.izz;
    this.wb = S.wheelbase;
    this.track = S.track;
    this.a = S.wheelbase * S.weightRear; // CG to front axle
    this.b = S.wheelbase * (1 - S.weightRear); // CG to rear axle
    this.muCapAwd = S.drive === 'awd';
  }

  setPreset(name) {
    if (!PRESETS[name]) return;
    this.presetName = name;
    this.assist = { ...PRESETS[name] };
  }

  /** Drop the car onto the ground at a point, pointing along `heading`. */
  placeAt(x, z, heading = 0) {
    this.x = x;
    this.z = z;
    this.yaw = heading;
    const s = this.terrain ? this.terrain.surface(x, z) : null;
    this.y = (s ? s.y : 0) + SUSPENSION.restLength;
    this.vx = this.vy = this.vz = 0;
    this.yawRate = 0;
    this.gear = 1;
    this.rpm = GEARBOX.idleRpm;
  }

  /** Maximum road-wheel angle at the current speed, plus the drift bonus. */
  maxSteerAngle(attack = false) {
    const v = Math.abs(this.speed);
    // The mechanical limit of the rack, tapered a little with speed.
    const taper = STEER.minAngle + (STEER.maxAngle - STEER.minAngle) / (1 + Math.pow(v / STEER.taperSpeed, STEER.taperPow));
    // The limit that matters: whatever angle produces a comfortable cornering force here.
    const g = attack ? STEER.attackG : STEER.comfortG;
    // The comfort limit, with a floor that only exists at low speed. A lateral-acceleration
    // cap has nothing sensible to say at walking pace — squeezing the lock down there is what
    // made turning feel heavy in a car park — but letting the floor reach into the cruising
    // band puts the go-kart straight back. So it is full below 5 m/s and gone by 12.
    const byG = v > 1 ? Math.atan((this.wb * g) / (v * v)) : STEER.maxAngle;
    const parkish = 1 - clamp01((v - 5) / 7);
    const byRadius = Math.atan(this.wb / STEER.minRadius) * parkish;
    const comfort = Math.max(byG, byRadius);
    let m = Math.min(taper, comfort);
    m = Math.max(m, this.assist.lockFloor * 0.35, STEER.minAngle * 0.22);
    const beta = Math.abs(this.slip);
    // Once you are already sideways you get MORE lock, not less — this is what makes a
    // slide catchable, and it is why the comfort limit above never traps you in one.
    if (beta > STEER.driftLow) m = Math.max(m, taper * (1 + STEER.driftBonus));
    return m;
  }

  /**
   * Advance the car. `dt` is real elapsed seconds; the solver runs fixed 120 Hz substeps and
   * returns how many it ran (useful for the audio thread).
   */
  update(dt, input) {
    this._acc += Math.min(dt, MAX_SUBSTEPS * PHYSICS_DT);
    let steps = 0;
    while (this._acc >= PHYSICS_DT && steps < MAX_SUBSTEPS) {
      this._step(PHYSICS_DT, input);
      this._acc -= PHYSICS_DT;
      steps++;
    }
    return steps;
  }

  _step(dt, input) {
    const A = this.assist;

    /* ── driver inputs ─────────────────────────────────────────────────── */
    // Pedals ramp asymmetrically. TDU exposes throttle/brake linearity at 0.5 and TDU2
    // players manually blunted throttle response by staying a gear high; ramping does it
    // for them.
    const tTarget = Math.pow(clamp01(input.throttle), PEDAL.throttleCurve);
    this.throttle = damp(this.throttle, tTarget, tTarget > this.throttle ? PEDAL.throttleUp : PEDAL.throttleDown, dt);
    const bTarget = clamp01(input.brake);
    this.brake = damp(this.brake, bTarget, bTarget > this.brake ? PEDAL.brakeUp : PEDAL.brakeDown, dt);
    this.handbrake = clamp01(input.handbrake || 0);

    // Steering: the ramp only applies to digital (keyboard) input. An analogue stick goes
    // straight through, rate-limited to TDU's own 900 °/s of virtual wheel.
    const v = Math.abs(this.speed);
    if (input.analogue) {
      const maxDelta = (STEER.padRateLimit / STEER.maxAngle) * dt;
      const want = clamp(input.steer, -1, 1);
      this.steer += clamp(want - this.steer, -maxDelta, maxDelta);
    } else {
      const want = clamp(input.steer, -1, 1);
      if (want === 0 || Math.sign(want) !== Math.sign(this.steer)) {
        const back = STEER.returnRate * dt;
        this.steer += clamp(-this.steer, -back, back);
        if (want !== 0) {
          const build = (STEER.buildBase + STEER.buildBonus / (1 + Math.pow(v / STEER.buildFalloff, 2))) * dt;
          this.steer += clamp(want - this.steer, -build, build);
        }
      } else {
        const build = (STEER.buildBase + STEER.buildBonus / (1 + Math.pow(v / STEER.buildFalloff, 2))) * dt;
        this.steer += clamp(want - this.steer, -build, build);
      }
    }
    this.steer = clamp(this.steer, -1, 1);

    /* ── body-space velocity ───────────────────────────────────────────── */
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // body +Z is forward, +X is right
    let vLong = this.vz * cy + this.vx * sy;
    let vLat = this.vx * cy - this.vz * sy;
    this.speed = vLong;
    const vMag = Math.hypot(vLong, vLat);
    this.slip = vMag > 0.6 ? Math.atan2(vLat, Math.abs(vLong) + 0.001) : 0;

    /* ── counter-steer assist ──────────────────────────────────────────── */
    // A first-class assist, not a hidden fudge. art of rally ships keyboard at 100% and
    // players push it to 180%; Solar Crown's "countersteering does nothing" is what happens
    // without it.
    let steerAngle = this.steer * this.maxSteerAngle(!!input.attack);
    const csGain = A.counterSteer * (input.analogue ? ASSIST.csGamepad : ASSIST.csKeyboard) * 1.18;
    if (csGain > 0 && Math.abs(this.slip) > ASSIST.csMinSlip && vMag > ASSIST.csMinSpeed) {
      // Steer INTO the slide: the correction has the SAME sign as the sideslip angle.
      // Sideslip is measured from the nose towards +X, so β < 0 means the velocity vector
      // is to the left of where the car points — the classic oversteer-while-turning-right
      // — and the fix is left lock. Getting this sign backwards does not merely fail to
      // help, it feeds the spin: the car went from 0 to 2 rad/s of yaw in half a second
      // with a 0.3 steering input before this was caught.
      const target = clamp(this.slip * csGain, -ASSIST.csClamp * this.maxSteerAngle(), ASSIST.csClamp * this.maxSteerAngle());
      this._csState = damp(this._csState, target, 1 / ASSIST.csLag, dt);
    } else {
      this._csState = damp(this._csState, 0, 1 / ASSIST.csLag, dt);
    }
    steerAngle = clamp(steerAngle + this._csState, -this.maxSteerAngle() * 1.35, this.maxSteerAngle() * 1.35);
    this.steerAngle = steerAngle;

    /* ── ground contact ────────────────────────────────────────────────── */
    const surf = this.terrain ? this.terrain.surface(this.x, this.z) : null;
    const groundY = surf ? surf.y : 0;
    this.surfaceKind = surf ? surf.surfaceKind : 'ground';
    // Surface grip: tarmac 1.0, gravel 0.78, sand 0.62, off-road ~0.55. The car genuinely
    // feels different in each biome, which is the point of having biomes.
    this.gripScale = surf ? surf.grip : 1;

    /* ── the slope ──────────────────────────────────────────────────────
     * The first playable build had none of this, and the result was a car that drove up
     * vertical cliffs and coasted forever — "feels like flying". A planar solver that never
     * looks at the ground normal is a hovercraft with tyre noise.
     *
     * Gravity resolved onto the surface gives the two things that were missing: a hill
     * pulls you back down it, and a slope steep enough that its downhill pull exceeds what
     * the tyres can transmit is a slope you simply cannot climb. No special case, no
     * "max climb angle" constant — just gravity, which is the same reason it works in
     * reality.
     */
    const nx = surf ? surf.nx : 0;
    const ny = surf ? Math.max(surf.ny, 0.2) : 1;
    const nz = surf ? surf.nz : 0;
    this.slopeAngle = Math.acos(Math.min(1, ny));
    const cyS = Math.cos(this.yaw);
    const syS = Math.sin(this.yaw);
    // Gravity's tangential component. G_t = G - (G·n)n, and with G = (0,-g,0) that leaves a
    // horizontal part of g·n.y·(n.x, n.z) — which points DOWNHILL, because a surface normal
    // leans away from the slope it sits on. Project that onto the body axes.
    const slopeLong = AIR.gravity * ny * (nx * syS + nz * cyS);
    const slopeLat = AIR.gravity * ny * (nx * cyS - nz * syS);
    // Above ~34° nothing short of a tracked vehicle gets traction. Rather than a hard
    // refusal, grip fades out — so a steep bank is climbable at an angle, and a cliff is
    // not climbable at all, which is exactly how it reads to a driver.
    const steep = clamp01((this.slopeAngle - 0.42) / 0.34); // 24° .. 44°
    this.gripScale *= 1 - 0.85 * steep;

    const rideY = groundY + SUSPENSION.restLength;
    const gap = this.y - rideY;
    const airborne = gap > 0.06;
    this.onGround = !airborne;

    // Vertical: a spring to the ride height plus gravity, with the suspension travel
    // clamped so a hard landing bottoms out instead of passing through the ground.
    let g = AIR.gravity;
    if (airborne) {
      this._airTime += dt;
      // TDU's own trick: extra downward acceleration once a wheel leaves the ground, so
      // landings settle instead of pogoing. Hardcore removes it, which is exactly why
      // hardcore cars famously launch off crests.
      if (A.airborne > 0 && this._airTime > AIR.extraDelay) {
        const k = clamp01((this._airTime - AIR.extraDelay) / AIR.extraRamp);
        g += AIR.gravity * lerp(AIR.extraMin, AIR.extraMax, k) * A.airborne;
      }
      this.vy -= g * dt;
    } else {
      this._airTime = 0;
      const compression = clamp(rideY - this.y, -SUSPENSION.travel, SUSPENSION.travel);
      const springA = (SUSPENSION.stiffness * 4 * compression) / this.mass;
      const dampA = (SUSPENSION.damping * 4 * -this.vy) / this.mass;
      this.vy += (springA + dampA - g) * dt;
      // A landing must not launch the car back up: kill upward rebound above 2 m/s.
      if (this.vy > 2) this.vy = 2;
    }
    this.y += this.vy * dt;
    if (this.y < rideY - SUSPENSION.travel) {
      this.y = rideY - SUSPENSION.travel;
      if (this.vy < 0) this.vy = 0;
    }

    /* ── load transfer ─────────────────────────────────────────────────── */
    // First-order filters, not instant shifts. TDU1 is praised for transfer that reacts
    // "the way they should"; TDU2 for having none. Fast enough to feel finished, slow
    // enough to feel.
    const targetLong = clamp(this.longAccel / AIR.gravity, -1.2, 1.2);
    const targetLat = clamp(this.latAccel / AIR.gravity, -1.5, 1.5);
    this._loadLong = damp(this._loadLong, targetLong, 1 / BODY.loadTauPitch, dt);
    this._loadLat = damp(this._loadLat, targetLat, 1 / BODY.loadTauRoll, dt);

    const W = this.mass * AIR.gravity + (airborne ? 0 : TYRE.downforce * vMag * vMag);
    const hOverL = this.spec.cgHeight / this.wb;
    let loadFront = W * (this.b / this.wb) - W * hOverL * this._loadLong;
    let loadRear = W - loadFront;
    loadFront = Math.max(loadFront, W * 0.08);
    loadRear = Math.max(loadRear, W * 0.08);

    /* ── tyre forces ───────────────────────────────────────────────────── */
    const contact = airborne ? 0 : 1;

    // slip angles
    const aFront = vMag > 0.5 ? Math.atan2(vLat + this.yawRate * this.a, Math.abs(vLong) + 0.001) - steerAngle : 0;
    const aRear = vMag > 0.5 ? Math.atan2(vLat - this.yawRate * this.b, Math.abs(vLong) + 0.001) : 0;

    // lift-off oversteer: closing the throttle mid-corner briefly drops rear grip. Tuned to
    // be FELT, not to spin the car — this is TDU1's signature made controllable.
    if (this.throttle < 0.12 && Math.abs(this.latAccel) > TYRE.liftoffMinLatG * AIR.gravity && this._liftoffTimer <= 0) {
      this._liftoffTimer = TYRE.liftoffHold + TYRE.liftoffRecover;
    }
    if (this._liftoffTimer > 0) {
      this._liftoffTimer -= dt;
      const inHold = this._liftoffTimer > TYRE.liftoffRecover;
      this._liftoff = inHold ? TYRE.liftoffDrop : TYRE.liftoffDrop * clamp01(this._liftoffTimer / TYRE.liftoffRecover);
    } else this._liftoff = 0;

    // handbrake: partial rear-grip loss with a felt recovery, not TDU2's spin-out button
    if (this.handbrake > 0.01) this._hbRelease = 0;
    else this._hbRelease = clamp01(this._hbRelease + dt / BRAKE.handbrakeRecover);
    const hbEase = 1 - Math.pow(1 - this._hbRelease, 3);
    const hbMu = lerp(BRAKE.handbrakeRearMu, 1, this.handbrake > 0.01 ? 0 : hbEase);

    const speedFade = 1 - TYRE.speedFade * Math.min(vMag / TYRE.speedFadeAt, 1);
    const cap = this.muCapAwd ? TYRE.awdCap : 1e9;
    const muF = Math.min(TYRE.muLatFront, cap) * this.gripScale * speedFade;
    const muR = Math.min(TYRE.muLatRear, cap) * this.gripScale * speedFade * (1 - this._liftoff) * hbMu;

    let fyFront = -lateralCurve(aFront, TYRE.peakSlipFront) * muF * loadFront * contact;
    let fyRear = -lateralCurve(aRear, TYRE.peakSlipRear) * muR * loadRear * contact;

    /* ── engine and drive ──────────────────────────────────────────────── */
    const S = this.spec;
    const ratio = S.ratios[this.gear - 1] * S.finalDrive;
    const wheelOmega = vLong / S.wheelRadius;
    let rpm = Math.abs(wheelOmega) * ratio * (60 / TWO_PI);
    this.rpm = clamp(Math.max(rpm, GEARBOX.idleRpm), GEARBOX.idleRpm, S.redline * 1.02);

    if (this._shiftTimer > 0) this._shiftTimer -= dt;
    if (this._shiftHold > 0) this._shiftHold -= dt;
    // A gearbox that can upshift and downshift on the same conditions HUNTS: it upshifts
    // because the revs are high, downshifts because the driver has lifted, and repeats every
    // frame. While a shift is in progress the torque is cut, so a hunting box silently
    // deletes both drive AND engine braking — which is exactly why the first build coasted
    // for two kilometres. Two guards: never upshift on a closed throttle, and never shift
    // twice inside half a second.
    if (A.autoGears && this._shiftTimer <= 0 && this._shiftHold <= 0 && !this.reverse) {
      const upAt = curveAt(GEARBOX.upshiftAtThrottle, this.throttle) * S.redline;
      if (this.throttle > 0.06 && this.rpm > upAt && this.gear < S.ratios.length) {
        this.gear++;
        this._shiftTimer = GEARBOX.shiftTimeAuto;
        this._shiftHold = 0.5;
      } else if (this.gear > 1) {
        const prevRatio = S.ratios[this.gear - 2] * S.finalDrive;
        const rpmIfDown = Math.abs(wheelOmega) * prevRatio * (60 / TWO_PI);
        // Two reasons to drop a gear: the engine has fallen off the bottom of its range, or
        // the driver has lifted off and wants the engine braking. The second is what makes a
        // downhill hairpin feel like a car instead of a sledge.
        const bogging = this.rpm < GEARBOX.idleRpm + GEARBOX.downshiftHysteresis * 0.9;
        const coasting = this.throttle < 0.05 && rpmIfDown < S.redline * 0.7;
        if (rpmIfDown < S.redline * 0.92 && (bogging || coasting)) {
          this.gear--;
          this._shiftTimer = GEARBOX.shiftTimeAuto;
          this._shiftHold = 0.5;
        }
      }
    }

    const shiftCut = this._shiftTimer > 0 ? GEARBOX.shiftTorqueCut : 1;
    const rpmFrac = clamp01(this.rpm / S.redline);
    const limiter = this.rpm >= S.redline ? 0.15 : 1;
    const engineTorque = S.peakTorque * curveAt(TORQUE_CURVE, rpmFrac) * this.throttle * shiftCut * limiter;
    let driveForce = ((engineTorque * ratio) / S.wheelRadius) * (1 - GEARBOX.driveLoss);
    /* Reverse should not need a gear key. Hold the brake with the car stopped and it backs
     * up; touch the throttle and it goes forward again. "The ability to stop, turn around and
     * change direction is key" — and on a keyboard the cheapest way to make that true is to
     * let the pedals mean what they obviously mean. */
    /* THE DEADLOCK THIS ONCE CAUSED, because it is not obvious from the code:
     * the auto-pilot brakes at 0.35 when it cannot find a road, which tripped this test and
     * put the car in reverse. Reverse then only cleared when the car was moving forwards —
     * but it was now crawling backwards, so it never cleared, and the auto-pilot sat at full
     * throttle driving gently the wrong way for ever. It reported as "stopped moving" and
     * cost two rounds of guessing at the wrong subsystem.
     *
     * Two fixes. The auto-pilot's own input never engages reverse — a chauffeur that decides
     * to reverse is not a chauffeur. And throttle clears reverse whenever the car is nearly
     * stationary, whichever way it happens to be creeping. */
    if (!input.auto && Math.abs(vLong) < 0.6 && this.brake > 0.35 && this.throttle < 0.05) {
      this.reverse = true;
    } else if (this.throttle > 0.15 && vLong > -3) {
      this.reverse = false;
    }
    if (this.reverse) {
      // In reverse the brake IS the accelerator, and reverse is deliberately slow.
      driveForce = -Math.max(Math.abs(driveForce), this.brake * 2600) * 0.5;
    }

    const driveLoad = S.drive === 'awd' ? W : loadRear;
    const maxTraction = TYRE.muLongPeak * this.gripScale * driveLoad;
    // Traction control trims torque towards the limit; it is an assist, and at TCS 0 it does
    // nothing at all.
    if (A.tcs > 0 && Math.abs(driveForce) > maxTraction) {
      driveForce -= Math.sign(driveForce) * (Math.abs(driveForce) - maxTraction) * A.tcs;
    }
    // Whatever TCS did or did not do, the tyre still cannot transmit more than friction
    // allows. Without this hard clamp the engine pushes at full force through a surface with
    // no grip, and the car drives up a 70° cliff faster than it drives up a 40° one — which
    // is what the first build actually did. The 1.15 lets a spinning wheel overshoot
    // slightly, which is what makes wheelspin feel like wheelspin.
    const tractionCap = maxTraction * 1.15;
    if (Math.abs(driveForce) > tractionCap) driveForce = Math.sign(driveForce) * tractionCap;

    /* A soft speed governor. Chasing a cozy top speed through drag area alone means either
     * absurd aero numbers or a gutless car, and a hard limiter feels like hitting a wall. A
     * taper over the last 15 km/h reads as the car simply running out of legs, which is what
     * a real car near its top speed feels like anyway. */
    const vMax = S.topSpeed / 3.6;
    if (vLong > vMax - 4.2) {
      driveForce *= clamp01((vMax - vLong) / 4.2);
    }
    const slipRatio = maxTraction > 1 ? clamp(driveForce / maxTraction, -3, 3) * TYRE.peakSlipRatio : 0;

    /* ── brakes ────────────────────────────────────────────────────────── */
    let brakeForce = 0;
    if (this.brake > 0.001 && vMag > 0.2) {
      const split = lerp(BRAKE.splitFront, BRAKE.splitFrontDive, clamp01(-this._loadLong));
      let torque = BRAKE.torque * this.brake * A.brakeMul;
      // ABS modulates rather than clamps: 18 Hz, releasing 30% of line pressure.
      if (A.abs > 0) {
        const demand = torque / S.wheelRadius;
        const grip = TYRE.muLongPeak * this.gripScale * W;
        if (demand > grip) {
          this._absPhase += dt * BRAKE.absHz * TWO_PI;
          const mod = 1 - BRAKE.absRelease * (0.5 + 0.5 * Math.sin(this._absPhase)) * A.abs;
          torque = Math.min(torque, grip * S.wheelRadius * 1.02) * mod;
        }
      }
      brakeForce = -Math.sign(vLong) * (torque / S.wheelRadius);
      // With ABS off and the fronts locked, keep a floor of lateral capacity. "you'll just
      // slide straight" is the failure to avoid.
      const lockAmt = clamp01(1 - A.abs) * clamp01(this.brake * 1.4 - 0.5);
      if (lockAmt > 0) fyFront *= lerp(1, BRAKE.lockedLatFloor, lockAmt);
      void split;
    }
    if (this.handbrake > 0.01 && vMag > 0.2) {
      brakeForce += -Math.sign(vLong) * ((BRAKE.handbrakeTorque * this.handbrake) / S.wheelRadius);
    }

    /* ── combined slip ─────────────────────────────────────────────────── */
    // A friction ellipse with exponent 1.85 rather than 2.0: about 6% more simultaneous
    // capacity, which is what lets trail-braking rotate the car instead of ploughing on.
    /* Hard off-road ceiling. Above it the tyres simply stop putting power down — you can
     * arrive off-road at speed and coast, but you cannot BUILD speed in a field.
     *
     * THIS LINE HAS TO STAY ABOVE `fxTotal`. It used to sit sixty lines further down, where it
     * clamped `driveForce` after `fxTotal` had already been summed from it — so the ceiling was
     * dead code and off-road top speed was set entirely by rolling resistance. That is why the
     * car did 61.7 km/h in a field against 101 on tarmac when the ceiling claimed to be 100:
     * the ceiling was not doing anything at all, in either direction.
     *
     * 44 km/h, not the 100 of the original phrasing. 100 was a ceiling; the requirement is
     * "dramatically slow when off-road, at least 50%", and a field you can nearly keep pace in
     * makes staying on the road pointless. The figure is under half of the SLOWEST on-road top
     * speed the suite has measured (85 km/h on a climbing stretch, 101 on a flat one), because
     * a ratio measured against a noisy number has to clear the worst case, not the average. */
    const onRoad = surf ? surf.onRoad : 1;
    const offCap = lerp(12.2, 200, clamp01(onRoad * 1.4)); // 44 km/h off the carriageway
    if (contact && vLong > offCap && driveForce > 0) driveForce = 0;

    const fxTotal = (driveForce + brakeForce) * contact;
    const fxMax = TYRE.muLongPeak * this.gripScale * W;
    const usedX = Math.pow(Math.min(Math.abs(fxTotal) / Math.max(fxMax, 1), 1), TYRE.ellipseExp);
    const latAvail = Math.pow(Math.max(1 - usedX, 0.04), 1 / TYRE.ellipseExp);
    fyFront *= latAvail;
    fyRear *= latAvail;

    /* ── drag, rolling resistance and engine braking ───────────────────
     * "Momentum never ends" was the first thing said about the first build, and it was
     * true: 0.014 rolling resistance is a tarmac tyre on a smooth road, which decelerates a
     * coasting car at 0.14 m/s² — a minute and a half from 130 km/h to a stop. Real
     * coasting is dominated by ENGINE BRAKING through the gearbox, which the model did not
     * have at all, and off a made road by a rolling resistance five times higher.
     */
    const drag = 0.5 * 1.225 * S.cdA * vLong * Math.abs(vLong);
    /* Off-road has to be a real decision, not a texture change: "speed should dramatically
     * slow when off-road, at least 50%", "shouldn't be able to go over 100 km/h off-road
     * ever". Rolling resistance on grass and sand is genuinely several times tarmac's, so
     * this is honest physics pushed to the top of its honest range — plus a hard ceiling,
     * because the point of the game is to stay on the road. */
    const crr = lerp(0.145, 0.014, clamp01(onRoad));
    const rr = crr * this.mass * AIR.gravity * Math.sign(vLong) + lerp(9.5, 1.4, clamp01(onRoad)) * vLong;
    // Closed throttle drives the engine through the transmission; the retarding force
    // scales with gear and rpm exactly as the drive force does.
    /* Engine braking, and the shape of it matters more than the size.
     *
     * This used to scale as (1 - throttle), which sounds right and is badly wrong: at a
     * quarter throttle it still applied three quarters of the full retarding torque, so
     * holding a steady cruise was a tug of war the engine won. Measured on a flat road at
     * 33 km/h: 1486 N of drive against 1330 N of engine braking, net negative, the car
     * quietly decaying to a stop with the throttle still open. It made cruising impossible
     * and it made the auto-pilot look broken.
     *
     * A real engine stops braking almost as soon as the throttle cracks open. This vanishes
     * by a quarter throttle, which is what lets a light foot hold a speed. */
    const closed = Math.max(0, 1 - this.throttle * 4);
    const engBrake =
      this._shiftTimer > 0
        ? 0
        : closed * 95 * (0.3 + 0.7 * rpmFrac) * (ratio / S.wheelRadius) * Math.sign(vLong) * contact;

    /* Loose surface. Off the carriageway the car should feel like it is on gravel — bumpy,
     * reluctant to turn, and unwilling to build speed. The bump is a real vertical impulse
     * from a hash of the position, so it is deterministic and it shakes the camera and the
     * suspension the way a rough surface would. */
    if (contact && onRoad < 0.6) {
      const loose = 1 - onRoad;
      const wob =
        noiseAt(this.x * 0.31, this.z * 0.31) * 0.6 + noiseAt(this.x * 1.13 + 11.7, this.z * 1.13 - 4.2) * 0.4;
      this.vy += wob * loose * Math.min(vMag, 24) * 0.055 * dt * 60;
      // Loose gravel does not steer. This is on top of the grip loss, and it is what makes
      // rejoining the road something you plan rather than something you flick.
      fyFront *= 1 - 0.34 * loose;
      fyRear *= 1 - 0.28 * loose;
      this.rough = loose;
    } else this.rough = 0;

    /* ── integrate the planar body ─────────────────────────────────────── */
    const fxBody = fxTotal - drag - rr - engBrake;

    /* Force telemetry. Cheap, always on, and the reason is practical: "full throttle and the
     * car does not move" is impossible to diagnose from the outside, and it has now happened
     * twice. Every term that can cancel the drive is recorded here. */
    this.forces.drive = driveForce;
    this.forces.brake = brakeForce;
    this.forces.contact = contact;
    this.forces.traction = maxTraction;
    this.forces.drag = drag;
    this.forces.rr = rr;
    this.forces.engBrake = engBrake;
    this.forces.net = fxBody;
    this.forces.gear = this.gear;
    this.forces.ratio = ratio;
    this.forces.latAvail = latAvail;
    const fyBody = (fyFront * Math.cos(steerAngle) + fyRear) * 1.0;

    // The body frame is rotating, so the two velocity components are coupled: a car holding
    // a steady circle needs the centripetal terms or it can never reach equilibrium — it
    // just keeps building sideslip until something else stops it. Omitting these is the
    // classic way to end up with a car that corners at 0.8 g when its tyres say 1.3.
    const aLong = fxBody / this.mass + this.yawRate * vLat + slopeLong * contact;
    const aLat = fyBody / this.mass - this.yawRate * vLong + slopeLat * contact;

    vLong += aLong * dt;
    vLat += aLat * dt;

    // stability control: a yaw moment that opposes the difference between where the car is
    // pointing and where it is going. Small, and off in hardcore.
    let yawMoment = fyFront * Math.cos(steerAngle) * this.a - fyRear * this.b;
    if (A.stability > 0 && vMag > 3) {
      const desired = (vLong / Math.max(this.wb, 0.1)) * Math.tan(steerAngle);
      yawMoment -= (this.yawRate - desired) * this.izz * ASSIST.stabilityYawGain * A.stability;
    }
    // Once past the drift window, damp yaw hard so a spin has to be earned.
    const beta = Math.abs(this.slip);
    if (beta > STEER.driftLow) {
      const k = beta > STEER.spinAngle ? STEER.spinYawDamp : STEER.driftYawDamp;
      yawMoment -= this.yawRate * this.izz * k;
    }
    if (this.handbrake > 0.01) {
      // rear lock is allowed, an instant spin is not
      this.yawRate = clamp(this.yawRate, -BRAKE.handbrakeYawCap, BRAKE.handbrakeYawCap);
    }
    this.yawRate += (yawMoment / this.izz) * dt * contact;

    // ── the spin governor ──────────────────────────────────────────────
    // A two-axle bicycle model with a deliberately fat tyre tail has almost no restoring
    // moment once both axles are past peak slip: the forces balance, the yaw rate is left
    // wherever the transient put it, and the car rotates forever. Measured before this
    // existed: a 2.7° steering input at 144 km/h reached 2.8 rad/s and never came back.
    //
    // The governor states the physical truth the bicycle model loses: you cannot rotate the
    // VELOCITY vector faster than the tyres can turn it. Anything above that is the car
    // spinning about its own axis rather than cornering, so it is bled off on a short time
    // constant. The 1.45 headroom is what leaves room for a real, held drift.
    const latCapacity = (muF * loadFront + muR * loadRear) / this.mass;
    const yawCap = (latCapacity / Math.max(vMag, 4)) * 1.35;
    const yawMag = Math.abs(this.yawRate);
    if (contact && yawMag > yawCap) {
      const bleed = 1 - Math.exp(-7.5 * dt);
      this.yawRate -= Math.sign(this.yawRate) * (yawMag - yawCap) * bleed;
    }
    // self-aligning torque: the wheel wants to follow the velocity vector. Low gain — high
    // gain is what makes a car "heavy and numb".
    const trail = lerp(STEER.trailPeak, STEER.trailPostPeak, clamp01(Math.abs(aFront) / TYRE.peakSlipFront - 1));
    this.yawRate -= this.yawRate * STEER.satDamping * STEER.satGain * trail * dt;

    // Creep damping: a car at walking pace with no throttle should settle rather than drift
    // around on numerical noise. But only on ground flat enough that gravity is not asking
    // it to roll — otherwise this quietly becomes a handbrake and the car sits on a 20°
    // slope forever, which is not a thing cars do.
    if (vMag < 0.25 && this.throttle < 0.02 && Math.abs(slopeLong) < 0.55) {
      vLong *= 0.9;
      vLat *= 0.9;
      this.yawRate *= 0.85;
    }

    this.yaw += this.yawRate * dt;
    if (this.yaw > Math.PI) this.yaw -= TWO_PI;
    else if (this.yaw < -Math.PI) this.yaw += TWO_PI;

    // back to world space
    const cy2 = Math.cos(this.yaw);
    const sy2 = Math.sin(this.yaw);
    this.vz = vLong * cy2 - vLat * sy2;
    this.vx = vLong * sy2 + vLat * cy2;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.longAccel = aLong;
    this.latAccel = aLat;
    this.speed = vLong;

    /* ── attitude ──────────────────────────────────────────────────────── */
    const rollTarget = clamp(-this._loadLat * this.spec.rollPerG, -BODY.rollClamp, BODY.rollClamp);
    const pitchTarget = clamp(
      this._loadLong > 0 ? -this._loadLong * BODY.squatPerG : -this._loadLong * BODY.divePerG,
      -BODY.pitchClamp,
      BODY.pitchClamp
    );
    const rollAcc = (rollTarget - this.roll) * BODY.rollOmega * BODY.rollOmega - this._rollV * 2 * BODY.rollZeta * BODY.rollOmega;
    this._rollV = clamp(this._rollV + rollAcc * dt, -BODY.rollRate, BODY.rollRate);
    this.roll += this._rollV * dt;
    const pitchAcc = (pitchTarget - this.pitch) * BODY.pitchOmega * BODY.pitchOmega - this._pitchV * 2 * BODY.pitchZeta * BODY.pitchOmega;
    this._pitchV = clamp(this._pitchV + pitchAcc * dt, -BODY.pitchRate, BODY.pitchRate);
    this.pitch += this._pitchV * dt;

    /* ── the limit cue ─────────────────────────────────────────────────── */
    // A browser game has no force feedback, so "how close am I?" has to live in the render
    // and audio layers. One number drives all of it.
    this.limit = clamp01(
      Math.max(Math.abs(aFront) / TYRE.peakSlipFront, Math.abs(aRear) / TYRE.peakSlipRear, Math.abs(slipRatio) / TYRE.peakSlipRatio)
    );
    this.wheelSpin += (vLong / S.wheelRadius) * dt;
    this.wheels[0].slipAngle = aFront;
    this.wheels[1].slipAngle = aFront;
    this.wheels[2].slipAngle = aRear;
    this.wheels[3].slipAngle = aRear;
    this.wheels[0].load = this.wheels[1].load = loadFront * 0.5;
    this.wheels[2].load = this.wheels[3].load = loadRear * 0.5;
  }

  /** km/h, for the HUD. */
  get kph() {
    return Math.abs(this.speed) * 3.6;
  }

  /** Ground-terrain-aware wheel heights, for planting the visual model on a slope. */
  groundTilt() {
    if (!this.terrain) return { pitch: 0, roll: 0 };
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const half = this.track * 0.5;
    const fx = this.x + s * this.a;
    const fz = this.z + c * this.a;
    const rx = this.x - s * this.b;
    const rz = this.z - c * this.b;
    const hF = this.terrain.height(fx, fz);
    const hR = this.terrain.height(rx, rz);
    const hL = this.terrain.height(this.x - c * half, this.z + s * half);
    const hRt = this.terrain.height(this.x + c * half, this.z - s * half);
    return {
      pitch: Math.atan2(hF - hR, this.wb),
      roll: Math.atan2(hRt - hL, this.track),
    };
  }
}
