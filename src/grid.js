// Level parsing and terrain queries. Pure logic - no PlayCanvas, no DOM.
//
// A level file has a "tiles" legend (char -> tile type id from data/tiles.js),
// an "actors" legend (char -> 'player' or an enemy type id from
// data/enemies.js), an ASCII "map", and an optional "walls" list. Actor tiles
// stand on plain floor.
//
// Walls live BETWEEN tiles, not on them: a wall segment blocks the edge
// between two adjacent cells without costing any floor space. The "walls"
// list holds compact runs:
//   "H x z len" - horizontal run on the NORTH edge of cells (x..x+len-1, z)
//   "V x z len" - vertical run on the WEST edge of cells (x, z..z+len-1)
// (`#` cell walls still exist for solid blocks/pillars; partitions are edges.)
import { TILE_TYPES, PARTITION_HP, blocksSight } from './data/tiles.js';
import { SURFACES } from './data/surfaces.js';
import { NPCS } from './data/npcs.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { COMPANIONS } from './data/companions.js';
import { parseActorRef } from './data/actor-registries.js';

// Old saves/exports may reference renamed tile types. Exported so the editor
// can upgrade them when loading a level for editing.
export const TYPE_ALIASES = { 'wet-floor': 'water' };

// "H x z len" specs -> { h, v } Sets of "x,z" edge keys.
export function parseWallRuns(specs) {
  const h = new Set();
  const v = new Set();
  for (const spec of specs || []) {
    const [o, xs, zs, ls] = String(spec).trim().split(/\s+/);
    const x = Number(xs);
    const z = Number(zs);
    const len = Number(ls ?? 1);
    if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(len)) continue;
    for (let i = 0; i < len; i++) {
      if (o === 'H') h.add((x + i) + ',' + z);
      else if (o === 'V') v.add(x + ',' + (z + i));
    }
  }
  return { h, v };
}

// The inverse: collapse edge Sets back into maximal runs (for export).
export function compressWallRuns(h, v) {
  const out = [];
  const parse = (set) => [...set].map((k) => k.split(',').map(Number));
  const hs = parse(h).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  while (hs.length) {
    const [x, z] = hs.shift();
    let len = 1;
    while (hs.length && hs[0][1] === z && hs[0][0] === x + len) { hs.shift(); len++; }
    out.push(`H ${x} ${z} ${len}`);
  }
  const vs = parse(v).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  while (vs.length) {
    const [x, z] = vs.shift();
    let len = 1;
    while (vs.length && vs[0][0] === x && vs[0][1] === z + len) { vs.shift(); len++; }
    out.push(`V ${x} ${z} ${len}`);
  }
  return out;
}

export function parseLevel(level) {
  const rows = level.map;
  const tilesLegend = level.tiles || {};
  const actorsLegend = level.actors || {};
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));

  let playerSpawn = { x: Math.floor(width / 2), z: Math.floor(height / 2) };
  const enemySpawns = [];
  const npcSpawns = [];
  const companionSpawns = []; // recruitable bystanders (data/companions.js)
  // typeGrid[z][x] = tile type id, or null for void (space) cells.
  const typeGrid = [];

  for (let z = 0; z < height; z++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      const ch = rows[z][x];
      if (ch === undefined || ch === ' ') {
        row.push(null);
        continue;
      }
      const actorRef = actorsLegend[ch];
      if (actorRef !== undefined) {
        // `<id>@<level>` asks for that actor at a specific tier on this tile
        // (actor-registries.parseActorRef). Only enemies scale, so a tier on
        // anything else is a typo worth naming rather than ignoring.
        const { id: actor, level: tier } = parseActorRef(actorRef);
        // Only an enemy sits on the scaling curve, so a tier anywhere else is a
        // typo. Checked before the dispatch: after it, an unknown actor has
        // already thrown and a companion has already been filed.
        if (tier != null && !ENEMY_TYPES[actor]) {
          throw new Error(
            `Level "${level.name}": "${actorRef}" for char "${ch}" - only enemies take a @level`);
        }
        if (actor === 'player') playerSpawn = { x, z };
        else if (COMPANIONS[actor]) companionSpawns.push({ type: actor, x, z });
        else if (NPCS[actor]) npcSpawns.push({ type: actor, x, z });
        // Anything left MUST be a known enemy archetype. It used to fall
        // through unchecked, so a typo in a legend produced a spawn for a type
        // that does not exist - which surfaces much later as an empty tile, or
        // as a crash deep in actor construction with nothing pointing back at
        // the level file. Named, like the tile-type error below, because the
        // useful part is which char in which level.
        // `level` only appears when the placement asked for a tier, so an
        // ordinary spawn keeps the shape it has always had.
        else if (ENEMY_TYPES[actor]) {
          enemySpawns.push(tier == null ? { type: actor, x, z } : { type: actor, x, z, level: tier });
        } else {
          throw new Error(
            `Level "${level.name}": unknown actor "${actor}" for char "${ch}" - `
            + 'not "player", a companion, an NPC, or an enemy type');
        }
        row.push('floor');
        continue;
      }
      const raw = tilesLegend[ch] || 'floor';
      const type = TYPE_ALIASES[raw] || raw;
      if (!TILE_TYPES[type]) throw new Error(`Level "${level.name}": unknown tile type "${type}" for char "${ch}"`);
      row.push(type);
    }
    typeGrid.push(row);
  }

  const typeAt = (x, z) =>
    z >= 0 && z < height && x >= 0 && x < width ? typeGrid[z][x] : 'wall';
  const defAt = (x, z) => TILE_TYPES[typeAt(x, z)] || TILE_TYPES.wall;
  // Terrain-only openness; dynamic blockers (living enemies) are layered on by
  // the caller.
  const terrainOpen = (x, z) => {
    const t = typeAt(x, z);
    return t !== null && !TILE_TYPES[t].solid;
  };
  // Can a SIGHTLINE pass this cell? Open ground, or a solid too short to stop
  // a shot (TACTICS_PLAN M6a): a desk is shot over, a snack machine is not.
  // Out-of-bounds and in-map void both resolve to the tall 'wall' def, so they
  // stay opaque without a bounds check here.
  const sightOpenCell = (x, z) => !blocksSight(defAt(x, z));
  const surfaceAt = (x, z) => defAt(x, z).surface || null;

  // --- edge walls -------------------------------------------------------------
  const { h: hWalls, v: vWalls } = parseWallRuns(level.walls);

  // --- doors -------------------------------------------------------------------
  // Doors sit on edges like walls ("doors" runs in the level JSON, same
  // "H x z len" format) but can be opened and closed at runtime. A door on an
  // edge replaces any wall painted there. Closed doors block movement and
  // sight; conduction ignores them entirely - water finds the gap underneath,
  // so pools stay static however often the door swings.
  const { h: hDoorSet, v: vDoorSet } = parseWallRuns(level.doors);
  for (const k of hDoorSet) hWalls.delete(k);
  for (const k of vDoorSet) vWalls.delete(k);
  const doors = new Map(); // 'h:x,z' | 'v:x,z' -> { open }
  for (const k of hDoorSet) doors.set('h:' + k, { open: false });
  for (const k of vDoorSet) doors.set('v:' + k, { open: false });
  const doorKeyBetween = (x, z, nx, nz) => {
    if (nx > x) return 'v:' + nx + ',' + z;
    if (nx < x) return 'v:' + x + ',' + z;
    if (nz > z) return 'h:' + x + ',' + nz;
    if (nz < z) return 'h:' + x + ',' + z;
    return null;
  };
  const doorBetween = (x, z, nx, nz) => {
    const k = doorKeyBetween(x, z, nx, nz);
    const d = k && doors.get(k);
    return d ? { key: k, open: d.open } : null;
  };
  const setDoorOpen = (key, open) => {
    const d = doors.get(key);
    if (d) d.open = open;
  };

  // Is the shared edge between two 4-adjacent cells free of a wall? (Static -
  // this is what conduction pools flood against.)
  const wallEdgeOpen = (x, z, nx, nz) => {
    if (nx > x) return !vWalls.has(nx + ',' + z);
    if (nx < x) return !vWalls.has(x + ',' + z);
    if (nz > z) return !hWalls.has(x + ',' + nz);
    if (nz < z) return !hWalls.has(x + ',' + z);
    return true;
  };
  // The wall edge between two 4-adjacent cells as { o: 'h'|'v', k: 'x,z' },
  // or null. A PLAIN wall only: doors replaced their wall at parse time, so a
  // doored edge never appears in these sets - which is exactly what makes
  // partitions toppleable (TACTICS_PLAN M6) and doors not.
  const wallEdgeBetween = (x, z, nx, nz) => {
    let o = null;
    let k = null;
    if (nx > x) { o = 'v'; k = nx + ',' + z; } else if (nx < x) { o = 'v'; k = x + ',' + z; } else if (nz > z) { o = 'h'; k = x + ',' + nz; } else if (nz < z) { o = 'h'; k = x + ',' + z; } else return null;
    const set = o === 'h' ? hWalls : vWalls;
    return set.has(k) ? { o, k } : null;
  };
  // Knock the wall edge between two cells out of the world (TACTICS_PLAN M6:
  // partitions topple). Returns the removed { o, k } for the renderer, or
  // null if no plain wall stands there. Conduction recomputes - a partition
  // dams spills, and this dam just broke.
  const removeEdgeBetween = (x, z, nx, nz) => {
    const e = wallEdgeBetween(x, z, nx, nz);
    if (!e) return null;
    (e.o === 'h' ? hWalls : vWalls).delete(e.k);
    edgeDamage.delete(e.o + ':' + e.k); // the pool dies with the edge
    electrified = computeElectrified();
    return e;
  };

  // --- destructible cover (TACTICS_PLAN M8) ---------------------------------
  // Damage lives in side maps, not on tile defs: defs are static SHARED
  // objects, so a number mutated there would wound every cabinet on the
  // floor at once. Keyed like everything else here - cells by "x,z", edges
  // by "o:x,z" - and persistent across fights: "gradually break down a
  // barrier" is allowed to span them. A pool dies with the thing it
  // described (setType swaps the tile, removeEdgeBetween retires the edge),
  // so a topple's fallen twin starts its own fresh pool.
  const propDamage = new Map(); // 'x,z' -> damage taken so far
  const edgeDamage = new Map(); // 'h:x,z' | 'v:x,z' -> damage taken so far
  const propHpAt = (x, z) => {
    const def = defAt(x, z);
    if (!Number.isFinite(def.hp)) return null;
    return Math.max(0, def.hp - (propDamage.get(x + ',' + z) || 0));
  };
  // Record a hit; returns hp remaining, or null for a prop with no pool.
  // What a broken prop BECOMES (the setType to floor, the mesh, the fx) is
  // the caller's move - bookkeeping does not decide "gone means gone".
  const damageProp = (x, z, amount) => {
    const left = propHpAt(x, z);
    if (left === null) return null;
    propDamage.set(x + ',' + z, (propDamage.get(x + ',' + z) || 0) + amount);
    return Math.max(0, left - amount);
  };
  const edgeHpBetween = (x, z, nx, nz) => {
    const e = wallEdgeBetween(x, z, nx, nz);
    if (!e) return null;
    return Math.max(0, PARTITION_HP - (edgeDamage.get(e.o + ':' + e.k) || 0));
  };
  const damageEdge = (x, z, nx, nz, amount) => {
    const left = edgeHpBetween(x, z, nx, nz);
    if (left === null) return null;
    const e = wallEdgeBetween(x, z, nx, nz);
    edgeDamage.set(e.o + ':' + e.k, (edgeDamage.get(e.o + ':' + e.k) || 0) + amount);
    return Math.max(0, left - amount);
  };
  // The live version movement consults: walls, plus any CLOSED door.
  const edgeOpen = (x, z, nx, nz) => {
    if (!wallEdgeOpen(x, z, nx, nz)) return false;
    const d = doorBetween(x, z, nx, nz);
    return !d || d.open;
  };
  // Sight (throws) crosses chest-high partitions freely, but not closed
  // doors - those go floor to frame.
  const sightOpen = (x, z, nx, nz) => {
    const d = doorBetween(x, z, nx, nz);
    return !d || d.open;
  };
  // CROUCH-height sight (SNEAK_PLAN D2): a sneaking body is crouch-high, so
  // the furniture that shields a crouch also hides a sneak. Cells: anything
  // solid or cover-grade blocks (the microwave a shot sails over still hides
  // whoever ducks behind it). Edges: partitions AND closed doors - which is
  // exactly the movement edge rule, aliased so the sight callers say what
  // they mean rather than borrowing movement's name.
  const sightOpenCellLow = (x, z) => {
    const d = defAt(x, z);
    return !d?.solid && !d?.cover;
  };
  const sightOpenLow = edgeOpen;
  // Full edge legality for a (possibly diagonal) single step. Cell solidity is
  // NOT checked here - callers layer terrain/enemies on top. A diagonal step
  // must clear all four edges around the crossed corner, so nobody slips past
  // the end of a partition.
  const stepOpen = (x, z, nx, nz) => {
    const dx = nx - x;
    const dz = nz - z;
    if (dx === 0 || dz === 0) return edgeOpen(x, z, nx, nz);
    return edgeOpen(x, z, nx, z) && edgeOpen(x, z, x, nz)
      && edgeOpen(nx, z, nx, nz) && edgeOpen(x, nz, nx, nz);
  };

  // Conduction: flood-fill pools of `conducts` surfaces (4-connected); a pool
  // with a `powers` surface on any 4-neighbour is electrified. Recomputed
  // whenever the grid mutates (setType), so a destroyed prop or repainted
  // tile can never leave a stale live pool behind. Pools do not leak through
  // edge walls: a partition dams the spill.
  function computeElectrified() {
    const electrified = new Set();
    const seen = new Set();
    const conducts = (x, z) => SURFACES[surfaceAt(x, z)]?.conducts;
    const powers = (x, z) => SURFACES[surfaceAt(x, z)]?.powers;
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        if (!conducts(x, z) || seen.has(x + ',' + z)) continue;
        const pool = [];
        const queue = [[x, z]];
        seen.add(x + ',' + z);
        let live = false;
        while (queue.length) {
          const [cx, cz] = queue.pop();
          pool.push(cx + ',' + cz);
          for (const [dx, dz] of N4) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (!wallEdgeOpen(cx, cz, nx, nz)) continue; // doors don't dam pools
            if (powers(nx, nz)) live = true;
            if (conducts(nx, nz) && !seen.has(nx + ',' + nz)) {
              seen.add(nx + ',' + nz);
              queue.push([nx, nz]);
            }
          }
        }
        if (live) for (const k of pool) electrified.add(k);
      }
    }
    return electrified;
  }
  let electrified = computeElectrified();
  const isElectrified = (x, z) => electrified.has(x + ',' + z);

  // Destructible props (exploding printers) mutate the grid at runtime.
  // Conduction depends on surfaces, and surfaces hang off tile types - so a
  // type change re-runs the flood fill.
  const setType = (x, z, type) => {
    if (z >= 0 && z < height && x >= 0 && x < width) {
      typeGrid[z][x] = type;
      propDamage.delete(x + ',' + z); // the pool belonged to what stood here
      electrified = computeElectrified();
    }
  };

  // --- per-placement rotation (EDITOR_INVENTORY IQ4, designer 2026-08-02) ------
  // `rotY` is a property of the tile TYPE, so every desk on every floor faced
  // the same way and a rotated one meant a whole new registry entry - which
  // also costs a scarce map character. An optional `props` array carries
  // per-CELL overrides instead: `"props": [{ "x": 8, "z": 2, "rotY": 90 }]`.
  //
  // Deliberately a sibling of `map` rather than new map syntax: every existing
  // level stays valid untouched, and one character per cell still means one
  // TYPE per cell. The trade the designer accepted is that the ASCII map is no
  // longer the complete picture of a level - a reader has to look here to learn
  // which way that desk faces.
  const propRot = new Map();
  for (const p of level.props || []) {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.z)) continue;
    // Quantised to the four orientations the designer asked for. Anything else
    // is a typo, and a desk at 37 degrees reads as a bug rather than a choice.
    const r = ((Math.round((p.rotY || 0) / 90) * 90) % 360 + 360) % 360;
    if (r) propRot.set(p.x + ',' + p.z, r);
  }
  // The rotation a cell's model should be drawn at: the placement's if it has
  // one, else the type's own.
  const rotAt = (x, z) => propRot.get(x + ',' + z) ?? (defAt(x, z)?.rotY || 0);

  return {
    props: level.props || [],
    rotAt,
    name: level.name || '', width, height,
    typeAt, defAt, terrainOpen, sightOpenCell, sightOpenCellLow, sightOpenLow, surfaceAt, isElectrified, setType,
    propHpAt, damageProp, edgeHpBetween, damageEdge,
    hWalls, vWalls, edgeOpen, stepOpen, sightOpen, wallEdgeBetween, removeEdgeBetween,
    doors, doorBetween, setDoorOpen,
    playerSpawn, enemySpawns, npcSpawns, companionSpawns,
  };
}
