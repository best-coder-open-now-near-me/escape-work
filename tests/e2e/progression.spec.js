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

test('class points learn track nodes (attr bonus, then a prereq-gated action)', async ({ page }) => {
  test.setTimeout(120_000);
  await bootStash(page, SOLO_LEVEL); // office-drone track

  await page.evaluate(() => { window.__god.player.classPoints = 3; });
  await page.click('#levelup-pip'); // the pip lights for class points too
  await expect(page.locator('#levelup-screen')).toBeVisible();

  // Thick Skin: +1 Grit, baked onto the sheet.
  const grit0 = await page.evaluate(() => window.__god.player.attr.grit);
  await page.click('#lvlup-node-drone-thick-skin');
  await expect.poll(() => page.evaluate(() => window.__god.player.attr.grit)).toBe(grit0 + 1);
  expect(await page.evaluate(() => window.__god.player.perks.includes('drone-thick-skin'))).toBe(true);

  // The gated node is Paper Storm, behind Sharp Folds (POWERS_PLAN M3). It
  // used to be Self-Defense Seminar granting `kick` - which the Mail Room and
  // Security also granted, so three classes unlocked one action and levelling
  // up converged the roster.
  //
  // Clicking it with its prereq unmet must do NOTHING: that is the half of
  // "prereq-gated" the old spec never actually exercised, because it only ever
  // clicked the node after the prereq was already paid for.
  expect(await page.evaluate(() => window.__god.player.actions.includes('paper-storm'))).toBe(false);
  await page.click('#lvlup-node-drone-paper-storm');
  expect(await page.evaluate(() => window.__god.player.actions.includes('paper-storm'))).toBe(false);
  expect(await page.evaluate(() => window.__god.player.classPoints)).toBe(2); // refused, nothing spent

  // Pay the prereq, and now it takes.
  await page.click('#lvlup-node-drone-sharp-folds');
  await expect.poll(() => page.evaluate(() => window.__god.player.perks.includes('drone-sharp-folds'))).toBe(true);
  await page.click('#lvlup-node-drone-paper-storm');
  await expect.poll(() => page.evaluate(() => window.__god.player.actions.includes('paper-storm'))).toBe(true);
  expect(await page.evaluate(() => window.__god.player.classPoints)).toBe(0);

  await page.click('#lvlup-done');
  await expect(page.locator('#levelup-screen')).toHaveCount(0);
});

test('a floor deeper than an enemy tier scales that enemy up', async ({ page }) => {
  test.setTimeout(120_000);
  // The Manager is native level 1; on a depth-3 floor he spawns at level 3 with
  // more than his base 14 HP (stats.scaleEnemy / effectiveLevel).
  const DEEP_LEVEL = {
    name: 'Deep Floor',
    depth: 3,
    tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
    actors: { '@': 'player', M: 'manager' },
    map: [
      '########',
      '#@...M>#',
      '########',
    ],
  };
  await bootStash(page, DEEP_LEVEL);
  const foe = await page.evaluate(() =>
    window.__game.enemies.find((e) => e.name === 'The Manager'));
  expect(foe.level).toBe(3);
  expect(foe.maxHp).toBeGreaterThan(14); // base Manager is 14 HP at level 1
});

test('the character sheet toggles with C and shows attributes', async ({ page }) => {
  test.setTimeout(120_000);
  await bootStash(page, SOLO_LEVEL); // office-drone (Grit 5)
  await expect(page.locator('#character-sheet')).toBeHidden();
  await page.keyboard.press('c');
  await expect(page.locator('#character-sheet')).toBeVisible();
  await expect(page.locator('#charsheet-attr-grit')).toHaveText('5');
  await page.keyboard.press('c');
  await expect(page.locator('#character-sheet')).toBeHidden();
});
