// Lays an incoming scene over the current one. While `distort` > 0 the incoming
// image is swirled and rippled about the centre; as it settles to 0 the
// distortion "dissolves" into the new environment. Alpha-blended, one sample.

struct Dissolve {
  amount: f32,   // 0..1 opacity of the incoming scene
  distort: f32,  // 0..1 swirl/ripple strength
  time: f32,
  aspect: f32,
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> dissolve: Dissolve;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = (uv - vec2f(0.5)) * vec2f(dissolve.aspect, 1.0);
  let r = length(c);
  let k = dissolve.distort;
  let angle = k * 2.6 * exp(-r * 2.2);
  let s = sin(angle);
  let co = cos(angle);
  c = vec2f(c.x * co - c.y * s, c.x * s + c.y * co);
  c *= 1.0 + k * (0.06 * sin(r * 34.0 - dissolve.time * 5.0) - 0.25 * exp(-r * 3.0));
  let sampleUv = c / vec2f(dissolve.aspect, 1.0) + vec2f(0.5);
  let color = textureSampleLevel(src, samp, sampleUv, 0.0).rgb;
  return vec4f(color, dissolve.amount);
}
