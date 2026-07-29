// New status content the framework makes possible (STATUS_PLAN M4): a shove
// into a wall STUNS (the target loses its next turn), and BURNING ticks a dot
// at the owner's turn. Both drive real combat state, asserted through __combat.
import { test, expect } from '@playwright/test';
import { bootStash, enterCombat, endTurnUntilPlayer } from './helpers.js';

// Player and Manager already adjacent, the Manager backed against a wall so a
// shove away from the player slams it into something solid.
const STUN_CORNER = {
  name: 'Stun Corner',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '#####',
    '#.@M#',
    '#####',
  ],
};

const manager = (page) => page.evaluate(() =>
  window.__combat.enemies.find((e) => e.name === 'The Manager'));
const managerStunned = (page) => page.evaluate(() =>
  !!window.__combat.enemies.find((e) => e.name === 'The Manager')?.statuses.some((s) => s.id === 'stunned'));
const managerCredit = (page) => page.evaluate(() =>
  window.__combat.enemies.find((e) => e.name === 'The Manager')
    ?.statuses.find((s) => s.id === 'training-credit')?.left ?? 0);

// Arm Shove and drive it into the Manager until the shove actually fires (its
// 2 AP is spent), slamming the wall-backed Manager into something solid.
// Returns whether it went off inside the attempt budget.
async function shoveManager(page, foe) {
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(700);
    const ap0 = await page.evaluate(() => window.__combat.ap);
    if (await page.evaluate(() => window.__combat.armed) !== 'shove') await page.click('#hotbar-act-shove');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(300);
    const ap1 = await page.evaluate(() => window.__combat.ap);
    if (Math.abs(ap1 - (ap0 - 2)) < 0.01) return true;
  }
  return false;
}

test('a shove into a wall stuns the target, and the stun costs it a turn', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, STUN_CORNER, 'office-drone');
  await enterCombat(page);
  // Enemies can't land a hit for the duration - isolates the stun's effect on
  // the player's HP (a stunned Manager that acted would deal damage).
  await page.evaluate(() => { window.__combat.forceHit = false; });

  const foe = await manager(page);
  expect(await shoveManager(page, foe)).toBe(true);
  expect(await managerStunned(page)).toBe(true); // the slam stunned it

  // Cycle a full round: the Manager's turn comes and goes without an attack
  // (skipTurn), and the stun clears as it burns that turn.
  const hp0 = await page.evaluate(() => window.__god.player.hp);
  await endTurnUntilPlayer(page);
  expect(await managerStunned(page)).toBe(false);        // the skip consumed the stun
  expect(await page.evaluate(() => window.__god.player.hp)).toBe(hp0); // it never got to swing
});

// The anti-chain window in a real fight (SHADOWBANE_NOTES.md §3): the shove is
// the game's one unrationed stun, so shoving the same wall twice is the exact
// stun-lock the window exists to break.
test('a second shove cannot re-stun through the anti-chain window', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, STUN_CORNER, 'office-drone');
  await enterCombat(page);
  await page.evaluate(() => { window.__combat.forceHit = false; });

  const foe = await manager(page);
  expect(await shoveManager(page, foe)).toBe(true);
  expect(await managerStunned(page)).toBe(true);
  expect(await managerCredit(page)).toBe(3); // a 1-turn stun bought a 3-turn window

  // Shove again the same turn, while both the stun and its window are live. The
  // slam still lands (damage is never gated) - the stun is what gets turned away.
  expect(await shoveManager(page, foe)).toBe(true);
  expect(await managerCredit(page)).toBe(3);  // not refreshed, not extended
  // ...and the player is TOLD why, rather than left watching nothing happen.
  await expect(page.locator('#combat-log')).toContainText('training this quarter');

  // And it is still a single stun on the far side of the round - one skipped
  // turn, not two.
  await endTurnUntilPlayer(page);
  expect(await managerStunned(page)).toBe(false);
  expect(await managerCredit(page)).toBe(2); // window ticking down, stuns still barred
});

// A plain duel arena for the burning dot.
const DUEL_ARENA = {
  name: 'Burn Arena',
  tiles: { '#': 'wall', '.': 'floor' },
  actors: { '@': 'player', M: 'manager' },
  map: [
    '###########',
    '#.........#',
    '#...@.M...#',
    '#.........#',
    '###########',
  ],
};

test('burning ticks a dot at the start of the owner turn', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);
  // Isolate the dot: enemies miss, so the only damage is the fire.
  await page.evaluate(() => {
    window.__combat.forceHit = false;
    const s = window.__god.player;
    s.hp = s.maxHp;
    window.__combat.applyStatus('burning', 2); // catch fire (dot 2, two turns)
  });
  const hp0 = await page.evaluate(() => window.__god.player.hp);
  // Come back around to the member's turn: the dot fires at turn start.
  await endTurnUntilPlayer(page);
  const hp1 = await page.evaluate(() => window.__god.player.hp);
  expect(hp1).toBe(hp0 - 2); // one 2-point burning tick, nothing else
  // Still on fire for one more turn.
  expect(await page.evaluate(() =>
    window.__combat.party.find((m) => m.active)?.statuses.some((s) => s.id === 'burning'))).toBe(true);
});

test('blinded drops the attacker to-hit via accMod', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  await enterCombat(page);

  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  // Arm the attack and hover the foe to read the honest to-hit chance.
  const readChance = async () => {
    let c = null;
    for (let i = 0; i < 8 && c == null; i++) {
      await page.waitForTimeout(400);
      if (await page.evaluate(() => window.__combat.armed) !== 'attack') await page.click('#hotbar-act-attack');
      const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
      await page.mouse.move(fp.x, fp.y);
      await page.waitForTimeout(150);
      c = await page.evaluate(() => window.__combat.hoverHitChance);
    }
    return c;
  };
  const base = await readChance();
  expect(typeof base).toBe('number');

  // Blind the attacker: their accuracy drops by the status's accMod (0.3).
  await page.evaluate(() => window.__combat.applyStatus('blinded', 2));
  const blind = await readChance();
  expect(base - blind).toBeCloseTo(0.3, 5); // the whole accMod, both ends unclamped here
});

test('a weapon on-hit proc applies its status - the red stapler flings gum', async ({ page }) => {
  test.setTimeout(300_000);
  await bootStash(page, DUEL_ARENA, 'office-drone');
  // Equip the red stapler via the pockets before the fight (equip is out-of-combat).
  await page.evaluate(() => { window.__god.player.inventory = ['red-stapler']; });
  await page.keyboard.press('i');
  await expect(page.locator('#inventory-panel')).toBeVisible();
  await page.click('#inv-equip-0');
  await expect.poll(() => page.evaluate(() => window.__game.stats.equipped.weapon)).toBe('red-stapler');
  await page.keyboard.press('i'); // close the pockets
  await enterCombat(page);
  // Pin the hit and the proc so the swing lands and always gums.
  await page.evaluate(() => { window.__combat.forceHit = true; window.__combat.forceProc = true; });
  // The stapler's swing is on the combat bar (fail fast if the wiring is off).
  await expect(page.locator('#hotbar-act-staple-jab')).toBeVisible();

  const foe = await page.evaluate(() => window.__combat.enemies.find((e) => e.alive));
  // Read through whichever surface is still standing. A forced hit that KILLS
  // the Manager ends the fight, and window.__combat is torn down with it - so
  // the read meant to observe the gum threw "Cannot read properties of
  // undefined (reading 'enemies')" instead, and the real answer was sitting on
  // the body the whole time. __game.enemies outlives the fight.
  const foeGummed = () => page.evaluate(([x, z]) => {
    const list = window.__combat?.enemies ?? window.__game.enemies ?? [];
    return !!list.find((e) => e.x === x && e.z === z)?.statuses?.some((s) => s.id === 'gum');
  }, [foe.x, foe.z]);
  // Swing the stapler (its staple-jab is on the bar) until it lands; the proc gums.
  let gummed = false;
  for (let i = 0; i < 6 && !gummed; i++) {
    await page.waitForTimeout(700);
    // Stop the moment the fight is over. Every read below assumes __combat,
    // and the combat bar this clicks is gone once it ends - waiting on a
    // vanished #hotbar-act-staple-jab would hang out the whole timeout. The gum is
    // still readable off the body, so take the last look and leave.
    if (!(await page.evaluate(() => !!window.__combat))) { gummed = await foeGummed(); break; }
    if (await page.evaluate(() => window.__combat.armed) !== 'staple-jab') await page.click('#hotbar-act-staple-jab');
    const fp = await page.evaluate(([x, z]) => window.__game.project(x, z), [foe.x, foe.z]);
    await page.mouse.click(fp.x, fp.y);
    await page.waitForTimeout(400);
    gummed = await foeGummed();
  }
  expect(gummed).toBe(true); // the on-hit proc stuck gum on the Manager
});
