// In-browser level editor. Paints on a character grid using the same legends
// the game parses, renders with the same camera/controls, and hands back level
// JSON - so anything you can express in a level file, you can paint.
//
// Enter via the link on the class picker (or #editor in the URL). "Playtest"
// stashes the level in localStorage and reloads into the real game; the game
// shows a badge to jump back here. Any shipped level can be loaded as a base,
// and the grid can be grown/shrunk from the right/bottom edges.
//
// Work is protected three ways: snapshot undo/redo (Ctrl+Z / Ctrl+Shift+Z, one
// step per STROKE), a debounced autosave draft that is restored on the next
// boot, and confirmations on the two buttons that throw the session away. The
// playtest stash is a separate hand-off slot, not the save.
import { TILE_TYPES } from './data/tiles.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { actorChar, actorLegend, parseActorRef } from './data/actor-registries.js';
import { LEVELS } from './data/levels.js';
import { createControls } from './controls.js';
import { createTileRenderer, computeCarpetZones } from './tile-renderer.js';
import { worldToScreenCss } from './fx.js';
import { parseLevel, parseWallRuns, compressWallRuns, TYPE_ALIASES } from './grid.js';
import { toast, PANEL_CHROME, BUTTON_CHROME } from './ui.js';

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
  // The same map resolved to bare actor ids, so a tiered placement can be drawn
  // and treated as the body it is rather than as an unrecognised character.
  let tierCharIds = {};
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
  // These three are rebuilt per LOAD, not per session (resetAllocator below).
  // They used to live for the whole of startEditor and only ever grow, which
  // made an export depend on which levels you had opened first in that browser
  // session: load a level that reserves 'G' for `manager@3`, then load one that
  // wants 'G' for `ficus`, and the plant drew a pool char instead. Worse in the
  // other order - a cached `charByType` entry was returned WITHOUT re-testing
  // reservations, so a painted plant could export under an enemy's character
  // and parse back as that enemy.
  let reservedChars = new Set();
  let tileByChar = {};
  let charByType = {};
  function resetAllocator() {
    // Actor characters are off the table for tiles: a level's two legends share
    // one map, and parseLevel checks `actors` first, so a tile handed an actor's
    // character would silently become that actor.
    reservedChars = new Set([PLAYER_CHAR, ' ', ...Object.keys(actorLegend())]);
    tileByChar = {};
    charByType = {};
    // Floor first, so its '.' is never handed to anything else - it is the
    // fallback every unrecognised cell resolves to.
    charOfType('floor');
  }
  function charOfType(id) {
    const free = (ch) => ch && !reservedChars.has(ch) && !tileByChar[ch];
    const hit = charByType[id];
    // Re-validate the cache: a tiered placement reserved after this type was
    // first allocated can invalidate an answer we already gave.
    if (hit && (!reservedChars.has(hit) || tileByChar[hit] === id)) return hit;
    if (hit) { delete tileByChar[hit]; delete charByType[id]; }
    const want = TILE_TYPES[id]?.char;
    const ch = free(want) ? want : CHAR_POOL.find(free);
    // Pool exhausted. There are 87 paintable tile types against 86 usable
    // characters, so this is reachable, not theoretical - and it used to
    // substitute floor in silence under a comment promising it would "say so".
    if (!ch) {
      toast(`No map character left for "${TILE_TYPES[id]?.label || id}" - this level already uses every one.`);
      return null;
    }
    charByType[id] = ch;
    tileByChar[ch] = id;
    return ch;
  }
  resetAllocator();
  // Every actor a registry can name, not just the paintable enemies: a
  // companion or a tiered placement that renders as bare floor is one a brush
  // stroke deletes without anything visibly vanishing.
  const actorIdByChar = {};
  for (const [ch, ref] of Object.entries(actorLegend())) actorIdByChar[ch] = parseActorRef(ref).id;
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
  // One colour per actor ID, derived rather than drawn from a fixed list. The
  // list held three colours and was indexed `i % 3` across four enemy types, so
  // the Manager and the Security Guard painted the identical red box - two
  // bodies with different stats, AP and loot, indistinguishable on the map you
  // are balancing. A hash also means the fifth enemy type does not collide the
  // day it is added.
  const hueToRgb = (h, s = 0.62, l = 0.58) => {
    const k = (n) => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
    return [f(0), f(8), f(4)];
  };
  const actorMats = {};
  function actorMat(id) {
    if (!actorMats[id]) {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      // Away from the player's green, so a spawn never reads as a coworker.
      actorMats[id] = mat(hueToRgb(((h % 300) + 60) / 360));
    }
    return actorMats[id];
  }

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
    if (ch === PLAYER_CHAR || actorIdByChar[ch] || tierCharIds[ch]) return 'floor';
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
    const isActor = ch === PLAYER_CHAR || !!actorIdByChar[ch] || !!tierCharIds[ch];
    // Inherited carpet wins, exactly as buildLevel renders it in the game.
    out.push(renderer.renderFloor(x, z, carpet.get(key) || (isActor ? 'floor' : tileByChar[ch] || 'floor')));
    if (ch === PLAYER_CHAR) {
      out.push(addBox(playerMat, x, 0.35, z, 0.55, 0.5, 0.55));
    } else if (actorIdByChar[ch] || tierCharIds[ch]) {
      // A companion, an NPC or a tiered placement gets a marker too. They used
      // to render as bare floor, so a carpet drag erased one with nothing
      // visibly vanishing - the load path went to real trouble to preserve
      // them and the canvas quietly did not show them.
      out.push(addBox(actorMat(actorIdByChar[ch] || tierCharIds[ch]), x, 0.35, z, 0.55, 0.5, 0.55));
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
      commitStroke();
      other.delete(k);
      target.add(k);
    } else {
      if (!wallSet.has(k) && !doorSet.has(k)) return;
      commitStroke();
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
    setStatus();
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
    // A fresh level gets a fresh allocation. Without this the editor carried
    // one session-long map, so what you exported depended on what you had
    // opened before it.
    resetAllocator();
    history = [];
    future = [];
    tierChars = new Map();
    tierCharIds = {};
    for (const [ch, val] of Object.entries(data.actors || {})) {
      const ref = parseActorRef(val);
      if (ref.level != null) { tierChars.set(ch, val); tierCharIds[ch] = ref.id; }
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

  // --- history and autosave ---------------------------------------------------
  // Every edit used to be immediately final. The default brush is `wall` and
  // left-DRAG paints, so one stray press-and-move across a finished room
  // replaced a swath of floor with cubicle wall and there was no way back
  // except repainting from memory. `-col` deleted a whole column on one click.
  //
  // Full snapshots rather than a diff format: at the 40x40 ceiling a snapshot
  // is ~1600 characters plus four small Sets, which is cheaper to write and
  // very much cheaper to reason about than an inverse-operation log.
  const HISTORY_CAP = 60;
  let history = [];
  let future = [];
  let dirty = false;
  const snapshot = () => ({
    rows: rows.map((r) => r.slice()),
    hWalls: new Set(hWalls), vWalls: new Set(vWalls),
    hDoors: new Set(hDoors), vDoors: new Set(vDoors),
    width, height, levelName, levelNext, levelDepth,
  });
  const restore = (s) => {
    rows = s.rows.map((r) => r.slice());
    hWalls = new Set(s.hWalls); vWalls = new Set(s.vWalls);
    hDoors = new Set(s.hDoors); vDoors = new Set(s.vDoors);
    width = s.width; height = s.height;
    levelName = s.levelName; levelNext = s.levelNext; levelDepth = s.levelDepth;
    renderAll();
  };
  // A gesture ARMS a snapshot; the first mutation inside it commits. Pushing
  // eagerly on press meant a click on empty space created an undo step that
  // undid nothing, which reads as a broken Ctrl+Z.
  let pendingStroke = null;
  const beginStroke = () => { pendingStroke = snapshot(); };
  function pushHistory() {
    history.push(pendingStroke || snapshot());
    pendingStroke = null;
    if (history.length > HISTORY_CAP) history.shift();
    future = [];
    markDirty();
  }
  // Called by paint/paintEdge once they know they are really changing something.
  function commitStroke() {
    if (pendingStroke) pushHistory();
    else markDirty();
  }
  function undo() {
    if (!history.length) { toast('Nothing to undo.'); return; }
    future.push(snapshot());
    restore(history.pop());
    toast(`Undo. (${history.length} step${history.length === 1 ? '' : 's'} left)`);
  }
  function redo() {
    if (!future.length) { toast('Nothing to redo.'); return; }
    history.push(snapshot());
    restore(future.pop());
    toast('Redo.');
  }

  // Autosave is SEPARATE from the playtest stash. The stash is a hand-off slot
  // written only when you press Playtest; before this, closing the tab or
  // hitting Reset threw away everything since that press - and a reload
  // silently restored the stash, which could be an hour old.
  const DRAFT_KEY = 'escape-work.editor.draft';
  let draftTimer = null;
  function markDirty() {
    dirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, toJson()); } catch { /* private mode, quota */ }
    }, 700);
  }
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  // --- painting -------------------------------------------------------------------
  let brush = 'wall'; // a tile type id, 'player', or 'enemy:<typeId>'
  function charForBrush() {
    if (brush === 'player') return PLAYER_CHAR;
    if (brush.startsWith('enemy:')) return ENEMY_TYPES[brush.slice(6)].char;
    return charOfType(brush);
  }

  function paint(tile, ch = charForBrush()) {
    if (!tile || !ch) return; // a refused character allocation (pool exhausted)
    const { x, z } = tile;
    if (x < 0 || x >= width || z < 0 || z >= height) return;
    if (rows[z][x] === ch) return;
    commitStroke();
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
    pushHistory();
    // Shrinking silently deleted whatever was in the trimmed rows/columns,
    // including the player spawn. Say what is about to go; undo can take it
    // back now, but only if you know to reach for it.
    if (nw < width || nh < height) {
      let lostActors = 0;
      for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
          if (x < nw && z < nh) continue;
          const c = rows[z][x];
          if (c === PLAYER_CHAR || actorIdByChar[c] || tierCharIds[c]) lostActors++;
        }
      }
      if (lostActors) toast(`Trimmed ${lostActors} placed actor${lostActors === 1 ? '' : 's'}. Ctrl+Z puts them back.`);
    }
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
    // One snapshot per STROKE. A drag fires this once and then streams tiles,
    // so undo steps back over the whole swipe rather than one cell of it.
    onAnyLeftPress: () => beginStroke(),
    onLeftClickTile: (t, g) => (brush === 'partition' || brush === 'door' ? paintEdge(nearestEdge(g), true) : paint(t)),
    onLeftDragTile: (t, g) => (brush === 'partition' || brush === 'door' ? paintEdge(nearestEdge(g), true) : paint(t)),
    onRightClickTile: (t, sx, sy, g) => {
      beginStroke(); // erase is a gesture too, and there is no right-press hook
      return brush === 'partition' || brush === 'door'
        ? paintEdge(nearestEdge(g), false)
        : paint(t, charOfType('floor'));
    },
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
    setStatus();
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
  // Every category a tile type actually declares has to appear here: a missing
  // one scores `(-1 + 1) || 99` and sorts last as an orphan row. 'furniture'
  // did exactly that, stranding the snack machine alone at the bottom.
  const CATEGORY_ORDER = ['basics', 'work', 'seating', 'tables', 'storage',
    'breakroom', 'furniture', 'decor', 'structure', 'facilities'];
  const byCategory = new Map();
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (def.runtimeOnly) continue; // not a brush - it has no character to paint
    // A stair marker only means something with a storey above it, which this
    // editor cannot author yet (EDITOR_PLAN M4). Painting one today exports a
    // level the shipped-level lint rejects and, in a flat level, an invisible
    // wall the author cannot see in playtest. Hidden until M4 re-enables it
    // with live run validation.
    if (def.stairs) continue;
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
    // Layered levels stay off the base list until the editor learns storeys
    // (EDITOR_PLAN M4) - offering one here would just crash the load.
    Object.entries(LEVELS).filter(([, l]) => !l.layers)
      .map(([id, l]) => `<option value="${id}">${l.name || id}</option>`).join('');
  select.onchange = () => {
    if (LEVELS[select.value]) loadLevel(LEVELS[select.value]);
    select.value = '';
  };
  bar.appendChild(select);

  btn('ed-undo', '↶ Undo').onclick = () => undo();
  btn('ed-redo', '↷ Redo').onclick = () => redo();

  btn('ed-playtest', '▶ Playtest').onclick = () => {
    localStorage.setItem(stashKey, toJson());
    dirty = false; // the stash IS a save - leaving for it is not losing work
    clearDraft();
    location.hash = '';
    location.reload();
  };
  btn('ed-export', 'Export JSON').onclick = showExport;
  // Reset and Exit each throw the session away. They used to do it on one
  // unconfirmed click, styled identically to Export sitting beside them.
  const dangerBtn = (id, label, confirmText, act) => {
    const b = btn(id, label);
    Object.assign(b.style, { borderColor: '#7a3a4a', color: '#ffd9e0' });
    b.onclick = () => {
      // eslint-disable-next-line no-alert
      if (dirty && !window.confirm(confirmText)) return;
      act();
    };
    return b;
  };
  dangerBtn('ed-reset', 'Reset',
    'Discard the level you are editing and reload?\n\nUnsaved painting since your last Playtest will be lost.',
    () => { localStorage.removeItem(stashKey); clearDraft(); location.reload(); });
  dangerBtn('ed-exit', 'Exit editor',
    'Leave the editor?\n\nUnsaved painting since your last Playtest will be lost.',
    () => {
      localStorage.removeItem(stashKey);
      clearDraft();
      location.hash = '';
      location.reload();
    });

  // --- keyboard ---------------------------------------------------------------
  // The editor registered no key handlers at all: no undo, no Escape, nothing.
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape') { document.getElementById('export-modal')?.remove(); }
  });

  // The browser's own "you have unsaved changes" prompt is the only thing that
  // survives a tab close, a back button, or a reload typed into the bar.
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
  document.body.appendChild(bar);

  // --- status strip -----------------------------------------------------------
  // Everything the editor knows about the current moment, in the corner the
  // game's empty HUD pill was wasting. It is deliberately OUTSIDE the palette:
  // the palette scrolls, and a readout you have to scroll to is not a readout.
  const status = document.createElement('div');
  status.id = 'ed-status';
  Object.assign(status.style, PANEL_CHROME, {
    position: 'fixed', left: '12px', bottom: '14px', zIndex: '31',
    padding: '7px 11px', borderRadius: '9px', font: '12px system-ui, sans-serif',
    pointerEvents: 'none', maxWidth: '46vw', lineHeight: '1.45',
  });
  document.body.appendChild(status);
  function brushLabel() {
    if (brush === 'partition') return 'partition (edge)';
    if (brush === 'door') return 'door (edge)';
    if (brush === 'player') return 'player start';
    if (brush.startsWith('enemy:')) return ENEMY_TYPES[brush.slice(6)]?.name || brush;
    return TILE_TYPES[brush]?.label || brush.replace(/-/g, ' ');
  }
  function setStatus() {
    const ch = charByType[brush];
    status.innerHTML = `<b>${levelName || 'Untitled Floor'}</b> &nbsp; ${width}×${height}`
      + `<br>brush: <b style="color:#8adf76">${brushLabel()}</b>`
      + (ch ? ` <span style="opacity:.6">writes “${ch}”</span>` : '');
  }

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

  // Prefer an autosaved draft over the level we were handed. The editor used to
  // have exactly one persistence slot - the playtest stash, written only when
  // you press Playtest - so a crash or a stray reload lost everything since
  // that press, and the reload silently came back with the stale stash instead.
  let restoredDraft = false;
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      const parsed = JSON.parse(draft);
      if (parsed?.map?.length) { loadLevel(parsed); restoredDraft = true; }
    }
  } catch { /* a corrupt draft is not worth refusing to open the editor over */ }
  if (!restoredDraft) loadLevel(levelData);
  // The game's HUD ships in index.html unconditionally and `updateStatsHud` is
  // only ever called from startGame, so in editor mode `#stats` sat empty in
  // the bottom-left as a bordered pill with nothing in it. Take the corner.
  const gameHud = document.getElementById('hud');
  if (gameHud) gameHud.style.display = 'none';
  setStatus();
  if (restoredDraft) {
    dirty = true; // it is unsaved by definition - it never reached a stash
    toast(`Restored your unsaved draft of “${levelName}”. Reset discards it.`);
  } else {
    toast('Left-click paints · right-click erases · partition works on tile EDGES · Ctrl+Z undoes');
  }

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
