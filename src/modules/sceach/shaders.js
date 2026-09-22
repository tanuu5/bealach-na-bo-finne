// GLSL for the sceach module. Shared chunks are pasted verbatim from docs/DESIGN.md §3.6.

// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6  (verbatim; each stage keeps the lines it needs)
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

// FIRELIGHT v2 — verbatim
export const FIRELIGHT = /* glsl */ `
// FIRELIGHT v2 — docs/DESIGN.md §3.6. Needs uFirePos, uFireLevel, uTime, uVeil (declared by the includer).
vec3 fireLight(vec3 wp, vec3 n) {
  vec3 L = (uFirePos + vec3(0.0, 1.1, 0.0)) - wp;
  float d = length(L); L /= max(d, 1e-3);
  float flick = 0.86 + 0.14 * sin(uTime * 11.0) * sin(uTime * 7.3 + 1.7);
  float fall = 1.0 / (1.0 + 0.02 * d * d);                           // §2.3: stones at 12.5 m must read
  float wrap = clamp(dot(n, L) * 0.75 + 0.25, 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.86, 0.62), clamp(uFireLevel - 1.0, 0.0, 1.0));
  return col * (0.4 + 2.6 * uFireLevel) * flick * fall * wrap;          // linear HDR
}
vec3 skyAmbient(vec3 n) {                                            // starlight + airglow fill
  float up = n.y * 0.5 + 0.5;
  vec3 base = mix(vec3(0.030, 0.042, 0.036), vec3(0.060, 0.081, 0.072), up);
  return base + vec3(0.036, 0.105, 0.084) * uVeil * up;               // verdigris only with the veil
}
`;

// Module-private uniforms shared by every sceach material (same JS objects).
const OWN_DECL = /* glsl */ `
uniform vec3 uWind;        // leeward unit vector (away from the loch), y = 0
uniform float uSwayAmp;    // twig sway amplitude: E and climax stillness (pure function of uClimaxT)
uniform float uPxScale;    // framebuffer px per metre at 1 m distance
`;

const HASH = /* glsl */ `
float sc_hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

// Domain guards. GLSL leaves pow() with a negative base, normalize() of a zero vector and
// atan(0, 0) *undefined*, and a single NaN fragment is smeared over the whole frame by the bloom
// blur — the piece goes black. Interpolated varyings are the usual way a value leaves its domain:
// dot(n, V) of two renormalised varyings is not guaranteed ≤ 1, so `1.0 - abs(dot(n, V))` can land
// a hair below zero on real hardware (SwiftShader never shows it). Every guard here only bites
// where the value was already invalid, so none of them changes the rendered look.
const SAFE = /* glsl */ `
vec3 sc_dir(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-24)); }  // normalize(), zero-safe
float sc_facing(vec3 a, vec3 b) { return clamp(abs(dot(a, b)), 0.0, 1.0); }  // |cos| of two unit-ish vectors
vec2 sc_ang(vec2 d) { return dot(d, d) > 0.0 ? d : vec2(1.0, 0.0); }    // atan(0,0) is undefined
`;

// One sway function for bark, foliage, ribbons, word ribbon and blossoms so everything hangs together.
const SWAY = /* glsl */ `
vec3 sceachSway(vec3 p, float w) {
  float ph = dot(p.xz, vec2(0.83, 1.21));
  float s = sin(uTime * 1.07 + ph) * 0.62 + sin(uTime * 2.31 + ph * 1.73) * 0.38;
  float k = w * uSwayAmp;
  return uWind * (s * 0.035 * k) + vec3(0.0, -abs(s) * 0.008 * k, 0.0);
}
`;

// Hanging cloth: anchor at a = 0, tip at a = 1; th = angle from straight down toward the (yawed) wind.
const HANG = /* glsl */ `
// 'rest' scales the shape a knotted rag holds with no wind at all: a slack S-bend left by the knot,
// a standing curl toward the tip, and a slow twist about its own length. At uVeil 0 the ribbons are
// therefore still cloth, not stick blades (§3.4). The word ribbon passes a small rest so the ogham
// stays readable.
vec3 sc_hang(vec3 anchor, float a, float L, float yaw, float seed, float lift, float flutter, float rest, out vec3 T, out vec3 S) {
  float cy = cos(yaw);
  float sy = sin(yaw);
  vec3 wdir = vec3(uWind.x * cy - uWind.z * sy, 0.0, uWind.x * sy + uWind.z * cy);
  vec3 side = vec3(-wdir.z, 0.0, wdir.x);
  vec3 p = anchor;
  T = vec3(0.0, -1.0, 0.0);
  float fa = a * 8.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float w = clamp(fa - fi, 0.0, 1.0);
    if (w <= 0.0) break;
    float s = (fi + 0.5 * w) / 8.0;
    float slack = rest * (0.36 * sin(s * 4.3 + seed * 6.2831) + 0.26 * s * s);
    float slackLat = rest * (0.30 * sin(s * 3.1 + seed * 11.0 + 1.7) + 0.15 * sin(s * 6.9 - seed * 4.0));
    float th = lift * (0.4 + 0.8 * s) + slack
             + flutter * 0.5 * s * sin(uTime * (2.4 + seed * 1.7) - s * 5.0 + seed * 37.0);
    float lat = slackLat + flutter * 0.4 * s * sin(uTime * (1.6 + seed * 0.9) - s * 3.5 + seed * 13.0);
    vec3 d = sc_dir(vec3(0.0, -cos(th), 0.0) + wdir * sin(th) + side * lat);
    p += d * (w * L / 8.0);
    T = d;
  }
  // the strip turns about its own length: a standing twist plus a slow breathing one
  float tw = seed * 6.2831
           + a * rest * (2.1 + 1.5 * sin(seed * 17.0))
           + a * (0.6 + 1.4 * flutter) * sin(uTime * 1.3 + seed * 9.0);
  vec3 s0 = sc_dir(side - T * dot(side, T) + vec3(1e-4, 0.0, 1e-4));
  vec3 b0 = cross(T, s0);
  S = s0 * cos(tw) + b0 * sin(tw);
  return p;
}
`;

// ---------------------------------------------------------------- tree + tobar (one draw)
export const treeVertex = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uEnergy;     // ctx.uniforms.uEnergy
${OWN_DECL}
attribute float aType;
attribute float aRad;
attribute float aSway;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vType;
varying float vRad;
#include <fog_pars_vertex>
${SWAY}
void main() {
  vec3 p = position;
  float dist = length(p - cameraPosition);
  // thin twigs and thorns never go below ≈1.5 px wide: stable silhouette, no shimmer
  float minR = 0.75 * dist / max(uPxScale, 1.0);
  p += normal * max(0.0, minR - aRad);
  p += sceachSway(p, aSway);
  vWorld = p;
  vNormal = normal;
  vUv = uv;
  vType = aType;
  vRad = aRad;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const treeFragment = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uVeil;       // ctx.uniforms.uVeil
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform float uHover;
uniform vec3 uBark;
uniform vec3 uStone;
uniform vec3 uPeat;
uniform vec3 uAirglow;
uniform vec3 uTobar;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vUv;
varying float vType;
varying float vRad;
#include <fog_pars_fragment>
${SAFE}
${FIRELIGHT}
${HASH}
void main() {
  vec3 n = sc_dir(vNormal);
  vec3 V = sc_dir(cameraPosition - vWorld);
  // Grazing-angle sky fill. At night a pale hawthorn bole and the wet ring stones gather sky light
  // from the whole hemisphere along their turning sides, so the sceach models in the round instead
  // of reading as a black cut-out when the fire is behind it (it is, from the default camera: the
  // fire sits 112° off the view direction as seen from the tree). No new hue — it is the skyAmbient
  // colour, up-biased, and the exponent is soft on purpose so it shades a side, never draws a line.
  float graze = pow(1.0 - sc_facing(n, V), 1.9);
  vec3 skyGraze = skyAmbient(vec3(0.0, 0.6, 0.0));
  vec3 col;
  if (vType > 3.5) {
    // thorn: hard pale spur wood, bone against the dark crown — the one cue that says whitethorn
    vec3 alb = uBark * 2.1;
    col = alb * (fireLight(vWorld, n) + skyAmbient(n) * 1.6 + skyGraze * 2.6 * graze);
  } else if (vType < 0.5) {
    // bark: twisted fluting + fine fissures, lichen x0.6
    float ridge = sin((vUv.y * 5.0 + vUv.x * 1.35) * 6.2831);
    float fis = sc_hash(floor(vec2(vUv.x * 22.0, vUv.y * 10.0)));
    // value break: the old bole is pale lichened wood, the young shoots are dark, and broad slow
    // patches of lichen ride over both — so the limbs are never one flat khaki.
    float thick = smoothstep(0.012, 0.075, vRad);
    float lichA = sc_hash(floor(vWorld.xz * 2.7 + vWorld.y * 1.9));
    float lichB = sc_hash(floor(vWorld.xz * 6.1 - vWorld.y * 4.3) + 11.0);
    vec3 alb = uBark * mix(0.55, 1.45, thick) * (0.74 + 0.56 * mix(lichB, lichA, thick));
    alb *= 1.0 + 0.22 * ridge + 0.34 * (fis - 0.5);
    col = alb * (fireLight(vWorld, n) + skyAmbient(n) + skyGraze * 1.8 * graze);
  } else if (vType < 1.5) {
    float blot = sc_hash(floor(vWorld.xz * 34.0 + vWorld.y * 11.0));
    vec3 alb = uStone * (0.78 + 0.34 * blot);
    col = alb * (fireLight(vWorld, n) + skyAmbient(n) + skyGraze * 1.1 * graze);
  } else if (vType < 2.5) {
    // tobar water: near-black, a faint airglow sheen at grazing angles and a trembling fire glint
    vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
    vec3 Lf = sc_dir(uFirePos + vec3(0.0, 1.1, 0.0) - vWorld);
    vec3 fcol = mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.86, 0.62), clamp(uFireLevel - 1.0, 0.0, 1.0));
    float flick = 0.86 + 0.14 * sin(uTime * 11.0) * sin(uTime * 7.3 + 1.7);
    vec2 rel = vWorld.xz - uTobar.xz;
    float rr = length(rel) / 0.45;
    float ripple = 0.5 + 0.5 * sin(rr * 18.0 - uTime * 1.7);
    float lobe = pow(clamp(dot(R, Lf) * 0.5 + 0.5, 0.0, 1.0), 10.0);
    float fz = max(1.0 - abs(V.y), 0.0);
    float fres = (fz * fz) * (fz * fz);
    vec2 fdir = Lf.xz / max(length(Lf.xz), 1e-4);
    float lip = smoothstep(0.72, 0.98, rr) * clamp(-dot(rel / max(length(rel), 1e-4), fdir), 0.0, 1.0);
    col = uPeat * 0.6 + uAirglow * 0.22 * fres;
    col += fcol * (0.4 + 2.6 * uFireLevel) * flick * (0.05 * lobe * (0.6 + 0.4 * ripple) + 0.035 * lip);
  } else {
    // rill: wet, dark peat with a thin moving sheen
    float wet = 0.5 + 0.5 * sin(vUv.x * 60.0 - uTime * 2.2 + vUv.y * 3.0);
    float edge = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
    vec3 alb = uBark * 0.35;
    col = alb * (fireLight(vWorld, n) + skyAmbient(n)) * mix(1.4, 0.7, edge) + uPeat * 0.5;
    col += uAirglow * 0.08 * wet * edge;
  }
  col *= 1.0 + 0.15 * uHover * (0.35 + 0.65 * graze);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------- foliage (instanced, alpha-tested)
export const foliageVertex = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
${OWN_DECL}
uniform vec3 uCrown;
attribute vec3 aLeaf;      // seed, roll, lean
varying vec2 vQ;
varying vec3 vWorld;
varying vec3 vN;
varying float vSeed;
#include <fog_pars_vertex>
${SAFE}
${SWAY}
void main() {
  vec3 c = instanceMatrix[3].xyz;
  float sc = length(instanceMatrix[0].xyz);
  c += sceachSway(c, 1.0);
  float ca = cos(aLeaf.y);
  float sa = sin(aLeaf.y);
  vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca);
  vec4 mvPosition = viewMatrix * vec4(c, 1.0);
  mvPosition.xy += q * sc;
  vQ = position.xy;
  vWorld = c;
  vN = sc_dir(c - uCrown + vec3(0.0, 0.6, 0.0) + (cameraPosition - c) * 0.02);
  vSeed = aLeaf.x;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const foliageFragment = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uVeil;       // ctx.uniforms.uVeil
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform vec3 uLeaf;
varying vec2 vQ;
varying vec3 vWorld;
varying vec3 vN;
varying float vSeed;
#include <fog_pars_fragment>
${SAFE}
${FIRELIGHT}
${HASH}
void main() {
  float cover = -1.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = (vec2(sc_hash(vec2(vSeed * 91.0, fi + 0.5)), sc_hash(vec2(fi + 1.5, vSeed * 57.0))) - 0.5) * 0.48;
    float ang = sc_hash(vec2(vSeed * 13.0 + fi, 3.1)) * 6.2831;
    vec2 d = vQ - c;
    d = vec2(d.x * cos(ang) - d.y * sin(ang), d.x * sin(ang) + d.y * cos(ang));
    vec2 da = sc_ang(d);                                   // d is exactly 0 at a lobe centre
    float lobe = 1.0 + 0.24 * cos(atan(da.y, da.x) * 3.0); // hawthorn: short, broad, lobed
    // leaves overlap into one spray: at ~6–12 px a cluster must read as leaf mass, not loose specks
    float e = length(d / vec2(0.225, 0.15)) / lobe;
    cover = max(cover, 1.0 - e);
  }
  if (cover <= 0.0) discard;
  vec3 n = sc_dir(vN);
  // leaf edges catch the sky, so a cluster models as a mass of small lobes instead of one flat blot
  float edge = smoothstep(0.34, 0.0, cover);
  vec3 alb = uLeaf * (0.7 + 0.6 * sc_hash(floor(vQ * 7.0) + vSeed * 17.0));
  // Seen from across the loch the crown has only sky behind it, and dark leaves on a dark sky are no
  // crown at all. The lit rim is what separates a leafed hawthorn from dead wood, so the cluster
  // edges take a good deal more sky and a little rim of the fire, while the albedo stays the dark
  // airglow x 0.5 of §10.7 — the mass never brightens, only its edges catch.
  float rk = 1.0 - sc_facing(n, sc_dir(cameraPosition - vWorld));
  float rim = rk * rk;
  vec3 col = alb * (fireLight(vWorld, n) * (1.0 + 1.3 * rim) + skyAmbient(n)
                    + skyAmbient(vec3(0.0, 0.6, 0.0)) * (2.6 * edge + 1.2 * rim));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------- ribbons (instanced strips)
export const ribbonVertex = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
${OWN_DECL}
uniform float uLift;
uniform float uFlutter;
attribute vec4 aDye;       // linear dye rgb, twig sway weight of the anchor
attribute vec4 aInfo;      // tieTime, ghost, old, dyeIndex + seed
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vDye;
varying vec4 vRib;         // age, ghost, old, linen
varying float vDyeK;       // 0 madder, 1 woad, 2 linen
varying float vA;
#include <fog_pars_vertex>
${SAFE}
${SWAY}
${HANG}
void main() {
  vec3 anchor = instanceMatrix[3].xyz;
  anchor += sceachSway(anchor, aDye.w);
  float dyeIdx = floor(aInfo.w);
  float seed = fract(aInfo.w);
  float age = uTime - aInfo.x;
  float born = step(0.0, age);   // a ribbon scheduled to tie later is not there yet
  age = max(age, 0.0);
  // 0.4 s wrap-and-drop: a quick wrap around the twig, then the cloth drops with a small overshoot
  float tk = clamp(age / 0.4, 0.0, 1.0);
  float wrap = 1.0 - smoothstep(0.0, 0.45, tk);
  float dk = smoothstep(0.3, 1.0, tk) - 1.0;
  float drop = 1.0 + 2.70158 * dk * dk * dk + 1.70158 * dk * dk;
  float len = (aInfo.z > 0.5 ? 0.6 + 0.18 * seed : 0.7) * mix(0.1, 1.0, drop) * born;
  float yaw = (seed - 0.5) * 1.8 + wrap * age * 34.0;
  anchor.y += 0.02 * wrap;
  vec3 T;
  vec3 S;
  float a = position.y;
  vec3 p = sc_hang(anchor, a, len, yaw, seed, uLift + seed * 0.1, uFlutter, 1.0, T, S);
  float dist = length(p - cameraPosition);
  // a torn strip of linen: pinched into the knot, full through the body, frayed and tapered at the
  // tip — a straight-edged blade is the one thing cloth never looks like
  float prof = mix(0.42, 1.0, smoothstep(0.0, 0.2, a))
             * (1.0 - 0.34 * smoothstep(0.58, 1.0, a))
             * (1.0 + 0.14 * sin(a * 13.0 + seed * 21.0));
  float wid = max(0.05 * prof, 1.1 * dist / max(uPxScale, 1.0)) * born;
  p += S * position.x * wid;
  vWorld = p;
  vN = sc_dir(cross(T, S));
  vDye = aDye.rgb;
  vRib = vec4(age, aInfo.y, aInfo.z, step(1.5, dyeIdx));
  vDyeK = dyeIdx;
  vA = a;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const ribbonFragment = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uVeil;       // ctx.uniforms.uVeil
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform float uBeckon;
uniform float uBeckonStatic;
uniform float uRiverGlow;
uniform float uHover;
uniform vec3 uTorc;
uniform vec3 uBoFinne;
varying vec3 vWorld;
varying vec3 vN;
varying vec3 vDye;
varying vec4 vRib;
varying float vDyeK;
varying float vA;
#include <fog_pars_fragment>
${SAFE}
${FIRELIGHT}
void main() {
  vec3 n = sc_dir(vN);
  bool front = gl_FrontFacing;
  if (!front) n = -n;
  vec3 V = sc_dir(cameraPosition - vWorld);
  float up = n.y * 0.5 + 0.5;
  // the two faces of the cloth are lit differently, so a twisting strip reads as cloth turning
  float face = front ? 1.0 : 0.58;
  float age = vRib.x;
  float ghost = vRib.y;
  float old = vRib.z;
  float linen = vRib.w;
  float woad = clamp(1.0 - abs(vDyeK - 1.0), 0.0, 1.0);
  float madder = clamp(1.0 - vDyeK, 0.0, 1.0);
  // Cloth is a thin diffuse sheet and gathers far more sky than the bark does. Woad gets the most of
  // it and the least fire: firelight is (1, .42, .14), so every watt of it multiplies woad's blue
  // away and leaves a dark teal smear. §10.10-1 carves an exception out of its "no B > G + 6" scan
  // for the woad ribbons; until woad actually reads blue somewhere in the frame that carve-out is
  // describing nothing.
  vec3 light = fireLight(vWorld, n) * face * (1.0 - 0.5 * woad)
             + skyAmbient(n) * (1.5 + 3.2 * up) * (1.0 + 3.4 * woad) * face;
  vec3 alb = vDye * mix(1.0, 0.5, old) * (1.0 + 0.6 * uBeckon * linen) * (1.0 + uBeckonStatic);
  // cloth catches a little extra sky light on its broad faces so dyes still read at night
  vec3 col = alb * (light + 0.085 + 0.22 * woad);
  // §2.1: linen's surface sheen is the colour of the light, never of the dye — and it is the only
  // term that can lift a channel above the dye's own ratio. Without enough of it, madder × warm
  // firelight lands at (85, 13, 14) on screen: a pure red needle. With it the rag sits near the
  // tone-mapped palette hex (158, 47, 34), a dull brick, and stops pulling the eye. madderFill
  // adds the missing green-blue only to the dye that needs it, so linen and woad keep their own cast.
  // the sheen is sky-coloured, so woad takes almost none of it: it is what was turning woad teal
  float sheen = (0.22 + 0.72 * pow(1.0 - sc_facing(n, V), 2.2)) * face * mix(1.0, 0.55, old) * (1.0 - 0.78 * woad);
  col += skyAmbient(vec3(0.0, 0.7, 0.0)) * sheen * (0.62 + 0.5 * linen + 0.62 * madder);
  float kindle = (1.0 - old) * mix(1.0, 0.6, ghost);
  float knot = 1.0 - smoothstep(0.0, 0.16, vA);
  col += uTorc * kindle * (2.3 * exp(-age * 2.2) * knot + 0.42 * exp(-age * 0.8) * (1.0 - 0.6 * vA));
  col += uBoFinne * 0.1 * uRiverGlow * (1.0 - 0.5 * old);
  col *= 1.0 + 0.15 * uHover;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------- word ribbon
export const wordVertex = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
${OWN_DECL}
uniform float uLift;
uniform float uFlutter;
uniform vec3 uAnchor;
uniform float uUnroll;
uniform float uWSeed;
uniform float uAnchorSway;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vTex;
#include <fog_pars_vertex>
${SAFE}
${SWAY}
${HANG}
void main() {
  vec3 anchor = uAnchor + sceachSway(uAnchor, uAnchorSway);
  float un = max(uUnroll, 0.001);
  vec3 T;
  vec3 S;
  vec3 p = sc_hang(anchor, position.y, 1.4 * un, (uWSeed - 0.5) * 0.7, uWSeed, uLift * 0.55, uFlutter * 0.4, 0.22, T, S);
  // the word cloth turns its written face to the viewer (a slow twist keeps it cloth, not a sign)
  vec3 toCam = sc_dir(cameraPosition - p);
  vec3 face = cross(T, toCam);
  float fl = length(face);
  S = fl > 1e-3 ? face / fl : S;
  float tw = 0.35 * sin(uTime * 0.9 + uWSeed * 20.0 + position.y * 2.0) * uFlutter;
  S = sc_dir(S * cos(tw) + cross(T, S) * sin(tw));
  float dist = length(p - cameraPosition);
  float wid = max(0.09, 2.0 * dist / max(uPxScale, 1.0)) * smoothstep(0.0, 0.06, uUnroll);
  p += S * position.x * wid;
  vWorld = p;
  vN = sc_dir(cross(T, S));
  // the cloth nearest the knot is the END of the word: ogham reads bottom → top
  vTex = vec2(1.0 - position.y * un, position.x + 0.5);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const wordFragment = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uVeil;       // ctx.uniforms.uVeil
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform sampler2D uWordTex;
uniform float uGlow;
uniform float uLetterT0;
uniform float uEighth;
uniform float uX0;
uniform float uSlotW;
uniform float uCount;
uniform vec3 uTorc;
uniform vec3 uBoFinne;
varying vec3 vWorld;
varying vec3 vN;
varying vec2 vTex;
#include <fog_pars_fragment>
${SAFE}
${FIRELIGHT}
void main() {
  vec3 n = sc_dir(vN);
  if (!gl_FrontFacing) n = -n;
  // the cloth stays a dim linen ground so the gold strokes on it keep their contrast
  vec3 col = uBoFinne * 0.42 * (fireLight(vWorld, n) + skyAmbient(n) + skyAmbient(vec3(0.0, 0.6, 0.0)) * 0.5);
  float m = texture2D(uWordTex, vTex).r;
  float halo = texture2D(uWordTex, vTex, 1.8).r;
  float slot = floor((vTex.x * 512.0 - uX0) / max(uSlotW, 1.0)) - 1.0;
  float tl = uTime - (uLetterT0 + max(slot, 0.0) * uEighth);
  float sounded = step(0.0, tl) * step(0.0, slot) * step(slot, uCount - 1.0);
  float flash = sounded * exp(-max(tl, 0.0) * 3.0);
  // §2.3: a narrow x2.5 core (crosses the 0.85 bloom threshold, so a 1 px ogham stroke on a 0.09 m
  // cloth still reads as a glowing notch) inside a wider x0.9 falloff that stays saturated gold.
  float core = smoothstep(0.34, 0.78, m);
  float g = uGlow * (0.98 + 0.25 * sounded + 0.35 * flash);
  col += uTorc * g * (2.5 * core + 0.45 * halo + 0.3 * m);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// ---------------------------------------------------------------- wish motes (additive points)
export const moteVertex = /* glsl */ `
uniform float uDpr;
attribute vec4 aCol;       // linear HDR rgb, size in CSS px
varying vec3 vCol;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = min(aCol.w, 4.0) * uDpr;
  if (aCol.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // unused sample: outside the clip volume
  vCol = aCol.rgb;
}
`;

export const moteFragment = /* glsl */ `
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // soft enough that consecutive trail samples overlap into one streak instead of a dotted line
  float a = exp(-d * d * 2.2) * (1.0 - smoothstep(0.7, 1.0, d));
  gl_FragColor = vec4(vCol, a);
}
`;

// ---------------------------------------------------------------- blossom + haws (alpha-tested points)
export const blossomVertex = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uClimaxT;    // ctx.uniforms.uClimaxT    (??= {value:-1})
${OWN_DECL}
uniform float uDpr;
attribute vec4 aInfo;      // kind (0 blossom, 1 haw), seed, ground y, sway weight
varying vec3 vWorld;
varying vec2 vKS;
varying float vFade;
#include <fog_pars_vertex>
${HASH}
${SWAY}
void main() {
  float T = uClimaxT;
  float seed = aInfo.y;
  float heavy = aInfo.x;                                        // 0 blossom, 1 haw
  // Three decorrelated draws from the one stored seed. When start time, fall time and tumble all
  // came off the seed itself the crown let go as one sheet, and the points that survived longest
  // were exactly the ones that drifted furthest (§11.2: a source and a destination, nothing adrift).
  float h1 = sc_hash(vec2(seed, 3.17));
  float h2 = sc_hash(vec2(seed, 7.71));
  float h3 = sc_hash(vec2(seed, 11.33));
  // T 28–31: blossom and haws appear together (staggered per point)
  float app = smoothstep(28.0 + seed * 1.6, 29.4 + seed * 1.6, T);
  // §7.3 fade (T 122–142): they let go a few at a time and fall to the foot of the tree. Nothing
  // moves before 122 (the afterglow keeps them), and the latest possible landing is 130.0 + 7.0 =
  // T 137, so nothing is left in the air when the cycle resets at 142. A haw is heavier than a
  // petal — it goes in the first half of the shower, drops faster and hardly drifts.
  float fs = 122.0 + h1 * (8.0 - 2.0 * heavy);
  float dur = (4.2 + 2.8 * h2) * (1.0 - 0.28 * heavy);
  float fall = clamp((T - fs) / dur, 0.0, 1.0);
  vec3 p = position + sceachSway(position, aInfo.w * (1.0 - fall));
  float y0 = p.y;
  float ground = aInfo.z + 0.03;
  p.y = mix(y0, ground, fall * fall);                           // gravity ease
  // Lateral: a short leeward lean (≤ 0.24 m) plus a tumble that closes again as it lands, so a
  // petal comes down inside the canopy it fell from instead of sailing off across the meadow.
  float tumble = sin(fall * 3.14159);
  float light = 1.0 - 0.6 * heavy;
  p.xz += uWind.xz * ((0.10 + 0.14 * h3) * light) * fall * fall
        + vec2(sin(T * 1.3 + h3 * 44.0), cos(T * 1.1 + h2 * 31.0)) * (0.09 * light) * tumble;
  // Fade on the distance fallen, and out altogether in the last hand's breadth above the turf:
  // nothing is still at full strength once it has left the canopy, and nothing lies on the ground.
  float fallen = max(0.0, y0 - p.y);
  float above = max(0.0, p.y - ground);
  float fade = (1.0 - 0.8 * smoothstep(0.0, 1.3, fallen)) * smoothstep(0.02, 0.26, above);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float worldSize = (heavy < 0.5 ? 0.12 : 0.085) * (0.74 + 0.26 * fade);
  float px = worldSize * uPxScale / max(-mvPosition.z, 0.1);
  float k = app * step(0.0, T);
  gl_PointSize = clamp(px, 2.2 * uDpr, 7.0 * uDpr) * k;
  vFade = fade;
  if (k * fade <= 0.015) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);  // not yet in bloom / already gone
  vWorld = p;
  vKS = vec2(aInfo.x, seed);
  #include <fog_vertex>
}
`;

export const blossomFragment = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uVeil;       // ctx.uniforms.uVeil
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform vec3 uBoFinne;
uniform vec3 uMadder;
uniform vec3 uTorc;
varying vec3 vWorld;
varying vec2 vKS;
varying float vFade;
#include <fog_pars_fragment>
${SAFE}
${FIRELIGHT}
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = length(q);
  vec3 col;
  if (vKS.x < 0.5) {
    // five-petal hawthorn blossom
    vec2 qa = sc_ang(q);                                 // gl_PointCoord hits the centre exactly
    float ang = atan(qa.y, qa.x) + vKS.y * 6.2831;
    float petal = 0.5 + 0.5 * pow(abs(cos(2.5 * ang)), 0.7);
    if (r > petal) discard;
    vec3 n = sc_dir(cameraPosition - vWorld + vec3(0.0, 1.5, 0.0));
    float eye = smoothstep(0.32, 0.12, r);
    vec3 alb = uBoFinne * (0.9 - 0.25 * eye);
    col = alb * (fireLight(vWorld, n) + skyAmbient(n)) * 0.9 + uBoFinne * 0.2 + uTorc * 0.25 * eye;
    // a sprite is 2–4 px here and MSAA does not antialias a discard, so feather the petal edge
    col *= smoothstep(petal, petal - 0.24, r);
  } else {
    // round red haw with a small fire highlight
    if (r > 1.0) discard;
    vec3 nv = vec3(q.x, -q.y, sqrt(max(0.0, 1.0 - r * r)));
    vec3 n = sc_dir((vec4(nv, 0.0) * viewMatrix).xyz);
    // §7.3: the haws are the one warm accent in a white-and-gold afterglow, and §2.1 forbids using
    // madder as light — so this is exposure, not emission. A haw is a small glossy sphere and gathers
    // sky over its whole hemisphere, most of it from straight up; with only skyAmbient(n) the berries
    // tracked the fire and fell to dark holes in the blossom from T ≈ 34, once the fire settled to 0.7
    // and the column was gone. Gathered this way they sit near the tone-mapped palette hex from the
    // bloom right through to the fall.
    vec3 light = fireLight(vWorld, n) + skyAmbient(n) * 1.8 + skyAmbient(vec3(0.0, 1.0, 0.0)) * 2.6;
    vec3 Lf = sc_dir(uFirePos + vec3(0.0, 1.1, 0.0) - vWorld);
    vec3 V = sc_dir(cameraPosition - vWorld);
    float spec = pow(max(dot(reflect(-Lf, n), V), 0.0), 24.0);
    vec3 fcol = mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.86, 0.62), clamp(uFireLevel - 1.0, 0.0, 1.0));
    col = uMadder * (light + 0.05) + fcol * spec * 0.25 * (0.4 + 2.6 * uFireLevel) / (1.0 + 0.02 * dot(uFirePos - vWorld, uFirePos - vWorld));
    col *= smoothstep(1.0, 0.78, r);
  }
  // The points are in the opaque pass (§11.1: nothing here blends normally), so a petal leaves by
  // going out, not by going see-through: vFade dims it with the distance it has fallen.
  gl_FragColor = vec4(col * vFade, 1.0);
  #include <fog_fragment>
}
`;
