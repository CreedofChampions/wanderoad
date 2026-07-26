import{C as Qe,V as Z,M as Bt,a as ce,b as Ps,R as ge,B as la,c as Me,d as ha,F as Cn,N as Xs,L as ze,H as vn,U as gn,e as tt,f as H,S as st,g as zn,h as Ks,W as hs,i as Pe,j as be,k as us,O as mt,D as et,l as Ln,A as Ns,m as ri,Z as ci,n as li,o as hi,p as ui,I as dt,q as bs,r as di,s as fi,Q as Dn,t as ua,u as da,v as fa,G as Je,T as pa,w as wn,x as pi,y as ma,z as ls,E as mi,J as Ve,K as Gt,P as va,X as ga,Y as wa,_ as xa,$ as ba,a0 as ya,a1 as _a,a2 as Ma,a3 as Ta,a4 as vi,a5 as xn,a6 as Sa,a7 as Aa,a8 as Zs,a9 as ka,aa as gi,ab as ts,ac as Ra,ad as Ea,ae as Ca,af as za,ag as La,ah as Da,ai as wi,aj as Fa,ak as Ia,al as Pa,am as Na,an as Oa,ao as Ba,ap as xi,aq as Ga,ar as Yn,as as Xn,at as Zn,au as Jn,av as Qn,aw as Ua,ax as Ds,ay as Ha,az as Wa}from"./three-0hhNWlqB.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))s(n);new MutationObserver(n=>{for(const i of n)if(i.type==="childList")for(const o of i.addedNodes)o.tagName==="LINK"&&o.rel==="modulepreload"&&s(o)}).observe(document,{childList:!0,subtree:!0});function t(n){const i={};return n.integrity&&(i.integrity=n.integrity),n.referrerPolicy&&(i.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?i.credentials="include":n.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function s(n){if(n.ep)return;n.ep=!0;const i=t(n);fetch(n.href,i)}})();const fe={skyZenith:"#4E80B4",skyUpper:"#7BA9CE",skyMid:"#A8CAE0",skyHorizon:"#E4DAC2",skyHorizonSun:"#FBE2AE",sunGlow:"#FFF1CE",sunDisc:"#FFFAEA",skyAnti:"#C8D4D6",haze:"#A9BCC7",mist:"#D6DDD4",cloudTop:"#FFF8EC",cloudBody:"#F6E7D2",cloudTerm:"#E8CFB4",cloudUnder:"#B7ACC3",cloudCore:"#9791B0",cloudRim:"#FFEFBE",cirrus:"#F3E6D6",gTip:"#C6D46B",gUpper:"#93B84E",gMid:"#6C9A47",gLow:"#436E4F",gBase:"#2B564F",gTrans:"#E9EE7C",gSheen:"#EDF0C8",gDry:"#D9C079",gPatchA:"#87AC4B",gPatchB:"#6C9A56",gPatchC:"#9DBC5E",gPatchD:"#5F8A5A",tLit:"#93B159",tMid:"#6A924F",tShade:"#456A54",tHollow:"#33564F",ridgeNear:"#8FA9A2",ridgeMid:"#9CB0B4",ridgeFar:"#AEBCC9",ridgeFurthest:"#BFC8D4",pathLit:"#C9AD80",pathShade:"#7A664D",rockLit:"#B4A794",rockShade:"#5F5C58",bounce:"#AA9C64",wShallow:"#A5CBBE",wMid:"#5F9CA0",wDeep:"#2F5F6C",wDeepShade:"#274E5C",wSpark:"#FFFCEC",wFoam:"#EEF5EF",wetStone:"#6E7E75",sA:"#CBB99E",sB:"#BDA98C",sC:"#D6C6AA",sD:"#B2A490",sShade:"#6C6355",sDeep:"#585A62",mortar:"#AB9C85",moss:"#6F8C4E",lichen:"#B3BE96",cLit:"#84A94C",cMid:"#5A8148",cShade:"#2F5546",cDeep:"#254A44",cTrans:"#BED063",cVarA:"#98AC43",cVarB:"#6E9440",cVarC:"#A9B65C",trunkLit:"#8E7659",trunkShade:"#4C3F34",roofA:"#B96A4C",roofB:"#A05C46",roofSlate:"#6E7583",thatch:"#BC9E66",wallA:"#EFE4D0",wallB:"#E4D5BA",timber:"#7C5D46",windowGlow:"#FFD98C",tarmacLit:"#8E8B86",tarmacShade:"#4A4C52",tarmacWet:"#5E6670",lineWhite:"#F2EADA",lineYellow:"#E7C87A",gravelLit:"#C3AE8B",gravelShade:"#78684F",kerb:"#CFC5B2",postWood:"#8A7357",postPaint:"#EFE4D0",paintA:"#C8503F",paintB:"#E0B14E",paintC:"#3F6E8C",paintD:"#EFE7D6",paintE:"#4E7F79",paintF:"#2E3440",chrome:"#D7DCE0",glass:"#7FA2B8",tyre:"#2A2A2E",tail:"#E4573F",head:"#FFF3D0",sun:"#FFD79C",ambSky:"#9EC6E6",ambGround:"#AA9C64",shadowTint:"#5C6E9E"},_t={};for(const a in fe)_t[a]=new Qe(fe[a]).convertSRGBToLinear();const Ka=a=>`vec3(${a.r.toFixed(5)},${a.g.toFixed(5)},${a.b.toFixed(5)})`,R={};for(const a in _t)R[a]=Ka(_t[a]);const Os={};for(const a in _t)Os[a]=[_t[a].r,_t[a].g,_t[a].b];function qa(){return`
const vec3 K_SUN        = ${R.sun};
const vec3 K_AMB_SKY    = ${R.ambSky};
const vec3 K_AMB_GND    = ${R.ambGround};
const vec3 K_SHADOW     = ${R.shadowTint};
const vec3 K_HAZE       = ${R.haze};
const vec3 K_MIST       = ${R.mist};
const vec3 K_SKY_ZEN    = ${R.skyZenith};
const vec3 K_SKY_UP     = ${R.skyUpper};
const vec3 K_SKY_MID    = ${R.skyMid};
const vec3 K_SKY_HOR    = ${R.skyHorizon};
const vec3 K_SKY_HORSUN = ${R.skyHorizonSun};
const vec3 K_SKY_ANTI   = ${R.skyAnti};
const vec3 K_SUN_GLOW   = ${R.sunGlow};
const vec3 K_SUN_DISC   = ${R.sunDisc};
const vec3 K_C_TOP      = ${R.cloudTop};
const vec3 K_C_BODY     = ${R.cloudBody};
const vec3 K_C_TERM     = ${R.cloudTerm};
const vec3 K_C_UNDER    = ${R.cloudUnder};
const vec3 K_C_CORE     = ${R.cloudCore};
const vec3 K_C_RIM      = ${R.cloudRim};
const vec3 K_T_LIT      = ${R.tLit};
const vec3 K_T_MID      = ${R.tMid};
const vec3 K_T_SHADE    = ${R.tShade};
const vec3 K_T_HOLLOW   = ${R.tHollow};
const vec3 K_ROCK_LIT   = ${R.rockLit};
const vec3 K_ROCK_SHADE = ${R.rockShade};
const vec3 K_PATH_LIT   = ${R.pathLit};
const vec3 K_PATH_SHADE = ${R.pathShade};
const vec3 K_TAR_LIT    = ${R.tarmacLit};
const vec3 K_TAR_SHADE  = ${R.tarmacShade};
const vec3 K_LINE_W     = ${R.lineWhite};
const vec3 K_LINE_Y     = ${R.lineYellow};
const vec3 K_GRAVEL_LIT = ${R.gravelLit};
const vec3 K_GRAVEL_SHD = ${R.gravelShade};
const vec3 K_W_SHALLOW  = ${R.wShallow};
const vec3 K_W_MID      = ${R.wMid};
const vec3 K_W_DEEP     = ${R.wDeep};
const vec3 K_BOUNCE     = ${R.bounce};
const float SUN_I = 1.38;
`}const ft=[{ground:[1,1,1],rock:[1,1,1],foliage:[1,1,1],haze:fe.haze,hazeMul:1,dryness:0,snow:0,wet:.12},{ground:[1.24,1.1,.72],rock:[1.12,1.05,.92],foliage:[1.14,1.02,.66],haze:"#D6C79E",hazeMul:1.35,dryness:.85,snow:0,wet:.02},{ground:[.82,.9,.98],rock:[.9,.95,1.06],foliage:[.72,.86,.86],haze:"#9FB6CE",hazeMul:.72,dryness:.1,snow:1,wet:.2},{ground:[1.42,1.06,.78],rock:[1.3,1.02,.86],foliage:[1.05,.9,.62],haze:"#E6C7AC",hazeMul:1.6,dryness:1,snow:0,wet:0},{ground:[.88,.96,.9],rock:[.86,.9,.9],foliage:[.84,.96,.86],haze:"#CBD6D2",hazeMul:1.9,dryness:0,snow:0,wet:1}];function bi(){const a=ft.length,e=new Float32Array(a*3),t=new Float32Array(a*3),s=new Float32Array(a*3),n=new Float32Array(a*3),i=new Float32Array(a*4);return ft.forEach((o,r)=>{e.set(o.ground,r*3),t.set(o.rock,r*3),s.set(o.foliage,r*3);const c=new Qe(o.haze).convertSRGBToLinear();n.set([c.r,c.g,c.b],r*3),i.set([o.hazeMul,o.dryness,o.snow,o.wet],r*4)}),{ground:e,rock:t,foliage:s,haze:n,scal:i,count:a}}const $a=`precision highp float;
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
`,yi=`precision highp float;
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
`,Fn=`
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
`,qs=`
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
    col = mix(col, ${R.cirrus}*(0.92+0.55*pow(max(ang,0.0),3.0)), ci*0.55*uCloudAmount);
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
`;function kt({cshSpan:a=4600,cloudDeck:e=980}={}){return`
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
`}const Kt=`
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
`,Rt=`
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
`,In=`
precision mediump float;
out vec4 o;
void main(){ o = vec4(1.0); }`;function Ne(...a){return yi+Fn+qa()+a.join("")}function _e(...a){return $a+Fn+a.join("")}const Va=13.5,Ya=118;function Xa(a=Va,e=Ya){const t=a*Math.PI/180,s=e*Math.PI/180;return new Z(Math.sin(s)*Math.cos(t),Math.sin(t),Math.cos(s)*Math.cos(t)).normalize()}const ee={uTime:{value:0},uSunDir:{value:Xa()},uCamPos:{value:new Z},uWindOrigin:{value:new ce},uCloudDrift:{value:new ce},uWindTex:{value:null},uShadowMap:{value:null},uCloudSh:{value:null},uCloudShOrigin:{value:new ce},uShadowC:{value:new ce},uCull:{value:new Ps(0,0,-1,0)},uWindLag:{value:new ce},uLightMat:{value:new Bt},uShadowTexel:{value:1/2048},uCloudAmount:{value:.62},uFogMul:{value:1},uFogNear:{value:140},uFogFar:{value:4200}};function Ae(a={}){const e={};for(const t in ee)e[t]=ee[t];for(const t in a)e[t]=a[t];return e}const Za=`
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
`;function Qa(){const a=new ge({glslVersion:"300 es",uniforms:Ae(),vertexShader:_e(Za),fragmentShader:Ne(pe,me,qs,Ja),side:la,depthWrite:!1,depthTest:!1}),e=new Me(new ha(2,2,2),a);return e.frustumCulled=!1,e.renderOrder=-1e3,e.name="sky",e}const zt=bi();function er(){const a=(t,s,n)=>{const i=[];for(let o=0;o<s;o++){const r=[];for(let c=0;c<n;c++)r.push(t[o*n+c].toFixed(4));i.push(`vec${n}(${r.join(",")})`)}return i.join(`,
  `)},e=zt.count;return`
const int NBIOME = ${e};
const vec3 B_GROUND[${e}] = vec3[${e}](
  ${a(zt.ground,e,3)}
);
const vec3 B_ROCK[${e}] = vec3[${e}](
  ${a(zt.rock,e,3)}
);
const vec3 B_FOLIAGE[${e}] = vec3[${e}](
  ${a(zt.foliage,e,3)}
);
const vec3 B_HAZE[${e}] = vec3[${e}](
  ${a(zt.haze,e,3)}
);
// x hazeMul, y dryness, z snow, w wet
const vec4 B_SCAL[${e}] = vec4[${e}](
  ${a(zt.scal,e,4)}
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
`;function nr(){const a=kt({cshSpan:9200,cloudDeck:980});return new ge({glslVersion:"300 es",uniforms:Ae(),vertexShader:_e(tr),fragmentShader:Ne(pe,me,er(),qs,a,Kt,Rt,sr),side:Cn})}const or=5,ir=1.02,ar=.75,eo=.62,rr=1.4,to=.85,cr=.38,lr=.36,hr=.44,so=.1,ur=.14,dr=.06,fr=`
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
}`,no=`
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
}`;function Lt(a,e,t=[]){return new ge({glslVersion:"300 es",uniforms:Ae(e),vertexShader:_e(fr),fragmentShader:Ne(...t,a),depthTest:!1,depthWrite:!1})}class wr{constructor(e,{width:t,height:s,pixelRatio:n=1,renderScale:i=1,bloomLevels:o=or}={}){this.renderer=e,this.pixelRatio=n,this.renderScale=i,this.bloomLevels=Math.max(1,o|0),this.speed=0,this.limit=0,this.exposure=1,this.bloom=1,this.paint=1,this._quality=1,e.toneMapping=Xs,e.outputColorSpace=ze;const r=e.getContext(),c=!!(r.getExtension("EXT_color_buffer_half_float")||r.getExtension("EXT_color_buffer_float"));this._type=c?vn:gn,c||console.error("[post] no renderable half-float target; HDR bloom disabled (threshold 1.02 is unreachable on an 8-bit buffer)"),this._quadGeo=new tt,this._quadGeo.setAttribute("position",new H(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),this._quadGeo.setAttribute("uv",new H(new Float32Array([0,0,2,0,0,2]),2)),this._quadGeo.boundingSphere=new st(new Z,10),this._quadCam=new zn,this._quadScene=new Ks,this._quadMesh=new Me(this._quadGeo,null),this._quadMesh.frustumCulled=!1,this._quadScene.add(this._quadMesh),this._bright=Lt(pr,{uSrc:{value:null},uThresh:{value:ir},uSoft:{value:ar}}),this._downMats=[],this._upMats=[];for(let l=1;l<this.bloomLevels;l++)this._downMats.push(Lt(no,{uSrc:{value:null},uTexel:{value:new ce(1,1)}})),this._upMats.push(Lt(mr,{uSrc:{value:null},uPrev:{value:null},uTexel:{value:new ce(1,1)},uRadius:{value:rr}}));this._softDown=Lt(no,{uSrc:{value:null},uTexel:{value:new ce(1,1)}}),this._blurMats=[0,1].map(l=>Lt(vr,{uSrc:{value:null},uTexel:{value:new ce(1,1)},uDir:{value:new ce(l?0:1,l?1:0)}})),this._composite=Lt(gr,{uScene:{value:null},uBloom:{value:null},uSoft:{value:null},uRes:{value:new ce(1,1)},uExposure:{value:1},uBloomAmt:{value:eo},uPaint:{value:1},uCA:{value:1},uVignette:{value:to},uGrain:{value:1},uRadial:{value:0},uVigSpeed:{value:so},uCALimit:{value:0}},[pe,me]),this._sceneRT=null,this._bloomRTs=[],this._upRTs=[],this._softRTs=[],this.setSize(t,s)}get quality(){return this._quality}set quality(e){const t=Math.min(1,Math.max(.5,e));t!==this._quality&&(this._quality=t,this._buildBloom())}get target(){return this._sceneRT}get bufferWidth(){return this._w}get bufferHeight(){return this._h}setSize(e,t){const s=this.pixelRatio*this.renderScale,n=Math.max(16,Math.floor(e*s)),i=Math.max(16,Math.floor(t*s));this._sceneRT&&n===this._w&&i===this._h||(this._w=n,this._h=i,this._sceneRT&&this._sceneRT.dispose(),this._sceneRT=new hs(n,i,{type:this._type,format:us,minFilter:be,magFilter:be,wrapS:Pe,wrapT:Pe,depthBuffer:!0,stencilBuffer:!1,samples:0}),this._composite.uniforms.uRes.value.set(n,i),this._softRTs.forEach(o=>o.dispose()),this._softRTs=[0,1].map(()=>this._mkRT(Math.max(2,n>>3),Math.max(2,i>>3))),this._blurMats.forEach(o=>o.uniforms.uTexel.value.set(1/this._softRTs[0].width,1/this._softRTs[0].height)),this._buildBloom())}_mkRT(e,t){return new hs(e,t,{type:this._type,format:us,minFilter:be,magFilter:be,wrapS:Pe,wrapT:Pe,depthBuffer:!1,stencilBuffer:!1})}_buildBloom(){this._bloomRTs.forEach(s=>s.dispose()),this._upRTs.forEach(s=>s.dispose()),this._bloomRTs=[],this._upRTs=[];let e=Math.max(2,Math.floor(this._w*this._quality)>>1),t=Math.max(2,Math.floor(this._h*this._quality)>>1);for(let s=0;s<this.bloomLevels;s++)this._bloomRTs.push(this._mkRT(e,t)),this._upRTs.push(this._mkRT(e,t)),e=Math.max(2,e>>1),t=Math.max(2,t>>1)}_blit(e,t){this._quadMesh.material=e,this.renderer.setRenderTarget(t||null),this.renderer.render(this._quadScene,this._quadCam)}render(e,t){const s=this.renderer;s.toneMapping!==Xs&&(s.toneMapping=Xs),s.outputColorSpace!==ze&&(s.outputColorSpace=ze),s.setRenderTarget(this._sceneRT),s.render(e,t),this._bright.uniforms.uSrc.value=this._sceneRT.texture,this._blit(this._bright,this._bloomRTs[0]);const n=this._bloomRTs.length;for(let c=1;c<n;c++){const l=this._downMats[c-1];l.uniforms.uSrc.value=this._bloomRTs[c-1].texture,l.uniforms.uTexel.value.set(1/this._bloomRTs[c-1].width,1/this._bloomRTs[c-1].height),this._blit(l,this._bloomRTs[c])}for(let c=0;c<n-1;c++){const l=n-2-c,h=this._upMats[c];h.uniforms.uSrc.value=c===0?this._bloomRTs[n-1].texture:this._upRTs[l+1].texture,h.uniforms.uPrev.value=this._bloomRTs[l].texture,h.uniforms.uTexel.value.set(1/this._upRTs[l].width,1/this._upRTs[l].height),this._blit(h,this._upRTs[l])}this._softDown.uniforms.uSrc.value=this._sceneRT.texture,this._softDown.uniforms.uTexel.value.set(1/this._softRTs[0].width,1/this._softRTs[0].height),this._blit(this._softDown,this._softRTs[0]),this._blurMats[0].uniforms.uSrc.value=this._softRTs[0].texture,this._blit(this._blurMats[0],this._softRTs[1]),this._blurMats[1].uniforms.uSrc.value=this._softRTs[1].texture,this._blit(this._blurMats[1],this._softRTs[0]);const i=Math.min(1,Math.max(0,this.speed)),o=Math.min(1,Math.max(0,this.limit)),r=this._composite.uniforms;r.uScene.value=this._sceneRT.texture,r.uBloom.value=(n>1?this._upRTs[0]:this._bloomRTs[0]).texture,r.uSoft.value=this._softRTs[0].texture,r.uExposure.value=this.exposure,r.uBloomAmt.value=eo*this.bloom,r.uPaint.value=this.paint,r.uCA.value=this.paint,r.uVignette.value=to,r.uGrain.value=this.paint,r.uRadial.value=cr*i*i*xr(lr,hr,i),r.uVigSpeed.value=so+ur*i,r.uCALimit.value=dr*o*o,this._blit(this._composite,null)}dispose(){this._sceneRT&&this._sceneRT.dispose(),this._bloomRTs.forEach(e=>e.dispose()),this._upRTs.forEach(e=>e.dispose()),this._softRTs.forEach(e=>e.dispose()),this._sceneRT=null,this._bloomRTs=[],this._upRTs=[],this._softRTs=[],[this._bright,this._softDown,this._composite,...this._downMats,...this._upMats,...this._blurMats].forEach(e=>e.dispose()),this._quadGeo.dispose(),this._quadScene.remove(this._quadMesh),this._quadMesh.material=null}}function xr(a,e,t){const s=Math.min(1,Math.max(0,(t-a)/(e-a)));return s*s*(3-2*s)}const Q=Math.PI*2,It=Math.PI/180,K=(a,e,t)=>a<e?e:a>t?t:a,D=a=>a<0?0:a>1?1:a,F=(a,e,t)=>a+(e-a)*t,ke=(a,e,t)=>{const s=D((t-a)/(e-a));return s*s*(3-2*s)};function Bs(a,e){let t=(e-a)%Q;return t>Math.PI&&(t-=Q),t<=-Math.PI&&(t+=Q),t}function Se(a,e,t,s){return F(a,e,1-Math.exp(-t*s))}function br(a,e,t,s){return a+Bs(a,e)*(1-Math.exp(-t*s))}function ye(a,e,t=0){let s=Math.imul(a|0,2376512323)^Math.imul(e|0,3625334849)^Math.imul(t|0,3407524639);return s=Math.imul(s^s>>>15,739982445),s=Math.imul(s^s>>>12,695872825),(s^s>>>15)>>>0}function _i(a,e,t,s=0){let n=Math.imul(a|0,2376512323)^Math.imul(e|0,3625334849)^Math.imul(t|0,3407524639)^Math.imul(s|0,374761393);return n=Math.imul(n^n>>>13,1540483477),(n^n>>>15)>>>0}function qt(a){let e=a>>>0;return()=>{e=e+1831565813|0;let t=Math.imul(e^e>>>15,1|e);return t=t+Math.imul(t^t>>>7,61|t)^t,((t^t>>>14)>>>0)/4294967296}}function yr(a,e){return Math.sqrt(a*a+e*e)}function oo(a,e,t,s,n,i){const o=n-t,r=i-s,c=o*o+r*r;let l=c>0?((a-t)*o+(e-s)*r)/c:0;l=D(l);const h=t+o*l,u=s+r*l;return{d:yr(a-h,e-u),t:l,x:h,z:u}}function ys(a,e,t,s,n){const i=n*n,o=i*n;return(2*o-3*i+1)*a+(o-2*i+n)*e+(-2*o+3*i)*t+(o-i)*s}const _r=9200,Mr=980,Tr=4,Sr=.1,Ar=`
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
  vec3 wetBed = mix(${R.wetStone}, K_W_SHALLOW, 0.45) * mix(0.80, 1.06, mix(0.5, bedN, bandLimit(fw, vec2(0.55))));
  body = mix(wetBed, body, smoothstep(0.02, 0.22, bedDepth));
  // caustic light rocking over the shallow bed
  vec2 dc = q - drift*0.471;   // 0.8/1.7
  float caus = pn2(vec2(dc.x*1.7, dc.y*2.9 + uTime*0.5));
  caus = pow(clamp(caus*0.5 + 0.5, 0.0, 1.0), 3.0);
  body += ${R.wSpark}*caus*0.20*(1.0 - smoothstep(0.05, 0.40, bedDepth))*sh*bandLimit(fw, vec2(1.7, 2.9));

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
    col = mix(col, mix(${R.wDeepShade}, ${R.wSpark}, bright),
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
  col += ${R.wSpark} * (glint*2.6 + broad*0.42) * sh * (0.35 + 0.75*glitterPath);

  // ── shore foam ─────────────────────────────────────────────────────────────
  // Keyed off the measured depth, so the foam band is a genuine contour of the bed and
  // widens by itself wherever the shore shelves gently.
  float edge = 1.0 - smoothstep(0.0, 1.25, depth);
  vec2 ds = q - drift*0.824;   // 0.7/0.85
  float scallop = mix(0.5, pn2(vec2(ds.x*0.85, ds.y*2.2))*0.5 + 0.5, bandLimit(fw, vec2(0.85, 2.2)));
  float foam = clamp(smoothstep(0.42, 0.96, edge*(0.50 + 0.95*scallop)), 0.0, 1.0);
  col = mix(col, ${R.wFoam}*mix(0.80, 1.10, scallop), foam*0.55);

  // cat's paws darken the surface where a gust touches down
  col *= mix(1.0, 0.86, smoothstep(0.75, 1.6, gust));

  col += K_SUN * pow(clamp(dot(V,-uSunDir), 0.0, 1.0), 5.0) * 0.16 * sh;
  col = aerial(col, vDist, V, P.y);
  fragColor = vec4(SAFE3(col), gFogAmt);
}
`;function Rr(a){const e=ye(11433,4574,a)/4294967296*Q,t={x:Math.cos(e),z:Math.sin(e)},s=kt({cshSpan:_r,cloudDeck:Mr});return new ge({glslVersion:"300 es",uniforms:Ae(),vertexShader:_e(Ar),fragmentShader:Ne(pe,me,qs,s,Kt,Rt,kr(t)),transparent:!1,side:et})}const io=new Map;function Er(a){let e=io.get(a);if(e)return e;e=new Uint16Array((a-1)*(a-1)*6);let t=0;for(let s=0;s<a-1;s++)for(let n=0;n<a-1;n++){const i=s*a+n,o=i+1,r=i+a,c=r+1;e[t++]=i,e[t++]=r,e[t++]=o,e[t++]=o,e[t++]=r,e[t++]=c}return io.set(a,e),e}const ao=a=>`${a.level}:${a.cx},${a.cz}`;class Cr{constructor({seed:e,scene:t}){this.seed=e>>>0,this.scene=t,this.material=Rr(this.seed),this.group=new mt,this.group.name="water",this.group.matrixAutoUpdate=!1,t.add(this.group),this.planes=new Map,this.stats={live:0,visible:0},this._cullT=0,this._cam=new Z}add(e){if(!e||!e.water||e.level>Tr)return;const t=ao(e);if(this.planes.has(t))return;const s=this._buildPlane(e);if(!s)return;const n=new Me(s,this.material);n.position.set(e.ox,e.water.level,e.oz),n.matrixAutoUpdate=!1,n.updateMatrix(),n.frustumCulled=!0,n.renderOrder=1,n.userData.level=e.level,this.group.add(n),this.planes.set(t,n),this.stats.live=this.planes.size}remove(e){if(!e)return;const t=ao(e),s=this.planes.get(t);s&&(this.group.remove(s),s.geometry.dispose(),this.planes.delete(t),this.stats.live=this.planes.size)}update(e,t){if(t&&this._cam.set(t.x,t.y,t.z),this._cullT-=e,this._cullT>0)return;this._cullT=Sr;const s=ee.uFogFar.value*1.25;let n=0;for(const i of this.planes.values()){const o=i.geometry.boundingSphere,r=i.position.x+o.center.x-this._cam.x,c=i.position.z+o.center.z-this._cam.z,l=s+o.radius,h=r*r+c*c<l*l;i.visible=h,h&&n++}this.stats.visible=n}dispose(){for(const e of this.planes.values())this.group.remove(e),e.geometry.dispose();this.planes.clear(),this.scene.remove(this.group),this.material.dispose(),this.stats.live=0,this.stats.visible=0}_buildPlane(e){const t=e.grid|0;if(t<3)return null;const s=this._bedReader(e,t);if(!s)return null;const n=t+1>>1,i=(t-1)/(n-1),o=e.water.level,r=e.size/(n-1),c=i*2,l=ye(e.cx,e.cz,this.seed^31358)/4294967296*Q,h=Math.cos(l),u=Math.sin(l),d=new Float32Array(n*n*3),f=new Float32Array(n*n*4);for(let m=0;m<n;m++){const v=m*i;for(let g=0;g<n;g++){const w=g*i,x=m*n+g;d[x*3]=g*r,d[x*3+1]=0,d[x*3+2]=m*r;const y=w-c<0?0:w-c,T=w+c>t-1?t-1:w+c,b=v-c<0?0:v-c,M=v+c>t-1?t-1:v+c,_=(s(T,v)-s(y,v))/((T-y)*e.step)||0,S=(s(w,M)-s(w,b))/((M-b)*e.step)||0;let k=-_,L=-S;const E=Math.sqrt(k*k+L*L);E>.001?(k/=E,L/=E):(k=h,L=u);const A=o-s(w,v);f[x*4]=A,f[x*4+1]=k,f[x*4+2]=L;const z=1-.72*D((A-1.2)/7);f[x*4+3]=(.35+2*D(E*8))*z}}const p=new tt;return p.setAttribute("position",new H(d,3)),p.setAttribute("wdat",new H(f,4)),p.setIndex(new H(Er(n),1)),p.boundingSphere=new st(new Z(e.size*.5,0,e.size*.5),e.size*.7072),p}_bedReader(e,t){const s=e.heights;if(s&&s.length>=t*t)return(o,r)=>s[r*t+o];const n=e.mesh&&e.mesh.geometry&&e.mesh.geometry.getAttribute("position");if(!n||n.count<t*t)return null;const i=n.array;return(o,r)=>i[(r*t+o)*3+1]}}const ss=9,ns=3050,Pt=ss*ns,zr=9200,ro=980,Lr=10500,bn=12800,co=1500,Dr=.35,lo=2.3,Fr=`
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
`,ho=`
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

const float DECK_PERIOD = ${Pt.toFixed(1)};

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
  op *= 1.0 - smoothstep(${Lr.toFixed(1)}, ${bn.toFixed(1)}, length(uCamPos - wc));
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
`,Mi=new Ks,Or=new zn,Br=(()=>{const a=new tt;a.setAttribute("position",new H(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),a.setAttribute("uv",new H(new Float32Array([0,0,2,0,0,2]),2)),a.boundingSphere=new st(new Z,10);const e=new Me(a,null);return e.frustumCulled=!1,Mi.add(e),e})();function uo(a,e,t){Br.material=e,a.setRenderTarget(t),a.render(Mi,Or),a.setRenderTarget(null)}function Gr(a){const e=qt(ye(23568,53445,a>>>0)),t=[];for(let h=0;h<ss;h++)for(let u=0;u<ss;u++){const d=(u-(ss-1)/2)*ns+(e()-.5)*ns*.75,f=(h-(ss-1)/2)*ns+(e()-.5)*ns*.75,p=620+e()*820,m=.72+e()*.85,v=2+(e()*3|0),g=(300+e()*230)*m;let w=0;const x=[],y=7+(e()*7|0);for(let T=0;T<y;T++){const b=e()*Q,M=Math.sqrt(e())*g,_=Math.cos(b)*M,S=Math.sin(b)*M*.72,k=e()*.1*g;x.push({x:_,y:k,z:S,rad:(.44+e()*.32)*g,seed:e()*100}),k>w&&(w=k)}for(let T=0;T<v;T++){const b=e()*Q,M=Math.sqrt(e())*g*.55,_=Math.cos(b)*M,S=Math.sin(b)*M*.7,k=(.85+e()*1.15)*g,L=4+(e()*4|0);for(let E=0;E<L;E++){const A=E/(L-1),z=A*k,N=(.52-.22*A*A+e()*.13)*g*(1-.25*A),W=(e()-.5)*g*.3*(.4+A),G=(e()-.5)*g*.3*(.4+A);if(x.push({x:_+W,y:z,z:S+G,rad:N,seed:e()*100}),z>w&&(w=z),E>0&&e()<.7){const $=e()*Q,se=N*(.55+e()*.5);x.push({x:_+W+Math.cos($)*se,y:z+(e()-.3)*N*.5,z:S+G+Math.sin($)*se,rad:N*(.42+e()*.3),seed:e()*100})}}}for(const T of x)t.push({cx:d+T.x,cy:p+T.y,cz:f+T.z,rad:T.rad,seed:T.seed,hf:w>1?K(T.y/w,0,1):.5,fx:d,fz:f})}const s=t.length,n=new Float32Array(s*4*3),i=new Float32Array(s*4*2),o=new Float32Array(s*4*3),r=new Float32Array(s*4*2);for(let h=0;h<s;h++){const u=t[h];for(let d=0;d<4;d++){const f=h*4+d;n[f*3]=u.cx,n[f*3+1]=u.cy,n[f*3+2]=u.cz,i[f*2]=d===1||d===3?1:-1,i[f*2+1]=d>=2?1:-1,o[f*3]=u.rad,o[f*3+1]=u.seed,o[f*3+2]=u.hf,r[f*2]=u.fx,r[f*2+1]=u.fz}}const c=new tt;c.setAttribute("position",new H(n,3)),c.setAttribute("corner",new H(i,2)),c.setAttribute("pdata",new H(o,3)),c.setAttribute("fcen",new H(r,2));const l=new Uint32Array(s*6);return c.setIndex(new H(l,1)),c.boundingSphere=new st(new Z(0,900,0),Pt),{geom:c,puffs:t,index:l,count:s}}class Ur{constructor({renderer:e,scene:t,seed:s}){this.renderer=e,this.scene=t,this.seed=s>>>0;const n=kt({cshSpan:zr,cloudDeck:ro});this.puffRT=new hs(1024,1024,{format:us,type:gn,minFilter:Ln,magFilter:be,generateMipmaps:!0,depthBuffer:!1});const i=new ge({glslVersion:"300 es",uniforms:Ae(),vertexShader:_e(ho),fragmentShader:Ne(pe,me,Fr),depthTest:!1,depthWrite:!1});uo(e,i,this.puffRT),i.dispose(),this.shadowRT=new hs(512,512,{format:us,type:gn,minFilter:be,magFilter:be,wrapS:Pe,wrapT:Pe,generateMipmaps:!1,depthBuffer:!1}),this.shadowMat=new ge({glslVersion:"300 es",uniforms:Ae({uCloudSh:{value:null}}),vertexShader:_e(ho),fragmentShader:Ne(pe,me,n,Ir),depthTest:!1,depthWrite:!1}),ee.uCloudSh.value=this.shadowRT.texture,this.deck=Gr(this.seed),this.material=new ge({glslVersion:"300 es",uniforms:Ae({uPuff:{value:this.puffRT.texture}}),vertexShader:_e(pe,me,n,Pr),fragmentShader:Ne(Rt,Nr),side:et,transparent:!0,depthTest:!0,depthWrite:!1,blending:ui,blendSrc:hi,blendDst:li,blendEquation:Ns,blendSrcAlpha:ci,blendDstAlpha:ri,blendEquationAlpha:Ns}),this.mesh=new Me(this.deck.geom,this.material),this.mesh.name="clouds",this.mesh.frustumCulled=!1,this.mesh.matrixAutoUpdate=!1,this.mesh.renderOrder=40,t.add(this.mesh);const o=ye(7482,49421,this.seed)/4294967296*Q;this._driftX=Math.cos(o)*lo,this._driftZ=Math.sin(o)*lo,this._sortT=0,this._dist=new Float32Array(this.deck.count),this._order=new Int32Array(this.deck.count);for(let r=0;r<this.deck.count;r++)this._order[r]=r;this.stats={puffs:this.deck.count,drawn:0},this.update(0,{x:0,y:0,z:0})}update(e,t){const s=t?t.x:0,n=t?t.y:0,i=t?t.z:0,o=ee.uTime.value;ee.uCloudDrift.value.set(this._driftX*o,this._driftZ*o),this._sortT-=e,this._sortT<=0&&(this._sortT=Dr,this._sort(s,n,i));const r=ee.uSunDir.value,c=(ro-n)/Math.max(r.y,.06);ee.uCloudShOrigin.value.set(s+r.x*c,i+r.z*c),uo(this.renderer,this.shadowMat,this.shadowRT)}_sort(e,t,s){const n=this.deck.puffs,i=this.deck.index,o=n.length,r=this._dist,c=this._order,l=ee.uCloudDrift.value.x,h=ee.uCloudDrift.value.y;for(let m=0;m<o;m++){const v=n[m],g=Math.round((e-(v.fx+l))/Pt)*Pt,w=Math.round((s-(v.fz+h))/Pt)*Pt,x=v.cx+l+g-e,y=v.cy-t,T=v.cz+h+w-s;r[m]=x*x+y*y+T*T}for(let m=1;m<o;m++){const v=c[m],g=r[v];let w=m-1;for(;w>=0&&r[c[w]]<g;)c[w+1]=c[w],w--;c[w+1]=v}const u=bn*bn;let d=0;for(let m=0;m<o;m++)r[c[m]]<=u&&d++;let f=d>co?d-co:0,p=0;for(let m=0;m<o;m++){const v=c[m];if(r[v]>u)continue;if(f>0){f--;continue}const g=v*4;i[p++]=g,i[p++]=g+1,i[p++]=g+2,i[p++]=g,i[p++]=g+2,i[p++]=g+3}this.deck.geom.index.needsUpdate=!0,this.deck.geom.setDrawRange(0,p),this.stats.drawn=p/6}dispose(){this.scene.remove(this.mesh),this.deck.geom.dispose(),this.material.dispose(),this.shadowMat.dispose(),ee.uCloudSh.value===this.shadowRT.texture&&(ee.uCloudSh.value=null),this.shadowRT.dispose(),this.puffRT.dispose(),this.stats.drawn=0}}const ds=64,os=new Float32Array(ds),is=new Float32Array(ds);for(let a=0;a<ds;a++){const e=a/ds*6.283185307179586;os[a]=Math.cos(e),is[a]=Math.sin(e)}const _s=ds-1;function $e(a,e,t=0){const s=Math.floor(a),n=Math.floor(e),i=a-s,o=e-n,r=i*i*i*(i*(i*6-15)+10),c=o*o*o*(o*(o*6-15)+10),l=ye(s,n,t)>>>20&_s,h=ye(s+1,n,t)>>>20&_s,u=ye(s,n+1,t)>>>20&_s,d=ye(s+1,n+1,t)>>>20&_s,f=os[l]*i+is[l]*o,p=os[h]*(i-1)+is[h]*o,m=os[u]*i+is[u]*(o-1),v=os[d]*(i-1)+is[d]*(o-1);return F(F(f,p,r),F(m,v,r),c)*1.42}function je(a,e,t=5,s=0,n=2.03,i=.5){let o=.5,r=1,c=0,l=0;for(let h=0;h<t;h++)c+=o*$e(a*r,e*r,s+h*1013),l+=o,o*=i,r*=n;return c/l}function yn(a,e,t=5,s=0,n=2.07,i=.5){let o=.5,r=1,c=0,l=0,h=1;for(let u=0;u<t;u++){let d=1-Math.abs($e(a*r,e*r,s+u*7919));d*=d,d*=h,h=d*1.6,h>1?h=1:h<0&&(h=0),c+=o*d,l+=o,o*=i,r*=n}return c/l*2-1}function Hr(a,e,t=4,s=0,n=2,i=.5){let o=.5,r=1,c=0,l=0;for(let h=0;h<t;h++)c+=o*Math.abs($e(a*r,e*r,s+h*3733)),l+=o,o*=i,r*=n;return c/l*2-1}function Ti(a,e,t,s,n=1){const i=je(a+5.2,e+1.3,3,s+101),o=je(a+9.7,e+4.1,3,s+227);return je(a+n*i,e+n*o,t,s)}const ht={MEADOW:0,STEPPE:1,HIGHLAND:2,DUNES:3,WETLAND:4},le=5,_n=["Meadow","Steppe","Highlands","Dunes","Wetland"],Ms=1/7200,fo=1/15500,po=1/9800,mo=1/2600;function Wr(a,e,t){const s=Ti(a*Ms,e*Ms,5,t^6699,.8),n=yn(a*Ms*1.7,e*Ms*1.7,4,t^23613);let i=D(.5+s*.62+Math.max(0,n)*.34-.06);const o=je(a*fo+41.3,e*fo-17.9,3,t^30635);let r=D(.5+o*.85-ke(.52,.95,i)*.62);const c=je(a*po-88.1,e*po+12.7,4,t^13297),l=ke(.44,.16,i);let h=D(.5+c*.9+l*.3-ke(.55,.9,i)*.25);const u=$e(a*mo,e*mo,t^40503)*.045;return i=D(i+u),r=D(r+u*1.4),h=D(h-u*1.1),{e:i,t:r,m:h}}const vo=a=>D(.5+(a-.5)*1.92);function Si(a,e,t){const s=Wr(a,e,t),n=vo(s.e),i=vo(s.t),o=D(.5+(s.t-s.m)*1.45);return{ue:n,ut:i,ua:o,e:s.e,t:s.t,m:s.m}}const Kr=[[.5,.45,.52,1.9,2.3,1.3,1],[.48,.72,.64,1.6,2.6,1.6,1.32],[.88,.45,.26,3,1.1,2,1.35],[.42,.95,.8,1.5,3.1,1.7,1.55],[.13,.12,.52,2.6,2.6,1,1.5]],Ai=new Float32Array(le),ki=new Float32Array([1,1,1,1,1]);function qr(a){for(let e=0;e<le;e++)ki[e]=a&&a[e]>0?a[e]:1}function Ri(a,e,t,s=Ai){const n=Si(a,e,t);return Mn(n,s)}function Mn(a,e=Ai){let t=0,s=0,n=-1;for(let o=0;o<le;o++){const r=Kr[o],c=(a.ue-r[0])*r[3],l=(a.ua-r[1])*r[4],h=(a.ut-r[2])*r[5],u=r[6]*ki[o]*Math.exp(-(c*c+l*l+h*h));e[o]=u,t+=u,u>n&&(n=u,s=o)}const i=1/(t||1);for(let o=0;o<le;o++)e[o]*=i;return{w:e,dominant:s,e:a.e,t:a.t,m:a.m,ue:a.ue,ua:a.ua,ut:a.ut}}const qe=[{amp:30,base:6,rough:.18,wave:460,drive:1,water:1.2},{amp:18,base:3,rough:.1,wave:900,drive:1,water:0},{amp:178,base:14,rough:.86,wave:1600,drive:1,water:.6},{amp:26,base:2,rough:.02,wave:430,drive:1,water:0},{amp:7,base:-2,rough:.05,wave:700,drive:1,water:2.5}];function $r(a,e,t,s){const n=qe[s],i=1/n.wave;switch(s){case ht.MEADOW:{const o=Ti(a*i,e*i,5,t^2577,.55),r=yn(a*i*.6,e*i*.6,3,t^2578,2,.4);return n.base+(o*.82+r*.18)*n.amp}case ht.STEPPE:{const o=je(a*i,e*i,4,t^2849,2,.42),r=$e(a*i*.35,e*i*.35,t^2850);return n.base+(o*.55+r*.45)*n.amp}case ht.HIGHLAND:{const o=yn(a*i,e*i,6,t^3121,2,.4),r=je(a*i*2.1,e*i*2.1,4,t^3122,2,.4),c=D(o*.5+.5),l=Math.pow(c,1.55)*1.62-.36;return n.base+(l*.88+r*.12)*n.amp}case ht.DUNES:{const o=Hr(a*i,e*i,4,t^3393,2,.42),r=Math.sin((a*.0121+e*.0047)*6.283+je(a*i*.5,e*i*.5,3,t^3394)*4.2);return n.base+(o*.55+r*.45)*n.amp}case ht.WETLAND:{const o=je(a*i,e*i,4,t^3665,2,.42),r=ke(.15,-.35,o);return n.base+o*n.amp-r*4.5}default:return 0}}function Pn(a,e){let t=0,s=0;for(let i=0;i<le;i++){const o=a[i];o<.02||(t+=qe[i].water*o,s+=o)}if(s<=0)return null;const n=t/s;return e<n?n:null}const ps=[{trees:26,rocks:5,bushes:16,reeds:0,posts:.6,grass:1,kinds:["broadleaf","broadleaf","poplar"]},{trees:4,rocks:8,bushes:9,reeds:0,posts:.9,grass:.72,kinds:["acacia","scrub"]},{trees:18,rocks:26,bushes:6,reeds:0,posts:.4,grass:.34,kinds:["pine","pine","deadpine"]},{trees:.5,rocks:10,bushes:2,reeds:0,posts:.25,grass:.06,kinds:["palm","scrub"]},{trees:11,rocks:2,bushes:12,reeds:34,posts:1.2,grass:.8,kinds:["willow","willow","broadleaf"]}],Js=[{surface:"tarmac",grip:1,rough:.06,width:8,lines:1},{surface:"gravel",grip:.78,rough:.3,width:9,lines:.15},{surface:"tarmac",grip:.92,rough:.14,width:6.8,lines:.8},{surface:"sand",grip:.62,rough:.42,width:10.5,lines:0},{surface:"tarmac",grip:.86,rough:.1,width:7.2,lines:.6}];function jr(a,e,t){let s=0;for(let n=0;n<le;n++)s+=a[n]*e[n][t];return s}const Ut=[{cell:1800,jitter:.34,connect:.86,width:8.6,verge:5,curve:.44,samples:14},{cell:620,jitter:.42,connect:.5,width:6.2,verge:3,curve:.62,samples:10}],Tn=1/4294967296;function yt(a,e,t,s,n){const i=Ut[t],o=ye(a,e,s^(t===0?20858:11165)),r=((o&65535)*Tn*65536-.5)*2*i.jitter,c=((o>>>16&65535)*Tn*65536-.5)*2*i.jitter;return n[0]=(a+.5+r)*i.cell,n[1]=(e+.5+c)*i.cell,n}function as(a,e,t,s,n){const i=Ut[s];return ye(a*2+t,e,n^(s===0?40001:20343))*Tn<i.connect}const Ze=[0,0],Ee=[0,0];function go(a,e,t,s,n){const i=Ut[t];yt(a,e,t,s,Ze);let o=0,r=0;as(a,e,0,t,s)&&(yt(a+1,e,t,s,Ee),o+=Ee[0]-Ze[0],r+=Ee[1]-Ze[1]),as(a-1,e,0,t,s)&&(yt(a-1,e,t,s,Ee),o+=Ze[0]-Ee[0],r+=Ze[1]-Ee[1]),as(a,e,1,t,s)&&(yt(a,e+1,t,s,Ee),o+=Ee[0]-Ze[0],r+=Ee[1]-Ze[1]),as(a,e-1,1,t,s)&&(yt(a,e-1,t,s,Ee),o+=Ze[0]-Ee[0],r+=Ze[1]-Ee[1]);const c=Math.hypot(o,r);if(c<1e-5)n[0]=i.cell,n[1]=0;else{const l=i.cell*i.curve*2/c;n[0]=o*l,n[1]=r*l}return n}const Qs=[0,0],en=[0,0];function Vr(a,e,t,s,n,i,o,r,c,l){const h=c*c,u=h*c,d=2*u-3*h+1,f=u-2*h+c,p=-2*u+3*h,m=u-h;return l[0]=d*a+f*t+p*n+m*o,l[1]=d*e+f*s+p*i+m*r,l}function Yr(a,e,t,s,n){const i=Ut[s],o=t===0?a+1:a,r=t===0?e:e+1,c=yt(a,e,s,n,[0,0]),l=yt(o,r,s,n,[0,0]);go(a,e,s,n,Qs),go(o,r,s,n,en);const h=i.samples,u=new Float32Array((h+1)*2),d=[0,0];for(let m=0;m<=h;m++)Vr(c[0],c[1],Qs[0],Qs[1],l[0],l[1],en[0],en[1],m/h,d),u[m*2]=d[0],u[m*2+1]=d[1];const p=1+((ye(a*3+t,e*7,n^30657)&255)/255-.5)*.22;return{tier:s,pts:u,y:new Float32Array(h+1),width:i.width*p,verge:i.verge,key:`${s}:${a},${e},${t}`,minX:0,maxX:0,minZ:0,maxZ:0}}function Xr(a){let e=1/0,t=-1/0,s=1/0,n=-1/0;for(let i=0;i<a.pts.length;i+=2){const o=a.pts[i],r=a.pts[i+1];o<e&&(e=o),o>t&&(t=o),r<s&&(s=r),r>n&&(n=r)}a.minX=e,a.maxX=t,a.minZ=s,a.maxZ=n}function Ei(a,e,t,s,n,i=40){const o=[];for(let r=0;r<Ut.length;r++){const c=Ut[r],l=c.cell*(.5+c.curve)+i,h=Math.floor((a-l)/c.cell),u=Math.floor((t+l)/c.cell),d=Math.floor((e-l)/c.cell),f=Math.floor((s+l)/c.cell);for(let p=d;p<=f;p++)for(let m=h;m<=u;m++)for(let v=0;v<2;v++){if(!as(m,p,v,r,n))continue;const g=Yr(m,p,v,r,n);Xr(g);const w=g.width*.5+g.verge+i;g.maxX<a-w||g.minX>t+w||g.maxZ<e-w||g.minZ>s+w||o.push(g)}}return o}const rs=18;function Ci(a,e,t=null){const s=a.y.length,n=new Float32Array(s);for(let r=0;r<s;r++)n[r]=e(a.pts[r*2],a.pts[r*2+1]);a.y.set(n);const i=a.tier===0?6:3,o=new Float32Array(s);for(let r=0;r<i;r++){for(let c=0;c<s;c++){const l=a.y[Math.max(0,c-1)],h=a.y[c],u=a.y[Math.min(s-1,c+1)];o[c]=l*.25+h*.5+u*.25}a.y.set(o)}for(let r=0;r<s;r++){const c=a.y[r]-n[r];if(c>rs?a.y[r]=n[r]+rs:c<-rs&&(a.y[r]=n[r]-rs),t){const l=t(a.pts[r*2],a.pts[r*2+1]);l!==null&&a.y[r]<l+1.1&&(a.y[r]=l+1.1)}}for(let r=1;r<s-1;r++)o[r]=a.y[r-1]*.2+a.y[r]*.6+a.y[r+1]*.2;if(o[0]=a.y[0],o[s-1]=a.y[s-1],a.y.set(o),t){for(let r=0;r<s;r++){const c=t(a.pts[r*2],a.pts[r*2+1]);c!==null&&a.y[r]<c+1.1&&(a.y[r]=c+1.1)}for(let r=1;r<s-1;r++){const c=a.y[r-1]*.25+a.y[r]*.5+a.y[r+1]*.25,l=t(a.pts[r*2],a.pts[r*2+1]);o[r]=l!==null?Math.max(c,l+1.1):c}o[0]=a.y[0],o[s-1]=a.y[s-1],a.y.set(o)}return a}class Zr{constructor(e,t,s,n,i,o,r=60,c=null){this.edges=Ei(e,t,s,n,i,r),this.seed=i,this._land=o;for(const l of this.edges)Ci(l,o,c)}query(e,t){let s=1/0,n=0,i=0,o=0,r=1,c=0,l=0,h=0,u=null;for(const d of this.edges){const f=d.width*.5+d.verge+30;if(e<d.minX-f||e>d.maxX+f||t<d.minZ-f||t>d.maxZ+f)continue;const p=d.pts,m=p.length/2-1;for(let v=0;v<m;v++){const g=p[v*2],w=p[v*2+1],x=p[v*2+2],y=p[v*2+3],T=oo(e,t,g,w,x,y);if(T.d<s){s=T.d,n=F(d.y[v],d.y[v+1],T.t),i=d.width,o=d.tier;const b=x-g,M=y-w,_=Math.hypot(b,M)||1;r=b/_,c=M/_,l=T.x,h=T.z,u=d}}}return{d:s,y:n,width:i,tier:o,tx:r,tz:c,qx:l,qz:h,edge:u}}carve(e,t,s={mask:0,y:0,edge:0,d:1/0,tier:0,tx:1,tz:0,width:0}){let n=0,i=0,o=0,r=0,c=1/0,l=0,h=0,u=1,d=0;for(const f of this.edges){const p=f.width*.5,m=p+f.verge*2.6+60;if(e<f.minX-m||e>f.maxX+m||t<f.minZ-m||t>f.maxZ+m)continue;const v=f.pts,g=v.length/2-1;let w=1/0,x=0,y=1,T=0;for(let S=0;S<g;S++){const k=v[S*2],L=v[S*2+1],E=v[S*2+2],A=v[S*2+3],z=oo(e,t,k,L,E,A);if(z.d<w){w=z.d,x=F(f.y[S],f.y[S+1],z.t);const N=E-k,W=A-L,G=Math.hypot(N,W)||1;y=N/G,T=W/G}}if(w>m)continue;const b=Math.abs(x-this._land(e,t)),M=p+3+Math.min(b,rs+4)*1.6,_=1-ke(p,M,w);_<=5e-4||(n+=_,i+=_*x,o=Math.max(o,_),w<c&&(c=w,l=f.width,h=f.tier,u=y,d=T,r=1-ke(p-.4,p+.35,w)))}return s.d=c,s.tier=h,s.tx=u,s.tz=d,s.width=l,s.mask=o,s.edge=r,s.y=n>1e-6?i/n:0,s}}const Jr=new Float32Array(le),Qr=.02;function Gs(a,e,t,s){let n=0;for(let i=0;i<le;i++){const o=s[i];o<Qr||(n+=o*$r(a,e,t,i))}return n+je(a*.055,e*.055,3,t^7949,2,.4)*.55}function zi(a,e,t){const{w:s}=Ri(a,e,t,Jr);return Gs(a,e,t,s)}const Li=a=>(e,t)=>zi(e,t,a),Di=a=>(e,t)=>{const{w:s}=Ri(e,t,a,ec);return Pn(s,Gs(e,t,a,s))},ec=new Float32Array(le),Ge=48;class tc{constructor(e,t,s,n,i,o=128){this.seed=e,this.x0=Math.floor((t-o)/Ge)*Ge,this.z0=Math.floor((s-o)/Ge)*Ge,this.nx=Math.ceil((n+o-this.x0)/Ge)+2,this.nz=Math.ceil((i+o-this.z0)/Ge)+2;const r=this.nx*this.nz;this.ue=new Float32Array(r),this.ua=new Float32Array(r),this.ut=new Float32Array(r);for(let c=0;c<this.nz;c++)for(let l=0;l<this.nx;l++){const h=Si(this.x0+l*Ge,this.z0+c*Ge,e),u=c*this.nx+l;this.ue[u]=h.ue,this.ua[u]=h.ua,this.ut[u]=h.ut}this._out={ue:0,ua:0,ut:0,e:0,t:0,m:0}}sample(e,t){const s=(e-this.x0)/Ge,n=(t-this.z0)/Ge;let i=Math.floor(s),o=Math.floor(n);i<0?i=0:i>this.nx-2&&(i=this.nx-2),o<0?o=0:o>this.nz-2&&(o=this.nz-2);const r=D(s-i),c=D(n-o),l=o*this.nx+i,h=l+1,u=l+this.nx,d=u+1,f=m=>F(F(m[l],m[h],r),F(m[u],m[d],r),c),p=this._out;return p.ue=f(this.ue),p.ua=f(this.ua),p.ut=f(this.ut),p}}class Ht{constructor(e,t,s,n,i,o=80){this.seed=e,this.climate=new tc(e,t,s,n,i,o+64),this.roads=new Zr(t,s,n,i,e,Li(e),o,Di(e)),this._carve={mask:0,y:0,edge:0,d:1/0,tier:0,tx:1,tz:0,width:0},this._wl=new Float32Array(le)}weights(e,t,s=this._wl){return Mn(this.climate.sample(e,t),s)}land(e,t){const{w:s}=this.weights(e,t);return Gs(e,t,this.seed,s)}height(e,t){const{w:s}=this.weights(e,t),n=Gs(e,t,this.seed,s),i=this.roads.carve(e,t,this._carve);if(i.mask<=.001)return n;let o=0;for(let f=0;f<le;f++)o+=s[f]*qe[f].drive;const r=i.y,c=Math.abs(n-r),l=i.width*.5,h=l+3+c*1.5,u=(1-ke(l,h,i.d))*D(o);let d=F(n,r,u);if(i.edge>.001){const f=D(i.d/l||0);d-=i.edge*f*f*.18}return d}normal(e,t,s=.6,n=[0,1,0]){const i=this.height(e-s,t),o=this.height(e+s,t),r=this.height(e,t-s),c=this.height(e,t+s),l=i-o,h=r-c,u=2*s,d=Math.hypot(l,u,h)||1;return n[0]=l/d,n[1]=u/d,n[2]=h/d,n}surface(e,t,s=null){const n=s||(this._surf||={y:0,nx:0,ny:1,nz:0,w:new Float32Array(le),dominant:0,onRoad:0,roadDist:1/0,roadTier:0,roadTx:1,roadTz:0,grip:1,rough:0,surfaceKind:"grass"}),i=Mn(this.climate.sample(e,t),n.w);n.dominant=i.dominant,n.y=this.height(e,t);const o=this.normal(e,t);n.nx=o[0],n.ny=o[1],n.nz=o[2];const r=this.roads.carve(e,t,this._carve);n.onRoad=r.edge,n.roadDist=r.d,n.roadTier=r.tier,n.roadTx=r.tx,n.roadTz=r.tz;let c=0,l=0;for(let d=0;d<le;d++)c+=n.w[d]*Js[d].grip,l+=n.w[d]*Js[d].rough;const h=F(.52,.72,n.w[0]+n.w[4]),u=F(.85,.45,n.w[0]);return n.grip=F(h,c,n.onRoad),n.rough=F(u,l,n.onRoad),n.surfaceKind=n.onRoad>.5?Js[i.dominant].surface:"ground",n}quickHeight(e,t){return this.height(e,t)}}function wo(a,e=0,t=0){const n=new Ht(a,e-3e3,t-3e3,e+3e3,t+3e3,120);let i=null;for(const o of n.roads.edges){if(o.tier!==0)continue;const r=o.pts.length/2;for(let c=1;c<r-1;c++){const l=o.pts[c*2],h=o.pts[c*2+1],u=Math.abs(o.y[c+1]-o.y[c-1]),d=Math.hypot(l-e,h-t),f=u*40+d*.01;if(!i||f<i.score){const p=o.pts[c*2+2]-o.pts[c*2-2],m=o.pts[c*2+3]-o.pts[c*2-1];i={x:l,z:h,y:n.height(l,h),heading:Math.atan2(p,m),score:f}}}}return i||{x:e,z:t,y:n.height(e,t),heading:0,score:0}}const cs=64,sc=8,nc=30,oc=a=>a<=2?65:33,ic=65,Wt=a=>cs*(1<<a);function ac(a){const{cx:e,cz:t,level:s,seed:n}=a,i=Wt(s),o=oc(s),r=e*i,c=t*i,l=i/(o-1),h=new Ht(n,r,c,r+i,c+i,Math.max(80,l*3)),u=o*o,d=(o-1)*4,f=u+d,p=new Float32Array(f*3),m=new Float32Array(f*3),v=new Uint8Array(f*4),g=new Uint8Array(f*2),w=new Float32Array(u);let x=1/0,y=-1/0,T=1/0,b=-1/0,M=!1;const _=new Float32Array(le),S={mask:0,y:0,edge:0,d:1/0,tier:0,tx:1,tz:0,width:0};for(let C=0;C<o;C++){const B=c+C*l;for(let j=0;j<o;j++){const ie=r+j*l,Y=C*o+j,oe=h.height(ie,B);w[Y]=oe,oe<x&&(x=oe),oe>y&&(y=oe),p[Y*3]=j*l,p[Y*3+1]=oe,p[Y*3+2]=C*l,h.weights(ie,B,_),v[Y*4]=_[0]*255|0,v[Y*4+1]=_[1]*255|0,v[Y*4+2]=_[2]*255|0,v[Y*4+3]=_[3]*255|0,h.roads.carve(ie,B,S),g[Y*2]=D(S.mask)*255|0,g[Y*2+1]=D(S.edge)*255|0;const he=Pn(_,oe);he!==null&&(M=!0,he<T&&(T=he),he>b&&(b=he))}}for(let C=0;C<o;C++)for(let B=0;B<o;B++){const j=C*o+B,ie=w[C*o+Math.max(0,B-1)],Y=w[C*o+Math.min(o-1,B+1)],oe=w[Math.max(0,C-1)*o+B],he=w[Math.min(o-1,C+1)*o+B],ue=B===0||B===o-1?l:l*2,nt=C===0||C===o-1?l:l*2;let X=(ie-Y)/ue,Oe=(oe-he)/nt;const Be=Math.hypot(X,1,Oe);m[j*3]=X/Be,m[j*3+1]=1/Be,m[j*3+2]=Oe/Be}const L=(o-1)*(o-1)*6+d*6,E=f>65535?Uint32Array:Uint16Array,A=new E(L);let z=0;for(let C=0;C<o-1;C++)for(let B=0;B<o-1;B++){const j=C*o+B,ie=j+1,Y=j+o,oe=Y+1;((B^C)&1)===0?(A[z++]=j,A[z++]=Y,A[z++]=ie,A[z++]=ie,A[z++]=Y,A[z++]=oe):(A[z++]=j,A[z++]=Y,A[z++]=oe,A[z++]=j,A[z++]=oe,A[z++]=ie)}let N=u;const W=C=>{const B=C*3;return p[N*3]=p[B],p[N*3+1]=p[B+1]-nc,p[N*3+2]=p[B+2],m[N*3]=m[B],m[N*3+1]=m[B+1],m[N*3+2]=m[B+2],v[N*4]=v[C*4],v[N*4+1]=v[C*4+1],v[N*4+2]=v[C*4+2],v[N*4+3]=v[C*4+3],g[N*2]=g[C*2],g[N*2+1]=g[C*2+1],N++},G=[];for(let C=0;C<o-1;C++)G.push(C);for(let C=0;C<o-1;C++)G.push(C*o+(o-1));for(let C=o-1;C>0;C--)G.push((o-1)*o+C);for(let C=o-1;C>0;C--)G.push(C*o);const $=G.map(W);for(let C=0;C<G.length;C++){const B=G[C],j=G[(C+1)%G.length],ie=$[C],Y=$[(C+1)%G.length];A[z++]=B,A[z++]=ie,A[z++]=j,A[z++]=j,A[z++]=ie,A[z++]=Y}let se=null;return M&&(se={level:(T+b)*.5,minY:x,maxY:y}),{cx:e,cz:t,level:s,size:i,ox:r,oz:c,step:l,grid:o,minY:x,maxY:y,vertCount:f,position:p,normal:m,biome:v,road:g,index:A,heights:s===0?w:null,water:se}}const fs=2,Fi=["trees","rocks","bushes","reeds","posts"],rc={trees:1414677829,rocks:1380926283,bushes:1112888136,reeds:1380271428,posts:1347375956},cc=.7,lc=34,hc=6,Fs={},Ii={},Pi={};for(const a of Fi){let e=0;for(let t=0;t<le;t++)e=Math.max(e,ps[t][a]);Fs[a]=a==="posts"?lc:Math.sqrt(1e4*cc/e),Ii[a]=Fs[a]*Fs[a],Pi[a]=a==="posts"?hc:1}const uc={trees:Math.cos(34*It),rocks:Math.cos(58*It),bushes:Math.cos(42*It),reeds:Math.cos(12*It),posts:Math.cos(24*It)},Ts=.15,Ni=26,dc=1.6,Ss=2,fc={trees:(a,e,t)=>a<=Ts&&e>=t*.5+2.5,bushes:(a,e,t)=>a<=Ts&&e>=t*.5+1.4,rocks:(a,e,t)=>a<=Ts&&e>=t*.5+1.2,reeds:a=>a<=Ts,posts:(a,e)=>a<=.05&&e<=Ni},pc={trees:(a,e)=>e===null||a>=e+.9,bushes:(a,e)=>e===null||a>=e+.5,rocks:(a,e)=>e===null||a>=e-.6,posts:(a,e)=>e===null||a>=e+.3,reeds:(a,e)=>e!==null&&e-a<=dc&&e-a>=-.35};function mc(a,e){let t=0;for(let s=0;s<le;s++)if(t+=a[s],e<t)return s;return le-1}function Vt(a,e,t,s,n,i,o,r,c){const l=Fs[a],h=Ii[a],u=Pi[a],d=rc[a],f=uc[a],p=fc[a],m=pc[a],v=Math.floor(s/l),g=Math.floor((s+i-1e-6)/l),w=Math.floor(n/l),x=Math.floor((n+i-1e-6)/l);for(let y=w;y<=x;y++)for(let T=v;T<=g;T++){const b=qt(_i(T,y,d,t)),M=(T+b())*l,_=(y+b())*l;if(M<s||M>=s+i||_<n||_>=n+i)continue;const S=e.weights(M,_);o.set(S.w);const k=S.dominant,L=jr(o,ps,a);if(b()>=L*h*u/1e4)continue;const E=e.roads.carve(M,_);if(!p(E.edge,E.d,E.width))continue;const A=e.height(M,_),z=Pn(o,-1/0);if(!m(A,z))continue;const N=(A-e.height(M+Ss,_))/Ss,W=(A-e.height(M,_+Ss))/Ss,G=1/Math.hypot(N,1,W);G<f||(r.x=M,r.z=_,r.y=A,r.ny=G,r.dominant=k,r.wy=z,r.onRoad=E.edge,r.roadD=E.d,r.roadW=E.width,r.roadTx=E.tx,r.roadTz=E.tz,c(r,b))}}function Oi({cx:a,cz:e,level:t,seed:s}){const n={trees:[],rocks:[],bushes:[],reeds:[],posts:[]};if(!(t>=0)||t>fs)return n;const i=Wt(t),o=a*i,r=e*i,c=new Ht(s,o,r,o+i,r+i,Math.max(Ni+16,i*.25)),l=new Float32Array(le),h={x:0,z:0,y:0,ny:1,wy:null,dominant:0,onRoad:0,roadD:1/0,roadW:0,roadTx:1,roadTz:0};return Vt("trees",c,s,o,r,i,l,h,(u,d)=>{const f=ps[mc(l,d())].kinds;n.trees.push({x:u.x,y:u.y,z:u.z,yaw:d()*Q,scale:.72+d()*.66,kind:f[d()*f.length|0],hue:d(),biome:u.dominant})}),Vt("bushes",c,s,o,r,i,l,h,(u,d)=>{n.bushes.push({x:u.x,y:u.y,z:u.z,yaw:d()*Q,scale:.62+d()*.7,kind:"scrub",hue:d(),biome:u.dominant})}),Vt("rocks",c,s,o,r,i,l,h,(u,d)=>{const f=d();n.rocks.push({x:u.x,y:u.y,z:u.z,yaw:d()*Q,scale:.34+Math.pow(d(),2.4)*3.1,kind:f<.58?"boulder":f<.86?"slab":"shard",tilt:(d()-.5)*(f<.58?.5:f<.86?.9:.3),hue:d(),biome:u.dominant})}),Vt("reeds",c,s,o,r,i,l,h,(u,d)=>{n.reeds.push({x:u.x,y:u.y,z:u.z,yaw:d()*Q,scale:.6+d()*.7,kind:"reed",hue:d(),depth:u.wy-u.y,biome:u.dominant})}),Vt("posts",c,s,o,r,i,l,h,(u,d)=>{const f=u.roadD<u.roadW*.5+3.5;n.posts.push({x:u.x,y:u.y,z:u.z,yaw:f?Math.atan2(u.roadTx,u.roadTz)+Math.PI*.5:d()*Q,scale:f?.85+d()*.3:.7+d()*.5,kind:f?d()<.12?"milestone":"marker":"fence",lean:(d()-.5)*.16,hue:d(),biome:u.dominant})}),n}function vc(a){if(!(a>=0)||a>fs)return 0;const e=Wt(a)*Wt(a);let t=0;for(const s of Fi){let n=0;for(let i=0;i<le;i++)n=Math.max(n,ps[i][s]);t+=n}return Math.ceil(t*e/1e4)}ee.uMeanWind||(ee.uMeanWind={value:new ce(3,1)});ee.uWindSpan||(ee.uWindSpan={value:0});const gc=9200,wc=()=>({pos:[],nrm:[],clm:[],flx:[],hue:[],idx:[],n:0});function Bi(a,e,t,s,n,i,o,r,c,l,h,u){return a.pos.push(e,t,s),a.nrm.push(n,i,o),a.clm.push(r,c,l),a.flx.push(h),a.hue.push(u),a.n++}function xc(a){const e=new di;e.setAttribute("position",new H(new Float32Array(a.pos),3)),e.setAttribute("nrm",new H(new Float32Array(a.nrm),3)),e.setAttribute("clm",new H(new Float32Array(a.clm),3)),e.setAttribute("flx",new H(new Float32Array(a.flx),1)),e.setAttribute("hue",new H(new Float32Array(a.hue),1));const t=a.n>65535?Uint32Array:Uint16Array;return e.setIndex(new H(new t(a.idx),1)),e}function Le(a,e,t,s,n){const i=[];for(let o=0;o<e.length;o++){const r=e[o];let c;o===0?c=[e[1][0]-r[0],e[1][1]-r[1],e[1][2]-r[2]]:o===e.length-1?c=[r[0]-e[o-1][0],r[1]-e[o-1][1],r[2]-e[o-1][2]]:c=[e[o+1][0]-e[o-1][0],e[o+1][1]-e[o-1][1],e[o+1][2]-e[o-1][2]];const l=Math.hypot(c[0],c[1],c[2])||1;c=[c[0]/l,c[1]/l,c[2]/l];let h=[0,1,0];Math.abs(c[1])>.94&&(h=[1,0,0]);let u=[c[1]*h[2]-c[2]*h[1],c[2]*h[0]-c[0]*h[2],c[0]*h[1]-c[1]*h[0]];const d=Math.hypot(u[0],u[1],u[2])||1;u=[u[0]/d,u[1]/d,u[2]/d];const f=[c[1]*u[2]-c[2]*u[1],c[2]*u[0]-c[0]*u[2],c[0]*u[1]-c[1]*u[0]],p=[],m=Math.pow(K(o/(e.length-1),0,1),1.6)*.55;for(let v=0;v<s;v++){const g=v/s*Q,w=Math.cos(g),x=Math.sin(g),y=1+Math.sin(g*3+o)*.09+Math.cos(g*5-o*.7)*.05,T=t[o]*y,b=u[0]*w+f[0]*x,M=u[1]*w+f[1]*x,_=u[2]*w+f[2]*x;p.push(Bi(a,r[0]+b*T,r[1]+M*T,r[2]+_*T,b,M,_,r[0],r[1],r[2],m,n))}i.push(p)}for(let o=0;o<i.length-1;o++)for(let r=0;r<s;r++){const c=i[o][r],l=i[o][(r+1)%s],h=i[o+1][r],u=i[o+1][(r+1)%s];a.idx.push(c,h,l,l,h,u)}}const tn=(()=>{const a=(1+Math.sqrt(5))/2,e=[[-1,a,0],[1,a,0],[-1,-a,0],[1,-a,0],[0,-1,a],[0,1,a],[0,-1,-a],[0,1,-a],[a,0,-1],[a,0,1],[-a,0,-1],[-a,0,1]].map(o=>{const r=Math.hypot(o[0],o[1],o[2]);return[o[0]/r,o[1]/r,o[2]/r]}),t=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]],s=(o,r)=>{const c=[],l={},h=(u,d)=>{const f=u<d?`${u}_${d}`:`${d}_${u}`;if(l[f]!==void 0)return l[f];const p=[(o[u][0]+o[d][0])/2,(o[u][1]+o[d][1])/2,(o[u][2]+o[d][2])/2],m=Math.hypot(p[0],p[1],p[2]);return o.push([p[0]/m,p[1]/m,p[2]/m]),l[f]=o.length-1,l[f]};for(const u of r){const d=h(u[0],u[1]),f=h(u[1],u[2]),p=h(u[2],u[0]);c.push([u[0],d,p],[u[1],f,d],[u[2],p,f],[d,f,p])}return c},n={v:e.map(o=>o.slice()),f:t.map(o=>o.slice())};n.f=s(n.v,n.f);const i={v:n.v.map(o=>o.slice()),f:n.f.map(o=>o.slice())};return i.f=s(i.v,i.f),{L0:{v:e,f:t},L1:n,L2:i}})();function Ue(a,e,t,s,n,i,o,r,c,l){const h=l>=2?tn.L2:l>=1?tn.L1:tn.L0,u=a.n,d=qt(r*7919|0),f=[d()*10,d()*10,d()*10];for(const p of h.v){const m=1+.2*Math.sin(p[0]*4.1+f[0])*Math.sin(p[1]*3.7+f[1])+.14*Math.sin(p[2]*6.3+f[2])*Math.cos(p[0]*5.1+f[1])+.09*$e(p[0]*3.4+f[0],p[2]*3.4+f[2]);Bi(a,e+p[0]*n*m,t+p[1]*i*m,s+p[2]*o*m,p[0],p[1],p[2],e,t,s,1,c)}for(const p of h.f)a.idx.push(u+p[0],u+p[1],u+p[2])}const $s={broadleaf:{h:11.5,flex:1},poplar:{h:15,flex:.8},pine:{h:14.5,flex:.52},deadpine:{h:13,flex:.26},acacia:{h:9.5,flex:.9},scrub:{h:2.5,flex:1.25},palm:{h:12.5,flex:1.6},willow:{h:9.5,flex:1.75}},bc=Object.keys($s);function yc(a,e,t){const s=wc(),n=qt(t),i=a==="poplar"?13+n()*5:a==="pine"?12+n()*6:a==="deadpine"?11+n()*5:a==="acacia"?8+n()*3.5:a==="palm"?10+n()*5:a==="scrub"?1.9+n()*1.3:a==="willow"?8+n()*3:10+n()*4,o=e>=2?8:e>=1?6:4,r=Math.max(0,e-1);if(a==="pine"){const c=[],l=[];for(let u=0;u<=6;u++){const d=u/6;c.push([Math.sin(d*2.1)*.35*d*i*.06,d*i,Math.cos(d*1.7)*.3*d*i*.06]),l.push(F(i*.035,i*.006,d))}Le(s,c,l,o,0);const h=e>=1?6:4;for(let u=0;u<h;u++){const d=.3+.68*(u/(h-1)),f=(1-d)*i*.3+i*.05;Ue(s,0,d*i+i*.04,0,f,f*.36,f,t+u*13,.15+n()*.7,r)}}else if(a==="poplar"){const c=[],l=[];for(let u=0;u<=7;u++){const d=u/7;c.push([Math.sin(d*3)*.5,d*i,Math.cos(d*2.2)*.45]),l.push(F(i*.028,i*.005,d))}Le(s,c,l,o,0);const h=e>=1?9:5;for(let u=0;u<h;u++){const d=.2+.78*(u/(h-1)),f=i*(.17-.08*Math.abs(d-.55)*1.4);Ue(s,Math.sin(d*7)*.5,d*i,Math.cos(d*6)*.45,f*.9,f*1.35,f*.9,t+u*29,.2+n()*.7,r)}}else if(a==="willow"){const c=[],l=[];for(let u=0;u<=5;u++){const d=u/5;c.push([d*d*1.7,d*i*.72,Math.sin(d*2)*.6]),l.push(F(i*.05,i*.012,d))}Le(s,c,l,o,0);const h=e>=1?12:6;for(let u=0;u<h;u++){const d=n()*Q,f=Math.sqrt(n())*i*.42,p=Math.cos(d)*f+1.5,m=Math.sin(d)*f,v=i*.62+(n()-.3)*i*.22,g=i*(.13+n()*.09);Ue(s,p,v,m,g*1.15,g*.8,g*1.15,t+u*37,.5+n()*.5,r),e>=1&&Ue(s,p*1.05,v-g*1.5,m*1.05,g*.55,g*1.5,g*.55,t+u*41,.6+n()*.4,r)}}else if(a==="deadpine"){const c=[],l=[],h=(n()-.5)*.9;for(let d=0;d<=6;d++){const f=d/6;c.push([h*f*f*i*.1,f*i,Math.sin(f*2.7)*.4]),l.push(F(i*.032,i*.012,Math.pow(f,.75)))}Le(s,c,l,o,0);const u=e>=2?7:e>=1?5:3;for(let d=0;d<u;d++){const f=.34+.58*(d/Math.max(1,u-1)),p=d*2.399+n()*.6,m=i*(.3-.16*f)*(.7+n()*.6),v=[],g=[];for(let w=0;w<=2;w++){const x=w/2;v.push([Math.cos(p)*m*x,f*i+x*m*.42-x*x*m*.5,Math.sin(p)*m*x]),g.push(F(i*.012,i*.003,x))}Le(s,v,g,Math.max(3,o-3),0)}if(e>=1)for(let d=0;d<2;d++){const f=n()*Q,p=i*(.09+n()*.05);Ue(s,Math.cos(f)*i*.1,i*(.68+d*.16),Math.sin(f)*i*.1,p,p*.22,p,t+d*61,n()*.25,r)}}else if(a==="acacia"){const c=[],l=[],h=(n()-.5)*.4;for(let p=0;p<=5;p++){const m=p/5;c.push([h*m*m*i*.2,m*i*.6,Math.cos(m*2.1)*.3]),l.push(F(i*.055,i*.02,m))}Le(s,c,l,o,0);const u=e>=1?5:3,d=i*.52;for(let p=0;p<u;p++){const m=p/u*Q+n()*.8,v=d*(.72+n()*.3),g=[],w=[];for(let x=0;x<=3;x++){const y=x/3;g.push([Math.cos(m)*v*y,i*.58+Math.pow(y,.55)*i*.3,Math.sin(m)*v*y]),w.push(F(i*.02,i*.005,y))}Le(s,g,w,Math.max(3,o-2),0)}const f=e>=2?16:e>=1?10:5;for(let p=0;p<f;p++){const m=n()*Q,v=Math.pow(n(),.42)*d,g=d*(.2+n()*.16)*(1-v/d*.35);Ue(s,Math.cos(m)*v,i*.9-v*.1+(n()-.5)*i*.05,Math.sin(m)*v,g*1.25,g*.34,g*1.25,t+p*71,n(),r)}}else if(a==="scrub"){const c=e>=1?3:2;for(let h=0;h<c;h++){const u=h/c*Q+n()*1.1,d=[],f=[];for(let p=0;p<=3;p++){const m=p/3;d.push([Math.cos(u)*m*i*.22,m*i*.55,Math.sin(u)*m*i*.22]),f.push(F(i*.05,i*.018,m))}Le(s,d,f,Math.max(3,o-2),0)}const l=e>=2?9:e>=1?6:3;for(let h=0;h<l;h++){const u=n()*Q,d=Math.pow(n(),.6)*i*.42,f=i*(.24+n()*.16);Ue(s,Math.cos(u)*d,i*.52+(n()-.35)*i*.24,Math.sin(u)*d,f*1.1,f*.78,f*1.1,t+h*83,n(),r)}}else if(a==="palm"){const c=[],l=[],h=.9+n()*1.4,u=n()*Q;for(let v=0;v<=7;v++){const g=v/7,w=h*g*g;c.push([Math.cos(u)*w,g*i,Math.sin(u)*w]),l.push(F(i*.026,i*.016,g))}Le(s,c,l,o,0);const d=Math.cos(u)*h,f=Math.sin(u)*h,p=e>=2?9:e>=1?7:5,m=i*.44;for(let v=0;v<p;v++){const g=v/p*Q+n()*.35,w=.8+n()*.6;for(let x=1;x<=3;x++){const y=x/3,T=m*y,b=m*(.19-.075*y);Ue(s,d+Math.cos(g)*T,i+m*(.26*y-.62*y*y*w),f+Math.sin(g)*T,b*1.15,b*.3,b*1.15,t+v*97+x*7,.25+n()*.6,r)}}Ue(s,d,i+m*.06,f,m*.22,m*.2,m*.22,t+991,.3+n()*.3,r)}else{const c=[],l=[],h=(n()-.5)*.5;for(let p=0;p<=6;p++){const m=p/6;c.push([h*m*m*i*.14+Math.sin(m*3.4)*.35,m*i*.52,Math.cos(m*2.6)*.35]),l.push(F(i*.062,i*.026,m))}Le(s,c,l,o,0);const u=e>=2?5:e>=1?4:0;for(let p=0;p<u;p++){const m=p/u*Q+n()*.9,v=i*(.26+n()*.16),g=[],w=[];for(let x=0;x<=3;x++){const y=x/3;g.push([Math.cos(m)*v*y*.9,i*.5+y*v*.72-y*y*v*.12,Math.sin(m)*v*y*.9]),w.push(F(i*.02,i*.006,y))}Le(s,g,w,Math.max(3,o-2),0)}const d=e>=2?22:e>=1?12:7,f=i*.4;for(let p=0;p<d;p++){let m,v,g,w;if(p===0)m=0,v=i*.78,g=0,w=f*.72;else{const x=n()*Q,y=Math.pow(n(),.55)*f*1.02;m=Math.cos(x)*y,g=Math.sin(x)*y*.92,v=i*.74+(n()-.44)*f*.95-y*.2,w=f*(.26+n()*.26)}Ue(s,m,v,g,w*1.12,w*.86,w*1.12,t+p*53,n(),r)}}return s}const Gi=`
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
`;function Ui(){const a=bi(),e=[];for(let t=0;t<a.count;t++)e.push(`vec3(${a.foliage[t*3].toFixed(4)},${a.foliage[t*3+1].toFixed(4)},${a.foliage[t*3+2].toFixed(4)})`);return`
const int NFOL = ${a.count};
const vec3 B_FOLIAGE[${a.count}] = vec3[${a.count}](${e.join(",")});
`}const Hi=`
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
    vec3 base = vHue<0.26 ? ${R.cVarA} : (vHue<0.52 ? ${R.cLit} :
                (vHue<0.76 ? ${R.cVarB} : ${R.cVarC}));
    float grain = pn2(vW.xz*0.85 + vW.y*0.6)*0.5+0.5;
    lit = mix(base, ${R.cLit}, 0.42) * (1.02 + 0.24*grain);
    mid = mix(${R.cMid}, base*0.72, 0.45);
    shd = mix(${R.cShade}, ${R.cDeep}, grain*0.45);
    // Biome foliage tint: the same table the ground blends, so a highland pine and the
    // hillside it stands on go cold together.
    lit *= vTint; mid *= vTint; shd *= vTint;
    trans = 1.05; rim = 0.52;
  } else {
    float bark = pn2(vec2(atan(N.z,N.x)*3.4, vW.y*3.1))*0.5+0.5;
    vec3 wood = mix(vec3(1.0), vTint, 0.55);
    lit = ${R.trunkLit} * (0.82 + 0.34*bark) * wood;
    mid = mix(${R.trunkLit}, ${R.trunkShade}, 0.55) * wood;
    shd = ${R.trunkShade} * (0.85 + 0.3*bark) * wood;
    trans = 0.0; rim = 0.28;
  }
  // moss on the shaded north side of trunks and the underside of clumps
  float moss = smoothstep(0.15, -0.5, N.y) * (pn2(vW.xz*1.6 + vW.y)*0.5+0.5);
  shd = mix(shd, ${R.moss}*0.55, moss*0.35*(1.0-vLeaf));

  float ndl = dot(N, uSunDir);
  float sh = sunShadow(vW, ndl) * cloudShadow(vW);
  Surf s;
  s.N=N; s.V=V; s.P=vW; s.shade=shd; s.mid=mid; s.lit=lit;
  s.soft = mix(0.09, 0.20, clamp(vDist*0.004,0.0,1.0));
  s.jit = (vn2(vW.xz*3.9 + vW.y*1.7) - 0.5)*0.055;
  s.shadow = sh; s.trans = trans; s.transCol = ${R.cTrans};
  s.rim = rim; s.ao = vAO; s.ambient = 1.0;
  vec3 col = paint(s);
  col = aerial(col, vDist, V, vW.y);
  outColor = vec4(SAFE3(col), gFogAmt);
}`;function Mc(a){const e=$s[a];return new ge({glslVersion:"300 es",uniforms:Ae({uTreeH:{value:e.h},uFlex:{value:e.flex},uCullR:{value:0}}),vertexShader:_e(pe,me,Gi,Ui(),Hi),fragmentShader:Ne(pe,me,kt({cshSpan:gc}),Kt,Rt,_c),side:et})}function Tc(a,e){const t=$s[a];return new ge({glslVersion:"300 es",uniforms:Ae({uTreeH:{value:t.h},uFlex:{value:t.flex},uCullR:{value:e}}),vertexShader:_e(pe,me,Gi,Ui(),Hi),fragmentShader:In,side:et})}const Sc=1400,Ac=.92,kc=420,xo=2.6,bo=512;class Rc{constructor({seed:e,scene:t,quality:s=1,cullDistance:n=Sc,bushes:i=!0}){this.seed=e>>>0,this.scene=t,this.quality=K(s,.4,2),this.cull=n*K(this.quality,.7,1.35),this.renderBushes=i,this.group=new mt,this.group.name="flora",this.group.matrixAutoUpdate=!1,this.batches=new Map,this.chunks=new Map,this.pending=[],this.stats={chunks:0,instances:0,batches:0,attached:0,buildMs:0,backlog:0},this._cam=new Z,this._hasCam=!1,t.add(this.group)}_detailFor(e){return K(2-e-(this.quality<.75?1:0),0,2)}add(e){if(e.level>fs)return;const t=`${e.level}:${e.cx},${e.cz}`;if(this.chunks.has(t))return;const s={key:t,level:e.level,cx:e.cx,cz:e.cz,mx:e.ox+e.size*.5,mz:e.oz+e.size*.5,groups:null,blocks:null,dead:!1};this.chunks.set(t,s),this.pending.push(s),this.stats.chunks=this.chunks.size}remove(e){const t=`${e.level}:${e.cx},${e.cz}`,s=this.chunks.get(t);s&&(s.dead=!0,s.blocks&&this._detach(s),this.chunks.delete(t),this.stats.chunks=this.chunks.size)}update(e,t){t&&(this._cam.copy(t),this._hasCam=!0),this._drain(e),this._cullPass(),this._flush()}_drain(e){const t=performance.now(),s=e>1/45?xo*.45:xo;let n=0;for(;this.pending.length;){const i=this.pending[0];if(i.dead){this.pending.shift();continue}if(n>0&&performance.now()-t>s)break;this.pending.shift(),this._scatter(i),n++}this.stats.buildMs=performance.now()-t,this.stats.backlog=this.pending.length}_scatter(e){const t=Oi({cx:e.cx,cz:e.cz,level:e.level,seed:this.seed}),s=this._detailFor(e.level),n=new Map,i=(o,r,c)=>{for(let l=0;l<o.length;l++){const h=o[l],u=$s[h.kind];if(!u){console.error("[flora] no archetype for species",h.kind,"— check BIOME_SCATTER kinds");continue}const d=`${h.kind}:${r}`;let f=n.get(d);f||(f={kind:h.kind,detail:r,pos:[],vari:[],minX:1e9,maxX:-1e9,minZ:1e9,maxZ:-1e9,minY:1e9,maxY:-1e9},n.set(d,f));const p=ye(Math.round(h.x*4),Math.round(h.z*4),this.seed)/4294967296*10,m=h.y-c*h.scale;f.pos.push(h.x,m,h.z,h.scale),f.vari.push(h.yaw,h.hue,p,h.biome);const v=u.h*h.scale*1.25,g=v*.45;h.x-g<f.minX&&(f.minX=h.x-g),h.x+g>f.maxX&&(f.maxX=h.x+g),h.z-g<f.minZ&&(f.minZ=h.z-g),h.z+g>f.maxZ&&(f.maxZ=h.z+g),m<f.minY&&(f.minY=m),m+v>f.maxY&&(f.maxY=m+v)}};i(t.trees,s,.35),this.renderBushes&&e.level<=1&&i(t.bushes,Math.min(s,e.level===0?1:0),.18),e.groups=n,(!this._hasCam||this._distance(e)<=this.cull)&&this._attach(e)}_distance(e){return Math.hypot(e.mx-this._cam.x,e.mz-this._cam.z)}_batch(e,t){const s=`${e}:${t}`;let n=this.batches.get(s);if(n)return n;const i=ye(bc.indexOf(e)+1,t+1,1592598191),o=xc(yc(e,t,i)),r=Math.max(64,vc(Math.min(fs,2-t))),c=new Float32Array(r*4),l=new Float32Array(r*4),h=new dt(c,4),u=new dt(l,4);h.setUsage(bs),u.setUsage(bs),o.setAttribute("iPos",h),o.setAttribute("iVar",u),o.instanceCount=0,o.boundingSphere=new st(new Z,0);const d=new Me(o,Mc(e));return d.frustumCulled=!0,d.matrixAutoUpdate=!1,d.updateMatrix(),d.renderOrder=2,d.visible=!1,d.userData.depth=Tc(e,kc),this.group.add(d),n={key:s,kind:e,detail:t,geom:o,mesh:d,iPos:c,iVar:l,aPos:h,aVar:u,cap:r,count:0,blocks:[],dirty:!1},this.batches.set(s,n),this.stats.batches=this.batches.size,n}_reserve(e,t){if(t<=e.cap)return;let s=e.cap;for(;s<t;)s*=2;const n=new Float32Array(s*4),i=new Float32Array(s*4);n.set(e.iPos.subarray(0,e.count*4)),i.set(e.iVar.subarray(0,e.count*4)),e.aPos=new dt(n,4),e.aVar=new dt(i,4),e.aPos.setUsage(bs),e.aVar.setUsage(bs),e.geom.setAttribute("iPos",e.aPos),e.geom.setAttribute("iVar",e.aVar),e.iPos=n,e.iVar=i,e.cap=s}_attach(e){if(e.blocks||!e.groups)return;const t=[];for(const s of e.groups.values()){const n=s.pos.length/4;if(!n)continue;const i=this._batch(s.kind,s.detail);this._reserve(i,i.count+n),i.iPos.set(s.pos,i.count*4),i.iVar.set(s.vari,i.count*4);const o={batch:i,start:i.count,len:n,g:s};i.blocks.push(o),i.count+=n,i.dirty=!0,t.push(o)}e.blocks=t}_detach(e){if(e.blocks){for(const t of e.blocks){const s=t.batch,n=s.blocks.indexOf(t);if(n<0)continue;if(s.count-(t.start+t.len)>0){s.iPos.copyWithin(t.start*4,(t.start+t.len)*4,s.count*4),s.iVar.copyWithin(t.start*4,(t.start+t.len)*4,s.count*4);for(let o=n+1;o<s.blocks.length;o++)s.blocks[o].start-=t.len}s.blocks.splice(n,1),s.count-=t.len,s.dirty=!0}e.blocks=null}}_cullPass(){if(!this._hasCam)return;const e=this.cull,t=this.cull*Ac;let s=0;for(const n of this.chunks.values()){if(!n.groups)continue;const i=this._distance(n);n.blocks?i>e?this._detach(n):s++:i<=t&&(this._attach(n),s++)}this.stats.attached=s,this.chunks.size>bo&&this._evict()}_evict(){const e=[];for(const s of this.chunks.values())!s.blocks&&s.groups&&e.push(s);e.sort((s,n)=>this._distance(n)-this._distance(s));const t=Math.min(e.length,this.chunks.size-bo);for(let s=0;s<t;s++)this.chunks.delete(e[s].key);this.stats.chunks=this.chunks.size}_flush(){let e=0;for(const t of this.batches.values()){if(e+=t.count,!t.dirty||(t.dirty=!1,t.geom.instanceCount=t.count,t.mesh.visible=t.count>0,t.aPos.needsUpdate=!0,t.aVar.needsUpdate=!0,!t.count))continue;let s=1e9,n=-1e9,i=1e9,o=-1e9,r=1e9,c=-1e9;for(const h of t.blocks){const u=h.g;u.minX<s&&(s=u.minX),u.maxX>n&&(n=u.maxX),u.minZ<i&&(i=u.minZ),u.maxZ>o&&(o=u.maxZ),u.minY<r&&(r=u.minY),u.maxY>c&&(c=u.maxY)}const l=t.geom.boundingSphere;l.center.set((s+n)*.5,(r+c)*.5,(i+o)*.5),l.radius=Math.hypot(n-s,c-r,o-i)*.5}this.stats.instances=e}dispose(){for(const e of this.batches.values())this.group.remove(e.mesh),e.geom.dispose(),e.mesh.material.dispose(),e.mesh.userData.depth.dispose();this.batches.clear(),this.chunks.clear(),this.pending.length=0,this.group.parent&&this.group.parent.remove(this.group)}}const O={MATTE:0,METAL:1,EMIT:2,GLASS:3,LAMP_A:4,LAMP_B:5,LAMP_C:6},J=a=>Os[a],Mt=(a,e)=>[a[0]*e,a[1]*e,a[2]*e],Us=(a,e,t)=>[F(a[0],e[0],t),F(a[1],e[1],t),F(a[2],e[2],t)];function Hs(){return{pos:[],nrm:[],col:[],mat:[],idx:[],n:0}}function Te(a,e,t,s,n,i,o,r,c){return a.pos.push(e,t,s),a.nrm.push(n,i,o),a.col.push(r[0],r[1],r[2]),a.mat.push(c||0),a.n++}function Nn(a,e,t,s,n){a.idx.push(e,t,s,e,s,n)}function yo(a,e,t,s){a.idx.push(e,t,s)}function _o(a,e,t,s){return[a*t-e*s,a*s+e*t]}function ne(a,e,t,s,n,i,o,r,c,l){const h=Math.cos(r),u=Math.sin(r),d=(m,v,g)=>{const[w,x]=_o(m*n,g*o,h,u);return[e+w,t+v*i,s+x]},f=(m,v)=>{const[g,w]=_o(m,v,h,u);return[g,0,w]},p=[{q:[[1,-1,-1],[1,-1,1],[1,1,1],[1,1,-1]],n:f(1,0)},{q:[[-1,-1,1],[-1,-1,-1],[-1,1,-1],[-1,1,1]],n:f(-1,0)},{q:[[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]],n:[0,1,0]},{q:[[-1,-1,1],[1,-1,1],[1,-1,-1],[-1,-1,-1]],n:[0,-1,0]},{q:[[-1,-1,1],[-1,1,1],[1,1,1],[1,-1,1]],n:f(0,1)},{q:[[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,-1]],n:f(0,-1)}];for(const m of p){const v=m.q.map(g=>{const w=d(g[0],g[1],g[2]);return Te(a,w[0],w[1],w[2],m.n[0],m.n[1],m.n[2],c,l)});Nn(a,v[0],v[1],v[2],v[3])}}function Ie(a,e,t,s,n,i,o,r,c,l){let h=[t[0]-e[0],t[1]-e[1],t[2]-e[2]];const u=Math.hypot(h[0],h[1],h[2])||1;h=[h[0]/u,h[1]/u,h[2]/u];let d=[0,1,0];Math.abs(h[1])>.94&&(d=[1,0,0]);let f=[h[1]*d[2]-h[2]*d[1],h[2]*d[0]-h[0]*d[2],h[0]*d[1]-h[1]*d[0]];const p=Math.hypot(f[0],f[1],f[2])||1;f=[f[0]/p,f[1]/p,f[2]/p];const m=[h[1]*f[2]-h[2]*f[1],h[2]*f[0]-h[0]*f[2],h[0]*f[1]-h[1]*f[0]],v=[],g=[];for(let w=0;w<i;w++){const x=w/i*Q,y=Math.cos(x),T=Math.sin(x),b=f[0]*y+m[0]*T,M=f[1]*y+m[1]*T,_=f[2]*y+m[2]*T;v.push(Te(a,e[0]+b*s,e[1]+M*s,e[2]+_*s,b,M,_,o,r)),g.push(Te(a,t[0]+b*n,t[1]+M*n,t[2]+_*n,b,M,_,o,r))}for(let w=0;w<i;w++){const x=(w+1)%i;Nn(a,v[w],g[w],g[x],v[x])}if(l){const w=Te(a,t[0],t[1],t[2],h[0],h[1],h[2],o,r);for(let x=0;x<i;x++){const y=(x+1)%i,T=Te(a,a.pos[g[x]*3],a.pos[g[x]*3+1],a.pos[g[x]*3+2],h[0],h[1],h[2],o,r),b=Te(a,a.pos[g[y]*3],a.pos[g[y]*3+1],a.pos[g[y]*3+2],h[0],h[1],h[2],o,r);yo(a,w,T,b)}}if(c){const w=Te(a,e[0],e[1],e[2],-h[0],-h[1],-h[2],o,r);for(let x=0;x<i;x++){const y=(x+1)%i,T=Te(a,a.pos[v[x]*3],a.pos[v[x]*3+1],a.pos[v[x]*3+2],-h[0],-h[1],-h[2],o,r),b=Te(a,a.pos[v[y]*3],a.pos[v[y]*3+1],a.pos[v[y]*3+2],-h[0],-h[1],-h[2],o,r);yo(a,w,b,T)}}}function Ec(a,e,t){const s=e[0]-a[0],n=e[1]-a[1],i=e[2]-a[2],o=t[0]-a[0],r=t[1]-a[1],c=t[2]-a[2],l=n*c-i*r,h=i*o-s*c,u=s*r-n*o,d=Math.hypot(l,h,u);return d>1e-9?[l/d,h/d,u/d]:[0,1,0]}function bt(a,e,t,s,n,i,o,r){let c=t,l=n,h=Ec(e,t,n);r&&h[0]*r[0]+h[1]*r[1]+h[2]*r[2]<0&&(c=n,l=t,h=[-h[0],-h[1],-h[2]]);const u=Te(a,e[0],e[1],e[2],h[0],h[1],h[2],i,o),d=Te(a,c[0],c[1],c[2],h[0],h[1],h[2],i,o),f=Te(a,s[0],s[1],s[2],h[0],h[1],h[2],i,o),p=Te(a,l[0],l[1],l[2],h[0],h[1],h[2],i,o);Nn(a,u,d,f,p)}function Ws(a){const e=new tt;return e.setAttribute("position",new H(new Float32Array(a.pos),3)),e.setAttribute("nrm",new H(new Float32Array(a.nrm),3)),e.setAttribute("vcol",new H(new Float32Array(a.col),3)),e.setAttribute("vmat",new H(new Float32Array(a.mat),1)),e.setIndex(a.idx),e.computeBoundingSphere(),e}const Wi=`
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
}`}const zc=kt({cshSpan:9200,cloudDeck:980});function On({side:a=et,ghost:e=!1,opacity:t=.85,uniforms:s={}}={}){const n={uLamp:{value:new Z(0,0,0)}};e&&(n.uGhostAlpha={value:t});const i=new ge({glslVersion:"300 es",uniforms:Ae(Object.assign(n,s)),vertexShader:_e(Wi),fragmentShader:Ne(pe,me,zc,Kt,Rt,Cc(e)),side:a});return e&&(i.transparent=!0,i.depthWrite=!0,i.blending=ui,i.blendSrc=hi,i.blendDst=li,i.blendEquation=Ns,i.blendSrcAlpha=ci,i.blendDstAlpha=ri,i.blendEquationAlpha=Ns),i}function Lc(){return new ge({glslVersion:"300 es",uniforms:Ae(),vertexShader:_e(Wi),fragmentShader:In,side:et,colorWrite:!1})}const Dc=1900,Fc=.07,at=6,Ic=28,Pc=`
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
`;function Oc(){return new ge({glslVersion:"300 es",uniforms:Ae({uLineMix:{value:1},uSurfLit:{value:new Z(...Os.tarmacLit)},uSurfShade:{value:new Z(...Os.tarmacShade)}}),vertexShader:_e(Pc),fragmentShader:Ne(pe,me,qs,kt({cshSpan:9200,cloudDeck:980}),Kt,Rt,Nc),side:Cn})}function Bc(a){const e=a.pts.length/2,t=[];for(let p=0;p<e-1;p++){const m=a.pts[p*2],v=a.pts[p*2+1],g=a.pts[p*2+2],w=a.pts[p*2+3],x=Math.hypot(g-m,w-v),y=Math.max(1,Math.round(x/6));for(let T=0;T<y;T++){const b=T/y;t.push({x:F(m,g,b),z:F(v,w,b),y:F(a.y[p],a.y[p+1],b)})}}const s=e-1;t.push({x:a.pts[s*2],z:a.pts[s*2+1],y:a.y[s]});const n=t.length,i=n*at,o=new Float32Array(i*3),r=new Float32Array(i*3),c=new Float32Array(i*2),l=new Uint32Array((n-1)*(at-1)*6),h=a.width*.5;let u=0;for(let p=0;p<n;p++){const m=t[p],v=t[Math.min(p+1,n-1)],g=t[Math.max(p-1,0)];let w=v.x-g.x,x=v.z-g.z;const y=Math.hypot(w,x)||1;w/=y,x/=y;const T=x,b=-w;p>0&&(u+=Math.hypot(m.x-t[p-1].x,m.z-t[p-1].z));for(let M=0;M<at;M++){const _=M/(at-1)*2-1,S=m.x+T*_*h,k=m.z+b*_*h,L=-Math.abs(_)*Math.abs(_)*.18,E=p*at+M;o[E*3]=S,o[E*3+1]=m.y+L+Fc,o[E*3+2]=k,r[E*3]=0,r[E*3+1]=1,r[E*3+2]=0,c[E*2]=_,c[E*2+1]=u}}let d=0;for(let p=0;p<n-1;p++)for(let m=0;m<at-1;m++){const v=p*at+m,g=v+1,w=v+at,x=w+1;l[d++]=v,l[d++]=w,l[d++]=g,l[d++]=g,l[d++]=w,l[d++]=x}const f=new tt;return f.setAttribute("position",new H(o,3)),f.setAttribute("normal",new H(r,3)),f.setAttribute("aCross",new H(c,2)),f.setIndex(new H(l,1)),f.computeBoundingSphere(),{geometry:f,ring:t,half:h}}function Gc(a,e,t,s){const n=[];let i=0;for(let o=1;o<e.length;o++){const r=e[o],c=e[o-1];i+=Math.hypot(r.x-c.x,r.z-c.z);let l=r.x-c.x,h=r.z-c.z;const u=Math.hypot(l,h)||1;l/=u,h/=u;const d=h,f=-l;let p=0;const m=Math.min(o+3,e.length-1);if(m>o){let v=e[m].x-r.x,g=e[m].z-r.z;const w=Math.hypot(v,g)||1;v/=w,g/=w,p=l*g-h*v}if(i>=Ic){i=0;const v=(o&1)===0?1:-1;n.push({kind:"post",x:r.x+d*v*(t+1.5),z:r.z+f*v*(t+1.5),y:r.y,yaw:Math.atan2(l,h)})}if(Math.abs(p)>.22&&o%4===0){const v=p>0?-1:1;n.push({kind:"chevron",x:r.x+d*v*(t+2.4),z:r.z+f*v*(t+2.4),y:r.y,yaw:Math.atan2(-d*v,-f*v),flip:p>0?1:-1})}}return n}function Uc(){const a=Hs();Ie(a,[0,0,0],[0,1.05,0],.075,.065,6,[.94,.9,.82],O.MATTE,!0,!0),ne(a,0,.92,.042,.055,.11,.01,0,[.92,.32,.22],O.MATTE);const e=Hs();return Ie(e,[0,0,0],[0,1.35,0],.055,.05,6,[.42,.38,.33],O.MATTE,!0,!0),ne(e,0,1.45,0,.6,.34,.035,0,[.95,.93,.86],O.MATTE),ne(e,-.13,1.45,.04,.16,.24,.01,.5,[.18,.2,.24],O.MATTE),ne(e,.17,1.45,.04,.16,.24,.01,.5,[.18,.2,.24],O.MATTE),{post:Ws(a),chevron:Ws(e)}}class Hc{constructor({seed:e,scene:t,range:s=Dc}){this.seed=e>>>0,this.range=s,this.group=new mt,this.group.name="roads",t.add(this.group),this.material=Oc(),this.paintedMaterial=On(),this.furniture=Uc(),this.live=new Map,this._lastX=1/0,this._lastZ=1/0,this._height=Li(this.seed),this._water=Di(this.seed),this.stats={edges:0,tris:0}}update(e,t){if(Math.hypot(e-this._lastX,t-this._lastZ)<180)return;this._lastX=e,this._lastZ=t;const s=this.range,n=Ei(e-s,t-s,e+s,t+s,this.seed,40),i=new Set;for(const o of n){if(i.add(o.key),this.live.has(o.key))continue;Ci(o,this._height,this._water);const{geometry:r,ring:c,half:l}=Bc(o),h=new Me(r,this.material);h.frustumCulled=!0,h.matrixAutoUpdate=!1,h.renderOrder=1,this.group.add(h);const u=Gc(o,c,l,this.seed),d=u.filter(m=>m.kind==="post"),f=u.filter(m=>m.kind==="chevron"),p={mesh:h,instanced:[]};for(const[m,v]of[[this.furniture.post,d],[this.furniture.chevron,f]]){if(!v.length)continue;const g=new fi(m,this.paintedMaterial,v.length),w=new Bt,x=new Dn,y=new Z,T=new Z(1,1,1);v.forEach((b,M)=>{y.set(b.x,b.y,b.z),x.setFromAxisAngle(new Z(0,1,0),b.yaw),w.compose(y,x,T),g.setMatrixAt(M,w)}),g.instanceMatrix.needsUpdate=!0,g.frustumCulled=!1,this.group.add(g),p.instanced.push(g)}this.live.set(o.key,p)}for(const[o,r]of this.live)if(!i.has(o)){this.group.remove(r.mesh),r.mesh.geometry.dispose();for(const c of r.instanced)this.group.remove(c),c.dispose();this.live.delete(o)}this.stats.edges=this.live.size}dispose(){for(const[e,t]of this.live){t.mesh.geometry.dispose();for(const s of t.instanced)s.dispose();this.live.delete(e)}this.material.dispose()}}const Ki=900,Mo=2.6,ve=32,Yt=1200,Wc=24,Sn={uMeanWind:{value:new ce(3,1)}};function Kc(){return Sn}const To=`
uniform vec2 uMeanWind;   // supplied by windUniforms(), not by the shared U block
const float WIND_SPAN = ${Ki.toFixed(1)};
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
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,$c=`${yi}${Fn}
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
  vec2 p = uWindOrigin + (vUv - 0.5) * ${Ki.toFixed(1)};
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
}`;class jc{constructor(e,t={}){this.renderer=e;const s=K(t.quality??1,.4,2),n=Math.max(128,Math.round((t.res??320)*Math.sqrt(s))&-2);this.everyNthFrame=Math.max(1,t.everyNthFrame??3),this._frame=0,this.rt=new hs(n,n,{type:vn,format:us,minFilter:be,magFilter:be,wrapS:Pe,wrapT:Pe,depthBuffer:!1,stencilBuffer:!1}),ee.uWindTex.value=this.rt.texture;const i=qt((t.seed??4242)>>>0);this._r=i,this.time=0,this.baseSpeed=4.2,this.baseDir=292*It,this.meanSpeed=this.baseSpeed,this.meanDir=this.baseDir,this.tgtSpeed=this.baseSpeed,this.tgtDir=this.baseDir,this.gustiness=1,this.vec=new ce,this.fwd=[0,1],this.side=[-1,0],this.cloudDrift=new ce,this.cloudWind=new ce;const o=Math.sin(this.meanDir+Math.PI),r=Math.cos(this.meanDir+Math.PI);this.fwd=[o,r],this.side=[-r,o],this.vec.set(o*this.meanSpeed,r*this.meanSpeed),this.cells=[];for(let u=0;u<6;u++)this.cells.push({s:-1400+u*430+i()*260,c:(i()-.5)*900,len:26+i()*34,wid:70+i()*130,amp:.85+i()*1.35,veer:(i()-.5)*.42,life:0});this._pxData=new Uint16Array(ve*ve),this._pxNext=new Float32Array(ve*ve),this._pxCursor=ve*ve,this._pxNextOX=0,this._pxNextOZ=0,this.proxy=new ua(this._pxData,ve,ve,da,vn),this.proxy.minFilter=be,this.proxy.magFilter=be,this.proxy.wrapS=Pe,this.proxy.wrapT=Pe,this.proxy.needsUpdate=!0,this._seed=(t.seed??4242)>>>0,this.worldSeed=(t.worldSeed??20260726)>>>0;const c=new tt;c.setAttribute("position",new H(new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),3)),c.setAttribute("uv",new H(new Float32Array([0,0,2,0,0,2]),2)),c.boundingSphere=new st(new Z,10),this._quadGeo=c,this._quadScene=new Ks,this._quadCam=new zn;const l=[],h=[];for(let u=0;u<6;u++)l.push(new Ps),h.push(new Ps);this._uni={uTime:ee.uTime,uWindOrigin:ee.uWindOrigin,uMeanWind:Sn.uMeanWind,uCellA:{value:l},uCellB:{value:h},uFwd:{value:new ce(o,r)},uSide:{value:new ce(-r,o)},uGustiness:{value:1},uTurbI:{value:.26},uWindTerr:{value:this.proxy},uWindTerrO:{value:new Z(0,0,1/Yt)}},this.material=new ge({glslVersion:"300 es",vertexShader:qc,fragmentShader:$c,uniforms:this._uni,depthTest:!1,depthWrite:!1}),this._quad=new Me(c,this.material),this._quad.frustumCulled=!1,this._quadScene.add(this._quad)}setSeed(e){return this.worldSeed=e>>>0,this._pxCursor=ve*ve,this}update(e,t){const s=this._r;this.time+=e;const n=1-Math.exp(-e/25),i=1-Math.exp(-e/40);this.tgtSpeed=K(this.tgtSpeed+(s()-.5)*e*2.4,this.baseSpeed*.62,this.baseSpeed*1.45),this.tgtDir=K(this.tgtDir+(s()-.5)*e*.16,this.baseDir-.34,this.baseDir+.34),this.meanSpeed+=(this.tgtSpeed-this.meanSpeed)*n,this.meanDir+=(this.tgtDir-this.meanDir)*i;const o=Math.sin(this.meanDir+Math.PI),r=Math.cos(this.meanDir+Math.PI);this.vec.set(o*this.meanSpeed,r*this.meanSpeed),this.fwd[0]=o,this.fwd[1]=r,this.side[0]=-r,this.side[1]=o;const c=this.meanSpeed*1.25*e;for(const u of this.cells)u.s+=c,u.life+=e,u.s-(t.x*o+t.z*r)>620&&(u.s-=1560+s()*280,u.c=(s()-.5)*940,u.len=26+s()*34,u.wid=70+s()*130,u.amp=.8+s()*1.4,u.veer=(s()-.5)*.44,u.life=0);const l=this.meanDir+Math.PI+.19;this.cloudWind.set(Math.sin(l)*this.meanSpeed*2.35,Math.cos(l)*this.meanSpeed*2.35),this.cloudDrift.x+=this.cloudWind.x*e,this.cloudDrift.y+=this.cloudWind.y*e,Sn.uMeanWind.value.copy(this.vec);const h=Math.hypot(this.vec.x,this.vec.y)||1;ee.uWindLag.value.set(this.vec.x/h*Mo,this.vec.y/h*Mo),this._stepProxy(t),this._frame%this.everyNthFrame===0&&this._pass(t),this._frame++}_stepProxy(e){const t=ve*ve;this._pxCursor>=t&&(this._pxNextOX=e.x,this._pxNextOZ=e.z,this._pxCursor=0);const s=Yt/(ve-1),n=this._pxNextOX-Yt*.5,i=this._pxNextOZ-Yt*.5,o=Math.min(t,this._pxCursor+Wc);for(let r=this._pxCursor;r<o;r++){const c=r%ve,l=r/ve|0;this._pxNext[r]=zi(n+c*s,i+l*s,this.worldSeed)}if(this._pxCursor=o,o>=t){for(let r=0;r<t;r++)this._pxData[r]=fa.toHalfFloat(this._pxNext[r]);this.proxy.needsUpdate=!0,this._uni.uWindTerrO.value.set(this._pxNextOX,this._pxNextOZ,1/Yt)}}_pass(e){const t=this._uni;ee.uWindOrigin.value.set(e.x,e.z),t.uFwd.value.set(this.fwd[0],this.fwd[1]),t.uSide.value.set(this.side[0],this.side[1]),t.uGustiness.value=this.gustiness;for(let i=0;i<6;i++){const o=this.cells[i];t.uCellA.value[i].set(o.s,o.c,o.len,o.wid),t.uCellB.value[i].set(o.amp,o.veer,o.life,0)}const s=this.renderer,n=s.getRenderTarget();s.setRenderTarget(this.rt),s.render(this._quadScene,this._quadCam),s.setRenderTarget(n)}sample(e,t,s){const n=this.fwd[0],i=this.fwd[1],o=this.side[0],r=this.side[1];let c=this.vec.x,l=this.vec.y;const h=e*n+t*i,u=e*o+t*r;let d=0,f=0;for(const A of this.cells){const z=(h-A.s)/A.len;if(z>.16||z<-6)continue;const N=ke(.14,0,z),W=Math.exp(z*2.05),G=Math.exp(-Math.pow(Math.abs(u-A.c)/(A.wid*.5),2.3)),$=A.amp*N*W*G*this.gustiness;d+=$,f+=$*A.veer}const p=this.time,m=(e-this.vec.x*p)*.0125,v=(t-this.vec.y*p)*.0125,g=$e(m,v,this._seed),w=$e(m+3.7,v-1.9,this._seed),x=m*2.6,y=v*2.6,T=$e(x+11,y+5,this._seed),b=$e(x-7,y+13,this._seed);c+=(g*1+T*.79)*this.meanSpeed*.19,l+=(w*1+b*.79)*this.meanSpeed*.19;const M=1+d*.85,_=Math.cos(f),S=Math.sin(f),k=(c*_-l*S)*M,L=(c*S+l*_)*M,E=s===void 0?1:Math.log((Math.max(s,.015)+.06)/.06)*.19523;return{x:k*E,z:L*E,gust:d,speed:Math.hypot(k,L)*E}}dispose(){this.rt.dispose(),this.proxy.dispose(),this.material.dispose(),this._quadGeo.dispose(),ee.uWindTex.value===this.rt.texture&&(ee.uWindTex.value=null)}}const Vc=4400,An=1.5,Yc=[{cs:12,near:0,far:26,dn:7,grid:7,lat:8,segs:3,wpx:1.7,hs:1,prepass:!0},{cs:28,near:22,far:88,dn:22,grid:9,lat:10,segs:2,wpx:2,hs:1.08,prepass:!0},{cs:80,near:80,far:300,dn:80,grid:9,lat:14,segs:1,wpx:3.8,hs:1.36,prepass:!1},{cs:160,near:270,far:560,dn:270,grid:9,lat:14,segs:1,wpx:6,hs:1.95,prepass:!1}],Xc=.004,So=2;function Zc(a){if(a<=0)return 0;if(a>=1)return 1;const e=Math.ceil(Math.log2(a)*So);return Math.min(1,Math.pow(2,e/So))}const Jc=.74,Qc=.85,As=930,Ao=100,el=2.5,ko=1/65535,tl=1/4294967296,sl=ps.map(a=>a.grass),nl=ft.map(a=>a.dryness),ol=ft.map(a=>a.snow),il=ft.map(a=>a.wet),sn=a=>`vec3(${a[0].toFixed(4)},${a[1].toFixed(4)},${a[2].toFixed(4)})`,al=`
const vec3 F_DRY  = ${sn(ft[ht.STEPPE].foliage)};
const vec3 F_COLD = ${sn(ft[ht.HIGHLAND].foliage)};
const vec3 F_WET  = ${sn(ft[ht.WETLAND].foliage)};
`;function rl(a){const e=Math.max(1,a),t=2*e+1,s=new Float32Array(t*3);let n=0;for(let c=0;c<e;c++){const l=c/e;s[n++]=0,s[n++]=l,s[n++]=0,s[n++]=1,s[n++]=l,s[n++]=0}s[n++]=.5,s[n++]=1,s[n++]=0;const i=new Uint16Array((e-1)*6+3);let o=0;for(let c=0;c<e-1;c++){const l=c*2;i[o++]=l,i[o++]=l+2,i[o++]=l+1,i[o++]=l+1,i[o++]=l+2,i[o++]=l+3}const r=(e-1)*2;return i[o++]=r,i[o++]=2*e,i[o++]=r+1,{position:new H(s,3),index:new H(i,1)}}function cl(a,e){const t=qt(e),s=new Uint16Array(a*2),n=Math.ceil(Math.sqrt(a)),i=1/n;let o=0;for(let r=0;r<a;r++){const c=r%n,l=r/n|0;s[o++]=Math.min(65535,(c+t())*i*65535)|0,s[o++]=Math.min(65535,(l+t())*i*65535)|0}for(let r=a-1;r>0;r--){const c=t()*(r+1)|0,l=s[r*2],h=s[r*2+1];s[r*2]=s[c*2],s[r*2+1]=s[c*2+1],s[c*2]=l,s[c*2+1]=h}return s}const Ro=a=>`
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
  vec3 lit = mix(${R.gLow}, ${R.gMid}, smoothstep(0.00, 0.26, t));
  lit = mix(lit, ${R.gUpper}, smoothstep(0.20, 0.66, t));
  lit = mix(lit, ${R.gTip},   smoothstep(0.80, 1.00, t));
  vec3 mid = mix(${R.gBase}, ${R.gMid}, smoothstep(0.05, 0.80, t));
  vec3 shd = mix(${R.gBase}*0.82, ${R.gLow}, smoothstep(0.15, 0.95, t));

  // meadow mosaic
  lit = mix(lit, ${R.gPatchC}, smoothstep(0.35,0.85,vTint.x)*0.45);
  lit = mix(lit, ${R.gPatchA}, smoothstep(0.65,0.15,vTint.x)*0.35);
  mid = mix(mid, ${R.gPatchB}, smoothstep(0.3,0.8,vTint.y)*0.40);
  shd = mix(shd, ${R.tHollow}, smoothstep(0.4,0.9,vTint.y)*0.35);

  // ── the biome, as three scalars rather than five branches ──────────────
  // Dryness bleeds the greens toward straw from the tip down, because that is the order a
  // blade actually cures in. It is a hue rotation and not a desaturation: dead grass is
  // yellow, not grey.
  float dryB = vTint.z;
  float dry = smoothstep(0.10, 0.95, dryB) * smoothstep(0.30, 0.98, t);
  lit = mix(lit, ${R.gDry},      dry*0.72);
  mid = mix(mid, ${R.gDry}*0.72, dry*0.48);
  shd = mix(shd, ${R.gDry}*0.36, dry*0.30);

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
  lit = mix(lit, ${R.gPatchB}, smoothstep(0.72, 1.0, vVarF)*0.30);

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
  s.transCol = ${R.gTrans};
  s.rim = 0.34*(0.25 + 0.75*nearK); s.ao = vAO; s.ambient = 1.0;
  vec3 col = paint(s);

  // ── the wind flash ─────────────────────────────────────────────────────
  // a blade laid over by a gust turns its broad face up and catches the light: this is what
  // makes a gust visible as a pale band racing across the field
  float geom = pow(clamp(1.0 - abs(dot(N,V)), 0.0, 1.0), 1.9)*0.45
             + pow(clamp(dot(N, normalize(uSunDir + V)), 0.0, 1.0), 3.2)*0.55;
  float flash = smoothstep(0.34, 0.86, vBend) * smoothstep(0.14, 0.78, t);
  col = mix(col, ${R.gSheen}, geom*flash*0.55*(0.30 + 0.70*sh)*(0.32 + 0.68*nearK));

  // seed head: a warm bronze plume on one blade in ten
  if(vHead > 0.5){
    float hd = smoothstep(0.78, 0.94, t);
    col = mix(col, mix(${R.gDry}, vec3(0.32,0.22,0.14), 0.42)*1.25, hd*0.82);
  }
  // a hint of the midrib, and the deep interior of the sward
  col *= 1.0 - abs(vSide)*0.13*nearK;
  col *= mix(0.46, 1.0, vOccl*0.55 + 0.45);

  // Out past a hundred metres a blade is only two or three pixels wide, and full contrast
  // against the ground behind it is what makes distant grass crawl and sparkle as the
  // camera moves. Converging it toward the sward mean keeps every bit of the texture and
  // takes the edge energy out of it — which is, not coincidentally, exactly what a painter
  // does at that depth.
  col = mix(col, mix(col, ${R.tMid}, 0.62), smoothstep(90.0, 430.0, vDist)*0.42);

  col = aerial(col, vDist, V, vW.y);
  outColor = vec4(SAFE3(col), gFogAmt);
}`;class hl{constructor(e,t){this.cap=t,this.count=0,this.cx=0,this.cz=0,this.wx=0,this.wy=0,this.wz=0,this.frac=1,this.wantFrac=1,this.dirty=!0,this.stamp=-1,this.built=0,this.minY=0,this.ySpan=1,this.lat=new Float32Array((e.R.lat+1)*(e.R.lat+1)*5),this.iPos=new Uint16Array(t*2),this.iGrd=new Uint16Array(t),this.iTint=new Uint8Array(t*4);const s=new di;s.setAttribute("position",e.blade.position),s.setIndex(e.blade.index),this.aPos=new dt(this.iPos,2,!0),this.aGrd=new dt(this.iGrd,1,!0),this.aTint=new dt(this.iTint,4,!0),s.setAttribute("iPos",this.aPos),s.setAttribute("iGrd",this.aGrd),s.setAttribute("iTint",this.aTint),s.boundingSphere=new st(new Z,1e6),s.instanceCount=0,this.geom=s;const n=new Me(s,e.mat);if(n.frustumCulled=!1,n.renderOrder=4+e.index,n.visible=!1,this.mesh=n,e.preMat){const i=new Me(s,e.preMat);i.frustumCulled=!1,i.renderOrder=-20+e.index,this.pre=i,n.add(i)}else this.pre=null}dispose(){this.geom.dispose()}}class ul{constructor({seed:e,scene:t,quality:s=1,wind:n=null}={}){this.seed=e>>>0,this.quality=K(s,.25,2),this.wind=n,this.budgetMs=el,this.angPerPx=1.012/1080,this._group=new mt,this._group.matrixAutoUpdate=!1,this._group.name="grass",t&&t.add(this._group),this._terrain=null,this._regionX=1/0,this._regionZ=1/0,this.stats={chunks:0,dirty:0,drawn:0,built:0,extended:0,buildMs:0,bytes:0},this._rings=Yc.map((i,o)=>this._buildRing(i,o))}get group(){return this._group}setAngular(e){this.angPerPx=e;for(const t of this._rings)t.uni.uLodB.value.x=e*t.R.wpx;return this}_buildRing(e,t){const s=rl(e.segs),n=Math.max(64,Math.round(Vc/Math.pow(e.dn,An)*e.cs*e.cs*this.quality)),i=cl(n,7e3+t*131+this.seed),o=Ae(Object.assign({uChunkSize:{value:e.cs},uLod:{value:new Ps(e.near,Math.max(7,e.near*.26),e.far,e.far*.26)},uLodB:{value:new Z(this.angPerPx*e.wpx,e.hs,e.dn)},uWindGain:{value:.235},uPlayerPush:{value:t===0?1:0}},Kc())),r=kt({cshSpan:9200,cloudDeck:980}),c=new ge({glslVersion:"300 es",uniforms:o,vertexShader:_e(pe,me,To,Ro(!1)),fragmentShader:Ne(pe,me,al,r,Kt,Rt,ll(t)),side:et}),l=e.prepass?new ge({glslVersion:"300 es",uniforms:o,vertexShader:_e(pe,me,To,Ro(!0)),fragmentShader:In,side:et,colorWrite:!1}):null,h=e.grid,u=(h-1)/2,d=new Int32Array(h*h),f=new Float32Array(h*h),p=[];for(let v=-u;v<=u;v++)for(let g=-u;g<=u;g++){const w=(v+u)*h+(g+u),x=dl(e,g,v),y=x<Xc?0:Zc(x);f[w]=y,d[w]=y<=0?0:Math.max(48,Math.round(n*y)),d[w]>0&&p.push(w)}return p.sort((v,g)=>{const w=v%h-u,x=(v/h|0)-u,y=g%h-u,T=(g/h|0)-u;return Math.max(Math.abs(w),Math.abs(x))-Math.max(Math.abs(y),Math.abs(T))}),{R:e,index:t,blade:s,tpl:i,full:n,uni:o,mat:c,preMat:l,grid:h,half:u,cap:d,capFrac:f,order:p,slots:new Array(h*h).fill(null),scratch:new Array(h*h).fill(null),pool:[],ox:0,oz:0,stamp:0,ready:!1}}update(e,t,s,n){this.wind&&this.wind.update(n,{x:e,y:s,z:t});const i=performance.now();this._ensureRegion(e,t);for(const r of this._rings)this._recentre(r,e,t);const o=this._drainQueue(i);this.stats.buildMs=performance.now()-i,this.stats.built+=o,this._draw(e,t,s)}_ensureRegion(e,t){this._terrain&&Math.abs(e-this._regionX)<Ao&&Math.abs(t-this._regionZ)<Ao||(this._terrain=new Ht(this.seed,e-As,t-As,e+As,t+As,90),this._regionX=e,this._regionZ=t)}_recentre(e,t,s){const n=e.R.cs,i=Math.floor(t/n),o=Math.floor(s/n);if(e.ready&&i===e.ox&&o===e.oz)return;const r=e.grid,c=e.half;if(e.ready){const l=i-e.ox,h=o-e.oz,u=e.slots,d=e.scratch,f=++e.stamp;d.fill(null);for(let p=-c;p<=c;p++){const m=p+h;if(!(m<-c||m>c))for(let v=-c;v<=c;v++){const g=v+l;if(g<-c||g>c)continue;const w=u[(m+c)*r+(g+c)];w&&(w.stamp=f,d[(p+c)*r+(v+c)]=w)}}for(let p=0;p<u.length;p++){const m=u[p];m&&m.stamp!==f&&this._release(e,m)}e.slots=d,e.scratch=u}e.ox=i,e.oz=o,e.ready=!0;for(let l=0;l<e.order.length;l++){const h=e.order[l],u=e.cap[h],d=e.slots[h];if(d&&d.cap>=u)continue;const f=h%r-c,p=(h/r|0)-c,m=this._acquire(e,u);d?(this._carryOver(d,m),this._release(e,d),this.stats.extended++):(m.cx=i+f,m.cz=o+p),m.wantFrac=e.capFrac[h],e.slots[h]=m}}_carryOver(e,t){t.iPos.set(e.iPos.subarray(0,e.count*2)),t.iGrd.set(e.iGrd.subarray(0,e.count)),t.iTint.set(e.iTint.subarray(0,e.count*4)),t.lat.set(e.lat),t.count=e.count,t.built=e.built,t.cx=e.cx,t.cz=e.cz,t.wx=e.wx,t.wy=e.wy,t.wz=e.wz,t.minY=e.minY,t.ySpan=e.ySpan,t.frac=e.frac,t.mesh.position.copy(e.mesh.position),t.mesh.scale.y=e.ySpan,t.aPos.needsUpdate=!0,t.aGrd.needsUpdate=!0,t.aTint.needsUpdate=!0,t.dirty=!0}_acquire(e,t){let s=-1;for(let i=0;i<e.pool.length;i++){const o=e.pool[i];o.cap<t||(s<0||o.cap<e.pool[s].cap)&&(s=i)}if(s>=0){const i=e.pool.splice(s,1)[0];return i.count=0,i.built=0,i.dirty=!0,i}const n=new hl(e,t);return this._group.add(n.mesh),this.stats.chunks++,this.stats.bytes+=t*10,n}_release(e,t){t.mesh.visible=!1,t.dirty=!0,e.pool.push(t);const s=e.grid+2;for(;e.pool.length>s;){let n=0;for(let o=1;o<e.pool.length;o++)e.pool[o].cap>e.pool[n].cap&&(n=o);const i=e.pool.splice(n,1)[0];this._group.remove(i.mesh),i.dispose(),this.stats.chunks--,this.stats.bytes-=i.cap*10}}_drainQueue(e){let t=0,s=0;for(const n of this._rings)for(let i=0;i<n.order.length;i++){const o=n.slots[n.order[i]];!o||!o.dirty||(s++,!(performance.now()-e>=this.budgetMs)&&(this._buildChunk(n,o),t++))}return this.stats.dirty=s,t}_buildChunk(e,t){const s=e.R,n=s.cs,i=s.lat,o=i+1,r=t.lat,c=t.cx*n,l=t.cz*n;if(t.built===0){const T=this._terrain,b=n/i;let M=1/0,_=-1/0;for(let S=0;S<o;S++){const k=l+S*b;for(let L=0;L<o;L++){const E=c+L*b,A=T.height(E,k),z=T.weights(E,k).w;let N=0,W=0,G=0,$=0;for(let B=0;B<le;B++){const j=z[B];j<.002||(N+=j*sl[B],W+=j*nl[B],G+=j*ol[B],$+=j*il[B])}const se=T.roads.carve(E,k).edge,C=(S*o+L)*5;r[C]=A,r[C+1]=N*(1-D(se)),r[C+2]=W,r[C+3]=G,r[C+4]=$,A<M&&(M=A),A>_&&(_=A)}}for(let S=0;S<o;S++){const k=S>0?S-1:S,L=S<o-1?S+1:S,E=(L-k)*b;for(let A=0;A<o;A++){const z=A>0?A-1:A,N=A<o-1?A+1:A,W=(N-z)*b,G=(r[(S*o+z)*5]-r[(S*o+N)*5])/W,$=(r[(k*o+A)*5]-r[(L*o+A)*5])/E,se=1/Math.sqrt(G*G+$*$+1);r[(S*o+A)*5+1]*=ke(Jc,Qc,se)}}t.minY=M,t.ySpan=Math.max(_-M,.5),t.wx=c+n*.5,t.wz=l+n*.5,t.wy=M+t.ySpan*.5,t.count=0}const h=t.minY,u=1/t.ySpan,d=e.tpl,f=t.cap,p=t.iPos,m=t.iGrd,v=t.iTint,g=this.seed,w=t.cx,x=t.cz;let y=t.count;for(let T=t.built;T<f;T++){const b=d[T*2],M=d[T*2+1],_=b*ko*i,S=M*ko*i;let k=_|0;k>i-1&&(k=i-1);let L=S|0;L>i-1&&(L=i-1);const E=_-k,A=S-L,z=(L*o+k)*5,N=z+5,W=z+o*5,G=W+5,$=(1-E)*(1-A),se=E*(1-A),C=(1-E)*A,B=E*A,j=r[z+1]*$+r[N+1]*se+r[W+1]*C+r[G+1]*B;if(j<=.004||_i(w,x,T,g)*tl>j)continue;const ie=r[z]*$+r[N]*se+r[W]*C+r[G]*B,Y=r[z+2]*$+r[N+2]*se+r[W+2]*C+r[G+2]*B,oe=r[z+3]*$+r[N+3]*se+r[W+3]*C+r[G+3]*B,he=r[z+4]*$+r[N+4]*se+r[W+4]*C+r[G+4]*B;p[y*2]=b,p[y*2+1]=M,m[y]=(ie-h)*u*65535|0;const ue=y*4;v[ue]=D(Y)*255|0,v[ue+1]=D(oe)*255|0,v[ue+2]=D(he)*255|0,v[ue+3]=D(j)*255|0,y++}t.count=y,t.built=f,t.aPos.needsUpdate=!0,t.aGrd.needsUpdate=!0,t.aTint.needsUpdate=!0,t.mesh.position.set(t.wx,t.minY,t.wz),t.mesh.scale.y=t.ySpan,t.frac=t.wantFrac,t.dirty=!1}_draw(e,t,s){const n=ee.uCull.value;let i=0;for(const o of this._rings){const r=o.R,c=r.cs,l=Math.max(7,r.near*.26),h=r.far*.26,u=o.slots;for(let d=0;d<u.length;d++){const f=u[d];if(!f)continue;const p=f.mesh;if(f.count===0){p.visible=!1;continue}const m=f.wx-e,v=f.wy-s,g=f.wz-t,w=Math.sqrt(m*m+v*v+g*g);if(w-c*.75>r.far){p.visible=!1;continue}if(w+c*.75<r.near-l){p.visible=!1;continue}if(w>c*1.6){const L=1/Math.sqrt(m*m+g*g||1),E=c*.75/w;if((m*n.x+g*n.y)*L<n.z-E){p.visible=!1;continue}}const x=Math.max(Math.abs(m)-c*.5,0),y=Math.max(Math.abs(g)-c*.5,0),T=Math.max(Math.sqrt(x*x+y*y+v*v),r.dn),b=Math.min(1,Math.pow(r.dn/T,An));let M=1;r.near>.01&&(M*=ke(r.near-l-c*.6,r.near+l,w)),M*=1-ke(r.far-h,r.far+c*.6,w);const _=f.frac,S=Math.min(b,_),k=Math.round(f.count*(S/_)*D(M));if(k<=0){p.visible=!1;continue}p.visible=!0,p.scale.x=S,f.geom.instanceCount=k,i+=k}}this.stats.drawn=i}dispose(){for(const e of this._rings){for(const t of e.slots)t&&t.dispose();for(const t of e.pool)t.dispose();e.slots.fill(null),e.pool.length=0,e.mat.dispose(),e.preMat&&e.preMat.dispose()}this._group.clear(),this._group.parent&&this._group.parent.remove(this._group),this._rings.length=0,this.stats.chunks=0,this.stats.bytes=0}}function dl(a,e,t){const s=Math.max(7,a.near*.26),n=a.far*.26,i=Math.hypot(Math.max(Math.abs(e)-1,0)*a.cs,Math.max(Math.abs(t)-1,0)*a.cs);if(i>a.far)return 0;const o=Math.hypot((Math.abs(e)+1)*a.cs,(Math.abs(t)+1)*a.cs);let r=0;const c=24;for(let l=0;l<=c;l++){const h=i+(o-i)*l/c,u=Math.min(1,Math.pow(a.dn/Math.max(h,a.dn),An)),d=a.near<=.01?1:ke(a.near-s,a.near+s,h),f=1-ke(a.far-n,a.far,h),p=u*d*f;p>r&&(r=p)}return r}const fl=1.7,Eo=520;class pl{constructor({seed:e,material:t,depthMaterial:s=null,workers:n=0,viewDistance:i=7e3,onChunk:o=null,onRelease:r=null,terrain:c="rolling"}){this.seed=e>>>0,this.material=t,this.depthMaterial=s,this.viewDistance=i,this.onChunk=o,this.onRelease=r,this.terrainPreset=c,this.group=new mt,this.group.name="terrain",this.group.matrixAutoUpdate=!1,this.live=new Map,this.pending=new Map,this.queue=[],this.stats={built:0,queued:0,live:0,workers:0,lastMs:0};const l=n||Math.max(2,Math.min(6,(navigator.hardwareConcurrency||4)-2));this.workers=[],this.busy=[];for(let h=0;h<l;h++){const u=new Worker(new URL(""+new URL("chunkWorker-DS88PxZa.js",import.meta.url).href,import.meta.url),{type:"module"});u.onmessage=d=>this._onWorkerMessage(h,d.data),u.onerror=d=>console.error("[streamer] worker error",d.message),this.workers.push(u),this.busy.push(null)}this.stats.workers=l,this._jobId=1,this._camera=new Z,this._maxLevel=Math.min(sc-1,Math.max(0,Math.ceil(Math.log2(i/cs))))}_select(e,t){const s=new Map,n=this._maxLevel,i=Wt(n),o=Math.ceil(this.viewDistance/i)+1,r=Math.floor(e/i),c=Math.floor(t/i),l=[];for(let h=c-o;h<=c+o;h++)for(let u=r-o;u<=r+o;u++)l.push([u,h,n]);for(;l.length;){const[h,u,d]=l.pop(),f=Wt(d),p=(h+.5)*f,m=(u+.5)*f,v=Math.max(Math.abs(e-p)-f*.5,0),g=Math.max(Math.abs(t-m)-f*.5,0),w=Math.hypot(v,g);if(!(w>this.viewDistance))if(d>0&&w<f*fl){const x=d-1;l.push([h*2,u*2,x]),l.push([h*2+1,u*2,x]),l.push([h*2,u*2+1,x]),l.push([h*2+1,u*2+1,x])}else s.set(`${d}:${h},${u}`,{cx:h,cz:u,level:d,d:w})}return s}update(e,t){const s=performance.now(),n=this._select(e,t);this.queue.length=0;for(const[i,o]of n)this.live.has(i)||this.pending.has(i)||this.queue.push({key:i,...o});this.queue.sort((i,o)=>i.d-o.d);for(const[i,o]of this.live)n.has(i)||this._release(i,o);if(this.live.size>Eo){const i=[...this.live.entries()].sort((o,r)=>{const c=Math.hypot(o[1].ox+o[1].size*.5-e,o[1].oz+o[1].size*.5-t);return Math.hypot(r[1].ox+r[1].size*.5-e,r[1].oz+r[1].size*.5-t)-c});for(let o=0;o<i.length-Eo;o++)this._release(i[o][0],i[o][1])}this._pump(),this.stats.queued=this.queue.length,this.stats.live=this.live.size,this.stats.lastMs=performance.now()-s}_pump(){for(let e=0;e<this.workers.length&&this.queue.length;e++){if(this.busy[e])continue;const t=this.queue.shift();if(this.live.has(t.key)||this.pending.has(t.key)){e--;continue}const s=this._jobId++;this.busy[e]=t.key,this.pending.set(t.key,s),this.workers[e].postMessage({jobId:s,cx:t.cx,cz:t.cz,level:t.level,seed:this.seed,terrain:this.terrainPreset})}}_onWorkerMessage(e,t){const s=this.busy[e];if(this.busy[e]=null,t.type==="error"){console.error("[streamer] chunk build failed",t.message),s&&this.pending.delete(s),this._pump();return}if(t.type!=="chunk")return;const n=`${t.level}:${t.cx},${t.cz}`;this.pending.delete(n),this.live.has(n)||this._adopt(n,t),this._pump()}_adopt(e,t){const s=new tt;s.setAttribute("position",new H(t.position,3)),s.setAttribute("normal",new H(t.normal,3)),s.setAttribute("aBiome",new H(t.biome,4,!0)),s.setAttribute("aRoad",new H(t.road,2,!0)),s.setIndex(new H(t.index,1));const n=Math.hypot(t.size,t.maxY-t.minY)*.72;s.boundingSphere=new st(new Z(t.size*.5,(t.minY+t.maxY)*.5,t.size*.5),n);const i=new Me(s,this.material);i.position.set(t.ox,0,t.oz),i.frustumCulled=!0,i.matrixAutoUpdate=!1,i.updateMatrix(),i.userData.level=t.level,i.renderOrder=-t.level,this.group.add(i);const o={mesh:i,level:t.level,cx:t.cx,cz:t.cz,size:t.size,ox:t.ox,oz:t.oz,step:t.step,grid:t.grid,minY:t.minY,maxY:t.maxY,heights:t.heights||null,water:t.water||null};this.live.set(e,o),this.stats.built++,this.onChunk&&this.onChunk(o,t)}_release(e,t){this.onRelease&&this.onRelease(t),this.group.remove(t.mesh),t.mesh.geometry.dispose(),this.live.delete(e)}sampleHeight(e,t){const s=cs,n=`0:${Math.floor(e/s)},${Math.floor(t/s)}`,i=this.live.get(n);if(!i||!i.heights)return null;const o=(e-i.ox)/i.step,r=(t-i.oz)/i.step;let c=Math.floor(o),l=Math.floor(r);const h=i.grid||ic;if(c<0||l<0||c>h-2||l>h-2)return null;const u=o-c,d=r-l,f=i.heights,p=f[l*h+c],m=f[l*h+c+1],v=f[(l+1)*h+c],g=f[(l+1)*h+c+1];return(p*(1-u)+m*u)*(1-d)+(v*(1-u)+g*u)*d}isReady(e,t){return this.sampleHeight(e,t)!==null}forceChunk(e,t){const s=Math.floor(e/cs),n=Math.floor(t/cs),i=`0:${s},${n}`;if(this.live.has(i))return;const o=ac({cx:s,cz:n,level:0,seed:this.seed});this.pending.delete(i),this._adopt(i,o)}dispose(){for(const e of this.workers)e.terminate();for(const[e,t]of this.live)this._release(e,t)}}const Co=["gt","sports","hyper"],zo=[{name:"Persimmon",body:J("paintA"),accent:J("paintD")},{name:"Barley",body:J("paintB"),accent:J("paintF")},{name:"Cobalt",body:J("paintC"),accent:J("paintD")},{name:"Chalk",body:J("paintD"),accent:J("paintF")},{name:"Verdigris",body:J("paintE"),accent:J("paintD")},{name:"Ink",body:J("paintF"),accent:J("paintB")},{name:"Rust",body:Us(J("paintA"),J("paintF"),.42),accent:J("paintB")},{name:"Seafoam",body:Us(J("paintE"),J("paintD"),.45),accent:J("paintC")}],ml={gt:{hull:[{z:2.35,yb:.34,yt:.74,wb:.56,wt:.62},{z:1.98,yb:.26,yt:.8,wb:.78,wt:.82},{z:1.39,yb:.22,yt:.86,wb:.86,wt:.92},{z:.6,yb:.22,yt:.9,wb:.88,wt:.92},{z:-.1,yb:.22,yt:.94,wb:.88,wt:.92},{z:-.95,yb:.24,yt:.96,wb:.88,wt:.9},{z:-1.39,yb:.26,yt:.94,wb:.86,wt:.88},{z:-2.35,yb:.44,yt:.82,wb:.62,wt:.66}],cabin:[{z:.58,yb:.86,yt:.99,wb:.84,wt:.66},{z:-.14,yb:.9,yt:1.36,wb:.82,wt:.62},{z:-.86,yb:.92,yt:1.36,wb:.82,wt:.62},{z:-2.06,yb:.84,yt:.98,wb:.74,wt:.5}],axle:[1.39,-1.39],track:[.8,.8],wheel:{rf:.34,rr:.35,wf:.145,wr:.155},lamps:"round",tail:"blocks",wing:"none",intakes:!1},sports:{hull:[{z:2.15,yb:.26,yt:.6,wb:.54,wt:.64},{z:1.72,yb:.2,yt:.7,wb:.8,wt:.88},{z:1.28,yb:.18,yt:.76,wb:.86,wt:.94},{z:.45,yb:.18,yt:.84,wb:.88,wt:.94},{z:-.35,yb:.2,yt:.96,wb:.9,wt:.96},{z:-1.05,yb:.22,yt:1.02,wb:.9,wt:.96},{z:-1.28,yb:.24,yt:1.02,wb:.88,wt:.94},{z:-2.15,yb:.46,yt:.88,wb:.7,wt:.74}],cabin:[{z:.42,yb:.8,yt:.88,wb:.8,wt:.58},{z:-.18,yb:.86,yt:1.24,wb:.78,wt:.56},{z:-.66,yb:.9,yt:1.24,wb:.76,wt:.54},{z:-1.02,yb:.92,yt:1.02,wb:.72,wt:.46}],axle:[1.28,-1.28],track:[.8,.82],wheel:{rf:.33,rr:.35,wf:.15,wr:.175},lamps:"slim",tail:"blocks",wing:"lip",intakes:!0},hyper:{hull:[{z:2.3,yb:.16,yt:.48,wb:.64,wt:.76},{z:1.85,yb:.14,yt:.58,wb:.92,wt:1},{z:1.35,yb:.13,yt:.66,wb:.96,wt:1.03},{z:.5,yb:.13,yt:.74,wb:.96,wt:1.02},{z:-.3,yb:.14,yt:.88,wb:.98,wt:1.03},{z:-1.05,yb:.16,yt:.96,wb:.98,wt:1.03},{z:-1.35,yb:.18,yt:.96,wb:.96,wt:1},{z:-2.3,yb:.36,yt:.84,wb:.78,wt:.84}],cabin:[{z:.46,yb:.7,yt:.8,wb:.82,wt:.54},{z:-.14,yb:.8,yt:1.16,wb:.8,wt:.5},{z:-.62,yb:.84,yt:1.16,wb:.78,wt:.48},{z:-1.06,yb:.86,yt:.98,wb:.72,wt:.42}],axle:[1.35,-1.35],track:[.84,.85],wheel:{rf:.34,rr:.36,wf:.165,wr:.2},lamps:"slim",tail:"bar",wing:"high",intakes:!0}},Lo=a=>[[a.wb,a.yb,a.z],[-a.wb,a.yb,a.z],[-a.wt,a.yt,a.z],[a.wt,a.yt,a.z]];function Do(a,e,t,s,n=!0,i=!0){let o=Lo(e[0]);n&&bt(a,o[0],o[1],o[2],o[3],t,s,[0,0,1]);for(let r=1;r<e.length;r++){const c=Lo(e[r]);bt(a,o[0],o[3],c[3],c[0],t,s,[1,0,0]),bt(a,o[1],o[2],c[2],c[1],t,s,[-1,0,0]),bt(a,o[3],o[2],c[2],c[3],t,s,[0,1,0]),bt(a,o[0],o[1],c[1],c[0],t,s,[0,-1,0]),o=c}i&&bt(a,o[0],o[1],o[2],o[3],t,s,[0,0,-1])}function nn(a,e){if(e>=a[0].z)return a[0];for(let t=1;t<a.length;t++)if(e>=a[t].z){const s=a[t-1],n=a[t],i=(s.z-e)/(s.z-n.z);return{z:e,yb:F(s.yb,n.yb,i),yt:F(s.yt,n.yt,i),wb:F(s.wb,n.wb,i),wt:F(s.wt,n.wt,i)}}return a[a.length-1]}function ks(a,e,t,s,n,i,o,r){for(let c=0;c<n;c++){const l=c/n*Q,h=(c+1)/n*Q,u=Math.cos(l),d=Math.sin(l),f=Math.cos(h),p=Math.sin(h);bt(a,[e,t*u,t*d],[e,t*f,t*p],[e,s*f,s*p],[e,s*u,s*d],i,o,[r,0,0])}}function Fo(a,e){const t=Hs(),s=J("tyre"),n=Us(J("chrome"),J("paintF"),.34),i=Mt(J("chrome"),.72),o=Us(J("tyre"),J("tail"),.34);Ie(t,[-e,0,0],[e,0,0],a,a,14,s,O.MATTE,!1,!1),ks(t,e,a,a*.68,14,Mt(s,1.18),O.MATTE,1),ks(t,-e,a,a*.68,14,Mt(s,1.18),O.MATTE,-1),Ie(t,[-e*.92,0,0],[e*.92,0,0],a*.68,a*.68,8,Mt(n,.7),O.METAL,!1,!1),ks(t,e*.92,a*.68,a*.52,12,n,O.METAL,1),ks(t,-e*.92,a*.68,a*.52,12,n,O.METAL,-1);for(let r=0;r<5;r++){const c=r/5*Q,l=Math.cos(c),h=Math.sin(c);for(const u of[-1,1]){const d=u*e*.9;Ie(t,[d,a*.18*l,a*.18*h],[d,a*.56*l,a*.56*h],a*.07,a*.06,4,n,O.METAL,!1,!1)}}return Ie(t,[-e*.96,0,0],[e*.96,0,0],a*.19,a*.19,8,i,O.METAL,!0,!0),Ie(t,[-e*.42,0,0],[e*.42,0,0],a*.6,a*.6,12,o,O.LAMP_C,!0,!0),Ws(t)}function vl(a,e,t){const s=Hs(),n=e.body,i=e.accent,o=J("paintF"),r=J("chrome"),c=J("glass"),l=J("head"),h=J("tail"),u=a.hull[0].z,d=a.hull[a.hull.length-1].z,f=a.hull[0],p=a.hull[a.hull.length-1];Do(s,a.hull,n,O.METAL),Do(s,a.cabin,c,O.GLASS);const m=a.cabin[1],v=a.cabin[2];ne(s,0,m.yt+.012,(m.z+v.z)*.5,m.wt*.94,.02,Math.abs(m.z-v.z)*.5+.05,0,n,O.METAL);const g=(a.axle[0]+a.axle[1])*.5,w=nn(a.hull,g);for(const M of[-1,1])ne(s,M*(w.wb+.01),w.yb+.07,g,.035,.07,(a.axle[0]-a.axle[1])*.5-.34,0,o,O.MATTE);ne(s,0,f.yb+.015,u-.14,f.wb*1.02,.025,.18,0,o,O.MATTE),ne(s,0,F(f.yb,f.yt,.28),u-.03,f.wb*.72,.09,.06,0,o,O.GLASS);const x=F(f.yt,f.yb,.26);for(const M of[-1,1]){const _=M*(f.wt*.62);a.lamps==="round"?(Ie(s,[_,x,u-.12],[_,x,u+.03],.115,.105,8,l,O.LAMP_A,!1,!0),Ie(s,[_,x,u-.14],[_,x,u-.11],.125,.125,8,r,O.METAL,!1,!0)):(ne(s,_,x,u-.02,.2,.045,.08,0,l,O.LAMP_A),ne(s,_,x-.055,u-.03,.2,.02,.07,0,o,O.MATTE))}ne(s,0,p.yb+.17,d+.015,p.wb*.94,.06,.04,0,o,O.MATTE);const y=F(p.yt,p.yb,.34);if(a.tail==="bar")ne(s,0,y,d+.02,p.wt*.82,.035,.05,0,h,O.LAMP_B);else for(const M of[-1,1])ne(s,M*p.wt*.55,y,d+.02,.22,.05,.05,0,h,O.LAMP_B);if(a.wing==="lip")ne(s,0,p.yt+.04,d+.16,p.wt*.9,.035,.14,0,n,O.METAL);else if(a.wing==="high"){const M=d+.24,_=p.yt+.3;ne(s,0,_,M,p.wt*.92,.025,.16,0,n,O.METAL);for(const S of[-1,1])ne(s,S*p.wt*.92,_-.02,M,.02,.1,.2,0,i,O.METAL),ne(s,S*.3,_-.16,M-.02,.03,.16,.05,0,o,O.METAL)}if(a.intakes){const M=a.axle[1]+.62,_=nn(a.hull,M);for(const S of[-1,1])ne(s,S*(F(_.wb,_.wt,.55)+.005),F(_.yb,_.yt,.58),M,.03,.1,.26,0,o,O.GLASS),ne(s,S*(F(_.wb,_.wt,.55)+.02),F(_.yb,_.yt,.58),M+.28,.02,.11,.05,0,i,O.METAL)}const T=a.cabin[0].z+.06,b=nn(a.hull,T);for(const M of[-1,1]){const _=M*(b.wt+.02);Ie(s,[_,b.yt+.02,T],[_+M*.09,b.yt+.09,T-.02],.018,.018,4,o,O.MATTE,!1,!1),ne(s,_+M*.11,b.yt+.1,T-.03,.035,.045,.075,0,n,O.METAL)}if(!t){const M=a.cabin[1];for(const _ of[-1,1])ne(s,_*.32,M.yt-.22,M.z-.16,.13,.11,.05,0,o,O.MATTE),ne(s,_*.32,M.yt-.4,M.z-.02,.17,.1,.2,0,Mt(o,1.5),O.MATTE);ne(s,0,M.yb+.06,a.cabin[0].z-.1,M.wb*.8,.05,.12,0,Mt(o,1.2),O.MATTE);for(let _=-1;_<=1;_++)ne(s,_*p.wb*.42,p.yb+.06,d+.18,.025,.06,.18,0,o,O.MATTE);for(const _ of[-1,1])Ie(s,[_*.22,p.yb+.06,d+.12],[_*.22,p.yb+.06,d-.03],.042,.047,6,Mt(r,.72),O.METAL,!1,!0)}return Ws(s)}function qi(a,e,t){const s=typeof a=="number"?Co[a]||"sports":Co.indexOf(a)>=0?a:"sports",n=ml[s],i=zo.length,o=zo[((e|0)%i+i)%i],r=On(t?{ghost:!0,opacity:.85}:{}),c=Lc(),l=[],h=vl(n,o,t),u=Fo(n.wheel.rf,n.wheel.wf),d=Fo(n.wheel.rr,n.wheel.wr);l.push(h,u,d);const f=new Je;f.name=`car:${s}`;const p=new Je;p.name="chassis",f.add(p);const m=new Me(h,r);m.userData.depth=c,p.add(m);const v=[],g=[],w=(S,k)=>{const L=S?u:d,E=S?n.axle[0]:n.axle[1],A=k*n.track[S?0:1],z=S?n.wheel.rf:n.wheel.rr,N=new Me(L,r);if(N.userData.depth=c,S){const W=new Je;W.position.set(A,z,E),f.add(W),W.add(N),v.push(W)}else N.position.set(A,z,E),f.add(N);g.push(N)};w(!0,1),w(!0,-1),w(!1,1),w(!1,-1);const x=r.uniforms.uLamp.value;let y=!1,T=0;const b=()=>{x.x=y?1:0,x.y=Math.max(y?.28:0,T),x.z=T},M=S=>S.getIndex().count/3|0,_=M(h)+2*M(u)+2*M(d);return{group:f,wheels:g,setSteer(S){v[0].rotation.y=S,v[1].rotation.y=S},setWheelSpin(S){for(const k of g)k.rotation.x=S},setBrakeGlow(S){T=D(S),b()},setLights(S){y=!!S,b()},setBodyRoll(S,k){p.rotation.z=S,p.rotation.x=k},triangles:_,dispose(){for(const S of l)S.dispose();r.dispose(),c.dispose(),f.parent&&f.parent.remove(f)}}}function gl({tier:a="sports",paint:e=0}={}){return qi(a,e,!1)}function wl({tier:a="sports",paint:e=0}={}){return qi(a,e,!0)}function Io(a,e){if(e===pa)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),a;if(e===wn||e===pi){let t=a.getIndex();if(t===null){const o=[],r=a.getAttribute("position");if(r!==void 0){for(let c=0;c<r.count;c++)o.push(c);a.setIndex(o),t=a.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),a}const s=t.count-2,n=[];if(e===wn)for(let o=1;o<=s;o++)n.push(t.getX(0)),n.push(t.getX(o)),n.push(t.getX(o+1));else for(let o=0;o<s;o++)o%2===0?(n.push(t.getX(o)),n.push(t.getX(o+1)),n.push(t.getX(o+2))):(n.push(t.getX(o+2)),n.push(t.getX(o+1)),n.push(t.getX(o)));n.length/3!==s&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const i=a.clone();return i.setIndex(n),i.clearGroups(),i}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),a}class xl extends ma{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new Tl(t)}),this.register(function(t){return new Sl(t)}),this.register(function(t){return new Fl(t)}),this.register(function(t){return new Il(t)}),this.register(function(t){return new Pl(t)}),this.register(function(t){return new kl(t)}),this.register(function(t){return new Rl(t)}),this.register(function(t){return new El(t)}),this.register(function(t){return new Cl(t)}),this.register(function(t){return new Ml(t)}),this.register(function(t){return new zl(t)}),this.register(function(t){return new Al(t)}),this.register(function(t){return new Dl(t)}),this.register(function(t){return new Ll(t)}),this.register(function(t){return new yl(t)}),this.register(function(t){return new Nl(t)}),this.register(function(t){return new Ol(t)})}load(e,t,s,n){const i=this;let o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){const l=ls.extractUrlBase(e);o=ls.resolveURL(l,this.path)}else o=ls.extractUrlBase(e);this.manager.itemStart(e);const r=function(l){n?n(l):console.error(l),i.manager.itemError(e),i.manager.itemEnd(e)},c=new mi(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{i.parse(l,o,function(h){t(h),i.manager.itemEnd(e)},r)}catch(h){r(h)}},s,r)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,s,n){let i;const o={},r={},c=new TextDecoder;if(typeof e=="string")i=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===$i){try{o[q.KHR_BINARY_GLTF]=new Bl(e)}catch(u){n&&n(u);return}i=JSON.parse(o[q.KHR_BINARY_GLTF].content)}else i=JSON.parse(c.decode(e));else i=e;if(i.asset===void 0||i.asset.version[0]<2){n&&n(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const l=new Jl(i,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let h=0;h<this.pluginCallbacks.length;h++){const u=this.pluginCallbacks[h](l);u.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),r[u.name]=u,o[u.name]=!0}if(i.extensionsUsed)for(let h=0;h<i.extensionsUsed.length;++h){const u=i.extensionsUsed[h],d=i.extensionsRequired||[];switch(u){case q.KHR_MATERIALS_UNLIT:o[u]=new _l;break;case q.KHR_DRACO_MESH_COMPRESSION:o[u]=new Gl(i,this.dracoLoader);break;case q.KHR_TEXTURE_TRANSFORM:o[u]=new Ul;break;case q.KHR_MESH_QUANTIZATION:o[u]=new Hl;break;default:d.indexOf(u)>=0&&r[u]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+u+'".')}}l.setExtensions(o),l.setPlugins(r),l.parse(s,n)}parseAsync(e,t){const s=this;return new Promise(function(n,i){s.parse(e,t,n,i)})}}function bl(){let a={};return{get:function(e){return a[e]},add:function(e,t){a[e]=t},remove:function(e){delete a[e]},removeAll:function(){a={}}}}const q={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class yl{constructor(e){this.parser=e,this.name=q.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,t=this.parser.json.nodes||[];for(let s=0,n=t.length;s<n;s++){const i=t[s];i.extensions&&i.extensions[this.name]&&i.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,i.extensions[this.name].light)}}_loadLight(e){const t=this.parser,s="light:"+e;let n=t.cache.get(s);if(n)return n;const i=t.json,c=((i.extensions&&i.extensions[this.name]||{}).lights||[])[e];let l;const h=new Qe(16777215);c.color!==void 0&&h.setRGB(c.color[0],c.color[1],c.color[2],ze);const u=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new wa(h),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new ga(h),l.distance=u;break;case"spot":l=new va(h),l.distance=u,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),Ke(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),n=Promise.resolve(l),t.cache.add(s,n),n}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){const t=this,s=this.parser,i=s.json.nodes[e],r=(i.extensions&&i.extensions[this.name]||{}).light;return r===void 0?null:this._loadLight(r).then(function(c){return s._getNodeRef(t.cache,r,c)})}}class _l{constructor(){this.name=q.KHR_MATERIALS_UNLIT}getMaterialType(){return ts}extendParams(e,t,s){const n=[];e.color=new Qe(1,1,1),e.opacity=1;const i=t.pbrMetallicRoughness;if(i){if(Array.isArray(i.baseColorFactor)){const o=i.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],ze),e.opacity=o[3]}i.baseColorTexture!==void 0&&n.push(s.assignTexture(e,"map",i.baseColorTexture,Gt))}return Promise.all(n)}}class Ml{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name].emissiveStrength;return i!==void 0&&(t.emissiveIntensity=i),Promise.resolve()}}class Tl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];if(o.clearcoatFactor!==void 0&&(t.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&i.push(s.assignTexture(t,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&i.push(s.assignTexture(t,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(i.push(s.assignTexture(t,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){const r=o.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new ce(r,r)}return Promise.all(i)}}class Sl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_DISPERSION}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name];return t.dispersion=i.dispersion!==void 0?i.dispersion:0,Promise.resolve()}}class Al{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.iridescenceFactor!==void 0&&(t.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&i.push(s.assignTexture(t,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(t.iridescenceIOR=o.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&i.push(s.assignTexture(t,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(i)}}class kl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_SHEEN}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[];t.sheenColor=new Qe(0,0,0),t.sheenRoughness=0,t.sheen=1;const o=n.extensions[this.name];if(o.sheenColorFactor!==void 0){const r=o.sheenColorFactor;t.sheenColor.setRGB(r[0],r[1],r[2],ze)}return o.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&i.push(s.assignTexture(t,"sheenColorMap",o.sheenColorTexture,Gt)),o.sheenRoughnessTexture!==void 0&&i.push(s.assignTexture(t,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(i)}}class Rl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.transmissionFactor!==void 0&&(t.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&i.push(s.assignTexture(t,"transmissionMap",o.transmissionTexture)),Promise.all(i)}}class El{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_VOLUME}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];t.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&i.push(s.assignTexture(t,"thicknessMap",o.thicknessTexture)),t.attenuationDistance=o.attenuationDistance||1/0;const r=o.attenuationColor||[1,1,1];return t.attenuationColor=new Qe().setRGB(r[0],r[1],r[2],ze),Promise.all(i)}}class Cl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_IOR}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const n=this.parser.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=n.extensions[this.name];return t.ior=i.ior!==void 0?i.ior:1.5,Promise.resolve()}}class zl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_SPECULAR}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];t.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&i.push(s.assignTexture(t,"specularIntensityMap",o.specularTexture));const r=o.specularColorFactor||[1,1,1];return t.specularColor=new Qe().setRGB(r[0],r[1],r[2],ze),o.specularColorTexture!==void 0&&i.push(s.assignTexture(t,"specularColorMap",o.specularColorTexture,Gt)),Promise.all(i)}}class Ll{constructor(e){this.parser=e,this.name=q.EXT_MATERIALS_BUMP}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return t.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&i.push(s.assignTexture(t,"bumpMap",o.bumpTexture)),Promise.all(i)}}class Dl{constructor(e){this.parser=e,this.name=q.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){const s=this.parser.json.materials[e];return!s.extensions||!s.extensions[this.name]?null:Ve}extendMaterialParams(e,t){const s=this.parser,n=s.json.materials[e];if(!n.extensions||!n.extensions[this.name])return Promise.resolve();const i=[],o=n.extensions[this.name];return o.anisotropyStrength!==void 0&&(t.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(t.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&i.push(s.assignTexture(t,"anisotropyMap",o.anisotropyTexture)),Promise.all(i)}}class Fl{constructor(e){this.parser=e,this.name=q.KHR_TEXTURE_BASISU}loadTexture(e){const t=this.parser,s=t.json,n=s.textures[e];if(!n.extensions||!n.extensions[this.name])return null;const i=n.extensions[this.name],o=t.options.ktx2Loader;if(!o){if(s.extensionsRequired&&s.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,i.source,o)}}class Il{constructor(e){this.parser=e,this.name=q.EXT_TEXTURE_WEBP}loadTexture(e){const t=this.name,s=this.parser,n=s.json,i=n.textures[e];if(!i.extensions||!i.extensions[t])return null;const o=i.extensions[t],r=n.images[o.source];let c=s.textureLoader;if(r.uri){const l=s.options.manager.getHandler(r.uri);l!==null&&(c=l)}return s.loadTextureImage(e,o.source,c)}}class Pl{constructor(e){this.parser=e,this.name=q.EXT_TEXTURE_AVIF}loadTexture(e){const t=this.name,s=this.parser,n=s.json,i=n.textures[e];if(!i.extensions||!i.extensions[t])return null;const o=i.extensions[t],r=n.images[o.source];let c=s.textureLoader;if(r.uri){const l=s.options.manager.getHandler(r.uri);l!==null&&(c=l)}return s.loadTextureImage(e,o.source,c)}}class Nl{constructor(e){this.name=q.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){const t=this.parser.json,s=t.bufferViews[e];if(s.extensions&&s.extensions[this.name]){const n=s.extensions[this.name],i=this.parser.getDependency("buffer",n.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return i.then(function(r){const c=n.byteOffset||0,l=n.byteLength||0,h=n.count,u=n.byteStride,d=new Uint8Array(r,c,l);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(h,u,d,n.mode,n.filter).then(function(f){return f.buffer}):o.ready.then(function(){const f=new ArrayBuffer(h*u);return o.decodeGltfBuffer(new Uint8Array(f),h,u,d,n.mode,n.filter),f})})}else return null}}class Ol{constructor(e){this.name=q.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const t=this.parser.json,s=t.nodes[e];if(!s.extensions||!s.extensions[this.name]||s.mesh===void 0)return null;const n=t.meshes[s.mesh];for(const l of n.primitives)if(l.mode!==Ce.TRIANGLES&&l.mode!==Ce.TRIANGLE_STRIP&&l.mode!==Ce.TRIANGLE_FAN&&l.mode!==void 0)return null;const o=s.extensions[this.name].attributes,r=[],c={};for(const l in o)r.push(this.parser.getDependency("accessor",o[l]).then(h=>(c[l]=h,c[l])));return r.length<1?null:(r.push(this.parser.createNodeMesh(e)),Promise.all(r).then(l=>{const h=l.pop(),u=h.isGroup?h.children:[h],d=l[0].count,f=[];for(const p of u){const m=new Bt,v=new Z,g=new Dn,w=new Z(1,1,1),x=new fi(p.geometry,p.material,d);for(let y=0;y<d;y++)c.TRANSLATION&&v.fromBufferAttribute(c.TRANSLATION,y),c.ROTATION&&g.fromBufferAttribute(c.ROTATION,y),c.SCALE&&w.fromBufferAttribute(c.SCALE,y),x.setMatrixAt(y,m.compose(v,g,w));for(const y in c)if(y==="_COLOR_0"){const T=c[y];x.instanceColor=new dt(T.array,T.itemSize,T.normalized)}else y!=="TRANSLATION"&&y!=="ROTATION"&&y!=="SCALE"&&p.geometry.setAttribute(y,c[y]);mt.prototype.copy.call(x,p),this.parser.assignFinalMaterial(x),f.push(x)}return h.isGroup?(h.clear(),h.add(...f),h):f[0]}))}}const $i="glTF",Xt=12,Po={JSON:1313821514,BIN:5130562};class Bl{constructor(e){this.name=q.KHR_BINARY_GLTF,this.content=null,this.body=null;const t=new DataView(e,0,Xt),s=new TextDecoder;if(this.header={magic:s.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==$i)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const n=this.header.length-Xt,i=new DataView(e,Xt);let o=0;for(;o<n;){const r=i.getUint32(o,!0);o+=4;const c=i.getUint32(o,!0);if(o+=4,c===Po.JSON){const l=new Uint8Array(e,Xt+o,r);this.content=s.decode(l)}else if(c===Po.BIN){const l=Xt+o;this.body=e.slice(l,l+r)}o+=r}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class Gl{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=q.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){const s=this.json,n=this.dracoLoader,i=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,r={},c={},l={};for(const h in o){const u=kn[h]||h.toLowerCase();r[u]=o[h]}for(const h in e.attributes){const u=kn[h]||h.toLowerCase();if(o[h]!==void 0){const d=s.accessors[e.attributes[h]],f=Nt[d.componentType];l[u]=f.name,c[u]=d.normalized===!0}}return t.getDependency("bufferView",i).then(function(h){return new Promise(function(u,d){n.decodeDracoFile(h,function(f){for(const p in f.attributes){const m=f.attributes[p],v=c[p];v!==void 0&&(m.normalized=v)}u(f)},r,l,ze,d)})})}}class Ul{constructor(){this.name=q.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}}class Hl{constructor(){this.name=q.KHR_MESH_QUANTIZATION}}class ji extends Ua{constructor(e,t,s,n){super(e,t,s,n)}copySampleValue_(e){const t=this.resultBuffer,s=this.sampleValues,n=this.valueSize,i=e*n*3+n;for(let o=0;o!==n;o++)t[o]=s[i+o];return t}interpolate_(e,t,s,n){const i=this.resultBuffer,o=this.sampleValues,r=this.valueSize,c=r*2,l=r*3,h=n-t,u=(s-t)/h,d=u*u,f=d*u,p=e*l,m=p-l,v=-2*f+3*d,g=f-d,w=1-v,x=g-d+u;for(let y=0;y!==r;y++){const T=o[m+y+r],b=o[m+y+c]*h,M=o[p+y+r],_=o[p+y]*h;i[y]=w*T+x*b+v*M+g*_}return i}}const Wl=new Dn;class Kl extends ji{interpolate_(e,t,s,n){const i=super.interpolate_(e,t,s,n);return Wl.fromArray(i).normalize().toArray(i),i}}const Ce={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},Nt={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},No={9728:vi,9729:be,9984:Ta,9985:Ma,9986:_a,9987:Ln},Oo={33071:Pe,33648:Sa,10497:xn},on={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},kn={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},rt={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},ql={CUBICSPLINE:void 0,LINEAR:xi,STEP:Ba},an={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function $l(a){return a.DefaultMaterial===void 0&&(a.DefaultMaterial=new gi({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:Cn})),a.DefaultMaterial}function wt(a,e,t){for(const s in t.extensions)a[s]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[s]=t.extensions[s])}function Ke(a,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(a.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function jl(a,e,t){let s=!1,n=!1,i=!1;for(let l=0,h=e.length;l<h;l++){const u=e[l];if(u.POSITION!==void 0&&(s=!0),u.NORMAL!==void 0&&(n=!0),u.COLOR_0!==void 0&&(i=!0),s&&n&&i)break}if(!s&&!n&&!i)return Promise.resolve(a);const o=[],r=[],c=[];for(let l=0,h=e.length;l<h;l++){const u=e[l];if(s){const d=u.POSITION!==void 0?t.getDependency("accessor",u.POSITION):a.attributes.position;o.push(d)}if(n){const d=u.NORMAL!==void 0?t.getDependency("accessor",u.NORMAL):a.attributes.normal;r.push(d)}if(i){const d=u.COLOR_0!==void 0?t.getDependency("accessor",u.COLOR_0):a.attributes.color;c.push(d)}}return Promise.all([Promise.all(o),Promise.all(r),Promise.all(c)]).then(function(l){const h=l[0],u=l[1],d=l[2];return s&&(a.morphAttributes.position=h),n&&(a.morphAttributes.normal=u),i&&(a.morphAttributes.color=d),a.morphTargetsRelative=!0,a})}function Vl(a,e){if(a.updateMorphTargets(),e.weights!==void 0)for(let t=0,s=e.weights.length;t<s;t++)a.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){const t=e.extras.targetNames;if(a.morphTargetInfluences.length===t.length){a.morphTargetDictionary={};for(let s=0,n=t.length;s<n;s++)a.morphTargetDictionary[t[s]]=s}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function Yl(a){let e;const t=a.extensions&&a.extensions[q.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+rn(t.attributes):e=a.indices+":"+rn(a.attributes)+":"+a.mode,a.targets!==void 0)for(let s=0,n=a.targets.length;s<n;s++)e+=":"+rn(a.targets[s]);return e}function rn(a){let e="";const t=Object.keys(a).sort();for(let s=0,n=t.length;s<n;s++)e+=t[s]+":"+a[t[s]]+";";return e}function Rn(a){switch(a){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function Xl(a){return a.search(/\.jpe?g($|\?)/i)>0||a.search(/^data\:image\/jpeg/)===0?"image/jpeg":a.search(/\.webp($|\?)/i)>0||a.search(/^data\:image\/webp/)===0?"image/webp":a.search(/\.ktx2($|\?)/i)>0||a.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const Zl=new Bt;class Jl{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new bl,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let s=!1,n=-1,i=!1,o=-1;if(typeof navigator<"u"){const r=navigator.userAgent;s=/^((?!chrome|android).)*safari/i.test(r)===!0;const c=r.match(/Version\/(\d+)/);n=s&&c?parseInt(c[1],10):-1,i=r.indexOf("Firefox")>-1,o=i?r.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||s&&n<17||i&&o<98?this.textureLoader=new xa(this.options.manager):this.textureLoader=new ba(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new mi(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){const s=this,n=this.json,i=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([s.getDependencies("scene"),s.getDependencies("animation"),s.getDependencies("camera")])}).then(function(o){const r={scene:o[0][n.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:n.asset,parser:s,userData:{}};return wt(i,r,n),Ke(r,n),Promise.all(s._invokeAll(function(c){return c.afterRoot&&c.afterRoot(r)})).then(function(){for(const c of r.scenes)c.updateMatrixWorld();e(r)})}).catch(t)}_markDefs(){const e=this.json.nodes||[],t=this.json.skins||[],s=this.json.meshes||[];for(let n=0,i=t.length;n<i;n++){const o=t[n].joints;for(let r=0,c=o.length;r<c;r++)e[o[r]].isBone=!0}for(let n=0,i=e.length;n<i;n++){const o=e[n];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(s[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,s){if(e.refs[t]<=1)return s;const n=s.clone(),i=(o,r)=>{const c=this.associations.get(o);c!=null&&this.associations.set(r,c);for(const[l,h]of o.children.entries())i(h,r.children[l])};return i(s,n),n.name+="_instance_"+e.uses[t]++,n}_invokeOne(e){const t=Object.values(this.plugins);t.push(this);for(let s=0;s<t.length;s++){const n=e(t[s]);if(n)return n}return null}_invokeAll(e){const t=Object.values(this.plugins);t.unshift(this);const s=[];for(let n=0;n<t.length;n++){const i=e(t[n]);i&&s.push(i)}return s}getDependency(e,t){const s=e+":"+t;let n=this.cache.get(s);if(!n){switch(e){case"scene":n=this.loadScene(t);break;case"node":n=this._invokeOne(function(i){return i.loadNode&&i.loadNode(t)});break;case"mesh":n=this._invokeOne(function(i){return i.loadMesh&&i.loadMesh(t)});break;case"accessor":n=this.loadAccessor(t);break;case"bufferView":n=this._invokeOne(function(i){return i.loadBufferView&&i.loadBufferView(t)});break;case"buffer":n=this.loadBuffer(t);break;case"material":n=this._invokeOne(function(i){return i.loadMaterial&&i.loadMaterial(t)});break;case"texture":n=this._invokeOne(function(i){return i.loadTexture&&i.loadTexture(t)});break;case"skin":n=this.loadSkin(t);break;case"animation":n=this._invokeOne(function(i){return i.loadAnimation&&i.loadAnimation(t)});break;case"camera":n=this.loadCamera(t);break;default:if(n=this._invokeOne(function(i){return i!=this&&i.getDependency&&i.getDependency(e,t)}),!n)throw new Error("Unknown type: "+e);break}this.cache.add(s,n)}return n}getDependencies(e){let t=this.cache.get(e);if(!t){const s=this,n=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(n.map(function(i,o){return s.getDependency(e,o)})),this.cache.add(e,t)}return t}loadBuffer(e){const t=this.json.buffers[e],s=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[q.KHR_BINARY_GLTF].body);const n=this.options;return new Promise(function(i,o){s.load(ls.resolveURL(t.uri,n.path),i,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){const t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(s){const n=t.byteLength||0,i=t.byteOffset||0;return s.slice(i,i+n)})}loadAccessor(e){const t=this,s=this.json,n=this.json.accessors[e];if(n.bufferView===void 0&&n.sparse===void 0){const o=on[n.type],r=Nt[n.componentType],c=n.normalized===!0,l=new r(n.count*o);return Promise.resolve(new H(l,o,c))}const i=[];return n.bufferView!==void 0?i.push(this.getDependency("bufferView",n.bufferView)):i.push(null),n.sparse!==void 0&&(i.push(this.getDependency("bufferView",n.sparse.indices.bufferView)),i.push(this.getDependency("bufferView",n.sparse.values.bufferView))),Promise.all(i).then(function(o){const r=o[0],c=on[n.type],l=Nt[n.componentType],h=l.BYTES_PER_ELEMENT,u=h*c,d=n.byteOffset||0,f=n.bufferView!==void 0?s.bufferViews[n.bufferView].byteStride:void 0,p=n.normalized===!0;let m,v;if(f&&f!==u){const g=Math.floor(d/f),w="InterleavedBuffer:"+n.bufferView+":"+n.componentType+":"+g+":"+n.count;let x=t.cache.get(w);x||(m=new l(r,g*f,n.count*f/h),x=new ya(m,f/h),t.cache.add(w,x)),v=new Ga(x,c,d%f/h,p)}else r===null?m=new l(n.count*c):m=new l(r,d,n.count*c),v=new H(m,c,p);if(n.sparse!==void 0){const g=on.SCALAR,w=Nt[n.sparse.indices.componentType],x=n.sparse.indices.byteOffset||0,y=n.sparse.values.byteOffset||0,T=new w(o[1],x,n.sparse.count*g),b=new l(o[2],y,n.sparse.count*c);r!==null&&(v=new H(v.array.slice(),v.itemSize,v.normalized)),v.normalized=!1;for(let M=0,_=T.length;M<_;M++){const S=T[M];if(v.setX(S,b[M*c]),c>=2&&v.setY(S,b[M*c+1]),c>=3&&v.setZ(S,b[M*c+2]),c>=4&&v.setW(S,b[M*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}v.normalized=p}return v})}loadTexture(e){const t=this.json,s=this.options,i=t.textures[e].source,o=t.images[i];let r=this.textureLoader;if(o.uri){const c=s.manager.getHandler(o.uri);c!==null&&(r=c)}return this.loadTextureImage(e,i,r)}loadTextureImage(e,t,s){const n=this,i=this.json,o=i.textures[e],r=i.images[t],c=(r.uri||r.bufferView)+":"+o.sampler;if(this.textureCache[c])return this.textureCache[c];const l=this.loadImageSource(t,s).then(function(h){h.flipY=!1,h.name=o.name||r.name||"",h.name===""&&typeof r.uri=="string"&&r.uri.startsWith("data:image/")===!1&&(h.name=r.uri);const d=(i.samplers||{})[o.sampler]||{};return h.magFilter=No[d.magFilter]||be,h.minFilter=No[d.minFilter]||Ln,h.wrapS=Oo[d.wrapS]||xn,h.wrapT=Oo[d.wrapT]||xn,h.generateMipmaps=!h.isCompressedTexture&&h.minFilter!==vi&&h.minFilter!==be,n.associations.set(h,{textures:e}),h}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){const s=this,n=this.json,i=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(u=>u.clone());const o=n.images[e],r=self.URL||self.webkitURL;let c=o.uri||"",l=!1;if(o.bufferView!==void 0)c=s.getDependency("bufferView",o.bufferView).then(function(u){l=!0;const d=new Blob([u],{type:o.mimeType});return c=r.createObjectURL(d),c});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const h=Promise.resolve(c).then(function(u){return new Promise(function(d,f){let p=d;t.isImageBitmapLoader===!0&&(p=function(m){const v=new Yn(m);v.needsUpdate=!0,d(v)}),t.load(ls.resolveURL(u,i.path),p,void 0,f)})}).then(function(u){return l===!0&&r.revokeObjectURL(c),Ke(u,o),u.userData.mimeType=o.mimeType||Xl(o.uri),u}).catch(function(u){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),u});return this.sourceCache[e]=h,h}assignTexture(e,t,s,n){const i=this;return this.getDependency("texture",s.index).then(function(o){if(!o)return null;if(s.texCoord!==void 0&&s.texCoord>0&&(o=o.clone(),o.channel=s.texCoord),i.extensions[q.KHR_TEXTURE_TRANSFORM]){const r=s.extensions!==void 0?s.extensions[q.KHR_TEXTURE_TRANSFORM]:void 0;if(r){const c=i.associations.get(o);o=i.extensions[q.KHR_TEXTURE_TRANSFORM].extendTexture(o,r),i.associations.set(o,c)}}return n!==void 0&&(o.colorSpace=n),e[t]=o,o})}assignFinalMaterial(e){const t=e.geometry;let s=e.material;const n=t.attributes.tangent===void 0,i=t.attributes.color!==void 0,o=t.attributes.normal===void 0;if(e.isPoints){const r="PointsMaterial:"+s.uuid;let c=this.cache.get(r);c||(c=new Aa,Zs.prototype.copy.call(c,s),c.color.copy(s.color),c.map=s.map,c.sizeAttenuation=!1,this.cache.add(r,c)),s=c}else if(e.isLine){const r="LineBasicMaterial:"+s.uuid;let c=this.cache.get(r);c||(c=new ka,Zs.prototype.copy.call(c,s),c.color.copy(s.color),c.map=s.map,this.cache.add(r,c)),s=c}if(n||i||o){let r="ClonedMaterial:"+s.uuid+":";n&&(r+="derivative-tangents:"),i&&(r+="vertex-colors:"),o&&(r+="flat-shading:");let c=this.cache.get(r);c||(c=s.clone(),i&&(c.vertexColors=!0),o&&(c.flatShading=!0),n&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(r,c),this.associations.set(c,this.associations.get(s))),s=c}e.material=s}getMaterialType(){return gi}loadMaterial(e){const t=this,s=this.json,n=this.extensions,i=s.materials[e];let o;const r={},c=i.extensions||{},l=[];if(c[q.KHR_MATERIALS_UNLIT]){const u=n[q.KHR_MATERIALS_UNLIT];o=u.getMaterialType(),l.push(u.extendParams(r,i,t))}else{const u=i.pbrMetallicRoughness||{};if(r.color=new Qe(1,1,1),r.opacity=1,Array.isArray(u.baseColorFactor)){const d=u.baseColorFactor;r.color.setRGB(d[0],d[1],d[2],ze),r.opacity=d[3]}u.baseColorTexture!==void 0&&l.push(t.assignTexture(r,"map",u.baseColorTexture,Gt)),r.metalness=u.metallicFactor!==void 0?u.metallicFactor:1,r.roughness=u.roughnessFactor!==void 0?u.roughnessFactor:1,u.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(r,"metalnessMap",u.metallicRoughnessTexture)),l.push(t.assignTexture(r,"roughnessMap",u.metallicRoughnessTexture))),o=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,r)})))}i.doubleSided===!0&&(r.side=et);const h=i.alphaMode||an.OPAQUE;if(h===an.BLEND?(r.transparent=!0,r.depthWrite=!1):(r.transparent=!1,h===an.MASK&&(r.alphaTest=i.alphaCutoff!==void 0?i.alphaCutoff:.5)),i.normalTexture!==void 0&&o!==ts&&(l.push(t.assignTexture(r,"normalMap",i.normalTexture)),r.normalScale=new ce(1,1),i.normalTexture.scale!==void 0)){const u=i.normalTexture.scale;r.normalScale.set(u,u)}if(i.occlusionTexture!==void 0&&o!==ts&&(l.push(t.assignTexture(r,"aoMap",i.occlusionTexture)),i.occlusionTexture.strength!==void 0&&(r.aoMapIntensity=i.occlusionTexture.strength)),i.emissiveFactor!==void 0&&o!==ts){const u=i.emissiveFactor;r.emissive=new Qe().setRGB(u[0],u[1],u[2],ze)}return i.emissiveTexture!==void 0&&o!==ts&&l.push(t.assignTexture(r,"emissiveMap",i.emissiveTexture,Gt)),Promise.all(l).then(function(){const u=new o(r);return i.name&&(u.name=i.name),Ke(u,i),t.associations.set(u,{materials:e}),i.extensions&&wt(n,u,i),u})}createUniqueName(e){const t=Ra.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){const t=this,s=this.extensions,n=this.primitiveCache;function i(r){return s[q.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(r,t).then(function(c){return Bo(c,r,t)})}const o=[];for(let r=0,c=e.length;r<c;r++){const l=e[r],h=Yl(l),u=n[h];if(u)o.push(u.promise);else{let d;l.extensions&&l.extensions[q.KHR_DRACO_MESH_COMPRESSION]?d=i(l):d=Bo(new tt,l,t),n[h]={primitive:l,promise:d},o.push(d)}}return Promise.all(o)}loadMesh(e){const t=this,s=this.json,n=this.extensions,i=s.meshes[e],o=i.primitives,r=[];for(let c=0,l=o.length;c<l;c++){const h=o[c].material===void 0?$l(this.cache):this.getDependency("material",o[c].material);r.push(h)}return r.push(t.loadGeometries(o)),Promise.all(r).then(function(c){const l=c.slice(0,c.length-1),h=c[c.length-1],u=[];for(let f=0,p=h.length;f<p;f++){const m=h[f],v=o[f];let g;const w=l[f];if(v.mode===Ce.TRIANGLES||v.mode===Ce.TRIANGLE_STRIP||v.mode===Ce.TRIANGLE_FAN||v.mode===void 0)g=i.isSkinnedMesh===!0?new Ea(m,w):new Me(m,w),g.isSkinnedMesh===!0&&g.normalizeSkinWeights(),v.mode===Ce.TRIANGLE_STRIP?g.geometry=Io(g.geometry,pi):v.mode===Ce.TRIANGLE_FAN&&(g.geometry=Io(g.geometry,wn));else if(v.mode===Ce.LINES)g=new Ca(m,w);else if(v.mode===Ce.LINE_STRIP)g=new za(m,w);else if(v.mode===Ce.LINE_LOOP)g=new La(m,w);else if(v.mode===Ce.POINTS)g=new Da(m,w);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+v.mode);Object.keys(g.geometry.morphAttributes).length>0&&Vl(g,i),g.name=t.createUniqueName(i.name||"mesh_"+e),Ke(g,i),v.extensions&&wt(n,g,v),t.assignFinalMaterial(g),u.push(g)}for(let f=0,p=u.length;f<p;f++)t.associations.set(u[f],{meshes:e,primitives:f});if(u.length===1)return i.extensions&&wt(n,u[0],i),u[0];const d=new Je;i.extensions&&wt(n,d,i),t.associations.set(d,{meshes:e});for(let f=0,p=u.length;f<p;f++)d.add(u[f]);return d})}loadCamera(e){let t;const s=this.json.cameras[e],n=s[s.type];if(!n){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return s.type==="perspective"?t=new wi(Fa.radToDeg(n.yfov),n.aspectRatio||1,n.znear||1,n.zfar||2e6):s.type==="orthographic"&&(t=new Ia(-n.xmag,n.xmag,n.ymag,-n.ymag,n.znear,n.zfar)),s.name&&(t.name=this.createUniqueName(s.name)),Ke(t,s),Promise.resolve(t)}loadSkin(e){const t=this.json.skins[e],s=[];for(let n=0,i=t.joints.length;n<i;n++)s.push(this._loadNodeShallow(t.joints[n]));return t.inverseBindMatrices!==void 0?s.push(this.getDependency("accessor",t.inverseBindMatrices)):s.push(null),Promise.all(s).then(function(n){const i=n.pop(),o=n,r=[],c=[];for(let l=0,h=o.length;l<h;l++){const u=o[l];if(u){r.push(u);const d=new Bt;i!==null&&d.fromArray(i.array,l*16),c.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new Pa(r,c)})}loadAnimation(e){const t=this.json,s=this,n=t.animations[e],i=n.name?n.name:"animation_"+e,o=[],r=[],c=[],l=[],h=[];for(let u=0,d=n.channels.length;u<d;u++){const f=n.channels[u],p=n.samplers[f.sampler],m=f.target,v=m.node,g=n.parameters!==void 0?n.parameters[p.input]:p.input,w=n.parameters!==void 0?n.parameters[p.output]:p.output;m.node!==void 0&&(o.push(this.getDependency("node",v)),r.push(this.getDependency("accessor",g)),c.push(this.getDependency("accessor",w)),l.push(p),h.push(m))}return Promise.all([Promise.all(o),Promise.all(r),Promise.all(c),Promise.all(l),Promise.all(h)]).then(function(u){const d=u[0],f=u[1],p=u[2],m=u[3],v=u[4],g=[];for(let x=0,y=d.length;x<y;x++){const T=d[x],b=f[x],M=p[x],_=m[x],S=v[x];if(T===void 0)continue;T.updateMatrix&&T.updateMatrix();const k=s._createAnimationTracks(T,b,M,_,S);if(k)for(let L=0;L<k.length;L++)g.push(k[L])}const w=new Na(i,void 0,g);return Ke(w,n),w})}createNodeMesh(e){const t=this.json,s=this,n=t.nodes[e];return n.mesh===void 0?null:s.getDependency("mesh",n.mesh).then(function(i){const o=s._getNodeRef(s.meshCache,n.mesh,i);return n.weights!==void 0&&o.traverse(function(r){if(r.isMesh)for(let c=0,l=n.weights.length;c<l;c++)r.morphTargetInfluences[c]=n.weights[c]}),o})}loadNode(e){const t=this.json,s=this,n=t.nodes[e],i=s._loadNodeShallow(e),o=[],r=n.children||[];for(let l=0,h=r.length;l<h;l++)o.push(s.getDependency("node",r[l]));const c=n.skin===void 0?Promise.resolve(null):s.getDependency("skin",n.skin);return Promise.all([i,Promise.all(o),c]).then(function(l){const h=l[0],u=l[1],d=l[2];d!==null&&h.traverse(function(f){f.isSkinnedMesh&&f.bind(d,Zl)});for(let f=0,p=u.length;f<p;f++)h.add(u[f]);return h})}_loadNodeShallow(e){const t=this.json,s=this.extensions,n=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const i=t.nodes[e],o=i.name?n.createUniqueName(i.name):"",r=[],c=n._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&r.push(c),i.camera!==void 0&&r.push(n.getDependency("camera",i.camera).then(function(l){return n._getNodeRef(n.cameraCache,i.camera,l)})),n._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){r.push(l)}),this.nodeCache[e]=Promise.all(r).then(function(l){let h;if(i.isBone===!0?h=new Oa:l.length>1?h=new Je:l.length===1?h=l[0]:h=new mt,h!==l[0])for(let u=0,d=l.length;u<d;u++)h.add(l[u]);if(i.name&&(h.userData.name=i.name,h.name=o),Ke(h,i),i.extensions&&wt(s,h,i),i.matrix!==void 0){const u=new Bt;u.fromArray(i.matrix),h.applyMatrix4(u)}else i.translation!==void 0&&h.position.fromArray(i.translation),i.rotation!==void 0&&h.quaternion.fromArray(i.rotation),i.scale!==void 0&&h.scale.fromArray(i.scale);if(!n.associations.has(h))n.associations.set(h,{});else if(i.mesh!==void 0&&n.meshCache.refs[i.mesh]>1){const u=n.associations.get(h);n.associations.set(h,{...u})}return n.associations.get(h).nodes=e,h}),this.nodeCache[e]}loadScene(e){const t=this.extensions,s=this.json.scenes[e],n=this,i=new Je;s.name&&(i.name=n.createUniqueName(s.name)),Ke(i,s),s.extensions&&wt(t,i,s);const o=s.nodes||[],r=[];for(let c=0,l=o.length;c<l;c++)r.push(n.getDependency("node",o[c]));return Promise.all(r).then(function(c){for(let h=0,u=c.length;h<u;h++)i.add(c[h]);const l=h=>{const u=new Map;for(const[d,f]of n.associations)(d instanceof Zs||d instanceof Yn)&&u.set(d,f);return h.traverse(d=>{const f=n.associations.get(d);f!=null&&u.set(d,f)}),u};return n.associations=l(i),i})}_createAnimationTracks(e,t,s,n,i){const o=[],r=e.name?e.name:e.uuid,c=[];rt[i.path]===rt.weights?e.traverse(function(d){d.morphTargetInfluences&&c.push(d.name?d.name:d.uuid)}):c.push(r);let l;switch(rt[i.path]){case rt.weights:l=Zn;break;case rt.rotation:l=Jn;break;case rt.translation:case rt.scale:l=Xn;break;default:switch(s.itemSize){case 1:l=Zn;break;case 2:case 3:default:l=Xn;break}break}const h=n.interpolation!==void 0?ql[n.interpolation]:xi,u=this._getArrayFromAccessor(s);for(let d=0,f=c.length;d<f;d++){const p=new l(c[d]+"."+rt[i.path],t.array,u,h);n.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(p),o.push(p)}return o}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){const s=Rn(t.constructor),n=new Float32Array(t.length);for(let i=0,o=t.length;i<o;i++)n[i]=t[i]*s;t=n}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(s){const n=this instanceof Jn?Kl:ji;return new n(this.times,this.values,this.getValueSize()/3,s)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function Ql(a,e,t){const s=e.attributes,n=new Ds;if(s.POSITION!==void 0){const r=t.json.accessors[s.POSITION],c=r.min,l=r.max;if(c!==void 0&&l!==void 0){if(n.set(new Z(c[0],c[1],c[2]),new Z(l[0],l[1],l[2])),r.normalized){const h=Rn(Nt[r.componentType]);n.min.multiplyScalar(h),n.max.multiplyScalar(h)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const i=e.targets;if(i!==void 0){const r=new Z,c=new Z;for(let l=0,h=i.length;l<h;l++){const u=i[l];if(u.POSITION!==void 0){const d=t.json.accessors[u.POSITION],f=d.min,p=d.max;if(f!==void 0&&p!==void 0){if(c.setX(Math.max(Math.abs(f[0]),Math.abs(p[0]))),c.setY(Math.max(Math.abs(f[1]),Math.abs(p[1]))),c.setZ(Math.max(Math.abs(f[2]),Math.abs(p[2]))),d.normalized){const m=Rn(Nt[d.componentType]);c.multiplyScalar(m)}r.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}n.expandByVector(r)}a.boundingBox=n;const o=new st;n.getCenter(o.center),o.radius=n.min.distanceTo(n.max)/2,a.boundingSphere=o}function Bo(a,e,t){const s=e.attributes,n=[];function i(o,r){return t.getDependency("accessor",o).then(function(c){a.setAttribute(r,c)})}for(const o in s){const r=kn[o]||o.toLowerCase();r in a.attributes||n.push(i(s[o],r))}if(e.indices!==void 0&&!a.index){const o=t.getDependency("accessor",e.indices).then(function(r){a.setIndex(r)});n.push(o)}return Qn.workingColorSpace!==ze&&"COLOR_0"in s&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${Qn.workingColorSpace}" not supported.`),Ke(a,e),Ql(a,e,t),Promise.all(n).then(function(){return e.targets!==void 0?jl(a,e.targets,t):a})}const St={coupe:{file:"coupe.glb",label:"Coupe",tier:"sports",length:4.3},hatch:{file:"hatch.glb",label:"Hatch",tier:"gt",length:4},sedan:{file:"sedan.glb",label:"Sedan",tier:"gt",length:4.5},estate:{file:"estate.glb",label:"Estate",tier:"gt",length:4.6},taxi:{file:"taxi.glb",label:"Taxi",tier:"gt",length:4.5},rally:{file:"rally.glb",label:"Rally",tier:"sports",length:4.2},patrol:{file:"patrol.glb",label:"Patrol",tier:"sports",length:4.6}},Is=Object.keys(St),Go=[fe.paintA,fe.paintB,fe.paintC,fe.paintD,fe.paintE,fe.paintF];function eh(a,e){const t=(a||"").toLowerCase();return t.includes("window")||t.includes("glass")?{col:fe.glass,mat:O.METAL}:t.includes("headlight")?{col:fe.head,mat:O.EMIT}:t.includes("taillight")||t.includes("brakelight")?{col:fe.tail,mat:O.EMIT}:t.includes("whitelight")?{col:fe.head,mat:O.EMIT}:t.includes("bluelight")?{col:"#5A8BD6",mat:O.EMIT}:t.includes("black")?{col:fe.tyre,mat:O.MATTE}:t.includes("grey")||t.includes("gray")||t.includes("chrome")||t.includes("metal")?{col:fe.chrome,mat:O.METAL}:t.includes("rust")?{col:fe.trunkShade,mat:O.MATTE}:{col:e,mat:O.MATTE}}const th=a=>{const e=a.replace("#","");return[parseInt(e.slice(0,2),16)/255,parseInt(e.slice(2,4),16)/255,parseInt(e.slice(4,6),16)/255]};let cn=null;const ln=new Map;function sh(){return cn||(cn=new xl),cn}function nh(a){if(ln.has(a))return ln.get(a);const e=new Promise((t,s)=>sh().load(a,n=>t(n),void 0,s));return ln.set(a,e),e}async function Uo({car:a="coupe",paint:e=0,base:t="./models/cars/",ghost:s=!1}={}){const n=St[a]||St.coupe,o=(await nh(t+n.file)).scene.clone(!0),r=Go[e%Go.length],c=On(s?{ghost:!0,opacity:.85}:{});o.traverse(x=>{if(!x.isMesh)return;const y=Array.isArray(x.material)?x.material[0]:x.material,{col:T,mat:b}=eh(y&&y.name,r),M=th(T),_=x.geometry,S=_.attributes.position.count,k=new Float32Array(S*3),L=new Float32Array(S);for(let E=0;E<S;E++)k[E*3]=M[0],k[E*3+1]=M[1],k[E*3+2]=M[2],L[E]=b;_.setAttribute("vcol",new H(k,3)),_.setAttribute("vmat",new H(L,1)),!_.attributes.nrm&&_.attributes.normal&&_.setAttribute("nrm",_.attributes.normal),_.attributes.nrm||(_.computeVertexNormals(),_.setAttribute("nrm",_.attributes.normal)),x.material=c,x.castShadow=!1,x.receiveShadow=!1});const l=new Ds().setFromObject(o),h=new Z;l.getSize(h);const u=Math.max(h.x,h.z),d=u>.001?n.length/u:1;o.scale.setScalar(d),o.updateMatrixWorld(!0);const f=new Ds().setFromObject(o);o.position.y-=f.min.y;const p=new Je;p.name=`car:${a}`,p.add(o);const m=new Map,v=[];o.traverse(x=>{x.isMesh&&/wheel/i.test(x.name||"")&&v.push(x)});for(const x of v){const y=(x.name||"").toLowerCase(),T=y.includes("frontleft")?"fl":y.includes("frontright")?"fr":y.includes("rearleft")?"rl":y.includes("rearright")?"rr":y.includes("front")?"f":"r";m.has(T)||m.set(T,[]),m.get(T).push(x)}const g={steer:[],spin:[],all:[]};for(const[x,y]of m){const T=new Ds;for(const L of y)L.updateMatrixWorld(!0),T.expandByObject(L);const b=new Z;T.getCenter(b);const M=y[0].parent,_=M.worldToLocal(b.clone()),S=new Je;S.name=`wheel:${x}:steer`,S.position.copy(_),M.add(S);const k=new Je;k.name=`wheel:${x}:spin`,S.add(k);for(const L of y){const E=L.position.clone().sub(_);k.add(L),L.position.copy(E)}g.all.push(k),g.spin.push(k),(x==="fl"||x==="fr"||x==="f")&&g.steer.push(S)}return{group:p,wheels:g.all,steerNodes:g.steer,source:a,label:n.label,tier:n.tier,setSteer(x){for(const y of g.steer)y.rotation.y=-x},setWheelSpin(x){const y=x%(Math.PI*2);for(const T of g.spin)T.rotation.x=y},setBrakeGlow(){},setLights(){},setBodyRoll(x,y){p.rotation.z=x,p.rotation.x=y},dispose(){o.traverse(x=>{x.isMesh&&x.geometry.dispose()}),c.dispose()}}}const oh=120,Rs=1/oh,Ho=5,Wo={gt:{name:"Grand Tourer",mass:1520,izz:2600,wheelbase:2.72,track:1.6,cgHeight:.45,weightRear:.5,power:165,peakTorque:235,redline:6800,cdA:1.9,rollPerG:3.4,topSpeed:135,zeroTo100:9.5,ratios:[4.1,2.62,1.9,1.47,1.15,.98],finalDrive:4.1,wheelRadius:.34,drive:"rwd"},sports:{name:"Sports",mass:1450,izz:2300,wheelbase:2.65,track:1.62,cgHeight:.42,weightRear:.53,power:300,peakTorque:370,redline:7200,cdA:1.62,rollPerG:2.5,topSpeed:165,zeroTo100:7,ratios:[3.9,2.5,1.81,1.4,1.1,.93],finalDrive:3.95,wheelRadius:.34,drive:"rwd"},hyper:{name:"Hyper",mass:1400,izz:2150,wheelbase:2.7,track:1.68,cgHeight:.38,weightRear:.56,power:380,peakTorque:405,redline:8200,cdA:1.48,rollPerG:1.7,topSpeed:190,zeroTo100:5.6,ratios:[3.7,2.38,1.77,1.4,1.12,.94],finalDrive:3.9,wheelRadius:.35,drive:"awd"}},te={peakSlipFront:8*Math.PI/180,peakSlipRear:9*Math.PI/180,tailFloor:.55,muLatFront:1.3,muLatRear:1.34,muLongPeak:1.42,peakSlipRatio:.12,awdCap:1.36,speedFadeAt:110,speedFade:.1,downforce:.22,ellipseExp:1.85,liftoffDrop:.06,liftoffHold:.25,liftoffRecover:.6,liftoffMinLatG:.4},U={maxAngle:40*Math.PI/180,minAngle:8*Math.PI/180,taperSpeed:16,taperPow:1.5,comfortG:8.4,attackG:14,minRadius:7,buildBase:2.4,buildBonus:4.2,buildFalloff:18,returnRate:8.5,padRateLimit:900*Math.PI/180,padDeadzone:.04,padSaturation:.95,padCurve:1.5,satGain:.3,satDamping:.55,trailPeak:.9,trailPostPeak:.25,driftLow:12*Math.PI/180,driftBonus:.18,driftYawDamp:1.9,spinYawDamp:4.2,spinAngle:42*Math.PI/180},Zt={throttleUp:1/.25,throttleDown:1/.15,throttleCurve:1.4,brakeUp:1/.12,brakeDown:1/.1},De={torque:15500,splitFront:.68,splitFrontDive:.76,absHz:18,absRelease:.3,lockedLatFloor:.35,handbrakeTorque:2200,handbrakeRearMu:.55,handbrakeRecover:.35,handbrakeYawCap:130*Math.PI/180},Fe={shiftTimeAuto:.14,shiftTorqueCut:.25,downshiftHysteresis:900,upshiftAtThrottle:[[0,.38],[.2,.42],[.5,.62],[1,.97]],idleRpm:900,driveLoss:.12},ih=[[0,.42],[.12,.55],[.3,.88],[.55,1],[.8,.95],[1,.8]];function Ko(a,e){if(e<=a[0][0])return a[0][1];for(let t=1;t<a.length;t++)if(e<=a[t][0]){const[s,n]=a[t-1],[i,o]=a[t],r=(e-s)/(i-s||1);return n+(o-n)*r}return a[a.length-1][1]}const ae={rollOmega:8.4,rollZeta:.85,pitchOmega:10.5,pitchZeta:.85,divePerG:1.6*Math.PI/180,squatPerG:1*Math.PI/180,rollClamp:5.5*Math.PI/180,pitchClamp:3*Math.PI/180,rollRate:50*Math.PI/180,pitchRate:35*Math.PI/180,loadTauPitch:.12,loadTauRoll:.15},we={gravity:9.81,extraMin:.1,extraMax:1,extraDelay:.1,extraRamp:.1},xt={restLength:.36,travel:.22,stiffness:42e3,damping:4200},hn={cruise:{counterSteer:.95,stability:.35,tcs:.4,abs:.8,autoGears:!0,lockFloor:10*Math.PI/180,brakeMul:1,airborne:1},sport:{counterSteer:.7,stability:.2,tcs:.2,abs:.6,autoGears:!0,lockFloor:U.minAngle,brakeMul:1,airborne:1},off:{counterSteer:.3,stability:.05,tcs:0,abs:.3,autoGears:!0,lockFloor:U.minAngle,brakeMul:1,airborne:1},hardcore:{counterSteer:0,stability:0,tcs:0,abs:0,autoGears:!1,lockFloor:U.minAngle,brakeMul:.82,airborne:0}},ct={csKeyboard:.85,csGamepad:.45,csLag:.06,csMinSlip:4*Math.PI/180,csMinSpeed:8/3.6,csClamp:.75,stabilityYawGain:1.4},Es={cruise:{behind:6,above:1.85,lookAhead:1,lookHeight:.9,yawTau:.35,velocityBlend:0,fov:64,fovGain:0,stretch:0,rise:0,shake:0},sport:{behind:6.2,above:1.9,lookAhead:1,lookHeight:.9,yawTau:.22,velocityBlend:.62,lookIntoCorner:.18,lookIntoClamp:9*Math.PI/180,springOmega:7.7,springZeta:.85,stretch:1.8,rise:.25,fov:62,fovGain:17,fovPow:.7,fovRate:12*Math.PI/180,fovKick:5,fovKickTau:.6,lateralClamp:.12,pitchRate:20*Math.PI/180,pitchClamp:6*Math.PI/180,shake:.35*Math.PI/180,shakeHz:11,shakeFrom:145/3.6},hood:{behind:-.35,above:1.15,lookAhead:6,lookHeight:1.1,yawTau:.05,velocityBlend:0,fov:58,fovGain:0}},qo=(a,e)=>ye(Math.round(a),Math.round(e),24301)/4294967296*2-1,Jt=Math.PI*2,ah=.62,rh=1.45;function ch(a,e){return a<=1?Math.sin(Math.PI/2*Math.pow(a,ah)):e+(1-e)*Math.exp(-.125*Math.pow(a-1,rh))}function $o(a,e){const t=Math.abs(a)/e;return Math.sign(a)*ch(t,te.tailFloor)}class lh{constructor({tier:e="sports",terrain:t=null,preset:s="sport"}={}){this.setTier(e),this.terrain=t,this.assist={...hn[s]},this.presetName=s,this.x=0,this.y=0,this.z=0,this.yaw=0,this.roll=0,this.pitch=0,this.vx=0,this.vy=0,this.vz=0,this.yawRate=0,this.steer=0,this.throttle=0,this.brake=0,this.handbrake=0,this.gear=1,this.rpm=Fe.idleRpm,this.reverse=!1,this._shiftTimer=0,this._shiftHold=0,this._absPhase=0,this._liftoff=0,this._liftoffTimer=0,this._airTime=0,this._loadLong=0,this._loadLat=0,this._rollV=0,this._pitchV=0,this._csState=0,this._hbRelease=1,this._acc=0,this._prevSpeed=0,this.speed=0,this.slip=0,this.limit=0,this.wheelSpin=0,this.longAccel=0,this.latAccel=0,this.onGround=!0,this.surfaceKind="ground",this.gripScale=1,this.rough=0,this.wheels=[{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0},{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0},{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0},{x:0,y:0,z:0,compression:0,load:0,slipAngle:0,slipRatio:0,contact:!0}]}setTier(e){this.tier=e;const t=Wo[e]||Wo.sports;this.spec=t,this.mass=t.mass,this.izz=t.izz,this.wb=t.wheelbase,this.track=t.track,this.a=t.wheelbase*t.weightRear,this.b=t.wheelbase*(1-t.weightRear),this.muCapAwd=t.drive==="awd"}setPreset(e){hn[e]&&(this.presetName=e,this.assist={...hn[e]})}placeAt(e,t,s=0){this.x=e,this.z=t,this.yaw=s;const n=this.terrain?this.terrain.surface(e,t):null;this.y=(n?n.y:0)+xt.restLength,this.vx=this.vy=this.vz=0,this.yawRate=0,this.gear=1,this.rpm=Fe.idleRpm}maxSteerAngle(e=!1){const t=Math.abs(this.speed),s=U.minAngle+(U.maxAngle-U.minAngle)/(1+Math.pow(t/U.taperSpeed,U.taperPow)),n=e?U.attackG:U.comfortG,i=t>1?Math.atan(this.wb*n/(t*t)):U.maxAngle,o=1-D((t-5)/7),r=Math.atan(this.wb/U.minRadius)*o,c=Math.max(i,r);let l=Math.min(s,c);return l=Math.max(l,this.assist.lockFloor*.35,U.minAngle*.22),Math.abs(this.slip)>U.driftLow&&(l=Math.max(l,s*(1+U.driftBonus))),l}update(e,t){this._acc+=Math.min(e,Ho*Rs);let s=0;for(;this._acc>=Rs&&s<Ho;)this._step(Rs,t),this._acc-=Rs,s++;return s}_step(e,t){const s=this.assist,n=Math.pow(D(t.throttle),Zt.throttleCurve);this.throttle=Se(this.throttle,n,n>this.throttle?Zt.throttleUp:Zt.throttleDown,e);const i=D(t.brake);this.brake=Se(this.brake,i,i>this.brake?Zt.brakeUp:Zt.brakeDown,e),this.handbrake=D(t.handbrake||0);const o=Math.abs(this.speed);if(t.analogue){const V=U.padRateLimit/U.maxAngle*e,de=K(t.steer,-1,1);this.steer+=K(de-this.steer,-V,V)}else{const V=K(t.steer,-1,1);if(V===0||Math.sign(V)!==Math.sign(this.steer)){const de=U.returnRate*e;if(this.steer+=K(-this.steer,-de,de),V!==0){const Xe=(U.buildBase+U.buildBonus/(1+Math.pow(o/U.buildFalloff,2)))*e;this.steer+=K(V-this.steer,-Xe,Xe)}}else{const de=(U.buildBase+U.buildBonus/(1+Math.pow(o/U.buildFalloff,2)))*e;this.steer+=K(V-this.steer,-de,de)}}this.steer=K(this.steer,-1,1);const r=Math.cos(this.yaw),c=Math.sin(this.yaw);let l=this.vz*r+this.vx*c,h=this.vx*r-this.vz*c;this.speed=l;const u=Math.hypot(l,h);this.slip=u>.6?Math.atan2(h,Math.abs(l)+.001):0;let d=this.steer*this.maxSteerAngle(!!t.attack);const f=s.counterSteer*(t.analogue?ct.csGamepad:ct.csKeyboard)*1.18;if(f>0&&Math.abs(this.slip)>ct.csMinSlip&&u>ct.csMinSpeed){const V=K(this.slip*f,-.75*this.maxSteerAngle(),ct.csClamp*this.maxSteerAngle());this._csState=Se(this._csState,V,1/ct.csLag,e)}else this._csState=Se(this._csState,0,1/ct.csLag,e);d=K(d+this._csState,-this.maxSteerAngle()*1.35,this.maxSteerAngle()*1.35),this.steerAngle=d;const p=this.terrain?this.terrain.surface(this.x,this.z):null,m=p?p.y:0;this.surfaceKind=p?p.surfaceKind:"ground",this.gripScale=p?p.grip:1;const v=p?p.nx:0,g=p?Math.max(p.ny,.2):1,w=p?p.nz:0;this.slopeAngle=Math.acos(Math.min(1,g));const x=Math.cos(this.yaw),y=Math.sin(this.yaw),T=we.gravity*g*(v*y+w*x),b=we.gravity*g*(v*x-w*y),M=D((this.slopeAngle-.42)/.34);this.gripScale*=1-.85*M;const _=m+xt.restLength,k=this.y-_>.06;this.onGround=!k;let L=we.gravity;if(k){if(this._airTime+=e,s.airborne>0&&this._airTime>we.extraDelay){const V=D((this._airTime-we.extraDelay)/we.extraRamp);L+=we.gravity*F(we.extraMin,we.extraMax,V)*s.airborne}this.vy-=L*e}else{this._airTime=0;const V=K(_-this.y,-.22,xt.travel),de=xt.stiffness*4*V/this.mass,Xe=xt.damping*4*-this.vy/this.mass;this.vy+=(de+Xe-L)*e,this.vy>2&&(this.vy=2)}this.y+=this.vy*e,this.y<_-xt.travel&&(this.y=_-xt.travel,this.vy<0&&(this.vy=0));const E=K(this.longAccel/we.gravity,-1.2,1.2),A=K(this.latAccel/we.gravity,-1.5,1.5);this._loadLong=Se(this._loadLong,E,1/ae.loadTauPitch,e),this._loadLat=Se(this._loadLat,A,1/ae.loadTauRoll,e);const z=this.mass*we.gravity+(k?0:te.downforce*u*u),N=this.spec.cgHeight/this.wb;let W=z*(this.b/this.wb)-z*N*this._loadLong,G=z-W;W=Math.max(W,z*.08),G=Math.max(G,z*.08);const $=k?0:1,se=u>.5?Math.atan2(h+this.yawRate*this.a,Math.abs(l)+.001)-d:0,C=u>.5?Math.atan2(h-this.yawRate*this.b,Math.abs(l)+.001):0;if(this.throttle<.12&&Math.abs(this.latAccel)>te.liftoffMinLatG*we.gravity&&this._liftoffTimer<=0&&(this._liftoffTimer=te.liftoffHold+te.liftoffRecover),this._liftoffTimer>0){this._liftoffTimer-=e;const V=this._liftoffTimer>te.liftoffRecover;this._liftoff=V?te.liftoffDrop:te.liftoffDrop*D(this._liftoffTimer/te.liftoffRecover)}else this._liftoff=0;this.handbrake>.01?this._hbRelease=0:this._hbRelease=D(this._hbRelease+e/De.handbrakeRecover);const B=1-Math.pow(1-this._hbRelease,3),j=F(De.handbrakeRearMu,1,this.handbrake>.01?0:B),ie=1-te.speedFade*Math.min(u/te.speedFadeAt,1),Y=this.muCapAwd?te.awdCap:1e9,oe=Math.min(te.muLatFront,Y)*this.gripScale*ie,he=Math.min(te.muLatRear,Y)*this.gripScale*ie*(1-this._liftoff)*j;let ue=-$o(se,te.peakSlipFront)*oe*W*$,nt=-$o(C,te.peakSlipRear)*he*G*$;const X=this.spec,Oe=X.ratios[this.gear-1]*X.finalDrive,Be=l/X.wheelRadius;let $t=Math.abs(Be)*Oe*(60/Jt);if(this.rpm=K(Math.max($t,Fe.idleRpm),Fe.idleRpm,X.redline*1.02),this._shiftTimer>0&&(this._shiftTimer-=e),this._shiftHold>0&&(this._shiftHold-=e),s.autoGears&&this._shiftTimer<=0&&this._shiftHold<=0&&!this.reverse){const V=Ko(Fe.upshiftAtThrottle,this.throttle)*X.redline;if(this.throttle>.06&&this.rpm>V&&this.gear<X.ratios.length)this.gear++,this._shiftTimer=Fe.shiftTimeAuto,this._shiftHold=.5;else if(this.gear>1){const de=X.ratios[this.gear-2]*X.finalDrive,Xe=Math.abs(Be)*de*(60/Jt),xs=this.rpm<Fe.idleRpm+Fe.downshiftHysteresis*.9,Ys=this.throttle<.05&&Xe<X.redline*.7;Xe<X.redline*.92&&(xs||Ys)&&(this.gear--,this._shiftTimer=Fe.shiftTimeAuto,this._shiftHold=.5)}}const ms=this._shiftTimer>0?Fe.shiftTorqueCut:1,Et=D(this.rpm/X.redline),vs=this.rpm>=X.redline?.15:1;let I=X.peakTorque*Ko(ih,Et)*this.throttle*ms*vs*Oe/X.wheelRadius*(1-Fe.driveLoss);Math.abs(l)<.6&&this.brake>.35&&this.throttle<.05?this.reverse=!0:this.throttle>.15&&l>-.2&&(this.reverse=!1),this.reverse&&(I=-Math.max(Math.abs(I),this.brake*2600)*.5);const ot=X.drive==="awd"?z:G,vt=te.muLongPeak*this.gripScale*ot;s.tcs>0&&Math.abs(I)>vt&&(I-=Math.sign(I)*(Math.abs(I)-vt)*s.tcs);const gs=vt*1.15;Math.abs(I)>gs&&(I=Math.sign(I)*gs);const it=X.topSpeed/3.6;l>it-4.2&&(I*=D((it-l)/4.2));const gt=vt>1?K(I/vt,-3,3)*te.peakSlipRatio:0;let Ct=0;if(this.brake>.001&&u>.2){F(De.splitFront,De.splitFrontDive,D(-this._loadLong));let V=De.torque*this.brake*s.brakeMul;if(s.abs>0){const Xe=V/X.wheelRadius,xs=te.muLongPeak*this.gripScale*z;if(Xe>xs){this._absPhase+=e*De.absHz*Jt;const Ys=1-De.absRelease*(.5+.5*Math.sin(this._absPhase))*s.abs;V=Math.min(V,xs*X.wheelRadius*1.02)*Ys}}Ct=-Math.sign(l)*(V/X.wheelRadius);const de=D(1-s.abs)*D(this.brake*1.4-.5);de>0&&(ue*=F(1,De.lockedLatFloor,de))}this.handbrake>.01&&u>.2&&(Ct+=-Math.sign(l)*(De.handbrakeTorque*this.handbrake/X.wheelRadius));const ws=(I+Ct)*$,Re=te.muLongPeak*this.gripScale*z,Ye=Math.pow(Math.min(Math.abs(ws)/Math.max(Re,1),1),te.ellipseExp),Un=Math.pow(Math.max(1-Ye,.04),1/te.ellipseExp);ue*=Un,nt*=Un;const Ji=.5*1.225*X.cdA*l*Math.abs(l),jt=p?p.onRoad:1,Qi=F(.145,.014,D(jt))*this.mass*we.gravity*Math.sign(l)+F(9.5,1.4,D(jt))*l,ea=this._shiftTimer>0?0:(1-this.throttle)*95*(.3+.7*Et)*(Oe/X.wheelRadius)*Math.sign(l)*$;if($&&jt<.6){const V=1-jt,de=qo(this.x*.31,this.z*.31)*.6+qo(this.x*1.13+11.7,this.z*1.13-4.2)*.4;this.vy+=de*V*Math.min(u,24)*.055*e*60,ue*=1-.34*V,nt*=1-.28*V,this.rough=V}else this.rough=0;const ta=F(27.8,200,D(jt*1.4));$&&l>ta&&(I=Math.min(I,0));const sa=ws-Ji-Qi-ea,na=(ue*Math.cos(d)+nt)*1,Hn=sa/this.mass+this.yawRate*h+T*$,Wn=na/this.mass-this.yawRate*l+b*$;l+=Hn*e,h+=Wn*e;let Vs=ue*Math.cos(d)*this.a-nt*this.b;if(s.stability>0&&u>3){const V=l/Math.max(this.wb,.1)*Math.tan(d);Vs-=(this.yawRate-V)*this.izz*ct.stabilityYawGain*s.stability}const Kn=Math.abs(this.slip);if(Kn>U.driftLow){const V=Kn>U.spinAngle?U.spinYawDamp:U.driftYawDamp;Vs-=this.yawRate*this.izz*V}this.handbrake>.01&&(this.yawRate=K(this.yawRate,-De.handbrakeYawCap,De.handbrakeYawCap)),this.yawRate+=Vs/this.izz*e*$;const qn=(oe*W+he*G)/this.mass/Math.max(u,4)*1.35,$n=Math.abs(this.yawRate);if($&&$n>qn){const V=1-Math.exp(-7.5*e);this.yawRate-=Math.sign(this.yawRate)*($n-qn)*V}const oa=F(U.trailPeak,U.trailPostPeak,D(Math.abs(se)/te.peakSlipFront-1));this.yawRate-=this.yawRate*U.satDamping*U.satGain*oa*e,u<.25&&this.throttle<.02&&Math.abs(T)<.55&&(l*=.9,h*=.9,this.yawRate*=.85),this.yaw+=this.yawRate*e,this.yaw>Math.PI?this.yaw-=Jt:this.yaw<-Math.PI&&(this.yaw+=Jt);const jn=Math.cos(this.yaw),Vn=Math.sin(this.yaw);this.vz=l*jn-h*Vn,this.vx=l*Vn+h*jn,this.x+=this.vx*e,this.z+=this.vz*e,this.longAccel=Hn,this.latAccel=Wn,this.speed=l;const ia=K(-this._loadLat*this.spec.rollPerG,-ae.rollClamp,ae.rollClamp),aa=K(this._loadLong>0?-this._loadLong*ae.squatPerG:-this._loadLong*ae.divePerG,-ae.pitchClamp,ae.pitchClamp),ra=(ia-this.roll)*ae.rollOmega*ae.rollOmega-this._rollV*2*ae.rollZeta*ae.rollOmega;this._rollV=K(this._rollV+ra*e,-ae.rollRate,ae.rollRate),this.roll+=this._rollV*e;const ca=(aa-this.pitch)*ae.pitchOmega*ae.pitchOmega-this._pitchV*2*ae.pitchZeta*ae.pitchOmega;this._pitchV=K(this._pitchV+ca*e,-ae.pitchRate,ae.pitchRate),this.pitch+=this._pitchV*e,this.limit=D(Math.max(Math.abs(se)/te.peakSlipFront,Math.abs(C)/te.peakSlipRear,Math.abs(gt)/te.peakSlipRatio)),this.wheelSpin+=l/X.wheelRadius*e,this.wheels[0].slipAngle=se,this.wheels[1].slipAngle=se,this.wheels[2].slipAngle=C,this.wheels[3].slipAngle=C,this.wheels[0].load=this.wheels[1].load=W*.5,this.wheels[2].load=this.wheels[3].load=G*.5}get kph(){return Math.abs(this.speed)*3.6}groundTilt(){if(!this.terrain)return{pitch:0,roll:0};const e=Math.cos(this.yaw),t=Math.sin(this.yaw),s=this.track*.5,n=this.x+t*this.a,i=this.z+e*this.a,o=this.x-t*this.b,r=this.z-e*this.b,c=this.terrain.height(n,i),l=this.terrain.height(o,r),h=this.terrain.height(this.x-e*s,this.z+t*s),u=this.terrain.height(this.x+e*s,this.z-t*s);return{pitch:Math.atan2(c-l,this.wb),roll:Math.atan2(u-h,this.track)}}}const jo={steerLeft:["KeyA","ArrowLeft"],steerRight:["KeyD","ArrowRight"],throttle:["KeyW","ArrowUp"],brake:["KeyS","ArrowDown"],handbrake:["Space"],shiftUp:["KeyE","ShiftRight"],shiftDown:["KeyQ"],camera:["KeyC"],reset:["KeyR","KeyT"],reverse:["KeyB"],nextCar:["KeyV"],radio:["KeyN"],autodrive:["KeyG"],horn:["KeyH"],fine:["ShiftLeft"],attack:["ControlLeft"]};class hh{constructor(e=window){this.keys=new Set,this.pressed=new Set,this.analogue=!1,this.padIndex=null,this._lastDevice="keyboard",this._deviceSince=0,this.state={steer:0,throttle:0,brake:0,handbrake:0,analogue:!1,fine:!1,attack:!1},this._onDown=t=>{t.repeat||(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(t.code)&&t.preventDefault(),this.keys.add(t.code),this.pressed.add(t.code))},this._onUp=t=>this.keys.delete(t.code),this._onBlur=()=>this.keys.clear(),e.addEventListener("keydown",this._onDown,{passive:!1}),e.addEventListener("keyup",this._onUp),e.addEventListener("blur",this._onBlur),e.addEventListener("gamepadconnected",t=>{this.padIndex=t.gamepad.index}),e.addEventListener("gamepaddisconnected",()=>{this.padIndex=null}),this._target=e,this.touch={steer:0,throttle:0,brake:0,active:!1}}tapped(e){const t=jo[e]||[];for(const s of t)if(this.pressed.has(s))return!0;return!1}held(e){const t=jo[e]||[];for(const s of t)if(this.keys.has(s))return!0;return!1}poll(){const e=this.state;let t=(this.held("steerLeft")?1:0)-(this.held("steerRight")?1:0),s=this.held("throttle")?1:0,n=this.held("brake")?1:0,i=this.held("handbrake")?1:0,o=0,r=0,c=0,l=0,h=!1;const u=navigator.getGamepads?navigator.getGamepads():[];for(const d of u){if(!d||!d.connected)continue;h=!0;const f=-(d.axes[0]||0),p=Math.abs(f);if(p>U.padDeadzone){const m=D((p-U.padDeadzone)/(U.padSaturation-U.padDeadzone));o=Math.sign(f)*Math.pow(m,U.padCurve)}r=d.buttons[7]?d.buttons[7].value:0,c=d.buttons[6]?d.buttons[6].value:0,l=d.buttons[0]&&d.buttons[0].pressed?1:0;break}return e.steer=Math.abs(o)>Math.abs(t)?o:t,this.touch.active&&Math.abs(this.touch.steer)>Math.abs(e.steer)&&(e.steer=this.touch.steer),e.throttle=Math.max(s,r,this.touch.throttle),e.brake=Math.max(n,c,this.touch.brake),e.handbrake=Math.max(i,l),e.analogue=h&&Math.abs(o)>=Math.abs(t)&&Math.abs(o)>.001,this.touch.active&&(e.analogue=!0),e.fine=this.held("fine"),e.attack=this.held("attack"),e.fine&&(e.throttle=Math.min(e.throttle,.45),e.steer*=.6),e.attack&&(e.steer=K(e.steer*1.25,-1,1)),e}endFrame(){this.pressed.clear()}attachTouch(e){const t=()=>e.getBoundingClientRect(),s=n=>{const i=t();let o=0,r=0,c=0,l=!1;for(const h of n.touches){l=!0;const u=(h.clientX-i.left)/i.width,d=(h.clientY-i.top)/i.height;u<.5?o=K(-(u/.5-.5)*2.4,-1,1):d>.55?c=1:r=1}this.touch.active=l,this.touch.steer=l?o:0,this.touch.throttle=r,this.touch.brake=c,l&&n.preventDefault()};e.addEventListener("touchstart",s,{passive:!1}),e.addEventListener("touchmove",s,{passive:!1}),e.addEventListener("touchend",s,{passive:!1}),e.addEventListener("touchcancel",s,{passive:!1})}dispose(){this._target.removeEventListener("keydown",this._onDown),this._target.removeEventListener("keyup",this._onUp),this._target.removeEventListener("blur",this._onBlur)}}const un=["cruise","sport","hood"];class uh{constructor(e,{mode:t="cruise"}={}){this.camera=e,this.mode=t,this.yaw=0,this.px=0,this.py=0,this.pz=0,this.vxs=0,this.vys=0,this.vzs=0,this.fov=Es.cruise.fov,this.pitch=0,this._kick=0,this._shakeT=0,this._first=!0,this._lookX=0,this._lookY=0,this._lookZ=0}cycle(){return this.mode=un[(un.indexOf(this.mode)+1)%un.length],this.mode}update(e,t,s){const n=Es[this.mode]||Es.cruise,i=Math.abs(e.speed),o=D(i/(250/3.6));let r=e.yaw;if(n.velocityBlend>0&&i>3){const M=Math.atan2(e.vx,e.vz);r=e.yaw+Bs(e.yaw,M)*n.velocityBlend}if(n.lookIntoCorner){const M=K(n.lookIntoCorner*e.steer*e.maxSteerAngle()*4,-n.lookIntoClamp,n.lookIntoClamp);r+=M}this.yaw=this._first?r:br(this.yaw,r,1/n.yawTau,t);const c=n.behind+(n.stretch||0)*o,l=n.above+(n.rise||0)*o,h=Math.sin(this.yaw),u=Math.cos(this.yaw);let d=e.x-h*c,f=e.z-u*c,p=e.y+l;if(this._first)this.px=d,this.py=p,this.pz=f,this._first=!1;else if(n.springOmega){const M=n.springOmega,_=n.springZeta,S=(k,L,E)=>{const A=(E-k)*M*M-L*2*_*M,z=L+A*t;return[k+z*t,z]};[this.px,this.vxs]=S(this.px,this.vxs,d),[this.py,this.vys]=S(this.py,this.vys,p),[this.pz,this.vzs]=S(this.pz,this.vzs,f)}else this.px=Se(this.px,d,6.5,t),this.py=Se(this.py,p,6.5,t),this.pz=Se(this.pz,f,6.5,t);if(n.lateralClamp){const M=e.x-this.px,_=e.z-this.pz,S=M*u-_*h,k=n.lateralClamp*c*2;if(Math.abs(S)>k*.75){const L=(Math.abs(S)-k*.75)/(k*.25),E=D(L),A=E*E*(3-2*E),z=Math.sign(S)*(Math.abs(S)-k*.75)*A;this.px+=u*z,this.pz-=h*z}}if(s){let M=s(this.px,this.pz);for(let _=1;_<=4;_++){const S=_/5,k=this.px+(e.x-this.px)*S,L=this.pz+(e.z-this.pz)*S,E=s(k,L),A=E+1.2-(e.y+n.above-E)*0;A>M&&(M=A)}this.py<M+1.2&&(this.py=M+1.2)}const m=e.x+Math.sin(e.yaw)*n.lookAhead,v=e.z+Math.cos(e.yaw)*n.lookAhead,g=e.y+n.lookHeight;this._lookX=Se(this._lookX||m,m,14,t),this._lookY=Se(this._lookY||g,g,10,t),this._lookZ=Se(this._lookZ||v,v,14,t);let w=n.fov;n.fovGain&&(w=n.fov+n.fovGain*Math.pow(o,n.fovPow),e.longAccel>.5*9.81&&(this._kick=5),this._kick=Se(this._kick,0,1/Es.sport.fovKickTau,t),w+=this._kick);const x=12*t;this.fov+=K(w-this.fov,-x,x);let y=0,T=0;if(n.shake&&i>n.shakeFrom){this._shakeT+=t*n.shakeHz*Math.PI*2;const M=n.shake*D((i-n.shakeFrom)/30)*(.6+.8*e.limit);y=Math.sin(this._shakeT)*M,T=Math.sin(this._shakeT*1.37+1.1)*M*.6}const b=this.camera;return b.position.set(this.px,this.py,this.pz),b.up.set(Math.sin(y)*.06,1,0),b.lookAt(this._lookX+y*8,this._lookY+T*8,this._lookZ),Math.abs(b.fov-this.fov)>.01&&(b.fov=this.fov,b.updateProjectionMatrix()),o}reset(){this._first=!0,this.vxs=this.vys=this.vzs=0}}const Vo=42;class dh{constructor({cruise:e=22}={}){this.on=!1,this.cruise=e,this.lastReason="",this._lostFor=0}toggle(e){return this.on=!this.on,this._lostFor=0,this.on&&(this.cruise=Math.max(14,Math.min(Math.abs(e?.speed||0)||22,30))),this.on}off(e=""){return this.on?(this.on=!1,this.lastReason=e,!0):!1}update(e,t,s){if(!this.on)return null;if(Math.abs(t.steer)>.12||t.brake>.15||t.throttle>.5||t.handbrake>.1)return this.off("you took over"),null;const n=e.terrain;if(!n)return null;const i=n.roads.query(e.x,e.z);if(!isFinite(i.d)||i.d>i.width*2.2+14)return this._lostFor+=s,this._lostFor>4&&this.off("lost the road"),{steer:0,throttle:0,brake:.35,handbrake:0,analogue:!0,auto:!0};this._lostFor=0;let o=i.tx,r=i.tz;Math.sin(e.yaw)*o+Math.cos(e.yaw)*r<0&&(o=-o,r=-r);const c=(e.x-i.qx)*r-(e.z-i.qz)*o;let l=Math.atan2(o,r)-e.yaw;for(;l>Math.PI;)l-=Math.PI*2;for(;l<-Math.PI;)l+=Math.PI*2;const h=Math.max(Math.abs(e.speed),6),u=Math.atan2(.55*c,h),d=K((l*1.15+u)*1.6,-1,1),f=e.x+Math.sin(e.yaw)*Vo,p=e.z+Math.cos(e.yaw)*Vo,m=n.roads.query(f,p);let v=0;if(isFinite(m.d)){let T=m.tx,b=m.tz;T*o+b*r<0&&(T=-T,b=-b);let M=Math.atan2(T,b)-Math.atan2(o,r);for(;M>Math.PI;)M-=Math.PI*2;for(;M<-Math.PI;)M+=Math.PI*2;v=Math.abs(M)}const g=F(this.cruise,7,D(v/.7)),w=Math.abs(e.speed),x=w<g?D((g-w)/5):0,y=w>g+3?D((w-g-3)/7)*.55:0;return{steer:d,throttle:x,brake:y,handbrake:0,analogue:!0,auto:!0}}}const fh=.45,Cs=.55,ph=8,Qt=[{at:0,mul:1,label:null},{at:1e3,mul:1.25,label:"a kilometre without leaving the road"},{at:2500,mul:1.5,label:"two and a half"},{at:5e3,mul:2,label:"five kilometres. settling in"},{at:1e4,mul:2.75,label:"ten. the road is yours"},{at:2e4,mul:3.5,label:"twenty kilometres"},{at:4e4,mul:4.5,label:"forty. still going"},{at:8e4,mul:6,label:"eighty kilometres without a wheel off"}];function mh(a){const e=a*3.6;return e<30?0:.35+.85*Math.pow(D((e-30)/220),.72)}class vh{constructor({storageKey:e="wanderoad.streak.v1"}={}){this.storageKey=e,this.distance=0,this.score=0,this.total=0,this.best=0,this.bestScore=0,this.multiplier=1,this.onRoad=!1,this.tier=0,this._off=0,this._announced=0,this._events=[],this._lastBreakAt=0,this.load()}load(){try{const e=localStorage.getItem(this.storageKey);if(!e)return;const t=JSON.parse(e);this.total=+t.total||0,this.best=+t.best||0,this.bestScore=+t.bestScore||0}catch{}}save(){try{localStorage.setItem(this.storageKey,JSON.stringify({total:this.total,best:this.best,bestScore:this.bestScore}))}catch{}}get state(){return{distance:this.distance,km:this.distance/1e3,score:this.score,total:this.total,best:this.best,bestScore:this.bestScore,multiplier:this.multiplier,onRoad:this.onRoad,grace:this._off>0&&this._off<Cs,graceLeft:Math.max(0,Cs-this._off),tier:this.tier}}drain(){return this._events.length?this._events.shift():null}update(e,t,s){const n=Math.abs(t.speed||0),i=(s?s.onRoad:0)>=fh&&t.onGround!==!1;if(this.onRoad=i,!i){this._off+=e,t.onGround===!1&&(this._off=Math.min(this._off,Cs*.4)),this._off>=Cs&&(this.distance>250&&this._events.push({kind:"break",distance:this.distance,score:this.score}),this._commit());return}if(this._off=0,n<ph)return;const o=n*e;this.distance+=o;let r=0;for(let d=Qt.length-1;d>=0;d--)if(this.distance>=Qt[d].at){r=d;break}this.tier=r;const c=Qt[r],l=Qt[Math.min(r+1,Qt.length-1)],h=Math.max(l.at-c.at,1),u=D((this.distance-c.at)/h);this.multiplier=F(c.mul,l.mul,u*.6),r>this._announced&&(this._announced=r,c.label&&this._events.push({kind:"milestone",text:c.label,distance:this.distance})),this.score+=o*mh(n)*this.multiplier*.1}_commit(){this.distance>this.best&&(this.best=this.distance),this.score>this.bestScore&&(this.bestScore=this.score),this.total+=this.score,this.save(),this.distance=0,this.score=0,this.multiplier=1,this.tier=0,this._announced=0,this._off=0}flush(){this.distance>0?this._commit():this.save()}}function gh(a){return a<1e3?String(Math.floor(a)):a<1e5?(a/1e3).toFixed(1)+"k":Math.round(a/1e3)+"k"}function dn(a){return a<1e3?`${Math.round(a)} m`:`${(a/1e3).toFixed(a<1e4?2:1)} km`}const pt={cruiser:{label:"Cruiser",blurb:"Calm and planted. Full stick is 0.7 g, the camera never moves in a hurry. This is the cozy default.",comfortG:7,assist:"cruise",camera:"cruise",rearGrip:1.04,buildRate:1.6,tier:"gt",car:"estate"},road:{label:"Road",blurb:"The default. A fast road car: 0.96 g at full stick, sport aids, the chase camera looks into the corner.",comfortG:9.4,assist:"sport",camera:"sport",rearGrip:1,buildRate:2,tier:"sports",car:"coupe"},sharp:{label:"Sharp",blurb:"More lock, faster hands. 1.25 g at full stick and a quicker steering ramp — quick, still not twitchy.",comfortG:12.2,assist:"sport",camera:"sport",rearGrip:.98,buildRate:3.2,tier:"sports",car:"rally"},drift:{label:"Drift",blurb:"Loose rear end and a lot of lock. Made for holding a slide, not for lap times.",comfortG:13.5,assist:"off",camera:"sport",rearGrip:.86,buildRate:3.6,tier:"sports",car:"sedan"},sim:{label:"Raw",blurb:"No assists at all, no comfort limit — the full 40° rack, tapered only by speed. Hard.",comfortG:40,assist:"hardcore",camera:"sport",rearGrip:1,buildRate:4,tier:"sports",car:"coupe"},hyper:{label:"Hyper",blurb:"All-wheel drive, 800 hp, 340 km/h. Planted at speed, and quick enough to need the calm camera.",comfortG:10.5,assist:"sport",camera:"sport",rearGrip:1.02,buildRate:2.2,tier:"hyper",car:"patrol"}},At={meadow:{label:"Meadow",blurb:"The pen’s own valley. Soft rolling hills, wide sightlines, nothing you cannot drive over.",amp:.8,wave:1.25,bias:[2.2,1,.35,.3,.8]},rolling:{label:"Rolling",blurb:"The default mix. Meadow and steppe with hills and the occasional mountain on the horizon.",amp:1,wave:1,bias:[1,1,1,1,1]},alpine:{label:"Alpine",blurb:"Mountains close in. Switchbacks, cuttings and long climbs — the most dramatic and the least forgiving.",amp:1.35,wave:.9,bias:[.6,.5,3,.2,.5]},plains:{label:"Plains",blurb:"Almost flat. Kilometres of straight road under a huge sky — the best place to feel top speed.",amp:.45,wave:1.6,bias:[.8,3,.15,1.2,.7]},dunes:{label:"Dunes",blurb:"Rose and ochre sand sea. Loose grip, long crests, the road half-buried.",amp:.9,wave:1.1,bias:[.3,.9,.2,3.5,.2]},marsh:{label:"Wetland",blurb:"Flooded reed flats under standing mist. Dead flat, causeways and mirrors.",amp:.7,wave:1.2,bias:[.7,.3,.2,.1,3.5]}};function Vi(a){const e=pt[a]||pt.road;return U.comfortG=e.comfortG,U.attackG=e.comfortG*1.6,U.buildBase=e.buildRate,U.buildBonus=e.buildRate,te.muLatRear=1.34*e.rearGrip,e}function wh(a){const e=At[a]||At.rolling;qe.__base||(qe.__base=qe.map(s=>({...s})));const t=qe.__base;for(let s=0;s<qe.length;s++)qe[s].amp=t[s].amp*e.amp*(e.bias[s]>1,1),qe[s].wave=t[s].wave*e.wave;return e}function xh(a){return(At[a]||At.rolling).bias}function bh(a=location.search){const e=new URLSearchParams(a),t=pt[e.get("feel")]?e.get("feel"):"road",s=At[e.get("terrain")]?e.get("terrain"):"rolling";return{feel:t,terrain:s,debug:e.has("debug"),offline:e.has("offline")}}const yh=.02,_h=4;class Mh{constructor({cell:e=64}={}){this.cell=e,this.grid=new Map,this.byChunk=new Map,this.lastHit=null}_key(e,t){return`${Math.floor(e/this.cell)},${Math.floor(t/this.cell)}`}addChunk(e,t){if(this.byChunk.has(e)&&this.removeChunk(e),!(!t||!t.length)){this.byChunk.set(e,t);for(const s of t){const n=this._key(s.x,s.z);let i=this.grid.get(n);i||(i=[],this.grid.set(n,i)),i.push(s)}}}removeChunk(e){const t=this.byChunk.get(e);if(t){for(const s of t){const n=this._key(s.x,s.z),i=this.grid.get(n);if(!i)continue;const o=i.indexOf(s);o>=0&&i.splice(o,1),i.length||this.grid.delete(n)}this.byChunk.delete(e)}}clear(){this.grid.clear(),this.byChunk.clear()}get count(){let e=0;for(const t of this.byChunk.values())e+=t.length;return e}resolve(e,t=1.05,s=1/60){const n=Math.floor(e.x/this.cell),i=Math.floor(e.z/this.cell);let o=null;for(let r=-1;r<=1;r++)for(let c=-1;c<=1;c++){const l=this.grid.get(`${n+c},${i+r}`);if(l)for(const h of l){const u=e.x-h.x,d=e.z-h.z,f=h.r+t,p=u*u+d*d;if(p>=f*f||h.h&&e.y-.4>h.y+h.h)continue;const m=Math.sqrt(p)||1e-4,v=f-m;if(v<yh)continue;const g=u/m,w=d/m;e.x+=g*v,e.z+=w*v;const x=e.vx*g+e.vz*w;if(x<0){const y=Math.hypot(e.vx,e.vz),T=e.vx-x*g,b=e.vz-x*w,M=D(-x/Math.max(y,.001)),_=h.kind==="rock"?.18:.06,S=1-.55*M;e.vx=T*S-x*g*_,e.vz=b*S-x*w*_,e.yawRate*=1-.6*M,y>_h&&(!o||M*y>o.severity*o.speed)&&(o={kind:h.kind,speed:y,severity:M,x:h.x,z:h.z})}}}return this.lastHit=o,o}}function Th(a,e){const t=[];if(!a)return t;const s=(n,i,o,r)=>{if(n)for(const c of n)t.push({x:c.x,z:c.z,y:c.y!==void 0?c.y:0,r:o(c),h:r(c),kind:i})};return s(a.trees,"tree",n=>.28+.22*(n.scale||1),n=>6*(n.scale||1)),s(a.rocks,"rock",n=>.7*(n.scale||1),n=>1.6*(n.scale||1)),s(a.posts,"post",()=>.16,()=>1.6),t}class Sh{constructor(){this.root=document.getElementById("hud"),this.kph=document.getElementById("kph"),this.gear=document.getElementById("gear"),this.biome=document.getElementById("biome"),this.coords=document.getElementById("coords"),this.players=document.getElementById("players"),this.toast=document.getElementById("toast"),this.streakEl=document.createElement("div"),this.streakEl.id="streak",this.streakEl.innerHTML='<span id="streakKm">—</span><span id="streakMul"></span><span id="streakPts"></span>',this.root.appendChild(this.streakEl),this.streakKm=this.streakEl.querySelector("#streakKm"),this.streakMul=this.streakEl.querySelector("#streakMul"),this.streakPts=this.streakEl.querySelector("#streakPts"),this._toastT=0,this._lastGear=null,this._lastBiome=-1,this._shownKm=0}say(e,t=3.6){this.toast.textContent=e,this.toast.classList.add("show"),this._toastT=t}update(e,{car:t,streak:s,surface:n,remotes:i,netState:o}){const r=Math.round(t.kph);this.kph.textContent=r;const c=t.reverse?"R":Math.abs(t.speed)<.6?"N":String(t.gear);c!==this._lastGear&&(this.gear.textContent=c,this._lastGear=c),n&&n.dominant!==this._lastBiome&&(this._lastBiome=n.dominant,this.biome.textContent=_n[n.dominant],this.say(_n[n.dominant],2.8)),this.coords.textContent=`${Math.round(t.x)}, ${Math.round(t.z)}`;const l=s.state;l.distance>0?(this.streakEl.classList.add("live"),this.streakEl.classList.toggle("grace",l.grace),this._shownKm+=(l.km-this._shownKm)*Math.min(1,e*9),this.streakKm.textContent=dn(this._shownKm*1e3),this.streakMul.textContent=l.multiplier>1.02?`×${l.multiplier.toFixed(2)}`:"",this.streakPts.textContent=l.score>5?gh(l.score):""):(this.streakEl.classList.remove("live","grace"),this._shownKm=0,this.streakKm.textContent=l.best>0?`best ${dn(l.best)}`:"",this.streakMul.textContent="",this.streakPts.textContent="");const h=s.drain();if(h&&(h.kind==="milestone"?this.say(h.text,3.2):h.kind==="break"&&this.say(`${dn(h.distance)} — streak ended`,3)),i){const u=i.list?i.list():[];u.length?this.players.innerHTML=u.slice(0,6).map(d=>`<div>${Ah(d.name)} <span class="dist">${Math.round(d.dist)} m</span></div>`).join(""):this.players.childNodes.length&&(this.players.innerHTML="")}o&&o!==this._lastNet&&(this._lastNet=o,this.root.dataset.net=o),this._toastT>0&&(this._toastT-=e,this._toastT<=0&&this.toast.classList.remove("show"))}}function Ah(a){return String(a).replace(/[&<>"']/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[e])}const kh=["Escape","KeyM"];class Rh{constructor(e){this.hooks=e,this.open=!1,this.current={car:"coupe",feel:"road",terrain:"rolling"};const t=this.root=document.createElement("div");t.id="menu",t.hidden=!0,t.innerHTML=`
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
      </div>`,document.body.appendChild(t),this._fill("car",Is.map(s=>[s,St[s].label])),this._fill("feel",Object.keys(pt).map(s=>[s,pt[s].label])),this._fill("terrain",Object.keys(At).map(s=>[s,At[s].label])),t.addEventListener("click",s=>this._onClick(s)),addEventListener("keydown",s=>{kh.includes(s.code)&&(s.preventDefault(),this.toggle())})}_fill(e,t){const s=this.root.querySelector(`[data-group="${e}"]`);s.innerHTML=t.map(([n,i])=>`<button data-group="${e}" data-key="${n}">${i}</button>`).join("")}_mark(){for(const s of this.root.querySelectorAll("button[data-key]"))s.classList.toggle("on",this.current[s.dataset.group]===s.dataset.key);const e=this.root.querySelector('[data-act="camera"]');e&&this.hooks.camera&&(e.textContent=`Camera: ${this.hooks.camera()}`);const t=this.root.querySelector('[data-act="auto"]');if(t&&this.hooks.isAuto){const s=this.hooks.isAuto();t.textContent=s?"Auto-drive: on (G)":"Auto-drive (G)",t.classList.toggle("on",s)}}async _onClick(e){const t=e.target.closest("button");if(!t)return;const{group:s,key:n,act:i}=t.dataset;if(i==="close")return this.hide();if(i==="reset")return this.hooks.onReset?.(),this.hide();if(i==="camera")return this.hooks.cycleCam?.(),this._mark();if(i==="auto")return this.hooks.onAuto?.(),this._mark(),this.hide();if(s==="car")this.current.car=n,this._mark(),t.disabled=!0,await this.hooks.onCar?.(n),t.disabled=!1,this.hide();else if(s==="feel")this.current.feel=n,this._mark(),this.hooks.onFeel?.(n),this.hide();else if(s==="terrain"){const o=new URLSearchParams(location.search);o.set("terrain",n),o.set("feel",this.current.feel),o.set("car",this.current.car),location.search=o.toString()}}setCurrent(e){Object.assign(this.current,e),this._mark()}show(){this.open=!0,this.root.hidden=!1,this._mark()}hide(){this.open=!1,this.root.hidden=!0}toggle(){this.open?this.hide():this.show()}}const Eh="modulepreload",Ch=function(a,e){return new URL(a,e).href},Yo={},zh=function(e,t,s){let n=Promise.resolve();if(t&&t.length>0){let o=function(h){return Promise.all(h.map(u=>Promise.resolve(u).then(d=>({status:"fulfilled",value:d}),d=>({status:"rejected",reason:d}))))};const r=document.getElementsByTagName("link"),c=document.querySelector("meta[property=csp-nonce]"),l=c?.nonce||c?.getAttribute("nonce");n=o(t.map(h=>{if(h=Ch(h,s),h in Yo)return;Yo[h]=!0;const u=h.endsWith(".css"),d=u?'[rel="stylesheet"]':"";if(!!s)for(let m=r.length-1;m>=0;m--){const v=r[m];if(v.href===h&&(!u||v.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${h}"]${d}`))return;const p=document.createElement("link");if(p.rel=u?"stylesheet":Eh,u||(p.as="script"),p.crossOrigin="",p.href=h,l&&p.setAttribute("nonce",l),document.head.appendChild(p),u)return new Promise((m,v)=>{p.addEventListener("load",m),p.addEventListener("error",()=>v(new Error(`Unable to preload CSS for ${h}`)))})}))}function i(o){const r=new Event("vite:preloadError",{cancelable:!0});if(r.payload=o,window.dispatchEvent(r),!r.defaultPrevented)throw o}return n.then(o=>{for(const r of o||[])r.status==="rejected"&&i(r.reason);return e().catch(i)})},Lh=new Uint32Array([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),He=(a,e)=>(a>>>e|a<<32-e)>>>0;function Dh(a){if(typeof TextEncoder<"u")return new TextEncoder().encode(a);const e=[];for(let t=0;t<a.length;t++){const s=a.charCodeAt(t);s<128?e.push(s):s<2048?e.push(192|s>>6,128|s&63):e.push(224|s>>12,128|s>>6&63,128|s&63)}return new Uint8Array(e)}function Yi(a){const e=typeof a=="string"?Dh(a):a,t=e.length,s=new Uint8Array((t+8>>6)+1<<6);s.set(e),s[t]=128;const n=new DataView(s.buffer);n.setUint32(s.length-8,Math.floor(t/536870912)),n.setUint32(s.length-4,t<<3>>>0);const i=new Uint32Array([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]),o=new Uint32Array(64);for(let c=0;c<s.length;c+=64){for(let g=0;g<16;g++)o[g]=n.getUint32(c+g*4);for(let g=16;g<64;g++){const w=o[g-15],x=o[g-2],y=(He(w,7)^He(w,18)^w>>>3)>>>0,T=(He(x,17)^He(x,19)^x>>>10)>>>0;o[g]=o[g-16]+y+o[g-7]+T>>>0}let l=i[0],h=i[1],u=i[2],d=i[3],f=i[4],p=i[5],m=i[6],v=i[7];for(let g=0;g<64;g++){const w=(He(f,6)^He(f,11)^He(f,25))>>>0,x=(f&p^~f&m)>>>0,y=v+w+x+Lh[g]+o[g]>>>0,T=(He(l,2)^He(l,13)^He(l,22))>>>0,b=(l&h^l&u^h&u)>>>0,M=T+b>>>0;v=m,m=p,p=f,f=d+y>>>0,d=u,u=h,h=l,l=y+M>>>0}i[0]=i[0]+l>>>0,i[1]=i[1]+h>>>0,i[2]=i[2]+u>>>0,i[3]=i[3]+d>>>0,i[4]=i[4]+f>>>0,i[5]=i[5]+p>>>0,i[6]=i[6]+m>>>0,i[7]=i[7]+v>>>0}let r="";for(let c=0;c<8;c++)r+=i[c].toString(16).padStart(8,"0");return r}const Xo="wanderoad.secret",Fh="wanderoad.name",Ih="wanderoad.look",En=new Map;function Bn(a){try{const e=globalThis.localStorage?.getItem(a);if(e!=null)return e}catch{}return En.has(a)?En.get(a):null}function Ph(a,e){En.set(a,e);try{globalThis.localStorage?.setItem(a,e)}catch{}}function Nh(){const a=new Uint8Array(32),e=globalThis.crypto;if(e&&typeof e.getRandomValues=="function")e.getRandomValues(a);else{const s=`${Date.now()}:${globalThis.performance?.now?.()??0}:${Math.random()}:${Math.random()}`,n=Yi(s);for(let i=0;i<32;i++)a[i]=parseInt(n.slice(i*2,i*2+2),16)}let t="";for(let s=0;s<32;s++)t+=a[s].toString(16).padStart(2,"0");return t}const Zo=["Amber","Cobalt","Dusty","Quiet","Distant","Salt","Paper","Copper","Slow","Wandering","Kite","Rain","Pale","Ember","Hollow","Lantern"],Jo=["Fox","Heron","Kestrel","Pilot","Drifter","Sparrow","Comet","Wren","Otter","Moth","Rider","Finch","Marten","Hare","Swift","Crane"];function Oh(a){const e=parseInt(a.slice(0,3),16)%Zo.length,t=parseInt(a.slice(3,6),16)%Jo.length,s=parseInt(a.slice(6,9),16)%100;return`${Zo[e]} ${Jo[t]} ${s}`}function Bh(a){let e="";for(const t of String(a??"")){const s=t.codePointAt(0);s<32||s>=127&&s<=159||s>=8203&&s<=8207||s>=8232&&s<=8238||s>=8294&&s<=8297||(e+=t)}return e.replace(/\s+/g," ").trim().slice(0,18)||"Wanderer"}let fn=null,zs=null;function Gn(){if(fn)return fn;let a=Bn(Xo);return(typeof a!="string"||!/^[0-9a-f]{64}$/.test(a))&&(a=Nh(),Ph(Xo,a)),fn=a,a}function js(){return zs||(zs=Yi(Gn()).slice(0,12),zs)}function Xi(){const a=Bn(Fh);return a?Bh(a):Oh(js())}function Gh(){const a=Bn(Ih);if(a)try{const e=JSON.parse(a);return{tier:e.tier|0,paint:e.paint|0}}catch{}return{tier:0,paint:parseInt(js().slice(9,12),16)%8}}function Uh(){const a=Gh();return{secret:Gn(),playerId:js(),name:Xi(),tier:a.tier,paint:a.paint}}const Qo=8192,Zi=6e3,Hh=5;function Wh({backend:a="auto",base44AppId:e=null,phpBase:t="./api/"}={}){const s=t.endsWith("/")?t:`${t}/`,n={base44:e?qh(e):null,php:Kh(s),local:$h()},i=a==="auto"?["base44","php","local"].filter(p=>n[p]):[a,"local"].filter((p,m,v)=>n[p]&&v.indexOf(p)===m),o={pinned:null,fails:0,lastMs:0,sent:0,errors:0,lastError:null};let r=null;const c=new Promise(p=>{r=p});function l(p){o.pinned=p,o.fails=0,r(p)}function h(p){const m=JSON.stringify({v:1,secret:Gn(),name:Xi(),t:Date.now(),...p});if(m.length>Qo)throw new Error(`[net] payload ${m.length} B exceeds the ${Qo} B cap`);return m}async function u(p,m){const v=Date.now(),g=await n[p].send(m);if(o.lastMs=Date.now()-v,!g||typeof g!="object")throw new Error(`[net] ${p} returned a non-object`);return g}async function d(p){const m=h(p);if(o.pinned)try{const g=await u(o.pinned,m);return o.fails=0,o.sent++,g}catch(g){if(o.fails++,o.errors++,o.lastError=String(g&&g.message?g.message:g),o.fails<Hh)throw g;console.error(`[net] ${o.pinned} failed ${o.fails}x, re-probing`,o.lastError),o.pinned=null,o.fails=0}let v=null;for(const g of i)try{const w=await u(g,m);return l(g),o.sent++,w}catch(w){v=w,o.lastError=String(w&&w.message?w.message:w),g!=="local"&&console.info(`[net] ${g} not available here, trying the next backend`)}throw o.errors++,v??new Error("[net] no transport available")}function f(){return c}return{send:d,ready:f,get backend(){return o.pinned??(i[0]||"local")},info(){return{backend:o.pinned??"unresolved",chain:i.slice(),phpBase:s,appId:e,lastMs:o.lastMs,sent:o.sent,errors:o.errors,lastError:o.lastError}},close(){for(const p of Object.keys(n))n[p]?.close?.()}}}function Kh(a){const e=`${a}drive.php`;return{async send(t){const s=new AbortController,n=setTimeout(()=>s.abort(),Zi);try{const i=await fetch(e,{method:"POST",headers:{"Content-Type":"application/json"},body:t,signal:s.signal,credentials:"omit",cache:"no-store"});if(!i.ok){const o=new Error(`HTTP ${i.status}`);throw o.status=i.status,o}return await i.json()}finally{clearTimeout(n)}}}}function qh(a){let e=null;function t(){return e||(e=zh(()=>import("./index-C5QPFtM6.js"),[],import.meta.url).then(s=>s.createClient({appId:a}))),e}return{async send(s){const n=await t(),i=new AbortController,o=setTimeout(()=>i.abort(),Zi);try{const r=await n.functions.fetch("/drive",{method:"POST",headers:{"Content-Type":"application/json"},body:s,signal:i.signal});if(!r.ok){const c=new Error(`HTTP ${r.status}`);throw c.status=r.status,c}return await r.json()}finally{clearTimeout(o)}},close(){e?.then(s=>s.cleanup?.()).catch(()=>{}),e=null}}}function $h(){const a=new Map;return{async send(e){const t=JSON.parse(e),s=Date.now(),n=js(),i={now:s,you:{playerId:n},peers:[],rate:.25};if(t.op==="save"&&Array.isArray(t.ops)){const o=a.get(n)??{seed:null,visited:[],ops:[]};for(const r of t.ops)jh(o,r);a.set(n,o)}else t.op==="load"&&(i.save=a.get(n)??null);return i}}}function jh(a,e){if(!(!e||typeof e!="object"))if(e.k==="seed")a.seed=e.v|0;else if(e.k==="visited"){const t=a.visited.findIndex(s=>s.b===e.b);t<0?a.visited.push({b:e.b,d:e.d}):a.visited[t]={b:e.b,d:Vh(a.visited[t].d,e.d)}}else a.ops.push(e),a.ops.length>4e3&&a.ops.splice(0,a.ops.length-4e3)}function Vh(a,e){const t=atob(a),s=atob(e),n=Math.max(t.length,s.length);let i="";for(let o=0;o<n;o++)i+=String.fromCharCode((t.charCodeAt(o)||0)|(s.charCodeAt(o)||0));return btoa(i)}const ei=250,Yh=1.2,Xh=12,Zh=11e3,Jh=24;class Qh{constructor({scene:e,buildGhostCar:t}){if(typeof t!="function")throw new Error("[remotes] buildGhostCar is required");this.scene=e,this.buildGhostCar=t,this.group=new mt,this.group.name="ghosts",this.group.frustumCulled=!1,e?.add(this.group),this.peers=new Map,this._offset=null}get count(){return this.peers.size}ingest(e,t){if(Number.isFinite(t)){const n=t-Date.now();this._offset===null||Math.abs(n-this._offset)>1500?this._offset=n:this._offset+=(n-this._offset)*.15}if(!Array.isArray(e))return;const s=Number.isFinite(t)?t:Date.now()+(this._offset??0);for(const n of e){if(!n||typeof n.id!="string")continue;let i=this.peers.get(n.id);if(!i&&(i=this._spawn(n),!i))continue;i.lastSeen=s,i.name=typeof n.name=="string"?n.name:i.name;const o=Number.isFinite(n.t)?n.t:s,r=i.buf;if(r.length&&o<=r[r.length-1].t)continue;i.placed&&(i.jumpT=Date.now()+(this._offset??0)-ei,i.preJump=pn(i.buf,i.jumpT));const c=r.length?r[r.length-1]:null,l=We(n.yaw),h=c?c.yaw+Bs(c.yaw,l):l,u=We(n.y),d=c?K((u-c.y)/((o-c.t)/1e3),-12,12):0;r.push({t:o,x:We(n.x),y:u,z:We(n.z),yaw:h,vx:We(n.vx),vy:d,vz:We(n.vz),yawRate:We(n.yawRate),steer:We(n.steer),throttle:We(n.throttle),brake:We(n.brake),flags:n.flags|0}),r.length>Jh&&r.shift(),i.corrected=!0,n.tier!==void 0&&(i.tier=n.tier|0),n.paint!==void 0&&(i.paint=n.paint|0)}}update(e,t=Date.now()){const s=t+(this._offset??0),n=s-ei;for(const[i,o]of this.peers){if(s-o.lastSeen>Zh){this._despawn(i,o);continue}const r=pn(o.buf,n);if(!r)continue;const c=o.obj;if(!o.placed)o.placed=!0,c.visible=!0,o.ex=o.ey=o.ez=o.eyaw=0;else if(o.corrected&&o.preJump){const h=pn(o.buf,o.jumpT);h&&(o.ex=o.preJump.x+o.ex-h.x,o.ey=o.preJump.y+o.ey-h.y,o.ez=o.preJump.z+o.ez-h.z,o.eyaw=Bs(h.yaw,o.preJump.yaw+o.eyaw)),Math.hypot(o.ex,o.ey,o.ez)>Xh&&(o.ex=o.ey=o.ez=o.eyaw=0),o.preJump=null}o.corrected=!1;const l=Math.exp(-9*e);o.ex*=l,o.ey*=l,o.ez*=l,o.eyaw*=l,c.position.set(r.x+o.ex,r.y+o.ey,r.z+o.ez),c.rotation.y=r.yaw+o.eyaw,o.pose=r,o.api?.update?.(r,e)}}list(){const e=ee.uCamPos.value,t=[];for(const[s,n]of this.peers){const i=n.pose,o=i?Math.hypot(i.x-e.x,i.y-e.y,i.z-e.z):1/0;t.push({id:s,name:n.name,dist:o})}return t.sort((s,n)=>s.dist-n.dist),t}nearestDistance(){const e=ee.uCamPos.value;let t=1/0;for(const s of this.peers.values()){const n=s.pose;if(!n)continue;const i=Math.hypot(n.x-e.x,n.y-e.y,n.z-e.z);i<t&&(t=i)}return t}dispose(){for(const[e,t]of this.peers)this._despawn(e,t);this.peers.clear(),this.group.parent?.remove(this.group)}_spawn(e){let t;try{t=this.buildGhostCar({id:e.id,name:typeof e.name=="string"?e.name:"",tier:e.tier|0,paint:e.paint|0})}catch(i){return console.error("[remotes] buildGhostCar threw for",e.id,i),null}const s=t?.isObject3D?t:t?.root??t?.group??t?.object;if(!s?.isObject3D)return console.error("[remotes] buildGhostCar returned no Object3D for",e.id),null;s.visible=!1,s.matrixAutoUpdate=!0,this.group.add(s);const n={id:e.id,name:typeof e.name=="string"?e.name:"",tier:e.tier|0,paint:e.paint|0,obj:s,api:t?.isObject3D?null:t,buf:[],pose:null,placed:!1,corrected:!1,preJump:null,jumpT:0,ex:0,ey:0,ez:0,eyaw:0,lastSeen:0};return this.peers.set(e.id,n),n}_despawn(e,t){this.group.remove(t.obj),t.api?.dispose?t.api.dispose():e0(t.obj),this.peers.delete(e)}}function We(a){return Number.isFinite(a)?a:0}function pn(a,e){const t=a.length;if(t===0)return null;if(t===1||e<=a[0].t)return ti(a[0],(e-a[0].t)/1e3);const s=a[t-1];if(e>=s.t)return ti(s,(e-s.t)/1e3);let n=t-2;for(;n>0&&a[n].t>e;)n--;const i=a[n],o=a[n+1],r=o.t-i.t,c=K((e-i.t)/r,0,1),l=r/1e3,h=n>0?a[n-1]:null,u=n+2<t?a[n+2]:null,d=o.y-i.y,f=h?.5*(o.y-h.y)*(r/(o.t-h.t)):d,p=u?.5*(u.y-i.y)*(r/(u.t-i.t)):d;return{x:ys(i.x,i.vx*l,o.x,o.vx*l,c),y:ys(i.y,f,o.y,p,c),z:ys(i.z,i.vz*l,o.z,o.vz*l,c),yaw:ys(i.yaw,i.yawRate*l,o.yaw,o.yawRate*l,c),steer:i.steer+(o.steer-i.steer)*c,throttle:i.throttle+(o.throttle-i.throttle)*c,brake:i.brake+(o.brake-i.brake)*c,vx:i.vx+(o.vx-i.vx)*c,vz:i.vz+(o.vz-i.vz)*c,flags:c<.5?i.flags:o.flags}}function ti(a,e){const t=K(e,0,Yh);return{x:a.x+a.vx*t,y:a.y+a.vy*t,z:a.z+a.vz*t,yaw:a.yaw+a.yawRate*t,steer:a.steer,throttle:a.throttle,brake:a.brake,vx:a.vx,vz:a.vz,flags:a.flags}}function e0(a){a.traverse(e=>{e.geometry?.dispose?.();const t=e.material;Array.isArray(t)?t.forEach(s=>s.dispose?.()):t?.dispose?.()})}const Ls=4096,re=16,si=re*re/8,t0=2e4,ni=5800,oi=4e3,s0="wanderoad",Dt="save";class n0{constructor({seed:e,transport:t}){this.seed=e>>>0,this.transport=t,this.visited=new Map,this.dirtyBlocks=new Set,this.pending=[],this.ops=[],this._seq=0,this._timer=null,this._inflight=null,this._db=null,this._stats={uploads:0,uploadErrors:0,lastUpload:0,lastLocal:0},this.pending.push({k:"seed",v:this.seed})}markVisited(e,t){const s=Math.floor(e/Ls),n=Math.floor(t/Ls),i=Math.floor(s/re),o=Math.floor(n/re),r=`${i},${o}`;let c=this.visited.get(r);c||(c=new Uint8Array(si),this.visited.set(r,c));const l=(s%re+re)%re,u=(n%re+re)%re*re+l,d=1<<(u&7),f=u>>3;return c[f]&d?!1:(c[f]|=d,this.dirtyBlocks.add(r),this._touch(),!0)}isVisited(e,t){const s=Math.floor(e/Ls),n=Math.floor(t/Ls),i=this.visited.get(`${Math.floor(s/re)},${Math.floor(n/re)}`);if(!i)return!1;const o=(s%re+re)%re,c=(n%re+re)%re*re+o;return(i[c>>3]&1<<(c&7))!==0}note(e){if(!e||typeof e!="object")throw new Error("[save] note() needs an object");const t={...e,n:++this._seq,t:Date.now()};return this.ops.push(t),this.pending.push(t),this.ops.length>oi&&this.ops.splice(0,this.ops.length-oi),this._touch(),t}_touch(){this._writeLocal(),this._timer===null&&typeof setTimeout=="function"&&(this._timer=setTimeout(()=>{this._timer=null,this.flush().catch(()=>{})},t0))}flush(){return this._inflight?this._inflight:(this._inflight=this._flushOnce().finally(()=>{this._inflight=null}),this._inflight)}async _flushOnce(){if(!this.transport)return{sent:0,more:!1};let e=0;for(let t=0;t<6;t++){const s=this._takeBatch();if(s.ops.length===0)break;try{await this.transport.send({op:"save",seed:this.seed,ops:s.ops})}catch(n){throw this._stats.uploadErrors++,console.error("[save] upload failed, keeping the local copy",n?.message??n),n}this._stats.uploads++,this._stats.lastUpload=Date.now();for(const n of s.blocks)this.dirtyBlocks.delete(n);this.pending.splice(0,s.opCount),e+=s.ops.length}return{sent:e,more:this.pending.length+this.dirtyBlocks.size>0}}_takeBatch(){const e=[],t=[];let s=0;for(const i of this.dirtyBlocks){const o={k:"visited",b:i,d:ii(this.visited.get(i))},r=JSON.stringify(o).length+1;if(s+r>ni)break;e.push(o),t.push(i),s+=r}let n=0;for(const i of this.pending){const o=JSON.stringify(i).length+1;if(s+o>ni)break;e.push(i),s+=o,n++}return{ops:e,blocks:t,opCount:n}}async load(){const e=await this._readLocal();if(e&&this._absorb(e),this.transport)try{const t=await this.transport.send({op:"load",seed:this.seed});t?.save&&this._absorb(t.save)}catch(t){console.error("[save] remote load failed, using the local copy",t?.message??t)}return{seed:this.seed,visited:this.visited.size,ops:this.ops.length}}_absorb(e){if(!e||typeof e!="object")return;if(Number.isFinite(e.seed)&&e.seed>>>0!==this.seed){console.error(`[save] ignoring a save for seed ${e.seed>>>0}, this world is ${this.seed}`);return}for(const s of e.visited??[]){const n=i0(s.d);if(!n)continue;const i=this.visited.get(s.b);if(!i)this.visited.set(s.b,n);else for(let o=0;o<i.length&&o<n.length;o++)i[o]|=n[o]}const t=new Set(this.ops.map(s=>s.n));for(const s of e.ops??[])!s||t.has(s.n)||(this.ops.push(s),t.add(s.n),s.n>this._seq&&(this._seq=s.n));this.ops.sort((s,n)=>(s.n??0)-(n.n??0))}stats(){let e=0;for(const t of this.visited.values())for(let s=0;s<t.length;s++)e+=o0(t[s]);return{seed:this.seed,regions:e,blocks:this.visited.size,ops:this.ops.length,pending:this.pending.length+this.dirtyBlocks.size,bytes:this.visited.size*si+JSON.stringify(this.ops).length,uploads:this._stats.uploads,uploadErrors:this._stats.uploadErrors,lastUpload:this._stats.lastUpload,lastLocal:this._stats.lastLocal}}dispose(){this._timer!==null&&(clearTimeout(this._timer),this._timer=null)}_openDb(){if(this._db)return this._db;const e=globalThis.indexedDB;return e?(this._db=new Promise(t=>{let s;try{s=e.open(s0,1)}catch{t(null);return}s.onupgradeneeded=()=>{s.result.objectStoreNames.contains(Dt)||s.result.createObjectStore(Dt)},s.onsuccess=()=>t(s.result),s.onerror=()=>t(null),s.onblocked=()=>t(null)}),this._db):(this._db=Promise.resolve(null),this._db)}async _writeLocal(){const e=await this._openDb();if(!e)return;const t=this._serialise();try{const s=e.transaction(Dt,"readwrite");s.objectStore(Dt).put(t,`seed:${this.seed}`),s.oncomplete=()=>{this._stats.lastLocal=Date.now()},s.onerror=()=>console.error("[save] IndexedDB write failed")}catch(s){console.error("[save] IndexedDB transaction failed",s?.message??s)}}async _readLocal(){const e=await this._openDb();return e?new Promise(t=>{try{const n=e.transaction(Dt,"readonly").objectStore(Dt).get(`seed:${this.seed}`);n.onsuccess=()=>t(n.result??null),n.onerror=()=>t(null)}catch{t(null)}}):null}_serialise(){const e=[];for(const[t,s]of this.visited)e.push({b:t,d:ii(s)});return{seed:this.seed,visited:e,ops:this.ops}}}function o0(a){return a=a-(a>>1&85),a=(a&51)+(a>>2&51),a+(a>>4)&15}function ii(a){let e="";for(let t=0;t<a.length;t++)e+=String.fromCharCode(a[t]);return btoa(e)}function i0(a){if(typeof a!="string")return null;let e;try{e=atob(a)}catch{return null}const t=new Uint8Array(e.length);for(let s=0;s<e.length;s++)t[s]=e.charCodeAt(s);return t}const a0={open:[0,2,4,7,9],still:[0,3,5,7,10]},ai={open:[0,3,4,2],still:[0,4,2,3]},es=[{id:"off",label:"Radio off",scale:null},{id:"valley",label:"Valley",scale:"open",root:55,chordSecs:22,bellRate:.16,drone:.5},{id:"longway",label:"The Long Way",scale:"still",root:51.9,chordSecs:26,bellRate:.1,drone:.7}],mn=(a,e)=>a*Math.pow(2,e/12);class r0{constructor(e,t,{volume:s=.5}={}){this.ctx=e,this.station=0,this._t=0,this._chordT=1e9,this._bellT=0,this._chord=0,this.out=e.createGain(),this.out.gain.value=0,this.tone=e.createBiquadFilter(),this.tone.type="lowpass",this.tone.frequency.value=1600,this.tone.Q.value=.4,this.out.connect(this.tone).connect(t);const n=Math.floor(e.sampleRate*2.6),i=e.createBuffer(2,n,e.sampleRate);for(let o=0;o<2;o++){const r=i.getChannelData(o);for(let c=0;c<n;c++)r[c]=(Math.random()*2-1)*Math.pow(1-c/n,3.2)}this.verb=e.createConvolver(),this.verb.buffer=i,this.verbGain=e.createGain(),this.verbGain.gain.value=.55,this.verb.connect(this.verbGain).connect(this.tone),this.volume=s}get label(){return es[this.station].label}next(){this.station=(this.station+1)%es.length;const e=es[this.station].scale!==null;return this.out.gain.setTargetAtTime(e?this.volume*.16:0,this.ctx.currentTime,.5),this._chordT=1e9,this.label}setVolume(e){this.volume=D(e),es[this.station].scale&&this.out.gain.setTargetAtTime(this.volume*.16,this.ctx.currentTime,.3)}_voice(e,t,s,n,i="triangle",o=0){const r=this.ctx,c=r.createOscillator();c.type=i,c.frequency.value=e,c.detune.value=o;const l=r.createGain();l.gain.setValueAtTime(0,t),l.gain.linearRampToValueAtTime(n,t+s*.34),l.gain.exponentialRampToValueAtTime(1e-4,t+s),c.connect(l),l.connect(this.out),l.connect(this.verb),c.start(t),c.stop(t+s+.05)}update(e,t=1){const s=es[this.station];if(!s.scale)return;const n=this.ctx;if(!n||n.state!=="running")return;this._t+=e,this._chordT+=e,this._bellT+=e;const i=a0[s.scale],o=ai[s.scale];if(this._chordT>=s.chordSecs){this._chordT=0,this._chord=(this._chord+1)%o.length;const c=o[this._chord],l=n.currentTime+.05,h=s.chordSecs*1.25;for(const[u,d,f]of[[c,0,.16],[(c+2)%i.length,0,.11],[(c+4)%i.length,1,.08]]){const p=mn(s.root,i[u]+12*d);this._voice(p,l,h,f,"triangle",-5),this._voice(p,l,h,f*.8,"triangle",6)}this._voice(mn(s.root,i[c]-12),l,h,.09*s.drone,"sine")}const r=s.bellRate*F(.25,1,D(t));if(this._bellT>1/Math.max(r,.01)){this._bellT=0;const c=ai[s.scale][this._chord],l=i[(c+(Math.random()*i.length|0))%i.length],h=12*(1+(Math.random()*2|0));this._voice(mn(s.root,l+h),n.currentTime+.02,3.4,.055,"sine")}}}class c0{constructor({volume:e=.38}={}){this.ctx=null,this.volume=e,this.enabled=!0,this._started=!1,this._limitSmooth=0;const t=()=>this.start();for(const s of["pointerdown","keydown","touchstart"])addEventListener(s,t,{once:!0,passive:!0})}start(){if(this._started||!this.enabled)return;const e=window.AudioContext||window.webkitAudioContext;if(!e)return;this._started=!0;const t=this.ctx=new e,s=this.master=t.createGain();s.gain.value=this.volume,s.connect(t.destination),this.engGain=t.createGain(),this.engGain.gain.value=0;const n=t.createBiquadFilter();n.type="lowpass",n.frequency.value=420,n.Q.value=.8,this.engFilter=n,this.engGain.connect(n).connect(s),this.oscs=[];for(const[h,u,d]of[["sawtooth",.5,.5],["sawtooth",1,.34],["triangle",2,.06],["sine",.25,.42]]){const f=t.createOscillator();f.type=h;const p=t.createGain();p.gain.value=d,f.connect(p).connect(this.engGain),f.start(),this.oscs.push({o:f,mul:u})}const i=t.createBufferSource(),o=t.sampleRate*2,r=t.createBuffer(1,o,t.sampleRate),c=r.getChannelData(0);let l=0;for(let h=0;h<o;h++){const u=Math.random()*2-1;l=.99*l+.01*u,c[h]=l*3.5+u*.25}i.buffer=r,i.loop=!0,i.start(),this.noise=i,this.windFilter=t.createBiquadFilter(),this.windFilter.type="bandpass",this.windFilter.frequency.value=700,this.windFilter.Q.value=.5,this.windGain=t.createGain(),this.windGain.gain.value=0,i.connect(this.windFilter).connect(this.windGain).connect(s),this.roadFilter=t.createBiquadFilter(),this.roadFilter.type="bandpass",this.roadFilter.frequency.value=180,this.roadFilter.Q.value=1.6,this.roadGain=t.createGain(),this.roadGain.gain.value=0,i.connect(this.roadFilter).connect(this.roadGain).connect(s),this.scrubFilter=t.createBiquadFilter(),this.scrubFilter.type="bandpass",this.scrubFilter.frequency.value=1100,this.scrubFilter.Q.value=2.6,this.scrubGain=t.createGain(),this.scrubGain.gain.value=0,i.connect(this.scrubFilter).connect(this.scrubGain).connect(s),this.radio=new r0(t,s)}update(e,t){const s=this.ctx;if(!s||s.state==="suspended")return;const n=s.currentTime,i=.06,o=Math.abs(t.speed),r=D((t.rpm-900)/(t.spec.redline-900)),c=26+r*48;for(const{o:f,mul:p}of this.oscs)f.frequency.setTargetAtTime(c*p,n,i);const l=D(t.throttle*.85+r*.3);this.engGain.gain.setTargetAtTime(.032+l*.1,n,i),this.engFilter.frequency.setTargetAtTime(260+l*640+r*240,n,i);const h=Math.pow(D((o-15)/60),1.4);this.windGain.gain.setTargetAtTime(h*.085,n,i),this.windFilter.frequency.setTargetAtTime(330+o*4.5,n,i);const u=t.surfaceKind==="tarmac"?.35:1;this.roadGain.gain.setTargetAtTime(D(o/26)*.062*(.6+u),n,i),this.roadFilter.frequency.setTargetAtTime(78+o*3.2,n,i),this.roadFilter.Q.setTargetAtTime(F(2.4,.9,u),n,i),this._limitSmooth=F(this._limitSmooth,t.limit,Math.min(1,e*12));const d=D((this._limitSmooth-.72)/.28);if(this.scrubGain.gain.setTargetAtTime(d*d*.1*D(o/8),n,.03),this.scrubFilter.frequency.setTargetAtTime(900+d*620,n,i),this.radio){const f=D(1-Math.max(t.limit,Math.abs(t.slip)/.5)*1.2);this.radio.update(e,f)}}nextStation(){return this.start(),this.radio?this.radio.next():"no audio"}horn(){const e=this.ctx;if(!e)return;const t=e.currentTime;for(const[s,n]of[[392,0],[523.25,.11]]){const i=e.createOscillator();i.type="triangle",i.frequency.value=s;const o=e.createGain();o.gain.setValueAtTime(0,t+n),o.gain.linearRampToValueAtTime(.16,t+n+.02),o.gain.exponentialRampToValueAtTime(1e-4,t+n+.42),i.connect(o).connect(this.master),i.start(t+n),i.stop(t+n+.5)}}thump(e=.5){const t=this.ctx;if(!t)return;const s=t.currentTime,n=t.createOscillator();n.type="sine",n.frequency.setValueAtTime(140+90*e,s),n.frequency.exponentialRampToValueAtTime(48,s+.24);const i=t.createGain();i.gain.setValueAtTime(K(e,.05,1)*.4,s),i.gain.exponentialRampToValueAtTime(1e-4,s+.3),n.connect(i).connect(this.master),n.start(s),n.stop(s+.34)}chime(){const e=this.ctx;if(!e)return;const t=e.currentTime;[[659.25,0],[987.77,.14]].forEach(([s,n])=>{const i=e.createOscillator();i.type="sine",i.frequency.value=s;const o=e.createGain();o.gain.setValueAtTime(0,t+n),o.gain.linearRampToValueAtTime(.09,t+n+.03),o.gain.exponentialRampToValueAtTime(1e-4,t+n+.9),i.connect(o).connect(this.master),i.start(t+n),i.stop(t+n+1)})}setVolume(e){this.volume=D(e),this.master&&(this.master.gain.value=this.volume)}dispose(){this.ctx&&this.ctx.close().catch(()=>{}),this.ctx=null}}const Ot=a=>document.querySelector(a),lt=(a,e)=>{const t=Ot("#stat");t&&(t.textContent=a),e!==void 0&&Ot("#barIn")&&(Ot("#barIn").style.width=`${e*100|0}%`)},Tt=new URLSearchParams(location.search),xe=(parseInt(Tt.get("seed")??"",10)||20260726)>>>0,l0=Tt.has("debug"),h0=Tt.has("offline"),ut=bh(),Ft=Vi(ut.feel),u0=wh(ut.terrain);qr(xh(ut.terrain));async function d0(){lt("warming the engine…",.04);const a=document.createElement("canvas");Ot("#app").appendChild(a);const e=Tt.has("probe"),t=new Ha({canvas:a,antialias:!1,powerPreference:"high-performance",stencil:!1,preserveDrawingBuffer:e});if(!t.capabilities.isWebGL2){lt("this browser has no WebGL2 — try Chrome, Edge or Firefox");return}const s=Math.min(devicePixelRatio||1,1.75);t.setPixelRatio(s),t.setSize(innerWidth,innerHeight,!1),t.outputColorSpace=Gt,t.toneMapping=0;const n=new Ks,i=new wi(64,innerWidth/innerHeight,.28,16e3),o=new wr(t,{width:innerWidth,height:innerHeight,pixelRatio:s});n.add(Qa()),lt("drawing the map…",.14);const r=nr(),c=new Cr({seed:xe,scene:n}),l=new Rc({seed:xe,scene:n}),h=new Mh,u=new pl({seed:xe,material:r,viewDistance:6800,terrain:ut.terrain,onChunk:P=>{if(P.water&&c.add(P),P.level<=fs){const I=Oi({cx:P.cx,cz:P.cz,level:P.level,seed:xe});l.add(P,I),P.level===0&&h.addChunk(`${P.cx},${P.cz}`,Th(I))}},onRelease:P=>{c.remove(P),l.remove(P),P.level===0&&h.removeChunk(`${P.cx},${P.cz}`)}});n.add(u.group);const d=new Ur({renderer:t,scene:n,seed:xe}),f=new Hc({seed:xe,scene:n}),p=new jc(t,{seed:xe}),m=new ul({seed:xe,scene:n,wind:p});lt("finding a road…",.34);const v=wo(xe);u.forceChunk(v.x,v.z);let g=new Ht(xe,v.x-420,v.z-420,v.x+420,v.z+420),w=v.x,x=v.z;const y=(P,I)=>((Math.abs(P-w)>240||Math.abs(I-x)>240)&&(g=new Ht(xe,P-420,I-420,P+420,I+420),w=P,x=I),g);lt("unloading the car…",.52);const T=Uh(),b=new lh({tier:Ft.tier,terrain:g,preset:Ft.assist});b.placeAt(v.x,v.z,v.heading);const M=Tt.get("car")&&St[Tt.get("car")]?Tt.get("car"):Ft.car||"coupe";let _;try{_=await Uo({car:M,paint:T.look?.paint??0,base:new URL("./models/cars/",location.href).href})}catch(P){console.error("[car] model failed to load, using the built-in body",P?.message??P),_=gl({tier:Ft.tier,paint:T.look?.paint??0})}n.add(_.group);const S=new uh(i,{mode:Ft.camera}),k=new hh(window);k.attachTouch(a);const L=new dh,E=new vh,A=new Sh,z=new c0;let N=M;async function W(P){if(!(!St[P]||P===N))try{const I=await Uo({car:P,paint:T.look?.paint??0,base:new URL("./models/cars/",location.href).href});n.remove(_.group),_.dispose?.(),_=I,n.add(_.group),N=P,window.WANDEROAD.model=_,A.say(St[P].label,2)}catch(I){console.error("[car] swap failed",I?.message??I),A.say("that one would not load",2.5)}}const G=new Rh({onAuto:()=>L.toggle(b),isAuto:()=>L.on,onCar:W,onFeel:P=>{Vi(P),b.setPreset(pt[P].assist),S.mode=pt[P].camera,S.reset(),A.say(`${pt[P].label}`,2)},onReset:()=>se(),camera:()=>S.mode,cycleCam:()=>S.cycle()});G.setCurrent({car:N,feel:ut.feel,terrain:ut.terrain});const $=document.createElement("div");$.id="openMenu",$.textContent="ESC — garage",A.root.appendChild($);function se(){const I=(b.terrain||g).roads.query(b.x,b.z);if(isFinite(I.d))b.placeAt(I.qx,I.qz,Math.atan2(I.tx,I.tz));else{const ot=wo(xe,b.x,b.z);b.placeAt(ot.x,ot.z,ot.heading)}S.reset(),A.say("back on the road",2)}lt("looking for company…",.7);const C=Wh({backend:h0?"none":"auto",phpBase:new URL("./api/",location.href).href}),B=new Qh({scene:n,buildGhostCar:wl}),j=new n0({seed:xe,transport:C});await j.load().catch(()=>{});const ie=()=>`c${Math.round(b.x/2048)}_${Math.round(b.z/2048)}`;addEventListener("resize",()=>{t.setSize(innerWidth,innerHeight,!1),o.setSize(innerWidth,innerHeight),i.aspect=innerWidth/innerHeight,i.updateProjectionMatrix()}),addEventListener("pagehide",()=>{E.flush(),j.flush(),C.send({op:"bye",cell:ie(),car:oe()}).catch(()=>{})}),document.addEventListener("visibilitychange",()=>{document.hidden&&(E.flush(),j.flush())});let Y=null;l0&&(Y=document.createElement("div"),Y.id="debug",document.body.appendChild(Y));const oe=()=>({x:b.x,y:b.y,z:b.z,yaw:b.yaw,vx:b.vx,vy:b.vy,vz:b.vz,yawRate:b.yawRate,steer:b.steer,throttle:b.throttle,brake:b.brake,gear:b.gear,tier:b.tier,paint:T.look?.paint??0,flags:(b.onGround?0:1)|(b.handbrake>.5?2:0)});let he="offline",ue=0;async function nt(P){if(!(P<ue)){ue=P+4e3;try{const I=await C.send({op:"tick",cell:ie(),car:oe()});if(!I){he="offline";return}he=C.backend==="local"?"solo":"online",I.peers&&B.ingest(I.peers,I.now),ue=performance.now()+1e3/Math.max(.05,Math.min(I.rate||.25,10))}catch{he="offline",ue=performance.now()+8e3}}}let X=performance.now(),Oe=0,Be=X,$t=0,ms=!1;const Et=new Z;function vs(P){requestAnimationFrame(vs);const I=Math.min((P-X)/1e3,.1);X=P;const ot=k.poll();if(k.tapped("camera")&&A.say(`camera: ${S.cycle()}`,1.6),k.tapped("reverse")&&(b.reverse=!b.reverse),k.tapped("nextCar")){const Re=Is.indexOf(N),Ye=Is[(Re+1)%Is.length];G.setCurrent({car:Ye}),W(Ye)}k.tapped("horn")&&z.horn(),k.tapped("radio")&&A.say(z.nextStation(),2.4),k.tapped("autodrive")&&A.say(L.toggle(b)?"auto-drive on — sit back":"auto-drive off",2.4),k.tapped("reset")&&se();for(const[Re,Ye]of[["Digit1","cruise"],["Digit2","sport"],["Digit3","off"],["Digit4","hardcore"]])k.pressed.has(Re)&&(b.setPreset(Ye),A.say(`assists: ${Ye}`,2));b.terrain=y(b.x,b.z);const vt=L.on,gs=L.update(b,ot,I)||ot;vt&&!L.on&&A.say(L.lastReason||"auto-drive off",2.2),G.open||b.update(I,gs);const it=h.resolve(b,1.05,I);it&&it.severity>.35&&it.speed>9&&(z.thump(Math.min(1,it.severity*it.speed/40)),E.update(2,b,{onRoad:0}),A.say("ouch",1.4));const gt=b.terrain.surface(b.x,b.z);E.update(I,b,gt);const Ct=b.groundTilt();_.group.position.set(b.x,b.y-.36,b.z),_.group.rotation.set(0,b.yaw,0),_.setBodyRoll(b.roll*1.3+Ct.roll*.6,b.pitch+Ct.pitch*.6),_.setSteer(b.steerAngle||0),_.setWheelSpin(b.wheelSpin),_.setBrakeGlow(b.brake);const ws=S.update(b,I,(Re,Ye)=>b.terrain.height(Re,Ye));if(ee.uTime.value=P/1e3,ee.uCamPos.value.copy(i.position),i.getWorldDirection(Et),ee.uCull.value.set(Et.x,Et.z,Math.cos(1.15),0),u.update(b.x,b.z),f.update(b.x,b.z),p.update(I,i.position),m.update(b.x,b.z,b.y,I),d.update(I,i.position),c.update(I,i.position),l.update(I,i.position),j.markVisited(b.x,b.z),B.update(I,P),nt(P),z.update(I,b),o.speed=ws,o.limit=b.limit,A.update(I,{car:b,streak:E,surface:gt,remotes:B,netState:he}),o.render(n,i),k.endFrame(),Oe++,P-Be>500&&($t=Oe*1e3/(P-Be),Oe=0,Be=P,Y)){const Re=u.stats;Y.textContent=`fps ${$t.toFixed(0)}  live ${Re.live}  queue ${Re.queued}  built ${Re.built}  wk ${Re.workers}
pos ${b.x.toFixed(0)}, ${b.z.toFixed(0)}  ${b.kph.toFixed(0)} km/h  g${b.gear}  slip ${(b.slip*180/Math.PI).toFixed(0)}°  limit ${b.limit.toFixed(2)}
road ${gt.onRoad.toFixed(2)}  grip ${gt.grip.toFixed(2)}  ${_n[gt.dominant]}  solids ${h.count}
calls ${t.info.render.calls}  tris ${t.info.render.triangles/1e3|0}k  net ${he}  peers ${B.count}`}!ms&&u.stats.live>14&&(ms=!0,lt("go anywhere.",1),setTimeout(()=>{Ot("#veil").classList.add("gone"),Ot("#hud").hidden=!1,(ut.feel!=="road"||ut.terrain!=="rolling")&&A.say(`${Ft.label} · ${u0.label}`,4.5)},500))}requestAnimationFrame(vs),window.THREE=Wa,window.WANDEROAD={renderer:t,scene:n,camera:i,streamer:u,car:b,model:_,chase:S,streak:E,auto:L,solids:h,remotes:B,post:o,SEED:xe,stats:()=>u.stats,fps:()=>$t,drive:P=>Object.assign(window.WANDEROAD._auto||(window.WANDEROAD._auto={}),P)}}d0().catch(a=>{console.error(a),lt(`boot failed: ${a.message}`)});
