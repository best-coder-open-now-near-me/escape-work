// God-mode panel smoke tests. The panel is pure DOM over the live game state
// (window.__god), so unlike the movement/combat suites these don't lean on the
// renderer - only boot needs warm frames. They prove the panel toggles, edits
// runtime state in place, isolates its own input from the game, pauses time,
// and spawns/gives from the catalogue.
import { test, expect } from '@playwright/test';
import { bootAndPick } from './helpers.js';

test('backquote toggles the panel and it edits player hp live', async ({ page }) => {
  await bootAndPick(page);

  await expect(page.locator('#god-panel')).toBeHidden();
  await page.keyboard.press('Backquote');
  await expect(page.locator('#god-panel')).toBeVisible();

  // The Player tab reflects the live sheet; office-drone boots at 22 HP.
  const hp = page.locator('#god-f-sheet-hp');
  await expect(hp).toHaveValue('22');
  await hp.fill('5');
  await hp.press('Enter'); // commit on blur
  expect(await page.evaluate(() => window.__game.stats.hp)).toBe(5);
  await expect(page.locator('#stats')).toContainText('HP 5/22');

  await page.keyboard.press('Backquote');
  await expect(page.locator('#god-panel')).toBeHidden();
});

test('typing in the search box does not leak to the game', async ({ page }) => {
  await bootAndPick(page);
  await page.keyboard.press('Backquote');
  // 'i' normally opens the pockets (a window keydown handler). Pressed inside
  // the panel's search box it must be swallowed, not toggle the inventory.
  await page.locator('#god-search').press('i');
  await expect(page.locator('#inventory-panel')).toBeHidden();
});

test('the world tab pauses and resumes time', async ({ page }) => {
  await bootAndPick(page);
  await page.keyboard.press('Backquote');
  await page.click('#god-tab-world');

  await page.click('#god-timescale-0');
  expect(await page.evaluate(() => window.__god.timeScale)).toBe(0);
  await page.click('#god-timescale-1');
  expect(await page.evaluate(() => window.__god.timeScale)).toBe(1);
});

test('the spawn tab spawns an enemy and gives an item', async ({ page }) => {
  await bootAndPick(page);
  await page.keyboard.press('Backquote');
  await page.click('#god-tab-spawn');

  const before = await page.evaluate(() => window.__god.enemies.length);
  await page.locator('#god-panel button', { hasText: 'At player' }).click();
  expect(await page.evaluate(() => window.__god.enemies.length)).toBe(before + 1);

  const invBefore = await page.evaluate(() => window.__game.inventory.length);
  await page.locator('#god-panel button', { hasText: /^Give$/ }).click();
  expect(await page.evaluate(() => window.__game.inventory.length)).toBe(invBefore + 1);
});
