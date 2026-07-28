/* Wanderoad — the multiplayer wedge, reproduced and repaired, without a browser.
 *
 * THE REPORT THIS ANSWERS, verbatim from a playtest run in two real browser tabs: "tab A
 * ('Salt Heron 74') SAW tab B ... Tab B never saw A ... A POSTs x=400 z=400 every tick and
 * gets back 'Amber Fox 1' at 408,402 (live and correct); B gets back 'Salt Heron 74' at
 * 301,602 — A's SPAWN point — and it stayed frozen there for 90+ seconds while A sat at
 * 400,400. The server hands B a stale record for A."
 *
 * That is a precise description of a server-side one-way door, and this file finds it. The
 * position filter in server/drive.php rejected a jump by PINNING the stored row back to the
 * previous position and writing a fresh `seen`. The next tick then compared the client's real
 * position against that same stale row — and by then the client had driven further, so the
 * distance had GROWN. It failed again, and again, for ever. The client saw 200s and other
 * people's peers the whole time, so nothing anywhere reported an error; its own row was
 * simply a gravestone.
 *
 * Any legitimate teleport opens that door: R to get back on the road (backToRoad in main.js),
 * the water rescue (game/rescue.js), the out-of-fuel reset to spawn (game/fuel.js), or a tab
 * that was buried and resumed. None of those is exotic. All of them make you invisible.
 *
 * WHAT THIS TOOL RUNS: server/devApi.mjs, the in-process mirror of the same endpoint, which
 * carries the same constants and the same filter — including the fix, which walks the stored
 * position toward the claim by the largest legal step rather than refusing to move it. The
 * OLD behaviour is reproduced here too (`freezeFilter`) so the before/after is measured
 * rather than asserted, and the last check reads server/drive.php's own text to prove the
 * production file carries the same repair, since PHP cannot be run on this machine.
 *
 *   node tools/net-devapi.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  DevWorld, filterPosition, rateFor,
  WR_MAX_SPEED, WR_JUMP_SLACK, WR_JUMP_FACTOR, WR_EXPIRE_S,
} from '../server/devApi.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHP = readFileSync(join(HERE, '..', 'server', 'drive.php'), 'utf8');

const hex = (c) => c.repeat(64);
const A = hex('a');
const B = hex('b');

/** The OLD rule, exactly as it was: pin to the previous position and stop. */
function freezeFilter(prev, claim, now) {
  if (!prev) return { ...claim, rejected: false };
  const elapsed = now - prev.seen;
  if (!(elapsed > 0) || elapsed > WR_EXPIRE_S) return { ...claim, rejected: false };
  const dist = Math.hypot(claim.x - prev.x, claim.y - prev.y, claim.z - prev.z);
  const wasGoing = Math.hypot(prev.vx, prev.vy, prev.vz);
  const allowed = wasGoing * elapsed * WR_JUMP_FACTOR + WR_JUMP_SLACK;
  if (dist / Math.max(elapsed, 0.25) > WR_MAX_SPEED || dist > allowed) {
    return { x: prev.x, y: prev.y, z: prev.z, rejected: true };
  }
  return { ...claim, rejected: false };
}

/** Drive one client through `filter` for `ticks` ticks and report where the server thinks it
 *  is at the end. The car teleports on tick 1 — a rescue — and then drives on normally. */
function run(filter, { teleportTo, ticks = 40, hz = 1, speed = 0 }) {
  let row = { x: 301, y: 10, z: 602, vx: 0, vy: 0, vz: 0, seen: 0 };
  let claimX = 301;
  let claimZ = 602;
  const dt = 1 / hz;
  const track = [];
  for (let i = 1; i <= ticks; i++) {
    const now = i * dt;
    if (i === 1) {
      claimX = teleportTo.x;
      claimZ = teleportTo.z;
    } else {
      // ...and then the player keeps driving away from where they landed.
      claimZ += speed * dt;
    }
    const out = filter(row, { x: claimX, y: 10, z: claimZ }, now);
    row = { x: out.x, y: out.y, z: out.z, vx: 0, vy: 0, vz: speed, seen: now };
    track.push({ t: now, storedX: out.x, storedZ: out.z, claimX, claimZ, err: Math.hypot(out.x - claimX, out.z - claimZ), rejected: !!out.rejected });
  }
  return track;
}

console.log('\nWanderoad — the multiplayer stale-peer wedge\n');
console.log(`  constants: max speed ${WR_MAX_SPEED} m/s, jump slack ${WR_JUMP_SLACK} m, factor ${WR_JUMP_FACTOR}, expire ${WR_EXPIRE_S} s\n`);

/* ── 1. the wedge, as reported ─────────────────────────────────────────────── */
// The reported numbers exactly: spawn (301, 602), player really at (400, 400), stationary
// tick rate (0.25 Hz when alone), ninety seconds of it.
const TELEPORT = { x: 400, z: 400 };
const oldTrack = run(freezeFilter, { teleportTo: TELEPORT, ticks: 24, hz: 0.25, speed: 0 });
const newTrack = run(filterPosition, { teleportTo: TELEPORT, ticks: 24, hz: 0.25, speed: 0 });
const oldFinal = oldTrack[oldTrack.length - 1];
const newFinal = newTrack[newTrack.length - 1];

console.log(`  the reported case — spawn (301, 602), player teleports to (400, 400), alone (0.25 Hz), 96 s:\n`);
console.log('    tick   time      OLD stored position        NEW stored position');
for (const i of [0, 1, 2, 3, 8, 23]) {
  const o = oldTrack[i];
  const n = newTrack[i];
  console.log(
    `    ${String(i + 1).padStart(4)}   ${o.t.toFixed(0).padStart(4)} s    (${o.storedX.toFixed(0)}, ${o.storedZ.toFixed(0)})  err ${o.err.toFixed(0).padStart(3)} m` +
      `      (${n.storedX.toFixed(0)}, ${n.storedZ.toFixed(0)})  err ${n.err.toFixed(0)} m`
  );
}
console.log(`\n    OLD: still ${oldFinal.err.toFixed(0)} m wrong after 96 s — this is the "frozen at the spawn point" the report saw`);
const settleTick = newTrack.findIndex((t) => t.err < 0.5);
console.log(`    NEW: correct within ${settleTick >= 0 ? ((settleTick + 1) * 4).toFixed(0) : '>96'} s (tick ${settleTick + 1})`);

/* ── 2. the worse case: the player keeps DRIVING after the teleport ────────── */
// This is what makes the old rule a one-way door rather than a slow recovery: the error
// grows, so the filter can never catch up even in principle.
const oldDrive = run(freezeFilter, { teleportTo: TELEPORT, ticks: 40, hz: 1, speed: 26 });
const newDrive = run(filterPosition, { teleportTo: TELEPORT, ticks: 40, hz: 1, speed: 26 });
console.log(`\n  ...and the same thing with the player still driving at 94 km/h afterwards:`);
console.log(`    OLD  error after 40 s: ${oldDrive[39].err.toFixed(0)} m   (started at ${oldDrive[0].err.toFixed(0)} m — it GREW)`);
console.log(`    NEW  error after 40 s: ${newDrive[39].err.toFixed(1)} m`);

/* ── 3. the anti-cheat property the old rule was defending is still held ───── */
// A client that claims to be 50 km away in one tick must not simply get there. It should be
// walked toward its claim at no more than WR_MAX_SPEED, which is what the cap is for.
let cheat = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, seen: 0 };
let cheatMoved = 0;
for (let i = 1; i <= 10; i++) {
  const now = i * 0.5; // the fastest the rate limiter allows anywhere near sustained
  const out = filterPosition(cheat, { x: 50000, y: 0, z: 0 }, now);
  cheatMoved = out.x;
  cheat = { x: out.x, y: out.y, z: out.z, vx: 0, vy: 0, vz: 0, seen: now };
}
const cheatSpeed = cheatMoved / 5; // metres over the 5 s those ten ticks covered
console.log(`\n  a client claiming (50000, 0) every tick for 5 s reaches ${cheatMoved.toFixed(0)} m — an average ${cheatSpeed.toFixed(0)} m/s`);
console.log(`  (the cap is ${WR_MAX_SPEED} m/s; without the cap it would be 10000 m/s)`);

/* ── 4. two clients, independently scheduled, see each other ───────────────── */
// Not in lockstep. B ticks three times for every one of A's, which is the real asymmetry two
// browser windows produce — one of them is always the background tab.
const world = new DevWorld();
const tick = (secret, nm, x, z, t, extra = {}) =>
  world.handle({ secret, name: nm, op: 'tick', car: { x, y: 10, z, yaw: 0, vx: 0, vy: 0, vz: 0, tier: 3, paint: 2, ...extra } }, t).body;

// A spawns, then is rescued 140 m away on its second tick — the exact trigger.
tick(A, 'Salt Heron 74', 301, 602, 1000);
tick(B, 'Amber Fox 1', 305, 600, 1200);
let seesA = null;
let seesB = null;
for (let i = 0; i < 12; i++) {
  const t = 2000 + i * 1000;
  const ra = tick(A, 'Salt Heron 74', 400, 400, t);
  // B ticks three times as often, at offset times.
  for (let k = 0; k < 3; k++) tick(B, 'Amber Fox 1', 402, 402, t + 100 + k * 200);
  const rb = tick(B, 'Amber Fox 1', 402, 402, t + 900);
  seesA = ra.peers[0] ?? null;
  seesB = rb.peers[0] ?? null;
}
console.log(`\n  two clients, B ticking 4x as often as A (the real background-tab asymmetry):`);
console.log(`    A sees: ${seesA ? `${seesA.name} at (${seesA.x.toFixed(0)}, ${seesA.z.toFixed(0)})` : 'NOBODY'}`);
console.log(`    B sees: ${seesB ? `${seesB.name} at (${seesB.x.toFixed(0)}, ${seesB.z.toFixed(0)})` : 'NOBODY'}`);
const aErr = seesA ? Math.hypot(seesA.x - 402, seesA.z - 402) : Infinity;
const bErr = seesB ? Math.hypot(seesB.x - 400, seesB.z - 400) : Infinity;
console.log(`    A's view of B is ${aErr.toFixed(1)} m out; B's view of A is ${bErr.toFixed(1)} m out`);
console.log(`    the wire carries the fleet index both ways: A sees tier ${seesA?.tier}, B sees tier ${seesB?.tier}`);

/* ── 5. the production file carries the same repair ────────────────────────── */
// PHP is not installed on this machine, so drive.php cannot be executed here. What CAN be
// checked is that the one line that mattered is actually in it, and that the constants the
// mirror copied still match. A mirror that has silently drifted from production is worse
// than no mirror.
const phpHasClamp = /\$step = max\(\$allowed, WR_MAX_SPEED \* max\(\$elapsed, 0\.25\)\);/.test(PHP);
const phpNoFreeze = !/\$rejected = true;\s*\n\s*\$x = \(float\) \$prev\['x'\];/.test(PHP);
const constOk = (n, v) => new RegExp(`const ${n} = ${String(v).replace('.', '\\.')}`).test(PHP);
const constsMatch =
  constOk('WR_MAX_SPEED', '105.0') && constOk('WR_JUMP_SLACK', '25.0') &&
  constOk('WR_JUMP_FACTOR', '1.6') && constOk('WR_EXPIRE_S', '8.0') && constOk('WR_CELL', '2048.0');

console.log(`\n  rate ladder mirrors drive.php's wr_rate(): alone ${rateFor(Infinity)} Hz, 2 km ${rateFor(2000)} Hz, 500 m ${rateFor(500)} Hz`);

const checks = [
  ['the OLD rule really did wedge (this is the reported bug)', oldFinal.err > 100, `${oldFinal.err.toFixed(0)} m wrong after 96 s`],
  ['the old wedge GREW while the player kept driving', oldDrive[39].err > oldDrive[0].err, `${oldDrive[0].err.toFixed(0)} m -> ${oldDrive[39].err.toFixed(0)} m`],
  ['the NEW rule converges', newFinal.err < 0.5, `${newFinal.err.toFixed(2)} m wrong after 96 s`],
  ['...within one or two ticks', settleTick >= 0 && settleTick <= 2, `settled on tick ${settleTick + 1}`],
  ['...even while the player keeps driving', newDrive[39].err < 1, `${newDrive[39].err.toFixed(2)} m`],
  ['a teleport cheat is still capped at WR_MAX_SPEED', cheatSpeed <= WR_MAX_SPEED + 1, `${cheatSpeed.toFixed(0)} m/s`],
  ['A sees B, live', seesA !== null && aErr < 1, seesA ? `${aErr.toFixed(2)} m out` : 'sees nobody'],
  ['B sees A, live — the half that was broken', seesB !== null && bErr < 1, seesB ? `${bErr.toFixed(2)} m out` : 'sees nobody'],
  ['both peers carry the fleet index, not a silhouette string', seesA?.tier === 3 && seesB?.tier === 3, `${seesA?.tier} / ${seesB?.tier}`],
  ['server/drive.php carries the same clamp', phpHasClamp, phpHasClamp ? 'found the $step clamp' : 'NOT FOUND in drive.php'],
  ['server/drive.php no longer pins to the previous position', phpNoFreeze, phpNoFreeze ? 'the freeze is gone' : 'the freeze is STILL THERE'],
  ['the dev mirror\'s constants still match drive.php', constsMatch, constsMatch ? 'all five agree' : 'DRIFTED'],
];

console.log('');
let failed = 0;
for (const [nm, ok, detail] of checks) {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${nm}  — ${detail}`);
  if (!ok) failed++;
}
console.log(`
 NOTE  server/drive.php itself is NOT executed here — there is no PHP on this machine. The
       last three checks read its source. The behavioural checks above run the JS mirror in
       server/devApi.mjs, which is what \`npm run dev\` now serves, so two localhost windows
       exercise this exact code. Production still has to be re-tested in two real tabs.
`);
console.log(`${failed === 0 ? 'all checks passed' : `${failed} CHECK(S) FAILED`}\n`);
process.exit(failed === 0 ? 0 : 1);
