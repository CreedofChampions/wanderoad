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
