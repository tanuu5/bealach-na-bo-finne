// Seeded 2D value noise + 4-octave fbm in [0,1] (docs/DESIGN.md §3.3: "fbm2 is 4-octave value noise in [0,1]").
// Deterministic for a given rng; allocation-free per call.

export function createValueNoise(rng) {
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  const p = new Uint16Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rng();

  function vnoise(x, y) {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const fx = x - xf;
    const fy = y - yf;
    const X = xf & 255;
    const Y = yf & 255;
    const a = perm[X];
    const b = perm[X + 1];
    const v00 = vals[perm[a + Y]];
    const v10 = vals[perm[b + Y]];
    const v01 = vals[perm[a + Y + 1]];
    const v11 = vals[perm[b + Y + 1]];
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    return v00 + (v10 - v00) * u + (v01 - v00) * v + (v00 - v10 - v01 + v11) * u * v;
  }

  // 4 octaves, gain 0.5, lacunarity 2, per-octave offsets to break lattice alignment; normalised to [0,1].
  function fbm2(x, y) {
    return (
      (0.5 * vnoise(x, y) +
        0.25 * vnoise(x * 2 + 17.13, y * 2 + 31.71) +
        0.125 * vnoise(x * 4 + 47.37, y * 4 + 5.93) +
        0.0625 * vnoise(x * 8 + 73.11, y * 8 + 61.29)) /
      0.9375
    );
  }

  return { vnoise, fbm2 };
}

export function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
