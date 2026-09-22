// conductor/graph.js — every long-lived audio graph of the piece (§8.3): drone, wind, water, crackle, pad,
// plus the hush sine of the climax. Node-pooled: oscillators and noise loops are created once, levels move
// with setTargetAtTime. Takes any BaseAudioContext so it can also be rendered offline for level checks.
//
// Live node budget (§10.1: ≤ 40 at idle, ≤ 60 in the climax):
//   drone  4 saw + lowpass + amp + LFO osc + LFO depth         = 8
//   wind   noise + bandpass + amp + LFO osc + LFO depth        = 5
//   water  noise + lowpass + lap amp                           = 3
//   crackle highpass + burst amp (shares the water noise)      = 2
//   pad    2 × (9 triangle + set gain) + lowpass + amp (high)  = 22
//   hush sine osc + gain (only during hush and its release)    = 2
//   → 40 at idle (18 on low quality), 42 in hush.

import { DM } from './score.js';

/** Level constants. Ceilings (§8.1): drone osc ≤ 0.035 each, pad osc ≤ 0.02 each. */
export const LEVELS = Object.freeze({
  droneOsc: 0.011, // per sawtooth; ×(1 + 0.35) under a veil hold stays below the 0.035 ceiling
  droneLfoDepth: 0.2, // 0.07 Hz amplitude LFO, 20 %
  wind: 0.03,
  windCentre: 600, // bandpass centre; LFO ±300 → 300–900 Hz
  windLfoDepth: 300,
  waterLap: 0.02,
  waterCutoff: 700,
  crackleCutoff: 1500,
  crackleMin: 0.02,
  crackleMax: 0.05,
  padOsc: 0.009, // per triangle (9 sounding) — ≤ 0.02 ceiling
  padCutoff: 900,
  hushSine: 0.05,
});

// Web Audio lowpass/highpass Q is a resonance in dB. A conventional Q of 0.7 is 20·log10(0.7) ≈ −3.1 dB.
const Q_07_DB = 20 * Math.log10(0.7);

function makeNoise(ac, seconds, channels, rng) {
  const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(channels, len, ac.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  }
  return buf;
}

/** A cached AudioParam target so per-frame calls only touch the param when the target really changes. */
function level(param, initial) {
  return { param, target: initial };
}
function aim(lv, value, t, tau, rel = 0) {
  const eps = rel > 0 ? Math.abs(value) * rel + 1e-4 : 1e-6;
  if (Math.abs(value - lv.target) <= eps) return false;
  lv.target = value;
  lv.param.setTargetAtTime(value, t, tau);
  return true;
}

/**
 * @param {BaseAudioContext} ac
 * @param {{ ambience: AudioNode, music: AudioNode }} buses
 * @param {{ note:(d:number,o:number)=>number, withPad:boolean, rng:()=>number }} opts
 */
export function createGraph(ac, buses, { note, withPad, rng }) {
  const t0 = ac.currentTime;
  const all = []; // every persistent node (dispose)
  const sources = []; // scheduled sources to stop
  let dynamicNodes = 0;
  const mk = (n) => {
    all.push(n);
    return n;
  };
  const src = (n) => {
    sources.push(n);
    return mk(n);
  };

  const rand = typeof rng === 'function' ? rng : Math.random;

  // ---- noise loops (two different lengths so no common period is audible) ----
  const windNoise = makeNoise(ac, 5.3, 2, rand); // stereo, decorrelated: wide wind
  const waterNoise = makeNoise(ac, 3.7, 1, rand); // mono: water and the fire sit in front

  // ---- drone: D2 + A2, two saws each detuned ±4 cents, lowpass 350→1400 Hz with V, 0.07 Hz amp LFO ----
  const droneLP = mk(ac.createBiquadFilter());
  droneLP.type = 'lowpass';
  droneLP.frequency.value = 350;
  droneLP.Q.value = Q_07_DB;
  const droneAmp = mk(ac.createGain());
  droneAmp.gain.value = 0;
  droneLP.connect(droneAmp);
  droneAmp.connect(buses.ambience);
  const dronePitches = [note(0, -1), note(4, -1)]; // D2 73.42 Hz, A2 110 Hz
  for (let p = 0; p < 2; p++) {
    for (const cents of [-4, 4]) {
      const o = src(ac.createOscillator());
      o.type = 'sawtooth';
      o.frequency.value = dronePitches[p];
      o.detune.value = cents;
      o.connect(droneLP);
    }
  }
  const droneLfo = src(ac.createOscillator());
  droneLfo.type = 'sine';
  droneLfo.frequency.value = 0.07;
  const droneLfoDepth = mk(ac.createGain());
  droneLfoDepth.gain.value = 0;
  droneLfo.connect(droneLfoDepth);
  droneLfoDepth.connect(droneAmp.gain); // amp = base + base·0.2·sin

  // ---- wind: looped noise → bandpass (Q 0.6, centre LFO 0.05 Hz over 300–900 Hz) → gain 0.03 ----
  const windSrc = src(ac.createBufferSource());
  windSrc.buffer = windNoise;
  windSrc.loop = true;
  const windBP = mk(ac.createBiquadFilter());
  windBP.type = 'bandpass';
  windBP.Q.value = 0.6;
  windBP.frequency.value = LEVELS.windCentre;
  const windLfo = src(ac.createOscillator());
  windLfo.type = 'sine';
  windLfo.frequency.value = 0.05;
  const windLfoDepth = mk(ac.createGain());
  windLfoDepth.gain.value = LEVELS.windLfoDepth;
  windLfo.connect(windLfoDepth);
  windLfoDepth.connect(windBP.frequency);
  const windAmp = mk(ac.createGain());
  windAmp.gain.value = 0;
  windSrc.connect(windBP);
  windBP.connect(windAmp);
  windAmp.connect(buses.ambience);

  // ---- water: noise → lowpass 700 Hz → lap envelopes ----
  const waterSrc = src(ac.createBufferSource());
  waterSrc.buffer = waterNoise;
  waterSrc.loop = true;
  const waterLP = mk(ac.createBiquadFilter());
  waterLP.type = 'lowpass';
  waterLP.frequency.value = LEVELS.waterCutoff;
  waterLP.Q.value = Q_07_DB;
  const waterAmp = mk(ac.createGain());
  waterAmp.gain.value = 0;
  waterSrc.connect(waterLP);
  waterLP.connect(waterAmp);
  waterAmp.connect(buses.ambience);

  // ---- crackle: the same noise → highpass 1500 Hz → 5–20 ms bursts ----
  const crackHP = mk(ac.createBiquadFilter());
  crackHP.type = 'highpass';
  crackHP.frequency.value = LEVELS.crackleCutoff;
  crackHP.Q.value = Q_07_DB;
  const crackAmp = mk(ac.createGain());
  crackAmp.gain.value = 0;
  waterSrc.connect(crackHP);
  crackHP.connect(crackAmp);
  crackAmp.connect(buses.ambience);

  // ---- pad (high quality only): two 9-triangle sets crossfaded at bar lines, lowpass 900 Hz ----
  let padAmp = null;
  const padSets = [];
  let padActive = 0;
  let padChord = DM;
  if (withPad) {
    const padLP = mk(ac.createBiquadFilter());
    padLP.type = 'lowpass';
    padLP.frequency.value = LEVELS.padCutoff;
    padLP.Q.value = Q_07_DB;
    padAmp = mk(ac.createGain());
    padAmp.gain.value = 0;
    padLP.connect(padAmp);
    padAmp.connect(buses.music);
    for (let s = 0; s < 2; s++) {
      const g = mk(ac.createGain());
      g.gain.value = s === 0 ? 1 : 0;
      g.connect(padLP);
      const oscs = [];
      for (let tone = 0; tone < 3; tone++) {
        for (const cents of [-7, 0, 7]) {
          const o = src(ac.createOscillator());
          o.type = 'triangle';
          o.frequency.value = note(DM[tone], 0);
          o.detune.value = cents;
          o.connect(g);
          oscs.push(o);
        }
      }
      padSets.push({ g, oscs });
    }
  }

  // Start every pooled source once, with random offsets into the noise loops.
  for (const s of sources) {
    if (s instanceof AudioBufferSourceNode) s.start(t0, rand() * s.buffer.duration);
    else s.start(t0);
  }

  // ---- cached level targets ----
  const lvDrone = level(droneAmp.gain, 0);
  const lvDroneLfo = level(droneLfoDepth.gain, 0);
  const lvDroneCut = level(droneLP.frequency, 350);
  const lvWind = level(windAmp.gain, 0);
  const lvWindCentre = level(windBP.frequency, LEVELS.windCentre);
  const lvPad = padAmp ? level(padAmp.gain, 0) : null;

  // ---- hush sine (created on demand) ----
  let hush = null; // { osc, gain, lv }

  const graph = {
    get nodeCount() {
      return all.length + dynamicNodes;
    },
    get padChord() {
      return padChord;
    },
    get padTarget() {
      return lvPad ? lvPad.target : 0;
    },
    levels() {
      return {
        drone: lvDrone.target,
        droneCutoff: Math.round(lvDroneCut.target),
        wind: lvWind.target,
        windCentre: Math.round(lvWindCentre.target),
        pad: lvPad ? lvPad.target : null,
        hush: hush ? hush.lv.target : 0,
      };
    },

    setDrone(v, t, tau) {
      aim(lvDrone, v, t, tau);
      aim(lvDroneLfo, v * LEVELS.droneLfoDepth, t, tau);
    },
    setDroneCutoff(hz, t, tau) {
      aim(lvDroneCut, hz, t, tau, 0.01);
    },
    setWind(v, t, tau) {
      aim(lvWind, v, t, tau);
    },
    setWindCentre(hz, t, tau) {
      aim(lvWindCentre, hz, t, tau, 0.01);
    },

    /** The single sine D2 of the hush (§7.3), replacing the drone. */
    setHush(v, t, tau) {
      if (v > 0) {
        if (!hush) {
          const osc = ac.createOscillator();
          osc.type = 'sine';
          osc.frequency.value = note(0, -1); // D2 73.42 Hz
          const gain = ac.createGain();
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(buses.ambience);
          osc.start(t);
          dynamicNodes += 2;
          hush = { osc, gain, lv: level(gain.gain, 0) };
        }
        aim(hush.lv, v, t, tau);
      } else if (hush) {
        const h = hush;
        hush = null;
        h.gain.gain.cancelScheduledValues(t);
        h.gain.gain.setTargetAtTime(0, t, tau);
        h.osc.onended = () => {
          h.osc.disconnect();
          h.gain.disconnect();
          dynamicNodes -= 2;
        };
        h.osc.stop(t + tau * 9 + 0.05);
      }
    },

    /** Pad state at a bar line: level on/off and a 0.6 s crossfade when the chord changes. */
    padBar(chord, when, on) {
      if (!lvPad) return;
      if (on && chord && chord !== padChord) {
        const inc = 1 - padActive;
        const a = padSets[padActive];
        const b = padSets[inc];
        for (let tone = 0; tone < 3; tone++) {
          const f = note(chord[tone], 0);
          for (let k = 0; k < 3; k++) b.oscs[tone * 3 + k].frequency.setValueAtTime(f, when);
        }
        b.g.gain.setValueAtTime(0, when);
        b.g.gain.linearRampToValueAtTime(1, when + 0.6);
        a.g.gain.setValueAtTime(1, when);
        a.g.gain.linearRampToValueAtTime(0, when + 0.6);
        padActive = inc;
        padChord = chord;
      }
      aim(lvPad, on ? LEVELS.padOsc : 0, when, on ? 0.6 : 0.25);
    },
    /** Pad off now, cancelling a bar-line "on" that may already sit in the lookahead. */
    padOff(t, tau) {
      if (!lvPad) return;
      lvPad.param.cancelScheduledValues(t);
      lvPad.target = 0;
      lvPad.param.setTargetAtTime(0, t, tau);
    },

    /** One crackle burst: 1.2 ms attack, exponential decay over `dur`. Calls must be in time order. */
    crackle(t, dur, peak) {
      const g = crackAmp.gain;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(peak, t + 0.0012);
      g.setTargetAtTime(0, t + 0.0012, dur / 3);
    },

    /** One water lap: attack 0.3 s, decay 0.8 s. */
    lap(t, peak) {
      const g = waterAmp.gain;
      g.setTargetAtTime(peak, t, 0.1);
      g.setTargetAtTime(0, t + 0.3, 0.8 / 3);
    },

    /** Silence the event-driven envelopes now (sound toggled off). */
    silenceEnvelopes(t) {
      for (const p of [crackAmp.gain, waterAmp.gain]) {
        p.cancelScheduledValues(t);
        p.setTargetAtTime(0, t, 0.03);
      }
    },

    dispose() {
      const t = ac.currentTime;
      for (const s of sources) {
        try {
          s.stop(t);
        } catch {
          /* already stopped */
        }
      }
      if (hush) {
        try {
          hush.osc.stop(t);
        } catch {
          /* already stopped */
        }
        hush.osc.disconnect();
        hush.gain.disconnect();
        hush = null;
      }
      for (const n of all) n.disconnect();
      all.length = 0;
      sources.length = 0;
    },
  };
  return graph;
}
