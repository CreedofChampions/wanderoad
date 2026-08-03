/* Wanderoad — the post chain.
 *
 * The palette in `core/palette.js` was authored against the pen's own composite, not against
 * three's ACESFilmic. Rendering the scene straight to the canvas therefore loses the art
 * direction wholesale: ACES crushes the shadow end where the pen lifts it, desaturates the
 * midtones where the pen pushes them, and there is no bloom, no wet-in-wet softening, no
 * paper tooth and no warm-dark vignette at all. Everything below is the pen's
 * BRIGHT_FS / DOWN_FS / UP_FS / BLUR_FS / COMPOSITE_FS chain, with its constants intact.
 *
 * Pass order (identical to the pen's `postChain()`):
 *   scene -> sceneRT (RGBA16F + depth; alpha carries gFogAmt from `aerial()`)
 *   bright pass       sceneRT      -> bloom[0]        threshold 1.02, knee 0.75
 *   downsample x N-1  bloom[i-1]   -> bloom[i]        13-tap Kawase-ish box
 *   upsample   x N-1  bloom/up     -> up[i]           3x3 tent, radius 1.4, additive
 *   soft down         sceneRT      -> soft[0]         one DOWN at 1/8 res
 *   soft blur H,V     soft[0..1]   -> soft[0]         5-tap linear gaussian
 *   composite         all three    -> canvas          FXAA, CA, tonemap, grade, grain, vignette
 *
 * The scene target MUST be half-float: the sun disc and specular highlights land well above
 * 1.0 and the whole bloom threshold (1.02) is defined in that headroom. On an 8-bit target
 * everything clamps at 1.0 and the bright pass extracts nothing.
 *
 * On top of the pen: three speed cues for the driving game, all keyed off `post.speed` and
 * `post.limit`, all computed on the CPU into single uniforms so the GPU branch is uniform
 * across the whole warp and costs nothing when the car is parked.
 */

import {
  BufferGeometry, BufferAttribute, Sphere, Vector2, Vector3, Camera, Scene, Mesh,
  RawShaderMaterial, WebGLRenderTarget, HalfFloatType, UnsignedByteType, RGBAFormat,
  LinearFilter, ClampToEdgeWrapping, NoToneMapping, LinearSRGBColorSpace,
} from 'three';
import { vertHead, fragHead, GL_HASH, GL_NOISE } from '../core/glsl.js';
import { sharedUniforms } from './uniforms.js';

/* ── the pen's constants ───────────────────────────────────────────────────────
 * Changing any of these changes the painting. They are here, named, so that is a
 * deliberate act rather than a typo in a shader string. */
const BLOOM_LEVELS = 5;      // QUALITY[2].bloomLv — the pen's default preset
const BLOOM_THRESH = 1.02;   // linear luma where the bright pass starts to take
const BLOOM_KNEE = 0.75;     // smoothstep width above the threshold
const BLOOM_AMOUNT = 0.62;   // composite mix, tinted 55% toward K_SUN
const UP_RADIUS = 1.4;       // tent radius of the upsample, in destination texels
const VIGNETTE = 0.85;       // the painting's own vignette; NOT the speed one

/* ── speed cues (TDU research) ─────────────────────────────────────────────────
 * Radial blur below 0.36 of top speed reads as a dirty lens rather than as speed, so it is
 * gated off entirely there. The gate is a short smoothstep rather than a hard `if` because a
 * step discontinuity in a full-screen effect pops visibly on the frame it crosses. */
const RADIAL_MAX = 0.38;     // blend weight of the streaked copy at s = 1
const RADIAL_ON = 0.36;      // below this, no streak at all
const RADIAL_FADE = 0.44;    // fully on by here
const VIG_SPEED_BASE = 0.10; // speed vignette at rest
const VIG_SPEED_GAIN = 0.14; // ...and at s = 1 (0.24 total)
const CA_LIMIT = 0.06;       // grip-limit chromatic aberration, see the shader comment

const QUAD_VS = /* glsl */ `
in vec2 uv;
out vec2 vUv;
void main(){
  // One oversized triangle, not two triangles: no diagonal seam for the FXAA pass to find
  // and one less vertex-shader invocation per full-screen pass.
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BRIGHT_FS = /* glsl */ `
uniform sampler2D uSrc; uniform float uThresh; uniform float uSoft;
in vec2 vUv; out vec4 outColor;
void main(){
  // the NaN firewall lives here too: one bad texel entering the bloom pyramid gets
  // smeared over a whole neighbourhood by the downsample chain
  vec3 c = SAFE3(texture(uSrc, vUv).rgb);
  float l = dot(c, vec3(0.2126,0.7152,0.0722));
  float k = smoothstep(uThresh, uThresh+uSoft, l);
  outColor = vec4(c*k, 1.0);
}`;

const DOWN_FS = /* glsl */ `
uniform sampler2D uSrc; uniform vec2 uTexel;
in vec2 vUv; out vec4 outColor;
void main(){
  vec2 t=uTexel;
  vec3 a=texture(uSrc,vUv+t*vec2(-2,-2)).rgb, b=texture(uSrc,vUv+t*vec2(0,-2)).rgb, c=texture(uSrc,vUv+t*vec2(2,-2)).rgb;
  vec3 d=texture(uSrc,vUv+t*vec2(-2, 0)).rgb, e=texture(uSrc,vUv).rgb,               f=texture(uSrc,vUv+t*vec2(2, 0)).rgb;
  vec3 g=texture(uSrc,vUv+t*vec2(-2, 2)).rgb, h=texture(uSrc,vUv+t*vec2(0, 2)).rgb, i=texture(uSrc,vUv+t*vec2(2, 2)).rgb;
  vec3 j=texture(uSrc,vUv+t*vec2(-1,-1)).rgb, k=texture(uSrc,vUv+t*vec2(1,-1)).rgb;
  vec3 l=texture(uSrc,vUv+t*vec2(-1, 1)).rgb, m=texture(uSrc,vUv+t*vec2(1, 1)).rgb;
  vec3 o = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
  outColor = vec4(o,1.0);
}`;

const UP_FS = /* glsl */ `
uniform sampler2D uSrc; uniform sampler2D uPrev; uniform vec2 uTexel; uniform float uRadius;
in vec2 vUv; out vec4 outColor;
void main(){
  vec2 t=uTexel*uRadius;
  vec3 s = texture(uSrc,vUv+t*vec2(-1,-1)).rgb*1.0 + texture(uSrc,vUv+t*vec2(0,-1)).rgb*2.0
         + texture(uSrc,vUv+t*vec2( 1,-1)).rgb*1.0 + texture(uSrc,vUv+t*vec2(-1,0)).rgb*2.0
         + texture(uSrc,vUv).rgb*4.0                + texture(uSrc,vUv+t*vec2( 1,0)).rgb*2.0
         + texture(uSrc,vUv+t*vec2(-1, 1)).rgb*1.0 + texture(uSrc,vUv+t*vec2(0, 1)).rgb*2.0
         + texture(uSrc,vUv+t*vec2( 1, 1)).rgb*1.0;
  outColor = vec4(texture(uPrev,vUv).rgb + s/16.0, 1.0);
}`;

const BLUR_FS = /* glsl */ `
uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uDir;
in vec2 vUv; out vec4 outColor;
void main(){
  vec2 d = uTexel*uDir;
  vec3 c = texture(uSrc,vUv).rgb*0.227;
  c += (texture(uSrc,vUv+d*1.3846).rgb + texture(uSrc,vUv-d*1.3846).rgb)*0.316;
  c += (texture(uSrc,vUv+d*3.2308).rgb + texture(uSrc,vUv-d*3.2308).rgb)*0.070;
  outColor = vec4(c,1.0);
}`;

const COMPOSITE_FS = /* glsl */ `
uniform sampler2D uScene, uBloom, uSoft;
uniform vec2  uRes;
uniform float uExposure, uBloomAmt, uPaint, uCA, uVignette, uGrain;
uniform float uRadial, uVigSpeed, uCALimit;
in vec2 vUv; out vec4 outColor;

/*  Luma FXAA.  A million-blade meadow is the worst possible case for spatial
    aliasing, which is why the scene used to be brute-force supersampled at
    1.3x.  Resolving the edges here instead buys back 1.45x of the entire
    fragment budget — every shaded pixel in the frame — for five extra taps in
    one full-screen pass.  Blades are already floored to ~1 px wide by the grass
    shader, so there is nothing thinner than a pixel for it to smear.         */
// The buffer is linear HDR, where a sunlit blade can sit at 1.5 and a shaded
// one at 0.03.  Thresholding raw linear luma makes FXAA fire almost nowhere in
// the light and everywhere in the dark; folding it through the same Reinhard
// shape the eye will see puts every threshold back in the range the algorithm
// was designed for, which is the difference between it working on grass and not.
float fxLuma(vec3 c){ c = c/(c + vec3(1.0)); return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec3 fxaa(sampler2D tex, vec2 uv, vec2 rcp, vec3 mC){
  float lNW = fxLuma(texture(tex, uv + vec2(-1.0,-1.0)*rcp).rgb);
  float lNE = fxLuma(texture(tex, uv + vec2( 1.0,-1.0)*rcp).rgb);
  float lSW = fxLuma(texture(tex, uv + vec2(-1.0, 1.0)*rcp).rgb);
  float lSE = fxLuma(texture(tex, uv + vec2( 1.0, 1.0)*rcp).rgb);
  float lM  = fxLuma(mC);
  float lMin = min(lM, min(min(lNW,lNE), min(lSW,lSE)));
  float lMax = max(lM, max(max(lNW,lNE), max(lSW,lSE)));
  if(lMax - lMin < max(0.016, lMax*0.055)) return mC;   // flat: leave it alone
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float red = max((lNW+lNE+lSW+lSE)*0.0156, 0.0039);
  float rcpDir = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir*rcpDir, vec2(-6.0), vec2(6.0)) * rcp;
  vec3 a = 0.5*(texture(tex, uv + dir*(1.0/3.0 - 0.5)).rgb
              + texture(tex, uv + dir*(2.0/3.0 - 0.5)).rgb);
  vec3 b = a*0.5 + 0.25*(texture(tex, uv - dir*0.5).rgb + texture(tex, uv + dir*0.5).rgb);
  float lB = fxLuma(b);
  return (lB < lMin || lB > lMax) ? a : b;
}

vec3 tonemap(vec3 x){
  x = max(x, vec3(0.0));
  vec3 a = x*(x*0.36 + 0.42);
  vec3 b = x*(x*0.34 + 0.66) + 0.11;
  return clamp(a/b, 0.0, 1.0);
}
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
vec3 toSRGB(vec3 c){
  return mix(c*12.92, 1.055*pow(max(c,vec3(1e-5)), vec3(1.0/2.4))-0.055, step(0.0031308, c));
}

// Speed streak. Six taps between the pixel and the vanishing point, spanning 3.5% of the
// radius vector — ~38 px at the corner of a 1080p frame, ~0 in the middle of it.
const int   RB_TAPS = 6;
const float RB_SPAN = 0.035;

void main(){
  vec2 uv = vUv;
  vec2 d  = uv - 0.5;
  float r2 = dot(d,d);

  // ── edge resolve, then a whisper of chromatic aberration at the rim ────
  // the centre texel was being fetched four separate times — by FXAA, twice by
  // the aberration and once for the fog weight.  One fetch, passed around.
  vec4 src = texture(uScene, uv);
  vec2 rcp = 1.0/uRes;
  vec3 c = SAFE3(fxaa(uScene, uv, rcp, src.rgb));
  // uCALimit is 0.06*limit^2 from the CPU. It rides an r2*r2 falloff, not the pen's r2, so
  // the grip fringe is confined to the outer corners: at the limit it reaches 0.015 (~14 px
  // of split at 1080p, at the very corner) and is already under 2 px by mid-frame. On the
  // pen's own r2 falloff a term that size would tear a rainbow across the whole image.
  float ca = uCA * (0.0016 + r2*0.0060) + uCALimit*r2*r2;
  c.r += texture(uScene, uv + d*ca).r - src.r;
  c.b += texture(uScene, uv - d*ca).b - src.b;
  c = SAFE3(c);
  float fogW = src.a;

  // ── speed streak ───────────────────────────────────────────────────────
  // uRadial is the blend weight of the streaked copy, not the tap span: the frame never
  // loses its edges, it gains a ghost of them trailing outward. The vanishing point is
  // held sharp — smearing it too reads as a tunnel, not as velocity.
  if(uRadial > 0.0){
    vec2 st = d * (RB_SPAN / float(RB_TAPS));
    vec3 acc = vec3(0.0);
    for(int i=1;i<=RB_TAPS;i++) acc += texture(uScene, uv - st*float(i)).rgb;
    c = mix(c, SAFE3(acc/float(RB_TAPS)), uRadial * smoothstep(0.02, 0.20, r2));
  }

  // ── watercolour softening with distance (wet-in-wet, not bokeh) ────────
  // fogW is gFogAmt, written into the alpha channel by aerial() in every world shader.
  vec3 soft = texture(uSoft, uv).rgb;
  float wet = clamp(fogW*0.85, 0.0, 1.0);
  c = mix(c, soft, wet * 0.42 * uPaint);

  // ── chroma bleed: paint runs, pixels do not ────────────────────────────
  // this used to be a flat 20% everywhere, which quietly smeared the colour of
  // near detail too; it belongs to distance, like the softening it accompanies
  {
    float lc = luma(c);
    vec3 chroma = soft - vec3(luma(soft));
    c = mix(c, vec3(lc) + chroma, (0.09 + 0.17*wet)*uPaint);
  }

  // ── bloom ──────────────────────────────────────────────────────────────
  vec3 bl = texture(uBloom, uv).rgb;
  c += bl * uBloomAmt * mix(vec3(1.0), K_SUN, 0.55);

  // ── the print ──────────────────────────────────────────────────────────
  // last chance: the soft/bloom chains are sampled here and a single bad texel
  // anywhere upstream would otherwise survive the tonemap as a solid block
  c = SAFE3(c) * uExposure;
  c = tonemap(c);

  // shadows to violet, highlights to cream — the single biggest lever
  float l = luma(c);
  /* WARMED, because this was most of "the land reads more blue than green to the eye".
   *
   * It was vec3(0.90, 0.95, 1.16): in anything darker than mid-grey it multiplied BLUE by 1.16 and
   * RED by 0.90 — a 29% blue-over-red push, applied hardest to exactly the mid-dark pixels a
   * hillside of grass is made of. It is a conventional cool-shadow film grade and it looks lovely
   * on a city street; on a meadow it turns the ground grey-blue.
   *
   * Measured, parked at a fixed spot on an identical 58330-pixel region: the ground WITHOUT grass
   * read r114.2 g114.2 b121.2 — blue 7.0 above red and green exactly equal to red, i.e. no green
   * left in the land at all. Aerial haze and the grass distance-convergence were both eliminated
   * first (K_MIST #D6DDD4 and tMid #6A924F are strongly green-dominant and can only push greener),
   * which is what left the grade as the candidate.
   *
   * Halved rather than removed: the cool shadow is doing real work separating shaded ground from
   * lit ground, and flattening it to neutral would trade one complaint for another. */
  vec3 shadowPush = mix(vec3(0.96,0.98,1.07), vec3(1.0), smoothstep(0.0, 0.34, l));
  vec3 highPush   = mix(vec3(1.0), vec3(1.055,1.012,0.925), smoothstep(0.44, 0.98, l));
  c *= mix(vec3(1.0), shadowPush, 0.85*uPaint) * mix(vec3(1.0), highPush, 0.9*uPaint);
  // lift: nothing in a Ghibli frame is ever pure black
  /* The lift is the same story an order smaller: blue was raised more than twice as far as red into
   * the blacks (0.036 against 0.017). Brought together so the shadows lift neutrally. */
  vec3 lift = vec3(0.024, 0.025, 0.028)*uPaint;
  c = c*(1.0 - lift) + lift;
  // gentle S and a nudge of saturation in the midtones
  c = mix(c, c*c*(3.0-2.0*c), 0.16*uPaint);
  l = luma(c);
  float satBoost = 1.0 + 0.16*uPaint*smoothstep(0.10,0.42,l)*(1.0-smoothstep(0.62,0.96,l));
  c = mix(vec3(l), c, satBoost);

  // ── paper tooth ────────────────────────────────────────────────────────
  // two gradient-noise evaluations, not four: this is a +/-3% multiplier on the
  // final colour, and it runs on every pixel of the frame
  vec2 gp = uv*uRes/2.4;
  float grain = pn2(gp*0.5)*0.62 + pn2(gp*0.13 + 11.0)*0.38;
  float fibre = pn2(vec2(uv.x*uRes.x*0.06, uv.y*uRes.y*0.9));
  c *= 1.0 + grain*0.030*uGrain + fibre*0.010*uGrain;

  // ── vignette, warm-dark ────────────────────────────────────────────────
  float vig = pow(clamp(1.0 - r2*1.15, 0.0, 1.0), 1.55);
  c *= mix(vec3(1.0), mix(vec3(0.62,0.60,0.66), vec3(1.0), vig), uVignette);
  // ...and the speed vignette on top of it: tighter (r2*2.1 vs 1.15) and cooler, so it
  // closes in from the corners as the car winds up instead of just re-darkening the frame.
  float vigS = pow(clamp(1.0 - r2*2.10, 0.0, 1.0), 1.10);
  c *= mix(vec3(1.0), mix(vec3(0.55,0.55,0.60), vec3(1.0), vigS), uVigSpeed);

  c = toSRGB(clamp(c, 0.0, 1.0));

  // ── ordered dither: the sky must never band ────────────────────────────
  float dth = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402909)));
  c += (dth - 0.5)/255.0;
  outColor = vec4(c, 1.0);
}`;

/** The pen's `postMat`: a full-screen RawShaderMaterial on the shared uniform block. */
function postMat(fs, extra, chunks = []) {
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(extra),
    vertexShader: vertHead(QUAD_VS),
    fragmentShader: fragHead(...chunks, fs),
    depthTest: false,
    depthWrite: false,
  });
}

export class Post {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {{width:number, height:number, pixelRatio?:number, renderScale?:number,
   *          bloomLevels?:number}} opts
   *   `renderScale` multiplies the device pixel ratio for the scene buffer (the pen's
   *   `State.scale`); >1 supersamples, <1 renders below the canvas and resolves up.
   */
  constructor(renderer, { width, height, pixelRatio = 1, renderScale = 1, bloomLevels = BLOOM_LEVELS } = {}) {
    this.renderer = renderer;
    this.pixelRatio = pixelRatio;
    this.renderScale = renderScale;
    this.bloomLevels = Math.max(1, bloomLevels | 0);

    /* Driving cues, written by the lead each frame. */
    this.speed = 0;   // 0..1 of top speed
    this.limit = 0;   // 0..1 of the tyre grip circle

    /* The pen's `State.exposure / .bloom / .paint`. `paint` at 0 gives a plain tonemap with
     * no grade, grain, aberration or watercolour — useful for debugging what the shaders
     * actually output, and nothing else. */
    this.exposure = 1;
    this.bloom = 1;
    this.paint = 1;

    this._quality = 1;

    /* We encode sRGB and tonemap by hand in the composite. three's own tone map and output
     * conversion must both be off or the frame is graded twice — and asserting it here,
     * rather than trusting main.js to have done it before Post was constructed, is what
     * makes this module the single owner of the final image. */
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;

    /* Rendering to RGBA16F needs an explicit extension even on WebGL2. Without it the
     * targets silently fail to be framebuffer-complete, so ask first and fall back to 8-bit
     * rather than render a black frame; the bloom loses its headroom but the game runs. */
    const gl = renderer.getContext();
    const halfOK = !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
    this._type = halfOK ? HalfFloatType : UnsignedByteType;
    if (!halfOK) {
      console.error('[post] no renderable half-float target; HDR bloom disabled (threshold 1.02 is unreachable on an 8-bit buffer)');
    }

    /* Fullscreen triangle. The bounding sphere is set by hand because three computes one
     * from the positions only on demand, and a culled post pass is a black screen. */
    this._quadGeo = new BufferGeometry();
    this._quadGeo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this._quadGeo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this._quadGeo.boundingSphere = new Sphere(new Vector3(), 10);
    this._quadCam = new Camera();
    this._quadScene = new Scene();
    this._quadMesh = new Mesh(this._quadGeo, null);
    this._quadMesh.frustumCulled = false;
    this._quadScene.add(this._quadMesh);

    this._bright = postMat(BRIGHT_FS, {
      uSrc: { value: null },
      uThresh: { value: BLOOM_THRESH },
      uSoft: { value: BLOOM_KNEE },
    });
    /* One material per pyramid step: they differ only in their texel size, and sharing one
     * would mean re-uploading that uniform between blits of the same frame. */
    this._downMats = [];
    this._upMats = [];
    for (let i = 1; i < this.bloomLevels; i++) {
      this._downMats.push(postMat(DOWN_FS, { uSrc: { value: null }, uTexel: { value: new Vector2(1, 1) } }));
      this._upMats.push(postMat(UP_FS, {
        uSrc: { value: null }, uPrev: { value: null },
        uTexel: { value: new Vector2(1, 1) }, uRadius: { value: UP_RADIUS },
      }));
    }
    this._softDown = postMat(DOWN_FS, { uSrc: { value: null }, uTexel: { value: new Vector2(1, 1) } });
    this._blurMats = [0, 1].map((i) => postMat(BLUR_FS, {
      uSrc: { value: null },
      uTexel: { value: new Vector2(1, 1) },
      uDir: { value: new Vector2(i ? 0 : 1, i ? 1 : 0) },
    }));
    this._composite = postMat(COMPOSITE_FS, {
      uScene: { value: null }, uBloom: { value: null }, uSoft: { value: null },
      uRes: { value: new Vector2(1, 1) },
      uExposure: { value: 1 }, uBloomAmt: { value: BLOOM_AMOUNT }, uPaint: { value: 1 },
      uCA: { value: 1 }, uVignette: { value: VIGNETTE }, uGrain: { value: 1 },
      uRadial: { value: 0 }, uVigSpeed: { value: VIG_SPEED_BASE }, uCALimit: { value: 0 },
    }, [GL_HASH, GL_NOISE]);

    this._sceneRT = null;
    this._bloomRTs = [];
    this._upRTs = [];
    this._softRTs = [];
    this.setSize(width, height);
  }

  /** 0.5..1 — scales the bloom pyramid's base resolution. The scene buffer never changes. */
  get quality() { return this._quality; }
  set quality(v) {
    const q = Math.min(1, Math.max(0.5, v));
    if (q === this._quality) return;
    this._quality = q;
    this._buildBloom();
  }

  /** The target the scene must be rendered into — half-float, with depth. */
  get target() { return this._sceneRT; }

  /** Buffer size in device pixels, after pixelRatio and renderScale. */
  get bufferWidth() { return this._w; }
  get bufferHeight() { return this._h; }

  setSize(width, height) {
    const px = this.pixelRatio * this.renderScale;
    const w = Math.max(16, Math.floor(width * px));
    const h = Math.max(16, Math.floor(height * px));
    if (this._sceneRT && w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;

    if (this._sceneRT) this._sceneRT.dispose();
    this._sceneRT = new WebGLRenderTarget(w, h, {
      type: this._type, format: RGBAFormat,
      minFilter: LinearFilter, magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
      depthBuffer: true, stencilBuffer: false,
      samples: 0,   // FXAA in the composite resolves edges instead — see the pen's note
    });
    this._composite.uniforms.uRes.value.set(w, h);

    /* The watercolour buffer is a fixed 1/8 of the scene: its blur radius in *screen* terms
     * is what makes distance read as wet-in-wet, so it is not quality-scaled. */
    this._softRTs.forEach((r) => r.dispose());
    this._softRTs = [0, 1].map(() => this._mkRT(Math.max(2, w >> 3), Math.max(2, h >> 3)));
    this._blurMats.forEach((m) => m.uniforms.uTexel.value.set(1 / this._softRTs[0].width, 1 / this._softRTs[0].height));

    this._buildBloom();
  }

  _mkRT(w, h) {
    return new WebGLRenderTarget(w, h, {
      type: this._type, format: RGBAFormat,
      minFilter: LinearFilter, magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping, wrapT: ClampToEdgeWrapping,
      depthBuffer: false, stencilBuffer: false,
    });
  }

  _buildBloom() {
    this._bloomRTs.forEach((r) => r.dispose());
    this._upRTs.forEach((r) => r.dispose());
    this._bloomRTs = [];
    this._upRTs = [];
    let bw = Math.max(2, Math.floor(this._w * this._quality) >> 1);
    let bh = Math.max(2, Math.floor(this._h * this._quality) >> 1);
    for (let i = 0; i < this.bloomLevels; i++) {
      this._bloomRTs.push(this._mkRT(bw, bh));
      this._upRTs.push(this._mkRT(bw, bh));
      bw = Math.max(2, bw >> 1);
      bh = Math.max(2, bh >> 1);
    }
  }

  _blit(mat, target) {
    this._quadMesh.material = mat;
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(this._quadScene, this._quadCam);
  }

  render(scene, camera) {
    const r = this.renderer;
    /* Re-asserted per frame: anything that touches the renderer between frames (a screenshot
     * path, a UI overlay, a hot reload) can put ACES back and silently re-grade the frame. */
    if (r.toneMapping !== NoToneMapping) r.toneMapping = NoToneMapping;
    if (r.outputColorSpace !== LinearSRGBColorSpace) r.outputColorSpace = LinearSRGBColorSpace;

    r.setRenderTarget(this._sceneRT);
    r.render(scene, camera);

    // bright pass -> the base of the pyramid
    this._bright.uniforms.uSrc.value = this._sceneRT.texture;
    this._blit(this._bright, this._bloomRTs[0]);

    const n = this._bloomRTs.length;
    for (let i = 1; i < n; i++) {
      const m = this._downMats[i - 1];
      m.uniforms.uSrc.value = this._bloomRTs[i - 1].texture;
      m.uniforms.uTexel.value.set(1 / this._bloomRTs[i - 1].width, 1 / this._bloomRTs[i - 1].height);
      this._blit(m, this._bloomRTs[i]);
    }
    // ...and back up, each level adding the sharper mip it was made from
    for (let k = 0; k < n - 1; k++) {
      const i = n - 2 - k;
      const m = this._upMats[k];
      m.uniforms.uSrc.value = (k === 0) ? this._bloomRTs[n - 1].texture : this._upRTs[i + 1].texture;
      m.uniforms.uPrev.value = this._bloomRTs[i].texture;
      m.uniforms.uTexel.value.set(1 / this._upRTs[i].width, 1 / this._upRTs[i].height);
      this._blit(m, this._upRTs[i]);
    }

    /* The soft buffer's downsample deliberately uses the DESTINATION texel size, so the
     * 13-tap box reaches 8x further than a plain 1/8 downsample would: it is the first half
     * of the watercolour blur, not a mip. */
    this._softDown.uniforms.uSrc.value = this._sceneRT.texture;
    this._softDown.uniforms.uTexel.value.set(1 / this._softRTs[0].width, 1 / this._softRTs[0].height);
    this._blit(this._softDown, this._softRTs[0]);
    this._blurMats[0].uniforms.uSrc.value = this._softRTs[0].texture;
    this._blit(this._blurMats[0], this._softRTs[1]);
    this._blurMats[1].uniforms.uSrc.value = this._softRTs[1].texture;
    this._blit(this._blurMats[1], this._softRTs[0]);

    const s = Math.min(1, Math.max(0, this.speed));
    const lim = Math.min(1, Math.max(0, this.limit));
    const u = this._composite.uniforms;
    u.uScene.value = this._sceneRT.texture;
    u.uBloom.value = (n > 1 ? this._upRTs[0] : this._bloomRTs[0]).texture;
    u.uSoft.value = this._softRTs[0].texture;
    u.uExposure.value = this.exposure;
    u.uBloomAmt.value = BLOOM_AMOUNT * this.bloom;
    u.uPaint.value = this.paint;
    u.uCA.value = this.paint;
    u.uVignette.value = VIGNETTE;
    u.uGrain.value = this.paint;
    // s^2 so the streak is imperceptible through the whole usable part of the range and
    // only arrives at the top end, where the road is actually moving fast enough to earn it
    u.uRadial.value = RADIAL_MAX * s * s * smoothStep(RADIAL_ON, RADIAL_FADE, s);
    u.uVigSpeed.value = VIG_SPEED_BASE + VIG_SPEED_GAIN * s;
    // squared as well: a fringe that grows linearly with the grip circle is visible while
    // merely cornering, which is not what it is for
    u.uCALimit.value = CA_LIMIT * lim * lim;
    this._blit(this._composite, null);
  }

  dispose() {
    if (this._sceneRT) this._sceneRT.dispose();
    this._bloomRTs.forEach((r) => r.dispose());
    this._upRTs.forEach((r) => r.dispose());
    this._softRTs.forEach((r) => r.dispose());
    this._sceneRT = null;
    this._bloomRTs = [];
    this._upRTs = [];
    this._softRTs = [];
    [this._bright, this._softDown, this._composite, ...this._downMats, ...this._upMats, ...this._blurMats]
      .forEach((m) => m.dispose());
    this._quadGeo.dispose();
    this._quadScene.remove(this._quadMesh);
    this._quadMesh.material = null;
  }
}

/** smoothstep, kept local: importing core/math.js for one curve would drag the whole module
 * into the render path for nothing. */
function smoothStep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
