/* Wanderoad — getting you out of the water.
 *
 * The lakes in this world are not paddling pools. The shore drops away at about 35 degrees:
 * measured on the seeded world at (968, -160) the bed goes 0.0 m, 0.9 m, 2.3 m, 3.8 m,
 * 5.2 m deep over four car-lengths, and eleven metres down there is a flat bottom you can
 * cruise along at 44 km/h with no way back up the bank. Left alone that is not a hazard, it
 * is a hole in the world: the map still streams, the car still drives, and nothing ever
 * tells you the run is over. R gets you out, but only if you know R exists.
 *
 * So the water rescues you. The rules it has to obey, in order:
 *
 *   1. IT MUST NEVER FIGHT YOU. Driving a lakeside road, crossing a ford, clipping a
 *      shoreline, paddling at the water's edge — none of that may trigger it. Two gates do
 *      that work, and only two: you have to be OFF the carriageway, and the water has to be
 *      water rather than wash (CONTACT below).
 *   2. IT MUST NOT BE A PUNISHMENT. No damage, no timer, no fail screen. You get the same
 *      PLACE the R key gives you — the nearest road — and the streak breaks on its own
 *      because you left the carriageway a while ago. It does not re-aim you the way R does:
 *      R is something you pressed, this is not, so the way you were pointing survives it.
 *      _place() has the measurements behind that.
 *   3. IT MUST NOT BE A SNATCH. There is still a beat: a short moment in the water, the car
 *      settling, one line of text, then the move. But it is now a beat and not a wallow.
 *
 * ── 2026-07-27: "Water = respawn (R) on contact not float under" ──────────────
 * The operator's words. The old gate was 0.6 m — water over the axles — held for a second,
 * then a second of settling: 1.98 s of floating about before anything happened, which is what
 * "float under" describes. Two things changed and it is worth being precise about which one
 * actually did the work:
 *
 *   - The DEPTH gate came down from 0.6 m (over the axles) to 0.25 m (water up over the tread
 *     and onto the rim; the tyres are 0.34 m in radius, see car/tuning.js wheelRadius). On the
 *     shipped seed's lake this barely matters — the bank falls at ~35°, so the car goes from
 *     dry to 0.88 m in two metres and crosses 0.25 m and 0.6 m within a frame or two of each
 *     other. It matters on the gentle shelving shores elsewhere in the world, which is where
 *     the wallow was worst.
 *   - The TIMERS are what you feel: 1.0 s + 1.0 s became 0.25 s + 0.35 s. Contact to back on
 *     the tarmac is ~0.6 s instead of ~2.0 s.
 *
 * WHY NOT LITERALLY d > 0. Because "any wetness at all" fires on the beach. Measured on the
 * shipped seed at (668, -439) — 59% dunes, i.e. sand — the wash at the water's edge is 0.14 m
 * deep and never exceeds 0.18 m over a minute of driving about in it. Pulling the car off a
 * beach for standing in the surf is the "it must never fight you" rule broken, and the
 * operator asked for the same set of false positives to stay at zero in the same breath as
 * asking for this. 0.25 m clears that wash with margin and is still less than half the old
 * gate. It is "your wheels are in the water", not "you are under the water".
 *
 * No DOM, no three.js, no timers of its own: feed it the car and the surface record the
 * frame already computed. tools/bench-rescue.mjs drives it against the real world.
 */

import { waterLevelAt } from '../world/biomes.js';

/** Metres of water over the ground before your wheels are in it rather than splashing through
 *  it. See the 2026-07-27 note above for why this is 0.25 and not 0. */
const CONTACT = 0.25;
/** Seconds in the water before the rescue arms. Short enough that a clipped shoreline at
 *  60 km/h (four metres of water) still passes straight through it without arming. */
const HOLD = 0.25;
/** Seconds between arming and being placed, spent bleeding the car to a stop. A beat, so the
 *  move reads as the car being lifted out rather than the game glitching. */
const LIFT = 0.35;
/** Seconds after a rescue during which it cannot arm again, so a lakeside road cannot loop. */
const COOLDOWN = 3.0;
/** Seconds since the previous rescue under which the next one stops being polite about your
 *  heading and points you down the road. See _place(). */
const REAIM_AFTER = 12.0;
/** Road membership above which we keep our hands off entirely. Matches streak.js's ON_ROAD. */
const ON_ROAD = 0.45;
/** Time constant for the settle. 0.28 s is "the car comes to rest", not "the car stops dead".
 *  Deliberately NOT shortened alongside LIFT: over the new 0.35 s window it bleeds the car to
 *  about 29% of its speed rather than the old ~3%, which looks like slowing down in water. Made
 *  proportionally sharper it would look like hitting a wall, and it is cosmetic either way —
 *  vehicle.js's placeAt() zeroes the velocity outright at the end of it. */
const CALM = 0.28;

/**
 * How deep the water over the car is, in metres, or 0 on dry land.
 *
 * `surf.y` is the FINAL ground height with the road carve already in it, which is what makes
 * this safe on a causeway: `waterLevelAt` returns null the moment the ground it is handed is
 * at or above the water table, so a road lifted clear of a lake reads as dry even though the
 * land either side of it is not.
 */
export function waterDepth(surf) {
  if (!surf || !surf.w) return 0;
  const wy = waterLevelAt(surf.w, surf.y);
  return wy === null ? 0 : wy - surf.y;
}

export class Rescue {
  /**
   * @param {object} opts
   * @param {Function} opts.recover  called to actually move the car — main.js hands us its
   *                                 own backToRoad(), so where the automatic rescue puts you
   *                                 and where R puts you cannot drift apart. What happens to
   *                                 the HEADING afterwards is ours, and only ours: see
   *                                 _place().
   * @param {Function} [opts.say]    one short line of HUD text
   * @param {boolean} [opts.keepHeading]  leave the driver's heading alone on the way out.
   *                                 Only ever false so a bench can measure the old snap.
   */
  constructor({ recover, say = null, contact = CONTACT, hold = HOLD, lift = LIFT, cooldown = COOLDOWN,
                keepHeading = true } = {}) {
    this.recover = recover;
    this.say = say;
    this.contact = contact;
    this.hold = hold;
    this.lift = lift;
    this.cooldown = cooldown;
    this.keepHeading = keepHeading;

    /** 'dry' | 'sinking' | 'lifting' | 'settling' */
    this.state = 'dry';
    /** Seconds in the current state. */
    this.t = 0;
    /** Metres of water over the car right now — read by the debug overlay and the bench. */
    this.depth = 0;
    /** Seconds since the last placement. Survives reset() on purpose — it is what tells the
     *  next rescue whether this is a one-off or the same corner catching you again. */
    this.since = Infinity;
  }

  reset() {
    this.state = 'dry';
    this.t = 0;
    this.depth = 0;
  }

  /**
   * Put the car back, and decide what to do with the heading.
   *
   * `recover` is main.js's backToRoad(), which faces you along the centreline. That is right
   * for R: you PRESSED R, so you asked to be pointed down the road. Nobody asks for this one,
   * so it takes as little as it can — the car goes back on the tarmac and the way you were
   * pointing is left alone.
   *
   * That is not manners, it is measured. Re-aiming throws away the steering the driver was
   * already applying, and that steering is usually the thing carrying them clear: over the
   * 76-start sweep in tools/diag-c3.mjs, re-aiming along the centreline left the car back in
   * the water at the end of the run 16 times out of 20 wet starts, against 3 when the heading
   * was left alone. It also silently undoes a manoeuvre in progress — a U-turn beside a lake
   * came out as 86° of turn instead of 147°, because the rescue had reset the heading it was
   * being measured against.
   *
   * The exception is the second rescue in a row. If the water has you again within
   * REAIM_AFTER seconds then the way you were pointing is the way that keeps putting you
   * there, and being gentle about it twice is a loop rather than a kindness — driving
   * straight at a lake on full throttle measured 3.3 rescues a site in 20 s, which is as
   * often as the cooldown physically allows. So the repeat offender gets pointed down the
   * road, and the loop closes after one.
   *
   * Measured over the same sweep (tools/diag-c3.mjs), against the version that always
   * snapped: 54 -> 66 of 76 U-turns survive, and driving straight into a lake on full
   * throttle leaves 1 car in the water after 20 s instead of 3, with 7 back on the
   * carriageway instead of 4. Both halves got better, so this is not a trade.
   */
  _place(car) {
    const gentle = this.since > REAIM_AFTER;
    const x = car.x, z = car.z, yaw = car.yaw;
    this.recover();
    this.since = 0;
    if (!this.keepHeading) return; // the original snap, kept so a bench can measure against it

    /* Only touch the heading if the recovery actually moved the car. recover() gives up when
     * it cannot find anywhere to put you, and then there is no heading to fix — placeAt would
     * just freeze the car where it already is, at the bottom of a lake.
     *
     * Calling placeAt a second time is otherwise cheap: it lands on the position recover()
     * has just chosen and changes nothing but the yaw. The chase camera does not care about
     * the order — chase.reset() arms a snap for the NEXT camera update, which is after this. */
    if (car.x === x && car.z === z) return;
    if (gentle) return void car.placeAt(car.x, car.z, yaw);

    /* Firm, but still not rude. A road has two directions and recover() always picks the
     * edge's stored one, so half the time "facing along the road" means being spun round to
     * face back the way you came. Take the direction NEARER to the way the driver was
     * pointing: it breaks the loop just as well, because either way you are aimed down the
     * tarmac rather than at the lake.
     *
     * The car's forward vector is (sin yaw, cos yaw); a negative dot with the edge tangent
     * means that tangent runs back past you. This is the same test the road-following
     * controller in tools/bench-drive.mjs makes, and the sign is copied from there rather
     * than reasoned out — three.js puts +X on your left looking down +Z, and that handedness
     * has inverted steering, cross-track error and lateral offset in this project already. */
    const s = car.terrain ? car.terrain.surface(car.x, car.z) : null;
    if (!s || !isFinite(s.roadDist)) return;
    let tx = s.roadTx, tz = s.roadTz;
    if (Math.sin(yaw) * tx + Math.cos(yaw) * tz < 0) { tx = -tx; tz = -tz; }
    car.placeAt(car.x, car.z, Math.atan2(tx, tz));
  }

  /**
   * @param {number} dt
   * @param {object} car   a car/vehicle.js Vehicle
   * @param {object} surf  car.terrain.surface(car.x, car.z) — the one the frame already has
   * @returns {boolean} true on the single frame the car is placed back on the road
   */
  update(dt, car, surf) {
    const d = waterDepth(surf);
    this.depth = d;
    this.since += dt;
    /* BOTH gates, and the road one is the load-bearing half. A road in this world can run nine
     * metres from deep water, and `surf.y` is the FINAL ground height with the road carve
     * already in it — so a causeway reads as dry however much lake is either side of it, and a
     * driver who is legitimately ON the carriageway is never touched no matter what the water
     * beside them is doing. Lowering the depth gate does not weaken that at all; it is a
     * separate test and it is still first past the post. */
    const inWater = d > this.contact && (surf ? surf.onRoad : 0) < ON_ROAD;

    if (this.state === 'dry') {
      // The timer runs on being IN it, not on having been in it: come back out and it starts
      // again from nothing. That is what lets a ford or a clipped shoreline through.
      if (inWater) {
        this.t += dt;
        if (this.t >= this.hold) {
          this.state = 'lifting';
          this.t = 0;
          if (this.say) this.say('the water has you — back to the road', 2.4);
        }
      } else {
        this.t = 0;
      }
      return false;
    }

    if (this.state === 'lifting') {
      /* If they got themselves out — climbed the bank, made it back onto the carriageway, or
       * pressed R while we were counting — then stop, immediately. Finishing a rescue nobody
       * needs is the fighting rule again.
       *
       * This is the SAME condition that armed it, negated, rather than the old `d <= 0`. With
       * a 0.35 s lift there is no room to insist the car be bone dry before we let it go: a
       * driver clawing back up the bank is at wash depth for most of that window and taking
       * them anyway would be exactly the snatch rule 3 forbids. It cannot stick, either — if
       * they slide back in, arming again costs 0.25 s. */
      if (!inWater) {
        this.reset();
        return false;
      }
      // Bleed the car to a stop rather than freezing it, so the moment before the move looks
      // like the car settling in the water instead of the game pausing.
      const k = Math.exp(-dt / CALM);
      car.vx *= k;
      car.vz *= k;
      car.yawRate *= k;
      this.t += dt;
      if (this.t >= this.lift) {
        this.state = 'settling';
        this.t = 0;
        this._place(car);
        return true;
      }
      return false;
    }

    // settling: hands off for a few seconds. A road can run nine metres from a lake in this
    // world, so without this a bad line at the same corner could rescue you twice in a row.
    this.t += dt;
    if (this.t >= this.cooldown) this.reset();
    return false;
  }
}
