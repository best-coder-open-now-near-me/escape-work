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

  // HR posts the role on its own initiative turn. Drive the fight - ending
  // each of the player's turns lets the AI act - until two applicants have
  // materialized and joined the engaged enemies (cap: 2). Order-agnostic:
  // HR may even win initiative and post before the player's first turn.
  await expect.poll(async () => {
    if (await page.evaluate(() => window.__combat?.phase === 'player')) await page.click('#combat-end-turn').catch(() => {});
    return applicants(page);
  }, { timeout: 45_000 }).toBe(2);

  // A further round doesn't stack a fresh batch on top - the live cap holds.
  if (await page.evaluate(() => !!window.__combat)) {
    if (await page.evaluate(() => window.__combat?.phase === 'player')) await page.click('#combat-end-turn').catch(() => {});
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

  // Summon applicants onto the player's side (the M3 action drives this in
  // game; here the debug hook stands in). They're summons, not enemies - and
  // a couple of them so the Manager (which targets the nearest, lowest-HP
  // hostile) can't pick off a lone ally before any of them swings.
  await page.evaluate(() => window.__combat.summonAlly('applicant', 3));
  expect(await page.evaluate(() => window.__game.summons.length)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() =>
    (window.__combat.enemies || []).some((e) => e.name === 'Applicant'))).toBe(false);
  // Each ally takes a slot in the ONE initiative order (proof they'll act).
  expect(await page.evaluate(() =>
    window.__combat.order.some((o) => !o.member && o.team === 'player'))).toBe(true);

  const hp0 = await managerHp(page);
  expect(hp0).toBeGreaterThan(0);

  // Drive the fight: end each of the player's turns and let the AI act. On an
  // ally's own initiative turn it advances on the Manager and swings, so the
  // Manager is bloodied by an attacker that is NOT the player - proof the
  // allies fight for you. Keep the player standing (god top-up) so the fight
  // lasts long enough; the point is a NON-player attacker landing a blow.
  let hurt = false;
  for (let i = 0; i < 14 && !hurt; i++) {
    if (!(await page.evaluate(() => !!window.__combat))) break; // fight ended
    await page.evaluate(() => { if (window.__god.player) window.__god.player.hp = window.__god.player.maxHp; });
    if (await page.evaluate(() => window.__combat?.phase === 'player')) await page.click('#combat-end-turn').catch(() => {});
    await page.waitForTimeout(1600); // let the AI turns play out
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

test('the HR class posts the role, staffing your side of the fight', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, MELEE_ARENA, 'human-resources');
  await enterCombat(page);

  // Post the Role is on the bar, and no applicants have shown up yet.
  await expect(page.locator('#act-summon-applicants')).toBeVisible();
  expect(await page.evaluate(() => window.__game.summons.length)).toBe(0);

  // Click it: two applicants report for duty on YOUR side (summons, not enemies).
  await page.click('#act-summon-applicants');
  await expect.poll(() => page.evaluate(() => window.__game.summons.length),
    { timeout: 15_000 }).toBe(2);
  expect(await page.evaluate(() =>
    (window.__combat.enemies || []).some((e) => e.name === 'Applicant'))).toBe(false);
});
