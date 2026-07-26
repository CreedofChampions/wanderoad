/* Wanderoad — the chase camera.
 *
 * The camera is half of what people mean when they say a driving game "feels" good, and
 * Test Drive Unlimited's is distinctive: it lags, it looks into the corner, and it never
 * lets the car drift far from the middle of the screen.
 *
 * Two rigs, because the series is really two games:
 *   CRUISE — locked to the car's heading, no FOV change, no shake. Nacon describe this one
 *            as "more suitable for leisurely driving and visibility of the surroundings",
 *            and cruising is what the community says the series is actually for. Default.
 *   SPORT  — a damped spring rig whose yaw target is blended 62% toward the VELOCITY
 *            heading. That blend is the whole trick: it looks where the car is going, not
 *            where it is pointing, which is what reads as "into the corner".
 *
 * Deliberately not done: letting the car slide to the screen edge during a drift. "the back
 * of the car goes to the side of screen ... creating a floating feeling" is a real
 * complaint; the lateral clamp below fixes it.
 */

import { CAMERA } from './tuning.js';
import { clamp, clamp01, lerp, angleDelta, damp, dampAngle, TAU } from '../core/math.js';

/* Sport is the only chase camera. The cruise rig was a calmer alternative and the hood view
 * an extra, but the streak trail is a world-space object that reads correctly from exactly one
 * distance and angle, and "sport is the only camera needed" settled it. Hood stays as a
 * second entry so the key still does something worth doing. */
const MODES = ['sport', 'hood'];

/* ── the auto-drive camera ────────────────────────────────────────────────────
 * When the car is driving itself the player is a passenger, and a passenger looks out of the
 * window. So the rig swings slowly around the car, backs off, lifts, and lets the car sit off
 * centre for a while.
 *
 * It is the SAME rig with offsets added, not a second camera. That is the important part: at
 * weight 0 every term below is exactly zero and what remains is the sport camera, byte for
 * byte, so taking the wheel back costs nothing and there is no second camera to keep in sync.
 * A camera picker was explicitly not wanted; this is a mood, not a mode.
 *
 * Every period is chosen against the others — no two share a value, and none is a multiple of
 * another — so the pattern does not visibly repeat inside a session. Every amplitude is sized
 * against its own period to hold the ANGULAR RATE under about 10 °/s (A·2π/P: 5.4 + 3.0 in the
 * orbit; measured at 7.2 °/s over three minutes by tools/diag-cinematic.mjs). That number is
 * the whole design. A camera that whips round the car is exciting, and exciting is the wrong
 * thing for this game to be.
 */
const DRIFT = {
  inTau: 3.4, // seconds to reach full drift once auto-drive engages — unhurried
  outSecs: 1.2, // ...and a LINEAR ramp to hand it straight back. See update() for why linear.
  yawA: 0.62,
  yawP: 41, // ±36° of orbit, one swing every 41 s   -> 5.4 °/s
  yawA2: 0.16,
  yawP2: 19, // a smaller, quicker wobble so the swing is not a metronome  -> 3.0 °/s
  boomBase: 7.5,
  boomA: 6.0,
  boomP: 29, // 1.5–13.5 m of extra boom: the car gets small, the country gets big
  liftBase: 2.6,
  liftA: 2.2,
  liftP: 23.5, // 0.4–4.8 m of extra height
  lookA: 1.6,
  lookP: 31, // metres the look target slides sideways — the car off centre, on a third
  lookUpA: 1.1,
  lookUpP: 21.5, // ...and up, which drops the horizon into frame. Not 19: see yawP2.
  fov: 3.5, // a slightly wider lens. More world, less car.
};

export class ChaseCamera {
  constructor(camera, { mode = 'sport' } = {}) {
    this.camera = camera;
    this.mode = mode;
    this.yaw = 0;
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.vxs = 0;
    this.vys = 0;
    this.vzs = 0;
    this.fov = CAMERA.sport.fov;
    this.pitch = 0;
    this._kick = 0;
    this._shakeT = 0;
    this._first = true;
    this._lookX = 0;
    this._lookY = 0;
    this._lookZ = 0;
    /** 0..1 blend onto the auto-drive rig. 0 is exactly the sport camera. */
    this.driftW = 0;
    this._driftT = 0;
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  /**
   * Where this rig sits, and what it looks at, with the car standing still and no drift.
   *
   * The opening cinematic's last shot ends on exactly this pose so the hand-off into gameplay
   * has no cut in it — which only works while there is ONE definition of the pose, so update()
   * below builds its rest pose from this method rather than repeating the arithmetic. Copying
   * `behind` and `above` into cinematic.js would have worked right up until somebody retuned
   * the chase camera.
   *
   * @param {Vehicle} car
   * @param {object} [out]
   * @param {(x:number,z:number)=>number} [groundAt] apply the same terrain floor update() does
   */
  restPose(car, out = {}, groundAt = null) {
    const C = CAMERA[this.mode] || CAMERA.sport;
    const sy = Math.sin(car.yaw);
    const cy = Math.cos(car.yaw);
    out.yaw = car.yaw;
    out.px = car.x - sy * C.behind;
    out.py = car.y + C.above;
    out.pz = car.z - cy * C.behind;
    /* THE FLOOR IS PART OF THE POSE. Leaving it out is what a "close enough" hand-off looks
     * like: on a road cut into a hillside the chase camera lifts itself 0.35 m on its very
     * first frame, and 0.35 m at six metres from the car is three degrees of pitch in one
     * frame — small, and a visible pop at the exact moment the game starts. */
    if (groundAt) out.py = Math.max(out.py, this._floor(out.px, out.pz, car, groundAt));
    out.lx = car.x + sy * C.lookAhead;
    out.ly = car.y + C.lookHeight;
    out.lz = car.z + cy * C.lookAhead;
    out.fov = C.fov;
    return out;
  }

  /**
   * The lowest the rig may sit at (px, pz): never buried, and never with a mound between it
   * and the car filling the screen — see the long note at the sample loop in update().
   *
   * Factored out so restPose() can apply the identical floor. It is the same five samples and
   * the same margins it has always been; do not "tidy" the asymmetry between the sample at the
   * camera and the four along the boom, it is load-bearing.
   */
  _floor(px, pz, car, groundAt) {
    let need = groundAt(px, pz);
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const g = groundAt(px + (car.x - px) * t, pz + (car.z - pz) * t);
      // Allow for the fact that clearing a ridge halfway along only needs half the lift.
      const required = g + 1.2;
      if (required > need) need = required;
    }
    return need + 1.2;
  }

  /**
   * @param {Vehicle} car
   * @param {number} dt
   * @param {(x:number,z:number)=>number} groundAt  used to keep the camera out of the hill
   * @param {{drift?: boolean}} [opts] drift = the car is driving itself, so wander a bit
   */
  update(car, dt, groundAt, opts = null) {
    const C = CAMERA[this.mode] || CAMERA.sport;
    const speed = Math.abs(car.speed);
    const sNorm = clamp01(speed / (250 / 3.6));

    /* ── where the rig wants to point ─────────────────────────────────── */
    let targetYaw = car.yaw;
    if (C.velocityBlend > 0 && speed > 3) {
      const velYaw = Math.atan2(car.vx, car.vz);
      // Blend only PARTWAY. All the way and the car dislocates from the frame during a
      // slide; none of the way and the camera never looks into the corner.
      targetYaw = car.yaw + angleDelta(car.yaw, velYaw) * C.velocityBlend;
    }
    if (C.lookIntoCorner) {
      const extra = clamp(C.lookIntoCorner * car.steer * car.maxSteerAngle() * 4.0, -C.lookIntoClamp, C.lookIntoClamp);
      targetYaw += extra;
    }
    this.yaw = this._first ? targetYaw : dampAngle(this.yaw, targetYaw, 1 / C.yawTau, dt);

    /* ── auto-drive drift (see DRIFT at the top) ──────────────────────── */
    const wantDrift = opts && opts.drift ? 1 : 0;
    /* Restart the phase clock on the rising edge, so every offset below begins at zero and
     * the ramp-in only has to grow an offset rather than SWEEP one. Picking the sines up
     * mid-phase meant engaging auto-drive could ask the rig to travel 35° in the 3 s of the
     * ramp — 14 °/s, on top of the orbit's own rate. Measured; that is why this line is here. */
    if (this.driftW === 0 && wantDrift) this._driftT = 0;
    this._driftT += dt;
    if (this._first) {
      this.driftW = wantDrift;
    } else if (wantDrift) {
      this.driftW = damp(this.driftW, 1, 1 / DRIFT.inTau, dt);
    } else {
      /* LINEAR on the way out, where everything else in this file is exponential. Two reasons,
       * both measured. An exponential with a tail short enough to feel immediate does its
       * fastest movement in the first frame after you touch the wheel — 74 °/s at tau 0.6 —
       * which is a flinch at exactly the wrong moment. And it never actually reaches zero: at
       * tau 0.6 the weight was still 1e-4 five and a half seconds after the player took over,
       * so "the drift is off" was not literally true and the rest pose was not literally the
       * rest pose. A ramp is bounded at both ends: 37 °/s worst case, and exactly zero after
       * 1.2 s, every time. */
      this.driftW = Math.max(0, this.driftW - dt / DRIFT.outSecs);
    }
    /* Hood view has no boom to swing and sits inside the car; orbiting it would be nonsense. */
    // `dw`, not `w`: the spring block below already owns a `w` (its omega), and a shadowed
    // weight in a camera rig is the kind of thing that costs an afternoon.
    const dw = C.behind > 1 ? this.driftW : 0;
    const ct = this._driftT;
    /* Sines for the orbit and the look offset, MINUS COSINES for the boom and the lift. That
     * is not decoration: -cos starts at the bottom of its swing, so the first moment of a
     * drift is the sport camera plus a metre and a half, and the rig opens out from there.
     * Starting them on a sine would have the boom want to be 12 m long the instant you press
     * the key, which is a lurch backwards, not a camera drifting. */
    const orbit =
      dw * (DRIFT.yawA * Math.sin((ct / DRIFT.yawP) * TAU) + DRIFT.yawA2 * Math.sin((ct / DRIFT.yawP2) * TAU));
    const boom = dw * (DRIFT.boomBase - DRIFT.boomA * Math.cos((ct / DRIFT.boomP) * TAU));
    const lift = dw * (DRIFT.liftBase - DRIFT.liftA * Math.cos((ct / DRIFT.liftP) * TAU));
    const lookSide = dw * DRIFT.lookA * Math.sin((ct / DRIFT.lookP) * TAU);
    const lookUp = dw * DRIFT.lookUpA * Math.sin((ct / DRIFT.lookUpP) * TAU);

    /* ── rest pose ────────────────────────────────────────────────────── */
    const behind = C.behind + (C.stretch || 0) * sNorm + boom;
    const above = C.above + (C.rise || 0) * sNorm + lift;
    /* The RIG yaw, not the camera's tracking yaw: the orbit swings the boom around the car
     * while the lens stays on it. Everything downstream that resolves a left/right — the
     * lateral clamp, the look offset — uses these two, which is what keeps the clamp inert
     * during a drift instead of fighting it. */
    const sy = Math.sin(this.yaw + orbit);
    const cy = Math.cos(this.yaw + orbit);

    let wantX = car.x - sy * behind;
    let wantZ = car.z - cy * behind;
    let wantY = car.y + above;

    /* ── spring ───────────────────────────────────────────────────────── */
    if (this._first) {
      this.px = wantX;
      this.py = wantY;
      this.pz = wantZ;
      this._first = false;
    } else if (C.springOmega) {
      const w = C.springOmega;
      const z = C.springZeta;
      const step = (p, v, t) => {
        const a = (t - p) * w * w - v * 2 * z * w;
        const nv = v + a * dt;
        return [p + nv * dt, nv];
      };
      [this.px, this.vxs] = step(this.px, this.vxs, wantX);
      [this.py, this.vys] = step(this.py, this.vys, wantY);
      [this.pz, this.vzs] = step(this.pz, this.vzs, wantZ);
    } else {
      // Cruise: a plain exponential follow. Calm on purpose.
      this.px = damp(this.px, wantX, 6.5, dt);
      this.py = damp(this.py, wantY, 6.5, dt);
      this.pz = damp(this.pz, wantZ, 6.5, dt);
    }

    /* ── keep the car near the middle of the screen ───────────────────── */
    // Measure how far the car has slid sideways relative to the rig and pull it back before
    // it reaches the clamp, with a smoothstep over the last quarter so it never visibly
    // hits a wall.
    if (C.lateralClamp) {
      const dx = car.x - this.px;
      const dz = car.z - this.pz;
      const lateral = dx * cy - dz * sy;
      const limit = C.lateralClamp * behind * 2.0;
      if (Math.abs(lateral) > limit * 0.75) {
        const over = (Math.abs(lateral) - limit * 0.75) / (limit * 0.25);
        const pull = clamp01(over);
        const smooth = pull * pull * (3 - 2 * pull);
        const correct = Math.sign(lateral) * (Math.abs(lateral) - limit * 0.75) * smooth;
        this.px += cy * correct;
        this.pz -= sy * correct;
      }
    }

    /* ── never bury the camera, and never let a hill get between it and the car ──
     * Lifting the camera above the ground BENEATH IT is not enough: on rolling terrain the
     * mound between the camera and the car is higher than either end, so the rig sits in
     * clear air and the screen is still full of grass. Sample the ground along the whole
     * segment and clear the highest point on it. Cheap — five height samples — and it is the
     * difference between a chase camera and a molehill. */
    if (groundAt) {
      const floor = this._floor(this.px, this.pz, car, groundAt);
      if (this.py < floor) this.py = floor;
    }

    /* ── look-at ──────────────────────────────────────────────────────── */
    /* The drift slides the aim off the car so it sits on a third rather than dead centre.
     * (cy, -sy) is the direction 90° to the LEFT of the rig — the same pair the lateral clamp
     * above uses, and the same handedness the whole project keeps relearning: three.js puts
     * +X on your left when you look down +Z. */
    const lx = car.x + Math.sin(car.yaw) * C.lookAhead + cy * lookSide;
    const lz = car.z + Math.cos(car.yaw) * C.lookAhead - sy * lookSide;
    const ly = car.y + C.lookHeight + lookUp;
    this._lookX = damp(this._lookX || lx, lx, 14, dt);
    this._lookY = damp(this._lookY || ly, ly, 10, dt);
    this._lookZ = damp(this._lookZ || lz, lz, 14, dt);

    /* ── FOV ──────────────────────────────────────────────────────────── */
    // Sublinear, so most of the gain arrives in the 0–120 km/h band where cruising happens.
    // Rate-limited, because a pumping FOV in traffic is worse than none.
    let wantFov = C.fov;
    if (C.fovGain) {
      wantFov = C.fov + C.fovGain * Math.pow(sNorm, C.fovPow);
      if (car.longAccel > 0.5 * 9.81) this._kick = 5;
      this._kick = damp(this._kick, 0, 1 / CAMERA.sport.fovKickTau, dt);
      wantFov += this._kick;
    }
    wantFov += DRIFT.fov * dw;
    const maxFovStep = 12 * dt;
    this.fov += clamp(wantFov - this.fov, -maxFovStep, maxFovStep);

    /* ── shake ────────────────────────────────────────────────────────── */
    // Only above 170 km/h, and tiny. It is a speed cue, not an earthquake — "Chase camera is
    // terrible and it gives me motion sickness" is a real review line.
    let shakeX = 0;
    let shakeY = 0;
    if (C.shake && speed > C.shakeFrom) {
      this._shakeT += dt * C.shakeHz * Math.PI * 2;
      const amp = C.shake * clamp01((speed - C.shakeFrom) / 30) * (0.6 + 0.8 * car.limit);
      shakeX = Math.sin(this._shakeT) * amp;
      shakeY = Math.sin(this._shakeT * 1.37 + 1.1) * amp * 0.6;
    }

    /* ── commit ───────────────────────────────────────────────────────── */
    const cam = this.camera;
    cam.position.set(this.px, this.py, this.pz);
    cam.up.set(Math.sin(shakeX) * 0.06, 1, 0);
    cam.lookAt(this._lookX + shakeX * 8, this._lookY + shakeY * 8, this._lookZ);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    return sNorm;
  }

  /** Snap instantly — used after a teleport or a recovery. */
  reset() {
    this._first = true;
    this.vxs = this.vys = this.vzs = 0;
  }
}
