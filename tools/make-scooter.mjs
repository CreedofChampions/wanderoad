/* Wanderoad — THE SCOOTER, WHICH IS THE OLD WOBBLE GIVEN A BODY.
 *
 * Operator: "Get the old wobbly controls back and give them to a scooter you can unlock".
 *
 * The wobble he means is his own phrase. When the cars leaned too much he wrote "Car still wobbles
 * left to right immensely, LIKE A SCOOTER", and three separate numbers were changed to stop it:
 * the lean spring was overdamped (rollZeta 0.85 -> 1.3), the target it chases was filtered harder
 * (loadTauRoll 0.15 -> 0.22), and the ground-following roll was rate-limited (unbounded -> 3 rad/s).
 * Those were right for a car. They are wrong for the vehicle he was comparing the car to — so the
 * scooter takes all three back, and the thing that used to be a bug is now a machine you can own.
 * The numbers live in game/garage.js beside the rest of its feel; this file is only its shape.
 *
 * BUILT HERE rather than downloaded, for the reason make-truck.mjs sets out at length: this game
 * paints a vehicle by reading separated material NAMES, and essentially every free scooter model is
 * a single-material texture-atlas asset that would arrive as one flat colour. Also the licence
 * question never comes up.
 *
 * TWO WHEELS, and the rig in car/loadedCar.js already handles that without a change: it keys a
 * corner off "frontleft"/"frontright"/"rearleft"/"rearright" and falls back to plain "front"/"rear",
 * so `Wheel_Front` and `Wheel_Rear` each get their own steering and rolling node. No fake wheels
 * hidden inside the bodywork, which was the other way to do this and would have z-fought.
 *
 * THE CONTRACT (car/loadedCar.js), unchanged from the truck:
 *   - forward is +Z; the loader does NOT rotate, it trusts the model
 *   - it scales so max(x, z) equals the fleet entry's `length`, then sits min(y) on the road
 *   - a wheel is a mesh whose NAME contains "wheel"
 *   - a wheel's cylinder axis is the model's X
 *   - material name decides the paint: window/glass, headlight, taillight, black, grey, else body
 *
 *   node tools/make-scooter.mjs [out.glb]
 */
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'public/models/cars/scooter.glb';

/* ── proportions, in metres, of a 125 cc twist-and-go ────────────────────────
 * A real Vespa GTS is 1.95 m long, 0.76 m wide and 1.29 m tall on 0.28 m wheels. Kept honest: the
 * whole joke of unlocking it is that it is a THIRD of the length of the pickup parked next to it. */
const L = 1.95;
const W = 0.76;
const HW = W / 2;
const WHEEL_R = 0.28;
const WHEEL_W = 0.12;
const AXLE_F = 0.7;
const AXLE_R = -0.62;
const DECK = 0.34; // the footboard you stand on
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

/* ── the scooter ────────────────────────────────────────────────────────────
 * A step-through: the tall front leg shield, a low flat deck, and the body swelling up behind the
 * seat over the engine. Everything is drawn about the centreline because a two-wheeler is
 * symmetrical, and the whole silhouette has to read at 40 m on a forecourt beside a pickup. */

// the body: leg shield, deck, and the tail that carries the seat and the engine
box('Shield_White', 'White', 0, DECK + 0.34, 0.52, HW - 0.06, 0.34, 0.09); // front leg shield
box('Shield_Top_White', 'White', 0, DECK + 0.62, 0.47, HW - 0.13, 0.08, 0.13); // the fairing above it
box('Deck_White', 'White', 0, DECK - 0.05, 0.02, HW - 0.08, 0.06, 0.46); // the flat footboard
box('Tail_White', 'White', 0, DECK + 0.2, -0.42, HW - 0.05, 0.24, 0.42); // the body over the engine
box('Tail_Top_White', 'White', 0, DECK + 0.4, -0.5, HW - 0.11, 0.08, 0.3);

// the seat, in black, sitting on top of the tail
box('Seat_Black', 'Black', 0, DECK + 0.5, -0.3, HW - 0.12, 0.07, 0.42);
box('SeatBack_Black', 'Black', 0, DECK + 0.62, -0.66, HW - 0.14, 0.09, 0.06);

// the front end: fork legs, the handlebar, the mirrors, and the mudguard over the wheel
for (const s of [-1, 1]) box('Fork' + (s < 0 ? 'L' : 'R') + '_Grey', 'Grey', s * 0.14, 0.52, AXLE_F, 0.035, 0.28, 0.035);
box('Guard_White', 'White', 0, WHEEL_R + 0.2, AXLE_F, 0.11, 0.04, 0.2);
box('Column_Grey', 'Grey', 0, DECK + 0.68, 0.55, 0.05, 0.22, 0.05);
box('Bars_Grey', 'Grey', 0, DECK + 0.88, 0.55, HW + 0.06, 0.03, 0.035); // the handlebar, wider than the body
for (const s of [-1, 1]) box('Grip' + (s < 0 ? 'L' : 'R') + '_Black', 'Black', s * (HW + 0.02), DECK + 0.88, 0.55, 0.07, 0.04, 0.045);
for (const s of [-1, 1]) box('Mirror' + (s < 0 ? 'L' : 'R') + '_Grey', 'Grey', s * (HW + 0.1), DECK + 1.02, 0.5, 0.05, 0.03, 0.02);

// the windscreen, which is the only glass on the thing
box('Screen_Windows', 'Windows', 0, DECK + 0.95, 0.42, HW - 0.14, 0.22, 0.02);

// the exhaust and the stand, low on the right
box('Pipe_Grey', 'Grey', 0.2, 0.18, -0.5, 0.05, 0.05, 0.3);

// lights: one round headlamp in the shield, one lamp at the tail
box('Headlights', 'Headlights', 0, DECK + 0.4, 0.61, 0.12, 0.1, 0.03);
box('TailLights', 'TailLights', 0, DECK + 0.34, -0.84, 0.09, 0.07, 0.03);

/* The wheels, on the centreline. `Wheel_Front` and `Wheel_Rear` are enough for the rig — see the
 * header — and small wheels are half of why a scooter darts about the way it does. */
wheel('Wheel_Front', 'Black', 0, WHEEL_R, AXLE_F, WHEEL_R, WHEEL_W / 2);
wheel('Wheel_Rear', 'Black', 0, WHEEL_R, AXLE_R, WHEEL_R, WHEEL_W / 2);

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
  asset: { version: '2.0', generator: 'wanderoad tools/make-scooter.mjs (this repository, CC0)' },
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
    size: [W.toFixed(2), (DECK + 1.05).toFixed(2), L.toFixed(2)].join(' x '),
  })
);
