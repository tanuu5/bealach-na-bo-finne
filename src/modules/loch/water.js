// The loch water: opaque disc showing the Otherworld all-sky fisheye, fire streak, ripples, the pecked
// triple spiral, the river glow and the shoreline (§10.4 water shader steps 1–8).
import * as THREE from 'three';
import { SHARED_UNIFORMS, NOISE, FISHEYE, RIPPLES } from './glsl.js';

const WATER_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FALLBACK_SKY = /* glsl */ `
// Fallback when world.sky is absent: a peat → airglow gradient in the fisheye frame (§10.4 step 2).
vec3 loch_fallbackSky(vec3 dp) {
  float elev = asin(clamp(dp.y, 0.0, 1.0));
  float g = 1.0 - smoothstep(0.0, 0.2094, elev);                  // airglow band 0–12°
  vec3 glow = mix(uAirglow, uVerdigris, 0.8 * uVeil) * 0.8;         // verdigris only with the veil
  return mix(uPeat, glow, g * g);
}
`;

function waterFragment({ skyDecl, skyGlsl, split, low }) {
  // §10.4 step 2 is `otherSky(d)·0.55`, and otherSky is exactly skyAirglow + skyBand. Splitting the sum lets
  // the rim treatment reach the airglow annulus (which needs it) without touching the band (which does not):
  // see LOCH_SKY below. When `sky` publishes no split entry points the blanket damp is used instead.
  const LOCH_SKY = split
    ? /* glsl */ `
  // Beyond the Otherworld horizon (ζ > π/2) the inverse map repeats the horizon ring outward, so both layers
  // settle toward peat there: at V = 0 the far edge is dark ground-water, not an Otherworld-coloured rim (§2.1).
  vec3 beyond = mix(uPeat * 1.15, uHorizon, 0.3 + 0.7 * uVeil);
  // The Otherworld's own 0–12° airglow lands as an annulus in the last metre of the disc (ρ 7.4–8.28), and
  // until the Otherworld has turned far enough to tilt its horizon off the disc it is a *perfect circle*: a lit
  // pool edge / "glowing magic circle" (§11.3-2), where §3.4 / §10.4 want a dark lip. So the airglow is damped
  // toward the rim and let go early, over a wide 1.2 m so no hard inner edge appears.
  vec3 skyCol = mix(skyAirglow(d) * (1.0 - 0.72 * smoothstep(6.2, LOCH_RHO_H, rhoL)), beyond,
                    smoothstep(LOCH_RHO_H - 0.55, LOCH_RHO_H + 0.65, rhoL));
  // The band must not share either treatment. Its pole sits 28° off the Otherworld zenith, so the whole Milky
  // Way maps into ρ 5.71–8.28 — precisely the annulus those two curves attack — and together they cut the road
  // to 16–56% of its strength over its entire length, brightest end worst. That is the formless smudge the art
  // review read as "no Otherworld sky at all". The band therefore keeps its milk out to the Otherworld horizon
  // and only then fades, over 0.8 m; the shore lip below takes the last of it. §10.4 acceptance 1's "fisheye
  // Milky Way whose foot lies near the north rim" is now something a viewer can actually see.
  skyCol += skyBand(d) * (1.0 - smoothstep(LOCH_RHO_H - 0.08, LOCH_RHO_H + 0.72, rhoL));`
    : /* glsl */ `
  vec3 skyCol = otherSky(d) * (1.0 - 0.72 * smoothstep(6.2, LOCH_RHO_H, rhoL));
  skyCol = mix(skyCol, mix(uPeat * 1.15, uHorizon, 0.3 + 0.7 * uVeil),
               smoothstep(LOCH_RHO_H - 0.55, LOCH_RHO_H + 0.65, rhoL));`;
  return /* glsl */ `
varying vec3 vWorldPos;
${SHARED_UNIFORMS}
${skyDecl}
uniform sampler2D uSpiralTex;
uniform vec4 uRipples[8];
uniform vec3 uFill;        // eased filled fraction per arm (s < fill is lit)
uniform vec3 uFlashSeg;    // newly filled segment per arm
uniform vec3 uFlashT;      // its flash start (state.time)
uniform float uPulse;      // +30% beat pulse / hush pulse
uniform float uWaterGain;  // pour anticipation ×0.7
uniform vec4 uRiver;       // leg-B front w, glow amount, entry front z, flow time
uniform vec4 uWhite;       // arm white fraction, arm white amount, connector fraction, connector amount
uniform float uEmpty;      // fade: arms empty over 4 s
uniform vec3 uHorizon;     // Fresnel target (fog / horizon colour)
uniform vec3 uPeat;
uniform vec3 uAirglow;
uniform vec3 uVerdigris;
uniform vec3 uLichen;
uniform vec3 uBoFinne;
uniform vec3 uTorc;
uniform vec3 uEmber;
#include <fog_pars_fragment>
${NOISE}
${FISHEYE}
${RIPPLES}
${skyGlsl}
${skyGlsl ? '' : FALLBACK_SKY}

float loch_pick(vec3 v, float i) { return i < 0.5 ? v.x : (i < 1.5 ? v.y : v.z); }

void main() {
  vec2 xz = vWorldPos.xz;
  float rho = length(xz);
  // normalize() of a zero vector is NaN, and one NaN fragment is smeared over the whole frame by the
  // bloom blur (the black-screen failure). The camera can never sit on the water (§3.7 keeps it
  // ≥ 12 m from the target at ≤ 87° polar, i.e. outside r 9.4 and ≥ 3 m up), but viewDir feeds a pow()
  // below, so the degenerate case is selected away rather than assumed away. Bit-identical otherwise.
  vec3 toEye = vWorldPos - cameraPosition;
  vec3 viewDir = normalize(dot(toEye, toEye) > 0.0 ? toEye : vec3(0.0, -1.0, 0.0));
  float t = uTime;
  float mpp = max(fwidth(rho), 1e-4);                              // metres per pixel (roughly)

  // 5. ripples (8 slots)
  vec2 rip = loch_ripples(xz, t, mpp * 1.5);

  // 6. micro flicker ripples near the islet (uFireLevel, E 0.3 → 1.0)
  // atan(0, 0) is undefined, and the disc really does contain its own centre vertex (CircleGeometry
  // at the origin): a fragment landing exactly on it would feed NaN into flick, rhoL and the river
  // glow below. Any value is as good as another where the angle does not exist; 0 is the cheapest.
  float ang = dot(xz, xz) > 0.0 ? atan(xz.x, -xz.y) : 0.0;
  float flAmp = (0.3 + 0.7 * uEnergy) * clamp(uFireLevel * 1.5, 0.0, 1.5) * smoothstep(5.5, 1.5, rho);
  float flick = sin(rho * 9.0 - t * 3.1 + 1.4 * sin(ang * 5.0 + t * 0.7))
              * (0.6 + 0.4 * sin(ang * 3.0 - t * 1.3 + rho * 2.5)) * flAmp;
  flick *= smoothstep(0.45, 0.12, mpp);                            // no sub-pixel shimmer

  // 2. Otherworld fisheye sky (inverse mapping), ripples perturb (ρ, α)
  float rhoL = rho;
  vec2 xzL = xz;
${
  low
    ? ''
    : `  rhoL = max(0.0, rho + rip.y * 0.28 + flick * 0.06);
  float twist = rip.y * 0.025;
  xzL = mat2(cos(twist), -sin(twist), sin(twist), cos(twist)) * xz;`
}
  vec3 dp = loch_fisheyeDir(xzL, rhoL);
  vec3 d = loch_rotPole(dp, -uOtherAngle);
${
  skyGlsl
    ? LOCH_SKY
    : /* glsl */ `  vec3 skyCol = loch_fallbackSky(dp) * (1.0 - 0.72 * smoothstep(6.2, LOCH_RHO_H, rhoL));
  skyCol = mix(skyCol, mix(uPeat * 1.15, uHorizon, 0.3 + 0.7 * uVeil),
               smoothstep(LOCH_RHO_H - 0.55, LOCH_RHO_H + 0.65, rhoL));`
}
  // 1. base peat
  vec3 col = uPeat + skyCol * 0.55 * uWaterGain;

  // 3. Fresnel toward the fog / horizon colour at grazing angles.
  // clamp the base: viewDir is normalize()d per fragment, so abs(viewDir.y) is a saturated value that
  // can round a hair over 1 when the ray is near-vertical — and pow() of a negative base is NaN in
  // GLSL, which the bloom then smears across the whole frame (the mist.js black screen, same shape).
  float fres = pow(max(1.0 - abs(viewDir.y), 0.0), 5.0) * 0.6;
  col = mix(col, uHorizon, fres);

  // triple spiral: pecked grooves, gold when filled
  vec4 sp = texture2D(uSpiralTex, (xz + 9.0) / 18.0);
  float cov = sp.r;
  vec3 emit = vec3(0.0);
  if (cov > 0.004) {
    float s = clamp(sp.g / cov, 0.0, 1.0);
    float idv = sp.b / cov;
    float arm = idv < 0.31 ? 0.0 : (idv < 0.63 ? 1.0 : (idv < 0.9 ? 2.0 : 3.0));
    float isConn = step(2.5, arm);
    // pecks: stipple step(0.45, hash(floor(xz·14))) shaped as round, jittered dimples (a hammerstone's marks)
    vec2 cell = xz * 14.0;
    vec2 ci = floor(cell);
    float h1 = loch_hash12(ci);
    float h2 = loch_hash12(ci + 17.31);
    // floored: cfw is the half-width of two smoothstep edges below, and smoothstep divides by
    // (edge1 − edge0) — at cfw = 0 a fragment exactly on the edge is 0/0 = NaN. (Same floor as mpp.)
    float cfw = max(max(fwidth(cell.x), fwidth(cell.y)), 1e-6);
    float h3 = loch_hash12(ci + 41.7);
    float rad = 0.25 + 0.15 * h2;
    vec2 jit = (vec2(fract(h1 * 7.13), h3) - 0.5) * 0.18;          // rad + |jit| < 0.5: dimples never clip at the cell edge
    float dd = length(fract(cell) - 0.5 - jit);
    float dimple = 1.0 - smoothstep(rad - cfw * 0.7, rad + cfw * 0.7, dd);
    float pecked = step(0.45, h1);
    float depth = mix(0.3 * step(dd, rad * 0.6), 0.55 + 0.45 * h3, pecked);
    float blur = clamp(cfw * 0.8 - 0.4, 0.0, 1.0);                   // sub-pixel cells: the stipple's mean, no moiré
    float peck = min(dimple * depth * 2.4, 1.7);                     // close up: individual marks, HDR ≤ ×4
    peck = mix(peck, 0.55, blur);
    // the struck mark has relief: a ×2.2 highlight on the lit lip around a ×0.9 wash in the hollow (§2.3), so a
    // filled groove is a line of dimples catching the light, not a flat gold stroke
    float lip = exp(-(dd - rad * 0.84) * (dd - rad * 0.84) / max(rad * rad * 0.085, cfw * cfw * 0.45));
    float peckLit = mix(min(dimple * depth * (0.5 + 1.15 * lip) * 2.4, 1.7), 0.58, blur);
    // the groove is hand-pecked, so its width wanders ±30% along the arm instead of being a constant stroke
    float sw = s * 46.0;
    float wob = mix(loch_hash12(vec2(floor(sw), arm + 11.0)), loch_hash12(vec2(floor(sw) + 1.0, arm + 11.0)),
                    smoothstep(0.0, 1.0, fract(sw)));
    float covW = min(cov * (0.74 + 0.58 * wob), 1.0);
    float body = smoothstep(0.25, 0.6, covW);
    float core = smoothstep(0.72, 1.0, covW);
    float fillFrac = isConn > 0.5 ? uWhite.z : loch_pick(uFill, arm) * uEmpty;
    // the advancing fill is a line of struck marks, so its leading end frays over ~6 pecks instead of ending in
    // the clean cap of a progress ring (§11.3: the in-scene progress must never read as UI)
    float grain = loch_hash12(vec2(floor(s * 170.0), arm + 5.0));
    float lit = fillFrac > 0.0005
      ? clamp((fillFrac - s) / 0.05 + 0.5 + (grain - 0.62) * 1.2, 0.0, 1.0)
      : 0.0;
    lit *= isConn > 0.5 ? uWhite.w : 1.0;
    // unfilled: dark groove ×0.6 with a faint lichen edge
    float groove = body * peck * (1.0 - lit);
    col *= 1.0 - 0.4 * groove;
    col += uLichen * 0.08 * (1.0 - lit) * peck * smoothstep(0.1, 0.34, cov) * (1.0 - core * 0.8);
    // filled: torc pecks, narrow ×2.2 core inside a ×0.9 body (§2.3)
    float seg = floor(min(s * 3.0, 2.999));
    float fa = t - loch_pick(uFlashT, arm);
    float flash = (1.0 - isConn) * step(abs(seg - loch_pick(uFlashSeg, arm)), 0.1)
                * step(0.0, fa) * (1.0 - smoothstep(0.0, 0.5, fa));
    float gain = (0.9 * body + 1.3 * core) * (1.0 + uPulse) * (1.0 + 0.82 * flash);  // flash peaks ×4
    // uneven pecking along the groove: coarse runs of harder and softer striking, plus mark-by-mark variation.
    // This is the part that survives at the default camera, where one dimple is sub-pixel — it is what keeps the
    // arm reading as a struck line rather than a constant-width vector crescent.
    gain *= (0.45 + 0.75 * loch_hash12(vec2(floor(s * 150.0), arm + 3.0)))
          * (0.8 + 0.4 * loch_hash12(vec2(floor(s * 37.0), arm + 19.0)));
    float white = isConn > 0.5 ? 1.0 : clamp((uWhite.x - s) / 0.03 + 0.5, 0.0, 1.0) * uWhite.y;
    vec3 gold = mix(uTorc, mix(uTorc, uBoFinne, 0.62) * 1.12, white);
    emit += gold * gain * peckLit * lit;
  }

  // 8. river glow along leg B (pure function of uClimaxT, computed on the CPU)
  // DESIGN-QUESTION: §10.4 step 8 writes the glow as smoothstep(0.9, 0.2, distance). Leg B's three sunwise
  // turns are only (6.0 − 2.2)/3 ≈ 1.27 m apart, so a glow reaching 0.9 m from each turn covers the gap twice
  // over and the three turns merge into one lit disc — against §7.3, which makes the *separable* sunwise
  // circuit the centre of the river phase. The width is therefore 0.42 m here (zero by 0.42, so two turns
  // 1.27 m apart keep a dark lane between them) and the glow reads as water lit under the ribbon, not as a fill.
  if (uRiver.y > 0.001) {
    float phiDeg = degrees(ang);
    if (phiDeg < 0.0) phiDeg += 360.0;
    float g = 0.0;
    for (int k = 0; k < 3; k++) {
      float w = clamp((phiDeg + 360.0 * float(k)) / 1080.0, 0.0, 1.0);
      float front = clamp((uRiver.x - w) / 0.015, 0.0, 1.0);
      float dist = abs(rho - (6.0 - 3.8 * w));
      g = max(g, smoothstep(0.42, 0.08, dist) * front * (0.82 + 0.18 * sin(w * 70.0 - uRiver.w * 3.0)));
    }
    // entry: the straight first 3% of leg B, from the north shore to (0, −6)
    // clamp() is undefined when minVal > maxVal, and zEnd is −20 until T = 15.9 while this branch
    // already runs from T ≈ 15.81 (uRiver.y > 0.001) — a ~0.09 s window of undefined behaviour every
    // climax. step(−9, zEnd) below already kills the term there, so the max() only removes the UB.
    float zEnd = uRiver.z;
    float ez = clamp(xz.y, -9.0, max(zEnd, -9.0));
    float de = length(vec2(xz.x, xz.y - ez));
    g = max(g, smoothstep(0.52, 0.1, de) * step(-9.0, zEnd));
    emit += uBoFinne * 0.3 * g * uRiver.y;
  }

  // 4. fire streak: where the reflected view ray points at the flame. Angular distance between reflect(v, up)
  // and the flame, vertical tolerance ×4, broken by ripple glints. The vertical target is the flame's extent
  // (base → centre + level) around uFirePos + (0, 1.2, 0), so the streak starts at the islet edge.
  if (uFireLevel > 0.0) {
    vec3 R = reflect(viewDir, vec3(0.0, 1.0, 0.0));
    vec3 toF = uFirePos + vec3(0.0, 1.2, 0.0) - vWorldPos;
    float fd = length(toF.xz);
    vec2 rh = R.xz;
    vec2 lh = toF.xz;
    // atan(0, 0) is undefined. Both arguments vanish together when the fragment sits exactly under
    // the flame (lh = 0, the disc centre) or when the reflected ray is exactly vertical (rh = 0):
    // in both limits the azimuth is meaningless and every nearby fragment is looking straight at the
    // flame, so 0 continues the streak instead of punching a NaN through it.
    float azC = rh.x * lh.y - rh.y * lh.x;
    float azD = dot(rh, lh);
    float dAz = (azC != 0.0 || azD != 0.0) ? atan(azC, azD) : 0.0;
    float eR = asin(clamp(R.y, -1.0, 1.0));
    float eLo = atan(toF.y - 1.05, fd);                              // flame base (uFirePos.y + 0.15)
    float eHi = atan(toF.y + 0.2 + 1.6 * clamp(uFireLevel - 0.5, 0.0, 1.0), fd); // flame top: 1.4 m idle → 3.2 m
    float dEl = (max(0.0, eR - eHi) + max(0.0, eLo - eR)) / 4.0;     // stretched vertically ×4
    float q = (dAz * dAz) / (0.038 * 0.038) + (dEl * dEl) / (0.045 * 0.045);
    float streak = exp(-1.1 * q) + 0.12 / (1.0 + q * q);
    // glints: two crossed ripple trains, faded to their mean where they would alias
    float g1 = sin(xz.y * 9.3 + xz.x * 2.1 - t * 1.7 + flick * 3.0 + rip.y * 6.0);
    float g2 = sin(xz.y * 15.1 - xz.x * 3.7 + t * 1.1 + 1.3);
    float glint = clamp(0.55 + 0.9 * g1 * g2 + 0.35 * g1, 0.0, 1.0);
    glint = mix(glint * glint, 0.45, smoothstep(0.22, 0.42, mpp));
    float nearFire = 0.1 + 0.9 * smoothstep(6.0, 2.0, fd);
    vec3 sc = mix(uEmber, uTorc, smoothstep(0.25, 0.9, streak));
    emit += sc * streak * (0.12 + 0.88 * glint) * nearFire * 2.0 * uFireLevel;
  }

  // faint boFinne ripple rings
  emit += uBoFinne * 0.05 * rip.x;

  // 7. shoreline: darken within 0.4 m of r = 9 — the dark lip wins over whatever the Otherworld horizon leaves
  float shore = smoothstep(8.6, 9.0, rho);
  col *= mix(1.0, 0.26, shore);
  emit *= 1.0 - 0.8 * shore;

  col += emit;
  col = max(col + (loch_hash12(gl_FragCoord.xy + fract(t * 7.3) * 113.0) - 0.5) / 255.0, 0.0);   // dither
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;
}

/**
 * @param {object} o { shared, own, sky: { decl, glsl, uniforms, split } | null, low }
 */
export function createWaterMaterial({ shared, own, sky, low }) {
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...shared,
    ...(sky ? sky.uniforms : {}),
    ...own,
  };
  return new THREE.ShaderMaterial({
    name: 'loch.water',
    uniforms,
    vertexShader: WATER_VERTEX,
    fragmentShader: waterFragment({
      skyDecl: sky ? sky.decl : '',
      skyGlsl: sky ? sky.glsl : '',
      split: !!sky?.split,
      low,
    }),
    fog: true,
    depthWrite: true,
    transparent: false,
  });
}

/**
 * Compiles world.sky.glsl against a minimal WebGL2 prefix before three ever sees it, so a broken chunk from a
 * sibling cannot blank the loch. `sky.split` also exercises skyAirglow/skyBand, the two entry points the water
 * calls separately, so a chunk that publishes only otherSky can never reach the material. Returns '' when fine.
 */
export function probeSkyGlsl(renderer, sky) {
  const gl = renderer.getContext();
  if (!gl || typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext)) return '';
  const src = [
    '#version 300 es',
    'precision highp float;',
    'precision highp int;',
    'precision highp sampler2D;',
    '#define varying in',
    'layout(location = 0) out highp vec4 pc_fragColor;',
    '#define gl_FragColor pc_fragColor',
    '#define texture2D texture',
    'uniform mat4 viewMatrix;',
    'uniform vec3 cameraPosition;',
    'uniform bool isOrthographic;',
    SHARED_UNIFORMS,
    sky.decl,
    sky.glsl,
    'void main() {',
    '  vec3 d = normalize(vec3(0.1, 0.5, -0.8));',
    sky.split ? '  gl_FragColor = vec4(skyAirglow(d) + skyBand(d), 1.0);' : '  gl_FragColor = vec4(otherSky(d), 1.0);',
    '}',
  ].join('\n');
  const sh = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
  const log = ok ? '' : gl.getShaderInfoLog(sh) || 'compile failed';
  gl.deleteShader(sh);
  return log;
}
