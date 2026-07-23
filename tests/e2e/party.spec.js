// The party: recruit the intern through dialogue, watch him follow, hand him
// the lead from the party bar, fight as either member - and prove old
// single-sheet saves still load.
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld, waitStill, combatOrWalkDone } from './helpers.js';

// A small arena: the intern one tile from spawn, open floor to walk.
const LEVEL = {
  name: 'Party Test Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', N: 'it-intern' },
  map: [
    '##########',
    '#........#',
    '#.@N.....#',
    '#........#',
    '#.......>#',
    '##########',
  ],
};

// The same arena with a Manager equidistant from both members - combat's
// nearest-target tiebreak (lowest HP) makes his focus controllable.
const COMBAT_LEVEL = {
  name: 'Party Combat Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', N: 'it-intern', M: 'manager' },
  map: [
    '##########',
    '#........#',
    '#.@N.....#',
    '#........#',
    '#..M....>#',
    '##########',
  ],
};

// Recruit the intern via the dialogue tree (assumes he stands adjacent).
async function recruitIntern(page) {
  expect(await clickWorld(page, 3, 2)).toBe(true);
  await page.waitForFunction(() => window.__game.dialogueOpen, null, { timeout: 20_000 });
  await page.click('button.dialogue-option:has-text("Come with me")');
  await page.click('button.dialogue-option:has-text("Stick close")');
  expect(await page.evaluate(() => window.__game.party.length)).toBe(2);
}

test('recruit the intern, he follows, and the party bar hands him the lead', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, LEVEL);

  // Talk to the intern (adjacent, so the dialogue opens without a walk).
  await recruitIntern(page);
  const party = await page.evaluate(() => window.__game.party);
  expect(party[0].active).toBe(true);
  expect(await page.evaluate(() => window.__game.npcs.length)).toBe(0); // he's ours now

  // The party bar exists with both slots once there are two members.
  await expect(page.locator('#party-slot-0')).toBeVisible();
  await expect(page.locator('#party-slot-1')).toBeVisible();

  // Walk the floor - the intern trails within follow range.
  expect(await clickWorld(page, 7, 3)).toBe(true);
  await waitStill(page);
  await expect.poll(async () => {
    const [a, b] = await page.evaluate(() => window.__game.party);
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
  }, { timeout: 30_000 }).toBeLessThanOrEqual(3);

  // Hand him the lead: portrait click re-keys control, HUD and hotbar.
  await page.click('#party-slot-1');
  await expect.poll(() => page.evaluate(() => window.__game.party[1].active)).toBe(true);
  expect(await page.evaluate(() => window.__game.stats.name)).toBe('Nervous IT Intern');
  await expect(page.locator('#hotbar-act-reboot')).toBeAttached(); // his kit, his bar

  // Clicks now move HIM - and the ex-leader follows.
  expect(await clickWorld(page, 2, 3)).toBe(true);
  await waitStill(page);
  const after = await page.evaluate(() => window.__game.party);
  expect(Math.max(Math.abs(after[1].x - 2), Math.abs(after[1].z - 3))).toBeLessThanOrEqual(1);
  expect(Math.max(Math.abs(after[0].x - after[1].x), Math.abs(after[0].z - after[1].z))).toBeLessThanOrEqual(3);
});

test('party combat: switch the active member, and the fight survives the leader going down', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, COMBAT_LEVEL);
  await recruitIntern(page);

  // Pick the fight: click the Manager, walk up, combat triggers on arrival.
  expect(await clickWorld(page, 3, 4)).toBe(true);
  expect(await combatOrWalkDone(page, 30_000)).toBe(true);
  expect(await page.evaluate(() => window.__combat.party.length)).toBe(2);

  // In combat the portraits carry each member's remaining AP.
  await expect(page.locator('#party-slot-0')).toContainText('AP');

  // Portrait click hands the intern the floor: his action bar, his AP.
  await page.click('#party-slot-1');
  await expect.poll(() => page.evaluate(() => window.__combat.party[1].active)).toBe(true);
  await expect(page.locator('#act-reboot')).toBeVisible(); // the intern's kit
  // ...and back.
  await page.click('#party-slot-0');
  await expect.poll(() => page.evaluate(() => window.__combat.party[0].active)).toBe(true);

  // Hold Ctrl: rings under everyone, and hovering a body mid-fight glows it
  // and names it in the banner.
  await page.keyboard.down('Control');
  expect(await page.evaluate(() => window.__game.ctrlHeld)).toBe(true);
  const mp = await page.evaluate(() => {
    const en = window.__game.enemies.find((e) => e.alive);
    return window.__game.project3(en.px ?? en.x, 0.9, en.pz ?? en.z);
  });
  await page.mouse.move(mp.x, mp.y);
  await expect.poll(() => page.evaluate(() => window.__game.hoverKind), { timeout: 10_000 }).toBe('enemy');
  await page.keyboard.up('Control');
  expect(await page.evaluate(() => window.__game.ctrlHeld)).toBe(false);

  // Wound the controlled leader to 1 HP (live god handle), then end their
  // turn. End Turn QUEUES through the party: the first click passes the
  // floor to the intern, only the second hands the round to the enemies.
  await page.evaluate(() => { window.__god.player.hp = 1; window.__combat.refresh(); });
  await page.click('#combat-end-turn');
  await expect.poll(() => page.evaluate(() => window.__combat.party[1].active)).toBe(true);
  expect(await page.evaluate(() => window.__combat.phase)).toBe('player');
  await page.click('#combat-end-turn');
  // The Manager targets the bloodied nearest member, the leader drops, and
  // the fight carries on with the intern in control instead of ending.
  await expect.poll(
    () => page.evaluate(() => window.__combat.party[0].hp === 0 && window.__combat.party[1].active),
    { timeout: 90_000 },
  ).toBe(true);
  expect(await page.evaluate(() => window.__game.inCombat)).toBe(true); // no defeat
  expect(await page.evaluate(() => window.__combat.phase)).not.toBe('done');
});

// Both recruitables in one room - the roster fills to its cap of three.
const TRIO_LEVEL = {
  name: 'Full Roster Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', N: 'it-intern', V: 'mail-veteran' },
  map: [
    '##########',
    '#........#',
    '#.@N.V...#',
    '#........#',
    '#.......>#',
    '##########',
  ],
};

test('a full roster: both companions join and Tab cycles control', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, TRIO_LEVEL);
  await recruitIntern(page);

  // The veteran stands a short walk on - click him, walk up, sign him too.
  expect(await clickWorld(page, 5, 2)).toBe(true);
  await page.waitForFunction(() => window.__game.dialogueOpen, null, { timeout: 30_000 });
  await page.click('button.dialogue-option:has-text("Who are you")');
  await page.click('button.dialogue-option:has-text("Come with me")');
  await page.click('button.dialogue-option:has-text("Stay close")');
  await expect.poll(() => page.evaluate(() => window.__game.party.length)).toBe(3);
  await expect(page.locator('#party-slot-2')).toBeVisible();

  // Tab hands control around the roster.
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__game.party[1].active)).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => window.__game.party[2].active)).toBe(true);
});

test('a legacy single-sheet save loads as a one-member party', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('escape-work.progress', JSON.stringify({
      levelId: 'level2',
      sheet: {
        classId: 'office-drone', className: 'Office Drone', model: 'worker',
        hp: 9, maxHp: 22, maxAp: 6, level: 2, xp: 0, xpNext: 15, bonusDmg: 1,
        actions: ['attack', 'defend', 'coffee'], talent: null,
      },
    }));
  });
  await page.reload();
  await page.waitForFunction(() => window.__game && window.__game.stats, null, { timeout: 90_000 });
  const party = await page.evaluate(() => window.__game.party);
  expect(party.length).toBe(1);
  expect(party[0].active).toBe(true);
  const stats = await page.evaluate(() => window.__game.stats);
  expect(stats.hp).toBe(9); // wounds carried over
  expect(stats.name).toBe('Office Drone'); // backfilled by the migration
  expect(stats.paper).toBe(0); // pre-pockets fields exist
});
