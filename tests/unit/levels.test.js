// Shipped-level validation: every level in levels/ must parse, agree with the
// registries, and use the registries' canonical characters (the editor
// round-trips on those). Catches a bad hand edit before it ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseLevel } from '../../src/grid.js';
import { TILE_TYPES } from '../../src/data/tiles.js';
import { ENEMY_TYPES } from '../../src/data/enemies.js';
import { NPCS } from '../../src/data/npcs.js';
import { COMPANIONS } from '../../src/data/companions.js';

const files = readdirSync('levels').filter((f) => f.endsWith('.json'));
const load = (f) => JSON.parse(readFileSync(`levels/${f}`, 'utf8'));

test('there are shipped levels', () => {
  assert.ok(files.length >= 1);
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
}
