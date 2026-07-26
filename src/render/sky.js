/* Wanderoad — the sky.
 *
 * A box that follows the camera, drawn back-face, depth-write off, at the very start of
 * the frame. The gradient is the pen's `skyDome()` — a painted four-stop wash with an
 * azimuthal warm/cool bias and a Mie halo, not a scattering integral. It is the single
 * biggest reason the game reads as a film cel rather than a renderer.
 */

import { BoxGeometry, Mesh, RawShaderMaterial, BackSide } from 'three';
import { vertHead, fragHead, GL_HASH, GL_NOISE, GL_SKY } from '../core/glsl.js';
import { sharedUniforms } from './uniforms.js';

const SKY_VS = /* glsl */ `
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
`;

const SKY_FS = /* glsl */ `
in vec3 vDir;
out vec4 fragColor;
void main(){
  vec3 d = normalize(vDir);
  float sunMask;
  vec3 col = skyDome(d, sunMask);
  // Alpha carries "how far away" for the post chain; the sky is as far as it gets.
  fragColor = vec4(SAFE3(col), 1.0);
}
`;

export function createSky() {
  const mat = new RawShaderMaterial({
    glslVersion: '300 es',
    uniforms: sharedUniforms(),
    vertexShader: vertHead(SKY_VS),
    fragmentShader: fragHead(GL_HASH, GL_NOISE, GL_SKY, SKY_FS),
    side: BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.name = 'sky';
  return mesh;
}
