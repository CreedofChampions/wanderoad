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
import { clamp, clamp01, lerp, angleDelta, damp, dampAngle } from '../core/math.js';

/* Sport is the only chase camera. The cruise rig was a calmer alternative and the hood view
 * an extra, but the streak trail is a world-space object that reads correctly from exactly one
 * distance and angle, and "sport is the only camera needed" settled it. Hood stays as a
 * second entry so the key still does something worth doing. */
const MODES = ['sport', 'hood'];

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
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  /**
   * @param {Vehicle} car
   * @param {number} dt
   * @param {(x:number,z:number)=>number} groundAt  used to keep the camera out of the hill
   */
  update(car, dt, groundAt) {
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

    /* ── rest pose ────────────────────────────────────────────────────── */
    const behind = C.behind + (C.stretch || 0) * sNorm;
    const above = C.above + (C.rise || 0) * sNorm;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);

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
      let need = groundAt(this.px, this.pz);
      for (let i = 1; i <= 4; i++) {
        const t = i / 5;
        const gx = this.px + (car.x - this.px) * t;
        const gz = this.pz + (car.z - this.pz) * t;
        const g = groundAt(gx, gz);
        // Allow for the fact that clearing a ridge halfway along only needs half the lift.
        const required = g + 1.2 - (car.y + C.above - g) * 0;
        if (required > need) need = required;
      }
      if (this.py < need + 1.2) this.py = need + 1.2;
    }

    /* ── look-at ──────────────────────────────────────────────────────── */
    const lx = car.x + Math.sin(car.yaw) * C.lookAhead;
    const lz = car.z + Math.cos(car.yaw) * C.lookAhead;
    const ly = car.y + C.lookHeight;
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
