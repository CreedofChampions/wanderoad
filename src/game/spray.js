/* Wanderoad — the off-road spray.
 *
 * Operator, docs/BACKLOG.md: "Sand particle spray when you go off-road, to make it obvious you
 * should not be there." Before this there was no emitter of any kind in the project — an audit
 * drove the car off the carriageway at 44 km/h for nine seconds and counted the scene before and
 * during: Points 0 -> 0, Sprites 0 -> 0, no new children at all. So this is built from scratch.
 *
 * ── what it is ────────────────────────────────────────────────────────────────
 * A few hundred small solid grains thrown up from the two REAR wheel contact patches, in the
 * colour of the ground they came from. One InstancedMesh, one draw call, one material, no
 * shader of its own — deliberately. This project has already lost a day to a GLSL reserved word
 * turning the whole game black (gotcha 5), and a dust cue is not worth a custom shader: little
 * solid cubes are also, as it happens, exactly what the painted-solid world is made of, so they
 * belong in the picture in a way a soft round sprite would not.
 *
 * ── cozy is the filter ────────────────────────────────────────────────────────
 * This is a CUE, not a rooster tail. Everything about the numbers is chosen to keep it that
 * way: grains a hand's width across, thrown a metre and a bit, gone in under a second, and a
 * hard ceiling of MAX live at once so a long off-road blast looks the same as a short one
 * rather than escalating. It comes up behind you where a mirror would show it, never in front
 * of the camera, and it never makes a sound. If you drive on the road you will never see it.
 *
 * ── how it decides to emit ────────────────────────────────────────────────────
 * Off the carriageway, moving, and the harder the tyres are working the more comes up:
 *
 *     rate = BASE x speedFactor x offRoad x (0.45 + 0.55 x effort)
 *
 * `offRoad` is 1 - car.onRoad — the SAME four-wheel average the rolling resistance, the speed
 * ceiling and game/fuel.js's off-road multiplier all already read (src/car/vehicle.js), never a
 * second surface probe, so a wheel in the grass means the same thing to all four of them.
 * `effort` is the tyres' own workload, car.limit, blended with sideslip: a straight line across
 * a meadow smokes gently, a slide across a dune throws a wall of it.
 *
 * Pure of the DOM and pure of the world: it is handed the car, a surface sample and a ground
 * height function, and it owns nothing but its own particles. tools/diag-spray.mjs steps it in
 * node with a stub scene and asserts the counts.
 */

import { InstancedMesh, BoxGeometry, MeshBasicMaterial, Object3D, Color, DynamicDrawUsage } from 'three';
import { clamp01 } from '../core/math.js';

/** Live grains at once. 260 is about a second and a half of full-rate emission, and it is the
 *  ceiling that keeps a long off-road run from escalating into a dust storm. */
const MAX = 260;
/** Grains per second at full effort on the loosest ground. */
const BASE_RATE = 150;
/** Below this speed nothing is thrown up — a car crawling over grass does not spray. m/s. */
const MIN_SPEED = 4.5;
/** ...and the rate is at full by here. m/s (~54 km/h). */
const FULL_SPEED = 15;
/** Seconds a grain lives, before the per-grain variation below. */
const LIFE = 0.62;
/** Metres. Grains are a hand's width, with a little variation so they do not read as one object
 *  cloned. */
const SIZE = 0.13;
/** m/s². Real gravity, so the arc looks like the arc of something heavy — dust that floats reads
 *  as smoke, and smoke is the wrong cue for a tyre on sand. */
const GRAV = 9.4;
/** Air drag per second on a grain, as a fraction of its speed. Enough that the throw stops
 *  looking ballistic before it lands. */
const DRAG = 1.9;

/* Ground colour per biome, in the order src/world/biomes.js keeps them: meadow, steppe,
 * highlands, dunes, wetland. Read straight off the palette's own sand/dry-grass/rock chips so a
 * grain matches the ground it came from rather than being a generic beige everywhere. Blended by
 * the surface sample's own weights, which means a spray on the boundary between two biomes is
 * the boundary's colour, the same way the ground under it already is. */
const DUST_HEX = [0xb9a870, 0xd3b87f, 0xb4a794, 0xe4c89a, 0x8e8a6e];
/** How much loose material each biome actually has to throw. Dunes are sand; a wet meadow is
 *  not. Also blended by weight, so this is a multiplier on the rate, never an on/off switch. */
const DUST_YIELD = [0.55, 0.9, 0.5, 1.0, 0.45];

export class Spray {
  /**
   * @param {object} opts
   * @param {THREE.Object3D} opts.scene  what to add the emitter to
   * @param {number} [opts.max]
   */
  constructor({ scene, max = MAX }) {
    this.max = max;
    this.count = 0; // live grains — read by the harness and by anyone debugging the rate
    this.spawned = 0; // lifetime total, ditto
    this._x = new Float32Array(max);
    this._y = new Float32Array(max);
    this._z = new Float32Array(max);
    this._vx = new Float32Array(max);
    this._vy = new Float32Array(max);
    this._vz = new Float32Array(max);
    this._life = new Float32Array(max); // seconds remaining; 0 = the slot is free
    this._full = new Float32Array(max); // ...and what it started at, for the fade
    this._size = new Float32Array(max);
    this._ground = new Float32Array(max); // the height it was thrown from, so it can land on it
    this._carry = 0; // fractional grains owed from previous frames

    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({
      transparent: true,
      opacity: 0.92,
      // Off, so a hundred overlapping grains do not have to be sorted against each other and
      // none of them punches a hole in the grass behind it. Depth TESTing stays on: a grain
      // behind a hill is behind the hill.
      depthWrite: false,
    }), max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false; // it lives at the car; culling it costs more than it saves
    this.mesh.renderOrder = 3;
    this.mesh.name = 'spray';
    /* Every slot starts scaled to nothing. An InstancedMesh draws ALL its instances whatever the
     * count says, and an uninitialised matrix is the identity — which would put a one-metre cube
     * at the world origin for every unused slot. That is the shape of bug this project keeps
     * paying for (gotcha 3: a flag being set is not a thing being visible, and its mirror image
     * — a thing being visible that no flag admits to). */
    this._dummy = new Object3D();
    this._dummy.scale.set(0, 0, 0);
    this._dummy.updateMatrix();
    for (let i = 0; i < max; i++) this.mesh.setMatrixAt(i, this._dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;

    this._col = new Color();
    this._tmp = new Color();
    if (scene) scene.add(this.mesh);
    this.scene = scene;
  }

  /**
   * One tick.
   *
   * @param {number} dt seconds
   * @param {object} car     the Vehicle — .x/.y/.z, .yaw, .speed, .onRoad, .limit, .slip, .wb
   * @param {object} surf    the terrain surface sample at the car (`.w` biome weights, `.onRoad`)
   * @param {(x:number,z:number)=>number} [groundAt] terrain height, so a grain lands on the
   *        ground it came off rather than on a plane through the car
   */
  update(dt, car, surf, groundAt = null) {
    if (!(dt > 0)) return;

    /* ── emit ──────────────────────────────────────────────────────────────
     * `car.onRoad` is the four-wheel average (see the file header for why this and not a
     * second probe). `?? 1` means a caller that hands in a bare car with no wheel data reads as
     * fully on-road and sprays nothing, which is the safe way round. */
    const speed = Math.abs(car.speed || 0);
    const off = 1 - clamp01(car.onRoad ?? 1);
    let want = 0;
    if (off > 0.02 && speed > MIN_SPEED && this.count < this.max) {
      const sp = clamp01((speed - MIN_SPEED) / (FULL_SPEED - MIN_SPEED));
      // How hard the tyres are working: the grip budget already spent, or the sideslip, whichever
      // says more. Both are numbers vehicle.js maintains for its own use.
      const effort = clamp01(Math.max(car.limit || 0, Math.abs(car.slip || 0) / 0.5));
      const yield_ = this._blendYield(surf);
      want = BASE_RATE * sp * off * yield_ * (0.45 + 0.55 * effort) * dt;
    }
    this._carry += want;
    let n = Math.floor(this._carry);
    this._carry -= n;
    if (n > 0) {
      this._blendColour(surf);
      const sy = Math.sin(car.yaw || 0);
      const cy = Math.cos(car.yaw || 0);
      // The REAR contact patches, in world space. Half a wheelbase behind the centre of mass and
      // a track's half-width either side — the two places the ground is actually being torn up.
      const back = (car.wb || 2.7) * 0.45;
      const half = 0.78;
      while (n-- > 0 && this.count < this.max) {
        const side = Math.random() < 0.5 ? -1 : 1;
        // +X is on your LEFT looking down +Z (gotcha 1), so the lateral axis is (cy, -sy).
        const px = car.x - sy * back + cy * half * side;
        const pz = car.z - cy * back - sy * half * side;
        const g = groundAt ? groundAt(px, pz) : (car.y || 0) - 0.36;
        this._emit(px, g + 0.06, pz, sy, cy, speed, side, g);
      }
    }

    /* ── step, and draw ────────────────────────────────────────────────────
     * A live grain is always at a slot below `count`; a dead one is swapped with the last live
     * slot so the live set stays contiguous and the loop never walks 260 empty slots to find
     * four live ones. */
    const dummy = this._dummy;
    for (let i = 0; i < this.count; ) {
      let l = this._life[i] - dt;
      if (l <= 0) {
        this._kill(i);
        continue;
      }
      const d = Math.max(0, 1 - DRAG * dt);
      this._vx[i] *= d;
      this._vz[i] *= d;
      this._vy[i] = this._vy[i] * d - GRAV * dt;
      this._x[i] += this._vx[i] * dt;
      this._y[i] += this._vy[i] * dt;
      this._z[i] += this._vz[i] * dt;
      // Landing: it stops on the ground it was thrown from and spends what is left of its life
      // sitting there, which is what makes the spray read as material rather than as light.
      if (this._y[i] < this._ground[i] + 0.02) {
        this._y[i] = this._ground[i] + 0.02;
        this._vy[i] = 0;
        this._vx[i] *= 0.25;
        this._vz[i] *= 0.25;
        if (l > 0.22) l = 0.22;
      }
      this._life[i] = l;
      /* THE FADE IS A SHRINK. MeshBasicMaterial has one opacity for the whole InstancedMesh and
       * no per-instance alpha without writing a shader, and a shader is not worth the risk here
       * (see the header). A grain that shrinks to nothing over its last third disappears just as
       * cleanly, and stays a solid object the whole time — which is the look this game is in. */
      const t = clamp01(l / this._full[i]);
      const s = this._size[i] * (t > 0.66 ? 1 : t / 0.66);
      dummy.position.set(this._x[i], this._y[i], this._z[i]);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
      i++;
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _emit(px, py, pz, sy, cy, speed, side, ground) {
    const i = this.count++;
    this._x[i] = px;
    this._y[i] = py;
    this._z[i] = pz;
    this._ground[i] = ground;
    /* Backwards and slightly outwards, because that is where a tyre throws things — never
     * forwards, which would put it in front of the camera. The backward component is a small
     * fraction of road speed so it hangs behind the car rather than keeping pace with it. */
    const bk = 0.18 * speed + 0.8 + Math.random() * 1.2;
    const out = (0.5 + Math.random() * 1.1) * side;
    this._vx[i] = -sy * bk + cy * out + (Math.random() - 0.5) * 0.7;
    this._vz[i] = -cy * bk - sy * out + (Math.random() - 0.5) * 0.7;
    this._vy[i] = 1.5 + Math.random() * 1.9;
    const l = LIFE * (0.75 + Math.random() * 0.5);
    this._life[i] = l;
    this._full[i] = l;
    this._size[i] = SIZE * (0.6 + Math.random() * 0.9);
    /* Per-grain colour: the blended ground colour, shaded a little either way so the cloud has
     * some depth in it instead of being one flat wash. instanceColor is allocated by three the
     * first time setColorAt is called. */
    const j = 0.82 + Math.random() * 0.32;
    this._tmp.setRGB(this._col.r * j, this._col.g * j, this._col.b * j);
    this.mesh.setColorAt(i, this._tmp);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.spawned++;
  }

  /** Swap the dead grain at `i` with the last live one and shrink the live set. */
  _kill(i) {
    const last = --this.count;
    if (i !== last) {
      for (const a of [this._x, this._y, this._z, this._vx, this._vy, this._vz, this._life, this._full, this._size, this._ground]) {
        a[i] = a[last];
      }
      this._dummy.position.set(this._x[i], this._y[i], this._z[i]);
      const s = this._size[i];
      this._dummy.scale.set(s, s, s);
      this._dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this._dummy.matrix);
      if (this.mesh.instanceColor) {
        this.mesh.getColorAt(last, this._tmp);
        this.mesh.setColorAt(i, this._tmp);
      }
    }
  }

  /** The ground's own colour here, blended by the surface sample's biome weights. */
  _blendColour(surf) {
    const w = surf && surf.w;
    let r = 0;
    let g = 0;
    let b = 0;
    let sum = 0;
    if (w) {
      for (let i = 0; i < DUST_HEX.length && i < w.length; i++) {
        if (!(w[i] > 0)) continue;
        this._tmp.setHex(DUST_HEX[i]);
        r += this._tmp.r * w[i];
        g += this._tmp.g * w[i];
        b += this._tmp.b * w[i];
        sum += w[i];
      }
    }
    if (sum > 1e-4) this._col.setRGB(r / sum, g / sum, b / sum);
    else this._col.setHex(DUST_HEX[0]);
    return this._col;
  }

  /** How much loose material this ground has, blended the same way. */
  _blendYield(surf) {
    const w = surf && surf.w;
    if (!w) return DUST_YIELD[0];
    let v = 0;
    let sum = 0;
    for (let i = 0; i < DUST_YIELD.length && i < w.length; i++) {
      v += DUST_YIELD[i] * w[i];
      sum += w[i];
    }
    return sum > 1e-4 ? v / sum : DUST_YIELD[0];
  }

  /** Everything gone, instantly — used after a teleport, so a rescue does not drag a comet tail
   *  of grass across the map behind it. */
  reset() {
    this.count = 0;
    this._carry = 0;
    this.mesh.count = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export { MAX as SPRAY_MAX, DUST_HEX, DUST_YIELD };
