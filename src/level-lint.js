// Is this level playable? One implementation, two callers.
//
// These rules already existed - as assertions inside tests/unit/levels.test.js,
// which only ever run over files that are ALREADY in levels/. So the editor,
// the thing that produces those files, enforced none of them: you could paint a
// floor with no exit, or an exit walled off from the spawn, Export it, paste it
// in, and find out from CI. The feedback loop for "this floor cannot be
// finished" ran through a git commit.
//
// So the rules live here instead, as pure functions over level JSON. The test
// suite calls them over levels/*.json; the editor calls them on a debounce and
// paints the result into its status chip. Neither can drift from the other,
// which is the point - a lint the authoring tool cannot run is a lint that
// only ever fires after the mistake has been committed.
//
// Pure: no PlayCanvas, no DOM, no filesystem. It imports the same `parseLevel`
// the game boots with and the same `findPath` the AI walks with, so "reachable"
// here means reachable in the game rather than reachable in a second opinion.
import { parseLevel } from './grid.js';
import { findPath } from './pathfinding.js';

// A finding is { level: 'error' | 'warn', rule, message, target? }. `target`
// is optional because some format failures have no honest map location; when
// present it is a { kind: 'cell' | 'edge', x, z, o? } the editor can select.
const finding = (level, rule, message, target = null) =>
  target ? { level, rule, message, target } : { level, rule, message };
const err = (rule, message, target) => finding('error', rule, message, target);
const warn = (rule, message, target) => finding('warn', rule, message, target);

// Walk the map for the first cell of a type. Levels are <=40x40, so a scan is
// cheaper than an index that has to be kept honest.
function findType(g, type) {
  for (let z = 0; z < g.height; z++) {
    for (let x = 0; x < g.width; x++) if (g.typeAt(x, z) === type) return { x, z };
  }
  return null;
}

// Doors count as passable: a closed door is an obstacle, not a wall, and a
// route through one is a route. This is the same predicate the shipped lint
// used, kept identical on purpose.
const stepPassableOf = (g) => (x, z, nx, nz) =>
  g.edgeOpen(x, z, nx, nz) || !!g.doorBetween(x, z, nx, nz);

/**
 * Every playability and consistency problem in a level, worst first.
 * Returns [] for a level that is fine.
 */
export function lintLevel(data) {
  const out = [];
  if (!data || !Array.isArray(data.map) || !data.map.length) {
    return [err('parse', 'The level has no map.')];
  }

  // --- legend consistency (checked before parsing, since parse depends on it)
  const tiles = data.tiles || {};
  const actors = data.actors || {};
  for (const ch of Object.keys(tiles)) {
    if (actors[ch]) {
      out.push(err('legend-collision',
        `Character "${ch}" is both a tile and an actor. parseLevel reads actors first, so the tile would vanish.`));
    }
  }
  const declared = new Set([...Object.keys(tiles), ...Object.keys(actors)]);
  const undeclared = new Map();
  for (let z = 0; z < data.map.length; z++) {
    for (let x = 0; x < data.map[z].length; x++) {
      const ch = data.map[z][x];
      if (ch !== ' ' && !declared.has(ch) && !undeclared.has(ch)) undeclared.set(ch, { kind: 'cell', x, z });
    }
  }
  for (const [ch, target] of undeclared) {
    // parseLevel defaults an unknown tile char to floor, so this ships as
    // invisible walkable floor rather than as an error.
    out.push(err('undeclared-char', `Map character "${ch}" is in no legend - it would load as blank floor.`, target));
  }

  let g;
  try {
    g = parseLevel(data);
  } catch (e) {
    // A named parse error (unknown tile type, bad actor ref) is the most useful
    // thing we can say, and nothing below is meaningful without a grid.
    return [...out, err('parse', e.message)];
  }

  // --- the three rules that decide whether a floor can be finished -----------
  const playerChar = Object.entries(actors).find(([, v]) => v === 'player')?.[0];
  const hasSpawn = !!playerChar && data.map.some((row) => row.includes(playerChar));
  if (!hasSpawn) out.push(err('no-spawn', 'No player start. Paint one with the "player start" brush.'));

  const exit = findType(g, 'exit');
  if (!exit) out.push(err('no-exit', 'No exit tile. The floor cannot be completed.'));

  if (hasSpawn && exit) {
    const route = findPath(
      g.terrainOpen, g.playerSpawn.x, g.playerSpawn.z, exit.x, exit.z, null, stepPassableOf(g));
    if (!route) {
      out.push(err('exit-unreachable',
      `The exit at ${exit.x},${exit.z} cannot be walked to from the start. Something is sealing it off.`,
      { kind: 'cell', x: exit.x, z: exit.z }));
    }
  }

  // --- warnings: it will play, but somebody probably did not mean it ---------

  // The party needs somewhere to stand. Restored companions take the first
  // walkable, unoccupied neighbour of the spawn and otherwise stack on it
  // (main.js), so a spawn in a nook holds the party in one square until the
  // leader walks far enough to force a repath. PARTY_CAP is 3, hence 2.
  if (hasSpawn) {
    const { x, z } = g.playerSpawn;
    let free = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (g.terrainOpen(nx, nz) && stepPassableOf(g)(x, z, nx, nz)) free++;
      }
    }
    if (free < 2) {
      out.push(warn('cramped-spawn',
        `The start has ${free} free neighbour${free === 1 ? '' : 's'}; the party needs 2 to stand apart.`,
        { kind: 'cell', x, z }));
    }
  }

  // A door between two solid cells, or on the map's edge, renders and lists and
  // leads nowhere. It reads as a route on the map and is not one.
  for (const [runs, orient] of [[data.doors || [], null]]) {
    void orient;
    for (const run of runs) {
      const [o, sx, sz, len = 1] = String(run).split(/\s+/);
      const n = Number(len) || 1;
      for (let i = 0; i < n; i++) {
        const x = Number(sx) + (o === 'H' ? i : 0);
        const z = Number(sz) + (o === 'H' ? 0 : i);
        // The two cells a door joins, in grid terms.
        const a = o === 'H' ? { x, z: z - 1 } : { x: x - 1, z };
        const b = { x, z };
        const openA = g.terrainOpen(a.x, a.z);
        const openB = g.terrainOpen(b.x, b.z);
        if (!openA || !openB) {
          out.push(warn('dead-door',
            `The door at ${o} ${x},${z} has ${(!openA && !openB) ? 'no' : 'only one'} walkable side.`,
            { kind: 'edge', o: o.toLowerCase(), x, z }));
        }
      }
    }
  }

  // Orphaned floor: reachable-from-spawn is the definition that matters, since
  // that is where the player starts. Anything walkable and unreachable is a
  // room nobody can enter - or a coworker sealed in one.
  if (hasSpawn) {
    const step = stepPassableOf(g);
    const seen = new Set();
    const stack = [[g.playerSpawn.x, g.playerSpawn.z]];
    seen.add(g.playerSpawn.x + ',' + g.playerSpawn.z);
    while (stack.length) {
      const [x, z] = stack.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const nz = z + dz;
        const k = nx + ',' + nz;
        if (seen.has(k) || !g.terrainOpen(nx, nz) || !step(x, z, nx, nz)) continue;
        seen.add(k);
        stack.push([nx, nz]);
      }
    }
    let orphaned = 0;
    let firstOrphan = null;
    for (let z = 0; z < g.height; z++) {
      for (let x = 0; x < g.width; x++) {
        if (g.terrainOpen(x, z) && !seen.has(x + ',' + z)) {
          orphaned++;
          if (!firstOrphan) firstOrphan = { kind: 'cell', x, z };
        }
      }
    }
    if (orphaned) {
      out.push(warn('orphaned-floor',
        `${orphaned} walkable tile${orphaned === 1 ? '' : 's'} cannot be reached from the start.`, firstOrphan));
    }
  }

  return out;
}

/** True when nothing would stop the floor being played end to end. */
export const isPlayable = (data) => !lintLevel(data).some((f) => f.level === 'error');
