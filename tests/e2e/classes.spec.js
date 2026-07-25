// Class-specific kit: IT Support's granted kick and self-targeted purging
// reboot, and the Mail Room's cone attack with its paper aftermath.
import { test, expect } from '@playwright/test';
import { bootAndPick, clickWorld, enterCombat, waitStill, stableProject } from './helpers.js';

test('IT Support: kick joins the bar, reboot self-casts as a purge', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'it-support');
  await enterCombat(page);
  await expect(page.locator('#act-kick')).toBeVisible(); // talent-granted

  // A stray projected click during combat entry can have pre-armed (or a
  // first click can toggle OFF) an action - ensure reboot ends up armed.
  for (let i = 0; i < 3 && await page.evaluate(() => window.__combat.armed) !== 'reboot'; i++) {
    await page.click('#act-reboot');
  }
  expect(await page.evaluate(() => window.__combat.armed)).toBe('reboot');
  const ap0 = await page.evaluate(() => window.__combat.ap);
  // Read the cost from the registry rather than pinning a number here: action
  // costs get re-priced (MOVEMENT_PLAN M5 moved every attack 3 -> 2), and this
  // test is about the self-cast spending EXACTLY its cost, not about what that
  // cost happens to be this month.
  const cost = await page.evaluate(() => window.__god.actionAp('reboot'));
  // Click your own tile: the reboot turns YOU off and on again. The purge's
  // self-cast is tile-based (tile === your tile), so settle first - a click
  // taken while the camera still eases can project a tile off and lower the
  // action instead - then aim at the TILE CENTRE (what the check compares),
  // not the continuous body point. Re-arm and retry on a miss.
  let spent = false;
  for (let i = 0; i < 6 && !spent; i++) {
    // Re-arm only if reboot is armable (a prior mis-click could have walked
    // and spent AP; never click a disabled button - that would hang).
    if (await page.evaluate(() => window.__combat.armed) !== 'reboot') {
      if (!(await page.locator('#act-reboot').isEnabled())) break;
      await page.click('#act-reboot');
    }
    // Aim at the tile CENTRE (what the purge check compares), and wait for
    // the camera to actually settle so the projection lands true - not just
    // for the player to stop.
    const tile = await page.evaluate(() => window.__game.playerTile);
    const p = await stableProject(page, tile.x, tile.z);
    await page.mouse.click(p.x, p.y);
    // Compare in NODE - `ap0` doesn't exist in the browser page context.
    const ap = await page.evaluate(() => window.__combat.ap).catch(() => null);
    spent = ap != null && Math.abs(ap - (ap0 - cost)) < 0.01;
  }
  expect(spent).toBe(true); // reboot self-cast consumed exactly its AP
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
  // The cone rolls to hit per target now (HIT_PLAN) - pin it so the fired cone
  // reliably damages this foe.
  await page.evaluate(() => { window.__combat.forceHit = true; });
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
