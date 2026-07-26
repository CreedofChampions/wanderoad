/* Wanderoad — the ground material.
 *
 * One RawShaderMaterial draws every chunk in the world, at every LOD, in every biome. The
 * biome is not a branch and not a texture lookup — it is four bytes per vertex (the fifth
 * weight is implied) interpolated across the triangle, so a meadow that fades into steppe
 * fades in the rasteriser, for free, with no seam to hide.
 *
 * The lighting is the pen's `paint()` model verbatim. The only thing added is the road:
 * a second colour ramp for tarmac/gravel/sand, blended in by the carriageway mask that the
 * chunk mesher already computed, plus centre lines that are generated from the road's own
 * distance field rather than from a texture.
 */

import { RawShaderMaterial, DoubleSide, FrontSide } from 'three';
import { vertHead, fragHead, GL_HASH, GL_NOISE, GL_SKY, GL_SHADOW, GL_LIGHT, glCloudField, DEPTH_FS } from '../core/glsl.js';
import { glslPalette, biomeTintArrays } from '../core/palette.js';
import { sharedUniforms } from './uniforms.js';

const TINTS = biomeTintArrays();

/** The per-biome tint tables, injected as GLSL constant arrays. */
function glslBiomeTints() {
  const arr = (a, n, stride) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const s = [];
      for (let c = 0; c < stride; c++) s.push(a[i * stride + c].toFixed(4));
      parts.push(`vec${stride}(${s.join(',')})`);
    }
    return parts.join(',\n  ');
  };
  const n = TINTS.count;
  return /* glsl */ `
const int NBIOME = ${n};
const vec3 B_GROUND[${n}] = vec3[${n}](
  ${arr(TINTS.ground, n, 3)}
);
const vec3 B_ROCK[${n}] = vec3[${n}](
  ${arr(TINTS.rock, n, 3)}
);
const vec3 B_FOLIAGE[${n}] = vec3[${n}](
  ${arr(TINTS.foliage, n, 3)}
);
const vec3 B_HAZE[${n}] = vec3[${n}](
  ${arr(TINTS.haze, n, 3)}
);
// x hazeMul, y dryness, z snow, w wet
const vec4 B_SCAL[${n}] = vec4[${n}](
  ${arr(TINTS.scal, n, 4)}
);
`;
}

const TERRAIN_VS = /* glsl */ `
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
`;

const TERRAIN_FS = /* glsl */ `
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
`;

export function createTerrainMaterial() {
  const cloud = glCloudField({ cshSpan: 9200, cloudDeck: 980 });
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(),
    vertexShader: vertHead(TERRAIN_VS),
    fragmentShader: fragHead(GL_HASH, GL_NOISE, glslBiomeTints(), GL_SKY, cloud, GL_SHADOW, GL_LIGHT, TERRAIN_FS),
    side: FrontSide,
  });
}

/** Depth-only variant for the sun shadow pass. Same vertex transform, no shading. */
export function createTerrainDepthMaterial() {
  return new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(),
    vertexShader: vertHead(/* glsl */ `
in vec3 normal;
in vec4 aBiome;
in vec2 aRoad;
void main(){
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`),
    fragmentShader: DEPTH_FS,
    side: DoubleSide,
  });
}
