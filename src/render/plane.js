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
 *
 * THE PROPELLER USED TO BE A STATIC CROSS, on purpose: a stepping two-blade prop under a 60 Hz
 * sample strobes (the wagon-wheel effect), and the comment that lived on it argued that not moving
 * at all looked better than that. It did not — the operator's own words were "the propeller doesn't
 * move" — and the actual answer was in the same sentence: the strobe comes from a hard-edged blade
 * shape sampled at discrete angles, not from motion itself. buildPropDisc() below spins a genuinely
 * ROTATIONALLY SOFT shape instead (a disc whose two "blades" are a gentle cosine wash, not a sharp
 * edge), so there is nothing sharp enough left to alias against and it can turn at any rate a frame
 * lands on. buildPlane() now returns a Group rather than a single Mesh so that disc can spin on its
 * own local Z each frame independently of the airframe around it — see main.js's frame loop, which
 * reads it back via `group.userData.prop`.
 */
import { Group, Mesh } from 'three';
import { PB, pv, pt3, pbox, pcyl, finishPainted, createPaintedMaterial, MAT, LC, mixc } from './painted.js';
import { TAU } from '../core/math.js';

const BODY = LC('paintD');
const TRIM = LC('paintA');
const GLASS = LC('glass');
const TYRE = LC('tyre');
const INK = LC('paintF');

/** Metres, nose to tail. A Cessna-ish light aircraft, and the number the flight model assumes. */
export const PLANE_LENGTH = 7.6;

/** Metres from the hub the blur reaches — the same 1.5 m radius the old cross's blades swept. */
const PROP_RADIUS = 1.5;
/** Sides on the disc's own rim. Enough that the OUTLINE is a circle rather than a visible polygon;
 *  irrelevant to the strobing question, which is about the shading inside the disc, not its edge. */
const PROP_SEG = 32;

/**
 * The propeller, as a disc rather than a cross — see this file's own header for why.
 *
 * A single flat, evenly-coloured disc would be honestly blur-shaped but would also look exactly the
 * same whether it was "spinning" at idle or at full throttle or not spinning at all — a blur with no
 * internal shape reads as a solid painted coin, not as motion. So the disc carries two soft lobes,
 * `0.5 + 0.5*cos(angle*2)`, which is a smooth wash the whole way round rather than a hard split: dark
 * enough at its darkest to read as the two real blades still faintly visible through their own blur —
 * which is genuinely how a photographed propeller looks — and soft enough everywhere else that there
 * is no sharp edge for a 60 Hz sample to alias against. Built as its own tiny painted mesh, sharing
 * the plane's material, so it lights and fogs exactly like the rest of the airframe.
 *
 * @param {THREE.Material} material the same material buildPlane() was given, so the two match
 */
function buildPropDisc(material) {
  const M = PB();
  const light = mixc(INK, TRIM, 0.6);
  const hub = pv(M, 0, 0, 0, 0, 0, 1, INK, MAT.MATTE);
  let prev = null;
  for (let i = 0; i <= PROP_SEG; i++) {
    const a = (i / PROP_SEG) * TAU;
    const shade = 0.5 + 0.5 * Math.cos(a * 2); // two soft lobes per revolution, no hard edge
    const col = mixc(INK, light, shade);
    const rim = pv(M, Math.cos(a) * PROP_RADIUS, Math.sin(a) * PROP_RADIUS, 0, 0, 0, 1, col, MAT.MATTE);
    if (prev !== null) pt3(M, hub, prev, rim);
    prev = rim;
  }
  const mesh = new Mesh(finishPainted(M), material);
  mesh.name = 'prop';
  return mesh;
}

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

  /* THE PROPELLER used to be drawn here, as a static cross — see buildPropDisc() below for why
   * it moved out to its own small mesh, and render/plane.js's own header for the reasoning that
   * survived the change (the strobe, not the stillness, was always the real constraint). */

  // fixed undercarriage: two mains and a nose wheel, so it looks like it can land
  for (const s of [-1, 1]) {
    pcyl(M, [s * 0.5, -0.4, 0.2], [s * 0.95, -0.9, 0.2], 0.06, 0.06, 5, INK, MAT.MATTE, false, false);
    pcyl(M, [s * 0.95 - 0.08, -0.95, 0.2], [s * 0.95 + 0.08, -0.95, 0.2], 0.26, 0.26, 8, TYRE, MAT.MATTE, true, true);
  }
  pcyl(M, [0, -0.4, 2.0], [0, -0.85, 2.1], 0.05, 0.05, 5, INK, MAT.MATTE, false, false);
  pcyl(M, [-0.07, -0.9, 2.1], [0.07, -0.9, 2.1], 0.2, 0.2, 8, TYRE, MAT.MATTE, true, true);

  const body = new Mesh(finishPainted(M), material);
  body.name = 'planeBody';

  /* THE PROPELLER, ACTUALLY TURNING. Its own small mesh (see buildPropDisc()), positioned at
   * exactly the spot the old static cross occupied, and parented under a Group rather than baked
   * into `body`'s own geometry — a painted mesh's vertices are fixed at build time, so the only way
   * to spin one PART of the aeroplane independently of the rest is to give it its own transform.
   * `userData.prop` is main.js's handle onto it: cheaper than searching the scene graph by name
   * every frame, and the same idiom three.js itself recommends for app-specific object data. */
  const prop = buildPropDisc(material);
  prop.position.set(0, 0, 2.95); // the old cross's own spot, at the nose

  const group = new Group();
  group.name = 'playerPlane';
  group.visible = false;
  group.add(body);
  group.add(prop);
  group.userData.prop = prop;
  return group;
}
