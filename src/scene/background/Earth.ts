import * as THREE from 'three';
import { additiveLight } from '../blending';
import {
  atmosphereFragment,
  atmosphereVertex,
  bakeCloudsFragment,
  bakeSurfaceFragment,
  bakeVertex,
  earthFragment,
  earthVertex,
} from './earthShaders';

const DAY_URL = '/textures/earth/bluemarble-july-5400.jpg';
const NIGHT_URL = '/textures/earth/blackmarble-2016-3600.jpg';
const CLOUD_MAP_SIZE: [number, number] = [2048, 1024];
const AXIAL_TILT = THREE.MathUtils.degToRad(23.44);

/** Texture sizes to upload: sharp on large screens, half on phones (GPU memory). */
function mapSizes(): { day: [number, number]; night: [number, number] } {
  const longEdge = Math.max(window.screen.width, window.screen.height) * Math.min(window.devicePixelRatio, 2);
  const large = longEdge >= 1600;
  return { day: large ? [4096, 2048] : [2048, 1024], night: large ? [2048, 1024] : [1024, 512] };
}

/** Fetches and decodes an image, downscaled during decode so the full-size original never reaches the GPU. */
async function loadResized(url: string, [w, h]: readonly [number, number]): Promise<TexImageSource> {
  const blob = await (await fetch(url)).blob();
  try {
    return await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', imageOrientation: 'flipY' });
  } catch {
    // Older engines without resize options: decode at native size.
    return await createImageBitmap(blob, { imageOrientation: 'flipY' });
  }
}

/**
 * Earth (unit radius). Rendering follows the vgpu "Earth" example: same
 * terminator, night-light, cloud-shadow, sunset and atmosphere model, and the
 * same GPU-baked procedural clouds. The surface uses NASA Blue Marble / Black
 * Marble imagery so the planet is recognisably Earth; vgpu's procedural surface
 * bake is kept as a fallback if the imagery cannot be loaded.
 */
export class Earth {
  readonly group = new THREE.Group();
  readonly ready: Promise<void>;
  private readonly spin = new THREE.Group();
  private readonly planet: THREE.Mesh;
  private readonly cloudTarget: THREE.WebGLRenderTarget;
  private surfaceTarget: THREE.WebGLRenderTarget | null = null;
  private readonly textures: THREE.Texture[] = [];
  private readonly earthMaterial: THREE.ShaderMaterial;
  private readonly atmosphereMaterial: THREE.ShaderMaterial;
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpVec = new THREE.Vector3();

  /** `procedural`: skip NASA imagery and use vgpu's procedural surface (a fictional world). */
  constructor(renderer: THREE.WebGLRenderer, options: { procedural?: boolean } = {}) {
    const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.cloudTarget = this.createTarget(CLOUD_MAP_SIZE, THREE.UnsignedByteType, anisotropy);
    this.bake(renderer, bakeCloudsFragment, this.cloudTarget);

    this.earthMaterial = new THREE.ShaderMaterial({
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      uniforms: {
        uSurface: { value: null },
        uNight: { value: null },
        uClouds: { value: this.cloudTarget.texture },
        uLightDir: { value: new THREE.Vector3(1, 0, 0) },
        uCameraPos: { value: new THREE.Vector3(0, 0, 5) },
        uExposure: { value: 1.1 },
        uNightLights: { value: 1.6 },
        uMoonlight: { value: 0.5 },
        uCloudOpacity: { value: 0.75 },
      },
    });
    this.atmosphereMaterial = new THREE.ShaderMaterial({
      vertexShader: atmosphereVertex,
      fragmentShader: atmosphereFragment,
      uniforms: {
        uLightDir: { value: new THREE.Vector3(1, 0, 0) },
        uCameraPos: { value: new THREE.Vector3(0, 0, 5) },
        uStrength: { value: 1.6 },
        uForward: { value: 9.0 },
      },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
    });

    additiveLight(this.atmosphereMaterial);
    this.planet = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), this.earthMaterial);
    this.planet.visible = false; // until the surface is ready
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1.025, 128, 64), this.atmosphereMaterial);
    atmosphere.renderOrder = 1;
    this.spin.add(this.planet, atmosphere);
    // Africa, the Mediterranean and Arabia in daylight; Europe's lights across the terminator.
    this.spin.rotation.y = 5.15;
    const tilt = new THREE.Group();
    tilt.rotation.z = AXIAL_TILT;
    tilt.add(this.spin);
    this.group.add(tilt);

    if (options.procedural) {
      this.useProceduralSurface(renderer, anisotropy);
      this.ready = Promise.resolve();
      return;
    }
    this.ready = this.loadMaps(renderer, anisotropy).catch((err) => {
      console.warn('Earth imagery unavailable, using procedural surface', err);
      this.useProceduralSurface(renderer, anisotropy);
    });
  }

  private async loadMaps(renderer: THREE.WebGLRenderer, anisotropy: number) {
    const sizes = mapSizes();
    const [day, night] = await Promise.all([loadResized(DAY_URL, sizes.day), loadResized(NIGHT_URL, sizes.night)]);
    const toTexture = (image: TexImageSource) => {
      const t = new THREE.Texture(image as HTMLImageElement);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // flipped during decode (ImageBitmaps ignore flipY)
      t.wrapS = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.needsUpdate = true;
      this.textures.push(t);
      return t;
    };
    const dayTex = toTexture(day);
    const nightTex = toTexture(night);
    this.earthMaterial.uniforms.uSurface.value = dayTex;
    this.earthMaterial.uniforms.uNight.value = nightTex;
    this.earthMaterial.defines = { NASA_MAPS: '' };
    this.earthMaterial.needsUpdate = true;
    // Upload now, then release the decoded bitmaps: the GPU copy is all we need.
    renderer.initTexture(dayTex);
    renderer.initTexture(nightTex);
    for (const img of [day, night]) if ('close' in img) (img as ImageBitmap).close();
    this.planet.visible = true;
  }

  private useProceduralSurface(renderer: THREE.WebGLRenderer, anisotropy: number) {
    this.surfaceTarget = this.createTarget([2048, 1024], THREE.HalfFloatType, anisotropy);
    this.bake(renderer, bakeSurfaceFragment, this.surfaceTarget);
    this.earthMaterial.uniforms.uSurface.value = this.surfaceTarget.texture;
    this.earthMaterial.uniforms.uNightLights.value = 0.55;
    this.earthMaterial.uniforms.uExposure.value = 1.35;
    this.earthMaterial.uniforms.uCloudOpacity.value = 1;
    this.planet.visible = true;
  }

  private createTarget(size: readonly [number, number], type: THREE.TextureDataType, anisotropy: number) {
    const target = new THREE.WebGLRenderTarget(size[0], size[1], {
      type,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      depthBuffer: false,
    });
    target.texture.anisotropy = anisotropy;
    return target;
  }

  private bake(renderer: THREE.WebGLRenderer, fragmentShader: string, target: THREE.WebGLRenderTarget) {
    const material = new THREE.RawShaderMaterial({
      vertexShader: bakeVertex,
      fragmentShader,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    const scene = new THREE.Scene();
    scene.add(quad);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    quad.geometry.dispose();
    material.dispose();
  }

  /** Call every frame: converts world-space sun/camera into the planet's object space. */
  update(dt: number, sunDirWorld: THREE.Vector3, cameraWorld: THREE.Vector3) {
    this.spin.rotation.y += dt * 0.0006; // perceptible only over minutes, so the framing holds
    this.group.updateMatrixWorld(true);
    this.tmpMatrix.copy(this.planet.matrixWorld).invert();
    const light = this.tmpVec.copy(sunDirWorld).transformDirection(this.tmpMatrix);
    this.earthMaterial.uniforms.uLightDir.value.copy(light);
    this.atmosphereMaterial.uniforms.uLightDir.value.copy(light);
    const cam = this.tmpVec.copy(cameraWorld).applyMatrix4(this.tmpMatrix);
    this.earthMaterial.uniforms.uCameraPos.value.copy(cam);
    this.atmosphereMaterial.uniforms.uCameraPos.value.copy(cam);
  }

  /** Development aid: rotate the planet to frame a region. */
  setSpin(radians: number) {
    this.spin.rotation.y = radians;
  }

  dispose() {
    this.cloudTarget.dispose();
    this.surfaceTarget?.dispose();
    for (const t of this.textures) t.dispose();
    this.earthMaterial.dispose();
    this.atmosphereMaterial.dispose();
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}
