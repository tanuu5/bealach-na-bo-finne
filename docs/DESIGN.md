# DESIGN.md: Bealach na Bó Finne (白き牛の道)

This file is the **single source of truth** for the piece. It sits on top of `docs/CORE_CONTRACT.md`, which still governs the engine.

- Every number, key, event and file name here is binding.
- If something here seems wrong, **do not improvise**. Implement it as written, then leave a `// DESIGN-QUESTION:` comment in your own file.
- Words in `code` are identifiers. Irish words appear in *italics* in prose.

---

## 0. Decision record (short)

The piece has one spine and two grafts:

- **Spine:** the *Visual spectacle* proposal. The camera can never look up, so the sky has to come down. The loch in the middle of the stone circle mirrors **the sky of Tír na nÓg**, not ours.
- **Graft from *Interaction & sound*:** the stone circle is a harp strung to stars. Every sound is in D Dorian and quantised by a light conductor. The viewer's own notes come back during the climax.
- **Graft from *Myth & ritual*:**
  - The festival is Lughnasa night, the same season as old-calendar Tanabata and the Perseids.
  - The fire, the rag tree and the stones are the three places of offering.
  - A sunwise (*deiseal*) walk is a secret.
  - Hill beacons answer from across the land.
  - The Milky Way pours down, runs through the monument, and returns to the sky through the fire.

**The one signature moment is "An Bealach":** the White Cow's road comes down.

Scores are in Appendix A.

### 0.1 Revision 2 — technical-art / interaction review (binding)

Everything below is already folded into the sections it names; this list exists so nobody implements from a stale copy.

| # | Change | Why | Where |
|---|---|---|---|
| R1 | `uDescent` is **removed**. The shared climax clock is `uClimaxT` (seconds, `−1` outside a climax cycle, `0..142` inside). | `uDescent` dropped to 0 at T = 32 while afterglow effects still needed T; two encodings of one clock invite drift. | §3.6, §4.4, §7.3, §10 |
| R2 | New **§4.4 Clocks**: `T` lives in the `state.time` domain, anchored from `music:beat.delay`; the conductor re-syncs its score on every `bealach:phase`. | Audio time and `state.time` diverge after hitches and across the audio unlock. | §4.4 |
| R3 | **Pacing**: `perSegment` 2 / 3 / 4; overflow **spills** to the least-lit arm; arming minimum 45 s; aos sí start at 12 s (never-touched) or 20 s idle, every 6 s, weight 1.5; *neglected-arm* demonstration. | The old numbers gave 90–240 s and let a one-object spammer stall forever. Target now: curious first-timer ≈ 60–110 s, passive ≈ 80–95 s. | §4.1, §6.2, §6.4, §7.2 |
| R4 | New event `hint:change`; fire/stones/sceach **beckon** on downbeats while their hint shows. | Hints named objects the viewer could not locate once auto-rotate moved them. | §5.1, §6.2, §9.3 |
| R5 | *Deiseal* is measured whenever `controls.autoRotate === false` in phase idle (includes damping inertia), not only while the pointer is down. | With damping most of a fast drag's rotation lands after `pointer:up`; the old rule failed on real flicks and in headless tests. | §6.2, §10.8 |
| R6 | Harp stars moved to θ = 6.5°…14.9° with a fixed β table. | The old k = 0/1 stars sat at 0.3°/2.4° elevation — behind the mound (crown 2.6° from the camera). | §3.5 |
| R7 | **Firelight falloff** `0.085` → `0.02`, `skyAmbient` ×3, airglow horizon gain 0.8, band gain 0.2, ground albedo raised, grade tint written **raw** (not colour-managed) with a real `uLift`. New **§2.3 tone-mapping calibration** with measured ACES output. | Computed through three's ACES: with the old numbers the portal stones rendered at ≈ (11,4,0)/255 and every `peat`/`airglow×0.35` value crushed to black; `Color.set()` linearised the grade tint so the lift was ≈ 0.0002. | §2.2, §2.3, §3.6, §10.2, §10.3 |
| R8 | Loch fisheye is **not** mirrored east–west. | A true reflection keeps east on the right; the mirrored map put every star's loch echo on the opposite side of the screen from the star. Pole position unchanged. | §10.4 |
| R9 | **Mirrored stones removed** (`stones` no longer draws into the loch). | The stone bank (crest 0.8 m at r 12.5) occludes almost every reflected ray from any allowed camera, so the `gl_FragDepth` + negative-scale instancing trick bought nothing visible. Concept stays pure: the loch shows only the Otherworld sky and the fire. | §3.4, §10.4, §10.6 |
| R10 | The 40 m verdigris **curtain** became a 3 m **veil mist** ring, `BackSide`, far rim only. | A 40 m additive cylinder was a near-full-screen double overdraw and read as aurora/god-ray cliché. | §2.2, §4.3, §7.3, §10.4 |
| R11 | `heightAt`: the noise swell is masked off the mound, so the mound crown is exactly 10.0; ground grid extends to r = 320 to meet the hills; tobar moved to (8.1, 0, 6.2). | Acceptance `heightAt(0,−50) ≈ 9.8 ±0.05` was impossible with ±0.45 noise; a 260→300 m gap showed clear colour at grazing angles; the old tobar ring was half under water. | §3.2, §3.3, §10.3 |
| R12 | Sky objects are **camera-centred**; everything that aims at a star aims at `camera.position + dir·R`. | Threads ended 900 m from the origin and missed their stars by ~10 px of parallax. | §3.5, §10.2, §10.6 |
| R13 | GLSL chunks never declare shared uniforms; a verbatim **declaration block** is added. | `world.sky.glsl` declared `uVeil` and every includer also declares `uVeil` → compile error. | §3.6 |
| R14 | Crown proxy radius 2.6 → 1.9 m. | At the default camera the 2.6 m sphere covered harp stone k2's top (97 px away) and stole its clicks. | §10.7 |
| R15 | HUD: compact layout also for short landscape screens; toast widths fixed so they never overlap the title column; sound button swallows Space/Enter; key auto-repeat ignored; `?nofonts`. | Overlaps at 400×800 and 844×390; Space on a focused button toggled sound *and* opened the veil. | §9 |
| R16 | Screen positions re-projected with three r186 (script output quoted in acceptance). Wall-clock-fragile acceptance checks rewritten with `?warm`, debug counters and pixel sampling. | SwiftShader runs far below 60 fps and `dt` is clamped, so "wait 36 s" ≠ 36 s of `state.time`. | §10 |
| R17 | Budgets rebalanced: river particles 16k/6k, terrain ripples moved into the ground shader, fire flights+beacons merged, draw totals 27/25, fill-rate rules added. | Overdraw, not draw count, is the M1/phone bottleneck. | §11.1 |
| R18 | Camera stays still until T = 42 (end of the ending text); climax distance scales with the portrait rule. | Auto-rotate resumed the instant T passed 32 and swung the frame away mid-sentence. | §7.3 |

---

## 1. Title, logline, pillars

**Title:** 白き牛の道 — *Bealach na Bó Finne*
**Subtitle:** ルーナサの星祭 — *Oíche Lúnasa*

**Logline (JP):**
ルーナサの夜、石の環の中の湖は、常若の国の空を映している。火に、石に、サンザシに捧げものをするたび、星がひとつ生まれる。湖に三つ巴の渦が満ちると、天の川が「白い牛の道」となって地上に降り、環をめぐり、火を通って空へ還る。

**Logline (EN):**
On Lughnasa night, the loch inside a stone circle mirrors the sky of the Otherworld. Every offering at the fire, the harp-stones or the fairy hawthorn kindles a star. When the triple spiral in the loch is full, the Milky Way (the Way of the White Cow) comes down to earth, runs through the circle, and returns to the sky through the fire.

### Art-direction pillars

1. **The sky is the protagonist, so the sky comes down.**
   - Every interaction ends in a star.
   - Every star appears twice: once in the sky and once in the loch.
   - The climax physically brings the Milky Way to the ground.
   - Nothing floats aimlessly. Every particle has a source (fire, ribbon, stone thread, meteor, Milky Way) and a destination (a star, or the loch).

2. **Real Irish material culture, not "Celtic" decoration.** Each motif is tied to its proper material:

   | Motif | Where it may appear |
   |---|---|
   | Cork–Kerry axial stone circle (graded heights, portal stones, recumbent axial stone) | The circle itself |
   | Newgrange-style triple spiral and white quartz facade | Neolithic stone and water only |
   | La Tène compass-drawn trumpet curves | Gold lines only: star arcs, ground ripples and the HUD ornament |
   | Ogham | Along stone edges, read bottom to top |
   | Rag tree | Hawthorn at a well |

   Forbidden: interlace knotwork, shamrocks, "pub" uncial fonts.

3. **Night as it really looks, slightly wrong.**
   - Green-black sky, 557 nm airglow on the horizon, warm-white Milky Way with sharp dust lanes, one small fire.
   - The Otherworld shows only through wrongness: the loch's stars wheel 100× too fast, the loch shows the whole Otherworld sky including the part the camera can never look at, hawthorn blossom and red haws appear together, and gold light appears where no light should be.
   - No purple, no blue gradients, no neon.

---

## 2. Palette and colour script

### 2.1 `ctx.palette`

The lead writes these into `src/palette.js`. Values are sRGB hex. Convert them with `new THREE.Color(hex)`, which gives linear colour, before using them as shader uniforms.

| key | hex | usage rule |
|---|---|---|
| `peat` | `#080D0C` | Zenith sky, clear colour, deepest shadow, loch base. The darkest colour in the piece; it is green-black, never blue-black. On screen it is produced mostly by the grade lift (§2.3), because ACES crushes it to black. |
| `airglow` | `#2E3F2C` | Horizon glow band from 0 to 12° elevation, the hill rim, dim grass. Gain ≤ 0.8 at the horizon, fading to 0 at 12°: a glow, never a fill. |
| `lichen` | `#5E6559` | Stones, the mound kerb, bark, the islet. Always multiplied by lighting, never emissive. |
| `boFinne` | `#ECE4CF` | Everything that **belongs to the sky**: Milky Way, star cores, the milk river, undyed-linen ribbons. A warm white; never tint it blue. |
| `torc` | `#D9A547` | Everything **kindled by the viewer**: born stars, harp threads, ogham glow, spiral fill, carved-spiral glow. May go HDR up to ×3. |
| `ember` | `#FF5E1F` | Fire and sparks only. Firelight uses the shared `fireLight()` colour (§3.6), not this hex. |
| `madder` | `#9E2F22` | Madder-dyed ribbons and red haws. Never used as light. |
| `woad` | `#33506A` | Woad-dyed ribbons **only**. Never in the sky, water, fog or grade. |
| `verdigris` | `#5FA08E` | The Otherworld showing through. Anything verdigris must be multiplied by `uVeil` or `uAfterglow`, **or** belong to an aos sí ghost offering (its motes, sparks and thread tint — the one place it appears at veil 0, and only while that offering is in flight). Otherwise, at veil 0 it does not exist. |

**Hard rules**
- No other hues may be introduced.
- Tints of these colours (mixing a key with `peat`, or scaling it) are allowed.
- Gradients between two keys are allowed only for `peat → airglow` (sky) and `ember → torc → boFinne` (the fire and heat ramp).

### 2.2 Colour script

`E` is `uEnergy` and `V` is `uVeil`, both 0..1. `T` is `uClimaxT`, the climax clock in seconds (§4.4).

| Phase | E / V | What dominates the frame |
|---|---|---|
| Arrival (0–10 s) | 0 / 0 | 85% of the frame is `peat`, `airglow` and `lichen`. There is one small `ember` glow, a soft `boFinne` Milky Way (band gain 0.2, §10.2) and white stars in the loch. |
| Gathering | 0.1–0.7 / 0–0.2 | `torc` accents appear one by one: stars, threads, spiral segments. Firelight visibly reaches the stones (12.5 m) and fades out by ~20 m. Hill beacons show as tiny `ember` points on the far ridge. |
| Hold veil (while held) | – / up to 0.75 | Airglow shifts toward `verdigris`. Loch stars shift from `boFinne` to `torc`. A low `verdigris` mist (≤ 3 m) breathes along the far loch rim. Grass tips shimmer `verdigris`. The mound passage glows `torc`. |
| Spiral complete (waiting for bar) | ≥ 0.6 / 0.3 | The spiral pulses `torc` on each beat. Everything else stays the same. |
| Climax: hush | 0.2 / 0.3 | The fire sinks to embers. The frame is at its darkest since arrival. Twinkle freezes. |
| Climax: pour / river | 1 / 0.6 | The Milky Way and river are `boFinne` at HDR 1.2–1.8, carrying their dark dust lanes. The mound's quartz face and spirals are `torc` ×2.5. The sky has a **dark empty channel** where the band was. |
| Climax: return | 1 / 1 | The fire and column are white-gold (`torc` to `boFinne`, up to ×6). The band re-forms at +30% brightness. |
| Tír na nÓg afterglow (90 s) | 0.55 decaying / 1 | Grade lift tinted `verdigris`. The wish-constellation arcs show in `torc`. Loch trails collapse to points. |
| Return to this world (20 s) | – / 1 → 0 | Back to the Gathering palette. Kindled stars remain. |

**Core grade and fog values** (the lead writes these into `src/config.js`; the `sky` module automates them at runtime, §10.2):

```js
clearColor: 0x080d0c,
fog: { color: 0x0e1511, density: 0.0022 },
bloom: { strength: 0.75, radius: 0.5, threshold: 0.85 },
grade: { vignette: 0.4, grain: 0.03, lift: 0.03, tint: 0x0a1310 },  // boot values only; sky overwrites tint/lift every frame (§2.3)
```

### 2.3 Tone-mapping calibration (measured, binding)

The composer tone-maps with three's `ACESFilmicToneMapping` (exposure 1, which internally multiplies by 1/0.6) and then encodes sRGB. Its toe is steep: **linear values below ≈ 0.005 render as black.** This table is the three r186 ACES curve evaluated in Node (grey input → 8-bit sRGB output). Use it to choose numbers; do not guess.

| linear in | 0.002 | 0.005 | 0.01 | 0.02 | 0.03 | 0.05 | 0.08 | 0.1 | 0.2 | 0.35 | 0.5 | 1.0 | 2.0 | 6.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **8-bit out** | 0 | 3 | 8 | 21 | 31 | 50 | 73 | 86 | 135 | 175 | 197 | 226 | 242 | 252 |

Palette keys at ×1 render as: `peat` (0,2,1) · `airglow` (29,49,28) · `lichen` (94,104,88) · `boFinne` (220,218,209) · `torc` (216,181,89) · `ember` (245,114,41) · `verdigris` (111,175,158). At ×2.5 `torc` is (243,225,160): HDR gold desaturates toward cream. And `torc` only crosses the 0.85 bloom threshold (luminance) at ≈ ×2. So **every glowing gold element is a narrow ×2–2.5 core (which blooms, cream-gold) inside a wider ×0.8–1.2 falloff (which stays saturated gold)** — ogham notches, sparks, threads, spiral pecks. Never fill a large area with ×2+ gold.

**Consequences (already applied elsewhere in this doc):**

1. **Firelight** falloff constant is `0.02` (§3.6). Computed for a `lichen` face turned to the fire at level 0.5 (before grade lift): 3 m → (115,73,27), 12.5 m (the stones) → (43,24,5), 20 m → (20,9,1), 30 m → (7,2,0). With the old `0.085` the stones were (11,4,0), i.e. invisible.
2. **Grade lift supplies `peat`.** `sky` writes `ctx.grade.uTint.value.setRGB(r/255, g/255, b/255)` with the **raw** sRGB bytes of the tint hex (never `.set(hex)`, which linearises it: `0x0a1310` would become (0.003, 0.0065, 0.005)). `uLift` is 0.6 at rest (blacks → ≈ (6,11,9)) and 0.9 in afterglow with tint `#0b1a15` (blacks → ≈ (10,23,19)). Grain 0.03.
3. **Silhouette contrast:** the horizon airglow must be at least 12 luma levels above the lifted black, or stones, mound and hills vanish into the sky. Hence airglow gain 0.8 at 0–1° elevation (≈ (23,41,21) tone-mapped, ≈ (29,52,30) after the lift; lifted black is ≈ 10 luma, this is ≈ 44).
4. **Sky ambient** in `skyAmbient()` is ×3 of the rev-1 value so unlit stone backs read ≈ (8–12) luma instead of 0.
5. **Bloom** thresholds apply to the HDR input *before* tone mapping, so the table above does not change which pixels bloom.

**Pixel-sampling helper (for acceptance checks).** Add `&shot` to the URL (core then sets `preserveDrawingBuffer`) and use this `eval` body, replacing the point list. It samples the composited WebGL canvas only (the HUD is DOM and is not included):

```js
(()=>{const c=document.createElement('canvas');c.width=innerWidth;c.height=innerHeight;const g=c.getContext('2d');g.drawImage(__festival.canvas,0,0,innerWidth,innerHeight);const px=(x,y)=>Array.from(g.getImageData(x,y,1,1).data.slice(0,3));return [[640,469],[700,200]].map(([x,y])=>px(x,y))})()
```

"Luma" in acceptance means `0.2126R + 0.7152G + 0.0722B` on those 8-bit values. Grain adds ±4; average a 5×5 block when a check is within 6 of its limit.

---

## 3. World layout

### 3.1 Axes and compass

- Y is up and 1 unit = 1 m.
- **North is −Z, east is +X, south is +Z, west is −X.**
- **Compass angle φ**: position = `(r·sin φ, y, −r·cos φ)`.
  - φ = 0 is north and φ = 90° is east.
  - Increasing φ is clockwise seen from above. This is **sunwise, *deiseal***.
  - OrbitControls auto-rotate with a positive speed also moves the camera sunwise. Keep it positive.
- The monument axis runs north–south. The portal stones and the sí mound are to the north. The recumbent axial stone is to the south, nearest the default camera.

### 3.2 LAYOUT constants

Every module that needs any of these values **copies this block verbatim** into its own file. There is no shared file; this doc is the contract.

```js
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
```

### 3.3 Terrain: the `heightAt` formula

The `terrain` module owns this and registers it as `ctx.world.heightAt`.

`smoothstep(a, b, x)` is the JS helper `t = clamp((x-a)/(b-a), 0, 1); return t*t*(3-2*t)`. It also works when `a > b`, in which case it falls instead of rising.

```js
function heightAt(x, z) {
  const r = Math.hypot(x, z);
  const dm = Math.hypot(x - 0, z + 50);                               // distance to the sí mound centre
  let h = 0.2 + 0.6 * Math.exp(-(((r - 12.5) / 1.6) ** 2));          // meadow 0.2 + stone bank, crest 0.8 at r=12.5
  h += 0.9 * (fbm2(x * 0.021, z * 0.021) - 0.5)
           * smoothstep(18, 45, r) * smoothstep(21, 26, dm);          // gentle swell: flat near the circle AND on the mound
  h += 9.0 * smoothstep(20, 11, dm) + 0.8 * Math.max(0, 1 - (dm / 11) ** 2);
  h = -0.4 + (h + 0.4) * smoothstep(8.4, 9.8, r);                    // loch shore dips under the water
  return h;
}
```

- `fbm2` is 4-octave value noise in [0,1], seeded with `ctx.makeRng('terrain')`.
- The function must be identical wherever it is sampled, so only `terrain` evaluates it. Other modules call `ctx.world.heightAt`.
- Measured values (noise-free points): mound crown `heightAt(0,−50) = 10.0`, bank crest `heightAt(12.5,0) = 0.8`, loch bed `heightAt(0,0) = −0.4`, kerb line `heightAt(0,−30.6) ≈ 0.31`.
- The ground crosses the water plane at **r ≈ 9.25** (visible shoreline); `heightAt(9,0) ≈ −0.16`. The water mesh (r 9.4) therefore always meets the shore.
- Stones stand at bank-crest height 0.8. The sceach base is at about 0.37 and the tobar ring at about 0.27 (its innermost stones ≈ 0.2, all above water).

### 3.4 Elements

| Element | Owner | Position and size | Look |
|---|---|---|---|
| **Loch** (*loch*) | `loch` | Disc at y = 0, radius 9.0 (mesh radius 9.4, tucked under the shore). | Near-black water showing the Otherworld all-sky fisheye (§10.4). It also carries the fire streak, ripples, the triple spiral and the veil mist. It reflects **nothing of this world except the fire** (no stone or tree reflections: the bank occludes them anyway). |
| **Islet** | `fire` | Flat stone platform, radius 1.4, top at y = 0.35. The edge is noise-displaced. | `lichen` stone, wet and dark at the waterline. |
| **Fire** (*tine chnámh*) | `fire` | Base (0, 0.35, 0). Flame 1.4 m tall at idle, 3.2 m at a surge. | Small and blackbody-coloured. It is the only warm light source. |
| **Stone circle** | `stones` | 11 stones at r = 12.5 on the bank crest, as in `LAYOUT.stones`. Heights are graded: portals 3.6 m in the north, recumbent 1.1 m in the south. `h` is the height **above** the bank (top y = 0.8 + h); each stone is additionally buried 0.3 m. Real Cork–Kerry circles run portal-NE / recumbent-SW; the axis is turned to N–S here so the portal gap frames the Milky Way foot (a deliberate liberty, never claimed as orientation fact). | Tapered, noise-displaced slabs with their broad faces toward the centre. Ogham notches run up one edge. The recumbent lies long-side tangent to the circle. |
| **Harp threads** | `stones` | One per harp stone, from the stone top to its *harp star* (§3.5). | Thin twisted `torc` ribbon, visible only while that stone rings. |
| **Sceach gheal** (the rag tree) with *ribíní* | `sceach` | Trunk base `LAYOUT.sceach.pos`, 4.6 m tall, crown radius 2.4, leaning 8° away from the loch. | Wind-bent, gnarled, sparse. Ribbons are `madder`, `woad` and `boFinne` linen. |
| **Tobar** (holy well) | `sceach` | Ring of 9 small stones, radius 0.55, at `LAYOUT.tobar.pos`. | A dark water disc and a faint rill toward the loch. |
| **Sí mound** | `terrain` | Centre (0, 0, −50), radius 20, height 9 plus 0.8 dome on the 0.2 meadow: crown y = 10.0. Kerb of 40 kerbstones at d = 19.4. Entrance stone and passage at (0, 1.1, −30.6), facing +Z. At the default camera the passage is hidden behind the east portal stone (both project to x ≈ 740); it is seen through the portal gap in the climax pose. | Grass-topped. The front arc (±50° around +Z, 1.5–4 m high) is a white-quartz facade (`boFinne` albedo 0.18 with sparkle). The entrance stone carries a pecked triple spiral that glows `torc` in the climax. |
| **Hills** | `terrain` | Ring mesh from r = 300 to 700; its inner skirt starts 2 m below the ground grid (which runs to r = 320) so there is never a gap. Ridge at r = 420. Ridge elevation seen from the origin is 1.0–3.5°. It dips to 1.0° inside ±20° of north so the Milky Way foot and the mound read clearly. | Silhouettes fogged toward the fog colour, with an `airglow` rim on the ridge. |
| **Hill beacons** | `fire` | 9 fires on the ridge at r = 420, φ from `LAYOUT.beacons`. | Tiny `ember` point sprites of 2–3 px. They light one by one, sunwise from φ = 336° (then 20°, 62°, …), as energy rises; the first two flank the mound in the default frame. |
| **Grass** | `terrain` | Instanced tufts at r 10–45 (high quality only). Excluded from the loch, the islet and within 1 m of the stones and the tobar. | Dark `airglow`/`lichen` blades with firelit tips. Tips shimmer `verdigris` with the veil. |

### 3.5 The sky, and where things are as seen from the default camera

The `sky` module owns the sky.

- **Camera-centred sky (binding for every module).** A sky "direction" `dir` is drawn at `camera.position + dir·R` (dome R = 1500, stars R = 1400), so it lands on the same pixel from any camera position. Anything that flies to, points at or ends on a star (threads, sparks, motes, meteors) aims at `camera.position + dir·R_target` evaluated **that frame** (motes/sparks may freeze the camera position at launch). Never use `origin + dir·R`: at the default camera that misses by up to 10 px.
- **Dome**: radius 1500, rendered first, with no fog on it. The sky does **not** rotate. In this world the sky stands still; only the loch's Otherworld sky wheels.
- **Airglow**: a band from 0 to 12° elevation, `airglow` × 0.8 at the horizon falling to 0 at 12° (§2.3), with faint horizontal wave striations. Its colour moves toward `verdigris` as `V` rises.
- **Milky Way** (*Bealach na Bó Finne*), a great circle:
  - `H = LAYOUT.sky.bandFoot`, `N = LAYOUT.sky.bandPole`, `T = normalize(cross(H, N))`. T works out to about (0.4645, 0.8826, −0.0653), the upward tangent.
  - A band coordinate θ (along the band, 0 at the north foot, increasing upward) and β (across the band, positive toward N) maps to a direction with `dir(θ,β) = cosβ·(cosθ·H + sinθ·T) + sinβ·N`.
  - Brightness is `boFinne` × `uBandGain` × profile, with `uBandGain` = 0.2 at rest (core luma 70–110 on screen, §2.3). Width is β half-width 9° at θ = 0 (a bulge centred at θ = 5°, half below the horizon), narrowing to 5° by θ = 90°.
  - Dark dust lanes (a Great Rift look) come from the band texture (§10.2) and stay **sharp**. The band stays below the bloom threshold.
  - The band culminates at 62° elevation and sets again near the south horizon.
- **Harp stars**: 8 fixed stars in the band foot, one per harp stone.
  - For harp stone *k* (0..7 in `LAYOUT.stones` order), θ = 6.5° + 1.2°·k and β = `LAYOUT.sky.harpStars.beta[k]`. Elevations 4.5° → 13.9°: all sit **above** the mound crown (2.6° from the camera) and below the frame top (16.0°). The low notes sit lowest, which is what the viewer sees.
  - The slight β wobble keeps them from reading as a ruled line (§11.3 #6).
  - Idle brightness is 0.5. The stones module drives them up to 3.
- **Orihime and Hikoboshi** (織姫 = Vega, 彦星 = Altair): two named stars, 1.8× brighter than any other, on either bank of the band. Vega is at θ = 12°, β = +7°, direction ≈ (−0.146, 0.239, −0.960). Altair is at θ = 12°, β = −7°, direction ≈ (0.067, 0.125, −0.990). (Their real positions differ; the piece compresses them into the visible 16° of sky. Never claim otherwise in copy.)
- **Perseids**: ambient meteors radiating from φ 40°, elevation 25°.

**Default camera frame** at 1280×800 (see §3.7). Screen positions in px from the top-left, tolerance ±40 px. Rev 2: every value below was re-projected with three r186 (`PerspectiveCamera(50)`, `lookAt(0,2.5,0)`, sky points at `camera + dir·1400`, noise-free `heightAt`).

| Thing | Screen position |
|---|---|
| Horizon line | y = 264; top of frame is 16.0° elevation |
| Milky Way foot | (701, 264) — hidden behind the mound; the band clears the mound silhouette at ≈ (725, 225), then passes (738, 195) at θ=5°, (777, 123) at θ=10°, (818, 45) at θ=15°, leaving the top edge at x ≈ 840 |
| Harp stars k0…k7 | (785,193) (771,163) (796,154) (780,123) (803,111) (784,78) (811,68) (794,34) |
| Vega | (693, 38) |
| Altair | (892, 146) |
| Sí mound silhouette | above the horizon from x ≈ 596 to 935, crown y ≈ 222 at x ≈ 752 |
| Portal stones | east portal top (741, 315), west portal top (657, 314); inner faces at mid-height ≈ (730, 356) and (665, 355); the **portal gap is centred under the band foot (x ≈ 700)** |
| Mound passage | (738, 349) — occluded by the east portal in the full scene |
| Fire | base (640, 469), idle flame top (640, 424) |
| Loch ellipse | N rim (686, 427), S rim (549, 586), E rim (948, 497), W rim (373, 466); centre (640, 480) |
| Otherworld pole in the loch | (660, 456) |
| Recumbent stone | top (481, 553), low foreground left of centre |
| Sceach | base (985, 549), top (1030, 345), crown centre (1011, 420) — right third |
| Tobar | (944, 557) |

**Climax pose** (azimuth 0°, polar 84°, distance 32; 1280×800): horizon y = 310; band pillar at x = 640 from the horizon to the top edge; Vega (529, 121), Altair (751, 121); harp stars from (672, 210) up to (606, 73); mound crown (640, 266); pillar-top path point P0 (640, 52); portal tops (676, 338) and (604, 338) with the gap spanning y ≈ 338–408; passage (640, 375) visible through the gap; fire base (640, 457); loch N rim (640, 432), S rim (640, 526); sceach crown ≈ (947, 394).

### 3.6 Shared GLSL

**Copy verbatim.** No module uses three.js lights. Every lit surface uses these functions, so the fire lights everything the same way.

Extension uniforms are created lazily. Any module may run `ctx.uniforms.uFireLevel ??= { value: 0 }` (defaults: `uFireLevel` 0 — no fire, no firelight when `fire` is absent; `uClimaxT` −1; `uAfterglow` 0; `uOtherAngle` 0), and all modules then share the same object. Only the listed writer changes `.value`.

| uniform | type | writer | meaning |
|---|---|---|---|
| `uFireLevel` | float 0..1.5 | `fire` | Fire intensity. 0.15 embers, 0.5 idle, 1.0 surge, 1.5 white-gold climax. |
| `uClimaxT` | float (s) | `bealach` | The climax clock `T` (§4.4): `−1` while phase is `idle`; `0 → 142` through hush … fade. Replaces rev-1 `uDescent`. |
| `uAfterglow` | float 0..1 | `bealach` | Tír na nÓg afterglow intensity. |
| `uOtherAngle` | float (radians) | `sky` | Rotation angle of the Otherworld sky about the celestial pole. `loch` reads it. |

**Declaration rule.** GLSL chunks (`FIRELIGHT`, `world.sky.glsl`, anything shared) contain **functions only and never declare uniforms**. Every shader that includes a chunk pastes this block verbatim at the top of the stage that needs it, and may delete lines it does not use (unused uniforms are harmless; unused *varyings* are not). A chunk that needs its own uniforms (e.g. `uBandTex`) documents them, and the owning module exports those uniform objects for includers to plug in:

```glsl
// SHARED-UNIFORMS v2 — docs/DESIGN.md §3.6
uniform float uTime;       // ctx.uniforms.uTime
uniform float uEnergy;     // ctx.uniforms.uEnergy
uniform float uVeil;       // ctx.uniforms.uVeil
uniform vec3  uFirePos;    // ctx.uniforms.uFirePos
uniform float uFireLevel;  // ctx.uniforms.uFireLevel  (??= {value:0})
uniform float uClimaxT;    // ctx.uniforms.uClimaxT    (??= {value:-1})
uniform float uAfterglow;  // ctx.uniforms.uAfterglow  (??= {value:0})
uniform float uOtherAngle; // ctx.uniforms.uOtherAngle (??= {value:0})
```

The JS side plugs in the **same objects**: `uniforms: { ...pick(ctx.uniforms, [...]), ...ownUniforms }`, after the `??=` lines have run.

```glsl
// FIRELIGHT v2 — docs/DESIGN.md §3.6. Needs uFirePos, uFireLevel, uTime, uVeil (declared by the includer).
vec3 fireLight(vec3 wp, vec3 n) {
  vec3 L = (uFirePos + vec3(0.0, 1.1, 0.0)) - wp;
  float d = length(L); L /= max(d, 1e-3);
  float flick = 0.86 + 0.14 * sin(uTime * 11.0) * sin(uTime * 7.3 + 1.7);
  float fall = 1.0 / (1.0 + 0.02 * d * d);                           // §2.3: stones at 12.5 m must read
  float wrap = clamp(dot(n, L) * 0.75 + 0.25, 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.42, 0.14), vec3(1.0, 0.86, 0.62), clamp(uFireLevel - 1.0, 0.0, 1.0));
  return col * (0.4 + 2.6 * uFireLevel) * flick * fall * wrap;          // linear HDR
}
vec3 skyAmbient(vec3 n) {                                            // starlight + airglow fill
  float up = n.y * 0.5 + 0.5;
  vec3 base = mix(vec3(0.030, 0.042, 0.036), vec3(0.060, 0.081, 0.072), up);
  return base + vec3(0.036, 0.105, 0.084) * uVeil * up;               // verdigris only with the veil
}
```

Custom `ShaderMaterial`s for ground-level geometry (terrain, hills, stones, tree, islet) set `fog: true` and include `fog_pars_*` and `fog_*` chunks. Emissive sky-bound effects (stars, the river, the column, threads, motes) set `fog: false`.

### 3.7 Default camera and core requests

The lead writes these into `src/config.js`:

```js
camera: {
  fov: 50, near: 0.1, far: 3000,
  position: [5.34, 6.57, 25.12],   // distance 26, polar 81°, azimuth +12° (camera slightly east of the axis)
  target: [0, 2.5, 0],
  minDistance: 12, maxDistance: 60,
  minPolarAngle: 55°, maxPolarAngle: 87°,
  autoRotateSpeed: 0.3,            // positive = sunwise; one orbit ≈ 200 s
  idleResumeSeconds: 6,
  autoRotateDwell: { slow: 0.15, fast: 0.62, centerDeg: 12 },
},
```

**Auto-rotate dwell (added by the lead after the integration review).** The Milky Way only shows on the
northern half of the orbit; for the other half the upper third of the frame is nearly empty, which breaks
pillar 1 ("the sky is the protagonist"). Core therefore varies the sunwise speed with the camera azimuth
`az`: `w = 0.5 + 0.5·cos(az − 12°)` (1 where the band composes, 0 facing away) and
`autoRotateSpeed = fast + (slow − fast)·w²` — 0.15 at the default framing, ≈ 0.62 crossing the empty sky.
It is **always positive**: anti-sunwise (*tuathal*) drift is never acceptable. `bealach` still owns the
camera during the climax and this rule only applies while `controls.autoRotate` is true.

**Portrait rule (lead, core request CR-1 in Appendix B):** when `aspect < 1`, set the camera distance to
`clamp(26 * 0.85 / aspect, 26, 48)` along the same direction **before modules load** and on resize (on resize only
if the user has not zoomed, i.e. the current distance is within 0.5 m of the previous automatic distance).
**The look-at rises with the same aspect** — `target.y = 2.5 + 2.7·clamp((1 − aspect)/0.5, 0, 1)`, so 5.2 at 400×800 —
because the extra height of a phone screen should go to the sky, not to empty foreground meadow (the ship-check
found the bottom quarter of the portrait frame near-black with the flat 2.5 target). At 400×800 the distance is
44.2 m and the fire sits near (200, 470) with the stone circle and mound in the lower half and the band filling the
upper two thirds; the sceach crown sits on the right edge and stones k4–k6 are off-frame, which is accepted.
Landscape screens (`aspect ≥ 1`) are unaffected: distance 26, target (0, 2.5, 0).

**Camera ownership:**
- Only `bealach` may write `ctx.controls` or `ctx.camera`, and only while `0 ≤ T < 42` (§7.3).
- Everybody else treats the camera as read-only.
- `bealach` reads the boot distance `d0 = camera.position.distanceTo(controls.target)` at setup (after the portrait rule) and scales its climax distance by `d0/26`.

**The default frame must show all of these** (checked in §10.10):
1. Sky over the top ~33%, with the airglow band on the horizon.
2. The Milky Way rising from the portal gap and leaving the top edge right of centre, with Vega and Altair on either side.
3. The mound silhouette.
4. Two firelit portal stones framing the band foot.
5. The loch as a wide ellipse through the middle with its wheeling gold-white star trails.
6. The small fire at centre.
7. The sceach in the right third.
8. The low recumbent stone at lower-left.

---

## 4. Shared state semantics

### 4.1 `state.energyTarget`: festival intensity

- **Increments** are added by the module that handles the interaction, at the moment it happens. Core clamps the result to 0..1.
- Offerings performed by the aos sí (`byAosSi: true`) add **half** the listed amount.

| Source | Δ energyTarget | Written by |
|---|---|---|
| Tap harp stone | +0.02 | `stones` |
| Hold harp stone (on release) | +0.05 | `stones` |
| Tap portal or recumbent stone | +0.01 | `stones` |
| Tap fire | +0.03 | `fire` |
| Hold fire (on release) | +0.08 | `fire` |
| Tap sceach (tie ribbon) | +0.06 | `sceach` |
| Hold sceach (release) or typed ogham word | +0.08 | `sceach` |
| Tap sky (meteor) | +0.015 | `sky` |
| Tap loch | +0.015 | `loch` |
| Tap ground or mound | +0.01 | `terrain` |
| Spiral segment filled | +0.02 | `bealach` |
| Sunwise camera turn (*deiseal*) | +0.10 | `bealach` |
| Anti-sunwise turn (*tuathal*) | −0.10 | `bealach` |

**Decay** (written by `bealach` only):
- Applies when `state.idleTime > 4` and the phase is `idle`, `afterglow` or `fade`: `energyTarget -= 0.015 * dt`.
- Floor: 0.06 before the first climax, 0.15 after it.
- **Debug pin:** when the URL has `?energy=`, `bealach` applies neither decay nor climax overrides to `energyTarget`; when it has `?veil=`, `bealach` never writes `veilTarget`. (Otherwise `&veil=1` screenshots of the full piece would decay to 0.)

**Climax overrides:** `bealach` sets `energyTarget` every frame to

| hush | pillar | pour | river | return | afterglow start |
|---|---|---|---|---|---|
| 0.2 | 0.6 | 0.9 | 1.0 | 1.0 | 0.55, then normal decay |

### 4.2 `state.veilTarget`: how open the Otherworld is

**`bealach` is the only writer.**

| Situation | veilTarget |
|---|---|
| Base (idle) | 0 |
| Spiral complete, waiting for the downbeat | 0.3 |
| Hold on empty space, or hold Space | rises by `0.45·dt` each frame up to 0.75; after release, falls by `0.3·dt` back to base |
| Climax: hush / pillar / pour / river / return | 0.3 / 0.45 / 0.6 / 0.8 / 1.0 |
| Afterglow (90 s) | 1.0 |
| Fade (20 s) | 0.25, then 0 |

### 4.3 What `uEnergy` (E) and `uVeil` (V) mean to each module

| Module | E (0 → 1) | V (0 → 1) |
|---|---|---|
| `sky` | Twinkle amplitude 0.10 → 0.35. Perseid rate 0.02 → 0.22 per s. Bloom strength `0.75 + 0.2·E`. | Airglow mixes toward `verdigris` by 0.8·V. Twinkle ×(1 − 0.6·V). Fog colour mixes toward `#0f1a17` by V. Grade tint moves toward `#0b1a15`. Wish arcs show at alpha `0.35·max(V, uAfterglow)`. |
| `terrain` | Grass sway amplitude 0.4 → 1.0. | Grass tips gain `verdigris·0.6·V`. Mound passage glows `torc × 1.5·V`. |
| `loch` | Trail brightness 0.6 → 1.0. Flicker ripples on the water 0.3 → 1.0. | Loch stars move from `boFinne` to `torc`. Trail length ×(1 + V). Reflection-only stars fade in above V > 0.2. Veil mist height `3·smoothstep(0.2, 1, V)` m, alpha `0.18·smoothstep(0.2, 1, V)`. |
| `fire` | Idle `uFireLevel = 0.4 + 0.25·E`. Spark rate ×(1 + E). Beacons lit = `min(9, floor(E·10))`, lit sunwise from φ = 336°. | Flame colour blends +0.2·V toward white-gold. |
| `stones` | Ringing thread brightness ×(0.7 + 0.3·E). | Every stone's ogham gets a baseline glow of 0.4·V. |
| `sceach` | Ribbon flutter amplitude 0.5 → 1.0. | Ribbons lift: gravity ×(1 − 0.7·V). Motes rise 30% slower. |
| `bealach` | — (it writes these values) | — |
| `conductor` | See the layer table below (hysteresis 0.05 on the way down). | Drone lowpass 350 → 1400 Hz. When V > 0.5, each `note:played` is echoed a fifth lower. |
| `hud` | — | Nothing. The text stays legible. |

**Conductor layers by energy**

| E | Adds |
|---|---|
| ≥ 0.3 | Bodhrán heartbeat |
| ≥ 0.5 | Dm \| C pad |
| ≥ 0.7 | Four-chord cycle and harp ornaments |

### 4.4 Clocks (binding)

Three clocks exist. Mixing them is the most likely integration bug in this piece.

| Clock | Read with | Domain | Used for |
|---|---|---|---|
| Visual | `state.time`, `t` in `update` | Seconds of clamped `dt` (a 200 ms hitch advances it 50 ms). Starts at load. | All animation, `uTime`, idle timers, **the climax clock T** |
| Music | `M.now()` (`world.music`) | `state.time` until audio is unlocked **and** `A.ctx.state === 'running'` (iOS can report `currentTime` 0 for a while after unlock); `A.now()` after. It **jumps** once, at that switch. | Beat grid, `M.next()`, `music:beat.when` |
| Audio | `A.now()` | `AudioContext.currentTime`; 0 before unlock; stops while the tab is hidden | Scheduling Web Audio voices |

Rules:

1. **Visual code never compares `when` with `state.time`.** A `music:beat` handler that wants a visual pulse uses `payload.delay` (seconds from now) and schedules against `state.time + delay`. A visual that must land on a grid time (a spark arriving on the eighth) computes `delay = M.next(div) − M.now()` once, then animates in `state.time`.
2. **Voices** scheduled at a grid time pass `when` straight to `A.pluck/bell/drum/whoosh` (after unlock `M` time *is* audio time). Before unlock voices are no-ops, so the jump is harmless. At the unlock the conductor re-phases its grid (the next beat is allowed to be up to one eighth early or late, and `music:beat.index` continues without repeats).
3. **The climax clock `T`** is visual-domain: on the arming downbeat `bealach` stores `tStart = state.time + beat.delay`; thereafter `T = state.time − tStart` (or the pinned `?phaseT` value). `world.bealach.T` and `ctx.uniforms.uClimaxT.value` are written once per frame **at the top of `bealach.update`**; modules loaded earlier (`conductor`…`sceach`) therefore see last frame's T — a one-frame lag that is accepted everywhere.
4. **Score re-sync.** The conductor schedules each phase's notes when it receives that phase's `bealach:phase` event, at `M.now() + (T_note − payload.T)` (skipping notes with `T_note < payload.T`; before unlock nothing sounds, but the timing logic is identical). Hitches can therefore misalign sound and picture only within one phase, never across the 36 s.
5. **Grid re-anchor.** The conductor restarts its bar grid on `bealach:phase` for `hush` (T = 0, 6/8), `river` (T = 16, 9/8) and `afterglow` (T = 32, 6/8), with bar 1 beginning at `M.now() + (T_phaseStart − payload.T)`.
6. **Pure functions of T.** Climax visuals are functions of `T` (or `uClimaxT`) only. Exempt, because they are ambient and not screenshot-checked by position: `uOtherAngle` accumulation, twinkle, sparks' idle stream, grass wind.

---

## 5. Custom events and `ctx.world` registry

Handlers run synchronously, in module load order. Payload objects must not be kept after the handler returns, except where stated. Vector3 values in payloads are fresh clones.

### 5.1 Custom events

| Event | Payload | Emitter | Consumers |
|---|---|---|---|
| `offering` | `{ kind: 'fire'\|'stone'\|'wish', weight: number, source: 'tap'\|'hold'\|'word'\|'deiseal'\|'aossi', pos: Vector3, byAosSi: boolean }` | `fire`, `stones`, `sceach` | `bealach` (spiral progress incl. spill, §6.4), `hud` (hint sequence: **only `byAosSi === false` advances hints**) |
| `star:born` | `{ id: number, dir: Vector3, kind: 'harp'\|'ember'\|'wish', color: number, mag: number, onScreen: boolean, byAosSi: boolean }` | `sky`, from inside `addStar()` (`onScreen` = the direction projects inside the frame at birth; `byAosSi` copied from `addStar` opts) | `loch` (adds reflection; flares it ×2 for 1.5 s when `!onScreen`, so the viewer still sees the star born), `hud` (first non-harp star → *réalta* toast) |
| `stone:ring` | `{ id: 0..10, k: 0..7 or -1, degree, octave, level: 0..1, held: boolean, byAosSi: boolean }` | `stones` | `hud` (ringing meter) |
| `wish:tied` | `{ index: number, word: string\|null, ogham: string\|null, dye: 'madder'\|'woad'\|'linen', pos: Vector3, byAosSi: boolean }` | `sceach` | `hud` (ogham stemline) |
| `fire:surge` | `{ level: number, plume: boolean }` | `fire` | `conductor` (crackle burst) |
| `meteor:land` | `{ point: Vector3, inLoch: boolean, strength: 0..1 }` | `sky` | `loch` (ripple, if inLoch), `terrain` (ground ripple, if not), `hud` (t-loch) |
| `note:played` | `{ src: string, degree: number\|null, octave: number, voice: 'pluck'\|'bell'\|'drum', when: number, byAosSi: boolean }` | `stones`, `fire`, `sceach`, `sky`, `loch`, `terrain`, `bealach` (every audible interaction note; emitted even when sound is off so memory still fills) | `conductor`: memory stores only `byAosSi === false && src !== 'bealach' && degree !== null`, collapsing an identical (src, degree, octave) within 0.5 s into one entry; echoes apply to all entries with a degree. The conductor never emits `note:played` for its own voices. |
| `music:beat` | `{ index, bar, beatInBar, meter: '6/8'\|'9/8', when: number, delay: number }` | `conductor` (emitted when scheduled, `delay` = `when − M.now()` ∈ [0, 0.12]; `index` never repeats, even across the unlock and grid re-anchors) | `stones` (idle blink, beckon), `fire` and `sceach` (beckon), `loch` (spiral pulse), `bealach` (downbeat trigger), `hud` (hint pulse, sound-button strokes) |
| `music:echo` | `{ notes: [{ degree, octave, when }] }` | `conductor` | `loch` (one centre ripple per note, timed to `when`) |
| `spiral:progress` | `{ light: [l0,l1,l2], segments: [s0,s1,s2] (each 0..3), filled: 0..9, justFilled: {arm, segment}\|null, complete: boolean, cycle: number }` | `bealach` | `loch` (draws the spiral), `hud` (hints) |
| `aossi:offer` | `{ kind: 'fire'\|'stone'\|'wish', weight: 1.5 }` | `bealach` | `fire`, `stones`, `sceach` (each performs a ghost offering of its kind, then emits `offering{kind, weight, source:'aossi', byAosSi:true}` with the weight it received) |
| `veil:hold` | `{ active: boolean }` | `bealach` | `conductor` (swell and filter), `loch` (mist gust), `hud` (h4) |
| `deiseal:turn` | `{ dir: 1 \| -1 }` | `bealach` | `stones` (strum, or mute), `conductor` (cold wind on −1), `hud` (toast) |
| `bealach:phase` | `{ phase: 'idle'\|'hush'\|'pillar'\|'pour'\|'river'\|'return'\|'afterglow'\|'fade', T: number, dur: number, cycle: number }` | `bealach` — once per transition, with `T` = the actual T of that frame (it may be past the phase start, e.g. `?phaseT=20` emits only `river` with T = 20). Never repeated per frame. | every module (see §7.3) |
| `ogham:word` | `{ word: string, ogham: string }` | `hud` | `sceach` |
| `hint:change` | `{ id: 'h0'\|'h1'\|'h2'\|'h3'\|'h4'\|'h5'\|null, target: 'fire'\|'stone'\|'wish'\|'veil'\|'loch'\|null }` | `hud`, whenever the visible hint changes (null when hidden) | `fire`, `stones`, `sceach`: **beckon** while `target` is theirs (§6.2). Without `hud` nobody beckons except the stones' own idle blink. |

The arms of `spiral:progress` are indexed: arm 0 = stone, arm 1 = wish, arm 2 = fire.

### 5.2 The hold-claim protocol

Holds on pickables must not also open the veil. The rule is **nearest wins**:

1. On `hold:start`, each of `stones`, `fire` and `sceach` raycasts **its own** proxies with `payload.ray`, using a private `THREE.Raycaster`.
2. If it hits, and `ctx.world.bealach` exists, it pushes `{ by: '<module>', distance, act: () => releaseFn }` onto `payload.candidates`, creating the array with `payload.candidates ??= []`. `act()` starts the hold behaviour and returns a function to call on release, `release(heldMs)`.
3. If `ctx.world.bealach` does not exist, the module calls `act()` directly.
4. `bealach` loads after all three. In its own `hold:start` handler it calls `act()` on the nearest candidate only. If there are no candidates, it starts the veil hold.
5. On `hold:end`, `bealach` calls the stored release function.
6. A module does **nothing visible or audible** on `hold:start` until its `act()` runs (losers of the claim must stay silent).
7. During `hush`…`return` `bealach` calls no `act()` and starts no veil hold. If the climax starts while a hold is active, `bealach` calls `release(heldMs)` immediately and ignores the later `hold:end`. (Without `bealach`, modules act directly, as in rule 3.)
8. Keyboard veil hold: `bealach` starts it on a `key` event with `code === 'Space'` only if Space is not already down (it keeps its own `keydown`/`keyup` `window` listeners to track key state, because `key` events auto-repeat), and ends it on `keyup`, or on `blur`.

### 5.3 `ctx.world` fields

| Field | Type | Owner (writer) | Read by |
|---|---|---|---|
| `world.music` | `{ now(): number, meter: '6/8'\|'9/8', eighth: number, next(division: 'sixteenth'\|'eighth'\|'beat'\|'bar'): number, chord(): number[], PENTA: [0,1,3,4,5], allow(key: string): boolean }` | `conductor` | Every module that makes sound |
| `world.sky` | `{ radius, starRadius, frame: { H, T, N } (live Vector3s), dirOnBand(theta, beta, out), addStar(dir, opts) → id, setStarLevel(id, level), removeStar(id), starDir(id, out) → Vector3 (live, includes sky rotation), harpStarIds: number[8], pickViewDir({ minElevDeg, maxElevDeg }) → Vector3, bandTexture: THREE.Texture, catalog: { count, dirs: Float32Array, mags: Float32Array, colors: Float32Array }, glslDecl: string, glsl: string, uniforms: object, named: { vega: Vector3, altair: Vector3 } }` (all directions are camera-centred sky directions, §3.5) | `sky` | `loch`, `stones`, `fire`, `sceach`, `bealach` |
| `world.heightAt` | `(x, z) => number` (§3.3) | `terrain` | All |
| `world.groundMeshes` | push only | `terrain` (ground and mound), `loch` (water disc) | Core input |
| `world.terrain` | `{ mound: { center: Vector3, radius, crownY: 10.0, passage: Vector3 }, ripple(x, z, strength), ridgeY(phiDeg) → number }` | `terrain` | `fire` (beacons), `bealach` |
| `world.loch` | `{ radius: 9, contains(x, z) → boolean, project(dir, out) → Vector3, ripple(x, z, strength), spiralPoint(arm, s, out) → Vector3 }` | `loch` | `sky` (meteor target), `terrain` (ignores clicks inside), `hud` (t-loch), `bealach` (radius) |
| `world.fire` | `{ pos: Vector3 (= world.firePos), level(): number, proxy: Object3D, beaconsLit: number }` | `fire` | acceptance |
| `world.stones` | `{ bases: Vector3[11], tops: Vector3[11], ringing: Float32Array(11), proxies: Object3D[11] }` | `stones` | `bealach` (debug/acceptance only), `hud` (meter fallback) |
| `world.sceach` | `{ pos: Vector3, crown: Vector3, proxy: Object3D, lastWish: {word, ogham}\|null }` | `sceach` | acceptance |
| `world.bealach` | `{ phase: string, cycle: number, armed: boolean, T: number (seconds since trigger, running 0→142 through climax, afterglow and fade; −1 in idle), light: number[3], perSegment: number, turns: { deiseal: number, tuathal: number }, particleCount: number }` | `bealach` | `hud`, all (read-only) |
| `ctx.ui.toast` | `(text, ms?) => void` (replaced) | `hud` | All. Never call it during `setup`, and never cache the function: always call `ctx.ui.toast(...)` at use time (it is replaced when `hud` loads last). |

**Load-order rule.** A field written by a module that loads **later** than you (e.g. `sky` → `world.loch`, `terrain` → `world.loch`, `conductor` → `world.bealach`) must be read lazily at use time, never captured in `setup`. Fields from earlier modules may be read in `setup` (e.g. `loch` compiling `world.sky.glsl`, `fire` calling `world.terrain.ridgeY`).

**Feature detection is mandatory.** Examples:
- `ctx.world.music?.allow('stone') ?? true`
- `ctx.world.sky?.addStar(...)`. If `sky` is absent, skip the star but still emit `offering`.
- `ctx.world.loch?.contains(x, z) ?? (Math.hypot(x, z) < 9)`

---

## 6. Interaction map

### 6.1 Conventions

- `A` is `ctx.audio`, `M` is `ctx.world.music`, and `n(d, o)` is `A.note(d, o)`.
- `PENTA = [0,1,3,4,5]` are D, E, G, A, B (scale degrees of D Dorian).
- `pan` is the screen NDC x of the interaction × 0.7.
- **Every voice call is guarded** by `M?.allow(key) ?? true`, and followed by `note:played`.
- **"Elevation degree"** maps a sky direction to a note: `elevNote(dir) = PENTA[floor(clamp((elevDeg - 4) / 14, 0, 0.999) * 5)]`, where `elevDeg` is the direction's elevation in degrees. In the table below, `n(elevDeg, 2)` is shorthand for `n(elevNote(dir), 2)`.
- A module's direct response sound **plays immediately and is never quantised**. Only the sky's "answer" is quantised to `M.next('eighth')`. When `M` is absent, use `A.now() + 0.35`.
- **Every interaction gives visible feedback within 100 ms, with sound off.** Sound is never the only response (many phones are muted).

**Touch parity (binding).** Every gesture that matters works with one finger:

| Desktop | Touch | Notes |
|---|---|---|
| Click | Tap | Same core `click:*` events. |
| Press and hold (≥ 450 ms, no movement) | Long-press | Needs CR-2 (no callout/context menu). |
| Drag | One-finger drag | Orbit and *deiseal*. |
| Wheel | Pinch | Zoom (core OrbitControls). Nothing depends on it. |
| Hover rim-light | — | Decorative only. |
| Keys `1`–`8`, `0` | Tap the stone / fire | Shortcuts only. |
| Space (veil) | Long-press on the sky | h4 teaches the touch form, which also works with a mouse. |
| Typing ogham | Long-press the sceach (cycles five words) | Typing stays a desktop secret. |

On coarse pointers (`matchMedia('(pointer: coarse)')`), stone and fire proxies are 2.2× the visual width instead of 1.6× (height unchanged), **except stones id 3 and 4**, which flank the sceach and stay at 1.6×. At 2.2× the closest pair of stone proxies (the portals) still leaves a 0.8 m gap.

### 6.2 Gestures

| Gesture | Module | Visual | Audio | Offering / energy |
|---|---|---|---|---|
| **Tap harp stone k** | `stones` | Ogham notches on the stone's edge light bottom→top over 0.4 s (`torc` ×2.5). The stone's ring level becomes 1 and decays linearly over 10 s. Its thread appears. A spark (`torc` ×3, 6 px) climbs the thread and arrives at `M.next('eighth')`, with travel time clamped to 0.35–0.9 s. The harp star then flares to 3 and settles to `0.5 + 2.5·level`. | Immediately: `A.pluck(n(deg, oct), {gain:0.28, bright:0.6, decay:3.5, pan})`. On arrival: `A.bell(n(deg, oct+1), {when, gain:0.09, decay:3.2, pan})`. | `offering{stone, weight: level<0.15 before the tap ? 1 : 0.5, source:'tap'}`, energy +0.02 |
| **Hold harp stone** | `stones` (via claim) | The thread thickens ×2.5 and trembles at 5.5 Hz while held. On release: level 1 with a **20 s** decay, plus the spark and star as for a tap. | While held, up to 3 s: sixteenth-note plucks `n(deg,oct)` with gain falling 0.12→0.05, bright 0.4, decay 1.2. On release: the bell answer, as for a tap. | `offering{stone, 2, 'hold'}`, energy +0.05 |
| **Tap portal stone** (id 0, 10) | `stones` | Ogham flickers for 0.6 s. | `A.drum({pitch:73, gain:0.3})` | energy +0.01 |
| **Tap recumbent** (id 5) | `stones` | A faint `torc` line runs along its top edge. | `A.drum({pitch:55, gain:0.35})` | energy +0.01 |
| **Tap fire** | `fire` | The flame surges to level 1.0 and falls back to idle over 2.5 s. 40 sparks rise in a three-armed (triskele) swirl up to 30 m. One spark keeps going to `sky.pickViewDir({minElevDeg:6, maxElevDeg:16})`, arrives after 1.2 s and becomes an `ember` star (colour `torc`, ember-tinted flare). At most 40 ember stars; the oldest is removed. | `A.whoosh({from:300, to:2400, dur:0.9, gain:0.1})` and `A.drum({pitch:62, gain:0.3})`. At star birth: `A.bell(n(elevDeg,2), {gain:0.08})`. | `offering{fire, 1, 'tap'}`, energy +0.03; emits `fire:surge{1.0, false}` |
| **Hold fire** | `fire` (via claim) | Embers orbit the flame in a rotating triskele at r = 1.6 m. On release: a plume of 120 sparks up to 60 m, and 3 ember stars born 150 ms apart. | While held, fire plays a drum roll itself: `A.drum({pitch:66})`, speeding from eighths to thirty-seconds over 3 s, gain 0.18→0.3. On release: bells `n(0,2)`, `n(3,2)`, `n(5,2)`, 150 ms apart, gain 0.08. | `offering{fire, 3, 'hold'}`, energy +0.08; `fire:surge{1.2, true}` |
| **Tap sceach** | `sceach` | A ribbon ties onto the branch tip nearest the hit (dyes cycle `madder` → `woad` → linen). A mote (`boFinne` core with a dye-coloured 0.8 m tail) spirals up 10 m in 1.2 s, then arcs over 1.8 s to `sky.pickViewDir({minElevDeg:6, maxElevDeg:17})` and becomes a `wish` star (`torc`). | Arpeggio of `M.chord()` (fallback `[0,2,4]`) at octave 1: 3 plucks 90 ms apart, gain 0.2, bright 0.7, decay 3. At star birth: `A.bell(n(elevDeg,2), {gain:0.1})`. | `offering{wish, 2, 'tap'}`, energy +0.06; `wish:tied` |
| **Hold sceach** | `sceach` (via claim) | A long ribbon unrolls downward over 1 s, showing a glowing ogham word. Words cycle BEITH ᚁᚓᚔᚈᚆ, DAIR ᚇᚐᚔᚏ, COLL ᚉᚑᚂᚂ, SAIL ᚄᚐᚔᚂ, FEARN ᚃᚓᚐᚏᚅ. On release it flies up like a tap mote. | **The word is played** (§6.3), starting at `M.next('eighth')`. | `offering{wish, 3, 'hold'}`, energy +0.08; `wish:tied{word, ogham}` |
| **`ogham:word`** (typed) | `sceach` | Same as hold sceach, using the typed word. | The word is played (§6.3). | `offering{wish, 3, 'word'}`, energy +0.08 |
| **Tap sky** (`click:sky`) | `sky` | A meteor: its head starts at `camera.position + direction·600` and streaks for 0.9 s toward a random loch point with r < 7 (`boFinne` core ×3, `torc` tail). On landing it emits `meteor:land{inLoch:true}`. It does **not** create a sky star; it falls into the Otherworld. | At the click: `A.bell(n(elevDeg,2), {gain:0.1, pan})` and `A.whoosh({from:2400, to:400, dur:0.9, gain:0.07})`. At landing: `A.pluck(n(0,0), {when, gain:0.18, bright:0.3, decay:4})`. | energy +0.015 |
| **Meteor lands in loch** | `loch` | A ring ripple, plus a new **reflection-only star** at that point (`torc`, persistent, max 64). | none (sky already scheduled it) | — |
| **Tap loch** (`click:ground` with `loch.contains`) | `loch` | A ring ripple (radius 0→4 m over 2.5 s; 8 ripple slots, oldest reused) that distorts the fisheye. A reflection-only star appears at the point. | `A.bell(n(PENTA[i],0), {gain:0.12, decay:6})`, with i = `floor(r/9·5)` | energy +0.015 |
| **Tap ground** (outside loch, `dm ≥ 20`) | `terrain` | A La Tène three-lobed ripple (a ring with three trumpet lobes, rotating sunwise) spreads through the grass, radius 0→6 m over 1.8 s, `torc` ×0.6 fading. | `A.drum({pitch: 64 + 32·clamp((distFromFire-10)/30,0,1), gain:0.3})` | energy +0.01 |
| **Tap mound** (`dm < 20`) | `terrain` | A half-size three-lobed ripple at the tap point (the passage is often hidden by the portal stones, so this is the visible response) and the passage glows `torc` ×1.0 for 1.5 s. | `A.drum({pitch:52, gain:0.35})` and `A.whoosh({from:200, to:600, dur:1.5, gain:0.05})` | energy +0.01 |
| **Hold on empty space**, or hold **Space** | `bealach` | Veil hold (§4.2). | The `conductor` responds to `veil:hold`. On start: `A.whoosh({from:200, to:1600, dur:2.5, gain:0.1, bus:'ambience'})`. On end: `A.whoosh({from:1600, to:300, dur:1.5, gain:0.06, bus:'ambience'})`. | — |
| **Drag** | core | Orbits the camera. | — | — |
| **Sunwise turn** (drag) | `bealach` → `stones` | `bealach` sums the signed camera azimuth change on every frame where `controls.autoRotate === false` and the phase is `idle` (core turns auto-rotate off at drag start and back on only after 6 s idle, so this counts the drag **and its damping inertia** but never auto-rotation). When the sum reaches +2π, it emits `deiseal:turn{1}`, increments `world.bealach.turns.deiseal`, and resets. The sum resets after 15 s with no pointer activity. One full orbit is ≈ 1.8 screen-heights of horizontal drag (OrbitControls `rotateSpeed` 0.45), i.e. 2–4 swipes on a phone. `stones` then strums all 8 harp stones in ascending order on eighths from `M.next('beat')`, with every thread lit. | 8 plucks, gain 0.22 | `stones` emits `offering{stone, 3, 'deiseal'}`; energy +0.10 (`bealach`) |
| **Anti-sunwise turn** | `bealach` → `stones`, `conductor` | All ringing stones mute (level → 0 over 0.5 s). The threads snap off. | `conductor`: cold wind swell, i.e. two detuned `A.whoosh({from:900, to:300, dur:3, gain:0.06, bus:'ambience'})` 40 ms apart. | energy −0.10 |
| **Keys `1`–`8`** | `stones` | Same as tapping harp stone k = digit − 1. | Same; pan from the stone's screen x | same |
| **Key `0`** | `fire` | Same as tapping the fire. | same | same |
| **Letters a–z, Backspace, Enter, Escape** | `hud` | Typing ogham (§9.4). **Enter** emits `ogham:word`. | none (`sceach` plays the word) | — |
| **Hover** (desktop only) | `stones`, `fire`, `sceach` | Pickable rim brightens 15%; core sets the cursor. Nothing depends on hover. | — | — |
| **Attract: the aos sí** (phase `idle`, spiral not complete) | `bealach` → `fire`/`stones`/`sceach` | Starts when `!state.started && state.time > 12` (nobody has touched it yet) **or** `state.idleTime > 20`. Then every 6 s: `aossi:offer{kind, weight:1.5}` for the arm with the least light (ties go fire, then stone, then wish). The target module performs a **ghost** offering: 60% visual intensity, motes and sparks tinted `verdigris`. Ghost stone offerings strike the harp stone nearest the screen centre; ghost wishes tie a linen ribbon. Any pointer or key activity stops the schedule until the idle condition holds again. | Audio gain ×0.5 | weight **1.5**, energy per §4.1 (halved) |
| **Neglected-arm demonstration** (phase `idle`) | `bealach` | If the viewer has made ≥ 3 offerings of their own, one arm still has light 0, and ≥ 40 s have passed since the first interaction: one `aossi:offer` for that arm every 15 s **even while the viewer is active** (it shows where the missing place is). Stops once that arm has light. | as above | weight 1.5 |
| **Beckon** (on `hint:change`) | `fire`, `stones`, `sceach` | While the visible hint's `target` is theirs, on each `music:beat` with `beatInBar === 0` (visual time via `delay`): fire flares to level +0.15 for 0.4 s; the harp stone nearest the screen centre lights its ogham at 0.35; the sceach's ribbons lift for 0.8 s and its linen ribbons brighten ×1.6. Never on reduced motion (use a static +20% glow instead). | none | — |
| **Idle > 30 s**, ≥ 6 notes remembered (once per idle period) | `conductor` | `music:echo`: `loch` ripples at the centre for each note. | The last ≤ 8 notes, an octave lower, at half tempo, as bells gain 0.07. | — |

### 6.3 Ogham as the score

Each letter of a word lasts one eighth note.

- **Stroke count** c (1–5) sets the pitch: degree = `PENTA[c−1]`.
- **Aicme** (the letter's group) sets the voice:

| Aicme | Letters | Voice |
|---|---|---|
| *Beithe* | B L F S N | `pluck`, octave 1 |
| *hÚatha* | H D T C Q | `pluck`, octave 2 |
| *Muine* | M G NG Z R | `bell`, octave 1, gain 0.08 |
| *Ailme* (vowels) | A O U E I | `bell`, octave 2, decay 5, gain 0.06 |

**Letter table** (lowercase → glyph, strokes):

| Aicme | Letters |
|---|---|
| *Beithe* | b ᚁ 1 · l ᚂ 2 · f ᚃ 3 · s ᚄ 4 · n ᚅ 5 |
| *hÚatha* | h ᚆ 1 · d ᚇ 2 · t ᚈ 3 · c ᚉ 4 · q ᚊ 5 |
| *Muine* | m ᚋ 1 · g ᚌ 2 · ng ᚍ 3 · z ᚎ 4 · r ᚏ 5 |
| *Ailme* | a ᚐ 1 · o ᚑ 2 · u ᚒ 3 · e ᚓ 4 · i ᚔ 5 |

- The digraph `ng` maps to ᚍ.
- Letters with no ogham equivalent (j k p v w x y) are dropped.
- The feather marks ᚛ and ᚜ wrap a displayed word.

### 6.4 Spiral progress (owned by `bealach`)

**Arms** (order fixed): arm 0 = stone, arm 1 = wish, arm 2 = fire.

**Light:**
- Each `offering` adds `weight` to its arm's light, capped at `3·perSegment`.
- **Spill:** whatever an offering cannot add because its arm is full, ×0.5, goes to the arm with the least light (ties: fire, stone, wish). A viewer who only ever plays the fire still completes the spiral, just more slowly.
- `perSegment = 2` in cycle 0, 3 in cycle 1, and 4 from cycle 2 on (18 / 27 / 36 light in total).
- Offerings during `hush`…`afterglow` add nothing.
- Pacing check (cycle 0): 6 fire taps + 6 fresh stone taps + 3 sceach taps complete it; a fire-only player needs 6 + 2·12 = 30 taps; the aos sí alone need 12 ghost offerings.

**Segments:**
- Segment j of an arm is filled when that arm's `light ≥ perSegment·(j+1)`.
- On each newly filled segment, `bealach` plays `A.bell(n([0,3,4][arm], 1), {when: M.next('beat'), gain:0.1, decay:5})` and emits `spiral:progress` with `justFilled`.
- It also emits `spiral:progress` (with `justFilled: null`) whenever light changes.

**Complete** means all 9 segments are filled.

---

## 7. Experience arc and signature moment

### 7.1 0–10 s: arrival

| Module | What happens |
|---|---|
| core | The canvas fades in over 2.4 s. |
| `sky` | Stars fade in by magnitude, brightest first, over 8 s (dark adaptation). The Milky Way fades in from 2 to 8 s. |
| `fire` | Starts at embers (level 0.15) and catches to idle over 3–9 s. |
| `loch` | Trails fade in over 3–8 s. |
| `hud` | Title column fades in at 1.2 s. First hint (h0) at 2.5 s; the fire beckons with it. |
| `conductor` | Silent until audio unlocks. On `audio:started`: wind, water and drone fade in over 4 s. The gesture that unlocked audio also plays its own interaction sound (core unlocks audio before dispatching the click). |

### 7.2 10–110 s: gathering; the spiral fills

- The viewer plays freely. Every offering births a star in the sky and a matching reflection in the loch, and fills its spiral arm.
- As energy rises:
  - Beacons light on the hills.
  - The bodhrán enters at E 0.3, the harmony at 0.5, and the full cycle and ornaments at 0.7.
  - Perseids become more frequent.
- The HUD hint sequence (§9.3) points to the fire, then the stones, then the sceach, then the hold; each named object beckons on the downbeat while its hint shows.
- If nobody touches anything, the aos sí begin at 12 s; after any interaction they return after 20 s of idleness.

**Pacing targets (cycle 0, 18 light, arming minimum 45 s):**
- A curious first-time viewer who follows the hints completes the spiral at ≈ 60–110 s; the climax starts on the next downbeat (≤ 1.8 s later).
- A fully passive viewer: 12 + 12 × 6 ≈ 78 s to complete → climax at ≈ 80 s.
- A viewer who plays but ignores one place: the neglected-arm demonstration plus spill keep them under ≈ 150 s.
- Cycle 1 (27 light) passive ≈ 20 + 18 × 6 ≈ 130 s after the fade; cycle 2+ ≈ 165 s. A full passive loop (build + 36 s climax + 90 s afterglow + 20 s fade) is ≈ 4–5 minutes.

### 7.3 Signature moment: *An Bealach* (the White Cow comes down)

**Trigger** (evaluated by `bealach` each frame):

1. Arming condition: `phase === 'idle' && spiral.complete && state.time >= 45`.
   - Once armed, veilTarget is 0.3.
2. `tStart = state.time + delay` of the **next `music:beat` with `beatInBar === 0`** (§4.4 rule 3).
   - If `conductor` is absent, `tStart` = arming time + 1.0 s.
3. Debug overrides:
   - `?climax=1` fills the spiral at t = 2 s and ignores the 45 s minimum.
   - `?phaseT=<s>` starts the climax immediately at `T = s`; add `&freezeT` to pin T there.

**While `0 ≤ T < 42`** (the choreography plus the ending text):
- `uClimaxT = T` (it keeps running to 142 through afterglow and fade, then returns to −1).
- `bealach` sets `ctx.controls.autoRotate = false` every frame.
- Camera tween, starting at T = 0 unless `reducedMotion` is on or a pointer is down:
  - Over 5 s with easeInOutSine, move the camera to azimuth 0°, polar 84°, distance `32·d0/26` (d0 = boot distance, §3.7), i.e. position (0, 5.84, 31.82) on landscape screens.
  - Move it through spherical coordinates around `controls.target`; take the shorter azimuth direction.
  - Any `pointer:down` cancels the tween permanently for this climax.
- From T = 42 the camera is released and core's idle rule resumes auto-rotate.

**Choreography**

Column times are T in seconds. Every module keys its behaviour off `bealach:phase` plus `uClimaxT`/`world.bealach.T`.

| T | Phase | `bealach` | `sky` | `terrain` | `loch` | `stones` | `fire` | `sceach` | `conductor` | `hud` |
|---|---|---|---|---|---|---|---|---|---|---|
| 0–3 | **hush** (*An Tost*) | Emits phase. Camera tween starts. Energy 0.2, veil 0.3. | Twinkle → 0 over 0.5 s; Perseids stop. | — | Trails freeze (`uOtherAngle` speed → 0); spiral pulses once. | All 8 threads flare to 1.0 for 0.3 s, then hold at 0.3. | Level → 0.15 over 1.5 s. | Ribbons lift and go still. | All layers fade out over 0.5 s; one sine D2 (73.42 Hz, gain 0.05) enters; wind ducks to 30%. | Hints and toasts fade out over 0.6 s; title dims to 20%. |
| 3–8 | **pillar** (*An Colún*) | Energy 0.6, veil 0.45. | Band frame slerps from `bandPole`/`bandFoot` to `bandPoleClimax`/(0,0,−1), easeInOutCubic. Band ×1.4. Harp and named stars move with the band (they are band-anchored). | Quartz facade glows `torc` ×0.3. | — | Rolled G/D strum at T = 3.0 and 5.4: harp k = 0, 2, 4, 5, 7, plucks 70 ms apart, gain 0.22. Threads follow the moving harp stars. | Embers. | — | `A.whoosh({from:200, to:1200, dur:5, gain:0.12})` at T = 3. | — |
| 8–16 | **pour** (*An Doirteadh*) | Particle front runs leg A (§10.8): pillar top at T = 8, over the hills at T = 10, mound crown at T = 12, entrance stone at T = 13.5, portal gap at T = 15, loch north edge at T = 16. The river ribbon unrolls behind the front from the mound crown onward. Energy 0.9, veil 0.6. | The band **empties** behind the front, from θ = 40° down to the foot: `drain(θ,T)` = 0.08 for θ ∈ [θd, 40°] with θd = 40°·(1 − smoothstep(8, 13, T)) and 3° soft edges; 0.5 for θ > 40°; 1 below θd. So at T = 12 the visible band (θ ≳ 4°) is already a dark channel with its dust lanes faintly visible; by T = 13 it is empty to the foot. All kindled, harp and named stars **stay visible**. | As the front passes (T 11–13.5): kerb spirals and the entrance-stone triple spiral ignite `torc` ×2.5; quartz facade `boFinne` ×1.2. | Water ×0.7 (anticipation). | At T = 15 the portal stones' inner faces take `boFinne` light from the river. | Embers. | — | Falling harp glissando from T = 8 to 14: 20 plucks descending through PENTA from `n(0,3)` to `n(0,-1)`, 0.3 s apart, gain 0.16, bright 0.7, pan −0.4→0.4. | — |
| 16–26 | **river** (*An Abhainn*) | Front runs leg B: three **sunwise** turns around the islet, r 6.0→2.2, ending at T = 25. Particles flow continuously along legs A and B. Energy 1.0, veil 0.8. | Stays emptied. | — | The loch brightens where the milk runs. Spiral arms and connectors fill **white-gold** from outer end to centre: white fraction of each arm = `smoothstep(16, 25, T)` along arm param s. Trails un-freeze and start shrinking. | Gold ring-wave, sunwise from id 0 at T = 17: each stone in turn gets full ogham glow and `A.drum({pitch:70, gain:0.25})`, one 9/8 eighth apart (0.303 s). Then all threads hold at 0.6. | From T = 24, level 0.15 → 1.0. | Ribbons glow faint `boFinne`. | Meter switches to 9/8 at T = 16. Slip-jig drum: drum on eighths 1, 4, 7 (gain 0.3); ghosts on 3, 6, 9 (gain 0.1). From T = 16.3, bells replay the last 16 remembered notes on eighths, harmonised in thirds (`n(d,o+1)` and `n(d+2,o+1)`, gain 0.07 each). Pad any shortfall with the motif `[0,1,3,4,5,4,3,1]`, octave 1. | — |
| 26–32 | **return** (*An Filleadh*) | Column rises from the fire to y = 80 over T 26–28 (r 0.6→1.4, `boFinne` core ×4, `torc` rim). Particles leave the loch spiral and climb the column (leg C, T 26–30). The column fades over T 30–34. Energy 1.0, veil 1.0. | The band frame slerps back to its normal pose over T 26–31. The band **refills from the foot upward**: θ < θr is restored, θr = 90°·smoothstep(27, 32, T), with `uBandGain` 0.26 (×1.3). All wish and ember stars flare to 3 at T = 31, then return. | Passage glows `torc` ×1.5. | Trails collapse to points (length → 0) by T = 32. Stars fully `torc`. Veil mist rises from T = 30. | All threads flare to 1.0 at T = 30, then fade over 6 s. | Level 1.5 (white-gold) at T = 26.5; settles to 0.7 by T = 34. | At T = 28 **blossom and red haws appear together** over 3 s: 400/150 `boFinne` five-petal points and 120/60 `madder` haws. They stay until fade. | Rising bell run from `n(0,1)` to `n(0,3)` over T 26–30 (10 notes, 0.4 s apart, gain 0.09). At T = 32: plucks `n(0,0)`, `n(4,0)`, `n(0,1)` (gain 0.25) and `A.bell(n(5,2), {gain:0.06, decay:8})`. Meter back to 6/8. | — |
| 32–122 | **afterglow** (*Tír na nÓg*) | `uAfterglow` 0→1 over 4 s. Energy starts at 0.55 and decays. Veil 1.0. Camera held still until T = 42, then released. Offerings (tap/hold) work normally but add no spiral light. | Band ×1.3. Wish-constellation arcs visible. | Passage stays open. | Mist up; reflection-only stars at full. | Normal play. | Normal. | Blossom and haws stay. | Slow harp air: one pluck from a random walk on PENTA, octave 1, every 1–2 bars, gain 0.12. Every `note:played` is echoed a fifth lower (degree − 4) one eighth later at ×0.5 gain. | T = 33–42: ending text. T = 44: toast *Tír na nÓg*. T = 54: epilogue, shown for 9 s. |
| 122–142 | **fade** | Veil 0.25 → 0; `uAfterglow` 1 → 0. Spiral light resets to 0 at T = 142, `cycle++`, `perSegment` updated, `spiral:progress` emitted, phase → `idle`, `uClimaxT` → −1, `state.idleTime`-based aos sí rules resume. | Arcs fade. | — | Spiral arms empty over 4 s. | — | — | Blossom and haws fall and fade. | Back to energy layers. | Title returns to 35%. |

**Reduced motion:**
- No camera tween.
- `sky` swaps the band frame while the band is faded out (fade out T 3–4.5, swap, fade in 6.5–8) instead of rotating it.
- `bealach` draws no moving particles. The river ribbon's opacity front travels the same path, and the column is a slow fade.
- Twinkle stays off throughout.

---

## 8. Audio design

**Owner of every long-lived graph: `conductor`.** Other modules only fire the built-in one-shot voices.

### 8.1 Buses and levels

On `audio.onStart`, `conductor` sets the bus gains:

| Bus | Gain | Carries |
|---|---|---|
| `ambience` | 0.7 | Drone, wind, water, crackle, veil whooshes |
| `music` | 0.8 | Heartbeat, pad, ornaments, climax score, echoes |
| `sfx` | 1.0 | Every interaction voice |

Master and limiter are core (master 0.8, limiter −14 dB).

**Voice gain ceilings:**

| Voice | Ceiling |
|---|---|
| pluck | 0.30 |
| bell | 0.14 |
| drum | 0.40 |
| whoosh | 0.15 |
| drone oscillator | 0.035 each |
| pad oscillator | 0.02 each |

- The ambience bed alone should sit about 24 dB below a single tap pluck.
- Climax peaks must not audibly pump the core limiter. If they do, lower the conductor's climax voices, never the interaction voices.

### 8.2 Clock and harmony

- **Tempo:** dotted quarter = 66. So an eighth = 0.30303 s, a 6/8 bar = 1.818 s, and a 9/8 bar = 2.727 s. The meter is 6/8 except during `river` (9/8).
- **Clock:** `M.now()` returns `A.now()` once audio is ready and `state.time` before that, so beats (and their visual pulses) run even with sound off. See §4.4 for the rules on mixing clocks.
  - The scheduler runs in `update()` with a 0.12 s lookahead.
  - It emits `music:beat` for each dotted-quarter beat (`beatInBar` 0 and 3 in 6/8; 0, 3, 6 in 9/8) when it is scheduled, with `delay = when − now`.
- **`M.next(division)`** returns the next grid time strictly more than 20 ms ahead. Divisions: sixteenth = eighth/2, eighth, beat = 3 eighths, bar.
- **Key:** D Dorian (core `audio.note`). Interaction melodies use only `PENTA = [0,1,3,4,5]`, so any combination of viewer notes is consonant over the drone.
- **Chords** (scale degrees):

  | Chord | Degrees |
  |---|---|
  | Dm | `[0,2,4]` |
  | C | `[-1,1,3]` (C3 is degree −1) |
  | G/D | `[0,3,5]` |

  `M.chord()` returns the current chord. It is Dm while the pad is off.

### 8.3 Layers

| Layer | Condition | Construction |
|---|---|---|
| Drone | Always, after audio starts | D2 (73.42 Hz) and A2 (110 Hz). Each is 2 sawtooth oscillators detuned ±4 cents, through a lowpass (350 → 1400 Hz with V, Q 0.7), with a 0.07 Hz amplitude LFO (depth 20%). In `hush`, replaced by a single sine D2 at gain 0.05. |
| Wind | Always | Looped noise → bandpass (Q 0.6, centre LFO 0.05 Hz over 300–900 Hz) → gain 0.03. |
| Water | Always | Noise → lowpass 700 Hz. "Laps" every 1.5–4 s at random (attack 0.3 s, decay 0.8 s, gain 0.02). |
| Crackle | Always | Noise bursts of 5–20 ms, highpass 1500 Hz, gain 0.02–0.05, at `2 + 8·uFireLevel` per second. `fire:surge` adds 12 bursts over 0.5 s. |
| Heartbeat (bodhrán) | E ≥ 0.3 | `A.drum({pitch:62, gain:0.28})` on eighth 0 and `A.drum({pitch:70, gain:0.14})` on eighth 3 of every bar. From E ≥ 0.5, add a ghost `gain:0.08` on eighth 5. |
| Pad | E ≥ 0.5 | 3 triangle oscillators per chord tone at octave 0, lowpass 900 Hz, 0.6 s crossfade at bar lines. E 0.5–0.7: Dm (2 bars), C (2 bars). E ≥ 0.7: Dm, C, G/D, Dm (2 bars each). |
| Ornaments | E ≥ 0.7 | Every 2 bars, a 3-note PENTA turn at octave 1 (plucks, gain 0.1). |
| Echo | V > 0.5, or afterglow | Each `note:played` with a degree is repeated at `degree − 4`, one eighth later, gain ×0.5. |
| Idle echo | §6.2 | `music:echo`. |
| Climax score | §7.3 | As listed in the choreography table. |

### 8.4 Rules that keep it musical

- `M.allow(key)`:
  - Returns `false` when the same `key` started a voice less than 60 ms ago.
  - Also returns `false` when more than 12 (high) or 8 (low) voice-starts have happened in the last second.
  - Only calls to `allow()` are counted. The conductor's own layers (drone, pad, heartbeat, ornaments, echoes, climax score) never call `allow()` and never consume the budget, so a busy climax cannot silence the viewer's taps.
  - `allow()` is synchronous and cheap; call it once per voice, immediately before the voice.
- Answers from the sky (bells when a spark or mote arrives) land on the eighth grid. Direct responses are immediate.
- No module synthesises pitches outside `A.note()`, except drum `pitch` (timbre) and whoosh sweeps.
- With sound off (`audio.enabled === false`) the built-in voices are no-ops. `conductor` also ramps its oscillator gains to 0 on `audio:toggled{on:false}` and stops its scheduler, but keeps emitting visual beats.

---

## 9. HUD

**Owner: `hud`**, the only module that touches the DOM under `ctx.hud`.

### 9.1 Typography (Google Fonts)

In setup, `hud` injects `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` and two stylesheets:

1. `https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@500&family=Zen+Kaku+Gothic+New:wght@300;400&display=swap&text=<URL-encoded concatenation of every Japanese string in §9.3 plus 「」〈〉、。・—…>`
2. `https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@500&family=Noto+Sans+Ogham&display=swap`

- With `?nofonts` the links are not injected (the fallback stacks render). Use it for headless runs on an offline machine, where `shot.mjs` would otherwise report the failed font requests as errors.
- WebGL textures never depend on these fonts: ogham on stones and ribbons is drawn procedurally (§10.6, §10.7).

| Role | Family stack |
|---|---|
| Japanese title and ending | `"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", serif` |
| Japanese hints, toasts, epilogue | `"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif`, weight 300 |
| Irish words | `"Cormorant Unicase", "Cormorant Garamond", Georgia, serif`, weight 500, letter-spacing 0.06em, **always smaller than the Japanese next to it** |
| Ogham | `"Noto Sans Ogham", "Segoe UI Historic", sans-serif` |

**Colour:**
- Text is `boFinne` at 72% opacity. Secondary text is 45%.
- Irish words in hints and toasts are `torc` at 85%.
- Legibility shadow: `text-shadow: 0 0 14px rgba(8,13,12,.85)`.
- **No panels, boxes, blur or borders.**

### 9.2 Layout

All `#hud` children have `pointer-events:none` except the sound button.

Two layouts only. **Wide** = `(min-width: 720px) and (min-height: 500px)`. **Compact** = everything else (portrait phones, landscape phones, small windows).

| Element | Wide | Compact |
|---|---|---|
| `.title`: 白き牛の道, vertical `writing-mode: vertical-rl` (a tanzaku), with ルーナサの星祭 in a second, smaller column to its left | Top 28 px; right `max(20px, env(safe-area-inset-right) + 16px)`; 30 px, letter-spacing 0.4em; subtitle 14 px | 22 px / 12 px, top 18 px, right 16 px |
| `.irish`: *Bealach na Bó Finne* / *Oíche Lúnasa*, with a 72×14 inline-SVG La Tène trumpet-curve ornament above (1 px `torc` stroke, 60% opacity) | Bottom-left, 24 px insets (plus safe area); 16 px / 12 px | 13 px / 11 px, left 16 px, bottom 16 px |
| `.hint`: Japanese · Irish | Bottom-centre, `bottom: calc(28px + env(safe-area-inset-bottom))`, max-width `min(560px, calc(100vw - 32px))`, centred; 15 px / 14 px | Bottom 64 px (clears `.irish`), 13 px / 12 px, max 2 lines |
| `.toast` (`aria-live="polite"`) | Top 16vh, centred, max-width `min(640px, calc(100vw - 200px))`; 15 px | Top 13vh, centred, max-width `calc(100vw - 144px)` (clears the 44 px sound button and the title column on both sides), 13 px, max 2 lines |
| `.stemline`: ogham word on a vertical 1 px stem, reading bottom→top (`writing-mode: vertical-lr; transform: rotate(180deg)`), with 8 small notches to its right showing the ringing level of harp stones k = 0..7 (opacity = level) | Left 28 px, bottom 110 px, height 34vh; glyphs 22 px | Left 16 px, bottom 120 px, height 22vh; 18 px |
| `.sound`: button, `aria-pressed`, `aria-label="音のオン／オフ"`; label 音 over *ceol*, plus three short vertical strokes that pulse on `music:beat` when on (one static stroke when off) | Top-left 16 px, 44×44 px | Same |
| `.ending`: centred block | Top 30vh; Japanese 28 px, Irish 16 px below | 22 px / 14 px |

- At 400×800, 844×390 and 1280×800 nothing may overlap (checked by bounding rects, §10.9). The title column and the sound button sit in opposite top corners.
- `ctx.hud` must never create horizontal scroll.

### 9.3 Exact copy

Only these strings may appear. The Irish is deliberately limited to common, well-attested words and one short sentence. Do not add or inflect Irish words. Before release, have a native speaker proofread every Irish string, the ogham and the epilogue.

| ID | Japanese | Irish | Beckon target | When eligible |
|---|---|---|---|---|
| title | 白き牛の道 | *Bealach na Bó Finne* | — | Fades in at 1.2 s (1.6 s). Dims to 35% 8 s after the first interaction. |
| subtitle | ルーナサの星祭 | *Oíche Lúnasa* | — | With the title |
| h0 | 触れると、音が鳴ります | *ceol* | `fire` | From 2.5 s while `!state.started` |
| h1 | 火に触れると、火の粉が星になる | *tine* | `fire` | ≥ 4 s after the first interaction, until the viewer's first `offering{fire}` |
| h2 | 石を鳴らすと、糸が星へのびる | *cláirseach* | `stone` | After the viewer's first fire offering, until their first `offering{stone}` |
| h3 | サンザシに、願いの布を結ぶ | *ribín* | `wish` | After the viewer's first stone offering, until their first `offering{wish}` |
| h4 | 夜空を長く押すと、帳がひらく | — | `veil` | After the viewer's first wish, until the first `veil:hold{active:true}` (gives up after being shown twice) |
| h5 | 湖の渦が満ちるまで、捧げものを | — | `loch` | Once, for 8 s, when every arm has ≥ 1 segment |
| t-star | 星がひとつ生まれた | *réalta* | | First non-harp `star:born` |
| t-loch | 湖は、常若の国の空を映す | *loch* | | First loch tap or meteor landing |
| t-aossi | 塚の民も、祭りに来ている | *aos sí* | | First `offering` with `byAosSi` (in folklore offerings are left *for* the aos sí, so the copy says they have come to the festival, not that they made offerings) |
| t-deiseal | 日の巡りのとおりに | *deiseal* | | Every `deiseal:turn{1}` |
| t-tuathal | 逆回りは、古くから不吉とされる | *tuathal* | | Every `deiseal:turn{-1}` |
| t-word | 文字を、空へ | (the ogham word itself, e.g. ᚛ᚁᚓᚔᚈᚆ᚜) | | On `ogham:word` |
| t-tir | 常若の国 | *Tír na nÓg* | | Afterglow, T = 44 |
| ending | 道はひらかれた | *Tá an bealach oscailte* | | T = 33 (1.5 s fade in, hold 6 s, 1.5 s fade out) |
| epilogue | アイルランドでは、天の川を〈白い牛の道〉とも呼ぶ。今夜は織姫と彦星も、その両岸に。 | — | | T = 54, for 9 s (Zen Kaku, 14 px) |

**Formatting:** hints and toasts render as `Japanese　·　Irish`, with the Irish in the Irish style.

**Timing rules:**
- **One hint slot.** Each frame the eligible hint with the lowest id owns the slot. Only viewer actions (`byAosSi === false`) satisfy a hint.
- A hint shows for at most 12 s, then the slot stays empty for 20 s before the same hint may return.
- Every change of the slot (including to empty) emits `hint:change{id, target}`.
- Hints pulse to 100% opacity on `music:beat` when `beatInBar === 0`.
- Toasts show for 3.2 s and queue with a minimum of 3.5 s between them.
- Hints and toasts are hidden from `hush` to `afterglow` T = 42, and hints are permanently off after the first climax.

**Sound button:**
- It calls `ctx.audio.toggle()`. It sits outside the canvas, so pointer clicks never reach core input.
- After a pointer click it calls `blur()`, so a later Space press goes to the veil, not the button.
- It handles its own `keydown` for `Space` and `Enter` (when focused via Tab): `preventDefault()`, `stopPropagation()` (so core emits no `key` event and the veil does not open), ignore `e.repeat`, then toggle.

**Key auto-repeat:** `hud` and `bealach` ignore `key` events with `repeat === true` (core request CR-3; if the field is absent, accept the event).

### 9.4 Ogham typing (secret)

`hud` listens to `ctx.events.on('key')`:

| Key | Effect |
|---|---|
| Single letters a–z | Appended to a buffer (max 12 letters, `ng` digraph per §6.3). The buffer's ogham shows immediately on the stemline wrapped in ᚛ ᚜, with no toast. |
| `Backspace` | Removes the last letter. |
| `Escape` | Clears the buffer. |
| `Enter` with a non-empty buffer | Emits `ogham:word{word, ogham}`, shows `t-word`, clears the buffer after 2 s. |

- All other keys (digits, Space, IME "Process") are ignored by `hud`.
- On `wish:tied` with an ogham word, the stemline shows that word for 6 s.

### 9.5 Reduced motion

- Only opacity transitions of 0.6 s. No transforms or letter-spacing animation.
- Beat pulses are disabled.

---

## 10. Modules

### 10.0 Rules for every module

- **Load order** (the lead writes this into `src/modules/index.js`):
  `conductor, sky, terrain, loch, fire, stones, sceach, bealach, hud`
- **Files:** `src/modules/<name>.js`, plus optional private helpers under `src/modules/<name>/`.
  - Palette comes from `ctx.palette`.
  - Layout comes from the verbatim `LAYOUT v1` block (§3.2).
  - Lighting comes from the verbatim `FIRELIGHT v1` block (§3.6).
- **Feature-detect everything from other modules.**
  - `?only=<you>` must run with **zero console errors and zero warnings**.
  - So must the full set, and so must `?q=low`.
- **Performance hygiene:**
  - No allocation in `update()`: reuse vectors and arrays.
  - No `THREE.Clock`, no three.js lights, no shadow maps, no external assets.
  - Textures are canvas- or data-generated once, at setup.
- **Resources:** every `ShaderMaterial` that uses shared uniforms plugs in the **same objects** from `ctx.uniforms`, never copies. Every module implements `dispose()` (geometries, materials, textures, listeners, `addPickable` removers).
- **Proxies:** pickables use **invisible proxies** (`material.visible = false` — keep `object.visible = true`, core skips invisible roots; raycasting still works). Hit shapes are ≥ 1.6× the visual size, for touch, **except where a proxy would cover a neighbouring pickable at the default camera** (the sceach crown, §10.7); coarse-pointer widths per §6.1. Core picks the nearest proxy hit along the ray, so what matters is screen-space overlap from the default camera — checked by §10.7 acceptance 6.
- **Sky-aimed geometry** follows the camera-centred rule (§3.5).
- **Commands:** screenshot commands below are run from the project root. Default size is 1280×800. `&noauto` keeps the default camera. Positions are in px with ±40 px tolerance. Add `&nofonts` on an offline machine. Pixel values use the helper in §2.3 (needs `&shot`).
- **Headless timing:** `shot.mjs` renders with SwiftShader, typically far below 60 fps, and core clamps `dt` to 1/20 s, so `wait:N` advances `state.time` by *less* than N ms. Acceptance checks therefore use `?warm=` (deterministic 30 Hz steps before the first frame), `?phaseT=…&freezeT`, debug counters, or generous thresholds — never "wait 36 s and expect 36 s of behaviour".
- **Frame budget** (high quality, whole piece): ≤ 32 draw calls, ≤ 160k triangles, ≤ 30k points, no extra render targets. Low quality: ≤ 28 draw calls, ≤ 40k triangles, ≤ 12k points. Fill-rate rules in §11.1 matter more than these counts.

---

### 10.1 `conductor` (src/modules/conductor.js, load order 1)

**Owns:**
- The music clock and `world.music`.
- Every continuous audio graph: drone, wind, water, crackle, heartbeat, pad, ornaments.
- Note memory and echoes.
- The climax score (the conductor rows of §7.3).

**Builds:** no scene objects. Before audio starts it runs on a virtual clock; on `audio.onStart` it builds the graph (§8).

**Techniques:**
- Lookahead scheduler inside `update` (0.12 s). Clock rules per §4.4; before unlock the bar grid starts at `state.time = 0`.
- Node pooling: create long-lived oscillators once. One-shots use the core voices.
- Gain ramps with `setTargetAtTime`.
- Ring buffer of the last 32 remembered notes (filter per §5.1 `note:played`).
- `chord()` is a pure function of the current bar index and the energy layer, so it also works on the virtual clock (needed by acceptance 4 and by sceach before unlock).

**Events:**

| Direction | Events |
|---|---|
| Emits | `music:beat`, `music:echo` |
| Consumes | `note:played`, `fire:surge`, `veil:hold`, `deiseal:turn`, `bealach:phase`, `audio:started`, `audio:toggled` |

**World fields:**
- Writes `world.music`.
- Reads `ctx.uniforms.uFireLevel` (created with `??=`), plus `state.energy` and `state.veil`.

**Budget:** 0 draws. At most 40 live audio nodes at idle, 60 during the climax. Scheduler CPU < 0.3 ms per frame. Low quality: no pad (drone only) and no ornaments.

**Acceptance:**
1. `node scripts/shot.mjs --url "index.html?only=conductor" --actions "wait:500;click:640,400;wait:6000;eval:window.__festival.audio.ready;eval:typeof window.__festival.world.music.next('bar')"` → `true`, `"number"`, no errors or warnings.
2. Without any click, `--actions "wait:1000;eval:[__festival.world.music.now(),__festival.state.time];wait:3000;eval:[__festival.world.music.now(),__festival.state.time]"`: in both pairs the two numbers agree within 0.05, and the second pair is larger (the virtual clock is `state.time` before unlock).
3. `eval:[__festival.world.music.allow('x'),__festival.world.music.allow('x')]` → `[true,false]`.
4. Chord cycle on the virtual clock (no click needed), three runs: `?only=conductor&energy=0.8&warm=1` → `eval:__festival.world.music.chord()` = `[0,2,4]`; `&warm=5` → `[-1,1,3]`; `&warm=9` → `[0,3,5]`.
5. `--actions "wait:500;click:640,400;wait:2500;eval:__festival.world.music.now()-__festival.audio.now()"` → `0` (after unlock the music clock is audio time), and the logs contain no errors.

---

### 10.2 `sky` (src/modules/sky.js, load order 2) — sky and atmosphere owner

**Owns:**
- Sky dome, airglow, Milky Way, background stars, harp and named stars, kindled stars, meteors (ambient Perseids and click meteors), wish-constellation arcs.
- **Sole runtime writer of** `scene.fog.color`/`density`, `scene.background`, `ctx.bloom.strength`/`radius`/`threshold`, and `ctx.grade` uniforms.
- Writer of `uOtherAngle`.

**Builds:**

| Object | Construction |
|---|---|
| Dome | `SphereGeometry(1500, 64, 32)`, BackSide, `depthWrite:false`, `depthTest:false`, `renderOrder:-1000`, `fog:false`, `frustumCulled:false`, `position` copied from the camera every frame (camera-centred, §3.5). The shader computes the view direction and sums: peat base; airglow band (0–12°, `airglow`×0.8 at the horizon falling to 0, faint wave striations, → `verdigris` by 0.8·V); Milky Way **via the same `otherSky`/band functions it publishes in `world.sky.glsl`** (one implementation, so the loch can never diverge); horizon fog-colour match below 0°; dither. |
| **Band texture** (canvas, generated once, ≤ 120 ms) | 2048×192 (low: 1024×96). **R** = milk detail (fbm, periodic in u). **G** = dust absorption (ridged fbm, concentrated on the centre line v 0.35–0.65, with one long Great-Rift-like split near θ 0–40°). Published as `world.sky.bandTexture` (`LinearFilter`, `RepeatWrapping` in u, `ClampToEdge` in v, no mipmaps). |
| Band shading | Mapping per §3.5: `u = θ/2π`, `v = (β + 15°)/30°`. **Lane sharpening:** the texture is magnified ≈ 2–4× on screen, so the shader does not use G directly: `lane = smoothstep(0.42, 0.58, G + 0.16·(vnoise(vec2(θ_deg·2.5, β_deg·2.5)) − 0.5))` (one octave of value noise). Brightness `boFinne · uBandGain · drain(θ, uClimaxT) · profile(β, θ) · (0.55 + 0.45·R) · (1 − 0.9·lane)`. `uBandGain`: 0.2 at rest, 0.28 in pillar, 0.26 in return/afterglow. `drain()` implements the emptying/refill of §7.3 and is 1 outside the climax. Width profile per §3.5. The **max linear value is 0.6** (bloom threshold 0.85), so the lanes stay sharp. |
| Background stars | One `Points` object: 7000 (low 2800), camera-centred (object follows the camera). 55% Gaussian around the band (σβ = 6°), the rest uniform above −5° elevation. Magnitude follows a power law, so ~2% are bright. Colour is a temperature mix between `boFinne` and `torc`·0.6+`boFinne`·0.4 — **never bluish**. Size `clamp(k·mag, 1.6, 4.0)·dpr` px; stars below 1.6 px are **dimmed, not shrunk**. Twinkle amplitude per §4.3, stronger near the horizon. Additive, `fog:false`, `depthTest:true` (the hills and mound hide stars), `depthWrite:false`. |
| Sky rotation | Uniform `uSkyRot` (mat3) is identity except in the climax. It rotates the band, background stars, harp stars and named stars (anchor `'sky'`) as one rigid body from frame (H0,T0,N0) to (H1,T1,N1) = ((0,0,−1),(0,1,0),(−1,0,0)) by quaternion slerp; it is a pure function of `uClimaxT`. **Kindled stars (anchor `'air'`) never rotate.** `world.sky.frame` is updated live. |
| Kindled stars | Pool of 256 in one `Points` object (camera-centred). Per star: dir, colour, level, birth time, anchor. Birth flare: size ×4 → 1 and intensity 3 → level over 1.2 s. `harp` stars: level 0.5 idle. `ember` (max 40) and `wish` (max 96; oldest removed, its arc goes with it): level 1.2, `torc`. Vega and Altair: 1.8× the brightest catalog star, `boFinne`. |
| Meteors | Instanced stretched quads, max 12. Head `boFinne`×3, `torc` tail. Ambient Perseids stream away from the radiant and last 0.4–0.8 s, never landing. Click meteors follow §6.2. |
| Wish arcs | One `LineSegments` object, max 48 arcs × 24 segments. It links consecutive `wish` stars with compass-drawn circular arcs whose bulge alternates side (±18% of chord length). `torc`, alpha `0.35·max(V, uAfterglow)`. |

**API (`world.sky`):**

| Member | Behaviour |
|---|---|
| `addStar(dir, {kind, color, mag, anchor, byAosSi})` | Returns an id and emits `star:born` (computing `onScreen` from the current camera). |
| `setStarLevel`, `removeStar`, `starDir(id, out)` | `starDir` returns the live direction (sky rotation applied for anchor `'sky'`). |
| `dirOnBand(θ, β, out)` | Uses the live frame. |
| `pickViewDir({minElevDeg, maxElevDeg})` | Azimuth within ±0.8 of the camera's horizontal half-FOV around camera forward. Elevation in `[min, min(max, topOfFrameElev − 2°)]`; if that range is empty (camera looking steeply down), use `min` — the star is then born off-screen and `loch` compensates (§5.1 `star:born.onScreen`). Rejects directions within 2.5° of an existing kindled star (12 tries). |
| `catalog` | For `loch`. |
| `glslDecl` | GLSL string declaring **only** `uBandTex, uBandH, uBandT, uBandN, uBandGain` (sky-owned). |
| `glsl` | GLSL functions only (no declarations): `vec3 otherSky(vec3 dir)` (airglow + band with drain + no stars) and its helpers. Requires the includer to also declare `uVeil` and `uClimaxT` from the SHARED-UNIFORMS block (§3.6). Must compile in both vertex and fragment stages. |
| `uniforms` | The uniform objects `glslDecl` declares (plug in the same objects). |
| `harpStarIds` | 8 harp stars registered at setup (§3.5), anchor `'sky'`. |

**`uOtherAngle` speed factor** (× 7.29e-3 rad/s, i.e. 100× sidereal), ramped over 1 s:

| Phase | Factor |
|---|---|
| idle | 1 |
| hush, pillar, pour | 0 |
| river | 1 |
| return, afterglow | 0 |
| fade | back to 1 |

**Atmosphere automation, each frame:**
- `bloom.strength = 0.75 + 0.2·E + 0.25·w(T)`, where `w` is 1 during pour, river and return (ramped over 1 s).
- `bloom.threshold = 0.85`; `radius = 0.5`.
- `fog.color = mix(#0e1511, #0f1a17, V)` (linear, via `Color.lerpColors` of two `new Color(hex)`); density 0.0022.
- `grade.uTint`: **raw sRGB bytes** (`setRGB(r/255, g/255, b/255)`, §2.3) of `mix(#0a1310, #0b1a15, max(V, uAfterglow))`; `uLift = 0.6 + 0.3·uAfterglow`; `uGrain = 0.03`; `uVignette = 0.4`.

**Events:**

| Direction | Events |
|---|---|
| Emits | `star:born`, `meteor:land`, `note:played` |
| Consumes | `click:sky`, `bealach:phase` |

**World fields:**
- Writes `world.sky`, `uOtherAngle`.
- Reads `world.loch` (meteor targets, lazily), `uClimaxT`, `uAfterglow` (both `??=`).

**Budget:**
- 5 draws (dome, stars, kindled stars, meteors, arcs).
- High: 7000 + 256 points, 12 quads, ≤ 2304 line vertices, dome 4k triangles. Dome fragment: 1 texture fetch + 1 value-noise octave + airglow; no loops.
- Low: 2800 stars, band texture 1024×96, no twinkle on stars dimmer than the median.

**Acceptance** (pixel values via §2.3 helper; add `&shot`):
1. `--url "index.html?only=sky&warm=10&noauto&shot"` shows:
   - The horizon at y = 264, with a green airglow band fading upward: 5×5 mean at (300, 256) has G in 30–60 and R < G, B < G.
   - The Milky Way foot at (701, 264), rising right through (738, 195) and (777, 123), leaving the top edge near x ≈ 840. Band core 5×5 mean at (757, 160) has luma 55–120.
   - **At least one sharp dark lane:** along the row y = 160, x 700–820, the minimum 3×3 luma is ≤ 0.6× the maximum, and the transition from 20% to 80% of that contrast happens within ≤ 8 px somewhere on the row.
   - Vega at (693, 38) and Altair at (892, 146), clearly the brightest stars. Harp stars at the §3.5 positions (dimmer).
   - Sky 5×5 means on a 64 px grid above y = 250 (skipping pixels within 6 px of a star): luma ≤ 20 except inside the band, and **B ≤ G + 6** everywhere (no blue or purple cast).
2. `?only=sky&warm=10&noauto&veil=1&shot`: at (300, 256), `G − R` is ≥ 8 larger than in acceptance 1.
3. `--actions "wait:1500;click:900,150;wait:350;shot"` shows a meteor streak heading down-left toward the frame centre.
4. `--actions "wait:1000;eval:__festival.world.sky.addStar(new __festival.THREE.Vector3(0.2,0.2,-1).normalize(),{kind:'wish',color:0xD9A547,mag:1,anchor:'air'});wait:150;shot"` logs a number, and the shot shows a gold flare near (1027, 70).
5. `?q=low`: `eval:__festival.world.sky.catalog.count` → `2800`.
6. `?only=sky,bealach&phaseT=12&freezeT&noauto&warm=1&shot` (camera snapped to the climax pose): the band stands vertical at x = 640 above the horizon (y = 310); its 5×5 luma at (705, 185) is ≤ 25 — the drained channel, sampled clear of the stream — while the harp stars and Vega/Altair remain visible. Measured 24.1 at ship.
   **Measure the drain at T = 12, not T = 16–20.** `bealach` must stay loaded (it owns `uClimaxT`, so `?only=sky` never enters a climax at all), but from T ≈ 16 its river ribbon and particles — and the bloom halo around them, which §11.1 licenses — legitimately fill the channel: the same pixel reads 37 at T = 20 no matter how completely the band drains. (Corrected twice by the lead: the original (640, 250) sat on the stream axis, and (705, 185) at T = 20 sits in its bloom.) while the harp stars at (672, 210)…(606, 73) and Vega/Altair at (529, 121)/(751, 121) remain visible.

---

### 10.3 `terrain` (src/modules/terrain.js, load order 3) — ground owner

**Owns:** `heightAt`, the ground mesh, sí mound (kerb, quartz facade, entrance stone and passage), hill ring, grass tufts, ground and mound click responses, ground ripples.

**Builds:**

| Object | Construction |
|---|---|
| **Ground** | Polar grid from r = 8.2 to 320 (`LAYOUT.ground`): rings `r_i = 8.2·(320/8.2)^(i/N)`, N = 96 rings × 192 segments (low 48 × 96). Heights from §3.3, normals from finite differences, both on the CPU at setup. `ShaderMaterial` with `fog:true`. Albedo: trampled festival ground `lichen·0.55` inside r 14, blending to meadow `mix(airglow·0.9, lichen·0.45, noise)` by r 18; darkened ×0.5 within 0.4 m of the waterline (wet). Lighting `fireLight` + `skyAmbient`. Pushed to `world.groundMeshes`. **Ripples are drawn in this shader** (6 ripple uniforms `vec4(x, z, startTime, strength)`: a ring with three trumpet lobes, La Tène, rotating sunwise, `torc`×0.6 fading) — no decal meshes, so they hug the bank without z-fighting. |
| **Mound** | Part of the ground heightfield. The ground shader adds the quartz facade (front arc ±50° around +Z, 1.5–4 m above base, i.e. the band d ≈ 16–17.7 on the slope; `boFinne` albedo 0.18 with a hashed sparkle glint). **Mound set** = one `InstancedMesh` of boxes with a per-instance `aType`: 40 kerbstones (1.2×0.9×0.5 m) on d = 19.4; the entrance stone (2.4×1.2×0.5 m) at (0, 0.6, −30.2), whose front face carries a **triple spiral from a canvas texture** (256², procedural stroke mask); the passage recess (1×1.6×0.1 m, near-black) at (0, 1.1, −30.6). Emission: kerb and entrance spirals `torc × 2.5·spiralGlow`; facade `boFinne × 1.2·facadeGlow`; passage `torc × (1.5·V + clickFlash)`. `spiralGlow`/`facadeGlow` are pure functions of `uClimaxT`: ignite over T 11–13.5, held through T 122, fade out over T 122–126, 0 when T < 0. |
| **Hills** | Ring mesh, r 300–700, 256 × 6 segments (low 128 × 4); the inner ring of vertices sits 2 m below the local ground so the r = 320 ground edge tucks under it. Ridge at r = 420, height `420·tan(ridgeDeg(φ))`, where `ridgeDeg` is fbm between 1.5° and 3.5°, eased down to 1.0° within ±20° of north. Fogged, `airglow`×0.5 rim on the top 3%. Not pushed to `groundMeshes` (a click on the hills is a sky click). |
| **Grass** (high only) | 6000 instanced 5-vertex blades (0.25–0.5 m) at r 10–45. Excluded from the loch, within 1 m of the stones, the tobar (`LAYOUT.tobar.pos`, 0.9 m), the tree base (1.0 m) and the mound footprint (`dm < 21`). Vertex wind (E) and ripple flicks (same ripple uniforms). Tips `verdigris·0.6·V`. |

**API:** `world.terrain = { mound:{center, radius:20, crownY:10.0, passage}, ripple(x, z, strength), ridgeY(phiDeg) → number (hill ridge height at r = 420) }`.

**Events:**

| Direction | Events |
|---|---|
| Emits | `note:played` |
| Consumes | `click:ground` (ignore if `loch.contains`; mound if `dm < 20`; else ground ripple), `meteor:land` (when `!inLoch`: ripple strength 0.6, no sound), `bealach:phase` |

**World fields:**
- Writes `heightAt`, `groundMeshes` (push), `terrain`.
- Reads `world.loch` (lazily), `uClimaxT`, `uFireLevel`, `uAfterglow`.

**Budget:**
- High: 4 draws (ground incl. ripples, mound set, hills, grass), ≤ 60k triangles. Ground fragment: ≤ 6 ripple evaluations, fireLight, fog; no texture fetch except the entrance-spiral mask on the mound set.
- Low: 3 draws (no grass), 48×96 grid, 128×4 hills, ≤ 12k triangles.

**Acceptance:**
1. `eval:[__festival.world.heightAt(0,-50),__festival.world.heightAt(12.5,0),__festival.world.heightAt(0,0)]` → `[10.0, 0.8, -0.4]` (±0.01).
2. `--url "index.html?only=terrain&warm=2&noauto"` shows:
   - An empty elliptical hole where the loch will be, around (640, 490) (N rim 427, S rim 586).
   - The mound silhouette above the horizon from x ≈ 596 to 935, crown y ≈ 222 at x ≈ 752.
   - A hill ridge 12–55 px above y = 264, lowest around x ≈ 822 (north; mostly hidden behind the mound).
   - No firelight at all (`uFireLevel` defaults to 0 without `fire`): every ground 5×5 mean below the horizon has R ≤ G + 2.
   - Silhouette check (`&shot`): the 5×5 luma at (752, 214) (sky just above the crown) exceeds the luma at (752, 232) (mound just below the crown) by ≥ 12.
3. `?only=terrain,fire&warm=10&noauto&shot`: the firelit festival ground at (560, 610) (r ≈ 11.7) has luma 12–35 with R ≥ G + 2; the meadow at (266, 402) (r ≈ 22) has luma ≤ 14.
4. `--actions "wait:1000;click:150,720;wait:600;shot"` shows a gold three-lobed ring on the ground in the lower-left foreground (click lands at ≈ (−3.8, 15.5), r 16).
5. `?only=terrain&veil=1&noauto&warm=2&shot`: 5×5 mean at the passage (738, 349) has R ≥ 140 and R > G > B. (In the full scene the east portal hides it at this camera; that is expected.)
6. `?only=terrain,bealach&phaseT=40&freezeT&noauto&warm=1&shot`: at the climax pose, the entrance stone at (640, 383) shows a gold triple spiral (5×5 max R ≥ 180).

---

### 10.4 `loch` (src/modules/loch.js, load order 4)

**Owns:** the water disc; the Otherworld fisheye sky; star trails; reflection-only stars (*Tír fo Thuinn*); the fire streak; ripples; the triple-spiral progress drawing; the veil mist; the loch click response.

**Fisheye mapping** (exact; both directions must agree; **not mirrored** — a star right of centre in the sky has its echo right of centre in the loch):
- **Forward** (star direction → water point):
  1. `d' = rotate(d, axis = LAYOUT.sky.celestialPole, angle = +uOtherAngle)` (Rodrigues).
  2. `ζ = acos(clamp(d'.y, 0, 1))`, `ρ = 9.0·0.92·ζ/(π/2)`, `α = atan2(d'.x, −d'.z)`.
  3. Point = `(ρ·sin α, 0.01, −ρ·cos α)`.
- **Inverse** (water point → direction, in the water shader):
  1. `ρ = length(xz)`, `α = atan(x, −z)`, `ζ = ρ/(8.28)·π/2`.
  2. If ζ > π/2, use the horizon colour. Otherwise `d' = (sinζ·sinα, cosζ, −sinζ·cosα)` and `d = rotate(d', pole, −uOtherAngle)`.
- The pole therefore lands at (0, −3.40): **the stone arm of the spiral wheels around the Otherworld pole.** Re-projected at the default camera: pole (660, 456); zenith = loch centre (640, 480); the Otherworld band foot (at `uOtherAngle` = 0) ≈ (654, 429), just inside the north rim; the east horizon ≈ (921, 495).

**Builds:**

| Object | Construction |
|---|---|
| **Water** | `CircleGeometry(9.4, 96)` at y = 0, opaque, `depthWrite:true`, `fog:true`. Pushed to `groundMeshes`. |
| Water shader, 1 | Base `peat`. |
| Water shader, 2 | Fisheye sky: `otherSky(d)·0.55`, from `world.sky.glslDecl` + `world.sky.glsl` with `world.sky.uniforms` plugged in; fallback when `sky` is absent is a peat→airglow gradient. |
| Water shader, 3 | Fresnel toward the fog/horizon colour at grazing view angles (`pow(1 − |v.y|, 5)`·0.6). |
| Water shader, 4 | Fire streak: `ember`-to-`torc` glow where the reflected view ray points at the flame. Compute angular distance between `reflect(viewDir, up)` and `normalize(uFirePos + (0,1.2,0) − worldPos)`, stretch it vertically ×4, intensity `2.0·uFireLevel`, broken by ripple noise. |
| Water shader, 5 | Ripples: 8 ripple uniforms `vec4(x, z, startTime, strength)`. Rings radius `3.2·age·0.8`, age ≤ 2.5 s. They perturb the fisheye lookup (ρ, α) and add a faint `boFinne` ring. |
| Water shader, 6 | Micro flicker ripples near the islet driven by `uFireLevel` and E. |
| Water shader, 7 | Shoreline: darken within 0.4 m of r = 9. |
| Water shader, 8 | River glow: during pour and river (pure function of `uClimaxT`), add `boFinne`×0.3 along the river path where the path's w < the front. Distance to leg B analytically: for polar (ρp, φp) take `w_k = (φp_deg + 360k)/1080` for k = 0, 1, 2 (clamped to [0,1]), `r_k = 6.0 − 3.8·w_k`, distance = `min_k |ρp − r_k|`; glow `smoothstep(0.9, 0.2, distance)`. |
| **Spiral texture** | Canvas 1024² covering xz ∈ [−9, 9]². Drawn once as thick polylines, stroke width 0.22 m: **R** = stroke mask; **G** = arm param s (0 at the outer end → 1 at the centre); **B** = arm id (40 = stone, 120 = wish, 200 = fire, 255 = connector). |
| Spiral geometry | Arm k centre `c_k = 3.6·(sin φk, −cos φk)` with φk = 0°, 120°, 240°. Arm point `c_k + ρ(s)·(sin ψ, −cos ψ)`, where `ρ = 1.9 − 1.65·s` and `ψ = φk + s·2.25·2π` (sunwise inward). Connectors are quadratic Béziers from arm k's outer end to arm k+1's outer end, with the control point at radius 6.2 and φ = φk + 60°. |
| Spiral in the water shader | **Pecked** look: stipple mask `step(0.45, hash(floor(xz·14)))·R`. Unfilled: dark groove ×0.6 with a faint `lichen`×0.08 edge. Filled (s < filled fraction of that arm, from `spiral:progress` segments with a 0.6 s ease): `torc`×2.2 pecks. Newly filled segment: flash ×4 over 0.5 s. On beat (`music:beat`, beatInBar 0) when complete: pulse +30%. River phase: white-gold fill per §7.3. Connectors light only in river and return. |
| **Trails** | `InstancedMesh`: 3000 brightest catalog stars (low: 900 stars as `Points`, no trails). Each is an 8-segment strip (16 vertices). The vertex shader evaluates the forward mapping at angles `uOtherAngle − i/8·arc`, with `arc = 12°·(1 + V)·trailScale`. **Width is set in screen space** (expand each strip in clip space to 1.2 px), because at the default camera the water is seen at ≈ 12° and a 0.035 m world-space strip would be 0.2 px thick and shimmer; alpha falls along the trail. Colour `mix(boFinne, torc, V)`, brightness `mag·(0.6 + 0.4·E)`. `trailScale` is a pure function of `uClimaxT`: 1 → 0 over T 26–32, 0 through afterglow, back to 1 over T 122–126. Additive, `depthWrite:false`, y = 0.012. |
| **Echo stars** | A pool of 256, same instanced mesh with a flag (or one `Points` object): one per `star:born` (forward-mapped, so it wheels; when `!onScreen` it flares ×2 for 1.5 s), plus up to 64 reflection-only `torc` stars from loch taps and meteor landings (fixed on the water; they do not wheel). |
| **Veil mist** | Open cylinder, r 9.3, height 3, 96 × 1 segments, `side: BackSide` (only the far half renders, so it never veils the fire or the near water). Horizontal, slowly drifting mist bands (1 octave value noise in (angle·6, y·2 − uTime·0.05)), `verdigris`, alpha `0.18·smoothstep(0.2, 1, V)`, fading upward; height scale `smoothstep(0.2, 1, V)`. `veil:hold{active:true}` adds a 1.2 s swell. Additive, `depthWrite:false`, `fog:false`. No vertical strands (§11.3 #2). |

`loch` renders the water at the default `renderOrder` 0, opaque. It draws no reflections of stones, tree or mound (R9).

**API:** `world.loch = { radius:9, contains, project(dir, out) (forward mapping, current uOtherAngle), ripple(x, z, strength), spiralPoint(arm, s, out) }`.

**Events:**

| Direction | Events |
|---|---|
| Emits | `note:played` |
| Consumes | `click:ground` (if contains), `star:born`, `meteor:land`, `spiral:progress`, `music:beat`, `music:echo`, `veil:hold`, `bealach:phase` |

**World fields:**
- Writes `loch`, `groundMeshes` (push).
- Reads `world.sky` (`glslDecl`, `glsl`, `uniforms`, `catalog`; at setup — `sky` loads earlier), `uOtherAngle`, `uFireLevel`, `uClimaxT`, `uAfterglow`.

**Budget:**
- High: 3 draws (water, trails + echo stars, mist), ≤ 43k triangles. Water fragment: 1 band-texture fetch (inside `otherSky`), 1 spiral-texture fetch, ≤ 8 ripple loops, 1 value-noise octave. When zoomed in to 12 m the water can fill 60% of the screen; this fragment budget is what keeps that at 60 fps.
- Low: 3 draws (water, 900 + 320 points, mist), 1.2k points, no ripple distortion on the fisheye (rings only).

**Acceptance** (`&shot` for pixel checks):
1. `--url "index.html?only=sky,loch&warm=10&noauto&shot"` shows:
   - An ellipse through N (686, 427), S (549, 586), E (948, 497), W (373, 466).
   - Short star trails arcing **around a point near (660, 456)**, at least 1 px thick and not flickering between two consecutive shots (`--shots 2 --interval 100`), and a fisheye Milky Way whose foot lies near the north rim ≈ (654, 429).
   - The mean luma of the water ellipse (5×5 samples at (640,480), (500,500), (800,500), (640,540)) is ≤ 0.55× the band-core luma of sky acceptance 1.
2. `?only=sky,terrain,loch,fire&warm=10&noauto&shot`: a warm vertical streak runs from the islet down toward the S rim; 5×5 at (640, 520) has R ≥ G + 15.
3. `--actions "wait:1500;eval:__festival.events.emit('spiral:progress',{light:[6,2,0],segments:[3,1,0],filled:4,justFilled:null,complete:false,cycle:0});wait:1200;shot"` shows arm 0 (centre ≈ (661, 455)) fully gold, arm 1 (≈ (736, 502)) one outer third gold, and arm 2 (≈ (524, 490)) as dark pecked grooves only.
4. `--actions "wait:1500;click:560,530;wait:400;shot;wait:3000;shot"` shows a ring ripple in shot 1 and a persisting gold point in shot 2.
5. `&veil=1` shows gold loch stars, longer trails and a faint verdigris mist band along the far (north) rim only, between y ≈ 395 and 430; nothing verdigris over the near half of the water.
6. `--actions "wait:1500;eval:__festival.events.emit('star:born',{id:999,dir:new __festival.THREE.Vector3(0,0.9,-0.44).normalize(),kind:'wish',color:0xD9A547,mag:1,onScreen:false,byAosSi:false});wait:300;shot"` shows a flaring gold echo star inside the ellipse.

---

### 10.5 `fire` (src/modules/fire.js, load order 5)

**Owns:** the islet, flame, sparks, ember-star flights, hill beacons, `uFireLevel`, and the fire tap/hold responses and ghost fire offerings.

**Builds:**

| Object | Construction |
|---|---|
| **Islet** | Displaced cylinder, r 1.4, top 0.35, 48 segments. `lichen`, `fireLight`, wet-dark rim. `fog:true`. |
| **Logs and embers** | 5 small merged boxes (charred), with ember emissive `ember`×(1 + 2·level) in cracks. |
| **Flame** | Two Y-axis-billboard quads (rotate around Y only), 1.2 m wide × `mix(1.4, 3.2, clamp(level, 0, 1))` tall. Fragment: two noise-warped fbm layers scrolling up at different speeds, shaped by a teardrop mask, blackbody ramp `ember → torc → boFinne` with core intensity up to 6 (white-gold `mix` at level > 1). Additive, `depthWrite:false`. |
| **Sparks** | GPU-stateless `Points`, 1500 (low 600). Attributes: seed and burst slot. Uniforms: `uBursts[8] = vec3(startTime, strength, kind)`. Continuous idle stream plus bursts. Position is analytic: rise with drag, drift through a **triskele flow** (three rotating arms, curl-like offset), lifetime 1.5–4 s, colour `ember → torc`, size ≤ 4 px. |
| **Ember flights + beacons** | **One** CPU-attribute `Points` object (17 points). Flights: ≤ 8 motes; Bezier from the flame top to `camLaunch + dir·60` (camera position frozen at launch, `dir = sky.pickViewDir({6,16})`), 1.2 s. At arrival: `sky.addStar(dir, {kind:'ember', color:torc, mag:1, anchor:'air', byAosSi})`. Beacons: 9 on the ridge at r = 420 (`y = world.terrain.ridgeY(φ) + 4` if present, else `420·tan(2°) + 4`), `ember`×2.5 with flicker, 2–3 px, `fog:true` (they sit in haze). |
| **Beacon order** | Lit count `min(9, floor(E·10))`, each fading in over 1.5 s, lit **sunwise starting at φ = 336°**: 336, 20, 62, 101, 139, 178, 222, 259, 298. The first two are the only ones in the default frame — (466, ≈240) and (1149, ≈236), flanking the mound — so the first answer from the hills is seen. |
| **`uFireLevel`** | Written each frame: idle `0.4 + 0.25·E`; surges add and decay (tap → 1.0, 2.5 s decay; plume → 1.2); beckon +0.15 for 0.4 s; arrival ramp 0.15 → idle over 3–9 s. Climax values are pure functions of `uClimaxT` per §7.3. `world.firePos.set(0, 0.35, 0)` at setup. |
| **Proxy** | Cylinder r 1.5, h 3.6 (screen: x 596–685, y 352–471 at the default camera), `material.visible=false`, registered with `addPickable` (onClick = tap). |

**Events:**

| Direction | Events |
|---|---|
| Emits | `offering{fire}`, `fire:surge`, `note:played` |
| Consumes | `hold:start`/`hold:end` (claim protocol), `key` (`0`, ignoring repeats), `aossi:offer{fire}`, `hint:change`, `music:beat` (beckon only), `bealach:phase` |

**World fields:**
- Writes `world.fire = { pos, level(), proxy, beaconsLit }`, `uFireLevel`, `firePos` (set).
- Reads `world.sky`, `world.terrain`, `world.music` (all load earlier), `world.bealach` (loads later: read lazily).

**Budget:**
- High: 4 draws (islet + logs merged, flame, sparks, flights+beacons), ≤ 2k triangles, 1.5k sparks.
- Low: 4 draws, 600 sparks, 1 flame noise layer.
- Overdraw: the flame quads cover ≤ 1% of the screen at the default camera and ≤ 6% at minimum zoom; sparks ≤ 4 px·dpr.

**Acceptance:**
1. `--url "index.html?only=terrain,fire&warm=10&noauto&shot"` shows a small blackbody flame, base at (640, 469) and idle tip near (640, 424): no cartoon outline, hottest at the base, orange-gold; 5×5 at (640, 458) has R ≥ 200 and R > G > B. Sparks rise above it. The islet shows as a dark stone disc between x 596 and 685.
2. `&energy=0.5&warm=4`: `eval:__festival.world.fire.beaconsLit` → 5; the shot shows exactly two tiny ember points on the far ridge near (466, 240) and (1149, 236).
3. `?only=sky,terrain,fire&warm=10&noauto` with `--actions "wait:1500;click:640,442;wait:300;shot;wait:1400;shot"`: shot 1 shows a spark burst, shot 2 a new gold star in the sky area (above y = 250).
4. `eval:__festival.uniforms.uFireLevel.value` returns 0.4–0.65 at idle with `&warm=10`.
5. `?q=low` has no warnings, and the spark count is 600.

---

### 10.6 `stones` (src/modules/stones.js, load order 6)

**Owns:** the 11 stones, ogham notches, harp threads, harp-star levels, stone tap/hold/key/deiseal responses, idle blink and beckon, climax strums and ring-wave, and ghost stone offerings. (No reflections: R9.)

**Builds:**

| Object | Construction |
|---|---|
| **Stones** | One `InstancedMesh` of a subdivided box (8×12×4 segments), displaced in the vertex shader by per-instance seeded noise into **tapered slabs** (top 70% of base width, rounded weathered top, slight lean ≤ 4°). Normals come from screen-space derivatives in the fragment shader (`normalize(cross(dFdx(wp), dFdy(wp)))`), which gives a faceted, pecked-stone read and avoids recomputing displaced normals. Placed per `LAYOUT.stones` on `heightAt` (fallback 0.8): top at 0.8 + h, base buried 0.3 m below the bank, broad face toward the centre; the recumbent is horizontal (tangent) at y = heightAt. Shader: `lichen` albedo with lichen-patch noise (paler `lichen`×1.3 blotches — no new hue), `fireLight` + `skyAmbient`, `fog:true`. |
| **Ogham** | Per stone, an edge-aligned notch pattern from a canvas atlas (512×512, 11 cells), **drawn procedurally** (stemline = the stone's arris; aicme Beithe strokes to one side, hÚatha to the other, Muine diagonal across, Ailme short notches on the edge; §6.3 stroke counts), never from a font. Portal stones carry ᚏᚓᚐᚂᚈᚐ (RÉALTA); harp stones carry the letter of their pitch index. Glow `torc × (0.4·V + flicker + ringGlow + beckon)`, with `ringGlow` lighting bottom→top over 0.4 s. |

  Ogham letter per harp stone (k: letter):

  | k | letter |
  |---|---|
  | 0 | ᚁ |
  | 1 | ᚂ |
  | 2 | ᚃ |
  | 3 | ᚄ |
  | 4 | ᚅ |
  | 5 | ᚆ |
  | 6 | ᚇ |
  | 7 | ᚈ |

  The recumbent carries ᚈᚔᚅᚓ (TINE).

| Object | Construction |
|---|---|
| **Threads** | 8 twisted ribbons (48 segments each, one merged geometry, per-vertex `aK`, `aU` 0→1 along the thread), **expanded in the vertex shader** so the far end follows the camera: `P(u) = mix(stoneTop, cameraPosition + starDir·900, u)` with `starDir` passed per thread as a uniform (from `sky.starDir(id)`, refreshed every frame — cheap, and required in the climax when the sky rotates). Screen-space width 2 px at the stone tapering to 1 px at the star, with a twist brightness modulation along `aU`. Alpha `level·(0.7 + 0.3·E)`, fading along its length. `torc`, `fog:false`, additive, `depthWrite:false`. Sparks are bright moving bands in the shader (uniform per thread: sparkStart, sparkDur, in `state.time`). |
| **Proxies** | 11 boxes at 1.6× size, invisible, `addPickable`. |

**Behaviour:**
- `ringing: Float32Array(11)` (levels) per §6.2.
- Harp star level `0.5 + 2.5·level` via `sky.setStarLevel`.
- **Idle blink:** before the viewer's first stone offering, the harp stone whose top projects **nearest the screen centre** (recomputed each downbeat from `tops[]`, visible stones only) glows its ogham in time with `music:beat` (0.25 peak), and a ghost spark climbs its thread every 8 s. After the first stone offering, stones not ringing blink at 0.08 on downbeats while E < 0.5.
- **Beckon** (`hint:change` target `stone`): the same nearest-centre stone at 0.35 on downbeats; its thread shows at alpha 0.25.
- **Climax** (pure functions of T except the one-shot strums): strums at T = 3.0 and 5.4; portal inner faces lit at T = 15; ring-wave T = 17–20.3; threads flare at T = 0, hold 0.6 through river, flare at T = 30.
- `deiseal:turn{1}`: strum all 8 ascending on eighths from `M.next('beat')` (visual timing per §4.4 rule 1), set level 1 at each pluck, emit `offering{stone, 3, 'deiseal'}` once.
- `deiseal:turn{-1}`: mute all.
- **Ghost offering:** the harp stone nearest the screen centre rings at level 0.8, audio ×0.5, its thread tinted `verdigris`; emits `offering{stone, weight from aossi:offer, 'aossi', byAosSi:true}`.
- Hold: plucks while held, `offering` and energy **on release** (§4.1).

**Events:**

| Direction | Events |
|---|---|
| Emits | `offering{stone}`, `stone:ring`, `note:played` |
| Consumes | `hold:start`/`hold:end`, `key` (`1`–`8`, ignoring repeats), `music:beat`, `deiseal:turn`, `aossi:offer{stone}`, `hint:change`, `bealach:phase` |

**World fields:**
- Writes `world.stones`.
- Reads `world.heightAt`, `world.sky`, `world.music` (earlier), `world.bealach` (later: lazily).

**Budget:**
- High: 2 draws (stones, threads), ≤ 9k triangles.
- Low: 2 draws, 4×6×2 segments, ≤ 3k triangles.

**Acceptance:**
1. `--url "index.html?only=terrain,stones&warm=2&noauto"` shows 11 stones with graded heights:
   - East portal top at (741, 315) and west portal top at (657, 314): the two tallest, framing a gap centred near x = 700.
   - Recumbent lying low with its top near (481, 553).
   - Harp stone tops at k0 (906, 332), k1 (1052, 363), k2 (1108, 422), k3 (919, 501), k4 (196, 462), k5 (197, 390), k6 (327, 347), k7 (489, 325).
   - Stones read as weathered, faceted slabs with visibly tapered tops, not boxes or blobs.
2. `?only=sky,terrain,stones&warm=10&noauto` with `--key 1 --wait 400` shows a gold thread from about (906, 332) rising to harp star k0 at (785, 193). `eval:__festival.world.stones.ringing[1]` > 0.9.
3. `--actions "wait:1500;hold:1052,380,1600;wait:200;shot"` shows a thicker, trembling thread for k1 ending at (771, 163).
4. `?only=sky,terrain,fire,stones&warm=10&noauto&shot`: the portal stones' inner faces are **visibly firelit**: 5×5 means at (730, 356) and (665, 355) have luma 20–70 with R > G > B; the outer back of the recumbent is darker than its inner face.
5. `?q=low` has no warnings.

---

### 10.7 `sceach` (src/modules/sceach.js, load order 7)

**Owns:** the hawthorn, the tobar, ribbons (*ribíní*), wish motes, word ribbons, blossoms and haws, wish tap/hold/word responses, and ghost wish offerings.

**Builds:**

| Object | Construction |
|---|---|
| **Tree** | Seeded recursive branching (`ctx.makeRng('sceach')`, depth 5, 2–3 children, gnarled angular turns, wind-bent 8° away from the loch). `TubeGeometry` per branch (5 radial segments; low 3) merged with `BufferGeometryUtils.mergeGeometries`. The **tobar ring** (9 small displaced stones, r 0.55 at `LAYOUT.tobar.pos`) is merged into the same geometry. Bark `lichen`×0.6, `fireLight` + `skyAmbient`, `fog:true`. Collect ≥ 60 twig-tip anchor points. Tobar water: a small dark disc (r 0.45) with a fire glint, plus a 0.15 m dark rill strip from the well (r 10.2) to the shoreline (r 9.25), draped on `heightAt` + 0.02. Generation (branching + merge) ≤ 150 ms. |
| **Foliage** (high only) | 240 instanced small quads in dark clusters (`airglow`×0.5, alpha-tested). |
| **Ribbons** | `InstancedMesh` of 0.05 × 0.7 m strips (8 segments), max 48 (low 24). 9 **pre-tied old ribbons** exist at setup, faded ×0.5 and never counted. Per-instance anchor, dye colour (`madder`, `woad`, `boFinne` linen), age and ghost flag. The vertex shader hangs, flutters (E) and lifts (V). New ribbons "tie" with a 0.4 s wrap-and-drop animation. |
| **Word ribbon** | One 0.09 × 1.4 m strip with a `CanvasTexture` (512×64) of the ogham word **drawn procedurally** (a stemline plus strokes per §6.3; never a font, so it is identical offline and in the bundle), glowing `torc`. Unrolls over 1 s. |
| **Motes** | `Points`: ≤ 12 motes × 16 trail samples (CPU history). Core `boFinne`, tail in dye colour (ghost: `verdigris`). Path: spiral up 10 m (1.2 s, 1.5 turns), then a Bezier to `camLaunch + dir·80` (camera position frozen at the start of the arc, `dir = sky.pickViewDir({6, 17})`) over 1.8 s, then `sky.addStar(dir, {kind:'wish', color:torc, mag:1.2, anchor:'air', byAosSi})`. |
| **Blossom and haws** | One `Points` object: 400 `boFinne` five-petal procedural sprites + 120 `madder` round haws (low 150 + 60), on twig anchors. Pure function of `uClimaxT`: appear over T 28–31, persist through afterglow, fall and fade over T 122–138. |
| **Proxy** | Group (trunk cylinder r 0.6 h 2.2 + crown sphere **r 1.9** at the crown centre), invisible, one pickable. The crown proxy is deliberately smaller than 1.6× the crown: at r 2.6 it covered harp stone k2's top at the default camera (crown centre (1011, 420), k2 top (1108, 422); r 1.9 spans x 921–1100). |

**Behaviour:**
- Tap, hold, word and ghost behaviour per §6.2.
- Hold words cycle `beith`, `dair`, `coll`, `sail`, `fearn` (lowercase internally; ogham per §6.3).
- `world.sceach.lastWish = { word, ogham }` is updated on every tie (tap ties set `{word:null, ogham:null}`).
- **Beckon** (`hint:change` target `wish`): on downbeats the ribbons lift for 0.8 s and linen ribbons brighten ×1.6.
- The ribbon tie happens on tap (immediately) or on hold release; `wish:tied` and `offering` are emitted at that moment.

**Events:**

| Direction | Events |
|---|---|
| Emits | `offering{wish}`, `wish:tied`, `note:played` |
| Consumes | `hold:start`/`hold:end`, `ogham:word`, `aossi:offer{wish}`, `hint:change`, `music:beat` (beckon only), `bealach:phase` |

**World fields:**
- Writes `world.sceach = { pos, crown, proxy, lastWish }`.
- Reads `world.heightAt`, `world.sky`, `world.music` (earlier), `world.bealach` (later: lazily).

**Budget:**
- High: 6 draws (tree+tobar, foliage, ribbons, word ribbon, motes, blossoms), ≤ 15k triangles, CPU < 0.4 ms.
- Low: 5 draws (no foliage), ≤ 6k triangles.

**Acceptance:**
1. `--url "index.html?only=terrain,sceach&warm=2&noauto"` shows a gnarled, wind-bent tree at the right third: base ≈ (985, 549), top ≈ (1030, 345), crown ≈ (1011, 420), leaning away from frame centre. It carries 9 faded ribbons, and there is a small stone ring at its left-front foot near (944, 557), on dry ground.
2. `?only=sky,terrain,sceach&warm=10&noauto` with `--actions "wait:1500;click:1011,420;wait:600;shot;wait:2600;shot"`: shot 1 shows a new bright ribbon and a rising mote; shot 2 shows a new gold star in the sky area (above y = 250).
3. `--actions "wait:1500;hold:1011,420,1600;wait:300;eval:__festival.world.sceach.lastWish"` → `{word:'beith', ogham:'ᚁᚓᚔᚈᚆ'}`.
4. `eval:__festival.events.emit('ogham:word',{word:'ceol',ogham:'ᚉᚓᚑᚂ'})` → the next shot shows a long glowing ribbon with 4 ogham letters.
5. `?only=terrain,sceach,bealach&phaseT=31&freezeT&noauto&warm=1` shows white blossom and red haws on the tree at the same time (the camera is at the climax pose; crown ≈ (947, 394)).
6. Pick separation with `?only=sky,terrain,stones,sceach&warm=2&noauto`: `--actions "wait:1500;click:1120,450;wait:400;eval:__festival.world.stones.ringing[3];eval:__festival.world.sceach.lastWish"` → `> 0.9` and `null` (the click rang harp stone k2, and no ribbon was tied).

---

### 10.8 `bealach` (src/modules/bealach.js, load order 8) — festival director and the signature

**Owns:**
- **The state machine and the only writes to `veilTarget`**, energy decay, and climax energy overrides.
- Spiral light and `spiral:progress`.
- The aos sí scheduler and the *deiseal* measurement.
- Hold-claim resolution and the veil hold (pointer and Space).
- Climax trigger and timeline, `uClimaxT`, `uAfterglow`, `bealach:phase`.
- **The only camera and controls writes** (0 ≤ T < 42).
- The milk-river particles, river ribbon and fire column.
- Debug params `?climax=1`, `?phaseT=<s>`, `?freezeT`; honours the `?energy`/`?veil` pins (§4.1).

**Timeline rule for everyone:** climax visuals in every module must be **pure functions of T** (from `world.bealach.T` or `uClimaxT`), with no per-frame accumulation, so `?phaseT` jumps render correctly (§4.4 rule 6). One-shot sounds whose start time has already passed when joining mid-phase are skipped. When joining with T ≥ 5, the camera snaps to the climax pose.

**Update order inside `bealach.update`:** (1) advance T and write `world.bealach.T`/`uClimaxT`/`uAfterglow`; (2) emit `bealach:phase` on a transition; (3) spiral/aos sí/deiseal/energy/veil; (4) camera. Everything a later module (`hud`) reads is then current for this frame.

**The path (the White Cow's road)**

A `DataTexture` of 1024×1 RGBA `FloatType` (NearestFilter; the shader lerps two texels manually). xyz = position, w = width. **Texture u is linear in T:**

| Leg | T | u |
|---|---|---|
| A (sky → mound → portal gap → loch edge) | 8 → 16 | 0 → 0.5 |
| B (three sunwise turns in the loch) | 16 → 25 | 0.5 → 0.85 (the front holds for T 25–26) |
| C (fire column) | 26 → 30 | 0.85 → 1.0 |

**Leg A:** centripetal `CatmullRomCurve3` through these control points, each with a time knot. Within each span, u maps linearly to arc length between that span's control points (find each control point's arc-length fraction by dense sampling). Width is interpolated per point.

| Point | Position | T knot | Width w (m) |
|---|---|---|---|
| P0 pillar top | (0, 263.1, −860.7) | 8 | 30 |
| P1 above hills | (0, 42, −420) | 10 | 12 |
| P2 | (0, 15, −95) | 11.2 | 4 |
| P3 mound crown | (0, 10.6, −50) | 12 | 2.2 |
| P4 entrance | (0, 3.4, −31.2) | 13.5 | 1.8 |
| P5 | (0, heightAt+0.15, −22) | 14.2 | 1.8 |
| P6 portal gap | (0, 0.95, −12.5) | 15 | 1.8 |
| P7 loch edge | (0, 0.08, −8.4) | 16 | 1.8 |

After P3, every sample outside the loch is re-projected to `heightAt(x,z) + 0.15`. Samples inside the loch sit at y = 0.08.

**Leg B:**
- The first 3% of the leg is a straight line from P7 to (0, 0.08, −6.0).
- Then, for w ∈ [0,1]: `r = 6.0 − 3.8·w`, `φ = 1080°·w`, position `(r·sin φ, 0.08, −r·cos φ)`. Width 1.6.

**Leg C:** (0, 0.08, −2.2) → (0, 0.5, 0) over 10% of the leg, then straight up to (0, 80, 0). Width 1.0 → 0.6.

**Builds:**

| Object | Construction |
|---|---|
| **Particles** | `Points`: 16000 high, 6000 low, 0 with reduced motion. Attributes: `aSeed` s∈[0,1), `aLane` (Gaussian σ 0.35, clamped ±1), `aLane2`, `aSize`, `aSet` (70% river set, 30% column set). Vertex shader, with `uFront = u(T)`: river set `u = uFront·fract(s + T·0.06)`, visible T 8–29 (fade out 26–29); column set `u = 0.5 + (uFront − 0.5)·fract(s + T·0.08)`, visible T ≥ 25.5. Position = path(u) + side·aLane·w(u) + up·aLane2·0.15·w(u), where side = `normalize(cross(tangent, up))` or (1,0,0) when the tangent is near vertical. Alpha ×`(1 − 0.85·bandTex.g(fract(u·5 + T·0.01), aLane·0.5 + 0.5))`, so **the Milky Way's dust lanes travel with the river**. Colour: 85% `boFinne`×1.6, 15% `torc`×1.5. Size `aSize·dpr·clamp(300/dist, 1.5, 4)` px (soft gaussian sprite; the cap keeps additive overdraw bounded where the river bunches up at the pillar top and in the loch). Global fade-in T 8–8.5, fade-out T 30–34. Additive, `depthWrite:false`, `fog:false`. The path texture is sampled in the vertex shader (WebGL2 vertex texture fetch; `FloatType` + `NearestFilter` is supported on iOS/Android WebGL2). |
| **River ribbon** | From u = 0.25 (P3) to 0.85, 600 segments, built on the CPU from the path samples, width `1.2·w`. Shader: visible where `aU < uFront` (soft 0.01 edge), soft lateral edges, fbm flow along `aU·400 − T·3`, dust lanes as above, `boFinne`×1.2 core → ×0.3 edges. Fades T 28–31. |
| **Column** | Open `CylinderGeometry(1.4, 0.6, 80, 24, 8, true)` centred at (0, 40.35, 0). Revealed where local height < `(T − 26)/2·80`. `boFinne`×4 core (inverse fresnel), `torc` rim, brightness modulated by the band texture scrolling upward (the Milky Way's dust lanes rising back to the sky) — soft milk, no hard light-shaft strands. Fades T 30–34. |

All three are `visible = false` outside T ∈ [8, 34].

**Trigger, camera, energy, veil, aos sí, spiral:** as specified in §4, §6.2, §6.4 and §7.3.

**Deiseal measurement:**
- Each frame, `θ = atan2(cam.x − tgt.x, cam.z − tgt.z)` (three's `Spherical.theta`), and `Δ` is its wrapped change.
- On every frame where `controls.autoRotate === false` and the phase is `idle`: `acc += −Δ` (a decreasing θ is sunwise — dragging right moves the camera sunwise). This includes the damping inertia after `pointer:up`, and never includes auto-rotation. The camera tween never runs in `idle`, so it cannot be counted.
- `acc ≥ 2π` → `deiseal:turn{1}`, `turns.deiseal++`; `acc ≤ −2π` → `{−1}`, `turns.tuathal++`. Either resets `acc`. `acc` also resets after 15 s without pointer activity.

**Veil hold:** pointer (no claim) or Space (§5.2 rule 8). Emits `veil:hold{active}` on start and end, plays the whooshes of §6.2, and never runs during `hush`…`return`.

**Events:**

| Direction | Events |
|---|---|
| Emits | `spiral:progress`, `aossi:offer`, `veil:hold`, `deiseal:turn`, `bealach:phase` (including `{phase:'idle', T:-1}` at setup), `note:played` (spiral segment bells, `src:'bealach'`) |
| Consumes | `offering`, `music:beat`, `hold:start`/`hold:end`, `key` (`Space`, ignoring repeats), `pointer:down` (tween cancel, activity), `festival:first-interaction` |

It also adds its own `window` `keyup` and `blur` listeners (Space release).

**World fields:**
- Writes `world.bealach`, `uClimaxT`, `uAfterglow`, `state.veilTarget`, `state.energyTarget` (decay and overrides), `controls.autoRotate` and `camera.position` (0 ≤ T < 42 only).
- Reads `world.music`, `world.sky` (`bandTexture`), `heightAt` (all earlier), `controls.target`, the boot camera distance `d0`.

**Budget:**
- 0 draws outside T ∈ [8, 34].
- During the climax: 3 draws, 16k (low 6k) points, ≤ 2k triangles; additive river coverage ≤ 12% of the screen at the climax pose.
- CPU < 0.3 ms. Path texture built at setup in ≤ 30 ms.

**Acceptance** (full module set unless noted; `&shot` for pixel checks):
1. `--url "index.html?phaseT=12&freezeT&noauto&warm=1&shot"` shows:
   - The camera at the climax pose: `eval:__festival.camera.position.toArray().map(v=>+v.toFixed(1))` → `[0, 5.8, 31.8]` (±0.1).
   - A luminous stream descending along x ≈ 640 from P0 (640, 52) through P1 (640, 240) onto the mound crown (640, 266): some 5×5 block on x = 640 between y 60 and 260 has luma ≥ 150.
   - A dark empty channel beside the stream: 5×5 luma at (705, 185) ≤ 25 (inside the drained band, clear of the stream and of the harp stars).
   - Gold kerb and entrance spirals starting to glow (entrance stone at (640, 383)).
   - Harp stars (672, 210)…(606, 73) and Vega/Altair still visible.
2. `?phaseT=20&freezeT&noauto&warm=1&shot`: the stream passes through the portal gap (5×5 at (640, 400) luma ≥ 80) and spirals sunwise in the loch around the fire (640, 457); leg-B samples at (506, 464), (640, 486) and (724, 464) are bright; dust lanes are visible inside it as darker streaks.
3. `?phaseT=28.5&freezeT&noauto&warm=1&shot`: a bright column rises from the fire out of the top of the frame (5×5 at (640, 200) luma ≥ 200), and the band is bright again near its foot.
4. `?climax=1&noauto&warm=6` → `eval:__festival.world.bealach.phase` is `hush` or `pillar`.
5. Attract: `?noauto&warm=40` (no input) → `eval:__festival.world.bealach.light.reduce((a,b)=>a+b)` ≥ 6.
6. Passive pacing: `?noauto&warm=100` → `eval:__festival.world.bealach.phase` is one of `pour`, `river`, `return` (the climax started at ≈ 80 s without any input).
7. `--actions "wait:1500;hold:200,120,2500;eval:__festival.state.veilTarget"` returns ≥ 0.3 (headless-tolerant; on real hardware it reaches 0.75).
8. Claim: `?noauto` with `--actions "wait:1500;hold:906,360,1200;wait:200;eval:[__festival.state.veilTarget,__festival.world.stones.ringing[1]]"` → `[0, >0.9]` (the hold went to harp stone k0, not to the veil).
9. `?noauto` with `--actions "wait:1500;drag:40,400,1240,400;drag:40,400,1240,400;wait:3000;eval:__festival.world.bealach.turns.deiseal"` → ≥ 1.
10. `?q=low&phaseT=20&freezeT&noauto` has no warnings, and `eval:__festival.world.bealach.particleCount` → 6000.

---

### 10.9 `hud` (src/modules/hud.js, load order 9) — HUD owner

**Owns:** all DOM in `ctx.hud`, Google Fonts loading, `ctx.ui.toast`, hint sequencing, ending and epilogue, the sound button, the ringing meter, and ogham typing.

**Builds:** the elements in §9.2, with scoped CSS injected once (class prefix `bf-`), and the inline SVG ornament.

**Events:**

| Direction | Events |
|---|---|
| Emits | `ogham:word`, `hint:change` |
| Consumes | `festival:first-interaction`, `offering`, `star:born`, `stone:ring`, `wish:tied`, `spiral:progress`, `veil:hold`, `deiseal:turn`, `bealach:phase`, `music:beat`, `meteor:land`, `click:ground`, `key` (ignoring repeats), `audio:toggled` |

**World fields:**
- Writes `ctx.ui.toast`.
- Reads `world.bealach`, `world.loch` (`contains`, for t-loch), `ctx.audio`, `ctx.reducedMotion`, `ctx.state.started`.

**Budget:** DOM only. At most 12 elements animated at once, opacity and transform only, never layout-affecting properties per frame. The stemline meter updates at most every 100 ms.

**Acceptance:**
1. `--url "index.html?only=hud" --wait 3500` at 1280×800 shows:
   - The vertical 白き牛の道 and ルーナサの星祭 at top-right.
   - *Bealach na Bó Finne* / *Oíche Lúnasa* with the ornament at bottom-left.
   - The sound button at top-left.
   - h0 「触れると、音が鳴ります · ceol」 at bottom centre.
   - No boxes or panels behind any text.
2. Overlap, at `--w 400 --h 800` and at `--w 844 --h 390`, after forcing every element visible (`eval:__festival.hud.classList.add('bf-debug-all')`, a class the module must support that sets all HUD elements to opacity 1 with sample copy): no two of `.bf-title, .bf-irish, .bf-hint, .bf-toast, .bf-stemline, .bf-sound` have intersecting `getBoundingClientRect()`s, none extends outside the viewport, and `document.documentElement.scrollWidth <= innerWidth`.
3. `--actions "wait:1500;key:KeyB;key:KeyE;key:KeyI;key:KeyT;key:KeyH;wait:300;shot"` shows ᚛ᚁᚓᚔᚈᚆ᚜ on the left stemline, reading bottom to top.
4. `eval:__festival.events.emit('star:born',{id:1,dir:new __festival.THREE.Vector3(0,1,0),kind:'wish',color:0,mag:1,onScreen:true,byAosSi:false})` → the next shot shows 「星がひとつ生まれた · réalta」 top-centre.
5. `?only=hud,bealach&phaseT=34&freezeT` shows 「道はひらかれた」 with *Tá an bealach oscailte* below it, centred.
6. Clicking the sound button toggles `aria-pressed` and `__festival.audio.enabled`. Keyboard: `--actions "wait:1500;key:Tab;key:Tab;key:Space;eval:__festival.audio.enabled"` → `false`, and no `key` event with `code:'Space'` was emitted (record with `eval:__festival.events.on('key',k=>window.__k=k.code)` first).
7. `--actions "eval:(()=>{window.__h=[];__festival.events.on('hint:change',p=>__h.push(p.id))})();wait:8000;eval:window.__h"` contains `'h0'`.

---

### 10.10 Integration acceptance (lead, full module set)

Run after merging; nobody owns these alone, so failures are triaged by the module named in brackets.

1. **Default frame** `index.html?noauto&warm=12&shot` at 1280×800 shows the eight items of §3.7 at the §3.5 positions. Pixel checks: sky 5×5 at (300, 120) luma ≤ 20 [sky]; airglow at (300, 238) G 30–60 [sky] (the hill ridge occludes the 0–1.5° band away from north, so (300,256) is hills, not sky — corrected by the lead); mound silhouette contrast at (752, 214) vs (752, 232) ≥ 12 [terrain/sky]; portal inner faces (730, 356) and (665, 355) luma 20–70, R > G > B [stones/fire]; flame (640, 458) R ≥ 200 [fire]; loch mean ≤ 0.55× band core [loch]; **no 5×5 mean on a 32 px grid has B > G + 6**, except over the `woad` ribbons on the sceach [all].
2. **Portrait** `--w 400 --h 800 --url "index.html?noauto&warm=12&shot"`: fire base near (200, 441), loch W/E rims within the frame, band foot near x = 261, HUD passes §10.9 acceptance 2 [core CR-1, hud].
3. **Console:** zero errors and zero warnings for the full set, for `?q=low`, and for `?phaseT=20&freezeT` [all].
4. **Draw count** (§11.1 snippet): ≤ 32 at `?noauto&warm=12`, ≤ 32 at `?phaseT=20&freezeT`; ≤ 28 with `&q=low` [all].
5. **Signature timing:** `?noauto&warm=100` → phase in {pour, river, return} (§10.8 acceptance 6) [bealach/conductor].
6. **Real-hardware performance** (not headless): on the M1 Air in Chrome at DPR 1.75, open `index.html`, play until the climax, and record `--fps`-style rAF rates with DevTools' FPS meter during idle, a veil hold, and T 8–34; all ≥ 58 fps median. On a mid-range phone with `?q=low`: ≥ 50 fps median, never below 30 for more than 0.5 s.
7. **Hands-on script (human, 3 minutes, first-time tester, sound on and again sound off):** without instructions the tester makes a star within 20 s, finds all three places of offering within 90 s, and sees the climax within 2 minutes; with no input at all the climax starts within 90 s. Record where they hesitated; tune only the §6.4 numbers or the hint copy, never add UI.

---

## 11. Performance, quality rules, and the "don't" list

### 11.1 Performance targets

**Target:** 60 fps on an M1 MacBook Air in Chrome at DPR 1.75 (high), including the climax.

**Low path** (`ctx.quality === 'low'`, `qualityScale` 0.4), designed for mid-range phones at 60 fps, with 30 fps as the floor:

| Module | Low-quality change |
|---|---|
| `sky` | 2800 stars, 1024×96 band texture |
| `terrain` | No grass, 48×96 grid, 128×4 hills |
| `loch` | Points instead of trails, no fisheye ripple distortion |
| `stones` | 4×6×2 segments |
| `fire` | 600 sparks, 1 flame noise layer |
| `sceach` | 24 ribbons, no foliage, 150 + 60 blossom/haws, 3 radial tube segments |
| `bealach` | 6000 particles |
| `conductor` | No pad or ornaments; 8 voice-starts/s |

**Budget table** (high / low):

| Module | Draws | Triangles | Points |
|---|---|---|---|
| `conductor` | 0 | 0 | 0 |
| `sky` | 5 / 5 | 5k / 3k | 7.3k / 3.1k |
| `terrain` | 4 / 3 | 58k / 12k | 0 |
| `loch` | 3 / 3 | 43k / 0.3k | 0.3k / 1.2k |
| `fire` | 4 / 4 | 2k / 1k | 1.5k / 0.6k |
| `stones` | 2 / 2 | 9k / 3k | 0 |
| `sceach` | 6 / 5 | 15k / 6k | 0.7k / 0.4k |
| `bealach` (T 8–34 only) | 3 / 3 | 2k / 2k | 16k / 6k |
| **Total** | **27 / 25** | **≈134k / 27k** | **≈26k / 11k** |

Draw count check: `eval:(()=>{let n=0;__festival.scene.traverseVisible(o=>{if((o.isMesh||o.isPoints||o.isLine)&&o.material.visible!==false)n++});return n})()` (post-processing passes are core's and not counted).

**Where the frame time actually goes (M1 Air, 2240×1400 at DPR 1.75, MSAA×4 half-float):** post-processing (bloom mips + output + grade) ≈ 4–6 ms is fixed by core. That leaves ≈ 8 ms for the scene, and *fragment* work dominates it. Hence:

- **Full-screen-capable shaders** are only the dome (≤ 1 texture fetch + 1 value-noise octave) and the water (§10.4 budget). The ground shader has no texture fetch and ≤ 6 ripple loops. No other material may run noise loops per fragment over large areas.
- **Additive coverage** at the default camera, summed over flame, sparks, threads, trails, mist and river particles, stays ≤ 25% of the screen; no single additive object covers more than 6% except the veil mist (alpha ≤ 0.18, far half only) and, during return, the column (≤ 8%).
- **Point sizes:** capped at 4 px × dpr (stars, sparks, river), 6 px × dpr only for a star's 1.2 s birth flare.
- **Transparent sorting:** additive layers use `depthWrite:false`, so their order does not matter; nothing in the piece uses normal alpha blending except the HUD (DOM) and alpha-tested foliage (opaque pass).

**Rules:**
- **Bloom:** only fire cores, the narrow cores of gold `torc` accents (×2–2.5, §2.3), star cores, the river and the column exceed the 0.85 threshold. The sky band, water, stones, grass and HUD never do.
- **Aliasing:** the composer has MSAA×4 on high only, so on low use soft gaussian sprites and ≥ 1.6 px minimum star sizes. Threads and loch trails are ≥ 1 px wide **in screen space** by construction.
- **Banding:** dither the dome and water shaders (`+ (hash − 0.5)/255`). The core grain helps too.
- **CPU:** the sum of all `update()` calls stays under 2.5 ms on the M1. No per-frame raycasts except core hover (screen-space projection of 11 stone tops per downbeat is fine). No `new` in `update()`. Click raycasts against the 37k-triangle ground are per click only.
- **Startup:** all modules together finish setup in under 1.5 s on the M1; each canvas/texture and the tree generation stay under 150 ms. Shader compile: avoid more than ~14 distinct programs; prefer one material per module object.
- **Phones (low):** DPR clamp 1.25, no MSAA; target 60 fps on a 2021 mid-range phone, floor 30. If the water or dome shader is the bottleneck on a device, the low path drops the value-noise octave from both (lanes then come from the texture alone).
- **Tab hidden:** nothing special. Core `dt` is clamped, and audio suspends (the music clock pauses with it; visuals keep `state.time`).
- **Console:** zero warnings and zero errors. Custom shaders must compile with no warnings (no unused-varying issues on ANGLE).

### 11.2 Quality rules

- **Scale and restraint:**
  - The fire stays small (≤ 3.2 m) against 3.6 m stones.
  - The loch reflection is at most 0.55× the sky.
  - The Milky Way is soft milk with sharp dark lanes, never a glowing tube.
- **Every particle has a source and a destination** (§1, pillar 1). No ambient floating dust, fireflies or "magic sparkles".
- **Motion is slow and heavy.** The pour takes 8 s. Nothing strobes, and no HDR flash exceeds ×4 except the fire core in return.
- **Motifs stay on their materials:**

  | Motif | Allowed on |
  |---|---|
  | Triple spirals | Loch pecks, the mound entrance stone and kerb |
  | La Tène compass curves | Star arcs, ground ripples, the HUD ornament |
  | Ogham | Stone edges, word ribbons, the HUD stemline |

- **Irish text:** only the strings in §9.3 and the ogham in §6.3 and §10.6. Irish is always typeset smaller than the adjacent Japanese.
- **Tanabata:** mentioned only in the epilogue. The HUD shows no Tanabata imagery, and no tanzaku *paper* exists in the 3D scene. The vertical title column is the only nod.

### 11.3 Don't

1. **No purple, violet, magenta or blue sky, fog or nebula**, and no blue→purple gradient anywhere. `woad` appears only on ribbons.
2. No generic nebula clouds, random particle fields, lens flares, god-ray sprites or glowing "magic circles".
3. No lone neon accent line on black. Gold lines are thin, twisted and textured, and appear only while something rings.
4. No interlace knotwork, shamrocks, harps-as-logos, clovers, leprechaun or pub-uncial lettering, Tolkien-style runes, or fake "Celtic" fonts.
5. No emoji, icon fonts, glassmorphism panels, rounded HUD cards, or serif-on-cream layouts.
6. No stars placed in straight-line "constellation diagrams". Wish stars connect only with compass arcs.
7. Invent no Irish, and no tree-meaning claims beyond the letter names. Do not claim Lughnasa is a "thin veil" night; the veil here is the piece's own fiction.
8. No three.js lights, shadow maps, environment maps, `MeshStandardMaterial` sheen, or external textures, models, audio or fonts beyond Google Fonts.
9. No sound outside the D Dorian pentatonic set for melodic voices, no audio before the first gesture, no autoplay music loops from files.
10. No module may write another module's objects, the camera or controls (except `bealach` while 0 ≤ T < 42), fog, bloom or grade (except `sky`), or `veilTarget` (except `bealach`).
11. No vertical light strands, aurora curtains or light shafts (the rev-1 veil curtain was cut for this reason); the veil shows as low mist, airglow colour and loch colour. The only vertical light in the piece is the milk column of *An Filleadh* (T 26–34), which is textured by the band's dust lanes, not by strands.

---

## Appendix A: Judging scores (1–10)

| Proposal | (i) Celtic-otherworld star-festival specificity | (ii) Visual memorability | (iii) Interaction delight | (iv) 60 fps feasibility on this core | Total |
|---|---|---|---|---|---|
| Myth & ritual (*Bealach na Bó Finne*, rite in three turns) | **9** | 8 | 5 | 5 | 27 |
| Visual spectacle (loch as Otherworld fisheye) | 8 | **9** | 6 | **8** | **31** |
| Interaction, play & sound (*Cláirseach na Réaltaí*) | 8 | 7 | **9** | 6 | 30 |

**Myth & ritual**

| | |
|---|---|
| Strongest | Its lore and the descent choreography. |
| Weaknesses | A linear rite with a state machine that drives the camera. A 120k-particle descent. A 4 Hz equirect sky render target. Sunwise dragging fighting auto-rotate. |
| What we took | The Lughnasa/Tanabata season, the three places of offering, hill beacons, the descent route through mound, portals and fire, the *deiseal* secret, and blossom plus fruit together. |

**Visual spectacle**

| | |
|---|---|
| Strongest | It solved the real constraint: with polar ≥ 55° the camera can never look up, so the sky must come down. Its budget uses no extra render targets. |
| Weaknesses | Interactions are mostly "click → star". |
| What we took | The spine: the loch fisheye with 100× wheeling trails, the islet fire, the pecked triple spiral as an in-scene progress bar, the band standing up as a pillar, dust lanes carried into the river, and the atmosphere ownership model. |

**Interaction, play & sound**

| | |
|---|---|
| Strongest | The most delightful to play. |
| Weaknesses | The "all 8 ringing" goal is fiddly on touch. `controls.enabled` overrides break the core contract. The bowed-tone synthesis is costly. |
| What we took | The stone circle as a harp strung to stars (Cork–Kerry graded stones ascending sunwise), the pentatonic D Dorian rule, ogham as a score, the conductor with beat-quantised answers, the viewer's own notes replayed in the climax, reflection-only stars, the ogham typing secret, and the energy-layered bodhrán and harmony. |

**The single signature moment is *An Bealach*.** All three proposals independently converged on the Milky Way descending as a river, so it is the one event the whole piece builds toward.

---

## Appendix B: Lead checklist (core wiring)

1. `src/palette.js`: the 9 keys in §2.1.
2. `src/config.js`: camera per §3.7, and clear colour, fog, bloom and grade per §2.2.
3. `src/modules/index.js`:
   - `MODULE_ORDER = ['conductor','sky','terrain','loch','fire','stones','sceach','bealach','hud']`
   - Matching `LOADERS`.
   - Remove `_smoke`.
4. `index.html` `<title>`: `白き牛の道 — Bealach na Bó Finne`.
5. Keep auto-rotate speed positive (sunwise).

**Core requests (small additions beyond CORE_CONTRACT.md):**

| ID | Request | Why | Fallback if declined |
|---|---|---|---|
| CR-1 | Portrait camera distance rule (§3.7), applied **before modules load** and on resize when the user has not zoomed. | Keeps loch and fire in frame on phones; `bealach` reads the boot distance at setup. | Modules still work; phones see a cropped loch. |
| CR-2 | Suppress long-press side effects on touch: `#scene { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }` and `canvas.addEventListener('contextmenu', e => e.preventDefault())`. | Every hold interaction (veil, harp, fire, sceach) is a 450 ms+ long-press; iOS/Android otherwise show callouts, selection or a context menu. | Holds are unreliable on phones — no module can fix this, since modules may not touch the page CSS. |
| CR-3 | Add `repeat: e.repeat` to the `key` event payload. | Held Space (veil) and held letters (ogham typing) auto-repeat. | Modules accept every event; typing a held letter repeats it. |

---

## Appendix C: Glossary

Irish words are used only as listed in §9.3.

Rev-2 language check: every form below is standard Modern Irish (or, for *Tír fo Thuinn*, the established literary name) and was kept. Spelling notes that implementers must not "correct": *Oíche Lúnasa* is unlenited because written *l* never takes lenition; *na Bó Finne* is unlenited because an adjective after a feminine genitive singular noun is not lenited. No Old Irish forms are used anywhere. Native-speaker proofreading before release is still required.

| Word | Meaning | Where |
|---|---|---|
| *Bealach na Bó Finne* | "Way of the White Cow", an Irish name for the Milky Way | Title |
| *Oíche Lúnasa* | Lughnasa night (the harvest festival at the start of August) | Subtitle |
| *tine* / *tine chnámh* | Fire / bonfire | Hint, doc |
| *cláirseach* | Harp | Hint |
| *ribín* / *ribíní* | Ribbon / ribbons | Hint, doc |
| *sceach gheal* | Whitethorn (hawthorn) | Doc |
| *tobar* | Well | Doc |
| *réalta* | Star | Toast, portal ogham |
| *loch* | Lake | Toast |
| *aos sí* | People of the mounds | Toast |
| *sí* | Otherworld mound | Doc |
| *deiseal* / *tuathal* | Sunwise / anti-sunwise | Toasts |
| *Tír na nÓg* | Land of the Young (the Otherworld) | Toast |
| *Tír fo Thuinn* | Land under the Wave | Doc only |
| *Tá an bealach oscailte* | "The way is open" | Ending |
| *ceol* | Music | Sound button, h0 |

**Phase names** (internal only, never shown): *An Tost* (the silence), *An Colún* (the column), *An Doirteadh* (the pouring), *An Abhainn* (the river), *An Filleadh* (the return).

**Ogham letters** (names only; no tree-meaning claims shown to viewers): beith ᚁ, luis ᚂ, fearn ᚃ, sail ᚄ, nion ᚅ, uath ᚆ, dair ᚇ, tinne ᚈ, coll ᚉ, ceirt ᚊ, muin ᚋ, gort ᚌ, ngéadal ᚍ, straif ᚎ, ruis ᚏ, ailm ᚐ, onn ᚑ, úr ᚒ, eadhadh ᚓ, iodhadh ᚔ.
