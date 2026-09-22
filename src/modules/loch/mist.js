// Veil mist (§10.4, R10): open cylinder r 9.3, 3 m, BackSide so only the far rim renders.
// Horizontal drifting bands, verdigris, additive; never vertical strands (§11.3 #11).
import * as THREE from 'three';
import { NOISE } from './glsl.js';

const MIST_VERTEX = /* glsl */ `
uniform float uMistH;      // height scale 0..1
varying vec3 vP;           // x, height fraction 0..1, z
varying float vFacing;
void main() {
  float h01 = position.y / 3.0 + 0.5;                             // CylinderGeometry spans y −1.5..1.5
  vec3 wp = vec3(position.x, h01 * 3.0 * uMistH, position.z);
  vP = vec3(position.x, h01, position.z);
  vec3 n = normalize(vec3(position.x, 0.0, position.z));   // open cylinder: |xz| = 9.3, never zero
  // normalize() of a zero vector is NaN, and vFacing feeds the fragment's alpha — one NaN fragment
  // is enough for the bloom to blank the frame. The camera cannot reach r 9.3 (§3.7 clamps), but the
  // degenerate vector is selected away rather than assumed away; bit-identical everywhere else.
  vec3 toCam = cameraPosition - wp;
  vFacing = abs(dot(n, normalize(dot(toCam, toCam) > 0.0 ? toCam : vec3(0.0, 1.0, 0.0))));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const MIST_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uMistA;      // 0.18·smoothstep(0.2, 1, V) (+ hold gust)
uniform float uMistH;
uniform vec3 uVerdigris;
varying vec3 vP;
varying float vFacing;
${NOISE}
void main() {
  float ang = atan(vP.x, -vP.z);                                   // −π..π, continuous with a periodic noise
  float yM = vP.y * 3.0 * uMistH;                                  // metres above the water
  // 1 octave value noise in (angle·6, y·2 − uTime·0.05); 38 cells ≈ 2π·6, periodic so there is no seam
  float n = loch_vnoiseP(vec2((ang / 6.2831853 + 0.5) * 38.0 + uTime * 0.02, yM * 2.0 - uTime * 0.05), 38.0);
  // layered horizontal bands: the noise only bends and thins the layers, so no blobs
  float layers = 0.5 + 0.5 * sin(yM * 3.4 - uTime * 0.07 + n * 2.6 + sin(ang * 3.0 + uTime * 0.013) * 0.6);
  float bands = (0.35 + 0.65 * layers * layers) * (0.55 + 0.45 * n);
  // clamp the base: interpolation can put vP.y a hair over 1, and pow() of a negative base is
  // NaN — which the bloom blur then smears across the whole frame (a black screen on real GPUs).
  float up = pow(max(1.0 - vP.y, 0.0), 1.8) * smoothstep(0.0, 0.08, vP.y + 0.03);
  float edge = smoothstep(0.05, 0.5, vFacing);                    // soften the silhouette sides of the ring
  float a = uMistA * bands * up * edge;
  gl_FragColor = vec4(uVerdigris * a, 1.0);
}
`;

export function createMist(verdigrisLin, timeUniform) {
  const geo = new THREE.CylinderGeometry(9.3, 9.3, 3, 96, 1, true);
  const uniforms = {
    uTime: timeUniform,
    uMistA: { value: 0 },
    uMistH: { value: 0 },
    uVerdigris: { value: verdigrisLin.clone() },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'loch.mist',
    uniforms,
    vertexShader: MIST_VERTEX,
    fragmentShader: MIST_FRAGMENT,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'loch.mist';
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    uniforms,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
