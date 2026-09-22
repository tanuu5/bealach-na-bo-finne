// bealach — festival director and the signature moment "An Bealach" (docs/DESIGN.md §10.8).
//
// Owns: the state machine and the only writes to state.veilTarget; energy decay and climax
// overrides; spiral light + spill (§6.4) and `spiral:progress`; the aos sí scheduler; the deiseal
// measurement (R5); hold-claim resolution and the veil hold (pointer + Space); the climax trigger on
// the downbeat (§4.4 clocks), uClimaxT / uAfterglow / `bealach:phase`; the only camera + controls
// writes (0 ≤ T < 42); and the milk-river particles, river ribbon and fire column.
import * as THREE from 'three';
import { buildPath, frontU } from './bealach/path.js';
import { createRiverVisuals } from './bealach/visuals.js';

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

// §7.3 phase table (T in seconds).
const PHASES = [
  { name: 'hush', t0: 0, t1: 3 },
  { name: 'pillar', t0: 3, t1: 8 },
  { name: 'pour', t0: 8, t1: 16 },
  { name: 'river', t0: 16, t1: 26 },
  { name: 'return', t0: 26, t1: 32 },
  { name: 'afterglow', t0: 32, t1: 122 },
  { name: 'fade', t0: 122, t1: 142 },
];
const CLIMAX_END = 142;
const CAMERA_RELEASE_T = 42;
const TWEEN_S = 5;

// §4.1 climax overrides / §4.2 climax veil targets.
const ENERGY_OVERRIDE = { hush: 0.2, pillar: 0.6, pour: 0.9, river: 1.0, return: 1.0 };
const VEIL_CLIMAX = { hush: 0.3, pillar: 0.45, pour: 0.6, river: 0.8, return: 1.0, afterglow: 1.0 };
// Phases in which no act() and no veil hold may run (§5.2 rule 7).
const CORE_CLIMAX = { hush: true, pillar: true, pour: true, river: true, return: true };
// Phases in which offerings add no spiral light (§6.4: hush…afterglow). `fade` is included too: its
// light would be discarded at T = 142 anyway, and adding it would make the loch re-fill arms that
// §7.3 empties over T 122–126 (and could ring segment bells for nothing).
const NO_LIGHT = { hush: true, pillar: true, pour: true, river: true, return: true, afterglow: true, fade: true };

// Arms (§6.4): 0 = stone, 1 = wish, 2 = fire.
const ARM_OF = { stone: 0, wish: 1, fire: 2 };
const KIND_OF = ['stone', 'wish', 'fire'];
const TIE_ORDER = [2, 0, 1]; // fire, stone, wish
const ARM_BELL_DEGREE = [0, 3, 4];
const ARM_OWNER = ['stones', 'sceach', 'fire'];

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function phaseOf(T) {
  if (!(T >= 0) || T >= CLIMAX_END) return null;
  for (let i = 0; i < PHASES.length; i++) if (T < PHASES[i].t1) return PHASES[i];
  return null;
}

/** Pure function of T: uAfterglow 0→1 over T 32–36, held, 1→0 across the fade (T 122–142). */
function afterglowOf(T) {
  if (!(T >= 32)) return 0;
  return smoothstep(32, 36, T) * (1 - smoothstep(122, 142, T));
}

export default async function setup(ctx) {
  const { scene, camera, controls, events, state, world, params } = ctx;
  const A = ctx.audio;

  // Extension uniforms (§3.6): shared objects, created lazily by whoever comes first.
  ctx.uniforms.uFireLevel ??= { value: 0 };
  ctx.uniforms.uClimaxT ??= { value: -1 };
  ctx.uniforms.uAfterglow ??= { value: 0 };
  ctx.uniforms.uOtherAngle ??= { value: 0 };
  const uClimaxT = ctx.uniforms.uClimaxT;
  const uAfterglow = ctx.uniforms.uAfterglow;

  // ---- debug params (§4.1 pins, §7.3 overrides) ----------------------------------------------
  const pinEnergy = params.has('energy');
  const pinVeil = params.has('veil');
  const climaxParam = params.has('climax') && params.get('climax') !== '0';
  const phaseTRaw = parseFloat(params.get('phaseT'));
  const hasPhaseT = params.has('phaseT') && Number.isFinite(phaseTRaw);
  const phaseTValue = hasPhaseT ? Math.max(0, phaseTRaw) : 0;
  let frozen = hasPhaseT && params.has('freezeT');

  // ---- spiral state (§6.4) ---------------------------------------------------------------------
  let cycle = 0;
  const perSegmentFor = (c) => (c <= 0 ? 2 : c === 1 ? 3 : 4);
  let perSegment = perSegmentFor(0);
  const light = [0, 0, 0];
  const segments = [0, 0, 0];
  let complete = false;
  let viewerOfferingsThisCycle = 0;
  let climaxFilled = false; // ?climax=1 fill done

  // ---- climax clock ----------------------------------------------------------------------------
  let tStart = hasPhaseT ? state.time - phaseTValue : null;
  let armed = false;
  let armedAt = 0;
  let T = -1;
  let phase = null; // phase record, or null = idle
  let phaseName = 'idle';
  let hadClimax = false;

  // ---- interaction state -----------------------------------------------------------------------
  let pointerDown = false;
  let lastPointerAt = -Infinity;
  let firstInteractionAt = state.started ? state.time : null;
  let holdActive = false; // a pointer hold is in progress (hold:start seen, hold:end not yet)
  let holdStartPerf = 0;
  let holdBaseMs = 450;
  let holdRelease = null;
  let ignoreHoldEnd = false;
  let veilPointer = false;
  let veilKey = false;
  let veilActive = false;
  let holdV = 0;
  let spaceDown = false;

  // ---- deiseal ---------------------------------------------------------------------------------
  let prevTheta = null;
  let acc = 0;

  // ---- aos sí ----------------------------------------------------------------------------------
  let aosActive = false;
  let aosNext = 0;
  let neglectNext = 0;
  let aosCount = 0;

  // ---- camera ----------------------------------------------------------------------------------
  const d0 = camera.position.distanceTo(controls.target); // boot distance, after the portrait rule (§3.7)
  let tweenEnabled = false;
  let tweenCancelled = false;
  let snapLevels = false; // one-shot: a ?phaseT join snaps energy/veil past core's smoothing
  let tweenStartR = 0;
  let tweenStartPhi = 0;
  let tweenStartTheta = 0;
  let tweenDTheta = 0;
  const tmpOffset = new THREE.Vector3();
  const tmpSph = new THREE.Spherical();
  const tmpProj = new THREE.Vector3();

  // ---- world.bealach (§5.3) --------------------------------------------------------------------
  const turns = { deiseal: 0, tuathal: 0 };
  const frontPos = [0, 0, 0, 0]; // [x, y, z, width] of the milk front, for acceptance checks
  const debug = { acc: 0, holdV: 0, veilActive: false, aosCount: 0, tStart: null, frozen, d0, viewerOfferings: 0, front: frontPos };
  const bealach = {
    phase: 'idle',
    cycle: 0,
    armed: false,
    T: -1,
    light,
    perSegment,
    turns,
    particleCount: 0,
    debug,
  };
  world.bealach = bealach;

  // ---- visuals ---------------------------------------------------------------------------------
  const heightAt = typeof world.heightAt === 'function' ? world.heightAt : () => 0;
  // The climax pose (§7.3) is a pure function of the boot distance, so the path can be re-timed at
  // build time against the camera the pour is actually seen from (see path.js buildScreenRemap).
  const climaxR = THREE.MathUtils.clamp((32 * d0) / 26, controls.minDistance, controls.maxDistance);
  const climaxPhi = THREE.MathUtils.clamp(84 * DEG, controls.minPolarAngle, controls.maxPolarAngle);
  const climaxCam = {
    y: controls.target.y + climaxR * Math.cos(climaxPhi),
    z: controls.target.z + climaxR * Math.sin(climaxPhi),
  };
  climaxCam.tilt = Math.atan2(climaxCam.y - controls.target.y, climaxCam.z - controls.target.z);
  const path = buildPath({ heightAt: (x, z) => heightAt(x, z), lochRadius: LAYOUT.loch.radius, climaxCam });
  const visuals = createRiverVisuals(ctx, path, { climaxT: uClimaxT });
  scene.add(visuals.group);
  bealach.particleCount = visuals.particleCount;

  // ---- helpers ---------------------------------------------------------------------------------
  const M = () => world.music;
  const allow = (key) => {
    const m = M();
    return m && typeof m.allow === 'function' ? m.allow(key) : true;
  };

  function armAvailable(arm) {
    return !!world[ARM_OWNER[arm]];
  }

  /** The arm with the least light (ties: fire, then stone, then wish). */
  function leastArm() {
    let best = TIE_ORDER[0];
    for (let i = 1; i < 3; i++) if (light[TIE_ORDER[i]] < light[best]) best = TIE_ORDER[i];
    return best;
  }

  function progressPayload(justFilled) {
    return {
      light: [light[0], light[1], light[2]],
      segments: [segments[0], segments[1], segments[2]],
      filled: segments[0] + segments[1] + segments[2],
      justFilled,
      complete,
      cycle,
    };
  }

  function armPan(arm) {
    const phi = LAYOUT.spiral.armPhi[arm] * DEG;
    const r = LAYOUT.spiral.armCenterRadius;
    tmpProj.set(r * Math.sin(phi), 0, -r * Math.cos(phi)).project(camera);
    // project() divides by the clip w, which is 0 only for a point exactly at the eye (unreachable:
    // minDistance is 12 and the arm sits 3.6 m from the target). Guarded anyway because a NaN pan
    // would throw out of StereoPannerNode and turn a spiral bell into a console error.
    return Number.isFinite(tmpProj.x) ? Math.max(-1, Math.min(1, tmpProj.x)) * 0.7 : 0;
  }

  function addEnergy(d) {
    state.energyTarget = clamp01(state.energyTarget + d);
  }

  /**
   * Recompute segments after light changed; emits spiral:progress (+ bells) per §6.4.
   * Segments are filled one at a time, so every `justFilled` payload shows the spiral exactly as it
   * was the moment that segment filled (a spill can fill two segments with one offering).
   * silent: debug fills (?climax, ?phaseT) — one progress event, no bells, no energy.
   */
  function lightChanged(byAosSi, silent) {
    let any = false;
    for (let arm = 0; arm < 3; arm++) {
      const seg = Math.min(3, Math.floor(light[arm] / perSegment + 1e-6));
      while (segments[arm] < seg) {
        segments[arm]++;
        complete = segments[0] + segments[1] + segments[2] >= 9;
        if (silent) continue;
        any = true;
        const segment = segments[arm] - 1;
        const deg = ARM_BELL_DEGREE[arm];
        if (allow(`bealach:spiral${arm}`)) {
          const m = M();
          const when = m && typeof m.next === 'function' ? m.next('beat') : A.now() + 0.35;
          A.bell(A.note(deg, 1), { when, gain: 0.1, decay: 5, pan: armPan(arm) });
          events.emit('note:played', { src: 'bealach', degree: deg, octave: 1, voice: 'bell', when, byAosSi: !!byAosSi });
        }
        addEnergy(0.02);
        events.emit('spiral:progress', progressPayload({ arm, segment }));
      }
    }
    complete = segments[0] + segments[1] + segments[2] >= 9;
    if (!any) events.emit('spiral:progress', progressPayload(null));
  }

  /** Adds an offering's weight to its arm, spilling the overflow ×0.5 to the least-lit arm (§6.4). */
  function addLight(arm, weight, byAosSi) {
    const cap = 3 * perSegment;
    const before0 = light[0];
    const before1 = light[1];
    const before2 = light[2];
    const add = Math.max(0, Math.min(weight, cap - light[arm]));
    light[arm] += add;
    const over = weight - add;
    if (over > 0) {
      const least = leastArm();
      if (least !== arm) light[least] = Math.min(cap, light[least] + over * 0.5);
    }
    if (light[0] !== before0 || light[1] !== before1 || light[2] !== before2) lightChanged(byAosSi, false);
  }

  function fillSpiral() {
    const cap = 3 * perSegment;
    if (light[0] >= cap && light[1] >= cap && light[2] >= cap) return;
    light[0] = light[1] = light[2] = cap;
    lightChanged(false, true);
  }

  function emitPhase(name, dur) {
    events.emit('bealach:phase', { phase: name, T: name === 'idle' ? -1 : T, dur, cycle });
  }

  function heldMsNow() {
    return holdBaseMs + (performance.now() - holdStartPerf);
  }

  // ---- veil hold -------------------------------------------------------------------------------
  // DESIGN-QUESTION: §10.8 ("Veil hold … plays the whooshes of §6.2") and §6.2/§5.1 ("the `conductor`
  // responds to `veil:hold`. On start: A.whoosh…") both assign the same two whooshes. conductor.js does
  // play them on `veil:hold`, so having bealach play them too would double the gain (0.2 / 0.12, over
  // the §8.1 whoosh ceiling of 0.15) and burn two extra `allow()` budget slots per hold. bealach
  // therefore plays them only when no conductor is loaded, so `?only=bealach` still sounds and the
  // full set plays each whoosh exactly once.
  const conductorAnswers = () => !!M();

  function startVeil(src) {
    if (src === 'pointer') veilPointer = true;
    else veilKey = true;
    if (veilActive) return;
    veilActive = true;
    events.emit('veil:hold', { active: true });
    if (!conductorAnswers() && allow('veil-on')) A.whoosh({ from: 200, to: 1600, dur: 2.5, gain: 0.1, bus: 'ambience' });
  }

  function endVeil(src) {
    if (src === 'pointer') veilPointer = false;
    else veilKey = false;
    if (!veilActive || veilPointer || veilKey) return;
    veilActive = false;
    events.emit('veil:hold', { active: false });
    if (!conductorAnswers() && allow('veil-off')) A.whoosh({ from: 1600, to: 300, dur: 1.5, gain: 0.06, bus: 'ambience' });
  }

  // ---- aos sí ----------------------------------------------------------------------------------
  // Half of each kind's tap energy (§4.1: aos sí offerings add half), used only for the fallback below.
  const GHOST_ENERGY = [0.01, 0.03, 0.015]; // stone, wish, fire
  function offerAos(arm) {
    aosCount++;
    events.emit('aossi:offer', { kind: KIND_OF[arm], weight: 1.5 });
    if (!armAvailable(arm) && !NO_LIGHT[phaseName]) {
      // DESIGN-QUESTION: §5.1 has only fire/stones/sceach answer `aossi:offer`. When that module is
      // not loaded (?only= subsets, or a module that failed to load) nobody would ever emit the
      // `offering`, the spiral could never complete and the piece would stall. bealach then credits
      // the ghost offering to its own spiral bookkeeping (no `offering` event is emitted — that
      // event's emitters stay fire/stones/sceach), with the halved energy of §4.1.
      addEnergy(GHOST_ENERGY[arm]);
      addLight(arm, 1.5, true);
    }
  }

  // ---- climax start / end ----------------------------------------------------------------------
  function climaxStarted() {
    hadClimax = true;
    armed = false;
    if (!complete) fillSpiral(); // ?phaseT joins: the climax always runs on a full spiral
    // §5.2 rule 7: a hold active at the start is released now; its later hold:end is ignored.
    if (holdRelease) {
      const release = holdRelease;
      holdRelease = null;
      try {
        release(heldMsNow());
      } catch (err) {
        console.error('[bealach] hold release threw', err);
      }
    }
    if (holdActive) ignoreHoldEnd = true;
    if (veilPointer) endVeil('pointer');
    if (veilKey) endVeil('key');
    holdV = 0;
    // Camera tween (§7.3): from T = 0 unless reduced motion or a pointer is down. Joins with T ≥ 5 snap.
    // REVIEW-FIX (climax, minor): the T ≥ 5 join-snap used to run unconditionally, so every frozen
    // reduced-motion frame was taken from a pose a reduced-motion viewer never occupies. §7.3's
    // reduced-motion rule is "No camera tween", full stop — it now wins over the join-snap too.
    tweenCancelled = false;
    tweenEnabled = !ctx.reducedMotion && (!pointerDown || T >= TWEEN_S);
    // REVIEW-FIX (climax, major): `?phaseT` joins give core's energy/veil smoothing only `warm=` seconds
    // to converge, so every frozen acceptance frame in §10.8/§10.10 renders ~10 % dark and half-veiled
    // compared with the live piece at the same T. Snap them to the joined phase's §7.3 targets in the
    // same place (and under the same T ≥ 5 rule) the camera snaps. `?energy`/`?veil` pins still win.
    if (hasPhaseT && T >= TWEEN_S) snapLevels = true;
    tmpOffset.copy(camera.position).sub(controls.target);
    tmpSph.setFromVector3(tmpOffset);
    tweenStartR = tmpSph.radius;
    tweenStartPhi = tmpSph.phi;
    tweenStartTheta = tmpSph.theta;
    let d = 0 - tweenStartTheta;
    d = Math.atan2(Math.sin(d), Math.cos(d)); // shorter azimuth direction
    tweenDTheta = d;
  }

  function endCycle() {
    light[0] = light[1] = light[2] = 0;
    segments[0] = segments[1] = segments[2] = 0;
    complete = false;
    cycle++;
    perSegment = perSegmentFor(cycle);
    viewerOfferingsThisCycle = 0;
    tStart = null;
    frozen = false;
    armed = false;
    aosActive = false;
    T = -1;
    events.emit('spiral:progress', progressPayload(null));
  }

  // ---- event handlers ---------------------------------------------------------------------------
  const offs = [];
  const on = (name, fn) => offs.push(events.on(name, fn));

  on('offering', (p) => {
    if (!p || NO_LIGHT[phaseName]) return;
    const arm = ARM_OF[p.kind];
    const w = Number(p.weight);
    if (arm === undefined || !(w > 0)) return;
    if (!p.byAosSi) viewerOfferingsThisCycle++;
    addLight(arm, w, !!p.byAosSi);
  });

  on('music:beat', (p) => {
    if (armed && tStart === null && p && p.beatInBar === 0) {
      tStart = state.time + (Number(p.delay) || 0);
    }
  });

  on('festival:first-interaction', () => {
    if (firstInteractionAt === null) firstInteractionAt = state.time;
  });

  on('pointer:down', () => {
    pointerDown = true;
    lastPointerAt = state.time;
    if (phase && T < CAMERA_RELEASE_T) tweenCancelled = true; // permanently, for this climax
  });
  on('pointer:move', () => {
    if (pointerDown) lastPointerAt = state.time;
  });
  on('pointer:up', () => {
    pointerDown = false;
    lastPointerAt = state.time;
  });

  on('hold:start', (p) => {
    holdActive = true;
    holdStartPerf = performance.now();
    holdBaseMs = Number(p?.heldMs) || 450;
    ignoreHoldEnd = false;
    holdRelease = null;
    if (CORE_CLIMAX[phaseName]) {
      ignoreHoldEnd = true; // nobody acts, no veil (§5.2 rule 7)
      return;
    }
    const candidates = p?.candidates;
    if (Array.isArray(candidates) && candidates.length) {
      let best = null;
      for (const c of candidates) {
        if (c && typeof c.act === 'function' && (!best || Number(c.distance) < Number(best.distance))) best = c;
      }
      if (best) {
        try {
          const release = best.act();
          holdRelease = typeof release === 'function' ? release : null;
        } catch (err) {
          console.error(`[bealach] hold claim act() of "${best.by}" threw`, err);
        }
        return;
      }
    }
    startVeil('pointer');
  });

  on('hold:end', (p) => {
    holdActive = false;
    if (ignoreHoldEnd) {
      ignoreHoldEnd = false;
      return;
    }
    if (holdRelease) {
      const release = holdRelease;
      holdRelease = null;
      try {
        release(Number(p?.heldMs) || heldMsNow());
      } catch (err) {
        console.error('[bealach] hold release threw', err);
      }
    }
    if (veilPointer) endVeil('pointer');
  });

  // Keyboard veil (§5.2 rule 8): starts on a non-repeat `key` Space only if Space is not already down.
  on('key', (p) => {
    if (!p || p.code !== 'Space' || p.repeat === true) return;
    if (spaceDown) return;
    spaceDown = true;
    if (!CORE_CLIMAX[phaseName]) startVeil('key');
  });
  const isTyping = (e) => {
    const tag = (e.target && e.target.tagName) || '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || !!e.target?.isContentEditable;
  };
  const onKeyDown = (e) => {
    // Only auto-repeats mark the key as held here; the first press arrives through core's `key`.
    if (e.code === 'Space' && e.repeat && !isTyping(e)) spaceDown = true;
  };
  const onKeyUp = (e) => {
    if (e.code !== 'Space') return;
    spaceDown = false;
    if (veilKey) endVeil('key');
  };
  const onBlur = () => {
    spaceDown = false;
    if (veilKey) endVeil('key');
  };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  // Wheel / touch zoom also counts as the viewer taking the camera (OrbitControls 'start').
  const onControlsStart = () => {
    if (phase && T < CAMERA_RELEASE_T) tweenCancelled = true;
  };
  controls.addEventListener('start', onControlsStart);

  // Initial announcements (§10.8 events).
  emitPhase('idle', 0);
  if (hasPhaseT) fillSpiral();

  // ---- per frame ------------------------------------------------------------------------------
  function update(dt) {
    const now = state.time;

    // (1) advance T and write world.bealach.T / uClimaxT / uAfterglow
    if (tStart !== null) {
      const t = frozen ? phaseTValue : now - tStart;
      if (t >= CLIMAX_END) endCycle();
      else T = t >= 0 ? t : -1;
    } else {
      T = -1;
    }
    bealach.T = T;
    uClimaxT.value = T;
    uAfterglow.value = afterglowOf(T);

    // (2) phase transitions (emitted once, with the actual T of this frame)
    const ph = phaseOf(T);
    const name = ph ? ph.name : 'idle';
    if (name !== phaseName) {
      const wasIdle = phaseName === 'idle';
      phase = ph;
      phaseName = name;
      bealach.phase = name;
      if (ph && wasIdle) climaxStarted();
      if (name === 'afterglow' && !pinEnergy) state.energyTarget = 0.55;
      bealach.cycle = cycle;
      emitPhase(name, ph ? ph.t1 - ph.t0 : 0);
    }
    bealach.cycle = cycle;
    bealach.perSegment = perSegment;

    // (3a) debug fill / arming / trigger
    if (climaxParam && !climaxFilled && now >= 2 && cycle === 0 && name === 'idle') {
      climaxFilled = true;
      fillSpiral();
    }
    if (name === 'idle' && tStart === null) {
      if (complete && (now >= 45 || climaxParam)) {
        if (!armed) {
          armed = true;
          armedAt = now;
        }
        const m = M();
        if (!m) tStart = armedAt + 1.0; // no conductor: arming time + 1 s (§7.3)
        // DESIGN-QUESTION: if a conductor exists but never delivers a downbeat (broken/muted
        // scheduler), fall back after one 9/8 bar + margin so the piece can never stall.
        else if (now - armedAt > 3.5) tStart = now;
      } else {
        armed = false;
      }
    }
    bealach.armed = armed;

    // (3b) aos sí scheduler (§6.2 attract + neglected-arm demonstration)
    if (name === 'idle' && !complete) {
      const cond = (!state.started && now > 12) || state.idleTime > 20;
      let offered = false;
      if (cond) {
        if (!aosActive) {
          aosActive = true;
          aosNext = now;
        }
        if (now >= aosNext) {
          offerAos(leastArm());
          offered = true;
          aosNext = Math.max(aosNext + 6, now + 1e-3);
        }
      } else {
        aosActive = false;
      }
      if (
        !offered &&
        state.started &&
        viewerOfferingsThisCycle >= 3 &&
        firstInteractionAt !== null &&
        now - firstInteractionAt >= 40 &&
        now >= neglectNext
      ) {
        // the neglected arm: light 0 (ties: fire → stone → wish)
        let zero = -1;
        for (const arm of TIE_ORDER) if (zero < 0 && light[arm] <= 0) zero = arm;
        if (zero >= 0) {
          offerAos(zero);
          neglectNext = now + 15;
        }
      }
    } else {
      aosActive = false;
    }

    // (3c) deiseal measurement (R5)
    const theta = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
    if (prevTheta !== null && controls.autoRotate === false && name === 'idle') {
      let d = theta - prevTheta;
      if (d > Math.PI) d -= TAU;
      else if (d < -Math.PI) d += TAU;
      acc -= d;
    }
    prevTheta = theta;
    if (now - lastPointerAt > 15) acc = 0;
    if (acc >= TAU) {
      acc = 0;
      turns.deiseal++;
      addEnergy(0.1);
      events.emit('deiseal:turn', { dir: 1 });
    } else if (acc <= -TAU) {
      acc = 0;
      turns.tuathal++;
      addEnergy(-0.1);
      events.emit('deiseal:turn', { dir: -1 });
    }

    // (3d) energy: climax overrides, else decay (§4.1)
    if (!pinEnergy) {
      const o = ENERGY_OVERRIDE[name];
      if (o !== undefined) {
        state.energyTarget = o;
      } else if (state.idleTime > 4) {
        const floor = hadClimax ? 0.15 : 0.06;
        if (state.energyTarget > floor) state.energyTarget = Math.max(floor, state.energyTarget - 0.015 * dt);
      }
    }

    // (3e) veil (§4.2) — bealach is the only writer
    // §4.2 gives 0.3 for "spiral complete, waiting for the downbeat" while §7.3 says "once armed";
    // `complete` is used because arming also waits for the 45 s minimum, and because `armed` goes
    // false the moment tStart is set — keying on it would drop the veil to 0 for the up-to-1.8 s
    // between the arming downbeat being scheduled and T reaching 0, then jump back to 0.3 at hush.
    let base;
    if (name === 'idle') base = complete ? 0.3 : 0;
    else if (name === 'fade') base = T < 132 ? 0.25 : 0.25 * (1 - (T - 132) / 10);
    else base = VEIL_CLIMAX[name];
    if (veilActive) holdV = Math.min(0.75, Math.max(holdV, base) + 0.45 * dt);
    else holdV = Math.max(0, holdV - 0.3 * dt);
    if (!pinVeil) state.veilTarget = Math.max(base, holdV);

    // (3f) ?phaseT join: core smooths energy/veil at the top of the frame, before modules update, so
    // writing them here lands in this frame's render and next frame's smoothing is already converged.
    if (snapLevels) {
      snapLevels = false;
      if (!pinEnergy) {
        state.energy = state.energyTarget;
        ctx.uniforms.uEnergy.value = state.energy;
      }
      if (!pinVeil) {
        state.veil = state.veilTarget;
        ctx.uniforms.uVeil.value = state.veil;
      }
    }

    // (4) camera — the only camera/controls writer, 0 ≤ T < 42 (§3.7, §7.3)
    if (ph && T < CAMERA_RELEASE_T) {
      controls.autoRotate = false;
      if (tweenEnabled && !tweenCancelled) {
        const x = Math.min(1, T / TWEEN_S);
        const k = -(Math.cos(Math.PI * x) - 1) / 2; // easeInOutSine
        const endR = THREE.MathUtils.clamp((32 * d0) / 26, controls.minDistance, controls.maxDistance);
        const endPhi = THREE.MathUtils.clamp(84 * DEG, controls.minPolarAngle, controls.maxPolarAngle);
        const r = tweenStartR + (endR - tweenStartR) * k;
        const phi = tweenStartPhi + (endPhi - tweenStartPhi) * k;
        const th = tweenStartTheta + tweenDTheta * k;
        camera.position.setFromSphericalCoords(r, phi, th).add(controls.target);
        camera.lookAt(controls.target);
        camera.updateMatrixWorld();
        prevTheta = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
      }
    }

    // visuals: pure functions of T
    const fu = frontU(T);
    visuals.update(T, fu, ctx.size);
    if (T >= 8 && T <= 30) path.samplePath(fu, frontPos); // debug.front: where the milk's head is now

    debug.acc = acc;
    debug.holdV = holdV;
    debug.veilActive = veilActive;
    debug.aosCount = aosCount;
    debug.tStart = tStart;
    debug.frozen = frozen;
    debug.viewerOfferings = viewerOfferingsThisCycle;
  }

  return {
    update,
    dispose() {
      for (const off of offs) off();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', onBlur);
      controls.removeEventListener('start', onControlsStart);
      visuals.dispose();
      if (world.bealach === bealach) delete world.bealach;
    },
  };
}
