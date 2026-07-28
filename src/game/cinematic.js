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

import { Terrain, landHeight, waterFn } from '../world/terrain.js';
import { nearestLandmark } from '../world/landmarks.js';
import { clamp, clamp01, lerp, smootherstep, TAU } from '../core/math.js';
import { SUN_AZIMUTH } from '../render/uniforms.js';

/* ── shot lengths ─────────────────────────────────────────────────────────
 * 39.5 seconds of programme. That is long for a browser game and it is deliberate: it plays
 * once, on your first visit, and every key on the board ends it. On later visits only the
 * last shot runs (SHORT below) — a nine-second descent onto your car, which is a nice way to
 * arrive and does not tax somebody who is here to drive.
 *
 * `land` was 10.5 s and covered 193 m of ground, which is 18.5 m/s — 67 km/h, and its fastest
 * frame was 90 km/h. Every other shot in the piece is pinned at 47 km/h. The opening crane was
 * therefore the FASTEST thing in a game about not hurrying, and it was the first thing anybody
 * ever saw. It now covers 124 m in twelve seconds (37 km/h), which is slower than the rest of
 * the programme rather than twice its speed. */
const SHOT_SECONDS = { land: 12.0, water: 9.5, road: 9.5, car: 8.5 };
const HANDOFF = 0.55; // seconds to ease from wherever we are onto the gameplay camera

/** Metres of ground clearance a low glide keeps under itself. */
const LOW_CLEAR = 6.5;

/* ── waiting for the world ────────────────────────────────────────────────
 * Terrain streams in asynchronously on a worker pool. A ten-second crane over ground that has
 * not been meshed yet is the single worst thing this file could do, and it is not hypothetical:
 * main.js starts the programme as soon as fifteen chunks are live, and the opening shot flies
 * THREE HUNDRED METRES away from the spawn those fifteen chunks are around.
 *
 * So the programme can run in slow motion until the streamer says it is ready. Not a freeze —
 * a frozen camera reads as a hang, and this is the first thing a player sees — but a quarter
 * rate, which looks exactly like a patient establishing shot and buys the pool four times as
 * long to build the ground the shot is about to travel over. HOLD_MAX caps the total lost time
 * so a machine that never gets ready still sees the whole programme, only later.
 *
 * Costs nothing and does nothing unless a `worldReady` predicate is passed in; without one the
 * programme runs at exactly the rate it always did. */
const HOLD_RATE = 0.25;
/* Ten seconds, and it is measured rather than chosen: tools/diag-cinematic.mjs simulates the
 * real quadtree selection against the real measured cost of the real buildChunk() and finds
 * the streamer wants 302 nodes around a spawn — thirteen seconds of single-threaded meshing.
 * A two-worker machine (a four-core laptop, the floor this game targets) drains that queue in
 * about eight seconds, and main.js lifts the veil after 0.25 s of it. Six was not enough to
 * cover the gap; ten is, with room. At the quarter rate that is at most thirteen seconds of
 * wall clock added to a first visit, in slow motion, with every key on the board ending it. */
const HOLD_MAX = 10.0;

/* ── framing ──────────────────────────────────────────────────────────────
 * 0.26 rad = 14.9 deg, and it does two jobs with one number.
 *
 * The subject sits that far off the lens axis instead of dead centre. In this shot's 52 deg
 * vertical lens on a 16:9 frame the horizontal half-angle is about 40 deg, so 15 deg out is
 * a little over a third of the way to the edge — the composition every landscape painter and
 * every storyboard reaches for, and the pen's own valley is framed the same way.
 *
 * And it is offset AWAY FROM THE SUN, which is the half that matters here. The sun sits at
 * 13.5 deg of elevation, the post chain blooms anything over 1.02, and the sun disc is painted
 * at 1.9x. A shot that puts it near the lens axis does not look backlit, it looks blown out.
 * Pushing the subject off-axis pushes the sun the other way by the same angle, so the guarantee
 * is: the lens axis is never within 15 deg of the sun, on any seed. */
const FRAME_THIRD = 0.26;
const SUN_BEARING = (SUN_AZIMUTH * Math.PI) / 180;

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
/** Shortest signed angle, in radians. */
function wrapPi(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

/**
 * Where to point the lens, given the bearing of the thing the shot is about.
 * See FRAME_THIRD: the subject lands off-centre, on the side that pushes the low sun toward
 * the edge of frame rather than into the middle of it.
 * @returns {{bearing:number, side:number, sunOff:number}} the lens bearing, which way the
 *   subject was pushed, and how far the sun ends up off the lens axis, in radians.
 */
function composeAim(subjectB) {
  const rel = wrapPi(subjectB - SUN_BEARING); // where the subject is relative to the sun
  const side = rel >= 0 ? 1 : -1; // ...and therefore which way is further from it
  const bearing = subjectB + FRAME_THIRD * side;
  return { bearing, side, sunOff: Math.abs(wrapPi(bearing - SUN_BEARING)) };
}

/**
 * How far to slide an aim point sideways so the LENS AXIS — not the aim bearing — is
 * FRAME_THIRD off the subject for the whole shot.
 *
 * Rotating the aim point about the shot's END and then dollying toward it does not do that:
 * from the far end of the move the same aim point subtends a smaller angle, so the framing
 * opens up as the shot runs and the sun creeps back toward the middle. Measured on seed 555,
 * the water shot's axis came within 10.7 deg of the sun at the head of the move while its aim
 * bearing was a well-behaved 14.9 deg out. Sizing the lateral offset from the FURTHEST the
 * camera ever is instead makes the guarantee hold at both ends.
 *
 * @param {number} along  metres from the camera's furthest position to the aim point
 * @returns {number} metres of lateral offset, unsigned
 */
const aimOffset = (along) => Math.max(along, 1) * Math.tan(FRAME_THIRD);

/**
 * The ground under a straight path, sampled ONCE at scout time into a curve the shot then
 * reads for free — this file's fourth rule is that no shot samples the world per frame, and a
 * single `max` over the whole path is not enough on its own: it is the right number at the one
 * point where the ridge is and tens of metres too high everywhere else, which is why the crane
 * used to fly higher than it needed to for nine seconds to clear one bank.
 *
 * `spread` also samples a lateral pair at each step, so a bank standing just beside the rail
 * counts as ground. Cost is (n+1)*(1+2*spread?) landHeight() calls, once, during boot.
 *
 * @returns {{max:number, at:(t:number)=>number}} `at` takes 0..1 along a->c.
 */
function groundProfile(a, c, ground, n = 48, spread = 0) {
  const h = new Float64Array(n + 1);
  const dx = c.x - a.x;
  const dz = c.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const lx = -dz / len;
  const lz = dx / len;
  let max = -Infinity;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + dx * t;
    const z = a.z + dz * t;
    let g = ground(x, z);
    if (spread > 0) {
      g = Math.max(g, ground(x + lx * spread, z + lz * spread), ground(x - lx * spread, z - lz * spread));
    }
    h[i] = g;
    if (g > max) max = g;
  }
  /* One-cell dilation. The camera is a point but the frame is not, and a spike that falls
   * between two samples must not become a spike the shot flies through. */
  const d = Float64Array.from(h);
  for (let i = 0; i <= n; i++) d[i] = Math.max(h[Math.max(i - 1, 0)], h[i], h[Math.min(i + 1, n)]);
  return {
    max,
    at(t) {
      const f = clamp01(t) * n;
      const i = Math.min(Math.floor(f), n - 1);
      return lerp(d[i], d[i + 1], f - i);
    },
  };
}

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
   * @param {() => boolean} [o.worldReady] asked every frame until it says yes; while it says
   *   no the programme runs at HOLD_RATE, for at most HOLD_MAX seconds of lost time. Omit it
   *   and the programme runs at exactly the rate it always did.
   * @param {Function} [o.onEnd]
   */
  constructor({ camera, seed, spawn, terrain = null, chase = null, groundAt = null, hud = null, mode = null, worldReady = null, onEnd = null }) {
    this.camera = camera;
    this.seed = seed >>> 0;
    this.spawn = spawn;
    this.terrain = terrain;
    this.chase = chase;
    this.groundAt = groundAt;
    this.hud = hud;
    this.worldReady = typeof worldReady === 'function' ? worldReady : null;
    this.onEnd = onEnd;

    this.mode = mode || pickMode();
    this.shots = [];
    this.duration = 0;
    this.t = 0;
    this.shotIndex = -1;
    this.skipped = false;

    /* Diagnostics, read by tools/diag-cinematic.mjs and by nothing in the game. */
    this.held = 0; // seconds of programme time given back to the streamer
    this.holdEnded = ''; // 'ready' | 'timeout' | '' if it never waited
    this.lifted = 0; // worst metres the clearance floor ever had to raise the camera
    this.faulted = null; // the error that ended the programme early, if one did

    this._running = false;
    this._holding = false;
    this._pose = newPose();
    this._rest = {};
    this._hint = null;
    this._watchdog = 0;
    this._onAny = null;

    /* Scout during boot, not at reveal. It is ~20 ms of pure world queries and the loading
     * bar is already on screen; doing it inside the reveal timeout would drop a frame in the
     * middle of the veil fading out, which is the one moment the player is looking at a
     * cross-fade.
     *
     * Wrapped, because this runs inside main.js's `boot()` and an exception here would take
     * the whole boot down with it. There is no version of "the opening cinematic could not
     * find a mountain" that is allowed to cost somebody their game; an empty shot list makes
     * begin() a no-op and the player simply starts driving. */
    if (this.mode !== 'off') {
      try {
        this._scout();
      } catch (err) {
        this.faulted = err;
        this.shots = [];
        this.duration = 0;
        console.error('[cinematic] scouting failed; starting straight into the game', err?.message ?? err);
      }
    }
  }

  /** True while the programme is running at HOLD_RATE waiting for terrain. */
  get holding() {
    return this._holding;
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

    /* ── waiting for the ground to exist ──────────────────────────────────────
     * See HOLD_RATE. The clock runs slow, it never stops, and it can only be slowed for
     * HOLD_MAX seconds in total — so the worst case is a programme that takes six seconds
     * longer, and there is no path here that can leave a player watching a still frame
     * forever. Skipped shots are never held: `skipped` means the player has already asked
     * to be somewhere else. */
    let rate = 1;
    if (this.worldReady && !this.skipped && this.held < HOLD_MAX) {
      let ready = true;
      try {
        ready = !!this.worldReady();
      } catch {
        ready = true; // a predicate that throws is not a reason to hold up the game
      }
      if (!ready) {
        rate = HOLD_RATE;
        this.held = Math.min(HOLD_MAX, this.held + dt * (1 - HOLD_RATE));
        this._holding = true;
      } else if (this._holding) {
        this._holding = false;
        this.holdEnded = 'ready';
      }
    } else if (this._holding) {
      this._holding = false;
      this.holdEnded = 'timeout';
    }
    this.t += dt * rate;

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
    /* Every line of every shot below runs inside this. main.js calls requestAnimationFrame
     * before it calls us, so a throw here would not stop the game — but it WOULD leave the
     * camera frozen mid-crane and the cinematic "active" until a twelve-second watchdog, and
     * the player pressing keys at a picture that has stopped moving is the exact shape of the
     * bug this project has already shipped once. Fault, hand the camera back, drive. */
    try {
      shot.pose(u, car, p, this);
      if (!Number.isFinite(p.px + p.py + p.pz + p.lx + p.ly + p.lz + p.fov)) throw new Error('non-finite pose');
    } catch (err) {
      this.faulted = err;
      console.error('[cinematic] shot "%s" faulted; handing the camera back', shot.name, err?.message ?? err);
      this._end();
      return false;
    }

    const cam = this.camera;
    cam.position.set(p.px, p.py, p.pz);
    // The chase camera tilts `up` for its speed shake; a cinematic is always level.
    cam.up.set(0, 1, 0);
    cam.lookAt(p.lx, p.ly, p.lz);
    if (Math.abs(cam.fov - p.fov) > 0.01) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }

    /* The programme LOOPS rather than ending. The operator's ask is that the cinematic is what
     * the game does when nobody is playing — so running out of shots is not a reason to hand a
     * parked car back to the chase camera and sit there. It starts again instead, and the only
     * thing that ever ends it is the player (skip(), from any key, button, tap or stick).
     * `_loop()` restarts the programme in place rather than calling begin(), because begin()
     * re-attaches the overlay and re-arms the watchdog that would then fire mid-loop. */
    /* A SKIP MUST STILL END IT. skip() replaces the programme with a single ease-out shot and
     * then relies on this very branch to finish; if the skipped case looped too, the ease would
     * restart for ever and the cinematic could never be dismissed — an unskippable intro, which
     * is the game being unplayable. Caught by testing skip at five different moments rather
     * than by reading the diff. */
    if (this.t >= this.duration) {
      if (this.skipped) this._end();
      else this._loop();
    }
    return this._running;
  }

  /** Start the programme over, keeping the overlay and the skip hint exactly as they are. */
  _loop() {
    /* A degenerate programme (no terrain to scout, so every shot collapsed) would otherwise
     * re-loop every single frame for ever. End instead — there is nothing to show. */
    if (!(this.duration > 1)) {
      this._end();
      return;
    }
    this.t = 0;
    this.shotIndex = -1;
    this.loops = (this.loops || 0) + 1;
    /* Re-arm the backstop for the new pass. Without this the watchdog set in begin() fires one
     * programme-length after the FIRST pass and tears the cinematic down mid-loop — the exact
     * "something outlives the loop that drives it" failure begin()'s own comment warns about. */
    if (typeof setTimeout === 'function') {
      if (this._watchdog) clearTimeout(this._watchdog);
      this._watchdog = setTimeout(() => this._end(), (this.duration + 12) * 1000);
    }
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
   * stacks, and stacked ridges are what makes a horizon read as far away.
   *
   * It is also the shot the valley mist is FOR. Ninety metres up, looking across two and a
   * half kilometres of low ground at a massif that stands clear above the mist sea, with the
   * sun fifteen degrees off the lens — that view is the entire reason render's aerial() has a
   * mist term in it, and it is why this shot is the one that got longer and slower rather
   * than the one that got another cut. */
  _shotLand(lm, ground, spawnY) {
    const b = Math.atan2(lm.x - this.spawn.x, lm.z - this.spawn.z); // bearing to the mountain
    const framed = composeAim(b);
    this.framing = framed; // read by tools/diag-cinematic.mjs
    // Start behind the spawn relative to the mountain, so the whole move is an approach.
    const a = { x: this.spawn.x - fwdX(b) * 270, z: this.spawn.z - fwdZ(b) * 270 };
    const c = { x: this.spawn.x - fwdX(b) * 160, z: this.spawn.z - fwdZ(b) * 160 };
    /* Slide sideways too, so the parallax on the near ridges is not purely radial — a purely
     * radial approach makes a 3D landscape read as a zoom on a photograph. The slide goes the
     * OPPOSITE way to the framing offset, so the camera and the eyeline counter each other:
     * the massif drifts across the frame while the world slides under it, which is a crane,
     * and both of them moving the same way is a pan. */
    a.x -= leftX(b) * 45 * framed.side;
    a.z -= leftZ(b) * 45 * framed.side;
    /* 48 samples of the CARVED surface with a 40 m lateral spread, once, instead of 18 raw ones
     * down the centreline: the curve is what the pose reads, so a single bank no longer holds
     * the whole crane up, and an embankment is no longer invisible to it. */
    const prof = groundProfile(a, c, this._carved([a, c]), 48, 40);
    const y0 = Math.max(prof.at(0), spawnY) + 92;
    const y1 = Math.max(prof.at(1), spawnY) + 56;

    // Look at the mountain, a little below the summit so it sits high in frame.
    const lmY = ground(lm.x, lm.z);
    const aimD = Math.min(lm.d, 2600);
    const lat = aimOffset(aimD + 270) * framed.side;
    const aim = {
      x: this.spawn.x + fwdX(b) * aimD + leftX(b) * lat,
      z: this.spawn.z + fwdZ(b) * aimD + leftZ(b) * lat,
    };
    const aimY = lerp(Math.max(spawnY, ground(aim.x, aim.z)), lmY, 0.45);

    return {
      name: 'land',
      dur: SHOT_SECONDS.land,
      sunOff: framed.sunOff,
      pose: (u, car, out, self) => {
        const d = dolly(u, 0.28);
        out.px = lerp(a.x, c.x, d);
        out.pz = lerp(a.z, c.z, d);
        out.py = lerp(y0, y1, d);
        // A very slow pan across the summit: 90 m of drift at ~1.8 km is under 3°, spread
        // over twelve seconds. You should not be able to say the camera is panning, only that
        // the shot is alive. It settles ONTO the composed frame rather than starting there.
        const pan = (1 - d) * 90 * framed.side;
        out.lx = aim.x + leftX(b) * pan;
        out.lz = aim.z + leftZ(b) * pan;
        out.ly = aimY;
        /* Two and a half degrees of push over twelve seconds. Below the threshold at which
         * anybody can name it as a zoom, and above the threshold at which a static frame
         * starts to feel like a photograph rather than a shot. */
        out.fov = lerp(53, 50.5, smootherstep(0, 1, u));
        self._floor(out, prof, d, 34);
      },
    };
  }

  /**
   * The clearance net. A shot that hands its scouted ground profile to this can never be flown
   * into the ground, whatever the seed does — and it costs one array lookup per frame, not a
   * terrain query, because the profile was measured once during boot.
   *
   * It only ever RAISES, it is never used by the closing shot (which has to land on the chase
   * camera's rest pose to the millimetre), and how far it ever had to reach is recorded in
   * `this.lifted` — so a shot that is quietly relying on it shows up as a number rather than
   * as a shot that merely happens to work on the one seed somebody looked at.
   */
  /**
   * A CARVED ground sampler over a small box — the surface the renderer actually draws, roads,
   * cuttings and embankments included.
   *
   * landHeight() is the raw land BEFORE the road network is cut into it, and every clearance
   * in this file used to be measured against it. On seed 555 that was worth 9.5 metres of
   * camera underground: the water shot flies across a lake whose bed landHeight() reports at
   * -7 m, and the road that crosses it is a CAUSEWAY standing at +7 to +17.7 m. The shot
   * cleared the lake bed by eight metres, which put it nine and a half metres inside an
   * embankment nobody had asked about. Raw land is not the ruler; the drawn surface is.
   *
   * A Terrain over a 200 m box costs 0.5 ms to build and 8 µs a sample, against 4.8 µs for
   * landHeight — so the whole correction is about two milliseconds of a twenty millisecond
   * scout, paid once during boot, and nothing at all per frame.
   */
  _carved(pts, pad = 60) {
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    try {
      const t = new Terrain(this.seed, x0 - pad, z0 - pad, x1 + pad, z1 + pad);
      return (x, z) => t.height(x, z);
    } catch (err) {
      // Raw land is a worse ruler, but it is a ruler; a shot is better than no shot.
      console.error('[cinematic] carved sampler unavailable, falling back to raw land', err?.message ?? err);
      return (x, z) => landHeight(x, z, this.seed);
    }
  }

  _floor(out, prof, d, clear) {
    const need = prof.at(d) + clear;
    if (out.py < need) {
      const lift = need - out.py;
      if (lift > this.lifted) this.lifted = lift;
      out.py = need;
    }
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
    /* 25 m of lateral spread on the CARVED surface: this shot flies ten metres off the water,
     * the thing that can kill it is a bank standing just beside the line rather than on it, and
     * over a lake that bank is usually a road causeway that raw land cannot see at all.
     *
     * The two ends are floored independently rather than both against the path's single worst
     * point — otherwise one causeway at the far end lifts the entire glide out of the water,
     * which is the shot. Anything in between is caught by _floor per frame, for free. */
    const prof = groundProfile(a, c, this._carved([a, c, wet]), 40, 25);
    const y0 = Math.max(wet.y, prof.at(0)) + 12.5;
    const y1 = Math.max(wet.y, prof.at(1)) + LOW_CLEAR + 1.5;

    /* Same framing rule as the crane: the shore lands off-centre, on the side that keeps the
     * low sun out of the middle of a shot whose whole subject is a specular water plane. A
     * sun disc reflected up the lens axis off flat water is the one thing in this palette
     * that can genuinely blow the frame out. */
    const framed = composeAim(b);
    const aimD = 190;
    // 125 m of dolly plus 190 m of stand-off: size the slide from the far end of the move.
    const lat = aimOffset(aimD + Math.hypot(c.x - a.x, c.z - a.z)) * framed.side;
    const aim = {
      x: c.x + fwdX(b) * aimD + leftX(b) * lat,
      z: c.z + fwdZ(b) * aimD + leftZ(b) * lat,
    };
    const aimY0 = wet.y + 2.0;
    const aimY1 = Math.max(wet.y, ground(aim.x, aim.z)) + 26;

    return {
      name: 'water',
      dur: SHOT_SECONDS.water,
      sunOff: framed.sunOff,
      pose: (u, car, out, self) => {
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
        self._floor(out, prof, d, LOW_CLEAR);
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
    const prof = groundProfile(a, c, this._carved([a, c]), 40, 25);
    const y0 = Math.max(prof.at(0), spawnY) + 26;
    const y1 = Math.max(prof.at(1), spawnY) + LOW_CLEAR + 4;
    const framed = composeAim(b);
    const lat = aimOffset(700 + Math.hypot(c.x - a.x, c.z - a.z)) * framed.side;
    const aim = {
      x: this.spawn.x + fwdX(b) * 700 + leftX(b) * lat,
      z: this.spawn.z + fwdZ(b) * 700 + leftZ(b) * lat,
    };
    const aimY = Math.max(spawnY, ground(aim.x, aim.z)) + 24;
    return {
      name: 'rise',
      dur: SHOT_SECONDS.water,
      sunOff: framed.sunOff,
      pose: (u, car, out, self) => {
        const d = dolly(u, 0.3);
        out.px = lerp(a.x, c.x, d);
        out.pz = lerp(a.z, c.z, d);
        out.py = lerp(y0, y1, d);
        out.lx = aim.x;
        out.lz = aim.z;
        out.ly = aimY;
        out.fov = 55;
        self._floor(out, prof, d, LOW_CLEAR);
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

/* maxGroundAlong() lived here and returned ONE number for a whole path. groundProfile() above
 * replaced it: same measurement, same "sample the world once, never per frame" rule, but it
 * keeps the shape of the ground instead of collapsing it to its worst point — which is both a
 * lower, better-looking crane and a floor the shot can actually be held above. */

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
  /* Always the full programme, every visit. It used to be full-on-first-visit and the closing
   * shot thereafter, on the reasoning that nobody wants to sit through an intro twice — but the
   * operator asked for the opposite and the opposite is right for this game: "it should
   * actually be in cinematic mode whenever you're not playing... it should start in cinematic
   * mode and remain there until you move a key or do anything." The cinematic is the game's
   * idle state, not its title card. It costs the player nothing, because ANY input ends it
   * instantly and the frame loop was never blocked by it in the first place.
   * `?intro=short` and `?intro=off` still override, which is how you skip it permanently. */
  return 'full';
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
