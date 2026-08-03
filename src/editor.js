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
import { COMPANIONS } from './data/companions.js';
import { NPCS } from './data/npcs.js';
import { actorChar, actorLegend, parseActorRef } from './data/actor-registries.js';
import { LEVELS } from './data/levels.js';
import { createControls } from './controls.js';
import { createTileRenderer, computeCarpetZones } from './tile-renderer.js';
import { worldToScreenCss } from './fx.js';
import { parseLevel, parseWallRuns, compressWallRuns, TYPE_ALIASES } from './grid.js';
import { lintLevel } from './level-lint.js';
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
    // Both of these are escaped inside a JSON map row, which turns every row
    // holding one into `\"` noise for a human reading the diff.
    if (ch === '\\' || ch === '"') continue;
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
    // Pool exhausted. There are 86 paintable tile types against 85 usable
    // characters, so this is reachable, not theoretical - and it used to
    // substitute floor in silence under a comment promising it would "say so".
    // (A level only hits it by using that many DISTINCT types, but a tiered
    // placement mints from the same pool, so a busy floor gets there sooner.)
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
  // The camera focus, and the per-frame call that actually MOVES the rig.
  // `controls.pan()` and `recenter()` only mutate the rig's target; `follow()`
  // is the one thing that writes its position, and it was called from exactly
  // one place in the repo - inside startGame. So in the editor the camera was
  // pinned to wherever boot put it, and any pan would have been inert.
  const focus = { x: 0, z: 0 };
  const refocus = () => { focus.x = (width - 1) / 2; focus.z = (height - 1) / 2; };
  app.on('update', (dt) => {
    renderer.animate(dt);
    controls.follow(focus, dt);
  });
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
    refocus();
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
    syncMetaFields?.();
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
    runLint();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, toJson()); } catch { /* private mode, quota */ }
    }, 700);
  }
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  // --- painting -------------------------------------------------------------------
  let brush = 'wall'; // a tile type id, 'player', or 'enemy:<typeId>'
  // Characters this level has minted for tiered placements it PAINTED (as
  // opposed to ones it inherited on load, which live in `tierChars`). Both end
  // up in the same export legend; they are tracked together.
  function charForTier(id, tier) {
    const ref = `${id}@${tier}`;
    for (const [ch, val] of tierChars) if (val === ref) return ch;
    // A tiered placement cannot reuse the actor's canonical char - that char
    // already means "this actor at its own tier", and sharing it would make the
    // two indistinguishable on the map. Mint one from the same pool tiles draw
    // from, then reserve it so no tile can take it.
    const free = (ch) => ch && !reservedChars.has(ch) && !tileByChar[ch];
    const ch = CHAR_POOL.find(free);
    if (!ch) {
      toast(`No map character left to place a tier-${tier} ${id}.`);
      return null;
    }
    reservedChars.add(ch);
    tierChars.set(ch, ref);
    tierCharIds[ch] = id;
    return ch;
  }

  function charForBrush() {
    if (brush === 'player') return PLAYER_CHAR;
    if (brush === 'void') return ' ';
    if (brush.startsWith('enemy:')) {
      const id = brush.slice(6);
      const tier = brushTier();
      // A tier at or below the enemy's own does nothing, so it stays untiered
      // rather than spending a scarce character to say the default out loud.
      if (tier && tier > (ENEMY_TYPES[id].level || 1)) return charForTier(id, tier);
      return ENEMY_TYPES[id].char;
    }
    if (brush.startsWith('actor:')) return actorChar(brush.slice(6));
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

  // --- hover ghost --------------------------------------------------------------
  // One reusable entity, repositioned rather than rebuilt. It shows the CELL a
  // tile brush will write, or the EDGE a partition/door brush has picked.
  let ghost = null;
  let ghostEdge = null;
  let hoverCell = null;
  function ghostMat() {
    const m = new pc.StandardMaterial();
    m.diffuse = new pc.Color(0.55, 0.9, 0.5);
    m.opacity = 0.34;
    m.blendType = pc.BLEND_NORMAL;
    m.depthWrite = false;
    m.update();
    return m;
  }
  function ensureGhosts() {
    if (ghost) return;
    const material = ghostMat();
    ghost = new pc.Entity();
    ghost.addComponent('render', { type: 'box', material });
    ghost.setLocalScale(0.98, 0.06, 0.98);
    app.root.addChild(ghost);
    ghostEdge = new pc.Entity();
    ghostEdge.addComponent('render', { type: 'box', material });
    app.root.addChild(ghostEdge);
  }
  function hideGhost() {
    if (ghost) { ghost.enabled = false; ghostEdge.enabled = false; }
    hoverCell = null;
    setStatus();
  }
  function showGhost(g) {
    if (!g) { hideGhost(); return; }
    ensureGhosts();
    if (brush === 'partition' || brush === 'door') {
      const e = nearestEdge(g);
      ghost.enabled = false;
      if (!e || !edgeInRange(e.o, e.x, e.z)) { ghostEdge.enabled = false; hoverCell = null; setStatus(); return; }
      ghostEdge.enabled = true;
      // Match renderEdgeWall's footprint so the preview reads as the thing it
      // is about to become, not as a generic marker.
      if (e.o === 'h') { ghostEdge.setLocalScale(1, 0.9, 0.12); ghostEdge.setPosition(e.x, 0.45, e.z - 0.5); }
      else { ghostEdge.setLocalScale(0.12, 0.9, 1); ghostEdge.setPosition(e.x - 0.5, 0.45, e.z); }
      hoverCell = { x: Math.round(g.x), z: Math.round(g.z), edge: e };
      setStatus();
      return;
    }
    ghostEdge.enabled = false;
    const x = Math.round(g.x);
    const z = Math.round(g.z);
    if (x < 0 || x >= width || z < 0 || z >= height) { ghost.enabled = false; hoverCell = null; setStatus(); return; }
    ghost.enabled = true;
    ghost.setPosition(x, 0.04, z);
    hoverCell = { x, z, edge: null };
    setStatus();
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
    // Nothing used to preview what a click would do. Worst for the partition
    // brush, which picks an EDGE from the sub-tile fraction of the ground point
    // - a decision the author could not see until after the wall existed.
    onHover: (g) => showGhost(g),
    onHoverLeave: () => hideGhost(),
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
    // Only tiered entries this map actually uses: minting a character for a tier
    // and then painting over it should not leave a legend entry behind.
    const usedChars = new Set();
    for (const r of rows) for (const ch of r) usedChars.add(ch);
    const usedTiers = [...tierChars].filter(([ch]) => usedChars.has(ch));
    const actors = { [PLAYER_CHAR]: 'player', ...actorLegend(), ...Object.fromEntries(usedTiers) };
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
    zIndex: '30', display: 'flex', flexDirection: 'column', gap: '7px',
    maxWidth: '96vw', borderRadius: '10px', padding: '9px',
    font: '12px system-ui, sans-serif', alignItems: 'stretch',
    userSelect: 'none', // or drag-painting selects the button labels
  });
  // TWO surfaces, not one. Everything used to be appended to a single element
  // capped at 42vh with `overflow-y: auto` - so Playtest, Export, Reset, Exit,
  // the size controls and the level loader were the LAST children of the list
  // you scroll through most, and the selected brush was frequently scrolled out
  // of sight. The palette scrolls; the commands never do.
  const palette = document.createElement('div');
  palette.id = 'editor-palette';
  Object.assign(palette.style, {
    display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'center',
    alignItems: 'center', maxHeight: '34vh', overflowY: 'auto',
  });
  const commands = document.createElement('div');
  commands.id = 'editor-commands';
  Object.assign(commands.style, {
    display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center',
    alignItems: 'center', borderTop: '1px solid #3a3a52', paddingTop: '7px',
  });
  const btn = (id, label, host = palette) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    Object.assign(b.style, BUTTON_CHROME, {
      // 40px of target rather than ~30: the game's own hotbar slots are 44px
      // (ui/hud.js) and the editor was the one surface below the house floor.
      padding: '9px 11px', borderRadius: '7px', minHeight: '40px', cursor: 'pointer',
    });
    host.appendChild(b);
    return b;
  };
  const divider = (host = commands) => {
    const s = document.createElement('div');
    Object.assign(s.style, { width: '1px', alignSelf: 'stretch', background: '#3a3a52', margin: '0 4px' });
    host.appendChild(s);
  };

  // The tooltip used to report the map character and nothing else, while the
  // registry it was reading carried solid/tall/height/onEnter/loot/surface/
  // topple/hp/shop/carpet - none of it shown. Whether a prop stops a thrown
  // attack hangs on one 0.75 height threshold (data/tiles.js blocksSight) and
  // was invisible in a paint view of grey boxes.
  const SIGHT_BLOCK_HEIGHT = 0.75;
  function tileTooltip(id, def) {
    const bits = [];
    if (def.solid) bits.push('blocks movement');
    if (def.solid && (def.tall || (def.height ?? 1) >= SIGHT_BLOCK_HEIGHT)) bits.push('blocks sight');
    else if (def.solid) bits.push('shoot over it');
    if (def.surface) bits.push(`surface: ${def.surface}`);
    if (def.loot) bits.push('rummageable');
    if (def.hp) bits.push('breakable');
    if (def.topple) bits.push('topples');
    if (def.shop) bits.push('merchant');
    if (def.carpet) bits.push('carpet zone');
    if (def.stairs) bits.push('stair marker');
    if (id === 'exit') bits.push('the way out');
    const head = `${def.label || id}${def.height != null ? `  (height ${def.height})` : ''}`;
    return [head, bits.join(' · '), def.examine || ''].filter(Boolean).join('\n');
  }

  const brushButtons = [];
  const buttonOf = new Map(); // brush id -> its button, for hotkeys and recents
  const recent = [];
  function selectBrush(id, button) {
    brush = id;
    setStatus();
    for (const b of brushButtons) {
      b.style.borderColor = '#3a3a52';
      b.setAttribute('aria-pressed', 'false');
    }
    // Colour was the ONLY channel signalling the armed brush, on one of ninety
    // buttons, often scrolled out of view. It still is a channel; it is no
    // longer the only one - the status strip names the brush, and the button
    // carries aria-pressed the way the game's own toggle does (ui/hud.js).
    button.style.borderColor = '#8adf76';
    button.setAttribute('aria-pressed', 'true');
    const at = recent.indexOf(id);
    if (at !== -1) recent.splice(at, 1);
    recent.unshift(id);
    if (recent.length > 8) recent.pop();
    renderRecent();
  }

  // Filtering ninety text-only buttons beats scanning them. Matches label and
  // id, hides the rest live, and hides a category row that has nothing left.
  const filterBox = document.createElement('input');
  filterBox.id = 'ed-filter';
  filterBox.type = 'search';
  filterBox.placeholder = 'filter brushes…';
  filterBox.setAttribute('aria-label', 'Filter the brush palette');
  Object.assign(filterBox.style, BUTTON_CHROME, {
    padding: '8px 10px', borderRadius: '7px', minWidth: '150px', cursor: 'text',
  });
  filterBox.oninput = () => {
    const q = filterBox.value.trim().toLowerCase();
    for (const b of brushButtons) {
      const hit = !q || b.textContent.toLowerCase().includes(q) || b.id.slice(6).includes(q);
      b.style.display = hit ? '' : 'none';
    }
    for (const row of palette.querySelectorAll('[data-cat]')) {
      const any = [...row.querySelectorAll('button')].some((b) => b.style.display !== 'none');
      row.style.display = any ? '' : 'none';
    }
  };

  const recentRow = document.createElement('div');
  recentRow.id = 'ed-recent';
  Object.assign(recentRow.style, {
    display: 'none', gap: '5px', flexWrap: 'wrap', alignItems: 'center',
    width: '100%', justifyContent: 'center',
  });
  function renderRecent() {
    recentRow.innerHTML = '';
    if (recent.length < 2) { recentRow.style.display = 'none'; return; }
    recentRow.style.display = 'flex';
    const tag = document.createElement('span');
    tag.textContent = 'recent';
    Object.assign(tag.style, {
      opacity: '.5', letterSpacing: '1px', textTransform: 'uppercase',
      fontSize: '10px', minWidth: '68px', textAlign: 'right',
    });
    recentRow.appendChild(tag);
    for (const id of recent) {
      const src = buttonOf.get(id);
      if (!src) continue;
      const b = document.createElement('button');
      b.textContent = src.textContent;
      b.title = src.title;
      Object.assign(b.style, BUTTON_CHROME, {
        padding: '7px 10px', borderRadius: '7px', minHeight: '36px', cursor: 'pointer',
        borderColor: id === brush ? '#8adf76' : '#3a3a52',
      });
      b.onclick = () => src.click();
      recentRow.appendChild(b);
    }
  }
  {
    // Partitions first - with edge walls they are the main way to build rooms.
    const b = btn('brush-partition', 'partition');
    b.title = 'Partition — a wall on the EDGE between two tiles, not on a tile.\nRight-click erases the nearest edge.';
    b.onclick = () => selectBrush('partition', b);
    brushButtons.push(b); buttonOf.set('partition', b);
  }
  {
    const b = btn('brush-door', 'door');
    b.title = 'Door — replaces a wall on the same edge. Enemies never open one.';
    b.onclick = () => selectBrush('door', b);
    brushButtons.push(b); buttonOf.set('door', b);
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
    row.dataset.cat = cat;
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
      b.title = tileTooltip(id, def);
      b.onclick = () => selectBrush(id, b);
      brushButtons.push(b); buttonOf.set(id, b);
      if (id === brush) { b.style.borderColor = '#8adf76'; b.setAttribute('aria-pressed', 'true'); }
    }
    palette.appendChild(row);
  }
  {
    const b = btn('brush-player', 'player start');
    b.title = 'Player start — exactly one per level. Painting a new one clears the old.';
    b.onclick = () => selectBrush('player', b);
    brushButtons.push(b); buttonOf.set('player', b);
  }
  {
    // Void is a first-class cell - the airspace the layer model is built on, and
    // how a non-rectangular floor plan is drawn. The editor could DESTROY it
    // (erase paints floor, resize fills floor) and never restore it.
    const b = btn('brush-void', 'void');
    b.title = 'Void — a hole in the map. Impassable, not drawn, and what airspace is made of.';
    b.onclick = () => selectBrush('void', b);
    brushButtons.push(b); buttonOf.set('void', b);
  }
  const actorRow = document.createElement('div');
  actorRow.dataset.cat = 'actors';
  Object.assign(actorRow.style, {
    display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center',
    width: '100%', justifyContent: 'center',
  });
  {
    const tag = document.createElement('span');
    tag.textContent = 'actors';
    Object.assign(tag.style, {
      opacity: '.5', letterSpacing: '1px', textTransform: 'uppercase',
      fontSize: '10px', minWidth: '68px', textAlign: 'right',
    });
    actorRow.appendChild(tag);
  }
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    const b = btn('brush-' + id, def.name, actorRow);
    b.title = `${def.name} — native tier ${def.level || 1}.\nFloors do NOT scale enemies: set the tier field to place a tougher one.`;
    b.onclick = () => selectBrush('enemy:' + id, b);
    brushButtons.push(b); buttonOf.set('enemy:' + id, b);
  }
  // Companions and NPCs. They round-tripped correctly and could never be
  // placed, so a second recruitable coworker meant hand-editing JSON.
  for (const reg of [COMPANIONS, NPCS]) {
    for (const [id, def] of Object.entries(reg)) {
      const b = btn('brush-' + id, def.name || id, actorRow);
      b.title = `${def.name || id} — ${reg === COMPANIONS ? 'a recruitable coworker' : 'a talkable coworker'}. Never fights on the office's side.`;
      b.onclick = () => selectBrush('actor:' + id, b);
      brushButtons.push(b); buttonOf.set('actor:' + id, b);
    }
  }
  // The tier stepper. `enemy:<id>` at tier N exports as `<id>@N` under its own
  // character, which is what the format has always supported and the editor
  // could never write.
  const tierField = document.createElement('input');
  tierField.id = 'ed-tier';
  tierField.type = 'number';
  tierField.min = '1';
  tierField.placeholder = 'tier';
  tierField.title = 'Tier for the next enemy you paint. Blank or 1 = the enemy\'s own native tier.';
  tierField.setAttribute('aria-label', 'Enemy tier');
  Object.assign(tierField.style, BUTTON_CHROME, {
    padding: '7px 8px', borderRadius: '7px', width: '58px', cursor: 'text',
  });
  actorRow.appendChild(tierField);
  const brushTier = () => {
    const n = parseInt(tierField.value, 10);
    return Number.isInteger(n) && n > 1 ? n : null;
  };
  palette.appendChild(actorRow);

  divider();

  // --- level identity ---------------------------------------------------------
  const field = (id, placeholder, width, title) => {
    const i = document.createElement('input');
    i.id = id;
    i.placeholder = placeholder;
    i.title = title;
    i.setAttribute('aria-label', title);
    Object.assign(i.style, BUTTON_CHROME, {
      padding: '8px 9px', borderRadius: '7px', width, cursor: 'text',
    });
    commands.appendChild(i);
    return i;
  };
  const nameField = field('ed-name', 'floor name', '150px', 'The name shown when this floor loads');
  nameField.oninput = () => { levelName = nameField.value; markDirty(); setStatus(); };
  const depthField = field('ed-depth', 'depth', '62px',
    'The floor number. Enemies do NOT scale with it - place a tier explicitly to make one tougher.');
  depthField.type = 'number';
  depthField.min = '1';
  depthField.oninput = () => {
    const n = parseInt(depthField.value, 10);
    levelDepth = Number.isInteger(n) && n > 0 ? n : undefined;
    markDirty();
  };
  const nextField = document.createElement('select');
  nextField.id = 'ed-next';
  nextField.title = 'The floor this one\'s exit leads to. Blank = the run ends here.';
  nextField.setAttribute('aria-label', 'Next floor');
  Object.assign(nextField.style, BUTTON_CHROME, { padding: '8px', borderRadius: '7px', cursor: 'pointer' });
  nextField.innerHTML = '<option value="">next: (ends the run)</option>'
    + Object.entries(LEVELS).filter(([, l]) => !l.layers)
      .map(([id, l]) => `<option value="${id}">next: ${l.name || id}</option>`).join('');
  nextField.onchange = () => { levelNext = nextField.value || undefined; markDirty(); };
  commands.appendChild(nextField);
  // Keep the fields honest when a load replaces the document under them.
  function syncMetaFields() {
    nameField.value = levelName || '';
    depthField.value = levelDepth == null ? '' : String(levelDepth);
    nextField.value = levelNext || '';
  }

  divider();

  // size controls
  const sizeLabel = document.createElement('span');
  sizeLabel.id = 'ed-size';
  Object.assign(sizeLabel.style, { padding: '0 4px', opacity: '.8' });
  function updateSizeLabel() { sizeLabel.textContent = `${width}×${height}`; }
  btn('ed-shrink-w', '−col', commands).onclick = () => resize(-1, 0);
  btn('ed-grow-w', '+col', commands).onclick = () => resize(1, 0);
  btn('ed-shrink-h', '−row', commands).onclick = () => resize(0, -1);
  btn('ed-grow-h', '+row', commands).onclick = () => resize(0, 1);
  commands.appendChild(sizeLabel);
  divider();
  commands.appendChild(filterBox);

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
  commands.appendChild(select);

  btn('ed-undo', '↶ Undo', commands).onclick = () => undo();
  btn('ed-redo', '↷ Redo', commands).onclick = () => redo();

  btn('ed-playtest', '▶ Playtest', commands).onclick = () => {
    localStorage.setItem(stashKey, toJson());
    dirty = false; // the stash IS a save - leaving for it is not losing work
    clearDraft();
    location.hash = '';
    location.reload();
  };
  btn('ed-export', 'Export JSON', commands).onclick = showExport;
  // Reset and Exit each throw the session away. They used to do it on one
  // unconfirmed click, styled identically to Export sitting beside them.
  const dangerBtn = (id, label, confirmText, act) => {
    const b = btn(id, label, commands);
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
    if (e.key === 'Escape') { document.getElementById('export-modal')?.remove(); return; }
    if (mod) return; // leave the browser's own chords alone
    const k = e.key.toLowerCase();
    // Overhead. `controls` has had this since the game shipped it on the HUD
    // rail and the T key; the editor - where precise clicking matters most -
    // never offered it. Its own comment is the argument: overhead is where tile
    // boundaries stop being ambiguous.
    if (k === 't') { e.preventDefault(); controls.toggleTactical(); return; }
    if (k === 'home' || k === 'f') { e.preventDefault(); refocus(); toast('Camera re-centred on the map.'); return; }
    const PAN = 1.6;
    const step = { w: [0, -PAN], s: [0, PAN], a: [-PAN, 0], d: [PAN, 0] }[k]
      || { arrowup: [0, -PAN], arrowdown: [0, PAN], arrowleft: [-PAN, 0], arrowright: [PAN, 0] }[k];
    if (step) {
      e.preventDefault();
      focus.x += step[0];
      focus.z += step[1];
      return;
    }
    // Brush cycling: [ and ] step through the palette in the order it is drawn,
    // so a nearby brush is one key away rather than a scan of ninety buttons.
    if (k === '[' || k === ']') {
      e.preventDefault();
      const visible = brushButtons.filter((b) => b.style.display !== 'none');
      if (!visible.length) return;
      const cur = visible.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
      const nextI = (cur + (k === ']' ? 1 : -1) + visible.length) % visible.length;
      visible[nextI].click();
      visible[nextI].scrollIntoView({ block: 'nearest' });
    }
  });

  // The browser's own "you have unsaved changes" prompt is the only thing that
  // survives a tab close, a back button, or a reload typed into the bar.
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
  palette.appendChild(recentRow);
  bar.appendChild(palette);
  bar.appendChild(commands);
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
  // What is under the cursor, named the way the author thinks about it: the
  // tile's label, or the actor standing there, or "void".
  function underCursor() {
    if (!hoverCell) return '';
    const { x, z, edge } = hoverCell;
    if (edge) {
      const k = edge.x + ',' + edge.z;
      const has = (edge.o === 'h' ? hWalls : vWalls).has(k) ? 'wall'
        : (edge.o === 'h' ? hDoors : vDoors).has(k) ? 'door' : 'open';
      return `<br><span style="opacity:.75">edge ${edge.o.toUpperCase()} ${edge.x},${edge.z} — ${has}</span>`;
    }
    const c = rows[z]?.[x];
    let what;
    if (c === undefined) what = 'off-map';
    else if (c === ' ') what = 'void';
    else if (c === PLAYER_CHAR) what = 'player start';
    else if (actorIdByChar[c] || tierCharIds[c]) what = tierChars.get(c) || actorIdByChar[c];
    else what = TILE_TYPES[tileByChar[c]]?.label || tileByChar[c] || 'floor';
    return `<br><span style="opacity:.75">${x},${z} — ${what} <span style="opacity:.6">“${c === ' ' ? '␣' : c ?? '·'}”</span></span>`;
  }
  // The editor validated NOTHING. Every rule below already existed as an
  // assertion in the test suite, which only runs over files already in levels/ -
  // so the tool that produces those files could happily Export a floor with no
  // exit, or an exit sealed off from the spawn, and you found out from CI.
  // Same module the suite calls (src/level-lint.js), debounced.
  let lintTimer = null;
  let findings = [];
  function runLint() {
    clearTimeout(lintTimer);
    lintTimer = setTimeout(() => {
      try { findings = lintLevel(JSON.parse(toJson())); } catch { findings = []; }
      setStatus();
    }, 350);
  }
  function lintHtml() {
    if (!findings.length) return '<br><span style="color:#8adf76">✓ playable</span>';
    const errs = findings.filter((f) => f.level === 'error');
    const warns = findings.filter((f) => f.level === 'warn');
    const line = (f) => `<br><span style="color:${f.level === 'error' ? '#ff8f9e' : '#f0c674'}">`
      + `${f.level === 'error' ? '✕' : '!'} ${f.message}</span>`;
    // Errors in full - they stop the floor working. Warnings collapse past two,
    // or a messy work-in-progress buries the readout it shares a box with.
    return errs.map(line).join('') + warns.slice(0, 2).map(line).join('')
      + (warns.length > 2 ? `<br><span style="color:#f0c674">! +${warns.length - 2} more</span>` : '');
  }

  function setStatus() {
    const ch = charByType[brush];
    status.innerHTML = `<b>${levelName || 'Untitled Floor'}</b> &nbsp; ${width}×${height}`
      + `<br>brush: <b style="color:#8adf76">${brushLabel()}</b>`
      + (ch ? ` <span style="opacity:.6">writes “${ch}”</span>` : '')
      + underCursor()
      + lintHtml();
  }

  // levels/<id>.json - the id is the filename, and the lint derives it from
  // there, so the download names itself after the floor.
  const suggestedId = () => (levelName || 'untitled')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

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
    const btnCss = 'padding:8px 16px; border-radius:7px; border:1px solid #3a3a52;'
      + ' background:#2e2e46; color:#f0f0f5; font:inherit; cursor:pointer;';
    // The workflow is "output json, upload to the git" (designer, 2026-08-02),
    // so Download is the primary action: it needs no server, works identically
    // in a local build and a deployed one, and lands a file ready to move into
    // levels/ and commit. Copy stays for pasting somewhere.
    div.innerHTML = `
      <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px; padding:18px; width:min(680px,92vw);">
        <div style="font-weight:700; margin-bottom:4px;">Level JSON</div>
        <div id="export-note" style="opacity:.75; margin-bottom:8px; font-size:12px;"></div>
        <textarea id="export-json" spellcheck="false" style="width:100%; height:300px; background:#171722; color:#c9e4a5;
          border:1px solid #3a3a52; border-radius:8px; padding:10px; font:12px monospace; white-space:pre;"></textarea>
        <div style="opacity:.6; font-size:11px; margin-top:6px;">Editable — paste a level in and press Load to keep working on it.</div>
        <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end; flex-wrap:wrap;">
          <button id="export-load" style="${btnCss}">Load this JSON</button>
          <button id="export-copy" style="${btnCss}">Copy</button>
          <button id="export-download" style="${btnCss} border-color:#4d7a4a;">⬇ Download</button>
          <button id="export-close" style="${btnCss}">Close</button>
        </div>
      </div>`;
    document.body.appendChild(div);
    const ta = div.querySelector('#export-json');
    ta.value = toJson();
    // Say up front whether this file is shippable, rather than letting CI say it.
    const note = div.querySelector('#export-note');
    const errs = findings.filter((f) => f.level === 'error');
    note.innerHTML = errs.length
      ? `<span style="color:#ff8f9e">This floor cannot be finished: ${errs[0].message}</span>`
      : `<span style="color:#8adf76">✓ playable</span> — save as <code>levels/${suggestedId()}.json</code>`
        + ' and register it in <code>src/data/levels.js</code>.';
    div.querySelector('#export-copy').onclick = () => {
      ta.select(); // visible feedback either way
      navigator.clipboard?.writeText(ta.value).catch(() => {});
    };
    div.querySelector('#export-download').onclick = () => {
      const blob = new Blob([ta.value], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${suggestedId()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Downloaded ${suggestedId()}.json — move it into levels/ and register it.`);
    };
    // The only way back INTO the editor used to be the single-slot playtest
    // stash, so a level you had exported could not be picked up again.
    div.querySelector('#export-load').onclick = () => {
      let parsed;
      try { parsed = JSON.parse(ta.value); } catch (e) { toast(`That is not valid JSON: ${e.message}`); return; }
      if (!Array.isArray(parsed?.map) || !parsed.map.length) { toast('That JSON has no `map` array.'); return; }
      try {
        pushHistory();
        loadLevel(parsed);
        div.remove();
        toast(`Loaded “${levelName}”.`);
      } catch (e) {
        toast(`That level would not load: ${e.message}`);
      }
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
