import * as THREE from 'three';

/**
 * Additive light that leaves the alpha channel untouched.
 *
 * The Three.js canvas is composited over the vgpu (WebGPU) canvas, so its alpha
 * must mean "something solid is here" (Earth, astronaut). Glows — stars, sun,
 * atmosphere, bloom — add light with alpha 0, which the browser composites as
 * premultiplied additive light over whatever the vgpu layer shows.
 */
export function additiveLight<T extends THREE.Material>(material: T): T {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneFactor;
  material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.transparent = true;
  material.depthWrite = false;
  return material;
}
