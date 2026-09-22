// sceach — the rag tree (sceach gheal) at the holy well (tobar). docs/DESIGN.md §10.7 (load order 7).
// Owns: hawthorn + tobar, ribbons (ribíní), word ribbon, wish motes, blossom + haws,
// wish tap / hold / ogham:word responses, ghost wishes, beckon.
import * as THREE from 'three';
import { buildTree } from './sceach/tree.js';
import {
  createWordTexture,
  lettersFromWord,
  lettersFromOgham,
  oghamString,
  letterVoice,
  wordLayout,
  HOLD_WORDS,
  MAX_LETTERS,
} from './sceach/ogham.js';
import * as GL from './sceach/shaders.js';

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
const EIGHTH_FALLBACK = 60 / 66 / 3; // dotted quarter = 66 (§8.2)
const TORC_HEX = 0xd9a547;
const DYE_NAMES = ['madder', 'woad', 'linen'];
const OLD_RIBBONS = 9;
// Crown pick proxy (§10.7, §10.0 exception), world metres. A narrow upright ellipsoid over the
// trunk: rx is the only axis that has to stay small, because the stones the crown can steal sit to
// the screen sides of it — k1/k2 to the right in landscape, k0 to the left in portrait, so no
// sideways bias can clear both and the shape has to be a column instead. ry/rz stay generous so the
// tree is still an easy touch target. Tuned against checkPickSeparation() at 1280×800, 400×800 and
// 844×390; change these and re-run it.
const CROWN_PROXY = { rx: 0.55, ry: 2.0, rz: 0.95 };
const MOTE_MAX = 12;
const TRAIL = 16;
const SPIRAL_RISE = 10; // m
const SPIRAL_SECONDS = 1.2;
const SPIRAL_TURNS = 1.5;
const ARC_SECONDS = 1.8;
const ARC_DIST = 80; // camLaunch + dir·80
const TAIL_M = 0.8;
const UNROLL_SECONDS = 1;
const WISH_DIR_POOL = 96; // sky keeps at most 96 wish stars (§10.2)
const VOICE_SLOTS = 40;
const VOICE_LOOKAHEAD = 0.1;
const FOLIAGE_COUNT = 240;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mix = (a, b, t) => a + (b - a) * t;
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Strip of `rows` quads: x ∈ [−0.5, 0.5] across, y = a ∈ [0, 1] from the knot (0) to the tip (1). */
function stripGeometry(rows) {
  const pos = new Float32Array((rows + 1) * 6);
  const idx = [];
  for (let i = 0; i <= rows; i++) {
    const a = i / rows;
    pos.set([-0.5, a, 0, 0.5, a, 0], i * 6);
    if (i < rows) {
      const b = i * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export default async function setup(ctx) {
  const { scene, camera, events, world, state } = ctx;
  const A = ctx.audio;
  const U = ctx.uniforms;
  // §3.6 extension uniforms, shared lazily by every module
  U.uFireLevel ??= { value: 0 };
  U.uClimaxT ??= { value: -1 };
  U.uAfterglow ??= { value: 0 };
  U.uOtherAngle ??= { value: 0 };

  const low = ctx.quality === 'low';
  const reduced = !!ctx.reducedMotion;
  const rng = ctx.makeRng('sceach');
  const offs = [];
  const disposables = [];
  const objects = [];

  const heightAt = (x, z) => {
    const f = world.heightAt;
    const h = typeof f === 'function' ? f(x, z) : 0;
    return Number.isFinite(h) ? h : 0;
  };
  const lin = (key, fallback) => new THREE.Color(ctx.palette?.[key] ?? fallback);
  const C = {
    peat: lin('peat', '#080D0C'),
    airglow: lin('airglow', '#2E3F2C'),
    lichen: lin('lichen', '#5E6559'),
    boFinne: lin('boFinne', '#ECE4CF'),
    torc: lin('torc', '#D9A547'),
    madder: lin('madder', '#9E2F22'),
    woad: lin('woad', '#33506A'),
    verdigris: lin('verdigris', '#5FA08E'),
  };
  const dyeColor = (i) => (i === 0 ? C.madder : i === 1 ? C.woad : C.boFinne);

  // ─────────────────────────────── Tree + tobar (one draw) ───────────────────────────────
  const base = new THREE.Vector3(LAYOUT.sceach.pos[0], 0, LAYOUT.sceach.pos[2]);
  base.y = heightAt(base.x, base.z);
  const lee = new THREE.Vector3(base.x, 0, base.z).normalize(); // away from the loch (centre = origin)
  const tobarPos = new THREE.Vector3(LAYOUT.tobar.pos[0], 0, LAYOUT.tobar.pos[2]);
  tobarPos.y = heightAt(tobarPos.x, tobarPos.z);

  const tree = buildTree({
    rng,
    radialSegments: low ? 3 : 5,
    base,
    lee,
    heightAt,
    tobar: tobarPos,
    tobarRadius: LAYOUT.tobar.ringRadius,
    height: LAYOUT.sceach.height,
    leanDeg: LAYOUT.sceach.leanAwayFromLoch,
  });
  const anchors = tree.anchors;
  const crown = tree.crown;

  const shared = (names) => {
    const o = {};
    for (const n of names) o[n] = U[n];
    return o;
  };
  const fogU = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  const own = {
    uWind: { value: lee.clone() },
    uSwayAmp: { value: 0.5 },
    uPxScale: { value: 860 },
    uDpr: { value: ctx.size?.dpr ?? 1 },
  };
  const uHover = { value: 0 };
  const colU = {
    uTorc: { value: C.torc.clone() },
    uBoFinne: { value: C.boFinne.clone() },
    uMadder: { value: C.madder.clone() },
  };

  const treeMat = new THREE.ShaderMaterial({
    name: 'sceach.tree',
    uniforms: {
      ...fogU(),
      ...shared(['uTime', 'uEnergy', 'uVeil', 'uFirePos', 'uFireLevel']),
      uWind: own.uWind,
      uSwayAmp: own.uSwayAmp,
      uPxScale: own.uPxScale,
      uHover,
      uBark: { value: C.lichen.clone().multiplyScalar(0.6) },
      uStone: { value: C.lichen.clone() },
      uPeat: { value: C.peat.clone() },
      uAirglow: { value: C.airglow.clone() },
      uTobar: { value: tobarPos.clone() },
    },
    vertexShader: GL.treeVertex,
    fragmentShader: GL.treeFragment,
    fog: true,
  });
  const treeMesh = new THREE.Mesh(tree.geometry, treeMat);
  treeMesh.name = 'sceach.tree';
  scene.add(treeMesh);
  objects.push(treeMesh);
  disposables.push(tree.geometry, treeMat);

  // ─────────────────────────────── Foliage (high only) ───────────────────────────────
  let foliage = null;
  if (!low && tree.twigs.length) {
    const fGeo = new THREE.PlaneGeometry(1, 1);
    const fMat = new THREE.ShaderMaterial({
      name: 'sceach.foliage',
      uniforms: {
        ...fogU(),
        ...shared(['uTime', 'uVeil', 'uFirePos', 'uFireLevel']),
        uWind: own.uWind,
        uSwayAmp: own.uSwayAmp,
        uPxScale: own.uPxScale,
        uCrown: { value: crown.clone() },
        uLeaf: { value: C.airglow.clone().multiplyScalar(0.5) },
      },
      vertexShader: GL.foliageVertex,
      fragmentShader: GL.foliageFragment,
      fog: true,
      side: THREE.DoubleSide,
    });
    foliage = new THREE.InstancedMesh(fGeo, fMat, FOLIAGE_COUNT);
    foliage.name = 'sceach.foliage';
    const aLeaf = new Float32Array(FOLIAGE_COUNT * 3);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const p = new THREE.Vector3();
    // Several small sprays strung along the outer limbs, not one clot in the middle of the crown
    // (§3.4 "wind-bent, gnarled, sparse"). Clump centres are farthest-point sampled over the outer
    // twigs with a leeward bias, so the windward face stays wind-thinned and every azimuth of the
    // silhouette carries some leaf mass.
    const outer = tree.twigs.filter((t) => t.level >= 4);
    const pool = outer.length ? outer : tree.twigs;
    const leeOf = (t) => (t.pos.x - crown.x) * lee.x + (t.pos.z - crown.z) * lee.z;
    const CLUMPS = Math.min(30, pool.length);
    const centres = [];
    {
      let seed = pool[0];
      for (const t of pool) if (leeOf(t) > leeOf(seed)) seed = t;
      centres.push(seed);
      while (centres.length < CLUMPS) {
        let best = null;
        let bestS = -Infinity;
        for (const t of pool) {
          let dmin = Infinity;
          for (const c of centres) dmin = Math.min(dmin, t.pos.distanceToSquared(c.pos));
          const s = Math.sqrt(dmin) * (0.82 + 0.36 * rng()) + 0.22 * leeOf(t);
          if (s > bestS) {
            bestS = s;
            best = t;
          }
        }
        if (!best) break;
        centres.push(best);
      }
    }
    const PER = Math.ceil(FOLIAGE_COUNT / centres.length);
    for (let c = 0, i = 0; c < centres.length && i < FOLIAGE_COUNT; c++) {
      const ctr = centres[c];
      // the twigs this spray can sit on: anything close to the clump centre
      const near = pool.filter((t) => t.pos.distanceToSquared(ctr.pos) < 0.2);
      const host = near.length ? near : [ctr];
      for (let k = 0; k < PER && i < FOLIAGE_COUNT; k++, i++) {
        // small sprays sitting ON the twigs (a sparse, wind-thinned crown), never hanging clumps
        const tw = host[Math.floor(rng() * host.length)];
        p.set(tw.pos.x + (rng() - 0.5) * 0.17, tw.pos.y + (rng() - 0.5) * 0.13 + 0.03, tw.pos.z + (rng() - 0.5) * 0.17);
        const s = 0.115 + 0.105 * rng();
        m4.compose(p, q, sc.set(s, s, s));
        foliage.setMatrixAt(i, m4);
        aLeaf[i * 3] = rng();
        aLeaf[i * 3 + 1] = rng() * Math.PI * 2;
        aLeaf[i * 3 + 2] = rng();
      }
    }
    fGeo.setAttribute('aLeaf', new THREE.InstancedBufferAttribute(aLeaf, 3));
    foliage.instanceMatrix.needsUpdate = true;
    foliage.boundingSphere = new THREE.Sphere(crown.clone(), 4.5);
    scene.add(foliage);
    objects.push(foliage);
    disposables.push(fGeo, fMat);
  }

  // ─────────────────────────────── Ribbons (instanced) ───────────────────────────────
  const RIB_MAX = low ? 24 : 48;
  const ribU = {
    uLift: { value: 0.3 },
    uFlutter: { value: 0.5 },
    uBeckon: { value: 0 },
    uBeckonStatic: { value: 0 },
    uRiverGlow: { value: 0 },
  };
  const ribGeo = stripGeometry(8);
  const aDye = new THREE.InstancedBufferAttribute(new Float32Array(RIB_MAX * 4), 4);
  const aInfo = new THREE.InstancedBufferAttribute(new Float32Array(RIB_MAX * 4), 4);
  aDye.setUsage(THREE.DynamicDrawUsage);
  aInfo.setUsage(THREE.DynamicDrawUsage);
  ribGeo.setAttribute('aDye', aDye);
  ribGeo.setAttribute('aInfo', aInfo);
  const ribMat = new THREE.ShaderMaterial({
    name: 'sceach.ribbons',
    uniforms: {
      ...fogU(),
      ...shared(['uTime', 'uVeil', 'uFirePos', 'uFireLevel']),
      uWind: own.uWind,
      uSwayAmp: own.uSwayAmp,
      uPxScale: own.uPxScale,
      uHover,
      ...ribU,
      uTorc: colU.uTorc,
      uBoFinne: colU.uBoFinne,
    },
    vertexShader: GL.ribbonVertex,
    fragmentShader: GL.ribbonFragment,
    fog: true,
    side: THREE.DoubleSide,
  });
  const ribbons = new THREE.InstancedMesh(ribGeo, ribMat, RIB_MAX);
  ribbons.name = 'sceach.ribbons';
  ribbons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ribbons.boundingSphere = new THREE.Sphere(crown.clone(), 5);
  ribbons.count = 0;
  scene.add(ribbons);
  objects.push(ribbons);
  disposables.push(ribGeo, ribMat);

  const anchorSlot = new Int16Array(anchors.length).fill(-1);
  const slotAnchor = new Int16Array(RIB_MAX).fill(-1);
  const slotTie = new Float32Array(RIB_MAX);
  let ribUsed = 0;
  const m4 = new THREE.Matrix4();
  const tmpV = new THREE.Vector3();
  const tmpW = new THREE.Vector3();

  function allocSlot() {
    if (ribUsed < RIB_MAX) return ribUsed++;
    let best = OLD_RIBBONS;
    let bt = Infinity;
    for (let i = OLD_RIBBONS; i < RIB_MAX; i++) {
      if (slotTie[i] < bt) {
        bt = slotTie[i];
        best = i;
      }
    }
    return best; // the oldest new ribbon is untied and re-tied (pre-tied old ribbons are never recycled)
  }

  function writeRibbon(slot, ai, dyeIdx, ghost, old, tieTime) {
    const prev = slotAnchor[slot];
    if (prev >= 0 && anchorSlot[prev] === slot) anchorSlot[prev] = -1;
    slotAnchor[slot] = ai;
    anchorSlot[ai] = slot;
    slotTie[slot] = tieTime;
    const a = anchors[ai];
    m4.makeTranslation(a.pos.x, a.pos.y, a.pos.z);
    ribbons.setMatrixAt(slot, m4);
    ribbons.instanceMatrix.needsUpdate = true;
    const c = dyeColor(dyeIdx);
    aDye.setXYZW(slot, c.r, c.g, c.b, a.sway);
    aInfo.setXYZW(slot, tieTime, ghost ? 1 : 0, old ? 1 : 0, dyeIdx + 0.02 + rng() * 0.96);
    aDye.needsUpdate = true;
    aInfo.needsUpdate = true;
    ribbons.count = ribUsed;
  }

  const facing = (ai, camPos) => {
    const p = anchors[ai].pos;
    tmpV.subVectors(p, crown).setY((p.y - crown.y) * 0.3).normalize();
    tmpW.subVectors(camPos, crown).setY(0).normalize();
    return tmpV.dot(tmpW);
  };

  // 9 pre-tied old ribbons, faded ×0.5, never counted (§10.7). A rag tree is tied where a hand
  // reaches, so these cluster on the lowest camera-facing limb spots — thick wood, with the knot
  // visible above every ribbon — rather than being spread max-apart over the outer twig tips, where
  // they read as rags floating in mid-air with nothing holding them up (§3.4 "wind-bent, gnarled").
  {
    const bootCam = camera.position;
    const seen = (i) => facing(i, bootCam) > -0.25;
    let pool = [];
    for (let i = 0; i < anchors.length; i++) if (anchors[i].limb && seen(i)) pool.push(i);
    if (pool.length < OLD_RIBBONS) for (let i = 0; i < anchors.length; i++) if (anchors[i].limb && !pool.includes(i)) pool.push(i);
    if (pool.length < OLD_RIBBONS) {
      for (let i = 0; i < anchors.length; i++) {
        if (pool.includes(i)) continue;
        if (seen(i) && anchors[i].pos.y > base.y + 1.2 && anchors[i].pos.y < base.y + 3.0) pool.push(i);
      }
    }
    pool.sort((a, b) => anchors[a].pos.y - anchors[b].pos.y); // reachable first: lowest limbs
    const chosen = [];
    for (const i of pool) {
      if (chosen.length >= OLD_RIBBONS) break;
      let ok = true;
      for (const j of chosen) if (anchors[i].pos.distanceTo(anchors[j].pos) < 0.22) ok = false;
      if (ok) chosen.push(i);
    }
    for (const i of pool) {
      if (chosen.length >= OLD_RIBBONS) break;
      if (!chosen.includes(i)) chosen.push(i);
    }
    // 4 linen, 3 madder, 2 woad, interleaved so no two of a colour sit together. Woad is the one
    // hue nothing else in the piece has (§11.3 #1), so it stays the rarest even though it is now
    // the one that has to carry §10.10-1's carve-out.
    const oldDyes = [2, 0, 2, 1, 2, 0, 2, 1, 0];
    chosen.forEach((ai, k) => writeRibbon(allocSlot(), ai, oldDyes[k % oldDyes.length], false, true, -1000));
  }

  // ─────────────────────────────── Word ribbon ───────────────────────────────
  const wordTex = createWordTexture(ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
  const wordGeo = stripGeometry(28);
  wordGeo.boundingSphere = new THREE.Sphere(crown.clone(), 6);
  const wordU = {
    uAnchor: { value: new THREE.Vector3() },
    uAnchorSway: { value: 1 },
    uUnroll: { value: 0 },
    uWSeed: { value: 0.5 },
    uWordTex: { value: wordTex.texture },
    uGlow: { value: 0 },
    uLetterT0: { value: 0 },
    uEighth: { value: EIGHTH_FALLBACK },
    uX0: { value: 0 },
    uSlotW: { value: 58 },
    uCount: { value: 0 },
  };
  const wordMat = new THREE.ShaderMaterial({
    name: 'sceach.word',
    uniforms: {
      ...fogU(),
      ...shared(['uTime', 'uVeil', 'uFirePos', 'uFireLevel']),
      uWind: own.uWind,
      uSwayAmp: own.uSwayAmp,
      uPxScale: own.uPxScale,
      uLift: ribU.uLift,
      uFlutter: ribU.uFlutter,
      ...wordU,
      uTorc: colU.uTorc,
      uBoFinne: colU.uBoFinne,
    },
    vertexShader: GL.wordVertex,
    fragmentShader: GL.wordFragment,
    fog: true,
    side: THREE.DoubleSide,
  });
  const wordMesh = new THREE.Mesh(wordGeo, wordMat);
  wordMesh.name = 'sceach.word';
  wordMesh.visible = false;
  scene.add(wordMesh);
  objects.push(wordMesh);
  disposables.push(wordGeo, wordMat, wordTex);

  // ─────────────────────────────── Wish motes ───────────────────────────────
  const moteGeo = new THREE.BufferGeometry();
  const moteXYZ = new Float32Array(MOTE_MAX * TRAIL * 3);
  const moteCol = new Float32Array(MOTE_MAX * TRAIL * 4);
  const motePosAttr = new THREE.BufferAttribute(moteXYZ, 3).setUsage(THREE.DynamicDrawUsage);
  const moteColAttr = new THREE.BufferAttribute(moteCol, 4).setUsage(THREE.DynamicDrawUsage);
  moteGeo.setAttribute('position', motePosAttr);
  moteGeo.setAttribute('aCol', moteColAttr);
  const moteMat = new THREE.ShaderMaterial({
    name: 'sceach.motes',
    uniforms: { uDpr: own.uDpr },
    vertexShader: GL.moteVertex,
    fragmentShader: GL.moteFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const motePoints = new THREE.Points(moteGeo, moteMat);
  motePoints.name = 'sceach.motes';
  motePoints.frustumCulled = false;
  motePoints.visible = false;
  motePoints.renderOrder = 2;
  scene.add(motePoints);
  objects.push(motePoints);
  disposables.push(moteGeo, moteMat);

  const motes = [];
  for (let i = 0; i < MOTE_MAX; i++) {
    motes.push({
      on: false,
      t0: 0,
      spiralDur: SPIRAL_SECONDS,
      a0: 0,
      anchor: new THREE.Vector3(),
      center: new THREE.Vector3(),
      arcT0: -1,
      arcDur: ARC_SECONDS,
      p0: new THREE.Vector3(),
      c1: new THREE.Vector3(),
      c2: new THREE.Vector3(),
      p3: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      tail: new THREE.Color(),
      head: new THREE.Color(),
      ghost: false,
      gain: 1,
      pan: 0,
    });
  }
  const wishDirs = [];
  for (let i = 0; i < WISH_DIR_POOL; i++) wishDirs.push(new THREE.Vector3());
  let wishDirHead = 0;

  // ─────────────────────────────── Blossom + haws (pure function of uClimaxT) ───────────────────────────────
  const N_BLOSSOM = low ? 150 : 400;
  const N_HAW = low ? 60 : 120;
  const blGeo = new THREE.BufferGeometry();
  {
    const n = N_BLOSSOM + N_HAW;
    const pos = new Float32Array(n * 3);
    const info = new Float32Array(n * 4);
    const twigs = tree.twigs.length ? tree.twigs : anchors;
    for (let i = 0; i < n; i++) {
      const kind = i < N_BLOSSOM ? 0 : 1;
      const src = kind === 1 && rng() < 0.6 ? anchors[Math.floor(rng() * anchors.length)] : twigs[Math.floor(rng() * twigs.length)];
      const j = kind === 0 ? 0.16 : 0.1;
      const x = src.pos.x + (rng() - 0.5) * 2 * j;
      const y = src.pos.y + (rng() - 0.5) * 2 * j - (kind === 1 ? 0.04 : 0);
      const z = src.pos.z + (rng() - 0.5) * 2 * j;
      pos.set([x, y, z], i * 3);
      info.set([kind, rng(), heightAt(x, z), src.sway ?? 1], i * 4);
    }
    blGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    blGeo.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    blGeo.boundingSphere = new THREE.Sphere(crown.clone(), 7);
  }
  const blMat = new THREE.ShaderMaterial({
    name: 'sceach.blossom',
    uniforms: {
      ...fogU(),
      ...shared(['uTime', 'uClimaxT', 'uVeil', 'uFirePos', 'uFireLevel']),
      uWind: own.uWind,
      uSwayAmp: own.uSwayAmp,
      uPxScale: own.uPxScale,
      uDpr: own.uDpr,
      uBoFinne: colU.uBoFinne,
      uMadder: colU.uMadder,
      uTorc: colU.uTorc,
    },
    vertexShader: GL.blossomVertex,
    fragmentShader: GL.blossomFragment,
    fog: true,
  });
  const blossoms = new THREE.Points(blGeo, blMat);
  blossoms.name = 'sceach.blossom';
  blossoms.visible = false;
  scene.add(blossoms);
  objects.push(blossoms);
  disposables.push(blGeo, blMat);

  // ─────────────────────────────── Proxy (§10.7, R14) ───────────────────────────────
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = new THREE.Group();
  proxy.name = 'sceach.proxy';
  // §10.7/R14 asks for a crown sphere of r 1.9 on the arithmetic that it "spans x 921–1100" at the
  // default camera and so clears harp stone k2's top at (1108, 422). Measured in three r186 that
  // arithmetic is the projection of the centre ±1.9 m along camera-right; a sphere 20 m out and 23°
  // off-axis has a silhouette half-angle of asin(R/d), not atan(R/d), so r 1.9 actually reaches
  // x ≈ 1111 and screen-covers all of k1 (top (1056, 363)) and the top of k2 — and being 3 m nearer
  // the camera than either stone, it takes their clicks. §10.0's standing rule ("hit shapes are
  // ≥ 1.6× the visual size, EXCEPT where a proxy would cover a neighbouring pickable at the default
  // camera — the sceach crown") and acceptance 6 both rank above the literal radius, so the crown
  // proxy is built to the rule instead: an ellipsoid narrow along the camera-right axis, pushed
  // toward the loch (away from the circle), and tall enough to keep the tree an easy target.
  // checkPickSeparation() below is the automated form of the acceptance and runs at three sizes.
  const trunkGeo = new THREE.CylinderGeometry(0.62, 0.62, 4.05, 12);
  const crownGeo = new THREE.SphereGeometry(1, 18, 12);
  crownGeo.scale(CROWN_PROXY.rx, CROWN_PROXY.ry, CROWN_PROXY.rz);
  const trunkProxy = new THREE.Mesh(trunkGeo, proxyMat);
  trunkProxy.position.set(base.x + lee.x * 0.2, base.y + 1.5, base.z + lee.z * 0.2);
  trunkProxy.rotation.set(0, 0, 0);
  // lean the trunk proxy 8° away from the loch, like the trunk
  trunkProxy.quaternion.setFromAxisAngle(tmpV.set(lee.z, 0, -lee.x).normalize(), LAYOUT.sceach.leanAwayFromLoch * DEG);
  const crownProxy = new THREE.Mesh(crownGeo, proxyMat);
  crownProxy.position.copy(crown);
  proxy.add(trunkProxy, crownProxy);
  scene.add(proxy);
  proxy.updateMatrixWorld(true);
  objects.push(proxy);
  disposables.push(trunkGeo, crownGeo, proxyMat);

  const api = {
    pos: base.clone(),
    crown: crown.clone(),
    proxy,
    lastWish: null,
    stats: { ...tree.stats, ribbons: RIB_MAX, blossoms: N_BLOSSOM, haws: N_HAW, foliage: foliage ? FOLIAGE_COUNT : 0 },
  };
  world.sceach = api;

  // Automated form of §10.7 acceptance 6 (§10.0's "except where a proxy would cover a neighbouring
  // pickable"). For every stone, 5 points spread along its own projected axis must resolve to its own
  // proxy and not to the tree. Returns { ok, stolen:[...] }; `stolen` lists only points the sceach
  // takes — stone-on-stone overlaps belong to `stones`. Run it at 1280×800, 400×800 and 844×390.
  api.checkPickSeparation = () => {
    const st = world.stones;
    if (!st || !st.proxies) return { ok: true, stolen: [], note: 'stones not loaded' };
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const targets = st.proxies.concat([proxy]);
    const w = ctx.size?.width || 1;
    const h = ctx.size?.height || 1;
    const stolen = [];
    const project = (v, out) => {
      out.copy(v).project(camera);
      return { x: (out.x * 0.5 + 0.5) * w, y: (-out.y * 0.5 + 0.5) * h };
    };
    for (let id = 0; id < st.proxies.length; id++) {
      if (!st.tops[id] || !st.bases[id]) continue;
      const pt = project(st.tops[id], tmpV);
      const pb = project(st.bases[id], tmpV);
      for (let k = 0; k < 5; k++) {
        const f = 0.1 + 0.8 * (k / 4);
        const x = pt.x + (pb.x - pt.x) * f;
        const y = pt.y + (pb.y - pt.y) * f;
        ndc.set((x / w) * 2 - 1, -((y / h) * 2 - 1));
        ray.setFromCamera(ndc, camera);
        const hits = ray.intersectObjects(targets, true);
        if (!hits.length) continue;
        let o = hits[0].object;
        while (o && o !== proxy && !st.proxies.includes(o)) o = o.parent;
        if (o === proxy) stolen.push({ stone: id, k, px: [Math.round(x), Math.round(y)] });
      }
    }
    return { ok: stolen.length === 0, stolen, size: [w, h] };
  };

  // ─────────────────────────────── Audio helpers (§6.1, §8.4, §4.4) ───────────────────────────────
  const allow = (key) => {
    const M = world.music;
    return M && typeof M.allow === 'function' ? M.allow(key) : true;
  };
  const musicNow = () => {
    const M = world.music;
    if (M && typeof M.now === 'function') return M.now();
    return A.ready ? A.now() : state.time;
  };
  const eighth = () => {
    const e = world.music?.eighth;
    return Number.isFinite(e) && e > 0 ? e : EIGHTH_FALLBACK;
  };
  /** Seconds from now to the next grid time of `div` (visual code animates in state.time with it), or null. */
  const gridDelay = (div) => {
    const M = world.music;
    if (!M || typeof M.next !== 'function' || typeof M.now !== 'function') return null;
    const d = M.next(div) - M.now();
    return Number.isFinite(d) && d >= 0 && d < 8 ? d : null;
  };
  const elevNote = (dir) => {
    const elevDeg = Math.asin(clamp(dir.y, -1, 1)) / DEG;
    return PENTA[Math.floor(clamp((elevDeg - 4) / 14, 0, 0.999) * 5)];
  };
  const crownPan = () => {
    tmpV.copy(crown).project(camera);
    return clamp(tmpV.x, -1, 1) * 0.7;
  };

  // Voices are queued in visual time and started ≤ 0.1 s ahead, so every allow() call is made immediately
  // before its voice (§8.4) and a queue scheduled before the audio unlock survives the music-clock jump.
  // Two opt-outs, both for the one authored phrase the viewer can compose — the ogham word:
  //  • `when` (§4.4 rule 2): an absolute music-clock time, placed on the eighth grid ONCE when the word
  //    starts, so a frame hitch cannot re-derive and smear a 303 ms eighth. The visual letter unroll
  //    keeps running on state.time next to it, as rule 1 asks.
  //  • `budgeted = false`: skips M.allow() entirely, the way §8.4 exempts the conductor's own composed
  //    layers. A word is a fixed phrase, not a thinnable texture — a dropped letter is a wrong word —
  //    and a viewer who has just been playing the stones would otherwise lose its opening letters.
  //    Taps and hold plucks stay budgeted: those are the spam §8.4 exists to thin.
  const voices = [];
  for (let i = 0; i < VOICE_SLOTS; i++) {
    voices.push({ on: false, due: 0, when: NaN, kind: 'pluck', degree: 0, octave: 0, gain: 0.2, bright: 0.5, decay: 3, pan: 0, key: '', byAosSi: false, budgeted: true });
  }
  function queueVoice(delay, kind, degree, octave, gain, bright, decay, pan, key, byAosSi, when, budgeted) {
    let v = null;
    for (const x of voices) {
      if (!x.on) {
        v = x;
        break;
      }
    }
    if (!v) return;
    v.on = true;
    v.due = state.time + Math.max(0, delay);
    v.when = Number.isFinite(when) ? when : NaN;
    v.kind = kind;
    v.degree = degree;
    v.octave = octave;
    v.gain = gain;
    v.bright = bright;
    v.decay = decay;
    v.pan = pan;
    v.key = key;
    v.byAosSi = byAosSi;
    v.budgeted = budgeted !== false;
  }
  function pumpVoices() {
    for (const v of voices) {
      if (!v.on) continue;
      const lead = v.due - state.time;
      if (lead > VOICE_LOOKAHEAD) continue;
      v.on = false;
      if (v.budgeted && !allow(v.key)) continue;
      const l = Math.max(0, lead);
      // after the unlock the music clock IS the audio clock (§4.4), so a grid `when` goes straight
      // through; a `when` left stale by the unlock jump falls back to the queue's own lead.
      let when = musicNow() + l;
      if (A.ready) {
        const aNow = A.now();
        if (Number.isFinite(v.when) && v.when > aNow - 0.5 && v.when < aNow + 8) when = v.when;
        const opts = { when: Math.max(when, aNow), gain: v.gain, pan: v.pan, decay: v.decay };
        const hz = A.note(v.degree, v.octave);
        if (v.kind === 'pluck') {
          opts.bright = v.bright;
          A.pluck(hz, opts);
        } else {
          A.bell(hz, opts);
        }
      } else if (Number.isFinite(v.when)) {
        when = v.when;
      }
      events.emit('note:played', {
        src: 'sceach',
        degree: v.degree,
        octave: v.octave,
        voice: v.kind,
        when,
        byAosSi: v.byAosSi,
      });
    }
  }

  // ─────────────────────────────── Anchors ───────────────────────────────
  let wordAnchor = -1;
  /** Nearest free twig tip to `point`; without a point, a free tip on the side the camera sees. */
  function chooseAnchor(point, preferY) {
    let best = 0;
    let bestS = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      if (i === wordAnchor) continue;
      const a = anchors[i].pos;
      let s;
      if (point) {
        s = a.distanceTo(point) + (anchorSlot[i] >= 0 ? 0.45 : 0);
      } else {
        s = -facing(i, camera.position) + 0.45 * rng() + (anchorSlot[i] >= 0 ? 0.9 : 0);
        if (preferY !== undefined) s += 0.35 * Math.abs(a.y - preferY);
      }
      if (preferY !== undefined && a.y - 1.45 < base.y + 0.2) s += 1.5; // a 1.4 m word cloth must not reach the turf
      if (s < bestS) {
        bestS = s;
        best = i;
      }
    }
    return best;
  }

  // ─────────────────────────────── Motes ───────────────────────────────
  function fallbackViewDir(minE, maxE, out) {
    camera.getWorldDirection(tmpW);
    const az0 = Math.atan2(tmpW.x, -tmpW.z);
    const halfV = (camera.fov * DEG) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const az = az0 + (rng() * 2 - 1) * 0.8 * halfH;
    const pitch = Math.asin(clamp(tmpW.y, -1, 1));
    const top = (pitch + halfV) / DEG - 2;
    const hi = Math.min(maxE, top);
    const el = (hi < minE ? minE : minE + rng() * (hi - minE)) * DEG;
    return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
  }
  function pickDir(m) {
    const sky = world.sky;
    for (let attempt = 0; attempt < 4; attempt++) {
      let d = null;
      if (sky && typeof sky.pickViewDir === 'function') {
        try {
          d = sky.pickViewDir({ minElevDeg: 6, maxElevDeg: 17 });
        } catch {
          d = null;
        }
      }
      if (d && Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)) m.dir.copy(d).normalize();
      else fallbackViewDir(6, 17, m.dir);
      // fallbackViewDir reads camera.aspect, which is NaN on a 0x0 canvas; a NaN direction would go
      // out to sky.addStar and into the mote trail attribute. Due north at 11.5° elevation is the
      // middle of the band this picks from, so the fallback of the fallback is still in range.
      if (!Number.isFinite(m.dir.x) || !Number.isFinite(m.dir.y) || !Number.isFinite(m.dir.z) || m.dir.lengthSq() < 1e-6) {
        m.dir.set(0, Math.sin(11.5 * DEG), -Math.cos(11.5 * DEG));
      }
      let clash = false; // sky only knows stars that already exist: keep in-flight motes apart too
      for (const o of motes) if (o !== m && o.on && o.arcT0 >= 0 && o.dir.dot(m.dir) > Math.cos(2.5 * DEG)) clash = true;
      if (!clash) break;
    }
  }

  function spiralPos(m, f, out) {
    const ang = m.a0 + f * SPIRAL_TURNS * Math.PI * 2; // sunwise: compass φ increases
    const r = 0.35 + 0.95 * f;
    return out.set(
      m.center.x + r * Math.sin(ang),
      m.anchor.y + SPIRAL_RISE * f * (0.55 + 0.45 * f),
      m.center.z - r * Math.cos(ang),
    );
  }
  function motePos(m, t, out) {
    if (m.arcT0 < 0 || t < m.arcT0) return spiralPos(m, clamp((t - m.t0) / m.spiralDur, 0, 1), out);
    const f = clamp((t - m.arcT0) / m.arcDur, 0, 1);
    const s = 1 - (1 - f) * (1 - f) * (1 - 0.35 * f); // eases into the star
    const u = 1 - s;
    const b0 = u * u * u;
    const b1 = 3 * u * u * s;
    const b2 = 3 * u * s * s;
    const b3 = s * s * s;
    return out.set(
      m.p0.x * b0 + m.c1.x * b1 + m.c2.x * b2 + m.p3.x * b3,
      m.p0.y * b0 + m.c1.y * b1 + m.c2.y * b2 + m.p3.y * b3,
      m.p0.z * b0 + m.c1.z * b1 + m.c2.z * b2 + m.p3.z * b3,
    );
  }

  function launchMote(from, tailColor, ghost, pan) {
    let m = null;
    let oldest = null;
    for (const x of motes) {
      if (!x.on) {
        m = x;
        break;
      }
      if (!oldest || x.t0 < oldest.t0) oldest = x;
    }
    if (!m) {
      if (oldest.arcT0 < 0) beginArc(oldest);
      arrive(oldest);
      m = oldest;
    }
    m.on = true;
    m.t0 = state.time;
    m.spiralDur = SPIRAL_SECONDS / (1 - 0.3 * clamp(state.veil, 0, 1)); // §4.3: motes rise 30% slower with the veil
    m.anchor.copy(from);
    m.a0 = Math.atan2(from.x - crown.x, -(from.z - crown.z)) - 0.5;
    m.center.set(from.x - 0.35 * Math.sin(m.a0), from.y, from.z + 0.35 * Math.cos(m.a0));
    m.arcT0 = -1;
    m.ghost = ghost;
    m.gain = ghost ? 0.5 : 1;
    m.pan = pan;
    if (ghost) {
      m.tail.copy(C.verdigris);
      m.head.copy(C.boFinne).lerp(C.verdigris, 0.45);
    } else {
      m.tail.copy(tailColor);
      m.head.copy(C.boFinne);
    }
  }

  function beginArc(m) {
    spiralPos(m, 1, m.p0);
    pickDir(m);
    m.p3.copy(camera.position).addScaledVector(m.dir, ARC_DIST); // camera frozen at the start of the arc (§3.5)
    const L = m.p0.distanceTo(m.p3);
    m.c1.copy(m.p0);
    m.c1.y += 0.22 * L;
    m.c2.lerpVectors(m.p0, m.p3, 0.72);
    m.c2.y += 0.06 * L;
    // land on the eighth grid (§8.4): delay computed once, animated in state.time (§4.4 rule 1)
    const g = gridDelay('eighth');
    if (g !== null) {
      const e = eighth();
      const n = Math.max(0, Math.round((ARC_SECONDS - g) / e));
      m.arcDur = g + n * e;
    } else {
      m.arcDur = ARC_SECONDS;
    }
    m.arcT0 = state.time;
  }

  function arrive(m) {
    if (!m.on) return;
    m.on = false;
    const sky = world.sky;
    if (sky && typeof sky.addStar === 'function') {
      const d = wishDirs[wishDirHead];
      wishDirHead = (wishDirHead + 1) % WISH_DIR_POOL;
      d.copy(m.dir);
      try {
        sky.addStar(d, { kind: 'wish', color: TORC_HEX, mag: 1.2, anchor: 'air', byAosSi: m.ghost });
      } catch (err) {
        console.error('[sceach] sky.addStar threw', err);
      }
    }
    queueVoice(0, 'bell', elevNote(m.dir), 2, 0.1 * m.gain, 0, 4, m.pan, 'sceach:star', m.ghost);
  }

  const zeroMote = (i) => {
    for (let k = 0; k < TRAIL; k++) moteCol[(i * TRAIL + k) * 4 + 3] = 0;
  };

  function updateMotes(t) {
    let any = false;
    let dirty = false;
    for (let i = 0; i < MOTE_MAX; i++) {
      const m = motes[i];
      if (!m.on) {
        if (moteCol[i * TRAIL * 4 + 3] !== 0) {
          zeroMote(i);
          dirty = true;
        }
        continue;
      }
      if (m.arcT0 < 0 && t >= m.t0 + m.spiralDur) beginArc(m);
      if (m.arcT0 >= 0 && t >= m.arcT0 + m.arcDur) {
        arrive(m);
        zeroMote(i);
        dirty = true;
        continue;
      }
      any = true;
      dirty = true;
      motePos(m, t, tmpV);
      const dist = tmpV.distanceTo(camera.position);
      motePos(m, t - 0.02, tmpW);
      const speed = Math.max(0.5, tmpW.distanceTo(tmpV) / 0.02);
      const tail = TAIL_M * clamp(dist / 26, 1, 3); // constant apparent length as it recedes into the sky
      const h = Math.min(0.05, tail / (TRAIL - 1) / speed);
      const age = t - m.t0;
      const fin = m.arcT0 >= 0 ? 1 - smoothstep(0.86, 1, (t - m.arcT0) / m.arcDur) : 1;
      const k0 = smoothstep(0, 0.12, age) * fin * (m.ghost ? 0.6 : 1);
      for (let k = 0; k < TRAIL; k++) {
        const o = i * TRAIL + k;
        const tk = t - k * h;
        if (tk < m.t0) {
          moteCol[o * 4 + 3] = 0;
          continue;
        }
        motePos(m, tk, tmpW);
        moteXYZ[o * 3] = tmpW.x;
        moteXYZ[o * 3 + 1] = tmpW.y;
        moteXYZ[o * 3 + 2] = tmpW.z;
        if (k === 0) {
          const I = 3.0 * k0;
          moteCol[o * 4] = m.head.r * I;
          moteCol[o * 4 + 1] = m.head.g * I;
          moteCol[o * 4 + 2] = m.head.b * I;
          moteCol[o * 4 + 3] = 4.0;
        } else {
          const f = 1 - k / TRAIL;
          const I = 2.2 * Math.pow(f, 1.4) * k0;
          moteCol[o * 4] = m.tail.r * I;
          moteCol[o * 4 + 1] = m.tail.g * I;
          moteCol[o * 4 + 2] = m.tail.b * I;
          // samples are ~0.8/15 m apart: wide enough sprites that the 0.8 m tail reads as one streak
          moteCol[o * 4 + 3] = 3.2 + 0.8 * f;
        }
      }
    }
    motePoints.visible = any;
    if (dirty) {
      motePosAttr.needsUpdate = true;
      moteColAttr.needsUpdate = true;
    }
  }

  // ─────────────────────────────── Offerings ───────────────────────────────
  let dyeCycle = 0;
  let wishIndex = 0;

  function arpeggio(pan, ghost) {
    let chord = null;
    const M = world.music;
    if (M && typeof M.chord === 'function') {
      try {
        chord = M.chord();
      } catch {
        chord = null;
      }
    }
    if (!Array.isArray(chord) || chord.length < 3 || !chord.every(Number.isFinite)) chord = [0, 2, 4];
    const g = ghost ? 0.1 : 0.2; // aos sí: audio ×0.5
    for (let i = 0; i < 3; i++) queueVoice(0.09 * i, 'pluck', chord[i], 1, g, 0.7, 3, pan, `sceach:arp${i}`, ghost);
    pumpVoices(); // the first pluck is the immediate, unquantised response (§6.1)
  }

  function emitTie({ ai, dyeIdx, word, ogham, weight, source, ghost }) {
    const pos = anchors[ai].pos;
    api.lastWish = { word, ogham };
    events.emit('offering', { kind: 'wish', weight, source, pos: pos.clone(), byAosSi: ghost });
    events.emit('wish:tied', { index: wishIndex++, word, ogham, dye: DYE_NAMES[dyeIdx], pos: pos.clone(), byAosSi: ghost });
  }

  /** Tap sceach (and the ghost wish of the aos sí): §6.2. */
  function tapWish(point, pan, ghost, weight, source) {
    const ai = chooseAnchor(point);
    const dyeIdx = ghost ? 2 : dyeCycle;
    if (!ghost) dyeCycle = (dyeCycle + 1) % 3;
    writeRibbon(allocSlot(), ai, dyeIdx, ghost, false, state.time);
    launchMote(anchors[ai].pos, dyeColor(dyeIdx), ghost, pan);
    arpeggio(pan, ghost);
    state.energyTarget += ghost ? 0.03 : 0.06;
    emitTie({ ai, dyeIdx, word: null, ogham: null, weight, source, ghost });
  }

  // Word ribbon lifecycle: unroll (1 s) → [held | typed: word + linger] → release (tie, mote, events) → roll up.
  const word = {
    active: false,
    released: false,
    token: 0,
    t0: 0,
    ai: -1,
    auto: false,
    autoAt: 0,
    fadeAt: 0,
    lastLetter: 0,
    word: '',
    ogham: '',
    source: 'hold',
    weight: 3,
    pan: 0,
  };
  const letterBuf = [];

  function startWord(wordStr, oghamStr, letters, ai, pan, source, auto, weight) {
    if (word.active) {
      if (!word.released) releaseWord();
      endWordVisual();
    }
    word.active = true;
    word.released = false;
    word.token++;
    word.t0 = state.time;
    word.ai = ai;
    wordAnchor = ai;
    word.auto = auto;
    word.word = wordStr;
    word.ogham = oghamStr;
    word.source = source;
    word.weight = weight;
    word.pan = pan;
    const n = Math.min(letters.length, MAX_LETTERS);
    wordTex.draw(letters);
    const lay = wordLayout(n);
    wordU.uX0.value = lay.x0;
    wordU.uSlotW.value = lay.slotW;
    wordU.uCount.value = n;
    const a = anchors[ai];
    wordU.uAnchor.value.copy(a.pos);
    wordU.uAnchorSway.value = a.sway;
    wordU.uWSeed.value = rng();
    wordU.uUnroll.value = 0;
    wordU.uGlow.value = 0;
    // §6.3: one eighth per letter, starting at M.next('eighth') (A.now()+0.35 without a conductor).
    // w0 is taken once, here, and every letter carries its own absolute grid time (§4.4 rule 2);
    // uLetterT0 animates the same phrase in the visual clock (rule 1).
    const d0 = gridDelay('eighth') ?? 0.35;
    const e = eighth();
    const w0 = musicNow() + d0;
    wordU.uLetterT0.value = state.time + d0;
    wordU.uEighth.value = e;
    for (let k = 0; k < n; k++) {
      const v = letterVoice(letters[k]);
      queueVoice(d0 + k * e, v.voice, v.degree, v.octave, v.gain, 0.6, v.decay, pan, `sceach:w${k}`, false, w0 + k * e, false);
    }
    pumpVoices();
    word.lastLetter = state.time + d0 + Math.max(0, n - 1) * e;
    word.autoAt = Math.max(word.t0 + UNROLL_SECONDS, word.lastLetter + e) + 1.2;
    wordMesh.visible = true;
    return word.token;
  }

  function releaseWord() {
    if (!word.active || word.released) return;
    word.released = true;
    const t = state.time;
    word.fadeAt = Math.max(t + 0.45, word.lastLetter + 0.5, word.t0 + UNROLL_SECONDS * 0.6);
    // the cloth stays tied on the tree as a linen ribbon, knotted as the word rolls up
    writeRibbon(allocSlot(), word.ai, 2, false, false, word.fadeAt + 0.25);
    launchMote(anchors[word.ai].pos, C.torc, false, word.pan);
    state.energyTarget += 0.08;
    emitTie({ ai: word.ai, dyeIdx: 2, word: word.word, ogham: word.ogham, weight: word.weight, source: word.source, ghost: false });
  }

  function endWordVisual() {
    word.active = false;
    wordAnchor = -1;
    wordMesh.visible = false;
    wordU.uGlow.value = 0;
    wordU.uUnroll.value = 0;
  }

  function updateWord(t) {
    if (!word.active) return;
    if (word.auto && !word.released && t >= word.autoAt) releaseWord();
    const u = clamp((t - word.t0) / UNROLL_SECONDS, 0, 1);
    let un = 1 - Math.pow(1 - u, 3);
    let glow = smoothstep(0, 0.35, t - word.t0);
    if (word.released) {
      const r = clamp((t - word.fadeAt) / 1.1, 0, 1);
      un *= 1 - r * r * (3 - 2 * r);
      glow *= 1 - smoothstep(0, 0.7, t - word.fadeAt);
      if (r >= 1) {
        endWordVisual();
        return;
      }
    }
    wordU.uUnroll.value = un;
    wordU.uGlow.value = glow;
  }

  /** §5.2 act(): a hold on the sceach claimed the gesture. Returns release(heldMs). */
  function makeAct(point, pan) {
    return function act() {
      const w = HOLD_WORDS[holdWordIdx % HOLD_WORDS.length];
      holdWordIdx++;
      const letters = lettersFromWord(w, []);
      const ai = chooseAnchor(point, crown.y);
      const token = startWord(w, oghamString(letters), letters, ai, pan, 'hold', false, 3);
      let released = false;
      return function release() {
        if (released) return;
        released = true;
        if (word.active && word.token === token) releaseWord();
      };
    };
  }
  let holdWordIdx = 0;

  // ─────────────────────────────── Events ───────────────────────────────
  let hoverTarget = 0;
  offs.push(
    ctx.input.addPickable(proxy, {
      onClick: (hit) => tapWish(hit?.point ?? crown, clamp(ctx.input.pointer.x, -1, 1) * 0.7, false, 2, 'tap'),
      onHover: () => {
        hoverTarget = 1;
      },
      onHoverEnd: () => {
        hoverTarget = 0;
      },
    }),
  );

  const raycaster = new THREE.Raycaster();
  const holdHits = [];
  let directRelease = null;
  offs.push(
    events.on('hold:start', (p) => {
      if (!p || !p.ray) return;
      raycaster.ray.copy(p.ray);
      raycaster.near = 0;
      raycaster.far = Infinity;
      holdHits.length = 0;
      raycaster.intersectObject(proxy, true, holdHits);
      if (!holdHits.length) return;
      const point = holdHits[0].point.clone();
      const pan = clamp(p.ndc?.x ?? 0, -1, 1) * 0.7;
      const act = makeAct(point, pan);
      if (world.bealach) {
        p.candidates ??= [];
        p.candidates.push({ by: 'sceach', distance: holdHits[0].distance, act });
      } else {
        directRelease = act();
      }
    }),
  );
  offs.push(
    events.on('hold:end', (p) => {
      if (!directRelease) return;
      const r = directRelease;
      directRelease = null;
      r(p?.heldMs ?? 0);
    }),
  );
  offs.push(
    events.on('ogham:word', (p) => {
      if (!p) return;
      const wordStr = typeof p.word === 'string' ? p.word.toLowerCase() : '';
      let letters = lettersFromWord(wordStr, letterBuf);
      if (!letters.length) letters = lettersFromOgham(p.ogham, letterBuf);
      const ogham = typeof p.ogham === 'string' && p.ogham.length ? p.ogham : oghamString(letters);
      const pan = crownPan();
      if (!letters.length) {
        // nothing writable (e.g. only j k p v w x y): the wish is still tied and still flies
        const ai = chooseAnchor(null, crown.y);
        writeRibbon(allocSlot(), ai, 2, false, false, state.time);
        launchMote(anchors[ai].pos, C.torc, false, pan);
        state.energyTarget += 0.08;
        emitTie({ ai, dyeIdx: 2, word: wordStr || null, ogham: ogham || null, weight: 3, source: 'word', ghost: false });
        return;
      }
      const ai = chooseAnchor(null, crown.y);
      startWord(wordStr, ogham, letters.slice(), ai, pan, 'word', true, 3);
    }),
  );
  offs.push(
    events.on('aossi:offer', (p) => {
      if (!p || p.kind !== 'wish') return;
      tapWish(null, crownPan(), true, Number.isFinite(p.weight) ? p.weight : 1.5, 'aossi');
    }),
  );

  let beckonOn = false;
  let beckonT = -1;
  offs.push(
    events.on('hint:change', (p) => {
      beckonOn = !!p && p.target === 'wish';
      if (!beckonOn) beckonT = -1;
    }),
  );
  offs.push(
    events.on('music:beat', (p) => {
      if (!beckonOn || reduced || !p || p.beatInBar !== 0) return;
      beckonT = state.time + (Number.isFinite(p.delay) ? clamp(p.delay, 0, 1) : 0); // §4.4 rule 1
    }),
  );
  let phase = 'idle';
  offs.push(
    events.on('bealach:phase', (p) => {
      if (p && typeof p.phase === 'string') phase = p.phase;
    }),
  );

  // ─────────────────────────────── Resize ───────────────────────────────
  function onResize() {
    const h = ctx.size?.height ?? innerHeight;
    const dpr = ctx.size?.dpr ?? 1;
    // A hidden or zero-height canvas reports height 0; px/m would then be 0 and the shaders divide
    // by it (minimum twig width, ribbon width), turning every vertex into Inf/NaN. The guard is
    // below every real value (a 1 px-tall viewport), so it never bites on a visible canvas.
    const px = (h * dpr) / (2 * Math.tan((camera.fov * DEG) / 2));
    own.uPxScale.value = Number.isFinite(px) && px > 1 ? px : 1;
    own.uDpr.value = dpr > 0 ? dpr : 1;
  }
  onResize();

  // ─────────────────────────────── Frame ───────────────────────────────
  function update(dt, t) {
    const E = state.energy;
    const V = clamp(state.veil, 0, 1);
    const T = U.uClimaxT.value;

    // §7.3 hush: ribbons lift and go still (pure function of T); they return to the wind after the return phase
    const hk = T >= 0 ? smoothstep(0, 1.2, T) * (1 - smoothstep(30, 34, T)) : 0;

    let env = 0;
    if (beckonT >= 0) {
      const a = (t - beckonT) / 0.8;
      if (a >= 0 && a <= 1) env = Math.sin(Math.PI * a);
      else if (a > 1) beckonT = -1;
    }
    // §4.3: gravity ×(1 − 0.7·V) against a steady breeze → the cloth's angle from vertical
    const lift = Math.atan(0.3 / (1 - 0.7 * V)) + 0.55 * env;
    ribU.uLift.value = mix(lift, 1.1, hk);
    ribU.uFlutter.value = (0.5 + 0.5 * E) * (1 - hk);
    own.uSwayAmp.value = (0.45 + 0.55 * E) * (1 - hk);
    ribU.uBeckon.value = env;
    ribU.uBeckonStatic.value = reduced && beckonOn ? 0.2 : 0;
    ribU.uRiverGlow.value = T >= 0 ? smoothstep(16, 18, T) * (1 - smoothstep(26, 30, T)) : 0;

    uHover.value += (hoverTarget - uHover.value) * (1 - Math.exp(-dt * 10));

    updateWord(t);
    updateMotes(t);
    pumpVoices();

    // §7.3: bloom at T 28, gone by the end of the fade. The shader drives every point to fade 0 the
    // instant it lands, and the latest landing is T = 137 (fs ≤ 130, dur ≤ 7), so the draw is retired
    // a second later; after that the object is hidden and the points are degenerate as well.
    blossoms.visible = T >= 28 && T < 138;
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
    directRelease = null;
    for (const o of objects) scene.remove(o);
    for (const d of disposables) d.dispose?.();
    if (world.sceach === api) delete world.sceach;
  }

  // expose read-only debug state for acceptance checks
  Object.defineProperty(api, 'debug', {
    enumerable: false,
    get: () => ({
      phase,
      ribbons: ribbons.count,
      ghostRibbons: (() => {
        let n = 0;
        for (let i = 0; i < ribbons.count; i++) if (aInfo.getY(i) > 0.5) n++;
        return n;
      })(),
      motesActive: motes.filter((m) => m.on).length,
      ghostMotes: motes.filter((m) => m.on && m.ghost).length,
      word: word.active ? { word: word.word, released: word.released, unroll: wordU.uUnroll.value } : null,
      lift: ribU.uLift.value,
      flutter: ribU.uFlutter.value,
      beckon: ribU.uBeckon.value,
      beckonStatic: ribU.uBeckonStatic.value,
      beckonArmed: beckonOn,
      riverGlow: ribU.uRiverGlow.value,
      blossomVisible: blossoms.visible,
      foliage: !!foliage,
      draws: [treeMesh, foliage, ribbons, wordMesh, motePoints, blossoms].filter((o) => o && o.visible).length,
    }),
  });

  return { update, onResize, dispose };
}
