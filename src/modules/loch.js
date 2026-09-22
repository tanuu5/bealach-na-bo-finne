// loch — the water disc inside the stone circle, mirroring the sky of Tír na nÓg (docs/DESIGN.md §10.4).
// Owns: water + Otherworld fisheye, wheeling star trails, echo stars and reflection-only stars (Tír fo Thuinn),
// fire streak, ripples, the pecked triple-spiral progress drawing, the veil mist, loch taps, world.loch.
import * as THREE from 'three';
import { createWaterMaterial, probeSkyGlsl } from './loch/water.js';
import { createStarLayer, ECHO_SLOTS, REFL_SLOTS, LOW_TRAIL_STARS } from './loch/stars.js';
import { createMist } from './loch/mist.js';
import { createSpiralTexture, armPoint } from './loch/spiral.js';
import { makeFallbackCatalog, selectBrightest } from './loch/catalog.js';

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
const OTHER_SPEED = 7.29e-3; // rad/s, 100× sidereal (§10.2)
const RHO_H = LAYOUT.loch.radius * 0.92; // 8.28 m: the Otherworld horizon on the water
const HARP_STONE_IDS = LAYOUT.stones.filter((s) => s.role === 'harp').map((s) => s.id); // k → stone id
const ECHO_CAP = { ember: 40, wish: 96 }; // mirror sky's kindled-star caps so stale echoes never pile up
const KIND_CODE = { harp: 1, named: 2, ember: 3, wish: 4, other: 5 };

// Visual tuning (linear HDR multipliers; checked against §2.3 and the 0.55× loch rule)
// K_TRAIL is what decides whether the loch reads as "another sky, turning" or as a printed pattern: the trails
// are additive over the Otherworld band and airglow, so at 1.0 they wash out the very thing they are meant to
// be turning in. At 0.62 the band's milk is still the brightest coherent shape in the disc (§3.4, §11.2).
const K_TRAIL = 0.62;
const K_ECHO = 0.75;
const K_REFL = 1.3;
// DESIGN-QUESTION: §4.3 says reflection-only stars "fade in above V > 0.2", but §10.4 acceptance 4 runs at
// veil 0 and requires "a persisting gold point in shot 2" after a loch tap. Both cannot hold literally, so
// K_REFL is applied at 0.75× from V = 0 (the point is present and gold) and rises to 1.5× over V 0.2 → 1
// (it visibly "fades in" with the veil). If §4.3 is meant strictly, drop the 0.75 base to 0.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** uOtherAngle speed factor per phase (§10.2), used only when sky is absent and loch keeps a private clock. */
const PHASE_SPEED = { idle: 1, hush: 0, pillar: 0, pour: 0, river: 1, return: 0, afterglow: 0, fade: 1 };

export default async function setup(ctx) {
  const { scene, camera, events, world, state, audio } = ctx;
  const U = ctx.uniforms;
  U.uFireLevel ??= { value: 0 };
  U.uClimaxT ??= { value: -1 };
  U.uAfterglow ??= { value: 0 };
  U.uOtherAngle ??= { value: 0 };
  const low = ctx.quality === 'low';

  const C = {};
  for (const key of ['peat', 'airglow', 'lichen', 'boFinne', 'torc', 'ember', 'verdigris']) {
    C[key] = new THREE.Color(ctx.palette[key]); // sRGB hex → linear
  }

  // ---------------------------------------------------------------- sky contract (sky loads earlier)
  const sky = world.sky;
  let skyChunk = null;
  if (sky && typeof sky.glsl === 'string' && typeof sky.glslDecl === 'string' && sky.uniforms && /otherSky\s*\(/.test(sky.glsl)) {
    // §10.2 publishes skyAirglow and skyBand alongside otherSky (otherSky is their sum). The water wants them
    // apart, so the rim damp can reach the airglow annulus without dimming the Milky Way, which maps entirely
    // into that same annulus (§10.4 note in water.js). If a chunk ever ships without them, fall back cleanly.
    const split = /skyAirglow\s*\(/.test(sky.glsl) && /skyBand\s*\(/.test(sky.glsl);
    const log = probeSkyGlsl(ctx.renderer, { decl: sky.glslDecl, glsl: sky.glsl, split });
    if (!log) skyChunk = { decl: sky.glslDecl, glsl: sky.glsl, uniforms: sky.uniforms, split };
    else console.error('[loch] world.sky.glsl does not compile inside the water shader; the loch falls back to its gradient.\n' + log);
  }
  // Without `sky` nobody writes uOtherAngle; the loch then wheels on a private clock (never the shared uniform).
  const ownsAngle = !sky;
  const angleU = ownsAngle ? { value: 0 } : U.uOtherAngle;
  let privateSpeed = 1;

  const shared = {
    uTime: U.uTime,
    uEnergy: U.uEnergy,
    uVeil: U.uVeil,
    uFirePos: U.uFirePos,
    uFireLevel: U.uFireLevel,
    uClimaxT: U.uClimaxT,
    uAfterglow: U.uAfterglow,
    uOtherAngle: angleU,
  };

  // ---------------------------------------------------------------- water
  const ripples = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -1e6, 0));
  const spiralTex = createSpiralTexture(LAYOUT.spiral, 1024, ctx.renderer);
  const own = {
    uSpiralTex: { value: spiralTex },
    uRipples: { value: ripples },
    uFill: { value: new THREE.Vector3() },
    uFlashSeg: { value: new THREE.Vector3(-9, -9, -9) },
    uFlashT: { value: new THREE.Vector3(-1e6, -1e6, -1e6) },
    uPulse: { value: 0 },
    uWaterGain: { value: 1 },
    uRiver: { value: new THREE.Vector4(0, 0, -20, 0) },
    uWhite: { value: new THREE.Vector4(0, 0, 0, 0) },
    uEmpty: { value: 1 },
    uHorizon: { value: new THREE.Color() },
    uPeat: { value: C.peat },
    uAirglow: { value: C.airglow },
    uVerdigris: { value: C.verdigris },
    uLichen: { value: C.lichen },
    uBoFinne: { value: C.boFinne },
    uTorc: { value: C.torc },
    uEmber: { value: C.ember },
  };
  const waterMat = createWaterMaterial({ shared, own, sky: skyChunk, low });
  const waterGeo = new THREE.CircleGeometry(9.4, 96);
  waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.name = 'loch.water';
  water.position.y = LAYOUT.loch.level;
  scene.add(water);
  world.groundMeshes?.push(water);

  // ---------------------------------------------------------------- stars
  let catalog = sky?.catalog;
  if (!(catalog && catalog.count > 0 && catalog.dirs?.length && catalog.mags?.length)) {
    catalog = makeFallbackCatalog(low ? 2800 : 7000, ctx.makeRng('loch-catalog'), LAYOUT.sky, C.boFinne, C.torc);
  }
  const brightest = selectBrightest(catalog, low ? LOW_TRAIL_STARS : 3000, C.boFinne, low);
  const stars = createStarLayer({ low, catalog: brightest, shared: { ...shared, uRipples: own.uRipples }, torcLin: C.torc });
  scene.add(stars.object);
  const SU = stars.uniforms;

  // ---------------------------------------------------------------- mist
  const mist = createMist(C.verdigris, U.uTime);
  scene.add(mist.mesh);

  // ---------------------------------------------------------------- scratch (no allocation in update)
  const tmpV = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const restH = new THREE.Vector3().fromArray(LAYOUT.sky.bandFoot).normalize();
  const restN = new THREE.Vector3().fromArray(LAYOUT.sky.bandPole).normalize();
  const restT = new THREE.Vector3().crossVectors(restH, restN).normalize();
  const mRest = new THREE.Matrix3().set(restH.x, restT.x, restN.x, restH.y, restT.y, restN.y, restH.z, restT.z, restN.z);
  const mRestInv = mRest.clone().transpose();
  const mLive = new THREE.Matrix3();
  const mSkyInv = new THREE.Matrix3();
  const pole = new THREE.Vector3().fromArray(LAYOUT.sky.celestialPole).normalize();

  // ---------------------------------------------------------------- echo pool bookkeeping
  const echoId = new Float64Array(ECHO_SLOTS).fill(NaN);
  const echoKind = new Uint8Array(ECHO_SLOTS); // 0 = empty
  const echoSeq = new Float64Array(ECHO_SLOTS);
  let seq = 0;
  let reflNext = 0;

  function pickEchoSlot(id, code) {
    if (Number.isFinite(id)) {
      for (let i = 0; i < ECHO_SLOTS; i++) if (echoKind[i] && echoId[i] === id) return i;
    }
    const cap = code === KIND_CODE.ember ? ECHO_CAP.ember : code === KIND_CODE.wish ? ECHO_CAP.wish : Infinity;
    let sameCount = 0;
    let oldestSame = -1;
    let free = -1;
    let oldestAny = -1;
    for (let i = 0; i < ECHO_SLOTS; i++) {
      const k = echoKind[i];
      if (!k) {
        if (free < 0) free = i;
        continue;
      }
      if (k === code) {
        sameCount++;
        if (oldestSame < 0 || echoSeq[i] < echoSeq[oldestSame]) oldestSame = i;
      }
      if (k !== KIND_CODE.harp && k !== KIND_CODE.named && (oldestAny < 0 || echoSeq[i] < echoSeq[oldestAny])) oldestAny = i;
    }
    if (sameCount >= cap && oldestSame >= 0) return oldestSame;
    if (free >= 0) return free;
    return oldestAny >= 0 ? oldestAny : 0;
  }

  /** Adds the loch echo of a sky star. dir is a camera-centred sky direction (live, incl. sky rotation). */
  function addEcho(dir, kind, colorHex, mag, onScreen, id, withFlare = true) {
    // all three components: Vector3.normalize() divides by `length() || 1`, and NaN is falsy, so a
    // dir of (1, NaN, 0) from a sibling's star:born used to survive normalize() unchanged and land
    // in the position attribute — where acos(clamp(NaN)) is NaN and the additive echo sprite, once
    // blurred by the bloom, takes the whole frame with it.
    if (!dir || !Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z)) return;
    const code = KIND_CODE[kind] ?? KIND_CODE.other;
    const slot = pickEchoSlot(Number.isFinite(id) ? id : NaN, code);
    const skyAnchored = code === KIND_CODE.harp || code === KIND_CODE.named;
    tmpV.set(dir.x, dir.y, dir.z).normalize();
    if (skyAnchored) tmpV.applyMatrix3(mSkyInv); // store in the rest frame; the shader re-applies uSkyRot
    if (Number.isFinite(colorHex)) tmpC.setHex(colorHex);
    else tmpC.copy(code === KIND_CODE.harp || code === KIND_CODE.named ? C.boFinne : C.torc);
    let harpK = -1;
    if (code === KIND_CODE.harp && Array.isArray(world.sky?.harpStarIds)) {
      // uHarp is a float[8] (§3.2 has exactly 8 harp stars). Indexing a uniform array past its end
      // is undefined in GLSL, so a longer list from sky must not reach the shader as an index.
      const k = world.sky.harpStarIds.indexOf(id);
      harpK = k >= 0 && k < 8 ? k : -1;
    }
    const level = code === KIND_CODE.harp ? 0.5 : code === KIND_CODE.named ? 1.7 : clamp(Number.isFinite(mag) ? mag : 1, 0.3, 2);
    stars.setEcho(slot, tmpV.x, tmpV.y, tmpV.z, skyAnchored ? 1 : 2, level, withFlare ? state.time : -1e6, harpK,
      tmpC.r, tmpC.g, tmpC.b, onScreen === false ? 1 : 0);
    echoKind[slot] = code;
    echoId[slot] = Number.isFinite(id) ? id : NaN;
    echoSeq[slot] = ++seq;
  }

  /** Reflection-only star (torc, fixed on the water, persistent; 64, oldest reused). */
  function addReflection(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;   // see addRipple
    const r = Math.hypot(x, z);
    if (r > LAYOUT.loch.radius - 0.2) {
      const k = (LAYOUT.loch.radius - 0.2) / r;
      x *= k;
      z *= k;
    }
    stars.setEcho(ECHO_SLOTS + reflNext, x, 0.014, z, 3, 1, state.time, -1, C.torc.r, C.torc.g, C.torc.b, 0);
    reflNext = (reflNext + 1) % REFL_SLOTS;
  }

  /** Ring ripple (8 slots, oldest reused). start may lie in the future (music:echo). */
  function addRipple(x, z, strength, start = state.time) {
    // The ripple slots are read by both the water fragment shader and the trail vertex shader, and
    // loch_ripples() only tests rp.w and the age — a NaN centre from a sibling's meteor:land payload
    // would make every fragment on the disc NaN. api.ripple() screens its own arguments; the event
    // paths (meteor:land, music:echo) do not, so the guard belongs here at the sink.
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(start) || !Number.isFinite(strength)) return;
    let best = 0;
    for (let i = 1; i < 8; i++) if (ripples[i].z < ripples[best].z) best = i;
    ripples[best].set(x, z, start, clamp(strength, 0, 2));
  }

  // Stars sky registered before we loaded: the 8 harp stars and the two named stars (§3.5).
  if (sky) {
    const ids = Array.isArray(sky.harpStarIds) ? sky.harpStarIds : [];
    for (let k = 0; k < ids.length && k < 8; k++) {
      const d = typeof sky.starDir === 'function' ? sky.starDir(ids[k], new THREE.Vector3()) : null;
      if (d && d.lengthSq() > 0.5) addEcho(d, 'harp', undefined, 0.5, true, ids[k], false);
    }
    if (sky.named?.vega) addEcho(sky.named.vega, 'named', undefined, 1.7, true, NaN, false);
    if (sky.named?.altair) addEcho(sky.named.altair, 'named', undefined, 1.7, true, NaN, false);
  }
  stars.flush();

  // ---------------------------------------------------------------- spiral state
  const fillFrom = [0, 0, 0];
  const fillTo = [0, 0, 0];
  const fillT0 = [-1e6, -1e6, -1e6];
  let complete = false;
  let lastCycle = 0;
  let phase = world.bealach?.phase ?? 'idle';
  let pulseAt = -1e6;
  let pulseNext = -1e6;
  let gustStart = -1e6;

  function fillNow(k, t) {
    const x = clamp((t - fillT0[k]) / 0.6, 0, 1);
    return fillFrom[k] + (fillTo[k] - fillFrom[k]) * easeInOutCubic(x);
  }

  // ---------------------------------------------------------------- API
  const api = {
    radius: LAYOUT.loch.radius,
    contains(x, z) {
      return Math.hypot(x, z) < LAYOUT.loch.radius;
    },
    /** Forward fisheye mapping at the current uOtherAngle: sky direction → water point (y = 0.01). */
    project(dir, out = new THREE.Vector3()) {
      const a = angleU.value;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
      const vx = dir.x / l;
      const vy = dir.y / l;
      const vz = dir.z / l;
      const kd = pole.x * vx + pole.y * vy + pole.z * vz;
      const rx = vx * c + (pole.y * vz - pole.z * vy) * s + pole.x * kd * (1 - c);
      const ry = vy * c + (pole.z * vx - pole.x * vz) * s + pole.y * kd * (1 - c);
      const rz = vz * c + (pole.x * vy - pole.y * vx) * s + pole.z * kd * (1 - c);
      const zeta = Math.acos(clamp(ry, 0, 1));
      const rho = (RHO_H * zeta) / (Math.PI / 2);
      const h = Math.hypot(rx, rz);
      return out.set(h > 1e-6 ? (rx / h) * rho : 0, LAYOUT.loch.level + 0.01, h > 1e-6 ? (rz / h) * rho : 0);
    },
    ripple(x, z, strength = 1) {
      if (Number.isFinite(x) && Number.isFinite(z)) addRipple(x, z, Number.isFinite(strength) ? strength : 1);
    },
    /** Point on spiral arm (0 stone, 1 wish, 2 fire) at param s (0 outer end → 1 centre), on the water. */
    spiralPoint(arm, s, out = new THREE.Vector3()) {
      const k = clamp(Math.round(arm) || 0, 0, 2);
      armPoint(LAYOUT.spiral, k, clamp(s, 0, 1), out);
      out.y = LAYOUT.loch.level + 0.01;
      return out;
    },
  };
  world.loch = api;

  // ---------------------------------------------------------------- events
  const offs = [];
  const on = (name, fn) => offs.push(events.on(name, fn));

  on('click:ground', (p) => {
    const pt = p?.point;
    if (!pt || !api.contains(pt.x, pt.z)) return;
    addRipple(pt.x, pt.z, 1);
    addReflection(pt.x, pt.z);
    state.energyTarget += 0.015;
    const r = Math.hypot(pt.x, pt.z);
    const i = clamp(Math.floor((r / LAYOUT.loch.radius) * 5), 0, 4);
    const M = world.music;
    if (M?.allow ? M.allow('loch') : true) {
      tmpV.set(pt.x, pt.y, pt.z).project(camera);
      const degree = PENTA[i];
      audio.bell(audio.note(degree, 0), { gain: 0.12, decay: 6, pan: clamp(tmpV.x, -1, 1) * 0.7 });
      events.emit('note:played', {
        src: 'loch',
        degree,
        octave: 0,
        voice: 'bell',
        when: typeof M?.now === 'function' ? M.now() : audio.now(),
        byAosSi: false,
      });
    }
  });

  on('star:born', (p) => {
    if (!p?.dir) return;
    addEcho(p.dir, p.kind, p.color, p.mag, p.onScreen, p.id, true);
  });

  on('meteor:land', (p) => {
    if (!p?.inLoch || !p.point) return;
    const s = Number.isFinite(p.strength) ? p.strength : 1;
    addRipple(p.point.x, p.point.z, 0.4 + 0.6 * s);
    addReflection(p.point.x, p.point.z);
  });

  on('spiral:progress', (p) => {
    const segs = p?.segments;
    if (!segs) return;
    const cyc = Number.isFinite(p.cycle) ? p.cycle : lastCycle;
    const newCycle = cyc > lastCycle; // light reset at T = 142: snap, never re-show a full spiral
    lastCycle = cyc;
    const t = state.time;
    for (let k = 0; k < 3; k++) {
      const target = clamp(Number(segs[k]) || 0, 0, 3) / 3;
      if (newCycle) {
        fillFrom[k] = fillTo[k] = target;
        fillT0[k] = -1e6;
      } else if (target !== fillTo[k]) {
        fillFrom[k] = fillNow(k, t);
        fillTo[k] = target;
        fillT0[k] = t;
      }
    }
    const jf = p.justFilled;
    if (jf && jf.arm >= 0 && jf.arm <= 2) {
      own.uFlashSeg.value.setComponent(jf.arm, clamp(jf.segment | 0, 0, 2));
      own.uFlashT.value.setComponent(jf.arm, t);
    }
    complete = !!p.complete;
  });

  on('music:beat', (p) => {
    if (!p || p.beatInBar !== 0 || !complete) return;
    const ph = world.bealach?.phase ?? phase;
    if (ph !== 'idle') return;
    pulseNext = state.time + clamp(Number(p.delay) || 0, 0, 0.5); // visual clock (§4.4 rule 1)
  });

  on('music:echo', (p) => {
    const notes = p?.notes;
    if (!Array.isArray(notes)) return;
    const M = world.music;
    const now = typeof M?.now === 'function' ? M.now() : audio.now();
    for (let i = 0; i < notes.length && i < 8; i++) {
      const delay = clamp((Number(notes[i]?.when) || now) - now, 0, 30);
      addRipple(0, 0, 0.55, state.time + delay);
    }
  });

  on('veil:hold', (p) => {
    if (p?.active) gustStart = state.time;
  });

  on('bealach:phase', (p) => {
    if (typeof p?.phase === 'string') phase = p.phase;
  });

  // ---------------------------------------------------------------- update
  function updateSkyRotation() {
    const f = world.sky?.frame;
    if (f?.H && f.T && f.N) {
      mLive.set(f.H.x, f.T.x, f.N.x, f.H.y, f.T.y, f.N.y, f.H.z, f.T.z, f.N.z);
      SU.uSkyRot.value.multiplyMatrices(mLive, mRestInv);
    } else {
      SU.uSkyRot.value.identity();
    }
    mSkyInv.copy(SU.uSkyRot.value).transpose();
  }
  updateSkyRotation();

  function onResize() {
    // uViewport is a divisor in both star vertex shaders (screen-space trail width). A zero-sized
    // canvas — a hidden tab, a 0×0 container — would make it 0 and put Inf/NaN into gl_Position,
    // which is undefined behaviour rather than an invisible frame. Floor it at one pixel.
    SU.uViewport.value.set(
      Math.max(1, ctx.size.width * ctx.size.dpr),
      Math.max(1, ctx.size.height * ctx.size.dpr),
    );
    SU.uDpr.value = Math.max(0.1, ctx.size.dpr || 1);
  }
  onResize();

  function update(dt) {
    const t = state.time;
    const T = U.uClimaxT.value;
    const inClimax = T >= 0;
    const V = U.uVeil.value;
    const E = U.uEnergy.value;
    const AG = U.uAfterglow.value;

    if (ownsAngle) {
      const target = PHASE_SPEED[phase] ?? 1;
      privateSpeed += clamp(target - privateSpeed, -dt, dt); // ramped over 1 s
      angleU.value += OTHER_SPEED * privateSpeed * dt;
    }

    // spiral fill (0.6 s ease), flashes and pulses
    // The climax only ever starts from a complete spiral, so inside it (until the fade empties it) the arms read
    // full as a pure function of T — ?phaseT joins render correctly even before any spiral:progress arrives.
    const climaxFull = inClimax && T < 126 ? 1 : 0;
    for (let k = 0; k < 3; k++) own.uFill.value.setComponent(k, Math.max(fillNow(k, t), climaxFull));
    if (pulseNext <= t && pulseNext > pulseAt) pulseAt = pulseNext;
    let pulse = t >= pulseAt ? 0.3 * Math.exp(-(t - pulseAt) * 3.2) : 0;
    if (inClimax && T < 1.4) pulse = Math.max(pulse, 0.3 * Math.sin((Math.PI * T) / 1.4)); // hush: pulses once
    own.uPulse.value = pulse;

    // pure functions of T (§4.4 rule 6)
    const waterGain = inClimax ? 1 - 0.3 * (smoothstep(7.5, 9, T) - smoothstep(16, 18, T)) : 1;
    let trailScale = 1;
    if (inClimax) {
      // DESIGN-QUESTION: §10.4 defines trailScale as "1 → 0 over T 26–32", while the §7.3 `river` cell says
      // the trails "un-freeze and start shrinking" from T = 16. Both are honoured here: a steep shrink over
      // 16–24, then the specified collapse to 0 by T = 32.
      // The shrink has to be steep, not cosmetic: during leg B the three sunwise turns are only ~1.3 m apart,
      // and full-length loch trails are exactly what bridges the gaps between them and turns the moment into
      // "the loch goes white" instead of a sunwise circuit (§7.3).
      trailScale = T < 122
        ? (1 - 0.72 * smoothstep(16, 24, T)) * (1 - smoothstep(26, 32, T))
        : smoothstep(122, 126, T);
    }
    const riverGlow = inClimax ? smoothstep(15.8, 16.3, T) * (1 - smoothstep(26, 29, T)) : 0;
    const riverW = clamp(((T - 16) / 9 - 0.03) / 0.97, 0, 1);
    const entryZ = inClimax && T >= 15.9 ? -9 + 3 * clamp((T - 15.9) / 0.37, 0, 1) : -20;
    own.uRiver.value.set(riverW, riverGlow, entryZ, T);
    if (inClimax) {
      own.uWhite.value.set(
        smoothstep(16, 25, T),
        smoothstep(16, 16.5, T) * (1 - smoothstep(34, 40, T)),
        smoothstep(16, 20, T),
        smoothstep(16, 17, T) * (1 - smoothstep(31, 33, T)),
      );
    } else {
      own.uWhite.value.set(0, 0, 0, 0);
    }
    own.uEmpty.value = inClimax && T >= 122 ? 1 - smoothstep(122, 126, T) : 1;
    own.uWaterGain.value = waterGain;

    const torcReturn = inClimax ? smoothstep(26, 30, T) * (1 - smoothstep(34, 38, T)) : 0;
    SU.uTorcMix.value = clamp(Math.max(V, AG, torcReturn), 0, 1);
    const eGain = 0.6 + 0.4 * E;
    const arrival = inClimax ? 1 : smoothstep(3, 8, t); // trails fade in over 3–8 s (never hidden inside a climax)
    // river: the trails also dim, not only shorten, so the milk running its three turns is what the eye follows
    // across the water (§7.3 "the loch brightens where the milk runs"). Back to full when they return at T 122–126.
    const riverDuck = inClimax ? 1 - 0.55 * smoothstep(16, 23, T) * (1 - smoothstep(122, 126, T)) : 1;
    SU.uTrailGain.value = K_TRAIL * eGain * arrival * waterGain * riverDuck;
    SU.uEchoGain.value = K_ECHO * eGain * waterGain;
    SU.uReflGain.value = K_REFL * (0.75 + 0.75 * smoothstep(0.2, 1, Math.max(V, AG)));
    SU.uArc.value = 12 * DEG * (1 + V) * trailScale;
    SU.uFlare31.value = inClimax ? smoothstep(30.6, 31, T) * (1 - smoothstep(31, 32.6, T)) : 0;
    // Low path only: the spacing of a star's subsampled points, in device px. It is a screen-space quantity
    // (a phone-sized loch needs a phone-sized dash), so it lives here rather than among the shader's constants.
    // DESIGN-QUESTION: §4.3 says loch trail length is ×(1 + V). The low path honours that exactly through uArc,
    // which caps each dash in angle, but its screen-space cap grows only ×0.25·V: a point sprite may not exceed
    // 4 px × dpr (§11.1), so a spacing that grew with the full factor would pull the samples apart into separate
    // stars at V = 1. What the veil buys instead is a thinner mark (stars.js), which reads as a longer one.
    // trailScale folds in so the dashes shorten into points over T 26–32 and grow back over T 122–126 (§7.3).
    if (low) SU.uStepPx.value = 3.6 * ctx.size.dpr * (1 + 0.25 * V) * (0.35 + 0.65 * trailScale);

    updateSkyRotation();

    // trails only pay for the vertex ripple warp while a ring is actually on the water
    if (!low) {
      let active = 0;
      for (let i = 0; i < 8; i++) {
        const age = t - ripples[i].z;
        if (ripples[i].w > 0 && age >= 0 && age <= 2.5) active = 1;
      }
      SU.uRippleWarp.value = active;
    }

    const ringing = world.stones?.ringing;
    const harp = SU.uHarp.value;
    for (let k = 0; k < 8; k++) harp[k] = ringing ? clamp(ringing[HARP_STONE_IDS[k]] || 0, 0, 1) : 0;

    // veil mist: height 3·s(V), alpha 0.18·s(V); rises from T = 30 in the climax; gust on veil:hold
    const sv = smoothstep(0.2, 1, V);
    const gate = !inClimax ? 1 : T < 30 ? 1 - smoothstep(0, 1.5, T) : smoothstep(30, 33, T);
    const ga = t - gustStart;
    // the gust follows the veil the hold is opening (veilTarget leads the smoothed V by ~1 s), so it shows at once
    const veilLead = Math.max(V, Number(state.veilTarget) || 0);
    // sqrt() of a negative is NaN, and this feeds the mist's alpha and height: state.veilTarget is
    // public, mutable and only clamped by core at the top of the next frame, so a module that nudged
    // it below 0 would reach this line first and blank the frame through the mist. (clamp() here is
    // the module's own helper, which passes NaN straight through.)
    const gust = ga >= 0 && ga < 1.2 ? Math.sin((Math.PI * ga) / 1.2) * clamp(Math.sqrt(Math.max(veilLead, 0)) * 2.4, 0, 1) : 0;
    const amt = sv * gate;
    mist.uniforms.uMistA.value = 0.18 * amt + 0.09 * gust;
    mist.uniforms.uMistH.value = clamp(amt + 0.45 * gust, 0.04, 1);
    mist.mesh.visible = mist.uniforms.uMistA.value > 0.0015;

    // Fresnel target: this world's fog / horizon glow
    const fogC = scene.fog?.color;
    if (fogC) own.uHorizon.value.copy(fogC).lerp(tmpC.copy(C.airglow).multiplyScalar(0.44), 0.5);
    else own.uHorizon.value.copy(C.airglow).multiplyScalar(0.22);

    stars.flush();
  }

  return {
    update,
    onResize,
    dispose() {
      for (const off of offs) off();
      offs.length = 0;
      scene.remove(water, stars.object, mist.mesh);
      const gi = world.groundMeshes?.indexOf(water) ?? -1;
      if (gi >= 0) world.groundMeshes.splice(gi, 1);
      waterGeo.dispose();
      waterMat.dispose();
      spiralTex.dispose();
      stars.dispose();
      mist.dispose();
      if (world.loch === api) delete world.loch;
    },
  };
}
