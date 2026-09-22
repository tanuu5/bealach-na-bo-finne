// conductor/memory.js — ring buffer of the viewer's remembered notes (§5.1 note:played, §10.1).
// Preallocated typed arrays: adding a note never allocates.

export function createMemory(size = 32) {
  const deg = new Int16Array(size);
  const oct = new Int8Array(size);
  const time = new Float64Array(size);
  const src = new Array(size).fill('');
  let head = 0; // next write slot
  let count = 0;

  return {
    size,
    get count() {
      return count;
    },

    /**
     * Stores `p` if it is a viewer note with a degree (byAosSi === false, src not 'bealach'), collapsing an
     * identical (src, degree, octave) within 0.5 s into the existing entry. `t` is state.time (never jumps).
     * Returns true when a new entry was written.
     */
    add(p, t) {
      if (!p || p.byAosSi !== false || p.src === 'bealach') return false; // §5.1: only byAosSi === false
      const d = p.degree;
      if (typeof d !== 'number' || !Number.isFinite(d)) return false;
      const dr = Math.round(d);
      const o = Number.isFinite(p.octave) ? Math.round(p.octave) : 0;
      const s = typeof p.src === 'string' ? p.src : '';
      // Chained: a held stone's sixteenth plucks (one gesture) stay one entry. Entry times are refreshed on a
      // collapse, so they are not monotonic in ring order — scan a fixed window instead of breaking early.
      const scan = count < 8 ? count : 8;
      for (let i = 1; i <= scan; i++) {
        const k = (head - i + size) % size;
        if (t - time[k] < 0.5 && deg[k] === dr && oct[k] === o && src[k] === s) {
          time[k] = t;
          return false;
        }
      }
      deg[head] = dr;
      oct[head] = o;
      time[head] = t;
      src[head] = s;
      head = (head + 1) % size;
      if (count < size) count++;
      return true;
    },

    /** Copies the last `n` entries, oldest first, into outDeg/outOct. Returns how many were copied. */
    last(n, outDeg, outOct) {
      const m = Math.min(n, count);
      for (let i = 0; i < m; i++) {
        const k = (head - m + i + size * 2) % size;
        outDeg[i] = deg[k];
        outOct[i] = oct[k];
      }
      return m;
    },

    /** Debug snapshot (allocates; never called per frame). */
    snapshot() {
      const out = [];
      for (let i = count; i >= 1; i--) {
        const k = (head - i + size) % size;
        out.push({ src: src[k], degree: deg[k], octave: oct[k], t: +time[k].toFixed(3) });
      }
      return out;
    },

    clear() {
      head = 0;
      count = 0;
    },
  };
}
