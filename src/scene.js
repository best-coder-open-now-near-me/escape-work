// Everything that touches the PlayCanvas scene graph: engine boot, lighting,
// tile/surface/prop rendering, the occlusion fade, and model loading.
//
// All tile visuals go through ONE renderer (createTileRenderer) used by both
// the game (buildLevel) and the level editor - they draw from the same data
// registries through the same code, so they cannot drift apart.
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

function makeMaterial(rgb, { opacity = 1, gloss = null, emissive = null } = {}) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
  if (gloss !== null) m.gloss = gloss;
  if (opacity < 1) {
    m.opacity = opacity;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
  }
  if (emissive) m.emissive = new pc.Color(emissive[0], emissive[1], emissive[2]);
  m.update();
  return m;
}

// The single source of tile visuals. renderFloor/renderMarker cover every
// tile type the registries define; animate() drives the shared pulsing
// materials (electrified water, fire).
export function createTileRenderer(app) {
  const floorDef = TILE_TYPES.floor;
  const surfaceTop = floorDef.height / 2 + 0.02;

  const tileMats = {};
  for (const [id, def] of Object.entries(TILE_TYPES)) tileMats[id] = makeMaterial(def.color);
  // The exit glows a little - it should read as "the way out" from anywhere.
  tileMats.exit.emissive = new pc.Color(0.4, 0.31, 0.06);
  tileMats.exit.update();
  const wallGhost = makeMaterial(TILE_TYPES.wall.color, { opacity: 0.25 });
  // Full-size slabs with a few near-identical tints: surfaces read as
  // continuous carpet with subtle variation instead of a grid of tiles.
  const floorMats = [-1, 0, 1].map((i) =>
    makeMaterial(TILE_TYPES.floor.color.map((v) => Math.min(1, v + i * 0.018))));

  const surfaceMats = {};
  for (const [id, def] of Object.entries(SURFACES)) {
    surfaceMats[id] = makeMaterial(def.color, { gloss: 0.85, opacity: 0.88 });
  }
  const paperMat = makeMaterial(SURFACES.paper.color, { gloss: 0.2 });
  const electricMat = makeMaterial(ELECTRIFIED.color, { opacity: 0.92, gloss: 0.85, emissive: [0.25, 0.5, 0.65] });
  const fireMat = makeMaterial(FIRE.color, { opacity: 0.92, emissive: [0.9, 0.35, 0.05] });
  const fireCore = makeMaterial([1, 0.8, 0.3], { opacity: 0.95, emissive: [0.95, 0.7, 0.2] });
  const trashMat = makeMaterial(TILE_TYPES.trash.color, { gloss: 0.4 });
  const printerMat = makeMaterial(TILE_TYPES.printer.color, { gloss: 0.5 });
  const printerDark = makeMaterial([0.2, 0.2, 0.24], { gloss: 0.3 });
  const printerLight = makeMaterial([0.3, 0.9, 0.4], { gloss: 0.6, emissive: [0.1, 0.5, 0.15] });

  const addBox = (material, x, y, z, sx, sy, sz) => {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material });
    e.setLocalScale(sx, sy, sz);
    e.setPosition(x, y, z);
    app.root.addChild(e);
    return e;
  };

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

  function renderFloor(x, z) {
    return addBox(floorMats[(x * 31 + z * 17) % 3], x, 0, z, 1, floorDef.height, 1);
  }

  // Edge walls: thin partitions BETWEEN tiles (see grid.js). 'h' sits on the
  // north edge of (x, z), 'v' on the west edge. Slightly overlong so runs and
  // corners merge into continuous walls.
  const EDGE_HEIGHT = 0.72;
  const EDGE_THICK = 0.12;
  function renderEdgeWall(x, z, orient) {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material: tileMats.wall });
    if (orient === 'h') {
      e.setLocalScale(1 + EDGE_THICK, EDGE_HEIGHT, EDGE_THICK);
      e.setPosition(x, EDGE_HEIGHT / 2, z - 0.5);
    } else {
      e.setLocalScale(EDGE_THICK, EDGE_HEIGHT, 1 + EDGE_THICK);
      e.setPosition(x - 0.5, EDGE_HEIGHT / 2, z);
    }
    app.root.addChild(e);
    return e;
  }

  // Draw whatever sits on top of the floor for a non-floor tile type.
  // Returns { kind, entities }; model props arrive via onAsync(holder).
  function renderMarker(x, z, type, { electrified = false, onAsync = null } = {}) {
    const def = TILE_TYPES[type];
    if (!def) return { kind: 'none', entities: [] };
    if (def.model) {
      placeModel(app, `assets/${def.model}.glb`, x, z, {
        scale: def.scale || 1, rotY: def.rotY || 0, lift: floorDef.height / 2,
        onReady: (holder) => onAsync && onAsync(holder),
      });
      return { kind: 'model', entities: [] };
    }
    if (def.primitive) {
      const builder = { trash: addTrash, printer: addPrinter }[def.primitive];
      return { kind: 'prop', entities: builder ? [builder(x, z)] : [] };
    }
    if (def.surface) {
      const surf = SURFACES[def.surface];
      let vis;
      if (surf.style === 'cable') vis = addCable(x, z);
      else if (surf.style === 'paper') vis = addPaper(x, z);
      else vis = addPuddle(x, z, electrified ? electricMat : surfaceMats[def.surface]);
      return { kind: 'surface', entities: [vis] };
    }
    if (def.solid) {
      // Full-size so adjacent walls merge into continuous surfaces.
      return { kind: 'wall', entities: [addBox(tileMats[type], x, def.height / 2, z, 1, def.height, 1)] };
    }
    return { kind: 'marker', entities: [addBox(tileMats[type], x, def.height / 2, z, 1, def.height, 1)] };
  }

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

  // Live water crackles and fire flickers: pulse the shared materials.
  let clock = 0;
  function animate(dt) {
    clock += dt;
    const pulse = 0.45 + 0.35 * Math.sin(clock * 7) + 0.12 * Math.sin(clock * 23);
    electricMat.emissiveIntensity = Math.max(0.15, pulse);
    fireMat.emissiveIntensity = 0.75 + 0.3 * Math.sin(clock * 11) + 0.15 * Math.sin(clock * 29);
    fireCore.emissiveIntensity = 0.85 + 0.25 * Math.sin(clock * 17 + 1);
  }

  return {
    renderFloor, renderMarker, renderEdgeWall, addFlame, explosionFlash, animate,
    tileMats, wallGhost, floorHeight: floorDef.height,
  };
}

// Builds the full scene for a parsed grid using the shared renderer. Returns
// the wall list, the occlusion-fade updater, and runtime hooks.
export function buildLevel(app, grid) {
  const r = createTileRenderer(app);
  const walls = [];
  const surfaceVisuals = new Map(); // "x,z" -> entity
  const propVisuals = new Map();

  for (let z = 0; z < grid.height; z++) {
    for (let x = 0; x < grid.width; x++) {
      const type = grid.typeAt(x, z);
      if (type === null) continue;
      r.renderFloor(x, z);
      if (type === 'floor') continue;
      const res = r.renderMarker(x, z, type, { electrified: grid.isElectrified(x, z) });
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
        w.entity.render.meshInstances[0].material = shouldFade ? r.wallGhost : r.tileMats.wall;
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
    floorHeight: r.floorHeight,
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

// De-chibi the Kenney mini rigs. Every character shares the same 7-bone
// skeleton (root -> leg-left/leg-right + torso -> arm-left/arm-right + head)
// with no knees or elbows, so proportions are retuned by scaling bones:
// legs and torso stretch, the head shrinks back toward realistic. Legs are
// single rigid bones hip-to-foot - keep `legs` modest (~1.3) or the straight
// leg starts to read as stilts when it swings.
const PROPORTIONS = { legs: 1.3, torso: 1.12, head: 0.88 };

export function applyCharacterProportions(holder) {
  const root = holder.findByName('root');
  const legL = holder.findByName('leg-left');
  const legR = holder.findByName('leg-right');
  const torso = holder.findByName('torso');
  if (!root || !legL || !torso) return; // not a rigged mini character
  const { legs, torso: torsoS, head: headS } = PROPORTIONS;
  legL.setLocalScale(1, legs, 1);
  if (legR) legR.setLocalScale(1, legs, 1);
  // Legs stretch downward from the hip joint, so lift the whole rig by the
  // extra leg length to keep the feet on the floor.
  const hipY = legL.getLocalPosition().y;
  const rp = root.getLocalPosition();
  root.setLocalPosition(rp.x, rp.y + hipY * (legs - 1), rp.z);
  torso.setLocalScale(1, torsoS, 1);
  // Torso children inherit its stretch, which would deform them: counter it
  // on the head (shrinking it outright) and on the arms (the rig T-poses, so
  // a Y-stretch would fatten them, not lengthen them). Their attach points
  // still ride up with the taller torso.
  const head = holder.findByName('head');
  if (head) head.setLocalScale(headS, headS / torsoS, headS);
  for (const name of ['arm-left', 'arm-right']) {
    const arm = holder.findByName(name);
    if (arm) arm.setLocalScale(1, 1 / torsoS, 1);
  }
}

// --- combat / impact FX ---------------------------------------------------------
// Purely cosmetic: gameplay resolves instantly, these just make it readable.
let fxMats = null;
function ensureFxMats() {
  if (fxMats) return fxMats;
  fxMats = {
    paper: makeMaterial([0.97, 0.96, 0.9], { gloss: 0.3 }),
    trail: makeMaterial([1, 1, 1], { opacity: 0.4 }),
  };
  return fxMats;
}

// A thrown paper ball ('ball') or airplane ('plane') arcing from one tile to
// another, shedding a fading trail. Fire and forget.
export function throwProjectile(app, from, to, kind = 'ball') {
  const m = ensureFxMats();
  const holder = new pc.Entity('projectile');
  if (kind === 'plane') {
    const spine = new pc.Entity();
    spine.addComponent('render', { type: 'box', material: m.paper });
    spine.setLocalScale(0.06, 0.09, 0.36);
    holder.addChild(spine);
    for (const side of [-1, 1]) {
      const wing = new pc.Entity();
      wing.addComponent('render', { type: 'box', material: m.paper });
      wing.setLocalScale(0.16, 0.02, 0.3);
      wing.setLocalPosition(side * 0.09, 0.03, -0.02);
      wing.setLocalEulerAngles(0, 0, side * 24);
      holder.addChild(wing);
    }
  } else {
    const wad = new pc.Entity();
    wad.addComponent('render', { type: 'sphere', material: m.paper });
    wad.setLocalScale(0.17, 0.15, 0.16);
    holder.addChild(wad);
  }
  app.root.addChild(holder);

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dz) || 1;
  const dur = 0.18 + dist * 0.055;
  const arc = 0.3 + dist * 0.07;
  const yaw = Math.atan2(dx, dz) * pc.math.RAD_TO_DEG;
  const Y = 0.55; // hand height
  const parts = [];
  let t = 0;
  let acc = 0;
  let flying = true;
  const tick = (dt) => {
    if (flying) {
      t += dt;
      const k = Math.min(1, t / dur);
      const y = Y + Math.sin(Math.PI * k) * arc;
      holder.setPosition(from.x + dx * k, y, from.z + dz * k);
      if (kind === 'plane') {
        const vy = (Math.PI / dur) * Math.cos(Math.PI * k) * arc;
        const pitch = Math.atan2(vy, dist / dur) * pc.math.RAD_TO_DEG;
        holder.setEulerAngles(-pitch, yaw, 0);
      } else {
        holder.setEulerAngles(t * 640, yaw, t * 470);
      }
      acc += dt;
      while (acc > 0.024) {
        acc -= 0.024;
        const p = new pc.Entity();
        p.addComponent('render', { type: 'sphere', material: m.trail });
        p.setLocalScale(0.09, 0.09, 0.09);
        p.setPosition(holder.getPosition());
        app.root.addChild(p);
        parts.push({ e: p, life: 0.32 });
      }
      if (k >= 1) {
        flying = false;
        holder.destroy();
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.e.destroy();
        parts.splice(i, 1);
        continue;
      }
      const s = 0.09 * (p.life / 0.32);
      p.e.setLocalScale(s, s, s);
    }
    if (!flying && !parts.length) app.off('update', tick);
  };
  app.on('update', tick);
}

// Floating damage/heal number above a tile. DOM-based so it stays crisp;
// tracks the world position each frame as the camera moves.
export function spawnDamageText(app, cameraEntity, wx, wy, wz, text, color = '#ff8a76') {
  const div = document.createElement('div');
  div.className = 'dmg-pop';
  Object.assign(div.style, {
    position: 'fixed', zIndex: '26', pointerEvents: 'none', left: '-999px',
    font: '800 15px system-ui, sans-serif', color,
    textShadow: '0 1px 4px rgba(0,0,0,.85)', transform: 'translate(-50%, -100%)',
  });
  div.textContent = text;
  document.body.appendChild(div);
  const pos = new pc.Vec3();
  const out = new pc.Vec3();
  let t = 0;
  const tick = (dt) => {
    t += dt;
    const k = t / 0.9;
    if (k >= 1) {
      app.off('update', tick);
      div.remove();
      return;
    }
    pos.set(wx, wy + 0.6 + k * 0.85, wz);
    cameraEntity.camera.worldToScreen(pos, out);
    // worldToScreen works in device pixels; the DOM works in CSS pixels.
    const canvas = app.graphicsDevice.canvas;
    const s = canvas.clientWidth ? canvas.clientWidth / canvas.width : 1;
    div.style.left = out.x * s + 'px';
    div.style.top = out.y * s + 'px';
    div.style.opacity = String(1 - k * k);
  };
  app.on('update', tick);
}
