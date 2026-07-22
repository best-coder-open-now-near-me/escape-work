// Looting: rummage a container behind its door, one-shot loot state, the
// pockets panel, dropping to the floor, Alt-label pickup, consumables - and
// a full fight so a body can be looted.
import { test, expect } from '@playwright/test';
import { bootAndPick, clickWorld, waitStill, enterCombat, endTurnUntilPlayer } from './helpers.js';

test('desk rummage, drop, Alt pickup, and consumable use', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page);

  // The desk at (8,2) sits in a doored cubicle - open the door on the way.
  expect(await clickWorld(page, 8, 4.58)).toBe(true);
  await expect.poll(
    () => page.evaluate(() => window.__game.doors.find((d) => d.key === 'h:8,5')?.open),
    { timeout: 60_000 },
  ).toBe(true);

  // Rummage the desk: cold coffee is a guaranteed roll.
  expect(await clickWorld(page, 8, 2)).toBe(true);
  await expect.poll(
    () => page.evaluate(() => window.__game.inventory.includes('cold-coffee')),
    { timeout: 60_000 },
  ).toBe(true);
  expect(await page.evaluate(() => window.__game.containerLootAt(8, 2))).toEqual([]);

  // Re-rummaging an emptied desk yields nothing new.
  const count = await page.evaluate(() => window.__game.inventory.length);
  await clickWorld(page, 8, 2);
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => window.__game.inventory.length)).toBe(count);

  // Drop the first item: it becomes a loose parcel on the floor.
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#inv-drop-0');
  await expect.poll(() => page.evaluate(() => window.__game.looseItems.length)).toBe(1);

  // Alt shows a clickable label over it; clicking walks over and picks it up.
  // The chips are repositioned every frame while the camera eases, which
  // fails Playwright's stability gate - settle, then click by coordinates.
  await page.waitForTimeout(1500);
  await page.keyboard.down('Alt');
  const chip = page.locator('.loot-label', { hasText: 'Coffee' }).first();
  await expect(chip).toBeVisible();
  const box = await chip.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Alt');
  await expect.poll(
    () => page.evaluate(() => window.__game.looseItems.length),
    { timeout: 60_000 },
  ).toBe(0);
  expect(await page.evaluate(() => window.__game.inventory.length)).toBe(count);

  // Use the consumable: it heals (capped) and leaves the pockets.
  const idx = await page.evaluate(() => window.__game.inventory.indexOf('cold-coffee'));
  await page.keyboard.press('i'); // refresh the panel's row ids
  await page.keyboard.press('i');
  await page.click(`#inv-use-${idx}`);
  await expect.poll(() => page.evaluate(() => window.__game.inventory.length)).toBe(count - 1);
});

test('a fallen coworker leaves a lootable body', async ({ page }) => {
  test.setTimeout(420_000);
  await bootAndPick(page);
  await enterCombat(page);

  // Grind the fight down: attack the nearest living enemy, patch up with the
  // class heal when hurt, end turn when out of AP.
  for (let round = 0; round < 60; round++) {
    const st = await page.evaluate(() => ({
      inCombat: window.__game.inCombat,
      gameOver: window.__game.gameOver,
      phase: window.__combat?.phase,
      ap: window.__combat?.ap,
      hp: window.__game.stats?.hp,
      pt: window.__game.playerTile,
      foes: window.__combat?.enemies || [],
    }));
    if (!st.inCombat || st.gameOver) break;
    if (st.phase !== 'player') { await page.waitForTimeout(700); continue; }
    if (st.hp <= 9 && st.ap >= 2) {
      const healed = await page.evaluate(() => {
        const b = [...document.querySelectorAll('#combat-actions button')]
          .find((x) => !x.disabled && /Coffee Break|Espresso|Energy Drink|Snack|Smoke/i.test(x.textContent));
        if (b) { b.click(); return true; }
        return false;
      });
      if (healed) { await page.waitForTimeout(400); continue; }
    }
    const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    const target = st.foes.filter((e) => e.alive).sort((a, b) => cheb(a, st.pt) - cheb(b, st.pt))[0];
    if (!target) { await page.waitForTimeout(500); continue; }
    if (st.ap >= 3) {
      if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
      await page.waitForTimeout(200);
      if (!(await clickWorld(page, target.x, target.z))) { await endTurnUntilPlayer(page); continue; }
      await page.waitForTimeout(700);
      await waitStill(page).catch(() => {});
    } else {
      await endTurnUntilPlayer(page);
    }
  }
  expect(await page.evaluate(() => !window.__game.inCombat && !window.__game.gameOver)).toBe(true);

  // The corpse persists; Alt labels it; clicking it loots the guaranteed drop.
  const pt = await page.evaluate(() => window.__game.playerTile);
  const body = await page.evaluate((p) => window.__game.enemies
    .filter((e) => !e.alive)
    .sort((a, b) => Math.max(Math.abs(a.x - p.x), Math.abs(a.z - p.z))
      - Math.max(Math.abs(b.x - p.x), Math.abs(b.z - p.z)))[0], pt);
  expect(body).toBeTruthy();
  await page.keyboard.down('Alt');
  await expect(page.locator('.loot-label', { hasText: 'body' }).first()).toBeVisible();
  await page.keyboard.up('Alt');
  const expected = body.name.startsWith('HR') ? 'hr-pamphlet' : 'performance-review';
  expect(await clickWorld(page, body.x, body.z)).toBe(true);
  await expect.poll(
    () => page.evaluate((it) => window.__game.inventory.includes(it), expected),
    { timeout: 60_000 },
  ).toBe(true);
});
