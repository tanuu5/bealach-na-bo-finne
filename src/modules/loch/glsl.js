// GLSL chunks private to the `loch` module (functions only — no uniform declarations, §3.6 R13).

// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6 (pasted verbatim at the top of every stage that needs it)
export const SHARED_UNIFORMS = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uEnergy;     // ctx.uniforms.uEnergy
uniform float uVeil;       // ctx.uniforms.uVeil
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform float uClimaxT;    // ctx.uniforms.uClimaxT    (??= {value:-1})
uniform float uAfterglow;  // ctx.uniforms.uAfterglow  (??= {value:0})
uniform float uOtherAngle; // ctx.uniforms.uOtherAngle (??= {value:0})
`;

// Hash + periodic value noise. Prefixed `loch_` so nothing collides with world.sky.glsl helpers.
export const NOISE = /* glsl */ `
float loch_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// one octave of value noise, periodic in x with integer period
float loch_vnoiseP(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, period);
  float x1 = mod(i.x + 1.0, period);
  float a = loch_hash12(vec2(x0, i.y));
  float b = loch_hash12(vec2(x1, i.y));
  float c = loch_hash12(vec2(x0, i.y + 1.0));
  float d = loch_hash12(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

// Otherworld fisheye (§10.4). Exact forward/inverse pair, not mirrored east–west (R8).
//   forward: d' = rot(d, pole, +uOtherAngle); ζ = acos(clamp(d'.y,0,1)); ρ = 8.28·ζ/(π/2); α = atan2(d'.x, −d'.z)
//            point = (ρ sin α, y, −ρ cos α) = ρ·(d'.x, d'.z)/|d'.xz|
//   inverse: ρ = |xz|, ζ = ρ/8.28·π/2, d' = (sinζ·x/ρ, cosζ, sinζ·z/ρ), d = rot(d', pole, −uOtherAngle)
export const FISHEYE = /* glsl */ `
const vec3 LOCH_POLE = vec3(0.0, 0.7986, -0.6018);   // LAYOUT.sky.celestialPole
const float LOCH_RHO_H = 8.28;                         // 9.0 · 0.92 — the Otherworld horizon on the water
const float LOCH_HALF_PI = 1.5707963;
vec3 loch_rotPole(vec3 v, float a) {                   // Rodrigues about the celestial pole
  float c = cos(a);
  float s = sin(a);
  return v * c + cross(LOCH_POLE, v) * s + LOCH_POLE * dot(LOCH_POLE, v) * (1.0 - c);
}
vec2 loch_fisheyeXZ(vec3 dp) {                         // dp already rotated; returns the water point xz
  float zeta = acos(clamp(dp.y, 0.0, 1.0));
  float rho = LOCH_RHO_H * zeta / LOCH_HALF_PI;
  float h = length(dp.xz);
  return h > 1e-6 ? dp.xz * (rho / h) : vec2(0.0);
}
vec3 loch_fisheyeDir(vec2 xz, float rho) {             // water point → d' (fisheye frame, before un-rotation)
  float zeta = min(rho / LOCH_RHO_H, 1.0) * LOCH_HALF_PI; // beyond the Otherworld horizon: horizon colour
  float sz = sin(zeta);
  vec2 dirXZ = rho > 1e-5 ? xz / rho : vec2(0.0, -1.0);
  return vec3(sz * dirXZ.x, cos(zeta), sz * dirXZ.y);
}
`;

// Ripple field shared by the water fragment and the star vertex shader.
// uRipples[i] = vec4(x, z, startTime, strength); ring radius r(age) = 3.2·age·(1 − 0.2·age) (0 → 4 m over 2.5 s).
// DESIGN-QUESTION: §10.4 water step 5 writes the radius as "3.2·age·0.8", which reaches 6.4 m at age 2.5 s and
// runs off a 9 m loch; §6.2 says "radius 0→4 m over 2.5 s". This decelerating form matches §6.2 exactly
// (3.2·2.5·(1 − 0.5) = 4.0) and equals the literal 3.2·age·0.8 at age 1 s, so it reads as the intended curve.
export const RIPPLES = /* glsl */ `
// returns vec2(ringLight, ringDisplacement)
vec2 loch_ripples(vec2 xz, float t, float minW) {
  float light = 0.0;
  float disp = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 rp = uRipples[i];
    float age = t - rp.z;
    if (rp.w <= 0.0 || age < 0.0 || age > 2.5) continue;
    float radius = 3.2 * age * (1.0 - 0.2 * age);
    float d = distance(xz, rp.xy) - radius;
    float life = 1.0 - age / 2.5;
    float amp = rp.w * life * life * smoothstep(0.0, 0.08, age);
    float w = max(0.16 + 0.07 * age, minW);                     // displacement envelope
    float wl = max(0.035 + 0.03 * age, minW);                   // thin bright crest
    light += exp(-d * d / (wl * wl)) * amp;
    disp += sin(d / w * 2.2) * exp(-d * d / (2.8 * w * w)) * amp;
  }
  return vec2(light, disp);
}
`;
