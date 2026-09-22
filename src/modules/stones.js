// stones — the Cork–Kerry axial stone circle as a harp strung to stars (docs/DESIGN.md §10.6).
// Owns: the 11 stones, ogham notches, harp threads, harp-star levels, stone tap/hold/key/deiseal responses,
// idle blink and beckon, climax strums and ring-wave, ghost stone offerings. No reflections (R9).
import * as THREE from 'three';
import {
  buildOghamAtlas,
  layoutInscription,
  parseOgham,
  PORTAL_OGHAM,
  HARP_OGHAM,
  RECUMBENT_OGHAM,
} from './stones/ogham.js';
import { STONE_VERT, STONE_FRAG, THREAD_VERT, THREAD_FRAG } from './stones/shaders.js';

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
const N_STONES = LAYOUT.stones.length; // 11
const HARP_IDS = [1, 2, 3, 4, 6, 7, 8, 9]; // harp stone k → stone id
const PORTAL_IDS = [0, 10];
const RECUMBENT_ID = 5;
const BURIAL = 0.3;
const EIGHTH = 60 / 66 / 3; // dotted quarter = 66 → eighth 0.30303 s (§8.2)
const BEAT = 3 * EIGHTH;
const RING_TAP_DECAY = 10; // s, linear decay from level 1 (§6.2)
const RING_HOLD_DECAY = 20; // s
const HOLD_PLUCK_MAX = 3; // s
const THREAD_SEGMENTS = 48;
const STRUM_KS = [0, 2, 4, 5, 7]; // pillar G/D roll (§7.3)
const STRUM_TIMES = [3.0, 5.4];
const WAVE_T0 = 17; // ring-wave start, one 9/8 eighth apart
// Seeded end of each thread's drawn run when the whole harp rings at once (see threadC.z in update()).
const REACH = [0.66, 0.52, 0.76, 0.58, 0.70, 0.55, 0.79, 0.62];

export default async function setup(ctx) {
  const { scene, camera, events, world, state } = ctx;
  const A = ctx.audio;
  const U = ctx.uniforms;
  U.uFireLevel ??= { value: 0 };
  U.uClimaxT ??= { value: -1 };
  U.uAfterglow ??= { value: 0 };
  U.uOtherAngle ??= { value: 0 };

  const rng = ctx.makeRng('stones');
  const low = ctx.quality === 'low';
  const reduced = !!ctx.reducedMotion;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const P = ctx.palette;
  const torc = new THREE.Color(P.torc);
  const verdigris = new THREE.Color(P.verdigris);
  const lichen = new THREE.Color(P.lichen);
  const boFinne = new THREE.Color(P.boFinne);

  // ------------------------------------------------------------------------------------------
  // Placement
  // ------------------------------------------------------------------------------------------
  function bankAt(x, z) {
    const h = world.heightAt ? world.heightAt(x, z) : NaN;
    // Core's default heightAt is a flat 0; only trust it when terrain has registered itself (fallback 0.8, §10.6).
    if (Number.isFinite(h) && (world.terrain || Math.abs(h) > 1e-6)) return h;
    return LAYOUT.circle.bankCrest;
  }

  const refCam = camera.position.clone();
  const bases = [];
  const tops = [];
  const matrices = [];
  const quats = [];
  const stoneInfo = [];
  const ex = new THREE.Vector3();
  const ey = new THREE.Vector3(0, 1, 0);
  const ez = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const qBasis = new THREE.Quaternion();
  const qYaw = new THREE.Quaternion();
  const qLean = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  for (const s of LAYOUT.stones) {
    const phi = s.phi * DEG;
    const r = LAYOUT.circle.radius;
    const x = r * Math.sin(phi);
    const z = -r * Math.cos(phi);
    const bank = bankAt(x, z);
    const isRecumbent = s.role === 'recumbent';
    const Ht = s.h + BURIAL;

    // Broad face toward the centre: local x = sunwise tangent, y = up, z = inward.
    ex.set(Math.cos(phi), 0, Math.sin(phi));
    ez.set(-Math.sin(phi), 0, Math.cos(phi));
    basis.makeBasis(ex, ey, ez);
    qBasis.setFromRotationMatrix(basis);
    const yaw = (rng() * 2 - 1) * (isRecumbent || s.role === 'portal' ? 2 : 4) * DEG;
    qYaw.setFromAxisAngle(ey, yaw);
    // Lean ≤ 4°, biased gently outward (settled stones lean away from the ring's centre).
    const isPortal = s.role === 'portal';
    const leanMag = (isRecumbent ? 0.8 : isPortal ? 0.6 + rng() * 0.6 : 1.2 + rng() * 2.4) * DEG;
    const leanDir = (rng() * 2 - 1) * (isPortal ? 0.25 : 1.1) + Math.PI; // top tilts toward local (sin, 0, cos): ≈ −z, outward
    axis.crossVectors(ey, ex.set(Math.sin(leanDir), 0, Math.cos(leanDir))).normalize();
    qLean.setFromAxisAngle(axis, leanMag);
    const quat = new THREE.Quaternion().copy(qBasis).multiply(qYaw).multiply(qLean);
    const pos = new THREE.Vector3(x, bank - BURIAL, z);
    const m = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1));
    matrices.push(m);
    quats.push(quat);
    bases.push(new THREE.Vector3(x, bank, z));
    tops.push(new THREE.Vector3(0, Ht, 0).applyMatrix4(m));

    // Shape: top ≈ 70% of base width, weathered crown (round / slanted / gabled), some broken shoulders.
    // [topWidth, roundness, slant] and [gable, gableOffset, chipSide, topThickness]
    let shape;
    let shape2;
    if (s.role === 'portal') {
      // The portals frame the Milky Way foot: tall, their tops leaning away from the gap.
      const away = s.id === 0 ? 1 : -1;
      shape = [0.7 + rng() * 0.04, 0.2 + rng() * 0.1, away * (0.14 + rng() * 0.08)];
      shape2 = [0.1 + rng() * 0.1, -away * 0.25, 0, 0.72];
    } else if (isRecumbent) {
      // A big level-topped block lying tangent to the ring, ends broken back a little.
      shape = [0.88, 0.1, (rng() * 2 - 1) * 0.03];
      shape2 = [0, 0, 0, 0.93];
    } else {
      const style = rng();
      const slant = (rng() * 2 - 1) * 0.3;
      if (style < 0.35) shape2 = [0.35 + rng() * 0.25, (rng() * 2 - 1) * 0.4, 0, 0.7]; // gabled
      else if (style < 0.65) shape2 = [0.05, 0, rng() < 0.5 ? -1 : 1, 0.74]; // broken shoulder
      else shape2 = [0.08, 0, 0, 0.68]; // round
      shape = [0.64 + rng() * 0.1, 0.22 + rng() * 0.22, slant];
    }
    stoneInfo.push({ ...s, Ht, bank, shape, shape2, seed: rng() * 10 + 1, isRecumbent, k: HARP_IDS.indexOf(s.id) });
  }

  // ------------------------------------------------------------------------------------------
  // Ogham inscriptions and atlas
  // ------------------------------------------------------------------------------------------
  // Each upright is inscribed up one vertical arris of its inner face; the portals use their gap-side arrises,
  // the east-half harp stones their south-side arris, the west half likewise. The recumbent is inscribed along
  // its top inner arris (a vertical arris 1.1 m tall cannot carry TINE legibly).
  const faceNormal = new THREE.Vector3();
  const faceCentre = new THREE.Vector3();
  const toRef = new THREE.Vector3();
  function faceVisibility(info, localNormal, localCentre) {
    const m = matrices[info.id];
    faceNormal.copy(localNormal).applyQuaternion(quats[info.id]);
    faceCentre.copy(localCentre).applyMatrix4(m);
    toRef.subVectors(refCam, faceCentre).normalize();
    return faceNormal.dot(toRef);
  }

  const oghamCells = [];
  const inscriptions = [];
  for (const info of stoneInfo) {
    let glyphs;
    let edgeSign;
    if (info.role === 'portal') {
      glyphs = PORTAL_OGHAM;
      edgeSign = info.id === 0 ? -1 : 1;
    } else if (info.isRecumbent) {
      glyphs = RECUMBENT_OGHAM;
      edgeSign = 0;
    } else {
      glyphs = HARP_OGHAM[info.k];
      edgeSign = info.phi < 180 ? 1 : -1;
    }
    const letters = parseOgham(glyphs);
    let layout;
    let visA;
    let visB;
    if (edgeSign !== 0) {
      const halfW = info.w * 0.5;
      const availStart = BURIAL + Math.max(0.3, 0.12 * info.h);
      const availEnd = info.Ht - 0.45;
      layout = layoutInscription(letters, availStart, availEnd, letters.length === 1 ? 0.3 : 0);
      const mid = (layout.start + layout.end) * 0.5;
      visA = faceVisibility(info, new THREE.Vector3(0, 0, 1), new THREE.Vector3(edgeSign * halfW * 0.6, mid, info.t * 0.5));
      visB = faceVisibility(info, new THREE.Vector3(edgeSign, 0, 0), new THREE.Vector3(edgeSign * halfW * 0.85, mid, info.t * 0.2));
    } else {
      layout = layoutInscription(letters, 0.3, info.w - 0.3, 0.5);
      visA = faceVisibility(info, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, info.Ht * 0.8, info.t * 0.5));
      visB = faceVisibility(info, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, info.Ht, info.t * 0.2));
    }
    // Beithe strokes go to one face of the arris, hÚatha to the other: give Beithe the face the viewer sees more of
    // from the default camera, so single-letter harp stones (Beithe k0–k4) show their notches.
    const beitheOnA = letters.some((l) => l.aicme === 'H') && !letters.some((l) => l.aicme === 'B') ? visA < visB : visA >= visB;
    oghamCells.push({ strokes: layout.strokes, beitheSide: beitheOnA ? 1 : -1 });
    inscriptions.push({ edgeSign, start: layout.start, end: layout.end, glyphs });
  }
  const atlas = buildOghamAtlas(oghamCells, ctx.renderer);

  // ------------------------------------------------------------------------------------------
  // Stones mesh
  // ------------------------------------------------------------------------------------------
  const seg = low ? [4, 6, 2] : [8, 12, 4];
  const stoneGeo = new THREE.BoxGeometry(1, 1, 1, seg[0], seg[1], seg[2]);
  stoneGeo.deleteAttribute('normal');
  stoneGeo.deleteAttribute('uv');
  const aDims = new Float32Array(N_STONES * 4);
  const aShape = new Float32Array(N_STONES * 4);
  const aShape2 = new Float32Array(N_STONES * 4);
  const aOgham = new Float32Array(N_STONES * 4);
  stoneInfo.forEach((info, i) => {
    aDims.set([info.w, info.Ht, info.t, info.id], i * 4);
    aShape.set([info.shape[0], info.shape[1], info.shape[2], info.seed], i * 4);
    aShape2.set(info.shape2, i * 4);
    aOgham.set([inscriptions[i].edgeSign, inscriptions[i].start, inscriptions[i].end, info.role === 'portal' ? 1 : 0], i * 4);
  });
  stoneGeo.setAttribute('aDims', new THREE.InstancedBufferAttribute(aDims, 4));
  stoneGeo.setAttribute('aShape', new THREE.InstancedBufferAttribute(aShape, 4));
  stoneGeo.setAttribute('aShape2', new THREE.InstancedBufferAttribute(aShape2, 4));
  stoneGeo.setAttribute('aOgham', new THREE.InstancedBufferAttribute(aOgham, 4));

  const glowA = new Float32Array(N_STONES * 4);
  const fxArr = new Float32Array(N_STONES * 4);
  for (let i = 0; i < N_STONES; i++) {
    glowA[i * 4 + 2] = -1e4;
    fxArr[i * 4 + 2] = -1e4;
  }

  const stoneMat = new THREE.ShaderMaterial({
    name: 'stones:slabs',
    vertexShader: STONE_VERT,
    fragmentShader: STONE_FRAG,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uTime: U.uTime,
      uEnergy: U.uEnergy,
      uVeil: U.uVeil,
      uFirePos: U.uFirePos,
      uFireLevel: U.uFireLevel,
      uClimaxT: U.uClimaxT,
      uAfterglow: U.uAfterglow,
      uOtherAngle: U.uOtherAngle,
      uOgham: { value: atlas.texture },
      uGlowA: { value: glowA },
      uFx: { value: fxArr },
      uLichen: { value: lichen },
      uTorc: { value: torc },
      uBoFinne: { value: boFinne },
    },
  });
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, N_STONES);
  stones.name = 'stones:slabs';
  matrices.forEach((m, i) => stones.setMatrixAt(i, m));
  stones.instanceMatrix.needsUpdate = true;
  stones.frustumCulled = false; // shape is built in the vertex shader; the unit-box bounds would cull wrongly
  scene.add(stones);

  // ------------------------------------------------------------------------------------------
  // Threads
  // ------------------------------------------------------------------------------------------
  const vPerThread = (THREAD_SEGMENTS + 1) * 2;
  const tPos = new Float32Array(8 * vPerThread * 3);
  const tK = new Float32Array(8 * vPerThread);
  const tU = new Float32Array(8 * vPerThread);
  const tSide = new Float32Array(8 * vPerThread);
  const tIndex = [];
  for (let k = 0; k < 8; k++) {
    const base = k * vPerThread;
    for (let j = 0; j <= THREAD_SEGMENTS; j++) {
      for (let sd = 0; sd < 2; sd++) {
        const v = base + j * 2 + sd;
        tK[v] = k;
        tU[v] = j / THREAD_SEGMENTS;
        tSide[v] = sd === 0 ? -1 : 1;
      }
      if (j < THREAD_SEGMENTS) {
        const a = base + j * 2;
        // Counter-clockwise on screen: side −1 is to the right of the stone→star direction.
        tIndex.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const threadGeo = new THREE.BufferGeometry();
  threadGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  threadGeo.setAttribute('aK', new THREE.BufferAttribute(tK, 1));
  threadGeo.setAttribute('aU', new THREE.BufferAttribute(tU, 1));
  threadGeo.setAttribute('aSide', new THREE.BufferAttribute(tSide, 1));
  threadGeo.setIndex(tIndex);

  const topArr = new Float32Array(24);
  const starArr = new Float32Array(24);
  const threadA = new Float32Array(32);
  const threadB = new Float32Array(32);
  const threadC = new Float32Array(32);
  HARP_IDS.forEach((id, k) => {
    topArr.set([tops[id].x, tops[id].y, tops[id].z], k * 3);
    threadA[k * 4 + 1] = 1;
    threadA[k * 4 + 3] = -1e4;
    threadB[k * 4 + 1] = -1;
    threadB[k * 4 + 2] = -1e4;
    threadB[k * 4 + 3] = 1;
    threadC[k * 4 + 2] = 1; // full reach until update() trims it for crowding
  });
  const resolution = new THREE.Vector2(1, 1);
  // Device pixels per CSS pixel. THREAD_FRAG divides by it, so it must never reach 0.
  const devicePx = () => Math.max(0.25, ctx.size.dpr || 1);
  const threadMat = new THREE.ShaderMaterial({
    name: 'stones:threads',
    vertexShader: THREAD_VERT,
    fragmentShader: THREAD_FRAG,
    fog: false,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.uTime,
      uTop: { value: topArr },
      uStar: { value: starArr },
      uThreadA: { value: threadA },
      uThreadB: { value: threadB },
      uThreadC: { value: threadC },
      uResolution: { value: resolution },
      uPx: { value: devicePx() },
      uMotion: { value: reduced ? 0 : 1 },
      uTorc: { value: torc },
      uVerdigris: { value: verdigris },
    },
  });
  const threads = new THREE.Mesh(threadGeo, threadMat);
  threads.name = 'stones:threads';
  threads.frustumCulled = false;
  threads.renderOrder = 5;
  threads.visible = false;
  scene.add(threads);

  // ------------------------------------------------------------------------------------------
  // Proxies (invisible pickables, §10.0 / §6.1)
  // ------------------------------------------------------------------------------------------
  const proxyGroup = new THREE.Group();
  proxyGroup.name = 'stones:proxies';
  const proxyGeo = new THREE.BoxGeometry(1, 1, 1);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxies = [];
  const removers = [];
  const hoverTarget = new Float32Array(N_STONES);
  const hover = new Float32Array(N_STONES);
  // The hit shape grows in width and thickness only (§6.1: "height unchanged"). Growing it in height is
  // what let k4's proxy swallow k5: the two stand almost on the same screen column, and the nearer box
  // wins the ray. Clamping the box top to the stone's crown is not enough either — the camera looks down
  // on the box's top face, so its far corners still project above the crown. So the top is solved here:
  // the box is made exactly as tall as it can be without any of its corners projecting above the stone's
  // own crown at the default camera, which is the frame §10.0 judges proxy overlap in.
  const refTarget = new THREE.Vector3(0, 2.5, 0);
  const refVP = new THREE.Matrix4()
    .lookAt(refCam, refTarget, ey)
    .setPosition(refCam)
    .invert()
    .premultiply(camera.projectionMatrix);
  const PROXY_BOTTOM = 0.1; // m of proxy below the turf line
  const corner = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const tmpProxy = new THREE.Vector3();
  /** Highest NDC y reached by any corner of stone i's proxy box when its top face sits at topY. */
  function proxyTopNdc(i, info, ws, ts, topY) {
    const bottom = info.bank - PROXY_BOTTOM;
    const hgt = Math.max(0.2, topY - bottom);
    centre.set(bases[i].x, bottom + hgt * 0.5, bases[i].z);
    let maxY = -Infinity;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) {
        for (let sz = -1; sz <= 1; sz += 2) {
          corner
            .set(sx * 0.5 * info.w * ws, sy * 0.5 * hgt, sz * 0.5 * info.t * ts)
            .applyQuaternion(quats[i])
            .add(centre)
            .applyMatrix4(refVP);
          if (corner.y > maxY) maxY = corner.y;
        }
      }
    }
    return maxY;
  }
  stoneInfo.forEach((info, i) => {
    const mesh = new THREE.Mesh(proxyGeo, proxyMat);
    mesh.name = `stones:proxy:${i}`;
    const widthScale = coarse && i !== 3 && i !== 4 ? 2.2 : 1.6;
    const thickScale = 1.35;
    const crownNdc = tmpProxy.copy(tops[info.id]).applyMatrix4(refVP).y;
    let hi = info.bank + info.h + 0.2;
    let lo = info.bank + info.h * 0.72; // never give up more than the top quarter of the stone
    if (proxyTopNdc(i, info, widthScale, thickScale, hi) > crownNdc) {
      for (let it = 0; it < 16; it++) {
        const mid = (lo + hi) * 0.5;
        if (proxyTopNdc(i, info, widthScale, thickScale, mid) > crownNdc) hi = mid;
        else lo = mid;
      }
      hi = lo;
    }
    const bottom = info.bank - PROXY_BOTTOM;
    const hgt = Math.max(0.3, hi - bottom);
    mesh.scale.set(info.w * widthScale, hgt, info.t * thickScale);
    mesh.quaternion.copy(quats[i]);
    mesh.position.set(bases[i].x, bottom + hgt * 0.5, bases[i].z);
    mesh.userData.stoneId = i;
    proxyGroup.add(mesh);
    proxies.push(mesh);
  });
  scene.add(proxyGroup);
  proxyGroup.updateMatrixWorld(true);
  proxies.forEach((mesh, i) => {
    removers.push(
      ctx.input.addPickable(mesh, {
        onClick: () => tapStone(i, ctx.input.pointer.x * 0.7),
        onHover: () => {
          hoverTarget[i] = 1;
        },
        onHoverEnd: () => {
          hoverTarget[i] = 0;
        },
      }),
    );
  });

  // ------------------------------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------------------------------
  const ringing = new Float32Array(N_STONES);
  const decayRate = new Float32Array(N_STONES); // level per second
  const ringStart = new Float64Array(N_STONES).fill(-1e4);
  const ghostScale = new Float32Array(N_STONES).fill(1);
  const flickerStart = new Float64Array(N_STONES).fill(-1e4);
  let recumbentLineStart = -1e4;

  // per harp k
  const revealStart = new Float64Array(8).fill(-1e4);
  const snapStart = new Float64Array(8).fill(-1);
  const sparkStart = new Float64Array(8).fill(-1e4);
  const sparkDur = new Float32Array(8).fill(1);
  const sparkI = new Float32Array(8);
  const sparkGhost = new Float32Array(8);
  const ghostTintUntil = new Float64Array(8).fill(-1e4);
  const starGate = new Float64Array(8).fill(-1e4);
  const starPre = new Float32Array(8).fill(0.5);
  const starFlareAt = new Float64Array(8).fill(-1e4);
  const starFlarePeak = new Float32Array(8).fill(3);
  const starShown = new Float32Array(8).fill(0.5);
  const starSent = new Float32Array(8).fill(0.5);
  const holdAmt = new Float32Array(8);
  const wasVisible = new Uint8Array(8);
  const beckonAlpha = new Float32Array(8);
  const threadLvl = new Float32Array(8);

  const hold = { active: false, k: -1, id: -1, startT: 0, nextVis: 0, nextWhen: 0, token: 0, pan: 0, releasedAt: -1e4 };
  let pendingRelease = null; // direct-act release when bealach is absent
  let firstStoneOffering = false;
  let beckonOn = false;
  let centreK = 7;
  let lastBeatAt = -1e4;
  let prevBeatAt = -1e4;
  let lastDownAt = -1e4;
  let prevDownAt = -1e4;
  let lastIdleSpark = 0;
  let crowdSmooth = 0;
  let internalNextBeat = BEAT;
  let internalBeatIndex = 0;
  let lastT = -1;
  let phase = 'idle';
  const holdRelease = new Float64Array(8).fill(-1e4);

  // Deiseal strum queue (fixed pool; triggered from update so voice-starts spread over the strum).
  const Q = 16;
  const qActive = new Uint8Array(Q);
  const qK = new Int8Array(Q);
  const qVis = new Float64Array(Q);
  const qWhen = new Float64Array(Q);
  const qAudio = new Uint8Array(Q);
  const qVisDone = new Uint8Array(Q);

  // Climax one-shot cues: strums (pillar) and ring-wave drums (river). Never guarded by allow() (climax score, §8.4).
  const cueT = [];
  const cueType = [];
  const cueIdx = [];
  STRUM_TIMES.forEach((ts) =>
    STRUM_KS.forEach((k, j) => {
      cueT.push(ts + j * 0.07);
      cueType.push(0);
      cueIdx.push(k);
    }),
  );
  for (let id = 0; id < N_STONES; id++) {
    cueT.push(WAVE_T0 + id * EIGHTH);
    cueType.push(1);
    cueIdx.push(id);
  }
  const cueDone = new Uint8Array(cueT.length);

  // Pre-built strings and reused payloads (no allocation on the per-frame paths).
  const PLUCK_KEYS = HARP_IDS.map((_, k) => `stones:pluck:${k}`);
  const BELL_KEYS = HARP_IDS.map((_, k) => `stones:bell:${k}`);
  const DRUM_KEYS = stoneInfo.map((_, i) => `stones:drum:${i}`);
  const HOLD_KEYS = HARP_IDS.map((_, k) => `stones:hold:${k}`);
  const playedPayload = { src: 'stones', degree: null, octave: 0, voice: 'pluck', when: 0, byAosSi: false };
  const ringPayload = { id: 0, k: -1, degree: null, octave: 0, level: 0, held: false, byAosSi: false };

  const tmpV = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const viewProj = new THREE.Matrix4();
  const camWorld = new THREE.Matrix4();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const raycaster = new THREE.Raycaster();

  // Harp star directions: from world.sky when present, else from the §3.5 band formula (static).
  const fallbackDirs = [];
  {
    const H = new THREE.Vector3().fromArray(LAYOUT.sky.bandFoot).normalize();
    const Nn = new THREE.Vector3().fromArray(LAYOUT.sky.bandPole).normalize();
    const Tt = new THREE.Vector3().crossVectors(H, Nn).normalize();
    for (let k = 0; k < 8; k++) {
      const th = (LAYOUT.sky.harpStars.theta0 + LAYOUT.sky.harpStars.dTheta * k) * DEG;
      const b = LAYOUT.sky.harpStars.beta[k] * DEG;
      fallbackDirs.push(
        new THREE.Vector3()
          .addScaledVector(H, Math.cos(th) * Math.cos(b))
          .addScaledVector(Tt, Math.sin(th) * Math.cos(b))
          .addScaledVector(Nn, Math.sin(b))
          .normalize(),
      );
    }
  }

  // ------------------------------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------------------------------
  const musicNow = () => {
    const M = world.music;
    return M ? M.now() : A.now();
  };
  const allow = (key) => world.music?.allow?.(key) ?? true;
  const eighthLen = () => world.music?.eighth || EIGHTH;

  function updateViewProj() {
    camWorld.compose(camera.position, camera.quaternion, unitScale).invert();
    viewProj.multiplyMatrices(camera.projectionMatrix, camWorld);
  }
  function projectTop(id, out) {
    return out.copy(tops[id]).applyMatrix4(viewProj);
  }
  function panOf(id) {
    updateViewProj();
    projectTop(id, tmpV2);
    // A stone top exactly on the eye plane projects with w = 0, i.e. ±Infinity or NaN; Web Audio
    // throws on a non-finite pan value.
    return Number.isFinite(tmpV2.x) ? THREE.MathUtils.clamp(tmpV2.x, -1, 1) * 0.7 : 0;
  }

  /** Harp stone whose top projects nearest the screen centre (visible stones preferred). */
  function nearestCentreK() {
    updateViewProj();
    const aspect = camera.aspect || 1;
    let best = -1;
    let bestD = Infinity;
    let fb = centreK;
    let fbD = Infinity;
    for (let k = 0; k < 8; k++) {
      projectTop(HARP_IDS[k], tmpV2);
      const ahead = tmpV2.z > -1 && tmpV2.z < 1;
      const d = (tmpV2.x * aspect) ** 2 + tmpV2.y ** 2;
      if (ahead && Math.abs(tmpV2.x) <= 1 && Math.abs(tmpV2.y) <= 1) {
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      } else if (ahead && d < fbD) {
        fbD = d;
        fb = k;
      }
    }
    return best >= 0 ? best : fb;
  }

  /** Arrival on the eighth grid at least 0.35 s (≤ 0.9 s) away. Returns [when (music/audio domain), delay]. */
  const answer = [0, 0];
  function answerTime() {
    const M = world.music;
    if (M && typeof M.next === 'function') {
      const now = M.now();
      const e = eighthLen();
      let when = M.next('eighth');
      for (let i = 0; i < 8 && when - now < 0.35; i++) when += e;
      if (when - now > 0.9) when = now + 0.9;
      answer[0] = when;
      answer[1] = when - now;
    } else {
      answer[0] = A.now() + 0.35;
      answer[1] = 0.35;
    }
    return answer;
  }

  function emitPlayed(degree, octave, voice, when, byAosSi) {
    playedPayload.degree = degree;
    playedPayload.octave = octave;
    playedPayload.voice = voice;
    playedPayload.when = when;
    playedPayload.byAosSi = byAosSi;
    events.emit('note:played', playedPayload);
  }
  function emitRing(id, level, held, byAosSi) {
    const info = stoneInfo[id];
    ringPayload.id = id;
    ringPayload.k = info.k;
    ringPayload.degree = info.k >= 0 ? info.degree : null;
    ringPayload.octave = info.k >= 0 ? info.octave : 0;
    ringPayload.level = level;
    ringPayload.held = held;
    ringPayload.byAosSi = byAosSi;
    events.emit('stone:ring', ringPayload);
  }
  function emitOffering(weight, source, id, byAosSi) {
    events.emit('offering', { kind: 'stone', weight, source, pos: tops[id].clone(), byAosSi });
  }

  function currentStarLevel(k) {
    return starShown[k];
  }

  /** Ring harp stone k (visual part shared by tap, key, release, ghost and deiseal). */
  function ringHarp(k, level, decaySeconds, ghost) {
    const id = HARP_IDS[k];
    const t = state.time;
    if (ringing[id] < 0.02 || threadA[k * 4] < 0.002) revealStart[k] = t;
    ringing[id] = Math.max(ghost ? ringing[id] : 0, level);
    decayRate[id] = level / decaySeconds;
    ringStart[id] = t;
    ghostScale[id] = ghost ? 0.6 : 1;
    snapStart[k] = -1;
  }

  function launchSpark(k, delay, ghost) {
    const t = state.time;
    sparkStart[k] = t;
    sparkDur[k] = Math.max(0.05, delay);
    sparkI[k] = ghost ? 0.6 : 1;
    sparkGhost[k] = ghost ? 1 : 0;
    ghostTintUntil[k] = ghost ? t + delay : -1e4;
    starPre[k] = currentStarLevel(k);
    starGate[k] = t + delay;
    starFlareAt[k] = t + delay;
    starFlarePeak[k] = ghost ? 2.6 : 3;
  }

  // ------------------------------------------------------------------------------------------
  // Interactions
  // ------------------------------------------------------------------------------------------
  function strikeHarp(k, pan, ghost, weightOverride) {
    const info = stoneInfo[HARP_IDS[k]];
    const id = info.id;
    const pre = ringing[id];
    ringHarp(k, ghost ? 0.8 : 1, RING_TAP_DECAY, ghost);
    const [when, delay] = answerTime();
    launchSpark(k, delay, ghost);

    const gainScale = ghost ? 0.5 : 1;
    const nowM = musicNow();
    if (allow(PLUCK_KEYS[k])) {
      A.pluck(A.note(info.degree, info.octave), { gain: 0.28 * gainScale, bright: 0.6, decay: 3.5, pan });
    }
    emitPlayed(info.degree, info.octave, 'pluck', nowM, ghost);
    if (allow(BELL_KEYS[k])) {
      A.bell(A.note(info.degree, info.octave + 1), { when, gain: 0.09 * gainScale, decay: 3.2, pan });
    }
    emitPlayed(info.degree, info.octave + 1, 'bell', when, ghost);

    emitRing(id, ringing[id], false, ghost);
    if (ghost) {
      emitOffering(weightOverride, 'aossi', id, true);
      state.energyTarget += 0.02 * 0.5;
    } else {
      firstStoneOffering = true;
      emitOffering(pre < 0.15 ? 1 : 0.5, 'tap', id, false);
      state.energyTarget += 0.02;
    }
  }

  function tapStone(id, pan) {
    const info = stoneInfo[id];
    const t = state.time;
    if (info.k >= 0) {
      strikeHarp(info.k, pan, false, 0);
      return;
    }
    if (info.role === 'portal') {
      flickerStart[id] = t;
      if (allow(DRUM_KEYS[id])) A.drum({ pitch: 73, gain: 0.3 });
    } else {
      recumbentLineStart = t;
      if (allow(DRUM_KEYS[id])) A.drum({ pitch: 55, gain: 0.35 });
    }
    ringing[id] = 1;
    decayRate[id] = info.role === 'portal' ? 1 / 0.6 : 1 / 0.9;
    emitPlayed(null, 0, 'drum', musicNow(), false);
    emitRing(id, 1, false, false);
    state.energyTarget += 0.01;
  }

  function startHold(id, pan) {
    const info = stoneInfo[id];
    if (info.k < 0) {
      // Portal / recumbent: a hold on them is claimed (it must not open the veil) and answers like a tap.
      tapStone(id, pan);
      return () => {};
    }
    if (hold.active) finishHold(hold.token, 0);
    const k = info.k;
    const t = state.time;
    hold.active = true;
    hold.k = k;
    hold.id = id;
    hold.startT = t;
    hold.pan = pan;
    hold.token++;
    ringHarp(k, 1, RING_HOLD_DECAY, false);
    decayRate[id] = 0;
    starPre[k] = currentStarLevel(k);
    starGate[k] = 1e9; // the star answers only after release
    const M = world.music;
    const sixteenth = eighthLen() / 2;
    if (M && typeof M.next === 'function') {
      hold.nextWhen = M.next('sixteenth');
      hold.nextVis = t + (hold.nextWhen - M.now());
    } else {
      hold.nextWhen = A.now() + 0.02;
      hold.nextVis = t + 0.02;
    }
    hold.sixteenth = sixteenth;
    emitRing(id, 1, true, false);
    const token = hold.token;
    return (heldMs) => finishHold(token, heldMs);
  }

  function finishHold(token, _heldMs) {
    if (!hold.active || token !== hold.token) return;
    const k = hold.k;
    const id = hold.id;
    const info = stoneInfo[id];
    hold.active = false;
    holdRelease[k] = state.time;
    ringHarp(k, 1, RING_HOLD_DECAY, false);
    const [when, delay] = answerTime();
    launchSpark(k, delay, false);
    if (allow(BELL_KEYS[k])) A.bell(A.note(info.degree, info.octave + 1), { when, gain: 0.09, decay: 3.2, pan: hold.pan });
    emitPlayed(info.degree, info.octave + 1, 'bell', when, false);
    emitRing(id, 1, false, false);
    firstStoneOffering = true;
    emitOffering(2, 'hold', id, false);
    state.energyTarget += 0.05;
  }

  function ghostOffering(weight) {
    const k = nearestCentreK();
    strikeHarp(k, panOf(HARP_IDS[k]), true, weight);
  }

  function strumDeiseal() {
    const M = world.music;
    const t = state.time;
    let start;
    let nowM;
    if (M && typeof M.next === 'function') {
      nowM = M.now();
      start = M.next('beat');
    } else {
      nowM = A.now();
      start = nowM + 0.35;
    }
    const e = eighthLen();
    for (let k = 0; k < 8; k++) {
      let slot = -1;
      for (let i = 0; i < Q; i++) {
        if (!qActive[i]) {
          slot = i;
          break;
        }
      }
      if (slot < 0) break;
      qActive[slot] = 1;
      qK[slot] = k;
      qWhen[slot] = start + k * e;
      qVis[slot] = t + (start - nowM) + k * e;
      qAudio[slot] = 0;
      qVisDone[slot] = 0;
    }
    firstStoneOffering = true;
    emitOffering(3, 'deiseal', HARP_IDS[0], false);
  }

  function muteAll(seconds) {
    const t = state.time;
    for (let id = 0; id < N_STONES; id++) {
      if (ringing[id] > 0.001) {
        decayRate[id] = Math.max(decayRate[id], ringing[id] / seconds);
        const k = stoneInfo[id].k;
        if (k >= 0) {
          snapStart[k] = t;
          sparkI[k] = 0;
          starGate[k] = t;
          starFlareAt[k] = -1e4;
        }
        emitRing(id, 0, false, false);
      }
    }
    for (let i = 0; i < Q; i++) qActive[i] = 0;
    if (hold.active) {
      hold.active = false;
      holdRelease[hold.k] = t;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Event wiring
  // ------------------------------------------------------------------------------------------
  const offs = [];
  const on = (name, fn) => offs.push(events.on(name, fn));

  on('hold:start', (p) => {
    if (!p?.ray) return;
    raycaster.ray.copy(p.ray);
    const hits = raycaster.intersectObjects(proxies, false);
    if (!hits.length) return;
    const hit = hits[0];
    const id = hit.object.userData.stoneId;
    const pan = (p.ndc?.x ?? 0) * 0.7;
    const act = () => startHold(id, pan);
    if (world.bealach) {
      p.candidates ??= [];
      p.candidates.push({ by: 'stones', distance: hit.distance, act });
    } else {
      pendingRelease = act();
    }
  });
  on('hold:end', (p) => {
    // Only a hold we started ourselves (no bealach at hold:start) is released here; otherwise bealach
    // calls the release it was handed (§5.2 rule 5). Checked in this order so a hold that began before
    // `bealach` loaded still ends, instead of ringing forever.
    if (!pendingRelease) return;
    const fn = pendingRelease;
    pendingRelease = null;
    fn(p?.heldMs ?? 0);
  });

  on('key', (p) => {
    if (p?.repeat === true) return;
    const key = p?.key;
    if (typeof key !== 'string' || key.length !== 1 || key < '1' || key > '8') return;
    const k = key.charCodeAt(0) - 49;
    strikeHarp(k, panOf(HARP_IDS[k]), false, 0);
  });

  on('music:beat', (p) => {
    const at = state.time + Math.max(0, p?.delay ?? 0);
    onBeat(at, p?.beatInBar === 0);
  });

  function onBeat(at, down) {
    prevBeatAt = lastBeatAt;
    lastBeatAt = at;
    if (down) {
      prevDownAt = lastDownAt;
      lastDownAt = at;
      centreK = nearestCentreK();
    }
    if (!firstStoneOffering && !reduced && phase === 'idle' && at - lastIdleSpark >= 8) {
      const k = centreK;
      if (state.time > sparkStart[k] + sparkDur[k]) {
        lastIdleSpark = at;
        sparkStart[k] = at;
        sparkDur[k] = 0.8;
        sparkI[k] = 0.45;
        sparkGhost[k] = 0;
      }
    }
  }

  on('deiseal:turn', (p) => {
    if (p?.dir === 1) strumDeiseal();
    else if (p?.dir === -1) muteAll(0.5);
  });

  on('aossi:offer', (p) => {
    if (p?.kind !== 'stone') return;
    ghostOffering(p.weight ?? 1.5);
  });

  on('hint:change', (p) => {
    const was = beckonOn;
    beckonOn = p?.target === 'stone';
    if (beckonOn && !was) centreK = nearestCentreK();
  });

  on('bealach:phase', (p) => {
    const ph = p?.phase;
    if (typeof ph !== 'string') return;
    phase = ph;
    const T = Number.isFinite(p.T) ? p.T : -1;
    if (ph === 'hush' || ph === 'idle') cueDone.fill(0);
    if (T >= 0) {
      for (let c = 0; c < cueT.length; c++) if (cueT[c] < T - 0.05) cueDone[c] = 1;
    }
    if (ph === 'hush') {
      // The frame goes dark: interaction ringing settles quickly under the climax levels.
      for (let id = 0; id < N_STONES; id++) if (ringing[id] > 0) decayRate[id] = Math.max(decayRate[id], ringing[id] / 0.6);
      for (let i = 0; i < Q; i++) qActive[i] = 0;
    }
  });

  // ------------------------------------------------------------------------------------------
  // world.stones
  // ------------------------------------------------------------------------------------------
  world.stones = { bases, tops, ringing, proxies };

  // ------------------------------------------------------------------------------------------
  // Climax pure functions of T (§7.3)
  // ------------------------------------------------------------------------------------------
  const climaxOut = [0, 0]; // [level, event T]
  function climaxThread(T, k) {
    let L = 0;
    let ev = 0;
    if (T < 0 || T >= 36) {
      climaxOut[0] = 0;
      climaxOut[1] = 0;
      return climaxOut;
    }
    if (T < 0.3) L = 1;
    else if (T < 0.6) L = 1 - 0.7 * smooth01((T - 0.3) / 0.3);
    else L = 0.3;
    const j = STRUM_KS.indexOf(k);
    if (j >= 0) {
      for (let s = 0; s < STRUM_TIMES.length; s++) {
        const te = STRUM_TIMES[s] + j * 0.07;
        if (T >= te) {
          const v = 0.3 + 0.7 * Math.exp(-(T - te) / 0.7);
          if (v >= L) {
            L = v;
            ev = te;
          }
        }
      }
    }
    const id = HARP_IDS[k];
    const tw = WAVE_T0 + id * EIGHTH;
    if (T >= tw && T < 30) {
      const v = 0.6 + 0.4 * Math.exp(-(T - tw) / 0.5);
      if (v >= L) {
        L = v;
        ev = tw;
      }
    }
    if (T >= 30) {
      // Flare, then let go: the fade runs the spec's 6 s but front-loaded, like a plucked string dying,
      // so the threads are all but gone by T = 33 when the ending text comes up over the column (§7.3, §9.3).
      const x = T - 30;
      L = x < 0.15 ? 0.6 + 0.4 * (x / 0.15) : Math.exp(-(x - 0.15) / 1.45) * (1 - smooth01((x - 0.15) / 5.85));
      ev = 30;
    }
    climaxOut[0] = L;
    climaxOut[1] = ev;
    return climaxOut;
  }
  function waveGlow(T, id) {
    const tw = WAVE_T0 + id * EIGHTH;
    if (T < tw || T >= 31) return 0;
    const v = 0.45 + 0.55 * Math.exp(-(T - tw) / 0.45);
    return T < 26 ? v : v * (1 - smooth01((T - 26) / 5));
  }
  function smooth01(x) {
    const c = x < 0 ? 0 : x > 1 ? 1 : x;
    return c * c * (3 - 2 * c);
  }
  function env(x, decay) {
    if (x < 0) return 0;
    if (x < 0.06) return x / 0.06;
    return Math.exp(-(x - 0.06) / decay);
  }

  // ------------------------------------------------------------------------------------------
  // Frame
  // ------------------------------------------------------------------------------------------
  function update(dt, t) {
    const E = state.energy;
    const sky = world.sky;
    const M = world.music;
    const T = U.uClimaxT.value;
    const inClimax = T >= 0 && T < 36;

    // Without a conductor the idle blink keeps its own dotted-quarter pulse (visual only, no event).
    if (!M) {
      while (t >= internalNextBeat) {
        onBeat(internalNextBeat, internalBeatIndex % 2 === 0);
        internalBeatIndex++;
        internalNextBeat += BEAT;
      }
    }

    // Climax cue bookkeeping and one-shot audio.
    if (T < 0 && lastT >= 0) cueDone.fill(0);
    if (T >= 0 && T < 21) {
      for (let c = 0; c < cueT.length; c++) {
        if (cueDone[c]) continue;
        const lead = cueT[c] - T;
        if (lead > 0.12) continue;
        cueDone[c] = 1;
        if (lead < -0.1) continue; // already passed (joined mid-phase or hitch): skipped
        const when = musicNow() + Math.max(0, lead);
        if (cueType[c] === 0) {
          const k = cueIdx[c];
          const info = stoneInfo[HARP_IDS[k]];
          A.pluck(A.note(info.degree, info.octave), { when, gain: 0.22, bright: 0.55, decay: 3.5, pan: panOf(info.id) });
        } else {
          A.drum({ when, pitch: 70, gain: 0.25 });
        }
      }
    }
    lastT = T;

    // Deiseal strum queue.
    for (let i = 0; i < Q; i++) {
      if (!qActive[i]) continue;
      const k = qK[i];
      const info = stoneInfo[HARP_IDS[k]];
      if (!qAudio[i] && t >= qVis[i] - 0.12) {
        qAudio[i] = 1;
        const when = M ? qWhen[i] : A.now() + Math.max(0, qVis[i] - t);
        if (allow(PLUCK_KEYS[k])) {
          A.pluck(A.note(info.degree, info.octave), { when, gain: 0.22, bright: 0.6, decay: 3.2, pan: panOf(info.id) });
        }
        emitPlayed(info.degree, info.octave, 'pluck', when, false);
      }
      if (!qVisDone[i] && t >= qVis[i]) {
        qVisDone[i] = 1;
        ringHarp(k, 1, RING_TAP_DECAY, false);
        starPre[k] = currentStarLevel(k);
        starGate[k] = t;
        starFlareAt[k] = t;
        starFlarePeak[k] = 3;
        emitRing(info.id, 1, false, false);
      }
      if (qAudio[i] && qVisDone[i]) qActive[i] = 0;
    }

    // Hold: sixteenth plucks for up to 3 s.
    if (hold.active) {
      const k = hold.k;
      const info = stoneInfo[hold.id];
      ringing[hold.id] = 1;
      for (let guard = 0; guard < 4 && t >= hold.nextVis - 0.1 && hold.nextVis - hold.startT <= HOLD_PLUCK_MAX; guard++) {
        const when = M ? hold.nextWhen : A.now() + Math.max(0, hold.nextVis - t);
        const g = 0.12 + (0.05 - 0.12) * THREE.MathUtils.clamp((hold.nextVis - hold.startT) / HOLD_PLUCK_MAX, 0, 1);
        if (allow(HOLD_KEYS[k])) A.pluck(A.note(info.degree, info.octave), { when, gain: g, bright: 0.4, decay: 1.2, pan: hold.pan });
        emitPlayed(info.degree, info.octave, 'pluck', when, false);
        hold.nextVis += hold.sixteenth;
        hold.nextWhen += hold.sixteenth;
      }
    }

    // Ring decay.
    for (let id = 0; id < N_STONES; id++) {
      if (hold.active && id === hold.id) continue;
      if (ringing[id] > 0) ringing[id] = Math.max(0, ringing[id] - decayRate[id] * dt);
    }

    // Beat envelopes.
    const beatEnv = Math.max(env(t - lastBeatAt, 0.3), env(t - prevBeatAt, 0.3));
    const downEnv = Math.max(env(t - lastDownAt, 0.35), env(t - prevDownAt, 0.35));
    const idleBlink = !firstStoneOffering && phase === 'idle';
    const beckonK = beckonOn && phase === 'idle' ? centreK : -1;
    const blinkK = idleBlink ? centreK : -1;

    // Per-stone ogham glow and fx.
    const riverAmt = T >= 0 ? smooth01((T - 14.6) / 0.8) * (1 - smooth01((T - 28) / 3)) : 0;
    for (let id = 0; id < N_STONES; id++) {
      const info = stoneInfo[id];
      const k = info.k;
      let base = 0;
      const fx = t - flickerStart[id];
      if (fx >= 0 && fx < 0.6) base += 0.95 * (1 - fx / 0.6) * (0.45 + 0.55 * Math.abs(Math.sin(fx * 41) * Math.sin(fx * 23 + 1.3)));
      if (k >= 0 && k === blinkK) base = Math.max(base, reduced ? 0.15 : 0.25 * beatEnv);
      if (k >= 0 && k === beckonK) base = Math.max(base, reduced ? 0.2 : 0.35 * downEnv);
      if (firstStoneOffering && E < 0.5 && ringing[id] < 0.02 && !inClimax && !reduced) base = Math.max(base, 0.08 * downEnv);
      let ringLevel = ringing[id] * ghostScale[id];
      if (k < 0 && info.role === 'portal') ringLevel = 0; // portal flicker is carried by `base`
      if (id === RECUMBENT_ID) ringLevel = 0; // the recumbent answers with its top-edge line
      let rStart = ringStart[id];
      if (inClimax) {
        const wg = waveGlow(T, id);
        if (wg > base) base = wg;
        if (k >= 0) {
          const c = climaxThread(T, k);
          if (c[0] > ringLevel) {
            ringLevel = c[0];
            rStart = t - (T - c[1]);
          }
        }
      }
      const o = id * 4;
      glowA[o] = base;
      glowA[o + 1] = ringLevel;
      glowA[o + 2] = rStart;
      hover[id] += (hoverTarget[id] - hover[id]) * Math.min(1, dt * 10);
      fxArr[o] = hover[id];
      fxArr[o + 1] = id === 0 || id === 10 ? riverAmt : 0;
      fxArr[o + 2] = id === RECUMBENT_ID ? recumbentLineStart : -1e4;
    }

    // Threads and harp stars.
    let anyThread = false;
    const eFactor = 0.7 + 0.3 * E;
    // Additive crowding (§11.1): eight threads lit at once — the deiseal strum, the ring-wave hold —
    // sum into one bright cone and take the frame away from whatever is supposed to own it. The thread
    // *level* is left alone (the harp stars read it, §10.6); only the drawn alpha is trimmed, and only
    // once more than a couple of threads are ringing together.
    let litCount = 0;
    for (let k = 0; k < 8; k++) {
      let lv = ringing[HARP_IDS[k]];
      if (inClimax) lv = Math.max(lv, climaxThread(T, k)[0]);
      threadLvl[k] = lv;
      if (lv > 0.22) litCount++;
    }
    // Eased in over ~0.45 s and released in ~0.2 s, so the short all-eight flares the score asks for
    // (hush T = 0, the deiseal strum, the T = 30 flare) still strike at nearly full length and strength,
    // and only a *sustained* crowd — the river hold — is pulled back.
    const crowdT = smooth01((litCount - 2) / 5);
    crowdSmooth += (crowdT - crowdSmooth) * Math.min(1, dt * (crowdT > crowdSmooth ? 2.2 : 5));
    const crowd = 1 - 0.55 * crowdSmooth;
    for (let k = 0; k < 8; k++) {
      const id = HARP_IDS[k];
      const o = k * 4;
      // Star direction (live, includes sky rotation in the climax).
      const starId = sky?.harpStarIds?.[k];
      if (sky && typeof sky.starDir === 'function' && starId !== undefined) sky.starDir(starId, tmpV);
      else tmpV.copy(fallbackDirs[k]);
      // This direction becomes a vertex position in THREAD_VERT: never let a non-finite one through.
      if (!Number.isFinite(tmpV.x + tmpV.y + tmpV.z)) tmpV.copy(fallbackDirs[k]);
      starArr[k * 3] = tmpV.x;
      starArr[k * 3 + 1] = tmpV.y;
      starArr[k * 3 + 2] = tmpV.z;

      const level = threadLvl[k];
      const beckA = k === beckonK ? 0.25 : 0;
      beckonAlpha[k] += (beckA - beckonAlpha[k]) * Math.min(1, dt * 4);
      let alpha = Math.max(level * eFactor * crowd, beckonAlpha[k]);
      if (snapStart[k] >= 0 && t - snapStart[k] > 0.6 && ringing[id] <= 0) snapStart[k] = -1;
      if (alpha < 0.002) alpha = 0;
      if (alpha > 0 && !wasVisible[k] && revealStart[k] < t - 0.2) revealStart[k] = t;
      wasVisible[k] = alpha > 0 ? 1 : 0;

      // Hold thickness ×2.5 with tremble; after release the string rings out over ~1.2 s.
      const since = t - holdRelease[k];
      const holdTarget = hold.active && hold.k === k ? 1 : since < 1.2 ? 1 - smooth01(since / 1.2) : 0;
      holdAmt[k] = holdTarget;

      threadA[o] = alpha;
      threadA[o + 1] = 1 + 1.5 * holdAmt[k];
      threadA[o + 2] = holdAmt[k];
      threadA[o + 3] = revealStart[k];

      const tintT = t - ghostTintUntil[k];
      threadB[o] = t < ghostTintUntil[k] ? 1 : tintT < 1.2 ? 1 - smooth01(tintT / 1.2) : 0;
      threadB[o + 1] = snapStart[k];
      threadB[o + 2] = sparkStart[k];
      threadB[o + 3] = sparkDur[k];
      const sparkLive = t >= sparkStart[k] && t <= sparkStart[k] + sparkDur[k] && sparkI[k] > 0;
      threadC[o] = sparkLive ? sparkI[k] : 0;
      threadC[o + 1] = sparkGhost[k];
      // How far up its run this thread is drawn. One or two ringing stones keep the whole thread, so it
      // still reaches its star; with the harp lit the runs are pulled back to ragged, unequal lengths and
      // dissolve into the night well short of the harp stars — no apex, no tent (§11.3-3).
      threadC[o + 2] = 1 - crowdSmooth * (1 - REACH[k]);
      if (alpha > 0 || sparkLive) anyThread = true;

      // Harp star level 0.5 + 2.5·level, flaring to 3 when the spark arrives.
      const baseStar = 0.5 + 2.5 * level;
      let shown;
      if (t < starGate[k]) shown = starPre[k];
      else {
        shown = baseStar;
        const fa = t - starFlareAt[k];
        if (fa >= 0 && fa < 0.9 && starFlarePeak[k] > baseStar) {
          const w = 1 - fa / 0.9;
          shown = baseStar + (starFlarePeak[k] - baseStar) * w * w;
        }
      }
      starShown[k] = shown;
      if (sky && typeof sky.setStarLevel === 'function' && starId !== undefined && Math.abs(shown - starSent[k]) > 0.004) {
        sky.setStarLevel(starId, shown);
        starSent[k] = shown;
      }
    }
    threads.visible = anyThread;

    ctx.renderer.getDrawingBufferSize(resolution);
    threadMat.uniforms.uPx.value = devicePx();
  }

  function onResize() {
    ctx.renderer.getDrawingBufferSize(resolution);
    threadMat.uniforms.uPx.value = devicePx();
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
    for (const rm of removers) rm();
    removers.length = 0;
    scene.remove(stones, threads, proxyGroup);
    stones.dispose();
    stoneGeo.dispose();
    stoneMat.dispose();
    threadGeo.dispose();
    threadMat.dispose();
    proxyGeo.dispose();
    proxyMat.dispose();
    atlas.texture.dispose();
    if (world.stones?.ringing === ringing) delete world.stones;
  }

  stones.userData.debug = {
    ringing,
    inscriptions,
    get centreK() {
      return centreK;
    },
    get firstStoneOffering() {
      return firstStoneOffering;
    },
    threadA,
    starShown,
    atlasCanvas: atlas.canvas,
  };

  onResize();
  return { update, onResize, dispose };
}
