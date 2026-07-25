// The fast tier: "is the game fundamentally working?" in a couple of minutes,
// so a push gets an answer before you've context-switched away.
//
// The whole suite's cost is BOOT, not assertions: each test spends ~50s
// booting the engine and rendering the zoomed-out floor under software GL,
// then seconds actually testing. So this file boots ONCE (describe.serial +
// a page shared across the steps) and walks the critical path through that
// single world - roughly the cost of one ordinary test for the coverage of
// six.
//
// The trade that buys the speed: these steps SHARE STATE and run in order.
// That is the opposite of how the rest of the suite is written, and it is
// deliberate here and nowhere else. Each step must leave the world usable by
// the next - if you need a pristine world, write an isolated test in the
// spec file for that feature instead of adding a step here.
import { test, expect } from '@playwright/test';
import { bootAndPick, waitStill } from './helpers.js';

test.describe.configure({ mode: 'serial' });

test.describe('smoke', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await bootAndPick(page); // the one boot this whole file pays for
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('boots into level1 with a live character sheet', async () => {
    expect(await page.evaluate(() => window.__game.playerTile)).toEqual({ x: 2, z: 2 });
    const stats = await page.evaluate(() => window.__game.stats);
    expect(stats.hp).toBeGreaterThan(0);
    expect(stats.hp).toBe(stats.maxHp);
  });

  test('the HUD and hotbar are up', async () => {
    await expect(page.locator('#hotbar')).toBeVisible();
    await expect(page.locator('#hotbar-act-attack')).toBeVisible();
    await expect(page.locator('#hotbar-act-defend')).toHaveCount(0); // combat-only
  });

  test('the pockets toggle with I', async () => {
    await page.keyboard.press('i');
    await expect(page.locator('#inventory-panel')).toBeVisible();
    await page.keyboard.press('i');
    await expect(page.locator('#inventory-panel')).toBeHidden();
  });

  test('clicking open floor walks the player there', async () => {
    const target = { x: 4, z: 4 };
    const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [target.x, target.z]);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => page.evaluate(() => window.__game.playerTile),
      { timeout: 60_000 }).toEqual(target);
    await waitStill(page);
  });

  test('clicking a closed door walks up and swings it open', async () => {
    // Proves the pick ray, the walk-up interaction and door state all still
    // work together - the thing most likely to break silently.
    const doors = await page.evaluate(() => window.__game.doors);
    expect(doors.length).toBeGreaterThan(0);
    const p = await page.evaluate(() => window.__game.project(8, 4.58));
    await page.mouse.click(p.x, p.y);
    await expect.poll(
      () => page.evaluate(() => window.__game.doors.find((d) => d.key === 'h:8,5')?.open),
      { timeout: 90_000 },
    ).toBe(true);
  });

  test('a fight opens and the combat panel takes over', async () => {
    // The core loop. Pinned to always hit once combat exists, so this step
    // tests "can a fight start and resolve a swing", not the dice.
    const { enterCombat } = await import('./helpers.js');
    await enterCombat(page);
    await expect(page.locator('#combat-panel')).toBeVisible();
    expect(await page.evaluate(() => window.__game.inCombat)).toBe(true);
    expect(await page.evaluate(() => window.__combat.order.length)).toBeGreaterThan(1);
  });
});
