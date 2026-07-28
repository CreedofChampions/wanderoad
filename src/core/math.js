/* Wanderoad — core math.
 *
 * Everything in here is deterministic and integer-seeded. The world is infinite and
 * shared between players, so two clients that agree on the seed must agree on the
 * terrain down to the last centimetre: no Math.random, no time-dependent state, no
 * float accumulation across chunks. Every sample is a pure function of (x, z, seed).
 */

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, x) => (b === a ? 0 : (x - a) / (b - a));
export const mix = lerp;

export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** A road runs both ways, so its tangent and its exact opposite are both valid headings to
 *  place something facing along it. This picks whichever of the two is the shorter turn from
 *  `current` — i.e. the one that keeps travelling the same way rather than reversing it.
 *  Used by main.js's backToRoad() so pressing R to recover onto the road never spins the car
 *  around to face back the way it came; see the note at that call site. */
export function closestHeading(current, tangent) {
  return Math.abs(angleDelta(current, tangent)) <= Math.PI / 2 ? tangent : tangent + Math.PI;
}

/** Frame-rate independent exponential approach. `rate` is the fraction closed per second. */
export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Same, but for angles — takes the short way round. */
export function dampAngle(current, target, rate, dt) {
  return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
}

/** Critically damped spring towards `target`. Returns [value, velocity]. */
export function spring(value, velocity, target, stiffness, damping, dt) {
  const a = (target - value) * stiffness - velocity * damping;
  const v = velocity + a * dt;
  return [value + v * dt, v];
}

/* ── integer hashing ───────────────────────────────────────────────────────
 * These are the backbone of determinism. All of them take integers (or values
 * that get floored to integers) and return a well-mixed uint32 / [0,1) float.
 * They are the JS twin of the GLSL hashes in core/glsl.js, so CPU-side collision
 * queries agree with GPU-side displacement.
 */

/** 32-bit integer avalanche (Thomas Wang / murmur finaliser). */
export function hashInt(x) {
  x |= 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = (x + (x << 3)) | 0;
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return x >>> 0;
}

export function hash2i(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(seed | 0, 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

export function hash3i(x, y, z, seed = 0) {
  let h =
    Math.imul(x | 0, 0x8da6b343) ^
    Math.imul(y | 0, 0xd8163841) ^
    Math.imul(z | 0, 0xcb1ab31f) ^
    Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (h ^ (h >>> 15)) >>> 0;
}

/** [0,1) from a 2D integer lattice point. */
export const rand2 = (x, y, seed = 0) => hash2i(x, y, seed) / 4294967296;
/** [0,1) from a 3D integer lattice point. */
export const rand3 = (x, y, z, seed = 0) => hash3i(x, y, z, seed) / 4294967296;

/** A stream PRNG (mulberry32) — for one-shot local work, never for world data. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic per-chunk PRNG: same chunk key + salt always gives the same stream. */
export function chunkRng(cx, cz, seed, salt = 0) {
  return rng(hash3i(cx, cz, salt, seed));
}

/* ── small vector helpers (no allocation in hot paths) ─────────────────────── */

export function len2(x, y) {
  return Math.sqrt(x * x + y * y);
}

/** Signed distance from point p to segment ab, plus the parameter t along ab. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax,
    dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = clamp01(t);
  const qx = ax + dx * t,
    qz = az + dz * t;
  return { d: len2(px - qx, pz - qz), t, x: qx, z: qz };
}

/** Catmull-Rom through 4 control points, t in [0,1] between p1 and p2. */
export function catmull1(p0, p1, p2, p3, t) {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Cubic Hermite — used by the netcode to interpolate remote cars. */
export function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t,
    t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1
  );
}

/** Wrap v into [0, m). Correct for negatives, unlike %. */
export const wrap = (v, m) => ((v % m) + m) % m;

/** Chunk key from world metres. */
export const chunkOf = (v, size) => Math.floor(v / size);

/** Stable string key for a chunk coordinate. */
export const chunkKey = (cx, cz) => `${cx},${cz}`;
