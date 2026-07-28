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

/* ── the auto-drive SHOT LIST: what makes it cinematic rather than merely drifting ─────────
 *
 * The operator asked, in his own words, that when auto-drive is on "the camera goes
 * cinematic". The playtest audit measured what actually happened and reported it precisely:
 * "cine.active was false in ~100 consecutive samples during auto-drive; what actually happens
 * is chase.driftW ramping 0 -> 1.0 and the camera-to-car distance widening to 10.1-21.3 m."
 * That is a true description of a nice camera and it is NOT a cinematic. The thing missing is
 * the one thing every piece of film language is built on: A CUT.
 *
 * Two ways to add one were open. Hand the camera to game/cinematic.js — rejected, and not for
 * effort: that programme is SCOUTED once, at boot, around the spawn point (its own header's
 * fourth rule is that it never samples the world per frame), so replaying it 40 km away flies
 * a crane over a valley that is not there. It also owns an overlay, a skip hint, a HUD dim and
 * a document-wide "any key ends it" listener, none of which belongs on a camera the player is
 * meant to sit inside while still steering if they want to.
 *
 * So the cuts live here, in the rig that is already running. A SHOT is a static framing —
 * where the boom sits, how long it is, how high, where the lens is pointed, what focal length
 * — held for ten to sixteen seconds and then CUT, not eased, to the next one. The slow orbit
 * above keeps running underneath every shot, so nothing is ever a locked-off still; what the
 * shot list adds is composition and change. That combination is what a cinematic is.
 *
 * THE CUT IS A REAL CUT. The spring is snapped and the look target is snapped on the frame a
 * shot changes (see `_cut` in update()), because a two-second slide between two framings is a
 * camera MOVE and reads as the rig being dragged, whereas an instant change reads as an edit.
 * This is the single most load-bearing line in the feature.
 *
 * COZY IS STILL THE FILTER. Ten to sixteen seconds is a long hold — a television edit is two
 * to four. Nothing here is fast, nothing whips, no shot puts the camera in front of the car
 * looking back (which reads as a chase), and the widest shot is 21 m out rather than 60. Every
 * framing is one somebody would choose to look out of a window at.
 */
const SHOTS = [
  // name          orbit   boom  lift  side   up    fov   secs
  { name: 'wide', orbit: 0.0, boom: 1.0, lift: 1.0, side: 0.0, up: 0.0, fov: 0.0, secs: 13.5 },
  { name: 'high and back', orbit: -0.34, boom: 1.45, lift: 2.3, side: 0.9, up: 1.6, fov: 2.5, secs: 15.0 },
  { name: 'low quarter', orbit: 0.72, boom: 0.72, lift: -0.55, side: -1.5, up: -0.4, fov: -1.5, secs: 11.0 },
  { name: 'over the shoulder', orbit: -0.86, boom: 0.62, lift: 0.35, side: 1.7, up: 0.5, fov: -2.0, secs: 12.0 },
  { name: 'the long lens', orbit: 0.26, boom: 1.75, lift: 1.5, side: -0.7, up: 1.1, fov: -4.5, secs: 16.0 },
  { name: 'roadside', orbit: 1.15, boom: 0.95, lift: -0.2, side: -2.1, up: 0.2, fov: 1.0, secs: 10.5 },
];
/** Orbit offsets above are RADIANS added to the rig yaw, and the widest of them (1.15 rad,
 *  66°) is a genuinely different angle on the car rather than a nudge — a shot list whose
 *  members all look the same is a slideshow of one picture. */
export const SHOT_NAMES = SHOTS.map((s) => s.name);

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

    /* ── the shot director's live state ────────────────────────────────────────
     * All four are PUBLIC and named for what they are, because the last audit of this feature
     * could only measure `driftW` and a camera-to-car distance and had to report "not
     * cinematic" from that. These are the readout: `cinematic` is true exactly while the
     * auto-drive rig owns the frame, `shot` is the framing currently on screen by name, and
     * `cuts` counts real edits. A flag being set is not a thing being visible — but a cut
     * COUNTER that climbs while the name changes is a thing that can be checked against a
     * screenshot, which is the point. */
    /** True while the shot list is running — i.e. the camera is in its cinematic mood. */
    this.cinematic = false;
    /** The framing on screen right now, by name. '' when the player has the wheel. */
    this.shot = '';
    /** How many times the camera has actually CUT this session. */
    this.cuts = 0;
    this._shotI = 0;
    this._shotT = 0;
    this._cut = false;
  }

  cycle() {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    return this.mode;
  }

  /* NOTE: `cinematic` is a PLAIN PUBLIC FIELD set in the constructor and maintained by the shot
   * director in update() — see the SHOTS block at the top of this file. A `get cinematic()`
   * accessor briefly lived here as well, added in the same hour by a second agent solving the
   * same audit finding, and it was not merely redundant: a prototype getter with no setter makes
   * the constructor's own `this.cinematic = false` throw a TypeError in strict mode, which is
   * every ES module, which is this whole game. It was removed rather than reconciled. One source
   * of truth for the flag, and it is the field. */

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

    /* ── the shot director ────────────────────────────────────────────────
     * See SHOTS at the top of this file for why the cut, and not the drift, is what makes
     * this cinematic. Three rules, all of them consequences of that:
     *
     *   - The clock only runs while the rig actually owns the frame (dw > 0.02). A shot must
     *     not silently expire while the player is driving and then be "already half over"
     *     when they hand the wheel back.
     *   - Engaging auto-drive does NOT cut. It resets to shot 0 and rides the 3.4 s ramp in
     *     from the sport pose, because a cut at the same instant as a mode change reads as a
     *     glitch rather than as an edit.
     *   - Disengaging clears the state, so taking the wheel and giving it back later starts a
     *     fresh programme rather than resuming mid-shot.
     */
    if (dw > 0.02) {
      if (!this.cinematic) {
        this.cinematic = true;
        this._shotI = 0;
        this._shotT = 0;
      }
      this._shotT += dt;
      if (this._shotT >= SHOTS[this._shotI].secs) {
        this._shotT = 0;
        this._shotI = (this._shotI + 1) % SHOTS.length;
        this.cuts++;
        this._cut = true; // consumed by the spring below — this is the actual edit
      }
      this.shot = SHOTS[this._shotI].name;
    } else if (this.cinematic) {
      this.cinematic = false;
      this.shot = '';
      this._shotT = 0;
      this._cut = false;
    }
    /* The framing itself, faded in by the SAME dw the drift uses. At dw = 0 every term is
     * exactly zero and what remains is the sport camera byte for byte — the property this
     * file's own header calls the important part, and the reason a shot list can live in the
     * gameplay rig at all instead of needing a second camera. */
    /* Latched once, here, because the position spring, the look-at and the FOV limiter all
     * have to snap on the SAME frame and the spring branch below clears the flag. A cut whose
     * aim or focal length arrives a third of a second late is not a cut. */
    const cutNow = this._cut;
    const S = this.cinematic ? SHOTS[this._shotI] : null;
    const shotOrbit = S ? dw * S.orbit : 0;
    const shotBoom = S ? dw * (S.boom - 1) * DRIFT.boomBase : 0;
    const shotLift = S ? dw * S.lift : 0;
    const shotSide = S ? dw * S.side : 0;
    const shotUp = S ? dw * S.up : 0;
    const shotFov = S ? dw * S.fov : 0;
    /* Sines for the orbit and the look offset, MINUS COSINES for the boom and the lift. That
     * is not decoration: -cos starts at the bottom of its swing, so the first moment of a
     * drift is the sport camera plus a metre and a half, and the rig opens out from there.
     * Starting them on a sine would have the boom want to be 12 m long the instant you press
     * the key, which is a lurch backwards, not a camera drifting. */
    const orbit =
      dw * (DRIFT.yawA * Math.sin((ct / DRIFT.yawP) * TAU) + DRIFT.yawA2 * Math.sin((ct / DRIFT.yawP2) * TAU)) +
      shotOrbit;
    /* The slow swing keeps running INSIDE each shot — that is what stops a fifteen-second
     * hold being a locked-off still — and the shot's own framing is added on top of it. Both
     * halves are already weighted by dw, so the sum is too. `Math.max(0, ...)` on the boom:
     * the tightest shot in the list multiplies the base boom by 0.62 while the swing can be
     * at the bottom of its own arc at the same moment, and a negative boom would put the
     * camera through the bonnet. */
    const boom = Math.max(0, dw * (DRIFT.boomBase - DRIFT.boomA * Math.cos((ct / DRIFT.boomP) * TAU)) + shotBoom);
    const lift = dw * (DRIFT.liftBase - DRIFT.liftA * Math.cos((ct / DRIFT.liftP) * TAU)) + shotLift;
    const lookSide = dw * DRIFT.lookA * Math.sin((ct / DRIFT.lookP) * TAU) + shotSide;
    const lookUp = dw * DRIFT.lookUpA * Math.sin((ct / DRIFT.lookUpP) * TAU) + shotUp;

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
    if (this._first || this._cut) {
      /* THE CUT. This one branch is what makes the shot list an EDIT rather than a camera
       * move: the rig is placed at the new framing in a single frame and its spring velocity
       * is thrown away, so the next shot begins from rest instead of arriving with the last
       * shot's momentum still in it. Easing between two framings over a second and a half is
       * a dolly, and a dolly between compositions reads as the rig being dragged around; a
       * cut reads as somebody choosing a different angle. `_lookX/Y/Z` are snapped alongside
       * it a little further down for the same reason — a cut whose AIM slides afterwards is
       * a cut followed by a whip pan.
       *
       * It shares the `_first` path deliberately: a teleport (reset(), backToRoad(), the
       * water rescue) has always snapped the camera, and a cut is exactly the same operation
       * with a different cause. One implementation, no second way to be placed. */
      this.px = wantX;
      this.py = wantY;
      this.pz = wantZ;
      /* THE CUT INHERITS THE CAR'S VELOCITY. A teleport (`_first`) genuinely starts from
       * rest, but a cut does not: the subject is doing 90 km/h and the new camera is
       * supposed to be travelling with it from the first frame. Starting the spring at zero
       * leaves the rig standing still in world space while the car drives out from under it,
       * and at a six-metre boom that is 110 deg/s of bearing change over the next tenth of a
       * second — measured, in tools/diag-cinematic.mjs, which is exactly the whip the rig's
       * whole design budget exists to prevent. So the new shot is handed the car's own
       * velocity and tracks immediately.
       *
       * The rig is also placed a spring-lag BEHIND the pose rather than exactly on it. A
       * critically-damped follower chasing a target moving at V settles a constant
       * 2*zeta*V/omega behind it; landing exactly on the pose therefore means the first
       * thing the new shot does is drift backwards into that lag, which reads as the camera
       * losing ground the instant it cuts. Landing IN the lag means the shot is already in
       * its steady state and simply holds. */
      if (cutNow && C.springOmega) {
        const lag = (2 * C.springZeta) / C.springOmega;
        this.vxs = car.vx || 0;
        this.vys = car.vy || 0;
        this.vzs = car.vz || 0;
        this.px -= this.vxs * lag;
        this.py -= this.vys * lag;
        this.pz -= this.vzs * lag;
      } else {
        this.vxs = this.vys = this.vzs = 0;
      }
      this._first = false;
      this._cut = false;
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
    if (cutNow) {
      // Snapped, not damped — see the note at the cut in the spring block above.
      this._lookX = lx;
      this._lookY = ly;
      this._lookZ = lz;
    } else {
      this._lookX = damp(this._lookX || lx, lx, 14, dt);
      this._lookY = damp(this._lookY || ly, ly, 10, dt);
      this._lookZ = damp(this._lookZ || lz, lz, 14, dt);
    }

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
    wantFov += DRIFT.fov * dw + shotFov;
    // 12 deg/s exists so the lens never pumps during driving. A CUT is the one case where the
    // rate limit is wrong: a 4.5 deg change arriving over the next third of a second is a
    // small zoom immediately after an edit, which is exactly the thing an edit is supposed to
    // avoid. Snap on the cut frame, rate-limit every other frame.
    if (cutNow) {
      this.fov = wantFov;
    } else {
      const maxFovStep = 12 * dt;
      this.fov += clamp(wantFov - this.fov, -maxFovStep, maxFovStep);
    }

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
