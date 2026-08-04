/* TURN QUATERNIUS'S "PICKUP TRUCK ARMORED" INTO THE RALLY CAR THIS GAME CAN PAINT AND STEER.
 *
 * Operator, flatly: "dont make your own models -- use the ones offered you u are bad at it." The
 * Rally's body (tools/make-warthog.mjs) was hand-built from boxes and cylinders because every CC0
 * off-roader on Poly Pizza was checked and rejected for the two reasons below — see that file's
 * header and tools/make-truck.mjs's for the full account. Told plainly to stop building bodies and
 * use a downloaded one instead, this file does that: it takes Quaternius's CC0 "Pickup Truck
 * Armored" (poly.pizza/m/RUwMItmU4B — see public/models/cars/LICENCE.txt) and turns it into
 * something this game's rig and paint system actually understand.
 *
 * WHY IT CANNOT BE LOADED AS-IS — the same two failures make-truck.mjs's header documents for
 * every other CC0 pickup on the shelf, confirmed here by inspecting the actual file
 * (tools/sources/quaternius-pickup-armored.glb, 603 396 bytes):
 *
 *   1. car/loadedCar.js's `classify()` paints a car by reading SEPARATED MATERIAL NAMES — White,
 *      Grey, Black, Windows, Headlights, TailLights. This model carries only two materials, `Atlas`
 *      (11 386 of the body mesh's 11 628 vertices — everything but the headlight lenses) and
 *      `Headlights` (242 vertices, 11 386 + 242 = 11 628). Loaded straight, the entire body — paint,
 *      undercarriage, trim — is ONE flat lump, because there is nothing for classify() to key on but
 *      "Atlas" every time.
 *   2. loadedCar.js's wheel rig matches a mesh whose NAME contains "wheel" plus one of
 *      frontleft/frontright/rearleft/rearright (or the "front"/else fallback — see the BackWheels
 *      note below). This model's wheel nodes are `FrontWheel_R` / `FrontWheel_L` / `BackWheels` —
 *      no "left" or "right" substring on the front pair — so as shipped it has no steering wheels.
 *
 * THE TEMPLATE: tools/synty-car.mjs solves the identical shaped problem for Synty packs, and its
 * GLB reader (`readGlb`/`readAccessor`), its PNG decoder (`readPng`), its `toLinear`, and its
 * buffer-view/accessor emission (`view()`) are copied into this file near-verbatim below — there is
 * nothing Synty-specific in any of those four, they are just "read a GLB" and "read a PNG". Three
 * things differ, all forced by how this specific source file is built, not by taste:
 *
 *   (a) THE ATLAS IS EMBEDDED, NOT A SEPARATE ARGUMENT. synty-car.mjs takes its atlas as a `.png`
 *       CLI argument because the Synty pipeline (FBX2glTF on a Synty FBX) emits the texture as a
 *       loose file. This model's atlas is baked INTO the GLB itself: `gltf.images[0]` points at
 *       `bufferView 0`, `mimeType: "image/png"`, 3 524 bytes, first bytes `89 50 4E 47` — a real PNG
 *       signature, verified by reading the bytes directly, not by trusting the mimeType field. So
 *       there is no JPEG fallback in this file: the one thing that would have needed it (a JPEG
 *       decoder this codebase doesn't have) was checked first and ruled out. If a future re-run of
 *       this tool against a different Quaternius model finds a non-PNG image, `readPng`'s own magic-
 *       byte check throws immediately rather than silently misreading the bytes.
 *
 *   (b) THE NODES CARRY A REAL ROTATION, SO IT HAS TO BE BAKED. synty-car.mjs bakes only translation
 *       and scale into vertex positions (`P[i]*s[0]+t[0]`, no rotation term) because its Synty inputs
 *       apparently never needed one. This file's four nodes (`Pickup_Armored`, `BackWheels`,
 *       `FrontWheel_R`, `FrontWheel_L`) all carry the IDENTICAL quaternion
 *       `[-0.707106828689575, 0, 0, 0.707106709480286]` with scale `[100,100,100]` — FBX2glTF's
 *       standard Z-up-to-Y-up correction. Measured by hand (see `applyQuat` below): this quaternion
 *       turns `(0,0,1)` into `(0,1,0)` and `(0,1,0)` into `(0,0,-1)`, i.e. exactly a -90° turn about
 *       X. Copying synty-car.mjs's translate+scale-only baking here would silently drop that
 *       rotation and load the truck lying on its back. So `bakeVerts()` below applies the full
 *       TRS (positions: scale, then rotate, then translate; normals: rotate only — the scale is
 *       uniform, so a bare rotation keeps them unit length with no inverse-transpose needed).
 *
 *   (c) THE ATLAS IS SAMPLED TO CLASSIFY, NOT TO BAKE A FROZEN COLOUR. synty-car.mjs samples its
 *       atlas once per vertex and writes the sRGB-converted-to-linear result straight into a COLOR_0
 *       attribute, because a Synty body is ALWAYS one lump with no separable materials at all — the
 *       only way to keep its painted detail is to freeze it. car/loadedCar.js then reads that frozen
 *       colour INSTEAD of the player's paint (`baked = mat === MAT.BODY ? g.attributes.color : null`
 *       — see that file). Doing the same here would make the Rally's body permanently
 *       Quaternius-tan, never the player's chosen colour, which is not "the paintable body" the
 *       operator's own fleet convention promises (every other Quaternius car — coupe, estate, hatch,
 *       pickup, ... — is a plain box with NO vertex colour, so it always renders in whatever paint
 *       the player picked). So this file uses the atlas sample only to decide which of White / Grey
 *       / Black a triangle belongs to (see "THE BUCKET SPLIT" below), then discards the sample. No
 *       COLOR_0 is ever written, and — like synty-car.mjs — no TEXCOORD_0 or image survives into the
 *       output either; both are build-time-only inputs.
 *
 * THE BACKWHEELS NODE — checked against loadedCar.js before deciding, per the operator's own
 * instruction to look rather than assume. `BackWheels` is ONE mesh holding both rear wheels (2 210
 * vertices, one primitive, one material). loadedCar.js's corner matcher
 * (`n.includes('frontleft') ? 'fl' : ... : n.includes('rearright') ? 'rr' : n.includes('front') ?
 * 'f' : 'r'`) buckets any wheel-named mesh that is not frontleft/frontright/rearleft/rearright/front
 * into the generic rear key `'r'` — so "backwheels" (it contains "wheel", it contains none of the
 * side words) lands there as a SINGLE corner, exactly like every other Quaternius car in this fleet
 * already does: coupe/estate/hatch/patrol/sedan/taxi/the old rally-sportscar-backup.glb all ship one
 * `*_BackWheels_*` mesh (confirmed by reading their own GLB JSON, not assumed). That corner's pivot
 * is `box.getCenter()` of the union of every mesh at that key, and `setWheelSpin` only ever writes
 * `spin.rotation.x` — a rotation about X mixes Y and Z and leaves X completely alone. So the pivot's
 * X (near the vehicle centreline, for a union of a left and a right wheel) never enters the spin math
 * at all, and the pivot's Y/Z is exactly the shared axle height and depth PROVIDED both wheels are
 * the same radius on the same level axle — which a union bounding box of two mirror-symmetric
 * cylinders reproduces exactly, not approximately (each wheel's own Y/Z extent is
 * `[axleY-r, axleY+r] x [axleZ-r, axleZ+r]`; the union of two identical such boxes is the same box).
 * One combined `BackWheels` mesh is therefore not a compromise, it is the shape this rig was already
 * built to expect. It is renamed straight across with no split, same as the front wheels.
 *
 * THE BUCKET SPLIT — turning one "Atlas" primitive back into separated materials. Sampled every
 * body vertex's atlas texel (nearest-neighbour, matching synty-car.mjs's own sampling — this is a
 * 512x512 atlas but only 82 distinct colours exist in it and only 14 of those are ever sampled by
 * the body mesh, because Quaternius/low-poly atlases are flat colour blocks, not painted gradients or
 * photographic detail), converted each to LINEAR colour via `toLinear` (not raw sRGB bytes — the
 * SAME reasoning car/loadedCar.js's own header gives for why this game works in linear: an sRGB
 * byte's brightness is not linear in the byte value, so a threshold picked against raw bytes would
 * be measuring the wrong thing), then classified by linear luma (Rec. 709 weights, matching
 * loadedCar.js's own use of the concept) and linear HSV-style saturation `(max-min)/max`:
 *
 *     if saturation < 0.25:  Black if luma < 0.18, else Grey   (a near-neutral texel: trim/metal)
 *     else:                  White                              (a real hue: paintable bodywork)
 *
 * Saturation is checked FIRST, not luma, because the alternative — splitting purely on darkness —
 * would cut a single continuous painted panel into black and white patches wherever the artist baked
 * a shadow into the tan paint (measured: texel rgb(90,75,62), a shaded tan, linear luma 0.076 —
 * darker than the plain grey rgb(88,88,88) at 0.098 — but saturation 0.53, clearly still "coloured",
 * not "neutral trim"). Any texel with real hue stays White/paintable regardless of how dark the
 * shading baked it; only genuinely achromatic texels are further split into Black/Grey by lightness.
 * Both thresholds sit in wide, clean gaps in the measured data (nothing sampled has saturation
 * between 0.148 and 0.529, or — among the achromatic texels — luma between 0.107 and 0.245), so
 * their exact position within those gaps does not change the result for this model. The resulting
 * split of the body's 11 386 vertices: Black 3 980 (35.0%), Grey 1 449 (12.7%), White 5 957 (52.3%) —
 * full numbers in this script's own console output. A triangle (not a single vertex) is what actually
 * needs one material, so each triangle takes the MAJORITY bucket of its three vertices, tie-broken on
 * its first vertex — moot in practice, since nearest-neighbour sampling of a flat-colour atlas means
 * a triangle's three corners almost always land on the same texel to begin with.
 *
 * THE RENAME MAP, all of it:
 *   *frontwheel_l*  ->  FrontLeftWheel   + material Black  (unconditional — no bucket split)
 *   *frontwheel_r*  ->  FrontRightWheel  + material Black  (unconditional — no bucket split)
 *   *backwheels*    ->  BackWheels       + material Black  (unconditional — see the note above)
 *   Headlights material (already separated in the source) -> preserved as Headlights, unsampled
 *   everything else (the `Atlas` body primitive) -> Body, bucket-split into White / Grey / Black
 *
 * THE SOURCE FILE lives at tools/sources/quaternius-pickup-armored.glb, checked into this repo
 * (unlike synty-car.mjs's Synty inputs) because there is nothing to protect: this asset is CC0, so
 * keeping the original download alongside the tool that converts it costs nothing and means this
 * script is re-runnable from a clean checkout with no external fetch — the opposite of
 * synty-car.mjs's Synty sources, which stay OUT of any repo because Synty's EULA forbids
 * redistributing them as assets (see that file's header).
 *
 *   node tools/quaternius-car.mjs [in.glb] [out.glb]
 *   (defaults: tools/sources/quaternius-pickup-armored.glb -> public/models/cars/rally.glb)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const IN = process.argv[2] || 'tools/sources/quaternius-pickup-armored.glb';
const OUT = process.argv[3] || 'public/models/cars/rally.glb';

/* ── GLB / glTF reading — copied from tools/synty-car.mjs verbatim; reading a GLB container and
 * walking its accessors has nothing Synty-specific about it. ────────────────────────────────── */
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

/** Minimal PNG decoder, copied from tools/synty-car.mjs verbatim. Confirmed against this file's own
 *  embedded image before use (see header) rather than assumed — `readGlb`'s caller below re-checks
 *  the magic bytes anyway, so a future non-PNG source fails loudly instead of decoding garbage. */
function readPng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png (bad magic bytes) — this model’s embedded image is not the PNG this tool was built against; it needs a decoder for whatever format it actually is (see this file’s header, part (a))');
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      ct = d[9];
    } else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const ch = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prv = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prv ? prv[i] : 0;
      const c = prv && i >= ch ? prv[i - ch] : 0;
      let v = src[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
  }
  return { w, h, ch, px };
}

/** sRGB byte -> linear, copied from tools/synty-car.mjs verbatim — the same conversion
 *  core/palette.js uses, because the classification thresholds below need to measure brightness the
 *  way the painted shader (and the eye, roughly) actually see it, not the way an sRGB byte counts. */
const toLinear = (v) => {
  const f = v / 255;
  return f <= 0.04045 ? f / 12.92 : Math.pow((f + 0.055) / 1.055, 2.4);
};

/** Rotate a [x,y,z] vector by a glTF quaternion [x,y,z,w]. Standard quaternion-vector rotation
 *  (`v + 2*qw*(q.xyz x v) + 2*(q.xyz x (q.xyz x v))`, expanded into the cross-product-free form
 *  below). Verified by hand against THIS file's own node rotation — see the header's part (b):
 *  applyQuat([0,0,1], Q) must come out (0,1,0), and applyQuat([0,1,0], Q) must come out (0,0,-1). */
function applyQuat([x, y, z], [qx, qy, qz, qw]) {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
}

/** Bake a node's full TRS into a flat position/normal array. Scale then rotate then translate for
 *  positions (standard T*R*S order); rotate only for normals — this file's nodes all carry a UNIFORM
 *  scale (100,100,100, checked in the source JSON), so a bare rotation keeps a unit normal unit
 *  length with no inverse-transpose needed. Positions and normals share nothing else with
 *  synty-car.mjs's baking, which only ever had translation and scale to apply (see header, part b). */
function bakeVerts(P, N, node) {
  const t = node?.translation || [0, 0, 0];
  const q = node?.rotation || [0, 0, 0, 1];
  const s = node?.scale || [1, 1, 1];
  const pos = new Float32Array(P.length);
  const nrm = new Float32Array(N.length);
  for (let i = 0; i < P.length; i += 3) {
    const [rx, ry, rz] = applyQuat([P[i] * s[0], P[i + 1] * s[1], P[i + 2] * s[2]], q);
    pos[i] = rx + t[0];
    pos[i + 1] = ry + t[1];
    pos[i + 2] = rz + t[2];
    const [nx, ny, nz] = applyQuat([N[i], N[i + 1], N[i + 2]], q);
    nrm[i] = nx;
    nrm[i + 1] = ny;
    nrm[i + 2] = nz;
  }
  return { pos, nrm };
}

/** The whole node-rename mapping, in one place — see the header's "THE RENAME MAP". */
function rename(name) {
  const n = (name || '').toLowerCase();
  if (/frontwheel_l/.test(n)) return { kind: 'wheel', node: 'FrontLeftWheel' };
  if (/frontwheel_r/.test(n)) return { kind: 'wheel', node: 'FrontRightWheel' };
  if (/backwheels/.test(n)) return { kind: 'wheel', node: 'BackWheels' };
  return { kind: 'body', node: 'Body' };
}

/* ── classification thresholds for the body's Atlas primitive — see the header's "THE BUCKET
 * SPLIT" for the measured histogram that produced these two numbers and why saturation is checked
 * before lightness. Both constants sit in wide gaps in the real data, so this model's result would
 * be identical for any threshold pair drawn from the same gaps. ───────────────────────────────── */
const GREY_SATURATION = 0.25; // linear (max-min)/max below this: "no real hue", i.e. neutral trim
const DARK_LUMA = 0.18; // linear Rec.709 luma below this, AMONG the neutral texels only: Black not Grey

function classifyTexel(r, g, b) {
  const rl = toLinear(r);
  const gl = toLinear(g);
  const bl = toLinear(b);
  const L = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const mx = Math.max(rl, gl, bl);
  const mn = Math.min(rl, gl, bl);
  const S = mx === 0 ? 0 : (mx - mn) / mx;
  if (S < GREY_SATURATION) return L < DARK_LUMA ? 'Black' : 'Grey';
  return 'White';
}

/* ── GLB assembly — copied from tools/synty-car.mjs's buffer-view plumbing verbatim: a flat byte
 * arena (`chunks`/`off`), one bufferView per attribute, one accessor per bufferView. ─────────────── */
const MATERIALS = ['White', 'Grey', 'Black', 'Headlights'];
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

/** Build one output primitive from a subset of a (already-baked) vertex buffer, given a flat list of
 *  triangle-vertex indices into that buffer (NOT yet compacted — a bucket typically only uses a
 *  fraction of the source mesh's vertices). Re-indexes down to just what is referenced, the same
 *  "nothing unused ships" discipline synty-car.mjs applies to a whole primitive, just applied here
 *  to an arbitrary triangle subset so one source primitive can become up to three output ones. */
function buildPrimitive(pos, nrm, triIdx, matName) {
  const remap = new Map();
  const outIdx = [];
  for (const vi of triIdx) {
    let ni = remap.get(vi);
    if (ni === undefined) {
      ni = remap.size;
      remap.set(vi, ni);
    }
    outIdx.push(ni);
  }
  const count = remap.size;
  const outPos = new Float32Array(count * 3);
  const outNrm = new Float32Array(count * 3);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const [vi, ni] of remap) {
    for (let k = 0; k < 3; k++) {
      const p = pos[vi * 3 + k];
      outPos[ni * 3 + k] = p;
      outNrm[ni * 3 + k] = nrm[vi * 3 + k];
      mn[k] = Math.min(mn[k], p);
      mx[k] = Math.max(mx[k], p);
    }
  }
  const idx = count > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx);
  const vp = view(outPos, 34962);
  const vn = view(outNrm, 34962);
  const vi_ = view(idx, 34963);
  accessors.push({ bufferView: vp, componentType: 5126, count, type: 'VEC3', min: mn, max: mx });
  accessors.push({ bufferView: vn, componentType: 5126, count, type: 'VEC3' });
  accessors.push({ bufferView: vi_, componentType: idx instanceof Uint32Array ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
  return {
    attributes: { POSITION: accessors.length - 3, NORMAL: accessors.length - 2 },
    indices: accessors.length - 1,
    material: MATERIALS.indexOf(matName),
  };
}

/* ── read the source, find its embedded atlas ──────────────────────────────────────────────────── */
const { gltf, bin } = readGlb(readFileSync(IN));
const img = gltf.images && gltf.images[0];
if (!img || img.bufferView === undefined) throw new Error('no embedded image found in ' + IN);
const imgBv = gltf.bufferViews[img.bufferView];
const imgBytes = bin.subarray(imgBv.byteOffset || 0, (imgBv.byteOffset || 0) + imgBv.byteLength);
const atlas = readPng(imgBytes); // throws plainly if this is ever not a PNG — see readPng's header note

const nodeOf = new Map();
(gltf.nodes || []).forEach((n) => {
  if (n.mesh !== undefined) nodeOf.set(n.mesh, n);
});

/* ── walk every mesh/primitive, bake, rename, and (for the body) bucket-split ──────────────────── */
const meshesOut = [];
const bucketCounts = { Black: 0, Grey: 0, White: 0 };
let bodyVertexTotal = 0;

(gltf.meshes || []).forEach((m, mi) => {
  const node = nodeOf.get(mi);
  const label = rename(node?.name || m.name);

  for (const prim of m.primitives) {
    const P = readAccessor(gltf, bin, prim.attributes.POSITION);
    const N = readAccessor(gltf, bin, prim.attributes.NORMAL);
    const I = prim.indices !== undefined ? readAccessor(gltf, bin, prim.indices) : P.map((_, i) => i / 3);
    const { pos, nrm } = bakeVerts(P, N, node);
    const srcMatName = (gltf.materials[prim.material] && gltf.materials[prim.material].name) || '';

    // The Headlights material is already separated in the source — preserve it untouched, on
    // whichever node it happens to live on (only the Body node carries one, but nothing here
    // assumes that).
    if (/headlight/i.test(srcMatName)) {
      meshesOut.push({ name: `${label.node}_Headlights`, primitive: buildPrimitive(pos, nrm, I, 'Headlights') });
      continue;
    }

    // Wheel nodes go straight to Black, unconditionally — see the header's "THE RENAME MAP". No
    // atlas sampling needed or done for these.
    if (label.kind === 'wheel') {
      meshesOut.push({ name: label.node, primitive: buildPrimitive(pos, nrm, I, 'Black') });
      continue;
    }

    // The body's Atlas primitive: sample every vertex, classify it, then let each TRIANGLE take
    // the majority classification of its three corners (tie-broken on the first corner — see the
    // header's "THE BUCKET SPLIT" for why ties are vanishingly rare here).
    const UV = readAccessor(gltf, bin, prim.attributes.TEXCOORD_0);
    const vCount = P.length / 3;
    bodyVertexTotal += vCount;
    const vBucket = new Array(vCount);
    for (let v = 0; v < vCount; v++) {
      const u = UV[v * 2];
      const vv = UV[v * 2 + 1];
      const ax = Math.min(atlas.w - 1, Math.max(0, Math.round(u * (atlas.w - 1))));
      // glTF UV origin is top-left; a PNG's rows run the same way, so no flip is needed — same
      // note synty-car.mjs makes at its own sampling site.
      const ay = Math.min(atlas.h - 1, Math.max(0, Math.round(vv * (atlas.h - 1))));
      const o = (ay * atlas.w + ax) * atlas.ch;
      const bucket = classifyTexel(atlas.px[o], atlas.px[o + 1], atlas.px[o + 2]);
      vBucket[v] = bucket;
      bucketCounts[bucket]++;
    }
    const triLists = { Black: [], Grey: [], White: [] };
    for (let t = 0; t < I.length; t += 3) {
      const i0 = I[t];
      const i1 = I[t + 1];
      const i2 = I[t + 2];
      const b0 = vBucket[i0];
      const b1 = vBucket[i1];
      const b2 = vBucket[i2];
      const bucket = b0 === b1 || b0 === b2 ? b0 : b1 === b2 ? b1 : b0;
      triLists[bucket].push(i0, i1, i2);
    }
    for (const bucket of ['White', 'Grey', 'Black']) {
      if (triLists[bucket].length) meshesOut.push({ name: `Body_${bucket}`, primitive: buildPrimitive(pos, nrm, triLists[bucket], bucket) });
    }
  }
});

/* ── pack it into a GLB — copied from tools/synty-car.mjs's tail verbatim; nothing about turning a
 * mesh list into a GLB container is specific to what the meshes are. ─────────────────────────────── */
const out = {
  asset: { version: '2.0', generator: 'wanderoad tools/quaternius-car.mjs' },
  scene: 0,
  scenes: [{ nodes: meshesOut.map((_, i) => i) }],
  nodes: meshesOut.map((m, i) => ({ name: m.name, mesh: i })),
  meshes: meshesOut.map((m) => ({ name: m.name, primitives: [m.primitive] })),
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

console.log(
  JSON.stringify({
    in: IN,
    out: OUT,
    bytes: total,
    meshes: meshesOut.length,
    names: meshesOut.map((m) => m.name),
    bodyVertexTotal,
    bucketCounts,
    bucketPct: Object.fromEntries(Object.entries(bucketCounts).map(([k, v]) => [k, ((100 * v) / bodyVertexTotal).toFixed(1) + '%'])),
    atlas: { w: atlas.w, h: atlas.h, channels: atlas.ch },
  })
);
