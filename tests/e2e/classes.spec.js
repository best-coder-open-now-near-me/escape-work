// Class-specific kit: IT Support's granted kick and self-targeted purging
// reboot, and the Mail Room's cone attack with its paper aftermath.
import { test, expect } from '@playwright/test';
import { bootAndPick, clickWorld, enterCombat } from './helpers.js';

test('IT Support: kick joins the bar, reboot self-casts as a purge', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'it-support');
  await enterCombat(page);
  await expect(page.locator('#act-kick')).toBeVisible(); // talent-granted

  await page.click('#act-reboot');
  expect(await page.evaluate(() => window.__combat.armed)).toBe('reboot');
  const ap0 = await page.evaluate(() => window.__combat.ap);
  // Click your own tile: the reboot turns YOU off and on again.
  await page.waitForTimeout(800); // camera settle before projecting
  const pos = await page.evaluate(() => window.__game.playerPos);
  expect(await clickWorld(page, pos.x, pos.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__combat.ap)).toBe(ap0 - 3);
  expect(await page.evaluate(() => window.__combat.armed)).toBe(null);
});

test('Mail Room: Bulk Mail cones damage and leave paper drifts', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'mail-room');
  await enterCombat(page);
  await expect(page.locator('#act-mail-cone')).toBeVisible();

  // Count nearby paper BEFORE the cone - a fight near the IT room's painted
  // drifts must not false-positive the aftermath check.
  const paperNear = () => page.evaluate(() => {
    const pt = window.__game.playerTile;
    let n = 0;
    for (let z = pt.z - 5; z <= pt.z + 5; z++) {
      for (let x = pt.x - 5; x <= pt.x + 5; x++) {
        if (window.__game.surfaceAt(x, z) === 'paper') n += 1;
      }
    }
    return n;
  });
  const paperBefore = await paperNear();
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  await page.click('#act-mail-cone');
  await page.waitForTimeout(800); // camera settle before projecting
  expect(await clickWorld(page, foe.x, foe.z)).toBe(true);
  await expect.poll(() => page.evaluate(
    ([x, z, hp]) => {
      const e = window.__combat.enemies.find((f) => f.x === x && f.z === z);
      return !e || !e.alive || e.hp < hp;
    },
    [foe.x, foe.z, foe.hp],
  ), { timeout: 30_000 }).toBe(true);
  expect(await page.evaluate(() => window.__combat.armed)).toBe(null); // fired, lowered

  // The wedge's bare floor is carpeted with fresh paper.
  expect(await paperNear()).toBeGreaterThan(paperBefore);
});
