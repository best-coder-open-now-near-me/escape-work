// Shipped-level validation: every level in levels/ must parse, agree with the
// registries, and use the registries' canonical characters (the editor
// round-trips on those). Catches a bad hand edit before it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseLevel } from '../../src/grid.js';
import { findPath } from '../../src/pathfinding.js';
import { existsSync } from 'node:fs';
import { TILE_TYPES } from '../../src/data/tiles.js';
import { ENEMY_TYPES } from '../../src/data/enemies.js';
import { NPCS } from '../../src/data/npcs.js';
import { COMPANIONS } from '../../src/data/companions.js';
import { CLASSES } from '../../src/data/classes.js';
import { ACTIONS } from '../../src/data/actions.js';
import { ITEMS, LOOT_TABLES } from '../../src/data/items.js';
import { LEVELS, FIRST_LEVEL } from '../../src/data/levels.js';
import { STATUSES } from '../../src/data/statuses.js';
import { SURFACES, ELECTRIFIED, FIRE } from '../../src/data/surfaces.js';

const files = readdirSync('levels').filter((f) => f.endsWith('.json'));
const load = (f) => JSON.parse(readFileSync(`levels/${f}`, 'utf8'));

test('there are shipped levels', () => {
  assert.ok(files.length >= 1);
});

test('every registry cross-reference resolves', () => {
  // Class/companion action ids and their track grants must exist in ACTIONS.
  for (const [regName, reg] of [['CLASSES', CLASSES], ['COMPANIONS', COMPANIONS]]) {
    for (const [id, def] of Object.entries(reg)) {
      for (const a of def.actions || []) assert.ok(ACTIONS[a], `${regName}.${id} action "${a}" exists`);
      for (const node of def.track || []) {
        const grant = node.effect?.grantsAction;
        if (grant) assert.ok(ACTIONS[grant], `${regName}.${id} track grants real action "${grant}"`);
      }
    }
  }
  // Every `applies` names a real status. applyStatus() returns false for an
  // unknown id without a peep, so a typo here ships an attack, surface or
  // weapon proc whose rider silently never fires - the exact bug class a lint
  // is for. Walks every registry that can carry one.
  const statusSites = [];
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.applies) statusSites.push([`ACTIONS.${id}.applies`, a.applies]);
  }
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    for (const [i, atk] of (def.attacks || []).entries()) {
      if (atk.applies) statusSites.push([`ENEMY_TYPES.${id}.attacks[${i}].applies`, atk.applies]);
    }
  }
  for (const [id, def] of Object.entries(CLASSES)) {
    for (const [i, atk] of (def.attacks || []).entries()) {
      if (atk.applies) statusSites.push([`CLASSES.${id}.attacks[${i}].applies`, atk.applies]);
    }
  }
  for (const [id, it] of Object.entries(ITEMS)) {
    if (it.proc?.applies) statusSites.push([`ITEMS.${id}.proc.applies`, it.proc.applies]);
  }
  for (const [id, s] of Object.entries(SURFACES)) {
    if (s.onEnter?.applies) statusSites.push([`SURFACES.${id}.onEnter.applies`, s.onEnter.applies]);
  }
  for (const [name, s] of [['ELECTRIFIED', ELECTRIFIED], ['FIRE', FIRE]]) {
    if (s.onEnter?.applies) statusSites.push([`${name}.onEnter.applies`, s.onEnter.applies]);
  }
  for (const [where, statusId] of statusSites) {
    assert.ok(STATUSES[statusId], `${where} = "${statusId}" is a real status`);
  }
  assert.ok(statusSites.length > 0, 'the lint actually found status references to check');

  // Summon archetypes resolve to a class or an enemy type (class-side + enemy-side).
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.type === 'summon') assert.ok(CLASSES[a.archetype] || ENEMY_TYPES[a.archetype], `action "${id}" summons a real archetype`);
  }
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    if (def.summon) assert.ok(CLASSES[def.summon.archetype] || ENEMY_TYPES[def.summon.archetype], `enemy "${id}" summons a real archetype`);
  }
  // Tile loot tables exist, and every table entry names a real item.
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (def.loot) assert.ok(LOOT_TABLES[def.loot], `tile "${id}" loot table "${def.loot}" exists`);
  }
  // A level's map is one CHARACTER per cell and the editor exports canonical
  // registry chars, so a duplicate `char` silently makes one prop unpaintable
  // and corrupts the load -> export round trip. With a large furniture kit
  // this is the easiest mistake to make, so pin it.
  const byChar = new Map();
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    assert.ok(typeof def.char === 'string' && def.char.length === 1, `tile "${id}" has a single-char code`);
    assert.ok(!byChar.has(def.char),
      `tile char "${def.char}" is unique (${id} collides with ${byChar.get(def.char)})`);
    byChar.set(def.char, id);
  }
  // Every referenced model actually ships - a typo here renders an invisible
  // prop that still blocks movement, which is near-impossible to spot in play.
  for (const [id, def] of Object.entries(TILE_TYPES)) {
    if (!def.model) continue;
    assert.ok(existsSync(new URL(`../../assets/${def.model}.glb`, import.meta.url)),
      `tile "${id}" model assets/${def.model}.glb exists`);
    if (def.scale !== undefined) {
      assert.ok(def.scale > 0 && def.scale <= 3, `tile "${id}" scale ${def.scale} is sane`);
    }
  }
  for (const [table, entries] of Object.entries(LOOT_TABLES)) {
    for (const e of entries) assert.ok(ITEMS[e.item], `loot table "${table}" item "${e.item}" exists`);
  }
  // Enemy body-loot lists name real items too.
  for (const [id, def] of Object.entries(ENEMY_TYPES)) {
    for (const e of def.loot || []) assert.ok(ITEMS[e.item], `enemy "${id}" loot item "${e.item}" exists`);
  }
});

for (const f of files) {
  test(`${f} parses and has a player spawn and an exit`, () => {
    const data = load(f);
    const g = parseLevel(data); // throws on unknown tile types
    const playerChar = Object.entries(data.actors).find(([, v]) => v === 'player')?.[0];
    assert.ok(playerChar, 'actors legend names a player');
    assert.ok(data.map.some((row) => row.includes(playerChar)), 'player is on the map');
    let hasExit = false;
    for (let z = 0; z < g.height; z++) {
      for (let x = 0; x < g.width; x++) if (g.typeAt(x, z) === 'exit') hasExit = true;
    }
    assert.ok(hasExit, 'level has an exit');
  });

  test(`${f} every map character is declared in a legend`, () => {
    // parseLevel silently defaults an unknown tile char to 'floor' (grid.js), so
    // a typo'd map char would ship as invisible walkable floor. Guard the map
    // against any char that isn't in the tiles OR actors legend (space = void).
    const data = load(f);
    const declared = new Set([...Object.keys(data.tiles || {}), ...Object.keys(data.actors || {})]);
    for (let z = 0; z < data.map.length; z++) {
      for (const ch of data.map[z]) {
        if (ch === ' ') continue;
        assert.ok(declared.has(ch), `map char "${ch}" (row ${z}) is declared in a legend`);
      }
    }
  });

  test(`${f} the exit is reachable from the player spawn`, () => {
    // A walled-off exit would make the floor uncompletable while passing every
    // other check. Doors are openable, so they count as passable for reach.
    const data = load(f);
    const g = parseLevel(data);
    let exit = null;
    for (let z = 0; z < g.height && !exit; z++) {
      for (let x = 0; x < g.width; x++) if (g.typeAt(x, z) === 'exit') { exit = { x, z }; break; }
    }
    assert.ok(exit, 'level has an exit tile');
    const stepPassable = (x, z, nx, nz) => g.edgeOpen(x, z, nx, nz) || !!g.doorBetween(x, z, nx, nz);
    const route = findPath(g.terrainOpen, g.playerSpawn.x, g.playerSpawn.z, exit.x, exit.z, null, stepPassable);
    assert.ok(route, 'a walk-up route from the spawn to the exit exists (doors count as openable)');
  });

  test(`${f} legend matches the registries' canonical characters`, () => {
    const data = load(f);
    for (const [ch, type] of Object.entries(data.tiles)) {
      assert.ok(TILE_TYPES[type], `tile type "${type}" exists`);
      assert.equal(TILE_TYPES[type].char, ch,
        `char "${ch}" is canonical for "${type}" (the editor round-trips on canonical chars)`);
    }
    for (const [ch, actor] of Object.entries(data.actors)) {
      if (actor === 'player') continue;
      const reg = ENEMY_TYPES[actor] || NPCS[actor] || COMPANIONS[actor]; // enemies, NPCs, or recruits
      assert.ok(reg, `actor type "${actor}" exists`);
      assert.equal(reg.char, ch, `char "${ch}" is canonical for "${actor}"`);
    }
  });

  test(`${f} wall and door runs stay inside the map`, () => {
    const data = load(f);
    const width = Math.max(...data.map.map((r) => r.length));
    const height = data.map.length;
    for (const spec of [...(data.walls || []), ...(data.doors || [])]) {
      const [o, xs, zs, ls] = spec.split(/\s+/);
      const x = Number(xs);
      const z = Number(zs);
      const len = Number(ls ?? 1);
      if (o === 'H') {
        assert.ok(x >= 0 && x + len <= width && z >= 0 && z <= height, `${spec} in bounds`);
      } else {
        assert.ok(x >= 0 && x <= width && z >= 0 && z + len <= height, `${spec} in bounds`);
      }
    }
  });

  test(`${f} "next" points at a real level`, () => {
    const data = load(f);
    if (data.next) {
      assert.ok(files.includes(`${data.next}.json`), `next="${data.next}" ships`);
    }
  });

  // A file on disk is not enough: the exit reads LEVELS (data/levels.js), so a
  // level that ships but was never registered there ends the campaign with the
  // WIN screen instead of loading the next floor.
  test(`${f} is registered in data/levels.js`, () => {
    const id = f.replace(/\.json$/, '');
    assert.ok(LEVELS[id], `levels/${f} is registered as LEVELS["${id}"]`);
  });

  test(`${f} "next" is registered in data/levels.js`, () => {
    const data = load(f);
    if (data.next) {
      assert.ok(LEVELS[data.next],
        `next="${data.next}" is in LEVELS, or the exit silently ends the run`);
    }
  });

  test(`${f} depth, if set, is a positive integer`, () => {
    const data = load(f);
    if ('depth' in data) {
      assert.ok(Number.isInteger(data.depth) && data.depth >= 1, 'depth is a positive integer');
    }
  });
}
