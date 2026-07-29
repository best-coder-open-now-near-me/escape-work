// One bar, in a fight and out of one.
//
// The combat action bar and the persistent hotbar were parallel implementations
// of the same widget, swapped by mode: two builders, two id conventions, two
// affordability sites, two tooltip builders, two arming states, two ordering
// rules. The player-facing cost was that a FIGHT - the half of the game that is
// nothing but pressing verbs under pressure - had no saved layout, no pager, no
// item slots and no number keys.
//
// Nothing tested any of that, which is how the duplication survived a review
// that named it and a phase that closed over it. This file is that test.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, waitForPlayerTurn, refillAp } from './helpers.js';

// You and one Manager, two tiles apart in an open room - enterCombat engages
// them with nothing in the way.
const BAR_ARENA = {
  name: 'Bar Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#########',
    '#.......#',
    '#..@.M..#',
    '#.......#',
    '#########',
  ],
};

test('the bar in a fight is the same bar: same slot ids, same number keys', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, BAR_ARENA, 'office-drone');
  await expect(page.locator('#hotbar-act-attack')).toBeVisible();

  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  // Still up, still the same id. Combat used to hide `#hotbar` and build
  // `#act-attack` instead - a second id for one power, which is why the suite
  // had to know both conventions.
  await expect(page.locator('#hotbar')).toBeVisible();
  await expect(page.locator('#hotbar-act-attack')).toBeVisible();

  // The slot presses through to COMBAT: it arms the swing on the acting
  // member, and pressing it again lowers it.
  await page.click('#hotbar-act-attack');
  await expect.poll(() => page.evaluate(() => window.__combat.armed)).toBe('attack');
  await page.click('#hotbar-act-attack');
  await expect.poll(() => page.evaluate(() => window.__combat.armed)).toBe(null);

  // Number keys are live in a fight. They were gated `!inCombat`, so the row
  // you learned out of combat was the row you could not use in one.
  const key = await page.evaluate(() =>
    (Number(document.querySelector('#hotbar-act-attack').dataset.slot) % 8) + 1);
  await page.keyboard.press(String(key));
  await expect.poll(() => page.evaluate(() => window.__combat.armed)).toBe('attack');
});

// Player and Manager already adjacent at boot, so the fight opens without
// anybody walking anywhere - which keeps the player on the exact tile the door
// edge needs them on. `H 2 2` is the edge between (2,1) and (2,2), so standing
// at (2,1) is standing at the handle.
const DOOR_ARENA = {
  name: 'Door Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  doors: ['H 2 2'],
  map: [
    '#######',
    '#.@M..#',
    '#.....#',
    '#######',
  ],
};

test('a door can be worked mid-fight, from the tile beside it, for AP', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DOOR_ARENA, 'office-drone');
  // Adjacent at boot: the proximity trigger opens the fight on its own.
  await expect.poll(() => page.evaluate(() => window.__game.inCombat), { timeout: 90_000 }).toBe(true);
  await waitForPlayerTurn(page);
  await refillAp(page);

  expect(await page.evaluate(() => window.__game.doorOpen('h:2,2')), 'the door starts shut').toBe(false);
  const apBefore = await page.evaluate(() => window.__combat.party[0].ap);

  // Right-click the door: in a fight this menu used to offer Examine and
  // nothing else, so the game's only line-of-sight blocker was untouchable
  // during the half of the game that is about line of sight.
  const p = await page.evaluate(() => window.__game.project(2, 2));
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.locator('#context-menu')).toContainText('Open the door');
  await page.click('#context-menu >> text=Open the door');

  await expect.poll(() => page.evaluate(() => window.__game.doorOpen('h:2,2'))).toBe(true);
  // Billed, like everything else in a turn.
  expect(await page.evaluate(() => window.__combat.party[0].ap)).toBe(apBefore - 1);
});

test('a snack comes out of your pockets mid-fight, and costs a turn to eat', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, BAR_ARENA, 'office-drone');
  await page.evaluate(() => {
    window.__god.player.inventory = ['cold-coffee'];
    window.__god.player.hp = 5;
  });
  // Park it on the bar out of combat, so what gets pressed in the fight is the
  // player's own arrangement - the layout is supposed to survive the mode.
  await page.click('#hotbar-slot-7', { button: 'right' });
  await page.click('#context-menu >> text=Cold Coffee');
  await expect(page.locator('#hotbar-item-cold-coffee')).toBeVisible();

  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  // The item slot is ON the bar in a fight. The combat bar listed actions
  // only, so the whole consumable economy vanished exactly where it mattered:
  // every item in the game is a heal, and healing exists to survive fights.
  const slot = page.locator('#hotbar-item-cold-coffee');
  await expect(slot).toBeVisible();

  const before = await page.evaluate(() => ({
    hp: window.__combat.party[0].hp, ap: window.__combat.party[0].ap,
  }));
  await slot.click();

  // It heals for the item's own value...
  await expect.poll(() => page.evaluate(() => window.__combat.party[0].hp)).toBe(before.hp + 2);
  // ...and it is BILLED, like every other verb in a turn. A free full heal
  // every round would be the strongest move in the game, so it costs the
  // shove's 2 AP.
  await expect.poll(() => page.evaluate(() => window.__combat.party[0].ap)).toBe(before.ap - 2);
  await expect.poll(() => page.evaluate(() => window.__game.inventory.length)).toBe(0);
});
