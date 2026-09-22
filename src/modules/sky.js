// sky — sky & atmosphere owner (docs/DESIGN.md §10.2; also §2.2–2.3, §3.5–3.6, §4.3–4.4, §5, §6.2, §7, §11).
//
// Owns: dome (airglow + Milky Way), background stars, harp and named stars, kindled stars, meteors
// (Perseids and click meteors), wish-constellation arcs. Sole runtime writer of scene.fog colour/density,
// scene.background, ctx.bloom strength/radius/threshold and the ctx.grade uniforms. Writer of uOtherAngle.
// Publishes world.sky (API, band texture, star catalog and the GLSL chunk the loch compiles).
import * as THREE from 'three';
import { generateBand, sampleBand } from './sky/band-texture.js';
import {
  SKY_DECL,
  SKY_GLSL,
  DOME_VERT,
  DOME_FRAG,
  STARS_VERT,
  STARS_FRAG,
  KIND_VERT,
  KIND_FRAG,
  METEOR_VERT,
  METEOR_FRAG,
  ARC_VERT,
  ARC_FRAG,
} from './sky/glsl.js';

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
const PENTA = [0, 1, 3, 4, 5];
const SIDEREAL_100X = 7.29e-3; // rad/s
const POOL = 256;
const MAX_EMBER = 40;
const MAX_WISH = 96;
const MAX_ARCS = 48;
const ARC_SEG = 24;
const MAX_METEORS = 12;
const KIND = { harp: 0, ember: 1, wish: 2, named: 3, other: 4 }; // also the aState.w codes in KIND_VERT
const CAT_GAIN = 1.22; // catalog star intensity per unit mag (brightest catalog stars stay below saturation)
const KIND_GAIN = 1.6; // kindled/harp/named intensity per unit level·mag
const NAMED_MAG = (1.8 * CAT_GAIN) / KIND_GAIN; // Vega and Altair: 1.8× the brightest catalog star

// DESIGN-QUESTION (§10.2 acceptance 1 vs §2.3 #3 vs §10.3 acceptance 2): the airglow cannot satisfy all
// three. §2.3 #3 wants the horizon glow high enough for silhouettes; §10.3 acc 2 needs the sky 8 px above
// the mound crown (elevation ≈ 3.1°) to beat the lifted-black mound by ≥ 12 luma, i.e. ≈ 23 luma there;
// §10.2 acc 1 wants ≤ 20 luma on a 64 px grid above y = 250, whose lowest row (y = 224) is elevation
// ≈ 2.4° — below 3.1°, so it must be brighter still. Implemented as §3.5/§10.2 prose says (airglow × 0.8
// at the horizon falling to 0 by 12°, exponential); measured 44 luma at 0.5°, ~23 at 2.4°, ~15 at 3.1°.
// The acc-1 grid therefore reads 20–26 on the y = 224 row only (it passes for any grid phase that misses
// that row, e.g. y = 0/64/128/192). Reported rather than silently retuned.
//
// DESIGN-QUESTION (§3.5 climax-pose table): the harp stars are placed from the §3.2 formula
// (θ = 6.5 + 1.2k, β = harpStars.beta[k]) in the §7.3 climax frame. They then project 8 px right of the
// §3.5 climax-pose numbers (k0 at (680, 210) rather than (672, 210); k7 at (614, 72) rather than
// (606, 73)) — inside the ±40 px tolerance. Vega and Altair land exactly on their quoted climax-pose
// pixels, so the climax frame itself is right and the quoted harp column looks slightly stale.
//
// DESIGN-QUESTION (§10.2 acceptance 6): (640, 250) is the sky's drained channel, but at T = 20 it is also
// exactly where `bealach`'s river stream runs (§10.8 acc 2 measures the stream at x = 640). Sky's own
// contribution there measures 18 luma; with the stream drawn it is 240. Checked with bealach's objects
// hidden, the way §10.8 acc 1 samples the channel "clear of the stream" at (705, 185).
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// NAN-GUARD. `??` does not catch a NaN, and clamp() passes one through (both comparisons are false).
// Anything this module multiplies into a uniform is read through num() first: uBandGain multiplies
// every pixel of the Milky Way, so one non-finite input would blank the band — and then, through the
// bloom, the frame. Every fallback is the value's at-rest value, so nothing changes while inputs are
// finite (E, V and the afterglow are 0..1 by the core contract, T is −1 outside a climax).
const num = (x, d) => (Number.isFinite(x) ? x : d);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// ------------------------------------------------------------------------------------------------
// Pure functions of the climax clock T (§4.4 rule 6)

/**
 * uBandGain before the arrival fade: 0.2 rest, 0.28 pillar…river (×1.4), 0.26 return/afterglow (×1.3).
 * The ×1.4 is timed to `skyRotOfT` below rather than to the top of the pillar beat, so the band
 * brightens *as* it stands up instead of before it moves.
 */
function bandGainOfT(T) {
  if (T < 3) return 0.2;
  if (T < 26) return 0.2 + 0.08 * smoothstep(4.6, 7.4, T);
  if (T < 122) return 0.28 - 0.02 * smoothstep(26, 29, T);
  return 0.26 - 0.06 * smoothstep(122, 142, T);
}

/**
 * 0 → 1 slerp amount from the rest frame to the climax frame (pillar T 3–8, return T 26–31).
 *
 * §7.3 puts the slerp in T 3–8 and `bealach`'s camera tween in T 0–5, so a symmetric ease spends the
 * larger half of the band's travel underneath a moving camera, and the viewer reads the whole thing as
 * a camera move — the climax reviewer measured the apparent stand-up at almost nothing for exactly this
 * reason. The window is still 3–8 s, but the progress curve is back-loaded so ~95% of the travel happens
 * after T = 5, with the camera parked. The stones' second rolled strum at T = 5.4 (§7.3) then lands on
 * the start of the move rather than after it.
 */
function skyRotOfT(T, reduced) {
  if (reduced) return T >= 5.5 && T < 26.6 ? 1 : 0; // swapped while the band is faded out
  if (T < 3) return 0;
  if (T < 8) return easeInOutCubic(Math.pow((T - 3) / 5, 2.15));
  if (T < 26) return 1;
  if (T < 31) return 1 - easeInOutCubic((T - 26) / 5);
  return 0;
}

/** Reduced motion: fade the sky-anchored bodies out/in around the frame swaps. */
function skyFadeOfT(T, reduced) {
  if (!reduced || T < 3) return 1;
  if (T < 4.5) return 1 - smoothstep(3, 4.5, T);
  if (T < 6.5) return 0;
  if (T < 26) return smoothstep(6.5, 8, T);
  if (T < 26.6) return 1 - smoothstep(26, 26.6, T);
  return smoothstep(26.6, 27.4, T);
}

/** Twinkle factor: freezes over 0.5 s at hush, returns over 1 s at afterglow. */
function twinkleOfT(T) {
  if (T < 0) return 1;
  if (T < 32) return 1 - smoothstep(0, 0.5, T);
  return smoothstep(32, 33, T);
}

/** Bloom boost weight: 1 through pour, river and return, ramped over 1 s. */
function bloomWOfT(T) {
  return smoothstep(8, 9, T) * (1 - smoothstep(32, 33, T));
}

/** All wish and ember stars flare to 3 at T = 31, then return. */
function flare31OfT(T) {
  return smoothstep(30.6, 31, T) * (1 - smoothstep(31, 32.6, T));
}

function phaseOfT(T) {
  if (T < 0) return 'idle';
  if (T < 3) return 'hush';
  if (T < 8) return 'pillar';
  if (T < 16) return 'pour';
  if (T < 26) return 'river';
  if (T < 32) return 'return';
  if (T < 122) return 'afterglow';
  if (T < 142) return 'fade';
  return 'idle';
}

const OTHER_SPEED = { idle: 1, hush: 0, pillar: 0, pour: 0, river: 1, return: 0, afterglow: 0, fade: 1 };

// ------------------------------------------------------------------------------------------------

export default async function setup(ctx) {
  const { scene, camera, events, world, state } = ctx;
  const U = ctx.uniforms;
  U.uFireLevel ??= { value: 0 };
  U.uClimaxT ??= { value: -1 };
  U.uAfterglow ??= { value: 0 };
  U.uOtherAngle ??= { value: 0 };

  const low = ctx.quality === 'low';
  const reduced = !!ctx.reducedMotion;
  const pal = ctx.palette || {};
  const hex = (k, fallback) => pal[k] ?? fallback;
  const C = {
    peat: new THREE.Color(hex('peat', '#080D0C')),
    airglow: new THREE.Color(hex('airglow', '#2E3F2C')),
    boFinne: new THREE.Color(hex('boFinne', '#ECE4CF')),
    torc: new THREE.Color(hex('torc', '#D9A547')),
    verdigris: new THREE.Color(hex('verdigris', '#5FA08E')),
  };
  const BOFINNE_HEX = C.boFinne.getHex();
  const TORC_HEX = C.torc.getHex();
  const R_STAR = LAYOUT.sky.starRadius;
  const disposers = [];
  const debug = { bandMs: 0, meteors: 0, perseids: 0, landed: 0 };

  // ---------------------------------------------------------------- band frame and sky rotation
  const H0 = new THREE.Vector3().fromArray(LAYOUT.sky.bandFoot).normalize();
  const Nraw = new THREE.Vector3().fromArray(LAYOUT.sky.bandPole);
  const N0 = Nraw.clone().addScaledVector(H0, -Nraw.dot(H0)).normalize();
  const T0 = new THREE.Vector3().crossVectors(H0, N0).normalize(); // §3.5 T = normalize(cross(H, N))
  const H1 = new THREE.Vector3(0, 0, -1);
  const N1 = new THREE.Vector3().fromArray(LAYOUT.sky.bandPoleClimax).normalize();
  const T1 = new THREE.Vector3().crossVectors(H1, N1).normalize(); // (0, 1, 0)
  const m0 = new THREE.Matrix4().makeBasis(H0, T0, N0);
  const m1 = new THREE.Matrix4().makeBasis(H1, T1, N1);
  const qClimax = new THREE.Quaternion().setFromRotationMatrix(m1.multiply(m0.transpose()));
  const qIdentity = new THREE.Quaternion();
  const qSky = new THREE.Quaternion(); // live
  const qSkyInv = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const frame = { H: H0.clone(), T: T0.clone(), N: N0.clone() }; // live Vector3s (also the uniform values)
  const skyRot = new THREE.Matrix3();
  let skyRotAmount = -1;

  function applySkyRotation(s) {
    if (s === skyRotAmount) return;
    skyRotAmount = s;
    qSky.slerpQuaternions(qIdentity, qClimax, s);
    qSkyInv.copy(qSky).invert();
    skyRot.setFromMatrix4(m4.makeRotationFromQuaternion(qSky));
    frame.H.copy(H0).applyQuaternion(qSky);
    frame.T.copy(T0).applyQuaternion(qSky);
    frame.N.copy(N0).applyQuaternion(qSky);
    named.vega.copy(vegaBase).applyQuaternion(qSky);
    named.altair.copy(altairBase).applyQuaternion(qSky);
  }

  /** §3.5 dir(θ, β) = cosβ·(cosθ·H + sinθ·T) + sinβ·N, θ and β in degrees, live frame. */
  function dirOnBand(theta, beta, out = new THREE.Vector3()) {
    const th = (+theta || 0) * DEG;
    const be = (+beta || 0) * DEG;
    const cb = Math.cos(be);
    return out
      .copy(frame.H)
      .multiplyScalar(cb * Math.cos(th))
      .addScaledVector(frame.T, cb * Math.sin(th))
      .addScaledVector(frame.N, Math.sin(be));
  }
  function restDirOnBand(theta, beta, out) {
    const th = theta * DEG;
    const be = beta * DEG;
    const cb = Math.cos(be);
    return out.copy(H0).multiplyScalar(cb * Math.cos(th)).addScaledVector(T0, cb * Math.sin(th)).addScaledVector(N0, Math.sin(be));
  }

  const vegaBase = restDirOnBand(LAYOUT.sky.vega.theta, LAYOUT.sky.vega.beta, new THREE.Vector3());
  const altairBase = restDirOnBand(LAYOUT.sky.altair.theta, LAYOUT.sky.altair.beta, new THREE.Vector3());
  const named = { vega: vegaBase.clone(), altair: altairBase.clone() };

  // ---------------------------------------------------------------- band texture
  const band = generateBand({ width: low ? 1024 : 2048, height: low ? 96 : 192, rng: ctx.makeRng('sky-band') });
  debug.bandMs = Math.round(band.ms * 10) / 10;
  const bandTexture = new THREE.DataTexture(band.data, band.width, band.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  bandTexture.name = 'sky.band';
  bandTexture.wrapS = THREE.RepeatWrapping;
  bandTexture.wrapT = THREE.ClampToEdgeWrapping;
  bandTexture.magFilter = THREE.LinearFilter;
  bandTexture.minFilter = THREE.LinearFilter;
  bandTexture.generateMipmaps = false;
  bandTexture.flipY = false;
  bandTexture.needsUpdate = true;
  disposers.push(() => bandTexture.dispose());

  const skyUniforms = {
    uBandTex: { value: bandTexture },
    uBandH: { value: frame.H },
    uBandT: { value: frame.T },
    uBandN: { value: frame.N },
    uBandGain: { value: 0 },
  };
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

  // ---------------------------------------------------------------- dome
  const fogA = new THREE.Color(0x0e1511);
  const fogB = new THREE.Color(0x0f1a17);
  const domeFog = { value: fogA.clone() };
  const domeMat = new THREE.ShaderMaterial({
    name: 'sky.dome',
    uniforms: { ...shared(), ...skyUniforms, uPeat: { value: C.peat.clone() }, uFogColor: domeFog },
    vertexShader: DOME_VERT,
    fragmentShader: DOME_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const domeGeo = new THREE.SphereGeometry(LAYOUT.sky.radius, 64, 32);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.name = 'sky.dome';
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  scene.add(dome);
  disposers.push(() => {
    scene.remove(dome);
    domeGeo.dispose();
    domeMat.dispose();
  });

  // ---------------------------------------------------------------- background star catalog
  const catCount = low ? 2800 : 7000;
  const catalog = buildCatalog();
  const dprU = { value: ctx.size?.dpr ?? 1 };
  const skyRotU = { value: skyRot };
  const skyFadeU = { value: 1 };
  const twinkleU = { value: 0.1 };

  function buildCatalog() {
    const rng = ctx.makeRng('sky-stars');
    const gauss = () => {
      let u = 0;
      while (u < 1e-9) u = rng();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    };
    const warm = C.torc.clone().multiplyScalar(0.6).add(C.boFinne.clone().multiplyScalar(0.4));
    const avoid = [vegaBase, altairBase];
    const tmpD = new THREE.Vector3();
    for (let k = 0; k < 8; k++) {
      avoid.push(restDirOnBand(LAYOUT.sky.harpStars.theta0 + LAYOUT.sky.harpStars.dTheta * k, LAYOUT.sky.harpStars.beta[k], new THREE.Vector3()));
    }
    const cosAvoid = Math.cos(0.8 * DEG);
    const dirs = new Float32Array(catCount * 3);
    const mags = new Float32Array(catCount);
    const cols = new Float32Array(catCount * 3);
    const sinMin = Math.sin(-5 * DEG);
    let n = 0;
    let guard = 0;
    while (n < catCount && guard++ < catCount * 30) {
      if (rng() < 0.55) {
        // θ: band stars lean toward the bulge (θ ≈ 5°), but only a third of them — piling 60% of the
        // band population into the north foot spent them where the milk already outshines them, and
        // left the rest of the great circle (the setting limb near the south horizon, §3.5) bare
        const th = rng() < 0.34 ? 5 + gauss() * 30 : rng() * 360;
        const be = gauss() * 6;
        if (Math.abs(be) < 15) {
          // dust hides stars; bright star clouds hold more
          if (sampleBand(band, band.G, th, be) > 0.5 && rng() < 0.85) continue;
          if (rng() > 0.5 + 0.5 * sampleBand(band, band.R, th, be)) continue;
        }
        restDirOnBand(th, be, tmpD);
      } else {
        const y = sinMin + rng() * (1 - sinMin);
        const az = rng() * 2 * Math.PI;
        const r = Math.sqrt(Math.max(0, 1 - y * y));
        tmpD.set(r * Math.sin(az), y, -r * Math.cos(az));
      }
      let clash = false;
      for (let a = 0; a < avoid.length; a++) if (tmpD.dot(avoid[a]) > cosAvoid) clash = true;
      if (clash) continue;
      // power law (~2% above mag 0.5) with a soft knee instead of a hard clamp: a hard min(1, …) piles
      // ~60 stars at exactly the cap, which reads as a field of identical "brightest" stars and leaves
      // Vega and Altair (1.8× the brightest catalog star, §3.5) nothing to stand out against.
      // The knee is at 0.100 rather than 0.075: the sky away from the band and the foot is the only
      // subject those azimuths have (§3.7 pillar 1 — the sky is the protagonist), and at the old knee
      // its brightest 2% only reached 2.3 px, so a third of the canvas read as flat black-green.
      const mag = 1 - Math.exp(-0.100 * Math.pow(Math.max(rng(), 1e-6), -1 / 1.85));
      const t = Math.pow(rng(), 1.6) * 0.9;
      dirs[n * 3] = tmpD.x;
      dirs[n * 3 + 1] = tmpD.y;
      dirs[n * 3 + 2] = tmpD.z;
      mags[n] = mag;
      cols[n * 3] = C.boFinne.r + (warm.r - C.boFinne.r) * t;
      cols[n * 3 + 1] = C.boFinne.g + (warm.g - C.boFinne.g) * t;
      cols[n * 3 + 2] = C.boFinne.b + (warm.b - C.boFinne.b) * t;
      n++;
    }
    // sorted brightest first (loch takes the first 3000 / 900 for its trails)
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => mags[b] - mags[a]);
    const out = { count: n, dirs: new Float32Array(n * 3), mags: new Float32Array(n), colors: new Float32Array(n * 3) };
    for (let i = 0; i < n; i++) {
      const s = order[i];
      out.dirs.set(dirs.subarray(s * 3, s * 3 + 3), i * 3);
      out.colors.set(cols.subarray(s * 3, s * 3 + 3), i * 3);
      out.mags[i] = mags[s];
    }
    return out;
  }

  const starGeo = new THREE.BufferGeometry();
  {
    const n = catalog.count;
    const pos = new Float32Array(n * 3);
    const info = new Float32Array(n * 4);
    const rng = ctx.makeRng('sky-twinkle');
    for (let i = 0; i < n; i++) {
      pos[i * 3] = catalog.dirs[i * 3] * R_STAR;
      pos[i * 3 + 1] = catalog.dirs[i * 3 + 1] * R_STAR;
      pos[i * 3 + 2] = catalog.dirs[i * 3 + 2] * R_STAR;
      info[i * 4] = catalog.mags[i];
      info[i * 4 + 1] = 6.5 * Math.pow(i / n, 0.85); // dark adaptation: brightest first, all in by 8 s
      info[i * 4 + 2] = low && i >= n / 2 ? 0 : 1; // low: no twinkle on stars dimmer than the median
      info[i * 4 + 3] = rng();
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(catalog.colors, 3));
    starGeo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
  }
  const starMat = new THREE.ShaderMaterial({
    name: 'sky.stars',
    uniforms: {
      ...shared(),
      ...skyUniforms,
      uSkyRot: skyRotU,
      uTwinkle: twinkleU,
      uStarGain: { value: CAT_GAIN },
      uSkyFade: skyFadeU,
      uDpr: dprU,
    },
    vertexShader: STARS_VERT,
    fragmentShader: STARS_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.name = 'sky.stars';
  stars.frustumCulled = false;
  scene.add(stars);
  disposers.push(() => {
    scene.remove(stars);
    starGeo.dispose();
    starMat.dispose();
  });

  // ---------------------------------------------------------------- kindled stars (pool of 256)
  const kPos = new Float32Array(POOL * 3);
  const kCol = new Float32Array(POOL * 3);
  const kState = new Float32Array(POOL * 4);
  const kFlags = new Float32Array(POOL * 4);
  const slotId = new Int32Array(POOL).fill(-1);
  const slotKind = new Int8Array(POOL).fill(-1);
  const slotStamp = new Float64Array(POOL);
  const slotSeq = new Int32Array(POOL); // wish sequence number (arc bulge side)
  const idToSlot = new Map();
  let nextId = 1;
  let stampCounter = 0;
  let wishSeq = 0;
  const kindGeo = new THREE.BufferGeometry();
  const kPosAttr = new THREE.BufferAttribute(kPos, 3);
  const kColAttr = new THREE.BufferAttribute(kCol, 3);
  const kStateAttr = new THREE.BufferAttribute(kState, 4);
  const kFlagsAttr = new THREE.BufferAttribute(kFlags, 4);
  for (const a of [kPosAttr, kColAttr, kStateAttr, kFlagsAttr]) a.setUsage(THREE.DynamicDrawUsage);
  kindGeo.setAttribute('position', kPosAttr);
  kindGeo.setAttribute('aColor', kColAttr);
  kindGeo.setAttribute('aState', kStateAttr);
  kindGeo.setAttribute('aFlags', kFlagsAttr);
  const flare31U = { value: 0 };
  const kindMat = new THREE.ShaderMaterial({
    name: 'sky.kindled',
    uniforms: {
      ...shared(),
      uSkyRot: skyRotU,
      uKindGain: { value: KIND_GAIN },
      uSkyFade: skyFadeU,
      uFlare31: flare31U,
      uDpr: dprU,
      uTorc: { value: C.torc.clone() },
    },
    vertexShader: KIND_VERT,
    fragmentShader: KIND_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const kindled = new THREE.Points(kindGeo, kindMat);
  kindled.name = 'sky.kindled';
  kindled.frustumCulled = false;
  scene.add(kindled);
  disposers.push(() => {
    scene.remove(kindled);
    kindGeo.dispose();
    kindMat.dispose();
  });

  const colorTmp = new THREE.Color();
  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const fwd = new THREE.Vector3();

  function markPool(geoToo) {
    kStateAttr.needsUpdate = true;
    kFlagsAttr.needsUpdate = true;
    if (geoToo) {
      kPosAttr.needsUpdate = true;
      kColAttr.needsUpdate = true;
    }
  }

  function freeSlot(s) {
    const id = slotId[s];
    if (id >= 0) idToSlot.delete(id);
    slotId[s] = -1;
    slotKind[s] = -1;
    kFlags[s * 4 + 2] = 0;
  }

  function oldestSlot(pred) {
    let best = -1;
    let bestStamp = Infinity;
    for (let s = 0; s < POOL; s++) {
      if (slotId[s] < 0 || !pred(slotKind[s])) continue;
      if (slotStamp[s] < bestStamp) {
        bestStamp = slotStamp[s];
        best = s;
      }
    }
    return best;
  }

  function countKind(k) {
    let n = 0;
    for (let s = 0; s < POOL; s++) if (slotId[s] >= 0 && slotKind[s] === k) n++;
    return n;
  }

  function colorInput(c, fallbackHex) {
    if (c && c.isColor) return { color: colorTmp.copy(c), hex: c.getHex() };
    if (typeof c === 'number' || typeof c === 'string') {
      try {
        colorTmp.set(c);
        return { color: colorTmp, hex: typeof c === 'number' ? c : colorTmp.getHex() };
      } catch {
        /* fall through */
      }
    }
    colorTmp.setHex(fallbackHex);
    return { color: colorTmp, hex: fallbackHex };
  }

  /** Writes a star into a free pool slot. `restDir` is un-rotated for anchor 'sky'. Returns the slot. */
  function placeStar(kindCode, restDir, color, level, mag, anchorSky, onset, birth) {
    let s = -1;
    for (let i = 0; i < POOL; i++) {
      if (slotId[i] < 0) {
        s = i;
        break;
      }
    }
    if (s < 0) {
      s = oldestSlot((k) => k !== KIND.harp && k !== KIND.named);
      if (s < 0) return -1;
      const wasWish = slotKind[s] === KIND.wish;
      freeSlot(s);
      if (wasWish) arcsDirty = true;
    }
    const id = nextId++;
    slotId[s] = id;
    slotKind[s] = kindCode;
    slotStamp[s] = ++stampCounter;
    idToSlot.set(id, s);
    kPos[s * 3] = restDir.x * R_STAR;
    kPos[s * 3 + 1] = restDir.y * R_STAR;
    kPos[s * 3 + 2] = restDir.z * R_STAR;
    kCol[s * 3] = color.r;
    kCol[s * 3 + 1] = color.g;
    kCol[s * 3 + 2] = color.b;
    kState[s * 4] = level;
    kState[s * 4 + 1] = birth;
    kState[s * 4 + 2] = mag;
    kState[s * 4 + 3] = kindCode;
    kFlags[s * 4] = anchorSky ? 1 : 0;
    kFlags[s * 4 + 1] = onset;
    kFlags[s * 4 + 2] = 1;
    kFlags[s * 4 + 3] = (id * 0.6180339) % 1;
    if (kindCode === KIND.wish) {
      slotSeq[s] = wishSeq++;
      arcsDirty = true;
    }
    markPool(true);
    return s;
  }

  // ---------------------------------------------------------------- pickViewDir
  const pickRng = ctx.makeRng('sky-pick');
  const basis = { pitch: 0, az: 0, vHalf: 0, hHalf: 0 }; // reused: viewBasis() runs inside update()
  function viewBasis() {
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    basis.pitch = Math.asin(clamp(fwd.y, -1, 1));
    basis.az = Math.atan2(fwd.x, -fwd.z);
    basis.vHalf = (camera.getEffectiveFOV ? camera.getEffectiveFOV() : camera.fov) * 0.5 * DEG;
    // NAN-GUARD: camera.aspect is width/height, which is 0/0 = NaN while the canvas has no layout
    // yet. hHalf feeds pickViewDir(), whose direction other modules hand straight back to addStar().
    basis.hHalf = Math.atan(Math.tan(basis.vHalf) * Math.max(num(camera.aspect, 1), 1e-3));
    return basis;
  }
  /** Elevation (deg) of the top frame edge at a horizontal offset `a` (rad) from camera forward. */
  function topElevDeg(b, a) {
    const top = b.pitch + b.vHalf;
    if (top >= Math.PI / 2 - 1e-3) return 90;
    return Math.atan(Math.cos(a) * Math.tan(top)) / DEG;
  }
  function dirFromAzElev(az, elevDeg, out) {
    const e = elevDeg * DEG;
    const ce = Math.cos(e);
    return out.set(ce * Math.sin(az), Math.sin(e), -ce * Math.cos(az));
  }
  function minSepToKindled(d) {
    let best = -2;
    for (let s = 0; s < POOL; s++) {
      if (slotId[s] < 0) continue;
      vC.set(kPos[s * 3], kPos[s * 3 + 1], kPos[s * 3 + 2]).divideScalar(R_STAR);
      if (kFlags[s * 4] > 0.5) vC.applyQuaternion(qSky);
      const c = vC.dot(d);
      if (c > best) best = c;
    }
    return best; // cosine of the smallest separation
  }
  function pickViewDir(opts = {}) {
    const minE = Number.isFinite(opts.minElevDeg) ? opts.minElevDeg : 6;
    const maxE = Number.isFinite(opts.maxElevDeg) ? opts.maxElevDeg : 16;
    const b = viewBasis();
    const cosRej = Math.cos(2.5 * DEG);
    const out = new THREE.Vector3();
    let bestCos = 2;
    for (let tries = 0; tries < 12; tries++) {
      const a = (pickRng() * 2 - 1) * 0.8 * b.hHalf;
      const hi = Math.min(maxE, topElevDeg(b, a) - 2);
      const e = hi >= minE ? minE + pickRng() * (hi - minE) : minE;
      dirFromAzElev(b.az + a, e, vA);
      const c = minSepToKindled(vA);
      if (c < bestCos) {
        bestCos = c;
        out.copy(vA);
      }
      if (c < cosRej) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- API: stars
  const tmpProj = new THREE.Vector3();
  function isOnScreen(d) {
    camera.updateMatrixWorld();
    camera.getWorldDirection(fwd);
    if (d.dot(fwd) <= 0) return false;
    tmpProj.copy(d).multiplyScalar(R_STAR).add(camera.position).project(camera);
    return tmpProj.x >= -1 && tmpProj.x <= 1 && tmpProj.y >= -1 && tmpProj.y <= 1 && tmpProj.z < 1;
  }

  function addStar(dir, opts = {}) {
    opts = opts || {};
    const kindName = opts.kind === 'harp' || opts.kind === 'wish' || opts.kind === 'ember' ? opts.kind : 'ember';
    const kindCode = KIND[kindName];
    const d = new THREE.Vector3();
    if (dir && Number.isFinite(dir.x) && Number.isFinite(dir.y) && Number.isFinite(dir.z)) d.set(dir.x, dir.y, dir.z);
    if (d.lengthSq() < 1e-12) d.copy(pickViewDir());
    d.normalize();
    // NAN-GUARD: Vector3.normalize() divides by `length() || 1`, so it turns a zero vector into a
    // zero vector and leaves a non-finite one non-finite. A star direction becomes a vertex position,
    // and a non-finite one would take its point sprite (and anything the bloom touches) with it.
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y) || !Number.isFinite(d.z) || d.lengthSq() < 0.5) {
      d.set(0, 1, 0);
    }
    const anchorSky = opts.anchor ? opts.anchor === 'sky' : kindCode === KIND.harp;
    const mag = Number.isFinite(opts.mag) && opts.mag > 0 ? opts.mag : 1;
    const byAosSi = !!opts.byAosSi;
    const level = Number.isFinite(opts.level) ? clamp(opts.level, 0, 10) : kindCode === KIND.harp ? 0.5 : 1.2;
    const { color, hex: colorHex } = colorInput(opts.color, kindCode === KIND.harp ? BOFINNE_HEX : TORC_HEX);

    // caps: ember ≤ 40, wish ≤ 96 (oldest removed; its arc goes with it)
    if (kindCode === KIND.ember && countKind(KIND.ember) >= MAX_EMBER) removeSlot(oldestSlot((k) => k === KIND.ember));
    if (kindCode === KIND.wish && countKind(KIND.wish) >= MAX_WISH) removeSlot(oldestSlot((k) => k === KIND.wish));

    const rest = vB.copy(d);
    if (anchorSky) rest.applyQuaternion(qSkyInv);
    const s = placeStar(kindCode, rest, color, level, mag, anchorSky, setupDone ? -10 : 0, setupDone ? state.time : -10);
    if (s < 0) return -1;
    const id = slotId[s];
    events.emit('star:born', {
      id,
      dir: d.clone(),
      kind: kindName,
      color: colorHex,
      mag,
      onScreen: isOnScreen(d),
      byAosSi,
    });
    return id;
  }

  function removeSlot(s) {
    if (s < 0) return;
    const wasWish = slotKind[s] === KIND.wish;
    freeSlot(s);
    markPool(false);
    if (wasWish) arcsDirty = true;
  }

  function setStarLevel(id, level) {
    const s = idToSlot.get(id);
    if (s === undefined || !Number.isFinite(level)) return;
    const v = clamp(level, 0, 10);
    if (kState[s * 4] === v) return;
    kState[s * 4] = v;
    kStateAttr.needsUpdate = true;
  }

  function removeStar(id) {
    const s = idToSlot.get(id);
    if (s === undefined || slotKind[s] === KIND.named) return;
    removeSlot(s);
  }

  function starDir(id, out = new THREE.Vector3()) {
    const s = idToSlot.get(id);
    if (s === undefined) return out;
    out.set(kPos[s * 3], kPos[s * 3 + 1], kPos[s * 3 + 2]).divideScalar(R_STAR);
    if (kFlags[s * 4] > 0.5) out.applyQuaternion(qSky);
    return out;
  }

  // ---------------------------------------------------------------- wish arcs
  const arcVerts = MAX_ARCS * ARC_SEG * 2;
  const arcPos = new Float32Array(arcVerts * 3);
  const arcU = new Float32Array(arcVerts);
  const arcGeo = new THREE.BufferGeometry();
  const arcPosAttr = new THREE.BufferAttribute(arcPos, 3).setUsage(THREE.DynamicDrawUsage);
  const arcUAttr = new THREE.BufferAttribute(arcU, 1).setUsage(THREE.DynamicDrawUsage);
  arcGeo.setAttribute('position', arcPosAttr);
  arcGeo.setAttribute('aU', arcUAttr);
  arcGeo.setDrawRange(0, 0);
  const arcAlphaU = { value: 0 };
  const arcMat = new THREE.ShaderMaterial({
    name: 'sky.arcs',
    uniforms: { ...shared(), uArcAlpha: arcAlphaU, uTorc: { value: C.torc.clone() } },
    vertexShader: ARC_VERT,
    fragmentShader: ARC_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const arcs = new THREE.LineSegments(arcGeo, arcMat);
  arcs.name = 'sky.arcs';
  arcs.frustumCulled = false;
  arcs.visible = false;
  scene.add(arcs);
  disposers.push(() => {
    scene.remove(arcs);
    arcGeo.dispose();
    arcMat.dispose();
  });
  let arcsDirty = false;
  let arcCount = 0;
  const arcP = new THREE.Vector3();
  const arcEx = new THREE.Vector3();
  const arcPerp = new THREE.Vector3();
  const arcMid = new THREE.Vector3();
  const arcPts = Array.from({ length: ARC_SEG + 1 }, () => new THREE.Vector3());

  function rebuildArcs() {
    arcsDirty = false;
    const wishes = [];
    for (let s = 0; s < POOL; s++) if (slotId[s] >= 0 && slotKind[s] === KIND.wish) wishes.push(s);
    wishes.sort((a, b) => slotStamp[a] - slotStamp[b]);
    const links = Math.min(MAX_ARCS, Math.max(0, wishes.length - 1));
    const first = wishes.length - 1 - links;
    let v = 0;
    for (let l = 0; l < links; l++) {
      const sa = wishes[first + l];
      const sb = wishes[first + l + 1];
      starDir(slotId[sa], vA).multiplyScalar(R_STAR);
      starDir(slotId[sb], vB).multiplyScalar(R_STAR);
      arcEx.subVectors(vB, vA);
      const c = arcEx.length();
      if (c < 1e-3) continue;
      arcEx.divideScalar(c);
      arcMid.addVectors(vA, vB).multiplyScalar(0.5);
      // NAN-GUARD: the chord and the midpoint are perpendicular for two directions of equal length,
      // so the cross product only collapses for an exactly antipodal pair — which has no unique arc
      // plane. normalize() would hand back a zero vector and setLength() would put the whole arc on
      // the origin, so the link is skipped instead.
      arcPerp.crossVectors(arcEx, arcMid);
      if (arcPerp.lengthSq() < 1e-12) continue;
      arcPerp.normalize();
      const sign = slotSeq[sb] % 2 === 0 ? 1 : -1; // bulge alternates side along the chain
      const h = 0.18 * c;
      const rho = (c * c * 0.25 + h * h) / (2 * h);
      const phi0 = Math.asin(clamp((c * 0.5) / rho, -1, 1));
      for (let i = 0; i <= ARC_SEG; i++) {
        const phi = -phi0 + (2 * phi0 * i) / ARC_SEG;
        const x = rho * Math.sin(phi);
        const y = h - rho + rho * Math.cos(phi);
        arcPts[i].copy(arcMid).addScaledVector(arcEx, x).addScaledVector(arcPerp, y * sign).setLength(R_STAR);
      }
      for (let i = 0; i < ARC_SEG; i++) {
        arcPts[i].toArray(arcPos, v * 3);
        arcU[v++] = i / ARC_SEG;
        arcPts[i + 1].toArray(arcPos, v * 3);
        arcU[v++] = (i + 1) / ARC_SEG;
      }
    }
    arcCount = v / (ARC_SEG * 2);
    arcGeo.setDrawRange(0, v);
    arcPosAttr.needsUpdate = true;
    arcUAttr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- meteors
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const mA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_METEORS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const mB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_METEORS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const mInfo = new THREE.InstancedBufferAttribute(new Float32Array(MAX_METEORS * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const mParam = new THREE.InstancedBufferAttribute(new Float32Array(MAX_METEORS * 4), 4).setUsage(THREE.DynamicDrawUsage);
  quad.setAttribute('aA', mA);
  quad.setAttribute('aB', mB);
  quad.setAttribute('aInfo', mInfo);
  quad.setAttribute('aParam', mParam);
  quad.instanceCount = MAX_METEORS;
  const resU = { value: new THREE.Vector2(1, 1) };
  const meteorMat = new THREE.ShaderMaterial({
    name: 'sky.meteors',
    uniforms: { ...shared(), uRes: resU, uBoFinne: { value: C.boFinne.clone() }, uTorc: { value: C.torc.clone() } },
    vertexShader: METEOR_VERT,
    fragmentShader: METEOR_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const meteors = new THREE.Mesh(quad, meteorMat);
  meteors.name = 'sky.meteors';
  meteors.frustumCulled = false;
  meteors.visible = false;
  scene.add(meteors);
  disposers.push(() => {
    scene.remove(meteors);
    quad.dispose();
    meteorMat.dispose();
  });
  const meteorEnd = new Float32Array(MAX_METEORS); // state.time when each slot expires
  const landAt = new Float32Array(MAX_METEORS).fill(-1); // state.time of a pending loch landing
  const landPoint = Array.from({ length: MAX_METEORS }, () => new THREE.Vector3());
  const landInLoch = new Uint8Array(MAX_METEORS);
  const meteorRng = ctx.makeRng('sky-meteors');
  const radiant = dirFromAzElev(LAYOUT.sky.perseidRadiant.phi * DEG, LAYOUT.sky.perseidRadiant.elevDeg, new THREE.Vector3());

  function meteorSlot() {
    let best = 0;
    let bestEnd = Infinity;
    for (let i = 0; i < MAX_METEORS; i++) {
      if (landAt[i] >= 0) continue; // never steal a click meteor that still has to land
      if (meteorEnd[i] < bestEnd) {
        bestEnd = meteorEnd[i];
        best = i;
      }
    }
    return best;
  }

  function writeMeteor(i, a, b, t0, dur, kind, bright, zA, zB, tail, width) {
    // NAN-GUARD: the one choke point for both spawn paths. A click meteor's duration comes from the
    // conductor's music clock, i.e. from another module, and every one of these numbers ends up in an
    // instanced attribute that the vertex stage divides by or interpolates along. METEOR_VERT drops
    // an instance whose age is not a number, but a non-finite endpoint would still reach the geometry.
    t0 = num(t0, state.time);
    dur = Math.max(1e-3, num(dur, 0.9));
    bright = Math.max(0, num(bright, 1));
    zA = Math.max(1e-3, num(zA, 1));
    zB = Math.max(1e-3, num(zB, 1));
    tail = clamp(num(tail, 0.4), 0.01, 1);
    width = Math.max(0.1, num(width, 1));
    a.toArray(mA.array, i * 3);
    b.toArray(mB.array, i * 3);
    const I = mInfo.array;
    I[i * 4] = t0;
    I[i * 4 + 1] = dur;
    I[i * 4 + 2] = kind;
    I[i * 4 + 3] = bright;
    const P = mParam.array;
    P[i * 4] = zA;
    P[i * 4 + 1] = zB;
    P[i * 4 + 2] = tail;
    P[i * 4 + 3] = width;
    mA.needsUpdate = true;
    mB.needsUpdate = true;
    mInfo.needsUpdate = true;
    mParam.needsUpdate = true;
    meteorEnd[i] = t0 + dur;
    meteors.visible = true;
  }

  function spawnPerseid() {
    const b = viewBasis();
    const a = (meteorRng() * 2 - 1) * 0.95 * b.hHalf;
    const top = topElevDeg(b, a);
    const e = 2.5 + meteorRng() * Math.max(1, top + 1 - 2.5);
    dirFromAzElev(b.az + a, e, vA);
    const cosR = clamp(vA.dot(radiant), -1, 1);
    const ang = Math.acos(cosR);
    if (ang < 4 * DEG) return;
    vC.copy(vA).addScaledVector(radiant, -cosR).normalize(); // away from the radiant along the great circle
    const L = (4 + 9 * meteorRng()) * DEG * Math.max(0.3, Math.sin(ang));
    vB.copy(vA).multiplyScalar(Math.cos(L)).addScaledVector(vC, Math.sin(L)).multiplyScalar(1300);
    vA.multiplyScalar(1300);
    const i = meteorSlot();
    const dur = 0.4 + 0.4 * meteorRng();
    const bright = 0.35 + 0.45 * meteorRng() * meteorRng();
    writeMeteor(i, vA, vB, state.time, dur, 0, bright, 1, 1, 0.45, 1.1 * dprU.value);
    debug.perseids++;
  }

  const clickDir = new THREE.Vector3();
  function onSkyClick(p) {
    if (!p || !p.direction) return;
    clickDir.copy(p.direction).normalize();
    const A = ctx.audio;
    const M = world.music;
    // meteor head starts at camera + dir·600 and falls to a random loch point with r < 7
    vA.copy(camera.position).addScaledVector(clickDir, 600);
    const loch = world.loch;
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 8; tries++) {
      const r = 2.2 + 4.8 * Math.sqrt(meteorRng());
      const ph = meteorRng() * Math.PI * 2;
      x = r * Math.sin(ph);
      z = -r * Math.cos(ph);
      if (!loch?.contains || loch.contains(x, z)) break;
    }
    const inLoch = loch?.contains ? !!loch.contains(x, z) : Math.hypot(x, z) < LAYOUT.loch.radius;
    vB.set(x, LAYOUT.loch.level + 0.02, z);
    camera.getWorldDirection(fwd);
    const zA = Math.max(1, vC.subVectors(vA, camera.position).dot(fwd));
    const zB = Math.max(0.5, vC.subVectors(vB, camera.position).dot(fwd));

    // the landing is the sky's answer: it lands on the eighth grid, ≈ 0.9 s after the click
    let flight = 0.9;
    let when;
    if (M && typeof M.next === 'function' && typeof M.now === 'function') {
      const now = M.now();
      const eighth = M.eighth || 0.30303;
      when = M.next('eighth');
      let guard = 0;
      while (when - now < 0.9 - eighth * 0.5 && guard++ < 8) when += eighth;
      flight = clamp(num(when - now, 0.9), 0.6, 1.3);
    } else {
      when = (A?.now?.() ?? 0) + 0.9;
    }
    // NAN-GUARD: `when` is a Web Audio start time. A non-finite one throws a RangeError out of
    // AudioBufferSourceNode.start() (§10.2 wants a clean console), and the quantised grid it comes
    // from belongs to `conductor`. Fall back to the unquantised §6.2 landing, one flight from now.
    if (!Number.isFinite(when)) when = (A?.now?.() ?? 0) + flight;
    const i = meteorSlot();
    writeMeteor(i, vA, vB, state.time, flight, 1, 1, zA, zB, 0.34, 1.6 * dprU.value);
    landAt[i] = state.time + flight;
    landPoint[i].copy(vB);
    landPoint[i].y = LAYOUT.loch.level;
    landInLoch[i] = inLoch ? 1 : 0;
    debug.meteors++;

    state.energyTarget += 0.015;

    // sound: bell by elevation now, whoosh down, pluck on landing.
    // DESIGN-QUESTION (§6.1 vs §6.2): §6.1 says the sky's quantised answer falls back to A.now() + 0.35
    // when `music` is absent, but §6.2 fixes the meteor flight at 0.9 s. 0.35 would land the pluck 0.55 s
    // before the meteor hits the water, so the fallback here is A.now() + 0.9 (flight time), keeping
    // sound and picture together. With `music` present the landing is quantised to the eighth grid.
    tmpProj.copy(vA).project(camera);
    const pan = clamp(tmpProj.x, -1, 1) * 0.7;
    const elevDeg = Math.asin(clamp(clickDir.y, -1, 1)) / DEG;
    const degree = PENTA[Math.floor(clamp((elevDeg - 4) / 14, 0, 0.999) * 5)];
    const nowT = M?.now ? M.now() : (A?.now?.() ?? 0);
    if (A) {
      if (M?.allow?.('sky') ?? true) {
        A.bell(A.note(degree, 2), { gain: 0.1, pan });
        events.emit('note:played', { src: 'sky', degree, octave: 2, voice: 'bell', when: nowT, byAosSi: false });
      }
      if (M?.allow?.('sky-whoosh') ?? true) A.whoosh({ from: 2400, to: 400, dur: 0.9, gain: 0.07, pan });
      if (M?.allow?.('meteor') ?? true) {
        A.pluck(A.note(0, 0), { when, gain: 0.18, bright: 0.3, decay: 4 });
        events.emit('note:played', { src: 'sky', degree: 0, octave: 0, voice: 'pluck', when, byAosSi: false });
      }
    }
  }

  // ---------------------------------------------------------------- phase tracking & events
  let eventPhase = null;
  const offs = [];
  offs.push(events.on('click:sky', onSkyClick));
  offs.push(
    events.on('bealach:phase', (p) => {
      if (p && typeof p.phase === 'string') eventPhase = p.phase;
    }),
  );
  disposers.push(() => offs.forEach((off) => off()));

  // ---------------------------------------------------------------- harp and named stars
  let setupDone = false;
  const harpStarIds = [];
  {
    const hs = LAYOUT.sky.harpStars;
    for (let k = 0; k < 8; k++) {
      restDirOnBand(hs.theta0 + hs.dTheta * k, hs.beta[k], vA);
      harpStarIds.push(addStar(vA, { kind: 'harp', color: BOFINNE_HEX, mag: 1, anchor: 'sky', byAosSi: false }));
    }
    placeStar(KIND.named, vegaBase, C.boFinne, 1, NAMED_MAG, true, 0, -10);
    placeStar(KIND.named, altairBase, C.boFinne, 1, NAMED_MAG, true, 0, -10);
  }
  setupDone = true;

  // ---------------------------------------------------------------- atmosphere targets
  const bg = new THREE.Color().copy(C.peat);
  const prevBackground = scene.background;
  scene.background = bg;
  const TINT_A = [0x0a, 0x13, 0x10];
  const TINT_B = [0x0b, 0x1a, 0x15];
  const fogColorTmp = new THREE.Color();

  // ---------------------------------------------------------------- world.sky
  const api = {
    radius: LAYOUT.sky.radius,
    starRadius: R_STAR,
    frame,
    dirOnBand,
    addStar,
    setStarLevel,
    removeStar,
    starDir,
    harpStarIds,
    pickViewDir,
    bandTexture,
    catalog,
    glslDecl: SKY_DECL,
    glsl: SKY_GLSL,
    uniforms: skyUniforms,
    named,
    debug,
  };
  world.sky = api;

  // ---------------------------------------------------------------- per-frame
  let otherSpeed = 1;

  function update(dtRaw) {
    // NAN-GUARD: every value below is read from a shared object another module (or a debug URL) can
    // write, and every one of them is multiplied into a uniform this module owns. uBandGain is the
    // sharpest case — it scales the whole Milky Way, so a single NaN here blanks the band and then,
    // through the bloom's mips, the frame. See num() at the top of the file.
    const dt = clamp(num(dtRaw, 0), 0, 1);
    const T = num(U.uClimaxT.value, -1);
    const Aglow = clamp(num(U.uAfterglow.value, 0), 0, 1);
    const E = clamp(num(U.uEnergy?.value ?? state.energy, 0), 0, 1);
    const V = clamp(num(U.uVeil?.value ?? state.veil, 0), 0, 1);

    // sky rotation (pure function of T)
    applySkyRotation(skyRotOfT(T, reduced));
    const fade = skyFadeOfT(T, reduced);
    skyFadeU.value = fade;
    // Arrival (§7.1 "the Milky Way fades in from 2 to 8 s") — but from a floor, not from nothing. §2.2
    // puts "a soft boFinne Milky Way (band gain 0.2)" in the frame for the whole 0–10 s arrival phase,
    // and the object the piece is named after should not be absent from its own first frame: the
    // dark-adaptation idea is that detail arrives as the eye opens, not that the band is conjured out of
    // an empty sky. So the band is present at ~⅓ strength from frame one and gains its lanes and knots
    // over the 8 s. The per-magnitude star fade (aInfo.y in STARS_VERT) is untouched.
    // Only outside a climax cycle, which can never begin before 45 s except through the ?phaseT debug
    // jump (it must then render as a pure function of T).
    const arrival = T >= 0 ? 1 : 0.32 + 0.68 * smoothstep(0, 8, num(state.time, 0));
    skyUniforms.uBandGain.value = bandGainOfT(T) * arrival * fade;
    flare31U.value = flare31OfT(T);
    // NAN-GUARD: dpr divides nothing here but it scales every point size and sigma, and uRes is a
    // divisor in METEOR_VERT; a hidden or not-yet-laid-out canvas reports 0 for width and height.
    dprU.value = Math.max(num(ctx.size?.dpr, 1), 1e-3);
    resU.value.set(Math.max(num(ctx.size?.width, 1), 1) * dprU.value, Math.max(num(ctx.size?.height, 1), 1) * dprU.value);

    // twinkle (§4.3): 0.10 → 0.35 with E, ×(1 − 0.6·V), frozen in the climax, off with reduced motion
    twinkleU.value = reduced ? 0 : (0.1 + 0.25 * E) * (1 - 0.6 * V) * twinkleOfT(T);

    // uOtherAngle: 100× sidereal, speed factor by phase, ramped over 1 s (ambient: accumulates)
    const phase = world.bealach?.phase ?? eventPhase ?? phaseOfT(T);
    const target = OTHER_SPEED[phase] ?? 1;
    const step = dt; // 1 s ramp
    otherSpeed += clamp(target - otherSpeed, -step, step);
    // wrapped to one turn: the angle only ever feeds sin/cos (loch's Rodrigues rotation), and a value
    // that grows without bound would lose float32 precision in the water shader after a few hours
    U.uOtherAngle.value = (U.uOtherAngle.value + otherSpeed * SIDEREAL_100X * dt) % (Math.PI * 2);

    // Perseids: 0.02 → 0.22 per s with E; stopped from hush until the afterglow
    if (T < 0 || T >= 32) {
      const rate = 0.02 + 0.2 * E;
      if (meteorRng() < rate * dt) spawnPerseid();
    }

    // click meteors landing
    for (let i = 0; i < MAX_METEORS; i++) {
      if (landAt[i] >= 0 && state.time >= landAt[i]) {
        landAt[i] = -1;
        debug.landed++;
        events.emit('meteor:land', { point: landPoint[i].clone(), inLoch: landInLoch[i] === 1, strength: 1 });
      }
    }
    if (meteors.visible) {
      let any = false;
      for (let i = 0; i < MAX_METEORS; i++) if (meteorEnd[i] > state.time || landAt[i] >= 0) any = true;
      if (!any) meteors.visible = false;
    }

    // wish arcs
    if (arcsDirty) rebuildArcs();
    const arcAlpha = 0.35 * Math.max(V, Aglow);
    arcAlphaU.value = arcAlpha;
    arcs.visible = arcAlpha > 0.002 && arcCount > 0;

    // ------------------------------------------------ atmosphere automation (sole writer)
    const bloom = ctx.bloom;
    if (bloom) {
      bloom.strength = 0.75 + 0.2 * E + 0.25 * bloomWOfT(T);
      bloom.threshold = 0.85;
      bloom.radius = 0.5;
    }
    fogColorTmp.lerpColors(fogA, fogB, clamp(V, 0, 1));
    domeFog.value.copy(fogColorTmp);
    const fog = scene.fog;
    if (fog) {
      fog.color.copy(fogColorTmp);
      if ('density' in fog) fog.density = 0.0022;
    }
    if (scene.background !== bg) scene.background = bg;
    const g = ctx.grade;
    if (g) {
      const m = clamp(Math.max(V, Aglow), 0, 1);
      g.uTint?.value?.setRGB(
        (TINT_A[0] + (TINT_B[0] - TINT_A[0]) * m) / 255,
        (TINT_A[1] + (TINT_B[1] - TINT_A[1]) * m) / 255,
        (TINT_A[2] + (TINT_B[2] - TINT_A[2]) * m) / 255,
      );
      if (g.uLift) g.uLift.value = 0.6 + 0.3 * Aglow;
      if (g.uGrain) g.uGrain.value = 0.03;
      if (g.uVignette) g.uVignette.value = 0.4;
    }
  }

  function dispose() {
    for (let i = disposers.length - 1; i >= 0; i--) {
      try {
        disposers[i]();
      } catch (err) {
        console.error('[sky] dispose step failed', err);
      }
    }
    if (scene.background === bg) scene.background = prevBackground ?? null;
    if (world.sky === api) delete world.sky;
  }

  return { update, dispose };
}
