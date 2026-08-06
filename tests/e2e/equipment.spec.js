// Equipment verbs (EQUIPMENT_PLAN M2): equip a weapon from the pockets into
// its slot and stow it back, driven through the real inventory-panel DOM.
import { test, expect } from '@playwright/test';
import { bootAndPick, withWorldStill } from './helpers.js';

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

test('unequip obeys capacity, then succeeds after the bag drains', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  // The Office Drone has 30 slots. Existing over-cap contents stay intact, but
  // stowing another item is an admission and must be refused.
  await page.evaluate(() => {
    const s = window.__god.player;
    s.equipped.weapon = 'red-stapler';
    s.inventory = new Array(40).fill('paper-wad');
  });
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#equip-unequip-weapon');
  await expect(page.locator('#subtitle')).toContainText('Pockets are full');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon)).toBe('red-stapler');
  expect(await page.evaluate(() => window.__game.stats.inventory.length)).toBe(40);

  // Once there is room, the same verb succeeds and fills the last free slot.
  await page.evaluate(() => { window.__god.player.inventory.length = 29; });
  await page.keyboard.press('i');
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#equip-unequip-weapon');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon)).toBe(null);
  expect(await page.evaluate(() => window.__game.stats.inventory.length)).toBe(30);
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

test('the Send button refuses a full recipient, then hands over after space opens', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  await withWorldStill(page, async () => {
    // Alone, there is nobody to hand anything to - so no button at all.
    await page.evaluate(() => { window.__god.player.inventory = ['cold-coffee']; });
    await page.keyboard.press('i');
    await expect(page.locator('#inventory-panel')).toBeVisible();
    await expect(page.locator('#inv-row-0')).toBeVisible();
    expect(await page.locator('#inv-send-0').count()).toBe(0);

    // Recruit the intern and fill his bag past any legitimate cap. A refused
    // hand-off must be atomic: the coffee remains with its sender.
    expect(await page.evaluate(() => window.__god.recruit('it-support'))).toBe(true);
    await page.evaluate(() => {
      const recipient = window.__god.party.members[1].sheet;
      recipient.inventory = new Array(100).fill('paper-wad');
      window.__god.player.inventory = ['cold-coffee'];
      window.__god.refreshHud();
    });
    await page.click('#inv-send-0');
    await page.click('#context-menu >> text=Give to');
    expect(await page.evaluate(() => window.__god.player.inventory)).toEqual(['cold-coffee']);
    expect(await page.evaluate(() => window.__god.party.members[1].sheet.inventory.includes('cold-coffee'))).toBe(false);
    expect(await page.evaluate(() => window.__game.narration.at(-1))).toMatch(/pockets are full/i);

    // Drain the recipient below capacity and retry through the same UI.
    await page.evaluate(() => { window.__god.party.members[1].sheet.inventory = []; });
    await page.click('#inv-send-0');
    await page.click('#context-menu >> text=Give to');
    expect(await page.evaluate(() => window.__god.player.inventory)).toEqual([]);
    expect(await page.evaluate(() => window.__god.party.members[1].sheet.inventory)).toEqual(['cold-coffee']);
  });
});
