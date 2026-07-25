// Opportunity attacks (TACTICS_PLAN M2): leaving a threatened tile costs you,
// and forced movement doesn't. Both assertions run inside the player's OWN
// turn, so the enemy's scheduled attack can't be mistaken for a reaction.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, clickWorld, endTurnUntilPlayer } from './helpers.js';

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
  // Break contact for the far corner. Still our turn - the Manager has not
  // been handed a turn to attack in, so any damage is the reaction.
  expect(await clickWorld(page, 1, 1)).toBe(true);
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
const COVER_ARENA = {
  name: 'Cover Lab',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  walls: ['V 6 3 1'], // partition on the WEST face of (6,3) - the side we shoot from
  map: [
    '#########',
    '#.@M..M.#',
    '#.......#',
    '#.....M.#',
    '#########',
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
  expect(pt.x).toBeLessThan(6);
  expect(Math.max(Math.abs(6 - pt.x), Math.abs(1 - pt.z))).toBeGreaterThan(1);
  expect(Math.max(Math.abs(6 - pt.x), Math.abs(3 - pt.z))).toBeGreaterThan(1);

  const open = await readAt(6, 1);   // no partition between us
  const behind = await readAt(6, 3); // partition on its near face
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
  // Let the Manager take a turn: attacking commits its LOGICAL facing toward
  // where we were standing. Before that it has no facing and cannot be
  // backstabbed at all - which is the rule we rely on below.
  await endTurnUntilPlayer(page);

  const readTag = async (x, z) => {
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(400);
      if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#act-attack');
      const fp = await page.evaluate(([wx, wz]) => window.__game.project(wx, wz), [x, z]);
      await page.mouse.move(fp.x, fp.y);
      await page.waitForTimeout(150);
      if (await page.evaluate(() => window.__combat.hoverHitChance) != null) break;
    }
    return (await page.locator('#combat-move-cost').textContent()) || '';
  };

  const foe = await foeOf(page);
  const pt = await page.evaluate(() => window.__game.playerTile);
  // It just swung at us, so we are squarely in its front arc.
  expect(await readTag(foe.x, foe.z)).not.toContain('from behind');

  // Step to the tile directly opposite, across its body. Still adjacent to it
  // the whole way, so nothing is provoked - but it puts us in its rear arc.
  const bx = foe.x + (foe.x - pt.x);
  const bz = foe.z + (foe.z - pt.z);
  if (await page.evaluate(() => window.__combat.armed)) await clickWorld(page, bx, bz); // lower it first
  expect(await clickWorld(page, bx, bz)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__game.playerTile),
    { timeout: 30_000 }).toEqual({ x: bx, z: bz });

  expect(await readTag(foe.x, foe.z)).toContain('from behind');
});

test('a shove does not provoke - forced movement is the safe disengage', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DISENGAGE_ARENA, 'office-drone');
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = true; });
  const before = await foeOf(page);

  // Shove it out of our reach. A shove into open floor deals no damage, so if
  // forced movement provoked, our own free swing would show up as HP loss.
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
  expect(after.x !== before.x || after.z !== before.z).toBe(true); // it did move
  expect(after.hp).toBe(before.hp); // and took nothing on the way out
});
