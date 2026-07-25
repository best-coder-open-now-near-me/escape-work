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
  // real swing (exactly the attack's cost, read from the registry so a
  // re-pricing doesn't quietly turn this into a test of nothing), not a
  // mis-projected lower or a walk-up. Under the pin that swing is a
  // guaranteed miss.
  const cost = await page.evaluate(() => window.__god.actionAp('attack'));
  let swung = false;
  for (let i = 0; i < 6 && !swung; i++) {
    await page.waitForTimeout(800); // camera settle before projecting
    // NEVER click a disabled button: Playwright waits for it to become enabled
    // and burns the whole test timeout. A mis-projected click walks instead of
    // swinging, which can drain the turn below the cost - so pass the turn and
    // pick it back up with a full pool. Every roll is pinned to a miss, so
    // handing the Manager its turns costs nothing.
    await expect.poll(async () => {
      const s = await page.evaluate((c) => window.__combat
        && { player: window.__combat.phase === 'player', can: window.__combat.ap >= c }, cost);
      if (!s) return false;
      if (s.player && !s.can) await page.click('#combat-end-turn').catch(() => {});
      return s.player && s.can;
    }, { timeout: 60_000 }).toBe(true);
    const apBefore = await page.evaluate(() => window.__combat.ap);
    if (await page.evaluate(() => window.__combat.armed) !== 'attack') {
      await page.click('#act-attack');
    }
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(300);
    const apAfter = await page.evaluate(() => window.__combat.ap);
    if (Math.abs(apAfter - (apBefore - cost)) < 0.01) swung = true; // the attack fired
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
    if (s.statuses) delete s.statuses.gum; // gum is a status now
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
  const gummed = await page.evaluate(() => !!window.__god.player.statuses?.gum);
  expect(hp).toBe(maxHp);  // misses dealt no damage
  expect(gummed).toBe(false); // and stuck no gum (the status was never applied)
});

test('the armed hover shows a to-hit percentage that matches the roll', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);

  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  const foeHp = () => page.evaluate(([x, z]) =>
    window.__combat.enemies.find((e) => e.x === x && e.z === z)?.hp, [foe.x, foe.z]);

  // Arm the attack, then hover the Manager until the to-hit readout appears.
  if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
  let chance = null;
  for (let i = 0; i < 8 && chance == null; i++) {
    await page.waitForTimeout(500);
    if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.move(fp.x, fp.y);
    await page.waitForTimeout(150);
    chance = await page.evaluate(() => window.__combat.hoverHitChance);
  }
  expect(typeof chance).toBe('number');
  expect(chance).toBeGreaterThan(0);
  // The cost tag shows the rounded percentage of that chance.
  await expect(page.locator('#combat-move-cost')).toContainText(`${Math.round(chance * 100)}%`);

  // Now actually swing that target (pinned to hit): the chance the roll used is
  // the same chance the preview promised.
  await page.evaluate(() => { window.__combat.forceHit = true; });
  const hp0 = foe.hp;
  let landed = false;
  for (let i = 0; i < 6 && !landed; i++) {
    await page.waitForTimeout(600);
    if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(300);
    const hp = await foeHp();
    landed = hp != null && hp < hp0; // a pinned-hit swing dropped the foe's HP
  }
  expect(landed).toBe(true);
  // lastRoll is my swing's (still my turn - no enemy has rolled since).
  const rollChance = await page.evaluate(() => window.__combat.lastRoll.chance);
  expect(rollChance).toBeCloseTo(chance, 6); // preview == the chance that rolled
});
