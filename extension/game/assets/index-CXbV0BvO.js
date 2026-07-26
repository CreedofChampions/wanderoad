import{C as tt,V as X,M as Nt,a as le,b as Fs,R as ge,B as la,c as Te,d as ha,F as En,N as Ys,L as Le,H as mn,U as vn,e as nt,f as U,S as ot,g as Cn,h as Hs,W as hs,i as Ne,j as ye,k as us,O as vt,D as st,l as zn,A as Is,m as ai,Z as ri,n as ci,o as li,p as hi,I as ft,q as ws,r as ui,s as di,Q as Ln,t as ua,u as da,v as fa,G as et,T as pa,w as gn,x as fi,y as ma,z as ls,E as pi,J as Xe,K as Ot,P as va,X as ga,Y as wa,_ as xa,$ as ba,a0 as ya,a1 as _a,a2 as Ma,a3 as Ta,a4 as mi,a5 as wn,a6 as Sa,a7 as Aa,a8 as Xs,a9 as ka,aa as vi,ab as ts,ac as Ra,ad as Ea,ae as Ca,af as za,ag as La,ah as Da,ai as gi,aj as Fa,ak as Ia,al as Pa,am as Na,an as Oa,ao as Ba,ap as wi,aq as Ga,ar as Vn,as as Yn,at as Xn,au as Zn,av as Jn,aw as Ua,ax as zs,ay as Ha,az as Wa}from"./three-0hhNWlqB.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))s(n);new MutationObserver(n=>{for(const i of n)if(i.type==="childList")for(const o of i.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&s(o)}).observe(document,{childList:!0,subtree:!0});function t(n){const i={};return n.integrity&&(i.integrity=n.integrity),n.referrerPolicy&&(i.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?i.credentials="include":n.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function s(n){if(n.ep)return;n.ep=!0;const i=t(n);fetch(n.href,i)}})();const fe={skyZenith:"#4E80B4",skyUpper:"#7BA9CE",skyMid:"#A8CAE0",skyHorizon:"#E4DAC2",skyHorizonSun:"#FBE2AE",sunGlow:"#FFF1CE",sunDisc:"#FFFAEA",skyAnti:"#C8D4D6",haze:"#A9BCC7",mist:"#D6DDD4",cloudTop:"#FFF8EC",cloudBody:"#F6E7D2",cloudTerm:"#E8CFB4",cloudUnder:"#B7ACC3",cloudCore:"#9791B0",cloudRim:"#FFEFBE",cirrus:"#F3E6D6",gTip:"#C6D46B",gUpper:"#93B84E",gMid:"#6C9A47",gLow:"#436E4F",gBase:"#2B564F",gTrans:"#E9EE7C",gSheen:"#EDF0C8",gDry:"#D9C079",gPatchA:"#87AC4B",gPatchB:"#6C9A56",gPatchC:"#9DBC5E",gPatchD:"#5F8A5A",tLit:"#93B159",tMid:"#6A924F",tShade:"#456A54",tHollow:"#33564F",ridgeNear:"#8FA9A2",ridgeMid:"#9CB0B4",ridgeFar:"#AEBCC9",ridgeFurthest:"#BFC8D4",pathLit:"#C9AD80",pathShade:"#7A664D",rockLit:"#B4A794",rockShade:"#5F5C58",bounce:"#AA9C64",wShallow:"#A5CBBE",wMid:"#5F9CA0",wDeep:"#2F5F6C",wDeepShade:"#274E5C",wSpark:"#FFFCEC",wFoam:"#EEF5EF",wetStone:"#6E7E75",sA:"#CBB99E",sB:"#BDA98C",sC:"#D6C6AA",sD:"#B2A490",sShade:"#6C6355",sDeep:"#585A62",mortar:"#AB9C85",moss:"#6F8C4E",lichen:"#B3BE96",cLit:"#84A94C",cMid:"#5A8148",cShade:"#2F5546",cDeep:"#254A44",cTrans:"#BED063",cVarA:"#98AC43",cVarB:"#6E9440",cVarC:"#A9B65C",trunkLit:"#8E7659",trunkShade:"#4C3F34",roofA:"#B96A4C",roofB:"#A05C46",roofSlate:"#6E7583",thatch:"#BC9E66",wallA:"#EFE4D0",wallB:"#E4D5BA",timber:"#7C5D46",windowGlow:"#FFD98C",tarmacLit:"#8E8B86",tarmacShade:"#4A4C52",tarmacWet:"#5E6670",lineWhite:"#F2EADA",lineYellow:"#E7C87A",gravelLit:"#C3AE8B",gravelShade:"#78684F",kerb:"#CFC5B2",postWood:"#8A7357",postPaint:"#EFE4D0",paintA:"#C8503F",paintB:"#E0B14E",paintC:"#3F6E8C",paintD:"#EFE7D6",paintE:"#4E7F79",paintF:"#2E3440",chrome:"#D7DCE0",glass:"#7FA2B8",tyre:"#2A2A2E",tail:"#E4573F",head:"#FFF3D0",sun:"#FFD79C",ambSky:"#9EC6E6",ambGround:"#AA9C64",shadowTint:"#5C6E9E"},_t={};for(const a in fe)_t[a]=new tt(fe[a]).convertSRGBToLinear();const Ka=a=>`vec3(${a.r.toFixed(5)},${a.g.toFixed(5)},${a.b.toFixed(5)})`,E={};for(const a in _t)E[a]=Ka(_t[a]);const Ps={};for(const a in _t)Ps[a]=[_t[a].r,_t[a].g,_t[a].b];function qa(){return`
const vec3 K_SUN        = ${E.sun};
const vec3 K_AMB_SKY    = ${E.ambSky};
const vec3 K_AMB_GND    = ${E.ambGround};
const vec3 K_SHADOW     = ${E.shadowTint};
const vec3 K_HAZE       = ${E.haze};
const vec3 K_MIST       = ${E.mist};
const vec3 K_SKY_ZEN    = ${E.skyZenith};
const vec3 K_SKY_UP     = ${E.skyUpper};
const vec3 K_SKY_MID    = ${E.skyMid};
const vec3 K_SKY_HOR    = ${E.skyHorizon};
const vec3 K_SKY_HORSUN = ${E.skyHorizonSun};
const vec3 K_SKY_ANTI   = ${E.skyAnti};
const vec3 K_SUN_GLOW   = ${E.sunGlow};
const vec3 K_SUN_DISC   = ${E.sunDisc};
const vec3 K_C_TOP      = ${E.cloudTop};
const vec3 K_C_BODY     = ${E.cloudBody};
const vec3 K_C_TERM     = ${E.cloudTerm};
const vec3 K_C_UNDER    = ${E.cloudUnder};
const vec3 K_C_CORE     = ${E.cloudCore};
const vec3 K_C_RIM      = ${E.cloudRim};
const vec3 K_T_LIT      = ${E.tLit};
const vec3 K_T_MID      = ${E.tMid};
const vec3 K_T_SHADE    = ${E.tShade};
const vec3 K_T_HOLLOW   = ${E.tHollow};
const vec3 K_ROCK_LIT   = ${E.rockLit};
const vec3 K_ROCK_SHADE = ${E.rockShade};
const vec3 K_PATH_LIT   = ${E.pathLit};
const vec3 K_PATH_SHADE = ${E.pathShade};
const vec3 K_TAR_LIT    = ${E.tarmacLit};
const vec3 K_TAR_SHADE  = ${E.tarmacShade};
const vec3 K_LINE_W     = ${E.lineWhite};
const vec3 K_LINE_Y     = ${E.lineYellow};
const vec3 K_GRAVEL_LIT = ${E.gravelLit};
const vec3 K_GRAVEL_SHD = ${E.gravelShade};
const vec3 K_W_SHALLOW  = ${E.wShallow};
const vec3 K_W_MID      = ${E.wMid};
const vec3 K_W_DEEP     = ${E.wDeep};
const vec3 K_BOUNCE     = ${E.bounce};
const float SUN_I = 1.38;
`}const pt=[{ground:[1,1,1],rock:[1,1,1],foliage:[1,1,1],haze:fe.haze,hazeMul:1,dryness:0,snow:0,wet:.12},{ground:[1.24,1.1,.72],rock:[1.12,1.05,.92],foliage:[1.14,1.02,.66],haze:"#D6C79E",hazeMul:1.35,dryness:.85,snow:0,wet:.02},{ground:[.82,.9,.98],rock:[.9,.95,1.06],foliage:[.72,.86,.86],haze:"#9FB6CE",hazeMul:.72,dryness:.1,snow:1,wet:.2},{ground:[1.42,1.06,.78],rock:[1.3,1.02,.86],foliage:[1.05,.9,.62],haze:"#E6C7AC",hazeMul:1.6,dryness:1,snow:0,wet:0},{ground:[.88,.96,.9],rock:[.86,.9,.9],foliage:[.84,.96,.86],haze:"#CBD6D2",hazeMul:1.9,dryness:0,snow:0,wet:1}];function xi(){const a=pt.length,e=new Float32Array(a*3),t=new Float32Array(a*3),s=new Float32Array(a*3),n=new Float32Array(a*3),i=new Float32Array(a*4);return pt.forEach((o,r)=>{e.set(o.ground,r*3),t.set(o.rock,r*3),s.set(o.foliage,r*3);const c=new tt(o.haze).convertSRGBToLinear();n.set([c.r,c.g,c.b],r*3),i.set([o.hazeMul,o.dryness,o.snow,o.wet],r*4)}),{ground:e,rock:t,foliage:s,haze:n,scal:i,count:a}}const $a=`precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
in vec3 position;
`,ja=`
vec3  SAFE3(vec3 c){ return clamp(mix(vec3(0.0), c, equal(c, c)), vec3(0.0), vec3(64.0)); }
float SAFE1(float x){ return (x == x) ? clamp(x, 0.0, 64.0) : 0.0; }
`,bi=`precision highp float;
precision highp int;
${ja}`,pe=`
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
`,me=`
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
`,Dn=`
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
// There is deliberately no uChunkOrigin. Chunk vertices are local to their node and the
// node's world position rides in three's own modelMatrix, so one material with one uniform
// set draws every chunk in the world. Global precision is handled by rebasing the whole
// scene graph (see render/origin.js), not by a per-draw offset uniform.
`,Ws=`
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
    col = mix(col, ${E.cirrus}*(0.92+0.55*pow(max(ang,0.0),3.0)), ci*0.55*uCloudAmount);
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
  float ang = max(dot(d, uSunDir), 0.0);
  col = mix(col, K_SUN_GLOW, clamp(pow(ang,7.0)*0.72 + pow(ang,1.9)*0.16, 0.0, 0.9));
  return col;
}
`;function At({cshSpan:a=4600,cloudDeck:e=980}={}){return`
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
const float CSH_SPAN = ${a.toFixed(1)};
vec2 cloudShadowUV(vec3 wp){
  float t = (${e.toFixed(1)} - wp.y) / max(uSunDir.y, 0.06);
  vec2 q = wp.xz + uSunDir.xz * t;
  return (q - uCloudShOrigin) / CSH_SPAN + 0.5;
}
float cloudShadow(vec3 wp){
  vec2 uv = cloudShadowUV(wp);
  float c = texture(uCloudSh, clamp(uv, vec2(0.0015), vec2(0.9985))).r;
  return 1.0 - 0.64 * c;
}
`}const Ht=`
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
`,kt=`
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
vec3 aerial(vec3 col, float dist, vec3 V, float worldY){
  dist = (dist == dist) ? min(dist, 1.0e6) : 1.0e6;   // a NaN depth must not
  float d  = max(dist - uFogNear, 0.0);   // poison the colour
  float hf = mix(1.0, exp(-max(worldY - 6.0, 0.0)/260.0), 0.72);
  float f  = 1.0 - exp(-pow(d / uFogFar, 1.28) * 3.1 * hf * uFogMul);
  float mie = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 3.4);
  vec3 fc = mix(K_HAZE, K_SKY_HORSUN, mie*0.88);
  fc = mix(fc, K_SKY_ANTI, clamp(dot(-V,uSunDir),-1.0,0.0)*-0.32);
  // mist pooling in the valley floor
  float pool = smoothstep(46.0, 8.0, worldY) * smoothstep(120.0, 420.0, dist);
  fc = mix(fc, K_MIST, pool*0.45);
  f  = clamp(f + pool*0.16, 0.0, 1.0);
  gFogAmt = f;
  return mix(col, fc, f);
}
`,Fn=`
precision mediump float;
out vec4 o;
void main(){ o = vec4(1.0); }`;function Oe(...a){return bi+Dn+qa()+a.join("")}function Me(...a){return $a+Dn+a.join("")}const Va=13.5,Ya=118;function Xa(a=Va,e=Ya){const t=a*Math.PI/180,s=e*Math.PI/180;return new X(Math.sin(s)*Math.cos(t),Math.sin(t),Math.cos(s)*Math.cos(t)).normalize()}const Q={uTime:{value:0},uSunDir:{value:Xa()},uCamPos:{value:new X},uWindOrigin:{value:new le},uCloudDrift:{value:new le},uWindTex:{value:null},uShadowMap:{value:null},uCloudSh:{value:null},uCloudShOrigin:{value:new le},uShadowC:{value:new le},uCull:{value:new Fs(0,0,-1,0)},uWindLag:{value:new le},uLightMat:{value:new Nt},uShadowTexel:{value:1/2048},uCloudAmount:{value:.62},uFogMul:{value:1},uFogNear:{value:140},uFogFar:{value:4200}};function Re(a={}){const e={};for(const t in Q)e[t]=Q[t];for(const t in a)e[t]=a[t];return e}const Za=`
out vec3 vDir;
void main(){
  vDir = position;
  // Translation only: the sky must rotate with the camera but never move relative to it,
  // and the w-trick pins it to the far plane so it can never poke through terrain.
  mat4 v = viewMatrix;
  v[3].xyz = vec3(0.0);
  vec4 p = projectionMatrix * v * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`,Ja=`
in vec3 vDir;
out vec4 fragColor;
void main(){
  vec3 d = normalize(vDir);
  float sunMask;
  vec3 col = skyDome(d, sunMask);
  // Alpha carries "how far away" for the post chain; the sky is as far as it gets.
  fragColor = vec4(SAFE3(col), 1.0);
}
`;function Qa(){const a=new ge({glslVersion:"300 es",uniforms:Re(),vertexShader:Me(Za),fragmentShader:Oe(pe,me,Ws,Ja),side:la,depthWrite:!1,depthTest:!1}),e=new Te(new ha(2,2,2),a);return e.frustumCulled=!1,e.renderOrder=-1e3,e.name="sky",e}const Rt=xi();function er(){const a=(t,s,n)=>{const i=[];for(let o=0;o<s;o++){const r=[];for(let c=0;c<n;c++)r.push(t[o*n+c].toFixed(4));i.push(`vec${n}(${r.join(",")})`)}return i.join(`,
  `)},e=Rt.count;return`
const int NBIOME = ${e};
const vec3 B_GROUND[${e}] = vec3[${e}](
  ${a(Rt.ground,e,3)}
);
const vec3 B_ROCK[${e}] = vec3[${e}](
  ${a(Rt.rock,e,3)}
);
const vec3 B_FOLIAGE[${e}] = vec3[${e}](
  ${a(Rt.foliage,e,3)}
);
const vec3 B_HAZE[${e}] = vec3[${e}](
  ${a(Rt.haze,e,3)}
);
// x hazeMul, y dryness, z snow, w wet
const vec4 B_SCAL[${e}] = vec4[${e}](
  ${a(Rt.scal,e,4)}
);
`}const tr=`
in vec3 normal;
in vec4 aBiome;   // weights 0..3, the fifth is 1 - sum
in vec2 aRoad;    // x = carve mask, y = carriageway

out vec3 vWorld;
out vec3 vNormal;
out vec4 vBiome;
out vec2 vRoad;
out float vDist;

void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld  = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vBiome  = aBiome;
  vRoad   = aRoad;
  vDist   = length(wp.xyz - uCamPos);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,sr=`
in vec3 vWorld;
in vec3 vNormal;
in vec4 vBiome;
in vec2 vRoad;
in float vDist;
out vec4 fragColor;

// The five weights, renormalised. The mesher stores four and lets the fifth fall out of
// the sum, which saves a byte per vertex and guarantees they add to one after
// interpolation — a genuine partition, so no fragment is ever "no biome".
void weights(out float w[NBIOME]){
  float a = vBiome.x, b = vBiome.y, c = vBiome.z, d = vBiome.w;
  float e = max(1.0 - (a+b+c+d), 0.0);
  float s = max(a+b+c+d+e, 1e-4);
  w[0]=a/s; w[1]=b/s; w[2]=c/s; w[3]=d/s; w[4]=e/s;
}

void main(){
  float w[NBIOME];
  weights(w);

  vec3 tintG = vec3(0.0), tintR = vec3(0.0), haze = vec3(0.0);
  vec4 scal = vec4(0.0);
  for(int i=0;i<NBIOME;i++){
    tintG += B_GROUND[i]  * w[i];
    tintR += B_ROCK[i]    * w[i];
    haze  += B_HAZE[i]    * w[i];
    scal  += B_SCAL[i]    * w[i];
  }

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float slope = 1.0 - clamp(N.y, 0.0, 1.0);

  // ── ground colour ─────────────────────────────────────────────────────────
  // Two large-scale noise fields break the flatness: one picks between the four ground
  // stops, the other is a fine grain that survives to the horizon and stops distant
  // hillsides reading as vinyl.
  float blot = fbm2(vWorld.xz * 0.0042, 4) * 0.5 + 0.5;
  float grain = pn2(vWorld.xz * 0.16) * 0.5 + 0.5;

  vec3 lit   = mix(K_T_LIT,   K_T_MID,    blot * 0.55);
  vec3 mid   = mix(K_T_MID,   K_T_SHADE,  blot * 0.40);
  vec3 shade = mix(K_T_SHADE, K_T_HOLLOW, blot * 0.62);

  // Dryness bleaches the greens towards straw. It is a hue rotation, not a desaturation:
  // dead grass is yellow, not grey.
  vec3 dry = vec3(0.86, 0.76, 0.42);
  lit   = mix(lit,   lit   * dry * 1.45, scal.y);
  mid   = mix(mid,   mid   * dry * 1.32, scal.y);
  shade = mix(shade, shade * dry * 1.18, scal.y);

  lit *= tintG; mid *= tintG; shade *= tintG;

  // ── rock on the steep parts ───────────────────────────────────────────────
  float rockAmt = smoothstep(0.36, 0.66, slope) * (0.55 + 0.45*grain);
  vec3 rLit = K_ROCK_LIT * tintR, rShd = K_ROCK_SHADE * tintR;
  lit   = mix(lit,   rLit,          rockAmt);
  mid   = mix(mid,   mix(rLit,rShd,0.5), rockAmt);
  shade = mix(shade, rShd,          rockAmt);

  // ── snow above the line, only on ground the snow could sit on ─────────────
  float snowLine = smoothstep(120.0, 240.0, vWorld.y) * scal.z;
  float snowHold = smoothstep(0.55, 0.16, slope);
  float snow = clamp(snowLine * snowHold * (0.6 + 0.5*grain), 0.0, 1.0);
  lit   = mix(lit,   vec3(0.95,0.96,0.99), snow);
  mid   = mix(mid,   vec3(0.80,0.85,0.94), snow);
  shade = mix(shade, vec3(0.58,0.66,0.82), snow);

  // ── the road ──────────────────────────────────────────────────────────────
  float onRoad = vRoad.y;
  if(onRoad > 0.003){
    // Surface kind comes from the biome mix: tarmac in the green world, gravel in the
    // steppe, sand in the dunes. Blended, so a road entering a desert visibly silts up.
    float sandy   = w[3];
    float gravely = w[1];
    vec3 tLit = K_TAR_LIT,  tShd = K_TAR_SHADE;
    tLit = mix(tLit, K_GRAVEL_LIT, gravely*0.85);
    tShd = mix(tShd, K_GRAVEL_SHD, gravely*0.85);
    tLit = mix(tLit, K_T_LIT*1.35*dry, sandy*0.9);
    tShd = mix(tShd, K_T_MID*1.05*dry, sandy*0.9);

    // Wear: two long streaks where the wheels run, and a rough grain everywhere.
    float wear = pn2(vWorld.xz * vec2(0.9, 0.11)) * 0.5 + 0.5;
    float chip = vn2(vWorld.xz * 3.1);
    vec3 rl = mix(tLit, tLit*1.10, wear) * mix(0.94, 1.06, chip);
    vec3 rs = mix(tShd, tShd*0.92, wear);

    lit   = mix(lit,   rl,               onRoad);
    mid   = mix(mid,   mix(rl,rs,0.55),  onRoad);
    shade = mix(shade, rs,               onRoad);
  }

  // ── shading ───────────────────────────────────────────────────────────────
  float ndl = dot(N, uSunDir);
  float sh  = sunShadow(vWorld, ndl) * cloudShadow(vWorld);

  Surf s;
  s.N = N; s.V = V; s.P = vWorld;
  s.shade = shade; s.mid = mid; s.lit = lit;
  s.soft  = mix(0.16, 0.34, clamp(vDist/900.0, 0.0, 1.0));
  s.jit   = (vn2(vWorld.xz * 0.55) - 0.5) * 0.09;
  s.shadow = sh;
  s.trans = 0.0; s.transCol = vec3(0.0);
  s.rim   = mix(0.30, 0.10, onRoad);
  s.ao    = 1.0;
  s.ambient = 1.0;

  vec3 col = paint(s);

  // Standing water in the wetland: a dark wet sheen under the fog, not a mirror. The real
  // water surface is a separate mesh; this is the mud it sits on.
  col = mix(col, col*0.62 + K_W_DEEP*0.10, scal.w * smoothstep(6.0, 0.5, vWorld.y) * 0.7);

  // Biome haze colour feeds the shared aerial term.
  col = aerial(col, vDist, V, vWorld.y);
  col = mix(col, mix(col, haze, 0.55), clamp(scal.x - 1.0, 0.0, 1.2) * gFogAmt * 0.6);

  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;function nr(){const a=At({cshSpan:9200,cloudDeck:980});return new ge({glslVersion:"300 es",uniforms:Re(),vertexShader:Me(tr),fragmentShader:Oe(pe,me,er(),Ws,a,Ht,kt,sr),side:En})}const or=5,ir=1.02,ar=.75,Qn=.62,rr=1.4,eo=.85,cr=.38,lr=.36,hr=.44,to=.1,ur=.14,dr=.06,fr=`
in vec2 uv;
out vec2 vUv;
void main(){
  // One oversized triangle, not two triangles: no diagonal seam for the FXAA pass to find
  // and one less vertex-shader invocation per full-screen pass.
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,pr=`
uniform sampler2D uSrc; uniform float uThresh; uniform float uSoft;
in vec2 vUv; out vec4 outColor;
void main(){
  // the NaN firewall lives here too: one bad texel entering the bloom pyramid gets
  // smeared over a whole neighbourhood by the downsample chain
  vec3 c = SAFE3(texture(uSrc, vUv).rgb);
  float l = dot(c, vec3(0.2126,0.7152,0.0722));
  float k = smoothstep(uThresh, uThresh+uSoft, l);
  outColor = vec4(c*k, 1.0);
}`,so=`
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
}`,mr=`
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
}`,vr=`
uniform sampler2D uSrc; uniform vec2 uTexel; uniform vec2 uDir;
in vec2 vUv; out vec4 outColor;
void main(){
  vec2 d = uTexel*uDir;
  vec3 c = texture(uSrc,vUv).rgb*0.227;
  c += (texture(uSrc,vUv+d*1.3846).rgb + texture(uSrc,vUv-d*1.3846).rgb)*0.316;
  c += (texture(uSrc,vUv+d*3.2308).rgb + texture(uSrc,vUv-d*3.2308).rgb)*0.070;
  outColor = vec4(c,1.0);
}`,gr=`
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
  vec3 shadowPush = mix(vec3(0.90,0.95,1.16), vec3(1.0), smoothstep(0.0, 0.34, l));
  vec3 highPush   = mix(vec3(1.0), vec3(1.055,1.012,0.925), smoothstep(0.44, 0.98, l));
  c *= mix(vec3(1.0), shadowPush, 0.85*uPaint) * mix(vec3(1.0), highPush, 0.9*uPaint);
  // lift: nothing in a Ghibli frame is ever pure black
  vec3 lift = vec3(0.017, 0.021, 0.036)*uPaint;
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
}`;function Et(a,e,t=[]){return new ge({glslVersion:"300 es",uniforms:Re(e),vertexShader:Me(fr),fragmentShader:Oe(...t,a),depthTest:!1,depthWrite:!1})}class wr{constructor(e,{width:t,height:s,pixelRatio:n=1,renderScale:i=1,bloomLevels:o=or}={}){this.renderer=e,this.pixelRatio=n,this.renderScale=i,this.bloomLevels=Math.max(1,o|0),this.speed=0,this.limit=0,this.exposure=1,this.bloom=1,this.paint=1,this._quality=1,e.toneMapping=Ys,e.outputColorSpace=Le;const r=e.getContext(),c=!!(r.getExtension("EXT_color_buffer_half_float")||r.getExtension("EXT_color_buffer_float"));this._type=c?mn:vn,c||console.error("[post] no renderable half-float target; HDR bloom disabled (threshold 1.02 is unreachable on an 8-bit buffer)"),this._quadGeo=new nt,this._quadGeo.setAttribute("position",new U(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),this._quadGeo.setAttribute("uv",new U(new Float32Array([0,0,2,0,0,2]),2)),this._quadGeo.boundingSphere=new ot(new X,10),this._quadCam=new Cn,this._quadScene=new Hs,this._quadMesh=new Te(this._quadGeo,null),this._quadMesh.frustumCulled=!1,this._quadScene.add(this._quadMesh),this._bright=Et(pr,{uSrc:{value:null},uThresh:{value:ir},uSoft:{value:ar}}),this._downMats=[],this._upMats=[];for(let l=1;l<this.bloomLevels;l++)this._downMats.push(Et(so,{uSrc:{value:null},uTexel:{value:new le(1,1)}})),this._upMats.push(Et(mr,{uSrc:{value:null},uPrev:{value:null},uTexel:{value:new le(1,1)},uRadius:{value:rr}}));this._softDown=Et(so,{uSrc:{value:null},uTexel:{value:new le(1,1)}}),this._blurMats=[0,1].map(l=>Et(vr,{uSrc:{value:null},uTexel:{value:new le(1,1)},uDir:{value:new le(l?0:1,l?1:0)}})),this._composite=Et(gr,{uScene:{value:null},uBloom:{value:null},uSoft:{value:null},uRes:{value:new le(1,1)},uExposure:{value:1},uBloomAmt:{value:Qn},uPaint:{value:1},uCA:{value:1},uVignette:{value:eo},uGrain:{value:1},uRadial:{value:0},uVigSpeed:{value:to},uCALimit:{value:0}},[pe,me]),this._sceneRT=null,this._bloomRTs=[],this._upRTs=[],this._softRTs=[],this.setSize(t,s)}get quality(){return this._quality}set quality(e){const t=Math.min(1,Math.max(.5,e));t!==this._quality&&(this._quality=t,this._buildBloom())}get target(){return this._sceneRT}get bufferWidth(){return this._w}get bufferHeight(){return this._h}setSize(e,t){const s=this.pixelRatio*this.renderScale,n=Math.max(16,Math.floor(e*s)),i=Math.max(16,Math.floor(t*s));this._sceneRT&&n===this._w&&i===this._h||(this._w=n,this._h=i,this._sceneRT&&this._sceneRT.dispose(),this._sceneRT=new hs(n,i,{type:this._type,format:us,minFilter:ye,magFilter:ye,wrapS:Ne,wrapT:Ne,depthBuffer:!0,stencilBuffer:!1,samples:0}),this._composite.uniforms.uRes.value.set(n,i),this._softRTs.forEach(o=>o.dispose()),this._softRTs=[0,1].map(()=>this._mkRT(Math.max(2,n>>3),Math.max(2,i>>3))),this._blurMats.forEach(o=>o.uniforms.uTexel.value.set(1/this._softRTs[0].width,1/this._softRTs[0].height)),this._buildBloom())}_mkRT(e,t){return new hs(e,t,{type:this._type,format:us,minFilter:ye,magFilter:ye,wrapS:Ne,wrapT:Ne,depthBuffer:!1,stencilBuffer:!1})}_buildBloom(){this._bloomRTs.forEach(s=>s.dispose()),this._upRTs.forEach(s=>s.dispose()),this._bloomRTs=[],this._upRTs=[];let e=Math.max(2,Math.floor(this._w*this._quality)>>1),t=Math.max(2,Math.floor(this._h*this._quality)>>1);for(let s=0;s<this.bloomLevels;s++)this._bloomRTs.push(this._mkRT(e,t)),this._upRTs.push(this._mkRT(e,t)),e=Math.max(2,e>>1),t=Math.max(2,t>>1)}_blit(e,t){this._quadMesh.material=e,this.renderer.setRenderTarget(t||null),this.renderer.render(this._quadScene,this._quadCam)}render(e,t){const s=this.renderer;s.toneMapping!==Ys&&(s.toneMapping=Ys),s.outputColorSpace!==Le&&(s.outputColorSpace=Le),s.setRenderTarget(this._sceneRT),s.render(e,t),this._bright.uniforms.uSrc.value=this._sceneRT.texture,this._blit(this._bright,this._bloomRTs[0]);const n=this._bloomRTs.length;for(let c=1;c<n;c++){const l=this._downMats[c-1];l.uniforms.uSrc.value=this._bloomRTs[c-1].texture,l.uniforms.uTexel.value.set(1/this._bloomRTs[c-1].width,1/this._bloomRTs[c-1].height),this._blit(l,this._bloomRTs[c])}for(let c=0;c<n-1;c++){const l=n-2-c,h=this._upMats[c];h.uniforms.uSrc.value=c===0?this._bloomRTs[n-1].texture:this._upRTs[l+1].texture,h.uniforms.uPrev.value=this._bloomRTs[l].texture,h.uniforms.uTexel.value.set(1/this._upRTs[l].width,1/this._upRTs[l].height),this._blit(h,this._upRTs[l])}this._softDown.uniforms.uSrc.value=this._sceneRT.texture,this._softDown.uniforms.uTexel.value.set(1/this._softRTs[0].width,1/this._softRTs[0].height),this._blit(this._softDown,this._softRTs[0]),this._blurMats[0].uniforms.uSrc.value=this._softRTs[0].texture,this._blit(this._blurMats[0],this._softRTs[1]),this._blurMats[1].uniforms.uSrc.value=this._softRTs[1].texture,this._blit(this._blurMats[1],this._softRTs[0]);const i=Math.min(1,Math.max(0,this.speed)),o=Math.min(1,Math.max(0,this.limit)),r=this._composite.uniforms;r.uScene.value=this._sceneRT.texture,r.uBloom.value=(n>1?this._upRTs[0]:this._bloomRTs[0]).texture,r.uSoft.value=this._softRTs[0].texture,r.uExposure.value=this.exposure,r.uBloomAmt.value=Qn*this.bloom,r.uPaint.value=this.paint,r.uCA.value=this.paint,r.uVignette.value=eo,r.uGrain.value=this.paint,r.uRadial.value=cr*i*i*xr(lr,hr,i),r.uVigSpeed.value=to+ur*i,r.uCALimit.value=dr*o*o,this._blit(this._composite,null)}dispose(){this._sceneRT&&this._sceneRT.dispose(),this._bloomRTs.forEach(e=>e.dispose()),this._upRTs.forEach(e=>e.dispose()),this._softRTs.forEach(e=>e.dispose()),this._sceneRT=null,this._bloomRTs=[],this._upRTs=[],this._softRTs=[],[this._bright,this._softDown,this._composite,...this._downMats,...this._upMats,...this._blurMats].forEach(e=>e.dispose()),this._quadGeo.dispose(),this._quadScene.remove(this._quadMesh),this._quadMesh.material=null}}function xr(a,e,t){const s=Math.min(1,Math.max(0,(t-a)/(e-a)));return s*s*(3-2*s)}const J=Math.PI*2,Lt=Math.PI/180,K=(a,e,t)=>a<e?e:a>t?t:a,D=a=>a<0?0:a>1?1:a,F=(a,e,t)=>a+(e-a)*t,Ee=(a,e,t)=>{const s=D((t-a)/(e-a));return s*s*(3-2*s)};function Ns(a,e){let t=(e-a)%J;return t>Math.PI&&(t-=J),t<=-Math.PI&&(t+=J),t}function ke(a,e,t,s){return F(a,e,1-Math.exp(-t*s))}function br(a,e,t,s){return a+Ns(a,e)*(1-Math.exp(-t*s))}function _e(a,e,t=0){let s=Math.imul(a|0,2376512323)^Math.imul(e|0,3625334849)^Math.imul(t|0,3407524639);return s=Math.imul(s^s>>>15,739982445),s=Math.imul(s^s>>>12,695872825),(s^s>>>15)>>>0}function yi(a,e,t,s=0){let n=Math.imul(a|0,2376512323)^Math.imul(e|0,3625334849)^Math.imul(t|0,3407524639)^Math.imul(s|0,374761393);return n=Math.imul(n^n>>>13,1540483477),(n^n>>>15)>>>0}function Wt(a){let e=a>>>0;return()=>{e=e+1831565813|0;let t=Math.imul(e^e>>>15,1|e);return t=t+Math.imul(t^t>>>7,61|t)^t,((t^t>>>14)>>>0)/4294967296}}function yr(a,e){return Math.sqrt(a*a+e*e)}function no(a,e,t,s,n,i){const o=n-t,r=i-s,c=o*o+r*r;let l=c>0?((a-t)*o+(e-s)*r)/c:0;l=D(l);const h=t+o*l,u=s+r*l;return{d:yr(a-h,e-u),t:l,x:h,z:u}}function xs(a,e,t,s,n){const i=n*n,o=i*n;return(2*o-3*i+1)*a+(o-2*i+n)*e+(-2*o+3*i)*t+(o-i)*s}const _r=9200,Mr=980,Tr=4,Sr=.1,Ar=`
in vec4 wdat;      // x depth in metres, yz bed-downhill direction, w flow speed
out vec3 vW;
out vec4 vD;
out float vDist;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vD = wdat;
  vDist = length(wp.xyz - uCamPos);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,kr=a=>`
in vec3 vW;
in vec4 vD;
in float vDist;
out vec4 fragColor;

// The pen read its gusts out of a 256² wind render target that every system in the valley
// shared. Wanderoad has no wind pass yet (uWindTex is unbound), and sampling an unbound
// sampler is a black texture, not a calm day — so the cat's-paw field is analytic here.
// Two octaves at ~130 m per cell, advected slowly across the world: gust cells that are big
// enough to darken a whole bay and slow enough that you watch one arrive.
float gustAt(vec2 p){
  vec2 q = p * 0.0078 - vec2(uTime * 0.052, uTime * 0.019);
  float g = fbm2(q, 3) * 0.5 + 0.5;
  // Ceiling of 1.25 rather than the pen's 1.6: an fbm hits its ceiling far more often than
  // the pen's simulated wind field did, and at 1.6 the surface is permanently at full chop.
  return clamp(smoothstep(0.44, 0.90, g) * 1.25, 0.0, 1.25);
}

// ── band limiting ───────────────────────────────────────────────────────────
// The pen never had to solve this: its water was a 12-to-30 m ribbon that left the screen
// after a few hundred metres. A flooded wetland is a sheet running to the horizon, seen
// almost edge-on, so a pixel two kilometres out covers tens of metres of surface — and every
// noise band finer than that pixel turns into moire chevrons instead of ripples.
//
// fw is the pixel footprint per flow-space axis, straight off the hardware derivatives, and
// f is a band's frequency along each of those axes. Their dot product is how many cycles of
// that band fit inside one pixel; past about a half the band carries no information, so it
// is faded out rather than point-sampled. Same idea as a mip chain, done analytically
// because these bands are functions rather than textures.
//
// It has to be the dot product and not max(fw)*max(f). Both the footprint and the ripple
// bands are strongly anisotropic, and at grazing incidence they are anisotropic in the SAME
// direction: the pixel is long down the view, the ripples are long down the flow. Collapsing
// either to a single number is the isotropic-mip mistake, and it blurs the whole surface to
// a flat sheet the moment the camera drops towards eye level — which, in a driving game, is
// where the camera lives.
float bandLimit(vec2 fw, vec2 f){ return 1.0 - smoothstep(0.28, 0.72, dot(fw, abs(f))); }

// Anisotropic chop: four bands, all far longer down the ripple axis than across it, which is
// the single thing that makes water look like it is going somewhere. The pen's frequencies
// and weights, each gated at its own Nyquist limit, and each advected by the local current as
// a domain offset in metres rather than as a term buried inside the frequency scaling.
float ripple(vec2 q, vec2 drift, float t, float gust, vec2 fw){
  vec2 d1 = q - drift*1.122;   // 0.055/0.049 — the pen's own downstream rate, in metres
  vec2 d2 = q - drift*0.950;   // 0.115/0.121
  vec2 d3 = q - drift*0.810;   // 0.255/0.315
  // The capillary chop is wind-driven, not current-driven, so it keeps the pen's fixed
  // advection instead of following the bed.
  vec2 d4 = q - vec2(t*2.087, -t*0.667);
  float n1 = pn2(vec2(d1.x*0.049, d1.y*0.40))        * bandLimit(fw, vec2(0.049, 0.40));
  float n2 = pn2(vec2(d2.x*0.121, d2.y*0.92) + 7.0)  * bandLimit(fw, vec2(0.121, 0.92));
  float n3 = pn2(vec2(d3.x*0.315, d3.y*2.30) + 19.0) * bandLimit(fw, vec2(0.315, 2.30));
  float n4 = pn2(vec2(d4.x*1.15, d4.y*1.05) + 31.0)  * bandLimit(fw, vec2(1.15, 1.05)) * gust;
  return n1*0.52 + n2*0.30 + n3*0.17 + n4*0.30;
}

// ── the ripple frame ────────────────────────────────────────────────────────
// A rigid, world-anchored rotation of world space, gently domain-warped, seeded per world.
//
// It CANNOT be the pen's per-fragment flow frame (q = dot(P.xz, flow)). Out here a world
// position is thousands of metres long, so a two-degree wobble in an interpolated flow
// direction moves the noise domain by a hundred metres — and the downhill field of any lake
// converges on a line down its middle, where that direction sweeps through 180 degrees inside
// a single quad. The result is a fan of zebra stripes radiating from every deep channel, at a
// frequency no amount of band limiting can reach, because in the domain the stripes really
// are there.
//
// So the frame is global and linear in position: continuous everywhere, no chunk seams, and
// stable no matter how far from the origin the player has driven. The local current still
// does the work you can see — it enters as the advection velocity below, where it multiplies
// TIME instead of position and therefore cannot blow up.
const vec2 RIP_AXIS = vec2(${a.x.toFixed(6)}, ${a.z.toFixed(6)});
vec2 rippleFrame(vec2 p){
  // A ~270 m domain warp so the streaks meander instead of ruling the whole world in parallel
  // lines. Amplitude times frequency stays well under one, so the map keeps a bounded
  // derivative and the frame stays as well-behaved as the plain rotation underneath it.
  vec2 w = vec2(pn2(p*0.0037 + 11.3), pn2(p*0.0037 + 41.7)) * 46.0;
  vec2 s = p + w;
  return vec2(dot(s, RIP_AXIS), dot(s, vec2(-RIP_AXIS.y, RIP_AXIS.x)));
}

void main(){
  // Dry bed. The terrain already occludes the plane wherever the ground rises through it, so
  // this only matters at LOD cracks and along the shoreline, where a metre of tolerance stops
  // the plane's own 2 m-sampled waterline from cutting inside the mesh's 1 m-sampled one.
  if(!(vD.x > -0.5)) discard;

  vec3 P = vW;
  vec3 V = normalize(uCamPos - P);
  float depth = max(vD.x, 0.0);
  float sp = vD.w;

  vec2 q = rippleFrame(P.xz);
  vec2 fw = max(fwidth(q), vec2(1e-4));

  // The local current, expressed in the ripple frame. Interpolation is safe here: where two
  // vertices flow at each other the vector simply shortens towards zero, which is slack water
  // and reads as slack water, instead of spinning through every heading inside one quad.
  vec2 fl = vD.yz;
  fl *= min(1.0, inversesqrt(max(dot(fl, fl), 1e-8)));
  vec2 adv = vec2(dot(fl, RIP_AXIS), dot(fl, vec2(-RIP_AXIS.y, RIP_AXIS.x)));
  vec2 drift = adv * (uTime * sp);

  // Gust cells are ~32 m across at their finest, so they too stop carrying information once
  // the pixel is wider than that — and their surface darkening is the most visible aliasing
  // of the lot, because it is a contrast term rather than a colour one.
  float gust = gustAt(P.xz) * bandLimit(fw, vec2(0.031));

  // The finite differences that build the normal are sampled at the pixel footprint of their
  // OWN axis rather than at the pen's fixed 0.42 m, so each degrades into a box filter of
  // exactly the right width instead of into noise — and a grazing pixel does not drag the
  // across-axis difference out with it.
  vec2 e = max(fw, vec2(0.42));
  float h0 = ripple(q, drift, uTime, gust, fw);
  float hx = ripple(q + vec2(e.x, 0.0), drift, uTime, gust, fw);
  float hy = ripple(q + vec2(0.0, e.y), drift, uTime, gust, fw);
  float amp = mix(0.055, 0.20, clamp(sp*0.22, 0.0, 1.0)) * (0.55 + 0.9*gust);
  // Shallow water is choppier: the bed shortens the wave.
  amp *= mix(1.35, 1.0, smoothstep(0.3, 2.6, depth));
  vec2 dh = (vec2(hx, hy) - h0)/e * amp * 14.0;
  // Back out of the ripple frame into world xz. The warp is ignored in this rotation: it is a
  // few degrees of shear, and the normal only has to look right, not integrate.
  vec2 axC = vec2(-RIP_AXIS.y, RIP_AXIS.x);
  vec3 N = normalize(vec3(-(dh.x*RIP_AXIS.x + dh.y*axC.x), 1.0, -(dh.x*RIP_AXIS.y + dh.y*axC.y)));
  // Flatten with distance so a lake two kilometres away is a plate of colour and not a
  // boiling field of highlights. Barely stronger than the pen's 0.75 over 120-520 m: with
  // the bands gated above, this is now a look control rather than an anti-aliasing measure.
  N = normalize(mix(N, vec3(0.0,1.0,0.0), smoothstep(110.0, 560.0, vDist)*0.82));

  float ndl = dot(N, uSunDir);
  float sh = sunShadow(P, ndl) * cloudShadow(P);

  // ── depth-graded body colour, in bands ─────────────────────────────────────
  // Painted water is not a smooth gradient; it is a few flat plates of colour whose
  // boundaries you can point at. The pen keyed those plates off distance-across-the-channel;
  // here they key off real depth, so a shelving bay draws its own contour lines.
  float bedDepth = smoothstep(0.12, 4.4, depth);
  float plateJ = pn2(vec2(q.x*0.045, q.y*0.42) + 3.0)*0.070*bandLimit(fw, vec2(0.045, 0.42));
  float b1 = smoothstep(0.16 + plateJ, 0.30 + plateJ, bedDepth);
  float b2 = smoothstep(0.50 + plateJ, 0.68 + plateJ, bedDepth);
  vec3 body = mix(K_W_SHALLOW, K_W_MID, b1);
  body = mix(body, K_W_DEEP, b2);
  // the gravel bed showing through the shallows (cool wet stone, not sand)
  float bedN = pn2(P.xz*0.55)*0.5 + 0.5;
  vec3 wetBed = mix(${E.wetStone}, K_W_SHALLOW, 0.45) * mix(0.80, 1.06, mix(0.5, bedN, bandLimit(fw, vec2(0.55))));
  body = mix(wetBed, body, smoothstep(0.02, 0.22, bedDepth));
  // caustic light rocking over the shallow bed
  vec2 dc = q - drift*0.471;   // 0.8/1.7
  float caus = pn2(vec2(dc.x*1.7, dc.y*2.9 + uTime*0.5));
  caus = pow(clamp(caus*0.5 + 0.5, 0.0, 1.0), 3.0);
  body += ${E.wSpark}*caus*0.20*(1.0 - smoothstep(0.05, 0.40, bedDepth))*sh*bandLimit(fw, vec2(1.7, 2.9));

  // ── reflection ─────────────────────────────────────────────────────────────
  // Sky only. The pen also had a planar mirror pass for its one valley; a streaming world
  // would need one render target per water body per frame, and stylised water keeps its own
  // colour at grazing angles anyway — which is why the Fresnel term is clamped so low.
  vec3 R = reflect(-V, N);
  vec3 refl = skyDomeLite(normalize(vec3(R.x, max(R.y, 0.012), R.z)));
  float fres = 0.035 + 0.70*pow(1.0 - clamp(dot(N,V), 0.0, 1.0), 4.0);
  fres = clamp(fres, 0.0, 0.46);

  vec3 col = mix(body, refl, fres*0.86);
  col = mix(col*0.74 + K_SHADOW*0.10, col, sh*0.82 + 0.18);

  // ── flow ribbons ───────────────────────────────────────────────────────────
  // Long creases travelling downstream: they show which way the water is going with no motion
  // at all, which is what carries the read on a distant reach only twelve pixels wide.
  {
    vec2 e1 = q - drift*1.333;   // 0.10/0.075
    vec2 e2 = q - drift*1.097;   // 0.17/0.155
    float r1 = pn2(vec2(e1.x*0.075, e1.y*0.55) + 5.0);
    float r2 = pn2(vec2(e2.x*0.155, e2.y*1.05) + 41.0);
    float rib = smoothstep(0.28, 0.62, abs(r1)*0.75 + abs(r2)*0.45);
    float bright = smoothstep(0.0, 0.5, r1 + r2);
    col = mix(col, mix(${E.wDeepShade}, ${E.wSpark}, bright),
              rib*0.16*(0.4 + 0.6*sh)*bandLimit(fw, vec2(0.155, 1.05)));
  }

  // ── quantised sun glitter ──────────────────────────────────────────────────
  // Hard-stepped into discrete winking glints rather than left as a specular lobe: a
  // specular lobe on stylised water reads as plastic.
  float f = dot(normalize(R), uSunDir);
  float broad = pow(max(f, 0.0), 22.0);
  vec2 dg = q - drift*0.579 - vec2(0.0, uTime*0.097);   // 1.1/1.9 and 0.35/3.6
  float glintN = pn2(dg*vec2(1.9, 3.6))*0.5 + 0.5;
  float twinkle = step(0.42, glintN) * (0.55 + 0.75*pn2((q - vec2(uTime*0.286))*7.0));
  // A winking glint is a sub-pixel event by construction, so once a pixel is wider than the
  // glint field it hands its energy to the broad lobe rather than strobing.
  float glint = smoothstep(0.9975, 0.99925, f) * twinkle * bandLimit(fw, vec2(1.9, 3.6));
  float glitterPath = smoothstep(0.55, 1.0, dot(normalize(vec2(V.x,V.z)), -normalize(uSunDir.xz)));
  col += ${E.wSpark} * (glint*2.6 + broad*0.42) * sh * (0.35 + 0.75*glitterPath);

  // ── shore foam ─────────────────────────────────────────────────────────────
  // Keyed off the measured depth, so the foam band is a genuine contour of the bed and
  // widens by itself wherever the shore shelves gently.
  float edge = 1.0 - smoothstep(0.0, 1.25, depth);
  vec2 ds = q - drift*0.824;   // 0.7/0.85
  float scallop = mix(0.5, pn2(vec2(ds.x*0.85, ds.y*2.2))*0.5 + 0.5, bandLimit(fw, vec2(0.85, 2.2)));
  float foam = clamp(smoothstep(0.42, 0.96, edge*(0.50 + 0.95*scallop)), 0.0, 1.0);
  col = mix(col, ${E.wFoam}*mix(0.80, 1.10, scallop), foam*0.55);

  // cat's paws darken the surface where a gust touches down
  col *= mix(1.0, 0.86, smoothstep(0.75, 1.6, gust));

  col += K_SUN * pow(clamp(dot(V,-uSunDir), 0.0, 1.0), 5.0) * 0.16 * sh;
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;function Rr(a){const e=_e(11433,4574,a)/4294967296*J,t={x:Math.cos(e),z:Math.sin(e)},s=At({cshSpan:_r,cloudDeck:Mr});return new ge({glslVersion:"300 es",uniforms:Re(),vertexShader:Me(Ar),fragmentShader:Oe(pe,me,Ws,s,Ht,kt,kr(t)),transparent:!1,side:st})}const oo=new Map;function Er(a){let e=oo.get(a);if(e)return e;e=new Uint16Array((a-1)*(a-1)*6);let t=0;for(let s=0;s<a-1;s++)for(let n=0;n<a-1;n++){const i=s*a+n,o=i+1,r=i+a,c=r+1;e[t++]=i,e[t++]=r,e[t++]=o,e[t++]=o,e[t++]=r,e[t++]=c}return oo.set(a,e),e}const io=a=>`${a.level}:${a.cx},${a.cz}`;class Cr{constructor({seed:e,scene:t}){this.seed=e>>>0,this.scene=t,this.material=Rr(this.seed),this.group=new vt,this.group.name="water",this.group.matrixAutoUpdate=!1,t.add(this.group),this.planes=new Map,this.stats={live:0,visible:0},this._cullT=0,this._cam=new X}add(e){if(!e||!e.water||e.level>Tr)return;const t=io(e);if(this.planes.has(t))return;const s=this._buildPlane(e);if(!s)return;const n=new Te(s,this.material);n.position.set(e.ox,e.water.level,e.oz),n.matrixAutoUpdate=!1,n.updateMatrix(),n.frustumCulled=!0,n.renderOrder=1,n.userData.level=e.level,this.group.add(n),this.planes.set(t,n),this.stats.live=this.planes.size}remove(e){if(!e)return;const t=io(e),s=this.planes.get(t);s&&(this.group.remove(s),s.geometry.dispose(),this.planes.delete(t),this.stats.live=this.planes.size)}update(e,t){if(t&&this._cam.set(t.x,t.y,t.z),this._cullT-=e,this._cullT>0)return;this._cullT=Sr;const s=Q.uFogFar.value*1.25;let n=0;for(const i of this.planes.values()){const o=i.geometry.boundingSphere,r=i.position.x+o.center.x-this._cam.x,c=i.position.z+o.center.z-this._cam.z,l=s+o.radius,h=r*r+c*c<l*l;i.visible=h,h&&n++}this.stats.visible=n}dispose(){for(const e of this.planes.values())this.group.remove(e),e.geometry.dispose();this.planes.clear(),this.scene.remove(this.group),this.material.dispose(),this.stats.live=0,this.stats.visible=0}_buildPlane(e){const t=e.grid|0;if(t<3)return null;const s=this._bedReader(e,t);if(!s)return null;const n=t+1>>1,i=(t-1)/(n-1),o=e.water.level,r=e.size/(n-1),c=i*2,l=_e(e.cx,e.cz,this.seed^31358)/4294967296*J,h=Math.cos(l),u=Math.sin(l),d=new Float32Array(n*n*3),f=new Float32Array(n*n*4);for(let m=0;m<n;m++){const g=m*i;for(let v=0;v<n;v++){const w=v*i,b=m*n+v;d[b*3]=v*r,d[b*3+1]=0,d[b*3+2]=m*r;const y=w-c<0?0:w-c,x=w+c>t-1?t-1:w+c,S=g-c<0?0:g-c,_=g+c>t-1?t-1:g+c,M=(s(x,g)-s(y,g))/((x-y)*e.step)||0,T=(s(w,_)-s(w,S))/((_-S)*e.step)||0;let R=-M,L=-T;const A=Math.sqrt(R*R+L*L);A>.001?(R/=A,L/=A):(R=h,L=u);const k=o-s(w,g);f[b*4]=k,f[b*4+1]=R,f[b*4+2]=L;const z=1-.72*D((k-1.2)/7);f[b*4+3]=(.35+2*D(A*8))*z}}const p=new nt;return p.setAttribute("position",new U(d,3)),p.setAttribute("wdat",new U(f,4)),p.setIndex(new U(Er(n),1)),p.boundingSphere=new ot(new X(e.size*.5,0,e.size*.5),e.size*.7072),p}_bedReader(e,t){const s=e.heights;if(s&&s.length>=t*t)return(o,r)=>s[r*t+o];const n=e.mesh&&e.mesh.geometry&&e.mesh.geometry.getAttribute("position");if(!n||n.count<t*t)return null;const i=n.array;return(o,r)=>i[(r*t+o)*3+1]}}const ss=9,ns=3050,Dt=ss*ns,zr=9200,ao=980,Lr=10500,xn=12800,ro=1500,Dr=.35,co=2.3,Fr=`
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
`,Ir=`
in vec2 vUv;
out vec4 fragColor;
void main(){
  vec2 q = uCloudShOrigin + (vUv - 0.5)*CSH_SPAN;
  float c = smoothstep(0.06, 0.60, cloudField(q));
  fragColor = vec4(c, c, c, 1.0);
}
`,lo=`
in vec2 uv;
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`,Pr=`
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

const float DECK_PERIOD = ${Dt.toFixed(1)};

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
  op *= 1.0 - smoothstep(${Lr.toFixed(1)}, ${xn.toFixed(1)}, length(uCamPos - wc));
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
`,Nr=`
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
`,_i=new Hs,Or=new Cn,Br=(()=>{const a=new nt;a.setAttribute("position",new U(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),a.setAttribute("uv",new U(new Float32Array([0,0,2,0,0,2]),2)),a.boundingSphere=new ot(new X,10);const e=new Te(a,null);return e.frustumCulled=!1,_i.add(e),e})();function ho(a,e,t){Br.material=e,a.setRenderTarget(t),a.render(_i,Or),a.setRenderTarget(null)}function Gr(a){const e=Wt(_e(23568,53445,a>>>0)),t=[];for(let h=0;h<ss;h++)for(let u=0;u<ss;u++){const d=(u-(ss-1)/2)*ns+(e()-.5)*ns*.75,f=(h-(ss-1)/2)*ns+(e()-.5)*ns*.75,p=620+e()*820,m=.72+e()*.85,g=2+(e()*3|0),v=(300+e()*230)*m;let w=0;const b=[],y=7+(e()*7|0);for(let x=0;x<y;x++){const S=e()*J,_=Math.sqrt(e())*v,M=Math.cos(S)*_,T=Math.sin(S)*_*.72,R=e()*.1*v;b.push({x:M,y:R,z:T,rad:(.44+e()*.32)*v,seed:e()*100}),R>w&&(w=R)}for(let x=0;x<g;x++){const S=e()*J,_=Math.sqrt(e())*v*.55,M=Math.cos(S)*_,T=Math.sin(S)*_*.7,R=(.85+e()*1.15)*v,L=4+(e()*4|0);for(let A=0;A<L;A++){const k=A/(L-1),z=k*R,N=(.52-.22*k*k+e()*.13)*v*(1-.25*k),H=(e()-.5)*v*.3*(.4+k),B=(e()-.5)*v*.3*(.4+k);if(b.push({x:M+H,y:z,z:T+B,rad:N,seed:e()*100}),z>w&&(w=z),A>0&&e()<.7){const $=e()*J,se=N*(.55+e()*.5);b.push({x:M+H+Math.cos($)*se,y:z+(e()-.3)*N*.5,z:T+B+Math.sin($)*se,rad:N*(.42+e()*.3),seed:e()*100})}}}for(const x of b)t.push({cx:d+x.x,cy:p+x.y,cz:f+x.z,rad:x.rad,seed:x.seed,hf:w>1?K(x.y/w,0,1):.5,fx:d,fz:f})}const s=t.length,n=new Float32Array(s*4*3),i=new Float32Array(s*4*2),o=new Float32Array(s*4*3),r=new Float32Array(s*4*2);for(let h=0;h<s;h++){const u=t[h];for(let d=0;d<4;d++){const f=h*4+d;n[f*3]=u.cx,n[f*3+1]=u.cy,n[f*3+2]=u.cz,i[f*2]=d===1||d===3?1:-1,i[f*2+1]=d>=2?1:-1,o[f*3]=u.rad,o[f*3+1]=u.seed,o[f*3+2]=u.hf,r[f*2]=u.fx,r[f*2+1]=u.fz}}const c=new nt;c.setAttribute("position",new U(n,3)),c.setAttribute("corner",new U(i,2)),c.setAttribute("pdata",new U(o,3)),c.setAttribute("fcen",new U(r,2));const l=new Uint32Array(s*6);return c.setIndex(new U(l,1)),c.boundingSphere=new ot(new X(0,900,0),Dt),{geom:c,puffs:t,index:l,count:s}}class Ur{constructor({renderer:e,scene:t,seed:s}){this.renderer=e,this.scene=t,this.seed=s>>>0;const n=At({cshSpan:zr,cloudDeck:ao});this.puffRT=new hs(1024,1024,{format:us,type:vn,minFilter:zn,magFilter:ye,generateMipmaps:!0,depthBuffer:!1});const i=new ge({glslVersion:"300 es",uniforms:Re(),vertexShader:Me(lo),fragmentShader:Oe(pe,me,Fr),depthTest:!1,depthWrite:!1});ho(e,i,this.puffRT),i.dispose(),this.shadowRT=new hs(512,512,{format:us,type:vn,minFilter:ye,magFilter:ye,wrapS:Ne,wrapT:Ne,generateMipmaps:!1,depthBuffer:!1}),this.shadowMat=new ge({glslVersion:"300 es",uniforms:Re({uCloudSh:{value:null}}),vertexShader:Me(lo),fragmentShader:Oe(pe,me,n,Ir),depthTest:!1,depthWrite:!1}),Q.uCloudSh.value=this.shadowRT.texture,this.deck=Gr(this.seed),this.material=new ge({glslVersion:"300 es",uniforms:Re({uPuff:{value:this.puffRT.texture}}),vertexShader:Me(pe,me,n,Pr),fragmentShader:Oe(kt,Nr),side:st,transparent:!0,depthTest:!0,depthWrite:!1,blending:hi,blendSrc:li,blendDst:ci,blendEquation:Is,blendSrcAlpha:ri,blendDstAlpha:ai,blendEquationAlpha:Is}),this.mesh=new Te(this.deck.geom,this.material),this.mesh.name="clouds",this.mesh.frustumCulled=!1,this.mesh.matrixAutoUpdate=!1,this.mesh.renderOrder=40,t.add(this.mesh);const o=_e(7482,49421,this.seed)/4294967296*J;this._driftX=Math.cos(o)*co,this._driftZ=Math.sin(o)*co,this._sortT=0,this._dist=new Float32Array(this.deck.count),this._order=new Int32Array(this.deck.count);for(let r=0;r<this.deck.count;r++)this._order[r]=r;this.stats={puffs:this.deck.count,drawn:0},this.update(0,{x:0,y:0,z:0})}update(e,t){const s=t?t.x:0,n=t?t.y:0,i=t?t.z:0,o=Q.uTime.value;Q.uCloudDrift.value.set(this._driftX*o,this._driftZ*o),this._sortT-=e,this._sortT<=0&&(this._sortT=Dr,this._sort(s,n,i));const r=Q.uSunDir.value,c=(ao-n)/Math.max(r.y,.06);Q.uCloudShOrigin.value.set(s+r.x*c,i+r.z*c),ho(this.renderer,this.shadowMat,this.shadowRT)}_sort(e,t,s){const n=this.deck.puffs,i=this.deck.index,o=n.length,r=this._dist,c=this._order,l=Q.uCloudDrift.value.x,h=Q.uCloudDrift.value.y;for(let m=0;m<o;m++){const g=n[m],v=Math.round((e-(g.fx+l))/Dt)*Dt,w=Math.round((s-(g.fz+h))/Dt)*Dt,b=g.cx+l+v-e,y=g.cy-t,x=g.cz+h+w-s;r[m]=b*b+y*y+x*x}for(let m=1;m<o;m++){const g=c[m],v=r[g];let w=m-1;for(;w>=0&&r[c[w]]<v;)c[w+1]=c[w],w--;c[w+1]=g}const u=xn*xn;let d=0;for(let m=0;m<o;m++)r[c[m]]<=u&&d++;let f=d>ro?d-ro:0,p=0;for(let m=0;m<o;m++){const g=c[m];if(r[g]>u)continue;if(f>0){f--;continue}const v=g*4;i[p++]=v,i[p++]=v+1,i[p++]=v+2,i[p++]=v,i[p++]=v+2,i[p++]=v+3}this.deck.geom.index.needsUpdate=!0,this.deck.geom.setDrawRange(0,p),this.stats.drawn=p/6}dispose(){this.scene.remove(this.mesh),this.deck.geom.dispose(),this.material.dispose(),this.shadowMat.dispose(),Q.uCloudSh.value===this.shadowRT.texture&&(Q.uCloudSh.value=null),this.shadowRT.dispose(),this.puffRT.dispose(),this.stats.drawn=0}}const ds=64,os=new Float32Array(ds),is=new Float32Array(ds);for(let a=0;a<ds;a++){const e=a/ds*6.283185307179586;os[a]=Math.cos(e),is[a]=Math.sin(e)}const bs=ds-1;function Ve(a,e,t=0){const s=Math.floor(a),n=Math.floor(e),i=a-s,o=e-n,r=i*i*i*(i*(i*6-15)+10),c=o*o*o*(o*(o*6-15)+10),l=_e(s,n,t)>>>20&bs,h=_e(s+1,n,t)>>>20&bs,u=_e(s,n+1,t)>>>20&bs,d=_e(s+1,n+1,t)>>>20&bs,f=os[l]*i+is[l]*o,p=os[h]*(i-1)+is[h]*o,m=os[u]*i+is[u]*(o-1),g=os[d]*(i-1)+is[d]*(o-1);return F(F(f,p,r),F(m,g,r),c)*1.42}function Ye(a,e,t=5,s=0,n=2.03,i=.5){let o=.5,r=1,c=0,l=0;for(let h=0;h<t;h++)c+=o*Ve(a*r,e*r,s+h*1013),l+=o,o*=i,r*=n;return c/l}function bn(a,e,t=5,s=0,n=2.07,i=.5){let o=.5,r=1,c=0,l=0,h=1;for(let u=0;u<t;u++){let d=1-Math.abs(Ve(a*r,e*r,s+u*7919));d*=d,d*=h,h=d*1.6,h>1?h=1:h<0&&(h=0),c+=o*d,l+=o,o*=i,r*=n}return c/l*2-1}function Hr(a,e,t=4,s=0,n=2,i=.5){let o=.5,r=1,c=0,l=0;for(let h=0;h<t;h++)c+=o*Math.abs(Ve(a*r,e*r,s+h*3733)),l+=o,o*=i,r*=n;return c/l*2-1}function Mi(a,e,t,s,n=1){const i=Ye(a+5.2,e+1.3,3,s+101),o=Ye(a+9.7,e+4.1,3,s+227);return Ye(a+n*i,e+n*o,t,s)}const ut={MEADOW:0,STEPPE:1,HIGHLAND:2,DUNES:3,WETLAND:4},he=5,yn=["Meadow","Steppe","Highlands","Dunes","Wetland"],ys=1/7200,uo=1/15500,fo=1/9800,po=1/2600;function Wr(a,e,t){const s=Mi(a*ys,e*ys,5,t^6699,.8),n=bn(a*ys*1.7,e*ys*1.7,4,t^23613);let i=D(.5+s*.62+Math.max(0,n)*.34-.06);const o=Ye(a*uo+41.3,e*uo-17.9,3,t^30635);let r=D(.5+o*.85-Ee(.52,.95,i)*.62);const c=Ye(a*fo-88.1,e*fo+12.7,4,t^13297),l=Ee(.44,.16,i);let h=D(.5+c*.9+l*.3-Ee(.55,.9,i)*.25);const u=Ve(a*po,e*po,t^40503)*.045;return i=D(i+u),r=D(r+u*1.4),h=D(h-u*1.1),{e:i,t:r,m:h}}const mo=a=>D(.5+(a-.5)*1.92);function Ti(a,e,t){const s=Wr(a,e,t),n=mo(s.e),i=mo(s.t),o=D(.5+(s.t-s.m)*1.45);return{ue:n,ut:i,ua:o,e:s.e,t:s.t,m:s.m}}const Kr=[[.5,.45,.52,1.9,2.3,1.3,1],[.48,.72,.64,1.6,2.6,1.6,1.32],[.88,.45,.26,3,1.1,2,1.35],[.42,.95,.8,1.5,3.1,1.7,1.55],[.13,.12,.52,2.6,2.6,1,1.5]],Si=new Float32Array(he),Ai=new Float32Array([1,1,1,1,1]);function qr(a){for(let e=0;e<he;e++)Ai[e]=a&&a[e]>0?a[e]:1}function ki(a,e,t,s=Si){const n=Ti(a,e,t);return _n(n,s)}function _n(a,e=Si){let t=0,s=0,n=-1;for(let o=0;o<he;o++){const r=Kr[o],c=(a.ue-r[0])*r[3],l=(a.ua-r[1])*r[4],h=(a.ut-r[2])*r[5],u=r[6]*Ai[o]*Math.exp(-(c*c+l*l+h*h));e[o]=u,t+=u,u>n&&(n=u,s=o)}const i=1/(t||1);for(let o=0;o<he;o++)e[o]*=i;return{w:e,dominant:s,e:a.e,t:a.t,m:a.m,ue:a.ue,ua:a.ua,ut:a.ut}}const je=[{amp:30,base:6,rough:.18,wave:460,drive:1,water:1.2},{amp:18,base:3,rough:.1,wave:900,drive:1,water:0},{amp:178,base:14,rough:.86,wave:1600,drive:1,water:.6},{amp:26,base:2,rough:.02,wave:430,drive:1,water:0},{amp:7,base:-2,rough:.05,wave:700,drive:1,water:2.5}];function $r(a,e,t,s){const n=je[s],i=1/n.wave;switch(s){case ut.MEADOW:{const o=Mi(a*i,e*i,5,t^2577,.55),r=bn(a*i*.6,e*i*.6,3,t^2578,2,.4);return n.base+(o*.82+r*.18)*n.amp}case ut.STEPPE:{const o=Ye(a*i,e*i,4,t^2849,2,.42),r=Ve(a*i*.35,e*i*.35,t^2850);return n.base+(o*.55+r*.45)*n.amp}case ut.HIGHLAND:{const o=bn(a*i,e*i,6,t^3121,2,.4),r=Ye(a*i*2.1,e*i*2.1,4,t^3122,2,.4),c=D(o*.5+.5),l=Math.pow(c,1.55)*1.62-.36;return n.base+(l*.88+r*.12)*n.amp}case ut.DUNES:{const o=Hr(a*i,e*i,4,t^3393,2,.42),r=Math.sin((a*.0121+e*.0047)*6.283+Ye(a*i*.5,e*i*.5,3,t^3394)*4.2);return n.base+(o*.55+r*.45)*n.amp}case ut.WETLAND:{const o=Ye(a*i,e*i,4,t^3665,2,.42),r=Ee(.15,-.35,o);return n.base+o*n.amp-r*4.5}default:return 0}}function In(a,e){let t=0,s=0;for(let i=0;i<he;i++){const o=a[i];o<.02||(t+=je[i].water*o,s+=o)}if(s<=0)return null;const n=t/s;return e<n?n:null}const ps=[{trees:26,rocks:5,bushes:16,reeds:0,posts:.6,grass:1,kinds:["broadleaf","broadleaf","poplar"]},{trees:4,rocks:8,bushes:9,reeds:0,posts:.9,grass:.72,kinds:["acacia","scrub"]},{trees:18,rocks:26,bushes:6,reeds:0,posts:.4,grass:.34,kinds:["pine","pine","deadpine"]},{trees:.5,rocks:10,bushes:2,reeds:0,posts:.25,grass:.06,kinds:["palm","scrub"]},{trees:11,rocks:2,bushes:12,reeds:34,posts:1.2,grass:.8,kinds:["willow","willow","broadleaf"]}],Zs=[{surface:"tarmac",grip:1,rough:.06,width:8,lines:1},{surface:"gravel",grip:.78,rough:.3,width:9,lines:.15},{surface:"tarmac",grip:.92,rough:.14,width:6.8,lines:.8},{surface:"sand",grip:.62,rough:.42,width:10.5,lines:0},{surface:"tarmac",grip:.86,rough:.1,width:7.2,lines:.6}];function jr(a,e,t){let s=0;for(let n=0;n<he;n++)s+=a[n]*e[n][t];return s}const Bt=[{cell:1800,jitter:.34,connect:.86,width:8.6,verge:5,curve:.44,samples:14},{cell:620,jitter:.42,connect:.5,width:6.2,verge:3,curve:.62,samples:10}],Mn=1/4294967296;function yt(a,e,t,s,n){const i=Bt[t],o=_e(a,e,s^(t===0?20858:11165)),r=((o&65535)*Mn*65536-.5)*2*i.jitter,c=((o>>>16&65535)*Mn*65536-.5)*2*i.jitter;return n[0]=(a+.5+r)*i.cell,n[1]=(e+.5+c)*i.cell,n}function as(a,e,t,s,n){const i=Bt[s];return _e(a*2+t,e,n^(s===0?40001:20343))*Mn<i.connect}const Qe=[0,0],Ce=[0,0];function vo(a,e,t,s,n){const i=Bt[t];yt(a,e,t,s,Qe);let o=0,r=0;as(a,e,0,t,s)&&(yt(a+1,e,t,s,Ce),o+=Ce[0]-Qe[0],r+=Ce[1]-Qe[1]),as(a-1,e,0,t,s)&&(yt(a-1,e,t,s,Ce),o+=Qe[0]-Ce[0],r+=Qe[1]-Ce[1]),as(a,e,1,t,s)&&(yt(a,e+1,t,s,Ce),o+=Ce[0]-Qe[0],r+=Ce[1]-Qe[1]),as(a,e-1,1,t,s)&&(yt(a,e-1,t,s,Ce),o+=Qe[0]-Ce[0],r+=Qe[1]-Ce[1]);const c=Math.hypot(o,r);if(c<1e-5)n[0]=i.cell,n[1]=0;else{const l=i.cell*i.curve*2/c;n[0]=o*l,n[1]=r*l}return n}const Js=[0,0],Qs=[0,0];function Vr(a,e,t,s,n,i,o,r,c,l){const h=c*c,u=h*c,d=2*u-3*h+1,f=u-2*h+c,p=-2*u+3*h,m=u-h;return l[0]=d*a+f*t+p*n+m*o,l[1]=d*e+f*s+p*i+m*r,l}function Yr(a,e,t,s,n){const i=Bt[s],o=t===0?a+1:a,r=t===0?e:e+1,c=yt(a,e,s,n,[0,0]),l=yt(o,r,s,n,[0,0]);vo(a,e,s,n,Js),vo(o,r,s,n,Qs);const h=i.samples,u=new Float32Array((h+1)*2),d=[0,0];for(let m=0;m<=h;m++)Vr(c[0],c[1],Js[0],Js[1],l[0],l[1],Qs[0],Qs[1],m/h,d),u[m*2]=d[0],u[m*2+1]=d[1];const p=1+((_e(a*3+t,e*7,n^30657)&255)/255-.5)*.22;return{tier:s,pts:u,y:new Float32Array(h+1),width:i.width*p,verge:i.verge,key:`${s}:${a},${e},${t}`,minX:0,maxX:0,minZ:0,maxZ:0}}function Xr(a){let e=1/0,t=-1/0,s=1/0,n=-1/0;for(let i=0;i<a.pts.length;i+=2){const o=a.pts[i],r=a.pts[i+1];o<e&&(e=o),o>t&&(t=o),r<s&&(s=r),r>n&&(n=r)}a.minX=e,a.maxX=t,a.minZ=s,a.maxZ=n}function Ri(a,e,t,s,n,i=40){const o=[];for(let r=0;r<Bt.length;r++){const c=Bt[r],l=c.cell*(.5+c.curve)+i,h=Math.floor((a-l)/c.cell),u=Math.floor((t+l)/c.cell),d=Math.floor((e-l)/c.cell),f=Math.floor((s+l)/c.cell);for(let p=d;p<=f;p++)for(let m=h;m<=u;m++)for(let g=0;g<2;g++){if(!as(m,p,g,r,n))continue;const v=Yr(m,p,g,r,n);Xr(v);const w=v.width*.5+v.verge+i;v.maxX<a-w||v.minX>t+w||v.maxZ<e-w||v.minZ>s+w||o.push(v)}}return o}const rs=18;function Ei(a,e,t=null){const s=a.y.length,n=new Float32Array(s);for(let r=0;r<s;r++)n[r]=e(a.pts[r*2],a.pts[r*2+1]);a.y.set(n);const i=a.tier===0?6:3,o=new Float32Array(s);for(let r=0;r<i;r++){for(let c=0;c<s;c++){const l=a.y[Math.max(0,c-1)],h=a.y[c],u=a.y[Math.min(s-1,c+1)];o[c]=l*.25+h*.5+u*.25}a.y.set(o)}for(let r=0;r<s;r++){const c=a.y[r]-n[r];if(c>rs?a.y[r]=n[r]+rs:c<-rs&&(a.y[r]=n[r]-rs),t){const l=t(a.pts[r*2],a.pts[r*2+1]);l!==null&&a.y[r]<l+1.1&&(a.y[r]=l+1.1)}}for(let r=1;r<s-1;r++)o[r]=a.y[r-1]*.2+a.y[r]*.6+a.y[r+1]*.2;if(o[0]=a.y[0],o[s-1]=a.y[s-1],a.y.set(o),t){for(let r=0;r<s;r++){const c=t(a.pts[r*2],a.pts[r*2+1]);c!==null&&a.y[r]<c+1.1&&(a.y[r]=c+1.1)}for(let r=1;r<s-1;r++){const c=a.y[r-1]*.25+a.y[r]*.5+a.y[r+1]*.25,l=t(a.pts[r*2],a.pts[r*2+1]);o[r]=l!==null?Math.max(c,l+1.1):c}o[0]=a.y[0],o[s-1]=a.y[s-1],a.y.set(o)}return a}class Zr{constructor(e,t,s,n,i,o,r=60,c=null){this.edges=Ri(e,t,s,n,i,r),this.seed=i,this._land=o;for(const l of this.edges)Ei(l,o,c)}query(e,t){let s=1/0,n=0,i=0,o=0,r=1,c=0,l=0,h=0,u=null;for(const d of this.edges){const f=d.width*.5+d.verge+30;if(e<d.minX-f||e>d.maxX+f||t<d.minZ-f||t>d.maxZ+f)continue;const p=d.pts,m=p.length/2-1;for(let g=0;g<m;g++){const v=p[g*2],w=p[g*2+1],b=p[g*2+2],y=p[g*2+3],x=no(e,t,v,w,b,y);if(x.d<s){s=x.d,n=F(d.y[g],d.y[g+1],x.t),i=d.width,o=d.tier;const S=b-v,_=y-w,M=Math.hypot(S,_)||1;r=S/M,c=_/M,l=x.x,h=x.z,u=d}}}return{d:s,y:n,width:i,tier:o,tx:r,tz:c,qx:l,qz:h,edge:u}}carve(e,t,s={mask:0,y:0,edge:0,d:1/0,tier:0,tx:1,tz:0,width:0}){let n=0,i=0,o=0,r=0,c=1/0,l=0,h=0,u=1,d=0;for(const f of this.edges){const p=f.width*.5,m=p+f.verge*2.6+60;if(e<f.minX-m||e>f.maxX+m||t<f.minZ-m||t>f.maxZ+m)continue;const g=f.pts,v=g.length/2-1;let w=1/0,b=0,y=1,x=0;for(let T=0;T<v;T++){const R=g[T*2],L=g[T*2+1],A=g[T*2+2],k=g[T*2+3],z=no(e,t,R,L,A,k);if(z.d<w){w=z.d,b=F(f.y[T],f.y[T+1],z.t);const N=A-R,H=k-L,B=Math.hypot(N,H)||1;y=N/B,x=H/B}}if(w>m)continue;const S=Math.abs(b-this._land(e,t)),_=p+3+Math.min(S,rs+4)*1.6,M=1-Ee(p,_,w);M<=5e-4||(n+=M,i+=M*b,o=Math.max(o,M),w<c&&(c=w,l=f.width,h=f.tier,u=y,d=x,r=1-Ee(p-.4,p+.35,w)))}return s.d=c,s.tier=h,s.tx=u,s.tz=d,s.width=l,s.mask=o,s.edge=r,s.y=n>1e-6?i/n:0,s}}const Jr=new Float32Array(he),Qr=.02;function Os(a,e,t,s){let n=0;for(let i=0;i<he;i++){const o=s[i];o<Qr||(n+=o*$r(a,e,t,i))}return n+Ye(a*.055,e*.055,3,t^7949,2,.4)*.55}function Ci(a,e,t){const{w:s}=ki(a,e,t,Jr);return Os(a,e,t,s)}const zi=a=>(e,t)=>Ci(e,t,a),Li=a=>(e,t)=>{const{w:s}=ki(e,t,a,ec);return In(s,Os(e,t,a,s))},ec=new Float32Array(he),He=48;class tc{constructor(e,t,s,n,i,o=128){this.seed=e,this.x0=Math.floor((t-o)/He)*He,this.z0=Math.floor((s-o)/He)*He,this.nx=Math.ceil((n+o-this.x0)/He)+2,this.nz=Math.ceil((i+o-this.z0)/He)+2;const r=this.nx*this.nz;this.ue=new Float32Array(r),this.ua=new Float32Array(r),this.ut=new Float32Array(r);for(let c=0;c<this.nz;c++)for(let l=0;l<this.nx;l++){const h=Ti(this.x0+l*He,this.z0+c*He,e),u=c*this.nx+l;this.ue[u]=h.ue,this.ua[u]=h.ua,this.ut[u]=h.ut}this._out={ue:0,ua:0,ut:0,e:0,t:0,m:0}}sample(e,t){const s=(e-this.x0)/He,n=(t-this.z0)/He;let i=Math.floor(s),o=Math.floor(n);i<0?i=0:i>this.nx-2&&(i=this.nx-2),o<0?o=0:o>this.nz-2&&(o=this.nz-2);const r=D(s-i),c=D(n-o),l=o*this.nx+i,h=l+1,u=l+this.nx,d=u+1,f=m=>F(F(m[l],m[h],r),F(m[u],m[d],r),c),p=this._out;return p.ue=f(this.ue),p.ua=f(this.ua),p.ut=f(this.ut),p}}class Gt{constructor(e,t,s,n,i,o=80){this.seed=e,this.climate=new tc(e,t,s,n,i,o+64),this.roads=new Zr(t,s,n,i,e,zi(e),o,Li(e)),this._carve={mask:0,y:0,edge:0,d:1/0,tier:0,tx:1,tz:0,width:0},this._wl=new Float32Array(he)}weights(e,t,s=this._wl){return _n(this.climate.sample(e,t),s)}land(e,t){const{w:s}=this.weights(e,t);return Os(e,t,this.seed,s)}height(e,t){const{w:s}=this.weights(e,t),n=Os(e,t,this.seed,s),i=this.roads.carve(e,t,this._carve);if(i.mask<=.001)return n;let o=0;for(let f=0;f<he;f++)o+=s[f]*je[f].drive;const r=i.y,c=Math.abs(n-r),l=i.width*.5,h=l+3+c*1.5,u=(1-Ee(l,h,i.d))*D(o);let d=F(n,r,u);if(i.edge>.001){const f=D(i.d/l||0);d-=i.edge*f*f*.18}return d}normal(e,t,s=.6,n=[0,1,0]){const i=this.height(e-s,t),o=this.height(e+s,t),r=this.height(e,t-s),c=this.height(e,t+s),l=i-o,h=r-c,u=2*s,d=Math.hypot(l,u,h)||1;return n[0]=l/d,n[1]=u/d,n[2]=h/d,n}surface(e,t,s=null){const n=s||(this._surf||={y:0,nx:0,ny:1,nz:0,w:new Float32Array(he),dominant:0,onRoad:0,roadDist:1/0,roadTier:0,roadTx:1,roadTz:0,grip:1,rough:0,surfaceKind:"grass"}),i=_n(this.climate.sample(e,t),n.w);n.dominant=i.dominant,n.y=this.height(e,t);const o=this.normal(e,t);n.nx=o[0],n.ny=o[1],n.nz=o[2];const r=this.roads.carve(e,t,this._carve);n.onRoad=r.edge,n.roadDist=r.d,n.roadTier=r.tier,n.roadTx=r.tx,n.roadTz=r.tz;let c=0,l=0;for(let d=0;d<he;d++)c+=n.w[d]*Zs[d].grip,l+=n.w[d]*Zs[d].rough;const h=F(.52,.72,n.w[0]+n.w[4]),u=F(.85,.45,n.w[0]);return n.grip=F(h,c,n.onRoad),n.rough=F(u,l,n.onRoad),n.surfaceKind=n.onRoad>.5?Zs[i.dominant].surface:"ground",n}quickHeight(e,t){return this.height(e,t)}}function go(a,e=0,t=0){const n=new Gt(a,e-3e3,t-3e3,e+3e3,t+3e3,120);let i=null;for(const o of n.roads.edges){if(o.tier!==0)continue;const r=o.pts.length/2;for(let c=1;c<r-1;c++){const l=o.pts[c*2],h=o.pts[c*2+1],u=Math.abs(o.y[c+1]-o.y[c-1]),d=Math.hypot(l-e,h-t),f=u*40+d*.01;if(!i||f<i.score){const p=o.pts[c*2+2]-o.pts[c*2-2],m=o.pts[c*2+3]-o.pts[c*2-1];i={x:l,z:h,y:n.height(l,h),heading:Math.atan2(p,m),score:f}}}}return i||{x:e,z:t,y:n.height(e,t),heading:0,score:0}}const cs=64,sc=8,nc=30,oc=a=>a<=2?65:33,ic=65,Ut=a=>cs*(1<<a);function ac(a){const{cx:e,cz:t,level:s,seed:n}=a,i=Ut(s),o=oc(s),r=e*i,c=t*i,l=i/(o-1),h=new Gt(n,r,c,r+i,c+i,Math.max(80,l*3)),u=o*o,d=(o-1)*4,f=u+d,p=new Float32Array(f*3),m=new Float32Array(f*3),g=new Uint8Array(f*4),v=new Uint8Array(f*2),w=new Float32Array(u);let b=1/0,y=-1/0,x=1/0,S=-1/0,_=!1;const M=new Float32Array(he),T={mask:0,y:0,edge:0,d:1/0,tier:0,tx:1,tz:0,width:0};for(let C=0;C<o;C++){const O=c+C*l;for(let V=0;V<o;V++){const ie=r+V*l,ee=C*o+V,ne=h.height(ie,O);w[ee]=ne,ne<b&&(b=ne),ne>y&&(y=ne),p[ee*3]=V*l,p[ee*3+1]=ne,p[ee*3+2]=C*l,h.weights(ie,O,M),g[ee*4]=M[0]*255|0,g[ee*4+1]=M[1]*255|0,g[ee*4+2]=M[2]*255|0,g[ee*4+3]=M[3]*255|0,h.roads.carve(ie,O,T),v[ee*2]=D(T.mask)*255|0,v[ee*2+1]=D(T.edge)*255|0;const ue=In(M,ne);ue!==null&&(_=!0,ue<x&&(x=ue),ue>S&&(S=ue))}}for(let C=0;C<o;C++)for(let O=0;O<o;O++){const V=C*o+O,ie=w[C*o+Math.max(0,O-1)],ee=w[C*o+Math.min(o-1,O+1)],ne=w[Math.max(0,C-1)*o+O],ue=w[Math.min(o-1,C+1)*o+O],we=O===0||O===o-1?l:l*2,Be=C===0||C===o-1?l:l*2;let Y=(ie-ee)/we,Ge=(ne-ue)/Be;const Ue=Math.hypot(Y,1,Ge);m[V*3]=Y/Ue,m[V*3+1]=1/Ue,m[V*3+2]=Ge/Ue}const L=(o-1)*(o-1)*6+d*6,A=f>65535?Uint32Array:Uint16Array,k=new A(L);let z=0;for(let C=0;C<o-1;C++)for(let O=0;O<o-1;O++){const V=C*o+O,ie=V+1,ee=V+o,ne=ee+1;((O^C)&1)===0?(k[z++]=V,k[z++]=ee,k[z++]=ie,k[z++]=ie,k[z++]=ee,k[z++]=ne):(k[z++]=V,k[z++]=ee,k[z++]=ne,k[z++]=V,k[z++]=ne,k[z++]=ie)}let N=u;const H=C=>{const O=C*3;return p[N*3]=p[O],p[N*3+1]=p[O+1]-nc,p[N*3+2]=p[O+2],m[N*3]=m[O],m[N*3+1]=m[O+1],m[N*3+2]=m[O+2],g[N*4]=g[C*4],g[N*4+1]=g[C*4+1],g[N*4+2]=g[C*4+2],g[N*4+3]=g[C*4+3],v[N*2]=v[C*2],v[N*2+1]=v[C*2+1],N++},B=[];for(let C=0;C<o-1;C++)B.push(C);for(let C=0;C<o-1;C++)B.push(C*o+(o-1));for(let C=o-1;C>0;C--)B.push((o-1)*o+C);for(let C=o-1;C>0;C--)B.push(C*o);const $=B.map(H);for(let C=0;C<B.length;C++){const O=B[C],V=B[(C+1)%B.length],ie=$[C],ee=$[(C+1)%B.length];k[z++]=O,k[z++]=ie,k[z++]=V,k[z++]=V,k[z++]=ie,k[z++]=ee}let se=null;return _&&(se={level:(x+S)*.5,minY:b,maxY:y}),{cx:e,cz:t,level:s,size:i,ox:r,oz:c,step:l,grid:o,minY:b,maxY:y,vertCount:f,position:p,normal:m,biome:g,road:v,index:k,heights:s===0?w:null,water:se}}const fs=2,Di=["trees","rocks","bushes","reeds","posts"],rc={trees:1414677829,rocks:1380926283,bushes:1112888136,reeds:1380271428,posts:1347375956},cc=.7,lc=34,hc=6,Ls={},Fi={},Ii={};for(const a of Di){let e=0;for(let t=0;t<he;t++)e=Math.max(e,ps[t][a]);Ls[a]=a==="posts"?lc:Math.sqrt(1e4*cc/e),Fi[a]=Ls[a]*Ls[a],Ii[a]=a==="posts"?hc:1}const uc={trees:Math.cos(34*Lt),rocks:Math.cos(58*Lt),bushes:Math.cos(42*Lt),reeds:Math.cos(12*Lt),posts:Math.cos(24*Lt)},_s=.15,Pi=26,dc=1.6,Ms=2,fc={trees:(a,e,t)=>a<=_s&&e>=t*.5+2.5,bushes:(a,e,t)=>a<=_s&&e>=t*.5+1.4,rocks:(a,e,t)=>a<=_s&&e>=t*.5+1.2,reeds:a=>a<=_s,posts:(a,e)=>a<=.05&&e<=Pi},pc={trees:(a,e)=>e===null||a>=e+.9,bushes:(a,e)=>e===null||a>=e+.5,rocks:(a,e)=>e===null||a>=e-.6,posts:(a,e)=>e===null||a>=e+.3,reeds:(a,e)=>e!==null&&e-a<=dc&&e-a>=-.35};function mc(a,e){let t=0;for(let s=0;s<he;s++)if(t+=a[s],e<t)return s;return he-1}function Vt(a,e,t,s,n,i,o,r,c){const l=Ls[a],h=Fi[a],u=Ii[a],d=rc[a],f=uc[a],p=fc[a],m=pc[a],g=Math.floor(s/l),v=Math.floor((s+i-1e-6)/l),w=Math.floor(n/l),b=Math.floor((n+i-1e-6)/l);for(let y=w;y<=b;y++)for(let x=g;x<=v;x++){const S=Wt(yi(x,y,d,t)),_=(x+S())*l,M=(y+S())*l;if(_<s||_>=s+i||M<n||M>=n+i)continue;const T=e.weights(_,M);o.set(T.w);const R=T.dominant,L=jr(o,ps,a);if(S()>=L*h*u/1e4)continue;const A=e.roads.carve(_,M);if(!p(A.edge,A.d,A.width))continue;const k=e.height(_,M),z=In(o,-1/0);if(!m(k,z))continue;const N=(k-e.height(_+Ms,M))/Ms,H=(k-e.height(_,M+Ms))/Ms,B=1/Math.hypot(N,1,H);B<f||(r.x=_,r.z=M,r.y=k,r.ny=B,r.dominant=R,r.wy=z,r.onRoad=A.edge,r.roadD=A.d,r.roadW=A.width,r.roadTx=A.tx,r.roadTz=A.tz,c(r,S))}}function Ni({cx:a,cz:e,level:t,seed:s}){const n={trees:[],rocks:[],bushes:[],reeds:[],posts:[]};if(!(t>=0)||t>fs)return n;const i=Ut(t),o=a*i,r=e*i,c=new Gt(s,o,r,o+i,r+i,Math.max(Pi+16,i*.25)),l=new Float32Array(he),h={x:0,z:0,y:0,ny:1,wy:null,dominant:0,onRoad:0,roadD:1/0,roadW:0,roadTx:1,roadTz:0};return Vt("trees",c,s,o,r,i,l,h,(u,d)=>{const f=ps[mc(l,d())].kinds;n.trees.push({x:u.x,y:u.y,z:u.z,yaw:d()*J,scale:.72+d()*.66,kind:f[d()*f.length|0],hue:d(),biome:u.dominant})}),Vt("bushes",c,s,o,r,i,l,h,(u,d)=>{n.bushes.push({x:u.x,y:u.y,z:u.z,yaw:d()*J,scale:.62+d()*.7,kind:"scrub",hue:d(),biome:u.dominant})}),Vt("rocks",c,s,o,r,i,l,h,(u,d)=>{const f=d();n.rocks.push({x:u.x,y:u.y,z:u.z,yaw:d()*J,scale:.34+Math.pow(d(),2.4)*3.1,kind:f<.58?"boulder":f<.86?"slab":"shard",tilt:(d()-.5)*(f<.58?.5:f<.86?.9:.3),hue:d(),biome:u.dominant})}),Vt("reeds",c,s,o,r,i,l,h,(u,d)=>{n.reeds.push({x:u.x,y:u.y,z:u.z,yaw:d()*J,scale:.6+d()*.7,kind:"reed",hue:d(),depth:u.wy-u.y,biome:u.dominant})}),Vt("posts",c,s,o,r,i,l,h,(u,d)=>{const f=u.roadD<u.roadW*.5+3.5;n.posts.push({x:u.x,y:u.y,z:u.z,yaw:f?Math.atan2(u.roadTx,u.roadTz)+Math.PI*.5:d()*J,scale:f?.85+d()*.3:.7+d()*.5,kind:f?d()<.12?"milestone":"marker":"fence",lean:(d()-.5)*.16,hue:d(),biome:u.dominant})}),n}function vc(a){if(!(a>=0)||a>fs)return 0;const e=Ut(a)*Ut(a);let t=0;for(const s of Di){let n=0;for(let i=0;i<he;i++)n=Math.max(n,ps[i][s]);t+=n}return Math.ceil(t*e/1e4)}Q.uMeanWind||(Q.uMeanWind={value:new le(3,1)});Q.uWindSpan||(Q.uWindSpan={value:0});const gc=9200,wc=()=>({pos:[],nrm:[],clm:[],flx:[],hue:[],idx:[],n:0});function Oi(a,e,t,s,n,i,o,r,c,l,h,u){return a.pos.push(e,t,s),a.nrm.push(n,i,o),a.clm.push(r,c,l),a.flx.push(h),a.hue.push(u),a.n++}function xc(a){const e=new ui;e.setAttribute("position",new U(new Float32Array(a.pos),3)),e.setAttribute("nrm",new U(new Float32Array(a.nrm),3)),e.setAttribute("clm",new U(new Float32Array(a.clm),3)),e.setAttribute("flx",new U(new Float32Array(a.flx),1)),e.setAttribute("hue",new U(new Float32Array(a.hue),1));const t=a.n>65535?Uint32Array:Uint16Array;return e.setIndex(new U(new t(a.idx),1)),e}function De(a,e,t,s,n){const i=[];for(let o=0;o<e.length;o++){const r=e[o];let c;o===0?c=[e[1][0]-r[0],e[1][1]-r[1],e[1][2]-r[2]]:o===e.length-1?c=[r[0]-e[o-1][0],r[1]-e[o-1][1],r[2]-e[o-1][2]]:c=[e[o+1][0]-e[o-1][0],e[o+1][1]-e[o-1][1],e[o+1][2]-e[o-1][2]];const l=Math.hypot(c[0],c[1],c[2])||1;c=[c[0]/l,c[1]/l,c[2]/l];let h=[0,1,0];Math.abs(c[1])>.94&&(h=[1,0,0]);let u=[c[1]*h[2]-c[2]*h[1],c[2]*h[0]-c[0]*h[2],c[0]*h[1]-c[1]*h[0]];const d=Math.hypot(u[0],u[1],u[2])||1;u=[u[0]/d,u[1]/d,u[2]/d];const f=[c[1]*u[2]-c[2]*u[1],c[2]*u[0]-c[0]*u[2],c[0]*u[1]-c[1]*u[0]],p=[],m=Math.pow(K(o/(e.length-1),0,1),1.6)*.55;for(let g=0;g<s;g++){const v=g/s*J,w=Math.cos(v),b=Math.sin(v),y=1+Math.sin(v*3+o)*.09+Math.cos(v*5-o*.7)*.05,x=t[o]*y,S=u[0]*w+f[0]*b,_=u[1]*w+f[1]*b,M=u[2]*w+f[2]*b;p.push(Oi(a,r[0]+S*x,r[1]+_*x,r[2]+M*x,S,_,M,r[0],r[1],r[2],m,n))}i.push(p)}for(let o=0;o<i.length-1;o++)for(let r=0;r<s;r++){const c=i[o][r],l=i[o][(r+1)%s],h=i[o+1][r],u=i[o+1][(r+1)%s];a.idx.push(c,h,l,l,h,u)}}const en=(()=>{const a=(1+Math.sqrt(5))/2,e=[[-1,a,0],[1,a,0],[-1,-a,0],[1,-a,0],[0,-1,a],[0,1,a],[0,-1,-a],[0,1,-a],[a,0,-1],[a,0,1],[-a,0,-1],[-a,0,1]].map(o=>{const r=Math.hypot(o[0],o[1],o[2]);return[o[0]/r,o[1]/r,o[2]/r]}),t=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]],s=(o,r)=>{const c=[],l={},h=(u,d)=>{const f=u<d?`${u}_${d}`:`${d}_${u}`;if(l[f]!==void 0)return l[f];const p=[(o[u][0]+o[d][0])/2,(o[u][1]+o[d][1])/2,(o[u][2]+o[d][2])/2],m=Math.hypot(p[0],p[1],p[2]);return o.push([p[0]/m,p[1]/m,p[2]/m]),l[f]=o.length-1,l[f]};for(const u of r){const d=h(u[0],u[1]),f=h(u[1],u[2]),p=h(u[2],u[0]);c.push([u[0],d,p],[u[1],f,d],[u[2],p,f],[d,f,p])}return c},n={v:e.map(o=>o.slice()),f:t.map(o=>o.slice())};n.f=s(n.v,n.f);const i={v:n.v.map(o=>o.slice()),f:n.f.map(o=>o.slice())};return i.f=s(i.v,i.f),{L0:{v:e,f:t},L1:n,L2:i}})();function We(a,e,t,s,n,i,o,r,c,l){const h=l>=2?en.L2:l>=1?en.L1:en.L0,u=a.n,d=Wt(r*7919|0),f=[d()*10,d()*10,d()*10];for(const p of h.v){const m=1+.2*Math.sin(p[0]*4.1+f[0])*Math.sin(p[1]*3.7+f[1])+.14*Math.sin(p[2]*6.3+f[2])*Math.cos(p[0]*5.1+f[1])+.09*Ve(p[0]*3.4+f[0],p[2]*3.4+f[2]);Oi(a,e+p[0]*n*m,t+p[1]*i*m,s+p[2]*o*m,p[0],p[1],p[2],e,t,s,1,c)}for(const p of h.f)a.idx.push(u+p[0],u+p[1],u+p[2])}const Ks={broadleaf:{h:11.5,flex:1},poplar:{h:15,flex:.8},pine:{h:14.5,flex:.52},deadpine:{h:13,flex:.26},acacia:{h:9.5,flex:.9},scrub:{h:2.5,flex:1.25},palm:{h:12.5,flex:1.6},willow:{h:9.5,flex:1.75}},bc=Object.keys(Ks);function yc(a,e,t){const s=wc(),n=Wt(t),i=a==="poplar"?13+n()*5:a==="pine"?12+n()*6:a==="deadpine"?11+n()*5:a==="acacia"?8+n()*3.5:a==="palm"?10+n()*5:a==="scrub"?1.9+n()*1.3:a==="willow"?8+n()*3:10+n()*4,o=e>=2?8:e>=1?6:4,r=Math.max(0,e-1);if(a==="pine"){const c=[],l=[];for(let u=0;u<=6;u++){const d=u/6;c.push([Math.sin(d*2.1)*.35*d*i*.06,d*i,Math.cos(d*1.7)*.3*d*i*.06]),l.push(F(i*.035,i*.006,d))}De(s,c,l,o,0);const h=e>=1?6:4;for(let u=0;u<h;u++){const d=.3+.68*(u/(h-1)),f=(1-d)*i*.3+i*.05;We(s,0,d*i+i*.04,0,f,f*.36,f,t+u*13,.15+n()*.7,r)}}else if(a==="poplar"){const c=[],l=[];for(let u=0;u<=7;u++){const d=u/7;c.push([Math.sin(d*3)*.5,d*i,Math.cos(d*2.2)*.45]),l.push(F(i*.028,i*.005,d))}De(s,c,l,o,0);const h=e>=1?9:5;for(let u=0;u<h;u++){const d=.2+.78*(u/(h-1)),f=i*(.17-.08*Math.abs(d-.55)*1.4);We(s,Math.sin(d*7)*.5,d*i,Math.cos(d*6)*.45,f*.9,f*1.35,f*.9,t+u*29,.2+n()*.7,r)}}else if(a==="willow"){const c=[],l=[];for(let u=0;u<=5;u++){const d=u/5;c.push([d*d*1.7,d*i*.72,Math.sin(d*2)*.6]),l.push(F(i*.05,i*.012,d))}De(s,c,l,o,0);const h=e>=1?12:6;for(let u=0;u<h;u++){const d=n()*J,f=Math.sqrt(n())*i*.42,p=Math.cos(d)*f+1.5,m=Math.sin(d)*f,g=i*.62+(n()-.3)*i*.22,v=i*(.13+n()*.09);We(s,p,g,m,v*1.15,v*.8,v*1.15,t+u*37,.5+n()*.5,r),e>=1&&We(s,p*1.05,g-v*1.5,m*1.05,v*.55,v*1.5,v*.55,t+u*41,.6+n()*.4,r)}}else if(a==="deadpine"){const c=[],l=[],h=(n()-.5)*.9;for(let d=0;d<=6;d++){const f=d/6;c.push([h*f*f*i*.1,f*i,Math.sin(f*2.7)*.4]),l.push(F(i*.032,i*.012,Math.pow(f,.75)))}De(s,c,l,o,0);const u=e>=2?7:e>=1?5:3;for(let d=0;d<u;d++){const f=.34+.58*(d/Math.max(1,u-1)),p=d*2.399+n()*.6,m=i*(.3-.16*f)*(.7+n()*.6),g=[],v=[];for(let w=0;w<=2;w++){const b=w/2;g.push([Math.cos(p)*m*b,f*i+b*m*.42-b*b*m*.5,Math.sin(p)*m*b]),v.push(F(i*.012,i*.003,b))}De(s,g,v,Math.max(3,o-3),0)}if(e>=1)for(let d=0;d<2;d++){const f=n()*J,p=i*(.09+n()*.05);We(s,Math.cos(f)*i*.1,i*(.68+d*.16),Math.sin(f)*i*.1,p,p*.22,p,t+d*61,n()*.25,r)}}else if(a==="acacia"){const c=[],l=[],h=(n()-.5)*.4;for(let p=0;p<=5;p++){const m=p/5;c.push([h*m*m*i*.2,m*i*.6,Math.cos(m*2.1)*.3]),l.push(F(i*.055,i*.02,m))}De(s,c,l,o,0);const u=e>=1?5:3,d=i*.52;for(let p=0;p<u;p++){const m=p/u*J+n()*.8,g=d*(.72+n()*.3),v=[],w=[];for(let b=0;b<=3;b++){const y=b/3;v.push([Math.cos(m)*g*y,i*.58+Math.pow(y,.55)*i*.3,Math.sin(m)*g*y]),w.push(F(i*.02,i*.005,y))}De(s,v,w,Math.max(3,o-2),0)}const f=e>=2?16:e>=1?10:5;for(let p=0;p<f;p++){const m=n()*J,g=Math.pow(n(),.42)*d,v=d*(.2+n()*.16)*(1-g/d*.35);We(s,Math.cos(m)*g,i*.9-g*.1+(n()-.5)*i*.05,Math.sin(m)*g,v*1.25,v*.34,v*1.25,t+p*71,n(),r)}}else if(a==="scrub"){const c=e>=1?3:2;for(let h=0;h<c;h++){const u=h/c*J+n()*1.1,d=[],f=[];for(let p=0;p<=3;p++){const m=p/3;d.push([Math.cos(u)*m*i*.22,m*i*.55,Math.sin(u)*m*i*.22]),f.push(F(i*.05,i*.018,m))}De(s,d,f,Math.max(3,o-2),0)}const l=e>=2?9:e>=1?6:3;for(let h=0;h<l;h++){const u=n()*J,d=Math.pow(n(),.6)*i*.42,f=i*(.24+n()*.16);We(s,Math.cos(u)*d,i*.52+(n()-.35)*i*.24,Math.sin(u)*d,f*1.1,f*.78,f*1.1,t+h*83,n(),r)}}else if(a==="palm"){const c=[],l=[],h=.9+n()*1.4,u=n()*J;for(let g=0;g<=7;g++){const v=g/7,w=h*v*v;c.push([Math.cos(u)*w,v*i,Math.sin(u)*w]),l.push(F(i*.026,i*.016,v))}De(s,c,l,o,0);const d=Math.cos(u)*h,f=Math.sin(u)*h,p=e>=2?9:e>=1?7:5,m=i*.44;for(let g=0;g<p;g++){const v=g/p*J+n()*.35,w=.8+n()*.6;for(let b=1;b<=3;b++){const y=b/3,x=m*y,S=m*(.19-.075*y);We(s,d+Math.cos(v)*x,i+m*(.26*y-.62*y*y*w),f+Math.sin(v)*x,S*1.15,S*.3,S*1.15,t+g*97+b*7,.25+n()*.6,r)}}We(s,d,i+m*.06,f,m*.22,m*.2,m*.22,t+991,.3+n()*.3,r)}else{const c=[],l=[],h=(n()-.5)*.5;for(let p=0;p<=6;p++){const m=p/6;c.push([h*m*m*i*.14+Math.sin(m*3.4)*.35,m*i*.52,Math.cos(m*2.6)*.35]),l.push(F(i*.062,i*.026,m))}De(s,c,l,o,0);const u=e>=2?5:e>=1?4:0;for(let p=0;p<u;p++){const m=p/u*J+n()*.9,g=i*(.26+n()*.16),v=[],w=[];for(let b=0;b<=3;b++){const y=b/3;v.push([Math.cos(m)*g*y*.9,i*.5+y*g*.72-y*y*g*.12,Math.sin(m)*g*y*.9]),w.push(F(i*.02,i*.006,y))}De(s,v,w,Math.max(3,o-2),0)}const d=e>=2?22:e>=1?12:7,f=i*.4;for(let p=0;p<d;p++){let m,g,v,w;if(p===0)m=0,g=i*.78,v=0,w=f*.72;else{const b=n()*J,y=Math.pow(n(),.55)*f*1.02;m=Math.cos(b)*y,v=Math.sin(b)*y*.92,g=i*.74+(n()-.44)*f*.95-y*.2,w=f*(.26+n()*.26)}We(s,m,g,v,w*1.12,w*.86,w*1.12,t+p*53,n(),r)}}return s}const Bi=`
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
`;function Gi(){const a=xi(),e=[];for(let t=0;t<a.count;t++)e.push(`vec3(${a.foliage[t*3].toFixed(4)},${a.foliage[t*3+1].toFixed(4)},${a.foliage[t*3+2].toFixed(4)})`);return`
const int NFOL = ${a.count};
const vec3 B_FOLIAGE[${a.count}] = vec3[${a.count}](${e.join(",")});
`}const Ui=`
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
}`,_c=`
in vec3 vW; in vec3 vN; in float vHue; in float vLeaf; in float vDist;
in float vY; in float vAO; in vec3 vTint;
out vec4 outColor;
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  vec3 lit, mid, shd; float trans, rim;

  if(vLeaf > 0.5){
    // four-green canopy mosaic
    vec3 base = vHue<0.26 ? ${E.cVarA} : (vHue<0.52 ? ${E.cLit} :
                (vHue<0.76 ? ${E.cVarB} : ${E.cVarC}));
    float grain = pn2(vW.xz*0.85 + vW.y*0.6)*0.5+0.5;
    lit = mix(base, ${E.cLit}, 0.42) * (1.02 + 0.24*grain);
    mid = mix(${E.cMid}, base*0.72, 0.45);
    shd = mix(${E.cShade}, ${E.cDeep}, grain*0.45);
    // Biome foliage tint: the same table the ground blends, so a highland pine and the
    // hillside it stands on go cold together.
    lit *= vTint; mid *= vTint; shd *= vTint;
    trans = 1.05; rim = 0.52;
  } else {
    float bark = pn2(vec2(atan(N.z,N.x)*3.4, vW.y*3.1))*0.5+0.5;
    vec3 wood = mix(vec3(1.0), vTint, 0.55);
    lit = ${E.trunkLit} * (0.82 + 0.34*bark) * wood;
    mid = mix(${E.trunkLit}, ${E.trunkShade}, 0.55) * wood;
    shd = ${E.trunkShade} * (0.85 + 0.3*bark) * wood;
    trans = 0.0; rim = 0.28;
  }
  // moss on the shaded north side of trunks and the underside of clumps
  float moss = smoothstep(0.15, -0.5, N.y) * (pn2(vW.xz*1.6 + vW.y)*0.5+0.5);
  shd = mix(shd, ${E.moss}*0.55, moss*0.35*(1.0-vLeaf));

  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vW, ndl) * cloudShadow(vW);
  Surf s;
  s.N=N; s.V=V; s.P=vW; s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = mix(0.09, 0.20, clamp(vDist*0.004,0.0,1.0));
  s.jit = (vn2(vW.xz*3.9 + vW.y*1.7) - 0.5)*0.055;
  s.shadow = sh; s.trans = trans; s.transCol = ${E.cTrans};
  s.rim = rim; s.ao = vAO; s.ambient = 1.0;
  vec3 col = paint(s);
  col = aerial(col, vDist, V, vW.y);
  outColor = vec4(SAFE3(col), gFogAmt);
}`;function Mc(a){const e=Ks[a];return new ge({glslVersion:"300 es",uniforms:Re({uTreeH:{value:e.h},uFlex:{value:e.flex},uCullR:{value:0}}),vertexShader:Me(pe,me,Bi,Gi(),Ui),fragmentShader:Oe(pe,me,At({cshSpan:gc}),Ht,kt,_c),side:st})}function Tc(a,e){const t=Ks[a];return new ge({glslVersion:"300 es",uniforms:Re({uTreeH:{value:t.h},uFlex:{value:t.flex},uCullR:{value:e}}),vertexShader:Me(pe,me,Bi,Gi(),Ui),fragmentShader:Fn,side:st})}const Sc=1400,Ac=.92,kc=420,wo=2.6,xo=512;class Rc{constructor({seed:e,scene:t,quality:s=1,cullDistance:n=Sc,bushes:i=!0}){this.seed=e>>>0,this.scene=t,this.quality=K(s,.4,2),this.cull=n*K(this.quality,.7,1.35),this.renderBushes=i,this.group=new vt,this.group.name="flora",this.group.matrixAutoUpdate=!1,this.batches=new Map,this.chunks=new Map,this.pending=[],this.stats={chunks:0,instances:0,batches:0,attached:0,buildMs:0,backlog:0},this._cam=new X,this._hasCam=!1,t.add(this.group)}_detailFor(e){return K(2-e-(this.quality<.75?1:0),0,2)}add(e){if(e.level>fs)return;const t=`${e.level}:${e.cx},${e.cz}`;if(this.chunks.has(t))return;const s={key:t,level:e.level,cx:e.cx,cz:e.cz,mx:e.ox+e.size*.5,mz:e.oz+e.size*.5,groups:null,blocks:null,dead:!1};this.chunks.set(t,s),this.pending.push(s),this.stats.chunks=this.chunks.size}remove(e){const t=`${e.level}:${e.cx},${e.cz}`,s=this.chunks.get(t);s&&(s.dead=!0,s.blocks&&this._detach(s),this.chunks.delete(t),this.stats.chunks=this.chunks.size)}update(e,t){t&&(this._cam.copy(t),this._hasCam=!0),this._drain(e),this._cullPass(),this._flush()}_drain(e){const t=performance.now(),s=e>1/45?wo*.45:wo;let n=0;for(;this.pending.length;){const i=this.pending[0];if(i.dead){this.pending.shift();continue}if(n>0&&performance.now()-t>s)break;this.pending.shift(),this._scatter(i),n++}this.stats.buildMs=performance.now()-t,this.stats.backlog=this.pending.length}_scatter(e){const t=Ni({cx:e.cx,cz:e.cz,level:e.level,seed:this.seed}),s=this._detailFor(e.level),n=new Map,i=(o,r,c)=>{for(let l=0;l<o.length;l++){const h=o[l],u=Ks[h.kind];if(!u){console.error("[flora] no archetype for species",h.kind,"— check BIOME_SCATTER kinds");continue}const d=`${h.kind}:${r}`;let f=n.get(d);f||(f={kind:h.kind,detail:r,pos:[],vari:[],minX:1e9,maxX:-1e9,minZ:1e9,maxZ:-1e9,minY:1e9,maxY:-1e9},n.set(d,f));const p=_e(Math.round(h.x*4),Math.round(h.z*4),this.seed)/4294967296*10,m=h.y-c*h.scale;f.pos.push(h.x,m,h.z,h.scale),f.vari.push(h.yaw,h.hue,p,h.biome);const g=u.h*h.scale*1.25,v=g*.45;h.x-v<f.minX&&(f.minX=h.x-v),h.x+v>f.maxX&&(f.maxX=h.x+v),h.z-v<f.minZ&&(f.minZ=h.z-v),h.z+v>f.maxZ&&(f.maxZ=h.z+v),m<f.minY&&(f.minY=m),m+g>f.maxY&&(f.maxY=m+g)}};i(t.trees,s,.35),this.renderBushes&&e.level<=1&&i(t.bushes,Math.min(s,e.level===0?1:0),.18),e.groups=n,(!this._hasCam||this._distance(e)<=this.cull)&&this._attach(e)}_distance(e){return Math.hypot(e.mx-this._cam.x,e.mz-this._cam.z)}_batch(e,t){const s=`${e}:${t}`;let n=this.batches.get(s);if(n)return n;const i=_e(bc.indexOf(e)+1,t+1,1592598191),o=xc(yc(e,t,i)),r=Math.max(64,vc(Math.min(fs,2-t))),c=new Float32Array(r*4),l=new Float32Array(r*4),h=new ft(c,4),u=new ft(l,4);h.setUsage(ws),u.setUsage(ws),o.setAttribute("iPos",h),o.setAttribute("iVar",u),o.instanceCount=0,o.boundingSphere=new ot(new X,0);const d=new Te(o,Mc(e));return d.frustumCulled=!0,d.matrixAutoUpdate=!1,d.updateMatrix(),d.renderOrder=2,d.visible=!1,d.userData.depth=Tc(e,kc),this.group.add(d),n={key:s,kind:e,detail:t,geom:o,mesh:d,iPos:c,iVar:l,aPos:h,aVar:u,cap:r,count:0,blocks:[],dirty:!1},this.batches.set(s,n),this.stats.batches=this.batches.size,n}_reserve(e,t){if(t<=e.cap)return;let s=e.cap;for(;s<t;)s*=2;const n=new Float32Array(s*4),i=new Float32Array(s*4);n.set(e.iPos.subarray(0,e.count*4)),i.set(e.iVar.subarray(0,e.count*4)),e.aPos=new ft(n,4),e.aVar=new ft(i,4),e.aPos.setUsage(ws),e.aVar.setUsage(ws),e.geom.setAttribute("iPos",e.aPos),e.geom.setAttribute("iVar",e.aVar),e.iPos=n,e.iVar=i,e.cap=s}_attach(e){if(e.blocks||!e.groups)return;const t=[];for(const s of e.groups.values()){const n=s.pos.length/4;if(!n)continue;const i=this._batch(s.kind,s.detail);this._reserve(i,i.count+n),i.iPos.set(s.pos,i.count*4),i.iVar.set(s.vari,i.count*4);const o={batch:i,start:i.count,len:n,g:s};i.blocks.push(o),i.count+=n,i.dirty=!0,t.push(o)}e.blocks=t}_detach(e){if(e.blocks){for(const t of e.blocks){const s=t.batch,n=s.blocks.indexOf(t);if(n<0)continue;if(s.count-(t.start+t.len)>0){s.iPos.copyWithin(t.start*4,(t.start+t.len)*4,s.count*4),s.iVar.copyWithin(t.start*4,(t.start+t.len)*4,s.count*4);for(let o=n+1;o<s.blocks.length;o++)s.blocks[o].start-=t.len}s.blocks.splice(n,1),s.count-=t.len,s.dirty=!0}e.blocks=null}}_cullPass(){if(!this._hasCam)return;const e=this.cull,t=this.cull*Ac;let s=0;for(const n of this.chunks.values()){if(!n.groups)continue;const i=this._distance(n);n.blocks?i>e?this._detach(n):s++:i<=t&&(this._attach(n),s++)}this.stats.attached=s,this.chunks.size>xo&&this._evict()}_evict(){const e=[];for(const s of this.chunks.values())!s.blocks&&s.groups&&e.push(s);e.sort((s,n)=>this._distance(n)-this._distance(s));const t=Math.min(e.length,this.chunks.size-xo);for(let s=0;s<t;s++)this.chunks.delete(e[s].key);this.stats.chunks=this.chunks.size}_flush(){let e=0;for(const t of this.batches.values()){if(e+=t.count,!t.dirty||(t.dirty=!1,t.geom.instanceCount=t.count,t.mesh.visible=t.count>0,t.aPos.needsUpdate=!0,t.aVar.needsUpdate=!0,!t.count))continue;let s=1e9,n=-1e9,i=1e9,o=-1e9,r=1e9,c=-1e9;for(const h of t.blocks){const u=h.g;u.minX<s&&(s=u.minX),u.maxX>n&&(n=u.maxX),u.minZ<i&&(i=u.minZ),u.maxZ>o&&(o=u.maxZ),u.minY<r&&(r=u.minY),u.maxY>c&&(c=u.maxY)}const l=t.geom.boundingSphere;l.center.set((s+n)*.5,(r+c)*.5,(i+o)*.5),l.radius=Math.hypot(n-s,c-r,o-i)*.5}this.stats.instances=e}dispose(){for(const e of this.batches.values())this.group.remove(e.mesh),e.geom.dispose(),e.mesh.material.dispose(),e.mesh.userData.depth.dispose();this.batches.clear(),this.chunks.clear(),this.pending.length=0,this.group.parent&&this.group.parent.remove(this.group)}}const P={MATTE:0,METAL:1,EMIT:2,GLASS:3,LAMP_A:4,LAMP_B:5,LAMP_C:6},Z=a=>Ps[a],Mt=(a,e)=>[a[0]*e,a[1]*e,a[2]*e],Bs=(a,e,t)=>[F(a[0],e[0],t),F(a[1],e[1],t),F(a[2],e[2],t)];function Gs(){return{pos:[],nrm:[],col:[],mat:[],idx:[],n:0}}function Ae(a,e,t,s,n,i,o,r,c){return a.pos.push(e,t,s),a.nrm.push(n,i,o),a.col.push(r[0],r[1],r[2]),a.mat.push(c||0),a.n++}function Pn(a,e,t,s,n){a.idx.push(e,t,s,e,s,n)}function bo(a,e,t,s){a.idx.push(e,t,s)}function yo(a,e,t,s){return[a*t-e*s,a*s+e*t]}function oe(a,e,t,s,n,i,o,r,c,l){const h=Math.cos(r),u=Math.sin(r),d=(m,g,v)=>{const[w,b]=yo(m*n,v*o,h,u);return[e+w,t+g*i,s+b]},f=(m,g)=>{const[v,w]=yo(m,g,h,u);return[v,0,w]},p=[{q:[[1,-1,-1],[1,-1,1],[1,1,1],[1,1,-1]],n:f(1,0)},{q:[[-1,-1,1],[-1,-1,-1],[-1,1,-1],[-1,1,1]],n:f(-1,0)},{q:[[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]],n:[0,1,0]},{q:[[-1,-1,1],[1,-1,1],[1,-1,-1],[-1,-1,-1]],n:[0,-1,0]},{q:[[-1,-1,1],[-1,1,1],[1,1,1],[1,-1,1]],n:f(0,1)},{q:[[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,-1]],n:f(0,-1)}];for(const m of p){const g=m.q.map(v=>{const w=d(v[0],v[1],v[2]);return Ae(a,w[0],w[1],w[2],m.n[0],m.n[1],m.n[2],c,l)});Pn(a,g[0],g[1],g[2],g[3])}}function Pe(a,e,t,s,n,i,o,r,c,l){let h=[t[0]-e[0],t[1]-e[1],t[2]-e[2]];const u=Math.hypot(h[0],h[1],h[2])||1;h=[h[0]/u,h[1]/u,h[2]/u];let d=[0,1,0];Math.abs(h[1])>.94&&(d=[1,0,0]);let f=[h[1]*d[2]-h[2]*d[1],h[2]*d[0]-h[0]*d[2],h[0]*d[1]-h[1]*d[0]];const p=Math.hypot(f[0],f[1],f[2])||1;f=[f[0]/p,f[1]/p,f[2]/p];const m=[h[1]*f[2]-h[2]*f[1],h[2]*f[0]-h[0]*f[2],h[0]*f[1]-h[1]*f[0]],g=[],v=[];for(let w=0;w<i;w++){const b=w/i*J,y=Math.cos(b),x=Math.sin(b),S=f[0]*y+m[0]*x,_=f[1]*y+m[1]*x,M=f[2]*y+m[2]*x;g.push(Ae(a,e[0]+S*s,e[1]+_*s,e[2]+M*s,S,_,M,o,r)),v.push(Ae(a,t[0]+S*n,t[1]+_*n,t[2]+M*n,S,_,M,o,r))}for(let w=0;w<i;w++){const b=(w+1)%i;Pn(a,g[w],v[w],v[b],g[b])}if(l){const w=Ae(a,t[0],t[1],t[2],h[0],h[1],h[2],o,r);for(let b=0;b<i;b++){const y=(b+1)%i,x=Ae(a,a.pos[v[b]*3],a.pos[v[b]*3+1],a.pos[v[b]*3+2],h[0],h[1],h[2],o,r),S=Ae(a,a.pos[v[y]*3],a.pos[v[y]*3+1],a.pos[v[y]*3+2],h[0],h[1],h[2],o,r);bo(a,w,x,S)}}if(c){const w=Ae(a,e[0],e[1],e[2],-h[0],-h[1],-h[2],o,r);for(let b=0;b<i;b++){const y=(b+1)%i,x=Ae(a,a.pos[g[b]*3],a.pos[g[b]*3+1],a.pos[g[b]*3+2],-h[0],-h[1],-h[2],o,r),S=Ae(a,a.pos[g[y]*3],a.pos[g[y]*3+1],a.pos[g[y]*3+2],-h[0],-h[1],-h[2],o,r);bo(a,w,S,x)}}}function Ec(a,e,t){const s=e[0]-a[0],n=e[1]-a[1],i=e[2]-a[2],o=t[0]-a[0],r=t[1]-a[1],c=t[2]-a[2],l=n*c-i*r,h=i*o-s*c,u=s*r-n*o,d=Math.hypot(l,h,u);return d>1e-9?[l/d,h/d,u/d]:[0,1,0]}function bt(a,e,t,s,n,i,o,r){let c=t,l=n,h=Ec(e,t,n);r&&h[0]*r[0]+h[1]*r[1]+h[2]*r[2]<0&&(c=n,l=t,h=[-h[0],-h[1],-h[2]]);const u=Ae(a,e[0],e[1],e[2],h[0],h[1],h[2],i,o),d=Ae(a,c[0],c[1],c[2],h[0],h[1],h[2],i,o),f=Ae(a,s[0],s[1],s[2],h[0],h[1],h[2],i,o),p=Ae(a,l[0],l[1],l[2],h[0],h[1],h[2],i,o);Pn(a,u,d,f,p)}function Us(a){const e=new nt;return e.setAttribute("position",new U(new Float32Array(a.pos),3)),e.setAttribute("nrm",new U(new Float32Array(a.nrm),3)),e.setAttribute("vcol",new U(new Float32Array(a.col),3)),e.setAttribute("vmat",new U(new Float32Array(a.mat),1)),e.setIndex(a.idx),e.computeBoundingSphere(),e}const Hi=`
in vec3 nrm; in vec3 vcol; in float vmat;
out vec3 vW; out vec3 vN; out vec3 vC; out vec3 vL; out float vM; out float vDist;
void main(){
  vec4 wp = modelMatrix*vec4(position,1.0);
  vW = wp.xyz; vN = normalize(mat3(modelMatrix)*nrm); vC = vcol; vM = vmat;
  vL = position;
  vec4 mv = viewMatrix*wp; vDist = -mv.z;
  gl_Position = projectionMatrix*mv;
}`;function Cc(a){const e=a?"uGhostAlpha":"gFogAmt";return`
uniform vec3 uLamp;   // x,y,z = the three switchable emissive channels, 0..1
${a?"uniform float uGhostAlpha;":""}
in vec3 vW; in vec3 vN; in vec3 vC; in vec3 vL; in float vM; in float vDist;
out vec4 outColor;
void main(){
  vec3 N=normalize(vN), V=normalize(uCamPos-vW);
  vec3 base = vC;
  // Grain in OBJECT space, not the pen's world space. The pen's painted objects were
  // bolted to the valley floor, so the two were the same thing; a car doing 90 m/s
  // through a world-space noise field crawls with paint-coloured static.
  float g  = pn2(vL.xz*4.3 + vL.y*3.7)*0.5+0.5;
  float g2 = pn2(vL.xz*17.0 - vL.y*9.0)*0.5+0.5;
  base *= 0.90 + 0.20*g + 0.06*g2;

  // lit / mid / shade travel along a hue path, never a brightness ramp
  vec3 lit = base*1.12;
  vec3 mid = mix(base*0.76, K_AMB_SKY*0.22, 0.16);
  vec3 shd = mix(base*0.40, K_SHADOW*0.60, 0.44);
  float rim = 0.30, ao = 1.0;

  if(vM > 3.5){                             // switchable lamp, channels A/B/C
    float ch = vM < 4.5 ? uLamp.x : (vM < 5.5 ? uLamp.y : uLamp.z);
    vec3 dead = mix(base*0.50, K_SKY_MID*0.30, 0.35);
    vec3 hot  = base*2.6 + K_SUN*0.22;
    vec3 c = mix(dead, hot, ch);
    // An unlit lens is an object and hazes with everything else; a lamp that is ON is a
    // light source and must stay legible through the haze, so the fog is faded out with
    // the channel rather than applied flat.
    c = mix(aerial(c, vDist, V, vW.y), c, ch);
    outColor = vec4(SAFE3(c), ${e});
    return;
  }
  if(vM > 1.5 && vM < 2.5){                 // lit window
    float flick = 0.94 + 0.06*sin(uTime*2.1 + vW.x*3.1 + vW.z*1.7);
    outColor = vec4(SAFE3(base*2.4*flick + K_SUN*0.25), ${a?"uGhostAlpha":"0.0"});
    return;
  }
  if(vM > 0.5 && vM < 1.5){                 // painted metal: crisper bands
    lit = base*1.25; mid = base*0.62;
    shd = mix(base*0.30, K_SHADOW*0.7, 0.5);
    rim = 0.62;
  }
  if(vM > 2.5){                             // glass / dark opening
    lit = mix(base, K_SKY_MID, 0.55); mid = base*0.7; shd = base*0.42; rim = 0.75;
  }

  float ndl = dot(N,uSunDir);
  float sh = sunShadow(vW,ndl)*cloudShadow(vW);
  Surf s; s.N=N; s.V=V; s.P=vW; s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = mix(0.075, 0.19, clamp(vDist*0.004,0.0,1.0));
  s.jit = (vn2(vL.xz*3.9 + vL.y*1.7) - 0.5)*0.055;
  s.shadow=sh; s.trans=0.0; s.transCol=vec3(0.0);
  s.rim=${a?"rim*2.1":"rim"}; s.ao=ao; s.ambient=1.0;
  vec3 col=paint(s);
  ${a?`
  // A ghost is a rumour of a car: keep the silhouette and the sun-side rim, let the
  // middle of every panel drift towards the sky it is standing in front of.
  float fres = pow(1.0 - clamp(dot(N,V),0.0,1.0), 2.6);
  col = mix(col*0.72 + K_SKY_MID*0.16, col + K_SUN*0.35, fres);
  `:""}
  col = aerial(col,vDist,V,vW.y);
  outColor = vec4(SAFE3(col), ${e});
}`}const zc=At({cshSpan:9200,cloudDeck:980});function Nn({side:a=st,ghost:e=!1,opacity:t=.85,uniforms:s={}}={}){const n={uLamp:{value:new X(0,0,0)}};e&&(n.uGhostAlpha={value:t});const i=new ge({glslVersion:"300 es",uniforms:Re(Object.assign(n,s)),vertexShader:Me(Hi),fragmentShader:Oe(pe,me,zc,Ht,kt,Cc(e)),side:a});return e&&(i.transparent=!0,i.depthWrite=!0,i.blending=hi,i.blendSrc=li,i.blendDst=ci,i.blendEquation=Is,i.blendSrcAlpha=ri,i.blendDstAlpha=ai,i.blendEquationAlpha=Is),i}function Lc(){return new ge({glslVersion:"300 es",uniforms:Re(),vertexShader:Me(Hi),fragmentShader:Fn,side:st,colorWrite:!1})}const Dc=1900,Fc=.07,rt=6,Ic=28,Pc=`
in vec3 normal;
in vec2 aCross;   // x = -1..1 across the carriageway, y = metres travelled along it
out vec3 vWorld;
out vec3 vNormal;
out vec2 vCross;
out float vDist;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vCross = aCross;
  vDist = length(wp.xyz - uCamPos);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`,Nc=`
in vec3 vWorld;
in vec3 vNormal;
in vec2 vCross;
in float vDist;
out vec4 fragColor;

uniform float uLineMix;   // 0 = unmarked track, 1 = fully marked road
uniform vec3  uSurfLit;
uniform vec3  uSurfShade;

void main(){
  float across = vCross.x;          // -1 .. 1
  float along  = vCross.y;          // metres
  float a = abs(across);

  // Surface: two large wear streaks where the wheels run, plus a fine chip grain. The
  // streaks are what make a road read as USED, and used is what makes it read as a road.
  float wear  = smoothstep(0.62, 0.30, abs(a - 0.46));
  float chip  = vn2(vWorld.xz * 3.4) * 0.5 + vn2(vWorld.xz * 11.0) * 0.5;
  vec3 lit   = uSurfLit   * mix(1.0, 1.09, wear) * mix(0.95, 1.05, chip);
  vec3 shade = uSurfShade * mix(1.0, 0.93, wear);
  vec3 mid   = mix(lit, shade, 0.5);

  // ── markings ────────────────────────────────────────────────────────────
  // Generated from the ribbon's own coordinates, never from a texture: a texture would need
  // a UV atlas, a mip chain and an alignment pass, and would still shimmer at 250 km/h.
  float px = fwidth(across) * 1.6 + 1e-5;

  // continuous edge lines just inside the shoulder
  float edge = smoothstep(0.90 + px, 0.90 - px, a) * smoothstep(0.80 - px, 0.80 + px, a);
  // dashed centre line: 3 m of paint, 6 m of gap, which is close enough to real road
  // marking that it reads correctly at a glance
  float dash = step(fract(along / 9.0), 0.34);
  float centre = smoothstep(0.055 + px, 0.055 - px, a) * dash;

  // 'mark', not 'paint': paint() is the shared lighting function and a float of the same
  // name shadows it, which fails to compile with a message that points somewhere else.
  float mark = clamp(edge + centre, 0.0, 1.0) * uLineMix;
  vec3 markCol = mix(K_LINE_W, K_LINE_W * 0.86, wear * 0.7);
  lit   = mix(lit,   markCol,        mark);
  mid   = mix(mid,   markCol * 0.9,  mark);
  shade = mix(shade, markCol * 0.62, mark);

  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vWorld, ndl) * cloudShadow(vWorld);

  Surf s;
  s.N = N; s.V = V; s.P = vWorld;
  s.shade = shade; s.mid = mid; s.lit = lit;
  s.soft = 0.20; s.jit = (vn2(vWorld.xz * 0.7) - 0.5) * 0.05;
  s.shadow = sh; s.trans = 0.0; s.transCol = vec3(0.0);
  s.rim = 0.08; s.ao = 1.0; s.ambient = 1.0;

  vec3 col = paint(s);
  col = aerial(col, vDist, V, vWorld.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;function Oc(){return new ge({glslVersion:"300 es",uniforms:Re({uLineMix:{value:1},uSurfLit:{value:new X(...Ps.tarmacLit)},uSurfShade:{value:new X(...Ps.tarmacShade)}}),vertexShader:Me(Pc),fragmentShader:Oe(pe,me,Ws,At({cshSpan:9200,cloudDeck:980}),Ht,kt,Nc),side:En})}function Bc(a){const e=a.pts.length/2,t=[];for(let p=0;p<e-1;p++){const m=a.pts[p*2],g=a.pts[p*2+1],v=a.pts[p*2+2],w=a.pts[p*2+3],b=Math.hypot(v-m,w-g),y=Math.max(1,Math.round(b/6));for(let x=0;x<y;x++){const S=x/y;t.push({x:F(m,v,S),z:F(g,w,S),y:F(a.y[p],a.y[p+1],S)})}}const s=e-1;t.push({x:a.pts[s*2],z:a.pts[s*2+1],y:a.y[s]});const n=t.length,i=n*rt,o=new Float32Array(i*3),r=new Float32Array(i*3),c=new Float32Array(i*2),l=new Uint32Array((n-1)*(rt-1)*6),h=a.width*.5;let u=0;for(let p=0;p<n;p++){const m=t[p],g=t[Math.min(p+1,n-1)],v=t[Math.max(p-1,0)];let w=g.x-v.x,b=g.z-v.z;const y=Math.hypot(w,b)||1;w/=y,b/=y;const x=b,S=-w;p>0&&(u+=Math.hypot(m.x-t[p-1].x,m.z-t[p-1].z));for(let _=0;_<rt;_++){const M=_/(rt-1)*2-1,T=m.x+x*M*h,R=m.z+S*M*h,L=-Math.abs(M)*Math.abs(M)*.18,A=p*rt+_;o[A*3]=T,o[A*3+1]=m.y+L+Fc,o[A*3+2]=R,r[A*3]=0,r[A*3+1]=1,r[A*3+2]=0,c[A*2]=M,c[A*2+1]=u}}let d=0;for(let p=0;p<n-1;p++)for(let m=0;m<rt-1;m++){const g=p*rt+m,v=g+1,w=g+rt,b=w+1;l[d++]=g,l[d++]=w,l[d++]=v,l[d++]=v,l[d++]=w,l[d++]=b}const f=new nt;return f.setAttribute("position",new U(o,3)),f.setAttribute("normal",new U(r,3)),f.setAttribute("aCross",new U(c,2)),f.setIndex(new U(l,1)),f.computeBoundingSphere(),{geometry:f,ring:t,half:h}}function Gc(a,e,t,s){const n=[];let i=0;for(let o=1;o<e.length;o++){const r=e[o],c=e[o-1];i+=Math.hypot(r.x-c.x,r.z-c.z);let l=r.x-c.x,h=r.z-c.z;const u=Math.hypot(l,h)||1;l/=u,h/=u;const d=h,f=-l;let p=0;const m=Math.min(o+3,e.length-1);if(m>o){let g=e[m].x-r.x,v=e[m].z-r.z;const w=Math.hypot(g,v)||1;g/=w,v/=w,p=l*v-h*g}if(i>=Ic){i=0;const g=(o&1)===0?1:-1;n.push({kind:"post",x:r.x+d*g*(t+1.5),z:r.z+f*g*(t+1.5),y:r.y,yaw:Math.atan2(l,h)})}if(Math.abs(p)>.22&&o%4===0){const g=p>0?-1:1;n.push({kind:"chevron",x:r.x+d*g*(t+2.4),z:r.z+f*g*(t+2.4),y:r.y,yaw:Math.atan2(-d*g,-f*g),flip:p>0?1:-1})}}return n}function Uc(){const a=Gs();Pe(a,[0,0,0],[0,1.05,0],.075,.065,6,[.94,.9,.82],P.MATTE,!0,!0),oe(a,0,.92,.042,.055,.11,.01,0,[.92,.32,.22],P.MATTE);const e=Gs();return Pe(e,[0,0,0],[0,1.35,0],.055,.05,6,[.42,.38,.33],P.MATTE,!0,!0),oe(e,0,1.45,0,.6,.34,.035,0,[.95,.93,.86],P.MATTE),oe(e,-.13,1.45,.04,.16,.24,.01,.5,[.18,.2,.24],P.MATTE),oe(e,.17,1.45,.04,.16,.24,.01,.5,[.18,.2,.24],P.MATTE),{post:Us(a),chevron:Us(e)}}class Hc{constructor({seed:e,scene:t,range:s=Dc}){this.seed=e>>>0,this.range=s,this.group=new vt,this.group.name="roads",t.add(this.group),this.material=Oc(),this.paintedMaterial=Nn(),this.furniture=Uc(),this.live=new Map,this._lastX=1/0,this._lastZ=1/0,this._height=zi(this.seed),this._water=Li(this.seed),this.stats={edges:0,tris:0}}update(e,t){if(Math.hypot(e-this._lastX,t-this._lastZ)<180)return;this._lastX=e,this._lastZ=t;const s=this.range,n=Ri(e-s,t-s,e+s,t+s,this.seed,40),i=new Set;for(const o of n){if(i.add(o.key),this.live.has(o.key))continue;Ei(o,this._height,this._water);const{geometry:r,ring:c,half:l}=Bc(o),h=new Te(r,this.material);h.frustumCulled=!0,h.matrixAutoUpdate=!1,h.renderOrder=1,this.group.add(h);const u=Gc(o,c,l,this.seed),d=u.filter(m=>m.kind==="post"),f=u.filter(m=>m.kind==="chevron"),p={mesh:h,instanced:[]};for(const[m,g]of[[this.furniture.post,d],[this.furniture.chevron,f]]){if(!g.length)continue;const v=new di(m,this.paintedMaterial,g.length),w=new Nt,b=new Ln,y=new X,x=new X(1,1,1);g.forEach((S,_)=>{y.set(S.x,S.y,S.z),b.setFromAxisAngle(new X(0,1,0),S.yaw),w.compose(y,b,x),v.setMatrixAt(_,w)}),v.instanceMatrix.needsUpdate=!0,v.frustumCulled=!1,this.group.add(v),p.instanced.push(v)}this.live.set(o.key,p)}for(const[o,r]of this.live)if(!i.has(o)){this.group.remove(r.mesh),r.mesh.geometry.dispose();for(const c of r.instanced)this.group.remove(c),c.dispose();this.live.delete(o)}this.stats.edges=this.live.size}dispose(){for(const[e,t]of this.live){t.mesh.geometry.dispose();for(const s of t.instanced)s.dispose();this.live.delete(e)}this.material.dispose()}}const Wi=900,_o=2.6,ve=32,Yt=1200,Wc=24,Tn={uMeanWind:{value:new le(3,1)}};function Kc(){return Tn}const Mo=`
uniform vec2 uMeanWind;   // supplied by windUniforms(), not by the shared U block
const float WIND_SPAN = ${Wi.toFixed(1)};
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
`,qc=`precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,$c=`${bi}${Dn}
uniform vec2  uMeanWind;
uniform vec4  uCellA[6];      // xy: head station + cross offset, z: length, w: width
uniform vec4  uCellB[6];      // x: amplitude, y: veer, z: age, w: -
uniform vec2  uFwd;
uniform vec2  uSide;
uniform float uGustiness;
uniform float uTurbI;
uniform sampler2D uWindTerr;  // coarse ground height, metres
uniform vec3  uWindTerrO;     // xy: proxy centre in world xz, z: 1 / proxy span
${pe}${me}
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
  vec2 p = uWindOrigin + (vUv - 0.5) * ${Wi.toFixed(1)};
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
}`;class jc{constructor(e,t={}){this.renderer=e;const s=K(t.quality??1,.4,2),n=Math.max(128,Math.round((t.res??320)*Math.sqrt(s))&-2);this.everyNthFrame=Math.max(1,t.everyNthFrame??3),this._frame=0,this.rt=new hs(n,n,{type:mn,format:us,minFilter:ye,magFilter:ye,wrapS:Ne,wrapT:Ne,depthBuffer:!1,stencilBuffer:!1}),Q.uWindTex.value=this.rt.texture;const i=Wt((t.seed??4242)>>>0);this._r=i,this.time=0,this.baseSpeed=4.2,this.baseDir=292*Lt,this.meanSpeed=this.baseSpeed,this.meanDir=this.baseDir,this.tgtSpeed=this.baseSpeed,this.tgtDir=this.baseDir,this.gustiness=1,this.vec=new le,this.fwd=[0,1],this.side=[-1,0],this.cloudDrift=new le,this.cloudWind=new le;const o=Math.sin(this.meanDir+Math.PI),r=Math.cos(this.meanDir+Math.PI);this.fwd=[o,r],this.side=[-r,o],this.vec.set(o*this.meanSpeed,r*this.meanSpeed),this.cells=[];for(let u=0;u<6;u++)this.cells.push({s:-1400+u*430+i()*260,c:(i()-.5)*900,len:26+i()*34,wid:70+i()*130,amp:.85+i()*1.35,veer:(i()-.5)*.42,life:0});this._pxData=new Uint16Array(ve*ve),this._pxNext=new Float32Array(ve*ve),this._pxCursor=ve*ve,this._pxNextOX=0,this._pxNextOZ=0,this.proxy=new ua(this._pxData,ve,ve,da,mn),this.proxy.minFilter=ye,this.proxy.magFilter=ye,this.proxy.wrapS=Ne,this.proxy.wrapT=Ne,this.proxy.needsUpdate=!0,this._seed=(t.seed??4242)>>>0,this.worldSeed=(t.worldSeed??20260726)>>>0;const c=new nt;c.setAttribute("position",new U(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),c.setAttribute("uv",new U(new Float32Array([0,0,2,0,0,2]),2)),c.boundingSphere=new ot(new X,10),this._quadGeo=c,this._quadScene=new Hs,this._quadCam=new Cn;const l=[],h=[];for(let u=0;u<6;u++)l.push(new Fs),h.push(new Fs);this._uni={uTime:Q.uTime,uWindOrigin:Q.uWindOrigin,uMeanWind:Tn.uMeanWind,uCellA:{value:l},uCellB:{value:h},uFwd:{value:new le(o,r)},uSide:{value:new le(-r,o)},uGustiness:{value:1},uTurbI:{value:.26},uWindTerr:{value:this.proxy},uWindTerrO:{value:new X(0,0,1/Yt)}},this.material=new ge({glslVersion:"300 es",vertexShader:qc,fragmentShader:$c,uniforms:this._uni,depthTest:!1,depthWrite:!1}),this._quad=new Te(c,this.material),this._quad.frustumCulled=!1,this._quadScene.add(this._quad)}setSeed(e){return this.worldSeed=e>>>0,this._pxCursor=ve*ve,this}update(e,t){const s=this._r;this.time+=e;const n=1-Math.exp(-e/25),i=1-Math.exp(-e/40);this.tgtSpeed=K(this.tgtSpeed+(s()-.5)*e*2.4,this.baseSpeed*.62,this.baseSpeed*1.45),this.tgtDir=K(this.tgtDir+(s()-.5)*e*.16,this.baseDir-.34,this.baseDir+.34),this.meanSpeed+=(this.tgtSpeed-this.meanSpeed)*n,this.meanDir+=(this.tgtDir-this.meanDir)*i;const o=Math.sin(this.meanDir+Math.PI),r=Math.cos(this.meanDir+Math.PI);this.vec.set(o*this.meanSpeed,r*this.meanSpeed),this.fwd[0]=o,this.fwd[1]=r,this.side[0]=-r,this.side[1]=o;const c=this.meanSpeed*1.25*e;for(const u of this.cells)u.s+=c,u.life+=e,u.s-(t.x*o+t.z*r)>620&&(u.s-=1560+s()*280,u.c=(s()-.5)*940,u.len=26+s()*34,u.wid=70+s()*130,u.amp=.8+s()*1.4,u.veer=(s()-.5)*.44,u.life=0);const l=this.meanDir+Math.PI+.19;this.cloudWind.set(Math.sin(l)*this.meanSpeed*2.35,Math.cos(l)*this.meanSpeed*2.35),this.cloudDrift.x+=this.cloudWind.x*e,this.cloudDrift.y+=this.cloudWind.y*e,Tn.uMeanWind.value.copy(this.vec);const h=Math.hypot(this.vec.x,this.vec.y)||1;Q.uWindLag.value.set(this.vec.x/h*_o,this.vec.y/h*_o),this._stepProxy(t),this._frame%this.everyNthFrame===0&&this._pass(t),this._frame++}_stepProxy(e){const t=ve*ve;this._pxCursor>=t&&(this._pxNextOX=e.x,this._pxNextOZ=e.z,this._pxCursor=0);const s=Yt/(ve-1),n=this._pxNextOX-Yt*.5,i=this._pxNextOZ-Yt*.5,o=Math.min(t,this._pxCursor+Wc);for(let r=this._pxCursor;r<o;r++){const c=r%ve,l=r/ve|0;this._pxNext[r]=Ci(n+c*s,i+l*s,this.worldSeed)}if(this._pxCursor=o,o>=t){for(let r=0;r<t;r++)this._pxData[r]=fa.toHalfFloat(this._pxNext[r]);this.proxy.needsUpdate=!0,this._uni.uWindTerrO.value.set(this._pxNextOX,this._pxNextOZ,1/Yt)}}_pass(e){const t=this._uni;Q.uWindOrigin.value.set(e.x,e.z),t.uFwd.value.set(this.fwd[0],this.fwd[1]),t.uSide.value.set(this.side[0],this.side[1]),t.uGustiness.value=this.gustiness;for(let i=0;i<6;i++){const o=this.cells[i];t.uCellA.value[i].set(o.s,o.c,o.len,o.wid),t.uCellB.value[i].set(o.amp,o.veer,o.life,0)}const s=this.renderer,n=s.getRenderTarget();s.setRenderTarget(this.rt),s.render(this._quadScene,this._quadCam),s.setRenderTarget(n)}sample(e,t,s){const n=this.fwd[0],i=this.fwd[1],o=this.side[0],r=this.side[1];let c=this.vec.x,l=this.vec.y;const h=e*n+t*i,u=e*o+t*r;let d=0,f=0;for(const k of this.cells){const z=(h-k.s)/k.len;if(z>.16||z<-6)continue;const N=Ee(.14,0,z),H=Math.exp(z*2.05),B=Math.exp(-Math.pow(Math.abs(u-k.c)/(k.wid*.5),2.3)),$=k.amp*N*H*B*this.gustiness;d+=$,f+=$*k.veer}const p=this.time,m=(e-this.vec.x*p)*.0125,g=(t-this.vec.y*p)*.0125,v=Ve(m,g,this._seed),w=Ve(m+3.7,g-1.9,this._seed),b=m*2.6,y=g*2.6,x=Ve(b+11,y+5,this._seed),S=Ve(b-7,y+13,this._seed);c+=(v*1+x*.79)*this.meanSpeed*.19,l+=(w*1+S*.79)*this.meanSpeed*.19;const _=1+d*.85,M=Math.cos(f),T=Math.sin(f),R=(c*M-l*T)*_,L=(c*T+l*M)*_,A=s===void 0?1:Math.log((Math.max(s,.015)+.06)/.06)*.19523;return{x:R*A,z:L*A,gust:d,speed:Math.hypot(R,L)*A}}dispose(){this.rt.dispose(),this.proxy.dispose(),this.material.dispose(),this._quadGeo.dispose(),Q.uWindTex.value===this.rt.texture&&(Q.uWindTex.value=null)}}const Vc=4400,Sn=1.5,Yc=[{cs:12,near:0,far:26,dn:7,grid:7,lat:8,segs:3,wpx:1.7,hs:1,prepass:!0},{cs:28,near:22,far:88,dn:22,grid:9,lat:10,segs:2,wpx:2,hs:1.08,prepass:!0},{cs:80,near:80,far:300,dn:80,grid:9,lat:14,segs:1,wpx:3.8,hs:1.36,prepass:!1},{cs:160,near:270,far:560,dn:270,grid:9,lat:14,segs:1,wpx:6,hs:1.95,prepass:!1}],Xc=.004,To=2;function Zc(a){if(a<=0)return 0;if(a>=1)return 1;const e=Math.ceil(Math.log2(a)*To);return Math.min(1,Math.pow(2,e/To))}const Jc=.74,Qc=.85,Ts=930,So=100,el=2.5,Ao=1/65535,tl=1/4294967296,sl=ps.map(a=>a.grass),nl=pt.map(a=>a.dryness),ol=pt.map(a=>a.snow),il=pt.map(a=>a.wet),tn=a=>`vec3(${a[0].toFixed(4)},${a[1].toFixed(4)},${a[2].toFixed(4)})`,al=`
const vec3 F_DRY  = ${tn(pt[ut.STEPPE].foliage)};
const vec3 F_COLD = ${tn(pt[ut.HIGHLAND].foliage)};
const vec3 F_WET  = ${tn(pt[ut.WETLAND].foliage)};
`;function rl(a){const e=Math.max(1,a),t=2*e+1,s=new Float32Array(t*3);let n=0;for(let c=0;c<e;c++){const l=c/e;s[n++]=0,s[n++]=l,s[n++]=0,s[n++]=1,s[n++]=l,s[n++]=0}s[n++]=.5,s[n++]=1,s[n++]=0;const i=new Uint16Array((e-1)*6+3);let o=0;for(let c=0;c<e-1;c++){const l=c*2;i[o++]=l,i[o++]=l+2,i[o++]=l+1,i[o++]=l+1,i[o++]=l+2,i[o++]=l+3}const r=(e-1)*2;return i[o++]=r,i[o++]=2*e,i[o++]=r+1,{position:new U(s,3),index:new U(i,1)}}function cl(a,e){const t=Wt(e),s=new Uint16Array(a*2),n=Math.ceil(Math.sqrt(a)),i=1/n;let o=0;for(let r=0;r<a;r++){const c=r%n,l=r/n|0;s[o++]=Math.min(65535,(c+t())*i*65535)|0,s[o++]=Math.min(65535,(l+t())*i*65535)|0}for(let r=a-1;r>0;r--){const c=t()*(r+1)|0,l=s[r*2],h=s[r*2+1];s[r*2]=s[c*2],s[r*2+1]=s[c*2+1],s[c*2]=l,s[c*2+1]=h}return s}const ko=a=>`
uniform float uChunkSize;
uniform vec4  uLod;            // near, nearWidth, far, farWidth
uniform vec3  uLodB;           // widthBoost(angular), heightScale, ringDistance
uniform float uWindGain;
uniform float uPlayerPush;
in vec2  iPos;
in float iGrd;
in vec4  iTint;                // dryness, snow, wetness, lushness
${a?"":`
out vec3  vW;
out vec3  vN;
out float vT;        // height along the blade 0..1
out float vBend;     // how far the blade is laid over 0..1
out vec3  vTint;     // swale, tussock, dryness
out vec2  vBio;      // snow, wetness
out float vSide;     // -1..1 across the blade
out float vOccl;     // shaded by taller neighbours
out float vVar;      // per-blade value/hue jitter, seed head packed in
`}
void degenerate(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }

void main(){
  vec2 vtx = position.xy;              // x = across the blade, y = along it
  // The chunk origin comes straight out of the model matrix (three keeps that up to date
  // per object for free), so all of a ring's chunks share ONE material with ZERO per-draw
  // uniform traffic. Riding along with it: the density fraction the CPU drew in the X
  // scale and the chunk's ground-height range in the Y scale, both constant per chunk and
  // both otherwise a uniform upload per draw.
  vec2 cCen = vec2(modelMatrix[3][0], modelMatrix[3][2]);
  vec2 wxz  = (cCen - vec2(uChunkSize*0.5)) + iPos*uChunkSize;
  vec2 toB  = wxz - uCamPos.xz;
  float d2  = dot(toB, toB);
  float invD = inversesqrt(max(d2, 1e-4));
  float dist = d2*invD;

  /*  Lateral view-cone rejection, per blade, as the very first thing the shader does —
      five instructions, no memory access, no hashing. Culling happens per CHUNK on the
      CPU, and a chunk is a coarse unit: the one the car is standing in is always kept, yet
      more than half of its blades are behind you. uCull.xy is the view direction flattened
      onto the ground and uCull.z the cosine of the widest frustum corner, with a pad for
      blade width and wind lean. Blades within about five metres are exempt, since at that
      range a blade's own width subtends more than the pad. */
  if(d2 > 30.0 && dot(toB, uCull.xy)*invD < uCull.z){ degenerate(); return; }

  // ── overlapping LOD fades: blades grow in and shrink out, never pop ─────
  float fadeIn  = uLod.x <= 0.01 ? 1.0 : smoothstep(uLod.x - uLod.y, uLod.x + uLod.y, dist);
  float fadeOut = uLod.z <= 0.0  ? 1.0 : 1.0 - smoothstep(uLod.z - uLod.w, uLod.z, dist);
  float fade = fadeIn * fadeOut;
  if(fade < 0.006){ degenerate(); return; }

  // ── the density law, resolved per blade ────────────────────────────────
  // The CPU already thinned this chunk to the density its NEAREST corner deserves (it
  // deliberately over-draws), so all that is left here is to reject the surplus against
  // this blade's own true distance. The result is a perfectly smooth radial density
  // gradient with no chunk banding at all — which is what lets the far ring use 160 m
  // chunks and a few dozen draw calls.
  float rQ = hash12(wxz*1.317 + 7.71);
  float dn = uLodB.z;
  float chunkKeep = modelMatrix[0][0];
  // the exponent is 1.5 exactly so this is x·x·inversesqrt(x): three cheap instructions
  float xr = min(dn/max(dist, dn), 1.0);
  float bladeKeep = xr*xr*inversesqrt(max(xr, 1e-6));
  float need = rQ*chunkKeep;
  if(need > bladeKeep){ degenerate(); return; }   // conservative early gate

  /*  The pen issued three vertex texture fetches here — height, meadow, wind — carefully
      arranged so their addresses did not depend on each other. Two of the three are gone:
      the ground and everything the meadow texture used to carry now arrive as instance
      attributes, which cost no latency at all. What is left is the wind, sampled a little
      UPWIND of the blade: a spatial stand-in for the blade's own response lag, so a gust
      front visibly SWEEPS across the field instead of switching on. */
  float ground = modelMatrix[3][1] + iGrd * modelMatrix[1][1];
  vec4  Wsam   = windSample(wxz - uWindLag);

  float dryv  = iTint.x;
  float snowv = iTint.y;
  float lush  = iTint.w;
  // No grass mask gate: the CPU deleted every blade with no business existing — on the
  // carriageway, on a cliff, in the sand. What survives from the pen is the growth ramp,
  // because a hard accept/reject makes a blade POP into existence as you drive at it, and
  // a field full of popping blades shimmers.
  float thr  = bladeKeep*(0.78 + 0.22*lush);
  float grow = clamp((thr - need) / max(thr*0.22, 1e-5), 0.0, 1.0);
  if(grow <= 0.004){ degenerate(); return; }
  fade *= grow;

  // per-blade randomness hashed from WORLD position: the template is shared by every chunk
  // of this ring, yet nothing visibly tiles
  vec3 h3 = hash32(wxz*0.9173 + 11.0);
  float rH = h3.x, rO = h3.y, rS = h3.z;
  float rP = hash12(wxz*2.713 + 31.4);
  // Grass is negatively gravitropic — the stem grows toward vertical whatever the slope
  // does. Being correct here also removes four heightmap taps per vertex.
  vec3 up = vec3(0.0, 1.0, 0.0);

  // ── tussocks: height, hue and lean cluster at metre and decametre scales
  // The pen baked these two bands into its meadow texture because it could not afford
  // gradient noise on twelve million vertices. At a fifth of that count, two value-noise
  // taps are cheaper than the texture fetch they replace — and they stream for free.
  float clumpA = vn2(wxz * 0.0147);          // ~68 m tussock band
  float clumpB = vn2(wxz * 0.00342 + 17.3);  // ~292 m swales

  // a wild hay meadow, not a lawn
  float hgt = (0.30 + rH*0.30);
  hgt *= 0.68 + 0.74*clumpB;
  hgt *= 0.84 + 0.38*clumpA;
  hgt *= mix(1.24, 0.82, dryv);          // dry biomes carry a shorter sward
  hgt *= mix(0.55, 1.0, lush);
  // snow packs a sward flat long before it buries it
  hgt *= mix(1.0, 0.42, snowv * smoothstep(120.0, 240.0, ground));
  hgt *= uLodB.y;
  hgt  = max(hgt, 0.08);

  float wid = (0.0082 + rS*0.0070) * (0.84 + 0.40*clumpA);
  // angular floor: a blade is never allowed to fall below ~1 screen pixel wide
  wid = max(wid, dist * uLodB.x);

  float stiff = 0.52 + rS*0.46 + clumpB*0.10;

  // ── frame ──────────────────────────────────────────────────────────────
  float orient = rO*6.2831853 + clumpA*2.4;
  vec3 axis = vec3(cos(orient), 0.0, sin(orient));
  // at distance, swing the blade to present its face to the eye so it can never disappear
  // edge-on
  vec3 toCam = normalize(vec3(uCamPos.x - wxz.x, 0.0, uCamPos.z - wxz.y) + vec3(1e-5));
  float faceCam = smoothstep(16.0, 80.0, dist);
  axis = normalize(mix(axis, normalize(cross(vec3(0.0,1.0,0.0), toCam)), faceCam*0.88));

  vec3 sideV = normalize(cross(up, axis) + vec3(1e-6));
  vec3 front = normalize(cross(sideV, up));

  vec3 p0  = vec3(wxz.x, ground - 0.035, wxz.y);
  vec3 iv2 = p0 + up*hgt*0.965 + front*hgt*(0.20 + rH*0.34);

  // ── forces ─────────────────────────────────────────────────────────────
  vec2 wv = Wsam.rg; float gustN = Wsam.b, excite = Wsam.a;
  float prof = windProfile(hgt*0.70);
  vec3 wind3 = vec3(wv.x, 0.0, wv.y) * prof;

  vec3 gE = vec3(0.0,-1.0,0.0) * (1.6 + 1.4*rH);
  vec3 gF = 0.25 * length(gE) * front;
  vec3 gv = (gE + gF) * 0.048;

  vec3 dir0 = normalize(iv2 - p0);
  float fd = 1.0 - abs(dot(normalize(wind3 + vec3(1e-5)), dir0));   // alignment
  float fr = clamp(dot(iv2 - p0, up)/hgt, 0.0, 1.0);                // straightness
  vec3 wf = wind3 * (0.30 + 0.95*fd) * fr * uWindGain * (0.55 + 0.75*hgt);

  // quasi-static equilibrium of recovery + gravity + wind (Hooke)
  vec3 v2 = iv2 + (gv + wf) / max(stiff, 0.18);

  // ── ringing: a gust front leaves the blade quivering at its own frequency
  float fB = 1.85 + rS*1.55;
  float ph = rQ*6.2831853;
  float osc = sin(uTime*6.2831853*fB + ph);
  float amp = (excite*0.50 + max(gustN-0.85,0.0)*0.42) * (0.040 + 0.075*(1.0-stiff));
  vec2  wdirn = normalize(wv + vec2(1e-5));
  v2 += vec3(wdirn.x, 0.0, wdirn.y) * osc * amp * hgt;
  // never frozen: a low flutter always present
  v2 += sideV * sin(uTime*7.4*(0.65+rS) + ph*2.3) * hgt * 0.020 * (0.35 + gustN*0.65);

  // ── whatever is standing in the sward parts it ─────────────────────────
  // The pen pushed the grass aside around a walker. Here it is the camera: in a bumper or
  // bonnet view it is a metre off the ground and the sward opens around it; in a chase view
  // the vertical test switches it off, which is correct — the car is five metres ahead.
  if(uPlayerPush > 0.0){
    vec2 dp = wxz - uCamPos.xz;
    float pd = length(dp);
    if(pd < 2.4){
      float vert = 1.0 - smoothstep(1.3, 2.8, abs(uCamPos.y - ground));
      float push = smoothstep(1.85, 0.15, pd) * vert * uPlayerPush;
      v2 += vec3(dp.x, -0.55, dp.y)/max(pd, 0.02) * push * hgt * 0.85;
    }
  }

  // ── state corrections (Jahrmann §5.2) ──────────────────────────────────
  v2 -= up * min(dot(up, v2 - p0), 0.0);
  vec3 d20 = v2 - p0;
  float lproj = length(d20 - up*dot(d20, up));
  vec3 v1 = p0 + hgt*up*max(1.0 - lproj/hgt, 0.05*max(lproj/hgt, 1.0));
  float L0 = length(v2 - p0);
  float L1 = length(v1 - p0) + length(v2 - v1);
  float L  = (2.0*L0 + L1)/3.0;
  float rr = hgt / max(L, 1e-4);
  v1 = p0 + rr*(v1 - p0);
  v2 = v1 + rr*(v2 - v1);

  // ── evaluate the Bézier ────────────────────────────────────────────────
  float head = step(0.895, rP);     // one blade in ten carries a seed head
  float t = vtx.y;
  vec3 a = mix(p0, v1, t);
  vec3 b = mix(v1, v2, t);
  vec3 c = mix(a, b, t);
  vec3 tang = normalize(b - a + vec3(0.0,1e-5,0.0));

  // sqrt rather than pow(x, 0.40): the profile differs by a couple of percent over the
  // length of a blade and it is one transcendental fewer per vertex
  float wprof = sqrt(1.0 - t) * (0.60 + 0.42*smoothstep(0.0, 0.16, t));
  wprof = mix(wprof, wprof*1.9, head*smoothstep(0.80, 0.99, t));
  float u = (vtx.x - 0.5);
  vec3 sideW = normalize(sideV - tang*dot(sideV, tang) + vec3(1e-6));
  vec3 pos = c + sideW * (u * wid * wprof * 2.0 * fade);
  // shrink the whole blade as it fades, so LOD changes are invisible
  pos = mix(p0 + vec3(0.0, 0.02, 0.0), pos, 0.30 + 0.70*fade);

  // ── curved cross-section: two triangles wide, shades like a rolled leaf
  vec3 faceN = normalize(cross(sideW, tang));
  vec3 N = normalize(faceN + sideW*(u*2.0)*0.66);

${a?"":`
  vBend = clamp(1.0 - dot(normalize(v2-p0), up), 0.0, 1.0);
  vT    = t;
  vSide = u*2.0;
  vW    = pos;
  vN    = N;
  // a blade shorter than its neighbours sits in their shade: this is what gives a dense
  // sward its internal depth instead of one flat wall of green
  vOccl = smoothstep(0.18, 1.05, hgt / (0.42 + 0.72*clumpB));
  // the seed-head flag rides in the integer part of vVar
  vVar  = rS*0.6 + rH*0.4 + head*2.0;

  // per-blade hue: the meadow is a mosaic, never one green. The dryness gets a per-blade
  // wobble so a biome border reads as grass drying out patch by patch, not as a gradient.
  vTint = vec3(clumpB, clumpA, clamp(dryv + (rH-0.5)*0.22, 0.0, 1.0));
  vBio  = vec2(snowv, iTint.z);
`}
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}`,ll=a=>`
in vec3 vW; in vec3 vN; in float vT; in float vBend;
in vec3 vTint; in vec2 vBio; in float vSide; in float vOccl; in float vVar;
out vec4 outColor;

void main(){
  vec3 N = normalize(vN);
  vec3 toEye = uCamPos - vW;
  float vDist = length(toEye);
  vec3 V = toEye / max(vDist, 1e-4);
  if(!gl_FrontFacing) N = -N;
  float vHead = step(1.5, vVar);
  float vVarF = vVar - vHead*2.0;
  float vAO   = mix(0.34, 1.0, pow(vT, 0.55));

  // ── vertical hue path: teal at the root, yellow-green at the tip ───────
  float t = vT;
  vec3 lit = mix(${E.gLow}, ${E.gMid}, smoothstep(0.00, 0.26, t));
  lit = mix(lit, ${E.gUpper}, smoothstep(0.20, 0.66, t));
  lit = mix(lit, ${E.gTip},   smoothstep(0.80, 1.00, t));
  vec3 mid = mix(${E.gBase}, ${E.gMid}, smoothstep(0.05, 0.80, t));
  vec3 shd = mix(${E.gBase}*0.82, ${E.gLow}, smoothstep(0.15, 0.95, t));

  // meadow mosaic
  lit = mix(lit, ${E.gPatchC}, smoothstep(0.35,0.85,vTint.x)*0.45);
  lit = mix(lit, ${E.gPatchA}, smoothstep(0.65,0.15,vTint.x)*0.35);
  mid = mix(mid, ${E.gPatchB}, smoothstep(0.3,0.8,vTint.y)*0.40);
  shd = mix(shd, ${E.tHollow}, smoothstep(0.4,0.9,vTint.y)*0.35);

  // ── the biome, as three scalars rather than five branches ──────────────
  // Dryness bleeds the greens toward straw from the tip down, because that is the order a
  // blade actually cures in. It is a hue rotation and not a desaturation: dead grass is
  // yellow, not grey.
  float dryB = vTint.z;
  float dry = smoothstep(0.10, 0.95, dryB) * smoothstep(0.30, 0.98, t);
  lit = mix(lit, ${E.gDry},      dry*0.72);
  mid = mix(mid, ${E.gDry}*0.72, dry*0.48);
  shd = mix(shd, ${E.gDry}*0.36, dry*0.30);

  // BIOME_TINT's foliage multipliers, along the three axes the instance carries.
  float snowB = vBio.x, wetB = vBio.y;
  vec3 fol = mix(vec3(1.0), F_DRY,  dryB);
  fol *= mix(vec3(1.0), F_COLD, snowB);
  fol *= mix(vec3(1.0), F_WET,  wetB);
  lit *= fol; mid *= fol; shd *= fol;

  // Snow above the line, on the same curve the terrain material uses so a snowfield and
  // the grass poking through it agree about where the line is.
  float snowC = snowB * smoothstep(120.0, 240.0, vW.y);
  lit = mix(lit, vec3(0.95,0.96,0.99), snowC*0.86);
  mid = mix(mid, vec3(0.80,0.85,0.94), snowC*0.86);
  shd = mix(shd, vec3(0.58,0.66,0.82), snowC*0.86);

  // no two blades in a meadow are the same green
  float vj = 0.84 + 0.34*vVarF;
  lit *= vj; mid *= vj*0.98; shd *= 0.92 + 0.20*vVarF;
  lit = mix(lit, ${E.gPatchB}, smoothstep(0.72, 1.0, vVarF)*0.30);

  float ndl = dot(N, uSunDir);
${a<=1?"  float sh = sunShadow(vW, ndl) * cloudShadow(vW);":a===2?"  float sh = sunShadowFast(vW, ndl) * cloudShadow(vW);":"  float sh = cloudShadow(vW);"}
  float selfShadow = mix(0.62, 1.0, pow(t, 0.75));

  // Everything that varies ACROSS the width of a blade — the fanned normal, the rim, the
  // wind flash, the midrib — is sub-pixel detail once a blade is only two or three pixels
  // wide, and sub-pixel detail does not resolve, it sparkles. nearK retires those terms
  // with distance and leaves the ones that vary ALONG the blade, which stay several pixels
  // tall much further out.
  float nearK = 1.0 - smoothstep(55.0, 240.0, vDist);
  N = normalize(mix(vec3(0.0,1.0,0.0), N, 0.34 + 0.66*nearK));

  Surf s;
  s.N=N; s.V=V; s.P=vW;
  s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = ${a<=1?"mix(0.11, 0.24, clamp(vDist*0.008,0.0,1.0))":"0.20"};
  s.jit  = ${a<=1?"(vn2(vW.xz*3.9 + vW.y*1.7) - 0.5)*0.055":"(vVarF-0.5)*0.05"};
  s.shadow = sh*selfShadow*mix(0.52, 1.0, vOccl);
  s.trans  = 1.00*smoothstep(0.12,0.68,t);
  s.transCol = ${E.gTrans};
  s.rim = 0.34*(0.25 + 0.75*nearK); s.ao = vAO; s.ambient = 1.0;
  vec3 col = paint(s);

  // ── the wind flash ─────────────────────────────────────────────────────
  // a blade laid over by a gust turns its broad face up and catches the light: this is what
  // makes a gust visible as a pale band racing across the field
  float geom = pow(clamp(1.0 - abs(dot(N,V)), 0.0, 1.0), 1.9)*0.45
             + pow(clamp(dot(N, normalize(uSunDir + V)), 0.0, 1.0), 3.2)*0.55;
  float flash = smoothstep(0.34, 0.86, vBend) * smoothstep(0.14, 0.78, t);
  col = mix(col, ${E.gSheen}, geom*flash*0.55*(0.30 + 0.70*sh)*(0.32 + 0.68*nearK));

  // seed head: a warm bronze plume on one blade in ten
  if(vHead > 0.5){
    float hd = smoothstep(0.78, 0.94, t);
    col = mix(col, mix(${E.gDry}, vec3(0.32,0.22,0.14), 0.42)*1.25, hd*0.82);
  }
  // a hint of the midrib, and the deep interior of the sward
  col *= 1.0 - abs(vSide)*0.13*nearK;
  col *= mix(0.46, 1.0, vOccl*0.55 + 0.45);

  // Out past a hundred metres a blade is only two or three pixels wide, and full contrast
  // against the ground behind it is what makes distant grass crawl and sparkle as the
  // camera moves. Converging it toward the sward mean keeps every bit of the texture and
  // takes the edge energy out of it — which is, not coincidentally, exactly what a painter
  // does at that depth.
  col = mix(col, mix(col, ${E.tMid}, 0.62), smoothstep(90.0, 430.0, vDist)*0.42);

  col = aerial(col, vDist, V, vW.y);
  outColor = vec4(SAFE3(col), gFogAmt);
}`;class hl{constructor(e,t){this.cap=t,this.count=0,this.cx=0,this.cz=0,this.wx=0,this.wy=0,this.wz=0,this.frac=1,this.wantFrac=1,this.dirty=!0,this.stamp=-1,this.built=0,this.minY=0,this.ySpan=1,this.lat=new Float32Array((e.R.lat+1)*(e.R.lat+1)*5),this.iPos=new Uint16Array(t*2),this.iGrd=new Uint16Array(t),this.iTint=new Uint8Array(t*4);const s=new ui;s.setAttribute("position",e.blade.position),s.setIndex(e.blade.index),this.aPos=new ft(this.iPos,2,!0),this.aGrd=new ft(this.iGrd,1,!0),this.aTint=new ft(this.iTint,4,!0),s.setAttribute("iPos",this.aPos),s.setAttribute("iGrd",this.aGrd),s.setAttribute("iTint",this.aTint),s.boundingSphere=new ot(new X,1e6),s.instanceCount=0,this.geom=s;const n=new Te(s,e.mat);if(n.frustumCulled=!1,n.renderOrder=4+e.index,n.visible=!1,this.mesh=n,e.preMat){const i=new Te(s,e.preMat);i.frustumCulled=!1,i.renderOrder=-20+e.index,this.pre=i,n.add(i)}else this.pre=null}dispose(){this.geom.dispose()}}class ul{constructor({seed:e,scene:t,quality:s=1,wind:n=null}={}){this.seed=e>>>0,this.quality=K(s,.25,2),this.wind=n,this.budgetMs=el,this.angPerPx=1.012/1080,this._group=new vt,this._group.matrixAutoUpdate=!1,this._group.name="grass",t&&t.add(this._group),this._terrain=null,this._regionX=1/0,this._regionZ=1/0,this.stats={chunks:0,dirty:0,drawn:0,built:0,extended:0,buildMs:0,bytes:0},this._rings=Yc.map((i,o)=>this._buildRing(i,o))}get group(){return this._group}setAngular(e){this.angPerPx=e;for(const t of this._rings)t.uni.uLodB.value.x=e*t.R.wpx;return this}_buildRing(e,t){const s=rl(e.segs),n=Math.max(64,Math.round(Vc/Math.pow(e.dn,Sn)*e.cs*e.cs*this.quality)),i=cl(n,7e3+t*131+this.seed),o=Re(Object.assign({uChunkSize:{value:e.cs},uLod:{value:new Fs(e.near,Math.max(7,e.near*.26),e.far,e.far*.26)},uLodB:{value:new X(this.angPerPx*e.wpx,e.hs,e.dn)},uWindGain:{value:.235},uPlayerPush:{value:t===0?1:0}},Kc())),r=At({cshSpan:9200,cloudDeck:980}),c=new ge({glslVersion:"300 es",uniforms:o,vertexShader:Me(pe,me,Mo,ko(!1)),fragmentShader:Oe(pe,me,al,r,Ht,kt,ll(t)),side:st}),l=e.prepass?new ge({glslVersion:"300 es",uniforms:o,vertexShader:Me(pe,me,Mo,ko(!0)),fragmentShader:Fn,side:st,colorWrite:!1}):null,h=e.grid,u=(h-1)/2,d=new Int32Array(h*h),f=new Float32Array(h*h),p=[];for(let g=-u;g<=u;g++)for(let v=-u;v<=u;v++){const w=(g+u)*h+(v+u),b=dl(e,v,g),y=b<Xc?0:Zc(b);f[w]=y,d[w]=y<=0?0:Math.max(48,Math.round(n*y)),d[w]>0&&p.push(w)}return p.sort((g,v)=>{const w=g%h-u,b=(g/h|0)-u,y=v%h-u,x=(v/h|0)-u;return Math.max(Math.abs(w),Math.abs(b))-Math.max(Math.abs(y),Math.abs(x))}),{R:e,index:t,blade:s,tpl:i,full:n,uni:o,mat:c,preMat:l,grid:h,half:u,cap:d,capFrac:f,order:p,slots:new Array(h*h).fill(null),scratch:new Array(h*h).fill(null),pool:[],ox:0,oz:0,stamp:0,ready:!1}}update(e,t,s,n){this.wind&&this.wind.update(n,{x:e,y:s,z:t});const i=performance.now();this._ensureRegion(e,t);for(const r of this._rings)this._recentre(r,e,t);const o=this._drainQueue(i);this.stats.buildMs=performance.now()-i,this.stats.built+=o,this._draw(e,t,s)}_ensureRegion(e,t){this._terrain&&Math.abs(e-this._regionX)<So&&Math.abs(t-this._regionZ)<So||(this._terrain=new Gt(this.seed,e-Ts,t-Ts,e+Ts,t+Ts,90),this._regionX=e,this._regionZ=t)}_recentre(e,t,s){const n=e.R.cs,i=Math.floor(t/n),o=Math.floor(s/n);if(e.ready&&i===e.ox&&o===e.oz)return;const r=e.grid,c=e.half;if(e.ready){const l=i-e.ox,h=o-e.oz,u=e.slots,d=e.scratch,f=++e.stamp;d.fill(null);for(let p=-c;p<=c;p++){const m=p+h;if(!(m<-c||m>c))for(let g=-c;g<=c;g++){const v=g+l;if(v<-c||v>c)continue;const w=u[(m+c)*r+(v+c)];w&&(w.stamp=f,d[(p+c)*r+(g+c)]=w)}}for(let p=0;p<u.length;p++){const m=u[p];m&&m.stamp!==f&&this._release(e,m)}e.slots=d,e.scratch=u}e.ox=i,e.oz=o,e.ready=!0;for(let l=0;l<e.order.length;l++){const h=e.order[l],u=e.cap[h],d=e.slots[h];if(d&&d.cap>=u)continue;const f=h%r-c,p=(h/r|0)-c,m=this._acquire(e,u);d?(this._carryOver(d,m),this._release(e,d),this.stats.extended++):(m.cx=i+f,m.cz=o+p),m.wantFrac=e.capFrac[h],e.slots[h]=m}}_carryOver(e,t){t.iPos.set(e.iPos.subarray(0,e.count*2)),t.iGrd.set(e.iGrd.subarray(0,e.count)),t.iTint.set(e.iTint.subarray(0,e.count*4)),t.lat.set(e.lat),t.count=e.count,t.built=e.built,t.cx=e.cx,t.cz=e.cz,t.wx=e.wx,t.wy=e.wy,t.wz=e.wz,t.minY=e.minY,t.ySpan=e.ySpan,t.frac=e.frac,t.mesh.position.copy(e.mesh.position),t.mesh.scale.y=e.ySpan,t.aPos.needsUpdate=!0,t.aGrd.needsUpdate=!0,t.aTint.needsUpdate=!0,t.dirty=!0}_acquire(e,t){let s=-1;for(let i=0;i<e.pool.length;i++){const o=e.pool[i];o.cap<t||(s<0||o.cap<e.pool[s].cap)&&(s=i)}if(s>=0){const i=e.pool.splice(s,1)[0];return i.count=0,i.built=0,i.dirty=!0,i}const n=new hl(e,t);return this._group.add(n.mesh),this.stats.chunks++,this.stats.bytes+=t*10,n}_release(e,t){t.mesh.visible=!1,t.dirty=!0,e.pool.push(t);const s=e.grid+2;for(;e.pool.length>s;){let n=0;for(let o=1;o<e.pool.length;o++)e.pool[o].cap>e.pool[n].cap&&(n=o);const i=e.pool.splice(n,1)[0];this._group.remove(i.mesh),i.dispose(),this.stats.chunks--,this.stats.bytes-=i.cap*10}}_drainQueue(e){let t=0,s=0;for(const n of this._rings)for(let i=0;i<n.order.length;i++){const o=n.slots[n.order[i]];!o||!o.dirty||(s++,!(performance.now()-e>=this.budgetMs)&&(this._buildChunk(n,o),t++))}return this.stats.dirty=s,t}_buildChunk(e,t){const s=e.R,n=s.cs,i=s.lat,o=i+1,r=t.lat,c=t.cx*n,l=t.cz*n;if(t.built===0){const x=this._terrain,S=n/i;let _=1/0,M=-1/0;for(let T=0;T<o;T++){const R=l+T*S;for(let L=0;L<o;L++){const A=c+L*S,k=x.height(A,R),z=x.weights(A,R).w;let N=0,H=0,B=0,$=0;for(let O=0;O<he;O++){const V=z[O];V<.002||(N+=V*sl[O],H+=V*nl[O],B+=V*ol[O],$+=V*il[O])}const se=x.roads.carve(A,R).edge,C=(T*o+L)*5;r[C]=k,r[C+1]=N*(1-D(se)),r[C+2]=H,r[C+3]=B,r[C+4]=$,k<_&&(_=k),k>M&&(M=k)}}for(let T=0;T<o;T++){const R=T>0?T-1:T,L=T<o-1?T+1:T,A=(L-R)*S;for(let k=0;k<o;k++){const z=k>0?k-1:k,N=k<o-1?k+1:k,H=(N-z)*S,B=(r[(T*o+z)*5]-r[(T*o+N)*5])/H,$=(r[(R*o+k)*5]-r[(L*o+k)*5])/A,se=1/Math.sqrt(B*B+$*$+1);r[(T*o+k)*5+1]*=Ee(Jc,Qc,se)}}t.minY=_,t.ySpan=Math.max(M-_,.5),t.wx=c+n*.5,t.wz=l+n*.5,t.wy=_+t.ySpan*.5,t.count=0}const h=t.minY,u=1/t.ySpan,d=e.tpl,f=t.cap,p=t.iPos,m=t.iGrd,g=t.iTint,v=this.seed,w=t.cx,b=t.cz;let y=t.count;for(let x=t.built;x<f;x++){const S=d[x*2],_=d[x*2+1],M=S*Ao*i,T=_*Ao*i;let R=M|0;R>i-1&&(R=i-1);let L=T|0;L>i-1&&(L=i-1);const A=M-R,k=T-L,z=(L*o+R)*5,N=z+5,H=z+o*5,B=H+5,$=(1-A)*(1-k),se=A*(1-k),C=(1-A)*k,O=A*k,V=r[z+1]*$+r[N+1]*se+r[H+1]*C+r[B+1]*O;if(V<=.004||yi(w,b,x,v)*tl>V)continue;const ie=r[z]*$+r[N]*se+r[H]*C+r[B]*O,ee=r[z+2]*$+r[N+2]*se+r[H+2]*C+r[B+2]*O,ne=r[z+3]*$+r[N+3]*se+r[H+3]*C+r[B+3]*O,ue=r[z+4]*$+r[N+4]*se+r[H+4]*C+r[B+4]*O;p[y*2]=S,p[y*2+1]=_,m[y]=(ie-h)*u*65535|0;const we=y*4;g[we]=D(ee)*255|0,g[we+1]=D(ne)*255|0,g[we+2]=D(ue)*255|0,g[we+3]=D(V)*255|0,y++}t.count=y,t.built=f,t.aPos.needsUpdate=!0,t.aGrd.needsUpdate=!0,t.aTint.needsUpdate=!0,t.mesh.position.set(t.wx,t.minY,t.wz),t.mesh.scale.y=t.ySpan,t.frac=t.wantFrac,t.dirty=!1}_draw(e,t,s){const n=Q.uCull.value;let i=0;for(const o of this._rings){const r=o.R,c=r.cs,l=Math.max(7,r.near*.26),h=r.far*.26,u=o.slots;for(let d=0;d<u.length;d++){const f=u[d];if(!f)continue;const p=f.mesh;if(f.count===0){p.visible=!1;continue}const m=f.wx-e,g=f.wy-s,v=f.wz-t,w=Math.sqrt(m*m+g*g+v*v);if(w-c*.75>r.far){p.visible=!1;continue}if(w+c*.75<r.near-l){p.visible=!1;continue}if(w>c*1.6){const L=1/Math.sqrt(m*m+v*v||1),A=c*.75/w;if((m*n.x+v*n.y)*L<n.z-A){p.visible=!1;continue}}const b=Math.max(Math.abs(m)-c*.5,0),y=Math.max(Math.abs(v)-c*.5,0),x=Math.max(Math.sqrt(b*b+y*y+g*g),r.dn),S=Math.min(1,Math.pow(r.dn/x,Sn));let _=1;r.near>.01&&(_*=Ee(r.near-l-c*.6,r.near+l,w)),_*=1-Ee(r.far-h,r.far+c*.6,w);const M=f.frac,T=Math.min(S,M),R=Math.round(f.count*(T/M)*D(_));if(R<=0){p.visible=!1;continue}p.visible=!0,p.scale.x=T,f.geom.instanceCount=R,i+=R}}this.stats.drawn=i}dispose(){for(const e of this._rings){for(const t of e.slots)t&&t.dispose();for(const t of e.pool)t.dispose();e.slots.fill(null),e.pool.length=0,e.mat.dispose(),e.preMat&&e.preMat.dispose()}this._group.clear(),this._group.parent&&this._group.parent.remove(this._group),this._rings.length=0,this.stats.chunks=0,this.stats.bytes=0}}function dl(a,e,t){const s=Math.max(7,a.near*.26),n=a.far*.26,i=Math.hypot(Math.max(Math.abs(e)-1,0)*a.cs,Math.max(Math.abs(t)-1,0)*a.cs);if(i>a.far)return 0;const o=Math.hypot((Math.abs(e)+1)*a.cs,(Math.abs(t)+1)*a.cs);let r=0;const c=24;for(let l=0;l<=c;l++){const h=i+(o-i)*l/c,u=Math.min(1,Math.pow(a.dn/Math.max(h,a.dn),Sn)),d=a.near<=.01?1:Ee(a.near-s,a.near+s,h),f=1-Ee(a.far-n,a.far,h),p=u*d*f;p>r&&(r=p)}return r}const fl=1.7,Ro=520;class pl{constructor({seed:e,material:t,depthMaterial:s=null,workers:n=0,viewDistance:i=7e3,onChunk:o=null,onRelease:r=null,terrain:c="rolling"}){this.seed=e>>>0,this.material=t,this.depthMaterial=s,this.viewDistance=i,this.onChunk=o,this.onRelease=r,this.terrainPreset=c,this.group=new vt,this.group.name="terrain",this.group.matrixAutoUpdate=!1,this.live=new Map,this.pending=new Map,this.queue=[],this.stats={built:0,queued:0,live:0,workers:0,lastMs:0};const l=n||Math.max(2,Math.min(6,(navigator.hardwareConcurrency||4)-2));this.workers=[],this.busy=[];for(let h=0;h<l;h++){const u=new Worker(new URL(""+new URL("chunkWorker-DS88PxZa.js",import.meta.url).href,import.meta.url),{type:"module"});u.onmessage=d=>this._onWorkerMessage(h,d.data),u.onerror=d=>console.error("[streamer] worker error",d.message),this.workers.push(u),this.busy.push(null)}this.stats.workers=l,this._jobId=1,this._camera=new X,this._maxLevel=Math.min(sc-1,Math.max(0,Math.ceil(Math.log2(i/cs))))}_select(e,t){const s=new Map,n=this._maxLevel,i=Ut(n),o=Math.ceil(this.viewDistance/i)+1,r=Math.floor(e/i),c=Math.floor(t/i),l=[];for(let h=c-o;h<=c+o;h++)for(let u=r-o;u<=r+o;u++)l.push([u,h,n]);for(;l.length;){const[h,u,d]=l.pop(),f=Ut(d),p=(h+.5)*f,m=(u+.5)*f,g=Math.max(Math.abs(e-p)-f*.5,0),v=Math.max(Math.abs(t-m)-f*.5,0),w=Math.hypot(g,v);if(!(w>this.viewDistance))if(d>0&&w<f*fl){const b=d-1;l.push([h*2,u*2,b]),l.push([h*2+1,u*2,b]),l.push([h*2,u*2+1,b]),l.push([h*2+1,u*2+1,b])}else s.set(`${d}:${h},${u}`,{cx:h,cz:u,level:d,d:w})}return s}update(e,t){const s=performance.now(),n=this._select(e,t);this.queue.length=0;for(const[i,o]of n)this.live.has(i)||this.pending.has(i)||this.queue.push({key:i,...o});this.queue.sort((i,o)=>i.d-o.d);for(const[i,o]of this.live)n.has(i)||this._release(i,o);if(this.live.size>Ro){const i=[...this.live.entries()].sort((o,r)=>{const c=Math.hypot(o[1].ox+o[1].size*.5-e,o[1].oz+o[1].size*.5-t);return Math.hypot(r[1].ox+r[1].size*.5-e,r[1].oz+r[1].size*.5-t)-c});for(let o=0;o<i.length-Ro;o++)this._release(i[o][0],i[o][1])}this._pump(),this.stats.queued=this.queue.length,this.stats.live=this.live.size,this.stats.lastMs=performance.now()-s}_pump(){for(let e=0;e<this.workers.length&&this.queue.length;e++){if(this.busy[e])continue;const t=this.queue.shift();if(this.live.has(t.key)||this.pending.has(t.key)){e--;continue}const s=this._jobId++;this.busy[e]=t.key,this.pending.set(t.key,s),this.workers[e].postMessage({jobId:s,cx:t.cx,cz:t.cz,level:t.level,seed:this.seed,terrain:this.terrainPreset})}}_onWorkerMessage(e,t){const s=this.busy[e];if(this.busy[e]=null,t.type==="error"){console.error("[streamer] chunk build failed",t.message),s&&this.pending.delete(s),this._pump();return}if(t.type!=="chunk")return;const n=`${t.level}:${t.cx},${t.cz}`;this.pending.delete(n),this.live.has(n)||this._adopt(n,t),this._pump()}_adopt(e,t){const s=new nt;s.setAttribute("position",new U(t.position,3)),s.setAttribute("normal",new U(t.normal,3)),s.setAttribute("aBiome",new U(t.biome,4,!0)),s.setAttribute("aRoad",new U(t.road,2,!0)),s.setIndex(new U(t.index,1));const n=Math.hypot(t.size,t.maxY-t.minY)*.72;s.boundingSphere=new ot(new X(t.size*.5,(t.minY+t.maxY)*.5,t.size*.5),n);const i=new Te(s,this.material);i.position.set(t.ox,0,t.oz),i.frustumCulled=!0,i.matrixAutoUpdate=!1,i.updateMatrix(),i.userData.level=t.level,i.renderOrder=-t.level,this.group.add(i);const o={mesh:i,level:t.level,cx:t.cx,cz:t.cz,size:t.size,ox:t.ox,oz:t.oz,step:t.step,grid:t.grid,minY:t.minY,maxY:t.maxY,heights:t.heights||null,water:t.water||null};this.live.set(e,o),this.stats.built++,this.onChunk&&this.onChunk(o,t)}_release(e,t){this.onRelease&&this.onRelease(t),this.group.remove(t.mesh),t.mesh.geometry.dispose(),this.live.delete(e)}sampleHeight(e,t){const s=cs,n=`0:${Math.floor(e/s)},${Math.floor(t/s)}`,i=this.live.get(n);if(!i||!i.heights)return null;const o=(e-i.ox)/i.step,r=(t-i.oz)/i.step;let c=Math.floor(o),l=Math.floor(r);const h=i.grid||ic;if(c<0||l<0||c>h-2||l>h-2)return null;const u=o-c,d=r-l,f=i.heights,p=f[l*h+c],m=f[l*h+c+1],g=f[(l+1)*h+c],v=f[(l+1)*h+c+1];return(p*(1-u)+m*u)*(1-d)+(g*(1-u)+v*u)*d}isReady(e,t){return this.sampleHeight(e,t)!==null}forceChunk(e,t){const s=Math.floor(e/cs),n=Math.floor(t/cs),i=`0:${s},${n}`;if(this.live.has(i))return;const o=ac({cx:s,cz:n,level:0,seed:this.seed});this.pending.delete(i),this._adopt(i,o)}dispose(){for(const e of this.workers)e.terminate();for(const[e,t]of this.live)this._release(e,t)}}const Eo=["gt","sports","hyper"],Co=[{name:"Persimmon",body:Z("paintA"),accent:Z("paintD")},{name:"Barley",body:Z("paintB"),accent:Z("paintF")},{name:"Cobalt",body:Z("paintC"),accent:Z("paintD")},{name:"Chalk",body:Z("paintD"),accent:Z("paintF")},{name:"Verdigris",body:Z("paintE"),accent:Z("paintD")},{name:"Ink",body:Z("paintF"),accent:Z("paintB")},{name:"Rust",body:Bs(Z("paintA"),Z("paintF"),.42),accent:Z("paintB")},{name:"Seafoam",body:Bs(Z("paintE"),Z("paintD"),.45),accent:Z("paintC")}],ml={gt:{hull:[{z:2.35,yb:.34,yt:.74,wb:.56,wt:.62},{z:1.98,yb:.26,yt:.8,wb:.78,wt:.82},{z:1.39,yb:.22,yt:.86,wb:.86,wt:.92},{z:.6,yb:.22,yt:.9,wb:.88,wt:.92},{z:-.1,yb:.22,yt:.94,wb:.88,wt:.92},{z:-.95,yb:.24,yt:.96,wb:.88,wt:.9},{z:-1.39,yb:.26,yt:.94,wb:.86,wt:.88},{z:-2.35,yb:.44,yt:.82,wb:.62,wt:.66}],cabin:[{z:.58,yb:.86,yt:.99,wb:.84,wt:.66},{z:-.14,yb:.9,yt:1.36,wb:.82,wt:.62},{z:-.86,yb:.92,yt:1.36,wb:.82,wt:.62},{z:-2.06,yb:.84,yt:.98,wb:.74,wt:.5}],axle:[1.39,-1.39],track:[.8,.8],wheel:{rf:.34,rr:.35,wf:.145,wr:.155},lamps:"round",tail:"blocks",wing:"none",intakes:!1},sports:{hull:[{z:2.15,yb:.26,yt:.6,wb:.54,wt:.64},{z:1.72,yb:.2,yt:.7,wb:.8,wt:.88},{z:1.28,yb:.18,yt:.76,wb:.86,wt:.94},{z:.45,yb:.18,yt:.84,wb:.88,wt:.94},{z:-.35,yb:.2,yt:.96,wb:.9,wt:.96},{z:-1.05,yb:.22,yt:1.02,wb:.9,wt:.96},{z:-1.28,yb:.24,yt:1.02,wb:.88,wt:.94},{z:-2.15,yb:.46,yt:.88,wb:.7,wt:.74}],cabin:[{z:.42,yb:.8,yt:.88,wb:.8,wt:.58},{z:-.18,yb:.86,yt:1.24,wb:.78,wt:.56},{z:-.66,yb:.9,yt:1.24,wb:.76,wt:.54},{z:-1.02,yb:.92,yt:1.02,wb:.72,wt:.46}],axle:[1.28,-1.28],track:[.8,.82],wheel:{rf:.33,rr:.35,wf:.15,wr:.175},lamps:"slim",tail:"blocks",wing:"lip",intakes:!0},hyper:{hull:[{z:2.3,yb:.16,yt:.48,wb:.64,wt:.76},{z:1.85,yb:.14,yt:.58,wb:.92,wt:1},{z:1.35,yb:.13,yt:.66,wb:.96,wt:1.03},{z:.5,yb:.13,yt:.74,wb:.96,wt:1.02},{z:-.3,yb:.14,yt:.88,wb:.98,wt:1.03},{z:-1.05,yb:.16,yt:.96,wb:.98,wt:1.03},{z:-1.35,yb:.18,yt:.96,wb:.96,wt:1},{z:-2.3,yb:.36,yt:.84,wb:.78,wt:.84}],cabin:[{z:.46,yb:.7,yt:.8,wb:.82,wt:.54},{z:-.14,yb:.8,yt:1.16,wb:.8,wt:.5},{z:-.62,yb:.84,yt:1.16,wb:.78,wt:.48},{z:-1.06,yb:.86,yt:.98,wb:.72,wt:.42}],axle:[1.35,-1.35],track:[.84,.85],wheel:{rf:.34,rr:.36,wf:.165,wr:.2},lamps:"slim",tail:"bar",wing:"high",intakes:!0}},zo=a=>[[a.wb,a.yb,a.z],[-a.wb,a.yb,a.z],[-a.wt,a.yt,a.z],[a.wt,a.yt,a.z]];function Lo(a,e,t,s,n=!0,i=!0){let o=zo(e[0]);n&&bt(a,o[0],o[1],o[2],o[3],t,s,[0,0,1]);for(let r=1;r<e.length;r++){const c=zo(e[r]);bt(a,o[0],o[3],c[3],c[0],t,s,[1,0,0]),bt(a,o[1],o[2],c[2],c[1],t,s,[-1,0,0]),bt(a,o[3],o[2],c[2],c[3],t,s,[0,1,0]),bt(a,o[0],o[1],c[1],c[0],t,s,[0,-1,0]),o=c}i&&bt(a,o[0],o[1],o[2],o[3],t,s,[0,0,-1])}function sn(a,e){if(e>=a[0].z)return a[0];for(let t=1;t<a.length;t++)if(e>=a[t].z){const s=a[t-1],n=a[t],i=(s.z-e)/(s.z-n.z);return{z:e,yb:F(s.yb,n.yb,i),yt:F(s.yt,n.yt,i),wb:F(s.wb,n.wb,i),wt:F(s.wt,n.wt,i)}}return a[a.length-1]}function Ss(a,e,t,s,n,i,o,r){for(let c=0;c<n;c++){const l=c/n*J,h=(c+1)/n*J,u=Math.cos(l),d=Math.sin(l),f=Math.cos(h),p=Math.sin(h);bt(a,[e,t*u,t*d],[e,t*f,t*p],[e,s*f,s*p],[e,s*u,s*d],i,o,[r,0,0])}}function Do(a,e){const t=Gs(),s=Z("tyre"),n=Bs(Z("chrome"),Z("paintF"),.34),i=Mt(Z("chrome"),.72),o=Bs(Z("tyre"),Z("tail"),.34);Pe(t,[-e,0,0],[e,0,0],a,a,14,s,P.MATTE,!1,!1),Ss(t,e,a,a*.68,14,Mt(s,1.18),P.MATTE,1),Ss(t,-e,a,a*.68,14,Mt(s,1.18),P.MATTE,-1),Pe(t,[-e*.92,0,0],[e*.92,0,0],a*.68,a*.68,8,Mt(n,.7),P.METAL,!1,!1),Ss(t,e*.92,a*.68,a*.52,12,n,P.METAL,1),Ss(t,-e*.92,a*.68,a*.52,12,n,P.METAL,-1);for(let r=0;r<5;r++){const c=r/5*J,l=Math.cos(c),h=Math.sin(c);for(const u of[-1,1]){const d=u*e*.9;Pe(t,[d,a*.18*l,a*.18*h],[d,a*.56*l,a*.56*h],a*.07,a*.06,4,n,P.METAL,!1,!1)}}return Pe(t,[-e*.96,0,0],[e*.96,0,0],a*.19,a*.19,8,i,P.METAL,!0,!0),Pe(t,[-e*.42,0,0],[e*.42,0,0],a*.6,a*.6,12,o,P.LAMP_C,!0,!0),Us(t)}function vl(a,e,t){const s=Gs(),n=e.body,i=e.accent,o=Z("paintF"),r=Z("chrome"),c=Z("glass"),l=Z("head"),h=Z("tail"),u=a.hull[0].z,d=a.hull[a.hull.length-1].z,f=a.hull[0],p=a.hull[a.hull.length-1];Lo(s,a.hull,n,P.METAL),Lo(s,a.cabin,c,P.GLASS);const m=a.cabin[1],g=a.cabin[2];oe(s,0,m.yt+.012,(m.z+g.z)*.5,m.wt*.94,.02,Math.abs(m.z-g.z)*.5+.05,0,n,P.METAL);const v=(a.axle[0]+a.axle[1])*.5,w=sn(a.hull,v);for(const _ of[-1,1])oe(s,_*(w.wb+.01),w.yb+.07,v,.035,.07,(a.axle[0]-a.axle[1])*.5-.34,0,o,P.MATTE);oe(s,0,f.yb+.015,u-.14,f.wb*1.02,.025,.18,0,o,P.MATTE),oe(s,0,F(f.yb,f.yt,.28),u-.03,f.wb*.72,.09,.06,0,o,P.GLASS);const b=F(f.yt,f.yb,.26);for(const _ of[-1,1]){const M=_*(f.wt*.62);a.lamps==="round"?(Pe(s,[M,b,u-.12],[M,b,u+.03],.115,.105,8,l,P.LAMP_A,!1,!0),Pe(s,[M,b,u-.14],[M,b,u-.11],.125,.125,8,r,P.METAL,!1,!0)):(oe(s,M,b,u-.02,.2,.045,.08,0,l,P.LAMP_A),oe(s,M,b-.055,u-.03,.2,.02,.07,0,o,P.MATTE))}oe(s,0,p.yb+.17,d+.015,p.wb*.94,.06,.04,0,o,P.MATTE);const y=F(p.yt,p.yb,.34);if(a.tail==="bar")oe(s,0,y,d+.02,p.wt*.82,.035,.05,0,h,P.LAMP_B);else for(const _ of[-1,1])oe(s,_*p.wt*.55,y,d+.02,.22,.05,.05,0,h,P.LAMP_B);if(a.wing==="lip")oe(s,0,p.yt+.04,d+.16,p.wt*.9,.035,.14,0,n,P.METAL);else if(a.wing==="high"){const _=d+.24,M=p.yt+.3;oe(s,0,M,_,p.wt*.92,.025,.16,0,n,P.METAL);for(const T of[-1,1])oe(s,T*p.wt*.92,M-.02,_,.02,.1,.2,0,i,P.METAL),oe(s,T*.3,M-.16,_-.02,.03,.16,.05,0,o,P.METAL)}if(a.intakes){const _=a.axle[1]+.62,M=sn(a.hull,_);for(const T of[-1,1])oe(s,T*(F(M.wb,M.wt,.55)+.005),F(M.yb,M.yt,.58),_,.03,.1,.26,0,o,P.GLASS),oe(s,T*(F(M.wb,M.wt,.55)+.02),F(M.yb,M.yt,.58),_+.28,.02,.11,.05,0,i,P.METAL)}const x=a.cabin[0].z+.06,S=sn(a.hull,x);for(const _ of[-1,1]){const M=_*(S.wt+.02);Pe(s,[M,S.yt+.02,x],[M+_*.09,S.yt+.09,x-.02],.018,.018,4,o,P.MATTE,!1,!1),oe(s,M+_*.11,S.yt+.1,x-.03,.035,.045,.075,0,n,P.METAL)}if(!t){const _=a.cabin[1];for(const M of[-1,1])oe(s,M*.32,_.yt-.22,_.z-.16,.13,.11,.05,0,o,P.MATTE),oe(s,M*.32,_.yt-.4,_.z-.02,.17,.1,.2,0,Mt(o,1.5),P.MATTE);oe(s,0,_.yb+.06,a.cabin[0].z-.1,_.wb*.8,.05,.12,0,Mt(o,1.2),P.MATTE);for(let M=-1;M<=1;M++)oe(s,M*p.wb*.42,p.yb+.06,d+.18,.025,.06,.18,0,o,P.MATTE);for(const M of[-1,1])Pe(s,[M*.22,p.yb+.06,d+.12],[M*.22,p.yb+.06,d-.03],.042,.047,6,Mt(r,.72),P.METAL,!1,!0)}return Us(s)}function Ki(a,e,t){const s=typeof a=="number"?Eo[a]||"sports":Eo.indexOf(a)>=0?a:"sports",n=ml[s],i=Co.length,o=Co[((e|0)%i+i)%i],r=Nn(t?{ghost:!0,opacity:.85}:{}),c=Lc(),l=[],h=vl(n,o,t),u=Do(n.wheel.rf,n.wheel.wf),d=Do(n.wheel.rr,n.wheel.wr);l.push(h,u,d);const f=new et;f.name=`car:${s}`;const p=new et;p.name="chassis",f.add(p);const m=new Te(h,r);m.userData.depth=c,p.add(m);const g=[],v=[],w=(T,R)=>{const L=T?u:d,A=T?n.axle[0]:n.axle[1],k=R*n.track[T?0:1],z=T?n.wheel.rf:n.wheel.rr,N=new Te(L,r);if(N.userData.depth=c,T){const H=new et;H.position.set(k,z,A),f.add(H),H.add(N),g.push(H)}else N.position.set(k,z,A),f.add(N);v.push(N)};w(!0,1),w(!0,-1),w(!1,1),w(!1,-1);const b=r.uniforms.uLamp.value;let y=!1,x=0;const S=()=>{b.x=y?1:0,b.y=Math.max(y?.28:0,x),b.z=x},_=T=>T.getIndex().count/3|0,M=_(h)+2*_(u)+2*_(d);return{group:f,wheels:v,setSteer(T){g[0].rotation.y=T,g[1].rotation.y=T},setWheelSpin(T){for(const R of v)R.rotation.x=T},setBrakeGlow(T){x=D(T),S()},setLights(T){y=!!T,S()},setBodyRoll(T,R){p.rotation.z=T,p.rotation.x=R},triangles:M,dispose(){for(const T of l)T.dispose();r.dispose(),c.dispose(),f.parent&&f.parent.remove(f)}}}function gl({tier:a="sports",paint:e=0}={}){return Ki(a,e,!1)}function wl({tier:a="sports",paint:e=0}={}){return Ki(a,e,!0)}function Fo(a,e){if(e===pa)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),a;if(e===gn||e===fi){let t=a.getIndex();if(t===null){const o=[],r=a.getAttribute("position");if(r!==void 0){for(let c=0;c<r.count;c++)o.push(c);a.setIndex(o),t=a.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),a}const s=t.count-2,n=[];if(e===gn)for(let o=1;o<=s;o++)n.push(t.getX(0)),n.push(t.getX(o)),n.push(t.getX(o+1));else for(let o=0;o<s;o++)o%2===0?(n.push(t.getX(o)),n.push(t.getX(o+1)),n.push(t.getX(o+2))):(n.push(t.getX(o+2)),n.push(t.getX(o+1)),n.push(t.getX(o)));n.length/3!==s&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const i=a.clone();return i.setIndex(n),i.clearGroups(),i}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),a}class xl extends ma{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new Tl(t)}),this.register(function(t){return new Sl(t)}),this.register(function(t){return new Fl(t)}),this.register(function(t){return new Il(t)}),this.register(function(t){return new Pl(t)}),this.register(function(t){return new kl(t)}),this.register(function(t){return new Rl(t)}),this.register(function(t){return new El(t)}),this.register(function(t){return new Cl(t)}),this.register(function(t){return new Ml(t)}),this.register(function(t){return new zl(t)}),this.register(function(t){return new Al(t)}),this.register(function(t){return new Dl(t)}),this.register(function(t){return new Ll(t)}),this.register(function(t){return new yl(t)}),this.register(function(t){return new Nl(t)}),this.register(function(t){return new Ol(t)})}load(e,t,s,n){const i=this;let o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){const l=ls.extractUrlBase(e);o=ls.resolveURL(l,this.path)}else o=ls.extractUrlBase(e);this.manager.itemStart(e);const r=function(l){n?n(l):console.error(l),i.manager.itemError(e),i.manager.itemEnd(e)},c=new pi(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{i.parse(l,o,function(h){t(h),i.manager.itemEnd(e)},r)}catch(h){r(h)}},s,r)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,s,n){let i;const o={},r={},c=new TextDecoder;if(typeof e=="string")i=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===qi){try{o[q.KHR_BINARY_GLTF]=new Bl(e)}catch(u){n&&n(u);return}i=JSON.parse(o[q.KHR_BINARY_GLTF].content)}else i=JSON.parse(c.decode(e));else i=e;if(i.asset===void 0||i.asset.version[0]<2){n&&n(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const l=new Jl(i,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){const u=this.pluginCallbacks[h](l);u.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),r[u.name]=u,o[u.name]=!0}if(i.extensionsUsed)for(let h=0;h<i.extensionsUsed.length;++h){const u=i.extensionsUsed[h],d=i.extensionsRequired||[];switch(u){case q.KHR_MATERIALS_UNLIT:o[u]=new _l;break;case q.KHR_DRACO_MESH_COMPRESSION:o[u]=new Gl(i,this.dracoLoader);break;case q.KHR_TEXTURE_TRANSFORM:o[u]=new Ul;break;case q.KHR_MESH_QUANTIZATION:o[u]=new Hl;break;default:d.indexOf(u)>=0&&r[u]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+u+'".')}}l.setExtensions(o),l.setPlugins(r),l.parse(s,n)}parseAsync(e,t){const s=this;return new Promise(function(n,i){s.parse(e,t,n,i)})}}function bl(){let a={};return{get:function(e){return a[e]},add:function(e,t){a[e]=t},remove:function(e){delete a[e]},removeAll:function(){a={}}}}const q={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class yl{constructor(e){this.parser=e,this.name=q.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,t=this.parser.json.nodes||[];for(let s=0,n=t.length;s<n;s++){const i=t[s];i.extensions&&i.extensions[this.name]&&i.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,i.extensions[this.name].light)}}_loadLight(e){const t=this.parser,s="light:"+e;let n=t.cache.get(s);if(n)return n;const i=t.json,c=((i.extensions&&i.extensions[this.name]||{}).lights||[])[e];let l;const h=new tt(16777215);c.color!==void 0&&h.setRGB(c.color[0],c.color[1],c.color[2],Le);const u=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new wa(h),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new ga(h),l.distance=u;break;case"spot":l=new va(h),l.distance=u,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),$e(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),n=Promise.resolve(l),t.cache.add(s,n),n}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){const t=this,s=this.parser,i=s.json.nodes[e],r=(i.extensions&&i.extensions[this.name]||{}).light;return r===void 0?null:this._loadLight(r).then(function(c){return s._getNodeRef(t.cache,r,c)})}}class _l{constructor(){this.name=q.KHR_MATERIALS_UNLIT}getMaterialType(){return ts}extendParams(e,t,s){const n=[];e.color=new tt(1,1,1),e.opacity=1;const i=t.pbrMetallicRoughness;if(i){if(Array.isArray(i.baseColorFactor)){const o=i.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],Le),e.opacity=o[3]}i.baseColorTexture!==void 0&&n.push(s.assignTexture(e,"map",i.baseColorTexture,Ot))}return Promise.all(n)}}class Ml{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name].emissiveStrength;return i!==void 0&&(t.emissiveIntensity=i),Promise.resolve()}}class Tl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];if(o.clearcoatFactor!==void 0&&(t.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&i.push(s.assignTexture(t,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&i.push(s.assignTexture(t,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(i.push(s.assignTexture(t,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){const r=o.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new le(r,r)}return Promise.all(i)}}class Sl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_DISPERSION}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name];return t.dispersion=i.dispersion!==void 0?i.dispersion:0,Promise.resolve()}}class Al{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.iridescenceFactor!==void 0&&(t.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&i.push(s.assignTexture(t,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(t.iridescenceIOR=o.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&i.push(s.assignTexture(t,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(i)}}class kl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_SHEEN}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[];t.sheenColor=new tt(0,0,0),t.sheenRoughness=0,t.sheen=1;const o=n.extensions[this.name];if(o.sheenColorFactor!==void 0){const r=o.sheenColorFactor;t.sheenColor.setRGB(r[0],r[1],r[2],Le)}return o.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&i.push(s.assignTexture(t,"sheenColorMap",o.sheenColorTexture,Ot)),o.sheenRoughnessTexture!==void 0&&i.push(s.assignTexture(t,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(i)}}class Rl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.transmissionFactor!==void 0&&(t.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&i.push(s.assignTexture(t,"transmissionMap",o.transmissionTexture)),Promise.all(i)}}class El{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_VOLUME}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];t.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&i.push(s.assignTexture(t,"thicknessMap",o.thicknessTexture)),t.attenuationDistance=o.attenuationDistance||1/0;const r=o.attenuationColor||[1,1,1];return t.attenuationColor=new tt().setRGB(r[0],r[1],r[2],Le),Promise.all(i)}}class Cl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_IOR}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name];return t.ior=i.ior!==void 0?i.ior:1.5,Promise.resolve()}}class zl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_SPECULAR}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];t.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&i.push(s.assignTexture(t,"specularIntensityMap",o.specularTexture));const r=o.specularColorFactor||[1,1,1];return t.specularColor=new tt().setRGB(r[0],r[1],r[2],Le),o.specularColorTexture!==void 0&&i.push(s.assignTexture(t,"specularColorMap",o.specularColorTexture,Ot)),Promise.all(i)}}class Ll{constructor(e){this.parser=e,this.name=q.EXT_MATERIALS_BUMP}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return t.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&i.push(s.assignTexture(t,"bumpMap",o.bumpTexture)),Promise.all(i)}}class Dl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Xe}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.anisotropyStrength!==void 0&&(t.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(t.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&i.push(s.assignTexture(t,"anisotropyMap",o.anisotropyTexture)),Promise.all(i)}}class Fl{constructor(e){this.parser=e,this.name=q.KHR_TEXTURE_BASISU}loadTexture(e){const t=this.parser,s=t.json,n=s.textures[e];if(!n.extensions||!n.extensions[this.name])return null;const i=n.extensions[this.name],o=t.options.ktx2Loader;if(!o){if(s.extensionsRequired&&s.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,i.source,o)}}class Il{constructor(e){this.parser=e,this.name=q.EXT_TEXTURE_WEBP}loadTexture(e){const t=this.name,s=this.parser,n=s.json,i=n.textures[e];if(!i.extensions||!i.extensions[t])return null;const o=i.extensions[t],r=n.images[o.source];let c=s.textureLoader;if(r.uri){const l=s.options.manager.getHandler(r.uri);l!==null&&(c=l)}return s.loadTextureImage(e,o.source,c)}}class Pl{constructor(e){this.parser=e,this.name=q.EXT_TEXTURE_AVIF}loadTexture(e){const t=this.name,s=this.parser,n=s.json,i=n.textures[e];if(!i.extensions||!i.extensions[t])return null;const o=i.extensions[t],r=n.images[o.source];let c=s.textureLoader;if(r.uri){const l=s.options.manager.getHandler(r.uri);l!==null&&(c=l)}return s.loadTextureImage(e,o.source,c)}}class Nl{constructor(e){this.name=q.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){const t=this.parser.json,s=t.bufferViews[e];if(s.extensions&&s.extensions[this.name]){const n=s.extensions[this.name],i=this.parser.getDependency("buffer",n.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return i.then(function(r){const c=n.byteOffset||0,l=n.byteLength||0,h=n.count,u=n.byteStride,d=new Uint8Array(r,c,l);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(h,u,d,n.mode,n.filter).then(function(f){return f.buffer}):o.ready.then(function(){const f=new ArrayBuffer(h*u);return o.decodeGltfBuffer(new Uint8Array(f),h,u,d,n.mode,n.filter),f})})}else return null}}class Ol{constructor(e){this.name=q.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const t=this.parser.json,s=t.nodes[e];if(!s.extensions||!s.extensions[this.name]||s.mesh===void 0)return null;const n=t.meshes[s.mesh];for(const l of n.primitives)if(l.mode!==ze.TRIANGLES&&l.mode!==ze.TRIANGLE_STRIP&&l.mode!==ze.TRIANGLE_FAN&&l.mode!==void 0)return null;const o=s.extensions[this.name].attributes,r=[],c={};for(const l in o)r.push(this.parser.getDependency("accessor",o[l]).then(h=>(c[l]=h,c[l])));return r.length<1?null:(r.push(this.parser.createNodeMesh(e)),Promise.all(r).then(l=>{const h=l.pop(),u=h.isGroup?h.children:[h],d=l[0].count,f=[];for(const p of u){const m=new Nt,g=new X,v=new Ln,w=new X(1,1,1),b=new di(p.geometry,p.material,d);for(let y=0;y<d;y++)c.TRANSLATION&&g.fromBufferAttribute(c.TRANSLATION,y),c.ROTATION&&v.fromBufferAttribute(c.ROTATION,y),c.SCALE&&w.fromBufferAttribute(c.SCALE,y),b.setMatrixAt(y,m.compose(g,v,w));for(const y in c)if(y==="_COLOR_0"){const x=c[y];b.instanceColor=new ft(x.array,x.itemSize,x.normalized)}else y!=="TRANSLATION"&&y!=="ROTATION"&&y!=="SCALE"&&p.geometry.setAttribute(y,c[y]);vt.prototype.copy.call(b,p),this.parser.assignFinalMaterial(b),f.push(b)}return h.isGroup?(h.clear(),h.add(...f),h):f[0]}))}}const qi="glTF",Xt=12,Io={JSON:1313821514,BIN:5130562};class Bl{constructor(e){this.name=q.KHR_BINARY_GLTF,this.content=null,this.body=null;const t=new DataView(e,0,Xt),s=new TextDecoder;if(this.header={magic:s.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==qi)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const n=this.header.length-Xt,i=new DataView(e,Xt);let o=0;for(;o<n;){const r=i.getUint32(o,!0);o+=4;const c=i.getUint32(o,!0);if(o+=4,c===Io.JSON){const l=new Uint8Array(e,Xt+o,r);this.content=s.decode(l)}else if(c===Io.BIN){const l=Xt+o;this.body=e.slice(l,l+r)}o+=r}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class Gl{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=q.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){const s=this.json,n=this.dracoLoader,i=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,r={},c={},l={};for(const h in o){const u=An[h]||h.toLowerCase();r[u]=o[h]}for(const h in e.attributes){const u=An[h]||h.toLowerCase();if(o[h]!==void 0){const d=s.accessors[e.attributes[h]],f=Ft[d.componentType];l[u]=f.name,c[u]=d.normalized===!0}}return t.getDependency("bufferView",i).then(function(h){return new Promise(function(u,d){n.decodeDracoFile(h,function(f){for(const p in f.attributes){const m=f.attributes[p],g=c[p];g!==void 0&&(m.normalized=g)}u(f)},r,l,Le,d)})})}}class Ul{constructor(){this.name=q.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}}class Hl{constructor(){this.name=q.KHR_MESH_QUANTIZATION}}class $i extends Ua{constructor(e,t,s,n){super(e,t,s,n)}copySampleValue_(e){const t=this.resultBuffer,s=this.sampleValues,n=this.valueSize,i=e*n*3+n;for(let o=0;o!==n;o++)t[o]=s[i+o];return t}interpolate_(e,t,s,n){const i=this.resultBuffer,o=this.sampleValues,r=this.valueSize,c=r*2,l=r*3,h=n-t,u=(s-t)/h,d=u*u,f=d*u,p=e*l,m=p-l,g=-2*f+3*d,v=f-d,w=1-g,b=v-d+u;for(let y=0;y!==r;y++){const x=o[m+y+r],S=o[m+y+c]*h,_=o[p+y+r],M=o[p+y]*h;i[y]=w*x+b*S+g*_+v*M}return i}}const Wl=new Ln;class Kl extends $i{interpolate_(e,t,s,n){const i=super.interpolate_(e,t,s,n);return Wl.fromArray(i).normalize().toArray(i),i}}const ze={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},Ft={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},Po={9728:mi,9729:ye,9984:Ta,9985:Ma,9986:_a,9987:zn},No={33071:Ne,33648:Sa,10497:wn},nn={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},An={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},ct={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},ql={CUBICSPLINE:void 0,LINEAR:wi,STEP:Ba},on={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function $l(a){return a.DefaultMaterial===void 0&&(a.DefaultMaterial=new vi({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:En})),a.DefaultMaterial}function wt(a,e,t){for(const s in t.extensions)a[s]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[s]=t.extensions[s])}function $e(a,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(a.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function jl(a,e,t){let s=!1,n=!1,i=!1;for(let l=0,h=e.length;l<h;l++){const u=e[l];if(u.POSITION!==void 0&&(s=!0),u.NORMAL!==void 0&&(n=!0),u.COLOR_0!==void 0&&(i=!0),s&&n&&i)break}if(!s&&!n&&!i)return Promise.resolve(a);const o=[],r=[],c=[];for(let l=0,h=e.length;l<h;l++){const u=e[l];if(s){const d=u.POSITION!==void 0?t.getDependency("accessor",u.POSITION):a.attributes.position;o.push(d)}if(n){const d=u.NORMAL!==void 0?t.getDependency("accessor",u.NORMAL):a.attributes.normal;r.push(d)}if(i){const d=u.COLOR_0!==void 0?t.getDependency("accessor",u.COLOR_0):a.attributes.color;c.push(d)}}return Promise.all([Promise.all(o),Promise.all(r),Promise.all(c)]).then(function(l){const h=l[0],u=l[1],d=l[2];return s&&(a.morphAttributes.position=h),n&&(a.morphAttributes.normal=u),i&&(a.morphAttributes.color=d),a.morphTargetsRelative=!0,a})}function Vl(a,e){if(a.updateMorphTargets(),e.weights!==void 0)for(let t=0,s=e.weights.length;t<s;t++)a.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){const t=e.extras.targetNames;if(a.morphTargetInfluences.length===t.length){a.morphTargetDictionary={};for(let s=0,n=t.length;s<n;s++)a.morphTargetDictionary[t[s]]=s}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function Yl(a){let e;const t=a.extensions&&a.extensions[q.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+an(t.attributes):e=a.indices+":"+an(a.attributes)+":"+a.mode,a.targets!==void 0)for(let s=0,n=a.targets.length;s<n;s++)e+=":"+an(a.targets[s]);return e}function an(a){let e="";const t=Object.keys(a).sort();for(let s=0,n=t.length;s<n;s++)e+=t[s]+":"+a[t[s]]+";";return e}function kn(a){switch(a){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function Xl(a){return a.search(/\.jpe?g($|\?)/i)>0||a.search(/^data\:image\/jpeg/)===0?"image/jpeg":a.search(/\.webp($|\?)/i)>0||a.search(/^data\:image\/webp/)===0?"image/webp":a.search(/\.ktx2($|\?)/i)>0||a.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const Zl=new Nt;class Jl{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new bl,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let s=!1,n=-1,i=!1,o=-1;if(typeof navigator<"u"){const r=navigator.userAgent;s=/^((?!chrome|android).)*safari/i.test(r)===!0;const c=r.match(/Version\/(\d+)/);n=s&&c?parseInt(c[1],10):-1,i=r.indexOf("Firefox")>-1,o=i?r.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||s&&n<17||i&&o<98?this.textureLoader=new xa(this.options.manager):this.textureLoader=new ba(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new pi(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){const s=this,n=this.json,i=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([s.getDependencies("scene"),s.getDependencies("animation"),s.getDependencies("camera")])}).then(function(o){const r={scene:o[0][n.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:n.asset,parser:s,userData:{}};return wt(i,r,n),$e(r,n),Promise.all(s._invokeAll(function(c){return c.afterRoot&&c.afterRoot(r)})).then(function(){for(const c of r.scenes)c.updateMatrixWorld();e(r)})}).catch(t)}_markDefs(){const e=this.json.nodes||[],t=this.json.skins||[],s=this.json.meshes||[];for(let n=0,i=t.length;n<i;n++){const o=t[n].joints;for(let r=0,c=o.length;r<c;r++)e[o[r]].isBone=!0}for(let n=0,i=e.length;n<i;n++){const o=e[n];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(s[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,s){if(e.refs[t]<=1)return s;const n=s.clone(),i=(o,r)=>{const c=this.associations.get(o);c!=null&&this.associations.set(r,c);for(const[l,h]of o.children.entries())i(h,r.children[l])};return i(s,n),n.name+="_instance_"+e.uses[t]++,n}_invokeOne(e){const t=Object.values(this.plugins);t.push(this);for(let s=0;s<t.length;s++){const n=e(t[s]);if(n)return n}return null}_invokeAll(e){const t=Object.values(this.plugins);t.unshift(this);const s=[];for(let n=0;n<t.length;n++){const i=e(t[n]);i&&s.push(i)}return s}getDependency(e,t){const s=e+":"+t;let n=this.cache.get(s);if(!n){switch(e){case"scene":n=this.loadScene(t);break;case"node":n=this._invokeOne(function(i){return i.loadNode&&i.loadNode(t)});break;case"mesh":n=this._invokeOne(function(i){return i.loadMesh&&i.loadMesh(t)});break;case"accessor":n=this.loadAccessor(t);break;case"bufferView":n=this._invokeOne(function(i){return i.loadBufferView&&i.loadBufferView(t)});break;case"buffer":n=this.loadBuffer(t);break;case"material":n=this._invokeOne(function(i){return i.loadMaterial&&i.loadMaterial(t)});break;case"texture":n=this._invokeOne(function(i){return i.loadTexture&&i.loadTexture(t)});break;case"skin":n=this.loadSkin(t);break;case"animation":n=this._invokeOne(function(i){return i.loadAnimation&&i.loadAnimation(t)});break;case"camera":n=this.loadCamera(t);break;default:if(n=this._invokeOne(function(i){return i!=this&&i.getDependency&&i.getDependency(e,t)}),!n)throw new Error("Unknown type: "+e);break}this.cache.add(s,n)}return n}getDependencies(e){let t=this.cache.get(e);if(!t){const s=this,n=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(n.map(function(i,o){return s.getDependency(e,o)})),this.cache.add(e,t)}return t}loadBuffer(e){const t=this.json.buffers[e],s=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[q.KHR_BINARY_GLTF].body);const n=this.options;return new Promise(function(i,o){s.load(ls.resolveURL(t.uri,n.path),i,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){const t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(s){const n=t.byteLength||0,i=t.byteOffset||0;return s.slice(i,i+n)})}loadAccessor(e){const t=this,s=this.json,n=this.json.accessors[e];if(n.bufferView===void 0&&n.sparse===void 0){const o=nn[n.type],r=Ft[n.componentType],c=n.normalized===!0,l=new r(n.count*o);return Promise.resolve(new U(l,o,c))}const i=[];return n.bufferView!==void 0?i.push(this.getDependency("bufferView",n.bufferView)):i.push(null),n.sparse!==void 0&&(i.push(this.getDependency("bufferView",n.sparse.indices.bufferView)),i.push(this.getDependency("bufferView",n.sparse.values.bufferView))),Promise.all(i).then(function(o){const r=o[0],c=nn[n.type],l=Ft[n.componentType],h=l.BYTES_PER_ELEMENT,u=h*c,d=n.byteOffset||0,f=n.bufferView!==void 0?s.bufferViews[n.bufferView].byteStride:void 0,p=n.normalized===!0;let m,g;if(f&&f!==u){const v=Math.floor(d/f),w="InterleavedBuffer:"+n.bufferView+":"+n.componentType+":"+v+":"+n.count;let b=t.cache.get(w);b||(m=new l(r,v*f,n.count*f/h),b=new ya(m,f/h),t.cache.add(w,b)),g=new Ga(b,c,d%f/h,p)}else r===null?m=new l(n.count*c):m=new l(r,d,n.count*c),g=new U(m,c,p);if(n.sparse!==void 0){const v=nn.SCALAR,w=Ft[n.sparse.indices.componentType],b=n.sparse.indices.byteOffset||0,y=n.sparse.values.byteOffset||0,x=new w(o[1],b,n.sparse.count*v),S=new l(o[2],y,n.sparse.count*c);r!==null&&(g=new U(g.array.slice(),g.itemSize,g.normalized)),g.normalized=!1;for(let _=0,M=x.length;_<M;_++){const T=x[_];if(g.setX(T,S[_*c]),c>=2&&g.setY(T,S[_*c+1]),c>=3&&g.setZ(T,S[_*c+2]),c>=4&&g.setW(T,S[_*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}g.normalized=p}return g})}loadTexture(e){const t=this.json,s=this.options,i=t.textures[e].source,o=t.images[i];let r=this.textureLoader;if(o.uri){const c=s.manager.getHandler(o.uri);c!==null&&(r=c)}return this.loadTextureImage(e,i,r)}loadTextureImage(e,t,s){const n=this,i=this.json,o=i.textures[e],r=i.images[t],c=(r.uri||r.bufferView)+":"+o.sampler;if(this.textureCache[c])return this.textureCache[c];const l=this.loadImageSource(t,s).then(function(h){h.flipY=!1,h.name=o.name||r.name||"",h.name===""&&typeof r.uri=="string"&&r.uri.startsWith("data:image/")===!1&&(h.name=r.uri);const d=(i.samplers||{})[o.sampler]||{};return h.magFilter=Po[d.magFilter]||ye,h.minFilter=Po[d.minFilter]||zn,h.wrapS=No[d.wrapS]||wn,h.wrapT=No[d.wrapT]||wn,h.generateMipmaps=!h.isCompressedTexture&&h.minFilter!==mi&&h.minFilter!==ye,n.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){const s=this,n=this.json,i=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(u=>u.clone());const o=n.images[e],r=self.URL||self.webkitURL;let c=o.uri||"",l=!1;if(o.bufferView!==void 0)c=s.getDependency("bufferView",o.bufferView).then(function(u){l=!0;const d=new Blob([u],{type:o.mimeType});return c=r.createObjectURL(d),c});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const h=Promise.resolve(c).then(function(u){return new Promise(function(d,f){let p=d;t.isImageBitmapLoader===!0&&(p=function(m){const g=new Vn(m);g.needsUpdate=!0,d(g)}),t.load(ls.resolveURL(u,i.path),p,void 0,f)})}).then(function(u){return l===!0&&r.revokeObjectURL(c),$e(u,o),u.userData.mimeType=o.mimeType||Xl(o.uri),u}).catch(function(u){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),u});return this.sourceCache[e]=h,h}assignTexture(e,t,s,n){const i=this;return this.getDependency("texture",s.index).then(function(o){if(!o)return null;if(s.texCoord!==void 0&&s.texCoord>0&&(o=o.clone(),o.channel=s.texCoord),i.extensions[q.KHR_TEXTURE_TRANSFORM]){const r=s.extensions!==void 0?s.extensions[q.KHR_TEXTURE_TRANSFORM]:void 0;if(r){const c=i.associations.get(o);o=i.extensions[q.KHR_TEXTURE_TRANSFORM].extendTexture(o,r),i.associations.set(o,c)}}return n!==void 0&&(o.colorSpace=n),e[t]=o,o})}assignFinalMaterial(e){const t=e.geometry;let s=e.material;const n=t.attributes.tangent===void 0,i=t.attributes.color!==void 0,o=t.attributes.normal===void 0;if(e.isPoints){const r="PointsMaterial:"+s.uuid;let c=this.cache.get(r);c||(c=new Aa,Xs.prototype.copy.call(c,s),c.color.copy(s.color),c.map=s.map,c.sizeAttenuation=!1,this.cache.add(r,c)),s=c}else if(e.isLine){const r="LineBasicMaterial:"+s.uuid;let c=this.cache.get(r);c||(c=new ka,Xs.prototype.copy.call(c,s),c.color.copy(s.color),c.map=s.map,this.cache.add(r,c)),s=c}if(n||i||o){let r="ClonedMaterial:"+s.uuid+":";n&&(r+="derivative-tangents:"),i&&(r+="vertex-colors:"),o&&(r+="flat-shading:");let c=this.cache.get(r);c||(c=s.clone(),i&&(c.vertexColors=!0),o&&(c.flatShading=!0),n&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(r,c),this.associations.set(c,this.associations.get(s))),s=c}e.material=s}getMaterialType(){return vi}loadMaterial(e){const t=this,s=this.json,n=this.extensions,i=s.materials[e];let o;const r={},c=i.extensions||{},l=[];if(c[q.KHR_MATERIALS_UNLIT]){const u=n[q.KHR_MATERIALS_UNLIT];o=u.getMaterialType(),l.push(u.extendParams(r,i,t))}else{const u=i.pbrMetallicRoughness||{};if(r.color=new tt(1,1,1),r.opacity=1,Array.isArray(u.baseColorFactor)){const d=u.baseColorFactor;r.color.setRGB(d[0],d[1],d[2],Le),r.opacity=d[3]}u.baseColorTexture!==void 0&&l.push(t.assignTexture(r,"map",u.baseColorTexture,Ot)),r.metalness=u.metallicFactor!==void 0?u.metallicFactor:1,r.roughness=u.roughnessFactor!==void 0?u.roughnessFactor:1,u.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(r,"metalnessMap",u.metallicRoughnessTexture)),l.push(t.assignTexture(r,"roughnessMap",u.metallicRoughnessTexture))),o=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,r)})))}i.doubleSided===!0&&(r.side=st);const h=i.alphaMode||on.OPAQUE;if(h===on.BLEND?(r.transparent=!0,r.depthWrite=!1):(r.transparent=!1,h===on.MASK&&(r.alphaTest=i.alphaCutoff!==void 0?i.alphaCutoff:.5)),i.normalTexture!==void 0&&o!==ts&&(l.push(t.assignTexture(r,"normalMap",i.normalTexture)),r.normalScale=new le(1,1),i.normalTexture.scale!==void 0)){const u=i.normalTexture.scale;r.normalScale.set(u,u)}if(i.occlusionTexture!==void 0&&o!==ts&&(l.push(t.assignTexture(r,"aoMap",i.occlusionTexture)),i.occlusionTexture.strength!==void 0&&(r.aoMapIntensity=i.occlusionTexture.strength)),i.emissiveFactor!==void 0&&o!==ts){const u=i.emissiveFactor;r.emissive=new tt().setRGB(u[0],u[1],u[2],Le)}return i.emissiveTexture!==void 0&&o!==ts&&l.push(t.assignTexture(r,"emissiveMap",i.emissiveTexture,Ot)),Promise.all(l).then(function(){const u=new o(r);return i.name&&(u.name=i.name),$e(u,i),t.associations.set(u,{materials:e}),i.extensions&&wt(n,u,i),u})}createUniqueName(e){const t=Ra.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){const t=this,s=this.extensions,n=this.primitiveCache;function i(r){return s[q.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(r,t).then(function(c){return Oo(c,r,t)})}const o=[];for(let r=0,c=e.length;r<c;r++){const l=e[r],h=Yl(l),u=n[h];if(u)o.push(u.promise);else{let d;l.extensions&&l.extensions[q.KHR_DRACO_MESH_COMPRESSION]?d=i(l):d=Oo(new nt,l,t),n[h]={primitive:l,promise:d},o.push(d)}}return Promise.all(o)}loadMesh(e){const t=this,s=this.json,n=this.extensions,i=s.meshes[e],o=i.primitives,r=[];for(let c=0,l=o.length;c<l;c++){const h=o[c].material===void 0?$l(this.cache):this.getDependency("material",o[c].material);r.push(h)}return r.push(t.loadGeometries(o)),Promise.all(r).then(function(c){const l=c.slice(0,c.length-1),h=c[c.length-1],u=[];for(let f=0,p=h.length;f<p;f++){const m=h[f],g=o[f];let v;const w=l[f];if(g.mode===ze.TRIANGLES||g.mode===ze.TRIANGLE_STRIP||g.mode===ze.TRIANGLE_FAN||g.mode===void 0)v=i.isSkinnedMesh===!0?new Ea(m,w):new Te(m,w),v.isSkinnedMesh===!0&&v.normalizeSkinWeights(),g.mode===ze.TRIANGLE_STRIP?v.geometry=Fo(v.geometry,fi):g.mode===ze.TRIANGLE_FAN&&(v.geometry=Fo(v.geometry,gn));else if(g.mode===ze.LINES)v=new Ca(m,w);else if(g.mode===ze.LINE_STRIP)v=new za(m,w);else if(g.mode===ze.LINE_LOOP)v=new La(m,w);else if(g.mode===ze.POINTS)v=new Da(m,w);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+g.mode);Object.keys(v.geometry.morphAttributes).length>0&&Vl(v,i),v.name=t.createUniqueName(i.name||"mesh_"+e),$e(v,i),g.extensions&&wt(n,v,g),t.assignFinalMaterial(v),u.push(v)}for(let f=0,p=u.length;f<p;f++)t.associations.set(u[f],{meshes:e,primitives:f});if(u.length===1)return i.extensions&&wt(n,u[0],i),u[0];const d=new et;i.extensions&&wt(n,d,i),t.associations.set(d,{meshes:e});for(let f=0,p=u.length;f<p;f++)d.add(u[f]);return d})}loadCamera(e){let t;const s=this.json.cameras[e],n=s[s.type];if(!n){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return s.type==="perspective"?t=new gi(Fa.radToDeg(n.yfov),n.aspectRatio||1,n.znear||1,n.zfar||2e6):s.type==="orthographic"&&(t=new Ia(-n.xmag,n.xmag,n.ymag,-n.ymag,n.znear,n.zfar)),s.name&&(t.name=this.createUniqueName(s.name)),$e(t,s),Promise.resolve(t)}loadSkin(e){const t=this.json.skins[e],s=[];for(let n=0,i=t.joints.length;n<i;n++)s.push(this._loadNodeShallow(t.joints[n]));return t.inverseBindMatrices!==void 0?s.push(this.getDependency("accessor",t.inverseBindMatrices)):s.push(null),Promise.all(s).then(function(n){const i=n.pop(),o=n,r=[],c=[];for(let l=0,h=o.length;l<h;l++){const u=o[l];if(u){r.push(u);const d=new Nt;i!==null&&d.fromArray(i.array,l*16),c.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new Pa(r,c)})}loadAnimation(e){const t=this.json,s=this,n=t.animations[e],i=n.name?n.name:"animation_"+e,o=[],r=[],c=[],l=[],h=[];for(let u=0,d=n.channels.length;u<d;u++){const f=n.channels[u],p=n.samplers[f.sampler],m=f.target,g=m.node,v=n.parameters!==void 0?n.parameters[p.input]:p.input,w=n.parameters!==void 0?n.parameters[p.output]:p.output;m.node!==void 0&&(o.push(this.getDependency("node",g)),r.push(this.getDependency("accessor",v)),c.push(this.getDependency("accessor",w)),l.push(p),h.push(m))}return Promise.all([Promise.all(o),Promise.all(r),Promise.all(c),Promise.all(l),Promise.all(h)]).then(function(u){const d=u[0],f=u[1],p=u[2],m=u[3],g=u[4],v=[];for(let b=0,y=d.length;b<y;b++){const x=d[b],S=f[b],_=p[b],M=m[b],T=g[b];if(x===void 0)continue;x.updateMatrix&&x.updateMatrix();const R=s._createAnimationTracks(x,S,_,M,T);if(R)for(let L=0;L<R.length;L++)v.push(R[L])}const w=new Na(i,void 0,v);return $e(w,n),w})}createNodeMesh(e){const t=this.json,s=this,n=t.nodes[e];return n.mesh===void 0?null:s.getDependency("mesh",n.mesh).then(function(i){const o=s._getNodeRef(s.meshCache,n.mesh,i);return n.weights!==void 0&&o.traverse(function(r){if(r.isMesh)for(let c=0,l=n.weights.length;c<l;c++)r.morphTargetInfluences[c]=n.weights[c]}),o})}loadNode(e){const t=this.json,s=this,n=t.nodes[e],i=s._loadNodeShallow(e),o=[],r=n.children||[];for(let l=0,h=r.length;l<h;l++)o.push(s.getDependency("node",r[l]));const c=n.skin===void 0?Promise.resolve(null):s.getDependency("skin",n.skin);return Promise.all([i,Promise.all(o),c]).then(function(l){const h=l[0],u=l[1],d=l[2];d!==null&&h.traverse(function(f){f.isSkinnedMesh&&f.bind(d,Zl)});for(let f=0,p=u.length;f<p;f++)h.add(u[f]);return h})}_loadNodeShallow(e){const t=this.json,s=this.extensions,n=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const i=t.nodes[e],o=i.name?n.createUniqueName(i.name):"",r=[],c=n._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&r.push(c),i.camera!==void 0&&r.push(n.getDependency("camera",i.camera).then(function(l){return n._getNodeRef(n.cameraCache,i.camera,l)})),n._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){r.push(l)}),this.nodeCache[e]=Promise.all(r).then(function(l){let h;if(i.isBone===!0?h=new Oa:l.length>1?h=new et:l.length===1?h=l[0]:h=new vt,h!==l[0])for(let u=0,d=l.length;u<d;u++)h.add(l[u]);if(i.name&&(h.userData.name=i.name,h.name=o),$e(h,i),i.extensions&&wt(s,h,i),i.matrix!==void 0){const u=new Nt;u.fromArray(i.matrix),h.applyMatrix4(u)}else i.translation!==void 0&&h.position.fromArray(i.translation),i.rotation!==void 0&&h.quaternion.fromArray(i.rotation),i.scale!==void 0&&h.scale.fromArray(i.scale);if(!n.associations.has(h))n.associations.set(h,{});else if(i.mesh!==void 0&&n.meshCache.refs[i.mesh]>1){const u=n.associations.get(h);n.associations.set(h,{...u})}return n.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){const t=this.extensions,s=this.json.scenes[e],n=this,i=new et;s.name&&(i.name=n.createUniqueName(s.name)),$e(i,s),s.extensions&&wt(t,i,s);const o=s.nodes||[],r=[];for(let c=0,l=o.length;c<l;c++)r.push(n.getDependency("node",o[c]));return Promise.all(r).then(function(c){for(let h=0,u=c.length;h<u;h++)i.add(c[h]);const l=h=>{const u=new Map;for(const[d,f]of n.associations)(d instanceof Xs||d instanceof Vn)&&u.set(d,f);return h.traverse(d=>{const f=n.associations.get(d);f!=null&&u.set(d,f)}),u};return n.associations=l(i),i})}_createAnimationTracks(e,t,s,n,i){const o=[],r=e.name?e.name:e.uuid,c=[];ct[i.path]===ct.weights?e.traverse(function(d){d.morphTargetInfluences&&c.push(d.name?d.name:d.uuid)}):c.push(r);let l;switch(ct[i.path]){case ct.weights:l=Xn;break;case ct.rotation:l=Zn;break;case ct.translation:case ct.scale:l=Yn;break;default:switch(s.itemSize){case 1:l=Xn;break;case 2:case 3:default:l=Yn;break}break}const h=n.interpolation!==void 0?ql[n.interpolation]:wi,u=this._getArrayFromAccessor(s);for(let d=0,f=c.length;d<f;d++){const p=new l(c[d]+"."+ct[i.path],t.array,u,h);n.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(p),o.push(p)}return o}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){const s=kn(t.constructor),n=new Float32Array(t.length);for(let i=0,o=t.length;i<o;i++)n[i]=t[i]*s;t=n}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(s){const n=this instanceof Zn?Kl:$i;return new n(this.times,this.values,this.getValueSize()/3,s)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function Ql(a,e,t){const s=e.attributes,n=new zs;if(s.POSITION!==void 0){const r=t.json.accessors[s.POSITION],c=r.min,l=r.max;if(c!==void 0&&l!==void 0){if(n.set(new X(c[0],c[1],c[2]),new X(l[0],l[1],l[2])),r.normalized){const h=kn(Ft[r.componentType]);n.min.multiplyScalar(h),n.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const i=e.targets;if(i!==void 0){const r=new X,c=new X;for(let l=0,h=i.length;l<h;l++){const u=i[l];if(u.POSITION!==void 0){const d=t.json.accessors[u.POSITION],f=d.min,p=d.max;if(f!==void 0&&p!==void 0){if(c.setX(Math.max(Math.abs(f[0]),Math.abs(p[0]))),c.setY(Math.max(Math.abs(f[1]),Math.abs(p[1]))),c.setZ(Math.max(Math.abs(f[2]),Math.abs(p[2]))),d.normalized){const m=kn(Ft[d.componentType]);c.multiplyScalar(m)}r.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}n.expandByVector(r)}a.boundingBox=n;const o=new ot;n.getCenter(o.center),o.radius=n.min.distanceTo(n.max)/2,a.boundingSphere=o}function Oo(a,e,t){const s=e.attributes,n=[];function i(o,r){return t.getDependency("accessor",o).then(function(c){a.setAttribute(r,c)})}for(const o in s){const r=An[o]||o.toLowerCase();r in a.attributes||n.push(i(s[o],r))}if(e.indices!==void 0&&!a.index){const o=t.getDependency("accessor",e.indices).then(function(r){a.setIndex(r)});n.push(o)}return Jn.workingColorSpace!==Le&&"COLOR_0"in s&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${Jn.workingColorSpace}" not supported.`),$e(a,e),Ql(a,e,t),Promise.all(n).then(function(){return e.targets!==void 0?jl(a,e.targets,t):a})}const Tt={coupe:{file:"coupe.glb",label:"Coupe",tier:"sports",length:4.3},hatch:{file:"hatch.glb",label:"Hatch",tier:"gt",length:4},sedan:{file:"sedan.glb",label:"Sedan",tier:"gt",length:4.5},estate:{file:"estate.glb",label:"Estate",tier:"gt",length:4.6},taxi:{file:"taxi.glb",label:"Taxi",tier:"gt",length:4.5},rally:{file:"rally.glb",label:"Rally",tier:"sports",length:4.2},patrol:{file:"patrol.glb",label:"Patrol",tier:"sports",length:4.6}},Ds=Object.keys(Tt),Bo=[fe.paintA,fe.paintB,fe.paintC,fe.paintD,fe.paintE,fe.paintF];function eh(a,e){const t=(a||"").toLowerCase();return t.includes("window")||t.includes("glass")?{col:fe.glass,mat:P.METAL}:t.includes("headlight")?{col:fe.head,mat:P.EMIT}:t.includes("taillight")||t.includes("brakelight")?{col:fe.tail,mat:P.EMIT}:t.includes("whitelight")?{col:fe.head,mat:P.EMIT}:t.includes("bluelight")?{col:"#5A8BD6",mat:P.EMIT}:t.includes("black")?{col:fe.tyre,mat:P.MATTE}:t.includes("grey")||t.includes("gray")||t.includes("chrome")||t.includes("metal")?{col:fe.chrome,mat:P.METAL}:t.includes("rust")?{col:fe.trunkShade,mat:P.MATTE}:{col:e,mat:P.MATTE}}const th=a=>{const e=a.replace("#","");return[parseInt(e.slice(0,2),16)/255,parseInt(e.slice(2,4),16)/255,parseInt(e.slice(4,6),16)/255]};let rn=null;const cn=new Map;function sh(){return rn||(rn=new xl),rn}function nh(a){if(cn.has(a))return cn.get(a);const e=new Promise((t,s)=>sh().load(a,n=>t(n),void 0,s));return cn.set(a,e),e}async function Go({car:a="coupe",paint:e=0,base:t="./models/cars/",ghost:s=!1}={}){const n=Tt[a]||Tt.coupe,o=(await nh(t+n.file)).scene.clone(!0),r=Bo[e%Bo.length],c=Nn(s?{ghost:!0,opacity:.85}:{});o.traverse(b=>{if(!b.isMesh)return;const y=Array.isArray(b.material)?b.material[0]:b.material,{col:x,mat:S}=eh(y&&y.name,r),_=th(x),M=b.geometry,T=M.attributes.position.count,R=new Float32Array(T*3),L=new Float32Array(T);for(let A=0;A<T;A++)R[A*3]=_[0],R[A*3+1]=_[1],R[A*3+2]=_[2],L[A]=S;M.setAttribute("vcol",new U(R,3)),M.setAttribute("vmat",new U(L,1)),!M.attributes.nrm&&M.attributes.normal&&M.setAttribute("nrm",M.attributes.normal),M.attributes.nrm||(M.computeVertexNormals(),M.setAttribute("nrm",M.attributes.normal)),b.material=c,b.castShadow=!1,b.receiveShadow=!1});const l=new zs().setFromObject(o),h=new X;l.getSize(h);const u=Math.max(h.x,h.z),d=u>.001?n.length/u:1;o.scale.setScalar(d),o.updateMatrixWorld(!0);const f=new zs().setFromObject(o);o.position.y-=f.min.y;const p=new et;p.name=`car:${a}`,p.add(o);const m=new Map,g=[];o.traverse(b=>{b.isMesh&&/wheel/i.test(b.name||"")&&g.push(b)});for(const b of g){const y=(b.name||"").toLowerCase(),x=y.includes("frontleft")?"fl":y.includes("frontright")?"fr":y.includes("rearleft")?"rl":y.includes("rearright")?"rr":y.includes("front")?"f":"r";m.has(x)||m.set(x,[]),m.get(x).push(b)}const v={steer:[],spin:[],all:[]};for(const[b,y]of m){const x=new zs;for(const L of y)L.updateMatrixWorld(!0),x.expandByObject(L);const S=new X;x.getCenter(S);const _=y[0].parent,M=_.worldToLocal(S.clone()),T=new et;T.name=`wheel:${b}:steer`,T.position.copy(M),_.add(T);const R=new et;R.name=`wheel:${b}:spin`,T.add(R);for(const L of y){const A=L.position.clone().sub(M);R.add(L),L.position.copy(A)}v.all.push(R),v.spin.push(R),(b==="fl"||b==="fr"||b==="f")&&v.steer.push(T)}return{group:p,wheels:v.all,steerNodes:v.steer,source:a,label:n.label,tier:n.tier,setSteer(b){for(const y of v.steer)y.rotation.y=-b},setWheelSpin(b){const y=b%(Math.PI*2);for(const x of v.spin)x.rotation.x=y},setBrakeGlow(){},setLights(){},setBodyRoll(b,y){p.rotation.z=b,p.rotation.x=y},dispose(){o.traverse(b=>{b.isMesh&&b.geometry.dispose()}),c.dispose()}}}const oh=120,As=1/oh,Uo=5,Ho={gt:{name:"Grand Tourer",mass:1520,izz:2600,wheelbase:2.72,track:1.6,cgHeight:.45,weightRear:.5,power:165,peakTorque:235,redline:6800,cdA:1.9,rollPerG:3.4,topSpeed:135,zeroTo100:9.5,ratios:[4.1,2.62,1.9,1.47,1.15,.98],finalDrive:4.1,wheelRadius:.34,drive:"rwd"},sports:{name:"Sports",mass:1450,izz:2300,wheelbase:2.65,track:1.62,cgHeight:.42,weightRear:.53,power:300,peakTorque:370,redline:7200,cdA:1.62,rollPerG:2.5,topSpeed:165,zeroTo100:7,ratios:[3.9,2.5,1.81,1.4,1.1,.93],finalDrive:3.95,wheelRadius:.34,drive:"rwd"},hyper:{name:"Hyper",mass:1400,izz:2150,wheelbase:2.7,track:1.68,cgHeight:.38,weightRear:.56,power:380,peakTorque:405,redline:8200,cdA:1.48,rollPerG:1.7,topSpeed:190,zeroTo100:5.6,ratios:[3.7,2.38,1.77,1.4,1.12,.94],finalDrive:3.9,wheelRadius:.35,drive:"awd"}},te={peakSlipFront:8*Math.PI/180,peakSlipRear:9*Math.PI/180,tailFloor:.55,muLatFront:1.3,muLatRear:1.34,muLongPeak:1.42,peakSlipRatio:.12,awdCap:1.36,speedFadeAt:110,speedFade:.1,downforce:.22,ellipseExp:1.85,liftoffDrop:.06,liftoffHold:.25,liftoffRecover:.6,liftoffMinLatG:.4},G={maxAngle:40*Math.PI/180,minAngle:8*Math.PI/180,taperSpeed:16,taperPow:1.5,comfortG:8.4,attackG:14,minRadius:7,buildBase:2.4,buildBonus:4.2,buildFalloff:18,returnRate:8.5,padRateLimit:900*Math.PI/180,padDeadzone:.04,padSaturation:.95,padCurve:1.5,satGain:.3,satDamping:.55,trailPeak:.9,trailPostPeak:.25,driftLow:12*Math.PI/180,driftBonus:.18,driftYawDamp:1.9,spinYawDamp:4.2,spinAngle:42*Math.PI/180},Zt={throttleUp:1/.25,throttleDown:1/.15,throttleCurve:1.4,brakeUp:1/.12,brakeDown:1/.1},Fe={torque:15500,splitFront:.68,splitFrontDive:.76,absHz:18,absRelease:.3,lockedLatFloor:.35,handbrakeTorque:2200,handbrakeRearMu:.55,handbrakeRecover:.35,handbrakeYawCap:130*Math.PI/180},Ie={shiftTimeAuto:.14,shiftTorqueCut:.25,downshiftHysteresis:900,upshiftAtThrottle:[[0,.38],[.2,.42],[.5,.62],[1,.97]],idleRpm:900,driveLoss:.12},ih=[[0,.42],[.12,.55],[.3,.88],[.55,1],[.8,.95],[1,.8]];function Wo(a,e){if(e<=a[0][0])return a[0][1];for(let t=1;t<a.length;t++)if(e<=a[t][0]){const[s,n]=a[t-1],[i,o]=a[t],r=(e-s)/(i-s||1);return n+(o-n)*r}return a[a.length-1][1]}const re={rollOmega:8.4,rollZeta:.85,pitchOmega:10.5,pitchZeta:.85,divePerG:1.6*Math.PI/180,squatPerG:1*Math.PI/180,rollClamp:5.5*Math.PI/180,pitchClamp:3*Math.PI/180,rollRate:50*Math.PI/180,pitchRate:35*Math.PI/180,loadTauPitch:.12,loadTauRoll:.15},xe={gravity:9.81,extraMin:.1,extraMax:1,extraDelay:.1,extraRamp:.1},xt={restLength:.36,travel:.22,stiffness:42e3,damping:4200},ln={cruise:{counterSteer:.95,stability:.35,tcs:.4,abs:.8,autoGears:!0,lockFloor:10*Math.PI/180,brakeMul:1,airborne:1},sport:{counterSteer:.7,stability:.2,tcs:.2,abs:.6,autoGears:!0,lockFloor:G.minAngle,brakeMul:1,airborne:1},off:{counterSteer:.3,stability:.05,tcs:0,abs:.3,autoGears:!0,lockFloor:G.minAngle,brakeMul:1,airborne:1},hardcore:{counterSteer:0,stability:0,tcs:0,abs:0,autoGears:!1,lockFloor:G.minAngle,brakeMul:.82,airborne:0}},lt={csKeyboard:.85,csGamepad:.45,csLag:.06,csMinSlip:4*Math.PI/180,csMinSpeed:8/3.6,csClamp:.75,stabilityYawGain:1.4},ks={cruise:{behind:6,above:1.85,lookAhead:1,lookHeight:.9,yawTau:.35,velocityBlend:0,fov:64,fovGain:0,stretch:0,rise:0,shake:0},sport:{behind:6.2,above:1.9,lookAhead:1,lookHeight:.9,yawTau:.22,velocityBlend:.62,lookIntoCorner:.18,lookIntoClamp:9*Math.PI/180,springOmega:7.7,springZeta:.85,stretch:1.8,rise:.25,fov:62,fovGain:17,fovPow:.7,fovRate:12*Math.PI/180,fovKick:5,fovKickTau:.6,lateralClamp:.12,pitchRate:20*Math.PI/180,pitchClamp:6*Math.PI/180,shake:.35*Math.PI/180,shakeHz:11,shakeFrom:145/3.6},hood:{behind:-.35,above:1.15,lookAhead:6,lookHeight:1.1,yawTau:.05,velocityBlend:0,fov:58,fovGain:0}},Ko=(a,e)=>_e(Math.round(a),Math.round(e),24301)/4294967296*2-1,Jt=Math.PI*2,ah=.62,rh=1.45;function ch(a,e){return a<=1?Math.sin(Math.PI/2*Math.pow(a,ah)):e+(1-e)*Math.exp(-.125*Math.pow(a-1,rh))}function qo(a,e){const t=Math.abs(a)/e;return Math.sign(a)*ch(t,te.tailFloor)}class lh{constructor({tier:e="sports",terrain:t=null,preset:s="sport"}={}){this.setTier(e),this.terrain=t,this.assist={...ln[s]},this.presetName=s,this.x=0,this.y=0,this.z=0,this.yaw=0,this.roll=0,this.pitch=0,this.vx=0,this.vy=0,this.vz=0,this.yawRate=0,this.steer=0,this.throttle=0,this.brake=0,this.handbrake=0,this.gear=1,this.rpm=Ie.idleRpm,this.reverse=!1,this._shiftTimer=0,this._shiftHold=0,this._absPhase=0,this._liftoff=0,this._liftoffTimer=0,this._airTime=0,this._loadLong=0,this._loadLat=0,this._rollV=0,this._pitchV=0,this._csState=0,this._hbRelease=1,this._acc=0,this._prevSpeed=0,this.speed=0,this.slip=0,this.limit=0,this.wheelSpin=0,this.longAccel=0,this.latAccel=0,this.onGround=!0,this.surfaceKind="ground",this.gripScale=1,this.rough=0,this.wheels=[{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0},{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0},{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0},{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0}]}setTier(e){this.tier=e;const t=Ho[e]||Ho.sports;this.spec=t,this.mass=t.mass,this.izz=t.izz,this.wb=t.wheelbase,this.track=t.track,this.a=t.wheelbase*t.weightRear,this.b=t.wheelbase*(1-t.weightRear),this.muCapAwd=t.drive==="awd"}setPreset(e){ln[e]&&(this.presetName=e,this.assist={...ln[e]})}placeAt(e,t,s=0){this.x=e,this.z=t,this.yaw=s;const n=this.terrain?this.terrain.surface(e,t):null;this.y=(n?n.y:0)+xt.restLength,this.vx=this.vy=this.vz=0,this.yawRate=0,this.gear=1,this.rpm=Ie.idleRpm}maxSteerAngle(e=!1){const t=Math.abs(this.speed),s=G.minAngle+(G.maxAngle-G.minAngle)/(1+Math.pow(t/G.taperSpeed,G.taperPow)),n=e?G.attackG:G.comfortG,i=t>1?Math.atan(this.wb*n/(t*t)):G.maxAngle,o=1-D((t-5)/7),r=Math.atan(this.wb/G.minRadius)*o,c=Math.max(i,r);let l=Math.min(s,c);return l=Math.max(l,this.assist.lockFloor*.35,G.minAngle*.22),Math.abs(this.slip)>G.driftLow&&(l=Math.max(l,s*(1+G.driftBonus))),l}update(e,t){this._acc+=Math.min(e,Uo*As);let s=0;for(;this._acc>=As&&s<Uo;)this._step(As,t),this._acc-=As,s++;return s}_step(e,t){const s=this.assist,n=Math.pow(D(t.throttle),Zt.throttleCurve);this.throttle=ke(this.throttle,n,n>this.throttle?Zt.throttleUp:Zt.throttleDown,e);const i=D(t.brake);this.brake=ke(this.brake,i,i>this.brake?Zt.brakeUp:Zt.brakeDown,e),this.handbrake=D(t.handbrake||0);const o=Math.abs(this.speed);if(t.analogue){const j=G.padRateLimit/G.maxAngle*e,de=K(t.steer,-1,1);this.steer+=K(de-this.steer,-j,j)}else{const j=K(t.steer,-1,1);if(j===0||Math.sign(j)!==Math.sign(this.steer)){const de=G.returnRate*e;if(this.steer+=K(-this.steer,-de,de),j!==0){const Je=(G.buildBase+G.buildBonus/(1+Math.pow(o/G.buildFalloff,2)))*e;this.steer+=K(j-this.steer,-Je,Je)}}else{const de=(G.buildBase+G.buildBonus/(1+Math.pow(o/G.buildFalloff,2)))*e;this.steer+=K(j-this.steer,-de,de)}}this.steer=K(this.steer,-1,1);const r=Math.cos(this.yaw),c=Math.sin(this.yaw);let l=this.vz*r+this.vx*c,h=this.vx*r-this.vz*c;this.speed=l;const u=Math.hypot(l,h);this.slip=u>.6?Math.atan2(h,Math.abs(l)+.001):0;let d=this.steer*this.maxSteerAngle(!!t.attack);const f=s.counterSteer*(t.analogue?lt.csGamepad:lt.csKeyboard)*1.18;if(f>0&&Math.abs(this.slip)>lt.csMinSlip&&u>lt.csMinSpeed){const j=K(this.slip*f,-.75*this.maxSteerAngle(),lt.csClamp*this.maxSteerAngle());this._csState=ke(this._csState,j,1/lt.csLag,e)}else this._csState=ke(this._csState,0,1/lt.csLag,e);d=K(d+this._csState,-this.maxSteerAngle()*1.35,this.maxSteerAngle()*1.35),this.steerAngle=d;const p=this.terrain?this.terrain.surface(this.x,this.z):null,m=p?p.y:0;this.surfaceKind=p?p.surfaceKind:"ground",this.gripScale=p?p.grip:1;const g=p?p.nx:0,v=p?Math.max(p.ny,.2):1,w=p?p.nz:0;this.slopeAngle=Math.acos(Math.min(1,v));const b=Math.cos(this.yaw),y=Math.sin(this.yaw),x=xe.gravity*v*(g*y+w*b),S=xe.gravity*v*(g*b-w*y),_=D((this.slopeAngle-.42)/.34);this.gripScale*=1-.85*_;const M=m+xt.restLength,R=this.y-M>.06;this.onGround=!R;let L=xe.gravity;if(R){if(this._airTime+=e,s.airborne>0&&this._airTime>xe.extraDelay){const j=D((this._airTime-xe.extraDelay)/xe.extraRamp);L+=xe.gravity*F(xe.extraMin,xe.extraMax,j)*s.airborne}this.vy-=L*e}else{this._airTime=0;const j=K(M-this.y,-.22,xt.travel),de=xt.stiffness*4*j/this.mass,Je=xt.damping*4*-this.vy/this.mass;this.vy+=(de+Je-L)*e,this.vy>2&&(this.vy=2)}this.y+=this.vy*e,this.y<M-xt.travel&&(this.y=M-xt.travel,this.vy<0&&(this.vy=0));const A=K(this.longAccel/xe.gravity,-1.2,1.2),k=K(this.latAccel/xe.gravity,-1.5,1.5);this._loadLong=ke(this._loadLong,A,1/re.loadTauPitch,e),this._loadLat=ke(this._loadLat,k,1/re.loadTauRoll,e);const z=this.mass*xe.gravity+(R?0:te.downforce*u*u),N=this.spec.cgHeight/this.wb;let H=z*(this.b/this.wb)-z*N*this._loadLong,B=z-H;H=Math.max(H,z*.08),B=Math.max(B,z*.08);const $=R?0:1,se=u>.5?Math.atan2(h+this.yawRate*this.a,Math.abs(l)+.001)-d:0,C=u>.5?Math.atan2(h-this.yawRate*this.b,Math.abs(l)+.001):0;if(this.throttle<.12&&Math.abs(this.latAccel)>te.liftoffMinLatG*xe.gravity&&this._liftoffTimer<=0&&(this._liftoffTimer=te.liftoffHold+te.liftoffRecover),this._liftoffTimer>0){this._liftoffTimer-=e;const j=this._liftoffTimer>te.liftoffRecover;this._liftoff=j?te.liftoffDrop:te.liftoffDrop*D(this._liftoffTimer/te.liftoffRecover)}else this._liftoff=0;this.handbrake>.01?this._hbRelease=0:this._hbRelease=D(this._hbRelease+e/Fe.handbrakeRecover);const O=1-Math.pow(1-this._hbRelease,3),V=F(Fe.handbrakeRearMu,1,this.handbrake>.01?0:O),ie=1-te.speedFade*Math.min(u/te.speedFadeAt,1),ee=this.muCapAwd?te.awdCap:1e9,ne=Math.min(te.muLatFront,ee)*this.gripScale*ie,ue=Math.min(te.muLatRear,ee)*this.gripScale*ie*(1-this._liftoff)*V;let we=-qo(se,te.peakSlipFront)*ne*H*$,Be=-qo(C,te.peakSlipRear)*ue*B*$;const Y=this.spec,Ge=Y.ratios[this.gear-1]*Y.finalDrive,Ue=l/Y.wheelRadius;let ms=Math.abs(Ue)*Ge*(60/Jt);if(this.rpm=K(Math.max(ms,Ie.idleRpm),Ie.idleRpm,Y.redline*1.02),this._shiftTimer>0&&(this._shiftTimer-=e),this._shiftHold>0&&(this._shiftHold-=e),s.autoGears&&this._shiftTimer<=0&&this._shiftHold<=0&&!this.reverse){const j=Wo(Ie.upshiftAtThrottle,this.throttle)*Y.redline;if(this.throttle>.06&&this.rpm>j&&this.gear<Y.ratios.length)this.gear++,this._shiftTimer=Ie.shiftTimeAuto,this._shiftHold=.5;else if(this.gear>1){const de=Y.ratios[this.gear-2]*Y.finalDrive,Je=Math.abs(Ue)*de*(60/Jt),gs=this.rpm<Ie.idleRpm+Ie.downshiftHysteresis*.9,Vs=this.throttle<.05&&Je<Y.redline*.7;Je<Y.redline*.92&&(gs||Vs)&&(this.gear--,this._shiftTimer=Ie.shiftTimeAuto,this._shiftHold=.5)}}const Kt=this._shiftTimer>0?Ie.shiftTorqueCut:1,qt=D(this.rpm/Y.redline),I=this.rpm>=Y.redline?.15:1;let ae=Y.peakTorque*Wo(ih,qt)*this.throttle*Kt*I*Ge/Y.wheelRadius*(1-Ie.driveLoss);Math.abs(l)<.6&&this.brake>.35&&this.throttle<.05?this.reverse=!0:this.throttle>.15&&l>-.2&&(this.reverse=!1),this.reverse&&(ae=-Math.max(Math.abs(ae),this.brake*2600)*.5);const $s=Y.drive==="awd"?z:B,gt=te.muLongPeak*this.gripScale*$s;s.tcs>0&&Math.abs(ae)>gt&&(ae-=Math.sign(ae)*(Math.abs(ae)-gt)*s.tcs);const it=gt*1.15;Math.abs(ae)>it&&(ae=Math.sign(ae)*it);const at=Y.topSpeed/3.6;l>at-4.2&&(ae*=D((at-l)/4.2));const vs=gt>1?K(ae/gt,-3,3)*te.peakSlipRatio:0;let $t=0;if(this.brake>.001&&u>.2){F(Fe.splitFront,Fe.splitFrontDive,D(-this._loadLong));let j=Fe.torque*this.brake*s.brakeMul;if(s.abs>0){const Je=j/Y.wheelRadius,gs=te.muLongPeak*this.gripScale*z;if(Je>gs){this._absPhase+=e*Fe.absHz*Jt;const Vs=1-Fe.absRelease*(.5+.5*Math.sin(this._absPhase))*s.abs;j=Math.min(j,gs*Y.wheelRadius*1.02)*Vs}}$t=-Math.sign(l)*(j/Y.wheelRadius);const de=D(1-s.abs)*D(this.brake*1.4-.5);de>0&&(we*=F(1,Fe.lockedLatFloor,de))}this.handbrake>.01&&u>.2&&($t+=-Math.sign(l)*(Fe.handbrakeTorque*this.handbrake/Y.wheelRadius));const Se=(ae+$t)*$,Ze=te.muLongPeak*this.gripScale*z,Zi=Math.pow(Math.min(Math.abs(Se)/Math.max(Ze,1),1),te.ellipseExp),Gn=Math.pow(Math.max(1-Zi,.04),1/te.ellipseExp);we*=Gn,Be*=Gn;const Ji=.5*1.225*Y.cdA*l*Math.abs(l),jt=p?p.onRoad:1,Qi=F(.145,.014,D(jt))*this.mass*xe.gravity*Math.sign(l)+F(9.5,1.4,D(jt))*l,ea=this._shiftTimer>0?0:(1-this.throttle)*95*(.3+.7*qt)*(Ge/Y.wheelRadius)*Math.sign(l)*$;if($&&jt<.6){const j=1-jt,de=Ko(this.x*.31,this.z*.31)*.6+Ko(this.x*1.13+11.7,this.z*1.13-4.2)*.4;this.vy+=de*j*Math.min(u,24)*.055*e*60,we*=1-.34*j,Be*=1-.28*j,this.rough=j}else this.rough=0;const ta=F(27.8,200,D(jt*1.4));$&&l>ta&&(ae=Math.min(ae,0));const sa=Se-Ji-Qi-ea,na=(we*Math.cos(d)+Be)*1,Un=sa/this.mass+this.yawRate*h+x*$,Hn=na/this.mass-this.yawRate*l+S*$;l+=Un*e,h+=Hn*e;let js=we*Math.cos(d)*this.a-Be*this.b;if(s.stability>0&&u>3){const j=l/Math.max(this.wb,.1)*Math.tan(d);js-=(this.yawRate-j)*this.izz*lt.stabilityYawGain*s.stability}const Wn=Math.abs(this.slip);if(Wn>G.driftLow){const j=Wn>G.spinAngle?G.spinYawDamp:G.driftYawDamp;js-=this.yawRate*this.izz*j}this.handbrake>.01&&(this.yawRate=K(this.yawRate,-Fe.handbrakeYawCap,Fe.handbrakeYawCap)),this.yawRate+=js/this.izz*e*$;const Kn=(ne*H+ue*B)/this.mass/Math.max(u,4)*1.35,qn=Math.abs(this.yawRate);if($&&qn>Kn){const j=1-Math.exp(-7.5*e);this.yawRate-=Math.sign(this.yawRate)*(qn-Kn)*j}const oa=F(G.trailPeak,G.trailPostPeak,D(Math.abs(se)/te.peakSlipFront-1));this.yawRate-=this.yawRate*G.satDamping*G.satGain*oa*e,u<.25&&this.throttle<.02&&Math.abs(x)<.55&&(l*=.9,h*=.9,this.yawRate*=.85),this.yaw+=this.yawRate*e,this.yaw>Math.PI?this.yaw-=Jt:this.yaw<-Math.PI&&(this.yaw+=Jt);const $n=Math.cos(this.yaw),jn=Math.sin(this.yaw);this.vz=l*$n-h*jn,this.vx=l*jn+h*$n,this.x+=this.vx*e,this.z+=this.vz*e,this.longAccel=Un,this.latAccel=Hn,this.speed=l;const ia=K(-this._loadLat*this.spec.rollPerG,-re.rollClamp,re.rollClamp),aa=K(this._loadLong>0?-this._loadLong*re.squatPerG:-this._loadLong*re.divePerG,-re.pitchClamp,re.pitchClamp),ra=(ia-this.roll)*re.rollOmega*re.rollOmega-this._rollV*2*re.rollZeta*re.rollOmega;this._rollV=K(this._rollV+ra*e,-re.rollRate,re.rollRate),this.roll+=this._rollV*e;const ca=(aa-this.pitch)*re.pitchOmega*re.pitchOmega-this._pitchV*2*re.pitchZeta*re.pitchOmega;this._pitchV=K(this._pitchV+ca*e,-re.pitchRate,re.pitchRate),this.pitch+=this._pitchV*e,this.limit=D(Math.max(Math.abs(se)/te.peakSlipFront,Math.abs(C)/te.peakSlipRear,Math.abs(vs)/te.peakSlipRatio)),this.wheelSpin+=l/Y.wheelRadius*e,this.wheels[0].slipAngle=se,this.wheels[1].slipAngle=se,this.wheels[2].slipAngle=C,this.wheels[3].slipAngle=C,this.wheels[0].load=this.wheels[1].load=H*.5,this.wheels[2].load=this.wheels[3].load=B*.5}get kph(){return Math.abs(this.speed)*3.6}groundTilt(){if(!this.terrain)return{pitch:0,roll:0};const e=Math.cos(this.yaw),t=Math.sin(this.yaw),s=this.track*.5,n=this.x+t*this.a,i=this.z+e*this.a,o=this.x-t*this.b,r=this.z-e*this.b,c=this.terrain.height(n,i),l=this.terrain.height(o,r),h=this.terrain.height(this.x-e*s,this.z+t*s),u=this.terrain.height(this.x+e*s,this.z-t*s);return{pitch:Math.atan2(c-l,this.wb),roll:Math.atan2(u-h,this.track)}}}const $o={steerLeft:["KeyA","ArrowLeft"],steerRight:["KeyD","ArrowRight"],throttle:["KeyW","ArrowUp"],brake:["KeyS","ArrowDown"],handbrake:["Space"],shiftUp:["KeyE","ShiftRight"],shiftDown:["KeyQ"],camera:["KeyC"],reset:["KeyR","KeyT"],reverse:["KeyB"],nextCar:["KeyV"],radio:["KeyN"],autodrive:["KeyG"],horn:["KeyH"],fine:["ShiftLeft"],attack:["ControlLeft"]};class hh{constructor(e=window){this.keys=new Set,this.pressed=new Set,this.analogue=!1,this.padIndex=null,this._lastDevice="keyboard",this._deviceSince=0,this.state={steer:0,throttle:0,brake:0,handbrake:0,analogue:!1,fine:!1,attack:!1},this._onDown=t=>{t.repeat||(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(t.code)&&t.preventDefault(),this.keys.add(t.code),this.pressed.add(t.code))},this._onUp=t=>this.keys.delete(t.code),this._onBlur=()=>this.keys.clear(),e.addEventListener("keydown",this._onDown,{passive:!1}),e.addEventListener("keyup",this._onUp),e.addEventListener("blur",this._onBlur),e.addEventListener("gamepadconnected",t=>{this.padIndex=t.gamepad.index}),e.addEventListener("gamepaddisconnected",()=>{this.padIndex=null}),this._target=e,this.touch={steer:0,throttle:0,brake:0,active:!1}}tapped(e){const t=$o[e]||[];for(const s of t)if(this.pressed.has(s))return!0;return!1}held(e){const t=$o[e]||[];for(const s of t)if(this.keys.has(s))return!0;return!1}poll(){const e=this.state;let t=(this.held("steerLeft")?1:0)-(this.held("steerRight")?1:0),s=this.held("throttle")?1:0,n=this.held("brake")?1:0,i=this.held("handbrake")?1:0,o=0,r=0,c=0,l=0,h=!1;const u=navigator.getGamepads?navigator.getGamepads():[];for(const d of u){if(!d||!d.connected)continue;h=!0;const f=-(d.axes[0]||0),p=Math.abs(f);if(p>G.padDeadzone){const m=D((p-G.padDeadzone)/(G.padSaturation-G.padDeadzone));o=Math.sign(f)*Math.pow(m,G.padCurve)}r=d.buttons[7]?d.buttons[7].value:0,c=d.buttons[6]?d.buttons[6].value:0,l=d.buttons[0]&&d.buttons[0].pressed?1:0;break}return e.steer=Math.abs(o)>Math.abs(t)?o:t,this.touch.active&&Math.abs(this.touch.steer)>Math.abs(e.steer)&&(e.steer=this.touch.steer),e.throttle=Math.max(s,r,this.touch.throttle),e.brake=Math.max(n,c,this.touch.brake),e.handbrake=Math.max(i,l),e.analogue=h&&Math.abs(o)>=Math.abs(t)&&Math.abs(o)>.001,this.touch.active&&(e.analogue=!0),e.fine=this.held("fine"),e.attack=this.held("attack"),e.fine&&(e.throttle=Math.min(e.throttle,.45),e.steer*=.6),e.attack&&(e.steer=K(e.steer*1.25,-1,1)),e}endFrame(){this.pressed.clear()}attachTouch(e){const t=()=>e.getBoundingClientRect(),s=n=>{const i=t();let o=0,r=0,c=0,l=!1;for(const h of n.touches){l=!0;const u=(h.clientX-i.left)/i.width,d=(h.clientY-i.top)/i.height;u<.5?o=K(-(u/.5-.5)*2.4,-1,1):d>.55?c=1:r=1}this.touch.active=l,this.touch.steer=l?o:0,this.touch.throttle=r,this.touch.brake=c,l&&n.preventDefault()};e.addEventListener("touchstart",s,{passive:!1}),e.addEventListener("touchmove",s,{passive:!1}),e.addEventListener("touchend",s,{passive:!1}),e.addEventListener("touchcancel",s,{passive:!1})}dispose(){this._target.removeEventListener("keydown",this._onDown),this._target.removeEventListener("keyup",this._onUp),this._target.removeEventListener("blur",this._onBlur)}}const hn=["cruise","sport","hood"];class uh{constructor(e,{mode:t="cruise"}={}){this.camera=e,this.mode=t,this.yaw=0,this.px=0,this.py=0,this.pz=0,this.vxs=0,this.vys=0,this.vzs=0,this.fov=ks.cruise.fov,this.pitch=0,this._kick=0,this._shakeT=0,this._first=!0,this._lookX=0,this._lookY=0,this._lookZ=0}cycle(){return this.mode=hn[(hn.indexOf(this.mode)+1)%hn.length],this.mode}update(e,t,s){const n=ks[this.mode]||ks.cruise,i=Math.abs(e.speed),o=D(i/(250/3.6));let r=e.yaw;if(n.velocityBlend>0&&i>3){const _=Math.atan2(e.vx,e.vz);r=e.yaw+Ns(e.yaw,_)*n.velocityBlend}if(n.lookIntoCorner){const _=K(n.lookIntoCorner*e.steer*e.maxSteerAngle()*4,-n.lookIntoClamp,n.lookIntoClamp);r+=_}this.yaw=this._first?r:br(this.yaw,r,1/n.yawTau,t);const c=n.behind+(n.stretch||0)*o,l=n.above+(n.rise||0)*o,h=Math.sin(this.yaw),u=Math.cos(this.yaw);let d=e.x-h*c,f=e.z-u*c,p=e.y+l;if(this._first)this.px=d,this.py=p,this.pz=f,this._first=!1;else if(n.springOmega){const _=n.springOmega,M=n.springZeta,T=(R,L,A)=>{const k=(A-R)*_*_-L*2*M*_,z=L+k*t;return[R+z*t,z]};[this.px,this.vxs]=T(this.px,this.vxs,d),[this.py,this.vys]=T(this.py,this.vys,p),[this.pz,this.vzs]=T(this.pz,this.vzs,f)}else this.px=ke(this.px,d,6.5,t),this.py=ke(this.py,p,6.5,t),this.pz=ke(this.pz,f,6.5,t);if(n.lateralClamp){const _=e.x-this.px,M=e.z-this.pz,T=_*u-M*h,R=n.lateralClamp*c*2;if(Math.abs(T)>R*.75){const L=(Math.abs(T)-R*.75)/(R*.25),A=D(L),k=A*A*(3-2*A),z=Math.sign(T)*(Math.abs(T)-R*.75)*k;this.px+=u*z,this.pz-=h*z}}if(s){let _=s(this.px,this.pz);for(let M=1;M<=4;M++){const T=M/5,R=this.px+(e.x-this.px)*T,L=this.pz+(e.z-this.pz)*T,A=s(R,L),k=A+1.2-(e.y+n.above-A)*0;k>_&&(_=k)}this.py<_+1.2&&(this.py=_+1.2)}const m=e.x+Math.sin(e.yaw)*n.lookAhead,g=e.z+Math.cos(e.yaw)*n.lookAhead,v=e.y+n.lookHeight;this._lookX=ke(this._lookX||m,m,14,t),this._lookY=ke(this._lookY||v,v,10,t),this._lookZ=ke(this._lookZ||g,g,14,t);let w=n.fov;n.fovGain&&(w=n.fov+n.fovGain*Math.pow(o,n.fovPow),e.longAccel>.5*9.81&&(this._kick=5),this._kick=ke(this._kick,0,1/ks.sport.fovKickTau,t),w+=this._kick);const b=12*t;this.fov+=K(w-this.fov,-b,b);let y=0,x=0;if(n.shake&&i>n.shakeFrom){this._shakeT+=t*n.shakeHz*Math.PI*2;const _=n.shake*D((i-n.shakeFrom)/30)*(.6+.8*e.limit);y=Math.sin(this._shakeT)*_,x=Math.sin(this._shakeT*1.37+1.1)*_*.6}const S=this.camera;return S.position.set(this.px,this.py,this.pz),S.up.set(Math.sin(y)*.06,1,0),S.lookAt(this._lookX+y*8,this._lookY+x*8,this._lookZ),Math.abs(S.fov-this.fov)>.01&&(S.fov=this.fov,S.updateProjectionMatrix()),o}reset(){this._first=!0,this.vxs=this.vys=this.vzs=0}}const jo=42;class dh{constructor({cruise:e=22}={}){this.on=!1,this.cruise=e,this.lastReason="",this._lostFor=0}toggle(e){return this.on=!this.on,this._lostFor=0,this.on&&(this.cruise=Math.max(14,Math.min(Math.abs(e?.speed||0)||22,30))),this.on}off(e=""){return this.on?(this.on=!1,this.lastReason=e,!0):!1}update(e,t,s){if(!this.on)return null;if(Math.abs(t.steer)>.12||t.brake>.15||t.throttle>.5||t.handbrake>.1)return this.off("you took over"),null;const n=e.terrain;if(!n)return null;const i=n.roads.query(e.x,e.z);if(!isFinite(i.d)||i.d>i.width*2.2+14)return this._lostFor+=s,this._lostFor>4&&this.off("lost the road"),{steer:0,throttle:0,brake:.35,handbrake:0,analogue:!0,auto:!0};this._lostFor=0;let o=i.tx,r=i.tz;Math.sin(e.yaw)*o+Math.cos(e.yaw)*r<0&&(o=-o,r=-r);const c=(e.x-i.qx)*r-(e.z-i.qz)*o;let l=Math.atan2(o,r)-e.yaw;for(;l>Math.PI;)l-=Math.PI*2;for(;l<-Math.PI;)l+=Math.PI*2;const h=Math.max(Math.abs(e.speed),6),u=Math.atan2(.55*c,h),d=K((l*1.15+u)*1.6,-1,1),f=e.x+Math.sin(e.yaw)*jo,p=e.z+Math.cos(e.yaw)*jo,m=n.roads.query(f,p);let g=0;if(isFinite(m.d)){let x=m.tx,S=m.tz;x*o+S*r<0&&(x=-x,S=-S);let _=Math.atan2(x,S)-Math.atan2(o,r);for(;_>Math.PI;)_-=Math.PI*2;for(;_<-Math.PI;)_+=Math.PI*2;g=Math.abs(_)}const v=F(this.cruise,7,D(g/.7)),w=Math.abs(e.speed),b=w<v?D((v-w)/5):0,y=w>v+3?D((w-v-3)/7)*.55:0;return{steer:d,throttle:b,brake:y,handbrake:0,analogue:!0,auto:!0}}}const fh=.45,Rs=.55,ph=8,Qt=[{at:0,mul:1,label:null},{at:1e3,mul:1.25,label:"a kilometre without leaving the road"},{at:2500,mul:1.5,label:"two and a half"},{at:5e3,mul:2,label:"five kilometres. settling in"},{at:1e4,mul:2.75,label:"ten. the road is yours"},{at:2e4,mul:3.5,label:"twenty kilometres"},{at:4e4,mul:4.5,label:"forty. still going"},{at:8e4,mul:6,label:"eighty kilometres without a wheel off"}];function mh(a){const e=a*3.6;return e<30?0:.35+.85*Math.pow(D((e-30)/220),.72)}class vh{constructor({storageKey:e="wanderoad.streak.v1"}={}){this.storageKey=e,this.distance=0,this.score=0,this.total=0,this.best=0,this.bestScore=0,this.multiplier=1,this.onRoad=!1,this.tier=0,this._off=0,this._announced=0,this._events=[],this._lastBreakAt=0,this.load()}load(){try{const e=localStorage.getItem(this.storageKey);if(!e)return;const t=JSON.parse(e);this.total=+t.total||0,this.best=+t.best||0,this.bestScore=+t.bestScore||0}catch{}}save(){try{localStorage.setItem(this.storageKey,JSON.stringify({total:this.total,best:this.best,bestScore:this.bestScore}))}catch{}}get state(){return{distance:this.distance,km:this.distance/1e3,score:this.score,total:this.total,best:this.best,bestScore:this.bestScore,multiplier:this.multiplier,onRoad:this.onRoad,grace:this._off>0&&this._off<Rs,graceLeft:Math.max(0,Rs-this._off),tier:this.tier}}drain(){return this._events.length?this._events.shift():null}update(e,t,s){const n=Math.abs(t.speed||0),i=(s?s.onRoad:0)>=fh&&t.onGround!==!1;if(this.onRoad=i,!i){this._off+=e,t.onGround===!1&&(this._off=Math.min(this._off,Rs*.4)),this._off>=Rs&&(this.distance>250&&this._events.push({kind:"break",distance:this.distance,score:this.score}),this._commit());return}if(this._off=0,n<ph)return;const o=n*e;this.distance+=o;let r=0;for(let d=Qt.length-1;d>=0;d--)if(this.distance>=Qt[d].at){r=d;break}this.tier=r;const c=Qt[r],l=Qt[Math.min(r+1,Qt.length-1)],h=Math.max(l.at-c.at,1),u=D((this.distance-c.at)/h);this.multiplier=F(c.mul,l.mul,u*.6),r>this._announced&&(this._announced=r,c.label&&this._events.push({kind:"milestone",text:c.label,distance:this.distance})),this.score+=o*mh(n)*this.multiplier*.1}_commit(){this.distance>this.best&&(this.best=this.distance),this.score>this.bestScore&&(this.bestScore=this.score),this.total+=this.score,this.save(),this.distance=0,this.score=0,this.multiplier=1,this.tier=0,this._announced=0,this._off=0}flush(){this.distance>0?this._commit():this.save()}}function gh(a){return a<1e3?String(Math.floor(a)):a<1e5?(a/1e3).toFixed(1)+"k":Math.round(a/1e3)+"k"}function un(a){return a<1e3?`${Math.round(a)} m`:`${(a/1e3).toFixed(a<1e4?2:1)} km`}const mt={cruiser:{label:"Cruiser",blurb:"Calm and planted. Full stick is 0.7 g, the camera never moves in a hurry. This is the cozy default.",comfortG:7,assist:"cruise",camera:"cruise",rearGrip:1.04,buildRate:1.6,tier:"gt",car:"estate"},road:{label:"Road",blurb:"The default. A fast road car: 0.96 g at full stick, sport aids, the chase camera looks into the corner.",comfortG:9.4,assist:"sport",camera:"sport",rearGrip:1,buildRate:2,tier:"sports",car:"coupe"},sharp:{label:"Sharp",blurb:"More lock, faster hands. 1.25 g at full stick and a quicker steering ramp — quick, still not twitchy.",comfortG:12.2,assist:"sport",camera:"sport",rearGrip:.98,buildRate:3.2,tier:"sports",car:"rally"},drift:{label:"Drift",blurb:"Loose rear end and a lot of lock. Made for holding a slide, not for lap times.",comfortG:13.5,assist:"off",camera:"sport",rearGrip:.86,buildRate:3.6,tier:"sports",car:"sedan"},sim:{label:"Raw",blurb:"No assists at all, no comfort limit — the full 40° rack, tapered only by speed. Hard.",comfortG:40,assist:"hardcore",camera:"sport",rearGrip:1,buildRate:4,tier:"sports",car:"coupe"},hyper:{label:"Hyper",blurb:"All-wheel drive, 800 hp, 340 km/h. Planted at speed, and quick enough to need the calm camera.",comfortG:10.5,assist:"sport",camera:"sport",rearGrip:1.02,buildRate:2.2,tier:"hyper",car:"patrol"}},St={meadow:{label:"Meadow",blurb:"The pen’s own valley. Soft rolling hills, wide sightlines, nothing you cannot drive over.",amp:.8,wave:1.25,bias:[2.2,1,.35,.3,.8]},rolling:{label:"Rolling",blurb:"The default mix. Meadow and steppe with hills and the occasional mountain on the horizon.",amp:1,wave:1,bias:[1,1,1,1,1]},alpine:{label:"Alpine",blurb:"Mountains close in. Switchbacks, cuttings and long climbs — the most dramatic and the least forgiving.",amp:1.35,wave:.9,bias:[.6,.5,3,.2,.5]},plains:{label:"Plains",blurb:"Almost flat. Kilometres of straight road under a huge sky — the best place to feel top speed.",amp:.45,wave:1.6,bias:[.8,3,.15,1.2,.7]},dunes:{label:"Dunes",blurb:"Rose and ochre sand sea. Loose grip, long crests, the road half-buried.",amp:.9,wave:1.1,bias:[.3,.9,.2,3.5,.2]},marsh:{label:"Wetland",blurb:"Flooded reed flats under standing mist. Dead flat, causeways and mirrors.",amp:.7,wave:1.2,bias:[.7,.3,.2,.1,3.5]}};function ji(a){const e=mt[a]||mt.road;return G.comfortG=e.comfortG,G.attackG=e.comfortG*1.6,G.buildBase=e.buildRate,G.buildBonus=e.buildRate,te.muLatRear=1.34*e.rearGrip,e}function wh(a){const e=St[a]||St.rolling;je.__base||(je.__base=je.map(s=>({...s})));const t=je.__base;for(let s=0;s<je.length;s++)je[s].amp=t[s].amp*e.amp*(e.bias[s]>1,1),je[s].wave=t[s].wave*e.wave;return e}function xh(a){return(St[a]||St.rolling).bias}function bh(a=location.search){const e=new URLSearchParams(a),t=mt[e.get("feel")]?e.get("feel"):"road",s=St[e.get("terrain")]?e.get("terrain"):"rolling";return{feel:t,terrain:s,debug:e.has("debug"),offline:e.has("offline")}}const yh=.02,_h=4;class Mh{constructor({cell:e=64}={}){this.cell=e,this.grid=new Map,this.byChunk=new Map,this.lastHit=null}_key(e,t){return`${Math.floor(e/this.cell)},${Math.floor(t/this.cell)}`}addChunk(e,t){if(this.byChunk.has(e)&&this.removeChunk(e),!(!t||!t.length)){this.byChunk.set(e,t);for(const s of t){const n=this._key(s.x,s.z);let i=this.grid.get(n);i||(i=[],this.grid.set(n,i)),i.push(s)}}}removeChunk(e){const t=this.byChunk.get(e);if(t){for(const s of t){const n=this._key(s.x,s.z),i=this.grid.get(n);if(!i)continue;const o=i.indexOf(s);o>=0&&i.splice(o,1),i.length||this.grid.delete(n)}this.byChunk.delete(e)}}clear(){this.grid.clear(),this.byChunk.clear()}get count(){let e=0;for(const t of this.byChunk.values())e+=t.length;return e}resolve(e,t=1.05,s=1/60){const n=Math.floor(e.x/this.cell),i=Math.floor(e.z/this.cell);let o=null;for(let r=-1;r<=1;r++)for(let c=-1;c<=1;c++){const l=this.grid.get(`${n+c},${i+r}`);if(l)for(const h of l){const u=e.x-h.x,d=e.z-h.z,f=h.r+t,p=u*u+d*d;if(p>=f*f||h.h&&e.y-.4>h.y+h.h)continue;const m=Math.sqrt(p)||1e-4,g=f-m;if(g<yh)continue;const v=u/m,w=d/m;e.x+=v*g,e.z+=w*g;const b=e.vx*v+e.vz*w;if(b<0){const y=Math.hypot(e.vx,e.vz),x=e.vx-b*v,S=e.vz-b*w,_=D(-b/Math.max(y,.001)),M=h.kind==="rock"?.18:.06,T=1-.55*_;e.vx=x*T-b*v*M,e.vz=S*T-b*w*M,e.yawRate*=1-.6*_,y>_h&&(!o||_*y>o.severity*o.speed)&&(o={kind:h.kind,speed:y,severity:_,x:h.x,z:h.z})}}}return this.lastHit=o,o}}function Th(a,e){const t=[];if(!a)return t;const s=(n,i,o,r)=>{if(n)for(const c of n)t.push({x:c.x,z:c.z,y:c.y!==void 0?c.y:0,r:o(c),h:r(c),kind:i})};return s(a.trees,"tree",n=>.28+.22*(n.scale||1),n=>6*(n.scale||1)),s(a.rocks,"rock",n=>.7*(n.scale||1),n=>1.6*(n.scale||1)),s(a.posts,"post",()=>.16,()=>1.6),t}class Sh{constructor(){this.root=document.getElementById("hud"),this.kph=document.getElementById("kph"),this.gear=document.getElementById("gear"),this.biome=document.getElementById("biome"),this.coords=document.getElementById("coords"),this.players=document.getElementById("players"),this.toast=document.getElementById("toast"),this.streakEl=document.createElement("div"),this.streakEl.id="streak",this.streakEl.innerHTML='<span id="streakKm">—</span><span id="streakMul"></span><span id="streakPts"></span>',this.root.appendChild(this.streakEl),this.streakKm=this.streakEl.querySelector("#streakKm"),this.streakMul=this.streakEl.querySelector("#streakMul"),this.streakPts=this.streakEl.querySelector("#streakPts"),this._toastT=0,this._lastGear=null,this._lastBiome=-1,this._shownKm=0}say(e,t=3.6){this.toast.textContent=e,this.toast.classList.add("show"),this._toastT=t}update(e,{car:t,streak:s,surface:n,remotes:i,netState:o}){const r=Math.round(t.kph);this.kph.textContent=r;const c=t.reverse?"R":Math.abs(t.speed)<.6?"N":String(t.gear);c!==this._lastGear&&(this.gear.textContent=c,this._lastGear=c),n&&n.dominant!==this._lastBiome&&(this._lastBiome=n.dominant,this.biome.textContent=yn[n.dominant],this.say(yn[n.dominant],2.8)),this.coords.textContent=`${Math.round(t.x)}, ${Math.round(t.z)}`;const l=s.state;l.distance>0?(this.streakEl.classList.add("live"),this.streakEl.classList.toggle("grace",l.grace),this._shownKm+=(l.km-this._shownKm)*Math.min(1,e*9),this.streakKm.textContent=un(this._shownKm*1e3),this.streakMul.textContent=l.multiplier>1.02?`×${l.multiplier.toFixed(2)}`:"",this.streakPts.textContent=l.score>5?gh(l.score):""):(this.streakEl.classList.remove("live","grace"),this._shownKm=0,this.streakKm.textContent=l.best>0?`best ${un(l.best)}`:"",this.streakMul.textContent="",this.streakPts.textContent="");const h=s.drain();if(h&&(h.kind==="milestone"?this.say(h.text,3.2):h.kind==="break"&&this.say(`${un(h.distance)} — streak ended`,3)),i){const u=i.list?i.list():[];u.length?this.players.innerHTML=u.slice(0,6).map(d=>`<div>${Ah(d.name)} <span class="dist">${Math.round(d.dist)} m</span></div>`).join(""):this.players.childNodes.length&&(this.players.innerHTML="")}o&&o!==this._lastNet&&(this._lastNet=o,this.root.dataset.net=o),this._toastT>0&&(this._toastT-=e,this._toastT<=0&&this.toast.classList.remove("show"))}}function Ah(a){return String(a).replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}const kh=["Escape","KeyM"];class Rh{constructor(e){this.hooks=e,this.open=!1,this.current={car:"coupe",feel:"road",terrain:"rolling"};const t=this.root=document.createElement("div");t.id="menu",t.hidden=!0,t.innerHTML=`
      <div class="sheet">
        <h2>Garage</h2>
        <p class="hint">Escape or M to close · everything here is also a URL parameter</p>

        <h3>Car <small>changes now</small></h3>
        <div class="row" data-group="car"></div>

        <h3>Feel <small>changes now</small></h3>
        <div class="row" data-group="feel"></div>

        <h3>Land <small>reloads the world</small></h3>
        <div class="row" data-group="terrain"></div>

        <div class="foot">
          <button data-act="auto">Auto-drive</button>
          <button data-act="camera">Camera: —</button>
          <button data-act="reset">Put me back on the road (R)</button>
          <a class="btn" href="./previews/">All previews</a>
          <button data-act="close">Drive</button>
        </div>
      </div>`,document.body.appendChild(t),this._fill("car",Ds.map(s=>[s,Tt[s].label])),this._fill("feel",Object.keys(mt).map(s=>[s,mt[s].label])),this._fill("terrain",Object.keys(St).map(s=>[s,St[s].label])),t.addEventListener("click",s=>this._onClick(s)),addEventListener("keydown",s=>{kh.includes(s.code)&&(s.preventDefault(),this.toggle())})}_fill(e,t){const s=this.root.querySelector(`[data-group="${e}"]`);s.innerHTML=t.map(([n,i])=>`<button data-group="${e}" data-key="${n}">${i}</button>`).join("")}_mark(){for(const s of this.root.querySelectorAll("button[data-key]"))s.classList.toggle("on",this.current[s.dataset.group]===s.dataset.key);const e=this.root.querySelector('[data-act="camera"]');e&&this.hooks.camera&&(e.textContent=`Camera: ${this.hooks.camera()}`);const t=this.root.querySelector('[data-act="auto"]');if(t&&this.hooks.isAuto){const s=this.hooks.isAuto();t.textContent=s?"Auto-drive: on (G)":"Auto-drive (G)",t.classList.toggle("on",s)}}async _onClick(e){const t=e.target.closest("button");if(!t)return;const{group:s,key:n,act:i}=t.dataset;if(i==="close")return this.hide();if(i==="reset")return this.hooks.onReset?.(),this.hide();if(i==="camera")return this.hooks.cycleCam?.(),this._mark();if(i==="auto")return this.hooks.onAuto?.(),this._mark(),this.hide();if(s==="car")this.current.car=n,this._mark(),t.disabled=!0,await this.hooks.onCar?.(n),t.disabled=!1,this.hide();else if(s==="feel")this.current.feel=n,this._mark(),this.hooks.onFeel?.(n),this.hide();else if(s==="terrain"){const o=new URLSearchParams(location.search);o.set("terrain",n),o.set("feel",this.current.feel),o.set("car",this.current.car),location.search=o.toString()}}setCurrent(e){Object.assign(this.current,e),this._mark()}show(){this.open=!0,this.root.hidden=!1,this._mark()}hide(){this.open=!1,this.root.hidden=!0}toggle(){this.open?this.hide():this.show()}}const Eh="modulepreload",Ch=function(a,e){return new URL(a,e).href},Vo={},zh=function(e,t,s){let n=Promise.resolve();if(t&&t.length>0){let o=function(h){return Promise.all(h.map(u=>Promise.resolve(u).then(d=>({status:"fulfilled",value:d}),d=>({status:"rejected",reason:d}))))};const r=document.getElementsByTagName("link"),c=document.querySelector("meta[property=csp-nonce]"),l=c?.nonce||c?.getAttribute("nonce");n=o(t.map(h=>{if(h=Ch(h,s),h in Vo)return;Vo[h]=!0;const u=h.endsWith(".css"),d=u?'[rel="stylesheet"]':"";if(!!s)for(let m=r.length-1;m>=0;m--){const g=r[m];if(g.href===h&&(!u||g.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${h}"]${d}`))return;const p=document.createElement("link");if(p.rel=u?"stylesheet":Eh,u||(p.as="script"),p.crossOrigin="",p.href=h,l&&p.setAttribute("nonce",l),document.head.appendChild(p),u)return new Promise((m,g)=>{p.addEventListener("load",m),p.addEventListener("error",()=>g(new Error(`Unable to preload CSS for ${h}`)))})}))}function i(o){const r=new Event("vite:preloadError",{cancelable:!0});if(r.payload=o,window.dispatchEvent(r),!r.defaultPrevented)throw o}return n.then(o=>{for(const r of o||[])r.status==="rejected"&&i(r.reason);return e().catch(i)})},Lh=new Uint32Array([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),Ke=(a,e)=>(a>>>e|a<<32-e)>>>0;function Dh(a){if(typeof TextEncoder<"u")return new TextEncoder().encode(a);const e=[];for(let t=0;t<a.length;t++){const s=a.charCodeAt(t);s<128?e.push(s):s<2048?e.push(192|s>>6,128|s&63):e.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(e)}function Vi(a){const e=typeof a=="string"?Dh(a):a,t=e.length,s=new Uint8Array((t+8>>6)+1<<6);s.set(e),s[t]=128;const n=new DataView(s.buffer);n.setUint32(s.length-8,Math.floor(t/536870912)),n.setUint32(s.length-4,t<<3>>>0);const i=new Uint32Array([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]),o=new Uint32Array(64);for(let c=0;c<s.length;c+=64){for(let v=0;v<16;v++)o[v]=n.getUint32(c+v*4);for(let v=16;v<64;v++){const w=o[v-15],b=o[v-2],y=(Ke(w,7)^Ke(w,18)^w>>>3)>>>0,x=(Ke(b,17)^Ke(b,19)^b>>>10)>>>0;o[v]=o[v-16]+y+o[v-7]+x>>>0}let l=i[0],h=i[1],u=i[2],d=i[3],f=i[4],p=i[5],m=i[6],g=i[7];for(let v=0;v<64;v++){const w=(Ke(f,6)^Ke(f,11)^Ke(f,25))>>>0,b=(f&p^~f&m)>>>0,y=g+w+b+Lh[v]+o[v]>>>0,x=(Ke(l,2)^Ke(l,13)^Ke(l,22))>>>0,S=(l&h^l&u^h&u)>>>0,_=x+S>>>0;g=m,m=p,p=f,f=d+y>>>0,d=u,u=h,h=l,l=y+_>>>0}i[0]=i[0]+l>>>0,i[1]=i[1]+h>>>0,i[2]=i[2]+u>>>0,i[3]=i[3]+d>>>0,i[4]=i[4]+f>>>0,i[5]=i[5]+p>>>0,i[6]=i[6]+m>>>0,i[7]=i[7]+g>>>0}let r="";for(let c=0;c<8;c++)r+=i[c].toString(16).padStart(8,"0");return r}const Yo="wanderoad.secret",Fh="wanderoad.name",Ih="wanderoad.look",Rn=new Map;function On(a){try{const e=globalThis.localStorage?.getItem(a);if(e!=null)return e}catch{}return Rn.has(a)?Rn.get(a):null}function Ph(a,e){Rn.set(a,e);try{globalThis.localStorage?.setItem(a,e)}catch{}}function Nh(){const a=new Uint8Array(32),e=globalThis.crypto;if(e&&typeof e.getRandomValues=="function")e.getRandomValues(a);else{const s=`${Date.now()}:${globalThis.performance?.now?.()??0}:${Math.random()}:${Math.random()}`,n=Vi(s);for(let i=0;i<32;i++)a[i]=parseInt(n.slice(i*2,i*2+2),16)}let t="";for(let s=0;s<32;s++)t+=a[s].toString(16).padStart(2,"0");return t}const Xo=["Amber","Cobalt","Dusty","Quiet","Distant","Salt","Paper","Copper","Slow","Wandering","Kite","Rain","Pale","Ember","Hollow","Lantern"],Zo=["Fox","Heron","Kestrel","Pilot","Drifter","Sparrow","Comet","Wren","Otter","Moth","Rider","Finch","Marten","Hare","Swift","Crane"];function Oh(a){const e=parseInt(a.slice(0,3),16)%Xo.length,t=parseInt(a.slice(3,6),16)%Zo.length,s=parseInt(a.slice(6,9),16)%100;return`${Xo[e]} ${Zo[t]} ${s}`}function Bh(a){let e="";for(const t of String(a??"")){const s=t.codePointAt(0);s<32||s>=127&&s<=159||s>=8203&&s<=8207||s>=8232&&s<=8238||s>=8294&&s<=8297||(e+=t)}return e.replace(/\s+/g," ").trim().slice(0,18)||"Wanderer"}let dn=null,Es=null;function Bn(){if(dn)return dn;let a=On(Yo);return(typeof a!="string"||!/^[0-9a-f]{64}$/.test(a))&&(a=Nh(),Ph(Yo,a)),dn=a,a}function qs(){return Es||(Es=Vi(Bn()).slice(0,12),Es)}function Yi(){const a=On(Fh);return a?Bh(a):Oh(qs())}function Gh(){const a=On(Ih);if(a)try{const e=JSON.parse(a);return{tier:e.tier|0,paint:e.paint|0}}catch{}return{tier:0,paint:parseInt(qs().slice(9,12),16)%8}}function Uh(){const a=Gh();return{secret:Bn(),playerId:qs(),name:Yi(),tier:a.tier,paint:a.paint}}const Jo=8192,Xi=6e3,Hh=5;function Wh({backend:a="auto",base44AppId:e=null,phpBase:t="./api/"}={}){const s=t.endsWith("/")?t:`${t}/`,n={base44:e?qh(e):null,php:Kh(s),local:$h()},i=a==="auto"?["base44","php","local"].filter(p=>n[p]):[a,"local"].filter((p,m,g)=>n[p]&&g.indexOf(p)===m),o={pinned:null,fails:0,lastMs:0,sent:0,errors:0,lastError:null};let r=null;const c=new Promise(p=>{r=p});function l(p){o.pinned=p,o.fails=0,r(p)}function h(p){const m=JSON.stringify({v:1,secret:Bn(),name:Yi(),t:Date.now(),...p});if(m.length>Jo)throw new Error(`[net] payload ${m.length} B exceeds the ${Jo} B cap`);return m}async function u(p,m){const g=Date.now(),v=await n[p].send(m);if(o.lastMs=Date.now()-g,!v||typeof v!="object")throw new Error(`[net] ${p} returned a non-object`);return v}async function d(p){const m=h(p);if(o.pinned)try{const v=await u(o.pinned,m);return o.fails=0,o.sent++,v}catch(v){if(o.fails++,o.errors++,o.lastError=String(v&&v.message?v.message:v),o.fails<Hh)throw v;console.error(`[net] ${o.pinned} failed ${o.fails}x, re-probing`,o.lastError),o.pinned=null,o.fails=0}let g=null;for(const v of i)try{const w=await u(v,m);return l(v),o.sent++,w}catch(w){g=w,o.lastError=String(w&&w.message?w.message:w),v!=="local"&&console.error(`[net] ${v} unavailable:`,o.lastError)}throw o.errors++,g??new Error("[net] no transport available")}function f(){return c}return{send:d,ready:f,get backend(){return o.pinned??(i[0]||"local")},info(){return{backend:o.pinned??"unresolved",chain:i.slice(),phpBase:s,appId:e,lastMs:o.lastMs,sent:o.sent,errors:o.errors,lastError:o.lastError}},close(){for(const p of Object.keys(n))n[p]?.close?.()}}}function Kh(a){const e=`${a}drive.php`;return{async send(t){const s=new AbortController,n=setTimeout(()=>s.abort(),Xi);try{const i=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:t,signal:s.signal,credentials:"omit",cache:"no-store"});if(!i.ok){const o=new Error(`HTTP ${i.status}`);throw o.status=i.status,o}return await i.json()}finally{clearTimeout(n)}}}}function qh(a){let e=null;function t(){return e||(e=zh(()=>import("./index-C5QPFtM6.js"),[],import.meta.url).then(s=>s.createClient({appId:a}))),e}return{async send(s){const n=await t(),i=new AbortController,o=setTimeout(()=>i.abort(),Xi);try{const r=await n.functions.fetch("/drive",{method:"POST",headers:{"Content-Type":"application/json"},body:s,signal:i.signal});if(!r.ok){const c=new Error(`HTTP ${r.status}`);throw c.status=r.status,c}return await r.json()}finally{clearTimeout(o)}},close(){e?.then(s=>s.cleanup?.()).catch(()=>{}),e=null}}}function $h(){const a=new Map;return{async send(e){const t=JSON.parse(e),s=Date.now(),n=qs(),i={now:s,you:{playerId:n},peers:[],rate:.25};if(t.op==="save"&&Array.isArray(t.ops)){const o=a.get(n)??{seed:null,visited:[],ops:[]};for(const r of t.ops)jh(o,r);a.set(n,o)}else t.op==="load"&&(i.save=a.get(n)??null);return i}}}function jh(a,e){if(!(!e||typeof e!="object"))if(e.k==="seed")a.seed=e.v|0;else if(e.k==="visited"){const t=a.visited.findIndex(s=>s.b===e.b);t<0?a.visited.push({b:e.b,d:e.d}):a.visited[t]={b:e.b,d:Vh(a.visited[t].d,e.d)}}else a.ops.push(e),a.ops.length>4e3&&a.ops.splice(0,a.ops.length-4e3)}function Vh(a,e){const t=atob(a),s=atob(e),n=Math.max(t.length,s.length);let i="";for(let o=0;o<n;o++)i+=String.fromCharCode((t.charCodeAt(o)||0)|(s.charCodeAt(o)||0));return btoa(i)}const Qo=250,Yh=1.2,Xh=12,Zh=11e3,Jh=24;class Qh{constructor({scene:e,buildGhostCar:t}){if(typeof t!="function")throw new Error("[remotes] buildGhostCar is required");this.scene=e,this.buildGhostCar=t,this.group=new vt,this.group.name="ghosts",this.group.frustumCulled=!1,e?.add(this.group),this.peers=new Map,this._offset=null}get count(){return this.peers.size}ingest(e,t){if(Number.isFinite(t)){const n=t-Date.now();this._offset===null||Math.abs(n-this._offset)>1500?this._offset=n:this._offset+=(n-this._offset)*.15}if(!Array.isArray(e))return;const s=Number.isFinite(t)?t:Date.now()+(this._offset??0);for(const n of e){if(!n||typeof n.id!="string")continue;let i=this.peers.get(n.id);if(!i&&(i=this._spawn(n),!i))continue;i.lastSeen=s,i.name=typeof n.name=="string"?n.name:i.name;const o=Number.isFinite(n.t)?n.t:s,r=i.buf;if(r.length&&o<=r[r.length-1].t)continue;i.placed&&(i.jumpT=Date.now()+(this._offset??0)-Qo,i.preJump=fn(i.buf,i.jumpT));const c=r.length?r[r.length-1]:null,l=qe(n.yaw),h=c?c.yaw+Ns(c.yaw,l):l,u=qe(n.y),d=c?K((u-c.y)/((o-c.t)/1e3),-12,12):0;r.push({t:o,x:qe(n.x),y:u,z:qe(n.z),yaw:h,vx:qe(n.vx),vy:d,vz:qe(n.vz),yawRate:qe(n.yawRate),steer:qe(n.steer),throttle:qe(n.throttle),brake:qe(n.brake),flags:n.flags|0}),r.length>Jh&&r.shift(),i.corrected=!0,n.tier!==void 0&&(i.tier=n.tier|0),n.paint!==void 0&&(i.paint=n.paint|0)}}update(e,t=Date.now()){const s=t+(this._offset??0),n=s-Qo;for(const[i,o]of this.peers){if(s-o.lastSeen>Zh){this._despawn(i,o);continue}const r=fn(o.buf,n);if(!r)continue;const c=o.obj;if(!o.placed)o.placed=!0,c.visible=!0,o.ex=o.ey=o.ez=o.eyaw=0;else if(o.corrected&&o.preJump){const h=fn(o.buf,o.jumpT);h&&(o.ex=o.preJump.x+o.ex-h.x,o.ey=o.preJump.y+o.ey-h.y,o.ez=o.preJump.z+o.ez-h.z,o.eyaw=Ns(h.yaw,o.preJump.yaw+o.eyaw)),Math.hypot(o.ex,o.ey,o.ez)>Xh&&(o.ex=o.ey=o.ez=o.eyaw=0),o.preJump=null}o.corrected=!1;const l=Math.exp(-9*e);o.ex*=l,o.ey*=l,o.ez*=l,o.eyaw*=l,c.position.set(r.x+o.ex,r.y+o.ey,r.z+o.ez),c.rotation.y=r.yaw+o.eyaw,o.pose=r,o.api?.update?.(r,e)}}list(){const e=Q.uCamPos.value,t=[];for(const[s,n]of this.peers){const i=n.pose,o=i?Math.hypot(i.x-e.x,i.y-e.y,i.z-e.z):1/0;t.push({id:s,name:n.name,dist:o})}return t.sort((s,n)=>s.dist-n.dist),t}nearestDistance(){const e=Q.uCamPos.value;let t=1/0;for(const s of this.peers.values()){const n=s.pose;if(!n)continue;const i=Math.hypot(n.x-e.x,n.y-e.y,n.z-e.z);i<t&&(t=i)}return t}dispose(){for(const[e,t]of this.peers)this._despawn(e,t);this.peers.clear(),this.group.parent?.remove(this.group)}_spawn(e){let t;try{t=this.buildGhostCar({id:e.id,name:typeof e.name=="string"?e.name:"",tier:e.tier|0,paint:e.paint|0})}catch(i){return console.error("[remotes] buildGhostCar threw for",e.id,i),null}const s=t?.isObject3D?t:t?.root??t?.group??t?.object;if(!s?.isObject3D)return console.error("[remotes] buildGhostCar returned no Object3D for",e.id),null;s.visible=!1,s.matrixAutoUpdate=!0,this.group.add(s);const n={id:e.id,name:typeof e.name=="string"?e.name:"",tier:e.tier|0,paint:e.paint|0,obj:s,api:t?.isObject3D?null:t,buf:[],pose:null,placed:!1,corrected:!1,preJump:null,jumpT:0,ex:0,ey:0,ez:0,eyaw:0,lastSeen:0};return this.peers.set(e.id,n),n}_despawn(e,t){this.group.remove(t.obj),t.api?.dispose?t.api.dispose():e0(t.obj),this.peers.delete(e)}}function qe(a){return Number.isFinite(a)?a:0}function fn(a,e){const t=a.length;if(t===0)return null;if(t===1||e<=a[0].t)return ei(a[0],(e-a[0].t)/1e3);const s=a[t-1];if(e>=s.t)return ei(s,(e-s.t)/1e3);let n=t-2;for(;n>0&&a[n].t>e;)n--;const i=a[n],o=a[n+1],r=o.t-i.t,c=K((e-i.t)/r,0,1),l=r/1e3,h=n>0?a[n-1]:null,u=n+2<t?a[n+2]:null,d=o.y-i.y,f=h?.5*(o.y-h.y)*(r/(o.t-h.t)):d,p=u?.5*(u.y-i.y)*(r/(u.t-i.t)):d;return{x:xs(i.x,i.vx*l,o.x,o.vx*l,c),y:xs(i.y,f,o.y,p,c),z:xs(i.z,i.vz*l,o.z,o.vz*l,c),yaw:xs(i.yaw,i.yawRate*l,o.yaw,o.yawRate*l,c),steer:i.steer+(o.steer-i.steer)*c,throttle:i.throttle+(o.throttle-i.throttle)*c,brake:i.brake+(o.brake-i.brake)*c,vx:i.vx+(o.vx-i.vx)*c,vz:i.vz+(o.vz-i.vz)*c,flags:c<.5?i.flags:o.flags}}function ei(a,e){const t=K(e,0,Yh);return{x:a.x+a.vx*t,y:a.y+a.vy*t,z:a.z+a.vz*t,yaw:a.yaw+a.yawRate*t,steer:a.steer,throttle:a.throttle,brake:a.brake,vx:a.vx,vz:a.vz,flags:a.flags}}function e0(a){a.traverse(e=>{e.geometry?.dispose?.();const t=e.material;Array.isArray(t)?t.forEach(s=>s.dispose?.()):t?.dispose?.()})}const Cs=4096,ce=16,ti=ce*ce/8,t0=2e4,si=5800,ni=4e3,s0="wanderoad",Ct="save";class n0{constructor({seed:e,transport:t}){this.seed=e>>>0,this.transport=t,this.visited=new Map,this.dirtyBlocks=new Set,this.pending=[],this.ops=[],this._seq=0,this._timer=null,this._inflight=null,this._db=null,this._stats={uploads:0,uploadErrors:0,lastUpload:0,lastLocal:0},this.pending.push({k:"seed",v:this.seed})}markVisited(e,t){const s=Math.floor(e/Cs),n=Math.floor(t/Cs),i=Math.floor(s/ce),o=Math.floor(n/ce),r=`${i},${o}`;let c=this.visited.get(r);c||(c=new Uint8Array(ti),this.visited.set(r,c));const l=(s%ce+ce)%ce,u=(n%ce+ce)%ce*ce+l,d=1<<(u&7),f=u>>3;return c[f]&d?!1:(c[f]|=d,this.dirtyBlocks.add(r),this._touch(),!0)}isVisited(e,t){const s=Math.floor(e/Cs),n=Math.floor(t/Cs),i=this.visited.get(`${Math.floor(s/ce)},${Math.floor(n/ce)}`);if(!i)return!1;const o=(s%ce+ce)%ce,c=(n%ce+ce)%ce*ce+o;return(i[c>>3]&1<<(c&7))!==0}note(e){if(!e||typeof e!="object")throw new Error("[save] note() needs an object");const t={...e,n:++this._seq,t:Date.now()};return this.ops.push(t),this.pending.push(t),this.ops.length>ni&&this.ops.splice(0,this.ops.length-ni),this._touch(),t}_touch(){this._writeLocal(),this._timer===null&&typeof setTimeout=="function"&&(this._timer=setTimeout(()=>{this._timer=null,this.flush().catch(()=>{})},t0))}flush(){return this._inflight?this._inflight:(this._inflight=this._flushOnce().finally(()=>{this._inflight=null}),this._inflight)}async _flushOnce(){if(!this.transport)return{sent:0,more:!1};let e=0;for(let t=0;t<6;t++){const s=this._takeBatch();if(s.ops.length===0)break;try{await this.transport.send({op:"save",seed:this.seed,ops:s.ops})}catch(n){throw this._stats.uploadErrors++,console.error("[save] upload failed, keeping the local copy",n?.message??n),n}this._stats.uploads++,this._stats.lastUpload=Date.now();for(const n of s.blocks)this.dirtyBlocks.delete(n);this.pending.splice(0,s.opCount),e+=s.ops.length}return{sent:e,more:this.pending.length+this.dirtyBlocks.size>0}}_takeBatch(){const e=[],t=[];let s=0;for(const i of this.dirtyBlocks){const o={k:"visited",b:i,d:oi(this.visited.get(i))},r=JSON.stringify(o).length+1;if(s+r>si)break;e.push(o),t.push(i),s+=r}let n=0;for(const i of this.pending){const o=JSON.stringify(i).length+1;if(s+o>si)break;e.push(i),s+=o,n++}return{ops:e,blocks:t,opCount:n}}async load(){const e=await this._readLocal();if(e&&this._absorb(e),this.transport)try{const t=await this.transport.send({op:"load",seed:this.seed});t?.save&&this._absorb(t.save)}catch(t){console.error("[save] remote load failed, using the local copy",t?.message??t)}return{seed:this.seed,visited:this.visited.size,ops:this.ops.length}}_absorb(e){if(!e||typeof e!="object")return;if(Number.isFinite(e.seed)&&e.seed>>>0!==this.seed){console.error(`[save] ignoring a save for seed ${e.seed>>>0}, this world is ${this.seed}`);return}for(const s of e.visited??[]){const n=i0(s.d);if(!n)continue;const i=this.visited.get(s.b);if(!i)this.visited.set(s.b,n);else for(let o=0;o<i.length&&o<n.length;o++)i[o]|=n[o]}const t=new Set(this.ops.map(s=>s.n));for(const s of e.ops??[])!s||t.has(s.n)||(this.ops.push(s),t.add(s.n),s.n>this._seq&&(this._seq=s.n));this.ops.sort((s,n)=>(s.n??0)-(n.n??0))}stats(){let e=0;for(const t of this.visited.values())for(let s=0;s<t.length;s++)e+=o0(t[s]);return{seed:this.seed,regions:e,blocks:this.visited.size,ops:this.ops.length,pending:this.pending.length+this.dirtyBlocks.size,bytes:this.visited.size*ti+JSON.stringify(this.ops).length,uploads:this._stats.uploads,uploadErrors:this._stats.uploadErrors,lastUpload:this._stats.lastUpload,lastLocal:this._stats.lastLocal}}dispose(){this._timer!==null&&(clearTimeout(this._timer),this._timer=null)}_openDb(){if(this._db)return this._db;const e=globalThis.indexedDB;return e?(this._db=new Promise(t=>{let s;try{s=e.open(s0,1)}catch{t(null);return}s.onupgradeneeded=()=>{s.result.objectStoreNames.contains(Ct)||s.result.createObjectStore(Ct)},s.onsuccess=()=>t(s.result),s.onerror=()=>t(null),s.onblocked=()=>t(null)}),this._db):(this._db=Promise.resolve(null),this._db)}async _writeLocal(){const e=await this._openDb();if(!e)return;const t=this._serialise();try{const s=e.transaction(Ct,"readwrite");s.objectStore(Ct).put(t,`seed:${this.seed}`),s.oncomplete=()=>{this._stats.lastLocal=Date.now()},s.onerror=()=>console.error("[save] IndexedDB write failed")}catch(s){console.error("[save] IndexedDB transaction failed",s?.message??s)}}async _readLocal(){const e=await this._openDb();return e?new Promise(t=>{try{const n=e.transaction(Ct,"readonly").objectStore(Ct).get(`seed:${this.seed}`);n.onsuccess=()=>t(n.result??null),n.onerror=()=>t(null)}catch{t(null)}}):null}_serialise(){const e=[];for(const[t,s]of this.visited)e.push({b:t,d:oi(s)});return{seed:this.seed,visited:e,ops:this.ops}}}function o0(a){return a=a-(a>>1&85),a=(a&51)+(a>>2&51),a+(a>>4)&15}function oi(a){let e="";for(let t=0;t<a.length;t++)e+=String.fromCharCode(a[t]);return btoa(e)}function i0(a){if(typeof a!="string")return null;let e;try{e=atob(a)}catch{return null}const t=new Uint8Array(e.length);for(let s=0;s<e.length;s++)t[s]=e.charCodeAt(s);return t}const a0={open:[0,2,4,7,9],still:[0,3,5,7,10]},ii={open:[0,3,4,2],still:[0,4,2,3]},es=[{id:"off",label:"Radio off",scale:null},{id:"valley",label:"Valley",scale:"open",root:55,chordSecs:22,bellRate:.16,drone:.5},{id:"longway",label:"The Long Way",scale:"still",root:51.9,chordSecs:26,bellRate:.1,drone:.7}],pn=(a,e)=>a*Math.pow(2,e/12);class r0{constructor(e,t,{volume:s=.5}={}){this.ctx=e,this.station=0,this._t=0,this._chordT=1e9,this._bellT=0,this._chord=0,this.out=e.createGain(),this.out.gain.value=0,this.tone=e.createBiquadFilter(),this.tone.type="lowpass",this.tone.frequency.value=1600,this.tone.Q.value=.4,this.out.connect(this.tone).connect(t);const n=Math.floor(e.sampleRate*2.6),i=e.createBuffer(2,n,e.sampleRate);for(let o=0;o<2;o++){const r=i.getChannelData(o);for(let c=0;c<n;c++)r[c]=(Math.random()*2-1)*Math.pow(1-c/n,3.2)}this.verb=e.createConvolver(),this.verb.buffer=i,this.verbGain=e.createGain(),this.verbGain.gain.value=.55,this.verb.connect(this.verbGain).connect(this.tone),this.volume=s}get label(){return es[this.station].label}next(){this.station=(this.station+1)%es.length;const e=es[this.station].scale!==null;return this.out.gain.setTargetAtTime(e?this.volume*.16:0,this.ctx.currentTime,.5),this._chordT=1e9,this.label}setVolume(e){this.volume=D(e),es[this.station].scale&&this.out.gain.setTargetAtTime(this.volume*.16,this.ctx.currentTime,.3)}_voice(e,t,s,n,i="triangle",o=0){const r=this.ctx,c=r.createOscillator();c.type=i,c.frequency.value=e,c.detune.value=o;const l=r.createGain();l.gain.setValueAtTime(0,t),l.gain.linearRampToValueAtTime(n,t+s*.34),l.gain.exponentialRampToValueAtTime(1e-4,t+s),c.connect(l),l.connect(this.out),l.connect(this.verb),c.start(t),c.stop(t+s+.05)}update(e,t=1){const s=es[this.station];if(!s.scale)return;const n=this.ctx;if(!n||n.state!=="running")return;this._t+=e,this._chordT+=e,this._bellT+=e;const i=a0[s.scale],o=ii[s.scale];if(this._chordT>=s.chordSecs){this._chordT=0,this._chord=(this._chord+1)%o.length;const c=o[this._chord],l=n.currentTime+.05,h=s.chordSecs*1.25;for(const[u,d,f]of[[c,0,.16],[(c+2)%i.length,0,.11],[(c+4)%i.length,1,.08]]){const p=pn(s.root,i[u]+12*d);this._voice(p,l,h,f,"triangle",-5),this._voice(p,l,h,f*.8,"triangle",6)}this._voice(pn(s.root,i[c]-12),l,h,.09*s.drone,"sine")}const r=s.bellRate*F(.25,1,D(t));if(this._bellT>1/Math.max(r,.01)){this._bellT=0;const c=ii[s.scale][this._chord],l=i[(c+(Math.random()*i.length|0))%i.length],h=12*(1+(Math.random()*2|0));this._voice(pn(s.root,l+h),n.currentTime+.02,3.4,.055,"sine")}}}class c0{constructor({volume:e=.38}={}){this.ctx=null,this.volume=e,this.enabled=!0,this._started=!1,this._limitSmooth=0;const t=()=>this.start();for(const s of["pointerdown","keydown","touchstart"])addEventListener(s,t,{once:!0,passive:!0})}start(){if(this._started||!this.enabled)return;const e=window.AudioContext||window.webkitAudioContext;if(!e)return;this._started=!0;const t=this.ctx=new e,s=this.master=t.createGain();s.gain.value=this.volume,s.connect(t.destination),this.engGain=t.createGain(),this.engGain.gain.value=0;const n=t.createBiquadFilter();n.type="lowpass",n.frequency.value=420,n.Q.value=.8,this.engFilter=n,this.engGain.connect(n).connect(s),this.oscs=[];for(const[h,u,d]of[["sawtooth",.5,.5],["sawtooth",1,.34],["triangle",2,.06],["sine",.25,.42]]){const f=t.createOscillator();f.type=h;const p=t.createGain();p.gain.value=d,f.connect(p).connect(this.engGain),f.start(),this.oscs.push({o:f,mul:u})}const i=t.createBufferSource(),o=t.sampleRate*2,r=t.createBuffer(1,o,t.sampleRate),c=r.getChannelData(0);let l=0;for(let h=0;h<o;h++){const u=Math.random()*2-1;l=.99*l+.01*u,c[h]=l*3.5+u*.25}i.buffer=r,i.loop=!0,i.start(),this.noise=i,this.windFilter=t.createBiquadFilter(),this.windFilter.type="bandpass",this.windFilter.frequency.value=700,this.windFilter.Q.value=.5,this.windGain=t.createGain(),this.windGain.gain.value=0,i.connect(this.windFilter).connect(this.windGain).connect(s),this.roadFilter=t.createBiquadFilter(),this.roadFilter.type="bandpass",this.roadFilter.frequency.value=180,this.roadFilter.Q.value=1.6,this.roadGain=t.createGain(),this.roadGain.gain.value=0,i.connect(this.roadFilter).connect(this.roadGain).connect(s),this.scrubFilter=t.createBiquadFilter(),this.scrubFilter.type="bandpass",this.scrubFilter.frequency.value=1100,this.scrubFilter.Q.value=2.6,this.scrubGain=t.createGain(),this.scrubGain.gain.value=0,i.connect(this.scrubFilter).connect(this.scrubGain).connect(s),this.radio=new r0(t,s)}update(e,t){const s=this.ctx;if(!s||s.state==="suspended")return;const n=s.currentTime,i=.06,o=Math.abs(t.speed),r=D((t.rpm-900)/(t.spec.redline-900)),c=26+r*48;for(const{o:f,mul:p}of this.oscs)f.frequency.setTargetAtTime(c*p,n,i);const l=D(t.throttle*.85+r*.3);this.engGain.gain.setTargetAtTime(.032+l*.1,n,i),this.engFilter.frequency.setTargetAtTime(260+l*640+r*240,n,i);const h=Math.pow(D((o-15)/60),1.4);this.windGain.gain.setTargetAtTime(h*.085,n,i),this.windFilter.frequency.setTargetAtTime(330+o*4.5,n,i);const u=t.surfaceKind==="tarmac"?.35:1;this.roadGain.gain.setTargetAtTime(D(o/26)*.062*(.6+u),n,i),this.roadFilter.frequency.setTargetAtTime(78+o*3.2,n,i),this.roadFilter.Q.setTargetAtTime(F(2.4,.9,u),n,i),this._limitSmooth=F(this._limitSmooth,t.limit,Math.min(1,e*12));const d=D((this._limitSmooth-.72)/.28);if(this.scrubGain.gain.setTargetAtTime(d*d*.1*D(o/8),n,.03),this.scrubFilter.frequency.setTargetAtTime(900+d*620,n,i),this.radio){const f=D(1-Math.max(t.limit,Math.abs(t.slip)/.5)*1.2);this.radio.update(e,f)}}nextStation(){return this.start(),this.radio?this.radio.next():"no audio"}horn(){const e=this.ctx;if(!e)return;const t=e.currentTime;for(const[s,n]of[[392,0],[523.25,.11]]){const i=e.createOscillator();i.type="triangle",i.frequency.value=s;const o=e.createGain();o.gain.setValueAtTime(0,t+n),o.gain.linearRampToValueAtTime(.16,t+n+.02),o.gain.exponentialRampToValueAtTime(1e-4,t+n+.42),i.connect(o).connect(this.master),i.start(t+n),i.stop(t+n+.5)}}thump(e=.5){const t=this.ctx;if(!t)return;const s=t.currentTime,n=t.createOscillator();n.type="sine",n.frequency.setValueAtTime(140+90*e,s),n.frequency.exponentialRampToValueAtTime(48,s+.24);const i=t.createGain();i.gain.setValueAtTime(K(e,.05,1)*.4,s),i.gain.exponentialRampToValueAtTime(1e-4,s+.3),n.connect(i).connect(this.master),n.start(s),n.stop(s+.34)}chime(){const e=this.ctx;if(!e)return;const t=e.currentTime;[[659.25,0],[987.77,.14]].forEach(([s,n])=>{const i=e.createOscillator();i.type="sine",i.frequency.value=s;const o=e.createGain();o.gain.setValueAtTime(0,t+n),o.gain.linearRampToValueAtTime(.09,t+n+.03),o.gain.exponentialRampToValueAtTime(1e-4,t+n+.9),i.connect(o).connect(this.master),i.start(t+n),i.stop(t+n+1)})}setVolume(e){this.volume=D(e),this.master&&(this.master.gain.value=this.volume)}dispose(){this.ctx&&this.ctx.close().catch(()=>{}),this.ctx=null}}const It=a=>document.querySelector(a),ht=(a,e)=>{const t=It("#stat");t&&(t.textContent=a),e!==void 0&&It("#barIn")&&(It("#barIn").style.width=`${e*100|0}%`)},Pt=new URLSearchParams(location.search),be=(parseInt(Pt.get("seed")??"",10)||20260726)>>>0,l0=Pt.has("debug"),h0=Pt.has("offline"),dt=bh(),zt=ji(dt.feel),u0=wh(dt.terrain);qr(xh(dt.terrain));async function d0(){ht("warming the engine…",.04);const a=document.createElement("canvas");It("#app").appendChild(a);const e=new Ha({canvas:a,antialias:!1,powerPreference:"high-performance",stencil:!1});if(!e.capabilities.isWebGL2){ht("this browser has no WebGL2 — try Chrome, Edge or Firefox");return}const t=Math.min(devicePixelRatio||1,1.75);e.setPixelRatio(t),e.setSize(innerWidth,innerHeight,!1),e.outputColorSpace=Ot,e.toneMapping=0;const s=new Hs,n=new gi(64,innerWidth/innerHeight,.28,16e3),i=new wr(e,{width:innerWidth,height:innerHeight,pixelRatio:t});s.add(Qa()),ht("drawing the map…",.14);const o=nr(),r=new Cr({seed:be,scene:s}),c=new Rc({seed:be,scene:s}),l=new Mh,h=new pl({seed:be,material:o,viewDistance:6800,terrain:dt.terrain,onChunk:I=>{if(I.water&&r.add(I),I.level<=fs){const W=Ni({cx:I.cx,cz:I.cz,level:I.level,seed:be});c.add(I,W),I.level===0&&l.addChunk(`${I.cx},${I.cz}`,Th(W))}},onRelease:I=>{r.remove(I),c.remove(I),I.level===0&&l.removeChunk(`${I.cx},${I.cz}`)}});s.add(h.group);const u=new Ur({renderer:e,scene:s,seed:be}),d=new Hc({seed:be,scene:s}),f=new jc(e,{seed:be}),p=new ul({seed:be,scene:s,wind:f});ht("finding a road…",.34);const m=go(be);h.forceChunk(m.x,m.z);let g=new Gt(be,m.x-420,m.z-420,m.x+420,m.z+420),v=m.x,w=m.z;const b=(I,W)=>((Math.abs(I-v)>240||Math.abs(W-w)>240)&&(g=new Gt(be,I-420,W-420,I+420,W+420),v=I,w=W),g);ht("unloading the car…",.52);const y=Uh(),x=new lh({tier:zt.tier,terrain:g,preset:zt.assist});x.placeAt(m.x,m.z,m.heading);const S=Pt.get("car")&&Tt[Pt.get("car")]?Pt.get("car"):zt.car||"coupe";let _;try{_=await Go({car:S,paint:y.look?.paint??0,base:new URL("./models/cars/",location.href).href})}catch(I){console.error("[car] model failed to load, using the built-in body",I?.message??I),_=gl({tier:zt.tier,paint:y.look?.paint??0})}s.add(_.group);const M=new uh(n,{mode:zt.camera}),T=new hh(window);T.attachTouch(a);const R=new dh,L=new vh,A=new Sh,k=new c0;let z=S;async function N(I){if(!(!Tt[I]||I===z))try{const W=await Go({car:I,paint:y.look?.paint??0,base:new URL("./models/cars/",location.href).href});s.remove(_.group),_.dispose?.(),_=W,s.add(_.group),z=I,window.WANDEROAD.model=_,A.say(Tt[I].label,2)}catch(W){console.error("[car] swap failed",W?.message??W),A.say("that one would not load",2.5)}}const H=new Rh({onAuto:()=>R.toggle(x),isAuto:()=>R.on,onCar:N,onFeel:I=>{ji(I),x.setPreset(mt[I].assist),M.mode=mt[I].camera,M.reset(),A.say(`${mt[I].label}`,2)},onReset:()=>$(),camera:()=>M.mode,cycleCam:()=>M.cycle()});H.setCurrent({car:z,feel:dt.feel,terrain:dt.terrain});const B=document.createElement("div");B.id="openMenu",B.textContent="ESC — garage",A.root.appendChild(B);function $(){const W=(x.terrain||g).roads.query(x.x,x.z);if(isFinite(W.d))x.placeAt(W.qx,W.qz,Math.atan2(W.tx,W.tz));else{const ae=go(be,x.x,x.z);x.placeAt(ae.x,ae.z,ae.heading)}M.reset(),A.say("back on the road",2)}ht("looking for company…",.7);const se=Wh({backend:h0?"none":"auto",phpBase:new URL("./api/",location.href).href}),C=new Qh({scene:s,buildGhostCar:wl}),O=new n0({seed:be,transport:se});await O.load().catch(()=>{});const V=()=>`c${Math.round(x.x/2048)}_${Math.round(x.z/2048)}`;addEventListener("resize",()=>{e.setSize(innerWidth,innerHeight,!1),i.setSize(innerWidth,innerHeight),n.aspect=innerWidth/innerHeight,n.updateProjectionMatrix()}),addEventListener("pagehide",()=>{L.flush(),O.flush(),se.send({op:"bye",cell:V(),car:ee()}).catch(()=>{})}),document.addEventListener("visibilitychange",()=>{document.hidden&&(L.flush(),O.flush())});let ie=null;l0&&(ie=document.createElement("div"),ie.id="debug",document.body.appendChild(ie));const ee=()=>({x:x.x,y:x.y,z:x.z,yaw:x.yaw,vx:x.vx,vy:x.vy,vz:x.vz,yawRate:x.yawRate,steer:x.steer,throttle:x.throttle,brake:x.brake,gear:x.gear,tier:x.tier,paint:y.look?.paint??0,flags:(x.onGround?0:1)|(x.handbrake>.5?2:0)});let ne="offline",ue=0;async function we(I){if(!(I<ue)){ue=I+4e3;try{const W=await se.send({op:"tick",cell:V(),car:ee()});if(!W){ne="offline";return}ne=se.backend==="local"?"solo":"online",W.peers&&C.ingest(W.peers,W.now),ue=performance.now()+1e3/Math.max(.05,Math.min(W.rate||.25,10))}catch{ne="offline",ue=performance.now()+8e3}}}let Be=performance.now(),Y=0,Ge=Be,Ue=0,ms=!1;const Kt=new X;function qt(I){requestAnimationFrame(qt);const W=Math.min((I-Be)/1e3,.1);Be=I;const ae=T.poll();if(T.tapped("camera")&&A.say(`camera: ${M.cycle()}`,1.6),T.tapped("reverse")&&(x.reverse=!x.reverse),T.tapped("nextCar")){const Se=Ds.indexOf(z),Ze=Ds[(Se+1)%Ds.length];H.setCurrent({car:Ze}),N(Ze)}T.tapped("horn")&&k.horn(),T.tapped("radio")&&A.say(k.nextStation(),2.4),T.tapped("autodrive")&&A.say(R.toggle(x)?"auto-drive on — sit back":"auto-drive off",2.4),T.tapped("reset")&&$();for(const[Se,Ze]of[["Digit1","cruise"],["Digit2","sport"],["Digit3","off"],["Digit4","hardcore"]])T.pressed.has(Se)&&(x.setPreset(Ze),A.say(`assists: ${Ze}`,2));x.terrain=b(x.x,x.z);const $s=R.on,gt=R.update(x,ae,W)||ae;$s&&!R.on&&A.say(R.lastReason||"auto-drive off",2.2),H.open||x.update(W,gt);const it=l.resolve(x,1.05,W);it&&it.severity>.35&&it.speed>9&&(k.thump(Math.min(1,it.severity*it.speed/40)),L.update(2,x,{onRoad:0}),A.say("ouch",1.4));const at=x.terrain.surface(x.x,x.z);L.update(W,x,at);const vs=x.groundTilt();_.group.position.set(x.x,x.y-.36,x.z),_.group.rotation.set(0,x.yaw,0),_.setBodyRoll(x.roll*1.3+vs.roll*.6,x.pitch+vs.pitch*.6),_.setSteer(x.steerAngle||0),_.setWheelSpin(x.wheelSpin),_.setBrakeGlow(x.brake);const $t=M.update(x,W,(Se,Ze)=>x.terrain.height(Se,Ze));if(Q.uTime.value=I/1e3,Q.uCamPos.value.copy(n.position),n.getWorldDirection(Kt),Q.uCull.value.set(Kt.x,Kt.z,Math.cos(1.15),0),h.update(x.x,x.z),d.update(x.x,x.z),f.update(W,n.position),p.update(x.x,x.z,x.y,W),u.update(W,n.position),r.update(W,n.position),c.update(W,n.position),O.markVisited(x.x,x.z),C.update(W,I),we(I),k.update(W,x),i.speed=$t,i.limit=x.limit,A.update(W,{car:x,streak:L,surface:at,remotes:C,netState:ne}),i.render(s,n),T.endFrame(),Y++,I-Ge>500&&(Ue=Y*1e3/(I-Ge),Y=0,Ge=I,ie)){const Se=h.stats;ie.textContent=`fps ${Ue.toFixed(0)}  live ${Se.live}  queue ${Se.queued}  built ${Se.built}  wk ${Se.workers}
pos ${x.x.toFixed(0)}, ${x.z.toFixed(0)}  ${x.kph.toFixed(0)} km/h  g${x.gear}  slip ${(x.slip*180/Math.PI).toFixed(0)}°  limit ${x.limit.toFixed(2)}
road ${at.onRoad.toFixed(2)}  grip ${at.grip.toFixed(2)}  ${yn[at.dominant]}  solids ${l.count}
calls ${e.info.render.calls}  tris ${e.info.render.triangles/1e3|0}k  net ${ne}  peers ${C.count}`}!ms&&h.stats.live>14&&(ms=!0,ht("go anywhere.",1),setTimeout(()=>{It("#veil").classList.add("gone"),It("#hud").hidden=!1,(dt.feel!=="road"||dt.terrain!=="rolling")&&A.say(`${zt.label} · ${u0.label}`,4.5)},500))}requestAnimationFrame(qt),window.THREE=Wa,window.WANDEROAD={renderer:e,scene:s,camera:n,streamer:h,car:x,model:_,chase:M,streak:L,auto:R,solids:l,remotes:C,post:i,SEED:be,stats:()=>h.stats,fps:()=>Ue,drive:I=>Object.assign(window.WANDEROAD._auto||(window.WANDEROAD._auto={}),I)}}d0().catch(a=>{console.error(a),ht(`boot failed: ${a.message}`)});
