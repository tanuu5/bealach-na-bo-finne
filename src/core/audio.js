// AudioEngine: lazy Web Audio graph with a stone-hall reverb and a few built-in voices.
// Every public method is a safe no-op until the first user gesture unlocks audio.

const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const ROOT_HZ = 146.832; // D3

export class AudioEngine {
  constructor(events) {
    this.events = events;
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
    this.master = null;
    this.reverb = null;
    this._buses = new Map();
    this._startFns = [];
    this._pluckCache = new Map();
    this._noise = null;
    this.level = 0.8;
    this.scale = [];
    for (let o = 0; o < 4; o++) {
      for (const semi of DORIAN) this.scale.push(ROOT_HZ * Math.pow(2, (semi + 12 * o) / 12));
    }
  }

  /** Hz for a scale degree of D Dorian. degree 0, octave 0 = D3. Degrees wrap into octaves. */
  note(degree, octave = 0) {
    const d = Math.round(degree);
    const oct = Math.floor(d / 7) + octave;
    const idx = ((d % 7) + 7) % 7;
    return ROOT_HZ * Math.pow(2, (DORIAN[idx] + 12 * oct) / 12);
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  onStart(fn) {
    if (this.ready) {
      try {
        fn(this);
      } catch (err) {
        console.error('[audio] onStart handler threw', err);
      }
    } else {
      this._startFns.push(fn);
    }
  }

  /** Called by core on the first user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.enabled) this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.knee.value = 8;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.level : 0;
    this.master.connect(limiter);

    const preDelay = ctx.createDelay(0.2);
    preDelay.delayTime.value = 0.025;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeImpulse(3.6, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    preDelay.connect(this.reverb);
    this.reverb.connect(wet);
    wet.connect(this.master);
    this._reverbIn = preDelay;

    const sends = { music: 0.45, sfx: 0.5, ambience: 0.35 };
    for (const name of Object.keys(sends)) this._makeBus(name, sends[name]);

    if (ctx.state === 'suspended') ctx.resume();
    this.ready = true;

    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend();
      else if (this.enabled) this.ctx.resume();
    });

    const fns = this._startFns.splice(0);
    for (const fn of fns) {
      try {
        fn(this);
      } catch (err) {
        console.error('[audio] onStart handler threw', err);
      }
    }
    this.events?.emit('audio:started', {});
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(this.enabled ? this.level : 0, t, 0.15);
      if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
    }
    this.events?.emit('audio:toggled', { on: this.enabled });
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  /** GainNode for 'music' | 'sfx' | 'ambience' (or any new name). Null before start. */
  bus(name = 'sfx') {
    if (!this.ctx) return null;
    return this._buses.get(name) || this._makeBus(name, 0.4);
  }

  _makeBus(name, send) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 1;
    g.connect(this.master);
    const s = ctx.createGain();
    s.gain.value = send;
    g.connect(s);
    s.connect(this._reverbIn);
    this._buses.set(name, g);
    return g;
  }

  _makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // darker tail: one-pole lowpass whose cutoff falls over time
        const k = 0.55 - 0.45 * t;
        lp += k * ((Math.random() * 2 - 1) - lp);
        data[i] = lp * Math.pow(1 - t, decay);
      }
      // a few discrete early reflections off standing stones
      for (let r = 0; r < 6; r++) {
        const at = Math.floor((0.011 + r * 0.017 + Math.random() * 0.01) * rate);
        if (at < len) data[at] += (Math.random() > 0.5 ? 1 : -1) * (0.5 - r * 0.06);
      }
    }
    return buf;
  }

  _noiseBuffer() {
    if (this._noise) return this._noise;
    const ctx = this.ctx;
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  _out(bus, pan, when) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    let head = gain;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      gain.connect(p);
      p.connect(this.bus(bus));
    } else {
      gain.connect(this.bus(bus));
    }
    return { gain: head, t: Math.max(ctx.currentTime, when ?? ctx.currentTime) };
  }

  // Karplus–Strong string rendered offline into a cached AudioBuffer (harp / lyre).
  _pluckBuffer(freq, bright, decay) {
    const key = `${Math.round(freq * 10)}|${Math.round(bright * 10)}|${Math.round(decay * 4)}`;
    const cached = this._pluckCache.get(key);
    if (cached) return cached;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * Math.min(8, decay + 0.3));
    const buf = ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    const period = sr / freq;
    const D = period - 0.5;
    const Di = Math.floor(D);
    const f = D - Di;
    const g = Math.min(0.9996, Math.pow(0.001, 1 / Math.max(1, decay * freq)));
    const excLen = Math.max(2, Math.floor(period));
    const lpK = 0.15 + 0.8 * bright;
    let lp = 0;
    for (let n = 0; n < len; n++) {
      let exc = 0;
      if (n < excLen) {
        lp += lpK * ((Math.random() * 2 - 1) - lp);
        exc = lp;
      }
      const i0 = n - Di;
      const a = i0 >= 0 ? y[i0] : 0;
      const b = i0 - 1 >= 0 ? y[i0 - 1] : 0;
      const c = i0 - 2 >= 0 ? y[i0 - 2] : 0;
      const d1 = a * (1 - f) + b * f;
      const d2 = b * (1 - f) + c * f;
      y[n] = exc + g * 0.5 * (d1 + d2);
    }
    let peak = 0;
    for (let n = 0; n < len; n++) peak = Math.max(peak, Math.abs(y[n]));
    const norm = peak > 0 ? 0.9 / peak : 1;
    const fadeIn = Math.floor(sr * 0.002);
    const fadeOut = Math.floor(sr * 0.05);
    for (let n = 0; n < len; n++) {
      let w = norm;
      if (n < fadeIn) w *= n / fadeIn;
      if (n > len - fadeOut) w *= (len - n) / fadeOut;
      y[n] *= w;
    }
    if (this._pluckCache.size > 96) this._pluckCache.delete(this._pluckCache.keys().next().value);
    this._pluckCache.set(key, buf);
    return buf;
  }

  pluck(freq, { when, gain = 0.3, pan = 0, bright = 0.5, decay = 2.5, bus = 'sfx' } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._pluckBuffer(freq, bright, decay);
    const { gain: g, t } = this._out(bus, pan, when);
    g.gain.setValueAtTime(gain, t);
    src.connect(g);
    src.start(t);
    src.onended = () => g.disconnect();
  }

  bell(freq, { when, gain = 0.2, pan = 0, decay = 4, bus = 'sfx' } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const { gain: out, t } = this._out(bus, pan, when);
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 3.5;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.05, t + decay * 0.6);
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const partial = ctx.createOscillator();
    partial.frequency.value = freq * 2.76;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.0001, t);
    pg.gain.linearRampToValueAtTime(0.18, t + 0.004);
    pg.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.35);
    partial.connect(pg);
    pg.connect(out);

    car.connect(out);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(gain, t + 0.006);
    out.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    const end = t + decay + 0.05;
    for (const o of [car, mod, partial]) {
      o.start(t);
      o.stop(end);
    }
    car.onended = () => out.disconnect();
  }

  whoosh({ when, gain = 0.15, dur = 1.2, from = 400, to = 2400, pan = 0, bus = 'sfx' } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const { gain: out, t } = this._out(bus, pan, when);
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    src.connect(bp);
    bp.connect(out);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(gain, t + dur * 0.45);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
    src.onended = () => out.disconnect();
  }

  drum({ when, gain = 0.4, pitch = 70, bus = 'music' } = {}) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const { gain: out, t } = this._out(bus, 0, when);
    out.gain.setValueAtTime(1, t);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(pitch, t + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(gain, t + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    osc.connect(og);
    og.connect(out);

    const mode = ctx.createOscillator();
    mode.frequency.setValueAtTime(pitch * 1.59, t);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(0.0001, t);
    mg.gain.linearRampToValueAtTime(gain * 0.25, t + 0.003);
    mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    mode.connect(mg);
    mg.connect(out);

    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(out);

    osc.start(t);
    osc.stop(t + 0.7);
    mode.start(t);
    mode.stop(t + 0.35);
    n.start(t, Math.random());
    n.stop(t + 0.06);
    osc.onended = () => out.disconnect();
  }
}
