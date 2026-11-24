// One-off bake of a high-altitude "top shot" of the planet: the patch of surface
// beneath the camera, evaluated with the vgpu Earth example's procedural
// functions (so it matches the globe exactly) at much higher detail than the
// globe's 2048×1024 maps. rgb = ground (sRGB target), a = cloud coverage.
// Baked in horizontal strips across several frames to avoid a single long GPU job.

import { belt, elevation, fbm3, fbmVector, ridged3, saturate, valueRemap } from "../planet/planet-common.wgsl";

struct Patch {
  nadir: vec3f,
  halfTan: f32,     // tangent of the patch half-extent (radians on the sphere ≈ this)
  east: vec3f,
  stripStart: f32,  // uv.y range baked this frame
  north: vec3f,
  stripEnd: f32,
  light: vec3f,     // towards the star
  texel: f32,       // patch-space size of one texel (for hillshade differences)
}

@group(0) @binding(0) var<uniform> tile: Patch;

const OCEAN_DEEP = vec3f(0.008, 0.026, 0.078);
const OCEAN_SHALLOW = vec3f(0.022, 0.098, 0.152);
const SHELF = vec3f(0.030, 0.122, 0.150);
const FOREST = vec3f(0.020, 0.058, 0.019);
const GRASS = vec3f(0.070, 0.115, 0.036);
const DESERT = vec3f(0.235, 0.160, 0.076);
const TUNDRA = vec3f(0.128, 0.118, 0.092);
const ROCK = vec3f(0.098, 0.090, 0.080);
const ICE = vec3f(0.720, 0.780, 0.840);

fn patchDirection(q: vec2f) -> vec3f {
  return normalize(tile.nadir + tile.east * q.x + tile.north * q.y);
}

// Elevation with extra fine relief, so ridges and valleys read from altitude.
fn detailedElevation(d: vec3f) -> f32 {
  let base = elevation(d);
  // Extra octaves the globe can't afford: fractal coastlines, ridges and valleys.
  let coast = fbm3(d * 28.0 + vec3f(3.7), 4) * 0.035 + fbm3(d * 120.0 + vec3f(9.2), 3) * 0.012;
  let landish = saturate(base * 6.0 + 0.5);
  let ridges = (ridged3(d * 60.0 + vec3f(5.1), 4) - 0.45) * 0.05 * landish;
  return base + coast + ridges;
}

// Surface colour: the vgpu "earth" bake-surface palette and biome logic (MIT), lights omitted.
fn groundColor(d: vec3f, height: f32) -> vec3f {
  let latitude = abs(d.y);
  let land = saturate(valueRemap(height, 0.0, 0.035, 0.0, 1.0));
  let depth = saturate(-height * 12.0);
  var water = mix(SHELF, OCEAN_SHALLOW, saturate(depth * 3.5));
  water = mix(water, OCEAN_DEEP, saturate(depth));

  let aridity = saturate(valueRemap(fbm3(d * 2.2 + vec3f(63.1, 7.7, 21.3), 4), -0.18, 0.26, 0.0, 1.0));
  let subtropics = belt(latitude, 0.36, 0.32);
  let humid = 1.0 - saturate(valueRemap(latitude, 0.06, 0.40, 0.0, 1.0));
  let polar = saturate(valueRemap(latitude, 0.60, 0.88, 0.0, 1.0));
  let desertness = saturate(aridity * (0.30 + subtropics * 0.95) * 1.3 - 0.18);

  var ground = mix(GRASS, FOREST, saturate(humid * 0.8 + 0.2));
  ground = mix(ground, DESERT, desertness);
  ground = mix(ground, TUNDRA, polar);
  // Finer vegetation mottling for the close-up altitude.
  // Finer biome variation and vegetation mottling for the top-shot altitude.
  ground *= 0.78 + fbm3(d * 45.0 + vec3f(1.3), 3) * 0.35 + fbm3(d * 190.0, 2) * 0.22;
  ground = mix(ground, DESERT * 0.9, saturate(fbm3(d * 18.0 + vec3f(7.0), 3) * 1.4) * 0.35 * (1.0 - polar));

  let relief = ridged3(d * 8.0 + vec3f(2.5), 5);
  let mountains = saturate(valueRemap(relief * saturate(height * 5.0), 0.35, 0.80, 0.0, 1.0));
  ground = mix(ground, ROCK, mountains * 0.7);
  let snowLine = saturate(valueRemap(mountains, 0.65, 0.98, 0.0, 1.0)) * saturate(0.10 + polar * 1.3);
  ground = mix(ground, ICE, snowLine);
  return mix(water, ground, land);
}

// Cloud coverage: the vgpu "earth" bake-clouds field (MIT) plus a finer octave.
fn cloudCover(d: vec3f) -> f32 {
  let latitude = d.y;
  let flow = latitude * 0.35;
  let sheared = vec3f(d.x * cos(flow) - d.z * sin(flow), d.y, d.x * sin(flow) + d.z * cos(flow));
  let swirl = fbmVector(sheared * 1.9 + vec3f(17.3, -5.1, 42.7), 3) * 0.40;
  let systems = fbm3(sheared * 2.8 + swirl, 6);
  let wisps = fbm3(sheared * 7.5 + swirl * 1.6, 5);
  let filaments = ridged3(sheared * 16.0 + swirl * 2.2, 4) * 2.0 - 1.0;
  let detail = fbm3(sheared * 48.0 + swirl * 3.0, 3);
  let field = systems * 0.70 + wisps * 0.45 + filaments * 0.16 + detail * 0.12;
  let jitter = fbm3(d * 1.15 + vec3f(71.0, 13.0, -29.0), 3) * 0.10;
  let lane = abs(latitude) + jitter;
  let weather = 0.30
    + belt(lane, 0.00, 0.15) * 0.30
    + belt(lane, 0.64, 0.30) * 0.26
    + belt(lane, 0.97, 0.24) * 0.16
    - belt(lane, 0.34, 0.20) * 0.30;
  let raw = saturate(valueRemap(field + (weather - 0.46) * 0.85, -0.24, 0.62, 0.0, 1.0));
  return pow(raw, 2.0);
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  if (uv.y < tile.stripStart || uv.y >= tile.stripEnd) { discard; }
  let q = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0) * tile.halfTan;
  let d = patchDirection(q);
  let height = detailedElevation(d);

  var color = groundColor(d, height);
  // Hillshade on land from forward differences, lit by the star.
  let land = saturate(valueRemap(height, 0.0, 0.035, 0.0, 1.0));
  if (land > 0.0) {
    let hx = detailedElevation(patchDirection(q + vec2f(tile.texel, 0.0)));
    let hy = detailedElevation(patchDirection(q + vec2f(0.0, tile.texel)));
    let slope = vec2f(hx - height, hy - height) / tile.texel;
    let n = normalize(vec3f(-slope * 0.22, 1.0));
    let l = normalize(vec3f(dot(tile.light, tile.east), dot(tile.light, tile.north), max(dot(tile.light, tile.nadir), 0.2)));
    let shade = saturate(dot(n, l)) / max(l.z, 0.2);
    color *= mix(1.0, 0.45 + 0.55 * shade, land);
  }

  return vec4f(color, cloudCover(d));
}
