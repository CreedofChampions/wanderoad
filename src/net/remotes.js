/* Wanderoad — remote cars.
 *
 * REMOTE CARS ARE GHOSTS. They never collide with anything: not the player, not each
 * other, not the world. That single rule is the reason this project has no authority
 * model, no contact arbitration and no rollback — a ghost cannot push you off the road, so
 * nothing about it has to be agreed on. Do not add a collider here.
 *
 * What is left is purely a display problem: snapshots arrive at 0.25–4 Hz over HTTP and
 * have to become smooth motion at 60 fps.
 *
 *   1. Buffer, do not chase. Render everything 250 ms in the past so there is almost
 *      always a snapshot on both sides of the render time to interpolate between. This is
 *      the standard entity-interpolation trade: a quarter second of lag buys smoothness
 *      that no amount of prediction can.
 *   2. Cubic Hermite on position, using the reported velocity as the tangent, so a car
 *      going 40 m/s between two 1 Hz samples curves the way it actually drove instead of
 *      cutting the corner.
 *   3. Shortest-arc on yaw, unwrapped on arrival, so a car crossing +/-PI does not spin.
 *   4. Dead-reckon forward when the next snapshot is late — capped, because a lost
 *      connection must not launch a ghost across the valley.
 *   5. Snap, never lerp, past 12 m of error. A long smooth slide to the correct place
 *      reads as a bug; a teleport reads as a hiccup, which is what it is.
 */

import { Object3D } from 'three';
import { angleDelta, clamp, hermite } from '../core/math.js';
import { U } from '../render/uniforms.js';

/** Render this far behind the server clock. Enough for a dropped 1 Hz tick to still land. */
const DELAY_MS = 250;
/** Never extrapolate further than this past the newest snapshot. */
const MAX_EXTRAP_S = 1.2;
/** Beyond this the visual is teleported to the network pose rather than eased. */
const SNAP_M = 12;
/** How fast a correction offset decays to zero. Fraction per second. */
const CORRECT_RATE = 9;
/** Server rows expire after 8 s; a little grace covers one lost response. */
const DROP_MS = 11000;
/** Snapshot ring size. At 4 Hz this is 4 s of history, far more than DELAY_MS needs. */
const MAX_SNAPSHOTS = 24;

export class Remotes {
  /**
   * @param {object} opts
   * @param {import('three').Object3D} opts.scene  ghosts are parented under a group in here
   * @param {(spec:{id:string,name:string,tier:number,paint:number}) => any} opts.buildGhostCar
   *        from src/car/model.js — may return an Object3D, or {root, update?, dispose?}
   */
  constructor({ scene, buildGhostCar }) {
    if (typeof buildGhostCar !== 'function') throw new Error('[remotes] buildGhostCar is required');
    this.scene = scene;
    this.buildGhostCar = buildGhostCar;

    this.group = new Object3D();
    this.group.name = 'ghosts';
    // Ghosts are always inside the fog and always moving; a per-frame bounds test on them
    // costs more than it saves.
    this.group.frustumCulled = false;
    scene?.add(this.group);

    /** id -> ghost record */
    this.peers = new Map();

    /* Client clock -> server clock. Every response carries the server's `now`; the offset
     * is what makes it comparable with our own clock. It is smoothed because a single slow
     * response would otherwise shove the whole render window backwards.
     *
     * The clock used here is Date.now(). `update()` must be given the same one — see its
     * doc comment. Everything after this line is timed in SERVER milliseconds, so a client
     * clock that drifts or is set by hand costs nothing but a re-estimate of the offset. */
    this._offset = null;
  }

  get count() {
    return this.peers.size;
  }

  /**
   * Feed one server response.
   * @param {Array<object>} peers  the `peers` array, already trimmed to <=16 by the server
   * @param {number} serverNow     the response's `now`, in server milliseconds
   */
  ingest(peers, serverNow) {
    if (Number.isFinite(serverNow)) {
      // Named skew, not sample: sample() is the interpolator below and shadowing it here
      // would be a trap for the next reader.
      const skew = serverNow - Date.now();
      if (this._offset === null || Math.abs(skew - this._offset) > 1500) {
        this._offset = skew; // first response, or the clock genuinely jumped
      } else {
        this._offset += (skew - this._offset) * 0.15;
      }
    }
    if (!Array.isArray(peers)) return;
    const stamp = Number.isFinite(serverNow) ? serverNow : Date.now() + (this._offset ?? 0);

    for (const p of peers) {
      if (!p || typeof p.id !== 'string') continue;
      let rec = this.peers.get(p.id);
      if (!rec) {
        rec = this._spawn(p);
        if (!rec) continue;
      }
      rec.lastSeen = stamp;
      rec.name = typeof p.name === 'string' ? p.name : rec.name;

      const t = Number.isFinite(p.t) ? p.t : stamp;
      const buf = rec.buf;
      // Out-of-order arrivals happen on any HTTP path; an older snapshot than the newest
      // one we hold has nothing to add, so drop it rather than re-sorting the ring.
      if (buf.length && t <= buf[buf.length - 1].t) continue;

      /* Freeze where the OLD curve had this car right now. update() compares it against
       * the new curve at the same instant to get the true size of the discontinuity — and
       * only that. Comparing against last frame's rendered position instead would count
       * one frame of legitimate travel (half a metre at 30 m/s) as error, and re-inject it
       * as a correction on every single snapshot. */
      if (rec.placed) {
        rec.jumpT = Date.now() + (this._offset ?? 0) - DELAY_MS;
        rec.preJump = sample(rec.buf, rec.jumpT);
      }

      const prev = buf.length ? buf[buf.length - 1] : null;
      const rawYaw = num(p.yaw);
      // Unwrap against the previous sample so hermite sees a continuous angle.
      const yaw = prev ? prev.yaw + angleDelta(prev.yaw, rawYaw) : rawYaw;

      // There is no vy on the wire — it would be a fourth float to describe something the
      // terrain already dictates. Measuring it from the last two samples costs nothing and
      // stops a ghost hovering off a crest while we dead-reckon. Clamped because a snap or
      // a respawn between samples would otherwise fire it into the sky.
      const y = num(p.y);
      const vy = prev ? clamp((y - prev.y) / ((t - prev.t) / 1000), -12, 12) : 0;

      buf.push({
        t,
        x: num(p.x), y, z: num(p.z),
        yaw,
        vx: num(p.vx), vy, vz: num(p.vz),
        yawRate: num(p.yawRate),
        steer: num(p.steer), throttle: num(p.throttle), brake: num(p.brake),
        flags: p.flags | 0,
      });
      if (buf.length > MAX_SNAPSHOTS) buf.shift();
      // The interpolation curve just changed shape; update() re-measures the offset once.
      rec.corrected = true;

      if (p.tier !== undefined) rec.tier = p.tier | 0;
      if (p.paint !== undefined) rec.paint = p.paint | 0;
    }
  }

  /**
   * @param {number} dt   seconds since the last frame
   * @param {number} [now] client wall clock in ms. Must be the same clock `ingest()` reads,
   *                       i.e. Date.now() — not performance.now(), whose origin is the
   *                       page load and would put every ghost decades in the past.
   */
  update(dt, now = Date.now()) {
    const serverNow = now + (this._offset ?? 0);
    const renderT = serverNow - DELAY_MS;

    for (const [id, rec] of this.peers) {
      if (serverNow - rec.lastSeen > DROP_MS) {
        this._despawn(id, rec);
        continue;
      }
      const pose = sample(rec.buf, renderT);
      if (!pose) continue; // nothing usable yet — stay hidden

      const obj = rec.obj;
      if (!rec.placed) {
        rec.placed = true;
        obj.visible = true;
        rec.ex = rec.ey = rec.ez = rec.eyaw = 0;
      } else if (rec.corrected && rec.preJump) {
        /* A new snapshot re-cut the curve, so the target jumped. Absorb the jump into a
         * decaying offset rather than easing the position towards the target: an
         * exponential follower would sit a permanent v/rate behind — 1.4 m at 30 m/s —
         * and the whole point of interpolating is to be where the car actually was. */
        const after = sample(rec.buf, rec.jumpT);
        if (after) {
          rec.ex = rec.preJump.x + rec.ex - after.x;
          rec.ey = rec.preJump.y + rec.ey - after.y;
          rec.ez = rec.preJump.z + rec.ez - after.z;
          rec.eyaw = angleDelta(after.yaw, rec.preJump.yaw + rec.eyaw);
        }
        if (Math.hypot(rec.ex, rec.ey, rec.ez) > SNAP_M) {
          // A teleport reads as a hiccup, which is what it is. A long smooth slide across
          // the valley reads as a bug.
          rec.ex = rec.ey = rec.ez = rec.eyaw = 0;
        }
        rec.preJump = null;
      }
      rec.corrected = false;

      const decay = Math.exp(-CORRECT_RATE * dt);
      rec.ex *= decay;
      rec.ey *= decay;
      rec.ez *= decay;
      rec.eyaw *= decay;

      obj.position.set(pose.x + rec.ex, pose.y + rec.ey, pose.z + rec.ez);
      obj.rotation.y = pose.yaw + rec.eyaw;

      rec.pose = pose;
      // Wheels, steering and brake lights, if the car model offers them.
      rec.api?.update?.(pose, dt);
    }
  }

  /** [{id, name, dist}] sorted nearest first — the HUD's peer list. */
  list() {
    // uCamPos is written by main.js every frame and is the only local-player position this
    // module can see without taking a dependency on the car module.
    const cam = U.uCamPos.value;
    const out = [];
    for (const [id, rec] of this.peers) {
      const p = rec.pose;
      const dist = p ? Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) : Infinity;
      out.push({ id, name: rec.name, dist });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  /** Metres to the nearest ghost, or Infinity. Drives the adaptive tick rate. */
  nearestDistance() {
    const cam = U.uCamPos.value;
    let best = Infinity;
    for (const rec of this.peers.values()) {
      const p = rec.pose;
      if (!p) continue;
      const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
      if (d < best) best = d;
    }
    return best;
  }

  dispose() {
    for (const [id, rec] of this.peers) this._despawn(id, rec);
    this.peers.clear();
    this.group.parent?.remove(this.group);
  }

  /* ── internals ───────────────────────────────────────────────────────────*/

  _spawn(p) {
    let built;
    try {
      built = this.buildGhostCar({
        id: p.id,
        name: typeof p.name === 'string' ? p.name : '',
        tier: p.tier | 0,
        paint: p.paint | 0,
      });
    } catch (err) {
      console.error('[remotes] buildGhostCar threw for', p.id, err);
      return null;
    }
    // Accept either a bare Object3D or a small handle around one, so the car module can
    // grow wheel/light control later without this file changing.
    const obj = built?.isObject3D ? built : (built?.root ?? built?.group ?? built?.object);
    if (!obj?.isObject3D) {
      console.error('[remotes] buildGhostCar returned no Object3D for', p.id);
      return null;
    }
    obj.visible = false;
    obj.matrixAutoUpdate = true;
    this.group.add(obj);

    const rec = {
      id: p.id,
      name: typeof p.name === 'string' ? p.name : '',
      tier: p.tier | 0,
      paint: p.paint | 0,
      obj,
      api: built?.isObject3D ? null : built,
      buf: [],
      pose: null,
      placed: false,
      corrected: false,
      preJump: null,
      jumpT: 0,
      // Decaying position/heading offset that hides the step when a snapshot lands.
      ex: 0, ey: 0, ez: 0, eyaw: 0,
      lastSeen: 0, // overwritten by the caller in ingest(), in server time
    };
    this.peers.set(p.id, rec);
    return rec;
  }

  _despawn(id, rec) {
    this.group.remove(rec.obj);
    if (rec.api?.dispose) rec.api.dispose();
    else disposeTree(rec.obj);
    this.peers.delete(id);
  }
}

/* ── sampling ──────────────────────────────────────────────────────────────*/

function num(v) {
  return Number.isFinite(v) ? v : 0;
}

/**
 * The pose at server time `t`: Hermite between the bracketing snapshots, or dead reckoning
 * past the newest one. Returns null while the buffer is too thin to say anything.
 */
function sample(buf, t) {
  const n = buf.length;
  if (n === 0) return null;
  if (n === 1 || t <= buf[0].t) return extrapolate(buf[0], (t - buf[0].t) / 1000);

  const last = buf[n - 1];
  if (t >= last.t) return extrapolate(last, (t - last.t) / 1000);

  let i = n - 2;
  while (i > 0 && buf[i].t > t) i--;
  const s0 = buf[i];
  const s1 = buf[i + 1];
  const span = s1.t - s0.t;
  const u = clamp((t - s0.t) / span, 0, 1);
  const h = span / 1000; // tangents are per-second, the parameter is per-span

  // y has no reported vertical velocity, so its tangents come from the neighbouring
  // samples (non-uniform Catmull-Rom). On a road that is the terrain's own slope.
  const before = i > 0 ? buf[i - 1] : null;
  const after = i + 2 < n ? buf[i + 2] : null;
  const chord = s1.y - s0.y;
  const my0 = before ? 0.5 * (s1.y - before.y) * (span / (s1.t - before.t)) : chord;
  const my1 = after ? 0.5 * (after.y - s0.y) * (span / (after.t - s0.t)) : chord;

  return {
    x: hermite(s0.x, s0.vx * h, s1.x, s1.vx * h, u),
    y: hermite(s0.y, my0, s1.y, my1, u),
    z: hermite(s0.z, s0.vz * h, s1.z, s1.vz * h, u),
    yaw: hermite(s0.yaw, s0.yawRate * h, s1.yaw, s1.yawRate * h, u),
    steer: s0.steer + (s1.steer - s0.steer) * u,
    throttle: s0.throttle + (s1.throttle - s0.throttle) * u,
    brake: s0.brake + (s1.brake - s0.brake) * u,
    vx: s0.vx + (s1.vx - s0.vx) * u,
    vz: s0.vz + (s1.vz - s0.vz) * u,
    flags: u < 0.5 ? s0.flags : s1.flags,
  };
}

/** Straight-line dead reckoning from one snapshot, clamped so a dropout cannot fling a car. */
function extrapolate(s, seconds) {
  const dt = clamp(seconds, 0, MAX_EXTRAP_S);
  return {
    x: s.x + s.vx * dt,
    y: s.y + s.vy * dt, // vy is measured on arrival, not sent — see ingest()
    z: s.z + s.vz * dt,
    yaw: s.yaw + s.yawRate * dt,
    steer: s.steer,
    throttle: s.throttle,
    brake: s.brake,
    vx: s.vx,
    vz: s.vz,
    flags: s.flags,
  };
}

/* At the tick rates the server hands out (0.25–2 Hz), the 250 ms buffer usually has no
 * future sample to interpolate towards, so `extrapolate` is the common path and `sample`'s
 * Hermite branch only runs when a burst arrives. Both are kept: the burst is exactly when
 * two cars are close enough for the difference to be visible. */

/** Only used when the car module hands back a bare Object3D and so owns no cleanup. */
function disposeTree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x.dispose?.());
    else m?.dispose?.();
  });
}
