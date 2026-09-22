import * as THREE from 'three';

// Entrance-stone carving mask (docs/DESIGN.md §10.3: "triple spiral from a canvas texture (256², procedural
// stroke mask)"). Drawn in metres on the stone's 2.4 × 1.2 m front face, so the anisotropic texture mapping
// gives an isotropic pen on the stone. R = sharp pecked-groove core, G = soft falloff (§2.3 core + falloff rule).
// Row 0 of the data is the bottom of the face (v = 0), so no flip is needed.

const SIZE = 256;
const FACE_W = 2.4;
const FACE_H = 1.2;

function doubleSpiralPath(cx, cy, R, startAngle, turns, sign) {
  // Two interleaved Archimedean arms meeting in an S at the centre: returns [armA, armB] polylines (outer → centre).
  const arms = [];
  const steps = 160;
  for (let arm = 0; arm < 2; arm++) {
    const pts = [];
    const a0 = startAngle + arm * Math.PI;
    const rMax = R * (arm === 0 ? 1 : 0.985);
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const th = s * turns * Math.PI * 2;
      const r = rMax * (1 - s) + 0.004;
      const ang = a0 - sign * th;
      pts.push([cx + r * Math.cos(ang), cy + r * Math.sin(ang)]);
    }
    arms.push(pts);
  }
  return arms;
}

function strokeAll(g, paths, width, alpha) {
  g.globalAlpha = alpha;
  g.lineWidth = width;
  for (const pts of paths) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  }
  g.globalAlpha = 1;
}

// A pecked groove wanders: the maker walked the point along the drawn line with a stone hammer. The wobble is
// baked into the paths here rather than added to the texture lookup, because a per-pixel UV offset in the shader
// destroys the derivatives the mip chain is chosen from (the stone then renders as one flat slab).
function peck(paths) {
  return paths.map((pts) =>
    pts.map(([x, y], i) => [
      x + Math.sin(i * 0.83 + x * 41.0 + y * 17.0) * 0.0035 + Math.sin(i * 2.41 + y * 63.0) * 0.0016,
      y + Math.cos(i * 0.77 + y * 37.0 - x * 23.0) * 0.0035 + Math.cos(i * 2.13 + x * 59.0) * 0.0016,
    ]),
  );
}

export function buildSpiralPaths() {
  const paths = [];
  // Laid out after a Boyne-valley entrance kerbstone: a vertical median groove, the big triple spiral in the
  // left field, a lozenge/chevron field in the right, and nested arcs closing both ends. The carving sits a
  // little above mid-face, in the part of the stone that stands clear of the ground (face y −0.39 … +0.42).
  const C = [-0.38, 0.04];
  const D = 0.275;
  const R = 0.20;
  const lobes = [];
  for (let k = 0; k < 3; k++) {
    const beta = Math.PI / 2 + Math.PI / 3 + (k * 2 * Math.PI) / 3; // two lobes above, one below
    const cx = C[0] + D * Math.cos(beta);
    const cy = C[1] + D * Math.sin(beta) * 0.9;
    const [armA, armB] = doubleSpiralPath(cx, cy, R, beta + Math.PI / 2, 1.6, 1);
    paths.push(armA, armB);
    lobes.push({ cx, cy, beta, a: armA[0], b: armB[0] });
  }
  // Connect lobe k's outer arm A end to lobe k+1's outer arm B end with a compass-like curve bulging outward,
  // so the three spirals read as one continuous triskele and not as three separate roundels.
  for (let k = 0; k < 3; k++) {
    const p = lobes[k].a;
    const q = lobes[(k + 1) % 3].b;
    const mid = lobes[k].beta + Math.PI / 3;
    const ctrl = [C[0] + (D + R * 1.5) * Math.cos(mid), C[1] + (D + R * 1.5) * Math.sin(mid) * 0.9];
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const u = 1 - t;
      pts.push([u * u * p[0] + 2 * u * t * ctrl[0] + t * t * q[0], u * u * p[1] + 2 * u * t * ctrl[1] + t * t * q[1]]);
    }
    paths.push(pts);
  }
  // Median groove: the vertical division the stone is famous for, struck slightly off the true centre.
  {
    const pts = [];
    for (let i = 0; i <= 26; i++) {
      const t = i / 26;
      pts.push([0.06 + Math.sin(t * 5.1) * 0.012, -0.40 + 0.84 * t]);
    }
    paths.push(pts);
  }
  // Right field: a band of nested lozenges with chevrons above and below.
  for (let n = 0; n < 3; n++) {
    const cx = 0.30 + n * 0.215;
    for (let j = 0; j < 2; j++) {
      const w = 0.072 - j * 0.032;
      const h = 0.145 - j * 0.062;
      paths.push([
        [cx - w, 0.03],
        [cx, 0.03 + h],
        [cx + w, 0.03],
        [cx, 0.03 - h],
        [cx - w, 0.03],
      ]);
    }
  }
  for (const sy of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const x = 0.22 + (i * 0.59) / 16;
      pts.push([x, 0.03 + sy * (0.215 + (i % 2 === 0 ? 0.0 : 0.05))]);
    }
    paths.push(pts);
  }
  // Nested arcs closing the two ends of the stone.
  for (const side of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      const pts = [];
      const rr = 0.065 + j * 0.05;
      for (let i = 0; i <= 30; i++) {
        const a = -Math.PI / 2 + (Math.PI * i) / 30;
        pts.push([side * (1.13 - rr * Math.cos(a) * 0.9), 0.04 + rr * Math.sin(a)]);
      }
      paths.push(pts);
    }
  }
  return paths;
}

export function createSpiralTexture() {
  const paths = peck(buildSpiralPaths());
  const make = () => {
    const c = document.createElement('canvas');
    c.width = SIZE;
    c.height = SIZE;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000';
    g.fillRect(0, 0, SIZE, SIZE);
    // metres → pixels; y is NOT flipped so that data row 0 = face bottom (v = 0).
    g.setTransform(SIZE / FACE_W, 0, 0, SIZE / FACE_H, SIZE / 2, SIZE / 2);
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    return { c, g };
  };
  const core = make();
  strokeAll(core.g, paths, 0.018, 1);
  const halo = make();
  strokeAll(halo.g, paths, 0.075, 0.20);
  strokeAll(halo.g, paths, 0.048, 0.28);
  strokeAll(halo.g, paths, 0.030, 0.45);

  const a = core.g.getImageData(0, 0, SIZE, SIZE).data;
  const b = halo.g.getImageData(0, 0, SIZE, SIZE).data;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 4] = a[i * 4];
    data[i * 4 + 1] = b[i * 4];
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
