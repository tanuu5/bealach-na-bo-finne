// Milk-river particles, river ribbon and fire column (docs/DESIGN.md §10.8 "Builds").
// Private helper of the `bealach` module. Every visual here is a pure function of the climax clock
// T (ctx.uniforms.uClimaxT) so ?phaseT jumps render exactly (§4.4 rule 6).
import * as THREE from 'three';
import { PATH_N } from './path.js';

// ---------------------------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------------------------

// NaN-safety (see the loch/mist.js incident): on real hardware a single non-finite fragment is smeared
// across every bloom mip and blanks the whole frame, so every domain-restricted operation below is
// clamped at the door. `safeNormalize` is exactly `normalize(v)` for any vector that is not
// (near) zero, and returns 0 instead of NaN for one that is.
const SAFE = /* glsl */ `
vec3 safeNormalize(vec3 v) {
  float l2 = dot(v, v);
  return l2 > 1e-24 ? v * inversesqrt(l2) : vec3(0.0);
}
`;

const PATH_SAMPLER = /* glsl */ `

const float PATH_N = ${PATH_N.toFixed(1)};
// NearestFilter float texture, lerped manually between two texels (§10.8).
vec4 pathRow(sampler2D tex, float u, float v) {
  float x = clamp(u, 0.0, 1.0) * (PATH_N - 1.0);
  float i0 = floor(x);
  float i1 = min(i0 + 1.0, PATH_N - 1.0);
  vec4 a = texture2D(tex, vec2((i0 + 0.5) / PATH_N, v));
  vec4 b = texture2D(tex, vec2((i1 + 0.5) / PATH_N, v));
  return mix(a, b, x - i0);
}
`;

const PARTICLE_VERT = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uClimaxT;    // ctx.uniforms.uClimaxT    (??= {value:-1})

uniform sampler2D uPathTex;
uniform sampler2D uFrameTex;
uniform sampler2D uDustTex;
uniform float uFront;
uniform float uPixelRatio;
uniform vec2 uViewport;      // drawing-buffer size in px
uniform float uCountRiver;   // particles in the river set
uniform float uCountColumn;  // particles in the column set
uniform float uSurface;      // target milk surface brightness (fraction of the particle colour)
uniform float uPeak;         // max per-sprite intensity: a lone sprite never blooms into glitter
uniform vec3 uBoFinne;
uniform vec3 uTorc;

attribute float aSeed;
attribute float aLane;
attribute float aLane2;
attribute float aSize;
attribute float aSet;

varying vec3 vColor;

${PATH_SAMPLER}

vec2 toPx(vec3 p) {
  vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0);
  return c.xy / max(c.w, 1e-3) * 0.5 * uViewport;
}

void main() {
  float T = uClimaxT;
  float f;
  float u;
  float vis;
  float perU;
  if (aSet < 0.5) {
    // river set: fills [0, front], flowing downstream
    f = fract(aSeed + T * 0.06);
    u = uFront * f;
    vis = 1.0 - smoothstep(26.0, 29.0, T);
    perU = uCountRiver / max(uFront, 1e-3);
  } else {
    // column set: leaves the loch spiral and climbs the column
    f = fract(aSeed + T * 0.08);
    u = 0.5 + (uFront - 0.5) * f;
    vis = smoothstep(25.5, 26.0, T);
    perU = uCountColumn / max(uFront - 0.5, 1e-3);
  }
  vis *= smoothstep(8.0, 8.5, T) * (1.0 - smoothstep(30.0, 34.0, T));
  // soft source and soft front, so the wrap of fract() never pops
  vis *= smoothstep(0.0, 0.03, f) * (1.0 - smoothstep(0.96, 1.0, f));

  if (vis < 0.002) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vColor = vec3(0.0);
    return;
  }

  vec4 P = pathRow(uPathTex, u, 0.5);
  vec3 side = pathRow(uFrameTex, u, 0.25).xyz;
  vec3 bin = pathRow(uFrameTex, u, 0.75).xyz;

  // The Milky Way travels with the river: its dust lanes (band texture G, via the river dust texture —
  // see makeRiverDustData) darken the particles in lanes along the road; its star clouds (R) mottle them.
  // Particles caught in a lane also drift toward its nearer edge, so the lanes read as dark channels
  // between filaments of stars instead of dimmed specks scattered through noise.
  float lu = fract(u * 5.0 + T * 0.01);
  float lv = aLane * 0.5 + 0.5;
  vec4 dust = texture2D(uDustTex, vec2(lu, lv));
  float lane = dust.g;
  float grad = texture2D(uDustTex, vec2(lu, lv + 0.035)).g - texture2D(uDustTex, vec2(lu, lv - 0.035)).g;
  float lanePos = clamp(aLane - sign(grad) * lane * 0.16, -1.0, 1.0);
  vec3 wp = P.xyz + side * (lanePos * P.w) + bin * (aLane2 * 0.15 * P.w);

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = max(length(mv.xyz), 0.001);
  // §10.8 size rule, with the §11.1 cap of 4 px × dpr (aSize spans 2.5–2.95, so even the farthest
  // sprites stay ≥ 3.7 px: a 1–1.5 px additive sprite is one hard pixel and reads as glitter, not milk)
  float size = min(aSize * uPixelRatio * clamp(300.0 / dist, 1.5, 4.0), 4.0 * uPixelRatio);
  gl_PointSize = size;

  // Surface-brightness compensation: estimate the screen area this particle's share of the road covers
  // (along-track px per unit u × across-track spread / particles per unit u) and scale the sprite so
  // the summed milk keeps an even HDR surface — where the road runs toward the camera (P1→P3) or coils
  // in the loch thousands of sprites land on a few pixels; in the thin pillar top they are sparse.
  float du = 0.0015;
  vec2 s0 = toPx(P.xyz);
  vec2 dL = (toPx(pathRow(uPathTex, u + du, 0.5).xyz) - s0) / du;
  vec2 dS = toPx(P.xyz + side * P.w) - s0;
  vec2 dB = toPx(P.xyz + bin * (0.15 * P.w)) - s0;
  float lenPx = length(dL);
  vec2 tDir = dL / max(lenPx, 1e-4);
  float spreadPx = 2.0 * max(max(0.7 * abs(tDir.x * dS.y - tDir.y * dS.x), abs(tDir.x * dB.y - tDir.y * dB.x)), 1.0);
  float areaPerParticle = lenPx * spreadPx / max(perU, 1.0);
  // integral of the gaussian sprite below. It is a divisor and it is built from uPixelRatio, so it is
  // floored: a zero device pixel ratio would otherwise make this 0/0 = NaN for every sprite at once.
  float cover = max(0.262 * size * size, 1e-6);
  // In the sky (u < 0.25) the particles are the whole stream; from the mound crown on, the ribbon
  // carries the milk surface and the particles are the moving grain on top of it.
  // REVIEW-FIX (art, major): the ribbon now carries a milk body along the sky leg too, so the grain
  // there drops to about half of what it was when the sprites were the whole river.
  float surface = uSurface * mix(0.45, 1.0, smoothstep(0.20, 0.28, u)) * mix(1.0, 0.8, smoothstep(0.49, 0.52, u));
  // where the road turns toward the camera (P1→P3, the bank into the loch) the stream is seen end-on:
  // hold it a little below the rest so it lands as a splash of milk, not a glowing orb
  surface *= mix(0.22, 1.0, smoothstep(0.06, 0.40, lenPx * 0.01 / max(spreadPx, 1.0)));
  float k = clamp(surface * areaPerParticle / cover, 0.002, uPeak);

  float milk = 0.7 + 0.6 * dust.r;
  // Brighter along the centre line. aLane is already a Gaussian (sigma 0.35), so the density carries
  // most of the band's profile; this only keeps the few 2-sigma stragglers from reading as loose sparks
  // beside the stream. Mean over the lane distribution is ~1, so it does not shift the surface level.
  float profile = 0.30 + 0.95 * exp(-aLane * aLane / 0.20);
  // Milk first, stars second: a narrow spread around 1 with a thin power-law tail, so the river reads
  // as a continuous surface with a few brighter grains in it — never as a field of hard sparkles.
  float pick = fract(aSeed * 91.7 + aLane2 * 13.1);
  float mrnd = fract(aSeed * 57.3 + aLane * 7.1);
  // pow() with a negative base is NaN in GLSL. fract() cannot return one, but the base is floored
  // anyway so the only pow() left in this module cannot depend on that being true on every driver.
  float mag = 0.70 + 0.35 * mrnd * mrnd + 0.62 * pow(max(mrnd, 0.0), 9.0);
  // the stream condenses out of the drained band just below the pillar top
  float source = smoothstep(0.0, 0.035, u);
  float a = vis * source * k * profile * milk * mag * (1.0 - 0.85 * lane);
  vec3 col = pick < 0.15 ? uTorc * 1.5 : uBoFinne * 1.6;   // §10.8: 85% boFinne x1.6, 15% torc x1.5
  vColor = col * a;
}
`;

const PARTICLE_FRAG = /* glsl */ `
varying vec3 vColor;

void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  // Soft gaussian sprite reaching 0 at the rim. The falloff is deliberately wide (a = 2.4, not 4):
  // a tight core makes 3 px sprites read as hard glitter, and the river must read as milk (§11.2).
  // Its integral over the sprite is 0.262 * size^2 — the "cover" constant in the vertex shader.
  float g = exp(-r2 * 2.4) - 0.0907 * r2;
  gl_FragColor = vec4(vColor * max(g, 0.0), 1.0);
}
`;

const NOISE = /* glsl */ `
float bhash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  float a = bhash(i);
  float b = bhash(i + vec2(1.0, 0.0));
  float c = bhash(i + vec2(0.0, 1.0));
  float d = bhash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
`;

const RIBBON_VERT = /* glsl */ `
attribute float aU;
attribute float aV;
attribute float aBulge;   // extra half-width built into the mesh at the mound crown (pool)
varying float vU;
varying float vV;
varying float vB;
void main() {
  vU = aU;
  vV = aV;
  vB = aBulge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RIBBON_FRAG = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uClimaxT;    // ctx.uniforms.uClimaxT    (??= {value:-1})

uniform sampler2D uDustTex;
uniform float uStartU;
uniform float uFront;
uniform float uFlow;
uniform float uReduced;
uniform vec3 uBoFinne;

varying float vU;
varying float vV;
varying float vB;

${NOISE}

void main() {
  float T = uClimaxT;
  float front = 1.0 - smoothstep(uFront - 0.012, uFront, vU);
  float start = smoothstep(uStartU, uStartU + 0.055, vU);
  float inLoch = smoothstep(0.49, 0.53, vU);
  // REVIEW-FIX (art, major): §10.8 started the ribbon at the mound crown, so the whole descent out of
  // the sky was carried by 16k sprites alone and read as a spray of white confetti. The milk body now
  // runs the whole road; in the sky it is a soft wide spine under the grain, not a hard band.
  float inSky = 1.0 - smoothstep(0.19, 0.27, vU);

  // The milk pools where it breaks over the mound crown, and its wake spreads on the loch behind the
  // front. The mesh carries the extra half-width (aBulge) all the time; vV is renormalised back onto
  // §10.8's 1.2·w bed except while that widening is actually happening.
  float poolOn = smoothstep(11.85, 12.5, T) * (1.0 - smoothstep(13.3, 16.5, T));
  float wakeOn = inLoch * smoothstep(0.0, 4.5, T - (16.0 + (vU - 0.5) * 25.714));
  float grow = max(poolOn, wakeOn);
  float bed = vV * (1.0 + vB) / (1.0 + vB * grow);
  // The milk snakes inside its bed instead of running down a ruled centre line, so the route through
  // mound → entrance → portal gap → loch is legible even at this near-horizontal climax pose.
  float wander = (0.34 * sin(vU * 21.0 + 1.7) + 0.15 * sin(vU * 53.0 + 4.1)) * (1.0 - inLoch);
  float av = abs(bed - wander);
  float envel = 1.0 - smoothstep(0.62, 1.02, abs(vV));

  // Reduced motion carries the whole pour on the ribbon alone (§7.3), so it runs wider and dimmer:
  // a static poured band, never the 6 px line §11.3-11 would call a light shaft.
  float wide = mix(1.0, 1.85, uReduced);
  // In the sky the bed is the path's own 12–30 m width. With the particles on top of it (normal) the
  // milk keeps to the middle of that bed with a real falloff — a soft spine under the grain, never a
  // flat bar of white; without them (reduced motion) the ribbon is the whole pour, so there it
  // spreads across the bed instead.
  float lat = mix(2.4, 6.2, inLoch) * mix(1.0, mix(3.0, 0.85, uReduced), inSky) / wide;
  float core = exp(-av * av * lat);
  float edge = exp(-av * av * lat * 0.48) * envel;

  // anti-aliasing: where the road is seen edge-on (grazing ground, far loch rim) the flow noise is
  // minified several times over — fade its contrast instead of letting it shimmer.
  float fwFlow = fwidth(vU * 400.0);
  vec2 q = vec2(vU * 400.0 - T * 3.0 * uFlow, vV * 1.6);
  float n = 0.6 * bnoise(q) + 0.4 * bnoise(q * vec2(2.3, 2.1) + 5.7);
  n = mix(0.55, n, 1.0 - smoothstep(0.35, 1.2, fwFlow));
  // dust lanes as for the particles (vV spans ±0.6 w, particles' aLane spans ±w)
  vec4 dust = texture2D(uDustTex, vec2(fract(vU * 5.0 + T * 0.01), 0.5 + 0.3 * bed));
  float lane = dust.g * (1.0 - 0.6 * smoothstep(0.6, 2.5, fwidth(vU * 5.0) * 512.0));
  // star clouds: broad brighter and fainter reaches of the river
  float cloud = texture2D(uDustTex, vec2(fract(vU * 1.3 + 0.37), 0.5)).r;
  float fade = smoothstep(8.0, 8.5, T) * (1.0 - smoothstep(28.0, 31.0, T));
  // §2.2 (climax pour/river): the river is boFinne at HDR 1.2–1.8 carrying its dark dust lanes. The
  // ribbon is the body of milk; the particles are the moving grain on its surface, not the river.
  float k = mix(mix(0.22, 0.07, inSky), 1.55, core) * mix(1.0, 0.74, inLoch) * (0.55 + 0.45 * n) * (0.62 + 0.58 * cloud);
  k *= (1.0 - 0.72 * lane) * mix(1.0, 0.60, uReduced);
  float poolD = (vU - 0.252) / 0.030;                              // squared inline: pow(x, 2.0) with a
  k *= 1.0 + 0.15 * poolOn * exp(-poolD * poolD);                  // negative base is NaN in GLSL
  // In the sky the grain is dense and the body only has to give it something to be grain *on*; on the
  // loch the spreading wake thins as it widens, the way poured milk does on water.
  k *= mix(1.0, mix(0.26, 1.0, uReduced), inSky) / (1.0 + 0.8 * vB * wakeOn);
  gl_FragColor = vec4(uBoFinne * k, edge * front * start * fade);
}
`;

const COLUMN_VERT = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uClimaxT;    // ctx.uniforms.uClimaxT    (??= {value:-1})

varying float vH;
varying vec3 vNV;
varying vec3 vPV;

${SAFE}

void main() {
  float T = uClimaxT;
  vH = position.y + 40.0;                       // 0 at the fire, 80 at the top of the column
  vec3 p = position;
  // REVIEW-FIX (art/climax/ux/lead, blocker): the column used to be a ruled tube whose silhouette was
  // a pure function of the limb parameter. The milk now leans and breathes as it climbs — a slow
  // S-curve of ≤0.3 m plus a radial swell — so the pour has a body, not an axis.
  // atan(0, 0) is undefined in GLSL. The column is an open cylinder of radius 0.85–5.2, so no vertex
  // ever sits on the axis; the guard only removes the dependency on that staying true.
  float ang = dot(p.xz, p.xz) > 0.0 ? atan(p.z, p.x) : 0.0;
  float lean = 0.09 + 0.013 * vH;
  p.x += lean * sin(vH * 0.094 - T * 0.33);
  p.z += lean * sin(vH * 0.071 + 1.7 - T * 0.27);
  float breath = 1.0 + 0.11 * sin(vH * 0.23 - T * 0.5 + ang * 1.3) + 0.06 * sin(vH * 0.61 + ang * 2.7 + T * 0.21);
  p.x *= breath;
  p.z *= breath;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vPV = mv.xyz;
  vNV = safeNormalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

const COLUMN_FRAG = /* glsl */ `
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uClimaxT;    // ctx.uniforms.uClimaxT    (??= {value:-1})

uniform sampler2D uDustTex;
uniform float uReduced;
uniform vec3 uBoFinne;
uniform vec3 uTorc;

varying float vH;
varying vec3 vNV;
varying vec3 vPV;

${SAFE}

void main() {
  float T = uClimaxT;
  // interpolated normal and view vector: both provably non-zero here (the cylinder's normals are
  // 15° apart and the near plane keeps vPV off the eye), but normalize(0) is NaN, so neither
  // assumption is left to the driver. dot() of interpolated vectors is not guaranteed ≤ 1 — the
  // clamp below is what keeps the sqrt() further down inside its domain.
  vec3 n = safeNormalize(vNV);
  vec3 v = safeNormalize(-vPV);
  float facing = clamp(abs(dot(n, v)), 0.0, 1.0);
  // lateral position across the silhouette: 0 = centre line, ±1 = limb (view-space normal x)
  float x = sqrt(max(0.0, 1.0 - facing * facing));
  float across = clamp(n.x, -1.0, 1.0);

  float revealH = (T - 26.0) / 2.0 * 80.0;
  float fadeIn = uReduced > 0.5 ? smoothstep(26.0, 30.0, T) : smoothstep(26.0, 26.3, T);
  float fade = fadeIn * (1.0 - smoothstep(30.0, 34.0, T));
  float foot = smoothstep(0.0, 0.9, vH);

  // The Milky Way returns to the sky: the band texture wraps the column like a piece of the band
  // (u along the height, scrolling upward at ~0.9 m/s; v across the silhouette), so the Great Rift's
  // lanes read as dark, wandering vertical striations climbing back into the sky — §11.3-11's one
  // licensed vertical light, textured by dust lanes and not by strands. Three taps at different
  // scales and scroll rates keep the lanes broken instead of a pair of ruled stripes, and the scale
  // (~1 texture period per 20 m, not per 60 m) keeps them lane-sized over the 16 m of column the
  // climax pose actually sees instead of magnifying four lanes into ink blots.
  float sway = 0.11 * sin(vH * 0.33 - T * 1.05 + across * 1.7);
  vec2 dq = vec2(fract(vH * 0.050 - T * 0.055), clamp(0.5 + 0.52 * across + sway, 0.0, 1.0));
  vec2 dq2 = vec2(fract(vH * 0.019 - T * 0.021 + 0.41), clamp(0.5 + 0.30 * across - 0.8 * sway, 0.0, 1.0));
  vec4 d1 = texture2D(uDustTex, dq);
  vec4 d1b = texture2D(uDustTex, dq + vec2(0.013, 0.055));   // soft second tap: the river dust mask is
  vec4 d2 = texture2D(uDustTex, dq2);                        // steep-edged, and hard edges read as camo
  float lane = clamp(0.58 * d1.g + 0.34 * d1b.g + 0.36 * d2.g, 0.0, 1.0);
  float milk = 0.62 + 0.30 * d1.r + 0.22 * d1b.r + 0.24 * d2.r;   // mean ≈ 1.0

  // REVIEW-FIX (art/climax/ux/lead, blocker): the silhouette used to be a pure function of the limb
  // parameter, i.e. a ruled tube identical at every height. The same dust now drives the edge, so the
  // column frays and breathes ±30 % along its length instead of being a searchlight beam. The milk
  // also fills its cone now (edge ≈ 0.86, not 0.56): the old shader lit only the inner half of the
  // geometry, which is what made a 1.4 m column render as a 16 px thread.
  float ripple = 0.55 * (d2.r - 0.5) + 0.40 * (d1.r - 0.5);
  float edge = clamp(0.86 + 0.30 * ripple + 0.10 * sin(vH * 0.21 + across * 2.3 - T * 0.4), 0.45, 1.30);
  float xs = x / edge;

  // reveal front and the top, both dissolved by the same noise so neither is a straight cut: the
  // column thins and disperses upward rather than running off at full strength.
  float fray = clamp(0.5 + ripple, 0.0, 1.0);
  float reveal = uReduced > 0.5 ? 1.0 : 1.0 - smoothstep(revealH - 6.0 - 5.0 * fray, revealH + 1.0, vH);
  float top = clamp(((1.0 - smoothstep(26.0, 74.0, vH)) - 0.36 * (1.0 - fray)) * 1.9, 0.0, 1.0);
  // the rising head: a soft swell of milk just below the reveal front while it climbs (T 26–28)
  float headD = (vH - revealH + 3.0) / 4.0;                        // squared inline, never pow(x, 2.0)
  float head = uReduced > 0.5 ? 0.0 : exp(-headD * headD) * (1.0 - smoothstep(27.6, 28.2, T));

  // §2.3 / §10.8: a wide, soft boFinne core capped near ×1.5 (the old ×4 clipped flat across a 40 px
  // plateau, which destroyed the lane modulation and blew a bloom halo 26× the geometry). The lanes
  // cut the whole column, not a fraction of each term; they bite a little less on the axis, where the
  // line of sight passes through milk in front of and behind the rift, so the §10.8 acceptance-3 core
  // stays bright while the lanes read as dark striations climbing back into the sky.
  float core = exp(-xs * xs / 0.30);
  float body = exp(-xs * xs / 1.20);
  // The throat where the milk leaves the fire is white-hot and short; above it the column cools and
  // thins as it disperses into the sky, so the length carries a gradient instead of being the same
  // clipped value at every height (the art review measured (640,250) and (640,400) identical before).
  float heat = 0.86 + 0.52 * (1.0 - smoothstep(0.5, 7.0, vH));
  float dissolve = 1.0 - 0.16 * smoothstep(3.0, 34.0, vH);
  // white-gold (§2.2 return): torc where it leaves the fire, boFinne climbing back to the band
  float warm = 1.0 - smoothstep(0.5, 30.0, vH);
  vec3 tint = mix(uBoFinne, uTorc, 0.68 * warm + 0.20 * smoothstep(0.35, 0.95, xs));
  float laneDepth = 0.76 - 0.26 * core;
  float I = ((0.97 * core * heat + 0.44 * body) * milk * (1.0 - laneDepth * lane) + 0.75 * head * body) * dissolve;
  float alpha = (1.0 - smoothstep(0.70, 1.10, xs)) * reveal * foot * top * fade;
  gl_FragColor = vec4(tint * I, alpha);
}
`;

// ---------------------------------------------------------------------------------------------
// Fallback dust texture (only when `sky` is absent): R = milk detail, G = dust absorption
// concentrated on the centre line, periodic in u, like world.sky.bandTexture.
// ---------------------------------------------------------------------------------------------

export function makeDustData(rng, W = 512, H = 64) {
  const G = 64;
  const lattice = new Float32Array(G * G);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  // periodic value noise in x (period in lattice cells), open in y
  const vnoise = (x, y, period) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const X0 = ((xi % period) + period) % period;
    const X1 = (X0 + 1) % period;
    const Y0 = ((yi % G) + G) % G;
    const Y1 = (Y0 + 1) % G;
    const a = lattice[Y0 * G + X0];
    const b = lattice[Y0 * G + X1];
    const c = lattice[Y1 * G + X0];
    const d = lattice[Y1 * G + X1];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
  // A few long, sinuous, branching lanes (Great-Rift-like), sharp-edged, periodic in u.
  const lanes = [];
  for (let k = 0; k < 4; k++) {
    lanes.push({
      off: (rng() - 0.5) * 0.36,
      f1: 1 + Math.floor(rng() * 3),
      p1: rng() * Math.PI * 2,
      a1: 0.05 + rng() * 0.07,
      f2: 3 + Math.floor(rng() * 4),
      p2: rng() * Math.PI * 2,
      w: 0.035 + rng() * 0.05,
      seed: 3 + k * 11,
    });
  }
  const data = new Uint8Array(W * H * 4);
  for (let x = 0; x < W; x++) {
    const u = x / W;
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);
      const centre = Math.exp(-(((v - 0.5) / 0.22) ** 2));
      let milk = 0;
      let amp = 0.5;
      let freq = 8;
      for (let o = 0; o < 4; o++) {
        milk += amp * vnoise(u * freq, v * freq * 0.12 + o * 7, freq);
        amp *= 0.5;
        freq *= 2;
      }
      let dust = 0;
      for (const L of lanes) {
        const vc = 0.5 + L.off + L.a1 * Math.sin(Math.PI * 2 * L.f1 * u + L.p1) + 0.025 * Math.sin(Math.PI * 2 * L.f2 * u + L.p2);
        const wobble = 0.55 + 0.9 * vnoise(u * 24, L.seed, 24);
        const width = L.w * wobble;
        const gap = Math.min(1, Math.max(0, (vnoise(u * 12, L.seed + 20, 12) - 0.3) * 3.0));
        const d = Math.abs(v - vc);
        const core = 1 - Math.min(1, Math.max(0, (d - width * 0.45) / (width * 0.55)));
        dust = Math.max(dust, core * gap);
      }
      // mottled small clouds between the lanes
      const blot = 0.65 * vnoise(u * 40, v * 6 + 31, 40) + 0.35 * vnoise(u * 80, v * 12 + 45, 80);
      dust = Math.max(dust, Math.min(1, Math.max(0, (blot - 0.62) * 5)) * 0.55);
      dust *= centre;
      const i = (y * W + x) * 4;
      data[i] = Math.round(Math.min(1, milk) * 255);
      data[i + 1] = Math.round(Math.min(1, dust) * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return { data, W, H };
}

/**
 * The river's dust texture, derived once at setup from the Milky Way band texture (`world.sky.bandTexture`,
 * or the fallback above when `sky` is absent). The band's lanes are drawn for the sky dome: hairline
 * filaments 1–3 texels thick. Carried by a 2 m river of 3–4 px sprites they would vanish, so the river
 * takes the band's central strip (v 0.3–0.7, β ±6°, where the lanes live), dilates and blurs the lanes to
 * the river's resolution and restores their contrast. Same lanes, same places along u; readable width.
 * Output: 512 × 48 RGBA8, R = milk detail, G = lane opacity, u periodic.
 */
export function makeRiverDustData(src, OW = 512, OH = 48) {
  const { data, width: SW, height: SH } = src;
  const V0 = 0.3;
  const V1 = 0.7;
  const G = new Float32Array(OW * OH);
  const R = new Float32Array(OW * OH);
  const cols = Math.max(1, Math.round(SW / OW));
  for (let y = 0; y < OH; y++) {
    const va = V0 + ((V1 - V0) * y) / OH;
    const vb = V0 + ((V1 - V0) * (y + 1)) / OH;
    const r0 = Math.max(0, Math.floor(va * SH) - 1);
    const r1 = Math.min(SH - 1, Math.ceil(vb * SH) + 1);
    for (let x = 0; x < OW; x++) {
      const c0 = Math.floor((x * SW) / OW);
      let gmax = 0;
      let rsum = 0;
      let n = 0;
      for (let row = r0; row <= r1; row++) {
        for (let k = -1; k <= cols; k++) {
          const cx = (((c0 + k) % SW) + SW) % SW;
          const i = (row * SW + cx) * 4;
          const g = data[i + 1];
          if (g > gmax) gmax = g;
          rsum += data[i];
          n++;
        }
      }
      G[y * OW + x] = gmax / 255;
      R[y * OW + x] = rsum / (n * 255);
    }
  }
  // separable blur (u periodic, v clamped), then restore contrast with steep edges
  const tmp = new Float32Array(OW * OH);
  const kx = [0.06, 0.24, 0.4, 0.24, 0.06];
  const ky = [0.25, 0.5, 0.25];
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      let a = 0;
      for (let k = -2; k <= 2; k++) a += kx[k + 2] * G[y * OW + ((x + k + OW) % OW)];
      tmp[y * OW + x] = a;
    }
  }
  const out = new Uint8Array(OW * OH * 4);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      let a = 0;
      for (let k = -1; k <= 1; k++) a += ky[k + 1] * tmp[Math.min(OH - 1, Math.max(0, y + k)) * OW + x];
      const t = Math.min(1, Math.max(0, (a - 0.1) / 0.3));
      const i = (y * OW + x) * 4;
      out[i] = Math.round(Math.min(1, R[y * OW + x]) * 255);
      out[i + 1] = Math.round(t * t * (3 - 2 * t) * 255);
      out[i + 2] = 0;
      out[i + 3] = 255;
    }
  }
  return { data: out, W: OW, H: OH };
}

function makeRiverDustTexture(skyTex, rng) {
  const img = skyTex && skyTex.isTexture ? skyTex.image : null;
  const src =
    img && img.data && img.data.length >= img.width * img.height * 4
      ? { data: img.data, width: img.width, height: img.height }
      : (() => {
          const f = makeDustData(rng, 1024, 96);
          return { data: f.data, width: f.W, height: f.H };
        })();
  const { data, W, H } = makeRiverDustData(src);
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'bealach.riverDust';
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------------------------

function gaussian(rng) {
  let u = 0;
  while (u <= 1e-7) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @returns {{ group, particleCount, update(T, front, dpr), setVisible(b), dispose() }}
 */
export function createRiverVisuals(ctx, path, { climaxT }) {
  const rng = ctx.makeRng('bealach');
  // Private debug aid for grading the three objects separately (and for attributing a pixel to one of
  // them in a review): `?bhide=` any of p (particles), r (ribbon), c (column). Off in every normal run.
  const hidden = String(ctx.params?.get('bhide') || '');
  const hideP = hidden.includes('p');
  const hideR = hidden.includes('r');
  const hideC = hidden.includes('c');
  const reduced = !!ctx.reducedMotion;
  const particleCount = reduced ? 0 : ctx.quality === 'low' ? 6000 : 16000;

  const dustTex = makeRiverDustTexture(ctx.world.sky?.bandTexture, rng);

  const boFinne = new THREE.Color(ctx.palette.boFinne);
  const torc = new THREE.Color(ctx.palette.torc);

  const uFront = { value: 0 };
  const uPixelRatio = { value: ctx.size?.dpr ?? 1 };
  const uViewport = { value: new THREE.Vector2(1280, 800) };
  const uDust = { value: dustTex };

  const group = new THREE.Group();
  group.name = 'bealach';

  // --- particles ------------------------------------------------------------------------------
  let points = null;
  if (particleCount > 0) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(particleCount * 3);
    const aSeed = new Float32Array(particleCount);
    const aLane = new Float32Array(particleCount);
    const aLane2 = new Float32Array(particleCount);
    const aSize = new Float32Array(particleCount);
    const aSet = new Float32Array(particleCount);
    let columnCount = 0;
    for (let i = 0; i < particleCount; i++) {
      aSeed[i] = rng();
      aLane[i] = Math.max(-1, Math.min(1, gaussian(rng) * 0.35));
      aLane2[i] = Math.max(-1, Math.min(1, gaussian(rng) * 0.5));
      // Near the §11.1 cap of 4 px: fewer, bigger, softer grains overlap into milk instead of
      // resolving as separate sparks (the sky leg only ever gets ~2-4 sprites per pixel).
      aSize[i] = 2.5 + 0.45 * rng();
      aSet[i] = rng() < 0.3 ? 1 : 0;
      columnCount += aSet[i];
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    geo.setAttribute('aLane', new THREE.BufferAttribute(aLane, 1));
    geo.setAttribute('aLane2', new THREE.BufferAttribute(aLane2, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aSet', new THREE.BufferAttribute(aSet, 1));
    const mat = new THREE.ShaderMaterial({
      name: 'bealach.particles',
      uniforms: {
        uClimaxT: climaxT,
        uPathTex: { value: path.pathTexture },
        uFrameTex: { value: path.frameTexture },
        uDustTex: uDust,
        uFront,
        uPixelRatio,
        uViewport,
        uCountRiver: { value: particleCount - columnCount },
        uCountColumn: { value: columnCount },
        uSurface: { value: 0.27 },
        uPeak: { value: 0.11 },
        uBoFinne: { value: boFinne },
        uTorc: { value: torc },
      },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    points = new THREE.Points(geo, mat);
    points.name = 'bealach.particles';
    points.frustumCulled = false;
    points.renderOrder = 10;
    group.add(points);
  }

  // --- river ribbon ---------------------------------------------------------------------------
  // REVIEW-FIX (art, major): §10.8 ran the ribbon from P3 (u 0.25) to 0.85, which left the whole
  // descent out of the sky to the particles — a spray of white specks with no body, no continuity and
  // no lane structure. The body of milk now runs the whole road (u 0 → 0.85) in every mode, and the
  // particles are the grain travelling on its surface. Reduced motion keeps the same mesh (§7.3: the
  // ribbon's opacity front travels the path in place of the particles) at 1.85× width.
  const uStart = 0;
  const SEG = 620;   // §11.1: 1240 triangles + the column's 672 stays inside the 2k budget
  const verts = (SEG + 1) * 2;
  const rPos = new Float32Array(verts * 3);
  const rU = new Float32Array(verts);
  const rV = new Float32Array(verts);
  const rB = new Float32Array(verts);
  const p4 = [0, 0, 0, 0];
  const s4 = [0, 0, 0, 0];
  // Extra half-width the mesh carries so the shader can widen the bed where the milk pools (the mound
  // crown) and where its wake spreads (the loch). Renormalised away while it is not happening.
  const bulgeAt = (u) => {
    const pool = 0.6 * Math.exp(-(((u - 0.252) / 0.042) ** 2));
    const wake = u >= 0.49 ? 0.7 : 0;
    return Math.max(pool, wake);
  };
  for (let i = 0; i <= SEG; i++) {
    const u = uStart + ((0.85 - uStart) * i) / SEG;
    path.samplePath(u, p4);
    path.sampleSide(u, s4);
    const bulge = bulgeAt(u);
    const half = 0.6 * p4[3] * (1 + bulge);
    for (let j = 0; j < 2; j++) {
      const sgn = j === 0 ? -1 : 1;
      const k = i * 2 + j;
      let x = p4[0] + s4[0] * half * sgn;
      let y = p4[1] + s4[1] * half * sgn;
      let z = p4[2] + s4[2] * half * sgn;
      if (u > 0.25) {
        // drape each edge on the domed mound / curved bank: keep the centre's height (which already
        // carries the path's own P3 blend) plus the lateral change of the ground under the edge.
        const drape = (px, pz) => (Math.hypot(px, pz) < 9 ? 0.08 : Math.max(path.ground(px, pz) + 0.15, 0.08));
        y = u >= 0.5 ? 0.08 : p4[1] + drape(x, z) - drape(p4[0], p4[2]);
      }
      rPos[k * 3] = x;
      rPos[k * 3 + 1] = y;
      rPos[k * 3 + 2] = z;
      rU[k] = u;
      rV[k] = sgn;
      rB[k] = bulge;
    }
  }
  const rIdx = new Uint16Array(SEG * 6);
  for (let i = 0; i < SEG; i++) {
    const a = i * 2;
    rIdx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(rPos, 3));
  ribbonGeo.setAttribute('aU', new THREE.BufferAttribute(rU, 1));
  ribbonGeo.setAttribute('aV', new THREE.BufferAttribute(rV, 1));
  ribbonGeo.setAttribute('aBulge', new THREE.BufferAttribute(rB, 1));
  ribbonGeo.setIndex(new THREE.BufferAttribute(rIdx, 1));
  ribbonGeo.computeBoundingSphere();
  const ribbonMat = new THREE.ShaderMaterial({
    name: 'bealach.ribbon',
    uniforms: {
      uClimaxT: climaxT,
      uDustTex: uDust,
      uStartU: { value: uStart },
      uFront,
      uFlow: { value: reduced ? 0.3 : 1.0 },
      uBoFinne: { value: boFinne },
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: RIBBON_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.name = 'bealach.ribbon';
  ribbon.frustumCulled = false;
  ribbon.renderOrder = 9;
  group.add(ribbon);

  // --- column ---------------------------------------------------------------------------------
  // REVIEW-FIX (climax, blocker): §10.8's CylinderGeometry(1.4, 0.6, 80) cancels its own taper in
  // perspective — the top subtends ~0.033 rad at ~85 m and the foot ~0.037 rad at ~32 m, so the
  // column could not read as a pour. The taper is exaggerated far past the perspective cancellation
  // (≈5 m at y = 80 against 0.85 m at the foot, the climax reviewer's own numbers), which inside the
  // frame — the climax pose only sees the first ~16.5 m — widens the milk from 1.6 m to 3.3 m.
  const columnGeo = new THREE.CylinderGeometry(5.2, 0.85, 80, 24, 14, true);
  const columnMat = new THREE.ShaderMaterial({
    name: 'bealach.column',
    uniforms: {
      uClimaxT: climaxT,
      uDustTex: uDust,
      uReduced: { value: reduced ? 1 : 0 },
      uBoFinne: { value: boFinne },
      uTorc: { value: torc },
    },
    vertexShader: COLUMN_VERT,
    fragmentShader: COLUMN_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const column = new THREE.Mesh(columnGeo, columnMat);
  column.name = 'bealach.column';
  column.position.set(0, 40.35, 0);
  column.renderOrder = 11;
  group.add(column);

  group.visible = false;
  for (const o of group.children) o.visible = false;

  return {
    group,
    particleCount,
    points,
    ribbon,
    column,
    uniforms: { uFront, uPixelRatio },
    /** Per frame, allocation-free. T = climax clock (−1 outside). */
    update(T, front, size) {
      const on = T >= 8 && T <= 34;
      group.visible = on;
      if (points) points.visible = on && !hideP;
      ribbon.visible = on && T <= 31 && !hideR;
      column.visible = on && T >= 26 && !hideC;
      uFront.value = front;
      const dpr = size?.dpr ?? 1;
      uPixelRatio.value = dpr;
      uViewport.value.set((size?.width ?? 1280) * dpr, (size?.height ?? 800) * dpr);
    },
    dispose() {
      if (points) {
        points.geometry.dispose();
        points.material.dispose();
      }
      ribbonGeo.dispose();
      ribbonMat.dispose();
      columnGeo.dispose();
      columnMat.dispose();
      dustTex.dispose();
      path.pathTexture.dispose();
      path.frameTexture.dispose();
      group.removeFromParent();
    },
  };
}
