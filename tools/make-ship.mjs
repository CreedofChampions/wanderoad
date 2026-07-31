/* TURN A SYNTY HULL INTO A GLB THIS GAME CAN PAINT.
 *
 * Operator: "Replace the ship asap ... CC0 assets tend to be trash use the ones i paid for."
 *
 * The Synty POLYGON Pirates pack ships FBX only. `FBX2glTF` converts it, but what comes out is not
 * usable as-is for two reasons:
 *
 *   1. UNREAL COLLISION PROXIES. Every hull carries 20-36 `UCX_*` meshes — convex hulls Unreal uses
 *      for physics. They are invisible in Unreal and SOLID here, so loading the file straight gives
 *      a boat wrapped in a lumpy grey shell. They are ~95% of the file's meshes.
 *   2. ONE MATERIAL, called `lambert1`. This game paints a model by reading MATERIAL NAMES (see
 *      car/loadedCar.js's classify), so an unnamed single material means the whole boat is one flat
 *      colour with no waterline, no trim and no glass.
 *
 * So this strips the proxies, keeps the hull, and splits it by HEIGHT into named materials the
 * painted classifier already understands — below the waterline, hull, and trim above the gunwale.
 * Height is the honest axis for a boat: a hull's colour bands really are horizontal.
 *
 * THE OUTPUT NEVER GOES IN THIS REPOSITORY. `CreedofChampions/wanderoad` is public and Synty's EULA
 * forbids redistributing the assets AS assets. It is uploaded to the VPS beside the build instead
 * (see tools/push-synty.mjs), which is the same origin the game is served from, so no CORS and no
 * published mesh.
 *
 *   node tools/make-ship.mjs <converted.glb> <out.glb>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [IN, OUT] = [process.argv[2], process.argv[3]];
if (!IN || !OUT) {
  console.error('usage: node tools/make-ship.mjs <converted.glb> <out.glb>');
  process.exit(1);
}

/** Read a GLB into { gltf, bin }. */
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

/** Pull one accessor out as a plain JS array of numbers. Only what FBX2glTF emits. */
function readAccessor(gltf, bin, idx) {
  const a = gltf.accessors[idx];
  const bv = gltf.bufferViews[a.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const start = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count * comps; i++) {
    if (a.componentType === 5126) out.push(bin.readFloatLE(start + i * 4));
    else if (a.componentType === 5125) out.push(bin.readUInt32LE(start + i * 4));
    else if (a.componentType === 5123) out.push(bin.readUInt16LE(start + i * 2));
    else if (a.componentType === 5121) out.push(bin.readUInt8(start + i));
    else throw new Error('unhandled componentType ' + a.componentType);
  }
  return out;
}

const { gltf, bin } = readGlb(readFileSync(IN));

/* THE HULL IS EVERY MESH THAT IS NOT A COLLISION PROXY. Matching on the `UCX_` prefix rather than
 * "keep the biggest" because the prefix is Unreal's own documented convention and a size heuristic
 * would silently keep the wrong thing on a hull whose proxies are large. */
const keep = [];
for (const node of gltf.nodes || []) {
  if (node.mesh === undefined) continue;
  const name = node.name || gltf.meshes[node.mesh].name || '';
  if (/^UCX_/i.test(name)) continue;
  keep.push({ name, mesh: node.mesh });
}
if (!keep.length) throw new Error('no non-proxy mesh found');

// Gather every triangle of the kept meshes, in model space.
const pos = [];
const nrm = [];
const tri = [];
for (const k of keep) {
  for (const prim of gltf.meshes[k.mesh].primitives) {
    const P = readAccessor(gltf, bin, prim.attributes.POSITION);
    const N = prim.attributes.NORMAL !== undefined ? readAccessor(gltf, bin, prim.attributes.NORMAL) : null;
    const I = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices) : P.map((_, i) => i / 3);
    const base = pos.length / 3;
    for (let i = 0; i < P.length; i++) pos.push(P[i]);
    for (let i = 0; i < P.length; i++) nrm.push(N ? N[i] : 0);
    for (let i = 0; i < I.length; i += 3) tri.push([base + I[i], base + I[i + 1], base + I[i + 2]]);
  }
}

// Model bounds, so the height split is relative to the boat rather than to a magic number.
let lo = [Infinity, Infinity, Infinity];
let hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < pos.length; i += 3)
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], pos[i + k]);
    hi[k] = Math.max(hi[k], pos[i + k]);
  }
const H = hi[1] - lo[1];

/* Three bands, named for what car/loadedCar.js's classify() does with them:
 *   Black  -> matte tyre-dark: the hull below the waterline
 *   White  -> body paint: the hull sides, which take the player's colour
 *   Grey   -> chrome/metal: the trim, rails and deck fittings above the gunwale */
const BANDS = [
  { name: 'Black', upTo: 0.34 },
  { name: 'White', upTo: 0.76 },
  { name: 'Grey', upTo: Infinity },
];
const groups = BANDS.map(() => []);
for (const t of tri) {
  const yMid = (pos[t[0] * 3 + 1] + pos[t[1] * 3 + 1] + pos[t[2] * 3 + 1]) / 3;
  const f = H > 0 ? (yMid - lo[1]) / H : 0.5;
  groups[BANDS.findIndex((b) => f <= b.upTo)].push(t);
}

/* Re-emit. One primitive per band, each with its own compacted vertex list — the painted shader
 * writes per-vertex colour from the material name, so a vertex cannot belong to two bands. */
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
groups.forEach((g, gi) => {
  if (!g.length) return;
  const map = new Map();
  const P = [];
  const N = [];
  const I = [];
  for (const t of g)
    for (const v of t) {
      let n = map.get(v);
      if (n === undefined) {
        n = P.length / 3;
        map.set(v, n);
        P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        N.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
      }
      I.push(n);
    }
  const pa = new Float32Array(P);
  const na = new Float32Array(N);
  const ia = P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pa.length; i += 3)
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], pa[i + k]);
      mx[k] = Math.max(mx[k], pa[i + k]);
    }
  const vp = view(pa, 34962);
  const vn = view(na, 34962);
  const vi = view(ia, 34963);
  accessors.push({ bufferView: vp, componentType: 5126, count: pa.length / 3, type: 'VEC3', min: mn, max: mx });
  accessors.push({ bufferView: vn, componentType: 5126, count: na.length / 3, type: 'VEC3' });
  accessors.push({
    bufferView: vi,
    componentType: ia instanceof Uint32Array ? 5125 : 5123,
    count: ia.length,
    type: 'SCALAR',
  });
  meshesOut.push({
    name: `Hull_${BANDS[gi].name}`,
    primitives: [
      {
        attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 },
        indices: accessors.length - 1,
        material: gi,
      },
    ],
  });
});

const out = {
  asset: { version: '2.0', generator: 'wanderoad tools/make-ship.mjs' },
  scene: 0,
  scenes: [{ nodes: meshesOut.map((_, i) => i) }],
  nodes: meshesOut.map((m, i) => ({ name: m.name, mesh: i })),
  meshes: meshesOut,
  materials: BANDS.map((b) => ({ name: b.name, pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1] } })),
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

console.log(
  JSON.stringify({
    out: OUT,
    keptMeshes: keep.length,
    droppedProxies: (gltf.nodes || []).filter((n) => n.mesh !== undefined && /^UCX_/i.test(n.name || '')).length,
    tris: tri.length,
    bands: meshesOut.map((m) => m.name),
    bytes: total,
    size: [hi[0] - lo[0], H, hi[2] - lo[2]].map((v) => v.toFixed(2)).join(' x '),
  })
);
