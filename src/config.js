// Core tuning knobs (camera, fog, post). Values follow docs/DESIGN.md §2.2 and §3.7.
const DEG = Math.PI / 180;

export const CONFIG = {
  camera: {
    fov: 50,
    near: 0.1,
    far: 3000,
    position: [5.34, 6.57, 25.12], // distance 26, polar 81°, azimuth +12°
    target: [0, 2.5, 0],
    minDistance: 12,
    maxDistance: 60,
    minPolarAngle: 55 * DEG,
    maxPolarAngle: 87 * DEG,
    autoRotateSpeed: 0.3, // positive = sunwise (deiseal)
    // The Milky Way only shows on the northern half of the orbit, so the sunwise drift
    // lingers where the band composes and hurries across the empty southern sky.
    // Always positive: anti-sunwise (tuathal) would be unlucky.
    autoRotateDwell: { slow: 0.15, fast: 0.62, centerDeg: 12 },
    idleResumeSeconds: 6,
    // Never let the camera dive under the turf: zooming out to the north puts it inside the
    // 10 m sí mound, which renders as a black frame the viewer cannot get out of.
    minGroundClearance: 2.2,
    // Portrait rule (CR-1): distance = clamp(26 * 0.85 / aspect, 26, 48) when aspect < 1.
    // Tall screens: pull back, and raise the look-at so the sky (the protagonist) takes the
    // extra height instead of the empty foreground meadow. targetY lerps 2.5 → 5.2 as aspect 1 → 0.5.
    portrait: { base: 26, factor: 0.85, max: 48, targetY: 5.2, targetYAspect: 0.5 },
  },
  clearColor: 0x080d0c,
  fog: { color: 0x0e1511, density: 0.0022 },
  bloom: { strength: 0.75, radius: 0.5, threshold: 0.85 },
  // Boot values; `sky` writes tint (raw sRGB bytes) and lift every frame (§2.3).
  // Lift 0.6 matches sky's resting value so subsets without `sky` still read correctly.
  grade: { vignette: 0.4, grain: 0.03, lift: 0.6, tint: 0x0a1310 },
  smoothing: { energy: 1.2, veil: 0.6 },
  dpr: { high: 1.75, low: 1.25 },
  // Drawing-buffer area caps. The composer holds two half-float buffers (multisampled on the
  // high path), so a big window on a Retina display can ask for hundreds of MB of VRAM and lose
  // the GL context. Above maxBufferPixels the pixel ratio drops; above msaaPixelLimit MSAA halves.
  maxBufferPixels: 4.5e6,
  msaaPixelLimit: 3.3e6,
};
