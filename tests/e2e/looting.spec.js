// Looting: rummage a container behind its door, one-shot loot state, the
// pockets panel, dropping to the floor, Alt-label pickup, consumables - and
// a full fight so a body can be looted.
import { test, expect } from '@playwright/test';
import { bootAndPick, clickWorld, enterCombat } from './helpers.js';

test('desk rummage, drop, Alt pickup, and consumable use', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page);

  // The desk at (8,2) sits in a doored cubicle - open the door on the way.
  expect(await clickWorld(page, 8, 4.58)).toBe(true);
  await expect.poll(
    () => page.evaluate(() => window.__game.doors.find((d) => d.key === 'h:8,5')?.open),
    { timeout: 60_000 },
  ).toBe(true);

  // Rummage the desk: cold coffee is a guaranteed roll.
  expect(await clickWorld(page, 8, 2)).toBe(true);
  await expect.poll(
    () => page.evaluate(() => window.__game.inventory.includes('cold-coffee')),
    { timeout: 60_000 },
  ).toBe(true);
  expect(await page.evaluate(() => window.__game.containerLootAt(8, 2))).toEqual([]);

  // What the desk gave up is filed in the narrator box, not only in the toast
  // that clears itself after a couple of seconds.
  expect(await page.evaluate(() => window.__game.narration.some((l) => /^Desk: .*Coffee/.test(l)))).toBe(true);
  await expect(page.locator('#narration-box')).toContainText('Desk:');

  // Re-rummaging an emptied desk yields nothing new - and says so in the box.
  const count = await page.evaluate(() => window.__game.inventory.length);
  await clickWorld(page, 8, 2);
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__game.inventory.length)).toBe(count);
  await expect.poll(
    () => page.evaluate(() => window.__game.narration.some((l) => /nothing left but disappointment/.test(l))),
  ).toBe(true);

  // Drop the first item: it becomes a loose parcel on the floor.
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#inv-drop-0');
  await expect.poll(() => page.evaluate(() => window.__game.looseItems.length)).toBe(1);

  // Alt shows a clickable label over it; clicking walks over and picks it up.
  // Chips are repositioned every frame (fails the stability gate) and can
  // overlap each other at far zoom (a coordinate click hits the top one) -
  // dispatch the click on the element itself.
  await page.waitForTimeout(1000);
  await page.keyboard.down('Alt');
  const chip = page.locator('.loot-label', { hasText: 'Coffee' }).first();
  await expect(chip).toBeVisible();
  await chip.evaluate((el) => el.click());
  await page.keyboard.up('Alt');
  await expect.poll(
    () => page.evaluate(() => window.__game.looseItems.length),
    { timeout: 60_000 },
  ).toBe(0);
  expect(await page.evaluate(() => window.__game.inventory.length)).toBe(count);

  // Healing consumables refuse to burn at full HP - ration the snacks. (The
  // player is unhurt here, so the coffee must survive the attempt.)
  const idx = await page.evaluate(() => window.__game.inventory.indexOf('cold-coffee'));
  await page.keyboard.press('i'); // refresh the panel's row ids
  await page.keyboard.press('i');
  await page.click(`#inv-use-${idx}`);
  await expect(page.locator('#subtitle')).toContainText('full health');
  expect(await page.evaluate(() => window.__game.inventory.length)).toBe(count);
});

test('a fallen coworker leaves a lootable body', async ({ page }) => {
  test.setTimeout(420_000);
  await bootAndPick(page);
  await enterCombat(page);

  // End the fight deterministically: fell the engaged coworkers. die() rolls
  // their loot and leaves a lootable body, and combat sees the wipe and ends.
  // (This test's subject is looting a fallen coworker's body - that a swing
  // lands is game.spec's job. The old projected-attack grind was fragile
  // under a camera that keeps moving as the initiative order advances.)
  await page.evaluate(() => window.__god.enemies.forEach((e) => e.alive && e.die()));
  await expect.poll(() => page.evaluate(() => !window.__game.inCombat), { timeout: 30_000 }).toBe(true);
  expect(await page.evaluate(() => window.__game.gameOver)).toBe(false);

  // The corpse persists; Alt labels it; clicking it loots the guaranteed drop.
  const pt = await page.evaluate(() => window.__game.playerTile);
  const body = await page.evaluate((p) => window.__game.enemies
    .filter((e) => !e.alive)
    .sort((a, b) => Math.max(Math.abs(a.x - p.x), Math.abs(a.z - p.z))
      - Math.max(Math.abs(b.x - p.x), Math.abs(b.z - p.z)))[0], pt);
  expect(body).toBeTruthy();
  await page.keyboard.down('Alt');
  await expect(page.locator('.loot-label', { hasText: 'body' }).first()).toBeVisible();
  await page.keyboard.up('Alt');
  const expected = body.name.startsWith('HR') ? 'hr-pamphlet' : 'performance-review';
  expect(await clickWorld(page, body.x, body.z)).toBe(true);
  await expect.poll(
    () => page.evaluate((it) => window.__game.inventory.includes(it), expected),
    { timeout: 60_000 },
  ).toBe(true);
});
