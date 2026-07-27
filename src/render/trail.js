/* Wanderoad — the streak trail. RETIRED 2026-07-27, DISABLED IN PLACE — read this before
 * touching the class below.
 *
 * The operator, verbatim: "Rope in back of car does not look good at all or make it clear --
 * use the bottom blue line instead." The bottom unlock bar in src/ui/hud.js (#unlockBar) is
 * now the sole streak readout; this file no longer draws anything.
 *
 * It is disabled rather than deleted because src/main.js (and window.WANDEROAD, for any
 * tooling/console use) still holds a live `trail` reference and calls `.update()`/`.reset()`
 * on it every frame — see the constructor and those two methods below for exactly how the
 * no-op is enforced. The class, geometry and shader are otherwise untouched, so a future "put
 * it back" is a two-line revert, not a rewrite.
 *
 * What it USED to draw, for context: a ribbon that paid out behind the car while a streak was
 * alive —
 *   - nothing at all for the first 100 m, so a short hop never trailed anything
 *   - then a very pale blue thread that lengthened as the streak did
 *   - the blue DEEPENED with distance, on a log curve, so the first kilometre was a visible
 *     change and the tenth was a subtle one
 *   - the whole thing brightened gently while the streak was alive
 *   - when it broke, it flashed red once and was reeled in rather than deleted
 *
 * The rope was a chain of points that followed the one in front with a spring and a little
 * gravity, which is what gave it weight through a corner instead of tracking the car like a
 * rigid stick. It was cosmetic: nothing in it could touch the car.
 */

import { BufferGeometry, BufferAttribute, Mesh, RawShaderMaterial, DoubleSide, Vector3 } from 'three';
import { vertHead, fragHead } from '../core/glsl.js';
import { sharedUniforms } from './uniforms.js';
import { clamp01, lerp } from '../core/math.js';
import { FLEET } from '../game/garage.js';

/** Metres of streak before the trail appears at all. */
const START_AT = 100;
/** Rope segments. Each is a vertex pair across the ribbon. */
const LINKS = 56;
/** Metres between links when the rope is fully paid out. */
const SPACING = 1.35;
/* The rope reaches its deepest blue at the last car in the fleet — the Patrol, at 100 km.
 * This was an arbitrary 60 km before, which meant the trail said "you have arrived" while the
 * bar on the glass still had forty kilometres to go. Two readouts of the same streak that
 * disagree is worse than one readout. Read from the fleet so it cannot drift again. */
const DEEPEST_AT = Math.max(...FLEET.map((c) => c.unlockAt)) || 100000;

const TRAIL_VS = /* glsl */ `
in float aT;      // 0 at the car, 1 at the tail
in float aSide;   // -1 or +1 across the ribbon
out float vT;
out float vSide;
out vec3 vWorld;
void main(){
  vT = aT;
  vSide = aSide;
  vWorld = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FS = /* glsl */ `
in float vT;
in float vSide;
in vec3 vWorld;
out vec4 fragColor;

uniform float uDepth;   // 0 pale .. 1 deep — how long the streak is
uniform float uAlive;   // 1 while the streak runs, falls to 0 as it is reeled in
uniform float uBreak;   // 1 at the instant it broke, decaying — the red blip

void main(){
  // Pale sky blue to a deep ink blue. Both are in the game's own palette range so the trail
  // never looks like a UI element that wandered into the scene.
  vec3 pale = vec3(0.66, 0.82, 0.94);
  vec3 deep = vec3(0.10, 0.26, 0.62);
  vec3 col = mix(pale, deep, uDepth);

  // The break flash. One red pulse, brightest at the car end, so it reads as something
  // letting go rather than the whole world changing colour.
  col = mix(col, vec3(0.86, 0.22, 0.16), uBreak * (1.0 - vT * 0.6));

  // Soft edges across the ribbon and a fade towards the tail.
  float edge = 1.0 - abs(vSide);
  float a = smoothstep(0.0, 0.35, edge) * (1.0 - vT * vT) * uAlive;
  // A gentle glow while it is alive: the operator asked for things to "illumine a little bit"
  // when the streak is running.
  col += vec3(0.10, 0.16, 0.24) * uAlive * (1.0 - vT);

  if (a < 0.01) discard;
  fragColor = vec4(SAFE3(col), a * 0.72);
}
`;

export class StreakTrail {
  constructor({ scene }) {
    this.points = [];
    this.alive = 0;
    this.breakFlash = 0;
    this.depth = 0;

    const n = LINKS;
    this.pos = new Float32Array(n * 2 * 3);
    const t = new Float32Array(n * 2);
    const side = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      t[i * 2] = t[i * 2 + 1] = i / (n - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    const idx = new Uint16Array((n - 1) * 6);
    for (let i = 0, k = 0; i < n - 1; i++) {
      const a = i * 2;
      idx[k++] = a;
      idx[k++] = a + 2;
      idx[k++] = a + 1;
      idx[k++] = a + 1;
      idx[k++] = a + 2;
      idx[k++] = a + 3;
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('aT', new BufferAttribute(t, 1));
    g.setAttribute('aSide', new BufferAttribute(side, 1));
    g.setIndex(new BufferAttribute(idx, 1));
    g.frustumCulled = false;
    this.geometry = g;

    this.material = new RawShaderMaterial({
      glslVersion: '300 es',
      uniforms: sharedUniforms({
        uDepth: { value: 0 },
        uAlive: { value: 0 },
        uBreak: { value: 0 },
      }),
      vertexShader: vertHead(TRAIL_VS),
      fragmentShader: fragHead(TRAIL_FS),
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });

    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'streakTrail';
    this.mesh.renderOrder = 6;
    /* DISABLED — see the file header. Deliberately never `scene.add(this.mesh)`: a mesh that
     * is merely .visible = false is one stray line away from coming back (the exact gotcha
     * this project has been burned by before — a flag being set is not a thing being
     * invisible), but a mesh that was never attached to the scene graph cannot be drawn by any
     * renderer.render(scene, camera) call, full stop, no matter what anything else does to
     * `scene` or to this.mesh afterwards. update() below also returns before it would ever
     * touch `visible` or rebuild the geometry, so this is belt and suspenders, not one flag.
     * `scene` is still accepted (main.js still passes one) so the constructor signature, and
     * therefore every existing call site, needs no changes. */
    this.mesh.visible = false;
    this._prevDistance = 0;
  }

  /**
   * @param {number} dt
   * @param {Vehicle} car
   * @param {object} state the Streak's `state` object
   */
  update(_dt, _car, _state) {
    // DISABLED — see the file header. No mesh in the scene, so nothing here would ever be
    // seen; skip the rope's spring simulation and ribbon rebuild entirely rather than spend a
    // frame budget on geometry nobody can see. A real, immediate no-op (not a branch buried
    // partway down) so every existing call site in src/main.js stays valid unchanged, and so a
    // grep for `this.mesh.visible = true` in this file finds nothing — the original,
    // now-dead physics body is preserved in git history, not as unreachable code here.
  }

  /** Snap the rope to the car — after a teleport, so it does not stretch across the world.
   *  DISABLED along with update() above — see the file header. `this.points` is never
   *  populated any more, so this had already become a no-op in effect; it returns
   *  immediately instead so that is true by construction, not by accident. */
  reset(_car) {}

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
