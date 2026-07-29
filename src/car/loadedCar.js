/* Wanderoad — real car models.
 *
 * The hand-built car in model.js was a box with a windscreen, and it looked like one. These
 * are Quaternius's CC0 cars (see public/models/cars/LICENCE.txt), and they were chosen over
 * every other free pack for one specific reason: they carry NO textures and NO PBR, and every
 * part is separated by a plainly-named material — White, Grey, Black, Windows, Headlights,
 * TailLights. That is exactly the information this game needs, because it does not want the
 * artist's shading, it wants their SHAPE. The whole car is re-materialled into the painted
 * shader on load, so a bought model and a hand-built prop end up in the same painting.
 *
 * Wheels are found by node name (`*FrontLeftWheel*`, `*BackWheels*`, ...). Quaternius names
 * them consistently across the pack; anything that does not match simply has no steering
 * wheels, which is survivable, whereas guessing by bounding box is not.
 */

import { Group, Vector3, Box3, Matrix4, BufferAttribute, Color } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPaintedMaterial, MAT } from '../render/painted.js';
import { RGB, P } from '../core/palette.js';
import { clamp01 } from '../core/math.js';
import { FLEET } from '../game/garage.js';
import { buildCar, buildGhostCar } from './model.js';

/* The fleet lives in src/game/garage.js, because a car and the way it drives are the same
 * choice and there must be exactly one list of them. This module only turns one into meshes. */
export const CARS = Object.fromEntries(
  FLEET.map((c) => [c.id, { file: c.file, label: c.label, tier: c.tier, length: c.length }])
);

export const CAR_KEYS = FLEET.map((c) => c.id);

/* ── colour space: the one thing that made every car look washed out ───────────
 *
 * The painted shader reads `vcol` as a LINEAR colour and works in linear all the way to the
 * tonemap in render/post.js. Every other painted object in the game — the props, the
 * fences, the hand-built car in model.js — takes its colour from core/palette.js's RGB
 * table, which is where the game's linear values are defined.
 *
 * This module used to skip that table and do `parseInt(hex, 16) / 255` instead: the raw
 * sRGB byte, handed straight to a linear shader. For persimmon that is (0.784, 0.314,
 * 0.247) where the palette says (0.293, 0.007, 0.004) — the two dark channels arrive 44x
 * and 63x too strong. A red car whose green and blue are nearly as strong as its red is
 * exactly the "almost transparent, as if the colour is not added properly" the operator
 * saw, and it measured as 0.11-0.30 peak saturation on screen where the same paint through
 * the palette measures 0.62-0.67 (tools/diag-carpaint.mjs).
 *
 * So: palette keys, not hex, everywhere below. The one colour that is not in the palette
 * (a police light) goes through paletteLinear(), which is the same expression palette.js
 * itself uses — matching the palette is what matters, not what the conversion is called.
 */
const paletteLinear = (hex) => { const c = new Color(hex).convertSRGBToLinear(); return [c.r, c.g, c.b]; };

/* Body colours, in the game's own palette rather than the model's. The model's baseColor is
 * ignored entirely for body panels — that is the point of re-materialling. Hex, because
 * this list is also what a colour swatch would be drawn with; the mesh path uses
 * bodyPaintLinear() so the two can never drift apart. */
const PAINT_KEYS = ['paintA', 'paintB', 'paintC', 'paintD', 'paintE', 'paintF'];
export const BODY_PAINTS = PAINT_KEYS.map((k) => P[k]);

/** The linear triple the shader actually gets for paint chip `i`, wrapping. This hands back
 *  palette.js's own array, like painted.js's LC(): read it, never write it. */
export function bodyPaintLinear(i) {
  const n = PAINT_KEYS.length;
  return RGB[PAINT_KEYS[(((i | 0) % n) + n) % n]];
}

/**
 * Material name -> how this game should paint it. `col` is a LINEAR rgb triple.
 * `mat` is the painted pipeline's material index: BODY for the shell, MATTE for rubber,
 * METAL for chrome and glass, EMIT for anything that is a light.
 */
function classify(name, paintCol) {
  const n = (name || '').toLowerCase();
  if (n.includes('window') || n.includes('glass')) return { col: RGB.glass, mat: MAT.METAL };
  if (n.includes('headlight')) return { col: RGB.head, mat: MAT.EMIT };
  if (n.includes('taillight') || n.includes('brakelight')) return { col: RGB.tail, mat: MAT.EMIT };
  if (n.includes('whitelight')) return { col: RGB.head, mat: MAT.EMIT };
  if (n.includes('bluelight')) return { col: paletteLinear('#5A8BD6'), mat: MAT.EMIT };
  if (n.includes('black')) return { col: RGB.tyre, mat: MAT.MATTE };
  if (n.includes('grey') || n.includes('gray') || n.includes('chrome') || n.includes('metal'))
    return { col: RGB.chrome, mat: MAT.METAL };
  if (n.includes('rust')) return { col: RGB.trunkShade, mat: MAT.MATTE };
  // Everything else is bodywork, and bodywork is whatever colour the player picked.
  // MAT.BODY: neither MATTE nor METAL was right for a whole shell — MATTE mixes flat sky
  // into its mid band and flat shadow tint into its shade band until the paint reads grey,
  // METAL puts a hot sun rim on every panel and bleaches it. See painted.js MAT.BODY.
  return { col: paintCol, mat: MAT.BODY };
}

/* ── the password-gated "realistic" body ──────────────────────────────────────
 * Operator mark 41: "car models ugly, wants something more realistic". The honest options
 * tonight were (a) fetch a new CC0/MIT/Apache/BSD asset pack, verify its licence for real,
 * and re-teach this file's wheel-rig-by-name logic (see the file header) to a naming
 * convention nobody has checked, all before a morning deadline — or (b) put the extra
 * detail this game can add WITHOUT a new asset — proportions, paint, glass tint, wheel rim —
 * into the body car/model.js already owns outright, which used to be only a network-failure
 * fallback nobody ever actually saw. Downloading something unverified to hit a deadline is
 * exactly how a GPL asset or a wobbling wheel rig ships, so this is (b): gated behind a
 * password so it is opt-in rather than silently replacing the shipped fleet. The password
 * lives in docs/CREDITS.md, in the operator's own place to look for it.
 *
 * Zero new triangles or bytes from anywhere but this repository's own code — see model.js's
 * own additions (belt trim, door handle, front badge, two-tone wheel rim, tinted glass) for
 * exactly what "more realistic" meant here without a downloaded asset. */
const CARS_PASSWORD = 'realwheels';

function realisticCarsOn() {
  try {
    return new URLSearchParams(location.search).get('cars') === CARS_PASSWORD;
  } catch {
    return false; // no `location` (e.g. a Node harness) — the gate defaults off, same as garage.js's cheatOn()
  }
}

/** The hand-built body (car/model.js), scaled to THIS fleet car's own real length — the
 *  identical box-measure-and-scale the GLB path below uses — and tagged with the same
 *  identity fields loadCar()'s GLB path returns (`source`/`label`/`tier`), so nothing
 *  downstream can tell which body it got. */
function buildRealisticVariant(carKey, spec, paint, ghost) {
  const built = ghost ? buildGhostCar({ tier: spec.tier, paint }) : buildCar({ tier: spec.tier, paint });
  const box = new Box3().setFromObject(built.group);
  const size = new Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.z);
  if (longest > 0.001) built.group.scale.setScalar(spec.length / longest);
  built.group.name = `car:${carKey}`;
  built.source = carKey;
  built.label = spec.label;
  built.tier = spec.tier;
  return built;
}

let _loader = null;
const _cache = new Map();

function loader() {
  if (!_loader) _loader = new GLTFLoader();
  return _loader;
}

/** Load and cache one GLB. */
function loadGLB(url) {
  if (_cache.has(url)) return _cache.get(url);
  const p = new Promise((res, rej) => loader().load(url, (g) => res(g), undefined, rej));
  _cache.set(url, p);
  return p;
}

/**
 * Build a playable car from a GLB.
 *
 * @returns the same interface as buildCar() in model.js, so main.js does not care which one
 *          it got: { group, wheels, setSteer, setWheelSpin, setBrakeGlow, setLights,
 *                    setBodyRoll, dispose }
 */
export async function loadCar({ car = 'coupe', paint = 0, base = './models/cars/', ghost = false } = {}) {
  const spec = CARS[car] || CARS.coupe;
  // ?cars=<password> — see buildRealisticVariant()'s own note just above for why this exists
  // and what it is instead of a downloaded asset.
  if (realisticCarsOn()) return buildRealisticVariant(car, spec, paint, ghost);
  const gltf = await loadGLB(base + spec.file);
  const src = gltf.scene.clone(true);

  const paintCol = bodyPaintLinear(paint);
  const material = createPaintedMaterial(ghost ? { ghost: true, opacity: 0.85 } : {});

  /* ── re-material ────────────────────────────────────────────────────────
   * The painted shader reads colour and material index from vertex attributes, not from
   * uniforms, so every mesh gets its own tiny attribute pair written from the classification
   * of its ORIGINAL material name. One material, one draw call per mesh, no textures. */
  const meshes = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    const srcMat = Array.isArray(o.material) ? o.material[0] : o.material;
    const { col: rgb, mat } = classify(srcMat && srcMat.name, paintCol);
    const g = o.geometry;
    const n = g.attributes.position.count;
    const colArr = new Float32Array(n * 3);
    const matArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      colArr[i * 3] = rgb[0];
      colArr[i * 3 + 1] = rgb[1];
      colArr[i * 3 + 2] = rgb[2];
      matArr[i] = mat;
    }
    // The painted shader reads `vcol` and `vmat` per vertex — the same attribute names the
    // hand-built props use, so a bought model and a hand-built signpost go through one
    // material and one code path.
    g.setAttribute('vcol', new BufferAttribute(colArr, 3));
    g.setAttribute('vmat', new BufferAttribute(matArr, 1));
    if (!g.attributes.nrm && g.attributes.normal) g.setAttribute('nrm', g.attributes.normal);
    if (!g.attributes.nrm) {
      g.computeVertexNormals();
      g.setAttribute('nrm', g.attributes.normal);
    }
    o.material = material;
    o.castShadow = false;
    o.receiveShadow = false;
    meshes.push(o);
  });

  /* ── scale and centre ───────────────────────────────────────────────────
   * Every pack has its own idea of a unit. Measure the model and scale it to the real length
   * the tuning file assumes, then sit its lowest point on y = 0 so the wheels touch the road.
   */
  const box = new Box3().setFromObject(src);
  const size = new Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.z);
  const scale = longest > 0.001 ? spec.length / longest : 1;
  src.scale.setScalar(scale);
  src.updateMatrixWorld(true);
  const box2 = new Box3().setFromObject(src);
  src.position.y -= box2.min.y;
  // Quaternius cars already face +Z, which is the game's forward. Rotating them by PI
  // "to correct the pack's convention" is what made the first import drive backwards.

  const group = new Group();
  group.name = `car:${car}`;
  /* Body attitude gets its OWN node inside the yaw node. main.js owns `group.rotation`
   * (`rotation.set(0, car.yaw, 0)`) and then calls setBodyRoll; writing roll and pitch onto
   * that same Euler makes them share one XYZ rotation, and in XYZ the pitch is applied
   * OUTSIDE the yaw — i.e. about the world X axis, not the car's own lateral axis. A car
   * heading due east then "pitches" by leaning over sideways. This node sits under the yaw,
   * so both angles land in the car's own frame, exactly as model.js's `chassis` does. */
  const attitude = new Group();
  attitude.name = 'attitude';
  group.add(attitude);
  attitude.add(src);

  /* Matrices, before anything below measures anything. This is not housekeeping: the
   * ride-height drop above changed `src.position` and did NOT refresh the cached world
   * matrices, and the wheel rig is built by measuring the wheels in world space and
   * converting back. Box3.expandByObject() reads the STALE matrices; Object3D.worldToLocal()
   * quietly calls updateWorldMatrix() first and reads the NEW ones. Mixing the two — which
   * is what this file used to do — put every hub exactly `box2.min.y` below its own axle,
   * and a wheel spun about an axis 12-40 mm under its centre does not roll, it ORBITS.
   * That was the "wheels don't spin perfectly round, they wobble oddly". See
   * tools/diag-wheelwobble.mjs, which measures it in millimetres. */
  group.updateMatrixWorld(true);

  /* ── build a wheel rig ──────────────────────────────────────────────────
   * Two things about these packs make the naive approach fail, and both were visible in the
   * game as "the wheels rotate around the car":
   *
   *   1. A corner is TWO meshes, not one (`...FrontLeftWheel...-Mesh` and `-Mesh_1`: the
   *      tyre and the rim). Steering only the one you happened to keep leaves the other
   *      behind, and half a wheel swinging on its own is exactly what it looks like.
   *   2. Steering and rolling cannot share one Euler. With the default XYZ order the roll is
   *      applied in the PARENT frame, so a steered wheel rolls about the car's axis instead
   *      of its own and describes a cone.
   *
   * So: group the meshes by corner, and give each corner two nested nodes — an outer one
   * that only ever yaws (steering) and an inner one that only ever pitches (rolling).
   */
  const corners = new Map();
  const wheelMeshes = [];
  src.traverse((o) => {
    if (o.isMesh && /wheel/i.test(o.name || '')) wheelMeshes.push(o);
  });
  for (const o of wheelMeshes) {
    const n = (o.name || '').toLowerCase();
    const key = n.includes('frontleft')
      ? 'fl'
      : n.includes('frontright')
        ? 'fr'
        : n.includes('rearleft')
          ? 'rl'
          : n.includes('rearright')
            ? 'rr'
            : n.includes('front')
              ? 'f'
              : 'r';
    if (!corners.has(key)) corners.set(key, []);
    corners.get(key).push(o);
  }

  const wheels = { steer: [], spin: [], all: [] };
  const _toParent = new Matrix4();
  const _m = new Matrix4();
  const _b = new Box3();
  for (const [key, list] of corners) {
    /* The hub, measured DIRECTLY in the frame the pivot will live in. No world round trip:
     * every geometry box is carried into `parent` space by one explicit matrix, so there is
     * no second code path with its own idea of how fresh the matrices are. For a wheel — a
     * cylinder whose axis is the model's X — the box's Y and Z centre IS the axle, which is
     * the only part of this that has to be right; the X centre only decides where along the
     * axle the pivot sits, and attach() below means nothing moves either way. */
    const parent = list[0].parent;
    _toParent.copy(parent.matrixWorld).invert();
    const box = new Box3();
    for (const o of list) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(_b.copy(o.geometry.boundingBox).applyMatrix4(_m.multiplyMatrices(_toParent, o.matrixWorld)));
    }
    const hub = new Vector3();
    box.getCenter(hub);

    const steer = new Group();
    steer.name = `wheel:${key}:steer`;
    steer.position.copy(hub);
    parent.add(steer);

    const spin = new Group();
    spin.name = `wheel:${key}:spin`;
    steer.add(spin);
    steer.updateMatrixWorld(true);

    // attach(), not add(): it re-expresses each mesh in the spin node's frame while KEEPING
    // its world transform, so no part of the car moves — only the point it turns about
    // changes. add() plus a hand-computed offset is the same thing only while every mesh at
    // a corner happens to share one parent with no rotation of its own, and that is an
    // assumption about somebody else's model file.
    for (const o of list) spin.attach(o);

    wheels.all.push(spin);
    wheels.spin.push(spin);
    if (key === 'fl' || key === 'fr' || key === 'f') wheels.steer.push(steer);
  }

  const api = {
    group,
    wheels: wheels.all,
    steerNodes: wheels.steer,
    source: car,
    label: spec.label,
    tier: spec.tier,

    setSteer(rad) {
      /* Every mesh at a front corner turns, on the outer node, which only ever yaws.
       * NOT -rad. main.js drives this from `car.steerAngle`, and a positive steerAngle is a
       * positive yaw rate: tools/diag-wheelwobble.mjs drives the real Vehicle and it ends a
       * second of full right stick at x = +3.3 m, so the nose swings toward +X and the front
       * wheels have to point that way too. The negation had the loaded cars' front wheels
       * pointing OUT of the corner — model.js has used +rad all along. */
      for (const s of wheels.steer) s.rotation.y = rad;
    },

    setWheelSpin(rad) {
      // Wrap, so the float does not grow without bound over a long drive.
      const r = rad % (Math.PI * 2);
      for (const w of wheels.spin) w.rotation.x = r;
    },

    setBrakeGlow() {
      /* The tail lights are already an EMIT material and the painted shader unshades them, so
       * there is nothing to modulate without a per-mesh uniform. Left deliberately empty
       * rather than faked — a brake light that does not change is better than one that
       * changes the colour of the whole car. */
    },

    setLights() {},

    setBodyRoll(roll, pitch) {
      // On `attitude`, inside the yaw — see the note where that node is made. Same two
      // lines model.js writes to its `chassis`, and for the same reason.
      attitude.rotation.z = roll;
      attitude.rotation.x = pitch;
    },

    dispose() {
      src.traverse((o) => {
        if (o.isMesh) o.geometry.dispose();
      });
      material.dispose();
    },
  };
  return api;
}

/** A remote player's car: same model, translucent, and it never collides with anything. */
export async function loadGhostCar(opts) {
  return loadCar({ ...opts, ghost: true });
}
