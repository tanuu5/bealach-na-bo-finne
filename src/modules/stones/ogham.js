// Ogham notch atlas for the stone circle (docs/DESIGN.md §6.3, §10.6).
// Drawn procedurally with canvas strokes — never from a font — so it is identical offline and in the bundle.
//
// Atlas layout: 512×512, 11 vertical cells (one per stone, cell index = stone id).
//   u (inside a cell): signed distance ACROSS the arris, −ACROSS_M … +ACROSS_M metres, stem (= the arris) at the centre.
//        positive = face A (the broad inner face; for the recumbent: its inner face below the top arris)
//        negative = face B (the side face; for the recumbent: its top face)
//   v: distance ALONG the arris from the stone's buried base (uprights) or from its west end (recumbent), 0 … ALONG_M metres.
// Channels (a notch is a V in section, so the three encode its three parts, §2.3):
//   R = the lit lip — a narrow band along the notch's lower edge, the only part that goes ×2+ and blooms
//   G = the soft wash spilling out of the groove onto the face
//   B = the cut groove itself (slightly wider than the core), which darkens the albedo when unlit
import * as THREE from 'three';

export const ATLAS_SIZE = 512;
export const ATLAS_CELLS = 11;
export const ACROSS_M = 0.4;
export const ALONG_M = 4.0;

// §6.3 letter table: glyph → { letter, aicme, strokes }.
const TABLE = [
  ['b', 'ᚁ', 'B', 1], ['l', 'ᚂ', 'B', 2], ['f', 'ᚃ', 'B', 3], ['s', 'ᚄ', 'B', 4], ['n', 'ᚅ', 'B', 5],
  ['h', 'ᚆ', 'H', 1], ['d', 'ᚇ', 'H', 2], ['t', 'ᚈ', 'H', 3], ['c', 'ᚉ', 'H', 4], ['q', 'ᚊ', 'H', 5],
  ['m', 'ᚋ', 'M', 1], ['g', 'ᚌ', 'M', 2], ['ng', 'ᚍ', 'M', 3], ['z', 'ᚎ', 'M', 4], ['r', 'ᚏ', 'M', 5],
  ['a', 'ᚐ', 'A', 1], ['o', 'ᚑ', 'A', 2], ['u', 'ᚒ', 'A', 3], ['e', 'ᚓ', 'A', 4], ['i', 'ᚔ', 'A', 5],
];
const BY_GLYPH = new Map(TABLE.map(([letter, glyph, aicme, strokes]) => [glyph, { letter, glyph, aicme, strokes }]));

/** Parse an ogham glyph string (feather marks ignored) into letter records. */
export function parseOgham(glyphs) {
  const out = [];
  for (const ch of glyphs) {
    const rec = BY_GLYPH.get(ch);
    if (rec) out.push(rec);
  }
  return out;
}

// Inscriptions (§10.6): portals RÉALTA, harp stones the letter of their pitch index, recumbent TINE.
export const PORTAL_OGHAM = 'ᚏᚓᚐᚂᚈᚐ';
export const HARP_OGHAM = ['ᚁ', 'ᚂ', 'ᚃ', 'ᚄ', 'ᚅ', 'ᚆ', 'ᚇ', 'ᚈ'];
export const RECUMBENT_OGHAM = 'ᚈᚔᚅᚓ';

const STROKE_SPACING = 0.14; // m between strokes of one letter
const LETTER_GAP = 0.24; // m between letters
const STROKE_LEN = 0.3; // m, Beithe / hÚatha strokes
const MUINE_HALF = 0.24; // m, half-length of a Muine diagonal across the arris
const MUINE_RISE = 0.075; // m, along-offset of each end of the diagonal
const AILME_HALF = 0.07; // m, half-length of a vowel notch on the edge
const CORE_W = 0.05; // m, notch width

/**
 * Lay out an inscription along [availStart, availEnd] metres.
 * @param letters parsed letters
 * @param placement 0 = from the start, 0.5 = centred, other = fraction of spare length before the text
 * @returns {{ strokes: {a:number, aicme:string}[], start:number, end:number, scale:number }}
 */
export function layoutInscription(letters, availStart, availEnd, placement = 0) {
  let natural = 0;
  letters.forEach((l, i) => {
    natural += (l.strokes - 1) * STROKE_SPACING + (i > 0 ? LETTER_GAP : 0);
  });
  const pad = 0.1; // room for diagonals and round caps
  const avail = Math.max(0.2, availEnd - availStart - 2 * pad);
  const scale = natural > avail ? avail / natural : 1;
  const len = natural * scale;
  let cursor = availStart + pad + Math.max(0, avail - len) * placement;
  const start = cursor;
  const strokes = [];
  letters.forEach((l, i) => {
    if (i > 0) cursor += LETTER_GAP * scale;
    for (let j = 0; j < l.strokes; j++) strokes.push({ a: cursor + j * STROKE_SPACING * scale, aicme: l.aicme });
    cursor += (l.strokes - 1) * STROKE_SPACING * scale;
  });
  return { strokes, start: start - pad, end: cursor + pad, scale };
}

function boxBlur(src, w, h, rx, ry, passes) {
  let a = Float32Array.from(src); // never write into the caller's buffer
  let b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    if (rx > 0) {
      const inv = 1 / (2 * rx + 1);
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let acc = 0;
        for (let x = -rx; x <= rx; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
        for (let x = 0; x < w; x++) {
          b[row + x] = acc * inv;
          acc += a[row + Math.min(w - 1, x + rx + 1)] - a[row + Math.max(0, x - rx)];
        }
      }
      [a, b] = [b, a];
    }
    if (ry > 0) {
      const inv = 1 / (2 * ry + 1);
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let y = -ry; y <= ry; y++) acc += a[Math.min(h - 1, Math.max(0, y)) * w + x];
        for (let y = 0; y < h; y++) {
          b[y * w + x] = acc * inv;
          acc += a[Math.min(h - 1, y + ry + 1) * w + x] - a[Math.max(0, y - ry) * w + x];
        }
      }
      [a, b] = [b, a];
    }
  }
  return a;
}

/**
 * Build the 11-cell atlas.
 * @param cells array of { strokes, beitheSide: +1 | -1 } (beitheSide = which face gets Beithe strokes; hÚatha get the other)
 * @returns {{ texture: THREE.CanvasTexture, canvas: HTMLCanvasElement }}
 */
export function buildOghamAtlas(cells, renderer) {
  const S = ATLAS_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);

  const cellW = S / ATLAS_CELLS;
  const pxU = cellW / (2 * ACROSS_M);
  const pxV = S / ALONG_M;
  // Deterministic jitter so the pecked notch edges are stable across runs.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  cells.forEach((cell, index) => {
    if (!cell) return;
    const cx = (index + 0.5) * cellW;
    g.save();
    g.beginPath();
    g.rect(index * cellW, 0, cellW, S);
    g.clip();
    // Work in metres: x = across, y = along.
    g.setTransform(pxU, 0, 0, pxV, cx, 0);
    g.fillStyle = '#fff';
    const sB = cell.beitheSide;
    // A chiselled notch: a wedge that is widest where it bites the arris and tapers outward, with pecked edges.
    const notch = (a0, c0, a1, c1, w0, w1) => {
      const dx = c1 - c0;
      const dy = a1 - a0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const steps = 7;
      const left = [];
      const right = [];
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        const w = (w0 + (w1 - w0) * f) * 0.5 * (0.8 + 0.4 * rand());
        const x = c0 + dx * f;
        const y = a0 + dy * f + (rand() - 0.5) * 0.008;
        left.push([x + nx * w, y + ny * w]);
        right.push([x - nx * w, y - ny * w]);
      }
      g.beginPath();
      g.moveTo(left[0][0], left[0][1]);
      for (const [x, y] of left) g.lineTo(x, y);
      g.lineTo(c1 + (dx / len) * w1 * 0.4, a1 + (dy / len) * w1 * 0.4);
      for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
      g.closePath();
      g.fill();
    };
    for (const st of cell.strokes) {
      // A real inscription is cut by hand: every stroke has its own length, bite, depth and drift.
      // Without this the run reads as an evenly-pitched bar code rather than as chiselled notches.
      const lenJ = 0.66 + 0.62 * rand();
      const drift = (rand() - 0.5) * 0.042;
      const bite = 0.042 + 0.030 * rand(); // how far the notch crosses the arris onto the far face
      const wJ = 0.78 + 0.44 * rand();
      const skew = (rand() - 0.5) * 0.055; // the stroke is not quite square to the arris
      const a = st.a + drift;
      // Per-stroke depth: a shallow stroke catches less light than a deep one.
      g.globalAlpha = 0.52 + 0.48 * rand();
      if (st.aicme === 'B') notch(a, -bite * sB, a + 0.006 + skew, STROKE_LEN * lenJ * sB, CORE_W * 1.35 * wJ, CORE_W * 0.55);
      else if (st.aicme === 'H') notch(a, bite * sB, a - 0.006 + skew, -STROKE_LEN * lenJ * sB, CORE_W * 1.35 * wJ, CORE_W * 0.55);
      else if (st.aicme === 'M') {
        notch(a, 0, a - MUINE_RISE, -MUINE_HALF * lenJ, CORE_W * 1.3 * wJ, CORE_W * 0.55);
        notch(a, 0, a + MUINE_RISE, MUINE_HALF * lenJ, CORE_W * 1.3 * wJ, CORE_W * 0.55);
      } else notch(a, -AILME_HALF * lenJ, a, AILME_HALF * lenJ, CORE_W * 1.1 * wJ, CORE_W * 1.1 * wJ);
      g.globalAlpha = 1;
    }
    g.restore();
  });

  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  const core = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) core[i] = d[i * 4] / 255;
  const glow = boxBlur(core, S, S, 3, 7, 3);
  const groove = boxBlur(core, S, S, 1, 2, 1);
  // The lit lip: where the groove begins as you climb the arris, i.e. the notch's lower edge, which is
  // the lip the firelight and the ogham glow catch. LIP_V atlas rows ≈ 23 mm on the stone.
  const LIP_V = 3;
  const lipRaw = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    const yb = Math.max(0, y - LIP_V) * S;
    const yr = y * S;
    for (let x = 0; x < S; x++) lipRaw[yr + x] = Math.max(0, core[yr + x] - core[yb + x]);
  }
  const lip = boxBlur(lipRaw, S, S, 1, 1, 1);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    // The lip is deliberately not driven to saturation: the per-stroke depth jitter above has to survive
    // into the render, or every notch takes the light identically and the run reads as a bar code.
    d[o] = Math.round(Math.min(1, lip[i] * 1.12) * 255);
    d[o + 1] = Math.round(Math.min(1, glow[i] * 1.7) * 255);
    d[o + 2] = Math.round(Math.min(1, groove[i] * 1.6) * 255);
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  texture.needsUpdate = true;
  return { texture, canvas };
}
