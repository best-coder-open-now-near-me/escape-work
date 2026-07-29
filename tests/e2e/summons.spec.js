// Summons, in bespoke arenas. Enemy HR posts the role and its applicants join
// the engaged enemies as AI. A player summon is the opposite: a temporary
// MEMBER you control - it takes its own initiative turn in PLAYER phase, with
// its own action bar - not an autopilot ally (SUMMON_PLAN.md).
import { test, expect } from '@playwright/test';
import { bootStash, clickWorld, enterCombat, clickAction, refillAp } from './helpers.js';

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

test('a player summon is a controllable member, outlives the fight, then times out', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, MELEE_ARENA, 'office-drone');
  await enterCombat(page);

  // Summon applicants onto the player's side (the HR action drives this in
  // game; the debug hook stands in). Three of them, so the Manager can't pick
  // off a lone one before its turn comes up. They're summons, not enemies.
  // The third argument is the assignment: 12 turns, spent by their own combat
  // turns and - once the fight is over - by the world clock.
  await page.evaluate(() => window.__combat.summonAlly('applicant', 3, 12));
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
      await expect(page.locator('#hotbar-act-resume-slap')).toBeVisible(); // the summon's own bar
    } else if (cur.phase === 'player') {
      await page.click('#combat-end-turn').catch(() => {}); // a real member - pass the turn
      await page.waitForTimeout(400);
    } else {
      await page.waitForTimeout(500); // an AI enemy is acting
    }
  }
  expect(controlled).toBe(true);

  // End the fight (force-kill the remaining coworkers). Victory no longer
  // evaporates your summons: an applicant with assignment left walks out of the
  // fight with you and is still standing on the floor afterwards.
  await page.evaluate(() => window.__god.enemies.forEach((e) => e.alive && e.die()));
  await expect.poll(() => page.evaluate(() => window.__game.inCombat),
    { timeout: 20_000 }).toBe(false);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__game.summons.length)).toBeGreaterThan(0);

  // What DOES end them is the assignment running out. Out of combat the world
  // clock spends it a turn at a time, so they see themselves out on their own.
  //
  // That clock is FRAME-bound, not wall-clock-bound: PlayCanvas clamps dt to
  // maxDeltaTime (0.1s), so a 1.6s out-of-combat turn takes at least 16
  // frames however long they take to arrive. Under CI's software GL that is
  // seconds per turn, and a 12-turn assignment outran the wait here - this
  // test's whole point is that the assignment expires, not how many frames
  // the runner managed. timeScale multiplies the CLAMPED dt, so the same
  // turns pass in the same frames' worth of scaled time.
  await page.evaluate(() => { window.__god.timeScale = 8; });
  await expect.poll(() => page.evaluate(() => window.__game.summons.length),
    { timeout: 90_000 }).toBe(0);
  await page.evaluate(() => { window.__god.timeScale = 1; });
});

test('the HR class posts the role AT a spot you pick', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, MELEE_ARENA, 'human-resources');
  await enterCombat(page);

  // Post the Role is on the bar, and no applicants have shown up yet.
  await expect(page.locator('#hotbar-act-summon-applicants')).toBeVisible();
  expect(await page.evaluate(() => window.__game.summons.length)).toBe(0);

  // A full turn: the walk-up into this fight can bleed AP (see refillAp), and
  // this test is about WHERE a summon lands, not about the AP economy.
  await refillAp(page);
  // A summon is TARGETED: arming it picks the action, not the spot. The press
  // must not spend a thing until you say where they report.
  await clickAction(page, 'summon-applicants');
  await expect.poll(() => page.evaluate(() => window.__combat?.armed),
    { timeout: 10_000 }).toBe('summon-applicants');
  expect(await page.evaluate(() => window.__game.summons.length)).toBe(0);

  // Choose a spot several tiles off, so "where I clicked" and "beside the
  // summoner" are different answers. Read the arena from live state rather
  // than pinning coordinates the walk-up decides.
  const target = await page.evaluate(() => {
    const g = window.__game;
    const me = g.playerTile;
    const foes = g.enemies.filter((e) => e.alive);
    const free = (x, z) => x >= 1 && x <= 9 && z >= 1 && z <= 5
      && !(x === me.x && z === me.z)
      && !foes.some((e) => e.x === x && e.z === z);
    // Prefer a tile a real distance away - 3, then 2 if the room is tight.
    for (const d of [3, 2]) {
      for (const [dx, dz] of [[-d, 0], [d, 0], [0, d], [0, -d], [-d, d], [-d, -d]]) {
        if (free(me.x + dx, me.z + dz)) return { x: me.x + dx, z: me.z + dz };
      }
    }
    return null;
  });
  expect(target).not.toBeNull();

  const p = await page.evaluate(([x, z]) => window.__game.project(x, z), [target.x, target.z]);
  await page.mouse.click(p.x, p.y);

  // ONE applicant reports for duty on YOUR side (summons, not enemies) - a post
  // is a hire, not a batch (ACTIONS['summon-applicants'].count).
  await expect.poll(() => page.evaluate(() => window.__game.summons.length),
    { timeout: 15_000 }).toBe(1);
  expect(await page.evaluate(() =>
    (window.__combat.enemies || []).some((e) => e.name === 'Applicant'))).toBe(false);

  // ...and they report WHERE YOU CLICKED: the drop point itself, not wherever
  // the summoner is standing.
  const placed = await page.evaluate(() => window.__game.summons.map((s) => ({ x: s.x, z: s.z })));
  expect(placed).toEqual([{ x: target.x, z: target.z }]);
});

// Nobody to fight - the point is that the power works with no fight on.
const QUIET_ARENA = {
  name: 'Quiet Office',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player' },
  map: [
    '###########',
    '#.........#',
    '#.........#',
    '#....@....#',
    '#.........#',
    '#.........#',
    '###########',
  ],
};

test('Post the Role is on the out-of-combat bar, and posts where you click', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, QUIET_ARENA, 'human-resources');

  // The whole kit is listed out of combat, not just the slot we are about to
  // press. HR's kit is exactly these three (classes.js: summon-applicants,
  // performance-review, coffee) - this used to ask for #hotbar-act-defend,
  // which no HR has ever had. Deflect Blame belongs to the Office Drone, so
  // the assertion could only ever have failed; it sat in the tail of the suite
  // that CI's maxFailures cap kept it from ever reaching.
  await expect(page.locator('#hotbar-act-summon-applicants')).toBeVisible();
  await expect(page.locator('#hotbar-act-performance-review')).toBeVisible();
  await expect(page.locator('#hotbar-act-coffee')).toBeVisible();
  expect(await page.evaluate(() => window.__game.summons.length)).toBe(0);

  await page.click('#hotbar-act-summon-applicants');
  expect(await page.evaluate(() => window.__game.armed)).toBe('summon-applicants');

  // A spot two tiles off: "where I clicked" and "beside the summoner" are
  // different answers, and it is inside the action's range of 5.
  const me = await page.evaluate(() => window.__game.playerTile);
  const target = { x: me.x + 2, z: me.z };
  expect(await clickWorld(page, target.x, target.z)).toBe(true);

  await expect.poll(() => page.evaluate(() => window.__game.summons.length),
    { timeout: 15_000 }).toBe(1);
  expect(await page.evaluate(() => window.__game.summons.map((s) => ({ x: s.x, z: s.z }))))
    .toEqual([target]);
  // No fight was started by posting, and the slot disarmed itself: one click,
  // one post.
  expect(await page.evaluate(() => window.__game.inCombat)).toBe(false);
  expect(await page.evaluate(() => window.__game.armed)).toBe(null);

  // The assignment is on the world clock out here, so the temp shows itself out
  // rather than following you around the floor forever. (timeScale for the same
  // reason as the test above: the clock is frame-bound.)
  await page.evaluate(() => { window.__god.timeScale = 8; });
  await expect.poll(() => page.evaluate(() => window.__game.summons.length),
    { timeout: 90_000 }).toBe(0);
  await page.evaluate(() => { window.__god.timeScale = 1; });
});

// A long room, so a tile can be genuinely out of the action's range of 5 while
// still having a clear line to it - the range rule on its own, nothing else.
const LONG_ARENA = {
  name: 'Long Office',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '################',
    '#..............#',
    '#..@.M.........#',
    '#..............#',
    '################',
  ],
};

test('an out-of-range spot is refused, and the posting is not spent', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, LONG_ARENA, 'human-resources');
  await enterCombat(page);
  // As above: start from a known budget so a 4 AP posting is affordable. The
  // assertion below is that a REFUSED posting spends nothing - which needs a
  // stable `apBefore`, not a full one.
  await refillAp(page);

  await clickAction(page, 'summon-applicants');
  await expect.poll(() => page.evaluate(() => window.__combat?.armed),
    { timeout: 10_000 }).toBe('summon-applicants');
  const apBefore = await page.evaluate(() => window.__combat.ap);

  // The NEAREST tile past range 5 - far enough to be refused, close enough to
  // still be on screen at this camera angle.
  const far = await page.evaluate(() => {
    const g = window.__game;
    const me = g.playerTile;
    let best = null;
    for (let z = 1; z <= 3; z++) {
      for (let x = 1; x <= 14; x++) {
        const d = Math.max(Math.abs(x - me.x), Math.abs(z - me.z));
        if (d <= 5) continue;
        const p = g.project(x, z);
        if (!p || p.behind) continue;
        if (p.x < 5 || p.y < 5 || p.x > window.innerWidth - 5 || p.y > window.innerHeight - 5) continue;
        if (!best || d < best.d) best = { x, z, d, sx: p.x, sy: p.y };
      }
    }
    return best;
  });
  expect(far, 'an out-of-range tile is visible to click').not.toBeNull();

  await page.mouse.click(far.sx, far.sy);
  await page.waitForTimeout(500);

  // Nobody showed up, no AP burned, and the action stays armed so you can just
  // click somewhere sensible instead of re-arming it.
  expect(await page.evaluate(() => window.__game.summons.length)).toBe(0);
  expect(await page.evaluate(() => window.__combat.ap)).toBe(apBefore);
  expect(await page.evaluate(() => window.__combat.armed)).toBe('summon-applicants');
});
