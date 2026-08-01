/* Wanderoad — THE LITTLE CLOUD THAT BRINGS YOU FUEL.
 *
 * Operator: "You know the cloud camera guy from mario -- something cute like that should come down
 * and give you the extra gass when you run out (same thing just visual)."
 *
 * "Same thing just visual" is the whole specification, and it is worth taking literally. Running dry
 * already works: game/fuel.js counts three mercy cans, refills the tank and says a line. None of that
 * changes. What was missing is that the most memorable moment in the game — the moment you are
 * rescued — happened as a line of text at the top of the screen.
 *
 * So this is a character, not a mechanic. It drifts down out of the sky ahead of the car, hangs there
 * while it hands the can over, and rises away. It carries nothing, decides nothing, and if it fails
 * to appear the player still gets their fuel.
 *
 * BUILT FROM THE SAME PAINTED PRIMITIVES as everything else in this game — a cloud of overlapping
 * spheres, a little figure sitting in it, and the red can it is holding out. Nothing is downloaded,
 * and it goes through the one painted material like every prop, so it costs one mesh.
 *
 * It is DELIBERATELY NOT the Mario character. The operator named it as a reference for the FEELING —
 * something cute that comes down out of the sky — and that idea is not anyone's property, but a
 * fisherman on a smiling cloud in glasses would be. This is a round friendly blob in a flat cap
 * leaning out of an ordinary cloud, which is its own thing.
 */
import { Mesh, Group } from 'three';
import { PB, pbox, pcyl, finishPainted, createPaintedMaterial, MAT, LC } from './painted.js';

/** Seconds the whole visit lasts: down, hold, up. */
export const VISIT_S = 4.2;
/** Metres ahead of the car it appears, and the height it comes down from and returns to. */
const AHEAD = 9;
const HIGH = 26;
const LOW = 5.2;

const CLOUD = LC('paintD');
const SKIN = LC('paintB');
const COAT = LC('paintE');
const CAN = LC('paintA');
const INK = LC('paintF');

/**
 * The mesh, built once and reused. Local space: the cloud sits at the origin with the figure above
 * it, so the caller only has to position and face it.
 */
function build(material) {
  const M = PB();
  /* The cloud: five overlapping lumps rather than one ball, because a single sphere reads as a
   * balloon. The same trick the sky's own puffs use, at a scale you can stand next to. */
  /* There is no sphere primitive in painted.js and there does not need to be: a lump is a short,
   * fat, many-sided cylinder with both caps on, which at this scale reads exactly like a puff and
   * costs a fraction of a sphere's triangles. */
  const lump = (x, y, z, r) => pcyl(M, [x, y - r * 0.55, z], [x, y + r * 0.55, z], r, r * 0.82, 10, CLOUD, MAT.MATTE, true, true);
  lump(0, 0, 0, 1.5);
  lump(1.25, 0.18, 0.2, 1.05);
  lump(-1.3, 0.12, -0.15, 1.0);
  lump(0.3, 0.42, 1.0, 0.85);
  lump(-0.35, 0.38, -0.95, 0.9);

  // the figure, leaning out of the top: body, head, cap, and one arm holding the can out
  pbox(M, 0, 1.35, 0.1, 0.42, 0.42, 0.34, 0, COAT, MAT.MATTE);
  pcyl(M, [0, 1.72, 0.1], [0, 2.18, 0.1], 0.4, 0.34, 9, SKIN, MAT.MATTE, true, true); // the head
  pbox(M, 0, 2.28, 0.1, 0.5, 0.08, 0.46, 0, COAT, MAT.MATTE); // the flat cap
  pbox(M, 0.12, 2.3, 0.5, 0.34, 0.06, 0.2, 0, COAT, MAT.MATTE); // its peak
  pcyl(M, [0.34, 1.5, 0.2], [0.95, 1.15, 0.55], 0.12, 0.12, 6, SKIN, MAT.MATTE, true, true); // the arm

  // the can it is holding out, with a spout and a handle
  pbox(M, 1.08, 0.96, 0.62, 0.24, 0.3, 0.17, 0, CAN, MAT.MATTE);
  pcyl(M, [1.08, 1.26, 0.62], [1.08, 1.42, 0.75], 0.05, 0.04, 5, INK, MAT.MATTE, false, false);
  pbox(M, 1.08, 1.3, 0.62, 0.16, 0.04, 0.03, 0, INK, MAT.MATTE);

  const mesh = new Mesh(finishPainted(M), material);
  mesh.name = 'fuelHelper';
  return mesh;
}

export class FuelHelper {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Material} [material] share the props' painted material when there is one to share
   */
  constructor(scene, material = null) {
    this.group = new Group();
    this.group.name = 'fuelHelper';
    this.group.visible = false;
    this.mesh = build(material || createPaintedMaterial());
    this.group.add(this.mesh);
    scene.add(this.group);
    /** Seconds into the current visit, or -1 when there is nobody about. */
    this.t = -1;
    this._x = 0;
    this._z = 0;
    this._groundY = 0;
    this._yaw = 0;
  }

  /**
   * Come and give this car a can. Safe to call again mid-visit — it simply restarts, which is what
   * should happen if somebody manages to run dry twice in four seconds.
   *
   * @param {{x:number,z:number,yaw:number}} car
   * @param {(x:number,z:number)=>number} groundY
   */
  visit(car, groundY) {
    this._x = car.x + Math.sin(car.yaw) * AHEAD;
    this._z = car.z + Math.cos(car.yaw) * AHEAD;
    this._groundY = groundY(this._x, this._z);
    // Face back down the road at the car, so the can is held out towards the driver.
    this._yaw = car.yaw + Math.PI;
    this.t = 0;
    this.group.visible = true;
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t >= VISIT_S) {
      this.t = -1;
      this.group.visible = false;
      return;
    }
    const f = this.t / VISIT_S;
    /* Down for the first third, hold for the middle, up for the last — with a smoothstep either
     * side so it drifts rather than snaps. A cloud should never look like it is on rails. */
    const ease = (a) => a * a * (3 - 2 * a);
    let h;
    if (f < 0.33) h = HIGH + (LOW - HIGH) * ease(f / 0.33);
    else if (f < 0.7) h = LOW;
    else h = LOW + (HIGH - LOW) * ease((f - 0.7) / 0.3);
    // A slow bob while it waits, so it is alive rather than parked in the air.
    const bob = Math.sin(this.t * 2.4) * 0.16 * (f > 0.3 && f < 0.72 ? 1 : 0);
    this.group.position.set(this._x, this._groundY + h + bob, this._z);
    this.group.rotation.set(0, this._yaw, 0);
    // and a gentle sway, which is most of what makes it read as floating
    this.group.rotation.z = Math.sin(this.t * 1.7) * 0.05;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.mesh.geometry.dispose();
  }
}
