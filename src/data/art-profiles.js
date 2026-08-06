// Optional visual packs. Gameplay registries keep their stable model ids;
// an art profile swaps only the files and presentation values behind them.
// This keeps licensed binaries out of source control and makes every swap
// reversible without rewriting a class, tile, save, or level document.
export const ART_PROFILES = Object.freeze({
  default: Object.freeze({
    label: 'Built-in art',
    assets: Object.freeze([]),
    characters: Object.freeze({}),
    tiles: Object.freeze({}),
  }),

  synty: Object.freeze({
    label: 'Synty office integration',
    sourceEnv: 'ESCAPE_WORK_SYNTY_SOURCE',
    defaultSource: 'assets/licensed/synty',
    // Build-time allowlist. Only these converted runtime files cross from the
    // private source tree into build/web; previews and ordinary builds select
    // the default profile and copy none of them.
    assets: Object.freeze([
      { from: 'characters/generic-business-male.glb', to: 'characters/synty/generic-business-male.glb' },
      { from: 'office/chair.glb', to: 'synty/office/chair.glb' },
      { from: 'office/desk.glb', to: 'synty/office/desk.glb' },
      { from: 'office/plant.glb', to: 'synty/office/plant.glb' },
      { from: 'office/printer.glb', to: 'synty/office/printer.glb' },
      { from: 'office/waste-bin.glb', to: 'synty/office/waste-bin.glb' },
    ]),
    characters: Object.freeze({
      worker: 'synty/generic-business-male',
    }),
    tiles: Object.freeze({
      chair: Object.freeze({ model: 'synty/office/chair', scale: 0.9, rotY: 0 }),
      desk: Object.freeze({ model: 'synty/office/desk', scale: 0.5, rotY: 0 }),
      plant: Object.freeze({ model: 'synty/office/plant', scale: 0.65, rotY: 0 }),
      printer: Object.freeze({ model: 'synty/office/printer', primitive: null, scale: 1, rotY: 0 }),
      trash: Object.freeze({ model: 'synty/office/waste-bin', primitive: null, scale: 0.65, rotY: 0 }),
      trashcan: Object.freeze({ model: 'synty/office/waste-bin', scale: 1, rotY: 0 }),
    }),
  }),
});

export const ACTIVE_ART_PROFILE = (
  typeof __ESCAPE_WORK_ART_PROFILE__ === 'string'
  && ART_PROFILES[__ESCAPE_WORK_ART_PROFILE__]
)
  ? __ESCAPE_WORK_ART_PROFILE__
  : 'default';

export function characterArt(model, profileId = ACTIVE_ART_PROFILE) {
  return ART_PROFILES[profileId]?.characters?.[model] || model;
}

// Only presentation keys cross this seam. An art profile cannot accidentally
// change collision, cover, loot, damage, or any other gameplay behavior.
const TILE_VISUAL_KEYS = ['model', 'primitive', 'scale', 'rotY', 'tiltX', 'tiltZ', 'foliage'];
export function tileArt(type, def, profileId = ACTIVE_ART_PROFILE) {
  const override = ART_PROFILES[profileId]?.tiles?.[type];
  if (!override) return def;
  const visual = { ...def };
  for (const key of TILE_VISUAL_KEYS) {
    if (!(key in override)) continue;
    if (override[key] == null) delete visual[key];
    else visual[key] = override[key];
  }
  return visual;
}
