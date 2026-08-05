/* created by AI */
/* Wanderoad — dirt kickers: the jumps.
 *
 * Operator: "there should be special off-road goodies that you can get, along with jumps that you
 * can take that actually you can jump over."
 *
 * ── WHY A RAMP IS GROUND AND NOT A PROP ──────────────────────────────────────
 * The obvious way to add a jump is a mesh in game/collide.js beside the fences and the bollards.
 * That is the wrong way and it cannot work: a collider in this game is a WALL. It stops you. You
 * would drive at a ramp and bounce off its face, which is the exact opposite of the thing being
 * asked for.
 *
 * A ramp is GROUND. The car finds the world through four wheel probes into `Terrain.surface()`
 * (car/vehicle.js `_probeWheels`), so if `surface()` reports a raised, tilted floor over a small
 * patch, the car drives up it, pitches nose-high because the front wheels report higher ground than
 * the rear ones, and launches when it runs out of ramp — all of it out of machinery that already
 * exists. Not one line of car/vehicle.js changes. Driving off the lip makes `gap > band` on its own
 * (vehicle.js's airborne test), `AIR.extraDelay` is already there specifically so "a deliberate jump
 * off a crest gets its moment of air", and the Warthog's `raid` preset sets `airborne: 0.35` so most
 * of the anti-air assist comes off and the arc stays long.
 *
 * ── WHY NOT `height()` ───────────────────────────────────────────────────────
 * The lift is added in `surface()` and deliberately NOT in `Terrain.height()`. `height()` is what
 * the chunk mesher builds tiles from, so putting ramps there would mean regenerating terrain tiles,
 * fighting the streamer, and re-seaming neighbours — for a 9-metre object. The ramp is drawn as its
 * own small mesh by render/ramps.js instead, and that mesh is built by SAMPLING `rampHeight()`
 * below, so the thing you see and the thing you drive on cannot drift apart. tools/diag-ramps.mjs
 * asserts they agree to the millimetre.
 *
 * ── PLACEMENT ────────────────────────────────────────────────────────────────
 * Pure functions of (x, z, seed), like world/loot.js and world/props.js, so a tile that leaves the
 * streaming window and comes back hands out the SAME ramps rather than inventing new ones. The road
 * arc-walk is loot.js's idiom copied rather than shared — that file's own header sets the rule that
 * each placement domain keeps its own small copy instead of introducing a shared module for three
 * ten-line helpers.
 *
 * Ramps sit BESIDE the road, not on it, and are aligned WITH the road's tangent. Both matter. Beside,
 * because a jump in the middle of the carriageway is a hazard you cannot avoid and this is a cozy
 * game; aligned, because you want to be able to swing off the tarmac and meet the face square rather
 * than clip it at an angle and be thrown sideways.
 */

import { edgesInBox } from './roads.js';
import { hash3i, rng, clamp01 } from '../core/math.js';

/** uint32 -> [0,1). The same constant every other placement hash in this project uses. */
const F32 = 1 / 4294967296;
const SALT_RAMP = 0x524d5031; // 'RMP1'

/** `e.key` is `${tier}:${i},${j},${dir}` — see roads.js buildEdge. Copied from world/loot.js. */
const KEY_RE = /^(\d+):(-?\d+),(-?\d+),(\d+)$/;
function edgeIds(e) {
  const m = KEY_RE.exec(e.key);
  if (!m) return { tier: 0, i: 0, j: 0, dir: 0 };
  return { tier: +m[1], i: +m[2], j: +m[3], dir: +m[4] };
}

/** Cumulative arc length along an edge's polyline. Copied from world/loot.js. */
function arcTable(e) {
  const n = e.pts.length / 2;
  const cum = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    const dx = e.pts[k * 2] - e.pts[k * 2 - 2];
    const dz = e.pts[k * 2 + 1] - e.pts[k * 2 - 1];
    cum[k] = cum[k - 1] + Math.hypot(dx, dz);
  }
  return cum;
}

/** Point and unit tangent at arc length `s`. Copied from world/loot.js. */
function atArc(e, cum, s, out) {
  const n = cum.length;
  let k = 1;
  while (k < n - 1 && cum[k] < s) k++;
  const s0 = cum[k - 1];
  const seg = cum[k] - s0 || 1;
  const t = clamp01((s - s0) / seg);
  const ax = e.pts[k * 2 - 2];
  const az = e.pts[k * 2 - 1];
  const bx = e.pts[k * 2];
  const bz = e.pts[k * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  const l = Math.hypot(bx - ax, bz - az) || 1;
  out.tx = (bx - ax) / l;
  out.tz = (bz - az) / l;
  return out;
}

/* ── the shape of a kicker ────────────────────────────────────────────────────
 *
 * 12 m long, 6.4 m wide, 1.5 m at the lip, with the launch face taking the first 9.4 m of it.
 *
 * THE FACE ANGLE WAS FORCED BY THE PHYSICS, NOT CHOSEN FOR LOOKS, and the first attempt got it
 * wrong in an instructive way. A short steep kicker — 9 m long, a face rising 1.35 m over 6.5 m, a
 * mean 11.8° with a 17.4° peak — looks exactly like a jump and does not work as one. At 55 km/h that
 * face makes the ground under the car rise at about 6.3 m/s, and car/vehicle.js clamps its
 * ground-follow rate (`groundV`) to ±6 m/s to survive chunk seams and teleports. So the car could not
 * follow its own ramp: it sank through the face, bottomed the suspension (`sag` pinned at the full
 * 0.42 m for the entire climb, measured), and arrived at the lip with no spring extension left to
 * launch with. `onGround` never once went false.
 *
 * Spreading the same idea over 12 m fixes it by arithmetic. The face now rises 1.5 m over 9.4 m — a
 * mean 9.1° with a 13.5° peak — which at 55 km/h asks the ground to rise about 3.7 m/s, comfortably
 * inside the clamp and inside what soft springs can track. Ballistically 3.7 m/s of vertical is
 * 2·v/g ≈ 0.75 s of hang time, which is a real jump. A gentler ramp that WORKS beats a steeper ramp
 * that the solver refuses to leave.
 *
 * The other two numbers are set against the car: 12 m is about two and a half Warthog lengths, so it
 * is on the face with all four wheels for a genuine moment rather than pitching over it; and 1.5 m is
 * a little above the top of the Warthog's own 0.58 m wheels, high enough to be an event and low
 * enough that meeting one at 30 km/h in a road car is a thump rather than a crash.
 *
 * THE BACK IS SHORT AND STEEP, ON PURPOSE. A kicker with a gentle slope on both sides is a speed
 * bump, and you cannot launch off a speed bump. But a kicker with a vertical back is a wall you can
 * crash into from the wrong direction. So the back drops 1.5 m over 2.6 m: steep enough that nobody
 * mistakes which way it is meant to be taken, shallow enough that arriving from behind is a jolt you
 * drive over rather than an invisible cliff.
 *
 * Everything is smooth. There is no vertical step anywhere in the height field — a step is what
 * throws a car into the air wrongly and reads as a bug rather than a jump. tools/diag-ramps.mjs
 * walks the whole surface at 0.25 m and asserts the largest single-step rise stays small.
 */
export const RAMP_LEN = 12.0;
export const RAMP_WID = 6.4;
export const RAMP_H = 1.5;
/** Where the lip sits along the ramp, as a fraction of its length from the back edge. */
export const LIP_AT = 0.78;

/** Smoothstep. Zero slope at both ends, which is what keeps the toe and the lip free of steps. */
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * The ramp's height above the natural ground, in metres, at a point already rotated into the ramp's
 * own frame: `lz` runs along the ramp (negative = the approach toe, positive = past the lip) and
 * `lx` runs across it.
 */
export function rampProfile(lx, lz) {
  const hl = RAMP_LEN * 0.5;
  const hw = RAMP_WID * 0.5;
  if (lz <= -hl || lz >= hl || lx <= -hw || lx >= hw) return 0;

  // along the ramp: 0 at the toe, 1 at the lip, back to 0 off the short steep tail
  const u = (lz + hl) / RAMP_LEN;
  let a;
  if (u <= LIP_AT) a = smooth(u / LIP_AT);
  else a = smooth(1 - (u - LIP_AT) / (1 - LIP_AT));

  /* Across the ramp: flat over the middle 40%, then feathered to nothing over the outer 60%, so a
   * wheel that catches the side gets a slope rather than a kerb.
   *
   * THE WIDTH WAS MEASURED, NOT CHOSEN. At 4.4 m the side feather fell the full 1.35 m across 0.88 m,
   * which tools/diag-ramps.mjs caught as a 0.55 m step per 0.25 m of travel — a kerb, not a taper,
   * and exactly the "invisible cliff" this shape is supposed to avoid. Widening to 6.4 m spreads the
   * same fall over 1.6 m and roughly halves it. The flat centre is then 2.56 m against the Warthog's
   * 2.34 m of scaled width, so the car fits on the flat with 0.11 m either side — which is the whole
   * reason a kicker is wider than the vehicle. */
  const t = Math.abs(lx) / hw;
  const b = t <= 0.4 ? 1 : smooth(1 - (t - 0.4) / 0.6);

  return RAMP_H * a * b;
}

/** Candidate slot every this many metres of road arc, and the chance one is taken. */
export const RAMP_SLOT = 520;
export const RAMP_SLOT_P = 0.55;
/** How far off the centreline a kicker sits, in metres, measured from the road EDGE outward. */
export const RAMP_OFFSET_MIN = 5.5;
export const RAMP_OFFSET_MAX = 11.0;
/** Query-box expansion, generous over the largest offset plus half a ramp. */
const RAMP_MAX_OFFSET = RAMP_OFFSET_MAX + RAMP_LEN;

/**
 * Every kicker whose centre lies in the box. Pure in (box, seed): the same arguments always give
 * byte-identical ramps, which is what lets a tile unload and come back unchanged.
 *
 * @returns {Array<{id:string,x:number,z:number,yaw:number,side:number}>}
 */
export function rampsInBox(x0, z0, x1, z1, seed) {
  const out = [];
  const edges = edgesInBox(x0 - RAMP_MAX_OFFSET, z0 - RAMP_MAX_OFFSET, x1 + RAMP_MAX_OFFSET, z1 + RAMP_MAX_OFFSET, seed, 20);
  const at = { x: 0, z: 0, tx: 1, tz: 0 };

  for (const e of edges) {
    const ids = edgeIds(e);
    const cum = arcTable(e);
    const total = cum[cum.length - 1];
    const slots = Math.floor(total / RAMP_SLOT);
    if (slots < 1) continue;
    const key0 = ids.i * 4 + ids.dir * 2 + ids.tier;
    const half = e.width * 0.5;

    for (let s = 0; s < slots; s++) {
      /* Acceptance from a plain hash BEFORE any PRNG stream is built — world/props.js's
       * fuelCansInBox explains why that ordering is the one that keeps the cost down: most slots
       * die on one cheap test and never pay for a generator. */
      if (hash3i(key0, ids.j, s, seed ^ SALT_RAMP) * F32 >= RAMP_SLOT_P) continue;
      const rnd = rng(hash3i(key0, ids.j, s, seed ^ SALT_RAMP ^ 0x5e11c0de));

      const sArc = (s + 0.25 + rnd() * 0.5) * RAMP_SLOT;
      if (sArc > total) continue;
      atArc(e, cum, sArc, at);

      const side = rnd() < 0.5 ? -1 : 1;
      const off = half + RAMP_OFFSET_MIN + rnd() * (RAMP_OFFSET_MAX - RAMP_OFFSET_MIN);
      // the road's left-hand normal is (-tz, tx)
      const x = at.x + side * -at.tz * off;
      const z = at.z + side * at.tx * off;
      if (x < x0 || x > x1 || z < z0 || z > z1) continue;

      /* Aligned with the road, and pointing AWAY from it on the side it sits. You come off the
       * tarmac, meet the face square, and land further out in open country rather than being fired
       * back across the carriageway at something. */
      const yaw = Math.atan2(at.tx, at.tz);
      out.push({ id: `${e.key}:${s}`, x, z, yaw, side });
    }
  }
  return out;
}

/**
 * The nearest kicker to a point, or null. Callers cache the result — `Terrain.surface()` holds one
 * exactly the way it already holds `_apron`, so a probe costs a distance check and nothing else.
 */
export function nearestRamp(x, z, seed, radius = 260) {
  const list = rampsInBox(x - radius, z - radius, x + radius, z + radius, seed);
  let best = null;
  let bd = Infinity;
  for (const r of list) {
    const d = (r.x - x) * (r.x - x) + (r.z - z) * (r.z - z);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

/** Half the diagonal of a ramp's footprint — cheap reject radius before rotating into its frame. */
export const RAMP_REACH = Math.hypot(RAMP_LEN, RAMP_WID) * 0.5;

/**
 * How much a single kicker lifts the ground at (x, z), plus the surface normal there.
 *
 * The normal is taken by CENTRAL DIFFERENCE on `rampProfile` rather than written out analytically.
 * That is deliberate: the profile is a piecewise smoothstep and hand-differentiating it is exactly
 * the kind of thing that goes subtly wrong and leaves a car sliding up a face it should grip. A
 * finite difference cannot disagree with the height field it is sampled from.
 *
 * @returns {{lift:number, nx:number, ny:number, nz:number}} lift 0 means the point is off the ramp.
 */
export function rampLiftAt(ramp, x, z, out = { lift: 0, nx: 0, ny: 1, nz: 0 }) {
  out.lift = 0;
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  if (!ramp) return out;

  const dx = x - ramp.x;
  const dz = z - ramp.z;
  if (dx * dx + dz * dz > RAMP_REACH * RAMP_REACH) return out;

  /* INTO THE RAMP'S OWN FRAME. This game's heading convention is that yaw 0 points along +Z and a
   * car's forward vector is (sin yaw, cos yaw) — car/vehicle.js resolves its longitudinal speed as
   * `vz·cos(yaw) + vx·sin(yaw)`, which is that same basis. So the ramp's forward axis is
   * h = (sin yaw, cos yaw) and its across axis is r = (cos yaw, −sin yaw).
   *
   * This was written as a naive "rotate by −yaw" first and it was wrong in a way that measured
   * perfectly: every renderer/physics agreement check still passed to 0.0000 mm, because BOTH sides
   * were asking the same broken function. What it actually broke was direction — the projection came
   * out as a function of cos(2·yaw), so on most headings the car met the ramp's short steep TAIL
   * first, climbed it backwards and rolled down the long face. tools/diag-ramps.mjs's trace showed
   * exactly that: lift 0 -> 1.20 m and back to 0 in 0.3 s with `onGround` never once false. A jump
   * that is silently installed back-to-front is the sort of thing a "does the height field match"
   * test will never catch, which is why that file also drives a real car at it. */
  const cy = Math.cos(ramp.yaw);
  const sy = Math.sin(ramp.yaw);
  const lz = dx * sy + dz * cy;
  const lx = dx * cy - dz * sy;

  const h = rampProfile(lx, lz);
  if (h <= 0) return out;
  out.lift = h;

  const eps = 0.15;
  const gx = (rampProfile(lx + eps, lz) - rampProfile(lx - eps, lz)) / (2 * eps);
  const gz = (rampProfile(lx, lz + eps) - rampProfile(lx, lz - eps)) / (2 * eps);
  /* The gradient lives in the local (r, h) basis, so the world normal is −gx along r, −gz along h,
   * and 1 up — the same basis used to project the point in, run the other way. Writing it out this
   * way rather than as a second rotation matrix is deliberate: the two must be exact inverses, and
   * the surest way to keep them so is to spell both in terms of the same r and h. */
  const ny = 1;
  const wx = -gx * cy - gz * sy;
  const wz = gx * sy - gz * cy;
  const inv = 1 / Math.hypot(wx, ny, wz);
  out.nx = wx * inv;
  out.ny = ny * inv;
  out.nz = wz * inv;
  return out;
}
