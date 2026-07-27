// Toppling (POWERS_PLAN M6): tall freestanding furniture goes over when
// shoved, and lands on whoever is behind it. The office stops being scenery
// you fight IN and becomes something you fight WITH.
import { test, expect } from '@playwright/test';
import {
  bootStash, enterCombat, waitForPlayerTurn, refillAp, clickAction,
  clickWorld, waitStill, combatState, onScreen,
} from './helpers.js';

// Player, cabinet, Manager in a row. Shoving the cabinet from the west lands
// it exactly on the Manager's tile - the whole point of the verb being
// direction-derived rather than aimed.
const TOPPLE_ROW = {
  name: 'Topple Row',
  tiles: { '#': 'wall', '.': 'floor', B: 'cabinet' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#######',
    '#@BM..#',
    '#.....#',
    '#######',
  ],
};

test('a shoved cabinet lands on the coworker behind it, and leaves cover', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, TOPPLE_ROW, 'security');
  await enterCombat(page);
  await waitForPlayerTurn(page);

  // enterCombat walks us around the cabinet to reach the Manager. Get back
  // west of it so the cabinet is between us and them.
  await clickWorld(page, 1, 1);
  await waitStill(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  // Pin the Manager on the landing tile. Left to itself it walks toward us on
  // its turn, so the cabinet would come down on empty carpet - and this spec
  // is about what the prop does to a body, not about AI pathing. `detained`
  // is the root the control verb applies; the debug setter is the same
  // affordance forceHit is.
  await page.evaluate(() => {
    const m = window.__game.enemies.find((e) => e.alive);
    window.__game.debugPlaceEnemy(m.name, 3, 1);
    window.__combat.applyStatus('detained', 9, 0, m.name);
  });
  await page.waitForTimeout(300);

  const before = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect(before, 'a living Manager to drop it on').toBeTruthy();
  expect([before.x, before.z], 'the Manager is standing on the landing tile').toEqual([3, 1]);
  expect(await page.evaluate(() => window.__game.tileAt(2, 1))).toBe('cabinet');

  await clickAction(page, 'shove');
  const p = await page.evaluate(() => window.__game.project3(2, 0.4, 1));
  expect(onScreen(p), 'the cabinet projected off-screen').toBe(true);
  await page.mouse.click(p.x, p.y);

  // The prop LEFT its tile...
  await expect.poll(() => page.evaluate(() => window.__game.tileAt(2, 1)), { timeout: 20_000 })
    .toBe('floor');
  // ...and landed on the next one as its fallen twin, which is walkable cover
  // rather than a wall (a shove that spawned impassable terrain could seal a
  // doorway and strand the fight).
  expect(await page.evaluate(() => window.__game.tileAt(3, 1))).toBe('cabinet-fallen');

  // The Manager wore it.
  const after = await page.evaluate(() =>
    window.__combat.enemies.find((e) => e.name === 'The Manager'));
  expect(after.hp, `Manager took no topple damage (${JSON.stringify(await combatState(page))})`)
    .toBeLessThan(before.hp);
  // Toppling reuses the EXISTING stun, so it inherits the anti-chain window
  // rather than becoming a second way to lock somebody out of a fight.
  expect(after.alive ? after.statuses.some((s) => s.id === 'stunned') : true).toBe(true);
});
