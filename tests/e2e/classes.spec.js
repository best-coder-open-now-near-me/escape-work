// Class-specific kit: IT Support's granted kick and self-targeted purging
// reboot, the Mail Room's cone attack with its paper aftermath, and Security's
// Detain - which is now a ROOT that deals no damage (POWERS_PLAN M2), not the
// "attack that also stuns" it used to be.
import { test, expect } from '@playwright/test';
import { bootAndPick, bootStash, clickWorld, enterCombat, waitForPlayerTurn, waitStill, stableProject, onScreen, clickAction } from './helpers.js';

test('IT Support: kick joins the bar, reboot self-casts as a purge', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'it-support');
  await enterCombat(page);
  await expect(page.locator('#hotbar-act-kick')).toBeVisible(); // talent-granted

  // A stray projected click during combat entry can have pre-armed (or a
  // first click can toggle OFF) an action - ensure reboot ends up armed.
  for (let i = 0; i < 3 && await page.evaluate(() => window.__combat.armed) !== 'reboot'; i++) {
    await clickAction(page, 'reboot');
  }
  expect(await page.evaluate(() => window.__combat.armed)).toBe('reboot');

  // Give the purge something to purge. Reboot is a PURE purge now, and a purge
  // that would land on a clean sheet is refused before the commit rather than
  // billed for nothing (powers.js emptyPayload: "Nothing to clear - they are
  // running clean."). This test asserts the self-cast spends its AP, so it has
  // to hand the verb real work first - without it the click is a legitimate
  // no-op, the retry loop never sees AP move, and the failure surfaces as a
  // five-minute timeout instead of "you asked it to clear nothing".
  //
  // `bleed` specifically: it is a step-clock status, so it cannot tick away
  // underneath the loop while the camera settles between attempts.
  await page.evaluate(() => window.__combat.applyStatus('bleed', 4));

  const ap0 = await page.evaluate(() => window.__combat.ap);
  // Read the cost from the registry rather than pinning a number here: action
  // costs get re-priced (MOVEMENT_PLAN M5 moved every attack 3 -> 2), and this
  // test is about the self-cast spending EXACTLY its cost, not about what that
  // cost happens to be this month.
  const cost = await page.evaluate(() => window.__god.actionAp('reboot'));
  // Click your own tile: the reboot turns YOU off and on again. The purge's
  // self-cast is tile-based (tile === your tile), so settle first - a click
  // taken while the camera still eases can project a tile off and lower the
  // action instead - then aim at the TILE CENTRE (what the check compares),
  // not the continuous body point. Re-arm and retry on a miss.
  let spent = false;
  for (let i = 0; i < 6 && !spent; i++) {
    // Re-arm only if reboot is armable (a prior mis-click could have walked
    // and spent AP; never click a disabled button - that would hang).
    if (await page.evaluate(() => window.__combat.armed) !== 'reboot') {
      if (await page.locator('#hotbar-act-reboot').getAttribute('data-affordable') === 'false') break;
      await clickAction(page, 'reboot');
    }
    // Aim at the tile CENTRE (what the purge check compares), and wait for
    // the camera to actually settle so the projection lands true - not just
    // for the player to stop.
    const tile = await page.evaluate(() => window.__game.playerTile);
    const p = await stableProject(page, tile.x, tile.z);
    await page.mouse.click(p.x, p.y);
    // Compare in NODE - `ap0` doesn't exist in the browser page context.
    const ap = await page.evaluate(() => window.__combat.ap).catch(() => null);
    spent = ap != null && Math.abs(ap - (ap0 - cost)) < 0.01;
  }
  expect(spent).toBe(true); // reboot self-cast consumed exactly its AP
  expect(await page.evaluate(() => window.__combat.armed)).toBe(null);
  // ...and it was a PURGE, which is what the test is named for - the AP check
  // alone would pass on any self-targeted verb that costs the same.
  const left = await page.evaluate(() =>
    (window.__combat.party.find((m) => m.active)?.statuses ?? []).map((s) => s.id));
  expect(left).not.toContain('bleed');
});

test('Mail Room: Bulk Mail cones damage and leave paper drifts', async ({ page }) => {
  test.setTimeout(300_000);
  await bootAndPick(page, 'mail-room');
  await enterCombat(page);
  await expect(page.locator('#hotbar-act-mail-cone')).toBeVisible();

  // Count nearby paper BEFORE the cone - a fight near the IT room's painted
  // drifts must not false-positive the aftermath check.
  const paperNear = () => page.evaluate(() => {
    const pt = window.__game.playerTile;
    let n = 0;
    for (let z = pt.z - 5; z <= pt.z + 5; z++) {
      for (let x = pt.x - 5; x <= pt.x + 5; x++) {
        if (window.__game.surfaceAt(x, z) === 'paper') n += 1;
      }
    }
    return n;
  });
  const paperBefore = await paperNear();
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  // The cone rolls to hit per target now (HIT_PLAN) - pin it so the fired cone
  // reliably damages this foe.
  await page.evaluate(() => { window.__combat.forceHit = true; });
  await clickAction(page, 'mail-cone');
  // The condition the sleep here was guessing at, asked directly.
  const aim = await stableProject(page, foe.x, foe.z).catch(() => null);
  if (aim) await page.mouse.move(aim.x, aim.y);
  await expect.poll(() => page.evaluate(() => window.__combat.aimPoint),
    { timeout: 10_000 }).not.toBe(null);
  expect(await page.evaluate(() => window.__combat.aimPaint.count),
    'a cone should paint its exact fine-cell wedge').toBeGreaterThan(0);
  expect(await clickWorld(page, foe.x, foe.z)).toBe(true);
  await expect.poll(() => page.evaluate(
    ([x, z, hp]) => {
      const e = window.__combat.enemies.find((f) => f.x === x && f.z === z);
      return !e || !e.alive || e.hp < hp;
    },
    [foe.x, foe.z, foe.hp],
  ), { timeout: 30_000 }).toBe(true);
  expect(await page.evaluate(() => window.__combat.armed)).toBe(null); // fired, lowered

  // The wedge's bare floor is carpeted with fresh paper.
  expect(await paperNear()).toBeGreaterThan(paperBefore);
});

const COLOURED_CARPET_ARENA = {
  name: 'Paperwork Lab',
  tiles: { '#': 'wall', 'm': 'meeting-floor' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '#########',
    '#mmmmmmm#',
    '#m@mmmMm#',
    '#mmmmmmm#',
    '#########',
  ],
};

const QUIET_PAPER_ARENA = {
  name: 'Quiet Paperwork Lab',
  tiles: { '#': 'wall', 'm': 'meeting-floor' },
  actors: { '@': 'player' },
  map: [
    '#########',
    '#mmmmmmm#',
    '#m@mmmmm#',
    '#mmmmmmm#',
    '#########',
  ],
};

const TPS_CROSSING_ARENA = {
  name: 'TPS Crossing Lab',
  tiles: { '#': 'wall', 'm': 'meeting-floor' },
  actors: { '@': 'player', 'H': 'hr' },
  map: [
    '###############',
    '#mmmmmmmmmmmmm#',
    '#@mmmmmmmmmmHm#',
    '#mmmmmmmmmmmmm#',
    '###############',
  ],
};

test('Office Drone: TPS Form Storm uses the same fine-cell aim outside combat', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, QUIET_PAPER_ARENA, 'office-drone', { seed: 4 });
  await page.click('#hotbar-act-paper-storm');
  expect(await page.evaluate(() => window.__game.armed)).toBe('paper-storm');

  const p = await stableProject(page, 4.2, 2.1);
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__game.aimPaint.count),
    { timeout: 10_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__game.aimPaint.cells.some(
    ([x, z]) => !Number.isInteger(x) || !Number.isInteger(z),
  )), 'the exploration preview exposes fine cells, not movement tiles').toBe(true);

  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__game.armed),
    { timeout: 10_000 }).toBe(null);
  await expect.poll(() => page.evaluate(() => window.__game.surfaceAt(4.2, 2.1)),
    { timeout: 10_000 }).toBe('paper');
});

test('Office Drone: TPS Form Storm preview and click share continuous range', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, QUIET_PAPER_ARENA, 'office-drone', { seed: 4 });
  await page.evaluate(() => {
    const actor = window.__god.playerActor;
    const y = actor.entity.getPosition().y;
    actor.clearPath();
    actor.slideTo = null;
    actor.entity.setPosition(2.2, y, 2);
    actor.x = 2;
    actor.z = 2;
  });
  await page.click('#hotbar-act-paper-storm');

  // Both points round to ordinary movement tiles; power range is measured
  // from the live body to the exact aim point instead. The prominent mask must
  // carry the same verdict the click will enforce.
  const tooFar = await stableProject(page, 7.4, 2);
  await page.mouse.move(tooFar.x, tooFar.y);
  await expect.poll(() => page.evaluate(() => window.__game.aimPaint.tone),
    { timeout: 10_000 }).toBe('invalid');
  await page.mouse.click(tooFar.x, tooFar.y);
  expect(await page.evaluate(() => window.__game.armed)).toBe('paper-storm');

  const inRange = await stableProject(page, 7.1, 2);
  await page.mouse.move(inRange.x, inRange.y);
  await expect.poll(() => page.evaluate(() => window.__game.aimPaint.tone),
    { timeout: 10_000 }).toBe('valid');
  await page.mouse.click(inRange.x, inRange.y);
  await expect.poll(() => page.evaluate(() => window.__game.armed),
    { timeout: 10_000 }).toBe(null);
});

test('Office Drone: TPS Form Storm keeps its zone aim and lands above coloured carpet', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, COLOURED_CARPET_ARENA, 'office-drone', { seed: 4 });
  expect(await page.evaluate(() => window.__god.fight())).toBe(true);
  await waitForPlayerTurn(page);
  await clickAction(page, 'paper-storm');

  const p = await stableProject(page, 4, 2);
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__combat.aimPoint),
    { timeout: 10_000 }).not.toBe(null);
  expect(await page.evaluate(() => window.__combat.aimPaint.count),
    'a ground zone paints its exact fine-cell placement mask').toBeGreaterThan(0);

  expect(await clickWorld(page, 4, 2)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    let paper = 0;
    for (let z = 1; z <= 3; z++) {
      for (let x = 3; x <= 5; x++) if (window.__game.surfaceAt(x, z) === 'paper') paper += 1;
    }
    return paper;
  }), { timeout: 10_000 }).toBeGreaterThan(0);
});

test('Office Drone: TPS Form Storm damages HR crossing its right edge', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, TPS_CROSSING_ARENA, 'office-drone', { seed: 4 });
  await page.evaluate(() => window.__game.debugStillEnemies());
  await page.click('#hotbar-act-paper-storm');

  const p = await stableProject(page, 6, 2);
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => page.evaluate(() => window.__game.aimPaint.count),
    { timeout: 10_000 }).toBeGreaterThan(0);
  // Pick the easternmost painted fine cell. Its neighbour to the right is
  // guaranteed bare, giving HR the direction that used to report the shared
  // boundary as the cell it was LEAVING and silently skip the entry damage.
  const edge = await page.evaluate(() => window.__game.aimPaint.cells.reduce(
    (best, [x, z]) => (!best || x > best.x ? { x, z } : best), null));

  await page.mouse.click(p.x, p.y);
  await expect.poll(() => page.evaluate(
    ({ x, z }) => window.__game.surfaceAt(x, z), edge,
  ), { timeout: 10_000 }).toBe('paper');
  expect(await page.evaluate(
    ({ x, z }) => window.__game.surfaceAt(x + 0.51, z), edge,
  )).toBe(null);

  const hpBefore = await page.evaluate(({ x, z }) => {
    const hr = window.__god.enemies.find((enemy) => enemy.alive);
    const fromX = x + 0.51;
    hr.clearPath();
    const y = hr.entity.getPosition().y;
    hr.entity.setPosition(fromX, y, z);
    hr.x = Math.round(fromX);
    hr.z = Math.round(z);
    hr.wanderTimer = Infinity;
    hr.setPath([[fromX, z], [x, z]]);
    return hr.hp;
  }, edge);

  await expect.poll(() => page.evaluate(() => window.__game.enemies[0].hp),
    { timeout: 10_000 }).toBeLessThan(hpBefore);
});

// Just you and one Manager, two tiles apart in an open room - the same shape
// the other precision specs use. Level 1's floor is too loose for a projected
// click on a wandering coworker to be reliable.
const GUARD_ARENA = {
  name: 'Guard Post',
  tiles: { '#': 'wall', '.': 'floor', '>': 'exit' },
  actors: { '@': 'player', 'M': 'manager' },
  map: [
    '#########',
    '#.......#',
    '#.@.M..>#',
    '#.......#',
    '#########',
  ],
};

test('Security: Detain is available as an out-of-combat opener', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, GUARD_ARENA, 'security', { seed: 4 });
  await page.evaluate(() => window.__game.debugStillEnemies());
  await page.click('#hotbar-act-detain');
  expect(await page.evaluate(() => window.__game.armed)).toBe('detain');

  const foe = await page.evaluate(() => window.__game.enemies.find((e) => e.alive));
  expect(await clickWorld(page, foe.x, foe.z)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.inCombat),
    { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__combat?.usesLeft.detain),
    { timeout: 30_000 }).toBe(1);
});

test('Security: Detain roots without damaging, and the guard wears the cop rig', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, GUARD_ARENA, 'security');
  // The class actually boots: its own sheet, its own rig, its own bar.
  expect(await page.evaluate(() => window.__game.stats.className)).toBe('Security');
  expect(await page.evaluate(() => window.__game.stats.maxHp)).toBe(26);

  await enterCombat(page);
  await expect(page.locator('#hotbar-act-detain')).toBeVisible();
  await expect(page.locator('#hotbar-act-stand-post')).toBeVisible();
  await expect(page.locator('#hotbar-act-stand-post')).toBeVisible();

  await page.evaluate(() => { window.__combat.forceHit = true; });
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  expect(foe).toBeTruthy();
  // Track the foe by IDENTITY, not by the tile it stood on when the fight
  // opened. GUARD_ARENA holds exactly one coworker, so "the living enemy" is
  // unambiguous - and a lookup pinned to an opening tile quietly starts
  // describing the floor the moment they take a step, after which every click
  // is aimed where they used to be.
  const foeNow = () => page.evaluate(() => window.__combat.enemies.find((e) => e.alive) ?? null);

  for (let i = 0; i < 6; i++) {
    const cur = await foeNow();
    if (cur && cur.statuses.some((s) => s.id === 'detained')) break;
    // Settle on the PLAYER, not the foe: that fixes the whole projection,
    // enemies included, and unlike a settle aimed at the target it cannot be
    // satisfied by the target coming to rest somewhere new. The aim is still
    // re-read below, after every await, for the reason written there.
    const pp = await page.evaluate(() => window.__game.playerPos);
    await stableProject(page, pp.x, pp.z).catch(() => {});
    if (!(await page.evaluate(() => window.__combat?.phase === 'player'))) continue;
    // Closing the distance spends AP, which can leave the 3 AP Detain
    // unaffordable and its button disabled. This spec is about the root, not
    // the AP economy - top the pool up the way forceHit pins the roll. Uses
    // too: Detain is rationed, and six attempts outlast its two.
    await page.evaluate(() => {
      window.__combat.ap = window.__combat.maxAp;
      window.__combat.usesLeft.detain = 2;
    });
    if (await page.evaluate(() => window.__combat?.armed) !== 'detain') {
      if (!(await page.locator('#hotbar-act-detain').isVisible())) break;
      await page.click('#hotbar-act-detain');
    }
    // Aim at where they are NOW. Everything above this point is an await - the
    // settle wait, the phase read, the AP top-up, arming the verb - and a
    // coworker in an open room can take a step inside any of them. Observed
    // once as "Invalid target." six times over, the shape a click landing on
    // empty floor takes.
    const at = await foeNow();
    if (!at) break;
    const p = await page.evaluate(([x, z]) => window.__game.project3(x, 0.9, z), [at.x, at.z]);
    if (!onScreen(p)) continue;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(700);
  }
  const after = await foeNow();
  expect(after, 'the coworker to still be on the board to have been rooted').toBeTruthy();
  // The root lands...
  expect(after.statuses.some((s) => s.id === 'detained')).toBe(true);
  // ...and it deals NO damage. That is the control verb's design rule
  // (POWERS_PLAN #3), and it is the whole difference between the new Detain
  // and the "attack that also stuns" it replaced - which was converging on the
  // same power as the shove's wall-slam and the Manager's Delegate.
  expect(after.hp).toBe(foe.hp);
  // A root is not a stun: they keep their turn, they just cannot leave.
  expect(after.statuses.some((s) => s.id === 'stunned')).toBe(false);
});
