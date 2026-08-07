// Optional visual packs. Gameplay registries keep their stable model ids;
// an art profile swaps only the files and presentation values behind them.
// This keeps licensed binaries out of source control and makes every swap
// reversible without rewriting a class, tile, save, or level document.
export const ART_PROFILES = Object.freeze({
  default: Object.freeze({
    label: 'Built-in art',
    assets: Object.freeze([]),
    characters: Object.freeze({}),
    characterAccessories: Object.freeze({}),
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
      { from: 'characters/generic-business-female.glb', to: 'characters/synty/generic-business-female.glb' },
      { from: 'characters/generic-business-male.glb', to: 'characters/synty/generic-business-male.glb' },
      { from: 'characters/shops-clerk-female.glb', to: 'characters/synty/shops-clerk-female.glb' },
      { from: 'characters/shops-clerk-male.glb', to: 'characters/synty/shops-clerk-male.glb' },
      { from: 'characters/shops-worker-female.glb', to: 'characters/synty/shops-worker-female.glb' },
      { from: 'characters/shops-worker-male.glb', to: 'characters/synty/shops-worker-male.glb' },
      { from: 'characters/hair/generic-short-04.glb', to: 'characters/synty/hair/generic-short-04.glb' },
      { from: 'characters/hair/generic-side-06.glb', to: 'characters/synty/hair/generic-side-06.glb' },
      { from: 'characters/hair/shops-short-01.glb', to: 'characters/synty/hair/shops-short-01.glb' },
      { from: 'characters/hair/shops-messy-01.glb', to: 'characters/synty/hair/shops-messy-01.glb' },
      { from: 'characters/hair/shops-long-01.glb', to: 'characters/synty/hair/shops-long-01.glb' },
      { from: 'characters/hair/shops-ponytail-01.glb', to: 'characters/synty/hair/shops-ponytail-01.glb' },
      { from: 'office/chair.glb', to: 'synty/office/chair.glb' },
      { from: 'office/desk.glb', to: 'synty/office/desk.glb' },
      { from: 'office/plant.glb', to: 'synty/office/plant.glb' },
      { from: 'office/printer.glb', to: 'synty/office/printer.glb' },
      { from: 'office/waste-bin.glb', to: 'synty/office/waste-bin.glb' },
    ]),
    characters: Object.freeze({
      worker: 'synty/generic-business-male',
      midmanager: 'synty/generic-business-female',
      mailroom: 'synty/shops-worker-male',
      itsupport: 'synty/shops-clerk-male',
      hrrep: 'synty/shops-clerk-female',
      security: 'synty/shops-worker-female',
    }),
    // Synty bodies and hairstyles are separate meshes. The hair GLBs are
    // deliberately tiny and attach to the animated Head bone at runtime, so
    // one body can keep its full clip set without baking six duplicate wigs
    // into it. `scale: 100` bridges the FBX's metre-sized attachment geometry
    // into the centimetre-authored bone hierarchy inside the exported rigs.
    characterAccessories: Object.freeze({
      'synty/generic-business-male': Object.freeze({ model: 'synty/hair/generic-short-04', color: [0.08, 0.035, 0.018], scale: 100 }),
      'synty/generic-business-female': Object.freeze({ model: 'synty/hair/generic-side-06', color: [0.34, 0.30, 0.26], scale: 100 }),
      'synty/shops-worker-male': Object.freeze({ model: 'synty/hair/shops-short-01', color: [0.20, 0.09, 0.035], scale: 100 }),
      'synty/shops-clerk-male': Object.freeze({ model: 'synty/hair/shops-messy-01', color: [0.055, 0.025, 0.015], scale: 100 }),
      'synty/shops-clerk-female': Object.freeze({ model: 'synty/hair/shops-long-01', color: [0.30, 0.10, 0.035], scale: 100 }),
      'synty/shops-worker-female': Object.freeze({ model: 'synty/hair/shops-ponytail-01', color: [0.70, 0.48, 0.13], scale: 100 }),
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

export function characterAccessory(model, profileId = ACTIVE_ART_PROFILE) {
  return ART_PROFILES[profileId]?.characterAccessories?.[model] || null;
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
