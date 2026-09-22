// GLSL for the terrain module. SHARED-UNIFORMS and FIRELIGHT are copied verbatim from docs/DESIGN.md §3.6.

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

// Domain guards. Real hardware interpolates varyings and computes derivatives with slop that headless
// SwiftShader does not reproduce, and GLSL leaves pow(negative, e), normalize(0) and atan(0, 0) undefined —
// one NaN fragment is then smeared over the whole frame by the bloom's blur (the loch/mist.js incident).
// Both helpers below are written so that every *defined* input returns exactly what the raw builtin returned.
export const SAFE = /* glsl */ `
// normalize() with its one undefined case removed. For any vector of ordinary length this is the same
// expression a compiler emits for normalize(v); it differs only below |v| = 1e-6, where normalize() would
// return NaN and this returns a short but finite vector (which only ever makes a degenerate pixel darker).
vec3 tSafeNorm(vec3 v) { return v * inversesqrt(max(dot(v, v), 1e-12)); }
// atan(y, x) with the undefined (0, 0) case pinned to 0. The added term is exactly 0.0 unless both
// components are exactly 0, so every defined input is bit-identical to atan(y, x).
float tAtan2(float y, float x) { return atan(y, x + step(abs(x) + abs(y), 0.0)); }
`;

// Firelight gate — see the DESIGN-QUESTION below. Included by every shader that calls fireLight().
export const FIREGATE = /* glsl */ `
// DESIGN-QUESTION: §3.6 says the uFireLevel default 0 means "no fire, no firelight when fire is absent", but the
// verbatim FIRELIGHT chunk still returns col * 0.4 at level 0 — warm light from a fire that does not exist, which
// is also what §10.3 acceptance 2 ("No firelight at all … every ground 5×5 mean has R <= G + 2") measures. The
// chunk stays verbatim; every call site in this module multiplies it by tFireOn() instead. The fire module never drives the
// level below 0.15 (§4.3, §7.3 hush), so this only ever fires when the fire module is absent.
float tFireOn() { return smoothstep(0.0, 0.02, uFireLevel); }
`;

// Terrain helpers (functions only).
const COMMON = /* glsl */ `
float tHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tNoise(vec2 p) {                      // one octave of value noise
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = tHash12(i);
  float b = tHash12(i + vec2(1.0, 0.0));
  float c = tHash12(i + vec2(0.0, 1.0));
  float d = tHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Value noise *and* its analytic gradient from the same four corner hashes: (value, d/dpx, d/dpy) in noise
// coordinates. Three finite-difference samples would cost 12 hash calls for the same thing; this costs 4,
// which is what keeps the ground's micro-relief inside the §11.1 budget for a large-area shader.
vec3 tNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = tHash12(i);
  float b = tHash12(i + vec2(1.0, 0.0));
  float c = tHash12(i + vec2(0.0, 1.0));
  float d = tHash12(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k3 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k3 * u.x * u.y,
              du.x * (k1 + k3 * u.y),
              du.y * (k2 + k3 * u.x));
}
// 1 inside a climax cycle (T >= 0) until the 122–126 s fade-out (§10.3).
float tClimaxWin(float T) {
  return step(0.0, T) * (1.0 - smoothstep(122.0, 126.0, T));
}
// Jittered-grid cellular pattern. Returns (f1, f2); writes the winning cell's id, its hash and the
// outward facet normal of that cell at this point, so a packed heap of stones can be lit per stone.
vec2 tCells(vec2 cp, float salt, float squash, out vec2 cid, out float hid, out vec2 nc) {
  vec2 cI = floor(cp);
  vec2 cF = fract(cp);
  float f1 = 8.0;
  float f2 = 8.0;
  cid = cI;
  vec2 dmin = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 dd = g + vec2(tHash12(cI + g + salt), tHash12(cI + g + salt + 19.19)) * 0.8 + 0.1 - cF;
      dd.y *= squash;
      float dist = dot(dd, dd);
      if (dist < f1) { f2 = f1; f1 = dist; cid = cI + g; dmin = dd; }
      else if (dist < f2) { f2 = dist; }
    }
  }
  f1 = sqrt(f1);
  hid = tHash12(cid + salt * 3.0 + 1.7);
  nc = -dmin / max(f1, 1e-3);
  return vec2(f1, sqrt(f2));
}
// Antialiased carved stroke. Once the groove is narrower than a pixel this *dims* it (coverage) instead of
// fattening it to a full-brightness band, so a kerbstone at 55 m reads as a faint carving, never a glowing brick.
float tStroke(float dist, float wid, float aa) {
  float cov = clamp(wid / max(wid + aa * 1.5, 1e-6), 0.0, 1.0);
  return (1.0 - smoothstep(wid * 0.5, wid * 0.5 + aa, dist)) * cov;
}
// Mound passage emission multiplier (× torc): 1.5·V (§4.3), ×1.5 from return through afterglow (§7.3),
// + the 1.5 s mound-tap flash (§6.2). Pure function of uniforms.
float tPassageGlow(float flashT) {
  float open = max(smoothstep(26.0, 27.5, uClimaxT) * tClimaxWin(uClimaxT), uAfterglow);
  float age = uTime - flashT;
  float flash = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.9, 1.5, age));
  return max(1.5 * uVeil, 1.5 * open) + flash;
}
`;

// La Tène three-lobed ground ripple (§6.2): ring + three trumpet lobes rotating sunwise, torc ×0.6 fading.
// uRipple[i] = (x, z, startTime, strength); strength < 0 marks a half-size (mound) ripple.
const RIPPLE = /* glsl */ `
float tRipple(vec2 xz, float fw) {
  float acc = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 rp = uRipple[i];
    float age = uTime - rp.z;
    if (age < 0.0 || age > 1.8) continue;
    float a = age / 1.8;
    float scl = rp.w < 0.0 ? 0.5 : 1.0;
    float str = abs(rp.w);
    float R = 6.0 * scl * (1.0 - (1.0 - a) * (1.0 - a)) + 0.05;
    vec2 d = xz - rp.xy;
    float rho = length(d);
    if (rho > R * 1.45 + 1.8 || rho < 1e-3) continue;
    float th = atan(d.x, -d.y);                         // compass angle: sunwise positive
    float rot = fract(rp.z * 0.618) * 6.2831853 + age * 1.6;  // lobes rotate sunwise
    float lobeF = (th - rot) / 2.0943951;
    float k0 = floor(lobeF);
    float u = lobeF - k0;
    float aa = fw * 1.1 + 1e-4;
    float dRing = rho - R;

    // ── compass-drawn base ring: a hairline that swells only where a trumpet grows out of it, and is
    //    textured like twisted wire (integer frequency, so it is continuous across the atan seam).
    float root = pow(max(0.0, cos((u - 0.06) * 6.2831853)), 3.0);   // swell centred on the trumpet root
    float cord = 0.82 + 0.18 * sin(th * 74.0 + age * 5.0);
    float wR = (0.018 + 0.052 * root) * scl * cord;
    float ring = tStroke(abs(dRing), wR, aa);
    // inner companion hairline, struck from the same compass centre (never touching the outer one)
    float wI = 0.009 * scl;
    float ring2 = tStroke(abs(rho - R * 0.9), wI, aa) * (0.45 - 0.35 * root);

    // ── trumpet: leaves the ring tangentially as a point, swells outward, and is pierced near its mouth by a
    //    lentoid void — the La Tène horn. Built as a disc swept along a centre-line so the mouth end is capped
    //    round; a bare sector test would leave a straight radial seam across the ground.
    float t = clamp(u / 0.66, 0.0, 1.0);                 // 0 at the root, 1 at the mouth
    float over = max(0.0, u - 0.66) * R * 2.2;           // arc distance past the mouth
    float flare = t * t * (3.0 - 2.0 * t);
    float rC = R * (1.0 + 0.30 * flare);                 // centre-line of the horn
    float hw = (0.010 + 0.120 * pow(t, 1.7)) * scl;      // hairline → broad mouth
    float hd = length(vec2(rho - rC, over));
    float horn = (1.0 - smoothstep(hw - aa, hw + aa, hd)) * smoothstep(0.0, 0.10, t);
    float lens = length(vec2((t - 0.82) / 0.17, (rho - rC) / max(hw, 1e-4) * 0.78));
    horn = max(horn - (1.0 - smoothstep(0.55, 0.95, lens)), 0.0);

    // ── soft wash: the ground answering around the drawn line, so it never reads as a decal on black
    float wash = exp(-dRing * dRing / (0.55 * scl)) * 0.085
               + exp(-hd * hd / (0.30 * scl)) * 0.075 * flare;

    float env = smoothstep(0.0, 0.05, a) * pow(max(1.0 - a, 0.0), 1.5);   // a = age/1.8 can land a hair over 1
    acc += (max(max(ring, ring2), horn) + wash) * env * str;
  }
  return acc;
}
`;

// ───────────────────────────── ground ─────────────────────────────
export const groundVertex = /* glsl */ `
attribute vec2 aNoise;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vNoise;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  vNoise = aNoise;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const groundFragment = /* glsl */ `
${SHARED_UNIFORMS}
uniform vec3 uLichen;
uniform vec3 uAirglow;
uniform vec3 uBoFinne;
uniform vec3 uTorc;
uniform vec4 uRipple[6];
uniform float uFlashT;
uniform float uFireBend;
uniform float uBasinAO;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vNoise;
#include <fog_pars_fragment>
${FIRELIGHT}
${FIREGATE}
${SAFE}
${COMMON}
${RIPPLE}
void main() {
  vec3 n = tSafeNorm(vNormal);
  vec2 xz = vWorld.xz;
  float r = length(xz);
  vec2 mq = vec2(xz.x, xz.y + 50.0);
  float dm = length(mq);
  float fw = max(length(fwidth(xz)), 1e-4);
  vec3 V = tSafeNorm(cameraPosition - vWorld);

  // ── surface micro-relief: tussocks, ruts and hoof-churn (§10.3 "no texture" fix). The perturbation is
  //    isotropic on purpose — it gives the meadow value contrast at every distance without biasing the mean
  //    toward the fire, which is what §3.6 forbids ("the fire lights everything the same way").
  //    Scale matters more than amplitude here. This camera sees the near ground at a grazing angle, so one
  //    pixel spans about 0.4 m *along* the view (measured) while only a few millimetres across it: anything
  //    finer than a metre or two of ground is sub-pixel and reads as grain, not as surface. The relief octave
  //    is therefore the broad swell-and-rut scale (~6 m) that actually survives the footprint; finer scales
  //    are carried by albedo contrast below, and by the grass, which is vertical and so is not compressed.
  float relLod = 1.0 - smoothstep(2.5, 8.0, fw);
  vec3 nD = n;
  float tuss = 0.5;
  if (relLod > 0.002) {
    const float RF = 0.16;                           // ~6 m swells
    vec3 nd = tNoiseD(xz * RF + 61.3);
    tuss = nd.x;
    // the churned dancing ground is the most broken of all; the meadow beyond keeps its swells
    float amp = 3.4 * relLod * mix(1.2, 0.85, smoothstep(11.0, 17.0, r));
    nD = tSafeNorm(n + vec3(-nd.y, 0.0, -nd.z) * (RF * amp));
  }
  // hollows between the tussocks are shut off from the sky; crowns see all of it. Mean 1.0, so this is
  // contrast, not a net darkening — it is the only thing that gives the unlit meadow any modelling at all.
  float relAO = mix(1.0, 0.62 + 0.76 * tuss, relLod);
  // fine albedo octaves fade to their mean once a feature is sub-pixel, so the meadow never shimmers
  float lodF = 1.0 - smoothstep(0.10, 0.44, fw);
  float lodM = 1.0 - smoothstep(0.26, 1.05, fw);

  // ── albedo: trampled festival ground → meadow (§10.3), broken up at 0.4–2 m so the surface reads as turf
  // Each octave is skipped once it is LOD-faded out, so the near ground — which is most of the screen and
  // where the footprint is coarsest — pays for two octaves, not four (§11.1: this shader covers a large area).
  float wear = tNoise(xz * 0.62 + 91.0);           // ~1.6 m worn patches / turf clumps
  float detail = 0.5;
  float clod = 0.5;
  float clump = 0.5;
  if (lodM > 0.004) detail = mix(0.5, tNoise(xz * 1.35), lodM);
  if (lodF > 0.004) {
    clod = mix(0.5, tNoise(xz * 4.1 + 17.0), lodF);
    clump = mix(0.5, tNoise(xz * 2.4 - 44.0), lodF);   // ~0.4 m
  }
  float mixN = clamp(vNoise.x + (detail - 0.5) * 0.45 + (wear - 0.5) * 0.55, 0.0, 1.0);
  // trampled earth: worn patches and clods around a mean of lichen·0.55
  vec3 trampled = uLichen * 0.55 * (0.50 + 0.60 * detail + 0.30 * clod + 0.34 * (wear - 0.5)) * (0.8 + 0.4 * vNoise.y);
  vec3 meadow = mix(uAirglow * 0.9, uLichen * 0.45, mixN) * (0.60 + 0.80 * clump) * (0.8 + 0.4 * vNoise.y);
  vec3 alb = mix(trampled, meadow, smoothstep(14.0, 18.0, r + (vNoise.y - 0.5) * 3.0));
  alb *= mix(0.68, 1.30, tuss);                    // tussock crowns pale, hollows dark
  float wet = 1.0 - smoothstep(9.25, 9.65, r);
  alb *= 1.0 - 0.5 * wet;

  // ── quartz facade on the sí mound: front arc ±50°, band d 16–17.7 (§3.4, §10.3)
  vec3 emit = vec3(0.0);
  vec3 nS = nD;              // shading normal (the facade replaces it with its own cobble relief)
  float quartz = 0.0;        // how much of this pixel is dry-stone wall
  float ang = tAtan2(mq.x, mq.y);        // (0,0) on the mound axis is a defined point of the ground grid
  float ta = abs(ang) / 0.8727;
  // FACADE v3 (art call, §10.3): the revetment is a bank of quartz built against the *swelling* front of
  // the mound, not a wall standing on it. Three things were making it read as masonry with a hard top
  // edge: the top course (loD) barely wandered while the footing did, the band held one height right out
  // to the angular cut, and the stone grade was head-sized at 60 m. So now the top course carries the
  // wander, both edges slump down-slope toward the returns until the courses die just above the kerb, and
  // stretches of the quartz are missing under the turf.
  float wobA = tNoise(vec2(ang * 2.6 + 11.0, 0.5)) - 0.5;
  float wobB = tNoise(vec2(ang * 8.1 - 4.0, 2.5)) - 0.5;
  float wobC = tNoise(vec2(ang * 21.0 + 7.0, 5.5)) - 0.5;
  float slump = smoothstep(0.26, 1.0, ta);
  slump *= slump;                                                // an arc into the ground, not a ramp
  float loD = 16.06 + 1.55 * slump - wobA * 0.50 + wobB * 0.28 + wobC * 0.12;  // top course: follows the turf
  float hiD = 17.70 + 0.80 * slump + wobA * 0.20 + wobB * 0.15;                // footing, bedded on the slope
  // Newgrange's quartz was found as a *collapsed scatter*, and that is what kills the last of the stripe:
  // tongues of fallen stone run down the slope below the footing, and the turf has grown down over the
  // top course in patches, so neither margin ever holds one height for long.
  hiD += 1.70 * smoothstep(0.44, 0.88, tNoise(vec2(ang * 7.0 - 5.0, 1.0)));
  loD += 0.95 * smoothstep(0.50, 0.94, tNoise(vec2(ang * 9.3 + 2.0, 3.0)));
  // the arc does not stop on a ruled line: where it ends wanders by a few degrees and then dies over ~9°
  float endA = 0.88 + 0.14 * tNoise(vec2(ang * 6.0 + 31.0, 1.5));
  float ends = 1.0 - smoothstep(endA, endA + 0.17, ta);
  // whole stretches of the revetment are fallen or turfed over, so the band is never a continuous stripe
  float kept = tNoise(vec2(ang * 3.6 + 19.0, dm * 0.62));
  float facade = ends * smoothstep(0.24, 0.46, kept)
               * smoothstep(loD, loD + 0.55, dm)
               * (1.0 - smoothstep(hiD - 0.30, hiD, dm));
  if (facade > 0.0) {
    // A revetment of two stone grades: head-sized boulders (~0.95 m) bedded into a packing of fist-sized
    // quartz cobbles (~0.26 m). One cell size at 50 m is a single spatial frequency, which is exactly what
    // made the old wall read as procedural speckle rather than masonry.
    vec2 bid, sid, ncB, ncS;
    float hB, hS;
    vec2 fB = tCells(vec2(ang * dm, dm) / 0.66, 0.0, 1.15, bid, hB, ncB);
    vec2 fS = tCells(vec2(ang * dm, dm) / 0.185, 7.0, 1.3, sid, hS, ncS);
    float bigHere = step(0.62, tHash12(bid + 41.7));       // ~38% of the wall is boulder-built
    float bDome = smoothstep(0.68, 0.18, fB.x);
    float bMort = smoothstep(0.012, 0.10, fB.y - fB.x);
    float bW = bigHere * bDome * bMort;                    // this pixel belongs to a boulder

    float far = smoothstep(0.095, 0.26, fw);               // once a whole cobble is sub-pixel
    float sz = 0.42 + 1.08 * tHash12(sid + 3.37);   // fist-sized to head-sized, not one grade
    float sDome = smoothstep(0.66 * sz, 0.30 * sz, fS.x);
    float sMort = smoothstep(0.010, 0.085, fS.y - fS.x);
    float hC = mix(hS, hB, bW);
    // Newgrange's wall is white quartz set with rounded grey granite boulders — that contrast is the point.
    float granite = mix(step(0.80, tHash12(sid + 5.11)), step(0.42, tHash12(bid + 9.31)), bW);
    // the facet normal of whichever stone owns this pixel, in (arc, down-slope) space
    vec2 nc = mix(ncS, ncB, bW);
    float shade = clamp(dot(nc, vec2(0.28, -0.96)) * 0.62 + 0.52, 0.0, 1.0);
    // Every term below is *contrast about 1.0*, not a dimmer: the merged build multiplied five sub-unit
    // factors together and left the wall at an effective albedo near 0.045, which is darker than the meadow
    // — that, not the pattern alone, is why the revetment vanished at idle. §3.4 pins the mean at 0.18.
    float relief = mix(mix(0.30, 1.30, sDome * sMort), mix(0.40, 1.26, bDome * bMort), bW);
    float kind = mix(1.0, 0.44, granite);
    float tone = 0.74 + 0.52 * hC;
    // Newgrange's quartz is a *packed scatter*, not coursed masonry: regular horizontal banding at this
    // distance is one of the cues that read as a built wall, so the course term is now a faint, wandering
    // modulation rather than a rhythm.
    float course = 0.97 + 0.034 * sin((dm + 0.45 * tNoise(vec2(ang * 3.3 + 5.0, 0.5))) * 7.6 + tNoise(vec2(ang * 9.0, 3.3)) * 2.0);
    // the revetment is not uniformly kept: stretches of it are mossed over or half fallen
    float cond = 0.58 + 0.82 * tNoise(vec2(ang * 2.1 + 61.0, 0.5));
    float cob = mix(relief * kind * tone * course * cond * (0.52 + 0.96 * shade) * 1.42, 0.70, far);
    // Neither edge is drawn: the turf laps over the top course and the footing beds into the slope, so the
    // band shades out into the mound at both margins instead of ending on a line.
    float turfLap = smoothstep(loD + 0.62, loD + 0.10, dm);
    float bedIn = smoothstep(hiD - 0.52, hiD - 0.04, dm);
    cob *= (1.0 + 0.34) * (1.0 - 0.44 * turfLap) * (1.0 - 0.30 * bedIn);
    alb = mix(alb, uBoFinne * 0.18 * cob, facade);
    quartz = facade * (1.0 - far * 0.35);

    // ── Real relief, not a painted pattern: each stone's own facet normal lights it. The wall's surface
    //    normal is the mound's slope, so the cell normal is lifted into world space along the arc tangent
    //    and the up-slope tangent, and then drives fireLight/skyAmbient like any other geometry.
    vec3 tArc = vec3(cos(ang), 0.0, -sin(ang));
    vec3 tUp = tSafeNorm(cross(tArc, nD));
    float bump = mix(0.55, 0.85, bW) * (1.0 - far);
    nS = tSafeNorm(nD + (tArc * nc.x - tUp * nc.y) * bump);
    float glint = step(0.92, tHash12(sid + 17.3)) * (1.0 - smoothstep(0.0, 0.18, fS.x)) * (1.0 - granite)
                * pow(max(0.0, sin(uTime * (0.35 + 0.6 * hC) + hC * 61.0 + dot(V, vec3(23.0, 11.0, 17.0)))), 12.0);
    emit += uBoFinne * 0.16 * glint * facade * (1.0 - 0.7 * far);
    float T = uClimaxT;
    float win = tClimaxWin(T);
    float pillarG = smoothstep(3.0, 6.0, T) * win;                 // pillar: torc ×0.3
    float sweep = smoothstep(16.0, 17.7, dm);                      // the front runs down the slope
    float facadeG = smoothstep(11.0 + 1.1 * sweep, 12.4 + 1.1 * sweep, T) * win; // pour: boFinne ×1.2, T 11–13.5
    // Each quartz cobble catches the milk on its own dome. §2.3: a bright ×1.2 core only on the lit caps, with
    // the mortar and the granite boulders left near black, so the wall sparkles instead of burning out flat.
    float capM = mix(sDome * sMort, bDome * bMort, bW);
    float cap = (0.10 + 0.90 * capM) * (0.30 + 0.70 * hC * hC) * (1.0 - 0.80 * granite)
              * (0.22 + 0.95 * shade * shade);
    // the lit wall dies away toward the return ends instead of stopping at a vertical line
    float catchL = mix(cap, 0.20, far) * course * (0.45 + 0.55 * sweep) * (1.0 - 0.45 * turfLap)
                 * (1.0 - smoothstep(0.78, 1.0, ta));
    emit += (uTorc * 0.3 * pillarG * (1.0 - facadeG) + uBoFinne * 1.2 * facadeG) * facade * catchL;
  }

  // ── lighting: FIRELIGHT + skyAmbient, both on the micro-relief normal so the ground mottles instead of
  //    reading as one smooth plane. Rev-2 note: uFireBend used to tilt the *whole* flat ground 52° toward
  //    the fire out to r = 17, which made a horizontal surface at 12 m collect ~2.6x the firelight §3.6 gives
  //    any other horizontal surface — §2.3 consequence 1's numbers are for a face *turned to* the fire, and
  //    faking that turn for the meadow is what produced the sandy-desert frame. The bend is now small and
  //    confined to the churned dancing ground inside the bank, where clods and stubble really do stand up.
  vec3 toF = uFirePos + vec3(0.0, 1.1, 0.0) - vWorld;
  vec3 Lh = tSafeNorm(vec3(toF.x, 0.0, toF.z) + vec3(1e-4, 0.0, 0.0));
  float rough = 1.0 - smoothstep(10.4, 14.0, r);
  vec3 nF = tSafeNorm(nS + Lh * uFireBend * rough);
  // the bank crest shields the trampled ground from the horizon glow; released by the time the meadow starts
  float ao = mix(uBasinAO, 1.0, smoothstep(9.0, 14.0, r)) * mix(relAO, 1.0, quartz);
  // Quartz is not matte turf: it is a glassy, translucent scatterer, so a white-quartz revetment catches far
  // more of the night sky than the grass around it. That sheen — on the stones whose shoulders face the sky,
  // dark in the joints between them — is what makes the facade read as a pale band above the kerb from the
  // first frame (§3.4), instead of the dark aggregate the merged build showed at idle.
  float sheen = 1.0 + 1.85 * quartz * clamp(nS.y * 0.6 + 0.55, 0.0, 1.0);
  vec3 light = fireLight(vWorld, nF) * tFireOn() + skyAmbient(nS) * ao * sheen;

  // ── horizon glow and rim on the sí mound (§2.1 lists airglow as "the hill rim, dim grass"; §3.4 gives
  //    the hills an airglow rim for the same reason). The verbatim skyAmbient is a hemisphere fill keyed
  //    on n.y, so the brightest thing it can light is a surface facing the zenith — which at night is the
  //    *darkest* part of the sky. The real glow is the 0–12° band at the horizon (§3.5), and it is caught
  //    by surfaces turned toward it. The mound is the only large tilted turf surface in the piece, and
  //    without this it renders at ≈0.003 linear from crown to foot: below §2.3's 0.005 black point, so
  //    every pixel of it is the grade lift and nothing else — a flat cut-out, whatever its geometry.
  //    Two terms, both confined to the mound (the meadow is flat enough that the same fill would only
  //    raise its mean — §10.3 acceptance 3), and both ≈ 0 on the crown, which keeps the §10.10 contrast:
  //      • toHorizon is the body fill: it rises with the tilt of the micro-relief normal, so the steep
  //        shoulders read and every turf swell picks up its own light. This is what gives the mass form.
  //      • rim is the grazing edge, and it is deliberately *not* a constant-width line — it widens where
  //        the dome's curvature is low and tightens on the steep returns, so it reads as turf catching the
  //        sky rather than as a drawn outline.
  float moundMask = 1.0 - smoothstep(18.5, 23.0, dm);
  if (moundMask > 0.0) {                                   // coherent branch: the mound is a small part of the screen
    float toHorizon = clamp(1.0 - abs(nS.y), 0.0, 1.0);
    light += uAirglow * (9.0 * moundMask * toHorizon * toHorizon * (1.0 - 0.85 * quartz));
    float rim = pow(clamp(1.0 - abs(dot(nS, V)), 0.0, 1.0), 9.0);
    emit += uAirglow * (0.30 * rim * moundMask * (1.0 - quartz));
  }

  // passage glow spills onto the ground in front of the doorway
  float pg = tPassageGlow(uFlashT);
  vec3 Lp = vec3(0.0, 1.0, -30.3) - vWorld;
  float dp2 = dot(Lp, Lp);
  light += uTorc * (pg * 0.9 * clamp(dot(n, Lp) / sqrt(dp2 + 1e-4), 0.0, 1.0) / (1.0 + 2.0 * dp2))
         * smoothstep(-30.9, -30.3, vWorld.z);

  vec3 col = alb * light;

  // wet shore catches the fire
  vec3 Lf = tSafeNorm(toF);
  float spec = pow(max(dot(reflect(-Lf, n), V), 0.0), 24.0);
  col += vec3(1.0, 0.42, 0.14) * spec * wet * 0.12 * uFireLevel;

  col += emit;
  col += uTorc * 0.6 * tRipple(xz, fw);

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// ───────────────────────────── mound set ─────────────────────────────
export const moundVertex = /* glsl */ `
attribute vec3 aInfo;            // type (0 kerb, 1 entrance, 2 passage, 3 plain stone), seed, ignite delay 0..1
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vFaceN;
varying vec3 vInfo;
#include <fog_pars_vertex>
float tHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec3 p = position;
  vec3 q = p;
  float type = aInfo.x;
  float isStone = 1.0 - step(1.5, type) * step(type, 2.5);
  float isEntr = step(0.5, type) * step(type, 1.5);
  // weathered slab: tapered top, crack-free corner jitter (a function of the corner, shared by all faces)
  float top = step(0.0, p.y);
  vec3 sg = sign(p);
  vec3 jit = vec3(tHash13(sg + aInfo.y * 17.0), tHash13(sg * 1.7 + aInfo.y * 29.0), tHash13(sg * 2.3 + aInfo.y * 41.0)) - 0.5;
  q.xz *= 1.0 - isStone * top * mix(0.16, 0.05, isEntr);
  q += isStone * jit * vec3(0.1, 0.12, 0.16) * mix(1.0, 0.25, isEntr) * (0.35 + 0.65 * top);
  q.y -= isStone * isEntr * top * 0.15;     // rounded-down top: the passage glow stays visible above it
  vec4 wp = modelMatrix * instanceMatrix * vec4(q, 1.0);
  vWorld = wp.xyz;
  vLocal = p;
  vFaceN = normal;
  vInfo = aInfo;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const moundFragment = /* glsl */ `
${SHARED_UNIFORMS}
uniform vec3 uLichen;
uniform vec3 uTorc;
uniform sampler2D uSpiralTex;
uniform float uFlashT;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vFaceN;
varying vec3 vInfo;
#include <fog_pars_fragment>
${FIRELIGHT}
${FIREGATE}
${SAFE}
${COMMON}
float tSpiral(vec2 p, float R, float turns, float hand, float wid, float aa) {
  float r = length(p);
  float a = tAtan2(p.y, p.x * hand) / 6.2831853;   // the motif centre is a real point on the face
  float pitch = max(R / turns, 1e-6);
  float s = r / pitch - a;
  float d = abs(fract(s) - 0.5) * pitch;
  return tStroke(d, wid, aa) * (1.0 - smoothstep(R, R + aa + 0.01, r));
}
void main() {
  vec3 n = tSafeNorm(cross(dFdx(vWorld), dFdy(vWorld)));   // edge-on/degenerate triangles give a zero cross
  float type = floor(vInfo.x + 0.5);
  float seed = vInfo.y;
  float front = step(0.5, vFaceN.z);
  float isKerb = 1.0 - step(0.5, type);
  float isEntr = step(0.5, type) * step(type, 1.5);
  float isPass = step(1.5, type) * step(type, 2.5);

  // ── carved motifs: entrance triple spiral (texture), kerb spirals (analytic)
  // The hand-pecked wobble is baked into the canvas paths (terrain/spiral.js): a per-pixel offset here would
  // blow up the texture-lookup derivatives and force the 1×1 mip, turning the stone into one flat gold slab.
  vec4 tx = texture2D(uSpiralTex, vLocal.xy + 0.5);
  vec2 m = vLocal.xy * vec2(1.2, 0.9);                 // kerb face in metres
  float aa = length(fwidth(m)) * 1.2 + 1e-4;
  float variant = fract(seed * 7.31);
  float ks = 0.65 + 0.35 * fract(seed * 3.17);                 // motif scale per stone
  float deco = step(0.3, fract(seed * 13.7)) * (0.45 + 0.55 * fract(seed * 5.3)); // ~30% undecorated, the rest vary
  float kS = tSpiral(m - vec2(0.02, 0.04), 0.3 * ks, 3.0, 1.0, 0.026, aa);
  float kD = max(tSpiral(m - vec2(-0.29, 0.04) * ks, 0.2 * ks, 2.2, 1.0, 0.024, aa), tSpiral(m - vec2(0.29, 0.04) * ks, 0.2 * ks, 2.2, -1.0, 0.024, aa));
  float rc = length(m - vec2(0.0, -0.3));
  float kA = tStroke(abs(fract(rc / 0.085) - 0.5) * 0.085, 0.024, aa) * step(-0.28, m.y) * (1.0 - smoothstep(0.5 * ks, 0.52 * ks, rc));
  float kerbCore = (variant < 0.45 ? kS : (variant < 0.8 ? kD : kA)) * deco;
  float core = front * (isEntr * tx.r + isKerb * kerbCore);
  float halo = front * (isEntr * tx.g + isKerb * kerbCore * 0.3);
  // pecked grooves: 1–1.5 cm pick marks with varying depth; averaged once they are sub-pixel
  vec2 pk = floor(vLocal.xy * vec2(170.0, 85.0));
  float peckH = tHash12(pk + seed * 91.0);
  float peck = mix(step(0.38, peckH) * (0.55 + 0.45 * tHash12(pk + 7.7)), 0.5, smoothstep(0.004, 0.014, aa));

  // ── albedo
  float blot = tNoise(vWorld.xz * 2.7 + vec2(vWorld.y * 3.1, seed * 37.0));
  vec3 alb = uLichen * (0.5 + 0.35 * tNoise(vWorld.xy * 5.3 + vec2(seed * 11.0, vWorld.z * 4.1)));
  alb *= 1.0 + 0.3 * smoothstep(0.6, 0.8, blot);
  alb *= 1.0 - 0.45 * core;
  alb *= mix(0.5, 1.0, smoothstep(-0.5, -0.05, vLocal.y));   // earth-stained foot
  alb = mix(alb, uLichen * 0.02, isPass);

  // ── light
  float pg = tPassageGlow(uFlashT);
  vec3 Lp = vec3(0.0, 1.05, -30.5) - vWorld;
  float dp2 = dot(Lp, Lp);
  vec3 spill = uTorc * pg * 0.8 * clamp(dot(n, Lp) / sqrt(dp2 + 1e-4), 0.0, 1.0) / (1.0 + 3.0 * dp2);
  // A kerbstone's weathered upper surface is wet and lichened and turns straight up at the horizon glow, so
  // the course reads as a line of individual boulders with lit tops rather than a row of flat dark ovals.
  float topCatch = isKerb * pow(max(n.y, 0.0), 2.6) * (0.45 + 0.95 * fract(seed * 23.9));
  vec3 col = alb * (fireLight(vWorld, n) * tFireOn() + skyAmbient(n) * (1.0 + 1.1 * topCatch) + spill * (1.0 - isPass));

  // ── emission
  float T = uClimaxT;
  float win = tClimaxWin(T);
  // §10.3: ignite over T 11–13.5. The kerb sweeps back-to-front across that window (the river runs crown →
  // entrance), but the entrance stone's triple spiral kindles across the *whole* window rather than waiting
  // for its waypoint at T = 13.5 — §7.3 hands the beat to the land as the front crosses the crown at T = 12,
  // and §10.8 acceptance 1 samples the entrance stone at exactly T = 12, where the merged build was still dark.
  float g0 = mix(11.0 + 1.3 * vInfo.z, 11.0, isEntr);
  float glowS = smoothstep(g0, mix(g0 + 1.2, 13.5, isEntr), T) * win;
  // §2.3: a narrow torc x2.5 core (which blooms) inside a wider x0.55 falloff (which stays saturated gold)
  col += uTorc * (2.5 * core * peck + 0.55 * halo) * glowS;
  // Passage recess: a dark opening with light coming up the passage from deep inside the mound — bright and
  // warm low and on the axis, falling away into the jambs and the lintel shadow, never a flat gold plate.
  // The entrance stone stands in front of the recess and hides its lower 0.9 m, so the glow is centred on the
  // part that is actually an opening (world y ≈ 1.45) and dies into the jambs and the lintel shadow.
  vec2 pq = vec2(vLocal.x / 0.46, (vLocal.y - 0.17) / 0.40);
  float rad = length(pq * vec2(1.0, 0.85));
  float throat = 1.0 - smoothstep(0.22, 1.18, rad);                  // light from deep inside the passage
  float pool = (1.0 - smoothstep(0.0, 0.62, abs(pq.x))) * (1.0 - smoothstep(-1.25, -0.30, pq.y));
  float jamb = smoothstep(1.34, 1.02, abs(vLocal.x / 0.5)) * smoothstep(1.22, 0.96, abs(vLocal.y / 0.5));
  float depth = 0.22 + 0.85 * throat + 0.25 * pool;
  col += isPass * mix(uTorc, vec3(1.0, 0.86, 0.62), 0.10 * throat) * pg * depth * mix(0.30, 1.0, jamb);

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

// ───────────────────────────── hills ─────────────────────────────
export const hillsVertex = /* glsl */ `
attribute vec3 aRim;             // x: metres below the ridge crest at this φ; y: tone noise; z: ridge height 0..1
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vRim;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normal;
  vRim = aRim;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const hillsFragment = /* glsl */ `
${SHARED_UNIFORMS}
uniform vec3 uLichen;
uniform vec3 uAirglow;
uniform float uRimGain;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vRim;
#include <fog_pars_fragment>
${FIRELIGHT}
${FIREGATE}
${SAFE}
void main() {
  vec3 n = tSafeNorm(vNormal);
  vec3 alb = mix(uLichen * 0.3, uAirglow * 0.55, vRim.y);
  vec3 col = alb * (fireLight(vWorld, n) * tFireOn() + skyAmbient(n));
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  // Airglow gathering behind the ridge, applied after fog so the silhouette edge reads (§10.3, §2.3-3).
  // This is an atmospheric depth term, not a stroke: it decays exponentially over ~5 m of ridge height
  // (8–14 px at r = 420 in the default frame), thickens in the hollows and thins on the high spurs, so the
  // hill reads as a lit edge with air behind it rather than the constant-width outline the merged build drew.
  // It is raised to sit at or just above the sky it hides, so the ridge line *adds* to the horizon glow.
  float rim = exp(-vRim.x / 5.0) * mix(1.25, 0.62, vRim.z) * (0.66 + 0.68 * vRim.y);
  gl_FragColor.rgb += uAirglow * uRimGain * rim;
}
`;

// ───────────────────────────── grass ─────────────────────────────
export const grassVertex = /* glsl */ `
${SHARED_UNIFORMS}
uniform vec3 uLichen;
uniform vec3 uAirglow;
uniform vec3 uTorc;
uniform vec3 uVerdigris;
uniform vec4 uRipple[6];
uniform float uWind;
uniform float uViewportH;
attribute vec4 aOffset;          // x, y, z, yaw
attribute vec4 aShape;           // height, width, lean, seed
varying vec3 vCol;
#include <fog_pars_vertex>
${FIRELIGHT}
${FIREGATE}
${SAFE}
void main() {
  float f = position.y;
  float seed = aShape.w;
  vec3 base = aOffset.xyz;
  float yaw = aOffset.w;
  vec3 fwd = vec3(-sin(yaw), 0.0, cos(yaw));
  float h = aShape.x;

  // Three blade silhouettes from the instance seed (§3.4): a narrow spear, a plain blade and a broad flag.
  // The baked 5-vertex taper is replaced by this profile so tufts stop reading as one repeated stamp.
  float form = fract(seed * 3.77);
  float widen = mix(0.75, 2.05, form);
  float keel = mix(1.5, 0.35, form);                      // the spear narrows early, the flag stays broad
  float wProf = widen * pow(max(1.0 - f, 0.0), keel) + 0.06;
  float xs = sign(position.x) * 0.5;                      // 0 at the tip vertex
  // blades curl as they rise, so a tuft shows edges as well as faces
  float twist = (fract(seed * 13.1) - 0.5) * 2.2 * f * f;
  vec3 side = vec3(cos(yaw + twist), 0.0, sin(yaw + twist));

  // wind: sway amplitude 0.4 → 1.0 with E (§4.3)
  float amp = mix(0.4, 1.0, uEnergy) * uWind;
  float ph = dot(base.xz, vec2(0.23, 0.17));
  float gust = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.9 + seed * 6.2831) * 0.4;
  vec3 disp = fwd * aShape.z + vec3(0.8, 0.0, 0.35) * gust * 0.09 * amp;

  // ripple flicks: blades bow outward as the ring passes and their tips catch the gold
  float glow = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 rp = uRipple[i];
    float age = uTime - rp.z;
    if (age < 0.0 || age > 1.8) continue;
    float a = age / 1.8;
    float scl = rp.w < 0.0 ? 0.5 : 1.0;
    float R = 6.0 * scl * (1.0 - (1.0 - a) * (1.0 - a)) + 0.05;
    vec2 d = base.xz - rp.xy;
    float rho = length(d) + 1e-4;
    float x = (rho - R) / (0.5 * scl);
    float band = exp(-x * x);
    float env = pow(max(1.0 - a, 0.0), 1.5) * abs(rp.w);   // a = age/1.8 can land a hair over 1
    disp.xz += d / rho * band * env * 0.2 * scl;
    glow += band * env;
  }

  vec3 tipOff = disp * f * f;
  vec4 mvBase = viewMatrix * vec4(base + vec3(0.0, h * 0.5, 0.0), 1.0);
  float ppu = projectionMatrix[1][1] * max(uViewportH, 1.0) * 0.5 / max(-mvBase.z, 0.5);
  float wEff = max(aShape.y * wProf, 1.1 / max(ppu, 1e-4));   // never thinner than ~1 px (0 px tall => no Inf)
  vec3 wp = base + side * (xs * wEff) + vec3(0.0, h * f, 0.0) + tipOff;
  wp.y -= dot(tipOff.xz, tipOff.xz) / max(h, 0.05) * 0.5;

  // per-vertex lighting (thin blades: lit from whichever side faces the fire)
  vec3 toF = uFirePos + vec3(0.0, 1.1, 0.0) - wp;
  vec3 nG = tSafeNorm(tSafeNorm(vec3(toF.x, 0.0, toF.z) + vec3(1e-4, 0.0, 0.0)) * 0.8 + vec3(0.0, 0.6, 0.0));
  // §3.4: dark airglow/lichen blades with *firelit tips*. The tip weighting is what makes the near meadow
  // catch the fire and the far meadow stay green-black — fireLight already carries the distance falloff.
  vec3 lit = fireLight(wp, nG) * tFireOn() * mix(0.08, 2.2, f * f) + skyAmbient(vec3(0.0, 1.0, 0.0)) * mix(0.4, 1.05, f);
  float tone = fract(seed * 7.13);
  vec3 alb = mix(uAirglow * 0.8, uLichen * 0.5, tone) * mix(0.45, 1.35, f);
  float tip = smoothstep(0.6, 1.0, f);
  // coherent shimmer: slow bands rolling across the meadow with the wind, not per-blade sparkle
  float shimmer = 0.5 + 0.5 * sin(uTime * 0.9 - dot(base.xz, vec2(0.33, 0.15)) + seed * 0.22);
  shimmer *= shimmer;
  vCol = alb * lit
       + uVerdigris * 0.6 * uVeil * tip * shimmer          // tips shimmer verdigris with the veil (§4.3)
       + uTorc * 0.6 * min(glow, 1.0) * tip;               // ripple passing

  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const grassFragment = /* glsl */ `
varying vec3 vCol;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vCol, 1.0);
  #include <fog_fragment>
}
`;
