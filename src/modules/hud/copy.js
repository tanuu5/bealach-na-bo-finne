// hud/copy.js — every string the HUD may show, plus the ogham alphabet.
// docs/DESIGN.md §9.3 (copy), §6.3 (ogham as the score), §11.2 ("only these strings may appear").
// Nothing here is generated or inflected at runtime: the Irish is a fixed, proofread set.

/** §9.3 — the complete copy table. `ga` is the Irish half (null = none). */
export const COPY = {
  title: { ja: '白き牛の道', ga: 'Bealach na Bó Finne' },
  subtitle: { ja: 'ルーナサの星祭', ga: 'Oíche Lúnasa' },
  ending: { ja: '道はひらかれた', ga: 'Tá an bealach oscailte' },
  epilogue: { ja: 'アイルランドでは、天の川を〈白い牛の道〉とも呼ぶ。今夜は織姫と彦星も、その両岸に。', ga: null },
};

/**
 * §9.3 hint table, in slot priority order (lowest id wins the single slot).
 * `maxShow` overrides the default 12 s cap; `maxTimes` caps how often a hint may ever return.
 */
export const HINTS = [
  { id: 'h0', target: 'fire', ja: '触れると、音が鳴ります', ga: 'ceol' },
  { id: 'h1', target: 'fire', ja: '火に触れると、火の粉が星になる', ga: 'tine' },
  { id: 'h2', target: 'stone', ja: '石を鳴らすと、糸が星へのびる', ga: 'cláirseach' },
  { id: 'h3', target: 'wish', ja: 'サンザシに、願いの布を結ぶ', ga: 'ribín' },
  { id: 'h4', target: 'veil', ja: '夜空を長く押すと、帳がひらく', ga: null, maxTimes: 2 },
  { id: 'h5', target: 'loch', ja: '湖の渦が満ちるまで、捧げものを', ga: null, maxShow: 8, maxTimes: 1 },
];

/** §9.3 toasts. `og` marks the slot that carries ogham glyphs instead of Irish. */
export const TOASTS = {
  star: { ja: '星がひとつ生まれた', ga: 'réalta' },
  loch: { ja: '湖は、常若の国の空を映す', ga: 'loch' },
  aossi: { ja: '塚の民も、祭りに来ている', ga: 'aos sí' },
  deiseal: { ja: '日の巡りのとおりに', ga: 'deiseal' },
  tuathal: { ja: '逆回りは、古くから不吉とされる', ga: 'tuathal' },
  word: { ja: '文字を、空へ', ga: null, og: true },
  tir: { ja: '常若の国', ga: 'Tír na nÓg' },
};

// ── Ogham (§6.3) ──────────────────────────────────────────────────────────────
// Four aicmí of five letters. Letters with no ogham equivalent (j k p v w x y) are dropped.
export const OGHAM = {
  b: 'ᚁ', l: 'ᚂ', f: 'ᚃ', s: 'ᚄ', n: 'ᚅ', // Beithe
  h: 'ᚆ', d: 'ᚇ', t: 'ᚈ', c: 'ᚉ', q: 'ᚊ', // hÚatha
  m: 'ᚋ', g: 'ᚌ', ng: 'ᚍ', z: 'ᚎ', r: 'ᚏ', // Muine
  a: 'ᚐ', o: 'ᚑ', u: 'ᚒ', e: 'ᚓ', i: 'ᚔ', // Ailme
};

export const FEATHER_START = '᚛';
export const FEATHER_END = '᚜';

/** Wrap a run of glyphs in the feather marks, the way a written ogham word is framed. */
export function feather(glyphs) {
  return glyphs ? FEATHER_START + glyphs + FEATHER_END : '';
}

/**
 * Letter entries ('b', 'ng', …) → glyph string. Used for the typing buffer and for
 * showing a `wish:tied` word that arrived as letters rather than glyphs.
 */
export function lettersToOgham(letters) {
  let out = '';
  for (let i = 0; i < letters.length; i++) out += OGHAM[letters[i]] || '';
  return out;
}

/** A plain word (from `wish:tied`) → glyph string, honouring the `ng` digraph. */
export function wordToOgham(word) {
  const w = String(word || '').toLowerCase();
  let out = '';
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 'n' && w[i + 1] === 'g') {
      out += OGHAM.ng;
      i++;
    } else if (OGHAM[w[i]]) out += OGHAM[w[i]];
  }
  return out;
}

/**
 * §9.1 — the `text=` subset for the Japanese Google Fonts request: every Japanese
 * character this module can display, plus the punctuation the doc lists.
 * Built from the tables above so a copy edit can never outrun the subset.
 */
export function japaneseSubset() {
  let all = '「」〈〉、。・—…·　';
  all += COPY.title.ja + COPY.subtitle.ja + COPY.ending.ja + COPY.epilogue.ja;
  for (const h of HINTS) all += h.ja;
  for (const k in TOASTS) all += TOASTS[k].ja;
  let out = '';
  const seen = new Set();
  for (const ch of all) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    out += ch;
  }
  return out;
}
