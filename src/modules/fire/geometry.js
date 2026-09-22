// Private geometry builders for the `fire` module (docs/DESIGN.md §10.5).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// aKind: 0 = islet shell, 1 = charred log, 2 = loose cobble on the rim.
export const KIND_ISLET = 0;
export const KIND_LOG = 1;
export const KIND_COBBLE = 2;

// Periodic 1D noise around the ring: a sum of seeded harmonics, normalised to about ±1.
function makeRingNoise(rng, kMin, kMax) {
  const terms = [];
  let norm = 0;
  for (let k = kMin; k <= kMax; k++) {
    const amp = 1 / Math.pow(k, 0.9);
    terms.push([k, amp, rng() * Math.PI * 2]);
    norm += amp;
  }
  return (theta) => {
    let s = 0;
    for (const [k, amp, ph] of terms) s += amp * Math.sin(k * theta + ph);
    return (s / norm) * 1.6;
  };
}

/**
 * Islet cross-section: [radius (m), y relative to `top` (m), displacement weight].
 * Flat lichen table out to ~0.75·r, a broken shoulder, and the widest point exactly at the
 * waterline (y = 0) so the islet never overhangs the loch's fire streak (§3.4). Below the water
 * it tucks back in — two rows only, since the water disc hides the rest.
 */
const PROFILE = [
  [0.0, 0.012, 0.0],
  [0.3, 0.008, 0.12],
  [0.6, 0.0, 0.3],
  [0.86, -0.012, 0.5],
  [1.06, -0.034, 0.75],
  [1.2, -0.085, 0.95],
  [1.3, -0.165, 1.0],
  [1.365, -0.258, 1.0],
  [1.4, -0.352, 1.0], // waterline: top 0.35 − 0.352 ≈ 0
  [1.39, -0.5, 1.0],
  [1.28, -0.78, 1.0],
];

/** Un-displaced surface height (relative to `top`) at radius `r` — used to bed the cobbles in. */
function profileY(rn) {
  if (rn <= PROFILE[0][0]) return PROFILE[0][1];
  for (let i = 1; i < PROFILE.length; i++) {
    const [r1, y1] = PROFILE[i];
    if (rn <= r1) {
      const [r0, y0] = PROFILE[i - 1];
      const t = (rn - r0) / Math.max(r1 - r0, 1e-4);
      return y0 + (y1 - y0) * t;
    }
  }
  return PROFILE[PROFILE.length - 1][1];
}

/**
 * Islet: displaced cylinder, r 1.4, top 0.35 (LAYOUT.islet), `segments` around.
 * The rim radius AND the rim height are both noise-displaced, so the silhouette is a broken
 * stone edge rather than an ellipse (art review, rev 2).
 */
function buildIslet(rng, segments, radius, top) {
  const s = radius / 1.4;
  const rimNoise = makeRingNoise(rng, 2, 11);
  const lobeNoise = makeRingNoise(rng, 1, 3);
  const stepNoise = makeRingNoise(rng, 3, 13);
  const topNoise = makeRingNoise(rng, 1, 5);
  const positions = [];
  const index = [];
  // centre vertex
  positions.push(0, top + PROFILE[0][1], 0);
  for (let j = 1; j < PROFILE.length; j++) {
    const [pr0, dy0, w] = PROFILE[j];
    const pr = pr0 * s;
    const py = top + dy0;
    for (let i = 0; i < segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      // radius: a fine craggy term plus a slow 1–3 lobe, so the plan is not a circle
      const dr = (0.045 * rimNoise(th) + 0.035 * lobeNoise(th + 0.7)) * w * s;
      // height: steps and notches along the rim break the silhouette's top edge
      const dy = (0.035 * stepNoise(th + j * 0.17) + 0.01 * topNoise(th * 2.0 + pr * 3.0)) * w;
      const r = pr + dr;
      positions.push(r * Math.sin(th), py + dy, -r * Math.cos(th));
    }
  }
  // centre fan
  for (let i = 0; i < segments; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % segments);
    index.push(0, b, a);
  }
  for (let j = 1; j < PROFILE.length - 1; j++) {
    const r0 = 1 + (j - 1) * segments;
    const r1 = 1 + j * segments;
    for (let i = 0; i < segments; i++) {
      const i1 = (i + 1) % segments;
      const a = r0 + i;
      const b = r0 + i1;
      const c = r1 + i;
      const d = r1 + i1;
      index.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  const kind = new Float32Array(g.attributes.position.count).fill(KIND_ISLET);
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  return g;
}

/**
 * Loose cobbles bedded into the rim. They are what stops the islet reading as a smooth pancake:
 * each one breaks the silhouette and catches the firelight on its own facets.
 */
function buildCobbles(rng, count, detail, radius, top) {
  const out = [];
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const m = new THREE.Matrix4();
  const pos3 = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.75;
    const rn = 0.8 + rng() * 0.28; // 1.12 … 1.51 of the islet radius
    const rr = radius * rn;
    const sz = (0.075 + rng() * 0.095) * (radius / 1.4);
    const g = new THREE.IcosahedronGeometry(sz, detail);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    const p = g.attributes.position;
    g.setIndex(Array.from({ length: p.count }, (_, k) => k));
    const seed = rng() * 60;
    for (let v = 0; v < p.count; v++) {
      const x = p.getX(v);
      const y = p.getY(v);
      const z = p.getZ(v);
      // position-hashed roughening: shared corners stay welded, facets stay flat
      const h = Math.sin(x * 61.7 + seed) * Math.sin(y * 47.3 + z * 53.1 + seed * 0.6);
      const k = 1 + 0.22 * h;
      p.setXYZ(v, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    e.set(rng() * Math.PI, rng() * Math.PI * 2, rng() * Math.PI);
    q.setFromEuler(e);
    scl.set(1 + rng() * 0.35, 0.58 + rng() * 0.3, 1 + rng() * 0.25);
    // bed it into the shell: sunk by 25–55% of its own height, so it reads as set in, not dropped on
    const sunk = sz * scl.y * (0.25 + rng() * 0.3);
    pos3.set(rr * Math.sin(th), top + profileY(rn * 1.4) * (radius / 1.4) - sunk, -rr * Math.cos(th));
    m.compose(pos3, q, scl);
    g.applyMatrix4(m);
    const kind = new Float32Array(p.count).fill(KIND_COBBLE);
    g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    out.push(g);
  }
  return out;
}

/** Five charred logs laid as a low star fire, inner ends raised on each other over the coals. */
function buildLogs(rng, top) {
  const out = [];
  const q = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const inner = new THREE.Vector3();
  const outer = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 5; i++) {
    const psi = (i / 5) * Math.PI * 2 + (rng() - 0.5) * 0.3 + 1.047; // logs at compass ≈60/132/204/276/348°: none points at the default camera (φ ≈ 168°)
    const rIn = 0.05 + rng() * 0.06;
    const rOut = 0.66 + rng() * 0.14;
    const yIn = top + 0.17 + (i % 3) * 0.045 + rng() * 0.02;
    const thick = 0.1 + rng() * 0.05;
    const yOut = top + thick * 0.45;
    inner.set(rIn * Math.sin(psi + 0.2), yIn, -rIn * Math.cos(psi + 0.2));
    outer.set(rOut * Math.sin(psi), yOut, -rOut * Math.cos(psi));
    dir.subVectors(inner, outer);
    const len = dir.length() + 0.1;
    dir.normalize();
    mid.addVectors(inner, outer).multiplyScalar(0.5).addScaledVector(dir, 0.05);

    const box = new THREE.BoxGeometry(len, thick, thick * (0.85 + rng() * 0.3), 6, 1, 1);
    box.deleteAttribute('uv');
    // taper the burnt inner end, bend and roughen (position-hashed so faces stay welded)
    const pos = box.attributes.position;
    const seed = rng() * 100;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v);
      const y = pos.getY(v);
      const z = pos.getZ(v);
      const u = Math.min(1, Math.max(0, x / len + 0.5)); // 0 outer .. 1 inner
      const taper = 1 - 0.38 * Math.pow(u, 2.2);
      const h = Math.sin(x * 37.1 + seed) * Math.sin(y * 53.7 + z * 41.3 + seed * 0.7);
      const rough = 1 + 0.12 * h;
      const bend = 0.035 * Math.sin(u * Math.PI);
      pos.setXYZ(v, x, y * taper * rough + bend, z * taper * rough);
    }
    box.computeVertexNormals();
    q.setFromUnitVectors(xAxis, dir);
    q2.setFromAxisAngle(xAxis, rng() * Math.PI);
    q.multiply(q2);
    m.compose(mid, q, scl);
    box.applyMatrix4(m);
    const kind = new Float32Array(pos.count).fill(KIND_LOG);
    box.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
    out.push(box);
  }
  return out;
}

export function buildIsletAndLogs(rng, { segments = 48, radius = 1.4, top = 0.35, cobbles = 7, cobbleDetail = 1 } = {}) {
  const islet = buildIslet(rng, segments, radius, top);
  const stones = buildCobbles(rng, cobbles, cobbleDetail, radius, top);
  const logs = buildLogs(rng, top);
  const merged = mergeGeometries([islet, ...stones, ...logs], false);
  islet.dispose();
  for (const c of stones) c.dispose();
  for (const l of logs) l.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Two Y-billboard quads (outer envelope + hot core) in one geometry; expanded in the vertex shader. */
export function buildFlameGeometry() {
  const corners = [];
  const layers = [];
  const index = [];
  for (let l = 0; l < 2; l++) {
    const o = l * 4;
    corners.push(-1, 0, 1, 0, 1, 1, -1, 1);
    layers.push(l, l, l, l);
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(8 * 3), 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 2));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layers, 1));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 4.5);
  return g;
}

/**
 * Spark pool: `total` points split into the hold-orbit group, the idle stream and 8 burst slots.
 * Returns { geometry, slotSize, idleCount, holdCount }.
 */
export function buildSparkGeometry(rng, total) {
  const holdCount = Math.round(total * 0.06);
  const slotSize = Math.floor((total * 0.74) / 8);
  const idleCount = total - holdCount - slotSize * 8;
  const data = new Float32Array(total * 4);
  const seeds = new Float32Array(total * 3);
  let p = 0;
  const put = (group, idx) => {
    data[p * 4] = group;
    data[p * 4 + 1] = idx;
    data[p * 4 + 2] = rng();
    data[p * 4 + 3] = rng();
    seeds[p * 3] = rng();
    seeds[p * 3 + 1] = rng();
    seeds[p * 3 + 2] = rng();
    p++;
  };
  for (let i = 0; i < holdCount; i++) put(-2, i);
  for (let i = 0; i < idleCount; i++) put(-1, i);
  for (let s = 0; s < 8; s++) for (let i = 0; i < slotSize; i++) put(s, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  g.setAttribute('aData', new THREE.BufferAttribute(data, 4));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), 80);
  return { geometry: g, slotSize, idleCount, holdCount };
}
