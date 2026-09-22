// Load order matters: later modules may read ctx.world fields registered by earlier ones (docs/DESIGN.md §10.0).
// Explicit loader map (not a template-string import) so esbuild inlines every module in the build,
// while dev mode still imports lazily — a broken module never blocks `?only=` checks of the others.
export const MODULE_ORDER = ['conductor', 'sky', 'terrain', 'loch', 'fire', 'stones', 'sceach', 'bealach', 'hud'];

export const LOADERS = {
  conductor: () => import('./conductor.js'),
  sky: () => import('./sky.js'),
  terrain: () => import('./terrain.js'),
  loch: () => import('./loch.js'),
  fire: () => import('./fire.js'),
  stones: () => import('./stones.js'),
  sceach: () => import('./sceach.js'),
  bealach: () => import('./bealach.js'),
  hud: () => import('./hud.js'),
};
