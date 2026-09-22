// fire — the islet, the small blackbody fire, sparks, ember-star flights, hill beacons, uFireLevel.
// docs/DESIGN.md §10.5 (+ §2, §3.4, §3.6, §4.3, §4.4, §5, §6.2, §7.1, §7.3, §8, §11).
import * as THREE from 'three';
import {
  ISLET_VERT,
  ISLET_FRAG,
  FLAME_VERT,
  FLAME_FRAG,
  SPARK_VERT,
  SPARK_FRAG,
  MOTE_VERT,
  MOTE_FRAG,
} from './fire/shaders.js';
import { buildIsletAndLogs, buildFlameGeometry, buildSparkGeometry } from './fire/geometry.js';

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
const EMBER_STAR_MAX = 40; // §6.2: at most 40 ember stars, the oldest is removed
const FLIGHT_MAX = 8; // §10.5: ≤ 8 motes
const BURST_SLOTS = 8;
const FLIGHT_SECONDS = 1.2;
const FLIGHT_DIST = 60; // camLaunch + dir·60
const EIGHTH_FALLBACK = 60 / 66 / 3; // dotted quarter = 66 (§8.2)
const SURGE_ATTACK = 0.14;
const SURGE_DECAY = 2.5;
const COS_2_5 = Math.cos(2.5 * DEG);

// Beacons light sunwise starting at φ = 336° (§10.5 "Beacon order").
const BEACON_ORDER = (() => {
  const start = LAYOUT.beacons.indexOf(336);
  return LAYOUT.beacons.map((_, i) => LAYOUT.beacons[(start + i) % LAYOUT.beacons.length]);
})();

// NaN-absorbing on purpose, and otherwise bit-identical to `x < a ? a : x > b ? b : x` for every
// finite x. `fire` is the sole writer of uFireLevel, which every other module's fireLight() multiplies
// into its colour, so one non-finite frame here would black out the whole piece the way loch/mist.js
// did — and the old form passed a NaN straight through every clamp in this file.
const clamp = (x, a, b) => (x > a ? (x < b ? x : b) : a);
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const mix = (a, b, t) => a + (b - a) * t;
const easeInOutSine = (x) => -(Math.cos(Math.PI * clamp(x, 0, 1)) - 1) / 2;

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

/** §6.1 elevation degree: PENTA[floor(clamp((elevDeg − 4) / 14, 0, 0.999) · 5)]. */
function elevNote(dir) {
  const elevDeg = Math.asin(clamp(dir.y, -1, 1)) / DEG;
  return PENTA[Math.floor(clamp((elevDeg - 4) / 14, 0, 0.999) * 5)];
}

/**
 * Visible flame height for a level: 1.4 m at idle (0.5), ≈3.1 m at a surge (1.0), low licks at embers.
 * DESIGN-QUESTION: §10.5 sizes the flame quads `mix(1.4, 3.2, clamp(level, 0, 1))`, which is 2.1–2.6 m at the idle
 * levels 0.4–0.65, while §3.4/§3.5 want a 1.4 m idle flame with its tip at (640, 424). Both are honoured: the quad
 * uses the §10.5 formula and the shader fills a level-dependent fraction of it (`fill`), so the visible tongue is
 * ≈1.32 m at level 0.4, ≈1.45 m at 0.5 and ≈2.8 m at a surge (≈3.1 m with the parcel overshoot).
 */
function flameQuadHeight(level) {
  return mix(LAYOUT.fire.flameIdle, LAYOUT.fire.flameMax, clamp(level, 0, 1));
}
function flameVisibleHeight(level) {
  // 0.42 m at embers, 1.32 m at the E=0 idle level 0.4, 1.45 m at level 0.5, 2.82 m at a surge —
  // and the rising parcels overshoot it by ~10%, so the visible tongue tops out at the §3.4 3.2 m.
  const fill = 0.25 + 0.38 * smoothstep(0.15, 0.42, level) + 0.25 * smoothstep(0.5, 1.0, level);
  return flameQuadHeight(level) * fill;
}
/**
 * Quad half-width. §10.5 sizes the quad 1.2 m wide, which is right for the 1.4 m idle flame and is
 * kept exactly (0.6) up to the idle levels; above that it widens with the flame, because a 3.2 m
 * surge inside a 1.2 m box can only be a vertical jet (art review, rev 2).
 */
function flameQuadHalfWidth(level) {
  return 0.6 * Math.max(1, 0.72 + 0.7 * clamp(level, 0, 1));
}

/**
 * Climax level as a pure function of T (§7.3 fire column), blended with the normal level.
 * hush: → 0.15 over 1.5 s · pillar/pour: embers · river: from T 24, 0.15 → 1.0 ·
 * return: 1.5 white-gold at T 26.5, settles to 0.7 by T 34 · afterglow: normal (blend over T 34–38).
 */
function climaxLevel(T, normal) {
  if (T < 1.5) return mix(normal, 0.15, easeInOutSine(T / 1.5));
  if (T < 24) return 0.15;
  if (T < 26) return mix(0.15, 1.0, easeInOutSine((T - 24) / 2));
  if (T < 26.5) return mix(1.0, 1.5, easeInOutSine((T - 26) / 0.5));
  if (T < 29) return 1.5;
  if (T < 34) return mix(1.5, 0.7, easeInOutSine((T - 29) / 5));
  return mix(0.7, normal, easeInOutSine((T - 34) / 4));
}

export default async function setup(ctx) {
  const { scene, camera, events, world, state } = ctx;
  const A = ctx.audio;
  const U = ctx.uniforms;
  // §3.6 extension uniforms: create lazily, share the same objects. `fire` is the only writer of uFireLevel.
  U.uFireLevel ??= { value: 0 };
  U.uClimaxT ??= { value: -1 };
  U.uAfterglow ??= { value: 0 };
  U.uOtherAngle ??= { value: 0 };
  const shared = pick(U, ['uTime', 'uEnergy', 'uVeil', 'uFirePos', 'uFireLevel', 'uClimaxT', 'uAfterglow', 'uOtherAngle']);

  const low = ctx.quality === 'low';
  const rng = ctx.makeRng('fire');
  const [fx, fy, fz] = LAYOUT.fire.pos;
  world.firePos.set(fx, fy, fz);

  const palette = ctx.palette;
  const cLichen = new THREE.Color(palette.lichen);
  const cEmber = new THREE.Color(palette.ember);
  const cTorc = new THREE.Color(palette.torc);
  const cBoFinne = new THREE.Color(palette.boFinne);
  const cVerdigris = new THREE.Color(palette.verdigris);
  const TORC_HEX = parseInt(String(palette.torc).replace('#', ''), 16);

  const disposables = [];
  const offs = [];
  const group = new THREE.Group();
  group.name = 'fire';
  scene.add(group);

  // Shared by islet embers and flame: hover rim (+15%) and reduced-motion beckon (+20%).
  const uGlow = { value: 1 };

  // ───────────── Islet + logs (1 draw) ─────────────
  const isletGeo = buildIsletAndLogs(rng, {
    segments: low ? 32 : 48,
    radius: LAYOUT.islet.radius,
    top: LAYOUT.islet.top,
  });
  const isletMat = new THREE.ShaderMaterial({
    name: 'fire.islet',
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...shared,
      uLichen: { value: cLichen },
      uEmberC: { value: cEmber },
      uGlow,
    },
    vertexShader: ISLET_VERT,
    fragmentShader: ISLET_FRAG,
    fog: true,
  });
  const islet = new THREE.Mesh(isletGeo, isletMat);
  islet.name = 'fire.islet';
  group.add(islet);
  disposables.push(isletGeo, isletMat);

  // ───────────── Flame (1 draw, two Y-billboard quads) ─────────────
  const flameGeo = buildFlameGeometry();
  const uFlameH = { value: flameQuadHeight(0.15) };
  const uFlameV = { value: flameVisibleHeight(0.15) };
  const uFlameW = { value: flameQuadHalfWidth(0.15) };
  const flameMat = new THREE.ShaderMaterial({
    name: 'fire.flame',
    uniforms: {
      uTime: U.uTime,
      uVeil: U.uVeil,
      uFireLevel: U.uFireLevel,
      uFirePos: U.uFirePos,
      uFlameH,
      uFlameV,
      uFlameW,
      uGlow,
      uEmberC: { value: cEmber },
      uTorcC: { value: cTorc },
      uBoFinneC: { value: cBoFinne },
    },
    defines: { FLAME_LAYERS: low ? 1 : 2 },
    vertexShader: FLAME_VERT,
    fragmentShader: FLAME_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.name = 'fire.flame';
  flame.frustumCulled = false;
  flame.renderOrder = 2;
  group.add(flame);
  disposables.push(flameGeo, flameMat);

  // ───────────── Sparks (1 draw, GPU-stateless) ─────────────
  const sparkTotal = low ? 600 : 1500;
  const sparkPool = buildSparkGeometry(rng, sparkTotal);
  const burstValues = [];
  for (let i = 0; i < BURST_SLOTS; i++) burstValues.push(new THREE.Vector3(-1000, 0, 0));
  const uRate = { value: 0 };
  const uHold = { value: new THREE.Vector3(-1000, 0, 0) };
  const uPx = { value: 800 };
  const uDpr = { value: ctx.size.dpr || 1 };
  const sparkMat = new THREE.ShaderMaterial({
    name: 'fire.sparks',
    uniforms: {
      uTime: U.uTime,
      uEnergy: U.uEnergy,
      uFirePos: U.uFirePos,
      uFireLevel: U.uFireLevel,
      uBursts: { value: burstValues },
      uRate,
      uHold,
      uTapCount: { value: Math.min(40, sparkPool.slotSize) },
      uPlumeCount: { value: Math.min(120, sparkPool.slotSize) },
      uPx,
      uDpr,
      uFlameV,
      uEmberC: { value: cEmber },
      uTorcC: { value: cTorc },
      uVerdigrisC: { value: cVerdigris },
    },
    vertexShader: SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sparks = new THREE.Points(sparkPool.geometry, sparkMat);
  sparks.name = 'fire.sparks';
  sparks.frustumCulled = false;
  sparks.renderOrder = 3;
  group.add(sparks);
  disposables.push(sparkPool.geometry, sparkMat);
  let burstCursor = 0;

  // ───────────── Ember flights + hill beacons (1 draw, 17 CPU points) ─────────────
  const MOTE_COUNT = FLIGHT_MAX + BEACON_ORDER.length;
  const motePos = new Float32Array(MOTE_COUNT * 3);
  const moteCol = new Float32Array(MOTE_COUNT * 3);
  const moteSize = new Float32Array(MOTE_COUNT);
  const moteFog = new Float32Array(MOTE_COUNT);
  const moteHalo = new Float32Array(MOTE_COUNT); // 1 on the beacons: core + ember halo + ridge smudge
  const moteGeo = new THREE.BufferGeometry();
  const motePosAttr = new THREE.BufferAttribute(motePos, 3).setUsage(THREE.DynamicDrawUsage);
  const moteColAttr = new THREE.BufferAttribute(moteCol, 3).setUsage(THREE.DynamicDrawUsage);
  const moteSizeAttr = new THREE.BufferAttribute(moteSize, 1).setUsage(THREE.DynamicDrawUsage);
  moteGeo.setAttribute('position', motePosAttr);
  moteGeo.setAttribute('aColor', moteColAttr);
  moteGeo.setAttribute('aSize', moteSizeAttr);
  moteGeo.setAttribute('aFog', new THREE.BufferAttribute(moteFog, 1));
  moteGeo.setAttribute('aHalo', new THREE.BufferAttribute(moteHalo, 1));
  const moteMat = new THREE.ShaderMaterial({
    name: 'fire.motes',
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uDpr },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.name = 'fire.flights+beacons';
  motes.frustumCulled = false;
  motes.renderOrder = 3;
  group.add(motes);
  disposables.push(moteGeo, moteMat);

  // Beacons: fixed positions on the ridge (terrain loads earlier; fallback 420·tan 2° + 4).
  const beaconAmt = new Float32Array(BEACON_ORDER.length);
  const beaconPhase = new Float32Array(BEACON_ORDER.length);
  const beaconRate = new Float32Array(BEACON_ORDER.length); // each hill fire breathes on its own clock
  const ridgeR = LAYOUT.hills.ridgeR;
  for (let i = 0; i < BEACON_ORDER.length; i++) {
    const phi = BEACON_ORDER[i];
    let ridge = ridgeR * Math.tan(2 * DEG);
    try {
      const ry = world.terrain?.ridgeY?.(phi);
      if (Number.isFinite(ry)) ridge = ry;
    } catch {
      /* a half-written sibling must never stop the fire from lighting: keep the 420·tan 2° fallback */
    }
    const o = (FLIGHT_MAX + i) * 3;
    motePos[o] = ridgeR * Math.sin(phi * DEG);
    motePos[o + 1] = ridge + 4;
    motePos[o + 2] = -ridgeR * Math.cos(phi * DEG);
    moteFog[FLIGHT_MAX + i] = 1;
    moteHalo[FLIGHT_MAX + i] = 1;
    beaconPhase[i] = rng() * 100;
    beaconRate[i] = 0.72 + rng() * 0.56;
  }

  // ───────────── Proxy (invisible, pickable) ─────────────
  // DESIGN-QUESTION: §10.5 sizes the proxy r 1.5 × h 3.6 from the islet top, i.e. up to y = 3.95 —
  // 1.6× of flameMax rather than of the idle flame. At the default camera that column covers the
  // projected body of portal stone id10 standing 12.5 m behind it, and the fire is nearer, so it won
  // the pick and a tap meant for the west portal surged the fire instead (ux review, rev 2). §10.0's
  // proxy rule already carves out "except where a proxy would cover a neighbouring pickable at the
  // default camera", so the height is capped at 1.6× the 1.4 m *idle* flame and the radius is kept
  // inside the r 1.4 islet. Screen box becomes x 594–686, y ≈ 395–471; the flame is still easy to hit
  // at its base, which is where the eye aims anyway.
  const PROXY_H = 1.6 * LAYOUT.fire.flameIdle; // 2.24 m
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const proxyR = LAYOUT.islet.radius * (coarse ? 2.2 / 1.6 : 1); // 1.4, or 1.93 on coarse pointers (§6.1)
  const proxyGeo = new THREE.CylinderGeometry(proxyR, proxyR, PROXY_H, 20, 1);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const proxy = new THREE.Mesh(proxyGeo, proxyMat);
  proxy.name = 'fire.proxy';
  proxy.position.set(fx, fy + PROXY_H / 2, fz);
  group.add(proxy);
  proxy.updateMatrixWorld(true);
  disposables.push(proxyGeo, proxyMat);

  // ───────────── State ─────────────
  let level = 0.15;
  let phase = 'idle';
  let beckonActive = false;
  let flareT = -1;
  let hoverTarget = 0;
  let hoverAmt = 0;

  const surges = [];
  for (let i = 0; i < 4; i++) surges.push({ t0: -1000, peak: 0 });
  let surgeCursor = 0;

  const hold = { active: false, t0: -1000, amt: 0, nextDrum: 0 };
  let directRelease = null;

  const flights = [];
  for (let i = 0; i < FLIGHT_MAX; i++) {
    flights.push({
      on: false,
      t0: 0,
      dur: FLIGHT_SECONDS,
      p0: new THREE.Vector3(),
      c1: new THREE.Vector3(),
      c2: new THREE.Vector3(),
      p3: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      ghost: false,
      dim: 1,
      bellDeg: -1,
      gain: 0.08,
      when: -1,
      pan: 0,
    });
  }
  const emberIds = new Array(EMBER_STAR_MAX).fill(-1);
  const emberDirs = [];
  for (let i = 0; i < EMBER_STAR_MAX; i++) emberDirs.push(new THREE.Vector3());
  let emberHead = 0;
  let emberCount = 0;

  const tmpV = new THREE.Vector3();
  const tmpF = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  // Reused voice-option objects: `arrive` and the hold roll run inside update(), where §10.0 forbids allocation.
  const bellOpts = { gain: 0.08, pan: 0, when: undefined };
  const rollOpts = { pitch: 66, gain: 0.18, bus: 'sfx' };

  // ───────────── Helpers: audio (§6.1, §8.4) ─────────────
  // Every call into a sibling's API is wrapped: `?only=` subsets and half-written siblings must degrade, never throw.
  const allow = (key) => {
    const M = world.music;
    if (!M || typeof M.allow !== 'function') return true;
    try {
      return M.allow(key) !== false;
    } catch {
      return true;
    }
  };
  const musicNow = () => {
    const M = world.music;
    if (M && typeof M.now === 'function') {
      try {
        const n = M.now();
        if (Number.isFinite(n)) return n;
      } catch {
        /* fall through to the audio/visual clock */
      }
    }
    return A.ready ? A.now() : state.time;
  };
  // DESIGN-QUESTION: §6.2 writes the fire drums without a bus (core default 'music'); §8.1 routes "every interaction
  // voice" to 'sfx', so fire passes bus:'sfx'. Whooshes emit no note:played (its `voice` enum has no whoosh).
  function noteDrum(opts, key, byAosSi) {
    if (!allow(key)) return;
    A.drum(opts);
    events.emit('note:played', { src: 'fire', degree: null, octave: 0, voice: 'drum', when: opts.when ?? musicNow(), byAosSi });
  }
  function noteBell(degree, octave, opts, key, byAosSi) {
    if (!allow(key)) return;
    A.bell(A.note(degree, octave), opts);
    events.emit('note:played', { src: 'fire', degree, octave, voice: 'bell', when: opts.when ?? musicNow(), byAosSi });
  }
  function whoosh(opts, key) {
    if (!allow(key)) return;
    A.whoosh(opts);
  }
  function firePan() {
    tmpV.set(fx, fy + 0.7, fz).project(camera);
    return clamp(tmpV.x, -1, 1) * 0.7;
  }

  // ───────────── Helpers: visuals ─────────────
  const baseLevelAt = (t) => {
    const idle = 0.4 + 0.25 * state.energy; // §4.3
    return 0.15 + (idle - 0.15) * smoothstep(3, 9, t); // §7.1 arrival: embers → idle over 3–9 s
  };
  const choreoActive = () => {
    const T = U.uClimaxT.value;
    return T >= 0 && T < 34;
  };

  function addSurge(peak) {
    const s = surges[surgeCursor];
    surgeCursor = (surgeCursor + 1) % surges.length;
    s.t0 = state.time;
    s.peak = peak;
  }

  function addBurst(kind, strength) {
    // reuse the slot whose burst started longest ago
    let best = burstCursor;
    let oldest = Infinity;
    for (let i = 0; i < BURST_SLOTS; i++) {
      if (burstValues[i].x < oldest) {
        oldest = burstValues[i].x;
        best = i;
      }
    }
    burstValues[best].set(state.time, strength, kind);
    burstCursor = (best + 1) % BURST_SLOTS;
  }

  function fallbackViewDir(minE, maxE, out) {
    camera.getWorldDirection(tmpF);
    const az0 = Math.atan2(tmpF.x, -tmpF.z);
    const halfV = (camera.fov * DEG) / 2;
    // a 0 × 0 canvas makes camera.aspect NaN, which would carry into the ember's direction and from
    // there into the mote positions and the bell's note
    const aspect = camera.aspect > 0 && Number.isFinite(camera.aspect) ? camera.aspect : 1;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const az = az0 + (rng() * 2 - 1) * 0.8 * halfH;
    const pitch = Math.asin(clamp(tmpF.y, -1, 1));
    const top = (pitch + halfV) / DEG - 2;
    const hi = Math.min(maxE, top);
    const el = (hi < minE ? minE : minE + rng() * (hi - minE)) * DEG;
    return out.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az));
  }

  function pickDir(out) {
    const sky = world.sky;
    for (let attempt = 0; attempt < 4; attempt++) {
      let d = null;
      if (sky && typeof sky.pickViewDir === 'function') {
        try {
          d = sky.pickViewDir({ minElevDeg: 6, maxElevDeg: 16 });
        } catch {
          d = null; // sky is mid-edit: aim the ember with our own copy of the §10.2 rule instead
        }
      }
      // all three components, and a length: a half-NaN or zero-length direction from sky would make
      // the flight's Bezier and the arrival note non-finite
      const ok = d && Number.isFinite(d.x) && Number.isFinite(d.y) && Number.isFinite(d.z)
        && d.x * d.x + d.y * d.y + d.z * d.z > 1e-12;
      if (ok) out.copy(d).normalize();
      else fallbackViewDir(6, 16, out);
      // keep pending flights apart (sky only knows stars that already exist)
      let clash = false;
      for (let i = 0; i < FLIGHT_MAX; i++) {
        const f = flights[i];
        if (f.on && f.dir !== out && f.dir.dot(out) > COS_2_5) clash = true;
      }
      if (!clash) break;
    }
    return out;
  }

  function launchFlight(delay, ghost, bellDeg, gain, pan, dim = 1) {
    let f = null;
    let oldest = null;
    for (let i = 0; i < FLIGHT_MAX; i++) {
      const x = flights[i];
      if (!x.on) {
        f = x;
        break;
      }
      if (!oldest || x.t0 < oldest.t0) oldest = x;
    }
    if (!f) {
      arrive(oldest); // all 8 motes busy: the oldest becomes its star now
      f = oldest;
    }
    f.on = true;
    f.dir.set(0, 0, 0);
    pickDir(f.dir);
    f.t0 = state.time + delay;
    f.ghost = ghost;
    f.dim = dim;
    f.bellDeg = bellDeg;
    f.gain = gain;
    f.pan = pan;
    // Bezier: flame top → up with the sparks → camLaunch + dir·60 (camera frozen at launch, §3.5)
    f.p0.set(fx, fy + uFlameV.value * 0.85, fz);
    f.p3.copy(camera.position).addScaledVector(f.dir, FLIGHT_DIST);
    f.c1.set(fx, f.p0.y + 9, fz);
    f.c2.lerpVectors(f.p0, f.p3, 0.62);
    f.c2.y += 5;
    // Land on the eighth grid (§4.4 rule 1, §8.4): delay computed once, animated in state.time.
    f.dur = FLIGHT_SECONDS;
    f.when = -1;
    const M = world.music;
    if (M && typeof M.next === 'function' && typeof M.now === 'function') {
      try {
        const e = M.eighth > 0 ? M.eighth : EIGHTH_FALLBACK;
        const nx = M.next('eighth');
        const g = nx - M.now();
        if (Number.isFinite(nx) && Number.isFinite(g)) {
          const n = Math.max(0, Math.round((FLIGHT_SECONDS - g) / e));
          // ≈1.2 s ± e/2 in practice; floored because updateMotes divides by it, and a conductor
          // whose next eighth is exactly now (g = 0) with a long eighth would otherwise give 0.
          f.dur = Math.max(g + n * e, 1e-3);
          f.when = nx + n * e + delay;
        }
      } catch {
        /* no grid from the conductor: the flight keeps its plain 1.2 s and the bell sounds on arrival */
      }
    }
  }

  // Star birth. sky also caps ember stars at 40; fire removes its own oldest first (sky ids are never reused, and
  // removeStar of an unknown id is a no-op), so the two caps never fight.
  // DESIGN-QUESTION: without world.music the flight takes exactly 1.2 s and the bell sounds at birth (A.now()),
  // rather than the §6.1 `A.now() + 0.35` fallback, which would put the bell 0.35 s after the star appears.
  function arrive(f) {
    if (!f.on) return;
    f.on = false;
    const sky = world.sky;
    if (sky && typeof sky.addStar === 'function') {
      if (emberCount >= EMBER_STAR_MAX) {
        if (emberIds[emberHead] >= 0 && typeof sky.removeStar === 'function') {
          try {
            sky.removeStar(emberIds[emberHead]);
          } catch {
            /* the star stays in sky's pool; our own cap still holds */
          }
        }
        emberIds[emberHead] = -1;
        emberHead = (emberHead + 1) % EMBER_STAR_MAX;
        emberCount--;
      }
      const slot = (emberHead + emberCount) % EMBER_STAR_MAX;
      emberDirs[slot].copy(f.dir);
      let id = -1;
      try {
        id = sky.addStar(emberDirs[slot], { kind: 'ember', color: TORC_HEX, mag: 1, anchor: 'air', byAosSi: f.ghost });
      } catch {
        id = -1; // §5.3: if sky cannot take the star, skip it but still sound the bell and keep the offering
      }
      emberIds[slot] = Number.isFinite(id) ? id : -1;
      emberCount++;
    }
    const degree = f.bellDeg >= 0 ? f.bellDeg : elevNote(f.dir);
    bellOpts.gain = f.gain;
    bellOpts.pan = f.pan;
    bellOpts.when = f.when >= 0 ? f.when : undefined;
    noteBell(degree, 2, bellOpts, 'fire:star', f.ghost);
  }

  // ───────────── Interactions ─────────────
  /**
   * Tap (click, key 0) or ghost offering (aos sí): §6.2 "Tap fire".
   * During hush…return the level belongs to the choreography (§7.3, pure function of T): a tap still gives sparks,
   * its ember star, sound and events, but no level surge. A ghost offering also emits fire:surge (with its 60% level)
   * so the conductor's crackle answers it too.
   */
  function offerTap({ ghost, weight, pan, source }) {
    const k = ghost ? 0.5 : 1;
    const base = baseLevelAt(state.time);
    const peak = ghost ? base + (1.0 - base) * 0.6 : 1.0; // ghost: 60% visual intensity
    // §7.3: between hush and return the flame, the sparks and the embers belong to the choreography.
    // The tap still answers — sound, a smaller spark burst, its ember star, the offering — but at 30%
    // of the idle amplitude, so it cannot punch a bright flame through An Tost (ux review, rev 2).
    // §6.1's "visible feedback within 100 ms, with sound off" is still kept.
    const choreo = choreoActive();
    const vis = choreo ? 0.3 : 1;
    if (!choreo) addSurge(peak);
    addBurst(ghost ? 2 : 0, (ghost ? 0.6 : 1) * vis);
    launchFlight(0, ghost, -1, 0.08 * k, pan, vis);
    whoosh({ from: 300, to: 2400, dur: 0.9, gain: 0.1 * k, pan }, 'fire:whoosh');
    noteDrum({ pitch: 62, gain: 0.3 * k, bus: 'sfx' }, 'fire:drum', ghost);
    state.energyTarget += ghost ? 0.015 : 0.03;
    events.emit('offering', { kind: 'fire', weight, source, pos: world.firePos.clone(), byAosSi: ghost });
    events.emit('fire:surge', { level: choreo ? Math.min(peak, level) : peak, plume: false });
  }

  /**
   * §5.2 act(): start the hold behaviour, return release(heldMs).
   * DESIGN-QUESTION: §6.2 lists the release bells n(0,2), n(3,2), n(5,2) "150 ms apart" next to "3 ember stars born
   * 150 ms apart"; fire plays each bell at its star's birth (the first on the eighth grid, §8.4 "answers from the sky
   * land on the eighth grid"), not at the instant of release. While held the level also gathers by +0.1 (feedback).
   */
  function act() {
    if (hold.active) return () => {};
    hold.active = true;
    hold.t0 = state.time;
    hold.nextDrum = state.time;
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      hold.active = false;
      const pan = firePan();
      const choreo = choreoActive(); // as in offerTap: the plume answers, at 30%, under the choreography
      const vis = choreo ? 0.3 : 1;
      if (!choreo) addSurge(1.2);
      addBurst(1, vis);
      const bells = [0, 3, 5];
      for (let i = 0; i < 3; i++) launchFlight(0.15 * i, false, bells[i], 0.08, pan, vis);
      state.energyTarget += 0.08;
      events.emit('offering', { kind: 'fire', weight: 3, source: 'hold', pos: world.firePos.clone(), byAosSi: false });
      events.emit('fire:surge', { level: choreo ? Math.min(1.2, level) : 1.2, plume: true });
    };
  }

  offs.push(
    ctx.input.addPickable(proxy, {
      onClick: () => offerTap({ ghost: false, weight: 1, pan: clamp(ctx.input.pointer.x, -1, 1) * 0.7, source: 'tap' }),
      onHover: () => {
        hoverTarget = 1;
      },
      onHoverEnd: () => {
        hoverTarget = 0;
      },
    }),
  );

  offs.push(
    events.on('hold:start', (p) => {
      if (!p || !p.ray || hold.active) return;
      raycaster.ray.copy(p.ray);
      raycaster.near = 0;
      raycaster.far = Infinity;
      const hits = raycaster.intersectObject(proxy, false);
      if (!hits.length) return;
      if (world.bealach) {
        p.candidates ??= [];
        p.candidates.push({ by: 'fire', distance: hits[0].distance, act });
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
    events.on('key', (p) => {
      if (!p || p.repeat === true) return;
      if (p.key === '0' || p.code === 'Digit0' || p.code === 'Numpad0') {
        offerTap({ ghost: false, weight: 1, pan: firePan(), source: 'tap' });
      }
    }),
  );
  offs.push(
    events.on('aossi:offer', (p) => {
      if (!p || p.kind !== 'fire') return;
      offerTap({ ghost: true, weight: Number.isFinite(p.weight) ? p.weight : 1.5, pan: firePan(), source: 'aossi' });
    }),
  );
  offs.push(
    events.on('hint:change', (p) => {
      beckonActive = !!p && p.target === 'fire';
      if (!beckonActive) flareT = -1;
    }),
  );
  offs.push(
    events.on('music:beat', (p) => {
      if (!beckonActive || ctx.reducedMotion || !p || p.beatInBar !== 0) return;
      flareT = state.time + (Number.isFinite(p.delay) ? p.delay : 0); // §4.4 rule 1: visual time via delay
    }),
  );
  offs.push(
    events.on('bealach:phase', (p) => {
      if (!p || typeof p.phase !== 'string') return;
      phase = p.phase;
      // hush: the fire sinks to embers; drop any pending beckon flare and let surges die under the choreography
      if (phase === 'hush') flareT = -1;
    }),
  );

  // ───────────── Per-frame ─────────────
  function computeLevel(t) {
    const base = baseLevelAt(t);
    let add = 0;
    for (let i = 0; i < surges.length; i++) {
      const s = surges[i];
      const age = t - s.t0;
      if (age < 0 || age > SURGE_ATTACK + SURGE_DECAY) continue;
      const atk = smoothstep(0, SURGE_ATTACK, age);
      const dec = age < SURGE_ATTACK ? 1 : Math.pow(1 - clamp((age - SURGE_ATTACK) / SURGE_DECAY, 0, 1), 1.7);
      add = Math.max(add, (s.peak - base) * atk * dec);
    }
    add += 0.1 * hold.amt; // the fire gathers while held
    if (flareT >= 0) {
      const a = (t - flareT) / 0.4; // beckon: +0.15 for 0.4 s
      if (a >= 0 && a <= 1) add += 0.15 * Math.sin(Math.PI * a);
      else if (a > 1) flareT = -1;
    }
    let L = base + add;
    const T = U.uClimaxT.value;
    if (T >= 0 && T < 38) L = climaxLevel(T, L);
    return clamp(L, 0, 1.5);
  }

  function updateHoldRoll(t) {
    if (!hold.active) return;
    const held = t - hold.t0;
    if (t < hold.nextDrum) return;
    const M = world.music;
    const e = M && M.eighth > 0 ? M.eighth : EIGHTH_FALLBACK;
    const x = clamp(held / 3, 0, 1);
    rollOpts.gain = mix(0.18, 0.3, x);
    noteDrum(rollOpts, 'fire:roll', false);
    const interval = e * Math.pow(0.25, x); // eighths → thirty-seconds over 3 s
    hold.nextDrum += interval;
    if (hold.nextDrum < t) hold.nextDrum = t + interval;
  }

  function updateMotes(dt, t) {
    // flights
    for (let i = 0; i < FLIGHT_MAX; i++) {
      const f = flights[i];
      const o = i * 3;
      if (f.on && t >= f.t0 + f.dur) arrive(f);
      if (!f.on || t < f.t0) {
        moteSize[i] = 0;
        moteCol[o] = moteCol[o + 1] = moteCol[o + 2] = 0;
        continue;
      }
      const x = clamp((t - f.t0) / f.dur, 0, 1);
      const s = 1 - Math.pow(1 - x, 1.8); // leaves the flame fast, settles into its star
      const u = 1 - s;
      const b0 = u * u * u;
      const b1 = 3 * u * u * s;
      const b2 = 3 * u * s * s;
      const b3 = s * s * s;
      motePos[o] = b0 * f.p0.x + b1 * f.c1.x + b2 * f.c2.x + b3 * f.p3.x;
      motePos[o + 1] = b0 * f.p0.y + b1 * f.c1.y + b2 * f.c2.y + b3 * f.p3.y;
      motePos[o + 2] = b0 * f.p0.z + b1 * f.c1.z + b2 * f.c2.z + b3 * f.p3.z;
      const flick = 0.85 + 0.15 * Math.sin(t * 31 + i * 1.7);
      const I = (2.0 + 1.2 * x) * flick * (f.ghost ? 0.6 : 1) * f.dim;
      if (f.ghost) {
        moteCol[o] = cVerdigris.r * I * 1.3;
        moteCol[o + 1] = cVerdigris.g * I * 1.3;
        moteCol[o + 2] = cVerdigris.b * I * 1.3;
      } else {
        moteCol[o] = mix(cTorc.r, cEmber.r, 0.3 * (1 - x)) * I;
        moteCol[o + 1] = mix(cTorc.g, cEmber.g, 0.3 * (1 - x)) * I;
        moteCol[o + 2] = mix(cTorc.b, cEmber.b, 0.3 * (1 - x)) * I;
      }
      moteSize[i] = mix(3.0, 4.0, x);
    }
    // beacons: lit count min(9, floor(E·10)), sunwise from 336°, each fading over 1.5 s
    // identical to min(9, floor(E·10)) for every E in 0..1; the clamp also keeps world.fire.beaconsLit
    // an integer in 0..9 if E is ever handed to us non-finite
    const lit = clamp(Math.floor(state.energy * 10 + 1e-6), 0, BEACON_ORDER.length);
    world.fire.beaconsLit = lit;
    for (let i = 0; i < BEACON_ORDER.length; i++) {
      const target = i < lit ? 1 : 0;
      const a = beaconAmt[i];
      beaconAmt[i] = target > a ? Math.min(target, a + dt / 1.5) : Math.max(target, a - dt / 1.5);
      const k = FLIGHT_MAX + i;
      const o = k * 3;
      const ph = beaconPhase[i];
      const rt = beaconRate[i];
      // slow, independent breathing (a fire this far off scintillates, it does not strobe)
      const flick = 0.72 + 0.2 * Math.sin(t * 1.15 * rt + ph) * Math.sin(t * 2.6 * rt + ph * 1.7) + 0.09 * Math.sin(t * 6.1 * rt + ph * 0.7);
      const I = 2.5 * beaconAmt[i] * flick;
      moteCol[o] = cEmber.r * I;
      moteCol[o + 1] = cEmber.g * I;
      moteCol[o + 2] = cEmber.b * I;
      // 7 px sprite, but the *visible* ember core inside it is the §3.4 2–3 px: the rest is the
      // low-alpha halo and ridge smudge that let it survive the fog and read as a distant fire.
      moteSize[k] = beaconAmt[i] > 0.001 ? 7.0 : 0;
    }
    motePosAttr.needsUpdate = true;
    moteColAttr.needsUpdate = true;
    moteSizeAttr.needsUpdate = true;
  }

  world.fire = {
    pos: world.firePos,
    level: () => level,
    proxy,
    beaconsLit: 0,
    sparkCount: sparkTotal, // debug (not in §5.3): spark pool size, 1500 high / 600 low
    // debug (not in §5.3): snapshot for acceptance scripts; allocates, never called by the piece itself
    debug: () => ({
      time: state.time,
      level,
      phase,
      hold: hold.active,
      holdAmt: hold.amt,
      beckon: beckonActive,
      glow: uGlow.value,
      emberStars: emberCount,
      flights: flights.filter((f) => f.on).map((f) => ({ t0: f.t0, dur: f.dur, ghost: f.ghost, dir: f.dir.toArray() })),
      motes: Array.from(motePos.slice(0, FLIGHT_MAX * 3)),
    }),
  };

  // write the arrival level immediately so modules updated before us this frame see embers
  level = computeLevel(state.time);
  U.uFireLevel.value = level;

  return {
    update(dt, t) {
      // hold envelope + hover
      hold.amt += ((hold.active ? 1 : 0) - hold.amt) * (1 - Math.exp(-dt * (hold.active ? 7 : 2.5)));
      hoverAmt += (hoverTarget - hoverAmt) * (1 - Math.exp(-dt * 10));

      level = computeLevel(t);
      U.uFireLevel.value = level;

      uGlow.value = 1 + 0.15 * hoverAmt + (beckonActive && ctx.reducedMotion ? 0.2 : 0);
      uFlameH.value = flameQuadHeight(level);
      uFlameV.value = flameVisibleHeight(level);
      uFlameW.value = flameQuadHalfWidth(level);

      // idle spark stream: rate ∝ level, ×(1 + E) (§4.3)
      uRate.value = clamp(0.1 * (level / 0.4) * (1 + state.energy), 0, 0.9);
      uHold.value.set(hold.t0, hold.amt, 0);
      const dpr = ctx.size.dpr || 1;
      uDpr.value = dpr;
      // the fov is 45–60°, so the floor never bites; it only stops a degenerate fov sending ±Infinity
      // into the spark shader's point-size maths
      uPx.value = (ctx.size.height * dpr) / (2 * Math.max(Math.tan((camera.fov * DEG) / 2), 1e-4));

      updateHoldRoll(t);
      updateMotes(dt, t);
    },
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      scene.remove(group);
      for (const d of disposables) d.dispose();
      U.uFireLevel.value = 0;
      if (world.fire && world.fire.proxy === proxy) delete world.fire;
    },
  };
}
