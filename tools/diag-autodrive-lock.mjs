/* Cozy Driver — the ten-second auto-drive lock, proven against the REAL classes.
 *
 * Operator, verbatim, in the general instructions for this pass: "Make it so that there's a
 * 10 second cooldown when you go into auto drive mode related to this to break the streak. So
 * you can't just go to auto and off of auto to get an infinite streak."
 *
 * Two things had to change to close that exploit, and this proves both, end to end, against the
 * actual src/game/streak.js and src/car/autopilot.js classes (no mirror, no mock — unlike
 * tools/diag-board.mjs, which had to fake the server because there is no PHP interpreter on this
 * machine, both of these are plain JS modules that import cleanly under Node):
 *
 *   a. entering auto-drive BANKS the streak instead of freezing it (Streak.breakForAutoDrive()),
 *      so flipping on right before a crash no longer costs nothing.
 *   b. once switched on, NEITHER the toggle key/button NOR a bump of the actual steering wheel
 *      can hand control back for ten seconds (Autopilot's TOGGLE_COOLDOWN / cooldownLeft) — the
 *      second half is the one that closes the loophole a lock on the button alone would leave
 *      wide open.
 *
 *   node tools/diag-autodrive-lock.mjs
 */

// The streak persists to localStorage, which does not exist in Node — same stub
// diag-achievements.mjs and diag-manual-streak.mjs already use.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

import { Streak } from '../src/game/streak.js';
import { Autopilot } from '../src/car/autopilot.js';

let fails = 0;
const check = (ok, label, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? ' PASS ' : ' FAIL '} ${label.padEnd(62)} ${detail}`);
};

console.log('\nWanderoad — the ten-second auto-drive lock\n');

/* A fake car that is just enough for both classes to run their REAL logic on:
 *   - Streak.update() reads car.speed, car.onRoadMin, car.onGround.
 *   - Autopilot.update() reads car.speed for the stuck detector, then car.terrain — leaving
 *     terrain unset makes it return null right after the manual-input check, which is exactly
 *     the point: this test is proving the ON/OFF STATE MACHINE, not the steering law (that is
 *     tools/bench-autopilot-safety.mjs's job, on a real road field). */
const car = { speed: 15, onRoadMin: 1, onGround: true, terrain: null };
const surf = { onRoad: 1, roadDist: 0, roadWidth: 7 };
const noInput = { steer: 0, brake: 0, throttle: 0, handbrake: 0 };
const wheelBump = { steer: 0.5, brake: 0, throttle: 0, handbrake: 0 };

console.log('── (a) entering auto-drive banks the streak, not freezes it ──');
{
  const streak = new Streak({ storageKey: 'diag.autodrive-lock.a' });
  const auto = new Autopilot({});

  // Build a real streak past the 250 m threshold the break-event announcement is gated on
  // (src/game/streak.js — the same guard the ordinary off-road break already uses). 40 ticks
  // of 0.5 s at 15 m/s is 300 m, comfortably past the 250 m floor with margin to spare.
  for (let i = 0; i < 40; i++) streak.update(0.5, car, surf, { paused: false, forgive: false });
  const distBefore = streak.distance;
  check(distBefore > 250, 'built a real streak past the 250 m announcement threshold', `${distBefore.toFixed(0)} m`);

  // The exact sequence main.js's toggleAutoDrive() runs: break BEFORE toggle, because toggle()
  // itself is what flips auto.on and there is no other way to know "this call is an entry".
  streak.breakForAutoDrive();
  const nowOn = auto.toggle(car);

  check(streak.distance === 0, 'the streak is banked to zero the instant auto-drive switches on', `distance now ${streak.distance}`);
  check(nowOn === true, 'the toggle really did switch auto-drive on', `auto.on = ${auto.on}`);

  const ev = streak.drain();
  check(!!ev && ev.kind === 'break' && ev.auto === true, 'a break event queued, tagged auto:true', JSON.stringify(ev));
  check(ev?.distance > 250, 'the event carries the distance that was actually banked', `${ev?.distance?.toFixed(0)} m`);
}

console.log('\n── (a, negative) a streak too short to announce still banks silently ──');
{
  const streak = new Streak({ storageKey: 'diag.autodrive-lock.a2' });
  const auto = new Autopilot({});
  streak.update(0.5, car, surf, { paused: false, forgive: false }); // ~7.5 m — well under 250
  const distBefore = streak.distance;
  streak.breakForAutoDrive();
  auto.toggle(car);
  check(distBefore > 0 && distBefore < 250, 'sanity: this run really is under the announcement floor', `${distBefore.toFixed(1)} m`);
  check(streak.distance === 0, 'a short run is still banked to zero unconditionally', `distance now ${streak.distance}`);
  check(streak.drain() === null, 'but it is NOT worth a toast — no event queued', 'drain() empty');
}

console.log('\n── (b) the lock reads exactly TOGGLE_COOLDOWN on activation ──');
{
  const auto = new Autopilot({});
  check(auto.cooldownLeft === 0, 'resting state: no lock before anything has happened', `${auto.cooldownLeft}`);
  auto.toggle(car);
  check(auto.cooldownLeft === 10, 'switching on starts the lock at exactly ten seconds', `${auto.cooldownLeft}`);
}

console.log("\n── (b) neither the button NOR the wheel can end it early ──");
{
  const auto = new Autopilot({});
  auto.toggle(car); // on, cooldownLeft = 10

  // ~2 seconds of ordinary driving with the wheel untouched.
  for (let i = 0; i < 20; i++) auto.update(car, noInput, 0.1);
  check(auto.cooldownLeft > 7.5 && auto.cooldownLeft < 8.5, 'the lock counts down in real time', `${auto.cooldownLeft.toFixed(2)}s left`);

  // Half one of the loophole: pressing the SAME button again.
  const stillOn = auto.toggle(car);
  check(stillOn === true && auto.on === true, 'the toggle key/button is refused while the lock is up', `auto.on = ${auto.on}`);

  // Half two, the one a button-only lock would miss entirely: just bump the wheel. (This fake
  // car has no terrain, so update() returns null regardless — see the car/surf comment at the
  // top of this file for why that is fine: the state machine is what this block proves, not the
  // steering output, which is bench-autopilot-safety.mjs's job against a real road field.)
  auto.update(car, wheelBump, 0.1);
  check(auto.on === true, 'a manual steering nudge ALSO cannot end it early', `auto.on = ${auto.on}`);
}

console.log('\n── (b) it releases cleanly once ten real seconds have passed ──');
{
  const auto = new Autopilot({});
  auto.toggle(car); // on, cooldownLeft = 10
  for (let i = 0; i < 105; i++) auto.update(car, noInput, 0.1); // 10.5 s of ordinary driving
  check(auto.cooldownLeft === 0, 'the lock has fully counted down', `${auto.cooldownLeft}`);
  const off = auto.toggle(car);
  check(off === false && auto.on === false, 'the SAME button now switches it off, cleanly', `auto.on = ${auto.on}`);
  check(auto.cooldownLeft === 0, 'switching off leaves no lock behind for next time', `${auto.cooldownLeft}`);
}

console.log('\n── (b) once expired, a genuine wheel input still hands control back (unchanged) ──');
{
  // This is the ORIGINAL, pre-existing behaviour (autopilot.js's "any real input hands control
  // straight back") — proving the lock did not just silently disable it for good once the ten
  // seconds are up, only suppress it WHILE they are running.
  const auto = new Autopilot({});
  auto.toggle(car);
  for (let i = 0; i < 105; i++) auto.update(car, noInput, 0.1); // past the lock
  const out = auto.update(car, wheelBump, 0.1);
  check(auto.on === false, 'a real steering input after the lock expires hands control back, same as ever', `auto.on = ${auto.on}, lastReason "${auto.lastReason}"`);
  check(out === null, 'and update() returns null the same way it always did for "you took over"', String(out));
}

console.log('\n── (b) a fresh activation always gets a full, un-stale lock ──');
{
  const auto = new Autopilot({});
  auto.toggle(car); // on
  for (let i = 0; i < 30; i++) auto.update(car, noInput, 0.1); // partway through the lock, ~7s left
  auto.update(car, wheelBump, 0.1); // still locked, ignored — auto.on stays true
  for (let i = 0; i < 105; i++) auto.update(car, noInput, 0.1); // run the lock all the way out
  auto.update(car, wheelBump, 0.1); // NOW a real hand-back — switches off
  check(auto.on === false, 'sanity: the autopilot is off again before the second activation', `${auto.on}`);
  auto.toggle(car); // a SECOND activation
  check(auto.cooldownLeft === 10, 'the second activation gets its own full ten seconds, not a leftover', `${auto.cooldownLeft}`);
}

console.log(`\n${fails === 0 ? 'autodrive lock: OK' : `autodrive lock: ${fails} FAILED`}\n`);
process.exit(fails === 0 ? 0 : 1);
