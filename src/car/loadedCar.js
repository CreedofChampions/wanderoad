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

import { Group, Vector3, Box3, BufferAttribute } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createPaintedMaterial, MAT } from '../render/painted.js';
import { RGB, P } from '../core/palette.js';
import { clamp01 } from '../core/math.js';

/** The fleet. `wheelbase` is the real-world length we scale each model to. */
export const CARS = {
  coupe: { file: 'coupe.glb', label: 'Coupe', tier: 'sports', length: 4.3 },
  hatch: { file: 'hatch.glb', label: 'Hatch', tier: 'gt', length: 4.0 },
  sedan: { file: 'sedan.glb', label: 'Sedan', tier: 'gt', length: 4.5 },
  estate: { file: 'estate.glb', label: 'Estate', tier: 'gt', length: 4.6 },
  taxi: { file: 'taxi.glb', label: 'Taxi', tier: 'gt', length: 4.5 },
  rally: { file: 'rally.glb', label: 'Rally', tier: 'sports', length: 4.2 },
  patrol: { file: 'patrol.glb', label: 'Patrol', tier: 'sports', length: 4.6 },
};

export const CAR_KEYS = Object.keys(CARS);

/* Body colours, in the game's own palette rather than the model's. The model's baseColor is
 * ignored entirely for body panels — that is the point of re-materialling. */
export const BODY_PAINTS = [
  P.paintA, P.paintB, P.paintC, P.paintD, P.paintE, P.paintF,
];

/**
 * Material name -> how this game should paint it.
 * `mat` is the painted pipeline's material index: MATTE for panels and rubber, METAL for
 * chrome and glass, EMIT for anything that is a light.
 */
function classify(name, paintHex) {
  const n = (name || '').toLowerCase();
  if (n.includes('window') || n.includes('glass')) return { col: P.glass, mat: MAT.METAL };
  if (n.includes('headlight')) return { col: P.head, mat: MAT.EMIT };
  if (n.includes('taillight') || n.includes('brakelight')) return { col: P.tail, mat: MAT.EMIT };
  if (n.includes('whitelight')) return { col: P.head, mat: MAT.EMIT };
  if (n.includes('bluelight')) return { col: '#5A8BD6', mat: MAT.EMIT };
  if (n.includes('black')) return { col: P.tyre, mat: MAT.MATTE };
  if (n.includes('grey') || n.includes('gray') || n.includes('chrome') || n.includes('metal'))
    return { col: P.chrome, mat: MAT.METAL };
  if (n.includes('rust')) return { col: P.trunkShade, mat: MAT.MATTE };
  // Everything else is bodywork, and bodywork is whatever colour the player picked.
  // MATTE, not METAL: the painted pipeline's metal ramp has tight bands and a hot rim, which
  // on a whole car body blows the colour out to a pale wash. Metal is for the chrome.
  return { col: paintHex, mat: MAT.MATTE };
}

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};

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
  const gltf = await loadGLB(base + spec.file);
  const src = gltf.scene.clone(true);

  const paintHex = BODY_PAINTS[paint % BODY_PAINTS.length];
  const material = createPaintedMaterial(ghost ? { ghost: true, opacity: 0.85 } : {});

  /* ── re-material ────────────────────────────────────────────────────────
   * The painted shader reads colour and material index from vertex attributes, not from
   * uniforms, so every mesh gets its own tiny attribute pair written from the classification
   * of its ORIGINAL material name. One material, one draw call per mesh, no textures. */
  const meshes = [];
  src.traverse((o) => {
    if (!o.isMesh) return;
    const srcMat = Array.isArray(o.material) ? o.material[0] : o.material;
    const { col, mat } = classify(srcMat && srcMat.name, paintHex);
    const rgb = hexToRgb(col);
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
  group.add(src);

  /* ── find the wheels ────────────────────────────────────────────────── */
  const wheels = { fl: null, fr: null, rear: null, all: [] };
  src.traverse((o) => {
    const n = (o.name || '').toLowerCase();
    if (!n.includes('wheel')) return;
    wheels.all.push(o);
    if (n.includes('frontleft')) wheels.fl = o;
    else if (n.includes('frontright')) wheels.fr = o;
    else if (n.includes('back') || n.includes('rear')) wheels.rear = o;
  });
  for (const w of wheels.all) w.userData.baseY = w.rotation.y;

  const api = {
    group,
    wheels: wheels.all,
    source: car,
    label: spec.label,
    tier: spec.tier,

    setSteer(rad) {
      // Only the front wheels steer, and only if the pack named them. The sign is negated
      // for the same handedness reason as the input layer: +yaw is screen-left.
      if (wheels.fl) wheels.fl.rotation.y = wheels.fl.userData.baseY - rad;
      if (wheels.fr) wheels.fr.rotation.y = wheels.fr.userData.baseY - rad;
    },

    setWheelSpin(rad) {
      for (const w of wheels.all) w.rotation.x = rad;
    },

    setBrakeGlow() {
      /* The tail lights are already an EMIT material and the painted shader unshades them, so
       * there is nothing to modulate without a per-mesh uniform. Left deliberately empty
       * rather than faked — a brake light that does not change is better than one that
       * changes the colour of the whole car. */
    },

    setLights() {},

    setBodyRoll(roll, pitch) {
      group.rotation.z = roll;
      group.rotation.x = pitch;
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
