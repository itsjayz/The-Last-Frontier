// GLSL port of the vgpu "Earth" example (MIT, vercel-labs/vgpu, examples/earth).
// Ported rather than embedded so the planet shares one renderer, one HDR
// pipeline and one post chain with the astronaut, and runs on WebGL2.

/** Deterministic procedural helpers shared by the bake shaders (planet-common.wgsl). */
const planetCommon = /* glsl */ `
const float PI = 3.141592653589793;

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

const vec3 GRADIENTS[12] = vec3[12](
  vec3(1.0, 1.0, 0.0), vec3(-1.0, 1.0, 0.0), vec3(1.0, -1.0, 0.0), vec3(-1.0, -1.0, 0.0),
  vec3(1.0, 0.0, 1.0), vec3(-1.0, 0.0, 1.0), vec3(1.0, 0.0, -1.0), vec3(-1.0, 0.0, -1.0),
  vec3(0.0, 1.0, 1.0), vec3(0.0, -1.0, 1.0), vec3(0.0, 1.0, -1.0), vec3(0.0, -1.0, -1.0)
);

vec3 latticeGradient(ivec3 cell) {
  return GRADIENTS[int(pcg3d(uvec3(cell)).x % 12u)];
}

vec3 quinticFade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

float perlin3(vec3 p) {
  vec3 base = floor(p);
  ivec3 c = ivec3(base);
  vec3 f = p - base;
  vec3 w = quinticFade(f);
  float n000 = dot(latticeGradient(c + ivec3(0, 0, 0)), f - vec3(0.0, 0.0, 0.0));
  float n100 = dot(latticeGradient(c + ivec3(1, 0, 0)), f - vec3(1.0, 0.0, 0.0));
  float n010 = dot(latticeGradient(c + ivec3(0, 1, 0)), f - vec3(0.0, 1.0, 0.0));
  float n110 = dot(latticeGradient(c + ivec3(1, 1, 0)), f - vec3(1.0, 1.0, 0.0));
  float n001 = dot(latticeGradient(c + ivec3(0, 0, 1)), f - vec3(0.0, 0.0, 1.0));
  float n101 = dot(latticeGradient(c + ivec3(1, 0, 1)), f - vec3(1.0, 0.0, 1.0));
  float n011 = dot(latticeGradient(c + ivec3(0, 1, 1)), f - vec3(0.0, 1.0, 1.0));
  float n111 = dot(latticeGradient(c + ivec3(1, 1, 1)), f - vec3(1.0, 1.0, 1.0));
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}

const mat3 OCTAVE_ROTATION = mat3(
  vec3(0.00, 0.80, 0.60),
  vec3(-0.80, 0.36, -0.48),
  vec3(-0.60, -0.48, 0.64)
);

float fbm3(vec3 p, int octaves) {
  float sum = 0.0, amp = 0.5, total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * perlin3(p);
    total += amp;
    amp *= 0.5;
    p = OCTAVE_ROTATION * p * 2.0;
  }
  return sum / max(total, 1.0e-6);
}

float ridged3(vec3 p, int octaves) {
  float sum = 0.0, amp = 0.5, total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float r = 1.0 - abs(perlin3(p));
    sum += amp * r * r;
    total += amp;
    amp *= 0.5;
    p = OCTAVE_ROTATION * p * 2.0;
  }
  return sum / max(total, 1.0e-6);
}

vec3 fbmVector(vec3 p, int octaves) {
  return vec3(
    fbm3(p, octaves),
    fbm3(p + vec3(37.19, 11.73, 5.41), octaves),
    fbm3(p + vec3(-13.07, 71.31, 29.83), octaves)
  );
}

// Matches THREE.SphereGeometry's UV layout so baked maps line up with the mesh.
vec3 sphereDirection(vec2 uv) {
  float theta = (1.0 - uv.y) * PI;
  float phi = uv.x * 2.0 * PI;
  float s = sin(theta);
  return vec3(-cos(phi) * s, cos(theta), sin(phi) * s);
}

float valueRemap(float v, float inMin, float inMax, float outMin, float outMax) {
  float span = inMax - inMin;
  if (span == 0.0) return outMin;
  return outMin + (outMax - outMin) * (v - inMin) / span;
}

float saturate(float v) { return clamp(v, 0.0, 1.0); }
float belt(float v, float center, float width) { return 1.0 - smoothstep(0.0, width, abs(v - center)); }

const float SEA_LEVEL = 0.13;

float elevation(vec3 d) {
  vec3 warp = fbmVector(d * 1.05 + vec3(4.7, -2.3, 8.1), 3) * 0.60;
  float continents = fbm3(d * 1.25 + warp, 6);
  float ranges = fbm3(d * 3.6 + vec3(19.0), 4) * 0.26;
  float coastline = fbm3(d * 13.0 + vec3(-7.0), 3) * 0.055;
  return continents + ranges + coastline - SEA_LEVEL;
}
`;

// Bake shaders run once, offscreen. With NASA maps loaded only the cloud bake is used;
// the surface bake remains as the fallback if the imagery fails to load.
// Used with RawShaderMaterial + GLSL3, so attributes are declared explicitly.
export const bakeVertex = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Day albedo (rgb, linear) + night lights (a). Port of bake-surface.wgsl. */
export const bakeSurfaceFragment = /* glsl */ `
precision highp float;
precision highp int;
${planetCommon}
in vec2 vUv;
out vec4 outColor;

const vec3 OCEAN_DEEP = vec3(0.008, 0.026, 0.078);
const vec3 OCEAN_SHALLOW = vec3(0.022, 0.098, 0.152);
const vec3 SHELF = vec3(0.030, 0.122, 0.150);
const vec3 FOREST = vec3(0.020, 0.058, 0.019);
const vec3 GRASS = vec3(0.070, 0.115, 0.036);
const vec3 DESERT = vec3(0.235, 0.160, 0.076);
const vec3 TUNDRA = vec3(0.128, 0.118, 0.092);
const vec3 ROCK = vec3(0.098, 0.090, 0.080);
const vec3 ICE = vec3(0.720, 0.780, 0.840);

void main() {
  vec3 d = sphereDirection(vUv);
  float height = elevation(d);
  float latitude = abs(d.y);
  float land = saturate(valueRemap(height, 0.0, 0.035, 0.0, 1.0));

  float depth = saturate(-height * 12.0);
  vec3 water = mix(SHELF, OCEAN_SHALLOW, saturate(depth * 3.5));
  water = mix(water, OCEAN_DEEP, saturate(depth));

  float aridity = saturate(valueRemap(fbm3(d * 2.2 + vec3(63.1, 7.7, 21.3), 4), -0.18, 0.26, 0.0, 1.0));
  float subtropics = belt(latitude, 0.36, 0.32);
  float humid = 1.0 - saturate(valueRemap(latitude, 0.06, 0.40, 0.0, 1.0));
  float polar = saturate(valueRemap(latitude, 0.60, 0.88, 0.0, 1.0));
  float desertness = saturate(aridity * (0.30 + subtropics * 0.95) * 1.3 - 0.18);

  vec3 ground = mix(GRASS, FOREST, saturate(humid * 0.8 + 0.2));
  ground = mix(ground, DESERT, desertness);
  ground = mix(ground, TUNDRA, polar);

  float relief = ridged3(d * 8.0 + vec3(2.5), 5);
  float mountains = saturate(valueRemap(relief * saturate(height * 5.0), 0.35, 0.80, 0.0, 1.0));
  ground = mix(ground, ROCK, mountains * 0.7);
  float snowLine = saturate(valueRemap(mountains, 0.65, 0.98, 0.0, 1.0)) * saturate(0.10 + polar * 1.3);
  ground = mix(ground, ICE, snowLine);

  vec3 albedo = mix(water, ground, land);

  float capNoise = fbm3(d * 6.0 + vec3(-31.0), 3) * 0.035;
  float capLatitude = latitude + capNoise + land * 0.02;
  float cap = saturate(valueRemap(capLatitude, 0.905, 0.965, 0.0, 1.0));
  albedo = mix(albedo, ICE, cap);

  float settlement = saturate(valueRemap(fbm3(d * 16.0 + vec3(101.7, 4.3, 55.9), 4), 0.04, 0.30, 0.0, 1.0));
  float sprawl = saturate(valueRemap(fbm3(d * 46.0 + vec3(9.1), 3), 0.00, 0.26, 0.0, 1.0));
  float coastal = 1.0 - saturate(valueRemap(height, 0.0, 0.22, 0.0, 1.0));
  float habitable = (1.0 - polar) * (1.0 - saturate(desertness * 1.1)) * (1.0 - mountains * 0.85);
  float lights = land * habitable * settlement * sprawl * (0.30 + coastal) * 2.0;
  // Break regions into fine points of light rather than glowing patches.
  lights *= smoothstep(0.05, 0.32, fbm3(d * 150.0 + vec3(3.3), 2));

  outColor = vec4(albedo, saturate(lights));
}
`;

/** Cloud coverage in r. Port of bake-clouds.wgsl. */
export const bakeCloudsFragment = /* glsl */ `
precision highp float;
precision highp int;
${planetCommon}
in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 d = sphereDirection(vUv);
  float latitude = d.y;
  float flow = latitude * 0.35;
  vec3 sheared = vec3(d.x * cos(flow) - d.z * sin(flow), d.y, d.x * sin(flow) + d.z * cos(flow));
  vec3 swirl = fbmVector(sheared * 1.9 + vec3(17.3, -5.1, 42.7), 3) * 0.40;

  float systems = fbm3(sheared * 2.8 + swirl, 6);
  float wisps = fbm3(sheared * 7.5 + swirl * 1.6, 5);
  float filaments = ridged3(sheared * 16.0 + swirl * 2.2, 4) * 2.0 - 1.0;
  float field = systems * 0.70 + wisps * 0.45 + filaments * 0.16;

  float jitter = fbm3(d * 1.15 + vec3(71.0, 13.0, -29.0), 3) * 0.10;
  float lane = abs(latitude) + jitter;
  float weather = 0.30
    + belt(lane, 0.00, 0.15) * 0.30
    + belt(lane, 0.64, 0.30) * 0.26
    + belt(lane, 0.97, 0.24) * 0.16
    - belt(lane, 0.34, 0.20) * 0.30;

  float raw = saturate(valueRemap(field + (weather - 0.46) * 0.85, -0.24, 0.62, 0.0, 1.0));
  outColor = vec4(pow(raw, 2.4), 0.0, 0.0, 1.0);
}
`;

export const earthVertex = /* glsl */ `
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Day/night, clouds, sunset tint and fresnel haze. Port of earth.wgsl (object
 * space, radius 1). With NASA_MAPS defined, the surface comes from Blue Marble
 * (uSurface, sRGB) and the night side from Black Marble (uNight, sRGB);
 * otherwise from the procedural bake (rgb albedo + a lights), as in vgpu.
 */
export const earthFragment = /* glsl */ `
uniform sampler2D uSurface;
uniform sampler2D uNight;
uniform sampler2D uClouds;
uniform vec3 uLightDir;   // object space, towards the sun
uniform vec3 uCameraPos;  // object space
uniform float uExposure;
uniform float uNightLights;
uniform float uMoonlight;
uniform float uCloudOpacity;
varying vec3 vPos;
varying vec2 vUv;

const float PI = 3.141592653589793;
const vec3 NIGHT_LIGHT_COLOR = vec3(1.0, 0.72, 0.36);
const vec3 SUNSET_CLOUD_COLOR = vec3(0.525, 0.273, 0.249);
const vec3 ATMOSPHERE_COLOR = vec3(0.51, 0.714, 1.0);
const vec3 ATMOSPHERE_SUNSET_COLOR = vec3(1.0, 0.373, 0.349);
const vec3 CLOUD_COLOR = vec3(0.9);
const float CLOUD_NORMAL_SCALE = 0.01;

float saturate(float v) { return clamp(v, 0.0, 1.0); }
float valueRemap(float v, float a, float b, float c, float d) { return c + (d - c) * (v - a) / (b - a); }
float curveUp(float x, float f) { return (1.0 - f / (x + f)) * (f + 1.0); }

vec2 cloudSlope(vec2 uv, float scale) {
  float s = scale / 10.0;
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  float c = s * texture2D(uClouds, uv).r;
  return vec2(s * texture2D(uClouds, uv + dx).r - c, s * texture2D(uClouds, uv + dy).r - c);
}

vec3 perturbNormal(vec3 p, vec3 n, vec2 slope) {
  vec3 sx = dFdx(p), sy = dFdy(p);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (slope.x * r1 + slope.y * r2);
  return normalize(abs(det) * n - g);
}

void main() {
  vec3 L = normalize(uLightDir);
  vec3 N = normalize(vPos);
  vec3 V = normalize(uCameraPos - vPos);

  float rawLambert = dot(N, L);
  float rawSun = valueRemap(rawLambert, -0.1, 0.1, 0.0, 1.0);
  float sunLight = saturate(rawSun);
  float nightFade = saturate(valueRemap(rawSun, 0.0, 0.15, 0.0, 1.0));

#ifdef NASA_MAPS
  vec3 albedo = texture2D(uSurface, vUv).rgb;
  vec3 night = texture2D(uNight, vUv).rgb;
  // Black Marble = warm city lights over a dim blue moonlit base; separate the two.
  float lightMask = smoothstep(0.004, 0.09, night.r - 0.85 * night.b);
  vec3 cityLights = night * lightMask;
  vec3 moonlit = night * (1.0 - lightMask);
  vec3 result = albedo * sunLight;
  result += (cityLights * uNightLights + moonlit * uMoonlight) * (1.0 - nightFade);
#else
  vec4 surface = texture2D(uSurface, vUv);
  vec3 result = surface.rgb * sunLight;
  result += NIGHT_LIGHT_COLOR * surface.a * (1.0 - nightFade) * uNightLights;
#endif

  float cloud = texture2D(uClouds, vUv).r * uCloudOpacity;
  vec3 cloudN = perturbNormal(vPos, N, cloudSlope(vUv, CLOUD_NORMAL_SCALE));
  float cloudShadow = curveUp(clamp(valueRemap(dot(cloudN, L), 0.0, 0.3, 0.3, 1.0), 0.3, 1.0), 0.5);
  vec3 cloudColor = CLOUD_COLOR * cloudShadow;

  float sunset = clamp(valueRemap(rawSun, -0.1, 0.85, -1.0, 1.0), -1.0, 1.0);
  sunset = cos(sunset * PI) * 0.5 + 0.5;
  cloudColor *= clamp(sunLight, 0.1, 1.0);
  cloudColor = mix(cloudColor, SUNSET_CLOUD_COLOR, pow(cloud, 1.5) * sunset);
  // Clouds dim the city lights beneath them on the night side.
  result = mix(result, cloudColor * sunLight + result * 0.25 * (1.0 - sunLight), cloud);

  float fresnel = 0.1 + 0.5 * pow(1.0 - saturate(dot(N, V)), 3.0);
  float fresnelSunset = saturate(valueRemap(dot(-L, V), 0.97, 1.0, 0.0, 1.0));
  vec3 atmo = mix(ATMOSPHERE_COLOR, ATMOSPHERE_SUNSET_COLOR, fresnelSunset);
  result = mix(result, atmo, fresnel * sunLight);

  gl_FragColor = vec4(result * uExposure, 1.0);
}
`;

export const atmosphereVertex = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Back-facing atmosphere shell. Port of atmosphere.wgsl, extended with a
 * forward-scattering term so the limb glows when Earth is backlit by the sun.
 */
export const atmosphereFragment = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uCameraPos;
uniform float uStrength;
uniform float uForward;
varying vec3 vPos;

const vec3 ATMOSPHERE_COLOR = vec3(0.51, 0.714, 1.0);
const vec3 SUNSET_COLOR = vec3(1.0, 0.373, 0.349);

float saturate(float v) { return clamp(v, 0.0, 1.0); }
float valueRemap(float v, float a, float b, float c, float d) { return c + (d - c) * (v - a) / (b - a); }

void main() {
  vec3 N = normalize(vPos);
  vec3 V = normalize(uCameraPos - vPos);
  if (dot(N, V) > 0.0) discard;

  vec3 L = normalize(uLightDir);
  float sunLight = saturate(valueRemap(dot(N, L), 0.0, 0.2, 0.0, 1.0));

  float fresnel = saturate(valueRemap(dot(-N, V), 0.0, 0.25, 0.0, 1.0));
  fresnel = pow(fresnel, 4.0);

  // Light passing through the limb towards the camera (sun behind the planet).
  float towardsSun = saturate(dot(-V, L));
  float forward = pow(towardsSun, 24.0) * saturate(valueRemap(dot(N, L), -0.35, 0.15, 0.0, 1.0));

  float sunsetFactor = saturate(valueRemap(dot(-L, V), 0.97, 1.0, 0.0, 1.0));
  vec3 color = mix(ATMOSPHERE_COLOR, SUNSET_COLOR, max(sunsetFactor, forward * 0.3));
  float intensity = fresnel * (sunLight * uStrength + forward * uForward);
  gl_FragColor = vec4(color * intensity, 1.0);
}
`;
