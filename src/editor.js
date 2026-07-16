// In-browser level editor. Paints on a character grid using the same legends
// the game parses, renders with the same camera/controls, and hands back level
// JSON - so anything you can express in a level file, you can paint.
//
// Enter via the link on the class picker (or #editor in the URL). "Playtest"
// stashes the level in localStorage and reloads into the real game; the game
// shows a badge to jump back here.
import { TILE_TYPES } from './data/tiles.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { createControls } from './controls.js';
import { say } from './ui.js';

const pc = window.pc;
const PLAYER_CHAR = '@';

export function startEditor(app, levelData, stashKey) {
  // --- editable character grid ------------------------------------------------
  const height = levelData.map.length;
  const width = Math.max(...levelData.map.map((r) => r.length));
  const rows = levelData.map.map((r) => {
    const a = r.split('');
    while (a.length < width) a.push(' ');
    return a;
  });

  // char <-> meaning, from the registries (single source of truth for export)
  const tileByChar = {};
  for (const [id, def] of Object.entries(TILE_TYPES)) tileByChar[def.char] = id;
  const enemyByChar = {};
  for (const [id, def] of Object.entries(ENEMY_TYPES)) enemyByChar[def.char] = id;

  // --- materials ---------------------------------------------------------------
  const mat = (rgb) => {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
    m.update();
    return m;
  };
  const materials = {};
  for (const [id, def] of Object.entries(TILE_TYPES)) materials[id] = mat(def.color);
  const playerMat = mat([0.3, 0.8, 0.45]);
  const enemyMats = {};
  const enemyPalette = [[0.88, 0.32, 0.32], [0.9, 0.55, 0.25], [0.75, 0.35, 0.75]];
  Object.keys(ENEMY_TYPES).forEach((id, i) => { enemyMats[id] = mat(enemyPalette[i % enemyPalette.length]); });

  // --- per-cell rendering --------------------------------------------------------
  const cellEntities = new Map(); // "x,z" -> [entities]
  const addBox = (material, x, y, z, sx, sy, sz) => {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material });
    e.setLocalScale(sx, sy, sz);
    e.setPosition(x, y, z);
    app.root.addChild(e);
    return e;
  };

  function renderCell(x, z) {
    const key = x + ',' + z;
    for (const e of cellEntities.get(key) || []) e.destroy();
    const out = [];
    const ch = rows[z][x];
    if (ch !== ' ') {
      out.push(addBox(materials.floor, x, 0, z, 0.96, TILE_TYPES.floor.height, 0.96));
      if (ch === PLAYER_CHAR) {
        out.push(addBox(playerMat, x, 0.35, z, 0.55, 0.5, 0.55));
      } else if (enemyByChar[ch]) {
        out.push(addBox(enemyMats[enemyByChar[ch]], x, 0.35, z, 0.55, 0.5, 0.55));
      } else {
        const type = tileByChar[ch] || 'floor';
        if (type !== 'floor') {
          const def = TILE_TYPES[type];
          out.push(addBox(materials[type], x, def.height / 2, z, 0.78, def.height, 0.78));
        }
      }
    }
    cellEntities.set(key, out);
  }

  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) renderCell(x, z);

  // --- painting -------------------------------------------------------------------
  let brush = 'wall'; // a tile type id, 'player', or 'enemy:<typeId>'
  function charForBrush() {
    if (brush === 'player') return PLAYER_CHAR;
    if (brush.startsWith('enemy:')) return ENEMY_TYPES[brush.slice(6)].char;
    return TILE_TYPES[brush].char;
  }

  function paint(tile, ch = charForBrush()) {
    if (!tile) return;
    const { x, z } = tile;
    if (x < 0 || x >= width || z < 0 || z >= height) return;
    if (rows[z][x] === ch) return;
    // exactly one player spawn: painting a new one clears the old
    if (ch === PLAYER_CHAR) {
      for (let zz = 0; zz < height; zz++) {
        const xx = rows[zz].indexOf(PLAYER_CHAR);
        if (xx !== -1) { rows[zz][xx] = TILE_TYPES.floor.char; renderCell(xx, zz); }
      }
    }
    rows[z][x] = ch;
    renderCell(x, z);
  }

  // --- camera / input ----------------------------------------------------------------
  const controls = createControls({
    app,
    canvas: document.getElementById('app'),
    focus: { x: (width - 1) / 2, z: (height - 1) / 2 },
    onLeftClickTile: (t) => paint(t),
    onLeftDragTile: (t) => paint(t),
    onRightClickTile: (t) => paint(t, TILE_TYPES.floor.char), // quick-erase
  });
  void controls;

  // --- level JSON in/out -----------------------------------------------------------
  function toJson() {
    const tiles = {};
    for (const [id, def] of Object.entries(TILE_TYPES)) tiles[def.char] = id;
    const actors = { [PLAYER_CHAR]: 'player' };
    for (const [id, def] of Object.entries(ENEMY_TYPES)) actors[def.char] = id;
    return JSON.stringify(
      { name: levelData.name || 'Untitled Floor', tiles, actors, map: rows.map((r) => r.join('')) },
      null, 2,
    );
  }

  // --- editor UI ----------------------------------------------------------------------
  const bar = document.createElement('div');
  bar.id = 'editor-bar';
  Object.assign(bar.style, {
    position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)',
    zIndex: '30', display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center',
    maxWidth: '96vw', background: '#232334', border: '1px solid #3a3a52',
    borderRadius: '10px', padding: '9px', font: '12px system-ui, sans-serif',
    color: '#f0f0f5', boxShadow: '0 10px 30px rgba(0,0,0,.5)',
  });
  const btn = (id, label) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    Object.assign(b.style, {
      padding: '7px 10px', borderRadius: '7px', border: '1px solid #3a3a52',
      background: '#2e2e46', color: '#f0f0f5', font: 'inherit', cursor: 'pointer',
    });
    bar.appendChild(b);
    return b;
  };

  const brushButtons = [];
  function selectBrush(id, button) {
    brush = id;
    for (const b of brushButtons) b.style.borderColor = '#3a3a52';
    button.style.borderColor = '#8adf76';
  }
  for (const [id] of Object.entries(TILE_TYPES)) {
    const b = btn('brush-' + id, id.replace('-', ' '));
    b.onclick = () => selectBrush(id, b);
    brushButtons.push(b);
    if (id === brush) b.style.borderColor = '#8adf76';
  }
  {
    const b = btn('brush-player', 'player start');
    b.onclick = () => selectBrush('player', b);
    brushButtons.push(b);
  }
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    const b = btn('brush-' + id, def.name);
    b.onclick = () => selectBrush('enemy:' + id, b);
    brushButtons.push(b);
  }

  const sep = document.createElement('div');
  Object.assign(sep.style, { width: '1px', background: '#3a3a52', margin: '0 4px' });
  bar.appendChild(sep);

  btn('ed-playtest', '▶ Playtest').onclick = () => {
    localStorage.setItem(stashKey, toJson());
    location.hash = '';
    location.reload();
  };
  btn('ed-export', 'Export JSON').onclick = showExport;
  btn('ed-reset', 'Reset').onclick = () => {
    localStorage.removeItem(stashKey);
    location.reload();
  };
  btn('ed-exit', 'Exit editor').onclick = () => {
    localStorage.removeItem(stashKey);
    location.hash = '';
    location.reload();
  };
  document.body.appendChild(bar);

  function showExport() {
    const div = document.createElement('div');
    div.id = 'export-modal';
    Object.assign(div.style, {
      position: 'fixed', inset: '0', zIndex: '40', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,18,.82)',
      color: '#f0f0f5', font: '13px system-ui, sans-serif',
    });
    div.innerHTML = `
      <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px; padding:18px; width:min(640px,92vw);">
        <div style="font-weight:700; margin-bottom:8px;">Level JSON — paste into levels/level1.json (or hand it to Claude)</div>
        <textarea id="export-json" readonly style="width:100%; height:300px; background:#171722; color:#c9e4a5;
          border:1px solid #3a3a52; border-radius:8px; padding:10px; font:12px monospace; white-space:pre;"></textarea>
        <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
          <button id="export-copy" style="padding:8px 16px; border-radius:7px; border:1px solid #3a3a52; background:#2e2e46; color:#f0f0f5; font:inherit; cursor:pointer;">Copy</button>
          <button id="export-close" style="padding:8px 16px; border-radius:7px; border:1px solid #3a3a52; background:#2e2e46; color:#f0f0f5; font:inherit; cursor:pointer;">Close</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    const ta = div.querySelector('#export-json');
    ta.value = toJson();
    div.querySelector('#export-copy').onclick = () => { ta.select(); document.execCommand('copy'); };
    div.querySelector('#export-close').onclick = () => div.remove();
  }

  say('LEVEL EDITOR — left-click paints, right-click erases, middle-drag orbits');

  // Read-only handle for tests and console poking.
  window.__editor = {
    get map() { return rows.map((r) => r.join('')); },
    get brush() { return brush; },
    charAt: (x, z) => rows[z]?.[x],
    toJson,
  };
}
