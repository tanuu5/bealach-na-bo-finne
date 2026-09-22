// The White Cow's road (docs/DESIGN.md §10.8 "The path").
// Private helper of the `bealach` module: builds the 1024×1 FloatType path texture (xyz = position,
// w = width) whose u is linear in the climax clock T, plus a private 1024×2 frame texture
// (row 0 = side vector, row 1 = binormal) so the shaders never flip the lateral axis at the
// vertical column.
import * as THREE from 'three';

export const PATH_N = 1024;

// Leg A control points (§10.8). P5.y is resolved against heightAt at build time.
const LEG_A = [
  { p: [0, 263.1, -860.7], T: 8, w: 30 }, // P0 pillar top
  { p: [0, 42, -420], T: 10, w: 12 }, // P1 above hills
  { p: [0, 15, -95], T: 11.2, w: 4 }, // P2
  { p: [0, 10.6, -50], T: 12, w: 2.2 }, // P3 mound crown
  { p: [0, 3.4, -31.2], T: 13.5, w: 1.8 }, // P4 entrance
  { p: [0, null, -22], T: 14.2, w: 1.8 }, // P5 (heightAt + 0.15)
  { p: [0, 0.95, -12.5], T: 15, w: 1.8 }, // P6 portal gap
  { p: [0, 0.08, -8.4], T: 16, w: 1.8 }, // P7 loch edge
];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Path u (texture coordinate) of the particle/ribbon front at climax time T. Pure function of T. */
export function frontU(T) {
  if (T <= 8) return 0;
  if (T <= 16) return (T - 8) / 16;
  if (T <= 25) return 0.5 + (0.35 * (T - 16)) / 9;
  if (T <= 26) return 0.85;
  if (T <= 30) return 0.85 + (0.15 * (T - 26)) / 4;
  return 1;
}

// Default climax pose (§7.3, landscape d0 = 26): position (0, 5.845, 31.82) looking at (0, 2.5, 0).
const DEFAULT_CLIMAX_CAM = { y: 5.845, z: 31.82, tilt: Math.atan2(5.845 - 2.5, 31.82) };

/**
 * @param {{ heightAt:(x:number,z:number)=>number, lochRadius:number,
 *           climaxCam?:{ y:number, z:number, tilt:number } }} opts
 */
export function buildPath({ heightAt, lochRadius, climaxCam }) {
  const ground = (x, z) => {
    const h = heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  // DESIGN-QUESTION: §10.8 says "after P3 every sample outside the loch is re-projected to
  // heightAt + 0.15", which also flattens P4's y = 3.4 onto the mound (≈0.79). Implemented literally
  // (P4 then only shapes the arc-length timing), blended in over the first quarter of span P3→P4 so
  // there is no 0.45 m step at the crown, and floored at the water level 0.08 on the wet shore.
  const pts = LEG_A.map(({ p }) => new THREE.Vector3(p[0], p[1] ?? ground(p[0], p[2]) + 0.15, p[2]));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const spans = pts.length - 1;
  const DIV = spans * 600;
  curve.arcLengthDivisions = DIV;
  const lengths = curve.getLengths(DIV);
  const arcAt = LEG_A.map((_, i) => lengths[i * 600]);
  const t3 = 3 / spans;
  const tBlend = 0.25 / spans;

  const tmp = new THREE.Vector3();

  /** Fully resolved (re-projected) curve point at arc length s. */
  function resolveAt(s, out) {
    const t = curve.getUtoTmapping(0, s);
    curve.getPoint(t, out);
    if (t > t3) {
      const r = Math.hypot(out.x, out.z);
      const target = r < lochRadius ? 0.08 : Math.max(ground(out.x, out.z) + 0.15, 0.08);
      out.y += (target - out.y) * smooth(t3, t3 + tBlend, t);
    }
    return out;
  }

  // REVIEW-FIX (climax, "the pour over the sí mound reads as a hang then a snap"): at the §7.3 climax
  // pose the dome's top is so foreshortened that the first 60% of the crown→entrance arc covers ~23 px
  // of screen and the last 40% covers ~100 px, so 1.5 s of choreography read as 1.1 s of nothing plus a
  // 0.35 s drop — the opposite of §11.2's "slow and heavy", at the moment the milk touches the land.
  // The P3 and P4 time knots (§7.3: crown at T = 12, entrance at T = 13.5) are kept exactly; only the
  // *within-span* mapping changes from "linear in arc length" to "linear in screen elevation", so the
  // front's screen speed across the mound is even.
  const cam = climaxCam || DEFAULT_CLIMAX_CAM;
  /** Monotone proxy for screen y: tan(depression below the climax camera's view axis). */
  function screenProxy(p) {
    const horiz = Math.max(1e-3, Math.hypot(p.x, cam.z - p.z));
    return Math.tan(Math.atan2(cam.y - p.y, horiz) - cam.tilt);
  }
  const SCREEN_BLEND = 1.0; // the front's screen speed across the mound is what has to be even
  function buildScreenRemap(i) {
    const s0 = arcAt[i];
    const s1 = arcAt[i + 1];
    const N = 96;
    const py = new Float64Array(N + 1);
    const probe = new THREE.Vector3();
    for (let j = 0; j <= N; j++) py[j] = screenProxy(resolveAt(s0 + ((s1 - s0) * j) / N, probe));
    for (let j = 1; j <= N; j++) if (py[j] < py[j - 1]) py[j] = py[j - 1]; // enforce monotone
    const a = py[0];
    const b = py[N];
    if (!(b - a > 1e-6)) return null;
    return (f) => {
      if (f <= 0) return 0;
      if (f >= 1) return 1;
      const target = a + (b - a) * f;
      let lo = 0;
      let hi = N;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (py[m] <= target) lo = m;
        else hi = m;
      }
      const d = py[lo + 1] - py[lo];
      const g = (lo + (d > 1e-12 ? (target - py[lo]) / d : 0)) / N;
      return f + (g - f) * SCREEN_BLEND;
    };
  }
  const spanRemap = LEG_A.map(() => null);
  spanRemap[3] = buildScreenRemap(3); // P3 mound crown → P4 entrance stone

  function legA(T, out) {
    let i = 0;
    while (i < spans - 1 && T > LEG_A[i + 1].T) i++;
    const k0 = LEG_A[i].T;
    const k1 = LEG_A[i + 1].T;
    const f = Math.min(1, Math.max(0, (T - k0) / (k1 - k0)));
    const g = spanRemap[i] ? spanRemap[i](f) : f;
    resolveAt(arcAt[i] + g * (arcAt[i + 1] - arcAt[i]), tmp);
    const w = LEG_A[i].w + f * (LEG_A[i + 1].w - LEG_A[i].w);
    out[0] = tmp.x;
    out[1] = tmp.y;
    out[2] = tmp.z;
    out[3] = w;
  }

  // DESIGN-QUESTION (raised for the lead by the bealach fix pass): §10.8 acceptance 2 asks for three
  // bright leg-B samples at T = 20, at (506,464), (640,486) and (724,464). Projecting r = 6.0 − 3.8·w,
  // φ = 1080°·w with the page's own climax camera puts those pixels on the spiral crossings at
  // φ = 270°, 540° and 810°, which the §10.8 leg table (u linear in T, 0.5 → 0.85 over T 16 → 25)
  // reaches at T = 18.25, 20.50 and 22.75 — so two of them cannot be lit at T = 20 without rushing
  // 2.25 of the three turns into the first 4 s of a 9 s leg, against §11.2's "slow and heavy".
  // Worse, (640,486) can never be milk at any T: the recumbent stone (§3.2 id 5, φ = 180°, 1.1 m on
  // the 0.8 m bank crest) projects at the climax pose with its top edge at y = 483 across x 588–692,
  // so the whole near-south arm of the spiral (r 5.37 → y 495, r 4.10 → y 486, r 2.83 → y 479) stands
  // behind it. What brightens there late in the climax is the stone's face, not the river.
  // The timing table is therefore implemented exactly as written; the acceptance points need the
  // correction (crossings that are both passed and visible at T = 20: (506,464) φ=270, (757,464)
  // φ=450 and (791,464) φ=90 — measured 228 / 192 / 223).
  function legB(wl, out) {
    if (wl < 0.03) {
      const k = wl / 0.03;
      out[0] = 0;
      out[1] = 0.08;
      out[2] = -8.4 + (-6.0 + 8.4) * k;
      out[3] = 1.8 + (1.6 - 1.8) * k;
      return;
    }
    const w = (wl - 0.03) / 0.97;
    const r = 6.0 - 3.8 * w;
    const phi = (1080 * w * Math.PI) / 180;
    out[0] = r * Math.sin(phi);
    out[1] = 0.08;
    out[2] = -r * Math.cos(phi);
    out[3] = 1.6;
  }

  function legC(c, out) {
    if (c < 0.1) {
      const k = c / 0.1;
      out[0] = 0;
      out[1] = 0.08 + (0.5 - 0.08) * k;
      out[2] = -2.2 + 2.2 * k;
    } else {
      const k = (c - 0.1) / 0.9;
      out[0] = 0;
      out[1] = 0.5 + (80 - 0.5) * k;
      out[2] = 0;
    }
    // REVIEW-FIX (art/climax/ux/lead, the return column): §10.8 gives leg C width 1.0 → 0.6, which
    // holds the milk grain in a 0.6 m thread inside a column whose silhouette now opens toward the sky
    // (visuals.js). The grain has to fill the cone or it reads as a thread inside a beam, so the width
    // now follows the column's taper instead of fighting it.
    out[3] = 1.0 + (3.6 - 1.0) * c;
  }

  /** Exact (analytic) path sample at texture u. out = [x, y, z, w]. */
  function pathAt(u, out) {
    if (u <= 0.5) legA(8 + u * 16, out);
    else if (u <= 0.85) legB((u - 0.5) / 0.35, out);
    else legC((u - 0.85) / 0.15, out);
    return out;
  }

  const pathData = new Float32Array(PATH_N * 4);
  const s4 = [0, 0, 0, 0];
  for (let i = 0; i < PATH_N; i++) {
    pathAt(i / (PATH_N - 1), s4);
    pathData.set(s4, i * 4);
  }

  // Frame: side = normalize(cross(tangent, up)); near-vertical tangents keep the previous side
  // (parallel transport) instead of snapping to (1,0,0), so lanes never mirror at the column foot.
  const frameData = new Float32Array(PATH_N * 2 * 4);
  const tan = new THREE.Vector3();
  const side = new THREE.Vector3();
  const prevSide = new THREE.Vector3(-1, 0, 0);
  const bin = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const prevTan = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < PATH_N; i++) {
    const a = Math.max(0, i - 1) * 4;
    const b = Math.min(PATH_N - 1, i + 1) * 4;
    tan.set(pathData[b] - pathData[a], pathData[b + 1] - pathData[a + 1], pathData[b + 2] - pathData[a + 2]);
    if (tan.lengthSq() < 1e-10) tan.copy(prevTan);
    tan.normalize();
    prevTan.copy(tan);
    side.crossVectors(tan, up);
    if (side.length() < 0.2) {
      side.copy(prevSide).addScaledVector(tan, -prevSide.dot(tan));
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    }
    side.normalize();
    if (side.dot(prevSide) < 0) side.negate();
    prevSide.copy(side);
    bin.crossVectors(side, tan).normalize();
    const o0 = i * 4;
    const o1 = (PATH_N + i) * 4;
    frameData[o0] = side.x;
    frameData[o0 + 1] = side.y;
    frameData[o0 + 2] = side.z;
    frameData[o0 + 3] = 0;
    frameData[o1] = bin.x;
    frameData[o1 + 1] = bin.y;
    frameData[o1 + 2] = bin.z;
    frameData[o1 + 3] = 0;
  }

  const makeTex = (data, h) => {
    const tex = new THREE.DataTexture(data, PATH_N, h, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };

  /** Lerped texture sample (matches the shader's manual two-texel lerp). */
  function sampleData(data, row, u, out) {
    const x = Math.min(1, Math.max(0, u)) * (PATH_N - 1);
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, PATH_N - 1);
    const f = x - i0;
    const base = row * PATH_N;
    for (let c = 0; c < 4; c++) {
      out[c] = data[(base + i0) * 4 + c] * (1 - f) + data[(base + i1) * 4 + c] * f;
    }
    return out;
  }

  return {
    pathTexture: makeTex(pathData, 1),
    frameTexture: makeTex(frameData, 2),
    pathData,
    frameData,
    pathAt,
    sampleSide: (u, out) => sampleData(frameData, 0, u, out),
    samplePath: (u, out) => sampleData(pathData, 0, u, out),
    ground,
    dispose() {},
  };
}
