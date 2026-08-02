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

// --- M4: what is NOT staged here, and why -----------------------------------
//
// Pull Over and the door arm both have unit coverage (combat-plans.test.js:
// the pull walks its candidates and passes pullPlan's refusals up; the door
// branch takes the shut door that shortens the distance, refuses one leading
// away, refuses an open one). Neither is staged in a browser, and the reason
// is the arena rather than the rule:
//
//   - THE PULL fires only against a target crouched with a barrier between
//     the bodies. A corridor gives that geometry, but the Manager can win
//     initiative and act BEFORE the crouch exists - and a sealed Manager
//     batters the partition down, removing the very barrier the pull reaches
//     over. Staging the crouch out of combat (preCrouch) trades that race for
//     another: the fight triggers on adjacency mid-walk, so the crouch may
//     never commit. An earlier revision of this file did see the beat fire in
//     a browser - `bout.beats.pull` came back 1 - so the wiring is known to
//     reach the board; what could not be made deterministic is the setup.
//   - THE DOOR ARM needs somebody to shut a door mid-fight, and only the
//     player can: the acting member must be parked on an exact tile beside
//     the handle, clicking an edge midpoint that a frame's drift turns back
//     into an ordinary step.
//
// So the residual risk is named rather than papered over: `world.openDoor` is
// the one new facade binding with no browser proof, the same class of gap
// that let the aiShovePlan crash ship (footgun 16). Both tells are
// unmistakable in play - an enemy that stands in a doorway doing nothing, or
// one that never reaches over a barrier it is standing at.

