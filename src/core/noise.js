/* Wanderoad — deterministic noise.
 *
 * The pen (Hoshi-no-Tani) seeded its permutation table from a mulberry32 stream, which is
 * fine for one baked valley but not for an infinite world: every client would have to
 * agree on that table, and the table itself limits the world to a 256-unit lattice period.
 *
 * Here the gradients come straight out of an integer hash of the lattice point, so the
 * field is unbounded, seed-parameterised, and identical on every machine. The GLSL twins
 * of pn2/vn2/fbm live in core/glsl.js and use the same construction, so the CPU height we
 * use for wheel collision matches the GPU height we draw.
 */

import { hash2i, hash3i, lerp } from './math.js';

const F = 1 / 4294967296;

/* ── value noise ─────────────────────────────────────────────────────────── */

export function valueNoise2(x, y, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = hash2i(xi, yi, seed) * F;
  const b = hash2i(xi + 1, yi, seed) * F;
  const c = hash2i(xi, yi + 1, seed) * F;
  const d = hash2i(xi + 1, yi + 1, seed) * F;
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/* ── gradient (Perlin) noise ─────────────────────────────────────────────── */

/* Gradient directions come from a fixed 64-entry unit-circle table indexed by the top bits
 * of the lattice hash. The obvious implementation — cos/sin of a hashed angle — is correct
 * but calls two transcendentals per lattice corner, i.e. eight per noise sample, and the
 * heightfield evaluates tens of noise samples per vertex across tens of thousands of
 * vertices per chunk. The table is ~9x faster and, at 64 directions, shows no axis bias
 * the eye can find. The table is a compile-time constant, so it stays deterministic. */
const GDIR = 64;
const GX = new Float32Array(GDIR);
const GY = new Float32Array(GDIR);
for (let i = 0; i < GDIR; i++) {
  const a = (i / GDIR) * 6.283185307179586;
  GX[i] = Math.cos(a);
  GY[i] = Math.sin(a);
}
const GMASK = GDIR - 1;

/** Classic 2D gradient noise, roughly [-1, 1]. */
export function noise2(x, y, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);

  const a = (hash2i(xi, yi, seed) >>> 20) & GMASK;
  const b = (hash2i(xi + 1, yi, seed) >>> 20) & GMASK;
  const c = (hash2i(xi, yi + 1, seed) >>> 20) & GMASK;
  const d = (hash2i(xi + 1, yi + 1, seed) >>> 20) & GMASK;

  const n00 = GX[a] * xf + GY[a] * yf;
  const n10 = GX[b] * (xf - 1) + GY[b] * yf;
  const n01 = GX[c] * xf + GY[c] * (yf - 1);
  const n11 = GX[d] * (xf - 1) + GY[d] * (yf - 1);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.42;
}

/** 3D gradient noise — used for cloud/dust fields, not for the heightfield. */
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    zi = Math.floor(z);
  const xf = x - xi,
    yf = y - yi,
    zf = z - zi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
  const h = (a, b, c) => hash3i(xi + a, yi + b, zi + c, seed) * F;
  const c000 = h(0, 0, 0),
    c100 = h(1, 0, 0),
    c010 = h(0, 1, 0),
    c110 = h(1, 1, 0);
  const c001 = h(0, 0, 1),
    c101 = h(1, 0, 1),
    c011 = h(0, 1, 1),
    c111 = h(1, 1, 1);
  return (
    lerp(
      lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
      lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
      w
    ) *
      2 -
    1
  );
}

/* ── fractal combinations ────────────────────────────────────────────────── */

/** Fractal Brownian motion. Rolling hills, moisture fields, colour break-up. */
export function fbm2(x, y, oct = 5, seed = 0, lac = 2.03, gain = 0.5) {
  let a = 0.5,
    f = 1,
    s = 0,
    n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f, y * f, seed + i * 1013);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}

/** Ridged multifractal. Sharp crests — mountains, dune spines, canyon walls. */
export function ridged(x, y, oct = 5, seed = 0, lac = 2.07, gain = 0.5) {
  let a = 0.5,
    f = 1,
    s = 0,
    n = 0,
    w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(noise2(x * f, y * f, seed + i * 7919));
    v *= v;
    v *= w;
    w = v * 1.6;
    if (w > 1) w = 1;
    else if (w < 0) w = 0;
    s += a * v;
    n += a;
    a *= gain;
    f *= lac;
  }
  return (s / n) * 2 - 1;
}

/** Billowy noise. Rounded lumps — dunes, foam, cloud bellies. */
export function billow(x, y, oct = 4, seed = 0, lac = 2.0, gain = 0.5) {
  let a = 0.5,
    f = 1,
    s = 0,
    n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * Math.abs(noise2(x * f, y * f, seed + i * 3733));
    n += a;
    a *= gain;
    f *= lac;
  }
  return (s / n) * 2 - 1;
}

/** Domain-warped fbm. The single cheapest trick for making noise look hand-drawn. */
export function warpedFbm2(x, y, oct, seed, warp = 1) {
  const qx = fbm2(x + 5.2, y + 1.3, 3, seed + 101);
  const qy = fbm2(x + 9.7, y + 4.1, 3, seed + 227);
  return fbm2(x + warp * qx, y + warp * qy, oct, seed);
}

/**
 * Worley / cellular F1 distance on a unit lattice. Used for rock scatter, lake basins
 * and the coarse city/settlement lattice. Returns { d, cx, cz, id }.
 */
export function worley2(x, y, seed = 0) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  let best = 1e9,
    bx = 0,
    bz = 0,
    bid = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = xi + i,
        gy = yi + j;
      const h = hash2i(gx, gy, seed);
      const ox = (h & 0xffff) / 65536;
      const oy = ((h >>> 16) & 0xffff) / 65536;
      const px = gx + ox,
        py = gy + oy;
      const dx = px - x,
        dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        bx = px;
        bz = py;
        bid = h;
      }
    }
  }
  return { d: Math.sqrt(best), cx: bx, cz: bz, id: bid };
}
