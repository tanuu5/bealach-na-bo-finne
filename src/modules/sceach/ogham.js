// Ogham helpers for the sceach word ribbon (docs/DESIGN.md §6.3, §10.7).
// The ribbon texture is ALWAYS drawn procedurally (stemline + strokes), never from a font, so it is
// identical offline, in the bundle and on machines without Noto Sans Ogham. When a 2D canvas context
// is unavailable the same stroke list is rasterised into a DataTexture (procedural fallback).
import * as THREE from 'three';

// Letter index i: aicme = floor(i / 5), stroke count = i % 5 + 1, glyph = U+1681 + i.
const LETTER_INDEX = {
  b: 0, l: 1, f: 2, s: 3, n: 4, // Beithe
  h: 5, d: 6, t: 7, c: 8, q: 9, // hÚatha
  m: 10, g: 11, ng: 12, z: 13, r: 14, // Muine
  a: 15, o: 16, u: 17, e: 18, i: 19, // Ailme
};

export const HOLD_WORDS = ['beith', 'dair', 'coll', 'sail', 'fearn'];
export const MAX_LETTERS = 12;
export const TEX_W = 512;
export const TEX_H = 64;

const PENTA = [0, 1, 3, 4, 5];

/** word (latin) → letter indices; `ng` digraph → ᚍ; letters without ogham (j k p v w x y) dropped. */
export function lettersFromWord(word, out = []) {
  out.length = 0;
  const w = String(word ?? '').toLowerCase();
  for (let i = 0; i < w.length && out.length < MAX_LETTERS; i++) {
    const ch = w[i];
    if (ch === 'n' && w[i + 1] === 'g') {
      out.push(LETTER_INDEX.ng);
      i++;
      continue;
    }
    const idx = LETTER_INDEX[ch];
    if (idx !== undefined) out.push(idx);
  }
  return out;
}

/** ogham string (feather marks and anything else ignored) → letter indices. */
export function lettersFromOgham(str, out = []) {
  out.length = 0;
  for (const ch of String(str ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1681 && cp <= 0x1694 && out.length < MAX_LETTERS) out.push(cp - 0x1681);
  }
  return out;
}

export function oghamString(letters) {
  let s = '';
  for (const i of letters) s += String.fromCodePoint(0x1681 + i);
  return s;
}

/** §6.3: stroke count → pitch (PENTA[c−1]); aicme → voice. */
export function letterVoice(i) {
  const aicme = Math.floor(i / 5);
  const strokes = (i % 5) + 1;
  const degree = PENTA[strokes - 1];
  switch (aicme) {
    case 0: return { aicme, strokes, degree, voice: 'pluck', octave: 1, gain: 0.18, decay: 2.8 };
    case 1: return { aicme, strokes, degree, voice: 'pluck', octave: 2, gain: 0.16, decay: 2.4 };
    case 2: return { aicme, strokes, degree, voice: 'bell', octave: 1, gain: 0.08, decay: 4 };
    default: return { aicme, strokes, degree, voice: 'bell', octave: 2, gain: 0.06, decay: 5 };
  }
}

/**
 * Layout of a word on the 512×64 texture: slot 0 = ᚛, slots 1..n = letters, slot n+1 = ᚜.
 * Texture x runs along the ribbon (u = 0 at the bottom end), so the word reads bottom → top.
 */
export function wordLayout(n) {
  const slots = n + 2;
  // Short words (the five hold words are 4–5 letters) spread over the whole cloth: the ribbon is only
  // ~59 px long on screen at the default camera, so every texel of slot width buys stroke separation.
  const slotW = Math.min(90, (TEX_W - 16) / slots);
  const x0 = (TEX_W - slotW * slots) / 2;
  return { slots, slotW, x0 };
}

// The texture is stretched ≈1.94× along x on the ribbon (1.4 m / 512 px vs 0.09 m / 64 px), so the
// stroke geometry below is drawn narrow in x to read with even proportions on the cloth.
function strokeList(letters) {
  const { slots, slotW, x0 } = wordLayout(letters.length);
  const cy = TEX_H / 2;
  const segs = []; // [x0, y0, x1, y1, width]
  const stemW = 4.0;
  // stemline, from the feather tip to the end feather
  segs.push([x0 + slotW * 0.25, cy, x0 + slotW * (slots - 0.25), cy, stemW]);
  // ᚛ opening feather: a chevron pointing into the word
  const fa = x0 + slotW * 0.25;
  segs.push([fa, cy - 17, fa + slotW * 0.42, cy, 4.2]);
  segs.push([fa, cy + 17, fa + slotW * 0.42, cy, 4.2]);
  // ᚜ closing feather
  const fb = x0 + slotW * (slots - 0.25);
  segs.push([fb, cy - 17, fb - slotW * 0.42, cy, 4.2]);
  segs.push([fb, cy + 17, fb - slotW * 0.42, cy, 4.2]);
  // Strokes run ACROSS the 0.09 m cloth, so they are ~1 px tall on screen however they are drawn;
  // what separates one letter from the next is their extent ALONG the ribbon. Hence fat, widely
  // pitched strokes: each letter reads as its own cluster of glowing notches (§2.3 x2.5 cores).
  const pitch = Math.min(15, (slotW * 0.82) / 5);
  const sw = Math.max(3.2, Math.min(8, pitch * 0.52));
  letters.forEach((li, k) => {
    const aicme = Math.floor(li / 5);
    const c = (li % 5) + 1;
    const mid = x0 + slotW * (k + 1.5);
    for (let j = 0; j < c; j++) {
      const x = mid + (j - (c - 1) / 2) * pitch;
      if (aicme === 0) segs.push([x, cy, x, cy + 27, sw]); // Beithe: one side
      else if (aicme === 1) segs.push([x, cy, x, cy - 27, sw]); // hÚatha: the other side
      else if (aicme === 2) segs.push([x - 5.5, cy + 26, x + 5.5, cy - 26, sw]); // Muine: diagonal across
      else segs.push([x, cy - 11, x, cy + 11, sw + 1.6]); // Ailme: short notches on the stem
    }
  });
  return segs;
}

function drawCanvas(g, letters) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, TEX_W, TEX_H);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  for (const [ax, ay, bx, by, w] of strokeList(letters)) {
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
  }
}

function rasterize(data, letters) {
  // Capsule-distance rasteriser (fallback when no 2D context exists). R = G = B = coverage, A = 255.
  data.fill(0);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const [ax, ay, bx, by, w] of strokeList(letters)) {
    const r = w / 2;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
    const maxX = Math.min(TEX_W - 1, Math.ceil(Math.max(ax, bx) + r + 1));
    const minY = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
    const maxY = Math.min(TEX_H - 1, Math.ceil(Math.max(ay, by) + r + 1));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const d = Math.hypot(px - dx * t, py - dy * t);
        const cov = Math.max(0, Math.min(1, r + 0.5 - d));
        if (cov <= 0) continue;
        // canvas row 0 is the top; DataTexture row 0 is the bottom — flip to match CanvasTexture(flipY)
        const o = ((TEX_H - 1 - y) * TEX_W + x) * 4;
        const v = Math.max(data[o], Math.round(cov * 255));
        data[o] = data[o + 1] = data[o + 2] = v;
      }
    }
  }
}

/** Creates the word texture holder. `draw(letters)` redraws it (event time only, never per frame). */
export function createWordTexture(maxAnisotropy = 1) {
  let canvas = null;
  let g = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    g = canvas.getContext('2d');
  } catch {
    g = null;
  }
  let texture;
  let data = null;
  if (g) {
    texture = new THREE.CanvasTexture(canvas);
  } else {
    data = new Uint8Array(TEX_W * TEX_H * 4);
    texture = new THREE.DataTexture(data, TEX_W, TEX_H, THREE.RGBAFormat);
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
  }
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // The cloth is ~59 x 4 px on screen: without anisotropy the mip chain averages the strokes away
  // long before the word is off the ribbon. The steeper minification is across the width, so an
  // anisotropic sample blurs a stroke along its own length and keeps its position along the word.
  texture.anisotropy = Math.max(1, Math.min(16, maxAnisotropy));
  return {
    texture,
    procedural: g ? 'canvas' : 'data',
    draw(letters) {
      if (g) drawCanvas(g, letters);
      else rasterize(data, letters);
      texture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
    },
  };
}
