// Opportunity attacks (TACTICS_PLAN M2): leaving a threatened tile costs you,
// and forced movement doesn't. Both assertions run inside the player's OWN
// turn, so the enemy's scheduled attack can't be mistaken for a reaction.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, clickWorld, endTurnUntilPlayer, waitForPlayerTurn, clickAction, withWorldStill } from './helpers.js';

// An open room with space to run: the player engages the Manager, then has
// somewhere far enough to break contact.
const DISENGAGE_ARENA = {
  name: 'Disengage Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '############',
    '#..........#',
    '#...@M.....#',
    '#..........#',
    '############',
  ],
};

const foeOf = (page) => page.evaluate(() => {
  const e = window.__combat.enemies.find((f) => f.alive);
  return e ? { x: e.x, z: e.z, hp: e.hp } : null;
});

const reachOf = (page) => page.evaluate(() => {
  const p = window.__game.playerTile;
  const m = window.__combat.enemies.find((e) => e.alive);
  return Math.max(Math.abs(p.x - m.x), Math.abs(p.z - m.z));
});

test('walking out of an enemy reach provokes a free swing', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);
  // Pin the roll so the reaction lands, and top the player up so the only
  // damage that can possibly appear is the opportunity attack.
  await page.evaluate(() => {
    window.__combat.forceHit = true;
    const s = window.__god.player;
    s.hp = s.maxHp;
  });
  expect(await reachOf(page)).toBeLessThanOrEqual(1); // it threatens our tile

  const hp0 = await page.evaluate(() => window.__god.player.hp);
  const from = await page.evaluate(() => window.__game.playerTile);
  // Break contact for the far corner. Still our turn - the Manager has not
  // been handed a turn to attack in, so any damage is the reaction.
  //
  // Confirm we actually LEFT before waiting on the reaction. clickWorld only
  // promises the point was on screen - not that the click reached the world
  // and started a walk - so when this failed on CI it failed as "hp never
  // dropped", which cannot tell "the reaction did not fire" apart from "we
  // never disengaged in the first place". Those are now two distinct
  // failures, and a click that did not take is simply aimed again.
  let moved = false;
  for (let i = 0; i < 4 && !moved; i++) {
    expect(await clickWorld(page, 1, 1)).toBe(true);
    try {
      await expect.poll(() => page.evaluate(() => window.__game.playerTile),
        { timeout: 8_000 }).not.toEqual(from);
      moved = true;
    } catch { /* the click never became a walk - aim again */ }
  }
  expect(moved, 'never broke contact, so nothing could have provoked').toBe(true);
  await expect.poll(() => page.evaluate(() => window.__god.player.hp),
    { timeout: 30_000 }).toBeLessThan(hp0);
  expect(await reachOf(page)).toBeGreaterThan(1); // we did get out
});

test('circling inside its reach provokes nothing', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);
  await page.evaluate(() => {
    window.__combat.forceHit = true;
    const s = window.__god.player;
    s.hp = s.maxHp;
  });
  const foe = await foeOf(page);
  const hp0 = await page.evaluate(() => window.__god.player.hp);
  // Step to another tile that is STILL adjacent to the Manager - the threat
  // never lapses, so no reaction fires (the threat-set rule, not raw adjacency).
  const sidestep = [[foe.x, foe.z - 1], [foe.x, foe.z + 1], [foe.x - 1, foe.z + 1], [foe.x - 1, foe.z - 1]];
  let moved = false;
  for (const [tx, tz] of sidestep) {
    if (await page.evaluate(([x, z]) => {
      const p = window.__game.playerTile;
      return p.x === x && p.z === z;
    }, [tx, tz])) continue;
    if (!(await clickWorld(page, tx, tz))) continue;
    await page.waitForTimeout(1500);
    if (await reachOf(page) <= 1) { moved = true; break; }
  }
  expect(moved).toBe(true); // we relocated but stayed in its face
  expect(await page.evaluate(() => window.__god.player.hp)).toBe(hp0); // untouched
});

// Two Managers at the SAME distance from the player, one with a partition on
// the face pointing back at the player. Equal range and equal enemy type mean
// cover is the only variable between the two hover readings.
// The two test foes sit at Chebyshev 6 from the player - beyond main.js's
// ENGAGE_RADIUS (4), so they never join the fight, never take a turn, and
// never advance off the tiles this test hovers. (Non-engaged enemies also
// hold still: wander is paused during combat.) They stay hoverable because
// enemyAtPoint scans every live enemy, and visible because partitions block
// bodies, not sight.
// Both test foes are WALLED INTO one-tile alcoves. That matters twice over:
// enemies wander freely until a fight starts, so nothing else keeps them on
// the tiles this test hovers; and wall CELLS pin them without granting cover,
// because cover is an EDGE test (grid.stepOpen ignores cell solidity). So the
// only cover in this arena is the one partition, on the west face of (8,3) -
// the side the player shoots from. The foe at (8,1) is pinned the same way
// with no partition anywhere on it, giving a clean like-for-like pair.
//
// Both sit at Chebyshev 6 from the player, beyond main.js's ENGAGE_RADIUS (4),
// so they never join the fight and never take a turn either. They stay
// hoverable because enemyAtPoint scans every live enemy, and unreachable
// alcoves keep enterCombat's helper aimed at the Manager that starts the fight.
const COVER_ARENA = {
  name: 'Cover Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 8 3 1'], // the ONLY partition: west face of (8,3)
  map: [
    '############',
    '#.@M...#M#.#',
    '#.......#..#',
    '#.......M#.#',
    '############',
  ],
};

test('a partition gives the defender cover against a ranged attacker', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, COVER_ARENA, 'office-drone');
  await enterCombat(page); // the adjacent Manager starts the fight; we barely move

  // Arm the attack and hover a specific tile, returning the honest to-hit the
  // roll would use plus the tag the player actually reads.
  const readAt = async (x, z) => {
    let c = null;
    for (let i = 0; i < 8 && c == null; i++) {
      await page.waitForTimeout(400);
      if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
      const fp = await page.evaluate(([wx, wz]) => window.__game.project(wx, wz), [x, z]);
      await page.mouse.move(fp.x, fp.y);
      await page.waitForTimeout(150);
      c = await page.evaluate(() => window.__combat.hoverHitChance);
    }
    return { chance: c, tag: (await page.locator('#combat-move-cost').textContent()) || '' };
  };

  // Both foes must still be at range for cover to be in play at all.
  const pt = await page.evaluate(() => window.__game.playerTile);
  expect(pt.x).toBeLessThan(8);
  expect(Math.max(Math.abs(8 - pt.x), Math.abs(1 - pt.z))).toBeGreaterThan(1);
  expect(Math.max(Math.abs(8 - pt.x), Math.abs(3 - pt.z))).toBeGreaterThan(1);
  // Both test foes must still be standing where they were placed - if either
  // joined the fight and advanced, this run cannot compare like with like.
  expect(await page.evaluate(() => window.__game.enemies
    .filter((e) => e.alive && e.x === 8 && (e.z === 1 || e.z === 3)).length)).toBe(2);

  // The like-with-like check above runs ONCE, before either read - so it
  // cannot see the board move BETWEEN them, which is where the two numbers
  // stop being comparable. COVER_ARENA also seats a third Manager beside the
  // player (it is the one that opens the fight) and nothing pins where it
  // wanders: in the line for one read and not the other, it adds a cover term
  // of its own and the gap is no longer just the partition. That matches the
  // shape of the CI failure - 0.05, where cover failing to apply at all would
  // have read 0.00. So hold the invariant ACROSS both reads, and re-take them
  // if anything shifted underneath.
  const boardNow = () => page.evaluate(() => ({
    me: window.__game.playerTile,
    foes: window.__game.enemies.filter((e) => e.alive).map((e) => `${e.x},${e.z}`).sort(),
  }));
  let open = null;
  let behind = null;
  for (let i = 0; i < 3; i++) {
    const before = JSON.stringify(await boardNow());
    open = await readAt(8, 1);   // no partition between us
    behind = await readAt(8, 3); // partition on its near face
    if (JSON.stringify(await boardNow()) === before) break;
  }
  expect(typeof open.chance).toBe('number');
  expect(typeof behind.chance).toBe('number');
  // Same range, same enemy - the whole gap is the cover term (HIT.COVER_DODGE).
  expect(open.chance - behind.chance).toBeCloseTo(0.20, 5);
  expect(behind.tag).toContain('in cover'); // and the player can SEE why
  expect(open.tag).not.toContain('in cover');
});

test('striking a foe from behind its committed facing is a backstab', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);

  // Choose which side to stand on BEFORE it commits a facing. The Manager
  // wanders before the fight, and DISENGAGE_ARENA has only three floor rows -
  // so a Manager on the top or bottom row has its whole rear arc inside a
  // wall, and there is nowhere to stand behind it. Approaching along the X
  // axis (and flipping if it is against the west wall) guarantees the tile
  // behind it is open floor.
  const foe0 = await foeOf(page);
  const side = foe0.x <= 3 ? 1 : -1;
  const standAt = [foe0.x + side, foe0.z];
  if (await page.evaluate(() => window.__combat.armed)) {
    const p0 = await page.evaluate(() => window.__game.project(window.__game.playerTile.x, window.__game.playerTile.z));
    await page.mouse.click(p0.x, p0.y, { button: 'right' });
  }
  await clickWorld(page, standAt[0], standAt[1]);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile), { timeout: 30_000 })
    .toEqual({ x: standAt[0], z: standAt[1] });

  // Let the Manager take a turn: attacking commits its LOGICAL facing toward
  // where we are standing. Before that it has no facing and cannot be
  // backstabbed at all - which is the rule we rely on below.
  await endTurnUntilPlayer(page);

  const readTag = async (x, z) => {
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(400);
      if (await page.evaluate(() => window.__combat.armed) !== 'attack') {
        // NEVER click a disabled button: Playwright waits for it to become
        // enabled, so walking here on low AP would hang to the test timeout
        // instead of reporting the real problem.
        expect(await page.locator('#act-attack').isEnabled(),
          'attack must be affordable to read a to-hit').toBe(true);
        await clickAction(page, 'attack');
      }
      const fp = await page.evaluate(([wx, wz]) => window.__game.project(wx, wz), [x, z]);
      await page.mouse.move(fp.x, fp.y);
      await page.waitForTimeout(150);
      if (await page.evaluate(() => window.__combat.hoverHitChance) != null) break;
    }
    return (await page.locator('#combat-move-cost').textContent()) || '';
  };

  const foe = await foeOf(page);
  // It just swung at us, so we are squarely in its front arc.
  expect(await readTag(foe.x, foe.z)).not.toContain('from behind');

  // Straight through to the far side along the axis we approached on - open
  // floor by construction, and adjacent to the Manager the whole way, so
  // nothing is provoked.
  const bx = foe.x - side;
  const bz = foe.z;
  // Reading the tag left the attack armed, and a LEFT click no longer lowers
  // it (it reports an invalid target) - so back out the way the game now
  // expects, with a right click, before walking.
  if (await page.evaluate(() => window.__combat.armed)) {
    const here = await page.evaluate(() => window.__game.project(window.__game.playerTile.x, window.__game.playerTile.z));
    await page.mouse.click(here.x, here.y, { button: 'right' });
    await expect.poll(() => page.evaluate(() => window.__combat.armed)).toBe(null);
  }
  expect(await clickWorld(page, bx, bz)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile), { timeout: 30_000 })
    .toEqual({ x: bx, z: bz });
  // Walking around a body costs AP, and an unaffordable attack button cannot
  // be armed to read a to-hit from. Top it back up: what is under test here is
  // the positional modifier, not the AP economy. Crucially this does NOT end
  // the turn - the Manager must not act again, or it would re-face us and we
  // would no longer be behind it.
  await page.evaluate(() => { window.__combat.ap = window.__god.player.maxAp; });

  expect(await readTag(foe.x, foe.z)).toContain('from behind');
});

test('a shove does not provoke - forced movement is the safe disengage', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  const before = await foeOf(page);

  // Assert on the ROLL, not on geometry. The Manager wanders before the fight
  // starts, so it can end up backed against a wall, where a shove legally
  // slams it for 2 and moves nobody - an outcome a position/HP check misreads
  // as a failure. An opportunity attack, by contrast, ALWAYS rolls to hit, and
  // combat records every roll on lastRoll. So: whatever the shove does, if
  // lastRoll is untouched afterwards, nothing swung.
  const rollBefore = await page.evaluate(() => JSON.stringify(window.__combat.lastRoll ?? null));

  // Shove it out of our reach.
  let shoved = false;
  for (let i = 0; i < 6 && !shoved; i++) {
    await page.waitForTimeout(700);
    const ap0 = await page.evaluate(() => window.__combat.ap);
    if (await page.evaluate(() => window.__combat.armed) !== 'shove') await page.click('#act-shove');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [before.x, before.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(400);
    const ap1 = await page.evaluate(() => window.__combat.ap);
    if (Math.abs(ap1 - (ap0 - 2)) < 0.01) shoved = true;
  }
  expect(shoved).toBe(true);

  const after = await foeOf(page);
  // It left our reach one way or the other - shoved clear, or slammed into
  // something solid (which stuns it). Either is forced movement.
  const movedOrSlammed = (after.x !== before.x || after.z !== before.z)
    || after.hp === before.hp - 2;
  expect(movedOrSlammed).toBe(true);
  // The point of the test: no reaction rolled on the way out.
  expect(await page.evaluate(() => JSON.stringify(window.__combat.lastRoll ?? null)))
    .toBe(rollBefore);
});

// --- reach as a distance (TACTICS_PLAN revision, M5) -------------------------

// Two tiles of clear floor between the two bodies: bare hands cannot cross it,
// the Reach Extender can. The whole point of reach being data.
const REACH_LAB = {
  name: 'Reach Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '##########',
    '#........#',
    '#..@.M...#',
    '#........#',
    '##########',
  ],
};

// Did the armed action land on the foe WITHOUT the player closing the distance?
//
// MOVEMENT IS CHECKED FIRST, and against the CONTINUOUS position, which is the
// whole subtlety: clicking a distant foe with a melee action walks up and then
// strikes on arrival, so a walk-up also ends with the foe's HP down. Reading HP
// first would score that as a reach hit and make `moved: false` vacuous in the
// positive test too.
async function swingInPlace(page, actionId) {
  const start = await page.evaluate(() => ({
    hp: window.__combat.enemies.find((e) => e.alive)?.hp,
    pos: window.__game.playerPos,
  }));
  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  for (let i = 0; i < 3; i++) {
    if (await page.evaluate(() => window.__combat.armed) !== actionId) {
      await page.click(`#act-${actionId}`);
    }
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(900); // long enough for a walk-up to have happened
    const now = await page.evaluate(() => ({
      hp: window.__combat.enemies.find((e) => e.alive)?.hp,
      pos: window.__game.playerPos,
    }));
    const moved = Math.hypot(now.pos.x - start.pos.x, now.pos.z - start.pos.z) > 0.15;
    const hurt = now.hp != null && now.hp < start.hp;
    if (moved) return { hit: hurt, moved: true };   // closed the distance - not reach
    if (hurt) return { hit: true, moved: false };   // struck from where it stood
  }
  return { hit: false, moved: false };
}

test('a long weapon strikes from a tile bare hands cannot cross', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, REACH_LAB, 'office-drone');
  // Equip the extender out of combat, and clear the Drone's starting trinket so
  // nothing else is in play. WITH THE WORLD HELD STILL: the Manager two tiles
  // away is 'red' aggression and walks at you from the first frame, and on a
  // slow runner it arrives before the click - a mid-fight gear swap is refused,
  // so this read as "the equip did nothing". (It went red on main exactly that
  // way; the probe said `inCombat: true`, "Not mid-fight - swap your kit on your
  // own time".) The fight this test wants is the one enterCombat starts below,
  // on purpose, after the staging is done.
  await withWorldStill(page, async () => {
    await page.evaluate(() => {
      const s = window.__god.player;
      s.equipped.weapon = null;
      s.inventory = ['reach-grabber'];
    });
    // The equip flow equipment.spec.js established: open the pockets, WAIT for
    // the row to exist, then click once. An earlier version of this test retried
    // the click with the error swallowed, which turned "the row was not there
    // yet" into four silent no-ops and a confusing timeout.
    await page.keyboard.press('i');
    await expect(page.locator('#inventory-panel')).toBeVisible();
    await expect(page.locator('#inv-equip-0')).toBeVisible();
    // Named so a future failure says which of the two it was, rather than
    // leaving the next reader to rediscover the mid-fight refusal.
    expect(await page.evaluate(() => window.__game.inCombat),
      'staging must happen out of combat - gear does not swap mid-fight').toBe(false);
    await page.click('#inv-equip-0');
    await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon),
      { timeout: 20_000 }).toBe('reach-grabber');
    await page.keyboard.press('i');
  });
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  await waitForPlayerTurn(page);

  // Engaging walks the player up, so stage the geometry explicitly: park them
  // 1.9 tile-units off the Manager's BODY - outside REACH.DEFAULT (1.5) and
  // inside the extender's 2.2. The gap is asserted below, so a staging slip
  // fails the test rather than quietly weakening it.
  await page.evaluate(() => {
    const a = window.__god.playerActor;
    const m = window.__game.enemies.find((e) => e.alive);
    const y = a.entity.getPosition().y;
    const tx = m.px - 1.9;
    a.path = null;
    a.slideTo = null;
    a.entity.setPosition(tx, y, m.pz);
    a.x = Math.round(tx);
    a.z = Math.round(m.pz);
  });
  await page.waitForTimeout(400);
  const gap = await page.evaluate(() => {
    const m = window.__game.enemies.find((e) => e.alive);
    const p = window.__game.playerPos;
    return Math.hypot(p.x - m.px, p.z - m.pz);
  });
  expect(gap).toBeGreaterThan(1.5); // bare hands could not make this swing
  expect(gap).toBeLessThan(2.2);    // ...the extender can

  await expect(page.locator('#act-grabber-swipe')).toBeVisible();
  const res = await swingInPlace(page, 'grabber-swipe');
  expect(res.hit).toBe(true);   // it landed
  expect(res.moved).toBe(false); // ...without closing the distance first
});

// The control for the test above. Without it, "the extender reached" proves
// nothing: it could be that ANY swing crosses that gap.
test('bare hands cannot make the swing the extender makes - they walk up first', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, REACH_LAB, 'office-drone');
  await page.evaluate(() => {
    const s = window.__god.player;
    s.equipped.weapon = null; // fists: REACH.DEFAULT and nothing more
  });
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  await waitForPlayerTurn(page);

  await page.evaluate(() => {
    const a = window.__god.playerActor;
    const m = window.__game.enemies.find((e) => e.alive);
    const y = a.entity.getPosition().y;
    const tx = m.px - 1.9;
    a.path = null;
    a.slideTo = null;
    a.entity.setPosition(tx, y, m.pz);
    a.x = Math.round(tx);
    a.z = Math.round(m.pz);
  });
  await page.waitForTimeout(400);
  const gap = await page.evaluate(() => {
    const m = window.__game.enemies.find((e) => e.alive);
    const p = window.__game.playerPos;
    return Math.hypot(p.x - m.px, p.z - m.pz);
  });
  expect(gap).toBeGreaterThan(1.5); // the same gap the extender cleared

  // The claim is about REACH, not about whether damage ever happens: clicking a
  // distant foe with fists walks up and then strikes, so damage does eventually
  // land. What separates the two weapons is that fists had to move at all.
  const res = await swingInPlace(page, 'punch');
  expect(res.moved).toBe(true);
});
