// Layered levels (EDITOR_PLAN feasibility spike): a level may carry a
// "layers" array - full storeys, each authored as an ordinary flat map with
// its own walls/doors and one optional `height` - stacked bottom-up. Every
// within-storey rule (movement, walls, doors, conduction) is the existing
// parseLevel, run once per storey; the only genuinely new mechanics here are
// the generated staircases that connect storeys and the route planner that
// chains within-storey walks through them. Pure logic - no PlayCanvas, no
// DOM - so all of it unit-tests like grid.js does.
import { parseLevel } from './grid.js';
import { findPath } from './pathfinding.js';

// Default storey-to-storey rise, world units. A layer entry may carry its own
// `height` (the designer's "one layer/height setting", 2026-08-01) - the
// spike level's atrium ground storey is taller than this default.
export const STOREY_H = 2.1;

export function parseFloors(level) {
  const name = level.name || '';
  const layers = level.layers.map((layer, i) => parseLevel({
    name: `${name} [storey ${i}]`,
    tiles: level.tiles,
    actors: level.actors,
    map: layer.map,
    walls: layer.walls,
    doors: layer.doors,
  }));
  const baseY = [0];
  for (let i = 0; i < layers.length - 1; i++) {
    baseY.push(baseY[i] + (level.layers[i].height ?? STOREY_H));
  }
  // Actors above the ground storey would need layer-aware bodies - blocking,
  // wander, combat entry, spawn height. The spike scopes them out loudly
  // rather than half-supporting them.
  for (let i = 1; i < layers.length; i++) {
    const g = layers[i];
    if (g.enemySpawns.length || g.npcSpawns.length || g.companionSpawns.length) {
      throw new Error(
        `Level "${name}": actors on storey ${i} are not supported yet - place them on the ground storey`);
    }
  }
  const stairs = findStairRuns(name, layers);
  const stairAt = (l, x, z) =>
    stairs.find((s) => s.layer === l && s.cells.some((c) => c.x === x && c.z === z)) || null;
  return { layers, baseY, stairs, stairAt };
}

// Group contiguous stair cells into straight runs and resolve each run's
// direction from the floors around it: exactly one end must open onto the
// storey above (the landing) and the opposite end onto this storey (the
// entry). Anything else is an authoring error worth naming - a silent guess
// here becomes a staircase that climbs somewhere the designer didn't build.
function findStairRuns(name, layers) {
  const runs = [];
  for (let l = 0; l < layers.length; l++) {
    const g = layers[l];
    const cells = new Set();
    for (let z = 0; z < g.height; z++) {
      for (let x = 0; x < g.width; x++) {
        if (g.typeAt(x, z) === 'stairway') cells.add(x + ',' + z);
      }
    }
    if (cells.size && l === layers.length - 1) {
      throw new Error(`Level "${name}": stairs on the top storey lead nowhere`);
    }
    const seen = new Set();
    for (const key of cells) {
      if (seen.has(key)) continue;
      const [x, z] = key.split(',').map(Number);
      // A run extends along one axis; a single cell defaults to z and lets
      // the landing checks resolve which way it faces.
      const alongX = cells.has((x + 1) + ',' + z) || cells.has((x - 1) + ',' + z);
      const dx = alongX ? 1 : 0;
      const dz = alongX ? 0 : 1;
      let sx = x;
      let sz = z;
      while (cells.has((sx - dx) + ',' + (sz - dz))) { sx -= dx; sz -= dz; }
      const run = [];
      for (let cx = sx, cz = sz; cells.has(cx + ',' + cz); cx += dx, cz += dz) {
        run.push({ x: cx, z: cz });
        seen.add(cx + ',' + cz);
      }
      runs.push(resolveRun(name, layers, l, run, dx, dz));
    }
  }
  return runs;
}

function resolveRun(name, layers, l, run, dx, dz) {
  const g = layers[l];
  const upper = layers[l + 1];
  // In-bounds void reads null from typeAt; out-of-map must count as air too
  // (an upper storey's map only needs to cover the floor it actually has),
  // which is exactly the case typeAt's 'wall' fallback exists to prevent for
  // sight - so the bounds check is explicit here.
  const at = (grid, x, z) =>
    (x >= 0 && x < grid.width && z >= 0 && z < grid.height ? grid.typeAt(x, z) : null);
  const where = `stairs at (${run[0].x},${run[0].z}) on storey ${l}`;
  for (const c of run) {
    const over = at(upper, c.x, c.z);
    if (over !== null) {
      throw new Error(`Level "${name}": ${where} needs open air above every stair cell - `
        + `storey ${l + 1} has "${over}" over (${c.x},${c.z})`);
    }
  }
  const first = run[0];
  const last = run[run.length - 1];
  const endA = { x: first.x - dx, z: first.z - dz };
  const endB = { x: last.x + dx, z: last.z + dz };
  const openUp = (p) => at(upper, p.x, p.z) !== null && upper.terrainOpen(p.x, p.z);
  const aUp = openUp(endA);
  const bUp = openUp(endB);
  if (aUp === bUp) {
    throw new Error(`Level "${name}": ${where} needs exactly one end open on storey ${l + 1} `
      + `(the landing) - ${aUp ? 'both are' : 'neither is'}`);
  }
  const top = aUp ? endA : endB;
  const entry = aUp ? endB : endA;
  if (!g.terrainOpen(entry.x, entry.z)) {
    throw new Error(
      `Level "${name}": ${where} has no walkable entry at (${entry.x},${entry.z}) on its own storey`);
  }
  // Cells ordered from the entry side up, so a renderer's slice `idx` is also
  // how far up the flight that cell sits.
  const cells = aUp ? [...run].reverse() : run;
  const dir = { dx: Math.sign(top.x - entry.x), dz: Math.sign(top.z - entry.z) };
  return { layer: l, upper: l + 1, cells, entry, top, dir };
}

// The grid facade for a layered level: every question the game asks of "the
// grid" is answered by the storey the leader is currently on. Pure
// delegation - each storey keeps its own parse, walls, doors, damage pools
// and conduction - so a single storey and a flat level share one rulebook by
// construction.
export function layeredGrid(floors, level, getActive) {
  const g = () => floors.layers[getActive()];
  const facade = {
    name: level.name || '',
    width: Math.max(...floors.layers.map((l) => l.width)),
    height: Math.max(...floors.layers.map((l) => l.height)),
    // Spawns come off the ground storey: parseFloors already refuses actors
    // above it, and the player starts at street level.
    playerSpawn: floors.layers[0].playerSpawn,
    enemySpawns: floors.layers[0].enemySpawns,
    npcSpawns: floors.layers[0].npcSpawns,
    companionSpawns: floors.layers[0].companionSpawns,
  };
  const METHODS = ['typeAt', 'defAt', 'terrainOpen', 'sightOpenCell', 'surfaceAt', 'isElectrified',
    'setType', 'propHpAt', 'damageProp', 'edgeHpBetween', 'damageEdge', 'edgeOpen', 'stepOpen',
    'sightOpen', 'wallEdgeBetween', 'removeEdgeBetween', 'doorBetween', 'setDoorOpen'];
  for (const m of METHODS) facade[m] = (...args) => g()[m](...args);
  // Sets and maps are read as properties, so they need live getters.
  for (const p of ['hWalls', 'vWalls', 'doors']) {
    Object.defineProperty(facade, p, { get: () => g()[p] });
  }
  return facade;
}

// Route between two points that may sit on different storeys: within-storey
// walks (the caller's own walkability per storey) chained through stair
// climbs. Returns { legs, cost } or null; legs are either
//   { kind: 'walk', layer, path }              - findPath output, tile waypoints
//   { kind: 'climb', from, to, run }           - entry <-> landing, `run` cells long
// A climb costs its run plus the two thresholds, in tile-lengths, so "the far
// stair" and "the near one" are weighed honestly against each other.
export function planCrossLayerRoute(floors, from, to, walkableOn, costOn = () => null) {
  const walkLeg = (l, ax, az, bx, bz) => {
    if (ax === bx && az === bz) return [[ax, az]];
    return findPath(walkableOn(l), ax, az, bx, bz, costOn(l), floors.layers[l].stepOpen);
  };
  function fromLayer(px, pz, l) {
    if (l === to.layer) {
      const p = walkLeg(l, px, pz, to.x, to.z);
      return p ? { legs: [{ kind: 'walk', layer: l, path: p }], cost: p.length } : null;
    }
    const up = to.layer > l;
    let best = null;
    for (const s of floors.stairs) {
      if (up ? s.layer !== l : s.upper !== l) continue;
      const gate = up ? s.entry : s.top; // where this storey boards the flight
      const exit = up ? s.top : s.entry; // where the next storey receives you
      const p = walkLeg(l, px, pz, gate.x, gate.z);
      if (!p) continue;
      const rest = fromLayer(exit.x, exit.z, up ? s.upper : s.layer);
      if (!rest) continue;
      const cost = p.length + s.cells.length + 2 + rest.cost;
      if (!best || cost < best.cost) {
        best = {
          cost,
          legs: [
            { kind: 'walk', layer: l, path: p },
            {
              kind: 'climb',
              from: { x: gate.x, z: gate.z, layer: l },
              to: { x: exit.x, z: exit.z, layer: up ? s.upper : s.layer },
              run: s.cells.length,
            },
            ...rest.legs,
          ],
        };
      }
    }
    return best;
  }
  return fromLayer(from.x, from.z, from.layer);
}
