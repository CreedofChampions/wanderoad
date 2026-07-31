/* BUILD A FULL-SIZE PICKUP, AS A GLB, FROM THIS REPOSITORY'S OWN GEOMETRY.
 *
 * Operator: "Add ford f150 to game".
 *
 * WHY THIS IS AUTHORED RATHER THAN DOWNLOADED. The seven cars in public/models/cars/ are
 * Quaternius CC0, and the licence rule here is CC0 / MIT / Apache / BSD / public domain only. Every
 * CC0 pickup on Poly Pizza was checked (Pickup Truck, Armored, Heart, Thunder, Crate, and five more
 * from the search): all but one are single-material TEXTURE-ATLAS models, and this game's loader
 * paints a car by reading SEPARATED material names — White, Grey, Black, Windows, Headlights,
 * TailLights (see car/loadedCar.js's classify()). An atlas model arrives as one lump: windows the
 * colour of the paint, no lights, no chrome. Their wheel nodes are named FrontWheel_L/R too, which
 * the rig's frontleft/frontright matcher does not see, so it would also have no steering.
 * The one untextured candidate carried two materials and is a cartoon novelty truck.
 * The rest were CC-BY, which is off the list.
 *
 * So: build it here, from boxes and cylinders, with the material and node names the loader actually
 * wants. Nothing is downloaded, the licence is this repository's own, and it is the only option that
 * gives a pickup that paints, lights up and steers like the rest of the fleet.
 *
 * TRADEMARK, once and plainly: "Ford" and "F-150" are Ford's trademarks. This is a generic full-size
 * pickup at F-150 proportions, and the fleet label is set in game/garage.js — rename it there if that
 * ever matters commercially. Nothing about the geometry depends on the name.
 *
 * THE CONTRACT (car/loadedCar.js):
 *   - forward is +Z; the loader does NOT rotate, it trusts the model
 *   - it scales so max(x, z) equals the fleet entry's `length`, then sits min(y) on the road
 *   - a wheel is a mesh whose NAME contains "wheel" plus frontleft/frontright/rearleft/rearright
 *   - a wheel's cylinder axis is the model's X
 *   - material name decides the paint: window/glass, headlight, taillight, black, grey, else body
 *
 *   node tools/make-truck.mjs [out.glb]
 */
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'public/models/cars/pickup.glb';

/* ── proportions, in metres, of a crew-cab full-size pickup ──────────────────
 * Real F-150 SuperCrew: 5.91 m long, 2.03 m wide, 1.99 m tall, 3.68 m wheelbase. Kept honest
 * because the SHAPE is the whole point — a pickup that is not visibly longer and taller than the
 * Estate beside it on the forecourt has not been added, it has been renamed. */
const L = 5.91;
const W = 2.03;
const HW = W / 2;
const WHEEL_R = 0.46;
const WHEEL_W = 0.34;
const AXLE_F = 1.72;
const AXLE_R = -1.96;
const FLOOR = 0.62; // underside of the body
const BELT = 1.32; // top of the doors / bed sides
const ROOF = 2.02;

const meshes = [];

/** An axis-aligned box, by centre and half-extents. 24 vertices so each face gets a flat normal. */
function box(name, material, cx, cy, cz, hx, hy, hz) {
  const P = [];
  const N = [];
  const I = [];
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  for (const [n, quad] of faces) {
    const base = P.length / 3;
    for (const [sx, sy, sz] of quad) {
      P.push(cx + sx * hx, cy + sy * hy, cz + sz * hz);
      N.push(...n);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  meshes.push({ name, material, P, N, I });
}

/**
 * A cylinder whose axis runs along X — which is what the wheel rig assumes, and the reason a wheel
 * built about any other axis rolls in a cone rather than turning.
 */
function wheel(name, material, cx, cy, cz, r, halfW, seg = 16) {
  const P = [];
  const N = [];
  const I = [];
  // the tread band
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = [
      [cx - halfW, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r],
      [cx + halfW, cy + Math.sin(a0) * r, cz + Math.cos(a0) * r],
      [cx + halfW, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r],
      [cx - halfW, cy + Math.sin(a1) * r, cz + Math.cos(a1) * r],
    ];
    const base = P.length / 3;
    const nm = [0, Math.sin((a0 + a1) / 2), Math.cos((a0 + a1) / 2)];
    for (const v of p) {
      P.push(...v);
      N.push(...nm);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // the two flat sides, as fans
  for (const side of [-1, 1]) {
    const base = P.length / 3;
    P.push(cx + side * halfW, cy, cz);
    N.push(side, 0, 0);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      P.push(cx + side * halfW, cy + Math.sin(a) * r, cz + Math.cos(a) * r);
      N.push(side, 0, 0);
    }
    for (let i = 0; i < seg; i++) {
      if (side > 0) I.push(base, base + 1 + i, base + 2 + i);
      else I.push(base, base + 2 + i, base + 1 + i);
    }
  }
  meshes.push({ name, material, P, N, I });
}

/* ── the truck ───────────────────────────────────────────────────────────────
 * Three volumes, which is what makes a pickup read as a pickup from any angle: a tall blunt nose, a
 * crew cab set back, and an open bed behind it. The bed is built as four walls and a floor rather
 * than a solid block precisely so it reads as OPEN — a filled-in bed is a station wagon. */

// chassis / lower body, running the whole length
box('Body_Lower', 'White', 0, (FLOOR + 0.86) / 2 + 0.14, 0, HW - 0.06, (0.86 - FLOOR) / 2 + 0.14, L / 2 - 0.18);

// the nose: bonnet and front wings, tall and square the way a full-size pickup's is
box('Body_Hood', 'White', 0, 1.06, 2.06, HW - 0.03, 0.22, 0.86);
box('Body_Nose', 'White', 0, 0.94, 2.88, HW - 0.05, 0.3, 0.06);

// crew cab: doors, then a roof, then pillars implied by the glass sitting inboard
box('Body_Cab', 'White', 0, (FLOOR + BELT) / 2 + 0.06, 0.42, HW - 0.03, (BELT - FLOOR) / 2, 1.16);
box('Body_Roof', 'White', 0, ROOF - 0.06, 0.36, HW - 0.11, 0.06, 1.0);
for (const s of [-1, 1]) box('Body_Pillar' + (s < 0 ? 'L' : 'R'), 'White', s * (HW - 0.08), (BELT + ROOF) / 2, 1.3, 0.05, (ROOF - BELT) / 2, 0.09);
for (const s of [-1, 1]) box('Body_PillarRear' + (s < 0 ? 'L' : 'R'), 'White', s * (HW - 0.08), (BELT + ROOF) / 2, -0.62, 0.05, (ROOF - BELT) / 2, 0.09);

// the bed: two sides, a tailgate, a bulkhead behind the cab, and a floor
for (const s of [-1, 1]) box('Body_BedSide' + (s < 0 ? 'L' : 'R'), 'White', s * (HW - 0.07), (0.86 + BELT) / 2, -1.86, 0.07, (BELT - 0.86) / 2, 1.06);
box('Body_Tailgate', 'White', 0, (0.86 + BELT) / 2, -2.88, HW - 0.05, (BELT - 0.86) / 2, 0.06);
box('Body_Bulkhead', 'White', 0, (0.86 + BELT) / 2, -0.82, HW - 0.05, (BELT - 0.86) / 2, 0.06);
box('Body_BedFloor', 'White', 0, 0.9, -1.86, HW - 0.09, 0.04, 1.0);

// glass. Inboard of the body so the pillars read as pillars.
box('Windscreen', 'Windows', 0, (BELT + ROOF) / 2 + 0.02, 1.42, HW - 0.13, (ROOF - BELT) / 2 - 0.05, 0.05);
for (const s of [-1, 1]) box('SideGlass' + (s < 0 ? 'L' : 'R'), 'Windows', s * (HW - 0.05), (BELT + ROOF) / 2 + 0.02, 0.4, 0.03, (ROOF - BELT) / 2 - 0.06, 0.62);
box('RearGlass', 'Windows', 0, (BELT + ROOF) / 2 + 0.02, -0.72, HW - 0.13, (ROOF - BELT) / 2 - 0.06, 0.05);

// chrome: the grille bar, both bumpers, a step under each door
box('Grille_Grey', 'Grey', 0, 1.0, 2.94, HW - 0.12, 0.2, 0.04);
box('Bumper_Front_Grey', 'Grey', 0, 0.72, 2.96, HW - 0.02, 0.14, 0.05);
box('Bumper_Rear_Grey', 'Grey', 0, 0.72, -2.96, HW - 0.02, 0.14, 0.05);
for (const s of [-1, 1]) box('Step' + (s < 0 ? 'L' : 'R') + '_Grey', 'Grey', s * (HW - 0.01), 0.5, 0.35, 0.05, 0.05, 0.9);

// lights
for (const s of [-1, 1]) box('Headlights' + (s < 0 ? 'L' : 'R'), 'Headlights', s * 0.72, 1.02, 2.95, 0.24, 0.11, 0.04);
for (const s of [-1, 1]) box('TailLights' + (s < 0 ? 'L' : 'R'), 'TailLights', s * 0.86, 1.06, -2.95, 0.11, 0.18, 0.04);

// wheels — names the rig matches, axis along X, arches implied by the body sitting above them
wheel('FrontLeftWheel', 'Black', -(HW - 0.1), WHEEL_R, AXLE_F, WHEEL_R, WHEEL_W / 2);
wheel('FrontRightWheel', 'Black', HW - 0.1, WHEEL_R, AXLE_F, WHEEL_R, WHEEL_W / 2);
wheel('RearLeftWheel', 'Black', -(HW - 0.1), WHEEL_R, AXLE_R, WHEEL_R, WHEEL_W / 2);
wheel('RearRightWheel', 'Black', HW - 0.1, WHEEL_R, AXLE_R, WHEEL_R, WHEEL_W / 2);

/* ── pack it into a GLB ──────────────────────────────────────────────────────
 * Plain glTF 2.0: one buffer, three accessors per mesh, one primitive per mesh, one node per mesh.
 * No textures and no PBR values worth reading — the game overwrites all of it — but the material
 * NAMES are the payload, because that is what classify() keys on. */
const MATERIALS = ['White', 'Grey', 'Black', 'Windows', 'Headlights', 'TailLights'];
const chunks = [];
let offset = 0;
const bufferViews = [];
const accessors = [];

function view(data, target) {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    offset += pad;
  }
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
  chunks.push(bytes);
  offset += bytes.length;
  return bufferViews.length - 1;
}

const primitives = [];
for (const m of meshes) {
  const pos = new Float32Array(m.P);
  const nrm = new Float32Array(m.N);
  const idx = new Uint16Array(m.I);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  const vp = view(pos, 34962);
  const vn = view(nrm, 34962);
  const vi = view(idx, 34963);
  accessors.push({ bufferView: vp, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
  accessors.push({ bufferView: vn, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
  accessors.push({ bufferView: vi, componentType: 5123, count: idx.length, type: 'SCALAR' });
  primitives.push({
    POSITION: accessors.length - 3,
    NORMAL: accessors.length - 2,
    indices: accessors.length - 1,
    material: MATERIALS.indexOf(m.material),
    name: m.name,
  });
}

const gltf = {
  asset: { version: '2.0', generator: 'wanderoad tools/make-truck.mjs (this repository, CC0)' },
  scene: 0,
  scenes: [{ nodes: meshes.map((_, i) => i) }],
  nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
  meshes: meshes.map((m, i) => ({
    name: m.name,
    primitives: [
      {
        attributes: { POSITION: primitives[i].POSITION, NORMAL: primitives[i].NORMAL },
        indices: primitives[i].indices,
        material: primitives[i].material,
      },
    ],
  })),
  materials: MATERIALS.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] } })),
  accessors,
  bufferViews,
  buffers: [{ byteLength: offset }],
};

const json = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
const bin = Buffer.concat(chunks);
const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4);
const total = 12 + 8 + json.length + jsonPad.length + 8 + bin.length + binPad.length;
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0);
head.writeUInt32LE(2, 4);
head.writeUInt32LE(total, 8);
const jHead = Buffer.alloc(8);
jHead.writeUInt32LE(json.length + jsonPad.length, 0);
jHead.writeUInt32LE(0x4e4f534a, 4);
const bHead = Buffer.alloc(8);
bHead.writeUInt32LE(bin.length + binPad.length, 0);
bHead.writeUInt32LE(0x004e4942, 4);
writeFileSync(OUT, Buffer.concat([head, jHead, json, jsonPad, bHead, bin, binPad]));

console.log(
  JSON.stringify({
    out: OUT,
    bytes: total,
    meshes: meshes.length,
    tris: meshes.reduce((a, m) => a + m.I.length / 3, 0),
    materials: MATERIALS.length,
    size: [W.toFixed(2), (ROOF - 0).toFixed(2), L.toFixed(2)].join(' x '),
  })
);
