// Charm (TODO Phase 8): borrow a coworker, then hand them back intact.
//
// The risk this spec exists for is the SOFT-LOCK. A borrowed unit is alive and
// engaged but no longer hostile, so a victory test counting "alive" would either
// end the fight with a stranger in the party or never end it at all - the same
// shape as the closed-door deadlock. And the first attempt at this feature had
// the borrowed body driven by the AI *against* the player, because a slot's team
// was fixed at creation.
import { test, expect } from '@playwright/test';
import { bootAndPick, enterCombat, waitForPlayerTurn } from './helpers.js';

test.slow();

test('a borrowed coworker changes sides, keeps its turn, and is returned', async ({ page }) => {
  await bootAndPick(page, 'office-drone');
  await enterCombat(page);
  await waitForPlayerTurn(page);

  // Borrow somebody actually IN the fight - the initiative order is the
  // engaged set, and a coworker across the floor is not charmable at range.
  const before = await page.evaluate(() => {
    const slot = window.__combat.order.find((s) => !s.member && s.alive);
    return {
      hostiles: window.__game.enemies.filter((e) => e.alive && !e.charmed).length,
      name: slot?.name ?? null,
      slots: window.__combat.order.length,
    };
  });
  expect(before.name, 'a living coworker in the fight to borrow').not.toBe(null);

  const landed = await page.evaluate(
    (name) => window.__combat.applyStatus('charmed', 3, 0, name), before.name);
  expect(landed).toBe(true);

  // Charming the LAST hostile ends the fight - nobody is fighting you any more,
  // which is what victory means. That is the edge this feature had to get right
  // rather than soft-lock on, so the spec accepts it and checks the invariant
  // that matters in both cases: the coworker is HANDED BACK, never deleted.
  const stillFighting = await page.evaluate(() => !!window.__combat);

  if (stillFighting) {
    const borrowed = await page.evaluate((name) => ({
      offEnemySide: window.__game.enemies.filter((e) => e.alive && !e.charmed).length,
      borrowedCount: window.__game.enemies.filter((e) => e.charmed).length,
      // The slot changed HANDS but not its place: same number of slots, and the
      // one bearing their name is now player-side.
      slots: window.__combat.order.length,
      isMember: !!window.__combat.order.find((s) => s.name === name)?.member,
    }), before.name);

    expect(borrowed.borrowedCount).toBe(1);
    expect(borrowed.offEnemySide).toBe(before.hostiles - 1);
    expect(borrowed.slots, 'the round is the same length - the slot was swapped, not re-added')
      .toBe(before.slots);
    expect(borrowed.isMember, 'and it now acts on the player side').toBe(true);
  }

  // Either way they are returned: a colleague walks away where a summon would
  // have been destroyed.
  await expect.poll(
    () => page.evaluate(() => window.__game.enemies.filter((e) => e.charmed).length),
    { timeout: 120_000 },
  ).toBe(0);
  const after = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive).length);
  expect(after, 'handed back intact, not deleted').toBe(before.hostiles);
});
