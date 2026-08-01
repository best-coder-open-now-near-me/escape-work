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
import { actorChar, actorLegend, parseActorRef } from './data/actor-registries.js';
import { LEVELS } from './data/levels.js';
import { createControls } from './controls.js';
import { createTileRenderer, computeCarpetZones } from './tile-renderer.js';
import { worldToScreenCss } from './fx.js';
import { parseLevel, parseWallRuns, compressWallRuns, TYPE_ALIASES } from './grid.js';
import { say, PANEL_CHROME, BUTTON_CHROME } from './ui.js';

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
  // ...and so is `depth`: main.js scales every enemy on the floor by it
  // (effectiveLevel), so dropping it on the load -> export round trip silently
  // demoted a deep floor's coworkers back to level 1.
  let levelDepth;
  // char -> a `<id>@<level>` legend value, preserved verbatim across the round
  // trip (see the load path). Empty for a level with no tiered placements.
  let tierChars = new Map();
  // Edge walls (partitions between tiles) - same Sets grid.js parses.
  let hWalls = new Set();
  let vWalls = new Set();
  // Doors, also on edges (a door replaces a wall on the same edge).
  let hDoors = new Set();
  let vDoors = new Set();

  // --- map characters are PER LEVEL, not per registry --------------------------
  // A level's map is one character per cell, and its `tiles` legend says what
  // each character means - which `grid.parseLevel` reads and the registry's
  // own `char` never enters. The ceiling ("94 printable characters, therefore
  // 94 tile types, ever") came from this editor alone: it exported the WHOLE
  // registry as every level's legend, so each type needed a globally unique
  // character whether the level used it or not.
  //
  // So characters are allocated HERE, on demand, to the types a level actually
  // uses, and the export names only those. A type's registry `char` is a
  // PREFERRED hint - taken when it is free, which keeps every hand-authored
  // level byte-identical through a load/export round trip - and a type with no
  // char, or one whose char is already spoken for, draws the next free one
  // from the pool. The registry is now unbounded; the real limit is how many
  // DISTINCT types one level uses, which is the pool size (~90).
  //
  // `runtimeOnly` tiles (the fallen twins, POWERS_PLAN M6) are never painted,
  // so they never draw a character and never reach a legend.
  const CHAR_POOL = [];
  for (let c = 33; c < 127; c++) {
    const ch = String.fromCharCode(c);
    if (ch === '\\') continue; // escaped inside a JSON map row - the worst one
    CHAR_POOL.push(ch);
  }
  // Actor characters are off the table for tiles: a level's two legends share
  // one map, and parseLevel checks `actors` first, so a tile handed an actor's
  // character would silently become that actor. This is the collision the
  // levels lint used to catch by hand-counting.
  const reservedChars = new Set([PLAYER_CHAR, ' ', ...Object.keys(actorLegend())]);
  const tileByChar = {};
  const charByType = {};
  function charOfType(id) {
    const hit = charByType[id];
    if (hit) return hit;
    const want = TILE_TYPES[id]?.char;
    const free = (ch) => ch && !reservedChars.has(ch) && !tileByChar[ch];
    const ch = free(want) ? want : CHAR_POOL.find(free);
    if (!ch) return charByType.floor; // pool exhausted: paint floor, say so below
    charByType[id] = ch;
    tileByChar[ch] = id;
    return ch;
  }
  // Floor first, so its '.' is never handed to anything else - it is the
  // fallback every unrecognised cell resolves to.
  charOfType('floor');
  const enemyByChar = {};
  for (const [id, def] of Object.entries(ENEMY_TYPES)) enemyByChar[def.char] = id;

  // --- rendering ---------------------------------------------------------------
  // The SAME renderer the game uses (tile-renderer.js), so what you paint is what the
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

  // Live carpet preview: the game lets carpet flow under items (see
  // computeCarpetZones in tile-renderer.js), so the editor must too - otherwise every
  // prop punches a gray hole in its room. The effective type grid matches
  // what parseLevel produces: actor tiles are plain floor, spaces are void.
  let carpet = new Map();
  const effectiveTypeAt = (x, z) => {
    const ch = rows[z]?.[x];
    if (ch === undefined || ch === ' ') return null;
    if (ch === PLAYER_CHAR || enemyByChar[ch]) return 'floor';
    return tileByChar[ch] || 'floor';
  };
  const computeCarpet = () => computeCarpetZones(effectiveTypeAt, width, height);

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
    const isActor = ch === PLAYER_CHAR || !!enemyByChar[ch];
    // Inherited carpet wins, exactly as buildLevel renders it in the game.
    out.push(renderer.renderFloor(x, z, carpet.get(key) || (isActor ? 'floor' : tileByChar[ch] || 'floor')));
    if (ch === PLAYER_CHAR) {
      out.push(addBox(playerMat, x, 0.35, z, 0.55, 0.5, 0.55));
    } else if (enemyByChar[ch]) {
      out.push(addBox(enemyMats[enemyByChar[ch]], x, 0.35, z, 0.55, 0.5, 0.55));
    } else {
      const type = tileByChar[ch] || 'floor';
      if (type === 'floor') return;
      const res = renderer.renderMarker(x, z, type, {
        electrified: electrified.has(key),
        surfaceAt: (sx, sz) => {
          const c = rows[sz]?.[sx];
          return c && c !== ' ' ? TILE_TYPES[tileByChar[c]]?.surface || null : null;
        },
        onAsync: (holder) => {
          // The cell may have been repainted while the model loaded.
          if (cellVersion.get(key) !== version) holder.destroy();
          else out.push(holder);
        },
      });
      out.push(...res.entities);
    }
  }

  // --- edge walls (partitions) ---------------------------------------------------
  const edgeEntities = new Map(); // "h:x,z" / "v:x,z" -> entity

  function edgeInRange(o, x, z) {
    // Boundary edges (x == width / z == height) are valid: the far side of
    // the last row/column.
    if (o === 'h') return x >= 0 && x < width && z >= 0 && z <= height;
    return x >= 0 && x <= width && z >= 0 && z < height;
  }

  // The partition brush works on the EDGE nearest the clicked ground point.
  function nearestEdge(g) {
    if (!g) return null;
    const x = Math.round(g.x);
    const z = Math.round(g.z);
    const dx = g.x - x;
    const dz = g.z - z;
    if (Math.abs(dx) >= Math.abs(dz)) return { o: 'v', x: dx > 0 ? x + 1 : x, z };
    return { o: 'h', x, z: dz > 0 ? z + 1 : z };
  }

  // Paint or erase the edge under the partition/door brush. Walls and doors
  // are mutually exclusive on an edge (painting one replaces the other);
  // erasing clears whichever is there.
  function paintEdge(edge, add) {
    if (!edge || !edgeInRange(edge.o, edge.x, edge.z)) return;
    const wallSet = edge.o === 'h' ? hWalls : vWalls;
    const doorSet = edge.o === 'h' ? hDoors : vDoors;
    const k = edge.x + ',' + edge.z;
    if (add) {
      const target = brush === 'door' ? doorSet : wallSet;
      const other = brush === 'door' ? wallSet : doorSet;
      if (target.has(k) && !other.has(k)) return;
      other.delete(k);
      target.add(k);
    } else {
      if (!wallSet.has(k) && !doorSet.has(k)) return;
      wallSet.delete(k);
      doorSet.delete(k);
    }
    const ek = edge.o + ':' + k;
    edgeEntities.get(ek)?.destroy();
    edgeEntities.delete(ek);
    if (wallSet.has(k)) edgeEntities.set(ek, renderer.renderEdgeWall(edge.x, edge.z, edge.o));
    else if (doorSet.has(k)) edgeEntities.set(ek, renderer.renderDoor(edge.x, edge.z, edge.o, false).holder);
    refreshElectrified(); // a partition can dam (or free) a conducting pool
  }

  function renderAllEdges() {
    for (const e of edgeEntities.values()) e.destroy();
    edgeEntities.clear();
    for (const k of hWalls) {
      const [x, z] = k.split(',').map(Number);
      edgeEntities.set('h:' + k, renderer.renderEdgeWall(x, z, 'h'));
    }
    for (const k of vWalls) {
      const [x, z] = k.split(',').map(Number);
      edgeEntities.set('v:' + k, renderer.renderEdgeWall(x, z, 'v'));
    }
    for (const k of hDoors) {
      const [x, z] = k.split(',').map(Number);
      edgeEntities.set('h:' + k, renderer.renderDoor(x, z, 'h', false).holder);
    }
    for (const k of vDoors) {
      const [x, z] = k.split(',').map(Number);
      edgeEntities.set('v:' + k, renderer.renderDoor(x, z, 'v', false).holder);
    }
  }

  // Recompute conduction and re-render only the cells whose electrified state
  // flipped (skipping one cell the caller is about to render anyway).
  function refreshElectrified(skipX = null, skipZ = null) {
    const next = computeElectrifiedSet();
    const dirty = [];
    for (const k of next) if (!electrified.has(k)) dirty.push(k);
    for (const k of electrified) if (!next.has(k)) dirty.push(k);
    electrified = next;
    for (const k of dirty) {
      const [cx, cz] = k.split(',').map(Number);
      if (cx !== skipX || cz !== skipZ) renderCell(cx, cz);
    }
  }

  // Same diff-and-rerender for inherited carpet: painting carpet (or erasing
  // it) recolors the floor under nearby props, exactly as the game would.
  function refreshCarpet(skipX = null, skipZ = null) {
    const next = computeCarpet();
    const dirty = new Set();
    for (const [k, t] of next) if (carpet.get(k) !== t) dirty.add(k);
    for (const k of carpet.keys()) if (!next.has(k)) dirty.add(k);
    carpet = next;
    for (const k of dirty) {
      const [cx, cz] = k.split(',').map(Number);
      if (cx !== skipX || cz !== skipZ) renderCell(cx, cz);
    }
  }

  function renderAll() {
    for (const list of cellEntities.values()) for (const e of list) e.destroy();
    cellEntities.clear();
    // Deliberately NOT cellVersion.clear(): the versions are what tell a model
    // load still in flight that its cell has moved on. Resetting them restarted
    // the counter at 1, so a .glb requested before a load/resize compared equal
    // on arrival, passed the staleness guard, and pushed itself into the
    // orphaned entity list - an undeletable prop floating over the new map.
    for (const [k, v] of cellVersion) cellVersion.set(k, v + 1);
    electrified = computeElectrifiedSet();
    carpet = computeCarpet();
    for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) renderCell(x, z);
    renderAllEdges();
    updateSizeLabel();
  }

  function loadLevel(data) {
    height = data.map.length;
    width = Math.max(...data.map.map((r) => r.length));
    // Level legends are per-file (any char can mean anything); the editor
    // paints and exports canonical registry chars. Remap through the file's
    // OWN legend on the way in, or a hand-authored level using different
    // chars would silently corrupt on the load -> export round trip.
    // A placement that names its own tier (`"G": "manager@3"`) keeps BOTH its
    // char and its legend entry through the round trip. It cannot be folded
    // onto the base actor's canonical char the way everything else is: that
    // char means "a Manager at this floor's depth", and collapsing a tiered
    // placement into it silently demotes the enemy - the same bug the `depth`
    // note above exists for, one level down. So these chars are passed through
    // untouched and re-emitted verbatim on export.
    tierChars = new Map();
    for (const [ch, val] of Object.entries(data.actors || {})) {
      if (parseActorRef(val).level != null) tierChars.set(ch, val);
    }
    // A tiered placement's character is whatever the source file chose, not a
    // registry character, so the allocator cannot know it is taken - and a
    // tile handed it would be read as that enemy by parseLevel, which checks
    // actors first. Reserve them before any cell of this level allocates.
    for (const ch of tierChars.keys()) reservedChars.add(ch);
    const canonical = (ch) => {
      if (ch === ' ') return ' ';
      const actor = (data.actors || {})[ch];
      if (actor === 'player') return PLAYER_CHAR;
      if (tierChars.has(ch)) return ch;
      // Any actor the registries know, not just the ones this editor can PAINT.
      // NPCs and companions were normalised to floor here, and the export
      // legend never named them - so opening a shipped floor and exporting it
      // deleted the recruitable coworkers from it, silently, in the one tool
      // the docs point you at for editing levels. Both shipped floors place a
      // companion, so both lost one.
      if (actor) return actorChar(actor) ?? charOfType('floor');
      const raw = (data.tiles || {})[ch] || 'floor';
      const type = TYPE_ALIASES[raw] || raw;
      return TILE_TYPES[type] ? charOfType(type) : charOfType('floor');
    };
    rows = data.map.map((r) => {
      const a = r.split('').map(canonical);
      while (a.length < width) a.push(' ');
      return a;
    });
    ({ h: hWalls, v: vWalls } = parseWallRuns(data.walls));
    ({ h: hDoors, v: vDoors } = parseWallRuns(data.doors));
    // A door REPLACES any wall on its edge (grid.js applies the same rule when
    // the game parses a level). A hand-authored file may legitimately run a
    // wall straight through a doorway; without this the editor rendered both
    // on one edge, lost the wall entity's handle so it could never be erased,
    // and exported the edge into `walls` AND `doors`.
    for (const k of hDoors) hWalls.delete(k);
    for (const k of vDoors) vWalls.delete(k);
    levelName = data.name || 'Untitled Floor';
    levelNext = data.next;
    levelDepth = data.depth;
    renderAll();
  }

  // --- painting -------------------------------------------------------------------
  let brush = 'wall'; // a tile type id, 'player', or 'enemy:<typeId>'
  function charForBrush() {
    if (brush === 'player') return PLAYER_CHAR;
    if (brush.startsWith('enemy:')) return ENEMY_TYPES[brush.slice(6)].char;
    return charOfType(brush);
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
        if (xx !== -1) { rows[zz][xx] = charOfType('floor'); renderCell(xx, zz); }
      }
    }
    rows[z][x] = ch;
    // Conduction and carpet zones can change beyond the painted cell -
    // recompute first so everything renders with fresh state (live preview
    // of cable + water, carpet flowing under a just-placed desk).
    refreshElectrified(x, z);
    refreshCarpet(x, z);
    renderCell(x, z);
    // Pool shapes depend on same-surface neighbours (see addPool in
    // tile-renderer.js) - repaint nearby spills so necks form and dissolve live.
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nc = rows[z + dz]?.[x + dx];
        if (nc && nc !== ' ' && TILE_TYPES[tileByChar[nc]]?.surface) renderCell(x + dx, z + dz);
      }
    }
  }

  // --- resizing (right/bottom edges; new cells are open floor - the world
  // outside the map is solid anyway, and partitions are painted, not filled) ---
  function resize(dw, dh) {
    const nw = Math.min(MAX_SIZE, Math.max(MIN_SIZE, width + dw));
    const nh = Math.min(MAX_SIZE, Math.max(MIN_SIZE, height + dh));
    if (nw === width && nh === height) return;
    while (rows.length < nh) rows.push(new Array(width).fill(charOfType('floor')));
    while (rows.length > nh) rows.pop();
    for (const row of rows) {
      while (row.length < nw) row.push(charOfType('floor'));
      while (row.length > nw) row.pop();
    }
    width = nw;
    height = nh;
    // drop edge walls/doors that fell off the map
    const inRange = (o) => (k) => {
      const [x, z] = k.split(',').map(Number);
      return edgeInRange(o, x, z);
    };
    hWalls = new Set([...hWalls].filter(inRange('h')));
    vWalls = new Set([...vWalls].filter(inRange('v')));
    hDoors = new Set([...hDoors].filter(inRange('h')));
    vDoors = new Set([...vDoors].filter(inRange('v')));
    renderAll();
  }

  // --- camera / input ----------------------------------------------------------------
  // The partition brush paints the edge nearest the click; every other brush
  // paints the tile. Right-click erases (the nearest partition, or the cell).
  const controls = createControls({
    app,
    canvas: document.getElementById('app'),
    focus: { x: (levelData.map[0].length - 1) / 2, z: (levelData.map.length - 1) / 2 },
    onLeftClickTile: (t, g) => (brush === 'partition' || brush === 'door' ? paintEdge(nearestEdge(g), true) : paint(t)),
    onLeftDragTile: (t, g) => (brush === 'partition' || brush === 'door' ? paintEdge(nearestEdge(g), true) : paint(t)),
    onRightClickTile: (t, sx, sy, g) =>
      (brush === 'partition' || brush === 'door' ? paintEdge(nearestEdge(g), false) : paint(t, charOfType('floor'))),
  });

  // --- level JSON in/out -----------------------------------------------------------
  function toJson() {
    // ONLY the types this level actually uses (see the allocator above). The
    // export used to name the whole registry, which is what made a character
    // a scarce global resource instead of a per-level one. Walked in registry
    // order rather than paint order so two exports of the same level agree.
    const used = new Set(['floor']); // actor cells parse as floor beneath them
    for (const r of rows) for (const ch of r) if (tileByChar[ch]) used.add(tileByChar[ch]);
    const tiles = {};
    for (const [id, def] of Object.entries(TILE_TYPES)) {
      if (def.runtimeOnly || !used.has(id)) continue; // never painted, never exported
      tiles[charByType[id]] = id;
    }
    // Every actor registry, so a companion that survived the load also
    // survives the export - a map char with no legend entry parses as floor,
    // which is the same data loss one step later.
    // Tiered placements last, so their char keeps its own meaning even if the
    // base actor's canonical char happens to collide with it.
    const actors = { [PLAYER_CHAR]: 'player', ...actorLegend(), ...Object.fromEntries(tierChars) };
    // Key order mirrors the hand-authored files in levels/, so a re-export
    // diffs cleanly against the original.
    const out = { name: levelName };
    if (levelDepth != null) out.depth = levelDepth;
    Object.assign(out, { tiles, actors, map: rows.map((r) => r.join('')) });
    const walls = compressWallRuns(hWalls, vWalls);
    if (walls.length) out.walls = walls;
    const doors = compressWallRuns(hDoors, vDoors);
    if (doors.length) out.doors = doors;
    if (levelNext) out.next = levelNext;
    return JSON.stringify(out, null, 2);
  }

  // --- editor UI ----------------------------------------------------------------------
  const bar = document.createElement('div');
  bar.id = 'editor-bar';
  Object.assign(bar.style, PANEL_CHROME, {
    position: 'fixed', left: '50%', bottom: '14px', transform: 'translateX(-50%)',
    zIndex: '30', display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center',
    maxWidth: '96vw', borderRadius: '10px', padding: '9px',
    font: '12px system-ui, sans-serif', alignItems: 'center',
    // The furniture kit pushed this past seventy brushes: cap the height and
    // scroll, or the palette eats the screen it is meant to sit under.
    maxHeight: '42vh', overflowY: 'auto',
  });
  const btn = (id, label, host = bar) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    Object.assign(b.style, BUTTON_CHROME, {
      padding: '7px 10px', borderRadius: '7px',
    });
    host.appendChild(b);
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
  {
    // Partitions first - with edge walls they are the main way to build rooms.
    const b = btn('brush-partition', 'partition');
    b.onclick = () => selectBrush('partition', b);
    brushButtons.push(b);
  }
  {
    const b = btn('brush-door', 'door');
    b.onclick = () => selectBrush('door', b);
    brushButtons.push(b);
  }
  // Tile brushes, grouped. Uncategorised entries (floor, walls, hazards - the
  // originals) stay in a leading "basics" row so the old muscle memory holds.
  const CATEGORY_ORDER = ['basics', 'work', 'seating', 'tables', 'storage',
    'breakroom', 'decor', 'structure', 'facilities'];
  const byCategory = new Map();
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (def.runtimeOnly) continue; // not a brush - it has no character to paint
    const cat = def.category || 'basics';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(id);
  }
  const cats = [...byCategory.keys()]
    .sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99));
  for (const cat of cats) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center',
      width: '100%', justifyContent: 'center',
    });
    const tag = document.createElement('span');
    tag.textContent = cat;
    Object.assign(tag.style, {
      opacity: '.5', letterSpacing: '1px', textTransform: 'uppercase',
      fontSize: '10px', minWidth: '68px', textAlign: 'right',
    });
    row.appendChild(tag);
    for (const id of byCategory.get(cat)) {
      const def = TILE_TYPES[id];
      const b = btn('brush-' + id, def.label || id.replace(/-/g, ' '), row);
      b.title = def.char
        ? `${def.label || id}  (map char "${def.char}" when free)`
        : `${def.label || id}  (map char assigned when painted)`;
      b.onclick = () => selectBrush(id, b);
      brushButtons.push(b);
      if (id === brush) b.style.borderColor = '#8adf76';
    }
    bar.appendChild(row);
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
  Object.assign(select.style, BUTTON_CHROME, {
    padding: '6px', borderRadius: '7px', cursor: 'auto',
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
    // One modal at a time - a second Export click used to stack another
    // full-screen overlay with duplicate #export-modal / #export-json ids,
    // and Close only dismissed the top one.
    document.getElementById('export-modal')?.remove();
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
    div.querySelector('#export-copy').onclick = () => {
      ta.select(); // visible feedback either way
      navigator.clipboard?.writeText(ta.value).catch(() => {});
    };
    div.querySelector('#export-close').onclick = () => div.remove();
  }

  loadLevel(levelData);
  say('LEVEL EDITOR — left-click paints (partition brush paints tile edges), right-click erases, middle-drag orbits');

  // Read-only handle for tests and console poking.
  window.__editor = {
    get map() { return rows.map((r) => r.join('')); },
    get size() { return { width, height }; },
    get brush() { return brush; },
    get walls() { return compressWallRuns(hWalls, vWalls); },
    get doors() { return compressWallRuns(hDoors, vDoors); },
    carpetAt: (x, z) => carpet.get(x + ',' + z) || null,
    // World point -> CSS-pixel screen point, so tests can click precise
    // ground points (mouse events arrive in CSS pixels).
    project(x, z) {
      const s = worldToScreenCss(controls.cameraEntity, x, 0, z);
      return { x: s.x, y: s.y };
    },
    charAt: (x, z) => rows[z]?.[x],
    toJson,
  };
}
