/* Wanderoad — trees.
 *
 * Ported from the Hoshi-no-Tani pen, §8 TREES (hoshi.html:2627-2984). The mesh builders and
 * both shaders are the pen's, because the three things that make these read as PAINTED
 * rather than modelled are all in there and all easy to lose:
 *
 *   - the `flx` attribute, which separates trunk from canopy so the trunk bends as a mast
 *     and the leaves flutter around their own clump centre;
 *   - the `hue` attribute, which gives every clump one of four greens so a canopy is a
 *     mosaic and not a single flat mass;
 *   - `trans` in the fragment shader, which lights the leaf from BEHIND. Backlit foliage is
 *     the single strongest Ghibli cue in the whole frame.
 *
 * Canopies are clusters of scalloped icosphere clumps, never leaf cards: Ghibli foliage is
 * sculpted mass. Trunks are generalised cylinders swept along a curve.
 *
 * The pen had four species for one valley. This has eight, because the world has five
 * biomes: broadleaf, poplar, pine, willow (the pen's), plus deadpine, acacia, scrub and palm
 * built the same way — silhouette first, three colour stops from the shared palette, an ICO
 * clump skeleton.
 */

import {
  BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  RawShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { vertHead, fragHead, GL_HASH, GL_NOISE, GL_SHADOW, GL_LIGHT, glCloudField, DEPTH_FS } from '../core/glsl.js';
import { C, biomeTintArrays } from '../core/palette.js';
import { U, sharedUniforms } from './uniforms.js';
import { TAU, clamp, lerp, hash2i, rng } from '../core/math.js';
import { noise2 } from '../core/noise.js';
import { scatterChunk, scatterBudget, SCATTER_MAX_LEVEL } from '../world/scatter.js';
import { Flowers } from './flowers.js';

/* ── the shared block does not own the wind yet ──────────────────────────────
 * `GL_UNI` has uWindTex / uWindOrigin but no mean-wind vector and no render-target span,
 * because the wind simulation is its own module and lands separately. Both are published
 * INTO the shared `U` rather than cloned into a private uniform object, so when that module
 * arrives it writes these same two entries and the trees start swaying to the simulated
 * field with no wiring at all. uWindSpan of 0 means "no render target yet, use the analytic
 * field everywhere", which is what makes the trees move on frame one. */
if (!U.uMeanWind) U.uMeanWind = { value: new Vector2(3.0, 1.0) }; // hoshi.html:5016
if (!U.uWindSpan) U.uWindSpan = { value: 0 };

/* Must match whatever renders the cloud-shadow map into uCloudSh. render/terrainMaterial.js
 * uses 9200 m; a tree lit by a different cloud than the grass it stands in is very visible. */
const CLOUD_SHADOW_SPAN = 9200;

/* ── mesh buffer ─────────────────────────────────────────────────────────────
 * Five parallel attribute streams. `clm` is the clump centre a vertex belongs to (the
 * flutter pivot), `flx` how freely it moves, `hue` which green it takes. */
const MeshBuf = () => ({ pos: [], nrm: [], clm: [], flx: [], hue: [], idx: [], n: 0 });

function pushVert(M, x, y, z, nx, ny, nz, cx, cy, cz, flex, hue) {
  M.pos.push(x, y, z);
  M.nrm.push(nx, ny, nz);
  M.clm.push(cx, cy, cz);
  M.flx.push(flex);
  M.hue.push(hue);
  return M.n++;
}

function finishMesh(M) {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(M.pos), 3));
  g.setAttribute('nrm', new BufferAttribute(new Float32Array(M.nrm), 3));
  g.setAttribute('clm', new BufferAttribute(new Float32Array(M.clm), 3));
  g.setAttribute('flx', new BufferAttribute(new Float32Array(M.flx), 1));
  g.setAttribute('hue', new BufferAttribute(new Float32Array(M.hue), 1));
  const Index = M.n > 65535 ? Uint32Array : Uint16Array;
  g.setIndex(new BufferAttribute(new Index(M.idx), 1));
  return g;
}

/** Swept tapered tube along a polyline — every trunk and branch in the file. */
function addTube(M, pts, radii, seg, hueV) {
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let t;
    if (i === 0) t = [pts[1][0] - p[0], pts[1][1] - p[1], pts[1][2] - p[2]];
    else if (i === pts.length - 1) t = [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]];
    else t = [pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1], pts[i + 1][2] - pts[i - 1][2]];
    const L = Math.hypot(t[0], t[1], t[2]) || 1;
    t = [t[0] / L, t[1] / L, t[2] / L];
    let up = [0, 1, 0];
    if (Math.abs(t[1]) > 0.94) up = [1, 0, 0];
    let s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
    const sl = Math.hypot(s[0], s[1], s[2]) || 1;
    s = [s[0] / sl, s[1] / sl, s[2] / sl];
    const u = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]];
    const ring = [];
    // Flex rises along the tube: the base of a trunk is anchored, the tip is a whip.
    const flex = Math.pow(clamp(i / (pts.length - 1), 0, 1), 1.6) * 0.55;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      // Two harmonics of out-of-round so a trunk is never a lathe turning.
      const wob = 1 + Math.sin(a * 3 + i) * 0.09 + Math.cos(a * 5 - i * 0.7) * 0.05;
      const r = radii[i] * wob;
      const nx = s[0] * ca + u[0] * sa,
        ny = s[1] * ca + u[1] * sa,
        nz = s[2] * ca + u[2] * sa;
      ring.push(pushVert(M, p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, p[0], p[1], p[2], flex, hueV));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = rings[i][j],
        b = rings[i][(j + 1) % seg],
        c = rings[i + 1][j],
        d = rings[i + 1][(j + 1) % seg];
      M.idx.push(a, c, b, b, c, d);
    }
  }
}

/* Three levels of icosphere, subdivided once each. 12 / 42 / 162 vertices — the LOD ladder
 * for every canopy in the game. */
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l];
  });
  const f = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
    [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5],
    [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const sub = (vv, ff) => {
    const nf = [];
    const cache = {};
    const mid = (a, b) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache[k] !== undefined) return cache[k];
      const p = [(vv[a][0] + vv[b][0]) / 2, (vv[a][1] + vv[b][1]) / 2, (vv[a][2] + vv[b][2]) / 2];
      const l = Math.hypot(p[0], p[1], p[2]);
      vv.push([p[0] / l, p[1] / l, p[2] / l]);
      cache[k] = vv.length - 1;
      return cache[k];
    };
    for (const tri of ff) {
      const a = mid(tri[0], tri[1]),
        b = mid(tri[1], tri[2]),
        c = mid(tri[2], tri[0]);
      nf.push([tri[0], a, c], [tri[1], b, a], [tri[2], c, b], [a, b, c]);
    }
    return nf;
  };
  const L1 = { v: v.map((a) => a.slice()), f: f.map((a) => a.slice()) };
  L1.f = sub(L1.v, L1.f);
  const L2 = { v: L1.v.map((a) => a.slice()), f: L1.f.map((a) => a.slice()) };
  L2.f = sub(L2.v, L2.f);
  return { L0: { v, f }, L1, L2 };
})();

/** One scalloped canopy clump: an icosphere pushed around by noise into cauliflower lobes. */
function addClump(M, cx, cy, cz, rx, ry, rz, seed, hueV, detail) {
  const src = detail >= 2 ? ICO.L2 : detail >= 1 ? ICO.L1 : ICO.L0;
  const base = M.n;
  const r = rng((seed * 7919) | 0);
  const ph = [r() * 10, r() * 10, r() * 10];
  for (const p of src.v) {
    const d =
      1 +
      0.2 * Math.sin(p[0] * 4.1 + ph[0]) * Math.sin(p[1] * 3.7 + ph[1]) +
      0.14 * Math.sin(p[2] * 6.3 + ph[2]) * Math.cos(p[0] * 5.1 + ph[1]) +
      0.09 * noise2(p[0] * 3.4 + ph[0], p[2] * 3.4 + ph[2]);
    // The normal stays the undisplaced sphere normal: a lobe should read as a soft round
    // mass, not as a faceted rock. The pen's choice, and it is doing a lot of work.
    pushVert(M, cx + p[0] * rx * d, cy + p[1] * ry * d, cz + p[2] * rz * d, p[0], p[1], p[2], cx, cy, cz, 1.0, hueV);
  }
  for (const face of src.f) M.idx.push(base + face[0], base + face[1], base + face[2]);
}

/* ── species ─────────────────────────────────────────────────────────────────
 * `h` is the nominal archetype height and goes to the shader as uTreeH: the wind bend is
 * normalised by it, so it has to match the mesh or a poplar sways like a bush. `flex` is
 * stiffness — a willow is nearly four times looser than a snag. */
export const TREE_ARCH = {
  broadleaf: { h: 11.5, flex: 1.0 },
  poplar: { h: 15.0, flex: 0.8 },
  pine: { h: 14.5, flex: 0.52 },
  deadpine: { h: 13.0, flex: 0.26 },
  acacia: { h: 9.5, flex: 0.9 },
  scrub: { h: 2.5, flex: 1.25 },
  palm: { h: 12.5, flex: 1.6 },
  willow: { h: 9.5, flex: 1.75 },
};

const KIND_ORDER = Object.keys(TREE_ARCH);

/**
 * Build one species archetype. `detail` 0..2 is the LOD: it drives trunk segments, clump
 * count and clump subdivision together, because dropping any one of them alone changes the
 * silhouette rather than just the cost.
 */
export function makeTree(kind, detail, seed) {
  const M = MeshBuf();
  const r = rng(seed);
  const H =
    kind === 'poplar' ? 13 + r() * 5
    : kind === 'pine' ? 12 + r() * 6
    : kind === 'deadpine' ? 11 + r() * 5
    : kind === 'acacia' ? 8 + r() * 3.5
    : kind === 'palm' ? 10 + r() * 5
    : kind === 'scrub' ? 1.9 + r() * 1.3
    : kind === 'willow' ? 8 + r() * 3
    : 10 + r() * 4;
  const trunkSeg = detail >= 2 ? 8 : detail >= 1 ? 6 : 4;
  const clumpLod = Math.max(0, detail - 1);

  if (kind === 'pine') {
    const pts = [],
      rad = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      pts.push([Math.sin(u * 2.1) * 0.35 * u * H * 0.06, u * H, Math.cos(u * 1.7) * 0.3 * u * H * 0.06]);
      rad.push(lerp(H * 0.035, H * 0.006, u));
    }
    addTube(M, pts, rad, trunkSeg, 0.0);
    const tiers = detail >= 1 ? 6 : 4;
    for (let i = 0; i < tiers; i++) {
      const u = 0.3 + 0.68 * (i / (tiers - 1));
      const rr = (1 - u) * H * 0.3 + H * 0.05;
      // Flat discs stacked up the trunk: a conifer is a stack of skirts, not a cone.
      addClump(M, 0, u * H + H * 0.04, 0, rr, rr * 0.36, rr, seed + i * 13, 0.15 + r() * 0.7, clumpLod);
    }
  } else if (kind === 'poplar') {
    const pts = [],
      rad = [];
    for (let i = 0; i <= 7; i++) {
      const u = i / 7;
      pts.push([Math.sin(u * 3.0) * 0.5, u * H, Math.cos(u * 2.2) * 0.45]);
      rad.push(lerp(H * 0.028, H * 0.005, u));
    }
    addTube(M, pts, rad, trunkSeg, 0.0);
    const n = detail >= 1 ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const u = 0.2 + 0.78 * (i / (n - 1));
      const rr = H * (0.17 - 0.08 * Math.abs(u - 0.55) * 1.4);
      addClump(M, Math.sin(u * 7) * 0.5, u * H, Math.cos(u * 6) * 0.45, rr * 0.9, rr * 1.35, rr * 0.9,
        seed + i * 29, 0.2 + r() * 0.7, clumpLod);
    }
  } else if (kind === 'willow') {
    const pts = [],
      rad = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      pts.push([u * u * 1.7, u * H * 0.72, Math.sin(u * 2) * 0.6]);
      rad.push(lerp(H * 0.05, H * 0.012, u));
    }
    addTube(M, pts, rad, trunkSeg, 0.0);
    const n = detail >= 1 ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU,
        rr0 = Math.sqrt(r()) * H * 0.42;
      const cx = Math.cos(a) * rr0 + 1.5,
        cz = Math.sin(a) * rr0;
      const cy = H * 0.62 + (r() - 0.3) * H * 0.22;
      const rr = H * (0.13 + r() * 0.09);
      addClump(M, cx, cy, cz, rr * 1.15, rr * 0.8, rr * 1.15, seed + i * 37, 0.5 + r() * 0.5, clumpLod);
      // trailing curtain
      if (detail >= 1) {
        addClump(M, cx * 1.05, cy - rr * 1.5, cz * 1.05, rr * 0.55, rr * 1.5, rr * 0.55,
          seed + i * 41, 0.6 + r() * 0.4, clumpLod);
      }
    }
  } else if (kind === 'deadpine') {
    // A standing snag: the highland's punctuation mark. Everything is silhouette — a bare
    // forked trunk, broken limbs at rising angles, and two thin rags of dead needles. It is
    // mostly trunk on purpose, so the fragment shader's bark-and-moss path draws it.
    const pts = [],
      rad = [];
    const lean = (r() - 0.5) * 0.9;
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      pts.push([lean * u * u * H * 0.1, u * H, Math.sin(u * 2.7) * 0.4]);
      // The top is SNAPPED, not tapered to a point: the radius still has substance at u=1.
      rad.push(lerp(H * 0.032, H * 0.012, Math.pow(u, 0.75)));
    }
    addTube(M, pts, rad, trunkSeg, 0.0);
    const stubs = detail >= 2 ? 7 : detail >= 1 ? 5 : 3;
    for (let i = 0; i < stubs; i++) {
      const u = 0.34 + 0.58 * (i / Math.max(1, stubs - 1));
      const a = i * 2.399 + r() * 0.6; // golden-angle spiral, the way limbs actually sit
      const bl = H * (0.3 - 0.16 * u) * (0.7 + r() * 0.6);
      const bp = [],
        br = [];
      for (let j = 0; j <= 2; j++) {
        const t = j / 2;
        bp.push([Math.cos(a) * bl * t, u * H + t * bl * 0.42 - t * t * bl * 0.5, Math.sin(a) * bl * t]);
        br.push(lerp(H * 0.012, H * 0.003, t));
      }
      addTube(M, bp, br, Math.max(3, trunkSeg - 3), 0.0);
    }
    if (detail >= 1) {
      for (let i = 0; i < 2; i++) {
        const a = r() * TAU;
        const rr = H * (0.09 + r() * 0.05);
        addClump(M, Math.cos(a) * H * 0.1, H * (0.68 + i * 0.16), Math.sin(a) * H * 0.1,
          rr, rr * 0.22, rr, seed + i * 61, r() * 0.25, clumpLod);
      }
    }
  } else if (kind === 'acacia') {
    // The steppe umbrella. Bare below, then everything happens in one flat plate at the top
    // — the whole read is the horizontal line of the canopy against a huge sky.
    const pts = [],
      rad = [];
    const lean = (r() - 0.5) * 0.4;
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      pts.push([lean * u * u * H * 0.2, u * H * 0.6, Math.cos(u * 2.1) * 0.3]);
      rad.push(lerp(H * 0.055, H * 0.02, u));
    }
    addTube(M, pts, rad, trunkSeg, 0.0);
    const nb = detail >= 1 ? 5 : 3;
    const CR = H * 0.52;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * TAU + r() * 0.8;
      const bl = CR * (0.72 + r() * 0.3);
      const bp = [],
        br = [];
      for (let j = 0; j <= 3; j++) {
        const t = j / 3;
        // Branches climb steeply then flatten out — that elbow is the acacia's signature.
        bp.push([Math.cos(a) * bl * t, H * 0.58 + Math.pow(t, 0.55) * H * 0.3, Math.sin(a) * bl * t]);
        br.push(lerp(H * 0.02, H * 0.005, t));
      }
      addTube(M, bp, br, Math.max(3, trunkSeg - 2), 0.0);
    }
    const n = detail >= 2 ? 16 : detail >= 1 ? 10 : 5;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU;
      const dd = Math.pow(r(), 0.42) * CR;
      const rr = CR * (0.2 + r() * 0.16) * (1 - dd / CR * 0.35);
      addClump(M, Math.cos(a) * dd, H * 0.9 - dd * 0.1 + (r() - 0.5) * H * 0.05, Math.sin(a) * dd,
        rr * 1.25, rr * 0.34, rr * 1.25, seed + i * 71, r(), clumpLod);
    }
  } else if (kind === 'scrub') {
    // Multi-stem bush. Three stems from one root, one squashed dome of foliage. Also what
    // every 'bushes' record in the scatter renders as.
    const stems = detail >= 1 ? 3 : 2;
    for (let i = 0; i < stems; i++) {
      const a = (i / stems) * TAU + r() * 1.1;
      const pts = [],
        rad = [];
      for (let j = 0; j <= 3; j++) {
        const u = j / 3;
        pts.push([Math.cos(a) * u * H * 0.22, u * H * 0.55, Math.sin(a) * u * H * 0.22]);
        rad.push(lerp(H * 0.05, H * 0.018, u));
      }
      addTube(M, pts, rad, Math.max(3, trunkSeg - 2), 0.0);
    }
    const n = detail >= 2 ? 9 : detail >= 1 ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU;
      const dd = Math.pow(r(), 0.6) * H * 0.42;
      const rr = H * (0.24 + r() * 0.16);
      addClump(M, Math.cos(a) * dd, H * 0.52 + (r() - 0.35) * H * 0.24, Math.sin(a) * dd,
        rr * 1.1, rr * 0.78, rr * 1.1, seed + i * 83, r(), clumpLod);
    }
  } else if (kind === 'palm') {
    // Dune palm. The trunk barely tapers and curves the whole way; the crown is a ring of
    // fronds, each one a short chain of flattened clumps that rises and then droops. Three
    // clumps is enough for a frond to read as a frond and cheap enough to afford nine.
    const pts = [],
      rad = [];
    const bend = 0.9 + r() * 1.4;
    const face = r() * TAU;
    for (let i = 0; i <= 7; i++) {
      const u = i / 7;
      const off = bend * u * u;
      pts.push([Math.cos(face) * off, u * H, Math.sin(face) * off]);
      rad.push(lerp(H * 0.026, H * 0.016, u));
    }
    addTube(M, pts, rad, trunkSeg, 0.0);
    const tipX = Math.cos(face) * bend,
      tipZ = Math.sin(face) * bend;
    const nf = detail >= 2 ? 9 : detail >= 1 ? 7 : 5;
    const L = H * 0.44;
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * TAU + r() * 0.35;
      const droop = 0.8 + r() * 0.6;
      for (let j = 1; j <= 3; j++) {
        const t = j / 3;
        const rad2 = L * t;
        const rr = L * (0.19 - 0.075 * t);
        addClump(M,
          tipX + Math.cos(a) * rad2,
          H + L * (0.26 * t - 0.62 * t * t * droop),
          tipZ + Math.sin(a) * rad2,
          rr * 1.15, rr * 0.3, rr * 1.15,
          seed + i * 97 + j * 7, 0.25 + r() * 0.6, clumpLod);
      }
    }
    // the tight crown of new growth at the very top
    addClump(M, tipX, H + L * 0.06, tipZ, L * 0.22, L * 0.2, L * 0.22, seed + 991, 0.3 + r() * 0.3, clumpLod);
  } else {
    // broadleaf: the camphor / oak silhouette
    const pts = [],
      rad = [];
    const lean = (r() - 0.5) * 0.5;
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      pts.push([lean * u * u * H * 0.14 + Math.sin(u * 3.4) * 0.35, u * H * 0.52, Math.cos(u * 2.6) * 0.35]);
      rad.push(lerp(H * 0.062, H * 0.026, u));
    }
    addTube(M, pts, rad, trunkSeg, 0.0);
    const nb = detail >= 2 ? 5 : detail >= 1 ? 4 : 0;
    for (let i = 0; i < nb; i++) {
      const a = (i / nb) * TAU + r() * 0.9;
      const bl = H * (0.26 + r() * 0.16);
      const bp = [],
        br = [];
      for (let j = 0; j <= 3; j++) {
        const u = j / 3;
        bp.push([Math.cos(a) * bl * u * 0.9, H * 0.5 + u * bl * 0.72 - u * u * bl * 0.12, Math.sin(a) * bl * u * 0.9]);
        br.push(lerp(H * 0.02, H * 0.006, u));
      }
      addTube(M, bp, br, Math.max(3, trunkSeg - 2), 0.0);
    }
    const n = detail >= 2 ? 22 : detail >= 1 ? 12 : 7;
    const CR = H * 0.4;
    for (let i = 0; i < n; i++) {
      let cx, cy, cz, rr;
      if (i === 0) {
        cx = 0;
        cy = H * 0.78;
        cz = 0;
        rr = CR * 0.72;
      } else {
        const a = r() * TAU,
          dd = Math.pow(r(), 0.55) * CR * 1.02;
        cx = Math.cos(a) * dd;
        cz = Math.sin(a) * dd * 0.92;
        cy = H * 0.74 + (r() - 0.44) * CR * 0.95 - dd * 0.2;
        rr = CR * (0.26 + r() * 0.26);
      }
      addClump(M, cx, cy, cz, rr * 1.12, rr * 0.86, rr * 1.12, seed + i * 53, r(), clumpLod);
    }
  }
  return M;
}

/* ── shaders ─────────────────────────────────────────────────────────────────
 * The wind field. GL_UNI owns uWindTex/uWindOrigin; the mean vector and the render-target
 * span are declared here (see the note at the top of the file). When there is no wind
 * render target the analytic travelling wave IS the field — that is the pen's own fallback
 * for the world outside the target, promoted to the default. */
const GL_WIND = /* glsl */ `
uniform vec2  uMeanWind;
uniform float uWindSpan;   // metres covered by uWindTex; 0 = no target, analytic only
float windBandAnalytic(vec2 p){
  vec2 q = p - uMeanWind * (uTime * 1.22);
  float a = fbm2(q * 0.0052, 3);
  float b = pn2(q * 0.0168 + 13.0);
  float c = pn2(q * 0.055  + 41.0);
  return clamp(a*1.30 + b*0.55 + c*0.22, -1.2, 1.4);
}
vec4 windAnalytic(vec2 p){
  float band = windBandAnalytic(p);
  float gust = clamp(0.80 + band*0.95, 0.05, 2.3);
  return vec4(uMeanWind*gust, gust, clamp(band, 0.0, 1.0)*0.85);
}
// Single exit on purpose. The obvious early-return version makes the HLSL backend emit
// "use of potentially uninitialized variable", and a driver that acts on that warning turns
// a tree into a black billboard. Both fast paths survive: inside the render target the
// simulated field IS the answer and the twenty-odd hashes of the analytic fallback are pure
// waste, outside it there is no texture to fetch. Every vertex of a tree samples the same
// iPos.xz, so the branch is perfectly coherent across a warp.
vec4 windSample(vec2 p){
  vec4 res;
  vec2 uv = (p - uWindOrigin) / max(uWindSpan, 1.0) + 0.5;
  float edge = (uWindSpan > 0.0)
    ? 1.0 - smoothstep(0.40, 0.498, max(abs(uv.x-0.5), abs(uv.y-0.5)))
    : 0.0;
  if(edge <= 0.001){
    res = windAnalytic(p);
  } else if(edge >= 0.999){
    res = texture(uWindTex, clamp(uv, vec2(0.003), vec2(0.997)));
  } else {
    res = mix(windAnalytic(p), texture(uWindTex, clamp(uv, vec2(0.003), vec2(0.997))), edge);
  }
  return res;
}
// logarithmic boundary layer, normalised to the 10 m reference height
float windProfile(float z){ return log((max(z,0.015) + 0.06) / 0.06) * 0.19523; }
`;

/** The per-biome foliage tint, as a GLSL constant array. Same table the ground reads. */
function glslFoliageTints() {
  const t = biomeTintArrays();
  const parts = [];
  for (let i = 0; i < t.count; i++) {
    parts.push(`vec3(${t.foliage[i * 3].toFixed(4)},${t.foliage[i * 3 + 1].toFixed(4)},${t.foliage[i * 3 + 2].toFixed(4)})`);
  }
  return /* glsl */ `
const int NFOL = ${t.count};
const vec3 B_FOLIAGE[${t.count}] = vec3[${t.count}](${parts.join(',')});
`;
}

const TREE_VS = /* glsl */ `
uniform float uTreeH;      // nominal archetype height
uniform float uFlex;       // archetype stiffness multiplier (willow >> snag)
uniform float uCullR;      // >0 : reject instances beyond this radius of the shadow centre
in vec3 nrm; in vec3 clm; in float flx; in float hue;
in vec4 iPos;              // xyz = root, w = scale
in vec4 iVar;              // rot, hueShift, phase, biome
out vec3 vW; out vec3 vN; out float vHue; out float vLeaf; out float vDist;
out float vY; out float vAO; out vec3 vTint;
void main(){
  // The sun shadow map covers a bounded square around the car, so a tree two kilometres
  // away cannot cast into it — yet without this every instance in the world would still be
  // transformed, swayed and rasterised into it. The depth material sets uCullR; the beauty
  // material leaves it 0.
  if(uCullR > 0.0 && distance(iPos.xz, uShadowC) > uCullR){
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
  }
  float sc = iPos.w;
  float rot = iVar.x, ph = iVar.z;
  float c = cos(rot), s = sin(rot);
  vec3 lp  = position * sc;
  vec3 ln  = nrm;
  vec3 lc  = clm * sc;
  vec3 rp  = vec3(lp.x*c - lp.z*s, lp.y, lp.x*s + lp.z*c);
  vec3 rn  = vec3(ln.x*c - ln.z*s, ln.y, ln.x*s + ln.z*c);
  vec3 rc  = vec3(lc.x*c - lc.z*s, lc.y, lc.x*s + lc.z*c);
  float H  = uTreeH * sc;

  vec4 W = windSample(iPos.xz);
  float prof = windProfile(max(H*0.62, 0.6));
  vec2 wv = W.rg * prof;
  float gust = W.b, exc = W.a;
  float spd = length(wv);

  vec2 bd = normalize(wv + vec2(1e-5));
  float yn = clamp(rp.y / max(H, 0.5), 0.0, 1.4);

  // trunk: static bend + a resonant mode near 0.5 Hz, mass-lagged behind the grass
  float f0  = 0.40 + 0.26*fract(ph*0.31831);
  float osc = sin(uTime*6.2831853*f0 + ph);
  float bend = (spd*0.052 + (exc*0.30 + max(gust-1.0,0.0)*0.55)*0.16*osc) * uFlex;
  bend = clamp(bend, -0.55, 0.75);
  vec3 p = rp;
  p.xz += bd * (bend * yn*yn * H * 0.42);
  p.y  -= bend*bend * yn*yn * H * 0.22;   // a bent mast is a shorter mast

  // clumps: a faster secondary sway, each with its own phase
  float cph = dot(rc.xz, vec2(0.61, 0.43)) + ph*2.7;
  float f1  = 0.70 + 0.42*fract(sin(cph)*137.51);
  float csw = sin(uTime*6.2831853*f1 + cph);
  vec3  cOff = vec3(bd.x, 0.15*csw, bd.y) * csw * (0.06 + 0.34*gust) * 0.34 * flx * sc;
  p += cOff;

  // leaves flutter around their clump centre
  vec3 rel = rp - rc;
  float rl = length(rel) + 1e-4;
  float flut = sin(uTime*5.1 + dot(rel, vec3(3.3,4.9,2.7)) + cph*1.7);
  p += (rel/rl) * flut * 0.045 * flx * sc * (0.35 + 0.8*gust);

  vec3 wp = iPos.xyz + p;
  vW = wp; vN = normalize(rn); vHue = fract(hue + iVar.y);
  vLeaf = step(0.9, flx); vY = clamp(rp.y/max(H,0.5), 0.0, 1.0);
  // Cheap vertical AO: the inside of a canopy and the foot of a trunk never see the sky.
  vAO = mix(0.62, 1.0, smoothstep(0.0, 0.55, vY));
  vTint = B_FOLIAGE[clamp(int(iVar.w + 0.5), 0, NFOL-1)];
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const TREE_FS = /* glsl */ `
in vec3 vW; in vec3 vN; in float vHue; in float vLeaf; in float vDist;
in float vY; in float vAO; in vec3 vTint;
out vec4 outColor;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  vec3 lit, mid, shd; float trans, rim;

  if(vLeaf > 0.5){
    // four-green canopy mosaic
    vec3 base = vHue<0.26 ? ${C.cVarA} : (vHue<0.52 ? ${C.cLit} :
                (vHue<0.76 ? ${C.cVarB} : ${C.cVarC}));
    float grain = pn2(vW.xz*0.85 + vW.y*0.6)*0.5+0.5;
    lit = mix(base, ${C.cLit}, 0.42) * (1.02 + 0.24*grain);
    mid = mix(${C.cMid}, base*0.72, 0.45);
    shd = mix(${C.cShade}, ${C.cDeep}, grain*0.45);
    // Biome foliage tint: the same table the ground blends, so a highland pine and the
    // hillside it stands on go cold together.
    lit *= vTint; mid *= vTint; shd *= vTint;
    trans = 1.05; rim = 0.52;
  } else {
    float bark = pn2(vec2(atan(N.z,N.x)*3.4, vW.y*3.1))*0.5+0.5;
    vec3 wood = mix(vec3(1.0), vTint, 0.55);
    lit = ${C.trunkLit} * (0.82 + 0.34*bark) * wood;
    mid = mix(${C.trunkLit}, ${C.trunkShade}, 0.55) * wood;
    shd = ${C.trunkShade} * (0.85 + 0.3*bark) * wood;
    trans = 0.0; rim = 0.28;
  }
  // moss on the shaded north side of trunks and the underside of clumps
  float moss = smoothstep(0.15, -0.5, N.y) * (pn2(vW.xz*1.6 + vW.y)*0.5+0.5);
  shd = mix(shd, ${C.moss}*0.55, moss*0.35*(1.0-vLeaf));

  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vW, ndl) * cloudShadow(vW);
  Surf s;
  s.N=N; s.V=V; s.P=vW; s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = mix(0.09, 0.20, clamp(vDist*0.004,0.0,1.0));
  s.jit = (vn2(vW.xz*3.9 + vW.y*1.7) - 0.5)*0.055;
  s.shadow = sh; s.trans = trans; s.transCol = ${C.cTrans};
  s.rim = rim; s.ao = vAO; s.ambient = 1.0;
  vec3 col = paint(s);
  col = aerial(col, vDist, V, vW.y);
  outColor = vec4(SAFE3(col), gFogAmt);
}`;

/** Beauty material for one species. */
function treeMaterial(kind) {
  const a = TREE_ARCH[kind];
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms({
      uTreeH: { value: a.h },
      uFlex: { value: a.flex },
      uCullR: { value: 0 },
    }),
    vertexShader: vertHead(GL_HASH, GL_NOISE, GL_WIND, glslFoliageTints(), TREE_VS),
    fragmentShader: fragHead(GL_HASH, GL_NOISE, glCloudField({ cshSpan: CLOUD_SHADOW_SPAN }), GL_SHADOW, GL_LIGHT, TREE_FS),
    // Canopy clumps are closed but the tubes are open at both ends, and a leaf lit from
    // behind has to be visible from behind.
    side: DoubleSide,
  });
}

/** Depth-only variant for the sun shadow pass — same sway, so the shadow sways too. */
function treeDepthMaterial(kind, cullRadius) {
  const a = TREE_ARCH[kind];
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms({
      uTreeH: { value: a.h },
      uFlex: { value: a.flex },
      uCullR: { value: cullRadius },
    }),
    vertexShader: vertHead(GL_HASH, GL_NOISE, GL_WIND, glslFoliageTints(), TREE_VS),
    fragmentShader: DEPTH_FS,
    side: DoubleSide,
  });
}

/* ── the scene-side manager ───────────────────────────────────────────────── */

/** Beyond this, a tree is under two pixels and the terrain's own colour is doing the job. */
const DEFAULT_CULL = 1400;
/** Re-attach hysteresis, so a chunk sitting exactly on the cull ring does not thrash. */
const REATTACH = 0.92;
/** Radius of the shadow-casting set, metres. Must not exceed the sun shadow map's span. */
const SHADOW_CULL = 420;
/** Millisecond budget per frame for turning newly streamed chunks into instances. */
const BUILD_BUDGET = 2.6;
/**
 * Hard cap on retained chunk records. `Streamer` has no release callback today, so unless
 * the lead wires `remove()` this map only grows: drive 40 km and it is tens of thousands of
 * prop lists held for ground that was recycled long ago. Evicting the furthest DETACHED
 * records keeps that bounded whether or not the hook ever appears — an attached record is
 * inside the cull ring by definition, so this can never drop something on screen.
 */
const MAX_CHUNKS = 512;

/**
 * Every tree and bush in the world, as a handful of instanced draws.
 *
 * One InstancedMesh per (species, LOD). Instances are packed into a dense array per batch
 * with one contiguous block per chunk, so adding a chunk is an append and removing one is a
 * single copyWithin — no free lists, no holes, no per-instance bookkeeping in the draw path.
 *
 * Flowers and ground cover ride along in here rather than hanging off the streamer
 * themselves (render/flowers.js does the drawing). They come out of the SAME scatter pass on
 * the same chunk lifecycle, so giving them their own streamer hook would mean a second
 * `scatterChunk` call for every chunk in the world — the single most expensive thing this
 * module does — to place plants that are already sitting in `props.flowers`.
 */
export class Flora {
  /**
   * @param {object} opts
   * @param {number} opts.seed world seed — must match the streamer's
   * @param {THREE.Object3D} opts.scene
   * @param {number} [opts.quality] 1 = full. Below 0.75 drops every batch one LOD.
   * @param {number} [opts.cullDistance] metres; whole chunks drop out beyond this
   * @param {boolean} [opts.bushes] render the scatter's `bushes` list as scrub instances
   * @param {boolean} [opts.flowers] render the scatter's `flowers` list as beds and cover
   */
  constructor({ seed, scene, quality = 1, cullDistance = DEFAULT_CULL, bushes = true, flowers = true }) {
    this.seed = seed >>> 0;
    this.scene = scene;
    this.quality = clamp(quality, 0.4, 2);
    this.cull = cullDistance * clamp(this.quality, 0.7, 1.35);
    this.renderBushes = bushes;

    this.group = new Object3D();
    this.group.name = 'flora';
    this.group.matrixAutoUpdate = false;
    this.flowers = flowers ? new Flowers({ seed: this.seed, parent: this.group, quality: this.quality }) : null;

    /** batch key `kind:detail` -> batch */
    this.batches = new Map();
    /** chunk key -> entry */
    this.chunks = new Map();
    /** entries waiting to be scattered, nearest-first because the streamer queues that way */
    this.pending = [];

    this.stats = { chunks: 0, instances: 0, batches: 0, attached: 0, buildMs: 0, backlog: 0 };
    this._cam = new Vector3();
    this._hasCam = false;

    scene.add(this.group);
  }

  /** LOD for a terrain level. Level 0 nodes are within ~110 m, level 2 out at ~450 m. */
  _detailFor(level) {
    return clamp(2 - level - (this.quality < 0.75 ? 1 : 0), 0, 2);
  }

  /**
   * Hook this straight onto `Streamer.onChunk`.
   *
   * `props` is optional and is the caller's already-computed `scatterChunk` result. main.js
   * needs one anyway to build the collision solids, and scattering the same node twice is
   * pure duplicated work — a whole Terrain build and several hundred height samples per
   * chunk. If it is not supplied we scatter it ourselves, so the class still stands alone.
   */
  add(rec, props) {
    if (rec.level > SCATTER_MAX_LEVEL) return;
    const key = `${rec.level}:${rec.cx},${rec.cz}`;
    if (this.chunks.has(key)) return;
    const entry = {
      key,
      level: rec.level,
      cx: rec.cx,
      cz: rec.cz,
      mx: rec.ox + rec.size * 0.5,
      mz: rec.oz + rec.size * 0.5,
      props: props || null,
      groups: null,
      blocks: null,
      dead: false,
    };
    this.chunks.set(key, entry);
    this.pending.push(entry);
    this.stats.chunks = this.chunks.size;
  }

  /** Call from the streamer's release path. Safe to call for a chunk that never scattered. */
  remove(rec) {
    const key = `${rec.level}:${rec.cx},${rec.cz}`;
    const entry = this.chunks.get(key);
    if (!entry) return;
    entry.dead = true; // the pending queue skips it rather than paying a splice
    if (entry.blocks) this._detach(entry);
    this.chunks.delete(key);
    this.stats.chunks = this.chunks.size;
    if (this.flowers) this.flowers.remove(key);
  }

  /**
   * @param {number} dt seconds since the last frame
   * @param {THREE.Vector3} camPos
   */
  update(dt, camPos) {
    if (camPos) {
      this._cam.copy(camPos);
      this._hasCam = true;
    }
    this._drain(dt);
    this._cullPass();
    this._flush();
    if (this.flowers) this.flowers.update(camPos);
  }

  /* ── turning chunks into instances ─────────────────────────────────────── */

  _drain(dt) {
    const t0 = performance.now();
    // A frame that is already long has no room to scatter a 256 m node; give it half.
    const budget = dt > 1 / 45 ? BUILD_BUDGET * 0.45 : BUILD_BUDGET;
    let done = 0;
    while (this.pending.length) {
      const entry = this.pending[0];
      if (entry.dead) {
        this.pending.shift();
        continue;
      }
      if (done > 0 && performance.now() - t0 > budget) break;
      this.pending.shift();
      this._scatter(entry);
      done++;
    }
    this.stats.buildMs = performance.now() - t0;
    this.stats.backlog = this.pending.length;
  }

  _scatter(entry) {
    const props =
      entry.props || scatterChunk({ cx: entry.cx, cz: entry.cz, level: entry.level, seed: this.seed });
    entry.props = null; // the records are copied into typed arrays below; do not hold them
    const detail = this._detailFor(entry.level);
    const groups = new Map();

    const emit = (list, lod, sink) => {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const arch = TREE_ARCH[p.kind];
        if (!arch) {
          console.error('[flora] no archetype for species', p.kind, '— check BIOME_SCATTER kinds');
          continue;
        }
        const bk = `${p.kind}:${lod}`;
        let g = groups.get(bk);
        if (!g) {
          g = { kind: p.kind, detail: lod, pos: [], vari: [], minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9, minY: 1e9, maxY: -1e9 };
          groups.set(bk, g);
        }
        // Sway phase has to be a property of the PLACE, not of the build order, or the
        // whole wood re-shuffles its rhythm every time a chunk is rebuilt at another LOD.
        const phase = (hash2i(Math.round(p.x * 4), Math.round(p.z * 4), this.seed) / 4294967296) * 10;
        const y = p.y - sink * p.scale;
        g.pos.push(p.x, y, p.z, p.scale);
        g.vari.push(p.yaw, p.hue, phase, p.biome);
        const h = arch.h * p.scale * 1.25;
        const r = h * 0.45;
        if (p.x - r < g.minX) g.minX = p.x - r;
        if (p.x + r > g.maxX) g.maxX = p.x + r;
        if (p.z - r < g.minZ) g.minZ = p.z - r;
        if (p.z + r > g.maxZ) g.maxZ = p.z + r;
        if (y < g.minY) g.minY = y;
        if (y + h > g.maxY) g.maxY = y + h;
      }
    };

    // The root is sunk so the trunk meets a slope on its downhill side rather than hovering
    // over it; 0.35 m is the pen's value and it holds up to about 20 degrees.
    emit(props.trees, detail, 0.35);
    // Bushes are knee-high: past the second LOD ring they are a single dark pixel that the
    // terrain's own break-up noise already draws, so they simply stop existing out there.
    if (this.renderBushes && entry.level <= 1) emit(props.bushes, Math.min(detail, entry.level === 0 ? 1 : 0), 0.18);
    // Flowers keep their own ring and their own culling — they are only ever a few dozen
    // metres of ground and they are gone long before the tree cull ring.
    if (this.flowers) this.flowers.add(entry.key, props.flowers, entry.mx, entry.mz);

    entry.groups = groups;
    if (!this._hasCam || this._distance(entry) <= this.cull) this._attach(entry);
  }

  _distance(entry) {
    return Math.hypot(entry.mx - this._cam.x, entry.mz - this._cam.z);
  }

  /* ── batches ───────────────────────────────────────────────────────────── */

  _batch(kind, detail) {
    const key = `${kind}:${detail}`;
    let b = this.batches.get(key);
    if (b) return b;

    const seed = hash2i(KIND_ORDER.indexOf(kind) + 1, detail + 1, 0x5eed1eaf);
    const geom = finishMesh(makeTree(kind, detail, seed));
    // One node's worth of the coarsest level that maps to this LOD: the common case is then
    // a single allocation for the batch's whole life.
    const cap = Math.max(64, scatterBudget(Math.min(SCATTER_MAX_LEVEL, 2 - detail)));
    const iPos = new Float32Array(cap * 4);
    const iVar = new Float32Array(cap * 4);
    const aPos = new InstancedBufferAttribute(iPos, 4);
    const aVar = new InstancedBufferAttribute(iVar, 4);
    aPos.setUsage(DynamicDrawUsage); // rewritten whenever a chunk comes or goes
    aVar.setUsage(DynamicDrawUsage);
    geom.setAttribute('iPos', aPos);
    geom.setAttribute('iVar', aVar);
    geom.instanceCount = 0;
    geom.boundingSphere = new Sphere(new Vector3(), 0);

    const mesh = new Mesh(geom, treeMaterial(kind));
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix(); // identity: instance positions are absolute world metres
    mesh.renderOrder = 2;
    mesh.visible = false;
    mesh.userData.depth = treeDepthMaterial(kind, SHADOW_CULL);
    this.group.add(mesh);

    b = { key, kind, detail, geom, mesh, iPos, iVar, aPos, aVar, cap, count: 0, blocks: [], dirty: false };
    this.batches.set(key, b);
    this.stats.batches = this.batches.size;
    return b;
  }

  _reserve(b, need) {
    if (need <= b.cap) return;
    let cap = b.cap;
    while (cap < need) cap *= 2;
    const iPos = new Float32Array(cap * 4);
    const iVar = new Float32Array(cap * 4);
    iPos.set(b.iPos.subarray(0, b.count * 4));
    iVar.set(b.iVar.subarray(0, b.count * 4));
    b.aPos = new InstancedBufferAttribute(iPos, 4);
    b.aVar = new InstancedBufferAttribute(iVar, 4);
    b.aPos.setUsage(DynamicDrawUsage);
    b.aVar.setUsage(DynamicDrawUsage);
    b.geom.setAttribute('iPos', b.aPos);
    b.geom.setAttribute('iVar', b.aVar);
    b.iPos = iPos;
    b.iVar = iVar;
    b.cap = cap;
  }

  _attach(entry) {
    if (entry.blocks || !entry.groups) return;
    const blocks = [];
    for (const g of entry.groups.values()) {
      const n = g.pos.length / 4;
      if (!n) continue;
      const b = this._batch(g.kind, g.detail);
      this._reserve(b, b.count + n);
      b.iPos.set(g.pos, b.count * 4);
      b.iVar.set(g.vari, b.count * 4);
      const block = { batch: b, start: b.count, len: n, g };
      b.blocks.push(block);
      b.count += n;
      b.dirty = true;
      blocks.push(block);
    }
    entry.blocks = blocks;
  }

  _detach(entry) {
    if (!entry.blocks) return;
    for (const block of entry.blocks) {
      const b = block.batch;
      const i = b.blocks.indexOf(block);
      if (i < 0) continue;
      const after = b.count - (block.start + block.len);
      if (after > 0) {
        // Close the hole by sliding the tail down. Two typed-array copies of a few thousand
        // floats, a handful of times a second — cheaper than any hole-tracking scheme, and
        // it keeps the draw a single contiguous instanceCount.
        b.iPos.copyWithin(block.start * 4, (block.start + block.len) * 4, b.count * 4);
        b.iVar.copyWithin(block.start * 4, (block.start + block.len) * 4, b.count * 4);
        for (let k = i + 1; k < b.blocks.length; k++) b.blocks[k].start -= block.len;
      }
      b.blocks.splice(i, 1);
      b.count -= block.len;
      b.dirty = true;
    }
    entry.blocks = null;
  }

  /* ── per-frame ─────────────────────────────────────────────────────────── */

  _cullPass() {
    if (!this._hasCam) return;
    const out = this.cull;
    const back = this.cull * REATTACH;
    let attached = 0;
    for (const entry of this.chunks.values()) {
      if (!entry.groups) continue;
      const d = this._distance(entry);
      if (entry.blocks) {
        if (d > out) this._detach(entry);
        else attached++;
      } else if (d <= back) {
        this._attach(entry);
        attached++;
      }
    }
    this.stats.attached = attached;
    if (this.chunks.size > MAX_CHUNKS) this._evict();
  }

  _evict() {
    const cold = [];
    for (const entry of this.chunks.values()) if (!entry.blocks && entry.groups) cold.push(entry);
    cold.sort((a, b) => this._distance(b) - this._distance(a));
    const n = Math.min(cold.length, this.chunks.size - MAX_CHUNKS);
    for (let i = 0; i < n; i++) this.chunks.delete(cold[i].key);
    this.stats.chunks = this.chunks.size;
  }

  _flush() {
    let total = 0;
    for (const b of this.batches.values()) {
      total += b.count;
      if (!b.dirty) continue;
      b.dirty = false;
      b.geom.instanceCount = b.count;
      b.mesh.visible = b.count > 0;
      b.aPos.needsUpdate = true;
      b.aVar.needsUpdate = true;
      if (!b.count) continue;
      // Bounding sphere over the live blocks, in world space. Batches are keyed by LOD and
      // LOD tracks distance, so the near batches stay small and genuinely frustum-cull.
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, minY = 1e9, maxY = -1e9;
      for (const block of b.blocks) {
        const g = block.g;
        if (g.minX < minX) minX = g.minX;
        if (g.maxX > maxX) maxX = g.maxX;
        if (g.minZ < minZ) minZ = g.minZ;
        if (g.maxZ > maxZ) maxZ = g.maxZ;
        if (g.minY < minY) minY = g.minY;
        if (g.maxY > maxY) maxY = g.maxY;
      }
      const s = b.geom.boundingSphere;
      s.center.set((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);
      s.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.5;
    }
    this.stats.instances = total;
  }

  dispose() {
    if (this.flowers) this.flowers.dispose();
    for (const b of this.batches.values()) {
      this.group.remove(b.mesh);
      b.geom.dispose();
      b.mesh.material.dispose();
      b.mesh.userData.depth.dispose();
    }
    this.batches.clear();
    this.chunks.clear();
    this.pending.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
