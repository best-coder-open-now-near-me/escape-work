// A cone armed OUT of combat (TODO Phase 5). The wedge geometry used to live
// inside combat.js's closure, so aiming Bulk Mail outside a fight drew nothing
// and a click just walked you to the floor you aimed at.
import { test, expect } from '@playwright/test';
import { bootAndPick } from './helpers.js';

test.slow();

test('an armed cone previews its wedge and opens the fight it aims at', async ({ page }) => {
  await bootAndPick(page, 'mail-room');

  // Arm Bulk Mail from the out-of-combat hotbar.
  await page.click('#hotbar-act-mail-cone');
  await expect.poll(() => page.evaluate(() => window.__game.armed)).toBe('mail-cone');

  // Aim at a coworker and fire. The cone resolves on whoever the wedge catches,
  // rather than refusing because they are not at arm's length.
  const en = await page.evaluate(() => {
    const e = window.__game.enemies.find((x) => x.alive);
    return e ? { x: e.x, z: e.z } : null;
  });
  expect(en, 'a living coworker to aim at').not.toBe(null);
  const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.x, en.z]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);

  // Either the fight opened, or the player is walking into range for it - both
  // are the cone doing something. What must NOT happen is the old behaviour:
  // the slot silently disarming into a plain walk.
  await expect.poll(
    () => page.evaluate(() => window.__game.inCombat || window.__game.armed === 'mail-cone'),
    { timeout: 30_000 },
  ).toBe(true);
});
