/* Wanderoad — who you are online.
 *
 * There are no accounts. A player is 32 random bytes in localStorage; everything else —
 * the id other cars see, the default name, the paint — is derived from those bytes. That
 * gives us a stable identity across reloads with no login screen and no personal data.
 *
 * Two rules the rest of the netcode depends on:
 *   1. The secret goes in a POST body and nowhere else. Never a URL, never a query string,
 *      never rendered, never logged. Anyone who sees it can drive your car.
 *   2. `playerId` = the first 12 hex of SHA-256(secret). The server derives the same id from
 *      the same secret, so a client cannot claim someone else's id without their secret.
 *
 * SHA-256 is implemented here rather than via `crypto.subtle` because subtle only exists in
 * a secure context — over plain http on a LAN address (how we test on a phone) it is simply
 * undefined. Sixty lines of hashing is cheaper than a whole broken code path.
 */

/* ── SHA-256 ───────────────────────────────────────────────────────────────
 * FIPS 180-4, the textbook form. Checked against the standard "abc" vector.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

function utf8Bytes(str) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

/** SHA-256 of a string (utf-8) or byte array, as 64 lowercase hex characters. */
export function sha256Hex(message) {
  const bytes = typeof message === 'string' ? utf8Bytes(message) : message;
  const ml = bytes.length;
  // Pad to a multiple of 64 leaving room for the 0x80 marker and the 8-byte bit length.
  const buf = new Uint8Array(((((ml + 8) >> 6) + 1) << 6));
  buf.set(bytes);
  buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 8, Math.floor(ml / 536870912)); // high word of ml*8
  dv.setUint32(buf.length - 4, (ml << 3) >>> 0);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, '0');
  return hex;
}

/* ── storage ───────────────────────────────────────────────────────────────
 * localStorage throws outright in Safari private mode and does not exist under Node (the
 * smoke tests import this file), so every access goes through a guarded shim that degrades
 * to an in-memory map. A player in private mode gets a fresh identity per tab — acceptable;
 * a thrown exception on boot is not.
 */

const SECRET_KEY = 'wanderoad.secret';
const NAME_KEY = 'wanderoad.name';
const LOOK_KEY = 'wanderoad.look';

const memory = new Map();

function readStore(key) {
  try {
    const v = globalThis.localStorage?.getItem(key);
    if (v != null) return v;
  } catch {
    /* storage disabled — fall through to the memory copy */
  }
  return memory.has(key) ? memory.get(key) : null;
}

function writeStore(key, value) {
  memory.set(key, value);
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* quota or privacy mode — the memory copy carries this session */
  }
}

/** 32 cryptographic bytes as hex. Falls back to a time+entropy mix only if there is no CSPRNG. */
function freshSecret() {
  const bytes = new Uint8Array(32);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes);
  } else {
    // getRandomValues works even in insecure contexts, so this branch is close to
    // unreachable. Keep it anyway: a weak id beats a crash on boot.
    const soup = `${Date.now()}:${globalThis.performance?.now?.() ?? 0}:${Math.random()}:${Math.random()}`;
    const h = sha256Hex(soup);
    for (let i = 0; i < 32; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  let hex = '';
  for (let i = 0; i < 32; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

/* ── default names ─────────────────────────────────────────────────────────
 * Derived from the id so two players never both boot as "Player", and so the same secret
 * always produces the same name on any device with no round trip.
 */

const ADJ = [
  'Amber', 'Cobalt', 'Dusty', 'Quiet', 'Distant', 'Salt', 'Paper', 'Copper', 'Slow', 'Wandering',
  'Kite', 'Rain', 'Pale', 'Ember', 'Hollow', 'Lantern',
];
const NOUN = [
  'Fox', 'Heron', 'Kestrel', 'Pilot', 'Drifter', 'Sparrow', 'Comet', 'Wren', 'Otter', 'Moth',
  'Rider', 'Finch', 'Marten', 'Hare', 'Swift', 'Crane',
];

function nameFromId(id) {
  const a = parseInt(id.slice(0, 3), 16) % ADJ.length;
  const n = parseInt(id.slice(3, 6), 16) % NOUN.length;
  const tag = parseInt(id.slice(6, 9), 16) % 100;
  return `${ADJ[a]} ${NOUN[n]} ${tag}`;
}

/**
 * Names are drawn above other people's cars, so strip anything that could wreck a
 * one-line label: C0 and C1 controls, zero-width joiners, and the bidi overrides — one
 * RTL override in a name reorders the whole HUD row it sits in.
 */
export function cleanName(raw) {
  let out = '';
  for (const ch of String(raw ?? '')) {
    const c = ch.codePointAt(0);
    if (c < 0x20) continue;
    if (c >= 0x7f && c <= 0x9f) continue;
    if (c >= 0x200b && c <= 0x200f) continue;
    if (c >= 0x2028 && c <= 0x202e) continue;
    if (c >= 0x2066 && c <= 0x2069) continue;
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 18) || 'Wanderer';
}

/* ── seats: two players on one machine ─────────────────────────────────────
 * TWO WINDOWS ON ONE MACHINE WERE THE SAME PLAYER.
 * Identity is a secret in localStorage, and localStorage is shared by every tab of a profile.
 * So opening the game twice produced one playerId, the server excluded it from its own peer
 * list as "self", and neither window ever saw the other — reported as "2 cars in same place
 * don't see each other". It is correct behaviour for one person in two tabs; it is useless
 * for testing multiplayer, and it is wrong for two people sharing a computer.
 *
 * `?seat=2` forks the identity: a separate secret, so a separate player, a separate default
 * name and paint, and nothing else changed. src/net/invite.js hands the link out from the
 * Garage; docs/MULTIPLAYER.md is the long version.
 *
 * This used to be a `seatSuffix()` that nothing ever called — the storage keys below were
 * read unsuffixed, so `?seat=2` was a documented parameter that did nothing at all. The
 * suffix now has exactly one way in: it is baked into an identity when the identity is made.
 */

/** '' for the default player, '.seat2' for seat 2. Sanitised — it becomes a storage key. */
function seatSuffix(seat) {
  const s = String(seat ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 8);
  // Seat 1 IS the default driver, so `?seat=1` has to be the player you already are. The
  // panel calls the unseated window "seat 1"; if that link then handed out a third identity
  // with no name, no paint and no streak, the numbering would be a lie.
  if (s === '' || s === '1') return '';
  return `.seat${s}`;
}

/**
 * The seat this window was opened at, '' for the normal one. A bare `?seat` with no value
 * counts as seat 2: someone typing the parameter from memory wants a second player, and
 * silently handing them the first one is the precise bug this exists to fix.
 * Returns '' under Node, where there is no location.
 */
export function seatFromUrl() {
  try {
    const params = new URLSearchParams(globalThis.location.search);
    if (!params.has('seat')) return '';
    return params.get('seat') || '2';
  } catch {
    return '';
  }
}

/* ── public API ────────────────────────────────────────────────────────────*/

/**
 * One player, backed by three storage keys. A factory rather than three module-level
 * variables because two independent players have to be able to coexist in one process:
 * `?seat=2` needs it in the browser, and tools/net-test.mjs needs two of them in one Node
 * run to prove that two clients actually see each other.
 *
 * @param {string} [seat] '' for the default player, e.g. '2' for a second one
 */
export function createIdentity(seat = '') {
  const suffix = seatSuffix(seat);
  const secretKey = SECRET_KEY + suffix;
  const nameKey = NAME_KEY + suffix;
  const lookKey = LOOK_KEY + suffix;

  let secret = null;
  let id = null;

  /** The 64-hex secret. Created on first call and persisted. Only ever leaves in a POST body. */
  function getSecret() {
    if (secret) return secret;
    let s = readStore(secretKey);
    if (typeof s !== 'string' || !/^[0-9a-f]{64}$/.test(s)) {
      s = freshSecret();
      writeStore(secretKey, s);
    }
    secret = s;
    return s;
  }

  /** 12 hex characters — 48 bits, plenty for a game that tops out at a few thousand cars. */
  function getPlayerId() {
    if (id) return id;
    id = sha256Hex(getSecret()).slice(0, 12);
    return id;
  }

  function getName() {
    const stored = readStore(nameKey);
    return stored ? cleanName(stored) : nameFromId(getPlayerId());
  }

  function setName(raw) {
    const n = cleanName(raw);
    writeStore(nameKey, n);
    return n;
  }

  /** Car appearance. `tier` is the vehicle class index, `paint` the colourway index. */
  function getLook() {
    const raw = readStore(lookKey);
    if (raw) {
      try {
        const o = JSON.parse(raw);
        return { tier: o.tier | 0, paint: o.paint | 0 };
      } catch {
        /* corrupt entry — fall through and re-derive */
      }
    }
    // Seeded from the id so a fresh player is not always car 0 in colour 0.
    return { tier: 0, paint: parseInt(getPlayerId().slice(9, 12), 16) % 8 };
  }

  function setLook(patch = {}) {
    const cur = getLook();
    const next = {
      tier: patch.tier === undefined ? cur.tier : patch.tier | 0,
      paint: patch.paint === undefined ? cur.paint : patch.paint | 0,
    };
    writeStore(lookKey, JSON.stringify(next));
    return next;
  }

  /** Everything the transport needs, in one object. Cheap enough to call per tick. */
  function snapshot() {
    const look = getLook();
    return {
      secret: getSecret(),
      playerId: getPlayerId(),
      name: getName(),
      seat: String(seat ?? ''),
      // `look` as well as the flat pair because main.js reads `identity().look?.paint` — and
      // read it against the old flat-only shape, so it was undefined and every car in the
      // game, local and on the wire, was paint 0. Two cars meeting in the same place being
      // the same colour is a multiplayer bug, not a cosmetic one. Both indices wrap in
      // model.js and loadedCar.js, so no value here can be out of range.
      look,
      tier: look.tier,
      paint: look.paint,
    };
  }

  /** Burn this identity and come back as someone else. Behind the "new driver" button. */
  function reset() {
    secret = null;
    id = null;
    writeStore(secretKey, freshSecret());
    memory.delete(nameKey);
    try {
      globalThis.localStorage?.removeItem(nameKey);
    } catch {
      /* nothing to remove */
    }
    return snapshot();
  }

  return {
    seat: String(seat ?? ''),
    getSecret,
    getPlayerId,
    getName,
    setName,
    getLook,
    setLook,
    identity: snapshot,
    reset,
  };
}

/** The player driving THIS window. `?seat=2` makes it a different one. */
const self = createIdentity(seatFromUrl());

export const getSecret = () => self.getSecret();
export const getPlayerId = () => self.getPlayerId();
export const getName = () => self.getName();
export const setName = (raw) => self.setName(raw);
export const getLook = () => self.getLook();
export const setLook = (patch) => self.setLook(patch);
export const identity = () => self.identity();
export const resetIdentity = () => self.reset();
/** '' in a normal tab, '2' in a `?seat=2` one. The Garage prints it so the seat is visible. */
export const currentSeat = () => self.seat;
