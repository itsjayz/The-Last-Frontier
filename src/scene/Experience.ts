import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Earth } from './background/Earth';
import { Sky, Sun } from './background/Sky';
import { FallbackHole } from './background/FallbackHole';
import { Astronaut } from './Astronaut';
import { FilmShader } from './post/FilmShader';
import { additiveLight } from './blending';
import { CHAPTERS, type Chapter } from './chapters';
import type { ScenePass, VgpuStage } from './vgpu/VgpuStage';

/**
 * The continuous journey, one camera throughout.
 *
 * Layers, back to front:
 *  1. vgpu black hole (WebGPU canvas behind this one) — Chapter 02 onwards;
 *  2. background (this canvas): stars, Earth and sun at "infinite" distance —
 *     the background camera sits at the origin so they never parallax against
 *     the astronaut, as in reality;
 *  3. foreground (this canvas): the astronaut and the light that reaches them.
 * This canvas is transparent where nothing solid is drawn; glows add light
 * without coverage (see blending.ts), so they sit naturally over layer 1.
 *
 * Chapter 01 — Departure: the sun breaks over Earth's limb as home recedes.
 * Chapter 02 — The Crossing: the camera swings round to a gravitational
 *   anomaly; it grows from a point of light to fill the frame; then (transit)
 *   we dive through its ring into a wormhole, rush through, and the distortion
 *   dissolves into a new system.
 * Chapter 03 — Discovery: an Earth-like world grows ahead.
 * Chapter 04 — Arrival: high-altitude top shots of its landscape (never close).
 * Chapter 05 — Possibility: the view holds and widens for the invitation.
 */

/** Composition, expressed in screen terms relative to the opening camera. */
const COMPOSITION = {
  fov: 30,
  // Direction to Earth's centre in the opening camera's view space (lower-left).
  earthViewDir: new THREE.Vector3(-0.36, -0.3, -1),
  // The sun sits this many degrees from Earth's centre, towards the upper right.
  sunOffsetDeg: 13.5,
  sunOffsetTowards: new THREE.Vector3(0.62, 0.78, 0),
  // Cinematic cheat: Earth is shaded as if the sun were this many degrees further
  // round, so a broad daylit crescent (oceans, clouds) shows beside the night
  // side's city lights. With the true geometry — sun just behind the limb —
  // only a hairline would be lit. The astronaut is lit by the true sun.
  earthLightLeadDeg: 55,
  earthDistance: [3.3, 9.0] as const,
  camera: {
    from: { pos: new THREE.Vector3(0, 0.1, 6.2), target: new THREE.Vector3(-0.55, -0.12, 0) },
    to: { pos: new THREE.Vector3(0.35, 0.6, 8.8), target: new THREE.Vector3(-0.85, -0.05, -1.2) },
  },
  astronaut: {
    from: new THREE.Vector3(0, 0, 0),
    to: new THREE.Vector3(0.4, 0.3, -1.5),
    yawOffsetDeg: [38, 62] as const,
  },
  crossing: {
    // Where the anomaly lies, in the end-of-Departure camera's view space:
    // off to the right, into the dark the astronaut has been drifting towards.
    viewDir: new THREE.Vector3(0.85, 0.06, -0.55),
    // Distance in event-horizon radii: a point of light → filling the frame.
    distance: [900, 30] as const,
    // Final camera, relative to the astronaut: behind and a little above.
    cameraBehind: 5.0,
    cameraAbove: 0.35,
    cameraSide: 1.6,
    // Where the camera looks: past the astronaut, offset so the hole sits right of
    // centre and the astronaut stays lower-left, silhouetted against its glow.
    lookAhead: 6,
    lookUp: 1.0,
    lookSide: 1.5,
    // How far the astronaut is drawn towards the hole across the chapter (m).
    pull: 1.6,
    // Tilt of the disk towards camera (degrees), so its top face just shows.
    diskTiltDeg: 7,
    // Transit opens with a dive through the photon ring (horizon radii).
    diveTo: 3.4,
  },
  planet: {
    // Slightly off the wormhole's axis, so the world drifts into place.
    yawDeg: 3,
    // Distance in planet radii: emerging from the tunnel → orbit → top-shot altitude.
    distance: [140, 5.5, 1.48] as const,
    // Baked top-shot patch half-extent (tan of the angle on the sphere).
    patchHalfTan: 0.3,
    // Orbit the view over the planet (degrees up, right) so Arrival looks down on
    // a continent rather than open ocean.
    viewOrbitDeg: [31, -10] as const,
  },
};

/** Camera framings relative to the astronaut, blended between chapters. */
interface Rig {
  behind: number;
  above: number;
  side: number;
  lookAhead: number;
  lookUp: number;
  lookSide: number;
}
const RIGS: Record<'crossingEnd' | 'transit' | 'discovery' | 'arrival', Rig> = {
  crossingEnd: { behind: 5.0, above: 0.35, side: 1.6, lookAhead: 6, lookUp: 1.0, lookSide: 1.5 },
  transit: { behind: 4.8, above: 0.45, side: 0.0, lookAhead: 6, lookUp: 1.1, lookSide: 0.0 },
  discovery: { behind: 4.6, above: 0.4, side: 1.3, lookAhead: 6, lookUp: 0.9, lookSide: 1.4 },
  arrival: { behind: 6.2, above: 1.5, side: 0.5, lookAhead: 8, lookUp: 1.9, lookSide: 1.2 },
};
const lerpRig = (a: Rig, b: Rig, t: number): Rig => ({
  behind: THREE.MathUtils.lerp(a.behind, b.behind, t),
  above: THREE.MathUtils.lerp(a.above, b.above, t),
  side: THREE.MathUtils.lerp(a.side, b.side, t),
  lookAhead: THREE.MathUtils.lerp(a.lookAhead, b.lookAhead, t),
  lookUp: THREE.MathUtils.lerp(a.lookUp, b.lookUp, t),
  lookSide: THREE.MathUtils.lerp(a.lookSide, b.lookSide, t),
});

const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOut = (x: number) => x * x * (3 - 2 * x);
const UP = new THREE.Vector3(0, 1, 0);

export type { Chapter };

export interface ExperienceOptions {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
}

export class Experience {
  readonly renderer: THREE.WebGLRenderer;
  readonly ready: Promise<void>;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly bgCamera: THREE.PerspectiveCamera;
  private readonly fgScene = new THREE.Scene();
  private readonly bgScene = new THREE.Scene();
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly film: ShaderPass;
  private readonly earth: Earth;
  private readonly sky: Sky;
  private readonly sun: Sun;
  private readonly fallbackHole = new FallbackHole();
  private readonly astronaut: Astronaut;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly limbLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly timer = new THREE.Timer();
  private readonly reducedMotion: boolean;
  private readonly earthDir = new THREE.Vector3();
  private readonly sunDir = new THREE.Vector3();
  private readonly earthLightDir = new THREE.Vector3();
  private readonly holeDir = new THREE.Vector3();
  /** Black-hole frame: disk plane = xz. Columns are world-space axes. */
  private readonly holeBasis = new THREE.Matrix3();
  private envTarget: THREE.WebGLRenderTarget;
  private stage: { gpu: VgpuStage; canvas: HTMLCanvasElement } | null = null;
  private readonly progress = Object.fromEntries(CHAPTERS.map((c) => [c, 0])) as Record<Chapter, number>;
  private readonly targetProgress = Object.fromEntries(CHAPTERS.map((c) => [c, 0])) as Record<Chapter, number>;
  private readonly planetDir = new THREE.Vector3();
  private readonly planetLight = new THREE.Vector3();
  /** Rotates the camera about the planet (planet frame), choosing which region we arrive over. */
  private readonly planetOrbit = new THREE.Quaternion();
  private patchSpec!: {
    nadir: [number, number, number];
    east: [number, number, number];
    north: [number, number, number];
    light: [number, number, number];
    halfTan: number;
    zoomAtHandoff: number;
  };
  private travel = 0;
  /** Eased journey position: 0 = opening, CHAPTERS.length = the end. */
  private journey = 0;
  private fallbackPlanet: Earth | null = null;
  private readonly coolLight = new THREE.Color(0.7, 0.82, 1.0);
  private readonly starLight = new THREE.Color(1.0, 0.96, 0.9);
  private disposed = false;
  private readonly tmp = {
    v: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    v3: new THREE.Vector3(),
    q: new THREE.Quaternion(),
    q2: new THREE.Quaternion(),
    c: new THREE.Color(),
    m: new THREE.Matrix4(),
  };
  private readonly warmDisk = new THREE.Color(1.0, 0.7, 0.42);
  private readonly sunColor = new THREE.Color(0xfff2e2);
  private readonly limbWarm = new THREE.Color(1.0, 0.62, 0.42);

  constructor({ canvas, reducedMotion }: ExperienceOptions) {
    this.reducedMotion = reducedMotion;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(COMPOSITION.fov, aspect, 0.1, 100);
    this.bgCamera = new THREE.PerspectiveCamera(COMPOSITION.fov, aspect, 0.05, 200);

    // World directions are fixed from screen-space composition, using the
    // landscape cameras at the start and end of Departure.
    this.composeDeparture(0, 0);
    this.camera.updateMatrixWorld();
    this.earthDir.copy(COMPOSITION.earthViewDir).normalize().applyQuaternion(this.camera.quaternion);
    const towards = this.tmp.v.copy(COMPOSITION.sunOffsetTowards).applyQuaternion(this.camera.quaternion);
    const axis = new THREE.Vector3().crossVectors(this.earthDir, towards).normalize();
    this.sunDir.copy(this.earthDir).applyAxisAngle(axis, THREE.MathUtils.degToRad(COMPOSITION.sunOffsetDeg)).normalize();
    this.earthLightDir.copy(this.sunDir).applyAxisAngle(axis, THREE.MathUtils.degToRad(COMPOSITION.earthLightLeadDeg)).normalize();
    this.composeDeparture(1, 0);
    this.camera.updateMatrixWorld();
    this.holeDir.copy(COMPOSITION.crossing.viewDir).normalize().applyQuaternion(this.camera.quaternion);
    this.buildHoleBasis();
    this.buildPlanetFrame();

    // Background layer.
    this.sky = new Sky(renderer.getPixelRatio());
    this.earth = new Earth(renderer);
    this.sun = new Sun();
    this.bgScene.add(this.sky.group, this.earth.group, this.sun.mesh, this.fallbackHole.mesh);
    this.layoutBackground(0);

    // Reflections for the visor/metal: a blurred capture of the background layer.
    this.envTarget = this.captureEnvironment();
    this.fgScene.environmentIntensity = 1.0;

    // Foreground light, all motivated by the background.
    this.keyLight = new THREE.DirectionalLight(0xfff2e2, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    // Generous biases: the suit turns slowly through the light, and tight biases make
    // self-shadow acne crawl across it (reads as flicker when idle).
    this.keyLight.shadow.bias = -0.0008;
    this.keyLight.shadow.normalBias = 0.045;
    Object.assign(this.keyLight.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 0.1, far: 14 });
    this.limbLight = new THREE.DirectionalLight(0x8fb0ff, 1);
    this.fillLight = new THREE.DirectionalLight(0x9db4d8, 0.1);
    this.fgScene.add(this.keyLight, this.keyLight.target, this.limbLight, this.limbLight.target, this.fillLight, this.fillLight.target);

    this.astronaut = new Astronaut({ renderer, reducedMotion });
    this.fgScene.add(this.astronaut.root);
    this.composeDeparture(0, 0);
    this.ready = Promise.all([
      this.astronaut.ready,
      // Once the real surface is in, recapture reflections so the visor sees Earth.
      this.earth.ready.then(() => {
        if (this.disposed) return;
        this.envTarget.dispose();
        this.envTarget = this.captureEnvironment();
      }),
    ]).then(() => undefined);
    this.fitFov();
    this.camera.updateProjectionMatrix();
    this.bgCamera.updateProjectionMatrix();

    // Post: background → foreground (depth cleared) → bloom (HDR) → tone map → film finish.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.bgScene, this.bgCamera));
    const fgPass = new RenderPass(this.fgScene, this.camera);
    fgPass.clear = false;
    fgPass.clearDepth = true;
    this.composer.addPass(fgPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.32, 0.35, 1.0);
    additiveLight((this.bloom as unknown as { blendMaterial: THREE.Material }).blendMaterial);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass(FilmShader);
    this.film.uniforms.uAspect.value = aspect;
    this.composer.addPass(this.film);

    this.timer.connect(document);
    renderer.setAnimationLoop(this.tick);
  }

  /** Narrative progress per chapter, 0–1. Smoothed internally unless reduced motion. */
  setProgress(chapter: Chapter, p: number) {
    this.targetProgress[chapter] = THREE.MathUtils.clamp(p, 0, 1);
  }

  /** Where scroll says the journey is: completed chapters + progress in the current one. */
  private journeyTarget() {
    let sum = 0;
    for (const ch of CHAPTERS) sum += this.targetProgress[ch];
    return sum;
  }

  /** Jump straight to the current targets (used by "Return to Earth"), skipping the glide. */
  snapProgress() {
    this.journey = this.journeyTarget();
    this.travel = 0;
  }

  /** Attach the vgpu stage (absent where WebGPU is unavailable). */
  setStage(gpu: VgpuStage, canvas: HTMLCanvasElement) {
    this.stage = { gpu, canvas };
    gpu.preparePatch(this.patchSpec);
  }

  /**
   * Fixes the new world's direction, its star, and the top-shot patch: the
   * surface beneath the centre of the Arrival frame, oriented to that camera,
   * so the globe → top-shot hand-off lines up.
   */
  private buildPlanetFrame() {
    const k = COMPOSITION.planet;
    this.planetDir.copy(this.holeDir).applyAxisAngle(UP, THREE.MathUtils.degToRad(k.yawDeg)).normalize();
    const side = new THREE.Vector3().crossVectors(this.planetDir, UP).normalize();
    // Star behind-left of the camera: a gibbous world, its daylit face towards us.
    this.planetLight.copy(this.planetDir).multiplyScalar(-0.6).addScaledVector(UP, 0.45).addScaledVector(side, -0.66).normalize();

    // Orbit about the axes of the arrival view: up/down about its right, left/right about its up.
    const [orbitUp, orbitRight] = k.viewOrbitDeg;
    const rig = RIGS.arrival;
    const camPos = new THREE.Vector3().copy(this.planetDir).multiplyScalar(-rig.behind).addScaledVector(UP, rig.above).addScaledVector(side, rig.side);
    const target = new THREE.Vector3().copy(this.planetDir).multiplyScalar(rig.lookAhead).addScaledVector(UP, rig.lookUp).addScaledVector(side, rig.lookSide);
    const view = new THREE.Vector3().subVectors(target, camPos).normalize();
    const right = new THREE.Vector3().crossVectors(view, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, view).normalize();
    this.planetOrbit
      .setFromAxisAngle(right, THREE.MathUtils.degToRad(orbitUp))
      .premultiply(new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(orbitRight)));
    view.applyQuaternion(this.planetOrbit);
    right.applyQuaternion(this.planetOrbit);
    up.applyQuaternion(this.planetOrbit);
    // Where the view's centre ray meets the sphere at hand-off distance (planet frame).
    const dist = k.distance[2];
    const o = new THREE.Vector3().copy(this.planetDir).multiplyScalar(-dist).applyQuaternion(this.planetOrbit);
    const b = o.dot(view);
    const tHit = -b - Math.sqrt(Math.max(b * b - (o.lengthSq() - 1), 0));
    const nadir = o.addScaledVector(view, tHit).normalize();
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(COMPOSITION.fov) / 2);
    const arr = (v: THREE.Vector3) => [v.x, v.y, v.z] as [number, number, number];
    this.patchSpec = {
      nadir: arr(nadir),
      east: arr(right),
      north: arr(up),
      light: arr(this.planetLight),
      halfTan: k.patchHalfTan,
      zoomAtHandoff: ((dist - 1) * tanHalf) / k.patchHalfTan,
    };
  }

  private buildHoleBasis() {
    // Disk normal ≈ world up, tipped towards the viewer so the top face shows.
    const toViewer = this.tmp.v.copy(this.holeDir).negate();
    const y = this.tmp.v2.copy(UP).addScaledVector(toViewer, Math.tan(THREE.MathUtils.degToRad(COMPOSITION.crossing.diskTiltDeg))).normalize();
    const x = new THREE.Vector3().crossVectors(y, toViewer).normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    this.holeBasis.set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
  }

  private captureEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(this.bgScene, 0.03, 0.05, 150);
    pmrem.dispose();
    this.fgScene.environment = target.texture;
    return target;
  }

  get debugEarth() {
    return this.earth;
  }

  /** 0 on landscape screens, rising to 1 on tall phone screens. */
  private portraitFactor() {
    return THREE.MathUtils.clamp((1 / this.camera.aspect - 1) / 1.1, 0, 1);
  }

  /** Widen the vertical field of view on portrait screens so the frame keeps some breadth. */
  private fitFov() {
    this.camera.fov = this.bgCamera.fov = COMPOSITION.fov + 24 * this.portraitFactor();
  }

  resize(width: number, height: number) {
    this.camera.aspect = this.bgCamera.aspect = width / height;
    this.fitFov();
    this.camera.updateProjectionMatrix();
    this.bgCamera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.resolution.set(width / 2, height / 2);
    this.film.uniforms.uAspect.value = width / height;
    this.sky.setPixelRatio(this.renderer.getPixelRatio());
  }

  /** Development aid: hold the camera at an arbitrary view (null to release). */
  debugView: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  get debugAstronaut() {
    return this.astronaut;
  }

  /** Camera and astronaut for Departure at progress p (writes camera + astronaut root). */
  private composeDeparture(p: number, time: number) {
    const e = easeInOut(p);
    const { from, to } = COMPOSITION.camera;
    const pos = this.tmp.v.lerpVectors(from.pos, to.pos, e);
    if (!this.reducedMotion) {
      // Barely-there float, as if the camera were also adrift.
      pos.x += Math.sin(time * 0.11) * 0.035 + Math.sin(time * 0.047) * 0.02;
      pos.y += Math.sin(time * 0.083 + 1.1) * 0.025;
    }
    this.camera.position.copy(pos);
    const target = this.tmp.v2.lerpVectors(from.target, to.target, e);

    if (this.astronaut) {
      const { from: a0, to: a1, yawOffsetDeg } = COMPOSITION.astronaut;
      const root = this.astronaut.root;
      root.position.lerpVectors(a0, a1, e);
      // Face towards home, seen three-quarters from behind; slowly turn away from it.
      root.lookAt(this.tmp.v3.copy(root.position).add(this.earthDir));
      root.rotateY(THREE.MathUtils.degToRad(THREE.MathUtils.lerp(yawOffsetDeg[0], yawOffsetDeg[1], e)));
      root.rotateZ(THREE.MathUtils.degToRad(-12));
      // Narrow screens: re-centre on the astronaut (see also fitFov).
      const k = this.portraitFactor();
      if (k > 0) target.lerp(root.position, 0.7 * k * (1 - 0.75 * e));
    }
    this.camera.lookAt(target);
    return target;
  }

  /**
   * Layers the Crossing on top of Departure's end state. `turn` swings the camera
   * round behind the astronaut to face the anomaly; `approach` draws everything in.
   */
  private composeCrossing(c: number, departureTarget: THREE.Vector3) {
    const k = COMPOSITION.crossing;
    const turn = smoothstep(0.0, 0.42, c);
    const approach = smoothstep(0.18, 1.0, c);
    const root = this.astronaut.root;

    // Astronaut: drawn towards the hole, turning to face it (back to camera).
    const startPos = this.tmp.v3.copy(root.position);
    const startQuat = this.tmp.q.copy(root.quaternion);
    root.position.addScaledVector(this.holeDir, k.pull * approach * approach);
    root.lookAt(this.tmp.v.copy(root.position).add(this.holeDir));
    root.rotateX(THREE.MathUtils.degToRad(-8)); // lean slightly into the fall
    root.quaternion.copy(this.tmp.q2.copy(startQuat).slerp(root.quaternion, turn));

    // Camera: orbit the astronaut from the Departure view to behind them.
    const side = this.tmp.v.crossVectors(this.holeDir, UP).normalize();
    const endOffset = this.tmp.v2
      .copy(this.holeDir)
      .multiplyScalar(-k.cameraBehind)
      .addScaledVector(UP, k.cameraAbove)
      .addScaledVector(side, k.cameraSide);
    const startOffset = this.camera.position.clone().sub(startPos);
    const startLen = startOffset.length();
    const endLen = endOffset.length();
    const swing = this.tmp.q2.setFromUnitVectors(startOffset.normalize(), endOffset.normalize());
    const offset = startOffset.applyQuaternion(this.tmp.q.identity().slerp(swing, turn)).multiplyScalar(THREE.MathUtils.lerp(startLen, endLen, turn));
    this.camera.position.copy(root.position).add(offset);

    // Look past the astronaut towards the hole, framing it a little above them.
    const sideDir = this.tmp.v3.crossVectors(this.holeDir, UP).normalize();
    const endTarget = this.tmp.v
      .copy(root.position)
      .addScaledVector(this.holeDir, k.lookAhead)
      .addScaledVector(UP, k.lookUp)
      .addScaledVector(sideDir, k.lookSide);
    this.camera.lookAt(departureTarget.lerp(endTarget, turn));
    return { turn, approach };
  }

  /** Transit → Discovery → Arrival → Possibility, as blended camera rigs. */
  private composeJourney(t: number, d: number, a: number, s: number, time: number) {
    const root = this.astronaut.root;
    let rig = lerpRig(RIGS.crossingEnd, RIGS.transit, smoothstep(0, 0.25, t));
    rig = lerpRig(rig, RIGS.discovery, smoothstep(0, 0.35, d));
    rig = lerpRig(rig, RIGS.arrival, smoothstep(0, 0.6, a));
    // Portrait screens: pull back and centre, so the astronaut stays in a narrow frame.
    const k = this.portraitFactor();
    rig = { ...rig, behind: rig.behind + 1.6 * k, side: rig.side * (1 - 0.6 * k), lookSide: rig.lookSide * (1 - 0.85 * k) };
    const dir = this.tmp.v3.copy(this.holeDir).lerp(this.planetDir, smoothstep(0.85, 1, t)).normalize();
    const side = this.tmp.v2.crossVectors(dir, UP).normalize();

    // Astronaut: faces the way ahead; in Arrival leans forward, looking down at the world.
    root.lookAt(this.tmp.v.copy(root.position).add(dir));
    root.rotateX(THREE.MathUtils.degToRad(-8 + 30 * smoothstep(0, 0.7, a)));

    const shake = this.reducedMotion ? 0 : 0.012 * this.transitSpeed(t);
    this.camera.position
      .copy(root.position)
      .addScaledVector(dir, -rig.behind)
      .addScaledVector(UP, rig.above + Math.sin(time * 37) * shake)
      .addScaledVector(side, rig.side + Math.sin(time * 29 + 1) * shake);
    // Possibility: the slowest of drifts, so the final view keeps breathing.
    const drift = this.reducedMotion ? 0 : s * 0.25 * Math.sin(time * 0.05);
    this.camera.lookAt(
      this.tmp.v.copy(root.position).addScaledVector(dir, rig.lookAhead).addScaledVector(UP, rig.lookUp).addScaledVector(side, rig.lookSide + drift),
    );
  }

  /** Tunnel speed profile across Transit (0..1). */
  private transitSpeed(t: number) {
    return smoothstep(0.15, 0.35, t) * (1 - smoothstep(0.72, 0.92, t));
  }

  private layoutBackground(p: number) {
    const [near, far] = COMPOSITION.earthDistance;
    const distance = near + (far - near) * p * p;
    this.earth.group.position.copy(this.earthDir).multiplyScalar(distance);
    return distance;
  }

  private holePass(distance: number): ScenePass {
    // World → hole frame is the transpose of the (orthonormal) basis.
    const toHole = this.tmp.m.identity().setFromMatrix3(this.holeBasis).transpose();
    const asHole = (v: THREE.Vector3) => {
      const w = v.clone().applyMatrix4(toHole);
      return [w.x, w.y, w.z] as const;
    };
    const e = this.bgCamera.matrixWorld.elements;
    return {
      kind: 'blackhole',
      view: {
        position: asHole(this.tmp.v.copy(this.holeDir).multiplyScalar(-distance)),
        right: asHole(this.tmp.v.set(e[0], e[1], e[2]).normalize()),
        up: asHole(this.tmp.v.set(e[4], e[5], e[6]).normalize()),
        forward: asHole(this.tmp.v.set(-e[8], -e[9], -e[10]).normalize()),
        tanHalfFov: Math.tan(THREE.MathUtils.degToRad(this.bgCamera.fov) / 2),
      },
      diskGain: 1,
    };
  }

  private planetPass(distance: number): ScenePass {
    const e = this.bgCamera.matrixWorld.elements;
    const q = this.tmp.q.copy(this.bgCamera.quaternion).premultiply(this.planetOrbit);
    const unit = (x: number, y: number, z: number) => {
      const v = this.tmp.v.set(x, y, z).applyQuaternion(this.planetOrbit).normalize();
      return [v.x, v.y, v.z] as const;
    };
    const pos = this.tmp.v2.copy(this.planetDir).multiplyScalar(-distance).applyQuaternion(this.planetOrbit);
    return {
      kind: 'planet',
      camera: {
        position: [pos.x, pos.y, pos.z],
        quaternion: [q.x, q.y, q.z, q.w],
        fov: this.bgCamera.fov,
        right: unit(e[0], e[1], e[2]),
        up: unit(e[4], e[5], e[6]),
        forward: unit(-e[8], -e[9], -e[10]),
      },
      light: [this.planetLight.x, this.planetLight.y, this.planetLight.z],
    };
  }

  /** Planet radii: out of the tunnel → orbit (Discovery) → top-shot altitude (Arrival). */
  private planetDistance(d: number, a: number) {
    const [far, orbit, low] = COMPOSITION.planet.distance;
    const logLerp = (x: number, y: number, k: number) => Math.exp(THREE.MathUtils.lerp(Math.log(x), Math.log(y), k));
    return a > 0 ? logLerp(orbit, low, easeInOut(Math.min(1, a / 0.62))) : logLerp(far, orbit, easeInOut(d));
  }

  private topShotPass(a: number, s: number, time: number): ScenePass {
    const ps = this.patchSpec;
    // Settle a little lower after the hand-off, then widen for the final view. Never close.
    // The view samples the square baked patch at its true proportions: width =
    // zoom × aspect, height = zoom (patch units). Cap zoom so wide screens stay inside it.
    const aspect = this.bgCamera.aspect;
    const zoom = Math.min(
      THREE.MathUtils.lerp(ps.zoomAtHandoff, ps.zoomAtHandoff * 0.62, smoothstep(0.6, 1, a)) * THREE.MathUtils.lerp(1, 1.3, easeInOut(s)),
      0.94 / Math.max(aspect, 1),
    );
    // Pan and cloud drift are slow oscillations bounded by the free margin around the
    // view, so the camera never leaves the baked patch however long the page is open
    // (an ever-growing pan ran past the edge and smeared edge pixels into streaks).
    const marginX = Math.max(0, 0.5 - 0.5 * zoom * aspect - 0.02);
    const marginY = Math.max(0, 0.5 - 0.5 * zoom - 0.02);
    const still = this.reducedMotion ? 0 : 1;
    const panX = THREE.MathUtils.clamp(still * Math.sin(time * 0.012) * 0.5 * marginX + s * 0.3 * marginX, -marginX, marginX);
    const panY = THREE.MathUtils.clamp(still * Math.sin(time * 0.009 + 1.3) * 0.4 * marginY, -marginY, marginY);
    const driftX = still * Math.sin(time * 0.006) * 0.04;
    // Cloud shadows fall away from the star, projected onto the patch.
    const dot = (u: readonly number[], v: readonly number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    return {
      kind: 'topshot',
      zoom,
      pan: [panX, panY],
      drift: [driftX, 0],
      shadow: [-dot(ps.light, ps.east) * 0.006, dot(ps.light, ps.north) * 0.006],
      sun: 1.9,
      haze: 0.22,
    };
  }

  /** Chooses what the vgpu stage draws this frame: one scene, two during hand-offs. */
  private renderVgpu(c: number, t: number, d: number, a: number, s: number, approach: number, time: number) {
    const st = this.stage;
    const visible = smoothstep(0.02, 0.22, c);
    const [holeFar, holeNear] = COMPOSITION.crossing.distance;
    const holeDistance =
      t > 0
        ? Math.exp(THREE.MathUtils.lerp(Math.log(holeNear), Math.log(COMPOSITION.crossing.diveTo), easeInOut(Math.min(1, t / 0.22))))
        : Math.exp(THREE.MathUtils.lerp(Math.log(holeFar), Math.log(holeNear), easeInOut(c)));

    if (!st) {
      this.renderFallback(t, d, a, holeDistance, visible);
      return;
    }
    this.fallbackHole.mesh.visible = false;
    st.canvas.style.opacity = visible.toFixed(3);
    this.sky.setIntensity(1 - visible);
    // The top-shot patch bakes a strip per frame from the start, long before it's needed.
    if (!st.gpu.patchReady) st.gpu.bakeStep();
    if (visible <= 0) return;

    // Tunnel travel keeps moving while in transit (time) and with scroll.
    const speed = this.transitSpeed(t);
    if (!this.reducedMotion && t > 0.05 && t < 0.98) this.travel += (1 / 60) * (0.3 + speed * 4.0);
    const wormhole: ScenePass = {
      kind: 'wormhole',
      travel: this.reducedMotion ? t * 18 : this.travel + t * 6,
      speed,
      warp: smoothstep(0.08, 0.24, t) * (1 - smoothstep(0.78, 0.97, t)),
      exitGlow: smoothstep(0.5, 0.92, t),
      heat: 1 - smoothstep(0.18, 0.5, t),
    };
    const planetDistance = this.planetDistance(d, a);
    const holeExposure = THREE.MathUtils.lerp(1, 0.8, approach) * (1 - t * 0.8);

    let frame: Parameters<VgpuStage['render']>[0];
    if (t < 0.22) {
      frame = { primary: this.holePass(holeDistance), secondary: wormhole, mix: smoothstep(0.1, 0.22, t), distort: 0, exposure: holeExposure, time };
    } else if (t < 0.98 && d <= 0) {
      const m = smoothstep(0.8, 0.98, t);
      frame = { primary: wormhole, secondary: this.planetPass(planetDistance), mix: m, distort: 1 - m, exposure: 1.1, time };
    } else if (a < 0.82 || !st.gpu.patchReady) {
      const m = st.gpu.patchReady ? smoothstep(0.55, 0.82, a) : 0;
      frame = { primary: this.planetPass(planetDistance), secondary: this.topShotPass(a, s, time), mix: m, distort: 0, exposure: 1.3, time };
    } else {
      frame = { primary: this.topShotPass(a, s, time), exposure: 1.0, time };
    }
    st.gpu.render(frame);
  }

  /** Without WebGPU: Three.js stand-ins (no lensing, no tunnel); the story still reads. */
  private renderFallback(t: number, d: number, a: number, holeDistance: number, visible: number) {
    this.fallbackHole.update(this.bgCamera.position, this.holeDir, this.bgCamera, holeDistance, visible * (1 - smoothstep(0.1, 0.3, t)));
    if (t > 0.7 || d > 0 || a > 0) {
      if (!this.fallbackPlanet) {
        this.fallbackPlanet = new Earth(this.renderer, { procedural: true });
        this.bgScene.add(this.fallbackPlanet.group);
      }
      this.fallbackPlanet.group.position.copy(this.planetDir).multiplyScalar(this.planetDistance(d, a));
      this.fallbackPlanet.update(0, this.planetLight, this.bgCamera.position);
    }
  }

  private tick = (time?: number) => {
    if (this.disposed) return;
    this.timer.update(time);
    const dt = Math.min(this.timer.getDelta(), 1 / 20);
    const t = this.timer.getElapsed();

    if (!this.reducedMotion) {
      // One continuous journey position (0..chapters), eased as a whole. Each
      // chapter's progress is derived from it, so chapters can never disagree —
      // easing them separately let a later chapter linger while scrolling back,
      // overriding the earlier shot (the astronaut never turning back to Earth).
      const target = this.journeyTarget();
      const next = THREE.MathUtils.damp(this.journey, target, 2.6, dt);
      // Land exactly on the target: damping alone never quite gets there.
      this.journey = Math.abs(next - target) < 1e-4 ? target : next;
    } else {
      this.journey = this.journeyTarget();
    }
    CHAPTERS.forEach((ch, i) => (this.progress[ch] = THREE.MathUtils.clamp(this.journey - i, 0, 1)));
    const p = this.progress.departure;
    const c = this.progress.crossing;
    const tr = this.progress.transit;
    const d = this.progress.discovery;
    const a = this.progress.arrival;
    const s = this.progress.possibility;
    const journey = tr > 0 || d > 0 || a > 0 || s > 0;

    let turn = 0;
    let approach = 0;
    if (this.debugView) {
      this.camera.position.copy(this.debugView.pos);
      this.camera.lookAt(this.debugView.target);
    } else {
      const departureTarget = this.composeDeparture(p, t).clone();
      if (c > 0) ({ turn, approach } = this.composeCrossing(c, departureTarget));
      if (journey) this.composeJourney(tr, d, a, s, t);
    }
    this.bgCamera.quaternion.copy(this.camera.quaternion);
    this.astronaut.update(dt);

    const earthDistance = this.layoutBackground(p);
    // How much of the sun's disc has cleared Earth's limb (as seen from here).
    const earthAngular = Math.asin(Math.min(1, 1.02 / earthDistance));
    const sunAngle = this.earthDir.angleTo(this.sunDir);
    const visibility = smoothstep(earthAngular - 0.012, earthAngular + 0.03, sunAngle);

    this.bgCamera.updateMatrixWorld();
    // Home and its sun leave the frame during the turn; stop drawing them after.
    this.earth.group.visible = c < 0.5;
    this.sun.mesh.visible = c < 0.5;
    this.earth.update(dt, this.earthLightDir, this.bgCamera.position);
    this.sun.update(this.bgCamera.position, this.sunDir, this.bgCamera);
    this.sky.group.position.copy(this.bgCamera.position);

    // Light on the astronaut follows what the background shows: the sun and
    // Earth's limb in Departure → the disk's glow → the tunnel → the new star.
    const target = this.astronaut.root.position;
    const tunnel = smoothstep(0.12, 0.3, tr) * (1 - smoothstep(0.85, 1, tr));
    const newStar = d > 0 || a > 0 || s > 0 ? 1 : smoothstep(0.85, 1, tr);
    const keyDir = this.tmp.v.copy(this.sunDir).lerp(this.holeDir, turn).lerp(this.planetLight, newStar).normalize();
    const flicker = this.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(t * 23) * Math.sin(t * 7.1);
    let keyIntensity = THREE.MathUtils.lerp(0.15 + 5.2 * visibility, 0.6 + 5.5 * approach, turn);
    keyIntensity = THREE.MathUtils.lerp(keyIntensity, (1 + 3 * this.transitSpeed(tr)) * flicker, tunnel);
    keyIntensity = THREE.MathUtils.lerp(keyIntensity, 3.4, newStar);
    this.keyLight.intensity = keyIntensity;
    this.keyLight.color.copy(this.sunColor).lerp(this.warmDisk, turn).lerp(this.coolLight, tunnel).lerp(this.starLight, newStar);
    this.keyLight.position.copy(target).addScaledVector(keyDir, 6);
    this.keyLight.target.position.copy(target);
    // The limb light returns as soft blue bounce from the new world below.
    const worldBounce = smoothstep(0.3, 1, d) * 0.5 + smoothstep(0, 0.6, a) * 0.5;
    this.limbLight.intensity = 1.6 * (1 - 0.55 * visibility) * (1 - turn) + 0.9 * worldBounce;
    this.limbLight.color.setRGB(0.55, 0.69, 1.0).lerp(this.limbWarm, 0.35 * (1 - visibility) * (1 - turn));
    this.limbLight.position.copy(target).addScaledVector(worldBounce > 0 ? this.planetDir : this.earthDir, 6);
    this.limbLight.target.position.copy(target);
    this.fillLight.intensity = THREE.MathUtils.lerp(0.1, 0.08, turn) + 0.1 * newStar;
    this.fillLight.position.copy(this.camera.position).add(this.tmp.v.set(2, 1.5, 0));
    this.fillLight.target.position.copy(target);
    // A touch of "auto-exposure" as the sun appears, and as the disk brightens.
    this.renderer.toneMappingExposure = (1.05 - 0.18 * visibility) * THREE.MathUtils.lerp(1, 0.85, approach * (1 - newStar));

    this.renderVgpu(c, tr, d, a, s, approach, t);
    this.film.uniforms.uTime.value = t;
    this.composer.render(dt);
  };

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.timer.dispose();
    this.astronaut.dispose();
    this.earth.dispose();
    this.sky.dispose();
    this.sun.dispose();
    this.fallbackHole.dispose();
    this.stage?.gpu.dispose();
    this.fallbackPlanet?.dispose();
    this.envTarget.dispose();
    this.keyLight.shadow.map?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
