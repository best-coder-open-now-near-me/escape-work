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

  // Ambient fills the shadows; a shadow-casting sun grounds everything and
  // gives imported PBR models real shading.
  app.scene.ambientLight = new pc.Color(0.56, 0.56, 0.62);
  const sun = new pc.Entity('sun');
  sun.addComponent('light', {
    type: 'directional',
    intensity: 1.25,
    castShadows: true,
    shadowResolution: 2048,
    shadowDistance: 70,
    shadowBias: 0.2,
    normalOffsetBias: 0.06,
  });
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
  // The exit glows a little - it should read as "the way out" from anywhere.
  materials.exit.emissive = new pc.Color(0.4, 0.31, 0.06);
  materials.exit.update();
  const wallGhost = makeMaterial(TILE_TYPES.wall.color, { opacity: 0.25 });
  const floorDef = TILE_TYPES.floor;
  // Full-size slabs with a few near-identical tints: surfaces read as
  // continuous carpet with subtle variation instead of a grid of tiles.
  const floorMats = [-1, 0, 1].map((i) => {
    const c = TILE_TYPES.floor.color.map((v) => Math.min(1, v + i * 0.018));
    return makeMaterial(c);
  });

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
      // Every cell gets a seamless floor slab; non-floor types get a marker
      // box (or a prop model) on top.
      addBox(floorMats[(x * 31 + z * 17) % 3], x, 0, z, 1, floorDef.height, 1);
      if (type !== 'floor') {
        const def = TILE_TYPES[type];
        if (def.model) {
          placeModel(app, `assets/${def.model}.glb`, x, z, {
            scale: def.scale || 1, rotY: def.rotY || 0, lift: floorDef.height / 2,
          });
        } else if (def.solid) {
          // Full-size so adjacent walls merge into continuous surfaces.
          const box = addBox(materials[type], x, def.height / 2, z, 1, def.height, 1);
          walls.push({ entity: box, x, z, faded: false });
        } else {
          addBox(materials[type], x, def.height / 2, z, 1, def.height, 1);
        }
      }
    }
  }

  // Fade walls sitting between the camera and the player. With a perspective
  // camera the "toward the camera" direction is the actual player->camera ray.
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
        w.entity.render.meshInstances[0].material = shouldFade ? wallGhost : materials.wall;
      }
    }
  }

  return { walls, updateWallFade, floorHeight: floorDef.height };
}

// Load a .glb, wrap it in a holder (so scaling/rotating is predictable), and
// drop it on a tile. Reusable for every prop and character.
export function placeModel(app, url, tileX, tileZ, { scale = 1, lift = 0.1, rotY = 0, onReady = null } = {}) {
  // Reuse the asset if this .glb was already requested (props repeat a lot,
  // and the editor repaints cells constantly).
  let asset = app.assets.find(url);
  if (!asset) {
    asset = new pc.Asset(url, 'container', { url });
    app.assets.add(asset);
  }
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
