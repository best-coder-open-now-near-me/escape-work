// What a floor's placement implies. Each of these was derivable from the level
// all along and visible nowhere, so the editor's author found out by walking it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLevel } from '../../src/grid.js';
import {
  reachable, orphans, coverMap, engagementClusters, surpriseBand,
  wanderFootprint, noticeRange, fireSpread, floorBudget,
} from '../../src/level-preview.js';

const g = (data) => parseLevel(data);
const BASE = {
  name: 'T', depth: 1,
  tiles: { '.': 'floor', '#': 'wall', '>': 'exit' },
  actors: { '@': 'player', M: 'manager' },
};

test('orphaned floor is the walkable ground the player can never stand on', () => {
  const lv = g({
    ...BASE,
    map: [
      '#########',
      '#...#...#',
      '#.@.#..>#',
      '#...#...#',
      '#########',
    ],
  });
  // The exit half is sealed off by a wall COLUMN, so it is unreachable ground.
  assert.equal(orphans(lv).size, 9);
  assert.equal(reachable(lv).size, 9);
});

test('a door makes the far room reachable and unorphans it', () => {
  const map = [
    '#######',
    '#.....#',
    '#.@..>#',
    '#.....#',
    '#######',
  ];
  const sealed = g({ ...BASE, map, walls: ['V 3 1 3'] });
  assert.ok(orphans(sealed).size > 0, 'a partition alone strands the far side');
  const open = g({ ...BASE, map, walls: ['V 3 1 3'], doors: ['V 3 2'] });
  assert.equal(orphans(open).size, 0, 'a door in it is a route');
});

test('cover counts shielded faces, so a corner beats open ground', () => {
  const lv = g({
    ...BASE,
    map: [
      '#####',
      '#.@.#',
      '#...#',
      '#..>#',
      '#####',
    ],
  });
  const cover = coverMap(lv);
  // The cell against the top wall has one shielded face; the middle has none.
  assert.equal(cover.get('2,1'), 1);
  assert.equal(cover.get('2,2'), undefined, 'open ground offers nothing');
  // A corner is shielded on two sides.
  assert.equal(cover.get('1,1'), 2);
});

test('enemies that can see each other are one fight', () => {
  const together = g({
    ...BASE,
    map: [
      '#########',
      '#.M...M.#',
      '#.@....>#',
      '#########',
    ],
  });
  assert.deepEqual(engagementClusters(together).map((c) => c.length), [2],
    'a clear sightline joins them');

  const split = g({
    ...BASE,
    map: [
      '#########',
      '#.M.#.M.#',
      '#.@.#..>#',
      '#########',
    ],
  });
  assert.deepEqual(engagementClusters(split).map((c) => c.length), [1, 1],
    'a wall between them is two separate fights');
});

test('the surprise band and the wander leash are radii around each placement', () => {
  const lv = g({
    ...BASE,
    map: [
      '#########',
      '#.......#',
      '#.@.M..>#',
      '#.......#',
      '#########',
    ],
  });
  // Radius 2, clipped to walkable ground: 3 rows x 5 columns around (4,2).
  const band = surpriseBand(lv);
  assert.ok(band.has('4,2') && band.has('2,1') && band.has('6,3'));
  assert.ok(!band.has('7,2'), 'three tiles away is outside it');
  assert.deepEqual([...wanderFootprint(lv)].sort(), [...band].sort(),
    'both are radius 2 today - if one moves, this test says so');
});

test('notice range respects sight, not just distance', () => {
  const open = g({
    ...BASE,
    map: [
      '##########',
      '#.@.....M#',
      '#.......>#',
      '##########',
    ],
  });
  assert.ok(noticeRange(open).has('2,1'), 'a clear corridor is watched');

  const blocked = g({
    ...BASE,
    tiles: { ...BASE.tiles, S: 'snack-machine' },
    map: [
      '##########',
      '#.@..S..M#',
      '#.......>#',
      '##########',
    ],
  });
  assert.ok(!noticeRange(blocked).has('2,1'),
    'a snack machine between them is not something you can see past');
});

test('fire walks flammable surfaces and names the printers it takes with it', () => {
  const lv = g({
    ...BASE,
    tiles: { ...BASE.tiles, p: 'paper', R: 'printer' },
    map: [
      '#########',
      '#.@ppppR#',
      '#......>#',
      '#########',
    ],
  });
  const { burns, blasts } = fireSpread(lv, { x: 3, z: 1 });
  assert.ok(burns.size >= 4, 'the drift carries the fire along itself');
  assert.ok(blasts.has('7,1'), 'and reaches the printer at the end of it');

  // A gap in the paper stops it.
  const gapped = g({
    ...BASE,
    tiles: { ...BASE.tiles, p: 'paper', R: 'printer' },
    map: [
      '#########',
      '#.@pp.pR#',
      '#......>#',
      '#########',
    ],
  });
  assert.ok(!fireSpread(gapped, { x: 3, z: 1 }).blasts.has('7,1'),
    'one clear tile is a firebreak');
});

test('the floor budget totals what a balance pass asks about', () => {
  const b = floorBudget({
    ...BASE,
    tiles: { ...BASE.tiles, D: 'desk' },
    map: [
      '#########',
      '#.@DD..M#',
      '#......>#',
      '#########',
    ],
  });
  assert.equal(b.enemies, 1);
  assert.ok(b.xp > 0, 'a placed coworker is worth XP');
  assert.equal(b.containers, 2, 'both desks are rummageable');
  assert.ok(b.healHp > 0 && b.cash > 0, 'and they hold something');
});

test('every shipped floor can produce a revive', () => {
  // With the automatic revives struck (TODO.md, 2026-08-02) a floor whose props
  // cannot drop a first-aid kit has no way to stand a downed member back up.
  // The budget readout is what caught this; the assertion is what keeps it.
  for (const f of ['level1', 'level2']) {
    const data = JSON.parse(readFileSync(`levels/${f}.json`, 'utf8'));
    assert.ok(floorBudget(data).revives > 0,
      `${f} holds at least one expected revive - otherwise a downed member is unrecoverable there`);
  }
});
