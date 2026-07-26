/* Wanderoad — the opening cinematic.
 *
 * Ocarina of Time opens with Link riding across Hyrule Field at dawn. It is about forty
 * seconds long, it has four shots in it, and not one of them is in a hurry. That restraint is
 * the whole reference here: LONG SLOW MOVES, a handful of cuts, no text crawl, no logo sting,
 * nothing explaining itself. The job is to show you the place before you are asked to be busy
 * in it — the land, the water, a road, and the mountain you will spend an hour driving toward.
 *
 * Four rules this file exists to obey:
 *
 *   1. IT NEVER BLOCKS THE GAME. The frame loop runs exactly as it always did underneath —
 *      physics, streaming, network, all of it — and the player's input is live the whole time.
 *      The only thing the cinematic owns is the camera. If every line below threw, you would
 *      still be able to drive.
 *   2. ANY KEY SKIPS. Keyboard, mouse, touch, gamepad. The skip does not cut: it retargets the
 *      camera onto the gameplay pose and eases there over half a second, because a hard snap
 *      into a chase camera is a flinch, and this game does not do flinches.
 *   3. THE LAST SHOT LANDS ON THE CHASE CAMERA'S OWN REST POSE. Not "close to it" — the same
 *      numbers, read out of ChaseCamera.restPose(), so the hand-off has no cut in it at all.
 *      Duplicating 6.2 and 1.9 here would work until somebody retuned the chase camera.
 *   4. THE WORLD IS NOT SAMPLED PER FRAME. Every ground clearance along every path is measured
 *      once, at scout time, along the exact line the camera is going to fly. landHeight() costs
 *      ~14 µs; paying that three times a frame to find out something that was knowable before
 *      the shot started is how a slow camera move acquires a stutter. The single exception is
 *      the closing shot, which asks the chase camera for its rest pose — see _restPose().
 *
 * On the pace of the moves themselves: every dolly below is a trapezoid — ease in, constant
 * rate, ease out. smoothstep on its own peaks at 1.5x the mean rate halfway through, which
 * reads as a swoop. Cranes do not swoop.
 */

import { landHeight, waterFn } from '../world/terrain.js';
import { nearestLandmark } from '../world/landmarks.js';
import { clamp, clamp01, lerp, smootherstep, TAU } from '../core/math.js';

/* ── shot lengths ─────────────────────────────────────────────────────────
 * 38 seconds of programme. That is long for a browser game and it is deliberate: it plays
 * once, on your first visit, and every key on the board ends it. On later visits only the
 * last shot runs (SHORT below) — a nine-second descent onto your car, which is a nice way to
 * arrive and does not tax somebody who is here to drive. */
const SHOT_SECONDS = { land: 10.5, water: 9.5, road: 9.5, car: 8.5 };
const HANDOFF = 0.55; // seconds to ease from wherever we are onto the gameplay camera

/** Metres of ground clearance a low glide keeps under itself. */
const LOW_CLEAR = 6.5;

/* How far out the closing orbit starts. Declared here because the scout measures the ground on
 * a ring of exactly this radius and the shot then flies it — two places, one number. */
const ORBIT_R0 = 26;
const ORBIT_H0 = 13;
/* 92° of orbit over eight and a half seconds is about 16 °/s at its quickest, the same budget
 * the auto-drive rig works to. 123° at 30 m out was 21 °/s and read as a fly-by. */
const ORBIT_ARC = 1.6;

/* ── little vector helpers ────────────────────────────────────────────────
 * The game's heading convention: forward is (sin h, cos h), and +X is on your LEFT when you
 * look down +Z — three.js is right-handed and this project has been bitten by that three
 * times (car/input.js, car/autopilot.js, the lateral clamp in car/camera.js). So the vector
 * 90° to the LEFT of a heading is (cos h, -sin h), which is what rotating the heading by +90°
 * gives you, and it matches the sign the lateral correction in camera.js already uses. */
const fwdX = (h) => Math.sin(h);
const fwdZ = (h) => Math.cos(h);
const leftX = (h) => Math.cos(h);
const leftZ = (h) => -Math.sin(h);

/**
 * Progress along a dolly move: ease in over the first `a` of the shot, hold a constant rate,
 * ease out over the last `a`. Returns 0..1.
 */
function dolly(t, a = 0.2) {
  const total = 1 - a; // a/2 + (1 - 2a) + a/2
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < a) return (t * t) / (2 * a) / total;
  if (t > 1 - a) {
    const u = 1 - t;
    return (total - (u * u) / (2 * a)) / total;
  }
  return (t - a / 2) / total;
}

/** A pose the camera can be set to. One object, reused; this runs every frame. */
const newPose = () => ({ px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, fov: 60 });

export class Cinematic {
  /**
   * @param {object} o
   * @param {THREE.PerspectiveCamera} o.camera
   * @param {number} o.seed
   * @param {{x:number,z:number,y:number,heading:number}} o.spawn
   * @param {Terrain} [o.terrain]  a built Terrain around the spawn, used to follow the road
   * @param {ChaseCamera} [o.chase] read for the exact gameplay rest pose
   * @param {(x:number,z:number)=>number} [o.groundAt] the game's own cached height sampler
   * @param {Hud} [o.hud]          dimmed while the cinematic owns the screen
   * @param {'full'|'short'|'off'} [o.mode] overrides the URL and what the browser remembers
   * @param {Function} [o.onEnd]
   */
  constructor({ camera, seed, spawn, terrain = null, chase = null, groundAt = null, hud = null, mode = null, onEnd = null }) {
    this.camera = camera;
    this.seed = seed >>> 0;
    this.spawn = spawn;
    this.terrain = terrain;
    this.chase = chase;
    this.groundAt = groundAt;
    this.hud = hud;
    this.onEnd = onEnd;

    this.mode = mode || pickMode();
    this.shots = [];
    this.duration = 0;
    this.t = 0;
    this.shotIndex = -1;
    this.skipped = false;

    this._running = false;
    this._pose = newPose();
    this._rest = {};
    this._hint = null;
    this._watchdog = 0;
    this._onAny = null;

    /* Scout during boot, not at reveal. It is ~20 ms of pure world queries and the loading
     * bar is already on screen; doing it inside the reveal timeout would drop a frame in the
     * middle of the veil fading out, which is the one moment the player is looking at a
     * cross-fade. */
    if (this.mode !== 'off') this._scout();
  }

  /** True while the cinematic owns the camera. main.js reads this and nothing else. */
  get active() {
    return this._running;
  }

  /** Seconds of programme still to run. */
  get remaining() {
    return Math.max(0, this.duration - this.t);
  }

  get shotName() {
    return this.shots[this.shotIndex]?.name ?? '';
  }

  /* ── the programme ─────────────────────────────────────────────────────── */

  begin() {
    if (this._running || this.mode === 'off' || !this.shots.length) {
      this._end();
      return false;
    }
    this._running = true;
    this.t = 0;
    this.shotIndex = -1;
    this._attach();
    this._hint = makeHint();
    this.hud?.setCinematic?.(true);
    rememberSeen();

    /* A wall-clock backstop. If the frame loop dies, or the tab is buried for a minute, this
     * still takes the overlay off the screen and puts the HUD back. A cinematic that can
     * outlive the loop that drives it is the "flag set, nothing visible" failure in reverse. */
    if (typeof setTimeout === 'function') {
      this._watchdog = setTimeout(() => this._end(), (this.duration + 12) * 1000);
    }
    return true;
  }

  /**
   * Drive the camera for one frame.
   * @returns {boolean} true while the cinematic still owns the camera
   */
  update(dt, car) {
    if (!this._running) return false;
    this.t += dt;

    // Which shot, and how far into it?
    let t = this.t;
    let i = 0;
    while (i < this.shots.length - 1 && t >= this.shots[i].dur) {
      t -= this.shots[i].dur;
      i++;
    }
    this.shotIndex = i;
    const shot = this.shots[i];
    const u = clamp01(t / shot.dur);

    const p = this._pose;
    shot.pose(u, car, p, this);

    const cam = this.camera;
    cam.position.set(p.px, p.py, p.pz);
    // The chase camera tilts `up` for its speed shake; a cinematic is always level.
    cam.up.set(0, 1, 0);
    cam.lookAt(p.lx, p.ly, p.lz);
    if (Math.abs(cam.fov - p.fov) > 0.01) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }

    if (this.t >= this.duration) this._end();
    return this._running;
  }

  /**
   * End it. Any key, any button, a tap, a stick.
   *
   * The player's input was never blocked — this only governs the camera — so the half second
   * the ease takes costs them nothing, and it means the skip does not fling the view across
   * the valley in one frame.
   */
  skip() {
    if (!this._running || this.skipped) return false;
    this.skipped = true;
    /* Skipped before a single frame has been drawn — nothing is on screen to ease away from,
     * so there is nothing to ease. Get out of the way. */
    if (this.shotIndex < 0) {
      this._end();
      return true;
    }
    const from = { ...this._pose };
    this.shots = [
      {
        name: 'handoff',
        dur: HANDOFF,
        pose: (u, car, out, self) => {
          const r = self._restPose(car);
          const e = smootherstep(0, 1, u);
          out.px = lerp(from.px, r.px, e);
          out.py = lerp(from.py, r.py, e);
          out.pz = lerp(from.pz, r.pz, e);
          out.lx = lerp(from.lx, r.lx, e);
          out.ly = lerp(from.ly, r.ly, e);
          out.lz = lerp(from.lz, r.lz, e);
          out.fov = lerp(from.fov, r.fov, e);
        },
      },
    ];
    this.duration = HANDOFF;
    this.t = 0;
    this.shotIndex = 0;
    // Take the hint down immediately: the player has demonstrably read it.
    this._hint?.remove();
    this._hint = null;
    return true;
  }

  /** Tear down whatever state is left, once, from anywhere. Safe to call repeatedly. */
  _end() {
    const wasRunning = this._running;
    this._running = false;
    this._detach();
    if (this._watchdog && typeof clearTimeout === 'function') clearTimeout(this._watchdog);
    this._watchdog = 0;
    this._hint?.remove();
    this._hint = null;
    this.hud?.setCinematic?.(false);
    if (wasRunning) this.onEnd?.();
  }

  /** Public hard stop, for a caller that decides the cinematic has to go now. */
  stop() {
    this._end();
  }

  /* ── the gameplay pose ─────────────────────────────────────────────────── */

  /**
   * Where the chase camera would sit if the car were standing still. Read out of the chase
   * camera itself so the two can never drift apart — the whole point of the last shot is that
   * it arrives at a pose the next frame will reproduce exactly.
   */
  _restPose(car) {
    /* The only per-frame terrain sampling in this file, and it is five samples of the game's
     * OWN cached sampler (~6 µs each), only during the closing shot. It has to be here: the
     * rest pose includes a terrain floor, and a closing shot that lands 350 mm above or below
     * that floor is a closing shot with a pop at the end of it. */
    if (this.chase?.restPose) return this.chase.restPose(car, this._rest, this.groundAt);
    // Only reachable if a caller built us without a chase camera, e.g. a headless test.
    const r = this._rest;
    r.px = car.x - Math.sin(car.yaw) * 6.2;
    r.py = car.y + 1.9;
    r.pz = car.z - Math.cos(car.yaw) * 6.2;
    r.lx = car.x + Math.sin(car.yaw);
    r.ly = car.y + 0.9;
    r.lz = car.z + Math.cos(car.yaw);
    r.fov = 62;
    return r;
  }

  /* ── scouting ──────────────────────────────────────────────────────────── */

  /**
   * Find this seed's subjects — a mountain, some water, a stretch of road — and lay the four
   * camera paths over them. Pure world queries, deterministic, ~20 ms, once.
   */
  _scout() {
    const seed = this.seed;
    const sx = this.spawn.x;
    const sz = this.spawn.z;
    const ground = (x, z) => landHeight(x, z, seed);
    const spawnY = Number.isFinite(this.spawn.y) ? this.spawn.y : ground(sx, sz);

    /* Only the full programme has anything to point at a mountain or a lake, and finding the
     * lake is ~700 world queries. A return visitor gets the closing shot and should not pay
     * fifteen milliseconds of boot for two shots that are not going to run. */
    const full = this.mode === 'full';
    const lm = full ? findLandmark(sx, sz, seed) : null;
    const wet = full ? findWater(sx, sz, seed, ground) : null;
    this.subjects = { landmark: lm, water: wet, spawnY };

    const shots = [];
    if (full) {
      shots.push(this._shotLand(lm, ground, spawnY));
      shots.push(wet ? this._shotWater(wet, ground) : this._shotRise(lm, ground, spawnY));
      shots.push(this._shotRoad(ground));
    }
    shots.push(this._shotCar(maxGroundRing(sx, sz, ORBIT_R0, ground, 12)));

    this.shots = shots.filter(Boolean);
    this.duration = this.shots.reduce((a, s) => a + s.dur, 0);
  }

  /* SHOT 1 — the land. A high crane travelling toward the massif, losing height as it goes.
   * A 52° lens rather than the game's 62°: the longer the lens the flatter the landscape
   * stacks, and stacked ridges are what makes a horizon read as far away. */
  _shotLand(lm, ground, spawnY) {
    const b = Math.atan2(lm.x - this.spawn.x, lm.z - this.spawn.z); // bearing to the mountain
    // Start behind the spawn relative to the mountain, so the whole move is an approach.
    const a = { x: this.spawn.x - fwdX(b) * 300, z: this.spawn.z - fwdZ(b) * 300 };
    const c = { x: this.spawn.x - fwdX(b) * 120, z: this.spawn.z - fwdZ(b) * 120 };
    // Slide a little sideways too, so the parallax on the near ridges is not purely radial.
    a.x += leftX(b) * 60;
    a.z += leftZ(b) * 60;
    const gmax = maxGroundAlong(a, c, ground, 18);
    const y0 = Math.max(gmax, spawnY) + 86;
    const y1 = Math.max(gmax, spawnY) + 48;

    // Look at the mountain, a little below the summit so it sits high in frame.
    const lmY = ground(lm.x, lm.z);
    const aimD = Math.min(lm.d, 2600);
    const aim = { x: this.spawn.x + fwdX(b) * aimD, z: this.spawn.z + fwdZ(b) * aimD };
    const aimY = lerp(Math.max(spawnY, ground(aim.x, aim.z)), lmY, 0.45);

    return {
      name: 'land',
      dur: SHOT_SECONDS.land,
      pose: (u, car, out) => {
        const d = dolly(u, 0.26);
        out.px = lerp(a.x, c.x, d);
        out.pz = lerp(a.z, c.z, d);
        out.py = lerp(y0, y1, d);
        // A very slow pan across the summit: 90 m of drift at ~1.8 km is under 3°, spread
        // over ten seconds. You should not be able to say the camera is panning, only that
        // the shot is alive.
        const pan = (1 - d) * 90;
        out.lx = aim.x + leftX(b) * pan;
        out.lz = aim.z + leftZ(b) * pan;
        out.ly = aimY;
        out.fov = 52;
      },
    };
  }

  /* SHOT 2 — the water. A low glide in off the lake toward the shore, rising off the surface
   * as the land arrives. Low and slow: the reason to be down here is the water plane running
   * under the lens. */
  _shotWater(wet, ground) {
    // Travel from out on the water back toward the spawn — the shore, and the land beyond it.
    const b = Math.atan2(this.spawn.x - wet.x, this.spawn.z - wet.z);
    // 125 m in nine and a half seconds: about 47 km/h, ten metres off the water. Any quicker
    // and a low shot over a flat plane stops being a glide and starts being a speedboat.
    const a = { x: wet.x - fwdX(b) * 85, z: wet.z - fwdZ(b) * 85 };
    const c = { x: wet.x + fwdX(b) * 40, z: wet.z + fwdZ(b) * 40 };
    const gmax = maxGroundAlong(a, c, ground, 14);
    const base = Math.max(wet.y, gmax);
    const y0 = base + 12.5;
    const y1 = base + LOW_CLEAR + 1.5;

    const aimD = 190;
    const aim = { x: c.x + fwdX(b) * aimD, z: c.z + fwdZ(b) * aimD };
    const aimY0 = wet.y + 2.0;
    const aimY1 = Math.max(wet.y, ground(aim.x, aim.z)) + 26;

    return {
      name: 'water',
      dur: SHOT_SECONDS.water,
      pose: (u, car, out) => {
        const d = dolly(u, 0.3);
        out.px = lerp(a.x, c.x, d);
        out.pz = lerp(a.z, c.z, d);
        out.py = lerp(y0, y1, d);
        out.lx = aim.x;
        out.lz = aim.z;
        // Lift the eyeline off the water and onto the land as we come in. This is the only
        // move in the piece that changes what the shot is ABOUT while it runs.
        out.ly = lerp(aimY0, aimY1, smootherstep(0, 1, d));
        out.fov = 58;
      },
    };
  }

  /* SHOT 2, alternate — a seed with no water within 1.5 km. Same idea, different subject:
   * come in low over the land toward the high ground instead. Never let a missing feature
   * turn into a missing shot. */
  _shotRise(lm, ground, spawnY) {
    const b = Math.atan2(lm.x - this.spawn.x, lm.z - this.spawn.z);
    // ~123 m, same pace as the water shot it replaces. It used to be 267 m in the same nine
    // and a half seconds, which is 145 km/h — the fastest thing in a game about not hurrying.
    const a = { x: this.spawn.x - fwdX(b) * 115 + leftX(b) * 75, z: this.spawn.z - fwdZ(b) * 115 + leftZ(b) * 75 };
    const c = { x: this.spawn.x + leftX(b) * 30, z: this.spawn.z + leftZ(b) * 30 };
    const gmax = maxGroundAlong(a, c, ground, 16);
    const y0 = gmax + 26;
    const y1 = gmax + LOW_CLEAR + 4;
    const aim = { x: this.spawn.x + fwdX(b) * 700, z: this.spawn.z + fwdZ(b) * 700 };
    const aimY = Math.max(spawnY, ground(aim.x, aim.z)) + 24;
    return {
      name: 'rise',
      dur: SHOT_SECONDS.water,
      pose: (u, car, out) => {
        const d = dolly(u, 0.3);
        out.px = lerp(a.x, c.x, d);
        out.pz = lerp(a.z, c.z, d);
        out.py = lerp(y0, y1, d);
        out.lx = aim.x;
        out.lz = aim.z;
        out.ly = aimY;
        out.fov = 55;
      },
    };
  }

  /* SHOT 3 — a road. The promise of the game: tarmac running away into the distance with the
   * camera keeping pace alongside it at 47 km/h. It stops about 20 m short of the spawn, so the
   * last thing in frame is your car sitting there waiting — which is what shot 4 is for.
   *
   * The path follows the road rather than a straight line, by marching backwards from the
   * spawn and re-snapping to the centreline every step. Roads here bend; a straight dolly next
   * to a bending road ends up in a hedge. */
  _shotRoad(ground) {
    const seed = this.seed;
    const roads = this.terrain?.roads ?? null;
    const heightAt = (x, z) => (this.terrain ? this.terrain.height(x, z) : landHeight(x, z, seed));
    const STEP = 5;
    const N = 30;

    const nodes = [];
    let px = this.spawn.x;
    let pz = this.spawn.z;
    let ph = this.spawn.heading;
    for (let i = 0; i < N; i++) {
      nodes.push({ x: px, z: pz, h: ph });
      px -= fwdX(ph) * STEP;
      pz -= fwdZ(ph) * STEP;
      const q = roads?.query(px, pz);
      if (q && isFinite(q.d) && q.d < q.width * 1.8) {
        let tx = q.tx;
        let tz = q.tz;
        // Keep the tangent pointing the way we came, or the march turns round on itself.
        if (fwdX(ph) * tx + fwdZ(ph) * tz < 0) {
          tx = -tx;
          tz = -tz;
        }
        const nh = Math.atan2(tx, tz);
        let turn = nh - ph;
        while (turn > Math.PI) turn -= TAU;
        while (turn < -Math.PI) turn += TAU;
        /* ONLY accept the snap if it is the road we are already walking. `roads.query` returns
         * the nearest road to a point, and five metres further back the nearest road can be a
         * DIFFERENT one — a junction, a parallel lane. Taking that snap teleports the track
         * sideways, and because the camera offset is derived from each node's own heading, a
         * heading flip also puts the camera on the other side of the road: a 24 m jump-cut in
         * the middle of a tracking shot. Seed 1337 showed it as a single 100 km/h frame inside
         * a 50 km/h move. 20° over five metres is a 14 m radius, tighter than any road here.
         * (The autopilot rejects the same false reading the same way — see autopilot.js.) */
        if (Math.hypot(q.qx - px, q.qz - pz) < STEP * 1.2 && Math.abs(turn) < 0.35) {
          px = q.qx;
          pz = q.qz;
          ph = nh;
        }
      }
    }
    nodes.reverse(); // now node 0 is furthest back down the road and node N-1 is the spawn

    /* Which side to stand on? Whichever is more open. Sitting 12 m into a cutting is a shot
     * of a bank; the same shot on the other side is a shot of a valley. Measure it. */
    const OFF = 12;
    let openL = 0;
    let openR = 0;
    for (let i = 0; i < nodes.length; i += 4) {
      const n = nodes[i];
      const gr = heightAt(n.x, n.z);
      openL += clamp(gr - ground(n.x + leftX(n.h) * OFF, n.z + leftZ(n.h) * OFF), -14, 14);
      openR += clamp(gr - ground(n.x - leftX(n.h) * OFF, n.z - leftZ(n.h) * OFF), -14, 14);
    }
    const side = openL >= openR ? 1 : -1;

    // Camera track: offset to the chosen side, clear of both the road and the verge.
    const build = (ns) =>
      ns.map((n) => {
        const cx = n.x + leftX(n.h) * OFF * side;
        const cz = n.z + leftZ(n.h) * OFF * side;
        const roadY = heightAt(n.x, n.z);
        const vergeY = ground(cx, cz);
        return { x: cx, z: cz, y: Math.max(roadY, vergeY) + 3.4, rx: n.x, rz: n.z, ry: roadY };
      });
    let track = build(nodes);

    /* Last line of defence. If the march still produced a kink — an unmapped junction shape,
     * a road that doubles back — a dolly along a straight line is a duller shot than one that
     * follows the road, and a much better shot than one with a lurch in it. Measure, do not
     * assume: the whole reason this check exists is that assuming produced the lurch. */
    let gap = 0;
    for (let i = 1; i < track.length; i++) gap = Math.max(gap, Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z));
    this.roadKink = gap;
    if (gap > STEP * 2) {
      const h = this.spawn.heading;
      track = build(
        nodes.map((_, i) => ({
          x: this.spawn.x - fwdX(h) * STEP * (N - 1 - i),
          z: this.spawn.z - fwdZ(h) * STEP * (N - 1 - i),
          h,
        })),
      );
    }

    const LOOK_AHEAD = 8; // nodes, i.e. ~40 m of road in front of the lens
    const lastCam = track.length - 1 - (LOOK_AHEAD - 4); // stop ~20 m short of the car
    const sample = (arr, f, get) => {
      const i = clamp(Math.floor(f), 0, arr.length - 2);
      const k = clamp01(f - i);
      return lerp(get(arr[i]), get(arr[i + 1]), k);
    };

    /* ARC LENGTH, not node number. Nodes are five metres apart ALONG THE ROAD, but the camera
     * rides twelve metres out to one side, and on the outside of a bend that stretches a five
     * metre step into eight. Driving the dolly by node index therefore speeds it up in every
     * corner — measured as a 100 km/h frame inside a 50 km/h shot on seed 1337. Walking the
     * cumulative length instead gives a genuinely constant metres per second, which is what a
     * dolly on a rail does and what the trapezoid above was for. */
    const cum = [0];
    for (let i = 1; i < track.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(track[i].x - track[i - 1].x, track[i].z - track[i - 1].z));
    }
    const fracAt = (d) => {
      let i = 0;
      while (i < lastCam - 1 && cum[i + 1] < d) i++;
      const seg = cum[i + 1] - cum[i];
      return i + (seg > 0 ? clamp01((d - cum[i]) / seg) : 0);
    };
    // Cap the distance so the pace is a known 13 m/s (47 km/h) whatever shape the road is.
    const travel = Math.min(cum[lastCam], 13 * SHOT_SECONDS.road);

    return {
      name: 'road',
      dur: SHOT_SECONDS.road,
      pose: (u, car, out) => {
        const d = dolly(u, 0.24);
        const f = fracAt(d * travel);
        out.px = sample(track, f, (n) => n.x);
        out.py = sample(track, f, (n) => n.y);
        out.pz = sample(track, f, (n) => n.z);
        const fa = Math.min(f + LOOK_AHEAD, track.length - 1.001);
        out.lx = sample(track, fa, (n) => n.rx);
        out.lz = sample(track, fa, (n) => n.rz);
        out.ly = sample(track, fa, (n) => n.ry) + 1.7;
        out.fov = 47;
      },
    };
  }

  /* SHOT 4 — the car. A slow descending orbit that ends, exactly, on the chase camera's rest
   * pose. `restPose` is read live every frame rather than snapshotted, so if the player has
   * already driven off (they can — nothing is frozen) the shot still lands behind them. */
  _shotCar(ringMax) {
    const ARC = ORBIT_ARC;
    const R0 = ORBIT_R0;
    const H0 = ORBIT_H0;
    /* The wide end of the orbit is 26 m out, which on a hillside seed can be 26 m of hillside.
     * The floor is measured once on that ring and then interpolated to the rest height, so it
     * is guaranteed clear at the start and guaranteed EXACT at the end — a clearance term
     * that lingered into the last frame would break the whole point of this shot. */
    const floor0 = ringMax + 4.5;
    return {
      name: 'car',
      dur: SHOT_SECONDS.car,
      pose: (u, car, out, self) => {
        const r = self._restPose(car);
        const d = dolly(u, 0.34); // a long ease out: the camera settles, it does not stop
        const e = smootherstep(0, 1, d);

        // Rest pose expressed as a boom: how far behind and how far above the car it sits.
        const dx = r.px - car.x;
        const dz = r.pz - car.z;
        const restR = Math.hypot(dx, dz) || 6.2;
        const restYaw = Math.atan2(-dx, -dz); // the heading the boom points along
        const yaw = restYaw + ARC * (1 - e);
        const rad = lerp(R0, restR, e);

        out.px = car.x - fwdX(yaw) * rad;
        out.pz = car.z - fwdZ(yaw) * rad;
        out.py = Math.max(lerp(car.y + H0, r.py, e), lerp(floor0, r.py, e));
        out.lx = lerp(car.x, r.lx, e);
        out.ly = lerp(car.y + 1.1, r.ly, e);
        out.lz = lerp(car.z, r.lz, e);
        out.fov = lerp(55, r.fov, e);
      },
    };
  }

  /* ── input ─────────────────────────────────────────────────────────────── */

  /* Own listeners rather than relying on the game's Input class, so the skip works even on a
   * frame where polling has not happened yet — and so a mouse click or a tap counts, which
   * "any key" ought to mean on a machine without a keyboard. main.js additionally forwards
   * the gamepad, which nothing here can see. */
  _attach() {
    if (typeof window === 'undefined' || this._onAny) return;
    this._onAny = () => this.skip();
    for (const ev of ['keydown', 'pointerdown', 'touchstart', 'wheel']) {
      window.addEventListener(ev, this._onAny, { passive: true });
    }
  }

  _detach() {
    if (typeof window === 'undefined' || !this._onAny) return;
    for (const ev of ['keydown', 'pointerdown', 'touchstart', 'wheel']) {
      window.removeEventListener(ev, this._onAny);
    }
    this._onAny = null;
  }
}

/* ── subjects ─────────────────────────────────────────────────────────────── */

/**
 * The mountain worth pointing a camera at. `nearestLandmark` only looks at the 3x3 cells
 * around a point, so probe a couple of rings outward and score height against distance —
 * a 300 m peak 5 km away beats a 90 m lump next door.
 */
function findLandmark(sx, sz, seed) {
  const score = (c) => c.h - c.d * 0.016;
  let best = nearestLandmark(sx, sz, seed);
  best.d = Math.hypot(best.x - sx, best.z - sz);
  for (const r of [2600, 5200]) {
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * TAU;
      const c = nearestLandmark(sx + Math.cos(th) * r, sz + Math.sin(th) * r, seed);
      c.d = Math.hypot(c.x - sx, c.z - sz);
      if (score(c) > score(best)) best = c;
    }
  }
  return best;
}

/**
 * The nearest real body of water. Rings outward on a coarse spiral — lakes and coasts here are
 * hundreds of metres across, so 90 m sampling cannot miss one, and the whole search is about
 * 700 queries at ~7 µs each. Requires 2 m of depth so a puddle in a marsh does not become the
 * subject of a ten-second shot.
 */
function findWater(sx, sz, seed, ground) {
  const water = waterFn(seed);
  for (let r = 120; r <= 1500; r += 90) {
    const n = Math.max(10, Math.round((TAU * r) / 140));
    for (let a = 0; a < n; a++) {
      const th = (a / n) * TAU + r * 0.017; // rotate each ring so the samples do not line up
      const x = sx + Math.cos(th) * r;
      const z = sz + Math.sin(th) * r;
      const wl = water(x, z);
      if (wl !== null && wl - ground(x, z) > 2) return { x, y: wl, z, d: r };
    }
  }
  return null;
}

/** Highest ground on the straight line a-c, measured once so no shot has to sample per frame. */
function maxGroundAlong(a, c, ground, n) {
  let g = -Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const h = ground(lerp(a.x, c.x, t), lerp(a.z, c.z, t));
    if (h > g) g = h;
  }
  return g;
}

/** Highest ground on a circle — the widest sweep of the closing orbit. Same idea. */
function maxGroundRing(cx, cz, r, ground, n) {
  let g = -Infinity;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    const h = ground(cx + Math.cos(th) * r, cz + Math.sin(th) * r);
    if (h > g) g = h;
  }
  return g;
}

/* ── when it plays ────────────────────────────────────────────────────────── */

const SEEN_KEY = 'wanderoad.intro.seen';

/**
 * Full programme the first time somebody opens the game, the closing shot on every visit
 * after that. `?intro=full|short|off` overrides both, which is how you look at it again.
 *
 * Storage is wrapped because a browser in private mode throws on localStorage, and a cozy
 * driving game refusing to boot over a preference is absurd.
 */
function pickMode() {
  let forced = null;
  try {
    forced = new URLSearchParams(location.search).get('intro');
  } catch {
    /* no location — a node harness */
  }
  if (forced === 'full' || forced === 'short' || forced === 'off') return forced;
  try {
    return localStorage.getItem(SEEN_KEY) ? 'short' : 'full';
  } catch {
    return 'full';
  }
}

function rememberSeen() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private mode; they get the long one again, which is not a problem */
  }
}

/* ── the skip hint ────────────────────────────────────────────────────────── */

/**
 * One quiet line, and it fades in a few seconds late so it is not the first thing you read.
 *
 * Inline styles, not a rule in style.css, and `remove()` rather than a class: this element
 * exists only while the cinematic runs, and the last time this project let CSS decide whether
 * something was on screen it shipped the game unplayable. Nothing here can cover the game —
 * it is one line of text at z-index 30 with pointer-events off.
 */
function makeHint() {
  if (typeof document === 'undefined' || !document.body) return null;
  const el = document.createElement('div');
  el.id = 'introSkip';
  el.textContent = 'any key to drive';
  el.style.cssText = [
    'position:fixed',
    'left:0',
    'right:0',
    'bottom:6vh',
    'z-index:30',
    'text-align:center',
    "font-family:var(--serif),Georgia,serif",
    'font-size:0.95rem',
    'letter-spacing:0.18em',
    'color:rgba(246,236,216,0.7)',
    'text-shadow:0 1px 12px rgba(0,0,0,0.55)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 1.8s ease',
  ].join(';');
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '1';
  }, 2600);
  return el;
}
