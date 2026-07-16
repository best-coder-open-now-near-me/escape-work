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
// Terrain vs. dynamic blockers: '@' and 'E' tiles are ordinary floor - what
// blocks you is the living enemy standing there (enemies move, and dead ones
// stop blocking).
const terrainOpen = (x, z) => '.@>E'.includes(cellAt(x, z));
const enemyAt = (x, z) => enemies.find((e) => e.alive && e.x === x && e.z === z) || null;
const isWalkable = (x, z) => terrainOpen(x, z) && !enemyAt(x, z);

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
const walls = []; // wall entities + tile coords, for the occlusion fade
// Every 'E' tile becomes an enemy; level.enemies supplies name/model/stats in
// reading order (top-to-bottom, left-to-right).
const enemies = [];

for (let z = 0; z < height; z++) {
  for (let x = 0; x < rows[z].length; x++) {
    const ch = rows[z][x];
    if (ch === ' ') continue;
    if (ch === '@') { playerX = x; playerZ = z; }
    if (ch === 'E') {
      const meta = (level.enemies || [])[enemies.length] || {};
      enemies.push({
        x, z, spawnX: x, spawnZ: z, alive: true, entity: null,
        name: meta.name || 'Coworker',
        model: meta.model || 'manager',
        hp: meta.hp || 12,
        xp: meta.xp || 6,
        examine: meta.examine || 'A coworker. Best not to make eye contact.',
      });
    }
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
for (const en of enemies) {
  placeModel(`assets/characters/${en.model}.glb`, en.x, en.z, {
    scale: 1,
    rotY: -90,
    onReady: (e) => { en.entity = e; },
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
// Keep wheel events inside the game: without this the browser (or the itch.io
// page hosting the iframe) scrolls instead of zooming.
canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

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
  // Scroll up (away from you) zooms in - wheelDelta is negative for scroll-up,
  // so adding it shrinks the ortho height.
  CAM.zoom = pc.math.clamp(CAM.zoom + e.wheelDelta * 0.6, CAM.minZoom, CAM.maxZoom);
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
let gameOver = false;

// The persistent character sheet. Combat mutates hp in place, so wounds carry
// between fights; levelling up heals and adds damage.
const playerState = { hp: 22, maxHp: 22, level: 1, xp: 0, xpNext: 10, bonusDmg: 0 };

function updateStatsHud() {
  const el = document.getElementById('stats');
  if (el) el.textContent = `Lv ${playerState.level} · HP ${playerState.hp}/${playerState.maxHp} · XP ${playerState.xp}/${playerState.xpNext}`;
}

function gainXp(amount) {
  playerState.xp += amount;
  let promoted = false;
  while (playerState.xp >= playerState.xpNext) {
    playerState.xp -= playerState.xpNext;
    playerState.xpNext = Math.round(playerState.xpNext * 1.5);
    playerState.level += 1;
    playerState.bonusDmg += 1;
    playerState.hp = playerState.maxHp;
    promoted = true;
  }
  say(promoted
    ? `Promotion! Level ${playerState.level}: fully rested, +1 damage.`
    : `+${amount} XP.`);
  updateStatsHud();
}

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

// Walk to the open tile nearest an enemy; combat starts on arrival (the
// adjacency check in updateMovement fires it).
function confront(en) {
  if (!player || !en || !en.alive) return;
  let best = null;
  for (const [dx, dz] of DIRS8) {
    const ax = en.x + dx;
    const az = en.z + dz;
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

function adjacentEnemy() {
  return enemies.find((e) =>
    e.alive && Math.abs(playerTile.x - e.x) <= 1 && Math.abs(playerTile.z - e.z) <= 1) || null;
}

function checkCombatTrigger() {
  if (inCombat || gameOver || !player) return;
  const en = adjacentEnemy();
  if (!en) return;
  path = null;
  inCombat = true;
  hideMenu();
  player.setEulerAngles(0, Math.atan2(en.x - playerTile.x, en.z - playerTile.z) * pc.math.RAD_TO_DEG, 0);
  if (en.entity) {
    en.entity.setEulerAngles(0, Math.atan2(playerTile.x - en.x, playerTile.z - en.z) * pc.math.RAD_TO_DEG, 0);
  }
  say(`${en.name} has noticed you.`);
  startCombat({
    enemyName: en.name,
    enemyHp: en.hp,
    playerState,
    onChange: updateStatsHud,
    onWin: () => {
      inCombat = false;
      en.alive = false;
      if (en.entity) en.entity.destroy();
      // A breather after every victory, so back-to-back fights aren't a death
      // spiral - wounds still carry over, just less brutally.
      playerState.hp = Math.min(playerState.maxHp, playerState.hp + 5);
      gainXp(en.xp);
    },
    onLose: () => { inCombat = false; gameOver = true; },
  });
}

function onLeftClick(sx, sy) {
  if (inCombat || gameOver) return;
  const tile = screenToTile(sx, sy);
  if (!tile) return;
  const en = enemyAt(tile.x, tile.z);
  if (en) {
    confront(en);
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
      if (cellAt(tx, tz) === '>') showWinScreen();
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

// --- enemy AI ---------------------------------------------------------------
// Enemies wander: every couple of seconds each may step to a random adjacent
// open tile, leashed near their spawn so they patrol their own area. If one
// ends up next to you, they engage. Their models slide smoothly to their tile.
const WANDER_INTERVAL = 1.8;
const WANDER_LEASH = 2;
const ENEMY_SPEED = 2.2;
let wanderTimer = WANDER_INTERVAL;

function updateEnemies(dt) {
  for (const en of enemies) {
    if (!en.alive || !en.entity) continue;
    const pos = en.entity.getPosition();
    const target = new pc.Vec3(en.x, pos.y, en.z);
    const to = target.clone().sub(pos);
    const d = to.length();
    if (d > 0.001) {
      const step = ENEMY_SPEED * dt;
      if (d <= step) {
        en.entity.setPosition(target);
      } else {
        to.normalize();
        en.entity.setPosition(pos.add(to.scale(step)));
        en.entity.setEulerAngles(0, Math.atan2(to.x, to.z) * pc.math.RAD_TO_DEG, 0);
      }
    }
  }
  if (inCombat || gameOver) return; // the world holds its breath during a fight
  wanderTimer -= dt;
  if (wanderTimer > 0) return;
  wanderTimer = WANDER_INTERVAL;
  for (const en of enemies) {
    if (!en.alive || !en.entity) continue;
    if (Math.random() < 0.45) continue; // sometimes they just stand around
    const options = DIRS8.filter(([dx, dz]) => {
      const nx = en.x + dx;
      const nz = en.z + dz;
      if (Math.abs(nx - en.spawnX) > WANDER_LEASH || Math.abs(nz - en.spawnZ) > WANDER_LEASH) return false;
      if (dx !== 0 && dz !== 0 && !(terrainOpen(en.x + dx, en.z) && terrainOpen(en.x, en.z + dz))) return false;
      if (!isWalkable(nx, nz)) return false;
      if (nx === playerTile.x && nz === playerTile.z) return false;
      return true;
    });
    if (!options.length) continue;
    const [dx, dz] = options[Math.floor(Math.random() * options.length)];
    en.x += dx;
    en.z += dz;
  }
  checkCombatTrigger(); // did anyone just corner the player?
}

// --- win screen -------------------------------------------------------------
function showWinScreen() {
  if (gameOver) return;
  gameOver = true;
  path = null;
  const defeated = enemies.filter((e) => !e.alive).length;
  const div = document.createElement('div');
  div.id = 'win-screen';
  Object.assign(div.style, {
    position: 'fixed', inset: '0', zIndex: '40', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(10, 10, 18, 0.82)', color: '#f0f0f5',
    font: '15px system-ui, sans-serif', textAlign: 'center',
  });
  div.innerHTML = `
    <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px;
      padding:28px 40px; box-shadow:0 12px 40px rgba(0,0,0,.6);">
      <div style="font-size:26px; font-weight:800; letter-spacing:2px; margin-bottom:8px;">YOU ESCAPED WORK</div>
      <div style="opacity:.85; margin-bottom:4px;">The parking garage has never smelled sweeter.</div>
      <div style="opacity:.7; margin-bottom:18px;">Level ${playerState.level} &middot; ${defeated} coworker${defeated === 1 ? '' : 's'} out-officed</div>
      <button id="again" style="padding:10px 26px; border-radius:8px; border:1px solid #3a3a52;
        background:#2e2e46; color:#f0f0f5; font:inherit; cursor:pointer;">Clock In Again</button>
    </div>`;
  document.body.appendChild(div);
  div.querySelector('#again').onclick = () => location.reload();
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
  updateEnemies(dt);
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
  if (inCombat || gameOver) return;
  const tile = screenToTile(sx, sy);
  if (!tile) return;
  const en = enemyAt(tile.x, tile.z);
  if (en) {
    showMenu(sx, sy, [
      { label: `Confront ${en.name}`, action: () => confront(en) },
      { label: 'Avoid eye contact', action: () => say('You study your shoes intently.') },
      { label: 'Examine', action: () => say(en.examine) },
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
updateStatsHud();

// Small read-only handle for tests and console poking.
window.__game = {
  get playerTile() { return { ...playerTile }; },
  get inCombat() { return inCombat; },
  get gameOver() { return gameOver; },
  get lastPath() { return lastPath; },
  get fadedWallCount() { return walls.filter((w) => w.faded).length; },
  get stats() { return { ...playerState }; },
  get enemies() { return enemies.map((e) => ({ name: e.name, x: e.x, z: e.z, alive: e.alive })); },
};

app.start();
