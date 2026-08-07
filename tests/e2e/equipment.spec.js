// Equipment verbs (EQUIPMENT_PLAN M2): equip a weapon from the pockets into
// its slot and stow it back, driven through the real inventory-panel DOM.
import { test, expect } from '@playwright/test';
import {
  bootAndPick, bootStash, enterCombat, refillAp, withWorldStill,
} from './helpers.js';

const EQUIP_ARENA = {
  name: 'Equipment Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#####',
    '#.@M#',
    '#####',
  ],
};

test('the expanded equipment layout keeps Flair and adds both hands, hat, and pants', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();

  await expect(page.locator('#equip-slot-weapon')).toContainText('Main Weapon');
  await expect(page.locator('#equip-slot-weapon2')).toContainText('Second Weapon');
  await expect(page.locator('#equip-slot-jewelryLeft')).toContainText('Left-Hand Jewelry');
  await expect(page.locator('#equip-slot-jewelryRight')).toContainText('Right-Hand Jewelry');
  await expect(page.locator('#equip-slot-hat')).toContainText('Hat');
  await expect(page.locator('#equip-slot-pants')).toContainText('Pants');
  await expect(page.locator('#equip-slot-trinket')).toContainText('Flair');
  await expect(page.locator('#equip-slot-trinket')).toContainText('Stress Ball');
});

test('successive weapons fill both positions and the main weapon owns the basic attack', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'office-drone');
  await page.evaluate(() => { window.__god.player.inventory = ['red-stapler', 'letter-opener']; });
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();

  await page.click('#inv-equip-0');
  await page.click('#inv-equip-0');
  await expect.poll(() => page.evaluate(() => ({
    main: window.__game.stats.equipped.weapon,
    second: window.__game.stats.equipped.weapon2,
  }))).toEqual({ main: 'red-stapler', second: 'letter-opener' });
  await expect(page.locator('#hotbar-act-staple-jab')).toBeVisible();
  expect(await page.locator('#hotbar-act-letter-opener-stab').count()).toBe(0);

  // Emptying Main Weapon promotes the second position as the basic verb without
  // moving either item between positions.
  await page.click('#equip-unequip-weapon');
  await expect(page.locator('#hotbar-act-letter-opener-stab')).toBeVisible();
  expect(await page.locator('#hotbar-act-staple-jab').count()).toBe(0);
});

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

test('equipping and stowing gear in combat costs 2 AP and refreshes the live kit', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, EQUIP_ARENA, 'office-drone');
  await page.evaluate(() => { window.__god.player.inventory = ['red-stapler']; });
  await enterCombat(page);
  await refillAp(page);

  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  const weaponAp = await page.evaluate(() => window.__combat.ap);
  await page.click('#inv-equip-0');

  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon)).toBe('red-stapler');
  await expect.poll(() => page.evaluate(() => window.__combat.ap)).toBe(weaponAp - 2);
  await expect(page.locator('#hotbar-act-staple-jab')).toBeVisible();
  expect(await page.locator('#hotbar-act-punch').count()).toBe(0);

  // A refused swap is atomic: no item moves and no AP is charged.
  await page.evaluate(() => {
    window.__god.player.inventory = ['stapler'];
    window.__combat.ap = 1;
  });
  await page.keyboard.press('i');
  await page.keyboard.press('i');
  await page.click('#inv-equip-0');
  await expect(page.locator('#subtitle')).toContainText('Not enough AP');
  expect(await page.evaluate(() => ({
    weapon: window.__game.stats.equipped.weapon,
    inventory: window.__game.stats.inventory,
    ap: window.__combat.ap,
  }))).toEqual({ weapon: 'red-stapler', inventory: ['stapler'], ap: 1 });

  // The rule covers every gear slot, and stowing pays the same price.
  await page.evaluate(() => {
    window.__god.player.inventory = ['company-fleece'];
    window.__combat.ap = window.__combat.maxAp;
  });
  await page.keyboard.press('i');
  await page.keyboard.press('i');
  const outfitAp = await page.evaluate(() => window.__combat.ap);
  await page.click('#inv-equip-0');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.outfit)).toBe('company-fleece');
  await expect.poll(() => page.evaluate(() => window.__combat.ap)).toBe(outfitAp - 2);

  const stowAp = await page.evaluate(() => window.__combat.ap);
  await page.click('#equip-unequip-outfit');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.outfit)).toBe(null);
  await expect.poll(() => page.evaluate(() => window.__combat.ap)).toBe(stowAp - 2);
  expect(await page.evaluate(() => window.__game.stats.inventory)).toEqual(['company-fleece']);
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
