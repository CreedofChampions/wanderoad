/* Wanderoad — the streak trail.
 *
 * A ribbon that pays out behind the car while a streak is alive. It is the game's only
 * scoreboard that lives in the world rather than on the glass: you can see how long you have
 * been going without looking away from the road, which is the whole point of a cozy game.
 *
 * How it reads:
 *   - nothing at all for the first 100 m, so a short hop never trails anything
 *   - then a very pale blue thread that lengthens as the streak does
 *   - the blue DEEPENS with distance, on a log curve, so the first kilometre is a visible
 *     change and the tenth is a subtle one
 *   - the whole thing brightens gently while the streak is alive
 *   - when it breaks, it flashes red once and is reeled in rather than deleted
 *
 * The rope is a chain of points that follow the one in front with a spring and a little
 * gravity, which is what gives it weight through a corner instead of tracking the car like a
 * rigid stick. It is cosmetic: nothing here can touch the car.
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
    scene.add(this.mesh);
    this._prevDistance = 0;
  }

  /**
   * @param {number} dt
   * @param {Vehicle} car
   * @param {object} state the Streak's `state` object
   */
  update(dt, car, state) {
    const distance = state.distance || 0;

    // Break detection: the streak was long, and now it is not.
    if (this._prevDistance > START_AT && distance < this._prevDistance * 0.5) this.breakFlash = 1;
    this._prevDistance = distance;
    /* Decay over ~1.1 s rather than the old 0.6 s, so the red outlasts the reel-in (alive
     * falls at 0.9/s) instead of going out while the rope is still on screen. A blip you can
     * miss by blinking is a blip that did not happen. */
    this.breakFlash = Math.max(0, this.breakFlash - dt * 0.9);

    const wants = distance > START_AT;
    this.alive = wants ? Math.min(1, this.alive + dt * 2.2) : Math.max(0, this.alive - dt * 0.9);

    // How much rope is out: nothing until 100 m, then paying out over the first kilometre.
    const payout = clamp01((distance - START_AT) / 900);
    // Depth of blue on a log curve, so the first kilometre is a visible change and the tenth
    // is a subtle one. Exponentially harder to move, exactly as asked.
    this.depth = clamp01(Math.log10(1 + distance / 220) / Math.log10(1 + DEEPEST_AT / 220));

    this.material.uniforms.uAlive.value = this.alive;
    this.material.uniforms.uDepth.value = this.depth;
    this.material.uniforms.uBreak.value = this.breakFlash;
    if (this.alive < 0.005) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    /* ── the rope ────────────────────────────────────────────────────────
     * The head is pinned just behind the car; every other link chases the one in front,
     * keeping a fixed spacing, with a little gravity so it sags. That is what makes it swing
     * wide through a corner instead of following like a rigid stick. */
    const back = 2.2;
    const hx = car.x - Math.sin(car.yaw) * back;
    const hz = car.z - Math.cos(car.yaw) * back;
    const hy = car.y + 0.35;

    if (!this.points.length) {
      for (let i = 0; i < LINKS; i++) this.points.push({ x: hx, y: hy, z: hz });
    }
    this.points[0].x = hx;
    this.points[0].y = hy;
    this.points[0].z = hz;

    const spacing = SPACING * (0.35 + 0.65 * payout);
    for (let i = 1; i < LINKS; i++) {
      const p = this.points[i];
      const a = this.points[i - 1];
      let dx = p.x - a.x;
      let dy = p.y - a.y;
      let dz = p.z - a.z;
      const d = Math.hypot(dx, dy, dz) || 1e-5;
      // Pull back to the correct distance behind the link in front.
      const pull = (d - spacing) / d;
      p.x -= dx * pull;
      p.y -= dy * pull;
      p.z -= dz * pull;
      // A little sag, and a little damping towards the car's height so it never trails off
      // into the ground or the sky.
      p.y = lerp(p.y, a.y - 0.06, Math.min(1, dt * 6));
    }

    // Build the ribbon: each link becomes two vertices, offset perpendicular to the rope.
    const width = lerp(0.10, 0.34, payout);
    for (let i = 0; i < LINKS; i++) {
      const p = this.points[i];
      const q = this.points[Math.min(i + 1, LINKS - 1)];
      const o = this.points[Math.max(i - 1, 0)];
      let tx = q.x - o.x;
      let tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const nx = tz * width;
      const nz = -tx * width;
      const k = i * 6;
      this.pos[k] = p.x - nx;
      this.pos[k + 1] = p.y;
      this.pos[k + 2] = p.z - nz;
      this.pos[k + 3] = p.x + nx;
      this.pos[k + 4] = p.y;
      this.pos[k + 5] = p.z + nz;
    }
    this.geometry.attributes.position.needsUpdate = true;
  }

  /** Snap the rope to the car — after a teleport, so it does not stretch across the world. */
  reset(car) {
    const back = 2.2;
    const hx = car.x - Math.sin(car.yaw) * back;
    const hz = car.z - Math.cos(car.yaw) * back;
    for (const p of this.points) {
      p.x = hx;
      p.y = car.y + 0.35;
      p.z = hz;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
