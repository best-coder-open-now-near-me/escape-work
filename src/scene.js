// Everything that touches the PlayCanvas scene graph: engine boot, lighting,
// tile/wall meshes, the occlusion fade, and model loading. Game logic lives
// elsewhere and talks to this through plain data.
import { TILE_TYPES } from './data/tiles.js';

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

  // Ambient fills the shadows; a directional light gives real shading so
  // imported PBR models are actually lit, not black.
  app.scene.ambientLight = new pc.Color(0.55, 0.55, 0.62);
  const sun = new pc.Entity('sun');
  sun.addComponent('light', { type: 'directional', intensity: 1.4 });
  sun.setEulerAngles(55, 35, 0);
  app.root.addChild(sun);
  return app;
}

function makeMaterial(rgb, { opacity = 1 } = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
  if (opacity < 1) {
    m.opacity = opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
  }
  m.update();
  return m;
}

// Builds the tile meshes for a parsed grid. Returns the wall list plus the
// occlusion-fade updater (walls between the camera and the player go ghostly).
export function buildLevel(app, grid) {
  const materials = {};
  for (const [id, def] of Object.entries(TILE_TYPES)) materials[id] = makeMaterial(def.color);
  const wallGhost = makeMaterial(TILE_TYPES.wall.color, { opacity: 0.22 });
  const floorDef = TILE_TYPES.floor;

  const addBox = (material, x, y, z, sx, sy, sz) => {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material });
    e.setLocalScale(sx, sy, sz);
    e.setPosition(x, y, z);
    app.root.addChild(e);
    return e;
  };

  const walls = [];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const type = grid.typeAt(x, z);
      if (type === null) continue;
      // Every cell gets a floor slab; non-floor types get a marker box on top.
      addBox(materials.floor, x, 0, z, 0.96, floorDef.height, 0.96);
      if (type !== 'floor') {
        const def = TILE_TYPES[type];
        const box = addBox(materials[type], x, def.height / 2, z, def.solid ? 0.78 : 0.8, def.height, def.solid ? 0.78 : 0.8);
        if (def.solid) walls.push({ entity: box, x, z, faded: false });
      }
    }
  }

  // With an orthographic camera every point looks along the same direction, so
  // "toward the camera" is one fixed axis: walk it from the player and fade
  // any solid tile close to that line.
  const _fadeDir = new pc.Vec3();
  function updateWallFade(cameraEntity, playerPos) {
    if (!playerPos) return;
    const fwd = cameraEntity.forward;
    _fadeDir.set(-fwd.x, 0, -fwd.z).normalize();
    for (const w of walls) {
      const vx = w.x - playerPos.x;
      const vz = w.z - playerPos.z;
      const t = vx * _fadeDir.x + vz * _fadeDir.z;
      const px = vx - t * _fadeDir.x;
      const pz = vz - t * _fadeDir.z;
      const shouldFade = t > 0.3 && Math.hypot(px, pz) < 1.05;
      if (shouldFade !== w.faded) {
        w.faded = shouldFade;
        w.entity.render.meshInstances[0].material = shouldFade ? wallGhost : materials.wall;
      }
    }
  }

  return { walls, updateWallFade, floorHeight: floorDef.height };
}

// Load a .glb, wrap it in a holder (so scaling/rotating is predictable), and
// drop it on a tile. Reusable for every prop and character.
export function placeModel(app, url, tileX, tileZ, { scale = 1, lift = 0.1, rotY = 0, onReady = null } = {}) {
  const asset = new pc.Asset(url, 'container', { url });
  app.assets.add(asset);
  asset.ready(() => {
    const holder = new pc.Entity(url);
    holder.addChild(asset.resource.instantiateRenderEntity());
    holder.setLocalScale(scale, scale, scale);
    holder.setEulerAngles(0, rotY, 0);
    holder.setPosition(tileX, lift, tileZ);
    app.root.addChild(holder);
    if (onReady) onReady(holder);
  });
  asset.on('error', (err) => console.warn('asset load failed:', url, err));
  app.assets.load(asset);
}
