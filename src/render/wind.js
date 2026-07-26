/* Wanderoad — the wind field.
 *
 * Ported from the Hoshi-no-Tani pen (§5 THE WIND: `WindSys`, `updateWind`, `windAtJS`,
 * `WIND_FS`, `GL_WIND`). Real wind is not sin(t): it is a mean flow whose direction
 * meanders, a Kolmogorov cascade of eddies frozen into that flow and carried along with it
 * (Taylor), coherent gust cells that outrun the mean and veer as they arrive, a logarithmic
 * boundary layer, and terrain that speeds it up over crests and shelters the lee. All of it
 * is evaluated once per pass into one small RGBA16F render target that every other material
 * in the game samples — grass, trees, water, the car's aerial — so nothing can disagree
 * about which way the air is moving.
 *
 * WHAT CHANGED FROM THE PEN
 *  - The pen's terrain coupling read a baked 1280² heightmap of one fixed valley. Those
 *    textures are gone, so the coupling now reads a coarse CPU-built height proxy that is
 *    refilled a few samples per frame from `landHeight()` and re-centres on the car. At
 *    37.5 m/texel it resolves the 500–1200 m relief the coupling actually cares about, and
 *    it costs ~0.08 ms of JS per frame.
 *  - The pen's `splatAt()` water term (open water is smoother, so the wind runs 14% faster
 *    over it) had no substitute that did not cost a second streamed field, so it is dropped.
 *  - `Math.random` in the meander and the cell respawn is replaced by a seeded stream, so
 *    two sessions with the same seed start in the same weather.
 *
 * The RT span is 900 m rather than the pen's 440: the car outruns a walker by 20x, and a
 * gust front has to be visible arriving from ahead rather than materialising at the edge of
 * the field. Outside the target the analytic fallback in `windSample()` takes over, exactly
 * as it did in the pen.
 */

import {
  Camera,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  BufferGeometry,
  BufferAttribute,
  RawShaderMaterial,
  RedFormat,
  RGBAFormat,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import { FHEAD, GL_HASH, GL_NOISE, GL_UNI } from '../core/glsl.js';
import { U } from './uniforms.js';
import { clamp, DEG, rng, smoothstep } from '../core/math.js';
import { noise2 } from '../core/noise.js';
import { landHeight } from '../world/terrain.js';

/** Metres covered by the wind render target, edge to edge. */
export const WIND_SPAN = 900;

/** How far upwind a blade "remembers" the flow. A gust front sweeps instead of switching. */
const WIND_LAG_M = 2.6;

/* ── the terrain proxy ───────────────────────────────────────────────────────
 * Only the crest/shelter/channelling terms read this, and all three are integrals over
 * tens of metres of hillside, so it is deliberately coarse: 32² texels over 1200 m. One
 * full refill is 1024 `landHeight` calls (~3.2 µs each, measured), spread over ~43 frames
 * at 24 samples a frame. The sweep restarts as soon as it finishes, so the proxy is never
 * more than ~0.7 s stale — 60 m of travel across a 1200 m window.
 */
const PROXY_RES = 32;
const PROXY_SPAN = 1200;
const PROXY_PER_FRAME = 24;

/* ── the sampling side of the field, shared with every other material ──────── */

/**
 * The uniform block that `GL_WIND` needs on top of the shared `U`. It is a module
 * singleton on purpose: `Wind` writes into it and every material that includes `GL_WIND`
 * points at the same object, so there is no per-material sync code — the same trick
 * render/uniforms.js plays with `U`.
 */
const WIND_U = { uMeanWind: { value: new Vector2(3, 1) } };

/** Merge into a material's uniforms alongside `sharedUniforms()` when it includes GL_WIND. */
export function windUniforms() {
  return WIND_U;
}

/**
 * Wind sampling + the boundary-layer profile, for any shader that leans, sways or ripples.
 * Ported verbatim from the pen's GL_WIND. Requires GL_HASH + GL_NOISE ahead of it and the
 * `uMeanWind` uniform from `windUniforms()`.
 */
export const GL_WIND = /* glsl */ `
uniform vec2 uMeanWind;   // supplied by windUniforms(), not by the shared U block
const float WIND_SPAN = ${WIND_SPAN.toFixed(1)};
// Beyond the render target we still want visible gust bands rolling over the far hills,
// so the fallback is an analytic version of the same travelling wave.
float windBandAnalytic(vec2 p){
  vec2 q = p - uMeanWind * (uTime * 1.22);
  float a = fbm2(q * 0.0052, 3);
  float b = pn2(q * 0.0168 + 13.0);
  float c = pn2(q * 0.055  + 41.0);
  return clamp(a*1.30 + b*0.55 + c*0.22, -1.2, 1.4);
}
vec4 windSample(vec2 p){
  vec2 uv = (p - uWindOrigin) / WIND_SPAN + 0.5;
  vec2 c = clamp(uv, vec2(0.003), vec2(0.997));
  vec4 w = texture(uWindTex, c);
  float edge = 1.0 - smoothstep(0.40, 0.498, max(abs(uv.x-0.5), abs(uv.y-0.5)));
  // Inside the render target the simulated field IS the answer. The analytic fallback
  // costs ~20 hash evaluations and is pure waste there — and since a blade's vertices all
  // sample the same point, this branch is perfectly coherent across a warp. It is the
  // single largest saving in the grass vertex shader.
  if(edge >= 0.999) return w;
  float band = windBandAnalytic(p);
  float gust = clamp(0.80 + band*0.95, 0.05, 2.3);
  vec4 fb = vec4(uMeanWind*gust, gust, clamp(band, 0.0, 1.0)*0.85);
  return mix(fb, w, edge);
}
// logarithmic boundary layer, normalised to the 10 m reference height
float windProfile(float z){
  return log((max(z,0.015) + 0.06) / 0.06) * 0.19523;
}
`;

/* ── the field pass ─────────────────────────────────────────────────────────── */

const QUAD_VS = /* glsl */ `precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const WIND_FS = /* glsl */ `${FHEAD}${GL_UNI}
uniform vec2  uMeanWind;
uniform vec4  uCellA[6];      // xy: head station + cross offset, z: length, w: width
uniform vec4  uCellB[6];      // x: amplitude, y: veer, z: age, w: -
uniform vec2  uFwd;
uniform vec2  uSide;
uniform float uGustiness;
uniform float uTurbI;
uniform sampler2D uWindTerr;  // coarse ground height, metres
uniform vec3  uWindTerrO;     // xy: proxy centre in world xz, z: 1 / proxy span
${GL_HASH}${GL_NOISE}
in vec2 vUv;
out vec4 outColor;

float terrH(vec2 p){
  vec2 uv = (p - uWindTerrO.xy) * uWindTerrO.z + 0.5;
  return texture(uWindTerr, clamp(uv, vec2(0.008), vec2(0.992))).r;
}
vec3 terrN(vec2 p, float e){
  float l = terrH(p - vec2(e,0.0)), r = terrH(p + vec2(e,0.0));
  float d = terrH(p - vec2(0.0,e)), u = terrH(p + vec2(0.0,e));
  return normalize(vec3(l-r, 2.0*e, d-u));
}

/* divergence-free turbulence with an inertial-subrange amplitude spectrum: eddy velocity
   at wavenumber k scales as k^(-1/3), and each octave decorrelates on its own turnover
   time tau ~ k^(-2/3). */
vec2 turbulence(vec2 p, float t, out float mag){
  vec2 v = vec2(0.0);
  float k = 0.0118, amp = 1.0, e = 0.021;
  mag = 0.0;
  for(int i=0;i<4;i++){
    vec2 q = (p - uMeanWind*t) * k;
    float tt = t * (0.055 * pow(2.0, float(i)*0.667));
    float n0 = pn3(vec3(q,                tt));
    float nx = pn3(vec3(q + vec2(e,0.0),  tt));
    float ny = pn3(vec3(q + vec2(0.0,e),  tt));
    vec2 curl = vec2(ny - n0, -(nx - n0)) / e;
    v   += amp * curl;
    mag += amp * length(curl);
    k *= 2.0; amp *= 0.7937;               // 2^(-1/3)
  }
  return v;
}

void main(){
  vec2 p = uWindOrigin + (vUv - 0.5) * ${WIND_SPAN.toFixed(1)};
  float t = uTime;

  vec2 flow = uMeanWind;
  float meanSpd = max(length(uMeanWind), 0.05);

  // ── coherent gust cells ──────────────────────────────────────────────────
  // 'crossS' rather than 'cross': shadowing the built-in compiles, but the grass shader
  // shares these chunks and does call cross().
  float along = dot(p, uFwd), crossS = dot(p, uSide);
  float gust = 0.0, veer = 0.0, front = 0.0;
  for(int i=0;i<6;i++){
    float u = (along - uCellA[i].x) / uCellA[i].z;
    if(u > 0.18 || u < -6.5) continue;
    float head = smoothstep(0.15, 0.0, u);
    float body = exp(u*2.05);
    float cw   = exp(-pow(abs(crossS - uCellA[i].y)/(uCellA[i].w*0.5), 2.3));
    float g = uCellB[i].x * head * body * cw;
    gust  += g;
    veer  += g * uCellB[i].y;
    front += uCellB[i].x * exp(-abs(u)*9.0) * cw;   // the sharp leading edge
  }
  gust *= uGustiness; front *= uGustiness;

  // ── inertial-subrange turbulence, advected with the flow ─────────────────
  float tmag;
  vec2 turb = turbulence(p, t, tmag) * meanSpd * uTurbI;
  flow += turb;

  // ── terrain coupling ─────────────────────────────────────────────────────
  // The probe offsets are the pen's (58 m for the crest, 48 m upwind for the shelter).
  // They are wider than one proxy texel, which is why a 37.5 m proxy is enough.
  float h  = terrH(p);
  float hs = 0.25*(terrH(p+vec2(58.0,0.0)) + terrH(p-vec2(58.0,0.0))
                 + terrH(p+vec2(0.0,58.0)) + terrH(p-vec2(0.0,58.0)));
  float crest = (h - hs) / 24.0;
  float speedup = 1.0 + 0.92*clamp(crest, 0.0, 1.1);
  float hUp = terrH(p - uFwd*48.0);
  float shelter = exp(-max(hUp - h, 0.0)/23.0);
  speedup *= mix(0.42, 1.0, shelter);

  vec3 n = terrN(p, 40.0);
  vec2 grad = -n.xz;
  float slope = length(grad);
  vec2 contour = normalize(vec2(-grad.y, grad.x) + vec2(1e-6));
  if(dot(contour, uFwd) < 0.0) contour = -contour;
  vec2 fdir = normalize(flow + vec2(1e-6));
  fdir = normalize(mix(fdir, contour, clamp(slope*2.1, 0.0, 0.58)));

  float spd = length(flow) * speedup * (1.0 + gust*1.35);
  // the gust front veers the direction as it passes over
  float a = veer * 0.85;
  vec2 dir = vec2(fdir.x*cos(a) - fdir.y*sin(a), fdir.x*sin(a) + fdir.y*cos(a));

  vec2 vel = dir * spd;
  float gustNorm = spd / max(meanSpd, 0.4);
  float excite = clamp(front*1.35 + tmag*0.22, 0.0, 3.0);

  outColor = vec4(vel, gustNorm, excite);
}`;

/* ── the simulation ─────────────────────────────────────────────────────────── */

export class Wind {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {{seed?:number, res?:number, quality?:number, everyNthFrame?:number}} [opt]
   */
  constructor(renderer, opt = {}) {
    this.renderer = renderer;
    const quality = clamp(opt.quality ?? 1, 0.4, 2);
    // 320² over 900 m is 2.8 m/texel; the finest turbulence octave has a ~10 m eddy, so
    // three texels carry the smallest feature the field actually contains.
    const res = Math.max(128, Math.round((opt.res ?? 320) * Math.sqrt(quality)) & ~1);

    /* The field drifts far slower than the camera, so it runs at a third of frame rate —
       the pen's trick. Nothing in the image moves at 20 Hz: the blades interpolate the
       field spatially and their own oscillator runs at full rate. */
    this.everyNthFrame = Math.max(1, opt.everyNthFrame ?? 3);
    this._frame = 0;

    this.rt = new WebGLRenderTarget(res, res, {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
    U.uWindTex.value = this.rt.texture;

    /* ── state: mean flow + six gust cells ── */
    const r = rng((opt.seed ?? 4242) >>> 0);
    this._r = r;
    this.time = 0;
    this.baseSpeed = 4.2; // m/s at the 10 m reference height
    this.baseDir = 292 * DEG; // the direction the wind comes FROM
    this.meanSpeed = this.baseSpeed;
    this.meanDir = this.baseDir;
    this.tgtSpeed = this.baseSpeed;
    this.tgtDir = this.baseDir;
    this.gustiness = 1.0;
    this.vec = new Vector2();
    this.fwd = [0, 1];
    this.side = [-1, 0];
    /** Cloud-deck drift, in metres. The lead may point `U.uCloudDrift` at this. */
    this.cloudDrift = new Vector2();
    this.cloudWind = new Vector2();

    const fx = Math.sin(this.meanDir + Math.PI);
    const fz = Math.cos(this.meanDir + Math.PI);
    this.fwd = [fx, fz];
    this.side = [-fz, fx];
    this.vec.set(fx * this.meanSpeed, fz * this.meanSpeed);

    this.cells = [];
    for (let i = 0; i < 6; i++) {
      this.cells.push({
        s: -1400 + i * 430 + r() * 260, // along-wind station of the cell head
        c: (r() - 0.5) * 900, // cross-wind offset
        len: 26 + r() * 34,
        wid: 70 + r() * 130,
        amp: 0.85 + r() * 1.35,
        veer: (r() - 0.5) * 0.42,
        life: 0,
      });
    }

    /* ── the terrain proxy ── */
    this._pxData = new Uint16Array(PROXY_RES * PROXY_RES); // half float, metres
    this._pxNext = new Float32Array(PROXY_RES * PROXY_RES);
    this._pxCursor = PROXY_RES * PROXY_RES; // = finished, so the first update starts a sweep
    this._pxNextOX = 0;
    this._pxNextOZ = 0;
    this.proxy = new DataTexture(this._pxData, PROXY_RES, PROXY_RES, RedFormat, HalfFloatType);
    this.proxy.minFilter = LinearFilter;
    this.proxy.magFilter = LinearFilter;
    this.proxy.wrapS = ClampToEdgeWrapping;
    this.proxy.wrapT = ClampToEdgeWrapping;
    this.proxy.needsUpdate = true;
    this._seed = (opt.seed ?? 4242) >>> 0;
    /** World seed the proxy heights come from — must match the streamer's, or the wind
     *  would accelerate over hills that are not there. */
    this.worldSeed = (opt.worldSeed ?? 20260726) >>> 0;

    /* ── the fullscreen pass ── */
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    g.boundingSphere = new Sphere(new Vector3(), 10);
    this._quadGeo = g;
    this._quadScene = new Scene();
    this._quadCam = new Camera();
    const cellA = [];
    const cellB = [];
    for (let i = 0; i < 6; i++) {
      cellA.push(new Vector4());
      cellB.push(new Vector4());
    }
    this._uni = {
      uTime: U.uTime,
      uWindOrigin: U.uWindOrigin,
      uMeanWind: WIND_U.uMeanWind,
      uCellA: { value: cellA },
      uCellB: { value: cellB },
      uFwd: { value: new Vector2(fx, fz) },
      uSide: { value: new Vector2(-fz, fx) },
      uGustiness: { value: 1.0 },
      uTurbI: { value: 0.26 },
      uWindTerr: { value: this.proxy },
      uWindTerrO: { value: new Vector3(0, 0, 1 / PROXY_SPAN) },
    };
    this.material = new RawShaderMaterial({
      glslVersion: '300 es',
      vertexShader: QUAD_VS,
      fragmentShader: WIND_FS,
      uniforms: this._uni,
      depthTest: false,
      depthWrite: false,
    });
    this._quad = new Mesh(g, this.material);
    this._quad.frustumCulled = false;
    this._quadScene.add(this._quad);
  }

  /** Which world the proxy heights come from. Call once, before the first `update`. */
  setSeed(seed) {
    this.worldSeed = seed >>> 0;
    this._pxCursor = PROXY_RES * PROXY_RES; // restart the sweep against the new world
    return this;
  }

  /**
   * Advance the simulation and, on its own cadence, re-render the field.
   * @param {number} dt seconds
   * @param {{x:number,y:number,z:number}} camPos
   */
  update(dt, camPos) {
    const r = this._r;
    this.time += dt;

    // Ornstein-Uhlenbeck meander of the mean flow: 25 s for speed, 40 s for direction.
    const kS = 1 - Math.exp(-dt / 25);
    const kD = 1 - Math.exp(-dt / 40);
    this.tgtSpeed = clamp(this.tgtSpeed + (r() - 0.5) * dt * 2.4, this.baseSpeed * 0.62, this.baseSpeed * 1.45);
    this.tgtDir = clamp(this.tgtDir + (r() - 0.5) * dt * 0.16, this.baseDir - 0.34, this.baseDir + 0.34);
    this.meanSpeed += (this.tgtSpeed - this.meanSpeed) * kS;
    this.meanDir += (this.tgtDir - this.meanDir) * kD;

    // direction the air travels toward
    const fx = Math.sin(this.meanDir + Math.PI);
    const fz = Math.cos(this.meanDir + Math.PI);
    this.vec.set(fx * this.meanSpeed, fz * this.meanSpeed);
    this.fwd[0] = fx;
    this.fwd[1] = fz;
    this.side[0] = -fz;
    this.side[1] = fx;

    // gust cells ride downwind faster than the mean flow
    const adv = this.meanSpeed * 1.25 * dt;
    for (const c of this.cells) {
      c.s += adv;
      c.life += dt;
      // measure the cell head relative to the camera along the wind axis
      const rel = c.s - (camPos.x * fx + camPos.z * fz);
      if (rel > 620) {
        c.s -= 1560 + r() * 280;
        c.c = (r() - 0.5) * 940;
        c.len = 26 + r() * 34;
        c.wid = 70 + r() * 130;
        c.amp = 0.8 + r() * 1.4;
        c.veer = (r() - 0.5) * 0.44;
        c.life = 0;
      }
    }

    // the cloud deck runs faster and slightly veered from the surface wind
    const cd = this.meanDir + Math.PI + 0.19;
    this.cloudWind.set(Math.sin(cd) * this.meanSpeed * 2.35, Math.cos(cd) * this.meanSpeed * 2.35);
    this.cloudDrift.x += this.cloudWind.x * dt;
    this.cloudDrift.y += this.cloudWind.y * dt;

    WIND_U.uMeanWind.value.copy(this.vec);
    // The blade's response lag, as a vector, once per frame instead of once per vertex:
    // every material that sways samples the field this far upwind of itself.
    const l = Math.hypot(this.vec.x, this.vec.y) || 1;
    U.uWindLag.value.set((this.vec.x / l) * WIND_LAG_M, (this.vec.y / l) * WIND_LAG_M);

    this._stepProxy(camPos);

    if (this._frame % this.everyNthFrame === 0) this._pass(camPos);
    this._frame++;
  }

  /** Refill a slice of the height proxy and swap it in when the sweep completes. */
  _stepProxy(camPos) {
    const n = PROXY_RES * PROXY_RES;
    if (this._pxCursor >= n) {
      // start a fresh sweep centred where the camera is now
      this._pxNextOX = camPos.x;
      this._pxNextOZ = camPos.z;
      this._pxCursor = 0;
    }
    const step = PROXY_SPAN / (PROXY_RES - 1);
    const x0 = this._pxNextOX - PROXY_SPAN * 0.5;
    const z0 = this._pxNextOZ - PROXY_SPAN * 0.5;
    const end = Math.min(n, this._pxCursor + PROXY_PER_FRAME);
    for (let k = this._pxCursor; k < end; k++) {
      const i = k % PROXY_RES;
      const j = (k / PROXY_RES) | 0;
      // Raw land, not the road-carved height: the wind cares about the hill, and a 6 m
      // cutting is two orders of magnitude below one proxy texel anyway.
      this._pxNext[k] = landHeight(x0 + i * step, z0 + j * step, this.worldSeed);
    }
    this._pxCursor = end;
    if (end >= n) {
      for (let k = 0; k < n; k++) this._pxData[k] = DataUtils.toHalfFloat(this._pxNext[k]);
      this.proxy.needsUpdate = true;
      this._uni.uWindTerrO.value.set(this._pxNextOX, this._pxNextOZ, 1 / PROXY_SPAN);
    }
  }

  /** Render the field. Sets `U.uWindOrigin` so the content and the sampling agree. */
  _pass(camPos) {
    const u = this._uni;
    U.uWindOrigin.value.set(camPos.x, camPos.z);
    u.uFwd.value.set(this.fwd[0], this.fwd[1]);
    u.uSide.value.set(this.side[0], this.side[1]);
    u.uGustiness.value = this.gustiness;
    for (let i = 0; i < 6; i++) {
      const c = this.cells[i];
      u.uCellA.value[i].set(c.s, c.c, c.len, c.wid);
      u.uCellB.value[i].set(c.amp, c.veer, c.life, 0);
    }
    const renderer = this.renderer;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this._quadScene, this._quadCam);
    renderer.setRenderTarget(prev);
  }

  /**
   * The CPU mirror of the field — audio, smoke, birds, the car's aerial and the chase
   * camera all read this. It reproduces the gust cells and two octaves of the turbulence
   * exactly; it does not reproduce the terrain coupling, which lives only on the GPU.
   * @param {number} x world x
   * @param {number} z world z
   * @param {number} [height] metres above the ground, for the boundary-layer profile
   * @returns {{x:number, z:number, gust:number, speed:number}}
   */
  sample(x, z, height) {
    const fx = this.fwd[0];
    const fz = this.fwd[1];
    const sx = this.side[0];
    const sz = this.side[1];
    let vx = this.vec.x;
    let vz = this.vec.y;
    const along = x * fx + z * fz;
    const crossS = x * sx + z * sz;
    let gustW = 0;
    let veer = 0;
    for (const c of this.cells) {
      const u = (along - c.s) / c.len;
      if (u > 0.16 || u < -6.0) continue;
      const head = smoothstep(0.14, 0.0, u);
      const body = Math.exp(u * 2.05);
      const cw = Math.exp(-Math.pow(Math.abs(crossS - c.c) / (c.wid * 0.5), 2.3));
      const g = c.amp * head * body * cw * this.gustiness;
      gustW += g;
      veer += g * c.veer;
    }
    // 2-octave turbulence mirror
    const t = this.time;
    const q1x = (x - this.vec.x * t) * 0.0125;
    const q1z = (z - this.vec.y * t) * 0.0125;
    const n1 = noise2(q1x, q1z, this._seed);
    const n1b = noise2(q1x + 3.7, q1z - 1.9, this._seed);
    const q2x = q1x * 2.6;
    const q2z = q1z * 2.6;
    const n2 = noise2(q2x + 11, q2z + 5, this._seed);
    const n2b = noise2(q2x - 7, q2z + 13, this._seed);
    vx += (n1 * 1.0 + n2 * 0.79) * this.meanSpeed * 0.19;
    vz += (n1b * 1.0 + n2b * 0.79) * this.meanSpeed * 0.19;
    // gust adds magnitude and veers the direction
    const gs = 1 + gustW * 0.85;
    const ca = Math.cos(veer);
    const sa = Math.sin(veer);
    const rx = (vx * ca - vz * sa) * gs;
    const rz = (vx * sa + vz * ca) * gs;
    const prof = height === undefined ? 1 : Math.log((Math.max(height, 0.015) + 0.06) / 0.06) * 0.19523;
    return { x: rx * prof, z: rz * prof, gust: gustW, speed: Math.hypot(rx, rz) * prof };
  }

  dispose() {
    this.rt.dispose();
    this.proxy.dispose();
    this.material.dispose();
    this._quadGeo.dispose();
    if (U.uWindTex.value === this.rt.texture) U.uWindTex.value = null;
  }
}
