/* Wanderoad — proximity fuel sharing and the 3-strikes mercy cap, proven.
 *
 * Operator: "See multiplayer problem? Let them also share gas when close -- so they can team
 * up -- make getting gas much easier at start and slowly harder -- 3x max 'someone gives you
 * a gas can' and then game over (restart og position) so its teamwork to find gas stations
 * and get the furthest from home."
 *
 * Three parts, in order:
 *
 *   A. WIRE — two real Node clients against the LIVE backend, the same technique
 *      tools/net-test.mjs uses. Proves the SHARE_FLAG bit a giver's client sets really
 *      arrives, unmodified, on the receiver's peer response — the one part of this feature
 *      no unit test can substitute for, because it is the only part that touches
 *      server/drive.php's real `flags` column over real HTTPS.
 *
 *   B. GIVE/RECEIVE LOGIC — the REAL Fuel and Remotes classes (src/game/fuel.js,
 *      src/net/remotes.js), imported directly and driven under Node, not reimplemented.
 *      Proves a give is a real transfer: the giver's tank drops by exactly what the
 *      receiver's gains, gated correctly by range and by the giver's own spare fuel, and
 *      counted once per press (a rising edge), not once per snapshot a pulse happens to
 *      still be up for.
 *
 *   C. THE PASSING-DRIVER MERCY — same real Fuel class. Proves the mercy grants exactly
 *      MERCY_MAX times, that the count survives a fresh instance on the same identity (a
 *      lifetime cap, like Streak.best), that the 4th failure calls resetToSpawn() instead of
 *      granting a can, that the reset leaves the tank non-empty and never says anything like
 *      "game over", and that a mercy far from spawn is a bigger top-up than one nearby (the
 *      "make it easier at start, harder later" curve applied to the safety net).
 *
 * Node has no localStorage (the same situation src/net/identity.js's own header comment
 * documents for its secret storage); a tiny in-memory polyfill stands in for it here, exactly
 * the technique that file anticipates ("a player in private mode gets a fresh identity per
 * tab" — degrading gracefully, not crashing, is the same contract this borrows).
 *
 * Usage:
 *   node tools/net-test-fuel-share.mjs                  # wire + logic + mercy
 *   node tools/net-test-fuel-share.mjs --logic-only      # skip the live backend
 *   node tools/net-test-fuel-share.mjs --base http://localhost:8080/api/
 *   node tools/net-test-fuel-share.mjs --quiet
 */

import { Object3D } from 'three';
import { createTransport } from '../src/net/transport.js';
import { createIdentity } from '../src/net/identity.js';
import { Remotes } from '../src/net/remotes.js';
import { U } from '../src/render/uniforms.js';
import { Fuel, SHARE_FLAG, SHARE_RADIUS } from '../src/game/fuel.js';

/* ── options ───────────────────────────────────────────────────────────────*/

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const BASE = opt('base', 'https://crumbtown.org/wanderoad/api/');
const QUIET = argv.includes('--quiet');
const LOGIC_ONLY = argv.includes('--logic-only');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const log = (...a) => {
  if (!QUIET) console.log(...a);
};
function check(ok, what, detail = '') {
  if (!ok) failures++;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
  return ok;
}

/** In-memory stand-in for the one browser API this file's classes reach for that Node does
 *  not have. One Map per instance so two calls in the same process never share state unless
 *  they are given the same key on purpose (see the persistence check in part C). */
function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}

/* ═══ A. wire: does the SHARE_FLAG bit really arrive? ═══════════════════════════════════ */

async function wireTest() {
  log('── A. wire — the SHARE_FLAG bit, over the live backend ─────────────────────────────');
  log(`backend  ${BASE}`);
  // A remote corner of the same "stay away from real players" convention net-test.mjs uses,
  // but a different point, so a concurrent run of that test cannot collide with this one.
  const MEET_X = 1235500;
  const MEET_Z = -985500;

  const giverId = createIdentity('91');
  giverId.setName('fuel-share giver');
  const giver = createTransport({ backend: 'php', phpBase: BASE, identity: giverId });
  const takerId = createIdentity('92');
  takerId.setName('fuel-share taker');
  const taker = createTransport({ backend: 'php', phpBase: BASE, identity: takerId });

  const carAt = (x, z, flags) => ({
    x,
    y: 0,
    z,
    yaw: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yawRate: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    gear: 1,
    tier: 0,
    paint: 0,
    flags,
  });

  async function tick(t, x, z, flags) {
    const res = await t.send({ op: 'tick', cell: `c${Math.round(x / 2048)}_${Math.round(z / 2048)}`, car: carAt(x, z, flags) });
    const backend = t.info().backend;
    if (backend !== 'php') {
      throw new Error(`transport fell back to '${backend}' — the server never answered. last error: ${t.info().lastError}`);
    }
    return res;
  }

  await giver.send({ op: 'bye', cell: 'c0_0', car: {} }).catch(() => {});
  await taker.send({ op: 'bye', cell: 'c0_0', car: {} }).catch(() => {});
  log('waiting out the 8 s presence expiry so both cars legitimately arrive here...');
  await sleep(8600);

  // Establish presence with the flag OFF first, so "the flag arrived set" is a real signal
  // and not just "there happens to be a 4 in the flags field by default".
  await tick(giver, MEET_X, MEET_Z, 0);
  await tick(taker, MEET_X + 5, MEET_Z, 0);
  await sleep(600);
  const before = await tick(taker, MEET_X + 5, MEET_Z, 0);
  const seenBefore = (before.peers || []).find((p) => p.id === giverId.getPlayerId());
  check(!!seenBefore, 'taker sees the giver before any share');
  check(!!seenBefore && (seenBefore.flags & SHARE_FLAG) === 0, 'the flag is OFF before a give', `flags=${seenBefore?.flags}`);

  // Now the giver presses give: exactly what main.js's carPacket() sends while
  // fuel.sharing is true.
  await tick(giver, MEET_X, MEET_Z, SHARE_FLAG);
  await sleep(500);
  const after = await tick(taker, MEET_X + 5, MEET_Z, 0);
  const seenAfter = (after.peers || []).find((p) => p.id === giverId.getPlayerId());

  check(!!seenAfter, 'taker still sees the giver');
  if (seenAfter) {
    check((seenAfter.flags & SHARE_FLAG) !== 0, 'the SHARE_FLAG bit arrived set, over the real wire', `flags=${seenAfter.flags}`);
    const dist = Math.hypot(seenAfter.x - (MEET_X + 5), seenAfter.z - MEET_Z);
    check(dist <= SHARE_RADIUS, 'and the giver is really within SHARE_RADIUS of the taker', `${dist.toFixed(1)} m`);
  }

  await giver.send({ op: 'bye', cell: 'c0_0', car: {} }).catch(() => {});
  await taker.send({ op: 'bye', cell: 'c0_0', car: {} }).catch(() => {});
  log('');
}

/* ═══ B. give/receive: the real Fuel + Remotes classes, a real transfer ═════════════════ */

function logicTestShare() {
  log('── B. logic — a give really costs the giver and really pays the receiver ───────────');
  globalThis.localStorage = makeLocalStorage();

  // The receiver's game: a real Remotes instance (no scene, no renderer — see the header
  // note on why buildGhostCar is stubbed) tracking the giver as a peer, and a real Fuel
  // instance wired to drain shares FROM that Remotes instance exactly like main.js does.
  // A real Object3D, not a duck-typed stub: Remotes._spawn() hands it to a real THREE
  // group's .add(), which expects the real prototype (removeFromParent() and friends).
  const remotes = new Remotes({ scene: null, buildGhostCar: () => new Object3D() });
  const receiver = new Fuel({
    mercyKey: 'net-test-fuel-share.B.receiver',
    incomingShares: () => remotes.drainIncomingShares(),
    say: () => {},
  });
  const giver = new Fuel({ mercyKey: 'net-test-fuel-share.B.giver', say: () => {} });

  // The receiver is "standing" at (10, 0, 0); the giver reports itself at (0, 0, 0), 10 m
  // away — comfortably inside SHARE_RADIUS.
  U.uCamPos.value.set(10, 0, 0);
  const receiverStart = receiver.seconds;
  const giverStart = giver.seconds;

  // ── negative control: no give yet, nobody should gain anything ──
  remotes.ingest(
    [{ id: 'giver1', name: 'giver', tier: 0, paint: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, flags: 0, t: 1000 }],
    1000
  );
  receiver.update(0.1, { speed: 0, throttle: 0, x: 10, z: 0 });
  // Tolerance, not exact equality: update() always burns a sliver of IDLE fuel on every
  // call regardless of sharing (0.14 * dt), which is correct Fuel behaviour, not a leak —
  // the tolerance is well above that sliver and far below any real share amount (~50-70s).
  const NO_SHARE_TOL = 0.1;
  check(
    Math.abs(receiver.seconds - receiverStart) < NO_SHARE_TOL,
    'before any give, the receiver gains nothing',
    `${receiver.seconds.toFixed(2)}s (started ${receiverStart.toFixed(2)}s)`
  );

  // ── the give itself ──
  const gaveOk = giver.tryGiveFuel(10); // 10 m to the "nearest real peer" — within SHARE_RADIUS
  check(gaveOk === true, 'tryGiveFuel() succeeds when someone real is close enough');
  check(giver.sharing === true, 'the giver now carries the share flag');
  const giverAfterGive = giver.seconds;
  check(giverAfterGive < giverStart, 'the GIVER really lost fuel — not a free broadcast', `${giverStart.toFixed(1)}s -> ${giverAfterGive.toFixed(1)}s`);

  // Feed the giver's now-sharing snapshot into the RECEIVER's Remotes — this is what
  // main.js's netTick()/ingest() does with a real server response; here it is done directly
  // so this test does not also have to stand up a fake server.
  remotes.ingest(
    [{ id: 'giver1', name: 'giver', tier: 0, paint: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, flags: SHARE_FLAG, t: 2000 }],
    2000
  );
  const drained = remotes.drainIncomingShares();
  check(drained > 0, 'Remotes detected the rising edge and queued a real gain', `${drained.toFixed(3)} of a tank`);
  check(remotes.drainIncomingShares() === 0, 'draining twice in a row is empty the second time — nothing double-counted');

  // Re-arm and go through Fuel.update()'s own pull path this time, end to end.
  remotes.ingest(
    [{ id: 'giver1', name: 'giver', tier: 0, paint: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, flags: 0, t: 2900 }],
    2900
  ); // flag drops, so the NEXT rise is a fresh edge
  remotes.ingest(
    [{ id: 'giver1', name: 'giver', tier: 0, paint: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, flags: SHARE_FLAG, t: 3000 }],
    3000
  );
  receiver.update(0.1, { speed: 0, throttle: 0, x: 10, z: 0 });
  check(receiver.seconds > receiverStart, 'the RECEIVER really gained fuel via Fuel.update()', `${receiverStart.toFixed(1)}s -> ${receiver.seconds.toFixed(1)}s`);

  const gained = receiver.seconds - receiverStart;
  const spent = giverStart - giverAfterGive;
  check(Math.abs(gained - spent) < 0.5, 'gain and cost are the SAME amount — a real transfer, not two independent gifts', `spent ${spent.toFixed(1)}s, gained ${gained.toFixed(1)}s`);

  // ── holding the pulse across several snapshots must not pay out more than once ──
  const beforeRepeat = receiver.seconds;
  for (let i = 0; i < 4; i++) {
    remotes.ingest(
      [{ id: 'giver1', name: 'giver', tier: 0, paint: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, flags: SHARE_FLAG, t: 3100 + i * 100 }],
      3100 + i * 100
    );
    receiver.update(0.1, { speed: 0, throttle: 0, x: 10, z: 0 });
  }
  check(
    Math.abs(receiver.seconds - beforeRepeat) < NO_SHARE_TOL,
    'a pulse held across several snapshots pays out exactly once, not once per snapshot',
    `${beforeRepeat.toFixed(2)}s -> ${receiver.seconds.toFixed(2)}s (only IDLE burn, no second share)`
  );

  // ── out of range: the flag is set but the sender reports itself far away ──
  const beforeFar = receiver.seconds;
  remotes.ingest(
    [{ id: 'giver1', name: 'giver', tier: 0, paint: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, flags: 0, t: 4000 }],
    4000
  ); // drop the flag first so the next rise is a fresh edge
  U.uCamPos.value.set(10000, 0, 0); // the receiver is now 10 km from where the giver reported
  remotes.ingest(
    [{ id: 'giver1', name: 'giver', tier: 0, paint: 0, x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, throttle: 0, brake: 0, flags: SHARE_FLAG, t: 4100 }],
    4100
  );
  receiver.update(0.1, { speed: 0, throttle: 0, x: 10000, z: 0 });
  check(
    Math.abs(receiver.seconds - beforeFar) < NO_SHARE_TOL,
    'a share flag from far away is not credited, even though it is set',
    `${beforeFar.toFixed(2)}s -> ${receiver.seconds.toFixed(2)}s (only IDLE burn, no credited share)`
  );
  U.uCamPos.value.set(10, 0, 0); // restore for anything after this

  // ── the giver's own refusals ──
  const brokeGiver = new Fuel({ mercyKey: 'net-test-fuel-share.B.broke', say: () => {} });
  brokeGiver.fill(0.1); // below SHARE_FRACTION + MIN_GIVER_RESERVE
  const secondsBeforeRefusal = brokeGiver.seconds;
  check(brokeGiver.tryGiveFuel(5) === false, 'too little spare fuel: the give is refused');
  check(brokeGiver.seconds === secondsBeforeRefusal, 'and refusing costs nothing', `${brokeGiver.seconds.toFixed(1)}s unchanged`);
  check(brokeGiver.sharing === false, 'and the share flag never goes up on a refusal');

  const lonelyGiver = new Fuel({ mercyKey: 'net-test-fuel-share.B.lonely', say: () => {} });
  const secondsBeforeLonely = lonelyGiver.seconds;
  check(lonelyGiver.tryGiveFuel(Infinity) === false, 'nobody in range: the give is refused');
  check(lonelyGiver.seconds === secondsBeforeLonely, 'and costs nothing either', `${lonelyGiver.seconds.toFixed(1)}s unchanged`);

  log('');
}

/* ═══ C. the passing-driver mercy: 3 uses, persisted, then a gentle reset ═══════════════ */

function logicTestMercy() {
  log('── C. the passing-driver mercy — 3 uses, persisted, then a reset ───────────────────');
  globalThis.localStorage = makeLocalStorage();
  const key = 'net-test-fuel-share.C.mercy';

  let resetCalls = 0;
  const messages = [];
  const fuel = new Fuel({
    mercyKey: key,
    say: (t) => messages.push(t),
    resetToSpawn: () => {
      resetCalls++;
    },
  });
  // Near spawn — the world origin is what mercyScarcityMul() actually reads (see the note in
  // fuel.js on why: findSpawn always lands within a few km of it), so this is "close to home".
  const car = { speed: 0, throttle: 0, vy: 0, onRoad: 1, x: 500, z: 0 };

  /** Drains the tank, then drives (stationary, dry) until the rescue branch fires once —
   *  either a mercy or a reset — mirroring exactly how a real dry stop plays out in
   *  Fuel.update(), never poking private state directly. */
  function driveUntilRescueOrReset(f, c) {
    f.fill(0);
    const r0 = f.stats.rescues;
    const s0 = f.stats.resets;
    for (let i = 0; i < 20 && f.stats.rescues === r0 && f.stats.resets === s0; i++) {
      f.update(0.5, c);
    }
  }

  for (let i = 1; i <= 3; i++) {
    driveUntilRescueOrReset(fuel, car);
    check(fuel.stats.rescues === i, `mercy ${i} of 3 granted`, `mercyUsed=${fuel.mercyUsed}`);
    check(fuel.fraction > 0, `mercy ${i} actually topped up the tank`, `fraction=${fuel.fraction.toFixed(2)}`);
    check(resetCalls === 0, `no reset yet after mercy ${i}`);
  }

  driveUntilRescueOrReset(fuel, car);
  check(fuel.stats.resets === 1, 'the 4th failure is a reset, not a 4th rescue', `rescues stayed at ${fuel.stats.rescues}`);
  check(resetCalls === 1, 'resetToSpawn() was actually called');
  check(fuel.fraction > 0, 'the reset leaves the tank non-empty — gentle, not a second emergency on top of the first');
  check(
    !messages.some((m) => /game\s*over|fail(?:ed|ure)?|you\s+lose/i.test(m)),
    'no message anywhere reads like a fail screen — the reset stays gentle in TONE',
    JSON.stringify(messages.slice(-3))
  );
  check(messages.some((m) => /start|home/i.test(m)), 'the reset message says something calm about going back');

  // A 5th failure must not grant a 4th mercy or call resetToSpawn() a second time in one go —
  // it stays a reset every time from here, the lifetime cap doing exactly what it says.
  driveUntilRescueOrReset(fuel, car);
  check(fuel.stats.rescues === 3, 'still exactly 3 rescues ever — a 5th dry stop is also a reset, not a mercy');
  check(fuel.stats.resets === 2, 'and the reset keeps firing every time after that, not just once');

  // Persistence: a FRESH Fuel instance, same key — simulating a reload or a new session.
  const reloaded = new Fuel({ mercyKey: key, say: () => {} });
  check(reloaded.mercyUsed === 3, 'the lifetime count survives a fresh instance, like Streak.best', `mercyUsed=${reloaded.mercyUsed}`);

  log('');
  log('── C2. the mercy fraction itself follows the SAME distance curve as station spacing ─');
  function oneRescueFraction(mercyKey, x) {
    const f = new Fuel({ mercyKey, say: () => {} });
    driveUntilRescueOrReset(f, { speed: 0, throttle: 0, vy: 0, onRoad: 1, x, z: 0 });
    return f.fraction;
  }
  const nearFraction = oneRescueFraction('net-test-fuel-share.C2.near', 500); // 0.5 km out
  const farFraction = oneRescueFraction('net-test-fuel-share.C2.far', 80000); // 80 km out, past the floor
  check(farFraction > nearFraction, 'a mercy far from spawn tops up MORE than one close to home', `near=${nearFraction.toFixed(3)}  far=${farFraction.toFixed(3)}`);
  const ratio = farFraction / nearFraction;
  check(
    Math.abs(ratio - 2.5) < 0.2,
    'and by roughly the 2.5x the station-spacing curve itself floors out at (props.js STATION_FAR_MUL=0.4)',
    `ratio=${ratio.toFixed(2)}`
  );

  log('');
}

/* ═══ the run ═════════════════════════════════════════════════════════════════════════ */

async function main() {
  log('══ wanderoad net-test-fuel-share ════════════════════════════════════════════════════\n');

  if (!LOGIC_ONLY) {
    try {
      await wireTest();
    } catch (err) {
      log(`  wire test could not run: ${err && err.message ? err.message : err}`);
      failures++;
    }
  } else {
    log('(--logic-only: skipping the live-backend wire test)\n');
  }

  logicTestShare();
  logicTestMercy();

  console.log(failures === 0 ? 'OK — proximity sharing and the 3-strikes mercy both check out' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nnet-test-fuel-share could not run:', err && err.message ? err.message : err);
  process.exit(2);
});
