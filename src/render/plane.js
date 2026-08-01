/* Wanderoad — THE AEROPLANE, WHICH DID NOT EXIST.
 *
 * Operator: "left thumbstick down start fly mode -- fails to load plane model -- fails to take off".
 *
 * He was exactly right, and the reason is worth writing down: there was no plane model ANYWHERE in
 * the project. `game/plane.js` is a complete flight model — a port of a well-regarded arcade jet
 * controller, with a bank trick, a proper drag curve and a throttle — and main.js flew it by dragging
 * the CAR's mesh to the plane's x and z. Not its height, and not its pitch or roll. So taking off
 * looked like nothing happening: your car slid along the ground while a flight model climbed away
 * invisibly above it.
 *
 * This is the body. Built from the same painted primitives as every prop rather than loaded, for the
 * same reason the Ford was authored: it costs one mesh through the one shared material, there is no
 * licence to check, and a high-wing light aircraft is boxes and cylinders.
 *
 * A HIGH WING ON PURPOSE. The chase camera sits behind and slightly above, and a low wing would put
 * the whole wing across the view of the ground you are flying over — which is the entire pleasure of
 * flying in a game about looking at landscape.
 */
import { Mesh } from 'three';
import { PB, pbox, pcyl, finishPainted, createPaintedMaterial, MAT, LC } from './painted.js';

const BODY = LC('paintD');
const TRIM = LC('paintA');
const GLASS = LC('glass');
const TYRE = LC('tyre');
const INK = LC('paintF');

/** Metres, nose to tail. A Cessna-ish light aircraft, and the number the flight model assumes. */
export const PLANE_LENGTH = 7.6;

/**
 * The player's aircraft, facing +Z like every other vehicle in this game so the same yaw convention
 * applies and nothing has to be rotated at the call site.
 *
 * @param {THREE.Material} [material] share the props' painted material where there is one
 */
export function buildPlane(material = createPaintedMaterial()) {
  const M = PB();

  // fuselage: a long box tapering into a tail boom, with a rounded nose
  pbox(M, 0, 0, 0.4, 0.52, 0.5, 2.0, 0, BODY, MAT.MATTE);
  pcyl(M, [0, 0, 2.35], [0, 0, 2.9], 0.46, 0.2, 10, TRIM, MAT.MATTE, false, true); // the spinner
  pbox(M, 0, 0.06, -1.9, 0.3, 0.3, 1.6, 0, BODY, MAT.MATTE); // tail boom

  // the cockpit glass, sitting on top where a high-wing aircraft's cabin is
  pbox(M, 0, 0.46, 0.75, 0.44, 0.3, 0.85, 0, GLASS, MAT.METAL);

  /* THE WING, above the cabin on a pair of struts. One span, with a little dihedral faked by two
   * halves tilted about z — a flat plank reads as a paper aeroplane. */
  for (const s of [-1, 1]) {
    pbox(M, s * 2.5, 0.92, 0.5, 2.2, 0.09, 0.72, 0, BODY, MAT.MATTE);
    pbox(M, s * 4.5, 1.02, 0.5, 0.3, 0.07, 0.6, 0, TRIM, MAT.MATTE); // the tip
    // strut down to the fuselage, which is what makes it read as a high wing rather than a floating slab
    pcyl(M, [s * 1.9, 0.86, 0.5], [s * 0.5, 0.1, 0.5], 0.06, 0.06, 5, INK, MAT.MATTE, false, false);
  }
  pbox(M, 0, 0.9, 0.5, 0.6, 0.1, 0.7, 0, BODY, MAT.MATTE); // the centre section over the cabin

  // tailplane and fin
  pbox(M, 0, 0.16, -3.2, 1.5, 0.07, 0.5, 0, BODY, MAT.MATTE);
  pbox(M, 0, 0.7, -3.15, 0.06, 0.6, 0.45, 0, TRIM, MAT.MATTE);

  /* THE PROPELLER, as a static cross. It is drawn rather than spun because the disc of a turning
   * prop is a blur you cannot see through at any frame rate this game runs at, and a stepping
   * three-blade prop under a 60 Hz sample would strobe — the wagon-wheel effect — which looks worse
   * than not moving at all. */
  pbox(M, 0, 0, 2.95, 0.07, 1.5, 0.04, 0, INK, MAT.MATTE);
  pbox(M, 0, 0, 2.95, 1.5, 0.07, 0.04, 0, INK, MAT.MATTE);

  // fixed undercarriage: two mains and a nose wheel, so it looks like it can land
  for (const s of [-1, 1]) {
    pcyl(M, [s * 0.5, -0.4, 0.2], [s * 0.95, -0.9, 0.2], 0.06, 0.06, 5, INK, MAT.MATTE, false, false);
    pcyl(M, [s * 0.95 - 0.08, -0.95, 0.2], [s * 0.95 + 0.08, -0.95, 0.2], 0.26, 0.26, 8, TYRE, MAT.MATTE, true, true);
  }
  pcyl(M, [0, -0.4, 2.0], [0, -0.85, 2.1], 0.05, 0.05, 5, INK, MAT.MATTE, false, false);
  pcyl(M, [-0.07, -0.9, 2.1], [0.07, -0.9, 2.1], 0.2, 0.2, 8, TYRE, MAT.MATTE, true, true);

  const mesh = new Mesh(finishPainted(M), material);
  mesh.name = 'playerPlane';
  mesh.visible = false;
  return mesh;
}
