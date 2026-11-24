/**
 * Final display-space finish: restrained radial chromatic aberration,
 * a soft vignette and luminance-weighted film grain. Runs after tone mapping.
 */
export const FilmShader = {
  name: 'FilmShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.045 },
    uAberration: { value: 0.0009 },
    uVignette: { value: 0.32 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uVignette;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float dist = length(centered * vec2(uAspect, 1.0));
      vec2 shift = centered * uAberration * dist * 2.0;
      float alpha = texture2D(tDiffuse, vUv).a;
      vec3 color = vec3(
        texture2D(tDiffuse, vUv + shift).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - shift).b
      );

      float vignette = 1.0 - uVignette * smoothstep(0.35, 1.05, dist);
      color *= vignette;

      // Grain is strongest in the mid-tones and nearly absent in pure black.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      float n = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 512.0) - 0.5;
      float weight = smoothstep(0.0, 0.18, luma) * (1.0 - smoothstep(0.7, 1.0, luma) * 0.6);
      // The vgpu layer beneath grains itself; only grain what this layer covers.
      color += n * uGrain * (0.25 + weight) * alpha;

      gl_FragColor = vec4(max(color, 0.0), alpha);
    }
  `,
};
