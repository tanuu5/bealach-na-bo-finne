// Milky Way band texture for `sky` (docs/DESIGN.md §10.2). Pure JS, no DOM: generated once at setup.
//
// Texture space: u = θ/360° (periodic, θ = 0 at the north foot, increasing upward), v = (β + 15°)/30°.
// Row 0 of the data is v ≈ 0 (β = −15°); the DataTexture uploads with flipY = false.
//   R = milk: low-contrast large-scale brightness × fine unresolved-star grain × the soft dust veil
//   G = dust absorption, encoded as 0.22 + 0.50·core. The shader re-thresholds it with one octave of
//       value noise (smoothstep(0.42, 0.58, G + 0.16·(n − 0.5)), §10.2 verbatim), so core ≈ 0.4 reads as a
//       half-opaque lane with a ragged edge and core ≳ 0.88 as an opaque one.
//   B = envelope (0..1): where the band is broad and full and where it thins. Low contrast.
//   A = centre-line wobble (0..1 → ±1.25° in β), calm near the foot so the harp stars keep their places
//
// **Two separated layers** (§11.2 "soft milk with sharp dark lanes, never a glowing tube"):
//
//   Milk layer (R, B) — multi-octave fbm with almost all of its energy at large scales, held to ±25%
//   about its mean, plus a sparse near-texel grain that reads as unresolved starlight rather than as
//   cloud knots. Nothing in the milk layer is allowed to make an edge; every edge in the band comes
//   from the dust.
//
//   Dust layer, in two parts, because a dust lane is not one thing:
//
//   1. `ext`/`mottle` — broad extinction from two smooth potentials. Smooth, patchy, edgeless; this is
//      most of the dust the eye actually sees, and it only reaches R (never G), so it can never make an
//      edge. Without it the band is a flat wash with strokes drawn on it and the strokes have to carry
//      everything, which is how rev 1 ended up reading as cracks in granite.
//
//   2. `LANES` — the sharp dust lanes, each **carved along one low-frequency ridge line**: a centre
//      β(θ) that is a single-valued function of θ, so a lane is always one long elongated structure.
//      Noise modulates its wander, its weight and its width along its length, and frays its edge per
//      texel; nothing in the lane layer can change its topology.
//
//      POLISH-FIX (§3.5 "one long Great-Rift-like split", §11.2 "sharp dark lanes" — minor). The
//      previous revision took the sharp lanes as **contours of two smooth potential fields**, hoping
//      for channels that fork at saddles and pinch where the field flattens. At the default seed that
//      happened to read as one long rift, but the topology of a contour set is the topology of the
//      noise under it: at ?seed=7 (and, once looked for, at 1, 13, 42 and 99 too) the same code drew
//      closed rings, question-mark hooks and rows of dots — ink splatter on the milk, because the
//      noise gradient across β runs ≈ 5× the ramp that was supposed to keep the contours open, so most
//      "contours" were closed loops around noise extrema, chopped into dashes by their own selectors.
//      Carving along an explicit ridge line is the one formulation that cannot do that. Sharpness is
//      unchanged — the lane profile, the ragged edge and the sharp/feathered asymmetry are the same.
//
//   Only the lane threads reach G, so the shader's sharpening acts on them alone and the lane edge
//   stays sharp per §3.5/§11.2. Everything graded (broad extinction, and each lane's own dusky
//   channel) reaches R as a veil. Absorption is therefore layered rather than multiplied three times
//   over as it was in rev 1, where a lane darkened R, B and the shader's `lane` term together and went
//   to pure black against 105-luma milk.

const smoothstep = (a, b, x) => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Periodic-in-u value-noise lattice: nu × (nv + 1) random values. */
function makeLattice(rng, nu, nv) {
  const a = new Float32Array(nu * (nv + 1));
  for (let i = 0; i < a.length; i++) a[i] = rng();
  return { a, nu, nv };
}

/** Cubic-Hermite value noise. x periodic in [0,1) (any x ≥ −1), y clamped to [0,1]. */
function vn(L, x, y) {
  const nu = L.nu;
  const fx = (x + 1) * nu;
  let ix = fx | 0;
  const tx = fx - ix;
  ix %= nu;
  const ix1 = ix + 1 === nu ? 0 : ix + 1;
  let fy = y * L.nv;
  if (fy < 0) fy = 0;
  else if (fy > L.nv - 1e-4) fy = L.nv - 1e-4;
  const iy = fy | 0;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const r0 = iy * nu;
  const A = L.a;
  const p = A[r0 + ix];
  const q = A[r0 + ix1];
  const r = A[r0 + nu + ix];
  const s = A[r0 + nu + ix1];
  return p + (q - p) * sx + (r - p) * sy + (p - q - r + s) * sx * sy;
}

/** A low-frequency field evaluated on a coarse grid and bilinearly upsampled (periodic in u). */
function coarseField(W, H, step, fn) {
  const cw = Math.ceil(W / step);
  const ch = Math.ceil(H / step) + 1;
  const c = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    const v = (j * step + 0.5) / H;
    for (let i = 0; i < cw; i++) c[j * cw + i] = fn((i * step + 0.5) / W, v);
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = y / step;
    const jy = Math.min(ch - 2, fy | 0);
    const ty = fy - jy;
    for (let x = 0; x < W; x++) {
      const fx = x / step;
      const ix = fx | 0;
      const tx = fx - ix;
      const i0 = ix % cw;
      const i1 = (ix + 1) % cw;
      const a = c[jy * cw + i0];
      const b = c[jy * cw + i1];
      const d = c[(jy + 1) * cw + i0];
      const e = c[(jy + 1) * cw + i1];
      out[y * W + x] = a + (b - a) * tx + (d - a) * ty + (a - b - d + e) * tx * ty;
    }
  }
  return out;
}

// --- The dust lanes -------------------------------------------------------------------------------
//
// One entry per lane. A lane's centre line is `c0 + slope·(θ − a) + swing·sin(...) + wander·n(θ)`:
// single-valued in θ by construction, so the lane is one long elongated structure at every seed and
// can neither close into a ring nor break into blobs. Noise decides how far it wanders, how dense it
// is and how wide it is along its length, and frays its edge per texel.
//
//   a, b      θ range (deg); the lane fades in over taper[0] and out over taper[1]
//   amp       peak weight of the sharp thread (before the along-length breathing)
//   veil      how much broad dusky channel runs with it (0 = a bare thread)
//   c0/slope  base centre in β (deg) and its drift per degree of θ (or `cf(θ)` for a shaped one)
//   swing/period  a slow deterministic meander so no two lanes share the seed's wander shape
//   wander    amplitude (deg) of the seeded low-frequency wander of the centre
//   w0/wEnd   base half-width (deg) of the sharp thread, and its multiplier at the far end
//   dense     optional [θ0, θ1, θ2, θ3]: the stretch where this lane runs at its densest
//
// A lane's *thread* is always close to opaque where it runs: a thread held near the shader's
// smoothstep(0.42, 0.58) threshold along its whole length is broken into a dashed line by the
// sharpening noise, which was half of what the old contour lanes looked like. What varies along a lane
// is its width, the broad channel around it, and where it ends — not how nearly it exists.
//
// The first three entries are the art direction for θ ∈ [−22, 58], the stretch the default camera sees
// and the one §10.2 acceptance 1 measures: one dominant Rift with two subordinate lanes. The rest keep
// the far side of the circle from being bare — the band sets again near the south horizon (§3.5), and
// the core's Milky-Way dwell now holds the camera on the band for longer, so more of the circle is
// looked at, and looked at for longer.
const LANES = [
  // The Great Rift. It runs just off the bulge's bright centre line on the −β bank, widens away from
  // it as it climbs and drifts back near the top, as the real Rift does. Deliberately NOT on the
  // centre line: §10.2 acceptance 1 reads the band core at (757, 160) and wants 55–120 there, so the
  // Rift passes ≈ 1.5° to the −β side of it and leaves bright milk on both banks. It is the widest
  // lane in the piece and the only one that crosses the whole frame; everything else is subordinate.
  { a: -22, b: 58, taper: [12, 18], amp: 1.0, veil: 0.95,
    cf: (t) => -1.10 - 1.95 * smoothstep(10, 30, t) + 1.20 * smoothstep(30, 48, t),
    swing: 0.55, period: 0.31, phase: 0.4, wander: 0.62,
    w0: 1.05, wEnd: 0.55, dense: [0.5, 4.0, 9.0, 17.0] },
  // its companion on the +β bank: thinner, softer, further out, and only from halfway up the frame,
  // so the stretch the camera sees is one dominant Rift with a subordinate lane above it
  { a: 7, b: 34, taper: [9, 11], amp: 0.82, veil: 0.32,
    c0: 4.2, slope: 0.05, swing: 0.5, period: 0.42, phase: 1.3, wander: 0.8, w0: 0.34, wEnd: 0.9 },
  // a spur that leaves the Rift about θ = 15 and drifts out to the −β edge
  { a: 14, b: 40, taper: [7, 13], amp: 0.8, veil: 0.4,
    c0: -2.6, slope: -0.125, swing: 0.34, period: 0.5, phase: 2.1, wander: 0.72, w0: 0.44, wEnd: 0.8 },
  // the stretch above the bulge, thinning as the band narrows
  { a: 64, b: 124, taper: [14, 20], amp: 0.9, veil: 0.6,
    c0: 0.9, slope: -0.03, swing: 0.55, period: 0.21, phase: 0.9, wander: 0.95, w0: 0.62, wEnd: 0.8 },
  // the setting branch near the south horizon: its own long rift …
  { a: 138, b: 218, taper: [16, 20], amp: 0.98, veil: 0.8,
    c0: -0.6, slope: 0.022, swing: 0.6, period: 0.19, phase: 2.7, wander: 1.0, w0: 0.85, wEnd: 0.7,
    dense: [160, 172, 190, 206] },
  // … and a short companion across it
  { a: 166, b: 201, taper: [8, 10], amp: 0.8, veil: 0.4,
    c0: 2.4, slope: -0.03, swing: 0.4, period: 0.44, phase: 0.2, wander: 0.65, w0: 0.4 },
  { a: 232, b: 298, taper: [15, 18], amp: 0.88, veil: 0.55,
    c0: -1.6, slope: 0.035, swing: 0.5, period: 0.24, phase: 1.7, wander: 0.9, w0: 0.6, wEnd: 0.85 },
  { a: 306, b: 336, taper: [9, 11], amp: 0.76, veil: 0.4,
    c0: 1.5, slope: -0.04, swing: 0.35, period: 0.41, phase: 3.0, wander: 0.6, w0: 0.42 },
];

// Large, soft brightness rises in the milk (θ°, β°, σθ°, σβ°, gain). These are the only art direction in
// the milk layer and they stay inside the ±25% budget: star clouds, not knots.
const CLOUDS = [
  [4.5, -2.4, 6.0, 4.2, 0.115],
  [11.5, -0.6, 3.4, 2.6, 0.075],
  [19.0, -1.4, 4.6, 3.0, 0.070],
  [30.0, -1.8, 5.2, 3.4, 0.055],
  [1.0, 2.8, 3.6, 2.6, 0.045],
];

/**
 * @param {{ width:number, height:number, rng:() => number }} opts
 * @returns {{ width, height, data: Uint8Array, R: Float32Array, G: Float32Array, B: Float32Array, A: Float32Array, ms: number }}
 */
export function generateBand({ width, height, rng }) {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const W = width;
  const H = height;
  const N = W * H;
  const R = new Float32Array(N);
  const G = new Float32Array(N);
  const B = new Float32Array(N);
  const A = new Float32Array(N);
  const res = W / 2048; // 1 at high quality, 0.5 at low
  const fine = res >= 1 ? 1 : 0.62; // the low-res texture carries less of the finest octaves
  // fine lattices are specified at 2048×192 and scaled with the texture, so a low-quality run keeps the
  // same cells-per-texel instead of aliasing its finest octaves into dashes
  const fu = (n) => Math.max(8, Math.round(n * res));
  const fv = (n) => Math.max(2, Math.round(n * res));
  // ≈ 3 rows of the texture (a row is 30°/H), so a lane's opaque core always survives the LinearFilter
  const minWid = 0.50 / res;

  // --- lattices. (nu cells per 360° of θ, nv cells per 30° of β.)
  // P1/P2: the two smooth potentials behind the broad, edgeless extinction. They make no edges and
  // never reach G — only the lanes below do.
  const Lp1 = [makeLattice(rng, 20, 7), makeLattice(rng, 46, 15), makeLattice(rng, 104, 30)];
  const Lp2 = [makeLattice(rng, 60, 20), makeLattice(rng, 146, 46)];
  const Lpatch = makeLattice(rng, 13, 5); // dust complexes: long stretches with much less dust
  const Lwu = makeLattice(rng, 26, 5);
  const Lwv = makeLattice(rng, 20, 4);
  const Ledge = makeLattice(rng, fu(560), fv(70));
  const Lmilk = [makeLattice(rng, 22, 6), makeLattice(rng, 58, 15), makeLattice(rng, 132, 30)];
  const Lenv = [makeLattice(rng, 17, 4), makeLattice(rng, 44, 11)];
  const Lgrain = [makeLattice(rng, fu(980), fv(104)), makeLattice(rng, fu(430), fv(52))];
  const Lwob = [makeLattice(rng, 12, 1), makeLattice(rng, 30, 1)];
  // per-lane low-frequency noise along θ: where the centre wanders (≈ 22°/cell and 9°/cell), how dense
  // the lane is (≈ 15°/cell) and how wide (≈ 9°/cell). Long wavelengths only — the lane must breathe
  // along its length, never blink on and off.
  const Lwan = [makeLattice(rng, 16, 1), makeLattice(rng, 40, 1)];
  const Ldens = makeLattice(rng, 24, 1);
  const Lwid = makeLattice(rng, 40, 1);

  // --- coarse low-frequency fields (domain warp, envelope, dust-complex gate)
  const warpU = coarseField(W, H, 4, (u, v) => (vn(Lwu, u, v) - 0.5) * 0.009);
  const warpV = coarseField(W, H, 4, (u, v) => (vn(Lwv, u, v) - 0.5) * 0.10);
  const envF = coarseField(W, H, 4, (u, v) => 0.64 * vn(Lenv[0], u, v) + 0.36 * vn(Lenv[1], u, v));
  const patchF = coarseField(W, H, 6, (u, v) => vn(Lpatch, u, v));
  // the two broad potentials, on the coarse grid: they are smooth by construction and only feed R, so
  // sampling them every 2 texels costs nothing in edge quality and takes 5 value-noise calls per texel
  // out of the inner loop (§10.2: the texture must build in ≤ 120 ms).
  const extF = coarseField(W, H, 2, (u, v) =>
    0.55 * vn(Lp1[0], u, v) + 0.30 * vn(Lp1[1], u, v) + 0.15 * vn(Lp1[2], u, v));
  const motF = coarseField(W, H, 2, (u, v) =>
    0.64 * vn(Lp2[0], u + (v - 0.5) * 0.46, v) + 0.36 * vn(Lp2[1], u + (v - 0.5) * 0.28, v));

  // --- per-column tables: the centre-line wobble, and every lane's ridge line at this θ
  const colTheta = new Float32Array(W);
  const colWob = new Float32Array(W);
  const nL = LANES.length;
  const laneC = new Float32Array(nL * W);   // centre in β (deg)
  const laneW = new Float32Array(nL * W);   // half-width of the sharp thread (deg)
  const laneA = new Float32Array(nL * W);   // thread weight, 0 where the lane does not run
  const laneV = new Float32Array(nL * W);   // weight of the broad channel around it
  for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W;
    const th = wrapDeg(u * 360);
    colTheta[i] = th;
    const w0 = 0.62 * vn(Lwob[0], u, 0.5) + 0.38 * vn(Lwob[1], u, 0.5);
    colWob[i] = 0.5 + (w0 - 0.5) * (0.3 + 0.7 * smoothstep(14, 34, Math.abs(th - 5)));
    const th360 = u * 360; // 0 … 360, so a lane that straddles θ = 0 is written with a negative `a`
    for (let m = 0; m < nL; m++) {
      const F = LANES[m];
      const tt = F.a < 0 && th360 > 180 ? th360 - 360 : th360;
      if (tt <= F.a || tt >= F.b) continue;
      const o = m * 0.137;
      const wan = 0.66 * (vn(Lwan[0], u + o, 0.5) - 0.5) + 0.34 * (vn(Lwan[1], u + o, 0.5) - 0.5);
      const dn = vn(Ldens, u + o, 0.5);
      const wd = vn(Lwid, u + o * 1.7, 0.5);
      // the broad channel fades in and out over the whole taper; the thread ends over half of it, so a
      // lane's end thins away instead of spending 10° of θ sitting on the sharpening threshold, where
      // it would read as a row of dots.
      const ev = smoothstep(F.a, F.a + F.taper[0], tt) * (1 - smoothstep(F.b - F.taper[1], F.b, tt));
      const et = smoothstep(F.a, F.a + F.taper[0] * 0.5, tt)
        * (1 - smoothstep(F.b - F.taper[1] * 0.5, F.b, tt));
      let op = 0.78 + 0.22 * smoothstep(0.25, 0.80, dn);
      if (F.dense) {
        const d = smoothstep(F.dense[0], F.dense[1], tt) * (1 - smoothstep(F.dense[2], F.dense[3], tt));
        op = Math.min(1, op + 0.22 * d);
      }
      laneC[m * W + i] = (F.cf ? F.cf(tt) : F.c0 + F.slope * (tt - F.a))
        + F.swing * Math.sin(tt * F.period + F.phase) + F.wander * wan * 2;
      // width carries most of the variation along the length: the lane narrows and opens out again,
      // which is what a dust lane does and what a uniform stroke never does. Never below `minWid`
      // though: the opaque core of a thinner lane falls between the texture's rows, the LinearFilter
      // averages it to grey and the shader's sharpening noise then cuts it into a dashed line.
      const wTap = F.wEnd === undefined ? 1 : 1 + (F.wEnd - 1) * ((tt - F.a) / (F.b - F.a));
      laneW[m * W + i] = Math.max(minWid, F.w0 * wTap * (0.50 + 0.95 * wd));
      laneA[m * W + i] = F.amp * et * op;
      laneV[m * W + i] = F.veil * ev * (0.34 + 0.66 * smoothstep(0.18, 0.78, 1 - dn));
    }
  }

  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / H;
    const be = v * 30 - 15;
    const row = j * W;
    for (let i = 0; i < W; i++) {
      const idx = row + i;
      const u = (i + 0.5) / W;
      const x = u + warpU[idx];
      const y = v + warpV[idx];
      const bw = be + warpV[idx] * 6; // gently warped β for the lane geometry (deg)
      A[idx] = colWob[i];
      const bc = be - (colWob[i] - 0.5) * 2.5;
      const abc = bc < 0 ? -bc : bc;
      // dust lives on the band, not in the sky beside it
      const centre = 1 - smoothstep(2.6, 10.5, abc);

      // two near-texel noises: one frays a lane's edges symmetrically, one displaces its centre line,
      // so the lane wanders as well as frays and no single noise value can pinch it shut everywhere.
      // The second is the milk's own fine grain lattice, reused rather than sampled twice (§10.2: the
      // texture must build in ≤ 120 ms) — the two are used for unrelated things at the same scale.
      const rag = vn(Ledge, x, y) - 0.5;
      const g1 = vn(Lgrain[0], x, y);
      const g2 = vn(Lgrain[1], x, y);
      const rag2 = g2 - 0.5;

      // ---- the lanes. Each is a ridge line: one sharp thread (→ G) inside its own broad mottled
      // channel (→ R). A real dust lane has a sharp side and a feathered side, and the sharp one faces
      // the milk it is silhouetted against — here the band's bright centre line — so the thread, its
      // channel and the dust piled around it are all narrow on that side. That asymmetry is also what
      // lets §10.2 acceptance 1's 20%→80% edge land inside its 8 px: the row's bright half is right
      // against the lane there, undimmed.
      let core = 0;
      let veil = 0;
      let near = 0; // how strongly any lane claims this texel — biases the broad extinction below
      for (let m = 0; m < nL; m++) {
        const wgt = laneA[m * W + i];
        const vwgt = laneV[m * W + i];
        if (wgt <= 0 && vwgt <= 0) continue;
        const wid = laneW[m * W + i];
        const cen = laneC[m * W + i];
        const dsn = bw - cen - rag2 * (0.16 + 0.26 * wid);   // the centre line wanders per texel …
        const ad = dsn < 0 ? -dsn : dsn;
        if (ad > wid * 6 + 2) continue;
        const sharp = cen < 0 ? dsn > 0 : dsn < 0;
        // the broad dusky channel: mottled so the milk shows through it in places and its outline is
        // ragged rather than ruled — this is most of a lane's visual weight …
        const vw = 0.85 * wid * (sharp ? 0.12 : 1.62);
        const vl = (1 - smoothstep(vw * 0.30, vw * 1.85, ad + rag * 0.55)) * vwgt
          * (0.42 + 0.58 * smoothstep(0.28, 0.74, motF[idx])) * 0.62;
        if (vl > veil) veil = vl;
        // … and one sharp dark thread running down it, its edge frayed per texel, which is what makes
        // the lane read as fibrous dust rather than as a drawn wire.
        const sw = 0.22 * wid * (sharp ? 0.70 : 1.50);
        const thr = (1 - smoothstep(sw * 0.7, sw * 2.0, ad + rag * (sharp ? 0.14 : 0.38))) * wgt;
        if (thr > core) core = thr;
        // the broad thickening of the dust around a lane follows the same asymmetry as the thread:
        // it must not dim the milk on the lane's sharp side, which is the bright edge the lane is
        // silhouetted against (§10.2 acceptance 1 measures that edge at ≤ 8 px from 20% to 80%).
        const nw = wid * (sharp ? 0.13 : 1.18);
        const nr = (1 - smoothstep(nw * 0.5, nw * 2.2, ad)) * Math.max(wgt, vwgt) * (sharp ? 0.12 : 1.0);
        if (nr > near) near = nr;
      }
      core *= centre;
      veil *= centre;

      // ---- broad extinction: smooth, patchy, edgeless. This is most of the dust the eye actually
      // sees. Without it the band is a flat wash with strokes drawn on it, and the strokes then have to
      // carry everything — which is how rev 1 ended up with cracks in granite. Lanes thicken the dust
      // around themselves; elsewhere long stretches of the band carry much less, so a lane is an event.
      const gate = Math.min(1, 0.42 + 0.58 * smoothstep(0.26, 0.74, patchF[idx]) + 1.0 * near) * centre;
      const ext = smoothstep(0.44, 0.88, extF[idx] + 0.45 * near) * gate;
      const mottle = smoothstep(0.50, 0.90, motF[idx]) * gate * 0.55;

      const thin = Math.min(1, ext * 0.74 + mottle + veil);
      // capped below 1 on purpose: with the shader's ±0.08 sharpening noise the darkest core then
      // frays between ~0.8 and 1.0 absorption at pixel scale, which reads as fibrous dust
      if (core > 0.9) core = 0.9;
      G[idx] = 0.22 + 0.5 * core;

      // ---- envelope (B): where the band is broad and full. Low contrast on purpose — this drives the
      // band's width and profile, and any contrast here shows up as a lumpy outline. Broad dust takes a
      // little off it too (a dusty stretch is a narrower band), but only a little: rev 1 subtracted 82%
      // here as well as from R and from `lane`, which is what drove the lanes to pure black.
      const env = clamp01(0.30 + 0.62 * envF[idx]) * (1 - 0.28 * thin);
      B[idx] = env;

      // ---- milk (R): large-scale fbm at ±25%, a sparse near-texel grain that reads as unresolved
      // stars, and the dust veil. No edges: every edge in the band comes from the lane layer.
      const th = colTheta[i];
      let m = 0.52 * vn(Lmilk[0], x, y) + 0.31 * vn(Lmilk[1], x, y) + 0.17 * vn(Lmilk[2], x, y);
      let knots = 0;
      for (let k = 0; k < CLOUDS.length; k++) {
        const cl = CLOUDS[k];
        const dth = wrapDeg(th - cl[0]);
        if (dth > cl[2] * 2.6 || dth < -cl[2] * 2.6) continue;
        const e1 = dth / cl[2];
        const f1 = (be - cl[1]) / cl[3];
        knots += cl[4] * Math.exp(-0.5 * (e1 * e1 + f1 * f1));
      }
      // sparse specks (cubed noise) plus a little symmetric tooth: unresolved starlight, not cloud
      const grain = (g1 * g1 * g1 * 0.30 + (g2 - 0.5) * 0.085) * fine;
      // 0.62 mean, ±0.25 of it from the fbm — the reviewer's ±25%, not rev 1's ±600%
      const milk = (0.62 + 0.31 * (m - 0.5) + knots + grain) * (1 - 0.72 * thin);
      R[idx] = milk < 0 ? 0 : milk > 1 ? 1 : milk;
    }
  }

  const data = new Uint8Array(N * 4);
  for (let p = 0, q = 0; p < N; p++, q += 4) {
    data[q] = (R[p] * 255 + 0.5) | 0;
    data[q + 1] = (G[p] * 255 + 0.5) | 0;
    data[q + 2] = (B[p] * 255 + 0.5) | 0;
    data[q + 3] = (A[p] * 255 + 0.5) | 0;
  }
  return { width: W, height: H, data, R, G, B, A, ms: now() - t0 };
}

/** Bilinear sample of a band field at (θ°, β°). β outside ±15° clamps to the edge rows. */
export function sampleBand(band, field, thetaDeg, betaDeg) {
  const W = band.width;
  const H = band.height;
  const fx = ((((thetaDeg / 360) % 1) + 1) % 1) * W - 0.5 + W;
  let fy = ((betaDeg + 15) / 30) * H - 0.5;
  if (fy < 0) fy = 0;
  if (fy > H - 1.001) fy = H - 1.001;
  let ix = Math.floor(fx);
  const tx = fx - ix;
  ix %= W;
  const ix1 = (ix + 1) % W;
  const iy = Math.floor(fy);
  const ty = fy - iy;
  const a = field[iy * W + ix];
  const b = field[iy * W + ix1];
  const c = field[(iy + 1) * W + ix];
  const d = field[(iy + 1) * W + ix1];
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
