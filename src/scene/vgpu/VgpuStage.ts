import {
  draw,
  effect,
  frame,
  geometry,
  init,
  sampler,
  surface,
  target,
  type Frame,
  type Gpu,
  type Surface,
  type Target,
} from 'vgpu';
import { perspective, sphere, viewMatrices } from 'vgpu/scene';
import blackHoleWgsl from './blackhole/black-hole.wgsl';
import brightPassWgsl from './blackhole/bright-pass.wgsl';
import blurWgsl from './blackhole/blur.wgsl';
import compositeWgsl from './blackhole/composite.wgsl';
import wormholeWgsl from './passes/wormhole.wgsl';
import dissolveWgsl from './passes/dissolve.wgsl';
import topshotBakeWgsl from './passes/topshot-bake.wgsl';
import topshotWgsl from './passes/topshot.wgsl';
import skyWgsl from './planet/sky.wgsl';
import earthWgsl from './planet/earth.wgsl';
import atmosphereWgsl from './planet/atmosphere.wgsl';
import overlayWgsl from './planet/overlay.wgsl';
import bakeSurfaceWgsl from './planet/bake-surface.wgsl';
import bakeCloudsWgsl from './planet/bake-clouds.wgsl';

type Vec3 = readonly [number, number, number];
type Vec2 = readonly [number, number];

export interface BlackHolePass {
  kind: 'blackhole';
  /** Camera in black-hole units (horizon radius 1, disk in xz). */
  view: { position: Vec3; forward: Vec3; right: Vec3; up: Vec3; tanHalfFov: number };
  diskGain: number;
}
export interface WormholePass {
  kind: 'wormhole';
  travel: number;
  speed: number;
  warp: number;
  exitGlow: number;
  heat: number;
}
export interface PlanetPass {
  kind: 'planet';
  /** Camera in planet units (radius 1, planet at origin); quaternion = Three.js camera's. */
  camera: { position: Vec3; quaternion: readonly [number, number, number, number]; fov: number; right: Vec3; up: Vec3; forward: Vec3 };
  light: Vec3;
}
export interface TopShotPass {
  kind: 'topshot';
  zoom: number;
  pan: Vec2;
  drift: Vec2;
  shadow: Vec2;
  sun: number;
  haze: number;
}
export type ScenePass = BlackHolePass | WormholePass | PlanetPass | TopShotPass;

export interface StageFrame {
  primary: ScenePass;
  /** Incoming scene laid over the primary while `mix` > 0. */
  secondary?: ScenePass;
  mix?: number;
  distort?: number;
  exposure: number;
  time: number;
}

export interface PatchSpec {
  nadir: Vec3;
  east: Vec3;
  north: Vec3;
  light: Vec3;
  halfTan: number;
}

const HDR: GPUTextureFormat = 'rgba16float';
const PLANET_FORMAT: GPUTextureFormat = 'rgba8unorm-srgb';
const BLACK = [0, 0, 0, 1] as const;
const CLEAR = [0, 0, 0, 0] as const;
/** Scene passes render below native resolution; the black hole is the costly one. */
const RENDER_SCALE = 0.65;
const MAP_SIZE: Vec2 = [2048, 1024];
const PATCH_SIZE = 2048;
const PATCH_STRIPS = 32;
const BLURS = [
  { direction: [1, 0], radius: 1 },
  { direction: [0, 1], radius: 1 },
  { direction: [1, 0], radius: 2.4 },
  { direction: [0, 1], radius: 2.4 },
] as const;

function destroy(...targets: (Target | undefined)[]) {
  for (const t of targets) (t as (Target & { destroy?: () => void }) | undefined)?.destroy?.();
}

function createSizedTargets(gpu: Gpu, size: Vec2) {
  const scene: [number, number] = [Math.max(1, Math.round(size[0] * RENDER_SCALE)), Math.max(1, Math.round(size[1] * RENDER_SCALE))];
  const height = Math.min(360, scene[1]);
  const bloom: [number, number] = [Math.max(1, Math.round((height * scene[0]) / scene[1])), height];
  return {
    sceneA: target(gpu, { size: scene, format: HDR }),
    sceneB: target(gpu, { size: scene, format: HDR }),
    planet: target(gpu, { size: scene, format: PLANET_FORMAT, msaa: true, depth: true }),
    bloom: [target(gpu, { size: bloom, format: HDR }), target(gpu, { size: bloom, format: HDR })] as const,
  };
}
type SizedTargets = ReturnType<typeof createSizedTargets>;

/**
 * Every vgpu-rendered environment of the journey, in one WebGPU canvas behind
 * the Three.js canvas:
 *  - black hole  — vgpu "black-hole" example (lensing raymarch)
 *  - wormhole    — 2D polar tunnel (cheap)
 *  - planet      — vgpu "earth" example (procedural Earth-like world, baked once)
 *  - top shot    — high-altitude patch of that planet, baked once in strips
 * Only one scene renders per frame, plus a second during short hand-offs.
 * No loop of its own: the Three.js experience calls render() each frame.
 */
export class VgpuStage {
  private readonly gpu: Gpu;
  private readonly canvasSurface: Surface;
  private sized: SizedTargets;
  private readonly maps;
  private readonly patch: Target;
  private readonly fx;
  private readonly unsubscribeResize: () => void;
  private readonly projection = new Float32Array(16);
  private readonly camMatrices = { view: new Float32Array(16), viewProjection: new Float32Array(16) };
  private patchSpec: PatchSpec | null = null;
  private patchStrip = 0;
  private disposed = false;

  private constructor(gpu: Gpu, canvasSurface: Surface) {
    this.gpu = gpu;
    this.canvasSurface = canvasSurface;
    this.sized = createSizedTargets(gpu, canvasSurface.size);
    this.maps = {
      surface: target(gpu, { size: MAP_SIZE, format: PLANET_FORMAT }),
      clouds: target(gpu, { size: MAP_SIZE, format: 'r8unorm' }),
    };
    this.patch = target(gpu, { size: [PATCH_SIZE, PATCH_SIZE], format: PLANET_FORMAT });

    const linear = sampler(gpu, { minFilter: 'linear', magFilter: 'linear' });
    const mapSampler = sampler(gpu, { minFilter: 'linear', magFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    const planetGeometry = geometry(gpu, sphere({ radius: 1, widthSegments: 256, heightSegments: 128 }));
    const atmosphereGeometry = geometry(gpu, sphere({ radius: 1.02, widthSegments: 128, heightSegments: 64 }));

    this.fx = {
      blackhole: effect(gpu, blackHoleWgsl, {
        set: {
          params: {
            resolution: this.sized.sceneA.size,
            time: 0,
            tanHalfFov: 0.27,
            cameraPosition: [0, 0, 900],
            diskGain: 1,
            forward: [0, 0, -1],
            right: [1, 0, 0],
            up: [0, 1, 0],
          },
        },
      }),
      wormhole: effect(gpu, wormholeWgsl, {
        set: { tunnel: { resolution: this.sized.sceneA.size, time: 0, travel: 0, speed: 0, warp: 0, exitGlow: 0, heat: 1 } },
      }),
      sky: effect(gpu, skyWgsl, {
        set: { sky: { right: [1, 0, 0], tanHalfFov: 0.27, up: [0, 1, 0], aspect: 1, forward: [0, 0, -1], lightDirection: [1, 0, 0] } },
      }),
      earth: draw(gpu, { shader: earthWgsl, geometry: planetGeometry }),
      atmosphere: draw(gpu, { shader: atmosphereWgsl, geometry: atmosphereGeometry, blend: 'alpha' }),
      overlay: effect(gpu, overlayWgsl, { blend: 'premultiplied', set: { samp: linear } }),
      topshot: effect(gpu, topshotWgsl, {
        set: {
          samp: linear,
          patchMap: this.patch,
          top: { resolution: this.sized.sceneA.size, zoom: 1, time: 0, pan: [0, 0], shadow: [0, 0], drift: [0, 0], sun: 1, haze: 0.2 },
        },
      }),
      topshotBake: effect(gpu, topshotBakeWgsl),
      dissolve: effect(gpu, dissolveWgsl, { blend: 'alpha', set: { samp: linear, dissolve: { amount: 0, distort: 0, time: 0, aspect: 1 } } }),
      bright: effect(gpu, brightPassWgsl, { set: { samp: linear } }),
      blur: BLURS.map((blur, i) => effect(gpu, blurWgsl, { set: { samp: linear, blur: { ...blur, texelSize: this.sized.bloom[i % 2].texelSize } } })),
      composite: effect(gpu, compositeWgsl, {
        set: { samp: linear, post: { exposure: 1, time: 0, grain: 0.045, vignette: 0.32, aspect: 1, bloomStrength: 0.55 } },
      }),
    };
    this.fx.earth.set({ surfaceMap: this.maps.surface, cloudMap: this.maps.clouds, mapSampler });
    this.bindSized();

    this.unsubscribeResize = canvasSurface.onResize(() => {
      if (this.disposed) return;
      const previous = this.sized;
      this.sized = createSizedTargets(gpu, canvasSurface.size);
      this.bindSized();
      destroy(previous.sceneA, previous.sceneB, previous.planet, ...previous.bloom);
    });
  }

  /** Resolves to null where WebGPU is unavailable; callers fall back gracefully. */
  static async create(canvas: HTMLCanvasElement): Promise<VgpuStage | null> {
    if (!('gpu' in navigator) || !navigator.gpu) return null;
    let gpu: Gpu | undefined;
    try {
      gpu = await init();
      const stage = new VgpuStage(gpu, surface(gpu, canvas, { dpr: [1, 1.5] }));
      await stage.prewarm();
      await stage.bakePlanetMaps();
      return stage;
    } catch (err) {
      console.warn('vgpu stage unavailable', err);
      gpu?.dispose();
      return null;
    }
  }

  private bindSized() {
    const { fx, sized } = this;
    const aspect = this.canvasSurface.size[0] / this.canvasSurface.size[1];
    fx.blackhole.set({ params: { resolution: sized.sceneA.size } });
    fx.wormhole.set({ tunnel: { resolution: sized.sceneA.size } });
    fx.topshot.set({ top: { resolution: sized.sceneA.size } });
    fx.overlay.set({ planetTexture: sized.planet });
    fx.dissolve.set({ src: sized.sceneB, dissolve: { aspect } });
    fx.bright.set({ src: sized.sceneA });
    fx.blur.forEach((blur, i) => blur.set({ src: sized.bloom[i % 2], blur: { texelSize: sized.bloom[i % 2].texelSize } }));
    fx.composite.set({ scene: sized.sceneA, bloom: sized.bloom[0], post: { aspect } });
  }

  private async prewarm() {
    const { fx, sized } = this;
    await Promise.all([
      fx.blackhole.compile(sized.sceneA),
      fx.wormhole.compile(sized.sceneA),
      fx.sky.compile(sized.sceneA),
      fx.earth.compile(sized.planet),
      fx.atmosphere.compile(sized.planet),
      fx.overlay.compile(sized.sceneA),
      fx.topshot.compile(sized.sceneA),
      fx.topshotBake.compile(this.patch),
      fx.dissolve.compile(sized.sceneA),
      fx.bright.compile(sized.bloom[0]),
      ...fx.blur.map((blur, i) => blur.compile(sized.bloom[(i + 1) % 2])),
      fx.composite.compile({ colors: [this.canvasSurface.format] }),
    ]);
  }

  /** The globe's procedural maps, from the vgpu Earth example; baked once in one submit. */
  private async bakePlanetMaps() {
    const surfacePass = effect(this.gpu, bakeSurfaceWgsl);
    const cloudPass = effect(this.gpu, bakeCloudsWgsl);
    await Promise.all([surfacePass.compile(this.maps.surface), cloudPass.compile(this.maps.clouds)]);
    frame(this.gpu, (f) => {
      f.pass({ target: this.maps.surface, clear: CLEAR }, (pass) => pass.draw(surfacePass));
      f.pass({ target: this.maps.clouds, clear: CLEAR }, (pass) => pass.draw(cloudPass));
    });
  }

  /** Defines the top-shot patch; it is then baked a strip at a time by bakeStep(). */
  preparePatch(spec: PatchSpec) {
    this.patchSpec = spec;
    this.patchStrip = 0;
  }

  get patchReady() {
    return this.patchSpec !== null && this.patchStrip >= PATCH_STRIPS;
  }

  /** Bakes one strip of the top-shot patch (call once per frame until patchReady). */
  bakeStep() {
    const spec = this.patchSpec;
    if (this.disposed || !spec || this.patchStrip >= PATCH_STRIPS) return;
    const i = this.patchStrip++;
    this.fx.topshotBake.set({
      tile: {
        nadir: spec.nadir,
        halfTan: spec.halfTan,
        east: spec.east,
        stripStart: i / PATCH_STRIPS,
        north: spec.north,
        stripEnd: (i + 1) / PATCH_STRIPS,
        light: spec.light,
        texel: (2 * spec.halfTan) / PATCH_SIZE,
      },
    });
    frame(this.gpu, (f) => {
      f.pass({ target: this.patch, clear: i === 0 ? CLEAR : false }, (pass) => pass.draw(this.fx.topshotBake));
    });
  }

  private setUniforms(p: ScenePass, time: number) {
    const { fx } = this;
    switch (p.kind) {
      case 'blackhole':
        fx.blackhole.set({
          params: {
            time,
            diskGain: p.diskGain,
            tanHalfFov: p.view.tanHalfFov,
            cameraPosition: p.view.position,
            forward: p.view.forward,
            right: p.view.right,
            up: p.view.up,
          },
        });
        break;
      case 'wormhole':
        fx.wormhole.set({ tunnel: { time, travel: p.travel, speed: p.speed, warp: p.warp, exitGlow: p.exitGlow, heat: p.heat } });
        break;
      case 'planet': {
        const size = this.sized.sceneA.size;
        const aspect = size[0] / Math.max(1, size[1]);
        const c = p.camera;
        perspective({ fov: c.fov, near: 0.02, far: 600 }, aspect, this.projection);
        viewMatrices({ position: new Float32Array(c.position), quaternion: new Float32Array(c.quaternion) }, this.projection, this.camMatrices);
        fx.earth.set({ earth: { viewProjection: this.camMatrices.viewProjection, cameraPosition: c.position, time, lightDirection: p.light } });
        fx.atmosphere.set({
          atmosphere: { viewProjection: this.camMatrices.viewProjection, cameraPosition: c.position, strength: 1, lightDirection: p.light, _pad: 0 },
        });
        fx.sky.set({
          sky: { right: c.right, tanHalfFov: Math.tan((c.fov * Math.PI) / 360), up: c.up, aspect, forward: c.forward, lightDirection: p.light },
        });
        break;
      }
      case 'topshot':
        fx.topshot.set({ top: { zoom: p.zoom, time, pan: p.pan, drift: p.drift, shadow: p.shadow, sun: p.sun, haze: p.haze } });
        break;
    }
  }

  private drawScene(f: Frame, p: ScenePass, out: Target) {
    const { fx, sized } = this;
    switch (p.kind) {
      case 'blackhole':
        f.pass({ target: out, clear: BLACK }, (pass) => pass.draw(fx.blackhole));
        break;
      case 'wormhole':
        f.pass({ target: out, clear: BLACK }, (pass) => pass.draw(fx.wormhole));
        break;
      case 'planet':
        // As in the vgpu Earth example: sky, then the MSAA planet, laid over it.
        f.pass({ target: out, clear: BLACK }, (pass) => pass.draw(fx.sky));
        f.pass({ target: sized.planet, clear: CLEAR }, (pass) => {
          pass.draw(fx.earth);
          pass.draw(fx.atmosphere);
        });
        f.pass({ target: out, clear: false }, (pass) => pass.draw(fx.overlay));
        break;
      case 'topshot':
        f.pass({ target: out, clear: BLACK }, (pass) => pass.draw(fx.topshot));
        break;
    }
  }

  render({ primary, secondary, mix = 0, distort = 0, exposure, time }: StageFrame) {
    if (this.disposed) return;
    const { fx, sized } = this;
    // A pass can't be both scenes at once (shared uniforms); hand-offs always change kind.
    const blend = secondary && mix > 0.001 && secondary.kind !== primary.kind ? secondary : null;
    this.setUniforms(primary, time);
    if (blend) {
      this.setUniforms(blend, time);
      fx.dissolve.set({ dissolve: { amount: Math.min(1, mix), distort, time } });
    }
    fx.composite.set({ post: { exposure, time } });
    frame(this.gpu, (f) => {
      this.drawScene(f, primary, sized.sceneA);
      if (blend) {
        this.drawScene(f, blend, sized.sceneB);
        f.pass({ target: sized.sceneA, clear: false }, (pass) => pass.draw(fx.dissolve));
      }
      f.pass({ target: sized.bloom[0], clear: BLACK }, (pass) => pass.draw(fx.bright));
      fx.blur.forEach((blur, i) => {
        f.pass({ target: sized.bloom[(i + 1) % 2], clear: BLACK }, (pass) => pass.draw(blur));
      });
      f.pass({ target: this.canvasSurface, clear: BLACK }, (pass) => pass.draw(fx.composite));
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeResize();
    destroy(this.sized.sceneA, this.sized.sceneB, this.sized.planet, ...this.sized.bloom, this.maps.surface, this.maps.clouds, this.patch);
    this.gpu.dispose();
  }
}
