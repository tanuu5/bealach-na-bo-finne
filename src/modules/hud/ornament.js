// hud/ornament.js — the one piece of ornament the HUD is allowed (docs/DESIGN.md §9.2, §11.2).
//
// La Tène compass-drawn trumpet curves, 72×14, 1 px `torc` stroke at 60% opacity.
//
// Construction — a running trumpet-scroll with 180° rotational symmetry about (36, 7), which is
// how insular metalwork actually turns a border: it rotates, it does not mirror. Nothing else is
// in here — no interlace, no knotwork, no shamrock (§11.3 #4).
//
//   • Two compass roundels (r 1.7) sit on the axis at x = 25.5 and x = 46.5. Every curve in the
//     piece is born on a roundel or dies in a cusp; nothing floats.
//   • Left lobe: two arcs leave a fine cusp at (4, 8.2) — the trumpet terminal — and land on the
//     first roundel 2 apart. The void between them is pinched shut at the cusp and flares open
//     into the roundel: that flare is the trumpet's mouth, and it is what separates this from a
//     leaf shape.
//   • Right lobe is exactly (x, y) → (72 − x, 14 − y) of the left one, so its void opens below
//     the axis while the left one opens above.
//   • Centre: a lens strung between the two roundels, its two arcs likewise a rotation of each
//     other, tying the scroll together.
export const ORNAMENT_SVG = `<svg class="bf-ornament" viewBox="0 0 72 14" width="72" height="14" aria-hidden="true" focusable="false">
<g fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
<path d="M4 8.2C8 2.2 19 1.4 24.35 5.75"/>
<path d="M4 8.2C10 8.8 18 8.8 23.95 7.78"/>
<path d="M68 5.8C64 11.8 53 12.6 47.65 8.25"/>
<path d="M68 5.8C62 5.2 54 5.2 48.05 6.22"/>
<path d="M27.1 6.6C32 4.4 41 4.9 44.9 7.4"/>
<path d="M44.9 7.4C40 9.6 31 9.1 27.1 6.6"/>
<circle cx="25.5" cy="7" r="1.7"/>
<circle cx="46.5" cy="7" r="1.7"/>
</g>
<g fill="currentColor" stroke="none">
<circle cx="4" cy="8.2" r="0.55"/>
<circle cx="68" cy="5.8" r="0.55"/>
</g>
</svg>`;
