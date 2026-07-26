/* Wanderoad — auto-drive.
 *
 * Hands off the wheel and the car keeps going. This is the single feature the operator
 * picked out of Slow Roads, and it is the most cozy thing a driving game can offer: you stop
 * driving and start looking out of the window.
 *
 * It is a Stanley controller — the same one real self-driving stacks use for lane keeping,
 * and the same one this project's headless test harness has been using to smoke-test the
 * roads. Two terms: how wrong the heading is against the road, and how far off the centreline
 * the car has drifted. Nothing about it is a cheat: it only produces the same steer, throttle
 * and brake numbers a player's keyboard would, and it obeys the same tyres, the same grip and
 * the same brakes. If the autopilot cannot get round a corner, neither could you.
 *
 * It gives up the moment you touch anything, because an assist you have to fight is worse
 * than no assist at all.
 */

import { clamp, clamp01, lerp } from '../core/math.js';

/** Metres ahead the controller looks when judging how tight the road is about to get. */
const LOOKAHEAD = 42;

export class Autopilot {
  constructor({ cruise = 16 } = {}) {
    this.on = false;
    this.cruise = cruise; // m/s the autopilot aims for on an open road
    this.lastReason = '';
    this._lostFor = 0;
    this._feed = 0;
  }

  toggle(car) {
    this.on = !this.on;
    this._lostFor = 0;
    if (this.on) this.cruise = Math.max(11, Math.min(Math.abs(car?.speed || 0) || 16, 22));
    return this.on;
  }

  off(reason = '') {
    if (!this.on) return false;
    this.on = false;
    this.lastReason = reason;
    return true;
  }

  /**
   * Produce an input for this frame.
   *
   * @param {Vehicle} car
   * @param {object} manual the player's own input this frame — any of it cancels the autopilot
   * @returns {object|null} an input object, or null when the autopilot is not driving
   */
  update(car, manual, dt) {
    if (!this.on) return null;

    // Any real input from the player hands control straight back. A nudge on the stick is a
    // nudge, not a request to be argued with.
    if (Math.abs(manual.steer) > 0.12 || manual.brake > 0.15 || manual.throttle > 0.5 || manual.handbrake > 0.1) {
      this.off('you took over');
      return null;
    }

    const terr = car.terrain;
    if (!terr) return null;
    const near = terr.roads.query(car.x, car.z);

    if (!isFinite(near.d) || near.d > near.width * 2.2 + 14) {
      // Off the network. Coast to a stop rather than wander — the player asked for a
      // chauffeur, and a chauffeur who drives into a field is worse than one who stops.
      this._lostFor += dt;
      if (this._lostFor > 4) this.off('lost the road');
      return { steer: 0, throttle: 0, brake: 0.35, handbrake: 0, analogue: true, auto: true };
    }
    this._lostFor = 0;

    /* Which way along the road are we going? Take the tangent direction we are already
     * closest to, so the car never decides to turn round on a road it is driving down. */
    let tx = near.tx;
    let tz = near.tz;
    if (Math.sin(car.yaw) * tx + Math.cos(car.yaw) * tz < 0) {
      tx = -tx;
      tz = -tz;
    }

    // Signed distance from the centreline, positive to the left of travel.
    const lateral = (car.x - near.qx) * tz - (car.z - near.qz) * tx;

    let err = Math.atan2(tx, tz) - car.yaw;
    while (err > Math.PI) err -= Math.PI * 2;
    while (err < -Math.PI) err += Math.PI * 2;

    /* THE CROSS-TRACK GAIN. Ten runs at a kilometre each reached zero of them: every single
     * one drifted off the edge inside 200 m, and the cause was here. A Stanley controller's
     * cross-track term is k*e/v with k around 3; this was using 0.55, which at 12 m/s turns a
     * two-metre error into nine degrees of correction — less than the error was growing. The
     * car tracked the road's HEADING beautifully and slid quietly out of the lane while doing
     * it.
     *
     * There is also a feed-forward now. Reacting to a bend only once you are already in it
     * means entering every corner from the outside, which on a four-metre lane is most of the
     * way off it. Steering into the bend ahead is what a person does without thinking. */
    const v = Math.max(Math.abs(car.speed), 6);
    const cross = Math.atan2(3.2 * lateral, v);
    const steer = clamp((err * 1.5 + cross) * 2.1 + this._feed, -1, 1);

    /* How tight is it about to get? Compare the road's tangent here with its tangent a
     * lookahead away, and slow down for the difference. Braking for the corner you are
     * already in is too late; this brakes for the one coming. */
    const ax = car.x + Math.sin(car.yaw) * LOOKAHEAD;
    const az = car.z + Math.cos(car.yaw) * LOOKAHEAD;
    const ahead = terr.roads.query(ax, az);
    /* Only trust the look-ahead if it landed on THIS road. `roads.query` returns the nearest
     * road to a point, and a point 42 m ahead can easily be nearest to a different one — a
     * lane crossing, a parallel arterial. Believing that reading means seeing a hairpin that
     * is not there, braking to walking pace for it, and stopping. Ten runs ended "stopped
     * moving" for exactly this reason. */
    let bend = 0;
    let bendSigned = 0;
    if (isFinite(ahead.d) && ahead.d < ahead.width * 1.6) {
      let atx = ahead.tx;
      let atz = ahead.tz;
      if (atx * tx + atz * tz < 0) {
        atx = -atx;
        atz = -atz;
      }
      let d = Math.atan2(atx, atz) - Math.atan2(tx, tz);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      // More than a right angle in 42 m is not a bend, it is a different road.
      if (Math.abs(d) < Math.PI * 0.5) {
        bendSigned = d;
        bend = Math.abs(d);
      }
    }

    /* Feed-forward: lean into the corner ahead by a fraction of how much it turns. Signed,
     * so it leans the right way; damped, so it does not fight the feedback terms. */
    this._feed = clamp(bendSigned * 0.55, -0.45, 0.45);

    // Never ask for a crawl: 8 m/s is a slow corner, not a stall.
    const target = lerp(this.cruise, 8, clamp01(bend / 0.55));
    const speed = Math.abs(car.speed);
    /* A proportional throttle alone cannot start a stationary car: at 1 m/s below target it
     * asks for 20% throttle, which does not overcome rolling resistance, and the car sits
     * there. Well below target, open it properly. */
    const deficit = target - speed;
    const throttle = deficit <= 0 ? 0 : deficit > target * 0.25 ? clamp01(0.45 + deficit / 12) : clamp01(deficit / 5);
    const brake = speed > target + 4 ? clamp01((speed - target - 4) / 8) * 0.5 : 0;

    return { steer, throttle, brake, handbrake: 0, analogue: true, auto: true };
  }
}
