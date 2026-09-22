// GLSL for `sky` (docs/DESIGN.md §3.6, §10.2).
//
// SKY_DECL and SKY_GLSL are published as world.sky.glslDecl / world.sky.glsl.
// Rule R13: the chunk declares no uniforms. An includer pastes, in this order:
//   SHARED-UNIFORMS v2 block (at least uVeil and uClimaxT) → world.sky.glslDecl → world.sky.glsl
// and plugs world.sky.uniforms (same objects) into its ShaderMaterial. Everything compiles in both
// the vertex and the fragment stage (textureLod, no derivatives). All helpers are prefixed `sky_`
// (or `skyBand`/`skyAirglow`) so they never collide with an includer's own functions.

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

export const SKY_DECL = /* glsl */ `
// SKY-DECL — world.sky.glslDecl (docs/DESIGN.md §10.2). Sky-owned; plug in world.sky.uniforms.
uniform sampler2D uBandTex;  // Milky Way band: R milk, G dust, B envelope, A centre wobble
uniform vec3  uBandH;        // live band frame: foot direction (θ = 0, β = 0)
uniform vec3  uBandT;        // live band frame: upward tangent (θ = 90°)
uniform vec3  uBandN;        // live band frame: pole (β = +90°)
uniform float uBandGain;     // 0.2 at rest (×1.4 pillar, ×1.3 return/afterglow), includes the arrival fade
`;

export const SKY_GLSL = /* glsl */ `
// SKY-GLSL — world.sky.glsl (docs/DESIGN.md §10.2). Functions only; no declarations.
// Needs uVeil, uClimaxT (SHARED-UNIFORMS) and SKY-DECL. Public entry points:
//   vec3 otherSky(vec3 dir)              airglow + Milky Way (with climax drain), no stars, linear HDR
//   vec3 skyBand(vec3 dir)               Milky Way only
//   vec3 skyAirglow(vec3 dir)            airglow only (0–12° elevation of dir, verdigris with uVeil)
//   vec3 skyAirglowP(vec3 dir, float ph) airglow with drifting striation phase
//   vec2 skyBandCoord(vec3 dir)          (θ°, β°) in the live band frame, θ in (−180, 180]
float sky_hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// NAN-GUARD. GLSL leaves normalize() of a zero-length vector undefined (0/0 = NaN), and one NaN
// fragment is smeared over every mip by the bloom blur, so the whole frame goes black. Every vector
// that reaches this function is unit by construction; the guard only bites where the input was
// already invalid, so it changes no rendered pixel. Fallback: the zenith.
vec3 sky_unit(vec3 v) {
  float l = length(v);
  return l > 1e-6 ? v / l : vec3(0.0, 1.0, 0.0);
}

// One octave of value noise, periodic in x with period 900 (θ° · 2.5 over the full circle).
float sky_vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 w = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, 900.0);
  float x1 = mod(i.x + 1.0, 900.0);
  float a = sky_hash12(vec2(x0, i.y));
  float b = sky_hash12(vec2(x1, i.y));
  float c = sky_hash12(vec2(x0, i.y + 1.0));
  float d = sky_hash12(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

vec2 skyBandCoord(vec3 dir) {
  float x = dot(dir, uBandH) + 1e-7;
  float y = dot(dir, uBandT);
  // NAN-GUARD: asin() needs its argument inside [-1, 1] — dot() of two interpolated unit vectors is
  // not guaranteed to be — and atan(y, x) is undefined when both are zero. The +1e-7 bias covered
  // x == 0 but not the one direction whose H component is exactly -1e-7 with no T component at all
  // (and not a zero-length dir from an includer), so the degenerate pair is tested outright. The
  // answer there is the 0 the bias was already producing all around it.
  float z = clamp(dot(dir, uBandN), -1.0, 1.0);
  float th = abs(x) + abs(y) > 1e-6 ? atan(y, x) : 0.0;
  return vec2(th * 57.2957795, asin(z) * 57.2957795);
}

// §7.3 drain: 1 outside the climax; pour empties θ ∈ [θd, 40°] to the channel floor (θ > 40° → 0.5);
// return refills from the foot upward (θ < θr, θr = 90°·smoothstep(27, 32, T)). 3° soft edges.
// Pure function of θ and T, and the ONLY shape the emptying has: skyBand() multiplies its whole summed
// radiance by it — core, body, shoulder and every halo term alike (POLISH-FIX below).
float sky_drain(float th, float T) {
  // NAN-GUARD: written as one positive test so a non-finite T (uClimaxT belongs to bealach) takes
  // the "no climax" exit instead of sliding past two false comparisons into the smoothsteps below.
  // Identical to (T < 8.0 || T >= 33.0) for every finite T.
  if (!(T >= 8.0 && T < 33.0)) return 1.0;
  float thd = 40.0 * (1.0 - smoothstep(8.0, 13.0, T));
  // §7.3 writes the channel floor as 0.08; 0.055 is used instead because §10.2 acceptance 6 measures
  // the channel centre at ≤ 25 luma and 0.08 lands on the limit once the grade lift is added. Both are
  // "empty" to the eye; the lower one is the one that measures.
  float emptied = mix(0.055, 1.0, 1.0 - smoothstep(thd - 1.5, thd + 1.5, th));
  float high = mix(1.0, 0.5, smoothstep(8.0, 10.0, T));
  float v = mix(emptied, high, smoothstep(38.5, 41.5, th));
  if (T >= 26.0) {
    float thr = 90.0 * smoothstep(27.0, 32.0, T);
    float back = max(1.0 - smoothstep(thr - 1.5, thr + 1.5, th), smoothstep(31.0, 33.0, T));
    v = mix(v, 1.0, back);
  }
  return v;
}

// §3.5 width: half-width 9° at the foot (bulge centred at θ = 5°), narrowing to 5° by θ = 90°.
float sky_halfWidth(float dth) {
  return 5.0 + 4.0 * (1.0 - smoothstep(0.0, 85.0, dth));
}

// Cross-band profile at b = (β − wobble)/halfWidth. Three nested gaussians: a bright core, the milk
// body, and a wide low shoulder that carries the band ~5° further out at a few percent alpha, so the
// edge of the Milky Way dissolves into the sky instead of ending on a visible rim (§11.2 soft milk).
float sky_cross(float b) {
  return (exp(-2.2 * b * b) + 0.35 * exp(-0.9 * b * b) + 0.115 * exp(-0.26 * b * b)) * 0.68259;
}

// POLISH-FIX (§7.3 sky column, §2.2, §11.3-11 — major). The previous revision multiplied only the
// cross-band *middle* of the band by the drain and held the milk at 1.05 half-widths and beyond at
// full strength (a sky_bed() "riverbed with its banks showing"), to give the emptied channel two
// legible edges. On screen those two banks are two soft pale vertical shafts 9° either side of the
// milk river for the whole of pour and river — the piece's one permitted vertical light is the milk
// column (§11.3-11), and §2.2 asks for "a dark empty channel where the band was", not for a lit
// outline of one. The drain is now a plain multiplier on everything skyBand() sums, so the band
// empties whole. What makes the channel read is no longer a pair of lights inside it but its two
// ends: the undrained foot below θd and the half-drained stretch above 40° (§7.3), plus the river
// running down it.
vec3 skyBand(vec3 dir) {
  vec2 c = skyBandCoord(dir);
  float ab = abs(c.y);
  float inside = 1.0 - smoothstep(15.5, 20.5, ab);
  if (inside <= 0.0) return vec3(0.0);
  vec4 tx = textureLod(uBandTex, vec2(c.x / 360.0, (c.y + 15.0) / 30.0), 0.0);
  float dth = abs(mod(c.x - 5.0 + 180.0, 360.0) - 180.0);
  float hw = sky_halfWidth(dth) * (0.88 + 0.24 * tx.b);
  float b = (c.y - (tx.a - 0.5) * 2.5) / hw;
  float prof = sky_cross(b) * (1.0 + 0.15 * exp(-dth * dth / 121.0)) * (0.52 + 0.44 * tx.b);
  // lane sharpening: the texture is magnified 2–4× on screen, so G is re-thresholded against one octave
  // of noise. Lanes live only where the texture does; the shoulder beyond ±13° carries none.
  float lane = smoothstep(0.42, 0.58, tx.g + 0.16 * (sky_vnoise(vec2(c.x * 2.5, c.y * 2.5)) - 0.5));
  lane *= 1.0 - smoothstep(12.5, 15.2, ab);
  float dr = sky_drain(c.x, uClimaxT);
  // §7.3 wants the emptied channel to keep "its dust lanes faintly visible". Full-strength absorption
  // on a channel that is already near the toe takes the last of the milk to black and the lanes vanish
  // with it, so inside the drain the lanes keep their shape at about half depth.
  float laneK = mix(0.8, 0.42, 1.0 - dr);
  // §10.2 writes this term as (0.55 + 0.45.R). R now carries the *soft* dust veil as well as the milk
  // (the texture's two layers, see the band-texture header), so it needs the doc's ratio over a wider
  // swing: the broad graded dust is the half of the Great Rift that must not have an edge, and it can
  // only darken through R. The sharp half is the lane term, still the only hard edge in the band.
  float k = uBandGain * dr * prof
          * (0.40 + 0.60 * tx.r) * (1.0 - laneK * lane) * inside;
  return vec3(0.83879, 0.77577, 0.62396) * k;       // boFinne, linear
}

vec3 skyAirglowP(vec3 dir, float phase) {
  float e = asin(clamp(dir.y, -1.0, 1.0)) * 57.2957795;
  // NAN-GUARD: atan(0, 0) is undefined, and straight up/down is a direction the dome really has.
  float nz = -dir.z + 1e-7;
  float az = abs(dir.x) + abs(nz) > 1e-6 ? atan(dir.x, nz) : 0.0;
  float g = 0.8 * exp(-max(e - 0.8, 0.0) / 1.6) * (1.0 - smoothstep(7.0, 12.0, e))
          + 0.05 * (1.0 - smoothstep(0.8, 7.0, e));   // pedestal: shortened so the 4–6° band does not
                                                       // push §10.2 acc 1's y=192 grid row over 20 luma
  g *= smoothstep(-1.5, 0.0, e);
  float s = sin(e * 2.3 + 0.9 * sin(az * 3.0 + phase) + az * 2.0 + 0.6 * sin(az * 7.0 - phase * 0.7));
  s += 0.5 * sin(e * 4.7 - 1.3 * sin(az * 5.0 - phase * 1.7) + az * 3.0);
  g *= 1.0 + 0.15 * s * smoothstep(0.25, 1.8, e);                  // faint horizontal wave striations
  // NAN-GUARD: uClimaxT belongs to bealach, and smoothstep() of a NaN is undefined (clamp() of one
  // is). This term multiplies the airglow, which covers the bottom third of every frame, so it is
  // read through an is-a-number test first. -1.0 is the no-climax value and the factor is then 1.
  float cT = uClimaxT == uClimaxT ? uClimaxT : -1.0;
  g *= 1.0 - 0.5 * smoothstep(0.0, 1.5, cT) * (1.0 - smoothstep(30.0, 33.0, cT));  // climax hush
  vec3 air = vec3(0.02732, 0.04970, 0.02519);                       // airglow, linear
  vec3 veil = vec3(0.02158, 0.06685, 0.05123);                      // verdigris at 1.3× airglow luminance
  return mix(air, veil, 0.8 * uVeil) * g;
}

vec3 skyAirglow(vec3 dir) {
  return skyAirglowP(dir, 0.0);
}

vec3 otherSky(vec3 dir) {
  return skyAirglow(dir) + skyBand(dir);
}
`;

// ---------------------------------------------------------------------------------------------------
// Dome

export const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
  clip.z = clip.w * 0.999999;   // camera-centred; never far-clipped
  gl_Position = clip;
}
`;

export const DOME_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
${SKY_DECL}
uniform vec3 uPeat;
uniform vec3 uFogColor;
varying vec3 vDir;
${SKY_GLSL}
void main() {
  vec3 dir = sky_unit(vDir);                               // NAN-GUARD: see sky_unit()
  vec3 col = uPeat;
  col += skyAirglowP(dir, uTime * 0.013);
  col += skyBand(dir);
  float e = asin(clamp(dir.y, -1.0, 1.0)) * 57.2957795;
  col = mix(uFogColor, col, smoothstep(-1.2, 0.0, e));    // horizon fog-colour match below 0°
  float h = sky_hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0);
  col *= 1.0 + (h - 0.5) * 0.035;                          // dither
  col += (h - 0.5) * 0.0006;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;

// ---------------------------------------------------------------------------------------------------
// Point sprites (shared fragment): a gaussian core in pixels plus a faint halo, windowed to the quad.

const SPRITE_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vSize;
varying float vSigma;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float q = length(p);
  float r = q * vSize;
  // NAN-GUARD: both gaussians divide by sigma², and at the centre of the sprite r is 0 too, so a
  // zero sigma is 0/0 = NaN rather than a harmless infinity. Every star this module draws sets
  // vSigma ≥ 0.58·dpr, so the floor never touches a sprite that was valid.
  float sg = max(vSigma, 1e-3);
  float core = exp(-r * r / (2.0 * sg * sg));
  float halo = 0.1 * exp(-r * r / (2.0 * 4.0 * sg * sg));
  float win = 1.0 - smoothstep(0.32, 0.5, q);
  gl_FragColor = vec4(vColor * (core + halo) * win, 1.0);
}
`;

export const STARS_VERT = /* glsl */ `
${SHARED_UNIFORMS}
${SKY_DECL}
${SKY_GLSL}
uniform mat3 uSkyRot;
uniform float uTwinkle;
uniform float uStarGain;
uniform float uSkyFade;
uniform float uDpr;
attribute vec3 aColor;
attribute vec4 aInfo;     // mag, onset (s), twinkle flag, seed
varying vec3 vColor;
varying float vSize;
varying float vSigma;
void main() {
  vec3 d = uSkyRot * sky_unit(position);                     // NAN-GUARD: see sky_unit()
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 1400.0, 1.0);
  float mag = aInfo.x;
  // §10.2: size = clamp(k·mag, 1.6, 4.0)·dpr. k·mag straight put the whole faint majority under the
  // 1.6 px floor, where they were dimmed to near nothing; flux then went as mag³ (size², intensity)
  // and the field collapsed to a few bright points on black. The 0.72 power compresses the size range
  // so the faint many actually occupy a sprite, while the bright few still reach the 4 px cap.
  float px = 6.4 * pow(max(mag, 1e-4), 0.72);
  // below 1.6 px: dimmed, not shrunk (§10.2). The exponent is 0.32, not 0.45: these are most of the
  // 7000, and they are the whole subject at the azimuths where neither the band nor its foot is in
  // frame, so the faint majority has to survive the dimming rather than be crushed by it.
  float dim = pow(min(1.0, px / 1.6), 0.32);
  float low = 1.0 - smoothstep(0.02, 0.4, d.y);
  float s = aInfo.w;
  float tw = sin(uTime * (2.3 + 2.9 * s) + s * 71.0) * sin(uTime * (3.1 + 2.3 * fract(s * 13.7)) + s * 17.0);
  float twinkle = 1.0 + uTwinkle * aInfo.z * (1.0 + 1.2 * low) * tw;
  float ext = smoothstep(-0.012, 0.05, d.y);                 // extinction at the horizon
  float fade = uClimaxT >= 0.0 ? 1.0 : smoothstep(aInfo.y, aInfo.y + 1.5, uTime); // dark adaptation, brightest first
  // the climax drains the band's own stars with its milk (the channel reads empty; kindled, harp and
  // named stars stay, §7.3). The band's glow is unresolved starlight, so it pours away with the milk:
  // same drain, faded out across the band's own width so the sky either side keeps every star.
  float drain = 1.0;
  if (uClimaxT >= 8.0 && uClimaxT < 33.0) {
    vec2 bc = skyBandCoord(d);
    drain = mix(1.0, sky_drain(bc.x, uClimaxT), 1.0 - smoothstep(7.0, 12.0, abs(bc.y)));
  }
  float k = ext * fade * uSkyFade * drain;
  vColor = aColor * (uStarGain * mag * dim * twinkle * k);
  vSize = clamp(px, 1.6, 4.0) * uDpr;
  vSigma = max(0.58 * uDpr, vSize * 0.21);   // a brighter star is a wider soft blob, not a harder dot
  gl_PointSize = k > 0.0 ? vSize : 0.0;
}
`;

export const STARS_FRAG = SPRITE_FRAG;

export const KIND_VERT = /* glsl */ `
${SHARED_UNIFORMS}
uniform mat3 uSkyRot;
uniform float uKindGain;
uniform float uSkyFade;
uniform float uFlare31;
uniform float uDpr;
uniform vec3 uTorc;
attribute vec3 aColor;
attribute vec4 aState;    // level, birth time (state.time), mag, kind (0 harp, 1 ember, 2 wish, 3 named, 4 other)
attribute vec4 aFlags;    // anchor (1 = sky), onset (s), active, seed
varying vec3 vColor;
varying float vSize;
varying float vSigma;
void main() {
  // NAN-GUARD: the positive form takes the inactive-slot exit for a non-finite flag as well, so a
  // bad slot can never reach the normalize below. Identical to (aFlags.z < 0.5) for finite values.
  if (!(aFlags.z >= 0.5)) {
    vColor = vec3(0.0);
    vSize = 1.0;
    vSigma = 1.0;
    gl_PointSize = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // NAN-GUARD: normalize() of a zero-length vector is NaN. Pool positions are a unit direction ×
  // starRadius (addStar rejects a non-finite or zero one), so the fallback is unreachable in
  // practice; it is here because this attribute is written at runtime by five other modules.
  float plen = length(position);
  vec3 d = plen > 1e-6 ? position / plen : vec3(0.0, 1.0, 0.0);
  if (aFlags.x > 0.5) d = uSkyRot * d;
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + d * 1400.0, 1.0);
  float kind = aState.w;
  float age = uTime - aState.y;
  float f = (1.0 - smoothstep(0.0, 1.2, age)) * step(0.0, age);           // birth flare
  float kindled = step(0.5, kind) * step(kind, 2.5);                        // ember or wish
  float level = mix(aState.x, 3.0, uFlare31 * kindled);                     // all flare to 3 at T = 31
  float inten = min(mix(level, 3.0, f) * aState.z * uKindGain, 4.0);
  vec3 col = aColor;
  if (kind < 0.5) col = mix(col, uTorc, smoothstep(0.9, 2.6, aState.x));   // ringing harp stars warm to torc
  float fade = uClimaxT >= 0.0 ? 1.0 : smoothstep(aFlags.y, aFlags.y + 1.5, uTime);
  float skyF = aFlags.x > 0.5 ? uSkyFade : 1.0;
  float ext = smoothstep(-0.012, 0.05, d.y);
  vColor = col * inten * fade * skyF * ext;
  vSize = (4.0 + 2.0 * f) * uDpr;                                           // 4 px, 6 px only while flaring
  // DESIGN-QUESTION (§10.2 "size ×4 → 1" vs §11.1 point-size cap): a 4× birth size would be 16 px, and
  // §11.1 caps a star's birth flare at 6 px × dpr. The cap wins: the flare grows to 6 px and widens its
  // gaussian sigma instead, which reads as the same flare without the overdraw.
  float named = step(2.5, kind) * step(kind, 3.5);                           // Vega and Altair: a fuller core
  vSigma = uDpr * (0.72 + 0.1 * min(inten, 3.0)) * (1.0 + 2.2 * f) * (1.0 + 0.45 * named);
  gl_PointSize = vSize;
}
`;

export const KIND_FRAG = SPRITE_FRAG;

// ---------------------------------------------------------------------------------------------------
// Meteors: instanced stretched quads, expanded in screen space.

export const METEOR_VERT = /* glsl */ `
${SHARED_UNIFORMS}
uniform vec2 uRes;
attribute vec3 aA;        // start: camera-relative (ambient) or world (click)
attribute vec3 aB;        // end
attribute vec4 aInfo;     // t0 (state.time), duration, kind (0 ambient, 1 click), brightness
attribute vec4 aParam;    // view depth at A, view depth at B, tail length (screen fraction of the path), width px
varying vec2 vQ;          // x: px along from the tail, y: px across
varying float vLen;
varying float vW;
varying float vFade;
varying float vBright;
void main() {
  float age = (uTime - aInfo.x) / max(aInfo.y, 1e-3);
  // NAN-GUARD: the positive form also takes the early-out when age is not a number — a meteor's
  // duration comes from the music clock, i.e. from another module. Two less/greater tests are both
  // false for a NaN, which would have let it through to the geometry below. Same for finite ages.
  if (!(age >= 0.0 && age <= 1.0 && aInfo.w > 0.0)) {
    vQ = vec2(0.0); vLen = 1.0; vW = 1.0; vFade = 0.0; vBright = 0.0;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  bool click = aInfo.z > 0.5;
  vec2 res = max(uRes, vec2(1.0));   // NAN-GUARD: a 0-px drawing buffer would divide by zero below
  vec3 off = click ? vec3(0.0) : cameraPosition;
  vec4 ca = projectionMatrix * viewMatrix * vec4(aA + off, 1.0);
  vec4 cb = projectionMatrix * viewMatrix * vec4(aB + off, 1.0);
  vec2 na = ca.xy / max(ca.w, 1e-3);
  vec2 nb = cb.xy / max(cb.w, 1e-3);
  // screen parameter of the head: clicks accelerate as they fall, Perseids run evenly
  float uh = click ? mix(age, age * age, 0.35) : age;
  float ut = uh - aParam.z;
  // world point of the head (screen-linear u → world s) for depth
  float zA = aParam.x;
  float zB = aParam.y;
  float s = uh * zA / max(zB * (1.0 - uh) + uh * zA, 1e-3);
  vec4 ch = projectionMatrix * viewMatrix * vec4(mix(aA, aB, s) + off, 1.0);
  vec2 hp = mix(na, nb, uh) * 0.5 * res;
  vec2 tp = mix(na, nb, ut) * 0.5 * res;
  vec2 dv = hp - tp;
  float len = max(length(dv), 1e-3);
  vec2 dirp = dv / len;
  vec2 perp = vec2(-dirp.y, dirp.x);
  float w = aParam.w;
  float along = -w + position.x * (len + 2.0 * w);                 // px from the tail
  float across = position.y * w * 2.0;
  vec2 px = tp + dirp * along + perp * across;
  vQ = vec2(along, across);
  vLen = len;
  vW = w;
  float fin = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(click ? 0.9 : 0.65, 1.0, age));
  // NAN-GUARD: normalize(mix(aA, aB, uh)).y, written out so a zero-length path cannot divide by 0.
  if (!click) {
    vec3 mp = mix(aA, aB, uh);
    fin *= smoothstep(-0.01, 0.03, mp.y / max(length(mp), 1e-6));
  }
  vFade = fin;
  vBright = aInfo.w;
  gl_Position = vec4(px / (0.5 * res) * ch.w, ch.z, ch.w);
}
`;

export const METEOR_FRAG = /* glsl */ `
uniform vec3 uBoFinne;
uniform vec3 uTorc;
varying vec2 vQ;
varying float vLen;
varying float vW;
varying float vFade;
varying float vBright;
void main() {
  float x = vQ.x;
  float y = vQ.y;
  // NAN-GUARD: vLen (px along the streak) and vW (px across) are divisors, and at the tail x and y
  // are 0 as well, so a zero would be 0/0 = NaN rather than an infinity that exp() takes to 0. The
  // vertex stage already floors vLen at 1e-3 and vW is 1.1–1.6 × dpr, so neither floor moves a pixel.
  // The clamp keeps a inside [0, 1], which is what keeps pow()'s base non-negative.
  float len = max(vLen, 1e-3);
  float w2 = max(vW * vW, 1e-6);
  float a = clamp(x / len, 0.0, 1.0);
  float hd = length(vec2(x - vLen, y));
  float head = exp(-hd * hd / (0.9 * w2));
  float body = pow(a, 1.8) * exp(-y * y / (0.3 * w2 * (0.35 + 0.65 * a))) * step(x, vLen + 0.5);
  vec3 col = uBoFinne * 3.0 * head + mix(uTorc * 0.9, uBoFinne * 1.4, a * a) * body;
  gl_FragColor = vec4(col * vFade * vBright, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------------
// Wish arcs: compass-drawn circular arcs between consecutive wish stars.

export const ARC_VERT = /* glsl */ `
attribute float aU;
varying float vU;
void main() {
  vU = aU;
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0);
}
`;

export const ARC_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
uniform float uArcAlpha;
uniform vec3 uTorc;
varying float vU;
void main() {
  float ends = smoothstep(0.0, 0.09, vU) * (1.0 - smoothstep(0.91, 1.0, vU));
  float twist = 0.72 + 0.28 * sin(vU * 70.0 - uTime * 1.3) * sin(vU * 23.0 + uTime * 0.4);
  gl_FragColor = vec4(uTorc * (1.15 * uArcAlpha * ends * twist), 1.0);
}
`;
