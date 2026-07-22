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
import { TILE_TYPES } from './data/tiles.js';
import { SURFACES } from './data/surfaces.js';

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
      const actor = actorsLegend[ch];
      if (actor !== undefined) {
        if (actor === 'player') playerSpawn = { x, z };
        else enemySpawns.push({ type: actor, x, z });
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
  const surfaceAt = (x, z) => defAt(x, z).surface || null;

  // --- edge walls -------------------------------------------------------------
  const { h: hWalls, v: vWalls } = parseWallRuns(level.walls);
  // Is the shared edge between two 4-adjacent cells free of a wall?
  const edgeOpen = (x, z, nx, nz) => {
    if (nx > x) return !vWalls.has(nx + ',' + z);
    if (nx < x) return !vWalls.has(x + ',' + z);
    if (nz > z) return !hWalls.has(x + ',' + nz);
    if (nz < z) return !hWalls.has(x + ',' + z);
    return true;
  };
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
            if (!edgeOpen(cx, cz, nx, nz)) continue;
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
      electrified = computeElectrified();
    }
  };

  return {
    name: level.name || '', width, height,
    typeAt, defAt, terrainOpen, surfaceAt, isElectrified, setType,
    hWalls, vWalls, edgeOpen, stepOpen,
    playerSpawn, enemySpawns,
  };
}
