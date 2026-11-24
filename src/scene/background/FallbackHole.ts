import * as THREE from 'three';

/**
 * Stand-in for the vgpu black hole where WebGPU is unavailable: a camera-facing
 * billboard with the hole's shadow, photon ring, the disk band and the lensed
 * arc over the top. No ray tracing — it keeps the story readable, not exact.
 */
const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform float uGain;
varying vec2 vUv;
void main() {
  vec2 p = vUv;
  float r = length(p);
  float shadow = 1.0 - smoothstep(0.2, 0.215, r);
  float ring = exp(-pow((r - 0.235) / 0.012, 2.0)) * 2.5;
  // Disk seen nearly edge-on: a thin bright band across the hole...
  float band = exp(-pow(p.y / (0.02 + 0.03 * abs(p.x)), 2.0)) * smoothstep(1.0, 0.3, abs(p.x)) * smoothstep(0.2, 0.3, abs(p.x));
  // ...and its far side lensed up and over the shadow.
  float arc = exp(-pow((r - 0.32) / 0.05, 2.0)) * smoothstep(-0.05, 0.25, p.y) * 1.4;
  float halo = exp(-r * 4.0) * 0.25;
  vec3 warm = vec3(1.0, 0.62, 0.28);
  vec3 hot = vec3(1.0, 0.9, 0.75);
  vec3 emission = (hot * ring + mix(warm, hot, band) * band * 3.0 + warm * arc + warm * halo) * uGain;
  float edge = 1.0 - smoothstep(0.7, 1.0, r);
  emission *= (1.0 - shadow) * edge;
  gl_FragColor = vec4(emission, shadow);
}
`;

export class FallbackHole {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uGain: { value: 1 } },
      transparent: true,
      depthWrite: false,
      // Premultiplied "over": the shadow hides stars, the glow adds light.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  /** `distance` in event-horizon radii, matching the vgpu layer's framing. */
  update(cameraPos: THREE.Vector3, direction: THREE.Vector3, camera: THREE.Camera, distance: number, visible: number) {
    this.mesh.visible = visible > 0.001;
    if (!this.mesh.visible) return;
    const placeAt = 60;
    // Outer disk radius 9.5 maps to |uv| = 1 on the billboard.
    const halfSize = placeAt * Math.tan(Math.atan(9.5 / distance));
    this.mesh.position.copy(cameraPos).addScaledVector(direction, placeAt);
    this.mesh.quaternion.copy(camera.quaternion);
    this.mesh.scale.setScalar(halfSize);
    this.material.uniforms.uGain.value = visible;
  }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
