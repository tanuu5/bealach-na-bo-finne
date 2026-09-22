// Private GLSL for the `fire` module (docs/DESIGN.md §10.5).
// Chunks here contain functions only; every stage pastes the SHARED-UNIFORMS block it needs (§3.6 R13).

// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
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

// FIRELIGHT v2 — copied verbatim from docs/DESIGN.md §3.6.
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

// Cheap hash / value noise (functions only).
export const NOISE = /* glsl */ `
float fHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float fNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fHash12(i);
  float b = fHash12(i + vec2(1.0, 0.0));
  float c = fHash12(i + vec2(0.0, 1.0));
  float d = fHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = fHash13(i);
  float n100 = fHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = fHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = fHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = fHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = fHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = fHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = fHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}
float fFbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * fNoise2(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(3.7, 1.3);
    a *= 0.5;
  }
  return s / 0.9375;
}
`;

// ───────────────────────── Domain guards ─────────────────────────
// Real hardware interpolates varyings and rasterises with slop that headless SwiftShader never
// reproduces, and GLSL leaves normalize(0), atan(0, 0) and pow(negative, e) undefined. A single NaN
// fragment is then smeared across every bloom mip and the whole frame goes black (the loch/mist.js
// incident). Both helpers return exactly what the raw builtin returns for every input it defines.
export const SAFE = /* glsl */ `
// normalize() with its one undefined case removed. This is the expression a compiler emits for
// normalize(v); it differs only below |v| = 1e-6, where normalize() would return NaN and this returns
// a short but finite vector — which can only ever make one degenerate pixel darker.
vec3 fSafeNorm(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-12)); }
// atan(y, x) with the undefined (0, 0) case pinned to 0. Written as a select rather than the usual
// "nudge x by step(abs(x) + abs(y), 0.0)" because == matches -0.0 as well as +0.0, and because x is
// then handed to atan() untouched — so every input atan() defines is bit-identical by construction,
// rather than by trusting the compiler to fold an added 0.0 away.
float fAtan2(float y, float x) { return atan(y, (x == 0.0 && y == 0.0) ? 1.0 : x); }
`;

// ───────────────────────── Islet + logs (one draw, fog:true) ─────────────────────────
export const ISLET_VERT = /* glsl */ `
attribute float aKind;
varying vec3 vWp;
varying vec3 vN;
varying float vKind;
#include <fog_pars_vertex>
${SAFE}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWp = w.xyz;
  // computeVertexNormals() can hand a welded vertex a zero normal, and normalize(0) is NaN.
  vN = fSafeNorm(mat3(modelMatrix) * normal);
  vKind = aKind;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const ISLET_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
uniform vec3 uLichen;
uniform vec3 uEmberC;
uniform float uGlow;
varying vec3 vWp;
varying vec3 vN;
varying float vKind;
#include <fog_pars_fragment>
${SAFE}
${FIRELIGHT}
${NOISE}
void main() {
  vec3 n = fSafeNorm(vN);
  vec3 wp = vWp;
  vec3 rel = wp - uFirePos;
  float r = length(rel.xz);
  vec3 lit = fireLight(wp, n) + skyAmbient(n);
  float flick = 0.86 + 0.14 * sin(uTime * 11.0) * sin(uTime * 7.3 + 1.7);
  float L = clamp(uFireLevel, 0.0, 1.5);
  vec3 col;
  if (vKind < 0.5) {
    // Islet: flat, pitted lichen stone, sooted under the fire, wet and dark at the waterline.
    float big = fNoise2(wp.xz * 2.1 + 7.0);
    float fine = fNoise2(wp.xz * 9.5 - 3.0);
    // pecked roughness: perturb the normal with a noise gradient
    vec3 bp = wp * 18.0;
    float b0 = fNoise3(bp);
    float bx = fNoise3(bp + vec3(0.35, 0.0, 0.0));
    float bz = fNoise3(bp + vec3(0.0, 0.0, 0.35));
    float by = fNoise3(bp + vec3(0.0, 0.35, 0.0));
    // the perturbation reaches |1.6·√3|, so it can cancel the unit normal exactly: normalize(0) is NaN
    n = fSafeNorm(n - vec3(bx - b0, by - b0, bz - b0) * 1.6);
    lit = fireLight(wp, n) + skyAmbient(n);
    vec3 alb = uLichen * (0.27 + 0.24 * big + 0.1 * (fine - 0.5) + 0.16 * (b0 - 0.5));
    float blotch = smoothstep(0.66, 0.8, fNoise2(wp.xz * 3.7 + 19.0)) * smoothstep(0.85, 1.2, r);
    alb = mix(alb, uLichen * 0.85, blotch * 0.5);
    // faint joints between the slabs
    float seam = abs(fNoise2(wp.xz * 1.4 + 41.0) - 0.5) + (fine - 0.5) * 0.02;
    alb *= mix(0.62, 1.0, smoothstep(0.006, 0.03, seam));
    // soot and ash under the fire
    float scorch = 1.0 - smoothstep(0.3, 1.2, r + (fine - 0.5) * 0.35);
    alb *= mix(1.0, 0.16, scorch * smoothstep(0.2, 0.32, wp.y));
    // wet band at the waterline, weathered vertical streaks on the rim
    // uFirePos is (0, 0.35, 0) and the islet's centre vertex stands on it, so rel.xz really does
    // reach exactly (0, 0) here — and atan(0, 0) is undefined in GLSL.
    float streak = fNoise2(vec2(fAtan2(rel.z, rel.x) * 9.0, wp.y * 2.0));
    alb *= mix(1.0, 0.8 + 0.2 * streak, smoothstep(0.1, 0.5, 1.0 - n.y));
    // A 0.15 m wet band at the waterline (§3.4): darker, and deeper in colour rather than simply
    // greyer — soaked stone keeps the fire's hue instead of going to dead grey.
    float wet = 1.0 - smoothstep(0.0, 0.15, wp.y + (b0 - 0.5) * 0.05);
    vec3 wetAlb = alb * 0.26 + uEmberC * 0.035;
    alb = mix(alb, wetAlb, wet);
    col = alb * lit;
    // Wet stone is glossy: a tight glint plus a broad sheen, so the waterline gleams and carries the
    // eye down into the loch's fire streak instead of ending on a black lip (art review, rev 2).
    vec3 V = fSafeNorm(cameraPosition - wp);
    vec3 Lf = fSafeNorm(uFirePos + vec3(0.0, 1.1, 0.0) - wp);
    // Lf + V is the zero vector on every surface point that lies exactly between the eye and the
    // fire light — a real locus once the camera is moved (?cam=), and normalize(0) is NaN.
    vec3 Hh = fSafeNorm(Lf + V);
    float ndh = max(dot(n, Hh), 0.0);   // pow() below needs a non-negative base
    float glint = (pow(ndh, 46.0) * 1.1 + pow(ndh, 7.0) * 0.18) * wet;
    col += glint * vec3(1.0, 0.45, 0.16) * (0.2 + 0.9 * L) * flick * 0.55;
    // a few live coals in the ash beneath the logs
    float bed = (1.0 - smoothstep(0.08, 0.55, r)) * smoothstep(0.29, 0.33, wp.y);
    float coal = smoothstep(0.58, 0.9, fNoise2(wp.xz * 22.0 + vec2(0.0, uTime * 0.03)));
    float pulse = 0.55 + 0.45 * fNoise2(vec2(uTime * 0.8, r * 5.0 + wp.x * 3.0));
    col += uEmberC * coal * bed * pulse * (0.2 + 1.5 * L) * uGlow;
  } else if (vKind < 1.5) {
    // Logs: charred wood; ember light breathes in thin cracks near the heart of the fire (ember x (1 + 2 level)).
    float grain = fNoise3(wp * vec3(13.0, 13.0, 13.0));
    vec3 alb = uLichen * (0.05 + 0.05 * grain);
    col = alb * lit;
    float ridge = 1.0 - abs(fNoise3(wp * vec3(17.0, 17.0, 17.0) + vec3(0.0, 3.0, 0.0)) * 2.0 - 1.0);
    float ridge2 = fNoise3(wp * 29.0 + vec3(5.0));
    float crack = smoothstep(0.86, 0.965, ridge) * smoothstep(0.3, 0.65, ridge2);
    float heat = 1.0 - smoothstep(0.15, 0.68, r);
    float under = 0.55 + 0.45 * smoothstep(0.3, -0.6, n.y);
    float breathe = 0.5 + 0.5 * fNoise2(vec2(uTime * 1.1 + grain * 2.0, r * 7.0));
    col += uEmberC * (1.0 + 2.0 * L) * crack * heat * under * breathe * uGlow;
    // charcoal glowing at the inner ends, inside the flame
    float endGlow = (1.0 - smoothstep(0.03, 0.34, r)) * smoothstep(0.32, 0.8, grain);
    col += uEmberC * endGlow * (0.35 + 1.5 * L) * uGlow;
  } else {
    // Loose cobbles bedded into the rim: the same lichen stone as the shell, each weathered its own
    // way, so they catch the firelight on their facets and break the silhouette instead of reading
    // as dark holes (art review, rev 2: "a perfectly smooth ellipse of uniform warm brown").
    vec3 bp = wp * 22.0;
    float b0 = fNoise3(bp);
    float bx = fNoise3(bp + vec3(0.3, 0.0, 0.0));
    float bz = fNoise3(bp + vec3(0.0, 0.0, 0.3));
    float by = fNoise3(bp + vec3(0.0, 0.3, 0.0));
    n = fSafeNorm(n - vec3(bx - b0, by - b0, bz - b0) * 1.1);
    lit = fireLight(wp, n) + skyAmbient(n);
    float tone = fNoise2(wp.xz * 2.6 + 13.0);           // roughly one tone per cobble
    vec3 alb = uLichen * (0.24 + 0.34 * tone + 0.18 * (b0 - 0.5));
    float wet = 1.0 - smoothstep(0.0, 0.15, wp.y + (b0 - 0.5) * 0.05);
    alb = mix(alb, alb * 0.28 + uEmberC * 0.035, wet);
    col = alb * lit;
    vec3 V = fSafeNorm(cameraPosition - wp);
    vec3 Lf = fSafeNorm(uFirePos + vec3(0.0, 1.1, 0.0) - wp);
    float spec = pow(max(dot(n, fSafeNorm(Lf + V)), 0.0), 24.0);
    col += spec * vec3(1.0, 0.42, 0.14) * (0.1 + 0.55 * L) * flick * (0.25 + 0.75 * wet) * 0.35;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// ───────────────────────── Flame (two Y-billboard quads, additive) ─────────────────────────
export const FLAME_VERT = /* glsl */ `
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFlameH;     // quad height (m): mix(1.4, 3.2, clamp(level, 0, 1))
uniform float uFlameW;     // quad half-width (m): 0.6 at idle (the §10.5 1.2 m quad), wider only for surges
attribute vec2 aCorner;    // x -1..1 across, y 0..1 up
attribute float aLayer;    // 0 = outer envelope, 1 = hot core
varying vec2 vP;
varying vec2 vC;
varying float vLayer;
void main() {
  vec3 base = uFirePos + vec3(0.0, -0.04, 0.0);
  vec3 toCam = cameraPosition - base;
  toCam.y = 0.0;
  float lc = length(toCam);
  vec3 fwd = lc > 1e-4 ? toCam / lc : vec3(0.0, 0.0, 1.0);
  vec3 right = vec3(fwd.z, 0.0, -fwd.x);
  // §10.5 sizes the quad 1.2 m wide; uFlameW keeps that at idle and only widens it for the taller
  // surge flames, so a 3.2 m flame is not forced into a 1.2 m box (which is what made it read as a jet).
  float halfW = uFlameW * mix(1.0, 0.92, aLayer);
  float h = uFlameH;
  vec3 wp = base + right * (aCorner.x * halfW) + vec3(0.0, aCorner.y * h, 0.0) + fwd * mix(-0.05, 0.07, aLayer);
  vP = vec2(aCorner.x * halfW, aCorner.y * h);
  vC = aCorner;
  vLayer = aLayer;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const FLAME_FRAG = /* glsl */ `
uniform float uTime;       // ctx.uniforms.uTime
uniform float uVeil;       // ctx.uniforms.uVeil
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform float uFlameV;     // visible flame height (m)
uniform float uFlameW;     // quad half-width (m); the burning bed is 0.55 of it
uniform float uGlow;       // hover / reduced-motion beckon glow
uniform vec3 uEmberC;
uniform vec3 uTorcC;
uniform vec3 uBoFinneC;
varying vec2 vP;
varying vec2 vC;
varying float vLayer;
${NOISE}

// Three tongues. Each stands at its own place on the fuel and runs on its own clock, so they rise,
// detach and die out of step with one another (art review, rev 2).
const vec3 T_X     = vec3(-0.46, 0.06, 0.42);   // x on the fuel, in bed half-widths
const vec3 T_PER   = vec3( 0.95, 0.72, 0.84);   // parcel period (s)
const vec3 T_RISE  = vec3( 0.66, 0.78, 0.60);   // how far it reaches, x uFlameV
const vec3 T_GIRTH = vec3( 0.92, 1.00, 0.84);

void main() {
  float L = clamp(uFireLevel, 0.0, 1.5);
  float hv = max(uFlameV, 0.05);
  float lay = vLayer;
  float t = uTime + lay * 13.7;
  vec2 p = vP;
  float yy = p.y / hv;
  if (yy > 1.35) discard;
  float ay = max(yy, 0.0);
  float spd = mix(1.0, 1.32, lay) * (0.85 + 0.25 * min(L, 1.2));
  // half-width of the burning bed. Floored so a uFlameW of 0 (a uniform never yet written) cannot
  // make the 0 / 0 below; uFlameW is ≥ 0.6 in practice, so the floor never bites.
  float bw = max(uFlameW, 1e-3) * 0.55;

  // Lateral advection: a slow gust leans the whole fire while waves travelling up the tongues curl
  // them, so nothing rises straight (art review, rev 2: "no lick or curl, the profile of a blowtorch").
  float gust = (fNoise2(vec2(t * 0.26, 11.0 + lay * 2.0)) - 0.5) * 2.0;
  float curl = (fNoise2(vec2(p.y * 1.5 - t * spd * 1.2, 23.0 + lay * 3.0)) - 0.5) * 2.0;
  float x = p.x - (gust * 0.22 * ay * ay + curl * 0.13 * ay) * min(hv, 2.6);

  // Turbulence: vertically stretched fbm scrolling up; a second warped layer on high quality.
  float n = fFbm2(vec2(p.x * 3.4 + lay * 7.7, p.y * 1.5 - t * spd * 1.5));
#if FLAME_LAYERS > 1
  float n2 = fFbm2(vec2(p.x * 7.0 + (n - 0.5) * 2.4 + 3.3, p.y * 3.1 - t * spd * 3.9));
  n = mix(n, n2, 0.42);
#endif

  // The burning bed on the logs: always alight, and what gives the fire its width.
  float bedH = hv * 0.30;
  float bedD = length(vec2(x / (bw * 1.18), max(p.y - 0.02, 0.0) / bedH));
  float dens = 1.0 - smoothstep(0.28, 1.12, bedD);

  // Parcel trains: each leaves the bed, stretches as it climbs, pinches off and dies.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float per = T_PER[i] * mix(1.2, 0.85, min(L, 1.0));
    for (int j = 0; j < 2; j++) {
      float tt = t / per + fi * 0.37 + float(j) * 0.5 + lay * 0.23;
      float kk = floor(tt);
      float a = fract(tt);
      float h1 = fHash12(vec2(kk, fi * 4.0 + float(j) * 1.7 + lay * 9.0));
      float h2 = fHash12(vec2(kk + 31.0, fi * 2.3 + float(j) * 5.3 + lay * 3.0));
      // pow() of a negative base is NaN in GLSL. fract() cannot return one, but the base is floored
      // anyway so no later edit can reopen it; max() is a no-op for every value fract() gives.
      float yc = T_RISE[i] * (0.80 + 0.36 * h1) * hv * pow(max(a, 0.0), 0.82);
      float w = bw * T_GIRTH[i] * (0.50 + 0.34 * h2) * (1.0 - 0.42 * a);
      float hh = hv * (0.15 + 0.11 * a) * (0.82 + 0.36 * h1);
      // it keeps drifting the way the gust pushed it as it left the fuel
      float xc = T_X[i] * bw * (0.9 + 0.25 * h2)
               + (gust * 0.5 + (h1 - 0.5) * 0.9) * a * a * min(hv, 2.6) * 0.16;
      vec2 q = vec2((x - xc) / max(w, 1e-3), (p.y - yc) / max(hh, 1e-3));
      float fade = smoothstep(0.0, 0.13, a) * (1.0 - smoothstep(0.46, 1.0, a));
      dens = max(dens, (1.0 - smoothstep(0.22, 1.12, length(q))) * fade);
    }
  }

  // The turbulence bites in, harder the higher it goes: the tips shred into separate licks.
  dens -= (0.60 - n) * (0.26 + 0.82 * smoothstep(0.05, 0.95, ay));
  dens = clamp(dens, 0.0, 1.0);
  dens *= smoothstep(0.0, 0.05, yy);
  // keep the quad edges invisible
  dens *= (1.0 - smoothstep(0.86, 1.0, vC.y)) * (1.0 - smoothstep(0.84, 1.0, abs(vC.x)));
  if (dens < 0.004) discard;

  // Temperature: a small kernel on the fuel, cooling fast upward and outward, so about 70% of the
  // flame body sits in the ember -> torc part of the ramp instead of a white slab (art review, rev 2).
  // the kernel grows more slowly than the flame, so a surge does not become a white slab either
  float up = clamp(p.y / (hv * 0.62 * mix(1.0, 0.78, min(L, 1.0))), 0.0, 1.0);
  float mid = clamp(0.34 + 0.66 * (1.0 - abs(x) / max(bw * 1.3, 1e-3)), 0.0, 1.0);
  float hot = clamp(dens * (1.0 - 0.76 * up) * mid, 0.0, 1.0);

  // Blackbody ramp ember -> torc -> boFinne (white-gold above level 1, +0.2 V).
  float wg = smoothstep(1.05, 1.5, L) + 0.2 * uVeil;
  vec3 cLow = uEmberC * 0.85;
  vec3 cMid = mix(uEmberC, uTorcC, 0.62);
  vec3 cHi = mix(uTorcC * 1.35, uBoFinneC * 1.5, clamp(0.10 + 0.9 * wg, 0.0, 1.0));
  vec3 c = mix(cLow, cMid, smoothstep(0.06, 0.46, hot));
  c = mix(c, cHi, smoothstep(0.72, 0.97, hot));

  // The wide body stays under the bloom threshold; only the narrow kernel goes HDR (up to x6 white-gold).
  float Lc = min(L, 1.0);
  float envI = 0.62 + 0.55 * Lc;
  float h4 = hot * hot * hot * hot;
  float I = envI * (0.90 + h4 * (0.9 + 0.6 * Lc) + h4 * hot * hot * 3.0 * smoothstep(1.0, 1.5, L))
          * mix(0.66, 1.0, lay) * uGlow;
  gl_FragColor = vec4(c * I * smoothstep(0.0, 0.30, dens), 1.0);
}
`;

// ───────────────────────── Sparks (GPU-stateless Points) ─────────────────────────
export const SPARK_VERT = /* glsl */ `
uniform float uTime;       // ctx.uniforms.uTime
uniform float uEnergy;     // ctx.uniforms.uEnergy
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform vec3 uBursts[8];   // (startTime, strength, kind) kind: 0 tap, 1 plume, 2 ghost tap, 3 ghost plume
uniform float uRate;       // idle-stream active fraction
uniform vec3 uHold;        // (startTime, amount 0..1, ghost)
uniform float uTapCount;
uniform float uPlumeCount;
uniform float uPx;         // device px per metre at 1 m
uniform float uDpr;
uniform float uFlameV;
uniform vec3 uEmberC;
uniform vec3 uTorcC;
uniform vec3 uVerdigrisC;
attribute vec4 aData;      // x: group (-2 hold orbit, -1 idle stream, 0..7 burst slot), y: index in group, z/w: seeds
attribute vec3 aSeed;
varying vec3 vCol;
${NOISE}
const float TAU = 6.2831853;
void main() {
  float grp = aData.x;
  float idx = aData.y;
  vec3 wp = vec3(0.0);
  float alive = 0.0;
  float heat = 1.0;
  float inten = 1.0;
  float ghost = 0.0;
  float sizeM = 0.045;
  vec2 fire = uFirePos.xz;

  if (grp < -1.5) {
    // Hold: embers orbit the flame in a rotating triskele (three arms reaching r = 1.6 m).
    float amt = uHold.y;
    if (amt > 0.001) {
      float ht = uTime - uHold.x;
      float arm = mod(idx, 3.0);
      float u = fract(aData.z + ht * mix(0.22, 0.4, aSeed.x));
      float ang = ht * 1.25 + arm * TAU / 3.0 + u * 2.6 + (aSeed.y - 0.5) * 0.3;
      float r = 1.6 * (0.22 + 0.78 * u) + (aSeed.z - 0.5) * 0.12;
      float y = uFirePos.y + 0.45 + 1.15 * u + sin(uTime * 2.7 + aSeed.z * TAU) * 0.07;
      wp = vec3(fire.x + r * sin(ang), y, fire.y - r * cos(ang));
      alive = amt * smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.7, 1.0, u));
      heat = 1.0 - 0.75 * u;
      ghost = uHold.z;
      inten = 1.1;
      sizeM = 0.055;
    }
  } else if (grp < -0.5) {
    // Idle stream: sparks pop in small clusters, like a log cracking.
    float cl = floor(idx / 4.0);
    float hc1 = fHash12(vec2(cl, 1.7));
    float hc2 = fHash12(vec2(cl, 9.1));
    float P = mix(4.2, 11.0, hc1);
    float tt = uTime + hc2 * P;
    float k = floor(tt / P);
    float L = mix(1.5, 4.0, aData.z);
    float age = tt - k * P - aSeed.x * 0.14;
    float act = step(fHash12(vec2(cl * 1.31 + 0.5, k)), uRate) * step(fHash12(vec2(idx * 0.917 + 3.1, k)), 0.7);
    if (act > 0.5 && age > 0.0 && age < L) {
      float h1 = fHash12(vec2(idx + 0.11, k));
      float h2 = fHash12(vec2(idx + 0.37, k));
      float h3 = fHash12(vec2(idx + 0.73, k));
      float h4 = fHash12(vec2(idx + 0.91, k));
      float a = age / L;
      float r0 = 0.2 * sqrt(max(h1, 0.0));   // sqrt() of a negative is NaN
      float th0 = TAU * h2;
      float vt = mix(0.8, 2.3, h3) * (0.75 + 0.35 * min(uFireLevel, 1.5));
      float tau = 0.5;
      float y = uFirePos.y + 0.3 + uFlameV * 0.45 * h4 + vt * age + vt * 1.3 * tau * (1.0 - exp(-age / tau));
      // triskele flow: three slowly rotating arms; sparks are swept sunwise and toward the arms
      float rel = th0 - uTime * 0.35;
      float th = th0 + age * (0.7 + 0.6 * h1) - sin(3.0 * rel) * 0.3 * a;
      float r = r0 + age * (0.12 + 0.2 * (0.5 + 0.5 * cos(3.0 * rel))) * (0.6 + h4);
      vec2 jit = (vec2(fNoise2(vec2(age * 1.9, idx)), fNoise2(vec2(idx, age * 1.9 + 5.0))) - 0.5) * 0.6 * a;
      wp = vec3(fire.x + r * sin(th) + jit.x, y, fire.y - r * cos(th) + jit.y);
      alive = (1.0 - smoothstep(0.62, 1.0, a)) * smoothstep(0.0, 0.04, age);
      heat = 1.0 - a;
      inten = 0.9;
    }
  } else {
    int s = int(grp + 0.5);
    vec3 b = uBursts[s];
    float kind = b.z;
    float plume = mod(kind, 2.0);
    ghost = step(1.5, kind);
    float count = plume > 0.5 ? uPlumeCount : uTapCount;
    float L = mix(mix(1.6, 2.4, plume), 4.0, aData.z); // lifetime 1.5–4 s (§10.5); plume sparks skew longer
    float age = uTime - b.x - aSeed.x * 0.16;
    if (b.y > 0.0 && idx < count && age > 0.0 && age < L) {
      // Burst: three coherent helical arms (a triskele seen from above) rising up to 30 m (tap) / 60 m (plume).
      float a = age / L;
      float arm = mod(idx, 3.0);
      float Ymax = mix(30.0, 60.0, plume) * mix(0.3, 1.0, pow(max(aData.w, 0.0), 0.6));
      // a short pop out of the flame, then the plume carries them, accelerating upward.
      // L is ≥ 1.6 here, so the divisor is ≈ 0.995 and the floor never bites; the pow() bases are
      // both non-negative for the same reason, and are floored so they cannot stop being so.
      float pop = (1.0 - exp(-age / 0.3)) / max(1.0 - exp(-L / 0.3), 1e-3);
      float yN = 0.12 * pop + 0.88 * pow(max(a, 0.0), 1.6);
      float y = uFirePos.y + 0.4 + uFlameV * 0.45 + Ymax * yN;
      float lead = aData.w; // faster sparks lead their arm
      float th = TAU * fract(b.x * 0.6180339) + arm * TAU / 3.0 + (aSeed.y - 0.5) * 0.28 + age * (2.3 - 1.0 * a) + lead * 1.1;
      float R = mix(2.2, 3.8, plume) * mix(0.6, 1.0, aSeed.z);
      float r = 0.1 + R * (1.0 - exp(-age / 0.38)) * (0.75 + 0.35 * a);
      vec2 jit = (vec2(fNoise2(vec2(age * 1.3, idx + float(s) * 7.0)), fNoise2(vec2(idx + 13.0, age * 1.3))) - 0.5) * 0.7 * a;
      wp = vec3(fire.x + r * sin(th) + jit.x, y, fire.y - r * cos(th) + jit.y);
      alive = (1.0 - smoothstep(0.55, 1.0, a)) * smoothstep(0.0, 0.03, age) * b.y;
      heat = 1.0 - a;
      inten = 1.6;
      sizeM = 0.085;
    }
  }

  if (alive < 0.004) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vCol = vec3(0.0);
  } else {
    vec3 hot = uTorcC * 2.6;
    vec3 cool = uEmberC * 0.75;
    vec3 c = mix(cool, hot, smoothstep(0.3, 0.95, heat));
    c = mix(c, uVerdigrisC * mix(0.7, 1.6, heat), ghost * 0.94);
    float flick = 0.72 + 0.28 * sin(uTime * (11.0 + 9.0 * aSeed.z) + aSeed.y * TAU); // tumbling, never strobing
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float dist = max(-mv.z, 0.1);
    // floored: a zero device pixel ratio would collapse the clamp range to [0, 0] and make the
    // px / ps below 0 / 0 = NaN for every spark at once. uDpr is ≥ 1 in practice.
    float dpr = max(uDpr, 1e-3);
    float px = sizeM * uPx / dist;
    float ps = clamp(px, 1.6 * dpr, 4.0 * dpr);
    float dim = clamp(px / ps, 0.4, 1.0);
    vCol = c * inten * alive * flick * dim * mix(1.0, 0.6, ghost);
    gl_PointSize = ps;
    gl_Position = projectionMatrix * mv;
  }
}
`;

export const SPARK_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float g = exp(-r2 * 3.2);
  if (g < 0.03) discard;
  gl_FragColor = vec4(vCol * g, 1.0);
}
`;

// ───────────────────────── Ember flights + hill beacons (17 CPU points) ─────────────────────────
export const MOTE_VERT = /* glsl */ `
uniform float uDpr;
attribute vec3 aColor;
attribute float aSize;
attribute float aFog;
attribute float aHalo;     // 0 = ember flight (plain sprite), 1 = hill beacon (core + halo + smudge)
varying vec3 vCol;
varying float vFogMask;
varying float vHalo;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uDpr;
  vCol = aColor;
  vFogMask = aFog;
  vHalo = aHalo;
  #include <fog_vertex>
}
`;

export const MOTE_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vFogMask;
varying float vHalo;
#include <fog_pars_fragment>
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  // Ember flights: one soft gaussian. Hill beacons: a 2–3 px core (§3.4) inside a wide, very faint
  // ember halo, plus a warm smudge smeared on the ridge below it — a fire 420 m away has to read as a
  // light source in the haze, not as a stray red pixel (art review, rev 2).
  float g = exp(-r2 * 2.6);
  if (vHalo > 0.5) {
    vec2 ds = vec2(d.x * 0.62, d.y - 0.15);   // gl_PointCoord.y grows downward, so this sits below
    g = exp(-r2 * 8.0) + exp(-r2 * 1.7) * 0.10 + exp(-dot(ds, ds) * 18.0) * 0.09;
  }
  if (g < 0.02) discard;
  vec3 c = vCol * g;
#ifdef USE_FOG
  #ifdef FOG_EXP2
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  c *= 1.0 - fogF * vFogMask;
#endif
  gl_FragColor = vec4(c, 1.0);
}
`;
