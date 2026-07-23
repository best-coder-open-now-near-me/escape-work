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

// Just you and one Manager (straight to battle), open room. enterCombat walks
// you adjacent and the fight opens against the Manager alone.
const MELEE_ARENA = {
  name: 'Ally Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '###########',
    '#.........#',
    '#.........#',
    '#...@.M...#',
    '#.........#',
    '#.........#',
    '###########',
  ],
};

const managerHp = (page) => page.evaluate(() => {
  const m = (window.__combat?.enemies || []).find((e) => e.name === 'The Manager' && e.alive);
  return m ? m.hp : null;
});

test('a player-summoned ally fights for you, then vanishes when the fight ends', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, MELEE_ARENA, 'office-drone');
  await enterCombat(page);

  // Summon one applicant onto the player's side (the M3 action drives this in
  // game; here the debug hook stands in). It's a summon, not an enemy.
  await page.evaluate(() => window.__combat.summonAlly('applicant', 1));
  expect(await page.evaluate(() => window.__game.summons.length)).toBe(1);
  expect(await page.evaluate(() =>
    (window.__combat.enemies || []).some((e) => e.name === 'Applicant'))).toBe(false);

  const hp0 = await managerHp(page);
  expect(hp0).toBeGreaterThan(0);

  // Hand off the round repeatedly: on the allies phase the summon advances on
  // the Manager and swings. Within a couple of rounds the Manager is bloodied
  // by an attacker that is NOT the player - proof the ally fights for you.
  let hurt = false;
  for (let i = 0; i < 5 && !hurt; i++) {
    if (!(await page.evaluate(() => window.__combat?.phase === 'player'))) {
      await expect.poll(() => page.evaluate(() => window.__combat?.phase || 'gone'),
        { timeout: 20_000 }).not.toBe('enemies');
    }
    if (!(await page.evaluate(() => !!window.__combat))) break; // fight ended
    await page.click('#combat-end-turn').catch(() => {});
    await page.waitForTimeout(1800); // let allies + enemies phases play out
    const hp = await managerHp(page);
    if (hp !== null && hp < hp0) hurt = true;
  }
  expect(hurt).toBe(true);

  // End the fight (force-kill the remaining coworkers): the summon is a combat
  // effect, so victory despawns it - no lingering applicants on the floor.
  await page.evaluate(() => window.__god.enemies.forEach((e) => e.alive && e.die()));
  await expect.poll(() => page.evaluate(() => window.__game.summons.length),
    { timeout: 20_000 }).toBe(0);
});
