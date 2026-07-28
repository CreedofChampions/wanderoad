/* Wanderoad — what another player's car actually looks like.
 *
 * THE BUG THIS FIXES, from the playtest report, verbatim: "Wrong car model too: both tabs
 * were on 'estate', but the player's own car is a loaded GLB (scene node car:estate /
 * NormalCar2_*) while remotes are built by buildGhostCar in src/car/model.js, which only has
 * three procedural shapes (CAR_TIERS = gt/sports/hyper) — in mp4-A.png the ghost is a
 * translucent angular procedural sedan sitting next to A's solid GLB hatch. Seven cars
 * collapse to three ghost bodies and none of them is the model being driven."
 *
 * That is exactly right, and it is worth being precise about what was and was not fixed
 * before. An EARLIER round fixed a real wire bug — main.js used to put `car.tier` (the
 * Vehicle's silhouette STRING, 'gt'/'sports'/'hyper') into an INTEGER column, PHP cast it to
 * 0, and every ghost in the world came back as CAR_TIERS[0]. Sending the FLEET INDEX instead
 * genuinely repaired that, and the wire has carried the right car ever since. What it did not
 * do — and what was quietly recorded as done — is make anything DRAW that car. The index
 * arrived correctly and was then handed to buildGhostCar(), which has three shapes.
 *
 * ── how this file solves it ───────────────────────────────────────────────────
 * The local player's car is a real CC0 GLB loaded by src/car/loadedCar.js. loadGhostCar() —
 * the translucent variant of the same loader — has existed in that file the whole time and is
 * imported by main.js and never called. So a ghost is simply the same GLB the driver is
 * actually driving, in the ghost material. Seven cars, seven ghosts.
 *
 * ── why it is not just `await loadGhostCar(...)` ──────────────────────────────
 * src/net/remotes.js's _spawn() is SYNCHRONOUS and must stay that way: it runs inside
 * ingest(), which runs inside the network tick, and it has to hand back an Object3D on the
 * spot. Making it async would mean a peer whose snapshot has arrived has no scene node to
 * interpolate into for as long as a 180 KB GLB takes to arrive over someone's phone
 * connection, and every code path in that file assumes `rec.obj` exists.
 *
 * So this hands back a small handle IMMEDIATELY — remotes.js already accepts `{root, update,
 * dispose}`, which is why that shape is in its doc comment — containing the procedural body
 * as a STAND-IN, and swaps the real GLB in underneath the moment it loads. A peer is
 * therefore never invisible, never blocks the tick, and is the right car within a frame or
 * two of appearing. If the GLB fails (offline, 404, a corrupt cache) the stand-in simply
 * stays, which is the same fallback the LOCAL car already takes in main.js: a network hiccup
 * on a model file must not cost anybody their game.
 *
 * ── a second thing that was missing ───────────────────────────────────────────
 * remotes.js calls `rec.api?.update?.(pose, dt)` every frame and has done for a long time,
 * but buildGhostCar() returns a handle with no `update`, so no ghost has ever steered its
 * wheels or spun them. The handle below implements it: the wire already carries steer,
 * throttle, brake and the velocity, so the wheels cost nothing to animate and a rolling car
 * whose wheels are frozen is one of those details that reads as "wrong" long before anybody
 * can say why.
 */

import { Object3D } from 'three';
import { buildGhostCar } from '../car/model.js';
import { loadGhostCar, CARS } from '../car/loadedCar.js';
import { FLEET } from '../game/garage.js';

/** Wheel radius, metres, for turning a reported speed into a wheel angle. The fleet's own
 *  bodies differ by a few centimetres and nobody can see the difference on a ghost. */
const WHEEL_R = 0.33;
/** Peak front-wheel angle, radians, at full lock. The wire carries `steer` as -1..1 (the
 *  normalised input), not an angle, so it needs a scale — this is the middle of the fleet's
 *  own maxSteerAngle() range and is a display detail, not a physics one. */
const MAX_STEER = 0.52;

/**
 * Counters, for evidence rather than for the game. The audit's question was "is the ghost the
 * right model", and the only honest answer is a count of how many ghosts actually got their
 * GLB rather than a description of the code that would fetch it. Read it off
 * `window.WANDEROAD.ghostStats` in a live browser, or off the return of makeGhostFactory().
 */
export const ghostStats = { built: 0, upgraded: 0, failed: 0, live: 0 };

/**
 * Build the factory src/net/remotes.js takes as `buildGhostCar`.
 *
 * @param {object} opts
 * @param {string} opts.base URL of the models directory, e.g. new URL('./models/cars/', href)
 * @returns {(spec:{id:string,name:string,tier:number,paint:number}) => object}
 */
export function makeGhostFactory({ base = './models/cars/' } = {}) {
  return function ghostFor({ tier = 0, paint = 0 } = {}) {
    /* `tier` off the wire is a FLEET INDEX (0..6) — see the note at the top and at
     * carPacket() in main.js. It is deliberately re-resolved here rather than trusted: a peer
     * on an older build, or a future fleet with more cars in it, must not be able to make
     * this throw inside a network tick. */
    const spec = FLEET[tier] ?? FLEET[0];

    const root = new Object3D();
    root.name = `ghost:${spec?.id ?? 'unknown'}`;

    /* The stand-in. Same procedural body remotes has always used, so the worst case after
     * this change is exactly the behaviour before it. */
    let live = buildGhostCar({ tier: spec?.tier ?? 'sports', paint });
    let standIn = live;
    root.add(live.group);
    ghostStats.built++;
    ghostStats.live++;

    let disposed = false;
    let spin = 0;

    if (spec && CARS[spec.id]) {
      loadGhostCar({ car: spec.id, paint, base })
        .then((model) => {
          // The peer may have driven out of range and been despawned while the GLB was in
          // flight. Dropping it on the floor here would leak a whole car's geometry.
          if (disposed) {
            model.dispose?.();
            return;
          }
          root.remove(standIn.group);
          standIn.dispose?.();
          standIn = null;
          live = model;
          root.add(model.group);
          ghostStats.upgraded++;
        })
        .catch((err) => {
          ghostStats.failed++;
          // Not console.error: a peer on a flaky connection is a normal condition, and
          // training everybody to ignore red console lines is worse than the missing model.
          console.info('[ghost] %s model did not load, keeping the built-in body', spec.id, err?.message ?? err);
        });
    }

    return {
      root,
      /**
       * Per frame, from remotes.js's interpolator. `pose` is the sampled snapshot, so every
       * value here is the peer's OWN reported control input, not a guess.
       */
      update(pose, dt) {
        if (!pose) return;
        live.setSteer?.((pose.steer || 0) * MAX_STEER);
        const speed = Math.hypot(pose.vx || 0, pose.vz || 0);
        spin = (spin + (speed / WHEEL_R) * (dt || 0)) % (Math.PI * 2);
        live.setWheelSpin?.(spin);
        live.setBrakeGlow?.(pose.brake || 0);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        ghostStats.live--;
        standIn?.dispose?.();
        if (live !== standIn) live.dispose?.();
        root.parent?.remove(root);
      },
      /** For a diagnostic: which fleet car this ghost is, and whether the GLB landed. */
      get carId() {
        return spec?.id ?? '';
      },
      get loaded() {
        return standIn === null;
      },
    };
  };
}
