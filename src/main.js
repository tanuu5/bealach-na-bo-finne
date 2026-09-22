import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createEvents } from './core/events.js';
import { mulberry32, hashString } from './core/rng.js';
import { AudioEngine } from './core/audio.js';
import { createInput } from './core/input.js';
import { createGradePass } from './core/grade-pass.js';
import { CONFIG } from './config.js';
import PALETTE from './palette.js';
import { MODULE_ORDER, LOADERS } from './modules/index.js';

const params = new URLSearchParams(location.search);
const num = (key, fallback) => {
  const v = parseFloat(params.get(key));
  return Number.isFinite(v) ? v : fallback;
};

function detectQuality() {
  const q = params.get('q');
  if (q === 'low' || q === 'high') return q;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 820;
  const weakCpu = (navigator.hardwareConcurrency || 8) <= 4;
  return (coarse && small) || weakCpu ? 'low' : 'high';
}

async function boot() {
  const canvas = document.getElementById('scene');
  const hud = document.getElementById('hud');
  if (params.has('nohud')) hud.style.display = 'none';

  const quality = detectQuality();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seed = params.has('seed') ? Math.floor(num('seed', 1)) : 20260915;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: params.has('shot'),
  });
  const dprMax = quality === 'high' ? CONFIG.dpr.high : CONFIG.dpr.low;
  // The composer keeps two half-float buffers, multisampled on the high path, so the drawing
  // buffer's area — not the window's — decides VRAM. Above the budget we lower the pixel ratio
  // rather than risk an allocation failure (which loses the GL context and blanks the canvas).
  const pickDpr = (w, h) => {
    const d = Math.min(devicePixelRatio || 1, dprMax);
    const px = w * h * d * d;
    return px > CONFIG.maxBufferPixels ? Math.max(1, d * Math.sqrt(CONFIG.maxBufferPixels / px)) : d;
  };
  const size = { width: innerWidth, height: innerHeight, dpr: pickDpr(innerWidth, innerHeight) };
  renderer.setPixelRatio(size.dpr);
  renderer.setSize(size.width, size.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(CONFIG.clearColor, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(CONFIG.fog.color, CONFIG.fog.density);
  scene.background = new THREE.Color(CONFIG.clearColor);

  const cc = CONFIG.camera;
  const camera = new THREE.PerspectiveCamera(cc.fov, size.width / size.height, cc.near, cc.far);
  camera.position.fromArray(cc.position);
  let camOverride = false;
  if (params.has('cam')) {
    const p = params.get('cam').split(',').map(Number);
    if (p.length === 3 && p.every(Number.isFinite)) {
      camera.position.set(p[0], p[1], p[2]);
      camOverride = true;
    }
  }

  const controls = new OrbitControls(camera, canvas);
  controls.target.fromArray(cc.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.6;
  controls.minDistance = cc.minDistance;
  controls.maxDistance = cc.maxDistance;
  controls.minPolarAngle = cc.minPolarAngle;
  controls.maxPolarAngle = cc.maxPolarAngle;
  controls.autoRotate = !params.has('noauto') && !reducedMotion;
  controls.autoRotateSpeed = cc.autoRotateSpeed;
  const dwell = cc.autoRotateDwell;
  const dwellCenter = ((dwell?.centerDeg ?? 0) * Math.PI) / 180;

  // CR-1 portrait rule: pull the camera back on tall screens so loch and fire stay in frame.
  const portraitDistance = (aspect) =>
    aspect < 1 ? THREE.MathUtils.clamp((cc.portrait.base * cc.portrait.factor) / aspect, cc.portrait.base, cc.portrait.max) : cc.portrait.base;
  const baseTargetY = cc.target[1];
  function applyPortraitTarget(aspect) {
    const k = THREE.MathUtils.clamp((1 - aspect) / (1 - cc.portrait.targetYAspect), 0, 1);
    controls.target.y = baseTargetY + (cc.portrait.targetY - baseTargetY) * k;
  }
  const tmpDir = new THREE.Vector3();
  function setCameraDistance(d) {
    tmpDir.subVectors(camera.position, controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(tmpDir, d);
  }
  let autoDistance = camera.position.distanceTo(controls.target);
  if (!camOverride) {
    applyPortraitTarget(camera.aspect);
    autoDistance = portraitDistance(camera.aspect);
    setCameraDistance(autoDistance);
  }
  controls.update();

  // Post-processing: HDR scene → bloom → tone map + sRGB → grade (vignette/grain) → screen.
  const bufferPixels = size.width * size.height * size.dpr * size.dpr;
  const samples = quality === 'high' ? (bufferPixels > CONFIG.msaaPixelLimit ? 2 : 4) : 0;
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(size.dpr);
  composer.setSize(size.width, size.height);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.width, size.height),
    CONFIG.bloom.strength,
    CONFIG.bloom.radius,
    CONFIG.bloom.threshold,
  );
  // Safety net: a single NaN fragment anywhere in the scene would otherwise be smeared across the
  // whole frame by the bloom blur — the "black screen" failure mode. clamp() scrubs it at the door,
  // so a bad pixel stays a bad pixel instead of taking the picture with it.
  const highPass = bloom.materialHighPassFilter;
  if (highPass?.fragmentShader.includes('vec4 texel = texture2D( tDiffuse, vUv );')) {
    highPass.fragmentShader = highPass.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = clamp( texture2D( tDiffuse, vUv ), 0.0, 1e4 );',
    );
    highPass.needsUpdate = true;
  } else {
    console.warn('[core] bloom high-pass shader changed shape — NaN guard not installed');
  }
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = createGradePass();
  const gu = grade.uniforms;
  gu.uVignette.value = CONFIG.grade.vignette;
  gu.uGrain.value = CONFIG.grade.grain;
  gu.uLift.value = CONFIG.grade.lift;
  gu.uTint.value.setHex(CONFIG.grade.tint, THREE.LinearSRGBColorSpace); // raw sRGB bytes, not linearised (§2.3)
  composer.addPass(grade);
  grade.setSize(size.width * size.dpr, size.height * size.dpr);

  // CR-2: long-presses are interactions, never context menus.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const events = createEvents();
  const audio = new AudioEngine(events);

  const state = {
    time: 0,
    energy: num('energy', 0),
    energyTarget: num('energy', 0),
    veil: num('veil', 0),
    veilTarget: num('veil', 0),
    started: false,
    audioOn: true,
    idleTime: 0,
  };

  const uniforms = {
    uTime: { value: 0 },
    uEnergy: { value: state.energy },
    uVeil: { value: state.veil },
    uFirePos: { value: new THREE.Vector3() },
  };

  const world = {
    heightAt: () => 0,
    groundMeshes: [],
    firePos: uniforms.uFirePos.value,
    skyRadius: 1500,
  };

  const ctx = {
    THREE,
    renderer,
    scene,
    camera,
    controls,
    composer,
    bloom,
    grade: gu,
    canvas,
    hud,
    size,
    quality,
    qualityScale: quality === 'high' ? 1 : 0.4,
    reducedMotion,
    seed,
    rng: mulberry32(seed),
    makeRng: (salt) => mulberry32(seed ^ hashString(String(salt))),
    palette: { ...PALETTE },
    uniforms,
    state,
    world,
    events,
    audio,
    params,
    ui: { toast: (text) => console.info('[toast]', text) },
  };
  ctx.input = createInput(ctx);
  events.on('audio:toggled', ({ on }) => (state.audioOn = on));
  window.__festival = ctx; // handy for debugging in the console

  // Idle-aware auto-rotate: pause while the user drives the camera, resume after a quiet spell.
  let userDriving = false;
  controls.addEventListener('start', () => {
    userDriving = true;
    controls.autoRotate = false;
  });
  controls.addEventListener('end', () => {
    userDriving = false;
  });

  // Load feature modules in order; a failing module is logged and skipped.
  const only = params.get('only')?.split(',').map((s) => s.trim()).filter(Boolean);
  const skip = new Set((params.get('skip') || '').split(',').map((s) => s.trim()).filter(Boolean));
  if (params.has('nohud')) skip.add('hud');
  const names = MODULE_ORDER.filter((n) => (only ? only.includes(n) : true) && !skip.has(n));
  if (only) {
    for (const n of only) if (!LOADERS[n]) console.error(`[core] unknown module "${n}" in ?only=`);
  }

  const instances = [];
  for (const name of names) {
    try {
      const mod = await LOADERS[name]();
      const setup = mod.default;
      if (typeof setup !== 'function') throw new Error('default export is not a setup function');
      const inst = (await setup(ctx)) || {};
      instances.push({ name, inst });
    } catch (err) {
      console.error(`[core] module "${name}" failed to load`, err);
    }
  }

  function step(dt) {
    state.time += dt;
    state.idleTime += dt;
    const ke = 1 - Math.exp(-dt * CONFIG.smoothing.energy);
    const kv = 1 - Math.exp(-dt * CONFIG.smoothing.veil);
    state.energyTarget = THREE.MathUtils.clamp(state.energyTarget, 0, 1);
    state.veilTarget = THREE.MathUtils.clamp(state.veilTarget, 0, 1);
    state.energy += (state.energyTarget - state.energy) * ke;
    state.veil += (state.veilTarget - state.veil) * kv;
    uniforms.uTime.value = state.time;
    uniforms.uEnergy.value = state.energy;
    uniforms.uVeil.value = state.veil;
    gu.uTime.value = state.time;

    if (!userDriving && !controls.autoRotate && !params.has('noauto') && !reducedMotion) {
      if (state.idleTime > CONFIG.camera.idleResumeSeconds) controls.autoRotate = true;
    }

    // Dwell on the Milky Way side of the orbit, hurry across the empty side (still sunwise).
    if (controls.autoRotate && dwell) {
      const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
      const w = 0.5 + 0.5 * Math.cos(az - dwellCenter); // 1 = band framed, 0 = facing away
      controls.autoRotateSpeed = dwell.fast + (dwell.slow - dwell.fast) * (w * w);
    }

    for (const { name, inst } of instances) {
      if (!inst.update) continue;
      try {
        inst.update(dt, state.time);
      } catch (err) {
        console.error(`[core] module "${name}" update threw — disabling its update`, err);
        inst.update = null;
      }
    }
  }

  const warm = num('warm', 0);
  if (warm > 0) {
    const h = 1 / 30;
    for (let t = 0; t < warm; t += h) step(h);
  }

  function resize() {
    size.width = innerWidth;
    size.height = innerHeight;
    size.dpr = pickDpr(size.width, size.height);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    // Re-apply the portrait rule only if the user has not zoomed away from the automatic distance.
    if (!camOverride && Math.abs(camera.position.distanceTo(controls.target) - autoDistance) < 0.5) {
      applyPortraitTarget(camera.aspect);
      autoDistance = portraitDistance(camera.aspect);
      setCameraDistance(autoDistance);
    }
    renderer.setPixelRatio(size.dpr);
    renderer.setSize(size.width, size.height, false);
    composer.setPixelRatio(size.dpr);
    composer.setSize(size.width, size.height);
    grade.setSize(size.width * size.dpr, size.height * size.dpr);
    for (const { inst } of instances) inst.onResize?.(size.width, size.height);
    events.emit('resize', { width: size.width, height: size.height });
  }
  addEventListener('resize', resize);

  // ── failure handling ───────────────────────────────────────────────────────
  // A lost GL context (or one bad frame) used to leave a black canvas with a live HUD on top:
  // the piece looked frozen while clicks still worked. Say what happened, and recover.
  const notice = document.getElementById('boot-error');
  let contextLost = false;
  function showNotice(text) {
    if (!notice) return;
    notice.hidden = false;
    notice.textContent = text;
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // lets the browser hand the context back
    contextLost = true;
    console.error('[core] WebGL context lost');
    showNotice('描画が中断されました。復帰しています… / Rendering was interrupted, recovering…');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[core] WebGL context restored — reloading');
    location.reload();
  });

  // Post-processing is the one place where a single non-finite number blanks the whole frame.
  const gradeDefaults = { lift: CONFIG.grade.lift, vignette: CONFIG.grade.vignette, grain: CONFIG.grade.grain };
  let guarded = false;
  function guardPost() {
    const suspects = [
      ['bloom.strength', bloom.strength], ['bloom.radius', bloom.radius], ['bloom.threshold', bloom.threshold],
      ['grade.lift', gu.uLift.value], ['grade.vignette', gu.uVignette.value], ['grade.grain', gu.uGrain.value],
      ['grade.tint.r', gu.uTint.value.r], ['grade.tint.g', gu.uTint.value.g], ['grade.tint.b', gu.uTint.value.b],
    ];
    const bad = suspects.filter(([, v]) => !Number.isFinite(v)).map(([k, v]) => `${k}=${v}`).join(', ');
    if (!bad) return;
    bloom.strength = CONFIG.bloom.strength;
    bloom.radius = CONFIG.bloom.radius;
    bloom.threshold = CONFIG.bloom.threshold;
    gu.uLift.value = gradeDefaults.lift;
    gu.uVignette.value = gradeDefaults.vignette;
    gu.uGrain.value = gradeDefaults.grain;
    gu.uTint.value.setHex(CONFIG.grade.tint, THREE.LinearSRGBColorSpace);
    if (!guarded) {
      guarded = true;
      console.error(`[core] non-finite post-processing value (${bad}) — reset to defaults`);
    }
  }

  const diag = params.has('diag') ? createDiagnostics(ctx, () => ({ contextLost, samples, guarded })) : null;
  const probe = params.get('diag') === '2' ? createProbe(ctx) : null;

  let last = performance.now();
  let frames = 0;
  let loopErrors = 0;
  function frame(now) {
    requestAnimationFrame(frame); // scheduled first: one bad frame can never stop the piece
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    if (contextLost) return;
    try {
      step(dt);
      controls.update(dt);
      // Keep the camera above the ground (and above the sí mound), whatever the user or a module did.
      const groundY = (world.heightAt?.(camera.position.x, camera.position.z) ?? 0) + cc.minGroundClearance;
      if (camera.position.y < groundY) camera.position.y = groundY;
      ctx.input.update();
      guardPost();
      composer.render(dt);
      diag?.(dt);
      probe?.(dt);
      if (++frames === 2) {
        document.body.classList.add('is-ready');
        window.__festivalReady = true;
      }
    } catch (err) {
      if (++loopErrors <= 3) console.error('[core] frame failed', err);
      if (loopErrors === 3) showNotice('描画でエラーが続いています。コンソールをご確認ください。 / Repeated render errors — see the console.');
    }
  }
  requestAnimationFrame((t) => {
    last = t;
    frame(t);
  });
}

// ?diag=2 — names whatever is in front of the camera, and hunts for broken transforms.
// A black frame at 60 fps means something opaque is covering the view; this says what.
function createProbe(ctx) {
  const THREE = ctx.THREE;
  const el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;left:8px;bottom:8px;z-index:9;margin:0;padding:6px 8px;font:11px/1.45 ui-monospace,Menlo,monospace;' +
    'color:#ffd9a8;background:rgba(10,4,2,.78);white-space:pre;pointer-events:none;max-width:60vw;border-radius:2px';
  document.body.appendChild(el);
  const ray = new THREE.Raycaster();
  ray.near = 0.01;
  ray.far = 4000;
  const centre = new THREE.Vector2(0, 0);
  const label = (o) => o.name || `${o.type}${o.isInstancedMesh ? `[${o.count}]` : ''}`;
  const chain = (o) => {
    const parts = [];
    for (let n = o; n && n !== ctx.scene; n = n.parent) parts.unshift(n.name || n.type);
    return parts.join('/');
  };
  let acc = 1;
  return (dt) => {
    acc += dt;
    if (acc < 0.5) return;
    acc = 0;
    ray.setFromCamera(centre, ctx.camera);
    const hits = ray.intersectObjects(ctx.scene.children, true).filter((h) => h.object.visible);
    const front = hits.slice(0, 4).map((h) => `${h.distance.toFixed(1)}m ${chain(h.object)}`);

    // broken transforms / absurd bounds: the usual cause of a screen-filling polygon
    const broken = [];
    ctx.scene.traverseVisible((o) => {
      if (!o.isMesh && !o.isPoints && !o.isLine) return;
      const e = o.matrixWorld.elements;
      for (let i = 0; i < 16; i++) {
        if (!Number.isFinite(e[i])) {
          broken.push(`${label(o)}: matrix NaN`);
          return;
        }
      }
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      if (bs && (!Number.isFinite(bs.radius) || bs.radius > 3000)) broken.push(`${label(o)}: bounds ${bs ? bs.radius.toFixed(0) : 'NaN'}`);
      const pos = g.getAttribute('position');
      if (pos && pos.count) {
        const i = 0;
        if (!Number.isFinite(pos.getX(i)) || !Number.isFinite(pos.getY(i)) || !Number.isFinite(pos.getZ(i))) broken.push(`${label(o)}: position NaN`);
      }
      if (o.isInstancedMesh) {
        const a = o.instanceMatrix.array;
        for (let i = 0; i < a.length; i++) {
          if (!Number.isFinite(a[i])) {
            broken.push(`${label(o)}: instanceMatrix NaN`);
            break;
          }
        }
      }
    });

    el.textContent = ['in front of the camera:', ...(front.length ? front : ['  (nothing — sky only)']), broken.length ? `BROKEN: ${broken.slice(0, 4).join(' | ')}` : 'transforms ok'].join('\n');
  };
}

// ?diag=1 — a small readout so a black or stuck frame can report its own cause.
function createDiagnostics(ctx, extra) {
  const el = document.createElement('pre');
  el.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:9;margin:0;padding:6px 8px;font:11px/1.45 ui-monospace,Menlo,monospace;' +
    'color:#cfe3d6;background:rgba(4,10,8,.72);white-space:pre;pointer-events:none;border-radius:2px';
  document.body.appendChild(el);
  let acc = 1; // first frame paints the readout immediately
  let frames = 1;
  let fps = 0;
  return (dt) => {
    frames++;
    acc += dt;
    if (acc < 0.5) return;
    fps = frames / acc;
    frames = 0;
    acc = 0;
    const r = ctx.renderer;
    const b = ctx.world.bealach;
    const gl = r.getContext();
    const x = extra();
    el.textContent = [
      `fps ${fps.toFixed(0)}  t ${ctx.state.time.toFixed(0)}s  dpr ${ctx.size.dpr.toFixed(2)}  msaa ${x.samples}`,
      `buffer ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}  quality ${ctx.quality}`,
      `phase ${b ? b.phase : '—'}  T ${b ? b.T.toFixed(1) : '—'}  E ${ctx.state.energy.toFixed(2)}  V ${ctx.state.veil.toFixed(2)}`,
      `fire ${(ctx.uniforms.uFireLevel?.value ?? 0).toFixed(2)}  bloom ${ctx.bloom.strength.toFixed(2)}  lift ${ctx.grade.uLift.value.toFixed(2)}`,
      `cam ${ctx.camera.position.toArray().map((v) => v.toFixed(1)).join(', ')}  ground ${(ctx.world.heightAt?.(ctx.camera.position.x, ctx.camera.position.z) ?? 0).toFixed(1)}`,
      `geom ${r.info.memory.geometries} tex ${r.info.memory.textures}  contextLost ${x.contextLost}  postGuard ${x.guarded}`,
    ].join('\n');
  };
}

boot().catch((err) => {
  console.error('[core] boot failed', err);
  const el = document.getElementById('boot-error');
  if (el) {
    el.hidden = false;
    el.textContent = 'この作品は WebGL2 対応ブラウザで表示できます。 / This piece needs a WebGL2-capable browser.';
  }
});
