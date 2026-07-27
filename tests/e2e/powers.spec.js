// The new action verbs (POWERS_PLAN.md), driven through the real game.
//
// The unit suite (tests/unit/powers.test.js) owns the rules; these specs own
// the WIRING - that arming a friendly verb points the click at the other half
// of the board, that the payload actually lands on the sheet it named, and
// that the AP and the use are spent exactly once.
import { test, expect } from '@playwright/test';
import {
  bootAndPick, enterCombat, waitForPlayerTurn, refillAp, clickAction,
  combatState, onScreen,
} from './helpers.js';

// The acting member's live status ids, straight off the combat surface.
const myStatuses = (page) => page.evaluate(() =>
  (window.__combat.party.find((m) => m.active)?.statuses ?? []).map((s) => s.id));

// Click the acting member's OWN body. project3 aims at a world point at a
// given height, which is what makes a click land on a tall mesh rather than
// the floor tile behind it.
async function clickSelf(page) {
  const p = await page.evaluate(() => {
    const a = window.__combat.actingAt;
    return window.__game.project3(a.x, 0.6, a.z);
  });
  expect(onScreen(p), `own body projected off-screen at ${JSON.stringify(p)}`).toBe(true);
  await page.mouse.click(p.x, p.y);
}

test('Remote Restart self-cast clears every status, and spends one use', async ({ page }) => {
  await bootAndPick(page, 'it-support');
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  // Put something on ourselves to clear. `bleed` is a step-clock status, so it
  // will not tick away underneath the test while the click resolves.
  await page.evaluate(() => window.__combat.applyStatus('bleed', 4));
  expect(await myStatuses(page)).toContain('bleed');

  const apBefore = await page.evaluate(() => window.__combat.ap);
  await clickAction(page, 'remote-restart');
  expect(await page.evaluate(() => window.__combat.armed)).toBe('remote-restart');

  await clickSelf(page);

  // The purge landed on the sheet...
  await expect.poll(() => myStatuses(page), { timeout: 15_000 }).not.toContain('bleed');
  // ...the AP was spent once...
  const apAfter = await page.evaluate(() => window.__combat.ap);
  expect(apBefore - apAfter).toBeCloseTo(2, 1);
  // ...and the action lowered itself, the way every committed action does.
  expect(await page.evaluate(() => window.__combat.armed)).toBe(null);
});

test('a friendly verb does not arm a swing at a coworker', async ({ page }) => {
  await bootAndPick(page, 'it-support');
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  await clickAction(page, 'remote-restart');

  const en = await page.evaluate(() => {
    const e = window.__game.enemies.find((x) => x.alive);
    return e ? { x: e.x, z: e.z, hp: e.hp } : null;
  });
  expect(en, 'a living enemy to aim at').not.toBe(null);
  const p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.6, z), [en.x, en.z]);
  expect(onScreen(p), 'enemy projected off-screen').toBe(true);

  // The crosshair is the click's own promise (ARCHITECTURE, hover.js): with a
  // buff armed, hovering a coworker must NOT claim a swing, because the click
  // would refuse one. Driven through a REAL mouse move so the whole hover
  // path runs - main.js's pick, combat.handleHover, hover.setCursor.
  const before = await combatState(page);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__game.cursor)).not.toBe('crosshair');

  // And the enemy takes no damage from a click aimed at them.
  await page.mouse.click(p.x, p.y);
  const after = await page.evaluate(([x, z]) =>
    window.__game.enemies.find((e) => e.x === x && e.z === z)?.hp ?? null, [en.x, en.z]);
  expect(after, `enemy HP changed after a buff-armed click (${JSON.stringify(before.enemies)})`)
    .toBe(en.hp);
});

test('Performance Review is HR\'s, and it lands the Commended status', async ({ page }) => {
  await bootAndPick(page, 'human-resources');
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  await clickAction(page, 'performance-review');
  await clickSelf(page);

  await expect.poll(() => myStatuses(page), { timeout: 15_000 }).toContain('commended');
});
