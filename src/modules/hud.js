// src/modules/hud.js — the HUD (docs/DESIGN.md §9, §10.9). Load order 9, last.
//
// Owns: every DOM node under ctx.hud, Google Fonts loading, ctx.ui.toast, hint sequencing,
// the ending and epilogue, the sound button, the harp ringing meter and ogham typing.
//
// Typography is the only 2D design in the piece, so this module draws no boxes, panels, blurs
// or borders (§9.1, §11.3 #5): text, one 1 px stem between two ogham feather marks, eight 1 px
// notches, three 1 px strokes and a single 72×14 compass-drawn ornament, on nothing.
//
// Performance (§10.0, §10.9 budget): no allocation in update(), at most a dozen animated
// elements, only `opacity` and `transform` are written per frame, and the ringing meter is
// rate-limited to 10 Hz. All timing runs on the visual clock `ctx.state.time` (§4.4) so
// `?warm=`, `?phaseT=` and `&freezeT` are deterministic.

import {
  COPY,
  HINTS,
  TOASTS,
  OGHAM,
  FEATHER_START,
  FEATHER_END,
  feather,
  lettersToOgham,
  wordToOgham,
  japaneseSubset,
} from './hud/copy.js';
import { CSS } from './hud/style.js';
import { ORNAMENT_SVG } from './hud/ornament.js';

// Harp stones k = 0..7 are LAYOUT.stones ids 1,2,3,4,6,7,8,9 (§3.2) — used for the meter
// fallback that reads world.stones.ringing, which is indexed by stone id.
const HARP_IDS = [1, 2, 3, 4, 6, 7, 8, 9];

const REST = 0.85; // element opacity at rest: Japanese lands on 72%, Irish on 85% (§9.1)
const STEM_REST = 0.85;
// §11.3 #3 ("gold lines … appear only while something rings"): the whole stemline — stem, feather
// marks and notch ladder — is up only while it carries a word or a ringing harp stone, and holds
// for STEM_HOLD seconds after the last one so it cannot flicker between two taps.
const STEM_HOLD = 2.5;
const RING_ON = 0.05; // a ring fainter than this does not hold the line up
const NOTCH_FLOOR = 0.13; // an unlit notch keeps a trace, so the ladder reads as a ladder
const DIM_SEEN = 0.35; // title 8 s after the first interaction, and again after the climax
const DIM_CLIMAX = 0.2; // title during hush…afterglow (§7.3 hud column)

const TITLE_IN_AT = 1.2; // §9.3: title fades in at 1.2 s over 1.6 s
const TITLE_IN_DUR = 1.6;
const HINT_FIRST_AT = 2.5; // h0 is eligible from 2.5 s
const HINT_MAX_SHOW = 12; // a hint shows for at most 12 s …
const HINT_COOLDOWN = 20; // … then its slot stays empty 20 s before it may return
const TOAST_MS = 3200;
const TOAST_GAP = 3.5; // minimum seconds between two toast starts
const TIR_AT = 44; // §9.3: the afterglow toast is scheduled at T = 44
const WISH_STEM_S = 6; // a wish word stays on the stemline for 6 s (§9.4)
const TYPED_CLEAR_S = 2; // Enter clears the typing buffer after 2 s (§9.4)
const PULSE_FALL = 0.45; // seconds for a downbeat hint pulse to fall back

// Phases during which hints and toasts are hidden (§9.3 timing rules).
const CLIMAX_PHASES = { hush: 1, pillar: 1, pour: 1, river: 1, return: 1 };

// DESIGN-QUESTION (§9.1 vs §3.5): the toast sits at 16vh, which at the default camera is exactly
// where the Milky Way crosses the frame, and both the toast and the band are `boFinne`. With the
// single specified shadow (`0 0 14px rgba(8,13,12,.85)`) the toast is legible over the band but
// its contrast is the lowest in the HUD. Implemented exactly as written; if a native reader finds
// it thin, the cheapest fix that keeps "no panels" is a second, tighter shadow on `.bf-toast`.
//
// DESIGN-QUESTION (§10.9 acceptance 1 vs §10.0 headless timing): the HUD schedules on
// `ctx.state.time`, like the rest of the piece, so `--wait 3500` does NOT put 3.5 s on the visual
// clock under SwiftShader (measured: ≈ 1.0 s) and h0 has not yet appeared. Every acceptance run
// below therefore adds `&warm=4`, which §10.0 explicitly sanctions. On real hardware the wall
// clock and `state.time` agree and the command as written passes.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(a, b, x) {
  const t = clamp01((x - a) / (b - a || 1e-6));
  return t * t * (3 - 2 * t);
}

export default async function setup(ctx) {
  const { events, params } = ctx;
  const root = ctx.hud;
  if (!root) return {}; // ?nohud, or a host page without the overlay container

  const doc = root.ownerDocument || document;
  const reduced = !!ctx.reducedMotion;

  // ── DOM ────────────────────────────────────────────────────────────────────
  const owned = []; // every node this module added, for dispose()
  const mk = (tag, cls, parent) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  };
  const span = (cls, text, parent) => {
    const e = mk('span', cls, parent);
    e.textContent = text;
    return e;
  };

  root.classList.add('bf-root');
  if (reduced) root.classList.add('bf-rm');

  const styleEl = mk('style', null);
  styleEl.textContent = CSS;
  root.appendChild(styleEl);
  owned.push(styleEl);

  // Title — a vertical tanzaku: 白き牛の道 with ルーナサの星祭 in a smaller column to its left.
  const titleEl = mk('div', 'bf-el bf-title');
  span('s', COPY.subtitle.ja, titleEl);
  span('m', COPY.title.ja, titleEl);

  // Irish signature with the La Tène trumpet-curve ornament above it.
  const irishEl = mk('div', 'bf-el bf-irish');
  irishEl.innerHTML = ORNAMENT_SVG; // authored in ./hud/ornament.js, no runtime input
  span('m', COPY.title.ga, irishEl);
  span('s', COPY.subtitle.ga, irishEl);

  const hintEl = mk('div', 'bf-el bf-hint');
  const toastEl = mk('div', 'bf-el bf-toast');
  toastEl.setAttribute('aria-live', 'polite');
  toastEl.setAttribute('aria-atomic', 'true');

  // Stemline: a 1 px stem terminated by the two ogham feather marks, the ogham word reading
  // bottom→top, and the 8-notch ringing meter. The terminals show only while the stem is bare:
  // a word brings its own ᚛ ᚜ (§9.4), and one inscription never carries two pairs.
  const stemEl = mk('div', 'bf-el bf-stemline bf-bare');
  const stemRule = mk('div', 'bf-stem', stemEl);
  span('bf-feather bf-f-top', FEATHER_END, stemEl);
  span('bf-feather bf-f-bot', FEATHER_START, stemEl);
  const oghamEl = mk('div', 'bf-og-word', stemEl);
  const notchWrap = mk('div', 'bf-notches', stemEl);
  const notches = [];
  for (let k = 0; k < 8; k++) {
    const n = mk('div', 'bf-notch', notchWrap);
    n.style.bottom = `calc(${((k * 100) / 7).toFixed(3)}% - ${(k / 7).toFixed(3)}px)`;
    notches.push(n);
  }

  const endEl = mk('div', 'bf-el bf-ending');
  span('ja', COPY.ending.ja, endEl);
  span('ga', COPY.ending.ga, endEl);

  const epiEl = mk('div', 'bf-el bf-epilogue');
  epiEl.textContent = COPY.epilogue.ja;

  // Sound button — the only pointer-interactive element in the overlay.
  const soundBtn = mk('button', 'bf-sound');
  soundBtn.type = 'button';
  soundBtn.setAttribute('aria-label', '音のオン／オフ');
  const strokeWrap = mk('div', 'bf-strokes', soundBtn);
  const strokes = [mk('i', 'bf-stroke', strokeWrap), mk('i', 'bf-stroke', strokeWrap), mk('i', 'bf-stroke', strokeWrap)];
  span('lab', '音', soundBtn);
  span('ga', 'ceol', soundBtn);

  for (const e of [titleEl, irishEl, stemEl, hintEl, toastEl, endEl, epiEl, soundBtn]) {
    root.appendChild(e);
    owned.push(e);
  }

  // ── Google Fonts (§9.1); ?nofonts renders the fallback stacks ──────────────
  const fontLinks = [];
  if (!params.has('nofonts')) {
    const link = (rel, href, cross) => {
      const l = doc.createElement('link');
      l.rel = rel;
      l.href = href;
      if (cross) l.crossOrigin = '';
      doc.head.appendChild(l);
      fontLinks.push(l);
    };
    link('preconnect', 'https://fonts.gstatic.com', true);
    link(
      'stylesheet',
      'https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500' +
        '&family=Zen+Kaku+Gothic+New:wght@300;400&display=swap&text=' +
        encodeURIComponent(japaneseSubset()),
    );
    link('stylesheet', 'https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@500&family=Noto+Sans+Ogham&display=swap');
  }

  // ── eased opacity, one value per element (§9.5: opacity only) ──────────────
  function fader(el, dur, durOut) {
    return { el, cur: 0, target: 0, dur, durOut: durOut || dur, last: -1 };
  }
  const fTitle = fader(titleEl, TITLE_IN_DUR);
  const fIrish = fader(irishEl, TITLE_IN_DUR);
  // The stemline answers a ring, so it arrives with it and leaves slowly.
  const fStem = fader(stemEl, 0.18, 1.2);
  const fSound = fader(soundBtn, TITLE_IN_DUR);
  const fHint = fader(hintEl, 0.6);
  const fToast = fader(toastEl, 0.6);
  const fEnd = fader(endEl, 0.4);
  const fEpi = fader(epiEl, 0.4);
  // The stem is gold, so it obeys §11.3 #3: it appears only while the line carries something —
  // an ogham word, or a harp stone still ringing — and never sits on black as a lone accent.
  const fRule = fader(stemRule, 0.6);
  const faders = [fTitle, fIrish, fStem, fSound, fHint, fToast, fEnd, fEpi, fRule];
  // §9.5: with reduced motion every change is a plain 0.6 s opacity ramp — including the
  // title's 1.6 s entrance, which is the only slow fade in the HUD.
  if (reduced) for (const f of faders) f.dur = f.durOut = 0.6;

  function stepFader(f, dt) {
    if (f.cur === f.target) return;
    const s = dt / (f.target > f.cur ? f.dur : f.durOut);
    f.cur = f.target > f.cur ? Math.min(f.target, f.cur + s) : Math.max(f.target, f.cur - s);
  }
  function writeFader(f, v) {
    if (v === f.last) return;
    if (Math.abs(v - f.last) < 0.004 && f.cur !== f.target) return;
    f.last = v;
    f.el.style.opacity = v >= 1 ? '1' : v <= 0 ? '0' : v.toFixed(3);
  }

  // ── state ──────────────────────────────────────────────────────────────────
  let firstT = -1; // state.time of festival:first-interaction
  let didFire = false;
  let didStone = false;
  let didWish = false;
  let veilOpened = false;
  let h5Armed = false;
  let starToasted = false;
  let lochToasted = false;
  let aossiToasted = false;
  let climaxSeen = false;
  let phase = 'idle';
  let tirToasted = false;
  let titleIn = false;

  // hint slot
  const hintSeen = new Int16Array(HINTS.length);
  const hintCooldown = new Float64Array(HINTS.length).fill(-1);
  let slot = -1;
  let slotSince = 0;
  let hintPulse = 0;
  let hintPulseAt = -1;

  // toasts
  const queue = [];
  let toastShowing = false;
  let toastUntil = 0;
  let toastNextAt = 0;

  // ogham typing / stemline
  const typed = [];
  let typedClearAt = -1;
  let wishGlyphs = '';
  let wishUntil = -1;
  let stemDirty = true;
  let lastStem = null;
  let stemUntil = -1;

  // ringing meter
  const ringLevel = new Float32Array(8);
  const ringShown = new Float32Array(8).fill(-1);
  let meterAcc = 0;
  let ringMax = 0;

  // sound-button beat strokes
  let beatAt = -1;
  let beatIdx = 0;
  let strokeOffAt = -1;
  let strokeOn = -1;

  let debugAll = false;

  // ── rendering helpers ──────────────────────────────────────────────────────
  function renderLine(el, ja, tail, tailCls) {
    el.textContent = '';
    if (ja) span('ja', ja, el);
    if (tail) {
      if (ja) span('sep', '·', el);
      span(tailCls, tail, el);
    }
  }
  function renderStem() {
    const s = typed.length ? feather(lettersToOgham(typed)) : wishGlyphs ? feather(wishGlyphs) : '';
    if (s === lastStem) return;
    lastStem = s;
    oghamEl.textContent = s;
    stemEl.classList.toggle('bf-bare', !s);
  }

  // ── toasts (ctx.ui.toast is replaced, §5.3) ────────────────────────────────
  function pushToast(item) {
    if (queue.length >= 8) return; // never let a runaway emitter build a backlog
    queue.push(item);
  }
  function pushCopy(key) {
    const c = TOASTS[key];
    if (c) pushToast({ ja: c.ja, ga: c.ga, cls: 'ga' });
  }
  const prevToast = ctx.ui.toast;
  ctx.ui.toast = (text, ms) => {
    if (text == null) return;
    pushToast({ ja: String(text), ga: null, cls: 'ga', ms });
  };

  // ── sound button ───────────────────────────────────────────────────────────
  function syncSound() {
    soundBtn.setAttribute('aria-pressed', ctx.audio && ctx.audio.enabled === false ? 'false' : 'true');
  }
  function toggleSound() {
    const a = ctx.audio;
    if (!a) return;
    a.toggle?.();
    // The button is a real user gesture, so turning sound back on may also unlock Web Audio;
    // without this the piece stays silent for a viewer whose first act is the sound button.
    if (a.enabled) a.unlock?.();
    syncSound();
  }
  syncSound();

  const onBtnClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleSound();
    soundBtn.blur(); // so a later Space goes to the veil, not back to this button (§9.3)
  };
  const onBtnKey = (e) => {
    const isSpace = e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';
    const isEnter = e.code === 'Enter' || e.code === 'NumpadEnter' || e.key === 'Enter';
    if (!isSpace && !isEnter) return;
    e.preventDefault();
    e.stopPropagation(); // core's window keydown never sees it → no `key` event, no veil (R15)
    if (e.repeat) return;
    toggleSound();
  };
  soundBtn.addEventListener('click', onBtnClick);
  soundBtn.addEventListener('keydown', onBtnKey);

  // ── acceptance helper: show every element at once with sample copy (§10.9 #2)
  function fillSampleCopy() {
    renderLine(hintEl, HINTS[0].ja, HINTS[0].ga, 'ga');
    renderLine(toastEl, TOASTS.star.ja, TOASTS.star.ga, 'ga');
    lastStem = null;
    oghamEl.textContent = feather('ᚁᚓᚔᚈᚆ');
    lastStem = oghamEl.textContent;
    stemEl.classList.remove('bf-bare');
    for (let k = 0; k < 8; k++) ringShown[k] = -1;
  }
  const mo = new MutationObserver(() => {
    const on = root.classList.contains('bf-debug-all');
    if (on === debugAll) return;
    debugAll = on;
    if (on) fillSampleCopy();
  });
  mo.observe(root, { attributes: true, attributeFilter: ['class'] });

  // ── ogham typing (§9.4) ────────────────────────────────────────────────────
  function typeLetter(c) {
    if (!OGHAM[c]) return; // j k p v w x y have no ogham letter and are dropped (§6.3)
    if (c === 'g' && typed.length && typed[typed.length - 1] === 'n') typed[typed.length - 1] = 'ng';
    else if (typed.length < 12) typed.push(c);
    else return;
    typedClearAt = -1;
    stemDirty = true;
  }

  // ── events ─────────────────────────────────────────────────────────────────
  const offs = [];
  const on = (name, fn) => offs.push(events.on(name, fn));

  on('festival:first-interaction', () => {
    if (firstT < 0) firstT = ctx.state.time;
  });

  on('offering', (p) => {
    if (p && p.byAosSi) {
      if (!aossiToasted) {
        aossiToasted = true;
        pushCopy('aossi');
      }
      return; // only the viewer's own offerings advance the hint sequence (§9.3)
    }
    if (!p) return;
    if (p.kind === 'fire') didFire = true;
    else if (p.kind === 'stone') didStone = true;
    else if (p.kind === 'wish') didWish = true;
  });

  on('star:born', (p) => {
    if (starToasted || !p || p.kind === 'harp') return;
    starToasted = true;
    pushCopy('star');
  });

  on('stone:ring', (p) => {
    if (!p) return;
    const k = p.k;
    if (typeof k !== 'number' || k < 0 || k > 7) return;
    const lv = typeof p.level === 'number' ? clamp01(p.level) : 1;
    if (lv > ringLevel[k]) ringLevel[k] = lv;
  });

  on('wish:tied', (p) => {
    if (!p) return;
    const g = p.ogham || (p.word ? wordToOgham(p.word) : '');
    if (!g) return;
    wishGlyphs = g;
    wishUntil = ctx.state.time + WISH_STEM_S;
    stemDirty = true;
  });

  on('spiral:progress', (p) => {
    if (h5Armed || !p || !p.segments) return;
    const s = p.segments;
    if (s[0] >= 1 && s[1] >= 1 && s[2] >= 1) h5Armed = true;
  });

  on('veil:hold', (p) => {
    if (p && p.active) veilOpened = true;
  });

  on('deiseal:turn', (p) => pushCopy(p && p.dir < 0 ? 'tuathal' : 'deiseal'));

  on('bealach:phase', (p) => {
    if (!p) return;
    phase = p.phase;
    if (phase === 'hush') {
      tirToasted = false;
      queue.length = 0;
    }
    // Any climax phase means the climax is either under way or already past — a `?phaseT` join
    // lands straight in one — and hints are permanently off after the first climax (§9.3).
    if (phase !== 'idle') climaxSeen = true;
    // §10.8's timeline rule, applied to the HUD's one-shots: a scheduled toast whose time has
    // already gone by when we join mid-phase is skipped, exactly as the conductor skips notes.
    // Without this every `?phaseT` inside the afterglow replays the T = 44 toast and the frozen
    // frame disagrees with live playback.
    if (typeof p.T === 'number' && p.T >= TIR_AT) tirToasted = true;
  });

  on('music:beat', (p) => {
    if (!p) return;
    const delay = typeof p.delay === 'number' ? p.delay : 0;
    const at = ctx.state.time + delay; // §4.4 rule 1: never compare `when` with state.time
    if (!reduced) {
      beatAt = at;
      beatIdx = Math.min(2, Math.max(0, Math.floor((p.beatInBar || 0) / 3)));
      if (p.beatInBar === 0) hintPulseAt = at;
    }
  });

  on('meteor:land', (p) => {
    if (lochToasted || !p) return;
    const inLoch = p.inLoch ?? (p.point ? isInLoch(p.point.x, p.point.z) : false);
    if (!inLoch) return;
    lochToasted = true;
    pushCopy('loch');
  });

  on('click:ground', (p) => {
    if (lochToasted || !p || !p.point) return;
    if (!isInLoch(p.point.x, p.point.z)) return;
    lochToasted = true;
    pushCopy('loch');
  });

  function isInLoch(x, z) {
    const l = ctx.world.loch; // read lazily: `loch` loads before hud, but may be absent
    if (l && typeof l.contains === 'function') return !!l.contains(x, z);
    return Math.hypot(x, z) < 9;
  }

  on('key', (p) => {
    if (!p || p.repeat === true) return; // CR-3; if the field is absent, accept the event
    const k = p.key;
    if (k === 'Backspace') {
      if (typed.length) {
        typed.pop();
        typedClearAt = -1;
        stemDirty = true;
      }
      return;
    }
    if (k === 'Escape') {
      if (typed.length) {
        typed.length = 0;
        typedClearAt = -1;
        stemDirty = true;
      }
      return;
    }
    if (k === 'Enter') {
      if (!typed.length) return;
      const word = typed.join('');
      const ogham = lettersToOgham(typed);
      events.emit('ogham:word', { word, ogham });
      pushToast({ ja: TOASTS.word.ja, ga: feather(ogham), cls: 'og' });
      typedClearAt = ctx.state.time + TYPED_CLEAR_S;
      return;
    }
    if (typeof k !== 'string' || k.length !== 1) return; // ignores 'Process', modifiers, F-keys
    const c = k.toLowerCase();
    if (c >= 'a' && c <= 'z') typeLetter(c);
  });

  on('audio:toggled', syncSound);

  // ── hint sequencing (§9.3) ─────────────────────────────────────────────────
  function eligible(i, now) {
    switch (i) {
      case 0:
        return now >= HINT_FIRST_AT && !ctx.state.started;
      case 1:
        return firstT >= 0 && now >= firstT + 4 && !didFire;
      case 2:
        return didFire && !didStone;
      case 3:
        return didStone && !didWish;
      case 4:
        return didWish && !veilOpened;
      case 5:
        return h5Armed;
      default:
        return false;
    }
  }
  function setSlot(next, now) {
    if (next === slot) return;
    if (slot >= 0) hintCooldown[slot] = now + HINT_COOLDOWN;
    slot = next;
    if (slot >= 0) {
      const h = HINTS[slot];
      hintSeen[slot]++;
      slotSince = now;
      renderLine(hintEl, h.ja, h.ga, 'ga');
      events.emit('hint:change', { id: h.id, target: h.target });
    } else {
      events.emit('hint:change', { id: null, target: null });
    }
  }

  // ── the climax clock, read lazily (§4.4, §5.3 load-order rule) ─────────────
  function climaxT() {
    const b = ctx.world.bealach;
    if (b && typeof b.T === 'number') return b.T;
    const u = ctx.uniforms.uClimaxT;
    return u ? u.value : -1;
  }

  // ── frame ──────────────────────────────────────────────────────────────────
  function update(dt) {
    const now = ctx.state.time;
    const T = climaxT();
    const inClimax = CLIMAX_PHASES[phase] === 1;
    const quiet = inClimax || (phase === 'afterglow' && T >= 0 && T < 42);

    // title / signature / stem / button
    if (!titleIn && now >= TITLE_IN_AT) {
      titleIn = true;
      fIrish.target = REST;
      fSound.target = 1;
    }
    if (titleIn) {
      // §9.3/§7.3: 72% → 35% eight seconds after the first interaction, 20% through the climax,
      // back to 35% in `fade`. A fully passive viewer never fires first-interaction, so the
      // post-climax rest value is keyed off climaxSeen as well, not off firstT alone.
      const dimmed = phase !== 'idle' && phase !== 'fade';
      const seen = climaxSeen || (firstT >= 0 && now >= firstT + 8);
      fTitle.target = dimmed ? DIM_CLIMAX : seen ? DIM_SEEN : REST;
      fIrish.target = fTitle.target; // the signature is the title's other half; they dim together
      if (!reduced && fTitle.cur >= REST - 0.002 && fTitle.dur === TITLE_IN_DUR) {
        fTitle.dur = 0.9;
        fIrish.dur = 0.9;
      }
    }

    // hints
    if (climaxSeen || quiet) {
      if (slot >= 0) setSlot(-1, now);
    } else {
      let want = -1;
      for (let i = 0; i < HINTS.length; i++) {
        const h = HINTS[i];
        // setSlot() counts a showing the moment the hint takes the slot, so the hint that owns
        // the slot right now is exempt from its own cap — otherwise a `maxTimes: 1` hint (h5)
        // would be evicted on the very next frame and never be readable at all.
        if (i !== slot && hintSeen[i] >= (h.maxTimes || 1e9)) continue;
        if (now < hintCooldown[i]) continue;
        if (!eligible(i, now)) continue;
        want = i;
        break;
      }
      if (want !== slot) setSlot(want, now);
      if (slot >= 0 && now - slotSince >= (HINTS[slot].maxShow || HINT_MAX_SHOW)) setSlot(-1, now);
    }
    fHint.target = slot >= 0 ? REST : 0;

    // downbeat pulses (hint opacity + one sound-button stroke)
    if (hintPulseAt >= 0 && now >= hintPulseAt) {
      hintPulseAt = -1;
      hintPulse = 1;
    }
    if (hintPulse > 0) {
      hintPulse -= dt / PULSE_FALL;
      if (hintPulse < 0) hintPulse = 0;
    }
    if (beatAt >= 0 && now >= beatAt) {
      beatAt = -1;
      if (strokeOn >= 0) strokes[strokeOn].classList.remove('on');
      strokeOn = beatIdx;
      strokes[strokeOn].classList.add('on');
      strokeOffAt = now + 0.08;
    }
    if (strokeOffAt >= 0 && now >= strokeOffAt) {
      strokeOffAt = -1;
      if (strokeOn >= 0) strokes[strokeOn].classList.remove('on');
      strokeOn = -1;
    }

    // toasts
    if (quiet) {
      if (queue.length) queue.length = 0;
      if (toastShowing) {
        toastShowing = false;
        fToast.target = 0;
      }
    } else {
      if (toastShowing && now >= toastUntil) {
        toastShowing = false;
        fToast.target = 0;
      }
      if (!toastShowing && queue.length > 0 && now >= toastNextAt && fToast.cur < 0.02) {
        const it = queue.shift();
        renderLine(toastEl, it.ja, it.ga, it.cls || 'ga');
        toastShowing = true;
        toastUntil = now + (it.ms > 0 ? it.ms / 1000 : TOAST_MS / 1000);
        toastNextAt = now + TOAST_GAP;
        fToast.target = REST;
      }
    }

    // ending + epilogue, pure functions of T so ?phaseT=&freezeT is stable
    if (T >= 0) {
      fEnd.target = REST * smoothstep(33, 34.5, T) * (1 - smoothstep(40.5, 42, T));
      fEpi.target = REST * smoothstep(54, 54.8, T) * (1 - smoothstep(62.2, 63, T));
      if (!tirToasted && T >= 44) {
        tirToasted = true;
        pushCopy('tir');
      }
    } else {
      fEnd.target = 0;
      fEpi.target = 0;
    }

    // stemline text
    if (typedClearAt >= 0 && now >= typedClearAt) {
      typedClearAt = -1;
      typed.length = 0;
      stemDirty = true;
    }
    if (wishUntil >= 0 && now >= wishUntil) {
      wishUntil = -1;
      wishGlyphs = '';
      stemDirty = true;
    }
    if (stemDirty) {
      stemDirty = false;
      renderStem();
    }

    // ringing meter, at most 10 Hz (§10.9 budget)
    meterAcc += dt;
    if (meterAcc >= 0.1) {
      const stones = ctx.world.stones;
      const live = stones && stones.ringing && stones.ringing.length >= 11 ? stones.ringing : null;
      let m = 0;
      for (let k = 0; k < 8; k++) {
        let v = live ? clamp01(live[HARP_IDS[k]]) : Math.max(0, ringLevel[k] - meterAcc * 0.1);
        ringLevel[k] = v;
        if (v > m) m = v;
        if (debugAll) continue;
        if (Math.abs(v - ringShown[k]) < 0.02 && !(v === 0 && ringShown[k] !== 0)) continue;
        ringShown[k] = v;
        // §9.2 says opacity = level; the floor keeps the eight rungs of the ladder legible from
        // the first ring, so the meter never reads as one gold rule with a single stray dash.
        notches[k].style.opacity = (NOTCH_FLOOR + (1 - NOTCH_FLOOR) * v).toFixed(3);
      }
      ringMax = m;
      meterAcc = 0;
    }
    // The stemline is only ever on the screen while it carries something (§11.3 #3), and the
    // stem itself stays faint so it sits behind the scene rather than on top of it.
    if (lastStem || ringMax > RING_ON) stemUntil = now + STEM_HOLD;
    fStem.target = titleIn && now < stemUntil ? STEM_REST : 0;
    fRule.target = Math.max(lastStem ? 0.34 : 0, ringMax > RING_ON ? 0.1 + 0.26 * ringMax : 0);

    // commit opacities
    for (let i = 0; i < faders.length; i++) stepFader(faders[i], dt);
    writeFader(fTitle, fTitle.cur);
    writeFader(fIrish, fIrish.cur);
    writeFader(fStem, fStem.cur);
    writeFader(fSound, fSound.cur);
    writeFader(fToast, fToast.cur);
    writeFader(fEnd, fEnd.cur);
    writeFader(fEpi, fEpi.cur);
    writeFader(fRule, fRule.cur);
    writeFader(fHint, fHint.cur + (1 - fHint.cur) * hintPulse * (fHint.target > 0 ? 1 : 0));
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
    mo.disconnect();
    soundBtn.removeEventListener('click', onBtnClick);
    soundBtn.removeEventListener('keydown', onBtnKey);
    for (const l of fontLinks) l.remove();
    fontLinks.length = 0;
    for (const e of owned) e.remove();
    owned.length = 0;
    root.classList.remove('bf-root', 'bf-rm', 'bf-debug-all');
    ctx.ui.toast = prevToast;
  }

  return { update, dispose };
}
