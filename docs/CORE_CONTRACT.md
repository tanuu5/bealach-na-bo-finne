# Core Contract — module API for the star-festival piece

This project is a Three.js (three@0.186.0, WebGLRenderer) interactive art piece.
The **core** (owned by the lead, in `src/main.js` and `src/core/*`) sets up renderer,
camera, controls, post-processing, input, audio engine, and loads **feature modules**
from `src/modules/*.js`. Each feature module is owned by exactly one implementer and
must only touch its own file (plus optional private helpers under
`src/modules/<name>/`).

## Coordinates & world scale

- Y up, 1 unit ≈ 1 metre. Scene origin = centre of the festival ground.
- Default camera: see `src/config.js` (DESIGN.md §3.7 is binding: position (5.34, 6.57, 25.12),
  target (0, 2.5, 0), polar 55°–87°, distance 12–60, sunwise auto-rotate 0.3 that stops on drag and
  resumes after 6 s idle; portrait rule CR-1 applied by core before modules load). No panning.
- Sky dome radius convention: 1500. Anything "in the sky" lives at radius ≤ 1500.
- Fog: `scene.fog` is a `THREE.FogExp2` created by core (colour/density may be
  overridden by exactly one module — the one the design doc assigns as sky/atmosphere owner).

## Module shape

```js
// src/modules/<name>.js
import * as THREE from 'three';
// addons are allowed: import { X } from 'three/addons/.../X.js';

export default async function setup(ctx) {
  // build meshes/materials, add to ctx.scene, subscribe to ctx.events …
  return {
    update(dt, t) {},     // every frame. dt = clamped seconds (≤ 1/20), t = elapsed seconds
    onResize(w, h) {},    // optional, CSS pixels
    dispose() {},         // optional
  };
}
```

Modules are loaded **in the order listed in `src/modules/index.js`** and awaited one by one,
so a later module can read what an earlier one registered on `ctx.world`.
A module must not crash if an earlier module is absent (dev URL `?only=` loads a subset):
always feature-detect (`ctx.world.heightAt` has a flat default, etc.).

## `ctx` fields (provided by core)

| field | what |
|---|---|
| `ctx.renderer` | `THREE.WebGLRenderer` (ACESFilmic tone mapping, sRGB output, antialias off when composer is used) |
| `ctx.scene`, `ctx.camera`, `ctx.controls` | scene, PerspectiveCamera, OrbitControls |
| `ctx.composer` | `EffectComposer` (HalfFloat, MSAA×4 on high) — passes: RenderPass → UnrealBloomPass (`ctx.bloom`) → OutputPass (ACES tone map + sRGB) → GradePass (`ctx.grade` = its uniforms `uVignette`, `uGrain`, `uTint`, `uLift`, `uTime`; runs on display-referred colour). Scene colours are HDR/linear: emissive values > 1 bloom (threshold ≈ 0.8) |
| `ctx.canvas` | the canvas element |
| `ctx.hud` | `HTMLElement` overlay container (`#hud`, pointer-events: none by default; children may set `pointer-events:auto`) |
| `ctx.size` | `{ width, height, dpr }` live object |
| `ctx.quality` | `'high'` or `'low'` (low on small/touch/weak devices, or `?q=low`). Scale particle counts by `ctx.qualityScale` (1 or ~0.4) |
| `ctx.reducedMotion` | boolean from `prefers-reduced-motion` |
| `ctx.rng` | seeded PRNG `() => [0,1)`; `ctx.makeRng(salt)` returns an independent seeded PRNG (use one per module for stable layouts) |
| `ctx.palette` | object of hex strings, e.g. `ctx.palette.ember` — keys defined in DESIGN.md |
| `ctx.uniforms` | shared uniform objects to plug into your ShaderMaterials so everything pulses together: `uTime {value}`, `uEnergy {value 0..1}` (festival intensity, smoothed), `uVeil {value 0..1}` (otherworld "veil opening" amount), `uFirePos {value: Vector3}` |
| `ctx.state` | mutable shared state: `{ time, energy, energyTarget, veil, veilTarget, started, audioOn, idleTime }`. Modules may **nudge** `ctx.state.energyTarget` / `veilTarget` (core smooths them into `energy`/`veil` and the uniforms) |
| `ctx.world` | shared registry. Core defaults: `heightAt(x,z) => 0`, `groundMeshes: []` (meshes used for ground raycasts — push into it, don't replace), `firePos: Vector3(0,0,0)` (**same object** as `ctx.uniforms.uFirePos.value` — mutate with `.set()`/`.copy()`, never reassign), `skyRadius: 1500`. Modules may set/extend fields, documented in DESIGN.md |
| `ctx.params` | `URLSearchParams` of the page (modules may read their own debug params) |
| `ctx.seed` | integer seed |
| `ctx.events` | emitter: `on(name, fn) → off()`, `once(name, fn)`, `emit(name, payload)` |
| `ctx.input` | `{ pointer: Vector2 (NDC), raycaster, addPickable(object3D, { onClick(hit), onHover(hit), onHoverEnd() }) → remove(), setCursor(css) }` |
| `ctx.audio` | `AudioEngine` — see below |
| `ctx.ui` | `{ toast(text, ms?) }` small transient caption (implemented by the HUD module if present, otherwise console) |

## three r186 notes

- `THREE.Clock` is deprecated (warns) — never use it; use the `dt`/`t` passed to `update`.
- `PCFSoftShadowMap` was removed. Prefer no shadow maps at all (night scene; fake contact shadows / AO in shaders).
- WebGLRenderer + `ShaderMaterial` / `RawShaderMaterial` (GLSL3 is fine via `glslVersion: THREE.GLSL3`) / `onBeforeCompile`. No WebGPU / TSL / node materials.
- Custom `ShaderMaterial`s don't get fog unless you set `fog: true` and include the fog chunks — distant geometry must be fogged consistently with `scene.fog`.
- Console warnings count against quality; errors count as failure.

## Core-emitted events

| event | payload | when |
|---|---|---|
| `pointer:down` / `pointer:move` / `pointer:up` | `{ ndc: Vector2, ray: Ray, clientX, clientY, isTouch }` (`pointer:up` also has `isClick`, `heldMs`) | raw pointer on canvas |
| `click:pickable` | `{ object, hit }` | a click landed on a registered pickable (its `onClick` is also called) |
| `click:ground` | `{ point: Vector3, normal: Vector3 }` | click hit one of `ctx.world.groundMeshes` (or plane y=heightAt when none) and no pickable was closer |
| `click:sky` | `{ direction: Vector3 (unit), point: Vector3 (on sphere r = skyRadius*0.6) }` | click hit nothing |
| `hold:start` / `hold:end` | `{ ndc, ray, heldMs }` | pointer held still > 450 ms (not dragging) |
| `key` | `{ key, code, repeat }` | keydown on window (not when typing in inputs) |
| `audio:started` | `{}` | first user gesture unlocked Web Audio and the user has sound on |
| `audio:toggled` | `{ on }` | sound toggled |
| `resize` | `{ width, height }` | window resized |
| `festival:first-interaction` | `{}` | first click/tap/key of the session |

A click is a pointer down/up with < 6 px movement and < 350 ms; drags rotate the camera and never fire clicks.

Modules may emit their own events. **Every custom event name, payload and emitter must be listed in DESIGN.md** so modules interoperate.

## AudioEngine (`ctx.audio`)

Web Audio is created lazily on first user gesture. Sound defaults to ON after the
first gesture, with a HUD toggle. All methods are safe no-ops before start.

- `audio.ready` boolean, `audio.ctx` (AudioContext or null), `audio.now()`
- `audio.bus(name)` → GainNode routed to master through a shared reverb send; names: `'music'`, `'sfx'`, `'ambience'`
- `audio.reverb` (ConvolverNode, generated hall/stone impulse), `audio.master`
- `audio.scale` = frequencies of the piece's scale (D Dorian from D3, over 4 octaves) and `audio.note(degree, octave=0)` → Hz (`note(0,0)` = D3 146.8 Hz, `note(4,1)` = A4 440 Hz; degrees wrap into octaves)
- `audio.enabled`, `audio.setEnabled(on)`, `audio.toggle()` (the HUD sound button uses these; they emit `audio:toggled`)
- Built-in voices (quick to use from any module):
  - `audio.pluck(freq, { when, gain=0.3, pan=0, bright=0.5, decay=2.5, bus='sfx' })` — Karplus-Strong-like harp/lyre pluck
  - `audio.bell(freq, { when, gain=0.2, pan=0, decay=4, bus='sfx' })` — soft FM bell/chime
  - `audio.whoosh({ when, gain=0.15, dur=1.2, from=400, to=2400, pan=0, bus='sfx' })` — filtered noise swell
  - `audio.drum({ when, gain=0.4, pitch=70, bus='music' })` — bodhrán-like frame-drum hit
- `audio.onStart(fn)` — run fn once audio is live (immediately if already live)

Music/ambience modules build longer-lived graphs on the buses.

## Dev & verification tools

- Dev page: `index.html` served from the project root (importmap maps `three` → `node_modules`).
- URL params: `?only=a,b` (load only these modules), `?skip=a`, `?seed=123`, `?q=low`,
  `?warm=8` (simulate 8 s of updates before first render), `?cam=x,y,z` (camera position; target stays core default), `?energy=0.8`, `?veil=1`, `?noauto` (no auto-rotate), `?nohud`.
- Screenshot + console capture (headless Chrome, runs its own static server, safe to run concurrently):
  `node scripts/shot.mjs --url "index.html?only=sky&warm=4" --out shots/sky.png [--w 1280 --h 800] [--wait 2500] [--click 640,500] [--key Space] [--shots 2 --interval 1500]`
  Scripted interaction: `--actions "wait:800;shot;click:640,500;wait:1200;shot;hold:640,300,1500;drag:400,300,900,300;move:600,400;key:Space;eval:window.__festival.state.energy;shot"` (each `shot` writes `<out>-N.png`).
  Prints JSON: `{ errors: [...], warnings: [...], logs: [...], files: [...], fps? }` (`--fps` measures rAF rate; headless uses software GL so fps is only relative). **Any error = failure.**
  Screenshots are PNG files — view them with the Read tool.
- `window.__festival` is the live `ctx` (debugging; `eval:` actions can inspect it).
- Bundle to a single self-contained HTML: `npm run build` → `dist/index.html`.
