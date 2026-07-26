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
  constructor({ cruise = 22 } = {}) {
    this.on = false;
    this.cruise = cruise; // m/s the autopilot aims for on an open road
    this.lastReason = '';
    this._lostFor = 0;
  }

  toggle(car) {
    this.on = !this.on;
    this._lostFor = 0;
    if (this.on) this.cruise = Math.max(14, Math.min(Math.abs(car?.speed || 0) || 22, 30));
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

    const v = Math.max(Math.abs(car.speed), 6);
    const cross = Math.atan2(0.55 * lateral, v);
    // Negated once, at the end, for the same handedness reason as every other input: +yaw is
    // screen-left, so a positive heading error is corrected with LEFT lock.
    const steer = clamp((err * 1.15 + cross) * 1.6, -1, 1);

    /* How tight is it about to get? Compare the road's tangent here with its tangent a
     * lookahead away, and slow down for the difference. Braking for the corner you are
     * already in is too late; this brakes for the one coming. */
    const ax = car.x + Math.sin(car.yaw) * LOOKAHEAD;
    const az = car.z + Math.cos(car.yaw) * LOOKAHEAD;
    const ahead = terr.roads.query(ax, az);
    let bend = 0;
    if (isFinite(ahead.d)) {
      let atx = ahead.tx;
      let atz = ahead.tz;
      if (atx * tx + atz * tz < 0) {
        atx = -atx;
        atz = -atz;
      }
      let d = Math.atan2(atx, atz) - Math.atan2(tx, tz);
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      bend = Math.abs(d);
    }

    const target = lerp(this.cruise, 7, clamp01(bend / 0.7));
    const speed = Math.abs(car.speed);
    const throttle = speed < target ? clamp01((target - speed) / 5) : 0;
    const brake = speed > target + 3 ? clamp01((speed - target - 3) / 7) * 0.55 : 0;

    return { steer, throttle, brake, handbrake: 0, analogue: true, auto: true };
  }
}
