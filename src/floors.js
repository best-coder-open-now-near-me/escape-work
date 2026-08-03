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
        // The DEF's flag, not the tile id: `stairs: true` exists in
        // data/tiles.js for exactly this, and scene.js:77 already reads it to
        // decide what to draw. Asking the id here made two owners of "what is
        // a staircase" that only agree because `stairway` is currently the
        // one tile carrying the flag - so a second stair tile added as pure
        // data would RENDER as a flight and have no run, no entry and no
        // landing (Q109/Q110). `defAt` falls back to the wall def out of
        // bounds, which carries no `stairs`, so void cells stay false exactly
        // as the id compare did.
        if (g.defAt(x, z).stairs) cells.add(x + ',' + z);
      }
    }
    if (cells.size && l === layers.length - 1) {
      throw new Error(`Level "${name}": stairs on the top storey lead nowhere`);
    }
    const seen = new Set();
    for (const key of cells) {
      if (seen.has(key)) continue;
      const [x, z] = key.split(',').map(Number);
      // A run extends along one axis, read off its neighbours.
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
      // A LONE cell has no neighbour to read, so it used to be assumed to run
      // along z - and an east-west one-cell flight was then refused with a
      // message naming the wrong reason (Q058). The axis of a single cell is
      // not a property of the cells at all; it is decided by where the landing
      // is, which is `resolveRun`'s question. So ask it both ways.
      runs.push(run.length === 1
        ? resolveLoneCell(name, layers, l, run)
        : resolveRun(name, layers, l, run, dx, dz));
    }
  }
  return runs;
}

// The one-cell case: let the landing rules pick the axis instead of guessing
// ahead of them. z first, so a flight that only works north-south resolves
// exactly as it always did. Both axes working is a real authoring ambiguity
// and gets its own named error, in this module's existing house style - name
// the mistake rather than pick one and hope (see the top-storey check).
function resolveLoneCell(name, layers, l, run) {
  const found = [];
  const failures = [];
  for (const [dx, dz] of [[0, 1], [1, 0]]) {
    try {
      found.push(resolveRun(name, layers, l, run, dx, dz));
    } catch (e) {
      failures.push(e);
    }
  }
  if (found.length === 1) return found[0];
  const where = `single-cell stairs at (${run[0].x},${run[0].z}) on storey ${l}`;
  if (found.length === 2) {
    throw new Error(`Level "${name}": ${where} has a landing on storey ${l + 1} BOTH `
      + `north-south and east-west, so which way it climbs is ambiguous - `
      + `extend the flight to two cells to say.`);
  }
  // Neither axis worked. Both messages are honest now, because both were
  // really tried; lead with the north-south one, which is the shape the old
  // code assumed and so the one an author most likely meant.
  throw failures[0];
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
  // Every function a single-storey grid exposes. Hand-maintained lists rot:
  // this one silently omitted `sightOpenCellLow` and `sightOpenLow`, which the
  // sneak cone sweep calls, so sneaking on a layered level threw a TypeError
  // (REVIEW.md 2026-08-02 section 1.14). `floors.test.js` now derives the
  // expected set from a real grid and fails on any future omission.
  const METHODS = ['typeAt', 'defAt', 'terrainOpen', 'sightOpenCell', 'sightOpenCellLow',
    'sightOpenLow', 'surfaceAt', 'isElectrified',
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
  // Every stair a storey can board, in BOTH directions. The search used to
  // take only the flights that moved toward `to.layer`, which quietly assumed
  // the building is a stack of fully-connected floors: the moment a storey's
  // two flights do not share a walkable region - the mezzanine you cross to
  // reach the far stairwell, the lobby you drop back into to get around a
  // sealed corridor - the honest route is up-and-back-down (or down-and-back-
  // up), and monotonic search calls it "no way to get there from here".
  const boardable = (l) => {
    const out = [];
    for (const s of floors.stairs) {
      if (s.layer === l) out.push({ s, gate: s.entry, exit: s.top, to: s.upper });
      if (s.upper === l) out.push({ s, gate: s.top, exit: s.entry, to: s.layer });
    }
    return out;
  };
  // Both directions means a route can revisit a storey, so the walk needs a
  // cycle guard the monotonic version got for free. It counts FLIGHTS, not
  // storeys: coming back to a floor you have already been on is the whole
  // point (up the west stair, across, down the east one), so a storey guard
  // would forbid the routes this exists to find. Riding the same flight twice
  // on one branch never helps - it returns you to a storey you could already
  // leave from anywhere - so barring that is enough to terminate, and it
  // leaves every legitimate route on the table.
  function fromLayer(px, pz, l, seen = new Set()) {
    let best = null;
    // Standing on the destination storey is a CANDIDATE, not an answer. It was
    // an early return, so a goal on this storey that the walk cannot reach -
    // two wings joined only by the floor above, a corridor sealed off - was
    // reported unreachable while a perfectly good route up and back down sat
    // there. The stair search below still runs, and the cheaper of the two
    // wins.
    if (l === to.layer) {
      const p = walkLeg(l, px, pz, to.x, to.z);
      if (p) best = { legs: [{ kind: 'walk', layer: l, path: p }], cost: p.length };
    }
    for (const { s, gate, exit, to: next } of boardable(l)) {
      if (seen.has(s)) continue;
      const p = walkLeg(l, px, pz, gate.x, gate.z);
      if (!p) continue;
      const rest = fromLayer(exit.x, exit.z, next, new Set(seen).add(s));
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
              to: { x: exit.x, z: exit.z, layer: next },
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
