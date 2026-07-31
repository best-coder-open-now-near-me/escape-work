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
import { bootStash, enterCombat, waitForPlayerTurn, refillAp, clickWorld, waitStill } from './helpers.js';

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

test('one live slot at a time: a different press lowers what was up, never stacks', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, BAR_ARENA, 'office-drone');
  await expect(page.locator('#hotbar-act-attack')).toBeVisible();
  await enterCombat(page);
  await waitForPlayerTurn(page);
  await refillAp(page);

  const live = () => page.evaluate(() => ({
    armed: window.__combat.armed,
    pending: window.__combat.pendingConfirm,
  }));

  // Arm the email, then press Deflect Blame: the attack lowers and NOTHING
  // arms in its place. This used to stack - the armed attack survived the
  // instant's first press, so the bar showed two lit slots while the
  // attack's target rings went on painting under a bar that read as Deflect.
  await page.click('#hotbar-act-attack');
  await expect.poll(() => page.evaluate(() => window.__combat.armed)).toBe('attack');
  await page.click('#hotbar-act-defend');
  await expect.poll(live).toEqual({ armed: null, pending: null });

  // The second, deliberate press is what raises Deflect's confirm...
  await page.click('#hotbar-act-defend');
  await expect.poll(() => page.evaluate(() => window.__combat.pendingConfirm)).toBe('defend');
  // ...and reaching for another slot drops that confirm without arming it.
  await page.click('#hotbar-act-shove');
  await expect.poll(live).toEqual({ armed: null, pending: null });
  // Pressed again, the shove arms - one press stands down, the next raises.
  await page.click('#hotbar-act-shove');
  await expect.poll(() => page.evaluate(() => window.__combat.armed)).toBe('shove');

  // The confirm flow itself still commits: lower the shove, then Deflect
  // twice puts the status on.
  await page.click('#hotbar-act-shove');
  await page.click('#hotbar-act-defend');
  await page.click('#hotbar-act-defend');
  await expect.poll(() => page.evaluate(() =>
    (window.__combat.party.find((m) => m.active)?.statuses ?? []).map((s) => s.id)))
    .toContain('deflecting');
});

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
    ((Number(document.querySelector('#hotbar-act-attack').dataset.slot) % 10) + 1) % 10);
  await page.keyboard.press(String(key));
  await expect.poll(() => page.evaluate(() => window.__combat.armed)).toBe('attack');

  // ...and it is one BOX, not two. The bar became shared before the boxes did:
  // the verbs moved out to the slot row and combat's panel was left floating
  // above it at bottom:92px, 640px wide, holding a turn line and one End Turn
  // button. The gap between them was the shape of what had been removed.
  const dock = await page.evaluate(() => {
    const turn = document.getElementById('combat-panel');
    const slots = document.getElementById('hotbar');
    const d = document.getElementById('action-dock');
    const dr = d.getBoundingClientRect();
    const nr = document.getElementById('narration-box').getBoundingClientRect();
    return {
      turnParent: turn.parentElement.id,
      slotsParent: slots.parentElement.id,
      // Neither region draws a competing BOX - the dock is the only thing on
      // screen down there with a background and a shadow. The turn region does
      // keep its own bottom border as a divider from the slot row beneath it;
      // that is furniture inside one box, not a second box, which is the
      // distinction actually worth holding the line on.
      regionChrome: [turn, slots].map((e) => {
        const s = getComputedStyle(e);
        return { bg: s.backgroundColor, shadow: s.boxShadow };
      }),
      // The dock must not run under the narrator: it is pointer-events:none, so
      // an End Turn button beneath it still works and just cannot be seen -
      // which is why this is measured rather than eyeballed.
      clearsNarrator: dr.right <= nr.left,
    };
  });
  expect(dock.turnParent).toBe('action-dock');
  expect(dock.slotsParent).toBe('action-dock');
  for (const c of dock.regionChrome) {
    expect(c.bg).toBe('rgba(0, 0, 0, 0)');
    expect(c.shadow).toBe('none');
  }
  expect(dock.clearsNarrator).toBe(true);
});

// Out of a fight, nothing in the room should be able to START one - so there is
// nobody in it. This test used to reuse BAR_ARENA, where a Manager stands two
// tiles away and walks at you as soon as anything moves; on a slow runner the
// fight opened before the assertion below ran and `#combat-panel` did exist. The
// test is about the dock wearing no turn strip, and a coworker two tiles off is
// scenery it cannot afford.
const EMPTY_ARENA = {
  name: 'Empty Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player' },
  map: [
    '#########',
    '#.......#',
    '#..@....#',
    '#.......#',
    '#########',
  ],
};

test('out of a fight the dock is just the bar, with no empty turn strip', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, EMPTY_ARENA, 'office-drone');
  await expect(page.locator('#hotbar')).toBeVisible();
  // The turn readout is created per fight and removed with it, so out here the
  // dock holds one region and is exactly as tall as the slot row.
  await expect(page.locator('#combat-panel')).toHaveCount(0);
  const h = await page.evaluate(() => {
    const d = document.getElementById('action-dock').getBoundingClientRect();
    const s = document.getElementById('hotbar').getBoundingClientRect();
    return { dock: Math.round(d.height), slots: Math.round(s.height) };
  });
  // 8px padding either side of the slot row and nothing else in the box.
  expect(h.dock - h.slots).toBeLessThanOrEqual(20);
});

// `H 2 2` is the edge between (2,1) and (2,2), so standing at (2,1) is standing
// at the handle. The player starts there and the Manager is two tiles east, so
// the fight opens with a short walk and the player steps back to the door.
//
// NB the fight cannot open with both of them simply standing adjacent at boot:
// `checkCombatTrigger` runs off movement (`if (anyoneMoved)`), so a tableau
// nobody walks into never triggers. Learned the hard way.
const DOOR_ARENA = {
  name: 'Door Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  doors: ['H 2 2'],
  map: [
    '#######',
    '#.@.M.#',
    '#.....#',
    '#######',
  ],
};

test('a door can be worked mid-fight, from the tile beside it, for AP', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DOOR_ARENA, 'office-drone');
  await enterCombat(page);
  await waitForPlayerTurn(page);

  // Step back onto the door's own tile. The rule is adjacency, not auto-walk,
  // because movement in a fight belongs to combat and is priced per tile - so
  // getting there can take more than one turn's worth of AP, and the test has
  // to PROVE it arrived rather than assume one click did it. (It did not: the
  // first version of this test right-clicked from wherever the engage left the
  // player and got a menu with only Examine on it, which is correct behaviour
  // and a broken test.)
  await expect.poll(async () => {
    const at = await page.evaluate(() => window.__game.playerTile);
    if (at.x === 2 && at.z === 1) return true;
    await refillAp(page);
    await clickWorld(page, 2, 1);
    await waitStill(page);
    await waitForPlayerTurn(page).catch(() => {});
    return page.evaluate(() => {
      const t = window.__game.playerTile;
      return t.x === 2 && t.z === 1;
    });
  }, { timeout: 120_000, intervals: [400] }).toBe(true);
  await refillAp(page);

  expect(await page.evaluate(() => window.__game.doorOpen('h:2,2')), 'the door starts shut').toBe(false);
  const apBefore = await page.evaluate(() => window.__combat.party[0].ap);

  expect(await page.evaluate(() => window.__game.playerTile),
    'standing at the handle').toEqual({ x: 2, z: 1 });

  // Right-click the door: in a fight this menu used to offer Examine and
  // nothing else, so the game's only line-of-sight blocker was untouchable
  // during the half of the game that is about line of sight.
  //
  // Aim at the EDGE (z 1.6), not a tile centre. A door is an edge, and
  // `doorNearPoint` refuses any point that is not near one - a tile centre is
  // the furthest a point can BE from every edge, so clicking (2,2) resolved to
  // no door at all and the menu correctly offered only Examine.
  const p = await page.evaluate(() => window.__game.project(2, 1.6));
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.locator('#context-menu')).toContainText('Open the door');
  await page.click('#context-menu >> text=Open the door');

  await expect.poll(() => page.evaluate(() => window.__game.doorOpen('h:2,2'))).toBe(true);
  // Billed, like everything else in a turn.
  expect(await page.evaluate(() => window.__combat.party[0].ap)).toBe(apBefore - 1);

  // ...and now the LEFT click, on the same edge, which is how anybody actually
  // reaches for a door. This half was missing entirely: the combat click path
  // had no door branch, so a left-click on a door fell through to the tile
  // handler and tried to WALK there, and the hover path never asked about
  // doors either, so the cursor stayed a plain arrow over it. The right-click
  // menu above worked the whole time, which is exactly why nobody noticed -
  // "doors work in a fight" was true and tested, through a route most players
  // never try first.
  await refillAp(page);
  const apBeforeClick = await page.evaluate(() => window.__combat.party[0].ap);
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => page.evaluate(() => document.getElementById('app').style.cursor),
    { timeout: 10_000 }).toBe('pointer');

  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__game.doorOpen('h:2,2'))).toBe(false);
  expect(await page.evaluate(() => window.__combat.party[0].ap)).toBe(apBeforeClick - 1);
  // And it worked the handle rather than walking at it.
  expect(await page.evaluate(() => window.__game.playerTile)).toEqual({ x: 2, z: 1 });
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
  await page.click('#hotbar-slot-9', { button: 'right' });
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
