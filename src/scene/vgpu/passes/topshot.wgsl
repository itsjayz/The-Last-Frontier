// Per-frame top shot: samples the baked patch (ground + clouds), drifts the
// clouds and their shadows, adds atmospheric haze. A few texture reads per pixel.

struct Top {
  resolution: vec2f,
  zoom: f32,        // fraction of the baked patch visible vertically (1 = whole patch)
  time: f32,
  pan: vec2f,       // patch-uv offset of the view centre
  shadow: vec2f,    // patch-uv offset from cloud to its shadow (from star direction)
  drift: vec2f,     // patch-uv cloud drift
  sun: f32,         // light intensity
  haze: f32,
}

@group(0) @binding(0) var<uniform> top: Top;
@group(0) @binding(1) var patchMap: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

// Mirror-repeat: if a coordinate ever leaves the patch it reflects back into it,
// instead of smearing the edge texels into streaks.
fn mirror(q: vec2f) -> vec2f {
  return vec2f(1.0) - abs(fract(q * 0.5) * 2.0 - vec2f(1.0));
}

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = top.resolution.x / top.resolution.y;
  // Equal scale on both axes: the patch keeps its natural proportions on any screen.
  let q = (uv - vec2f(0.5)) * vec2f(aspect, 1.0) * top.zoom + vec2f(0.5) + top.pan;

  let ground = textureSampleLevel(patchMap, samp, mirror(q), 0.0).rgb;
  // Clouds sit above the ground: they drift and parallax slightly against it.
  let cq = q + top.drift;
  let cloud = textureSampleLevel(patchMap, samp, mirror(cq), 0.0).a;
  let shadow = textureSampleLevel(patchMap, samp, mirror(cq + top.shadow), 0.0).a;

  var color = ground * (1.0 - smoothstep(0.18, 0.85, shadow) * 0.5) * top.sun;
  let cloudColor = vec3f(0.92, 0.94, 0.98) * top.sun * 1.1;
  color = mix(color, cloudColor, smoothstep(0.18, 0.85, cloud) * 0.9);

  // Aerial perspective: a thin blue veil, thicker towards the frame edges.
  let edge = length((uv - vec2f(0.5)) * vec2f(aspect, 1.0));
  let veil = top.haze * (0.35 + 0.65 * smoothstep(0.2, 1.1, edge));
  color = mix(color, vec3f(0.30, 0.48, 0.80) * top.sun * 0.55, veil);

  return vec4f(color, 1.0);
}
