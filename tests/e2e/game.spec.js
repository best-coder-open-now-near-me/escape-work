// Headless smoke tests driving the real game with real mouse input, asserting
// against the window.__game / window.__editor read-only handles. These guard
// the wiring the unit tests can't reach: engine boot, click -> pathfinding ->
// movement, the DOM UI, and the editor.
import { test, expect } from '@playwright/test';

// Boot the game and get into a playable state (class picked, model spawned).
async function bootAndPick(page) {
  await page.goto('/');
  await page.click('#pick-office-drone');
  await page.waitForFunction(() => window.__game && window.__game.stats);
}

test('boots to the class picker and picking a class starts the game', async ({ page }) => {
  await page.goto('/');
  // Three resumes on the desk, straight from the class registry.
  await expect(page.locator('#pick-office-drone')).toBeVisible();
  await expect(page.locator('#pick-middle-manager')).toBeVisible();
  await expect(page.locator('#pick-it-support')).toBeVisible();
  await page.click('#pick-office-drone');
  await expect(page.locator('#stats')).toContainText('HP 22/22');
  const tile = await page.evaluate(() => window.__game.playerTile);
  expect(tile).toEqual({ x: 2, z: 2 }); // level1 spawn
});

test('clicking open floor walks the player there', async ({ page }) => {
  await bootAndPick(page);
  // Wait a beat for the camera to settle, then click a nearby open tile via
  // the game's own world->screen projection.
  await page.waitForTimeout(400);
  const target = { x: 4, z: 4 };
  const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [target.x, target.z]);
  await page.mouse.click(p.x, p.y);
  await expect.poll(
    () => page.evaluate(() => window.__game.playerTile),
    { timeout: 8000 },
  ).toEqual(target);
});

test('the pockets toggle with I and start empty', async ({ page }) => {
  await bootAndPick(page);
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await expect(page.locator('#inventory-panel')).toContainText('0/10');
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeHidden();
});

test('confronting a coworker starts combat and an attack lands', async ({ page }) => {
  test.setTimeout(120_000);
  await bootAndPick(page);
  await page.waitForTimeout(400);
  // Click the nearest live enemy until the fight starts - they wander inside
  // a small leash, so a single long walk-up can arrive a tile short.
  let inCombat = false;
  for (let i = 0; i < 12 && !inCombat; i++) {
    inCombat = await page.evaluate(() => window.__game.inCombat);
    if (inCombat) break;
    const en = await page.evaluate(() => window.__game.enemies.find((e) => e.alive));
    const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [en.x, en.z]);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(1500);
    inCombat = await page.evaluate(() => window.__game.inCombat);
  }
  expect(inCombat).toBe(true);
  await expect(page.locator('#combat-panel')).toBeVisible();
  // A click can race the combat trigger and get spent as an in-combat walk;
  // if this turn's AP is too low to attack, cycle a turn for a fresh budget.
  if (await page.evaluate(() => window.__combat.ap) < 3) {
    await page.click('#combat-end-turn');
    await expect.poll(
      () => page.evaluate(() => window.__combat?.phase),
      { timeout: 20_000 },
    ).toBe('player');
  }
  await expect(page.locator('#combat-turn')).toHaveText('YOUR TURN');
  // Find an adjacent target; if nobody is beside us yet (the trigger can
  // fire off an enemy's own step, then they shuffle), cycle turns until the
  // AI closes in.
  const findFoe = () => page.evaluate(() => {
    const pt = window.__game.playerTile;
    return window.__combat.enemies.find((e) =>
      e.alive && Math.max(Math.abs(e.x - pt.x), Math.abs(e.z - pt.z)) <= 1) || null;
  });
  let foe = await findFoe();
  for (let i = 0; i < 3 && !foe; i++) {
    await page.click('#combat-end-turn');
    await expect.poll(
      () => page.evaluate(() => window.__combat?.phase),
      { timeout: 20_000 },
    ).toBe('player');
    foe = await findFoe();
  }
  expect(foe).toBeTruthy();
  // Arm the basic attack and click the target. The camera keeps easing after
  // combat walks, so a projection taken mid-ease can round to the wrong tile
  // (which lowers the attack instead) - settle, then retry a couple times.
  const foeHp = ([x, z]) => page.evaluate(
    ([fx, fz]) => window.__combat.enemies.find((e) => e.x === fx && e.z === fz)?.hp,
    [x, z],
  );
  for (let i = 0; i < 3 && (await foeHp([foe.x, foe.z])) >= foe.hp; i++) {
    await page.waitForTimeout(700); // camera settle
    if (await page.evaluate(() => window.__combat.armed) !== 'attack') {
      await page.click('#act-attack');
      expect(await page.evaluate(() => window.__combat.armed)).toBe('attack');
    }
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(200);
  }
  expect(await foeHp([foe.x, foe.z])).toBeLessThan(foe.hp);
});

test('the editor loads level1 and paints with the wall brush', async ({ page }) => {
  await page.goto('/#editor');
  await page.waitForFunction(() => window.__editor);
  expect(await page.evaluate(() => window.__editor.size)).toEqual({ width: 24, height: 18 });
  await page.click('#brush-wall');
  expect(await page.evaluate(() => window.__editor.brush)).toBe('wall');
  await page.waitForTimeout(300); // camera settle
  // Paint the map-centre tile - guaranteed on-screen at the default zoom.
  const p = await page.evaluate(() => window.__editor.project(11, 8));
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__editor.charAt(11, 8))).toBe('#');
});
