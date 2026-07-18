// Level parsing and terrain queries. Pure logic - no PlayCanvas, no DOM.
//
// A level file has a "tiles" legend (char -> tile type id from data/tiles.js),
// an "actors" legend (char -> 'player' or an enemy type id from
// data/enemies.js), and an ASCII "map". Actor tiles stand on plain floor.
import { TILE_TYPES } from './data/tiles.js';
import { SURFACES } from './data/surfaces.js';

// Old saves/exports may reference renamed tile types.
const TYPE_ALIASES = { 'wet-floor': 'water' };

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

  // Conduction: flood-fill pools of `conducts` surfaces (4-connected); a pool
  // with a `powers` surface on any 4-neighbour is electrified. Computed once -
  // cables don't move (yet).
  const electrified = new Set();
  {
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
  }
  const isElectrified = (x, z) => electrified.has(x + ',' + z);

  // Destructible props (exploding printers) mutate the grid at runtime.
  const setType = (x, z, type) => {
    if (z >= 0 && z < height && x >= 0 && x < width) typeGrid[z][x] = type;
  };

  return {
    name: level.name || '', width, height,
    typeAt, defAt, terrainOpen, surfaceAt, isElectrified, setType,
    playerSpawn, enemySpawns,
  };
}
