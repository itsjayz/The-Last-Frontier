// Wormhole transit — a cheap 2D tunnel (no raymarching).
// Screen → polar coordinates; depth along the throat is k / r, so the walls rush
// outwards past the camera. Wall texture is seamless 3D noise on the cylinder
// (vgpu planet-common fbm), plus light streaks racing along the walls and the
// glow of the far mouth.

import { fbm3 } from "../planet/planet-common.wgsl";
import { pcg3d, unitFloat } from "@vgpu/wgsl-std/hash";

struct Tunnel {
  resolution: vec2f,
  time: f32,
  travel: f32,    // distance travelled along the throat
  speed: f32,     // 0..1, stretches streaks and brightens walls
  warp: f32,      // 0..1, how much tunnel structure is visible
  exitGlow: f32,  // 0..1, light of the far mouth
  heat: f32,      // 1 = warm (black-hole side) .. 0 = cool
}

@group(0) @binding(0) var<uniform> tunnel: Tunnel;

const TAU: f32 = 6.28318530718;

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = tunnel.resolution.x / tunnel.resolution.y;
  let p = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0) * vec2f(aspect, 1.0);
  let r = max(length(p), 1e-3);
  let a = atan2(p.y, p.x);
  let ring = vec2f(cos(a), sin(a));

  // Depth into the throat; slight twist sells rotation without extra cost.
  let z = 0.42 / r + tunnel.travel;
  let twist = z * 0.08;
  let tw = vec2f(ring.x * cos(twist) - ring.y * sin(twist), ring.x * sin(twist) + ring.y * cos(twist));

  let broad = fbm3(vec3f(tw * 1.4, z * 0.3), 4) * 0.5 + 0.5;
  let fine = fbm3(vec3f(tw * 4.5, z * 1.1 + 7.0), 3) * 0.5 + 0.5;
  let wall = pow(broad, 2.4) * (0.55 + fine * 0.9);

  let nearness = smoothstep(0.04, 1.2, r);
  let tint = mix(vec3f(0.55, 0.72, 1.0), vec3f(1.0, 0.6, 0.27), tunnel.heat);
  var color = tint * wall * nearness * (0.35 + tunnel.speed * 1.6);

  // Streaks: one per angular bin, racing outwards, length grows with speed.
  let bins = 240.0;
  let fa = (a / TAU + 0.5) * bins;
  let h = pcg3d(vec3u(u32(floor(fa)), 91u, 7u));
  let phase = fract(unitFloat(h.x) + tunnel.travel * (0.18 + unitFloat(h.y) * 0.4));
  let head = 0.06 + phase * phase * 1.8;
  let len = 0.015 + tunnel.speed * 0.5 * head;
  let along = smoothstep(head - len, head, r) * (1.0 - smoothstep(head, head + 0.012, r));
  let across = 1.0 - smoothstep(0.0, 0.22, abs(fract(fa) - 0.5));
  let present = step(0.5, unitFloat(h.z));
  let streakTint = mix(vec3f(0.85, 0.92, 1.0), vec3f(1.0, 0.8, 0.55), tunnel.heat * 0.6);
  color += streakTint * along * across * present * head * (0.3 + 2.6 * tunnel.speed);

  color *= tunnel.warp;

  // The far mouth: a soft white throat that opens as we near the other side.
  let g = tunnel.exitGlow;
  color += vec3f(0.92, 0.96, 1.0) * g * 2.4 * exp(-(r * r) / (0.004 + g * g * 0.5));

  return vec4f(color, 1.0);
}
