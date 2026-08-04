// What a floor's PLACEMENT implies, computed without playing it.
//
// The editor could show what a level looks like and nothing about how it plays.
// Every fact below is a consequence of where things were painted, derivable
// from the same rules the game uses - so an author could always have known it,
// but only by walking the floor and finding out.
//
// Pure: level JSON in, cell sets and numbers out. No PlayCanvas, no DOM. The
// editor draws these as flat quads; the unit tests assert them directly.
//
// Deliberately reuses the game's own predicates rather than re-deriving them:
// `segmentClear`/`sightOpenCell` for who can see whom, `shieldedFaces` for
// cover, `SURPRISE_RADIUS` for the surprise band. A second opinion about cover
// would be worse than no opinion.
import { parseLevel } from './grid.js';
import { SURFACES } from './data/surfaces.js';
import { ENEMY_TYPES } from './data/enemies.js';
import { scaleEnemy } from './stats.js';
import { ITEMS, LOOT_TABLES } from './data/items.js';
import { shieldedFaces } from './tactics.js';
import { segmentClear } from './pathfinding.js';
import { SURPRISE_RADIUS } from './combat-geometry.js';
import { STEALTH } from './stats.js';

const key = (x, z) => x + ',' + z;

/** Cells reachable on foot from the player spawn, doors counting as openable. */
export function reachable(g) {
  const step = (x, z, nx, nz) => g.edgeOpen(x, z, nx, nz) || !!g.doorBetween(x, z, nx, nz);
  const seen = new Set();
  if (!g.playerSpawn) return seen;
  const stack = [[g.playerSpawn.x, g.playerSpawn.z]];
  seen.add(key(g.playerSpawn.x, g.playerSpawn.z));
  while (stack.length) {
    const [x, z] = stack.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (seen.has(key(nx, nz)) || !g.terrainOpen(nx, nz) || !step(x, z, nx, nz)) continue;
      seen.add(key(nx, nz));
      stack.push([nx, nz]);
    }
  }
  return seen;
}

/** Walkable cells the player can never stand on. Rooms nobody can enter. */
export function orphans(g) {
  const seen = reachable(g);
  const out = new Set();
  for (let z = 0; z < g.height; z++) {
    for (let x = 0; x < g.width; x++) {
      if (g.terrainOpen(x, z) && !seen.has(key(x, z))) out.add(key(x, z));
    }
  }
  return out;
}

/**
 * Which cells offer cover, and how much of it. `shieldedFaces` is the game's
 * own answer - the count of orthogonal faces with a wall, partition, closed
 * door or solid prop against them. 0 is open ground; 4 is a cupboard.
 */
export function coverMap(g) {
  const coverCell = (x, z) => {
    const def = g.defAt(x, z);
    return !!def && !!def.solid;
  };
  const out = new Map();
  for (let z = 0; z < g.height; z++) {
    for (let x = 0; x < g.width; x++) {
      if (!g.terrainOpen(x, z)) continue;
      const n = shieldedFaces(x, z, { edgeOpen: g.edgeOpen, coverCell }).length;
      if (n) out.set(key(x, z), n);
    }
  }
  return out;
}

/**
 * The enemies that would join ONE fight, grouped. Two coworkers are in the same
 * fight when a clear sightline joins them (`canTakePart` in main.js is the same
 * `segmentClear` call), so this is the transitive closure of that relation.
 * A group of six is a very different floor from three groups of two.
 */
export function engagementClusters(g) {
  const spawns = g.enemySpawns;
  const sees = (a, b) => segmentClear(g.sightOpenCell, a.x, a.z, b.x, b.z, g.sightOpen);
  const parent = spawns.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < spawns.length; i++) {
    for (let j = i + 1; j < spawns.length; j++) {
      if (sees(spawns[i], spawns[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  spawns.forEach((s, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s);
  });
  return [...groups.values()];
}

/**
 * Cells inside an enemy's surprise radius: start a fight from here and that
 * coworker loses its first turn. A placement fact with no representation
 * anywhere until now.
 */
export function surpriseBand(g) {
  const out = new Set();
  for (const s of g.enemySpawns) {
    for (let dz = -SURPRISE_RADIUS; dz <= SURPRISE_RADIUS; dz++) {
      for (let dx = -SURPRISE_RADIUS; dx <= SURPRISE_RADIUS; dx++) {
        const x = s.x + dx;
        const z = s.z + dz;
        if (g.terrainOpen(x, z)) out.add(key(x, z));
      }
    }
  }
  return out;
}

/**
 * Where a placed coworker might actually be standing. They drift up to
 * `radius` tiles from where they were painted, so the painted position is not
 * the position that matters for a sightline or a chokepoint.
 */
export function wanderFootprint(g, radius = 2) {
  const out = new Set();
  for (const s of g.enemySpawns) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = s.x + dx;
        const z = s.z + dz;
        if (g.terrainOpen(x, z)) out.add(key(x, z));
      }
    }
  }
  return out;
}

/**
 * Cells a coworker could notice you from, at the stealth cone's RANGE. The cone
 * needs a facing and placements do not carry one yet (SNEAK_PLAN defers
 * editor-authored facing), so this is the honest half of the answer: the radius
 * within which facing is the only thing left to decide it.
 */
export function noticeRange(g, range = STEALTH.CONE_RANGE) {
  const out = new Set();
  for (const s of g.enemySpawns) {
    for (let dz = -range; dz <= range; dz++) {
      for (let dx = -range; dx <= range; dx++) {
        if (Math.hypot(dx, dz) > range) continue;
        const x = s.x + dx;
        const z = s.z + dz;
        if (!g.terrainOpen(x, z)) continue;
        // Sight, not just distance - a coworker behind a snack machine is not
        // watching the corridor beyond it.
        if (segmentClear(g.sightOpenCell, s.x, s.z, x, z, g.sightOpen)) out.add(key(x, z));
      }
    }
  }
  return out;
}

/**
 * Everything that would eventually burn if a fire started at `from`. Fire
 * spreads to 4-neighbours through open edges, igniting flammable surfaces and
 * arming explosive props on them (surfaces-runtime.js), and a detonation
 * re-ignites its own neighbours - so a paper drift past two printers is a
 * floor-wide chain the author cannot see until it happens in play.
 */
export function fireSpread(g, from) {
  const burns = new Set();
  const blasts = new Set();
  if (!from || !g.terrainOpen(from.x, from.z)) return { burns, blasts };
  // `flammable` is a SURFACE property, not a tile-type one - a paper drift
  // burns, the floor it lies on does not (data/surfaces.js, and the same lookup
  // surfaces-runtime.js makes).
  const flammableAt = (x, z) => !!SURFACES[g.surfaceAt(x, z)]?.flammable;
  const explosiveAt = (x, z) => !!g.defAt(x, z)?.explosive;
  const stack = [[from.x, from.z]];
  burns.add(key(from.x, from.z));
  while (stack.length) {
    const [x, z] = stack.pop();
    if (explosiveAt(x, z)) blasts.add(key(x, z));
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const nz = z + dz;
      const k = key(nx, nz);
      if (burns.has(k)) continue;
      if (!g.terrainOpen(nx, nz) && !explosiveAt(nx, nz)) continue;
      if (!g.edgeOpen(x, z, nx, nz)) continue;
      if (!flammableAt(nx, nz) && !explosiveAt(nx, nz)) continue;
      burns.add(k);
      stack.push([nx, nz]);
    }
  }
  return { burns, blasts };
}

// The expected haul from a loot table: every entry's chance times its worth.
function tableValue(table, field) {
  let total = 0;
  for (const { item, chance = 1 } of LOOT_TABLES[table] || []) {
    const def = ITEMS[item];
    if (!def) continue;
    total += chance * (def[field] || 0);
  }
  return total;
}

// The expected NUMBER of items from a table carrying a given field at all -
// "how many first-aid kits does this floor hold" is a count question, not a
// magnitude one.
function tableCount(table, field) {
  let total = 0;
  for (const { item, chance = 1 } of LOOT_TABLES[table] || []) {
    if (ITEMS[item]?.[field]) total += chance;
  }
  return total;
}

/**
 * What the floor is worth, in the terms a balance pass cares about: how much
 * healing, ammo, cash and XP it holds. Every input was already in the level -
 * it just had to be played to find out.
 */
export function floorBudget(level) {
  const g = parseLevel(level);
  // `healHp` is expected HP of healing on the floor; `revives` is expected
  // COUNT of things that can stand somebody back up, which since the automatic
  // revives were struck is the number a run actually depends on.
  const out = { healHp: 0, ammo: 0, cash: 0, xp: 0, enemies: 0, revives: 0, containers: 0 };
  for (let z = 0; z < g.height; z++) {
    for (let x = 0; x < g.width; x++) {
      const def = g.defAt(x, z);
      if (!def) continue;
      if (def.loot) {
        out.containers += 1;
        out.healHp += tableValue(def.loot, 'heal');
        out.ammo += tableValue(def.loot, 'ammo');
        out.cash += tableValue(def.loot, 'cash');
        out.revives += tableCount(def.loot, 'revive');
      }
      // Paper on the floor is ammo you walk over.
      const surf = g.surfaceAt(x, z);
      if (surf && SURFACES[surf]?.ammo) out.ammo += SURFACES[surf].ammo;
    }
  }
  for (const s of g.enemySpawns) {
    const base = ENEMY_TYPES[s.type];
    if (!base) continue;
    out.enemies += 1;
    out.xp += scaleEnemy(base, s.level ?? (base.level || 1)).xp || 0;
  }
  out.healHp = Math.round(out.healHp * 10) / 10;
  out.ammo = Math.round(out.ammo * 10) / 10;
  out.cash = Math.round(out.cash * 10) / 10;
  out.revives = Math.round(out.revives * 100) / 100;
  return out;
}
