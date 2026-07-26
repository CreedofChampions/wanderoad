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

/** A wheel counts as off the made surface below this much road coverage. */
const OFF_ROAD_AT = 0.5;

/* Rollover. These live here rather than in tuning.js because every one of them is part of
 * the tip solver below and means nothing without it — the same reason the tyre-curve
 * exponents are here.
 *
 * The angles are all expressed as fractions of the car's OWN static tipping angle,
 * atan(halfTrack / cgHeight), which is 61° on the GT and 66° on the hyper. A fixed angle
 * would mean the low wide car and the tall narrow one tip at the same place, which is the
 * one thing about a rollover everybody already knows is false.
 */
const TIP = {
  liftFrom: 0.65, // × static angle: the inside wheels are unambiguously off by here
  liftTo: 1.15, // × static angle: the outside pair has gone too, no tyre is touching
  commit: 1.02, // × static angle: past its own balance point it is going over
  damp: 2.2, // roll-rate damping from the dampers, 1/s — fades out as the wheels lift
  rightAfter: 1.2, // s on its roof before the car picks itself up
  rightMax: 5.0, // ... and the longest it is ever allowed to lie there
  rightRate: 3.0, // 1/s of the righting damp — about 1.3 s from upside down to level
  digFrom: 3.0, // m/s of sideways speed before a tyre starts to plough
  digK: 0.55, // m/s² of ploughing per (m/s)² of sideways speed
  digMax: 40, // m/s² ceiling, about 4 g — a kerb strike, not a tyre
  digFlat: 0.6, // fraction of that on flat ground; full value only into a rising face
  bankRate: 0.6, // rad/s of imposed roll below which a bank is just texture
  scrapeFrom: 0.85, // × static angle: past here it is panels on the ground, not rubber
  scrapeK: 3.4, // 1/s of velocity bleed while scraping
};

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
    this._lean = 0; // body roll on its springs, the cosmetic load-transfer part
    this._leanV = 0;
    this._dive = 0; // body pitch on its springs, likewise
    this._diveV = 0;
    this._tip = 0; // roll of the body away from the surface it is standing on
    this._tipV = 0;
    this._righting = false;
    this._rollTimer = 0;
    this._prevGroundRoll = 0;
    this._gRate = 0; // smoothed rate the ground is rolling the car at
    this._gRatePrev = 0;
    // Scratch for roads.carve(). Terrain hands out ONE shared object per Terrain, so a
    // second caller that keeps a reference gets it rewritten under them — own the buffer.
    this._carve = { mask: 0, y: 0, edge: 0, d: Infinity, tier: 0, tx: 1, tz: 0, width: 0 };
    this._probedX = Infinity; // never probed — any comparison below is "stale"
    this._probedZ = Infinity;
    this._probedYaw = 0;

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
    /* Off-road, judged at the four contact patches rather than at the badge on the bonnet.
     * `onRoad` is the average — it is what the drag, the bump and the speed ceiling read, so
     * two wheels on the verge costs you half of each. `onRoadMin` is the worst wheel, and it
     * is what the STATE reads: one wheel off means you are off, which is what a driver feels
     * and what the tyre note should say. */
    this.onRoad = 1;
    this.onRoadMin = 1;
    this.offRoad = 0; // 0..1, how far off the made surface the worst wheel is
    this.wheelsOffRoad = 0;
    /* Attitude of the ground under the wheels, in the renderer's sign convention (see
     * _probeWheels). `roll` and `pitch` already include these — do not add them again. */
    this.groundPitch = 0;
    this.groundRoll = 0;
    this.rolled = false; // on its side or its roof, and about to pick itself up
    this.forces = { drive: 0, brake: 0, contact: 1, traction: 0, drag: 0, rr: 0, engBrake: 0, trip: 0, net: 0, gear: 1, ratio: 0, latAvail: 1 };
    // [front-left, front-right, rear-left, rear-right] — the order model.js builds its wheel
    // meshes in. x/z are the world contact point, y is the GROUND height there.
    this.wheels = [
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true, onRoad: 1 },
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true, onRoad: 1 },
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true, onRoad: 1 },
      { x: 0, y: 0, z: 0, compression: 0, load: 0, slipAngle: 0, slipRatio: 0, contact: true, onRoad: 1 },
    ];
  }

  /** The angle this car balances at before gravity takes it over. ~61° GT, ~66° hyper. */
  get tipAngle() {
    return Math.atan2(this.track * 0.5, this.spec.cgHeight);
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
    // R must always be a way out of a rollover, so it clears the tip DOF outright.
    this._tip = 0;
    this._tipV = 0;
    this._lean = this._leanV = this._dive = this._diveV = 0;
    this.rolled = false;
    this._righting = false;
    this._rollTimer = 0;
    this._probeWheels();
    this._prevGroundRoll = this.groundRoll;
    this.roll = this.groundRoll;
    this.pitch = this.groundPitch;
  }

  /**
   * Sample the ground under each of the four wheels: height and road coverage.
   *
   * Cost, because four terrain probes a step is not free and it was measured, not guessed:
   * height() + roads.carve() is 28 µs a wheel against 43 µs for a full surface(). The
   * expensive part of surface() is its central-difference normal, and we do not want that
   * per wheel anyway — the four heights ARE the plane the car is standing on, over the
   * car's own wheelbase rather than a 1.2 m sample at the badge. All in it is about +100 µs
   * on a 90 µs step, or a quarter of a millisecond on a 16 ms frame. Test stubs with no
   * road network fall back to surface(), which in a stub costs nothing.
   *
   * THE SIGNS, because both of them have been wrong in this file and one of them is the
   * "car points into the hill when climbing" report. model.js does chassis.rotation.x =
   * pitch and chassis.rotation.z = roll on a body whose +Z is forward and whose +X is the
   * driver's LEFT (three.js puts +X on your left when you look down +Z — the same handedness
   * that has bitten the autopilot's cross-track term and the touch steering).
   *
   *   rotation.x > 0 swings +Z downwards, so POSITIVE PITCH IS NOSE DOWN. That is already
   *     the convention the dive/squat term uses (braking gives a positive pitch), so ground
   *     rising towards the front has to arrive NEGATIVE. It used to arrive positive, at 60%
   *     weight, which is exactly the complaint: on a 12° climb the body was pitched 7° nose
   *     DOWN into the hill instead of 12° nose up.
   *   rotation.z > 0 swings +X (the left side) upwards, so POSITIVE ROLL IS LEFT SIDE UP.
   *     Ground higher under the left wheels is therefore positive.
   */
  _probeWheels() {
    const t = this.terrain;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const half = this.track * 0.5;
    // forward is (sin yaw, cos yaw); the car's left is (cos yaw, −sin yaw)
    const lx = cy * half;
    const lz = -sy * half;
    const fx = this.x + sy * this.a;
    const fz = this.z + cy * this.a;
    const rx = this.x - sy * this.b;
    const rz = this.z - cy * this.b;
    let sum = 0;
    let min = 1;
    let off = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const front = i < 2;
      const left = (i & 1) === 0;
      w.x = (front ? fx : rx) + (left ? lx : -lx);
      w.z = (front ? fz : rz) + (left ? lz : -lz);
      let gy = 0;
      let road = 1;
      if (t) {
        if (t.roads && t.roads.carve) {
          gy = t.height(w.x, w.z);
          road = t.roads.carve(w.x, w.z, this._carve).edge;
        } else {
          const s = t.surface(w.x, w.z);
          gy = s.y;
          road = s.onRoad !== undefined ? s.onRoad : 1;
        }
      }
      w.y = gy;
      w.onRoad = road;
      sum += road;
      if (road < min) min = road;
      if (road < OFF_ROAD_AT) off++;
    }
    this.onRoad = sum * 0.25;
    this.onRoadMin = min;
    this.offRoad = 1 - min;
    this.wheelsOffRoad = off;
    const hF = (this.wheels[0].y + this.wheels[1].y) * 0.5;
    const hR = (this.wheels[2].y + this.wheels[3].y) * 0.5;
    const hL = (this.wheels[0].y + this.wheels[2].y) * 0.5;
    const hRt = (this.wheels[1].y + this.wheels[3].y) * 0.5;
    this.groundPitch = -Math.atan2(hF - hR, this.wb);
    this.groundRoll = Math.atan2(hL - hRt, this.track);
    this._probedX = this.x;
    this._probedZ = this.z;
    this._probedYaw = this.yaw;
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
    // Surface grip: tarmac 1.0, gravel 0.78, sand 0.62, off-road ~0.55. The car genuinely
    // feels different in each biome, which is the point of having biomes. This one stays a
    // centre sample deliberately: grip is a biome lookup, and a second biome sample per
    // wheel costs more than the whole rest of the step. What a wheel on the verge costs you
    // is applied further down, through the loose-surface block, which now reads the
    // four-wheel average — putting it in both places would charge for it twice.
    this.gripScale = surf ? surf.grip : 1;
    /* Where the WHEELS are. Everything downstream that used to ask the terrain about the
     * point under the driver's seat now asks the four contact patches instead: the car is
     * off-road when a wheel is off-road, not when the badge crosses the line. Clipping a
     * verge with the near side reads as half a car's worth of drag, bump and lost steering,
     * which is what it should cost. */
    this._probeWheels();
    const onRoad = this.onRoad;
    // The tyre note is the cheapest off-road cue there is, so it goes on the WORST wheel:
    // one wheel on the grass and you can hear it.
    this.surfaceKind = this.onRoadMin > OFF_ROAD_AT ? (surf ? surf.surfaceKind : 'ground') : 'ground';

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
    /* Contact is not a boolean once the car can go over. Past about two thirds of its own
     * tipping angle the inside pair is unarguably in the air; past the tipping angle itself
     * the outside pair has followed and the only thing on the ground is paint. `contact`
     * scales every tyre force, the drive, the engine braking and the slope pull, so fading
     * it here is what makes a car on its side coast instead of driving along on its roof —
     * this one number is read in twelve places below, which is the whole reason the fade
     * lives here and not in twelve separate special cases. It uses LAST step's tip angle
     * because this step's is solved
     * from these forces; at 120 Hz that is 8 ms of lag on a 1.5 s event. */
    const tipStatic = this.tipAngle;
    const tipMag = Math.abs(this._tip);
    const tipContact = clamp01(1 - (tipMag - TIP.liftFrom * tipStatic) / ((TIP.liftTo - TIP.liftFrom) * tipStatic));
    const contact = airborne ? 0 : tipContact;

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
    /* `onRoad` is the four-wheel average, taken at the top of the step. Straddling the edge
     * with the near side on the grass reads 0.5 here, which lifts the ceiling to something
     * that never bites — correct, because half a car on the tarmac is still half a car on
     * the tarmac. It is the min, not the average, that says you are off-road. */
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

    /* ── tripping ───────────────────────────────────────────────────────
     * A tyre sliding sideways across tarmac slides. A tyre sliding sideways THROUGH a field,
     * or into the face of a verge, ploughs: soil piles against the sidewall and the force
     * stops being friction, which is why almost every real rollover is a trip and almost
     * none is grip alone. The arithmetic says the same thing about this car — lifting its
     * inside wheels needs g·halfTrack/h = 1.93 g and its tyres make 1.34 — so without a
     * ploughing term the honest answer to "can it flip?" is no, ever, at any speed.
     *
     * Resistance grows with the square of how fast you are pushing into the ground, capped
     * at 2.75 g so it is a kerb strike and not a wall. It is gated on the wheels being off
     * the made surface AND on a real sideways slide, so it is silent for anything a road
     * drive does — including every case in bench-car.mjs, which is all on tarmac.
     *
     * It goes into fyBody below, not into a variable of its own that nothing reads: it has
     * to actually stop the slide (that is what tripping DOES) as well as tip the car, and a
     * force that only appears in the roll solver would be the third dead tunable this file
     * has had. `forces.trip` reports it. */
    let fyTrip = 0;
    if (contact > 0 && onRoad < 0.75 && Math.abs(vLat) > TIP.digFrom) {
      const loose = clamp01((0.75 - onRoad) / 0.75);
      const over = Math.abs(vLat) - TIP.digFrom;
      /* Sliding into ground that is RISING under the leading wheels is a different event
       * from sliding across a flat field: the soil is not being pushed aside, it is in the
       * way. groundRoll is positive when the car's left is the high side, so a slide that
       * agrees in sign with it is a slide up the bank. Half the resistance on the flat,
       * nearly three times that into a 20° face — which is why the answer to "can I flip
       * it?" is "off-road, at speed, into a bank", and not "anywhere, at any time". */
      const into = clamp01((Math.sign(vLat) * this.groundRoll) / 0.35);
      const aDig = Math.min(TIP.digK * over * over, TIP.digMax) * loose * (TIP.digFlat + (1 - TIP.digFlat) * into);
      fyTrip = -Math.sign(vLat) * aDig * this.mass * contact;
    }

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
    this.forces.trip = fyTrip;
    this.forces.net = fxBody;
    this.forces.gear = this.gear;
    this.forces.ratio = ratio;
    this.forces.latAvail = latAvail;
    const fyBody = fyFront * Math.cos(steerAngle) + fyRear + fyTrip;

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

    /* Scraping. Once the car is over far enough to be on its shoulder there are no tyres in
     * the picture at all, and `contact` has already taken away every force that could stop
     * it — so without this it would slide across the county on its roof. Panels on grass is
     * a lot of friction: this brings a 90 km/h flip to rest in about three seconds, which is
     * also what makes the automatic righting below happen while you are still watching. */
    const scrape = clamp01((tipMag - TIP.scrapeFrom * tipStatic) / (0.35 * tipStatic));
    if (!airborne && scrape > 0) {
      const k = Math.exp(-TIP.scrapeK * scrape * dt);
      vLong *= k;
      vLat *= k;
      this.yawRate *= k;
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

    /* ── attitude ────────────────────────────────────────────────────────
     * Three parts, and they are three because they behave completely differently:
     *
     *   the GROUND under the wheels — a constraint, not a force. The wheels are on it, so
     *     the body is on it, and it arrives instantly. Running it through the spring below
     *     is what made the car lag its way up a hill.
     *   the SPRINGS — dive, squat and lean. Second-order, rate-limited, cosmetic.
     *   the TIP — the body leaving the ground plane, which is a rollover.
     */

    /* THE LEAN SIGN. This was inverted and the car leaned into its corners like a
     * motorbike. Positive steer turns LEFT (input.js says so, and the tyre code agrees:
     * a positive steer angle makes a positive front slip force, and +X is the driver's
     * left). A left turn therefore has a positive lateral acceleration; the body leans
     * AWAY from it, onto its right; and the right side going down is the LEFT SIDE UP,
     * which _probeWheels explains is positive on rotation.z. So it follows _loadLat, not
     * minus it. The dive/squat sign underneath was always right — braking gives a negative
     * _loadLong and a positive, nose-down pitch. */
    const leanTarget = clamp(this._loadLat * this.spec.rollPerG, -BODY.rollClamp, BODY.rollClamp);
    const pitchTarget = clamp(
      this._loadLong > 0 ? -this._loadLong * BODY.squatPerG : -this._loadLong * BODY.divePerG,
      -BODY.pitchClamp,
      BODY.pitchClamp
    );
    const leanAcc = (leanTarget - this._lean) * BODY.rollOmega * BODY.rollOmega - this._leanV * 2 * BODY.rollZeta * BODY.rollOmega;
    this._leanV = clamp(this._leanV + leanAcc * dt, -BODY.rollRate, BODY.rollRate);
    this._lean += this._leanV * dt;
    const diveAcc = (pitchTarget - this._dive) * BODY.pitchOmega * BODY.pitchOmega - this._diveV * 2 * BODY.pitchZeta * BODY.pitchOmega;
    this._diveV = clamp(this._diveV + diveAcc * dt, -BODY.pitchRate, BODY.pitchRate);
    this._dive += this._diveV * dt;

    /* ── going over ──────────────────────────────────────────────────────
     * The tip DOF is the body's roll away from the plane its wheels are standing on, solved
     * as a rigid body pivoting about the outer contact line. Moment about that line, per
     * unit mass, with θ measured from flat:
     *
     *   M/m = (Fy/m)·(halfTrack·sinθ + h·cosθ) − g⊥·(halfTrack·cosθ − h·sinθ)
     *
     * At θ = 0 that reduces to (Fy/m)·h − g·halfTrack, which is the load-transfer ratio of
     * 1 that every rollover paper starts from: the tyre force tips it, the weight holds it
     * down. At Fy = 0 it changes sign at tanθ = halfTrack/h, the car's own balance point.
     *
     * Worth saying what is NOT in it: the bank. A car parked across a 30° slope does not
     * tip, and this equation agrees — the gravity term along the slope cancels against the
     * pseudo-force from the acceleration it causes. What rolls a car on a bank is the
     * sideways force of ARRIVING at it, which is `fyTrip`, and the rotation the bank itself
     * imparts, which is the rate term further down. */
    const halfT = this.track * 0.5;
    const hCg = this.spec.cgHeight;
    const iRoll = hCg * hCg + halfT * halfT; // moment of inertia about the contact line, per kg
    const gPerp = AIR.gravity * ny;
    /* The rate the ground is rolling the car at, tracked in every branch so that landing or
     * getting up never sees a step change in it that it then treats as a kick. Deadbanded,
     * because this is a difference of a terrain sample and it gets differenced again below:
     * a real bank taken at speed is 3 rad/s and the wobble of rough ground is a tenth of
     * that, and without the deadband that wobble is a random walk that eventually flips a
     * parked car. */
    this._gRate = damp(this._gRate, (this.groundRoll - this._prevGroundRoll) / dt, 22, dt);
    const gEff = Math.sign(this._gRate) * Math.max(0, Math.abs(this._gRate) - TIP.bankRate);
    if (this.rolled) {
      /* Committed. Past its balance point the tyres are off the ground and gravity is the
       * only thing with an opinion, so the same equation runs with Fy = 0 until the roof
       * arrives. Cozy rule: it always ends up on its roof and it always gets up again —
       * a car balanced on its side for ever is a stuck state, and this game does not have
       * those. */
      const s = Math.sign(this._tip) || 1;
      this._rollTimer += dt;
      if (!this._righting) {
        const m = Math.abs(this._tip);
        this._tipV += ((s * gPerp * (hCg * Math.sin(m) - halfT * Math.cos(m))) / iRoll) * dt;
        this._tip += this._tipV * dt;
        if (Math.abs(this._tip) >= Math.PI) {
          this._tip = s * Math.PI;
          this._tipV = 0;
        }
        const onItsRoof = Math.abs(Math.abs(this._tip) - Math.PI) < 0.2 && vMag < 2.5;
        // Either it has settled and had its moment, or it has been down long enough that
        // waiting any longer would just be the game holding you there.
        if ((onItsRoof && this._rollTimer > TIP.rightAfter) || this._rollTimer > TIP.rightMax) this._righting = true;
      } else {
        // Picking itself up. Deliberately not physical: a gentle rotation back the way it
        // came, over about a second and a bit, and you drive away.
        this._tip = damp(this._tip, 0, TIP.rightRate, dt);
        this._tipV = 0;
        // World velocity, not the body-space vLong/vLat — those were written back to
        // this.vx/this.vz sixty lines above and anything set here would never be read.
        this.vx *= 0.9;
        this.vz *= 0.9;
        this.yawRate *= 0.9;
        if (Math.abs(this._tip) < 0.04) {
          this._tip = 0;
          this.rolled = false;
          this._righting = false;
          this._rollTimer = 0;
        }
      }
    } else if (airborne) {
      /* In the air the body keeps the roll it left with. The ground can bank away underneath
       * it and the car cannot know, so the tip absorbs whatever the ground angle does — which
       * is also how a launch off a banked verge keeps rotating instead of landing flat. */
      this._tip -= this.groundRoll - this._prevGroundRoll;
      this._tip += this._tipV * dt;
    } else {
      /* THE BANK. A bank taken at speed does not merely tilt the car, it ROTATES it: the
       * near-side wheels are being lifted at v·tan(bank) and the whole body is turning at
       * that rate, which crossing a 22° verge at 50 km/h makes about 3 rad/s. While the
       * ground keeps supplying that rotation the body simply follows it — that is the
       * groundRoll term and nothing has happened. The moment the ground STOPS supplying it,
       * at the crest or as the wheels leave, the body still has it, and that leftover rate
       * is what actually puts cars on their roofs. So the tip picks up whatever rate the
       * ground gives back. The other direction — the bank steepening — pushes the body into
       * the hill, and the zero crossing below eats it, which is right: you cannot roll
       * uphill into a slope you are driving onto.
       *
       * This comes FIRST, before the torque below, because it decides which way the body is
       * going: a bank can start lifting a car whose tyres are pushing the other way, and if
       * the direction were taken from the tyre force alone the ground's rotation would be
       * deleted by the zero clamp on the very step it arrived. */
      this._tipV -= gEff - this._gRatePrev;

      // Which way it is going: the way it is already leaning; failing that, the way it is
      // already turning; failing that, the way the tyres are pushing it.
      const s = this._tip !== 0 ? Math.sign(this._tip) : Math.sign(this._tipV) || Math.sign(fyBody) || 1;
      const m = Math.abs(this._tip);
      const excess =
        ((s * fyBody) / this.mass) * (halfT * Math.sin(m) + hCg * Math.cos(m)) - gPerp * (halfT * Math.cos(m) - hCg * Math.sin(m));
      this._tipV += ((s * excess) / iRoll) * dt;

      // The dampers resist body roll — until a wheel actually lifts, at which point that
      // damper is topped out and has nothing left to push against.
      this._tipV -= this._tipV * TIP.damp * clamp01(1 - m / (TIP.liftFrom * tipStatic)) * dt;
      const next = this._tip + this._tipV * dt;
      // Crossing back through flat means the lifted wheels have landed. They do not bounce
      // the body past level — the far pair takes the load and the tip is simply over.
      if (next === 0 || Math.sign(next) !== s) {
        this._tip = 0;
        this._tipV = 0;
      } else this._tip = next;
      if (Math.abs(this._tip) > TIP.commit * tipStatic) {
        this.rolled = true;
        this._rollTimer = 0;
      }
    }
    this._gRatePrev = gEff;
    this._prevGroundRoll = this.groundRoll;

    /* What the renderer reads. The ground is in here at full weight — main.js used to add
     * 60% of it on top of these, with the pitch sign the wrong way round, and that is the
     * whole of the "car points into the hill" complaint. visualRollMul is applied to the
     * spring lean only, because exaggerating a rollover would put the car through the floor. */
    this.roll = this.groundRoll + this._lean * BODY.visualRollMul + this._tip;
    this.pitch = this.groundPitch + this._dive;

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

  /**
   * The plane the wheels are standing on, in the renderer's sign convention.
   *
   * DO NOT ADD THIS TO roll/pitch — they already contain it, at full weight. This used to
   * be a second set of terrain samples with the pitch sign the wrong way round, added at
   * 60% on top of the body attitude, which pitched the nose into every hill. It stays as a
   * read-only accessor because the answer is genuinely useful (the camera, a trailer, a
   * ghost car), and it is free now: the four wheel probes have already been taken this step.
   */
  groundTilt() {
    if (!this.terrain) return { pitch: 0, roll: 0 };
    // Stale after a teleport or a spell of frozen physics — re-probe rather than hand back a
    // tilt from wherever the car used to be. The threshold matters: the pose ALWAYS moves a
    // little between the probe and the end of the step, and re-probing on that would double
    // the cost of the whole solver for a difference of a centimetre.
    if (
      Math.abs(this.x - this._probedX) > 0.25 ||
      Math.abs(this.z - this._probedZ) > 0.25 ||
      Math.abs(angleDelta(this._probedYaw, this.yaw)) > 0.05
    )
      this._probeWheels();
    return { pitch: this.groundPitch, roll: this.groundRoll };
  }
}
