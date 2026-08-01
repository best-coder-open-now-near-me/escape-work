// The party: recruit the intern through dialogue, watch him follow, hand him
// the lead from the party bar, fight as either member - and prove old
// single-sheet saves still load.
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld, waitStill, enterCombat, waitForPlayerTurn } from './helpers.js';

// A small arena: the intern one tile from spawn, open floor to walk.
const LEVEL = {
  name: 'Party Test Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', N: 'it-support' },
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
// The Manager sits FAR from the recruit corner: his wander leash (2 tiles)
// must never reach adjacent to the player/intern, or combat could trigger
// mid-recruit-dialogue and detach the option buttons. Combat starts only when
// a test deliberately clicks him.
const COMBAT_LEVEL = {
  name: 'Party Combat Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', N: 'it-support', M: 'manager' },
  map: [
    '################',
    '#..............#',
    '#.@N.......M...#',
    '#..............#',
    '#............>.#',
    '################',
  ],
};

// Recruit the intern via the dialogue tree (assumes he stands adjacent).
// Tolerate the "Stick close" button re-rendering: only the recruit (on the
// "Come with me" click) is load-bearing - assert on the party size.
async function recruitIntern(page) {
  expect(await clickWorld(page, 3, 2)).toBe(true);
  await page.waitForFunction(() => window.__game.dialogueOpen, null, { timeout: 20_000 });
  await page.click('button.dialogue-option:has-text("Come with me")');
  await expect.poll(() => page.evaluate(() => window.__game.party.length)).toBe(2);
  // Close out the confirmation node if it's still up (a fight could have
  // stolen focus and closed it already).
  const close = page.locator('button.dialogue-option:has-text("Stick close")');
  if (await close.count()) await close.click().catch(() => {});
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
  // Named for the job, like every unnamed coworker who does one (companions.js).
  expect(await page.evaluate(() => window.__game.stats.name)).toBe('IT Support');
  await expect(page.locator('#hotbar-act-reboot')).toBeAttached(); // his kit, his bar

  // Clicks now move HIM - and the ex-leader follows.
  expect(await clickWorld(page, 2, 3)).toBe(true);
  await waitStill(page);
  const after = await page.evaluate(() => window.__game.party);
  expect(Math.max(Math.abs(after[1].x - 2), Math.abs(after[1].z - 3))).toBeLessThanOrEqual(1);
  expect(Math.max(Math.abs(after[0].x - after[1].x), Math.abs(after[0].z - after[1].z))).toBeLessThanOrEqual(3);
});

test('party combat: initiative interleaves the party and enemies; both members act; a downed member is skipped, not a loss', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, COMBAT_LEVEL);
  await recruitIntern(page);

  // Pick the fight: walk up to the Manager; combat triggers on arrival.
  await enterCombat(page);
  expect(await page.evaluate(() => window.__combat.party.length)).toBe(2);

  // ONE initiative order lists every combatant - both members and the Manager -
  // each with a rolled init and exactly one marked current.
  const order = await page.evaluate(() => window.__combat.order);
  expect(order.length).toBeGreaterThanOrEqual(3);
  expect(order.filter((o) => o.member).length).toBe(2); // both party members
  expect(order.some((o) => !o.member)).toBe(true); // the Manager
  expect(order.every((o) => Number.isFinite(o.init))).toBe(true);
  expect(order.filter((o) => o.current).length).toBe(1);

  // Hold Ctrl: rings under everyone, and hovering a body mid-fight glows it.
  await page.keyboard.down('Control');
  expect(await page.evaluate(() => window.__game.ctrlHeld)).toBe(true);
  const mp = await page.evaluate(() => {
    const en = window.__game.enemies.find((e) => e.alive);
    return window.__game.project3(en.px ?? en.x, 0.9, en.pz ?? en.z);
  });
  await page.mouse.move(mp.x, mp.y);
  await expect.poll(() => page.evaluate(() => window.__game.hoverKind), { timeout: 10_000 }).toBe('enemy');
  await page.keyboard.up('Control');

  // Both members take their OWN turn (no switching - each acts on its slot).
  // Cycle turns and collect who holds the floor.
  const acted = new Set();
  for (let i = 0; i < 14 && acted.size < 2; i++) {
    if (await page.evaluate(() => window.__game.gameOver || !window.__game.inCombat)) break;
    await waitForPlayerTurn(page).catch(() => {});
    const who = await page.evaluate(() => window.__combat.party.find((m) => m.active && m.hp > 0)?.name);
    if (who) acted.add(who);
    await page.click('#combat-end-turn').catch(() => {});
  }
  expect(acted.size).toBe(2); // the Drone and the Intern each got a turn

  // Party-wipe-only defeat: wound one member to 1 HP; when the Manager drops
  // them, the fight continues because the other still stands (their slot is
  // simply skipped when it comes around).
  // Force enemy hits so the wounded member reliably drops (attacks can miss now).
  await page.evaluate(() => { window.__combat.forceHit = true; });
  // Wound whoever the Manager is actually coming for, not slot 0 on principle.
  // `pickTarget` (combat.js:256) takes the NEAREST engageable member; HP only
  // breaks a tie at EQUAL distance. Pinning slot 0 to 1 HP and then waiting on
  // slot 0 therefore waits on where the two happened to end up standing - with
  // the Intern closer, the Manager swings at the Intern forever and slot 0
  // never drops. That is the 120s timeout on run 30410302575, green on retry.
  // `__game.party`, `__god.party.members` and `__combat.party` all index the
  // same roster order (combat.js:72), so one index reads across all three.
  await page.evaluate(() => {
    const en = window.__game.enemies.find((e) => e.alive);
    const nearest = window.__game.party
      .map((m, i) => ({ i, d: Math.max(Math.abs(m.x - en.x), Math.abs(m.z - en.z)) }))
      .filter(({ i }) => window.__combat.party[i].hp > 0)
      .sort((a, b) => a.d - b.d)[0].i;
    window.__god.party.members[nearest].sheet.hp = 1;
    window.__combat.refresh();
  });
  // Any member going down proves the rule this test is named for; which slot it
  // is decides nothing. Only the wounded one can drop - the other is at full HP.
  await expect.poll(async () => {
    if (await page.evaluate(() => window.__combat?.phase) === 'player') await page.click('#combat-end-turn').catch(() => {});
    return page.evaluate(() => window.__combat?.party.some((m) => m.hp === 0) || window.__game.gameOver);
  }, { timeout: 120_000 }).toBe(true);
  expect(await page.evaluate(() => window.__game.gameOver)).toBe(false); // one down is not a wipe
  expect(await page.evaluate(() => window.__game.inCombat)).toBe(true);
  // ...and the fight carries on one member lighter, their slot simply skipped.
  expect(await page.evaluate(() => window.__combat.party.filter((m) => m.hp > 0).length)).toBe(1);
});

// Both recruitables in one room - the roster fills to its cap of three.
const TRIO_LEVEL = {
  name: 'Full Roster Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', N: 'it-support', V: 'mail-room' },
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
        actions: ['attack', 'defend', 'paper-storm'],
      },
    }));
  });
  await page.reload();
  await page.click('#level-continue'); // the floor-select desk offers the saved run
  await page.waitForFunction(() => window.__game && window.__game.stats, null, { timeout: 90_000 });
  const party = await page.evaluate(() => window.__game.party);
  expect(party.length).toBe(1);
  expect(party[0].active).toBe(true);
  const stats = await page.evaluate(() => window.__game.stats);
  expect(stats.hp).toBe(9); // wounds carried over
  expect(stats.name).toBe('Office Drone'); // backfilled by the migration
  expect(stats.paper).toBe(0); // pre-pockets fields exist
});
