/* TURN A SYNTY POLYGON VEHICLE INTO A CAR THIS GAME CAN PAINT AND STEER.
 *
 * Operator: "synty assets much better than kenny" and, repeatedly, better car models.
 *
 * `FBX2glTF` gets the geometry out, but what comes out cannot be used as-is, for the same reason the
 * boats could not (see tools/make-ship.mjs): this game paints a car by reading MATERIAL NAMES and
 * rigs its wheels by reading NODE NAMES (car/loadedCar.js's `classify` and its corner matcher), and
 * a Synty pack carries one shared atlas material called `Vehicles` and wheels called `Wheel_fl`.
 * Loaded straight, you get a single-coloured lump with no glass, no lights and no steering.
 *
 * The good news, and the reason these are worth the work where the boats were awkward: Synty already
 * separates every part into its own NODE — body, glass, four wheels, steering wheel. So the mapping
 * is a rename, not a reconstruction:
 *
 *     *_Wheel_fl  ->  FrontLeftWheel   + material Black
 *     *_Wheel_fr  ->  FrontRightWheel  + material Black
 *     *_Wheel_rl  ->  RearLeftWheel    + material Black
 *     *_Wheel_rr  ->  RearRightWheel   + material Black
 *     *_Glass     ->  Windows          (the loader tints and makes it metal)
 *     *_SteeringW ->  Grey             (chrome; it is interior trim)
 *     everything else                  White -> whatever paint the player picked
 *
 * TEXCOORDs are dropped. The atlas they index is never loaded — the whole point of this game's
 * painted look is that it re-materials a model into its own shader — so carrying them would be
 * bytes for nothing.
 *
 * THE OUTPUT IS PRIVATE. Synty's EULA permits using these in your own game and forbids
 * redistributing them AS assets, so they may only live in the private repo
 * (CreedofChampions/cozy-driver), never in the public one.
 *
 *   node tools/synty-car.mjs <converted.glb> <out.glb>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [IN, OUT] = [process.argv[2], process.argv[3]];
if (!IN || !OUT) {
  console.error('usage: node tools/synty-car.mjs <converted.glb> <out.glb>');
  process.exit(1);
}

function readGlb(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  let p = 20 + jsonLen;
  let bin = Buffer.alloc(0);
  while (p < buf.length) {
    const len = buf.readUInt32LE(p);
    const type = buf.readUInt32LE(p + 4);
    if (type === 0x004e4942) bin = buf.subarray(p + 8, p + 8 + len);
    p += 8 + len;
  }
  return { gltf, bin };
}

function readAccessor(gltf, bin, idx) {
  const a = gltf.accessors[idx];
  const bv = gltf.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const stride = bv.byteStride || 0;
  const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const at = base + (stride ? i * stride : i * comps * (a.componentType === 5123 ? 2 : a.componentType === 5121 ? 1 : 4));
    for (let c = 0; c < comps; c++) {
      if (a.componentType === 5126) out.push(bin.readFloatLE(at + c * 4));
      else if (a.componentType === 5125) out.push(bin.readUInt32LE(at + c * 4));
      else if (a.componentType === 5123) out.push(bin.readUInt16LE(at + c * 2));
      else if (a.componentType === 5121) out.push(bin.readUInt8(at + c));
      else throw new Error('unhandled componentType ' + a.componentType);
    }
  }
  return out;
}

/** The whole mapping, in one place: what a Synty node is called, and what this game needs it called. */
function rename(name) {
  const n = (name || '').toLowerCase();
  if (/_wheel_fl/.test(n)) return { node: 'FrontLeftWheel', mat: 'Black' };
  if (/_wheel_fr/.test(n)) return { node: 'FrontRightWheel', mat: 'Black' };
  // A truck has two rear axles (rl_01, rl_02). Both are the same corner as far as the rig cares —
  // it groups by corner and spins them together, which is what a tandem axle does anyway.
  if (/_wheel_rl/.test(n)) return { node: 'RearLeftWheel', mat: 'Black' };
  if (/_wheel_rr/.test(n)) return { node: 'RearRightWheel', mat: 'Black' };
  if (/glass|window/.test(n)) return { node: 'Glass', mat: 'Windows' };
  /* NOT "SteeringWheel". The loader rigs a corner from any mesh whose name contains "wheel", with a
   * fallback that treats anything unmatched as a REAR wheel — so calling the interior steering wheel
   * what it is got it rigged as a fifth road wheel and spun with the axles. Measured: the live scene
   * graph reported five corners, `wheel:r:steer` among them. The name simply must not contain the
   * word, so it does not. */
  if (/steeringw/.test(n)) return { node: 'Interior_Steering', mat: 'Grey' };
  return { node: 'Body', mat: 'White' };
}

const { gltf, bin } = readGlb(readFileSync(IN));

/* Node transforms matter here in a way they did not for the boats: Synty parents each wheel under
 * the root with its own translation, and the loader measures a wheel's hub from its geometry in
 * PARENT space. Baking the node's translation into the vertices keeps every part where the artist
 * put it while flattening the hierarchy to one node per mesh, which is what the rig expects. */
const nodeOf = new Map();
(gltf.nodes || []).forEach((n, i) => {
  if (n.mesh !== undefined) nodeOf.set(n.mesh, n);
});

const MATERIALS = ['White', 'Grey', 'Black', 'Windows'];
const chunks = [];
let off = 0;
const bufferViews = [];
const accessors = [];
const view = (data, target) => {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const pad = (4 - (off % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    off += pad;
  }
  bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) });
  chunks.push(b);
  off += b.length;
  return bufferViews.length - 1;
};

const meshesOut = [];
const seen = new Map();
let tris = 0;
(gltf.meshes || []).forEach((m, mi) => {
  const src = nodeOf.get(mi);
  const r = rename(src?.name || m.name);
  const t = src?.translation || [0, 0, 0];
  const s = src?.scale || [1, 1, 1];
  for (const prim of m.primitives) {
    const P = readAccessor(gltf, bin, prim.attributes.POSITION);
    const N = prim.attributes.NORMAL !== undefined ? readAccessor(gltf, bin, prim.attributes.NORMAL) : null;
    const I = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices) : P.map((_, i) => i / 3);
    const pos = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      pos[i] = P[i] * s[0] + t[0];
      pos[i + 1] = P[i + 1] * s[1] + t[1];
      pos[i + 2] = P[i + 2] * s[2] + t[2];
    }
    const nrm = new Float32Array(N || new Array(P.length).fill(0));
    const idx = pos.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I);
    tris += idx.length / 3;
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3)
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], pos[i + k]);
        mx[k] = Math.max(mx[k], pos[i + k]);
      }
    const vp = view(pos, 34962);
    const vn = view(nrm, 34962);
    const vi = view(idx, 34963);
    accessors.push({ bufferView: vp, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn, max: mx });
    accessors.push({ bufferView: vn, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    accessors.push({
      bufferView: vi,
      componentType: idx instanceof Uint32Array ? 5125 : 5123,
      count: idx.length,
      type: 'SCALAR',
    });
    // Unique node names, so a truck's two rear axles do not collide into one name.
    const n = (seen.get(r.node) || 0) + 1;
    seen.set(r.node, n);
    meshesOut.push({
      name: n > 1 ? `${r.node}_${n}` : r.node,
      primitives: [
        {
          attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 },
          indices: accessors.length - 1,
          material: MATERIALS.indexOf(r.mat),
        },
      ],
    });
  }
});

const out = {
  asset: { version: '2.0', generator: 'wanderoad tools/synty-car.mjs' },
  scene: 0,
  scenes: [{ nodes: meshesOut.map((_, i) => i) }],
  nodes: meshesOut.map((m, i) => ({ name: m.name, mesh: i })),
  meshes: meshesOut,
  materials: MATERIALS.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] } })),
  accessors,
  bufferViews,
  buffers: [{ byteLength: off }],
};
const json = Buffer.from(JSON.stringify(out), 'utf8');
const jPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
const binOut = Buffer.concat(chunks);
const bPad = Buffer.alloc((4 - (binOut.length % 4)) % 4);
const total = 12 + 8 + json.length + jPad.length + 8 + binOut.length + bPad.length;
const head = Buffer.alloc(12);
head.writeUInt32LE(0x46546c67, 0);
head.writeUInt32LE(2, 4);
head.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(json.length + jPad.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(binOut.length + bPad.length, 0);
bh.writeUInt32LE(0x004e4942, 4);
writeFileSync(OUT, Buffer.concat([head, jh, json, jPad, bh, binOut, bPad]));

console.log(JSON.stringify({ out: OUT, meshes: meshesOut.length, tris, names: meshesOut.map((m) => m.name), bytes: total }));
