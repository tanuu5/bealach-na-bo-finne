// Triple-spiral geometry (§10.4) and its data texture, generated once at setup.
import * as THREE from 'three';

const DEG = Math.PI / 180;

/**
 * Arm point on the water: c_k + ρ(s)·(sin ψ, −cos ψ), ρ = outer − (outer − inner)·s, ψ = φk + s·turns·2π.
 * Writes x/z into out (y untouched by caller convention) and returns out.
 */
export function armPoint(spiral, arm, s, out) {
  const phi = spiral.armPhi[arm] * DEG;
  const cx = spiral.armCenterRadius * Math.sin(phi);
  const cz = -spiral.armCenterRadius * Math.cos(phi);
  const rho = spiral.armOuterRadius - (spiral.armOuterRadius - spiral.armInnerRadius) * s;
  const psi = phi + s * spiral.turns * Math.PI * 2;
  out.x = cx + rho * Math.sin(psi);
  out.z = cz - rho * Math.cos(psi);
  return out;
}

/** Connector k: quadratic Bézier from arm k's outer end to arm k+1's outer end, control at r 6.2, φk + 60°. */
export function connectorPoint(spiral, k, t, out) {
  const a = armPoint(spiral, k, 0, { x: 0, z: 0 });
  const b = armPoint(spiral, (k + 1) % 3, 0, { x: 0, z: 0 });
  const cphi = (spiral.armPhi[k] + 60) * DEG;
  const cx = 6.2 * Math.sin(cphi);
  const cz = -6.2 * Math.cos(cphi);
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * cx + t * t * b.x;
  out.z = u * u * a.z + 2 * u * t * cz + t * t * b.z;
  return out;
}

/**
 * Spiral data texture 1024² covering xz ∈ [−9, 9]² (§10.4 "Spiral texture"). R = stroke mask with a soft cross
 * profile (1 on the centre line → 0.34 at the 0.22 m stroke edge, so the shader can light a narrow ×2.2 core
 * inside a ×0.9 body, §2.3), G = arm param s (0 outer end → 1 centre) scaled by R, B = arm id scaled by R
 * (40 stone, 120 wish, 200 fire, 255 connector). The shader divides G and B by R.
 * DESIGN-QUESTION: §10.4 says "Canvas … drawn once as thick polylines". The same channels are rasterised here by
 * stamping discs into a Uint8Array (a data texture, allowed by §10.0): canvas strokes with a varying G need
 * thousands of stroke() calls, which blew the ≤ 150 ms texture budget once the canvas was actually flushed.
 */
export function createSpiralTexture(spiral, size, renderer) {
  const data = new Uint8Array(size * size * 4);
  const texel = 18 / size; // metres per texel
  const HALF = 0.11; // stroke half-width (m)
  const reach = Math.ceil((HALF + texel) / texel);
  const p = { x: 0, z: 0 };

  function stamp(x, z, sParam, id) {
    const cx = (x + 9) / texel - 0.5;
    const cz = (z + 9) / texel - 0.5;
    const i0 = Math.max(0, Math.floor(cx - reach));
    const i1 = Math.min(size - 1, Math.ceil(cx + reach));
    const j0 = Math.max(0, Math.floor(cz - reach));
    const j1 = Math.min(size - 1, Math.ceil(cz + reach));
    for (let j = j0; j <= j1; j++) {
      const dz = (j - cz) * texel;
      for (let i = i0; i <= i1; i++) {
        const dx = (i - cx) * texel;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > HALF + texel) continue;
        const u = Math.min(d, HALF) / HALF;
        let r = 1 - 0.66 * u * u;
        if (d > HALF) r *= 1 - (d - HALF) / texel; // one-texel antialiased rim
        const k = (j * size + i) * 4;
        const rb = Math.round(r * 255);
        if (rb <= data[k]) continue;
        data[k] = rb;
        data[k + 1] = Math.round(rb * sParam);
        data[k + 2] = Math.round(r * id);
        data[k + 3] = 255;
      }
    }
  }

  const ARM_ID = [40, 120, 200];
  for (let k = 0; k < 3; k++) {
    const n = 1400; // ≈ 2 samples per texel along the ~15 m arm
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      armPoint(spiral, k, s, p);
      stamp(p.x, p.z, s, ARM_ID[k]);
    }
  }
  for (let k = 0; k < 3; k++) {
    const n = 900;
    for (let i = 0; i <= n; i++) {
      // stop just short of the arm ends so filtered texels never mix a connector id with an arm id
      const t = 0.025 + (0.95 * i) / n;
      connectorPoint(spiral, k, t, p);
      stamp(p.x, p.z, i / n, 255);
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.NoColorSpace; // data, not colour
  tex.flipY = false; // row 0 = z −9 (north)
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter; // grazing view: never skip the thin core
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);
  tex.needsUpdate = true;
  return tex;
}
