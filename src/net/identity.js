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

/* ── public API ────────────────────────────────────────────────────────────*/

let _secret = null;
let _id = null;

/** The 64-hex secret. Created on first call and persisted. Only ever leaves in a POST body. */
export function getSecret() {
  if (_secret) return _secret;
  let s = readStore(SECRET_KEY);
  if (typeof s !== 'string' || !/^[0-9a-f]{64}$/.test(s)) {
    s = freshSecret();
    writeStore(SECRET_KEY, s);
  }
  _secret = s;
  return s;
}

/** 12 hex characters — 48 bits, plenty for a game that tops out at a few thousand cars. */
export function getPlayerId() {
  if (_id) return _id;
  _id = sha256Hex(getSecret()).slice(0, 12);
  return _id;
}

export function getName() {
  const stored = readStore(NAME_KEY);
  return stored ? cleanName(stored) : nameFromId(getPlayerId());
}

export function setName(raw) {
  const n = cleanName(raw);
  writeStore(NAME_KEY, n);
  return n;
}

/** Car appearance. `tier` is the vehicle class index, `paint` the colourway index. */
export function getLook() {
  const raw = readStore(LOOK_KEY);
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

export function setLook(patch = {}) {
  const cur = getLook();
  const next = {
    tier: patch.tier === undefined ? cur.tier : patch.tier | 0,
    paint: patch.paint === undefined ? cur.paint : patch.paint | 0,
  };
  writeStore(LOOK_KEY, JSON.stringify(next));
  return next;
}

/** Everything the transport needs, in one object. Cheap enough to call per tick. */
export function identity() {
  const look = getLook();
  return {
    secret: getSecret(),
    playerId: getPlayerId(),
    name: getName(),
    tier: look.tier,
    paint: look.paint,
  };
}

/** Burn the identity and come back as someone else. Behind the "new driver" button. */
export function resetIdentity() {
  _secret = null;
  _id = null;
  writeStore(SECRET_KEY, freshSecret());
  memory.delete(NAME_KEY);
  try {
    globalThis.localStorage?.removeItem(NAME_KEY);
  } catch {
    /* nothing to remove */
  }
  return identity();
}
