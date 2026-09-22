// Loch star layer: wheeling catalog trails (screen-space width) + echo stars + reflection-only stars.
// High quality: ONE indexed mesh (3000 × 8-section strips = 42 000 triangles, plus 320 sprite quads = 640) →
// one draw, ≤ 43k triangles (§10.4 budget). Low quality: ONE Points object (899 + 320 points, no trails):
// each catalog star is 1–3 points subsampled along its own recent arc, and every point sprite is smeared into
// a comet along its instantaneous screen-space motion, so the low loch reads as a sky that is *turning*.
//
// DESIGN-QUESTION: §10.4 names an `InstancedMesh` for the trails. One plain indexed BufferGeometry is used
// instead, because the echo sprites share the same draw call with it (§10.4 explicitly allows "same instanced
// mesh with a flag") and because every vertex already carries per-strip data in attributes — instancing would
// add a second geometry and a second draw for no gain. Vertex count and draw budget are as specified.
// DESIGN-QUESTION: §10.4 asks for strips "expand[ed] in clip space to 1.2 px". They are expanded to 2 px of
// geometry carrying a (1 − y²) falloff, whose integral is ≈ 1.33 px of solid width: a hard-edged 1.2 px strip
// aliases badly at the grazing default camera, which is the very problem the screen-space rule exists to fix.
import * as THREE from 'three';
import { SHARED_UNIFORMS, FISHEYE, RIPPLES } from './glsl.js';

export const ECHO_SLOTS = 256;
export const REFL_SLOTS = 64;
const SECTIONS = 8; // cross-sections per trail (16 vertices, 7 quads)

// Low path point budget (§11.1: loch low = 1.2k points). 898 trail points + 320 echo slots = 1218.
// The points are spent unevenly along the rank list (sorted brightest first): selectBrightest's power curve
// means everything past the first quarter of the ranks is within a hair of black, so giving those stars a
// second sample would buy nothing, while the brightest tenth can afford four or five and draw a real streak.
// Spending 898 points evenly buys 898 identical ticks; spending them this way buys a field with a range of
// stroke lengths, which is what makes a still frame read as a sky in motion rather than as stipple.
const LOW_TRAIL_POINTS = 898;
// [fraction of the rank list, samples along the arc] — cumulative, brightest first.
const LOW_SUBS = [[0.04, 5], [0.12, 4], [0.24, 3], [0.40, 2], [1, 1]];
const LOW_SUB_DECAY = 0.68; // per-sample amplitude ratio head → tail
/** Samples for rank j of n (n sorted brightest first). */
function lowSubCount(j, n) {
  for (let i = 0; i < LOW_SUBS.length; i++) if (j < LOW_SUBS[i][0] * n) return LOW_SUBS[i][1];
  return 1;
}
/** How many catalog stars the low path can draw inside LOW_TRAIL_POINTS. */
export const LOW_TRAIL_STARS = (() => {
  const total = (k) => {
    let t = 0;
    let prev = 0;
    for (const [f, sub] of LOW_SUBS) {
      const end = Math.min(k, Math.ceil(f * k)); // ranks j with j < f·k
      t += Math.max(0, end - prev) * sub;
      prev = Math.max(prev, end);
    }
    return t;
  };
  let per = 0;
  let prev = 0;
  for (const [f, sub] of LOW_SUBS) {
    per += (f - prev) * sub;
    prev = f;
  }
  let n = Math.max(1, Math.floor(LOW_TRAIL_POINTS / per));
  while (n > 1 && total(n) > LOW_TRAIL_POINTS) n--;
  while (total(n + 1) <= LOW_TRAIL_POINTS) n++;
  return n;
})();

// Kinds (aInfo.x): 0 catalog trail, 1 echo anchored to the sky frame (rotates with uSkyRot),
// 2 echo anchored to the air (never rotates with the band), 3 reflection-only (fixed on the water).
const STAR_VERTEX_COMMON = /* glsl */ `
uniform mat3 uSkyRot;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uTrailGain;
uniform float uEchoGain;
uniform float uReflGain;
uniform float uTorcMix;
uniform vec3 uTorc;
uniform float uHarp[8];
uniform vec4 uRipples[8];
uniform float uRippleWarp;
uniform float uFlare31;    // T = 31: every kindled (air) star flares to 3, mirrored from sky
`;

const ECHO_LEVEL = /* glsl */ `
// Returns rgb intensity for an echo / reflection-only star and writes its sprite size (px) to sizePx.
vec3 loch_echo(vec3 p, float kind, float vis, out float sizePx) {
  float age = uTime - aInfo.z;
  // x * x, not pow(x, 2.0): the base is already clamped ≥ 0 here, but pow() is only defined for a
  // positive base and hardware that expands it to exp2(2·log2(x)) has to special-case x = 0. A
  // square never needs pow(). (Same rewrite as the two bealach Gaussians.)
  float b01 = max(0.0, 1.0 - age / 1.2);
  float birth = aInfo.z > -1e5 ? b01 * b01 : 0.0;
  float offFlare = aCol.w > 0.5 ? 1.0 - smoothstep(1.1, 1.5, age) : 0.0;     // ×2 for 1.5 s when born off-screen
  float level = aInfo.y;
  if (aInfo.w > -0.5) level = 0.5 + 2.5 * uHarp[int(aInfo.w + 0.5)];          // harp star k follows its stone
  if (kind > 1.5 && kind < 2.5) level = mix(level, 3.0, uFlare31);
  float gain = kind > 2.5 ? uReflGain : uEchoGain;
  float inten = level * gain * vis * (1.0 + 2.0 * birth) * (1.0 + offFlare);
  // ≤ 4 px, 6 px only during the 1.2 s birth flare (§11.1)
  sizePx = min(3.2 + 1.2 * sqrt(level) + 3.0 * max(birth, offFlare), mix(4.0, 6.0, step(0.001, birth))) * uDpr;
  return mix(aCol.rgb, uTorc, uTorcMix) * inten;
}
`;

function trailVertexShader(low) {
  return /* glsl */ `
${SHARED_UNIFORMS}
${STAR_VERTEX_COMMON}
uniform float uArc;
attribute vec2 aSeg;
attribute vec4 aInfo;   // kind, mag|level, birthTime, harpK (−1 none)
attribute vec4 aCol;    // tint rgb, off-screen flare flag
varying vec3 vCol;
varying vec2 vUv;
varying float vKind;
${FISHEYE}
${RIPPLES}
vec2 loch_warp(vec2 xz) {
${low ? '  return xz;' : `  if (uRippleWarp <= 0.0) return xz;
  vec2 rl = loch_ripples(xz, uTime, 0.0);
  float r = length(xz);
  return xz + (r > 1e-4 ? xz / r : vec2(0.0)) * rl.y * 0.1 * uRippleWarp;`}
}
${ECHO_LEVEL}
void main() {
  float kind = aInfo.x;
  vKind = kind;
  vUv = aSeg;
  vCol = vec3(0.0);
  if (aInfo.y <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }   // empty pool slot: clipped
  if (kind < 0.5) {
    // ---- catalog trail: sections at angles uOtherAngle − i/8·arc (head i = 0) ----
    float segI = aSeg.x;
    vec3 d = uSkyRot * position;
    // Per-star arc length (catalog.arcs, driven by the star's own magnitude): a handful of bright stars burn a
    // long trail, most leave a tick. Without it every trail at a given radius is the same dash at the same
    // phase and the disc reads as a machined spirograph rather than as another sky turning.
    // The second factor is the star's distance from the Otherworld pole: the tight circles near the pole are
    // drawn as short marks and the wide ones out at its horizon as long ones, so the wheel reads as one
    // turning sky instead of an even field of dashes, and the dense zenith centre of the disc stays calm.
    float colat = acos(clamp(dot(d, LOCH_POLE), -1.0, 1.0));
    float arc = uArc * aInfo.z * (0.7 + 0.6 * smoothstep(0.2, 1.15, colat));
    float a0 = uOtherAngle - segI / 8.0 * arc;
    float dA = max(arc / 8.0, 0.0035);                                         // tangent stays defined at arc 0
    vec3 dp0 = loch_rotPole(d, a0);
    vec3 dp1 = loch_rotPole(d, a0 - dA);
    vec2 w0 = loch_warp(loch_fisheyeXZ(dp0));
    vec2 w1 = loch_warp(loch_fisheyeXZ(dp1));
    vec4 c0 = projectionMatrix * viewMatrix * vec4(w0.x, 0.012, w0.y, 1.0);
    vec4 c1 = projectionMatrix * viewMatrix * vec4(w1.x, 0.012, w1.y, 1.0);
    vec2 s0 = c0.xy / c0.w * 0.5 * uViewport;
    vec2 s1 = c1.xy / c1.w * 0.5 * uViewport;
    vec2 tg = s1 - s0;
    float tl = length(tg);
    tg = tl > 1e-5 ? tg / tl : vec2(1.0, 0.0);
    vec2 nrm = vec2(-tg.y, tg.x);
    // 2 px geometric width with a 1 − y² profile ≈ 1.3 px effective (≥ 1 px, §11.1); round-ish caps so a
    // collapsed trail (arc 0, afterglow) is still a point. The few bright stars draw a wider trail than the
    // faint field, so the disc has a range of stroke weights instead of one.
    float bright = clamp(aInfo.y / 0.62, 0.0, 1.0);
    float wpx = 1.0 + 0.55 * sqrt(bright);
    float cap = (segI < 0.5 ? -0.9 : (segI > 6.5 ? 0.9 : 0.0)) * wpx * uDpr;
    vec2 offPx = nrm * aSeg.y * wpx * uDpr + tg * cap;
    c0.xy += offPx / (0.5 * uViewport) * c0.w;
    gl_Position = c0;
    float vis = smoothstep(0.0, 0.1, dp0.y);                                   // sets at the Otherworld horizon
    float along = 1.0 - segI / 7.0;
    float head = 1.0 + 0.9 * exp(-segI * segI * 0.8);                          // the star itself, at the head of its trail
    vCol = mix(aCol.rgb, uTorc, uTorcMix) * (aInfo.y * uTrailGain * vis * along * along * head);
  } else {
    // ---- echo sprite ----
    vec3 p;
    float vis = 1.0;
    if (kind > 2.5) {
      p = vec3(position.x, 0.014, position.z);
    } else {
      vec3 d = kind < 1.5 ? uSkyRot * position : position;
      vec3 dp = loch_rotPole(d, uOtherAngle);
      vec2 w = loch_fisheyeXZ(dp);
      vis = smoothstep(0.0, 0.08, dp.y);
      p = vec3(w.x, 0.014, w.y);
    }
    p.xz = loch_warp(p.xz);
    float sizePx;
    vCol = loch_echo(p, kind, vis, sizePx);
    vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0);
    c.xy += aSeg * (0.5 * sizePx) / (0.5 * uViewport) * c.w;
    gl_Position = c;
  }
}
`;
}

const TRAIL_FRAGMENT = /* glsl */ `
varying vec3 vCol;
varying vec2 vUv;
varying float vKind;
void main() {
  float a;
  if (vKind < 0.5) {
    a = max(0.0, 1.0 - vUv.y * vUv.y);
  } else {
    float r2 = dot(vUv, vUv);
    a = (exp(-r2 * 4.5) + 0.9 * exp(-r2 * 22.0)) * (1.0 - smoothstep(0.7, 1.0, r2));
  }
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

// Low path (§11.1: points instead of strips). Two things make the field read as a sky that is *turning*
// rather than as a still reflection, and neither costs a draw call, a triangle or a point beyond the budget:
//   1. each star is 1–3 points subsampled along its own recent arc (aInfo.w = sub index), and
//   2. every trail sprite is stretched inside its own square into a comet smear along its instantaneous
//      screen-space motion, tail-ward, with the head bright and the tail dim.
// The sample spacing is capped in *screen* space (uStepPx) so the samples always merge into one streak instead
// of reading as three separate stars, and capped in *angle* by the star's own arc — which is where uArc's
// ×(1 + V) and the climax trailScale still reach it, so the dashes lengthen with the veil and collapse to
// round points by T = 32 exactly as the high path does.
const POINTS_VERTEX = /* glsl */ `
${SHARED_UNIFORMS}
${STAR_VERTEX_COMMON}
uniform float uArc;
uniform float uStepPx;   // target spacing between a trail's subsampled points, device px
attribute vec4 aInfo;    // kind, mag|level, arcScale|birthTime, subIndex|harpK
attribute vec4 aCol;     // tint rgb, sub amplitude | off-screen flare flag
varying vec3 vCol;
varying vec4 vSm;        // tail direction (xy), smear half-length in sprite units (z), taper end (w)
${FISHEYE}
${ECHO_LEVEL}
vec4 loch_clipAt(vec2 xz) {
  return projectionMatrix * viewMatrix * vec4(xz.x, 0.012, xz.y, 1.0);
}
void main() {
  float kind = aInfo.x;
  vCol = vec3(0.0);
  vSm = vec4(1.0, 0.0, 0.0, 1.0);
  gl_PointSize = 0.0;
  if (aInfo.y <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  if (kind < 0.5) {
    // ---- catalog trail: this star's sample number aInfo.w, on its arc behind the star ----
    vec3 d = uSkyRot * position;
    float colat = acos(clamp(dot(d, LOCH_POLE), -1.0, 1.0));
    float maxArc = uArc * aInfo.z * (0.7 + 0.6 * smoothstep(0.2, 1.15, colat));
    vec3 dH = loch_rotPole(d, uOtherAngle);
    vec3 dP = loch_rotPole(d, uOtherAngle - 0.02);
    vec4 cH = loch_clipAt(loch_fisheyeXZ(dH));
    vec4 cP = loch_clipAt(loch_fisheyeXZ(dP));
    vec2 sH = cH.xy / cH.w * 0.5 * uViewport;
    float pxPerRad = length(cP.xy / cP.w * 0.5 * uViewport - sH) / 0.02;
    float stepA = min(maxArc / 2.4, uStepPx / max(pxPerRad, 1e-3));
    // aInfo.w packs the sample index plus ½ on the last sample of the star. A sample that is followed by
    // another must fade to exactly that next sample's amplitude across its own length, or the streak beads:
    // each sprite would restart bright where the one before it ended dim. Only the tip fades away properly.
    float fi = floor(aInfo.w);
    float tailEnd = fract(aInfo.w) > 0.25 ? 0.24 : ${LOW_SUB_DECAY.toFixed(2)};
    float a0 = uOtherAngle - fi * stepA;
    vec3 dA = fi < 0.5 ? dH : loch_rotPole(d, a0);
    vec4 cA = fi < 0.5 ? cH : loch_clipAt(loch_fisheyeXZ(dA));
    vec4 cB = loch_clipAt(loch_fisheyeXZ(loch_rotPole(d, a0 - stepA)));
    vec2 dv = cB.xy / cB.w * 0.5 * uViewport - cA.xy / cA.w * 0.5 * uViewport;
    float dl = length(dv);
    float vis = smoothstep(0.0, 0.08, dA.y);                                   // sets at the Otherworld horizon
    vCol = mix(aCol.rgb, uTorc, uTorcMix) * (aInfo.y * uTrailGain * vis * aCol.w);
    // The round core keeps its own width; the sprite only grows to hold the smear, and never past the
    // 4 px × dpr cap (§11.1), so the added fill is a couple of pixels on the brightest few hundred points.
    // The veil thins the core as it lengthens the trails (§4.3): the whole ×(1 + V) has to come out of the
    // same 4 px, so a thinner mark is what keeps the samples touching instead of breaking into beads.
    float core = max(clamp(1.6 + 1.2 * aInfo.y, 1.6, 2.4) * (1.0 - 0.28 * uVeil), 1.25) * uDpr;
    float size = min(core + dl, 4.0 * uDpr);
    // ps is a divisor on the next line. Every term in it is proportional to uDpr, so a uniform that
    // is 0 before the first onResize (or on a zero-sized canvas) would make it exactly 0 and turn
    // the smear half-length into 0/0 = NaN — additive, so the bloom would take the frame with it.
    float ps = max(max(size, 1.7 * uDpr), 1e-4);                               // ≥ 1.6 px on low (§11.1)
    gl_PointSize = ps;
    vSm = vec4(dl > 1e-4 ? dv / dl : vec2(1.0, 0.0), max(size - core, 0.0) / ps, tailEnd);
    gl_Position = cA;
  } else {
    vec3 p;
    float vis = 1.0;
    if (kind > 2.5) {
      p = vec3(position.x, 0.014, position.z);
    } else {
      vec3 d = kind < 1.5 ? uSkyRot * position : position;
      vec3 dp = loch_rotPole(d, uOtherAngle);
      vec2 w = loch_fisheyeXZ(dp);
      vis = smoothstep(0.0, 0.08, dp.y);
      p = vec3(w.x, 0.012, w.y);
    }
    float sizePx;
    vCol = loch_echo(p, kind, vis, sizePx);
    gl_PointSize = sizePx;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
}
`;

// One profile serves both: a capsule of half-length vSm.z along vSm.xy with a soft gaussian cross-section.
// At vSm.z = 0 (every echo and reflection-only star, and any trail whose arc has collapsed) it is exactly the
// round sprite the low path drew before.
const POINTS_FRAGMENT = /* glsl */ `
varying vec3 vCol;
varying vec4 vSm;
void main() {
  vec2 q = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * 2.0 - 1.0;   // y up, to match the screen-space tangent
  float hl = vSm.z;
  float u = dot(q, vSm.xy);
  float v = dot(q, vec2(-vSm.y, vSm.x));
  float du = max(abs(u) - hl, 0.0);
  float w = max(1.0 - hl, 0.12);
  float r2 = (du * du + v * v) / (w * w);
  float a = (exp(-r2 * 3.5) + 0.6 * exp(-r2 * 14.0)) * (1.0 - smoothstep(0.75, 1.0, r2));
  float tail = clamp(u / (2.0 * hl + 1e-3) + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(vCol * a * mix(1.0, mix(1.0, vSm.w, tail), smoothstep(0.0, 0.02, hl)), 1.0);
}
`;

/**
 * @param {object} opts { low, catalog (from selectBrightest), shared (uniform objects), torcLin }
 * @returns {{ object, uniforms, setEcho(slot, ...), clearEcho(slot), dispose() }}
 */
export function createStarLayer({ low, catalog, shared, torcLin }) {
  const nTrail = catalog.n;
  const nEcho = ECHO_SLOTS + REFL_SLOTS;
  const geo = new THREE.BufferGeometry();
  let object;
  let echoBase; // first vertex of echo slot 0
  let vPerEcho;

  const uniforms = {
    ...shared,
    uSkyRot: { value: new THREE.Matrix3() },
    uViewport: { value: new THREE.Vector2(1, 1) },
    uDpr: { value: 1 },
    uTrailGain: { value: 0 },
    uEchoGain: { value: 0 },
    uReflGain: { value: 0 },
    uTorcMix: { value: 0 },
    uTorc: { value: torcLin.clone() },
    uHarp: { value: new Float32Array(8) },
    uRipples: shared.uRipples,
    uRippleWarp: { value: low ? 0 : 1 },
    uArc: { value: 0 },
    uStepPx: { value: 3.0 },
    uFlare31: { value: 0 },
  };

  if (!low) {
    vPerEcho = 4;
    const vCount = nTrail * SECTIONS * 2 + nEcho * 4;
    const pos = new Float32Array(vCount * 3);
    const seg = new Float32Array(vCount * 2);
    const info = new Float32Array(vCount * 4);
    const col = new Float32Array(vCount * 4);
    const indexCount = nTrail * (SECTIONS - 1) * 6 + nEcho * 6;
    const index = vCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let v = 0;
    let ii = 0;
    for (let s = 0; s < nTrail; s++) {
      const base = v;
      for (let i = 0; i < SECTIONS; i++) {
        for (let side = -1; side <= 1; side += 2) {
          pos[v * 3] = catalog.dirs[s * 3];
          pos[v * 3 + 1] = catalog.dirs[s * 3 + 1];
          pos[v * 3 + 2] = catalog.dirs[s * 3 + 2];
          seg[v * 2] = i;
          seg[v * 2 + 1] = side;
          info[v * 4] = 0;
          info[v * 4 + 1] = catalog.mags[s];
          info[v * 4 + 2] = catalog.arcs ? catalog.arcs[s] : 1; // trail: per-star arc scale (echo slots: birth time)
          info[v * 4 + 3] = -1;
          col[v * 4] = catalog.tints[s * 3];
          col[v * 4 + 1] = catalog.tints[s * 3 + 1];
          col[v * 4 + 2] = catalog.tints[s * 3 + 2];
          col[v * 4 + 3] = 0;
          v++;
        }
      }
      for (let i = 0; i < SECTIONS - 1; i++) {
        // counter-clockwise in screen space (the normal is 90° CCW from the tail-ward tangent)
        const a = base + i * 2;
        index[ii++] = a;
        index[ii++] = a + 2;
        index[ii++] = a + 1;
        index[ii++] = a + 1;
        index[ii++] = a + 2;
        index[ii++] = a + 3;
      }
    }
    echoBase = v;
    const corners = [-1, -1, 1, -1, -1, 1, 1, 1];
    for (let e = 0; e < nEcho; e++) {
      const base = v;
      for (let c = 0; c < 4; c++) {
        seg[v * 2] = corners[c * 2];
        seg[v * 2 + 1] = corners[c * 2 + 1];
        info[v * 4 + 1] = 0; // empty
        info[v * 4 + 2] = -1e6;
        info[v * 4 + 3] = -1;
        v++;
      }
      index[ii++] = base;
      index[ii++] = base + 1;
      index[ii++] = base + 2;
      index[ii++] = base + 1;
      index[ii++] = base + 3;
      index[ii++] = base + 2;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeg', new THREE.BufferAttribute(seg, 2));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.ShaderMaterial({
      name: 'loch.trails',
      uniforms,
      vertexShader: trailVertexShader(false),
      fragmentShader: TRAIL_FRAGMENT,
      side: THREE.DoubleSide, // strips are built in screen space; never lose one to winding at extreme perspective
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    object = new THREE.Mesh(geo, mat);
  } else {
    vPerEcho = 1;
    const subs = new Uint8Array(nTrail);
    let nPts = 0;
    for (let s = 0; s < nTrail; s++) {
      subs[s] = lowSubCount(s, nTrail);
      nPts += subs[s];
    }
    const vCount = nPts + nEcho;
    const pos = new Float32Array(vCount * 3);
    const info = new Float32Array(vCount * 4);
    const col = new Float32Array(vCount * 4);
    let v = 0;
    for (let s = 0; s < nTrail; s++) {
      const ns = subs[s];
      // The samples share out one star's light instead of adding to it, so splitting a star into a streak
      // never brightens the disc: the §10.4 / §10.10 "loch mean ≤ 0.55× band core" check is unaffected.
      let norm = 0;
      for (let i = 0; i < ns; i++) norm += Math.pow(LOW_SUB_DECAY, i);
      for (let i = 0; i < ns; i++, v++) {
        pos.set(catalog.dirs.subarray(s * 3, s * 3 + 3), v * 3);
        info[v * 4] = 0;
        info[v * 4 + 1] = catalog.mags[s];
        info[v * 4 + 2] = catalog.arcs ? catalog.arcs[s] : 1; // per-star arc scale (echo slots: birth time)
        info[v * 4 + 3] = i + (i === ns - 1 ? 0.5 : 0);       // sample index (+½ = tip) along the arc (echo: harpK)
        col[v * 4] = catalog.tints[s * 3];
        col[v * 4 + 1] = catalog.tints[s * 3 + 1];
        col[v * 4 + 2] = catalog.tints[s * 3 + 2];
        col[v * 4 + 3] = (2.6 * Math.pow(LOW_SUB_DECAY, i)) / norm; // amplitude (echo slots: off-screen flag)
      }
    }
    echoBase = v;
    for (let e = 0; e < nEcho; e++) {
      info[(echoBase + e) * 4 + 2] = -1e6;
      info[(echoBase + e) * 4 + 3] = -1;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4));
    const mat = new THREE.ShaderMaterial({
      name: 'loch.starPoints',
      uniforms,
      vertexShader: POINTS_VERTEX,
      fragmentShader: POINTS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    object = new THREE.Points(geo, mat);
  }
  object.name = 'loch.stars';
  object.frustumCulled = false; // positions are computed in the vertex shader

  const aPos = geo.getAttribute('position');
  const aInfo = geo.getAttribute('aInfo');
  const aCol = geo.getAttribute('aCol');
  for (const a of [aPos, aInfo, aCol]) a.setUsage(THREE.DynamicDrawUsage);
  let dirtyMin = Infinity;
  let dirtyMax = -1;

  function markDirty(slot) {
    if (slot < dirtyMin) dirtyMin = slot;
    if (slot > dirtyMax) dirtyMax = slot;
  }

  /** Writes one echo slot. kind 1 sky-anchored, 2 air, 3 reflection-only (x,z = water point). */
  function setEcho(slot, x, y, z, kind, level, birth, harpK, r, g, b, offFlag) {
    const v0 = echoBase + slot * vPerEcho;
    for (let c = 0; c < vPerEcho; c++) {
      const v = v0 + c;
      aPos.array[v * 3] = x;
      aPos.array[v * 3 + 1] = y;
      aPos.array[v * 3 + 2] = z;
      aInfo.array[v * 4] = kind;
      aInfo.array[v * 4 + 1] = level;
      aInfo.array[v * 4 + 2] = birth;
      aInfo.array[v * 4 + 3] = harpK;
      aCol.array[v * 4] = r;
      aCol.array[v * 4 + 1] = g;
      aCol.array[v * 4 + 2] = b;
      aCol.array[v * 4 + 3] = offFlag;
    }
    markDirty(slot);
  }

  function clearEcho(slot) {
    const v0 = echoBase + slot * vPerEcho;
    for (let c = 0; c < vPerEcho; c++) aInfo.array[(v0 + c) * 4 + 1] = 0;
    markDirty(slot);
  }

  /** Uploads only the echo range that changed this frame. */
  function flush() {
    if (dirtyMax < 0) return;
    const start = echoBase + dirtyMin * vPerEcho;
    const count = (dirtyMax - dirtyMin + 1) * vPerEcho;
    aPos.addUpdateRange(start * 3, count * 3);
    aInfo.addUpdateRange(start * 4, count * 4);
    aCol.addUpdateRange(start * 4, count * 4);
    aPos.needsUpdate = aInfo.needsUpdate = aCol.needsUpdate = true;
    dirtyMin = Infinity;
    dirtyMax = -1;
  }

  function dispose() {
    geo.dispose();
    object.material.dispose();
  }

  return { object, uniforms, setEcho, clearEcho, flush, dispose };
}
