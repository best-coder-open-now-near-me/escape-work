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
  //
  // The one we pick has to be UNIQUELY named, because a display name is the only
  // handle we have: the charm hook resolves `targetName` against the ENGAGED
  // list, and the readback below resolves it against the INITIATIVE order. Those
  // are two collections in two different orders, and names are not unique - HR
  // posts a req on her own turn, so by the time control reaches the player this
  // arena can hold two slots both called "Employee". Charming "Employee" then
  // marks whichever one `engaged` lists first and asks about whichever one
  // initiative lists first, so the side-swap check below reads a unit that was
  // never charmed. That is how it failed on CI while passing locally, where HR
  // had not got a turn in yet.
  const before = await page.evaluate(() => {
    const slots = window.__combat.order;
    const tally = new Map();
    for (const s of slots) tally.set(s.name, (tally.get(s.name) ?? 0) + 1);
    const slot = slots.find((s) => !s.member && s.alive && tally.get(s.name) === 1)
      ?? slots.find((s) => !s.member && s.alive);
    return {
      hostiles: window.__game.enemies.filter((e) => e.alive && !e.charmed).length,
      name: slot?.name ?? null,
      slots: slots.length,
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
      // `some`, not `find`: where the arena left only duplicate names to borrow,
      // the slot bearing that name which changed sides IS the one charmed, while
      // `find` would answer about an arbitrary twin. With a unique name - what
      // the pick above prefers - the two read the same.
      isMember: window.__combat.order.some((s) => s.name === name && s.member),
    }), before.name);

    expect(borrowed.borrowedCount).toBe(1);
    expect(borrowed.offEnemySide).toBe(before.hostiles - 1);
    expect(borrowed.slots, 'the round is the same length - the slot was swapped, not re-added')
      .toBe(before.slots);
    expect(borrowed.isMember, 'and it now acts on the player side').toBe(true);
  }

  // Drive the rounds forward. A borrowed coworker is PLAYER-controlled - it
  // holds a real turn and waits for input - so nothing expires unless somebody
  // actually takes those turns. That is the feature working, not a stall: the
  // charm clock spends on the borrowed body's OWN turns.
  for (let i = 0; i < 30; i++) {
    const done = await page.evaluate(() => {
      if (window.__game.enemies.every((e) => !e.charmed)) return true;
      window.__combat?.endTurn(); // the same call the End Turn button makes
      return false;
    });
    if (done) break;
    await page.waitForTimeout(250);
  }

  // Either way they are returned: a colleague walks away where a summon would
  // have been destroyed.
  await expect.poll(
    () => page.evaluate(() => window.__game.enemies.filter((e) => e.charmed).length),
    { timeout: 60_000 },
  ).toBe(0);
  const after = await page.evaluate(() => window.__game.enemies.filter((e) => e.alive).length);
  expect(after, 'handed back intact, not deleted').toBe(before.hostiles);
});
