// Escape Work - code-first PlayCanvas entry point.
//
// A Baldur's Gate / Divinity-style CRPG, reskinned for office life. The whole
// game lives in this repo. This file reads a level (plain JSON you can hand-edit
// in levels/level1.json), draws it as a grid, loads models, and wires up the
// isometric camera + point-and-click controls.
//
// The PlayCanvas engine is loaded separately via a <script> tag in index.html
// (its prebuilt UMD build) which exposes a global `pc`; we only bundle our own
// code + the level data here.
import level from '../levels/level1.json';
import { startCombat } from './combat.js';

const pc = window.pc;

// --- boot the engine ------------------------------------------------------
const canvas = document.getElementById('app');
const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas),
  keyboard: new pc.Keyboard(window),
  graphicsDeviceOptions: { antialias: true, alpha: false },
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());

// Ambient fills the shadows; a directional light gives real shading so imported
// models are actually lit, not black.
app.scene.ambientLight = new pc.Color(0.55, 0.55, 0.62);
const sun = new pc.Entity('sun');
sun.addComponent('light', { type: 'directional', intensity: 1.4 });
sun.setEulerAngles(55, 35, 0);
app.root.addChild(sun);

// --- level -> grid + tiles ------------------------------------------------
const TILE = {
  '#': { color: new pc.Color(0.22, 0.22, 0.30), height: 0.6 }, // wall
  '.': { color: new pc.Color(0.82, 0.82, 0.88), height: 0.2 }, // floor
  '@': { color: new pc.Color(0.30, 0.80, 0.45), height: 0.5 }, // you
  'E': { color: new pc.Color(0.88, 0.32, 0.32), height: 0.5 }, // enemy
  '>': { color: new pc.Color(0.96, 0.80, 0.26), height: 0.3 }, // exit
};
const FLOOR = TILE['.'];

const rows = level.map;
const height = rows.length;
const width = Math.max(...rows.map((r) => r.length));
const cellAt = (x, z) =>
  z >= 0 && z < height && x >= 0 && x < rows[z].length ? rows[z][x] : '#';
// Floor-like cells you can stand on. Walls and the enemy tile block movement.
const isWalkable = (x, z) => '.@>'.includes(cellAt(x, z));

function makeMaterial(color) {
  const m = new pc.StandardMaterial();
  m.diffuse = color;
  m.update();
  return m;
}
const materials = {};
for (const ch of Object.keys(TILE)) materials[ch] = makeMaterial(TILE[ch].color);

// Ghost material for walls that stand between the camera and the player -
// classic CRPG occlusion fade so you never lose sight of your character.
const wallFadeMaterial = makeMaterial(TILE['#'].color);
wallFadeMaterial.opacity = 0.22;
wallFadeMaterial.blendType = pc.BLEND_NORMAL;
wallFadeMaterial.depthWrite = false;
wallFadeMaterial.update();

function addBox(material, x, y, z, sx, sy, sz) {
  const e = new pc.Entity();
  e.addComponent('render', { type: 'box', material });
  e.setLocalScale(sx, sy, sz);
  e.setPosition(x, y, z);
  app.root.addChild(e);
  return e;
}

let playerX = (width - 1) / 2;
let playerZ = (height - 1) / 2;
let enemyX = null;
let enemyZ = null;
const walls = []; // wall entities + tile coords, for the occlusion fade

for (let z = 0; z < height; z++) {
  for (let x = 0; x < rows[z].length; x++) {
    const ch = rows[z][x];
    if (ch === ' ') continue;
    if (ch === '@') { playerX = x; playerZ = z; }
    if (ch === 'E') { enemyX = x; enemyZ = z; }
    addBox(materials['.'], x, 0, z, 0.96, FLOOR.height, 0.96);
    // '@' and 'E' are drawn as character models (below), so skip their markers.
    if (ch !== '.' && ch !== '@' && ch !== 'E' && TILE[ch]) {
      const t = TILE[ch];
      const box = addBox(materials[ch], x, t.height / 2, z, 0.78, t.height, 0.78);
      if (ch === '#') walls.push({ entity: box, x, z, faded: false });
    }
  }
}

// --- models ---------------------------------------------------------------
// Load a .glb, wrap it in a holder (so scaling/rotating is predictable), and
// drop it on a tile. Reusable for every prop and character.
function placeModel(url, tileX, tileZ, { scale = 1, lift = FLOOR.height / 2, rotY = 0, onReady = null } = {}) {
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

// Environment: KayKit office furniture.
placeModel('assets/furniture/desk.glb', 3, 1, { scale: 0.5 });
placeModel('assets/furniture/chair.glb', 2, 1, { scale: 0.55, rotY: 90 });
placeModel('assets/furniture/cabinet.glb', 9, 3, { scale: 0.5 });
placeModel('assets/furniture/plant.glb', 10, 3, { scale: 0.9 });

// Characters: Kenney Mini Characters.
let managerEntity = null;
let enemyAlive = enemyX !== null;
if (enemyX !== null) {
  placeModel('assets/characters/manager.glb', enemyX, enemyZ, {
    scale: 1,
    rotY: -90,
    onReady: (e) => { managerEntity = e; },
  });
}
let player = null;
const playerTile = { x: playerX, z: playerZ };
placeModel('assets/characters/worker.glb', playerX, playerZ, {
  scale: 1,
  rotY: 90,
  onReady: (e) => { player = e; },
});

// --- isometric orbit camera ----------------------------------------------
// A camera rig: camYaw (spins around the focus) -> camPitch (tilts) -> camera
// (sits back at a fixed distance, looking at the focus). Middle-drag turns it,
// the wheel zooms, and it follows the player.
const camYaw = new pc.Entity('camYaw');
const camPitch = new pc.Entity('camPitch');
const cameraEntity = new pc.Entity('camera');
camYaw.addChild(camPitch);
camPitch.addChild(cameraEntity);
app.root.addChild(camYaw);
cameraEntity.addComponent('camera', {
  projection: pc.PROJECTION_ORTHOGRAPHIC,
  clearColor: new pc.Color(0.1, 0.1, 0.15),
  nearClip: 0.1,
  farClip: 1000,
});

const CAM = {
  yaw: 45, pitch: 34, zoom: 6, dist: 60,
  minZoom: 2.5, maxZoom: 11, minPitch: 12, maxPitch: 72,
};
cameraEntity.setLocalPosition(0, 0, CAM.dist);
function applyCamera() {
  camYaw.setLocalEulerAngles(0, CAM.yaw, 0);
  camPitch.setLocalEulerAngles(-CAM.pitch, 0, 0); // negative tilts the camera up-and-over
  cameraEntity.camera.orthoHeight = CAM.zoom;
}
applyCamera();
camYaw.setPosition(playerX, 0.3, playerZ);

// --- input ----------------------------------------------------------------
app.mouse.disableContextMenu(); // we draw our own right-click menu
// Chromium starts autoscroll on middle-press; suppress just the default action
// (preventDefault, not pointerdown, so PlayCanvas still gets the mousedown).
canvas.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });

let orbiting = false;
app.mouse.on(pc.EVENT_MOUSEDOWN, (e) => {
  if (e.button === pc.MOUSEBUTTON_MIDDLE) {
    orbiting = true;
  } else if (e.button === pc.MOUSEBUTTON_LEFT) {
    hideMenu();
    onLeftClick(e.x, e.y);
  } else if (e.button === pc.MOUSEBUTTON_RIGHT) {
    onRightClick(e.x, e.y);
  }
});
app.mouse.on(pc.EVENT_MOUSEUP, (e) => {
  if (e.button === pc.MOUSEBUTTON_MIDDLE) orbiting = false;
});
app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
  if (!orbiting) return;
  CAM.yaw -= e.dx * 0.3;
  CAM.pitch = pc.math.clamp(CAM.pitch + e.dy * 0.3, CAM.minPitch, CAM.maxPitch);
  applyCamera();
});
app.mouse.on(pc.EVENT_MOUSEWHEEL, (e) => {
  CAM.zoom = pc.math.clamp(CAM.zoom - e.wheelDelta * 0.6, CAM.minZoom, CAM.maxZoom);
  applyCamera();
});

// Turn a screen pixel into the grid tile under it (ray from camera -> ground).
const _near = new pc.Vec3();
const _far = new pc.Vec3();
function screenToTile(sx, sy) {
  cameraEntity.camera.screenToWorld(sx, sy, cameraEntity.camera.nearClip, _near);
  cameraEntity.camera.screenToWorld(sx, sy, cameraEntity.camera.farClip, _far);
  const dir = _far.clone().sub(_near);
  if (Math.abs(dir.y) < 1e-6) return null;
  const t = (0 - _near.y) / dir.y; // intersect ground plane y = 0
  if (t < 0) return null;
  const p = _near.add(dir.scale(t));
  return { x: Math.round(p.x), z: Math.round(p.z) };
}

// --- movement + pathfinding ----------------------------------------------
const MOVE_SPEED = 3.5; // tiles per second
let path = null;
let pathIndex = 0;
let lastPath = null; // kept for debugging/tests
let inCombat = false;

// Shortest 8-directional path around walls (Dijkstra: diagonals cost sqrt(2)).
// A diagonal step is only allowed when both adjacent orthogonal tiles are open,
// so the character never clips a wall corner.
const DIRS8 = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
function findPath(sx, sz, tx, tz) {
  if (!isWalkable(tx, tz)) return null;
  const key = (x, z) => x + ',' + z;
  const dist = new Map([[key(sx, sz), 0]]);
  const prev = new Map();
  const open = [[0, sx, sz]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]); // tiny grid; a heap would be overkill
    const [d, x, z] = open.shift();
    if (x === tx && z === tz) break;
    if (d > dist.get(key(x, z))) continue; // stale queue entry
    for (const [dx, dz] of DIRS8) {
      const nx = x + dx;
      const nz = z + dz;
      if (!isWalkable(nx, nz)) continue;
      if (dx !== 0 && dz !== 0 && !(isWalkable(x + dx, z) && isWalkable(x, z + dz))) continue;
      const nd = d + (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1);
      const k = key(nx, nz);
      if (nd < (dist.get(k) ?? Infinity)) {
        dist.set(k, nd);
        prev.set(k, [x, z]);
        open.push([nd, nx, nz]);
      }
    }
  }
  if (!dist.has(key(tx, tz))) return null;
  const out = [];
  let cur = [tx, tz];
  while (cur) {
    out.unshift(cur);
    cur = prev.get(key(cur[0], cur[1])) ?? null;
    if (cur && cur[0] === sx && cur[1] === sz) { out.unshift(cur); break; }
  }
  return out; // includes the start tile at index 0
}

function moveTo(tile) {
  if (!player || !tile || !isWalkable(tile.x, tile.z)) return;
  const p = findPath(playerTile.x, playerTile.z, tile.x, tile.z);
  if (p && p.length > 1) {
    path = p;
    lastPath = p;
    pathIndex = 1; // index 0 is where we already stand
  }
}

// Walk to the open tile nearest the Manager; combat starts on arrival (the
// adjacency check in updateMovement fires it).
function confront() {
  if (!player || !enemyAlive) return;
  let best = null;
  for (const [dx, dz] of DIRS8) {
    const ax = enemyX + dx;
    const az = enemyZ + dz;
    if (!isWalkable(ax, az)) continue;
    const p = findPath(playerTile.x, playerTile.z, ax, az);
    if (p && (!best || p.length < best.length)) best = p;
  }
  if (!best) return;
  if (best.length > 1) {
    path = best;
    lastPath = best;
    pathIndex = 1;
  } else {
    checkCombatTrigger(); // already standing next to them
  }
}

function checkCombatTrigger() {
  if (inCombat || !enemyAlive || !player) return;
  if (Math.abs(playerTile.x - enemyX) <= 1 && Math.abs(playerTile.z - enemyZ) <= 1) {
    path = null;
    inCombat = true;
    hideMenu();
    player.setEulerAngles(0, Math.atan2(enemyX - playerTile.x, enemyZ - playerTile.z) * pc.math.RAD_TO_DEG, 0);
    say('The Manager has noticed you.');
    startCombat({
      enemyName: 'The Manager',
      onWin: () => {
        inCombat = false;
        enemyAlive = false;
        if (managerEntity) managerEntity.destroy();
        // Open up the tile they were guarding.
        rows[enemyZ] = rows[enemyZ].slice(0, enemyX) + '.' + rows[enemyZ].slice(enemyX + 1);
        say('The way is clear. Head for the exit.');
      },
      onLose: () => { inCombat = false; },
    });
  }
}

function onLeftClick(sx, sy) {
  if (inCombat) return;
  const tile = screenToTile(sx, sy);
  if (!tile) return;
  if (enemyAlive && tile.x === enemyX && tile.z === enemyZ) {
    confront();
    return;
  }
  moveTo(tile);
}

function updateMovement(dt) {
  if (!player || !path) return;
  const [tx, tz] = path[pathIndex];
  const pos = player.getPosition();
  const target = new pc.Vec3(tx, pos.y, tz);
  const to = target.clone().sub(pos);
  const dist = to.length();
  const step = MOVE_SPEED * dt;
  if (dist <= step) {
    player.setPosition(target);
    playerTile.x = tx;
    playerTile.z = tz;
    if (++pathIndex >= path.length) {
      path = null;
      if (cellAt(tx, tz) === '>') say('You reach the exit. Freedom smells like the parking garage.');
    }
    checkCombatTrigger();
  } else {
    to.normalize();
    player.setPosition(pos.add(to.scale(step)));
    player.setEulerAngles(0, Math.atan2(to.x, to.z) * pc.math.RAD_TO_DEG, 0);
  }
}

// Fade walls that sit between the camera and the player (CRPG occlusion).
// With an orthographic camera every point looks along the same direction, so
// "toward the camera" is one fixed axis: walk it from the player and fade any
// wall close to that line.
const _fadeDir = new pc.Vec3();
function updateWallFade() {
  if (!player) return;
  const fwd = cameraEntity.forward;
  _fadeDir.set(-fwd.x, 0, -fwd.z).normalize();
  const pos = player.getPosition();
  for (const w of walls) {
    const vx = w.x - pos.x;
    const vz = w.z - pos.z;
    const t = vx * _fadeDir.x + vz * _fadeDir.z;
    const px = vx - t * _fadeDir.x;
    const pz = vz - t * _fadeDir.z;
    const shouldFade = t > 0.3 && Math.hypot(px, pz) < 1.05;
    if (shouldFade !== w.faded) {
      w.faded = shouldFade;
      w.entity.render.meshInstances[0].material = shouldFade ? wallFadeMaterial : materials['#'];
    }
  }
}

// Camera eases toward the player so it stays centred as you move.
function updateCamera() {
  if (!player) return;
  const p = player.getPosition();
  const c = camYaw.getPosition();
  camYaw.setPosition(pc.math.lerp(c.x, p.x, 0.15), 0.3, pc.math.lerp(c.z, p.z, 0.15));
}

app.on('update', (dt) => {
  updateMovement(dt);
  updateCamera();
  updateWallFade();
});

// --- right-click context menu (HTML overlay) -----------------------------
let menuEl = null;
function ensureMenu() {
  if (menuEl) return menuEl;
  menuEl = document.createElement('div');
  menuEl.id = 'context-menu';
  Object.assign(menuEl.style, {
    position: 'fixed', zIndex: '20', minWidth: '170px', display: 'none',
    background: '#232334', color: '#f0f0f5', border: '1px solid #3a3a52',
    borderRadius: '7px', padding: '5px', boxShadow: '0 8px 24px rgba(0,0,0,.45)',
    font: '13px system-ui, sans-serif', userSelect: 'none',
  });
  document.body.appendChild(menuEl);
  return menuEl;
}
function showMenu(x, y, items) {
  const el = ensureMenu();
  el.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.textContent = it.label;
    Object.assign(row.style, { padding: '7px 11px', borderRadius: '5px', cursor: 'pointer' });
    row.onmouseenter = () => { row.style.background = '#34344f'; };
    row.onmouseleave = () => { row.style.background = 'transparent'; };
    row.onclick = () => { hideMenu(); it.action && it.action(); };
    el.appendChild(row);
  }
  el.style.left = Math.min(x, window.innerWidth - 190) + 'px';
  el.style.top = Math.min(y, window.innerHeight - items.length * 34 - 12) + 'px';
  el.style.display = 'block';
}
function hideMenu() { if (menuEl) menuEl.style.display = 'none'; }
// A left-press outside the menu closes it. Right-presses are ignored here so the
// very click that opens the menu doesn't also close it (and so a right-click
// elsewhere just repositions it).
window.addEventListener('mousedown', (e) => {
  if (e.button === 0 && menuEl && !menuEl.contains(e.target)) hideMenu();
});

function say(text) {
  const el = document.getElementById('subtitle');
  if (el) el.textContent = text;
}

// Context-sensitive actions, office-CRPG flavoured.
function onRightClick(sx, sy) {
  if (inCombat) return;
  const tile = screenToTile(sx, sy);
  if (!tile) return;
  if (enemyAlive && tile.x === enemyX && tile.z === enemyZ) {
    showMenu(sx, sy, [
      { label: 'Confront the Manager', action: () => confront() },
      { label: 'Avoid eye contact', action: () => say('You study your shoes intently.') },
      { label: 'Examine', action: () => say('The Manager: radiates unread-email energy.') },
    ]);
  } else if (isWalkable(tile.x, tile.z)) {
    showMenu(sx, sy, [
      { label: 'Walk here', action: () => moveTo(tile) },
      { label: 'Examine', action: () => say('Standard-issue office carpet. Faintly damp.') },
    ]);
  } else {
    showMenu(sx, sy, [
      { label: 'Examine', action: () => say('A cubicle wall. It has seen things.') },
    ]);
  }
}

// --- HUD ------------------------------------------------------------------
say(level.name || '');

// Small read-only handle for tests and console poking.
window.__game = {
  get playerTile() { return { ...playerTile }; },
  get inCombat() { return inCombat; },
  get enemyAlive() { return enemyAlive; },
  get lastPath() { return lastPath; },
  get fadedWallCount() { return walls.filter((w) => w.faded).length; },
};

app.start();
