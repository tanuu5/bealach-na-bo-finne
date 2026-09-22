// GLSL for the stones module (docs/DESIGN.md §3.6, §10.6). Private helper of src/modules/stones.js.

const SHARED_UNIFORMS = /* glsl */ `
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

const FIRELIGHT = /* glsl */ `
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

const NOISE = /* glsl */ `
float st_hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float st_vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n000 = st_hash13(i);
  float n100 = st_hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = st_hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = st_hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = st_hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = st_hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = st_hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = st_hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
             mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
`;

// Domain guard for every normalize() in this module. `normalize(v)` is NaN for a zero-length v, and a
// single NaN fragment is smeared over the whole frame by the bloom's mip chain (the mist.js incident).
// st_dir is *exactly* normalize(v) wherever normalize is defined, and a chosen direction where it is not,
// so it can never change the render — only the invalid case.
const SAFE = /* glsl */ `
vec3 st_dir(vec3 v, vec3 fallbackDir) {
  float l2 = dot(v, v);
  return l2 > 1e-30 ? normalize(v) : fallbackDir;
}
`;

// ---------------------------------------------------------------------------------------------
// Stones: one InstancedMesh of a subdivided unit box, shaped into weathered tapered slabs here.
// Per instance:
//   aDims   (w, Ht = h + burial, t, id)
//   aShape  (top width ratio, crown roundness, crown slant, seed)
//   aShape2 (gable, gable offset, chipped shoulder side −1/0/+1, top thickness ratio)
//   aOgham  (edge sign ±1 upright arris / 0 recumbent top arris, inscription start, end (m along the arris), portal jamb flag)
// ---------------------------------------------------------------------------------------------
export const STONE_VERT = /* glsl */ `
attribute vec4 aDims;
attribute vec4 aShape;
attribute vec4 aShape2;
attribute vec4 aOgham;

varying vec3 vWorld;
varying vec3 vQ;
varying vec3 vObj;
varying vec4 vInst;
varying vec3 vOg;
varying vec3 vHD;
varying vec3 vFaceN;

#include <fog_pars_vertex>
${NOISE}
${SAFE}

// Rotated lattice for the flake facets: keeps the cell edges off the slab's own axes.
const mat3 ST_ROT_V = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
// Must match BURIAL in src/modules/stones.js: metres of the slab that sit below the turf line.
const float ST_BURIAL = 0.3;

// A shallow conchoidal chip: a curved flake driven off one broad face, leaving a sharp scar rim.
// The bias argument pushes the scar away from the inscribed arris so an inscription is not eaten by it.
vec3 st_chip(vec3 m, float seed, float idx, float W, float Ht, float Tk, float bias) {
  float h1 = st_hash13(vec3(seed * 13.0 + idx * 7.7, 3.1, 1.0));
  float h2 = st_hash13(vec3(seed * 29.0 + idx * 3.3, 7.7, 2.0));
  float h3 = st_hash13(vec3(seed * 17.0 + idx * 11.1, 1.3, 5.0));
  if (h3 < 0.42) return m;                                    // not every stone carries both scars
  float side = h1 > 0.5 ? 1.0 : -1.0;
  vec3 cc = vec3(clamp((h2 * 2.0 - 1.0) * 0.6 - 0.24 * bias, -0.72, 0.72) * W,
                 mix(0.22, 0.9, h1) * Ht,
                 side * Tk * 0.74);
  float R = mix(0.14, 0.29, h2) * clamp(W, 0.55, 1.5);
  vec3 dv = m - cc;
  float d = length(dv * vec3(1.0, 0.8, 1.0));
  if (d >= R) return m;
  return m - st_dir(dv + vec3(0.0, 0.0, 1e-4), vec3(0.0, 0.0, 1.0)) * (R - d) * 0.55;
}

void main() {
  vec3 q = position;
  float W = aDims.x;
  float Ht = aDims.y;
  float Tk = aDims.z;
  float seed = aShape.w;
  float y01 = clamp(q.y + 0.5, 0.0, 1.0);
  float xs = q.x * 2.0;
  float zs = q.z * 2.0;
  float yM = y01 * Ht;

  // Silhouette: taper toward the crown (top ≈ 70% of base width); each side edge wanders independently.
  // Portals (aOgham.w = 1) keep their inscribed gap-side arris as a near-vertical jamb; the outer side tapers.
  float jamb = aOgham.w * smoothstep(0.0, 0.35, xs * aOgham.x);
  float taper = mix(1.0, mix(aShape.x, 0.94, jamb), pow(y01, 1.15));
  // Per-stone wander: amplitude and vertical scale both vary, so no two profiles share a family.
  float wAmp = 0.18 + 0.22 * st_hash13(vec3(seed * 4.41, 2.2, 8.8));
  float wFrq = 0.62 + 0.75 * st_hash13(vec3(seed * 8.17, 5.5, 1.1));
  float eL = wAmp * (st_vnoise(vec3(seed * 7.13, yM * wFrq, 1.7)) - 0.5) + 0.10 * (st_vnoise(vec3(seed * 2.33, yM * 2.9, 4.2)) - 0.5);
  float eR = wAmp * (st_vnoise(vec3(seed * 3.71, yM * wFrq, 9.1)) - 0.5) + 0.10 * (st_vnoise(vec3(seed * 5.87, yM * 2.9, 6.6)) - 0.5);
  float halfW0 = 0.5 * W * taper * (1.0 + mix(eL, eR, smoothstep(-0.35, 0.35, xs)) * (1.0 - 0.75 * jamb));
  float tN = st_vnoise(vec3(seed * 5.3, yM * 1.1, 4.4)) - 0.5;
  float halfT0 = 0.5 * Tk * mix(1.0, aShape2.w, y01) * (1.0 + 0.3 * tN);

  // Ground contact (§3.4): the foot swells into the packed earth and bedding stones rammed round it,
  // so the slab reads as buried rather than stood on the turf. The swell keeps growing below the turf
  // line, which guarantees contact even where the bank falls away a little.
  // Most of the swell is below the turf line: above it the slab only thickens a little, so it reads as
  // rammed earth round the foot rather than as a plinth the stone was stood on.
  float gA = 1.0 - smoothstep(ST_BURIAL - 0.10, ST_BURIAL + 0.09, yM);
  float apron = gA * gA;
  float aprN = st_vnoise(vec3(seed * 9.1 + xs * 2.3, zs * 2.7, yM * 3.4));
  float flare = apron * (0.20 + 0.46 * aprN);
  float halfW = halfW0 * (1.0 + flare * 0.34);
  float halfT = halfT0 * (1.0 + flare * 0.66);
  vec3 m = vec3(xs * halfW, yM, zs * halfT);

  // Weathered crown: rounded shoulders, slant and an off-centre gable (centre height stays at Ht).
  float topw = pow(y01, 3.5);
  float crown = aShape.y * pow(abs(xs), 2.2) * 1.3 + aShape.z * xs + aShape2.x * (abs(xs - aShape2.y) - abs(aShape2.y));
  float recumbent = 1.0 - step(0.5, abs(aOgham.x));
  m.y -= topw * (crown * halfW + mix(0.5, 0.12, recumbent) * aShape.y * zs * zs * halfT);

  // A broken shoulder on some stones: the corner is sheared off along a plane.
  if (abs(aShape2.z) > 0.5) {
    float sg = aShape2.z;
    float hw = 0.5 * W * aShape.x;
    float a = 0.55 * hw;
    float b = 0.45 * Ht * 0.25 + a * 0.6;
    vec3 cn = st_dir(vec3(sg * b, a, 0.25 * a * sign(fract(seed * 3.7) - 0.5)), vec3(sg, 0.0, 0.0));
    vec3 c0 = vec3(sg * (hw - a), Ht, 0.0);
    float dist = dot(m - c0, cn);
    if (dist > 0.0) m -= cn * dist;
  }

  // Two conchoidal flake scars per slab (some stones get one, some none): flat curved bites out of a
  // broad face with a sharp rim, which is what breaks the instanced-prop read.
  m = st_chip(m, seed, 0.0, W, Ht, Tk, aOgham.x);
  m = st_chip(m, seed, 1.0, W, Ht, Tk, aOgham.x);

  // Slightly convex broad faces, chamfered vertical arrises (position-only: face vertices stay welded).
  m.z += zs * 0.06 * Tk * (1.0 - xs * xs) * sin(3.14159265 * clamp(y01 * 1.08, 0.0, 1.0));
  float ch = pow(abs(xs) * abs(zs), 4.0) * min(W, Tk) * 0.12;
  m.x -= sign(xs) * ch;
  m.z -= sign(zs) * ch;

  // Knapped, pecked surface: seeded low-frequency swell plus flake facets, along a position-only direction.
  vec3 dirN = st_dir(vec3(xs * Tk, 1.5 * smoothstep(0.78, 1.0, y01) * mix(max(W, Tk), Tk, recumbent), zs * W) + vec3(0.0, 1e-4, 0.0), vec3(0.0, 1.0, 0.0));
  vec3 pn = m + vec3(seed * 17.0, seed * 5.0, seed * 11.0);
  float d1 = st_vnoise(pn * 0.95) - 0.5;
  float d2 = st_vnoise(pn * 2.7 + 7.0) - 0.5;
  // Flake scars: each cell of a rotated lattice is a small tilted plane, so the cell edges read as
  // the sharp breaks of knapped stone rather than as soft lumps (screen-space normals do the rest).
  vec3 cp = ST_ROT_V * pn * 1.75;
  vec3 ci = floor(cp);
  vec3 cf = fract(cp) - 0.5;
  float c0 = st_hash13(ci) - 0.5;
  vec3 cg = vec3(st_hash13(ci + 11.3), st_hash13(ci + 27.7), st_hash13(ci + 41.1)) - 0.5;
  float facet = c0 * 0.5 + dot(cf, cg) * 1.25;
  // The foot is rubble, not slab: its surface breaks up harder than the dressed body.
  float rough = 1.0 + 1.5 * apron;
  m += dirN * (d1 * 0.12 + d2 * 0.05 + facet * 0.145 * rough) * min(1.0, Tk * 1.6);

  vec4 wp = modelMatrix * instanceMatrix * vec4(m, 1.0);
  vWorld = wp.xyz;
  vQ = q;
  vObj = vec3(xs * halfW0, yM, zs * halfT0) + vec3(seed * 37.0, seed * 3.0, seed * 11.0);
  vHD = vec3(yM - ST_BURIAL, d2 * 0.12 + d1 * 0.05, apron);
  vFaceN = st_dir(mat3(modelMatrix) * mat3(instanceMatrix) * dirN, dirN);

  // Ogham parametrisation (metres on the undisplaced surface; the apron flare is excluded so the
  // inscription never stretches at the foot).
  float sx = aOgham.x;
  float acrossA;
  float acrossB;
  float along;
  if (abs(sx) > 0.5) {
    acrossA = (1.0 - sx * xs) * halfW0;   // on the inner face, distance from the arris
    acrossB = (1.0 - zs) * halfT0;        // on the side face, distance from the arris
    along = yM;
  } else {
    acrossA = (1.0 - y01) * Ht;           // recumbent: inner face, distance below the top arris
    acrossB = (1.0 - zs) * halfT0;        // recumbent: top face, distance from the arris
    along = (xs + 1.0) * 0.5 * W;
  }
  vOg = vec3(acrossA, acrossB, along);
  vInst = vec4(aDims.w, sx, aOgham.y, aOgham.z);

  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const STONE_FRAG = /* glsl */ `
${SHARED_UNIFORMS}
uniform sampler2D uOgham;
uniform vec4 uGlowA[11];   // base glow, ring level, ring start (state.time), unused
uniform vec4 uFx[11];      // hover, river light, recumbent line start, unused
uniform vec3 uLichen;
uniform vec3 uTorc;
uniform vec3 uBoFinne;

varying vec3 vWorld;
varying vec3 vQ;
varying vec3 vObj;
varying vec4 vInst;
varying vec3 vOg;
varying vec3 vHD;
varying vec3 vFaceN;

const mat3 ST_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);

#include <fog_pars_fragment>
${FIRELIGHT}
${NOISE}
${SAFE}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  vec3 viewDir = st_dir(toCam, vec3(0.0, 0.0, 1.0));   // zero only with the eye exactly on the surface
  // Faceted, pecked-stone normal from screen-space derivatives (§10.6). A quad with zero world-space
  // area — a triangle collapsed by the vertex displacement — gives a zero cross product, and
  // normalize(0) is NaN: one such fragment would be smeared over the whole frame by the bloom.
  vec3 n = st_dir(cross(dFdx(vWorld), dFdy(vWorld)), viewDir);
  if (dot(n, toCam) < 0.0) n = -n;

  int id = int(clamp(vInst.x, 0.0, 10.0) + 0.5);   // out-of-range uniform indexing is undefined
  vec4 G = uGlowA[id];
  vec4 F = uFx[id];
  float height = vHD.x;
  float apron = vHD.z;
  float sid = vObj.y - vHD.x;   // per-stone seeded constant (seed·3 + burial)

  // --- Ogham atlas lookup around the inscribed arris ---
  // R = the notch's lit lip (narrow), G = the wash spilling out of the groove, B = the cut groove itself.
  float sx = vInst.y;
  float onA = step(0.4995, vQ.z);
  float onB = abs(sx) > 0.5 ? step(0.4995, sx * vQ.x) : step(0.4995, vQ.y);
  float across = onA > 0.5 ? vOg.x : (onB > 0.5 ? -vOg.y : 9.0);
  float cellU = 0.5 + across / 0.8;
  float inCell = step(0.0, cellU) * step(cellU, 1.0);
  vec2 uvO = vec2((vInst.x + clamp(cellU, 0.004, 0.996)) / 11.0, vOg.z / 4.0);
  vec3 og = texture2D(uOgham, uvO).rgb * inCell;

  // --- Albedo: Cork–Kerry slab. A dark rock body under patchy grey-green crustose lichen, bedding
  // planes stepping across the face, dark flecks, and a foot packed into the ground. All of it is a
  // tint of lichen: no new hue (§2.1). ---
  // The noise domain is rotated so the lattice never lines up with the slab faces (no blocky cells).
  vec3 p = ST_ROT * vObj;
  float fw = length(fwidth(vObj));
  float ogFw = fwidth(vOg.z);   // hoisted: derivatives inside the ogham branch below are undefined
  float m1 = st_vnoise(p * 0.52);
  float m2 = st_vnoise(ST_ROT * p * 1.75 + vec3(3.1, 0.7, 5.3));
  float m3 = st_vnoise(p * 4.6 + vec3(9.2, 4.4, 1.1));
  float mottle = m1 * 0.5 + m2 * 0.32 + m3 * 0.18;

  // Crustose lichen: irregular patches, thicker on the up-facing and sheltered parts of the slab.
  float crust = st_vnoise(p * 2.25 + vec3(1.3, 7.1, 2.9) + (m3 - 0.5) * 0.9) * 0.56
              + st_vnoise(ST_ROT * p * 5.9 + vec3(4.0, 0.0, 9.0)) * 0.29
              + m3 * 0.15;
  float crustMask = smoothstep(0.46, 0.64, crust + 0.11 * n.y + 0.045 * clamp(height, 0.0, 3.0) - 0.04);

  // Bedding planes: one or two slight tonal steps running across the slab, warped by the mottle.
  float bedP = fract((height + (m2 - 0.5) * 0.42) * 1.55 + sid * 1.7);
  float bed = smoothstep(0.30, 0.40, bedP) - smoothstep(0.52, 0.68, bedP);

  float fleck = st_vnoise(p * 13.0 + vec3(3.0, 1.0, 7.0)) * 0.7 + st_vnoise(ST_ROT * p * 29.0) * 0.3;
  float fleckMask = smoothstep(0.6, 0.78, fleck) * (1.0 - smoothstep(0.015, 0.06, fw));
  // Short broken rain runnels (never the long vertical grain of a plank).
  float run = st_vnoise(vec3((vObj.x + vObj.z) * 5.2, vObj.y * 1.9, 5.0));

  vec3 alb = uLichen * mix(0.54, 0.96, mottle);
  alb = mix(alb, uLichen * mix(1.12, 1.44, m3), crustMask * 0.92);
  alb *= 1.0 - 0.12 * bed * (1.0 - 0.5 * crustMask);
  alb *= 1.0 - 0.20 * fleckMask * (1.0 - 0.6 * crustMask);
  alb *= 1.0 - 0.11 * smoothstep(0.62, 0.9, run) * (1.0 - crustMask) * smoothstep(0.2, 1.4, height);
  // Foot: the bottom quarter-metre is rammed earth and bedding stones, its lichen gone.
  float buried = max(apron, 1.0 - smoothstep(-0.02, 0.28, height));
  alb = mix(alb, uLichen * (0.30 + 0.22 * m3), clamp(buried, 0.0, 1.0) * 0.88);
  alb *= mix(0.72, 1.0, smoothstep(-0.09, 0.04, vHD.y));
  alb *= 1.0 - 0.62 * og.b * (1.0 - 0.65 * og.r);   // the cut groove, minus its lit lip

  // --- Lighting: shared firelight + sky ambient; river light on the portals in the climax ---
  vec3 lit = fireLight(vWorld, n) + skyAmbient(n);
  // Knapped facets: faces tilted away from the slab's own face read as shadowed breaks in the stone.
  float tilt = dot(n, st_dir(vFaceN, n));   // an interpolated normal can interpolate to zero
  vec3 col = alb * lit * mix(0.5, 1.04, smoothstep(0.42, 0.97, tilt));
  // Contact shading: the crevice where the slab meets the rammed earth holds shadow.
  col *= 1.0 - 0.45 * apron * (1.0 - 0.5 * clamp(n.y, 0.0, 1.0));

  if (F.y > 0.0) {
    vec3 ra = vec3(0.0, 0.95, -17.0);
    vec3 rb = vec3(0.0, 0.12, -8.6);
    vec3 ab = rb - ra;
    float hr = clamp(dot(vWorld - ra, ab) / dot(ab, ab), 0.0, 1.0);
    vec3 Lr = ra + ab * hr - vWorld;
    float dr = length(Lr);
    Lr /= max(dr, 1e-3);
    float wrapR = clamp(dot(n, Lr) * 0.7 + 0.3, 0.0, 1.0);
    col += alb * uBoFinne * (1.5 * F.y * wrapR / (1.0 + 0.45 * dr * dr));
  }

  // Hover: the pickable rim brightens 15%.
  float rim = 1.0 - abs(dot(n, viewDir));
  col *= 1.0 + 0.15 * F.x * (0.55 + 0.45 * rim);

  // --- Ogham glow: torc × (0.4·V + flicker + ringGlow + beckon); ring lights bottom → top over 0.4 s.
  // The notch is a V in section, so what lights is a narrow ×2.3 lip (this blooms cream, §2.3) with a
  // ×0.9 wash in the groove behind it and a small spill onto the face. The dark side stays dark. ---
  if (og.g > 0.002 || og.r > 0.002) {
    float span = max(vInst.w - vInst.z, 0.05);
    float f = clamp((vOg.z - vInst.z) / span, 0.0, 1.0);
    float prog = (uTime - G.z) / 0.4 * 1.15;
    float lit01 = 1.0 - smoothstep(prog - 0.15, prog, f);
    float fd = (f - prog) * 7.0;
    float front = exp(-fd * fd) * step(prog, 1.3);
    float ring = G.y * lit01 * (1.0 + 0.8 * front);
    float shimmer = 0.92 + 0.08 * sin(uTime * 5.3 + vInst.x * 2.7) * sin(uTime * 2.9 + vInst.x);
    // The veil does not light eleven inscriptions in lockstep: each stone has its own threshold and breath.
    float sh = st_hash13(vec3(vInst.x * 1.37 + 0.11, 1.7, 3.3));
    float veilGate = smoothstep(0.05 + 0.36 * sh, 0.52 + 0.36 * sh, uVeil);
    float breath = 0.60 + 0.40 * sin(uTime * (0.42 + 0.22 * sh) + vInst.x * 2.39);
    float glow = min((0.4 * veilGate * breath + G.x + ring) * shimmer, 1.2);
    float peck = mix(1.0, 0.5 + 1.0 * st_vnoise(p * 31.0), 1.0 - smoothstep(0.004, 0.02, fw));
    // A hand-cut inscription is irregular: every notch bites a little differently, so every notch takes
    // the light a little differently. Without this the run reads as an evenly-lit bar code.
    // One noise cell per stroke (the pitch is 0.14 m), stretched hard: a hand-cut inscription bites
    // deeper here than there, so one notch blazes while its neighbour barely catches. Without this the
    // run reads as an even bar graph however correct the letter is.
    float nv = smoothstep(0.25, 0.75, st_vnoise(vec3(vOg.z * 7.1 + 0.4, vInst.x * 5.3 + 2.0, 3.0)));
    float notchVary = 0.22 + 0.95 * nv;
    // The ×2.3 lip is a real highlight only while the notch is bigger than a pixel. Once a stone is far
    // enough that the whole notch is subpixel, the mip chain has already smeared lip, groove and wash
    // together, and holding the lip at ×2.3 is what paints hard gold bars on a distant stone. There it
    // falls back to the ×0.9 wash, i.e. a soft gold glimmer along the arris.
    float sharp = 1.0 - smoothstep(0.010, 0.040, ogFw);
    float cut = (og.r * peck * (0.80 + 1.55 * sharp) + 0.85 * og.b * og.b) * notchVary;
    col += uTorc * glow * (cut + (0.40 + 0.22 * (1.0 - sharp)) * og.g * og.g);
  }

  // Recumbent tap: a faint torc line runs along its top edge.
  if (abs(sx) < 0.5) {
    float lt = uTime - F.z;
    if (lt >= 0.0 && lt < 1.5) {
      float head = lt / 0.9 * 2.6;
      float edge = exp(-across * across / 0.0009) * max(onA, onB);
      float behind = head - vOg.z;
      float trail = step(-0.06, behind) * exp(-max(behind, 0.0) / 0.55);
      col += uTorc * 0.85 * edge * trail * (1.0 - smoothstep(0.9, 1.5, lt));
    }
  }

  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

export const THREAD_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uTop[8];
uniform vec3 uStar[8];
uniform vec4 uThreadA[8];   // alpha, thickness, tremble, reveal start
uniform vec4 uThreadB[8];   // ghost tint, snap start (−1 none), spark start, spark duration
uniform vec4 uThreadC[8];   // spark intensity, spark ghost, unused, unused
uniform vec2 uResolution;   // drawing-buffer pixels
uniform float uPx;          // device pixels per CSS pixel
uniform float uMotion;      // 0 with reduced motion
uniform vec3 uTorc;
uniform vec3 uVerdigris;

attribute float aK;
attribute float aU;
attribute float aSide;

varying float vU;
varying float vSide;
varying float vHalfW;
varying float vLenPx;
varying float vAlpha;
varying float vThick;
varying float vReveal;
varying float vSnap;
varying float vSparkPos;
varying float vSparkI;
varying float vSeed;
varying float vReach;
varying vec3 vCol;
varying vec3 vSparkCol;

${SAFE}

const float R_THREAD = 900.0;
const float W_EPS = 0.05;

void main() {
  int k = int(clamp(aK, 0.0, 7.0) + 0.5);   // out-of-range uniform indexing is undefined
  vec4 A = uThreadA[k];
  vec4 B = uThreadB[k];
  vec4 C = uThreadC[k];

  float sx = (uTime - B.z) / max(B.w, 1e-3);
  float sparkOn = step(0.0, sx) * step(sx, 1.0) * C.x;
  float se = clamp(sx, 0.0, 1.0);
  vSparkPos = sparkOn > 0.0 ? 1.0 - (1.0 - se) * (1.0 - se) : -10.0;
  vSparkI = sparkOn;
  vSparkCol = mix(uTorc, uVerdigris, C.y);
  vCol = mix(uTorc, uVerdigris, B.x);
  vAlpha = A.x;
  vThick = A.y;
  vReveal = (uTime - A.w) / 0.08;
  vSnap = B.y < 0.0 ? 2.0 : 1.02 - 1.08 * smoothstep(0.0, 0.35, uTime - B.y);
  vReach = C.z > 0.01 ? C.z : 1.0;
  vU = aU;
  vSide = aSide;

  mat4 VP = projectionMatrix * viewMatrix;
  vec3 P0 = uTop[k];
  vec3 P1 = cameraPosition + uStar[k] * R_THREAD;
  vec4 c0 = VP * vec4(P0, 1.0);
  vec4 c1 = VP * vec4(P1, 1.0);

  bool dead = (A.x < 0.002 && sparkOn < 0.002) || (c0.w < W_EPS && c1.w < W_EPS);
  // With one end in front of the eye these denominators are at least W_EPS; they can only vanish
  // when both ends are behind it, the case the dead flag culls — but 0/0 would be NaN before the cull.
  float dw0 = c1.w - c0.w;
  if (c0.w < W_EPS) c0 = mix(c0, c1, (W_EPS - c0.w) / (abs(dw0) > 1e-6 ? dw0 : 1e-6));
  float dw1 = c0.w - c1.w;
  if (c1.w < W_EPS) c1 = mix(c1, c0, (W_EPS - c1.w) / (abs(dw1) > 1e-6 ? dw1 : 1e-6));

  // Screen-uniform parameter s → perspective-correct world parameter u.
  float s = aU;
  float u = s * c0.w / max((1.0 - s) * c1.w + s * c0.w, 1e-6);
  vec4 c = mix(c0, c1, u);

  vec2 halfRes = max(0.5 * uResolution, vec2(1.0));   // a zero-sized drawing buffer divides by zero below
  vec2 s0 = c0.xy / c0.w * halfRes;
  vec2 s1 = c1.xy / c1.w * halfRes;
  vec2 d = s1 - s0;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vLenPx = max(len, 1.0);

  // Per-thread hang: a catenary sag (strongest on the threads that run most across the frame) plus a
  // seeded lateral bow and a slack second harmonic. Eight lit threads therefore never draw a
  // symmetric cone (§11.3-3), and the ends stay exactly on the stone top and the star.
  float sd1 = fract(sin(aK * 12.9898 + 3.71) * 43758.5453);
  float sd2 = fract(sin(aK * 78.2330 + 1.17) * 24634.6345);
  vSeed = sd1;
  float sag = len * (0.013 + 0.026 * sd1);
  float bow = len * 0.055 * (sd2 - 0.5);
  float hang = (-dir.x * sag + bow) * sin(3.14159265 * s)
             + len * 0.013 * (sd1 - 0.5) * sin(6.2831853 * s + sd2 * 5.1);

  // The ribbon carries only the cord and its skirt; it narrows toward the star with the cord.
  float halfW = (3.1 + 2.3 * A.y) * uPx * mix(1.0, 0.62, s);
  vHalfW = halfW;
  float tr = A.z * uMotion * uPx * (1.7 * sin(3.14159265 * s) * sin(uTime * 34.5575)
                                  + 0.6 * sin(6.2831853 * s) * sin(uTime * 69.115 + 1.3));
  c.xy += nrm * (aSide * halfW + tr + hang) / halfRes * c.w;

  // Depth pinned just in front of the stone top: the thread is hidden only by things nearer than its stone,
  // never by the mound or hills it visually crosses on its way to the star.
  vec4 cz = VP * vec4(P0 + st_dir(cameraPosition - P0, vec3(0.0, 1.0, 0.0)) * 0.35, 1.0);
  c.z = clamp(cz.z / max(cz.w, W_EPS), -1.0, 1.0) * c.w;

  gl_Position = dead ? vec4(2.0, 2.0, 2.0, 1.0) : c;
}
`;

export const THREAD_FRAG = /* glsl */ `
uniform float uTime;
uniform float uPx;
uniform float uMotion;

varying float vU;
varying float vSide;
varying float vHalfW;
varying float vLenPx;
varying float vAlpha;
varying float vThick;
varying float vReveal;
varying float vSnap;
varying float vSparkPos;
varying float vSparkI;
varying float vSeed;
varying float vReach;
varying vec3 vCol;
varying vec3 vSparkCol;

void main() {
  float px = max(uPx, 1e-3);         // every width, mask and falloff below divides by it
  float uu = clamp(vU, 0.0, 1.0);    // MSAA samples may extrapolate varyings past the strip ends
  float x = clamp(vSide, -1.0, 1.0) * vHalfW;          // signed px across the ribbon
  float dpx = abs(x);

  // Two-ply spun cord, ~1.8 px at the stone tapering to ~0.9 px at the star (§10.6; ×2.5 while held).
  // The plies wind past each other with a pitch of ≈ 14 px, which is ≈ 0.4 m at the stone, so the
  // twist is legible as twist. The pitch wanders so the glints read as fibre, not as a row of beads.
  float width = mix(1.8, 0.9, uu) * px * vThick;
  float aa = 0.5 * px;
  float pitchPx = mix(13.0, 21.0, uu) * px * mix(1.0, 1.5, vThick - 1.0);
  float phase = uu * vLenPx / max(pitchPx, 1e-3) * 3.14159265 + 1.7 * sin(uu * 13.0 + 1.3 + vSeed * 6.0)
              + 0.9 * sin(uu * 37.0) - uTime * 2.6 * uMotion;
  float face = 0.5 + 0.5 * cos(phase);                 // 1 = first ply toward the viewer
  float crest = pow(abs(cos(phase)), 1.3);             // the crest of the twist, where the light catches
  float sep = 0.34 * width * sin(phase);               // the plies swap sides each half pitch
  float ply = 0.22 * width + 0.12 * px;                // half-width of one ply, never below an eighth of a pixel
  float c1 = clamp((ply + aa - abs(x - sep)) / (2.0 * aa), 0.0, 1.0) * (0.10 + 0.90 * face);
  float c2 = clamp((ply + aa - abs(x + sep)) / (2.0 * aa), 0.0, 1.0) * (0.10 + 0.90 * (1.0 - face));
  float body = min(1.0, c1 + c2);

  // Spun thread breaks and reforms along its length: two slow beats, never a ruled line.
  float n1 = sin(uu * 14.451 + vSeed * 9.1);
  float n2 = sin(uu * 35.813 + vSeed * 17.3 + 1.7);
  float grain = 0.38 + 0.62 * smoothstep(-0.6, 0.85, 0.78 * n1 + 0.46 * n2);

  // Fades along its length and dies out before its star. vReach is the per-thread end of the visible
  // run: 1.0 while one or two threads ring (the thread reaches its star, §10.6 acceptance 2), pulled
  // back to a seeded 0.52–0.79 when the whole harp is lit, so eight threads never meet in one apex.
  float alongFade = (1.0 - 0.45 * pow(uu, 0.8)) * (1.0 - smoothstep(vReach - 0.20, vReach, uu)) * smoothstep(0.0, 0.015, uu);
  float vis = (1.0 - smoothstep(vReveal - 0.04, vReveal, uu)) * (1.0 - smoothstep(vSnap - 0.03, vSnap, uu));
  float lum = vAlpha * alongFade * vis;

  // §2.3 two-zone profile. The cord body is a saturated ×0.8–1.2 gold that never crosses the 0.85 bloom
  // threshold, however many threads ring at once; only the crest of the twist, and only while this thread
  // is really ringing, lifts a sub-pixel core to ×2.45, which blooms cream-gold. So the thread reads as
  // a spun gold fibre catching light in glints — never as a lit bar (§11.3-3).
  float bodyI = 1.15 * body * (0.55 + 0.45 * crest) * grain;
  float skirt = 0.16 * exp(-dpx * dpx / max(0.45, 1.0 * width * width)) * grain;
  float coreMask = clamp((max(0.40 * width, 0.42 * px) + 0.08 * px - dpx) / (0.55 * px), 0.0, 1.0);
  float hot = smoothstep(0.18, 0.55, lum) * smoothstep(0.46, 0.92, crest) * (0.45 + 0.55 * grain);
  float coreI = 2.45 * coreMask * body * hot;
  vec3 col = vCol * max((bodyI + skirt) * lum, coreI);

  // Spark: a 6 px bead (torc ×3) with a short trail, climbing toward the star.
  float da = (uu - vSparkPos) * vLenPx;
  float sig = 2.6 * px;
  float spark = exp(-(da * da + dpx * dpx) / (sig * sig));
  float trail = step(da, 0.0) * exp(max(min(da, 0.0) / (26.0 * px), -40.0)) * exp(-dpx * dpx / (1.6 * px * px)) * 0.45;
  col += vSparkCol * (vSparkI * (3.0 * spark + trail));

  gl_FragColor = vec4(clamp(col, 0.0, 16.0), 1.0);
}
`;
