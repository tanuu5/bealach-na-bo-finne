// conductor — the music clock and world.music, every continuous audio graph, note memory and echoes,
// and the climax score. docs/DESIGN.md §4.3, §4.4, §5.1, §5.3, §6.2, §7, §8, §10.1, §11.
//
// Audio only: builds no scene objects (0 draws). Before audio is unlocked it runs on a virtual clock
// (state.time) so beats, next() and chord() work with sound off or with no Web Audio at all.
//
// Clock rules (§4.4):
//   M.now() = state.time until audio is unlocked AND ctx.state === 'running'; A.now() after (one jump).
//   At that switch every pending grid/score time is shifted by the same offset, so the musical phase is
//   continuous against the visual clock and music:beat.index never repeats.
//   The bar grid is re-anchored on bealach:phase hush (T 0, 6/8), river (T 16, 9/8), afterglow (T 32, 6/8).
//   Each phase's score notes are scheduled when that phase's event arrives, at M.now() + (T_note − payload.T).

import { createGraph, LEVELS } from './conductor/graph.js';
import { createMemory } from './conductor/memory.js';
import {
  EIGHTH,
  PENTA,
  DM,
  CHORD_PENTA_IDX,
  GLISSANDO,
  BELL_RUN,
  RETURN_CHORD,
  MOTIF,
  PHASE_START,
  chordFor,
  stepLayer,
  pentaStep,
  mod,
  floorDiv,
  clamp,
} from './conductor/score.js';

const LOOKAHEAD = 0.12; // s (§8.2)
const STALE = 0.1; // a voice more than this late is dropped rather than played behind the beat
const CATCHUP_BARS = 2; // backlog beyond this is dropped in whole bars, so the bar phase survives
const MAX_EIGHTHS_PER_FRAME = 24; // ≥ CATCHUP_BARS × 9 + lookahead
const JOIN_TOL = 0.12; // a score note this close before payload.T still plays (the event lands a frame late)
const NEXT_MARGIN = 0.02; // M.next(): strictly more than 20 ms ahead
const ALLOW_SAME_KEY = 0.06; // s
const QUEUE_SIZE = 160;
const LOG_SIZE = 64;

const ECHO_PLUCK = 0.2; // typical interaction pluck gain (taps 0.28, strums 0.22, arpeggios 0.2, holds 0.12→0.05)
const ECHO_BELL = 0.09; // typical answer bell gain (0.06–0.12)

const K_PLUCK = 1;
const K_BELL = 2;
const K_WHOOSH = 3;
const K_DRUM = 4;
const KIND_NAME = ['', 'pluck', 'bell', 'whoosh', 'drum'];

export default async function setup(ctx) {
  const A = ctx.audio;
  const { state, events, uniforms, world } = ctx;
  uniforms.uFireLevel ??= { value: 0 };

  const lowQ = ctx.quality === 'low';
  const withPad = !lowQ; // low quality: drone only, no pad, no ornaments (§10.1, §11.1)
  const voiceLimit = lowQ ? 8 : 12; // voice-starts per second through allow() (§8.4)
  const rng = ctx.makeRng ? ctx.makeRng('conductor') : Math.random;
  const note = (d, o) => A.note(d, o);

  const stats = {
    beats: 0,
    bars: 0,
    pluck: 0,
    bell: 0,
    drum: 0,
    whoosh: 0,
    silent: 0, // voices whose logic ran while audio was not live (virtual clock or sound off)
    echoes: 0,
    idleEchoes: 0,
    crackles: 0,
    laps: 0,
    allowed: 0,
    denied: 0,
    reanchors: 0,
    clockSwitches: 0,
    stalls: 0,
    recoveries: 0,
  };

  // Continuous-graph state (declared first: the clock shifts some of it).
  let disposed = false;
  let graph = null;
  let builtAt = 0; // audio time
  let veilHold = false;
  let nextCrackle = 0;
  let crackleFree = -Infinity;
  let nextLap = 0;
  const surge = new Float64Array(32);
  let surgeHead = 0;
  let surgeCount = 0;

  // ------------------------------------------------------------------------------------------
  // Clock and bar grid
  // ------------------------------------------------------------------------------------------
  // Internal grid time `mt` and the external music clock M.now():
  //   'visual'  (before unlock)          mt = state.time              M.now() = state.time
  //   'audio'   (unlocked, running)      mt = A.now()                 M.now() = A.now()
  //   'stalled' (running, clock frozen)  mt advances with state.time  M.now() = A.now()
  // 'stalled' exists because a context can report 'running' while currentTime does not advance (headless
  // Chrome sticks at 0.00533 s; iOS reports 0 for a while; machines without an output device). Beats must
  // keep running then (§8.2), so the grid continues on visual time and every time handed out is expressed
  // as A.now() + (grid time − mt), which keeps `music:beat.when − M.now() === delay` true in every mode.
  // DESIGN-QUESTION: §4.4 describes a single jump; 'stalled' adds a fallback (and a re-sync when the audio
  // clock starts advancing) that only triggers when the audio clock is not moving.
  let mode = 'visual';
  let clockOffset = 0; // last visual→audio (or recovery) shift, for debug
  let stallMt0 = 0;
  let stallSt0 = 0;
  let wdA = 0; // watchdog references
  let wdSt = 0;
  const WD_WINDOW = 0.3; // s of visual time per watchdog comparison

  const grid = { anchor: 0, anchorBar: 0, B: 6, meter: '6/8' }; // eighth j is at anchor + j·EIGHTH (mt domain)
  let nextJ = 0; // next eighth (relative to anchor) the scheduler will schedule
  let anchorGen = 0; // bumped by every re-anchor
  let lastWhen = -Infinity;
  let lastBar = -1;
  let beatIndex = 0;

  /** Move every pending internal time into a new clock domain. */
  function shiftAll(off) {
    clockOffset = off;
    grid.anchor += off;
    lastWhen += off;
    queueShift(off);
    // Continuous envelopes restart from the new "now" (their stale checks reset them).
    surgeCount = 0;
    crackleFree = -Infinity;
  }

  function refreshMode() {
    if (mode !== 'visual') return;
    const ac = A.ctx;
    if (A.ready && ac && ac.state === 'running') {
      const tA = A.now();
      shiftAll(tA - state.time);
      mode = 'audio';
      wdA = tA;
      wdSt = state.time;
      stats.clockSwitches++;
    }
  }

  /** Internal grid clock. */
  function mtNow() {
    refreshMode();
    if (mode === 'visual') return state.time;
    if (mode === 'audio') return A.now();
    return stallMt0 + (state.time - stallSt0);
  }

  /** world.music.now(): state.time before unlock, audio time after (§4.4). */
  function now() {
    refreshMode();
    return mode === 'visual' ? state.time : A.now();
  }

  /** External minus internal time (non-zero only while the audio clock is stalled). */
  function extOff() {
    return mode === 'stalled' ? A.now() - (stallMt0 + (state.time - stallSt0)) : 0;
  }

  /** Detects a frozen audio clock (→ 'stalled') and its recovery (→ 'audio', re-synced). */
  function watchdog() {
    if (mode === 'visual') return;
    const a = A.now();
    const st = state.time;
    const vProg = st - wdSt;
    const aProg = a - wdA;
    // A running clock advances at least as fast as state.time (clamped dt) in chunks of ≤ one output buffer, so a
    // clock that has not moved at all over 0.15 s of visual time is frozen; slower-but-moving needs the full window.
    const frozen = mode === 'audio' && aProg === 0 && vProg >= WD_WINDOW * 0.5;
    if (vProg < WD_WINDOW && !frozen) return;
    if (mode === 'audio' && aProg < 0.2 * vProg) {
      // Continue the grid from where the audio clock should be had it kept pace since the window began
      // (≥ a, so grid time stays monotonic), which keeps the beat gap at detection short.
      stallMt0 = wdA + vProg;
      stallSt0 = st;
      mode = 'stalled';
      stats.stalls++;
    } else if (mode === 'stalled' && aProg > 0.8 * vProg) {
      shiftAll(a - (stallMt0 + (st - stallSt0)));
      mode = 'audio';
      stats.recoveries++;
    }
    wdA = a;
    wdSt = st;
  }

  const barLen = () => grid.B * EIGHTH;
  const barAt = (t) => grid.anchorBar + Math.floor((t - grid.anchor) / barLen());

  function next(division) {
    return nextInternal(division) + extOff();
  }

  function nextInternal(division) {
    const t = mtNow() + NEXT_MARGIN;
    let unit;
    switch (division) {
      case 'sixteenth':
        unit = EIGHTH / 2;
        break;
      case 'beat':
        unit = EIGHTH * 3;
        break;
      case 'bar':
        unit = barLen();
        break;
      default:
        unit = EIGHTH;
    }
    const k = Math.floor((t - grid.anchor) / unit) + 1;
    return grid.anchor + k * unit;
  }

  /**
   * Restart the bar grid so that bar 1 begins at M.now() + (tPhaseStart − T) (§4.4 rule 5). The first new
   * eighth is the grid point after the last one already scheduled, so nothing is emitted twice; bar numbers
   * keep increasing.
   */
  function reanchor(tPhaseStart, T, B, meter) {
    const tNow = mtNow();
    const anchor = tNow + (tPhaseStart - T);
    let jn;
    if (lastWhen > -Infinity) jn = Math.floor((lastWhen - anchor) / EIGHTH + 0.5) + 1;
    else jn = Math.ceil((tNow - anchor) / EIGHTH);
    const jMin = Math.ceil((tNow - STALE - anchor) / EIGHTH);
    if (jn < jMin) jn = jMin;
    const inBar = mod(jn, B);
    const barOfJn = inBar === 0 ? lastBar + 1 : Math.max(lastBar, 0);
    grid.anchor = anchor;
    grid.B = B;
    grid.meter = meter;
    grid.anchorBar = barOfJn - floorDiv(jn, B);
    nextJ = jn;
    anchorGen++;
    stats.reanchors++;
  }

  // ------------------------------------------------------------------------------------------
  // allow(): per-key 60 ms guard and a voice-start budget per second. Visual clock: monotonic, no jump.
  // ------------------------------------------------------------------------------------------
  const lastByKey = new Map();
  const starts = new Float64Array(16).fill(-1e9);
  let startsHead = 0;
  function allow(key) {
    const t = state.time;
    const last = lastByKey.get(key);
    if (last !== undefined && t - last < ALLOW_SAME_KEY) {
      stats.denied++;
      return false;
    }
    let n = 0;
    for (let i = 0; i < starts.length; i++) if (t - starts[i] < 1) n++;
    if (n >= voiceLimit) {
      stats.denied++;
      return false;
    }
    starts[startsHead] = t;
    startsHead = (startsHead + 1) % starts.length;
    lastByKey.set(key, t);
    stats.allowed++;
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // Energy layers, phase, harmony
  // ------------------------------------------------------------------------------------------
  let phase = 'idle';
  let cycle = 0;
  let energyLayer = stepLayer(state.energy, 0);
  const layersActive = () => phase === 'idle' || phase === 'fade';
  const harmonyLayer = () => (layersActive() ? energyLayer : 0);
  // The layer is latched per bar so the harmony (and pad) only change on bar lines.
  let latchBar = -1;
  let latchLayer = harmonyLayer();
  let prevLatchLayer = latchLayer;

  function chord() {
    if (!layersActive()) return DM.slice();
    const b = barAt(mtNow());
    const L = b >= latchBar ? latchLayer : prevLatchLayer;
    return chordFor(b, L).slice();
  }

  // ------------------------------------------------------------------------------------------
  // Voices (reused option objects: core voices destructure them immediately)
  // ------------------------------------------------------------------------------------------
  const oPluck = { when: 0, gain: 0.1, pan: 0, bright: 0.5, decay: 2.5, bus: 'music' };
  const oBell = { when: 0, gain: 0.1, pan: 0, decay: 4, bus: 'music' };
  const oDrum = { when: 0, gain: 0.3, pitch: 70, bus: 'music' };
  const oWhoosh = { when: 0, gain: 0.1, dur: 1, from: 400, to: 2400, pan: 0, bus: 'music' };

  const logKind = new Uint8Array(LOG_SIZE);
  const logFreq = new Float32Array(LOG_SIZE);
  const logWhen = new Float64Array(LOG_SIZE);
  const logGain = new Float32Array(LOG_SIZE);
  const logLive = new Uint8Array(LOG_SIZE);
  let logHead = 0;
  let logCount = 0;
  function logVoice(kind, freq, when, gain, isLive) {
    logKind[logHead] = kind;
    logFreq[logHead] = freq;
    logWhen[logHead] = when;
    logGain[logHead] = gain;
    logLive[logHead] = isLive ? 1 : 0;
    logHead = (logHead + 1) % LOG_SIZE;
    if (logCount < LOG_SIZE) logCount++;
  }

  const live = () => mode === 'audio' && A.ready && A.enabled;

  function pluck(freq, when, gain, pan, bright, decay, bus = 'music') {
    const ok = live();
    logVoice(K_PLUCK, freq, when, gain, ok);
    if (!ok) return void stats.silent++;
    oPluck.when = when;
    oPluck.gain = Math.min(gain, 0.3);
    oPluck.pan = pan;
    oPluck.bright = bright;
    oPluck.decay = decay;
    oPluck.bus = bus;
    A.pluck(freq, oPluck);
    stats.pluck++;
  }
  function bell(freq, when, gain, pan, decay, bus = 'music') {
    const ok = live();
    logVoice(K_BELL, freq, when, gain, ok);
    if (!ok) return void stats.silent++;
    oBell.when = when;
    oBell.gain = Math.min(gain, 0.14);
    oBell.pan = pan;
    oBell.decay = decay;
    oBell.bus = bus;
    A.bell(freq, oBell);
    stats.bell++;
  }
  function drum(pitch, gain, when) {
    const ok = live();
    logVoice(K_DRUM, pitch, when, gain, ok);
    if (!ok) return void stats.silent++;
    oDrum.when = when;
    oDrum.gain = Math.min(gain, 0.4);
    oDrum.pitch = pitch;
    A.drum(oDrum);
    stats.drum++;
  }
  function whoosh(from, to, dur, gain, when, pan, bus) {
    const ok = live();
    logVoice(K_WHOOSH, from, when, gain, ok);
    if (!ok) return void stats.silent++;
    oWhoosh.when = when;
    oWhoosh.from = from;
    oWhoosh.to = to;
    oWhoosh.dur = dur;
    oWhoosh.gain = Math.min(gain, 0.15);
    oWhoosh.pan = pan;
    oWhoosh.bus = bus;
    A.whoosh(oWhoosh);
    stats.whoosh++;
  }

  // ------------------------------------------------------------------------------------------
  // Score queue: preallocated slots of { time (M domain), kind, params }. Dispatched by the lookahead.
  // ------------------------------------------------------------------------------------------
  const qT = new Float64Array(QUEUE_SIZE);
  const qKind = new Uint8Array(QUEUE_SIZE);
  const qP0 = new Float32Array(QUEUE_SIZE); // freq | from | pitch
  const qP1 = new Float32Array(QUEUE_SIZE); // gain
  const qP2 = new Float32Array(QUEUE_SIZE); // pan
  const qP3 = new Float32Array(QUEUE_SIZE); // bright | to
  const qP4 = new Float32Array(QUEUE_SIZE); // decay | dur
  let qCount = 0;

  function queuePush(t, kind, p0, p1, p2, p3, p4) {
    for (let i = 0; i < QUEUE_SIZE; i++) {
      if (qKind[i] !== 0) continue;
      qT[i] = t;
      qKind[i] = kind;
      qP0[i] = p0;
      qP1[i] = p1;
      qP2[i] = p2;
      qP3[i] = p3;
      qP4[i] = p4;
      qCount++;
      return true;
    }
    return false;
  }
  function queueClear() {
    qKind.fill(0);
    qCount = 0;
  }
  function queueShift(off) {
    if (!qCount) return;
    for (let i = 0; i < QUEUE_SIZE; i++) if (qKind[i] !== 0) qT[i] += off;
  }
  function queueDispatch(tNow) {
    if (!qCount) return;
    const horizon = tNow + LOOKAHEAD;
    for (let i = 0; i < QUEUE_SIZE; i++) {
      const k = qKind[i];
      if (k === 0 || qT[i] >= horizon) continue;
      qKind[i] = 0;
      qCount--;
      const t = qT[i];
      if (t < tNow - STALE) continue; // passed while stalled: skip, never pile up late notes
      if (k === K_PLUCK) pluck(qP0[i], t, qP1[i], qP2[i], qP3[i], qP4[i]);
      else if (k === K_BELL) bell(qP0[i], t, qP1[i], qP2[i], qP4[i]);
      else if (k === K_WHOOSH) whoosh(qP0[i], qP3[i], qP4[i], qP1[i], t, qP2[i], 'music');
      else if (k === K_DRUM) drum(qP0[i], qP1[i], t);
    }
  }

  /** M time for a score note at climax time Tnote, given the phase event's T; −1 when it has passed. */
  function scoreTime(Tnote, Tevent, tNow) {
    if (Tnote < Tevent - JOIN_TOL) return -1;
    return tNow + Math.max(0, Tnote - Tevent);
  }

  // ------------------------------------------------------------------------------------------
  // Note memory, echoes
  // ------------------------------------------------------------------------------------------
  const memory = createMemory(32);
  const tmpDeg = new Int16Array(16);
  const tmpOct = new Int8Array(16);
  const tmpStep = [0, 0, 0];

  let echoPan = 0.25;
  const echoActive = () => state.veil > 0.5 || phase === 'afterglow';

  // music:echo payload (preallocated; consumers must not keep it, §5)
  const echoNotes = Array.from({ length: 8 }, () => ({ degree: 0, octave: 0, when: 0 }));
  const echoViews = Array.from({ length: 9 }, (_, n) => echoNotes.slice(0, n));
  const echoPayload = { notes: echoViews[0] };
  let idleEchoArmed = true;

  function idleEcho() {
    const n = memory.last(8, tmpDeg, tmpOct);
    const start = nextInternal('beat');
    for (let i = 0; i < n; i++) {
      const when = start + i * 2 * EIGHTH; // half tempo
      const o = tmpOct[i] - 1; // an octave lower
      const e = echoNotes[i];
      e.degree = tmpDeg[i];
      e.octave = o;
      e.when = when + extOff();
      bell(note(tmpDeg[i], o), when, 0.07, (i % 2 ? 0.2 : -0.2), 4);
    }
    echoPayload.notes = echoViews[n];
    stats.idleEchoes++;
    events.emit('music:echo', echoPayload);
  }

  // ------------------------------------------------------------------------------------------
  // The eighth-note scheduler
  // ------------------------------------------------------------------------------------------
  const beatPayload = { index: 0, bar: 0, beatInBar: 0, meter: '6/8', when: 0, delay: 0 };

  // ornament turn for the current bar pair
  const orn = { d: [0, 0, 0], o: [0, 0, 0], pan: 0 };
  // afterglow harp air
  let airIdx = 2;
  let nextAirBar = 0;

  function scheduleEighth(j, when, tNow) {
    const B = grid.B;
    const inBar = mod(j, B);
    const bar = grid.anchorBar + floorDiv(j, B);

    if (inBar === 0) {
      prevLatchLayer = latchLayer;
      latchLayer = harmonyLayer();
      latchBar = bar;
      stats.bars++;
    }
    const L = latchLayer;
    lastWhen = when;
    lastBar = bar;

    if (inBar % 3 === 0) {
      // §5.1 requires delay === when − M.now() ∈ [0, 0.12]. An eighth the frame loop reached late keeps
      // its place in the grid, but its payload time is pulled up to now so the identity holds and a
      // consumer scheduling a voice at `when` gets "immediately" rather than a time in the past.
      const wBeat = when < tNow ? tNow : when;
      beatPayload.index = beatIndex++;
      beatPayload.bar = bar;
      beatPayload.beatInBar = inBar;
      beatPayload.meter = grid.meter;
      beatPayload.when = wBeat + extOff();
      beatPayload.delay = clamp(wBeat - tNow, 0, LOOKAHEAD);
      stats.beats++;
      const gen = anchorGen;
      events.emit('music:beat', beatPayload);
      if (gen !== anchorGen) return; // a handler re-anchored the grid synchronously: this eighth belongs to the old one
    }

    // An eighth the frame loop reached late still emits its beat (above), but its voices are dropped:
    // a note behind the beat is worse than no note. The pad is a sustained crossfade, not a hit, so it
    // keeps following the bar grid — only its automation time is pulled up to now.
    const late = when < tNow - STALE;
    const wPad = late ? tNow : when;

    if (layersActive()) {
      // Heartbeat (bodhrán), E ≥ 0.3; ghost on eighth 5 from E ≥ 0.5 (§8.3)
      if (L >= 1 && !late) {
        if (inBar === 0) drum(62, 0.28, when);
        else if (inBar === 3) drum(70, 0.14, when);
        else if (inBar === 5 && L >= 2) drum(70, 0.08, when);
      }
      // Pad, E ≥ 0.5, crossfades on bar lines
      if (inBar === 0 && graph && live()) graph.padBar(chordFor(bar, L), wPad, L >= 2);
      // Ornaments, E ≥ 0.7: every 2 bars a 3-note PENTA turn at octave 1 (eighths 3–5 of the 2nd bar)
      if (!late && withPad && L >= 3 && mod(bar, 2) === 1 && inBar >= 3 && inBar <= 5) {
        if (inBar === 3) {
          const idxs = CHORD_PENTA_IDX.get(chordFor(bar, L)) || CHORD_PENTA_IDX.get(DM);
          const base = idxs[Math.floor(rng() * idxs.length) % idxs.length];
          const dir = rng() < 0.5 ? 1 : -1;
          orn.d[0] = PENTA[base];
          orn.o[0] = 1;
          pentaStep(base, 1, dir, tmpStep);
          orn.d[1] = tmpStep[0];
          orn.o[1] = tmpStep[1];
          orn.d[2] = PENTA[base];
          orn.o[2] = 1;
          orn.pan = (rng() - 0.5) * 0.7;
        }
        const k = inBar - 3;
        pluck(note(orn.d[k], orn.o[k]), when, 0.1, orn.pan, 0.55, 2.4);
      }
    }

    // river: slip-jig drum on eighths 1, 4, 7 (gain 0.3), ghosts on 3, 6, 9 (gain 0.1)
    if (!late && phase === 'river' && B === 9) {
      if (inBar % 3 === 0) drum(inBar === 0 ? 62 : 68, 0.3, when);
      else if (inBar % 3 === 2) drum(74, 0.1, when);
    }

    // afterglow: slow harp air — one pluck from a random walk on PENTA, octave 1, every 1–2 bars
    if (!late && phase === 'afterglow' && inBar === 0 && bar >= nextAirBar) {
      const r = rng();
      // random walk: a step down or up (reflecting at the ends), sometimes a repeated note
      const step = r < 0.42 ? -1 : r < 0.84 ? 1 : 0;
      airIdx = airIdx + step < 0 || airIdx + step > 4 ? airIdx - step : airIdx + step;
      pluck(note(PENTA[airIdx], 1), when, 0.12, (rng() - 0.5) * 0.6, 0.45, 4.5);
      nextAirBar = bar + (rng() < 0.5 ? 1 : 2);
    }
  }

  function pump(tNow) {
    const horizon = tNow + LOOKAHEAD;
    const barSec = barLen();
    let when = grid.anchor + nextJ * EIGHTH;
    // A frame gap longer than LOOKAHEAD + STALE must not swallow eighths: every eighth is still
    // emitted, in grid order, and only its *voices* are suppressed when it is already late (see
    // scheduleEighth). Dropping them instead would lose whole downbeats, and `bealach` arms the
    // climax on a music:beat with beatInBar === 0 (§7.3). Headless SwiftShader frames are ~0.2–1.8 s
    // of audio time, so this is the difference between a beat stream and one beat per bar.
    // Only a backlog of more than CATCHUP_BARS bars is given up, and then in whole bars, so the
    // bar/beat phase of the grid is preserved exactly.
    const maxBehind = CATCHUP_BARS * barSec;
    if (when < tNow - maxBehind) {
      nextJ += (Math.floor((tNow - maxBehind - when) / barSec) + 1) * grid.B;
      when = grid.anchor + nextJ * EIGHTH;
    }
    for (let guard = 0; guard < MAX_EIGHTHS_PER_FRAME && when < horizon; guard++) {
      const j = nextJ;
      nextJ = j + 1; // advance first: a music:beat handler may re-anchor the grid synchronously
      scheduleEighth(j, when, tNow);
      when = grid.anchor + nextJ * EIGHTH;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Continuous graph: built on audio start
  // ------------------------------------------------------------------------------------------

  function buildGraph() {
    if (graph || disposed || !A.ready || !A.ctx) return;
    try {
      const ac = A.ctx;
      const t = ac.currentTime;
      A.bus('ambience').gain.setValueAtTime(0.7, t);
      A.bus('music').gain.setValueAtTime(0.8, t);
      A.bus('sfx').gain.setValueAtTime(1.0, t);
      graph = createGraph(ac, { ambience: A.bus('ambience'), music: A.bus('music') }, { note, withPad, rng });
      builtAt = t;
      updateLevels(1.0); // wind, water and drone fade in over ≈ 4 s (§7.1)
    } catch (err) {
      console.error('[conductor] audio graph failed', err);
      graph = null;
    }
  }

  /** Continuous levels from phase, veil, hold and the sound toggle. Only touches params on change. */
  function updateLevels(tau) {
    if (!graph || disposed) return;
    const t = A.now();
    const en = A.enabled ? 1 : 0;
    const hushing = phase === 'hush';
    const hold = veilHold && !hushing ? 1 : 0;
    const V = clamp(state.veil, 0, 1);
    graph.setDrone(LEVELS.droneOsc * (hushing ? 0 : 1) * (1 + 0.35 * hold) * en, t, tau);
    // Drone lowpass 350 → 1400 Hz with V (§4.3), exponential in V so it opens evenly to the ear; a veil hold
    // opens it a little further within the same range.
    graph.setDroneCutoff(Math.min(1400, 350 * Math.pow(4, V) * (1 + 0.35 * hold)), t, 0.12);
    graph.setWind(LEVELS.wind * (hushing ? 0.3 : 1) * (1 + 0.8 * hold) * en, t, tau);
    graph.setWindCentre(LEVELS.windCentre * (1 + 0.5 * hold), t, tau);
    graph.setHush(hushing && en ? LEVELS.hushSine : 0, t, hushing ? 0.15 : 0.4);
    if ((!en || !layersActive()) && graph.padTarget > 0) graph.padOff(t, en ? 0.15 : 0.05);
  }

  function fireRate() {
    const lvl = uniforms.uFireLevel ? uniforms.uFireLevel.value : 0;
    return 2 + 8 * clamp(Number.isFinite(lvl) ? lvl : 0, 0, 1.5);
  }

  function continuous(tNow) {
    if (!graph || mode !== 'audio' || !A.enabled) return;
    const horizon = tNow + LOOKAHEAD;
    const fadeIn = clamp((tNow - builtAt) / 4, 0, 1);

    // Crackle: Poisson bursts at 2 + 8·uFireLevel per second, merged with fire:surge bursts.
    if (nextCrackle < tNow - STALE) nextCrackle = tNow + -Math.log(1 - rng()) / fireRate();
    for (let guard = 0; guard < 48; guard++) {
      const s = surgeCount ? surge[surgeHead] : Infinity;
      let tb = nextCrackle < s ? nextCrackle : s;
      if (tb >= horizon) break;
      if (s <= nextCrackle) {
        surgeHead = (surgeHead + 1) % surge.length;
        surgeCount--;
      } else {
        nextCrackle += -Math.log(1 - rng()) / fireRate();
      }
      if (tb < tNow - STALE) continue;
      if (tb < crackleFree) tb = crackleFree;
      const dur = 0.005 + rng() * 0.015;
      graph.crackle(tb, dur, (LEVELS.crackleMin + rng() * (LEVELS.crackleMax - LEVELS.crackleMin)) * fadeIn);
      crackleFree = tb + dur + 0.002;
      stats.crackles++;
    }

    // Water laps every 1.5–4 s.
    if (nextLap < tNow - STALE) nextLap = tNow + 0.2;
    for (let guard = 0; guard < 4 && nextLap < horizon; guard++) {
      graph.lap(nextLap, LEVELS.waterLap * (0.7 + 0.3 * rng()) * fadeIn);
      nextLap += 1.5 + 2.5 * rng();
      stats.laps++;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Climax score scheduling on bealach:phase
  // ------------------------------------------------------------------------------------------
  function scheduleReturnChord(T, tNow) {
    for (const c of RETURN_CHORD) {
      const t = scoreTime(c.T, T, tNow);
      if (t < 0) continue;
      if (c.kind === 'pluck') queuePush(t, K_PLUCK, note(c.d, c.o), c.gain, c.pan, 0.5, 5);
      else queuePush(t, K_BELL, note(c.d, c.o), c.gain, c.pan, 0, 8);
    }
  }

  function schedulePhase(p, prev, T, tNow) {
    switch (p) {
      case 'pillar': {
        const t = scoreTime(3, T, tNow);
        if (t >= 0) queuePush(t, K_WHOOSH, 200, 0.12, 0, 1200, 5);
        break;
      }
      case 'pour': {
        for (const g of GLISSANDO) {
          const t = scoreTime(g.T, T, tNow);
          if (t >= 0) queuePush(t, K_PLUCK, note(g.d, g.o), 0.16, g.pan, 0.7, 3);
        }
        break;
      }
      case 'river': {
        // From T = 16.3: the last 16 remembered notes on eighths (grid eighths 1..16 of the 9/8 anchor),
        // harmonised in thirds, padded with the motif.
        const n = memory.last(16, tmpDeg, tmpOct);
        for (let i = 0; i < 16; i++) {
          let d;
          let o;
          if (i < n) {
            d = tmpDeg[i];
            o = tmpOct[i];
          } else {
            d = MOTIF[(i - n) % MOTIF.length];
            o = 0; // motif sounds at octave 1 = o + 1
          }
          const Tn = PHASE_START.river + (i + 1) * EIGHTH;
          const t = scoreTime(Tn, T, tNow);
          if (t < 0) continue;
          const oo = clamp(o + 1, -1, 3);
          const pan = i % 2 ? 0.22 : -0.22;
          queuePush(t, K_BELL, note(d, oo), 0.07, pan, 0, 3.2);
          queuePush(t, K_BELL, note(d + 2, oo), 0.07, -pan, 0, 3.2);
        }
        break;
      }
      case 'return': {
        for (const b of BELL_RUN) {
          const t = scoreTime(b.T, T, tNow);
          if (t >= 0) queuePush(t, K_BELL, note(b.d, b.o), 0.09, b.pan, 0, 4);
        }
        scheduleReturnChord(T, tNow);
        break;
      }
      case 'afterglow':
        // The T = 32 chord belongs to the return row; it was queued by the return event. Joining the climax
        // directly at afterglow (?phaseT=32) still sounds it when the event lands on T = 32.
        if (prev !== 'return') scheduleReturnChord(T, tNow);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------------------------------
  const offs = [];

  offs.push(
    events.on('note:played', (p) => {
      if (!p) return;
      memory.add(p, state.time);
      if (disposed || !echoActive()) return;
      if (typeof p.degree !== 'number' || !Number.isFinite(p.degree)) return;
      // Echo a fifth lower (degree − 4), one eighth later, ×0.5 gain (§8.3, §7.3 afterglow). Echoes apply to
      // every note with a degree, the aos sí's and bealach's included (§5.1).
      const tNow = mtNow();
      let w = typeof p.when === 'number' && Number.isFinite(p.when) ? p.when - extOff() : tNow;
      if (w < tNow || w > tNow + 4) w = tNow;
      const o = Number.isFinite(p.octave) ? p.octave : 0;
      // DESIGN-QUESTION: note:played carries no gain, so "×0.5" is taken from an optional `p.gain` when a
      // sibling provides one, else from the typical interaction gain of that voice (pluck 0.2, bell 0.09).
      // A drum that carries a degree is echoed as a pluck (a drum pitch is timbre, not a note).
      const isBell = p.voice === 'bell';
      const src = typeof p.gain === 'number' && Number.isFinite(p.gain) ? p.gain : isBell ? ECHO_BELL : ECHO_PLUCK;
      const g = 0.5 * src;
      echoPan = -echoPan;
      if (isBell) bell(note(p.degree - 4, o), w + EIGHTH, g, echoPan, 3.5);
      else pluck(note(p.degree - 4, o), w + EIGHTH, g, echoPan, 0.45, 2.8);
      stats.echoes++;
    }),
  );

  offs.push(
    events.on('fire:surge', () => {
      if (!graph || mode !== 'audio' || !A.enabled) return;
      // 12 extra crackle bursts over 0.5 s, merged in time order into the surge queue.
      const tNow = A.now();
      for (let i = 0; i < 12 && surgeCount < surge.length; i++) {
        const t = tNow + 0.02 + (i + rng() * 0.8) * (0.5 / 12);
        // insertion into the ring (kept sorted)
        let pos = surgeCount;
        while (pos > 0 && surge[(surgeHead + pos - 1) % surge.length] > t) {
          surge[(surgeHead + pos) % surge.length] = surge[(surgeHead + pos - 1) % surge.length];
          pos--;
        }
        surge[(surgeHead + pos) % surge.length] = t;
        surgeCount++;
      }
    }),
  );

  offs.push(
    events.on('veil:hold', (p) => {
      const active = !!(p && p.active);
      if (active === veilHold) return; // bealach emits one event per edge; never double-swell
      veilHold = active;
      // §6.2: the veil hold's own voice. Ambience bus, so it sits under the drone swell rather than
      // in front of the viewer's taps.
      const t = mtNow();
      if (active) whoosh(200, 1600, 2.5, 0.1, t, 0, 'ambience');
      else whoosh(1600, 300, 1.5, 0.06, t, 0, 'ambience');
      updateLevels(veilHold ? 0.8 : 0.5); // swell over ≈ 2.5 s, release over ≈ 1.5 s
    }),
  );

  offs.push(
    events.on('deiseal:turn', (p) => {
      if (!p || p.dir !== -1) return;
      // Anti-sunwise: cold wind swell, two detuned whooshes 40 ms apart (§6.2).
      const t = mtNow();
      whoosh(900, 300, 3, 0.06, t, -0.3, 'ambience');
      whoosh(900 * 1.035, 300 * 1.035, 3, 0.06, t + 0.04, 0.3, 'ambience');
    }),
  );

  offs.push(
    events.on('bealach:phase', (p) => {
      if (!p || typeof p.phase !== 'string' || !(p.phase in PHASE_START)) return;
      if (p.phase === phase && phase !== 'idle') return; // a transition is emitted once; never schedule a phase twice
      const prev = phase;
      phase = p.phase;
      if (Number.isFinite(p.cycle)) cycle = p.cycle;
      const T = Number.isFinite(p.T) ? p.T : (PHASE_START[phase] ?? 0);
      switch (phase) {
        case 'idle':
          queueClear();
          break;
        case 'hush':
          queueClear();
          reanchor(PHASE_START.hush, T, 6, '6/8');
          break;
        case 'pillar':
          if (prev !== 'hush') reanchor(PHASE_START.hush, T, 6, '6/8');
          break;
        case 'pour':
          if (prev !== 'hush' && prev !== 'pillar') reanchor(PHASE_START.hush, T, 6, '6/8');
          break;
        case 'river':
          reanchor(PHASE_START.river, T, 9, '9/8');
          break;
        case 'return':
          if (prev !== 'river') reanchor(PHASE_START.river, T, 9, '9/8');
          break;
        case 'afterglow':
          reanchor(PHASE_START.afterglow, T, 6, '6/8');
          nextAirBar = barAt(mtNow()) + 1;
          break;
        case 'fade':
          if (prev !== 'afterglow') reanchor(PHASE_START.afterglow, T, 6, '6/8');
          break;
        default:
          break;
      }
      const tNow = mtNow();
      schedulePhase(phase, prev, T, tNow);
      queueDispatch(tNow); // a note due now (the phase's first note) must not wait for the next frame
      if (phase === 'hush' && graph) graph.padOff(A.now(), 0.15); // all layers fade out over 0.5 s
      updateLevels(phase === 'hush' ? 0.15 : 0.8);
    }),
  );

  offs.push(
    events.on('audio:toggled', (p) => {
      if (!graph) return;
      const on = !!(p && p.on);
      if (!on) graph.silenceEnvelopes(A.now());
      updateLevels(on ? 0.3 : 0.05);
    }),
  );

  offs.push(events.on('audio:started', buildGraph));
  A.onStart(buildGraph);

  // ------------------------------------------------------------------------------------------
  // world.music
  // ------------------------------------------------------------------------------------------
  function debug() {
    const tNow = mtNow();
    const log = [];
    for (let i = logCount; i >= 1; i--) {
      const k = (logHead - i + LOG_SIZE) % LOG_SIZE;
      log.push({
        kind: KIND_NAME[logKind[k]],
        f: +logFreq[k].toFixed(2),
        when: +logWhen[k].toFixed(3),
        gain: +logGain[k].toFixed(3),
        live: !!logLive[k],
      });
    }
    const pending = [];
    for (let i = 0; i < QUEUE_SIZE; i++) {
      if (qKind[i] === 0) continue;
      pending.push({ kind: KIND_NAME[qKind[i]], in: +(qT[i] - tNow).toFixed(3), f: +qP0[i].toFixed(2), gain: +qP1[i].toFixed(3) });
    }
    pending.sort((a, b) => a.in - b.in);
    return {
      clock: mode,
      clockOffset,
      pending,
      now: now(),
      mt: tNow,
      extOff: extOff(),
      stateTime: state.time,
      meter: grid.meter,
      bar: barAt(tNow),
      grid: { ...grid },
      nextEighth: grid.anchor + nextJ * EIGHTH,
      beatIndex,
      phase,
      cycle,
      energyLayer,
      harmonyLayer: harmonyLayer(),
      latch: { bar: latchBar, layer: latchLayer, prev: prevLatchLayer },
      veilHold,
      echoActive: echoActive(),
      queue: qCount,
      memory: memory.snapshot(),
      stats: { ...stats },
      graph: graph ? { nodes: graph.nodeCount, padChord: [...graph.padChord], levels: graph.levels() } : null,
      log,
    };
  }

  const music = {
    now,
    get meter() {
      return grid.meter;
    },
    eighth: EIGHTH,
    next,
    chord,
    PENTA,
    allow,
    debug,
  };
  world.music = music;

  // ------------------------------------------------------------------------------------------
  return {
    update() {
      watchdog();
      const tNow = mtNow();
      energyLayer = stepLayer(state.energy, energyLayer);
      pump(tNow);
      queueDispatch(tNow);
      continuous(tNow);

      // Idle echo: idle > 30 s with ≥ 6 remembered notes, once per idle period (§6.2).
      if (state.idleTime < 30) idleEchoArmed = true;
      else if (idleEchoArmed && memory.count >= 6 && (phase === 'idle' || phase === 'afterglow' || phase === 'fade')) {
        idleEchoArmed = false;
        idleEcho();
      }

      // Per-frame level follow (veil, phase). Only while the audio clock runs: automation events added at a
      // frozen currentTime would pile up in the param timelines; the cached targets catch up on recovery.
      if (graph && mode === 'audio') updateLevels(0.3);
    },

    dispose() {
      disposed = true;
      for (const off of offs) off();
      offs.length = 0;
      if (graph) {
        try {
          graph.dispose();
        } catch {
          /* context already closed */
        }
        graph = null;
      }
      queueClear();
      if (world.music === music) delete world.music;
    },
  };
}
