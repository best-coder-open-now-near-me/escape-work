// The movement economy (MOVEMENT_PLAN M1): movement and actions share one AP
// pool, and the rate is what decides whether repositioning is affordable. This
// pins the rate end-to-end - the constant alone proves nothing, since the cost
// is a product of base x surface x status and any factor could regress it.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, clickWorld } from './helpers.js';

// A wide clean room: no surfaces and no hazards, so distance is the only thing
// being charged for. The pair start ADJACENT and central, which matters twice:
// enterCombat engages without walking the player somewhere unpredictable, and
// there is open floor on every side to walk into. (A corridor does not work -
// the Manager stands in the only lane, and a body blocks movement.)
const ROOM = {
  name: 'Move Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '##################',
    '#................#',
    '#................#',
    '#........@M......#',
    '#................#',
    '#................#',
    '##################',
  ],
};

test('a tile of clean floor costs half an AP', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ROOM, 'office-drone');
  await enterCombat(page);
  // Nothing armed, so a ground click walks.
  if (await page.evaluate(() => window.__combat.armed)) {
    const here = await page.evaluate(() => window.__game.project(window.__game.playerTile.x, window.__game.playerTile.z));
    await page.mouse.click(here.x, here.y, { button: 'right' });
  }
  const before = await page.evaluate(() => ({
    ap: window.__combat.ap, tile: window.__game.playerTile,
  }));
  // Four tiles directly away from the Manager - open floor, and a straight
  // line, so the distance charged is the distance intended.
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  const away = Math.sign(before.tile.x - foe.x) || -1;
  const target = { x: before.tile.x + 4 * away, z: before.tile.z };
  expect(await clickWorld(page, target.x, target.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile),
    { timeout: 30_000 }).toEqual(target);

  const spent = before.ap - (await page.evaluate(() => window.__combat.ap));
  // Four tiles at half an AP each. Generous tolerance: movement is priced by
  // continuous DISTANCE, and the walk ends at the clicked point rather than
  // the tile centre, so the last fraction of a tile varies.
  expect(spent).toBeGreaterThan(1.5);
  expect(spent).toBeLessThan(2.6);
});

test('repositioning behind a foe still leaves AP to attack with', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, ROOM, 'office-drone');
  await enterCombat(page);
  // The trade this milestone exists to create: at the old rate a walk around a
  // body cost a whole attack, so backstab was never worth taking. Walk past
  // the Manager to its far side and the attack must still be affordable.
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  if (await page.evaluate(() => window.__combat.armed)) {
    const here = await page.evaluate(() => window.__game.project(window.__game.playerTile.x, window.__game.playerTile.z));
    await page.mouse.click(here.x, here.y, { button: 'right' });
  }
  expect(await clickWorld(page, foe.x + 1, foe.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile),
    { timeout: 30_000 }).toEqual({ x: foe.x + 1, z: foe.z });
  // Still enough for the 3 AP swing, and the button says so.
  expect(await page.evaluate(() => window.__combat.ap)).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#act-attack')).toBeEnabled();
});
