// In-browser level editor. Paints on a character grid using the same legends
// the game parses, renders with the same camera/controls, and hands back level
// JSON - so anything you can express in a level file, you can paint.
//
// Enter via the link on the class picker (or #editor in the URL). "Playtest"
// stashes the level in localStorage and reloads into the real game; the game
// shows a badge to jump back here. Any shipped level can be loaded as a base,
// and the grid can be grown/shrunk from the right/bottom edges.
import { TILE_TYPES } from './data/tiles.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { LEVELS } from './data/levels.js';
import { createControls } from './controls.js';
import { createTileRenderer } from './scene.js';
import { parseLevel } from './grid.js';
import { say } from './ui.js';

const pc = window.pc;
const PLAYER_CHAR = '@';
const MIN_SIZE = 4;
const MAX_SIZE = 40;

export function startEditor(app, levelData, stashKey) {
  // --- editable state ---------------------------------------------------------
  let rows = [];
  let width = 0;
  let height = 0;
  let levelName = '';
  let levelNext; // preserved through export so campaigns survive editing

  // char <-> meaning, from the registries (single source of truth for export)
  const tileByChar = {};
  for (const [id, def] of Object.entries(TILE_TYPES)) tileByChar[def.char] = id;
  const enemyByChar = {};
  for (const [id, def] of Object.entries(ENEMY_TYPES)) enemyByChar[def.char] = id;

  // --- rendering ---------------------------------------------------------------
  // The SAME renderer the game uses (scene.js), so what you paint is what the
  // game shows - puddles, cables, paper drifts, props, glowing exits and all.
  const renderer = createTileRenderer(app);
  app.on('update', (dt) => renderer.animate(dt));
  // Actor spawn markers are editor-only affordances (the game replaces them
  // with character models).
  const mat = (rgb) => {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
    m.update();
    return m;
  };
  const playerMat = mat([0.3, 0.8, 0.45]);
  const enemyMats = {};
  const enemyPalette = [[0.88, 0.32, 0.32], [0.9, 0.55, 0.25], [0.75, 0.35, 0.75]];
  Object.keys(ENEMY_TYPES).forEach((id, i) => { enemyMats[id] = mat(enemyPalette[i % enemyPalette.length]); });

  // Live conduction preview: recompute electrified pools from the current map
  // exactly the way the game will (grid.js), so painting a cable next to
  // water lights the pool up right in the editor.
  let electrified = new Set();
  function computeElectrifiedSet() {
    const s = new Set();
    try {
      const g = parseLevel(JSON.parse(toJson()));
      for (let z = 0; z < g.height; z++) {
        for (let x = 0; x < g.width; x++) {
          if (g.isElectrified(x, z)) s.add(x + ',' + z);
        }
      }
    } catch { /* mid-edit levels can be momentarily unparsable */ }
    return s;
  }

  // --- per-cell rendering --------------------------------------------------------
  const cellEntities = new Map(); // "x,z" -> [entities]
  const cellVersion = new Map(); // guards async model loads against repaints
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
    const version = (cellVersion.get(key) || 0) + 1;
    cellVersion.set(key, version);
    for (const e of cellEntities.get(key) || []) e.destroy();
    const out = [];
    cellEntities.set(key, out);
    const ch = rows[z][x];
    if (ch === ' ') return;
    out.push(renderer.renderFloor(x, z));
    if (ch === PLAYER_CHAR) {
      out.push(addBox(playerMat, x, 0.35, z, 0.55, 0.5, 0.55));
    } else if (enemyByChar[ch]) {
      out.push(addBox(enemyMats[enemyByChar[ch]], x, 0.35, z, 0.55, 0.5, 0.55));
    } else {
      const type = tileByChar[ch] || 'floor';
      if (type === 'floor') return;
      const res = renderer.renderMarker(x, z, type, {
        electrified: electrified.has(key),
        onAsync: (holder) => {
          // The cell may have been repainted while the model loaded.
          if (cellVersion.get(key) !== version) holder.destroy();
          else out.push(holder);
        },
      });
      out.push(...res.entities);
    }
  }

  function renderAll() {
    for (const list of cellEntities.values()) for (const e of list) e.destroy();
    cellEntities.clear();
    cellVersion.clear();
    electrified = computeElectrifiedSet();
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) renderCell(x, z);
    updateSizeLabel();
  }

  function loadLevel(data) {
    height = data.map.length;
    width = Math.max(...data.map.map((r) => r.length));
    rows = data.map.map((r) => {
      const a = r.split('');
      while (a.length < width) a.push(' ');
      return a;
    });
    levelName = data.name || 'Untitled Floor';
    levelNext = data.next;
    renderAll();
  }

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
    // Conduction can change anywhere a pool connects - recompute first so the
    // painted cell renders with fresh state, then re-render cells whose
    // electrified state flipped (live preview of cable + water).
    const next = computeElectrifiedSet();
    const dirty = [];
    for (const k of next) if (!electrified.has(k)) dirty.push(k);
    for (const k of electrified) if (!next.has(k)) dirty.push(k);
    electrified = next;
    renderCell(x, z);
    for (const k of dirty) {
      const [cx, cz] = k.split(',').map(Number);
      if (cx !== x || cz !== z) renderCell(cx, cz);
    }
  }

  // --- resizing (right/bottom edges; new cells are walls to keep maps sealed) ---
  function resize(dw, dh) {
    const nw = Math.min(MAX_SIZE, Math.max(MIN_SIZE, width + dw));
    const nh = Math.min(MAX_SIZE, Math.max(MIN_SIZE, height + dh));
    if (nw === width && nh === height) return;
    while (rows.length < nh) rows.push(new Array(width).fill(TILE_TYPES.wall.char));
    while (rows.length > nh) rows.pop();
    for (const row of rows) {
      while (row.length < nw) row.push(TILE_TYPES.wall.char);
      while (row.length > nw) row.pop();
    }
    width = nw;
    height = nh;
    renderAll();
  }

  // --- camera / input ----------------------------------------------------------------
  createControls({
    app,
    canvas: document.getElementById('app'),
    focus: { x: (levelData.map[0].length - 1) / 2, z: (levelData.map.length - 1) / 2 },
    onLeftClickTile: (t) => paint(t),
    onLeftDragTile: (t) => paint(t),
    onRightClickTile: (t) => paint(t, TILE_TYPES.floor.char), // quick-erase
  });

  // --- level JSON in/out -----------------------------------------------------------
  function toJson() {
    const tiles = {};
    for (const [id, def] of Object.entries(TILE_TYPES)) tiles[def.char] = id;
    const actors = { [PLAYER_CHAR]: 'player' };
    for (const [id, def] of Object.entries(ENEMY_TYPES)) actors[def.char] = id;
    const out = { name: levelName, tiles, actors, map: rows.map((r) => r.join('')) };
    if (levelNext) out.next = levelNext;
    return JSON.stringify(out, null, 2);
  }

  // --- editor UI ----------------------------------------------------------------------
  const bar = document.createElement('div');
  bar.id = 'editor-bar';
  Object.assign(bar.style, {
    position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)',
    zIndex: '30', display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center',
    maxWidth: '96vw', background: '#232334', border: '1px solid #3a3a52',
    borderRadius: '10px', padding: '9px', font: '12px system-ui, sans-serif',
    color: '#f0f0f5', boxShadow: '0 10px 30px rgba(0,0,0,.5)', alignItems: 'center',
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
  const divider = () => {
    const s = document.createElement('div');
    Object.assign(s.style, { width: '1px', alignSelf: 'stretch', background: '#3a3a52', margin: '0 4px' });
    bar.appendChild(s);
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

  divider();

  // size controls
  const sizeLabel = document.createElement('span');
  sizeLabel.id = 'ed-size';
  Object.assign(sizeLabel.style, { padding: '0 4px', opacity: '.8' });
  function updateSizeLabel() { sizeLabel.textContent = `${width}×${height}`; }
  btn('ed-shrink-w', '−col').onclick = () => resize(-1, 0);
  btn('ed-grow-w', '+col').onclick = () => resize(1, 0);
  btn('ed-shrink-h', '−row').onclick = () => resize(0, -1);
  btn('ed-grow-h', '+row').onclick = () => resize(0, 1);
  bar.appendChild(sizeLabel);

  divider();

  // load a shipped level as a base
  const select = document.createElement('select');
  select.id = 'ed-level';
  Object.assign(select.style, {
    padding: '6px', borderRadius: '7px', border: '1px solid #3a3a52',
    background: '#2e2e46', color: '#f0f0f5', font: 'inherit',
  });
  select.innerHTML = `<option value="">load level…</option>` +
    Object.entries(LEVELS).map(([id, l]) => `<option value="${id}">${l.name || id}</option>`).join('');
  select.onchange = () => {
    if (LEVELS[select.value]) loadLevel(LEVELS[select.value]);
    select.value = '';
  };
  bar.appendChild(select);

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
        <div style="font-weight:700; margin-bottom:8px;">Level JSON — paste into levels/ (or hand it to Claude)</div>
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

  loadLevel(levelData);
  say('LEVEL EDITOR — left-click paints, right-click erases, middle-drag orbits');

  // Read-only handle for tests and console poking.
  window.__editor = {
    get map() { return rows.map((r) => r.join('')); },
    get size() { return { width, height }; },
    get brush() { return brush; },
    charAt: (x, z) => rows[z]?.[x],
    toJson,
  };
}
