// Scene + bloom composite for the vgpu black-hole layer.
// From the vgpu "black-hole" example (MIT), with its ACES curve replaced by the
// exact AgX transform three.js uses, plus the same grain and vignette as the
// Three.js film pass, so both layers grade identically.

struct Post {
  exposure: f32,
  time: f32,
  grain: f32,
  vignette: f32,
  aspect: f32,
  bloomStrength: f32,
}

@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var<uniform> post: Post;

fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

// three.js AgXToneMapping (column-major matrices, identical constants).
fn agx(input: vec3f) -> vec3f {
  let srgbToRec2020 = mat3x3f(
    vec3f(0.6274, 0.0691, 0.0164), vec3f(0.3293, 0.9195, 0.0880), vec3f(0.0433, 0.0113, 0.8956));
  let rec2020ToSrgb = mat3x3f(
    vec3f(1.6605, -0.1246, -0.0182), vec3f(-0.5876, 1.1329, -0.1006), vec3f(-0.0728, -0.0083, 1.1187));
  let inset = mat3x3f(
    vec3f(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3f(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
    vec3f(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  let outset = mat3x3f(
    vec3f(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3f(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
    vec3f(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var color = inset * (srgbToRec2020 * input);
  color = log2(max(color, vec3f(1e-10)));
  color = clamp((color - minEv) / (maxEv - minEv), vec3f(0.0), vec3f(1.0));
  color = outset * agxContrast(color);
  color = pow(max(color, vec3f(0.0)), vec3f(2.2));
  return clamp(rec2020ToSrgb * color, vec3f(0.0), vec3f(1.0));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn hash(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment fn fs_main(@location(0) uv: vec2f, @builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let hdrScene = textureSampleLevel(scene, samp, uv, 0.0).rgb;
  let hdrBloom = textureSampleLevel(bloom, samp, uv, 0.0).rgb;
  var color = agx((hdrScene + hdrBloom * post.bloomStrength) * post.exposure);
  color = linearToSrgb(color);

  let centered = uv - vec2f(0.5);
  let dist = length(centered * vec2f(post.aspect, 1.0));
  color *= 1.0 - post.vignette * smoothstep(0.35, 1.05, dist);

  let luma = dot(color, vec3f(0.2126, 0.7152, 0.0722));
  let n = hash(fragCoord.xy + fract(post.time * 7.31) * 512.0) - 0.5;
  let weight = smoothstep(0.0, 0.18, luma) * (1.0 - smoothstep(0.7, 1.0, luma) * 0.6);
  color += n * post.grain * (0.25 + weight);

  return vec4f(max(color, vec3f(0.0)), 1.0);
}
