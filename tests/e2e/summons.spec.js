// Enemy HR's summon power, in a bespoke arena: hand HR the round and it posts
// the role - applicants materialize and join the engaged enemies, capped
// (SUMMON_PLAN.md milestone 1). The player-side summon and its ally phase land
// in later milestones with their own specs.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat } from './helpers.js';

// Just you and one HR Rep, two tiles apart, in an open room with plenty of
// free floor for applicants to spawn onto. No other coworkers, so enterCombat
// engages HR and combat opens against HR alone.
const SUMMON_ARENA = {
  name: 'Summon Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', 'H': 'hr' },
  map: [
    '###########',
    '#.........#',
    '#.........#',
    '#...@.H...#',
    '#.........#',
    '#.........#',
    '###########',
  ],
};

// Living applicants among the engaged enemies (combat exposes engaged as
// __combat.enemies).
const applicants = (page) => page.evaluate(() =>
  (window.__combat?.enemies || []).filter((e) => e.name === 'Applicant' && e.alive).length);

test('HR summons applicants that join the fight as enemies, capped', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, SUMMON_ARENA, 'office-drone');
  await enterCombat(page);

  // Combat opened against HR alone - no applicants yet.
  expect(await applicants(page)).toBe(0);

  // Hand the round to the enemies: HR's first act is to post the role.
  await page.click('#combat-end-turn');

  // Two applicants materialize and join the engaged enemies (cap: 2).
  await expect.poll(() => applicants(page), { timeout: 30_000 }).toBe(2);

  // A further round doesn't stack a fresh batch on top - the live cap holds.
  // (Guarded: if the player has already fallen, combat is over and there's
  // nothing left to check.)
  if (await page.evaluate(() => !!window.__combat)) {
    await expect.poll(() => page.evaluate(() => window.__combat?.phase),
      { timeout: 20_000 }).toBe('player');
    await page.click('#combat-end-turn').catch(() => {});
    await page.waitForTimeout(1500);
    expect(await applicants(page)).toBeLessThanOrEqual(2);
  }
});
