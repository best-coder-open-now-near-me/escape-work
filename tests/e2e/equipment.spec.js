// Equipment verbs (EQUIPMENT_PLAN M2): equip a weapon from the pockets into
// its slot, stow it back, and the full-pockets refusal that keeps gear from
// vanishing. Driven through the real inventory-panel DOM.
import { test, expect } from '@playwright/test';
import { bootAndPick } from './helpers.js';

test('equip a weapon from the pockets, then stow it back', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  // Hand the leader a red stapler (a weapon: dmg 2).
  await page.evaluate(() => { window.__god.player.inventory = ['red-stapler']; });
  // Open the pockets - it refreshes from the live sheet, showing the Equip verb.
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await expect(page.locator('#inv-equip-0')).toBeVisible();

  // Equip it: into the weapon slot, out of the bag.
  await page.click('#inv-equip-0');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon)).toBe('red-stapler');
  await expect(page.locator('#equip-slot-weapon')).toContainText('Red Stapler');
  expect(await page.evaluate(() => window.__game.stats.inventory.includes('red-stapler'))).toBe(false);

  // Stow it: back to the bag, the slot goes empty.
  await page.click('#equip-unequip-weapon');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon)).toBe(null);
  expect(await page.evaluate(() => window.__game.stats.inventory.includes('red-stapler'))).toBe(true);
});

test('unequip is refused politely when the pockets are full', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  // A weapon in hand, and a bag stuffed to its cap.
  await page.evaluate(() => {
    const s = window.__god.player;
    s.equipped.weapon = 'red-stapler';
    s.inventory = new Array(10).fill('paper-wad'); // INV_CAP
  });
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#equip-unequip-weapon');
  // Refused - the weapon stays equipped, nothing was lost.
  await expect(page.locator('#subtitle')).toContainText('full');
  expect(await page.evaluate(() => window.__game.stats.equipped.weapon)).toBe('red-stapler');
});

test('a basic weapon attack is always on the bar; the weapon defines it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  // Bare hands: everyone has a basic punch (the gap this closes).
  await expect(page.locator('#hotbar-act-punch')).toBeVisible();
  expect(await page.locator('#hotbar-act-staple-jab').count()).toBe(0);

  // Equip a red stapler: the basic swing becomes the stapler's; punch retires.
  await page.evaluate(() => { window.__god.player.inventory = ['red-stapler']; });
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#inv-equip-0');
  await expect(page.locator('#hotbar-act-staple-jab')).toBeVisible();
  expect(await page.locator('#hotbar-act-punch').count()).toBe(0);

  // Stow it: back to bare hands.
  await page.click('#equip-unequip-weapon');
  await expect(page.locator('#hotbar-act-punch')).toBeVisible();
  expect(await page.locator('#hotbar-act-staple-jab').count()).toBe(0);
});

test('outfits and trinkets fill their own slots and lift derived stats', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  const hp0 = await page.evaluate(() => window.__game.stats.maxHp);
  await page.evaluate(() => { window.__god.player.inventory = ['okayest-mug', 'company-fleece']; });
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();

  // Equip the mug (trinket, +2 maxHp), then the fleece (outfit) - each to its
  // own slot without displacing the other.
  await page.click('#inv-equip-0'); // the mug (index 0)
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.trinket)).toBe('okayest-mug');
  await page.click('#inv-equip-0'); // the fleece is now index 0
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.outfit)).toBe('company-fleece');

  expect(await page.evaluate(() => window.__game.stats.maxHp)).toBe(hp0 + 2); // the mug's +2
  await expect(page.locator('#equip-slot-trinket')).toContainText('Okayest Mug');
  await expect(page.locator('#equip-slot-outfit')).toContainText('Company Fleece');
});

test('the shoes slot equips footwear', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  await page.evaluate(() => { window.__god.player.inventory = ['warehouse-boots']; });
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#inv-equip-0');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.shoes)).toBe('warehouse-boots');
  await expect(page.locator('#equip-slot-shoes')).toContainText('Warehouse Boots');
});
