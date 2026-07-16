// Level parsing and terrain queries. Pure logic - no PlayCanvas, no DOM.
//
// A level file has a "tiles" legend (char -> tile type id from data/tiles.js),
// an "actors" legend (char -> 'player' or an enemy type id from
// data/enemies.js), and an ASCII "map". Actor tiles stand on plain floor.
import { TILE_TYPES } from './data/tiles.js';

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
      const type = tilesLegend[ch] || 'floor';
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

  return { name: level.name || '', width, height, typeAt, defAt, terrainOpen, playerSpawn, enemySpawns };
}
