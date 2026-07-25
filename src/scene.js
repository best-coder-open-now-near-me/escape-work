// Scene assembly: engine boot + lighting, and building the full level scene
// from a parsed grid. The look (toon bands, outlines, post) lives in
// shading.js, tile visuals in tile-renderer.js, model loading in models.js,
// combat FX in fx.js.
import { TILE_TYPES } from './data/tiles.js';
import { createTileRenderer, computeCarpetZones } from './tile-renderer.js';
import { occludes } from './occlusion.js';

const pc = window.pc;

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
export function buildLevel(app, grid, { picking = null } = {}) {
  const r = createTileRenderer(app);
  const walls = [];
  const surfaceVisuals = new Map(); // "x,z" -> entity
  const propVisuals = new Map();

  const carpetAt = computeCarpetZones(grid.typeAt, grid.width, grid.height);

  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const type = grid.typeAt(x, z);
      if (type === null) continue;
      r.renderFloor(x, z, carpetAt.get(x + ',' + z) || type);
      if (type === 'floor') continue;
      // Rummageable / ignitable / explosive props are left-clickable and
      // hover-highlightable: register their holder for object picking. Model
      // props (desks) load async, so catch them via onAsync too.
      const def = TILE_TYPES[type];
      const interactive = !!def && (def.loot || def.ignitable || def.explosive);
      const res = r.renderMarker(x, z, type, {
        electrified: grid.isElectrified(x, z),
        surfaceAt: (sx, sz) => TILE_TYPES[grid.typeAt(sx, sz)]?.surface || null,
        onAsync: interactive && picking ? (holder) => picking.register(holder, 'prop', { x, z }) : null,
      });
      // `top` is the world Y of the wall's top face - the fade test needs it to
      // know whether the sightline clears this wall (see occlusion.js). A solid
      // tile's box is centred at def.height / 2 and def.height tall.
      if (res.kind === 'wall') walls.push({ entity: res.entities[0], x, z, top: def.height, faded: false });
      else if (res.kind === 'surface') surfaceVisuals.set(x + ',' + z, res.entities[0]);
      else if (res.kind === 'prop') {
        propVisuals.set(x + ',' + z, res.entities[0]);
        if (interactive && picking) picking.register(res.entities[0], 'prop', { x, z });
      }
    }
  }
  // Edge walls (partitions between tiles) join the same fade list, keyed by
  // their world-space centre.
  for (const k of grid.hWalls) {
    const [x, z] = k.split(',').map(Number);
    walls.push({ entity: r.renderEdgeWall(x, z, 'h'), x, z: z - 0.5, top: r.edgeWallTop, faded: false });
  }
  for (const k of grid.vWalls) {
    const [x, z] = k.split(',').map(Number);
    walls.push({ entity: r.renderEdgeWall(x, z, 'v'), x: x - 0.5, z, top: r.edgeWallTop, faded: false });
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
    picking?.register(holder, 'door', key);
    const wallEntry = {
      entity: panel,
      x: orient === 'v' ? x - 0.5 : x,
      z: orient === 'h' ? z - 0.5 : z,
      top: r.doorTop,
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
    const feet = { x: playerPos.x, y: r.floorHeight / 2, z: playerPos.z };
    for (const w of walls) {
      const shouldFade = occludes(w, cam, feet);
      if (shouldFade !== w.faded) {
        w.faded = shouldFade;
        w.entity.render.meshInstances[0].material = shouldFade
          ? (w.ghostMat || r.wallGhost)
          : (w.solidMat || r.tileMats.wall);
      }
    }
  }

  function hideSurfaceVisual(x, z) {
    const v = surfaceVisuals.get(x + ',' + z);
    if (v) {
      v.destroy();
      surfaceVisuals.delete(x + ',' + z);
    }
  }
  // Surfaces created at runtime (Bulk Mail leaving paper drifts). Registered
  // in surfaceVisuals so fire can consume them like any painted surface.
  function addSurfaceVisual(x, z, type) {
    hideSurfaceVisual(x, z);
    const res = r.renderMarker(x, z, type, {
      electrified: grid.isElectrified(x, z),
      surfaceAt: (sx, sz) => TILE_TYPES[grid.typeAt(sx, sz)]?.surface || null,
    });
    if (res.kind === 'surface') surfaceVisuals.set(x + ',' + z, res.entities[0]);
  }
  function removePropVisual(x, z) {
    const v = propVisuals.get(x + ',' + z);
    if (v) {
      v.destroy();
      propVisuals.delete(x + ',' + z);
    }
  }

  return {
    walls, updateWallFade, animateSurfaces: r.animate,
    addFlame: r.addFlame, explosionFlash: r.explosionFlash,
    addSmoke: r.addSmoke, removeSmoke: r.removeSmoke,
    hideSurfaceVisual, addSurfaceVisual, removePropVisual,
    refreshDoor: renderDoorAt,
    floorHeight: r.floorHeight,
  };
}
