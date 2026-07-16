// Escape Work - code-first PlayCanvas entry point.
//
// The whole game lives in this repo. This file reads a level (plain JSON you can
// hand-edit) and draws it as a grid. Change levels/level1.json, rebuild, and the
// map changes - that is the loop.
// The PlayCanvas engine is loaded separately via a <script> tag in index.html
// (its prebuilt UMD build), which exposes a global `pc`. We only bundle our own
// code + the level data here, which keeps esbuild away from the engine's
// internals. The level is plain JSON you can hand-edit.
import level from '../levels/level1.json';

const pc = window.pc;

// --- boot the engine ------------------------------------------------------
const canvas = document.getElementById('app');
const app = new pc.Application(canvas, {
  graphicsDeviceOptions: { antialias: true, alpha: false },
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());

// Fully-lit ambient so flat material colours show without placing lights.
app.scene.ambientLight = new pc.Color(1, 1, 1);

// --- level -> tiles -------------------------------------------------------
// One colour per legend character. Tweaking these (or the map) is all it takes
// to reskin a level.
const TILE = {
  '#': { color: new pc.Color(0.22, 0.22, 0.30), height: 0.6 }, // wall
  '.': { color: new pc.Color(0.82, 0.82, 0.88), height: 0.2 }, // floor
  '@': { color: new pc.Color(0.30, 0.80, 0.45), height: 0.5 }, // you
  'E': { color: new pc.Color(0.88, 0.32, 0.32), height: 0.5 }, // enemy
  '>': { color: new pc.Color(0.96, 0.80, 0.26), height: 0.3 }, // exit
};
const FLOOR = TILE['.'];

function makeMaterial(color) {
  const m = new pc.StandardMaterial();
  m.diffuse = color;
  m.update();
  return m;
}
const materials = {};
for (const ch of Object.keys(TILE)) materials[ch] = makeMaterial(TILE[ch].color);

function addBox(material, x, y, z, sx, sy, sz) {
  const e = new pc.Entity();
  e.addComponent('render', { type: 'box', material });
  e.setLocalScale(sx, sy, sz);
  e.setPosition(x, y, z);
  app.root.addChild(e);
  return e;
}

const rows = level.map;
const height = rows.length;
const width = Math.max(...rows.map((r) => r.length));

for (let z = 0; z < height; z++) {
  for (let x = 0; x < rows[z].length; x++) {
    const ch = rows[z][x];
    if (ch === ' ') continue;
    // Every walkable/occupied cell gets a floor tile...
    addBox(materials['.'], x, 0, z, 0.96, FLOOR.height, 0.96);
    // ...and non-floor cells get a coloured marker sitting on top.
    if (ch !== '.' && TILE[ch]) {
      const t = TILE[ch];
      addBox(materials[ch], x, t.height / 2, z, 0.78, t.height, 0.78);
    }
  }
}

// --- camera ---------------------------------------------------------------
// Orthographic, angled slightly so walls read as 3D without hiding the grid.
const cx = (width - 1) / 2;
const cz = (height - 1) / 2;
const camera = new pc.Entity();
camera.addComponent('camera', {
  clearColor: new pc.Color(0.1, 0.1, 0.15),
  projection: pc.PROJECTION_ORTHOGRAPHIC,
  orthoHeight: height * 0.58 + 1,
});
// Mostly overhead with a slight tilt so walls have a little depth.
camera.setPosition(cx, 20, cz + 3.5);
camera.lookAt(cx, 0, cz);
app.root.addChild(camera);

// --- HUD ------------------------------------------------------------------
const subtitle = document.getElementById('subtitle');
if (subtitle) subtitle.textContent = level.name || '';

app.start();
