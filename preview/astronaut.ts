// TEMPORARY asset-evaluation page for the Tevy astronaut.
// Isolated from the main experience on purpose; delete once the astronaut asset is decided.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const MODEL_URL = '/models/astronaut/lod0.glb';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── Renderer / scene ────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020306);

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(2.6, 1.3, 4.2);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.95, 0);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 20;

// Faint environment so the visor/metal rings have something to reflect.
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTex;
scene.environmentIntensity = 0.08;

// Sparse starfield purely as spatial context (not a final visual).
{
  const n = 2500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(80);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa4b4, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.55 })));
}

// ── Lighting rigs ───────────────────────────────────────────────────────────
const key = new THREE.DirectionalLight(0xfff1e0, 3.2); // warm, hard "sun"
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.1, far: 20 });
const rim = new THREE.DirectionalLight(0x8fb4ff, 2.4); // cool back/rim
const fill = new THREE.HemisphereLight(0x223047, 0x050608, 0.25); // near-black bounce
scene.add(key, key.target, rim, rim.target, fill);

type Rig = 'interstellar' | 'rimonly' | 'soft';
function applyRig(r: Rig) {
  key.target.position.set(0, 0.95, 0);
  rim.target.position.set(0, 0.95, 0);
  if (r === 'interstellar') {
    key.position.set(4, 3, 2.5); key.intensity = 3.2; key.color.set(0xfff1e0);
    rim.position.set(-3, 2, -4); rim.intensity = 2.4;
    fill.intensity = 0.25;
  } else if (r === 'rimonly') {
    key.intensity = 0;
    rim.position.set(-2.5, 1.5, -4); rim.intensity = 4;
    fill.intensity = 0.05;
  } else {
    key.position.set(2, 4, 4); key.intensity = 1.6; key.color.set(0xffffff);
    rim.position.set(-3, 2, -3); rim.intensity = 1;
    fill.intensity = 1.2;
  }
}
applyRig('interstellar');

// ── Load model ──────────────────────────────────────────────────────────────
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);

const pivot = new THREE.Group(); // drift/tumble applied here, model stays untouched
scene.add(pivot);
let mixer: THREE.AnimationMixer | null = null;
let current: THREE.AnimationAction | null = null;
let skelHelper: THREE.SkeletonHelper | null = null;
let boxHelper: THREE.BoxHelper | null = null;
const axes = new THREE.AxesHelper(0.5);
axes.visible = false;
scene.add(axes);
const materials: THREE.MeshStandardMaterial[] = [];
const normalMaps = new Map<THREE.MeshStandardMaterial, THREE.Texture | null>();

loader.load(
  MODEL_URL,
  (gltf) => {
    console.log('[preview] model loaded');
    const model = gltf.scene;
    pivot.add(model);

    let tris = 0, verts = 0, meshes = 0;
    const texInfo: string[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false; // skinned bounds are bind-pose only
      const geo = m.geometry;
      verts += geo.attributes.position.count;
      tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
        if (materials.includes(mat)) continue;
        materials.push(mat);
        normalMaps.set(mat, mat.normalMap);
        for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) {
          const t = mat[k] as THREE.Texture | null;
          const img = t?.image as { width?: number; height?: number } | undefined;
          if (t) texInfo.push(`  ${k}: ${img?.width}×${img?.height}`);
        }
      }
    });

    // Measured, not trusted from metadata.
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model, true);
    const size = box.getSize(new THREE.Vector3());
    boxHelper = new THREE.BoxHelper(model, 0x445066);
    boxHelper.visible = false;
    scene.add(boxHelper);

    skelHelper = new THREE.SkeletonHelper(model);
    skelHelper.visible = false;
    scene.add(skelHelper);
    const bones = (skelHelper as unknown as { bones: THREE.Bone[] }).bones.length;

    $('stats').textContent =
      `meshes ${meshes} · materials ${materials.length}\n` +
      `verts ${verts.toLocaleString()} · tris ${tris.toLocaleString()}\n` +
      `bones ${bones} · clips ${gltf.animations.length}\n` +
      `size  ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m\n` +
      `min y ${box.min.y.toFixed(3)} (origin at feet?)\n` +
      `textures:\n${texInfo.join('\n')}`;

    // Clip selector
    mixer = new THREE.AnimationMixer(model);
    const clipsEl = $('clips');
    const options = ['(bind pose)', ...gltf.animations.map((c) => c.name)];
    options.forEach((name, i) => {
      const label = document.createElement('label');
      const clip = gltf.animations[i - 1];
      label.innerHTML = `<input type="radio" name="clip" value="${i}" ${name === 'idle' ? 'checked' : ''}/> ${name}${clip ? ` <span style="color:#555">${clip.duration.toFixed(2)}s</span>` : ''}`;
      label.querySelector('input')!.addEventListener('change', () => play(clip ?? null));
      clipsEl.appendChild(label);
    });
    play(gltf.animations.find((c) => c.name === 'idle') ?? null);
  },
  (e) => console.log('[preview] progress', e.loaded, e.total),
  (err) => {
    console.error('[preview] load error', err);
    const el = $('error');
    el.style.display = 'grid';
    el.textContent = `Failed to load ${MODEL_URL}: ${String(err)}`;
  },
);

// Exposed for automated screenshot checks only.
(window as unknown as Record<string, unknown>).__preview = { camera, controls, applyRig, play: (name: string) => {
  document.querySelectorAll<HTMLInputElement>('input[name=clip]').forEach((el) => {
    if (el.parentElement?.textContent?.trim().startsWith(name)) el.click();
  });
} };

function play(clip: THREE.AnimationClip | null) {
  if (!mixer) return;
  const next = clip ? mixer.clipAction(clip) : null;
  if (current && current !== next) current.fadeOut(0.4);
  if (next) next.reset().fadeIn(0.4).play();
  else mixer.stopAllAction();
  current = next;
}

// ── UI wiring ───────────────────────────────────────────────────────────────
document.querySelectorAll<HTMLInputElement>('input[name=light]').forEach((el) =>
  el.addEventListener('change', () => applyRig(el.value as Rig)),
);
$<HTMLInputElement>('exposure').addEventListener('input', (e) => {
  renderer.toneMappingExposure = Number((e.target as HTMLInputElement).value);
});
$<HTMLInputElement>('wire').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  materials.forEach((m) => (m.wireframe = on));
});
$<HTMLInputElement>('normalmap').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  materials.forEach((m) => { m.normalMap = on ? normalMaps.get(m) ?? null : null; m.needsUpdate = true; });
});
$<HTMLInputElement>('skeleton').addEventListener('change', (e) => {
  if (skelHelper) skelHelper.visible = (e.target as HTMLInputElement).checked;
});
$<HTMLInputElement>('bounds').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  if (boxHelper) boxHelper.visible = on;
  axes.visible = on;
});
$<HTMLInputElement>('env').addEventListener('change', (e) => {
  scene.environment = (e.target as HTMLInputElement).checked ? envTex : null;
});
const driftEl = $<HTMLInputElement>('drift');

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Loop ────────────────────────────────────────────────────────────────────
const timer = new THREE.Timer();
timer.connect(document);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = timer.getDelta();
  const t = timer.getElapsed();
  mixer?.update(dt);
  if (driftEl.checked && !reduceMotion) {
    // Slow, inertial zero-g drift around the body's centre of mass (~hips).
    pivot.position.set(Math.sin(t * 0.13) * 0.08, 0.95 + Math.sin(t * 0.21) * 0.06, 0);
    pivot.rotation.set(Math.sin(t * 0.09) * 0.25, t * 0.05, Math.sin(t * 0.07) * 0.18);
    pivot.children[0]?.position.set(0, -0.95, 0);
  } else {
    pivot.position.set(0, 0, 0);
    pivot.rotation.set(0, 0, 0);
    pivot.children[0]?.position.set(0, 0, 0);
  }
  boxHelper?.update();
  controls.update();
  renderer.render(scene, camera);
});
