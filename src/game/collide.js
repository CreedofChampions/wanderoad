/* Wanderoad — solid things.
 *
 * The world has three kinds of obstacle and they are handled differently on purpose:
 *
 *   TERRAIN   handled by the vehicle itself — it rides the heightfield, and a slope steep
 *             enough to stop you does so by gravity, not by a wall.
 *   PROPS     tree trunks, and the roadside furniture render/props.js declares a radius for.
 *             These are real: you hit one square and you STOP, and the streak breaks. That
 *             is the whole consequence — no damage, no fail state, no repair bill. It is the
 *             reason staying on the road is a skill and the reason a wood reads as a wood.
 *   OTHER     remote players are GHOSTS and never collide. That one decision removes
 *             authority, contact arbitration and rollback from the whole project, and in a
 *             cozy cruising game being punted off the road by someone else's latency is the
 *             least cozy thing that could possibly happen.
 *
 * Broad phase is a uniform grid keyed on the same 64 m chunk the streamer already uses, so
 * adding and removing solids costs nothing extra as the world streams.
 *
 * TWO RULES THIS FILE EXISTS TO KEEP:
 *
 *   1. NOTHING INVISIBLE IS SOLID. Every collider here belongs to something the player can
 *      see. See `solidsFromScatter` — the scatter produces six prop classes and the renderer
 *      only draws three of them, so the naive "make every prop solid" version put invisible
 *      walls all over the highlands.
 *   2. NOTHING SOLID IS PASSABLE. The narrow phase is SWEPT, not a point test. A point test
 *      only works while one step is shorter than the capture window, and the margin there is
 *      an accident rather than a design: the fastest car covers 2.10 m per solver step
 *      against a 2.65 m window on the thinnest trunk (tools/bench-impact.mjs prints both).
 *      26%. One quicker car, one more substep, one thinner tree and the game has trunks you
 *      can drive through at speed and nowhere obvious to look for why.
 */

import { clamp01 } from '../core/math.js';
import { MAX_SUBSTEPS, PHYSICS_DT } from '../car/tuning.js';

/**
 * The most simulated time one Vehicle.update() can advance, however long the frame was.
 * Imported rather than written down because the day someone raises MAX_SUBSTEPS is the day a
 * hard-coded copy of it starts quietly rejecting real steps as teleports.
 */
const SIM_CAP = MAX_SUBSTEPS * PHYSICS_DT;

/** Metres of penetration below which a hit is ignored — stops jitter against a kerb. */
const EPS = 0.02;
/** Speed under which a collision is a nudge rather than an impact. */
const SOFT = 4;

/**
 * Closing speed, in m/s straight into the obstacle, above which a hit is a DEAD STOP rather
 * than a scrape. 2.5 m/s is about 9 km/h: below it you are nosing into a trunk at walking
 * pace and being frozen would read as a bug, above it you drove into a tree.
 */
const STOP_CLOSING = 2.5;

/**
 * How square a hit has to be to count as driving into the thing rather than past it.
 * `severity` is cos(angle between your velocity and the contact normal), which for a circle
 * is sqrt(1 - (b/minD)^2) where b is how far the trunk centre misses your line by. 0.35
 * therefore means "the outer 6% of the contact band is a graze, everything else is a hit" —
 * deliberately a narrow let-off, because a trunk is a post and not a wall you can lean on.
 */
const GRAZE = 0.35;

/**
 * After a swept hit the car is left this far clear of the thing it hit, so the discrete pass
 * below (and the next frame) sees daylight instead of a permanent contact to fight.
 */
const CLEAR = 0.03;

/**
 * How far the renderer sinks a tree root below the ground it stands on — render/trees.js
 * `Flora._scatter` emits the instance at `p.y - TREE_SINK * scale`. A collider that used the
 * raw scatter `y` would sit up to half a metre above the trunk it is supposed to be.
 */
export const TREE_SINK = 0.35;

/**
 * Per species, the radius of the trunk AS DRAWN, in archetype units — multiply by the
 * instance scale. (TRUNK_H below is the matching nominal height, which is only ever used to
 * ask whether the car is flying over the top of it.)
 *
 * These are MEASURED, not guessed. `node tools/diag-collide.mjs` rebuilds the same archetype
 * meshes the renderer builds, slices each trunk at bumper height and prints the radial
 * extent; the numbers below are the largest of those over the two LODs a level-0 chunk can
 * be drawn at. Measure again if anyone touches `makeTree` — the tool fails if the table has
 * drifted outside the drawn silhouette.
 *
 * The radius encloses the trunk rather than splitting the difference, because the trunks
 * lean: a broadleaf's axis sits ~0.35 off the point the scatter recorded. Enclosing costs
 * you stopping a few tens of centimetres early on the far side of a leaning trunk, which
 * nobody can see past a canopy nine metres wide. Splitting the difference would cost you
 * driving through the trunk, which everybody can see.
 *
 * A species that is not in this table gets NO collider. `scrub` is the only one, and it is
 * out on purpose: it is a 2 m multi-stem bush and being stopped dead by a shrub is the least
 * cozy thing in this file.
 */
export const TRUNK_R = {
  broadleaf: 1.1,
  poplar: 0.89,
  pine: 0.5,
  deadpine: 0.48,
  acacia: 0.88,
  palm: 0.38,
  willow: 0.65,
};
const TRUNK_H = {
  broadleaf: 11.5,
  poplar: 15.0,
  pine: 14.5,
  deadpine: 13.0,
  acacia: 9.5,
  palm: 12.5,
  willow: 9.5,
};

export class Solids {
  constructor({ cell = 64 } = {}) {
    this.cell = cell;
    /** Map "cx,cz" -> array of {x, z, r, h, kind, chunk} */
    this.grid = new Map();
    /** Map chunkKey -> the list we inserted, so removal is exact */
    this.byChunk = new Map();
    this.lastHit = null;
    /* Where the car was when we last looked. The narrow phase sweeps from here, so this is
     * state the collider owns rather than something the caller has to remember. */
    this._px = null;
    this._pz = null;
  }

  _key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  /**
   * Register the solid props of a streamed chunk.
   * @param {string} chunkKey
   * @param {Array<{x:number,z:number,y:number,r:number,h:number,kind:string}>} list
   */
  addChunk(chunkKey, list) {
    if (this.byChunk.has(chunkKey)) this.removeChunk(chunkKey);
    if (!list || !list.length) return;
    this.byChunk.set(chunkKey, list);
    for (const s of list) {
      const k = this._key(s.x, s.z);
      let bucket = this.grid.get(k);
      if (!bucket) {
        bucket = [];
        this.grid.set(k, bucket);
      }
      bucket.push(s);
    }
  }

  removeChunk(chunkKey) {
    const list = this.byChunk.get(chunkKey);
    if (!list) return;
    for (const s of list) {
      const k = this._key(s.x, s.z);
      const bucket = this.grid.get(k);
      if (!bucket) continue;
      const i = bucket.indexOf(s);
      if (i >= 0) bucket.splice(i, 1);
      if (!bucket.length) this.grid.delete(k);
    }
    this.byChunk.delete(chunkKey);
  }

  clear() {
    this.grid.clear();
    this.byChunk.clear();
    this._px = this._pz = null;
  }

  get count() {
    let n = 0;
    for (const l of this.byChunk.values()) n += l.length;
    return n;
  }

  /**
   * Resolve the car against everything nearby. Mutates the car's position and velocity.
   *
   * Two passes. The first is SWEPT: the solver integrates position at the END of
   * Vehicle.update, so by the time we are called the car has already moved through whatever
   * it was going to hit, and a point test at the new position simply misses it. It finds the
   * FIRST thing the step crossed and puts the car back at the moment of contact. The second
   * is the old discrete overlap pass, which handles resting contact and being wedged between
   * two trunks.
   *
   * The response is deliberately two-valued: drive into something and you stop dead, brush
   * past it and you slide along and lose a little speed. Nothing here can flip or launch the
   * car — being thrown into the sky by a shrub is funny once and infuriating afterwards.
   *
   * @returns {null|{kind:string, speed:number, severity:number}} the worst hit this step
   */
  resolve(car, radius = 1.05, dt = 1 / 60) {
    const cx = Math.floor(car.x / this.cell);
    const cz = Math.floor(car.z / this.cell);
    let worst = null;

    /* ── 1. the sweep ──────────────────────────────────────────────────────
     * Only when the step looks like driving. A respawn moves the car hundreds of metres with
     * the velocity zeroed, and sweeping that line would report a hit on every tree between
     * here and there — a phantom impact of the purest kind.
     *
     * The budget is the furthest the car could plausibly have driven. `dt` is what the FRAME
     * thought elapsed; SIM_CAP is what the SOLVER will advance in one update call, and on a
     * short frame following a long one the second is the bigger of the two, because
     * Vehicle.update is finishing substeps the frame's own dt knows nothing about. Take
     * whichever is larger. Erring generous costs nothing: the thing this guards against is a
     * placeAt, which always arrives with the velocity zeroed, so its budget is the 0.5 m of
     * slack and nothing else — three orders of magnitude short of a respawn. */
    const px = this._px;
    const pz = this._pz;
    if (px !== null) {
      const ex = car.x - px;
      const ez = car.z - pz;
      const step2 = ex * ex + ez * ez;
      const budget = Math.hypot(car.vx, car.vz) * Math.max(dt, SIM_CAP) * 1.5 + 0.5;
      if (step2 > 1e-8 && step2 <= budget * budget) {
        let bestT = Infinity;
        let bestS = null;
        // The 3x3 cell neighbourhood around the car reaches at least one whole 64 m cell in
        // every direction, and one step is at most SIM_CAP seconds of travel — 2.1 m for the
        // fastest car in the fleet. The start of the sweep is therefore always inside the
        // cells we are already looking at, so the broad phase needs nothing extra.
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const bucket = this.grid.get(`${cx + i},${cz + j}`);
            if (!bucket) continue;
            for (const s of bucket) {
              if (s.h && car.y - 0.4 > s.y + s.h) continue;
              const minD = s.r + radius;
              const fx = px - s.x;
              const fz = pz - s.z;
              const c = fx * fx + fz * fz - minD * minD;
              let t;
              if (c <= 0) {
                t = 0; // already touching when the step began
              } else {
                const a = step2;
                const b = 2 * (fx * ex + fz * ez);
                const disc = b * b - 4 * a * c;
                if (disc <= 0) continue;
                t = (-b - Math.sqrt(disc)) / (2 * a);
                if (t < 0 || t > 1) continue;
              }
              if (t < bestT) {
                bestT = t;
                bestS = s;
              }
            }
          }
        }
        if (bestS) {
          // Rewind to the moment of contact and stand off by CLEAR, so the discrete pass
          // does not immediately re-resolve the same contact with a different normal.
          car.x = px + ex * bestT;
          car.z = pz + ez * bestT;
          let nx = car.x - bestS.x;
          let nz = car.z - bestS.z;
          const d = Math.hypot(nx, nz) || 0.0001;
          nx /= d;
          nz /= d;
          const want = bestS.r + radius + CLEAR;
          if (d < want) {
            car.x = bestS.x + nx * want;
            car.z = bestS.z + nz * want;
          }
          worst = this._respond(car, bestS, nx, nz, worst);
        }
      }
    }

    /* ── 2. the discrete pass: resting contact, and anything else overlapping ── */
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const bucket = this.grid.get(`${cx + i},${cz + j}`);
        if (!bucket) continue;
        for (const s of bucket) {
          const dx = car.x - s.x;
          const dz = car.z - s.z;
          const minD = s.r + radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= minD * minD) continue;

          // Tall props only count if the car is actually at their height — you can jump a
          // boulder, and a low rock should not stop a car that is three metres in the air.
          if (s.h && car.y - 0.4 > s.y + s.h) continue;

          const d = Math.sqrt(d2) || 0.0001;
          const pen = minD - d;
          if (pen < EPS) continue;
          const nx = dx / d;
          const nz = dz / d;

          // push out
          car.x += nx * pen;
          car.z += nz * pen;

          worst = this._respond(car, s, nx, nz, worst);
        }
      }
    }

    this._px = car.x;
    this._pz = car.z;
    this.lastHit = worst;
    return worst;
  }

  /**
   * The velocity half of a contact. `nx, nz` is the unit normal pointing FROM the obstacle
   * TO the car, so a negative `vn` means the car is still going into it.
   */
  _respond(car, s, nx, nz, worst) {
    const vn = car.vx * nx + car.vz * nz;
    if (vn >= 0) return worst; // already leaving — nothing to resolve
    const speed = Math.hypot(car.vx, car.vz);
    // How square the hit was, 0 (grazed) .. 1 (head-on)
    const severity = clamp01(-vn / Math.max(speed, 0.001));

    if (s.solid && -vn >= STOP_CLOSING && severity >= GRAZE) {
      /* DEAD STOP. A trunk does not give and it does not bounce you back — the car arrives,
       * the car stops, and you reverse out of it. No restitution on purpose: a spring-back
       * reads as a mistake, and any of it at 200 km/h would fire the car across the wood. */
      car.vx = 0;
      car.vz = 0;
      car.yawRate = 0;
    } else {
      // Split the velocity into the part going into the obstacle and the part sliding
      // along it. Kill the first, keep most of the second.
      const tx = car.vx - vn * nx;
      const tz = car.vz - vn * nz;
      const restitution = s.kind === 'rock' ? 0.18 : 0.06;
      const slide = 1 - 0.55 * severity;
      car.vx = tx * slide - vn * nx * restitution;
      car.vz = tz * slide - vn * nz * restitution;
      // A hit also scrubs rotation, otherwise clipping a tree sets the car spinning.
      car.yawRate *= 1 - 0.6 * severity;
    }

    if (speed > SOFT && (!worst || severity * speed > worst.severity * worst.speed)) {
      return { kind: s.kind, speed, severity, x: s.x, z: s.z };
    }
    return worst;
  }
}

/**
 * Turn one chunk's scatter output into collision solids.
 *
 * TREES ONLY, and only the species that are actually tree-sized. This used to add the rocks
 * and the fence posts too, which sounds right and is not: `scatterChunk` produces six prop
 * classes and the renderer draws three of them (trees, bushes, flowers — see
 * `Flora._scatter` and `Flowers`). Nothing anywhere draws `rocks`, `posts` or `reeds`, so
 * every one of those colliders was an invisible wall — 26 of them per hectare of highland,
 * some with a 2.4 m radius. If a renderer for them ever lands, add them back here with a
 * radius measured off what it draws, the way `TRUNK_R` is.
 *
 * Bushes stay drive-through: they are knee-high, they are everywhere, and brushing through
 * one is part of going off-road.
 */
export function solidsFromScatter(scatter, terrainHeight) {
  const out = [];
  if (!scatter || !scatter.trees) return out;
  for (const p of scatter.trees) {
    const r = TRUNK_R[p.kind];
    if (r === undefined) continue; // scrub, and anything new until it has been measured
    const scale = p.scale || 1;
    const y = p.y !== undefined ? p.y : terrainHeight ? terrainHeight(p.x, p.z) : 0;
    out.push({
      x: p.x,
      // The root the renderer actually instances, not the ground height the scatter recorded.
      y: y - TREE_SINK * scale,
      z: p.z,
      r: r * scale,
      h: TRUNK_H[p.kind] * scale,
      kind: 'tree',
      /* Solid things stop you dead. Roadside furniture from render/props.js does not set
       * this, so a bench or a fingerpost still scrapes and slides the way it always did. */
      solid: true,
    });
  }
  return out;
}
