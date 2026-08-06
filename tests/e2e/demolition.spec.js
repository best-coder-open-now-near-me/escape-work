// Destructible cover + Pull Over (TACTICS_PLAN M8). Barriers break down under
// attack - melee and ranged both - and at zero they are REMOVED: "gone means
// gone" (designer, 2026-07-30), because the shove relocates cover and the
// pull leaves it standing, so destruction is the one verb that deletes it.
// The pull hauls a crouched target over their own cover to your side.
import { test, expect } from '@playwright/test';
import {
  bootStash, waitForPlayerTurn, refillAp, clickAction, onScreen,
  clickEnemyBody,
} from './helpers.js';

// The Manager's cell is SEALED on all four faces (partitions block movement,
// not sight), so the fight opens with a throw over the top and the specs
// never depend on AI pathing - the topple/partition specs' own trick.
const DEMOLITION_ROW = {
  name: 'Demolition Row',
  tiles: { '#': 'wall', '.': 'floor', B: 'cabinet' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 3 2 1', 'V 4 2 1', 'H 3 2 1', 'H 3 3 1'],
  map: [
    '######',
    '#@B..#',
    '#..M.#',
    '######',
  ],
};

// Open the fight with a paper ball on the sealed Manager - deterministic,
// and the player never has to leave their tile.
async function openWithThrow(page) {
  await page.evaluate(() => { window.__god.player.paper = 40; });
  await page.click('#hotbar-act-paper-ball');
  await expect.poll(() => page.evaluate(() => window.__game.armed), { timeout: 10_000 })
    .toBe('paper-ball');
  await clickEnemyBody(page);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 30_000 })
    .toBe(true);
  await waitForPlayerTurn(page);
  await refillAp(page);
}

// Arm the throw and put one into the world position (wx, wz) - a prop's tile
// or a partition's far tile - until the poll below sees the world change.
async function throwAt(page, wx, wz) {
  await refillAp(page);
  await page.evaluate(() => { window.__god.player.paper = 40; });
  await clickAction(page, 'paper-ball');
  const p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.4, z), [wx, wz]);
  expect(onScreen(p)).toBe(true);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(250);
}

test('a barrier breaks down under thrown fire, and gone means gone', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DEMOLITION_ROW);
  await openWithThrow(page);

  const full = await page.evaluate(() => window.__game.propHpAt(2, 1));
  expect(full, 'the cabinet carries a pool').toBeGreaterThan(0);

  // Chip it down. Every landed throw dents the pool - the tile keeps its
  // type until the pool empties, which is what propHpAt exists to see.
  let guard = 24;
  while (guard-- > 0
    && await page.evaluate(() => window.__game.tileAt(2, 1)) === 'cabinet') {
    await throwAt(page, 2, 1);
  }
  // The dent was real along the way (the last read before destruction may
  // be the destruction itself, so assert the end state, not the curve)...
  await expect.poll(() => page.evaluate(() => window.__game.tileAt(2, 1)), { timeout: 20_000 })
    .toBe('floor');
  // ...and destruction is REMOVAL: open floor, walkable, no debris, no pool.
  expect(await page.evaluate(() => window.__game.walkable(2, 1))).toBe(true);
  expect(await page.evaluate(() => window.__game.propHpAt(2, 1))).toBe(null);
});

// Player and Manager separated by one partition edge; the Manager sealed in.
const PARTITION_PULL = {
  name: 'Partition Pull',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 2 1 1', 'V 3 1 1', 'H 2 2 1'],
  map: [
    '######',
    '#@M..#',
    '#....#',
    '######',
  ],
};

// A partition east of the player with EMPTY floor behind it - the throw aims
// at bare ground, so no body can steal the click - and the Manager sealed in
// a far cell to open the fight over.
const PARTITION_BREAK = {
  name: 'Partition Break',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 2 1 1', 'V 3 2 1', 'V 4 2 1', 'H 3 2 1', 'H 3 3 1'],
  map: [
    '######',
    '#@...#',
    '#..M.#',
    '######',
  ],
};

test('a partition breaks down too - edge, plank and all', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, PARTITION_BREAK);
  await openWithThrow(page);

  expect(await page.evaluate(() => window.__game.edgeHpAt(1, 1, 2, 1)),
    'the partition carries a pool').toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__game.stepOpenAt(1, 1, 2, 1))).toBe(false);

  // A thrown attack aimed at the far tile takes the panel on the tile's face
  // toward the shooter (breakPlanAt) - the partition never blocks the line,
  // only the step.
  let guard = 24;
  while (guard-- > 0
    && await page.evaluate(() => window.__game.edgeHpAt(1, 1, 2, 1)) !== null) {
    await throwAt(page, 2, 1);
  }
  // The EDGE left the world - and left NOTHING: no fallen plank ("gone means
  // gone"), the tile under it untouched.
  await expect.poll(() => page.evaluate(() => window.__game.stepOpenAt(1, 1, 2, 1)),
    { timeout: 20_000 }).toBe(true);
  expect(await page.evaluate(() => window.__game.tileAt(2, 1))).toBe('floor');
});

test('Pull Over hauls a crouched coworker over their cover, which stays up', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, PARTITION_PULL);
  await openWithThrow(page);

  // Crouch the Manager against their own partitions (edge mode) through the
  // real crouchAt path, and pin the Grit save to a fail so the landing is
  // deterministic (forceHit true = the haul fully lands).
  await page.evaluate(() => {
    window.__combat.crouch('The Manager');
    window.__combat.forceHit = true;
  });
  expect(await page.evaluate(() => window.__combat.crouched.length)).toBe(1);
  const before = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect([before.x, before.z]).toEqual([2, 1]);

  await clickAction(page, 'pull');
  // Aim LOW: a crouched body is a squashed pose, so the honest click is the
  // tile - which the pull resolves on whoever holds it (handleTileClick).
  await clickEnemyBody(page, 0.3);

  // They came over: off their tile, onto a free tile beside the puller...
  await expect.poll(() => page.evaluate(() => {
    const en = window.__combat.enemies.find((e) => e.alive);
    return en ? `${en.x},${en.z}` : 'dead';
  }), { timeout: 20_000 }).toBe('1,2');
  const after = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  // ...wearing the failed save: the crush, the daze, the pin.
  expect(after.hp).toBeLessThan(before.hp);
  expect(after.statuses.some((s) => s.id === 'stunned')).toBe(true);
  expect(after.statuses.some((s) => s.id === 'pinned')).toBe(true);
  // The barrier STAYED STANDING - the whole point of the verb...
  expect(await page.evaluate(() => window.__game.stepOpenAt(1, 1, 2, 1))).toBe(false);
  // ...and the crouch died in the haul.
  expect(await page.evaluate(() => window.__combat.crouched.length)).toBe(0);
});
