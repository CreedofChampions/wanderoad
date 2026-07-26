/* Wanderoad — solid things.
 *
 * The world has three kinds of obstacle and they are handled differently on purpose:
 *
 *   TERRAIN   handled by the vehicle itself — it rides the heightfield, and a slope steep
 *             enough to stop you does so by gravity, not by a wall.
 *   PROPS     trees, rocks and signposts. These are real: you hit them, you lose speed and
 *             the streak breaks. They are the reason staying on the road is a skill.
 *   OTHER     remote players are GHOSTS and never collide. That one decision removes
 *             authority, contact arbitration and rollback from the whole project, and in a
 *             cozy cruising game being punted off the road by someone else's latency is the
 *             least cozy thing that could possibly happen.
 *
 * Broad phase is a uniform grid keyed on the same 64 m chunk the streamer already uses, so
 * adding and removing solids costs nothing extra as the world streams.
 */

import { clamp01 } from '../core/math.js';

/** Metres of penetration below which a hit is ignored — stops jitter against a kerb. */
const EPS = 0.02;
/** Speed under which a collision is a nudge rather than an impact. */
const SOFT = 4;

export class Solids {
  constructor({ cell = 64 } = {}) {
    this.cell = cell;
    /** Map "cx,cz" -> array of {x, z, r, h, kind, chunk} */
    this.grid = new Map();
    /** Map chunkKey -> the list we inserted, so removal is exact */
    this.byChunk = new Map();
    this.lastHit = null;
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
  }

  get count() {
    let n = 0;
    for (const l of this.byChunk.values()) n += l.length;
    return n;
  }

  /**
   * Resolve the car against everything nearby. Mutates the car's position and velocity.
   *
   * The response is deliberately forgiving: a glancing blow slides along the obstacle and
   * costs a little speed, a square hit stops you hard. Nothing here can flip or launch the
   * car — being thrown into the sky by a shrub is funny once and infuriating afterwards.
   *
   * @returns {null|{kind:string, speed:number, severity:number}} the worst hit this step
   */
  resolve(car, radius = 1.05, dt = 1 / 60) {
    const cx = Math.floor(car.x / this.cell);
    const cz = Math.floor(car.z / this.cell);
    let worst = null;

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

          // Split the velocity into the part going into the obstacle and the part sliding
          // along it. Kill the first, keep most of the second.
          const vn = car.vx * nx + car.vz * nz;
          if (vn < 0) {
            const speed = Math.hypot(car.vx, car.vz);
            const tx = car.vx - vn * nx;
            const tz = car.vz - vn * nz;
            // How square the hit was, 0 (grazed) .. 1 (head-on)
            const severity = clamp01(-vn / Math.max(speed, 0.001));
            const restitution = s.kind === 'rock' ? 0.18 : 0.06;
            const slide = 1 - 0.55 * severity;
            car.vx = tx * slide - vn * nx * restitution;
            car.vz = tz * slide - vn * nz * restitution;
            // A hit also scrubs rotation, otherwise clipping a tree sets the car spinning.
            car.yawRate *= 1 - 0.6 * severity;

            if (speed > SOFT && (!worst || severity * speed > worst.severity * worst.speed)) {
              worst = { kind: s.kind, speed, severity, x: s.x, z: s.z };
            }
          }
        }
      }
    }
    this.lastHit = worst;
    void dt;
    return worst;
  }
}

/**
 * Turn one chunk's scatter output into collision solids. Only the things that should
 * actually stop a car: trunks and boulders and signposts, not grass tufts or reeds.
 */
export function solidsFromScatter(scatter, terrainHeight) {
  const out = [];
  if (!scatter) return out;
  const push = (arr, kind, radiusOf, heightOf) => {
    if (!arr) return;
    for (const p of arr) {
      out.push({
        x: p.x,
        z: p.z,
        y: p.y !== undefined ? p.y : terrainHeight ? terrainHeight(p.x, p.z) : 0,
        r: radiusOf(p),
        h: heightOf(p),
        kind,
      });
    }
  };
  // A trunk is much thinner than a canopy: collide with the trunk, or driving through a
  // wood becomes pinball.
  push(scatter.trees, 'tree', (p) => 0.28 + 0.22 * (p.scale || 1), (p) => 6 * (p.scale || 1));
  push(scatter.rocks, 'rock', (p) => 0.7 * (p.scale || 1), (p) => 1.6 * (p.scale || 1));
  push(scatter.posts, 'post', () => 0.16, () => 1.6);
  return out;
}
