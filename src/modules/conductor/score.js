// conductor/score.js — pure musical tables and helpers (no Web Audio, no THREE).
// docs/DESIGN.md §4.3 (energy layers), §8.2 (clock & harmony), §7.3 (conductor column of the climax).

/** Dotted quarter = 66 → one eighth note in seconds (§8.2). */
export const EIGHTH = 60 / 66 / 3;

/** Scale degrees of D Dorian used by every interaction melody: D E G A B (§6.1). */
export const PENTA = Object.freeze([0, 1, 3, 4, 5]);

/** Chords as scale degrees (§8.2). Shared frozen arrays: identity comparison is valid. */
export const DM = Object.freeze([0, 2, 4]);
export const C = Object.freeze([-1, 1, 3]); // C3 is degree −1
export const GD = Object.freeze([0, 3, 5]); // G/D

const CYCLE_HALF = [DM, C]; // E 0.5–0.7: Dm (2 bars), C (2 bars)
const CYCLE_FULL = [DM, C, GD, DM]; // E ≥ 0.7: Dm, C, G/D, Dm (2 bars each)

/** PENTA indices of the chord tones that lie in PENTA — the anchors for ornament turns. */
export const CHORD_PENTA_IDX = new Map([
  [DM, Object.freeze([0, 3])], // D, A
  [C, Object.freeze([1, 2])], // E, G
  [GD, Object.freeze([0, 2, 4])], // D, G, B
]);

export const mod = (a, n) => ((a % n) + n) % n;
export const floorDiv = (a, n) => Math.floor(a / n);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Energy layer thresholds (§4.3): ≥0.3 heartbeat, ≥0.5 pad Dm|C (+ ghost drum), ≥0.7 four-chord cycle
 * and ornaments. Hysteresis 0.05 on the way down.
 */
const LAYER_UP = [0.3, 0.5, 0.7];
const LAYER_HYST = 0.05;

export function stepLayer(energy, current) {
  let up = 0;
  for (let i = 0; i < LAYER_UP.length; i++) if (energy >= LAYER_UP[i]) up++;
  if (up > current) return up;
  let down = 0;
  for (let i = 0; i < LAYER_UP.length; i++) if (energy >= LAYER_UP[i] - LAYER_HYST) down++;
  return down < current ? down : current;
}

/** Pure function of the bar index and the (harmony) layer — works on the virtual clock (§10.1). */
export function chordFor(bar, layer) {
  if (layer < 2) return DM;
  const pair = Math.floor(bar / 2);
  if (layer === 2) return CYCLE_HALF[mod(pair, 2)];
  return CYCLE_FULL[mod(pair, 4)];
}

/** Step `steps` PENTA positions from (index, octave); writes into out = [degree, octave, index]. */
export function pentaStep(index, octave, steps, out) {
  let i = index + steps;
  let o = octave;
  while (i > 4) {
    i -= 5;
    o++;
  }
  while (i < 0) {
    i += 5;
    o--;
  }
  out[0] = PENTA[i];
  out[1] = o;
  out[2] = i;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Climax score (§7.3, conductor column). T is the climax clock in seconds.
// ---------------------------------------------------------------------------------------------

/**
 * pour: falling harp glissando T 8 → 14 through PENTA from n(0,3) down to n(0,−1), 0.3 s apart,
 * gain 0.16, bright 0.7, pan −0.4 → 0.4.
 * DESIGN-QUESTION: §7.3 says "20 plucks", but PENTA from n(0,3) to n(0,−1) inclusive is 21 notes and
 * 21 × 0.3 s spacing is exactly T 8.0 → 14.0. We play 21 so the run lands on the low tonic at T = 14.
 */
export const GLISSANDO = Object.freeze(
  (() => {
    const out = [];
    const tmp = [0, 0, 0];
    const N = 21;
    for (let i = 0; i < N; i++) {
      pentaStep(0, 3, -i, tmp);
      out.push(Object.freeze({ T: 8 + 0.3 * i, d: tmp[0], o: tmp[1], pan: -0.4 + (0.8 * i) / (N - 1) }));
    }
    return out;
  })(),
);

/**
 * return: rising bell run from n(0,1) to n(0,3) over T 26–30, 0.4 s apart, gain 0.09.
 * DESIGN-QUESTION: §7.3 says "10 notes", but PENTA n(0,1)…n(0,3) inclusive is 11 notes and 11 × 0.4 s
 * spans exactly T 26.0 → 30.0. We play 11 so the run ends on the tonic D6.
 */
export const BELL_RUN = Object.freeze(
  (() => {
    const out = [];
    const tmp = [0, 0, 0];
    const N = 11;
    for (let i = 0; i < N; i++) {
      pentaStep(0, 1, i, tmp);
      out.push(Object.freeze({ T: 26 + 0.4 * i, d: tmp[0], o: tmp[1], pan: -0.25 + (0.5 * i) / (N - 1) }));
    }
    return out;
  })(),
);

/**
 * return, T = 32: plucks n(0,0), n(4,0), n(0,1) (gain 0.25) and bell n(5,2) (gain 0.06, decay 8), together.
 * Measured offline through the core chain (shots/conductor/t_chord.js): peak −12.8 dBFS before the limiter,
 * ≈ 1 dB momentary reduction — no audible pumping, so the §7.3 gains stand (§8.1).
 */
export const RETURN_CHORD = Object.freeze([
  Object.freeze({ T: 32.0, kind: 'pluck', d: 0, o: 0, gain: 0.25, pan: -0.2 }),
  Object.freeze({ T: 32.0, kind: 'pluck', d: 4, o: 0, gain: 0.25, pan: 0.0 }),
  Object.freeze({ T: 32.0, kind: 'pluck', d: 0, o: 1, gain: 0.25, pan: 0.2 }),
  Object.freeze({ T: 32.0, kind: 'bell', d: 5, o: 2, gain: 0.06, pan: 0.0 }),
]);

/** river: motif that pads a shortfall of remembered notes (§7.3), octave 1. */
export const MOTIF = Object.freeze([0, 1, 3, 4, 5, 4, 3, 1]);

/** Phase start times (T) used for grid re-anchoring (§4.4 rule 5). */
export const PHASE_START = Object.freeze({
  idle: -1,
  hush: 0,
  pillar: 3,
  pour: 8,
  river: 16,
  return: 26,
  afterglow: 32,
  fade: 122,
});
