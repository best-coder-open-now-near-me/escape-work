// Progression: banked attribute points spend on the level-up screen and the
// derived stats follow. Driven directly (no combat) for determinism - a
// promotion banks points the same way gainXp does here.
import { test, expect } from '@playwright/test';
import { bootStash } from './helpers.js';

const SOLO_LEVEL = {
  name: 'Progression Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player' },
  map: [
    '#######',
    '#.@..>#',
    '#######',
  ],
};

test('banked attribute points spend on the level-up screen and raise derived stats', async ({ page }) => {
  test.setTimeout(120_000);
  await bootStash(page, SOLO_LEVEL);

  // Bank two points on the live leader sheet (a level-up banks them the same).
  await page.evaluate(() => { window.__god.player.attrPoints = 2; });

  // The HUD pip lights up once points are pending; clicking it opens the screen.
  await page.click('#levelup-pip');
  await expect(page.locator('#levelup-screen')).toBeVisible();

  // Spend one into Grit: max HP rises by the derivation, the pool drops by one.
  const hp0 = await page.evaluate(() => window.__god.player.maxHp);
  await page.click('#lvlup-attr-grit');
  await expect.poll(() => page.evaluate(() => window.__god.player.maxHp)).toBeGreaterThan(hp0);
  expect(await page.evaluate(() => window.__god.player.attrPoints)).toBe(1);

  // Spend the last point, then close - the screen dismisses and the pip clears.
  await page.click('#lvlup-attr-savvy');
  expect(await page.evaluate(() => window.__god.player.attrPoints)).toBe(0);
  await page.click('#lvlup-done');
  await expect(page.locator('#levelup-screen')).toHaveCount(0);
  await expect(page.locator('#levelup-pip')).toBeHidden();
});
