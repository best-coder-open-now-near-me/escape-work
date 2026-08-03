// The playability rules, tested directly rather than only through the shipped
// levels. These used to be assertions inside levels.test.js, which meant they
// only ran over files already in levels/ - so the one caller who most needed
// them, the editor, could not ask.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintLevel, isPlayable } from '../../src/level-lint.js';

// A minimal playable floor: spawn, exit, a clear walk between them, and enough
// room at the start for the party to stand apart.
const OK = () => ({
  name: 'Test Floor',
  depth: 1,
  tiles: { '.': 'floor', '#': 'wall', '>': 'exit' },
  actors: { '@': 'player' },
  map: [
    '#######',
    '#.....#',
    '#.@..>#',
    '#.....#',
    '#######',
  ],
});

const rules = (data) => lintLevel(data).map((f) => f.rule);
const errors = (data) => lintLevel(data).filter((f) => f.level === 'error').map((f) => f.rule);

test('a playable floor lints clean', () => {
  assert.deepEqual(lintLevel(OK()), []);
  assert.equal(isPlayable(OK()), true);
});

test('a floor with no player start is an error', () => {
  const d = OK();
  d.map = d.map.map((r) => r.replace('@', '.'));
  assert.ok(errors(d).includes('no-spawn'));
  assert.equal(isPlayable(d), false);
});

test('a floor with no exit is an error', () => {
  const d = OK();
  d.map = d.map.map((r) => r.replace('>', '.'));
  assert.ok(errors(d).includes('no-exit'));
});

test('an exit walled off from the spawn is an error, not a warning', () => {
  const d = OK();
  // Seal the exit behind a full-height wall column.
  d.map = [
    '#######',
    '#..#..#',
    '#.@#.>#',
    '#..#..#',
    '#######',
  ];
  assert.ok(errors(d).includes('exit-unreachable'));
  assert.equal(isPlayable(d), false);
});

test('a door counts as passable, so an exit behind one is reachable', () => {
  // A partition, not a wall COLUMN: walls-as-cells cannot hold a door, because
  // a door sits on the EDGE between two walkable cells.
  const sealed = OK();
  sealed.walls = ['V 3 1 3'];
  assert.ok(errors(sealed).includes('exit-unreachable'), 'the partition alone seals the exit off');

  const withDoor = OK();
  withDoor.walls = ['V 3 1 3'];
  withDoor.doors = ['V 3 2'];
  assert.ok(!errors(withDoor).includes('exit-unreachable'),
    'a closed door is an obstacle, not a wall');
});

test('a cramped start warns without making the floor unplayable', () => {
  const d = OK();
  // A one-tile-wide dead end: reachable, finishable, and no room for the party
  // to spread out at the start.
  d.map = [
    '#######',
    '#@#####',
    '#.#####',
    '#....>#',
    '#######',
  ];
  const found = lintLevel(d);
  assert.ok(found.some((f) => f.rule === 'cramped-spawn' && f.level === 'warn'));
  assert.equal(isPlayable(d), true, 'a tight spawn is a smell, not a blocker');
});

test('floor nobody can reach is reported', () => {
  const d = OK();
  d.map = [
    '#########',
    '#.....#.#',
    '#.@..>#.#',
    '#.....#.#',
    '#########',
  ];
  const found = lintLevel(d);
  const orphan = found.find((f) => f.rule === 'orphaned-floor');
  assert.ok(orphan, 'the sealed column is reported');
  assert.match(orphan.message, /3 walkable tiles/);
});

test('a character in no legend is an error, because it loads as blank floor', () => {
  const d = OK();
  d.map[1] = '#..Q..#';
  assert.ok(errors(d).includes('undeclared-char'));
});

test('a character that is both a tile and an actor is an error', () => {
  const d = OK();
  d.tiles.M = 'wall';
  d.actors.M = 'manager';
  assert.ok(errors(d).includes('legend-collision'));
});

test('an unknown tile type surfaces the parser message rather than crashing', () => {
  const d = OK();
  d.tiles['%'] = 'server-rack';
  d.map[1] = '#..%..#';
  const found = lintLevel(d);
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'parse');
  assert.match(found[0].message, /server-rack/);
});

test('a door with a solid side is flagged', () => {
  const d = OK();
  d.doors = ['H 1 1']; // between the wall row and open floor
  d.map = [
    '#######',
    '#.....#',
    '#.@..>#',
    '#.....#',
    '#######',
  ];
  assert.ok(rules(d).includes('dead-door'));
});

test('every shipped level is playable by these rules', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const files = readdirSync('levels').filter((f) => f.endsWith('.json'));
  assert.ok(files.length, 'there are levels to check');
  for (const f of files) {
    const data = JSON.parse(readFileSync(`levels/${f}`, 'utf8'));
    assert.deepEqual(lintLevel(data), [], `${f} lints clean`);
  }
});
