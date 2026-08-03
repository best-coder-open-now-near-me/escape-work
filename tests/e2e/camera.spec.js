// The free camera: WASD/arrow panning detaches the rig from the follow target
// (BG3/DOS2 style), and the recenter verbs bring it home - Home, a double-click
// on the bottom-left profile card, a party-bar card, or a combat-strip row.
// Asserts ride __game.cameraFocus (the rig's look-at point) and
// __game.cameraFree (is it detached?) - cameraPos moves with pitch and zoom
// too, which is noise to these specs.
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld, enterCombat, waitForPlayerTurn } from './helpers.js';

const LEVEL = {
  name: 'Camera Test Floor',
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

// The combat arena: one Manager, far enough that his 2-tile wander leash
// never starts the fight on its own - enterCombat clicks him deliberately.
const COMBAT_LEVEL = {
  name: 'Camera Combat Floor',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '################',
    '#..............#',
    '#.@........M...#',
    '#..............#',
    '#............>.#',
    '################',
  ],
};

const focusOf = (page) => page.evaluate(() => window.__game.cameraFocus);
const freeNow = (page) => page.evaluate(() => window.__game.cameraFree);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Poll until the rig's focus settles within `r` of the body you are STEERING.
//
// `steeredPos`, not `playerPos`, and the difference is the bug this spec
// missed for months: out of a fight they are the same body, and in a
// one-member fight they are still the same body - so an assert against
// `playerPos` passed while the follow loop read the leader instead of the
// acting member. The rule the spec states is now the rule the game runs.
async function expectFocusOnSteered(page, r = 0.8) {
  await expect.poll(async () => {
    const f = await focusOf(page);
    const p = await page.evaluate(() => window.__game.steeredPos);
    return dist(f, p);
  }, { timeout: 15_000 }).toBeLessThan(r);
}

test('WASD and arrows pan the camera free; Home and the profile card recenter it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, LEVEL);

  // A held D drags the view away from the player and detaches the follow.
  const before = await focusOf(page);
  expect(await freeNow(page)).toBe(false);
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  const panned = await focusOf(page);
  expect(dist(panned, before), 'holding D should move the camera focus').toBeGreaterThan(1);
  expect(await freeNow(page)).toBe(true);

  // Home puts it back on the player and re-attaches the follow.
  await page.keyboard.press('Home');
  expect(await freeNow(page)).toBe(false);
  await expectFocusOnSteered(page);

  // The arrows pan too (BG3 binds both).
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowLeft');
  const arrowed = await focusOf(page);
  const player = await page.evaluate(() => window.__game.playerPos);
  expect(dist(arrowed, player), 'holding ArrowLeft should move the camera focus').toBeGreaterThan(1);
  expect(await freeNow(page)).toBe(true);

  // Double-clicking the bottom-left profile card is the mouse's Home key.
  await page.dblclick('#stats');
  expect(await freeNow(page)).toBe(false);
  await expectFocusOnSteered(page);
});

test('double-clicking a party-bar card centers the camera on that member', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, LEVEL);

  // Recruit the intern (adjacent, so the dialogue opens without a walk).
  expect(await clickWorld(page, 3, 2)).toBe(true);
  await page.waitForFunction(() => window.__game.dialogueOpen, null, { timeout: 20_000 });
  await page.click('button.dialogue-option:has-text("Come with me")');
  await expect.poll(() => page.evaluate(() => window.__game.party.length)).toBe(2);
  const close = page.locator('button.dialogue-option:has-text("Stick close")');
  if (await close.count()) await close.click().catch(() => {});

  // Pan away, then double-click the intern's card: the first click of the
  // pair hands him the lead, the second brings the camera to him.
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  expect(await freeNow(page)).toBe(true);
  await page.dblclick('#party-slot-1');
  await expect.poll(() => page.evaluate(() => window.__game.party[1].active)).toBe(true);
  expect(await freeNow(page)).toBe(false);
  await expectFocusOnSteered(page); // the steered body re-keys to the new leader
});

test('double-clicking a combat-strip row looks at that combatant', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, COMBAT_LEVEL);
  await enterCombat(page);
  await waitForPlayerTurn(page);

  // The enemy's initiative row: the camera glides to his body and stays
  // detached - the rig doesn't follow enemies.
  const order = await page.evaluate(() => window.__combat.order);
  const enemyRow = order.findIndex((s) => s.team !== 'player');
  expect(enemyRow).toBeGreaterThanOrEqual(0);
  await page.dblclick(`#combat-strip [data-slot="${enemyRow}"]`);
  expect(await freeNow(page)).toBe(true);
  await expect.poll(async () => {
    const f = await focusOf(page);
    const en = (await page.evaluate(() => window.__game.enemies))[0];
    return dist(f, { x: en.px ?? en.x, z: en.pz ?? en.z });
  }, { timeout: 15_000 }).toBeLessThan(1);

  // The acting member's row re-attaches the follow (it IS the followed body).
  const memberRow = order.findIndex((s) => s.team === 'player');
  await page.dblclick(`#combat-strip [data-slot="${memberRow}"]`);
  expect(await freeNow(page)).toBe(false);
  await expectFocusOnSteered(page);
});

// The case the three specs above structurally cannot reach: a fight where the
// body you STEER is not the leader. That only happens with two members whose
// initiative slots land consecutively (a shared turn), which is why the old
// one-member arena asserted a true negative for so long - `actingActor` and
// `player` were the same object, so a follow loop reading the wrong one still
// framed the right body.
//
// The shared turn is a dice outcome (d20 + speed, three combatants), so the
// fight is SEEDED. `seed: 4` rolls the Office Drone 24, IT Support 13 and the
// Manager 10 - measured, not derived - which puts both party slots first and
// consecutive: a shared turn, opened on the leader, with the teammate still
// there to steer to.
//
// It used to `test.skip` when the roll gave no shared turn. That is worse than
// it sounds: an unlucky roll made this leg report GREEN while proving nothing,
// and there is no signal anywhere that says how often it actually ran. Seeds 1,
// 3 and 5 all produce no shared turn, so it was not rare. The seeded-initiative
// lever exists now (helpers.bootStash takes one), so the skip becomes an
// assert.
const PARTY_COMBAT_LEVEL = {
  name: 'Camera Party Combat Floor',
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

test('steering a teammate mid-fight takes the camera with it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, PARTY_COMBAT_LEVEL, 'office-drone', { seed: 4 });

  expect(await clickWorld(page, 3, 2)).toBe(true);
  await page.waitForFunction(() => window.__game.dialogueOpen, null, { timeout: 20_000 });
  await page.click('button.dialogue-option:has-text("Come with me")');
  await expect.poll(() => page.evaluate(() => window.__game.party.length)).toBe(2);
  const close = page.locator('button.dialogue-option:has-text("Stick close")');
  if (await close.count()) await close.click().catch(() => {});

  await enterCombat(page);
  await waitForPlayerTurn(page);

  // Hand the wheel to the OTHER member of the open shared turn, through the
  // same route the party bar and Tab take (combat.steerMember, not
  // switchLeader - steering never touches the out-of-combat leader).
  // Pick the member who is NOT the leader by POSITION, not by `party.active`:
  // in combat `makeActive` re-keys `party.active` to whoever holds the floor,
  // so "the inactive one" is often the leader themselves - steering to them
  // succeeds and proves nothing. `playerPos` is the leader's body by
  // definition, so the body that isn't standing there is the teammate.
  const steered = await page.evaluate(() => {
    const lead = window.__game.playerPos;
    const i = window.__game.party.findIndex((m) => Math.hypot(m.x - lead.x, m.z - lead.z) > 0.5);
    return i >= 0 ? window.__god.switchTo(i) : false;
  });
  expect(steered,
    'seed 4 opens on a shared leader+teammate turn, so there must be somebody to steer to')
    .toBe(true);

  // The LEADER did not change - that is the whole point. `player` still names
  // the member who led the party in, so the two positions disagree, and the
  // camera has to be on the steered one. Before the fix it framed the leader.
  const [lead, steer] = await page.evaluate(() => [window.__game.playerPos, window.__game.steeredPos]);
  expect(dist(lead, steer), 'the steered body must not be the leader').toBeGreaterThan(0.5);
  await expectFocusOnSteered(page);

  // ...and Home RE-ATTACHES on them rather than detaching to where they stand.
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  expect(await freeNow(page)).toBe(true);
  await page.keyboard.press('Home');
  expect(await freeNow(page), 'Home must re-attach the follow, not pan to a point').toBe(false);
  await expectFocusOnSteered(page);
});
