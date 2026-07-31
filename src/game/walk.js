/* Wanderoad — GETTING OUT OF THE CAR.
 *
 * Operator: "Walk-in showrooms seperate to gas stations (walkable mode)".
 *
 * This is the game's first mode that is not a vehicle, and the temptation is to build a character
 * controller. It deliberately does not. A walker here is a position, a heading and a speed, moved
 * kinematically over the terrain — no mass, no tyre model, no suspension — because none of the
 * things the car solver exists to get right (weight transfer, slip, grip) mean anything at 1.4 m/s,
 * and every one of them would need tuning to feel non-awful on foot.
 *
 * What it DOES share with the car, on purpose:
 *   - the same Input intent (steer/throttle), so the same keys and the same pad stick move you
 *   - the same terrain height, so you walk over the same ground the car drives on
 *   - the same solids list, so you cannot walk through the building you came to look at
 *
 * The car does not disappear while you are out of it. It stays exactly where you parked, and getting
 * back in puts you in it — which is the whole reason to park thoughtfully outside a showroom rather
 * than aiming at the door.
 */

/** Metres per second on the flat. A brisk walk; the game is cozy, not a shooter. */
export const WALK_SPEED = 2.6;
/** Metres per second while the fine-control modifier is held — for lining up with a car indoors. */
export const WALK_SLOW = 1.1;
/** Radians per second of turn at full stick. */
export const WALK_TURN = 2.9;
/** Eye height above the ground, metres. */
export const EYE = 1.62;
/** How far from the car you may wander before the game offers to walk you back, metres. */
export const LEASH = 190;
/** How close to the car you must be to get in, metres. */
export const ENTER_R = 4.2;
/** Radius of the walker, for pushing out of solids. A person is not a car. */
export const BODY_R = 0.42;

export class Walker {
  constructor() {
    /** Is the player on foot right now? */
    this.active = false;
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.yaw = 0;
    /** Where the car was left, so it can be walked back to and got into. */
    this.carX = 0;
    this.carZ = 0;
    /** Smoothed forward speed, only so the head-bob and the camera do not snap. */
    this.speed = 0;
  }

  /**
   * Step out of the car. The walker appears BESIDE it, not inside it — stepping out into your own
   * bonnet and being shoved by the collider is a bad first second of a new mode.
   *
   * @param {{x:number,z:number,yaw:number}} car
   * @param {(x:number,z:number)=>number} groundY
   */
  enter(car, groundY) {
    // one door's width to the left, in the car's own frame
    const side = 1.5;
    this.x = car.x + Math.cos(car.yaw) * side;
    this.z = car.z - Math.sin(car.yaw) * side;
    this.yaw = car.yaw;
    this.carX = car.x;
    this.carZ = car.z;
    this.y = groundY(this.x, this.z);
    this.speed = 0;
    this.active = true;
  }

  /** Back in the car. The caller decides whether that is allowed; this only stops the walking. */
  leave() {
    this.active = false;
    this.speed = 0;
  }

  /** Metres from the walker to where the car is parked. */
  get toCar() {
    return Math.hypot(this.x - this.carX, this.z - this.carZ);
  }

  /**
   * One step.
   *
   * @param {number} dt seconds
   * @param {{steer:number, throttle:number, brake:number, fine:boolean}} cmd the same intent object
   *        the car reads, so no second input path exists
   * @param {(x:number,z:number)=>number} groundY
   * @param {{resolve?:Function}} [solids] anything with a circle-push; optional
   */
  update(dt, cmd, groundY, solids = null) {
    if (!this.active || !(dt > 0)) return;
    this.yaw += (cmd.steer || 0) * WALK_TURN * dt;

    /* Forward from throttle, back from brake — the same two controls as the car, so nobody has to
     * learn a second set. Reverse is a shuffle: walking backwards fast looks wrong and there is
     * never a reason to do it. */
    const want = (cmd.throttle || 0) - (cmd.brake || 0) * 0.45;
    const top = cmd.fine ? WALK_SLOW : WALK_SPEED;
    const target = want * top;
    // A short blend rather than an instant set, so starting and stopping are not a hard cut.
    this.speed += (target - this.speed) * Math.min(1, dt * 9);
    if (Math.abs(this.speed) < 0.002) this.speed = 0;

    const nx = this.x + Math.sin(this.yaw) * this.speed * dt;
    const nz = this.z + Math.cos(this.yaw) * this.speed * dt;

    /* SOLIDS. Pushed out of, not bounced off: a person who walks into a wall stops, they do not
     * ricochet. The push is applied to the CANDIDATE position, so a walker wedged into a corner by
     * a moving world still ends up outside it rather than accumulating velocity into it. */
    let fx = nx;
    let fz = nz;
    if (solids && typeof solids.near === 'function') {
      for (const s of solids.near(nx, nz, 3) || []) {
        const dx = fx - s.x;
        const dz = fz - s.z;
        const r = (s.r || 0) + BODY_R;
        const d = Math.hypot(dx, dz);
        if (d > 0.0001 && d < r) {
          fx = s.x + (dx / d) * r;
          fz = s.z + (dz / d) * r;
        }
      }
    }
    this.x = fx;
    this.z = fz;
    this.y = groundY(this.x, this.z);
  }
}
