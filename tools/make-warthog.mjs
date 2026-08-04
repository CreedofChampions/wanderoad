/* BUILD A BIG, OBVIOUSLY-OFF-ROAD 4x4, AS A GLB, FROM THIS REPOSITORY'S OWN GEOMETRY.
 *
 * Operator: the Rally car reads as a sports car, not an off-roader, because rally.glb WAS the
 * Quaternius SportsCar mesh — same silhouette as the Coupe, just re-painted orange. "Give it a Jeep
 * with big wheels" is not a paint job, it is a different SHAPE, so this replaces the mesh entirely.
 *
 * WHY THIS IS AUTHORED RATHER THAN DOWNLOADED. Same search, same result as tools/make-truck.mjs —
 * read that file's header for the full account. Every CC0 off-road model found on Poly Pizza is a
 * single-material TEXTURE-ATLAS mesh, which this game's loader paints as one flat lump, because it
 * colours a car by reading SEPARATED material names — White, Grey, Black, Windows, Headlights,
 * TailLights (see car/loadedCar.js's classify()) — and an atlas model has exactly one material for
 * the whole body. Those models' wheel nodes are also named for somebody else's rig, not
 * `frontleft`/`frontright`/`rearleft`/`rearright`, so they would not steer either. Everything else on
 * the CC0 shelf that WAS split into separate materials was CC-BY, which is off this project's licence
 * list (CC0 / MIT / Apache / BSD / public domain only). So: build it here, from the same boxes and
 * cylinders make-truck.mjs uses, with the material and node names the loader actually wants. Nothing
 * downloaded, the licence is this repository's own, and it is the only option that paints, lights up
 * and steers like the rest of the fleet.
 *
 * TRADEMARK, once and plainly: "Warthog" is 343 Industries/Microsoft's name for the vehicle in Halo,
 * and this is not a copy of their model, their textures, or their materials — nobody involved in
 * writing this file has access to any of those. It is a generic big-wheeled, open-top, roll-caged
 * off-roader built to the same BRIEF (huge wheels, huge ground clearance, open cockpit, rear roll
 * hoop) out of this game's own primitives, at this game's own fleet length. The in-game label stays
 * "Rally" (src/game/garage.js) — nothing about the geometry below depends on any other name.
 *
 * THE CONTRACT (car/loadedCar.js — identical to make-truck.mjs's, repeated here because it is the
 * only thing that makes this file's numbers meaningful):
 *   - forward is +Z; the loader does NOT rotate, it trusts the model
 *   - it scales so max(x, z) equals the fleet entry's `length` (4.2 m for 'rally', src/game/garage.js),
 *     then sits min(y) on the road — so everything below is built at a bigger, easier-to-reason-about
 *     scale, and the loader rescales it UNIFORMLY afterwards; proportions are what matter here, not
 *     the raw metres
 *   - a wheel is a mesh whose NAME contains "wheel" plus frontleft/frontright/rearleft/rearright
 *   - a wheel's cylinder axis is the model's X
 *   - material name decides the paint: window/glass, headlight, taillight, black, grey, else body
 *
 *   node tools/make-warthog.mjs [out.glb]
 */
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] || 'public/models/cars/rally.glb';

/* ── proportions, in metres, of a big off-road 4x4 in the spirit of Halo's Warthog ────────────────
 * The design brief, roughly in order of how strongly each one reads at a glance: huge wheels, huge
 * ground clearance (daylight under the belly, between the wheels — the single strongest "this is an
 * off-roader" cue there is), a track wider than the body so the wheels stand PROUD of the bodywork
 * instead of tucked under a fender, and an open top with a roll cage instead of a roof. Every other
 * car in the fleet is a closed-roof road car at road-car ride height; this one has to fail that
 * silhouette test from any angle, at a glance, at distance, or it is just another sedan with a paint
 * job — which is the exact complaint that started this file. */
const L = 4.6; // overall length — chunky, not long
const HL = L / 2;
const W = 2.2; // overall width, THROUGH THE WHEELS — the tub itself is much narrower, see HW_BODY
const HW = W / 2;

const WHEEL_R = 0.6; // big — noticeably bigger than the pickup's 0.46 m
const WHEEL_W = 0.42;
const AXLE_X = HW - WHEEL_W / 2; // wheel centreline; its OUTER face lands exactly on the overall width
const AXLE_F = 1.6;
const AXLE_R = -1.6;

/* HW_BODY sits well inboard of the wheel's INNER face (AXLE_X - WHEEL_W / 2 = 0.68 m) on purpose:
 * every painted panel below stays at or under ~0.66 m from the centreline, so nothing but the bull
 * bar gets anywhere near the tyre. That gap between body edge and tyre is what "wheels proud of the
 * bodywork" looks like in practice — there is no fender trying to cover them. */
const HW_BODY = 0.64;
const FLOOR = 0.94; // underside of the chassis — the ground-clearance number itself. The pickup's
// equivalent is 0.62 m; this is deliberately far higher relative to a wheel that is itself
// bigger, and it is the one number in this file that most decides whether the model reads
// as an off-roader or a low sports car from a stationary side-on look.
const LOWER_TOP = 1.16; // top of the chassis rail / where the tub floor sits
const TUB_TOP = 1.42; // top edge of the open cockpit tub / the beltline
const CAGE_TOP = 1.9; // outer top face of the roll-hoop bar — keeps overall height comfortably under 2 m

const meshes = [];

/** An axis-aligned box, by centre and half-extents. 24 vertices so each face gets a flat normal.
 *  Copied verbatim from tools/make-truck.mjs: the contract it satisfies (flat-shaded, outward
 *  normals, CCW winding for a right-handed loader) belongs to the loader, not to what the box is. */
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
 * A cylinder whose axis runs along X — what the wheel rig assumes, and the reason a wheel built
 * about any other axis rolls in a cone rather than turning. Copied verbatim from make-truck.mjs.
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

/* ── the warthog ────────────────────────────────────────────────────────────────────────────────
 * Built as a stack of volumes exactly the way make-truck.mjs is, because that is what makes a car
 * read as its type from any angle: a chassis rail that runs the length and sits high, a blunt nose
 * with a grille bolted to the front of it, an open tub instead of a cab, a roll cage instead of a
 * roof, and a flat deck instead of a bed. Nothing here is solid where the brief calls for it to read
 * as open — the tub has no lid anywhere in this file, and the cage is three thin bars, not a panel. */

// chassis / lower body — the high, flat belly that makes the ground-clearance gap read as
// deliberate rather than as a wheel-arch cutout. Runs most of the length; the nose and the rear
// deck below pick up where it stops short of the bumpers.
box('Body_Lower', 'White', 0, (FLOOR + LOWER_TOP) / 2, 0, HW_BODY - 0.06, (LOWER_TOP - FLOOR) / 2, HL - 0.45);

// the nose: blunt and upright on purpose — a raked bonnet reads as a sports car, a flat one reads
// as a working vehicle. The grille is its own thin Grey box bolted to the face, not a hole cut into
// the White panel, because this pipeline has no boolean subtraction, only boxes stacked on boxes.
box('Body_Nose', 'White', 0, (LOWER_TOP + TUB_TOP) / 2, 2.02, HW_BODY - 0.04, (TUB_TOP - LOWER_TOP) / 2, 0.22);
box('Body_Hood', 'White', 0, LOWER_TOP + 0.06, 1.55, HW_BODY - 0.08, 0.06, 0.65);
box('Grille_Grey', 'Grey', 0, 1.2, 2.24, HW_BODY - 0.1, 0.16, 0.03);

// bull bar: a bar above a bumper, not one body-coloured panel — the two-tier shape is what reads as
// "bull bar" rather than "front spoiler". This is the frontmost geometry in the model.
box('BullBar_Grey', 'Grey', 0, 1.3, 2.18, HW_BODY + 0.02, 0.04, 0.05);
box('Bumper_Front_Grey', 'Grey', 0, 0.8, 2.24, HW_BODY + 0.02, 0.07, 0.06);

// headlights, set into the nose either side of the grille
for (const s of [-1, 1]) box('Headlights' + (s < 0 ? 'L' : 'R'), 'Headlights', s * 0.5, 1.24, 2.26, 0.13, 0.09, 0.04);

// the open cockpit: two low tub walls and nothing above them — no roof mesh exists anywhere in this
// file, which is what makes it open rather than merely a convertible with the top down.
for (const s of [-1, 1])
  box('Tub' + (s < 0 ? 'L' : 'R'), 'White', s * (HW_BODY - 0.04), (LOWER_TOP + TUB_TOP) / 2, 0.1, 0.06, (TUB_TOP - LOWER_TOP) / 2, 1.15);

// a small low windscreen ahead of the seats — a deflector, not a full pillar-to-pillar screen,
// because the cage behind it is what is supposed to read as the safety structure here.
box('Windscreen', 'Windows', 0, TUB_TOP + 0.16, 1.05, HW_BODY - 0.1, 0.16, 0.03);

// roll cage: two uprights out of the tub sides behind the seats, capped by one hoop bar. Three
// boxes and no panel between them, so it silhouettes as a cage rather than as a targa roof.
for (const s of [-1, 1])
  box('Cage' + (s < 0 ? 'L' : 'R') + '_Black', 'Black', s * (HW_BODY - 0.06), (TUB_TOP + 1.84) / 2, -0.6, 0.05, (1.84 - TUB_TOP) / 2, 0.05);
box('CageTop_Black', 'Black', 0, 1.86, -0.6, HW_BODY - 0.06, 0.05, 0.06);

// rear deck: a flat tray behind the cockpit with two low guard rails — the Warthog's cargo/gun deck,
// not an enclosed pickup bed, hence rails rather than tall walls.
box('Body_DeckFloor', 'White', 0, LOWER_TOP + 0.05, -1.7, HW_BODY - 0.06, 0.05, 0.55);
for (const s of [-1, 1]) box('DeckRail' + (s < 0 ? 'L' : 'R') + '_Grey', 'Grey', s * (HW_BODY - 0.08), LOWER_TOP + 0.18, -1.7, 0.04, 0.1, 0.5);

// rear bumper and tail lights — this bumper is the rearmost geometry in the model, mirroring the
// bull bar being the frontmost, so the belly's high-clearance silhouette reads all the way along.
box('Bumper_Rear_Grey', 'Grey', 0, 0.8, -2.25, HW_BODY, 0.07, 0.05);
for (const s of [-1, 1]) box('TailLights' + (s < 0 ? 'L' : 'R'), 'TailLights', s * 0.52, 1.05, -2.26, 0.11, 0.1, 0.04);

// wheels — names the rig matches, axis along X, deliberately wider than every body panel above and
// deliberately bigger than any other car in the fleet.
wheel('FrontLeftWheel', 'Black', -AXLE_X, WHEEL_R, AXLE_F, WHEEL_R, WHEEL_W / 2);
wheel('FrontRightWheel', 'Black', AXLE_X, WHEEL_R, AXLE_F, WHEEL_R, WHEEL_W / 2);
wheel('RearLeftWheel', 'Black', -AXLE_X, WHEEL_R, AXLE_R, WHEEL_R, WHEEL_W / 2);
wheel('RearRightWheel', 'Black', AXLE_X, WHEEL_R, AXLE_R, WHEEL_R, WHEEL_W / 2);

/* ── pack it into a GLB ──────────────────────────────────────────────────────────────────────────
 * Plain glTF 2.0: one buffer, three accessors per mesh, one primitive per mesh, one node per mesh.
 * No textures and no PBR values worth reading — the game overwrites all of it — but the material
 * NAMES are the payload, because that is what classify() keys on. This packer is identical to
 * make-truck.mjs's: nothing about turning a mesh list into a GLB is specific to what the meshes are. */
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
  asset: { version: '2.0', generator: 'wanderoad tools/make-warthog.mjs (this repository, CC0)' },
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
    size: [W.toFixed(2), CAGE_TOP.toFixed(2), L.toFixed(2)].join(' x '),
  })
);
