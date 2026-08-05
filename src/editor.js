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
import { TILE_TYPES, TILE_CATEGORIES } from './data/tiles.js';
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
import { parseFloors } from './floors.js';
import * as preview from './level-preview.js';
import { installEditorStyles } from './editor-styles.js';
import { toast, BUTTON_CHROME } from './ui.js';

const pc = globalThis.window?.pc;

// Every character a tile type may be allocated in a level's legend: printable
// ASCII, then the printable Latin-1 block.
//
// The second half is headroom the first half had run out of. ASCII gives 93
// usable characters, '@' and the six actor characters are reserved off it, and
// the registry has 87 paintable types - so the pool was ONE short of the types
// it must be able to name, and the 87th distinct type on a level painted plain
// floor with no message at all (Q056). Map rows are JSON strings and
// `parseLevel` indexes single BMP characters, so Latin-1 costs nothing and
// round-trips; a type's preferred registry character is still claimed first,
// so no hand-authored level changes by a byte.
//
// Exported for the test that pins the headroom - the wall this hit is exactly
// the kind that should be a red suite rather than a brush that does nothing.
export const CHAR_POOL = [];
for (let c = 33; c < 127; c++) {
  const ch = String.fromCharCode(c);
  // Both of these are escaped inside a JSON map row, which turns every row
  // holding one into `\"` noise for a human reading the diff.
  if (ch === '\\' || ch === '"') continue;
  CHAR_POOL.push(ch);
}
for (let c = 0xA1; c <= 0xFF; c++) {
  if (c === 0xAD) continue; // soft hyphen: invisible in an editor, unfindable in a diff
  CHAR_POOL.push(String.fromCharCode(c));
}
const PLAYER_CHAR = '@';
const MIN_SIZE = 4;
const MAX_SIZE = 40;

export function startEditor(app, levelData, stashKey) {
  installEditorStyles();
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
  // Per-PLACEMENT rotation: "x,z" -> 90/180/270. Sparse - a cell with no entry
  // draws at its tile type's own rotY, which is what every level did before
  // this existed (EDITOR_INVENTORY IQ4).
  let propRot = new Map();

  // --- storeys (EDITOR_PLAN M4) -------------------------------------------------
  // A level may be several full storeys stacked bottom-up. The variables above
  // are always the ACTIVE storey; the others park in `storeys`. That keeps
  // every painting path - paint, paintEdge, resize, undo, the lint - working on
  // a flat map exactly as before, which is the whole point of the layer model:
  // painting a floor IS the editor's existing job.
  let storeys = [];   // parked { rows, hWalls, vWalls, hDoors, vDoors, propRot, height }
  let active = 0;
  const STOREY_DEFAULT_H = 2.1; // matches floors.js STOREY_H
  const cloneStorey = (st) => ({
    rows: st.rows.map((r) => r.slice()),
    hWalls: new Set(st.hWalls), vWalls: new Set(st.vWalls),
    hDoors: new Set(st.hDoors), vDoors: new Set(st.vDoors),
    propRot: new Map(st.propRot),
    height: st.height ?? STOREY_DEFAULT_H,
  });
  const captureStorey = () => ({
    rows: rows.map((r) => r.slice()),
    hWalls: new Set(hWalls), vWalls: new Set(vWalls),
    hDoors: new Set(hDoors), vDoors: new Set(vDoors),
    propRot: new Map(propRot),
    height: storeys[active]?.height ?? STOREY_DEFAULT_H,
  });
  function adoptStorey(st) {
    rows = st.rows.map((r) => r.slice());
    hWalls = new Set(st.hWalls); vWalls = new Set(st.vWalls);
    hDoors = new Set(st.hDoors); vDoors = new Set(st.vDoors);
    propRot = new Map(st.propRot);
    height = rows.length;
    width = rows.length ? Math.max(...rows.map((r) => r.length)) : 0;
  }
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
  // The pool itself is at module scope (CHAR_POOL), so a node test can check
  // it is big enough instead of a level author discovering it is not.
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
        rotY: propRot.get(key) ?? null,
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

  // --- grid, rulers, boundary (C7) ---------------------------------------------
  // `renderFloor` draws continuous carpet with +/-0.018 tint variation, with the
  // explicit intent that surfaces "read as continuous carpet instead of a grid
  // of tiles" (tile-renderer.js). Correct for the game and wrong for the tool:
  // counting cells was done by eye against a surface engineered to hide cell
  // boundaries. Editor-only, so the game's look is untouched.
  let gridEntities = [];
  let gridMat = null;
  let showGrid = true;
  function renderGrid() {
    for (const e of gridEntities) e.destroy();
    gridEntities = [];
    if (!showGrid || !width || !height) return;
    if (!gridMat) {
      gridMat = new pc.StandardMaterial();
      gridMat.diffuse = new pc.Color(0.1, 0.1, 0.14);
      gridMat.emissive = new pc.Color(0.28, 0.3, 0.38);
      gridMat.opacity = 0.3;
      gridMat.blendType = pc.BLEND_NORMAL;
      gridMat.depthWrite = false;
      gridMat.update();
    }
    const line = (x, y, z, sx, sz) => {
      const e = new pc.Entity();
      e.addComponent('render', { type: 'box', material: gridMat });
      e.setLocalScale(sx, 0.01, sz);
      e.setPosition(x, y, z);
      app.root.addChild(e);
      gridEntities.push(e);
    };
    // Every fifth line is brighter, which is what makes counting possible at a
    // glance rather than one tile at a time.
    for (let x = 0; x <= width; x++) {
      line(x - 0.5, 0.02, height / 2 - 0.5, x % 5 === 0 ? 0.06 : 0.02, height);
    }
    for (let z = 0; z <= height; z++) {
      line(width / 2 - 0.5, 0.02, z - 0.5, width, z % 5 === 0 ? 0.06 : 0.02);
    }
  }

  // A faint copy of the storey below, so painting a mezzanine is not done blind
  // over a floor you cannot see. Flat quads only - the real renderer would cost
  // a whole second map of props for something that is a positioning aid.
  let onionEntities = [];
  let onionMat = null;
  function renderOnionSkin() {
    for (const e of onionEntities) e.destroy();
    onionEntities = [];
    if (active === 0) return;
    const below = storeys[active - 1];
    if (!below) return;
    if (!onionMat) {
      onionMat = new pc.StandardMaterial();
      onionMat.diffuse = new pc.Color(0.45, 0.62, 0.85);
      onionMat.opacity = 0.22;
      onionMat.blendType = pc.BLEND_NORMAL;
      onionMat.depthWrite = false;
      onionMat.update();
    }
    for (let z = 0; z < below.rows.length; z++) {
      for (let x = 0; x < below.rows[z].length; x++) {
        const ch = below.rows[z][x];
        if (ch === ' ') continue;              // void below shows as nothing
        if (rows[z]?.[x] !== undefined && rows[z][x] !== ' ') continue; // covered anyway
        const e = new pc.Entity();
        e.addComponent('render', { type: 'box', material: onionMat });
        e.setLocalScale(0.92, 0.02, 0.92);
        e.setPosition(x, -0.06, z);
        app.root.addChild(e);
        onionEntities.push(e);
      }
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
    renderGrid();
    renderOnionSkin();
    updateSizeLabel();
    refocus();
    setStatus();
  }

  function loadLevel(data) {
    // A layered level's storeys share one legend; only the maps and edge runs
    // differ. Storey 0 is the working set and the rest park until you switch.
    const layerDefs = Array.isArray(data.layers) && data.layers.length
      ? data.layers
      : [{ map: data.map, walls: data.walls, doors: data.doors, height: undefined }];
    selection = null;
    const ground = layerDefs[0];
    height = ground.map.length;
    width = Math.max(...ground.map.map((r) => r.length));
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
    const rowsOf = (map, w) => map.map((r) => {
      const a = r.split('').map(canonical);
      while (a.length < w) a.push(' ');
      return a;
    });
    rows = rowsOf(ground.map, width);
    propRot = new Map();
    for (const p of (ground.props || data.props || [])) {
      const r = ((Math.round((p.rotY || 0) / 90) * 90) % 360 + 360) % 360;
      if (r && Number.isFinite(p.x) && Number.isFinite(p.z)) propRot.set(p.x + ',' + p.z, r);
    }
    ({ h: hWalls, v: vWalls } = parseWallRuns(ground.walls));
    ({ h: hDoors, v: vDoors } = parseWallRuns(ground.doors));
    // A door REPLACES any wall on its edge (grid.js applies the same rule when
    // the game parses a level). A hand-authored file may legitimately run a
    // wall straight through a doorway; without this the editor rendered both
    // on one edge, lost the wall entity's handle so it could never be erased,
    // and exported the edge into `walls` AND `doors`.
    for (const k of hDoors) hWalls.delete(k);
    for (const k of vDoors) vWalls.delete(k);
    // Park every storey, including the ground one, so `storeys` is always the
    // whole level and `active` indexes into it.
    active = 0;
    storeys = layerDefs.map((L, i) => {
      const w = Math.max(...L.map.map((r) => r.length));
      const hw = parseWallRuns(L.walls);
      const hd = parseWallRuns(L.doors);
      for (const k of hd.h) hw.h.delete(k);
      for (const k of hd.v) hw.v.delete(k);
      const rot = new Map();
      for (const pr of (i === 0 ? (data.props || []) : (L.props || []))) {
        const r = ((Math.round((pr.rotY || 0) / 90) * 90) % 360 + 360) % 360;
        if (r && Number.isFinite(pr.x) && Number.isFinite(pr.z)) rot.set(pr.x + ',' + pr.z, r);
      }
      return {
        rows: rowsOf(L.map, w),
        hWalls: hw.h, vWalls: hw.v, hDoors: hd.h, vDoors: hd.v,
        propRot: rot,
        height: L.height ?? STOREY_DEFAULT_H,
      };
    });
    levelName = data.name || 'Untitled Floor';
    levelNext = data.next;
    levelDepth = data.depth;
    renderAll();
    syncMetaFields?.();
    renderStoreyTabs?.();
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
  const documentStoreys = () => {
    const source = storeys.length ? storeys : [captureStorey()];
    return source.map((st, i) => cloneStorey(i === active ? captureStorey() : st));
  };
  const snapshot = () => ({
    // History owns the WHOLE document. The previous flat-map snapshot could
    // undo a brush stroke, but not an add/remove-storey command that had
    // changed the document around the active map.
    storeys: documentStoreys(), active,
    levelName, levelNext, levelDepth,
    tierChars: new Map(tierChars), tierCharIds: { ...tierCharIds },
    reservedChars: new Set(reservedChars), tileByChar: { ...tileByChar }, charByType: { ...charByType },
  });
  const restore = (s) => {
    storeys = s.storeys.map(cloneStorey);
    active = Math.min(s.active, storeys.length - 1);
    adoptStorey(storeys[active]);
    selection = null;
    levelName = s.levelName; levelNext = s.levelNext; levelDepth = s.levelDepth;
    tierChars = new Map(s.tierChars); tierCharIds = { ...s.tierCharIds };
    reservedChars = new Set(s.reservedChars); tileByChar = { ...s.tileByChar }; charByType = { ...s.charByType };
    renderAll();
    syncMetaFields?.();
    renderStoreyTabs?.();
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
    markDirty();
    toast(`Undo. (${history.length} step${history.length === 1 ? '' : 's'} left)`);
  }
  function redo() {
    if (!future.length) { toast('Nothing to redo.'); return; }
    history.push(snapshot());
    restore(future.pop());
    markDirty();
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
  // Selection is deliberately separate from the document and the brush. It
  // must never create undo noise, dirty a draft, or repaint a cell merely
  // because the author wanted to inspect it.
  let editorMode = 'select'; // 'select' | 'paint'
  let selectEdges = false;
  let selection = null; // { kind: 'cell' | 'edge', x, z, o? }
  function selectCell(tile) {
    if (!tile || tile.x < 0 || tile.x >= width || tile.z < 0 || tile.z >= height) return;
    selection = { kind: 'cell', x: tile.x, z: tile.z };
    updateInspector();
  }
  function selectEdge(edge) {
    if (!edge || !edgeInRange(edge.o, edge.x, edge.z)) return;
    selection = { kind: 'edge', ...edge };
    updateInspector();
  }
  function rotatePropAt(x, z, delta = 90) {
    const type = tileByChar[rows[z]?.[x]];
    const def = type && TILE_TYPES[type];
    if (!def?.model) return false;
    pushHistory();
    const key = x + ',' + z;
    const next = (((propRot.get(key) ?? (def.rotY || 0)) + delta) % 360 + 360) % 360;
    if (next === (def.rotY || 0)) propRot.delete(key); else propRot.set(key, next);
    renderCell(x, z);
    markDirty();
    updateInspector();
    return true;
  }
  function updateInspector() {
    if (!selectionInfo) return;
    selectionInfo.innerHTML = '';
    if (!selection) {
      selectionInfo.innerHTML = '<div id="editor-selection-empty">No selection.</div>';
      return;
    }
    const card = document.createElement('div');
    card.className = 'editor-inspector-card';
    const facts = document.createElement('dl');
    facts.className = 'editor-inspector-facts';
    const fact = (label, value) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      facts.append(dt, dd);
    };
    const actions = document.createElement('div');
    actions.className = 'editor-inspector-actions';
    if (selection.kind === 'edge') {
      card.innerHTML = `<h3>${selection.o.toUpperCase()} edge ${selection.x},${selection.z}</h3>`;
      const set = selection.o === 'h' ? hWalls : vWalls;
      const doors = selection.o === 'h' ? hDoors : vDoors;
      fact('Contains', doors.has(selection.x + ',' + selection.z) ? 'Door' : set.has(selection.x + ',' + selection.z) ? 'Partition' : 'Open edge');
      const remove = document.createElement('button');
      remove.textContent = 'Clear edge';
      Object.assign(remove.style, BUTTON_CHROME, { padding: '6px 8px', borderRadius: '5px' });
      remove.onclick = () => { beginStroke(); paintEdge(selection, false); updateInspector(); };
      actions.appendChild(remove);
    } else {
      const { x, z } = selection;
      const ch = rows[z]?.[x];
      card.innerHTML = `<h3>Tile ${x},${z}</h3>`;
      if (ch === undefined) {
        fact('State', 'Outside this storey');
      } else if (ch === ' ') {
        fact('State', 'Void / airspace');
      } else if (ch === PLAYER_CHAR) {
        fact('Placement', 'Player start');
        fact('Ground', 'Implicit floor');
      } else if (actorIdByChar[ch] || tierCharIds[ch]) {
        fact('Placement', tierChars.get(ch) || actorIdByChar[ch]);
        fact('Ground', 'Implicit floor');
      } else {
        const type = tileByChar[ch] || 'floor';
        const def = TILE_TYPES[type] || TILE_TYPES.floor;
        fact('Terrain', def.label || type);
        fact('Movement', def.solid ? 'Blocked' : 'Walkable');
        fact('Sight', def.solid && (def.tall || (def.height ?? 1) >= SIGHT_BLOCK_HEIGHT) ? 'Blocked' : 'Open');
        if (def.surface) fact('Surface', def.surface);
        if (def.model) fact('Rotation', `${propRot.get(x + ',' + z) ?? def.rotY ?? 0} degrees`);
        if (def.model) {
          const rotate = document.createElement('button');
          rotate.textContent = 'Rotate';
          Object.assign(rotate.style, BUTTON_CHROME, { padding: '6px 8px', borderRadius: '5px' });
          rotate.onclick = () => rotatePropAt(x, z);
          actions.appendChild(rotate);
        }
      }
      if (ch !== undefined && ch !== ' ') {
        const clear = document.createElement('button');
        clear.textContent = 'Clear tile';
        Object.assign(clear.style, BUTTON_CHROME, { padding: '6px 8px', borderRadius: '5px' });
        clear.onclick = () => { beginStroke(); paint({ x, z }, charOfType('floor')); updateInspector(); };
        actions.appendChild(clear);
      }
    }
    card.appendChild(facts);
    if (actions.children.length) card.appendChild(actions);
    selectionInfo.appendChild(card);
  }
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
    if (brush === 'stamp') return null; // placed by stampAt, not by a character
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

  // While a batch is open, paint() mutates rows and records which cells to
  // redraw, and the two global passes (conduction, carpet) run ONCE at the end.
  let batch = null;
  function inBatch(run) {
    if (batch) { run(); return; } // already inside one - don't nest the passes
    batch = new Set();
    try {
      run();
    } finally {
      const touched = batch;
      batch = null;
      if (touched.size) {
        refreshElectrified();
        refreshCarpet();
        for (const k of touched) {
          const [cx, cz] = k.split(',').map(Number);
          // The neighbour halo can fall off the map; renderCell indexes rows
          // directly and would throw.
          if (cx >= 0 && cx < width && cz >= 0 && cz < height) renderCell(cx, cz);
        }
      }
    }
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
    if (batch) {
      // Defer both global passes and every redraw to the end of the batch.
      // Neighbours go in too, for the same pool-shaping reason as below.
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) batch.add((x + dx) + ',' + (z + dz));
      }
      return;
    }
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
  // Grow or shrink from the TOP/LEFT. The map could only ever change at its
  // right and bottom edges, so adding a corridor to the north meant repainting
  // the whole floor one row down. Shifting rows is easy; the edge runs are the
  // real work, since every wall and door key is an absolute coordinate.
  function shift(dx, dz) {
    if (!dx && !dz) return;
    const nw = Math.min(MAX_SIZE, Math.max(MIN_SIZE, width + dx));
    const nh = Math.min(MAX_SIZE, Math.max(MIN_SIZE, height + dz));
    if (nw === width && nh === height) return;
    pushHistory();
    const blank = charOfType('floor');
    if (dz > 0) for (let i = 0; i < dz; i++) rows.unshift(new Array(width).fill(blank));
    else for (let i = 0; i < -dz; i++) rows.shift();
    if (dx > 0) for (const row of rows) for (let i = 0; i < dx; i++) row.unshift(blank);
    else for (const row of rows) for (let i = 0; i < -dx; i++) row.shift();
    width = nw;
    height = nh;
    const move = (set, o) => new Set([...set].map((k) => {
      const [x, z] = k.split(',').map(Number);
      return (x + dx) + ',' + (z + dz);
    }).filter((k) => {
      const [x, z] = k.split(',').map(Number);
      return edgeInRange(o, x, z);
    }));
    hWalls = move(hWalls, 'h');
    vWalls = move(vWalls, 'v');
    hDoors = move(hDoors, 'h');
    vDoors = move(vDoors, 'v');
    renderAll();
    markDirty();
  }

  function resize(dw, dh) {
    const nw = Math.min(MAX_SIZE, Math.max(MIN_SIZE, width + dw));
    const nh = Math.min(MAX_SIZE, Math.max(MIN_SIZE, height + dh));
    if (nw === width && nh === height) return;
    pushHistory();
    const ow = Math.min(nw, width);
    const oh = Math.min(nh, height);
    // Conduction and carpet are global passes, so a NEW cell can recolour an
    // old one; only a pure shrink leaves the interior provably untouched.
    const grew = nw > width || nh > height;
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
    // Incremental. `renderAll` destroys and re-creates EVERY entity on the map
    // and re-instantiates each .glb prop - and growing to the 40x40 ceiling is
    // ~30 clicks, each a full teardown of a map that is getting larger every
    // click, which is the worst possible cost curve for the one interaction
    // that reaches the advertised limit. Only the cells that appeared or
    // vanished need touching.
    for (const [k, list] of [...cellEntities]) {
      const [cx, cz] = k.split(',').map(Number);
      if (cx < width && cz < height) continue;
      for (const e of list) e.destroy();
      cellEntities.delete(k);
      cellVersion.set(k, (cellVersion.get(k) || 0) + 1); // orphan any in-flight model load
    }
    electrified = computeElectrifiedSet();
    carpet = computeCarpet();
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        if (x < ow && z < oh && !grew) continue; // untouched interior
        renderCell(x, z);
      }
    }
    renderAllEdges();
    renderGrid();
    renderOnionSkin();
    updateSizeLabel();
    refocus();
    setStatus();
    markDirty();
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
    if (editorMode === 'select' && selectEdges) {
      const e = nearestEdge(g);
      ghost.enabled = false;
      if (!e || !edgeInRange(e.o, e.x, e.z)) { ghostEdge.enabled = false; hoverCell = null; setStatus(); return; }
      ghostEdge.enabled = true;
      if (e.o === 'h') { ghostEdge.setLocalScale(1, 0.16, 0.12); ghostEdge.setPosition(e.x, 0.1, e.z - 0.5); }
      else { ghostEdge.setLocalScale(0.12, 0.16, 1); ghostEdge.setPosition(e.x - 0.5, 0.1, e.z); }
      hoverCell = { x: Math.round(g.x), z: Math.round(g.z), edge: e };
      setStatus();
      return;
    }
    if (editorMode === 'paint' && (brush === 'partition' || brush === 'door')) {
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
    // A prop's MESH can overhang its cell while its collision never does - a
    // conference table is faked as adjacent copies and blocks only the tiles
    // under them. Widen the ghost to the model's real scale so the mismatch is
    // visible rather than discovered in play (EDITOR_INVENTORY H4; rotation
    // lifted H3, this is the half it did not).
    const hoverDef = TILE_TYPES[tileByChar[rows[z]?.[x]]];
    const spread = hoverDef?.model ? Math.max(1, hoverDef.scale || 1) : 1;
    ghost.setLocalScale(0.98 * spread, 0.06, 0.98 * spread);
    ghost.setPosition(x, 0.04, z);
    hoverCell = { x, z, edge: null };
    if (overlay === 'fire') drawOverlay(); // the burn is traced FROM the cursor
    setStatus();
  }

  // --- the editing vocabulary ---------------------------------------------------
  // The whole vocabulary used to be one cell (or one edge) at a time. These are
  // the four that a room-painting session actually wants, all riding modifiers
  // on the existing click handler rather than a mode you have to remember you
  // are in.
  const isEdgeBrush = () => editorMode === 'paint' && (brush === 'partition' || brush === 'door');

  // Walk the integer line between two cells. A drag samples per mousemove with
  // no interpolation, so a fast swipe left gaps in the painted line.
  function cellsOnLine(a, b) {
    const out = [];
    let x0 = a.x;
    let z0 = a.z;
    const dx = Math.abs(b.x - x0);
    const dz = Math.abs(b.z - z0);
    const sx = x0 < b.x ? 1 : -1;
    const sz = z0 < b.z ? 1 : -1;
    let err2 = dx - dz;
    for (;;) {
      out.push({ x: x0, z: z0 });
      if (x0 === b.x && z0 === b.z) break;
      const e2 = 2 * err2;
      if (e2 > -dz) { err2 -= dz; x0 += sx; }
      if (e2 < dx) { err2 += dx; z0 += sz; }
    }
    return out;
  }

  // Contiguous fill over cells that currently read the same as the seed. Reuses
  // the same 4-neighbour walk the conduction pools use, over characters.
  function fillFrom(seed, ch) {
    const from = rows[seed.z]?.[seed.x];
    if (from === undefined || from === ch) return;
    const seen = new Set([seed.x + ',' + seed.z]);
    const stack = [seed];
    const cells = [];
    while (stack.length) {
      const c = stack.pop();
      cells.push(c);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx;
        const nz = c.z + dz;
        const k = nx + ',' + nz;
        if (seen.has(k)) continue;
        if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
        if (rows[nz][nx] !== from) continue;
        seen.add(k);
        stack.push({ x: nx, z: nz });
      }
    }
    inBatch(() => { for (const c of cells) paint(c, ch); });
  }

  // Alt-click reads the map instead of writing to it. Reusing a type already on
  // the floor meant hunting a ninety-button palette for it.
  function eyedrop(tile) {
    const ch = rows[tile.z]?.[tile.x];
    if (ch === undefined) return;
    let id = null;
    if (ch === PLAYER_CHAR) id = 'player';
    else if (ch === ' ') id = 'void';
    else if (tierCharIds[ch]) id = 'enemy:' + tierCharIds[ch];
    else if (actorIdByChar[ch]) {
      id = ENEMY_TYPES[actorIdByChar[ch]] ? 'enemy:' + actorIdByChar[ch] : 'actor:' + actorIdByChar[ch];
    } else if (tileByChar[ch]) id = tileByChar[ch];
    const b = id && buttonOf.get(id);
    if (!b) { toast('Nothing to pick up there.'); return; }
    b.click();
    b.scrollIntoView({ block: 'nearest' });
  }

  // The last cell a stroke wrote, so shift-click can draw a line to the next one.
  let lastPainted = null;

  // Erase what is UNDER the cursor rather than whatever the brush is about.
  // Right-clicking a partition with a tile brush selected used to erase the
  // cell and leave the partition standing, and vice versa - so erasing meant
  // first selecting the right brush to erase with.
  function eraseAt(t, g) {
    const e = nearestEdge(g);
    if (e && edgeInRange(e.o, e.x, e.z)) {
      const k = e.x + ',' + e.z;
      const onEdge = (e.o === 'h' ? hWalls : vWalls).has(k) || (e.o === 'h' ? hDoors : vDoors).has(k);
      // An edge only wins if something is actually on it; otherwise a walled
      // cubicle would swallow every attempt to erase the floor inside it.
      if (onEdge) { paintEdge(e, false); return; }
    }
    if (t) paint(t, charOfType('floor'));
  }

  // --- the stamp ---------------------------------------------------------------
  // The repeated-cubicle workflow, and the one QoL item the designer named that
  // a rectangle FILL does not cover: capture a block of the map, then paint that
  // block wherever you click. Cells AND the edge runs inside the region, because
  // a cubicle is its partitions as much as its desk.
  let clipboard = null; // { w, h, cells[][], hWalls[], vWalls[], hDoors[], vDoors[], rot[] }
  function captureRegion(a, b) {
    const x0 = Math.max(0, Math.min(a.x, b.x));
    const x1 = Math.min(width - 1, Math.max(a.x, b.x));
    const z0 = Math.max(0, Math.min(a.z, b.z));
    const z1 = Math.min(height - 1, Math.max(a.z, b.z));
    const cells = [];
    const rot = [];
    for (let z = z0; z <= z1; z++) {
      const row = [];
      for (let x = x0; x <= x1; x++) {
        row.push(rows[z][x]);
        const r = propRot.get(x + ',' + z);
        if (r != null) rot.push({ dx: x - x0, dz: z - z0, rotY: r });
      }
      cells.push(row);
    }
    // Edges are keyed by absolute coordinate; store them relative so the stamp
    // can be dropped anywhere. An edge on the region's far boundary belongs to
    // it (that is the wall on its right-hand side), hence <= rather than <.
    const rel = (set, o) => [...set].map((k) => k.split(',').map(Number))
      .filter(([x, z]) => (o === 'h'
        ? x >= x0 && x <= x1 && z >= z0 && z <= z1 + 1
        : x >= x0 && x <= x1 + 1 && z >= z0 && z <= z1))
      .map(([x, z]) => [x - x0, z - z0]);
    clipboard = {
      w: x1 - x0 + 1, h: z1 - z0 + 1, cells, rot,
      hWalls: rel(hWalls, 'h'), vWalls: rel(vWalls, 'v'),
      hDoors: rel(hDoors, 'h'), vDoors: rel(vDoors, 'v'),
    };
    toast(`Captured ${clipboard.w}×${clipboard.h}. Pick the stamp brush and click to place it.`);
    renderStampButton();
  }
  function stampAt(at) {
    if (!clipboard || !at) return;
    pushHistory();
    inBatch(() => {
      for (let dz = 0; dz < clipboard.h; dz++) {
        for (let dx = 0; dx < clipboard.w; dx++) {
          paint({ x: at.x + dx, z: at.z + dz }, clipboard.cells[dz][dx]);
        }
      }
    });
    for (const { dx, dz, rotY } of clipboard.rot) {
      const x = at.x + dx;
      const z = at.z + dz;
      if (x < width && z < height) propRot.set(x + ',' + z, rotY);
    }
    const put = (pairs, set, o) => {
      for (const [dx, dz] of pairs) {
        const x = at.x + dx;
        const z = at.z + dz;
        if (edgeInRange(o, x, z)) set.add(x + ',' + z);
      }
    };
    put(clipboard.hWalls, hWalls, 'h');
    put(clipboard.vWalls, vWalls, 'v');
    put(clipboard.hDoors, hDoors, 'h');
    put(clipboard.vDoors, vDoors, 'v');
    renderAllEdges();
    for (let dz = 0; dz < clipboard.h; dz++) {
      for (let dx = 0; dx < clipboard.w; dx++) {
        const x = at.x + dx;
        const z = at.z + dz;
        if (x < width && z < height) renderCell(x, z);
      }
    }
    markDirty();
  }

  // Rubber-band state for shift-drag. The preview is the ghost entity pool.
  let anchor = null;
  let capturing = false;
  let rectGhosts = [];
  function clearRectPreview() {
    for (const e of rectGhosts) e.destroy();
    rectGhosts = [];
  }
  function previewRect(to) {
    clearRectPreview();
    if (!anchor || !to) return;
    ensureGhosts();
    const x0 = Math.min(anchor.x, to.x);
    const x1 = Math.max(anchor.x, to.x);
    const z0 = Math.min(anchor.z, to.z);
    const z1 = Math.max(anchor.z, to.z);
    // Outline only - a filled preview over a big rectangle is a lot of entities
    // for something that lives for the length of a drag.
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        if (x !== x0 && x !== x1 && z !== z0 && z !== z1) continue;
        if (x < 0 || x >= width || z < 0 || z >= height) continue;
        const e = new pc.Entity();
        e.addComponent('render', { type: 'box', material: ghost.render.material });
        e.setLocalScale(0.9, 0.05, 0.9);
        e.setPosition(x, 0.05, z);
        app.root.addChild(e);
        rectGhosts.push(e);
      }
    }
  }
  function commitRect(to) {
    if (!anchor || !to) { clearRectPreview(); anchor = null; return; }
    const x0 = Math.min(anchor.x, to.x);
    const x1 = Math.max(anchor.x, to.x);
    const z0 = Math.min(anchor.z, to.z);
    const z1 = Math.max(anchor.z, to.z);
    const ch = charForBrush();
    clearRectPreview();
    anchor = null;
    if (!ch) return;
    inBatch(() => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) paint({ x, z }, ch);
    });
  }

  // --- overlays: seeing the fight ------------------------------------------------
  // Everything a floor's PLACEMENT implies, drawn on the floor. All of it was
  // always derivable and none of it was ever visible - an author found out by
  // walking the level. Flat quads, computed by src/level-preview.js (the same
  // predicates the game uses), recomputed on the same debounce as the lint.
  const OVERLAYS = [
    { id: 'reach', label: 'reach', title: 'Rooms nobody can walk into, in red. Everything the player can reach is left clear.' },
    { id: 'cover', label: 'cover spots', title: 'Terrain spots Take Cover can use. Brighter = more shielded faces.' },
    { id: 'engage', label: 'fights', title: 'Which coworkers join ONE fight, by sightline. A group of six is a very different floor from three pairs.' },
    { id: 'surprise', label: 'surprise', title: 'Open a fight from inside this band and that coworker loses its first turn.' },
    { id: 'notice', label: 'notice', title: 'Where a coworker could see you from, at the stealth cone\'s range. Facing is not authored yet, so this is the radius, not the cone.' },
    { id: 'wander', label: 'wander', title: 'Where a placed coworker might actually be standing - they drift up to 2 tiles.' },
    { id: 'fire', label: 'fire', title: 'Hover a flammable tile to see everything that would burn, and every printer that would go with it.' },
  ];
  let overlay = null;
  let overlayEntities = [];
  const overlayMats = {};
  function overlayMat(rgb, opacity = 0.35) {
    const k = rgb.join(',') + ':' + opacity;
    if (!overlayMats[k]) {
      const m = new pc.StandardMaterial();
      m.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
      m.emissive = new pc.Color(rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5);
      m.opacity = opacity;
      m.blendType = pc.BLEND_NORMAL;
      m.depthWrite = false;
      m.update();
      overlayMats[k] = m;
    }
    return overlayMats[k];
  }
  function clearOverlay() {
    for (const e of overlayEntities) e.destroy();
    overlayEntities = [];
  }
  function overlayQuad(x, z, rgb, opacity) {
    const e = new pc.Entity();
    e.addComponent('render', { type: 'box', material: overlayMat(rgb, opacity) });
    e.setLocalScale(0.92, 0.03, 0.92);
    e.setPosition(x, 0.09, z);
    app.root.addChild(e);
    overlayEntities.push(e);
  }
  const CLUSTER_HUES = [[0.95, 0.45, 0.35], [0.4, 0.7, 0.95], [0.6, 0.95, 0.5],
    [0.95, 0.85, 0.4], [0.8, 0.5, 0.95], [0.4, 0.95, 0.85]];
  function drawOverlay() {
    clearOverlay();
    if (!overlay) return;
    let g;
    try { g = parseLevel(JSON.parse(toJson2D())); } catch { return; }
    const at = (k) => k.split(',').map(Number);
    if (overlay === 'reach') {
      for (const k of preview.orphans(g)) { const [x, z] = at(k); overlayQuad(x, z, [0.95, 0.3, 0.35], 0.45); }
    } else if (overlay === 'cover') {
      for (const [k, n] of preview.coverMap(g)) {
        const [x, z] = at(k);
        overlayQuad(x, z, [0.35, 0.75, 0.95], 0.12 + 0.12 * n);
      }
    } else if (overlay === 'engage') {
      preview.engagementClusters(g).forEach((group, i) => {
        const hue = CLUSTER_HUES[i % CLUSTER_HUES.length];
        for (const s of group) overlayQuad(s.x, s.z, hue, 0.6);
      });
    } else if (overlay === 'surprise') {
      for (const k of preview.surpriseBand(g)) { const [x, z] = at(k); overlayQuad(x, z, [0.95, 0.8, 0.35], 0.3); }
    } else if (overlay === 'notice') {
      for (const k of preview.noticeRange(g)) { const [x, z] = at(k); overlayQuad(x, z, [0.95, 0.55, 0.3], 0.22); }
    } else if (overlay === 'wander') {
      for (const k of preview.wanderFootprint(g)) { const [x, z] = at(k); overlayQuad(x, z, [0.7, 0.5, 0.95], 0.3); }
    } else if (overlay === 'fire' && hoverCell && !hoverCell.edge) {
      const { burns, blasts } = preview.fireSpread(g, hoverCell);
      for (const k of burns) { const [x, z] = at(k); overlayQuad(x, z, [0.98, 0.45, 0.2], 0.4); }
      for (const k of blasts) { const [x, z] = at(k); overlayQuad(x, z, [1, 0.9, 0.3], 0.75); }
    }
  }
  // The overlays only speak flat maps; on a layered level they answer for the
  // storey you are standing on, which is the one you are painting.
  function toJson2D() {
    const data = JSON.parse(toJson());
    if (data.layers) {
      const L = data.layers[active];
      return JSON.stringify({ ...data, layers: undefined, map: L.map, walls: L.walls, doors: L.doors });
    }
    return JSON.stringify(data);
  }

  // --- camera / input ----------------------------------------------------------------
  // The partition brush paints the edge nearest the click; every other brush
  // paints the tile. Right-click erases (the nearest partition, or the cell).
  const controls = createControls({
    app,
    canvas: document.getElementById('app'),
    // A layered level has no top-level `map` - the storeys own it - and
    // `refocus()` recomputes this from the real extent as soon as renderAll
    // runs, so the initial value only has to be harmless.
    focus: { x: 0, z: 0 },
    // One snapshot per STROKE. A drag fires this once and then streams tiles,
    // so undo steps back over the whole swipe rather than one cell of it.
    onAnyLeftPress: () => beginStroke(),
    // Nothing used to preview what a click would do. Worst for the partition
    // brush, which picks an EDGE from the sub-tile fraction of the ground point
    // - a decision the author could not see until after the wall existed.
    onHover: (g) => showGhost(g),
    onHoverLeave: () => hideGhost(),
    onLeftClickTile: (t, g, sx, sy, m = {}) => {
      if (m.alt && m.shift && t) { anchor = t; capturing = true; previewRect(t); return; } // capture a region
      if (m.alt && t) { eyedrop(t); return; }         // read, don't write
      if (editorMode === 'select') {
        if (selectEdges) selectEdge(nearestEdge(g)); else selectCell(t);
        return;
      }
      if (brush === 'stamp') { stampAt(t); return; }
      if (isEdgeBrush()) { paintEdge(nearestEdge(g), true); return; }
      if (!t) return;
      if (m.shift && m.ctrl) { anchor = t; previewRect(t); return; } // rectangle
      if (m.ctrl) { fillFrom(t, charForBrush()); return; }           // bucket
      if (m.shift && lastPainted) {                                  // line to here
        const ch = charForBrush();
        if (ch) inBatch(() => { for (const c of cellsOnLine(lastPainted, t)) paint(c, ch); });
        lastPainted = t;
        return;
      }
      paint(t);
      lastPainted = t;
    },
    onLeftDragTile: (t, g, m = {}) => {
      if (editorMode === 'select') return;
      if (m.alt) return;
      if (isEdgeBrush()) { paintEdge(nearestEdge(g), true); return; }
      if (!t) return;
      if (anchor) { previewRect(t); return; }
      // Interpolate. A drag samples per mousemove, so a fast swipe used to
      // leave gaps in the line it looked like it was painting.
      const ch = charForBrush();
      if (!ch) return;
      if (lastPainted && (Math.abs(t.x - lastPainted.x) > 1 || Math.abs(t.z - lastPainted.z) > 1)) {
        inBatch(() => { for (const c of cellsOnLine(lastPainted, t)) paint(c, ch); });
      } else {
        paint(t, ch);
      }
      lastPainted = t;
    },
    onLeftRelease: (t) => {
      if (!anchor) return;
      if (capturing) {
        captureRegion(anchor, t || anchor);
        clearRectPreview();
        anchor = null;
        capturing = false;
        return;
      }
      commitRect(t || anchor);
    },
    onRightClickTile: (t, sx, sy, g) => {
      beginStroke(); // erase is a gesture too, and there is no right-press hook
      eraseAt(t, g);
    },
    // Right-drag erases continuously, mirroring the left button. Only the left
    // button was ever wired to drag, so rubbing out a wall was click by click.
    onRightDragTile: (t, g) => eraseAt(t, g),
  });

  // --- level JSON in/out -----------------------------------------------------------
  function toJson() {
    // ONLY the types this level actually uses (see the allocator above). The
    // export used to name the whole registry, which is what made a character
    // a scarce global resource instead of a per-level one. Walked in registry
    // order rather than paint order so two exports of the same level agree.
    // Every storey's characters, not just the one on screen: the legends are
    // level-wide, so a type used only on the mezzanine still has to be named.
    const allRows = storeys.length
      ? storeys.flatMap((st, i) => (i === active ? rows : st.rows))
      : rows;
    const used = new Set(['floor']); // actor cells parse as floor beneath them
    for (const r of allRows) for (const ch of r) if (tileByChar[ch]) used.add(tileByChar[ch]);
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
    for (const r of allRows) for (const ch of r) usedChars.add(ch);
    const usedTiers = [...tierChars].filter(([ch]) => usedChars.has(ch));
    const actors = { [PLAYER_CHAR]: 'player', ...actorLegend(), ...Object.fromEntries(usedTiers) };
    // Key order mirrors the hand-authored files in levels/, so a re-export
    // diffs cleanly against the original.
    const out = { name: levelName };
    if (levelDepth != null) out.depth = levelDepth;
    Object.assign(out, { tiles, actors });
    if (storeys.length <= 1) out.map = rows.map((r) => r.join(''));
    // Rotations, for cells that still carry a model prop. Painting over a
    // rotated desk should not leave its angle behind in the file.
    const propsOf = (st) => {
      const list = [];
      for (const [k, rotY] of st.propRot) {
        const [x, z] = k.split(',').map(Number);
        const type = tileByChar[st.rows[z]?.[x]];
        if (type && TILE_TYPES[type]?.model) list.push({ x, z, rotY });
      }
      return list.sort((a, b) => a.z - b.z || a.x - b.x);
    };
    // Whatever is on screen is the truth for the active storey.
    const all = storeys.map((st, i) => (i === active ? captureStorey() : st));
    if (all.length > 1) {
      // Multi-storey: the legends stay level-wide and each storey carries its
      // own map, runs, props and rise. A reader of this file sees exactly the
      // shape levels/README.md documents.
      out.layers = all.map((st) => {
        const L = { height: st.height ?? STOREY_DEFAULT_H, map: st.rows.map((r) => r.join('')) };
        const w = compressWallRuns(st.hWalls, st.vWalls);
        if (w.length) L.walls = w;
        const d = compressWallRuns(st.hDoors, st.vDoors);
        if (d.length) L.doors = d;
        const pr = propsOf(st);
        if (pr.length) L.props = pr;
        return L;
      });
    } else {
      const props = propsOf(all[0]);
      if (props.length) out.props = props;
      const walls = compressWallRuns(hWalls, vWalls);
      if (walls.length) out.walls = walls;
      const doors = compressWallRuns(hDoors, vDoors);
      if (doors.length) out.doors = doors;
    }
    if (levelNext) out.next = levelNext;
    return JSON.stringify(out, null, 2);
  }

  // --- editor UI ----------------------------------------------------------------------
  // The map gets the screen it needs. Tools, inspection and analysis are
  // separate regions around it instead of one expanding panel over the work.
  const bar = document.createElement('div');
  bar.id = 'editor-shell';
  bar.dataset.toolsOpen = 'false';
  bar.dataset.inspectorOpen = 'false';
  const topbar = document.createElement('div');
  topbar.id = 'editor-topbar';
  topbar.className = 'editor-surface';
  const identity = document.createElement('div');
  identity.id = 'editor-identity';
  const status = document.createElement('div');
  status.id = 'ed-status';
  identity.appendChild(status);
  const toolPanel = document.createElement('section');
  toolPanel.id = 'editor-tools';
  toolPanel.className = 'editor-surface';
  const toolHeading = document.createElement('div');
  toolHeading.id = 'editor-tools-heading';
  toolHeading.innerHTML = '<span>Tools</span><small>Paint and place</small>';
  const toolMode = document.createElement('div');
  toolMode.id = 'editor-tool-mode';
  const inspector = document.createElement('aside');
  inspector.id = 'editor-inspector';
  inspector.className = 'editor-surface';
  const inspectorHeading = document.createElement('div');
  inspectorHeading.id = 'editor-inspector-heading';
  inspectorHeading.innerHTML = '<span>Inspector</span><small>Selection and level</small>';
  const inspectorBody = document.createElement('div');
  inspectorBody.id = 'editor-inspector-body';
  const selectionInfo = document.createElement('div');
  selectionInfo.id = 'editor-selection';
  const analysis = document.createElement('section');
  analysis.id = 'editor-analysis';
  const analysisHeading = document.createElement('div');
  analysisHeading.id = 'editor-analysis-heading';
  analysisHeading.textContent = 'Analysis';
  const problems = document.createElement('div');
  problems.id = 'editor-problems';

  // Palette construction remains registry-driven; the shell simply gives it a
  // dedicated scroll region rather than making it compete with commands.
  const palette = document.createElement('div');
  palette.id = 'editor-palette';
  const commands = document.createElement('div');
  commands.id = 'editor-commands';
  const levelRow = document.createElement('div');
  levelRow.id = 'editor-level-row';
  const viewRow = document.createElement('div');
  viewRow.id = 'editor-view-row';
  const btn = (id, label, host = palette) => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    Object.assign(b.style, BUTTON_CHROME, {
      padding: '7px 9px', borderRadius: '5px', minHeight: '32px', cursor: 'pointer',
    });
    b.classList.add('editor-command');
    host.appendChild(b);
    return b;
  };
  const divider = (host = commands) => {
    const s = document.createElement('div');
    Object.assign(s.style, { width: '1px', alignSelf: 'stretch', background: '#3a3a52', margin: '0 2px' });
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

  const stairTypes = [];
  const brushButtons = [];
  const buttonOf = new Map(); // brush id -> its button, for hotkeys and recents
  const paletteSections = new Map(); // category -> { root, toggle, body, expanded }
  const recent = [];
  let selectCellBtn = null;
  let selectEdgeBtn = null;
  function renderToolMode() {
    for (const [button, active] of [
      [selectCellBtn, editorMode === 'select' && !selectEdges],
      [selectEdgeBtn, editorMode === 'select' && selectEdges],
    ]) {
      if (!button) continue;
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    for (const button of brushButtons) {
      const active = editorMode === 'paint' && buttonOf.get(brush) === button;
      button.style.borderColor = active ? '#8adf76' : '#3a3a52';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }
  function selectMode(edges = false) {
    editorMode = 'select';
    selectEdges = edges;
    renderToolMode();
    setStatus();
  }
  function selectBrush(id, button) {
    brush = id;
    editorMode = 'paint';
    selectEdges = false;
    renderToolMode();
    setStatus();
    const section = paletteSections.get(button.closest('[data-cat]')?.dataset.cat);
    if (section) setPaletteSectionExpanded(section, true);
    if (collapsed) applyCollapse(); // the collapsed strip names the armed brush
    // Colour was the ONLY channel signalling the armed brush, on one of ninety
    // buttons, often scrolled out of view. It still is a channel; it is no
    // longer the only one - the status strip names the brush, and the button
    // carries aria-pressed the way the game's own toggle does (ui/hud.js).
    const at = recent.indexOf(id);
    if (at !== -1) recent.splice(at, 1);
    recent.unshift(id);
    if (recent.length > 8) recent.pop();
    renderRecent();
  }

  selectCellBtn = btn('ed-mode-select', 'Select', toolMode);
  selectCellBtn.classList.add('editor-mode');
  selectCellBtn.title = 'Inspect a tile without changing it.';
  selectCellBtn.onclick = () => selectMode(false);
  selectEdgeBtn = btn('ed-mode-edge-select', 'Edge', toolMode);
  selectEdgeBtn.classList.add('editor-mode');
  selectEdgeBtn.title = 'Inspect a partition or door edge without changing it.';
  selectEdgeBtn.onclick = () => selectMode(true);
  renderToolMode();

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
    for (const section of paletteSections.values()) {
      const any = [...section.body.querySelectorAll('button')].some((b) => b.style.display !== 'none');
      section.root.style.display = any ? '' : 'none';
      setPaletteSectionVisible(section, q ? any : section.expanded);
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
  // The order is content (data/tiles.js), so a tile declaring a category the
  // palette has never heard of is a red unit test rather than a brush that
  // silently sorts to the end.
  const CATEGORY_ORDER = TILE_CATEGORIES;
  const byCategory = new Map();
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (def.runtimeOnly) continue; // not a brush - it has no character to paint
    // A stair marker only means something with a storey above it. The button
    // exists but stays disabled until the level has one, because on a flat
    // level it is an invisible wall the author cannot see in playtest.
    if (def.stairs) { stairTypes.push(id); }
    const cat = def.category || 'basics';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(id);
  }
  const cats = [...byCategory.keys()]
    .sort((a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99));
  function setPaletteSectionVisible(section, visible) {
    section.toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    section.expander.textContent = visible ? '-' : '+';
    section.body.hidden = !visible;
  }
  function setPaletteSectionExpanded(section, expanded) {
    section.expanded = expanded;
    setPaletteSectionVisible(section, expanded || Boolean(filterBox.value.trim()));
  }
  function createPaletteSection(cat, expanded = false) {
    const root = document.createElement('section');
    root.className = 'editor-palette-section';
    root.dataset.cat = cat;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 'ed-category-' + cat;
    toggle.className = 'editor-palette-section-toggle';
    toggle.title = `Show or hide ${cat} brushes`;
    const label = document.createElement('span');
    label.textContent = cat;
    const expander = document.createElement('span');
    expander.className = 'editor-palette-section-expander';
    expander.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div');
    body.className = 'editor-palette-section-content';
    toggle.append(label, expander);
    root.append(toggle, body);
    const section = { root, toggle, body, expander, expanded };
    toggle.onclick = () => setPaletteSectionExpanded(section, !section.expanded);
    setPaletteSectionVisible(section, expanded);
    paletteSections.set(cat, section);
    return section;
  }
  for (const cat of cats) {
    const section = createPaletteSection(cat, cat === 'basics');
    for (const id of byCategory.get(cat)) {
      const def = TILE_TYPES[id];
      const b = btn('brush-' + id, def.label || id.replace(/-/g, ' '), section.body);
      b.title = tileTooltip(id, def);
      b.onclick = () => selectBrush(id, b);
      brushButtons.push(b); buttonOf.set(id, b);
      if (editorMode === 'paint' && id === brush) {
        b.style.borderColor = '#8adf76';
        b.setAttribute('aria-pressed', 'true');
      }
    }
    palette.appendChild(section.root);
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
  let stampBtn = null;
  function renderStampButton() {
    if (!clipboard) return;
    if (!stampBtn) {
      stampBtn = btn('brush-stamp', 'stamp', palette);
      stampBtn.onclick = () => selectBrush('stamp', stampBtn);
      brushButtons.push(stampBtn); buttonOf.set('stamp', stampBtn);
    }
    stampBtn.textContent = `stamp ${clipboard.w}×${clipboard.h}`;
    stampBtn.title = `Place the captured ${clipboard.w}×${clipboard.h} block, walls and doors included.`
      + '\nCapture another with Alt+Shift+drag.';
    stampBtn.click();
  }

  const actorSection = createPaletteSection('actors');
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    const b = btn('brush-' + id, def.name, actorSection.body);
    b.title = `${def.name} — native tier ${def.level || 1}.\nFloors do NOT scale enemies: set the tier field to place a tougher one.`;
    b.onclick = () => selectBrush('enemy:' + id, b);
    brushButtons.push(b); buttonOf.set('enemy:' + id, b);
  }
  // Companions and NPCs. They round-tripped correctly and could never be
  // placed, so a second recruitable coworker meant hand-editing JSON.
  for (const reg of [COMPANIONS, NPCS]) {
    for (const [id, def] of Object.entries(reg)) {
      const b = btn('brush-' + id, def.name || id, actorSection.body);
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
  actorSection.body.appendChild(tierField);
  const brushTier = () => {
    const n = parseInt(tierField.value, 10);
    return Number.isInteger(n) && n > 1 ? n : null;
  };
  palette.appendChild(actorSection.root);
  // The selection tool starts armed. Apply the inactive state after every
  // registry brush exists so visual, keyboard, and accessibility state agree.
  renderToolMode();

  // --- overlay toggles ----------------------------------------------------------
  const overlayBox = document.createElement('div');
  overlayBox.id = 'ed-overlays';
  Object.assign(overlayBox.style, { display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' });
  const overlayBtns = new Map();
  for (const o of OVERLAYS) {
    const b = document.createElement('button');
    b.id = 'ed-overlay-' + o.id;
    b.textContent = o.label;
    b.title = o.title;
    b.setAttribute('aria-pressed', 'false');
    Object.assign(b.style, BUTTON_CHROME, {
      padding: '6px 9px', borderRadius: '7px', minHeight: '32px', cursor: 'pointer', fontSize: '11px',
    });
    b.onclick = () => {
      overlay = overlay === o.id ? null : o.id;
      for (const [id, btn2] of overlayBtns) {
        const on = id === overlay;
        btn2.style.borderColor = on ? '#8adf76' : '#3a3a52';
        btn2.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      drawOverlay();
      if (overlay === 'fire') toast('Hover a flammable tile - paper, a spill - to trace the burn.');
    };
    overlayBtns.set(o.id, b);
    overlayBox.appendChild(b);
  }
  const budgetBtn = document.createElement('button');
  budgetBtn.id = 'ed-budget';
  budgetBtn.textContent = 'budget';
  budgetBtn.title = 'What this floor is worth: healing, revives, ammo, cash and XP. '
    + 'Every input was already in the level - it just had to be played to find out.';
  Object.assign(budgetBtn.style, BUTTON_CHROME, {
    padding: '6px 9px', borderRadius: '7px', minHeight: '32px', cursor: 'pointer', fontSize: '11px',
  });
  budgetBtn.onclick = () => {
    let b;
    try { b = preview.floorBudget(JSON.parse(toJson2D())); } catch (e) { toast(`Cannot total a level that will not parse: ${e.message}`); return; }
    toast(`${b.enemies} coworkers · ${b.xp} XP · ${b.healHp} HP of healing · `
      + `${b.revives} revives · ${b.ammo} paper · ${b.cash} cash — from ${b.containers} containers`, 7000);
  };
  overlayBox.appendChild(budgetBtn);
  viewRow.appendChild(overlayBox);

  // --- storeys (EDITOR_PLAN M4) --------------------------------------------------
  // Deliberately small, which is the point of the layer model: a storey is an
  // ordinary flat map, so this is a switcher plus a height field rather than an
  // elevation UI.
  const storeyBox = document.createElement('div');
  storeyBox.id = 'ed-storeys';
  Object.assign(storeyBox.style, { display: 'flex', gap: '4px', alignItems: 'center' });
  levelRow.appendChild(storeyBox);

  const heightField = document.createElement('input');
  heightField.id = 'ed-storey-height';
  heightField.type = 'number';
  heightField.step = '0.1';
  heightField.min = '0.5';
  heightField.title = 'How far the NEXT storey sits above this one, in world units.'
    + '\nPut the tall number on the ground storey to get an atrium.';
  heightField.setAttribute('aria-label', 'Storey height');
  Object.assign(heightField.style, BUTTON_CHROME, {
    padding: '7px 8px', borderRadius: '7px', width: '68px', cursor: 'text',
  });
  heightField.oninput = () => {
    const v = parseFloat(heightField.value);
    if (storeys[active] && Number.isFinite(v) && v > 0) { storeys[active].height = v; markDirty(); }
  };

  function switchStorey(i) {
    if (i === active || !storeys[i]) return;
    storeys[active] = captureStorey();
    active = i;
    adoptStorey(storeys[i]);
    selection = null;
    renderAll();
    renderStoreyTabs();
    validateNow();
    toast(`Storey ${i}${i === 0 ? ' (ground)' : ''}`);
  }
  function addStorey() {
    pushHistory();
    storeys[active] = captureStorey();
    // A new storey starts EMPTY - all void. An upper floor is mostly airspace
    // with a band of floor around it, so blank-as-void is the useful default
    // and blank-as-floor would mean erasing a whole slab by hand.
    storeys.push({
      rows: Array.from({ length: height }, () => new Array(width).fill(' ')),
      hWalls: new Set(), vWalls: new Set(), hDoors: new Set(), vDoors: new Set(),
      propRot: new Map(),
      height: STOREY_DEFAULT_H,
    });
    switchStorey(storeys.length - 1);
    markDirty();
    toast('Added a storey. It starts as open air - paint the floor you want.');
  }
  function removeStorey() {
    if (storeys.length < 2) { toast('A level needs at least its ground storey.'); return; }
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete storey ${active} and everything painted on it?`)) return;
    pushHistory();
    storeys.splice(active, 1);
    active = Math.min(active, storeys.length - 1);
    adoptStorey(storeys[active]);
    selection = null;
    renderAll();
    renderStoreyTabs();
    markDirty();
  }
  function renderStoreyTabs() {
    storeyBox.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = 'storey';
    Object.assign(label.style, { opacity: '.55', fontSize: '10px', letterSpacing: '1px', textTransform: 'uppercase' });
    storeyBox.appendChild(label);
    storeys.forEach((st, i) => {
      const b = document.createElement('button');
      b.id = 'ed-storey-' + i;
      b.textContent = String(i);
      b.title = i === 0 ? 'Ground storey' : `Storey ${i}`;
      b.setAttribute('aria-pressed', i === active ? 'true' : 'false');
      Object.assign(b.style, BUTTON_CHROME, {
        padding: '8px 11px', borderRadius: '7px', minHeight: '38px', cursor: 'pointer',
        borderColor: i === active ? '#8adf76' : '#3a3a52',
      });
      b.onclick = () => switchStorey(i);
      storeyBox.appendChild(b);
    });
    const add = document.createElement('button');
    add.id = 'ed-storey-add';
    add.textContent = '+';
    add.title = 'Add a storey above';
    Object.assign(add.style, BUTTON_CHROME, { padding: '8px 10px', borderRadius: '7px', minHeight: '38px', cursor: 'pointer' });
    add.onclick = addStorey;
    storeyBox.appendChild(add);
    if (storeys.length > 1) {
      const del = document.createElement('button');
      del.id = 'ed-storey-remove';
      del.textContent = '−';
      del.title = 'Delete the storey you are on';
      Object.assign(del.style, BUTTON_CHROME, {
        padding: '8px 10px', borderRadius: '7px', minHeight: '38px', cursor: 'pointer', borderColor: '#7a3a4a',
      });
      del.onclick = removeStorey;
      storeyBox.appendChild(del);
    }
    heightField.value = String(storeys[active]?.height ?? STOREY_DEFAULT_H);
    heightField.style.display = storeys.length > 1 ? '' : 'none';
    // A stair run needs somewhere to climb to. On a flat level the marker is an
    // invisible wall, so the brush is present-but-refused rather than hidden -
    // the author can see the capability exists and why it is unavailable.
    const canStair = storeys.length > 1 && active < storeys.length - 1;
    for (const id of stairTypes) {
      const b = buttonOf.get(id);
      if (!b) continue;
      b.disabled = !canStair;
      b.style.opacity = canStair ? '1' : '.4';
      b.title = canStair
        ? 'Stairway — paint a RUN of these; floors.js orients the flight and carves the opening above.'
        : 'Stairway — needs a storey above this one. Add one with + first.';
    }
  }
  levelRow.appendChild(heightField);

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
    levelRow.appendChild(i);
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
  levelRow.appendChild(nextField);
  // Keep the fields honest when a load replaces the document under them.
  function syncMetaFields() {
    nameField.value = levelName || '';
    depthField.value = levelDepth == null ? '' : String(levelDepth);
    nextField.value = levelNext || '';
  }

  // --- canvas size ------------------------------------------------------------
  const resizePanel = document.createElement('section');
  resizePanel.id = 'editor-resize';
  const resizeHeading = document.createElement('div');
  resizeHeading.className = 'editor-inspector-section-heading';
  resizeHeading.textContent = 'Canvas';
  const sizeLabel = document.createElement('span');
  sizeLabel.id = 'ed-size';
  resizeHeading.appendChild(sizeLabel);
  const axisSizeLabels = new Map();
  function updateSizeLabel() {
    sizeLabel.textContent = `${width}×${height}`;
    axisSizeLabels.get('x').textContent = width;
    axisSizeLabels.get('y').textContent = height;
  }
  const resizeAtEdge = (axis, edge, amount) => {
    if (axis === 'x') {
      if (edge === 'left') shift(amount, 0); else resize(amount, 0);
    } else if (edge === 'top') shift(0, amount); else resize(0, amount);
  };
  const resizeAxis = (axis, edgeNames) => {
    const row = document.createElement('div');
    row.className = 'editor-resize-axis';
    row.dataset.axis = axis;
    const [near, far] = edgeNames;
    const addButton = (edge, operation) => {
      const symbol = operation === 'add' ? '+' : '-';
      const amount = operation === 'add' ? 1 : -1;
      const button = btn(`ed-resize-${axis}-${edge}-${operation}`, symbol, row);
      const noun = axis === 'x' ? 'column' : 'row';
      button.classList.add('editor-resize-axis-button', `editor-resize-${operation}`);
      button.title = `${operation === 'add' ? 'Add' : 'Remove'} one ${noun} at the ${edge} edge`;
      button.setAttribute('aria-label', button.title);
      button.onclick = () => resizeAtEdge(axis, edge, amount);
    };
    addButton(near, 'add');
    addButton(near, 'remove');
    const key = document.createElement('span');
    key.className = 'editor-resize-axis-key';
    const name = document.createElement('b');
    name.textContent = axis.toUpperCase();
    const dimension = document.createElement('span');
    dimension.className = 'editor-resize-axis-size';
    axisSizeLabels.set(axis, dimension);
    key.append(name, dimension);
    row.appendChild(key);
    addButton(far, 'remove');
    addButton(far, 'add');
    return row;
  };
  resizePanel.append(
    resizeHeading,
    resizeAxis('x', ['left', 'right']),
    resizeAxis('y', ['top', 'bottom']),
  );
  levelRow.appendChild(resizePanel);

  // load a shipped level as a base
  const select = document.createElement('select');
  select.id = 'ed-level';
  Object.assign(select.style, BUTTON_CHROME, {
    padding: '6px', borderRadius: '7px', cursor: 'auto',
  });
  // Layered levels are on the list now that the editor speaks storeys.
  select.innerHTML = `<option value="">load level…</option>` +
    Object.entries(LEVELS)
      .map(([id, l]) => `<option value="${id}">${l.name || id}${l.layers ? ` (${l.layers.length} storeys)` : ''}</option>`).join('');
  select.onchange = () => {
    const id = select.value;
    select.value = '';
    if (!LEVELS[id]) return;
    // Loading REPLACES the document. It used to do that with no prompt, so
    // browsing for "the floor with the break room I liked" cost you your work.
    // eslint-disable-next-line no-alert
    if (dirty && !window.confirm(`Load “${LEVELS[id].name || id}”?\n\nUnsaved painting will be lost.`)) return;
    pushHistory();
    loadLevel(LEVELS[id]);
    dirty = false;
    toast(`Loaded “${levelName}”.`);
  };
  commands.appendChild(select);

  // "Reset" reloads the BOOT level, which is not the same thing as starting a
  // floor - and because the reload falls through main.js's cascade it can drop
  // you into the editor on whatever floor your campaign save is on.
  btn('ed-new', '✚ New', commands).onclick = () => {
    // eslint-disable-next-line no-alert
    if (dirty && !window.confirm('Start a new floor?\n\nUnsaved painting will be lost.')) return;
    // eslint-disable-next-line no-alert
    const size = window.prompt('New floor size (width×height):', '20x16');
    if (size == null) return;
    const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/.exec(size);
    if (!m) { toast('Give a size like 20x16.'); return; }
    const w = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(m[1])));
    const h = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(m[2])));
    pushHistory();
    // A walled room with a spawn and an exit: the smallest thing that lints
    // clean, so the chip is green from the first second rather than scolding
    // you about a floor you have not drawn yet.
    const grid = [];
    for (let z = 0; z < h; z++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        row += (x === 0 || z === 0 || x === w - 1 || z === h - 1) ? '#' : '.';
      }
      grid.push(row);
    }
    const put = (x, z, ch) => { grid[z] = grid[z].slice(0, x) + ch + grid[z].slice(x + 1); };
    put(2, 2, '@');
    put(w - 3, h - 3, '>');
    loadLevel({
      name: 'Untitled Floor',
      depth: 1,
      tiles: { '.': 'floor', '#': 'wall', '>': 'exit' },
      actors: { '@': 'player' },
      map: grid,
    });
    dirty = true;
    markDirty();
    toast(`New ${w}×${h} floor. Name it in the strip, then paint.`);
  };
  btn('ed-undo', '↶ Undo', commands).onclick = () => undo();
  btn('ed-redo', '↷ Redo', commands).onclick = () => redo();

  // IQ5 answer B (designer 2026-08-02: "level 1 is fine"): Playtest remembers
  // the last character so the resume desk stops appearing between every
  // iteration. It changes nothing about WHAT you playtest with - same fresh
  // level-1 solo character - it just stops asking you to make it every time.
  const PLAYTEST_CLASS_KEY = 'escape-work.playtest.class';
  btn('ed-playtest', '▶ Playtest', commands).onclick = () => {
    // Refuse to launch something that cannot be finished. The lint already
    // knows; walking into a floor with no exit to discover it is a wasted trip.
    const errs = validateNow().filter((f) => f.level === 'error');
    // eslint-disable-next-line no-alert
    if (errs.length && !window.confirm(`This floor cannot be finished:\n\n${errs.map((f) => `• ${f.message}`).join('\n')}\n\nPlaytest anyway?`)) return;
    localStorage.setItem(stashKey, toJson());
    dirty = false; // the stash IS a save - leaving for it is not losing work
    clearDraft();
    let last = null;
    try { last = localStorage.getItem(PLAYTEST_CLASS_KEY); } catch { /* ignore */ }
    // The `#class=` express lane already exists for exactly this (main.js).
    location.hash = last ? `#class=${last}` : '';
    location.reload();
  };
  btn('ed-export', 'Export JSON', commands).onclick = showExport;
  // Every affordance in this tool used to be undiscoverable: that the partition
  // brush works on EDGES, that right-click's meaning follows the cursor, that
  // any of the modifier tools exist at all. The boot toast says three of them;
  // this says the rest, and stays available.
  btn('ed-help', '?', commands).onclick = () => {
    document.getElementById('ed-help-panel')?.remove();
    const d = document.createElement('div');
    d.id = 'ed-help-panel';
    Object.assign(d.style, {
      position: 'fixed', inset: '0', zIndex: '41', display: 'flex',
      alignItems: 'center', justifyContent: 'center', background: 'rgba(10,10,18,.85)',
      color: '#f0f0f5', font: '13px system-ui, sans-serif',
    });
    const row = (k, v) => `<tr><td style="padding:3px 14px 3px 0; white-space:nowrap;
      color:#8adf76; font-family:monospace;">${k}</td><td style="padding:3px 0;">${v}</td></tr>`;
    d.innerHTML = `
      <div style="background:#232334; border:1px solid #3a3a52; border-radius:12px;
           padding:20px 24px; width:min(680px,92vw); max-height:86vh; overflow:auto;">
        <div style="font-weight:700; margin-bottom:10px;">Level editor</div>
        <table style="border-collapse:collapse; line-height:1.5;">
          ${row('left-click', 'paint · <b>right-click</b> erases whatever is under the cursor')}
          ${row('partition / door', 'paint the EDGE between tiles, not the tile')}
          ${row('shift + click', 'line from the last cell painted')}
          ${row('ctrl + click', 'fill the contiguous region')}
          ${row('ctrl + shift + drag', 'rectangle')}
          ${row('alt + click', 'eyedropper — arm the brush under the cursor')}
          ${row('alt + shift + drag', 'capture a block, then place it with the stamp brush')}
          ${row('R / shift+R', 'rotate the prop under the cursor')}
          ${row('Ctrl+Z / Ctrl+Shift+Z', 'undo / redo — one step per stroke')}
          ${row('WASD or arrows', 'pan · <b>F</b> re-centre · <b>T</b> overhead · <b>G</b> grid')}
          ${row('[ / ]', 'cycle brushes · <b>Tab</b> hides the toolbar')}
          ${row('middle-drag', 'orbit · <b>wheel</b> zooms')}
        </table>
        <p style="opacity:.75; margin:14px 0 0;">The strip bottom-left names what you are
          holding, what is under the cursor, and whether the floor can be finished.
          Overlays in the command row show cover, sightlines and what would burn.</p>
        <p style="opacity:.75; margin:8px 0 0;">Work autosaves as a draft. <b>Download</b>
          in the export dialog writes <code>&lt;floor&gt;.json</code> — move it into
          <code>levels/</code> and register it in <code>src/data/levels.js</code>.</p>
        <div style="display:flex; justify-content:flex-end; margin-top:14px;">
          <button id="ed-help-close" style="padding:8px 16px; border-radius:7px;
            border:1px solid #3a3a52; background:#2e2e46; color:#f0f0f5; font:inherit;
            cursor:pointer;">Close</button>
        </div>
      </div>`;
    document.body.appendChild(d);
    d.querySelector('#ed-help-close').onclick = () => d.remove();
  };
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
    if (e.key === 'Escape') {
      document.getElementById('export-modal')?.remove();
      document.getElementById('ed-help-panel')?.remove();
      return;
    }
    if (mod) return; // leave the browser's own chords alone
    const k = e.key.toLowerCase();
    if (k === 'v') { e.preventDefault(); selectMode(false); toast('Selection tool.'); return; }
    // Overhead. `controls` has had this since the game shipped it on the HUD
    // rail and the T key; the editor - where precise clicking matters most -
    // never offered it. Its own comment is the argument: overhead is where tile
    // boundaries stop being ambiguous.
    if (k === 't') { e.preventDefault(); controls.toggleTactical(); return; }
    if (k === 'home' || k === 'f') { e.preventDefault(); refocus(); toast('Camera re-centred on the map.'); return; }
    // R rotates the prop under the cursor through the four orientations. This
    // is the whole of IQ4: `rotY` was a property of the tile TYPE, so every
    // desk in the game faced the same way and a rotated one meant a new
    // registry entry - which also spends a scarce map character.
    if (e.key === 'Tab') { e.preventDefault(); toggleCollapse(); return; }
    if (k === 'g') {
      e.preventDefault();
      showGrid = !showGrid;
      renderGrid();
      toast(showGrid ? 'Grid on.' : 'Grid off.');
      return;
    }
    if (k === 'r') {
      e.preventDefault();
      if (!hoverCell || hoverCell.edge) { toast('Point at a prop to rotate it.'); return; }
      const { x, z } = hoverCell;
      const type = tileByChar[rows[z]?.[x]];
      const def = type && TILE_TYPES[type];
      if (!def?.model) { toast('Only model props can be rotated.'); return; }
      pushHistory();
      const key = x + ',' + z;
      const next = (((propRot.get(key) ?? (def.rotY || 0)) + (e.shiftKey ? 270 : 90)) % 360 + 360) % 360;
      // Storing the type's own angle is the same as storing nothing, and an
      // export full of no-op entries is noise in the diff.
      if (next === (def.rotY || 0)) propRot.delete(key); else propRot.set(key, next);
      renderCell(x, z);
      markDirty();
      setStatus();
      toast(`${def.label || type} → ${next}°`);
      return;
    }
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
  // --- shell visibility ------------------------------------------------------
  // The compact layout keeps drawers closed until requested, leaving the map
  // reachable even on a phone-sized viewport.
  const COLLAPSE_KEY = 'escape-work.editor.collapsed';
  const collapseBtn = document.createElement('button');
  collapseBtn.id = 'ed-collapse';
  Object.assign(collapseBtn.style, BUTTON_CHROME, {
    padding: '6px 9px', borderRadius: '5px', cursor: 'pointer', minHeight: '32px',
  });
  collapseBtn.classList.add('editor-command', 'editor-panel-toggle');
  const inspectorToggle = document.createElement('button');
  inspectorToggle.id = 'ed-inspector-toggle';
  inspectorToggle.textContent = 'Inspect';
  inspectorToggle.title = 'Show or hide the inspector';
  Object.assign(inspectorToggle.style, BUTTON_CHROME, {
    padding: '6px 9px', borderRadius: '5px', cursor: 'pointer', minHeight: '32px',
  });
  inspectorToggle.classList.add('editor-command', 'editor-panel-toggle');
  let collapsed = false;
  const isCompactEditor = () => window.matchMedia?.('(max-width: 980px)').matches;
  function applyCollapse() {
    toolPanel.style.display = collapsed ? 'none' : 'flex';
    bar.classList.toggle('tools-collapsed', collapsed);
    if (collapsed) bar.dataset.toolsOpen = 'false';
    else if (!isCompactEditor()) bar.dataset.toolsOpen = 'true';
    const toolsVisible = !collapsed && (!isCompactEditor() || bar.dataset.toolsOpen === 'true');
    collapseBtn.textContent = toolsVisible ? 'Hide tools' : 'Show tools';
    collapseBtn.title = toolsVisible
      ? 'Hide the tool rail (or press Tab)'
      : 'Show the tool rail (or press Tab)';
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : ''); } catch { /* ignore */ }
  }
  function toggleCollapse() {
    if (isCompactEditor()) {
      collapsed = false;
      const open = bar.dataset.toolsOpen !== 'true';
      bar.dataset.toolsOpen = open ? 'true' : 'false';
      if (open) {
        bar.dataset.inspectorOpen = 'false';
        inspectorToggle.textContent = 'Inspect';
      }
    } else {
      collapsed = !collapsed;
    }
    applyCollapse();
  }
  collapseBtn.onclick = toggleCollapse;
  inspectorToggle.onclick = () => {
    const open = bar.dataset.inspectorOpen !== 'true';
    bar.dataset.inspectorOpen = open ? 'true' : 'false';
    if (open && isCompactEditor()) bar.dataset.toolsOpen = 'false';
    inspectorToggle.textContent = open ? 'Hide inspect' : 'Inspect';
  };
  try { collapsed = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { /* ignore */ }

  topbar.append(identity, commands, collapseBtn, inspectorToggle);
  toolPanel.append(toolHeading, toolMode, filterBox, palette);
  inspectorBody.append(selectionInfo, levelRow);
  analysis.append(analysisHeading, viewRow, problems);
  inspector.append(inspectorHeading, inspectorBody, analysis);
  bar.append(topbar, toolPanel, inspector);
  document.body.appendChild(bar);
  applyCollapse();

  function brushLabel() {
    if (editorMode === 'select') return selectEdges ? 'edge inspection' : 'selection';
    if (brush === 'partition') return 'partition (edge)';
    if (brush === 'door') return 'door (edge)';
    if (brush === 'stamp') return clipboard ? `stamp ${clipboard.w}×${clipboard.h}` : 'stamp';
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
    else {
      const type = tileByChar[c];
      what = TILE_TYPES[type]?.label || type || 'floor';
      const r = propRot.get(x + ',' + z);
      if (r != null) what += ` ${r}°`;
      else if (TILE_TYPES[type]?.model) what += ' (R rotates)';
    }
    return `<br><span style="opacity:.75">${x},${z} — ${what} <span style="opacity:.6">“${c === ' ' ? '␣' : c ?? '·'}”</span></span>`;
  }
  // The editor validated NOTHING. Every rule below already existed as an
  // assertion in the test suite, which only runs over files already in levels/ -
  // so the tool that produces those files could happily Export a floor with no
  // exit, or an exit sealed off from the spawn, and you found out from CI.
  // Same module the suite calls (src/level-lint.js), debounced.
  let lintTimer = null;
  let findings = [];
  function collectFindings() {
    try {
      const data = JSON.parse(toJson());
      if (!data.layers) return lintLevel(data);
      // A layered document needs BOTH checks: parseFloors verifies the stairs
      // and upper-storey constraints, while its ground storey still needs the
      // same real spawn/exit route every playable floor needs.
      parseFloors(data);
      const ground = data.layers[0];
      return lintLevel({ ...data, map: ground.map, walls: ground.walls, doors: ground.doors })
        .map((finding) => ({
          ...finding,
          target: finding.target ? { ...finding.target, storey: 0 } : undefined,
        }));
    } catch (e) {
      return [{ level: 'error', rule: 'parse', message: e?.message || 'The level cannot be read.' }];
    }
  }
  function focusFinding(finding) {
    const target = finding.target;
    if (!target) { toast(finding.message); return; }
    if (target.storey != null && target.storey !== active) switchStorey(target.storey);
    if (target.kind === 'edge') selectEdge(target); else selectCell(target);
  }
  function renderProblems() {
    problems.innerHTML = '';
    if (!findings.length) {
      const clear = document.createElement('div');
      clear.id = 'editor-problems-empty';
      clear.textContent = 'No current problems. This floor is ready to playtest.';
      problems.appendChild(clear);
      return;
    }
    for (const finding of findings) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'editor-problem';
      row.dataset.level = finding.level;
      Object.assign(row.style, BUTTON_CHROME);
      const dot = document.createElement('span');
      dot.className = 'editor-problem-dot';
      dot.textContent = finding.level === 'error' ? 'Error' : 'Warning';
      const message = document.createElement('span');
      message.textContent = finding.message;
      row.append(dot, message);
      row.onclick = () => focusFinding(finding);
      problems.appendChild(row);
    }
  }
  function validateNow() {
    clearTimeout(lintTimer);
    findings = collectFindings();
    drawOverlay();
    renderProblems();
    setStatus();
    return findings;
  }
  function runLint() {
    clearTimeout(lintTimer);
    lintTimer = setTimeout(validateNow, 250);
  }

  function setStatus() {
    const ch = charByType[brush];
    const errors = findings.filter((f) => f.level === 'error').length;
    const warnings = findings.filter((f) => f.level === 'warn').length;
    status.innerHTML = `<strong>${levelName || 'Untitled Floor'}</strong>`
      + `<span>${width}×${height} · ${brushLabel()}`
      + (editorMode === 'paint' && ch ? ` · writes “${ch}”` : '')
      + (errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : warnings ? ` · ${warnings} warning${warnings === 1 ? '' : 's'}` : ' · ready')
      + '</span>';
    updateInspector();
  }

  // levels/<id>.json - the id is the filename, and the lint derives it from
  // there, so the download names itself after the floor.
  const suggestedId = () => (levelName || 'untitled')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

  // Flat and layered documents deliberately share every load path. The old
  // editor could export a multi-storey level but then reject that same JSON
  // from both Import and draft recovery because it only looked for `map`.
  const isLevelDocument = (data) =>
    (Array.isArray(data?.map) && data.map.length > 0)
    || (Array.isArray(data?.layers) && data.layers.length > 0
      && data.layers.every((layer) => Array.isArray(layer?.map) && layer.map.length > 0));

  function showExport() {
    validateNow();
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
      if (!isLevelDocument(parsed)) { toast('That JSON has no usable map or storey layers.'); return; }
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

  const exposeEditor = () => ({
    get map() { return rows.map((r) => r.join('')); },
    get size() { return { width, height }; },
    get brush() { return brush; },
    get mode() { return editorMode; },
    get selection() { return selection && { ...selection }; },
    get walls() { return compressWallRuns(hWalls, vWalls); },
    get doors() { return compressWallRuns(hDoors, vDoors); },
    carpetAt: (x, z) => carpet.get(x + ',' + z) || null,
    project(x, z) {
      const s = worldToScreenCss(controls.cameraEntity, x, 0, z);
      return { x: s.x, y: s.y };
    },
    charAt: (x, z) => rows[z]?.[x],
    toJson,
  });

  // Prefer an autosaved draft over the level we were handed. The editor used to
  // have exactly one persistence slot - the playtest stash, written only when
  // you press Playtest - so a crash or a stray reload lost everything since
  // that press, and the reload silently came back with the stale stash instead.
  let restoredDraft = false;
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      const parsed = JSON.parse(draft);
      if (isLevelDocument(parsed)) { loadLevel(parsed); restoredDraft = true; }
    }
  } catch { /* a corrupt draft is not worth refusing to open the editor over */ }
  if (!restoredDraft) loadLevel(levelData);
  // The game's HUD ships in index.html unconditionally and `updateStatsHud` is
  // only ever called from startGame, so in editor mode `#stats` sat empty in
  // the bottom-left as a bordered pill with nothing in it. Take the corner.
  const gameHud = document.getElementById('hud');
  if (gameHud) gameHud.style.display = 'none';
  validateNow();
  window.__editor = exposeEditor();
  if (restoredDraft) {
    dirty = true; // it is unsaved by definition - it never reached a stash
    toast(`Restored your unsaved draft of “${levelName}”. Reset discards it.`);
  } else {
    toast('Floor ready.');
  }

  // Reassign after the boot notice as well: the test surface is intentionally
  // a fresh read-only facade, never a reference to the editor's document.
  window.__editor = exposeEditor();
}
