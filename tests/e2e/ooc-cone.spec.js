// A cone armed OUT of combat (TODO Phase 5). The wedge geometry used to live
// inside combat.js's closure, so aiming Bulk Mail outside a fight drew nothing
// and a click just walked you to the floor you aimed at.
import { test, expect } from '@playwright/test';
import { bootAndPick, bootStash, clickWorld } from './helpers.js';

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

  // The wedge resolves: it opens the fight on whoever it catches, or - with
  // the aimed coworker beyond its reach - fires anyway and says so (the
  // empty-wedge rule, tested on its own below). What must NOT happen is the
  // old behaviour: the slot silently disarming into a plain walk.
  await expect.poll(
    () => page.evaluate(() => window.__game.inCombat
      || window.__game.narration.some((l) => l.includes('Plenty of litter'))),
    { timeout: 30_000 },
  ).toBe(true);
});

// An empty room: nobody for the wedge to catch, so the volley has nothing to
// aim at - which must not stop it (designer, 2026-07-31: a cone needs no
// target, in or out of combat). The refusal it replaces said "Nobody is in
// the way" and made the one attack whose point is the paper behind it the
// one attack you could not fire at the floor.
const EMPTY_FLOOR = {
  name: 'Sorting Room',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player' },
  map: [
    '###########',
    '#.........#',
    '#.@......>#',
    '#.........#',
    '###########',
  ],
};

test('a cone fired at an empty wedge still fires: paper lands, no fight, no walk', async ({ page }) => {
  await bootStash(page, EMPTY_FLOOR, 'mail-room');

  await page.click('#hotbar-act-mail-cone');
  await expect.poll(() => page.evaluate(() => window.__game.armed)).toBe('mail-cone');

  const pt = await page.evaluate(() => window.__game.playerTile);
  const paperNear = () => page.evaluate(([cx, cz]) => {
    let n = 0;
    for (let z = cz - 5; z <= cz + 5; z++) {
      for (let x = cx - 5; x <= cx + 5; x++) {
        if (window.__game.surfaceAt(x, z) === 'paper') n += 1;
      }
    }
    return n;
  }, [pt.x, pt.z]);
  expect(await paperNear()).toBe(0); // a clean floor, so the aftermath is the cone's

  // Aim down the empty room and fire.
  expect(await clickWorld(page, pt.x + 3, pt.z)).toBe(true);

  // The volley resolves: the slot lowers and the wedge's floor is carpeted.
  await expect.poll(() => page.evaluate(() => window.__game.armed)).toBe(null);
  expect(await paperNear()).toBeGreaterThan(0);
  // ...and firing at nobody neither opened a fight nor walked you anywhere -
  // the old ground branch turned this click into a plain walk.
  expect(await page.evaluate(() => window.__game.inCombat)).toBe(false);
  expect(await page.evaluate(() => window.__game.playerTile)).toEqual(pt);
});
