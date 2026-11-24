import * as THREE from 'three';
import { additiveLight } from '../blending';

/** Small deterministic PRNG so the star field is identical on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Approximate stellar colours (linear) from hot blue-white to cool orange.
const STAR_TINTS = [
  [0.62, 0.72, 1.0],
  [0.8, 0.86, 1.0],
  [1.0, 1.0, 1.0],
  [1.0, 0.94, 0.84],
  [1.0, 0.82, 0.62],
].map(([r, g, b]) => new THREE.Color(r, g, b));

// Galactic plane orientation: a great circle tilted across the frame.
const GALACTIC_NORMAL = new THREE.Vector3(0.38, 0.86, 0.34).normalize();

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uPixelRatio;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPixelRatio;
}
`;
const STAR_FRAG = /* glsl */ `
uniform float uIntensity;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 7.0);
  gl_FragColor = vec4(vColor * core * uIntensity, 1.0);
}
`;

/** Faint diffuse band of unresolved stars and dust along the galactic plane. */
const BAND_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BAND_FRAG = /* glsl */ `
uniform vec3 uNormal;
uniform float uIntensity;
varying vec3 vDir;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float lat = dot(d, uNormal);
  float band = exp(-lat * lat * 38.0);
  float clouds = fbm(d * 6.0);
  float dust = smoothstep(0.45, 0.75, fbm(d * 11.0 + 4.0)) * exp(-lat * lat * 160.0);
  float glow = band * (0.35 + clouds * 0.9) * (1.0 - dust * 0.85);
  vec3 tint = mix(vec3(0.55, 0.62, 0.8), vec3(0.9, 0.8, 0.68), clouds);
  gl_FragColor = vec4(tint * glow * uIntensity, 1.0);
}
`;

/**
 * Background sky: resolved stars as round point sprites (brightest exceed 1.0
 * so bloom catches them) plus a very faint galactic band. Lives at radius ~90
 * in the background scene, always centred on the background camera.
 */
export class Sky {
  readonly group = new THREE.Group();
  private readonly starMaterial: THREE.ShaderMaterial;
  private readonly bandMaterial: THREE.ShaderMaterial;

  constructor(pixelRatio: number, count = 7000) {
    const rand = mulberry32(1969);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      // ~35% of stars cluster towards the galactic plane.
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
      if (rand() < 0.35) {
        const lat = v.dot(GALACTIC_NORMAL);
        v.addScaledVector(GALACTIC_NORMAL, -lat * (0.75 + rand() * 0.2)).normalize();
      }
      v.multiplyScalar(90);
      positions.set([v.x, v.y, v.z], i * 3);
      // Steep magnitude distribution: most stars are faint pinpoints.
      const m = Math.pow(rand(), 9);
      const brightness = 0.05 + m * 5.5;
      const tint = STAR_TINTS[Math.floor(rand() * STAR_TINTS.length)];
      colors.set([tint.r * brightness, tint.g * brightness, tint.b * brightness], i * 3);
      sizes[i] = 1.6 + m * 3.6;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.starMaterial = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: { uPixelRatio: { value: pixelRatio }, uIntensity: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    additiveLight(this.starMaterial);
    const stars = new THREE.Points(geometry, this.starMaterial);
    stars.frustumCulled = false;

    this.bandMaterial = new THREE.ShaderMaterial({
      vertexShader: BAND_VERT,
      fragmentShader: BAND_FRAG,
      uniforms: { uNormal: { value: GALACTIC_NORMAL }, uIntensity: { value: 0.016 } },
      side: THREE.BackSide,
      depthWrite: false,
      transparent: true,
    });
    additiveLight(this.bandMaterial);
    const band = new THREE.Mesh(new THREE.SphereGeometry(95, 64, 32), this.bandMaterial);
    band.renderOrder = -1;
    this.group.add(band, stars);
  }

  /** 0–1 fade, used to hand the sky over to the vgpu black-hole layer's own star field. */
  setIntensity(k: number) {
    this.starMaterial.uniforms.uIntensity.value = k;
    this.bandMaterial.uniforms.uIntensity.value = 0.016 * k;
    this.group.visible = k > 0.001;
  }

  setPixelRatio(pr: number) {
    this.starMaterial.uniforms.uPixelRatio.value = pr;
  }

  dispose() {
    this.starMaterial.dispose();
    this.bandMaterial.dispose();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

const SUN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SUN_FRAG = /* glsl */ `
uniform float uCoreRadius;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  // Everything fades to exactly zero before the quad edge, so the billboard never shows.
  float edge = 1.0 - smoothstep(0.55, 1.0, r);
  float core = smoothstep(uCoreRadius, uCoreRadius * 0.82, r) * 30.0;
  float corona = exp(-r * 16.0) * 1.6 + exp(-r * 5.0) * 0.035;
  // Faint horizontal anamorphic streak, kept very restrained.
  float streak = exp(-abs(vUv.y) * 220.0) * (1.0 - smoothstep(0.0, 0.95, abs(vUv.x))) * 0.35;
  vec3 color = vec3(1.0, 0.95, 0.88) * (core + corona) + vec3(0.75, 0.85, 1.0) * streak;
  gl_FragColor = vec4(color * uIntensity * edge, 1.0);
}
`;

/** Camera-facing sun billboard. Depth-tested so Earth can occlude it at the limb. */
export class Sun {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      uniforms: { uCoreRadius: { value: 0.045 }, uIntensity: { value: 1 } },
      transparent: true,
      depthWrite: false,
    });
    additiveLight(this.material);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), this.material);
    this.mesh.renderOrder = 2;
  }

  /** Places the sun far along `direction` from `cameraPos`, facing the camera. */
  update(cameraPos: THREE.Vector3, direction: THREE.Vector3, camera: THREE.Camera) {
    this.mesh.position.copy(cameraPos).addScaledVector(direction, 60);
    this.mesh.quaternion.copy(camera.quaternion);
  }

  dispose() {
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
