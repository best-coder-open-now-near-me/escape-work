// Summons, in bespoke arenas. Enemy HR posts the role and its applicants join
// the engaged enemies as AI. A player summon is the opposite: a temporary
// MEMBER you control - it takes its own initiative turn in PLAYER phase, with
// its own action bar - not an autopilot ally (SUMMON_PLAN.md).
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

// The current initiative slot: its name, whose side, and whether it's a
// controllable member. Null between states.
const currentSlot = (page) => page.evaluate(() => {
  const c = window.__combat;
  if (!c) return null;
  const o = c.order.find((s) => s.current);
  return o ? { name: o.name, member: o.member, team: o.team, phase: c.phase } : null;
});

test('a player summon is a controllable member, then vanishes when the fight ends', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, MELEE_ARENA, 'office-drone');
  await enterCombat(page);

  // Summon applicants onto the player's side (the HR action drives this in
  // game; the debug hook stands in). Three of them, so the Manager can't pick
  // off a lone one before its turn comes up. They're summons, not enemies.
  await page.evaluate(() => window.__combat.summonAlly('applicant', 3));
  expect(await page.evaluate(() => window.__game.summons.length)).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(() =>
    (window.__combat.enemies || []).some((e) => e.name === 'Applicant'))).toBe(false);
  // Each applicant takes a PLAYER-team MEMBER slot in the one initiative order
  // (member: true) - a controllable unit, not an AI ally (member: false).
  expect(await page.evaluate(() => window.__combat.order.some(
    (o) => o.name === 'Applicant' && o.member && o.team === 'player'))).toBe(true);

  // Drive the order: end each real member's turn, wait through the AI's, and
  // catch an applicant's OWN turn. Landing on it in PLAYER phase, with its
  // Résumé Slap on the bar, is the proof that YOU control the summon.
  let controlled = false;
  for (let i = 0; i < 24 && !controlled; i++) {
    if (!(await page.evaluate(() => !!window.__combat))) break; // fight ended
    await page.evaluate(() => { if (window.__god.player) window.__god.player.hp = window.__god.player.maxHp; });
    const cur = await currentSlot(page);
    if (!cur) { await page.waitForTimeout(400); continue; }
    if (cur.phase === 'player' && cur.name === 'Applicant') {
      controlled = true;
      await expect(page.locator('#act-resume-slap')).toBeVisible(); // the summon's own bar
    } else if (cur.phase === 'player') {
      await page.click('#combat-end-turn').catch(() => {}); // a real member - pass the turn
      await page.waitForTimeout(400);
    } else {
      await page.waitForTimeout(500); // an AI enemy is acting
    }
  }
  expect(controlled).toBe(true);

  // End the fight (force-kill the remaining coworkers): summons are a combat
  // effect, so victory despawns them - no lingering applicants on the floor.
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
