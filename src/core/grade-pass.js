import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Runs after OutputPass, i.e. on tone-mapped, sRGB-encoded colour.
// Lifts shadows towards a tint, adds vignette and fine animated grain (also kills sky banding).
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.035 },
    uLift: { value: 0.03 },
    uTint: { value: new THREE.Color(0x1a2a3a) },
    uAspect: { value: 1 },
    uResolution: { value: new THREE.Vector2(1, 1) },
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
    uniform float uVignette;
    uniform float uGrain;
    uniform float uLift;
    uniform vec3 uTint;
    uniform float uAspect;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += uLift * uTint * (1.0 - smoothstep(0.0, 0.45, luma));

      vec2 d = vUv - 0.5;
      d.x *= uAspect;
      float vig = smoothstep(0.95, 0.25, length(d));
      col *= mix(1.0, vig, uVignette);

      vec2 px = floor(vUv * uResolution);
      float n = hash12(px + fract(uTime * 7.13) * 917.0) - 0.5;
      col += n * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createGradePass() {
  const pass = new ShaderPass(GradeShader);
  pass.setSize = function setSize(width, height) {
    this.uniforms.uAspect.value = width / Math.max(1, height);
    this.uniforms.uResolution.value.set(width, height);
  };
  return pass;
}
