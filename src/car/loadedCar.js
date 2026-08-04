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

/* ── B46: the Synty bodies would not take a colour at all ─────────────────────
 *
 * Operator: "The Ford F-150 looks like a baby's truck, the way it's painted. It's light blue …
 * very girly, would find more mature colors for it. Also there's some gray parts still, leaving
 * it somewhat uncoloured."
 *
 * BOTH HALVES OF THAT ARE ONE BUG, and it is not where the previous pass looked. The note left on
 * B46 said the colour comes from tools/make-truck.mjs; it does not. make-truck.mjs writes
 * `pickup.glb` and nothing ships it — garage.js asks for `synty-pickup.glb`, a Synty body whose
 * atlas is baked into COLOR_0 by tools/synty-car.mjs. loadCar()'s baked branch below then uses
 * those baked colours for the whole shell, so the pickup is the one car in the fleet that ignores
 * the paint the player picked. It is stuck in Synty's factory two-tone for ever:
 *
 *   #4566A9 on screen, 1378 verts — the blue. That is the "baby blue".
 *   #ABB2AC on screen, 3986 verts — a pale grey-green second tone over the roof, the pillars and
 *                                   the whole lower third. That is the "grey parts still".
 *
 * So the fix is not a nicer hex: it is to let a Synty body be painted like every other car, while
 * KEEPING the baked detail that is the only reason to use one of these models (panel lines, grille,
 * bed liner, tail lights, the tan interior — 22 further clusters). The rule below is computed from
 * COLOR_0 itself rather than from a typed list of hexes, so it survives a re-bake of the asset and
 * works on any Synty car, and it is deliberately narrow at both ends: it can only ever touch
 * saturated paint of the body's OWN hue, and near-neutral mid-tone cladding. Tail-light red and
 * indicator orange are 200-plus degrees of hue away; chrome sits above the cladding's luminance
 * ceiling; the tans sit above its saturation ceiling. Glass, tyres and the interior are separate
 * meshes classified by material NAME and never reach this code at all.
 *
 * The one judgement in it is the belt line. The pale cladding is not one part — its bounding box is
 * the whole vehicle — so it has to be split by height: above the belt it is bodywork (roof and
 * pillars, and the roof is the largest surface a chase camera ever sees), below it is bumpers,
 * rockers, arches and the bed rail, which on a real pickup are trim and stay trim. */

/** Rec.709 luminance of a LINEAR triple — the same weighting render/post.js grades against. */
const lum709 = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Hue in degrees of a LINEAR triple, and `NaN` for a neutral (which no rule below accepts). */
function hue(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d <= 1e-6) return NaN;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Shortest distance between two hue angles, in degrees. */
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** Saturation as the painted shader effectively sees it: how far off neutral, relative to the peak. */
const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b);
  return mx <= 1e-6 ? 0 : (mx - Math.min(r, g, b)) / mx;
};

/** A cluster is "paint" only this saturated, and "cladding" only this neutral. */
const PAINT_SAT = 0.6;
const CLAD_SAT = 0.15;
/** Cladding's luminance window. Below it is black trim; above it is chrome. Both keep their colour. */
const CLAD_LUM = [0.3, 0.55];
/** Same-hue tolerance, in degrees, for a paint family. The nearest light is 200-plus degrees away. */
const PAINT_HUE = 40;
/** Fraction of the body's height above which pale cladding is bodywork rather than bumper. */
const BELT = 0.78;
/** No remapped vertex may leave its family's anchor by more than this, so nothing blows out to white. */
const SHADE_CLAMP = [0.25, 1.35];

/**
 * Re-colour a Synty body's BAKED vertex colours so the shell takes the player's paint and its
 * cladding becomes deliberate trim, leaving every other baked cluster exactly as the artist left it.
 *
 * @param {import('three').BufferGeometry} g   a mesh already classified as MAT.BODY, with COLOR_0
 * @param {number[]} paintCol                  the player's paint, LINEAR
 * @param {number[]} trimCol                   what cladding below the belt becomes, LINEAR
 * @returns {Float32Array|null} a replacement colour array, or null if this body is not a Synty
 *                              two-tone at all (in which case the baked colours are used untouched)
 */
export function remapBakedBody(g, paintCol, trimCol) {
  const col = g.attributes.color;
  const pos = g.attributes.position;
  if (!col || !pos || col.count !== pos.count) return null;
  const n = col.count;

  /* One pass to cluster. Quantising to 8 bits is what the atlas bake already did, so this recovers
   * the artist's own flat regions exactly rather than approximating them. */
  const clusters = new Map();
  const keyOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = col.getX(i);
    const gg = col.getY(i);
    const b = col.getZ(i);
    const k = ((Math.round(r * 255) << 16) | (Math.round(gg * 255) << 8) | Math.round(b * 255)) >>> 0;
    keyOf[i] = k;
    let c = clusters.get(k);
    if (!c) clusters.set(k, (c = { n: 0, r, g: gg, b, sat: satOf(r, gg, b), lum: lum709(r, gg, b), h: hue(r, gg, b) }));
    c.n++;
  }

  /* The paint anchor is the biggest genuinely saturated cluster — on the pickup and the convertible
   * alike that is Synty's factory blue. If a body has no saturated cluster at all it is not a Synty
   * two-tone and nothing is touched: a fail-safe, not a guess. */
  let anchor = null;
  for (const c of clusters.values()) if (c.sat >= PAINT_SAT && (!anchor || c.n > anchor.n)) anchor = c;
  if (!anchor) return null;

  /* The cladding anchor is the biggest near-neutral mid-tone. It is what maps to the paint at FULL
   * strength — it is the largest surface on the car — so every other cladding cluster is shaded
   * relative to it and the artist's own light-to-dark ordering survives. */
  let clad = null;
  for (const c of clusters.values()) {
    if (c.sat < CLAD_SAT && c.lum >= CLAD_LUM[0] && c.lum <= CLAD_LUM[1] && (!clad || c.n > clad.n)) clad = c;
  }

  g.computeBoundingBox();
  const yBelt = g.boundingBox.min.y + BELT * (g.boundingBox.max.y - g.boundingBox.min.y);

  /* Per CLUSTER, not per vertex: what each one becomes, and how bright. */
  const plan = new Map();
  const shade = (l, ref) => Math.min(SHADE_CLAMP[1], Math.max(SHADE_CLAMP[0], ref > 1e-6 ? l / ref : 1));
  for (const [k, c] of clusters) {
    if (c.sat >= PAINT_SAT && !Number.isNaN(c.h) && hueGap(c.h, anchor.h) <= PAINT_HUE) {
      plan.set(k, { to: paintCol, mul: shade(c.lum, anchor.lum), split: false });
    } else if (clad && c.sat < CLAD_SAT && c.lum >= CLAD_LUM[0] && c.lum <= CLAD_LUM[1]) {
      plan.set(k, { to: paintCol, alt: trimCol, mul: shade(c.lum, clad.lum), split: true });
    }
  }
  if (!plan.size) return null;

  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = plan.get(keyOf[i]);
    if (!p) {
      out[i * 3] = col.getX(i);
      out[i * 3 + 1] = col.getY(i);
      out[i * 3 + 2] = col.getZ(i);
      continue;
    }
    const src = p.split && pos.getY(i) < yBelt ? p.alt : p.to;
    out[i * 3] = src[0] * p.mul;
    out[i * 3 + 1] = src[1] * p.mul;
    out[i * 3 + 2] = src[2] * p.mul;
  }
  return out;
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
    /* THE MODEL'S OWN COLOURS, WHERE IT HAS THEM. Operator: "also no textures on the cars."
     *
     * A Quaternius car separates its parts by MATERIAL, so classifying the material name is the
     * whole story and every body panel takes the player's paint. A Synty car does not: it is one
     * body mesh whose lights, grille, bumpers, interior and panel lines all live in a palette
     * ATLAS, so painting it by material name gives one flat lump with no detail at all.
     *
     * tools/synty-car.mjs bakes that atlas into a COLOR_0 attribute at conversion time — one sample
     * per vertex, which is near-lossless for a palette texture and needs no sampler here. So: if a
     * BODY mesh arrived with its own vertex colours, use them; otherwise paint it. Glass, wheels and
     * lights still classify by name either way, because those must obey the game, not the artist. */
    /* B46 — and the baked colours are now REPAINTED before they are copied. See remapBakedBody()'s
     * own note above for why: used raw, a Synty shell can never take the paint the player picked,
     * which is what made the pickup a permanently baby-blue truck with grey unpainted cladding.
     * The remap keeps every baked cluster that is neither this body's paint nor its cladding, so
     * the detail that justifies a Synty model in the first place is untouched. A body that is not
     * a Synty two-tone comes back null and falls through to the baked colours exactly as before. */
    const bakedAttr = mat === MAT.BODY ? g.attributes.color : null;
    const repainted = bakedAttr ? remapBakedBody(g, paintCol, RGB.carTrim) : null;
    const baked = bakedAttr;
    for (let i = 0; i < n; i++) {
      if (repainted) {
        colArr[i * 3] = repainted[i * 3];
        colArr[i * 3 + 1] = repainted[i * 3 + 1];
        colArr[i * 3 + 2] = repainted[i * 3 + 2];
      } else if (baked) {
        colArr[i * 3] = baked.getX(i);
        colArr[i * 3 + 1] = baked.getY(i);
        colArr[i * 3 + 2] = baked.getZ(i);
      } else {
        colArr[i * 3] = rgb[0];
        colArr[i * 3 + 1] = rgb[1];
        colArr[i * 3 + 2] = rgb[2];
      }
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
