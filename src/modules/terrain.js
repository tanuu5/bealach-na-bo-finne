// terrain — ground owner (docs/DESIGN.md §10.3).
// Owns heightAt (§3.3), the polar ground grid with in-shader La Tène ripples, the sí mound (quartz facade in the
// ground shader; kerb, entrance stone with triple spiral and passage as one instanced "mound set"), the hill ring,
// grass (high quality only), world.terrain, and the ground / mound click responses.
//
// DESIGN-QUESTION: §10.3 acceptance 2 runs `?only=terrain` and then asks for the 5×5 luma at (752, 214) (sky just
// above the mound crown) to exceed (752, 232) (mound) by >= 12. Without `sky` there is no airglow: the sky is only
// the clear colour plus the grade lift, which tone-maps to luma ~11, and an unlit ground reads 8–12 by §2.3
// consequence 4 — so the difference cannot reach 12 from terrain alone. §2.3 consequence 3 states the >= 12 is
// meant to come from the horizon airglow, which `sky` owns. Measured with `?only=sky,terrain&warm=6&noauto&shot`:
// (752, 214) luma 41.4 vs (752, 232) luma 11.2, i.e. 30.2 levels of silhouette contrast; the full merged set gives
// 81.2 vs 14.6 = 66.6, so §10.10 acceptance 1's version of the same check passes with a wide margin. The hills and
// the mound crown therefore stay near the unlit floor rather than being lifted to pass the check in isolation; the
// only thing the mound gains is the horizon-glow fill and rim on its *tilted* surfaces (see terrain/glsl.js), which
// leave the crown sample at (752, 232) within a luma of where it was.
import * as THREE from 'three';
import { createValueNoise, smoothstep } from './terrain/noise.js';
import { createSpiralTexture } from './terrain/spiral.js';
import {
  groundVertex,
  groundFragment,
  moundVertex,
  moundFragment,
  hillsVertex,
  hillsFragment,
  grassVertex,
  grassFragment,
} from './terrain/glsl.js';

// LAYOUT v2 — copied from docs/DESIGN.md §3.2. Do not edit locally. (v1 is obsolete: tobar, harpStars, ground changed)
// Any position whose y is 0 is a ground position: place it at ctx.world.heightAt(x, z).
const LAYOUT = {
  loch:   { radius: 9.0, level: 0.0 },                    // water disc at y=0, centre origin
  islet:  { radius: 1.4, top: 0.35 },                     // flat stone platform under the fire
  fire:   { pos: [0, 0.35, 0], flameIdle: 1.4, flameMax: 3.2 },
  circle: { radius: 12.5, bankCrest: 0.8 },               // stones stand on the bank crest
  stones: [                                               // φ in degrees, h = visible height (m), w = width, t = thickness
    { id: 0,  role: 'portal',    phi:   8.5, h: 3.6, w: 1.3, t: 0.7 },   // east portal
    { id: 1,  role: 'harp',      phi:  42.8, h: 3.2, w: 1.1, t: 0.6, degree: 0, octave: 0 }, // D3
    { id: 2,  role: 'harp',      phi:  77.1, h: 2.8, w: 1.0, t: 0.6, degree: 1, octave: 0 }, // E3
    { id: 3,  role: 'harp',      phi: 111.4, h: 2.3, w: 1.0, t: 0.5, degree: 3, octave: 0 }, // G3
    { id: 4,  role: 'harp',      phi: 145.7, h: 1.8, w: 0.9, t: 0.5, degree: 4, octave: 0 }, // A3
    { id: 5,  role: 'recumbent', phi: 180.0, h: 1.1, w: 2.4, t: 0.9 },   // axial stone, long side faces the centre
    { id: 6,  role: 'harp',      phi: 214.3, h: 1.8, w: 0.9, t: 0.5, degree: 5, octave: 0 }, // B3
    { id: 7,  role: 'harp',      phi: 248.6, h: 2.3, w: 1.0, t: 0.5, degree: 0, octave: 1 }, // D4
    { id: 8,  role: 'harp',      phi: 282.9, h: 2.8, w: 1.0, t: 0.6, degree: 1, octave: 1 }, // E4
    { id: 9,  role: 'harp',      phi: 317.2, h: 3.2, w: 1.1, t: 0.6, degree: 3, octave: 1 }, // G4
    { id: 10, role: 'portal',    phi: 351.5, h: 3.6, w: 1.3, t: 0.7 },   // west portal
  ],
  sceach: { pos: [9.0, 0, 5.8], height: 4.6, crownRadius: 2.4, leanAwayFromLoch: 8 /*deg*/ },
  tobar:  { pos: [8.1, 0, 6.2], ringRadius: 0.55 },        // holy well at the tree's left-front foot (r 10.2, dry ground), rill to the loch
  mound:  { center: [0, 0, -50], radius: 20, height: 9, dome: 0.8, crownY: 10.0,
            passage: [0, 1.1, -30.6], passageFacing: [0, 0, 1], quartzArcDeg: 50 },
  ground: { rInner: 8.2, rOuter: 320 },                   // polar grid; outer edge hides under the hills' inner skirt
  hills:  { rInner: 300, rOuter: 700, ridgeR: 420, ridgeDegMin: 1.0, ridgeDegMax: 3.5, northNotchDeg: 20 },
  beacons:[ // 9 hill fires, compass φ, all on the hill ridge at r=420
    20, 62, 101, 139, 178, 222, 259, 298, 336 ],
  spiral: { armCenterRadius: 3.6, armPhi: [0, 120, 240], armOuterRadius: 1.9, armInnerRadius: 0.25, turns: 2.25 },
           // arm 0 = stones (points to the portal gap), arm 1 = wish (points to the sceach), arm 2 = fire
  sky:    { radius: 1500, starRadius: 1400,
            celestialPole: [0, 0.7986, -0.6018],           // 53° elevation due north (Irish latitude)
            bandFoot: [-0.1392, 0, -0.9903],               // Milky Way meets the horizon at φ = −8°
            bandPole: [-0.874, 0.469, 0.123],              // normal of the Milky Way great circle
            bandPoleClimax: [-1, 0, 0],                    // band stands vertical through N horizon + zenith
            harpStars: { theta0: 6.5, dTheta: 1.2,         // harp star k: θ = theta0 + dTheta·k (deg), β = beta[k] (deg)
                         beta: [-2.6, -0.9, -2.0, -0.2, -1.1, 0.9, -0.3, 1.6] },
            vega:   { theta: 12, beta: 7 },
            altair: { theta: 12, beta: -7 },
            perseidRadiant: { phi: 40, elevDeg: 25 } },
};

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const MOUND_CX = LAYOUT.mound.center[0];
const MOUND_CZ = LAYOUT.mound.center[2];
const RIPPLE_SLOTS = 6;
const GRASS_COUNT = 6000;

export default async function setup(ctx) {
  const { scene, world, events, state, camera } = ctx;
  const U = ctx.uniforms;
  // §3.6 extension uniforms: created lazily, shared by every module.
  U.uFireLevel ??= { value: 0 };
  U.uClimaxT ??= { value: -1 };
  U.uAfterglow ??= { value: 0 };
  U.uOtherAngle ??= { value: 0 };
  const high = ctx.quality !== 'low';

  // ───────────────────────── heightAt (§3.3) ─────────────────────────
  // MOUND PROFILE v3 — art call authorised by the lead over §3.3's plateau term.
  // §3.3 wrote the mound as `9.0·smoothstep(20,11,dm) + 0.8·(1−(dm/11)²)`: a 0.8 m fall over the whole
  // 11 m plateau, i.e. 7 px of crown across 230 px of screen. Together with the §10.3 facade that read as a
  // flat-roofed building on a white wall, not as a passage-tomb mound. The three pinned samples are
  // unchanged — heightAt(0,−50) = 10.0, heightAt(12.5,0) = 0.8, heightAt(0,0) = −0.4 — and the kerb line
  // heightAt(0,−30.6) moves 0.315 → 0.327 (§3.3 says "≈ 0.31"). What changes is the shape between them:
  //   • the plateau term drops 9.0 → MOUND_PLATE and its shoulder starts at dm 12 instead of 11, so the
  //     facade band (d 16–17.7) still spans 1.8–4.1 m of slope as §10.3 requires;
  //   • the dome term carries the difference and reaches 12.5 m instead of 11, so the crown falls 1.82 m
  //     from the centre to the old plateau edge — a whale-back. Measured on the default frame, the
  //     silhouette now moves 24 px across the central 230 px where it moved 7, with two real folds.
  //   • MOUND_SWELL adds the low-frequency turf undulation that keeps the silhouette off a ruled line and
  //     rides the facade band up and down with the turf. It is masked to zero at the crown (so
  //     heightAt(0,−50) stays exact), to ±0.15 m by the kerb course and to zero before the meadow swell
  //     begins at dm 21, and to zero around the entrance (so the §3.2 doorway keeps its level forecourt
  //     and the fixed-y entrance stone, orthostats and lintel still bed correctly).
  const MOUND_PLATE = 7.9;
  const MOUND_DOME = 1.9; // PLATE + DOME + 0.2 meadow = 10.0 exactly
  const MOUND_SWELL = 2.0; // peak-to-peak metres of turf undulation on the flanks (±0.73 m measured)
  const { fbm2, vnoise } = createValueNoise(ctx.makeRng('terrain'));
  // Two octaves, not fbm2's four. The low grid is 48×96, i.e. ~3.5 m cells out at the mound, so fbm2's
  // 3 m and 1.5 m octaves are under-sampled there and alias into a visibly faceted silhouette; at 11.8 m
  // and 6.2 m both octaves are resolved by the low grid and by the ±0.6 m normal differencing. Band-limiting
  // here costs nothing visible (a 1.5 m ripple on a mound 50 m away is sub-pixel anyway) and removes the
  // sharp kinks from the low silhouette; the long straight runs that remain at `?q=low` are the 48×96 grid
  // itself (§11.1) and were there before this revision too.
  const swellNoise = (x, z) => 0.72 * vnoise(x, z) + 0.28 * vnoise(x * 1.9 + 21.7, z * 1.9 - 8.3);
  function heightAt(x, z) {
    const r = Math.hypot(x, z);
    const dm = Math.hypot(x - 0, z + 50); // distance to the sí mound centre
    let h = 0.2 + 0.6 * Math.exp(-(((r - 12.5) / 1.6) ** 2)); // meadow 0.2 + stone bank, crest 0.8 at r=12.5
    const swell = smoothstep(18, 45, r) * smoothstep(21, 26, dm); // gentle swell: flat near the circle AND on the mound
    if (swell > 0) h += 0.9 * (fbm2(x * 0.021, z * 0.021) - 0.5) * swell;
    h += MOUND_PLATE * smoothstep(20, 12, dm) + MOUND_DOME * smoothstep(12.5, 0, dm);
    const turf = smoothstep(1.5, 6.0, dm) * smoothstep(21, 15.5, dm) * smoothstep(1.7, 4.2, Math.hypot(x, z + 30.6));
    if (turf > 0) h += MOUND_SWELL * (swellNoise(x * 0.085 + 40.3, z * 0.085 - 12.7) - 0.5) * turf;
    h = -0.4 + (h + 0.4) * smoothstep(8.4, 9.8, r); // loch shore dips under the water
    return h;
  }

  // ───────────────────────── hill ridge (§10.3) ─────────────────────────
  const hillNoise = createValueNoise(ctx.makeRng('terrain:hills'));
  function ridgeDeg(phiDeg) {
    const a = phiDeg * DEG;
    // fbm sampled on a circle, so the ridge is periodic in φ
    // (offset chosen by eye for the default seed: varied ridge, 14–32 px above the horizon in the default frame)
    const f = hillNoise.fbm2(Math.sin(a) * 2.4 + 3.1, -Math.cos(a) * 2.4 - 8.2);
    let deg = 1.5 + 2.0 * smoothstep(0.22, 0.78, f);
    let w = ((phiDeg % 360) + 360) % 360;
    if (w > 180) w = 360 - w; // |angle from north|
    // DESIGN-QUESTION: "eased down to 1.0° within ±20° of north" does not define the easing curve. A linear ease
    // leaves the notch shoulders (φ ≈ ±10°, outside the mound) 2–9 px above the horizon, below the 12–55 px window of
    // §10.3 acceptance 2, so the ease is (smoothstep(20°, 3°, |φ|))^2.5: 1.0° at north, hidden behind the mound.
    deg += (LAYOUT.hills.ridgeDegMin - deg) * Math.pow(smoothstep(LAYOUT.hills.northNotchDeg, 3, w), 2.5);
    return deg;
  }
  function ridgeY(phiDeg) {
    return LAYOUT.hills.ridgeR * Math.tan(ridgeDeg(phiDeg) * DEG);
  }

  // ───────────────────────── colours & uniforms ─────────────────────────
  const col = (key) => new THREE.Color(ctx.palette[key]); // linear
  const palette = {
    uLichen: { value: col('lichen') },
    uAirglow: { value: col('airglow') },
    uBoFinne: { value: col('boFinne') },
    uTorc: { value: col('torc') },
    uVerdigris: { value: col('verdigris') },
  };
  const ripples = [];
  for (let i = 0; i < RIPPLE_SLOTS; i++) ripples.push(new THREE.Vector4(0, 0, -1000, 0));
  const uRipple = { value: ripples };
  const uFlashT = { value: -1000 };
  const uWind = { value: ctx.reducedMotion ? 0.35 : 1 };
  const uViewportH = { value: ctx.size.height * ctx.size.dpr };
  const shared = () => ({
    uTime: U.uTime,
    uEnergy: U.uEnergy,
    uVeil: U.uVeil,
    uFirePos: U.uFirePos,
    uFireLevel: U.uFireLevel,
    uClimaxT: U.uClimaxT,
    uAfterglow: U.uAfterglow,
    uOtherAngle: U.uOtherAngle,
  });
  const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

  const disposables = [];
  const track = (o) => (disposables.push(o), o);

  // ───────────────────────── ground (§10.3) ─────────────────────────
  const albedoNoise = createValueNoise(ctx.makeRng('terrain:albedo'));
  function buildGround(N, S) {
    const { rInner, rOuter } = LAYOUT.ground;
    const rings = N + 1;
    const count = rings * S;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const nse = new Float32Array(count * 2);
    let k = 0;
    for (let i = 0; i < rings; i++) {
      const r = rInner * Math.pow(rOuter / rInner, i / N);
      const eps = THREE.MathUtils.clamp(r * 0.012, 0.05, 2.5);
      for (let j = 0; j < S; j++, k++) {
        const phi = (j / S) * TAU;
        const x = r * Math.sin(phi);
        const z = -r * Math.cos(phi);
        const h = heightAt(x, z);
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;
        const dx = (heightAt(x + eps, z) - heightAt(x - eps, z)) / (2 * eps);
        const dz = (heightAt(x, z + eps) - heightAt(x, z - eps)) / (2 * eps);
        const il = 1 / Math.hypot(dx, 1, dz);
        nor[k * 3] = -dx * il;
        nor[k * 3 + 1] = il;
        nor[k * 3 + 2] = -dz * il;
        nse[k * 2] = THREE.MathUtils.clamp((albedoNoise.fbm2(x * 0.16 + 3.1, z * 0.16 - 7.7) - 0.28) / 0.44, 0, 1);
        nse[k * 2 + 1] = albedoNoise.fbm2(x * 0.62 - 13.3, z * 0.62 + 21.9);
      }
    }
    const idx = new Uint32Array(N * S * 6);
    let q = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < S; j++) {
        const a = i * S + j;
        const b = i * S + ((j + 1) % S);
        const c = (i + 1) * S + j;
        const d = (i + 1) * S + ((j + 1) % S);
        idx[q++] = a;
        idx[q++] = b;
        idx[q++] = c;
        idx[q++] = b;
        idx[q++] = d;
        idx[q++] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aNoise', new THREE.BufferAttribute(nse, 2));
    g.setIndex(new THREE.BufferAttribute(count > 65535 ? idx : new Uint16Array(idx), 1));
    g.computeBoundingSphere();
    return g;
  }

  const groundGeo = track(high ? buildGround(96, 192) : buildGround(48, 96));
  const groundMat = track(
    new THREE.ShaderMaterial({
      name: 'terrain.ground',
      uniforms: {
        ...fogUniforms(),
        ...shared(),
        uLichen: palette.uLichen,
        uAirglow: palette.uAirglow,
        uBoFinne: palette.uBoFinne,
        uTorc: palette.uTorc,
        uRipple,
        uFlashT,
        // DESIGN-QUESTION: §10.3 acceptance 3 wants R ≥ G + 2 on the festival ground at r ≈ 11.7, while §2.2
        // wants ~85% peat/airglow/lichen at arrival. With the verbatim FIRELIGHT, a lichen·0.55 albedo and the
        // green grade lift, a *flat* surface cannot do both: §2.3 consequence 1's numbers were computed for a
        // lichen face **turned to the fire**, i.e. a stone, and lighting the whole meadow as if it were turned
        // to the fire is what made the merged frame read as a sandy desert.
        // Resolution: keep the grazing-light term, but confine it to the churned dancing ground on the *inner*
        // bank, which really does slope toward the fire — it now dies at the bank crest (r 10.4→14) instead of
        // running out to r = 17, so acceptance 3 still passes at (560, 610) while the meadow beyond the circle
        // is green-black. uBasinAO no longer halves the airglow fill over that whole annulus either.
        uFireBend: { value: 1.1 },
        uBasinAO: { value: 0.86 },
      },
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      fog: true,
    }),
  );
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.name = 'terrain.ground';
  scene.add(ground);

  // ───────────────────────── mound set (§10.3) ─────────────────────────
  const moundRng = ctx.makeRng('terrain:mound');
  const spiralTex = track(createSpiralTexture());
  const moundItems = [];
  const KERB_D = 19.4;
  for (let i = 0; i < 40; i++) {
    // Real Newgrange kerbstones differ wildly — width, height, thickness, tilt and spacing all vary, and the
    // course wanders off the true circle. The merged build used near-identical boxes at exactly even spacing,
    // which read as a row of beans. §10.3's 1.2×0.9×0.5 m stays the mean; everything below is the spread.
    const a = ((i + 0.5) / 40) * TAU + (moundRng() - 0.5) * 0.09; // uneven spacing
    const d = KERB_D + (moundRng() - 0.5) * 0.6; // the course wanders in and out
    const x = MOUND_CX + d * Math.sin(a);
    const z = MOUND_CZ + d * Math.cos(a);
    const sy = 0.9 * (0.62 + 0.78 * moundRng());
    const bury = 0.06 + 0.26 * moundRng(); // some stones are half-sunk, some stand proud
    moundItems.push({
      type: 0,
      pos: [x, heightAt(x, z) + sy * 0.5 - bury, z],
      rot: [-0.05 - 0.16 * moundRng(), a + (moundRng() - 0.5) * 0.34, (moundRng() - 0.5) * 0.26],
      scale: [1.2 * (0.66 + 0.74 * moundRng()), sy, 0.5 * (0.72 + 0.62 * moundRng())],
      delay: 0.5 + 0.5 * Math.cos(a), // back of the mound ignites first, the front last (the river runs crown → entrance)
    });
  }
  moundItems.push({ type: 1, pos: [0, 0.6, -30.2], rot: [0, 0, 0], scale: [2.4, 1.2, 0.5], delay: 1 }); // entrance stone
  moundItems.push({ type: 2, pos: [0, 1.1, -30.6], rot: [0, 0, 0], scale: [1, 1.6, 0.1], delay: 1 }); // passage recess
  // Doorway orthostats and lintel framing the recess (plain stones, no carving) so the glow reads as an opening.
  const baseY = heightAt(0, -30.6);
  for (const s of [-1, 1]) {
    moundItems.push({ type: 3, pos: [s * 0.7, (baseY - 0.15 + 1.9) / 2, -30.64], rot: [0, s * 0.05, s * 0.025], scale: [0.36, 1.9 - baseY + 0.15, 0.46], delay: 1 });
  }
  moundItems.push({ type: 3, pos: [0, 2.03, -30.66], rot: [0.03, 0.02, 0.02], scale: [1.72, 0.27, 0.52], delay: 1 });

  const moundCount = moundItems.length;
  const moundGeo = track(new THREE.BoxGeometry(1, 1, 1)); // 12 triangles per stone; the vertex shader weathers it
  const info = new Float32Array(moundCount * 3);
  const moundMat = track(
    new THREE.ShaderMaterial({
      name: 'terrain.mound',
      uniforms: {
        ...fogUniforms(),
        ...shared(),
        uLichen: palette.uLichen,
        uTorc: palette.uTorc,
        uSpiralTex: { value: spiralTex },
        uFlashT,
      },
      vertexShader: moundVertex,
      fragmentShader: moundFragment,
      fog: true,
    }),
  );
  const moundSet = new THREE.InstancedMesh(moundGeo, moundMat, moundCount);
  moundSet.name = 'terrain.moundSet';
  {
    const m = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    moundItems.forEach((it, i) => {
      e.set(it.rot[0], it.rot[1], it.rot[2], 'YXZ');
      qt.setFromEuler(e);
      p.fromArray(it.pos);
      sc.fromArray(it.scale);
      m.compose(p, qt, sc);
      moundSet.setMatrixAt(i, m);
      info[i * 3] = it.type;
      info[i * 3 + 1] = moundRng();
      info[i * 3 + 2] = it.delay;
    });
  }
  moundGeo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 3));
  moundSet.instanceMatrix.needsUpdate = true;
  moundSet.computeBoundingSphere();
  scene.add(moundSet);

  // ───────────────────────── hills (§10.3) ─────────────────────────
  function buildHills(S, radii, fracs) {
    const rings = radii.length;
    const pos = new Float32Array(rings * S * 3);
    // aRim v2: (metres below the ridge crest at this φ, tone noise, how high this stretch of ridge stands).
    // The old attribute was a 0/1 ridge flag, which interpolated to a constant-width hairline in screen
    // space — the "drawn outline" finding. A real depth in metres gives a proper atmospheric falloff.
    const rim = new Float32Array(rings * S * 3);
    const ridgeIdx = radii.indexOf(LAYOUT.hills.ridgeR);
    let k = 0;
    for (let i = 0; i < rings; i++) {
      const r = radii[i];
      for (let j = 0; j < S; j++, k++) {
        const phiDeg = (j / S) * 360;
        const a = phiDeg * DEG;
        const x = r * Math.sin(a);
        const z = -r * Math.cos(a);
        const H = ridgeY(phiDeg);
        let y;
        if (i === 0) {
          y = heightAt(x, z) - 2; // inner skirt 2 m below the ground grid (which runs to r = 320)
        } else if (i === ridgeIdx) {
          y = H;
        } else {
          const v = hillNoise.fbm2(x * 0.012 + 40.1, z * 0.012 - 9.3);
          y = Math.max(fracs[i] * H * (0.8 + 0.4 * v), i < ridgeIdx ? 2.4 : 1.5);
          if (i > ridgeIdx) y = Math.min(y, H * 0.95); // the back side never rises above the ridge
        }
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        rim[k * 3] = Math.max(0, H - y);
        rim[k * 3 + 1] = hillNoise.fbm2(x * 0.02 - 77.0, z * 0.02 + 13.0);
        rim[k * 3 + 2] = THREE.MathUtils.clamp(
          (ridgeDeg(phiDeg) - LAYOUT.hills.ridgeDegMin) /
            (LAYOUT.hills.ridgeDegMax - LAYOUT.hills.ridgeDegMin),
          0,
          1,
        );
      }
    }
    const idx = new Uint32Array((rings - 1) * S * 6);
    let q = 0;
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < S; j++) {
        const a = i * S + j;
        const b = i * S + ((j + 1) % S);
        const c = (i + 1) * S + j;
        const d = (i + 1) * S + ((j + 1) % S);
        idx[q++] = a;
        idx[q++] = b;
        idx[q++] = c;
        idx[q++] = b;
        idx[q++] = d;
        idx[q++] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRim', new THREE.BufferAttribute(rim, 3));
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
  const hillsGeo = track(
    high
      ? buildHills(256, [300, 336, 380, 420, 468, 565, 700], [0, 0.2, 0.62, 1, 0.86, 0.62, 0.45])
      : buildHills(128, [300, 350, 420, 520, 700], [0, 0.32, 1, 0.72, 0.45]),
  );
  const hillsMat = track(
    new THREE.ShaderMaterial({
      name: 'terrain.hills',
      uniforms: {
        ...fogUniforms(),
        ...shared(),
        uLichen: palette.uLichen,
        uAirglow: palette.uAirglow,
        uRimGain: { value: 1.25 },
      },
      vertexShader: hillsVertex,
      fragmentShader: hillsFragment,
      fog: true,
    }),
  );
  const hills = new THREE.Mesh(hillsGeo, hillsMat);
  hills.name = 'terrain.hills';
  scene.add(hills);

  // ───────────────────────── grass (§10.3, high only) ─────────────────────────
  let grass = null;
  if (high) {
    const rng = ctx.makeRng('terrain:grass');
    const tobar = LAYOUT.tobar.pos;
    const tobarR = Math.hypot(tobar[0], tobar[2]);
    const shoreX = (tobar[0] / tobarR) * 9.25;
    const shoreZ = (tobar[2] / tobarR) * 9.25;
    const stoneBoxes = LAYOUT.stones.map((s) => ({
      cx: 12.5 * Math.sin(s.phi * DEG),
      cz: -12.5 * Math.cos(s.phi * DEG),
      ux: Math.cos(s.phi * DEG), // tangent
      uz: Math.sin(s.phi * DEG),
      hw: s.w / 2 + 1,
      ht: s.t / 2 + 1,
    }));
    const allowed = (x, z) => {
      const r = Math.hypot(x, z);
      if (r < 10 || r > 45) return false;
      if (Math.hypot(x - MOUND_CX, z - MOUND_CZ) < 21) return false; // mound footprint
      for (const s of stoneBoxes) {
        const dx = x - s.cx;
        const dz = z - s.cz;
        const t = dx * s.ux + dz * s.uz;
        const rr = -dx * s.uz + dz * s.ux;
        if (Math.abs(t) < s.hw && Math.abs(rr) < s.ht) return false;
      }
      if (Math.hypot(x - tobar[0], z - tobar[2]) < LAYOUT.tobar.ringRadius + 0.9) return false;
      if (Math.hypot(x - LAYOUT.sceach.pos[0], z - LAYOUT.sceach.pos[2]) < 1.0) return false;
      // the tobar's rill toward the loch
      const vx = shoreX - tobar[0];
      const vz = shoreZ - tobar[2];
      const tt = THREE.MathUtils.clamp(((x - tobar[0]) * vx + (z - tobar[2]) * vz) / (vx * vx + vz * vz), 0, 1);
      if (Math.hypot(x - (tobar[0] + vx * tt), z - (tobar[2] + vz * tt)) < 0.35) return false;
      return true;
    };
    const offs = new Float32Array(GRASS_COUNT * 4);
    const shape = new Float32Array(GRASS_COUNT * 4);
    let n = 0;
    let guard = 0;
    while (n < GRASS_COUNT && guard++ < GRASS_COUNT * 40) {
      // Density is heaviest where the meadow actually reads — the bank and the near meadow inside r 25 — and
      // thins with distance, so the turf covers a continuous surface instead of scattering interchangeable
      // props over bare ground (§3.4). The blade budget is fixed at 6000 (§11.1), so this is a redistribution.
      const u = rng();
      const band = u < 0.5 ? [10.2, 16] : u < 0.85 ? [16, 25] : [25, 45];
      const r = Math.sqrt(band[0] * band[0] + rng() * (band[1] * band[1] - band[0] * band[0]));
      const phi = rng() * TAU;
      const cx = r * Math.sin(phi);
      const cz = -r * Math.cos(phi);
      if (!allowed(cx, cz)) continue;
      if (r < 12.2 && rng() > 0.6) continue; // the dancing ground is trodden thinner, never bare
      // Per-tuft identity: every blade in a tuft shares a seed (one species, one clump), and tufts differ in
      // count, height, spread and silhouette — the instance seed drives three blade forms in the shader.
      const tuftSeed = rng();
      const blades = 3 + Math.floor(rng() * 9);
      const tuftScale = 0.62 + rng() * 0.9;
      const tuftH = (r < 13 ? 0.27 : 0.31) + rng() * (r < 13 ? 0.1 : 0.2);
      const spread = 0.04 + rng() * 0.16;
      for (let b = 0; b < blades && n < GRASS_COUNT; b++) {
        const oa = rng() * TAU;
        const od = spread * (0.18 + 0.82 * rng());
        const x = cx + Math.cos(oa) * od;
        const z = cz + Math.sin(oa) * od;
        if (!allowed(x, z)) continue;
        const yaw = Math.atan2(-Math.cos(oa), Math.sin(oa)) + (rng() - 0.5) * 1.5; // blade faces out of the tuft
        offs[n * 4] = x;
        offs[n * 4 + 1] = heightAt(x, z) - 0.02;
        offs[n * 4 + 2] = z;
        offs[n * 4 + 3] = yaw;
        shape[n * 4] = THREE.MathUtils.clamp(tuftH * tuftScale * (0.78 + 0.44 * rng()), 0.25, 0.5);
        shape[n * 4 + 1] = 0.014 + rng() * 0.026;
        shape[n * 4 + 2] = (0.05 + rng() * 0.22) * (od / Math.max(spread, 1e-3) + 0.25); // outer blades lean further
        shape[n * 4 + 3] = (tuftSeed + b * 0.0193) % 1;
        n++;
      }
    }
    const blade = new THREE.InstancedBufferGeometry();
    blade.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.34, 0.55, 0, 0.34, 0.55, 0, 0, 1, 0]), 3),
    );
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    blade.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offs, 4));
    blade.setAttribute('aShape', new THREE.InstancedBufferAttribute(shape, 4));
    blade.instanceCount = n;
    track(blade);
    const grassMat = track(
      new THREE.ShaderMaterial({
        name: 'terrain.grass',
        uniforms: {
          ...fogUniforms(),
          ...shared(),
          uLichen: palette.uLichen,
          uAirglow: palette.uAirglow,
          uTorc: palette.uTorc,
          uVerdigris: palette.uVerdigris,
          uRipple,
          uWind,
          uViewportH,
        },
        vertexShader: grassVertex,
        fragmentShader: grassFragment,
        side: THREE.DoubleSide,
        fog: true,
      }),
    );
    grass = new THREE.Mesh(blade, grassMat);
    grass.name = 'terrain.grass';
    grass.frustumCulled = false;
    scene.add(grass);
  }

  // ───────────────────────── world registry (§5.3) ─────────────────────────
  const prevHeightAt = world.heightAt;
  world.heightAt = heightAt;
  world.groundMeshes.push(ground, moundSet);

  function ripple(x, z, strength = 1, half = false) {
    let slot = 0;
    let oldest = Infinity;
    for (let i = 0; i < RIPPLE_SLOTS; i++) {
      if (ripples[i].z < oldest) {
        oldest = ripples[i].z;
        slot = i;
      }
    }
    const s = THREE.MathUtils.clamp(Number.isFinite(strength) ? strength : 1, 0.001, 1);
    ripples[slot].set(x, z, state.time, half ? -s : s);
  }

  world.terrain = {
    mound: {
      center: new THREE.Vector3(...LAYOUT.mound.center),
      radius: LAYOUT.mound.radius,
      crownY: LAYOUT.mound.crownY,
      passage: new THREE.Vector3(...LAYOUT.mound.passage),
    },
    ripple: (x, z, strength = 1) => ripple(x, z, strength, false),
    ridgeY,
  };

  // ───────────────────────── interaction (§6.2) ─────────────────────────
  const A = ctx.audio;
  const tmp = new THREE.Vector3();
  let phase = 'idle';
  let windTarget = 1;
  let windValue = 1;

  function musicNow() {
    const M = world.music;
    return M && typeof M.now === 'function' ? M.now() : A.now();
  }
  function allow(key) {
    return world.music?.allow?.(key) ?? true;
  }
  function notePlayed() {
    events.emit('note:played', { src: 'terrain', degree: null, octave: 0, voice: 'drum', when: musicNow(), byAosSi: false });
  }

  function groundTap(point) {
    ripple(point.x, point.z, 1, false);
    state.energyTarget += 0.01;
    const fp = world.firePos;
    const distFromFire = Math.hypot(point.x - (fp?.x ?? 0), point.z - (fp?.z ?? 0));
    if (allow('terrain:ground')) {
      // DESIGN-QUESTION: §8.1 routes interaction voices to 'sfx'; the drum voice defaults to 'music', so we pass bus 'sfx'.
      A.drum({ pitch: 64 + 32 * THREE.MathUtils.clamp((distFromFire - 10) / 30, 0, 1), gain: 0.3, bus: 'sfx' });
      notePlayed();
    }
  }

  function moundTap(point) {
    ripple(point.x, point.z, 1, true); // half-size three-lobed ripple
    uFlashT.value = state.time; // passage glows torc ×1.0 for 1.5 s
    state.energyTarget += 0.01;
    if (allow('terrain:mound')) {
      A.drum({ pitch: 52, gain: 0.35, bus: 'sfx' });
      notePlayed();
    }
    if (allow('terrain:mound-whoosh')) {
      tmp.copy(point).project(camera);
      A.whoosh({ from: 200, to: 600, dur: 1.5, gain: 0.05, pan: THREE.MathUtils.clamp(tmp.x, -1, 1) * 0.7 });
    }
  }

  const offs = [];
  offs.push(
    events.on('click:ground', ({ point }) => {
      if (!point) return;
      const inLoch = world.loch?.contains?.(point.x, point.z) ?? Math.hypot(point.x, point.z) < LAYOUT.loch.radius;
      if (inLoch) return; // the loch owns it
      const dm = Math.hypot(point.x - MOUND_CX, point.z - MOUND_CZ);
      if (dm < LAYOUT.mound.radius) moundTap(point);
      else groundTap(point);
    }),
  );
  offs.push(
    events.on('meteor:land', ({ point, inLoch }) => {
      if (inLoch || !point) return;
      ripple(point.x, point.z, 0.6, false); // §10.3: strength 0.6, no sound
    }),
  );
  offs.push(
    events.on('bealach:phase', (p) => {
      phase = p?.phase ?? 'idle';
      // Ambient only (exempt from the pure-T rule, §4.4 rule 6): the meadow stills in the hush and the pillar.
      windTarget = phase === 'hush' || phase === 'pillar' ? 0.25 : 1;
    }),
  );

  return {
    update(dt) {
      windValue += (windTarget - windValue) * (1 - Math.exp(-dt * 1.2));
      uWind.value = windValue * (ctx.reducedMotion ? 0.35 : 1);
    },
    onResize(w, h) {
      uViewportH.value = h * ctx.size.dpr;
    },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      for (const o of [ground, moundSet, hills, grass]) if (o) scene.remove(o);
      for (const o of [ground, moundSet]) {
        const i = world.groundMeshes.indexOf(o);
        if (i >= 0) world.groundMeshes.splice(i, 1);
      }
      moundSet.dispose();
      for (const d of disposables) d.dispose?.();
      if (world.heightAt === heightAt) world.heightAt = prevHeightAt;
      if (world.terrain?.ridgeY === ridgeY) delete world.terrain;
    },
  };
}
