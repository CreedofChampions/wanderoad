/* Wanderoad — two players, one process. The multiplayer proof.
 *
 * Multiplayer had never actually been PLAYED, and the one bug we did find ("2 cars in the
 * same place don't see each other") was invisible from either window: each client looked
 * completely healthy on its own. You cannot test a two-party protocol with one party. So
 * this harness is the second party.
 *
 * It is a NODE client, not a browser one, on purpose:
 *   - it imports src/net/transport.js and src/net/identity.js, the same files the game runs,
 *     so a change that breaks the wire format breaks this too. A re-implementation of the
 *     protocol here would happily keep passing while the game was broken.
 *   - two headless Chromes fight over ports and profiles and take twenty seconds to boot.
 *     This takes about fifteen and needs nothing installed.
 *
 * What it asserts, in order:
 *   0. `?seat=2` really does fork the identity. Two identities in one storage space must
 *      have different secrets and therefore different player ids. This is the bug itself:
 *      one id means the server treats both windows as the same car and correctly excludes
 *      it from its own peer list, so neither window ever sees the other.
 *   1. Interest management hides a player 6 km away — the 2048 m cells are real.
 *   2. Two players parked at the same place appear in EACH OTHER's peer list, with the
 *      position and name the other one actually sent.
 *   3. The adaptive tick rate rises to 2 Hz when they are close, which is the server
 *      independently agreeing that they are near each other.
 *   4. `bye` removes you: the peer list can go down as well as up, so a passing peer list
 *      is not just a table that only ever grows.
 *
 * Usage:
 *   node tools/net-test.mjs                          # against the live backend
 *   node tools/net-test.mjs --base http://localhost:8080/api/
 *   node tools/net-test.mjs --quiet                  # only the verdict
 *
 * It makes real writes to a real server, so it drives out at (1.2e6, -0.9e6) — 1500 km from
 * spawn, where it cannot land in a real player's peer list and clutter their HUD. Both
 * players say `bye` on the way out, and a presence row expires 8 s after its last tick
 * anyway, so nothing is left behind.
 */

import { createTransport } from '../src/net/transport.js';
import { createIdentity } from '../src/net/identity.js';
import { joinUrl, mountInvite, nextSeat } from '../src/net/invite.js';

/* ── options ───────────────────────────────────────────────────────────────*/

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const BASE = opt('base', 'https://crumbtown.org/wanderoad/api/');
const QUIET = argv.includes('--quiet');

/** Somewhere no human is driving. Any point works; a remote one keeps the test out of the way. */
const MEET_X = Number(opt('x', 1234000));
const MEET_Z = Number(opt('z', -987000));
/** 6 km is more than the 3x3 cell neighbourhood (6144 m across) can reach past its centre. */
const FAR_M = 6000;
/** Presence rows die 8 s after the last tick; waiting that out is also what un-freezes the
 *  anti-teleport check, which is how both cars legitimately arrive from 6 km away. */
const EXPIRE_S = 8;

/* ── the two players ───────────────────────────────────────────────────────
 * Exactly what two browser windows on one machine are: the same storage, two seats.
 * Under Node the storage shim is an in-memory Map shared by both, which is the point —
 * if the seat suffix were not applied (it was not, for a while: seatSuffix() was defined
 * and never called) these two would read the same key and come back as one player.
 */

function makeClient(seat, label) {
  const id = createIdentity(seat);
  id.setName(label);
  const transport = createTransport({ backend: 'php', phpBase: BASE, identity: id });
  return {
    seat: seat || '(default)',
    label,
    id,
    playerId: id.getPlayerId(),
    transport,
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    last: null,
  };
}

/** One tick: our car up, the neighbours back. The same payload shape main.js sends. */
async function tick(c, { x, z, vx = 0, vz = 0 }) {
  c.x = x;
  c.z = z;
  c.vx = vx;
  c.vz = vz;
  const res = await c.transport.send({
    op: 'tick',
    // The server recomputes the cell from x/z and ignores this; it is sent because the game
    // sends it, and the harness is only useful while it stays a faithful client.
    cell: `c${Math.round(x / 2048)}_${Math.round(z / 2048)}`,
    car: {
      x,
      y: 0,
      z,
      yaw: Math.atan2(vx, vz),
      vx,
      vy: 0,
      vz,
      yawRate: 0,
      steer: 0,
      throttle: vx || vz ? 0.4 : 0,
      brake: 0,
      gear: 2,
      tier: 0,
      paint: c.id.getLook().paint,
      flags: 0,
    },
  });
  c.last = res;
  const backend = c.transport.info().backend;
  if (backend !== 'php') {
    // The transport falls back to its in-memory 'local' driver when the server is
    // unreachable, and that driver always answers "you are alone" — a silent pass. Catch it.
    throw new Error(
      `transport fell back to '${backend}' — the server never answered. last error: ${c.transport.info().lastError}`
    );
  }
  if (res.rejected) throw new Error(`${c.label}: the server rejected the position as a teleport`);
  return res;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const peerOf = (res, playerId) => (res.peers || []).find((p) => p.id === playerId) || null;

/* ── checks ────────────────────────────────────────────────────────────────*/

let failures = 0;
const log = (...a) => {
  if (!QUIET) console.log(...a);
};

function check(ok, what, detail = '') {
  if (!ok) failures++;
  log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? `  ${detail}` : ''}`);
  return ok;
}

/* ── the join panel, without a browser ─────────────────────────────────────
 * A URL parameter nobody can discover is not a feature, so src/net/invite.js puts the seat
 * link in the Garage. That panel cannot be proved here — only a real browser can say whether
 * a pixel is on screen, and a stylesheet has beaten an element in this project before. What
 * CAN be proved without one is everything that would make it wrong even if it were visible:
 * the link it hands out, the world parameters it carries, and that nothing in it is built
 * hidden. The rest is the orchestrator's browser suite.
 */

function stubDom() {
  const nodes = [];
  const make = (tagName) => {
    const n = {
      tagName,
      style: {},
      attrs: {},
      children: [],
      handlers: {},
      _text: '',
      set textContent(v) {
        this._text = String(v);
      },
      get textContent() {
        return this._text;
      },
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      addEventListener(kind, fn) {
        this.handlers[kind] = fn;
      },
    };
    nodes.push(n);
    return n;
  };
  return { doc: { createElement: make }, host: make('div'), nodes };
}

const flatten = (n) => n.textContent + n.children.map(flatten).join(' ');

function checkJoinPanel() {
  log('\n1. the Garage hands out the seat link');
  const href = 'https://crumbtown.org/wanderoad/?seed=99&terrain=alpine';
  const { doc, host, nodes } = stubDom();
  const section = mountInvite(host, { doc, href, seat: '' });

  check(!!section && host.children.includes(section), 'the panel is attached to the Garage sheet');
  const text = section ? flatten(section) : '';
  const seat = nextSeat('');
  log(`   second window  ${joinUrl(seat, href)}`);
  log(`   a friend       ${joinUrl(null, href)}`);
  check(text.includes(`seat=${seat}`), `the panel shows a seat=${seat} link`);
  check(
    joinUrl(seat, href).includes('seed=99') && joinUrl(seat, href).includes('terrain=alpine'),
    'the link carries the world you are in',
    '(a different seed is a different planet — you would never meet)'
  );
  check(!joinUrl(null, href).includes('seat='), 'the link for another computer asks for no seat');
  check(
    joinUrl('3', 'https://x/?seat=2') === 'https://x/?seat=3',
    'an existing seat is replaced, not appended'
  );
  check(nextSeat('2') === '3', 'a second window can invite a third');
  // Not "the flag is set": nothing in this panel is BUILT hidden. Whether CSS then covers it
  // is a browser question, which is why the panel carries its own inline styles.
  const hiddenNode = nodes.find((n) => n.attrs.hidden !== undefined || n.style.display === 'none');
  check(!hiddenNode, 'nothing in the panel is created hidden');
  check(
    nodes.filter((n) => n.tagName === 'button' && n.handlers.click).length >= 2,
    'copy and open are wired',
    `${nodes.filter((n) => n.tagName === 'button').length} buttons`
  );
}

/* ── the run ───────────────────────────────────────────────────────────────*/

async function main() {
  log('── wanderoad net-test ─────────────────────────────────────────────');
  log(`backend  ${BASE}`);
  log(`meeting  ${MEET_X}, ${MEET_Z}\n`);

  const a = makeClient('', 'net-test seat 1');
  const b = makeClient('2', 'net-test seat 2');

  log('0. two seats are two players');
  log(`   seat ${String(a.seat).padEnd(10)} id ${a.playerId}  name "${a.id.getName()}"`);
  log(`   seat ${String(b.seat).padEnd(10)} id ${b.playerId}  name "${b.id.getName()}"`);
  check(a.id.getSecret() !== b.id.getSecret(), 'the two seats hold different secrets');
  check(
    a.playerId !== b.playerId,
    'the two seats are different player ids',
    '(one id here is the "2 cars cannot see each other" bug)'
  );
  if (failures) {
    // Everything downstream is meaningless if both clients are the same player.
    console.error('\nFAILED: ?seat= does not fork the identity, so there is only one player.');
    process.exit(1);
  }

  checkJoinPanel();

  log('\n2. 6 km apart — interest management should hide them from each other');
  const r1a = await tick(a, { x: MEET_X, z: MEET_Z });
  const r1b = await tick(b, { x: MEET_X + FAR_M, z: MEET_Z });
  log(`   seat 1 at ${MEET_X}, ${MEET_Z}   peers ${r1a.peers.length}  rate ${r1a.rate} Hz`);
  log(`   seat 2 at ${MEET_X + FAR_M}, ${MEET_Z}   peers ${r1b.peers.length}  rate ${r1b.rate} Hz`);
  check(!peerOf(r1a, b.playerId), 'seat 1 cannot see seat 2 from 6 km');
  check(!peerOf(r1b, a.playerId), 'seat 2 cannot see seat 1 from 6 km');
  check(r1a.rate <= 0.25, 'alone, seat 1 ticks at the idle rate', `${r1a.rate} Hz`);

  log(`\n3. waiting out the ${EXPIRE_S} s presence expiry, then driving to the meeting point`);
  // Both rows go stale, which is also what lets a client legitimately reappear somewhere
  // else: drive.php only runs the anti-teleport test while the last report is fresher than
  // the expiry window, because a row older than that was about to be swept anyway.
  await sleep(EXPIRE_S * 1000 + 600);

  // Approach from opposite sides at a plausible 25 m/s, so the jump test sees motion that
  // matches the reported velocity. Three ticks, 600 ms apart: the per-player rate limit is
  // 6 requests per 2 s and two clients share one IP allowance of 40.
  const STEP = 15;
  let r2a = null;
  let r2b = null;
  for (let i = 3; i >= 1; i--) {
    r2a = await tick(a, { x: MEET_X - i * STEP, z: MEET_Z, vx: 25, vz: 0 });
    r2b = await tick(b, { x: MEET_X + i * STEP, z: MEET_Z, vx: -25, vz: 0 });
    log(
      `   t-${i}  seat 1 at ${(MEET_X - i * STEP).toFixed(0)}  sees ${r2a.peers.length}` +
        `   |   seat 2 at ${(MEET_X + i * STEP).toFixed(0)}  sees ${r2b.peers.length}`
    );
    await sleep(700);
  }

  /* Both are parked now, so one more exchange each, in order.
   *
   * A peer list is a snapshot of what the OTHER client last reported, and inside the loop
   * above seat 1 always ticked first — so its answer was cut before seat 2 had moved, and it
   * held seat 2 one step behind. That is correct, and it is also what the interpolator in
   * remotes.js exists to smooth over. It is not what we want to assert against, because
   * "the position arrived intact" then depends on who spoke first. Park them, then let each
   * one speak once after the other has stopped. */
  r2b = await tick(b, { x: b.x, z: b.z, vx: 0, vz: 0 });
  await sleep(700);
  r2a = await tick(a, { x: a.x, z: a.z, vx: 0, vz: 0 });

  log('\n4. each one is in the other’s peer list');
  const bSeenByA = peerOf(r2a, b.playerId);
  const aSeenByB = peerOf(r2b, a.playerId);

  if (bSeenByA) {
    log(
      `   seat 1 sees  id ${bSeenByA.id}  "${bSeenByA.name}"  at ${bSeenByA.x.toFixed(1)}, ${bSeenByA.z.toFixed(1)}` +
        `  v(${bSeenByA.vx.toFixed(1)}, ${bSeenByA.vz.toFixed(1)})` +
        `  ${Math.hypot(bSeenByA.x - a.x, bSeenByA.z - a.z).toFixed(1)} m away`
    );
  }
  if (aSeenByB) {
    log(
      `   seat 2 sees  id ${aSeenByB.id}  "${aSeenByB.name}"  at ${aSeenByB.x.toFixed(1)}, ${aSeenByB.z.toFixed(1)}` +
        `  v(${aSeenByB.vx.toFixed(1)}, ${aSeenByB.vz.toFixed(1)})` +
        `  ${Math.hypot(aSeenByB.x - b.x, aSeenByB.z - b.z).toFixed(1)} m away`
    );
  }

  check(!!bSeenByA, 'seat 1 sees seat 2');
  check(!!aSeenByB, 'seat 2 sees seat 1');
  if (bSeenByA) {
    // The position has to be the one seat 2 actually reported, not merely a number: a
    // server that echoed the requester's own car back would pass a weaker test than this.
    check(
      Math.abs(bSeenByA.x - b.x) < 0.5 && Math.abs(bSeenByA.z - b.z) < 0.5,
      'seat 2’s position arrived intact',
      `sent ${b.x}, ${b.z} — got ${bSeenByA.x}, ${bSeenByA.z}`
    );
    check(bSeenByA.name === b.label, 'seat 2’s name arrived intact', `"${bSeenByA.name}"`);
  }
  if (aSeenByB) {
    check(
      Math.abs(aSeenByB.x - a.x) < 0.5 && Math.abs(aSeenByB.z - a.z) < 0.5,
      'seat 1’s position arrived intact',
      `sent ${a.x}, ${a.z} — got ${aSeenByB.x}, ${aSeenByB.z}`
    );
    check(aSeenByB.name === a.label, 'seat 1’s name arrived intact', `"${aSeenByB.name}"`);
  }
  check(
    r2a.rate >= 2 && r2b.rate >= 2,
    'the server raised the tick rate for a close pass',
    `${r2a.rate} Hz / ${r2b.rate} Hz`
  );

  log('\n5. leaving removes you');
  await sleep(600);
  await b.transport.send({ op: 'bye', cell: `c0_0`, car: {} });
  await sleep(300);
  const r4 = await tick(a, { x: MEET_X, z: MEET_Z, vx: 0, vz: 0 });
  log(`   after seat 2 said bye, seat 1 sees ${r4.peers.length} peer(s)`);
  check(!peerOf(r4, b.playerId), 'seat 2 is gone from seat 1’s peer list');

  // Tidy up after ourselves on a live server.
  await a.transport.send({ op: 'bye', cell: `c0_0`, car: {} }).catch(() => {});

  const strangers = (r2a.peers || []).filter((p) => p.id !== b.playerId);
  if (strangers.length) log(`\n(also out there: ${strangers.map((p) => p.name || p.id).join(', ')})`);

  console.log(
    failures === 0
      ? `\nOK — ${a.playerId} and ${b.playerId} saw each other over ${BASE}`
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nnet-test could not run:', err && err.message ? err.message : err);
  process.exit(2);
});
