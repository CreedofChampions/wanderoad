/* Wanderoad — the shared uniform block.
 *
 * Every material in the game declares the same GL_UNI block, and every material shares
 * the SAME uniform objects. One write to `U.uTime.value` updates the terrain, the grass,
 * the water, the trees, the car and the sky in the same frame. That is the pen's trick and
 * it is worth keeping: there is no per-material sync code anywhere in this project.
 */

import { Vector2, Vector3, Vector4, Matrix4, Texture } from 'three';

/** The sun. A low, warm, late-afternoon sun — the whole palette is built for it. */
export const SUN_ELEVATION = 13.5; // degrees above the horizon
export const SUN_AZIMUTH = 118; // degrees, clockwise from -Z

export function sunDirection(elevDeg = SUN_ELEVATION, azDeg = SUN_AZIMUTH) {
  const e = (elevDeg * Math.PI) / 180;
  const a = (azDeg * Math.PI) / 180;
  return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)).normalize();
}

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: sunDirection() },
  uCamPos: { value: new Vector3() },
  uWindOrigin: { value: new Vector2() },
  uCloudDrift: { value: new Vector2() },
  uWindTex: { value: null },
  uShadowMap: { value: null },
  uCloudSh: { value: null },
  uCloudShOrigin: { value: new Vector2() },
  uShadowC: { value: new Vector2() },
  uCull: { value: new Vector4(0, 0, -1, 0) },
  uWindLag: { value: new Vector2() },
  uLightMat: { value: new Matrix4() },
  uShadowTexel: { value: 1 / 2048 },
  uCloudAmount: { value: 0.62 },
  uFogMul: { value: 1.0 },
  uFogNear: { value: 140 },
  uFogFar: { value: 4200 },
  /* Valley mist — (amount, the mist sea's altitude in metres, its scale height in metres).
   * Read by aerial() in core/glsl.js, which every world shader calls, and by skyDome() for
   * the band where the mist sea meets the sky. One vec3 rather than three floats because it
   * is one idea and because every material in the game carries the whole shared block.
   *
   * The two altitudes are anchored to the world's own relief, not guessed: over 6000 samples
   * out to 5 km on three seeds the land's median height is 20-30 m, its upper quartile ~80 m
   * and its 95th percentile ~190 m (tools/diag-mist.mjs prints the table). A sea at 20 m with
   * a 58 m scale height therefore fills the valleys, half-drowns the low hills and leaves
   * anything above ~200 m — which is every massif worth looking at — standing clear of it.
   * That contrast IS the effect; a mist that reached the summits would just be fog.
   *
   * `x` is the only knob that should ever move at runtime: 0 turns the whole thing off, and
   * the branch in aerial() then costs one uniform compare per fragment. */
  uMist: { value: new Vector3(1.0, 20, 58) },
};

/**
 * Clone the shared block for a material that needs its own value for one entry.
 */
export function sharedUniforms(overrides = {}) {
  const out = {};
  for (const k in U) out[k] = U[k];
  for (const k in overrides) out[k] = overrides[k];
  return out;
}

/** A 1x1 neutral texture so samplers are never null on first compile. */
let _blank = null;
export function blankTexture() {
  if (_blank) return _blank;
  const t = new Texture();
  t.image = { width: 1, height: 1, data: new Uint8Array([128, 128, 255, 255]) };
  t.needsUpdate = true;
  _blank = t;
  return _blank;
}
