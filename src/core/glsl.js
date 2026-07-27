/* Wanderoad — shared GLSL library.
 *
 * Ported from the Hoshi-no-Tani pen (`hoshi.html`, §2 GLSL LIBRARY — the block between
 * §1 MATH/NOISE and §3 TERRAIN). One physics, one palette, one sky: these chunks are
 * concatenated into every RawShaderMaterial the game builds, so a renamed uniform or
 * function here breaks every downstream shader. Nothing GLSL-side is renamed or
 * "modernised" from the source — it is GLSL 3.00 es (`in`/`out`/`texture()`) exactly as
 * the pen wrote it.
 *
 * Pure strings, no three.js import here — a Web Worker can load this module too.
 *
 * Palette is NOT this module's job: `${C.foo}`-style GLSL-literal interpolation and the
 * `glslPalette()` `const vec3 K_*` block both come from ./palette.js, written by the lead.
 *
 * Scene constants the pen baked as numeric literals (CSH_SPAN, CFG.cloudDeck, ...) are
 * parameters here wherever the export shape allows a function. Where the required export
 * must stay a plain `const` string (GL_SHADOW, GL_LIGHT) the pen's own default values are
 * baked in verbatim, with a comment at each spot noting the CFG constant it came from.
 */

import { C, glslPalette } from './palette.js';

/* ── vertex preamble ───────────────────────────────────────────────────────────
 * RawShaderMaterial gives us a blank slate: we declare the built-ins ourselves. */
export const VHEAD = /* glsl */ `precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
in vec3 position;
`;

/*  NaN firewall.  One non-finite fragment survives the tonemap as an undefined
    value, and an undefined value on a billboard reads as a solid dark square —
    which is exactly what stray "black boxes" are.  Worse, the bloom downsample
    smears one of them across a whole neighbourhood.  Two ALU makes it
    structurally impossible: NaN != NaN, so equal(c,c) is false only for NaN. */
export const GL_SAFE = /* glsl */ `
vec3  SAFE3(vec3 c){ return clamp(mix(vec3(0.0), c, equal(c, c)), vec3(0.0), vec3(64.0)); }
float SAFE1(float x){ return (x == x) ? clamp(x, 0.0, 64.0) : 0.0; }
`;

export const FHEAD = /* glsl */ `precision highp float;
precision highp int;
${GL_SAFE}`;

export const GL_HASH = /* glsl */ `
float hash11(float p){ p=fract(p*0.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*0.1031); p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
  p3+=dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3 hash32(vec2 p){ vec3 p3=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
  p3+=dot(p3,p3.yxz+33.33); return fract((p3.xxy+p3.yzz)*p3.zyx); }
float hash13(vec3 p){ p=fract(p*0.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p=fract(p*vec3(0.1031,0.1030,0.0973)); p+=dot(p,p.yxz+33.33);
  return fract((p.xxy+p.yxx)*p.zyx); }
`;

export const GL_NOISE = /* glsl */ `
float vn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),
             mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y); }
float vn3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float a=hash13(i+vec3(0,0,0)), b=hash13(i+vec3(1,0,0));
  float c=hash13(i+vec3(0,1,0)), d=hash13(i+vec3(1,1,0));
  float e=hash13(i+vec3(0,0,1)), g=hash13(i+vec3(1,0,1));
  float h=hash13(i+vec3(0,1,1)), k=hash13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y), mix(mix(e,g,u.x),mix(h,k,u.x),u.y), u.z); }
vec2 grad2(vec2 i){ float a=hash12(i)*6.2831853; return vec2(cos(a),sin(a)); }
float pn2(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float a=dot(grad2(i),f), b=dot(grad2(i+vec2(1,0)),f-vec2(1,0));
  float c=dot(grad2(i+vec2(0,1)),f-vec2(0,1)), d=dot(grad2(i+vec2(1,1)),f-vec2(1,1));
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y)*1.42; }
vec3 grad3(vec3 i){ return normalize(hash33(i)*2.0-1.0); }
float pn3(vec3 p){ vec3 i=floor(p), f=fract(p); vec3 u=f*f*f*(f*(f*6.0-15.0)+10.0);
  float n000=dot(grad3(i+vec3(0,0,0)),f-vec3(0,0,0));
  float n100=dot(grad3(i+vec3(1,0,0)),f-vec3(1,0,0));
  float n010=dot(grad3(i+vec3(0,1,0)),f-vec3(0,1,0));
  float n110=dot(grad3(i+vec3(1,1,0)),f-vec3(1,1,0));
  float n001=dot(grad3(i+vec3(0,0,1)),f-vec3(0,0,1));
  float n101=dot(grad3(i+vec3(1,0,1)),f-vec3(1,0,1));
  float n011=dot(grad3(i+vec3(0,1,1)),f-vec3(0,1,1));
  float n111=dot(grad3(i+vec3(1,1,1)),f-vec3(1,1,1));
  return mix(mix(mix(n000,n100,u.x),mix(n010,n110,u.x),u.y),
             mix(mix(n001,n101,u.x),mix(n011,n111,u.x),u.y),u.z)*1.35; }
float fbm2(vec2 p, int oct){ float a=0.5,s=0.0,n=0.0;
  for(int i=0;i<8;i++){ if(i>=oct)break; s+=a*pn2(p); n+=a; p*=2.02; p+=vec2(3.1,1.7); a*=0.5; }
  return s/n; }
float fbm3(vec3 p, int oct){ float a=0.5,s=0.0,n=0.0;
  for(int i=0;i<6;i++){ if(i>=oct)break; s+=a*pn3(p); n+=a; p*=2.03; p+=vec3(2.7,1.3,4.1); a*=0.5; }
  return s/n; }
`;

/* ── shared uniform block (declared identically in every shader) ────────────── */
export const GL_UNI = /* glsl */ `
uniform float uTime;
uniform vec3  uSunDir;        // world -> sun, normalised
uniform vec3  uCamPos;
uniform vec2  uWindOrigin;    // centre of the wind render target, world xz
uniform vec2  uCloudDrift;
uniform sampler2D uWindTex;
// The pen's uHeight / uSplat / uMeadow samplers are gone: they were bakes of one fixed
// valley into fixed-size textures, which is exactly the assumption an infinite world
// cannot make. Height, splat and tussock hue now arrive as per-vertex attributes from the
// chunk mesher instead, so they stream with the terrain and cost no texture units.
uniform sampler2D uShadowMap;
uniform sampler2D uCloudSh;   // baked cloud-shadow coverage
uniform vec2  uCloudShOrigin;
uniform vec2  uShadowC;      // centre of the sun shadow map, world xz
uniform vec4  uCull;         // xy = view direction on the ground, z = cos(half angle)
uniform vec2  uWindLag;      // mean wind direction x the response-lag distance
uniform mat4  uLightMat;
uniform float uShadowTexel;
uniform float uCloudAmount;
uniform float uFogMul;
uniform float uFogNear;      // metres before aerial perspective starts
uniform float uFogFar;       // metres to full haze
uniform vec3  uMist;         // valley mist: (amount, sea altitude m, scale height m)
// There is deliberately no uChunkOrigin. Chunk vertices are local to their node and the
// node's world position rides in three's own modelMatrix, so one material with one uniform
// set draws every chunk in the world. Global precision is handled by rebasing the whole
// scene graph (see render/origin.js), not by a per-draw offset uniform.
`;

/* ── sky: a painted gradient, not a scattering integral ──────────────────────── */
export const GL_SKY = /* glsl */ `
vec3 skyDome(vec3 d, out float sunMask){
  float y  = d.y;
  float yy = max(y, -0.18);
  // four-stop vertical wash
  vec3 col = mix(K_SKY_HOR, K_SKY_MID, smoothstep(-0.02, 0.13, yy));
  col = mix(col, K_SKY_UP,  smoothstep(0.10, 0.36, yy));
  col = mix(col, K_SKY_ZEN, smoothstep(0.32, 0.86, yy));

  // azimuthal asymmetry: warm toward the sun, cool away from it
  vec2 dh = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(dh, sh) * 0.5 + 0.5;
  float horiz = pow(1.0 - clamp(yy, 0.0, 1.0), 3.4);
  col = mix(col, K_SKY_ANTI,    horiz * (1.0-az) * 0.62);
  col = mix(col, K_SKY_HORSUN,  horiz * pow(az, 2.1) * 0.92);

  /* The mist sea meeting the sky. aerial() takes the far ground down to K_MIST at
   * the skyline; without the same colour arriving in the bottom two degrees of the
   * dome the horizon becomes the seam between a silver land and a blue sky. Fifteen
   * ALU, no noise, and it scales with uMist.x so turning the mist off takes this off
   * with it rather than leaving a band hanging in an empty sky. */
  col = mix(col, mix(K_MIST, K_SKY_HORSUN, pow(az, 2.2)*0.6),
            smoothstep(0.045, -0.02, yy) * clamp(uMist.x, 0.0, 1.0) * 0.34);

  // Mie forward-scatter halo
  float ang = dot(d, uSunDir);
  float halo = pow(max(ang, 0.0), 7.0);
  float wide = pow(max(ang, 0.0), 1.9);
  col = mix(col, K_SUN_GLOW, clamp(halo*0.72 + wide*0.16, 0.0, 0.9));

  // sun disc (painted 3x oversize, never blown out)
  sunMask = smoothstep(0.99977, 0.99992, ang);
  col = mix(col, K_SUN_DISC*1.9, sunMask);

  // thin cirrus streaks, sheared by the upper wind
  float cd = smoothstep(0.035, 0.30, yy);
  if(cd > 0.001){
    vec2 sp = d.xz / max(y, 0.05) * 0.0016;
    sp += uCloudDrift * 0.00022;
    vec2 w = vec2(fbm2(sp*2.1+vec2(7.3,2.1),3), fbm2(sp*2.1+vec2(1.9,9.4),3));
    float ci = fbm2(vec2(sp.x*0.55, sp.y*3.4) + w*0.6, 4);
    ci = smoothstep(0.10, 0.44, ci) * cd * (0.30 + 0.5*pow(max(ang,0.0),1.4));
    col = mix(col, ${C.cirrus}*(0.92+0.55*pow(max(ang,0.0),3.0)), ci*0.55*uCloudAmount);
  }
  return col;
}
vec3 skyDome(vec3 d){ float s; return skyDome(d, s); }

// The same wash without the sun disc and without the warped cirrus fbm.  A
// reflection in moving water resolves none of that detail — it just costs ten
// octaves of noise per pixel of river and comes back as sparkle.
vec3 skyDomeLite(vec3 d){
  float yy = max(d.y, -0.18);
  vec3 col = mix(K_SKY_HOR, K_SKY_MID, smoothstep(-0.02, 0.13, yy));
  col = mix(col, K_SKY_UP,  smoothstep(0.10, 0.36, yy));
  col = mix(col, K_SKY_ZEN, smoothstep(0.32, 0.86, yy));
  vec2 dh = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(dh, sh)*0.5 + 0.5;
  float horiz = pow(1.0 - clamp(yy, 0.0, 1.0), 3.4);
  col = mix(col, K_SKY_ANTI,   horiz*(1.0-az)*0.62);
  col = mix(col, K_SKY_HORSUN, horiz*pow(az, 2.1)*0.92);
  // Same mist band as skyDome above — a reflection that stops at the mist sea while
  // the sky it reflects carries on into it is a visible edge on the far bank.
  col = mix(col, mix(K_MIST, K_SKY_HORSUN, pow(az, 2.2)*0.6),
            smoothstep(0.045, -0.02, yy) * clamp(uMist.x, 0.0, 1.0) * 0.34);
  float ang = max(dot(d, uSunDir), 0.0);
  col = mix(col, K_SUN_GLOW, clamp(pow(ang,7.0)*0.72 + pow(ang,1.9)*0.16, 0.0, 0.9));
  return col;
}
`;

// ── cloud coverage field: drives BOTH the visible cumulus and their shadows ──
// Ported as a FUNCTION rather than a const: the pen baked CSH_SPAN (cloud-shadow map span,
// metres) and CFG.cloudDeck (cumulus deck altitude, metres) as numeric literals inside this
// chunk. Both are scene constants, so here they are parameters. Defaults below are the
// pen's own values, read straight out of hoshi.html — CSH_SPAN = 4600 (hoshi.html:552) and
// CFG.cloudDeck = 980 (hoshi.html:200). Note: the porting brief guessed a default of 900 for
// the cloud deck; the pen's real value is 980, so 980 is what is used here.
export function glCloudField({ cshSpan = 4600, cloudDeck = 980 } = {}) {
  return /* glsl */ `
// The analytic coverage field.  Thirteen octaves of warped fbm — beautiful,
// and far too expensive to evaluate once per fragment of a full screen.  It is
// therefore evaluated ONCE PER FRAME into a 512² map (see CLOUDSH_FS) that is
// centred on where the cloud deck projects along the sun vector; every surface
// in the valley then reads its cloud shadow with a single texture fetch.  The
// field's finest feature is ~95 m across and the map is 9 m/texel, so the baked
// version is indistinguishable from the live one.
float cloudField(vec2 q){
  vec2 p = (q - uCloudDrift) * 0.00071;
  vec2 w = vec2(fbm2(p*1.55+vec2(11.3,4.7),3), fbm2(p*1.55+vec2(37.1,19.2),3));
  float f = fbm2(p + w*0.62, 4);
  float g = fbm2(p*3.7 + w*1.1, 3);
  f = f*0.78 + g*0.22;
  return clamp(smoothstep(-0.035, 0.30, f) * uCloudAmount, 0.0, 1.0);
}
const float CSH_SPAN = ${cshSpan.toFixed(1)};
vec2 cloudShadowUV(vec3 wp){
  float t = (${cloudDeck.toFixed(1)} - wp.y) / max(uSunDir.y, 0.06);
  vec2 q = wp.xz + uSunDir.xz * t;
  return (q - uCloudShOrigin) / CSH_SPAN + 0.5;
}
float cloudShadow(vec3 wp){
  vec2 uv = cloudShadowUV(wp);
  float c = texture(uCloudSh, clamp(uv, vec2(0.0015), vec2(0.9985))).r;
  return 1.0 - 0.64 * c;
}
`;
}

// ── sun shadow map with a hand-drawn edge ───────────────────────────────────
// sunShadow()'s painterly wobble below is scaled by 0.34 / CFG.shadowSpan (CFG.shadowSpan =
// 480 m in the pen, hoshi.html:197) so the brush stroke keeps the same physical size
// whatever the map's span or resolution actually is. GL_SHADOW is required to stay a plain
// 'const' string by this module's export contract (see "HOW THE MODULE MUST BE SHAPED" in
// the porting brief), so — unlike glCloudField above — that ratio is baked in verbatim
// (0.34/480 = 0.00070833) rather than turned into a parameter. Flagging this as a baked
// scene constant that was NOT parameterised, per the brief's own reporting instruction.
export const GL_SHADOW = /* glsl */ `
// four taps, no painterly wobble — for surfaces too small to show the edge
float sunShadowFast(vec3 wp, float ndl){
  vec4 lp = uLightMat * vec4(wp, 1.0);
  vec3 pc = lp.xyz / lp.w * 0.5 + 0.5;
  if(pc.z > 0.9995) return 1.0;
  vec2 e = abs(pc.xy - 0.5);
  float fade = 1.0 - smoothstep(0.40, 0.497, max(e.x, e.y));
  if(fade <= 0.001) return 1.0;
  float bias = mix(0.0026, 0.0006, clamp(ndl,0.0,1.0));
  float s = 0.0;
  s += step(pc.z-bias, texture(uShadowMap, pc.xy + vec2( 1.0, 1.0)*uShadowTexel).r);
  s += step(pc.z-bias, texture(uShadowMap, pc.xy + vec2(-1.0, 1.0)*uShadowTexel).r);
  s += step(pc.z-bias, texture(uShadowMap, pc.xy + vec2( 1.0,-1.0)*uShadowTexel).r);
  s += step(pc.z-bias, texture(uShadowMap, pc.xy + vec2(-1.0,-1.0)*uShadowTexel).r);
  return mix(1.0, s*0.25, fade);
}
float sunShadow(vec3 wp, float ndl){
  vec4 lp = uLightMat * vec4(wp, 1.0);
  vec3 pc = lp.xyz / lp.w;
  pc = pc * 0.5 + 0.5;
  if(pc.z > 0.9995) return 1.0;
  vec2 e = abs(pc.xy - 0.5);
  float fade = 1.0 - smoothstep(0.40, 0.497, max(e.x, e.y));
  if(fade <= 0.001) return 1.0;
  float bias = mix(0.0022, 0.00045, clamp(ndl,0.0,1.0));
  // Painterly wobble: the shadow edge is DRAWN, not filtered — the noise offset
  // is what gives the edge its brush character, and it is specified in metres
  // so it stays the same shape whatever the map's span or resolution.  Because
  // the wobble dominates the silhouette, five taps in a cross read the same as
  // the old nine in a box, on every lit fragment in the valley.
  float j0 = vn2(wp.xz*2.7) - 0.5;
  float j1 = vn2(wp.zx*8.3 + 9.7) - 0.5;
  vec2 jo = vec2(j0*2.0 + j1*0.9, j1*1.6 - j0*0.7) * 0.00070833;
  float r = uShadowTexel*1.7;
  float s = step(pc.z - bias, texture(uShadowMap, pc.xy + jo).r);
  s += step(pc.z - bias, texture(uShadowMap, pc.xy + jo + vec2( r, r)).r);
  s += step(pc.z - bias, texture(uShadowMap, pc.xy + jo + vec2(-r, r)).r);
  s += step(pc.z - bias, texture(uShadowMap, pc.xy + jo + vec2( r,-r)).r);
  s += step(pc.z - bias, texture(uShadowMap, pc.xy + jo + vec2(-r,-r)).r);
  return mix(1.0, s*0.2, fade);
}
`;

// ── the painter's light model, plus aerial perspective ───────────────────────
// The pen split this across two consts — GL_LIGHT (this shading ramp) and GL_AIR (aerial
// perspective / fog) — that were always concatenated together at the shader-assembly call
// site (e.g. TERRAIN_FS: '${GL_LIGHT}${GL_AIR}', hoshi.html:1108). They are merged
// into one GL_LIGHT export here, since both are "shared lighting/fog helpers" per this
// module's export contract, and the brief explicitly named 'aerial' among the functions to
// collect into GL_LIGHT.
//
// GL_AIR's aerial() bakes CFG.fogNear (70 m) and CFG.fogFar (1700 m — hoshi.html:201-202) as
// numeric literals. Like the shadow wobble above, GL_LIGHT must stay a plain const per the
// export contract, so those two are also baked in verbatim below rather than parameterised.
export const GL_LIGHT = /* glsl */ `
// three-colour hue-path ramp; transitions are soft but visibly banded
vec3 ramp3(float t, vec3 shade, vec3 mid, vec3 lit, float soft, float jit){
  float a = smoothstep(0.17 - soft + jit, 0.17 + soft + jit, t);
  float b = smoothstep(0.58 - soft + jit, 0.58 + soft + jit, t);
  return mix(mix(shade, mid, a), lit, b);
}
struct Surf {
  vec3 N; vec3 V; vec3 P;     // normal, surface->eye, world pos
  vec3 shade; vec3 mid; vec3 lit;
  float soft;                 // band softness
  float jit;                  // painterly wobble of the band edges
  float shadow;               // 0 shadowed .. 1 lit
  float trans;                // translucency thickness 0..1
  vec3  transCol;
  float rim; float ao; float ambient;
};
vec3 paint(Surf s){
  float ndl  = dot(s.N, uSunDir);
  // Half-lambert. A 13.5° sun grazes flat ground at ndl≈0.23; plain Lambert
  // would drop the whole valley floor into the shade band and golden hour
  // would read as dusk.
  float wrap = clamp(ndl*0.62 + 0.46, 0.0, 1.0);
  float jit  = s.jit;
  float t    = wrap * mix(0.34, 1.0, s.shadow);
  vec3  col  = ramp3(t, s.shade, s.mid, s.lit, s.soft, jit);

  float litAmt = smoothstep(0.34, 0.86, t);
  col *= mix(vec3(0.94), K_SUN * 1.32, litAmt * 0.62);

  // shadows change hue, they do not go black
  col = mix(col*0.80 + K_SHADOW*0.040, col, s.shadow*0.82 + 0.18);

  // Hemispheric ambient TINTS rather than washes: normalised to unit luminance
  // so it can rotate hue (cool from the sky, warm from the ground bounce)
  // without ever bleaching the palette.
  vec3 hemi = mix(K_AMB_GND, K_AMB_SKY, s.N.y*0.5 + 0.5);
  vec3 hueOnly = hemi / max(dot(hemi, vec3(0.2126,0.7152,0.0722)), 1e-3);
  col *= mix(vec3(1.0), hueOnly, 0.22 * s.ambient * (1.0 - litAmt*0.55));
  col += hemi * 0.052 * s.ambient * s.ao * (1.0 - litAmt*0.85);

  // backlight rim — the connective tissue of the whole image
  float back = smoothstep(0.05, 0.85, dot(s.V, -uSunDir));
  float fres = pow(1.0 - clamp(dot(s.N, s.V), 0.0, 1.0), 4.2);
  col += K_SUN * (fres * back * s.rim * 1.15 * s.shadow);

  // subsurface transmission (grass, leaves, smoke)
  if(s.trans > 0.001){
    // light coming THROUGH the blade, not bouncing off it: only the part of
    // the surface that is nearly edge-on to the sun actually transmits
    float tr = pow(clamp(dot(s.V, -uSunDir), 0.0, 1.0), 3.2);
    float thin = pow(clamp(1.0 - abs(dot(s.N, uSunDir)), 0.0, 1.0), 2.2);
    col += s.transCol * tr * thin * s.trans * s.shadow * 0.52;
  }
  col *= s.ao;
  return col;
}

// ── aerial perspective ──────────────────────────────────────────────────────
float gFogAmt = 0.0;   // written by aerial(), read back as the alpha channel so
                       // the post chain knows how far away each pixel is
// uFogNear / uFogFar replace the pen's baked CFG.fogNear=70 / CFG.fogFar=1700. That valley
// was 2 km across and 1700 m of visibility was generous; a car doing 90 m/s down a steppe
// arterial needs to see the next ridge, so the game drives these from the camera's far
// plane and softens them per biome (dunes haze up, highlands clear).
/* ── valley mist ──────────────────────────────────────────────────────────────
 * Its own hash and its own value noise, deliberately, rather than GL_HASH/GL_NOISE:
 * GL_LIGHT is concatenated on its own — with no hash and no noise chunk in front of
 * it — by render/clouds.js's CLOUD_FS, which calls fragHead(GL_LIGHT, CLOUD_FS). Reaching for
 * pn2() in here would fail to compile that one material out of eleven, and a shader
 * that fails to compile is a silently missing cloud deck. Two small functions with
 * names nothing else uses keeps this chunk dependency-free, which is the property the
 * cloud material has always relied on.
 */
float mstHash(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y)*q.z); }
float mstNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mstHash(i),             mstHash(i+vec2(1,0)), f.x),
             mix(mstHash(i+vec2(0,1)),   mstHash(i+vec2(1,1)), f.x), f.y); }

vec3 aerial(vec3 col, float dist, vec3 V, float worldY){
  dist = (dist == dist) ? min(dist, 1.0e6) : 1.0e6;   // a NaN depth must not
  float d  = max(dist - uFogNear, 0.0);   // poison the colour
  float hf = mix(1.0, exp(-max(worldY - 6.0, 0.0)/260.0), 0.72);
  float f  = 1.0 - exp(-pow(d / uFogFar, 1.28) * 3.1 * hf * uFogMul);
  float mie = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 3.4);
  vec3 fc = mix(K_HAZE, K_SKY_HORSUN, mie*0.88);
  fc = mix(fc, K_SKY_ANTI, clamp(dot(-V,uSunDir),-1.0,0.0)*-0.32);

  /* ── the mist that pools in the valleys ─────────────────────────────────────
   * What stood here was two smoothsteps on the fragment's own altitude —
   * smoothstep(46,8,worldY) * smoothstep(120,420,dist), tinted 45% toward
   * K_MIST. It had no shape in it (nothing but height and range went in, so
   * nothing but a flat wash came out) and, worse, it could not tell a hollow
   * from a plain: every point at 10 m got the same mist whether it sat at the
   * bottom of a bowl or on an open shelf, because the ray that reached it was
   * never consulted.
   *
   * This is the analytic integral of an exponential density along the eye ray:
   *
   *     rho(y)  = exp(-(y - y0)/H)                 y0 = uMist.y, H = uMist.z
   *     optical = INT rho ds = dist * (exp(-a) - exp(-b)) / (b - a)
   *
   * with a and b the camera's and the fragment's altitudes measured in scale
   * heights. Two exps, no loop, no texture, no second pass — and it pools by
   * CONSTRUCTION rather than by a rule, because what it measures is how much
   * low, dense air the ray actually crossed. A valley floor seen from a ridge
   * fills up; the ridge opposite it, at the identical distance, stays legible;
   * and a camera down IN the valley sees everything, at every height, through
   * the thick of it. tools/diag-mist.mjs measures all three on real world
   * coordinates rather than asserting them here — measured 2.8x on the first
   * and 3.3x on the third, on seed 20260726.
   *
   * Being honest about its one blind spot: the density is a function of
   * ALTITUDE, not of the shape of the ground, so a hollow and an open shelf at
   * the same height get the same mist. Distinguishing them would need the
   * terrain in the shader, which aerial() has no way to reach from inside
   * eleven different materials. Altitude is what reads on screen.
   */
  float mist = 0.0;
  if(uMist.x > 0.001){
    float H  = max(uMist.z, 4.0);
    float a  = clamp((uCamPos.y - uMist.y)/H, -3.0, 24.0);   // clamped so a camera
    float b  = clamp((worldY    - uMist.y)/H, -3.0, 24.0);   // far under the sea
    float ea = exp(-a), eb = exp(-b);                        // cannot blow up exp()
    float db = b - a;
    float mean = (abs(db) < 1.0e-3) ? ea : (ea - eb)/db;     // the L'Hopital limit
    /* 1/1300: one optical depth per 1300 m of ray held at the mist sea's own level.
     * Tuned on the printed profile in tools/diag-mist.mjs, not by eye — a valley
     * floor reads 0.21 at 320 m, 0.40 at 700 m and 0.81 at 2.8 km, which is a veil
     * you can see the land through at every one of those ranges. At 1/760 the same
     * floor was 0.59 by 700 m, and a distance where you can no longer read the shape
     * of the ground is a distance where the mist has stopped being pretty.
     *
     * The near ramp keeps the bonnet, the tarmac under the wheels and the grass at
     * the roadside clear: mist you are standing inside is grease on the lens. */
    float opt = max(mean, 0.0) * dist * (1.0/1300.0) * uMist.x
              * smoothstep(16.0, 165.0, dist);
    mist = 1.0 - exp(-opt);
    /* The gate is the whole frame-cost story. Below 2% mist the layering below moves
     * the result by less than 0.4% of a colour mix — invisible — so everything inside
     * ~90 m of the lens skips it, and that near field is exactly where the grass
     * overdraws the screen five times over. Measured: 13% of ground fragments take
     * this branch from a driving pose, 100% from a 90 m crane (where there is no
     * grass in front of the lens to overdraw anything). */
    if(mist > 0.02){
      /* Layering, or it is a density and not weather. Two terms:
       *
       * SHEETS are a function of altitude ALONE, so they are exact, world-locked
       * and identical from every angle — the horizontal watermark a standing mist
       * deck leaves across a hillside, ~53 m of band.
       *
       * PATCHES need the fragment's xz, which aerial()'s signature does not carry
       * and cannot be given without editing eleven shaders in files this change
       * does not own. They are reconstructed along the eye ray from the VIEW DEPTH
       * instead of the true ray length, which is short by 1/cos(off-axis) — up to
       * ~20% at the corners of a 64 deg frame. The field is 1.2 km across and the
       * modulation is +/-17%, so the worst case is a tenth of a blotch of slide
       * during a pan, against a mist that is already drifting on the wind. That is
       * a trade, it is made knowingly, and it buys the mist its shape.
       *
       * Named mstPatch, NOT "patch": patch is a RESERVED WORD in GLSL ES 3.00
       * (kept for tessellation), and ANGLE's translator rejects it outright. This
       * one identifier was the entire "mist broke every shader" incident — the
       * chunk lives in GL_LIGHT, GL_LIGHT is concatenated into every material in
       * the game, so eleven materials failed to compile over one variable name.
       * No static node-side check can see it; only a real GPU compile can. */
      float sheet = mstNoise(vec2(worldY*0.019 + 4.7, worldY*0.052));
      vec2  pxz   = uCamPos.xz - V.xz*dist + uCloudDrift*0.30;
      float mstPatch = mstNoise(pxz*0.00082);
      mist = clamp(mist * (0.83 + 0.34*mstPatch*(0.45 + 0.55*sheet)), 0.0, 1.0);
    }
  }
  /* Mist colour. K_MIST is a pale silver-green, and it goes LUMINOUS toward the
   * sun rather than merely brighter: backlit mist is the most Ghibli thing in the
   * pen's whole valley, and it is the difference between this and a grey wash. */
  vec3 mc = mix(K_MIST, K_SKY_HORSUN, mie*0.62);
  mc = mix(mc, K_SUN_GLOW, mie*mie*0.30);

  /* Alpha is the post chain's distance channel: mist is depth as much as haze is,
   * so it has to land there too or a misted valley comes back sharp out of the
   * watercolour pass. Composited over the haze, not added to it — the two are the
   * same photons and adding them double-counts. */
  gFogAmt = clamp(f + mist*(1.0 - f)*0.90, 0.0, 1.0);
  col = mix(col, fc, f);
  return mix(col, mc, mist);
}
`;

/* ── depth-only fragment shader (shadow map / depth pre-pass) ────────────────── */
export const DEPTH_FS = /* glsl */ `
precision mediump float;
out vec4 o;
void main(){ o = vec4(1.0); }`;

/**
 * FHEAD + GL_UNI + the palette block + any extra chunks, concatenated in the order every
 * fragment shader in the pen assembled them (e.g. TERRAIN_FS: precision, then `${GL_UNI}`,
 * then `${GL_PAL()}`, then the hash/noise/terrain/wind/cloud/shadow/light chunks it
 * needed, then the shader body). Pass the extra chunks — GL_HASH, GL_NOISE, GL_SKY,
 * glCloudField(...), GL_SHADOW, GL_LIGHT, the shader's own varyings/body, and so on — in the
 * order the shader needs them.
 */
export function fragHead(...chunks) {
  return FHEAD + GL_UNI + glslPalette() + chunks.join('');
}

/**
 * VHEAD + GL_UNI + any extra chunks. Vertex shaders in the pen only pull in GL_UNI when they
 * actually need it (wind sampling, shadow-map projection, ...); callers that don't need any
 * extra uniforms or chunks can just call `vertHead()` with nothing extra.
 */
export function vertHead(...chunks) {
  return VHEAD + GL_UNI + chunks.join('');
}
