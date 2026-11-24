import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const ASTRONAUT_URL = '/models/astronaut/lod0.glb';
/** Approximate centre of mass above the model origin (between the feet). */
const CENTER_OF_MASS_Y = 0.98;

type Euler3 = [number, number, number];
/**
 * Zero-g "neutral body posture" — the relaxed pose bodies settle into in
 * microgravity (NASA-STD-3000): shoulders flexed and slightly abducted, elbows
 * bent, hips and knees flexed, head tipped forward. Degrees, bone-local XYZ,
 * layered on the idle clip.
 *
 * Rig conventions (verified by rendering test rotations): +X flexes shoulders,
 * hips, elbows, spine and neck forward; knees flex with −X; upper-arm
 * abduction is +Z on the left and −Z on the right.
 */
const NEUTRAL_POSTURE: Record<string, Euler3> = {
  upperarm_L: [30, 0, 30],
  upperarm_R: [24, 0, -36],
  forearm_L: [52, 0, 0],
  forearm_R: [60, 0, 0],
  thigh_L: [42, 0, 0],
  thigh_R: [30, 0, 0],
  calf_L: [-58, 0, 0],
  calf_R: [-44, 0, 0],
  spine: [6, 0, 0],
  chest: [4, 0, 0],
  neck: [14, 0, 0],
};

export interface AstronautOptions {
  renderer: THREE.WebGLRenderer;
  reducedMotion: boolean;
}

/**
 * The protagonist. Wraps the Tevy CC0 model in a pivot at its centre of mass
 * so drift and tumble rotate the body naturally rather than around its feet.
 */
export class Astronaut {
  /** Position/orient this group to place the astronaut (pivot = centre of mass). */
  readonly root = new THREE.Group();
  private readonly drift = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private model: THREE.Object3D | null = null;
  private readonly posture: Array<{ bone: THREE.Object3D; offset: THREE.Quaternion; inverse: THREE.Quaternion }> = [];
  private postureApplied = false;
  private readonly reducedMotion: boolean;
  private elapsed = 0;
  ready: Promise<void>;

  constructor({ renderer, reducedMotion }: AstronautOptions) {
    this.reducedMotion = reducedMotion;
    this.root.add(this.drift);
    const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
    const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
    this.ready = loader.loadAsync(ASTRONAUT_URL).then((gltf) => {
      ktx2.dispose();
      const model = gltf.scene;
      model.position.y = -CENTER_OF_MASS_Y;
      model.traverse((o) => {
        const mesh = o as THREE.SkinnedMesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.envMapIntensity = 0.55;
      });
      this.drift.add(model);

      this.model = model;
      this.setPosture(NEUTRAL_POSTURE);

      this.mixer = new THREE.AnimationMixer(model);
      const idle = gltf.animations.find((c) => c.name === 'idle');
      if (idle) {
        // Drop the root (hips) translation so the body doesn't sway as if standing.
        const clip = idle.clone();
        clip.tracks = clip.tracks.filter((t) => t.name !== 'hips.position');
        const action = this.mixer.clipAction(clip);
        action.timeScale = 0.55; // slower, heavier breathing
        // Ping-pong: the clip's first and last frames differ slightly, so a plain loop
        // pops every cycle (~9 s) — visible as a glitch when the page is left idle.
        action.setLoop(THREE.LoopPingPong, Infinity);
        action.play();
      }
      this.applyPosture();
    });
  }

  /** Replaces the posture offsets (degrees, bone-local XYZ). */
  setPosture(posture: Record<string, Euler3>) {
    if (!this.model) return;
    this.removePosture();
    this.posture.length = 0;
    for (const [name, [x, y, z]] of Object.entries(posture)) {
      const bone = this.model.getObjectByName(name);
      if (!bone) continue;
      const offset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z)),
      );
      this.posture.push({ bone, offset, inverse: offset.clone().invert() });
    }
  }

  private applyPosture() {
    for (const { bone, offset } of this.posture) bone.quaternion.multiply(offset);
    this.postureApplied = true;
  }

  /**
   * Removes last frame's posture, restoring the clip pose. Needed because the
   * mixer only rewrites a bone when its animated value changes — on frames where
   * it doesn't, the posture would otherwise be applied twice and the limb snap.
   */
  private removePosture() {
    if (!this.postureApplied) return;
    for (const { bone, inverse } of this.posture) bone.quaternion.multiply(inverse);
    this.postureApplied = false;
  }

  update(dt: number) {
    if (!this.mixer) return;
    this.removePosture();
    this.mixer.update(this.reducedMotion ? 0 : dt);
    this.applyPosture();
    if (this.reducedMotion) return;

    // Slow, inertial tumble: incommensurate low frequencies so it never visibly loops.
    this.elapsed += dt;
    const t = this.elapsed;
    this.drift.rotation.set(
      Math.sin(t * 0.071) * 0.16 + Math.sin(t * 0.023) * 0.08,
      Math.sin(t * 0.043) * 0.22,
      Math.sin(t * 0.057 + 1.3) * 0.12,
    );
    this.drift.position.set(Math.sin(t * 0.05) * 0.06, Math.sin(t * 0.083 + 0.4) * 0.05, Math.sin(t * 0.037) * 0.05);
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshStandardMaterial;
      for (const tex of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap]) tex?.dispose();
      mat.dispose();
    });
  }
}
