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
  // The MIDDLE MANAGER's track, not the Drone's. This spec used to ride the
  // Drone because its track gated Paper Storm behind Sharp Folds - and
  // TALENT_PLAN M1 dismantled exactly that: Sharp Folds was cut (as a
  // standalone talent it was Origami Specialist with a smaller number), and
  // POWERS_PLAN M9 moved Paper Storm into the Drone's base kit. So the shape
  // this spec exists to pin - pay a node, unlock the one behind it - no
  // longer exists on that track at all, and the assertions below were
  // testing a track that had been deliberately flattened.
  //
  // The Manager keeps the shape: Stonewall is a plain attribute node,
  // All-Hands sits behind it and grants an action. Same two halves, on a
  // track whose gate is real.
  await bootStash(page, SOLO_LEVEL, 'middle-manager');

  await page.evaluate(() => { window.__god.player.classPoints = 3; });
  await page.click('#levelup-pip'); // the pip lights for class points too
  await expect(page.locator('#levelup-screen')).toBeVisible();

  // Stonewall: +1 Composure, baked onto the sheet.
  const comp0 = await page.evaluate(() => window.__god.player.attr.composure);
  await page.click('#lvlup-node-mgr-stonewall');
  await expect.poll(() => page.evaluate(() => window.__god.player.attr.composure)).toBe(comp0 + 1);
  expect(await page.evaluate(() => window.__god.player.perks.includes('mgr-stonewall'))).toBe(true);

  // Reorg Survivor is ungated, so paying it proves the LOCK below is about
  // the prereq and not simply about having points left to spend.
  await page.click('#lvlup-node-mgr-reorg');
  await expect.poll(() => page.evaluate(() => window.__god.player.perks.includes('mgr-reorg'))).toBe(true);
});

test('a prereq-gated node stays Locked until its prereq is paid', async ({ page }) => {
  test.setTimeout(120_000);
  await bootStash(page, SOLO_LEVEL, 'middle-manager');
  await page.evaluate(() => { window.__god.player.classPoints = 3; });
  await page.click('#levelup-pip');
  await expect(page.locator('#levelup-screen')).toBeVisible();

  // With its prereq unmet the node is LOCKED, and the screen says so: the
  // button is disabled and reads "Locked". That is the half of "prereq-gated"
  // the old spec never exercised - it only ever clicked the node after the
  // prereq was already paid for, so a node with no `requires` at all would
  // have passed it.
  //
  // Asserted as disabled rather than clicked: a disabled button never becomes
  // actionable, so page.click waits out the whole timeout and reports "click
  // timed out" - which looks like a hung UI rather than a working gate.
  expect(await page.evaluate(() => window.__god.player.actions.includes('all-hands'))).toBe(false);
  const gated = page.locator('#lvlup-node-mgr-all-hands');
  await expect(gated).toBeDisabled();
  await expect(gated).toHaveText('Locked');

  // Pay the prereq, and now it takes.
  await page.click('#lvlup-node-mgr-stonewall');
  await expect.poll(() => page.evaluate(() => window.__god.player.perks.includes('mgr-stonewall'))).toBe(true);
  await page.click('#lvlup-node-mgr-all-hands');
  await expect.poll(() => page.evaluate(() => window.__god.player.actions.includes('all-hands'))).toBe(true);

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
