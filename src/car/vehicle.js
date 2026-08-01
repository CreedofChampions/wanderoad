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
  REVERSE,
} from './tuning.js';
import { clamp, clamp01, lerp, angleDelta, damp, hash2i } from '../core/math.js';
import { BIOME } from '../world/biomes.js';

/** Deterministic [-1,1] from a position — the bump field for loose surfaces. */
const noiseAt = (x, z) => (hash2i(Math.round(x), Math.round(z), 0x5eed) / 4294967296) * 2 - 1;

const TWO_PI = Math.PI * 2;

/** Ceiling on the loose-surface bump, in m/s² of vertical acceleration. See the loose-surface
 *  block in `_step` for the measurement this comes from; `tools/diag-bump.mjs` re-measures it.
 *  6 m/s² is 0.61 g — a firm shove through the seat, and short of the 1 g it would take to
 *  unload the suspension and put the car in the air. */
const BUMP_MAX_A = 6;

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
/** m/s below which a braked car is held still rather than allowed to creep — see the static-hold
 *  block at the end of _step. About 4 km/h: fast enough to catch the end of a stop, slow enough that
 *  it can never interfere with driving. */
/** Under this, a car that is not being asked to move is PARKED — 3 km/h, the operator's own
 *  number. STATIC_HOLD_SPEED below is the wider, brake-held band and is unchanged. */
const STOP_SPEED = 0.833;
const STATIC_HOLD_SPEED = 1.1;
/** 1/s at full brake. 9 kills a slow creep inside a couple of tenths without snapping the car. */
const STATIC_HOLD_RATE = 9;

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

/* Sand bogging, dunes only. Ordinary off-road (grass, gravel shoulder, highland scree) is
 * already "somewhat slower" — see the flat, onRoad-driven crr/offCap treatment below, which
 * this ADDS to rather than replaces. Loose DUNE sand is meant to be a different, much harsher
 * thing: the operator's own report was specific — sand "makes impossible drive offroad 10+
 * meters (slow/stuck)" for anything but the Rally.
 *
 * Modelled as a bog that builds with distance actually travelled off the made surface while
 * the ground is dune-dominant, not as a fixed penalty the instant a tyre leaves the
 * carriageway — a single wheel clipping the verge at the edge of a dune field should not feel
 * identical to a hundred metres of open sand. It drains just as physically: the moment the
 * worst wheel is back on a made surface the debt clears in a couple of seconds, so this can
 * never trap a player who has already found their way back to the road — R still works too.
 *
 * garage.js documents the Rally as "the only one that is genuinely happy off the tarmac" via
 * `feel.offRoad` (1.35 on the Rally, undefined -> 1 on the rest of the fleet), which was
 * declared and never read anywhere outside garage.js — the exact "numbers declared and never
 * applied" failure this project has already been bitten by twice. Wired here, narrowly: it
 * stretches the distance the Rally can cover before the bog reaches full severity, rather than
 * exempting it outright — a rally car outlasting the others by the margin its own brief
 * already claims, not a magic immunity flag. TYRE.offRoadMul is set by garage.js's
 * applyCarFeel(); code paths that never call it (bench-car.mjs's stub tier, most diag/bench
 * scripts) simply get the default of 1, i.e. the un-stretched distance. */
const SAND = {
  duneWeight: 0.5, // biome blend before dune sand counts as THE sand, not a light dusting
  bogDist: 7, // metres of off-road travel through dune sand to reach full severity
  recoverPerSec: 1 / 1.6, // fraction of bogDist cleared per second once back on a made surface
  /* Halved, on the operator's own instruction — "37 done (too strong, reduce by 50%)". The
   * dunes should be a place you regret leaving the road, not a tar pit. */
  crrBogged: 0.25, // rolling-resistance coefficient at full severity — deep loose sand
  capBogged: 4.6, // m/s off-road speed ceiling at full severity (~16.6 km/h, a slog, not a wall)
  vDragBogged: 350, // N per m/s at full severity — bleeds off a fast ENTRY speed; see the rr comment
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
    /** +1 / -1 for one frame when the driver asks for a gear. Consumed by the gearbox. */
    this.wantShift = 0;
    /** True once the driver has shifted by hand; the automatic stops deciding until autoGear(). */
    this.manual = false;
    this._shiftHold = 0;
    this._absPhase = 0;
    this._liftoff = 0;
    this._liftoffTimer = 0;
    this._airTime = 0;
    this._loadLong = 0;
    this._loadLat = 0;
    // The DISPLAYED ground-following roll/pitch — rate-limited copies of groundRoll/
    // groundPitch, see the "what the renderer reads" comment at the end of _step(). These
    // two fields were declared and never read (bench-car.mjs/diag-body.mjs both stayed
    // green with them permanently at 0) — repurposed rather than left dead a third time.
    this._smRoll = 0;
    this._smPitch = 0;
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
    /* Last step's ground height under the car, for the base-relative damper in _step(). `null`
     * means "no previous sample" — a fresh car, or one that has just been teleported — and the
     * damper reads a ground velocity of 0 rather than differencing two unrelated places. */
    this._prevGroundY = null;
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
    this.sag = 0; // current spring compression, metres — the renderer's ride-height correction
    /* Off-road, judged at the four contact patches rather than at the badge on the bonnet.
     * `onRoad` is the average — the rolling resistance and the speed ceiling deliberately
     * still read that one, because those are honestly proportional to how much of the car's
     * own footprint is on grippy ground (see the offCap comment below: "half a car on the
     * tarmac is still half a car on the tarmac"). `onRoadMin` is the worst wheel, and it is
     * the actual on/off-road STATE — one wheel off the tarmac means you are off, which is what
     * a driver feels. It always drove the tyre note; it now also gates the loose-surface grip
     * loss and the tripping risk, which used to read the average and were correspondingly
     * numb to a single wheel over the verge (three good wheels diluted a fourth one sitting
     * flat in the grass down to onRoad 0.75 — nowhere near either trigger).
     *
     * `game/streak.js` reads `onRoadMin` too now, AND-ed with its own centre-point terrain
     * sample (main.js still takes that separately) — a wheel-only excursion breaks the streak
     * the same way it trips the grip loss and tripping risk above. */
    this.onRoad = 1;
    this.onRoadMin = 1;
    this.offRoad = 0; // 0..1, how far off the made surface the worst wheel is
    this.wheelsOffRoad = 0;
    this.sandBog = 0; // 0..1, dunes-specific bog severity — see the SAND block above
    this._sandBogDist = 0; // metres travelled off-road through dune sand; feeds sandBog
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
    // A teleport (R, a fresh spawn) is a clean start, not a continuation of however bogged
    // the car was a second ago — matches R's existing job of always being a way out.
    this._sandBogDist = 0;
    this.sandBog = 0;
    /* edited by AI from here — and the same goes for the base-relative damper's ground sample.
     * Differencing the height under the NEW position against the height under the OLD one is
     * not a ground velocity, it is the distance teleported divided by a frame; the ±6 m/s clamp
     * in _step() bounds the damage but there is no reason to take the kick at all. */
    this._prevGroundY = null;
    this._probeWheels();
    this._prevGroundRoll = this.groundRoll;
    // A freshly placed car settles to the real ground attitude immediately — the rate limit
    // in _step() is for CHANGES while driving, not for the initial drop.
    this._smRoll = this.groundRoll;
    this._smPitch = this.groundPitch;
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
    // is applied further down, through the loose-surface block, which now reads the WORST
    // wheel — putting it in both places would charge for it twice.
    this.gripScale = surf ? surf.grip : 1;
    /* Where the WHEELS are. Everything downstream that used to ask the terrain about the
     * point under the driver's seat now asks the four contact patches instead: the car is
     * off-road when a wheel is off-road, not when the badge crosses the line. Clipping a
     * verge with the near side reads as half a car's worth of drag, bump and lost steering,
     * which is what it should cost. */
    this._probeWheels();
    const onRoad = this.onRoad;
    // The worst wheel, not the average: one wheel genuinely off the paved surface reads as
    // off on its own, undiluted by three others that are fine. Everything that has to answer
    // "is the car off the road" — the tyre note, the loose-surface grip loss and the tripping
    // risk below — gates on this, not on `onRoad`.
    const onRoadMin = this.onRoadMin;
    this.surfaceKind = onRoadMin > OFF_ROAD_AT ? (surf ? surf.surfaceKind : 'ground') : 'ground';

    /* ── dunes: sand that actually bogs you down ───────────────────────────
     * See the SAND block near the top of this file for the design reasoning. Gated on
     * `onRoadMin`, the same "is the car off the road at all" signal the loose-surface and
     * tripping blocks below now use, not the four-wheel `onRoad` average — a wheel genuinely
     * off the tarmac and into open sand is what this is about, not a straddled edge line.
     * `surf.w` is the SAME centre biome sample `gripScale` already read a few lines up; test
     * stubs that hand back a surface() with no biome weights (bench-car.mjs's FLAT world, most
     * diag/bench scripts) simply never gate this on, the same fallback the rest of this
     * terrain-optional file already uses for a missing field. */
    const duneW = surf && surf.w ? surf.w[BIOME.DUNES] : 0;
    /* A STOPPED car always recovers, even out in the sand. Operator: "Car forever slow when
     * touching sand". Bog is driven by distance travelled, so once it maxed out the 4.6 m/s
     * ceiling left no way to build the speed that would carry you out — the car was slow
     * because it was bogged and stayed bogged because it was slow. Below walking pace the
     * accumulator drains instead, so digging yourself out always works. */
    if (onRoadMin < OFF_ROAD_AT && duneW >= SAND.duneWeight && vMag > 1.5) {
      this._sandBogDist += vMag * dt;
    } else {
      this._sandBogDist = Math.max(0, this._sandBogDist - SAND.bogDist * SAND.recoverPerSec * dt);
    }
    // garage.js: 1.35 on the Rally via TYRE.offRoadMul, 1 (undefined -> the `|| 1` fallback)
    // on the rest of the fleet. Divides the whole ramp, not just its distance — dividing only
    // the distance (`dist / (bogDist * offRoadMul)`) would still walk the Rally to sandBog 1
    // eventually, just later, which measured as "also fully stuck by 25 m, a few metres after
    // everyone else" (tools/diag-sandbog.mjs) and reads as delaying the inevitable rather than
    // the fleet's own "genuinely happy off the tarmac". Dividing the ramp instead caps the
    // Rally's severity CEILING below fully bogged (1/1.35 ≈ 0.74) for any excursion, however
    // long — measurably still slowed, never stuck the way the rest of the fleet gets stuck.
    const offRoadMul = TYRE.offRoadMul || 1;
    this.sandBog = clamp01(clamp01(this._sandBogDist / SAND.bogDist) / offRoadMul);

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
    /* Ground collision for the ROLLED body, folded into `rideY` itself rather than bolted on
     * afterwards — see below for why that matters. The ordinary suspension above only ever
     * targeted `groundY + restLength`, which is right while the car stands on its wheels —
     * but model.js's chassis rotates the shell about the CONTACT PLANE, not the CG (`y = 0
     * is the contact patch` — see model.js's own header), and the shell itself sits entirely
     * ABOVE that plane, floor to roof. Nothing here ever stopped `_tip` swinging that shell
     * past vertical: at tip 180° the roof (locally ~roofMul × cgHeight above the plane) lands
     * roofMul × cgHeight BELOW it instead, which is the car sinking through the terrain by
     * about its own height — exactly "it should roll on the ground" instead.
     *
     * Uses `this._tip` alone (one step stale, the same lag `contact` below already accepts),
     * not the full `this.roll` — `groundRoll` is the ground the wheels are ACTUALLY on, so
     * the body tilting to match it is correct by construction and must stay free to do so on
     * an ordinary bank; it is only the EXTRA rotation away from that plane, `_tip`, that can
     * ever put part of the shell underground. Reuses `groundY`, already sampled above — no
     * second terrain query. Treats the shell as a box of half-width `halfTOut` (the track,
     * the same figure the tip solver's own torque equation already pivots about) and height
     * `BODY.roofMul * cgHeight`, and finds the lowest corner of that box once rotated by
     * `_tip` — the standard rotated-rectangle minimum, <= 0 and exactly 0 at tip 0.
     *
     * THE FIRST VERSION OF THIS clamped `this.y` in a separate step AFTER the block below,
     * against a floor still anchored to the flat `rideY`. It looked right in isolation and
     * broke rollover recovery badly: lifting `this.y` to clear the roof left it sitting well
     * above `rideY` from the NEXT step's point of view, which is exactly what `airborne`
     * below tests for — so a resting rollover read as permanently airborne, which zeroes
     * `contact`, which routes the tip solver into its airborne branch (no damping, no
     * righting torque) every single step. Measured: a 72 km/h flip that used to settle in
     * 3.07 s took 9.23 s and 346.9° of roll — it kept tumbling because the game genuinely
     * believed it was still in the air. Folding the lift into `rideY` itself fixes that at
     * the source: a car resting on its roof is exactly as "on the ground" as one resting on
     * its wheels, just at a different height, and `airborne` needs to agree. */
    const tipNow = this._tip;
    const sinTip = Math.abs(Math.sin(tipNow));
    const cosTip = Math.cos(tipNow);
    // 0.6x track, not 0.5x (half-track, what the tip solver's own torque equation above
    // uses): the drawn shell overhangs the wheels — measured against model.js's own hull
    // table, 0.92-1.03 m of half-width against 0.80-0.84 m of half-track, a fairly constant
    // ~12-19% margin across all three tiers. This is a collision half-width, not a pivot
    // distance, so it is allowed to differ from halfT below on purpose.
    const halfTOut = this.track * 0.6;
    const roofOut = BODY.roofMul * this.spec.cgHeight;
    const bodyLow = -halfTOut * sinTip - roofOut * Math.max(0, -cosTip); // <= 0, 0 when tip=0
    const rideYTip = rideY - bodyLow; // rises as the body rotates away from flat
    const gap = this.y - rideYTip;
    /* The vertical speed of the GROUND under the car — see the base-relative damper below,
     * which is the main reason this exists. Hoisted above `airborne` because the grounded band
     * uses it too. Clamped: `groundY` is a terrain sample, and a chunk seam or a teleport can
     * step it. ±6 m/s covers a 17% grade at 130 km/h, and a sweep of 4/5/6/8/12 measured 6 as
     * the best of them on tools/diag-carbody.mjs section 4 (8 and 12 turn a fast 22% descent
     * into a 1.4-1.9 m launch; 4 and 5 leave more of the pogo in). */
    const groundV = clamp(this._prevGroundY === null ? 0 : (groundY - this._prevGroundY) / dt, -6, 6);
    /* THE GROUNDED BAND, and why it is allowed to widen HERE and was not allowed to before.
     *
     * The suspension has 0.22 m of travel, so with the body up to that far above ride height
     * the wheels are still on the road, extended, gripping. A flat 0.06 m band cuts the spring
     * and every tyre force inside that range, and on a fast descent the ground recedes through
     * exactly it — which is the bounce. Widening the band to the droop range was tried and
     * REVERTED (`git show cdf1322`) for one specific reason: over water the probe's "ground" is
     * the LAKE BED, and a wide band let the spring chase it down.
     *
     * The difference is what the widening is gated on. It is not a constant and it is not a
     * surface-field lookup (the trap that made the last dry/wet gate silently read "dry" on a
     * fixture that did not supply the field). It is gated on the ground under the car ACTUALLY
     * RECEDING, which only happens because the car is TRAVELLING across falling terrain. A car
     * sinking straight down into a lake does not move horizontally, so the terrain height under
     * it is not changing, so `groundV` is ~0 and the band stays at its original 0.06 m — the
     * water case gets the old behaviour by construction rather than by a flag. bench-boat's
     * barrier reads 0.25 m against its 1.0 m bar, unchanged from before this whole round. */
    const band = 0.06 + clamp01(-groundV / 5) * (SUSPENSION.travel - 0.06);
    const airborne = gap > band;
    this.onGround = !airborne;

    // Vertical: a spring to the ride height plus gravity, with the suspension travel
    // clamped so a hard landing bottoms out instead of passing through the ground.
    let g = AIR.gravity;
    if (airborne) {
      this._airTime += dt;
      // Wheels droop toward full extension in the air — ease the render correction out too.
      this.sag += (0 - this.sag) * Math.min(1, dt * 6);
      // TDU's own trick: extra downward acceleration once a wheel leaves the ground, so
      // landings settle instead of pogoing. Hardcore removes it, which is exactly why
      // hardcore cars famously launch off crests.
      /* edited by AI from here — NO SETTLING DELAY ON A HOP.
       * `AIR.extraDelay` exists so a deliberate jump off a crest gets its moment of air before
       * the assist starts pulling the car down. A descent pogo is not that: it is a rapid train
       * of hops of a few centimetres, each one shorter than the delay, so the assist never
       * armed at all and the thing it was written for — "landings settle instead of pogoing" —
       * never happened. Inside 0.2 m of the road there is no jump to protect, so the delay is
       * skipped and the assist ramps from the first frame. Nothing is added that was not
       * already there: the ceiling stays AIR.extraMax (1 g on top of gravity), the ramp stays
       * AIR.extraRamp, and hardcore still switches the whole thing off through `A.airborne`.
       * This is deliberately NOT the reverted 3.2 g suction (`git show b3e6ef4`) that dragged
       * the car into lake beds — bench-boat's barrier is unmoved at 0.25 m against its 1.0 m
       * bar, the same number it read before this change. */
      const delay = gap < 0.2 ? 0 : AIR.extraDelay;
      if (A.airborne > 0 && this._airTime > delay) {
        const k = clamp01((this._airTime - delay) / AIR.extraRamp);
        g += AIR.gravity * lerp(AIR.extraMin, AIR.extraMax, k) * A.airborne;
      }
      this.vy -= g * dt;
    } else {
      this._airTime = 0;
      const compression = clamp(rideYTip - this.y, -SUSPENSION.travel, SUSPENSION.travel);
      /* Exposed for the renderer. At steady state the springs sit m·g/(4k) below rest — about
       * ten centimetres — and main.js used to place the model at (y - restLength) as if the
       * springs were uncompressed, which sank the tyres that far into the road. The operator
       * saw it twice: "all 4 wheels touch road" and "wheels are often clipping right through
       * the ground", and a screenshot shows the car on its belly. The render offset must use
       * the ACTUAL ride height, which is restLength minus this. */
      this.sag = compression;
      const springA = (SUSPENSION.stiffness * 4 * compression) / this.mass;
      /* edited by AI from here — THE DAMPER IS BASE-RELATIVE, which is what a damper is.
       *
       * A suspension damper resists the velocity ACROSS itself: the body's velocity minus the
       * WHEEL's, and the wheel is on the ground, so on a road that is falling away underneath a
       * moving car the ground itself has a vertical velocity. This term used to read `-this.vy`
       * — the body's velocity in the WORLD — so on a descent it fought the very motion the car
       * needs to make in order to stay on the road. At 128 km/h down a 14% grade the ground
       * recedes at 5 m/s, and 4 x 4200 N.s/m against 5 m/s is 58 m/s² of upward acceleration,
       * six gravities, applied for doing exactly the right thing. The car got shoved back up,
       * cleared the 0.06 m grounded band, lost the spring entirely, fell, landed, and got shoved
       * up again: measured 73.0% of frames airborne, 169 bounce cycles in 25 s and 15.6 cm of
       * daylight under the tyres (`node tools/diag-carbody.mjs` section 4). That is the
       * operator's "bouncing down hill" GIF.
       *
       * WHY THIS IS NOT THE FIX THAT WAS REVERTED (`git show b3e6ef4`). That one ADDED a
       * downward force — 3.2 g of "suction" toward whatever the probe called ground — and over
       * a lake the probe's ground is the LAKE BED, so it dragged the car down into it and
       * bench-boat's barrier went 0.97 m -> 1.13 m deep against a 1.0 m bar. This adds no force
       * at all in either direction; it only stops the damper from RESISTING ground-following,
       * and it is exactly zero whenever the ground under the car is not moving — which is the
       * case for a car sinking vertically, because `groundV` is the rate the terrain height
       * under the car changes, and a car going straight down does not change where it is.
       *
       * Clamped, because `groundY` is a terrain sample and a chunk seam or a teleport can step
       * it: ±6 m/s covers a 17% grade at 130 km/h and cannot inject an impulse worth having. */
      const dampA = (SUSPENSION.damping * 4 * (groundV - this.vy)) / this.mass;
      this.vy += (springA + dampA - g) * dt;
      // A landing must not launch the car back up: kill upward rebound above 2 m/s.
      if (this.vy > 2) this.vy = 2;
    }
    this.y += this.vy * dt;
    if (this.y < rideYTip - SUSPENSION.travel) {
      this.y = rideYTip - SUSPENSION.travel;
      if (this.vy < 0) this.vy = 0;
    }
    // For next step's base-relative damper. Set unconditionally, airborne included, so a
    // landing does not difference against a stale sample from before the jump.
    this._prevGroundY = groundY;

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
    /* And the car's OWN ceiling — see TYRE.topFadeFrom. Smoothstepped rather than clamped so
     * it eases in over the last quarter of the range instead of switching on at a threshold;
     * a step here would read as a bug, and the whole point is that it should read as the car
     * going light. `S.topSpeed` is km/h, hence the /3.6. */
    const vTop = (this.spec.topSpeed || 200) / 3.6;
    const tf = clamp01((vMag / vTop - TYRE.topFadeFrom) / (1 - TYRE.topFadeFrom));
    const topEase = tf * tf * (3 - 2 * tf);
    const topFadeF = 1 - TYRE.topFadeFront * topEase;
    const topFadeR = 1 - TYRE.topFadeRear * topEase;
    const cap = this.muCapAwd ? TYRE.awdCap : 1e9;
    const muF = Math.min(TYRE.muLatFront, cap) * this.gripScale * speedFade * topFadeF;
    const muR = Math.min(TYRE.muLatRear, cap) * this.gripScale * speedFade * topFadeR * (1 - this._liftoff) * hbMu;

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
    /* ── MANUAL GEARS ────────────────────────────────────────────────
     * Operator: "Maual gear shift needs to eb added".
     *
     * `shiftUp` and `shiftDown` have been in the key map since the beginning and were read by
     * NOTHING — tuning.js says so itself in its own note beside `autoGears`, which is why the
     * hardcore assist was a debt rather than a mode: turning the automatic off left the car stuck in
     * first with no way to change gear.
     *
     * `manual` latches the moment the driver asks for a gear. That is the whole switch: there is no
     * mode to find in a menu, no state to explain. Ask for a gear and you have a manual box; the
     * automatic stops making decisions for you. `autoGear()` (the R key's reset, and the assist
     * preset) hands it back.
     *
     * The redline is still respected on the way up and the box still refuses a downshift that would
     * over-rev — a manual gearbox lets you choose, it does not let you grenade the engine. */
    if (this.wantShift) {
      const next = this.gear + this.wantShift;
      const ratio = next >= 1 && next <= S.ratios.length ? S.ratios[next - 1] * S.finalDrive : 0;
      const rpmAfter = ratio ? Math.abs(wheelOmega) * ratio * (60 / TWO_PI) : 0;
      if (next >= 1 && next <= S.ratios.length && rpmAfter < S.redline * 1.02) {
        this.gear = next;
        this.manual = true;
        this._shiftTimer = GEARBOX.shiftTimeAuto;
        this._shiftHold = 0.35;
      }
      this.wantShift = 0;
    }

    if (A.autoGears && !this.manual && this._shiftTimer <= 0 && this._shiftHold <= 0 && !this.reverse) {
      const upAt = curveAt(GEARBOX.upshiftAtThrottle, this.throttle) * S.redline;
      /* HOLD THE GEAR ON A CLIMB — the other half of low range. Without this the box drops a gear on
       * the hill, the revs recover, it immediately shifts back up, and bogs again: the shuffle a real
       * automatic avoids by locking out top gears while the load is high. */
      const holdForClimb = slopeLong < -1.6 && this.throttle > 0.5 && this.rpm < S.redline * 0.94;
      if (this.throttle > 0.06 && this.rpm > upAt && this.gear < S.ratios.length && !holdForClimb) {
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
        /* KICKDOWN, and this is what "the car cannot go up hills" actually was.
         *
         * Operator: "Starter car cant go up many hills" and "Slow cars like truck right now cant go
         * up mountains -- should be the best at it."
         *
         * The two triggers above are BOGGING (the engine has fallen off the bottom) and COASTING
         * (the driver lifted off). Neither fires on a hill with the throttle pinned. Traced: the
         * Estate entering an 18-degree tarmac climb at 66 km/h HOLDS SIXTH for six full seconds
         * while bleeding to 23 km/h, making 1697-1905 N against 4383 N of gravity, and only drops a
         * gear at 7.5 s. It never bogs, because sixth at 23 km/h is still 2110 rpm — above the
         * 1710 rpm floor. So the car simply grinds to a halt in the wrong gear with the pedal flat.
         *
         * A real automatic kicks down when you ask for everything and it is losing ground. That is
         * exactly this test: full throttle, and either actually decelerating or on a real slope.
         * Nothing else about the box changes. */
        const kickdown =
          this.throttle > 0.8 && (this.longAccel < -0.3 || slopeLong < -1.0) && rpmIfDown < S.redline * 0.95;
        /* LOW RANGE. Operator: "low range uphill for auto gear".
         *
         * Kickdown gets the box DOWN a gear when the hill starts winning. Low range is the other
         * half: on a real climb it should also stop shuffling back UP the moment the revs recover,
         * because upshifting mid-hill just bogs the engine again two seconds later. `climbing` is
         * used below to hold the gear, and it also lets the box drop one further than the bogging
         * rule alone would — which is what a transfer case does. */
        const climbing = slopeLong < -1.6 && this.throttle > 0.5;
        const lowRange = climbing && rpmIfDown < S.redline * 0.86;
        if (rpmIfDown < S.redline * 0.92 && (bogging || coasting || kickdown || lowRange)) {
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
    /* Reverse should not need a gear key. Hold the brake with the car stopped — or slowed
     * right down — and it backs up; touch the throttle and it goes forward again. "The
     * ability to stop, turn around and change direction is key" — and on a keyboard the
     * cheapest way to make that true is to let the pedals mean what they obviously mean. */
    /* THE DEADLOCK THIS ONCE CAUSED, because it is not obvious from the code:
     * the auto-pilot brakes at 0.35 when it cannot find a road, which tripped this test and
     * put the car in reverse. Reverse then only cleared when the car was moving forwards —
     * but it was now crawling backwards, so it never cleared, and the auto-pilot sat at full
     * throttle driving gently the wrong way for ever. It reported as "stopped moving" and
     * cost two rounds of guessing at the wrong subsystem.
     *
     * Two fixes. The auto-pilot's own input never engages reverse — a chauffeur that decides
     * to reverse is not a chauffeur. And throttle clears reverse whenever the car is holding
     * the throttle at all, whichever way it happens to be moving. */
    /* THE ARMING COMPLEXITY THIS USED TO HAVE, and why it is gone: an earlier version required
     * the brake pedal to be RELEASED and freshly RE-PRESSED (an edge-triggered `_brakeWasOff`
     * latch) before reverse was allowed to engage, specifically so that an ordinary hard stop —
     * brake held from speed straight through to a standstill — would not roll into reverse.
     * That is precisely the operator's own complaint: "the gear system forces you into reverse
     * but then you can't move... Tapping multiple times sometimes works. It should be simple:
     * push and hold S to reverse." Measured on the unmodified code
     * (tools/diag-reverse.mjs): holding S continuously from 50 km/h braked the car to a dead
     * stop and then just sat there forever, because by the time `vLong` caught up to the arm
     * speed the latch had already been consumed by the same held press — reverse could only
     * ever engage by releasing S and pressing it again once slow, which is exactly the
     * "tapping" workaround being reported. So the latch is gone: reverse is now a plain,
     * every-step read of the pedals and the speed, no memory of what the pedal was doing a
     * moment ago, no B-key arming step, nothing to get stuck.
     *
     * THE TRADE THIS MAKES, said plainly: `tools/diag-c2-repro.mjs` and the browser suite's own
     * C2 ("the brakes stop the car promptly") hold S continuously for 6 s from over 45 km/h and
     * want the car to end under 3 km/h — i.e. stopped and STAYING stopped under a held brake,
     * which is now false: a hard stop held on S will brake to a standstill and then back up,
     * on purpose, because that is what "push and hold S to reverse, period" means. C2 was built
     * to stop the OLD failure (a stop that rolled backwards by accident on a single tap); it now
     * measures the NEW, deliberately-requested behaviour and will read as a regression unless
     * its own threshold is updated to expect reverse after a held stop — flagged here rather
     * than silently landing a check the operator's own words describe as wrong. */
    /* edited by AI from here — THROTTLE CLEARS REVERSE UNCONDITIONALLY, auto-drive included.
     * The comment above states the rule as "throttle clears reverse whenever the car is
     * holding the throttle at all, whichever way it happens to be moving", but the clear was
     * inside the `!input.auto` guard, so it could never run while the chauffeur was driving —
     * and the chauffeur's own input never engages reverse either, so a `reverse` latched by
     * the PLAYER before pressing G could never be cleared by anything. Measured live
     * (headless Chrome, seed 20260726): hold S from 70 km/h to a standstill (which arms
     * reverse, by design), press R, then press G — auto-drive reports on, throttle 1.0, and
     * the car sits at 0.0 km/h for 10.5 s. That is the exact deadlock the comment above says
     * was fixed, and it is what fails the browser suite's "G engages auto-drive and it
     * drives" (0.3 km/h) and, downstream of the car being left off the road by it, "the road
     * streak accumulates" (0 m). Reverse is still only ARMED by a real player's brake — that
     * half stays inside the guard, so "a chauffeur that decides to reverse is not a
     * chauffeur" still holds. */
    if (this.throttle > 0.1) {
      // W always means forward. An immediate, unconditional override — no speed gate, no
      // delay — because "press W while reversing" has to work the instant it is pressed.
      this.reverse = false;
    }
    if (!input.auto) {
      if (this.throttle > 0.1) {
        /* handled unconditionally above */
      } else if (this.brake > 0.05) {
        // S means reverse once the car is at or near a standstill — or already reversing, in
        // which case it just keeps going, however fast the reverse governor has it moving.
        if (this.reverse || Math.abs(vLong) < REVERSE.armSpeed) this.reverse = true;
        // else: still rolling forward faster than the arm speed — this is an ordinary brake
        // pedal, not a request to reverse yet. The brake block further down does the stopping.
      }
      // Neither pedal held: leave `this.reverse` exactly as it was. Coasting with the flag set
      // does nothing on its own (driveForce is only routed through the reverse block below
      // once the brake is pressed again), and this is also what lets the B-key alias in
      // main.js (`car.reverse = !car.reverse`) survive a step without being clobbered here.
    }
    if (this.reverse) {
      // In reverse the brake IS the accelerator, and reverse is deliberately slow.
      /* REVERSE PUSH. Operator: "Going in reverse is super slow."
       *
       * Measured before this change: 1300 N flat against 1520 kg is 0.86 m/s2, so 0-20 km/h took
       * 7.6 seconds — the same car does 0-60 km/h FORWARD in 5.4 s. Reverse was 3.5x weaker off the
       * line. The old figure had no gearing, no torque curve and no car in it at all; it was a
       * literal, and `Math.abs(driveForce)` is always 0 here because reversing means the throttle is
       * shut, so the Math.max never chose it.
       *
       * REVERSE.force/scale live in tuning.js now, so the reverse "engine" is tunable like the rest.
       * This raises the push, NOT the top speed: the ~26.7 km/h terminal is set by the taper below,
       * and is left exactly where it was. */
      let rev = Math.max(Math.abs(driveForce), this.brake * REVERSE.force) * REVERSE.scale;
      /* THE BUG THIS ONCE WAS: reverse engaged (the flag went true) but the car barely
       * moved — "just go in reverse gear" rather than actually reversing. Measured with a
       * scripted hold-S trace: engine braking alone is ~1666 N at idle rpm in a low gear,
       * comfortably more than the ~1300 N this push tops out at, so the car oscillated
       * around 0 m/s forever, net force flipping sign every step as `Math.sign(vLong)` in
       * the engine-braking and rolling-resistance terms flipped with it. The standard brake
       * caliper force (further down) would have piled on top of that too, at up to ~15x this
       * push, the moment reverse speed ever cleared 0.2 m/s. Reversing needs its OWN honest
       * top-speed governor instead — see REVERSE below — with the mechanisms built for
       * "the driver has lifted off" (engine braking) and "the driver is braking" (the pedal
       * block) both told the driver is doing neither: they are accelerating, backwards. */
      const revSpeed = -vLong; // positive once actually moving backwards
      if (revSpeed > REVERSE.maxSpeed - REVERSE.taperBand) {
        rev *= clamp01((REVERSE.maxSpeed - revSpeed) / REVERSE.taperBand);
      }
      driveForce = -rev;
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
    // Skipped while reversing: `this.brake` is the reverse throttle there (see the reverse
    // block above), not a request to stop. This block does not know the difference — it
    // always opposes whatever `vLong` is doing, which once the car is actually moving
    // backward means opposing the reverse motion itself, at up to ~15x the reverse push. See
    // the "THE BUG THIS ONCE WAS" comment above for the measured trace.
    if (!this.reverse && this.brake > 0.001 && vMag > 0.2) {
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
    let offCap = lerp(12.2, 200, clamp01(onRoad * 1.4)); // 44 km/h off the carriageway
    /* ── THE BOG ONLY BITES WHERE THE SAND IS ─────────────────────────────────
     * Operator, playing the beta: "dunes off roading shuts off car when on-road".
     *
     * Exactly right, and it is this: the bog is a DEBT that builds with distance through dune sand
     * and drains over about 1.6 s once you are back on a made surface (see SAND). Draining is the
     * correct model — but the debt's PHYSICS were applied regardless of what was under the tyres at
     * the time, so for those one and a half seconds a car back on tarmac was still carrying
     * crrBogged 0.25 and vDragBogged 350 N per m/s. At 10 m/s that is 3500 N of drag on a road
     * surface, which does not feel like sand on your tyres, it feels like the engine cutting out.
     *
     * So the severity is scaled by how far OFF the road you actually are. `onRoad` is the four-wheel
     * average and it is the right number here rather than the worst wheel: two wheels on the tarmac
     * really is half as bogged. On the road it is zero and the bog is invisible, which is what a
     * road is for; out in the sand it is unchanged. The debt still drains at the same rate, so
     * digging yourself out still works exactly as it did. */
    const bogHere = this.sandBog * (1 - clamp01(onRoad));
    // Dunes: a bogged car does not merely have a lower ceiling, it barely moves. See SAND.
    if (bogHere > 0) offCap = lerp(offCap, SAND.capBogged, bogHere);
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
    /* Raised, with numbers. O2 ("off-road is meaningfully slower than tarmac": off-road top
     * must be under 55% of the on-road top) was failing at 0.145/9.5 — measured over eight
     * real sites by tools/diag-o2.mjs: 41.5 km/h off against 63.2 on, which is 66%, so grass
     * was costing a fifth of the speed rather than being a real decision. Shorter final drives
     * (see tuning.js) had also handed the wheels more torque to push through it with.
     *
     * Swept on the same eight sites rather than guessed: 0.190/14.0 -> 36.4 km/h (2/8 pass),
     * 0.205/16.5 -> 32.5 (6/8), 0.220/17.5 -> 21.2 (8/8 but a crawl), 0.250/20.0 -> 14.2 (8/8,
     * far too punishing to drive onto a verge at all), 0.248/19.6 -> 12.0 (a cliff: a 7% change
     * in the coefficients halved the terminal speed, because drive force and resistance meet on
     * a steep part of the torque curve down there). 0.236/18.7 -> 19.4 km/h, 8/8, is where
     * the rule is met
     * on every site and the car can still be driven off the tarmac on purpose — which it has
     * to be, because petrol-station forecourts are off-road surfaces. */
    /* THE CAR'S OWN OFF-ROAD ABILITY, which until now reached the grip model and nothing else.
     * Operator: "Truck should do better offroad too". Rolling resistance off the tarmac is 3519 N
     * against 4594 N of drive — it eats 77% of the engine — so a car that is "good off-road" has to
     * be given relief HERE or the badge means nothing. 1 for every car that has no `offRoad`. */
    const offMul = TYRE.offRoadMul || 1;
    let crr = lerp(0.236 / offMul, 0.014, clamp01(onRoad));
    // Dunes: piled sand in front of the wheels, not just a looser surface. See SAND above.
    // Deliberately small next to vDrag below — a constant force alone cannot bleed off a fast
    // ENTRY speed within a few metres, it can only stop the car from creeping once it is
    // already slow; the SPEED-PROPORTIONAL term is what actually does the "impossible to
    // drive at speed" part.
    if (bogHere > 0) crr = lerp(crr, SAND.crrBogged, bogHere); // bogHere, not sandBog — see the note by offCap
    let vDrag = lerp(18.7 / offMul, 1.4, clamp01(onRoad));
    /* The speed-proportional half of off-road resistance is what a car arriving off the
     * tarmac at speed actually decelerates against — the constant term above is too small at
     * 19 m/s to matter (a few tenths of a m/s²) and only bites once the car is already slow.
     * Measured directly (tools/diag-sandbog.mjs): at the ordinary off-road coefficient (9.5)
     * a car entering dune sand at 70 km/h was STILL doing 63 km/h ten metres later — no
     * different from an ordinary verge, and nothing like "impossible to drive". Scaling this
     * coefficient by severity instead of (or as well as) `crr` is what makes the resistance
     * GROW with speed, so a fast entry gets punished hard while a genuine crawl under gentle
     * throttle still settles at a real, non-zero speed (never a hard wall) once drive force
     * and drag reach equilibrium. */
    if (bogHere > 0) vDrag = lerp(vDrag, SAND.vDragBogged, bogHere);
    const rr = crr * this.mass * AIR.gravity * Math.sign(vLong) + vDrag * vLong;
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
     * by a quarter throttle, which is what lets a light foot hold a speed.
     *
     * While reversing, `this.brake` IS the throttle (see the reverse block above) — reading
     * `this.throttle` here instead, which is genuinely 0 whenever the driver is holding the
     * reverse pedal, is what made engine braking fight the reverse push at full strength
     * regardless of how hard that pedal was held. Easing off the reverse pedal brings engine
     * braking back in proportionally, the same as easing off the throttle does going forward. */
    const effectiveThrottle = this.reverse ? this.brake : this.throttle;
    const closed = Math.max(0, 1 - effectiveThrottle * 4);
    /* The 95 N.m that used to sit here was a flat constant, and a flat constant stopped being
     * right the moment the fleet's engines were shrunk (peakTorque 235 -> 108 on the GT) and
     * their final drives shortened (4.1 -> 7.9) to match the halved top speeds. Engine braking
     * is multiplied by `ratio`, which includes the final drive, so those two changes together
     * doubled the retardation of an engine that had also become half the size — a lifted foot
     * pulled 3.9 m/s2 where the brief for coasting is under 3.0, and tools/bench-fuel.mjs's
     * "running dry is gentle" section caught it.
     *
     * Engine drag is a property of the ENGINE, so it scales with the engine: a fixed fraction
     * of that car's own peak torque. 0.235 is chosen so the hypercar, whose torque and gearing
     * were both deliberately left alone, keeps exactly the braking it had (405 x 0.235 = 95.2),
     * while the two cars that were slowed get drag in proportion to what they now make. */
    const engBrake =
      this._shiftTimer > 0
        ? 0
        : closed * (S.peakTorque * 0.235) * (0.3 + 0.7 * rpmFrac) * (ratio / S.wheelRadius) * Math.sign(vLong) * contact;

    /* Loose surface. Off the carriageway the car should feel like it is on gravel — bumpy,
     * reluctant to turn, and unwilling to build speed. The bump is a real vertical impulse
     * from a hash of the position, so it is deterministic and it shakes the camera and the
     * suspension the way a rough surface would.
     *
     * Gated on the WORST wheel, not the four-wheel average. The average diluted a single
     * wheel sitting flat in the grass (onRoad 0) against three still on tarmac down to 0.75 —
     * nowhere near the 0.6 line below, so a wheel could hang off the verge all day and cost
     * nothing. A driver does not average their tyres; the one that is off is off.
     *
     * THE BUMP IS AN ACCELERATION AND IT IS NOW BOUNDED — measured, `tools/diag-bump.mjs`.
     * `0.055 * dt * 60` is `3.3 * dt`, so the old line was a vertical acceleration of
     * `wob * loose * vMag * 3.3` m/s²: at this car's own off-road terminal speed of 12.2 m/s
     * that is 40 m/s², FOUR GRAVITIES, and `wob`'s dominant half is a hash of `x * 0.31`,
     * which only changes value every 1/0.31 = 3.2 m — a quarter of a second at that speed. A
     * quarter of a second of net UPWARD acceleration at 4 g is not a bump, it is a launch, and
     * that is exactly what it did: on DEAD FLAT, LEVEL ground with the terrain contributing
     * nothing at all, a straight off-road run spent 23% of its time genuinely airborne and got
     * 0.60 m of air. A car in the air has no tyres on anything, so it does not steer, it does
     * not brake and it does not turn — which is how "C3 you can stop and turn around" came to
     * read 61 deg: the U-turn was being attempted by a car that was off the ground for a third
     * of it (`tools/diag-c3-turn.mjs`, `ground 0` in the trace).
     *
     * So the shake stays and the flight goes. Same term, same units, same `* dt` — this is a
     * CLIP on it, not a rescaling, so it is still exactly as frame-rate independent as it was
     * and everything below 6 km/h is bit-for-bit unchanged (a full-amplitude `wob` only
     * reaches the ceiling at 1.8 m/s, and the field is rarely at full amplitude). Above that
     * only the peaks are shaved, at 0.61 g — a firm shove through the seat, and short of the
     * 1 g it would take to unload the springs and put the wheels in the air. Nothing else in
     * the block changes: the same hash, the same deterministic field, the same steering and
     * grip penalties. */
    if (contact && onRoadMin < 0.6) {
      const loose = 1 - onRoadMin;
      const wob =
        noiseAt(this.x * 0.31, this.z * 0.31) * 0.6 + noiseAt(this.x * 1.13 + 11.7, this.z * 1.13 - 4.2) * 0.4;
      const bumpA = wob * loose * Math.min(vMag, 24) * 3.3;
      this.vy += clamp(bumpA, -BUMP_MAX_A, BUMP_MAX_A) * dt;
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
    if (contact > 0 && onRoadMin < 0.75 && Math.abs(vLat) > TIP.digFrom) {
      const loose = clamp01((0.75 - onRoadMin) / 0.75);
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
    //
    // THE THIRD PLACE the reverse bug was hiding: `effectiveThrottle`, not `this.throttle` —
    // while reversing, `this.throttle` is genuinely 0 (the driver's foot is on the brake,
    // which is the accelerator in reverse), so this fired on every single step at walking
    // pace and multiplied vLong by 0.9 a step, a 90%-a-frame bleed that a modest ~1300 N
    // reverse push cannot outrun. Measured: reverse settled at a permanent 0.06 m/s (0.2
    // km/h) — technically moving, in no sense "driving backwards" — until this line also
    // read the reverse pedal as what it is.
    if (vMag < 0.25 && effectiveThrottle < 0.02 && Math.abs(slopeLong) < 0.55) {
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

    /* ── A BRAKED CAR STAYS PUT ─────────────────────────────────────────────
     * Operator: "When you stop the car it should not slide sideways".
     *
     * The solver has rolling resistance and tyre forces but no STATIC friction, so at a standstill
     * nothing holds the car against gravity — it just has very little moving it. On flat ground that
     * is invisible (measured: 0.054 m of drift after stopping, and zero lateral velocity). On a
     * slope it is not: parked on a real 26% grade with the FOOTBRAKE HELD, the car still travelled
     * 0.72 m in six seconds, and 1.79 m with no input. A real brake holds a car on a 26% grade.
     *
     * So below STATIC_HOLD_SPEED, with the brake or handbrake applied and no throttle, both velocity
     * components are pulled hard to zero. Deliberately NOT applied when coasting with no input —
     * a car in neutral genuinely does roll down a hill, that behaviour is tested elsewhere
     * (tools/bench-slope.mjs "rolls back on a 20° slope"), and the operator's complaint is about
     * stopping, not about parking in neutral.
     *
     * Nor while REVERSING: holding the brake at a standstill is how this game reverses (see the
     * reverse block above), so freezing a car that is trying to back out of somewhere would be a
     * far worse bug than the one being fixed. */
    {
      const held = Math.max(this.brake || 0, this.handbrake || 0);
      /* THE REVERSE PEDAL COUNTS AS WANTING TO GO. Without this the stop below would pin the car at
       * a standstill the instant it tried to reverse, because reversing IS holding the brake. */
      const wantsGo = (this.throttle || 0) > 0.02 || (this.reverse && (this.brake || 0) > 0.05);

      /* BELOW 3 KM/H, STOP. Operator: "Stopping means you side down hill or sideways -- below 3 km =
       * stop moving."
       *
       * The hold below this only ran when the brake or handbrake was DOWN (`held > 0.3`), so a
       * player who simply lifted off and rolled to a stop got no static friction at all — there is
       * none anywhere else in the solver, by its own admission. What actually held a parked car was
       * engine braking, by accident, and on a slope that is not enough: gravity along the hill keeps
       * injecting acceleration and the car creeps or crabs away.
       *
       * So this is unconditional on input: if you are not asking to move and you are under 3 km/h,
       * you are parked. Both components and the yaw rate, because a car that stops but keeps rotating
       * is worse than one that rolls. The braked case stays STRONGER (rate scaled by `held`), so
       * nothing about braking got weaker. */
      const creeping = !wantsGo && Math.hypot(vLong, vLat) < STOP_SPEED;
      if (creeping) {
        const k = Math.exp(-STATIC_HOLD_RATE * dt);
        /* TRANSLATION ONLY. The first version damped `yawRate` here too, on the reasoning that a car
         * which stops but keeps rotating is worse than one that rolls — and it broke turning round:
         * the browser suite's C3 fell to 92 degrees of a required 100, because a three-point turn
         * happens almost entirely below 3 km/h and this was quietly eating the rotation the driver
         * was asking for. The complaint was that a stopped car SLIDES, which is about where it is,
         * not about which way it faces. */
        vLong *= k;
        vLat *= k;
        if (Math.abs(vLong) < 0.02) vLong = 0;
        if (Math.abs(vLat) < 0.02) vLat = 0;
      }
      if (held > 0.3 && !wantsGo && Math.hypot(vLong, vLat) < STATIC_HOLD_SPEED) {
        const k = Math.exp(-STATIC_HOLD_RATE * held * dt);
        /* LATERAL ALWAYS, longitudinal only when not reversing — and the split is the whole point.
         *
         * Holding the brake at a standstill is how this game REVERSES (see the reverse block above),
         * so `this.reverse` is true in exactly the situation the operator is complaining about, and a
         * blanket guard on it disabled this fix entirely: the first version changed the measured
         * slide by 0.00 m. But "slides sideways" is a LATERAL complaint, and a car never slides
         * sideways under braking whichever way it is going. So the across-the-car component is always
         * killed, and only the along-the-car one waits for the driver to stop asking for reverse. */
        vLat *= k;
        if (Math.abs(vLat) < 0.02) vLat = 0;
        if (!this.reverse) {
          vLong *= k;
          if (Math.abs(vLong) < 0.02) vLong = 0;
        }
      }
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
    /* edited by AI from here — THE LEAN UNITS. `rollPerG` is DEGREES of body roll per g: 3.4
     * on the grand tourer, 2.5 on the sports car, 1.7 on the hyper, which are textbook
     * roll-gradient figures for those three kinds of car. It was being multiplied straight into
     * a RADIAN angle, i.e. consumed as 3.4 rad/g = 195°/g, and every neighbouring constant in
     * the same block converts explicitly (`divePerG: (1.6 * Math.PI) / 180`) — this one was the
     * only raw number in the table.
     *
     * What that cost, measured with `node tools/diag-carbody.mjs` section 1 before the fix:
     * the drawn lean SATURATED at its 5.5° clamp (7.15° after visualRollMul) at 0.030 g on the
     * GT, 0.040 g on the sports car, 0.055 g on the hyper — a twitch of the wheel, not a
     * corner. So the body was not leaning proportionally to anything; it was a bang-bang switch
     * slammed hard left or hard right by the sign of a filtered lateral acceleration that
     * ordinary steering corrections flip several times a second. That is precisely "car still
     * wobbles left to right immensely, like a scooter" / "still like motor bike not car", and
     * it is why the previous audit's peak-amplitude reading (8.98°) looked survivable while the
     * complaint stayed true — the amplitude was never the problem, the SATURATION was.
     *
     * It is also half of the wheels-through-the-ground report. The GLB cars rotate the whole
     * car, WHEELS INCLUDED, about the contact plane (loadedCar.js's `attitude` node), so every
     * degree of cosmetic lean drives the outboard tyres halfTrack·sin(lean) into the terrain:
     * measured at 103 mm of tyre under the tarmac with ordinary keyboard corrections
     * (`node tools/diag-carcontact.mjs`), against 14-17 mm hands-off.
     *
     * Nothing about the PHYSICS moves: `_loadLat` is a filtered copy of `latAccel`, this is the
     * cosmetic lean spring's target, and it is never fed back into the solver. */
    const leanTarget = clamp((this._loadLat * this.spec.rollPerG * Math.PI) / 180, -BODY.rollClamp, BODY.rollClamp);
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

    /* What the renderer reads. main.js used to add 60% of the ground term on top of these,
     * with the pitch sign the wrong way round, and that was the whole of the "car points
     * into the hill" complaint — fixed two sessions ago. visualRollMul is applied to the
     * spring lean only, because exaggerating a rollover would put the car through the floor.
     *
     * THE GROUND-FOLLOWING TERM IS RATE-LIMITED HERE, not taken raw. Measured directly
     * (`_scratch-probe3.mjs`, driving a real road and sweeping the lateral offset): a car
     * that stays fully on the made surface never reads more than 7° of ground roll anywhere
     * along 400 sampled points on a real road, but drift even 1.3 m past the tarmac edge —
     * an ordinary wide line through a bend, not a crash — and it can land on the road's own
     * embankment shoulder, which is routinely 20-35° within a couple of metres of the edge by
     * design (terrain.js's BATTER; the shoulder has to be that steep or the fills would be
     * absurdly wide). Averaging one wheel there against three still on flat tarmac used to
     * reach the body as up to ~35° of roll, instantly, in a single 8 ms step, because nothing
     * stood between the raw wheel-probe reading and `this.roll` — no per-wheel suspension
     * compliance, no time constant, "arrives instantly" taken completely literally. That is
     * the "tilts like a motorbike" complaint on ground that is not a bug, just adjacent to
     * ground that is steep on purpose, with no suspension travel standing in the way the way
     * a real car's would.
     *
     * A rate cap fixes the SNAP without adding lag to a genuine hill: BODY.groundFollowRate
     * is set from the same "a bank taken at speed is about 3 rad/s" figure TIP.bankRate is
     * already built on below, comfortably above the ~0.4 rad/s (worst measured, diag-body.mjs
     * section 3) a real climbing road ever actually asks for, and far below the >70 rad/s an
     * unfiltered verge clip demands in one physics step. It is a RATE LIMIT, not a low-pass:
     * it still reaches the true value exactly once the target holds still, just not in zero
     * time — so it fixes the snap without reintroducing the old "car points into the hill"
     * lag complaint that "arrives instantly" was written to kill in the first place.
     *
     * Only the DISPLAYED attitude is smoothed. `this.groundRoll`/`this.groundPitch`
     * themselves are left raw and instantaneous on purpose — the tip solver's own bank-rate
     * detection (`_gRate` above) and the tripping force both key off the real, un-smoothed
     * ground truth, so a genuine bank still triggers a rollover exactly as fast as it always
     * did; only what reaches the renderer changes. */
    const rollStep = BODY.groundFollowRate * dt;
    this._smRoll += clamp(this.groundRoll - this._smRoll, -rollStep, rollStep);
    this._smPitch += clamp(this.groundPitch - this._smPitch, -rollStep, rollStep);
    this.roll = this._smRoll + this._lean * BODY.visualRollMul + this._tip;
    this.pitch = this._smPitch + this._dive;

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
