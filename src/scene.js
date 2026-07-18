// Everything that touches the PlayCanvas scene graph: engine boot, lighting,
// tile/wall meshes, the occlusion fade, and model loading. Game logic lives
// elsewhere and talks to this through plain data.
import { TILE_TYPES } from './data/tiles.js';
import { SURFACES, ELECTRIFIED, FIRE } from './data/surfaces.js';

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

  // Surface materials. All electrified pools share one pulsing material.
  const surfaceMat = (rgb, { gloss = 0.85, opacity = 0.88, emissive = null } = {}) => {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
    m.gloss = gloss;
    m.opacity = opacity;
    m.blendType = pc.BLEND_NORMAL;
    if (emissive) m.emissive = new pc.Color(emissive[0], emissive[1], emissive[2]);
    m.update();
    return m;
  };
  const surfaceMats = {};
  for (const [id, def] of Object.entries(SURFACES)) surfaceMats[id] = surfaceMat(def.color);
  const electricMat = surfaceMat(ELECTRIFIED.color, {
    opacity: 0.92, emissive: [0.25, 0.5, 0.65],
  });

  const surfaceTop = floorDef.height / 2 + 0.02;
  // Registries so runtime systems can remove visuals (burning paper, exploded
  // printers).
  const surfaceVisuals = new Map(); // "x,z" -> entity
  const propVisuals = new Map();
  // Irregular overlapping blobs so spills read as liquid, not tiles. Rotated
  // per-cell so no two puddles look alike.
  function addPuddle(x, z, material) {
    const holder = new pc.Entity();
    for (const [ox, oz, sx, sz] of [[0, 0, 0.85, 0.62], [0.17, -0.15, 0.5, 0.44], [-0.2, 0.14, 0.42, 0.5]]) {
      const e = new pc.Entity();
      e.addComponent('render', { type: 'cylinder', material });
      e.setLocalScale(sx, 0.045, sz);
      e.setLocalPosition(ox, 0, oz);
      holder.addChild(e);
    }
    holder.setEulerAngles(0, ((x * 73 + z * 131) % 8) * 45, 0);
    holder.setPosition(x, surfaceTop, z);
    app.root.addChild(holder);
    return holder;
  }
  // Scattered sheets: thin pale rectangles at odd angles.
  const paperMat = surfaceMat(SURFACES.paper.color, { gloss: 0.2, opacity: 1 });
  function addPaper(x, z) {
    const holder = new pc.Entity();
    for (const [ox, oz, ry, s] of [[0, 0, 15, 0.42], [0.2, 0.16, 70, 0.34], [-0.18, -0.1, 40, 0.3], [-0.05, 0.22, 110, 0.28]]) {
      const e = new pc.Entity();
      e.addComponent('render', { type: 'box', material: paperMat });
      e.setLocalScale(s, 0.02, s * 0.72);
      e.setLocalPosition(ox, 0, oz);
      e.setLocalEulerAngles(0, ry, 0);
      holder.addChild(e);
    }
    holder.setEulerAngles(0, ((x * 61 + z * 89) % 8) * 45, 0);
    holder.setPosition(x, surfaceTop, z);
    app.root.addChild(holder);
    return holder;
  }
  // Props built from primitives - no .glb needed.
  const trashMat = surfaceMat(TILE_TYPES.trash.color, { gloss: 0.4, opacity: 1 });
  function addTrash(x, z) {
    const holder = new pc.Entity();
    const can = new pc.Entity();
    can.addComponent('render', { type: 'cylinder', material: trashMat });
    can.setLocalScale(0.44, 0.5, 0.44);
    can.setLocalPosition(0, 0.25, 0);
    holder.addChild(can);
    const rim = new pc.Entity();
    rim.addComponent('render', { type: 'cylinder', material: trashMat });
    rim.setLocalScale(0.5, 0.05, 0.5);
    rim.setLocalPosition(0, 0.5, 0);
    holder.addChild(rim);
    holder.setPosition(x, floorDef.height / 2, z);
    app.root.addChild(holder);
    return holder;
  }
  const printerMat = surfaceMat(TILE_TYPES.printer.color, { gloss: 0.5, opacity: 1 });
  const printerDark = surfaceMat([0.2, 0.2, 0.24], { gloss: 0.3, opacity: 1 });
  const printerLight = surfaceMat([0.3, 0.9, 0.4], { gloss: 0.6, opacity: 1, emissive: [0.1, 0.5, 0.15] });
  function addPrinter(x, z) {
    const holder = new pc.Entity();
    const body = new pc.Entity();
    body.addComponent('render', { type: 'box', material: printerMat });
    body.setLocalScale(0.66, 0.4, 0.52);
    body.setLocalPosition(0, 0.2, 0);
    holder.addChild(body);
    const tray = new pc.Entity();
    tray.addComponent('render', { type: 'box', material: printerDark });
    tray.setLocalScale(0.5, 0.06, 0.3);
    tray.setLocalPosition(0, 0.44, -0.05);
    holder.addChild(tray);
    const light = new pc.Entity();
    light.addComponent('render', { type: 'box', material: printerLight });
    light.setLocalScale(0.07, 0.05, 0.05);
    light.setLocalPosition(0.24, 0.34, 0.27);
    holder.addChild(light);
    holder.setEulerAngles(0, ((x * 37 + z * 71) % 4) * 90, 0);
    holder.setPosition(x, floorDef.height / 2, z);
    app.root.addChild(holder);
    return holder;
  }

  // A frayed power strip: dark bar plus a glowing live end.
  function addCable(x, z) {
    const holder = new pc.Entity();
    const bar = new pc.Entity();
    bar.addComponent('render', { type: 'box', material: surfaceMats.cable });
    bar.setLocalScale(0.85, 0.07, 0.2);
    holder.addChild(bar);
    const tip = new pc.Entity();
    tip.addComponent('render', { type: 'box', material: electricMat });
    tip.setLocalScale(0.14, 0.09, 0.14);
    tip.setLocalPosition(0.38, 0.01, 0);
    holder.addChild(tip);
    holder.setEulerAngles(0, ((x * 53 + z * 97) % 4) * 45 + 20, 0);
    holder.setPosition(x, surfaceTop, z);
    app.root.addChild(holder);
    return holder;
  }

  const walls = [];
  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const type = grid.typeAt(x, z);
      if (type === null) continue;
      // Every cell gets a seamless floor slab; non-floor types get a marker
      // box, a prop model, or a surface visual on top.
      addBox(floorMats[(x * 31 + z * 17) % 3], x, 0, z, 1, floorDef.height, 1);
      if (type !== 'floor') {
        const def = TILE_TYPES[type];
        if (def.model) {
          placeModel(app, `assets/${def.model}.glb`, x, z, {
            scale: def.scale || 1, rotY: def.rotY || 0, lift: floorDef.height / 2,
          });
        } else if (def.primitive) {
          const builder = { trash: addTrash, printer: addPrinter }[def.primitive];
          if (builder) propVisuals.set(x + ',' + z, builder(x, z));
        } else if (def.surface) {
          const surf = SURFACES[def.surface];
          let vis;
          if (surf.style === 'cable') vis = addCable(x, z);
          else if (surf.style === 'paper') vis = addPaper(x, z);
          else vis = addPuddle(x, z, grid.isElectrified(x, z) ? electricMat : surfaceMats[def.surface]);
          surfaceVisuals.set(x + ',' + z, vis);
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

  // Fire: shared flickering material; addFlame is handed to the surface
  // runtime so burning cells get visuals.
  const fireMat = surfaceMat(FIRE.color, { opacity: 0.92, emissive: [0.9, 0.35, 0.05] });
  const fireCore = surfaceMat([1, 0.8, 0.3], { opacity: 0.95, emissive: [0.95, 0.7, 0.2] });
  function addFlame(x, z, lift = 0.16) {
    const holder = new pc.Entity();
    const outer = new pc.Entity();
    outer.addComponent('render', { type: 'cone', material: fireMat });
    outer.setLocalScale(0.5, 0.62, 0.5);
    outer.setLocalPosition(0, 0.3, 0);
    holder.addChild(outer);
    const inner = new pc.Entity();
    inner.addComponent('render', { type: 'cone', material: fireCore });
    inner.setLocalScale(0.26, 0.42, 0.26);
    inner.setLocalPosition(0.04, 0.24, 0.03);
    holder.addChild(inner);
    holder.setPosition(x, floorDef.height / 2 + lift, z);
    app.root.addChild(holder);
    return holder;
  }

  // A brief expanding toner-cloud boom.
  function explosionFlash(x, z) {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'sphere', material: fireCore });
    e.setPosition(x, 0.5, z);
    app.root.addChild(e);
    let t = 0;
    const anim = (dt) => {
      t += dt;
      const s = 0.4 + t * 6;
      e.setLocalScale(s, s, s);
      if (t > 0.45) {
        app.off('update', anim);
        e.destroy();
      }
    };
    app.on('update', anim);
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

  // Live water crackles and fire flickers: pulse the shared materials.
  let surfaceClock = 0;
  function animateSurfaces(dt) {
    surfaceClock += dt;
    const pulse = 0.45 + 0.35 * Math.sin(surfaceClock * 7) + 0.12 * Math.sin(surfaceClock * 23);
    electricMat.emissiveIntensity = Math.max(0.15, pulse);
    fireMat.emissiveIntensity = 0.75 + 0.3 * Math.sin(surfaceClock * 11) + 0.15 * Math.sin(surfaceClock * 29);
    fireCore.emissiveIntensity = 0.85 + 0.25 * Math.sin(surfaceClock * 17 + 1);
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

  return {
    walls, updateWallFade, animateSurfaces,
    addFlame, explosionFlash, hideSurfaceVisual, removePropVisual,
    floorHeight: floorDef.height,
  };
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
