// The to-hit / defense model (HIT_PLAN.md): with the hit roll live, an attack
// can miss. These specs pin the roll (window.__combat.forceHit) to prove the
// two things a miss must do - spend the cost, and do nothing else: no damage,
// and no applied status.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat } from './helpers.js';

// You and one Manager, two tiles apart in an open room. enterCombat walks you
// adjacent and opens the fight against the Manager alone.
const DUEL_ARENA = {
  name: 'Duel Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '###########',
    '#.........#',
    '#.........#',
    '#...@.M...#',
    '#.........#',
    '#.........#',
    '###########',
  ],
};

test('a forced miss deals no damage but still spends the attack AP', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page); // ends on the player's turn, adjacent to the Manager

  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  const foeHp = () => page.evaluate(([x, z]) =>
    window.__combat.enemies.find((e) => e.x === x && e.z === z)?.hp, [foe.x, foe.z]);
  // Pin every roll to a MISS for the rest of the fight.
  await page.evaluate(() => { window.__combat.forceHit = false; });

  // Arm the basic attack and swing until the attack's AP is actually spent - a
  // real swing (exactly the 3-AP cost), not a mis-projected lower or a walk-up.
  // Under the pin that swing is a guaranteed miss.
  let swung = false;
  for (let i = 0; i < 6 && !swung; i++) {
    await page.waitForTimeout(800); // camera settle before projecting
    const apBefore = await page.evaluate(() => window.__combat.ap);
    if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(300);
    const apAfter = await page.evaluate(() => window.__combat.ap);
    if (Math.abs(apAfter - (apBefore - 3)) < 0.01) swung = true; // the 3-AP attack fired
  }
  expect(swung).toBe(true);           // the swing happened and cost its AP
  expect(await foeHp()).toBe(foe.hp); // ...but the forced miss dealt no damage
  await expect(page.locator('#combat-log')).toContainText('spam folder'); // the miss line
});

test('a forced miss applies no status - the Manager sticks no gum', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);

  // Every roll misses from here on. (Combat entry may have let the Manager land
  // one honest hit before the pin, so reset the drone to a clean baseline; the
  // point of the test is what happens AFTER, under a guaranteed-miss assault.)
  await page.evaluate(() => {
    window.__combat.forceHit = false;
    const s = window.__god.player;
    s.hp = s.maxHp;
    s.gum = 0;
    window.__combat.refresh();
  });
  // The Manager swings on each of its turns - including its gum-flick attack -
  // but a miss lands neither damage nor its rider.
  for (let i = 0; i < 6; i++) {
    if (await page.evaluate(() => window.__combat?.phase === 'player')) {
      await page.click('#combat-end-turn').catch(() => {});
    }
    await page.waitForTimeout(500);
  }

  // The office drone weathered a full assault untouched: no HP lost, no gum stuck.
  const hp = await page.evaluate(() => window.__god.player.hp);
  const maxHp = await page.evaluate(() => window.__god.player.maxHp);
  const gum = await page.evaluate(() => window.__god.player.gum);
  expect(hp).toBe(maxHp); // misses dealt no damage
  expect(gum).toBe(0);    // and stuck no gum
});
