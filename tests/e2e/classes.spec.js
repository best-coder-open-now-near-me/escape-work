// Class-specific kit: IT Support's granted kick and self-targeted purging
// reboot, the Mail Room's cone attack with its paper aftermath, and Security's
// Detain - which is now a ROOT that deals no damage (POWERS_PLAN M2), not the
// "attack that also stuns" it used to be.
import { test, expect } from '@playwright/test';
import { bootAndPick, bootStash, clickWorld, enterCombat, waitStill, stableProject, onScreen, clickAction } from './helpers.js';

test('IT Support: kick joins the bar, reboot self-casts as a purge', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'it-support');
  await enterCombat(page);
  await expect(page.locator('#act-kick')).toBeVisible(); // talent-granted

  // A stray projected click during combat entry can have pre-armed (or a
  // first click can toggle OFF) an action - ensure reboot ends up armed.
  for (let i = 0; i < 3 && await page.evaluate(() => window.__combat.armed) !== 'reboot'; i++) {
    await clickAction(page, 'reboot');
  }
  expect(await page.evaluate(() => window.__combat.armed)).toBe('reboot');

  // Give the purge something to purge. Reboot is a PURE purge now, and a purge
  // that would land on a clean sheet is refused before the commit rather than
  // billed for nothing (powers.js emptyPayload: "Nothing to clear - they are
  // running clean."). This test asserts the self-cast spends its AP, so it has
  // to hand the verb real work first - without it the click is a legitimate
  // no-op, the retry loop never sees AP move, and the failure surfaces as a
  // five-minute timeout instead of "you asked it to clear nothing".
  //
  // `bleed` specifically: it is a step-clock status, so it cannot tick away
  // underneath the loop while the camera settles between attempts.
  await page.evaluate(() => window.__combat.applyStatus('bleed', 4));

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
      await clickAction(page, 'reboot');
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
  // ...and it was a PURGE, which is what the test is named for - the AP check
  // alone would pass on any self-targeted verb that costs the same.
  const left = await page.evaluate(() =>
    (window.__combat.party.find((m) => m.active)?.statuses ?? []).map((s) => s.id));
  expect(left).not.toContain('bleed');
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
  await clickAction(page, 'mail-cone');
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

// Just you and one Manager, two tiles apart in an open room - the same shape
// the other precision specs use. Level 1's floor is too loose for a projected
// click on a wandering coworker to be reliable.
const GUARD_ARENA = {
  name: 'Guard Post',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '#########',
    '#.......#',
    '#.@.M..>#',
    '#.......#',
    '#########',
  ],
};

test('Security: Detain roots without damaging, and the guard wears the cop rig', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, GUARD_ARENA, 'security');
  // The class actually boots: its own sheet, its own rig, its own bar.
  expect(await page.evaluate(() => window.__game.stats.className)).toBe('Security');
  expect(await page.evaluate(() => window.__game.stats.maxHp)).toBe(26);

  await enterCombat(page);
  await expect(page.locator('#act-detain')).toBeVisible();
  await expect(page.locator('#act-stand-post')).toBeVisible();
  await expect(page.locator('#act-night-thermos')).toBeVisible();

  await page.evaluate(() => { window.__combat.forceHit = true; });
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect(foe).toBeTruthy();
  const foeNow = () => page.evaluate(([x, z]) =>
    window.__combat.enemies.find((e) => e.x === x && e.z === z), [foe.x, foe.z]);

  for (let i = 0; i < 6; i++) {
    const cur = await foeNow();
    if (cur && cur.statuses.some((s) => s.id === 'detained')) break;
    await page.waitForTimeout(900); // camera settle before projecting
    if (!(await page.evaluate(() => window.__combat?.phase === 'player'))) continue;
    // Closing the distance spends AP, which can leave the 3 AP Detain
    // unaffordable and its button disabled. This spec is about the root, not
    // the AP economy - top the pool up the way forceHit pins the roll. Uses
    // too: Detain is rationed, and six attempts outlast its two.
    await page.evaluate(() => {
      window.__combat.ap = window.__combat.maxAp;
      window.__combat.usesLeft.detain = 2;
    });
    if (await page.evaluate(() => window.__combat?.armed) !== 'detain') {
      if (!(await page.locator('#act-detain').isVisible())) break;
      await page.click('#act-detain');
    }
    const p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.9, z), [foe.x, foe.z]);
    if (!onScreen(p)) continue;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(700);
  }
  const after = await foeNow();
  // The root lands...
  expect(after.statuses.some((s) => s.id === 'detained')).toBe(true);
  // ...and it deals NO damage. That is the control verb's design rule
  // (POWERS_PLAN #3), and it is the whole difference between the new Detain
  // and the "attack that also stuns" it replaced - which was converging on the
  // same power as the shove's wall-slam and the Manager's Delegate.
  expect(after.hp).toBe(foe.hp);
  // A root is not a stun: they keep their turn, they just cannot leave.
  expect(after.statuses.some((s) => s.id === 'stunned')).toBe(false);
});
