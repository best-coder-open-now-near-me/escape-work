// The AI's new beats (AI_PLAN M4/M5), in a browser. The unit suite pins what
// combat-ai DECIDES from plain values; these pin that the decisions reach the
// board - which is the half a pure-module test structurally cannot check, and
// the half that shipped broken once already (the world facade handed to
// aiShovePlan carried no `occupied` test, so every enemy turn threw).
//
// Each test asserts on `__combat.bout.beats` - the chosen-beat histogram M1
// built for exactly this. A beat that fires leaves a count; a beat that stops
// gating leaves the count at zero however healthy the damage numbers look.
import { test, expect } from '@playwright/test';
import {
  bootStash, enterCombat, waitForPlayerTurn, refillAp,
  clickWorld, combatState, endTurnUntilPlayer, stableProject,
} from './helpers.js';

const beats = (page) => page.evaluate(() => window.__combat?.bout?.beats ?? {});
// Doors sit on EDGES, so the only honest read of "is it open" is the live
// door table the game exposes rather than anything tile-shaped.
const doorsOpen = (page) =>
  page.evaluate(() => window.__game.doors.filter((d) => d.open).length);

// Work a door in combat. Two things make a bare ground click unreliable here:
// the pick can land on the player's own body when they are standing right
// beside the handle, and a floor point by a doorway deliberately stays a STEP
// unless you are already at the door - so a click that arrives a frame early
// walks you instead. Aim at the door mesh at handle height, and retry from
// wherever the previous attempt left us.
async function workDoor(page, mx, mz, want) {
  for (let i = 0; i < 4; i++) {
    if ((await doorsOpen(page)) === want) return true;
    await refillAp(page);
    const p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.95, z), [mx, mz]);
    if (p && p.x > 10 && p.x < 1270 && p.y > 10 && p.y < 790) await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(1200);
  }
  return (await doorsOpen(page)) === want;
}

// Hand the AI a few turns. Each end-turn runs every enemy's turn and returns
// when control comes back, so the assertions below read a settled board.
async function playRounds(page, n) {
  for (let i = 0; i < n; i++) {
    if (!(await page.evaluate(() => window.__game.inCombat))) return;
    await refillAp(page);
    await endTurnUntilPlayer(page).catch(() => {});
  }
}

// --- M5: the ranged kit ------------------------------------------------------

// The Manager opens the fight at arm's length; the Executive stands four tiles
// off with a clear line - inside ENGAGE_RADIUS (4) so he joins, outside anyone's
// reach so the swing is not on the table. Before M5 he would have walked in
// like everybody else.
const RANGE_HALL = {
  name: 'Range Hall',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager', E: 'executive' },
  map: [
    '#########',
    '#@M..E..#',
    '#########',
  ],
};

test('the Executive shoots from across the room instead of closing', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, RANGE_HALL, 'security'); // 20 hp: outlast two attackers
  await enterCombat(page);
  await waitForPlayerTurn(page);

  await playRounds(page, 3);

  const b = await beats(page);
  expect(b.shoot ?? 0,
    `the Executive never took the shoot beat (${JSON.stringify(await combatState(page))})`,
  ).toBeGreaterThan(0);
});

// --- M4: Pull Over, from the other side of the desk --------------------------

// A dead-end corridor with a partition across it. The player crouches on the
// tile the panel shields; the Manager, on the far side, can neither swing
// through it nor walk around - the only move that reaches over a barrier is
// the one this milestone gave him.
//
// Both halves of the staging are levers, and both are load-bearing. `fight()`
// opens combat where the bodies already stand, so the crouch is in place
// before anyone acts - a walk-in would trigger the fight mid-path and the
// crouch would never commit. The SEED pins initiative: a Manager who wins the
// roll and acts first is sealed, takes the break beat, and batters down the
// very partition the pull reaches over, which fails the test for a staging
// reason rather than a rule one.
const PULL_LAB = {
  name: 'Pull Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 3 1 1'], // between (2,1) and (3,1)
  // The Manager stands TWO tiles off, not one. Pull Over reaches REACH.PULL
  // (2.5), so he can still haul from there - and at two tiles the player can
  // walk to the crouch tile without adjacency opening the fight on its own,
  // which is what lets `fight()` decide the moment instead. (3,1) stays empty
  // so his route to a swing tile beside the player exists: that keeps him
  // UNSEALED, so the break beat is never gathered and cannot take the
  // partition down before the pull is tried.
  map: [
    '#######',
    '#@..M.#',
    '#######',
  ],
};

test('a crouched member gets hauled over their own cover', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, PULL_LAB, 'security', { seed: 7 });

  // Walk to the tile against the partition and tuck in, with no fight on.
  await page.click('#hotbar-act-take-cover');
  await stableProject(page, 2, 1).catch(() => {});
  await clickWorld(page, 2, 1);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile.x),
    { timeout: 60_000 }).toBe(2);

  // Now open the fight where everybody stands.
  expect(await page.evaluate(() => window.__god.fight()), 'the fight opened').toBe(true);
  await expect.poll(() => page.evaluate(() => window.__combat?.crouched?.length ?? 0),
    { timeout: 30_000 }).toBe(1);
  const crouch = await page.evaluate(() => window.__combat.crouched[0]);
  expect([crouch.x, crouch.z], 'crouched on the tile the partition shields').toEqual([2, 1]);

  await waitForPlayerTurn(page).catch(() => {});
  await playRounds(page, 3);

  const b = await beats(page);
  expect(b.pull ?? 0,
    `the Manager never pulled (${JSON.stringify(await combatState(page))})`,
  ).toBeGreaterThan(0);
});

// --- M4/A10: a shut door is openable, not breakable --------------------------

// Doors carry no HP pool by construction - they are deliberately not in the
// wall sets - so a unit sealed behind one has nothing to batter. Shut it on
// the Manager mid-fight and he has to work the handle, or the fight cannot
// end: that is the pinata this arm exists to prevent. The lever shuts the
// door because the player doing it needs an exact-tile click that a frame's
// drift turns back into an ordinary step.
const DOOR_LAB = {
  name: 'Door Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  doors: ['V 3 1'], // between (2,1) and (3,1)
  // The Manager stands ON a side of the door (3,1). That is the arm's own
  // precondition - `doorsBeside` answers for the tile you are standing on -
  // and it is the honest shape anyway: a coworker shut in works the handle
  // he is standing at, not one across the room.
  map: [
    '#######',
    '#@.M..#',
    '#######',
  ],
};

test('an enemy sealed by a closed door opens it', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DOOR_LAB, 'security', { seed: 11 });

  // Doors author CLOSED; open it so the Manager can join a fight at all
  // (canTakePart traces line of sight, and a shut door is the game's only
  // true sight blocker), then open the fight where everybody stands.
  const key = await page.evaluate(() => window.__god.doors[0].key);
  expect(await page.evaluate((k) => window.__god.setDoor(k, true), key)).toBe(true);
  // Open the fight and shut the door in the SAME tick. The engaged set is
  // chosen with the door open (canTakePart traces sight, and a shut door is
  // the only true blocker), and the seal has to land before anybody acts: the
  // Manager can win initiative, and a Manager who gets a turn first simply
  // walks through the doorway and the scenario never exists.
  expect(await page.evaluate((k) => {
    const opened = window.__god.fight();
    window.__god.setDoor(k, false);
    return opened;
  }, key), 'the fight opened').toBe(true);
  expect(await doorsOpen(page)).toBe(0);
  expect(await page.evaluate(() => window.__combat.enemies.length),
    'the Manager is in the fight').toBeGreaterThan(0);

  await playRounds(page, 3);

  expect(await doorsOpen(page),
    `the Manager never opened the door (${JSON.stringify(await combatState(page))})`,
  ).toBe(1);
});
