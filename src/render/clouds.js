/* Wanderoad — cumulus and the shadows they throw.
 *
 * Ported from the pen (`buildClouds`, `CLOUD_VS`, `CLOUD_FS`, `PUFFATLAS_FS`, `CLOUDSH_FS`).
 * The premise is the one thing here worth guarding: the visible clouds and the dark patches
 * crossing the valley floor are two readings of the SAME analytic coverage field, so every
 * shadow belongs to a cloud you can point at. Break that and the sky stops being weather and
 * becomes decoration.
 *
 * Two things had to change for an infinite world:
 *
 *  1. The deck. The pen grew a 9x9 lattice of formations around a fixed valley and left it
 *     there. Here the lattice is one period of an infinite tiling: each formation is wrapped
 *     by whole lattice periods into the window around the camera, so the sky is endless and
 *     the puffs still keep true parallax as you drive under them. The wrap is a 27.4 km jump,
 *     and puffs are already faded out by 12.8 km, so no player ever sees one happen.
 *
 *  2. The shadow bake. The pen centred its 512² cloud-shadow map on one valley. Here it
 *     re-centres on the camera every frame, projected up-sun to where the deck actually is.
 *     `U.uCloudSh` / `U.uCloudShOrigin` are written from here, which is the moment the
 *     terrain shader's existing `cloudShadow()` call starts doing something.
 */

import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Camera,
  ClampToEdgeWrapping,
  CustomBlending,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  RawShaderMaterial,
  Scene,
  Sphere,
  SrcAlphaFactor,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
  ZeroFactor,
} from 'three';
import {
  fragHead,
  vertHead,
  glCloudField,
  GL_HASH,
  GL_LIGHT,
  GL_NOISE,
} from '../core/glsl.js';
import { clamp, rng, hash2i, TAU } from '../core/math.js';
import { sharedUniforms, U } from './uniforms.js';

/* ── deck geometry ──────────────────────────────────────────────────────────
 * The pen's numbers (hoshi.html §4): a 9x9 lattice at 3050 m, bases between 620 m and
 * 1440 m. DECK is therefore 27.45 km — the distance a puff jumps when it wraps. */
const LATTICE = 9;
const SPACING = 3050;
const DECK = LATTICE * SPACING;

/* Cloud-shadow projection. Must match createTerrainMaterial() exactly or a cloud's shadow
 * lands somewhere other than under the cloud. */
const CLOUD_SPAN = 9200;
const CLOUD_DECK = 980;

/* Where puffs fade out, and where the CPU stops feeding them to the index buffer. Both are
 * comfortably inside DECK/2 = 13.7 km, which is what makes the wrap invisible. */
const FADE_NEAR = 10500;
const FADE_FAR = 12800;
const DRAW_LIMIT = 1500; // nearest N puffs; the pen's cap, and still ~6k triangles
const SORT_INTERVAL = 0.35; // seconds; the back-to-front order barely moves between passes

/* Deck-level wind. 2.3 m/s is the pen's own drift magnitude; the bearing is seeded so two
 * players in the same world watch the same clouds cross the same ridge. */
const DRIFT_SPEED = 2.3;

/* ── the puff profile atlas ─────────────────────────────────────────────────
 * One 1024² atlas of four profiles, baked once. R = scalloped alpha, G = interior density,
 * B = rim mask, A = the softer shoulder smoke wants. Per-puff variety comes from picking a
 * tile and spinning the billboard, which reads identically to evaluating the noise live at
 * an eighth of the cost. */
const PUFFATLAS_FS = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
void main(){
  vec2 tile = floor(vUv*2.0);
  float seed = (tile.x + tile.y*2.0)*37.13 + 5.0;
  vec2 c = fract(vUv*2.0)*2.0 - 1.0;
  float r = length(c);
  float ang = atan(c.y, c.x);
  vec2 ring = vec2(cos(ang), sin(ang));
  float lob = fbm2(ring*2.35 + seed*13.7, 3) + fbm2(ring*5.1 + seed*29.1, 2)*0.45;
  float R = 0.80 + lob*0.20;
  float a = smoothstep(R, R-0.34, r);
  float den = fbm2(c*2.6 + seed*31.3, 3)*0.5 + 0.5;
  float edge = smoothstep(R-0.36, R-0.02, r);
  float aSoft = smoothstep(R, R-0.42, r);
  fragColor = vec4(a, den, edge, aSoft);
}
`;

/* ── the cloud-shadow map ───────────────────────────────────────────────────
 * The coverage field is thirteen octaves of warped fbm. Evaluated once per frame into a
 * 512² map instead of once per fragment of an eight-megapixel frame, it is by a wide margin
 * the biggest saving in the renderer: cloudShadow() is called by the terrain and the water,
 * and will be called by the grass, the trees and the car. 9200 m over 512 texels is 18 m per
 * texel against a finest feature of ~95 m, so the bake is indistinguishable from the live
 * field. */
const CLOUDSH_FS = /* glsl */ `
in vec2 vUv;
out vec4 fragColor;
void main(){
  vec2 q = uCloudShOrigin + (vUv - 0.5)*CSH_SPAN;
  float c = smoothstep(0.06, 0.60, cloudField(q));
  fragColor = vec4(c, c, c, 1.0);
}
`;

const QUAD_VS = /* glsl */ `
in vec2 uv;
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const CLOUD_VS = /* glsl */ `
in vec2 corner;
in vec3 pdata;   // radius, per-puff seed, height fraction within its formation
in vec2 fcen;    // the formation's lattice centre, xz
out vec2 vC;
out float vSeed;
out float vHF;
out vec3 vW;
out float vOp;
out vec3 vRight;
out vec3 vUp;
out vec3 vFwd;

const float DECK_PERIOD = ${DECK.toFixed(1)};

void main(){
  // Wrap by whole lattice periods into the window around the camera. The offset is computed
  // from the FORMATION centre, not the puff, so a formation always wraps as one cloud
  // instead of tearing in half.
  vec2 fhome = fcen + uCloudDrift;
  vec2 wrapOff = floor((uCamPos.xz - fhome)/DECK_PERIOD + 0.5) * DECK_PERIOD;
  vec2 fw = fhome + wrapOff;
  vec3 wc = position + vec3(uCloudDrift.x + wrapOff.x, 0.0, uCloudDrift.y + wrapOff.y);

  // The same field that draws the shadow decides whether this puff exists. cloudField()
  // subtracts uCloudDrift again, so a cloud's existence is pinned to its wrapped home in the
  // world while the puff itself rides the wind — a cloud that moves rather than one that
  // blinks.
  float op = smoothstep(0.16, 0.52, cloudField(fw));
  // Fade well inside DECK_PERIOD*0.5 so the wrap always happens to an invisible puff.
  op *= 1.0 - smoothstep(${FADE_NEAR.toFixed(1)}, ${FADE_FAR.toFixed(1)}, length(uCamPos - wc));
  vOp = op;
  if(op < 0.012){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  vRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vUp    = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vFwd   = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));

  float rad = pdata.x * mix(0.80, 1.06, op);
  float ra = pdata.y*2.399963;                    // golden-angle spin per puff
  float cr = cos(ra), sr = sin(ra);
  vec2 rc = vec2(corner.x*cr - corner.y*sr, corner.x*sr + corner.y*cr);
  vec3 wp = wc + vRight*(rc.x*rad) + vUp*(rc.y*rad*0.86);
  vC = rc; vSeed = pdata.y; vHF = pdata.z; vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CLOUD_FS = /* glsl */ `
uniform sampler2D uPuff;
in vec2 vC;
in float vSeed;
in float vHF;
in vec3 vW;
in float vOp;
in vec3 vRight;
in vec3 vUp;
in vec3 vFwd;
out vec4 fragColor;
void main(){
  float r = length(vC);
  if(!(r <= 1.02)) discard;
  vec2 tile = vec2(mod(floor(vSeed*4.0), 2.0), mod(floor(vSeed*2.0), 2.0));
  vec4 prof = texture(uPuff, (clamp(vC,-1.0,1.0)*0.5 + 0.5)*0.5 + tile*0.5);
  // An analytic radial falloff multiplies the baked profile: it softens the silhouette, and
  // it makes a hard-edged opaque quad structurally impossible even if the atlas is missing.
  float a = prof.r * smoothstep(1.02, 0.60, r);
  if(!(a > 0.004)) discard;
  float den = prof.g;
  a *= mix(0.62, 1.0, den);
  a *= vOp;

  // Fake volumetric normal off the billboard disc, biased upward: cumulus tops face the sky,
  // bellies face the ground.
  float zz = sqrt(max(0.0, 1.0 - min(r,1.0)*min(r,1.0)));
  vec3 N = normalize(vRight*vC.x + vUp*vC.y + vFwd*zz*0.85 + vec3(0.0, 0.62, 0.0));
  vec3 V = normalize(uCamPos - vW);

  float ndl = dot(N, uSunDir);
  float t = clamp(ndl*0.5 + 0.5, 0.0, 1.0);
  // Height fraction as its own term rather than a nudge to the lambert: it is what separates
  // a stack of towers into readable storeys instead of one grey mass, because a cumulus is
  // lit as much by the sky dome above it as by the sun on its shoulder.
  t = mix(t, clamp(t + vHF*0.36 - 0.10, 0.0, 1.0), 0.78);
  t *= mix(0.68, 1.10, den);
  float term = smoothstep(0.30, 0.54, t);       // the terminator, as a line

  vec3 col = ramp3(t, K_C_UNDER, K_C_TERM, K_C_TOP, 0.085, (den-0.5)*0.06);
  // the belly goes violet fast, and it does not pass through grey to get there
  col = mix(mix(K_C_CORE, K_C_UNDER, 0.30), col, smoothstep(0.0, 0.28, t));
  col = mix(col, K_C_BODY, 0.13);
  col *= mix(vec3(1.0), K_SUN*1.28, term*0.44);

  // silver lining: the rim of a backlit cumulus blazes
  float back = clamp(dot(V, -uSunDir), 0.0, 1.0);
  float edge = prof.b;
  float sunEdge = clamp(dot(normalize(vRight*vC.x + vUp*vC.y), uSunDir)*0.5+0.5, 0.0, 1.0);
  float rimLine = smoothstep(0.30, 0.84, edge);
  float silver = rimLine * pow(sunEdge, 1.9) * (0.34 + 1.7*pow(back, 1.3));
  col = mix(col, K_C_RIM*1.45, clamp(silver, 0.0, 0.94));
  // ...and a thin cool line down the shaded side, which is the thing that actually reads as
  // "drawn" rather than "rendered"
  col = mix(col, mix(K_C_CORE, K_SHADOW, 0.42), rimLine*(1.0-sunEdge)*(1.0-term)*0.36);
  col += K_SUN * pow(back, 6.0) * 0.62 * (1.0-edge*0.4);

  // Clouds are far enough that full aerial perspective would erase them; the pen carries
  // them at 55% of their true distance so they haze without dissolving.
  col = aerial(col, length(uCamPos - vW)*0.55, V, vW.y);
  fragColor = vec4(SAFE3(col), clamp(a, 0.0, 1.0));
}
`;

/* ── fullscreen-quad plumbing for the two bakes ─────────────────────────────
 * One triangle, module-level, shared by every Clouds instance. */
const _quadScene = new Scene();
const _quadCam = new Camera();
const _quadMesh = (() => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  g.boundingSphere = new Sphere(new Vector3(), 10);
  const m = new Mesh(g, null);
  m.frustumCulled = false;
  _quadScene.add(m);
  return m;
})();

function blit(renderer, material, target) {
  _quadMesh.material = material;
  renderer.setRenderTarget(target);
  renderer.render(_quadScene, _quadCam);
  renderer.setRenderTarget(null);
}

/**
 * Grow one lattice period of cumulus congestus the way a real one grows: a broad flat base
 * disc, a few towers of decreasing radius, then cauliflower on the shoulders. Deterministic
 * from the world seed — no Math.random, so every client builds the same sky.
 */
function buildDeck(seed) {
  const r = rng(hash2i(0x5c10, 0xd0c5, seed >>> 0));
  const puffs = [];
  for (let gz = 0; gz < LATTICE; gz++) {
    for (let gx = 0; gx < LATTICE; gx++) {
      const fx = (gx - (LATTICE - 1) / 2) * SPACING + (r() - 0.5) * SPACING * 0.75;
      const fz = (gz - (LATTICE - 1) / 2) * SPACING + (r() - 0.5) * SPACING * 0.75;
      const base = 620 + r() * 820;
      const scale = 0.72 + r() * 0.85;
      const nTow = 2 + ((r() * 3) | 0);
      const baseR = (300 + r() * 230) * scale;
      let maxY = 0;
      const local = [];

      const nb = 7 + ((r() * 7) | 0);
      for (let i = 0; i < nb; i++) {
        const a = r() * TAU;
        const rr = Math.sqrt(r()) * baseR;
        const px = Math.cos(a) * rr;
        const pz = Math.sin(a) * rr * 0.72;
        const py = r() * 0.1 * baseR;
        local.push({ x: px, y: py, z: pz, rad: (0.44 + r() * 0.32) * baseR, seed: r() * 100 });
        if (py > maxY) maxY = py;
      }

      for (let t = 0; t < nTow; t++) {
        const a = r() * TAU;
        const rr = Math.sqrt(r()) * baseR * 0.55;
        const tx = Math.cos(a) * rr;
        const tz = Math.sin(a) * rr * 0.7;
        const hTop = (0.85 + r() * 1.15) * baseR;
        const steps = 4 + ((r() * 4) | 0);
        for (let s = 0; s < steps; s++) {
          const u = s / (steps - 1);
          const py = u * hTop;
          const rad = (0.52 - 0.22 * u * u + r() * 0.13) * baseR * (1.0 - 0.25 * u);
          const jx = (r() - 0.5) * baseR * 0.3 * (0.4 + u);
          const jz = (r() - 0.5) * baseR * 0.3 * (0.4 + u);
          local.push({ x: tx + jx, y: py, z: tz + jz, rad, seed: r() * 100 });
          if (py > maxY) maxY = py;
          if (s > 0 && r() < 0.7) {
            const aa = r() * TAU;
            const dd = rad * (0.55 + r() * 0.5);
            local.push({
              x: tx + jx + Math.cos(aa) * dd,
              y: py + (r() - 0.3) * rad * 0.5,
              z: tz + jz + Math.sin(aa) * dd,
              rad: rad * (0.42 + r() * 0.3),
              seed: r() * 100,
            });
          }
        }
      }

      for (const p of local) {
        puffs.push({
          cx: fx + p.x,
          cy: base + p.y,
          cz: fz + p.z,
          rad: p.rad,
          seed: p.seed,
          hf: maxY > 1 ? clamp(p.y / maxY, 0, 1) : 0.5,
          fx,
          fz,
        });
      }
    }
  }

  const n = puffs.length;
  const pos = new Float32Array(n * 4 * 3);
  const cor = new Float32Array(n * 4 * 2);
  const dat = new Float32Array(n * 4 * 3);
  const fcen = new Float32Array(n * 4 * 2);
  for (let i = 0; i < n; i++) {
    const p = puffs[i];
    for (let v = 0; v < 4; v++) {
      const k = i * 4 + v;
      pos[k * 3] = p.cx;
      pos[k * 3 + 1] = p.cy;
      pos[k * 3 + 2] = p.cz;
      cor[k * 2] = v === 1 || v === 3 ? 1 : -1;
      cor[k * 2 + 1] = v >= 2 ? 1 : -1;
      dat[k * 3] = p.rad;
      dat[k * 3 + 1] = p.seed;
      dat[k * 3 + 2] = p.hf;
      fcen[k * 2] = p.fx;
      fcen[k * 2 + 1] = p.fz;
    }
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(pos, 3));
  geom.setAttribute('corner', new BufferAttribute(cor, 2));
  geom.setAttribute('pdata', new BufferAttribute(dat, 3));
  geom.setAttribute('fcen', new BufferAttribute(fcen, 2));
  const index = new Uint32Array(n * 6);
  geom.setIndex(new BufferAttribute(index, 1));
  geom.boundingSphere = new Sphere(new Vector3(0, 900, 0), DECK);

  return { geom, puffs, index, count: n };
}

export class Clouds {
  /**
   * @param {object} opts
   * @param {THREE.WebGLRenderer} opts.renderer
   * @param {THREE.Object3D} opts.scene
   * @param {number} opts.seed
   */
  constructor({ renderer, scene, seed }) {
    this.renderer = renderer;
    this.scene = scene;
    this.seed = seed >>> 0;

    const cloud = glCloudField({ cshSpan: CLOUD_SPAN, cloudDeck: CLOUD_DECK });

    // ── puff profile atlas, baked once ──
    this.puffRT = new WebGLRenderTarget(1024, 1024, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    });
    const atlasMat = new RawShaderMaterial({
      glslVersion: '300 es',
      uniforms: sharedUniforms(),
      vertexShader: vertHead(QUAD_VS),
      fragmentShader: fragHead(GL_HASH, GL_NOISE, PUFFATLAS_FS),
      depthTest: false,
      depthWrite: false,
    });
    blit(renderer, atlasMat, this.puffRT);
    atlasMat.dispose();

    // ── cloud-shadow map, re-baked every frame ──
    this.shadowRT = new WebGLRenderTarget(512, 512, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer: false,
    });
    // uCloudSh is nulled for the bake material alone, so the pass can never form a feedback
    // loop with its own target whatever the driver keeps after dead-code removal.
    this.shadowMat = new RawShaderMaterial({
      glslVersion: '300 es',
      uniforms: sharedUniforms({ uCloudSh: { value: null } }),
      vertexShader: vertHead(QUAD_VS),
      fragmentShader: fragHead(GL_HASH, GL_NOISE, cloud, CLOUDSH_FS),
      depthTest: false,
      depthWrite: false,
    });
    U.uCloudSh.value = this.shadowRT.texture;

    // ── the deck ──
    this.deck = buildDeck(this.seed);
    this.material = new RawShaderMaterial({
      glslVersion: '300 es',
      uniforms: sharedUniforms({ uPuff: { value: this.puffRT.texture } }),
      vertexShader: vertHead(GL_HASH, GL_NOISE, cloud, CLOUD_VS),
      fragmentShader: fragHead(GL_LIGHT, CLOUD_FS),
      side: DoubleSide,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendEquation: AddEquation,
      // The alpha channel is the post chain's distance signal, not coverage: clouds must
      // leave it alone rather than blend into it.
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      blendEquationAlpha: AddEquation,
    });

    this.mesh = new Mesh(this.deck.geom, this.material);
    this.mesh.name = 'clouds';
    // The deck is wrapped around the camera in the vertex shader, so its bounds are
    // meaningless to the CPU; the puff sort below is the real culler.
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 40;
    scene.add(this.mesh);

    // Bearing of the deck-level wind, seeded so the sky is the same world for everyone.
    const a = (hash2i(0x1d3a, 0xc10d, this.seed) / 4294967296) * TAU;
    this._driftX = Math.cos(a) * DRIFT_SPEED;
    this._driftZ = Math.sin(a) * DRIFT_SPEED;

    this._sortT = 0;
    this._dist = new Float32Array(this.deck.count);
    this._order = new Int32Array(this.deck.count);
    for (let i = 0; i < this.deck.count; i++) this._order[i] = i;
    this.stats = { puffs: this.deck.count, drawn: 0 };

    this.update(0, { x: 0, y: 0, z: 0 });
  }

  /**
   * Drift, re-sort, re-bake. Call once per frame BEFORE `renderer.render`, and after the
   * frame's `uTime` / `uCamPos` writes — the shadow map and `uCloudShOrigin` have to describe
   * the same instant as the scene that reads them, which is why the bake is every frame and
   * not every other one.
   */
  update(dt, camPos) {
    const cx = camPos ? camPos.x : 0;
    const cy = camPos ? camPos.y : 0;
    const cz = camPos ? camPos.z : 0;

    // Drift straight from uTime rather than integrated from dt: an accumulator diverges
    // between two clients the moment one of them drops a frame, and the whole point of a
    // seeded sky is that it is the same sky.
    const t = U.uTime.value;
    U.uCloudDrift.value.set(this._driftX * t, this._driftZ * t);

    this._sortT -= dt;
    if (this._sortT <= 0) {
      this._sortT = SORT_INTERVAL;
      this._sort(cx, cy, cz);
    }

    // Centre the bake where the deck projects along the sun vector. At a 13.5° sun that is
    // nearly four kilometres up-sun of the camera, which is exactly the ground the shadows
    // are about to land on.
    const sun = U.uSunDir.value;
    const k = (CLOUD_DECK - cy) / Math.max(sun.y, 0.06);
    U.uCloudShOrigin.value.set(cx + sun.x * k, cz + sun.z * k);
    blit(this.renderer, this.shadowMat, this.shadowRT);
  }

  /**
   * Depth-sort the puffs far-to-near and rebuild the index buffer.
   *
   * Building throwaway [distance, index] pairs and handing them to Array.sort is a textbook
   * GC hitch at this count. The order barely changes between passes, so a persistent index
   * plus an insertion pass is both allocation-free and effectively O(n).
   */
  _sort(cx, cy, cz) {
    const P = this.deck.puffs;
    const idx = this.deck.index;
    const n = P.length;
    const d2 = this._dist;
    const ord = this._order;
    const dx0 = U.uCloudDrift.value.x;
    const dz0 = U.uCloudDrift.value.y;

    for (let i = 0; i < n; i++) {
      const p = P[i];
      // Same wrap as CLOUD_VS, or the sort would order puffs by where they are not.
      const wox = Math.round((cx - (p.fx + dx0)) / DECK) * DECK;
      const woz = Math.round((cz - (p.fz + dz0)) / DECK) * DECK;
      const dx = p.cx + dx0 + wox - cx;
      const dy = p.cy - cy;
      const dz = p.cz + dz0 + woz - cz;
      d2[i] = dx * dx + dy * dy + dz * dz;
    }

    for (let a = 1; a < n; a++) {
      const v = ord[a];
      const key = d2[v];
      let b = a - 1;
      while (b >= 0 && d2[ord[b]] < key) {
        ord[b + 1] = ord[b];
        b--;
      }
      ord[b + 1] = v;
    }

    const lim = FADE_FAR * FADE_FAR;
    let cnt = 0;
    for (let j = 0; j < n; j++) if (d2[ord[j]] <= lim) cnt++;
    // ord is far-to-near, so dropping from the front keeps the NEAREST DRAW_LIMIT.
    let skip = cnt > DRAW_LIMIT ? cnt - DRAW_LIMIT : 0;
    let k = 0;
    for (let j = 0; j < n; j++) {
      const i = ord[j];
      if (d2[i] > lim) continue;
      if (skip > 0) {
        skip--;
        continue;
      }
      const b = i * 4;
      idx[k++] = b;
      idx[k++] = b + 1;
      idx[k++] = b + 2;
      idx[k++] = b;
      idx[k++] = b + 2;
      idx[k++] = b + 3;
    }
    this.deck.geom.index.needsUpdate = true;
    this.deck.geom.setDrawRange(0, k);
    this.stats.drawn = k / 6;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.deck.geom.dispose();
    this.material.dispose();
    this.shadowMat.dispose();
    // Leave nothing pointing at a freed texture: every shader in the game samples uCloudSh.
    if (U.uCloudSh.value === this.shadowRT.texture) U.uCloudSh.value = null;
    this.shadowRT.dispose();
    this.puffRT.dispose();
    this.stats.drawn = 0;
  }
}
