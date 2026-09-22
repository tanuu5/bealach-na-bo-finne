// Star catalog for the loch trails: world.sky.catalog when present, otherwise a local catalog with the
// same distribution as sky's background stars (§10.2) so `?only=loch` still shows a believable sky.
import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Deterministic per-index hash in [0,1): the loch must look the same on every load for a given catalog. */
function hash1(i) {
  let x = (i | 0) * 374761393 + 668265263;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** 55% Gaussian around the band (σβ 6°), rest uniform above −5° elevation; power-law brightness. */
export function makeFallbackCatalog(count, rng, skyLayout, boFinneLin, torcLin) {
  const H = new THREE.Vector3().fromArray(skyLayout.bandFoot).normalize();
  const N = new THREE.Vector3().fromArray(skyLayout.bandPole).normalize();
  const T = new THREE.Vector3().crossVectors(H, N).normalize();
  const dirs = new Float32Array(count * 3);
  const mags = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const d = new THREE.Vector3();
  const warm = new THREE.Color().copy(torcLin).multiplyScalar(0.6).add(new THREE.Color().copy(boFinneLin).multiplyScalar(0.4));
  for (let i = 0; i < count; i++) {
    if (rng() < 0.55) {
      const th = rng() * Math.PI * 2;
      const be = gauss(rng) * 6 * DEG;
      d.copy(H).multiplyScalar(Math.cos(th)).addScaledVector(T, Math.sin(th)).multiplyScalar(Math.cos(be)).addScaledVector(N, Math.sin(be));
    } else {
      const smin = Math.sin(-5 * DEG);
      const y = smin + (1 - smin) * rng();
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = rng() * Math.PI * 2;
      d.set(r * Math.cos(a), y, r * Math.sin(a));
    }
    d.normalize().toArray(dirs, i * 3);
    mags[i] = 0.08 + 0.92 * Math.pow(rng(), 7); // ~2% bright
    const k = rng();
    colors[i * 3] = boFinneLin.r + (warm.r - boFinneLin.r) * k;
    colors[i * 3 + 1] = boFinneLin.g + (warm.g - boFinneLin.g) * k;
    colors[i * 3 + 2] = boFinneLin.b + (warm.b - boFinneLin.b) * k;
  }
  return { count, dirs, mags, colors };
}

/**
 * Picks the `n` brightest stars. Returns { n, dirs, mags (rank-based brightness 0..0.71), tints (rgb, max channel 1) }.
 * `low` flattens the rank curve (see RANK below).
 * DESIGN-QUESTION: §5.3 does not say whether catalog.mags is linear brightness or astronomical magnitude.
 * §10.2 ("magnitude follows a power law, so ~2% are bright", `addStar({mag:1})`) reads as linear brightness,
 * larger = brighter, which is what this assumes. catalog.colors may be rgb triplets (3·count) or scalars.
 */
export function selectBrightest(catalog, n, fallbackTint, low = false) {
  const count = Math.max(0, Math.min(catalog.count | 0, (catalog.dirs?.length ?? 0) / 3, catalog.mags?.length ?? 0));
  const idx = new Uint32Array(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  const mags = catalog.mags;
  idx.sort((a, b) => mags[b] - mags[a]);
  const take = Math.min(n, count);
  const out = {
    n: take,
    dirs: new Float32Array(take * 3),
    mags: new Float32Array(take),
    arcs: new Float32Array(take),
    tints: new Float32Array(take * 3),
  };
  // The low path draws 498 stars where the high path draws 3000, and spends a third of its points on giving
  // the readable ones a multi-sample streak (stars.js). On the high curve that leaves ~90 marks in the disc and
  // the wheel stops reading; flattening the rank curve for low brings the readable count back to ~190 without
  // touching the peak (0.71 vs 0.69 at rank 0) or the near-black tail. The loch mean stays far under the
  // §10.4 acceptance-1 ceiling either way (measured 0.15 of the band core against a 0.55 limit).
  const R = low ? [0.66, 9, 0.05, 3] : [0.66, 18, 0.03, 6];
  const rgb = catalog.colors && catalog.colors.length >= count * 3;
  const scalar = !rgb && catalog.colors && catalog.colors.length >= count;
  for (let j = 0; j < take; j++) {
    const i = idx[j];
    const x = catalog.dirs[i * 3];
    const y = catalog.dirs[i * 3 + 1];
    const z = catalog.dirs[i * 3 + 2];
    // world.sky.catalog is another module's data. A non-finite or zero-length direction used to pass
    // straight through (`Math.hypot(NaN,…) || 1` is 1, because NaN is falsy) and land in the trail
    // vertex attribute, where acos(clamp(NaN)) is NaN — and one NaN vertex, blended additively and
    // then blurred by the bloom, blanks the whole frame. Park the entry and let the shader clip it.
    const l = Math.hypot(x, y, z);
    const okDir = Number.isFinite(l) && l > 1e-6;
    out.dirs[j * 3] = okDir ? x / l : 0;
    out.dirs[j * 3 + 1] = okDir ? y / l : 1;
    out.dirs[j * 3 + 2] = okDir ? z / l : 0;
    // Brightness by rank, not by raw value: the look stays "near-black water with a few hundred readable
    // trails" whatever scale sky's catalog uses. Top ≈ 2% bright, the long tail barely above black.
    // A per-star factor on top of the rank curve breaks the "every dash is the same white" read: neighbouring
    // ranks differ by up to ±45%, so the trails scatter across magnitudes the way a real field does.
    const q = 1 - j / Math.max(1, take);
    const hb = hash1(j * 2 + 1);
    out.mags[j] = okDir ? (R[0] * Math.pow(q, R[1]) + R[2] * Math.pow(q, R[3])) * (0.55 + 0.9 * hb) : 0;
    // Trail geometry per star (read by the trail vertex shader): bright stars burn a long arc, the faint tail
    // barely a tick, and a ±22% random on top so equal-magnitude stars never share a length. Mean ≈ 0.55,
    // so the disc also loses roughly half of its additive trail coverage (§11.1).
    const m01 = Math.min(1, out.mags[j] / 0.62);
    out.arcs[j] = (0.34 + 0.78 * Math.sqrt(m01)) * (0.78 + 0.44 * hash1(j * 2 + 964));
    let r = fallbackTint.r;
    let g = fallbackTint.g;
    let b = fallbackTint.b;
    if (rgb) {
      r = catalog.colors[i * 3];
      g = catalog.colors[i * 3 + 1];
      b = catalog.colors[i * 3 + 2];
    } else if (scalar) {
      const k = catalog.colors[i];
      r *= k;
      g *= k;
      b *= k;
    }
    // Same reasoning as the direction above: a foreign colour that is non-finite or negative would
    // divide into a NaN / hugely negative tint. Fall back to the module's own tint instead.
    if (!(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) && r >= 0 && g >= 0 && b >= 0)) {
      r = fallbackTint.r;
      g = fallbackTint.g;
      b = fallbackTint.b;
    }
    const m = Math.max(r, g, b, 1e-6);
    // Tint only (max channel 1); never let a bluish tint through (§11.3 #1).
    out.tints[j * 3] = r / m;
    out.tints[j * 3 + 1] = g / m;
    out.tints[j * 3 + 2] = Math.min(b / m, g / m);
  }
  return out;
}
