// Scene assembly: engine boot + lighting, and building the full level scene
// from a parsed grid. The look (toon bands, outlines, post) lives in
// shading.js, tile visuals in tile-renderer.js, model loading in models.js,
// combat FX in fx.js.
import { TILE_TYPES } from './data/tiles.js';
import { createTileRenderer, computeCarpetZones } from './tile-renderer.js';

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
// the wall list, the occlusion-fade updater, and runtime hooks.
export function buildLevel(app, grid) {
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
      const res = r.renderMarker(x, z, type, {
        electrified: grid.isElectrified(x, z),
        surfaceAt: (sx, sz) => TILE_TYPES[grid.typeAt(sx, sz)]?.surface || null,
      });
      if (res.kind === 'wall') walls.push({ entity: res.entities[0], x, z, faded: false });
      else if (res.kind === 'surface') surfaceVisuals.set(x + ',' + z, res.entities[0]);
      else if (res.kind === 'prop') propVisuals.set(x + ',' + z, res.entities[0]);
    }
  }
  // Edge walls (partitions between tiles) join the same fade list, keyed by
  // their world-space centre.
  for (const k of grid.hWalls) {
    const [x, z] = k.split(',').map(Number);
    walls.push({ entity: r.renderEdgeWall(x, z, 'h'), x, z: z - 0.5, faded: false });
  }
  for (const k of grid.vWalls) {
    const [x, z] = k.split(',').map(Number);
    walls.push({ entity: r.renderEdgeWall(x, z, 'v'), x: x - 0.5, z, faded: false });
  }

  // Doors: rendered from grid state and re-rendered whenever one toggles.
  // Their panel joins the fade list with door materials.
  const doorVisuals = new Map(); // door key -> { holder, wallEntry }
  function renderDoorAt(key) {
    const old = doorVisuals.get(key);
    if (old) {
      old.holder.destroy();
      walls.splice(walls.indexOf(old.wallEntry), 1);
    }
    const [orient, coords] = [key[0], key.slice(2)];
    const [x, z] = coords.split(',').map(Number);
    const { holder, panel } = r.renderDoor(x, z, orient, grid.doors.get(key).open);
    const wallEntry = {
      entity: panel,
      x: orient === 'v' ? x - 0.5 : x,
      z: orient === 'h' ? z - 0.5 : z,
      faded: false,
      solidMat: r.doorMat,
      ghostMat: r.doorGhost,
    };
    walls.push(wallEntry);
    doorVisuals.set(key, { holder, wallEntry });
  }
  for (const key of grid.doors.keys()) renderDoorAt(key);

  // Fade walls sitting between the camera and the player - the "toward the
  // camera" direction is the actual player->camera ray.
  function updateWallFade(cameraEntity, playerPos) {
    if (!playerPos) return;
    const cam = cameraEntity.getPosition();
    let dx = cam.x - playerPos.x;
    let dz = cam.z - playerPos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    for (const w of walls) {
      const vx = w.x - playerPos.x;
      const vz = w.z - playerPos.z;
      const t = vx * dx + vz * dz;
      const px = vx - t * dx;
      const pz = vz - t * dz;
      const shouldFade = t > 0.3 && Math.hypot(px, pz) < 1.15;
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
    hideSurfaceVisual, removePropVisual,
    refreshDoor: renderDoorAt,
    floorHeight: r.floorHeight,
  };
}
