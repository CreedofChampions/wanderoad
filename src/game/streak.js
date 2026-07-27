/* Wanderoad — the streak.
 *
 * The only scoring in the game, and it is deliberately the gentlest possible one: stay on
 * the road, and the longer you stay the more each kilometre is worth. Go faster and it is
 * worth more still. Put a wheel in the grass and it quietly resets.
 *
 * This is a cozy game, so the rules matter less than the tone:
 *   - Nothing flashes. Nothing counts down. There is no failure state, only a reset.
 *   - Leaving the road is forgiven for half a second, because a wide line through a
 *     switchback is good driving, not a mistake.
 *   - The multiplier climbs slowly and falls instantly. Building one should feel like
 *     something you did, not something the game gave you.
 *   - Milestones are announced once, in one short line, and then never again.
 *
 * Pure and testable: no DOM, no three.js, no timers. Feed it the car and the surface.
 */

import { clamp, clamp01, lerp } from '../core/math.js';

/** Below this the road no longer counts as underneath you. */
const ON_ROAD = 0.45;
/** How long you may be off the carriageway before the streak breaks, in seconds. */
const GRACE = 0.55;
/** Below this speed nothing accrues — parking on a road is not a streak. */
const MIN_SPEED = 8; // m/s, ~29 km/h

/** Multiplier steps and the distance in metres at which each is reached. */
const LADDER = [
  { at: 0, mul: 1.0, label: null },
  { at: 1000, mul: 1.25, label: 'a kilometre without leaving the road' },
  { at: 2500, mul: 1.5, label: 'two and a half' },
  { at: 5000, mul: 2.0, label: 'five kilometres. settling in' },
  { at: 10000, mul: 2.75, label: 'ten. the road is yours' },
  { at: 20000, mul: 3.5, label: 'twenty kilometres' },
  { at: 40000, mul: 4.5, label: 'forty. still going' },
  { at: 80000, mul: 6.0, label: 'eighty kilometres without a wheel off' },
];

/**
 * Speed bonus. Sublinear on purpose: the difference between 60 and 120 km/h should be worth
 * having, the difference between 250 and 300 should not be worth the risk of losing eighty
 * kilometres of streak.
 */
function speedFactor(mps) {
  const kph = mps * 3.6;
  if (kph < 30) return 0;
  return 0.35 + 0.85 * Math.pow(clamp01((kph - 30) / 220), 0.72);
}

export class Streak {
  constructor({ storageKey = 'wanderoad.streak.v1' } = {}) {
    this.storageKey = storageKey;
    this.distance = 0; // metres in the current streak
    this.score = 0; // points in the current streak
    this.total = 0; // points, all time
    this.best = 0; // longest streak ever, metres
    this.bestScore = 0;
    this.multiplier = 1;
    this.onRoad = false;
    this.tier = 0;

    this._off = 0; // seconds spent off the carriageway
    this._announced = 0; // highest ladder index announced this streak
    this._events = []; // drained by the HUD
    this._lastBreakAt = 0;
    this._savedBest = 0; // best as last written to storage — see the note in update()
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.total = +d.total || 0;
      this.best = +d.best || 0;
      this.bestScore = +d.bestScore || 0;
      this._savedBest = this.best;
    } catch {
      // A corrupt or unavailable store is not worth a crash on a cozy driving game.
    }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ total: this.total, best: this.best, bestScore: this.bestScore }));
      this._savedBest = this.best;
    } catch {
      /* private mode, quota, whatever — the streak still works this session */
    }
  }

  /** Everything the HUD needs, in one object. Do not mutate it. */
  get state() {
    return {
      distance: this.distance,
      km: this.distance / 1000,
      score: this.score,
      total: this.total,
      best: this.best,
      bestScore: this.bestScore,
      multiplier: this.multiplier,
      onRoad: this.onRoad,
      grace: this._off > 0 && this._off < GRACE,
      graceLeft: Math.max(0, GRACE - this._off),
      tier: this.tier,
    };
  }

  /** Pop any one-shot messages for the HUD. */
  drain() {
    if (!this._events.length) return null;
    return this._events.shift();
  }

  /**
   * @param {number} dt seconds
   * @param {object} car    the Vehicle — needs .speed, .onGround, .onRoadMin
   * @param {object} surf   the Terrain surface sample at the car's centre — needs .onRoad
   */
  update(dt, car, surf) {
    const speed = Math.abs(car.speed || 0);
    /* surf.onRoad is ONE sample at the car's centre, and a road (6-8.6 m, see TIERS in
     * world/roads.js) is much wider than the car's track (~1.6-1.7 m) — so it stays "on road"
     * long after a wheel has crossed the verge. car.onRoadMin is the worst of the four
     * suspension probes and is vehicle.js's actual on/off-road STATE (see the note by
     * `this.onRoadMin` there); AND-ing it in means one wheel off is enough to break the
     * streak, the way a driver would judge it. `?? 1` is for callers that hand in a bare
     * {speed, onGround} car with no wheel data (tools/bench-streak.mjs's older fixtures, and
     * the synthetic `{ onRoad: 0 }` surf main.js feeds in on a hard impact) — they still work
     * exactly as before. */
    const on = (surf ? surf.onRoad : 0) >= ON_ROAD && (car.onRoadMin ?? 1) >= ON_ROAD && car.onGround !== false;
    this.onRoad = on;

    if (!on) {
      this._off += dt;
      // Airborne over a crest is not "off road" — you left the road upward, which is fine,
      // and punishing it would make every jump a reason not to jump.
      if (car.onGround === false) this._off = Math.min(this._off, GRACE * 0.4);
      if (this._off >= GRACE) {
        if (this.distance > 250) this._events.push({ kind: 'break', distance: this.distance, score: this.score });
        this._commit();
      }
      return;
    }

    this._off = 0;
    if (speed < MIN_SPEED) return;

    const metres = speed * dt;
    this.distance += metres;

    /* The best updates AS YOU DRIVE, not when the streak ends.
     *
     * `best` is what the whole fleet unlocks against, and it used to only move in _commit(),
     * which meant a run that passed 20 km did not unlock the Rally until you crashed. The
     * unlock bar was measured against a number that could not move, so the one display that
     * is supposed to be alive during a run was the one display that sat still. Now the car is
     * earned the moment the wheels roll past the number, which is when it was earned.
     *
     * Storage is a separate question: writing localStorage every frame for a value that
     * changes every frame is pointless, so it is flushed every 250 m of new best (about once
     * every eight seconds at motorway speed) and on _commit()/flush() as before. */
    if (this.distance > this.best) {
      this.best = this.distance;
      if (this.best - this._savedBest > 250) this.save();
    }

    // multiplier from the ladder
    let tier = 0;
    for (let i = LADDER.length - 1; i >= 0; i--) {
      if (this.distance >= LADDER[i].at) {
        tier = i;
        break;
      }
    }
    this.tier = tier;
    // Ease between rungs rather than stepping, so the number on screen never jumps.
    const cur = LADDER[tier];
    const next = LADDER[Math.min(tier + 1, LADDER.length - 1)];
    const span = Math.max(next.at - cur.at, 1);
    const t = clamp01((this.distance - cur.at) / span);
    this.multiplier = lerp(cur.mul, next.mul, t * 0.6); // most of the step lands on arrival

    if (tier > this._announced) {
      this._announced = tier;
      if (cur.label) this._events.push({ kind: 'milestone', text: cur.label, distance: this.distance });
    }

    // Points. Metres × speed factor × multiplier, scaled so a relaxed hour of cruising is a
    // few thousand rather than a few million.
    this.score += metres * speedFactor(speed) * this.multiplier * 0.1;
  }

  /** Bank the current streak and start a new one. */
  _commit() {
    if (this.distance > this.best) this.best = this.distance;
    if (this.score > this.bestScore) this.bestScore = this.score;
    this.total += this.score;
    this.save();
    this.distance = 0;
    this.score = 0;
    this.multiplier = 1;
    this.tier = 0;
    this._announced = 0;
    this._off = 0;
  }

  /** Called on quit / page hide so a long streak is not simply lost. */
  flush() {
    if (this.distance > 0) this._commit();
    else this.save();
  }
}

/** For the HUD: 1 234 -> "1 234", 12 345 -> "12.3k". */
export function fmtScore(n) {
  if (n < 1000) return String(Math.floor(n));
  if (n < 100000) return (n / 1000).toFixed(1) + 'k';
  return Math.round(n / 1000) + 'k';
}

export function fmtDistance(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}
