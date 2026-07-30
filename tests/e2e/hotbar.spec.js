// The persistent hotbar as a SURFACE: what order the kit is in, how it pages
// when it outgrows one row, and the right-click menu that lets the player put
// any power or consumable in any slot.
//
// The order itself is unit-tested (stats.orderedActionIds); what needs a real
// browser is that the DOM row matches it, that the pager only exists when there
// is somewhere to page to, and that an assignment survives into the buttons.
import { test, expect } from '@playwright/test';
import { bootStash } from './helpers.js';

// An empty room. Nothing here starts a fight, so the bar stays up and the
// keyboard belongs to it for the whole test.
const QUIET = {
  name: 'Quiet Floor',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player' },
  map: [
    '##########',
    '#........#',
    '#...@....#',
    '#........#',
    '##########',
  ],
};

// The bar's buttons in DOM order: their ids and whether they're on the row
// currently showing.
// The bar is an icon grid: the slot's face is an emoji, the key number rides in
// its corner, and the NAME is in the tooltip - so that is what a test reads.
const slots = (page) => page.$$eval('#hotbar button[data-slot]', (els) => els.map((e) => ({
  id: e.id,
  slot: Number(e.dataset.slot),
  shown: e.style.display !== 'none',
  text: e.textContent,
  title: e.title,
})));

test('the kit is in canonical order, on one row, with room to grow', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, QUIET, 'office-drone');
  await expect(page.locator('#hotbar')).toBeVisible();

  // Basic swing, shove, the throws, then the class powers, then the universal
  // Take Cover (TACTICS_PLAN M6) and the bare-handed swing that stands in for
  // a weapon (data/actions.js, stats.orderedActionIds). The trailing empty
  // slot is deliberate: it is where the coffee goes, and the reason a player
  // ever right-clicks a slot at all.
  const all = await slots(page);
  expect(all.map((s) => s.id)).toEqual([
    'hotbar-act-attack',
    'hotbar-act-shove',
    'hotbar-act-paper-ball',
    'hotbar-act-paper-airplane',
    'hotbar-act-defend',
    'hotbar-act-coffee',
    'hotbar-act-take-cover',
    'hotbar-act-punch',
    'hotbar-slot-8',
  ]);

  // A whole kit fits one row, so there is nothing to page and no pager to see.
  expect(all.every((s) => s.shown)).toBe(true);
  await expect(page.locator('#hotbar-page')).toBeHidden();
  await expect(page.locator('#hotbar-next')).toBeHidden();
  // Slots are numbered from 1 within the row, which is what the keys address,
  // and the tooltip is where the name lives.
  expect(all[0].text).toMatch(/^1/);
  expect(all[0].title).toMatch(/^Passive-Aggressive Email · 2AP/);
  expect(all[8].text).toMatch(/^9—$/);
  expect(all[8].title).toMatch(/Empty slot/);

  await page.keyboard.press('2');
  expect(await page.evaluate(() => window.__game.armed)).toBe('shove');
  // The empty slot answers a press by saying what it is for.
  await page.keyboard.press('9');
  expect(await page.evaluate(() => window.__game.narration.at(-1))).toMatch(/empty/i);
});

test('right-click a slot to reassign it; assigning swaps rather than duplicates', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, QUIET, 'office-drone');
  await expect(page.locator('#hotbar-act-attack')).toBeVisible();

  // Right-click the leftmost slot: the menu lists every power the character has.
  await page.click('#hotbar-act-attack', { button: 'right' });
  await expect(page.locator('#context-menu')).toBeVisible();
  await expect(page.locator('#context-menu')).toContainText('Coffee Break');
  await expect(page.locator('#context-menu')).toContainText('Shove');

  // Assign Coffee Break there. It was already on the bar, so the two SWAP -
  // a power can never be in two slots at once.
  await page.click('#context-menu >> text=Coffee Break');
  await expect.poll(async () => (await slots(page)).map((s) => s.id)).toEqual([
    'hotbar-act-coffee',
    'hotbar-act-shove',
    'hotbar-act-paper-ball',
    'hotbar-act-paper-airplane',
    'hotbar-act-defend',
    'hotbar-act-attack',
    'hotbar-act-take-cover',
    'hotbar-act-punch',
    'hotbar-slot-8',
  ]);

  // The layout rides on the SHEET, so pressing key 1 now arms what is in slot 1.
  // (Coffee Break is combat-only out here, so it refuses and says why - which is
  // proof the press landed on the coffee and not on the email that used to be
  // there.)
  await page.keyboard.press('1');
  expect(await page.evaluate(() => window.__game.narration.at(-1))).toMatch(/pockets/i);
  expect(await page.evaluate(() => window.__game.armed)).toBe(null);

  // Clearing a slot leaves it empty and addressable, not collapsed.
  await page.click('#hotbar-act-coffee', { button: 'right' });
  await page.click('#context-menu >> text=Clear this slot');
  await expect(page.locator('#hotbar-slot-0')).toBeVisible();
  await expect(page.locator('#hotbar-slot-0')).toHaveText(/^1—$/);
});

test('a consumable can live in a slot, and pressing it drinks one', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, QUIET, 'office-drone');
  await expect(page.locator('#hotbar-act-attack')).toBeVisible();

  // Two coffees in the pockets and a wound to justify one.
  await page.evaluate(() => {
    window.__god.player.inventory = ['cold-coffee', 'cold-coffee'];
    window.__god.player.hp = 5;
  });

  // Put the coffee in the spare slot at the end of the row: consumables are
  // assignable, gear is not (equipping is a pockets act, not a hotbar press).
  await page.click('#hotbar-slot-8', { button: 'right' });
  await expect(page.locator('#context-menu')).toContainText('Cold Coffee');
  await page.click('#context-menu >> text=Cold Coffee');

  // The slot carries the item and how many are in the bag.
  const slot = page.locator('#hotbar-item-cold-coffee');
  await expect(slot).toBeVisible();
  await expect(slot).toHaveText(/×2$/);
  await expect(slot).toHaveAttribute('title', /Cold Coffee ×2/);

  // Pressing it drinks one: HP up by the item's heal, one coffee gone, and the
  // count on the button follows the bag down.
  await slot.click();
  await expect.poll(() => page.evaluate(() => window.__game.stats.hp)).toBe(7);
  await expect.poll(() => page.evaluate(() => window.__game.inventory.length)).toBe(1);
  await expect(page.locator('#hotbar-item-cold-coffee')).toHaveText(/^9☕$/);

  // Filling the row grew the bar: a second row exists now, and it pages. This is
  // the only way rows appear - the game never hides a power you already have
  // behind a pager, it makes room when you ask for it.
  await expect(page.locator('#hotbar-page')).toHaveText('1/2');
  await page.keyboard.press(']');
  await expect(page.locator('#hotbar-page')).toHaveText('2/2');
  await expect(page.locator('#hotbar-slot-9')).toBeVisible();
  await expect(page.locator('#hotbar-act-attack')).toBeHidden();
});
