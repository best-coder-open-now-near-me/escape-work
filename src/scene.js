// Scene assembly: engine boot + lighting, and building the full level scene
// from a parsed grid. The look (toon bands, outlines, post) lives in
// shading.js, tile visuals in tile-renderer.js, model loading in models.js,
// combat FX in fx.js.
import { TILE_TYPES } from './data/tiles.js';
import { createTileRenderer, computeCarpetZones } from './tile-renderer.js';
import { occludes } from './occlusion.js';

// `globalThis.window?.pc` rather than `window.pc`: the bare read runs at IMPORT
// time and throws under node, which is what kept this module - and anything
// importing it - out of the unit suite. Nothing here touches `pc` at module
// scope, so deferring the failure to first USE costs nothing and buys the file
// an import. Same treatment as actors.js/models.js/shading.js already carry.
const pc = globalThis.window?.pc;

// The fade transition must return each solid to the material it arrived with;
// a custom solid is not necessarily a cubicle wall. Kept pure so the material
// identity contract is testable without PlayCanvas.
export const wallFadeMaterial = (wall, faded) => (faded ? wall.ghostMat : wall.solidMat);

export function createApp(canvas) {
  const app = new pc.Application(canvas, {
    mouse: new pc.Mouse(canvas),
    keyboard: new pc.Keyboard(window),
    graphicsDeviceOptions: { antialias: true, alpha: false },
  });
  app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  window.addEventListener('resize', () => app.resizeCanvas());

  // Office lighting, split across two directionals: an angled key light does
  // the shading (toon bands need side/top contrast) but casts NO shadows,
  // while a near-vertical "ceiling" light owns the shadows - overhead office
  // lights pool shadows at your feet, they don't rake them across the carpet
  // like a sunset. Ambient stays low and slightly cool for band contrast.
  app.scene.ambientLight = new pc.Color(0.44, 0.46, 0.56);
  const key = new pc.Entity('key-light');
  key.addComponent('light', { type: 'directional', intensity: 1.0, castShadows: false });
  key.setEulerAngles(55, 35, 0);
  app.root.addChild(key);
  const ceiling = new pc.Entity('ceiling-light');
  ceiling.addComponent('light', {
    type: 'directional',
    intensity: 0.5,
    castShadows: true,
    shadowResolution: 2048,
    shadowDistance: 70,
    shadowBias: 0.2,
    normalOffsetBias: 0.06,
  });
  ceiling.setEulerAngles(84, 35, 0);
  app.root.addChild(ceiling);
  return app;
}

// Builds the full scene for a parsed grid using the shared renderer. Returns
// the wall list, the occlusion-fade updater, and runtime hooks. `picking`
// (optional) is the object-picker registrar (src/picking.js): doors and
// interactable props register their holder entities so a click on the tall
// mesh resolves to the object, not the floor behind it.
export function buildLevel(app, grid, { picking = null, root = null, baseY = 0 } = {}) {
  const r = createTileRenderer(app, { root, baseY });
  const walls = [];
  const surfaceVisuals = new Map(); // fine-cell "ix,iz" -> entity
  const propVisuals = new Map();
  // Everything else `renderMarker` hands back. The two filers below only ever
  // kept `wall`, `surface` and `prop`, so the other two kinds were rendered
  // and then forgotten: a `marker` (the toppled partition's floor slab, every
  // `onFloor` remnant) and the FOLIAGE a model prop wears. Forgotten means
  // `removePropVisual` cannot reach them, so `refreshTile` drew the new mesh
  // on top of the old one and a plant that had been toppled kept its leaves.
  // A tile may own several (a model's holder is filed in propVisuals, its
  // leaves here), so this one is keyed to a LIST.
  const extraVisuals = new Map(); // "x,z" -> entity[]
  const trackExtra = (x, z, entities) => {
    if (!entities?.length) return;
    const key = x + ',' + z;
    const list = extraVisuals.get(key) || [];
    for (const e of entities) if (e) list.push(e);
    if (list.length) extraVisuals.set(key, list);
  };

  const carpetAt = computeCarpetZones(grid.typeAt, grid.width, grid.height);

  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const type = grid.typeAt(x, z);
      if (type === null) continue;
      r.renderFloor(x, z, carpetAt.get(x + ',' + z) || type);
      if (type === 'floor') continue;
      if (type === 'exit') r.addExitBeacon(x, z); // motes rising off the stairwell
      // Rummageable / shoppable / ignitable / explosive props are left-clickable
      // and hover-highlightable: register their holder for object picking. Model
      // props (desks) load async, so catch them via onAsync too.
      const def = TILE_TYPES[type];
      // A stair cell's flight is drawn by the layered builder below, which
      // knows the run's direction and rise; here it is just floor under it.
      if (def.stairs) continue;
      const interactive = !!def && (def.loot || def.shop || def.ignitable || def.explosive);
      const res = r.renderMarker(x, z, type, {
        electrified: grid.isElectrified(x, z),
        rotY: grid.rotAt?.(x, z) ?? null,
        surfaceAt: grid.surfaceAt,
        // A model prop's holder only exists once its .glb lands, so this is the
        // one moment it is offered. Track it exactly like a primitive prop's
        // visual: `removePropVisual` is otherwise a silent no-op for it, and
        // ARCHITECTURE.md's growth path promises a new prop is pure DATA - so
        // the first model prop given `explosive: true` would have had its grid
        // cell cleared to walkable floor with the mesh still standing on it,
        // still registered for picking.
        onAsync: (holder) => {
          propVisuals.set(x + ',' + z, holder);
          if (interactive && picking) picking.register(holder, 'prop', { x, z });
        },
      });
      // `top` is the world Y of the wall's top face - the fade test needs it to
      // know whether the sightline clears this wall (see occlusion.js). A solid
      // tile's box is centred at def.height / 2 and def.height tall.
      if (res.kind === 'wall') {
        walls.push({
          entity: res.entities[0], x, z, top: baseY + def.height, faded: false,
          // Preserve this tile type's own opaque material across a fade. The
          // generic wall material is only correct for the `wall` tile.
          solidMat: res.entities[0].render.meshInstances[0].material,
          ghostMat: r.wallGhost,
        });
      }
      else if (res.kind === 'surface') surfaceVisuals.set(x + ',' + z, res.entities[0]);
      else if (res.kind === 'prop') {
        propVisuals.set(x + ',' + z, res.entities[0]);
        if (interactive && picking) picking.register(res.entities[0], 'prop', { x, z });
      } else trackExtra(x, z, res.entities);
    }
  }
  // SurfaceField is already seeded when scene construction starts. Draw it
  // after terrain/props so surface-only authored tiles (normalized to floor)
  // do not need to masquerade as terrain to get a visual.
  renderAllSurfaces();
  grid.surfaceField.onChange(renderAllSurfaces);
  // Edge walls (partitions between tiles) join the same fade list, keyed by
  // their world-space centre - and by their grid key, so a toppled partition
  // (TACTICS_PLAN M6) can find its own mesh to retire.
  const edgeWallVisuals = new Map(); // 'h:x,z' | 'v:x,z' -> wallEntry
  const addEdgeWall = (k, orient) => {
    const [x, z] = k.split(',').map(Number);
    const entry = orient === 'h'
      ? { entity: r.renderEdgeWall(x, z, 'h'), x, z: z - 0.5, top: baseY + r.edgeWallTop, faded: false,
        solidMat: r.tileMats.wall, ghostMat: r.wallGhost }
      : { entity: r.renderEdgeWall(x, z, 'v'), x: x - 0.5, z, top: baseY + r.edgeWallTop, faded: false,
        solidMat: r.tileMats.wall, ghostMat: r.wallGhost };
    walls.push(entry);
    edgeWallVisuals.set(orient + ':' + k, entry);
  };
  for (const k of grid.hWalls) addEdgeWall(k, 'h');
  for (const k of grid.vWalls) addEdgeWall(k, 'v');
  // A partition went over: its mesh leaves the world and the fade list, the
  // same retirement a re-rendered door already performs.
  function removeEdgeWall(orient, k) {
    const entry = edgeWallVisuals.get(orient + ':' + k);
    if (!entry) return;
    edgeWallVisuals.delete(orient + ':' + k);
    damagedEdges.delete(orient + ':' + k);
    entry.entity.destroy();
    const i = walls.indexOf(entry);
    if (i >= 0) walls.splice(i, 1);
  }

  // Doors: rendered from grid state and re-rendered whenever one toggles.
  // Their panel joins the fade list with door materials.
  const doorVisuals = new Map(); // door key -> { holder, wallEntry }
  function renderDoorAt(key) {
    const old = doorVisuals.get(key);
    if (old) {
      picking?.unregister(old.holder);
      old.holder.destroy();
      walls.splice(walls.indexOf(old.wallEntry), 1);
    }
    const [orient, coords] = [key[0], key.slice(2)];
    const [x, z] = coords.split(',').map(Number);
    const { holder, panel } = r.renderDoor(x, z, orient, grid.doors.get(key).open);
    // Doors use their visible, rotated mesh bounds rather than a padded or
    // world-aligned proxy: a click must be directly on the panel or hardware.
    picking?.register(holder, 'door', key, { precise: true });
    const wallEntry = {
      entity: panel,
      x: orient === 'v' ? x - 0.5 : x,
      z: orient === 'h' ? z - 0.5 : z,
      top: baseY + r.doorTop,
      faded: false,
      solidMat: r.doorMat,
      ghostMat: r.doorGhost,
    };
    walls.push(wallEntry);
    doorVisuals.set(key, { holder, wallEntry });
  }
  for (const key of grid.doors.keys()) renderDoorAt(key);

  // Ghost the walls that genuinely stand between the camera and the character.
  // The test is 3D and lives in occlusion.js - a flat "is it that way?" check
  // ghosted walls the sightline had long since risen above, which at the
  // default steep pitch meant most of the room.
  function updateWallFade(cameraEntity, playerPos) {
    if (!playerPos) return;
    const cam = cameraEntity.getPosition();
    // The character's feet sit on the floor's top face; the sightline is
    // anchored there, so a wall counts when it covers any part of the body.
    // The entity's own Y IS that height - on a flat level it equals the old
    // floorHeight / 2 constant, and on a layered one it carries the storey.
    const feet = { x: playerPos.x, y: playerPos.y, z: playerPos.z };
    for (const w of walls) {
      const shouldFade = occludes(w, cam, feet);
      if (shouldFade !== w.faded) {
        w.faded = shouldFade;
        w.entity.render.meshInstances[0].material = wallFadeMaterial(w, shouldFade);
      }
    }
  }

  function renderAllSurfaces() {
    for (const visual of surfaceVisuals.values()) visual.destroy();
    surfaceVisuals.clear();
    for (const cell of grid.surfaceField.entries()) {
      const res = r.renderSurfaceCell(cell, grid.surfaceField, {
        electrified: grid.isElectrified(cell.x, cell.z),
      });
      if (res.kind === 'surface') {
        surfaceVisuals.set(grid.surfaceField.keyOf(cell.ix, cell.iz), res.entities[0]);
      }
    }
  }
  function hideSurfaceVisual(x, z) {
    const cellsPerTile = grid.surfaceField.cellsPerTile;
    for (const [key, visual] of [...surfaceVisuals]) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.floor(ix / cellsPerTile) !== x || Math.floor(iz / cellsPerTile) !== z) continue;
      visual.destroy();
      surfaceVisuals.delete(key);
    }
  }
  // Surfaces created at runtime (Bulk Mail leaving paper drifts). Registered
  // in surfaceVisuals so fire can consume them like any painted surface.
  function addSurfaceVisual(x, z, type) {
    renderAllSurfaces();
  }
  function removePropVisual(x, z) {
    const v = propVisuals.get(x + ',' + z);
    if (v) {
      v.destroy();
      propVisuals.delete(x + ',' + z);
    }
    const extras = extraVisuals.get(x + ',' + z);
    if (extras) {
      for (const e of extras) e.destroy();
      extraVisuals.delete(x + ',' + z);
    }
  }

  // The damaged TELL (TACTICS_PLAN M8): a wounded prop sits visibly askew -
  // knocked a few degrees off true - because the HP pool is hidden by design
  // and a barrier that is half gone must not look factory-fresh. Additive
  // rotation on the holder (rotateLocal), so a model's authored rotY/tilt
  // survives; the sets keep it one nudge per object however many hits land.
  // State dies with the visual: refreshTile rebuilds straight, which is right
  // - a tile that changed TYPE starts a fresh pool (grid.setType).
  const damagedProps = new Set();
  const damagedEdges = new Set();
  function markPropDamaged(x, z) {
    const key = x + ',' + z;
    if (damagedProps.has(key)) return;
    const v = propVisuals.get(key);
    if (!v) return;
    damagedProps.add(key);
    v.rotateLocal(2, 9, 3);
  }
  function markEdgeDamaged(orient, k) {
    const key = orient + ':' + k;
    if (damagedEdges.has(key)) return;
    const entry = edgeWallVisuals.get(key);
    if (!entry) return;
    damagedEdges.add(key);
    entry.entity.rotateLocal(4, 0, orient === 'h' ? 2 : -2);
  }

  // Re-render whatever this cell has BECOME (POWERS_PLAN M6). The two existing
  // mutators each know one shape - removePropVisual only deletes,
  // addSurfaceVisual only keeps a `surface` result and drops a model's async
  // holder on the floor untracked - and toppling turns a model prop into a
  // different model prop, which neither could express. This is the general
  // case they were both special cases of: drop what was there, render the
  // current type, and file the result the same way the initial pass does.
  function refreshTile(x, z) {
    removePropVisual(x, z);
    hideSurfaceVisual(x, z);
    damagedProps.delete(x + ',' + z); // rebuilt straight; a new pool leans anew
    const type = grid.typeAt(x, z);
    if (type === null) return;
    r.renderFloor(x, z, carpetAt.get(x + ',' + z) || type);
    if (type === 'floor') return;
    const def = TILE_TYPES[type];
    const interactive = !!def && (def.loot || def.shop || def.ignitable || def.explosive);
    const res = r.renderMarker(x, z, type, {
      electrified: grid.isElectrified(x, z),
      rotY: grid.rotAt?.(x, z) ?? null,
      surfaceAt: grid.surfaceAt,
      onAsync: (holder) => {
        propVisuals.set(x + ',' + z, holder);
        if (interactive && picking) picking.register(holder, 'prop', { x, z });
      },
    });
    if (res.kind === 'surface') surfaceVisuals.set(x + ',' + z, res.entities[0]);
    else if (res.kind === 'prop') {
      propVisuals.set(x + ',' + z, res.entities[0]);
      if (interactive && picking) picking.register(res.entities[0], 'prop', { x, z });
    } else trackExtra(x, z, res.entities);
  }

  return {
    walls, updateWallFade, animateSurfaces: r.animate, renderStair: r.renderStair,
    addFlame: r.addFlame, explosionFlash: r.explosionFlash,
    addSmoke: r.addSmoke, removeSmoke: r.removeSmoke,
    hideSurfaceVisual, addSurfaceVisual, removePropVisual, refreshTile,
    refreshDoor: renderDoorAt, removeEdgeWall, markPropDamaged, markEdgeDamaged,
    floorHeight: r.floorHeight,
  };
}

// A layered level's scene (EDITOR_PLAN feasibility spike): one buildLevel per
// storey, each under its own root entity at its own base height, plus the
// generated stair flights. Returns the same surface main.js reads off a flat
// scene, with per-cell hooks dispatched to the ACTIVE storey (the leader's),
// and two extras: `updateCutaway` and `layerVisible`.
export function buildLayeredLevel(app, floors, { picking = null } = {}) {
  const roots = [];
  const scenes = [];
  floors.layers.forEach((g, i) => {
    const root = new pc.Entity('storey-' + i);
    app.root.addChild(root);
    roots.push(root);
    scenes.push(buildLevel(app, g, { picking, root, baseY: floors.baseY[i] }));
  });
  // Stair flights render through the LOWER storey's renderer, so a hidden
  // upper floor still leaves the way up standing in the world. Every slice
  // registers with the object picker: the flight RISES, so a click on its
  // upper half projects onto a ground plane somewhere behind it - the ray
  // must hit the boxes themselves, or clicks sail straight through the
  // stairs (the spike playtest's first finding, designer 2026-08-01).
  for (const s of floors.stairs) {
    const rise = floors.baseY[s.upper] - floors.baseY[s.layer];
    s.cells.forEach((c, idx) => {
      const slices = scenes[s.layer].renderStair(c.x, c.z, s.dir.dx, s.dir.dz, rise, idx, s.cells.length);
      if (picking) for (const e of slices) picking.register(e, 'stair', s);
    });
  }
  let active = 0;
  const activeScene = () => scenes[active];
  const facade = {
    // The cutaway: a storey above the leader hides only while it actually
    // covers them (`covers(l)`) - out in the atrium the whole multi-storey
    // space reads; duck under the mezzanine and its floor gets out of the
    // way. X-COM hides everything above, BG3 peels on occlusion; this is the
    // cheapest rule that keeps the tall-lobby look, and it is the spike's
    // main "tweak the look" dial.
    updateCutaway(activeLayer, covers) {
      active = activeLayer;
      roots.forEach((r, i) => { r.enabled = i <= activeLayer || !covers(i); });
    },
    layerVisible: (l) => roots[l].enabled,
    // A scripted climb pins both of its storeys visible for the whole ride;
    // the per-frame covering test stands down until the landing (the spike
    // playtest's second finding: re-judging "covered" mid-flight popped the
    // upper floor out and back as the body crossed the slab's edge).
    holdForClimb(a, b) {
      roots[a].enabled = true;
      roots[b].enabled = true;
    },
    // The fade list the flat destructure reads; layered fading runs per
    // visible storey through updateWallFade below.
    walls: scenes[0].walls,
    updateWallFade(cameraEntity, playerPos) {
      for (let i = 0; i < scenes.length; i++) {
        if (roots[i].enabled) scenes[i].updateWallFade(cameraEntity, playerPos);
      }
    },
    animateSurfaces(dt) { for (const s of scenes) s.animateSurfaces(dt); },
    floorHeight: scenes[0].floorHeight,
  };
  // Cell-keyed runtime hooks follow the leader's storey, like the grid facade.
  for (const m of ['addFlame', 'explosionFlash', 'addSmoke', 'removeSmoke', 'hideSurfaceVisual',
    'addSurfaceVisual', 'removePropVisual', 'refreshTile', 'refreshDoor', 'removeEdgeWall',
    'markPropDamaged', 'markEdgeDamaged']) {
    facade[m] = (...args) => activeScene()[m](...args);
  }
  return facade;
}
